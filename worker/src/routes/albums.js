import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { unwrap, notFound, badRequest } from '../lib/errors.js'
import { parseJson, parseQuery, paginationQuery, albumCreate, albumPatch, albumItemsAdd } from '../lib/validate.js'
import { applyCursor, pageResult } from '../lib/pagination.js'
import { activityFor } from '../lib/activity.js'
import { isUuid } from '../lib/ids.js'
import { scopedDocumentsQuery, attachSummaries, personDocumentIds, groupDocumentIds } from '../lib/docs.js'

/**
 * Albums and smart albums (contract section 5). Mounted at /api/workspaces/:ws/albums
 * Smart rules (`rules.all`) are evaluated live as one PostgREST query; link-table
 * fields (person_id / group_id / tag) become `.in('id', ids)` sub-lookups.
 */
const albums = new Hono()

const ALBUM_FIELDS = 'id, workspace_id, name, description, kind, person_id, group_id, document_type, event_date, cover_document_id, cover_file_id, rules, sort_by, is_shared, created_by, created_at, updated_at'
const esc = (s) => String(s ?? '').replace(/[%_,()]/g, ' ').trim()
const isoToday = () => new Date().toISOString().slice(0, 10)

async function loadAlbum(db, wsId, id) {
  if (!isUuid(id)) throw badRequest('Invalid album id')
  const a = unwrap(await db.from('albums').select(ALBUM_FIELDS).eq('workspace_id', wsId).eq('id', id).maybeSingle(), 'Load album')
  if (!a) throw notFound('Album not found')
  return a
}

function publicAlbum(a, itemCount = null) {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    description: a.description,
    cover_file_id: a.cover_file_id ?? null,
    cover_document_id: a.cover_document_id ?? null,
    item_count: itemCount,
    rules: a.rules && typeof a.rules === 'object' && Array.isArray(a.rules.all) ? a.rules : { all: [] },
    created_by: a.created_by,
    created_at: a.created_at,
    updated_at: a.updated_at,
  }
}

/** Effective rules of a non-manual album (column shortcuts for person/group/type kinds are folded in). */
function effectiveRules(album) {
  const all = [...(album.rules?.all || [])]
  if (album.kind === 'person' && album.person_id && !all.some((r) => r.field === 'person_id')) all.push({ field: 'person_id', op: 'eq', value: album.person_id })
  if (album.kind === 'group' && album.group_id && !all.some((r) => r.field === 'group_id')) all.push({ field: 'group_id', op: 'eq', value: album.group_id })
  if (album.kind === 'type' && album.document_type && !all.some((r) => r.field === 'document_type')) all.push({ field: 'document_type', op: 'eq', value: album.document_type })
  return all
}

const asList = (v) => (Array.isArray(v) ? v.map(String) : v === null || v === undefined ? [] : [String(v)])

/** Builds the documents query for a smart album. Returns null when nothing can match. */
export async function smartAlbumQuery(db, m, album) {
  let query = await scopedDocumentsQuery(db, m)
  query = query.is('deleted_at', null)
  for (const rule of effectiveRules(album)) {
    const values = asList(rule.value)
    switch (rule.field) {
      case 'person_id': {
        const ids = new Set()
        for (const pid of values.filter(isUuid)) for (const id of await personDocumentIds(db, m.workspace_id, pid)) ids.add(id)
        if (!ids.size) return null
        query = query.in('id', [...ids])
        break
      }
      case 'group_id': {
        const ids = new Set()
        for (const gid of values.filter(isUuid)) for (const id of await groupDocumentIds(db, m.workspace_id, gid)) ids.add(id)
        if (!ids.size) return null
        query = query.in('id', [...ids])
        break
      }
      case 'tag': {
        const uuids = values.filter(isUuid)
        const names = values.filter((v) => !isUuid(v))
        let tq = db.from('tags').select('id').eq('workspace_id', m.workspace_id)
        if (uuids.length && names.length) tq = tq.or(`id.in.(${uuids.join(',')}),name.in.(${names.map((n) => `"${esc(n)}"`).join(',')})`)
        else if (uuids.length) tq = tq.in('id', uuids)
        else if (names.length) tq = tq.in('name', names)
        else return null
        const tagIds = unwrap(await tq, 'Find tags').map((t) => t.id)
        if (!tagIds.length) return null
        const rows = unwrap(await db.from('document_tags').select('document_id').eq('workspace_id', m.workspace_id).in('tag_id', tagIds), 'Filter by tags')
        const ids = [...new Set(rows.map((r) => r.document_id))]
        if (!ids.length) return null
        query = query.in('id', ids)
        break
      }
      case 'document_type':
        query = rule.op === 'in' ? query.in('document_type', values) : query.eq('document_type', values[0] ?? '')
        break
      case 'organisation':
        query = rule.op === 'contains' ? query.ilike('organisation', `%${esc(values[0])}%`) : query.ilike('organisation', esc(values[0]))
        break
      case 'created_after':
        query = query.gte('created_at', values[0])
        break
      case 'created_before':
        query = query.lte('created_at', values[0])
        break
      case 'expiry_within_days': {
        const days = Math.max(0, parseInt(values[0], 10) || 0)
        const to = new Date()
        to.setUTCDate(to.getUTCDate() + days)
        query = query.gte('expiry_date', isoToday()).lte('expiry_date', to.toISOString().slice(0, 10))
        break
      }
      case 'text': {
        const v = esc(values[0])
        if (v) query = query.or(`name.ilike.%${v}%,summary.ilike.%${v}%,organisation.ilike.%${v}%,document_number.ilike.%${v}%`)
        break
      }
      default:
        break
    }
  }
  return query
}

