import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { AuthLayout } from './AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

export function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  const onSubmit = async (e) => {
    e.preventDefault()
    if (password.length < 8) return toast.error('Use at least 8 characters.')
    if (password !== confirm) return toast.error('Passwords do not match.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Your password is updated.')
    navigate('/w', { replace: true })
  }

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor="password">New password</Label>
          <Input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm">Type it again</Label>
          <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <Button type="submit" size="lg" disabled={busy}>
          {busy && <Spinner />} Save password
        </Button>
      </form>
    </AuthLayout>
  )
}
