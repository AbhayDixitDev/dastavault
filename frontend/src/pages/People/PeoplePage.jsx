import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, Users } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import { PersonDialog } from '@/components/people/PersonDialog'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorBox } from '@/components/common/ErrorBox'
import { initials } from '@/utils/format'

export function PeoplePage() {
  const { workspaceId, terminology: t, can } = useWorkspace()
  const { data: people = [], isLoading, error, refetch } = useGetPeopleQuery(workspaceId)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return people
    return people.filter((p) => [p.display_name, p.relation_label, p.email].filter(Boolean).some((v) => v.toLowerCase().includes(s)))
  }, [people, q])

  const canEdit = can('editor')

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t.person_label_plural}
        description={`Documents belong to ${t.person_label_plural.toLowerCase()}. Add everyone whose papers you keep.`}
        actions={canEdit && (
          <Button onClick={() => setOpen(true)}>
            <Plus /> Add {t.person_label}
          </Button>
        )}
      />

      {people.length > 5 && (
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find a ${t.person_label.toLowerCase()}`} className="pl-9" />
        </div>
      )}

      {error && <ErrorBox error={error} onRetry={refetch} className="mb-4" />}

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={people.length === 0 ? `No ${t.person_label_plural.toLowerCase()} yet` : 'No match'}
          description={people.length === 0 ? `Add your first ${t.person_label.toLowerCase()} so documents can belong to them.` : 'Try a different name.'}
          action={people.length === 0 && canEdit && <Button onClick={() => setOpen(true)}><Plus /> Add {t.person_label}</Button>}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <li key={p.id}>
              <Link to={p.id} className="flex items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:bg-accent">
                <Avatar className="size-12">
                  <AvatarFallback>{initials(p.display_name)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.display_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.relation_label || (p.groups?.length ? p.groups.map((g) => g.name).join(', ') : t.person_label)}
                  </span>
                </span>
                {p.user_id && <Badge variant="secondary">Has login</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <PersonDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}
