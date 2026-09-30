import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { unwrap, notFound, badRequest, forbidden } from '../lib/errors.js'
import { parseJson, parseQuery, noteCreate, notePatch, notesQuery } from '../lib/validate.js'
import { applyCursor, pageResult } from '../lib/pagination.js'
import { activityFor } from '../lib/activity.js'
import { isUuid } from '../lib/ids.js'
import { sanitizeHtml, htmlToText } from '../lib/sanitize.js'

/**
 * Notes (contract section 7). Mounted at /api/workspaces/:ws/notes
 * - soft delete (deleted_at) + restore
 * - optimistic concurrency: PATCH with a stale `updated_at` -> 409 { code: 'conflict', note }
 * - HTML sanitised again server side; note_links replaced when `links` is sent
 */
const notes = new Hono()

const NOTE_FIELDS = 'id, workspace_id, title, content_html, content_text, color, tags, is_pinned, is_private, encrypted_blob, iv, template, created_by, deleted_at, created_at, updated_at'
const LINK_FIELDS = 'id, entity_type, entity_id, created_at'

const canSee = (note, m) => !note.is_private || note.created_by === m.user_id
const canEdit = (note, m) => note.created_by === m.user_id || (m.rank >= 40 && !note.is_private)

async function loadNote(db, wsId, id, { includeDeleted = false } = {}) {
  if (!isUuid(id)) throw badRequest('Invalid note id')
  const n = unwrap(await db.from('notes').select(NOTE_FIELDS).eq('workspace_id', wsId).eq('id', id).maybeSingle(), 'Load note')
  if (!n || (n.deleted_at && !includeDeleted)) throw notFound('Note not found')
  return n
}

async function loadLinks(db, noteId) {
  return unwrap(await db.from('note_links').select(LINK_FIELDS).eq('note_id', noteId).order('created_at'), 'Load note links')
}

async function replaceLinks(db, wsId, noteId, links, actorId) {
  unwrap(await db.from('note_links').delete().eq('note_id', noteId), 'Clear note links')
  const unique = new Map(links.map((l) => [`${l.entity_type}:${l.entity_id}`, l]))
  if (unique.size) {
    unwrap(
      await db.from('note_links').insert([...unique.values()].map((l) => ({ workspace_id: wsId, note_id: noteId, entity_type: l.entity_type, entity_id: l.entity_id, created_by: actorId }))),
      'Link note',
    )
  }
}

function prepareContent(body) {
  const out = {}
  if (body.content_html !== undefined) {
    out.content_html = sanitizeHtml(body.content_html)
    out.content_text = body.content_text !== undefined && body.content_text !== '' ? body.content_text : htmlToText(out.content_html)
  } else if (body.content_text !== undefined) out.content_text = body.content_text
  return out
}

// GET /notes?q&pinned=1&cursor&limit
notes.get('/', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const q = parseQuery(c, notesQuery)
  let query = db.from('notes').select(NOTE_FIELDS).eq('workspace_id', m.workspace_id).is('deleted_at', null).or(`is_private.eq.false,created_by.eq.${m.user_id}`)
  if (q.pinned) query = query.eq('is_pinned', true)
  if (q.q) {
    const term = q.q.replace(/[%_,()]/g, ' ').trim()
    if (term.length >= 3) query = query.textSearch('search_text', term, { type: 'websearch', config: 'english' })
    else if (term) query = query.ilike('title', `%${term}%`)
  }
  const rows = unwrap(await applyCursor(query, q.cursor, q.limit), 'List notes')
  const page = pageResult(rows, q.limit)
  return c.json({ notes: page.items, next_cursor: page.next_cursor })
})

// GET /notes/trash (editor+)
notes.get('/trash', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const q = parseQuery(c, notesQuery)
  const query = db.from('notes').select(NOTE_FIELDS).eq('workspace_id', m.workspace_id).not('deleted_at', 'is', null).or(`is_private.eq.false,created_by.eq.${m.user_id}`)
  const rows = unwrap(await applyCursor(query, q.cursor, q.limit), 'List trashed notes')
  const page = pageResult(rows, q.limit)
  return c.json({ notes: page.items, next_cursor: page.next_cursor })
})

