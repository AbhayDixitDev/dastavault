import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CloudUpload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { countUploadDraft } from '@/services/offline/uploadDraft'

/** "Finish your upload" reminder for an upload draft saved on this device. */
export function ContinueUploadBanner({ workspaceId, className }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let alive = true
    if (workspaceId) countUploadDraft(workspaceId).then((n) => alive && setCount(n))
    return () => { alive = false }
  }, [workspaceId])
  if (!workspaceId || !count) return null
  return (
    <div className={cn('flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4', className)}>
      <CloudUpload className="size-6 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Finish your upload</p>
        <p className="text-sm text-muted-foreground">{count === 1 ? '1 document is' : `${count} documents are`} waiting as a draft.</p>
      </div>
      <Button asChild size="sm"><Link to={`/w/${workspaceId}/upload`}>Continue</Link></Button>
    </div>
  )
}
