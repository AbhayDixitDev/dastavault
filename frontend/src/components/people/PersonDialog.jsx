import { useEffect, useRef, useState } from 'react'
import { Camera, ChevronDown, ImagePlus, Trash2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useCreatePersonMutation, useUpdatePersonMutation } from '@/store/api/peopleApi'
import { useWorkspace } from '@/hooks/useWorkspace'
import { RELATION_LABELS_FOR_PERSON } from '@/constants/relations'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { errorMessage } from '@/components/common/ErrorBox'
import { findFaces, withFace } from '@/services/faces'
import { ProfileCropper, loadPhoto } from './ProfileCropper'

const schema = z.object({
  display_name: z.string().min(1, 'Please type a name.'),
  relation_label: z.string().optional(),
  email: z.string().email('Please enter a valid email.').optional().or(z.literal('')),
  phone: z.string().optional(),
  date_of_birth: z.string().optional(),
  notes: z.string().optional(),
})

const EMPTY = { display_name: '', relation_label: '', email: '', phone: '', date_of_birth: '', notes: '' }

/**
 * Create or edit a person. Pass `person` to edit.
 * `initial` prefills a new person: { display_name, face: { crop, d } } (a face found in a document).
 */
export function PersonDialog({ open, onOpenChange, person, onSaved, initial }) {
  const { workspaceId, terminology: t } = useWorkspace()
  const [createPerson, { isLoading: creating }] = useCreatePersonMutation()
  const [updatePerson, { isLoading: updating }] = useUpdatePersonMutation()
  const busy = creating || updating

  const form = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY })
  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = form
  const relation = watch('relation_label')
  const listed = RELATION_LABELS_FOR_PERSON.filter((l) => l !== 'Other')
  // "Other…" lets them type their own; a typed one that is not in the list shows the same way.
  const [ownRelation, setOwnRelation] = useState(false)
  const typedOwn = ownRelation || Boolean(relation && !listed.includes(relation))
  const [more, setMore] = useState(false)
  const [face, setFace] = useState(null) // { crop, d? } new photo
  const [photoBusy, setPhotoBusy] = useState(false)
  const cameraRef = useRef(null)
  const galleryRef = useRef(null)

  const [cropping, setCropping] = useState(null) // { photo, face } face: undefined while looking, null when none

  // A photo is first fitted into the round frame; the frame moves onto the face once it is found.
  const pickPhoto = async (file) => {
    if (!file) return
    setPhotoBusy(true)
    let photo
    try {
      photo = await loadPhoto(file)
    } catch {
      toast.error('This photo could not be opened. Please choose another one.')
      return
    } finally {
      setPhotoBusy(false)
    }
    setCropping({ photo, face: undefined })
    const [found] = await findFaces(photo, { minScore: 0.3 })
    setCropping((c) => (c?.photo === photo ? { ...c, face: found?.box ?? null } : c))
  }

  // The fitted photo becomes the profile photo; its face fingerprint is kept when the face is clear.
  const applyCropped = async (canvas) => {
    setCropping(null)
    setPhotoBusy(true)
    const [found] = await findFaces(canvas, { minScore: 0.3 })
    setPhotoBusy(false)
    const small = document.createElement('canvas')
    small.width = 160
    small.height = 160
    small.getContext('2d').drawImage(canvas, 0, 0, 160, 160)
    const crop = small.toDataURL('image/jpeg', 0.8)
    if (found) {
      setFace({ crop, d: found.d })
    } else {
      setFace({ crop })
      toast('Photo saved. The face was not clear enough to recognise them in documents; a clearer, front-facing photo helps.')
    }
  }

  useEffect(() => {
    if (open) {
      reset(person ? { ...EMPTY, ...Object.fromEntries(Object.entries(person).filter(([k]) => k in EMPTY).map(([k, v]) => [k, v ?? ''])) } : { ...EMPTY, display_name: initial?.display_name || '' })
      setFace(person ? null : initial?.face || null)
      setOwnRelation(false)
      setMore(Boolean(person && (person.email || person.phone || person.date_of_birth || person.notes)))
    }
  }, [open, person, reset]) // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = async (values) => {
    const body = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === '' ? null : v]))
    // The photo and the face fingerprint are kept with the person, to find them in documents.
    if (face) body.custom = withFace(person, face)
    try {
      const saved = person
        ? await updatePerson({ workspaceId, personId: person.id, ...body }).unwrap()
        : await createPerson({ workspaceId, ...body }).unwrap()
      toast.success(person ? 'Saved.' : `${saved.display_name} added.`)
      onOpenChange(false)
      onSaved?.(saved)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{person ? `Edit ${t.person_label.toLowerCase()}` : `Add ${t.person_label.toLowerCase()}`}</DialogTitle>
          <DialogDescription className="sr-only">Documents can belong to this {t.person_label.toLowerCase()}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogBody className="flex flex-col gap-4 py-1">
          {/* The photo: tap it to take, choose or remove one. */}
          <div className="flex flex-col items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Photo" className="relative size-24 overflow-hidden rounded-full border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {(face?.crop || person?.custom?.photo) ? (
                    <img src={face?.crop || person?.custom?.photo} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="flex size-full items-center justify-center text-muted-foreground"><Camera className="size-8" /></span>
                  )}
                  {photoBusy && <span className="absolute inset-0 flex items-center justify-center bg-black/40"><Spinner className="text-white" /></span>}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                <DropdownMenuItem onSelect={() => cameraRef.current?.click()}><Camera /> Take photo</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => galleryRef.current?.click()}><ImagePlus /> Choose photo</DropdownMenuItem>
                {face && <DropdownMenuItem variant="destructive" onSelect={() => setFace(null)}><Trash2 /> Remove</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground">{(face?.crop || person?.custom?.photo) ? 'Tap to change' : 'Add a photo to find their face in documents'}</p>
            <input ref={cameraRef} type="file" accept="image/*" capture="user" hidden onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = '' }} />
            <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = '' }} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="display_name">Name</Label>
            <Input id="display_name" {...register('display_name')} />
            {errors.display_name && <p className="text-sm text-destructive">{errors.display_name.message}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="relation">Who is this to you?</Label>
            <select
              id="relation"
              value={typedOwn ? '__own' : relation || ''}
              onChange={(e) => {
                const v = e.target.value
                setOwnRelation(v === '__own')
                setValue('relation_label', v === '__own' ? '' : v)
              }}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-base md:text-sm"
            >
              <option value="">Choose…</option>
              {listed.map((label) => <option key={label} value={label}>{label}</option>)}
              <option value="__own">Other…</option>
            </select>
            {typedOwn ? <Input placeholder="Type it, e.g. Uncle, Friend" autoFocus={ownRelation} {...register('relation_label')} /> : <input type="hidden" {...register('relation_label')} />}
          </div>
          {more ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" {...register('email')} />
                  {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" type="tel" {...register('phone')} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="dob">Date of birth</Label>
                <Input id="dob" type="date" {...register('date_of_birth')} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" rows={2} {...register('notes')} />
              </div>
            </>
          ) : (
            <button type="button" onClick={() => setMore(true)} className="flex items-center gap-1 self-start text-sm font-medium text-primary">
              <ChevronDown className="size-4" /> More details (phone, email, birthday)
            </button>
          )}
          </DialogBody>
          <DialogFooter className="flex-row">
            <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="flex-1 sm:flex-none" disabled={busy}>{busy && <Spinner />} {person ? 'Save' : 'Add'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <Dialog open={!!cropping} onOpenChange={(v) => { if (!v) setCropping(null) }}>
        <DialogContent
          showCloseButton={false}
          className="top-0 left-0 h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 rounded-none border-0 bg-black p-0 sm:max-w-none"
        >
          <DialogTitle className="sr-only">Fit the photo</DialogTitle>
          {cropping && <ProfileCropper photo={cropping.photo} face={cropping.face} onDone={applyCropped} onCancel={() => setCropping(null)} />}
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
