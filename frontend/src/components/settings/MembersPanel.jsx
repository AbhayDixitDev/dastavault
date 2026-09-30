import { useState } from 'react'
import { toast } from 'sonner'
import { UserPlus, Trash2, Clock } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useAuth } from '@/hooks/useAuth'
import {
  useCreateInviteMutation, useDeleteInviteMutation, useGetInvitesQuery, useGetMembersQuery,
  useRemoveMemberMutation, useUpdateMemberRoleMutation,
} from '@/store/api/membersApi'
import { ASSIGNABLE_ROLES, roleName } from '@/constants/roles'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ErrorBox, errorMessage } from '@/components/common/ErrorBox'
import { initials, fromNow } from '@/utils/format'

export function MembersPanel({ canManage }) {
  const { workspaceId, terminology: t, role } = useWorkspace()
  const { user } = useAuth()
  const { data: members = [], isLoading, error, refetch } = useGetMembersQuery(workspaceId)
  const { data: invites = [] } = useGetInvitesQuery(workspaceId, { skip: !canManage })
  const [updateRole] = useUpdateMemberRoleMutation()
  const [removeMember] = useRemoveMemberMutation()
  const [createInvite, { isLoading: inviting }] = useCreateInviteMutation()
  const [deleteInvite] = useDeleteInviteMutation()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('editor')

  const run = async (promise, ok) => {
    try {
      await promise.unwrap()
      if (ok) toast.success(ok)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const sendInvite = async (e) => {
    e.preventDefault()
    try {
      await createInvite({ workspaceId, email: email.trim().toLowerCase(), role_key: inviteRole }).unwrap()
      toast.success(`Invitation sent to ${email}.`)
      setEmail('')
      setInviteOpen(false)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const pending = invites.filter((i) => !i.accepted_at)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle>{t.member_label_plural}</CardTitle>
            <CardDescription>People who can sign in to this {t.workspace_label.toLowerCase()}.</CardDescription>
          </div>
          {canManage && (
            <Button onClick={() => setInviteOpen(true)}><UserPlus /> Invite</Button>
          )}
        </CardHeader>
        <CardContent>
          {error && <ErrorBox error={error} onRetry={refetch} className="mb-3" />}
          {isLoading ? (
            <div className="grid gap-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
          ) : (
            <ul className="divide-y">
              {members.map((m) => {
                const isSelf = m.user_id === user?.id
                const isOwner = m.role_key === 'owner'
                const editable = canManage && !isOwner && !isSelf
                return (
                  <li key={m.id} className="flex items-center gap-3 py-3">
                    <Avatar className="size-10"><AvatarFallback>{initials(m.profile?.display_name || m.profile?.email || '?')}</AvatarFallback></Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {m.profile?.display_name || m.profile?.email} {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{m.profile?.email}</span>
                    </span>
                    {editable ? (
                      <Select value={m.role_key} onValueChange={(v) => run(updateRole({ workspaceId, memberId: m.id, role_key: v }), 'Role updated.')}>
                        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ASSIGNABLE_ROLES.map((r) => <SelectItem key={r.key} value={r.key}>{r.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant={isOwner ? 'default' : 'secondary'}>{roleName(m.role_key)}</Badge>
                    )}
                    {editable && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button variant="ghost" size="icon" title="Remove"><Trash2 /></Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove {m.profile?.display_name || m.profile?.email}?</AlertDialogTitle>
                            <AlertDialogDescription>They will no longer be able to open this {t.workspace_label.toLowerCase()}.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => run(removeMember({ workspaceId, memberId: m.id }), 'Removed.')}>Remove</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {canManage && pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Waiting to join</CardTitle>
            <CardDescription>Invitations that have not been accepted yet.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {pending.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-3 text-sm">
                  <Clock className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{i.email}</span>
                    <span className="block text-xs text-muted-foreground">{roleName(i.role_key)} · sent {fromNow(i.created_at)}</span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => run(deleteInvite({ workspaceId, inviteId: i.id }), 'Invitation cancelled.')}>Cancel</Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {role && !canManage && (
        <p className="text-xs text-muted-foreground">Only admins and the owner can invite or remove {t.member_label_plural.toLowerCase()}.</p>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite a {t.member_label.toLowerCase()}</DialogTitle>
            <DialogDescription>We will email them a link to join. The link works for 7 days.</DialogDescription>
          </DialogHeader>
          <form onSubmit={sendInvite} className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="inv-email">Email</Label>
              <Input id="inv-email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>What can they do?</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((r) => <SelectItem key={r.key} value={r.key}>{r.name}: {r.description}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={inviting}>{inviting && <Spinner />} Send invitation</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
