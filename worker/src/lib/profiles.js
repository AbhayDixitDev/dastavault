import { unwrap } from './errors.js'

export const PUBLIC_PROFILE_FIELDS = 'id, email, display_name, avatar_url'

/**
 * Loads public profile fields for a set of user ids. Done as a separate query
 * (instead of a PostgREST embed) so it works whether the FK points at
 * profiles or auth.users.
 */
export async function loadProfiles(db, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (ids.length === 0) return new Map()
  const rows = unwrap(await db.from('profiles').select(PUBLIC_PROFILE_FIELDS).in('id', ids), 'Load profiles')
  return new Map(rows.map((p) => [p.id, p]))
}

/** Attaches `rows[i][target] = profile` looked up by `rows[i][key]`. */
export async function attachProfiles(db, rows, key = 'user_id', target = 'profile') {
  const map = await loadProfiles(db, rows.map((r) => r[key]))
  for (const r of rows) {
    const p = map.get(r[key])
    r[target] = p ? { display_name: p.display_name, email: p.email, avatar_url: p.avatar_url, id: p.id } : null
  }
  return rows
}
