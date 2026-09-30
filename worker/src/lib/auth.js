import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader } from 'jose'
import { unauthorized, HttpError } from './errors.js'

// JWKS fetchers are cached per isolate so keys are not re-downloaded on every request.
const jwksCache = new Map()

function getJwks(supabaseUrl) {
  const url = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`
  let jwks = jwksCache.get(url)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url), { cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 })
    jwksCache.set(url, jwks)
  }
  return jwks
}

/**
 * Verifies a Supabase access token.
 *  - ES256 / RS256: verified against the project's JWKS (current Supabase default).
 *  - HS256: verified with SUPABASE_JWT_SECRET (legacy projects) when that secret is set.
 * Returns the verified payload.
 */
export async function verifySupabaseJwt(token, env) {
  if (!env.SUPABASE_URL) throw new HttpError(500, 'Server misconfigured: SUPABASE_URL missing', 'misconfigured')

  let header
  try {
    header = decodeProtectedHeader(token)
  } catch {
    throw unauthorized('Malformed token')
  }

  const options = { audience: 'authenticated', clockTolerance: 30 }

  try {
    if (header.alg === 'HS256') {
      if (!env.SUPABASE_JWT_SECRET) throw unauthorized('HS256 tokens are not accepted (SUPABASE_JWT_SECRET not configured)')
      const key = new TextEncoder().encode(env.SUPABASE_JWT_SECRET)
      const { payload } = await jwtVerify(token, key, { ...options, algorithms: ['HS256'] })
      return payload
    }
    const { payload } = await jwtVerify(token, getJwks(env.SUPABASE_URL), { ...options, algorithms: ['ES256', 'RS256'] })
    return payload
  } catch (err) {
    if (err instanceof HttpError) throw err
    // Asymmetric verification failed but a legacy secret exists: try it as a last resort.
    if (header.alg !== 'HS256' && env.SUPABASE_JWT_SECRET) {
      try {
        const key = new TextEncoder().encode(env.SUPABASE_JWT_SECRET)
        const { payload } = await jwtVerify(token, key, { ...options, algorithms: ['HS256'] })
        return payload
      } catch { /* fall through */ }
    }
    throw unauthorized(err?.code === 'ERR_JWT_EXPIRED' ? 'Token expired' : 'Invalid token')
  }
}

/**
 * Hono middleware. Requires `Authorization: Bearer <supabase access token>`.
 * Sets c.get('user') = { id, email, role }.
 */
export function requireAuth() {
  return async (c, next) => {
    const authz = c.req.header('authorization') || ''
    const match = /^Bearer\s+(.+)$/i.exec(authz)
    if (!match) throw unauthorized('Missing bearer token')

    const payload = await verifySupabaseJwt(match[1].trim(), c.env)
    if (!payload.sub) throw unauthorized('Token has no subject')

    c.set('user', {
      id: payload.sub,
      email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
      role: payload.role || 'authenticated',
      // Google/OAuth sign-ins carry the real name here (full_name / name).
      metadata: payload.user_metadata && typeof payload.user_metadata === 'object' ? payload.user_metadata : {},
    })
    await next()
  }
}
