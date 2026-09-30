/**
 * Small in-memory cache of signed file URLs. Signed links last 5 minutes on the
 * server, so we keep them for a bit less than that. Images are never put in Redux;
 * components ask for a URL here and hand it to an <img>.
 */
import { useEffect, useState } from 'react'
import { api } from '@/services/api/client'

const TTL_MS = 4 * 60 * 1000
const cache = new Map() // key -> { url, expiresAt }
const inflight = new Map() // key -> Promise

function keyOf(workspaceId, fileId, download) {
  return `${workspaceId}:${fileId}:${download ? 1 : 0}`
}

/** Resolves a signed URL for a file. Returns null on failure (never throws). */
export async function getSignedUrl(workspaceId, fileId, { download = false } = {}) {
  if (!workspaceId || !fileId) return null
  const key = keyOf(workspaceId, fileId, download)
  const hit = cache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.url
  if (inflight.has(key)) return inflight.get(key)
  const p = api
    .get(`/workspaces/${workspaceId}/files/${fileId}/url${download ? '?download=1' : ''}`)
    .then((r) => {
      const url = r?.url || null
      if (url) {
        const serverExp = r?.expires_at ? new Date(r.expires_at).getTime() - 30_000 : 0
        cache.set(key, { url, expiresAt: Math.min(Date.now() + TTL_MS, serverExp || Infinity) })
      }
      return url
    })
    .catch(() => null)
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

export function forgetSignedUrl(workspaceId, fileId) {
  cache.delete(keyOf(workspaceId, fileId, false))
  cache.delete(keyOf(workspaceId, fileId, true))
}

/** Downloads a file blob through its signed URL. Returns null on failure. */
export async function fetchFileBlob(workspaceId, fileId) {
  const url = await getSignedUrl(workspaceId, fileId)
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.blob()
  } catch {
    return null
  }
}

/** React hook: the signed URL for a file id (null while loading or on failure). */
export function useSignedUrl(workspaceId, fileId, { download = false, enabled = true } = {}) {
  const [state, setState] = useState({ url: null, error: false, loading: !!fileId })

  useEffect(() => {
    let alive = true
    if (!enabled || !workspaceId || !fileId) {
      setState({ url: null, error: false, loading: false })
      return undefined
    }
    setState((s) => ({ ...s, loading: true }))
    getSignedUrl(workspaceId, fileId, { download }).then((url) => {
      if (!alive) return
      setState({ url, error: !url, loading: false })
    })
    return () => {
      alive = false
    }
  }, [workspaceId, fileId, download, enabled])

  return state
}
