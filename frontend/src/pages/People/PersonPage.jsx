import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Pencil, Trash2, Plus, X, Mail, Phone, Cake, FileText, ScanLine, Upload } from 'lucide-react'
import { useGetDocumentsQuery } from '@/store/api/documentsApi'
import { GroupedDocuments, documentYear } from '@/components/documents/GroupedDocuments'
import { documentTypeLabel } from '@/components/documents/documentTypes'
import { useWorkspace } from '@/hooks/useWorkspace'
import {
  useGetPersonQuery,
  useDeletePersonMutation,
  useRemoveRelationshipMutation,
  useAddPersonToGroupMutation,
  useRemovePersonFromGroupMutation,
} from '@/store/api/peopleApi'
import { useGetGroupsQuery } from '@/store/api/groupsApi'
import { PersonDialog } from '@/components/people/PersonDialog'
import { RelationshipDialog } from '@/components/people/RelationshipDialog'
import { Button } from '@/components/ui/button'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ErrorBox, errorMessage } from '@/components/common/ErrorBox'
import { formatDate } from '@/utils/format'
import { relationLabel } from '@/constants/relations'

export function PersonPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { workspaceId, terminology: t, can } = useWorkspace()
  const { data: person, isLoading, error, refetch } = useGetPersonQuery({ workspaceId, personId: id })
  const { data: groups = [] } = useGetGroupsQuery(workspaceId)
  const { data: docsData, isLoading: docsLoading } = useGetDocumentsQuery({ workspaceId, person_id: id, limit: 100 }, { skip: !workspaceId })
  const personDocs = docsData?.documents ?? []
  const [groupBy, setGroupBy] = useState('type')
  const [typeFilter, setTypeFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const typeCounts = countBy(personDocs, (d) => d.document_type || 'other')
  const yearCounts = countBy(personDocs, documentYear)
  const shownDocs = personDocs.filter((d) => (!typeFilter || (d.document_type || 'other') === typeFilter) && (!yearFilter || documentYear(d) === yearFilter))
  const [deletePerson] = useDeletePersonMutation()
  const [removeRelationship] = useRemoveRelationshipMutation()
  const [addToGroup] = useAddPersonToGroupMutation()
  const [removeFromGroup] = useRemovePersonFromGroupMutation()
  const [editOpen, setEditOpen] = useState(false)
  const [relOpen, setRelOpen] = useState(false)
  const canEdit = can('editor')

  const onDelete = async () => {
    try {
      await deletePerson({ workspaceId, personId: id }).unwrap()
      toast.success('Removed.')
      navigate('..', { relative: 'path' })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const run = async (promise, ok) => {
    try {
      await promise.unwrap()
      if (ok) toast.success(ok)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  if (isLoading) return <div className="mx-auto max-w-3xl"><Skeleton className="h-40 rounded-2xl" /></div>
  if (error) return <ErrorBox error={error} onRetry={refetch} />
  if (!person) return null

  const personGroupIds = new Set((person.groups ?? []).map((g) => g.id))
  const availableGroups = groups.filter((g) => !personGroupIds.has(g.id))

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link to=".." relative="path" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {t.person_label_plural}
      </Link>

      <div className="flex items-start gap-4">
        <PersonAvatar person={person} className="size-16 text-lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold">{person.display_name}</h1>
          <p className="text-sm text-muted-foreground">{person.relation_label || t.person_label}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {person.email && <span className="flex items-center gap-1"><Mail className="size-4" /> {person.email}</span>}
            {person.phone && <span className="flex items-center gap-1"><Phone className="size-4" /> {person.phone}</span>}
            {person.date_of_birth && <span className="flex items-center gap-1"><Cake className="size-4" /> {formatDate(person.date_of_birth)}</span>}
          </div>
        </div>
        {canEdit && (
          <div className="flex gap-1">
            <Button variant="outline" size="icon" onClick={() => setEditOpen(true)} title="Edit"><Pencil /></Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="icon" title="Remove"><Trash2 /></Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove {person.display_name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Their documents stay in the workspace. You can restore this {t.person_label.toLowerCase()} from Settings later.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>Remove</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Relationships</CardTitle>
            {canEdit && <Button variant="ghost" size="sm" onClick={() => setRelOpen(true)}><Plus /> Add</Button>}
          </CardHeader>
          <CardContent>
            {(person.relationships ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Say who this person is to others, for example “{person.display_name} is the Father of Nikhil”. Search uses this for words like “dad”.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {person.relationships.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1">
                      <Badge variant="secondary" className="mr-1">{relationLabel(r.relation, r.custom_label)}</Badge>
                      of <Link to={`../${r.to_person?.id}`} relative="path" className="font-medium hover:underline">{r.to_person?.display_name}</Link>
                    </span>
                    {canEdit && (
                      <button type="button" className="text-muted-foreground hover:text-destructive" title="Remove"
                        onClick={() => run(removeRelationship({ workspaceId, personId: id, relationshipId: r.id }))}>
                        <X className="size-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">{t.group_label_plural}</CardTitle>
            {canEdit && availableGroups.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="sm"><Plus /> Add</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {availableGroups.map((g) => (
                    <DropdownMenuItem key={g.id} onClick={() => run(addToGroup({ workspaceId, personId: id, group_id: g.id }), `Added to ${g.name}.`)}>
                      {g.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </CardHeader>
          <CardContent>
            {(person.groups ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Not in any {t.group_label.toLowerCase()} yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {person.groups.map((g) => (
                  <span key={g.id} className="flex items-center gap-1 rounded-full border px-3 py-1 text-sm">
                    <Link to={`../../groups/${g.id}`} relative="path" className="hover:underline">{g.name}</Link>
                    {canEdit && (
                      <button type="button" className="text-muted-foreground hover:text-destructive" title="Remove"
                        onClick={() => run(removeFromGroup({ workspaceId, personId: id, groupId: g.id }))}>
                        <X className="size-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Documents</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to={`/w/${workspaceId}/documents?person_id=${id}`}>See all</Link>
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {can('editor') && (
              <div className="grid grid-cols-2 gap-2">
                <Button asChild className="rounded-xl">
                  <Link to={`/w/${workspaceId}/scan?person=${id}`}><ScanLine /> Scan for {person.display_name.split(/\s+/)[0]}</Link>
                </Button>
                <Button asChild variant="outline" className="rounded-xl">
                  <Link to={`/w/${workspaceId}/upload?person=${id}`}><Upload /> Upload file</Link>
                </Button>
              </div>
            )}
            {docsLoading ? (
              <Skeleton className="h-24 rounded-xl" />
            ) : personDocs.length > 0 ? (
              <>
                {/* Pick a kind or a year; see them grouped */}
                <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
                  <FilterChip active={!typeFilter} onClick={() => setTypeFilter('')}>All {personDocs.length}</FilterChip>
                  {typeCounts.map(([key, n]) => (
                    <FilterChip key={key} active={typeFilter === key} onClick={() => setTypeFilter(typeFilter === key ? '' : key)}>{documentTypeLabel(key)} {n}</FilterChip>
                  ))}
                </div>
                {yearCounts.length > 1 && (
                  <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
                    <FilterChip active={!yearFilter} onClick={() => setYearFilter('')}>Every year</FilterChip>
                    {yearCounts.sort((a, b) => b[0].localeCompare(a[0])).map(([key, n]) => (
                      <FilterChip key={key} active={yearFilter === key} onClick={() => setYearFilter(yearFilter === key ? '' : key)}>{key} · {n}</FilterChip>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Group:</span>
                  {[['type', 'Type'], ['year', 'Year'], ['none', 'None']].map(([key, label]) => (
                    <button key={key} type="button" onClick={() => setGroupBy(key)} className={groupBy === key ? 'font-semibold text-foreground underline underline-offset-4' : 'text-muted-foreground'}>{label}</button>
                  ))}
                </div>
                <GroupedDocuments docs={shownDocs} by={groupBy} workspaceId={workspaceId} />
              </>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="size-4" /> No documents for {person.display_name} yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <PersonDialog open={editOpen} onOpenChange={setEditOpen} person={person} />
      <RelationshipDialog open={relOpen} onOpenChange={setRelOpen} person={person} />
    </div>
  )
}

function countBy(list, keyOf) {
  const map = new Map()
  for (const item of list) {
    const key = keyOf(item)
    map.set(key, (map.get(key) || 0) + 1)
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={active ? 'shrink-0 rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background' : 'shrink-0 rounded-full border px-3 py-1 text-xs text-muted-foreground hover:text-foreground'}
    >
      {children}
    </button>
  )
}
