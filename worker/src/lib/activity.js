/**
 * Writes a row to activity_logs. Never throws: an audit-log failure must not
 * break the user's action, so errors are only logged.
 *
 * @param {object} db supabase client
 * @param {object} entry { workspaceId, actorId, action, entityType, entityId, details }
 */
export async function logActivity(db, { workspaceId = null, actorId = null, action, entityType, entityId = null, details = {} }) {
  try {
    const { error } = await db.from('activity_logs').insert({
      workspace_id: workspaceId,
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
    })
    if (error) console.warn('[activity] insert failed:', error.message)
  } catch (err) {
    console.warn('[activity] insert threw:', err?.message || err)
  }
}

/** Convenience for handlers that already have a workspace context. */
export function activityFor(c) {
  const db = c.get('db')
  const user = c.get('user')
  const membership = c.get('membership')
  return (action, entityType, entityId, details) =>
    logActivity(db, {
      workspaceId: membership?.workspace_id ?? null,
      actorId: user?.id ?? null,
      action,
      entityType,
      entityId,
      details,
    })
}
