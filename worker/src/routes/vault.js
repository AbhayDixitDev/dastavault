import { Hono } from 'hono'
import { requireAuth } from '../lib/auth.js'
import { unwrap, notFound, badRequest, conflict, forbidden, locked, unauthorized, HttpError } from '../lib/errors.js'
import {
  parseJson, parseQuery, vaultSetup, vaultUnlock, vaultChangePin, vaultForgotVerify, vaultForgotComplete,
  vaultItemCreate, vaultItemPatch, vaultItemsQuery,
} from '../lib/validate.js'
import { timingSafeEqual, sha256Hex, signToken, verifyToken } from '../lib/signing.js'
import { wrapVaultKey, unwrapVaultKey } from '../lib/vaultCrypto.js'
import { rateLimit, clientIp } from '../lib/rateLimit.js'
import { sendOtpEmail } from '../lib/email.js'
import { randomDigits, isUuid } from '../lib/ids.js'
import { ensureProfile } from './me.js'

/**
 * Chaabi - personal password vault. Tables: backend/migrations/009_vault.sql.
 * See README "Chaabi flows" for the full protocol.
 *
 * Lockout (PW-5) is derived from failed_attempts alone: every 5th wrong PIN
 * locks the vault for 30s * 2^(failed_attempts/5 - 1), capped at 24h.
 * A correct PIN resets failed_attempts to 0.
 *
 * Client field `wrap_iv` maps to the `pin_wrapped_key_iv` column (and is
 * returned as `wrap_iv` in the unlock response, per the API contract).
 */
const vault = new Hono()
vault.use('*', requireAuth())

const ATTEMPTS_PER_LOCK = 5
const BASE_LOCK_MS = 30_000
const MAX_LOCK_MS = 24 * 60 * 60 * 1000
const OTP_TTL_MS = 10 * 60 * 1000
const RESET_TOKEN_TTL_S = 5 * 60

const VAULT_FIELDS =
  'id, user_id, pin_salt, pin_verifier_salt, pin_verifier_hash, kdf, kdf_iterations, pin_wrapped_key, pin_wrapped_key_iv, recovery_wrapped_key, recovery_wrapped_key_iv, recovery_enabled, failed_attempts, locked_until, pin_length, last_unlocked_at, pin_changed_at, created_at, updated_at'
const ITEM_FIELDS = 'id, vault_id, title, website, category, tags, is_favorite, encrypted_blob, iv, strength, last_used_at, deleted_at, created_at, updated_at'
const HISTORY_FIELDS = 'id, vault_item_id, encrypted_blob, iv, replaced_at, created_at'

/** Audit row in vault_activity_logs (never the secrets). Never throws. */
async function vaultLog(c, action, itemId = null, metadata = {}) {
  try {
    const db = c.get('db')
    const ipHash = (await sha256Hex(`ip:${clientIp(c)}`)).slice(0, 32)
    const { error } = await db.from('vault_activity_logs').insert({ user_id: c.get('user').id, action, item_id: itemId, metadata, ip_hash: ipHash })
    if (error) console.warn('[vault-activity] insert failed:', error.message)
  } catch (err) {
    console.warn('[vault-activity] threw:', err?.message || err)
  }
}

async function loadVault(db, userId) {
  return unwrap(await db.from('vaults').select(VAULT_FIELDS).eq('user_id', userId).maybeSingle(), 'Load vault')
}

async function requireVault(db, userId) {
  const v = await loadVault(db, userId)
  if (!v) throw notFound('No vault yet. Set a PIN first.')
  return v
}

function publicVault(v) {
  if (!v) return null
  return {
    recovery_enabled: v.recovery_enabled,
    locked_until: v.locked_until,
    failed_attempts: v.failed_attempts,
    kdf: v.kdf,
    kdf_iterations: v.kdf_iterations,
    // Salt for the PIN verifier is not secret; the client needs it to compute the verifier.
    pin_verifier_salt: v.pin_verifier_salt,
    pin_length: v.pin_length,
    last_unlocked_at: v.last_unlocked_at,
    pin_changed_at: v.pin_changed_at,
    created_at: v.created_at,
    updated_at: v.updated_at,
  }
}

