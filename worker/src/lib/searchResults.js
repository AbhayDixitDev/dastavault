import { unwrap } from './errors.js'

/**
 * Search result helpers: enrichment (thumbnail, people, tags) done with three
 * batched queries, and Reciprocal Rank Fusion.
 */

/** Adds thumbnail_file_id, people [{id, display_name}], tags [{id, name, color}] to each document. */
export async function enrichDocuments(db, wsId, docs) {
  if (!docs.length) return docs
  const ids = docs.map((d) => d.id)
  const [thumbs, people, tags] = await Promise.all([
    db.from('document_files').select('id, document_id, version_id, page_number').eq('workspace_id', wsId).eq('kind', 'thumbnail').in('document_id', ids).order('page_number', { ascending: true, nullsFirst: false }),
    db.from('document_people').select('document_id, person:people!person_id(id, display_name)').eq('workspace_id', wsId).in('document_id', ids),
    db.from('document_tags').select('document_id, tag:tags!tag_id(id, name, color)').eq('workspace_id', wsId).in('document_id', ids),
  ])
  const thumbRows = unwrap(thumbs, 'Load thumbnails')
  const peopleRows = unwrap(people, 'Load document people')
  const tagRows = unwrap(tags, 'Load document tags')

  const byDoc = new Map(docs.map((d) => [d.id, d]))
  for (const d of docs) {
    d.thumbnail_file_id = null
    d.people = []
    d.tags = []
  }
  // prefer the current version's page-1 thumbnail, else any thumbnail
  for (const t of thumbRows) {
    const d = byDoc.get(t.document_id)
    if (!d) continue
    const isCurrent = t.version_id === d.current_version_id
    if (!d.thumbnail_file_id || (isCurrent && !d._thumbCurrent)) {
      d.thumbnail_file_id = t.id
      d._thumbCurrent = isCurrent
    }
  }
  for (const d of docs) delete d._thumbCurrent
  for (const r of peopleRows) if (r.person) byDoc.get(r.document_id)?.people.push({ id: r.person.id, display_name: r.person.display_name })
  for (const r of tagRows) if (r.tag) byDoc.get(r.document_id)?.tags.push({ id: r.tag.id, name: r.tag.name, color: r.tag.color })
  return docs
}

/**
 * Reciprocal Rank Fusion. `lists` = [[id, id, ...], ...] ordered best-first.
 * Returns Map<id, score> sorted descending.
 */
export function rrfFuse(lists, k = 60) {
  const scores = new Map()
  for (const list of lists) {
    list.forEach((id, i) => {
      scores.set(id, (scores.get(id) || 0) + 1 / (k + i + 1))
    })
  }
  return new Map([...scores.entries()].sort((a, b) => b[1] - a[1]))
}

export function snippetOf(text, terms = [], max = 200) {
  if (!text) return null
  const clean = String(text).replace(/\s+/g, ' ').trim()
  if (!clean) return null
  const lower = clean.toLowerCase()
  let idx = -1
  for (const t of terms) {
    const i = lower.indexOf(String(t).toLowerCase())
    if (i >= 0 && (idx < 0 || i < idx)) idx = i
  }
  const start = idx < 0 ? 0 : Math.max(0, idx - 60)
  const out = clean.slice(start, start + max)
  return (start > 0 ? '...' : '') + out + (start + max < clean.length ? '...' : '')
}
