import { cn } from '@/lib/utils'

export function Logo({ className }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-8', className)} aria-hidden="true">
      <rect x="6" y="6" width="52" height="52" rx="14" className="fill-primary" />
      <path
        d="M22 18h14a10 10 0 0 1 0 20H22z"
        className="fill-primary-foreground"
        opacity="0.95"
      />
      <path d="M22 38h20v8H22z" className="fill-primary-foreground" opacity="0.7" />
      <circle cx="44" cy="44" r="5" className="fill-primary-foreground" />
    </svg>
  )
}