function assertNotLocked(v) {
  if (v.locked_until && new Date(v.locked_until).getTime() > Date.now()) {
    const retry = Math.ceil((new Date(v.locked_until).getTime() - Date.now()) / 1000)
    throw locked('Vault is temporarily locked after too many wrong PINs', { locked_until: v.locked_until, retry_after_seconds: retry })
  }
}

/** Compares the verifier; updates counters; throws on mismatch. */
async function checkPinVerifier(c, v, presentedHash) {
  const db = c.get('db')
  assertNotLocked(v)
  if (timingSafeEqual(v.pin_verifier_hash, presentedHash)) {
    await db.from('vaults').update({ failed_attempts: 0, locked_until: null, last_unlocked_at: new Date().toISOString() }).eq('id', v.id)
    return
  }
  const failed = (v.failed_attempts || 0) + 1
  const update = { failed_attempts: failed }
  if (failed % ATTEMPTS_PER_LOCK === 0) {
    const level = failed / ATTEMPTS_PER_LOCK
    const lockMs = Math.min(BASE_LOCK_MS * 2 ** (level - 1), MAX_LOCK_MS)
    update.locked_until = new Date(Date.now() + lockMs).toISOString()
    await db.from('vaults').update(update).eq('id', v.id)
    await vaultLog(c, 'locked_out', null, { failed_attempts: failed, lock_seconds: lockMs / 1000 })
    throw locked('Too many wrong PINs. Vault locked.', { locked_until: update.locked_until, retry_after_seconds: lockMs / 1000 })
  }
  await db.from('vaults').update(update).eq('id', v.id)
  await vaultLog(c, 'unlock_failed', null, { failed_attempts: failed })
  throw new HttpError(401, 'Wrong PIN', 'wrong_pin', { attempts_remaining: ATTEMPTS_PER_LOCK - (failed % ATTEMPTS_PER_LOCK) })
}

function pinFields(body) {
  return {
    pin_salt: body.pin_salt,
    pin_verifier_salt: body.pin_verifier_salt,
    pin_verifier_hash: body.pin_verifier_hash,
    kdf: body.kdf,
    kdf_iterations: body.kdf_iterations,
    pin_wrapped_key: body.pin_wrapped_key,
    pin_wrapped_key_iv: body.wrap_iv,
    ...(body.pin_length !== undefined ? { pin_length: body.pin_length } : {}),
  }
}

/* ---------- status / setup / unlock / change PIN ---------- */

// GET /api/vault
vault.get('/', async (c) => {
  const v = await loadVault(c.get('db'), c.get('user').id)
  return c.json({ vault: publicVault(v) })
})

// POST /api/vault/setup
vault.post('/setup', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const body = await parseJson(c, vaultSetup)
  if (await loadVault(db, user.id)) throw conflict('Vault already exists')
  if (body.recovery_enabled && !body.vault_key) throw badRequest('vault_key is required when recovery is enabled')

  let recovery = { recovery_wrapped_key: null, recovery_wrapped_key_iv: null }
  if (body.recovery_enabled) {
    const wrapped = await wrapVaultKey(c.env, user.id, body.vault_key) // "v1.<iv>.<ct>"
    recovery = { recovery_wrapped_key: wrapped, recovery_wrapped_key_iv: wrapped.split('.')[1] }
  }
  const v = unwrap(
    await db
      .from('vaults')
      .insert({ user_id: user.id, ...pinFields(body), ...recovery, recovery_enabled: body.recovery_enabled, failed_attempts: 0, locked_until: null })
      .select(VAULT_FIELDS)
      .single(),
    'Create vault',
  )
  await vaultLog(c, 'vault_created', null, { recovery_enabled: v.recovery_enabled })
  return c.json({ vault: publicVault(v) }, 201)
})

// POST /api/vault/unlock { pin_verifier_hash }
vault.post('/unlock', rateLimit('vault-unlock', { max: 20, windowMs: 60_000 }), async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const { pin_verifier_hash } = await parseJson(c, vaultUnlock)
  const v = await requireVault(db, user.id)
  await checkPinVerifier(c, v, pin_verifier_hash)
  await vaultLog(c, 'unlocked')
  return c.json({ pin_salt: v.pin_salt, kdf: v.kdf, kdf_iterations: v.kdf_iterations, pin_wrapped_key: v.pin_wrapped_key, wrap_iv: v.pin_wrapped_key_iv })
})

