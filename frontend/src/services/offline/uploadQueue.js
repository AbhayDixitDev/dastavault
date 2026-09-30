/**
 * Offline-first upload queue (contract section 10), backed by Dexie `pendingUploads`.
 *
 *   enqueueUpload({ workspaceId, files, name, document_type, person_ids, group_ids, sha256s }) -> id
 *   startUploadQueue()   call once from the app shell
 *   useUploadQueue()     -> { items, retry(id), remove(id) }
 *   waitForUpload(id)    -> Promise<item> (resolves when uploaded or failed)
 *
 * Row: { id, workspaceId, createdAt, status, progress, error, name, document_type,
 *        person_ids, group_ids, files: [{ blob, name, kind, page_number, sha256 }],
 *        attempts, nextAttemptAt, documentId, versionId, derived: { processed, thumbnail, pdf },
 *        processing, statusText, lastError }
 *
 * status: saved_on_device | uploading | uploaded | failed
 * Uploads use the contract form (files[] in one request) and fall back to the
 * one-file-per-request form when the server does not accept it.
 */
import { useEffect, useState, useCallback } from 'react'
import { liveQuery } from 'dexie'
import { db, UPLOAD_STATUS } from './db'
import { api, ApiError } from '@/services/api/client'
import { processDocument } from '@/services/pipeline/processDocument'

const BACKOFF_MS = [5000, 15000, 60000]
const MAX_AUTO_ATTEMPTS = 8
const DONE_TTL_MS = 60 * 1000

let started = false
let running = false
let timer = null
let multiFileSupported = true
const waiters = new Map()
const listeners = new Set()

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function online() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false
}

async function update(id, patch) {
  try {
    await db.pendingUploads.update(id, { ...patch, updatedAt: Date.now() })
  } catch { /* the row may have been removed */ }
  const item = await db.pendingUploads.get(id).catch(() => null)
  for (const l of listeners) { try { l(item) } catch { /* ignore */ } }
  const w = item && waiters.get(id)
  if (w) {
    if (item.status === UPLOAD_STATUS.UPLOADED && item.documentId) { waiters.delete(id); w.resolve(item) }
    else if (item.status === UPLOAD_STATUS.FAILED && w.settleOnFail) { waiters.delete(id); w.resolve(item) }
  }
}

/** Subscribe to every row change (used by the scanner page). Returns unsubscribe. */
export function onUploadChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Add a document to the queue. Files are stored on this device until the server confirms.
 */
export async function enqueueUpload({ workspaceId, files = [], name, document_type, person_ids = [], group_ids = [], sha256s = [], client_upload_id, people, groups } = {}) {
  const id = client_upload_id || uuid()
  const rows = files
    .filter((f) => f?.blob)
    .map((f, i) => ({
      blob: f.blob,
      name: f.name || `page-${f.page_number || i + 1}.jpg`,
      kind: f.kind || 'original',
      page_number: f.page_number ?? null,
      sha256: f.sha256 || sha256s[i] || null,
      uploaded: false,
    }))
  const row = {
    id,
    workspaceId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: UPLOAD_STATUS.SAVED_ON_DEVICE,
    progress: 0,
    error: null,
    name: name || null,
    document_type: document_type || null,
    person_ids: Array.isArray(person_ids) ? person_ids : [],
    group_ids: Array.isArray(group_ids) ? group_ids : [],
    files: rows,
    attempts: 0,
    nextAttemptAt: 0,
    documentId: null,
    versionId: null,
    derived: { processed: false, thumbnail: false, pdf: false },
    processing: false,
    statusText: online() ? 'Waiting to upload' : 'Saved on this device. Will upload when online.',
    pageCount: rows.filter((r) => r.kind === 'original').length || rows.length,
    people: Array.isArray(people) ? people.map((p) => ({ id: p.id, display_name: p.display_name })) : null,
    groups: Array.isArray(groups) ? groups.map((g) => ({ id: g.id, name: g.name })) : null,
  }
  await db.pendingUploads.put(row)
  for (const l of listeners) { try { l(row) } catch { /* ignore */ } }
  startUploadQueue()
  kick()
  return id
}

