import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { unwrap, notFound, badRequest } from '../lib/errors.js'
import { parseJson, parseQuery, suggestionsPut, metadataPatch, documentTagsPut, checkDuplicates, chunksPut, chunksQuery } from '../lib/validate.js'
import { activityFor } from '../lib/activity.js'
import { isUuid } from '../lib/ids.js'
import { loadDocument, assertCanView, attachSummaries, scopedDocumentsQuery } from '../lib/docs.js'
import { SUGGESTION_FIELDS, valueColumns, toDbSource, publicSuggestion, loadSuggestions, loadMetadata, applyMetadata } from '../lib/metadata.js'
import { hammingDistanceHex } from '../lib/queryUnderstanding.js'
import { resolveTagIds, loadDocumentTags } from './tags.js'

/**
 * Suggestions, metadata, tags, duplicates and chunks (contract section 3).
 * Mounted at /api/workspaces/:ws/documents (before routes/documents.js).
 */
const details = new Hono()

/* ---------- suggestions ---------- */

details.get('/:id/suggestions', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'), { includeDeleted: true })
  await assertCanView(db, m, doc)
  return c.json({ suggestions: await loadSuggestions(db, doc.id) })
})

// PUT /documents/:id/suggestions { version_id?, suggestions } (replaces the set)
details.put('/:id/suggestions', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'))
  const body = await parseJson(c, suggestionsPut)
  const versionId = body.version_id || doc.current_version_id || null
  if (body.version_id) {
    const v = unwrap(await db.from('document_versions').select('id').eq('document_id', doc.id).eq('id', body.version_id).maybeSingle(), 'Load version')
    if (!v) throw notFound('Version not found')
  }
  // keep accepted history? No: the contract says "replaces suggestions for the doc".
  unwrap(await db.from('document_metadata_suggestions').delete().eq('document_id', doc.id), 'Clear suggestions')
  if (body.suggestions.length) {
    unwrap(
      await db.from('document_metadata_suggestions').insert(
        body.suggestions.map((s) => ({
          workspace_id: m.workspace_id,
          document_id: doc.id,
          version_id: versionId,
          key: s.key,
          ...valueColumns(s.value),
          confidence: s.confidence,
          source: toDbSource(s.source),
          status: 'pending',
          created_by: user.id,
        })),
      ),
      'Save suggestions',
    )
  }
  return c.json({ suggestions: await loadSuggestions(db, doc.id) })
})

// POST /documents/:id/suggestions/:sid/accept -> { document, metadata }
details.post('/:id/suggestions/:sid/accept', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'))
  const sid = c.req.param('sid')
  if (!isUuid(sid)) throw badRequest('Invalid suggestion id')
  const row = unwrap(await db.from('document_metadata_suggestions').select(SUGGESTION_FIELDS).eq('document_id', doc.id).eq('id', sid).maybeSingle(), 'Load suggestion')
  if (!row) throw notFound('Suggestion not found')
  const s = publicSuggestion(row)
  const result = await applyMetadata(c, doc, { [s.key]: s.value }, { source: row.source === 'ai' ? 'ai' : 'rule' })
  const now = new Date().toISOString()
  unwrap(await db.from('document_metadata_suggestions').update({ status: 'accepted', reviewed_by: user.id, reviewed_at: now, updated_at: now }).eq('id', row.id), 'Accept suggestion')
  await attachSummaries(db, m.workspace_id, [result.document])
  return c.json(result)
})

/* ---------- metadata ---------- */

// PATCH /documents/:id/metadata { fields: { key: value | null } } -> { metadata }
details.patch('/:id/metadata', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'))
  const body = await parseJson(c, metadataPatch)
  if (!Object.keys(body.fields).length) throw badRequest('fields is empty')
  const result = await applyMetadata(c, doc, body.fields)
  await attachSummaries(db, m.workspace_id, [result.document])
  return c.json({ metadata: result.metadata, document: result.document })
})

/* ---------- tags on a document ---------- */

// PUT /documents/:id/tags { tag_ids?, names? } -> { tags } (replaces the set)
details.put('/:id/tags', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'))
  const body = await parseJson(c, documentTagsPut)
  const ids = await resolveTagIds(db, m.workspace_id, { tagIds: body.tag_ids || [], names: body.names || [] }, user.id)
  unwrap(await db.from('document_tags').delete().eq('workspace_id', m.workspace_id).eq('document_id', doc.id), 'Clear tags')
  if (ids.length) {
    unwrap(await db.from('document_tags').insert(ids.map((tag_id) => ({ workspace_id: m.workspace_id, document_id: doc.id, tag_id, created_by: user.id }))), 'Link tags')
  }
  const tags = await loadDocumentTags(db, doc.id)
  await activityFor(c)('tag_added', 'document', doc.id, { tags: tags.map((t) => t.name) }, `tagged "${doc.name}" with ${tags.map((t) => t.name).join(', ') || 'nothing'}`)
  return c.json({ tags })
})

