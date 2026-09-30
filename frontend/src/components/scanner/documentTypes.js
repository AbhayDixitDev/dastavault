/**
 * Document types for the scanner's Save sheet. The documents agent may ship a
 * shared list at src/components/documents/documentTypes.js; loadDocumentTypes()
 * prefers that one when it exists and falls back to this copy.
 */
import { DOCUMENT_TYPE_LABELS } from '@/services/extraction/documentTypes'

export const DOCUMENT_TYPES = Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => ({ value, label }))

const shared = import.meta.glob('../documents/documentTypes.js')

function normalise(list) {
  if (!Array.isArray(list) || !list.length) return null
  const out = list
    .map((t) => {
      if (typeof t === 'string') return { value: t, label: DOCUMENT_TYPE_LABELS[t] || t.replace(/_/g, ' ') }
      const value = t?.value ?? t?.key ?? t?.id
      if (!value) return null
      return { value, label: t.label ?? t.name ?? DOCUMENT_TYPE_LABELS[value] ?? String(value).replace(/_/g, ' ') }
    })
    .filter(Boolean)
  return out.length ? out : null
}

export async function loadDocumentTypes() {
  const loader = shared['../documents/documentTypes.js']
  if (!loader) return DOCUMENT_TYPES
  try {
    const mod = await loader()
    return normalise(mod.DOCUMENT_TYPES || mod.documentTypes || mod.default) || DOCUMENT_TYPES
  } catch {
    return DOCUMENT_TYPES
  }
}
