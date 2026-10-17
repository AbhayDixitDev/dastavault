import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, ScanFace, UserPlus } from 'lucide-react'
import { api } from '@/services/api/client'
import { fetchFileBlob } from '@/services/files/signedUrls'
import { groupFaces, matchPerson, withFace, findFaces } from '@/services/faces'
import { useUpdatePersonMutation } from '@/store/api/peopleApi'
import { DocumentCard } from '@/components/documents/DocumentCard'
import { PersonDialog } from '@/components/people/PersonDialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

/**
 * Every face found in the documents, grouped by person (like a photo app).
 * A group belongs to a person when its faces were linked to them, or when it
 * looks like the photo of a person.
 */
export function buildFaceGroups(docs, people) {
  const all = []
  for (const doc of docs) {
    for (const [index, face] of (doc.faces || []).entries()) {
      if (Array.isArray(face?.d) && face.d.length === 128) all.push({ ...face, doc, index })
    }
  }
  return groupFaces(all).map((g, i) => {
    const votes = new Map()
    for (const f of g.faces) if (f.person_id) votes.set(f.person_id, (votes.get(f.person_id) || 0) + 1)
    const voted = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    const person = people.find((p) => p.id === voted) || matchPerson(g.center, people)?.person || null
    const docsOf = [...new Map(g.faces.map((f) => [f.doc.id, f.doc])).values()]
    return { key: person ? `p-${person.id}` : `f-${i}`, person, crop: g.faces[0].crop, center: g.center, faces: g.faces, docs: docsOf }
  })
}

/** Documents with a photo whose faces were not looked for yet. */
export function docsWithoutFaceCheck(docs) {
  return docs.filter((d) => d.faces === null && pagePhoto(d))
}

function pagePhoto(doc) {
  const files = doc.files || []
  const image = (kind) => files.filter((f) => f.kind === kind && /^image\//.test(f.mime_type || '')).sort((a, b) => (a.page_number ?? 1) - (b.page_number ?? 1))[0]
  return image('processed') || image('original') || null
}

export function FaceRow({ groups, to }) {
  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0">
      {groups.map((g) => (
        <Link key={g.key} to={to(g)} className="w-20 shrink-0 snap-start text-center">
          <img src={g.person?.custom?.photo || g.crop} alt="" className="size-20 rounded-full border object-cover" />
          <p className={g.person ? 'mt-1.5 truncate text-xs font-medium' : 'mt-1.5 truncate text-xs font-medium text-primary'}>
            {g.person ? g.person.display_name : 'Add name'}
          </p>
          <p className="text-[11px] text-muted-foreground">{g.docs.length}</p>
        </Link>
      ))}
    </div>
  )
}

/** Links every document of a face group to `person` and remembers the face. */
async function assignGroup(workspaceId, group, person, updatePerson) {
  const ids = new Set(group.faces.map((f) => `${f.doc.id}:${f.index}`))
  for (const doc of group.docs) {
    const faces = (doc.faces || []).map((f, i) => (ids.has(`${doc.id}:${i}`) ? { ...f, person_id: person.id } : f))
    // eslint-disable-next-line no-await-in-loop
    await api.patch(`/workspaces/${workspaceId}/documents/${doc.id}/metadata`, { fields: { faces, person_id: person.id } }).catch(() => null)
  }
  await updatePerson({ workspaceId, personId: person.id, custom: withFace(person, { d: group.center, crop: person.custom?.photo ? undefined : group.crop }) }).unwrap().catch(() => null)
}

export function FaceCollectionView({ workspaceId, group, people, onBack, onChanged, personLabel = 'person' }) {
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [updatePerson] = useUpdatePersonMutation()

  const assign = async (person) => {
    if (!person) return
    setBusy(true)
    await assignGroup(workspaceId, group, person, updatePerson)
    setBusy(false)
    toast.success(`${group.docs.length} ${group.docs.length === 1 ? 'document' : 'documents'} added to ${person.display_name}.`)
    onChanged?.()
  }

  return (
    <div className="mx-auto max-w-6xl">
      <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Explore
      </button>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <img src={group.person?.custom?.photo || group.crop} alt="" className="size-20 rounded-full border object-cover" />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold">{group.person ? group.person.display_name : 'Who is this?'}</h1>
          <p className="text-sm text-muted-foreground">{group.docs.length} {group.docs.length === 1 ? 'document' : 'documents'} with this face</p>
          {group.person ? (
            <Link to={`/w/${workspaceId}/people/${group.person.id}`} className="text-sm font-medium text-primary">Open {group.person.display_name}</Link>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setAdding(true)} disabled={busy}><UserPlus /> New {personLabel}</Button>
              {people.length > 0 && (
                <select
                  aria-label="This is"
                  value=""
                  disabled={busy}
                  onChange={(e) => assign(people.find((p) => p.id === e.target.value))}
                  className="h-9 rounded-lg border bg-background px-2 text-sm"
                >
                  <option value="">This is…</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                </select>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {group.docs.map((d) => <DocumentCard key={d.id} document={d} workspaceId={workspaceId} />)}
      </div>
      <PersonDialog open={adding} onOpenChange={setAdding} initial={{ face: { crop: group.crop, d: group.center } }} onSaved={(p) => assign(p)} />
    </div>
  )
}

/** Looks for faces in older documents, one after the other, on this device. */
export function FaceScanBanner({ workspaceId, docs, people, onDone }) {
  const [progress, setProgress] = useState(null) // { done, total }

  const run = async () => {
    setProgress({ done: 0, total: docs.length })
    let found = 0
    for (const [i, doc] of docs.entries()) {
      try {
        const file = pagePhoto(doc)
        // eslint-disable-next-line no-await-in-loop
        const blob = file && (await fetchFileBlob(workspaceId, file.id))
        // eslint-disable-next-line no-await-in-loop
        const faces = blob ? (await findFaces(blob)).slice(0, 6) : []
        const stored = faces.map(({ box, crop, d }) => ({ box, crop, d, person_id: matchPerson(d, people)?.person.id ?? null }))
        found += stored.length
        const fields = { faces: stored }
        const known = stored.find((f) => f.person_id)?.person_id
        if (known && !(doc.people || []).some((p) => p.id === known)) fields.person_id = known
        // eslint-disable-next-line no-await-in-loop
        await api.patch(`/workspaces/${workspaceId}/documents/${doc.id}/metadata`, { fields })
      } catch { /* next document */ }
      setProgress({ done: i + 1, total: docs.length })
    }
    toast.success(found ? `Found ${found} ${found === 1 ? 'face' : 'faces'}.` : 'No faces found.')
    setProgress(null)
    onDone?.()
  }

  if (!docs.length) return null
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-4">
      <ScanFace className="size-6 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Find faces in {docs.length} {docs.length === 1 ? 'document' : 'documents'}</p>
        {progress ? (
          <>
            <p className="text-sm text-muted-foreground">Looking at {progress.done} of {progress.total}… You can keep using the app.</p>
            <Progress className="mt-2" value={(progress.done / Math.max(1, progress.total)) * 100} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Group photos and ID cards by the person on them. Runs on this phone.</p>
        )}
      </div>
      {!progress && <Button size="sm" onClick={run}>Start</Button>}
    </div>
  )
}
