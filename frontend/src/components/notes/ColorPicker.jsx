import { Check, Palette } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { NOTE_COLORS } from './noteColors'

export function ColorPicker({ value = 'default', onChange }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Note colour">
          <Palette />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="end">
        <div className="grid grid-cols-4 gap-2">
          {NOTE_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              title={c.label}
              aria-label={c.label}
              onClick={() => onChange?.(c.key)}
              className={cn('flex size-9 items-center justify-center rounded-full border-2 transition-transform hover:scale-105', c.className, value === c.key ? 'border-primary' : 'border-border')}
            >
              {value === c.key && <Check className="size-4" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
