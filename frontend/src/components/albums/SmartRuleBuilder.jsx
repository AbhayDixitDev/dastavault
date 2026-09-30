import { useMemo } from 'react'
import { Plus, Trash2, Wand2 } from 'lucide-react'
import dayjs from 'dayjs'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import { useGetGroupsQuery } from '@/store/api/groupsApi'
import { useGetTagListQuery } from '@/store/api/searchApi'
import { useDocumentTypes, IDENTITY_TYPES, typeLabel } from '@/services/search/documentTypes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

/** Rule fields from the contract, with the operators each one allows. */
export const RULE_FIELDS = [
  { key: 'person_id', label: 'Person', ops: ['eq', 'in'], input: 'person' },
  { key: 'group_id', label: 'Group', ops: ['eq', 'in'], input: 'group' },
  { key: 'document_type', label: 'Document type', ops: ['eq', 'in'], input: 'type' },
  { key: 'tag', label: 'Tag', ops: ['eq', 'contains'], input: 'tag' },
  { key: 'created_after', label: 'Added after', ops: ['gte'], input: 'date' },
  { key: 'created_before', label: 'Added before', ops: ['lte'], input: 'date' },
  { key: 'expiry_within_days', label: 'Expires within (days)', ops: ['lte'], input: 'number' },
  { key: 'organisation', label: 'Organisation', ops: ['eq', 'contains'], input: 'text' },
  { key: 'text', label: 'Words inside', ops: ['contains'], input: 'text' },
]

const OP_LABELS = { eq: 'is', in: 'is any of', contains: 'contains', gte: 'on or after', lte: 'up to' }

export function emptyRule(field = 'person_id') {
  const def = RULE_FIELDS.find((f) => f.key === field) ?? RULE_FIELDS[0]
  return { field: def.key, op: def.ops[0], value: def.ops[0] === 'in' ? [] : '' }
}

export function normaliseRules(rules) {
  const all = Array.isArray(rules?.all) ? rules.all : []
  return { all: all.filter((r) => r && r.field) }
}

/** Drops rows with empty values so the API only gets real rules. */
export function compactRules(rules) {
  const all = normaliseRules(rules).all.filter((r) => (Array.isArray(r.value) ? r.value.length > 0 : r.value !== '' && r.value !== null && r.value !== undefined))
  return { all: all.map((r) => ({ field: r.field, op: r.op, value: r.field === 'expiry_within_days' ? Number(r.value) : r.value })) }
}

/** Presets shown above the builder. `people` adds one preset per person. */
export function rulePresets({ people = [], personLabel = 'Person' } = {}) {
  const daysLeftInYear = Math.max(1, dayjs().endOf('year').diff(dayjs(), 'day'))
  const presets = [
    { key: 'identity', label: 'Identity documents', rules: { all: [{ field: 'document_type', op: 'in', value: IDENTITY_TYPES }] } },
    { key: 'expiring', label: 'Expiring this year', rules: { all: [{ field: 'expiry_within_days', op: 'lte', value: daysLeftInYear }] } },
  ]
  people.slice(0, 6).forEach((p) => {
    presets.push({ key: `person-${p.id}`, label: `${p.display_name}'s documents`, hint: personLabel, rules: { all: [{ field: 'person_id', op: 'eq', value: p.id }] } })
  })
  return presets
}

/** Plain-words summary of a rule set, e.g. "Person is Rahul and Document type is Medical report". */
export function describeRules(rules, { people = [], groups = [], types } = {}) {
  const all = normaliseRules(rules).all
  if (!all.length) return 'No rules yet'
  const name = (list, id, key = 'display_name') => list.find((x) => x.id === id)?.[key] ?? id
  return all
    .map((r) => {
      const f = RULE_FIELDS.find((x) => x.key === r.field)
      const label = f?.label ?? r.field
      let value = r.value
      const arr = Array.isArray(value) ? value : [value]
      if (r.field === 'person_id') value = arr.map((id) => name(people, id)).join(', ')
      else if (r.field === 'group_id') value = arr.map((id) => name(groups, id, 'name')).join(', ')
      else if (r.field === 'document_type') value = arr.map((k) => typeLabel(k, types)).join(', ')
      else if (r.field === 'expiry_within_days') return `Expires within ${value} days`
      else value = arr.join(', ')
      return `${label} ${OP_LABELS[r.op] ?? r.op} ${value}`
    })
    .join(' and ')
}

