import { Hono } from 'hono'
import { unwrap } from '../lib/errors.js'
import { parseQuery, parseJson, searchQuery, hybridSearchBody, imageSearchBody } from '../lib/validate.js'
import { understandQuery, normalizeQuery, hammingDistanceHex, DOCUMENT_TYPES } from '../lib/queryUnderstanding.js'
import { enrichDocuments, rrfFuse, snippetOf } from '../lib/searchResults.js'
import { scopedDocumentsQuery, groupDocumentIds } from '../lib/docs.js'
import { isUuid } from '../lib/ids.js'

/**
 * Search (contract section 4). Mounted at /api/workspaces/:ws/search
 *   GET  /            keyword (FTS + exact name/number/person) + filters (+ notes)
 *   POST /hybrid      + vector search over document_chunks, fused with RRF (k=60) + exact boosts
 *   POST /image       perceptual hash + text sample + optional embedding
 *   GET  /suggest     people / tags / types / recent
 * Saved searches live in routes/searchSaved.js.
 */
const search = new Hono()

const CANDIDATES = 200
const RRF_K = 60
const BOOST = { name: 0.05, person: 0.04, number: 0.04 }
const escLike = (s) => String(s).replace(/[%_,()]/g, ' ').trim()

const emptyResolved = () => ({ terms: [], person_ids: [], person_names: [], document_type: null, date_range: null, relation_words: [], document_numbers: [], expiring: false, fts_query: '' })

/** Applies the request filters + resolved query filters in SQL. Returns null when nothing can match. */
async function applyFilters(db, m, query, filters, resolved) {
  const wsId = m.workspace_id
  const personIds = [...new Set([filters.person_id, ...resolved.person_ids].filter(Boolean))]
  if (personIds.length) {
    const rows = unwrap(await db.from('document_people').select('document_id').eq('workspace_id', wsId).in('person_id', personIds), 'Filter by person')
    const ids = [...new Set(rows.map((r) => r.document_id))]
    if (!ids.length) return null
    query = query.in('id', ids)
  }
  if (filters.group_id) {
    const ids = await groupDocumentIds(db, wsId, filters.group_id)
    if (!ids.length) return null
    query = query.in('id', ids)
  }
  const type = filters.document_type || resolved.document_type
  if (type) query = query.eq('document_type', type)
  if (filters.tag) {
    let tagQuery = db.from('tags').select('id').eq('workspace_id', wsId)
    tagQuery = isUuid(filters.tag) ? tagQuery.eq('id', filters.tag) : tagQuery.ilike('name', escLike(filters.tag))
    const tagRows = unwrap(await tagQuery, 'Find tag')
    if (!tagRows.length) return null
    const rows = unwrap(await db.from('document_tags').select('document_id').eq('workspace_id', wsId).in('tag_id', tagRows.map((t) => t.id)), 'Filter by tag')
    const ids = [...new Set(rows.map((r) => r.document_id))]
    if (!ids.length) return null
    query = query.in('id', ids)
  }
  if (filters.date_from) query = query.gte('created_at', `${filters.date_from}T00:00:00Z`)
  if (filters.date_to) query = query.lte('created_at', `${filters.date_to}T23:59:59Z`)
  if (resolved.date_range) {
    const { from, to } = resolved.date_range
    query = query.or(`and(issue_date.gte.${from},issue_date.lte.${to}),and(created_at.gte.${from}T00:00:00Z,created_at.lte.${to}T23:59:59Z)`)
  }
  const expiryFrom = filters.expiry_from || resolved.expiry_range?.from
  const expiryTo = filters.expiry_to || resolved.expiry_range?.to
  if (expiryFrom) query = query.gte('expiry_date', expiryFrom)
  if (expiryTo) query = query.lte('expiry_date', expiryTo)
  if (filters.uploaded_by) query = query.eq('created_by', filters.uploaded_by)
  if (filters.file_type) {
    let fq = db.from('document_files').select('document_id').eq('workspace_id', wsId).eq('kind', 'original')
    if (filters.file_type === 'image') fq = fq.like('mime_type', 'image/%')
    else if (filters.file_type === 'pdf') fq = fq.eq('mime_type', 'application/pdf')
    else fq = fq.like('mime_type', 'text/%')
    const rows = unwrap(await fq.limit(5000), 'Filter by file type')
    const ids = [...new Set(rows.map((r) => r.document_id))]
    if (!ids.length) return null
    query = query.in('id', ids)
  }
  return query
}