// POST /api/vault/change-pin { current_pin_verifier_hash, ...new kdf fields }
vault.post('/change-pin', rateLimit('vault-change-pin', { max: 10, windowMs: 60_000 }), async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const body = await parseJson(c, vaultChangePin)
  const v = await requireVault(db, user.id)
  await checkPinVerifier(c, v, body.current_pin_verifier_hash)
  const now = new Date().toISOString()
  const updated = unwrap(
    await db
      .from('vaults')
      .update({ ...pinFields(body), failed_attempts: 0, locked_until: null, pin_changed_at: now, updated_at: now })
      .eq('id', v.id)
      .select(VAULT_FIELDS)
      .single(),
    'Change PIN',
  )
  await vaultLog(c, 'pin_changed')
  return c.json({ vault: publicVault(updated) })
})

/* ---------- forgot PIN (email OTP) ----------
 * 1. POST /forgot-pin/request  -> emails a 6-digit code (10 min, single active code, purpose pin_reset)
 * 2. POST /forgot-pin/verify   -> { code } -> { vault_key, reset_token }  (vault key unwrapped from recovery copy)
 * 3. POST /forgot-pin/complete -> { reset_token, new kdf fields, pin_wrapped_key, wrap_iv } (client re-wrapped vault_key with the new PIN)
 */

vault.post('/forgot-pin/request', rateLimit('vault-otp-request', { max: 3, windowMs: 10 * 60_000 }), async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const v = await requireVault(db, user.id)
  if (!v.recovery_enabled || !v.recovery_wrapped_key) throw forbidden('PIN recovery is disabled for this vault ("No recovery" mode)')

  const profile = await ensureProfile(db, user)
  const email = profile.email || user.email
  if (!email) throw badRequest('No email address on this account')

  // one active code at a time
  const now = new Date().toISOString()
  await db.from('vault_otp_codes').update({ consumed_at: now }).eq('user_id', user.id).eq('purpose', 'pin_reset').is('consumed_at', null)

  const code = randomDigits(6)
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString()
  unwrap(
    await db.from('vault_otp_codes').insert({ user_id: user.id, purpose: 'pin_reset', code_hash: await sha256Hex(`${user.id}:pin_reset:${code}`), expires_at: expiresAt, attempts: 0 }),
    'Store OTP',
  )
  const result = await sendOtpEmail(c.env, { to: email, code, minutes: OTP_TTL_MS / 60_000 })
  await vaultLog(c, 'pin_reset_requested', null, { email_sent: result.sent })
  const masked = email.replace(/^(.)(.*)(@.*)$/, (_, a, b, d) => a + '*'.repeat(Math.min(b.length, 6)) + d)
  return c.json({ ok: true, sent_to: masked, expires_at: expiresAt, email_sent: result.sent })
})

vault.post('/forgot-pin/verify', rateLimit('vault-otp-verify', { max: 10, windowMs: 10 * 60_000 }), async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const { code } = await parseJson(c, vaultForgotVerify)
  const v = await requireVault(db, user.id)
  if (!v.recovery_enabled || !v.recovery_wrapped_key) throw forbidden('PIN recovery is disabled for this vault')

  const otp = unwrap(
    await db
      .from('vault_otp_codes')
      .select('id, code_hash, expires_at, attempts, max_attempts, consumed_at')
      .eq('user_id', user.id)
      .eq('purpose', 'pin_reset')
      .is('consumed_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    'Load OTP',
  )
  if (!otp || new Date(otp.expires_at).getTime() < Date.now()) throw badRequest('No active code. Request a new one.')
  const maxAttempts = otp.max_attempts || 5
  if (otp.attempts >= maxAttempts) {
    await db.from('vault_otp_codes').update({ consumed_at: new Date().toISOString() }).eq('id', otp.id)
    throw locked('Too many wrong codes. Request a new one.')
  }

  const ok = timingSafeEqual(otp.code_hash, await sha256Hex(`${user.id}:pin_reset:${code}`))
  if (!ok) {
    await db.from('vault_otp_codes').update({ attempts: otp.attempts + 1 }).eq('id', otp.id)
    throw new HttpError(401, 'Wrong code', 'wrong_code', { attempts_remaining: maxAttempts - otp.attempts - 1 })
  }

  await db.from('vault_otp_codes').update({ consumed_at: new Date().toISOString() }).eq('id', otp.id)
  const vaultKey = await unwrapVaultKey(c.env, user.id, v.recovery_wrapped_key)
  const resetToken = await signToken(c.env.VAULT_RECOVERY_SECRET, { t: 'vault-reset', u: user.id, v: v.id }, RESET_TOKEN_TTL_S)
  await vaultLog(c, 'pin_reset_requested', null, { step: 'otp_verified' })
  return c.json({ vault_key: vaultKey, reset_token: resetToken, expires_in: RESET_TOKEN_TTL_S })
})

