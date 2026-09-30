import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { unwrap, notFound, badRequest } from '../lib/errors.js'
import { parseJson, ragAsk, ragExtract } from '../lib/validate.js'
import { activityFor } from '../lib/activity.js'
import { loadDocument, assertCanView, scopedDocumentsQuery } from '../lib/docs.js'
import { understandQuery, normalizeQuery, DOCUMENT_TYPES } from '../lib/queryUnderstanding.js'
import { rrfFuse } from '../lib/searchResults.js'
import { NOT_FOUND_SENTENCE } from '../lib/ai/index.js'
import { WELL_KNOWN_KEYS, valueColumns, loadSuggestions } from '../lib/metadata.js'
import { resolveAiKey, providerFor } from './aiKeys.js'

/**
 * "Ask your documents" (contract section 6). Mounted at /api/workspaces/:ws/rag
 * Retrieval: FTS (search_documents_fts) + keyword chunks + vector chunks (search_chunks),
 * fused with RRF, restricted to the workspace and the caller's readable documents,
 * at most 12 chunks in the prompt.
 */
const rag = new Hono()

const MAX_CHUNKS = 12
const MAX_EXTRACT_CHARS = 12_000
const STOP = new Set(['what', 'when', 'where', 'which', 'who', 'whom', 'how', 'does', 'did', 'the', 'and', 'for', 'with', 'from', 'that', 'this', 'have', 'has', 'was', 'were', 'are', 'is', 'my', 'our', 'your', 'about', 'tell', 'show', 'find', 'give'])

function aiKeyRequired(c) {
  return c.json({ code: 'ai_key_required', error: 'Add an AI key in Settings to ask questions.', request_id: c.get('requestId') }, 400)
}

async function readableDocIds(db, m, ids) {
  if (!ids.length) return new Map()
  const base = scopedDocumentsQuery(db, m, 'id, name, current_version_id')
  const rows = unwrap(await base.is('deleted_at', null).in('id', [...new Set(ids)]), 'Check readable documents')
  return new Map(rows.map((r) => [r.id, r]))
}

/** Retrieves up to MAX_CHUNKS chunks for the question. Returns { chunks, docs }. */
async function retrieve(c, { question, embedding, documentId }) {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const wsId = m.workspace_id
  const understanding = await understandQuery(db, { wsId, userId: user.id, q: question })
  const terms = (understanding.terms.length ? understanding.terms : normalizeQuery(question).split(' ')).filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 8)

  // documents from FTS (or the single document)
  let docIds = []
  if (documentId) docIds = [documentId]
  else {
    const res = await db.rpc('search_documents_fts', { ws: wsId, q: understanding.fts_query || normalizeQuery(question), lim: 10 })
    if (res.error) console.warn('[rag] search_documents_fts failed:', res.error.message)
    docIds = (res.data || []).map((r) => r.document_id)
  }

  // vector chunks
  let vectorChunks = []
  if (embedding) {
    const res = await db.rpc('search_chunks', { ws: wsId, query_embedding: embedding, lim: 60 })
    if (res.error) console.warn('[rag] search_chunks failed:', res.error.message)
    vectorChunks = (res.data || []).filter((r) => !documentId || r.document_id === documentId).map((r) => ({ id: r.chunk_id, document_id: r.document_id, version_id: r.version_id, page_number: r.page_number, content: r.content, similarity: r.similarity }))
  }

  const docs = await readableDocIds(db, m, [...docIds, ...vectorChunks.map((ch) => ch.document_id)])
  vectorChunks = vectorChunks.filter((ch) => docs.has(ch.document_id))
  const readableDocIdsList = docIds.filter((id) => docs.has(id))

  // keyword chunks in the FTS documents (current versions)
  let keywordChunks = []
  if (readableDocIdsList.length && terms.length) {
    const res = await db
      .from('document_chunks')
      .select('id, document_id, version_id, page_number, content')
      .eq('workspace_id', wsId)
      .in('document_id', readableDocIdsList)
      .or(terms.map((t) => `content.ilike.%${t.replace(/[%_,()]/g, ' ')}%`).join(','))
      .limit(60)
    if (res.error) console.warn('[rag] keyword chunks failed:', res.error.message)
    keywordChunks = (res.data || [])
      .filter((ch) => !ch.version_id || ch.version_id === docs.get(ch.document_id)?.current_version_id)
      .map((ch) => ({ ...ch, hits: terms.filter((t) => ch.content.toLowerCase().includes(t)).length }))
      .sort((a, b) => b.hits - a.hits)
  }

  const byId = new Map()
  for (const ch of [...vectorChunks, ...keywordChunks]) if (!byId.has(ch.id)) byId.set(ch.id, ch)
  const fused = rrfFuse([vectorChunks.map((ch) => ch.id), keywordChunks.map((ch) => ch.id)])
  const chunks = [...fused.keys()].slice(0, MAX_CHUNKS).map((id) => byId.get(id))
  return { chunks, docs, understanding }
}

