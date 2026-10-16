/**
 * Files in Supabase Storage, behind the same small interface the Worker uses
 * of an R2 bucket binding: put, get (with range and If-None-Match) and delete.
 *
 * Used when no R2 bucket is bound (DOCUMENTS_BUCKET), e.g. on a Cloudflare
 * account without R2. Supabase Storage is part of the free Supabase plan.
 * The bucket is private; only the Worker reads it, with the service role key.
 */

/** Name of the private Supabase Storage bucket. */
export const SUPABASE_BUCKET = 'documents'

function encodeKey(key) {
  return String(key).split('/').map(encodeURIComponent).join('/')
}

function authHeaders(env) {
  return {
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  }
}

function objectUrl(env, key) {
  return `${String(env.SUPABASE_URL).replace(/\/$/, '')}/storage/v1/object/${SUPABASE_BUCKET}/${encodeKey(key)}`
}

/** An object as R2 describes it, built from a Supabase Storage response. */
function toObject(res, { withBody }) {
  const contentType = res.headers.get('content-type') || 'application/octet-stream'
  const etag = (res.headers.get('etag') || '').replace(/^W\//, '')
  const contentRange = res.headers.get('content-range') // bytes start-end/total
  let size = Number(res.headers.get('content-length') || 0)
  let range
  if (contentRange) {
    const match = /bytes (\d+)-(\d+)\/(\d+)/.exec(contentRange)
    if (match) {
      const start = Number(match[1])
      const end = Number(match[2])
      size = Number(match[3])
      range = { offset: start, length: end - start + 1 }
    }
  }
  const object = {
    key: undefined,
    size,
    httpEtag: etag || '""',
    etag: etag.replace(/"/g, ''),
    httpMetadata: { contentType },
    customMetadata: {},
    range,
    writeHttpMetadata(headers) {
      headers.set('Content-Type', contentType)
    },
  }
  if (withBody) {
    object.body = res.body
    object.text = () => res.text()
    object.arrayBuffer = () => res.arrayBuffer()
  }
  return object
}

export function createSupabaseBucket(env) {
  return {
    async put(key, body, options = {}) {
      const res = await fetch(objectUrl(env, key), {
        method: 'POST',
        headers: {
          ...authHeaders(env),
          'Content-Type': options.httpMetadata?.contentType || 'application/octet-stream',
          'x-upsert': 'true',
          'cache-control': 'max-age=3600',
        },
        body,
      })
      if (!res.ok) {
        throw new Error(`Storage upload failed (${res.status}): ${await res.text().catch(() => '')}`)
      }
      return { key }
    },

    async get(key, options = {}) {
      const headers = authHeaders(env)
      if (options.range instanceof Headers) {
        const range = options.range.get('range')
        if (range) headers.Range = range
      }
      const etag = options.onlyIf?.etagDoesNotMatch
      if (etag) headers['If-None-Match'] = `"${etag}"`

      const res = await fetch(objectUrl(env, key), { headers })
      if (res.status === 304) return toObject(res, { withBody: false })
      if (res.status === 404 || res.status === 400) {
        await res.body?.cancel()
        return null
      }
      if (!res.ok) {
        throw new Error(`Storage download failed (${res.status}): ${await res.text().catch(() => '')}`)
      }
      const object = toObject(res, { withBody: true })
      object.key = key
      return object
    },

    async delete(keys) {
      const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean)
      if (!list.length) return
      const res = await fetch(`${String(env.SUPABASE_URL).replace(/\/$/, '')}/storage/v1/object/${SUPABASE_BUCKET}`, {
        method: 'DELETE',
        headers: { ...authHeaders(env), 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: list }),
      })
      if (!res.ok) {
        throw new Error(`Storage delete failed (${res.status}): ${await res.text().catch(() => '')}`)
      }
    },
  }
}
