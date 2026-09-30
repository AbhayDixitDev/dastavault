import { useEffect, useState } from 'react'
import { FolderPlus, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useCreateAlbumMutation, useUpdateAlbumMutation } from '@/store/api/albumsApi'
import { SmartRuleBuilder, compactRules, normaliseRules } from './SmartRuleBuilder'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage } from '@/components/common/ErrorBox'
import { cn } from '@/lib/utils'

const KINDS = [
  { key: 'manual', title: 'Manual', description: 'You choose which documents go in.', icon: FolderPlus },
  { key: 'smart', title: 'Smart', description: 'Fills itself using rules, like "Dad + Passport".', icon: Wand2 },
]

/**
 * Create or edit an album. Pass `album` to edit; pass `rulesOnly` to open the
 * rule editor of a smart album directly.
 */
export function AlbumDialog({ open, onOpenChange, album, rulesOnly = false, onSaved, defaultKind = 'manual', defaultRules }) {
  const { workspaceId, terminology } = useWorkspace()
  const [createAlbum, { isLoading: creating }] = useCreateAlbumMutation()
  const [updateAlbum, { isLoading: updating }] = useUpdateAlbumMutation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState(defaultKind)
  const [rules, setRules] = useState({ all: [] })
  const busy = creating || updating
  const isSmart = kind === 'smart'

  useEffect(() => {
    if (!open) return
    setName(album?.name ?? '')
    setDescription(album?.description ?? '')
    setKind(album?.kind ?? defaultKind)
    setRules(normaliseRules(album?.rules ?? defaultRules))
  }, [open, album, defaultKind, defaultRules])

  const submit = async (e) => {
    e.preventDefault()
    const n = name.trim()
    if (!n && !rulesOnly) return
    const compact = compactRules(rules)
    if (isSmart && compact.all.length === 0) {
      toast.error('Add at least one rule for a smart album.')
      return
    }
    try {
      let saved
      if (album) {
        const body = rulesOnly ? { rules: compact } : { name: n, description: description.trim() || null, ...(isSmart ? { rules: compact } : {}) }
        saved = await updateAlbum({ workspaceId, albumId: album.id, ...body }).unwrap()
        toast.success('Album saved.')
      } else {
        saved = await createAlbum({ workspaceId, name: n, kind, description: description.trim() || undefined, rules: isSmart ? compact : undefined }).unwrap()
        toast.success(`"${n}" created.`)
      }
      onOpenChange(false)
      onSaved?.(saved)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(isSmart && 'sm:max-w-2xl')}>
        <form onSubmit={submit} className="flex min-h-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{rulesOnly ? 'Edit rules' : album ? 'Edit album' : 'New album'}</DialogTitle>
            <DialogDescription>{rulesOnly ? 'Documents that match every rule appear in this album.' : album ? 'Change the name or description.' : 'Group documents the way you think about them.'}</DialogDescription>
          </DialogHeader>

          <DialogBody className="flex flex-col gap-4 py-1">
            {!rulesOnly && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="album-name">Name</Label>
                  <Input id="album-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="House papers" required />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="album-description">Description (optional)</Label>
                  <Textarea id="album-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What goes in here?" rows={2} />
                </div>
                {!album && (
                  <div className="flex flex-col gap-2">
                    <Label>Kind</Label>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Album kind">
                      {KINDS.map((k) => (
                        <button
                          key={k.key}
                          type="button"
                          role="radio"
                          aria-checked={kind === k.key}
                          onClick={() => setKind(k.key)}
                          className={cn('flex items-start gap-3 rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50', kind === k.key ? 'border-primary bg-primary/5' : 'hover:bg-accent')}
                        >
                          <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', kind === k.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                            <k.icon className="size-4" />
                          </span>
                          <span>
                            <span className="block text-sm font-medium">{k.title}</span>
                            <span className="block text-xs text-muted-foreground">{k.description}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {isSmart && (
              <div className="flex flex-col gap-2">
                {!rulesOnly && <Label>Rules</Label>}
                <SmartRuleBuilder value={rules} onChange={setRules} workspaceId={workspaceId} terminology={terminology} />
              </div>
            )}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || (!rulesOnly && !name.trim())}>
              {album ? 'Save' : 'Create album'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
