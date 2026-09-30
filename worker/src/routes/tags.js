import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { unwrap, notFound, badRequest, conflict } from '../lib/errors.js'
import { parseJson, tagCreate, tagPatch } from '../lib/validate.js'
import { activityFor } from '../lib/activity.js'
import { isUuid } from '../lib/ids.js'

/** Tags (contract section 3). Mounted at /api/workspaces/:ws/tags */
const tags = new Hono()

export const TAG_FIELDS = 'id, workspace_id, name, color, created_by, created_at, updated_at'

/** Tags linked to a document. */
export async function loadDocumentTags(db, docId) {
  const rows = unwrap(await db.from('document_tags').select('tag:tags!tag_id(id, name, color)').eq('document_id', docId), 'Load document tags')
  return rows.filter((r) => r.tag).map((r) => r.tag).sort((a, b) => a.name.localeCompare(b.name))
}

/** Resolves tag ids + names (creating missing names, case-insensitively) to a unique list of ids. */
export async function resolveTagIds(db, wsId, { tagIds = [], names = [] }, actorId) {
  const ids = new Set()
  if (tagIds.length) {
    const found = unwrap(await db.from('tags').select('id').eq('workspace_id', wsId).in('id', [...new Set(tagIds)]), 'Verify tags')
    if (found.length !== new Set(tagIds).size) throw badRequest('One or more tags do not exist in this workspace')
    for (const t of found) ids.add(t.id)
  }
  const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  if (wanted.length) {
    const existing = unwrap(await db.from('tags').select('id, name').eq('workspace_id', wsId), 'Load tags')
    const byLower = new Map(existing.map((t) => [t.name.toLowerCase(), t]))
    for (const name of wanted) {
      const hit = byLower.get(name.toLowerCase())
      if (hit) {
        ids.add(hit.id)
        continue
      }
      const created = unwrap(await db.from('tags').insert({ workspace_id: wsId, name, created_by: actorId }).select('id, name').single(), 'Create tag')
      byLower.set(name.toLowerCase(), created)
      ids.add(created.id)
    }
  }
  return [...ids]
}

async function loadTag(db, wsId, id) {
  if (!isUuid(id)) throw badRequest('Invalid tag id')
  const t = unwrap(await db.from('tags').select(TAG_FIELDS).eq('workspace_id', wsId).eq('id', id).maybeSingle(), 'Load tag')
  if (!t) throw notFound('Tag not found')
  return t
}

// GET /tags -> { tags: [{ id, name, color, document_count }] }
tags.get('/', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const rows = unwrap(await db.from('tags').select(TAG_FIELDS).eq('workspace_id', m.workspace_id).order('name'), 'List tags')
  const counts = new Map()
  if (rows.length) {
    const links = unwrap(await db.from('document_tags').select('tag_id').eq('workspace_id', m.workspace_id).limit(20000), 'Count tags')
    for (const l of links) counts.set(l.tag_id, (counts.get(l.tag_id) || 0) + 1)
  }
  return c.json({ tags: rows.map((t) => ({ ...t, document_count: counts.get(t.id) || 0 })) })
})

// POST /tags { name, color? } (editor+)
tags.post('/', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const body = await parseJson(c, tagCreate)
  const dup = unwrap(await db.from('tags').select('id').eq('workspace_id', m.workspace_id).ilike('name', body.name.replace(/[%_]/g, '')).maybeSingle(), 'Check tag')
  if (dup) throw conflict('A tag with this name already exists')
  const tag = unwrap(await db.from('tags').insert({ workspace_id: m.workspace_id, name: body.name, color: body.color ?? null, created_by: c.get('user').id }).select(TAG_FIELDS).single(), 'Create tag')
  await activityFor(c)('tag.created', 'tag', tag.id, { name: tag.name }, `created tag "${tag.name}"`)
  return c.json({ tag: { ...tag, document_count: 0 } }, 201)
})

// PATCH /tags/:id { name?, color? } (editor+)
tags.patch('/:id', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const existing = await loadTag(db, m.workspace_id, c.req.param('id'))
  const body = await parseJson(c, tagPatch)
  if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase()) {
    const dup = unwrap(await db.from('tags').select('id').eq('workspace_id', m.workspace_id).ilike('name', body.name.replace(/[%_]/g, '')).neq('id', existing.id).maybeSingle(), 'Check tag')
    if (dup) throw conflict('A tag with this name already exists')
  }
  const tag = unwrap(await db.from('tags').update({ ...body, updated_at: new Date().toISOString() }).eq('id', existing.id).eq('workspace_id', m.workspace_id).select(TAG_FIELDS).single(), 'Update tag')
  const countRes = await db.from('document_tags').select('id', { count: 'exact', head: true }).eq('tag_id', tag.id)
  return c.json({ tag: { ...tag, document_count: countRes.count ?? 0 } })
})

// DELETE /tags/:id (admin+)
tags.delete('/:id', requireRole('admin'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const tag = await loadTag(db, m.workspace_id, c.req.param('id'))
  unwrap(await db.from('tags').delete().eq('id', tag.id).eq('workspace_id', m.workspace_id), 'Delete tag')
  await activityFor(c)('tag.deleted', 'tag', tag.id, { name: tag.name }, `deleted tag "${tag.name}"`)
  return c.json({ ok: true })
})

export default tags
