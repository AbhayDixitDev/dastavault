import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Plus, FolderTree, Pencil, Trash2, Users, ChevronRight, ArrowLeft } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useDeleteGroupMutation, useGetGroupsQuery } from '@/store/api/groupsApi'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import { GroupDialog } from '@/components/groups/GroupDialog'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ErrorBox, errorMessage } from '@/components/common/ErrorBox'
import { initials } from '@/utils/format'

function GroupRow({ group, children, t, canEdit, onEdit, onAddSub, onDelete, isSub }) {
  return (
    <li className="rounded-2xl border bg-card">
      <div className="flex items-center gap-3 p-4">
        <FolderTree className="size-5 text-primary" />
        <Link to={group.id} className="min-w-0 flex-1">
          <span className="block truncate font-medium">{group.name}</span>
          <span className="block text-xs text-muted-foreground">
            {group.member_count ?? 0} {t.person_label_plural.toLowerCase()}{group.description ? ` · ${group.description}` : ''}
          </span>
        </Link>
        {canEdit && (
          <div className="flex gap-1">
            {!isSub && <Button variant="ghost" size="icon" title={`Add ${t.subgroup_label}`} onClick={() => onAddSub(group)}><Plus /></Button>}
            <Button variant="ghost" size="icon" title="Edit" onClick={() => onEdit(group)}><Pencil /></Button>
            <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="ghost" size="icon" title="Delete"><Trash2 /></Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {group.name}?</AlertDialogTitle>
                  <AlertDialogDescription>Documents and people are not deleted, only the link to this {t.group_label.toLowerCase()}.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(group)}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
        <ChevronRight className="size-4 text-muted-foreground" />
      </div>
      {children?.length > 0 && (
        <ul className="border-t px-4 py-2">
          {children.map((c) => (
            <li key={c.id} className="flex items-center gap-2 py-1.5 pl-6 text-sm">
              <Link to={c.id} className="flex-1 truncate hover:underline">{c.name}</Link>
              <span className="text-xs text-muted-foreground">{c.member_count ?? 0}</span>
              {canEdit && (
                <>
                  <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onEdit(c)} title="Edit"><Pencil className="size-3.5" /></button>
                  <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(c)} title="Delete"><Trash2 className="size-3.5" /></button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function GroupsPage() {
  const { id } = useParams()
  const { workspaceId, terminology: t, can } = useWorkspace()
  const { data: groups = [], isLoading, error, refetch } = useGetGroupsQuery(workspaceId)
  const { data: people = [] } = useGetPeopleQuery(workspaceId)
  const [deleteGroup] = useDeleteGroupMutation()
  const [dialog, setDialog] = useState({ open: false, group: null, parentId: null })
  const canEdit = can('editor')

  const tree = useMemo(() => {
    const top = groups.filter((g) => !g.parent_group_id)
    const byParent = {}
    groups.forEach((g) => {
      if (g.parent_group_id) (byParent[g.parent_group_id] ||= []).push(g)
    })
    return top.map((g) => ({ group: g, children: byParent[g.id] ?? [] }))
  }, [groups])

  const onDelete = async (g) => {
    try {
      await deleteGroup({ workspaceId, groupId: g.id }).unwrap()
      toast.success('Deleted.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  // Detail view for a single group
  if (id) {
    const group = groups.find((g) => g.id === id)
    const members = people.filter((p) => (p.groups ?? []).some((pg) => pg.id === id))
    const subs = groups.filter((g) => g.parent_group_id === id)
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Link to=".." relative="path" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> {t.group_label_plural}
        </Link>
        {isLoading ? <Skeleton className="h-24 rounded-2xl" /> : !group ? <ErrorBox error="Not found" /> : (
          <>
            <PageHeader
              title={group.name}
              description={group.description || (group.parent_group_id ? t.subgroup_label : t.group_label)}
              actions={canEdit && <Button variant="outline" onClick={() => setDialog({ open: true, group, parentId: null })}><Pencil /> Edit</Button>}
            />
            {subs.length > 0 && (
              <div>
                <h2 className="mb-2 text-sm font-medium text-muted-foreground">{t.subgroup_label_plural}</h2>
                <div className="flex flex-wrap gap-2">
                  {subs.map((s) => <Link key={s.id} to={`../${s.id}`} relative="path" className="rounded-full border px-3 py-1 text-sm hover:bg-accent">{s.name}</Link>)}
                </div>
              </div>
            )}
            <div>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">{t.person_label_plural}</h2>
              {members.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nobody here yet. Open a {t.person_label.toLowerCase()} and add them to this {t.group_label.toLowerCase()}.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {members.map((p) => (
                    <li key={p.id}>
                      <Link to={`../../people/${p.id}`} relative="path" className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-accent">
                        <Avatar className="size-9"><AvatarFallback>{initials(p.display_name)}</AvatarFallback></Avatar>
                        <span className="truncate text-sm font-medium">{p.display_name}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
        <GroupDialog open={dialog.open} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} group={dialog.group} groups={groups} defaultParentId={dialog.parentId} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t.group_label_plural}
        description={`Organise ${t.person_label_plural.toLowerCase()} and documents into ${t.group_label_plural.toLowerCase()}${t.subgroup_label_plural ? ` and ${t.subgroup_label_plural.toLowerCase()}` : ''}.`}
        actions={canEdit && <Button onClick={() => setDialog({ open: true, group: null, parentId: null })}><Plus /> New {t.group_label}</Button>}
      />
      {error && <ErrorBox error={error} onRetry={refetch} className="mb-4" />}
      {isLoading ? (
        <div className="grid gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Users}
          title={`No ${t.group_label_plural.toLowerCase()} yet`}
          description={`For example: ${t.group_label_plural === 'Departments' ? 'Engineering, Marketing, Finance' : t.group_label_plural === 'Classes' ? 'Class 8, Class 9' : 'Parents, Kids'}.`}
          action={canEdit && <Button onClick={() => setDialog({ open: true, group: null, parentId: null })}><Plus /> New {t.group_label}</Button>}
        />
      ) : (
        <ul className="grid gap-3">
          {tree.map(({ group, children }) => (
            <GroupRow
              key={group.id}
              group={group}
              children={children}
              t={t}
              canEdit={canEdit}
              onEdit={(g) => setDialog({ open: true, group: g, parentId: null })}
              onAddSub={(g) => setDialog({ open: true, group: null, parentId: g.id })}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
      <GroupDialog open={dialog.open} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} group={dialog.group} groups={groups} defaultParentId={dialog.parentId} />
    </div>
  )
}
