import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { unwrap, badRequest } from '../lib/errors.js'
import { activityFor } from '../lib/activity.js'
import { isUuid } from '../lib/ids.js'
import { DOC_FIELDS, VERSION_FIELDS, FILE_KINDS, loadDocument, loadVersions, setDocumentLinks } from '../lib/docs.js'
import { readMultipart, collectFormFiles, formList, formUuidList, formPageNumbers, storeFile, createVersion, finalizeVersion, versionFiles } from '../lib/uploadFiles.js'

const uploads = new Hono()

/**
 * POST /uploads  (multipart/form-data, editor+)
 * fields:
 *   files[] | file   1..20 files (<= 25 MB each); each becomes a page of the same version
 *   name|title       optional document name (defaults to the first filename without extension)
 *   document_id      optional: add the files to an existing document instead of creating one
 *   new_version      optional "1": with document_id, create a new version instead of adding to the current one
 *   page_number | page_numbers[]  optional page numbers (default: next pages in the version)
 *   kind             optional: original | processed | thumbnail | pdf | attachment (default original)
 *   sha256 | sha256[] optional client-computed hashes (one per file); rejected on mismatch
 *   visibility       optional workspace | groups | people | private
 *   person_id | person_ids (json array)   people the document belongs to (document_people, link_type owner)
 *   group_ids (json array)                groups to link
 *   document_type    optional
 *   perceptual_hash  optional image dHash (hex) stored on the document for duplicate detection
 *   client_upload_id optional uuid: idempotent (the same id returns the first result again)
 * Response: { document, version, files, file }
 */
