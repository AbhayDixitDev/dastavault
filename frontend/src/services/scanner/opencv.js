/**
 * Lazy loader for OpenCV.js. One shared instance for the whole app.
 *
 *   const cv = await getCv()   // null when it cannot load on this device
 *   await ready()              // rejects when unavailable
 *   isReady()                  // true once loaded
 *
 * The library is ~13 MB. It is loaded on first use from the copy that ships with
 * the app (public/opencv), falling back to a pinned CDN URL (same version as the
 * installed @techstark/opencv-js package).
 *   VITE_OPENCV_URL=<url>     use another URL (e.g. a self-hosted copy in /public)
 *   VITE_OPENCV_BUNDLED=1     bundle the npm package instead (raise the PWA
 *                             precache limit or ignore the chunk in workbox first)
 */
// Same version as the installed @techstark/opencv-js (4.x: runs on older Android WebViews too).
const OPENCV_VERSION = '4.10.0-release.1'

let cv = null
let loading = null
let failed = false

const LOAD_TIMEOUT_MS = 60000
const CDN_URL = `https://cdn.jsdelivr.net/npm/@techstark/opencv-js@${OPENCV_VERSION}/dist/opencv.js`
// A copy ships with the app (scripts/copy-ocr.mjs -> public/opencv/opencv.js), so finding
// the paper edges works offline and without a 10 MB download; the CDN is the fallback.
const LOCAL_URL = `${import.meta.env.BASE_URL || '/'}opencv/opencv.js`

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Accepts the module, a promise of it, or a module whose runtime is still starting. */
async function settle(candidate) {
  let inst = candidate
  // A real Promise (bundled builds) is awaited. The Emscripten module itself is a
  // "thenable" that resolves to itself, so awaiting it never finishes: wait for
  // its runtime instead.
  if (inst instanceof Promise) inst = await inst
  if (inst && !inst.Mat) {
    await new Promise((resolve) => {
      const prev = inst.onRuntimeInitialized
      inst.onRuntimeInitialized = () => { try { prev?.() } catch { /* ignore */ } resolve() }
      const poll = setInterval(() => { if (inst.Mat) { clearInterval(poll); resolve() } }, 50)
    })
  }
  if (!inst || !inst.Mat || typeof inst.matFromImageData !== 'function') throw new Error('unavailable')
  // Handing a thenable to a Promise makes the Promise wait on it, and this one
  // resolves to itself: without this, `await getCv()` never returns.
  if (typeof inst.then === 'function') {
    try { delete inst.then } catch { /* ignore */ }
    if (typeof inst.then === 'function') inst.then = undefined
  }
  return inst
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new Error('no document'))
    const existing = document.querySelector(`script[data-opencv="${url}"]`)
    if (existing) {
      if (existing.dataset.loaded === '1') return resolve()
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('load')), { once: true })
      return
    }
    const s = document.createElement('script')
    s.src = url
    s.async = true
    s.crossOrigin = 'anonymous'
    s.dataset.opencv = url
    s.onload = () => { s.dataset.loaded = '1'; resolve() }
    s.onerror = () => { s.remove(); reject(new Error('load')) }
    document.head.appendChild(s)
  })
}

async function load() {
  if (import.meta.env.VITE_OPENCV_BUNDLED === '1') {
    const mod = await import('@techstark/opencv-js')
    return settle(mod?.default ?? mod)
  }
  const g = typeof window !== 'undefined' ? window : globalThis
  if (g.cv && (g.cv.Mat || typeof g.cv.then === 'function')) return settle(g.cv)
  if (import.meta.env.VITE_OPENCV_URL) {
    await loadScript(import.meta.env.VITE_OPENCV_URL)
  } else {
    try {
      await loadScript(LOCAL_URL)
    } catch {
      await loadScript(CDN_URL)
    }
  }
  if (!g.cv) throw new Error('unavailable')
  return settle(g.cv)
}

export function ready() {
  if (cv) return Promise.resolve(cv)
  if (failed) return Promise.reject(new Error('unavailable'))
  if (!loading) {
    loading = withTimeout(load(), LOAD_TIMEOUT_MS)
      .then((inst) => { cv = inst; return inst })
      .catch((err) => { failed = true; loading = null; throw err })
  }
  return loading
}

/** Resolves with the OpenCV module or null (never rejects). */
export async function getCv() {
  try {
    return await ready()
  } catch {
    return null
  }
}

export function isReady() {
  return !!cv
}

export function isUnavailable() {
  return failed
}

/** Delete every Mat / MatVector in the list, ignoring errors. */
export function deleteAll(list) {
  for (const m of list) {
    try { m?.delete?.() } catch { /* already deleted */ }
  }
  list.length = 0
}