async function itemCounts(db, m, rows) {
  const counts = new Map()
  const manualIds = rows.filter((a) => a.kind === 'manual').map((a) => a.id)
  if (manualIds.length) {
    const items = unwrap(await db.from('album_items').select('album_id').eq('workspace_id', m.workspace_id).in('album_id', manualIds).limit(20000), 'Count album items')
    for (const it of items) counts.set(it.album_id, (counts.get(it.album_id) || 0) + 1)
    for (const id of manualIds) if (!counts.has(id)) counts.set(id, 0)
  }
  await Promise.all(
    rows
      .filter((a) => a.kind !== 'manual')
      .map(async (a) => {
        const q = await smartAlbumQuery(db, m, a)
        if (!q) return counts.set(a.id, 0)
        const countRes = await q.select('id', { count: 'exact', head: true })
        counts.set(a.id, countRes.error ? 0 : countRes.count ?? 0)
      }),
  )
  return counts
}

// GET /albums
albums.get('/', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const rows = unwrap(await db.from('albums').select(ALBUM_FIELDS).eq('workspace_id', m.workspace_id).order('name'), 'List albums')
  const counts = await itemCounts(db, m, rows)
  return c.json({ albums: rows.map((a) => publicAlbum(a, counts.get(a.id) ?? 0)) })
})

// POST /albums { name, kind, description?, rules? } (editor+)
albums.post('/', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const body = await parseJson(c, albumCreate)
  const rules = body.rules || { all: [] }
  const insert = { workspace_id: m.workspace_id, name: body.name, kind: body.kind, description: body.description ?? null, rules, created_by: c.get('user').id }
  const first = (field) => rules.all.find((r) => r.field === field)?.value
  if (body.kind === 'person' && isUuid(String(first('person_id')))) insert.person_id = String(first('person_id'))
  if (body.kind === 'group' && isUuid(String(first('group_id')))) insert.group_id = String(first('group_id'))
  if (body.kind === 'type' && first('document_type')) insert.document_type = String(asList(first('document_type'))[0])
  const album = unwrap(await db.from('albums').insert(insert).select(ALBUM_FIELDS).single(), 'Create album')
  await activityFor(c)('album.created', 'album', album.id, { name: album.name, kind: album.kind }, `created album "${album.name}"`)
  return c.json({ album: publicAlbum(album, 0) }, 201)
})

// GET /albums/:id?cursor&limit -> { album, documents, next_cursor }
albums.get('/:aid', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const album = await loadAlbum(db, m.workspace_id, c.req.param('aid'))
  const q = parseQuery(c, paginationQuery)
  let documents = []
  let nextCursor = null
  let total = 0
  if (album.kind === 'manual') {
    const items = unwrap(await applyCursor(db.from('album_items').select('id, document_id, created_at').eq('album_id', album.id), q.cursor, q.limit), 'Load album items')
    const page = pageResult(items, q.limit)
    nextCursor = page.next_cursor
    if (page.items.length) {
      const base = await scopedDocumentsQuery(db, m)
      const docs = unwrap(await base.is('deleted_at', null).in('id', page.items.map((i) => i.document_id)), 'Load album documents')
      const byId = new Map(docs.map((d) => [d.id, d]))
      documents = page.items.map((i) => byId.get(i.document_id)).filter(Boolean)
    }
    const countRes = await db.from('album_items').select('id', { count: 'exact', head: true }).eq('album_id', album.id)
    total = countRes.count ?? documents.length
  } else {
    const query = await smartAlbumQuery(db, m, album)
    if (query) {
      const rows = unwrap(await applyCursor(query, q.cursor, q.limit), 'Evaluate smart album')
      const page = pageResult(rows, q.limit)
      documents = page.items
      nextCursor = page.next_cursor
      const countRes = await (await smartAlbumQuery(db, m, album)).select('id', { count: 'exact', head: true })
      total = countRes.error ? documents.length : countRes.count ?? documents.length
    }
  }
  await attachSummaries(db, m.workspace_id, documents)
  return c.json({ album: publicAlbum(album, total), documents, next_cursor: nextCursor })
})

