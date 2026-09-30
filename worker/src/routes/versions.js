import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { unwrap, notFound, badRequest } from '../lib/errors.js'
import { parseJson, versionRestore } from '../lib/validate.js'
import { activityFor } from '../lib/activity.js'
import { isUuid, newId, extensionOf } from '../lib/ids.js'
import { VERSION_TEXT_FIELDS, FILE_FIELDS, loadDocument, loadVersions, loadFiles, assertCanView, publicFile, objectKey } from '../lib/docs.js'
import { readMultipart, collectFormFiles, formList, formPageNumbers, storeFile, createVersion, finalizeVersion, versionFiles } from '../lib/uploadFiles.js'

/**
 * Document versions (contract section 2). Mounted at /api/workspaces/:ws/documents/:id/versions
 */
const versions = new Hono()

async function loadVersion(db, wsId, docId, vid) {
  if (!isUuid(vid)) throw badRequest('Invalid version id')
  const v = unwrap(await db.from('document_versions').select(VERSION_TEXT_FIELDS).eq('workspace_id', wsId).eq('document_id', docId).eq('id', vid).maybeSingle(), 'Load version')
  if (!v) throw notFound('Version not found')
  return v
}

// GET /documents/:id/versions -> { versions: [Version & { files }] }
versions.get('/', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'), { includeDeleted: true })
  await assertCanView(db, m, doc)
  const rows = unwrap(
    await db.from('document_versions').select(VERSION_TEXT_FIELDS).eq('workspace_id', m.workspace_id).eq('document_id', doc.id).order('version_number', { ascending: false }),
    'Load versions',
  )
  const files = await loadFiles(db, m.workspace_id, [doc.id])
  const byVersion = new Map()
  for (const f of files) {
    if (!byVersion.has(f.version_id)) byVersion.set(f.version_id, [])
    byVersion.get(f.version_id).push(publicFile(f))
  }
  return c.json({ versions: rows.map((v) => ({ ...v, files: byVersion.get(v.id) || [] })) })
})

// POST /documents/:id/versions (multipart like /uploads + comment?) -> { version, files }
versions.post('/', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'))
  const form = await readMultipart(c)
  const files = collectFormFiles(form)
  const comment = String(form.get('comment') || '').trim().slice(0, 500) || null
  const hashes = formList(form, 'sha256')
  const pageNumbers = formPageNumbers(form, files.length)
  const perceptualHash = String(form.get('perceptual_hash') || '').trim().toLowerCase().slice(0, 64) || null

  const existing = await loadVersions(db, m.workspace_id, doc.id)
  const current = existing.find((v) => v.id === doc.current_version_id) || existing[0] || null
  const version = await createVersion(db, {
    wsId: m.workspace_id,
    documentId: doc.id,
    versionNumber: (existing[0]?.version_number || 0) + 1,
    previousVersionId: current?.id ?? null,
    source: 'upload',
    comment,
    actorId: user.id,
  })

  const stored = []
  let addedBytes = 0
  try {
    for (let i = 0; i < files.length; i++) {
      const res = await storeFile(c, { document: doc, version, file: files[i], kind: 'original', pageNumber: pageNumbers[i], expectedSha256: hashes[i] || null })
      stored.push(res)
      addedBytes += res.size
    }
  } catch (err) {
    if (stored.length) {
      const keys = unwrap(await db.from('document_files').select('r2_object_key').in('id', stored.map((s) => s.row.id)), 'Load rollback keys').map((r) => r.r2_object_key)
      if (keys.length) await c.env.DOCUMENTS_BUCKET.delete(keys).catch(() => {})
    }
    await db.from('document_versions').delete().eq('id', version.id) // cascades files/pages
    throw err
  }

  await db.from('document_versions').update({ hash: stored[0].sha256 }).eq('id', version.id)
  version.hash = stored[0].sha256
  const patch = perceptualHash ? { perceptual_hash: perceptualHash } : {}
  await finalizeVersion(db, m, doc, version, { addedBytes, patch })

  await activityFor(c)('version_uploaded', 'document', doc.id, { version_id: version.id, version_number: version.version_number, comment, files: stored.length }, `uploaded version ${version.version_number} of "${doc.name}"`)
  return c.json({ version, files: await versionFiles(db, version.id) }, 201)
})

