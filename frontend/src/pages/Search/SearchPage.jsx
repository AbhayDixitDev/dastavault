import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowRight, Bookmark, BookmarkPlus, Clock, Hash, ImageIcon, Search, Sparkles, Tag, User, X, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import {
  cleanFilters,
  useLazySearchQuery,
  useHybridSearchMutation,
  useSuggestQuery,
  useGetSavedSearchesQuery,
  useCreateSavedSearchMutation,
  useDeleteSavedSearchMutation,
} from '@/store/api/searchApi'
import { embedQuery } from '@/services/search/embedding'
import { voiceLangFor } from '@/services/search/voice'
import { addRecentSearch, clearRecentSearches, getRecentSearches, getSearchByMeaning, removeRecentSearch, setSearchByMeaning } from '@/services/search/recent'
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
  const [meaningOn, setMeaningOnState] = useState(getSearchByMeaning)
  const [recent, setRecent] = useState(() => getRecentSearches(workspaceId))
  const [results, setResults] = useState(null)
  const [meaningPending, setMeaningPending] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [saveOpen, setSaveOpen] = useState(false)
  const runIdRef = useRef(0)
  const inputRef = useRef(null)

  const [runSearch, { isFetching: fastLoading, error: searchError }] = useLazySearchQuery()
  const [runHybrid] = useHybridSearchMutation()
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
      setMeaningPending(false)
      return
    }
    const id = ++runIdRef.current
    const q = urlQ.trim()
    const filters = JSON.parse(filtersKey)
    const wantMeaning = meaningOn && Boolean(q)
    setMeaningPending(wantMeaning)
    const embeddingPromise = wantMeaning ? embedQuery(q, { timeoutMs: 4000 }) : Promise.resolve(null)

    ;(async () => {
      try {
        const fast = await runSearch({ workspaceId, q, ...filters, limit: 40 }).unwrap()
        if (runIdRef.current !== id) return
        setResults({ ...fast, source: 'fast' })
      } catch {
        if (runIdRef.current === id) setResults(null)
      }
      if (!wantMeaning) return
      const embedding = await embeddingPromise
      if (runIdRef.current !== id) return
      if (!embedding) {
        setMeaningPending(false)
        return
      }
      try {
        const hybrid = await runHybrid({ workspaceId, q, embedding, filters, limit: 40 }).unwrap()
        if (runIdRef.current !== id) return
        setResults({ ...hybrid, source: 'meaning' })
      } catch {
        /* keep the fast results */
      } finally {
        if (runIdRef.current === id) setMeaningPending(false)
      }
    })()
  }, [workspaceId, urlQ, filtersKey, meaningOn, hasQuery, nonce, runSearch, runHybrid])

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

  const toggleMeaning = () => {
    const on = !meaningOn
    setSearchByMeaning(on)
    setMeaningOnState(on)
  }

  const onFilters = (f) => submit(input, f)

  const clearAll = () => {
    setInput('')
    setResults(null)
    setSearchParams(tab === 'ask' ? { tab: 'ask' } : {})
    inputRef.current?.focus()
  }

  // Suggestion rows for the dropdown under the box.
  const suggestionRows = useMemo(() => {
    if (!suggest || !focused || suggestQ.length < 2 || input.trim() !== suggestQ) return []
    const rows = []
    ;(suggest.people ?? []).slice(0, 4).forEach((p) => rows.push({ key: `p-${p.id}`, icon: User, label: p.display_name, hint: terminology.person_label, run: () => submit('', { ...urlFilters, person_id: p.id }) }))
    ;(suggest.types ?? []).slice(0, 3).forEach((t) => {
      const key = typeof t === 'string' ? t : t?.key ?? t?.value
      if (!key) return
      rows.push({ key: `t-${key}`, icon: FileText, label: typeLabel(key, types), hint: 'Document type', run: () => submit('', { ...urlFilters, document_type: key }) })
    })
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
    return rows
  }, [suggest, focused, suggestQ, input, terminology.person_label, types, urlFilters, submit])

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
                    runIdRef.current++
                    setMeaningPending(false)
                    setResults({ ...res, source: 'image', fileName: file?.name })
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
                      <row.icon className="size-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{row.label}</span>
                      <span className="text-xs text-muted-foreground">{row.hint}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Filters and the meaning toggle */}
          <div className="flex flex-col gap-2">
            <FilterChips filters={urlFilters} onChange={onFilters} workspaceId={workspaceId} terminology={terminology} />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleMeaning}
                aria-pressed={meaningOn}
                className={cn('inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50', meaningOn ? 'border-primary/30 bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent')}
                title="Also finds documents that mean the same thing, even when the words differ."
              >
                <Sparkles className="size-3" /> Search by meaning: {meaningOn ? 'on' : 'off'}
              </button>
              {meaningPending && <span className="text-xs text-muted-foreground">Adding results by meaning...</span>}
            </div>
          </div>

          {searchError && <ErrorBox error={searchError} onRetry={() => setNonce((n) => n + 1)} />}

          {/* No query yet: recent and saved */}
          {!hasQuery && !results && (
            <div className="flex flex-col gap-5">
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
              {recent.length === 0 && saved.length === 0 && (
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
                <ul className={cn('flex flex-col gap-2', fastLoading && 'opacity-70')} aria-busy={fastLoading}>
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
