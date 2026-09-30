import { Link } from 'react-router-dom'
import { Search, ScanLine, Upload, Users, FolderTree, Images, Star, CalendarClock, FileText, Mic, ImageIcon, StickyNote, KeyRound, PenLine } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useAuth } from '@/hooks/useAuth'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import { useGetGroupsQuery } from '@/store/api/groupsApi'
import { useGetHomeQuery } from '@/store/api/homeApi'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { DocumentCard } from '@/components/documents/DocumentCard'
import { ExpiryChip } from '@/components/documents/ExpiryChip'
import { DocumentTypeIcon } from '@/components/documents/DocumentTypeIcon'
import { ContinueScanBanner } from '@/components/scanner/ContinueScanBanner'
import { initials, displayNameOf } from '@/utils/format'
import { useIsDesktop } from '@/hooks/useMediaQuery'

function Tile({ to, icon: Icon, label, primary }) {
  return (
    <Link
      to={to}
      className={
        primary
          ? 'flex flex-col items-center justify-center gap-2 rounded-2xl bg-brand-gradient p-5 text-white shadow-lift transition-transform active:scale-[0.98]'
          : 'flex flex-col items-center justify-center gap-2 rounded-2xl border bg-card p-5 shadow-soft transition-colors hover:bg-accent'
      }
    >
      <Icon className="size-7" />
      <span className="text-sm font-medium">{label}</span>
    </Link>
  )
}

function Section({ title, icon: Icon, to, children, empty, loading }) {
  return (
    <Card className="shadow-soft">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {Icon && <Icon className="size-4 text-primary" />} {title}
        </CardTitle>
        {to && (
          <Button asChild variant="ghost" size="sm">
            <Link to={to}>See all</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-16 rounded-xl" /> : children ?? <p className="text-sm text-muted-foreground">{empty}</p>}
      </CardContent>
    </Card>
  )
}

function DocRow({ doc, workspaceId, right }) {
  return (
    <Link to={`/w/${workspaceId}/documents/${doc.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-accent">
      <DocumentTypeIcon type={doc.document_type} size="sm" className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{doc.name}</span>
        {doc.people?.length > 0 && <span className="block truncate text-xs text-muted-foreground">{doc.people.map((p) => p.display_name).join(', ')}</span>}
      </span>
      {right}
    </Link>
  )
}

export function HomePage() {
  const { workspace, workspaceId, terminology: t } = useWorkspace()
  const { user } = useAuth()
  const isDesktop = useIsDesktop()
  const { data: people = [] } = useGetPeopleQuery(workspaceId)
  const { data: groups = [] } = useGetGroupsQuery(workspaceId)
  const { data: home, isLoading: homeLoading } = useGetHomeQuery(workspaceId)
  const firstName = displayNameOf(user).split(/\s+/)[0]

  const recent = home?.recent ?? []
  const expiring = home?.expiring ?? []
  const favorites = home?.favorites ?? []

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-bold">Hello{firstName ? `, ${firstName}` : ''}</h1>
        <p className="text-sm text-muted-foreground">{workspace?.name}</p>
      </div>

      <ContinueScanBanner workspaceId={workspaceId} />

      {!isDesktop && (
        <Link to="search" className="flex items-center gap-2 rounded-full border bg-card px-4 py-3 text-sm text-muted-foreground shadow-soft">
          <Search className="size-4" />
          <span className="flex-1">Search your documents</span>
          <Mic className="size-4" />
          <ImageIcon className="size-4" />
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile to="scan" icon={ScanLine} label="Scan Document" primary />
        <Tile to="upload" icon={Upload} label="Upload File" />
        <Tile to="documents/new" icon={PenLine} label="Write" />
        <Tile to="chaabi" icon={KeyRound} label="Chaabi" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Recent documents" icon={FileText} to="documents" loading={homeLoading} empty="Documents you scan or upload will show up here.">
          {recent.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {recent.slice(0, 6).map((d) => (
                <DocumentCard key={d.id} document={d} workspaceId={workspaceId} />
              ))}
            </div>
          )}
        </Section>

        <Section title="Expiring soon" icon={CalendarClock} to="reminders" loading={homeLoading} empty="Nothing is expiring soon. Add expiry dates to documents to get reminders.">
          {expiring.length > 0 && (
            <div className="flex flex-col">
              {expiring.slice(0, 6).map((d) => (
                <DocRow key={d.id} doc={d} workspaceId={workspaceId} right={<ExpiryChip date={d.expiry_date} />} />
              ))}
            </div>
          )}
        </Section>

        <Section title={t.person_label_plural} icon={Users} to="people" empty={`Add ${t.person_label_plural.toLowerCase()} so documents can belong to them.`}>
          {people.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {people.slice(0, 8).map((p) => (
                <Link key={p.id} to={`people/${p.id}`} className="flex w-16 flex-col items-center gap-1 text-center">
                  <Avatar className="size-12">
                    <AvatarFallback>{initials(p.display_name)}</AvatarFallback>
                  </Avatar>
                  <span className="w-full truncate text-xs">{p.display_name}</span>
                </Link>
              ))}
            </div>
          )}
        </Section>

        <Section title={t.group_label_plural} icon={FolderTree} to="groups" empty={`No ${t.group_label_plural.toLowerCase()} yet.`}>
          {groups.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {groups.slice(0, 8).map((g) => (
                <Link key={g.id} to={`groups/${g.id}`} className="rounded-full border px-3 py-1 text-sm hover:bg-accent">
                  {g.name}
                </Link>
              ))}
            </div>
          )}
        </Section>

        <Section title="Favourites" icon={Star} loading={homeLoading} empty="Star a document to see it here.">
          {favorites.length > 0 && (
            <div className="flex flex-col">
              {favorites.slice(0, 6).map((d) => (
                <DocRow key={d.id} doc={d} workspaceId={workspaceId} />
              ))}
            </div>
          )}
        </Section>

        <Section title="Albums and notes" icon={Images} to="albums" empty="">
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm"><Link to="albums"><Images /> Albums{home?.counts?.albums ? ` (${home.counts.albums})` : ''}</Link></Button>
            <Button asChild variant="outline" size="sm"><Link to="notes"><StickyNote /> Notes{home?.counts?.notes ? ` (${home.counts.notes})` : ''}</Link></Button>
          </div>
        </Section>
      </div>

    </div>
  )
}
