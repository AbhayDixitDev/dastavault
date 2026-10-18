import { useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, X } from 'lucide-react'
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
import { errorMessage } from '@/components/common/ErrorBox'
import { findFaces, withFace } from '@/services/faces'
import { ProfileCropper } from './ProfileCropper'

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
  const [face, setFace] = useState(null) // { crop, d? } new photo
  const [photoBusy, setPhotoBusy] = useState(false)
  const cameraRef = useRef(null)
  const galleryRef = useRef(null)

  const [cropping, setCropping] = useState(null) // { file, face }

  // A photo is first fitted into the round frame (placed on the face when one is found).
  const pickPhoto = async (file) => {
    if (!file) return
    setPhotoBusy(true)
    const [found] = await findFaces(file, { minScore: 0.3 })
    setPhotoBusy(false)
    setCropping({ file, face: found?.box ?? null })
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
          <DialogDescription>Documents can belong to this {t.person_label.toLowerCase()}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogBody className="flex flex-col gap-4 py-1">
          <div className="flex items-center gap-4">
            <div className="relative size-20 shrink-0 overflow-hidden rounded-full border bg-muted">
              {(face?.crop || person?.custom?.photo) ? (
                <img src={face?.crop || person?.custom?.photo} alt="" className="size-full object-cover" />
              ) : (
                <span className="flex size-full items-center justify-center text-muted-foreground"><Camera className="size-7" /></span>
              )}
              {photoBusy && <span className="absolute inset-0 flex items-center justify-center bg-black/40"><Spinner className="text-white" /></span>}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Photo</p>
              <p className="text-xs text-muted-foreground">With a photo, their face is recognised on ID cards and photos you add.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => cameraRef.current?.click()}><Camera /> Take photo</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => galleryRef.current?.click()}><ImagePlus /> Choose</Button>
                {face && <Button type="button" size="sm" variant="ghost" onClick={() => setFace(null)}><X /> Remove</Button>}
              </div>
              <input ref={cameraRef} type="file" accept="image/*" capture="user" hidden onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = '' }} />
              <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = '' }} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="display_name">Name</Label>
            <Input id="display_name" autoFocus {...register('display_name')} />
            {errors.display_name && <p className="text-sm text-destructive">{errors.display_name.message}</p>}
          </div>
          <div className="grid gap-2">
            <Label>Who is this to you?</Label>
            <div className="flex flex-wrap gap-2">
              {RELATION_LABELS_FOR_PERSON.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setValue('relation_label', relation === label ? '' : label)}
                  className={
                    relation === label
                      ? 'rounded-full bg-primary px-3 py-1 text-sm text-primary-foreground'
                      : 'rounded-full border px-3 py-1 text-sm hover:bg-accent'
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <Input placeholder="Or type your own" {...register('relation_label')} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="email">Email (optional)</Label>
              <Input id="email" type="email" {...register('email')} />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">Phone (optional)</Label>
              <Input id="phone" type="tel" {...register('phone')} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dob">Date of birth (optional)</Label>
            <Input id="dob" type="date" {...register('date_of_birth')} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea id="notes" rows={2} {...register('notes')} />
          </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy && <Spinner />} {person ? 'Save' : 'Add'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <Dialog open={!!cropping} onOpenChange={(v) => { if (!v) setCropping(null) }}>
        <DialogContent
          showCloseButton={false}
          className="top-0 left-0 h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 rounded-none border-0 bg-black p-0 sm:max-w-none"
        >
          <DialogTitle className="sr-only">Fit the photo</DialogTitle>
          {cropping && <ProfileCropper file={cropping.file} face={cropping.face} onDone={applyCropped} onCancel={() => setCropping(null)} />}
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
