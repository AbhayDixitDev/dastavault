import { Hono } from 'hono'
import { requireAuth } from '../lib/auth.js'
import { unwrap, notFound, badRequest } from '../lib/errors.js'
import { parseQuery, notificationsQuery } from '../lib/validate.js'
import { applyCursor, pageResult } from '../lib/pagination.js'
import { isUuid } from '../lib/ids.js'

const notifications = new Hono()
notifications.use('*', requireAuth())

const FIELDS = 'id, user_id, workspace_id, type, title, body, data, read_at, created_at'

// GET /api/notifications?unread=1&workspace_id=&limit=&cursor=
notifications.get('/', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const q = parseQuery(c, notificationsQuery)
  let query = db.from('notifications').select(FIELDS).eq('user_id', user.id)
  if (q.unread === '1' || q.unread === 'true') query = query.is('read_at', null)
  if (q.workspace_id) query = query.eq('workspace_id', q.workspace_id)
  const rows = unwrap(await applyCursor(query, q.cursor, q.limit), 'List notifications')
  const unreadRes = await db.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('read_at', null)
  return c.json({ ...pageResult(rows, q.limit), unread_count: unreadRes.count ?? 0 })
})

// PATCH /api/notifications/read-all
notifications.patch('/read-all', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  unwrap(await db.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', user.id).is('read_at', null), 'Mark all read')
  return c.json({ ok: true })
})

// PATCH /api/notifications/:id/read
notifications.patch('/:id/read', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')
  if (!isUuid(id)) throw badRequest('Invalid notification id')
  const rows = unwrap(
    await db.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id).select(FIELDS),
    'Mark read',
  )
  if (!rows.length) throw notFound('Notification not found')
  return c.json({ notification: rows[0] })
})

export default notifications
