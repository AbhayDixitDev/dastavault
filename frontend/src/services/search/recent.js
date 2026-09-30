/**
 * Small localStorage helpers for the Search page: recent searches and the
 * "Search by meaning" preference. Every function is safe when storage is
 * blocked (private windows, etc.).
 */
const RECENT_KEY = 'dv.recentSearches'
const MEANING_KEY = 'dv.searchByMeaning'
const MAX_RECENT = 8

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : JSON.parse(v)
  } catch {
    return fallback
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

function scoped(workspaceId) {
  return `${RECENT_KEY}.${workspaceId || 'all'}`
}

export function getRecentSearches(workspaceId) {
  const list = read(scoped(workspaceId), [])
  return Array.isArray(list) ? list.filter((s) => typeof s === 'string' && s.trim()) : []
}

export function addRecentSearch(workspaceId, q) {
  const s = (q ?? '').toString().trim()
  if (!s) return getRecentSearches(workspaceId)
  const next = [s, ...getRecentSearches(workspaceId).filter((x) => x.toLowerCase() !== s.toLowerCase())].slice(0, MAX_RECENT)
  write(scoped(workspaceId), next)
  return next
}

export function removeRecentSearch(workspaceId, q) {
  const next = getRecentSearches(workspaceId).filter((x) => x !== q)
  write(scoped(workspaceId), next)
  return next
}

export function clearRecentSearches(workspaceId) {
  write(scoped(workspaceId), [])
  return []
}

/** "Search by meaning" is on unless the person turned it off. */
export function getSearchByMeaning() {
  const v = read(MEANING_KEY, true)
  return v !== false
}

export function setSearchByMeaning(on) {
  write(MEANING_KEY, Boolean(on))
}
