import { HttpError } from './errors.js'
import { base64Decode, base64Encode } from './ids.js'

/**
 * Chaabi recovery wrapping.
 *
 * The browser owns the Vault Key. For email PIN recovery the Worker keeps a
 * second copy wrapped with a per-user AES-256-GCM key that is derived (HKDF)
 * from the VAULT_RECOVERY_SECRET Wrangler secret and the user's id. The raw
 * vault key is only ever in Worker memory during setup and PIN reset; it is
 * never stored or logged in clear.
 *
 * Stored format: "v1.<base64 iv>.<base64 ciphertext>"
 */
const enc = new TextEncoder()
const HKDF_SALT = enc.encode('dastavault/chaabi/recovery/v1')

async function deriveUserKey(env, userId) {
  if (!env.VAULT_RECOVERY_SECRET) throw new HttpError(500, 'Server misconfigured: VAULT_RECOVERY_SECRET missing', 'misconfigured')
  const ikm = await crypto.subtle.importKey('raw', enc.encode(env.VAULT_RECOVERY_SECRET), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: enc.encode(`user:${userId}`) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** @returns {Promise<string>} recovery_wrapped_key */
export async function wrapVaultKey(env, userId, vaultKeyBase64) {
  const raw = base64Decode(vaultKeyBase64)
  if (raw.length !== 32) throw new HttpError(400, 'vault_key must be 32 bytes (base64)', 'bad_request')
  const key = await deriveUserKey(env, userId)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(userId) }, key, raw)
  return `v1.${base64Encode(iv)}.${base64Encode(new Uint8Array(ct))}`
}

/** @returns {Promise<string>} raw vault key, base64 */
export async function unwrapVaultKey(env, userId, wrapped) {
  const [version, ivB64, ctB64] = String(wrapped || '').split('.')
  if (version !== 'v1' || !ivB64 || !ctB64) throw new HttpError(500, 'Recovery key is in an unknown format', 'vault_recovery_corrupt')
  const key = await deriveUserKey(env, userId)
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64Decode(ivB64), additionalData: enc.encode(userId) },
      key,
      base64Decode(ctB64),
    )
    return base64Encode(new Uint8Array(pt))
  } catch {
    throw new HttpError(500, 'Could not unwrap the recovery key (secret rotated?)', 'vault_recovery_failed')
  }
}
