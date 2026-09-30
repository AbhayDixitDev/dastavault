import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { AuthLayout } from './AuthLayout'
import { Button } from '@/components/ui/button'

/** Landing page for the email confirmation link. Supabase completes the session from the URL. */
export function VerifyPage() {
  const { isSignedIn, isLoading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (isSignedIn) {
      const t = setTimeout(() => navigate('/w', { replace: true }), 1200)
      return () => clearTimeout(t)
    }
  }, [isSignedIn, navigate])

  return (
    <AuthLayout title={isSignedIn ? 'Email confirmed' : 'Confirming your email...'}>
      <div className="flex flex-col items-center gap-3 py-4 text-center text-sm text-muted-foreground">
        {isSignedIn ? (
          <>
            <CheckCircle2 className="size-10 text-green-600" />
            <p>All set. Taking you to your vault.</p>
          </>
        ) : (
          <>
            <p>{isLoading ? 'One moment.' : 'The link may have expired. Please sign in to continue.'}</p>
            {!isLoading && (
              <Button asChild>
                <Link to="/login">Sign in</Link>
              </Button>
            )}
          </>
        )}
      </div>
    </AuthLayout>
  )
}
