// Run with: node --test src/services/extraction/__tests__/extraction.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findDates, classifyDates } from '../dates.js'
import { extractSuggestions, suggestDocumentName, findNumbers, findAmount, findPhone, detectDocumentType, matchPeople } from '../rules.js'
import { chunkText } from '../chunk.js'
import { hammingDistance, dHashFromGray } from '../hash.js'

const byKey = (list, key) => list.find((s) => s.key === key)

test('findDates parses many formats', () => {
  const text = 'Issued 15/03/2024. Valid till 14-03-2034. Born 2 Jan 1990. Filed March 5, 2021. Period Apr 2023. ISO 2022-12-31.'
  const dates = findDates(text).map((d) => d.iso)
  assert.deepEqual(dates, ['2024-03-15', '2034-03-14', '1990-01-02', '2021-03-05', '2023-04-01', '2022-12-31'])
})

test('findDates labels issue, expiry and dob by nearby words', () => {
  const dates = findDates('Date of Issue: 01/02/2020\nDate of Expiry: 01/02/2030\nDOB 05/05/1985')
  assert.equal(dates[0].label, 'issue')
  assert.equal(dates[1].label, 'expiry')
  assert.equal(dates[2].label, 'dob')
})

test('classifyDates picks the latest future date for a passport without labels', () => {
  const dates = findDates('Republic of India 12/01/2019 12/01/2029')
  const out = classifyDates(dates, { documentType: 'passport', now: new Date('2026-10-01') })
  assert.equal(out.expiry_date.value, '2029-01-12')
  assert.equal(out.issue_date.value, '2019-01-12')
})

test('classifyDates uses labelled dates first', () => {
  const dates = findDates('Valid upto 10/10/2027 and issued on 10/10/2017 and another date 01/01/2040')
  const out = classifyDates(dates, { documentType: 'insurance', now: new Date('2026-10-01') })
  assert.equal(out.expiry_date.value, '2027-10-10')
  assert.equal(out.issue_date.value, '2017-10-10')
})

test('findNumbers finds a passport number', () => {
  const nums = findNumbers('REPUBLIC OF INDIA PASSPORT No. J8369854 Surname KUMAR', 'passport')
  assert.equal(byKey(nums, 'document_number').value, 'J8369854')
})

test('findNumbers finds a PAN', () => {
  const nums = findNumbers('Permanent Account Number ABCDE1234F', 'pan')
  assert.equal(byKey(nums, 'document_number').value, 'ABCDE1234F')
})

test('findNumbers masks Aadhaar', () => {
  const nums = findNumbers('Aadhaar 1234 5678 9012 Government of India', 'aadhaar')
  assert.equal(byKey(nums, 'document_number').value, 'XXXX XXXX 9012')
  const noType = findNumbers('Aadhaar 1234 5678 9012 Government of India', null)
  assert.equal(byKey(noType, 'document_number').value, 'XXXX XXXX 9012')
})

test('findNumbers finds invoice, policy and registration numbers', () => {
  const nums = findNumbers('Invoice No: INV-2024-0091\nPolicy Number 123456789012\nRegistration No. MH12AB1234', 'invoice')
  assert.equal(byKey(nums, 'invoice_number').value, 'INV-2024-0091')
  assert.equal(byKey(nums, 'policy_number').value, '123456789012')
  assert.equal(byKey(nums, 'registration_number').value, 'MH12AB1234')
})

test('findAmount prefers the grand total and maps currency', () => {
  const a = findAmount('Subtotal Rs 1,000.00\nGST ₹ 180.00\nGrand Total ₹ 1,180.00')
  assert.equal(a.amount, 1180)
  assert.equal(a.currency, 'INR')
  const usd = findAmount('Total $ 42.50')
  assert.equal(usd.currency, 'USD')
  assert.equal(usd.amount, 42.5)
})

test('findPhone finds Indian numbers', () => {
  assert.equal(findPhone('Call +91 98765 43210 now').value, '+91 98765 43210')
  assert.equal(findPhone('Mobile: 9876543210').value, '+91 98765 43210')
})

test('detectDocumentType scores keyword tables', () => {
  assert.equal(detectDocumentType('TAX INVOICE\nGSTIN 27AAAAA0000A1Z5\nInvoice No 12\nGrand Total').type, 'invoice')
  assert.equal(detectDocumentType('REPUBLIC OF INDIA PASSPORT Nationality INDIAN Place of birth').type, 'passport')
  assert.equal(detectDocumentType('Statement of Marks CBSE Roll No 1234 Marks obtained').type, 'marksheet')
  assert.equal(detectDocumentType('Electricity bill Units consumed 240 kWh Meter No 55').type, 'utility_bill')
  assert.equal(detectDocumentType(''), null)
})

test('matchPeople fuzzy matches with OCR noise', () => {
  const people = [{ id: 'p1', display_name: 'Neeraj Agarwal' }, { id: 'p2', display_name: 'Abhay Singh' }]
  const m = matchPeople('Name: NEERAJ AGARWAI Address: Pune', people)
  assert.equal(m.person.id, 'p1')
  assert.ok(m.ratio >= 0.5)
  assert.equal(matchPeople('Nothing here', people), null)
})

