import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { unwrap, notFound, badRequest, conflict } from '../lib/errors.js'
import { parseJson, personCreate, personPatch, relationshipCreate, personGroupLink } from '../lib/validate.js'
import { activityFor } from '../lib/activity.js'
import { isUuid } from '../lib/ids.js'

const people = new Hono()
const PERSON_FIELDS =
  'id, workspace_id, display_name, first_name, last_name, relation_label, email, phone, date_of_birth, avatar_key, user_id, notes, custom, created_by, created_at, updated_at, deleted_at'
const REL_FIELDS = 'id, workspace_id, from_person_id, to_person_id, relation, custom_label, created_by, created_at'

/**
 * Inverse relations stored automatically when unambiguous.
 * "A is <relation> of B" (from=A,to=B) implies "B is <inverse> of A".
 * brother/sister/guardian/custom have no stored inverse (no unambiguous value in the relation check list).
 */
const INVERSE = Object.freeze({
  father: 'child',
  mother: 'child',
  parent: 'child',
  child: 'parent',
  son: 'parent',
  daughter: 'parent',
  spouse: 'spouse',
  grandparent: 'grandchild',
  grandchild: 'grandparent',
  manager: 'reports_to',
  reports_to: 'manager',
})

async function loadPerson(db, wsId, personId, { includeDeleted = false } = {}) {
  if (!isUuid(personId)) throw badRequest('Invalid person id')
  const row = unwrap(await db.from('people').select(PERSON_FIELDS).eq('workspace_id', wsId).eq('id', personId).maybeSingle(), 'Load person')
  if (!row || (row.deleted_at && !includeDeleted)) throw notFound('Person not found')
  return row
}

async function loadGroupsFor(db, wsId, personIds) {
  const map = new Map(personIds.map((id) => [id, []]))
  if (!personIds.length) return map
  const rows = unwrap(
    await db.from('person_groups').select('person_id, role_in_group, group:groups!group_id(id, name, color, parent_group_id)').eq('workspace_id', wsId).in('person_id', personIds),
    'Load person groups',
  )
  for (const r of rows) {
    if (!r.group) continue
    map.get(r.person_id)?.push({ id: r.group.id, name: r.group.name, color: r.group.color, parent_group_id: r.group.parent_group_id, role_in_group: r.role_in_group })
  }
  return map
}

async function loadRelationships(db, wsId, personId) {
  const rows = unwrap(
    await db
      .from('person_relationships')
      .select(`${REL_FIELDS}, to_person:people!to_person_id(id, display_name, avatar_key, deleted_at)`)
      .eq('workspace_id', wsId)
      .eq('from_person_id', personId)
      .order('created_at'),
    'Load relationships',
  )
  return rows
    .filter((r) => r.to_person && !r.to_person.deleted_at)
    .map((r) => ({
      id: r.id,
      relation: r.relation,
      custom_label: r.custom_label,
      created_at: r.created_at,
      to_person: { id: r.to_person.id, display_name: r.to_person.display_name, avatar_key: r.to_person.avatar_key },
    }))
}

/** people has a unique (workspace_id, user_id) constraint: one person per linked member. */
async function assertUserLinkFree(db, wsId, userId, selfPersonId) {
  if (!userId) return
  const member = unwrap(await db.from('workspace_members').select('id').eq('workspace_id', wsId).eq('user_id', userId).maybeSingle(), 'Verify member')
  if (!member) throw badRequest('user_id must be a member of this workspace')
  let q = db.from('people').select('id, display_name').eq('workspace_id', wsId).eq('user_id', userId).is('deleted_at', null)
  if (selfPersonId) q = q.neq('id', selfPersonId)
  const other = unwrap(await q.maybeSingle(), 'Verify person link')
  if (other) throw conflict(`This member is already linked to "${other.display_name}"`)
}

async function setGroups(db, wsId, personId, groupIds, actorId) {
  const ids = [...new Set(groupIds)]
  if (ids.length) {
    const found = unwrap(await db.from('groups').select('id').eq('workspace_id', wsId).in('id', ids), 'Verify groups')
    if (found.length !== ids.length) throw badRequest('One or more groups do not exist in this workspace')
  }
  unwrap(await db.from('person_groups').delete().eq('workspace_id', wsId).eq('person_id', personId), 'Clear person groups')
  if (ids.length) {
    unwrap(await db.from('person_groups').insert(ids.map((group_id) => ({ person_id: personId, group_id, workspace_id: wsId, created_by: actorId }))), 'Link groups')
  }
}

