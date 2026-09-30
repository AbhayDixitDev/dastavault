import { useEffect } from 'react'
import { Delete } from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'

/** Row of dots showing how many digits were typed. */
export function PinDots({ length, max = 6, shake = false, error = false }) {
  return (
    <motion.div
      className="flex items-center justify-center gap-3"
      animate={shake ? { x: [0, -12, 12, -8, 8, -4, 4, 0] } : { x: 0 }}
      transition={{ duration: 0.45 }}
      aria-live="polite"
    >
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'size-4 rounded-full border-2 transition-colors',
            i < length ? (error ? 'border-destructive bg-destructive' : 'border-primary bg-primary') : 'border-muted-foreground/40',
          )}
        />
      ))}
    </motion.div>
  )
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']

/**
 * Big numeric keypad. Controlled: `value` is the digits typed so far.
 * Calls onSubmit(value) when `maxLength` digits are reached (if provided).
 * Also listens for physical keyboard digits while mounted.
 */
export function PinPad({ value = '', onChange, maxLength = 6, minLength = 4, disabled = false, onSubmit, className }) {
  const press = (k) => {
    if (disabled) return
    if (k === 'del') {
      onChange(value.slice(0, -1))
      return
    }
    if (!k || value.length >= maxLength) return
    const next = value + k
    onChange(next)
    if (next.length === maxLength && onSubmit) onSubmit(next)
  }

  useEffect(() => {
    const onKey = (e) => {
      if (disabled) return
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') press('del')
      else if (e.key === 'Enter' && value.length >= minLength && onSubmit) onSubmit(value)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className={cn('mx-auto grid w-full max-w-xs grid-cols-3 gap-3', className)} role="group" aria-label="PIN keypad">
      {KEYS.map((k, i) =>
        k === '' ? (
          <span key={i} />
        ) : (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => press(k)}
            aria-label={k === 'del' ? 'Delete' : k}
            className={cn(
              'flex h-16 items-center justify-center rounded-2xl border bg-card text-2xl font-semibold shadow-soft transition-all',
              'hover:bg-accent active:scale-95 disabled:opacity-50 disabled:active:scale-100 select-none',
            )}
          >
            {k === 'del' ? <Delete className="size-6" /> : k}
          </button>
        ),
      )}
    </div>
  )
}
