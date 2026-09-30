import { useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useDeleteVaultItemMutation, useGetVaultTrashQuery, useRestoreVaultItemMutation } from '@/store/api/vaultApi'
import { errorMessage } from '@/components/common/ErrorBox'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { fromNow } from '@/utils/format'
import { ResponsiveDialog } from './ResponsiveDialog'
import { categoryOf, faviconUrl } from './constants'

/** Deleted passwords: restore or delete for ever. */
export function TrashView({ open, onOpenChange }) {
  const { data: items = [], isLoading } = useGetVaultTrashQuery(undefined, { skip: !open })
  const [restore, { isLoading: restoring }] = useRestoreVaultItemMutation()
  const [remove, { isLoading: purging }] = useDeleteVaultItemMutation()
  const [purgeTarget, setPurgeTarget] = useState(null)

  const onRestore = async (id) => {
    try {
      await restore(id).unwrap()
      toast.success('Restored.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const onPurge = async () => {
    if (!purgeTarget) return
    try {
      await remove({ id: purgeTarget.id, purge: true }).unwrap()
      toast.success('Deleted for ever.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setPurgeTarget(null)
    }
  }

  return (
    <>
      <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Trash" description="Deleted passwords stay here until you delete them for ever.">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={Trash2} title="Trash is empty" description="Deleted passwords will show up here." />
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((it) => {
              const Cat = categoryOf(it.category).icon
              const fav = faviconUrl(it.website)
              return (
                <li key={it.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                  <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                    {fav ? <img src={fav} alt="" className="size-5" loading="lazy" /> : <Cat className="size-5 text-muted-foreground" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{it.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">Deleted {fromNow(it.deleted_at)}</span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => onRestore(it.id)} disabled={restoring}>
                    <RotateCcw /> Restore
                  </Button>
                  <Button size="icon-sm" variant="ghost" className="text-destructive" onClick={() => setPurgeTarget(it)} aria-label="Delete for ever">
                    <Trash2 />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </ResponsiveDialog>

      <AlertDialog open={!!purgeTarget} onOpenChange={(v) => !v && setPurgeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete for ever?</AlertDialogTitle>
            <AlertDialogDescription>
              "{purgeTarget?.title}" and its old passwords will be gone. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={onPurge} disabled={purging} className="bg-destructive text-white hover:bg-destructive/90">
              Delete for ever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