function hasAnyFilter(filters, resolved) {
  return Boolean(
    filters.person_id || filters.group_id || filters.document_type || filters.tag || filters.date_from || filters.date_to || filters.expiry_from || filters.expiry_to || filters.uploaded_by || filters.file_type ||
      resolved.person_ids.length || resolved.document_type || resolved.date_range || resolved.expiring,
  )
}

/** Vector search over chunks -> ordered document ids + best chunk per document. */
async function vectorSearch(db, wsId, embedding, { documentId = null, limit = 100 } = {}) {
  const res = await db.rpc('search_chunks', { ws: wsId, query_embedding: embedding, lim: limit })
  if (res.error) {
    console.warn('[search] search_chunks failed:', res.error.message)
    return { ids: [], best: new Map(), chunks: [] }
  }
  const chunks = (res.data || []).filter((r) => !documentId || r.document_id === documentId)
  const best = new Map()
  const ids = []
  for (const r of chunks) {
    if (!best.has(r.document_id)) {
      best.set(r.document_id, r)
      ids.push(r.document_id)
    }
  }
  return { ids, best, chunks }
}

async function ftsSearch(db, wsId, q, limit = CANDIDATES) {
  if (!q) return []
  const res = await db.rpc('search_documents_fts', { ws: wsId, q, lim: limit })
  if (res.error) {
    console.warn('[search] search_documents_fts failed:', res.error.message)
    return []
  }
  return res.data || []
}

async function searchNotes(db, m, ftsQuery, limit = 10) {
  if (!ftsQuery) return []
  const q = db
    .from('notes')
    .select('id, workspace_id, title, content_text, color, tags, is_pinned, is_private, created_by, created_at, updated_at')
    .eq('workspace_id', m.workspace_id)
    .is('deleted_at', null)
    .or(`is_private.eq.false,created_by.eq.${m.user_id}`)
    .textSearch('search_text', ftsQuery, { type: 'websearch', config: 'english' })
    .order('updated_at', { ascending: false })
    .limit(limit)
  const res = await q
  if (res.error) {
    console.warn('[search] notes search failed:', res.error.message)
    return []
  }
  return res.data || []
}

/**
 * Core search. `lists` are extra ordered id lists (e.g. perceptual-hash matches) fused with RRF.
 */
