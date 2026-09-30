import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/useAuth'
import { useUnlockVaultMutation } from '@/store/api/vaultApi'
import { deriveKey, makeVerifier, unwrapKey, verifierSaltFor, DEFAULT_ITERATIONS } from '@/services/vault/crypto'
import { unlockWith } from '@/services/vault/session'
import { errorMessage } from '@/components/common/ErrorBox'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { PinDots, PinPad } from './PinPad'

function secondsUntil(iso) {
  if (!iso) return 0
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000))
}

/** Asks for the PIN, checks it with the server, unwraps the vault key locally. */
export function UnlockScreen({ vault, onUnlocked, onForgot, reason }) {
  const { user } = useAuth()
  const [unlockVault] = useUnlockVaultMutation()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(false)
  const [attemptsLeft, setAttemptsLeft] = useState(null)
  const [lockedUntil, setLockedUntil] = useState(vault?.locked_until || null)
  const [countdown, setCountdown] = useState(secondsUntil(vault?.locked_until))

  const pinLength = Math.min(6, Math.max(4, vault?.pin_length || 6))
  const iterations = vault?.kdf_iterations || DEFAULT_ITERATIONS

  useEffect(() => {
    setLockedUntil(vault?.locked_until || null)
  }, [vault?.locked_until])

  useEffect(() => {
    if (!lockedUntil) return undefined
    setCountdown(secondsUntil(lockedUntil))
    const t = setInterval(() => {
      const s = secondsUntil(lockedUntil)
      setCountdown(s)
      if (s <= 0) {
        setLockedUntil(null)
        clearInterval(t)
      }
    }, 1000)
    return () => clearInterval(t)
  }, [lockedUntil])

  const fail = (msg) => {
    setShake(true)
    setTimeout(() => setShake(false), 500)
    setPin('')
    if (msg) toast.error(msg)
  }

  const submit = async (value) => {
    if (busy || countdown > 0) return
    setBusy(true)
    try {
      const verifierSalt = await verifierSaltFor(user?.id, vault)
      const pin_verifier_hash = await makeVerifier(value, verifierSalt, iterations)
      const res = await unlockVault({ pin_verifier_hash }).unwrap()
      const pinKey = await deriveKey(value, res.pin_salt, res.kdf_iterations || iterations)
      let key
      try {
        key = await unwrapKey(pinKey, res.pin_wrapped_key, res.wrap_iv)
      } catch {
        return fail('Could not open the vault with this PIN.')
      }
      setAttemptsLeft(null)
      unlockWith(key)
      onUnlocked?.()
    } catch (err) {
      const details = err?.data?.details || {}
      if (err?.status === 423 || details.locked_until) {
        setLockedUntil(details.locked_until || new Date(Date.now() + (details.retry_after_seconds || 30) * 1000).toISOString())
        fail(null)
      } else if (err?.status === 401) {
        setAttemptsLeft(details.attempts_remaining ?? null)
        fail('Wrong PIN.')
      } else {
        fail(errorMessage(err))
      }
    } finally {
      setBusy(false)
    }
  }

  const locked = countdown > 0
  const reasonText = {
    idle: 'Locked after 2 minutes without activity.',
    background: 'Locked because the app went to the background.',
    signout: 'Locked because you signed out.',
  }[reason]

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 py-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Lock className="size-8" />
      </div>
      <div>
        <h2 className="text-xl font-semibold">Enter your PIN</h2>
        <p className="mt-1 text-sm text-muted-foreground">{reasonText || 'Chaabi is locked. Type your PIN to open it.'}</p>
      </div>

      <PinDots length={pin.length} max={pinLength} shake={shake} error={shake} />

      <div className="min-h-5 text-sm" aria-live="polite">
        {locked ? (
          <span className="font-medium text-destructive">Too many wrong PINs. Try again in {countdown} s.</span>
        ) : attemptsLeft != null ? (
          <span className="text-destructive">
            {attemptsLeft} {attemptsLeft === 1 ? 'attempt' : 'attempts'} left before a wait
          </span>
        ) : busy ? (
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Spinner size="sm" /> Checking...
          </span>
        ) : null}
      </div>

      <PinPad value={pin} onChange={setPin} maxLength={pinLength} minLength={4} disabled={busy || locked} onSubmit={submit} />

      <Button variant="link" onClick={onForgot} className="text-muted-foreground">
        Forgot PIN?
      </Button>
    </div>
  )
}
