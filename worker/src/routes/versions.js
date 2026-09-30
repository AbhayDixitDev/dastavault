import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { notImplemented } from '../lib/errors.js'

/**
 * Phase 7 - document versions & timeline. Mounted at /api/workspaces/:ws/documents/:id/versions
 * (Creating a new version by uploading a file already works via POST /uploads with new_version=1.)
 */
const versions = new Hono()

// GET /documents/:id/versions
versions.get('/', () => {
  throw notImplemented()
})

// POST /documents/:id/versions { label }  (editor+)
versions.post('/', requireRole('editor'), () => {
  throw notImplemented()
})

// PATCH /documents/:id/versions/:vid { label }  (editor+)
versions.patch('/:vid', requireRole('editor'), () => {
  throw notImplemented()
})

// POST /documents/:id/versions/:vid/make-current  (editor+)
versions.post('/:vid/make-current', requireRole('editor'), () => {
  throw notImplemented()
})

// DELETE /documents/:id/versions/:vid  (admin+)
versions.delete('/:vid', requireRole('admin'), () => {
  throw notImplemented()
})

export default versions
