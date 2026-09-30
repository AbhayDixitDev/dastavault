/**
 * Magic-byte sniffing + allowlist. The client's declared type is only a hint;
 * the bytes decide. Returns { mime, ext } or null when the file is not allowed.
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export const ALLOWED_MIME = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
})

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'avif'])

function ascii(bytes, start, len) {
  let s = ''
  for (let i = start; i < start + len && i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return s
}

function startsWith(bytes, sig, offset = 0) {
  if (bytes.length < offset + sig.length) return false
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false
  return true
}

/** Sniffs a binary signature. Returns a mime string or null. */
export function sniffMime(bytes) {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'image/gif'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'
  if (ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf'
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4).toLowerCase()
    if (brand === 'avif') return 'image/avif'
    if (HEIF_BRANDS.has(brand)) return brand.startsWith('hei') || brand.startsWith('hev') ? 'image/heic' : 'image/heif'
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'application/zip'
  return null
}

function looksLikeText(bytes) {
  const n = Math.min(bytes.length, 4096)
  if (n === 0) return false
  let suspicious = 0
  for (let i = 0; i < n; i++) {
    const b = bytes[i]
    if (b === 0) return false
    if (b < 0x09 || (b > 0x0d && b < 0x20)) suspicious++
  }
  return suspicious / n < 0.05
}

/**
 * Decides the final mime type for an upload.
 * @param {Uint8Array} head first bytes of the file (>= 64 bytes recommended)
 * @param {string} declaredMime the client's Content-Type
 * @param {string} ext lower-case extension from the filename
 */
export function detectAllowedType(head, declaredMime = '', ext = '') {
  const declared = String(declaredMime).split(';')[0].trim().toLowerCase()
  const sniffed = sniffMime(head)

  if (sniffed && sniffed !== 'application/zip') {
    return ALLOWED_MIME[sniffed] ? { mime: sniffed, ext: ALLOWED_MIME[sniffed] } : null
  }

  // Office Open XML documents are zip containers; trust the declared type/extension only for those.
  if (sniffed === 'application/zip') {
    if (ext === 'docx' || declared === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' }
    }
    if (ext === 'xlsx' || declared === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' }
    }
    return null
  }

  // No signature: allow plain text formats when the bytes look like text.
  if (looksLikeText(head)) {
    if (ext === 'md' || declared === 'text/markdown') return { mime: 'text/markdown', ext: 'md' }
    if (ext === 'csv' || declared === 'text/csv') return { mime: 'text/csv', ext: 'csv' }
    if (ext === 'txt' || declared === 'text/plain' || declared === '') return { mime: 'text/plain', ext: 'txt' }
  }
  return null
}

export function isImageMime(mime) {
  return typeof mime === 'string' && mime.startsWith('image/')
}
