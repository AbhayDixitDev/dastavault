/**
 * In-memory holder for the unlocked Chaabi vault key.
 * The key lives only in this module's closure: never in Redux persist, localStorage,
 * sessionStorage or IndexedDB. It is dropped (locked) on:
 *   - 2 minutes without pointer / key / touch activity
 *   - the tab going to the background (visibilitychange -> hidden)
 *   - pagehide (tab close, navigation away)
 *   - Supabase SIGNED_OUT
 *   - lock() (the manual Lock button)
 */
import { supabase } from '@/lib/supabase'

export const AUTO_LOCK_MS = 2 * 60 * 1000

let vaultKey = null
let idleTimer = null
let listeners = new Set()
let wired = false
let lastReason = null

function notify() {
  const unlocked = !!vaultKey
  listeners.forEach((cb) => {
    try {
      cb(unlocked, lastReason)
    } catch {
      /* listener errors never break the vault */
    }
  })
}

function clearIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
}

function armIdleTimer() {
  clearIdleTimer()
  if (!vaultKey) return
  idleTimer = setTimeout(() => lock('idle'), AUTO_LOCK_MS)
}

/** Call on user activity; restarts the idle countdown while unlocked. */
export function touch() {
  if (vaultKey) armIdleTimer()
}

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll', 'wheel']

function wireGlobalListeners() {
  if (wired || typeof window === 'undefined') return
  wired = true
  ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, touch, { passive: true }))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') lock('background')
  })
  window.addEventListener('pagehide', () => lock('pagehide'))
  try {
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') lock('signout')
    })
  } catch {
    /* supabase not configured */
  }
}

/** Stores the unlocked key in memory and starts the idle timer. */
export function unlockWith(key) {
  wireGlobalListeners()
  vaultKey = key || null
  lastReason = null
  armIdleTimer()
  notify()
}

/** Drops the key. `reason` is passed to subscribers so the UI can say why it locked. */
export function lock(reason = 'manual') {
  const wasUnlocked = !!vaultKey
  vaultKey = null
  clearIdleTimer()
  lastReason = reason
  if (wasUnlocked) notify()
}

export function getKey() {
  return vaultKey
}

export function isUnlocked() {
  return !!vaultKey
}

/** subscribe((unlocked, reason) => {}) -> unsubscribe */
export function subscribe(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Why the vault last locked: 'idle' | 'background' | 'pagehide' | 'signout' | 'manual' | null */
export function lastLockReason() {
  return lastReason
}
