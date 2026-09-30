/**
 * Date finding and classification. Pure functions, no DOM.
 */

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
}
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'

const PATTERNS = [
  // 2024-03-15 (ISO)
  { re: /(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/g, build: (m) => ({ y: +m[1], mo: +m[2], d: +m[3] }) },
  // 15/03/2024, 15-03-2024, 15.03.2024, 15/03/24
  { re: /(?<!\d)(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?!\d)/g, build: (m) => ({ d: +m[1], mo: +m[2], y: expandYear(m[3]) }) },
  // 15 Mar 2024, 15th March, 2024, 15-Mar-2024
  { re: new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-/,.]*${MONTH_RE}[\\s\\-/,.]*(\\d{2,4})(?!\\d)`, 'gi'), build: (m) => ({ d: +m[1], mo: MONTHS[m[2].toLowerCase()], y: expandYear(m[3]) }) },
  // March 15, 2024 / Mar 15 2024
  { re: new RegExp(`\\b${MONTH_RE}[\\s\\-/.]*(\\d{1,2})(?:st|nd|rd|th)?[\\s,.\\-/]*(\\d{4})(?!\\d)`, 'gi'), build: (m) => ({ d: +m[2], mo: MONTHS[m[1].toLowerCase()], y: +m[3] }) },
  // March 2024 (month + year only, day = 1, lower confidence)
  { re: new RegExp(`\\b${MONTH_RE}[\\s,.\\-/]*(\\d{4})(?!\\d)`, 'gi'), build: (m) => ({ d: 1, mo: MONTHS[m[1].toLowerCase()], y: +m[2], partial: true }) },
]

function expandYear(s) {
  const n = +s
  if (String(s).length === 4) return n
  return n < 70 ? 2000 + n : 1900 + n
}

function valid({ y, mo, d }) {
  if (!y || !mo || !d) return false
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

export function toIso({ y, mo, d }) {
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const EXPIRY_WORDS = /(expir|valid\s*(?:till|upto|up\s*to|until|through|thru|to)|date\s*of\s*expiry|exp\.?\s*(?:date|dt)?\b|due\s*date|valid\s*till|validity|renew(?:al)?\s*(?:date|due|by)|end\s*date|maturity|policy\s*end|period\s*to|\bto\s*date|payable\s*by|pay\s*by|last\s*date)/i
const ISSUE_WORDS = /(date\s*of\s*issue|issue[ds]?\b|issued\s*on|dated|invoice\s*date|bill\s*date|billing\s*date|\bdoi\b|start\s*date|from\s*date|period\s*from|commencement|effective|date\s*of\s*registration|registered\s*on|receipt\s*date|statement\s*date|date\s*of\s*joining|date\s*of\s*payment|payment\s*date|order\s*date|date\s*of\s*report|reported\s*on|\bdate\b\s*[:\-]?)/i
const DOB_WORDS = /(date\s*of\s*birth|\bdob\b|birth\s*date|born\s*on)/i

/** The label word closest to the end of the context (i.e. nearest to the date) wins. */
function nearestLabel(context) {
  let best = null
  for (const [label, re] of [['dob', DOB_WORDS], ['expiry', EXPIRY_WORDS], ['issue', ISSUE_WORDS]]) {
    const g = new RegExp(re.source, 'gi')
    let m
    let last = -1
    while ((m = g.exec(context))) {
      last = m.index
      if (m[0].length === 0) g.lastIndex++
    }
    if (last >= 0 && (!best || last > best.at || (last === best.at && label !== 'issue'))) best = { label, at: last }
  }
  return best ? best.label : null
}

/**
 * Find every date in the text with its surrounding label context.
 * @returns {Array<{ iso, y, mo, d, index, label: 'expiry'|'issue'|'dob'|null, partial }>}
 */
export function findDates(text) {
  const src = String(text || '')
  const seen = new Map()
  for (const { re, build } of PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(src))) {
      const parts = build(m)
      if (!valid(parts)) continue
      const iso = toIso(parts)
      const index = m.index
      // Skip a match that overlaps a stronger earlier one (e.g. "15 Mar 2024" also matches "Mar 2024").
      let overlaps = false
      for (const other of seen.values()) {
        if (index < other.end && index + m[0].length > other.index) { overlaps = true; break }
      }
      if (overlaps) continue
      const before = src.slice(Math.max(0, index - 45), index)
      const lineStart = Math.max(before.lastIndexOf('\n'), 0)
      const context = before.slice(lineStart === 0 && before.length > 30 ? 0 : lineStart)
      const label = nearestLabel(context)
      seen.set(`${index}`, { iso, ...parts, index, end: index + m[0].length, label, partial: !!parts.partial, raw: m[0] })
    }
  }
  return [...seen.values()].sort((a, b) => a.index - b.index)
}

/**
 * Pick issue_date / expiry_date from found dates.
 * @param {ReturnType<typeof findDates>} dates
 * @param {{ documentType?: string, now?: Date, expiringTypes?: Set<string>, datedTypes?: Set<string> }} opts
 */
export function classifyDates(dates, { documentType, now = new Date(), expiringTypes, datedTypes } = {}) {
  const out = {}
  if (!dates?.length) return out
  const labelledExpiry = dates.filter((d) => d.label === 'expiry')
  const labelledIssue = dates.filter((d) => d.label === 'issue')
  const usable = dates.filter((d) => d.label !== 'dob')

  if (labelledExpiry.length) {
    const pick = labelledExpiry.reduce((a, b) => (b.iso > a.iso ? b : a))
    out.expiry_date = { value: pick.iso, confidence: pick.partial ? 0.6 : 0.85 }
  }
  if (labelledIssue.length) {
    const pick = labelledIssue.reduce((a, b) => (b.iso < a.iso ? b : a))
    out.issue_date = { value: pick.iso, confidence: pick.partial ? 0.55 : 0.8 }
  }

  const todayIso = toIso({ y: now.getFullYear(), mo: now.getMonth() + 1, d: now.getDate() })
  const expiring = expiringTypes ? expiringTypes.has(documentType) : ['passport', 'insurance', 'driving_licence'].includes(documentType)
  if (!out.expiry_date && expiring) {
    const future = usable.filter((d) => d.iso > todayIso)
    if (future.length) {
      const pick = future.reduce((a, b) => (b.iso > a.iso ? b : a))
      out.expiry_date = { value: pick.iso, confidence: 0.5 }
      if (!out.issue_date) {
        const past = usable.filter((d) => d.iso <= todayIso && d.iso !== pick.iso)
        if (past.length) {
          const first = past.reduce((a, b) => (b.iso < a.iso ? b : a))
          out.issue_date = { value: first.iso, confidence: 0.4 }
        }
      }
    }
  }
  const dated = datedTypes ? datedTypes.has(documentType) : false
  if (!out.issue_date && (dated || !documentType) && usable.length) {
    const candidates = usable.filter((d) => d.iso <= todayIso)
    const pick = (candidates.length ? candidates : usable)[0]
    out.issue_date = { value: pick.iso, confidence: dated ? 0.5 : 0.35 }
  }
  return out
}
