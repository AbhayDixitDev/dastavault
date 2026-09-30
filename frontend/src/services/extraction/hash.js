/**
 * Perceptual hash (dHash 9x8 on grayscale -> 64-bit hex) and Hamming distance.
 * hammingDistance is pure; perceptualHash needs a canvas (browser only).
 */

export function hammingDistance(a, b) {
  try {
    const ha = String(a || '').toLowerCase().padStart(16, '0')
    const hb = String(b || '').toLowerCase().padStart(16, '0')
    if (!/^[0-9a-f]{16}$/.test(ha) || !/^[0-9a-f]{16}$/.test(hb)) return 64
    let d = 0
    for (let i = 0; i < 16; i++) {
      let x = parseInt(ha[i], 16) ^ parseInt(hb[i], 16)
      while (x) { d += x & 1; x >>= 1 }
    }
    return d
  } catch {
    return 64
  }
}

/** dHash over a 9x8 grayscale grid given as a flat array of 72 luminance values. */
export function dHashFromGray(gray, width = 9, height = 8) {
  let hex = ''
  let nibble = 0
  let bits = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const bit = gray[y * width + x] < gray[y * width + x + 1] ? 1 : 0
      nibble = (nibble << 1) | bit
      bits++
      if (bits === 4) { hex += nibble.toString(16); nibble = 0; bits = 0 }
    }
  }
  return hex.padStart(16, '0')
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  return null
}

async function toDrawable(source) {
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) return source
  if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) return source
  if (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas) return source
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) return source
  if (typeof createImageBitmap === 'function') return createImageBitmap(source)
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')) }
    img.src = url
  })
}

/** perceptualHash(imageBlobOrCanvas) -> Promise<string> (16 hex chars). Empty string on failure. */
export async function perceptualHash(source) {
  try {
    const canvas = makeCanvas(9, 8)
    if (!canvas) return ''
    const drawable = await toDrawable(source)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(drawable, 0, 0, 9, 8)
    const { data } = ctx.getImageData(0, 0, 9, 8)
    const gray = new Array(72)
    for (let i = 0; i < 72; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    if (drawable !== source && typeof drawable.close === 'function') drawable.close()
    return dHashFromGray(gray)
  } catch {
    return ''
  }
}
