/**
 * Small file helpers used by upload, viewer and the processing pipeline.
 * Every function is safe to call with odd input: it returns a sensible fallback
 * instead of throwing where that makes sense.
 */
import imageCompression from 'browser-image-compression'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/bmp', 'image/tiff']
const TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'json', 'html', 'htm']
const DOCX_EXT = ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'odt', 'ods']

export const ACCEPTED_UPLOAD_TYPES =
  'image/*,application/pdf,.pdf,.txt,.md,.csv,.docx,.xlsx,.doc,.xls,text/plain,text/markdown,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/** File extension in lower case, without the dot. */
export function extensionOf(name = '') {
  const m = String(name).match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toLowerCase() : ''
}

/** 'image' | 'pdf' | 'text' | 'docx' | 'other' */
export function fileKind(file) {
  if (!file) return 'other'
  const type = (file.type || file.mime_type || '').toLowerCase()
  const ext = extensionOf(file.name || file.original_filename || '')
  if (type.startsWith('image/') || IMAGE_TYPES.includes(type) || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'bmp'].includes(ext)) return 'image'
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (type.startsWith('text/') || TEXT_EXT.includes(ext)) return 'text'
  if (type.includes('officedocument') || type.includes('msword') || type.includes('ms-excel') || DOCX_EXT.includes(ext)) return 'docx'
  return 'other'
}

/** SHA-256 of a Blob as lower-case hex. Returns '' when hashing is not possible. */
export async function sha256Hex(blob) {
  try {
    if (!blob) return ''
    const buffer = await blob.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return ''
  }
}

/** Loads a Blob into an HTMLImageElement (or ImageBitmap when available). */
export async function loadImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob)
    } catch {
      /* fall through to <img> */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read this image.'))
    }
    img.src = url
  })
}

function canvasToBlob(canvas, type = 'image/webp', quality = 0.82) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make a preview.'))), type, quality)
  })
}

/**
 * Makes a small WebP preview (longest side = maxSize) from a Blob or a canvas.
 * Returns null when a preview cannot be made (for example a broken image).
 */
export async function makeThumbnail(source, { maxSize = 512, type = 'image/webp', quality = 0.82 } = {}) {
  try {
    let width, height, draw
    if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
      width = source.width
      height = source.height
      draw = (ctx, w, h) => ctx.drawImage(source, 0, 0, w, h)
    } else {
      const img = await loadImage(source)
      width = img.width ?? img.naturalWidth
      height = img.height ?? img.naturalHeight
      draw = (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h)
    }
    if (!width || !height) return null
    const scale = Math.min(1, maxSize / Math.max(width, height))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    draw(ctx, w, h)
    return await canvasToBlob(canvas, type, quality)
  } catch {
    return null
  }
}

/**
 * Shrinks a photo so uploads are quick. Returns the original file when
 * compression is not needed or fails.
 */
export async function compressImage(file, { maxSizeMB = 1.5, maxWidthOrHeight = 2200, onProgress } = {}) {
  try {
    if (!file || fileKind(file) !== 'image') return file
    if (file.type === 'image/gif') return file
    if (file.size <= maxSizeMB * 1024 * 1024 * 0.6) return file
    const out = await imageCompression(file, {
      maxSizeMB,
      maxWidthOrHeight,
      useWebWorker: true,
      initialQuality: 0.85,
      onProgress: (p) => onProgress?.(p / 100),
    })
    if (!out || out.size >= file.size) return file
    return new File([out], file.name, { type: out.type || file.type, lastModified: file.lastModified })
  } catch {
    return file
  }
}

/** "IMG_2024-01-02_scan.jpg" -> "IMG 2024-01-02 scan" */
export function cleanFileName(name = '') {
  const base = String(name).replace(/\.[a-z0-9]+$/i, '')
  return base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Document'
}

export function formatBytes(bytes = 0) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`
  const units = ['KB', 'MB', 'GB']
  let i = -1
  let n = bytes
  do {
    n /= 1024
    i++
  } while (n >= 1024 && i < units.length - 1)
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`
}

/** Plain words for a file kind, for labels. */
export function fileKindLabel(kind) {
  return { image: 'Photo', pdf: 'PDF', text: 'Text', docx: 'Office file', other: 'File' }[kind] || 'File'
}

/** Reads a text-like file as a string; '' when it cannot be read. */
export async function readTextFile(file) {
  try {
    return await file.text()
  } catch {
    return ''
  }
}

/** Random UUID with a fallback for older browsers. */
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/** Picks the best thumbnail-like file from a document's files list. */
export function pickThumbnailFile(files = []) {
  if (!Array.isArray(files) || !files.length) return null
  const byKind = (k) => files.filter((f) => f.kind === k).sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0))
  return (
    byKind('thumbnail')[0] ||
    byKind('processed').find((f) => (f.mime_type || '').startsWith('image/')) ||
    byKind('original').find((f) => (f.mime_type || '').startsWith('image/')) ||
    null
  )
}
