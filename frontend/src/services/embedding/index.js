/**
 * Embedding providers (contract section 10).
 *
 *   getEmbeddingProvider() -> { name, version: '1', dimension: 384, embed(texts), warmup() }
 *
 * embed() resolves with number[][] on success or { ok: false, error } when the
 * model cannot run on this device (no WASM, worker failure, offline first run).
 * Provider chosen via localStorage 'dv.embeddingProvider' (default 'local').
 */

export const EMBEDDING_DIMENSION = 384
const PROVIDER_KEY = 'dv.embeddingProvider'

/* ------------------------------------------------ local browser */

class LocalBrowserEmbeddingProvider {
  name = 'Xenova/all-MiniLM-L6-v2'
  version = '1'
  dimension = EMBEDDING_DIMENSION
  #worker = null
  #seq = 0
  #pending = new Map()
  #broken = false

  #getWorker() {
    if (this.#worker) return this.#worker
    if (this.#broken) return null
    if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') { this.#broken = true; return null }
    try {
      const w = new Worker(new URL('../../workers/embedding.worker.js', import.meta.url), { type: 'module' })
      w.onmessage = (e) => {
        const { id } = e.data || {}
        const p = this.#pending.get(id)
        if (p) { this.#pending.delete(id); p.resolve(e.data) }
      }
      w.onerror = () => {
        for (const p of this.#pending.values()) p.resolve({ ok: false, error: 'worker' })
        this.#pending.clear()
        try { w.terminate() } catch { /* ignore */ }
        this.#worker = null
        this.#broken = true
      }
      this.#worker = w
      return w
    } catch {
      this.#broken = true
      return null
    }
  }

  #send(message, timeoutMs) {
    const w = this.#getWorker()
    if (!w) return Promise.resolve({ ok: false, error: 'unavailable' })
    const id = ++this.#seq
    return new Promise((resolve) => {
      this.#pending.set(id, { resolve })
      try {
        w.postMessage({ id, ...message })
      } catch (err) {
        this.#pending.delete(id)
        resolve({ ok: false, error: err?.message || 'post' })
        return
      }
      setTimeout(() => {
        if (this.#pending.has(id)) { this.#pending.delete(id); resolve({ ok: false, error: 'timeout' }) }
      }, timeoutMs)
    })
  }

  async warmup() {
    const r = await this.#send({ type: 'warmup' }, 180000)
    return { ok: !!r?.ok, error: r?.error }
  }

  /** @returns {Promise<number[][] | { ok: false, error }>} */
  async embed(texts) {
    const list = Array.isArray(texts) ? texts.map((t) => String(t ?? '')) : []
    if (!list.length) return []
    const r = await this.#send({ type: 'embed', texts: list }, 180000 + list.length * 4000)
    if (!r?.ok || !Array.isArray(r.vectors)) return { ok: false, error: r?.error || 'failed' }
    if (r.vectors.some((v) => !Array.isArray(v) || v.length !== this.dimension)) return { ok: false, error: 'dimension' }
    return r.vectors
  }

  terminate() {
    try { this.#worker?.terminate() } catch { /* ignore */ }
    this.#worker = null
  }
}

/* ------------------------------------------------ placeholders */

function notConfigured(name) {
  return {
    name,
    version: '1',
    dimension: EMBEDDING_DIMENSION,
    async warmup() { return { ok: false, error: 'not configured' } },
    async embed() { return { ok: false, error: 'not configured' } },
  }
}

const registry = {
  local: () => new LocalBrowserEmbeddingProvider(),
  openai: () => notConfigured('openai'),
  gemini: () => notConfigured('gemini'),
  huggingface: () => notConfigured('huggingface'),
  selfhosted: () => notConfigured('selfhosted'),
}

const instances = new Map()

export function listEmbeddingProviders() {
  return Object.keys(registry)
}

export function getSelectedProviderKey() {
  try {
    const v = localStorage.getItem(PROVIDER_KEY)
    return v && registry[v] ? v : 'local'
  } catch {
    return 'local'
  }
}

export function setSelectedProviderKey(key) {
  try { localStorage.setItem(PROVIDER_KEY, registry[key] ? key : 'local') } catch { /* ignore */ }
}

export function getEmbeddingProvider(key = getSelectedProviderKey()) {
  const k = registry[key] ? key : 'local'
  if (!instances.has(k)) instances.set(k, registry[k]())
  return instances.get(k)
}

/** True when the result of embed() is a list of vectors. */
export function isEmbeddingResult(r) {
  return Array.isArray(r)
}
