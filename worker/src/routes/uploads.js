import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { unwrap, badRequest, tooLarge, unsupportedMedia, HttpError } from '../lib/errors.js'
import { activityFor } from '../lib/activity.js'
import { detectAllowedType, MAX_UPLOAD_BYTES } from '../lib/mime.js'
import { newId, isUuid, safeFilename, extensionOf } from '../lib/ids.js'
import { sha256Hex } from '../lib/signing.js'
import { DOC_FIELDS, VERSION_FIELDS, FILE_FIELDS, objectKey, loadDocument, publicFile, loadVersions } from '../lib/docs.js'

const uploads = new Hono()

/**
 * POST /uploads  (multipart/form-data, editor+)
 * fields:
 *   file          required, one file (<= 25 MB)
 *   title         optional (defaults to the filename without extension)
 *   document_id   optional: add the file to an existing document instead of creating one
 *   new_version   optional "1": with document_id, create a new version instead of adding to the current one
 *   page_number   optional integer (default: next page in the version)
 *   kind          optional: original | thumbnail | derived (default original)
 *   sha256        optional client-computed hash; rejected if it does not match
 *   visibility    optional workspace | groups | people | private
 *   person_id     optional person the document belongs to
 * Response: { document, version, files }
 */
uploads.post('/', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const bucket = c.env.DOCUMENTS_BUCKET

  const declaredLength = Number(c.req.header('content-length') || 0)
  if (declaredLength > MAX_UPLOAD_BYTES + 64 * 1024) throw tooLarge('File exceeds the 25 MB limit')

  let form
  try {
    form = await c.req.formData()
  } catch {
    throw badRequest('Expected multipart/form-data')
  }
  const file = form.get('file')
  if (!(file instanceof File)) throw badRequest('Missing "file" field')
  if (file.size === 0) throw badRequest('File is empty')
  if (file.size > MAX_UPLOAD_BYTES) throw tooLarge('File exceeds the 25 MB limit')

  const originalName = safeFilename(file.name, 'upload')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const detected = detectAllowedType(bytes.subarray(0, 64), file.type, extensionOf(originalName))
  if (!detected) throw unsupportedMedia(`File type not allowed (${file.type || 'unknown'})`)

  const sha256 = await sha256Hex(bytes)
  const clientHash = String(form.get('sha256') || '').toLowerCase()
  if (clientHash && clientHash !== sha256) throw badRequest('sha256 mismatch: the file was altered in transit')

  const kind = ['original', 'thumbnail', 'derived'].includes(form.get('kind')) ? form.get('kind') : 'original'
  const visibility = ['workspace', 'groups', 'people', 'private'].includes(form.get('visibility')) ? form.get('visibility') : m.workspace.default_visibility || 'workspace'
  const personId = form.get('person_id') ? String(form.get('person_id')) : null
  if (personId && !isUuid(personId)) throw badRequest('Invalid person_id')
  const titleInput = String(form.get('title') || '').trim()
  const title = (titleInput || originalName.replace(/\.[a-z0-9]{1,8}$/i, '') || 'Untitled').slice(0, 200)

  const documentIdInput = form.get('document_id') ? String(form.get('document_id')) : null
  const now = new Date().toISOString()
  let document
  let version
  let createdDocument = false

  if (documentIdInput) {
    document = await loadDocument(db, m.workspace_id, documentIdInput)
    const versions = await loadVersions(db, m.workspace_id, document.id)
    const current = versions.find((v) => v.id === document.current_version_id) || versions[0]
    if (form.get('new_version') === '1' || !current) {
      const nextNumber = (versions[0]?.version_number || 0) + 1
      version = unwrap(
        await db.from('document_versions').insert({ document_id: document.id, workspace_id: m.workspace_id, version_number: nextNumber, created_by: user.id }).select(VERSION_FIELDS).single(),
        'Create version',
      )
      document = unwrap(
        await db.from('documents').update({ current_version_id: version.id, updated_at: now }).eq('id', document.id).select(DOC_FIELDS).single(),
        'Point document at new version',
      )
    } else {
      version = current
    }
  } else {
    createdDocument = true
    document = unwrap(
      await db
        .from('documents')
        .insert({ workspace_id: m.workspace_id, title, description: null, doc_type: null, visibility, person_id: personId, created_by: user.id })
        .select(DOC_FIELDS)
        .single(),
      'Create document',
    )
    try {
      version = unwrap(
        await db.from('document_versions').insert({ document_id: document.id, workspace_id: m.workspace_id, version_number: 1, created_by: user.id }).select(VERSION_FIELDS).single(),
        'Create version',
      )
      document = unwrap(await db.from('documents').update({ current_version_id: version.id }).eq('id', document.id).select(DOC_FIELDS).single(), 'Set current version')
    } catch (err) {
      await db.from('documents').delete().eq('id', document.id)
      throw err
    }
  }

  // page number: explicit or next in this version
  let pageNumber = parseInt(form.get('page_number'), 10)
  if (!Number.isFinite(pageNumber) || pageNumber < 1) {
    const countRes = await db.from('document_files').select('id', { count: 'exact', head: true }).eq('version_id', version.id).eq('kind', kind)
    pageNumber = (countRes.count ?? 0) + 1
  }

  const fileId = newId()
  const key = objectKey({ workspaceId: m.workspace_id, documentId: document.id, versionId: version.id, fileId, ext: detected.ext, kind })

  await bucket.put(key, bytes, {
    httpMetadata: { contentType: detected.mime, contentDisposition: `inline; filename="${encodeURIComponent(originalName)}"` },
    customMetadata: { workspaceId: m.workspace_id, documentId: document.id, versionId: version.id, fileId, sha256, uploadedBy: user.id },
    sha256,
  })

  let fileRow
  try {
    fileRow = unwrap(
      await db
        .from('document_files')
        .insert({
          id: fileId,
          document_id: document.id,
          version_id: version.id,
          workspace_id: m.workspace_id,
          r2_object_key: key,
          original_filename: originalName,
          mime_type: detected.mime,
          size_bytes: bytes.byteLength,
          sha256,
          page_number: pageNumber,
          kind,
          width: null,
          height: null,
          created_by: user.id,
        })
        .select(FILE_FIELDS)
        .single(),
      'Create file record',
    )
  } catch (err) {
    await bucket.delete(key).catch(() => {})
    if (createdDocument) {
      await db.from('document_versions').delete().eq('id', version.id)
      await db.from('documents').delete().eq('id', document.id)
    }
    throw err instanceof HttpError ? err : new HttpError(500, 'Upload failed', 'upload_failed')
  }

  const files = unwrap(await db.from('document_files').select(FILE_FIELDS).eq('version_id', version.id).order('page_number'), 'Load version files')
  await activityFor(c)(createdDocument ? 'document.created' : 'document.file_added', 'document', document.id, {
    title: document.title,
    file_id: fileId,
    mime_type: detected.mime,
    size_bytes: bytes.byteLength,
    version_number: version.version_number,
  })

  return c.json({ document, version, files: files.map(publicFile), file: publicFile(fileRow) }, 201)
})

export default uploads
