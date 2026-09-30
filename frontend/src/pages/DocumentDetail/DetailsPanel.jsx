import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, Pencil, Sparkles, Star, X } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useUpdateDocumentMutation, useUpdateDocumentTagsMutation, useGetSuggestionsQuery, useAcceptSuggestionMutation } from '@/store/api/documentsApi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { errorMessage } from '@/components/common/ErrorBox'
import { DocumentTypeSelect } from '@/components/documents/DocumentTypeSelect'
import { PeoplePicker } from '@/components/documents/PeoplePicker'
import { GroupPicker } from '@/components/documents/GroupPicker'
import { TagInput } from '@/components/documents/TagInput'
import { ExpiryChip } from '@/components/documents/ExpiryChip'
import { VISIBILITY_OPTIONS, documentTypeLabel } from '@/components/documents/documentTypes'
import { formatDate } from '@/utils/format'

const SUGGESTION_LABELS = {
  document_type: 'Type',
  person_name: 'Belongs to',
  organisation: 'Organisation',
  document_number: 'Document number',
  issue_date: 'Issue date',
  expiry_date: 'Expiry date',
  invoice_number: 'Invoice number',
  amount: 'Amount',
  currency: 'Currency',
  vendor: 'Seller',
  policy_number: 'Policy number',
  registration_number: 'Registration number',
  email: 'Email',
  phone: 'Phone',
  address: 'Address',
  category: 'Category',
  keywords: 'Keywords',
  summary: 'Summary',
  suggested_name: 'Name',
  person_id: 'Belongs to',
  group_id: 'Group',
}

const DISMISS_KEY = 'dv.dismissedSuggestions'
function readDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')) } catch { return new Set() }
}
function writeDismissed(set) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...set].slice(-500))) } catch { /* ignore */ }
}

/** A field that saves when you leave it (blur) or press Enter. */
function SaveOnBlurField({ id, label, value, onSave, type = 'text', multiline = false, placeholder, disabled }) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])
  const commit = () => {
    const next = draft.trim()
    if ((value ?? '') !== next) onSave(next || null)
  }
  const Comp = multiline ? Textarea : Input
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Comp
        id={id}
        type={multiline ? undefined : type}
        rows={multiline ? 3 : undefined}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (!multiline && e.key === 'Enter') e.currentTarget.blur() }}
      />
    </div>
  )
}

