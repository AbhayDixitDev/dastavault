import { useEditorState } from '@tiptap/react'
import {
  Bold, Heading1, Heading2, Italic, Link as LinkIcon, List, ListChecks, ListOrdered, Redo2, Table as TableIcon, Underline as UnderlineIcon, Undo2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Simple toolbar with big touch buttons. Pass the Tiptap `editor`.
 * `sticky` puts it at the bottom on phones (thumb reach) and at the top on wider screens.
 */
export function EditorToolbar({ editor, className, sticky = true }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return {}
      return {
        h1: e.isActive('heading', { level: 1 }),
        h2: e.isActive('heading', { level: 2 }),
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        task: e.isActive('taskList'),
        link: e.isActive('link'),
        table: e.isActive('table'),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      }
    },
  }) || {}

  if (!editor) return null

  const setLink = () => {
    const prev = editor.getAttributes('link').href || ''
    const url = window.prompt('Link address', prev || 'https://')
    if (url === null) return
    const clean = url.trim()
    if (!clean || clean === 'https://') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    const href = /^[a-z]+:/i.test(clean) ? clean : `https://${clean}`
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
  }

  const buttons = [
    { key: 'h1', icon: Heading1, label: 'Big heading', active: state.h1, run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { key: 'h2', icon: Heading2, label: 'Heading', active: state.h2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { key: 'bold', icon: Bold, label: 'Bold', active: state.bold, run: () => editor.chain().focus().toggleBold().run() },
    { key: 'italic', icon: Italic, label: 'Italic', active: state.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { key: 'underline', icon: UnderlineIcon, label: 'Underline', active: state.underline, run: () => editor.chain().focus().toggleUnderline().run() },
    { key: 'bullet', icon: List, label: 'Bullet list', active: state.bullet, run: () => editor.chain().focus().toggleBulletList().run() },
    { key: 'ordered', icon: ListOrdered, label: 'Numbered list', active: state.ordered, run: () => editor.chain().focus().toggleOrderedList().run() },
    { key: 'task', icon: ListChecks, label: 'Checklist', active: state.task, run: () => editor.chain().focus().toggleTaskList().run() },
    { key: 'link', icon: LinkIcon, label: 'Link', active: state.link, run: setLink },
    {
      key: 'table',
      icon: TableIcon,
      label: state.table ? 'Add row below' : 'Table',
      active: state.table,
      run: () =>
        state.table
          ? editor.chain().focus().addRowAfter().run()
          : editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    { key: 'undo', icon: Undo2, label: 'Undo', disabled: !state.canUndo, run: () => editor.chain().focus().undo().run() },
    { key: 'redo', icon: Redo2, label: 'Redo', disabled: !state.canRedo, run: () => editor.chain().focus().redo().run() },
  ]

  return (
    <div
      data-slot="editor-toolbar"
      role="toolbar"
      aria-label="Formatting"
      className={cn(
        'flex items-center gap-1 overflow-x-auto rounded-xl border bg-card p-1 shadow-soft [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        sticky && 'sticky bottom-2 z-20 sm:bottom-auto sm:top-2',
        className,
      )}
    >
      {buttons.map((b) => (
        <button
          key={b.key}
          type="button"
          title={b.label}
          aria-label={b.label}
          aria-pressed={!!b.active}
          disabled={b.disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={b.run}
          className={cn(
            'tap-target flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground/80 transition-colors hover:bg-accent disabled:opacity-40',
            b.active && 'bg-primary/10 text-primary',
          )}
        >
          <b.icon className="size-5" />
        </button>
      ))}
    </div>
  )
}
