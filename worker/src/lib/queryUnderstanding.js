import { unwrap } from './errors.js'

/**
 * Query understanding for natural-language search (contract section 4).
 *
 * understandQuery(db, { wsId, userId, q }) ->
 *   { terms, person_ids, person_names, document_type, date_range, relation_words,
 *     document_numbers, expiring, fts_query }
 *
 * - relation words (dad, mom, wife, ...) resolve through people.user_id = current
 *   user -> person_relationships (and people.relation_label as a fallback)
 * - document type words and synonyms
 * - years, month names, "last year", "this year", "expiring"
 * - document numbers (6+ alphanumerics with at least one digit)
 * - remaining words are matched against people.display_name (trigram > 0.4)
 */

export const DOCUMENT_TYPES = [
  'passport', 'aadhaar', 'pan', 'driving_licence', 'voter_id', 'birth_certificate', 'marksheet', 'degree', 'id_card',
  'insurance', 'medical_report', 'prescription', 'invoice', 'receipt', 'bank_statement', 'tax', 'salary_slip', 'contract',
  'agreement', 'letter', 'certificate', 'property', 'vehicle', 'utility_bill', 'ticket', 'photo', 'note', 'written', 'other',
]

const TYPE_PHRASES = {
  'driving licence': 'driving_licence', 'driving license': 'driving_licence', 'drivers licence': 'driving_licence', 'drivers license': 'driving_licence',
  'pan card': 'pan', 'voter id': 'voter_id', 'voter card': 'voter_id', 'birth certificate': 'birth_certificate', 'bank statement': 'bank_statement',
  'salary slip': 'salary_slip', 'pay slip': 'salary_slip', 'medical report': 'medical_report', 'utility bill': 'utility_bill', 'electricity bill': 'utility_bill',
  'water bill': 'utility_bill', 'gas bill': 'utility_bill', 'phone bill': 'utility_bill', 'id card': 'id_card', 'identity card': 'id_card',
  'mark sheet': 'marksheet', 'aadhaar card': 'aadhaar', 'aadhar card': 'aadhaar', 'income tax': 'tax', 'tax return': 'tax',
}

const TYPE_WORDS = {
  passport: 'passport', passports: 'passport', aadhaar: 'aadhaar', aadhar: 'aadhaar', adhar: 'aadhaar', aadhaars: 'aadhaar', pan: 'pan', pancard: 'pan',
  licence: 'driving_licence', license: 'driving_licence', licences: 'driving_licence', licenses: 'driving_licence', dl: 'driving_licence',
  voter: 'voter_id', voterid: 'voter_id', marksheet: 'marksheet', marksheets: 'marksheet', degree: 'degree', degrees: 'degree', diploma: 'degree',
  insurance: 'insurance', policy: 'insurance', policies: 'insurance', medical: 'medical_report', prescription: 'prescription', prescriptions: 'prescription',
  invoice: 'invoice', invoices: 'invoice', receipt: 'receipt', receipts: 'receipt', statement: 'bank_statement', statements: 'bank_statement',
  tax: 'tax', taxes: 'tax', itr: 'tax', salary: 'salary_slip', payslip: 'salary_slip', payslips: 'salary_slip', contract: 'contract', contracts: 'contract',
  agreement: 'agreement', agreements: 'agreement', letter: 'letter', letters: 'letter', certificate: 'certificate', certificates: 'certificate',
  property: 'property', deed: 'property', vehicle: 'vehicle', rc: 'vehicle', car: 'vehicle', bike: 'vehicle', bill: 'utility_bill', bills: 'utility_bill',
  ticket: 'ticket', tickets: 'ticket', photo: 'photo', photos: 'photo', picture: 'photo', note: 'note', notes: 'note', written: 'written',
}

