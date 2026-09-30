import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

function GoogleIcon(props) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true" {...props}>
      <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.6 3.9-5.4 3.9-3.3 0-5.9-2.7-5.9-6s2.6-6 5.9-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" />
      <path fill="#4285F4" d="M21.2 12.2c0-.6-.1-1.1-.2-1.6H12v3.9h5.4c-.2 1.1-.9 2.2-1.9 2.9l3 2.3c1.7-1.6 2.7-4 2.7-7.5z" />
      <path fill="#FBBC05" d="M6.1 14.3A5.9 5.9 0 0 1 5.8 12c0-.8.1-1.6.4-2.3L3 7.3A9.6 9.6 0 0 0 2.4 12c0 1.6.4 3.1 1 4.4l2.7-2.1z" />
      <path fill="#34A853" d="M12 21.6c2.6 0 4.8-.9 6.4-2.3l-3-2.3c-.8.6-1.9 1-3.4 1-2.7 0-5-1.8-5.8-4.3l-3.1 2.4c1.6 3.2 4.9 5.5 8.9 5.5z" />
    </svg>
  )
}

/**
 * "Continue with Google" using Supabase Auth.
 * Google must be enabled in Supabase: Authentication -> Providers -> Google
 * (client ID + secret live there, never in this code).
 */
export function GoogleButton({ label = 'Continue with Google', redirectTo = '/w', className }) {
  const [busy, setBusy] = useState(false)

  const signIn = async () => {
    setBusy(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}${redirectTo}`,
        queryParams: { access_type: 'offline', prompt: 'select_account' },
      },
    })
    if (error) {
      setBusy(false)
      toast.error(
        /provider is not enabled/i.test(error.message)
          ? 'Google sign-in is not turned on yet. Enable it in Supabase (Authentication > Providers > Google).'
          : error.message,
      )
    }
    // On success the browser navigates to Google; nothing else to do here.
  }

  return (
    <Button type="button" variant="outline" size="lg" onClick={signIn} disabled={busy} className={className}>
      {busy ? <Spinner /> : <GoogleIcon />} {label}
    </Button>
  )
}
