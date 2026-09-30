import { getAccessToken } from '@/lib/supabase'
import { API_URL } from '@/store/api/baseApi'

export class ApiError extends Error {
  constructor(message, { status, code, details, requestId } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.requestId = requestId
  }
}

/**
 * Plain fetch wrapper for code outside React components (services, workers, upload queue).
 * Inside components prefer the RTK Query hooks. Both hit the same Worker with the same token.
 *
 *   await api.get(`/workspaces/${ws}/documents`)
 *   await api.post(`/workspaces/${ws}/uploads`, formData)          // FormData is sent as multipart
 *   await api.put(`/workspaces/${ws}/documents/${id}/text`, {...}) // objects are sent as JSON
 */
async function request(method, path, body, { signal, headers = {}, onUploadProgress } = {}) {
  const token = await getAccessToken()
  const h = { ...headers }
  if (token) h.authorization = `Bearer ${token}`
  let payload = body
  if (body && !(body instanceof FormData) && !(body instanceof Blob) && typeof body === 'object') {
    h['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  // XHR path only when progress is requested (fetch has no upload progress yet).
  if (onUploadProgress && payload instanceof FormData) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open(method, `${API_URL}/api${path}`)
      Object.entries(h).forEach(([k, v]) => xhr.setRequestHeader(k, v))
      xhr.upload.onprogress = (e) => e.lengthComputable && onUploadProgress(e.loaded / e.total)
      xhr.onload = () => {
        let json = null
        try { json = JSON.parse(xhr.responseText) } catch { /* not json */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(json)
        else reject(new ApiError(json?.error || `Request failed (${xhr.status})`, { status: xhr.status, code: json?.code, details: json?.details, requestId: json?.request_id }))
      }
      xhr.onerror = () => reject(new ApiError('Cannot reach the server. Check your connection.', { status: 0, code: 'network' }))
      if (signal) signal.addEventListener('abort', () => xhr.abort())
      xhr.send(payload)
    })
  }

  let res
  try {
    res = await fetch(`${API_URL}/api${path}`, { method, headers: h, body: payload, signal })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new ApiError('Cannot reach the server. Check your connection.', { status: 0, code: 'network' })
  }
  if (res.status === 204) return null
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* non-json body */ }
  if (!res.ok) {
    throw new ApiError(json?.error || `Request failed (${res.status})`, { status: res.status, code: json?.code, details: json?.details, requestId: json?.request_id })
  }
  return json
}

export const api = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body, opts) => request('POST', path, body, opts),
  put: (path, body, opts) => request('PUT', path, body, opts),
  patch: (path, body, opts) => request('PATCH', path, body, opts),
  delete: (path, opts) => request('DELETE', path, undefined, opts),
}
