/**
 * person_id and document_type in a search can hold several values, joined by
 * commas: documents of any of them match (like picking faces in a photo app).
 */
export const listParam = (v) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

/** `value` with `item` added, or removed when it is there; undefined when empty. */
export function toggleParam(value, item) {
  const list = listParam(value)
  const next = list.includes(item) ? list.filter((x) => x !== item) : [...list, item].slice(-10)
  return next.length ? next.join(',') : undefined
}

export function addParam(value, item) {
  const list = listParam(value)
  return list.includes(item) ? list.join(',') : [...list, item].slice(-10).join(',')
}
