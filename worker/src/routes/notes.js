import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { notImplemented } from '../lib/errors.js'

/**
 * Phase 9 - Notes and Write (rich text sanitised with DOMPurify on save and render).
 * Mounted at /api/workspaces/:ws/notes
 */
const notes = new Hono()

notes.get('/', () => {
  throw notImplemented()
})
notes.post('/', requireRole('editor'), () => {
  throw notImplemented()
})
notes.get('/:nid', () => {
  throw notImplemented()
})
notes.patch('/:nid', requireRole('editor'), () => {
  throw notImplemented()
})
notes.delete('/:nid', requireRole('editor'), () => {
  throw notImplemented()
})
// note_links: link a note to a document / person
notes.post('/:nid/links', requireRole('editor'), () => {
  throw notImplemented()
})
notes.delete('/:nid/links/:lid', requireRole('editor'), () => {
  throw notImplemented()
})

export default notes
