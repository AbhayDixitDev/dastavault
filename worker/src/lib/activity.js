/**
 * Writes a row to activity_logs (workspace_id, actor_id, entity_type, entity_id, action, message, metadata).
 * Never throws: an audit-log failure must not break the user's action.
 *
 * activity_logs.workspace_id is NOT NULL, so user-level events (Chaabi vault)
 * are only written to the Worker log until a user-level audit table exists.
 */
const humanize = (action) => action.replace(/[._]/g, ' ')

export async function logActivity(db, { workspaceId = null, actorId = null, action, entityType, entityId = null, message, details = {} }) {
  const text = message || humanize(action)
  if (!workspaceId) {
    console.log(`[activity:user] ${actorId ?? '-'} ${entityType}:${entityId ?? '-'} ${action} ${JSON.stringify(details)}`)
    return
  }
  try {
    const { error } = await db.from('activity_logs').insert({
      workspace_id: workspaceId,
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      message: text,
      metadata: details ?? {},
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
  return (action, entityType, entityId, details, message) =>
    logActivity(db, {
      workspaceId: membership?.workspace_id ?? null,
      actorId: user?.id ?? null,
      action,
      entityType,
      entityId,
      details,
      message,
    })
}
