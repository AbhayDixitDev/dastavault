import { Hono } from 'hono'
import { requireAuth } from '../lib/auth.js'
import { unwrap, notFound, badRequest, conflict, forbidden, locked, unauthorized, HttpError } from '../lib/errors.js'
import {
  parseJson, parseQuery, vaultSetup, vaultUnlock, vaultChangePin, vaultForgotVerify, vaultForgotComplete,
  vaultItemCreate, vaultItemPatch, vaultItemsQuery,
} from '../lib/validate.js'
import { timingSafeEqual, sha256Hex, signToken, verifyToken } from '../lib/signing.js'
import { wrapVaultKey, unwrapVaultKey } from '../lib/vaultCrypto.js'
import { rateLimit } from '../lib/rateLimit.js'
import { sendOtpEmail } from '../lib/email.js'
import { randomDigits, isUuid } from '../lib/ids.js'
import { logActivity } from '../lib/activity.js'
import { ensureProfile } from './me.js'

/**
 * Chaabi - personal password vault. See README "Chaabi flows" for the full protocol.
 *
 * Lockout (PW-5): 5 wrong PIN verifiers -> locked for 30s, doubling on every
 * further lockout (30s, 60s, 120s ... capped at 24h). A correct PIN resets it.
 */
const vault = new Hono()
vault.use('*', requireAuth())

const MAX_ATTEMPTS = 5
const BASE_LOCK_MS = 30_000
const MAX_LOCK_MS = 24 * 60 * 60 * 1000
const OTP_TTL_MS = 10 * 60 * 1000
const OTP_MAX_ATTEMPTS = 5
const RESET_TOKEN_TTL_S = 5 * 60

const VAULT_FIELDS =
  'id, user_id, pin_salt, pin_verifier_salt, pin_verifier_hash, kdf, kdf_iterations, pin_wrapped_key, wrap_iv, recovery_wrapped_key, recovery_enabled, failed_attempts, lockout_level, locked_until, created_at, updated_at'
const ITEM_FIELDS = 'id, vault_id, user_id, title, website, category, is_favorite, encrypted_blob, iv, created_at, updated_at, deleted_at'
const HISTORY_FIELDS = 'id, vault_item_id, vault_id, encrypted_blob, iv, replaced_at'

const vaultActivity = (db, userId, action, entityId, details) =>
  logActivity(db, { workspaceId: null, actorId: userId, action, entityType: 'vault', entityId, details })

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
async function checkPinVerifier(db, v, presentedHash, userId) {
  assertNotLocked(v)
  if (timingSafeEqual(v.pin_verifier_hash, presentedHash)) {
    if (v.failed_attempts || v.locked_until || v.lockout_level) {
      await db.from('vaults').update({ failed_attempts: 0, locked_until: null, lockout_level: 0 }).eq('id', v.id)
    }
    return
  }
  const failed = (v.failed_attempts || 0) + 1
  if (failed >= MAX_ATTEMPTS) {
    const level = (v.lockout_level || 0) + 1
    const lockMs = Math.min(BASE_LOCK_MS * 2 ** (level - 1), MAX_LOCK_MS)
    const lockedUntil = new Date(Date.now() + lockMs).toISOString()
    await db.from('vaults').update({ failed_attempts: 0, lockout_level: level, locked_until: lockedUntil }).eq('id', v.id)
    await vaultActivity(db, userId, 'vault.locked', v.id, { level, lock_seconds: lockMs / 1000 })
    throw locked('Too many wrong PINs. Vault locked.', { locked_until: lockedUntil, retry_after_seconds: lockMs / 1000 })
  }
  await db.from('vaults').update({ failed_attempts: failed }).eq('id', v.id)
  throw new HttpError(401, 'Wrong PIN', 'wrong_pin', { attempts_remaining: MAX_ATTEMPTS - failed })
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

  const recoveryWrapped = body.recovery_enabled ? await wrapVaultKey(c.env, user.id, body.vault_key) : null
  const v = unwrap(
    await db
      .from('vaults')
      .insert({
        user_id: user.id,
        pin_salt: body.pin_salt,
        pin_verifier_salt: body.pin_verifier_salt,
        pin_verifier_hash: body.pin_verifier_hash,
        kdf: body.kdf,
        kdf_iterations: body.kdf_iterations,
        pin_wrapped_key: body.pin_wrapped_key,
        wrap_iv: body.wrap_iv,
        recovery_wrapped_key: recoveryWrapped,
        recovery_enabled: body.recovery_enabled,
        failed_attempts: 0,
        lockout_level: 0,
        locked_until: null,
      })
      .select(VAULT_FIELDS)
      .single(),
    'Create vault',
  )
  await vaultActivity(db, user.id, 'vault.created', v.id, { recovery_enabled: v.recovery_enabled })
  return c.json({ vault: publicVault(v) }, 201)
})