// POST /rag/ask { question, embedding?, document_id?, key_id?, history? }
rag.post('/ask', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const body = await parseJson(c, ragAsk)

  const resolved = await resolveAiKey(db, c.env, user.id, body.key_id)
  if (!resolved) return aiKeyRequired(c)
  const provider = await providerFor(c.env, resolved)

  if (body.document_id) {
    const doc = await loadDocument(db, m.workspace_id, body.document_id)
    await assertCanView(db, m, doc)
  }
  const { chunks, docs } = await retrieve(c, { question: body.question, embedding: body.embedding || null, documentId: body.document_id || null })
  if (!chunks.length) {
    return c.json({ answer: NOT_FOUND_SENTENCE, not_found: true, sources: [], provider: provider.name, model: provider.model })
  }

  const context = chunks
    .map((ch, i) => `[${i + 1}] "${docs.get(ch.document_id)?.name || 'Document'}"${ch.page_number ? ` (page ${ch.page_number})` : ''}:\n${ch.content}`)
    .join('\n\n')
  const system = [
    "You are DastaVault's document assistant. Answer the user's question using ONLY the numbered context passages below.",
    'Cite every fact with the passage number in square brackets, like [1] or [2][3]. Do not invent details that are not in the passages.',
    `If the passages do not contain the answer, reply with exactly this sentence and nothing else: ${NOT_FOUND_SENTENCE}`,
    'Be concise and answer in plain language.',
    '',
    'Context passages:',
    context,
  ].join('\n')
  const messages = [...body.history.slice(-6), { role: 'user', content: body.question }]
  const out = await provider.chat({ system, messages, maxTokens: 800 })
  const answer = (out.text || '').trim()
  const notFound = !answer || out.refused || answer.replace(/[\s"'.]/g, '').toLowerCase().includes(NOT_FOUND_SENTENCE.replace(/[\s"'.]/g, '').toLowerCase())
  const cited = [...new Set([...answer.matchAll(/\[(\d+)\]/g)].map((mm) => Number(mm[1])))].filter((n) => n >= 1 && n <= chunks.length)
  const picks = notFound ? [] : cited.length ? cited : [1, 2, 3].filter((n) => n <= chunks.length)
  const sources = picks.map((n) => {
    const ch = chunks[n - 1]
    return { n, document_id: ch.document_id, document_name: docs.get(ch.document_id)?.name || null, page_number: ch.page_number ?? null, chunk_id: ch.id, snippet: ch.content.slice(0, 300) }
  })
  await db.from('ai_provider_keys').update({ last_used_at: new Date().toISOString() }).eq('id', resolved.row.id)
  await activityFor(c)('ai.asked', 'workspace', m.workspace_id, { provider: provider.name, model: out.model, chunks: chunks.length, not_found: notFound, document_id: body.document_id || null }, 'asked the documents a question')
  return c.json({ answer: notFound ? NOT_FOUND_SENTENCE : answer, not_found: notFound, sources, provider: provider.name, model: out.model || provider.model, usage: out.usage })
})

function parseJsonObject(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1))
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null
  } catch {
    return null
  }
}

// POST /rag/extract { document_id, version_id, key_id? } -> { suggestions } (editor+)
rag.post('/extract', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const body = await parseJson(c, ragExtract)
  const resolved = await resolveAiKey(db, c.env, user.id, body.key_id)
  if (!resolved) return aiKeyRequired(c)
  const provider = await providerFor(c.env, resolved)

  const doc = await loadDocument(db, m.workspace_id, body.document_id)
  const version = unwrap(await db.from('document_versions').select('id, ocr_text').eq('document_id', doc.id).eq('id', body.version_id).maybeSingle(), 'Load version')
  if (!version) throw notFound('Version not found')
  const text = String(version.ocr_text || '').trim().slice(0, MAX_EXTRACT_CHARS)
  if (!text) throw badRequest('This version has no extracted text yet')

  const system = [
    'You extract metadata from a document\'s text. Reply with ONE JSON object and nothing else (no prose, no code fences).',
    'Use only these keys and omit any key you cannot fill from the text:',
    'document_type (one of: ' + DOCUMENT_TYPES.join(', ') + '), person_name, organisation, document_number, issue_date (YYYY-MM-DD), expiry_date (YYYY-MM-DD),',
    'invoice_number, amount (number), currency (ISO code), vendor, policy_number, registration_number, email, phone, address, category,',
    'keywords (comma separated, max 8), summary (one or two plain sentences), suggested_name (format "Person - Type - Organisation or identifier - Date").',
    'Never guess values that are not in the text.',
  ].join('\n')
  const out = await provider.chat({ system, messages: [{ role: 'user', content: `Document text:\n\n${text}` }], maxTokens: 700, temperature: 0 })
  const parsed = parseJsonObject(out.text)
  if (!parsed) throw badRequest('The AI did not return valid JSON; try again')

  const rows = []
  for (const key of WELL_KNOWN_KEYS) {
    const value = parsed[key]
    if (value === null || value === undefined || value === '' || typeof value === 'object') continue
    rows.push({
      workspace_id: m.workspace_id,
      document_id: doc.id,
      version_id: version.id,
      key,
      ...valueColumns(typeof value === 'string' ? value.trim().slice(0, 2000) : value),
      confidence: 0.7,
      source: 'ai',
      status: 'pending',
      created_by: user.id,
    })
  }
  unwrap(await db.from('document_metadata_suggestions').delete().eq('document_id', doc.id).eq('source', 'ai').eq('status', 'pending'), 'Clear AI suggestions')
  if (rows.length) unwrap(await db.from('document_metadata_suggestions').insert(rows), 'Save AI suggestions')
  await db.from('ai_provider_keys').update({ last_used_at: new Date().toISOString() }).eq('id', resolved.row.id)
  await activityFor(c)('ai.extracted', 'document', doc.id, { provider: provider.name, model: out.model, keys: rows.map((r) => r.key) }, `found details in "${doc.name}" with AI`)
  return c.json({ suggestions: await loadSuggestions(db, doc.id), provider: provider.name, model: out.model || provider.model })
})

export default rag
