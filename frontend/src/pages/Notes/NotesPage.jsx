import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, StickyNote } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useCreateNoteMutation, useGetNotesQuery } from '@/store/api/notesApi'
import { NoteCard } from '@/components/notes/NoteCard'
import { listDrafts } from '@/components/notes/drafts'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorBox, errorMessage } from '@/components/common/ErrorBox'

/** /w/:ws/notes - grid of note cards, pinned first. */
export function NotesPage() {
  const { workspaceId, can } = useWorkspace()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [draftIds, setDraftIds] = useState(new Set())
  const { data, isLoading, error, refetch } = useGetNotesQuery({ workspaceId, q: debounced })
  const [createNote, { isLoading: creating }] = useCreateNoteMutation()
  const canEdit = can('editor')

  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 300)
    return () => clearTimeout(h)
  }, [q])

  useEffect(() => {
    listDrafts(workspaceId, 'note').then((ds) => setDraftIds(new Set(ds.map((d) => d.id))))
  }, [workspaceId])

  const notes = useMemo(() => {
    const list = [...(data?.notes || [])]
    list.sort((a, b) => (b.is_pinned === a.is_pinned ? new Date(b.updated_at) - new Date(a.updated_at) : b.is_pinned ? 1 : -1))
    return list
  }, [data])

  const pinned = notes.filter((n) => n.is_pinned)
  const others = notes.filter((n) => !n.is_pinned)

  const onNew = async () => {
    try {
      const note = await createNote({ workspaceId, title: '', content_html: '<p></p>', content_text: '' }).unwrap()
      navigate(`/w/${workspaceId}/notes/${note.id}`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Notes"
        description="Quick notes, lists and reminders. Link them to people and documents."
        actions={canEdit && (
          <Button onClick={onNew} disabled={creating}>
            <Plus /> New note
          </Button>
        )}
      />

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes" className="h-11 pl-9" />
      </div>

      {error && <ErrorBox error={error} onRetry={refetch} className="mb-4" />}

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
        </div>
      ) : notes.length === 0 ? (
        <EmptyState
          icon={StickyNote}
          title={debounced ? 'No match' : 'No notes yet'}
          description={debounced ? 'Try another word.' : 'Write down anything you want to remember.'}
          action={!debounced && canEdit && <Button onClick={onNew} disabled={creating}><Plus /> New note</Button>}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {pinned.length > 0 && (
            <Section title="Pinned">
              <Grid notes={pinned} workspaceId={workspaceId} draftIds={draftIds} />
            </Section>
          )}
          <Section title={pinned.length ? 'Others' : null}>
            <Grid notes={others} workspaceId={workspaceId} draftIds={draftIds} />
          </Section>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section>
      {title && <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>}
      {children}
    </section>
  )
}

function Grid({ notes, workspaceId, draftIds }) {
  if (!notes.length) return null
  return (
    <div className="columns-1 gap-3 sm:columns-2 lg:columns-3 [&>*]:mb-3">
      {notes.map((n) => (
        <NoteCard key={n.id} note={draftIds.has(n.id) ? { ...n, tags: [...(n.tags || []), 'saved on this device'] } : n} to={`/w/${workspaceId}/notes/${n.id}`} />
      ))}
    </div>
  )
}

export default NotesPage
