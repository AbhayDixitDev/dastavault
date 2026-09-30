/**
 * Loads modules that other agents provide, without breaking the build or the
 * page when they are missing. `import.meta.glob` resolves at build time: a
 * missing file simply produces no loader, so `loadOptional` returns null.
 */
const loaders = import.meta.glob([
  '/src/services/embedding/index.js',
  '/src/services/extraction/index.js',
  '/src/services/ocr/index.js',
  '/src/components/documents/DocumentCard.jsx',
  '/src/components/documents/documentTypes.js',
])

export const OPTIONAL = {
  embedding: '/src/services/embedding/index.js',
  extraction: '/src/services/extraction/index.js',
  ocr: '/src/services/ocr/index.js',
  documentCard: '/src/components/documents/DocumentCard.jsx',
  documentTypes: '/src/components/documents/documentTypes.js',
}

const cache = new Map()

/** Resolves to the module namespace, or null when the file is absent or fails to load. */
export async function loadOptional(path) {
  if (cache.has(path)) return cache.get(path)
  const load = loaders[path]
  if (!load) {
    cache.set(path, null)
    return null
  }
  const p = load().catch(() => null)
  cache.set(path, p)
  return p
}

export function hasOptional(path) {
  return Boolean(loaders[path])
}

/** Promise with a timeout; resolves `fallback` instead of rejecting when time runs out. */
export function withTimeout(promise, ms, fallback = null) {
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  return Promise.race([Promise.resolve(promise).catch(() => fallback), timeout]).finally(() => clearTimeout(timer))
}
