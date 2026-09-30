import { forbidden, notFound, badRequest, unwrap } from './errors.js'
import { hasRole, rankOf } from './permissions.js'
import { isUuid } from './ids.js'

/**
 * Loads the caller's membership for the `:ws` route param.
 * - 404 if the workspace does not exist or is soft-deleted
 * - 403 if the caller is not a member, or their role is below `minRole`
 * Sets c.get('membership') = { id, workspace_id, user_id, role_key, person_id, rank, workspace }.
 * Requires requireAuth() to have run first.
 */
export function requireWorkspace(minRole) {
  return async (c, next) => {
    const wsId = c.req.param('ws')
    if (!isUuid(wsId)) throw badRequest('Invalid workspace id')

    const user = c.get('user')
    const db = c.get('db')

    const workspace = unwrap(
      await db.from('workspaces').select('id, name, kind, icon, default_visibility, features, storage_bytes, owner_id, created_by, deleted_at').eq('id', wsId).maybeSingle(),
      'Load workspace',
    )
    if (!workspace || workspace.deleted_at) throw notFound('Workspace not found')

    const membership = unwrap(
      await db.from('workspace_members').select('id, workspace_id, user_id, role_key, joined_at').eq('workspace_id', wsId).eq('user_id', user.id).maybeSingle(),
      'Load membership',
    )
    if (!membership) throw forbidden('You are not a member of this workspace')
    if (minRole && !hasRole(membership.role_key, minRole)) throw forbidden(`Requires ${minRole} role or higher`)

    // The member <-> person link lives on people.user_id. Only restricted members need it for visibility checks.
    let personId = null
    let linkedDocumentIds = []
    if (membership.role_key === 'restricted') {
      const person = unwrap(
        await db.from('people').select('id').eq('workspace_id', wsId).eq('user_id', user.id).is('deleted_at', null).maybeSingle(),
        'Load linked person',
      )
      personId = person?.id ?? null
      if (personId) {
        const rows = unwrap(
          await db.from('document_people').select('document_id').eq('workspace_id', wsId).eq('person_id', personId),
          'Load linked documents',
        )
        linkedDocumentIds = rows.map((r) => r.document_id)
      }
    }

    c.set('membership', {
      ...membership,
      person_id: personId,
      linked_document_ids: linkedDocumentIds,
      rank: rankOf(membership.role_key),
      workspace,
    })
    await next()
  }
}

/**
 * Cheaper follow-up check for handlers under a router that already ran requireWorkspace().
 */
export function requireRole(minRole) {
  return async (c, next) => {
    const m = c.get('membership')
    if (!m) throw forbidden('No workspace context')
    if (!hasRole(m.role_key, minRole)) throw forbidden(`Requires ${minRole} role or higher`)
    await next()
  }
}
