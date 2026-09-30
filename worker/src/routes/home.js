import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { unwrap } from '../lib/errors.js'
import { scopedDocumentsQuery, attachSummaries } from '../lib/docs.js'

/** Home and stats (contract section 9). Mounted at /api/workspaces/:ws (paths /home and /stats). */
const home = new Hono()

const DAY_MS = 24 * 60 * 60 * 1000

async function count(db, table, wsId, extra = (q) => q) {
  const res = await extra(db.from(table).select('id', { count: 'exact', head: true }).eq('workspace_id', wsId))
  if (res.error) {
    console.warn(`[home] count ${table} failed:`, res.error.message)
    return 0
  }
  return res.count ?? 0
}

// GET /home
home.get('/home', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const wsId = m.workspace_id
  const today = new Date().toISOString().slice(0, 10)
  const to = new Date(Date.now() + 30 * DAY_MS).toISOString().slice(0, 10)

  const [recent, expiring, favorites] = await Promise.all([
    scopedDocumentsQuery(db, m).then((q) => q.is('deleted_at', null).order('updated_at', { ascending: false }).limit(10)),
    scopedDocumentsQuery(db, m).then((q) => q.is('deleted_at', null).gte('expiry_date', today).lte('expiry_date', to).order('expiry_date', { ascending: true }).limit(10)),
    scopedDocumentsQuery(db, m).then((q) => q.is('deleted_at', null).eq('is_favorite', true).order('updated_at', { ascending: false }).limit(10)),
  ])
  const recentDocs = unwrap(recent, 'Load recent documents')
  const expiringDocs = unwrap(expiring, 'Load expiring documents')
  const favoriteDocs = unwrap(favorites, 'Load favorites')
  await attachSummaries(db, wsId, [...recentDocs, ...expiringDocs, ...favoriteDocs])
  const now = Date.parse(`${today}T00:00:00Z`)

  const [documents, people, groups, albums, notes, ws] = await Promise.all([
    count(db, 'documents', wsId, (q) => q.is('deleted_at', null)),
    count(db, 'people', wsId, (q) => q.is('deleted_at', null)),
    count(db, 'groups', wsId),
    count(db, 'albums', wsId),
    count(db, 'notes', wsId, (q) => q.is('deleted_at', null).or(`is_private.eq.false,created_by.eq.${m.user_id}`)),
    db.from('workspaces').select('storage_bytes').eq('id', wsId).maybeSingle(),
  ])

  return c.json({
    recent: recentDocs,
    expiring: expiringDocs.map((d) => ({ ...d, days_left: Math.round((Date.parse(`${d.expiry_date}T00:00:00Z`) - now) / DAY_MS) })),
    favorites: favoriteDocs,
    counts: { documents, people, groups, albums, notes },
    storage_bytes: Number(ws.data?.storage_bytes ?? m.workspace.storage_bytes) || 0,
  })
})

// GET /stats (admin+)
home.get('/stats', requireRole('admin'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const wsId = m.workspace_id
  const [documents, versions, files, people, groups, members, chunks, ws, last] = await Promise.all([
    count(db, 'documents', wsId, (q) => q.is('deleted_at', null)),
    count(db, 'document_versions', wsId),
    count(db, 'document_files', wsId),
    count(db, 'people', wsId, (q) => q.is('deleted_at', null)),
    count(db, 'groups', wsId),
    count(db, 'workspace_members', wsId),
    count(db, 'document_chunks', wsId),
    db.from('workspaces').select('storage_bytes').eq('id', wsId).maybeSingle(),
    db.from('activity_logs').select('created_at').eq('workspace_id', wsId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const trashed = await count(db, 'documents', wsId, (q) => q.not('deleted_at', 'is', null))
  return c.json({
    documents,
    versions,
    files,
    storage_bytes: Number(ws.data?.storage_bytes ?? m.workspace.storage_bytes) || 0,
    people,
    groups,
    members,
    chunks,
    trashed_documents: trashed,
    last_activity_at: last.data?.created_at ?? null,
  })
})

export default home