/** Resolves when the item is uploaded (document created) or, with settleOnFail, when it fails. */
export function waitForUpload(id, { settleOnFail = true } = {}) {
  return new Promise((resolve) => {
    db.pendingUploads.get(id).then((item) => {
      if (!item) return resolve(null)
      if (item.status === UPLOAD_STATUS.UPLOADED && item.documentId) return resolve(item)
      if (item.status === UPLOAD_STATUS.FAILED && settleOnFail) return resolve(item)
      waiters.set(id, { resolve, settleOnFail })
    }).catch(() => resolve(null))
  })
}

/* --------------------------------------------------------- uploading */

function isPermanent(err) {
  if (!(err instanceof ApiError)) return false
  if (err.status === 0) return false
  if ([401, 408, 425, 429].includes(err.status)) return false
  return err.status >= 400 && err.status < 500
}

function friendly(err) {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'Waiting for internet connection.'
    if (err.status === 413) return 'This file is too large to upload.'
    if (err.status === 403) return 'You do not have permission to add documents here.'
    return err.message || 'Upload failed.'
  }
  return err?.message || 'Upload failed.'
}

function appendFile(fd, key, f) {
  const file = f.blob instanceof File ? f.blob : new File([f.blob], f.name, { type: f.blob.type || 'application/octet-stream' })
  fd.append(key, file, f.name)
}

async function uploadMulti(item, originals, onProgress) {
  const fd = new FormData()
  for (const f of originals) fd.append('files[]', f.blob instanceof File ? f.blob : new File([f.blob], f.name, { type: f.blob.type }), f.name)
  for (const f of originals) fd.append('sha256[]', f.sha256 || '')
  for (const f of originals) fd.append('page_numbers[]', String(f.page_number ?? ''))
  if (item.name) fd.append('name', item.name)
  if (item.document_type) fd.append('document_type', item.document_type)
  fd.append('person_ids', JSON.stringify(item.person_ids || []))
  fd.append('group_ids', JSON.stringify(item.group_ids || []))
  fd.append('client_upload_id', item.id)
  fd.append('kind', 'original')
  return api.post(`/workspaces/${item.workspaceId}/uploads`, fd, { onUploadProgress: onProgress })
}

async function uploadSingle(item, originals, onProgress) {
  let document = null
  let version = null
  const n = originals.length
  for (let i = 0; i < n; i++) {
    const f = originals[i]
    const fd = new FormData()
    appendFile(fd, 'file', f)
    if (f.sha256) fd.append('sha256', f.sha256)
    fd.append('kind', 'original')
    if (f.page_number != null) fd.append('page_number', String(f.page_number))
    if (document) fd.append('document_id', document.id)
    else {
      if (item.name) fd.append('name', item.name)
      if (item.document_type) fd.append('document_type', item.document_type)
      if (item.person_ids?.[0]) fd.append('person_id', item.person_ids[0])
      fd.append('client_upload_id', item.id)
    }
    const res = await api.post(`/workspaces/${item.workspaceId}/uploads`, fd, { onUploadProgress: (p) => onProgress((i + p) / n) })
    document = res.document
    version = res.version
  }
  if (document && ((item.person_ids?.length || 0) > 1 || item.group_ids?.length)) {
    await api.patch(`/workspaces/${item.workspaceId}/documents/${document.id}`, { person_ids: item.person_ids, group_ids: item.group_ids }).catch(() => {})
  }
  return { document, version }
}

async function uploadDerived(item, kind, files) {
  if (!files.length) return
  const base = `/workspaces/${item.workspaceId}`
  if (multiFileSupported) {
    try {
      const fd = new FormData()
      for (const f of files) fd.append('files[]', f.blob instanceof File ? f.blob : new File([f.blob], f.name, { type: f.blob.type }), f.name)
      fd.append('kind', kind)
      for (const f of files) fd.append('page_numbers[]', String(f.page_number ?? ''))
      await api.post(`${base}/documents/${item.documentId}/versions/${item.versionId}/files`, fd)
      return
    } catch (err) {
      if (!(err instanceof ApiError && (err.status === 404 || err.status === 400))) throw err
      // fall through to the single-file route
    }
  }
  for (const f of files) {
    const fd = new FormData()
    appendFile(fd, 'file', f)
    fd.append('kind', kind)
    fd.append('document_id', item.documentId)
    if (f.page_number != null) fd.append('page_number', String(f.page_number))
    if (f.sha256) fd.append('sha256', f.sha256)
    await api.post(`${base}/uploads`, fd)
  }
}

