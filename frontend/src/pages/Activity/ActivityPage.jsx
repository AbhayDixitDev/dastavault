import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, FileText, Users, FolderTree, UserCircle, Settings2, X } from 'lucide-react'
import dayjs from 'dayjs'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useLazyGetActivityQuery } from '@/store/api/activityApi'
import { useGetMembersQuery } from '@/store/api/membersApi'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorBox } from '@/components/common/ErrorBox'
import { fromNow, initials } from '@/utils/format'

/** Known action keys from the Worker, in plain words. */
const ACTIONS = [
  ['created', 'Added a document'],
  ['file_added', 'Added a file'],
  ['version_uploaded', 'Uploaded a new version'],
  ['version_restored', 'Restored a version'],
  ['details_edited', 'Edited details'],
  ['edited', 'Edited'],
  ['text_extracted', 'Read text'],
  ['deleted', 'Moved to trash'],
  ['restored', 'Restored'],
  ['purged', 'Deleted for good'],
  ['person.created', 'Added a person'],
  ['person.updated', 'Updated a person'],
  ['person.deleted', 'Removed a person'],
  ['person.restored', 'Restored a person'],
  ['person.group_added', 'Added a person to a group'],
  ['person.group_removed', 'Removed a person from a group'],
  ['relationship.created', 'Added a relationship'],
  ['relationship.deleted', 'Removed a relationship'],
  ['group.created', 'Created a group'],
  ['group.updated', 'Updated a group'],
  ['group.deleted', 'Deleted a group'],
  ['invite.sent', 'Sent an invite'],
  ['invite.accepted', 'Accepted an invite'],
  ['invite.revoked', 'Cancelled an invite'],
  ['member.role_changed', 'Changed a role'],
  ['member.removed', 'Removed a member'],
  ['workspace.created', 'Created the workspace'],
  ['workspace.updated', 'Updated workspace settings'],
  ['workspace.terminology_updated', 'Changed the wording'],
  ['workspace.deleted', 'Deleted the workspace'],
]
const ACTION_LABELS = Object.fromEntries(ACTIONS)
const ALL = '__all__'

