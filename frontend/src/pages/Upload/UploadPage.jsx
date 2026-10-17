import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { toast } from 'sonner'
import { ArrowLeft, CheckCircle2, CloudUpload, Copy, Crop, ExternalLink, FileText, Sparkles, UserPlus, WifiOff, X, AlertTriangle } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useGetPeopleQuery, useCreatePersonMutation } from '@/store/api/peopleApi'
import { useGetGroupsQuery } from '@/store/api/groupsApi'
import { documentsApi } from '@/store/api/documentsApi'
import { api } from '@/services/api/client'
import { sha256Hex, compressImage, SMALL_FILE_BYTES, makeThumbnail, fileKind, fileKindLabel, cleanFileName, formatBytes, uuid, MAX_UPLOAD_BYTES } from '@/services/files'
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
import { ImageCropper } from '@/components/documents/ImageCropper'
import { typeLabel } from '@/services/extraction/documentTypes'
import { saveUploadDraft, loadUploadDraft, clearUploadDraft } from '@/services/offline/uploadDraft'

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
    touched: {}, // fields the user changed; reading the photo never overwrites them
    read: null, // text read from the files before the upload (reused afterwards)
    reading: 'idle', // idle | reading | done | none
    found: null, // { holderName, type, filled } what reading found, shown as hints
    nameOptions: [], // other names to pick from
    size: null, // { state: 'working' | 'smaller' | 'small' | 'kept', before, after }
  }
}

/** An item saved in the upload draft, ready for the page again. */
function restoreItem(saved) {
  const base = makeItem(saved.files, {})
  return {
    ...base,
    ...Object.fromEntries(Object.entries(saved).filter(([k, v]) => k !== 'files' && v !== null && v !== undefined)),
    files: saved.files,
    previews: base.previews,
    touched: saved.touched || {},
    nameOptions: saved.nameOptions || [],
    reading: saved.read?.ok ? 'done' : 'idle',
    status: 'idle',
  }
}

const readable = (f) => fileKind(f) === 'image' || fileKind(f) === 'pdf'

