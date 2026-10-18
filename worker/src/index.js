import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { HttpError } from './lib/errors.js'
import { withDb, createServiceClient } from './lib/supabase.js'
import { reembedStale } from './lib/embed.js'
import { sharePageHtml } from './lib/sharePage.js'
import { requireAuth } from './lib/auth.js'
import { requireWorkspace } from './lib/workspace.js'

import health from './routes/health.js'
import me from './routes/me.js'
import workspaces from './routes/workspaces.js'
import { membersRoutes, inviteRoutes } from './routes/members.js'
import groups from './routes/groups.js'
import people from './routes/people.js'
import documents from './routes/documents.js'
import uploads from './routes/uploads.js'
import { fileUrlRoutes, fileServeRoutes } from './routes/files.js'
import activity from './routes/activity.js'
import notifications from './routes/notifications.js'
import search from './routes/search.js'
import savedSearches from './routes/searchSaved.js'
import versions from './routes/versions.js'
import documentText from './routes/documentText.js'
import documentDetails from './routes/documentDetails.js'
import tags from './routes/tags.js'
import albums from './routes/albums.js'
import reminders, { documentReminderRoutes } from './routes/reminders.js'
import { sharesRoutes, publicShareRoutes } from './routes/shares.js'
import aiKeys from './routes/aiKeys.js'
import rag from './routes/rag.js'
import readPage from './routes/readPage.js'
import notes from './routes/notes.js'
import home from './routes/home.js'
import vault from './routes/vault.js'
import { processDueReminders } from './lib/reminderCron.js'
import { createSupabaseBucket } from './lib/supabaseBucket.js'

const app = new Hono()

/* ---------- global middleware ---------- */

app.use('*', async (c, next) => {
  // Without an R2 bucket bound, files live in Supabase Storage (lib/supabaseBucket.js).
  if (c.env && !c.env.DOCUMENTS_BUCKET && c.env.SUPABASE_URL) {
    c.env.DOCUMENTS_BUCKET = createSupabaseBucket(c.env)
  }
  const requestId = c.req.header('x-request-id')?.slice(0, 64) || crypto.randomUUID()
  c.set('requestId', requestId)
  c.header('X-Request-Id', requestId)
  const started = Date.now()
  await next()
  if (c.env?.LOG_REQUESTS !== 'false') {
    console.log(`${c.req.method} ${new URL(c.req.url).pathname} -> ${c.res.status} ${Date.now() - started}ms [${requestId}]`)
  }
})

// The share page (/s/:token) sets its own policy (it runs a script and shows images).
const apiSecureHeaders = secureHeaders({
  contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  referrerPolicy: 'no-referrer',
  permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
  xContentTypeOptions: 'nosniff',
  crossOriginResourcePolicy: 'cross-origin',
})
app.use('*', (c, next) => (c.req.path.startsWith('/s/') ? next() : apiSecureHeaders(c, next)))

app.use('*', async (c, next) => {
  const allowed = String(c.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
    // The Android app (mobile/, Capacitor) serves the web app from this origin.
    .concat(['https://localhost', 'capacitor://localhost'])
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'Range', 'If-None-Match'],
    exposeHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After', 'Content-Range', 'ETag'],
    maxAge: 600,
    credentials: false,
  })(c, next)
})

app.use('/api/*', withDb())

/* ---------- routes ---------- */

app.get('/', (c) => c.json({ service: 'dastavault-api', docs: '/api/health' }))

// The page a share link opens, for anyone (no app needed).
app.get('/s/:token', (c) => {
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const html = sharePageHtml(c.req.param('token')).replace('<script>', `<script nonce="${nonce}">`)
  return c.html(html, 200, {
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  })
})
app.route('/api/health', health)
app.route('/api/me', me)
app.route('/api/notifications', notifications)
app.route('/api/invites', inviteRoutes)
app.route('/api/vault', vault)
app.route('/api/ai/keys', aiKeys)
app.route('/api/files', fileServeRoutes) // signature-authenticated
app.route('/api/shares', publicShareRoutes) // public share links (token + optional password)

