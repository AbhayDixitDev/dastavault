import { badRequest } from './errors.js'

/**
 * Keyset pagination on (created_at desc, id desc).
 * Cursor = base64url("<created_at>|<id>") of the last row returned.
 */
export function encodeCursor(row) {
  if (!row) return null
  return btoa(`${row.created_at}|${row.id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeCursor(cursor) {
  if (!cursor) return null
  try {
    const padded = cursor.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (cursor.length % 4)) % 4)
    const [createdAt, id] = atob(padded).split('|')
    if (!createdAt || !id) throw new Error('bad')
    return { createdAt, id }
  } catch {
    throw badRequest('Invalid cursor')
  }
}

/**
 * Applies the cursor to a supabase query builder and orders newest-first.
 * Fetches limit+1 rows so the caller can tell whether more exist.
 */
export function applyCursor(query, cursor, limit) {
  const c = decodeCursor(cursor)
  let q = query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1)
  if (c) {
    // (created_at < c.createdAt) OR (created_at = c.createdAt AND id < c.id)
    q = q.or(`created_at.lt.${c.createdAt},and(created_at.eq.${c.createdAt},id.lt.${c.id})`)
  }
  return q
}

/** Splits limit+1 rows into { items, next_cursor }. */
export function pageResult(rows, limit) {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  return { items, next_cursor: hasMore ? encodeCursor(items[items.length - 1]) : null }
}