/** Editable details for one document. Every change saves right away. */
export function DetailsPanel({ workspaceId, document: doc, canEdit }) {
  const { terminology: t } = useWorkspace()
  const [updateDocument] = useUpdateDocumentMutation()
  const [updateTags] = useUpdateDocumentTagsMutation()
  const [acceptSuggestion, { isLoading: accepting }] = useAcceptSuggestionMutation()
  const { data: fetched } = useGetSuggestionsQuery({ workspaceId, documentId: doc.id })
  const [dismissed, setDismissed] = useState(readDismissed)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(doc.name)
  useEffect(() => setNameDraft(doc.name), [doc.name])

  const save = async (fields, ok) => {
    try {
      await updateDocument({ workspaceId, documentId: doc.id, ...fields }).unwrap()
      if (ok) toast.success(ok)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const saveName = () => {
    const next = nameDraft.trim()
    setEditingName(false)
    if (next && next !== doc.name) save({ name: next }, 'Name saved.')
    else setNameDraft(doc.name)
  }

  const suggestions = useMemo(() => {
    const list = fetched ?? doc.suggestions ?? []
    return list.filter((s) => !s.accepted_at && !dismissed.has(s.id))
  }, [fetched, doc.suggestions, dismissed])

  const nameSuggestion = suggestions.find((s) => s.key === 'suggested_name' && s.value && s.value !== doc.name)
  const otherSuggestions = suggestions.filter((s) => s.key !== 'suggested_name' && s.key !== 'person_id' && s.key !== 'group_id')

  const dismiss = (s) => {
    const next = new Set(dismissed)
    next.add(s.id)
    setDismissed(next)
    writeDismissed(next)
  }

  const accept = async (s) => {
    try {
      if (s.key === 'suggested_name') {
        await updateDocument({ workspaceId, documentId: doc.id, name: s.value }).unwrap()
      } else {
        await acceptSuggestion({ workspaceId, documentId: doc.id, suggestionId: s.id }).unwrap()
      }
      dismiss(s)
      toast.success('Added to the details.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const personIds = (doc.people ?? []).map((p) => p.id)
  const groupIds = (doc.groups ?? []).map((g) => g.id)
  const tagNames = (doc.tags ?? []).map((tg) => tg.name)

  const onTags = async (names) => {
    try {
      await updateTags({ workspaceId, documentId: doc.id, names }).unwrap()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {nameSuggestion && canEdit && (
        <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-primary"><Sparkles className="size-3.5" /> Suggested name</p>
          <p className="text-sm font-medium">{nameSuggestion.value}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => accept(nameSuggestion)} disabled={accepting}><Check /> Use this name</Button>
            <Button size="sm" variant="ghost" onClick={() => dismiss(nameSuggestion)}>Keep mine</Button>
          </div>
        </div>
      )}

      {/* Name */}
      <div className="flex items-start gap-2">
        {editingName ? (
          <Input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={saveName} onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setNameDraft(doc.name); setEditingName(false) } }} className="text-lg font-semibold" aria-label="Document name" />
        ) : (
          <h1 className="min-w-0 flex-1 text-xl leading-tight font-bold break-words">{doc.name}</h1>
        )}
        {canEdit && !editingName && (
          <Button size="icon-sm" variant="ghost" aria-label="Edit name" onClick={() => setEditingName(true)}><Pencil /></Button>
        )}
        {canEdit && (
          <Button size="icon-sm" variant="ghost" aria-label={doc.is_favorite ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={!!doc.is_favorite} onClick={() => save({ is_favorite: !doc.is_favorite })}>
            <Star className={doc.is_favorite ? 'fill-amber-400 text-amber-400' : ''} />
          </Button>
        )}
      </div>
      <div className="-mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Added {formatDate(doc.created_at)}</span>
        {doc.page_count > 0 && <span>· {doc.page_count} {doc.page_count === 1 ? 'page' : 'pages'}</span>}
        {doc.status === 'processing' && <Badge variant="secondary">Getting ready</Badge>}
        <ExpiryChip date={doc.expiry_date} />
      </div>

      {/* Type */}
      <div className="grid gap-1.5">
        <Label>Type</Label>
        {canEdit ? <DocumentTypeSelect value={doc.document_type || ''} onChange={(v) => save({ document_type: v })} /> : <p className="text-sm">{documentTypeLabel(doc.document_type)}</p>}
      </div>

      <SaveOnBlurField id="d-summary" label="Summary" value={doc.summary} multiline placeholder="What is this document about?" disabled={!canEdit} onSave={(v) => save({ summary: v })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SaveOnBlurField id="d-org" label="Organisation" value={doc.organisation} placeholder="Who issued it?" disabled={!canEdit} onSave={(v) => save({ organisation: v })} />
        <SaveOnBlurField id="d-number" label="Document number" value={doc.document_number} placeholder="Number on the document" disabled={!canEdit} onSave={(v) => save({ document_number: v })} />
        <SaveOnBlurField id="d-issue" label="Issue date" type="date" value={doc.issue_date ? String(doc.issue_date).slice(0, 10) : ''} disabled={!canEdit} onSave={(v) => save({ issue_date: v })} />
        <SaveOnBlurField id="d-expiry" label="Expiry date" type="date" value={doc.expiry_date ? String(doc.expiry_date).slice(0, 10) : ''} disabled={!canEdit} onSave={(v) => save({ expiry_date: v })} />
      </div>

      <div className="grid gap-1.5">
        <Label>{t.person_label_plural}</Label>
        <PeoplePicker value={personIds} disabled={!canEdit} onChange={(ids) => save({ person_ids: ids })} />
      </div>
      <div className="grid gap-1.5">
        <Label>{t.group_label_plural}</Label>
        <GroupPicker value={groupIds} disabled={!canEdit} onChange={(ids) => save({ group_ids: ids })} />
      </div>
      <div className="grid gap-1.5">
        <Label>Tags</Label>
        <TagInput value={tagNames} disabled={!canEdit} onChange={onTags} />
      </div>
      <div className="grid gap-1.5">
        <Label>Who can see it</Label>
        <Select value={doc.visibility || 'workspace'} onValueChange={(v) => save({ visibility: v })} disabled={!canEdit}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{VISIBILITY_OPTIONS.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {/* Suggested details */}
      {canEdit && otherSuggestions.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium"><Sparkles className="size-4 text-primary" /> Suggested details</p>
          <p className="text-xs text-muted-foreground">We found these in the document. Add the ones that are right.</p>
          <ul className="flex flex-col gap-1.5">
            {otherSuggestions.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-lg bg-muted/50 px-2 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted-foreground">{SUGGESTION_LABELS[s.key] || s.key.replace(/_/g, ' ')}</span>
                  <span className="block truncate text-sm">{s.key === 'document_type' ? documentTypeLabel(s.value) : String(s.value)}</span>
                </span>
                <Button size="icon-sm" variant="ghost" aria-label="Accept" disabled={accepting} onClick={() => accept(s)}><Check className="text-emerald-600" /></Button>
                <Button size="icon-sm" variant="ghost" aria-label="Dismiss" onClick={() => dismiss(s)}><X /></Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {doc.metadata && Object.keys(doc.metadata).length > 0 && (
        <div className="grid gap-1.5">
          <Label>More details</Label>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {Object.entries(doc.metadata)
              .filter(([k, v]) => v && !['document_type', 'organisation', 'document_number', 'issue_date', 'expiry_date', 'summary', 'suggested_name'].includes(k))
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{SUGGESTION_LABELS[k] || k.replace(/_/g, ' ')}</dt>
                  <dd className="break-words">{String(v)}</dd>
                </div>
              ))}
          </dl>
        </div>
      )}
    </div>
  )
}
