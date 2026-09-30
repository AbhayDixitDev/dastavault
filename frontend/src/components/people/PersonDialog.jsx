import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useCreatePersonMutation, useUpdatePersonMutation } from '@/store/api/peopleApi'
import { useWorkspace } from '@/hooks/useWorkspace'
import { RELATION_LABELS_FOR_PERSON } from '@/constants/relations'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from '@/components/common/ErrorBox'

const schema = z.object({
  display_name: z.string().min(1, 'Please type a name.'),
  relation_label: z.string().optional(),
  email: z.string().email('Please enter a valid email.').optional().or(z.literal('')),
  phone: z.string().optional(),
  date_of_birth: z.string().optional(),
  notes: z.string().optional(),
})

const EMPTY = { display_name: '', relation_label: '', email: '', phone: '', date_of_birth: '', notes: '' }

/** Create or edit a person. Pass `person` to edit. */
export function PersonDialog({ open, onOpenChange, person, onSaved }) {
  const { workspaceId, terminology: t } = useWorkspace()
  const [createPerson, { isLoading: creating }] = useCreatePersonMutation()
  const [updatePerson, { isLoading: updating }] = useUpdatePersonMutation()
  const busy = creating || updating

  const form = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY })
  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = form
  const relation = watch('relation_label')

  useEffect(() => {
    if (open) {
      reset(person ? { ...EMPTY, ...Object.fromEntries(Object.entries(person).filter(([k]) => k in EMPTY).map(([k, v]) => [k, v ?? ''])) } : EMPTY)
    }
  }, [open, person, reset])

  const onSubmit = async (values) => {
    const body = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === '' ? null : v]))
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
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{person ? `Edit ${t.person_label.toLowerCase()}` : `Add ${t.person_label.toLowerCase()}`}</DialogTitle>
          <DialogDescription>Documents can belong to this {t.person_label.toLowerCase()}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy && <Spinner />} {person ? 'Save' : 'Add'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
