import { useMemo, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import dayjs from 'dayjs'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import { useGetGroupsQuery } from '@/store/api/groupsApi'
import { useGetMembersQuery } from '@/store/api/membersApi'
import { useGetTagListQuery } from '@/store/api/searchApi'
import { useDocumentTypes } from '@/services/search/documentTypes'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** Filter chips shown on the Search page, in contract order. */
export const FILTER_FIELDS = [
  { key: 'person', params: ['person_id'] },
  { key: 'group', params: ['group_id'] },
  { key: 'type', label: 'Document type', params: ['document_type'] },
  { key: 'date', label: 'Date', params: ['date_from', 'date_to'] },
  { key: 'expiry', label: 'Expiry', params: ['expiry_from', 'expiry_to'] },
  { key: 'uploaded_by', label: 'Uploaded by', params: ['uploaded_by'] },
  { key: 'tag', label: 'Tags', params: ['tag'] },
  { key: 'file_type', label: 'File type', params: ['file_type'] },
]

const FILE_TYPES = [
  { value: 'image', label: 'Photos and scans' },
  { value: 'pdf', label: 'PDF' },
  { value: 'text', label: 'Text and written' },
]

const today = () => dayjs().format('YYYY-MM-DD')

function OptionList({ options, value, onSelect, searchable = true, placeholder = 'Type to find', anyLabel = 'Any' }) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? options.filter((o) => o.label.toLowerCase().includes(s)) : options
  }, [options, q])
  return (
    <div className="flex flex-col gap-2">
      {searchable && options.length > 6 && (
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      )}
      <ul className="max-h-64 overflow-y-auto scroll-inside -mx-1" role="listbox">
        <li>
          <OptionRow label={anyLabel} selected={!value} onClick={() => onSelect('')} />
        </li>
        {filtered.map((o) => (
          <li key={o.value}>
            <OptionRow label={o.label} hint={o.hint} selected={value === o.value} onClick={() => onSelect(o.value)} />
          </li>
        ))}
        {filtered.length === 0 && <li className="px-2 py-3 text-sm text-muted-foreground">No match.</li>}
      </ul>
    </div>
  )
}

function OptionRow({ label, hint, selected, onClick }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent min-h-11',
        selected && 'font-medium text-primary',
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{selected && <Check className="size-4" />}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </button>
  )
}

function DateRange({ fromKey, toKey, filters, onChange, quick, close }) {
  const [from, setFrom] = useState(filters[fromKey] ?? '')
  const [to, setTo] = useState(filters[toKey] ?? '')
  const apply = (f, t) => {
    onChange({ ...filters, [fromKey]: f || '', [toKey]: t || '' })
    close?.()
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {quick.map((qk) => (
          <Button key={qk.label} type="button" size="sm" variant="outline" onClick={() => apply(qk.from, qk.to)}>
            {qk.label}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fromKey}-input`} className="text-xs">From</Label>
          <Input id={`${fromKey}-input`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${toKey}-input`} className="text-xs">To</Label>
          <Input id={`${toKey}-input`} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => apply('', '')}>
          Clear
        </Button>
        <Button type="button" size="sm" onClick={() => apply(from, to)}>
          Apply
        </Button>
      </div>
    </div>
  )
}

function TagField({ workspaceId, filters, onChange, close }) {
  const { data: tags = [] } = useGetTagListQuery(workspaceId, { skip: !workspaceId })
  const [text, setText] = useState(filters.tag ?? '')
  const options = tags.map((t) => ({ value: t.name, label: t.name, hint: t.document_count ? String(t.document_count) : undefined }))
  const set = (v) => {
    onChange({ ...filters, tag: v })
    close?.()
  }
  return (
    <div className="flex flex-col gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          set(text.trim())
        }}
        className="flex gap-2"
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a tag" aria-label="Tag" />
        <Button type="submit" size="sm" variant="secondary">
          Use
        </Button>
      </form>
      {options.length > 0 && <OptionList options={options} value={filters.tag ?? ''} onSelect={set} searchable={false} />}
    </div>
  )
}

