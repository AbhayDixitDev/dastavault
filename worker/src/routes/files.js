import { Hono } from 'hono'
import { unwrap, notFound, badRequest, unauthorized } from '../lib/errors.js'
import { signFileUrl, verifyFileSignature } from '../lib/signing.js'
import { isUuid } from '../lib/ids.js'
import { FILE_FIELDS, loadDocument, assertCanView } from '../lib/docs.js'

/* =====================================================================
 * Workspace-scoped: GET /api/workspaces/:ws/files/:fileId/url
 * Issues a 5-minute HMAC-signed URL after the membership/visibility check.
 * ===================================================================== */
export const fileUrlRoutes = new Hono()

fileUrlRoutes.get('/files/:fileId/url', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const fileId = c.req.param('fileId')
  if (!isUuid(fileId)) throw badRequest('Invalid file id')

  const file = unwrap(await db.from('document_files').select(FILE_FIELDS).eq('workspace_id', m.workspace_id).eq('id', fileId).maybeSingle(), 'Load file')
  if (!file) throw notFound('File not found')
  const doc = await loadDocument(db, m.workspace_id, file.document_id, { includeDeleted: true })
  assertCanView(m, doc)

  const origin = new URL(c.req.url).origin
  const signed = await signFileUrl(c.env, origin, file.id, { download: c.req.query('download') === '1' })
  return c.json({ ...signed, file_id: file.id, mime_type: file.mime_type, size_bytes: file.size_bytes })
})

/* =====================================================================
 * Public (signature-authenticated): GET /api/files/:fileId?exp=&sig=[&download=1]
 * Streams the object from the private R2 bucket. Supports Range requests.
 * ===================================================================== */
export const fileServeRoutes = new Hono()

fileServeRoutes.get('/:fileId', async (c) => {
  const fileId = c.req.param('fileId')
  if (!isUuid(fileId)) throw badRequest('Invalid file id')
  const { exp, sig, download } = c.req.query()
  if (!(await verifyFileSignature(c.env, fileId, exp, sig))) throw unauthorized('Invalid or expired file link')

  const db = c.get('db')
  const file = unwrap(await db.from('document_files').select(FILE_FIELDS).eq('id', fileId).maybeSingle(), 'Load file')
  if (!file) throw notFound('File not found')

  const rangeHeader = c.req.header('range')
  const ifNoneMatch = c.req.header('if-none-match')
  const object = await c.env.DOCUMENTS_BUCKET.get(file.r2_object_key, {
    range: rangeHeader ? c.req.raw.headers : undefined,
    onlyIf: ifNoneMatch ? { etagDoesNotMatch: ifNoneMatch.replace(/^W\//, '').replace(/"/g, '') } : undefined,
  })
  if (!object) throw notFound('File data missing')

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('Content-Type', file.mime_type || object.httpMetadata?.contentType || 'application/octet-stream')
  headers.set('ETag', object.httpEtag)
  headers.set('Cache-Control', 'private, max-age=300')
  headers.set('Accept-Ranges', 'bytes')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  const disposition = download === '1' ? 'attachment' : 'inline'
  headers.set('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(file.original_filename || fileId)}`)

  // onlyIf matched: R2 returns an object without a body -> 304
  if (!('body' in object) || object.body === undefined) {
    return new Response(null, { status: 304, headers })
  }

  if (object.range && rangeHeader) {
    const { offset = 0, length = object.size - offset } = object.range
    const end = offset + length - 1
    headers.set('Content-Range', `bytes ${offset}-${end}/${object.size}`)
    headers.set('Content-Length', String(length))
    return new Response(object.body, { status: 206, headers })
  }

  headers.set('Content-Length', String(object.size))
  return new Response(object.body, { status: 200, headers })
})