vault.post('/forgot-pin/complete', rateLimit('vault-otp-complete', { max: 10, windowMs: 10 * 60_000 }), async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const body = await parseJson(c, vaultForgotComplete)
  const v = await requireVault(db, user.id)
  const payload = await verifyToken(c.env.VAULT_RECOVERY_SECRET, body.reset_token)
  if (!payload || payload.t !== 'vault-reset' || payload.u !== user.id || payload.v !== v.id) throw unauthorized('Invalid or expired reset token')

  const now = new Date().toISOString()
  const updated = unwrap(
    await db
      .from('vaults')
      .update({ ...pinFields(body), failed_attempts: 0, locked_until: null, pin_changed_at: now, updated_at: now })
      .eq('id', v.id)
      .select(VAULT_FIELDS)
      .single(),
    'Reset PIN',
  )
  await vaultLog(c, 'pin_reset')
  return c.json({ vault: publicVault(updated) })
})

/* ---------- items (always scoped by vault_id, where vaults.user_id = caller) ---------- */

async function loadItem(db, vaultId, itemId, { includeDeleted = false } = {}) {
  if (!isUuid(itemId)) throw badRequest('Invalid item id')
  const item = unwrap(await db.from('vault_items').select(ITEM_FIELDS).eq('vault_id', vaultId).eq('id', itemId).maybeSingle(), 'Load item')
  if (!item || (item.deleted_at && !includeDeleted)) throw notFound('Item not found')
  return item
}

// GET /api/vault/items?q=&category=&favorite=1
vault.get('/items', async (c) => {
  const db = c.get('db')
  const v = await requireVault(db, c.get('user').id)
  const q = parseQuery(c, vaultItemsQuery)
  let query = db.from('vault_items').select(ITEM_FIELDS).eq('vault_id', v.id).is('deleted_at', null).order('is_favorite', { ascending: false }).order('title')
  if (q.category) query = query.eq('category', q.category)
  if (q.favorite) query = query.eq('is_favorite', true)
  if (q.q) {
    const term = q.q.replace(/[%_,]/g, '')
    query = query.or(`title.ilike.%${term}%,website.ilike.%${term}%`)
  }
  return c.json({ items: unwrap(await query, 'List items') })
})

// POST /api/vault/items
vault.post('/items', async (c) => {
  const db = c.get('db')
  const v = await requireVault(db, c.get('user').id)
  const body = await parseJson(c, vaultItemCreate)
  const item = unwrap(await db.from('vault_items').insert({ ...body, vault_id: v.id }).select(ITEM_FIELDS).single(), 'Create item')
  await vaultLog(c, 'item_added', item.id, { category: item.category })
  return c.json({ item }, 201)
})

// GET /api/vault/items/trash (soft-deleted items, PW-17)
vault.get('/items/trash', async (c) => {
  const db = c.get('db')
  const v = await requireVault(db, c.get('user').id)
  const items = unwrap(await db.from('vault_items').select(ITEM_FIELDS).eq('vault_id', v.id).not('deleted_at', 'is', null).order('deleted_at', { ascending: false }), 'List trash')
  return c.json({ items })
})

