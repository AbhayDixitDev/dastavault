import { supabase } from '@/lib/supabase'

/** The Android app's own link scheme (mobile/android, intent filter in AndroidManifest.xml). */
export const APP_LINK_SCHEME = 'com.dastavault.app'

export function isNativeApp() {
  return typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.())
}

/**
 * Where Supabase sends the user back after an email link (sign-up, magic
 * link, password reset) or Google sign-in. In the Android app that is
 * `com.dastavault.app://auth/<path>`, which opens the app; on the web it is
 * the page itself.
 *
 * Supabase only redirects to addresses listed under Authentication -> URL
 * Configuration -> Redirect URLs, so `com.dastavault.app://**` must be there.
 */
export function authRedirectUrl(path = '/w') {
  const clean = path.startsWith('/') ? path : `/${path}`
  return isNativeApp() ? `${APP_LINK_SCHEME}://auth${clean}` : `${window.location.origin}${clean}`
}

/**
 * Finishes a sign-in from an opened `com.dastavault.app://auth/...` link and
 * returns the app path to show, or null when the link is not an auth link.
 * Handles both link styles of Supabase: tokens in the #fragment and ?code=.
 */
export async function completeAuthFromAppLink(url) {
  if (!url || !url.startsWith(`${APP_LINK_SCHEME}://`)) return null
  const rest = url.slice(`${APP_LINK_SCHEME}://`.length) // auth/w?code=..#access_token=..
  const hashIndex = rest.indexOf('#')
  const hash = hashIndex >= 0 ? rest.slice(hashIndex + 1) : ''
  const beforeHash = hashIndex >= 0 ? rest.slice(0, hashIndex) : rest
  const queryIndex = beforeHash.indexOf('?')
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : ''
  const pathPart = (queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash).replace(/^auth/, '') || '/w'
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`

  const fromHash = new URLSearchParams(hash)
  const fromQuery = new URLSearchParams(query)
  const error = fromHash.get('error_description') || fromQuery.get('error_description')
  if (error) throw new Error(error)

  const accessToken = fromHash.get('access_token')
  const refreshToken = fromHash.get('refresh_token')
  const code = fromQuery.get('code')
  if (accessToken && refreshToken) {
    const { error: sessionError } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
    if (sessionError) throw sessionError
  } else if (code) {
    const { error: codeError } = await supabase.auth.exchangeCodeForSession(code)
    if (codeError) throw codeError
  }
  // A password reset link opens the page to choose the new password.
  return fromHash.get('type') === 'recovery' ? '/reset-password' : path
}
