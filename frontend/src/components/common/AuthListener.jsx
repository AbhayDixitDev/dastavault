import { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import { supabase } from '@/lib/supabase'
import { sessionChanged } from '@/store/slices/authSlice'
import { setOnline } from '@/store/slices/uiSlice'
import { baseApi } from '@/store/api/baseApi'
import { completeAuthFromAppLink, isNativeApp } from '@/lib/authRedirect'
import { router } from '@/routes'
import { toast } from 'sonner'

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

  // Android app: email and Google sign-in links come back as
  // com.dastavault.app://auth/... and finish the sign-in here.
  useEffect(() => {
    if (!isNativeApp()) return undefined
    const appPlugin = window.Capacitor?.Plugins?.App
    if (!appPlugin) return undefined
    const handle = async (url) => {
      try {
        const path = await completeAuthFromAppLink(url)
        if (path) router.navigate(path, { replace: true })
      } catch (e) {
        toast.error(e?.message || 'Could not finish signing in. Please try again.')
      }
    }
    let listener
    Promise.resolve(appPlugin.addListener('appUrlOpen', (event) => handle(event?.url))).then((l) => { listener = l })
    // The app may have been started by the link.
    Promise.resolve(appPlugin.getLaunchUrl?.()).then((launch) => launch?.url && handle(launch.url)).catch(() => {})
    return () => listener?.remove?.()
  }, [])

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
