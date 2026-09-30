/**
 * chunkText(text, pages) -> [{ chunk_number, page_number, section, content }]
 * Paragraph-aware chunks of 200-800 chars with a one-sentence overlap.
 * Pure function, no DOM.
 */

const MIN = 200
const MAX = 800
const HARD_MAX = 1000

function splitSentences(s) {
  const parts = s.match(/[^.!?\n]+(?:[.!?]+|\n|$)\s*/g)
  return (parts || [s]).map((p) => p.trim()).filter(Boolean)
}

function lastSentence(s) {
  const sentences = splitSentences(s)
  const last = sentences[sentences.length - 1] || ''
  return last.length > 200 ? last.slice(-200) : last
}

function isHeading(line) {
  const t = line.trim()
  if (t.length < 3 || t.length > 60) return false
  if (/[.,;:]$/.test(t) && !/^\d+[.)]/.test(t)) return false
  const words = t.split(/\s+/)
  if (words.length > 8) return false
  const letters = t.replace(/[^a-z]/gi, '')
  if (!letters.length) return false
  const allCaps = t === t.toUpperCase() && letters.length >= 3
  const titleCase = words.every((w) => /^[A-Z0-9(]/.test(w) || /^(of|and|the|for|to|in|on|&|a|an)$/i.test(w))
  return allCaps || titleCase
}

function paragraphsOf(text) {
  const raw = String(text || '').replace(/\r/g, '')
  let blocks = raw.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean)
  // OCR text often has no blank lines: fall back to single lines when a block is huge.
  const out = []
  for (const b of blocks) {
    if (b.length > MAX * 2) out.push(...b.split(/\n/).map((l) => l.trim()).filter(Boolean))
    else out.push(b)
  }
  return out
}

function chunkOnePage(text, pageNumber, startNumber, sectionState) {
  const chunks = []
  let buf = ''
  let bufSection = sectionState.current
  let carry = ''

  const flush = () => {
    const content = buf.trim()
    if (!content) return
    chunks.push({ chunk_number: startNumber + chunks.length, page_number: pageNumber, section: bufSection || null, content })
    carry = lastSentence(content)
    buf = ''
  }

  for (const para of paragraphsOf(text)) {
    const firstLine = para.split('\n')[0]
    if (isHeading(firstLine)) sectionState.current = firstLine.trim()
    const pieces = para.length > MAX ? splitSentences(para) : [para]
    for (const piece of pieces) {
      let unit = piece
      while (unit.length > HARD_MAX) {
        const cut = unit.lastIndexOf(' ', MAX)
        const head = unit.slice(0, cut > MIN ? cut : MAX)
        if (buf) flush()
        buf = head
        bufSection = sectionState.current
        flush()
        unit = unit.slice(head.length).trim()
      }
      if (!buf) {
        buf = carry && carry !== unit && !unit.startsWith(carry) ? `${carry} ${unit}` : unit
        bufSection = sectionState.current
        continue
      }
      if (buf.length + unit.length + 1 > MAX && buf.length >= MIN) {
        flush()
        buf = carry && !unit.startsWith(carry) ? `${carry} ${unit}` : unit
        bufSection = sectionState.current
      } else {
        buf = `${buf}\n${unit}`
      }
    }
  }
  if (buf.trim()) {
    if (chunks.length && buf.trim().length < MIN && chunks[chunks.length - 1].content.length + buf.length < HARD_MAX + 200) {
      chunks[chunks.length - 1].content = `${chunks[chunks.length - 1].content}\n${buf.trim()}`
    } else {
      flush()
    }
  }
  return chunks
}

export function chunkText(text, pages) {
  try {
    const sectionState = { current: null }
    const list = Array.isArray(pages) && pages.length
      ? pages.map((p, i) => ({ page_number: p?.page_number ?? i + 1, text: String(p?.text ?? '') }))
      : [{ page_number: 1, text: String(text ?? '') }]
    const out = []
    for (const page of list) {
      if (!page.text.trim()) continue
      out.push(...chunkOnePage(page.text, page.page_number, out.length + 1, sectionState))
    }
    return out
  } catch {
    return []
  }
}
