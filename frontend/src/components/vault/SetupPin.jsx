import { useState } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/useAuth'
import { useSetupVaultMutation } from '@/store/api/vaultApi'
import { buildPinMaterial, generateVaultKeyB64, verifierSaltFor, DEFAULT_ITERATIONS } from '@/services/vault/crypto'
import { unlockWith } from '@/services/vault/session'
import { errorMessage } from '@/components/common/ErrorBox'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@/components/ui/spinner'
import { PinDots, PinPad } from './PinPad'

const MIN = 4
const MAX = 6

/** First-time flow: choose a PIN, confirm it, pick recovery, create the vault. */
export function SetupPin({ onDone }) {
  const { user } = useAuth()
  const [setupVault, { isLoading }] = useSetupVaultMutation()
  const [step, setStep] = useState('choose') // choose | confirm | options
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [shake, setShake] = useState(false)
  const [recovery, setRecovery] = useState(true)
  const [busy, setBusy] = useState(false)

  const mismatch = () => {
    setShake(true)
    setTimeout(() => setShake(false), 500)
    setConfirm('')
    toast.error('The PINs do not match. Try again.')
  }

  const onConfirmDone = (value) => {
    if (value !== pin) return mismatch()
    setStep('options')
  }

  const create = async () => {
    setBusy(true)
    try {
      const vaultKeyRaw = generateVaultKeyB64()
      const verifierSalt = await verifierSaltFor(user?.id, null)
      const { fields, vaultKey } = await buildPinMaterial(pin, vaultKeyRaw, DEFAULT_ITERATIONS, { verifierSalt })
      await setupVault({
        ...fields,
        recovery_enabled: recovery,
        ...(recovery ? { vault_key: vaultKeyRaw } : {}),
      }).unwrap()
      unlockWith(vaultKey)
      toast.success('Chaabi is ready. Your passwords are locked with your PIN.')
      onDone?.()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (step === 'options') {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 py-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ShieldCheck className="size-8" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">One more thing</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your passwords are locked with this PIN. Without it nobody can open them, not even us.
          </p>
        </div>

        <label className="flex w-full items-start gap-3 rounded-2xl border bg-card p-4 text-left">
          <Switch checked={recovery} onCheckedChange={setRecovery} className="mt-0.5" />
          <span className="flex-1">
            <span className="block font-medium">Allow reset by email code</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              If you forget your PIN, we send a 6-digit code to your email so you can set a new PIN and keep all your passwords.
              To make this possible our server keeps a sealed copy of your vault key that only it can open during a reset.
            </span>
            {!recovery && (
              <span className="mt-2 block text-sm font-medium text-destructive">
                With this off, a forgotten PIN means your passwords can never be opened again.
              </span>
            )}
          </span>
        </label>

        <div className="flex w-full flex-col gap-2">
          <Button size="xl" onClick={create} disabled={busy || isLoading}>
            {busy || isLoading ? <Spinner size="sm" /> : <KeyRound />} Create my vault
          </Button>
          <Button variant="ghost" onClick={() => { setStep('choose'); setPin(''); setConfirm('') }} disabled={busy}>
            Change PIN
          </Button>
        </div>
      </div>
    )
  }

  const confirming = step === 'confirm'
  const value = confirming ? confirm : pin

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 py-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <KeyRound className="size-8" />
      </div>
      <div>
        <h2 className="text-xl font-semibold">{confirming ? 'Type your PIN again' : 'Choose a PIN'}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {confirming ? 'Just to be sure you remember it.' : `${MIN} to ${MAX} digits. ${MAX} digits is safer.`}
        </p>
      </div>

      <PinDots length={value.length} max={MAX} shake={shake} />

      <PinPad
        value={value}
        onChange={confirming ? setConfirm : setPin}
        maxLength={confirming ? pin.length : MAX}
        minLength={MIN}
        onSubmit={confirming ? onConfirmDone : undefined}
      />

      {!confirming ? (
        <Button size="xl" className="w-full max-w-xs" disabled={pin.length < MIN} onClick={() => setStep('confirm')}>
          Continue
        </Button>
      ) : (
        <div className="flex w-full max-w-xs flex-col gap-2">
          <Button size="xl" disabled={confirm.length < MIN} onClick={() => onConfirmDone(confirm)}>
            Confirm PIN
          </Button>
          <Button variant="ghost" onClick={() => { setStep('choose'); setPin(''); setConfirm('') }}>
            Start over
          </Button>
        </div>
      )}
    </div>
  )
}
