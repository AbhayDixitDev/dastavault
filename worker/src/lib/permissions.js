/**
 * Role ranks. Higher rank includes every capability of a lower rank.
 * Mirrors the `roles` table (key, rank) so checks are cheap and need no DB round trip.
 */
export const ROLE_RANK = Object.freeze({
  restricted: 10,
  viewer: 20,
  editor: 30,
  admin: 40,
  owner: 50,
})

export const ROLE_KEYS = Object.freeze(Object.keys(ROLE_RANK))

export function rankOf(roleKey) {
  return ROLE_RANK[roleKey] ?? 0
}

/** true when `roleKey` is at least `minRole`. */
export function hasRole(roleKey, minRole) {
  if (!minRole) return rankOf(roleKey) > 0
  return rankOf(roleKey) >= rankOf(minRole)
}

export function isValidRole(roleKey) {
  return Object.prototype.hasOwnProperty.call(ROLE_RANK, roleKey)
}
