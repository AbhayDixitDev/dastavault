import { HttpError } from './errors.js'
import { base64Decode, base64Encode } from './ids.js'

/**
 * AI provider keys at rest (ai_provider_keys.encrypted_key + iv).
 *
 * Same construction as the Chaabi recovery wrapping (lib/vaultCrypto.js):
 * AES-256-GCM under a per-user key derived with HKDF-SHA256 from
 * VAULT_RECOVERY_SECRET, but with info = "ai:<userId>" so vault and AI keys
 * never share a key. The plaintext API key only exists in Worker memory while
 * a request needs it and is never logged.
 */
const enc = new TextEncoder()
const dec = new TextDecoder()
const HKDF_SALT = enc.encode('dastavault/chaabi/recovery/v1')

async function deriveAiKey(env, userId) {
  if (!env.VAULT_RECOVERY_SECRET) throw new HttpError(500, 'Server misconfigured: VAULT_RECOVERY_SECRET missing', 'misconfigured')
  const ikm = await crypto.subtle.importKey('raw', enc.encode(env.VAULT_RECOVERY_SECRET), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: enc.encode(`ai:${userId}`) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** @returns {Promise<{ encrypted_key: string, iv: string }>} both base64 */
export async function encryptAiKey(env, userId, apiKey) {
  const key = await deriveAiKey(env, userId)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(userId) }, key, enc.encode(apiKey))
  return { encrypted_key: base64Encode(new Uint8Array(ct)), iv: base64Encode(iv) }
}

/** @returns {Promise<string>} the plaintext API key */
export async function decryptAiKey(env, userId, { encrypted_key, iv }) {
  const key = await deriveAiKey(env, userId)
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64Decode(iv), additionalData: enc.encode(userId) },
      key,
      base64Decode(encrypted_key),
    )
    return dec.decode(pt)
  } catch {
    throw new HttpError(500, 'Could not decrypt the AI key (secret rotated?). Remove it and add it again.', 'ai_key_unreadable')
  }
}
