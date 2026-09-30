import { KeyRound, Mail, MailX, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/utils/format'
import { ResponsiveDialog } from './ResponsiveDialog'

/** Chaabi settings: change PIN, recovery status, trash. */
export function VaultSettingsSheet({ open, onOpenChange, vault, onChangePin, onOpenTrash }) {
  const recovery = vault?.recovery_enabled !== false
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Chaabi settings" description="Your passwords are locked with your PIN and encrypted on your device.">
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => { onOpenChange(false); onChangePin() }}
          className="flex items-center gap-3 rounded-2xl border bg-card p-4 text-left transition-colors hover:bg-accent"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <KeyRound className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Change PIN</span>
            <span className="block text-xs text-muted-foreground">
              {vault?.pin_changed_at ? `Last changed ${formatDate(vault.pin_changed_at)}` : 'Needs your current PIN'}
            </span>
          </span>
        </button>

        <div className="flex items-start gap-3 rounded-2xl border bg-card p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            {recovery ? <Mail className="size-5" /> : <MailX className="size-5" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 font-medium">
              Reset by email code <Badge variant={recovery ? 'success' : 'secondary'}>{recovery ? 'On' : 'Off'}</Badge>
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              {recovery
                ? 'If you forget your PIN, we send a code to your email so you can set a new PIN without losing anything. To do this, our server keeps a sealed copy of your vault key that only it can open during a reset.'
                : 'No recovery: nobody, not even our server, can open this vault without the PIN. A forgotten PIN means the passwords cannot be opened.'}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">This choice was made when the vault was created.</span>
          </span>
        </div>

        <Button variant="outline" size="lg" onClick={() => { onOpenChange(false); onOpenTrash() }} className="justify-start">
          <Trash2 /> Trash
        </Button>
      </div>
    </ResponsiveDialog>
  )
}
