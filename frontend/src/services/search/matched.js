import { typeLabel } from './documentTypes'

/**
 * Builds the plain-words "why it matched" line for a search result:
 *   "Matched: Rajesh Patel, Passport"
 * from `result.matched` (name|text|meaning|person|number|type|tag) and the
 * query's `resolved` block.
 */
export function whyMatched(result, resolved = {}, { people = [], types } = {}) {
  const parts = []
  const matched = Array.isArray(result?.matched) ? result.matched : []
  const doc = result?.document ?? {}

  const resolvedNames = new Set((resolved?.person_names ?? []).map((n) => n.toLowerCase()))
  const docPeople = Array.isArray(doc.people) ? doc.people : []

  for (const m of matched) {
    switch (m) {
      case 'person': {
        const hit = docPeople.filter((p) => resolvedNames.has((p.display_name ?? '').toLowerCase())).map((p) => p.display_name)
        const names = hit.length ? hit : resolved?.person_names?.length ? resolved.person_names : docPeople.map((p) => p.display_name)
        names.filter(Boolean).forEach((n) => parts.push(n))
        break
      }
      case 'type': {
        const key = resolved?.document_type || doc.document_type
        if (key) parts.push(typeLabel(key, types))
        break
      }
      case 'name':
        parts.push('the name')
        break
      case 'text':
        parts.push('words inside')
        break
      case 'meaning':
        parts.push('meaning')
        break
      case 'number':
        parts.push(doc.document_number ? `number ${doc.document_number}` : 'document number')
        break
      case 'tag': {
        const tagNames = (Array.isArray(doc.tags) ? doc.tags : []).map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean)
        parts.push(tagNames.length ? `tag ${tagNames.slice(0, 2).join(', ')}` : 'a tag')
        break
      }
      default:
        if (typeof m === 'string' && m) parts.push(m)
    }
  }

  const uniq = [...new Set(parts)]
  if (!uniq.length) return ''
  const peopleById = new Map(people.map((p) => [p.id, p.display_name]))
  return `Matched: ${uniq.map((p) => peopleById.get(p) ?? p).join(', ')}`
}

/** Chips for the resolved query: "dad = Rajesh Patel", "Passport", "2024 to 2025". */
export function resolvedChips(resolved = {}, { people = [], types } = {}) {
  const chips = []
  const byId = new Map(people.map((p) => [p.id, p.display_name]))
  const relation = Array.isArray(resolved?.relation_words) ? resolved.relation_words : []
  for (const r of relation) {
    const name = byId.get(r.person_id) ?? r.person_name ?? resolved?.person_names?.[0]
    if (r.word && name) chips.push({ kind: 'relation', label: `${r.word} = ${name}` })
  }
  const relationIds = new Set(relation.map((r) => r.person_id))
  ;(resolved?.person_ids ?? []).forEach((id, i) => {
    if (relationIds.has(id)) return
    const name = byId.get(id) ?? resolved?.person_names?.[i]
    if (name) chips.push({ kind: 'person', label: name })
  })
  if (resolved?.document_type) chips.push({ kind: 'type', label: typeLabel(resolved.document_type, types) })
  const dr = resolved?.date_range
  if (dr && (dr.from || dr.to)) {
    const f = dr.from ? String(dr.from).slice(0, 10) : ''
    const t = dr.to ? String(dr.to).slice(0, 10) : ''
    chips.push({ kind: 'date', label: f && t ? `${f} to ${t}` : f ? `after ${f}` : `before ${t}` })
  }
  return chips
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Splits `text` into [{ text, hit }] pieces so the UI can wrap hits in <mark>.
 * Terms come from `resolved.terms` and the raw query words (3+ letters).
 */
export function highlightParts(text, { query = '', resolved = {} } = {}) {
  const src = (text ?? '').toString()
  if (!src) return []
  const words = new Set()
  ;(resolved?.terms ?? []).forEach((t) => typeof t === 'string' && t.length >= 2 && words.add(t.toLowerCase()))
  query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3)
    .forEach((w) => words.add(w))
  if (!words.size) return [{ text: src, hit: false }]
  const re = new RegExp(`(${[...words].map(escapeRegExp).join('|')})`, 'giu')
  const parts = []
  let last = 0
  for (const m of src.matchAll(re)) {
    if (m.index > last) parts.push({ text: src.slice(last, m.index), hit: false })
    parts.push({ text: m[0], hit: true })
    last = m.index + m[0].length
  }
  if (last < src.length) parts.push({ text: src.slice(last), hit: false })
  return parts
}
