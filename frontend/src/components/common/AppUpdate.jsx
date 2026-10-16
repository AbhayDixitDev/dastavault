import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'

/** Where the release workflow (.github/workflows/android.yml) publishes the newest version. Public, no sign-in. */
export const UPDATE_MANIFEST_URL = `${String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/public/app-releases/android/latest.json`

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

function updater() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null
  return cap?.isNativePlatform?.() ? cap.Plugins?.AppUpdater ?? null : null
}

/**
 * Android app only: looks for a newer version when the app starts (also on
 * the sign-in screens) and every few hours, downloads it right away and opens
 * Android's installer. Android asks the user to confirm the installation.
 */
export function AppUpdate() {
  const [update, setUpdate] = useState(null) // { version, versionCode, apkUrl, notes }
  const [status, setStatus] = useState('idle') // idle | downloading | installing | failed
  const [progress, setProgress] = useState(0)
  const [hidden, setHidden] = useState(false)
  const started = useRef(false)

  const download = useCallback(async (target) => {
    const plugin = updater()
    if (!plugin || !target) return
    setStatus('downloading')
    setProgress(0)
    try {
      await plugin.downloadAndInstall({ url: target.apkUrl })
      setStatus('installing')
    } catch {
      setStatus('failed')
    }
  }, [])

  const check = useCallback(async () => {
    const plugin = updater()
    if (!plugin || !UPDATE_MANIFEST_URL.startsWith('https://')) return
    try {
      const [res, info] = await Promise.all([fetch(UPDATE_MANIFEST_URL, { cache: 'no-store' }), plugin.getInfo()])
      if (!res.ok) return
      const latest = await res.json()
      if (Number(latest.versionCode) > Number(info.versionCode) && latest.apkUrl) {
        setUpdate(latest)
        setHidden(false)
        if (!started.current) {
          // Downloaded right away; the installer asks before anything changes.
          started.current = true
          download(latest)
        }
      }
    } catch {
      /* offline: try again later */
    }
  }, [download])

  useEffect(() => {
    const plugin = updater()
    if (!plugin) return undefined
    let listener
    Promise.resolve(plugin.addListener?.('downloadProgress', (e) => setProgress(Number(e?.progress) || 0))).then((l) => { listener = l })
    check()
    const timer = setInterval(check, CHECK_EVERY_MS)
    return () => {
      clearInterval(timer)
      listener?.remove?.()
    }
  }, [check])

  if (!update || hidden) return null

  return (
    <div className="safe-bottom fixed inset-x-3 bottom-24 z-[60] mx-auto max-w-md rounded-2xl border bg-card p-4 shadow-lift">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white">
          <Download className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">DastaVault {update.version} is available</p>
          <p className="text-xs text-muted-foreground">
            {status === 'downloading' && `Downloading… ${Math.round(progress * 100)}%`}
            {status === 'installing' && 'Tap Install on the screen that opened. Your data stays.'}
            {status === 'failed' && 'The download did not finish. Try again.'}
            {status === 'idle' && 'Download and install the new version.'}
          </p>
          {status === 'downloading' && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          {(status === 'failed' || status === 'installing' || status === 'idle') && (
            <button
              type="button"
              onClick={() => download(update)}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
            >
              <RefreshCw className="size-4" /> {status === 'installing' ? 'Open installer again' : 'Download and install'}
            </button>
          )}
        </div>
        <button type="button" aria-label="Later" onClick={() => setHidden(true)} className="text-muted-foreground">
          <X className="size-5" />
        </button>
      </div>
    </div>
  )
}