/** relation word -> relations to look for. `asFrom`: rows where the other person is `from` and I am `to`; `asTo`: I am `from`. */
const RELATION_WORDS = {
  dad: { asFrom: ['father', 'parent'], asTo: ['son', 'daughter', 'child'] },
  father: { asFrom: ['father', 'parent'], asTo: ['son', 'daughter', 'child'] },
  papa: { asFrom: ['father', 'parent'], asTo: ['son', 'daughter', 'child'] },
  mom: { asFrom: ['mother', 'parent'], asTo: ['son', 'daughter', 'child'] },
  mum: { asFrom: ['mother', 'parent'], asTo: ['son', 'daughter', 'child'] },
  mother: { asFrom: ['mother', 'parent'], asTo: ['son', 'daughter', 'child'] },
  wife: { asFrom: ['spouse'], asTo: ['spouse'] },
  husband: { asFrom: ['spouse'], asTo: ['spouse'] },
  spouse: { asFrom: ['spouse'], asTo: ['spouse'] },
  son: { asFrom: ['son', 'child'], asTo: ['father', 'mother', 'parent'] },
  daughter: { asFrom: ['daughter', 'child'], asTo: ['father', 'mother', 'parent'] },
  brother: { asFrom: ['brother'], asTo: ['brother', 'sister'] },
  sister: { asFrom: ['sister'], asTo: ['brother', 'sister'] },
  grandpa: { asFrom: ['grandparent'], asTo: ['grandchild'] },
  grandma: { asFrom: ['grandparent'], asTo: ['grandchild'] },
  grandfather: { asFrom: ['grandparent'], asTo: ['grandchild'] },
  grandmother: { asFrom: ['grandparent'], asTo: ['grandchild'] },
  guardian: { asFrom: ['guardian'], asTo: [] },
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const MONTH_SHORT = { jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 }
const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'my', 'me', 'for', 'from', 'to', 'in', 'on', 'and', 'or', 'with', 'find', 'show', 'get', 'search', 'documents', 'document', 'docs', 'doc', 'file', 'files', 'please', 'all', 'is', 'are', 'was', 'were', 'that', 'this', 'about', 'copy', 'copies'])

export function normalizeQuery(q) {
  return String(q || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function trigramSet(s) {
  const out = new Set()
  for (const word of normalizeQuery(s).split(' ')) {
    if (!word) continue
    const padded = `  ${word} `
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3))
  }
  return out
}

