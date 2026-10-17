import { DocumentCard } from './DocumentCard'
import { documentTypeLabel } from './documentTypes'

export const GROUP_BY_OPTIONS = [
  { key: 'none', label: 'No groups' },
  { key: 'type', label: 'By type' },
  { key: 'year', label: 'By year' },
  { key: 'person', label: 'By person' },
]

/** Year of a document: its issue date, else when it was added. */
export function documentYear(doc) {
  const y = String(doc.issue_date || doc.created_at || '').slice(0, 4)
  return /^\d{4}$/.test(y) ? y : 'Unknown'
}

function groupsOf(docs, by, nobody) {
  const map = new Map()
  const add = (key, label, doc) => {
    if (!map.has(key)) map.set(key, { key, label, docs: [] })
    map.get(key).docs.push(doc)
  }
  for (const doc of docs) {
    if (by === 'type') add(doc.document_type || 'other', documentTypeLabel(doc.document_type || 'other'), doc)
    else if (by === 'year') add(documentYear(doc), documentYear(doc), doc)
    else if (by === 'person') {
      const people = doc.people || []
      if (!people.length) add('', nobody, doc)
      for (const p of people) add(p.id, p.display_name, doc)
    }
  }
  const list = [...map.values()]
  if (by === 'year') return list.sort((a, b) => b.key.localeCompare(a.key))
  return list.sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : b.docs.length - a.docs.length || a.label.localeCompare(b.label)))
}

/** Documents in sections (by type, year or person), each with its count. */
export function GroupedDocuments({ docs, by = 'type', workspaceId, view = 'grid', onToggleFavourite, nobodyLabel = 'Nobody linked' }) {
  const grid = view === 'grid' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4' : 'flex flex-col gap-2'
  if (by === 'none') {
    return (
      <div className={grid}>
        {docs.map((d) => <DocumentCard key={d.id} document={d} workspaceId={workspaceId} view={view} onToggleFavourite={onToggleFavourite} />)}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-6">
      {groupsOf(docs, by, nobodyLabel).map((g) => (
        <section key={g.key || 'none'}>
          <h3 className="mb-2 flex items-baseline gap-2 font-display text-base font-semibold">
            {g.label} <span className="text-sm font-normal text-muted-foreground">{g.docs.length}</span>
          </h3>
          <div className={grid}>
            {g.docs.map((d) => <DocumentCard key={d.id} document={d} workspaceId={workspaceId} view={view} onToggleFavourite={onToggleFavourite} />)}
          </div>
        </section>
      ))}
    </div>
  )
}
