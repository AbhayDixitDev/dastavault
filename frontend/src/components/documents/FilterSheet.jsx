import { useEffect, useState } from 'react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import { useGetGroupsQuery } from '@/store/api/groupsApi'
import { useGetTagsQuery } from '@/store/api/documentsApi'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { DocumentTypeSelect } from './DocumentTypeSelect'

export const EMPTY_FILTERS = {
  person_id: '',
  group_id: '',
  document_type: '',
  tag: '',
  favorite: false,
  date_from: '',
  date_to: '',
}

export function countActiveFilters(f = {}) {
  return Object.entries(f).filter(([k, v]) => k in EMPTY_FILTERS && v && v !== '').length
}

const ANY = '__any__'

function AnySelect({ value, onChange, placeholder, items }) {
  return (
    <Select value={value || ANY} onValueChange={(v) => onChange(v === ANY ? '' : v)}>
      <SelectTrigger className="w-full"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{placeholder}</SelectItem>
        {items.map((it) => <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

/** Bottom sheet (phone) / side sheet (desktop) with the list filters. */
export function FilterSheet({ open, onOpenChange, value, onApply }) {
  const { workspaceId, terminology: t } = useWorkspace()
  const { data: people = [] } = useGetPeopleQuery(workspaceId, { skip: !open })
  const { data: groups = [] } = useGetGroupsQuery(workspaceId, { skip: !open })
  const { data: tags = [] } = useGetTagsQuery(workspaceId, { skip: !open })
  const [draft, setDraft] = useState({ ...EMPTY_FILTERS, ...value })

  useEffect(() => {
    if (open) setDraft({ ...EMPTY_FILTERS, ...value })
  }, [open, value])

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90svh] sm:right-0 sm:inset-y-0 sm:left-auto sm:h-full sm:max-h-none sm:w-full sm:max-w-sm sm:rounded-none sm:border-l sm:border-t-0">
        <SheetHeader>
          <SheetTitle>Filter documents</SheetTitle>
          <SheetDescription>Show only the documents you need.</SheetDescription>
        </SheetHeader>
        <div className="scroll-inside flex min-h-0 flex-1 flex-col gap-4 px-4">
          <div className="grid gap-1.5">
            <Label>{t.person_label}</Label>
            <AnySelect value={draft.person_id} onChange={(v) => set('person_id', v)} placeholder={`Any ${t.person_label.toLowerCase()}`} items={people.map((p) => ({ value: p.id, label: p.display_name }))} />
          </div>
          <div className="grid gap-1.5">
            <Label>{t.group_label}</Label>
            <AnySelect value={draft.group_id} onChange={(v) => set('group_id', v)} placeholder={`Any ${t.group_label.toLowerCase()}`} items={groups.map((g) => ({ value: g.id, label: g.name }))} />
          </div>
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <DocumentTypeSelect value={draft.document_type} onChange={(v) => set('document_type', v)} allowAny />
          </div>
          <div className="grid gap-1.5">
            <Label>Tag</Label>
            <AnySelect value={draft.tag} onChange={(v) => set('tag', v)} placeholder="Any tag" items={tags.map((tg) => ({ value: tg.name, label: tg.name }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="f-from">Added from</Label>
              <Input id="f-from" type="date" value={draft.date_from} onChange={(e) => set('date_from', e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="f-to">Added until</Label>
              <Input id="f-to" type="date" value={draft.date_to} onChange={(e) => set('date_to', e.target.value)} />
            </div>
          </div>
          <label className="flex items-center justify-between rounded-xl border p-3">
            <span className="text-sm font-medium">Only favourites</span>
            <Switch checked={!!draft.favorite} onCheckedChange={(v) => set('favorite', v)} />
          </label>
        </div>
        <SheetFooter className="flex-row">
          <Button variant="outline" className="flex-1" onClick={() => { onApply?.({ ...EMPTY_FILTERS }); onOpenChange(false) }}>Clear</Button>
          <Button className="flex-1" onClick={() => { onApply?.(draft); onOpenChange(false) }}>Show results</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