/** The body of one filter (shared by the popover and the bottom sheet). */
export function FilterFields({ field, filters, onChange, workspaceId, close, terminology }) {
  const { data: people = [] } = useGetPeopleQuery(workspaceId, { skip: !workspaceId || field !== 'person' })
  const { data: groups = [] } = useGetGroupsQuery(workspaceId, { skip: !workspaceId || field !== 'group' })
  const { data: members = [] } = useGetMembersQuery(workspaceId, { skip: !workspaceId || field !== 'uploaded_by' })
  const types = useDocumentTypes()

  const pick = (param) => (v) => {
    onChange({ ...filters, [param]: v })
    close?.()
  }

  switch (field) {
    case 'person':
      return (
        <OptionList
          options={people.map((p) => ({ value: p.id, label: p.display_name, hint: p.relation_label || undefined }))}
          value={filters.person_id ?? ''}
          onSelect={pick('person_id')}
          placeholder={`Find a ${(terminology?.person_label ?? 'person').toLowerCase()}`}
          anyLabel="Anyone"
        />
      )
    case 'group':
      return (
        <OptionList
          options={groups.map((g) => ({ value: g.id, label: g.name }))}
          value={filters.group_id ?? ''}
          onSelect={pick('group_id')}
          placeholder={`Find a ${(terminology?.group_label ?? 'group').toLowerCase()}`}
          anyLabel="Any"
        />
      )
    case 'type':
      return (
        <OptionList options={types.map((t) => ({ value: t.key, label: t.label }))} value={filters.document_type ?? ''} onSelect={pick('document_type')} placeholder="Find a type" anyLabel="Any type" />
      )
    case 'date': {
      const y = dayjs().year()
      return (
        <DateRange
          fromKey="date_from"
          toKey="date_to"
          filters={filters}
          onChange={onChange}
          close={close}
          quick={[
            { label: 'Last 30 days', from: dayjs().subtract(30, 'day').format('YYYY-MM-DD'), to: today() },
            { label: 'This year', from: `${y}-01-01`, to: `${y}-12-31` },
            { label: 'Last year', from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
          ]}
        />
      )
    }
    case 'expiry': {
      const y = dayjs().year()
      return (
        <DateRange
          fromKey="expiry_from"
          toKey="expiry_to"
          filters={filters}
          onChange={onChange}
          close={close}
          quick={[
            { label: 'Next 30 days', from: today(), to: dayjs().add(30, 'day').format('YYYY-MM-DD') },
            { label: 'Next 90 days', from: today(), to: dayjs().add(90, 'day').format('YYYY-MM-DD') },
            { label: 'This year', from: today(), to: `${y}-12-31` },
            { label: 'Already expired', from: '', to: dayjs().subtract(1, 'day').format('YYYY-MM-DD') },
          ]}
        />
      )
    }
    case 'uploaded_by':
      return (
        <OptionList
          options={members.map((m) => ({ value: m.user_id, label: m.profile?.display_name || m.profile?.email || 'Member' }))}
          value={filters.uploaded_by ?? ''}
          onSelect={pick('uploaded_by')}
          placeholder="Find a member"
          anyLabel="Anyone"
        />
      )
    case 'tag':
      return <TagField workspaceId={workspaceId} filters={filters} onChange={onChange} close={close} />
    case 'file_type':
      return <OptionList options={FILE_TYPES} value={filters.file_type ?? ''} onSelect={pick('file_type')} searchable={false} anyLabel="Any file" />
    default:
      return null
  }
}

/** Hook: returns a function that describes the active value of a filter chip. */
function useChipLabels(workspaceId, filters, terminology) {
  const { data: people = [] } = useGetPeopleQuery(workspaceId, { skip: !workspaceId || !filters.person_id })
  const { data: groups = [] } = useGetGroupsQuery(workspaceId, { skip: !workspaceId || !filters.group_id })
  const { data: members = [] } = useGetMembersQuery(workspaceId, { skip: !workspaceId || !filters.uploaded_by })
  const types = useDocumentTypes()

  return (field) => {
    const base = field.label ?? (field.key === 'person' ? terminology?.person_label ?? 'Person' : field.key === 'group' ? terminology?.group_label ?? 'Group' : field.key)
    switch (field.key) {
      case 'person': {
        const v = filters.person_id
        return v ? people.find((p) => p.id === v)?.display_name ?? base : base
      }
      case 'group': {
        const v = filters.group_id
        return v ? groups.find((g) => g.id === v)?.name ?? base : base
      }
      case 'type': {
        const v = filters.document_type
        return v ? types.find((t) => t.key === v)?.label ?? v : base
      }
      case 'date': {
        const { date_from: f, date_to: t } = filters
        if (!f && !t) return base
        return f && t ? `${dayjs(f).format('D MMM YY')} - ${dayjs(t).format('D MMM YY')}` : f ? `After ${dayjs(f).format('D MMM YY')}` : `Before ${dayjs(t).format('D MMM YY')}`
      }
      case 'expiry': {
        const { expiry_from: f, expiry_to: t } = filters
        if (!f && !t) return base
        return f && t ? `Expires ${dayjs(f).format('D MMM')} - ${dayjs(t).format('D MMM YY')}` : f ? `Expires after ${dayjs(f).format('D MMM YY')}` : `Expired by ${dayjs(t).format('D MMM YY')}`
      }
      case 'uploaded_by': {
        const v = filters.uploaded_by
        return v ? `By ${members.find((m) => m.user_id === v)?.profile?.display_name ?? 'member'}` : base
      }
      case 'tag':
        return filters.tag ? `#${filters.tag}` : base
      case 'file_type':
        return filters.file_type ? FILE_TYPES.find((f) => f.value === filters.file_type)?.label ?? filters.file_type : base
      default:
        return base
    }
  }
}

function isActive(field, filters) {
  return field.params.some((p) => filters[p] !== undefined && filters[p] !== null && String(filters[p]) !== '')
}

/** The clickable part of a chip. Spreads props (and ref) on the button so Radix can anchor to it. */
function ChipButton({ label, active, className, ...props }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex h-9 items-center gap-1 rounded-full border px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
        active ? 'rounded-r-none border-primary/40 bg-primary/10 text-primary' : 'bg-card hover:bg-accent',
        className,
      )}
      {...props}
    >
      <span className="max-w-[10rem] truncate">{label}</span>
      {!active && <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />}
    </button>
  )
}