// POST /api/vault/unlock { pin_verifier_hash }
vault.post('/unlock', rateLimit('vault-unlock', { max: 20, windowMs: 60_000 }), async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const { pin_verifier_hash } = await parseJson(c, vaultUnlock)
  const v = await requireVault(db, user.id)
  await checkPinVerifier(db, v, pin_verifier_hash, user.id)
  await vaultActivity(db, user.id, 'vault.unlocked', v.id)
  return c.json({ pin_salt: v.pin_salt, kdf: v.kdf, kdf_iterations: v.kdf_iterations, pin_wrapped_key: v.pin_wrapped_key, wrap_iv: v.wrap_iv })
})

// POST /api/vault/change-pin { current_pin_verifier_hash, ...new kdf fields }
vault.post('/change-pin', rateLimit('vault-change-pin', { max: 10, windowMs: 60_000 }), async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const body = await parseJson(c, vaultChangePin)
  const v = await requireVault(db, user.id)
  await checkPinVerifier(db, v, body.current_pin_verifier_hash, user.id)
  const updated = unwrap(
    await db
      .from('vaults')
      .update({
        pin_salt: body.pin_salt,
        pin_verifier_salt: body.pin_verifier_salt,
        pin_verifier_hash: body.pin_verifier_hash,
        kdf: body.kdf,
        kdf_iterations: body.kdf_iterations,
        pin_wrapped_key: body.pin_wrapped_key,
        wrap_iv: body.wrap_iv,
        failed_attempts: 0,
        lockout_level: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', v.id)
      .select(VAULT_FIELDS)
      .single(),
    'Change PIN',
  )
  await vaultActivity(db, user.id, 'vault.pin_changed', v.id)
  return c.json({ vault: publicVault(updated) })
})

/* ---------- forgot PIN (email OTP) ----------
 * 1. POST /forgot-pin/request  -> emails a 6-digit code (10 min, single active code)
 * 2. POST /forgot-pin/verify   -> { code } -> { vault_key, reset_token }  (vault key unwrapped from recovery copy)
 * 3. POST /forgot-pin/complete -> { reset_token, new kdf fields, pin_wrapped_key } (client re-wrapped vault_key with the new PIN)
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
  await db.from('vault_otp_codes').update({ used_at: new Date().toISOString() }).eq('vault_id', v.id).is('used_at', null)

  const code = randomDigits(6)
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString()
  unwrap(
    await db.from('vault_otp_codes').insert({ vault_id: v.id, user_id: user.id, code_hash: await sha256Hex(`${v.id}:${code}`), expires_at: expiresAt, attempts: 0 }),
    'Store OTP',
  )
  const result = await sendOtpEmail(c.env, { to: email, code, minutes: OTP_TTL_MS / 60_000 })
  await vaultActivity(db, user.id, 'vault.reset_requested', v.id, { email_sent: result.sent })
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
    await db.from('vault_otp_codes').select('id, code_hash, expires_at, attempts, used_at').eq('vault_id', v.id).is('used_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    'Load OTP',
  )
  if (!otp || new Date(otp.expires_at).getTime() < Date.now()) throw badRequest('No active code. Request a new one.')
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await db.from('vault_otp_codes').update({ used_at: new Date().toISOString() }).eq('id', otp.id)
    throw locked('Too many wrong codes. Request a new one.')
  }

  const ok = timingSafeEqual(otp.code_hash, await sha256Hex(`${v.id}:${code}`))
  if (!ok) {
    await db.from('vault_otp_codes').update({ attempts: otp.attempts + 1 }).eq('id', otp.id)
    throw new HttpError(401, 'Wrong code', 'wrong_code', { attempts_remaining: OTP_MAX_ATTEMPTS - otp.attempts - 1 })
  }

  await db.from('vault_otp_codes').update({ used_at: new Date().toISOString() }).eq('id', otp.id)
  const vaultKey = await unwrapVaultKey(c.env, user.id, v.recovery_wrapped_key)
  const resetToken = await signToken(c.env.VAULT_RECOVERY_SECRET, { t: 'vault-reset', u: user.id, v: v.id }, RESET_TOKEN_TTL_S)
  await vaultActivity(db, user.id, 'vault.reset_verified', v.id)
  return c.json({ vault_key: vaultKey, reset_token: resetToken, expires_in: RESET_TOKEN_TTL_S })
})

vault.post('/forgot-pin/complete', rateLimit('vault-otp-complete', { max: 10, windowMs: 10 * 60_000 }), async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const body = await parseJson(c, vaultForgotComplete)
  const v = await requireVault(db, user.id)
  const payload = await verifyToken(c.env.VAULT_RECOVERY_SECRET, body.reset_token)
  if (!payload || payload.t !== 'vault-reset' || payload.u !== user.id || payload.v !== v.id) throw unauthorized('Invalid or expired reset token')

  const updated = unwrap(
    await db
      .from('vaults')
      .update({
        pin_salt: body.pin_salt,
        pin_verifier_salt: body.pin_verifier_salt,
        pin_verifier_hash: body.pin_verifier_hash,
        kdf: body.kdf,
        kdf_iterations: body.kdf_iterations,
        pin_wrapped_key: body.pin_wrapped_key,
        wrap_iv: body.wrap_iv,
        failed_attempts: 0,
        lockout_level: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', v.id)
      .select(VAULT_FIELDS)
      .single(),
    'Reset PIN',
  )
  await vaultActivity(db, user.id, 'vault.pin_reset', v.id)
  return c.json({ vault: publicVault(updated) })
})

/* ---------- items ---------- */

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
  const user = c.get('user')
  const v = await requireVault(db, user.id)
  const body = await parseJson(c, vaultItemCreate)
  const item = unwrap(await db.from('vault_items').insert({ ...body, vault_id: v.id, user_id: user.id }).select(ITEM_FIELDS).single(), 'Create item')
  await vaultActivity(db, user.id, 'vault.item_added', item.id, { title: item.title })
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
  return c.json({ item: await loadItem(db, v.id, c.req.param('id'), { includeDeleted: true }) })
})

