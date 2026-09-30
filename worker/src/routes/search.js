import { Hono } from 'hono'
import { notImplemented } from '../lib/errors.js'

/**
 * Phase 5/6 - search (keyword, then vector). Mounted at /api/workspaces/:ws/search
 * Permission and workspace constraints must be applied inside SQL (PRD 9.12).
 */
const search = new Hono()

// GET /search?q=&type=&person_id=&group_id=&from=&to=
search.get('/', () => {
  throw notImplemented()
})

// POST /search/semantic { q, top_k }  (Phase 6, document_chunks.embedding)
search.post('/semantic', () => {
  throw notImplemented()
})

// GET/POST/DELETE saved searches (Phase 5)
search.get('/saved', () => {
  throw notImplemented()
})
search.post('/saved', () => {
  throw notImplemented()
})
search.delete('/saved/:id', () => {
  throw notImplemented()
})

export default search
