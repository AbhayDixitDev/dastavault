import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useDeleteWorkspaceMutation, useUpdateWorkspaceMutation } from '@/store/api/workspacesApi'
import { WORKSPACE_KINDS } from '@/constants/terminology'
import { roleName } from '@/constants/roles'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { errorMessage } from '@/components/common/ErrorBox'

export function GeneralPanel() {
  const { workspace, role, can } = useWorkspace()
  const [updateWorkspace, { isLoading }] = useUpdateWorkspaceMutation()
  const [deleteWorkspace, { isLoading: deleting }] = useDeleteWorkspaceMutation()
  const [name, setName] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const navigate = useNavigate()
  const canManage = can('admin')
  const kind = WORKSPACE_KINDS.find((k) => k.key === workspace?.kind)

  useEffect(() => setName(workspace?.name ?? ''), [workspace])

  const save = async (e) => {
    e.preventDefault()
    try {
      await updateWorkspace({ id: workspace.id, name: name.trim() }).unwrap()
      toast.success('Saved.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const onDelete = async () => {
    try {
      await deleteWorkspace(workspace.id).unwrap()
      toast.success('Workspace deleted.')
      navigate('/w', { replace: true })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
          <CardDescription>
            {kind?.emoji} {kind?.title} · You are {roleName(role)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="flex flex-col gap-3">
            <div className="grid gap-2">
              <Label htmlFor="wsname">Name</Label>
              <Input id="wsname" value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} />
            </div>
            {canManage && (
              <Button type="submit" disabled={isLoading || !name.trim()} className="self-start">
                {isLoading && <Spinner />} Save
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      {role === 'owner' && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
            <CardDescription>Deleting moves this workspace to the bin for 30 days, then it is removed for good.</CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Delete workspace</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {workspace.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Type <strong>{workspace.name}</strong> to confirm. All members lose access.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={workspace.name} />
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction disabled={confirmText !== workspace.name || deleting} onClick={onDelete}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
