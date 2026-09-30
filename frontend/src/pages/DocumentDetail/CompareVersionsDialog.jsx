import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { lineDiff, diffStats } from './lineDiff'
import { cn } from '@/lib/utils'

function DiffColumn({ diff, side }) {
  const keep = side === 'left' ? 'remove' : 'add'
  const skip = side === 'left' ? 'add' : 'remove'
  return (
    <pre className="min-h-[12rem] overflow-auto rounded-xl border bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap">
      {diff.map((d, i) => {
        if (d.type === skip) return null
        return (
          <div key={i} className={cn('-mx-1 rounded px-1', d.type === keep && (keep === 'add' ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' : 'bg-rose-500/15 text-rose-800 dark:text-rose-300'))}>
            {d.text || ' '}
          </div>
        )
      })}
    </pre>
  )
}

/** Side-by-side text comparison of two versions (uses the text read from each version). */
export function CompareVersionsDialog({ open, onOpenChange, versions = [], initialA, initialB }) {
  const [a, setA] = useState(initialA)
  const [b, setB] = useState(initialB)

  useEffect(() => {
    if (!open) return
    const sorted = [...versions].sort((x, y) => y.version_number - x.version_number)
    setA(initialA ?? sorted[1]?.id ?? sorted[0]?.id)
    setB(initialB ?? sorted[0]?.id)
  }, [open, versions, initialA, initialB])

  const va = versions.find((v) => v.id === a)
  const vb = versions.find((v) => v.id === b)
  const diff = useMemo(() => (va && vb ? lineDiff(va.ocr_text || '', vb.ocr_text || '') : []), [va, vb])
  const stats = diffStats(diff)
  const noText = va && vb && !va.ocr_text && !vb.ocr_text

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Compare versions</DialogTitle>
          <DialogDescription>Shows how the text inside the document changed between two versions.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>From</Label>
              <Select value={a} onValueChange={setA}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose a version" /></SelectTrigger>
                <SelectContent>{versions.map((v) => <SelectItem key={v.id} value={v.id}>Version {v.version_number}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>To</Label>
              <Select value={b} onValueChange={setB}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose a version" /></SelectTrigger>
                <SelectContent>{versions.map((v) => <SelectItem key={v.id} value={v.id}>Version {v.version_number}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {noText ? (
            <p className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">Neither version has text to compare yet. Text is read from the document after upload.</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                {stats.added === 0 && stats.removed === 0 ? 'The text is the same in both versions.' : `${stats.added} lines added, ${stats.removed} lines removed.`}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <DiffColumn diff={diff} side="left" />
                <DiffColumn diff={diff} side="right" />
              </div>
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
