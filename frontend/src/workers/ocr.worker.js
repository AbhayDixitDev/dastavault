/**
 * Prepares page images for text reading, off the main thread:
 * decodes the image, converts to grayscale, stretches contrast and upscales
 * small images so the reader gets clear letters. Tesseract itself runs in its
 * own worker (see src/services/ocr/index.js).
 *
 * Message in:  { id, blob, maxSide? }
 * Message out: { id, ok, blob?, width?, height?, error? }
 */

const MIN_SIDE = 1200
const MAX_SIDE = 2800

function luminance(d, i) {
  return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
}

async function prepare(blob, maxSide = MAX_SIDE) {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') return null
  const bitmap = await createImageBitmap(blob)
  let { width, height } = bitmap
  const longest = Math.max(width, height)
  let scale = 1
  if (longest < MIN_SIDE) scale = Math.min(2, MIN_SIDE / longest)
  if (longest * scale > maxSide) scale = maxSide / longest
  width = Math.max(1, Math.round(width * scale))
  height = Math.max(1, Math.round(height * scale))
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const imageData = ctx.getImageData(0, 0, width, height)
  const { data } = imageData
  const hist = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 4) hist[luminance(data, i) | 0]++
  const n = width * height
  let lo = 0
  let hi = 255
  let acc = 0
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.005) { lo = i; break } }
  acc = 0
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.005) { hi = i; break } }
  const k = hi - lo > 20 ? 255 / (hi - lo) : 1
  const off = hi - lo > 20 ? lo : 0
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.max(0, Math.min(255, (luminance(data, i) - off) * k))
    data[i] = data[i + 1] = data[i + 2] = v
    data[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const out = await canvas.convertToBlob({ type: 'image/png' })
  return { blob: out, width, height }
}

self.onmessage = async (e) => {
  const { id, blob, maxSide } = e.data || {}
  try {
    const result = await prepare(blob, maxSide)
    if (!result) self.postMessage({ id, ok: false, error: 'unsupported' })
    else self.postMessage({ id, ok: true, ...result })
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || 'failed' })
  }
}
