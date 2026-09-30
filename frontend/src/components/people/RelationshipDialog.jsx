import { useState } from 'react'
import { toast } from 'sonner'
import { useAddRelationshipMutation, useGetPeopleQuery } from '@/store/api/peopleApi'
import { useWorkspace } from '@/hooks/useWorkspace'
import { RELATIONS } from '@/constants/relations'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from '@/components/common/ErrorBox'

/** "{person} is the {relation} of {other}". */
export function RelationshipDialog({ open, onOpenChange, person }) {
  const { workspaceId } = useWorkspace()
  const { data: people = [] } = useGetPeopleQuery(workspaceId)
  const [addRelationship, { isLoading }] = useAddRelationshipMutation()
  const [relation, setRelation] = useState('father')
  const [customLabel, setCustomLabel] = useState('')
  const [toPersonId, setToPersonId] = useState('')

  const others = people.filter((p) => p.id !== person?.id)

  const submit = async (e) => {
    e.preventDefault()
    if (!toPersonId) return toast.error('Choose a person.')
    try {
      await addRelationship({
        workspaceId,
        personId: person.id,
        to_person_id: toPersonId,
        relation,
        custom_label: relation === 'custom' ? customLabel : undefined,
      }).unwrap()
      toast.success('Relationship added.')
      onOpenChange(false)
      setToPersonId('')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a relationship</DialogTitle>
          <DialogDescription>This helps search understand words like “dad” or “mom”.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">
            <strong>{person?.display_name}</strong> is the
          </p>
          <div className="grid gap-2">
            <Label>Relation</Label>
            <Select value={relation} onValueChange={setRelation}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RELATIONS.map((r) => (
                  <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {relation === 'custom' && (
              <Input placeholder="For example: Uncle" value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} />
            )}
          </div>
          <div className="grid gap-2">
            <Label>of</Label>
            <Select value={toPersonId} onValueChange={setToPersonId}>
              <SelectTrigger><SelectValue placeholder="Choose a person" /></SelectTrigger>
              <SelectContent>
                {others.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {others.length === 0 && <p className="text-xs text-muted-foreground">Add another person first.</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isLoading || !toPersonId}>{isLoading && <Spinner />} Add</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
