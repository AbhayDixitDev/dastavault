const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function newId() {
  return crypto.randomUUID()
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

/** URL-safe random token (base64url), default 32 bytes of entropy. */
export function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return base64url(buf)
}

/** Uniform 6-digit numeric code (no modulo bias). */
export function randomDigits(length = 6) {
  let out = ''
  const buf = new Uint8Array(length * 2)
  while (out.length < length) {
    crypto.getRandomValues(buf)
    for (const b of buf) {
      if (b < 250 && out.length < length) out += String(b % 10)
    }
  }
  return out
}

export function base64url(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64Encode(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function base64Decode(str) {
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Sanitises a user supplied filename for storing as metadata. Object keys never use it.
 * Strips paths, control chars and reserved characters; caps length; keeps the extension.
 */
export function safeFilename(name, fallback = 'file') {
  if (typeof name !== 'string') return fallback
  let base = name.split(/[\\/]/).pop() || ''
  base = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim()
  base = base.replace(/^\.+/, '')
  if (!base) return fallback
  if (base.length > 180) {
    const dot = base.lastIndexOf('.')
    const ext = dot > 0 ? base.slice(dot).slice(0, 16) : ''
    base = base.slice(0, 180 - ext.length) + ext
  }
  return base
}

/** Lower-case extension (without dot) or '' */
export function extensionOf(filename) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(filename || '')
  return m ? m[1].toLowerCase() : ''
}
