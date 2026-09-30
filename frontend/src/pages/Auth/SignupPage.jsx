import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { MailCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { AuthLayout } from './AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

const schema = z
  .object({
    name: z.string().min(2, 'Please tell us your name.'),
    email: z.string().email('Please enter a valid email address.'),
    password: z.string().min(8, 'Use at least 8 characters.'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match.' })

export function SignupPage() {
  const { isSignedIn } = useAuth()
  const [sentTo, setSentTo] = useState(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema) })

  if (isSignedIn) return <Navigate to="/w" replace />

  const onSubmit = async ({ name, email, password }) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name },
        emailRedirectTo: `${window.location.origin}/verify`,
      },
    })
    if (error) {
      toast.error(error.message)
      return
    }
    if (data.session) return // email confirmation disabled in Supabase; user is signed in
    setSentTo(email)
  }

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" description={`We sent a confirmation link to ${sentTo}.`}>
        <div className="flex flex-col items-center gap-3 py-4 text-center text-sm text-muted-foreground">
          <MailCheck className="size-10 text-primary" />
          <p>Open the link to finish creating your account. Then come back and sign in.</p>
          <Button asChild variant="outline">
            <Link to="/login">Go to sign in</Link>
          </Button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Create your account"
      description="Free. Private. Takes one minute."
      footer={
        <>
          Already have an account? <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">Sign in</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor="name">Your name</Label>
          <Input id="name" autoComplete="name" {...register('name')} />
          {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" inputMode="email" {...register('email')} />
          {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="new-password" {...register('password')} />
          {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm">Type the password again</Label>
          <Input id="confirm" type="password" autoComplete="new-password" {...register('confirm')} />
          {errors.confirm && <p className="text-sm text-destructive">{errors.confirm.message}</p>}
        </div>
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting && <Spinner />} Create account
        </Button>
      </form>
    </AuthLayout>
  )
}
