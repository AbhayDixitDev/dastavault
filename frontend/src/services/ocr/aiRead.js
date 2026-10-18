/**
 * Reading a page photo with the server's vision model (POST /workspaces/:ws/read),
 * which also reads handwriting: names, dates and values written by hand on a
 * printed form. The on-device reader only reads print.
 *
 *   aiReadEnabled() / setAiReadEnabled(on)   (Settings; on by default)
 *   readWithAi(workspaceId, blobs) -> { text, details, model } | null
 *   combineRead(read, ai) -> read with the model's text for the pages it saw, and read.ai = details
 *
 * Nothing here throws.
 */
import { api } from '@/services/api/client'
import { DOCUMENT_TYPE_KEYS } from '@/services/extraction/documentTypes.js'

const KEY = 'dv.aiRead'
const MAX_SIDE = 1600
const MAX_PAGES = 1

export function aiReadEnabled() {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setAiReadEnabled(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* storage blocked */ }
}

const isImage = (b) => /^image\//i.test(b?.type || '')

async function toJpegBase64(blob) {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(blob))
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
}

/** The first page photo read by the model; null when off, offline, not a photo or on failure. */
export async function readWithAi(workspaceId, blobs = []) {
  if (!workspaceId || !aiReadEnabled()) return null
  const pages = blobs.filter(isImage).slice(0, MAX_PAGES)
  if (!pages.length) return null
  try {
    const images = await Promise.all(pages.map(toJpegBase64))
    const res = await api.post(`/workspaces/${workspaceId}/read`, { images, document_types: DOCUMENT_TYPE_KEYS })
    if (!res?.text && !res?.details) return null
    return { text: String(res.text || ''), details: res.details || {}, model: res.model || null }
  } catch {
    return null
  }
}

/**
 * The model's reading replaces the on-device text of the page it saw when it
 * read at least about as much (it also has the handwriting); other pages keep
 * the on-device text.
 */
export function combineRead(read, ai) {
  const base = read || { ok: false, text: '', confidence: 0, pages: [] }
  if (!ai) return base
  const aiText = ai.text.trim()
  const pages = Array.isArray(base.pages) ? base.pages.map((p) => ({ ...p })) : []
  const first = pages[0]
  const useAi = aiText.length >= 40 && aiText.length >= (first?.text || base.text || '').length * 0.5
  if (useAi) {
    if (first) Object.assign(first, { text: aiText, confidence: Math.max(first.confidence || 0, 0.9) })
    else pages.push({ page_number: 1, text: aiText, confidence: 0.9 })
  }
  const text = useAi ? pages.map((p) => p.text || '').filter(Boolean).join('\n\n') : base.text
  return { ...base, ok: Boolean(text), text, confidence: useAi ? Math.max(base.confidence || 0, 0.9) : base.confidence, pages, ai: ai.details }
}
