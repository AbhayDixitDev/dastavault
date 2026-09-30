import { useEffect, useState } from 'react'
import { useGetVaultQuery } from '@/store/api/vaultApi'
import { isUnlocked, lastLockReason, lock, subscribe } from '@/services/vault/session'
import { clearPendingCopy } from '@/services/vault/clipboard'
import { SetupPin } from '@/components/vault/SetupPin'
import { UnlockScreen } from '@/components/vault/UnlockScreen'
import { VaultHome } from '@/components/vault/VaultHome'
import { ForgotPinDialog } from '@/components/vault/ForgotPinDialog'
import { ErrorBox } from '@/components/common/ErrorBox'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * /w/:ws/chaabi - the vault is per user, it only lives under the workspace shell.
 * No vault -> SetupPin; locked -> UnlockScreen; unlocked -> VaultHome.
 */
export function ChaabiPage() {
  const { data: vault, isLoading, error, refetch } = useGetVaultQuery()
  const [unlocked, setUnlocked] = useState(isUnlocked())
  const [reason, setReason] = useState(lastLockReason())
  const [forgotOpen, setForgotOpen] = useState(false)

  useEffect(() => {
    const off = subscribe((u, why) => {
      setUnlocked(u)
      setReason(why)
      if (!u) clearPendingCopy()
    })
    return off
  }, [])

  // Leaving the page locks the vault after a short grace period.
  useEffect(() => {
    return () => {
      setTimeout(() => {
        if (!window.location.pathname.includes('/chaabi')) lock('navigate')
      }, 30_000)
    }
  }, [])

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-10">
        <Skeleton className="size-16 rounded-full" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-64 w-full max-w-xs rounded-2xl" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md py-10">
        <ErrorBox error={error} title="Could not open Chaabi" onRetry={refetch} />
      </div>
    )
  }

  if (!vault) return <SetupPin onDone={refetch} />

  if (!unlocked) {
    return (
      <>
        <UnlockScreen vault={vault} reason={reason} onForgot={() => setForgotOpen(true)} onUnlocked={refetch} />
        <ForgotPinDialog open={forgotOpen} onOpenChange={setForgotOpen} vault={vault} onDone={refetch} />
      </>
    )
  }

  return <VaultHome vault={vault} onLock={() => lock('manual')} />
}

export default ChaabiPage
