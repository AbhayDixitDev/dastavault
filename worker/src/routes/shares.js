import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { notImplemented } from '../lib/errors.js'

/**
 * Phase 7 - sharing (links with expiry / password, shares to members).
 * Workspace-scoped routes mounted at /api/workspaces/:ws/shares.
 * Public link resolution will live at /api/shares/:token (rate limited, PRD 9.8).
 */
export const sharesRoutes = new Hono()

sharesRoutes.get('/', () => {
  throw notImplemented()
})
sharesRoutes.post('/', requireRole('editor'), () => {
  throw notImplemented()
})
sharesRoutes.delete('/:sid', requireRole('editor'), () => {
  throw notImplemented()
})

/** Public: GET /api/shares/:token */
export const publicShareRoutes = new Hono()
publicShareRoutes.get('/:token', () => {
  throw notImplemented()
})