// PATCH /api/vault/items/:id  - a new encrypted_blob moves the old one into history (PW-8)
vault.patch('/items/:id', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const v = await requireVault(db, user.id)
  const existing = await loadItem(db, v.id, c.req.param('id'))
  const patch = await parseJson(c, vaultItemPatch)

  const blobChanged = patch.encrypted_blob !== undefined && patch.encrypted_blob !== existing.encrypted_blob
  if (blobChanged) {
    unwrap(
      await db.from('vault_item_history').insert({ vault_item_id: existing.id, vault_id: v.id, encrypted_blob: existing.encrypted_blob, iv: existing.iv, replaced_at: new Date().toISOString() }),
      'Archive old secret',
    )
  }
  const item = unwrap(
    await db.from('vault_items').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', existing.id).eq('vault_id', v.id).select(ITEM_FIELDS).single(),
    'Update item',
  )
  await vaultActivity(db, user.id, 'vault.item_changed', item.id, { secret_changed: blobChanged, fields: Object.keys(patch).filter((k) => k !== 'encrypted_blob' && k !== 'iv') })
  return c.json({ item })
})

// POST /api/vault/items/:id/restore
vault.post('/items/:id/restore', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const v = await requireVault(db, user.id)
  const existing = await loadItem(db, v.id, c.req.param('id'), { includeDeleted: true })
  const item = unwrap(await db.from('vault_items').update({ deleted_at: null, updated_at: new Date().toISOString() }).eq('id', existing.id).select(ITEM_FIELDS).single(), 'Restore item')
  await vaultActivity(db, user.id, 'vault.item_restored', item.id)
  return c.json({ item })
})

// DELETE /api/vault/items/:id  (soft delete; ?purge=1 deletes permanently with history)
vault.delete('/items/:id', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const v = await requireVault(db, user.id)
  const existing = await loadItem(db, v.id, c.req.param('id'), { includeDeleted: true })
  if (c.req.query('purge') === '1') {
    unwrap(await db.from('vault_item_history').delete().eq('vault_item_id', existing.id).eq('vault_id', v.id), 'Purge history')
    unwrap(await db.from('vault_items').delete().eq('id', existing.id).eq('vault_id', v.id), 'Purge item')
    await vaultActivity(db, user.id, 'vault.item_purged', existing.id)
  } else {
    unwrap(await db.from('vault_items').update({ deleted_at: new Date().toISOString() }).eq('id', existing.id).eq('vault_id', v.id), 'Delete item')
    await vaultActivity(db, user.id, 'vault.item_deleted', existing.id, { title: existing.title })
  }
  return c.json({ ok: true })
})

// GET /api/vault/items/:id/history
vault.get('/items/:id/history', async (c) => {
  const db = c.get('db')
  const v = await requireVault(db, c.get('user').id)
  const item = await loadItem(db, v.id, c.req.param('id'), { includeDeleted: true })
  const history = unwrap(await db.from('vault_item_history').select(HISTORY_FIELDS).eq('vault_item_id', item.id).eq('vault_id', v.id).order('replaced_at', { ascending: false }), 'Load history')
  return c.json({ history })
})

// DELETE /api/vault/items/:id/history/:hid
vault.delete('/items/:id/history/:hid', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const v = await requireVault(db, user.id)
  const item = await loadItem(db, v.id, c.req.param('id'), { includeDeleted: true })
  const hid = c.req.param('hid')
  if (!isUuid(hid)) throw badRequest('Invalid history id')
  const rows = unwrap(await db.from('vault_item_history').delete().eq('id', hid).eq('vault_item_id', item.id).eq('vault_id', v.id).select('id'), 'Delete history entry')
  if (!rows.length) throw notFound('History entry not found')
  await vaultActivity(db, user.id, 'vault.history_deleted', item.id, { history_id: hid })
  return c.json({ ok: true })
})

export default vault
