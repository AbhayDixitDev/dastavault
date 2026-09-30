/**
 * HttpError - throw anywhere in a handler; the global error handler turns it
 * into `{ error, code?, details?, request_id }` with the right status.
 */
export class HttpError extends Error {
  constructor(status, message, code, details) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (message = 'Bad request', details) => new HttpError(400, message, 'bad_request', details)
export const unauthorized = (message = 'Unauthorized') => new HttpError(401, message, 'unauthorized')
export const forbidden = (message = 'Forbidden') => new HttpError(403, message, 'forbidden')
export const notFound = (message = 'Not found') => new HttpError(404, message, 'not_found')
export const conflict = (message = 'Conflict') => new HttpError(409, message, 'conflict')
export const tooLarge = (message = 'Payload too large') => new HttpError(413, message, 'payload_too_large')
export const unsupportedMedia = (message = 'Unsupported file type') => new HttpError(415, message, 'unsupported_media_type')
export const locked = (message = 'Locked', details) => new HttpError(423, message, 'locked', details)
export const tooManyRequests = (message = 'Too many requests', details) => new HttpError(429, message, 'rate_limited', details)
export const notImplemented = (message = 'Not implemented yet') => new HttpError(501, message, 'not_implemented')

/** Wrap a supabase-js result: throws on error, returns data. */
export function unwrap(result, what = 'Database operation') {
  if (result.error) {
    const err = result.error
    // PostgREST "no rows" for .single()
    if (err.code === 'PGRST116') throw notFound(`${what}: not found`)
    if (err.code === '23505') throw conflict(`${what}: already exists`)
    if (err.code === '23503') throw badRequest(`${what}: referenced record does not exist`)
    const e = new HttpError(500, `${what} failed`, 'db_error', { message: err.message, code: err.code, hint: err.hint })
    throw e
  }
  return result.data
}
