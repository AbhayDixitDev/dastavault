import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { toast } from 'sonner'
import { ArrowLeft, CheckCircle2, CloudUpload, Copy, ExternalLink, FileText, WifiOff, X, AlertTriangle } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import { useGetGroupsQuery } from '@/store/api/groupsApi'
import { documentsApi } from '@/store/api/documentsApi'
import { api } from '@/services/api/client'
import { sha256Hex, compressImage, makeThumbnail, fileKind, fileKindLabel, cleanFileName, formatBytes, uuid, MAX_UPLOAD_BYTES } from '@/services/files'
import { pdfThumbnail } from '@/services/pdf'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from '@/components/common/ErrorBox'
import { UploadDropzone } from '@/components/documents/UploadDropzone'
import { DocumentTypeSelect } from '@/components/documents/DocumentTypeSelect'
import { DocumentTypeIcon } from '@/components/documents/DocumentTypeIcon'
import { PeoplePicker } from '@/components/documents/PeoplePicker'
import { GroupPicker } from '@/components/documents/GroupPicker'
import { TagInput } from '@/components/documents/TagInput'
import { DuplicateDialog } from '@/components/documents/DuplicateDialog'

const STATUS = {
  idle: '',
  preparing: 'Getting the file ready...',
  checking: 'Checking for copies...',
  waiting: 'Waiting for internet connection.',
  saved: 'Saved on this device',
  uploading: 'Uploading',
  uploaded: 'Uploaded',
  reading: 'Reading text from this document...',
  ready: 'Document is ready to search.',
  failed: 'Upload failed',
  cancelled: 'Skipped',
}

function guessType(file) {
  const k = fileKind(file)
  if (k === 'image') return 'photo'
  return 'other'
}

function makeItem(files, defaults) {
  const first = files[0]
  return {
    id: uuid(),
    files,
    name: cleanFileName(first.name),
    document_type: defaults.document_type || guessType(first),
    person_ids: defaults.person_ids || [],
    group_ids: defaults.group_ids || [],
    tags: defaults.tags || [],
    previews: files.map((f) => (fileKind(f) === 'image' ? URL.createObjectURL(f) : null)),
    status: 'idle',
    statusText: '',
    progress: 0,
    error: '',
    documentId: null,
    versionOf: null, // document id when adding as a new version
  }
}

