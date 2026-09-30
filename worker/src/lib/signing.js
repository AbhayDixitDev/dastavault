import { HttpError } from './errors.js'

const enc = new TextEncoder()
const keyCache = new Map()

async function hmacKey(secret) {
  let key = keyCache.get(secret)
  if (!key) {
    key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
    keyCache.set(secret, key)
  }
  return key
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function hmacHex(secret, message) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(message))
  return toHex(sig)
}

/** Constant-time string comparison. */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
  return diff === 0
}

export async function sha256Hex(input) {
  const data = typeof input === 'string' ? enc.encode(input) : input
  return toHex(await crypto.subtle.digest('SHA-256', data))
}

function signingSecret(env) {
  if (!env.FILE_URL_SIGNING_SECRET) throw new HttpError(500, 'Server misconfigured: FILE_URL_SIGNING_SECRET missing', 'misconfigured')
  return env.FILE_URL_SIGNING_SECRET
}

/**
 * Signed file URLs: GET /api/files/:fileId?exp=<unix seconds>&sig=<hmac>
 * The signature covers "file:<fileId>:<exp>" so it cannot be replayed for another file.
 */
export const FILE_URL_TTL_SECONDS = 5 * 60

export async function signFileUrl(env, origin, fileId, { ttlSeconds = FILE_URL_TTL_SECONDS, download = false } = {}) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const sig = await hmacHex(signingSecret(env), `file:${fileId}:${exp}`)
  const url = new URL(`/api/files/${fileId}`, origin)
  url.searchParams.set('exp', String(exp))
  url.searchParams.set('sig', sig)
  if (download) url.searchParams.set('download', '1')
  return { url: url.toString(), expires_at: new Date(exp * 1000).toISOString() }
}

export async function verifyFileSignature(env, fileId, exp, sig) {
  const expNum = Number(exp)
  if (!Number.isFinite(expNum) || !sig) return false
  if (expNum < Math.floor(Date.now() / 1000)) return false
  const expected = await hmacHex(signingSecret(env), `file:${fileId}:${expNum}`)
  return timingSafeEqual(expected, String(sig))
}

/**
 * Generic short-lived tokens "<payload-b64url>.<hmac>" used for the vault PIN-reset step.
 */
export async function signToken(secret, payload, ttlSeconds) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds, n: crypto.randomUUID() }
  const b64 = btoa(JSON.stringify(body)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const sig = await hmacHex(secret, `tok:${b64}`)
  return `${b64}.${sig}`
}

export async function verifyToken(secret, token) {
  if (typeof token !== 'string') return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const b64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = await hmacHex(secret, `tok:${b64}`)
  if (!timingSafeEqual(expected, sig)) return null
  try {
    const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)
    const payload = JSON.parse(atob(padded))
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}
