import { unwrap, notFound, badRequest, forbidden } from './errors.js'
import { isUuid } from './ids.js'

/** Shared document helpers. Columns follow backend/migrations/004_documents.sql. */
export const DOC_FIELDS =
  'id, workspace_id, name, original_filename, previous_names, document_type, status, visibility, summary, organisation, document_number, issue_date, expiry_date, current_version_id, page_count, perceptual_hash, is_favorite, is_pinned, created_by, deleted_by, deleted_at, created_at, updated_at'
export const VERSION_FIELDS = 'id, workspace_id, document_id, version_number, comment, previous_version_id, source, hash, ocr_status, created_by, created_at'
/** Version row including the extracted text fields (contract "Version"). */
export const VERSION_TEXT_FIELDS = `${VERSION_FIELDS}, ocr_text, ocr_language, ocr_confidence`
export const FILE_FIELDS =
  'id, document_id, version_id, workspace_id, r2_object_key, original_filename, mime_type, size_bytes, sha256, page_number, kind, width, height, created_by, created_at'
export const FILE_KINDS = ['original', 'processed', 'thumbnail', 'pdf', 'attachment']

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
 * Base `documents` query with the visibility rules below applied for the
 * caller's membership. Used by every list-like route (documents, search,
 * albums, home) so the gate lives in SQL.
 */
/**
 * Base documents query limited to what this member may see.
 * Synchronous on purpose: PostgREST builders are thenables, so returning one
 * from an async function would execute the query early. The restricted-role
 * linked document ids are precomputed by requireWorkspace() (m.linked_document_ids).
 */
export function scopedDocumentsQuery(db, m, select = DOC_FIELDS) {
  const q = db.from('documents').select(select).eq('workspace_id', m.workspace_id)
  if (m.rank >= 30) return q
  if (m.role_key === 'restricted') {
    const linked = m.linked_document_ids ?? []
    return linked.length ? q.or(`created_by.eq.${m.user_id},id.in.(${linked.join(',')})`) : q.eq('created_by', m.user_id)
  }
  return q.or(`visibility.neq.private,created_by.eq.${m.user_id}`)
}

/** Document ids linked to a person (document_people). */
export async function personDocumentIds(db, wsId, personId) {
  const rows = unwrap(await db.from('document_people').select('document_id').eq('workspace_id', wsId).eq('person_id', personId), 'Load person documents')
  return rows.map((r) => r.document_id)
}

/** Document ids linked to a group (document_groups). */
export async function groupDocumentIds(db, wsId, groupId) {
  const rows = unwrap(await db.from('document_groups').select('document_id').eq('workspace_id', wsId).eq('group_id', groupId), 'Load group documents')
  return rows.map((r) => r.document_id)
}

/**
 * Visibility gate for a single document. Editors and above see everything in
 * the workspace; viewers see everything except private uploads of others;
 * restricted members only see documents they uploaded or that are linked to
 * their own person (document_people).
 */
export async function assertCanView(db, membership, doc) {
  const own = doc.created_by === membership.user_id
  if (own || membership.rank >= 30) return
  if (doc.visibility === 'private') throw forbidden('This document is private to its uploader')
  if (membership.role_key === 'restricted') {
    if (!membership.person_id) throw forbidden('You do not have access to this document')
    const link = unwrap(
      await db.from('document_people').select('id').eq('document_id', doc.id).eq('person_id', membership.person_id).maybeSingle(),
      'Check document link',
    )
    if (!link) throw forbidden('You do not have access to this document')
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
  return unwrap(await q.order('page_number', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true }), 'Load files')
}

/** Attaches `files` (current version only, without R2 keys) and linked `people` / `groups` to documents. */
export async function attachSummaries(db, wsId, docs) {
  if (!docs.length) return docs
  const docIds = docs.map((d) => d.id)
  const versionIds = docs.map((d) => d.current_version_id).filter(Boolean)
  const [files, people, groups] = await Promise.all([
    versionIds.length ? loadFiles(db, wsId, docIds, versionIds) : [],
    db.from('document_people').select('document_id, link_type, person:people!person_id(id, display_name, avatar_key)').eq('workspace_id', wsId).in('document_id', docIds),
    db.from('document_groups').select('document_id, group:groups!group_id(id, name, color)').eq('workspace_id', wsId).in('document_id', docIds),
  ])
  const filesBy = groupBy(files, 'document_id', publicFile)
  const peopleBy = groupBy(unwrap(people, 'Load document people').filter((r) => r.person), 'document_id', (r) => ({ ...r.person, link_type: r.link_type }))
  const groupsBy = groupBy(unwrap(groups, 'Load document groups').filter((r) => r.group), 'document_id', (r) => r.group)
  for (const d of docs) {
    d.files = filesBy.get(d.id) || []
    d.people = peopleBy.get(d.id) || []
    d.groups = groupsBy.get(d.id) || []
  }
  return docs
}

function groupBy(rows, key, map) {
  const out = new Map()
  for (const r of rows) {
    if (!out.has(r[key])) out.set(r[key], [])
    out.get(r[key]).push(map(r))
  }
  return out
}

/** Replaces the set of people / groups linked to a document. */
export async function setDocumentLinks(db, wsId, docId, { personIds, groupIds }, actorId) {
  if (personIds) {
    const ids = [...new Set(personIds)]
    if (ids.length) {
      const found = unwrap(await db.from('people').select('id').eq('workspace_id', wsId).in('id', ids).is('deleted_at', null), 'Verify people')
      if (found.length !== ids.length) throw badRequest('One or more people do not exist in this workspace')
    }
    unwrap(await db.from('document_people').delete().eq('workspace_id', wsId).eq('document_id', docId), 'Clear document people')
    if (ids.length) {
      unwrap(await db.from('document_people').insert(ids.map((person_id) => ({ workspace_id: wsId, document_id: docId, person_id, link_type: 'owner', created_by: actorId }))), 'Link people')
    }
  }
  if (groupIds) {
    const ids = [...new Set(groupIds)]
    if (ids.length) {
      const found = unwrap(await db.from('groups').select('id').eq('workspace_id', wsId).in('id', ids), 'Verify groups')
      if (found.length !== ids.length) throw badRequest('One or more groups do not exist in this workspace')
    }
    unwrap(await db.from('document_groups').delete().eq('workspace_id', wsId).eq('document_id', docId), 'Clear document groups')
    if (ids.length) {
      unwrap(await db.from('document_groups').insert(ids.map((group_id) => ({ workspace_id: wsId, document_id: docId, group_id, created_by: actorId }))), 'Link groups')
    }
  }
}

/** Strips storage internals before sending a file row to the client. */
export function publicFile(f) {
  const { r2_object_key, ...rest } = f
  return rest
}
