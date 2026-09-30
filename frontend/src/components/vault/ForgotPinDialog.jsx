import { useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/useAuth'
import { useForgotPinCompleteMutation, useForgotPinRequestMutation, useForgotPinVerifyMutation } from '@/store/api/vaultApi'
import { buildPinMaterial, verifierSaltFor, DEFAULT_ITERATIONS } from '@/services/vault/crypto'
import { unlockWith } from '@/services/vault/session'
import { errorMessage } from '@/components/common/ErrorBox'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { PinDots, PinPad } from './PinPad'

/**
 * Forgot PIN: request code -> type 6 digits -> choose a new PIN -> complete.
 * The verify step returns the raw vault key; we re-wrap it with the new PIN locally
 * and send only the wrapped copy. All passwords are kept.
 */
export function ForgotPinDialog({ open, onOpenChange, vault, onDone }) {
  const { user } = useAuth()
  const [requestCode, { isLoading: requesting }] = useForgotPinRequestMutation()
  const [verifyCode, { isLoading: verifying }] = useForgotPinVerifyMutation()
  const [complete, { isLoading: completing }] = useForgotPinCompleteMutation()

  const [step, setStep] = useState('start') // start | code | newpin | confirm
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [reset, setReset] = useState(null) // { vault_key, reset_token }
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [shake, setShake] = useState(false)
  const [busy, setBusy] = useState(false)

  const recoveryOff = vault && vault.recovery_enabled === false

  const close = (v) => {
    if (!v) {
      setStep('start')
      setCode('')
      setPin('')
      setConfirm('')
      setReset(null)
    }
    onOpenChange(v)
  }

  const start = async () => {
    try {
      const r = await requestCode().unwrap()
      setSentTo(r.sent_to || 'your email')
      setStep('code')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const verify = async () => {
    try {
      const r = await verifyCode({ code }).unwrap()
      setReset({ vault_key: r.vault_key, reset_token: r.reset_token })
      setStep('newpin')
    } catch (err) {
      const left = err?.data?.details?.attempts_remaining
      toast.error(left != null ? `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.` : errorMessage(err))
      setCode('')
    }
  }

  const finish = async (value) => {
    if (value !== pin) {
      setShake(true)
      setTimeout(() => setShake(false), 500)
      setConfirm('')
      toast.error('The PINs do not match. Try again.')
      return
    }
    setBusy(true)
    try {
      const verifierSalt = await verifierSaltFor(user?.id, vault)
      const { fields, vaultKey } = await buildPinMaterial(pin, reset.vault_key, DEFAULT_ITERATIONS, { verifierSalt })
      await complete({ reset_token: reset.reset_token, ...fields }).unwrap()
      unlockWith(vaultKey)
      toast.success('Your PIN was changed. All passwords are kept.')
      close(false)
      onDone?.()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
      setReset(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Forgot PIN</DialogTitle>
          <DialogDescription>
            {recoveryOff
              ? 'PIN reset is turned off for this vault.'
              : step === 'start'
                ? 'We can send a 6-digit code to your email so you can set a new PIN. Your passwords stay as they are.'
                : step === 'code'
                  ? `Type the code we sent to ${sentTo}. It works for 10 minutes.`
                  : step === 'newpin'
                    ? 'Choose a new PIN (4 to 6 digits).'
                    : 'Type the new PIN again.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {recoveryOff ? (
            <p className="text-sm text-muted-foreground">
              If you cannot remember your PIN, the passwords in Chaabi cannot be opened. You can delete the vault and start again.
            </p>
          ) : step === 'start' ? null : step === 'code' ? (
            <Input
              autoFocus
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && verify()}
              className="h-12 text-center text-2xl tracking-[0.5em]"
            />
          ) : (
            <div className="flex flex-col items-center gap-5 py-2">
              <PinDots length={step === 'newpin' ? pin.length : confirm.length} max={step === 'newpin' ? 6 : pin.length} shake={shake} />
              <PinPad
                value={step === 'newpin' ? pin : confirm}
                onChange={step === 'newpin' ? setPin : setConfirm}
                maxLength={step === 'newpin' ? 6 : pin.length}
                minLength={4}
                disabled={busy}
                onSubmit={step === 'confirm' ? finish : undefined}
              />
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)} disabled={busy}>
            Cancel
          </Button>
          {!recoveryOff && step === 'start' && (
            <Button onClick={start} disabled={requesting}>
              {requesting && <Spinner size="sm" />} Send code
            </Button>
          )}
          {step === 'code' && (
            <Button onClick={verify} disabled={verifying || code.length !== 6}>
              {verifying && <Spinner size="sm" />} Check code
            </Button>
          )}
          {step === 'newpin' && (
            <Button onClick={() => setStep('confirm')} disabled={pin.length < 4}>
              Continue
            </Button>
          )}
          {step === 'confirm' && (
            <Button onClick={() => finish(confirm)} disabled={busy || completing || confirm.length < 4}>
              {(busy || completing) && <Spinner size="sm" />} Set new PIN
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
