import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { unwrap, notFound, badRequest } from '../lib/errors.js'
import { parseJson, groupCreate, groupPatch } from '../lib/validate.js'
import { activityFor } from '../lib/activity.js'
import { isUuid } from '../lib/ids.js'

const groups = new Hono()
const GROUP_FIELDS = 'id, workspace_id, parent_group_id, name, description, color, created_by, created_at, updated_at'

async function loadGroup(db, wsId, groupId) {
  if (!isUuid(groupId)) throw badRequest('Invalid group id')
  const row = unwrap(await db.from('groups').select(GROUP_FIELDS).eq('workspace_id', wsId).eq('id', groupId).maybeSingle(), 'Load group')
  if (!row) throw notFound('Group not found')
  return row
}

async function memberCounts(db, wsId, groupIds) {
  const counts = new Map()
  if (!groupIds.length) return counts
  const rows = unwrap(await db.from('person_groups').select('group_id').eq('workspace_id', wsId).in('group_id', groupIds), 'Count group members')
  for (const r of rows) counts.set(r.group_id, (counts.get(r.group_id) || 0) + 1)
  return counts
}

async function assertParent(db, wsId, parentId, selfId) {
  if (!parentId) return
  if (parentId === selfId) throw badRequest('A group cannot be its own parent')
  const parent = await loadGroup(db, wsId, parentId)
  if (parent.parent_group_id) throw badRequest('Only two levels are supported (group and subgroup)')
  if (selfId) {
    // prevent cycles: the parent must not be a child of the group being edited
    const children = unwrap(await db.from('groups').select('id').eq('workspace_id', wsId).eq('parent_group_id', selfId), 'Load children')
    if (children.some((ch) => ch.id === parentId)) throw badRequest('A group cannot be nested under its own subgroup')
  }
}

// GET /groups
groups.get('/', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const rows = unwrap(await db.from('groups').select(GROUP_FIELDS).eq('workspace_id', m.workspace_id).order('name', { ascending: true }), 'List groups')
  const counts = await memberCounts(db, m.workspace_id, rows.map((g) => g.id))
  const byId = new Map(rows.map((g) => [g.id, g]))
  const list = rows.map((g) => ({
    ...g,
    parent: g.parent_group_id ? { id: g.parent_group_id, name: byId.get(g.parent_group_id)?.name ?? null } : null,
    member_count: counts.get(g.id) || 0,
  }))
  return c.json({ groups: list })
})

// POST /groups (editor+)
groups.post('/', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const body = await parseJson(c, groupCreate)
  await assertParent(db, m.workspace_id, body.parent_group_id ?? null, null)
  const group = unwrap(
    await db
      .from('groups')
      .insert({ ...body, parent_group_id: body.parent_group_id ?? null, workspace_id: m.workspace_id, created_by: c.get('user').id })
      .select(GROUP_FIELDS)
      .single(),
    'Create group',
  )
  await activityFor(c)('group.created', 'group', group.id, { name: group.name })
  return c.json({ group: { ...group, member_count: 0 } }, 201)
})

// GET /groups/:gid
groups.get('/:gid', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const group = await loadGroup(db, m.workspace_id, c.req.param('gid'))
  const [parent, children, links] = await Promise.all([
    group.parent_group_id ? loadGroup(db, m.workspace_id, group.parent_group_id) : null,
    db.from('groups').select(GROUP_FIELDS).eq('workspace_id', m.workspace_id).eq('parent_group_id', group.id).order('name'),
    db.from('person_groups').select('person_id, role_in_group, person:people!person_id(id, display_name, avatar_key, deleted_at)').eq('group_id', group.id),
  ])
  const people = unwrap(links, 'Load group people')
    .filter((l) => l.person && !l.person.deleted_at)
    .map((l) => ({ id: l.person.id, display_name: l.person.display_name, avatar_key: l.person.avatar_key, role_in_group: l.role_in_group }))
  return c.json({ group: { ...group, parent, children: unwrap(children, 'Load subgroups'), people, member_count: people.length } })
})

// PATCH /groups/:gid (editor+)
groups.patch('/:gid', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const existing = await loadGroup(db, m.workspace_id, c.req.param('gid'))
  const patch = await parseJson(c, groupPatch)
  if ('parent_group_id' in patch) await assertParent(db, m.workspace_id, patch.parent_group_id ?? null, existing.id)
  const group = unwrap(
    await db.from('groups').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', existing.id).eq('workspace_id', m.workspace_id).select(GROUP_FIELDS).single(),
    'Update group',
  )
  await activityFor(c)('group.updated', 'group', group.id, { fields: Object.keys(patch) })
  const counts = await memberCounts(db, m.workspace_id, [group.id])
  return c.json({ group: { ...group, member_count: counts.get(group.id) || 0 } })
})

// DELETE /groups/:gid (admin+). Subgroups are re-parented to the deleted group's parent.
groups.delete('/:gid', requireRole('admin'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const group = await loadGroup(db, m.workspace_id, c.req.param('gid'))
  unwrap(await db.from('groups').update({ parent_group_id: group.parent_group_id }).eq('workspace_id', m.workspace_id).eq('parent_group_id', group.id), 'Re-parent subgroups')
  unwrap(await db.from('person_groups').delete().eq('workspace_id', m.workspace_id).eq('group_id', group.id), 'Unlink people')
  unwrap(await db.from('groups').delete().eq('id', group.id).eq('workspace_id', m.workspace_id), 'Delete group')
  await activityFor(c)('group.deleted', 'group', group.id, { name: group.name })
  return c.json({ ok: true })
})

export default groups