export async function runSearch(c, { q = '', filters = {}, embedding = null, limit = 40, extraLists = [], extraBoost = new Map() }) {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const wsId = m.workspace_id
  const rawQ = normalizeQuery(q)
  const resolved = rawQ ? await understandQuery(db, { wsId, userId: user.id, q: rawQ }) : emptyResolved()
  const ftsQuery = resolved.fts_query || rawQ

  const [ftsRows, vec] = await Promise.all([
    ftsSearch(db, wsId, ftsQuery),
    embedding ? vectorSearch(db, wsId, embedding) : Promise.resolve({ ids: [], best: new Map(), chunks: [] }),
  ])
  const ftsById = new Map(ftsRows.map((r, i) => [r.document_id, { ...r, position: i }]))
  const ftsIds = ftsRows.map((r) => r.document_id)

  // candidate documents (visibility + filters in SQL)
  let query = await scopedDocumentsQuery(db, m)
  query = query.is('deleted_at', null)
  query = await applyFilters(db, m, query, filters, resolved)
  let docs = []
  const requireMatch = resolved.terms.length > 0 || resolved.document_numbers.length > 0 || (rawQ && !hasAnyFilter(filters, resolved))
  const matchTerms = [...new Set([rawQ, ...resolved.terms].filter((t) => t && t.length >= 2))].slice(0, 6)
  if (query) {
    const ors = []
    const candidateIds = [...new Set([...ftsIds, ...vec.ids, ...extraLists.flat()])]
    if (candidateIds.length) ors.push(`id.in.(${candidateIds.join(',')})`)
    for (const t of matchTerms) ors.push(`name.ilike.%${escLike(t)}%`)
    for (const n of resolved.document_numbers) ors.push(`document_number.ilike.%${escLike(n)}%`)
    if (requireMatch && !ors.length) query = null
    else if (requireMatch || (ors.length && !hasAnyFilter(filters, resolved))) query = query.or(ors.join(','))
    if (query) docs = unwrap(await query.order('updated_at', { ascending: false }).limit(CANDIDATES), 'Search documents')
  }

  // exact-match list (name contains the query / a term, document number)
  const lower = (s) => String(s || '').toLowerCase()
  const exactIds = docs
    .filter((d) => matchTerms.some((t) => lower(d.name).includes(t)) || resolved.document_numbers.some((n) => lower(d.document_number).includes(n.toLowerCase())))
    .map((d) => d.id)

  const lists = [ftsIds, vec.ids, exactIds, ...extraLists].filter((l) => l.length)
  const fused = rrfFuse(lists, RRF_K)
  const personSet = new Set([...(filters.person_id ? [filters.person_id] : []), ...resolved.person_ids])
  const type = filters.document_type || resolved.document_type

  await enrichDocuments(db, wsId, docs)

  const results = docs.map((document) => {
    const matched = []
    let score = fused.get(document.id) || 0
    const name = lower(document.name)
    if (matchTerms.some((t) => name.includes(t))) {
      matched.push('name')
      if (rawQ && (name === rawQ || name.includes(rawQ))) score += BOOST.name
    }
    const fts = ftsById.get(document.id)
    if (fts) matched.push('text')
    if (vec.best.has(document.id)) matched.push('meaning')
    if (personSet.size && document.people.some((p) => personSet.has(p.id))) {
      matched.push('person')
      score += BOOST.person
    }
    if (resolved.document_numbers.some((n) => lower(document.document_number).includes(n.toLowerCase()))) {
      matched.push('number')
      score += BOOST.number
    }
    if (type && document.document_type === type) matched.push('type')
    if (filters.tag && document.tags.some((t) => t.id === filters.tag || t.name.toLowerCase() === filters.tag.toLowerCase())) matched.push('tag')
    if (extraBoost.has(document.id)) score += extraBoost.get(document.id)
    if (!score) score = 0.001 // filter-only match
    const chunk = vec.best.get(document.id)
    const snippet = (fts?.headline && fts.headline.replace(/<\/?b>/g, '')) || (chunk ? snippetOf(chunk.content, matchTerms) : null) || snippetOf(document.summary, matchTerms)
    return { document, score: Number(score.toFixed(5)), matched: [...new Set(matched)], snippet }
  })
  results.sort((a, b) => b.score - a.score || new Date(b.document.updated_at) - new Date(a.document.updated_at))

  // notes
  const noteHits = rawQ ? await searchNotes(db, m, ftsQuery) : []
  const noteResults = noteHits.map((n, i) => ({
    kind: 'note',
    document: {
      id: n.id,
      workspace_id: n.workspace_id,
      name: n.title || 'Untitled note',
      document_type: 'note',
      kind: 'note',
      summary: snippetOf(n.content_text, matchTerms, 300),
      color: n.color,
      is_pinned: n.is_pinned,
      is_private: n.is_private,
      created_by: n.created_by,
      created_at: n.created_at,
      updated_at: n.updated_at,
      thumbnail_file_id: null,
      people: [],
      tags: (n.tags || []).map((t) => ({ id: null, name: t, color: null })),
    },
    score: Number((1 / (RRF_K + i + 1)).toFixed(5)),
    matched: ['text'],
    snippet: snippetOf(n.content_text, matchTerms) || n.title,
  }))

  const merged = [...results.slice(0, limit), ...noteResults].sort((a, b) => b.score - a.score).slice(0, limit)
  return {
    results: merged,
    resolved: {
      terms: resolved.terms,
      person_ids: resolved.person_ids,
      person_names: resolved.person_names,
      document_type: resolved.document_type,
      date_range: resolved.date_range,
      relation_words: resolved.relation_words,
      document_numbers: resolved.document_numbers,
      expiring: resolved.expiring,
    },
    next_cursor: null,
  }
}

