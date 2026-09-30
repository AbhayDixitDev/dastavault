import { useState } from 'react'
import { toast } from 'sonner'
import { Copy, Link2, Lock, Trash2, Eye } from 'lucide-react'
import { useGetSharesQuery, useCreateShareMutation, useDeleteShareMutation } from '@/store/api/documentsApi'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from '@/components/common/ErrorBox'
import { formatDate, fromNow } from '@/utils/format'

const EXPIRY = [
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '7 days' },
  { hours: 720, label: '30 days' },
]

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Create and manage share links for one document. */
export function ShareDialog({ open, onOpenChange, workspaceId, document: doc, canEdit }) {
  const { data: shares = [], isLoading } = useGetSharesQuery({ workspaceId, documentId: doc?.id }, { skip: !open || !doc?.id })
  const [createShare, { isLoading: creating }] = useCreateShareMutation()
  const [deleteShare] = useDeleteShareMutation()
  const [hours, setHours] = useState('72')
  const [password, setPassword] = useState('')
  const [allowDownload, setAllowDownload] = useState(true)

  const links = shares.filter((s) => s.kind === 'link' || !s.kind)

  const create = async () => {
    try {
      const share = await createShare({
        workspaceId,
        document_id: doc.id,
        kind: 'link',
        expires_in_hours: Number(hours),
        allow_download: allowDownload,
        ...(password.trim() ? { password: password.trim() } : {}),
      }).unwrap()
      setPassword('')
      const ok = share?.url ? await copyText(share.url) : false
      toast.success(ok ? 'Link created and copied.' : 'Link created.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const revoke = async (s) => {
    try {
      await deleteShare({ workspaceId, shareId: s.id }).unwrap()
      toast.success('Link removed. It no longer works.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const share = async (s) => {
    if (navigator.share) {
      try {
        await navigator.share({ title: doc?.name, url: s.url })
        return
      } catch {
        /* user cancelled */
      }
    }
    const ok = await copyText(s.url)
    toast[ok ? 'success' : 'error'](ok ? 'Link copied.' : 'Could not copy. Long-press the link to copy it.')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share “{doc?.name}”</DialogTitle>
          <DialogDescription>Anyone with the link can view this document until the link expires.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          {canEdit && (
            <div className="flex flex-col gap-3 rounded-xl border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label>Link works for</Label>
                  <Select value={hours} onValueChange={setHours}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{EXPIRY.map((e) => <SelectItem key={e.hours} value={String(e.hours)}>{e.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="share-pw">Password (optional)</Label>
                  <Input id="share-pw" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave empty for none" />
                </div>
              </div>
              <label className="flex items-center justify-between text-sm">
                <span>Allow download</span>
                <Switch checked={allowDownload} onCheckedChange={setAllowDownload} />
              </label>
              <Button onClick={create} disabled={creating} size="lg">{creating ? <Spinner size="sm" /> : <Link2 />} Create link</Button>
            </div>
          )}

          <div>
            <h4 className="mb-2 text-sm font-medium">Active links</h4>
            {isLoading ? (
              <Skeleton className="h-16 rounded-xl" />
            ) : links.length === 0 ? (
              <p className="text-sm text-muted-foreground">No links yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {links.map((s) => (
                  <li key={s.id} className="flex flex-col gap-2 rounded-xl border p-3">
                    <div className="flex items-center gap-2">
                      <Link2 className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">{s.url}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{s.expires_at ? `Expires ${fromNow(s.expires_at)} (${formatDate(s.expires_at)})` : 'No expiry'}</span>
                      {s.has_password && <span className="flex items-center gap-1"><Lock className="size-3" /> Password</span>}
                      <span className="flex items-center gap-1"><Eye className="size-3" /> {s.views ?? 0} views</span>
                      {s.allow_download === false && <span>No download</span>}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => share(s)}><Copy /> Copy link</Button>
                      {canEdit && <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => revoke(s)}><Trash2 /> Remove</Button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
