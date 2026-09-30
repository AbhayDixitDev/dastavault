import { unwrap, notFound, badRequest, forbidden } from './errors.js'
import { isUuid } from './ids.js'

/**
 * Shared document helpers (columns expected by this worker are listed in README).
 */
export const DOC_FIELDS =
  'id, workspace_id, title, description, doc_type, visibility, person_id, current_version_id, created_by, created_at, updated_at, deleted_at, deleted_by'
export const VERSION_FIELDS = 'id, document_id, workspace_id, version_number, label, created_by, created_at'
export const FILE_FIELDS =
  'id, document_id, version_id, workspace_id, r2_object_key, original_filename, mime_type, size_bytes, sha256, page_number, kind, width, height, created_by, created_at'

/** R2 key layout. Object keys are ids, never user filenames. */
export function objectKey({ workspaceId, documentId, versionId, fileId, ext, kind = 'original' }) {
  return `workspaces/${workspaceId}/documents/${documentId}/versions/${versionId}/${kind}/${fileId}.${ext}`
}

export async function loadDocument(db, wsId, docId, { includeDeleted = false } = {}) {
  if (!isUuid(docId)) throw badRequest('Invalid document id')
  const doc = unwrap(await db.from('documents').select(DOC_FIELDS).eq('workspace_id', wsId).eq('id', docId).maybeSingle(), 'Load document')
  if (!doc || (doc.deleted_at && !includeDeleted)) throw notFound('Document not found')
  return doc
}

/**
 * Visibility gate for a single document. Editors and above see everything in
 * the workspace; viewers see everything except private uploads of others;
 * restricted members only see documents they uploaded or that are linked to
 * their own person (document_people / groups linking arrives in Phase 2).
 */
export function assertCanView(membership, doc) {
  const own = doc.created_by === membership.user_id
  if (own || membership.rank >= 30) return
  if (doc.visibility === 'private') throw forbidden('This document is private to its uploader')
  if (membership.role_key === 'restricted' && !(doc.person_id && doc.person_id === membership.person_id)) {
    throw forbidden('You do not have access to this document')
  }
}

export async function loadVersions(db, wsId, docId) {
  return unwrap(
    await db.from('document_versions').select(VERSION_FIELDS).eq('workspace_id', wsId).eq('document_id', docId).order('version_number', { ascending: false }),
    'Load versions',
  )
}

export async function loadFiles(db, wsId, docIds, versionIds = null) {
  if (!docIds.length) return []
  let q = db.from('document_files').select(FILE_FIELDS).eq('workspace_id', wsId).in('document_id', docIds)
  if (versionIds) q = q.in('version_id', versionIds)
  return unwrap(await q.order('page_number', { ascending: true }).order('created_at', { ascending: true }), 'Load files')
}

/** Attaches `files` (current version only, without R2 keys) to a list of documents. */
export async function attachCurrentFiles(db, wsId, docs) {
  const versionIds = docs.map((d) => d.current_version_id).filter(Boolean)
  const files = await loadFiles(db, wsId, docs.map((d) => d.id), versionIds.length ? versionIds : ['00000000-0000-0000-0000-000000000000'])
  const byDoc = new Map()
  for (const f of files) {
    if (!byDoc.has(f.document_id)) byDoc.set(f.document_id, [])
    byDoc.get(f.document_id).push(publicFile(f))
  }
  for (const d of docs) d.files = byDoc.get(d.id) || []
  return docs
}

/** Strips storage internals before sending a file row to the client. */
export function publicFile(f) {
  const { r2_object_key, ...rest } = f
  return rest
}
