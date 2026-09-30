import { useEffect, useState } from 'react'
import { FileText, Search } from 'lucide-react'
import dayjs from 'dayjs'
import { toast } from 'sonner'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useCreateReminderMutation, useUpdateReminderMutation } from '@/store/api/remindersApi'
import { DocumentPicker } from '@/components/search/DocumentPicker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { errorMessage } from '@/components/common/ErrorBox'

const CHANNELS = [
  { value: 'app', label: 'In the app' },
  { value: 'email', label: 'By email' },
  { value: 'both', label: 'App and email' },
]

function toDateInput(v) {
  return v ? dayjs(v).format('YYYY-MM-DD') : ''
}

/**
 * Create (or edit) a reminder. Reusable from the document page:
 *   <ReminderDialog open onOpenChange documentId={doc.id} documentName={doc.name} defaultDate={doc.expiry_date} />
 * Pass `reminder` to edit its title, date and channel.
 */
export function ReminderDialog({ open, onOpenChange, documentId, documentName, defaultTitle, defaultDate, field, reminder, onSaved }) {
  const { workspaceId } = useWorkspace()
  const [createReminder, { isLoading: creating }] = useCreateReminderMutation()
  const [updateReminder, { isLoading: updating }] = useUpdateReminderMutation()
  const [doc, setDoc] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [channel, setChannel] = useState('app')
  const busy = creating || updating

  useEffect(() => {
    if (!open) return
    if (reminder) {
      setDoc({ id: reminder.document_id, name: reminder.document_name })
      setTitle(reminder.title ?? '')
      setDate(toDateInput(reminder.remind_at))
      setChannel(reminder.channel ?? 'app')
      return
    }
    setDoc(documentId ? { id: documentId, name: documentName } : null)
    setTitle(defaultTitle ?? (documentName ? `${documentName} is expiring` : ''))
    setDate(toDateInput(defaultDate ? dayjs(defaultDate).subtract(7, 'day') : dayjs().add(7, 'day')))
    setChannel('app')
  }, [open, reminder, documentId, documentName, defaultTitle, defaultDate])

  const submit = async (e) => {
    e.preventDefault()
    if (!reminder && !doc?.id) {
      toast.error('Choose a document first.')
      return
    }
    if (!title.trim() || !date) return
    const remind_at = dayjs(date).hour(9).minute(0).second(0).toISOString()
    try {
      if (reminder) {
        await updateReminder({ workspaceId, reminderId: reminder.id, title: title.trim(), remind_at, channel }).unwrap()
        toast.success('Reminder updated.')
      } else {
        await createReminder({ workspaceId, document_id: doc.id, title: title.trim(), remind_at, channel, field: field || undefined }).unwrap()
        toast.success(`We will remind you on ${dayjs(date).format('D MMM YYYY')}.`)
      }
      onOpenChange(false)
      onSaved?.()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{reminder ? 'Edit reminder' : 'Remind me'}</DialogTitle>
            <DialogDescription>{reminder ? 'Change when and how you want to be reminded.' : 'Pick a document, a date and how you want to hear about it.'}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label>Document</Label>
            {doc ? (
              <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{doc.name || 'Document'}</span>
                {!documentId && !reminder && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPickerOpen(true)}>
                    Change
                  </Button>
                )}
              </div>
            ) : (
              <Button type="button" variant="outline" className="justify-start" onClick={() => setPickerOpen(true)}>
                <Search /> Choose a document
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="reminder-title">What is it about?</Label>
            <Input id="reminder-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Renew car insurance" required />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="reminder-date">Remind me on</Label>
              <Input id="reminder-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label>How</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !title.trim() || !date || (!reminder && !doc)}>
              {reminder ? 'Save' : 'Set reminder'}
            </Button>
          </DialogFooter>
        </form>
        <DocumentPicker open={pickerOpen} onOpenChange={setPickerOpen} workspaceId={workspaceId} onPick={(docs) => docs[0] && setDoc(docs[0])} />
      </DialogContent>
    </Dialog>
  )
}
