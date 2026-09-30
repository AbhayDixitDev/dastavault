import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, FilePlus2 } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspace } from '@/hooks/useWorkspace'
import { api } from '@/services/api/client'
import { RichEditor, htmlToText } from '@/components/editor/RichEditor'
import { TEMPLATES } from '@/components/editor/templates'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from '@/components/common/ErrorBox'
import { cn } from '@/lib/utils'

/** /w/:ws/documents/new - write a new document from a template. */
export function NewWrittenDocumentPage() {
  const { workspaceId, can } = useWorkspace()
  const navigate = useNavigate()
  const [template, setTemplate] = useState(null)
  const [name, setName] = useState('')
  const [html, setHtml] = useState('')
  const [saving, setSaving] = useState(false)
  const editorRef = useRef(null)

  if (!can('editor')) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Write a document" description="You need editor access in this workspace to write documents." />
      </div>
    )
  }

  const pick = (t) => {
    setTemplate(t)
    setHtml(t.html)
    if (!name && t.key !== 'blank') setName(t.name)
  }

  const create = async () => {
    const title = name.trim()
    if (!title) return toast.error('Give the document a name.')
    setSaving(true)
    try {
      const content_html = editorRef.current?.getHTML() || html
      const content_text = editorRef.current?.getText() || htmlToText(content_html)
      const res = await api.post(`/workspaces/${workspaceId}/documents/written`, { name: title, content_html, content_text, document_type: 'written' })
      toast.success('Document created.')
      navigate(`/w/${workspaceId}/documents/${res.document.id}`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Write a document"
        description={template ? 'Give it a name and start writing. It gets a full version history like any upload.' : 'Pick how to start.'}
        actions={
          <Button asChild variant="ghost">
            <Link to={`/w/${workspaceId}/documents`}><ArrowLeft /> Documents</Link>
          </Button>
        }
      />

      {!template ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {TEMPLATES.map((t) => (
            <li key={t.key}>
              <button
                type="button"
                onClick={() => pick(t)}
                className={cn('flex w-full flex-col gap-1 rounded-2xl border bg-card p-4 text-left transition-colors hover:bg-accent')}
              >
                <span className="flex items-center gap-2 font-medium"><FilePlus2 className="size-4 text-primary" /> {t.name}</span>
                <span className="text-sm text-muted-foreground">{t.description}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-4">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Document name" className="h-12 text-lg" autoFocus />
          <RichEditor ref={editorRef} valueHtml={html} onChange={({ html: h }) => setHtml(h)} placeholder="Start writing..." minHeight="20rem" />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setTemplate(null)} disabled={saving}>Choose another start</Button>
            <Button onClick={create} disabled={saving}>{saving && <Spinner size="sm" />} Create document</Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default NewWrittenDocumentPage
