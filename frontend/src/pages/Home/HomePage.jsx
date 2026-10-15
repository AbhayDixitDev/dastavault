import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Search, ScanLine, Upload, PenLine, KeyRound, StickyNote, BellRing, Images, Sparkles, Mic, ImageIcon,
  FileText, CalendarClock, Star, ChevronRight, Plus, Users, FolderTree, Trash2, Activity,
} from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useAuth } from '@/hooks/useAuth'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import { useGetGroupsQuery } from '@/store/api/groupsApi'
import { useGetHomeQuery } from '@/store/api/homeApi'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { DocumentCard } from '@/components/documents/DocumentCard'
import { ExpiryChip } from '@/components/documents/ExpiryChip'
import { DocumentTypeIcon } from '@/components/documents/DocumentTypeIcon'
import { DOCUMENT_TYPES } from '@/components/documents/documentTypes'
import { ContinueScanBanner } from '@/components/scanner/ContinueScanBanner'
import { QuickAddSheet } from '@/components/layout/QuickAddSheet'
import { initials, displayNameOf } from '@/utils/format'
import { cn } from '@/lib/utils'

function greetingNow() {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

/** Quick actions, as round coloured icons like in a super app. */
const QUICK_ACTIONS = [
  { to: 'scan', label: 'Scan', icon: ScanLine, tone: 'from-indigo-500 to-violet-500' },
  { to: 'upload', label: 'Upload', icon: Upload, tone: 'from-sky-500 to-cyan-500' },
  { to: 'documents/new', label: 'Write', icon: PenLine, tone: 'from-violet-500 to-fuchsia-500' },
  { to: 'chaabi', label: 'Passwords', icon: KeyRound, tone: 'from-emerald-500 to-teal-500' },
  { to: 'notes', label: 'Notes', icon: StickyNote, tone: 'from-amber-500 to-orange-500' },
  { to: 'reminders', label: 'Reminders', icon: BellRing, tone: 'from-rose-500 to-pink-500' },
  { to: 'albums', label: 'Albums', icon: Images, tone: 'from-fuchsia-500 to-pink-500' },
  { to: 'search?tab=ask', label: 'Ask AI', icon: Sparkles, tone: 'from-blue-600 to-indigo-600' },
]

/** The document types shown as categories on the home screen. */
const CATEGORY_TYPES = ['aadhaar', 'pan', 'passport', 'driving_licence', 'marksheet', 'insurance', 'medical_report', 'bank_statement', 'property', 'vehicle', 'invoice', 'tax']

function SectionTitle({ title, to, icon: Icon }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="flex items-center gap-2 font-display text-base font-semibold">
        {Icon && <Icon className="size-4 text-primary" />} {title}
      </h2>
      {to && (
        <Link to={to} className="flex items-center text-xs font-semibold text-primary">
          See all <ChevronRight className="size-3.5" />
        </Link>
      )}
    </div>
  )
}

function Panel({ className, children }) {
  return <section className={cn('rounded-3xl border bg-card p-4 shadow-soft', className)}>{children}</section>
}

function DocRow({ doc, workspaceId, right }) {
  return (
    <Link to={`/w/${workspaceId}/documents/${doc.id}`} className="flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-accent">
      <DocumentTypeIcon type={doc.document_type} size="sm" className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{doc.name}</span>
        {doc.people?.length > 0 && <span className="block truncate text-xs text-muted-foreground">{doc.people.map((p) => p.display_name).join(', ')}</span>}
      </span>
      {right}
    </Link>
  )
}

function Stat({ value, label }) {
  return (
    <div className="flex-1 rounded-2xl bg-white/15 px-3 py-2 text-center backdrop-blur">
      <div className="font-display text-lg font-bold leading-tight">{value ?? '–'}</div>
      <div className="text-[11px] text-white/80">{label}</div>
    </div>
  )
}

