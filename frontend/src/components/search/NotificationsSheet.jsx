import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, BellRing, CalendarClock, CheckCheck, Share2, Upload, UserPlus } from 'lucide-react'
import { useGetNotificationsQuery, useLazyGetNotificationsQuery, useMarkAllNotificationsReadMutation, useMarkNotificationReadMutation } from '@/store/api/activityApi'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorBox } from '@/components/common/ErrorBox'
import { fromNow } from '@/utils/format'
import { cn } from '@/lib/utils'

const ICONS = {
  reminder: CalendarClock,
  share: Share2,
  invite: UserPlus,
  upload: Upload,
}

function iconFor(type = '') {
  const key = Object.keys(ICONS).find((k) => type.toLowerCase().includes(k))
  return key ? ICONS[key] : Bell
}

/** Where a notification leads when tapped, based on its `data`. */
function targetFor(n) {
  const d = n?.data ?? {}
  const ws = d.workspace_id ?? n?.workspace_id
  if (d.url) return d.url
  if (d.document_id && ws) return `/w/${ws}/documents/${d.document_id}`
  if (d.album_id && ws) return `/w/${ws}/albums/${d.album_id}`
  if (d.note_id && ws) return `/w/${ws}/notes/${d.note_id}`
  if (d.invite_token) return `/invite/${d.invite_token}`
  if (n?.type?.includes('reminder') && ws) return `/w/${ws}/reminders`
  return null
}

/** Unread count for a bell badge; refreshes every minute. */
export function useUnreadNotificationsCount(workspaceId) {
  const { data } = useGetNotificationsQuery({ workspaceId, unread: true, limit: 1 }, { pollingInterval: 60_000 })
  return data?.unread_count ?? 0
}

/**
 * Notification centre as a side sheet (right on desktop, bottom on mobile).
 * The integrator opens it from the TopBar bell.
 */
export function NotificationsSheet({ open, onOpenChange, workspaceId, side = 'right' }) {
  const navigate = useNavigate()
  const { data, isLoading, error, refetch } = useGetNotificationsQuery({ workspaceId, limit: 50 }, { skip: !open })
  const [loadMore, { isFetching: loadingMore }] = useLazyGetNotificationsQuery()
  const [extra, setExtra] = useState([])
  const [cursor, setCursor] = useState(null)
  const [markRead] = useMarkNotificationReadMutation()
  const [markAll, { isLoading: markingAll }] = useMarkAllNotificationsReadMutation()

  useEffect(() => {
    setExtra([])
    setCursor(data?.next_cursor ?? null)
  }, [data])

  const items = [...(data?.items ?? []), ...extra]
  const unread = items.filter((n) => !n.read_at).length

  const openItem = async (n) => {
    if (!n.read_at) markRead({ id: n.id })
    const to = targetFor(n)
    if (to) {
      onOpenChange(false)
      navigate(to)
    }
  }

  const more = async () => {
    if (!cursor) return
    const page = await loadMore({ workspaceId, limit: 50, cursor }).unwrap()
    setExtra((prev) => [...prev, ...page.items])
    setCursor(page.next_cursor)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} className={cn(side === 'bottom' ? 'max-h-[85svh]' : 'w-full sm:max-w-md')}>
        <SheetHeader className="pr-10">
          <SheetTitle className="flex items-center gap-2">
            <BellRing className="size-4" /> Notifications
          </SheetTitle>
          <SheetDescription>{unread ? `${unread} unread` : 'You are all caught up.'}</SheetDescription>
        </SheetHeader>

        {unread > 0 && (
          <div className="px-4">
            <Button size="sm" variant="outline" onClick={() => markAll()} disabled={markingAll}>
              <CheckCheck /> Mark all as read
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto scroll-inside px-4 pb-4">
          {error && <ErrorBox error={error} onRetry={refetch} className="mb-3" />}
          {isLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={Bell} title="Nothing here yet" description="Reminders, shares and invites will show up here." className="py-8" />
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((n) => {
                const Icon = iconFor(n.type)
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={cn('flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50', !n.read_at && 'bg-primary/5')}
                    >
                      <span className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full', n.read_at ? 'bg-muted text-muted-foreground' : 'bg-primary/15 text-primary')}>
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-sm', !n.read_at && 'font-medium')}>{n.title}</span>
                        {n.body && <span className="block text-xs text-muted-foreground line-clamp-2">{n.body}</span>}
                        <span className="block text-[11px] text-muted-foreground">{fromNow(n.created_at)}</span>
                      </span>
                      {!n.read_at && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {cursor && (
            <div className="mt-3 flex justify-center">
              <Button variant="outline" size="sm" onClick={more} disabled={loadingMore}>
                {loadingMore ? 'Loading...' : 'Show older'}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