async function processItem(item) {
  const id = item.id
  const originals = item.files.filter((f) => f.kind === 'original')
  const processed = item.files.filter((f) => f.kind === 'processed')
  const thumbs = item.files.filter((f) => f.kind === 'thumbnail')
  const pdfs = item.files.filter((f) => f.kind === 'pdf')
  const attachments = item.files.filter((f) => f.kind === 'attachment')
  const firstBatch = originals.length ? originals : item.files.filter((f) => f.kind !== 'thumbnail')

  await update(id, { status: UPLOAD_STATUS.UPLOADING, statusText: 'Uploading', progress: 0, error: null })
  const onProgress = (p) => update(id, { progress: Math.max(0, Math.min(1, p)) })

  try {
    if (!item.documentId) {
      let res
      if (multiFileSupported) {
        try {
          res = await uploadMulti(item, firstBatch, onProgress)
        } catch (err) {
          if (err instanceof ApiError && err.status === 400 && /file/i.test(err.message || '')) {
            multiFileSupported = false
            res = await uploadSingle(item, firstBatch, onProgress)
          } else throw err
        }
      } else {
        res = await uploadSingle(item, firstBatch, onProgress)
      }
      if (!res?.document?.id) throw new Error('The server did not confirm the upload.')
      item = { ...item, documentId: res.document.id, versionId: res.version?.id || res.document.current_version_id }
      await update(id, { documentId: item.documentId, versionId: item.versionId, progress: 1 })
    }

    const derived = { ...(item.derived || {}) }
    if (!derived.processed && originals.length && processed.length) { await uploadDerived(item, 'processed', processed); derived.processed = true; await update(id, { derived }) }
    if (!derived.thumbnail && thumbs.length) { await uploadDerived(item, 'thumbnail', thumbs); derived.thumbnail = true; await update(id, { derived }) }
    if (!derived.pdf && originals.length && pdfs.length) { await uploadDerived(item, 'pdf', pdfs); derived.pdf = true; await update(id, { derived }) }
    if (!derived.attachment && attachments.length) { await uploadDerived(item, 'attachment', attachments); derived.attachment = true; await update(id, { derived }) }

    await update(id, { status: UPLOAD_STATUS.UPLOADED, statusText: 'Uploaded', processing: true, error: null, progress: 1 })

    // Text, details, search. Never blocks the upload state.
    try {
      const fresh = await db.pendingUploads.get(id)
      const people = fresh?.people || null
      const groups = fresh?.groups || null
      await processDocument({
        workspaceId: item.workspaceId,
        documentId: item.documentId,
        versionId: item.versionId,
        files: item.files.map((f) => ({ kind: f.kind, mime_type: f.blob?.type, page_number: f.page_number, blob: f.blob })),
        people: people || (await api.get(`/workspaces/${item.workspaceId}/people`).then((r) => r.people || []).catch(() => [])),
        groups: groups || (await api.get(`/workspaces/${item.workspaceId}/groups`).then((r) => r.groups || []).catch(() => [])),
        onStatus: (text) => update(id, { statusText: text }),
      })
    } catch { /* processDocument never throws */ }
    await update(id, { processing: false, files: [], doneAt: Date.now() })
    setTimeout(() => cleanup(), DONE_TTL_MS + 500)
  } catch (err) {
    const attempts = (item.attempts || 0) + 1
    const permanent = isPermanent(err)
    const giveUp = permanent || attempts >= MAX_AUTO_ATTEMPTS
    const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]
    await update(id, {
      status: giveUp ? UPLOAD_STATUS.FAILED : UPLOAD_STATUS.SAVED_ON_DEVICE,
      statusText: giveUp ? 'Upload failed' : online() ? `Will try again in ${Math.round(wait / 1000)}s` : 'Saved on this device. Will upload when online.',
      error: friendly(err),
      attempts,
      nextAttemptAt: giveUp ? 0 : Date.now() + wait,
      progress: 0,
    })
  }
}

