import { toast } from 'sonner'
import { getSignedUrl } from '@/services/files/signedUrls'

/** The Android app's file plugin (mobile/android/.../FilesPlugin.java), or null in a browser. */
function filesPlugin() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null
  return cap?.isNativePlatform?.() ? cap.Plugins?.Files ?? null : null
}

function fileName(file, fallback = 'document') {
  return file?.original_filename || fallback
}

function browserDownload(url, name) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  a.target = '_blank'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * Saves a stored file. In the Android app it goes to Downloads/DastaVault
 * (no browser involved); on the web the browser downloads it.
 */
export async function saveStoredFile(workspaceId, file, name) {
  if (!file) return
  const url = await getSignedUrl(workspaceId, file.id, { download: true })
  if (!url) {
    toast.error('Could not get the file right now.')
    return
  }
  const plugin = filesPlugin()
  if (!plugin) {
    browserDownload(url, name || fileName(file))
    return
  }
  const id = toast.loading('Saving…')
  try {
    const { folder } = await plugin.save({ url, name: name || fileName(file), mime: file.mime_type || 'application/octet-stream' })
    toast.success(`Saved to ${folder}`, { id })
  } catch (err) {
    toast.error(err?.message || 'Could not save the file.', { id })
  }
}

/** Opens a stored file in an app on the phone (Android) or a new tab (web). */
export async function openStoredFile(workspaceId, file, { share = false } = {}) {
  if (!file) return
  const url = await getSignedUrl(workspaceId, file.id)
  if (!url) {
    toast.error('Could not get the file right now.')
    return
  }
  const plugin = filesPlugin()
  if (!plugin) {
    window.open(url, '_blank', 'noopener')
    return
  }
  try {
    await plugin.open({ url, name: fileName(file), mime: file.mime_type || 'application/octet-stream', share })
  } catch (err) {
    toast.error(err?.message || 'Could not open the file.')
  }
}

export function hasNativeFiles() {
  return Boolean(filesPlugin())
}
