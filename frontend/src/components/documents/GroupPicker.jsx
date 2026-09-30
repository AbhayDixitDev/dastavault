import { useMemo, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useGetGroupsQuery } from '@/store/api/groupsApi'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/** Flattens nested groups (children / subgroups) into one list. */
function flatten(groups = [], depth = 0, out = []) {
  for (const g of groups) {
    out.push({ ...g, depth })
    const kids = g.children || g.subgroups || []
    if (kids.length) flatten(kids, depth + 1, out)
  }
  return out
}

/** Multi-select of groups shown as chips. `value` is an array of group ids. */
export function GroupPicker({ value = [], onChange, disabled, className, compact = false }) {
  const { workspaceId, terminology: t } = useWorkspace()
  const { data: groups = [], isLoading } = useGetGroupsQuery(workspaceId, { skip: !workspaceId })
  const [open, setOpen] = useState(false)
  const all = useMemo(() => flatten(groups), [groups])
  const selected = useMemo(() => value.map((id) => all.find((g) => g.id === id)).filter(Boolean), [value, all])

  const toggle = (id) => {
    if (value.includes(id)) onChange?.(value.filter((v) => v !== id))
    else onChange?.([...value, id])
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {selected.map((g) => (
        <span key={g.id} className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-sm">
          {g.color && <span className="size-2 rounded-full" style={{ background: g.color }} />}
          <span className="max-w-[10rem] truncate">{g.name}</span>
          {!disabled && (
            <button type="button" className="tap-target -m-2 ml-0 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive" aria-label={`Remove ${g.name}`} onClick={() => toggle(g.id)}>
              <X className="size-3.5" />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="flex h-8 items-center gap-1 rounded-full border border-dashed px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
              <Plus className="size-4" /> {selected.length || compact ? 'Add' : `Add ${t.group_label.toLowerCase()}`}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-2">
            <ul className="scroll-inside max-h-64">
              {isLoading && <li className="px-2 py-3 text-sm text-muted-foreground">Loading...</li>}
              {!isLoading && all.length === 0 && (
                <li className="px-2 py-3 text-sm text-muted-foreground">No {t.group_label_plural.toLowerCase()} yet.</li>
              )}
              {all.map((g) => {
                const on = value.includes(g.id)
                return (
                  <li key={g.id}>
                    <button type="button" onClick={() => toggle(g.id)} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent', on && 'bg-accent/60')} style={{ paddingLeft: `${8 + g.depth * 14}px` }}>
                      <span className="size-2 shrink-0 rounded-full" style={{ background: g.color || 'var(--primary)' }} />
                      <span className="min-w-0 flex-1 truncate">{g.name}</span>
                      {on && <Check className="size-4 text-primary" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          </PopoverContent>
        </Popover>
      )}
      {disabled && selected.length === 0 && <span className="text-sm text-muted-foreground">None</span>}
    </div>
  )
}
