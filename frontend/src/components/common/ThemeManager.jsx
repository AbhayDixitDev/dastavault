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
