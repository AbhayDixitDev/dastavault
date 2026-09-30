/**
 * Chaabi client-side cryptography. Web Crypto only, nothing custom.
 *
 * PIN Key      = PBKDF2-SHA256(pin, pin_salt, 600k)          -> AES-256-GCM key (wraps the vault key)
 * PIN Verifier = PBKDF2-SHA256(pin, pin_verifier_salt, 600k) -> 32 raw bytes, base64 (sent to the server)
 * Vault Key    = random 32 bytes; every item is AES-GCM(vaultKey, iv, JSON)
 *
 * All binary values travel as base64 strings.
 */

export const DEFAULT_ITERATIONS = 600000
export const KDF_NAME = 'PBKDF2-SHA256'

const subtle = globalThis.crypto?.subtle
const enc = new TextEncoder()
const dec = new TextDecoder()

/* ---------- base64 helpers ---------- */

export function bytesToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (let i = 0; i < arr.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

export function base64ToBytes(b64) {
  if (typeof b64 !== 'string') return new Uint8Array(0)
  try {
    const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return new Uint8Array(0)
  }
}

export function randomBytes(n = 32) {
  const b = new Uint8Array(n)
  globalThis.crypto.getRandomValues(b)
  return bytesToBase64(b)
}

/* ---------- key derivation ---------- */

async function pbkdf2Bits(pin, saltB64, iterations) {
  const base = await subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits'])
  return subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: base64ToBytes(saltB64), iterations },
    base,
    256,
  )
}

/** PIN -> AES-GCM key used only to wrap/unwrap the vault key. Never extractable. */
export async function deriveKey(pin, saltB64, iterations = DEFAULT_ITERATIONS) {
  const bits = await pbkdf2Bits(pin, saltB64, iterations)
  return subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** PIN -> base64 verifier the server stores to count wrong attempts. */
export async function makeVerifier(pin, verifierSaltB64, iterations = DEFAULT_ITERATIONS) {
  const bits = await pbkdf2Bits(pin, verifierSaltB64, iterations)
  return bytesToBase64(new Uint8Array(bits))
}

/** Fresh random vault key as base64 raw bytes (used once at setup and by the reset flow). */
export function generateVaultKeyB64() {
  return randomBytes(32)
}

/** Raw base64 vault key -> CryptoKey for item encryption. */
export async function importVaultKey(rawB64) {
  // extractable so the PIN-change flow can re-wrap it; it still never leaves memory otherwise
  return subtle.importKey('raw', base64ToBytes(rawB64), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
}

/** CryptoKey -> raw base64 (only used to re-wrap the key when the PIN changes). */
export async function exportVaultKeyB64(key) {
  const raw = await subtle.exportKey('raw', key)
  return bytesToBase64(new Uint8Array(raw))
}

/* ---------- wrapping the vault key with the PIN key ---------- */

/** Encrypts the raw vault key (base64) with the PIN key. Returns { ciphertext, iv } (both base64). */
export async function wrapKey(pinKey, vaultKeyRawB64) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, pinKey, base64ToBytes(vaultKeyRawB64))
  return { ciphertext: bytesToBase64(new Uint8Array(ct)), iv: bytesToBase64(iv) }
}

/** Decrypts the wrapped vault key and returns an AES-GCM CryptoKey. Throws on a wrong PIN (GCM tag fails). */
export async function unwrapKey(pinKey, ciphertextB64, ivB64) {
  const raw = await subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(ivB64) }, pinKey, base64ToBytes(ciphertextB64))
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
}

/* ---------- item payloads ---------- */

/** Encrypts any JSON-able object. Returns { encrypted_blob, iv } (base64). */
export async function encryptJson(vaultKey, obj) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, vaultKey, enc.encode(JSON.stringify(obj ?? {})))
  return { encrypted_blob: bytesToBase64(new Uint8Array(ct)), iv: bytesToBase64(iv) }
}

/** Decrypts a payload made by encryptJson. Returns the object, or null when it cannot be read. */
export async function decryptJson(vaultKey, encryptedBlobB64, ivB64) {
  try {
    const pt = await subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(ivB64) },
      vaultKey,
      base64ToBytes(encryptedBlobB64),
    )
    return JSON.parse(dec.decode(pt))
  } catch {
    return null
  }
}

