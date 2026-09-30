import { db } from '@/services/offline/db'

/**
 * Offline drafts in Dexie (`drafts` table: id, workspaceId, kind, updatedAt).
 * `payload` holds the fields to send; private note payloads are already encrypted.
 * None of these throw.
 */
export async function saveDraft(id, workspaceId, kind, payload) {
  try {
    await db.drafts.put({ id, workspaceId, kind, updatedAt: Date.now(), payload })
    return true
  } catch {
    return false
  }
}

export async function getDraft(id) {
  try {
    return (await db.drafts.get(id)) || null
  } catch {
    return null
  }
}

export async function deleteDraft(id) {
  try {
    await db.drafts.delete(id)
  } catch {
    /* ignore */
  }
}

export async function listDrafts(workspaceId, kind) {
  try {
    const all = await db.drafts.where('workspaceId').equals(workspaceId).toArray()
    return kind ? all.filter((d) => d.kind === kind) : all
  } catch {
    return []
  }
}
