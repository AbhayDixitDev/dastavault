import { Hono } from 'hono'
import { unwrap } from '../lib/errors.js'
import { parseQuery, activityQuery } from '../lib/validate.js'
import { applyCursor, pageResult } from '../lib/pagination.js'
import { attachProfiles } from '../lib/profiles.js'

const activity = new Hono()

// GET /activity?limit=&cursor=&entity_type=&entity_id=&action=
activity.get('/', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const q = parseQuery(c, activityQuery)

  let query = db.from('activity_logs').select('id, workspace_id, actor_id, action, entity_type, entity_id, details, created_at').eq('workspace_id', m.workspace_id)
  if (q.entity_type) query = query.eq('entity_type', q.entity_type)
  if (q.entity_id) query = query.eq('entity_id', q.entity_id)
  if (q.action) query = query.eq('action', q.action)

  const rows = unwrap(await applyCursor(query, q.cursor, q.limit), 'List activity')
  const page = pageResult(rows, q.limit)
  await attachProfiles(db, page.items, 'actor_id', 'actor')
  return c.json(page)
})

export default activity
