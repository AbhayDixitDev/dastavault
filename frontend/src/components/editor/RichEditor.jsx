import { useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Underline } from '@tiptap/extension-underline'
import { Link } from '@tiptap/extension-link'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { Image } from '@tiptap/extension-image'
import { Placeholder } from '@tiptap/extension-placeholder'
import DOMPurify from 'dompurify'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { EditorToolbar } from './EditorToolbar'

const BIG_IMAGE_BYTES = 500 * 1024

/** Removes scripts, event handlers and anything else that should never be saved or rendered. */
export function sanitizeHtml(html = '') {
  return DOMPurify.sanitize(String(html || ''), {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel', 'data-type', 'data-checked', 'colspan', 'rowspan', 'colwidth'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data:image\/(?:png|jpeg|jpg|gif|webp)):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  })
}

/** Plain text from HTML (for search and previews). */
export function htmlToText(html = '') {
  const div = document.createElement('div')
  div.innerHTML = sanitizeHtml(html)
  return (div.textContent || '').replace(/\s+\n/g, '\n').trim()
}

function bytesOfDataUrl(src = '') {
  const i = src.indexOf(',')
  return i > 0 ? Math.floor(((src.length - i - 1) * 3) / 4) : 0
}

const EDITOR_CSS = `
.dv-editor .tiptap { outline: none; min-height: var(--dv-editor-min-height, 16rem); line-height: 1.6; font-size: 1rem; }
.dv-editor .tiptap > * + * { margin-top: 0.6em; }
.dv-editor .tiptap h1 { font-size: 1.6rem; font-weight: 700; line-height: 1.25; margin-top: 1em; }
.dv-editor .tiptap h2 { font-size: 1.3rem; font-weight: 650; line-height: 1.3; margin-top: 0.9em; }
.dv-editor .tiptap h3 { font-size: 1.1rem; font-weight: 600; }
.dv-editor .tiptap ul, .dv-editor .tiptap ol { padding-left: 1.5rem; }
.dv-editor .tiptap ul { list-style: disc; }
.dv-editor .tiptap ol { list-style: decimal; }
.dv-editor .tiptap li + li { margin-top: 0.25em; }
.dv-editor .tiptap ul[data-type="taskList"] { list-style: none; padding-left: 0.25rem; }
.dv-editor .tiptap ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.6rem; }
.dv-editor .tiptap ul[data-type="taskList"] li > label { flex: 0 0 auto; margin-top: 0.3em; }
.dv-editor .tiptap ul[data-type="taskList"] li > label input { width: 1.1rem; height: 1.1rem; accent-color: var(--primary); }
.dv-editor .tiptap ul[data-type="taskList"] li > div { flex: 1 1 auto; }
.dv-editor .tiptap ul[data-type="taskList"] li[data-checked="true"] > div { text-decoration: line-through; color: var(--muted-foreground); }
.dv-editor .tiptap a { color: var(--primary); text-decoration: underline; text-underline-offset: 3px; }
.dv-editor .tiptap blockquote { border-left: 3px solid var(--border); padding-left: 1rem; color: var(--muted-foreground); }
.dv-editor .tiptap code { background: var(--muted); padding: 0.1em 0.35em; border-radius: 0.3em; font-size: 0.9em; }
.dv-editor .tiptap pre { background: var(--muted); padding: 0.75rem 1rem; border-radius: 0.75rem; overflow-x: auto; }
.dv-editor .tiptap pre code { background: none; padding: 0; }
.dv-editor .tiptap hr { border: 0; border-top: 1px solid var(--border); margin: 1.2em 0; }
.dv-editor .tiptap img { max-width: 100%; height: auto; border-radius: 0.75rem; }
.dv-editor .tiptap img.ProseMirror-selectednode { outline: 3px solid var(--ring); }
.dv-editor .tiptap table { border-collapse: collapse; width: 100%; table-layout: fixed; overflow: hidden; margin: 0.5em 0; }
.dv-editor .tiptap td, .dv-editor .tiptap th { border: 1px solid var(--border); padding: 0.4rem 0.6rem; vertical-align: top; min-width: 3rem; position: relative; }
.dv-editor .tiptap th { background: var(--muted); font-weight: 600; text-align: left; }
.dv-editor .tiptap .selectedCell::after { content: ""; position: absolute; inset: 0; background: color-mix(in oklab, var(--primary) 12%, transparent); pointer-events: none; }
.dv-editor .tiptap p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: var(--muted-foreground); float: left; height: 0; pointer-events: none; }
.dv-editor .tiptap[contenteditable="false"] { min-height: 0; }
`

/**
 * Tiptap editor with a simple toolbar.
 * props: { valueHtml, onChange({ html, text }), editable, autofocus, placeholder, className, toolbar, ref }
 * ref exposes { getText(), getHTML(), focus(), editor }.
 */
export function RichEditor({
  valueHtml = '',
  onChange,
  editable = true,
  autofocus = false,
  placeholder = 'Start writing...',
  className,
  toolbar = true,
  minHeight,
  ref,
}) {
  const lastEmitted = useRef(null)

  const extensions = useMemo(
    () => [
      StarterKit.configure({ link: false, underline: false, heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({ allowBase64: true, inline: false }),
      Placeholder.configure({ placeholder }),
    ],
    [placeholder],
  )

  const editor = useEditor({
    extensions,
    content: sanitizeHtml(valueHtml),
    editable,
    autofocus: autofocus ? 'end' : false,
    editorProps: {
      attributes: { class: 'tiptap', spellcheck: 'true' },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'))
        if (!files.length) return false
        event.preventDefault()
        files.forEach((file) => {
          if (file.size > BIG_IMAGE_BYTES) toast.warning('This image is large (over 500 KB). It will make the note slow to open.')
          const reader = new FileReader()
          reader.onload = () => {
            view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.image.create({ src: reader.result })))
          }
          reader.readAsDataURL(file)
        })
        return true
      },
    },
    onUpdate: ({ editor: e }) => {
      const html = sanitizeHtml(e.getHTML())
      lastEmitted.current = html
      let big = false
      e.state.doc.descendants((node) => {
        if (node.type.name === 'image' && String(node.attrs.src || '').startsWith('data:') && bytesOfDataUrl(node.attrs.src) > BIG_IMAGE_BYTES) big = true
      })
      if (big && !lastEmitted.warned) {
        lastEmitted.warned = true
        toast.warning('This note has a large image (over 500 KB). It will make the note slow to open.')
      }
      onChange?.({ html, text: e.getText() })
    },
  })

  // Sync external changes (loading a note, conflict "reload") without clobbering typing.
  useEffect(() => {
    if (!editor) return
    const clean = sanitizeHtml(valueHtml)
    if (clean === lastEmitted.current) return
    if (clean === editor.getHTML()) return
    if (editor.isFocused && lastEmitted.current !== null) return
    editor.commands.setContent(clean, { emitUpdate: false })
    lastEmitted.current = clean
  }, [editor, valueHtml])

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable)
  }, [editor, editable])

  useImperativeHandle(
    ref,
    () => ({
      editor,
      getText: () => editor?.getText() || '',
      getHTML: () => sanitizeHtml(editor?.getHTML() || ''),
      focus: () => editor?.commands.focus('end'),
    }),
    [editor],
  )

  return (
    <div className={cn('dv-editor flex flex-col gap-3', className)} style={minHeight ? { '--dv-editor-min-height': minHeight } : undefined}>
      <style>{EDITOR_CSS}</style>
      {toolbar && editable && <EditorToolbar editor={editor} />}
      <EditorContent editor={editor} className="rounded-xl border bg-card px-4 py-3 sm:px-6 sm:py-4" />
    </div>
  )
}

/** Read-only rendering of saved HTML (sanitised again on render). */
export function RichContent({ html, className }) {
  return (
    <div className={cn('dv-editor', className)}>
      <style>{EDITOR_CSS}</style>
      <div className="tiptap" contentEditable={false} dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
    </div>
  )
}
