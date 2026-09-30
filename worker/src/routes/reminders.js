import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { unwrap, notFound, badRequest } from '../lib/errors.js'
import { parseJson, parseQuery, reminderCreate, reminderPatch, remindersQuery, expiringQuery } from '../lib/validate.js'
import { activityFor } from '../lib/activity.js'
import { isUuid } from '../lib/ids.js'
import { loadDocument, scopedDocumentsQuery, attachSummaries } from '../lib/docs.js'

/**
 * Reminders (contract section 5). Mounted at /api/workspaces/:ws/reminders, plus
 * POST /documents/:id/reminders/auto (documentReminderRoutes).
 *
 * Column mapping (table: 007_albums_reminders_activity.sql + 011):
 *   field <-> field_name, channel <-> channels[] (in_app/email), status stored as the API values.
 */
const reminders = new Hono()
export const documentReminderRoutes = new Hono()

const R_FIELDS = 'id, workspace_id, document_id, person_id, title, field_name, due_date, days_before, remind_at, channels, status, sent_at, user_id, created_by, created_at, updated_at'
const DAY_MS = 24 * 60 * 60 * 1000
const AUTO_DAYS = [30, 7, 1]

const statusToApi = (s) => (s === 'scheduled' ? 'pending' : s === 'dismissed' || s === 'cancelled' ? 'done' : s)
const channelsToApi = (ch) => {
  const list = Array.isArray(ch) ? ch : []
  const app = list.includes('in_app') || list.includes('app')
  const email = list.includes('email')
  return app && email ? 'both' : email ? 'email' : 'app'
}
const channelsToDb = (c) => (c === 'both' ? ['in_app', 'email'] : c === 'email' ? ['email'] : ['in_app'])

export function publicReminder(r, documentName = null) {
  return {
    id: r.id,
    document_id: r.document_id,
    document_name: documentName,
    title: r.title,
    remind_at: r.remind_at,
    due_date: r.due_date,
    days_before: r.days_before,
    field: r.field_name,
    channel: channelsToApi(r.channels),
    status: statusToApi(r.status),
    sent_at: r.sent_at,
    created_by: r.created_by,
    created_at: r.created_at,
  }
}

function dueFor(doc, field, remindAt) {
  const remind = new Date(remindAt)
  let due = null
  if (field && doc && typeof doc[field] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(doc[field])) due = new Date(`${doc[field]}T09:00:00Z`)
  if (!due) due = remind
  const daysBefore = Math.max(0, Math.round((due.getTime() - remind.getTime()) / DAY_MS))
  return { due_date: due.toISOString().slice(0, 10), days_before: daysBefore }
}

async function loadReminder(db, wsId, id) {
  if (!isUuid(id)) throw badRequest('Invalid reminder id')
  const r = unwrap(await db.from('reminders').select(R_FIELDS).eq('workspace_id', wsId).eq('id', id).maybeSingle(), 'Load reminder')
  if (!r) throw notFound('Reminder not found')
  return r
}

/** Attaches document names and drops reminders on documents the caller cannot see. */
async function withDocuments(db, m, rows) {
  const ids = [...new Set(rows.map((r) => r.document_id).filter(Boolean))]
  if (!ids.length) return rows.map((r) => publicReminder(r))
  const base = scopedDocumentsQuery(db, m, 'id, name, deleted_at')
  const docs = unwrap(await base.in('id', ids), 'Load reminder documents')
  const byId = new Map(docs.map((d) => [d.id, d]))
  return rows.filter((r) => !r.document_id || byId.has(r.document_id)).map((r) => publicReminder(r, byId.get(r.document_id)?.name ?? null))
}

// GET /reminders?upcoming_days=30&document_id=
reminders.get('/', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const q = parseQuery(c, remindersQuery)
  const horizon = new Date(Date.now() + q.upcoming_days * DAY_MS).toISOString()
  let query = db.from('reminders').select(R_FIELDS).eq('workspace_id', m.workspace_id).in('status', ['pending', 'scheduled', 'snoozed', 'sent']).lte('remind_at', horizon)
  if (q.document_id) query = query.eq('document_id', q.document_id)
  const rows = unwrap(await query.order('remind_at', { ascending: true }).limit(300), 'List reminders')
  return c.json({ reminders: await withDocuments(db, m, rows) })
})

// GET /reminders/expiring?days=30 -> { documents: [Doc & { days_left }] }
reminders.get('/expiring', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const q = parseQuery(c, expiringQuery)
  const today = new Date().toISOString().slice(0, 10)
  const to = new Date(Date.now() + q.days * DAY_MS).toISOString().slice(0, 10)
  const base = scopedDocumentsQuery(db, m)
  const docs = unwrap(await base.is('deleted_at', null).gte('expiry_date', today).lte('expiry_date', to).order('expiry_date', { ascending: true }).limit(200), 'List expiring documents')
  await attachSummaries(db, m.workspace_id, docs)
  const now = Date.parse(`${today}T00:00:00Z`)
  return c.json({ documents: docs.map((d) => ({ ...d, days_left: Math.round((Date.parse(`${d.expiry_date}T00:00:00Z`) - now) / DAY_MS) })) })
})