// POST /documents/:id/versions/:vid/restore { comment? } -> { version } (new version copied from the old one)
versions.post('/:vid/restore', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const bucket = c.env.DOCUMENTS_BUCKET
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'))
  const old = await loadVersion(db, m.workspace_id, doc.id, c.req.param('vid'))
  const body = await parseJson(c, versionRestore).catch(() => ({}))

  const existing = await loadVersions(db, m.workspace_id, doc.id)
  const current = existing.find((v) => v.id === doc.current_version_id) || existing[0] || null
  const version = await createVersion(db, {
    wsId: m.workspace_id,
    documentId: doc.id,
    versionNumber: (existing[0]?.version_number || 0) + 1,
    previousVersionId: current?.id ?? null,
    source: 'restore',
    hash: old.hash,
    comment: body.comment || `Restored from version ${old.version_number}`,
    actorId: user.id,
    extra: { ocr_text: old.ocr_text, ocr_language: old.ocr_language, ocr_confidence: old.ocr_confidence, ocr_status: old.ocr_status },
  })

  // Copy files (R2 objects + rows) and pages
  const oldFiles = unwrap(await db.from('document_files').select(FILE_FIELDS).eq('version_id', old.id).order('page_number', { ascending: true, nullsFirst: false }), 'Load old files')
  const idMap = new Map()
  let copiedBytes = 0
  try {
    for (const f of oldFiles) {
      const obj = await bucket.get(f.r2_object_key)
      if (!obj) continue
      const newFileId = newId()
      const key = objectKey({ workspaceId: m.workspace_id, documentId: doc.id, versionId: version.id, fileId: newFileId, ext: extensionOf(f.r2_object_key) || 'bin', kind: f.kind })
      await bucket.put(key, obj.body, { httpMetadata: obj.httpMetadata, customMetadata: { ...(obj.customMetadata || {}), versionId: version.id, fileId: newFileId, restoredFrom: f.id } })
      unwrap(
        await db.from('document_files').insert({
          id: newFileId,
          document_id: doc.id,
          version_id: version.id,
          workspace_id: m.workspace_id,
          r2_object_key: key,
          original_filename: f.original_filename,
          mime_type: f.mime_type,
          size_bytes: f.size_bytes,
          sha256: f.sha256,
          page_number: f.page_number,
          kind: f.kind,
          width: f.width,
          height: f.height,
          created_by: user.id,
        }),
        'Copy file record',
      )
      idMap.set(f.id, newFileId)
      copiedBytes += Number(f.size_bytes) || 0
    }
    const oldPages = unwrap(
      await db.from('document_pages').select('page_number, file_id, thumbnail_file_id, has_embedded_text, ocr_text_raw, ocr_text, ocr_language, ocr_confidence, word_boxes, rotation').eq('version_id', old.id),
      'Load old pages',
    )
    if (oldPages.length) {
      unwrap(
        await db.from('document_pages').upsert(
          oldPages.map((p) => ({
            ...p,
            workspace_id: m.workspace_id,
            document_id: doc.id,
            version_id: version.id,
            file_id: p.file_id ? idMap.get(p.file_id) ?? null : null,
            thumbnail_file_id: p.thumbnail_file_id ? idMap.get(p.thumbnail_file_id) ?? null : null,
            created_by: user.id,
          })),
          { onConflict: 'version_id,page_number' },
        ),
        'Copy pages',
      )
    }
  } catch (err) {
    const keys = [...idMap.values()]
    if (keys.length) {
      const rows = await db.from('document_files').select('r2_object_key').in('id', keys)
      if (rows.data?.length) await bucket.delete(rows.data.map((r) => r.r2_object_key)).catch(() => {})
    }
    await db.from('document_versions').delete().eq('id', version.id)
    throw err
  }

  await finalizeVersion(db, m, doc, version, { addedBytes: copiedBytes })
  await activityFor(c)('version_restored', 'document', doc.id, { from_version_id: old.id, from_version_number: old.version_number, version_id: version.id, version_number: version.version_number }, `restored version ${old.version_number} of "${doc.name}" as version ${version.version_number}`)
  const fresh = await loadVersion(db, m.workspace_id, doc.id, version.id)
  return c.json({ version: { ...fresh, files: await versionFiles(db, version.id) } }, 201)
})

// POST /documents/:id/versions/:vid/files (multipart files[], kind, page_numbers[]) -> { files }
versions.post('/:vid/files', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'))
  const version = await loadVersion(db, m.workspace_id, doc.id, c.req.param('vid'))
  const form = await readMultipart(c)
  const files = collectFormFiles(form)
  const kind = String(form.get('kind') || 'processed')
  if (!['processed', 'thumbnail', 'pdf', 'attachment'].includes(kind)) throw badRequest('kind must be processed, thumbnail, pdf or attachment')
  const pageNumbers = formPageNumbers(form, files.length)
  const hashes = formList(form, 'sha256')

  const stored = []
  let addedBytes = 0
  for (let i = 0; i < files.length; i++) {
    const res = await storeFile(c, { document: doc, version, file: files[i], kind, pageNumber: pageNumbers[i], expectedSha256: hashes[i] || null })
    stored.push(res.row)
    addedBytes += res.size
  }
  if (addedBytes) {
    const ws = await db.from('workspaces').select('storage_bytes').eq('id', m.workspace_id).maybeSingle()
    await db.from('workspaces').update({ storage_bytes: (Number(ws.data?.storage_bytes) || 0) + addedBytes }).eq('id', m.workspace_id)
  }
  await activityFor(c)('file_added', 'document', doc.id, { version_id: version.id, kind, files: stored.length }, `added ${stored.length} ${kind} file(s) to "${doc.name}" (v${version.version_number})`)
  return c.json({ files: stored.map(publicFile) }, 201)
})

export default versions