// GET /api/vault/items/:id
vault.get('/items/:id', async (c) => {
  const db = c.get('db')
  const v = await requireVault(db, c.get('user').id)
  const item = await loadItem(db, v.id, c.req.param('id'), { includeDeleted: true })
  await db.from('vault_items').update({ last_used_at: new Date().toISOString() }).eq('id', item.id)
  return c.json({ item })
})

// PATCH /api/vault/items/:id  - a new encrypted_blob moves the old one into history (PW-8)
vault.patch('/items/:id', async (c) => {
  const db = c.get('db')
  const v = await requireVault(db, c.get('user').id)
  const existing = await loadItem(db, v.id, c.req.param('id'))
  const patch = await parseJson(c, vaultItemPatch)

  const blobChanged = patch.encrypted_blob !== undefined && patch.encrypted_blob !== existing.encrypted_blob
  if (blobChanged) {
    unwrap(
      await db.from('vault_item_history').insert({ vault_item_id: existing.id, encrypted_blob: existing.encrypted_blob, iv: existing.iv, replaced_at: new Date().toISOString() }),
      'Archive old secret',
    )
  }
  const item = unwrap(
    await db.from('vault_items').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', existing.id).eq('vault_id', v.id).select(ITEM_FIELDS).single(),
    'Update item',
  )
  await vaultLog(c, 'item_changed', item.id, { secret_changed: blobChanged, fields: Object.keys(patch).filter((k) => k !== 'encrypted_blob' && k !== 'iv') })
  return c.json({ item })
})

// POST /api/vault/items/:id/restore
vault.post('/items/:id/restore', async (c) => {
  const db = c.get('db')
  const v = await requireVault(db, c.get('user').id)
  const existing = await loadItem(db, v.id, c.req.param('id'), { includeDeleted: true })
  const item = unwrap(
    await db.from('vault_items').update({ deleted_at: null, updated_at: new Date().toISOString() }).eq('id', existing.id).eq('vault_id', v.id).select(ITEM_FIELDS).single(),
    'Restore item',
  )
  await vaultLog(c, 'item_restored', item.id)
  return c.json({ item })
})

// DELETE /api/vault/items/:id  (soft delete; ?purge=1 deletes permanently with history)
vault.delete('/items/:id', async (c) => {
  const db = c.get('db')
  const v = await requireVault(db, c.get('user').id)
  const existing = await loadItem(db, v.id, c.req.param('id'), { includeDeleted: true })
  if (c.req.query('purge') === '1') {
    await vaultLog(c, 'item_purged', existing.id) // before the row disappears (item_id FK -> set null on delete)
    unwrap(await db.from('vault_items').delete().eq('id', existing.id).eq('vault_id', v.id), 'Purge item') // history cascades
  } else {
    unwrap(await db.from('vault_items').update({ deleted_at: new Date().toISOString() }).eq('id', existing.id).eq('vault_id', v.id), 'Delete item')
    await vaultLog(c, 'item_deleted', existing.id)
  }
  return c.json({ ok: true })
})

// GET /api/vault/items/:id/history
vault.get('/items/:id/history', async (c) => {
  const db = c.get('db')
  const v = await requireVault(db, c.get('user').id)
  const item = await loadItem(db, v.id, c.req.param('id'), { includeDeleted: true })
  const history = unwrap(await db.from('vault_item_history').select(HISTORY_FIELDS).eq('vault_item_id', item.id).order('replaced_at', { ascending: false }), 'Load history')
  return c.json({ history })
})

// DELETE /api/vault/items/:id/history/:hid
vault.delete('/items/:id/history/:hid', async (c) => {
  const db = c.get('db')
  const v = await requireVault(db, c.get('user').id)
  const item = await loadItem(db, v.id, c.req.param('id'), { includeDeleted: true }) // ownership via vault_items.vault_id
  const hid = c.req.param('hid')
  if (!isUuid(hid)) throw badRequest('Invalid history id')
  const rows = unwrap(await db.from('vault_item_history').delete().eq('id', hid).eq('vault_item_id', item.id).select('id'), 'Delete history entry')
  if (!rows.length) throw notFound('History entry not found')
  await vaultLog(c, 'history_deleted', item.id, { history_id: hid })
  return c.json({ ok: true })
})

export default vault
