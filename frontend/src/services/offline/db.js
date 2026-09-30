import Dexie from 'dexie'

/**
 * Local database for offline work.
 * pendingCaptures: scanned pages waiting to be saved as a document.
 * pendingUploads:  files waiting for the server to confirm the upload.
 * drafts:          note / document detail drafts.
 * recentCache:     recently opened documents for offline viewing.
 */
export const db = new Dexie('dastavault')

db.version(1).stores({
  pendingCaptures: '++id, workspaceId, createdAt, status',
  pendingUploads: 'id, workspaceId, createdAt, status',
  drafts: 'id, workspaceId, kind, updatedAt',
  recentCache: 'id, workspaceId, openedAt',
})

export const UPLOAD_STATUS = {
  SAVED_ON_DEVICE: 'saved_on_device',
  UPLOADING: 'uploading',
  UPLOADED: 'uploaded',
  FAILED: 'failed',
}

export const UPLOAD_STATUS_LABEL = {
  saved_on_device: 'Saved on this device',
  uploading: 'Uploading',
  uploaded: 'Uploaded',
  failed: 'Upload failed',
}