/* ---------- duplicates ---------- */

// POST /documents/check-duplicates
details.post('/check-duplicates', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const body = await parseJson(c, checkDuplicates)
  const best = new Map() // document_id -> { reason, score }
  const consider = (id, reason, score) => {
    if (!id || (body.exclude_document_id && id === body.exclude_document_id)) return
    const prev = best.get(id)
    if (!prev || score > prev.score) best.set(id, { reason, score })
  }

  if (body.sha256?.length) {
    const rows = unwrap(await db.from('document_files').select('document_id').eq('workspace_id', m.workspace_id).in('sha256', body.sha256.map((h) => h.toLowerCase())), 'Match hashes')
    for (const r of rows) consider(r.document_id, 'exact_file', 1)
  }
  if (body.perceptual_hash) {
    const rows = unwrap(
      await db.from('documents').select('id, perceptual_hash').eq('workspace_id', m.workspace_id).is('deleted_at', null).not('perceptual_hash', 'is', null).limit(2000),
      'Load perceptual hashes',
    )
    for (const r of rows) {
      const d = hammingDistanceHex(body.perceptual_hash, r.perceptual_hash)
      if (d <= 10) consider(r.id, 'similar_image', Math.max(0, 1 - d / 64))
    }
  }
  if (body.document_number) {
    const rows = unwrap(
      await db.from('documents').select('id').eq('workspace_id', m.workspace_id).is('deleted_at', null).ilike('document_number', body.document_number.replace(/[%_]/g, '')),
      'Match document number',
    )
    for (const r of rows) consider(r.id, 'same_number', 0.9)
  }
  if (body.text_sample && body.text_sample.trim().length >= 20) {
    const res = await db.rpc('similar_documents_by_text', { ws: m.workspace_id, sample: body.text_sample, lim: 10 })
    if (res.error) console.warn('[duplicates] similar_documents_by_text failed (migration 011 applied?):', res.error.message)
    else for (const r of res.data || []) if (r.similarity >= 0.3) consider(r.document_id, 'similar_text', Math.min(0.89, Number(r.similarity)))
  }

  if (!best.size) return c.json({ matches: [] })
  const q = scopedDocumentsQuery(db, m)
  const docs = unwrap(await q.is('deleted_at', null).in('id', [...best.keys()]).limit(50), 'Load matches')
  await attachSummaries(db, m.workspace_id, docs)
  const matches = docs
    .map((document) => ({ document, ...best.get(document.id) }))
    .sort((a, b) => b.score - a.score)
  return c.json({ matches })
})

/* ---------- chunks ---------- */

// PUT /documents/:id/chunks -> { count }
details.put('/:id/chunks', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'))
  const body = await parseJson(c, chunksPut)
  const version = unwrap(await db.from('document_versions').select('id').eq('document_id', doc.id).eq('id', body.version_id).maybeSingle(), 'Load version')
  if (!version) throw notFound('Version not found')

  unwrap(await db.from('document_chunks').delete().eq('document_id', doc.id).eq('version_id', version.id), 'Clear chunks')
  const rows = body.chunks.map((ch) => ({
    workspace_id: m.workspace_id,
    document_id: doc.id,
    version_id: version.id,
    chunk_number: ch.chunk_number,
    page_number: ch.page_number ?? null,
    section: ch.section ?? null,
    content: ch.content,
    embedding: ch.embedding,
    embedding_model: body.embedding_model,
    embedding_version: body.embedding_version,
    token_count: Math.ceil(ch.content.length / 4),
    metadata: ch.metadata || {},
    created_by: user.id,
  }))
  for (let i = 0; i < rows.length; i += 100) {
    unwrap(await db.from('document_chunks').insert(rows.slice(i, i + 100)), 'Save chunks')
  }
  await activityFor(c)('indexed', 'document', doc.id, { version_id: version.id, chunks: rows.length, model: body.embedding_model }, `made "${doc.name}" searchable by meaning`)
  return c.json({ count: rows.length })
})

// GET /documents/:id/chunks?version_id -> { chunks } (no embeddings)
details.get('/:id/chunks', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'), { includeDeleted: true })
  await assertCanView(db, m, doc)
  const q = parseQuery(c, chunksQuery)
  const versionId = q.version_id || doc.current_version_id
  if (!versionId) return c.json({ chunks: [] })
  const rows = unwrap(
    await db.from('document_chunks').select('id, chunk_number, page_number, section, content').eq('document_id', doc.id).eq('version_id', versionId).order('chunk_number').limit(5000),
    'Load chunks',
  )
  return c.json({ chunks: rows })
})

export default details
