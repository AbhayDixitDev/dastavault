import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { unwrap, notFound, badRequest, HttpError } from '../lib/errors.js'
import { parseJson, parseQuery, shareCreate, sharesQuery } from '../lib/validate.js'
import { activityFor } from '../lib/activity.js'
import { isUuid, randomToken } from '../lib/ids.js'
import { sha256Hex, timingSafeEqual, signFileUrl } from '../lib/signing.js'
import { rateLimit } from '../lib/rateLimit.js'
import { DOC_FIELDS, FILE_FIELDS, loadDocument, assertCanView } from '../lib/docs.js'

/**
 * Sharing (contract section 5).
 *   workspace: GET/POST /api/workspaces/:ws/shares, DELETE /shares/:id
 *   public:    GET /api/shares/:token (header x-share-password)
 * Link passwords are stored as sha256("<token>:<password>") and compared in constant time.
 */
const SHARE_FIELDS = 'id, workspace_id, document_id, album_id, kind, shared_with_user_id, shared_with_group_id, token, password_hash, allow_download, expires_at, revoked_at, view_count, last_viewed_at, created_by, created_at'
const SHARE_URL_TTL_SECONDS = 15 * 60

const passwordHash = (token, password) => sha256Hex(`${token}:${password}`)

function shareUrl(env, share) {
  if (share.kind !== 'link' || !share.token) return null
  return `${String(env.APP_URL || '').replace(/\/$/, '')}/s/${share.token}`
}

function publicShare(env, s) {
  return {
    id: s.id,
    document_id: s.document_id,
    kind: s.kind,
    target_id: s.kind === 'member' ? s.shared_with_user_id : s.kind === 'group' ? s.shared_with_group_id : null,
    token: s.kind === 'link' ? s.token : null,
    url: shareUrl(env, s),
    expires_at: s.expires_at,
    allow_download: s.allow_download,
    has_password: Boolean(s.password_hash),
    views: s.view_count ?? 0,
    last_viewed_at: s.last_viewed_at,
    created_by: s.created_by,
    created_at: s.created_at,
  }
}

export const sharesRoutes = new Hono()

// GET /shares?document_id=
sharesRoutes.get('/', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const q = parseQuery(c, sharesQuery)
  let query = db.from('shares').select(SHARE_FIELDS).eq('workspace_id', m.workspace_id).is('revoked_at', null)
  if (q.document_id) query = query.eq('document_id', q.document_id)
  if (m.rank < 40) query = query.or(`created_by.eq.${m.user_id},shared_with_user_id.eq.${m.user_id}`)
  const rows = unwrap(await query.order('created_at', { ascending: false }).limit(200), 'List shares')
  return c.json({ shares: rows.map((s) => publicShare(c.env, s)) })
})

// POST /shares { document_id, kind, target_id?, expires_in_hours?, password?, allow_download? } (editor+)
sharesRoutes.post('/', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const body = await parseJson(c, shareCreate)
  const doc = await loadDocument(db, m.workspace_id, body.document_id)
  await assertCanView(db, m, doc)

  const insert = {
    workspace_id: m.workspace_id,
    document_id: doc.id,
    kind: body.kind,
    allow_download: body.allow_download,
    expires_at: new Date(Date.now() + body.expires_in_hours * 3600 * 1000).toISOString(),
    created_by: user.id,
  }
  if (body.kind === 'link') {
    insert.token = randomToken(24)
    if (body.password) insert.password_hash = await passwordHash(insert.token, body.password)
  } else if (body.kind === 'member') {
    if (!body.target_id) throw badRequest('target_id (user id) is required for member shares')
    const member = unwrap(await db.from('workspace_members').select('id').eq('workspace_id', m.workspace_id).eq('user_id', body.target_id).maybeSingle(), 'Verify member')
    if (!member) throw badRequest('target_id is not a member of this workspace')
    insert.shared_with_user_id = body.target_id
  } else {
    if (!body.target_id) throw badRequest('target_id (group id) is required for group shares')
    const group = unwrap(await db.from('groups').select('id').eq('workspace_id', m.workspace_id).eq('id', body.target_id).maybeSingle(), 'Verify group')
    if (!group) throw badRequest('target_id is not a group of this workspace')
    insert.shared_with_group_id = body.target_id
  }
  const share = unwrap(await db.from('shares').insert(insert).select(SHARE_FIELDS).single(), 'Create share')
  await activityFor(c)('shared', 'document', doc.id, { share_id: share.id, kind: share.kind, expires_at: share.expires_at, has_password: Boolean(share.password_hash) }, `shared "${doc.name}" (${share.kind})`)
  if (share.kind === 'member') {
    await db.from('notifications').insert({
      workspace_id: m.workspace_id,
      user_id: share.shared_with_user_id,
      type: 'share',
      title: `A document was shared with you: ${doc.name}`,
      body: null,
      data: { document_id: doc.id, share_id: share.id },
    })
  }
  return c.json({ share: publicShare(c.env, share) }, 201)
})

