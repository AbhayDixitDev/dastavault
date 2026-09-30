import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useCreateGroupMutation, useUpdateGroupMutation } from '@/store/api/groupsApi'
import { useWorkspace } from '@/hooks/useWorkspace'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from '@/components/common/ErrorBox'

const NONE = '__none__'

export function GroupDialog({ open, onOpenChange, group, groups = [], defaultParentId = null }) {
  const { workspaceId, terminology: t } = useWorkspace()
  const [createGroup, { isLoading: creating }] = useCreateGroupMutation()
  const [updateGroup, { isLoading: updating }] = useUpdateGroupMutation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [parentId, setParentId] = useState(NONE)
  const busy = creating || updating

  useEffect(() => {
    if (open) {
      setName(group?.name ?? '')
      setDescription(group?.description ?? '')
      setParentId(group?.parent_group_id ?? defaultParentId ?? NONE)
    }
  }, [open, group, defaultParentId])

  const parentOptions = groups.filter((g) => !g.parent_group_id && g.id !== group?.id)
  const isSub = parentId !== NONE

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return toast.error('Please type a name.')
    const body = { name: name.trim(), description: description || null, parent_group_id: parentId === NONE ? null : parentId }
    try {
      if (group) await updateGroup({ workspaceId, groupId: group.id, ...body }).unwrap()
      else await createGroup({ workspaceId, ...body }).unwrap()
      toast.success(group ? 'Saved.' : `${body.name} created.`)
      onOpenChange(false)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{group ? 'Edit' : 'New'} {isSub ? t.subgroup_label : t.group_label}</DialogTitle>
          <DialogDescription>Documents and {t.person_label_plural.toLowerCase()} can be linked to it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="gname">Name</Label>
            <Input id="gname" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {parentOptions.length > 0 && (
            <div className="grid gap-2">
              <Label>Inside which {t.group_label.toLowerCase()}?</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None (top level {t.group_label.toLowerCase()})</SelectItem>
                  {parentOptions.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="gdesc">Description (optional)</Label>
            <Textarea id="gdesc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy && <Spinner />} {group ? 'Save' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