// PATCH /albums/:id (editor+)
albums.patch('/:aid', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const existing = await loadAlbum(db, m.workspace_id, c.req.param('aid'))
  const body = await parseJson(c, albumPatch)
  if (body.cover_file_id) {
    const f = unwrap(await db.from('document_files').select('id, document_id').eq('workspace_id', m.workspace_id).eq('id', body.cover_file_id).maybeSingle(), 'Verify cover file')
    if (!f) throw badRequest('cover_file_id does not exist in this workspace')
    body.cover_document_id = f.document_id
  } else if (body.cover_file_id === null) {
    body.cover_document_id = null
  }
  const album = unwrap(
    await db.from('albums').update({ ...body, updated_at: new Date().toISOString() }).eq('id', existing.id).eq('workspace_id', m.workspace_id).select(ALBUM_FIELDS).single(),
    'Update album',
  )
  await activityFor(c)('album.updated', 'album', album.id, { fields: Object.keys(body) }, `updated album "${album.name}"`)
  const counts = await itemCounts(db, m, [album])
  return c.json({ album: publicAlbum(album, counts.get(album.id) ?? 0) })
})

// DELETE /albums/:id (editor+)
albums.delete('/:aid', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const album = await loadAlbum(db, m.workspace_id, c.req.param('aid'))
  unwrap(await db.from('albums').delete().eq('id', album.id).eq('workspace_id', m.workspace_id), 'Delete album')
  await activityFor(c)('album.deleted', 'album', album.id, { name: album.name }, `deleted album "${album.name}"`)
  return c.json({ ok: true })
})

// POST /albums/:id/items { document_ids } (editor+) -> { added }
albums.post('/:aid/items', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const album = await loadAlbum(db, m.workspace_id, c.req.param('aid'))
  if (album.kind !== 'manual') throw badRequest('Only manual albums accept items')
  const body = await parseJson(c, albumItemsAdd)
  const base = await scopedDocumentsQuery(db, m, 'id')
  const docs = unwrap(await base.is('deleted_at', null).in('id', body.document_ids), 'Verify documents')
  const ids = docs.map((d) => d.id)
  if (!ids.length) return c.json({ added: 0 })
  const existing = unwrap(await db.from('album_items').select('document_id').eq('album_id', album.id).in('document_id', ids), 'Load existing items')
  const have = new Set(existing.map((e) => e.document_id))
  const fresh = ids.filter((id) => !have.has(id))
  if (fresh.length) {
    const maxRes = await db.from('album_items').select('position').eq('album_id', album.id).order('position', { ascending: false }).limit(1).maybeSingle()
    let position = (maxRes.data?.position ?? -1) + 1
    unwrap(
      await db.from('album_items').upsert(
        fresh.map((document_id) => ({ workspace_id: m.workspace_id, album_id: album.id, document_id, position: position++, created_by: c.get('user').id })),
        { onConflict: 'album_id,document_id', ignoreDuplicates: true },
      ),
      'Add album items',
    )
  }
  await activityFor(c)('album.items_added', 'album', album.id, { added: fresh.length }, `added ${fresh.length} document(s) to album "${album.name}"`)
  return c.json({ added: fresh.length })
})

// DELETE /albums/:id/items/:documentId (editor+)
albums.delete('/:aid/items/:docId', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const album = await loadAlbum(db, m.workspace_id, c.req.param('aid'))
  const docId = c.req.param('docId')
  if (!isUuid(docId)) throw badRequest('Invalid document id')
  unwrap(await db.from('album_items').delete().eq('album_id', album.id).eq('document_id', docId), 'Remove album item')
  return c.json({ ok: true })
})

export default albums
