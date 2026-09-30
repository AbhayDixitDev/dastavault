import { unwrap, badRequest, tooLarge, unsupportedMedia, HttpError } from './errors.js'
import { detectAllowedType, MAX_UPLOAD_BYTES } from './mime.js'
import { newId, isUuid, safeFilename, extensionOf } from './ids.js'
import { sha256Hex } from './signing.js'
import { DOC_FIELDS, VERSION_FIELDS, FILE_FIELDS, objectKey, publicFile } from './docs.js'

/**
 * Multipart / storage helpers shared by POST /uploads, POST /documents/:id/versions,
 * POST /documents/:id/versions/:vid/files and the written-document routes.
 */

export const MAX_FILES_PER_REQUEST = 20

/** All uploaded File objects from `files[]`, `files` or `file`. */
export function collectFormFiles(form, { max = MAX_FILES_PER_REQUEST, required = true } = {}) {
  const list = [...form.getAll('files[]'), ...form.getAll('files'), ...form.getAll('file')].filter((f) => f instanceof File)
  if (!list.length && required) throw badRequest('Missing "files[]" (or "file") field')
  if (list.length > max) throw badRequest(`At most ${max} files per request`)
  return list
}

/** Repeated `name[]` / `name` fields, or a JSON array in a single `name` field. */
export function formList(form, name) {
  const raw = [...form.getAll(`${name}[]`), ...form.getAll(name)].filter((v) => typeof v === 'string')
  if (raw.length === 1 && /^\s*\[/.test(raw[0])) {
    try {
      const parsed = JSON.parse(raw[0])
      return Array.isArray(parsed) ? parsed.map(String) : raw
    } catch {
      return raw
    }
  }
  return raw
}

export function formUuidList(form, name) {
  const ids = formList(form, name).map((s) => s.trim()).filter(Boolean)
  for (const id of ids) if (!isUuid(id)) throw badRequest(`Invalid id in ${name}`)
  return [...new Set(ids)]
}

export function formPageNumbers(form, count) {
  const list = formList(form, 'page_numbers').map((s) => parseInt(s, 10))
  const single = parseInt(form.get('page_number'), 10)
  return Array.from({ length: count }, (_, i) => {
    const n = list.length ? list[i] : i === 0 ? single : NaN
    return Number.isFinite(n) && n >= 1 ? n : null
  })
}

export async function readMultipart(c) {
  const declaredLength = Number(c.req.header('content-length') || 0)
  if (declaredLength > MAX_FILES_PER_REQUEST * MAX_UPLOAD_BYTES) throw tooLarge('Request body too large')
  try {
    return await c.req.formData()
  } catch {
    throw badRequest('Expected multipart/form-data')
  }
}

/**
 * Stores one file in R2 and creates its document_files row.
 * `forceType` ({ mime, ext }) bypasses magic-byte sniffing (written HTML documents).
 * Returns { row, size, sha256, mime }.
 */
export async function storeFile(c, { document, version, file, kind = 'original', pageNumber = null, expectedSha256 = null, forceType = null, originalName = null }) {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const bucket = c.env.DOCUMENTS_BUCKET

  if (file.size === 0) throw badRequest('File is empty')
  if (file.size > MAX_UPLOAD_BYTES) throw tooLarge('File exceeds the 25 MB limit')

  const name = safeFilename(originalName || file.name, 'upload')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const detected = forceType || detectAllowedType(bytes.subarray(0, 64), file.type, extensionOf(name))
  if (!detected) throw unsupportedMedia(`File type not allowed (${file.type || 'unknown'})`)

  const sha256 = await sha256Hex(bytes)
  if (expectedSha256 && String(expectedSha256).toLowerCase() !== sha256) throw badRequest('sha256 mismatch: the file was altered in transit')

  let page = pageNumber
  if (!Number.isFinite(page) || page < 1) {
    const countRes = await db.from('document_files').select('id', { count: 'exact', head: true }).eq('version_id', version.id).eq('kind', kind)
    page = (countRes.count ?? 0) + 1
  }

  const fileId = newId()
  const key = objectKey({ workspaceId: m.workspace_id, documentId: document.id, versionId: version.id, fileId, ext: detected.ext, kind })

  await bucket.put(key, bytes, {
    httpMetadata: { contentType: detected.mime, contentDisposition: `inline; filename="${encodeURIComponent(name)}"` },
    customMetadata: { workspaceId: m.workspace_id, documentId: document.id, versionId: version.id, fileId, sha256, uploadedBy: user.id },
    sha256,
  })

  let row
  try {
    row = unwrap(
      await db
        .from('document_files')
        .insert({
          id: fileId,
          document_id: document.id,
          version_id: version.id,
          workspace_id: m.workspace_id,
          r2_object_key: key,
          original_filename: name,
          mime_type: detected.mime,
          size_bytes: bytes.byteLength,
          sha256,
          page_number: page,
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
    throw err instanceof HttpError ? err : new HttpError(500, 'Upload failed', 'upload_failed')
  }

  // Page bookkeeping (best effort)
  if (kind === 'original') {
    const res = await db
      .from('document_pages')
      .upsert({ workspace_id: m.workspace_id, document_id: document.id, version_id: version.id, page_number: page, file_id: fileId, created_by: user.id }, { onConflict: 'version_id,page_number' })
    if (res.error) console.warn('[upload] document_pages upsert failed:', res.error.message)
  } else if (kind === 'thumbnail') {
    const res = await db.from('document_pages').update({ thumbnail_file_id: fileId }).eq('version_id', version.id).eq('page_number', page)
    if (res.error) console.warn('[upload] thumbnail link failed:', res.error.message)
  }

  return { row, size: bytes.byteLength, sha256, mime: detected.mime }
}

/** Creates the next document_versions row. */
export async function createVersion(db, { wsId, documentId, versionNumber, previousVersionId = null, source = 'upload', hash = null, comment = null, actorId, extra = {} }) {
  return unwrap(
    await db
      .from('document_versions')
      .insert({
        document_id: documentId,
        workspace_id: wsId,
        version_number: versionNumber,
        previous_version_id: previousVersionId,
        source,
        hash,
        comment,
        created_by: actorId,
        ...extra,
      })
      .select(VERSION_FIELDS)
      .single(),
    'Create version',
  )
}

/** Points the document at `version`, refreshes page_count from its original files and adds to storage accounting. */
export async function finalizeVersion(db, m, document, version, { addedBytes = 0, patch = {} } = {}) {
  const countRes = await db.from('document_files').select('id', { count: 'exact', head: true }).eq('version_id', version.id).eq('kind', 'original')
  const updated = unwrap(
    await db
      .from('documents')
      .update({ current_version_id: version.id, page_count: countRes.count ?? document.page_count ?? null, updated_at: new Date().toISOString(), ...patch })
      .eq('id', document.id)
      .eq('workspace_id', m.workspace_id)
      .select(DOC_FIELDS)
      .single(),
    'Update document version',
  )
  if (addedBytes) {
    const ws = await db.from('workspaces').select('storage_bytes').eq('id', m.workspace_id).maybeSingle()
    const current = Number(ws.data?.storage_bytes ?? m.workspace.storage_bytes) || 0
    await db.from('workspaces').update({ storage_bytes: current + addedBytes }).eq('id', m.workspace_id)
  }
  return updated
}

/** Public file rows of one version, ordered by page. */
export async function versionFiles(db, versionId) {
  const rows = unwrap(
    await db.from('document_files').select(FILE_FIELDS).eq('version_id', versionId).order('page_number', { ascending: true, nullsFirst: false }).order('created_at'),
    'Load version files',
  )
  return rows.map(publicFile)
}
