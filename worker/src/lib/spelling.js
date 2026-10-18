import { DOCUMENT_TYPES, TYPE_WORDS, normalizeQuery } from './queryUnderstanding.js'

/**
 * Typos in a search ("cobtact" for "contract"): words of the query that are
 * not known in the workspace are matched against the words that are (document
 * names and types, organisations, people, tags). The corrected query is
 * searched as well as the typed one, by keywords and by meaning.
 */

const VOCAB_TTL_MS = 5 * 60 * 1000
const vocabCache = new Map() // workspace id -> { at, words: Set }

const BASE_WORDS = new Set([...DOCUMENT_TYPES.flatMap((t) => t.split('_')), ...Object.keys(TYPE_WORDS)].filter((w) => w.length >= 3))

const wordsOf = (text) => normalizeQuery(text).split(/[\s_-]+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w))

async function workspaceWords(db, wsId) {
  const cached = vocabCache.get(wsId)
  if (cached && Date.now() - cached.at < VOCAB_TTL_MS) return cached.words
  const [docs, people, tags] = await Promise.all([
    db.from('documents').select('name, organisation').eq('workspace_id', wsId).is('deleted_at', null).limit(3000),
    db.from('people').select('display_name').eq('workspace_id', wsId).is('deleted_at', null).limit(1000),
    db.from('tags').select('name').eq('workspace_id', wsId).limit(1000),
  ])
  const words = new Set(BASE_WORDS)
  for (const d of docs.data || []) for (const w of [...wordsOf(d.name), ...wordsOf(d.organisation)]) words.add(w)
  for (const p of people.data || []) for (const w of wordsOf(p.display_name)) words.add(w)
  for (const t of tags.data || []) for (const w of wordsOf(t.name)) words.add(w)
  vocabCache.set(wsId, { at: Date.now(), words })
  return words
}

/** Edit distance with swaps of neighbours (optimal string alignment), stopping above `max`. */
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev2 = null
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      row.push(v)
      if (v < best) best = v
    }
    if (best > max) return max + 1
    prev2 = prev
    prev = row
  }
  return prev[b.length]
}

/** Known words close to `word`, closest first (at most 3); empty when it is known or nothing is close. */
export function closeWords(word, words, minLength = 4) {
  if (word.length < minLength || /\d/.test(word) || words.has(word)) return []
  const max = word.length >= 6 ? 2 : 1
  const found = []
  for (const w of words) {
    if (Math.abs(w.length - word.length) > max) continue
    const d = editDistance(word, w, max)
    if (d <= max) found.push({ w, d, same: w[0] === word[0] ? 0 : 1 })
  }
  return found
    .sort((a, b) => a.d - b.d || a.same - b.same || a.w.length - b.w.length)
    .slice(0, 3)
    .map((f) => f.w)
}

/**
 * What the query may have meant: up to 3 corrected queries (the k-th uses
 * the k-th closest word for every typo) and all the words found. Null when
 * there is nothing to correct.
 */
export function correctWith(q, words, { minLength = 4 } = {}) {
  const parts = normalizeQuery(q).split(' ').filter(Boolean)
  const options = parts.map((p) => closeWords(p, words, minLength))
  const found = options.flat()
  if (!found.length) return null
  const n = Math.max(...options.map((o) => o.length))
  const queries = Array.from({ length: n }, (_, k) => parts.map((p, i) => options[i][Math.min(k, options[i].length - 1)] ?? p).join(' '))
  return { queries: [...new Set(queries)], words: [...new Set(found)] }
}

/** See [correctWith]; `minLength` skips shorter words (questions have many small ones). */
export async function correctQuery(db, wsId, q, options = {}) {
  if (!normalizeQuery(q)) return null
  try {
    return correctWith(q, await workspaceWords(db, wsId), options)
  } catch (err) {
    console.warn('[search] spelling check failed:', err?.message || err)
    return null
  }
}
