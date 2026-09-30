import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { AuthLayout } from './AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { GoogleButton } from '@/components/common/GoogleButton'
import { OrDivider } from '@/components/common/OrDivider'

const schema = z.object({
  email: z.string().email('Please enter a valid email address.'),
  password: z.string().min(6, 'Your password has at least 6 characters.'),
})

export function LoginPage() {
  const { isSignedIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [magicSent, setMagicSent] = useState(false)
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } })

  if (isSignedIn) return <Navigate to={location.state?.from || '/w'} replace />

  const onSubmit = async ({ email, password }) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      toast.error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message)
      return
    }
    navigate(location.state?.from || '/w', { replace: true })
  }

  const sendMagicLink = async () => {
    const email = getValues('email')
    if (!email) {
      toast.error('Type your email first.')
      return
    }
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/w` },
    })
    if (error) toast.error(error.message)
    else setMagicSent(true)
  }

  return (
    <AuthLayout
      title="Welcome back"
      description="Sign in to open your vault."
      footer={
        <>
          New here? <Link to="/signup" className="font-medium text-primary underline-offset-4 hover:underline">Create an account</Link>
        </>
      }
    >
      <GoogleButton className="w-full" redirectTo={location.state?.from || '/w'} />
      <OrDivider />
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" inputMode="email" {...register('email')} />
          {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
        </div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="text-xs text-muted-foreground hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
          {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
        </div>
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting && <Spinner />} Sign in
        </Button>
        <Button type="button" variant="outline" onClick={sendMagicLink} disabled={magicSent}>
          {magicSent ? 'Check your email for the link' : 'Email me a sign-in link instead'}
        </Button>
      </form>
    </AuthLayout>
  )
}
