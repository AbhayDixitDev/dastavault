import { Spinner } from '@/components/ui/spinner'

export function FullPageLoader({ label = 'Loading...' }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
      <Spinner className="size-6" />
      <p className="text-sm">{label}</p>
    </div>
  )
}
