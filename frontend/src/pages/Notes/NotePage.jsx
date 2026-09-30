import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Lock, LockOpen, Pin, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useDeleteNoteMutation, useGetNoteQuery, useUpdateNoteMutation } from '@/store/api/notesApi'
import { decryptJson, encryptJson } from '@/services/vault/crypto'
import { getKey, isUnlocked, subscribe as subscribeVault, touch } from '@/services/vault/session'
import { RichEditor } from '@/components/editor/RichEditor'
import { ColorPicker } from '@/components/notes/ColorPicker'
import { LinkPicker } from '@/components/notes/LinkPicker'
import { noteColorClass } from '@/components/notes/noteColors'
import { deleteDraft, getDraft, saveDraft } from '@/components/notes/drafts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ErrorBox, errorMessage } from '@/components/common/ErrorBox'
import { cn } from '@/lib/utils'

const AUTOSAVE_MS = 1500
const RETRY_MS = 10_000

const STATUS_TEXT = {
  idle: '',
  dirty: 'Unsaved changes',
  saving: 'Saving...',
  saved: 'Saved',
  local: 'Saved on this device',
  conflict: 'Changed elsewhere',
}

/** /w/:ws/notes/:id - title + editor with autosave, drafts, private (Chaabi) notes. */
export function NotePage() {
  const { workspaceId, can } = useWorkspace()
  const { id: noteId } = useParams()
  const navigate = useNavigate()
  const { data: note, isLoading, error, refetch } = useGetNoteQuery({ workspaceId, noteId })
  const [updateNote] = useUpdateNoteMutation()
  const [deleteNote, { isLoading: deleting }] = useDeleteNoteMutation()
  const canEdit = can('editor')

  const [form, setForm] = useState(null) // { title, html, text, color, is_pinned, tags, links, is_private }
  const [status, setStatus] = useState('idle')
  const [conflict, setConflict] = useState(null) // the server's note on 409
  const [vaultOpen, setVaultOpen] = useState(isUnlocked())
  const [lockedContent, setLockedContent] = useState(false) // private note but vault locked
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tagsText, setTagsText] = useState('')
  const serverUpdatedAt = useRef(null)
  const loadedFor = useRef(null)
  const timer = useRef(null)
  const retryTimer = useRef(null)
  const dirty = useRef(false)
  const editorRef = useRef(null)

  useEffect(() => subscribeVault((u) => setVaultOpen(u)), [])

  /* ---------- load ---------- */
  useEffect(() => {
    if (!note || loadedFor.current === note.id) return
    let alive = true
    ;(async () => {
      let html = note.content_html || ''
      let text = note.content_text || ''
      let locked = false
      if (note.is_private && note.encrypted_blob) {
        const key = getKey()
        const secret = key ? await decryptJson(key, note.encrypted_blob, note.iv) : null
        if (secret) {
          html = secret.html || ''
          text = secret.text || ''
        } else locked = true
      }
      const draft = await getDraft(note.id)
      const useDraft = draft && draft.updatedAt > new Date(note.updated_at).getTime() + 1000 && !locked
      if (!alive) return
      serverUpdatedAt.current = note.updated_at
      loadedFor.current = note.id
      setLockedContent(locked)
      const base = {
        title: note.title || '',
        html,
        text,
        color: note.color || 'default',
        is_pinned: !!note.is_pinned,
        tags: note.tags || [],
        links: (note.links || []).map((l) => ({ entity_type: l.entity_type, entity_id: l.entity_id, label: l.label || l.name || l.display_name })),
        is_private: !!note.is_private,
      }
      if (useDraft) {
        const p = draft.payload || {}
        setForm({ ...base, ...p, html: p.html ?? base.html, text: p.text ?? base.text })
        setStatus('local')
        dirty.current = true
        schedule(0)
      } else setForm(base)
      setTagsText((useDraft ? draft.payload?.tags || base.tags : base.tags).join(', '))
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note])

  // Retry opening a private note once the vault unlocks.
  useEffect(() => {
    if (lockedContent && vaultOpen && note) {
      loadedFor.current = null
      refetch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultOpen])

  /* ---------- save ---------- */
  const buildBody = useCallback(
    async (f) => {
      const body = {
        title: f.title,
        color: f.color,
        is_pinned: f.is_pinned,
        is_private: f.is_private,
        tags: f.tags,
        links: f.links.map((l) => ({ entity_type: l.entity_type, entity_id: l.entity_id })),
      }
      if (f.is_private) {
        const key = getKey()
        if (!key) return null
        const enc = await encryptJson(key, { html: f.html, text: f.text })
        Object.assign(body, { content_html: '', content_text: '', encrypted_blob: enc.encrypted_blob, iv: enc.iv })
      } else {
        Object.assign(body, { content_html: f.html, content_text: f.text, encrypted_blob: null, iv: null })
      }
      return body
    },
    [],
  )

  const formRef = useRef(form)
  formRef.current = form

  const save = useCallback(
    async ({ force = false } = {}) => {
      const f = formRef.current
      if (!f || !canEdit) return
      if (!dirty.current && !force) return
      if (conflict && !force) return
      setStatus('saving')
      const body = await buildBody(f)
      if (!body) {
        // private note, vault locked: keep locally, ask to unlock
        await saveDraft(noteId, workspaceId, 'note', { ...f })
        setStatus('local')
        return
      }
      try {
        const saved = await updateNote({ workspaceId, noteId, ...body, updated_at: serverUpdatedAt.current }).unwrap()
        serverUpdatedAt.current = saved?.updated_at || serverUpdatedAt.current
        dirty.current = false
        setConflict(null)
        await deleteDraft(noteId)
        setStatus('saved')
      } catch (err) {
        if (err?.status === 409) {
          setConflict(err?.data?.note || {})
          setStatus('conflict')
          await saveDraft(noteId, workspaceId, 'note', { ...f })
          return
        }
        await saveDraft(noteId, workspaceId, 'note', { ...f })
        setStatus('local')
        if (retryTimer.current) clearTimeout(retryTimer.current)
        retryTimer.current = setTimeout(() => save(), RETRY_MS)
      }
    },
    [buildBody, canEdit, conflict, noteId, updateNote, workspaceId],
  )

  const schedule = useCallback(
    (ms = AUTOSAVE_MS) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => save(), ms)
    },
    [save],
  )

  useEffect(() => {
    const onOnline = () => dirty.current && save()
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
      if (timer.current) clearTimeout(timer.current)
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [save])

  // Save on leaving the page if something is pending.
  useEffect(() => {
    return () => {
      if (dirty.current) save()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const change = (patch) => {
    if (!canEdit) return
    touch()
    dirty.current = true
    setForm((f) => ({ ...f, ...patch }))
    setStatus('dirty')
    schedule()
  }

  const togglePrivate = () => {
    if (!form.is_private && !isUnlocked()) {
      toast.error('Unlock Chaabi first to lock this note with your PIN.', {
        action: { label: 'Open Chaabi', onClick: () => navigate(`/w/${workspaceId}/chaabi`) },
      })
      return
    }
    change({ is_private: !form.is_private })
  }

  const reloadTheirs = () => {
    loadedFor.current = null
    dirty.current = false
    setConflict(null)
    deleteDraft(noteId)
    refetch()
    setStatus('idle')
  }

  const keepMine = async () => {
    serverUpdatedAt.current = conflict?.updated_at || serverUpdatedAt.current
    setConflict(null)
    dirty.current = true
    await save({ force: true })
  }

  const remove = async () => {
    try {
      await deleteNote({ workspaceId, noteId }).unwrap()
      await deleteDraft(noteId)
      dirty.current = false
      toast.success('Note moved to trash.')
      navigate(`/w/${workspaceId}/notes`, { replace: true })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  /* ---------- render ---------- */
  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorBox error={error} title="Could not open this note" onRetry={refetch} />
      </div>
    )
  }
  if (isLoading || !form) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    )
  }

  return (
    <div className={cn('mx-auto max-w-3xl rounded-2xl p-3 sm:p-5', noteColorClass(form.color))}>
      <div className="mb-3 flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to notes">
          <Link to={`/w/${workspaceId}/notes`}>
            <ArrowLeft />
          </Link>
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" aria-live="polite">
          {STATUS_TEXT[status]}
        </span>
        {canEdit && (
          <>
            <Button variant="ghost" size="icon" aria-label={form.is_pinned ? 'Unpin' : 'Pin'} onClick={() => change({ is_pinned: !form.is_pinned })}>
              <Pin className={cn(form.is_pinned && 'fill-current')} />
            </Button>
            <ColorPicker value={form.color} onChange={(c) => change({ color: c })} />
            <Button
              variant="ghost"
              size="icon"
              aria-label={form.is_private ? 'Unlock note' : 'Lock with Chaabi PIN'}
              title={form.is_private ? 'Locked with your Chaabi PIN' : 'Lock with Chaabi PIN'}
              onClick={togglePrivate}
              className={cn(form.is_private && 'text-primary')}
            >
              {form.is_private ? <Lock /> : <LockOpen />}
            </Button>
            <Button variant="ghost" size="icon" aria-label="Delete note" className="text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 />
            </Button>
          </>
        )}
      </div>

      {conflict && (
        <Alert variant="warning" className="mb-3">
          <AlertTitle>This note was changed elsewhere.</AlertTitle>
          <AlertDescription>
            <p>Reload to see the other version, or keep what you have here.</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={reloadTheirs}>Reload</Button>
              <Button size="sm" onClick={keepMine}>Keep mine</Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {lockedContent ? (
        <Alert variant="info" className="mb-3">
          <Lock className="size-4" />
          <AlertTitle>Locked with your Chaabi PIN</AlertTitle>
          <AlertDescription>
            <p>Unlock Chaabi to read and edit this note.</p>
            <Button size="sm" className="mt-2" onClick={() => navigate(`/w/${workspaceId}/chaabi`)}>Open Chaabi</Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <Input
            value={form.title}
            onChange={(e) => change({ title: e.target.value })}
            placeholder="Title"
            readOnly={!canEdit}
            className="mb-3 h-12 border-0 bg-transparent px-1 font-display text-2xl font-semibold shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <RichEditor
            ref={editorRef}
            valueHtml={form.html}
            editable={canEdit}
            placeholder="Write your note..."
            onChange={({ html, text }) => change({ html, text })}
            minHeight="14rem"
          />
          <div className="mt-4 flex flex-col gap-3">
            <Input
              value={tagsText}
              onChange={(e) => {
                setTagsText(e.target.value)
                change({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20) })
              }}
              placeholder="Tags, separated by commas"
              readOnly={!canEdit}
              className="bg-background/60"
            />
            <LinkPicker links={form.links} onChange={(links) => change({ links })} readOnly={!canEdit} />
          </div>
        </>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move this note to trash?</AlertDialogTitle>
            <AlertDialogDescription>You can restore it later from the trash.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={remove} disabled={deleting} className="bg-destructive text-white hover:bg-destructive/90">
              Move to trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default NotePage
