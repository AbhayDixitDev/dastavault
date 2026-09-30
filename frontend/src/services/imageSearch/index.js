import { api } from '@/services/api/client'
import { loadOptional, OPTIONAL, withTimeout } from '@/services/search/optional'

/**
 * Image search: given a photo, work out its perceptual hash and a short text
 * sample in the browser, then ask the Worker for documents that look alike.
 * Every step is best effort; nothing here throws.
 */

const OCR_TIMEOUT_MS = 8000
const HASH_TIMEOUT_MS = 5000
const TEXT_SAMPLE_MAX = 600

/** Draws the image to a tiny greyscale canvas and returns 64 bits as 16 hex chars (dHash). */
export async function dHashHex(blob) {
  try {
    const bitmap = await createImageBitmap(blob)
    const w = 9
    const h = 8
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    const { data } = ctx.getImageData(0, 0, w, h)
    const grey = new Array(w * h)
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      grey[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
    }
    let bits = ''
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w - 1; x++) {
        bits += grey[y * w + x] < grey[y * w + x + 1] ? '1' : '0'
      }
    }
    let hex = ''
    for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
    return hex
  } catch {
    return null
  }
}

async function computeHash(file) {
  const mod = await loadOptional(OPTIONAL.extraction)
  if (mod && typeof mod.perceptualHash === 'function') {
    const h = await withTimeout(mod.perceptualHash(file), HASH_TIMEOUT_MS)
    if (typeof h === 'string' && h.length >= 8) return h
  }
  return withTimeout(dHashHex(file), HASH_TIMEOUT_MS)
}

async function computeTextSample(file, onStatus) {
  const mod = await loadOptional(OPTIONAL.ocr)
  if (!mod || typeof mod.readText !== 'function') return ''
  onStatus?.('Reading text from your photo...')
  const res = await withTimeout(mod.readText(file, { lang: 'eng' }), OCR_TIMEOUT_MS)
  const text = typeof res === 'string' ? res : res?.text
  if (!text) return ''
  return text.replace(/\s+/g, ' ').trim().slice(0, TEXT_SAMPLE_MAX)
}

/**
 * Prepares the body for POST /search/image: { perceptual_hash, text_sample }.
 * `onStatus` receives short progress sentences for the UI.
 */
export async function prepareImageQuery(file, { onStatus } = {}) {
  if (!file) return { ok: false, error: 'Pick a photo first.' }
  const isImage = (file.type || '').startsWith('image/')
  if (!isImage) return { ok: false, error: 'Please choose a photo (JPG, PNG or WEBP).' }
  onStatus?.('Looking at your photo...')
  const [perceptual_hash, text_sample] = await Promise.all([computeHash(file), computeTextSample(file, onStatus)])
  if (!perceptual_hash && !text_sample) return { ok: false, error: 'Could not read this photo. Try a clearer one.' }
  return { ok: true, perceptual_hash: perceptual_hash || undefined, text_sample: text_sample || undefined }
}

/**
 * Full flow outside React: prepare, then POST /workspaces/:ws/search/image.
 * Resolves { ok, results, resolved, error? }.
 */
export async function searchByImage(file, { workspaceId, onStatus } = {}) {
  const prep = await prepareImageQuery(file, { onStatus })
  if (!prep.ok) return { ok: false, results: [], resolved: {}, error: prep.error }
  try {
    onStatus?.('Finding similar documents...')
    const res = await api.post(`/workspaces/${workspaceId}/search/image`, {
      perceptual_hash: prep.perceptual_hash,
      text_sample: prep.text_sample,
    })
    return { ok: true, results: res?.results ?? [], resolved: res?.resolved ?? {} }
  } catch (err) {
    return { ok: false, results: [], resolved: {}, error: err?.message || 'Image search did not work. Try again.' }
  }
}
