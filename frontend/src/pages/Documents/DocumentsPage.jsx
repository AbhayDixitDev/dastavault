import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowUpDown, FileText, LayoutGrid, List, ScanLine, Search, SlidersHorizontal, Trash2, Upload, X } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useGetDocumentsQuery, useLazyGetDocumentsQuery, useUpdateDocumentMutation } from '@/store/api/documentsApi'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ErrorBox, errorMessage } from '@/components/common/ErrorBox'
import { DocumentCard, DocumentCardSkeleton } from '@/components/documents/DocumentCard'
import { FilterSheet, EMPTY_FILTERS, countActiveFilters } from '@/components/documents/FilterSheet'
import { SORT_OPTIONS } from '@/components/documents/documentTypes'

const VIEW_KEY = 'dv.documentsView'
const PAGE_SIZE = 40

function readView() {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    return v === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

/** Reads the list filters from the URL so links like ?person_id=... work. */
function filtersFromParams(sp) {
  const f = { ...EMPTY_FILTERS }
  Object.keys(EMPTY_FILTERS).forEach((k) => {
    const v = sp.get(k)
    if (v) f[k] = k === 'favorite' ? v === '1' : v
  })
  return f
}

export function DocumentsPage() {
  const { workspaceId, can } = useWorkspace()
  const [searchParams, setSearchParams] = useSearchParams()
  const [view, setView] = useState(readView)
  const [q, setQ] = useState(searchParams.get('q') || '')
  const dq = useDebounced(q.trim())
  const [sort, setSort] = useState(searchParams.get('sort') ? `${searchParams.get('sort')}:${searchParams.get('order') || 'desc'}` : 'created_at:desc')
  const [filters, setFilters] = useState(() => filtersFromParams(searchParams))
  const [filterOpen, setFilterOpen] = useState(false)
  const [updateDocument] = useUpdateDocumentMutation()

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view) } catch { /* ignore */ }
  }, [view])

  // Keep the URL in step so the back button and shared links work.
  useEffect(() => {
    const next = new URLSearchParams()
    if (dq) next.set('q', dq)
    const [s, o] = sort.split(':')
    if (sort !== 'created_at:desc') { next.set('sort', s); next.set('order', o) }
    Object.entries(filters).forEach(([k, v]) => { if (v) next.set(k, v === true ? '1' : v) })
    setSearchParams(next, { replace: true })
  }, [dq, sort, filters, setSearchParams])

  const [sortKey, order] = sort.split(':')
  const baseArgs = useMemo(() => ({
    workspaceId,
    q: dq || undefined,
    sort: sortKey,
    order,
    limit: PAGE_SIZE,
    person_id: filters.person_id || undefined,
    group_id: filters.group_id || undefined,
    document_type: filters.document_type || undefined,
    tag: filters.tag || undefined,
    favorite: filters.favorite ? 1 : undefined,
    date_from: filters.date_from || undefined,
    date_to: filters.date_to || undefined,
  }), [workspaceId, dq, sortKey, order, filters])

  const { data, isLoading, isFetching, error, refetch } = useGetDocumentsQuery(baseArgs, { skip: !workspaceId })
  const [fetchMore, { isFetching: loadingMore }] = useLazyGetDocumentsQuery()
  const [extra, setExtra] = useState({ key: null, documents: [], cursor: null })

  const firstPage = useMemo(() => data?.documents ?? [], [data])
  const argsKey = JSON.stringify(baseArgs)
  const cursor = extra.key === argsKey ? extra.cursor : (data?.next_cursor ?? null)
  const documents = useMemo(() => {
    const more = extra.key === argsKey ? extra.documents : []
    const seen = new Set(firstPage.map((d) => d.id))
    return [...firstPage, ...more.filter((d) => !seen.has(d.id))]
  }, [firstPage, extra, argsKey])

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return
    try {
      const res = await fetchMore({ ...baseArgs, cursor }).unwrap()
      setExtra((prev) => ({
        key: argsKey,
        documents: [...(prev.key === argsKey ? prev.documents : []), ...res.documents],
        cursor: res.next_cursor,
      }))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }, [cursor, loadingMore, fetchMore, baseArgs, argsKey])

  // Infinite scroll sentinel.
  const sentinelRef = useRef(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !cursor || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore()
    }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [cursor, loadMore])

  const toggleFavourite = async (doc) => {
    try {
      await updateDocument({ workspaceId, documentId: doc.id, is_favorite: !doc.is_favorite }).unwrap()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const activeFilters = countActiveFilters(filters)
  const hasAnyQuery = !!dq || activeFilters > 0
  const canEdit = can('editor')
  const sortLabel = SORT_OPTIONS.find((s) => s.key === sort)?.label

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Documents"
        description="Everything you have saved, in one place."
        actions={canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link to="../scan" relative="path"><ScanLine /> Scan</Link></Button>
            <Button asChild><Link to="../upload" relative="path"><Upload /> Upload</Link></Button>
          </div>
        )}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find by name" className="h-10 pl-9 pr-9" aria-label="Find by name" />
          {q && (
            <button type="button" aria-label="Clear" onClick={() => setQ('')} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          )}
        </div>
        <Button variant="outline" size="lg" className="h-10" onClick={() => setFilterOpen(true)}>
          <SlidersHorizontal /> Filter
          {activeFilters > 0 && <Badge className="ml-1 size-5 justify-center rounded-full p-0">{activeFilters}</Badge>}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="lg" className="h-10"><ArrowUpDown /> <span className="hidden sm:inline">{sortLabel}</span><span className="sm:hidden">Sort</span></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
              {SORT_OPTIONS.map((s) => <DropdownMenuRadioItem key={s.key} value={s.key}>{s.label}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex overflow-hidden rounded-md border">
          <button type="button" aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')} className={`flex h-10 w-10 items-center justify-center ${view === 'grid' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'}`}><LayoutGrid className="size-4" /></button>
          <button type="button" aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')} className={`flex h-10 w-10 items-center justify-center border-l ${view === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'}`}><List className="size-4" /></button>
        </div>
      </div>

      {error && <ErrorBox error={error} onRetry={refetch} className="mb-4" />}

      {isLoading ? (
        <div className={view === 'grid' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4' : 'flex flex-col gap-2'}>
          {Array.from({ length: 8 }).map((_, i) => <DocumentCardSkeleton key={i} view={view} />)}
        </div>
      ) : documents.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={hasAnyQuery ? 'Nothing matches' : 'No documents yet'}
          description={hasAnyQuery ? 'Try different words or clear the filters.' : 'Scan a paper with your camera or upload a file to get started.'}
          action={
            hasAnyQuery ? (
              <Button variant="outline" onClick={() => { setQ(''); setFilters({ ...EMPTY_FILTERS }) }}>Clear search and filters</Button>
            ) : canEdit ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="lg" asChild><Link to="../scan" relative="path"><ScanLine /> Scan</Link></Button>
                <Button size="lg" variant="outline" asChild><Link to="../upload" relative="path"><Upload /> Upload</Link></Button>
              </div>
            ) : null
          }
        />
      ) : (
        <>
          <div className={view === 'grid' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4' : 'flex flex-col gap-2'}>
            {documents.map((doc) => (
              <DocumentCard key={doc.id} document={doc} workspaceId={workspaceId} view={view} onToggleFavourite={canEdit ? toggleFavourite : undefined} />
            ))}
          </div>
          <div ref={sentinelRef} className="flex justify-center py-6">
            {(loadingMore || (isFetching && !isLoading)) && <Spinner label="Loading more" />}
            {!loadingMore && cursor && <Button variant="ghost" onClick={loadMore}>Show more</Button>}
          </div>
        </>
      )}

      {canEdit && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link to="trash" className="inline-flex items-center gap-1 hover:text-foreground"><Trash2 className="size-4" /> Open the trash</Link>
        </p>
      )}

      <FilterSheet open={filterOpen} onOpenChange={setFilterOpen} value={filters} onApply={setFilters} />
    </div>
  )
}