function actionLabel(key = '') {
  return ACTION_LABELS[key] ?? key.replace(/[._]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

function entityHref(workspaceId, item) {
  const t = item.entity_type
  const id = item.entity_id
  if (!id) return null
  if (t === 'document') return `/w/${workspaceId}/documents/${id}`
  if (t === 'person') return `/w/${workspaceId}/people/${id}`
  if (t === 'group') return `/w/${workspaceId}/groups/${id}`
  if (t === 'album') return `/w/${workspaceId}/albums/${id}`
  if (t === 'note') return `/w/${workspaceId}/notes/${id}`
  return null
}

function EntityIcon({ type }) {
  const Icon = type === 'document' ? FileText : type === 'person' ? UserCircle : type === 'group' ? FolderTree : type === 'member' || type === 'invite' ? Users : type === 'workspace' ? Settings2 : Activity
  return <Icon className="size-3.5" aria-hidden="true" />
}

function dayLabel(iso) {
  const d = dayjs(iso)
  if (d.isSame(dayjs(), 'day')) return 'Today'
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return 'Yesterday'
  return d.format('D MMM YYYY')
}

export function ActivityPage() {
  const { workspaceId } = useWorkspace()
  const { data: members = [] } = useGetMembersQuery(workspaceId, { skip: !workspaceId })
  const [fetchPage, { isFetching, error }] = useLazyGetActivityQuery()
  const [items, setItems] = useState([])
  const [cursor, setCursor] = useState(null)
  const [done, setDone] = useState(false)
  const [actor, setActor] = useState(ALL)
  const [action, setAction] = useState(ALL)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const sentinelRef = useRef(null)
  const loadingRef = useRef(false)

  const serverArgs = useMemo(
    () => ({ workspaceId, action: action === ALL ? undefined : action, actor_id: actor === ALL ? undefined : actor, date_from: from || undefined, date_to: to || undefined }),
    [workspaceId, action, actor, from, to],
  )

  const load = useCallback(
    async (reset = false) => {
      if (!workspaceId || loadingRef.current) return
      if (!reset && done) return
      loadingRef.current = true
      try {
        const page = await fetchPage({ ...serverArgs, cursor: reset ? undefined : cursor, limit: 40 }).unwrap()
        setItems((prev) => (reset ? page.items : [...prev, ...page.items]))
        setCursor(page.next_cursor)
        setDone(!page.next_cursor)
      } catch {
        setDone(true)
      } finally {
        loadingRef.current = false
      }
    },
    [workspaceId, serverArgs, cursor, done, fetchPage],
  )

  // Reset when filters change.
  useEffect(() => {
    setItems([])
    setCursor(null)
    setDone(false)
    loadingRef.current = false
    let alive = true
    ;(async () => {
      if (!workspaceId) return
      loadingRef.current = true
      try {
        const page = await fetchPage({ ...serverArgs, limit: 40 }).unwrap()
        if (!alive) return
        setItems(page.items)
        setCursor(page.next_cursor)
        setDone(!page.next_cursor)
      } catch {
        if (alive) setDone(true)
      } finally {
        loadingRef.current = false
      }
    })()
    return () => {
      alive = false
    }
  }, [workspaceId, serverArgs, fetchPage])

  // Infinite scroll.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || done) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && load(false), { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [load, done, items.length])

  // The Worker filters by action; member and date are also applied here in case it ignores them.
  const visible = useMemo(() => {
    const f = from ? dayjs(from).startOf('day') : null
    const t = to ? dayjs(to).endOf('day') : null
    return items.filter((it) => {
      if (actor !== ALL && it.actor_id !== actor) return false
      const d = dayjs(it.created_at)
      if (f && d.isBefore(f)) return false
      if (t && d.isAfter(t)) return false
      return true
    })
  }, [items, actor, from, to])

  const actionOptions = useMemo(() => {
    const seen = new Set(ACTIONS.map(([k]) => k))
    items.forEach((it) => it.action && seen.add(it.action))
    return [...seen].sort((a, b) => actionLabel(a).localeCompare(actionLabel(b)))
  }, [items])

  const grouped = useMemo(() => {
    const groups = []
    let current = null
    for (const it of visible) {
      const label = dayLabel(it.created_at)
      if (!current || current.label !== label) {
        current = { label, items: [] }
        groups.push(current)
      }
      current.items.push(it)
    }
    return groups
  }, [visible])

  const hasFilters = actor !== ALL || action !== ALL || from || to
  const initialLoading = isFetching && items.length === 0

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader title="Activity" description="Who did what, and when." />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={actor} onValueChange={setActor}>
          <SelectTrigger className="w-44" aria-label="Member">
            <SelectValue placeholder="Anyone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Anyone</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.user_id}>
                {m.profile?.display_name || m.profile?.email || 'Member'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-52" aria-label="Action">
            <SelectValue placeholder="Any action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any action</SelectItem>
            {actionOptions.map((a) => (
              <SelectItem key={a} value={a}>
                {actionLabel(a)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" className="w-40" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" className="w-40" />
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setActor(ALL)
              setAction(ALL)
              setFrom('')
              setTo('')
            }}
          >
            <X /> Clear
          </Button>
        )}
      </div>

      {error && <ErrorBox error={error} onRetry={() => load(true)} />}

      {initialLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon={Activity} title={hasFilters ? 'Nothing matches these filters' : 'No activity yet'} description={hasFilters ? 'Try a wider date range or another member.' : 'Things people do in this workspace will show up here.'} />
      ) : (
        <div className="flex flex-col gap-5">
          {grouped.map((g) => (
            <section key={g.label} className="flex flex-col gap-1">
              <h2 className="sticky top-14 z-10 bg-background/95 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">{g.label}</h2>
              <ol className="flex flex-col">
                {g.items.map((it) => {
                  const name = it.actor?.display_name || it.actor?.email?.split('@')[0] || 'Someone'
                  const href = entityHref(workspaceId, it)
                  const sentence = it.message || actionLabel(it.action).toLowerCase()
                  return (
                    <li key={it.id} className="flex items-start gap-3 rounded-xl px-2 py-2.5 hover:bg-accent/50">
                      <Avatar className="size-9">
                        <AvatarFallback>{initials(name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          <span className="font-medium">{name}</span> {sentence}
                          {href && (
                            <>
                              {' '}
                              <Link to={href} className="inline-flex items-center gap-1 text-primary hover:underline">
                                <EntityIcon type={it.entity_type} /> open
                              </Link>
                            </>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground" title={dayjs(it.created_at).format('D MMM YYYY, h:mm A')}>
                          {fromNow(it.created_at)}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </section>
          ))}
          <div ref={sentinelRef} className="h-1" />
          {!done && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={() => load(false)} disabled={isFetching}>
                {isFetching ? 'Loading...' : 'Show older'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
