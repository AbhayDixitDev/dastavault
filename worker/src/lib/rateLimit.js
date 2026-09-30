import { tooManyRequests } from './errors.js'

/**
 * Best-effort, in-memory, per-isolate rate limiter (fixed window).
 *
 * Limitations (by design for V1):
 *  - State lives in the Worker isolate. Cloudflare runs many isolates across
 *    many points of presence, so a determined client can exceed the limit by
 *    hitting different PoPs, and limits reset when an isolate is recycled.
 *  - Good enough to blunt brute force on OTP / PIN routes because the real
 *    protection is server-side lockout stored in the database.
 *  - Replace with a Durable Object (or Cloudflare's Rate Limiting binding) when
 *    a global guarantee is needed.
 */
const buckets = new Map()
const MAX_BUCKETS = 10_000

function sweep(now) {
  if (buckets.size < MAX_BUCKETS) return
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
}

export function checkRateLimit(key, { max, windowMs }) {
  const now = Date.now()
  sweep(now)
  let b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs }
    buckets.set(key, b)
  }
  b.count += 1
  return { allowed: b.count <= max, remaining: Math.max(0, max - b.count), resetAt: b.resetAt }
}

export function clientIp(c) {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

/**
 * Hono middleware factory.
 * @param {string} name bucket name (e.g. 'vault-unlock')
 * @param {{max:number, windowMs:number, by?: 'user'|'ip'|'user+ip'}} opts
 */
export function rateLimit(name, { max, windowMs, by = 'user+ip' }) {
  return async (c, next) => {
    const user = c.get('user')
    const parts = [name]
    if (by.includes('user')) parts.push(user?.id || 'anon')
    if (by.includes('ip')) parts.push(clientIp(c))
    const r = checkRateLimit(parts.join(':'), { max, windowMs })
    c.header('X-RateLimit-Limit', String(max))
    c.header('X-RateLimit-Remaining', String(r.remaining))
    if (!r.allowed) {
      const retryAfter = Math.ceil((r.resetAt - Date.now()) / 1000)
      c.header('Retry-After', String(retryAfter))
      throw tooManyRequests('Too many attempts, please slow down', { retry_after_seconds: retryAfter })
    }
    await next()
  }
}
