import { Briefcase, CreditCard, Landmark, MoreHorizontal, Share2, User, Wifi } from 'lucide-react'

/** Categories match the Worker enum: personal, banking, work, social, wifi, cards, other. */
export const CATEGORIES = [
  { key: 'personal', label: 'Personal', icon: User },
  { key: 'banking', label: 'Banking', icon: Landmark },
  { key: 'work', label: 'Work', icon: Briefcase },
  { key: 'social', label: 'Social', icon: Share2 },
  { key: 'wifi', label: 'Wi-Fi', icon: Wifi },
  { key: 'cards', label: 'Cards', icon: CreditCard },
  { key: 'other', label: 'Other', icon: MoreHorizontal },
]

export function categoryOf(key) {
  return CATEGORIES.find((c) => c.key === key) || CATEGORIES[CATEGORIES.length - 1]
}

/** Hostname of a website string; '' when it is not a URL-ish value. */
export function domainOf(website = '') {
  const s = String(website || '').trim()
  if (!s) return ''
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function faviconUrl(website) {
  const d = domainOf(website)
  return d ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64` : ''
}

/** "john.doe@example.com" -> "jo***@example.com"; "johndoe" -> "jo*****" */
export function maskUsername(u = '') {
  const s = String(u || '')
  if (!s) return ''
  const at = s.indexOf('@')
  if (at > 0) return `${s.slice(0, Math.min(2, at))}${'*'.repeat(Math.max(1, Math.min(6, at - 2)))}${s.slice(at)}`
  return `${s.slice(0, 2)}${'*'.repeat(Math.max(1, Math.min(8, s.length - 2)))}`
}

export const CLIPBOARD_CLEAR_MS = 30_000
