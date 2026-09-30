import { passwordStrength } from '@/services/vault/crypto'
import { cn } from '@/lib/utils'

const COLORS = ['bg-destructive', 'bg-destructive/70', 'bg-brand-amber', 'bg-brand-teal', 'bg-primary']

export function StrengthMeter({ password, className }) {
  const { score, label } = passwordStrength(password)
  if (!password) return null
  return (
    <div className={cn('flex items-center gap-3', className)} aria-label={`Password strength: ${label}`}>
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn('h-1.5 flex-1 rounded-full bg-muted transition-colors', i < score && COLORS[score])} />
        ))}
      </div>
      <span className="w-20 text-right text-xs text-muted-foreground">{label}</span>
    </div>
  )
}
