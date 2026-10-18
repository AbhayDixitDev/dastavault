/**
 * Turns the reader's lines into clean text. Pure functions, safe under `node --test`.
 *
 * A photo of a paper also shows the table, other papers and handwriting; the
 * reader turns those into lines of noise ("AX © 5% lt J", "2 D> 9 ENS") that
 * spoil the summary, the organisation and the numbers. Those lines are sure of
 * nothing, while printed text is read with high confidence, so lines are kept
 * by how sure the reader was of their words.
 *
 *   cleanLines(lines) -> string
 *     lines: [{ text, confidence (0..1), words: [{ text, confidence }] } | null (paragraph break)]
 */

const LATIN = /[A-Za-z]/g
const DEVANAGARI = /[ऀ-ॿ]/g

const count = (s, re) => (String(s).match(re) || []).length

/** A word that carries meaning: two letters (any script) or two digits. */
function meaningful(text) {
  return count(text, /\p{L}/gu) >= 2 || count(text, /\d/g) >= 2
}

function keepLine(line) {
  const words = line.words?.length ? line.words : String(line.text || '').split(/\s+/).filter(Boolean).map((text) => ({ text, confidence: line.confidence }))
  if (!words.length) return false
  const good = words.filter((w) => w.confidence >= 0.6 && meaningful(w.text)).length
  if (line.confidence >= 0.6 && good >= 1) return true
  return line.confidence >= 0.4 && good >= 2 && good / words.length >= 0.5
}

function cleanWords(line) {
  const words = line.words?.length ? line.words : String(line.text || '').split(/\s+/).filter(Boolean).map((text) => ({ text, confidence: line.confidence }))
  const latinLine = count(line.text, LATIN) >= count(line.text, DEVANAGARI)
  const out = []
  for (const w of words) {
    let t = String(w.text || '').trim()
    if (!t) continue
    // A lone "|" is how the reader sees the word "I".
    if (t === '|' && w.confidence >= 0.6) t = 'I'
    else if (w.confidence < 0.3) continue
    else if (latinLine && count(t, DEVANAGARI) && w.confidence < 0.5) continue
    // Stray marks: "\", "#", "=", "_", "©".
    else if (!/[\p{L}\p{N}]/u.test(t) && !/^[&\-–—/:]$/.test(t)) continue
    out.push(t)
  }
  return out
}

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

export function cleanLines(lines) {
  const kept = []
  for (const line of lines || []) {
    if (!line) {
      if (kept.length && kept[kept.length - 1] !== null) kept.push(null)
      continue
    }
    if (!keepLine(line)) continue
    const words = cleanWords(line)
    if (!words.length) continue
    kept.push(words)
  }
  // A curved or tilted line is sometimes read twice: once cut short
  // ("EMPLOYEE DATA CONF!"), once whole; and a word can be split over two
  // lines ("NON-DISCLOSURE" / "N-DISCLOSURE UNDERTAKING").
  const out = []
  for (let i = 0; i < kept.length; i++) {
    const words = kept[i]
    if (!words) { out.push(''); continue }
    const next = kept[i + 1]
    const here = norm(words.join(' '))
    if (next && here.length >= 8 && norm(next.join(' ')).startsWith(here.replace(/.$/, ''))) continue
    const prev = kept[i - 1]
    if (prev && words.length > 1) {
      const last = norm(prev[prev.length - 1])
      const first = norm(words[0])
      if (first.length >= 4 && last.length > first.length && last.endsWith(first)) words.shift()
    }
    out.push(words.join(' '))
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
