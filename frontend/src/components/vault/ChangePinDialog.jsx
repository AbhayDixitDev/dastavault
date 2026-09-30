import { useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/useAuth'
import { useChangePinMutation } from '@/store/api/vaultApi'
import { buildPinMaterial, exportVaultKeyB64, makeVerifier, verifierSaltFor, DEFAULT_ITERATIONS } from '@/services/vault/crypto'
import { getKey, unlockWith } from '@/services/vault/session'
import { errorMessage } from '@/components/common/ErrorBox'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { PinDots, PinPad } from './PinPad'

/** Change PIN while unlocked: current PIN -> new PIN -> confirm. Re-wraps the vault key locally. */
export function ChangePinDialog({ open, onOpenChange, vault }) {
  const { user } = useAuth()
  const [changePin, { isLoading }] = useChangePinMutation()
  const [step, setStep] = useState('current') // current | new | confirm
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [shake, setShake] = useState(false)
  const [busy, setBusy] = useState(false)

  const pinLength = Math.min(6, Math.max(4, vault?.pin_length || 6))
  const iterations = vault?.kdf_iterations || DEFAULT_ITERATIONS

  const close = (v) => {
    if (!v) {
      setStep('current')
      setCurrent('')
      setNext('')
      setConfirm('')
    }
    onOpenChange(v)
  }

  const bump = () => {
    setShake(true)
    setTimeout(() => setShake(false), 500)
  }

  const finish = async (value) => {
    if (value !== next) {
      bump()
      setConfirm('')
      toast.error('The PINs do not match. Try again.')
      return
    }
    const key = getKey()
    if (!key) {
      toast.error('The vault locked. Unlock it and try again.')
      close(false)
      return
    }
    setBusy(true)
    try {
      const verifierSalt = await verifierSaltFor(user?.id, vault)
      const current_pin_verifier_hash = await makeVerifier(current, verifierSalt, iterations)
      const raw = await exportVaultKeyB64(key)
      const { fields, vaultKey } = await buildPinMaterial(next, raw, DEFAULT_ITERATIONS, { verifierSalt })
      await changePin({ current_pin_verifier_hash, ...fields }).unwrap()
      unlockWith(vaultKey)
      toast.success('PIN changed.')
      close(false)
    } catch (err) {
      if (err?.status === 401) {
        toast.error('The current PIN is wrong.')
        setStep('current')
        setCurrent('')
        setNext('')
        setConfirm('')
        bump()
      } else {
        toast.error(errorMessage(err))
      }
    } finally {
      setBusy(false)
    }
  }

  const value = step === 'current' ? current : step === 'new' ? next : confirm
  const setValue = step === 'current' ? setCurrent : step === 'new' ? setNext : setConfirm
  const max = step === 'current' ? pinLength : step === 'new' ? 6 : next.length

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change PIN</DialogTitle>
          <DialogDescription>
            {step === 'current' ? 'First, type your current PIN.' : step === 'new' ? 'Choose a new PIN (4 to 6 digits).' : 'Type the new PIN again.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col items-center gap-5 py-2">
            <PinDots length={value.length} max={max} shake={shake} />
            <PinPad
              value={value}
              onChange={setValue}
              maxLength={max}
              minLength={4}
              disabled={busy}
              onSubmit={step === 'current' ? () => setStep('new') : step === 'confirm' ? finish : undefined}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)} disabled={busy}>
            Cancel
          </Button>
          {step === 'current' && (
            <Button onClick={() => setStep('new')} disabled={current.length < 4}>
              Continue
            </Button>
          )}
          {step === 'new' && (
            <Button onClick={() => setStep('confirm')} disabled={next.length < 4}>
              Continue
            </Button>
          )}
          {step === 'confirm' && (
            <Button onClick={() => finish(confirm)} disabled={busy || isLoading || confirm.length < 4}>
              {(busy || isLoading) && <Spinner size="sm" />} Save new PIN
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
