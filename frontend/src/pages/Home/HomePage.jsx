import { Link } from 'react-router-dom'
import { Search, ScanLine, Upload, Users, FolderTree, Images, Star, CalendarClock, FileText, Mic, ImageIcon } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useAuth } from '@/hooks/useAuth'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import { useGetGroupsQuery } from '@/store/api/groupsApi'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { initials, displayNameOf } from '@/utils/format'
import { useIsDesktop } from '@/hooks/useMediaQuery'

function Tile({ to, icon: Icon, label, primary }) {
  return (
    <Link
      to={to}
      className={
        primary
          ? 'flex flex-col items-center justify-center gap-2 rounded-2xl bg-primary p-5 text-primary-foreground shadow-md transition-transform active:scale-[0.98]'
          : 'flex flex-col items-center justify-center gap-2 rounded-2xl border bg-card p-5 transition-colors hover:bg-accent'
      }
    >
      <Icon className="size-7" />
      <span className="text-sm font-medium">{label}</span>
    </Link>
  )
}

function Section({ title, to, children, empty }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {to && (
          <Button asChild variant="ghost" size="sm">
            <Link to={to}>See all</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>{children ?? <p className="text-sm text-muted-foreground">{empty}</p>}</CardContent>
    </Card>
  )
}

export function HomePage() {
  const { workspace, workspaceId, terminology: t } = useWorkspace()
  const { user } = useAuth()
  const isDesktop = useIsDesktop()
  const { data: people = [] } = useGetPeopleQuery(workspaceId)
  const { data: groups = [] } = useGetGroupsQuery(workspaceId)
  const firstName = displayNameOf(user).split(/\s+/)[0]

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold">Hello{firstName ? `, ${firstName}` : ''}</h1>
        <p className="text-sm text-muted-foreground">{workspace?.name}</p>
      </div>

      {!isDesktop && (
        <Link
          to="search"
          className="flex items-center gap-2 rounded-full border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
        >
          <Search className="size-4" />
          <span className="flex-1">Search your documents</span>
          <Mic className="size-4" />
          <ImageIcon className="size-4" />
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile to="scan" icon={ScanLine} label="Scan Document" primary />
        <Tile to="upload" icon={Upload} label="Upload File" />
        <Tile to="people" icon={Users} label={t.person_label_plural} />
        <Tile to="groups" icon={FolderTree} label={t.group_label_plural} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Recent documents" to="documents" empty="Documents you scan or upload will show up here.">
          {null}
        </Section>
        <Section title="Expiring soon" to="reminders" empty="Nothing is expiring soon. Add expiry dates to documents to get reminders.">
          {null}
        </Section>
        <Section title={t.person_label_plural} to="people" empty={`Add ${t.person_label_plural.toLowerCase()} so documents can belong to them.`}>
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
        <Section title={t.group_label_plural} to="groups" empty={`No ${t.group_label_plural.toLowerCase()} yet.`}>
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
        <Section title="Albums" to="albums" empty="Albums group documents the way you like, such as Identity Documents or Tax 2026.">
          {null}
        </Section>
        <Section title="Favourites" empty="Star a document to see it here.">
          {null}
        </Section>
      </div>

      <div className="hidden">
        <Images /> <Star /> <CalendarClock /> <FileText />
      </div>
    </div>
  )
}
