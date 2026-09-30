import { Copy, Eye, Layers } from 'lucide-react'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DocumentTypeIcon } from './DocumentTypeIcon'
import { documentTypeLabel } from './documentTypes'
import { formatDate } from '@/utils/format'

const REASONS = {
  exact_file: 'Same file',
  similar_image: 'Looks the same',
  same_number: 'Same document number',
  similar_text: 'Same words inside',
}

/**
 * Shown when an upload looks like a document that is already saved.
 * `matches` = [{ document, reason, score }]. `onChoose(action, match)` where
 * action is 'view' | 'version' | 'keep' | 'cancel'.
 */
export function DuplicateDialog({ open, onOpenChange, matches = [], fileName, onChoose }) {
  const best = matches[0]
  const choose = (action) => {
    onChoose?.(action, best)
    if (action !== 'view') onOpenChange?.(false)
  }
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) choose('cancel'); else onOpenChange?.(v) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>This document may already exist.</DialogTitle>
          <DialogDescription>
            {fileName ? `“${fileName}” looks like` : 'This looks like'} something you already saved. What would you like to do?
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="flex flex-col gap-2">
            {matches.slice(0, 3).map((m, i) => (
              <li key={m.document?.id ?? i} className="flex items-center gap-3 rounded-xl border p-3">
                <DocumentTypeIcon type={m.document?.document_type} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{m.document?.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {documentTypeLabel(m.document?.document_type)} · added {formatDate(m.document?.created_at)}
                  </span>
                </span>
                <Badge variant="secondary">{REASONS[m.reason] || 'Similar'}</Badge>
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter className="sm:flex-col sm:items-stretch">
          <Button size="lg" variant="outline" onClick={() => choose('view')}><Eye /> View existing</Button>
          <Button size="lg" onClick={() => choose('version')}><Layers /> Add as new version</Button>
          <Button size="lg" variant="secondary" onClick={() => choose('keep')}><Copy /> Keep both</Button>
          <Button size="lg" variant="ghost" onClick={() => choose('cancel')}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

