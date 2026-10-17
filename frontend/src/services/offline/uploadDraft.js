import { db } from './db'

/**
 * The upload page's unfinished work (files picked plus the details typed),
 * kept on this device so closing the app or leaving the page loses nothing.
 * One draft per workspace, in the `drafts` table.
 */
const keyOf = (workspaceId) => `upload:${workspaceId}`

const KEEP = ['id', 'name', 'document_type', 'person_ids', 'group_ids', 'tags', 'touched', 'read', 'found', 'nameOptions', 'versionOf', 'size', 'faces', 'location']

export async function saveUploadDraft(workspaceId, items) {
  if (!workspaceId) return
  try {
    // Kept until the server has it: also while uploading, in case the app is closed meanwhile.
    const open = items.filter((it) => !['uploaded', 'reading', 'ready', 'waiting'].includes(it.status) && !it.documentId)
    if (!open.length) {
      await db.drafts.delete(keyOf(workspaceId))
      return
    }
    const stored = open.map((it) => ({
      ...Object.fromEntries(KEEP.map((k) => [k, it[k] ?? null])),
      files: it.files.map((f) => ({ blob: f, name: f.name, type: f.type, lastModified: f.lastModified })),
    }))
    await db.drafts.put({ id: keyOf(workspaceId), workspaceId, kind: 'upload', updatedAt: Date.now(), items: stored })
  } catch {
    /* storage full or blocked: the page still works */
  }
}

/** Items saved earlier, with their files as File objects again; [] when there is none. */
export async function loadUploadDraft(workspaceId) {
  if (!workspaceId) return []
  try {
    const row = await db.drafts.get(keyOf(workspaceId))
    return (row?.items ?? []).map((it) => ({
      ...it,
      files: (it.files || []).map((f) => new File([f.blob], f.name || 'file', { type: f.type || f.blob?.type || '', lastModified: f.lastModified || Date.now() })),
    })).filter((it) => it.files.length)
  } catch {
    return []
  }
}

export async function countUploadDraft(workspaceId) {
  try {
    const row = await db.drafts.get(keyOf(workspaceId))
    return row?.items?.length ?? 0
  } catch {
    return 0
  }
}

export async function clearUploadDraft(workspaceId) {
  try {
    await db.drafts.delete(keyOf(workspaceId))
  } catch {
    /* nothing to clear */
  }
}
