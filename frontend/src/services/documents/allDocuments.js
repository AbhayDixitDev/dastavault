import { api } from '@/services/api/client'

const PAGE = 100
const MAX_PAGES = 20 // up to 2000 documents

// Last full list per workspace: shown at once while a fresh one loads.
const memory = new Map()

export function rememberedDocuments(workspaceId) {
  return memory.get(workspaceId) ?? null
}

/**
 * Every document of the workspace (newest first), with files, people and
 * faces. `onFirstPage(docs)` gets the first page early.
 */
export async function loadAllDocuments(workspaceId, { onFirstPage } = {}) {
  const all = []
  let cursor = null
  for (let i = 0; i < MAX_PAGES; i++) {
    const params = new URLSearchParams({ limit: String(PAGE), sort: 'created_at', order: 'desc' })
    if (cursor) params.set('cursor', cursor)
    // eslint-disable-next-line no-await-in-loop
    const r = await api.get(`/workspaces/${workspaceId}/documents?${params}`)
    all.push(...(r?.documents ?? []))
    cursor = r?.next_cursor
    if (i === 0) onFirstPage?.([...all], Boolean(cursor))
    if (!cursor) break
  }
  memory.set(workspaceId, all)
  return all
}

/** The remembered list, or a fresh one when there is none yet. */
export async function allDocuments(workspaceId) {
  return memory.get(workspaceId) ?? loadAllDocuments(workspaceId)
}