export function UploadPage() {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const { workspaceId, terminology: t, can } = useWorkspace()
  const { data: people = [] } = useGetPeopleQuery(workspaceId, { skip: !workspaceId })
  const { data: groups = [] } = useGetGroupsQuery(workspaceId, { skip: !workspaceId })
  const [items, setItems] = useState([])
  const [combine, setCombine] = useState(false)
  const [running, setRunning] = useState(false)
  const [dup, setDup] = useState(null) // { item, matches, resolve }
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => () => itemsRef.current.forEach((it) => it.previews.forEach((u) => u && URL.revokeObjectURL(u))), [])

  const patch = (id, changes) => setItems((arr) => arr.map((it) => (it.id === id ? { ...it, ...(typeof changes === 'function' ? changes(it) : changes) } : it)))
  const remove = (id) => setItems((arr) => {
    const it = arr.find((x) => x.id === id)
    it?.previews.forEach((u) => u && URL.revokeObjectURL(u))
    return arr.filter((x) => x.id !== id)
  })

  const addFiles = (files) => {
    const ok = []
    for (const f of files) {
      if (f.size > MAX_UPLOAD_BYTES) toast.error(`“${f.name}” is too big. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`)
      else if (fileKind(f) === 'other' && !/\.(docx|xlsx|csv|txt|md)$/i.test(f.name)) toast.error(`“${f.name}” is not a supported file type.`)
      else ok.push(f)
    }
    if (!ok.length) return
    const last = itemsRef.current[itemsRef.current.length - 1]
    const defaults = last ? { document_type: '', person_ids: last.person_ids, group_ids: last.group_ids, tags: last.tags } : {}
    setItems((arr) => {
      if (combine && arr.length === 1 && arr[0].status === 'idle') {
        const it = arr[0]
        const merged = [...it.files, ...ok].slice(0, 20)
        return [{ ...it, files: merged, previews: [...it.previews, ...ok.map((f) => (fileKind(f) === 'image' ? URL.createObjectURL(f) : null))].slice(0, 20) }]
      }
      if (combine && arr.length === 0) return [makeItem(ok.slice(0, 20), defaults)]
      return [...arr, ...ok.map((f) => makeItem([f], defaults))].slice(0, 20)
    })
  }

  const applyToAll = (source) => {
    setItems((arr) => arr.map((it) => (it.status === 'idle' ? { ...it, document_type: source.document_type, person_ids: source.person_ids, group_ids: source.group_ids, tags: source.tags } : it)))
    toast.success('Applied to all files.')
  }

  const askDuplicate = (item, matches) => new Promise((resolve) => setDup({ item, matches, resolve }))

  async function uploadItem(item) {
    const set = (changes) => patch(item.id, changes)
    try {
      set({ status: 'preparing', statusText: STATUS.preparing, error: '' })
      const prepared = []
      for (const f of item.files) {
        const file = await compressImage(f)
        prepared.push({ file, sha: await sha256Hex(file) })
      }
      const first = prepared[0]?.file
      let thumb = null
      if (first) {
        const k = fileKind(first)
        if (k === 'image') thumb = await makeThumbnail(first)
        else if (k === 'pdf') thumb = await pdfThumbnail(first)
      }

      // Offline: keep it on the device and let the queue send it later.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const q = await import('@/services/offline/uploadQueue.js').catch(() => null)
        if (q?.enqueueUpload) {
          await q.enqueueUpload({
            workspaceId,
            files: prepared.map((p, i) => ({ blob: p.file, name: p.file.name, kind: 'original', page_number: i + 1 })),
            name: item.name,
            document_type: item.document_type,
            person_ids: item.person_ids,
            group_ids: item.group_ids,
            sha256s: prepared.map((p) => p.sha),
          })
          set({ status: 'waiting', statusText: `${STATUS.saved}. ${STATUS.waiting}` })
          return
        }
        set({ status: 'failed', statusText: STATUS.waiting, error: 'You are offline. Try again when you are connected.' })
        return
      }

      // Duplicates.
      let versionOf = item.versionOf
      if (!versionOf) {
        set({ status: 'checking', statusText: STATUS.checking })
        const matches = await api
          .post(`/workspaces/${workspaceId}/documents/check-duplicates`, { sha256: prepared.map((p) => p.sha).filter(Boolean) })
          .then((r) => r?.matches ?? [])
          .catch(() => [])
        if (matches.length) {
          const { action, match } = await askDuplicate(item, matches)
          if (action === 'cancel') {
            set({ status: 'cancelled', statusText: STATUS.cancelled })
            return
          }
          if (action === 'view') {
            set({ status: 'idle', statusText: '' })
            navigate(`/w/${workspaceId}/documents/${match.document.id}`)
            return
          }
          if (action === 'version') versionOf = match.document.id
        }
      }

      // Upload.
      const fd = new FormData()
      prepared.forEach((p, i) => {
        fd.append('files[]', p.file, p.file.name)
        fd.append('sha256[]', p.sha)
        fd.append('page_numbers[]', String(i + 1))
      })
      const path = versionOf ? `/workspaces/${workspaceId}/documents/${versionOf}/versions` : `/workspaces/${workspaceId}/uploads`
      if (versionOf) {
        fd.append('comment', 'Uploaded as a new version')
      } else {
        fd.append('name', item.name.trim() || cleanFileName(item.files[0].name))
        if (item.document_type) fd.append('document_type', item.document_type)
        fd.append('person_ids', JSON.stringify(item.person_ids))
        fd.append('group_ids', JSON.stringify(item.group_ids))
        fd.append('client_upload_id', item.id)
      }
      set({ status: 'uploading', statusText: STATUS.uploading, progress: 0, versionOf })
      const res = await api.post(path, fd, { onUploadProgress: (p) => set({ progress: Math.round(p * 100) }) })
      const documentId = res?.document?.id ?? versionOf
      const version = res?.version
      const uploaded = res?.files ?? []
      set({ status: 'uploaded', statusText: STATUS.uploaded, progress: 100, documentId })

      // Preview and tags (best effort).
      if (thumb && documentId && version?.id) {
        const tfd = new FormData()
        tfd.append('files[]', thumb, 'thumbnail.webp')
        tfd.append('kind', 'thumbnail')
        await api.post(`/workspaces/${workspaceId}/documents/${documentId}/versions/${version.id}/files`, tfd).catch(() => null)
      }
      if (!versionOf && item.tags.length && documentId) {
        await api.put(`/workspaces/${workspaceId}/documents/${documentId}/tags`, { names: item.tags }).catch(() => null)
      }
      dispatch(documentsApi.util.invalidateTags(['Documents', 'Home', { type: 'Document', id: documentId }]))

      // Read the text and make it searchable, without blocking anything.
      set({ status: 'reading', statusText: STATUS.reading })
      const mod = await import('@/services/pipeline/processDocument.js').catch(() => null)
      if (mod?.processDocument && documentId && version?.id) {
        const blobs = uploaded.map((uf, i) => ({ id: uf.id, kind: uf.kind, mime_type: uf.mime_type, page_number: uf.page_number ?? i + 1, blob: prepared[i]?.file }))
        await mod
          .processDocument({ workspaceId, documentId, versionId: version.id, files: blobs, people, groups, onStatus: (s) => set({ statusText: s }) })
          .catch(() => null)
        dispatch(documentsApi.util.invalidateTags([{ type: 'Document', id: documentId }, { type: 'Suggestions', id: documentId }, 'Documents']))
      }
      set({ status: 'ready', statusText: STATUS.ready })
    } catch (err) {
      set({ status: 'failed', statusText: STATUS.failed, error: errorMessage(err) })
      toast.error(errorMessage(err))
    }
  }

  const startAll = async () => {
    const pending = itemsRef.current.filter((it) => it.status === 'idle' || it.status === 'failed')
    if (!pending.length || running) return
    setRunning(true)
    for (const it of pending) {
      // eslint-disable-next-line no-await-in-loop
      await uploadItem(itemsRef.current.find((x) => x.id === it.id) || it)
    }
    setRunning(false)
    const done = itemsRef.current.filter((it) => it.status === 'ready' || it.status === 'uploaded')
    if (done.length === 1 && itemsRef.current.length === 1 && done[0].documentId) {
      navigate(`/w/${workspaceId}/documents/${done[0].documentId}`)
    }
  }

  const allDone = items.length > 0 && items.every((it) => ['ready', 'uploaded', 'waiting', 'cancelled'].includes(it.status))
  const pendingCount = items.filter((it) => it.status === 'idle' || it.status === 'failed').length
  const totalBytes = useMemo(() => items.reduce((n, it) => n + it.files.reduce((m, f) => m + f.size, 0), 0), [items])

  if (!can('editor')) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title="Upload" />
        <p className="text-sm text-muted-foreground">You can view documents in this workspace but not add new ones. Ask an admin for editor access.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link to={`/w/${workspaceId}/documents`} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Documents
      </Link>
      <PageHeader title="Upload" description="Add photos, PDFs and files from your device." />

      {typeof navigator !== 'undefined' && navigator.onLine === false && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <WifiOff className="size-4 shrink-0" /> You are offline. Files will be saved on this device and sent when you are back online.
        </div>
      )}

      <UploadDropzone onFiles={addFiles} disabled={running} compact={items.length > 0} className={items.length > 0 ? 'mb-4' : ''} />

      {items.length === 0 && (
        <label className="mt-4 flex items-center justify-between rounded-xl border bg-card p-3 text-sm">
          <span>
            <span className="block font-medium">Combine files into one document</span>
            <span className="block text-xs text-muted-foreground">Turn on if you are uploading several pages of the same paper.</span>
          </span>
          <Switch checked={combine} onCheckedChange={setCombine} />
        </label>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((it) => {
            const busy = !['idle', 'failed', 'cancelled'].includes(it.status)
            const locked = busy || it.status === 'ready' || it.status === 'uploaded' || it.status === 'waiting'
            return (
              <li key={it.id} className="rounded-2xl border bg-card p-4 shadow-soft">
                <div className="flex items-start gap-3">
                  <div className="flex shrink-0 -space-x-6">
                    {it.files.slice(0, 3).map((f, i) => (
                      it.previews[i] ? (
                        <img key={i} src={it.previews[i]} alt="" className="size-16 rounded-xl border-2 border-card bg-muted object-cover" />
                      ) : (
                        <span key={i} className="flex size-16 items-center justify-center rounded-xl border-2 border-card bg-muted"><DocumentTypeIcon type={it.document_type} size="sm" className="bg-transparent" /></span>
                      )
                    ))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">{fileKindLabel(fileKind(it.files[0]))}</Badge>
                      <span>{it.files.length > 1 ? `${it.files.length} files · ` : ''}{formatBytes(it.files.reduce((n, f) => n + f.size, 0))}</span>
                      {it.versionOf && <Badge variant="outline">New version</Badge>}
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">{it.files.map((f) => f.name).join(', ')}</p>
                  </div>
                  {!locked && (
                    <Button size="icon-sm" variant="ghost" aria-label="Remove file" onClick={() => remove(it.id)}><X /></Button>
                  )}
                </div>

                {it.status === 'idle' || it.status === 'failed' || it.status === 'cancelled' ? (
                  <div className="mt-4 grid gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label htmlFor={`name-${it.id}`}>Name</Label>
                        <Input id={`name-${it.id}`} value={it.name} onChange={(e) => patch(it.id, { name: e.target.value })} placeholder="Give it a name" />
                      </div>
                      <div className="grid gap-1.5">
                        <Label>Type</Label>
                        <DocumentTypeSelect value={it.document_type} onChange={(v) => patch(it.id, { document_type: v })} />
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      <Label>{t.person_label_plural}</Label>
                      <PeoplePicker value={it.person_ids} onChange={(ids) => patch(it.id, { person_ids: ids })} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label>{t.group_label_plural}</Label>
                      <GroupPicker value={it.group_ids} onChange={(ids) => patch(it.id, { group_ids: ids })} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label>Tags</Label>
                      <TagInput value={it.tags} onChange={(tags) => patch(it.id, { tags })} />
                    </div>
                    {items.length > 1 && (
                      <button type="button" onClick={() => applyToAll(it)} className="flex w-fit items-center gap-1 text-xs text-primary hover:underline">
                        <Copy className="size-3" /> Use these details for all files
                      </button>
                    )}
                    {it.error && <p className="flex items-center gap-1 text-sm text-destructive"><AlertTriangle className="size-4" /> {it.error}</p>}
                    {it.status === 'cancelled' && <p className="text-sm text-muted-foreground">Skipped. Press Upload to try again.</p>}
                  </div>
                ) : (
                  <div className="mt-4 grid gap-2">
                    <p className="truncate font-medium">{it.name}</p>
                    {(it.status === 'uploading' || it.status === 'preparing' || it.status === 'checking') && (
                      <Progress value={it.status === 'uploading' ? it.progress : 4} />
                    )}
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      {it.status === 'ready' ? <CheckCircle2 className="size-4 text-emerald-600" /> : it.status === 'waiting' ? <WifiOff className="size-4" /> : <Spinner size="sm" />}
                      {it.statusText}{it.status === 'uploading' ? ` ${it.progress}%` : ''}
                    </p>
                    {it.documentId && (
                      <Button asChild size="sm" variant="outline" className="w-fit">
                        <Link to={`/w/${workspaceId}/documents/${it.documentId}`}><ExternalLink /> Open document</Link>
                      </Button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {items.length > 0 && (
        <div className="safe-bottom sticky bottom-16 mt-4 flex items-center gap-3 rounded-2xl border bg-card/95 p-3 shadow-lift backdrop-blur lg:bottom-4">
          <span className="min-w-0 flex-1 text-sm text-muted-foreground">
            {allDone ? 'All done.' : `${items.length} ${items.length === 1 ? 'document' : 'documents'} · ${formatBytes(totalBytes)}`}
          </span>
          {allDone ? (
            <Button size="lg" asChild><Link to={`/w/${workspaceId}/documents`}><FileText /> Go to documents</Link></Button>
          ) : (
            <Button size="lg" onClick={startAll} disabled={running || pendingCount === 0}>
              {running ? <Spinner size="sm" /> : <CloudUpload />} {running ? 'Working...' : pendingCount > 1 ? `Upload ${pendingCount} files` : 'Upload'}
            </Button>
          )}
        </div>
      )}

      <DuplicateDialog
        open={!!dup}
        onOpenChange={(v) => { if (!v && dup) { dup.resolve({ action: 'cancel' }); setDup(null) } }}
        matches={dup?.matches ?? []}
        fileName={dup?.item?.name}
        onChoose={(action, match) => { dup?.resolve({ action, match }); setDup(null) }}
      />
    </div>
  )
}
