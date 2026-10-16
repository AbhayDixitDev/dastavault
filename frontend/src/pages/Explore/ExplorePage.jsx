import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Building2, CalendarClock, CalendarDays, Copy, ImageOff, Inbox, Search, Users } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { api } from '@/services/api/client'
import { pickThumbnailFile } from '@/services/files'
import { SignedImage } from '@/components/documents/SignedImage'
import { DocumentTypeIcon } from '@/components/documents/DocumentTypeIcon'
import { DocumentCard, DocumentCardSkeleton } from '@/components/documents/DocumentCard'
import { documentTypeInfo, documentTypeLabel } from '@/components/documents/documentTypes'
import { Skeleton } from '@/components/ui/skeleton'
import { initials } from '@/utils/format'
import { cn } from '@/lib/utils'

const PAGE = 100
const MAX_PAGES = 20 // up to 2000 documents are grouped on the device
const SIMILAR_MAX_DISTANCE = 10 // of 64 bits: photos of the same paper or card

/* ------------------------------------------------------------ data */

// Last list per workspace, shown at once on the next visit while a fresh one loads.
const memory = new Map()

function useAllDocuments(workspaceId) {
  const [state, setState] = useState(() => ({ docs: memory.get(workspaceId) ?? null, loading: !memory.has(workspaceId) }))

  useEffect(() => {
    let alive = true
    if (!workspaceId) return undefined
    setState({ docs: memory.get(workspaceId) ?? null, loading: !memory.has(workspaceId) })
    ;(async () => {
      const all = []
      let cursor = null
      try {
        for (let i = 0; i < MAX_PAGES; i++) {
          const params = new URLSearchParams({ limit: String(PAGE), sort: 'created_at', order: 'desc' })
          if (cursor) params.set('cursor', cursor)
          // eslint-disable-next-line no-await-in-loop
          const r = await api.get(`/workspaces/${workspaceId}/documents?${params}`)
          all.push(...(r?.documents ?? []))
          cursor = r?.next_cursor
          if (!alive) return
          // First page on screen right away when nothing is remembered yet.
          if (i === 0 && !memory.has(workspaceId)) setState({ docs: [...all], loading: Boolean(cursor) })
          if (!cursor) break
        }
        memory.set(workspaceId, all)
        if (alive) setState({ docs: all, loading: false })
      } catch {
        if (alive) setState((s) => ({ docs: s.docs ?? all, loading: false }))
      }
    })()
    return () => { alive = false }
  }, [workspaceId])

  return state
}

/* -------------------------------------------------------- grouping */

function hashBits(hex) {
  const h = String(hex || '').toLowerCase()
  if (!/^[0-9a-f]{16}$/.test(h)) return null
  return [parseInt(h.slice(0, 8), 16) >>> 0, parseInt(h.slice(8), 16) >>> 0]
}

function popcount(x) {
  let v = x >>> 0
  v -= (v >>> 1) & 0x55555555
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

/** Documents whose first pages look alike (perceptual hash), as groups of two or more. */
function similarGroups(docs) {
  const items = docs.map((d) => ({ d, bits: hashBits(d.perceptual_hash) })).filter((x) => x.bits)
  const parent = items.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < items.length; i++) {
    const [a0, a1] = items[i].bits
    for (let j = i + 1; j < items.length; j++) {
      const [b0, b1] = items[j].bits
      if (popcount(a0 ^ b0) + popcount(a1 ^ b1) <= SIMILAR_MAX_DISTANCE) parent[find(j)] = find(i)
    }
  }
  const byRoot = new Map()
  items.forEach((x, i) => {
    const r = find(i)
    if (!byRoot.has(r)) byRoot.set(r, [])
    byRoot.get(r).push(x.d)
  })
  return [...byRoot.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length)
}

function addTo(map, key, doc, extra) {
  if (!key) return
  if (!map.has(key)) map.set(key, { key, docs: [], ...extra })
  map.get(key).docs.push(doc)
}

const DAY = 24 * 60 * 60 * 1000

