import { useEffect } from 'react'
import { useSelector } from 'react-redux'
import { selectUi } from '@/store/slices/uiSlice'

/** Applies theme and large-text preferences to the <html> element. */
export function ThemeManager() {
  const { theme, largeText } = useSelector(selectUi)

  useEffect(() => {
    const root = document.documentElement
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mql.matches)
      root.classList.toggle('dark', dark)
      syncNativeStatusBar(dark)
    }
    apply()
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    document.documentElement.classList.toggle('large-text', Boolean(largeText))
  }, [largeText])

  return null
}

/**
 * In the Android app (mobile/, Capacitor) the system status bar follows the
 * theme: dark icons on the light background, light icons on the dark one.
 * Does nothing in the browser.
 */
function syncNativeStatusBar(dark) {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null
  const statusBar = cap?.isNativePlatform?.() ? cap.Plugins?.StatusBar : null
  if (!statusBar) return
  try {
    Promise.resolve(statusBar.setStyle({ style: dark ? 'DARK' : 'LIGHT' })).catch(() => {})
    Promise.resolve(statusBar.setBackgroundColor({ color: dark ? '#0B0B12' : '#F9F8FD' })).catch(() => {})
  } catch {
    /* older app without the plugin */
  }
}
