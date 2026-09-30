/**
 * In-progress scan state: a tiny external store (useSyncExternalStore) mirrored
 * to Dexie `pendingCaptures` so a scan survives navigation and reloads.
 *
 * page: { id, original: Blob, width, height, rotation, corners: [4], suggested: [4]|null,
 *         detected: bool, mode: 'auto'|'color'|'grayscale'|'bw', brightness, contrast,
 *         processed: Blob|null, previewUrl, thumbUrl, createdAt }
 */
import { useSyncExternalStore } from 'react'
import { db } from '@/services/offline/db'

const listeners = new Set()
let state = {
  workspaceId: null,
  pages: [],
  hydrated: false,
  hydratedFor: null,
}

function emit() {
  for (const l of listeners) l()
}

export function getScanState() {
  return state
}

export function subscribeScan(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useScanState() {
  return useSyncExternalStore(subscribeScan, getScanState, getScanState)
}

function setState(patch) {
  state = { ...state, ...patch }
  emit()
}

function uid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function url(blob) {
  try { return blob ? URL.createObjectURL(blob) : null } catch { return null }
}

function revoke(u) {
  try { if (u) URL.revokeObjectURL(u) } catch { /* ignore */ }
}

/* ---------------------------------------------------------- persist */

function toRow(page, workspaceId) {
  return {
    id: page.dbId,
    workspaceId,
    createdAt: page.createdAt,
    status: 'draft',
    pageId: page.id,
    original: page.original,
    processed: page.processed || null,
    width: page.width,
    height: page.height,
    rotation: page.rotation || 0,
    corners: page.corners,
    suggested: page.suggested || null,
    detected: !!page.detected,
    mode: page.mode || 'auto',
    brightness: page.brightness || 0,
    contrast: page.contrast || 0,
    order: page.order ?? 0,
  }
}

async function persist(page) {
  try {
    const row = toRow(page, state.workspaceId)
    if (page.dbId) {
      await db.pendingCaptures.put(row)
    } else {
      const { id: _drop, ...rest } = row
      const dbId = await db.pendingCaptures.add(rest)
      page.dbId = dbId
    }
  } catch { /* the scan still lives in memory */ }
}

async function persistOrder() {
  try {
    await db.transaction('rw', db.pendingCaptures, async () => {
      for (let i = 0; i < state.pages.length; i++) {
        const p = state.pages[i]
        if (p.dbId) await db.pendingCaptures.update(p.dbId, { order: i })
      }
    })
  } catch { /* ignore */ }
}

/** Load a saved scan for this workspace, if any, when memory is empty. */
export async function hydrateScan(workspaceId) {
  if (state.hydratedFor === workspaceId && state.hydrated) return state.pages.length
  if (state.workspaceId && state.workspaceId !== workspaceId && state.pages.length) {
    // Switching workspace: forget the in-memory pages of the other workspace (they stay in Dexie).
    for (const p of state.pages) { revoke(p.previewUrl); revoke(p.thumbUrl) }
    state = { ...state, pages: [] }
  }
  let rows = []
  try {
    rows = await db.pendingCaptures.where('workspaceId').equals(workspaceId).toArray()
  } catch { rows = [] }
  const pages = rows
    .filter((r) => r.status === 'draft' && r.original)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt)
    .map((r) => ({
      id: r.pageId || uid(),
      dbId: r.id,
      original: r.original,
      processed: r.processed || null,
      width: r.width,
      height: r.height,
      rotation: r.rotation || 0,
      corners: r.corners,
      suggested: r.suggested || null,
      detected: !!r.detected,
      mode: r.mode || 'auto',
      brightness: r.brightness || 0,
      contrast: r.contrast || 0,
      createdAt: r.createdAt,
      previewUrl: url(r.original),
      thumbUrl: url(r.processed || r.original),
      order: r.order ?? 0,
    }))
  setState({ workspaceId, pages: state.pages.length ? state.pages : pages, hydrated: true, hydratedFor: workspaceId })
  return state.pages.length
}

/* ---------------------------------------------------------- actions */

export function addPage({ original, width, height, corners, suggested, detected }) {
  const page = {
    id: uid(),
    dbId: null,
    original,
    processed: null,
    width,
    height,
    rotation: 0,
    corners,
    suggested: suggested || null,
    detected: !!detected,
    mode: 'auto',
    brightness: 0,
    contrast: 0,
    createdAt: Date.now(),
    previewUrl: url(original),
    thumbUrl: null,
    order: state.pages.length,
  }
  setState({ pages: [...state.pages, page] })
  persist(page)
  return page.id
}

export function updatePage(id, patch) {
  const pages = state.pages.map((p) => {
    if (p.id !== id) return p
    const next = { ...p, ...patch }
    if (patch.original && patch.original !== p.original) { revoke(p.previewUrl); next.previewUrl = url(patch.original) }
    if ('processed' in patch && patch.processed !== p.processed) { revoke(p.thumbUrl); next.thumbUrl = url(patch.processed || next.original) }
    return next
  })
  setState({ pages })
  const page = pages.find((p) => p.id === id)
  if (page) persist(page)
}

export function removePage(id) {
  const page = state.pages.find((p) => p.id === id)
  if (!page) return
  revoke(page.previewUrl)
  revoke(page.thumbUrl)
  setState({ pages: state.pages.filter((p) => p.id !== id) })
  if (page.dbId) db.pendingCaptures.delete(page.dbId).catch(() => {})
  persistOrder()
}

export function movePage(id, direction) {
  const idx = state.pages.findIndex((p) => p.id === id)
  const to = idx + direction
  if (idx < 0 || to < 0 || to >= state.pages.length) return
  const pages = [...state.pages]
  const [item] = pages.splice(idx, 1)
  pages.splice(to, 0, item)
  setState({ pages: pages.map((p, i) => ({ ...p, order: i })) })
  persistOrder()
}

export function reorderPages(fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= state.pages.length || toIndex >= state.pages.length) return
  const pages = [...state.pages]
  const [item] = pages.splice(fromIndex, 1)
  pages.splice(toIndex, 0, item)
  setState({ pages: pages.map((p, i) => ({ ...p, order: i })) })
  persistOrder()
}

export function clearScan() {
  for (const p of state.pages) { revoke(p.previewUrl); revoke(p.thumbUrl) }
  const ws = state.workspaceId
  setState({ pages: [] })
  if (ws) db.pendingCaptures.where('workspaceId').equals(ws).delete().catch(() => {})
}

export function setScanWorkspace(workspaceId) {
  if (state.workspaceId !== workspaceId) setState({ workspaceId })
}