// POST /reminders { document_id, title, remind_at, field?, channel? } (editor+)
reminders.post('/', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const body = await parseJson(c, reminderCreate)
  const doc = await loadDocument(db, m.workspace_id, body.document_id)
  const remindAt = new Date(body.remind_at).toISOString()
  const reminder = unwrap(
    await db
      .from('reminders')
      .insert({
        workspace_id: m.workspace_id,
        document_id: doc.id,
        title: body.title,
        field_name: body.field ?? null,
        remind_at: remindAt,
        ...dueFor(doc, body.field, remindAt),
        channels: channelsToDb(body.channel),
        status: 'pending',
        created_by: c.get('user').id,
      })
      .select(R_FIELDS)
      .single(),
    'Create reminder',
  )
  await activityFor(c)('reminder.created', 'document', doc.id, { reminder_id: reminder.id, remind_at: remindAt, title: body.title }, `set a reminder "${body.title}" on "${doc.name}"`)
  return c.json({ reminder: publicReminder(reminder, doc.name) }, 201)
})

// PATCH /reminders/:id { title?, remind_at?, status?, channel? } (editor+)
reminders.patch('/:rid', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const existing = await loadReminder(db, m.workspace_id, c.req.param('rid'))
  const body = await parseJson(c, reminderPatch)
  const patch = { updated_at: new Date().toISOString() }
  if (body.title !== undefined) patch.title = body.title
  if (body.status !== undefined) patch.status = body.status
  if (body.channel !== undefined) patch.channels = channelsToDb(body.channel)
  let doc = null
  if (existing.document_id) doc = unwrap(await db.from('documents').select('id, name, issue_date, expiry_date').eq('id', existing.document_id).maybeSingle(), 'Load document')
  if (body.remind_at !== undefined) {
    patch.remind_at = new Date(body.remind_at).toISOString()
    Object.assign(patch, dueFor(doc, existing.field_name, patch.remind_at))
    if (body.status === undefined && ['sent', 'done'].includes(statusToApi(existing.status))) patch.status = 'pending'
  }
  const reminder = unwrap(await db.from('reminders').update(patch).eq('id', existing.id).eq('workspace_id', m.workspace_id).select(R_FIELDS).single(), 'Update reminder')
  return c.json({ reminder: publicReminder(reminder, doc?.name ?? null) })
})

// DELETE /reminders/:id (editor+)
reminders.delete('/:rid', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const existing = await loadReminder(db, m.workspace_id, c.req.param('rid'))
  unwrap(await db.from('reminders').delete().eq('id', existing.id).eq('workspace_id', m.workspace_id), 'Delete reminder')
  return c.json({ ok: true })
})

// POST /documents/:id/reminders/auto (editor+) -> { reminders } (30 / 7 / 1 days before expiry_date)
documentReminderRoutes.post('/:id/reminders/auto', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'))
  if (!doc.expiry_date) throw badRequest('This document has no expiry date')
  const expiry = new Date(`${doc.expiry_date}T09:00:00Z`)
  const existing = unwrap(await db.from('reminders').select(R_FIELDS).eq('document_id', doc.id).eq('field_name', 'expiry_date'), 'Load reminders')
  const have = new Set(existing.map((r) => r.days_before))
  const now = Date.now()
  const rows = []
  for (const days of AUTO_DAYS) {
    if (have.has(days)) continue
    const remindAt = new Date(expiry.getTime() - days * DAY_MS)
    if (remindAt.getTime() <= now) continue
    rows.push({
      workspace_id: m.workspace_id,
      document_id: doc.id,
      title: `${doc.name} expires in ${days} day${days === 1 ? '' : 's'}`,
      field_name: 'expiry_date',
      due_date: doc.expiry_date,
      days_before: days,
      remind_at: remindAt.toISOString(),
      channels: ['in_app', 'email'],
      status: 'pending',
      created_by: c.get('user').id,
    })
  }
  if (rows.length) unwrap(await db.from('reminders').insert(rows), 'Create reminders')
  const all = unwrap(await db.from('reminders').select(R_FIELDS).eq('document_id', doc.id).eq('field_name', 'expiry_date').order('remind_at'), 'Load reminders')
  if (rows.length) await activityFor(c)('reminder.created', 'document', doc.id, { auto: true, count: rows.length }, `set expiry reminders on "${doc.name}"`)
  return c.json({ reminders: all.map((r) => publicReminder(r, doc.name)) }, rows.length ? 201 : 200)
})

export default reminders
