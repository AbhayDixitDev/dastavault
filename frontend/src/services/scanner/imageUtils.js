/**
 * Small canvas helpers shared by the scanner. Browser only.
 */

export function makeCanvas(width, height) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(width))
  c.height = Math.max(1, Math.round(height))
  return c
}

export function sourceSize(source) {
  if (!source) return { width: 0, height: 0 }
  if (source.videoWidth) return { width: source.videoWidth, height: source.videoHeight }
  if (source.naturalWidth) return { width: source.naturalWidth, height: source.naturalHeight }
  return { width: source.width || 0, height: source.height || 0 }
}

/** Decode a Blob/File into an ImageBitmap (EXIF orientation applied) or an HTMLImageElement. */
export async function loadImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' })
    } catch {
      try { return await createImageBitmap(blob) } catch { /* fall through */ }
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open this image')) }
    img.src = url
  })
}

/** Draw any drawable onto a new canvas, optionally limiting the longest side. */
export function toCanvas(source, maxSide) {
  const { width, height } = sourceSize(source)
  const scale = maxSide && Math.max(width, height) > maxSide ? maxSide / Math.max(width, height) : 1
  const canvas = makeCanvas(width * scale, height * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return { canvas, scale }
}

export function getImageData(canvas) {
  return canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height)
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.92) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save the image'))), type, quality)
    } catch (err) {
      reject(err)
    }
  })
}

export async function blobToCanvas(blob, maxSide) {
  const img = await loadImage(blob)
  const out = toCanvas(img, maxSide)
  if (typeof img.close === 'function') img.close()
  return out
}

export function releaseDrawable(d) {
  try { d?.close?.() } catch { /* ignore */ }
}