// GET /people?q=&group_id=&deleted=1
people.get('/', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const { q, group_id, deleted } = c.req.query()
  let query = db.from('people').select(PERSON_FIELDS).eq('workspace_id', m.workspace_id).order('display_name')
  query = deleted === '1' ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null)
  if (q) query = query.ilike('display_name', `%${q.replace(/[%_]/g, '')}%`)
  if (group_id) {
    if (!isUuid(group_id)) throw badRequest('Invalid group id')
    const links = unwrap(await db.from('person_groups').select('person_id').eq('workspace_id', m.workspace_id).eq('group_id', group_id), 'Filter by group')
    const ids = links.map((l) => l.person_id)
    if (!ids.length) return c.json({ people: [] })
    query = query.in('id', ids)
  }
  const rows = unwrap(await query, 'List people')
  const groupsMap = await loadGroupsFor(db, m.workspace_id, rows.map((p) => p.id))
  return c.json({ people: rows.map((p) => ({ ...p, groups: groupsMap.get(p.id) || [] })) })
})

// POST /people (editor+)
people.post('/', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const { group_ids, ...body } = await parseJson(c, personCreate)
  await assertUserLinkFree(db, m.workspace_id, body.user_id, null)
  const person = unwrap(
    await db.from('people').insert({ ...body, workspace_id: m.workspace_id, created_by: c.get('user').id }).select(PERSON_FIELDS).single(),
    'Create person',
  )
  if (group_ids?.length) await setGroups(db, m.workspace_id, person.id, group_ids, c.get('user').id)
  await activityFor(c)('person.created', 'person', person.id, { display_name: person.display_name })
  const groupsMap = await loadGroupsFor(db, m.workspace_id, [person.id])
  return c.json({ person: { ...person, groups: groupsMap.get(person.id) || [] } }, 201)
})

// GET /people/:pid
people.get('/:pid', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const person = await loadPerson(db, m.workspace_id, c.req.param('pid'), { includeDeleted: true })
  const [groupsMap, relationships] = await Promise.all([loadGroupsFor(db, m.workspace_id, [person.id]), loadRelationships(db, m.workspace_id, person.id)])
  return c.json({ person: { ...person, groups: groupsMap.get(person.id) || [], relationships } })
})

// PATCH /people/:pid (editor+)
people.patch('/:pid', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const existing = await loadPerson(db, m.workspace_id, c.req.param('pid'))
  const { group_ids, ...patch } = await parseJson(c, personPatch)
  if (patch.user_id) await assertUserLinkFree(db, m.workspace_id, patch.user_id, existing.id)
  const person = unwrap(
    await db.from('people').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', existing.id).eq('workspace_id', m.workspace_id).select(PERSON_FIELDS).single(),
    'Update person',
  )
  if (group_ids) await setGroups(db, m.workspace_id, person.id, group_ids, c.get('user').id)
  await activityFor(c)('person.updated', 'person', person.id, { fields: Object.keys(patch) })
  const groupsMap = await loadGroupsFor(db, m.workspace_id, [person.id])
  return c.json({ person: { ...person, groups: groupsMap.get(person.id) || [] } })
})

// DELETE /people/:pid (editor+, soft delete)
people.delete('/:pid', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const person = await loadPerson(db, m.workspace_id, c.req.param('pid'))
  unwrap(await db.from('people').update({ deleted_at: new Date().toISOString() }).eq('id', person.id).eq('workspace_id', m.workspace_id), 'Delete person')
  await activityFor(c)('person.deleted', 'person', person.id, { display_name: person.display_name })
  return c.json({ ok: true })
})

// POST /people/:pid/restore (editor+)
people.post('/:pid/restore', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const existing = await loadPerson(db, m.workspace_id, c.req.param('pid'), { includeDeleted: true })
  const person = unwrap(
    await db.from('people').update({ deleted_at: null, updated_at: new Date().toISOString() }).eq('id', existing.id).eq('workspace_id', m.workspace_id).select(PERSON_FIELDS).single(),
    'Restore person',
  )
  await activityFor(c)('person.restored', 'person', person.id)
  return c.json({ person })
})

/* ---------- relationships ---------- */

// GET /people/:pid/relationships
people.get('/:pid/relationships', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const person = await loadPerson(db, m.workspace_id, c.req.param('pid'))
  return c.json({ relationships: await loadRelationships(db, m.workspace_id, person.id) })
})