async function rememberRecent(db, m, q) {
  if (!q) return
  try {
    const existing = await db.from('saved_searches').select('id, use_count').eq('workspace_id', m.workspace_id).eq('user_id', m.user_id).eq('kind', 'recent').eq('query', q).maybeSingle()
    if (existing.data) await db.from('saved_searches').update({ use_count: (existing.data.use_count || 0) + 1, last_used_at: new Date().toISOString() }).eq('id', existing.data.id)
    else await db.from('saved_searches').insert({ workspace_id: m.workspace_id, user_id: m.user_id, kind: 'recent', query: q, filters: {}, created_by: m.user_id })
  } catch (err) {
    console.warn('[search] recent search not saved:', err?.message || err)
  }
}

// GET /search?q=&person_id=&...&limit=
search.get('/', async (c) => {
  const { q, limit, ...filters } = parseQuery(c, searchQuery)
  const out = await runSearch(c, { q, filters, limit })
  await rememberRecent(c.get('db'), c.get('membership'), q.trim())
  return c.json(out)
})

// POST /search/hybrid { q, embedding?, filters?, limit? }
search.post('/hybrid', async (c) => {
  const body = await parseJson(c, hybridSearchBody)
  const out = await runSearch(c, { q: body.q, filters: body.filters || {}, embedding: body.embedding || null, limit: body.limit })
  await rememberRecent(c.get('db'), c.get('membership'), body.q.trim())
  return c.json(out)
})

// POST /search/image { perceptual_hash?, text_sample?, embedding? }
search.post('/image', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const body = await parseJson(c, imageSearchBody)
  const extraLists = []
  const extraBoost = new Map()
  if (body.perceptual_hash) {
    const rows = unwrap(
      await db.from('documents').select('id, perceptual_hash').eq('workspace_id', m.workspace_id).is('deleted_at', null).not('perceptual_hash', 'is', null).limit(2000),
      'Load perceptual hashes',
    )
    const hits = rows
      .map((r) => ({ id: r.id, d: hammingDistanceHex(body.perceptual_hash, r.perceptual_hash) }))
      .filter((r) => r.d <= 10)
      .sort((a, b) => a.d - b.d)
    if (hits.length) {
      extraLists.push(hits.map((h) => h.id))
      for (const h of hits) extraBoost.set(h.id, 0.1 * (1 - h.d / 64))
    }
  }
  const sampleQ = body.text_sample ? normalizeQuery(body.text_sample).split(' ').filter((w) => w.length > 2).slice(0, 40).join(' ') : ''
  const out = await runSearch(c, { q: sampleQ, filters: {}, embedding: body.embedding || null, limit: body.limit, extraLists, extraBoost })
  for (const r of out.results) if (extraBoost.has(r.document.id) && !r.matched.includes('meaning')) r.matched.push('meaning')
  return c.json(out)
})

// GET /search/suggest?q=
search.get('/suggest', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const q = normalizeQuery(c.req.query('q') || '').slice(0, 100)
  const like = `%${escLike(q)}%`
  const [people, tags, recent] = await Promise.all([
    q ? db.from('people').select('id, display_name').eq('workspace_id', m.workspace_id).is('deleted_at', null).ilike('display_name', like).order('display_name').limit(5) : { data: [] },
    q ? db.from('tags').select('id, name, color').eq('workspace_id', m.workspace_id).ilike('name', like).order('name').limit(5) : { data: [] },
    db.from('saved_searches').select('query').eq('workspace_id', m.workspace_id).eq('user_id', m.user_id).eq('kind', 'recent').order('last_used_at', { ascending: false }).limit(8),
  ])
  const types = q ? DOCUMENT_TYPES.filter((t) => t.includes(q.replace(/\s+/g, '_')) || t.replace(/_/g, ' ').includes(q)).slice(0, 6) : []
  return c.json({
    people: people.data || [],
    tags: tags.data || [],
    types,
    recent: (recent.data || []).map((r) => r.query).filter((s, i, arr) => s && arr.indexOf(s) === i).slice(0, 5),
  })
})

export default search
