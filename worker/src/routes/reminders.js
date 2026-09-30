import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { notImplemented } from '../lib/errors.js'

/** Phase 7 - expiry / renewal reminders. Mounted at /api/workspaces/:ws/reminders */
const reminders = new Hono()

reminders.get('/', () => {
  throw notImplemented()
})
reminders.post('/', requireRole('editor'), () => {
  throw notImplemented()
})
reminders.patch('/:rid', requireRole('editor'), () => {
  throw notImplemented()
})
reminders.delete('/:rid', requireRole('editor'), () => {
  throw notImplemented()
})

export default reminders
