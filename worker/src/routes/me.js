import { Hono } from 'hono'
import { requireAuth } from '../lib/auth.js'
import { unwrap } from '../lib/errors.js'
import { parseJson, profilePatch } from '../lib/validate.js'

const me = new Hono()
me.use('*', requireAuth())

const PROFILE_FIELDS = 'id, email, display_name, avatar_key, preferred_language, large_text, settings, created_at, updated_at'

/** Loads the caller's profile, creating it from the token on first sight. */
export async function ensureProfile(db, user) {
  const existing = unwrap(await db.from('profiles').select(PROFILE_FIELDS).eq('id', user.id).maybeSingle(), 'Load profile')
  if (existing) return existing
  const m = user.metadata || {}
  const displayName =
    (typeof m.display_name === 'string' && m.display_name.trim()) ||
    (typeof m.full_name === 'string' && m.full_name.trim()) ||
    (typeof m.name === 'string' && m.name.trim()) ||
    (user.email ? user.email.split('@')[0] : 'New user')
  return unwrap(
    await db
      .from('profiles')
      .upsert({ id: user.id, email: user.email, display_name: displayName }, { onConflict: 'id' })
      .select(PROFILE_FIELDS)
      .single(),
    'Create profile',
  )
}

// GET /api/me
me.get('/', async (c) => {
  const profile = await ensureProfile(c.get('db'), c.get('user'))
  return c.json({ profile })
})

// PATCH /api/me
me.patch('/', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const patch = await parseJson(c, profilePatch)
  await ensureProfile(db, user)
  const profile = unwrap(
    await db
      .from('profiles')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', user.id)
      .select(PROFILE_FIELDS)
      .single(),
    'Update profile',
  )
  return c.json({ profile })
})

export default me
