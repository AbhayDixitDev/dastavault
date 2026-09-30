/**
 * Small line diff using the classic LCS table. Good enough for a few thousand
 * lines of document text. Returns [{ type: 'same'|'add'|'remove', text }].
 */
export function lineDiff(aText = '', bText = '', { maxLines = 4000 } = {}) {
  const a = String(aText || '').split(/\r?\n/).slice(0, maxLines)
  const b = String(bText || '').split(/\r?\n/).slice(0, maxLines)
  const n = a.length
  const m = b.length
  // If both are huge, fall back to a simple replace to keep memory sane.
  if (n * m > 4_000_000) {
    return [...a.map((text) => ({ type: 'remove', text })), ...b.map((text) => ({ type: 'add', text }))]
  }
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp = new Array(n + 1)
  for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'remove', text: a[i] })
      i++
    } else {
      out.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ type: 'remove', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}

/** Counts of added and removed lines. */
export function diffStats(diff = []) {
  let added = 0
  let removed = 0
  for (const d of diff) {
    if (d.type === 'add') added++
    else if (d.type === 'remove') removed++
  }
  return { added, removed }
}
