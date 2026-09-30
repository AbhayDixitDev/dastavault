import { createClient } from '@supabase/supabase-js'
import { HttpError } from './errors.js'

/**
 * Creates a service-role Supabase client. The Worker performs its own auth and
 * membership checks before touching the database, so the client bypasses RLS.
 * A fresh client per request keeps requests isolated (no shared auth state).
 */
export function createServiceClient(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(500, 'Server misconfigured: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing', 'misconfigured')
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-client-info': 'dastavault-worker' } },
  })
}

/** Hono middleware: attaches a per-request client as c.get('db'). */
export function withDb() {
  return async (c, next) => {
    c.set('db', createServiceClient(c.env))
    await next()
  }
}
