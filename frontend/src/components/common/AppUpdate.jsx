import { useEffect, useSyncExternalStore } from 'react'
import { Download, ExternalLink, RefreshCw, ShieldCheck, X } from 'lucide-react'

/** Where the release workflow (.github/workflows/android.yml) publishes the newest version. Public, no sign-in. */
export const UPDATE_MANIFEST_URL = `${String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/public/app-releases/android/latest.json`

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

function updater() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null
  return cap?.isNativePlatform?.() ? cap.Plugins?.AppUpdater ?? null : null
}

/* ---------------------------------------------------- shared state */

// status: idle | checking | latest | available | needs-permission | downloading | installing | failed
let state = { status: 'idle', installed: null, latest: null, progress: 0, error: '', hidden: false, checkedAt: null }
const listeners = new Set()
const set = (changes) => {
  state = { ...state, ...changes }
  listeners.forEach((l) => l())
}
const subscribe = (l) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const useAppUpdate = () => useSyncExternalStore(subscribe, () => state)

let autoStarted = false

/** Looks for a newer version. Returns the state afterwards. */
export async function checkForUpdate({ auto = false } = {}) {
  const plugin = updater()
  if (!plugin) return state
  set({ status: 'checking', error: '' })
  try {
    const info = await plugin.getInfo()
    set({ installed: info })
    const res = await fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`The update server answered ${res.status}.`)
    const latest = await res.json()
    const newer = Number(latest.versionCode) > Number(info.versionCode) && latest.apkUrl
    set({ latest, checkedAt: Date.now(), status: newer ? 'available' : 'latest', hidden: false })
    if (newer && auto && !autoStarted) {
      // Downloaded right away; Android asks before anything is installed.
      autoStarted = true
      downloadUpdate()
    }
  } catch (err) {
    set({ status: 'failed', error: `Could not check for updates: ${err?.message || 'no internet connection'}.` })
  }
  return state
}

export async function downloadUpdate() {
  const plugin = updater()
  const target = state.latest
  if (!plugin || !target?.apkUrl) return
  try {
    const { allowed } = (await plugin.canInstall?.()) ?? { allowed: true }
    if (!allowed) {
      set({ status: 'needs-permission', hidden: false })
      return
    }
  } catch { /* older app: try anyway */ }
  set({ status: 'downloading', progress: 0, error: '', hidden: false })
  try {
    await plugin.downloadAndInstall({ url: target.apkUrl })
    set({ status: 'installing' })
  } catch (err) {
    if (/NOT_ALLOWED/.test(err?.message || '')) set({ status: 'needs-permission' })
    else set({ status: 'failed', error: `The download did not finish: ${err?.message || 'connection lost'}.` })
  }
}

export function allowInstalls() {
  updater()?.openInstallSettings?.()
}

/** Plan B: let the phone's browser download the APK. */
export function downloadInBrowser() {
  const url = state.latest?.apkUrl
  if (!url) return
  const plugin = updater()
  if (plugin?.openInBrowser) plugin.openInBrowser({ url }).catch(() => window.open(url, '_system'))
  else window.open(url, '_system')
}

/* --------------------------------------------------------- UI */

function UpdateActions({ s, compact = false }) {
  const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold'
  return (
    <div className={compact ? 'mt-2 flex flex-wrap gap-2' : 'mt-3 flex flex-wrap gap-2'}>
      {s.status === 'needs-permission' && (
        <button type="button" onClick={allowInstalls} className={`${btn} bg-primary text-primary-foreground`}>
          <ShieldCheck className="size-4" /> Allow updates
        </button>
      )}
      {['available', 'failed', 'installing', 'needs-permission'].includes(s.status) && s.latest?.apkUrl && (
        <button type="button" onClick={downloadUpdate} className={`${btn} ${s.status === 'needs-permission' ? 'border' : 'bg-primary text-primary-foreground'}`}>
          <RefreshCw className="size-4" /> {s.status === 'installing' ? 'Open installer again' : s.status === 'needs-permission' ? 'Try again' : 'Download and install'}
        </button>
      )}
      {['available', 'failed', 'installing', 'needs-permission', 'downloading'].includes(s.status) && s.latest?.apkUrl && (
        <button type="button" onClick={downloadInBrowser} className={`${btn} border`}>
          <ExternalLink className="size-4" /> Download in browser
        </button>
      )}
    </div>
  )
}

function statusLine(s) {
  switch (s.status) {
    case 'checking': return 'Checking for a new version…'
    case 'latest': return 'You have the newest version.'
    case 'available': return 'A new version is ready to download.'
    case 'needs-permission': return 'Android needs your OK once: tap "Allow updates", switch on "Allow from this source", come back and tap "Try again".'
    case 'downloading': return `Downloading… ${Math.round(s.progress * 100)}%`
    case 'installing': return 'Tap Install on the screen that opened. Your data stays.'
    case 'failed': return s.error || 'Something went wrong.'
    default: return ''
  }
}

/**
 * Android app only: looks for a newer version when the app starts (also on
 * the sign-in screens) and every few hours, downloads it right away and opens
 * Android's installer. Android asks the user to confirm the installation.
 */
export function AppUpdate() {
  const s = useAppUpdate()

  useEffect(() => {
    const plugin = updater()
    if (!plugin) return undefined
    let listener
    Promise.resolve(plugin.addListener?.('downloadProgress', (e) => set({ progress: Number(e?.progress) || 0 }))).then((l) => { listener = l })
    checkForUpdate({ auto: true })
    const timer = setInterval(() => checkForUpdate({ auto: true }), CHECK_EVERY_MS)
    return () => {
      clearInterval(timer)
      listener?.remove?.()
    }
  }, [])

  const show = s.latest && !s.hidden && ['available', 'needs-permission', 'downloading', 'installing'].includes(s.status)
    || (s.status === 'failed' && s.latest && Number(s.latest.versionCode) > Number(s.installed?.versionCode) && !s.hidden)
  if (!show) return null

  return (
    <div className="safe-bottom fixed inset-x-3 bottom-24 z-[60] mx-auto max-w-md rounded-2xl border bg-card p-4 shadow-lift">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white">
          <Download className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">DastaVault {s.latest.version} is available</p>
          <p className="text-xs text-muted-foreground">{statusLine(s)}</p>
          {s.status === 'downloading' && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(s.progress * 100)}%` }} />
            </div>
          )}
          <UpdateActions s={s} compact />
        </div>
        <button type="button" aria-label="Later" onClick={() => set({ hidden: true })} className="text-muted-foreground">
          <X className="size-5" />
        </button>
      </div>
    </div>
  )
}

/** Settings: installed and newest version, with a "Check now" button. Android app only. */
export function AppUpdateCard() {
  const s = useAppUpdate()
  if (!updater()) return null
  return (
    <section className="mb-4 rounded-2xl border bg-card p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">App update</h2>
          <p className="text-sm text-muted-foreground">
            On this phone: <span className="font-medium text-foreground">{s.installed?.versionName ?? '…'}</span>
            {s.latest && <> · Newest: <span className="font-medium text-foreground">{s.latest.version}</span></>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => checkForUpdate()}
          disabled={s.status === 'checking' || s.status === 'downloading'}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
        >
          <RefreshCw className={s.status === 'checking' ? 'size-4 animate-spin' : 'size-4'} /> Check now
        </button>
      </div>
      {statusLine(s) && <p className={`mt-2 text-sm ${s.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{statusLine(s)}</p>}
      {s.status === 'downloading' && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(s.progress * 100)}%` }} />
        </div>
      )}
      <UpdateActions s={s} />
    </section>
  )
}
