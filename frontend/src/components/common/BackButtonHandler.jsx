import { useEffect, useState } from 'react'
import { router } from '@/routes'
import { isNativeApp } from '@/lib/authRedirect'

/** Screens where Back leaves the app (after asking) instead of going back. */
function isRootScreen(pathname) {
  return /^\/(w\/[^/]+\/?|w\/?|login\/?|)$/.test(pathname)
}

/**
 * Android app: the Back button goes back inside the app. On a main screen,
 * or when there is nothing to go back to, it asks before closing the app.
 */
export function BackButtonHandler() {
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    if (!isNativeApp()) return undefined
    const app = window.Capacitor?.Plugins?.App
    if (!app) return undefined
    let listener
    Promise.resolve(
      app.addListener('backButton', ({ canGoBack }) => {
        // An open dialog or sheet closes first (Radix closes on Escape).
        const openOverlay = document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')
        if (openOverlay) {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          return
        }
        const pathname = router.state.location.pathname
        if (canGoBack && !isRootScreen(pathname)) {
          window.history.back()
        } else {
          setConfirmOpen(true)
        }
      }),
    ).then((l) => {
      listener = l
    })
    return () => listener?.remove?.()
  }, [])

  if (!confirmOpen) return null

  const exit = () => {
    setConfirmOpen(false)
    window.Capacitor?.Plugins?.App?.exitApp?.()
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={() => setConfirmOpen(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="exit-title"
        className="w-full max-w-sm rounded-2xl border bg-card p-5 shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="exit-title" className="font-display text-lg font-semibold">
          Close DastaVault?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Are you sure you want to close the app?</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmOpen(false)} className="rounded-xl px-4 py-2 text-sm font-semibold hover:bg-accent">
            No, stay
          </button>
          <button type="button" onClick={exit} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            Yes, close
          </button>
        </div>
      </div>
    </div>
  )
}
