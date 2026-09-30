import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlarmClock, Bell, BellPlus, Check, ChevronDown, FileText, MoreHorizontal, Pencil, Plus, Trash2, CalendarClock } from 'lucide-react'
import dayjs from 'dayjs'
import { toast } from 'sonner'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useGetRemindersQuery, useGetExpiringQuery, useUpdateReminderMutation, useDeleteReminderMutation, useCreateAutoRemindersMutation } from '@/store/api/remindersApi'
import { ReminderDialog } from '@/components/reminders/ReminderDialog'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ErrorBox, errorMessage } from '@/components/common/ErrorBox'
import { formatDate, fromNow } from '@/utils/format'
import { cn } from '@/lib/utils'

const STATUS = {
  pending: { label: 'Coming up', variant: 'secondary' },
  snoozed: { label: 'Snoozed', variant: 'warning' },
  sent: { label: 'Sent', variant: 'success' },
  done: { label: 'Done', variant: 'outline' },
}

function DaysLeftChip({ days }) {
  if (days === null || days === undefined) return null
  if (days < 0) return <Badge variant="destructive">Expired {Math.abs(days)} day{Math.abs(days) === 1 ? '' : 's'} ago</Badge>
  if (days === 0) return <Badge variant="destructive">Expires today</Badge>
  if (days <= 7) return <Badge variant="destructive">{days} day{days === 1 ? '' : 's'} left</Badge>
  return <Badge variant="warning">{days} days left</Badge>
}

function groupExpiring(docs) {
  const week = []
  const month = []
  const later = []
  for (const d of docs) {
    const n = d.days_left ?? dayjs(d.expiry_date).diff(dayjs(), 'day')
    const item = { ...d, days_left: n }
    if (n <= 7) week.push(item)
    else if (n <= 30) month.push(item)
    else later.push(item)
  }
  const by = (a, b) => a.days_left - b.days_left
  return [
    { key: 'week', title: 'This week', items: week.sort(by) },
    { key: 'month', title: 'This month', items: month.sort(by) },
    { key: 'later', title: 'Later', items: later.sort(by) },
  ].filter((g) => g.items.length)
}