async function cleanup() {
  try {
    const cutoff = Date.now() - DONE_TTL_MS
    const rows = await db.pendingUploads.where('status').equals(UPLOAD_STATUS.UPLOADED).toArray()
    for (const r of rows) if (!r.processing && (r.doneAt || r.updatedAt || 0) < cutoff) await db.pendingUploads.delete(r.id)
    for (const l of listeners) { try { l(null) } catch { /* ignore */ } }
  } catch { /* ignore */ }
}

async function run() {
  if (running) return
  running = true
  try {
    // Recover rows stuck in "uploading" from a previous session.
    const stuck = await db.pendingUploads.where('status').equals(UPLOAD_STATUS.UPLOADING).toArray()
    for (const s of stuck) await update(s.id, { status: UPLOAD_STATUS.SAVED_ON_DEVICE, statusText: 'Waiting to upload' })
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (!online()) break
      const now = Date.now()
      const pending = (await db.pendingUploads.where('status').equals(UPLOAD_STATUS.SAVED_ON_DEVICE).toArray())
        .filter((r) => !r.nextAttemptAt || r.nextAttemptAt <= now)
        .sort((a, b) => a.createdAt - b.createdAt)
      if (!pending.length) break
      await processItem(pending[0])
    }
  } catch { /* try again on the next tick */ } finally {
    running = false
  }
}

function kick() {
  if (!started) return
  run()
}

/**
 * Start the background queue. Safe to call many times; only the first call does anything.
 */
export function startUploadQueue() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('online', () => {
    db.pendingUploads.where('status').equals(UPLOAD_STATUS.SAVED_ON_DEVICE).modify({ statusText: 'Waiting to upload' }).catch(() => {})
    kick()
  })
  window.addEventListener('offline', () => {
    db.pendingUploads.where('status').equals(UPLOAD_STATUS.SAVED_ON_DEVICE).modify({ statusText: 'Saved on this device. Will upload when online.' }).catch(() => {})
  })
  timer = setInterval(kick, 5000)
  cleanup()
  kick()
}

export function stopUploadQueue() {
  clearInterval(timer)
  timer = null
  started = false
}

export async function retryUpload(id) {
  await update(id, { status: UPLOAD_STATUS.SAVED_ON_DEVICE, statusText: 'Waiting to upload', error: null, attempts: 0, nextAttemptAt: 0 })
  startUploadQueue()
  kick()
}

export async function removeUpload(id) {
  try { await db.pendingUploads.delete(id) } catch { /* ignore */ }
  const w = waiters.get(id)
  if (w) { waiters.delete(id); w.resolve(null) }
  for (const l of listeners) { try { l(null) } catch { /* ignore */ } }
}

/* -------------------------------------------------------------- hook */

/**
 * Live list of queued uploads (oldest first). Blobs are not included in the items.
 */
export function useUploadQueue() {
  const [items, setItems] = useState([])
  useEffect(() => {
    let sub = null
    let poll = null
    const strip = (rows) => rows
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(({ files, ...rest }) => ({ ...rest, fileCount: files?.length ?? 0 }))
    try {
      sub = liveQuery(() => db.pendingUploads.toArray()).subscribe({
        next: (rows) => setItems(strip(rows)),
        error: () => {
          poll = setInterval(() => db.pendingUploads.toArray().then((rows) => setItems(strip(rows))).catch(() => {}), 2000)
        },
      })
    } catch {
      poll = setInterval(() => db.pendingUploads.toArray().then((rows) => setItems(strip(rows))).catch(() => {}), 2000)
    }
    return () => {
      try { sub?.unsubscribe() } catch { /* ignore */ }
      clearInterval(poll)
    }
  }, [])
  const retry = useCallback((id) => retryUpload(id), [])
  const remove = useCallback((id) => removeUpload(id), [])
  return { items, retry, remove }
}
