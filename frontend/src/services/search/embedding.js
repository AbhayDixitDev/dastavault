import { loadOptional, OPTIONAL, withTimeout } from './optional'

const DIMENSION = 384

/**
 * Turns a short text (a search query or a question) into a 384-number vector
 * using the browser embedding provider from the scanner agent.
 * Resolves null when the provider is missing, slow or fails. Never throws.
 */
export async function embedQuery(text, { timeoutMs = 4000 } = {}) {
  const q = (text ?? '').toString().trim()
  if (!q) return null
  try {
    const mod = await loadOptional(OPTIONAL.embedding)
    if (!mod || typeof mod.getEmbeddingProvider !== 'function') return null
    const provider = await withTimeout(Promise.resolve(mod.getEmbeddingProvider()), timeoutMs)
    if (!provider || provider.ok === false || typeof provider.embed !== 'function') return null
    const result = await withTimeout(provider.embed([q]), timeoutMs)
    const vec = Array.isArray(result) ? result[0] : result?.embeddings?.[0] ?? result?.vectors?.[0]
    if (!Array.isArray(vec) && !ArrayBuffer.isView(vec)) return null
    const arr = Array.from(vec, Number)
    const dim = provider.dimension || DIMENSION
    if (arr.length !== dim || arr.some((n) => !Number.isFinite(n))) return null
    return arr
  } catch {
    return null
  }
}

/** True when the embedding module exists in this build (does not mean WASM works). */
export async function isMeaningSearchAvailable() {
  const mod = await loadOptional(OPTIONAL.embedding)
  return Boolean(mod && typeof mod.getEmbeddingProvider === 'function')
}
