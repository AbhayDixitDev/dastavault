import { Link } from 'react-router-dom'
import { Lock, Pin } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { fromNow } from '@/utils/format'
import { cn } from '@/lib/utils'
import { noteColorClass } from './noteColors'

/** One note in the grid. Shows the title, a text preview and tags. Private notes show a lock. */
export function NoteCard({ note, to }) {
  const preview = note.is_private ? '' : (note.content_text || '').replace(/\s+/g, ' ').trim()
  return (
    <Link
      to={to}
      className={cn(
        'flex break-inside-avoid flex-col gap-2 rounded-2xl border p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift',
        noteColorClass(note.color),
      )}
    >
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 font-display text-base font-semibold leading-snug line-clamp-2">{note.title || 'Untitled'}</h3>
        {note.is_pinned && <Pin className="size-4 shrink-0 fill-current text-muted-foreground" />}
        {note.is_private && <Lock className="size-4 shrink-0 text-muted-foreground" />}
      </div>
      {note.is_private ? (
        <p className="text-sm italic text-muted-foreground">Locked with your Chaabi PIN</p>
      ) : preview ? (
        <p className="text-sm text-foreground/80 line-clamp-6 whitespace-pre-line">{preview}</p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        {(note.tags || []).slice(0, 4).map((t) => (
          <Badge key={t} variant="outline" className="bg-background/60">
            {t}
          </Badge>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">{fromNow(note.updated_at)}</span>
      </div>
    </Link>
  )
}
