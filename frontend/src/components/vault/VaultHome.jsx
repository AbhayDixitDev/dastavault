import { useEffect, useMemo, useState } from 'react'
import { KeyRound, Lock, Plus, Search, Settings, Star } from 'lucide-react'
import { useGetVaultItemsQuery } from '@/store/api/vaultApi'
import { decryptJson } from '@/services/vault/crypto'
import { getKey } from '@/services/vault/session'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorBox } from '@/components/common/ErrorBox'
import { cn } from '@/lib/utils'
import { ItemSheet } from './ItemSheet'
import { TrashView } from './TrashView'
import { VaultSettingsSheet } from './VaultSettingsSheet'
import { ChangePinDialog } from './ChangePinDialog'
import { CATEGORIES, categoryOf, faviconUrl, maskUsername } from './constants'

/** The unlocked vault: search, categories, list, add, lock, settings. */
export function VaultHome({ vault, onLock }) {
  const { data: items = [], isLoading, error, refetch } = useGetVaultItemsQuery()
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [favOnly, setFavOnly] = useState(false)
  const [usernames, setUsernames] = useState({}) // id -> username (decrypted, masked on screen)
  const [editing, setEditing] = useState(null) // null | 'new' | item
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [changePinOpen, setChangePinOpen] = useState(false)

  // Usernames are inside the encrypted blob; decrypt them once so the list can show them masked and search can use them.
  useEffect(() => {
    let alive = true
    const key = getKey()
    if (!key || !items.length) return undefined
    ;(async () => {
      const out = {}
      for (const it of items) {
        if (usernames[it.id] !== undefined && usernames[`${it.id}:v`] === it.updated_at) continue
        const s = await decryptJson(key, it.encrypted_blob, it.iv)
        out[it.id] = s?.username || ''
        out[`${it.id}:v`] = it.updated_at
      }
      if (alive && Object.keys(out).length) setUsernames((u) => ({ ...u, ...out }))
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return items.filter((it) => {
      if (category && it.category !== category) return false
      if (favOnly && !it.is_favorite) return false
      if (!s) return true
      return [it.title, it.website, usernames[it.id], ...(it.tags || [])].filter(Boolean).some((v) => String(v).toLowerCase().includes(s))
    })
  }, [items, q, category, favOnly, usernames])

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Chaabi"
        description="Your passwords, locked with your PIN."
        actions={
          <>
            <Button variant="outline" onClick={() => setSettingsOpen(true)} aria-label="Chaabi settings">
              <Settings /> <span className="hidden sm:inline">Settings</span>
            </Button>
            <Button variant="outline" onClick={onLock}>
              <Lock /> Lock
            </Button>
            <Button onClick={() => setEditing('new')}>
              <Plus /> Add
            </Button>
          </>
        }
      />

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, website or username" className="h-11 pl-9" />
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Chip active={favOnly} onClick={() => setFavOnly((v) => !v)}>
          <Star className={cn('size-3.5', favOnly && 'fill-current')} /> Favourites
        </Chip>
        <Chip active={!category} onClick={() => setCategory('')}>All</Chip>
        {CATEGORIES.map((c) => (
          <Chip key={c.key} active={category === c.key} onClick={() => setCategory(category === c.key ? '' : c.key)}>
            <c.icon className="size-3.5" /> {c.label}
          </Chip>
        ))}
      </div>

      {error && <ErrorBox error={error} onRetry={refetch} className="mb-4" />}

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={items.length === 0 ? 'No passwords yet' : 'No match'}
          description={items.length === 0 ? 'Add your first password. It is encrypted on this device before it is saved.' : 'Try another word or category.'}
          action={items.length === 0 && <Button onClick={() => setEditing('new')}><Plus /> Add password</Button>}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((it) => {
            const Cat = categoryOf(it.category).icon
            const fav = faviconUrl(it.website)
            const user = usernames[it.id]
            return (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => setEditing(it)}
                  className="flex w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left transition-colors hover:bg-accent"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
                    {fav ? (
                      <img src={fav} alt="" className="size-6" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                    ) : (
                      <Cat className="size-5 text-muted-foreground" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{it.title}</span>
                      {it.is_favorite && <Star className="size-3.5 shrink-0 fill-brand-amber text-brand-amber" />}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {user ? maskUsername(user) : it.website || categoryOf(it.category).label}
                    </span>
                  </span>
                  <span className="hidden text-xs text-muted-foreground sm:block">{categoryOf(it.category).label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <ItemSheet open={editing !== null} onOpenChange={(v) => !v && setEditing(null)} item={editing === 'new' ? null : editing} />
      <TrashView open={trashOpen} onOpenChange={setTrashOpen} />
      <VaultSettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        vault={vault}
        onChangePin={() => setChangePinOpen(true)}
        onOpenTrash={() => setTrashOpen(true)}
      />
      <ChangePinDialog open={changePinOpen} onOpenChange={setChangePinOpen} vault={vault} />
    </div>
  )
}

function Chip({ active, children, ...props }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors',
        active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-accent',
      )}
      {...props}
    >
      {children}
    </button>
  )
}
