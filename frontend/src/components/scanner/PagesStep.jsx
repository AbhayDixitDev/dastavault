import { useState } from 'react'
import { ArrowDown, ArrowUp, Camera, Crop, FileImage, FileText, GripVertical, RefreshCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

/**
 * Review, reorder and choose how to save.
 * props: pages, output ('images'|'pdf'), onOutput, onMove(id, dir), onReorder(from, to),
 *        onDelete(id), onRetake(id), onEdit(id), onAddPage(), onSave(), onDiscard()
 */
export function PagesStep({ pages, output, onOutput, onMove, onReorder, onDelete, onRetake, onEdit, onAddPage, onSave, onDiscard }) {
  const [dragIndex, setDragIndex] = useState(null)
  const [overIndex, setOverIndex] = useState(null)

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Your pages"
        description={pages.length === 1 ? '1 page ready. Add more or save.' : `${pages.length} pages ready. Drag to reorder, then save.`}
        actions={(
          <Button variant="outline" onClick={onAddPage}>
            <Camera /> Add page
          </Button>
        )}
      />

      {pages.length === 0 ? (
        <EmptyState icon={Camera} title="No pages yet" description="Take a photo of each page. We will straighten and clean it for you." action={<Button onClick={onAddPage}><Camera /> Open camera</Button>} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {pages.map((p, i) => (
            <li
              key={p.id}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => { e.preventDefault(); if (overIndex !== i) setOverIndex(i) }}
              onDragLeave={() => setOverIndex(null)}
              onDrop={(e) => { e.preventDefault(); if (dragIndex != null && dragIndex !== i) onReorder?.(dragIndex, i); setDragIndex(null); setOverIndex(null) }}
              onDragEnd={() => { setDragIndex(null); setOverIndex(null) }}
              className={cn('flex gap-3 rounded-2xl border bg-card p-3 transition-colors', overIndex === i && dragIndex !== i && 'border-primary bg-accent')}
            >
              <button type="button" onClick={() => onEdit?.(p.id)} className="relative h-32 w-24 shrink-0 overflow-hidden rounded-lg bg-muted" aria-label={`Edit page ${i + 1}`}>
                {p.thumbUrl || p.previewUrl ? (
                  <img src={p.thumbUrl || p.previewUrl} alt={`Page ${i + 1}`} className="size-full object-cover" />
                ) : (
                  <FileImage className="absolute inset-0 m-auto size-6 text-muted-foreground" />
                )}
                <span className="absolute left-1 top-1 rounded-md bg-black/60 px-1.5 text-xs text-white">{i + 1}</span>
              </button>
              <div className="flex min-w-0 flex-1 flex-col justify-between">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">Page {i + 1}</p>
                    <p className="text-xs text-muted-foreground">{p.processed ? 'Cleaned and straightened' : 'Will be cleaned when you save'}</p>
                  </div>
                  <GripVertical className="hidden size-4 shrink-0 cursor-grab text-muted-foreground sm:block" />
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => onMove?.(p.id, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp /></Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => onMove?.(p.id, 1)} disabled={i === pages.length - 1} aria-label="Move down"><ArrowDown /></Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => onEdit?.(p.id)} aria-label="Adjust crop"><Crop /></Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => onRetake?.(p.id)} aria-label="Retake"><RefreshCcw /></Button>
                  <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" onClick={() => onDelete?.(p.id)} aria-label="Delete page"><Trash2 /></Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pages.length > 0 && (
        <div className="mt-6 space-y-4 rounded-2xl border bg-card p-4">
          <p className="font-medium">How do you want to save it?</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <OutputOption icon={FileImage} title="Save as images" description="One image per page. Best for ID cards and photos." active={output === 'images'} onClick={() => onOutput('images')} />
            <OutputOption icon={FileText} title="Save as one PDF" description="All pages combined. Best for multi-page papers. Images are kept too." active={output === 'pdf'} onClick={() => onOutput('pdf')} />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={onDiscard} className="text-muted-foreground">Discard scan</Button>
            <Button size="lg" onClick={onSave}>Save {pages.length === 1 ? 'page' : `${pages.length} pages`}</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function OutputOption({ icon: Icon, title, description, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('flex items-start gap-3 rounded-xl border p-3 text-left transition-colors', active ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'hover:bg-accent')}
    >
      <Icon className={cn('mt-0.5 size-5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}
