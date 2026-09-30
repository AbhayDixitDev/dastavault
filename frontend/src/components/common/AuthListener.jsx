import { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import { supabase } from '@/lib/supabase'
import { sessionChanged } from '@/store/slices/authSlice'
import { setOnline } from '@/store/slices/uiSlice'
import { baseApi } from '@/store/api/baseApi'

/** Keeps the Redux auth state in sync with Supabase Auth and online status. */
export function AuthListener() {
  const dispatch = useDispatch()

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (active) dispatch(sessionChanged(data.session))
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      dispatch(sessionChanged(session))
      if (event === 'SIGNED_OUT') dispatch(baseApi.util.resetApiState())
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [dispatch])

  useEffect(() => {
    const on = () => dispatch(setOnline(true))
    const off = () => dispatch(setOnline(false))
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [dispatch])

  return null
}