/** pg_trgm-like similarity in [0, 1]. */
export function trigramSimilarity(a, b) {
  const A = trigramSet(a)
  const B = trigramSet(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

export function hammingDistanceHex(a, b) {
  const x = String(a || '').toLowerCase()
  const y = String(b || '').toLowerCase()
  if (!x || !y || x.length !== y.length) return Infinity
  let d = 0
  for (let i = 0; i < x.length; i++) {
    const v = parseInt(x[i], 16) ^ parseInt(y[i], 16)
    if (Number.isNaN(v)) return Infinity
    d += (v & 1) + ((v >> 1) & 1) + ((v >> 2) & 1) + ((v >> 3) & 1)
  }
  return d
}

function isoDate(d) {
  return d.toISOString().slice(0, 10)
}

function addDays(d, n) {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + n)
  return out
}

export async function understandQuery(db, { wsId, userId, q }) {
  const cleaned = normalizeQuery(q)
  const result = {
    terms: [],
    person_ids: [],
    person_names: [],
    document_type: null,
    date_range: null,
    relation_words: [],
    document_numbers: [],
    expiring: false,
    fts_query: cleaned,
  }
  if (!cleaned) return result

  let text = ` ${cleaned} `
  // multi-word document types first
  for (const [phrase, type] of Object.entries(TYPE_PHRASES)) {
    if (text.includes(` ${phrase} `)) {
      result.document_type = result.document_type || type
      text = text.replace(` ${phrase} `, ' ')
    }
  }
  // time phrases
  const now = new Date()
  const year = now.getUTCFullYear()
  if (text.includes(' last year ')) {
    result.date_range = { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` }
    text = text.replace(' last year ', ' ')
  }
  if (text.includes(' this year ')) {
    result.date_range = { from: `${year}-01-01`, to: `${year}-12-31` }
    text = text.replace(' this year ', ' ')
  }
  if (text.includes(' last month ')) {
    const d = new Date(Date.UTC(year, now.getUTCMonth() - 1, 1))
    result.date_range = { from: isoDate(d), to: isoDate(new Date(Date.UTC(year, now.getUTCMonth(), 0))) }
    text = text.replace(' last month ', ' ')
  }

  const words = text.trim().split(' ').filter(Boolean)
  const leftover = []
  let monthIndex = null
  let yearFound = null

  for (const w of words) {
    if (TYPE_WORDS[w]) {
      result.document_type = result.document_type || TYPE_WORDS[w]
      continue
    }
    if (DOCUMENT_TYPES.includes(w)) {
      result.document_type = result.document_type || w
      continue
    }
    if (RELATION_WORDS[w]) {
      result.relation_words.push({ word: w, person_id: null })
      continue
    }
    if (w === 'expiring' || w === 'expires' || w === 'expiry' || w === 'expire' || w === 'renew' || w === 'renewal') {
      result.expiring = true
      continue
    }
    if (/^(19|20)\d{2}$/.test(w)) {
      yearFound = Number(w)
      continue
    }
    const mi = MONTHS.indexOf(w) >= 0 ? MONTHS.indexOf(w) : MONTH_SHORT[w] ?? -1
    if (mi >= 0) {
      monthIndex = mi
      continue
    }
    if (/^[a-z0-9-]{6,}$/.test(w) && /\d/.test(w)) {
      result.document_numbers.push(w.toUpperCase())
      continue
    }
    if (STOP_WORDS.has(w)) continue
    leftover.push(w)
  }

  if (yearFound !== null || monthIndex !== null) {
    const y = yearFound ?? year
    if (monthIndex !== null) {
      const from = new Date(Date.UTC(y, monthIndex, 1))
      const to = new Date(Date.UTC(y, monthIndex + 1, 0))
      result.date_range = { from: isoDate(from), to: isoDate(to) }
    } else {
      result.date_range = { from: `${y}-01-01`, to: `${y}-12-31` }
    }
  }
  if (result.expiring) {
    result.expiry_range = { from: isoDate(now), to: isoDate(addDays(now, 90)) }
  }

  // Relation words -> my person -> relationships
  if (result.relation_words.length) {
    const me = unwrap(await db.from('people').select('id').eq('workspace_id', wsId).eq('user_id', userId).is('deleted_at', null).maybeSingle(), 'Load my person')
    let rels = []
    if (me) {
      rels = unwrap(
        await db.from('person_relationships').select('from_person_id, to_person_id, relation').eq('workspace_id', wsId).or(`from_person_id.eq.${me.id},to_person_id.eq.${me.id}`),
        'Load my relationships',
      )
    }
    const labelRows = unwrap(
      await db.from('people').select('id, display_name, relation_label').eq('workspace_id', wsId).is('deleted_at', null).not('relation_label', 'is', null),
      'Load relation labels',
    )
    for (const rw of result.relation_words) {
      const spec = RELATION_WORDS[rw.word]
      const ids = new Set()
      if (me) {
        for (const r of rels) {
          if (r.to_person_id === me.id && spec.asFrom.includes(r.relation)) ids.add(r.from_person_id)
          if (r.from_person_id === me.id && spec.asTo.includes(r.relation)) ids.add(r.to_person_id)
        }
      }
      if (!ids.size) {
        for (const p of labelRows) {
          const label = normalizeQuery(p.relation_label)
          if (label === rw.word || label.split(' ').includes(rw.word)) ids.add(p.id)
        }
      }
      const first = [...ids][0] || null
      rw.person_id = first
      for (const id of ids) if (!result.person_ids.includes(id)) result.person_ids.push(id)
    }
  }

  // Remaining words -> people by name (trigram similarity > 0.4)
  if (leftover.length) {
    const people = unwrap(await db.from('people').select('id, display_name, first_name, last_name').eq('workspace_id', wsId).is('deleted_at', null).limit(500), 'Load people')
    const consumed = new Set()
    for (const w of leftover) {
      if (w.length < 3) continue
      let best = null
      let bestScore = 0.4
      for (const p of people) {
        const candidates = [p.display_name, p.first_name, p.last_name].filter(Boolean)
        for (const cand of candidates) {
          const score = Math.max(trigramSimilarity(w, cand), ...cand.split(/\s+/).map((part) => trigramSimilarity(w, part)))
          if (score > bestScore) {
            bestScore = score
            best = p
          }
        }
      }
      if (best) {
        consumed.add(w)
        if (!result.person_ids.includes(best.id)) {
          result.person_ids.push(best.id)
          result.person_names.push(best.display_name)
        }
      }
    }
    result.terms = leftover.filter((w) => !consumed.has(w))
  }

  result.fts_query = [...result.terms, ...result.document_numbers.map((n) => n.toLowerCase())].join(' ') || (result.document_type ? result.document_type.replace(/_/g, ' ') : '')
  return result
}
