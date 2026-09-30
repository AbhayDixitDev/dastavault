import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import { useGetGroupsQuery } from '@/store/api/groupsApi'
import { useWorkspace } from '@/hooks/useWorkspace'
import { cn } from '@/lib/utils'
import { DOCUMENT_TYPES, loadDocumentTypes } from './documentTypes'

/**
 * Bottom sheet: name, type, people, groups -> onSave({ name, document_type, person_ids, group_ids, people, groups })
 */
export function SaveSheet({ open, onOpenChange, defaultName, pageCount = 1, saving = false, onSave }) {
  const { workspaceId, terminology: t } = useWorkspace()
  const { data: people = [] } = useGetPeopleQuery(workspaceId, { skip: !open })
  const { data: groups = [] } = useGetGroupsQuery(workspaceId, { skip: !open })
  const [types, setTypes] = useState(DOCUMENT_TYPES)
  const [name, setName] = useState(defaultName || '')
  const [type, setType] = useState('')
  const [personIds, setPersonIds] = useState([])
  const [groupIds, setGroupIds] = useState([])
  const [openedWith, setOpenedWith] = useState(null)

  // Reset the name each time the sheet opens (state adjusted during render, no effect needed).
  if (open && openedWith !== defaultName) {
    setOpenedWith(defaultName)
    setName(defaultName || '')
  } else if (!open && openedWith !== null) {
    setOpenedWith(null)
  }

  useEffect(() => {
    let alive = true
    loadDocumentTypes().then((list) => { if (alive) setTypes(list) })
    return () => { alive = false }
  }, [])

  const toggle = (list, set, id) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const submit = (e) => {
    e?.preventDefault?.()
    onSave?.({
      name: name.trim() || defaultName,
      document_type: type || null,
      person_ids: personIds,
      group_ids: groupIds,
      people,
      groups,
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto">
        <form onSubmit={submit} className="mx-auto w-full max-w-lg">
          <SheetHeader className="px-0">
            <SheetTitle>Save {pageCount === 1 ? 'this page' : `${pageCount} pages`}</SheetTitle>
            <SheetDescription>You can change the name and details later. We will suggest details once the text is read.</SheetDescription>
          </SheetHeader>

          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label htmlFor="scan-name">Name</Label>
              <Input id="scan-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName} maxLength={200} />
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose a type (optional)" /></SelectTrigger>
                <SelectContent>
                  {types.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {people.length > 0 && (
              <div className="space-y-2">
                <Label>Belongs to</Label>
                <div className="flex flex-wrap gap-2">
                  {people.map((p) => (
                    <Chip key={p.id} active={personIds.includes(p.id)} onClick={() => toggle(personIds, setPersonIds, p.id)}>{p.display_name}</Chip>
                  ))}
                </div>
              </div>
            )}

            {groups.length > 0 && (
              <div className="space-y-2">
                <Label>{t.group_label_plural || 'Groups'}</Label>
                <div className="flex flex-wrap gap-2">
                  {groups.map((g) => (
                    <Chip key={g.id} active={groupIds.includes(g.id)} onClick={() => toggle(groupIds, setGroupIds, g.id)}>{g.name}</Chip>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="safe-bottom flex gap-2 pb-2 pt-2">
            <Button type="button" variant="outline" size="lg" className="flex-1" onClick={() => onOpenChange?.(false)} disabled={saving}>Back</Button>
            <Button type="submit" size="lg" className="flex-1" disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-sm transition-colors', active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-accent')}
    >
      {active && <Check className="size-3.5" />}
      {children}
    </button>
  )
}
