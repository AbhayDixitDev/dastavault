import { useEffect, useState } from 'react'
import { FileText, FolderOpen, Plus, User, X } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import { useGetGroupsQuery } from '@/store/api/groupsApi'
import { api } from '@/services/api/client'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

const ICONS = { person: User, group: FolderOpen, document: FileText }

/**
 * Chips for the people, groups and documents a note is linked to, plus a picker.
 * `links` = [{ entity_type, entity_id, label? }]. onChange(nextLinks).
 */
export function LinkPicker({ links = [], onChange, readOnly = false }) {
  const { workspaceId, terminology: t } = useWorkspace()
  const { data: people = [] } = useGetPeopleQuery(workspaceId)
  const { data: groups = [] } = useGetGroupsQuery(workspaceId)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('person')
  const [q, setQ] = useState('')
  const [docs, setDocs] = useState([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!open || tab !== 'document') return undefined
    const term = q.trim()
    if (term.length < 2) {
      setDocs([])
      return undefined
    }
    let alive = true
    setSearching(true)
    const h = setTimeout(async () => {
      try {
        const r = await api.get(`/workspaces/${workspaceId}/search?q=${encodeURIComponent(term)}&limit=10`)
        if (!alive) return
        setDocs((r?.results || []).map((x) => x.document).filter((d) => d && d.document_type !== 'note'))
      } catch {
        if (alive) setDocs([])
      } finally {
        if (alive) setSearching(false)
      }
    }, 300)
    return () => {
      alive = false
      clearTimeout(h)
    }
  }, [open, tab, q, workspaceId])

  const labelOf = (l) => {
    if (l.label) return l.label
    if (l.entity_type === 'person') return people.find((p) => p.id === l.entity_id)?.display_name || t.person_label
    if (l.entity_type === 'group') return groups.find((g) => g.id === l.entity_id)?.name || t.group_label
    return 'Document'
  }

  const has = (type, id) => links.some((l) => l.entity_type === type && l.entity_id === id)
  const add = (type, id, label) => {
    if (has(type, id)) return
    onChange?.([...links, { entity_type: type, entity_id: id, label }])
  }
  const remove = (l) => onChange?.(links.filter((x) => !(x.entity_type === l.entity_type && x.entity_id === l.entity_id)))

  const s = q.trim().toLowerCase()
  const list =
    tab === 'person'
      ? people.filter((p) => !s || p.display_name.toLowerCase().includes(s)).map((p) => ({ id: p.id, label: p.display_name }))
      : tab === 'group'
        ? groups.filter((g) => !s || g.name.toLowerCase().includes(s)).map((g) => ({ id: g.id, label: g.name }))
        : docs.map((d) => ({ id: d.id, label: d.name }))

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {links.map((l) => {
        const Icon = ICONS[l.entity_type] || FileText
        return (
          <span key={`${l.entity_type}:${l.entity_id}`} className="inline-flex h-8 items-center gap-1 rounded-full border bg-background px-2.5 text-xs font-medium">
            <Icon className="size-3.5 text-muted-foreground" />
            <span className="max-w-40 truncate">{labelOf(l)}</span>
            {!readOnly && (
              <button type="button" onClick={() => remove(l)} aria-label={`Remove ${labelOf(l)}`} className="ml-0.5 rounded-full p-0.5 hover:bg-accent">
                <X className="size-3" />
              </button>
            )}
          </span>
        )
      })}
      {!readOnly && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-8 rounded-full">
              <Plus /> Link
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-2" align="start">
            <Tabs value={tab} onValueChange={(v) => { setTab(v); setQ('') }}>
              <TabsList className="w-full">
                <TabsTrigger value="person" className="flex-1">{t.person_label_plural}</TabsTrigger>
                <TabsTrigger value="group" className="flex-1">{t.group_label_plural}</TabsTrigger>
                <TabsTrigger value="document" className="flex-1">Documents</TabsTrigger>
              </TabsList>
            </Tabs>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'document' ? 'Search documents' : 'Find by name'} className="mt-2" autoFocus />
            <ul className="mt-2 max-h-56 overflow-y-auto">
              {list.length === 0 ? (
                <li className="px-2 py-3 text-center text-sm text-muted-foreground">
                  {tab === 'document' ? (searching ? 'Searching...' : s.length < 2 ? 'Type to search' : 'Nothing found') : 'Nothing found'}
                </li>
              ) : (
                list.map((x) => (
                  <li key={x.id}>
                    <button
                      type="button"
                      onClick={() => add(tab, x.id, x.label)}
                      disabled={has(tab, x.id)}
                      className={cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent disabled:opacity-50')}
                    >
                      {(() => { const Icon = ICONS[tab]; return <Icon className="size-4 text-muted-foreground" /> })()}
                      <span className="truncate">{x.label}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
