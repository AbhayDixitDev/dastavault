import { isNativeApp } from '@/lib/authRedirect'

const RELOAD_KEY = 'dv-reloaded-for-update'

/**
 * Website: offline cache through the service worker.
 * Android app: no service worker. Older versions of the app registered one;
 * it kept serving the previous version's pages after an update, which then
 * asked for files the new version no longer has. It is removed here.
 */
export function setupServiceWorker() {
  // A page from an older version asking for a file that is gone: load the current version once.
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    reloadOnce()
  })

  if (!('serviceWorker' in navigator)) return
  if (isNativeApp()) {
    removeServiceWorkers()
    return
  }
  import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => {})
}

async function removeServiceWorkers() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    const hadWorker = registrations.length > 0 || Boolean(navigator.serviceWorker.controller)
    await Promise.all(registrations.map((r) => r.unregister()))
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
    // This page may itself have come from the old cache: load it fresh from the app once.
    if (hadWorker) reloadOnce()
  } catch {
    /* nothing to remove */
  }
}

export function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
    if (Date.now() - last < 30_000) return
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    /* storage blocked: reload anyway */
  }
  window.location.reload()
}
