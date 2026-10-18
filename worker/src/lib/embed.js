/**
 * Embeddings for "search by meaning", made here with Cloudflare Workers AI
 * (the AI binding: free tier, no key). Earlier the app made them on the
 * phone, which failed or timed out on many phones, so documents and queries
 * often had none.
 *
 *   embedTexts(env, texts) -> number[][] | null
 *   embedQuery(env, q)     -> number[] | null
 *   reembedStale(env, db, { limit }) -> { done, left }
 *
 * bge-small-en-v1.5 gives 384 numbers, the size of document_chunks.embedding.
 * Vectors of another model are not comparable, so chunks made by the phone's
 * model are made again here (reembedStale, from the cron and after deploys).
 */
export const EMBED_MODEL = '@cf/baai/bge-small-en-v1.5'
export const EMBED_VERSION = '1'
const BATCH = 50
// bge models find passages best when the query says what it is for.
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '

export async function embedTexts(env, texts) {
  if (!env?.AI || !texts?.length) return null
  const out = []
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH).map((t) => String(t || ' ').slice(0, 2000))
    const res = await env.AI.run(EMBED_MODEL, { text: batch })
    if (!Array.isArray(res?.data) || res.data.length !== batch.length) throw new Error('embedding: unexpected reply')
    out.push(...res.data)
  }
  return out
}

export async function embedQuery(env, q) {
  const text = String(q || '').trim()
  if (!text) return null
  try {
    const [vector] = (await embedTexts(env, [QUERY_PREFIX + text])) || []
    return vector || null
  } catch (err) {
    console.warn('[embed] query failed:', err?.message || err)
    return null
  }
}

/** Makes again the vectors of chunks embedded by another model (or none), oldest first. */
export async function reembedStale(env, db, { limit = 300 } = {}) {
  if (!env?.AI) return { done: 0, left: null }
  const { data, error } = await db
    .from('document_chunks')
    .select('id, content')
    .or(`embedding_model.neq.${EMBED_MODEL},embedding.is.null`)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`load chunks: ${error.message}`)
  if (!data?.length) return { done: 0, left: 0 }
  const vectors = await embedTexts(env, data.map((r) => r.content))
  let done = 0
  for (let i = 0; i < data.length; i += 20) {
    const part = data.slice(i, i + 20)
    const results = await Promise.all(part.map((r, j) => db.from('document_chunks').update({ embedding: vectors[i + j], embedding_model: EMBED_MODEL, embedding_version: EMBED_VERSION }).eq('id', r.id)))
    done += results.filter((r) => !r.error).length
  }
  return { done, left: data.length === limit ? null : 0 }
}
