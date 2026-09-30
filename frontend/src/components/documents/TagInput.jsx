import { useMemo, useRef, useState } from 'react'
import { Tag, X } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useGetTagsQuery } from '@/store/api/documentsApi'
import { cn } from '@/lib/utils'

/**
 * Tag editor with autocomplete from the workspace's tags. `value` is an array of
 * tag names (strings). Enter or comma adds a tag; Backspace removes the last one.
 */
export function TagInput({ value = [], onChange, disabled, placeholder = 'Add a tag', className }) {
  const { workspaceId } = useWorkspace()
  const { data: tags = [] } = useGetTagsQuery(workspaceId, { skip: !workspaceId || disabled })
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)

  const lower = new Set(value.map((v) => v.toLowerCase()))
  const suggestions = useMemo(() => {
    const s = text.trim().toLowerCase()
    return tags
      .filter((t) => !lower.has(t.name.toLowerCase()) && (!s || t.name.toLowerCase().includes(s)))
      .slice(0, 8)
  }, [tags, text, value]) // eslint-disable-line react-hooks/exhaustive-deps

  const add = (name) => {
    const clean = String(name || '').trim().replace(/,+$/, '').slice(0, 40)
    if (!clean) return
    if (lower.has(clean.toLowerCase())) {
      setText('')
      return
    }
    onChange?.([...value, clean])
    setText('')
    setActive(0)
  }

  const remove = (name) => onChange?.(value.filter((v) => v !== name))

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (suggestions.length && text.trim() && active < suggestions.length && focused) add(suggestions[active].name)
      else add(text)
    } else if (e.key === 'Backspace' && !text && value.length) {
      remove(value[value.length - 1])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, Math.max(0, suggestions.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Escape') {
      setFocused(false)
    }
  }

  return (
    <div className={cn('relative', className)}>
      <div
        className={cn(
          'flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 dark:bg-input/30',
          focused && 'border-ring ring-[3px] ring-ring/50',
          disabled && 'opacity-70',
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((name) => (
          <span key={name} className="flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-sm text-secondary-foreground">
            <Tag className="size-3" /> {name}
            {!disabled && (
              <button type="button" aria-label={`Remove tag ${name}`} className="ml-0.5 rounded-full text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); remove(name) }}>
                <X className="size-3.5" />
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => { setText(e.target.value); setActive(0) }}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => { setTimeout(() => setFocused(false), 120); if (text.trim()) add(text) }}
            placeholder={value.length ? '' : placeholder}
            className="h-7 min-w-[8rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        )}
        {disabled && value.length === 0 && <span className="text-sm text-muted-foreground">No tags</span>}
      </div>
      {focused && !disabled && (suggestions.length > 0 || text.trim()) && (
        <ul className="absolute top-full left-0 z-30 mt-1 w-full overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lift">
          {suggestions.map((t, i) => (
            <li key={t.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(t.name)} className={cn('flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent', i === active && 'bg-accent')}>
                <span className="flex items-center gap-2"><Tag className="size-3.5 text-muted-foreground" /> {t.name}</span>
                {t.document_count > 0 && <span className="text-xs text-muted-foreground">{t.document_count}</span>}
              </button>
            </li>
          ))}
          {text.trim() && !tags.some((t) => t.name.toLowerCase() === text.trim().toLowerCase()) && (
            <li>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(text)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-primary hover:bg-accent">
                Add new tag “{text.trim()}”
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