// POST /notes (editor+)
notes.post('/', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const { links, ...body } = await parseJson(c, noteCreate)
  if (body.is_private && !body.encrypted_blob) throw badRequest('Private notes must send encrypted_blob and iv')
  const content = prepareContent(body)
  const note = unwrap(
    await db
      .from('notes')
      .insert({
        workspace_id: m.workspace_id,
        title: body.title,
        ...content,
        color: body.color ?? null,
        tags: body.tags,
        is_pinned: body.is_pinned,
        is_private: body.is_private,
        encrypted_blob: body.encrypted_blob ?? null,
        iv: body.iv ?? null,
        template: body.template ?? null,
        created_by: user.id,
      })
      .select(NOTE_FIELDS)
      .single(),
    'Create note',
  )
  if (links?.length) await replaceLinks(db, m.workspace_id, note.id, links, user.id)
  await activityFor(c)('note.created', 'note', note.id, { title: note.title }, `created note "${note.title || 'Untitled'}"`)
  return c.json({ note: { ...note, links: await loadLinks(db, note.id) } }, 201)
})

// GET /notes/:id
notes.get('/:nid', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const note = await loadNote(db, m.workspace_id, c.req.param('nid'), { includeDeleted: true })
  if (!canSee(note, m)) throw forbidden('This note is private')
  return c.json({ note: { ...note, links: await loadLinks(db, note.id) } })
})

// PATCH /notes/:id (editor+), `updated_at` for optimistic concurrency
notes.patch('/:nid', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const existing = await loadNote(db, m.workspace_id, c.req.param('nid'))
  if (!canSee(existing, m) || !canEdit(existing, m)) throw forbidden('You cannot edit this note')
  const { links, updated_at, ...body } = await parseJson(c, notePatch)
  if (updated_at && new Date(updated_at).getTime() < new Date(existing.updated_at).getTime() - 500) {
    return c.json({ error: 'This note was changed by someone else. Reload to see the latest version.', code: 'conflict', note: { ...existing, links: await loadLinks(db, existing.id) }, request_id: c.get('requestId') }, 409)
  }
  const isPrivate = body.is_private ?? existing.is_private
  if (isPrivate && !(body.encrypted_blob ?? existing.encrypted_blob)) throw badRequest('Private notes must send encrypted_blob and iv')
  const { content_html: _html, content_text: _text, ...rest } = body
  const patch = { ...rest, ...prepareContent(body), updated_at: new Date().toISOString() }
  const note = unwrap(await db.from('notes').update(patch).eq('id', existing.id).eq('workspace_id', m.workspace_id).select(NOTE_FIELDS).single(), 'Update note')
  if (links) await replaceLinks(db, m.workspace_id, note.id, links, user.id)
  await activityFor(c)('note.updated', 'note', note.id, { fields: Object.keys(body) }, `updated note "${note.title || 'Untitled'}"`)
  return c.json({ note: { ...note, links: await loadLinks(db, note.id) } })
})

// DELETE /notes/:id (editor+, soft)
notes.delete('/:nid', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const note = await loadNote(db, m.workspace_id, c.req.param('nid'))
  if (!canSee(note, m) || !canEdit(note, m)) throw forbidden('You cannot delete this note')
  unwrap(await db.from('notes').update({ deleted_at: new Date().toISOString() }).eq('id', note.id).eq('workspace_id', m.workspace_id), 'Delete note')
  await activityFor(c)('note.deleted', 'note', note.id, { title: note.title }, `moved note "${note.title || 'Untitled'}" to trash`)
  return c.json({ ok: true })
})

// POST /notes/:id/restore (editor+)
notes.post('/:nid/restore', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const existing = await loadNote(db, m.workspace_id, c.req.param('nid'), { includeDeleted: true })
  if (!canSee(existing, m) || !canEdit(existing, m)) throw forbidden('You cannot restore this note')
  const note = unwrap(
    await db.from('notes').update({ deleted_at: null, updated_at: new Date().toISOString() }).eq('id', existing.id).eq('workspace_id', m.workspace_id).select(NOTE_FIELDS).single(),
    'Restore note',
  )
  await activityFor(c)('note.restored', 'note', note.id, { title: note.title }, `restored note "${note.title || 'Untitled'}"`)
  return c.json({ note: { ...note, links: await loadLinks(db, note.id) } })
})

export default notes