export function UploadPage() {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const [searchParams] = useSearchParams()
  // Chosen in the quick add sheet ("Where does it belong?") or on a person's page.
  const presets = {
    document_type: searchParams.get('type') || '',
    person_ids: searchParams.get('person') ? [searchParams.get('person')] : [],
    group_ids: searchParams.get('group') ? [searchParams.get('group')] : [],
    tags: [],
  }
  const { workspaceId, terminology: t, can } = useWorkspace()
  const { data: people = [] } = useGetPeopleQuery(workspaceId, { skip: !workspaceId })
  const { data: groups = [] } = useGetGroupsQuery(workspaceId, { skip: !workspaceId })
  const [items, setItems] = useState([])
  const [combine, setCombine] = useState(false)
  const [running, setRunning] = useState(false)
  const [dup, setDup] = useState(null) // { item, matches, resolve }
  const [cropping, setCropping] = useState(null) // { itemId, index }
  const [createPerson] = useCreatePersonMutation()
  const itemsRef = useRef(items)
  itemsRef.current = items
  const lookupRef = useRef({ people, groups })
  lookupRef.current = { people, groups }
  const readQueue = useRef(Promise.resolve())
  const readJobs = useRef(new Map()) // item id -> promise of the reading
  const [draftLoaded, setDraftLoaded] = useState(false)
  const prepQueue = useRef(Promise.resolve())

  // Start the text reader now, so reading the first photo does not wait for it.
  useEffect(() => {
    import('@/services/ocr').then((m) => m.warmUpReader?.()).catch(() => {})
  }, [])

  /** Makes the big photos of an item smaller (small ones stay as they are), then reads them. */
  const prepareItem = async (id) => {
    const it = itemsRef.current.find((x) => x.id === id)
    if (!it) return
    const before = it.files.reduce((n, f) => n + f.size, 0)
    const big = it.files.some((f) => fileKind(f) === 'image' && f.size > SMALL_FILE_BYTES)
    if (!big) {
      const onlyImages = it.files.every((f) => fileKind(f) === 'image')
      patch(id, { size: { state: onlyImages ? 'small' : 'kept', before, after: before } })
      autoRead(id)
      return
    }
    patch(id, { size: { state: 'working', before, after: before } })
    const files = await Promise.all(it.files.map((f) => compressImage(f)))
    const after = files.reduce((n, f) => n + f.size, 0)
    patch(id, (cur) => {
      if (cur.files !== it.files) return {} // changed meanwhile
      const previews = cur.previews.map((u, i) => {
        if (files[i] === cur.files[i]) return u
        if (u) URL.revokeObjectURL(u)
        return URL.createObjectURL(files[i])
      })
      return { files, previews, size: { state: after < before ? 'smaller' : 'small', before, after } }
    })
    setTimeout(() => autoRead(id), 0)
  }

  // Unfinished upload from before (app closed, page left): bring it back.
  useEffect(() => {
    let alive = true
    if (!workspaceId) return undefined
    loadUploadDraft(workspaceId).then((saved) => {
      if (!alive) return
      if (saved.length && !itemsRef.current.length) {
        const restored = saved.map(restoreItem)
        itemsRef.current = restored
        setItems(restored)
        toast(`Your unfinished upload is back (${restored.length} ${restored.length === 1 ? 'document' : 'documents'}).`, {
          action: { label: 'Discard', onClick: () => discardDraft() },
          duration: 8000,
        })
        restored.forEach((it) => { if (it.reading === 'idle') autoRead(it.id) })
      }
      setDraftLoaded(true)
    })
    return () => { alive = false }
  }, [workspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the draft up to date (files and details), a moment after each change.
  useEffect(() => {
    if (!draftLoaded) return undefined
    const t = setTimeout(() => saveUploadDraft(workspaceId, items), 700)
    return () => clearTimeout(t)
  }, [items, draftLoaded, workspaceId])

  const discardDraft = () => {
    itemsRef.current.forEach((it) => it.previews.forEach((u) => u && URL.revokeObjectURL(u)))
    itemsRef.current = []
    setItems([])
    clearUploadDraft(workspaceId)
  }

  useEffect(() => () => itemsRef.current.forEach((it) => it.previews.forEach((u) => u && URL.revokeObjectURL(u))), [])

  const patch = (id, changes) => setItems((arr) => arr.map((it) => (it.id === id ? { ...it, ...(typeof changes === 'function' ? changes(it) : changes) } : it)))
  const remove = (id) => setItems((arr) => {
    const it = arr.find((x) => x.id === id)
    it?.previews.forEach((u) => u && URL.revokeObjectURL(u))
    return arr.filter((x) => x.id !== id)
  })

  /** A change made by the user: remembered so reading the photo does not undo it. */
  const edit = (id, field, changes) => patch(id, (it) => ({ ...changes, touched: { ...it.touched, [field]: true } }))

  /**
   * Reads the text of an item's photos or PDF (one item at a time, on this
   * device) and fills in name, type and person where the user has not.
   */
  const autoRead = (id) => {
    const job = readQueue.current.then(async () => {
      const it = itemsRef.current.find((x) => x.id === id)
      if (!it || it.status !== 'idle' || !it.files.some(readable)) {
        if (it) patch(id, { reading: 'none' })
        return
      }
      const files = it.files
      patch(id, { reading: 'reading' })
      try {
        const [{ readDocument }, { extractSuggestions, suggestNameVariants }] = await Promise.all([import('@/services/ocr'), import('@/services/extraction')])
        // The first pages are enough to fill in the details; the rest is read after the upload.
        const read = await readDocument({ files: files.map((f, i) => ({ kind: 'original', mime_type: f.type, page_number: i + 1, blob: f })) }, { maxPages: 2 })
        const now = itemsRef.current.find((x) => x.id === id)
        if (!now || now.files !== files) return // removed or cropped meanwhile; a new reading follows
        if (!read?.ok) {
          patch(id, { reading: 'none', read: null })
          return
        }
        const { people: ppl, groups: grps } = lookupRef.current
        const found = extractSuggestions(read.text, { people: ppl, groups: grps })
        const get = (k) => found.find((x) => x.key === k)
        patch(id, (cur) => {
          const next = { reading: 'done', read, nameOptions: suggestNameVariants({ suggestions: found, people: ppl, fallbackName: cleanFileName(files[0].name) }) }
          const name = get('suggested_name')
          if (name && !cur.touched.name) next.name = name.value
          const type = get('document_type')
          if (type && type.confidence >= 0.45 && !cur.touched.type && !presets.document_type) next.document_type = type.value
          const person = get('person_id')
          if (person && !cur.touched.people && !cur.person_ids.length) next.person_ids = [person.value]
          const group = get('group_id')
          if (group && !cur.touched.groups && !cur.group_ids.length) next.group_ids = [group.value]
          const holder = get('holder_name')
          next.found = {
            type: type?.value || null,
            holderName: !person && holder ? holder.value : null,
            filled: Boolean(next.name || next.document_type || next.person_ids),
          }
          return next
        })
      } catch {
        patch(id, { reading: 'none' })
      }
    })
    readQueue.current = job.catch(() => {})
    readJobs.current.set(id, job)
    return job
  }

  const addHolderAsPerson = async (it) => {
    const name = it.found?.holderName
    if (!name) return
    try {
      const person = await createPerson({ workspaceId, display_name: name }).unwrap()
      patch(it.id, (cur) => ({ person_ids: [...new Set([...cur.person_ids, person.id])], found: { ...cur.found, holderName: null }, touched: { ...cur.touched, people: true } }))
      toast.success(`${person.display_name || name} added.`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const finishCrop = (file) => {
    const { itemId, index } = cropping
    setCropping(null)
    patch(itemId, (it) => {
      const files = it.files.map((f, i) => (i === index ? file : f))
      const previews = it.previews.map((u, i) => {
        if (i !== index) return u
        if (u) URL.revokeObjectURL(u)
        return URL.createObjectURL(file)
      })
      return { files, previews, read: null, reading: 'idle' }
    })
    // Read again: a cropped page reads better.
    setTimeout(() => autoRead(itemId), 0)
  }

  const addFiles = (files) => {
    const ok = []
    for (const f of files) {
      if (f.size > MAX_UPLOAD_BYTES) toast.error(`“${f.name}” is too big. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`)
      else if (fileKind(f) === 'other' && !/\.(docx|xlsx|csv|txt|md)$/i.test(f.name)) toast.error(`“${f.name}” is not a supported file type.`)
      else ok.push(f)
    }
    if (!ok.length) return
    const last = itemsRef.current[itemsRef.current.length - 1]
    const defaults = last ? { document_type: presets.document_type, person_ids: last.person_ids, group_ids: last.group_ids, tags: last.tags } : presets
    const arr = itemsRef.current
    let next
    if (combine && arr.length === 1 && arr[0].status === 'idle') {
      const it = arr[0]
      const merged = [...it.files, ...ok].slice(0, 20)
      next = [{ ...it, files: merged, read: null, reading: 'idle', previews: [...it.previews, ...ok.map((f) => (fileKind(f) === 'image' ? URL.createObjectURL(f) : null))].slice(0, 20) }]
    } else if (combine && arr.length === 0) {
      next = [makeItem(ok.slice(0, 20), defaults)]
    } else {
      next = [...arr, ...ok.map((f) => makeItem([f], defaults))].slice(0, 20)
    }
    itemsRef.current = next
    setItems(next)
    // Read the new photos and PDFs to fill in the details.
    const known = new Set(arr.map((x) => x.id))
    next.forEach((it) => {
      // One after the other: twenty photos at once would freeze a phone.
      if (!known.has(it.id) || it.reading === 'idle') prepQueue.current = prepQueue.current.then(() => prepareItem(it.id)).catch(() => {})
    })
  }

  const applyToAll = (source) => {
    setItems((arr) => arr.map((it) => (it.status === 'idle' ? { ...it, document_type: source.document_type, person_ids: source.person_ids, group_ids: source.group_ids, tags: source.tags } : it)))
    toast.success('Applied to all files.')
  }

  const askDuplicate = (item, matches) => new Promise((resolve) => setDup({ item, matches, resolve }))

  async function uploadItem(itemIn) {
    let item = itemIn
    const set = (changes) => patch(item.id, changes)
    try {
      // Let the reading of the photo finish: it fills in the details and is reused below.
      const pendingRead = readJobs.current.get(item.id)
      if (pendingRead && item.reading === 'reading') {
        set({ statusText: 'Reading the photo...' })
        await pendingRead.catch(() => null)
        item = itemsRef.current.find((x) => x.id === item.id) || item
      }
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
          .processDocument({ workspaceId, documentId, versionId: version.id, files: blobs, people, groups, alreadyRead: item.read, onStatus: (s) => set({ statusText: s }) })
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
                  <div className={it.files.length > 1 && !locked ? 'flex shrink-0 gap-1.5' : 'flex shrink-0 -space-x-6'}>
                    {it.files.slice(0, 3).map((f, i) => (
                      it.previews[i] ? (
                        locked ? (
                          <img key={i} src={it.previews[i]} alt="" className="size-16 rounded-xl border-2 border-card bg-muted object-cover" />
                        ) : (
                          <button
                            key={i}
                            type="button"
                            aria-label={`Crop photo ${i + 1}`}
                            onClick={() => setCropping({ itemId: it.id, index: i })}
                            className="relative size-16 overflow-hidden rounded-xl border-2 border-card bg-muted"
                          >
                            <img src={it.previews[i]} alt="" className="size-full object-cover" />
                            <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-black/55 py-0.5 text-[10px] font-semibold text-white">
                              <Crop className="size-3" /> Crop
                            </span>
                          </button>
                        )
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
                    <SizeNote size={it.size} />
                  </div>
                  {!locked && (
                    <Button size="icon-sm" variant="ghost" aria-label="Remove file" onClick={() => remove(it.id)}><X /></Button>
                  )}
                </div>

                {it.status === 'idle' || it.status === 'failed' || it.status === 'cancelled' ? (
                  <div className="mt-4 grid gap-4">
                    {it.reading === 'reading' && (
                      <p className="flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 text-sm text-primary">
                        <Spinner size="sm" /> Reading the {fileKind(it.files[0]) === 'pdf' ? 'PDF' : 'photo'} to fill in the details…
                      </p>
                    )}
                    {it.reading === 'done' && it.found && (it.found.filled || it.found.holderName) && (
                      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 text-sm">
                        <Sparkles className="size-4 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1">
                          {it.found.filled ? 'Filled in from the text on the page. Check and change anything.' : 'Found a name on the page.'}
                          {it.found.type && <span className="text-muted-foreground"> Looks like: {typeLabel(it.found.type)}.</span>}
                        </span>
                        {it.found.holderName && (
                          <Button size="sm" variant="outline" onClick={() => addHolderAsPerson(it)}>
                            <UserPlus /> Add {it.found.holderName}
                          </Button>
                        )}
                      </div>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid min-w-0 gap-1.5">
                        <Label htmlFor={`name-${it.id}`}>Name</Label>
                        <Input id={`name-${it.id}`} value={it.name} onChange={(e) => edit(it.id, 'name', { name: e.target.value })} placeholder="Give it a name" />
                        {it.nameOptions?.filter((n) => n !== it.name).length > 0 && (
                          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pt-0.5 pb-1 [scrollbar-width:none]" aria-label="Other names">
                            {it.nameOptions.filter((n) => n !== it.name).map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => edit(it.id, 'name', { name: n })}
                                className="shrink-0 rounded-full border bg-background px-3 py-1 text-xs font-medium hover:border-primary hover:text-primary"
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="grid gap-1.5">
                        <Label>Type</Label>
                        <DocumentTypeSelect value={it.document_type} onChange={(v) => edit(it.id, 'type', { document_type: v })} />
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      <Label>{t.person_label_plural}</Label>
                      <PeoplePicker value={it.person_ids} onChange={(ids) => edit(it.id, 'people', { person_ids: ids })} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label>{t.group_label_plural}</Label>
                      <GroupPicker value={it.group_ids} onChange={(ids) => edit(it.id, 'groups', { group_ids: ids })} />
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
          {!allDone && !running && (
            <Button size="lg" variant="ghost" onClick={discardDraft}>Clear</Button>
          )}
          {allDone ? (
            <Button size="lg" asChild><Link to={`/w/${workspaceId}/documents`}><FileText /> Go to documents</Link></Button>
          ) : (
            <Button size="lg" onClick={startAll} disabled={running || pendingCount === 0}>
              {running ? <Spinner size="sm" /> : <CloudUpload />} {running ? 'Working...' : pendingCount > 1 ? `Upload ${pendingCount} files` : 'Upload'}
            </Button>
          )}
        </div>
      )}

      {cropping && (() => {
        const it = items.find((x) => x.id === cropping.itemId)
        const file = it?.files[cropping.index]
        if (!file) return null
        return <ImageCropper key={`${cropping.itemId}:${cropping.index}`} file={file} onDone={finishCrop} onCancel={() => setCropping(null)} />
      })()}

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

/** One plain line about the file size: made smaller, or kept as it is. */
function SizeNote({ size }) {
  if (!size) return null
  if (size.state === 'working') {
    return <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Spinner size="sm" /> Making the photo smaller…</p>
  }
  if (size.state === 'smaller') {
    const saved = Math.round((1 - size.after / size.before) * 100)
    return (
      <p className="mt-1 text-xs">
        <span className="font-semibold text-emerald-600 dark:text-emerald-400">Made {saved}% smaller</span>
        <span className="text-muted-foreground"> · {formatBytes(size.before)} → {formatBytes(size.after)}, text stays sharp</span>
      </p>
    )
  }
  if (size.state === 'small') return <p className="mt-1 text-xs text-muted-foreground">Already small ({formatBytes(size.before)}), kept as it is</p>
  return <p className="mt-1 text-xs text-muted-foreground">Kept as it is ({formatBytes(size.before)})</p>
}
