import { useEffect, useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { usePickDocumentsQuery } from '@/store/api/searchApi'
import { useDocumentTypes, typeLabel } from '@/services/search/documentTypes'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBox } from '@/components/common/ErrorBox'
import { DocumentThumb } from './DocumentThumb'
import { formatDate } from '@/utils/format'
import { cn } from '@/lib/utils'

function useDebounced(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * Search and pick one or many documents. Used by albums (add documents) and
 * reminders (choose the document). Calls `onPick(documents[])`.
 */
export function DocumentPicker({ open, onOpenChange, workspaceId, multiple = false, excludeIds = [], onPick, title, description, confirmLabel }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 300)
  const [selected, setSelected] = useState(new Map())
  const types = useDocumentTypes()
  const { data, isLoading, isFetching, error, refetch } = usePickDocumentsQuery({ workspaceId, q: dq, limit: 40 }, { skip: !open || !workspaceId })
  const excluded = useMemo(() => new Set(excludeIds), [excludeIds])
  const docs = (data?.documents ?? []).filter((d) => !excluded.has(d.id))

  useEffect(() => {
    if (open) {
      setQ('')
      setSelected(new Map())
    }
  }, [open])

  const toggle = (doc) => {
    if (!multiple) {
      onPick?.([doc])
      onOpenChange(false)
      return
    }
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(doc.id)) next.delete(doc.id)
      else next.set(doc.id, doc)
      return next
    })
  }

  const confirm = () => {
    onPick?.([...selected.values()])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title ?? (multiple ? 'Add documents' : 'Choose a document')}</DialogTitle>
          <DialogDescription>{description ?? 'Search by name, person or type.'}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your documents" className="pl-9" aria-label="Search documents" />
        </div>
        <DialogBody className="max-h-[50svh]">
          {error && <ErrorBox error={error} onRetry={refetch} className="mb-2" />}
          {isLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          ) : docs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{dq ? 'Nothing found. Try fewer words.' : 'No documents yet.'}</p>
          ) : (
            <ul className={cn('flex flex-col gap-1', isFetching && 'opacity-70')}>
              {docs.map((doc) => {
                const on = selected.has(doc.id)
                return (
                  <li key={doc.id}>
                    <button
                      type="button"
                      onClick={() => toggle(doc)}
                      aria-pressed={multiple ? on : undefined}
                      className={cn('flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50', on && 'bg-primary/5')}
                    >
                      {multiple ? (
                        <span aria-hidden="true" className={cn('flex size-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                          {on && <Check className="size-3.5" />}
                        </span>
                      ) : null}
                      <DocumentThumb workspaceId={workspaceId} fileId={doc.thumbnail_file_id} className="size-10 rounded-lg" iconClassName="size-4" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{doc.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[doc.document_type ? typeLabel(doc.document_type, types) : null, doc.expiry_date ? `Expires ${formatDate(doc.expiry_date)}` : doc.created_at ? `Added ${formatDate(doc.created_at)}` : null].filter(Boolean).join(' - ')}
                        </span>
                      </span>
                      {!multiple && <Check className="size-4 opacity-0" aria-hidden="true" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </DialogBody>
        {multiple && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={selected.size === 0}>
              {confirmLabel ?? `Add ${selected.size || ''} document${selected.size === 1 ? '' : 's'}`.replace(/\s+/g, ' ')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
