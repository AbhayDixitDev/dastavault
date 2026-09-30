import { useMemo, useState } from 'react'
import { Check, Plus, Search, X } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { initials } from '@/utils/format'
import { cn } from '@/lib/utils'

/**
 * Multi-select of people shown as chips. `value` is an array of person ids.
 * Uses the workspace's own words for "people".
 */
export function PeoplePicker({ value = [], onChange, disabled, className, compact = false }) {
  const { workspaceId, terminology: t } = useWorkspace()
  const { data: people = [], isLoading } = useGetPeopleQuery(workspaceId, { skip: !workspaceId })
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')

  const selected = useMemo(() => value.map((id) => people.find((p) => p.id === id)).filter(Boolean), [value, people])
  const options = useMemo(() => {
    const s = q.trim().toLowerCase()
    return people.filter((p) => !s || p.display_name?.toLowerCase().includes(s))
  }, [people, q])

  const toggle = (id) => {
    if (value.includes(id)) onChange?.(value.filter((v) => v !== id))
    else onChange?.([...value, id])
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {selected.map((p) => (
        <span key={p.id} className="flex items-center gap-1.5 rounded-full border bg-card py-1 pr-2 pl-1 text-sm">
          <Avatar className="size-6 text-[10px]">
            <AvatarFallback>{initials(p.display_name)}</AvatarFallback>
          </Avatar>
          <span className="max-w-[10rem] truncate">{p.display_name}</span>
          {!disabled && (
            <button type="button" className="tap-target -m-2 ml-0 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive" aria-label={`Remove ${p.display_name}`} onClick={() => toggle(p.id)}>
              <X className="size-3.5" />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="flex h-8 items-center gap-1 rounded-full border border-dashed px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
              <Plus className="size-4" /> {selected.length || compact ? 'Add' : `Add ${t.person_label.toLowerCase()}`}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-2">
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find a ${t.person_label.toLowerCase()}`} className="h-9 pl-8" />
            </div>
            <ul className="scroll-inside max-h-64">
              {isLoading && <li className="px-2 py-3 text-sm text-muted-foreground">Loading...</li>}
              {!isLoading && options.length === 0 && (
                <li className="px-2 py-3 text-sm text-muted-foreground">
                  {people.length === 0 ? `No ${t.person_label_plural.toLowerCase()} yet. Add them from the ${t.person_label_plural} page.` : 'No match.'}
                </li>
              )}
              {options.map((p) => {
                const on = value.includes(p.id)
                return (
                  <li key={p.id}>
                    <button type="button" onClick={() => toggle(p.id)} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent', on && 'bg-accent/60')}>
                      <Avatar className="size-7 text-[11px]"><AvatarFallback>{initials(p.display_name)}</AvatarFallback></Avatar>
                      <span className="min-w-0 flex-1 truncate">{p.display_name}</span>
                      {on && <Check className="size-4 text-primary" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          </PopoverContent>
        </Popover>
      )}
      {disabled && selected.length === 0 && <span className="text-sm text-muted-foreground">Nobody linked</span>}
    </div>
  )
}
