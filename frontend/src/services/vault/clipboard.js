import { toast } from 'sonner'

export const CLIPBOARD_CLEAR_MS = 30_000

let clearTimer = null

/**
 * Copies a secret and clears the clipboard 30 seconds later by writing an empty
 * string (only if the clipboard still holds the same value, when we are allowed to read it).
 * Returns true when the copy worked.
 */
export async function copySecret(text, { label = 'Copied. Will clear in 30 seconds', silent = false } = {}) {
  try {
    await navigator.clipboard.writeText(String(text ?? ''))
  } catch {
    if (!silent) toast.error('Could not copy. Your browser blocked it.')
    return false
  }
  if (!silent) toast.success(label)
  if (clearTimer) clearTimeout(clearTimer)
  clearTimer = setTimeout(async () => {
    clearTimer = null
    try {
      let same = true
      if (navigator.clipboard.readText) {
        try {
          same = (await navigator.clipboard.readText()) === String(text ?? '')
        } catch {
          same = true // cannot read: clear anyway, the secret must not linger
        }
      }
      if (same) await navigator.clipboard.writeText('')
    } catch {
      /* page not focused; nothing more we can do */
    }
  }, CLIPBOARD_CLEAR_MS)
  return true
}

/** Clears the clipboard right now if a copy is pending (called on lock). */
export async function clearPendingCopy() {
  if (!clearTimer) return
  clearTimeout(clearTimer)
  clearTimer = null
  try {
    await navigator.clipboard.writeText('')
  } catch {
    /* ignore */
  }
}
