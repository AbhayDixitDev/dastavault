import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { notImplemented } from '../lib/errors.js'

/** Phase 7 - albums and smart albums. Mounted at /api/workspaces/:ws/albums */
const albums = new Hono()

albums.get('/', () => {
  throw notImplemented()
})
albums.post('/', requireRole('editor'), () => {
  throw notImplemented()
})
albums.get('/:aid', () => {
  throw notImplemented()
})
albums.patch('/:aid', requireRole('editor'), () => {
  throw notImplemented()
})
albums.delete('/:aid', requireRole('editor'), () => {
  throw notImplemented()
})
albums.post('/:aid/items', requireRole('editor'), () => {
  throw notImplemented()
})
albums.delete('/:aid/items/:docId', requireRole('editor'), () => {
  throw notImplemented()
})

export default albums