// DELETE /shares/:id (editor+)
sharesRoutes.delete('/:sid', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const sid = c.req.param('sid')
  if (!isUuid(sid)) throw badRequest('Invalid share id')
  const share = unwrap(await db.from('shares').select(SHARE_FIELDS).eq('workspace_id', m.workspace_id).eq('id', sid).maybeSingle(), 'Load share')
  if (!share) throw notFound('Share not found')
  if (m.rank < 40 && share.created_by !== m.user_id) throw new HttpError(403, 'Only the creator or an admin can remove this share', 'forbidden')
  unwrap(await db.from('shares').update({ revoked_at: new Date().toISOString() }).eq('id', share.id), 'Revoke share')
  await activityFor(c)('share.revoked', 'document', share.document_id, { share_id: share.id, kind: share.kind }, 'removed a share')
  return c.json({ ok: true })
})

/** Public: GET /api/shares/:token (header x-share-password) */
export const publicShareRoutes = new Hono()

publicShareRoutes.get('/:token', rateLimit('share-view', { max: 60, windowMs: 60_000, by: 'ip' }), async (c) => {
  const db = c.get('db')
  const token = c.req.param('token')
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw notFound('Share link not found')
  const share = unwrap(await db.from('shares').select(SHARE_FIELDS).eq('token', token).eq('kind', 'link').maybeSingle(), 'Load share')
  if (!share || share.revoked_at) throw notFound('This share link is no longer available')
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) throw new HttpError(410, 'This share link has expired', 'share_expired')
  if (share.password_hash) {
    const given = c.req.header('x-share-password') || ''
    if (!given) throw new HttpError(401, 'This link needs a password', 'password_required')
    const expected = await passwordHash(share.token, given)
    if (!timingSafeEqual(expected, share.password_hash)) throw new HttpError(401, 'Wrong password', 'password_required')
  }
  const doc = unwrap(await db.from('documents').select(DOC_FIELDS).eq('id', share.document_id).maybeSingle(), 'Load document')
  if (!doc || doc.deleted_at) throw notFound('The shared document is no longer available')

  await db.from('shares').update({ view_count: (share.view_count || 0) + 1, last_viewed_at: new Date().toISOString() }).eq('id', share.id)

  const origin = new URL(c.req.url).origin
  const rows = doc.current_version_id
    ? unwrap(
        await db.from('document_files').select(FILE_FIELDS).eq('version_id', doc.current_version_id).in('kind', ['original', 'processed', 'thumbnail', 'pdf']).order('page_number', { ascending: true, nullsFirst: false }),
        'Load files',
      )
    : []
  const files = await Promise.all(
    rows.map(async (f) => {
      const view = await signFileUrl(c.env, origin, f.id, { ttlSeconds: SHARE_URL_TTL_SECONDS })
      const download = share.allow_download ? await signFileUrl(c.env, origin, f.id, { ttlSeconds: SHARE_URL_TTL_SECONDS, download: true }) : null
      return { id: f.id, kind: f.kind, page_number: f.page_number, mime_type: f.mime_type, size_bytes: f.size_bytes, url: view.url, download_url: download?.url ?? null, expires_at: view.expires_at }
    }),
  )
  return c.json({
    document: { id: doc.id, name: doc.name, document_type: doc.document_type, page_count: doc.page_count, summary: doc.summary },
    files,
    allow_download: share.allow_download,
    expires_at: share.expires_at,
  })
})