export function HomePage() {
  const { workspace, workspaceId, terminology: t } = useWorkspace()
  const { user } = useAuth()
  const { data: people = [] } = useGetPeopleQuery(workspaceId)
  const { data: groups = [] } = useGetGroupsQuery(workspaceId)
  const { data: home, isLoading: homeLoading } = useGetHomeQuery(workspaceId)
  const [addOpen, setAddOpen] = useState(false)
  const firstName = displayNameOf(user).split(/\s+/)[0]

  const recent = home?.recent ?? []
  const expiring = home?.expiring ?? []
  const favorites = home?.favorites ?? []
  const [greeting] = useState(greetingNow)
  const categories = DOCUMENT_TYPES.filter((d) => CATEGORY_TYPES.includes(d.key))

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      {/* Hero: greeting, search and the numbers that matter */}
      <section className="relative overflow-hidden rounded-3xl bg-brand-gradient p-5 text-white shadow-lift">
        <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-16 -left-6 size-40 rounded-full bg-white/5" />
        <p className="text-sm text-white/80">{greeting}</p>
        <h1 className="font-display text-2xl font-bold">{firstName ? `Hello, ${firstName}` : 'Hello'}</h1>
        <p className="text-sm text-white/80">{workspace?.name}</p>

        <Link
          to="search"
          className="relative mt-4 flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm text-slate-500 shadow-md dark:bg-white/95"
        >
          <Search className="size-4 text-indigo-600" />
          <span className="flex-1 truncate">Search “dad passport”, “electricity bill”...</span>
          <Mic className="size-4 text-indigo-600" />
          <ImageIcon className="size-4 text-indigo-600" />
        </Link>

        <div className="relative mt-4 flex gap-2">
          <Stat value={home?.counts?.documents} label="Documents" />
          <Stat value={people.length} label={t.person_label_plural} />
          <Stat value={expiring.length} label="Expiring" />
        </div>
      </section>

      <ContinueScanBanner workspaceId={workspaceId} />

      {/* Quick actions */}
      <Panel>
        <div className="grid grid-cols-4 gap-y-4">
          {QUICK_ACTIONS.map((a) => {
            const Icon = a.icon
            return (
              <Link key={a.to} to={a.to} className="flex flex-col items-center gap-1.5 text-center transition active:scale-95">
                <span className={cn('flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-md', a.tone)}>
                  <Icon className="size-6" />
                </span>
                <span className="text-xs font-medium leading-tight">{a.label}</span>
              </Link>
            )
          })}
        </div>
      </Panel>

      {/* File it in the right place */}
      <button
        type="button"
        onClick={() => setAddOpen(true)}
        className="flex items-center gap-3 rounded-3xl border border-dashed border-primary/40 bg-primary/5 p-4 text-left transition hover:bg-primary/10"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Plus className="size-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Add a document</span>
          <span className="block text-xs text-muted-foreground">Pick whose it is and what it is. It is filed in the right place for you.</span>
        </span>
        <ChevronRight className="size-5 text-muted-foreground" />
      </button>
      <QuickAddSheet open={addOpen} onOpenChange={setAddOpen} />

      <div className="grid gap-4 md:grid-cols-2">
        {/* Categories */}
        <Panel className="md:col-span-2">
          <SectionTitle title="Browse by type" to="documents" />
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {categories.map((d) => {
              const Icon = d.icon
              return (
                <Link
                  key={d.key}
                  to={`documents?document_type=${d.key}`}
                  className="flex flex-col items-center gap-1.5 rounded-2xl p-2 text-center transition hover:bg-accent"
                >
                  <span className={cn('flex size-11 items-center justify-center rounded-xl', d.color)}>
                    <Icon className="size-5" />
                  </span>
                  <span className="text-[11px] leading-tight">{d.label}</span>
                </Link>
              )
            })}
          </div>
        </Panel>

        {/* People */}
        <Panel className="md:col-span-2">
          <SectionTitle title={t.person_label_plural} icon={Users} to="people" />
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
            {people.map((p) => (
              <Link key={p.id} to={`people/${p.id}`} className="flex w-16 shrink-0 flex-col items-center gap-1 text-center">
                <Avatar className="size-14 ring-2 ring-primary/20">
                  <AvatarFallback className="bg-primary/10 font-semibold text-primary">{initials(p.display_name)}</AvatarFallback>
                </Avatar>
                <span className="w-full truncate text-xs">{p.display_name}</span>
              </Link>
            ))}
            <Link to="people" className="flex w-16 shrink-0 flex-col items-center gap-1 text-center">
              <span className="flex size-14 items-center justify-center rounded-full border-2 border-dashed text-muted-foreground">
                <Plus className="size-5" />
              </span>
              <span className="w-full truncate text-xs text-muted-foreground">Add</span>
            </Link>
          </div>
        </Panel>

        {/* Expiring soon */}
        <Panel>
          <SectionTitle title="Expiring soon" icon={CalendarClock} to="reminders" />
          {homeLoading ? (
            <Skeleton className="h-16 rounded-2xl" />
          ) : expiring.length > 0 ? (
            <div className="flex flex-col">
              {expiring.slice(0, 5).map((d) => (
                <DocRow key={d.id} doc={d} workspaceId={workspaceId} right={<ExpiryChip date={d.expiry_date} />} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing expires soon. Add expiry dates to documents to get reminders.</p>
          )}
        </Panel>

        {/* Favourites */}
        <Panel>
          <SectionTitle title="Favourites" icon={Star} to="documents?favorite=1" />
          {homeLoading ? (
            <Skeleton className="h-16 rounded-2xl" />
          ) : favorites.length > 0 ? (
            <div className="flex flex-col">
              {favorites.slice(0, 5).map((d) => (
                <DocRow key={d.id} doc={d} workspaceId={workspaceId} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Tap the star on a document to keep it here.</p>
          )}
        </Panel>

        {/* Recent */}
        <Panel className="md:col-span-2">
          <SectionTitle title="Recent documents" icon={FileText} to="documents" />
          {homeLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
            </div>
          ) : recent.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {recent.slice(0, 8).map((d) => (
                <DocumentCard key={d.id} document={d} workspaceId={workspaceId} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Documents you scan or upload will show up here.</p>
          )}
        </Panel>

        {/* Organise */}
        <Panel className="md:col-span-2">
          <SectionTitle title="Organise" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { to: 'groups', label: t.group_label_plural, icon: FolderTree, count: groups.length },
              { to: 'albums', label: 'Albums', icon: Images, count: home?.counts?.albums },
              { to: 'documents/trash', label: 'Trash', icon: Trash2 },
              { to: 'activity', label: 'Activity', icon: Activity },
            ].map((item) => {
              const Icon = item.icon
              return (
                <Link key={item.to} to={item.to} className="flex items-center gap-2 rounded-2xl border p-3 text-sm transition hover:bg-accent">
                  <Icon className="size-5 text-primary" />
                  <span className="flex-1 truncate font-medium">{item.label}</span>
                  {item.count > 0 && <span className="text-xs text-muted-foreground">{item.count}</span>}
                </Link>
              )
            })}
          </div>
        </Panel>
      </div>
    </div>
  )
}
