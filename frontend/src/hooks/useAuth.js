import { useSelector } from 'react-redux'
import { selectAuth } from '@/store/slices/authSlice'
import { supabase } from '@/lib/supabase'

export function useAuth() {
  const auth = useSelector(selectAuth)

  return {
    ...auth,
    isLoading: auth.status === 'loading',
    isSignedIn: auth.status === 'signedIn',
    signOut: () => supabase.auth.signOut(),
  }
}
