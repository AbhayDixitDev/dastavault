import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Bookmark, BookmarkPlus, Clock, Hash, ImageIcon, Search, Sparkles, Tag, User, X, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import {
  cleanFilters,
  useLazySearchQuery,
  useSuggestQuery,
  useGetSavedSearchesQuery,
  useCreateSavedSearchMutation,
  useDeleteSavedSearchMutation,
} from '@/store/api/searchApi'
import { voiceLangFor } from '@/services/search/voice'
import { addRecentSearch, clearRecentSearches, getRecentSearches, removeRecentSearch } from '@/services/search/recent'
import { resolvedChips } from '@/services/search/matched'
import { useDocumentTypes, typeLabel } from '@/services/search/documentTypes'
import { FilterChips } from '@/components/search/FilterSheet'
import { ResultCard } from '@/components/search/ResultCard'
import { VoiceSearchButton } from '@/components/search/VoiceSearchButton'
import { ImageSearchButton } from '@/components/search/ImageSearchButton'
import { AskPanel } from '@/components/search/AskPanel'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ErrorBox, errorMessage } from '@/components/common/ErrorBox'
import { cn } from '@/lib/utils'
import { allDocuments } from '@/services/documents/allDocuments'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { DocumentCard } from '@/components/documents/DocumentCard'
import { SearchExplore, TypeGrid, typeCounts } from '@/components/search/SearchExplore'
import { addParam, listParam, toggleParam } from '@/services/search/multi'