uploads.post('/', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')

  const form = await readMultipart(c)
  const files = collectFormFiles(form)

  const clientUploadId = String(form.get('client_upload_id') || '').trim() || null
  if (clientUploadId) {
    if (!isUuid(clientUploadId)) throw badRequest('client_upload_id must be a uuid')
    const existing = unwrap(
      await db.from('upload_sessions').select('document_id, version_id').eq('workspace_id', m.workspace_id).eq('client_upload_id', clientUploadId).eq('status', 'uploaded').maybeSingle(),
      'Check upload session',
    )
    if (existing?.document_id) {
      const doc = unwrap(await db.from('documents').select(DOC_FIELDS).eq('id', existing.document_id).maybeSingle(), 'Load document')
      if (doc) {
        const version = unwrap(await db.from('document_versions').select(VERSION_FIELDS).eq('id', existing.version_id || doc.current_version_id).maybeSingle(), 'Load version')
        const list = version ? await versionFiles(db, version.id) : []
        return c.json({ document: doc, version, files: list, file: list[0] || null, idempotent: true })
      }
    }
  }

  const kind = FILE_KINDS.includes(form.get('kind')) ? form.get('kind') : 'original'
  const visibility = ['workspace', 'groups', 'people', 'private'].includes(form.get('visibility')) ? form.get('visibility') : m.workspace.default_visibility || 'workspace'
  const personIds = formUuidList(form, 'person_ids')
  const singlePerson = form.get('person_id') ? String(form.get('person_id')) : null
  if (singlePerson) {
    if (!isUuid(singlePerson)) throw badRequest('Invalid person_id')
    if (!personIds.includes(singlePerson)) personIds.push(singlePerson)
  }
  const groupIds = formUuidList(form, 'group_ids')
  const documentType = String(form.get('document_type') || '').trim().slice(0, 60) || null
  const perceptualHash = String(form.get('perceptual_hash') || '').trim().toLowerCase().slice(0, 64) || null
  const firstName = files[0].name || 'upload'
  const nameInput = String(form.get('name') || form.get('title') || '').trim()
  const name = (nameInput || firstName.replace(/\.[a-z0-9]{1,8}$/i, '') || 'Untitled').slice(0, 200)
  const hashes = formList(form, 'sha256')
  const pageNumbers = formPageNumbers(form, files.length)

  const documentIdInput = form.get('document_id') ? String(form.get('document_id')) : null
  let document
  let version
  let createdDocument = false
  let createdVersion = false

  if (documentIdInput) {
    document = await loadDocument(db, m.workspace_id, documentIdInput)
    const versions = await loadVersions(db, m.workspace_id, document.id)
    const current = versions.find((v) => v.id === document.current_version_id) || versions[0]
    if (form.get('new_version') === '1' || !current) {
      version = await createVersion(db, {
        wsId: m.workspace_id,
        documentId: document.id,
        versionNumber: (versions[0]?.version_number || 0) + 1,
        previousVersionId: current?.id ?? null,
        source: 'upload',
        actorId: user.id,
      })
      createdVersion = true
    } else {
      version = current
    }
  } else {
    if (personIds.length) {
      const found = unwrap(await db.from('people').select('id').eq('workspace_id', m.workspace_id).in('id', personIds).is('deleted_at', null), 'Verify people')
      if (found.length !== personIds.length) throw badRequest('One or more people do not exist in this workspace')
    }
    createdDocument = true
    document = unwrap(
      await db
        .from('documents')
        .insert({ workspace_id: m.workspace_id, name, original_filename: firstName.slice(0, 200), document_type: documentType, status: 'ready', visibility, perceptual_hash: perceptualHash, created_by: user.id })
        .select(DOC_FIELDS)
        .single(),
      'Create document',
    )
    try {
      version = await createVersion(db, { wsId: m.workspace_id, documentId: document.id, versionNumber: 1, source: 'upload', actorId: user.id })
      createdVersion = true
      document = unwrap(await db.from('documents').update({ current_version_id: version.id }).eq('id', document.id).select(DOC_FIELDS).single(), 'Set current version')
      await setDocumentLinks(db, m.workspace_id, document.id, { personIds: personIds.length ? personIds : undefined, groupIds: groupIds.length ? groupIds : undefined }, user.id)
    } catch (err) {
      await db.from('documents').delete().eq('id', document.id) // cascades
      throw err
    }
  }

  const stored = []
  let addedBytes = 0
  try {
    for (let i = 0; i < files.length; i++) {
      const res = await storeFile(c, { document, version, file: files[i], kind, pageNumber: pageNumbers[i], expectedSha256: hashes[i] || null })
      stored.push(res)
      addedBytes += res.size
    }
  } catch (err) {
    // roll back what this request created
    if (stored.length) {
      const keys = unwrap(await db.from('document_files').select('r2_object_key').in('id', stored.map((s) => s.row.id)), 'Load rollback keys').map((r) => r.r2_object_key)
      if (keys.length) await c.env.DOCUMENTS_BUCKET.delete(keys).catch(() => {})
      await db.from('document_files').delete().in('id', stored.map((s) => s.row.id))
    }
    if (createdDocument) await db.from('documents').delete().eq('id', document.id)
    else if (createdVersion) await db.from('document_versions').delete().eq('id', version.id)
    throw err
  }

  // version hash = hash of the first original file
  if (createdVersion && stored[0]?.sha256) {
    await db.from('document_versions').update({ hash: stored[0].sha256 }).eq('id', version.id)
    version.hash = stored[0].sha256
  }
  const patch = {}
  if (!createdDocument && perceptualHash) patch.perceptual_hash = perceptualHash
  document = createdVersion || kind === 'original' ? await finalizeVersion(db, m, document, version, { addedBytes, patch }) : document
  if (!createdVersion && kind !== 'original' && addedBytes) {
    await db.from('workspaces').update({ storage_bytes: (Number(m.workspace.storage_bytes) || 0) + addedBytes }).eq('id', m.workspace_id)
  }

  if (clientUploadId) {
    await db.from('upload_sessions').upsert(
      {
        workspace_id: m.workspace_id,
        client_upload_id: clientUploadId,
        document_id: document.id,
        version_id: version.id,
        file_id: stored[0]?.row.id ?? null,
        status: 'uploaded',
        original_filename: stored[0]?.row.original_filename ?? null,
        mime_type: stored[0]?.mime ?? null,
        size_bytes: addedBytes,
        sha256: stored[0]?.sha256 ?? null,
        r2_object_key: stored[0]?.row.r2_object_key ?? null,
        completed_at: new Date().toISOString(),
        created_by: user.id,
      },
      { onConflict: 'workspace_id,client_upload_id' },
    )
  }

  const list = await versionFiles(db, version.id)
  const publicStored = list.filter((f) => stored.some((s) => s.row.id === f.id))
  await activityFor(c)(
    createdDocument ? 'uploaded' : createdVersion ? 'version_uploaded' : 'file_added',
    'document',
    document.id,
    { name: document.name, file_ids: stored.map((s) => s.row.id), size_bytes: addedBytes, version_number: version.version_number, kind },
    createdDocument ? `uploaded "${document.name}"` : createdVersion ? `uploaded version ${version.version_number} of "${document.name}"` : `added ${stored.length} file(s) to "${document.name}" (v${version.version_number})`,
  )

  return c.json({ document, version, files: list, file: publicStored[0] || list[0] || null }, 201)
})

export default uploads
