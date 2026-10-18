import { useState } from 'react'
import { CheckCircle2, UserPlus, X } from 'lucide-react'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { Spinner } from '@/components/ui/spinner'

/** People whose name matches what is typed: names starting with it first. */
function matching(people, text) {
  const q = text.trim().toLowerCase()
  if (!q) return []
  const starts = []
  const contains = []
  for (const p of people) {
    const name = (p.display_name || '').toLowerCase()
    if (name.split(/\s+/).some((w) => w.startsWith(q)) || name.startsWith(q)) starts.push(p)
    else if (q.length > 1 && name.includes(q)) contains.push(p)
  }
  return [...starts, ...contains].slice(0, 4)
}

/**
 * Who is on the photo: one line per face. Recognised faces show their name;
 * the others say "Unknown" until a name is typed. A typed name picks someone
 * who exists or adds a new person with this face (also when the upload starts
 * with a name typed and not confirmed).
 *
 *   faces: [{ crop, d, person_id, name }]
 *   onName(index, text), onPerson(index, person | null), onCreate(index, name)
 *   suggestion: a name read on the page, offered for the first unknown face
 */
export function FaceNames({ faces, people, suggestion, personLabel = 'person', creating, onName, onPerson, onCreate }) {
  const firstUnknown = faces.findIndex((f) => !f.person_id)
  return (
    <div className="rounded-xl border p-3">
      <p className="mb-2 text-sm font-medium">{faces.length === 1 ? 'Who is this?' : `${faces.length} faces on this photo. Who are they?`}</p>
      <ul className="flex flex-col gap-3">
        {faces.map((f, i) => (
          <FaceLine
            key={i}
            face={f}
            people={people}
            personLabel={personLabel}
            suggestion={i === firstUnknown ? suggestion : null}
            creating={creating === i}
            onName={(text) => onName(i, text)}
            onPerson={(p) => onPerson(i, p)}
            onCreate={(name) => onCreate(i, name)}
          />
        ))}
      </ul>
    </div>
  )
}

function FaceLine({ face, people, personLabel, suggestion, creating, onName, onPerson, onCreate }) {
  const [focused, setFocused] = useState(false)
  // Someone just added may not be in the list yet: their name is kept on the face.
  const who = face.person_id ? people.find((p) => p.id === face.person_id) || { id: face.person_id, display_name: face.label || '' } : null
  const typed = face.name || ''
  const options = matching(people, typed)
  const exact = options.find((p) => (p.display_name || '').trim().toLowerCase() === typed.trim().toLowerCase())

  return (
    <li className="flex items-start gap-3">
      <img src={face.crop} alt="" className="size-14 shrink-0 rounded-full border object-cover" />
      {who ? (
        <div className="flex min-h-14 min-w-0 flex-1 items-center gap-2">
          <PersonAvatar person={who} className="size-6" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{who.display_name}</span>
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-label="Recognised" />
          <button type="button" aria-label="Not them" onClick={() => onPerson(null)} className="rounded-full p-1 text-muted-foreground hover:bg-accent">
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <input
            value={typed}
            onChange={(e) => onName(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !typed.trim()) return
              e.preventDefault()
              if (exact) onPerson(exact)
              else onCreate(typed.trim())
            }}
            placeholder="Unknown – type a name"
            aria-label={`Name of the ${personLabel.toLowerCase()} on this face`}
            enterKeyHint="done"
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/50"
          />
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {!typed && suggestion && (
              <button type="button" onClick={() => onName(suggestion)} className="rounded-full border bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                {suggestion}?
              </button>
            )}
            {(focused || typed) &&
              options.map((p) => (
                <button key={p.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onPerson(p)} className="inline-flex items-center gap-1.5 rounded-full border bg-card py-0.5 pl-0.5 pr-2.5 text-xs hover:bg-accent">
                  <PersonAvatar person={p} className="size-5" /> {p.display_name}
                </button>
              ))}
            {typed.trim() && !exact && (
              <button
                type="button"
                disabled={creating}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onCreate(typed.trim())}
                className="inline-flex items-center gap-1 rounded-full border border-primary/40 px-2.5 py-1 text-xs font-semibold text-primary"
              >
                {creating ? <Spinner size="sm" /> : <UserPlus className="size-3.5" />} Add “{typed.trim()}”
              </button>
            )}
            {!typed && !suggestion && <span className="text-xs text-muted-foreground">Leave empty if you do not know them.</span>}
          </div>
        </div>
      )}
    </li>
  )
}
