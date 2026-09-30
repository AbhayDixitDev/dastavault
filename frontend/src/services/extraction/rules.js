/**
 * Rule-based detail extraction. Pure functions, no DOM, safe under `node --test`.
 */
import { TYPE_KEYWORDS, DOCUMENT_TYPE_LABELS, EXPIRING_TYPES, DATED_TYPES, typeLabel } from './documentTypes.js'
import { findDates, classifyDates } from './dates.js'

const STOPWORDS = new Set(('the and for with this that from your have been will are was were not but all any can may our you their they them its into over under than then also more most some such only same very each other about after before between during through where which while who whom whose what when why how here there these those been being does did done shall should would could might must upon per via etc name date number total amount page india indian government govt department dear sir madam regards thanks thank please kindly form type valid').split(' '))

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function normalise(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function lines(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

/* ---------------------------------------------------------------- type */

export function detectDocumentType(text) {
  const norm = ` ${normalise(text)} `
  const lower = ` ${String(text || '').toLowerCase()} `
  let best = null
  const scores = {}
  for (const [type, table] of Object.entries(TYPE_KEYWORDS)) {
    let score = 0
    for (const [kw, weight] of table) {
      const hay = /[^a-z0-9 ]/.test(kw) ? lower : norm
      const re = new RegExp(`(?<![a-z0-9])${escapeRe(kw)}(?![a-z0-9])`, 'g')
      const count = (hay.match(re) || []).length
      if (count) score += weight * Math.min(count, 3) ** 0.5
    }
    if (score > 0) scores[type] = score
    if (score > 0 && (!best || score > best.score)) best = { type, score }
  }
  if (!best) return null
  const sorted = Object.values(scores).sort((a, b) => b - a)
  const margin = sorted.length > 1 ? (sorted[0] - sorted[1]) / sorted[0] : 1
  const confidence = Math.max(0.3, Math.min(0.95, 0.35 + Math.min(best.score, 20) / 30 + margin * 0.25))
  return { type: best.type, confidence: +confidence.toFixed(2), scores }
}

/* ------------------------------------------------------------- numbers */

const NUMBER_PATTERNS = {
  passport: { re: /(?<![A-Z0-9])([A-Z][0-9]{7})(?![A-Z0-9])/g, key: 'document_number', confidence: 0.8 },
  pan: { re: /(?<![A-Z0-9])([A-Z]{5}[0-9]{4}[A-Z])(?![A-Z0-9])/g, key: 'document_number', confidence: 0.9 },
  aadhaar: { re: /(?<!\d)(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})(?!\d)/g, key: 'document_number', confidence: 0.75, mask: (m) => `XXXX XXXX ${m[3]}` },
  driving_licence: { re: /(?<![A-Z0-9])([A-Z]{2}[-\s]?\d{2}[-\s]?\d{4}[-\s]?\d{7})(?![A-Z0-9])/g, key: 'document_number', confidence: 0.8 },
  voter_id: { re: /(?<![A-Z0-9])([A-Z]{3}[0-9]{7})(?![A-Z0-9])/g, key: 'document_number', confidence: 0.75 },
  vehicle: { re: /(?<![A-Z0-9])([A-Z]{2}[-\s]?\d{1,2}[-\s]?[A-Z]{1,3}[-\s]?\d{4})(?![A-Z0-9])/g, key: 'registration_number', confidence: 0.75 },
}

const LABELLED = [
  { key: 'invoice_number', re: /\b(?:invoice|inv|bill)\s*(?:no|number|num|#|id)?\.?\s*[:\-#]?\s*([A-Z0-9][A-Z0-9\-\/.]{2,29})/gi, confidence: 0.8 },
  { key: 'policy_number', re: /\bpolicy\s*(?:no|number|num|#|id)?\.?\s*[:\-#]?\s*([A-Z0-9][A-Z0-9\-\/]{4,29})/gi, confidence: 0.8 },
  { key: 'registration_number', re: /\b(?:registration|regn|regd|reg)\.?\s*(?:no|number|num|#)?\.?\s*[:\-#]?\s*([A-Z0-9][A-Z0-9\-\/ ]{3,24}[A-Z0-9])/gi, confidence: 0.7 },
  { key: 'document_number', re: /\b(?:passport|licen[cs]e|dl|epic|certificate|account|a\/c|acct|consumer|customer|member|membership|roll|enrolment|enrollment|receipt|order|booking|reference|ref|pnr|ticket|application|file|claim|card|id)\s*(?:no|number|num|#|id)?\.?\s*[:\-#]\s*([A-Z0-9][A-Z0-9\-\/]{3,29})/gi, confidence: 0.6 },
  { key: 'document_number', re: /\b(?:no|number|num|id)\.?\s*[:\-#]\s*([A-Z0-9][A-Z0-9\-\/]{4,29})/gi, confidence: 0.4 },
]

const LABEL_WORDS = /^(?:no|number|num|date|dated|name|of|the|and|is|to|from|invoice|bill|policy|reg|regn)$/i

export function findNumbers(text, documentType) {
  const src = String(text || '')
  const upper = src.toUpperCase()
  const found = []
  const push = (key, value, confidence, index) => {
    if (!value || LABEL_WORDS.test(value)) return
    if (found.some((f) => f.key === key && f.value === value)) return
    found.push({ key, value, confidence, index })
  }

  const typed = NUMBER_PATTERNS[documentType]
  if (typed) {
    typed.re.lastIndex = 0
    const m = typed.re.exec(documentType === 'aadhaar' ? src : upper)
    if (m) push(typed.key, typed.mask ? typed.mask(m) : m[1].replace(/[\s-]/g, documentType === 'driving_licence' ? '' : ''), typed.confidence + 0.05, m.index)
  }

  for (const { key, re, confidence } of LABELLED) {
    re.lastIndex = 0
    let m
    let n = 0
    while ((m = re.exec(src)) && n < 3) {
      n++
      const value = m[1].trim().replace(/[.,;:]+$/, '')
      // Ignore dates and plain small numbers.
      if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(value) || /^\d{1,3}$/.test(value)) continue
      push(key, value, confidence, m.index)
    }
  }

  if (!documentType || !typed) {
    for (const [type, p] of Object.entries(NUMBER_PATTERNS)) {
      if (type === 'aadhaar' || type === 'vehicle') continue
      p.re.lastIndex = 0
      const m = p.re.exec(upper)
      if (m) push(p.key, m[1], Math.max(0.35, p.confidence - 0.3), m.index)
    }
    if (/aadha?ar|uidai/i.test(src)) {
      NUMBER_PATTERNS.aadhaar.re.lastIndex = 0
      const m = NUMBER_PATTERNS.aadhaar.re.exec(src)
      if (m) push('document_number', NUMBER_PATTERNS.aadhaar.mask(m), 0.7, m.index)
    }
  }

  // One suggestion per key: keep the most confident (ties: earliest).
  const byKey = new Map()
  for (const f of found.sort((a, b) => b.confidence - a.confidence || a.index - b.index)) {
    if (!byKey.has(f.key)) byKey.set(f.key, f)
  }
  // Never leak a full Aadhaar number, whatever the label, when the page is about Aadhaar.
  if (documentType === 'aadhaar' || /aadha?ar|uidai/i.test(src)) {
    for (const f of byKey.values()) {
      if (/^\d{4}\s?\d{4}\s?\d{4}$/.test(f.value)) f.value = `XXXX XXXX ${f.value.slice(-4)}`
    }
  }
  return [...byKey.values()]
}

/* -------------------------------------------------------------- amount */

const CURRENCY = { '₹': 'INR', rs: 'INR', 'rs.': 'INR', inr: 'INR', $: 'USD', usd: 'USD', us$: 'USD', '€': 'EUR', eur: 'EUR', '£': 'GBP', gbp: 'GBP', aed: 'AED', sgd: 'SGD' }
const AMOUNT_RE = /(₹|rs\.?|inr|us\$|\$|usd|€|eur|£|gbp|aed|sgd)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)(?![0-9])|(?<![0-9])([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)\s*(₹|rs\.?|inr|usd|eur|gbp|aed|sgd|\/-)/gi
const TOTAL_WORDS = /(grand\s*total|net\s*(?:payable|amount|total)|total\s*(?:amount|due|payable)?|amount\s*(?:due|payable|paid)|balance\s*due|payable|sum\s*insured|sum\s*assured|premium|net\s*pay)/i

export function findAmount(text) {
  const src = String(text || '')
  const found = []
  let m
  AMOUNT_RE.lastIndex = 0
  while ((m = AMOUNT_RE.exec(src))) {
    const symbol = (m[1] || m[4] || '').toLowerCase()
    const numStr = m[2] || m[3]
    const value = parseFloat(numStr.replace(/,/g, ''))
    if (!isFinite(value) || value <= 0) continue
    const currency = CURRENCY[symbol] || (symbol === '/-' ? 'INR' : 'INR')
    const before = src.slice(Math.max(0, m.index - 40), m.index)
    const lineStart = before.lastIndexOf('\n')
    const context = before.slice(lineStart + 1)
    const total = TOTAL_WORDS.test(context) ? (/grand|net|payable|due/i.test(context) ? 2 : 1) : 0
    found.push({ value, currency, total, index: m.index })
  }
  if (!found.length) return null
  found.sort((a, b) => b.total - a.total || b.value - a.value)
  const pick = found[0]
  return { amount: pick.value, currency: pick.currency, confidence: pick.total ? 0.8 : found.length === 1 ? 0.6 : 0.45 }
}

/* -------------------------------------------------------- contacts */

export function findEmail(text) {
  const m = String(text || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)
  return m ? m[0].toLowerCase() : null
}

export function findPhone(text) {
  const src = String(text || '')
  const m = src.match(/(?<![\d])(?:\+91[\s-]?|0)?([6-9]\d{4}[\s-]?\d{5})(?![\d])/)
  if (m) {
    const digits = m[1].replace(/\D/g, '')
    return { value: `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`, confidence: /\+91/.test(m[0]) ? 0.85 : 0.6 }
  }
  const intl = src.match(/(?<![\d])\+\d{1,3}[\s-]?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}(?![\d])/)
  return intl ? { value: intl[0].replace(/\s+/g, ' '), confidence: 0.6 } : null
}

/* ---------------------------------------------------- organisation */

const ORG_SUFFIX = /\b(ltd|limited|llp|pvt|private|inc|corp|corporation|co\.|company|bank|insurance|assurance|hospital|hospitals|clinic|school|college|university|institute|academy|government|ministry|department|authority|council|municipal|corporation|technologies|solutions|services|systems|industries|enterprises|trust|foundation|society|association|board|commission|agency|stores?|mart|motors|finance|financial|capital|securities|labs?|laboratories|pharma|pharmacy|airlines|railways?|telecom|electricity|power|energy|gas)\b/i
const BRANDS = ['LIC', 'Life Insurance Corporation', 'SBI', 'State Bank of India', 'HDFC', 'ICICI', 'Axis Bank', 'Kotak', 'Yes Bank', 'IndusInd', 'Punjab National Bank', 'Bank of Baroda', 'Canara Bank', 'Union Bank', 'IDFC', 'Airtel', 'Jio', 'Vodafone', 'Vi', 'BSNL', 'Reliance', 'Tata', 'Infosys', 'Wipro', 'TCS', 'HCL', 'Amazon', 'Flipkart', 'Google', 'Microsoft', 'Apple', 'Samsung', 'Adani', 'Bajaj', 'Max Life', 'Star Health', 'Niva Bupa', 'Care Health', 'New India Assurance', 'United India', 'Oriental Insurance', 'ICICI Lombard', 'HDFC Ergo', 'Apollo', 'Fortis', 'Max Healthcare', 'Medanta', 'AIIMS', 'CBSE', 'ICSE', 'NCERT', 'IGNOU', 'UIDAI', 'Passport Seva', 'Income Tax Department', 'Government of India', 'MSEB', 'MSEDCL', 'BESCOM', 'BSES', 'Tata Power', 'Torrent Power', 'Adani Electricity', 'Indian Oil', 'Bharat Petroleum', 'Hindustan Petroleum', 'IRCTC', 'Indian Railways', 'IndiGo', 'Air India', 'SpiceJet', 'Vistara', 'Ola', 'Uber', 'Swiggy', 'Zomato', 'Paytm', 'PhonePe', 'Zerodha', 'Groww', 'EPFO', 'ESIC', 'NPS', 'Delhi University', 'Mumbai University', 'Anna University', 'VTU', 'IIT', 'NIT', 'BITS', 'Zoho', 'Pabbly']

function isTitleCase(line) {
  const words = line.split(' ').filter((w) => /[a-z]/i.test(w))
  if (words.length < 2 || words.length > 8) return false
  const caps = words.filter((w) => /^[A-Z]/.test(w) || /^(of|and|the|for|&)$/i.test(w))
  return caps.length === words.length
}

export function findOrganisation(text) {
  const ls = lines(text).slice(0, 15)
  let best = null
  const consider = (value, confidence) => {
    const v = value.replace(/[|:;,.]+$/, '').trim()
    if (v.length < 3 || v.length > 80) return
    if (!best || confidence > best.confidence) best = { value: v, confidence }
  }
  const src = String(text || '')
  for (const brand of BRANDS) {
    const re = new RegExp(`(?<![a-z0-9])${escapeRe(brand)}(?![a-z0-9])`, brand.length <= 4 ? '' : 'i')
    if (re.test(src)) {
      const line = ls.find((l) => re.test(l)) || brand
      consider(ORG_SUFFIX.test(line) && line.length <= 60 ? line : brand, 0.75)
      break
    }
  }
  ls.forEach((line, i) => {
    if (/\d{4,}/.test(line) || /@/.test(line)) return
    const positional = Math.max(0, 0.1 - i * 0.01)
    if (ORG_SUFFIX.test(line) && line.split(' ').length <= 10) consider(line, 0.7 + positional)
    else if (line === line.toUpperCase() && /[A-Z]{3,}/.test(line) && line.split(' ').length >= 2 && line.split(' ').length <= 8 && !/^(TAX INVOICE|INVOICE|RECEIPT|CERTIFICATE|STATEMENT|BILL|PASSPORT|REPUBLIC OF INDIA|GOVERNMENT OF INDIA|INCOME TAX DEPARTMENT|ORIGINAL|COPY|DUPLICATE)$/.test(line)) consider(line, 0.45 + positional)
    else if (isTitleCase(line) && i < 6) consider(line, 0.4 + positional)
  })
  return best
}

/* --------------------------------------------------------- people */

function levenshtein(a, b) {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

const NAME_NOISE = new Set(['mr', 'mrs', 'ms', 'dr', 'shri', 'smt', 'kumari', 'sri', 'master', 'miss', 'late'])

/**
 * Fuzzy match people display names against the text.
 * @returns {{ person, ratio, exact } | null}
 */
export function matchPeople(text, people = []) {
  const norm = normalise(text)
  if (!norm || !people?.length) return null
  const tokens = new Set(norm.split(' ').filter(Boolean))
  let best = null
  for (const person of people) {
    const name = normalise(person?.display_name)
    if (!name) continue
    const parts = name.split(' ').filter((p) => p.length >= 2 && !NAME_NOISE.has(p))
    if (!parts.length) continue
    let matched = 0
    let exact = false
    if (norm.includes(` ${name} `) || norm.startsWith(`${name} `) || norm.endsWith(` ${name}`) || norm === name) {
      matched = parts.length
      exact = true
    } else {
      for (const p of parts) {
        if (tokens.has(p)) { matched++; continue }
        if (p.length >= 5) {
          for (const t of tokens) {
            if (Math.abs(t.length - p.length) <= 1 && levenshtein(t, p) <= 1) { matched += 0.8; break }
          }
        }
      }
    }
    const ratio = matched / parts.length
    // A single very short token is not enough evidence.
    if (parts.length === 1 && parts[0].length < 4 && !exact) continue
    if (ratio >= 0.5 && (!best || ratio > best.ratio || (ratio === best.ratio && exact && !best.exact))) best = { person, ratio, exact }
  }
  return best
}

export function matchGroups(text, groups = []) {
  const norm = ` ${normalise(text)} `
  let best = null
  for (const g of groups || []) {
    const name = normalise(g?.name)
    if (!name || name.length < 3) continue
    if (norm.includes(` ${name} `)) {
      const conf = Math.min(0.8, 0.45 + name.length * 0.03)
      if (!best || conf > best.confidence) best = { group: g, confidence: conf }
    }
  }
  return best
}

/* ------------------------------------------------- keywords, summary */

export function findKeywords(text, limit = 8) {
  const counts = new Map()
  for (const raw of normalise(text).split(' ')) {
    if (raw.length < 4 || /^\d+$/.test(raw) || STOPWORDS.has(raw)) continue
    if (!/[a-z]/.test(raw)) continue
    counts.set(raw, (counts.get(raw) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([w, c]) => ({ w, s: c * (w.length > 6 ? 1.3 : 1) * (/\d/.test(w) ? 0.6 : 1) }))
    .sort((a, b) => b.s - a.s || a.w.localeCompare(b.w))
    .slice(0, limit)
    .map((k) => k.w)
}

export function makeSummary(text, max = 160) {
  const good = lines(text).filter((l) => l.length >= 15 && (l.match(/[a-z]/gi) || []).length >= l.length * 0.5)
  const joined = good.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim()
  if (joined.length <= max) return joined
  const cut = joined.slice(0, max - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30))}…`
}

/* ------------------------------------------------------- main API */

/**
 * extractSuggestions(text, { people, groups, workspaceKind })
 * -> [{ key, value, confidence, source: 'rules' }]
 */
export function extractSuggestions(text, options) {
  const opts = options && typeof options === 'object' ? options : {}
  const people = Array.isArray(opts.people) ? opts.people : []
  const groups = Array.isArray(opts.groups) ? opts.groups : []
  const { workspaceKind, now } = opts
  const out = []
  const add = (key, value, confidence) => {
    if (value === null || value === undefined || value === '') return
    out.push({ key, value: String(value), confidence: +Math.max(0, Math.min(1, confidence)).toFixed(2), source: 'rules' })
  }
  try {
    const src = String(text || '')
    if (!src.trim()) return out

    const typeGuess = detectDocumentType(src)
    const documentType = typeGuess?.type || null
    if (typeGuess) add('document_type', typeGuess.type, typeGuess.confidence)

    const dates = findDates(src)
    const classified = classifyDates(dates, { documentType, now, expiringTypes: EXPIRING_TYPES, datedTypes: DATED_TYPES })
    if (classified.issue_date) add('issue_date', classified.issue_date.value, classified.issue_date.confidence)
    if (classified.expiry_date) add('expiry_date', classified.expiry_date.value, classified.expiry_date.confidence)

    for (const n of findNumbers(src, documentType)) add(n.key, n.value, n.confidence)

    const amount = findAmount(src)
    if (amount) {
      add('amount', amount.amount.toFixed(2).replace(/\.00$/, ''), amount.confidence)
      add('currency', amount.currency, amount.confidence)
    }

    const email = findEmail(src)
    if (email) add('email', email, 0.9)
    const phone = findPhone(src)
    if (phone) add('phone', phone.value, phone.confidence)

    const org = findOrganisation(src)
    if (org) {
      add('organisation', org.value, org.confidence)
      if (documentType === 'invoice' || documentType === 'receipt') add('vendor', org.value, org.confidence - 0.05)
    }

    const person = matchPeople(src, people)
    if (person) {
      const confidence = Math.min(0.95, 0.5 + person.ratio * 0.45)
      add('person_name', person.person.display_name, confidence)
      if (person.person.id) add('person_id', person.person.id, confidence)
    }
    const group = matchGroups(src, groups)
    if (group?.group?.id) add('group_id', group.group.id, group.confidence)

    const keywords = findKeywords(src)
    if (keywords.length) add('keywords', keywords.join(', '), 0.5)

    const summary = makeSummary(src)
    if (summary) add('summary', summary, 0.4)

    if (workspaceKind && !documentType) add('category', workspaceKind, 0.2)

    const suggestedName = suggestDocumentName({ suggestions: out, people, fallbackName: '' })
    if (suggestedName) add('suggested_name', suggestedName, Math.min(0.9, 0.4 + out.length * 0.05))
  } catch {
    // Never throw: return whatever was collected.
  }
  return out
}

function valueOf(suggestions, key) {
  const s = (suggestions || []).find((x) => x.key === key && x.value)
  return s ? s.value : null
}

/**
 * suggestDocumentName({ suggestions, people, fallbackName })
 * -> "Person - Type - Organisation/Identifier - Year" without the missing parts, max 80 chars.
 */
export function suggestDocumentName(args) {
  const { suggestions = [], people = [], fallbackName = '' } = args && typeof args === 'object' ? args : {}
  try {
    let person = valueOf(suggestions, 'person_name')
    if (!person) {
      const pid = valueOf(suggestions, 'person_id')
      const p = pid && (people || []).find((x) => x.id === pid)
      if (p) person = p.display_name
    }
    const type = valueOf(suggestions, 'document_type')
    const typeName = type ? (DOCUMENT_TYPE_LABELS[type] || typeLabel(type)) : null
    const org = valueOf(suggestions, 'organisation')
    const identifier = valueOf(suggestions, 'invoice_number') || valueOf(suggestions, 'policy_number') || valueOf(suggestions, 'registration_number') || valueOf(suggestions, 'document_number')
    const date = valueOf(suggestions, 'issue_date') || valueOf(suggestions, 'expiry_date')
    const year = date && /^\d{4}/.test(date) ? date.slice(0, 4) : null

    const middle = org && org.length <= 40 ? org : identifier
    const parts = [person, typeName, middle, year].filter((p) => p && String(p).trim())
    if (!parts.length) return fallbackName || ''
    let name = parts.map((p) => String(p).trim()).join(' - ')
    if (name.length > 80) {
      // Drop the organisation / identifier first, then trim.
      const short = [person, typeName, year].filter(Boolean).join(' - ')
      name = short.length > 80 ? `${short.slice(0, 79).trim()}…` : short
    }
    return name
  } catch {
    return fallbackName || ''
  }
}