function buildCollections(docs) {
  const people = new Map()
  const types = new Map()
  const orgs = new Map()
  const years = new Map()
  const expiring = []
  const unsorted = []
  const now = Date.now()
  for (const d of docs) {
    for (const p of d.people || []) addTo(people, p.id, d, { label: p.display_name })
    addTo(types, d.document_type || 'other', d, { label: documentTypeLabel(d.document_type || 'other') })
    const org = String(d.organisation || '').trim()
    if (org) addTo(orgs, org.toLowerCase(), d, { label: org })
    const year = String(d.issue_date || d.created_at || '').slice(0, 4)
    if (/^\d{4}$/.test(year)) addTo(years, year, d, { label: year })
    if (d.expiry_date) {
      const t = Date.parse(d.expiry_date)
      if (!Number.isNaN(t) && t - now < 90 * DAY) expiring.push(d)
    }
    if (!(d.people || []).length && (!d.document_type || d.document_type === 'other' || d.document_type === 'photo')) unsorted.push(d)
  }
  const bySize = (a, b) => b.docs.length - a.docs.length || String(a.label).localeCompare(String(b.label))
  return {
    people: [...people.values()].sort(bySize),
    types: [...types.values()].sort(bySize),
    orgs: [...orgs.values()].filter((g) => g.docs.length > 1).sort(bySize),
    years: [...years.values()].sort((a, b) => b.key.localeCompare(a.key)),
    similar: similarGroups(docs).map((g, i) => ({ key: String(i), label: g[0].name, docs: g })),
    expiring: expiring.sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date))),
    unsorted,
  }
}

/* -------------------------------------------------------------- UI */

function Cover({ workspaceId, doc, className, round = false }) {
  const thumb = pickThumbnailFile(doc?.files)
  const info = documentTypeInfo(doc?.document_type)
  return (
    <SignedImage
      workspaceId={workspaceId}
      fileId={thumb?.id}
      className={cn('bg-muted', round ? 'rounded-full' : 'rounded-2xl', className)}
      imgClassName="size-full object-cover"
      fallback={(
        <div className={cn('flex size-full items-center justify-center', info.color)}>
          <DocumentTypeIcon type={doc?.document_type} size="lg" className="bg-transparent" />
        </div>
      )}
    />
  )
}

