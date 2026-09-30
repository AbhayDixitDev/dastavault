import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { unwrap, forbidden } from '../lib/errors.js'
import { parseJson, parseQuery, documentPatch, documentListQuery } from '../lib/validate.js'
import { applyCursor, pageResult } from '../lib/pagination.js'
import { activityFor } from '../lib/activity.js'
import {
  DOC_FIELDS, loadDocument, loadVersions, loadFiles, attachSummaries, assertCanView, publicFile,
  personDocumentIds, groupDocumentIds, setDocumentLinks, scopedDocumentsQuery,
} from '../lib/docs.js'

const documents = new Hono()

/** Base query with the visibility rules from lib/docs.js applied. */
const scopedQuery = (db, m) => scopedDocumentsQuery(db, m)

async function listPage(c, { deleted }) {
  const db = c.get('db')
  const m = c.get('membership')
  const q = parseQuery(c, documentListQuery)
  let query = await scopedQuery(db, m)
  query = deleted ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null)
  if (q.q) query = query.ilike('name', `%${q.q.replace(/[%_,]/g, '')}%`)
  if (q.document_type) query = query.eq('document_type', q.document_type)
  if (q.favorite) query = query.eq('is_favorite', true)
  if (q.person_id) {
    const ids = await personDocumentIds(db, m.workspace_id, q.person_id)
    if (!ids.length) return { documents: [], next_cursor: null }
    query = query.in('id', ids)
  }
  if (q.group_id) {
    const ids = await groupDocumentIds(db, m.workspace_id, q.group_id)
    if (!ids.length) return { documents: [], next_cursor: null }
    query = query.in('id', ids)
  }

  let page
  if (q.sort === 'created_at' && q.order === 'desc') {
    const rows = unwrap(await applyCursor(query, q.cursor, q.limit), 'List documents')
    page = pageResult(rows, q.limit)
  } else {
    // Other sorts use offset paging; the cursor is the numeric offset.
    const offset = q.cursor ? Math.max(0, parseInt(q.cursor, 10) || 0) : 0
    const rows = unwrap(await query.order(q.sort, { ascending: q.order === 'asc', nullsFirst: false }).order('id').range(offset, offset + q.limit), 'List documents')
    const hasMore = rows.length > q.limit
    page = { items: hasMore ? rows.slice(0, q.limit) : rows, next_cursor: hasMore ? String(offset + q.limit) : null }
  }
  await attachSummaries(db, m.workspace_id, page.items)
  return { documents: page.items, next_cursor: page.next_cursor }
}

// GET /documents?q=&person_id=&group_id=&document_type=&favorite=1&sort=&order=&limit=&cursor=
documents.get('/', async (c) => c.json(await listPage(c, { deleted: false })))

// GET /documents/trash (editor+)
documents.get('/trash', requireRole('editor'), async (c) => c.json(await listPage(c, { deleted: true })))

// GET /documents/:id
documents.get('/:id', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'), { includeDeleted: true })
  await assertCanView(db, m, doc)
  const [versions, files] = await Promise.all([loadVersions(db, m.workspace_id, doc.id), loadFiles(db, m.workspace_id, [doc.id])])
  await attachSummaries(db, m.workspace_id, [doc])
  return c.json({ document: { ...doc, versions, files: files.map(publicFile) } })
})

// PATCH /documents/:id (editor+)
documents.patch('/:id', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const existing = await loadDocument(db, m.workspace_id, c.req.param('id'))
  const { person_ids, group_ids, ...patch } = await parseJson(c, documentPatch)

  const update = { ...patch, updated_at: new Date().toISOString() }
  if (patch.name && patch.name !== existing.name) {
    // keep a rename trail (previous_names text[])
    const prev = unwrap(await db.from('documents').select('previous_names').eq('id', existing.id).single(), 'Load previous names')
    update.previous_names = [...new Set([...(prev.previous_names || []), existing.name])].slice(-20)
  }
  const document = unwrap(
    await db.from('documents').update(update).eq('id', existing.id).eq('workspace_id', m.workspace_id).select(DOC_FIELDS).single(),
    'Update document',
  )
  await setDocumentLinks(db, m.workspace_id, document.id, { personIds: person_ids, groupIds: group_ids }, c.get('user').id)
  await activityFor(c)('details_edited', 'document', document.id, { fields: Object.keys(patch) }, `updated "${document.name}"`)
  await attachSummaries(db, m.workspace_id, [document])
  return c.json({ document })
})

// DELETE /documents/:id (editor+, soft delete -> trash)
documents.delete('/:id', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'))
  if (m.rank < 40 && doc.created_by !== user.id) throw forbidden('Editors can only delete documents they uploaded')
  unwrap(
    await db.from('documents').update({ deleted_at: new Date().toISOString(), deleted_by: user.id, updated_at: new Date().toISOString() }).eq('id', doc.id).eq('workspace_id', m.workspace_id),
    'Delete document',
  )
  await activityFor(c)('deleted', 'document', doc.id, { name: doc.name }, `moved "${doc.name}" to trash`)
  return c.json({ ok: true })
})

// POST /documents/:id/restore (editor+)
documents.post('/:id/restore', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'), { includeDeleted: true })
  const document = unwrap(
    await db.from('documents').update({ deleted_at: null, deleted_by: null, updated_at: new Date().toISOString() }).eq('id', doc.id).eq('workspace_id', m.workspace_id).select(DOC_FIELDS).single(),
    'Restore document',
  )
  await activityFor(c)('restored', 'document', doc.id, { name: doc.name }, `restored "${doc.name}"`)
  await attachSummaries(db, m.workspace_id, [document])
  return c.json({ document })
})

// DELETE /documents/:id/purge (admin+, permanent: removes R2 objects and rows)
documents.delete('/:id/purge', requireRole('admin'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'), { includeDeleted: true })
  if (!doc.deleted_at) throw forbidden('Move the document to trash before purging it')
  const files = await loadFiles(db, m.workspace_id, [doc.id])
  if (files.length) await c.env.DOCUMENTS_BUCKET.delete(files.map((f) => f.r2_object_key))
  // documents FK cascades to versions/files/pages/links
  unwrap(await db.from('documents').delete().eq('workspace_id', m.workspace_id).eq('id', doc.id), 'Purge document')
  await activityFor(c)('purged', 'document', doc.id, { name: doc.name, files: files.length }, `permanently deleted "${doc.name}"`)
  return c.json({ ok: true })
})

export default documents
