import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileStack } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { db } from '@/services/offline/db'

/**
 * "Continue your scan" reminder for pages saved on this device.
 * Renders nothing when there is no unfinished scan for the workspace.
 */
export function ContinueScanBanner({ workspaceId, className }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let alive = true
    const check = () => db.pendingCaptures.where('workspaceId').equals(workspaceId).count().then((n) => alive && setCount(n)).catch(() => {})
    check()
    const t = setInterval(check, 4000)
    return () => { alive = false; clearInterval(t) }
  }, [workspaceId])
  if (!workspaceId || !count) return null
  return (
    <div className={cn('flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4', className)}>
      <FileStack className="size-6 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Continue your scan</p>
        <p className="text-sm text-muted-foreground">{count === 1 ? '1 page is' : `${count} pages are`} waiting on this device.</p>
      </div>
      <Button asChild size="sm"><Link to={`/w/${workspaceId}/scan`}>Continue</Link></Button>
    </div>
  )
}