/* ---------- verifier salt ----------
 * GET /api/vault does not return pin_verifier_salt, so the client needs a salt it can
 * recompute on every device: SHA-256('chaabi-verifier-v1:' + userId). Salts are not
 * secret; it is still different from pin_salt (random), which is what matters.
 * If the server ever returns `pin_verifier_salt`, callers should prefer that value.
 */
export async function deterministicVerifierSalt(userId) {
  const digest = await subtle.digest('SHA-256', enc.encode(`chaabi-verifier-v1:${userId || 'anonymous'}`))
  return bytesToBase64(new Uint8Array(digest))
}

export async function verifierSaltFor(userId, vault) {
  return vault?.pin_verifier_salt || deterministicVerifierSalt(userId)
}

/* ---------- PIN material for setup / change / reset ---------- */

/**
 * Builds every field the server needs for a new PIN. `vaultKeyRawB64` is the raw
 * vault key (from setup, or returned by the forgot-PIN verify step).
 * Returns { fields, vaultKey } where fields matches the Worker's kdfFields.
 */
export async function buildPinMaterial(pin, vaultKeyRawB64, iterations = DEFAULT_ITERATIONS, { verifierSalt } = {}) {
  const pin_salt = randomBytes(32)
  const pin_verifier_salt = verifierSalt || randomBytes(32)
  const [pinKey, pin_verifier_hash] = await Promise.all([
    deriveKey(pin, pin_salt, iterations),
    makeVerifier(pin, pin_verifier_salt, iterations),
  ])
  const wrapped = await wrapKey(pinKey, vaultKeyRawB64)
  const vaultKey = await importVaultKey(vaultKeyRawB64)
  return {
    vaultKey,
    fields: {
      pin_salt,
      pin_verifier_salt,
      pin_verifier_hash,
      kdf: KDF_NAME,
      kdf_iterations: iterations,
      pin_wrapped_key: wrapped.ciphertext,
      wrap_iv: wrapped.iv,
      pin_length: String(pin).length,
    },
  }
}

/* ---------- password generator and strength ---------- */

const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/'
const AMBIGUOUS = /[O0Il1|`'"]/g

function pick(chars) {
  const arr = new Uint32Array(1)
  globalThis.crypto.getRandomValues(arr)
  return chars[arr[0] % chars.length]
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const arr = new Uint32Array(1)
    globalThis.crypto.getRandomValues(arr)
    const j = arr[0] % (i + 1)
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

/**
 * generatePassword({ length = 16, symbols = true, numbers = true, uppercase = true, readable = false })
 * `readable` drops look-alike characters (O 0 I l 1).
 */
export function generatePassword({ length = 16, symbols = true, numbers = true, uppercase = true, readable = false } = {}) {
  const len = Math.max(6, Math.min(64, Number(length) || 16))
  const clean = (s) => (readable ? s.replace(AMBIGUOUS, '') : s)
  const sets = [clean(LOWER)]
  if (uppercase) sets.push(clean(UPPER))
  if (numbers) sets.push(clean(DIGITS))
  if (symbols) sets.push(clean(SYMBOLS))
  const all = sets.join('')
  const out = sets.map((s) => pick(s))
  while (out.length < len) out.push(pick(all))
  return shuffle(out).join('')
}

export const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong']

/** Rough strength score 0..4 with a plain label. */
export function passwordStrength(pw = '') {
  const s = String(pw || '')
  if (!s) return { score: 0, label: STRENGTH_LABELS[0] }
  let pool = 0
  if (/[a-z]/.test(s)) pool += 26
  if (/[A-Z]/.test(s)) pool += 26
  if (/\d/.test(s)) pool += 10
  if (/[^A-Za-z0-9]/.test(s)) pool += 32
  const entropy = s.length * Math.log2(pool || 1)
  let score = 0
  if (entropy >= 28) score = 1
  if (entropy >= 40) score = 2
  if (entropy >= 60) score = 3
  if (entropy >= 80) score = 4
  // common patterns knock a level off
  if (/^(.)\1+$/.test(s) || /^(1234|abcd|qwer|pass|0000)/i.test(s) || /^\d+$/.test(s) && s.length < 10) score = Math.max(0, score - 1)
  if (s.length < 8) score = Math.min(score, 1)
  return { score, label: STRENGTH_LABELS[score] }
}