function Section({ title, icon: Icon, children, hint }) {
  return (
    <section className="mt-7">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          {Icon && <Icon className="size-5 text-primary" />} {title}
        </h2>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

function Row({ children }) {
  return <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0">{children}</div>
}

function Tile({ workspaceId, group, to, round = false }) {
  return (
    <Link to={to} className={cn('group shrink-0 snap-start', round ? 'w-20 text-center' : 'w-32')}>
      <div className="relative">
        {round ? (
          <Cover workspaceId={workspaceId} doc={group.docs[0]} round className="size-20 ring-2 ring-primary/20 transition group-hover:ring-primary" />
        ) : (
          <Cover workspaceId={workspaceId} doc={group.docs[0]} className="aspect-square w-32 transition group-hover:brightness-95" />
        )}
        {round && !pickThumbnailFile(group.docs[0]?.files) && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">{initials(group.label)}</span>
        )}
      </div>
      <p className={cn('mt-1.5 truncate text-sm font-medium', round && 'text-xs')}>{group.label}</p>
      <p className="text-xs text-muted-foreground">{group.docs.length}</p>
    </Link>
  )
}

function SimilarTile({ workspaceId, group, to }) {
  const [a, b, c] = group.docs
  return (
    <Link to={to} className="w-40 shrink-0 snap-start">
      <div className="grid aspect-square w-40 grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-2xl">
        <Cover workspaceId={workspaceId} doc={a} className="row-span-2 size-full rounded-none" />
        <Cover workspaceId={workspaceId} doc={b} className="size-full rounded-none" />
        {c ? <Cover workspaceId={workspaceId} doc={c} className="size-full rounded-none" /> : <div className="bg-muted" />}
      </div>
      <p className="mt-1.5 truncate text-sm font-medium">{group.label}</p>
      <p className="text-xs text-muted-foreground">{group.docs.length} look alike</p>
    </Link>
  )
}

function CollectionView({ workspaceId, title, docs, onBack }) {
  return (
    <div className="mx-auto max-w-6xl">
      <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Explore
      </button>
      <h1 className="font-display text-2xl font-semibold">{title}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{docs.length} {docs.length === 1 ? 'document' : 'documents'}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {docs.map((d) => <DocumentCard key={d.id} document={d} workspaceId={workspaceId} />)}
      </div>
    </div>
  )
}

/**
 * /w/:ws/explore
 * Documents grouped on the device, like the search page of a photo app:
 * people, kinds of documents, photos that look alike, organisations, years,
 * documents that expire soon and ones still to be sorted.
 */
export function ExplorePage() {
  const { workspaceId, terminology: t } = useWorkspace()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { docs, loading } = useAllDocuments(workspaceId)
  const c = useMemo(() => (docs ? buildCollections(docs) : null), [docs])
  const base = `/w/${workspaceId}`
  const open = searchParams.get('c') || ''
  const at = (kind, key) => `?c=${kind}:${encodeURIComponent(key)}`

  if (open && c) {
    const [kind, ...rest] = open.split(':')
    const key = decodeURIComponent(rest.join(':'))
    const list = { type: c.types, org: c.orgs, year: c.years, similar: c.similar }[kind]
    let view = list?.find((g) => g.key === key)
    if (kind === 'expiring') view = { label: 'Expiring soon', docs: c.expiring }
    if (kind === 'unsorted') view = { label: 'Not sorted yet', docs: c.unsorted }
    if (view) {
      const title = kind === 'similar' ? 'Look alike' : view.label
      return <CollectionView workspaceId={workspaceId} title={title} docs={view.docs} onBack={() => setSearchParams({})} />
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <button
        type="button"
        onClick={() => navigate(`${base}/search`)}
        className="flex w-full items-center gap-3 rounded-full border bg-card px-4 py-3 text-left text-muted-foreground shadow-soft transition hover:border-primary/50"
      >
        <Search className="size-5" />
        <span className="truncate">Search “passport”, a name, a bank…</span>
      </button>

      {!c && (
        <div className="mt-7 grid gap-6">
          <div className="flex gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="size-20 shrink-0 rounded-full" />)}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <DocumentCardSkeleton key={i} />)}</div>
        </div>
      )}

      {c && docs.length === 0 && (
        <div className="mt-16 flex flex-col items-center gap-2 text-center text-muted-foreground">
          <Inbox className="size-10" />
          <p className="font-medium text-foreground">Nothing to explore yet</p>
          <p className="max-w-xs text-sm">Add documents. They are grouped here by person, kind, and look automatically.</p>
          <Link to={`${base}/upload`} className="mt-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Add documents</Link>
        </div>
      )}

      {c && docs.length > 0 && (
        <>
          {c.people.length > 0 && (
            <Section title={t?.person_label_plural || 'People'} icon={Users} hint={<Link to={`${base}/people`} className="text-primary">See all</Link>}>
              <Row>
                {c.people.map((g) => <Tile key={g.key} workspaceId={workspaceId} group={g} round to={`${base}/people/${g.key}`} />)}
              </Row>
            </Section>
          )}

          <Section title="Kinds of documents" hint={`${c.types.length}`}>
            <Row>
              {c.types.map((g) => <Tile key={g.key} workspaceId={workspaceId} group={g} to={at('type', g.key)} />)}
            </Row>
          </Section>

          {(c.expiring.length > 0 || c.unsorted.length > 0) && (
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {c.expiring.length > 0 && (
                <Link to={at('expiring', 'all')} className="flex items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
                  <CalendarClock className="size-6 text-amber-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">Expiring soon</span>
                    <span className="block text-sm text-muted-foreground">{c.expiring.length} within 90 days or already expired</span>
                  </span>
                </Link>
              )}
              {c.unsorted.length > 0 && (
                <Link to={at('unsorted', 'all')} className="flex items-center gap-3 rounded-2xl border bg-card p-4">
                  <ImageOff className="size-6 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">Not sorted yet</span>
                    <span className="block text-sm text-muted-foreground">{c.unsorted.length} without a person or kind</span>
                  </span>
                </Link>
              )}
            </div>
          )}

          {c.similar.length > 0 && (
            <Section title="Look alike" icon={Copy} hint="Same card or paper, photographed again">
              <Row>
                {c.similar.map((g) => <SimilarTile key={g.key} workspaceId={workspaceId} group={g} to={at('similar', g.key)} />)}
              </Row>
            </Section>
          )}

          {c.orgs.length > 0 && (
            <Section title="Banks, companies, offices" icon={Building2}>
              <Row>
                {c.orgs.map((g) => <Tile key={g.key} workspaceId={workspaceId} group={g} to={at('org', g.key)} />)}
              </Row>
            </Section>
          )}

          {c.years.length > 0 && (
            <Section title="By year" icon={CalendarDays}>
              <Row>
                {c.years.map((g) => <Tile key={g.key} workspaceId={workspaceId} group={g} to={at('year', g.key)} />)}
              </Row>
            </Section>
          )}

          {loading && <p className="mt-6 text-center text-xs text-muted-foreground">Loading more documents…</p>}
        </>
      )}
    </div>
  )
}