function ClearButton({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Clear ${label}`}
      className="inline-flex h-9 items-center rounded-r-full border border-l-0 border-primary/40 bg-primary/10 px-2 text-primary outline-none hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <X className="size-3.5" />
    </button>
  )
}

function baseLabel(field, terminology) {
  if (field.label) return field.label
  if (field.key === 'person') return terminology?.person_label ?? 'Person'
  if (field.key === 'group') return terminology?.group_label ?? 'Group'
  return field.key
}

/**
 * Row of filter chips. Each chip opens a popover on desktop or a bottom sheet
 * on mobile with the options for that filter.
 */
export function FilterChips({ filters, onChange, workspaceId, terminology, className }) {
  const isDesktop = useIsDesktop()
  const [openKey, setOpenKey] = useState(null)
  const labelFor = useChipLabels(workspaceId, filters, terminology)
  const openField = FILTER_FIELDS.find((f) => f.key === openKey) ?? null
  const activeCount = FILTER_FIELDS.filter((f) => isActive(f, filters)).length

  const clear = (field) => {
    const next = { ...filters }
    field.params.forEach((p) => delete next[p])
    onChange(next)
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {FILTER_FIELDS.map((field) => {
        const active = isActive(field, filters)
        const label = labelFor(field)
        return (
          <span key={field.key} className="inline-flex items-stretch">
            {isDesktop ? (
              <Popover open={openKey === field.key} onOpenChange={(o) => setOpenKey(o ? field.key : null)}>
                <PopoverTrigger asChild>
                  <ChipButton label={label} active={active} />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">{baseLabel(field, terminology)}</p>
                  <FilterFields field={field.key} filters={filters} onChange={onChange} workspaceId={workspaceId} terminology={terminology} close={() => setOpenKey(null)} />
                </PopoverContent>
              </Popover>
            ) : (
              <ChipButton label={label} active={active} onClick={() => setOpenKey(field.key)} />
            )}
            {active && <ClearButton label={label} onClick={() => clear(field)} />}
          </span>
        )
      })}
      {activeCount > 0 && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange({})}>
          Clear all
        </Button>
      )}

      {!isDesktop && (
        <FilterSheet open={Boolean(openField)} onOpenChange={(o) => !o && setOpenKey(null)} field={openField?.key} title={openField ? baseLabel(openField, terminology) : ''} filters={filters} onChange={onChange} workspaceId={workspaceId} terminology={terminology} />
      )}
    </div>
  )
}

/** Bottom sheet for one filter (mobile). */
export function FilterSheet({ open, onOpenChange, field, title, filters, onChange, workspaceId, terminology }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85svh]">
        <SheetHeader>
          <SheetTitle>{title || 'Filter'}</SheetTitle>
          <SheetDescription>Narrow down your results.</SheetDescription>
        </SheetHeader>
        <div className="overflow-y-auto px-4 pb-4">
          {field && <FilterFields field={field} filters={filters} onChange={onChange} workspaceId={workspaceId} terminology={terminology} close={() => onOpenChange(false)} />}
        </div>
      </SheetContent>
    </Sheet>
  )
}