// After a deploy: make again the chunk vectors of another model, a batch per call.
// Called by .github/workflows/deploy-worker.yml with the service role key.
app.post('/api/admin/reembed', async (c) => {
  const given = c.req.header('x-admin-key') || ''
  if (!c.env.SUPABASE_SERVICE_ROLE_KEY || given !== c.env.SUPABASE_SERVICE_ROLE_KEY) return c.json({ error: 'Forbidden' }, 403)
  return c.json(await reembedStale(c.env, createServiceClient(c.env), { limit: 50 }))
})

// /api/workspaces, /api/workspaces/:ws, /api/workspaces/:ws/terminology (auth + per-handler membership)
app.route('/api/workspaces', workspaces)

// Everything else under /api/workspaces/:ws/* requires auth + membership (viewer or above; restricted allowed, handlers narrow further)
const ws = new Hono()
ws.use('*', requireAuth(), requireWorkspace())
ws.route('/', membersRoutes) // /members, /invites
ws.route('/', fileUrlRoutes) // /files/:fileId/url
ws.route('/groups', groups)
ws.route('/people', people)
ws.route('/documents/:id/versions', versions)
ws.route('/documents', documentText) // /:id/text, /:id/timeline, /written, /:id/written, /:id/content
ws.route('/documents', documentDetails) // /:id/suggestions, /:id/metadata, /:id/tags, /check-duplicates, /:id/chunks
ws.route('/documents', documentReminderRoutes) // /:id/reminders/auto
ws.route('/documents', documents)
ws.route('/uploads', uploads)
ws.route('/tags', tags)
ws.route('/activity', activity)
ws.route('/search/saved', savedSearches)
ws.route('/search', search)
ws.route('/albums', albums)
ws.route('/reminders', reminders)
ws.route('/shares', sharesRoutes)
ws.route('/rag', rag)
ws.route('/read', readPage) // page photo -> text + details, handwriting included
ws.route('/notes', notes)
ws.route('/', home) // /home, /stats
app.route('/api/workspaces/:ws', ws)

/* ---------- errors ---------- */

app.notFound((c) => c.json({ error: 'Route not found', code: 'not_found', request_id: c.get('requestId') }, 404))

app.onError((err, c) => {
  const requestId = c.get('requestId')
  if (err instanceof HttpError) {
    if (err.status >= 500) console.error(`[${requestId}] ${err.status} ${err.message}`, err.details || '')
    return c.json({ error: err.message, code: err.code, details: err.details, request_id: requestId }, err.status)
  }
  // Hono's own HTTPException (e.g. body too large) exposes getResponse()
  if (typeof err?.getResponse === 'function') {
    const res = err.getResponse()
    return c.json({ error: err.message || 'Request failed', code: 'http_error', request_id: requestId }, res.status)
  }
  console.error(`[${requestId}] Unhandled error:`, err?.stack || err)
  return c.json({ error: 'Internal server error', code: 'internal', request_id: requestId }, 500)
})

/* ---------- scheduled keep-alive ---------- */

async function keepAlive(env) {
  try {
    const db = createServiceClient(env)
    const { error } = await db.from('roles').select('key').limit(1)
    if (error) console.error('[cron] Supabase keep-alive failed:', error.message)
    else console.log('[cron] Supabase keep-alive ok')
  } catch (err) {
    console.error('[cron] keep-alive threw:', err?.message || err)
  }
}

export { app }

async function runReembed(env) {
  try {
    const r = await reembedStale(env, createServiceClient(env), { limit: 50 })
    if (r.done) console.log('[cron] re-embedded chunks:', r.done)
  } catch (err) {
    console.error('[cron] re-embed threw:', err?.message || err)
  }
}

async function runReminders(env) {
  try {
    await processDueReminders(env)
  } catch (err) {
    console.error('[cron] reminders threw:', err?.message || err)
  }
}

export default {
  fetch: app.fetch,
  scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([keepAlive(env), runReminders(env), runReembed(env)]))
  },
}
