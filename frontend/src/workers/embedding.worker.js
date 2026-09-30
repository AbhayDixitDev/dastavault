/**
 * Sentence embeddings in a Web Worker with Transformers.js.
 * Model: Xenova/all-MiniLM-L6-v2 (q8), mean pooled + normalised, 384 dimensions.
 *
 * Message in:  { id, type: 'warmup' } | { id, type: 'embed', texts: string[] }
 * Message out: { id, ok: true, vectors?: number[][] } | { id, ok: false, error }
 */

const MODEL = 'Xenova/all-MiniLM-L6-v2'
let extractorPromise = null

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.allowLocalModels = false
      env.useBrowserCache = true
      return pipeline('feature-extraction', MODEL, { dtype: 'q8' })
    })().catch((err) => { extractorPromise = null; throw err })
  }
  return extractorPromise
}

async function embed(texts) {
  const extractor = await getExtractor()
  const out = []
  const BATCH = 8
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH).map((t) => String(t ?? '').slice(0, 2000) || ' ')
    const tensor = await extractor(batch, { pooling: 'mean', normalize: true })
    const data = tensor.data
    const dim = tensor.dims[tensor.dims.length - 1]
    for (let j = 0; j < batch.length; j++) out.push(Array.from(data.slice(j * dim, (j + 1) * dim)))
    tensor.dispose?.()
  }
  return out
}

self.onmessage = async (e) => {
  const { id, type, texts } = e.data || {}
  try {
    if (type === 'warmup') {
      await getExtractor()
      self.postMessage({ id, ok: true })
    } else if (type === 'embed') {
      const vectors = await embed(Array.isArray(texts) ? texts : [])
      self.postMessage({ id, ok: true, vectors })
    } else {
      self.postMessage({ id, ok: false, error: 'unknown message' })
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || 'failed' })
  }
}