export function RemindersPage() {
  const { workspaceId, can } = useWorkspace()
  const canEdit = can('editor')
  const { data: expiring = [], isLoading: loadingExpiring, error: expiringError, refetch: refetchExpiring } = useGetExpiringQuery({ workspaceId, days: 60 }, { skip: !workspaceId })
  const { data: reminders = [], isLoading: loadingReminders, error: remindersError, refetch: refetchReminders } = useGetRemindersQuery({ workspaceId, upcoming_days: 365 }, { skip: !workspaceId })
  const [updateReminder] = useUpdateReminderMutation()
  const [deleteReminder] = useDeleteReminderMutation()
  const [autoReminders] = useCreateAutoRemindersMutation()
  const [dialog, setDialog] = useState(null) // { documentId, documentName, defaultDate } | { reminder } | {}
  const [showDone, setShowDone] = useState(false)

  const groups = useMemo(() => groupExpiring(expiring), [expiring])
  const { open, done } = useMemo(() => {
    const sorted = [...reminders].sort((a, b) => new Date(a.remind_at) - new Date(b.remind_at))
    return { open: sorted.filter((r) => r.status !== 'done'), done: sorted.filter((r) => r.status === 'done') }
  }, [reminders])

  const snooze = async (r) => {
    try {
      const next = dayjs(r.remind_at).isAfter(dayjs()) ? dayjs(r.remind_at).add(7, 'day') : dayjs().add(7, 'day')
      await updateReminder({ workspaceId, reminderId: r.id, remind_at: next.toISOString(), status: 'snoozed' }).unwrap()
      toast.success(`Snoozed until ${next.format('D MMM')}.`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const markDone = async (r) => {
    try {
      await updateReminder({ workspaceId, reminderId: r.id, status: 'done' }).unwrap()
      toast.success('Marked as done.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const remove = async (r) => {
    try {
      await deleteReminder({ workspaceId, reminderId: r.id }).unwrap()
      toast.success('Reminder deleted.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const auto = async (doc) => {
    try {
      const made = await autoReminders({ workspaceId, documentId: doc.id }).unwrap()
      toast.success(made.length ? `Set ${made.length} reminders for "${doc.name}".` : `Reminders set for "${doc.name}".`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Reminders"
        description="Never miss a renewal. We tell you before things expire."
        actions={
          canEdit && (
            <Button onClick={() => setDialog({})}>
              <Plus /> New reminder
            </Button>
          )
        }
      />

      {/* Expiring soon */}
      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <CalendarClock className="size-5 text-primary" /> Expiring soon
        </h2>
        {expiringError && <ErrorBox error={expiringError} onRetry={refetchExpiring} />}
        {loadingExpiring ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nothing expires in the next 60 days. Add expiry dates to documents to see them here.</p>
        ) : (
          groups.map((g) => (
            <div key={g.key} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.title}</h3>
              <ul className="flex flex-col gap-1.5">
                {g.items.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <FileText className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link to={`/w/${workspaceId}/documents/${d.id}`} className="block truncate font-medium hover:underline">
                        {d.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">Expires {formatDate(d.expiry_date)}</p>
                    </div>
                    <DaysLeftChip days={d.days_left} />
                    {canEdit && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Reminder options for ${d.name}`}>
                            <BellPlus />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDialog({ documentId: d.id, documentName: d.name, defaultDate: d.expiry_date, field: 'expiry_date' })}>
                            <Bell /> Remind me on a date
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => auto(d)}>
                            <AlarmClock /> Remind 30, 7 and 1 day before
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {/* Your reminders */}
      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Bell className="size-5 text-primary" /> Your reminders
        </h2>
        {remindersError && <ErrorBox error={remindersError} onRetry={refetchReminders} />}
        {loadingReminders ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : open.length === 0 && done.length === 0 ? (
          <EmptyState icon={Bell} title="No reminders yet" description="Set one for a renewal, a payment or any date you do not want to forget." action={canEdit && <Button onClick={() => setDialog({})}><Plus /> New reminder</Button>} />
        ) : (
          <>
            {open.length === 0 && <p className="text-sm text-muted-foreground">All done. Nothing is coming up.</p>}
            <ul className="flex flex-col gap-1.5">
              {open.map((r) => (
                <ReminderRow key={r.id} r={r} workspaceId={workspaceId} canEdit={canEdit} onSnooze={snooze} onDone={markDone} onDelete={remove} onEdit={(x) => setDialog({ reminder: x })} />
              ))}
            </ul>
            {done.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <button type="button" onClick={() => setShowDone((s) => !s)} className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground">
                  <ChevronDown className={cn('size-4 transition-transform', showDone && 'rotate-180')} /> {done.length} done
                </button>
                {showDone && (
                  <ul className="flex flex-col gap-1.5 opacity-70">
                    {done.map((r) => (
                      <ReminderRow key={r.id} r={r} workspaceId={workspaceId} canEdit={canEdit} onDelete={remove} />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <ReminderDialog open={Boolean(dialog)} onOpenChange={(o) => !o && setDialog(null)} documentId={dialog?.documentId} documentName={dialog?.documentName} defaultDate={dialog?.defaultDate} field={dialog?.field} reminder={dialog?.reminder} />
    </div>
  )
}

function ReminderRow({ r, workspaceId, canEdit, onSnooze, onDone, onDelete, onEdit }) {
  const s = STATUS[r.status] ?? STATUS.pending
  const overdue = r.status !== 'done' && dayjs(r.remind_at).isBefore(dayjs())
  return (
    <li className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', r.status === 'done' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary')}>
        {r.status === 'done' ? <Check className="size-5" /> : <Bell className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('truncate font-medium', r.status === 'done' && 'line-through')}>{r.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {r.document_id ? (
            <Link to={`/w/${workspaceId}/documents/${r.document_id}`} className="hover:underline">
              {r.document_name || 'Document'}
            </Link>
          ) : null}
          {r.document_id ? ' - ' : ''}
          <span title={dayjs(r.remind_at).format('D MMM YYYY')}>{overdue ? `was due ${fromNow(r.remind_at)}` : `on ${formatDate(r.remind_at)} (${fromNow(r.remind_at)})`}</span>
          {r.channel && r.channel !== 'app' ? ` - ${r.channel === 'both' ? 'app and email' : 'email'}` : ''}
        </p>
      </div>
      <Badge variant={overdue ? 'destructive' : s.variant}>{overdue ? 'Due' : s.label}</Badge>
      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Options for ${r.title}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onDone && (
              <DropdownMenuItem onClick={() => onDone(r)}>
                <Check /> Mark as done
              </DropdownMenuItem>
            )}
            {onSnooze && (
              <DropdownMenuItem onClick={() => onSnooze(r)}>
                <AlarmClock /> Snooze 7 days
              </DropdownMenuItem>
            )}
            {onEdit && (
              <DropdownMenuItem onClick={() => onEdit(r)}>
                <Pencil /> Edit
              </DropdownMenuItem>
            )}
            {(onDone || onSnooze || onEdit) && <DropdownMenuSeparator />}
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(r)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  )
}
