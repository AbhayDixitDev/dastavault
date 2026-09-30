import { Hono } from 'hono'
import { requireAuth } from '../lib/auth.js'
import { unwrap, notFound, badRequest } from '../lib/errors.js'
import { parseJson, aiKeyCreate } from '../lib/validate.js'
import { isUuid } from '../lib/ids.js'
import { encryptAiKey, decryptAiKey } from '../lib/aiCrypto.js'
import { getProvider } from '../lib/ai/index.js'

/**
 * Per-user AI provider keys (contract section 6). Mounted at /api/ai/keys.
 * Keys are AES-GCM encrypted under HKDF(VAULT_RECOVERY_SECRET, 'ai:'+userId) and never returned.
 */
const aiKeys = new Hono()
aiKeys.use('*', requireAuth())

const PUBLIC_FIELDS = 'id, provider, label, model, base_url, is_default, last_used_at, created_at, updated_at'
const SECRET_FIELDS = `${PUBLIC_FIELDS}, user_id, encrypted_key, iv`

/**
 * Finds the key to use for a user: `keyId` when given, else the default, else the
 * most recently used one. Returns { row, apiKey } or null.
 */
export async function resolveAiKey(db, env, userId, keyId = null) {
  let q = db.from('ai_provider_keys').select(SECRET_FIELDS).eq('user_id', userId)
  if (keyId) {
    if (!isUuid(keyId)) throw badRequest('Invalid key_id')
    q = q.eq('id', keyId)
  } else {
    q = q.order('is_default', { ascending: false }).order('last_used_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
  }
  const rows = unwrap(await q.limit(1), 'Load AI key')
  const row = rows[0]
  if (!row) return null
  const apiKey = await decryptAiKey(env, userId, row)
  return { row, apiKey }
}

export async function providerFor(env, resolved) {
  return getProvider({ provider: resolved.row.provider, apiKey: resolved.apiKey, model: resolved.row.model, baseUrl: resolved.row.base_url })
}

// GET /api/ai/keys
aiKeys.get('/', async (c) => {
  const db = c.get('db')
  const rows = unwrap(await db.from('ai_provider_keys').select(PUBLIC_FIELDS).eq('user_id', c.get('user').id).order('created_at'), 'List AI keys')
  return c.json({ keys: rows })
})

// POST /api/ai/keys { provider, api_key, label?, model?, base_url?, is_default? }
aiKeys.post('/', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const body = await parseJson(c, aiKeyCreate)
  if ((body.provider === 'custom' || body.provider === 'local') && !body.base_url) throw badRequest('base_url is required for local/custom providers')
  const enc = await encryptAiKey(c.env, user.id, body.api_key)
  const countRes = await db.from('ai_provider_keys').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
  const makeDefault = body.is_default || (countRes.count ?? 0) === 0
  if (makeDefault) await db.from('ai_provider_keys').update({ is_default: false }).eq('user_id', user.id).eq('is_default', true)
  const key = unwrap(
    await db
      .from('ai_provider_keys')
      .upsert(
        {
          user_id: user.id,
          provider: body.provider,
          label: body.label ?? null,
          model: body.model ?? null,
          base_url: body.base_url ?? null,
          is_default: makeDefault,
          encrypted_key: enc.encrypted_key,
          iv: enc.iv,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' },
      )
      .select(PUBLIC_FIELDS)
      .single(),
    'Save AI key',
  )
  return c.json({ key }, 201)
})

// DELETE /api/ai/keys/:id
aiKeys.delete('/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  if (!isUuid(id)) throw badRequest('Invalid key id')
  const rows = unwrap(await db.from('ai_provider_keys').delete().eq('id', id).eq('user_id', c.get('user').id).select('id'), 'Delete AI key')
  if (!rows.length) throw notFound('Key not found')
  return c.json({ ok: true })
})

// POST /api/ai/keys/:id/test -> { ok, model, latency_ms }
aiKeys.post('/:id/test', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const resolved = await resolveAiKey(db, c.env, user.id, c.req.param('id'))
  if (!resolved) throw notFound('Key not found')
  const started = Date.now()
  try {
    const provider = await providerFor(c.env, resolved)
    const out = await provider.chat({ system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'ping' }], maxTokens: 16 })
    await db.from('ai_provider_keys').update({ last_used_at: new Date().toISOString() }).eq('id', resolved.row.id)
    return c.json({ ok: true, model: out.model || provider.model, latency_ms: Date.now() - started, reply: (out.text || '').slice(0, 40) })
  } catch (err) {
    return c.json({ ok: false, model: resolved.row.model, latency_ms: Date.now() - started, error: err?.message || 'Provider test failed', code: err?.code || 'ai_provider_error' })
  }
})

export default aiKeys