// POST /people/:pid/relationships { to_person_id, relation, custom_label } (editor+)
people.post('/:pid/relationships', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const from = await loadPerson(db, m.workspace_id, c.req.param('pid'))
  const body = await parseJson(c, relationshipCreate)
  if (body.to_person_id === from.id) throw badRequest('A person cannot have a relationship with themselves')
  if (body.relation === 'custom' && !body.custom_label) throw badRequest('custom_label is required for a custom relation')
  const to = await loadPerson(db, m.workspace_id, body.to_person_id)

  const dup = unwrap(
    await db.from('person_relationships').select('id').eq('workspace_id', m.workspace_id).eq('from_person_id', from.id).eq('to_person_id', to.id).eq('relation', body.relation).maybeSingle(),
    'Check relationship',
  )
  if (dup) throw conflict('This relationship already exists')

  const relationship = unwrap(
    await db
      .from('person_relationships')
      .insert({ workspace_id: m.workspace_id, from_person_id: from.id, to_person_id: to.id, relation: body.relation, custom_label: body.custom_label ?? null, created_by: c.get('user').id })
      .select(REL_FIELDS)
      .single(),
    'Create relationship',
  )

  const inverse = INVERSE[body.relation]
  if (inverse) {
    // unique (from_person_id, to_person_id, relation) makes a duplicate inverse a harmless no-op
    await db
      .from('person_relationships')
      .upsert(
        { workspace_id: m.workspace_id, from_person_id: to.id, to_person_id: from.id, relation: inverse, custom_label: null, created_by: c.get('user').id },
        { onConflict: 'from_person_id,to_person_id,relation', ignoreDuplicates: true },
      )
  }

  await activityFor(c)('relationship.created', 'person', from.id, { to_person_id: to.id, relation: body.relation, inverse: inverse || null })
  return c.json({ relationship: { ...relationship, to_person: { id: to.id, display_name: to.display_name, avatar_key: to.avatar_key } } }, 201)
})

// DELETE /people/:pid/relationships/:rid (editor+). Also removes the stored inverse.
people.delete('/:pid/relationships/:rid', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const rid = c.req.param('rid')
  if (!isUuid(rid)) throw badRequest('Invalid relationship id')
  const person = await loadPerson(db, m.workspace_id, c.req.param('pid'), { includeDeleted: true })
  const rel = unwrap(
    await db.from('person_relationships').select(REL_FIELDS).eq('workspace_id', m.workspace_id).eq('id', rid).eq('from_person_id', person.id).maybeSingle(),
    'Load relationship',
  )
  if (!rel) throw notFound('Relationship not found')
  unwrap(await db.from('person_relationships').delete().eq('id', rel.id).eq('workspace_id', m.workspace_id), 'Delete relationship')
  const inverse = INVERSE[rel.relation]
  if (inverse) {
    await db.from('person_relationships').delete().eq('workspace_id', m.workspace_id).eq('from_person_id', rel.to_person_id).eq('to_person_id', rel.from_person_id).eq('relation', inverse)
  }
  await activityFor(c)('relationship.deleted', 'person', person.id, { to_person_id: rel.to_person_id, relation: rel.relation })
  return c.json({ ok: true })
})

/* ---------- groups ---------- */

// POST /people/:pid/groups { group_id, role_in_group } (editor+)
people.post('/:pid/groups', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const person = await loadPerson(db, m.workspace_id, c.req.param('pid'))
  const body = await parseJson(c, personGroupLink)
  const group = unwrap(await db.from('groups').select('id, name').eq('workspace_id', m.workspace_id).eq('id', body.group_id).maybeSingle(), 'Load group')
  if (!group) throw notFound('Group not found')
  unwrap(
    await db
      .from('person_groups')
      .upsert(
        { person_id: person.id, group_id: group.id, workspace_id: m.workspace_id, role_in_group: body.role_in_group ?? null, created_by: c.get('user').id },
        { onConflict: 'person_id,group_id' },
      ),
    'Link person to group',
  )
  await activityFor(c)('person.group_added', 'person', person.id, { group_id: group.id, group_name: group.name })
  return c.json({ ok: true })
})

// DELETE /people/:pid/groups/:groupId (editor+)
people.delete('/:pid/groups/:groupId', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const groupId = c.req.param('groupId')
  if (!isUuid(groupId)) throw badRequest('Invalid group id')
  const person = await loadPerson(db, m.workspace_id, c.req.param('pid'), { includeDeleted: true })
  unwrap(await db.from('person_groups').delete().eq('workspace_id', m.workspace_id).eq('person_id', person.id).eq('group_id', groupId), 'Unlink group')
  await activityFor(c)('person.group_removed', 'person', person.id, { group_id: groupId })
  return c.json({ ok: true })
})

export default people
