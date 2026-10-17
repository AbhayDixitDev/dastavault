import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScanLine, Upload, PenLine, StickyNote, KeyRound, BellRing, ArrowLeft, ArrowRight, Check, UserPlus, UserRound, Users } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { DOCUMENT_TYPES } from '@/components/documents/documentTypes'
import { PersonDialog } from '@/components/people/PersonDialog'
import { initials } from '@/utils/format'
import { cn } from '@/lib/utils'

/** The things that can be added, as big round tiles. */
const ACTIONS = [
  { key: 'scan', label: 'Scan', hint: 'Camera', icon: ScanLine, tone: 'bg-indigo-500', place: true },
  { key: 'upload', label: 'Upload', hint: 'Files, PDFs', icon: Upload, tone: 'bg-sky-500', place: true },
  { key: 'write', label: 'Write', hint: 'A document', icon: PenLine, tone: 'bg-violet-500', to: 'documents/new' },
  { key: 'note', label: 'Note', hint: 'Quick text', icon: StickyNote, tone: 'bg-amber-500', to: 'notes' },
  { key: 'password', label: 'Password', hint: 'Chaabi', icon: KeyRound, tone: 'bg-emerald-500', to: 'chaabi' },
  { key: 'reminder', label: 'Reminder', hint: 'Expiry dates', icon: BellRing, tone: 'bg-rose-500', to: 'reminders' },
]

/** The most common types first; everything else is under "More types". */
const COMMON_TYPES = ['aadhaar', 'pan', 'passport', 'driving_licence', 'marksheet', 'insurance', 'medical_report', 'bank_statement', 'invoice', 'property', 'vehicle', 'other']

/**
 * What would you like to add? For scans and uploads it then asks whose it is
 * and what kind of document, so it is filed in the right place right away.
 */
export function QuickAddSheet({ open, onOpenChange }) {
  const navigate = useNavigate()
  const { workspaceId, terminology: t } = useWorkspace()
  const { data: people = [] } = useGetPeopleQuery(workspaceId, { skip: !workspaceId || !open })
  const [action, setAction] = useState(null)
  const [personId, setPersonId] = useState('')
  const [addingPerson, setAddingPerson] = useState(false)
  const [type, setType] = useState('')
  const [allTypes, setAllTypes] = useState(false)

  const reset = () => {
    setAction(null)
    setPersonId('')
    setType('')
    setAllTypes(false)
  }

  const close = (value) => {
    onOpenChange(value)
    if (!value) setTimeout(reset, 300)
  }

  const go = (path) => {
    close(false)
    navigate(`/w/${workspaceId}/${path}`)
  }

  const pick = (a) => {
    if (a.place) setAction(a)
    else go(a.to)
  }

  const finish = () => {
    const params = new URLSearchParams()
    if (personId) params.set('person', personId)
    if (type) params.set('type', type)
    const qs = params.toString()
    go(`${action.key === 'scan' ? 'scan' : 'upload'}${qs ? `?${qs}` : ''}`)
  }

  const types = allTypes ? DOCUMENT_TYPES : DOCUMENT_TYPES.filter((d) => COMMON_TYPES.includes(d.key))

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="bottom" className="max-h-[88svh] overflow-y-auto rounded-t-3xl pb-8">
        {!action ? (
          <>
            <SheetHeader>
              <SheetTitle className="font-display text-xl">What would you like to add?</SheetTitle>
              <SheetDescription>Everything you add is private to this workspace.</SheetDescription>
            </SheetHeader>
            <div className="grid grid-cols-3 gap-3 px-4">
              {ACTIONS.map((a) => {
                const Icon = a.icon
                return (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => pick(a)}
                    className="flex flex-col items-center gap-2 rounded-2xl border bg-card p-3 text-center transition active:scale-[0.97] hover:bg-accent"
                  >
                    <span className={cn('flex size-12 items-center justify-center rounded-2xl text-white shadow-md', a.tone)}>
                      <Icon className="size-6" />
                    </span>
                    <span className="text-sm font-semibold leading-tight">{a.label}</span>
                    <span className="-mt-1.5 text-[11px] leading-tight text-muted-foreground">{a.hint}</span>
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <>
            <SheetHeader>
              <button type="button" onClick={reset} className="mb-1 flex w-fit items-center gap-1 text-sm text-muted-foreground">
                <ArrowLeft className="size-4" /> Back
              </button>
              <SheetTitle className="font-display text-xl">Where does it belong?</SheetTitle>
              <SheetDescription>Pick whose document it is and what it is, so it lands in the right place. You can skip this.</SheetDescription>
            </SheetHeader>

            <div className="px-4">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <UserRound className="size-4 text-primary" /> Whose is it?
              </p>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
                <PersonChip active={!personId} onClick={() => setPersonId('')} label="Not sure" icon={<Users className="size-5" />} />
                {people.map((p) => (
                  <PersonChip
                    key={p.id}
                    active={personId === p.id}
                    onClick={() => setPersonId(p.id)}
                    label={p.display_name}
                    icon={p.custom?.photo ? <img src={p.custom.photo} alt="" className="size-full rounded-full object-cover" /> : <span className="text-sm font-semibold">{initials(p.display_name)}</span>}
                  />
                ))}
                <PersonChip active={false} onClick={() => setAddingPerson(true)} label="New" icon={<UserPlus className="size-5" />} />
              </div>
              <PersonDialog open={addingPerson} onOpenChange={setAddingPerson} onSaved={(p) => p?.id && setPersonId(p.id)} />
              {people.length === 0 && (
                <p className="text-xs text-muted-foreground">Add {t.person_label_plural?.toLowerCase() ?? 'people'} to file documents under their names.</p>
              )}

              <p className="mb-2 mt-4 text-sm font-semibold">What is it?</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {types.map((d) => {
                  const Icon = d.icon
                  const active = type === d.key
                  return (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => setType(active ? '' : d.key)}
                      className={cn(
                        'relative flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-center text-xs transition',
                        active ? 'border-primary bg-primary/10 ring-2 ring-primary/40' : 'bg-card hover:bg-accent',
                      )}
                    >
                      {active && <Check className="absolute right-1.5 top-1.5 size-3.5 text-primary" />}
                      <span className={cn('flex size-9 items-center justify-center rounded-lg', d.color)}>
                        <Icon className="size-5" />
                      </span>
                      <span className="leading-tight">{d.label}</span>
                    </button>
                  )
                })}
              </div>
              {!allTypes && (
                <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setAllTypes(true)}>
                  More types
                </Button>
              )}

              <Button className="mt-4 h-12 w-full rounded-xl text-base" onClick={finish}>
                {action.key === 'scan' ? 'Open camera' : 'Choose files'} <ArrowRight />
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function PersonChip({ active, onClick, label, icon }) {
  return (
    <button type="button" onClick={onClick} className="flex w-16 shrink-0 flex-col items-center gap-1 text-center">
      <Avatar className={cn('size-12 transition', active && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}>
        <AvatarFallback className={cn(active && 'bg-primary text-primary-foreground')}>{icon}</AvatarFallback>
      </Avatar>
      <span className={cn('w-full truncate text-xs', active ? 'font-semibold text-primary' : 'text-muted-foreground')}>{label}</span>
    </button>
  )
}
