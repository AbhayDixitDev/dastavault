import { useEffect, useState } from 'react'
import { RefreshCw, Wand2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { generatePassword } from '@/services/vault/crypto'
import { StrengthMeter } from './StrengthMeter'

/** Popover with a length slider and switches. Calls onPick(password) when "Use this" is pressed. */
export function PasswordGenerator({ onPick, trigger }) {
  const [open, setOpen] = useState(false)
  const [opts, setOpts] = useState({ length: 16, symbols: true, numbers: true, uppercase: true, readable: false })
  const [pw, setPw] = useState('')

  const regen = (o = opts) => setPw(generatePassword(o))

  useEffect(() => {
    if (open) regen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = (patch) => {
    const next = { ...opts, ...patch }
    setOpts(next)
    regen(next)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger || (
          <Button type="button" variant="outline" size="sm">
            <Wand2 /> Generate
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-2 py-1.5 font-mono text-sm">{pw}</code>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => regen()} aria-label="Make another">
              <RefreshCw />
            </Button>
          </div>
          <StrengthMeter password={pw} />

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-sm">
              <Label htmlFor="gen-length">Length</Label>
              <span className="tabular-nums text-muted-foreground">{opts.length}</span>
            </div>
            <input
              id="gen-length"
              type="range"
              min={8}
              max={40}
              value={opts.length}
              onChange={(e) => set({ length: Number(e.target.value) })}
              className="accent-primary w-full"
            />
          </div>

          <Row label="Symbols (!@#)" checked={opts.symbols} onChange={(v) => set({ symbols: v })} />
          <Row label="Numbers" checked={opts.numbers} onChange={(v) => set({ numbers: v })} />
          <Row label="Capital letters" checked={opts.uppercase} onChange={(v) => set({ uppercase: v })} />
          <Row label="Easy to read (no O/0, l/1)" checked={opts.readable} onChange={(v) => set({ readable: v })} />

          <Button
            type="button"
            onClick={() => {
              onPick?.(pw)
              setOpen(false)
            }}
          >
            Use this password
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Row({ label, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
