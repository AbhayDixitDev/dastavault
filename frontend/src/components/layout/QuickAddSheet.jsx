import { useNavigate } from 'react-router-dom'
import { ScanLine, Upload, PenLine, StickyNote, KeyRound, BellRing } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

/** The things that can be added, as big round tiles. */
const ACTIONS = [
  { key: 'scan', label: 'Scan', hint: 'Camera', icon: ScanLine, tone: 'bg-indigo-500', to: 'scan' },
  // Opens the file chooser at once; whose it is and what it is are read from the files.
  { key: 'upload', label: 'Upload', hint: 'Files, PDFs', icon: Upload, tone: 'bg-sky-500', to: 'upload?pick=1' },
  { key: 'write', label: 'Write', hint: 'A document', icon: PenLine, tone: 'bg-violet-500', to: 'documents/new' },
  { key: 'note', label: 'Note', hint: 'Quick text', icon: StickyNote, tone: 'bg-amber-500', to: 'notes' },
  { key: 'password', label: 'Password', hint: 'Chaabi', icon: KeyRound, tone: 'bg-emerald-500', to: 'chaabi' },
  { key: 'reminder', label: 'Reminder', hint: 'Expiry dates', icon: BellRing, tone: 'bg-rose-500', to: 'reminders' },
]

/**
 * What would you like to add? A tap goes straight there: scans and uploads
 * are filed from what is read on them (name, type, people, faces), which can
 * be changed before they are saved.
 */
export function QuickAddSheet({ open, onOpenChange }) {
  const navigate = useNavigate()
  const { workspaceId } = useWorkspace()

  const go = (path) => {
    onOpenChange(false)
    navigate(`/w/${workspaceId}/${path}`)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88svh] overflow-y-auto rounded-t-3xl pb-8">
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
                onClick={() => go(a.to)}
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
      </SheetContent>
    </Sheet>
  )
}
