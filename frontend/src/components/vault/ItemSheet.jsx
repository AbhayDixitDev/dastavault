import { useEffect, useState } from 'react'
import { Copy, Eye, EyeOff, History, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  useCreateVaultItemMutation, useDeleteVaultHistoryEntryMutation, useDeleteVaultItemMutation,
  useGetVaultItemHistoryQuery, useUpdateVaultItemMutation,
} from '@/store/api/vaultApi'
import { decryptJson, encryptJson, passwordStrength } from '@/services/vault/crypto'
import { getKey, touch } from '@/services/vault/session'
import { copySecret } from '@/services/vault/clipboard'
import { errorMessage } from '@/components/common/ErrorBox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@/components/ui/spinner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { formatDate } from '@/utils/format'
import { cn } from '@/lib/utils'
import { ResponsiveDialog } from './ResponsiveDialog'
import { PasswordGenerator } from './PasswordGenerator'
import { StrengthMeter } from './StrengthMeter'
import { CATEGORIES } from './constants'

const EMPTY = { title: '', website: '', username: '', password: '', notes: '', category: 'other', tags: '', is_favorite: false }

/**
 * Add or edit one password. `item` is a row from the list (encrypted) or null for a new one.
 * Secrets live only in this component's state while it is open.
 */
export function ItemSheet({ open, onOpenChange, item }) {
  const isNew = !item
  const [form, setForm] = useState(EMPTY)
  const [original, setOriginal] = useState(null) // decrypted secret at open time
  const [loading, setLoading] = useState(false)
  const [show, setShow] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [createItem, { isLoading: creating }] = useCreateVaultItemMutation()
  const [updateItem, { isLoading: updating }] = useUpdateVaultItemMutation()
  const [deleteItem, { isLoading: deleting }] = useDeleteVaultItemMutation()

  useEffect(() => {
    if (!open) {
      setForm(EMPTY)
      setOriginal(null)
      setShow(false)
      return
    }
    if (!item) {
      setForm(EMPTY)
      setOriginal(null)
      return
    }
    let alive = true
    setLoading(true)
    ;(async () => {
      const key = getKey()
      const secret = key ? await decryptJson(key, item.encrypted_blob, item.iv) : null
      if (!alive) return
      if (!secret) toast.error('Could not read this password. The vault may have locked.')
      const s = secret || {}
      setOriginal(s)
      setForm({
        title: item.title || '',
        website: item.website || '',
        username: s.username || '',
        password: s.password || '',
        notes: s.notes || '',
        category: item.category || 'other',
        tags: (item.tags || []).join(', '),
        is_favorite: !!item.is_favorite,
      })
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [open, item])

  const set = (k) => (v) => {
    touch()
    setForm((f) => ({ ...f, [k]: v }))
  }

  const save = async () => {
    const key = getKey()
    if (!key) return toast.error('The vault locked. Unlock it and try again.')
    if (!form.title.trim()) return toast.error('Give this password a title.')
    try {
      const tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20)
      const secret = { username: form.username, password: form.password, notes: form.notes }
      const secretChanged =
        !original || original.username !== secret.username || original.password !== secret.password || original.notes !== secret.notes
      const meta = {
        title: form.title.trim(),
        website: form.website.trim() || null,
        category: form.category,
        is_favorite: form.is_favorite,
        tags,
        strength: form.password ? passwordStrength(form.password).score : null,
      }
      if (isNew) {
        const enc = await encryptJson(key, secret)
        await createItem({ ...meta, ...enc }).unwrap()
        toast.success('Password saved.')
      } else {
        const enc = secretChanged ? await encryptJson(key, secret) : {}
        await updateItem({ id: item.id, ...meta, ...enc }).unwrap()
        toast.success(secretChanged && original?.password && original.password !== secret.password ? 'Saved. The old password is kept in Old passwords.' : 'Saved.')
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const remove = async () => {
    try {
      await deleteItem({ id: item.id }).unwrap()
      toast.success('Moved to trash.')
      setConfirmDelete(false)
      onOpenChange(false)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const busy = creating || updating || deleting

  return (
    <>
      <ResponsiveDialog
        open={open}
        onOpenChange={onOpenChange}
        title={isNew ? 'Add password' : form.title || 'Password'}
        description={isNew ? 'Everything here is encrypted on your device before it is saved.' : undefined}
        footer={
          <>
            {!isNew && (
              <Button variant="ghost" className="text-destructive sm:mr-auto" onClick={() => setConfirmDelete(true)} disabled={busy}>
                <Trash2 /> Delete
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || loading}>
              {busy && <Spinner size="sm" />} Save
            </Button>
          </>
        }
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner label="Opening..." />
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-1">
            <Field label="Title" htmlFor="vi-title">
              <Input id="vi-title" value={form.title} onChange={(e) => set('title')(e.target.value)} placeholder="Gmail, Bank, Home Wi-Fi..." autoFocus={isNew} />
            </Field>

            <Field label="Website or app" htmlFor="vi-site">
              <Input id="vi-site" value={form.website} onChange={(e) => set('website')(e.target.value)} placeholder="example.com" inputMode="url" autoCapitalize="none" />
            </Field>

            <Field label="Username or email" htmlFor="vi-user">
              <div className="flex gap-2">
                <Input id="vi-user" value={form.username} onChange={(e) => set('username')(e.target.value)} autoCapitalize="none" autoComplete="off" className="flex-1" />
                <Button type="button" variant="outline" size="icon" aria-label="Copy username" onClick={() => copySecret(form.username)} disabled={!form.username}>
                  <Copy />
                </Button>
              </div>
            </Field>

            <Field label="Password" htmlFor="vi-pass">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="vi-pass"
                    type={show ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => set('password')(e.target.value)}
                    autoComplete="new-password"
                    className={cn('pr-10 font-mono', show && 'tracking-wide')}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                    aria-label={show ? 'Hide password' : 'Show password'}
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <Button type="button" variant="outline" size="icon" aria-label="Copy password" onClick={() => copySecret(form.password)} disabled={!form.password}>
                  <Copy />
                </Button>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <StrengthMeter password={form.password} className="flex-1" />
                <PasswordGenerator onPick={(pw) => { set('password')(pw); setShow(true) }} />
              </div>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category" htmlFor="vi-cat">
                <Select value={form.category} onValueChange={set('category')}>
                  <SelectTrigger id="vi-cat" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Tags (comma separated)" htmlFor="vi-tags">
                <Input id="vi-tags" value={form.tags} onChange={(e) => set('tags')(e.target.value)} placeholder="family, shared" />
              </Field>
            </div>

            <Field label="Notes" htmlFor="vi-notes">
              <Textarea id="vi-notes" value={form.notes} onChange={(e) => set('notes')(e.target.value)} rows={3} placeholder="Security questions, PIN hints, anything private" />
            </Field>

            <label className="flex items-center justify-between rounded-xl border bg-card px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Star className={cn('size-4', form.is_favorite && 'fill-brand-amber text-brand-amber')} /> Favourite
              </span>
              <Switch checked={form.is_favorite} onCheckedChange={set('is_favorite')} />
            </label>

            {!isNew && <OldPasswords itemId={item.id} enabled={open} />}
          </div>
        )}
      </ResponsiveDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move to trash?</AlertDialogTitle>
            <AlertDialogDescription>You can restore "{form.title}" from the trash later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={remove} disabled={deleting} className="bg-destructive text-white hover:bg-destructive/90">
              Move to trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function Field({ label, htmlFor, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

/** "Old passwords": history rows decrypted one by one when the user asks. */
function OldPasswords({ itemId, enabled }) {
  const { data: history = [], isLoading } = useGetVaultItemHistoryQuery(itemId, { skip: !enabled })
  const [deleteEntry] = useDeleteVaultHistoryEntryMutation()
  const [revealed, setRevealed] = useState({}) // hid -> secret

  if (isLoading) return null
  if (!history.length) return null

  const reveal = async (h) => {
    touch()
    const key = getKey()
    const s = key ? await decryptJson(key, h.encrypted_blob, h.iv) : null
    if (!s) return toast.error('Could not read this entry.')
    setRevealed((r) => ({ ...r, [h.id]: s }))
  }

  const remove = async (h) => {
    try {
      await deleteEntry({ id: itemId, hid: h.id }).unwrap()
      setRevealed((r) => {
        const n = { ...r }
        delete n[h.id]
        return n
      })
      toast.success('Old password deleted.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <section className="rounded-xl border">
      <h3 className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-medium">
        <History className="size-4 text-muted-foreground" /> Old passwords
        <span className="ml-auto text-xs font-normal text-muted-foreground">{history.length}</span>
      </h3>
      <ul className="divide-y">
        {history.map((h) => {
          const s = revealed[h.id]
          return (
            <li key={h.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted-foreground">Replaced {formatDate(h.replaced_at, 'D MMM YYYY, HH:mm')}</span>
                {s ? (
                  <span className="block truncate font-mono">{s.password || '(empty)'}{s.username ? <span className="ml-2 font-sans text-muted-foreground">{s.username}</span> : null}</span>
                ) : (
                  <span className="block font-mono tracking-widest text-muted-foreground">••••••••</span>
                )}
              </span>
              {s ? (
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Copy old password" onClick={() => copySecret(s.password)}>
                  <Copy />
                </Button>
              ) : (
                <Button type="button" size="sm" variant="ghost" onClick={() => reveal(h)}>
                  Show
                </Button>
              )}
              <Button type="button" size="icon-sm" variant="ghost" className="text-destructive" aria-label="Delete old password" onClick={() => remove(h)}>
                <Trash2 />
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
