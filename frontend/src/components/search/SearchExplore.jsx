import { useMemo } from 'react'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import { useGetDocumentsQuery } from '@/store/api/documentsApi'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { DocumentTypeIcon } from '@/components/documents/DocumentTypeIcon'
import { documentTypeInfo } from '@/components/documents/documentTypes'
import { typeLabel } from '@/services/search/documentTypes'
import { cn } from '@/lib/utils'

/** Document types of `docs`, most first: [{ key, count }]. */
export function typeCounts(docs) {
  const counts = new Map()
  for (const d of docs || []) {
    const key = d?.document_type || 'other'
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)
}

/**
 * What the search page shows before anything is typed, like a photo app:
 * the people, then the kinds of documents. A tap searches for them.
 */
export function SearchExplore({ workspaceId, terminology, types, onPerson, onType }) {
  const { data: people = [] } = useGetPeopleQuery(workspaceId, { skip: !workspaceId })
  const { data } = useGetDocumentsQuery({ workspaceId, limit: 200, sort: 'created_at', order: 'desc' }, { skip: !workspaceId })
  const kinds = useMemo(() => typeCounts(data?.documents), [data])

  return (
    <div className="flex flex-col gap-6">
      {people.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">{terminology?.person_label_plural || 'People'}</h2>
          <div className="grid grid-cols-4 gap-x-3 gap-y-4 sm:grid-cols-6 lg:grid-cols-8">
            {people.map((p) => (
              <button key={p.id} type="button" onClick={() => onPerson(p)} className="flex min-w-0 flex-col items-center gap-1.5 text-center">
                <PersonAvatar person={p} className="size-16 border" />
                <span className="w-full truncate text-xs">{p.display_name}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {kinds.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Types</h2>
          <TypeGrid kinds={kinds} types={types} onType={onType} />
        </section>
      )}
    </div>
  )
}

/** Tiles of document types with how many there are; `compact` chips toggle (several can be picked). */
export function TypeGrid({ kinds, types, onType, compact = false, selected = [] }) {
  if (compact) {
    return (
      <div className="flex flex-wrap gap-2">
        {kinds.map(({ key, count }) => (
          <button
            key={key}
            type="button"
            aria-pressed={selected.includes(key)}
            onClick={() => onType(key)}
            className={cn('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm', selected.includes(key) ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-card hover:bg-accent')}
          >
            {typeLabel(key, types)} <span className="text-xs text-muted-foreground">{count}</span>
          </button>
        ))}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      {kinds.map(({ key, count }) => (
        <button key={key} type="button" onClick={() => onType(key)} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card text-left hover:bg-accent">
          <span className={cn('flex aspect-[4/3] items-center justify-center', documentTypeInfo(key).color)}>
            <DocumentTypeIcon type={key} size="lg" className="bg-transparent" />
          </span>
          <span className="truncate px-2 pt-1.5 text-xs font-medium">{typeLabel(key, types)}</span>
          <span className="px-2 pb-1.5 text-[11px] text-muted-foreground">{count}</span>
        </button>
      ))}
    </div>
  )
}
