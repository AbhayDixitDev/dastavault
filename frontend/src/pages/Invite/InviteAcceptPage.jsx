import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { MailOpen } from 'lucide-react'
import { useAcceptInviteMutation, useGetInviteQuery } from '@/store/api/membersApi'
import { useAuth } from '@/hooks/useAuth'
import { AuthLayout } from '@/pages/Auth/AuthLayout'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ErrorBox, errorMessage } from '@/components/common/ErrorBox'
import { roleName } from '@/constants/roles'

export function InviteAcceptPage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: invite, isLoading, error } = useGetInviteQuery(token)
  const [accept, { isLoading: accepting }] = useAcceptInviteMutation()

  const onAccept = async () => {
    try {
      const res = await accept(token).unwrap()
      toast.success('You joined the workspace.')
      navigate(`/w/${res.workspace_id}`, { replace: true })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const wrongEmail = invite && user?.email && invite.email.toLowerCase() !== user.email.toLowerCase()

  return (
    <AuthLayout title="You are invited">
      {isLoading && <div className="flex justify-center py-6"><Spinner /></div>}
      {error && <ErrorBox error={error} title="This invitation is not valid" />}
      {invite && (
        <div className="flex flex-col items-center gap-3 text-center">
          <MailOpen className="size-10 text-primary" />
          <p className="text-sm">
            Join <strong>{invite.workspace?.name}</strong> as <strong>{roleName(invite.role_key)}</strong>.
          </p>
          {invite.accepted_at ? (
            <p className="text-sm text-muted-foreground">This invitation was already used.</p>
          ) : wrongEmail ? (
            <p className="text-sm text-destructive">
              This invitation was sent to {invite.email}. You are signed in as {user.email}.
            </p>
          ) : (
            <Button size="lg" onClick={onAccept} disabled={accepting}>
              {accepting && <Spinner />} Accept invitation
            </Button>
          )}
        </div>
      )}
    </AuthLayout>
  )
}