function useDebounced(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function SaveSearchDialog({ open, onOpenChange, workspaceId, query, filters }) {
  const [name, setName] = useState('')
  const [create, { isLoading }] = useCreateSavedSearchMutation()
  useEffect(() => {
    if (open) setName(query || '')
  }, [open, query])
  const save = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await create({ workspaceId, name: name.trim(), query: query || '', filters }).unwrap()
      toast.success('Search saved.')
      onOpenChange(false)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={save} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Save this search</DialogTitle>
            <DialogDescription>Give it a short name so you can run it again with one tap.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="saved-search-name">Name</Label>
            <Input id="saved-search-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Dad's passport" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isLoading}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function SearchPage() {
  const { workspaceId, workspace, terminology } = useWorkspace()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlQ = searchParams.get('q') ?? ''
  const urlFilters = useMemo(() => cleanFilters(Object.fromEntries(searchParams)), [searchParams])
  const filtersKey = JSON.stringify(urlFilters)
  const tab = searchParams.get('tab') === 'ask' ? 'ask' : 'search'
  const hasQuery = Boolean(urlQ.trim()) || Object.keys(urlFilters).length > 0

  const [input, setInput] = useState(urlQ)
  const [focused, setFocused] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [recent, setRecent] = useState(() => getRecentSearches(workspaceId))
  const [results, setResults] = useState(null)
  const [nonce, setNonce] = useState(0)
  const [saveOpen, setSaveOpen] = useState(false)
  const runIdRef = useRef(0)
  const inputRef = useRef(null)

  const [runSearch, { isFetching: fastLoading, error: searchError }] = useLazySearchQuery()
  const { data: people = [] } = useGetPeopleQuery(workspaceId, { skip: !workspaceId })

  const types = useDocumentTypes()
  const { data: saved = [] } = useGetSavedSearchesQuery(workspaceId, { skip: !workspaceId })
  const [deleteSaved] = useDeleteSavedSearchMutation()

  const debouncedInput = useDebounced(input, 300)
  const suggestQ = debouncedInput.trim()
  const { data: suggest } = useSuggestQuery({ workspaceId, q: suggestQ }, { skip: !workspaceId || suggestQ.length < 2 || suggestQ === urlQ.trim() })
  const { data: emptySuggest } = useSuggestQuery({ workspaceId, q: urlQ.trim() }, { skip: !workspaceId || !urlQ.trim() || !results || results.results.length > 0 })

  useEffect(() => {
    setInput(urlQ)
  }, [urlQ])

  useEffect(() => {
    setRecent(getRecentSearches(workspaceId))
  }, [workspaceId])

  // Run the search whenever the URL query or filters change.
  useEffect(() => {
    if (!workspaceId) return
    if (!hasQuery) {
      setResults(null)
      return
    }
    const id = ++runIdRef.current
    const q = urlQ.trim()
    const filters = JSON.parse(filtersKey)
    // One call: the server matches the words (full text, names, numbers) and the
    // meaning (vectors it makes itself), and puts the best of both first.
    ;(async () => {
      try {
        const res = await runSearch({ workspaceId, q, ...filters, limit: 40 }).unwrap()
        if (runIdRef.current === id) setResults({ ...res, source: 'search' })
      } catch {
        if (runIdRef.current === id) setResults(null)
      }
    })()
  }, [workspaceId, urlQ, filtersKey, hasQuery, nonce, runSearch])

  const submit = useCallback(
    (q = input, filters = urlFilters, extra = {}) => {
      const next = { ...cleanFilters(filters), ...extra }
      const s = (q ?? '').trim()
      if (s) next.q = s
      if (tab === 'ask' && !extra.tab) next.tab = 'ask'
      setSearchParams(next)
      if (s) setRecent(addRecentSearch(workspaceId, s))
      setFocused(false)
      setActiveIdx(-1)
      inputRef.current?.blur()
    },
    [input, urlFilters, tab, setSearchParams, workspaceId],
  )

  const setTab = (t) => {
    const next = Object.fromEntries(searchParams)
    if (t === 'ask') next.tab = 'ask'
    else delete next.tab
    setSearchParams(next)
  }

  const onFilters = (f) => submit(input, f)

  const clearAll = () => {
    setInput('')
    setResults(null)
    setSearchParams(tab === 'ask' ? { tab: 'ask' } : {})
    inputRef.current?.focus()
  }

  const pickedPeople = useMemo(() => listParam(urlFilters.person_id), [urlFilters.person_id])
  const pickedTypes = useMemo(() => listParam(urlFilters.document_type), [urlFilters.document_type])
  // A pick takes the place of what was typed to find it.
  const addPerson = useCallback(
    (id) => {
      setInput('')
      submit('', { ...urlFilters, person_id: addParam(urlFilters.person_id, id) })
    },
    [submit, urlFilters],
  )
  const addType = useCallback(
    (key) => {
      setInput('')
      submit('', { ...urlFilters, document_type: addParam(urlFilters.document_type, key) })
    },
    [submit, urlFilters],
  )
  const togglePerson = (id) => submit(urlQ, { ...urlFilters, person_id: toggleParam(urlFilters.person_id, id) })
  const toggleType = (key) => submit(urlQ, { ...urlFilters, document_type: toggleParam(urlFilters.document_type, key) })

  // Suggestion rows under the box. People and types match on the phone as you type
  // (no waiting); a tap adds them to the search, so several can be picked.
  const suggestionRows = useMemo(() => {
    const typed = input.trim().toLowerCase()
    if (!focused || typed.length < 1) return []
    const rows = []
    people
      .filter((p) => {
        if (pickedPeople.includes(p.id)) return false
        const name = (p.display_name || '').toLowerCase()
        return name.split(/\s+/).some((w) => w.startsWith(typed)) || (typed.length > 1 && name.includes(typed))
      })
      .slice(0, 5)
      .forEach((p) => rows.push({ key: `p-${p.id}`, person: p, label: p.display_name, hint: terminology.person_label, run: () => addPerson(p.id) }))
    types
      .filter((t) => !pickedTypes.includes(t.key) && (typed.length > 1 ? (t.label || '').toLowerCase().includes(typed) || t.key.includes(typed.replace(/\s+/g, '_')) : (t.label || '').toLowerCase().startsWith(typed)))
      .slice(0, 4)
      .forEach((t) => rows.push({ key: `t-${t.key}`, icon: FileText, label: t.label, hint: 'Document type', run: () => addType(t.key) }))
    if (suggest && suggestQ.length >= 2 && input.trim() === suggestQ) {
      ;(suggest.tags ?? []).slice(0, 3).forEach((t) => {
        const name = typeof t === 'string' ? t : t?.name
        if (!name) return
        rows.push({ key: `g-${name}`, icon: Tag, label: `#${name}`, hint: 'Tag', run: () => submit('', { ...urlFilters, tag: name }) })
      })
      ;(suggest.recent ?? []).slice(0, 3).forEach((r) => {
        const q = typeof r === 'string' ? r : r?.query ?? r?.q
        if (!q) return
        rows.push({ key: `r-${q}`, icon: Clock, label: q, hint: 'Recent', run: () => submit(q) })
      })
    }
    return rows
  }, [suggest, focused, suggestQ, input, people, types, pickedPeople, pickedTypes, terminology.person_label, urlFilters, submit, addPerson, addType])

  const onKeyDown = (e) => {
    if (!suggestionRows.length) {
      if (e.key === 'Escape') setFocused(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => (i + 1) % suggestionRows.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => (i <= 0 ? suggestionRows.length - 1 : i - 1))
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      suggestionRows[activeIdx].run()
    } else if (e.key === 'Escape') {
      setFocused(false)
      setActiveIdx(-1)
    }
  }

  const chips = results ? resolvedChips(results.resolved, { people, types }) : []
  // The kinds of documents the picked people have; kept while a type narrows the list.
  const kindsRef = useRef({ key: '', kinds: [] })
  const personKinds = useMemo(() => {
    const key = `${urlQ}|${urlFilters.person_id || ''}`
    if (results?.source === 'search' && !urlFilters.document_type) {
      kindsRef.current = { key, kinds: typeCounts((results.results || []).filter((r) => r.kind !== 'note').map((r) => r.document)) }
    }
    return kindsRef.current.key === key ? kindsRef.current.kinds : []
  }, [results, urlQ, urlFilters.person_id, urlFilters.document_type])
  const showSuggestions = suggestionRows.length > 0
  const list = results?.results ?? []
  const emptyIdeas = useMemo(() => {
    const ideas = []
    ;(emptySuggest?.people ?? []).slice(0, 3).forEach((p) => ideas.push({ label: p.display_name, run: () => submit('', { person_id: p.id }) }))
    ;(emptySuggest?.types ?? []).slice(0, 3).forEach((t) => {
      const key = typeof t === 'string' ? t : t?.key ?? t?.value
      if (key) ideas.push({ label: typeLabel(key, types), run: () => submit('', { document_type: key }) })
    })
    ;(emptySuggest?.tags ?? []).slice(0, 2).forEach((t) => {
      const name = typeof t === 'string' ? t : t?.name
      if (name) ideas.push({ label: `#${name}`, run: () => submit('', { tag: name }) })
    })
    const words = urlQ.trim().split(/\s+/).filter((w) => w.length > 2)
    if (words.length > 1) ideas.push({ label: `Just "${words[0]}"`, run: () => submit(words[0], {}) })
    if (Object.keys(urlFilters).length) ideas.push({ label: 'Remove filters', run: () => submit(urlQ, {}) })
    return ideas
  }, [emptySuggest, urlQ, urlFilters, types, submit])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="search">
              <Search /> Search
            </TabsTrigger>
            <TabsTrigger value="ask">
              <Sparkles /> Ask
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tab === 'ask' ? (
        <AskPanel workspaceId={workspaceId} />
      ) : (
        <>
          {/* Search box */}
          <div className="relative">
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
              className="relative"
            >
              <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                ref={inputRef}
                type="search"
                name="q"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  setActiveIdx(-1)
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => setTimeout(() => setFocused(false), 150)}
                onKeyDown={onKeyDown}
                placeholder="Search your documents"
                aria-label="Search your documents"
                aria-autocomplete="list"
                aria-expanded={showSuggestions}
                autoComplete="off"
                enterKeyHint="search"
                className="h-14 w-full rounded-2xl border bg-card pl-12 pr-36 text-base shadow-soft outline-none transition-[box-shadow] focus:ring-2 focus:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
              />
              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                {input && (
                  <Button type="button" variant="ghost" size="icon" className="size-9" aria-label="Clear" onClick={clearAll}>
                    <X className="size-4" />
                  </Button>
                )}
                <VoiceSearchButton
                  lang={voiceLangFor(workspace)}
                  onResult={(text) => {
                    setInput(text)
                    submit(text)
                  }}
                  className="[&>button]:size-9"
                />
                <ImageSearchButton
                  workspaceId={workspaceId}
                  className="[&_button]:size-9"
                  onResults={(res, file) => {
                    const runId = ++runIdRef.current
                    setResults({ ...res, source: 'image', fileName: file?.name, faces: null })
                    // A photo of someone: who it is, and the documents with their face.
                    Promise.all([import('@/services/faces'), allDocuments(workspaceId).catch(() => [])])
                      .then(([{ searchFaces }, docs]) => searchFaces(file, { people, docs }))
                      .then((faces) => {
                        if (runIdRef.current === runId) setResults((r) => (r?.source === 'image' ? { ...r, faces } : r))
                      })
                      .catch(() => {})
                  }}
                />
                <Button type="submit" size="icon" className="size-9 rounded-xl" aria-label="Search">
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </form>

            {showSuggestions && (
              <ul role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border bg-popover p-1 shadow-lift">
                {suggestionRows.map((row, i) => (
                  <li key={row.key} role="option" aria-selected={i === activeIdx}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={row.run}
                      className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent', i === activeIdx && 'bg-accent')}
                    >
                      {row.person ? <PersonAvatar person={row.person} className="size-7" /> : <row.icon className="size-4 text-muted-foreground" />}
                      <span className="min-w-0 flex-1 truncate">{row.label}</span>
                      <span className="text-xs text-muted-foreground">{row.hint}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* What is picked: tap x to take one out. */}
          {(pickedPeople.length > 0 || pickedTypes.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {pickedPeople.map((id) => {
                const p = people.find((x) => x.id === id)
                return (
                  <button key={id} type="button" onClick={() => togglePerson(id)} aria-label={`Remove ${p?.display_name ?? 'person'}`} className="inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 pl-1 pr-2.5 text-sm text-primary">
                    <PersonAvatar person={p} className="size-7" />
                    <span className="truncate">{p?.display_name ?? terminology.person_label}</span>
                    <X className="size-3.5 shrink-0" />
                  </button>
                )
              })}
              {pickedTypes.map((key) => (
                <button key={key} type="button" onClick={() => toggleType(key)} aria-label={`Remove ${typeLabel(key, types)}`} className="inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 text-sm text-primary">
                  <FileText className="size-3.5 shrink-0" />
                  <span className="truncate">{typeLabel(key, types)}</span>
                  <X className="size-3.5 shrink-0" />
                </button>
              ))}
            </div>
          )}

          {/* More people to add with a tap (several can be picked). */}
          {hasQuery && results?.source !== 'image' && people.some((p) => !pickedPeople.includes(p.id)) && (
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 scroll-inside" aria-label={`Add ${terminology?.person_label_plural || 'people'}`}>
              {people
                .filter((p) => !pickedPeople.includes(p.id))
                .map((p) => (
                  <button key={p.id} type="button" onClick={() => addPerson(p.id)} className="flex w-14 shrink-0 flex-col items-center gap-1 text-center">
                    <PersonAvatar person={p} className="size-12 border" />
                    <span className="w-full truncate text-[11px]">{p.display_name}</span>
                  </button>
                ))}
            </div>
          )}

          {/* Filters: once something is searched; before that, the people and types below. */}
          {hasQuery && (
            <div className="flex flex-col gap-2">
              {/* People and types picked show above; a pick here adds to them. */}
              <FilterChips
                filters={{ ...urlFilters, person_id: undefined, document_type: undefined }}
                onChange={(f) =>
                  Object.keys(cleanFilters(f)).length === 0 ? onFilters({}) : onFilters({
                    ...f,
                    person_id: f.person_id ? addParam(urlFilters.person_id, f.person_id) : urlFilters.person_id,
                    document_type: f.document_type ? addParam(urlFilters.document_type, f.document_type) : urlFilters.document_type,
                  })
                }
                workspaceId={workspaceId}
                terminology={terminology}
              />
            </div>
          )}

          {searchError && <ErrorBox error={searchError} onRetry={() => setNonce((n) => n + 1)} />}

          {/* No query yet: recent and saved */}
          {!hasQuery && !results && (
            <div className="flex flex-col gap-5">
              <SearchExplore
                workspaceId={workspaceId}
                terminology={terminology}
                types={types}
                onPerson={(p) => submit('', { person_id: p.id })}
                onType={(key) => submit('', { document_type: key })}
              />
              {recent.length > 0 && (
                <section className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-medium text-muted-foreground">Recent</h2>
                    <Button variant="ghost" size="sm" onClick={() => setRecent(clearRecentSearches(workspaceId))}>
                      Clear
                    </Button>
                  </div>
                  <ul className="flex flex-wrap gap-2">
                    {recent.map((r) => (
                      <li key={r} className="inline-flex items-stretch">
                        <button type="button" onClick={() => submit(r)} className="inline-flex h-9 items-center gap-1.5 rounded-l-full border bg-card pl-3 pr-2 text-sm hover:bg-accent">
                          <Clock className="size-3.5 text-muted-foreground" /> {r}
                        </button>
                        <button type="button" aria-label={`Remove ${r}`} onClick={() => setRecent(removeRecentSearch(workspaceId, r))} className="inline-flex h-9 items-center rounded-r-full border border-l-0 bg-card px-2 text-muted-foreground hover:bg-accent">
                          <X className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {saved.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium text-muted-foreground">Saved searches</h2>
                  <ul className="flex flex-col gap-1">
                    {saved.map((s) => (
                      <li key={s.id} className="flex items-center gap-2 rounded-xl border bg-card pl-3 pr-1">
                        <button type="button" onClick={() => setSearchParams({ ...(s.filters ?? {}), ...(s.query ? { q: s.query } : {}) })} className="flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left text-sm">
                          <Bookmark className="size-4 shrink-0 text-primary" />
                          <span className="truncate font-medium">{s.name}</span>
                          {s.query && <span className="truncate text-xs text-muted-foreground">{s.query}</span>}
                        </button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${s.name}`} onClick={() => deleteSaved({ workspaceId, id: s.id })}>
                          <X className="size-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {recent.length === 0 && saved.length === 0 && people.length === 0 && (
                <EmptyState icon={Search} title="Find anything in seconds" description={`Try a name, a document type or a year. Say "dad's passport" or "insurance 2025".`} />
              )}
            </div>
          )}

          {/* Results */}
          {hasQuery && !results && fastLoading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-2xl" />
              ))}
            </div>
          )}

          {results?.source === 'image' && results.faces && (results.faces.people.length > 0 || results.faces.docs.length > 0) && (
            <div className="mb-4 rounded-2xl border bg-card p-4">
              {results.faces.people.map(({ person }) => (
                <Link key={person.id} to={`/w/${workspaceId}/people/${person.id}`} className="mb-3 flex items-center gap-3">
                  <PersonAvatar person={person} className="size-12" />
                  <span>
                    <span className="block text-xs text-muted-foreground">This looks like</span>
                    <span className="block font-semibold">{person.display_name}</span>
                  </span>
                </Link>
              ))}
              {results.faces.docs.length > 0 && (
                <>
                  <p className="mb-2 text-sm font-medium">Documents with this face</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {results.faces.docs.slice(0, 12).map((d) => <DocumentCard key={d.id} document={d} workspaceId={workspaceId} />)}
                  </div>
                </>
              )}
            </div>
          )}

          {results && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {results.source === 'image' ? (
                  <Badge variant="secondary" className="gap-1">
                    <ImageIcon className="size-3" /> Similar to your photo{results.fileName ? `: ${results.fileName}` : ''}
                    <button type="button" aria-label="Back to text search" onClick={() => setNonce((n) => n + 1)} className="ml-1 rounded-full hover:bg-foreground/10">
                      <X className="size-3" />
                    </button>
                  </Badge>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {list.length === 0 ? 'No results' : `${list.length} result${list.length === 1 ? '' : 's'}`}
                    {urlQ ? ` for "${urlQ}"` : ''}
                  </p>
                )}
                {chips.length > 0 && (
                  <span className="flex flex-wrap items-center gap-1">
                    <span className="text-xs text-muted-foreground">Understood:</span>
                    {chips.map((c) => (
                      <Badge key={`${c.kind}-${c.label}`} variant={c.kind === 'relation' ? 'default' : 'secondary'} className="gap-1">
                        {c.kind === 'relation' || c.kind === 'person' ? <User className="size-3" /> : c.kind === 'type' ? <FileText className="size-3" /> : <Hash className="size-3" />}
                        {c.label}
                      </Badge>
                    ))}
                  </span>
                )}
                {results.source !== 'image' && (
                  <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSaveOpen(true)}>
                    <BookmarkPlus /> Save
                  </Button>
                )}
              </div>

              {/* A typo: what it may have meant is searched too. */}
              {results.source !== 'image' && results.resolved?.did_you_mean?.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Also showing results for{' '}
                  {results.resolved.did_you_mean.map((q, i) => (
                    <span key={q}>
                      {i > 0 && ', '}
                      <button type="button" onClick={() => submit(q)} className="font-semibold text-primary underline-offset-2 hover:underline">
                        {q}
                      </button>
                    </span>
                  ))}
                </p>
              )}

              {/* Someone picked: their kinds of documents, to narrow down (like a photo app). */}
              {results.source !== 'image' && pickedPeople.length > 0 && personKinds.length > 1 && (
                <TypeGrid compact kinds={personKinds} types={types} selected={pickedTypes} onType={toggleType} />
              )}

              {list.length === 0 ? (
                <EmptyState icon={Search} title="Nothing found. Try fewer words." description={results.source === 'image' ? 'No document looks like this photo yet.' : 'Check the spelling, or try a name or a document type on its own.'}>
                  {emptyIdeas.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-2">
                      {emptyIdeas.map((i) => (
                        <button key={i.label} type="button" onClick={i.run} className="rounded-full border bg-background px-3 py-1.5 text-sm hover:bg-accent">
                          {i.label}
                        </button>
                      ))}
                    </div>
                  )}
                </EmptyState>
              ) : (
                <ul className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3', fastLoading && 'opacity-70')} aria-busy={fastLoading}>
                  {list.map((r) => (
                    <li key={`${r.document?.id}-${r.kind ?? 'doc'}`}>
                      <ResultCard result={r} workspaceId={workspaceId} query={urlQ} resolved={results.resolved} people={people} types={types} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <SaveSearchDialog open={saveOpen} onOpenChange={setSaveOpen} workspaceId={workspaceId} query={urlQ} filters={urlFilters} />
        </>
      )}
    </div>
  )
}