test('extractSuggestions produces the expected keys and a suggested name', () => {
  const text = `LIFE INSURANCE CORPORATION OF INDIA
Policy No: 987654321
Policyholder: Neeraj Agarwal
Sum Assured Rs 5,00,000
Date of Commencement 12/06/2020
Premium ₹ 12,500
Policy valid till 12/06/2040
Email: neeraj@example.com Phone +91 98765 43210`
  const people = [{ id: 'p1', display_name: 'Neeraj Agarwal' }]
  const s = extractSuggestions(text, { people, groups: [{ id: 'g1', name: 'Family' }], now: new Date('2026-10-01') })
  assert.equal(byKey(s, 'document_type').value, 'insurance')
  assert.equal(byKey(s, 'policy_number').value, '987654321')
  assert.equal(byKey(s, 'expiry_date').value, '2040-06-12')
  assert.equal(byKey(s, 'issue_date').value, '2020-06-12')
  assert.equal(byKey(s, 'person_id').value, 'p1')
  assert.equal(byKey(s, 'email').value, 'neeraj@example.com')
  assert.equal(byKey(s, 'currency').value, 'INR')
  assert.ok(byKey(s, 'organisation').value.toLowerCase().includes('life insurance'))
  assert.ok(byKey(s, 'keywords').value.length > 0)
  assert.ok(byKey(s, 'summary').value.length <= 160)
  const name = byKey(s, 'suggested_name').value
  assert.ok(name.startsWith('Neeraj Agarwal - Insurance'), name)
  assert.ok(name.endsWith('2020'), name)
  for (const item of s) {
    assert.equal(item.source, 'rules')
    assert.ok(item.confidence >= 0 && item.confidence <= 1)
  }
})

test('extractSuggestions never throws on bad input', () => {
  assert.deepEqual(extractSuggestions(null), [])
  assert.deepEqual(extractSuggestions(undefined, null), [])
  assert.ok(Array.isArray(extractSuggestions(12345, { people: 'nope' })))
})

test('suggestDocumentName trims missing parts and caps at 80 chars', () => {
  assert.equal(suggestDocumentName({ suggestions: [{ key: 'document_type', value: 'passport' }, { key: 'issue_date', value: '2019-01-12' }] }), 'Passport - 2019')
  assert.equal(suggestDocumentName({ suggestions: [], fallbackName: 'Scan - 1 Oct 2026' }), 'Scan - 1 Oct 2026')
  const long = suggestDocumentName({
    suggestions: [
      { key: 'person_name', value: 'A very long person name that goes on and on and on forever' },
      { key: 'document_type', value: 'bank_statement' },
      { key: 'organisation', value: 'State Bank of India Main Branch' },
      { key: 'issue_date', value: '2024-05-01' },
    ],
  })
  assert.ok(long.length <= 80, long)
  const byId = suggestDocumentName({ suggestions: [{ key: 'person_id', value: 'p9' }, { key: 'document_type', value: 'invoice' }, { key: 'invoice_number', value: 'INV-7' }], people: [{ id: 'p9', display_name: 'Riya' }] })
  assert.equal(byId, 'Riya - Invoice - INV-7')
})

test('chunkText makes 200-800 char chunks with page numbers and overlap', () => {
  const para = (n) => `Paragraph ${n} sentence one about a topic. Sentence two adds detail number ${n}. Sentence three closes the paragraph with a final thought.`
  const page1 = ['TERMS OF SERVICE', para(1), para(2), para(3), para(4), para(5), para(6), para(7), para(8)].join('\n\n')
  const page2 = ['Payment Details', para(9), para(10), para(11)].join('\n\n')
  const chunks = chunkText(null, [{ page_number: 1, text: page1 }, { page_number: 2, text: page2 }])
  assert.ok(chunks.length >= 3)
  chunks.forEach((c, i) => {
    assert.equal(c.chunk_number, i + 1)
    assert.ok(c.content.length <= 1000, `chunk ${i} too long: ${c.content.length}`)
    assert.ok(c.content.length >= 100, `chunk ${i} too short: ${c.content.length}`)
  })
  assert.equal(chunks[0].page_number, 1)
  assert.equal(chunks[chunks.length - 1].page_number, 2)
  assert.equal(chunks[0].section, 'TERMS OF SERVICE')
  assert.equal(chunks[chunks.length - 1].section, 'Payment Details')
  // overlap: the second chunk starts with the last sentence of the first
  const lastSentence = chunks[0].content.trim().split(/(?<=\.)\s+/).pop()
  assert.ok(chunks[1].content.startsWith(lastSentence), `no overlap: ${chunks[1].content.slice(0, 60)}`)
})

test('chunkText handles plain text, long lines and empty input', () => {
  assert.deepEqual(chunkText(''), [])
  assert.deepEqual(chunkText(null, []), [])
  const long = 'word '.repeat(600)
  const chunks = chunkText(long)
  assert.ok(chunks.length >= 3)
  chunks.forEach((c) => assert.ok(c.content.length <= 1000))
  const small = chunkText('Just a short note.')
  assert.equal(small.length, 1)
  assert.equal(small[0].page_number, 1)
})

test('hammingDistance and dHash', () => {
  assert.equal(hammingDistance('0000000000000000', '0000000000000000'), 0)
  assert.equal(hammingDistance('ffffffffffffffff', '0000000000000000'), 64)
  assert.equal(hammingDistance('000000000000000f', '0000000000000000'), 4)
  assert.equal(hammingDistance('zz', '00'), 64)
  const gray = Array.from({ length: 72 }, (_, i) => (i % 9))
  const h = dHashFromGray(gray)
  assert.equal(h, 'ffffffffffffffff')
  assert.equal(h.length, 16)
})
