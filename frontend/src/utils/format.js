import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

export function formatDate(value, fmt = 'D MMM YYYY') {
  if (!value) return ''
  return dayjs(value).format(fmt)
}

export function fromNow(value) {
  if (!value) return ''
  return dayjs(value).fromNow()
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('')
}

/** Best human name for a signed-in user: profile name, then OAuth full name, then email prefix. */
export function displayNameOf(user, profile) {
  const m = user?.metadata ?? {}
  const candidates = [profile?.display_name, m.display_name, m.full_name, m.name, user?.email?.split('@')[0]]
  return candidates.find((v) => typeof v === 'string' && v.trim())?.trim() || ''
}

export function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let i = -1
  let n = bytes
  do {
    n /= 1024
    i++
  } while (n >= 1024 && i < units.length - 1)
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`
}
