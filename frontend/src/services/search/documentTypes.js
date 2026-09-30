import { useEffect, useState } from 'react'
import { loadOptional, OPTIONAL } from './optional'

/** Fallback list (contract section 3) used until the documents agent's list is present. */
export const FALLBACK_DOCUMENT_TYPES = [
  { key: 'passport', label: 'Passport' },
  { key: 'aadhaar', label: 'Aadhaar' },
  { key: 'pan', label: 'PAN card' },
  { key: 'driving_licence', label: 'Driving licence' },
  { key: 'voter_id', label: 'Voter ID' },
  { key: 'birth_certificate', label: 'Birth certificate' },
  { key: 'marksheet', label: 'Marksheet' },
  { key: 'degree', label: 'Degree' },
  { key: 'id_card', label: 'ID card' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'medical_report', label: 'Medical report' },
  { key: 'prescription', label: 'Prescription' },
  { key: 'invoice', label: 'Invoice' },
  { key: 'receipt', label: 'Receipt' },
  { key: 'bank_statement', label: 'Bank statement' },
  { key: 'tax', label: 'Tax' },
  { key: 'salary_slip', label: 'Salary slip' },
  { key: 'contract', label: 'Contract' },
  { key: 'agreement', label: 'Agreement' },
  { key: 'letter', label: 'Letter' },
  { key: 'certificate', label: 'Certificate' },
  { key: 'property', label: 'Property' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'utility_bill', label: 'Utility bill' },
  { key: 'ticket', label: 'Ticket' },
  { key: 'photo', label: 'Photo' },
  { key: 'note', label: 'Note' },
  { key: 'written', label: 'Written document' },
  { key: 'other', label: 'Other' },
]

export const IDENTITY_TYPES = ['passport', 'aadhaar', 'pan', 'driving_licence', 'voter_id', 'id_card', 'birth_certificate']

/** Accepts arrays of { key|value|id, label|name } or a { key: label } map. */
function normalise(list) {
  if (!list) return null
  if (Array.isArray(list)) {
    const out = list
      .map((t) => {
        if (typeof t === 'string') return { key: t, label: labelFromKey(t) }
        const key = t.key ?? t.value ?? t.id
        if (!key) return null
        return { key, label: t.label ?? t.name ?? labelFromKey(key), icon: t.icon }
      })
      .filter(Boolean)
    return out.length ? out : null
  }
  if (typeof list === 'object') {
    const out = Object.entries(list).map(([key, v]) => ({
      key,
      label: typeof v === 'string' ? v : v?.label ?? v?.name ?? labelFromKey(key),
      icon: typeof v === 'object' ? v?.icon : undefined,
    }))
    return out.length ? out : null
  }
  return null
}

export function labelFromKey(key = '') {
  const found = FALLBACK_DOCUMENT_TYPES.find((t) => t.key === key)
  if (found) return found.label
  const s = String(key).replace(/[_-]+/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : ''
}

let resolved = null
let pending = null

export async function getDocumentTypes() {
  if (resolved) return resolved
  if (!pending) {
    pending = loadOptional(OPTIONAL.documentTypes)
      .then((mod) => normalise(mod?.DOCUMENT_TYPES ?? mod?.default) ?? FALLBACK_DOCUMENT_TYPES)
      .catch(() => FALLBACK_DOCUMENT_TYPES)
      .then((list) => {
        resolved = list
        return list
      })
  }
  return pending
}

/** React hook: returns the document type list (fallback first, then the shared list). */
export function useDocumentTypes() {
  const [types, setTypes] = useState(resolved ?? FALLBACK_DOCUMENT_TYPES)
  useEffect(() => {
    let alive = true
    getDocumentTypes().then((list) => alive && setTypes(list))
    return () => {
      alive = false
    }
  }, [])
  return types
}

export function typeLabel(key, types) {
  if (!key) return ''
  const list = types ?? resolved ?? FALLBACK_DOCUMENT_TYPES
  return list.find((t) => t.key === key)?.label ?? labelFromKey(key)
}
