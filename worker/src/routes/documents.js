import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { unwrap, forbidden } from '../lib/errors.js'
import { parseJson, parseQuery, documentPatch, documentListQuery } from '../lib/validate.js'
import { applyCursor, pageResult } from '../lib/pagination.js'
import { activityFor } from '../lib/activity.js'
import { DOC_FIELDS, loadDocument, loadVersions, loadFiles, attachCurrentFiles, assertCanView, publicFile } from '../lib/docs.js'

const documents = new Hono()

function baseListQuery(db, m) {
  let q = db.from('documents').select(DOC_FIELDS).eq('workspace_id', m.workspace_id)
  // Visibility (see lib/docs.js assertCanView for the rules)
  if (m.rank < 30) {
    if (m.role_key === 'restricted') {
      q = m.person_id ? q.or(`created_by.eq.${m.user_id},person_id.eq.${m.person_id}`) : q.eq('created_by', m.user_id)
    } else {
      q = q.or(`visibility.neq.private,created_by.eq.${m.user_id}`)
    }
  }
  return q
}

// GET /documents?q=&person_id=&sort=&order=&limit=&cursor=
documents.get('/', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const q = parseQuery(c, documentListQuery)
  let query = baseListQuery(db, m).is('deleted_at', null)
  if (q.q) query = query.ilike('title', `%${q.q.replace(/[%_]/g, '')}%`)
  if (q.person_id) query = query.eq('person_id', q.person_id)

  let rows
  let page
  if (q.sort === 'created_at') {
    rows = unwrap(await applyCursor(query, q.cursor, q.limit), 'List documents')
    page = pageResult(rows, q.limit)
  } else {
    // Non-default sorts use offset paging via the cursor as a plain number.
    const offset = q.cursor ? Math.max(0, parseInt(q.cursor, 10) || 0) : 0
    rows = unwrap(await query.order(q.sort, { ascending: q.order === 'asc' }).order('id').range(offset, offset + q.limit), 'List documents')
    const hasMore = rows.length > q.limit
    page = { items: hasMore ? rows.slice(0, q.limit) : rows, next_cursor: hasMore ? String(offset + q.limit) : null }
  }
  await attachCurrentFiles(db, m.workspace_id, page.items)
  return c.json({ documents: page.items, next_cursor: page.next_cursor })
})

// GET /documents/trash (editor+)
documents.get('/trash', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const q = parseQuery(c, documentListQuery)
  const query = baseListQuery(db, m).not('deleted_at', 'is', null)
  const rows = unwrap(await applyCursor(query, q.cursor, q.limit), 'List trash')
  const page = pageResult(rows, q.limit)
  await attachCurrentFiles(db, m.workspace_id, page.items)
  return c.json({ documents: page.items, next_cursor: page.next_cursor })
})

// GET /documents/:id
documents.get('/:id', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'), { includeDeleted: true })
  assertCanView(m, doc)
  const [versions, files] = await Promise.all([loadVersions(db, m.workspace_id, doc.id), loadFiles(db, m.workspace_id, [doc.id])])
  return c.json({ document: { ...doc, versions, files: files.map(publicFile) } })
})

// PATCH /documents/:id (editor+)
documents.patch('/:id', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const existing = await loadDocument(db, m.workspace_id, c.req.param('id'))
  const patch = await parseJson(c, documentPatch)
  const document = unwrap(
    await db.from('documents').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', existing.id).eq('workspace_id', m.workspace_id).select(DOC_FIELDS).single(),
    'Update document',
  )
  await activityFor(c)('document.updated', 'document', document.id, { fields: Object.keys(patch) })
  await attachCurrentFiles(db, m.workspace_id, [document])
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
  await activityFor(c)('document.deleted', 'document', doc.id, { title: doc.title })
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
  await activityFor(c)('document.restored', 'document', doc.id, { title: doc.title })
  await attachCurrentFiles(db, m.workspace_id, [document])
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
  unwrap(await db.from('document_files').delete().eq('workspace_id', m.workspace_id).eq('document_id', doc.id), 'Purge files')
  unwrap(await db.from('document_versions').delete().eq('workspace_id', m.workspace_id).eq('document_id', doc.id), 'Purge versions')
  unwrap(await db.from('documents').delete().eq('workspace_id', m.workspace_id).eq('id', doc.id), 'Purge document')
  await activityFor(c)('document.purged', 'document', doc.id, { title: doc.title, files: files.length })
  return c.json({ ok: true })
})

export default documents