function MultiPick({ options, value = [], onChange, placeholder = 'Choose' }) {
  const chosen = options.filter((o) => value.includes(o.value))
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-9 w-full justify-start truncate font-normal">
          <span className="truncate">{chosen.length ? chosen.map((c) => c.label).join(', ') : placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <ul className="max-h-64 overflow-y-auto scroll-inside">
          {options.map((o) => {
            const on = value.includes(o.value)
            return (
              <li key={o.value}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-accent">
                  <Checkbox checked={on} onCheckedChange={(c) => onChange(c ? [...value, o.value] : value.filter((v) => v !== o.value))} />
                  <span className="truncate">{o.label}</span>
                </label>
              </li>
            )
          })}
          {options.length === 0 && <li className="px-2 py-2 text-sm text-muted-foreground">Nothing to choose yet.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function ValueEditor({ rule, def, onChange, people, groups, tags, types }) {
  const multi = rule.op === 'in'
  const options = useMemo(() => {
    switch (def.input) {
      case 'person':
        return people.map((p) => ({ value: p.id, label: p.display_name }))
      case 'group':
        return groups.map((g) => ({ value: g.id, label: g.name }))
      case 'type':
        return types.map((t) => ({ value: t.key, label: t.label }))
      default:
        return []
    }
  }, [def.input, people, groups, types])

  if (def.input === 'person' || def.input === 'group' || def.input === 'type') {
    if (multi) return <MultiPick options={options} value={Array.isArray(rule.value) ? rule.value : []} onChange={(v) => onChange(v)} />
    return (
      <Select value={typeof rule.value === 'string' ? rule.value : ''} onValueChange={(v) => onChange(v)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (def.input === 'tag') {
    return (
      <>
        <Input list="dv-rule-tags" value={rule.value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="Tag name" aria-label="Tag" />
        <datalist id="dv-rule-tags">
          {tags.map((t) => (
            <option key={t.id ?? t.name} value={t.name} />
          ))}
        </datalist>
      </>
    )
  }
  if (def.input === 'date') return <Input type="date" value={rule.value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={def.label} />
  if (def.input === 'number') return <Input type="number" min={1} max={3650} value={rule.value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="30" aria-label={def.label} />
  return <Input value={rule.value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={def.input === 'text' ? 'Type words' : ''} aria-label={def.label} />
}

/**
 * Builds `rules.all` for a smart album. Every rule must be true ("and").
 * `value` is `{ all: [{ field, op, value }] }`; `onChange` receives the same shape.
 */
export function SmartRuleBuilder({ value, onChange, workspaceId, terminology, showPresets = true, className }) {
  const rules = normaliseRules(value)
  const { data: people = [] } = useGetPeopleQuery(workspaceId, { skip: !workspaceId })
  const { data: groups = [] } = useGetGroupsQuery(workspaceId, { skip: !workspaceId })
  const { data: tags = [] } = useGetTagListQuery(workspaceId, { skip: !workspaceId })
  const types = useDocumentTypes()
  const presets = useMemo(() => rulePresets({ people, personLabel: terminology?.person_label }), [people, terminology?.person_label])

  const update = (i, patch) => {
    const all = rules.all.map((r, idx) => (idx === i ? { ...r, ...patch } : r))
    onChange({ all })
  }
  const setField = (i, field) => {
    const def = RULE_FIELDS.find((f) => f.key === field)
    update(i, { field, op: def.ops[0], value: def.ops[0] === 'in' ? [] : '' })
  }
  const setOp = (i, op) => {
    const r = rules.all[i]
    const wasMulti = r.op === 'in'
    const isMulti = op === 'in'
    let value = r.value
    if (wasMulti && !isMulti) value = Array.isArray(value) ? value[0] ?? '' : value
    if (!wasMulti && isMulti) value = value ? [value] : []
    update(i, { op, value })
  }
  const remove = (i) => onChange({ all: rules.all.filter((_, idx) => idx !== i) })
  const add = () => onChange({ all: [...rules.all, emptyRule(rules.all.length ? 'document_type' : 'person_id')] })

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {showPresets && (
        <div className="flex flex-col gap-1.5">
          <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Wand2 className="size-3.5" /> Quick start
          </p>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button key={p.key} type="button" onClick={() => onChange(p.rules)} className="rounded-full border bg-card px-3 py-1 text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 outline-none">
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {rules.all.length === 0 && <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">Add a rule. Documents that match every rule appear in this album automatically.</p>}
        {rules.all.map((rule, i) => {
          const def = RULE_FIELDS.find((f) => f.key === rule.field) ?? RULE_FIELDS[0]
          return (
            <div key={i} className="grid grid-cols-1 gap-2 rounded-xl border bg-card p-2 sm:grid-cols-[1fr_auto_1.2fr_auto] sm:items-center">
              {i > 0 && <span className="text-xs font-medium text-muted-foreground sm:col-span-4">and</span>}
              <Select value={rule.field} onValueChange={(v) => setField(i, v)}>
                <SelectTrigger className="w-full" aria-label="Field">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RULE_FIELDS.map((f) => (
                    <SelectItem key={f.key} value={f.key}>
                      {f.key === 'person_id' ? terminology?.person_label ?? f.label : f.key === 'group_id' ? terminology?.group_label ?? f.label : f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {def.ops.length > 1 ? (
                <Select value={rule.op} onValueChange={(v) => setOp(i, v)}>
                  <SelectTrigger className="w-full sm:w-28" aria-label="Condition">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {def.ops.map((op) => (
                      <SelectItem key={op} value={op}>
                        {OP_LABELS[op]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="px-1 text-sm text-muted-foreground">{OP_LABELS[rule.op]}</span>
              )}
              <ValueEditor rule={rule} def={def} onChange={(v) => update(i, { value: v })} people={people} groups={groups} tags={tags} types={types} />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove rule" onClick={() => remove(i)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          )
        })}
      </div>

      <div>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus /> Add rule
        </Button>
      </div>
    </div>
  )
}
