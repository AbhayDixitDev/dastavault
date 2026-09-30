import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { AuthLayout } from './AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const onSubmit = async (e) => {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setBusy(false)
    if (error) toast.error(error.message)
    else setSent(true)
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      description="We will email you a link to choose a new one."
      footer={<Link to="/login" className="hover:underline">Back to sign in</Link>}
    >
      {sent ? (
        <p className="text-sm text-muted-foreground">
          If an account exists for <strong>{email}</strong>, a reset link is on its way. Check your inbox and spam folder.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button type="submit" size="lg" disabled={busy}>
            {busy && <Spinner />} Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
