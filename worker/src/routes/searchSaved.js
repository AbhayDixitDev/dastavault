import { Hono } from 'hono'
import { unwrap, notFound, badRequest } from '../lib/errors.js'
import { parseJson, savedSearchCreate } from '../lib/validate.js'
import { isUuid } from '../lib/ids.js'

/** Saved searches (contract section 4). Mounted at /api/workspaces/:ws/search/saved (per user). */
const savedSearches = new Hono()

const FIELDS = 'id, name, query, filters, use_count, last_used_at, created_at'

// GET /search/saved -> { searches }
savedSearches.get('/', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const rows = unwrap(
    await db.from('saved_searches').select(FIELDS).eq('workspace_id', m.workspace_id).eq('user_id', m.user_id).eq('kind', 'saved').order('created_at', { ascending: false }).limit(100),
    'List saved searches',
  )
  return c.json({ searches: rows })
})

// POST /search/saved { name, query, filters } -> { search }
savedSearches.post('/', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const body = await parseJson(c, savedSearchCreate)
  const search = unwrap(
    await db
      .from('saved_searches')
      .insert({ workspace_id: m.workspace_id, user_id: m.user_id, kind: 'saved', name: body.name, query: body.query, filters: body.filters, created_by: m.user_id })
      .select(FIELDS)
      .single(),
    'Save search',
  )
  return c.json({ search }, 201)
})

// DELETE /search/saved/:id -> { ok }
savedSearches.delete('/:id', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const id = c.req.param('id')
  if (!isUuid(id)) throw badRequest('Invalid search id')
  const rows = unwrap(await db.from('saved_searches').delete().eq('id', id).eq('workspace_id', m.workspace_id).eq('user_id', m.user_id).select('id'), 'Delete saved search')
  if (!rows.length) throw notFound('Saved search not found')
  return c.json({ ok: true })
})

export default savedSearches
