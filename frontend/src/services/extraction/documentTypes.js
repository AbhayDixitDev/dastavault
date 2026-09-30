/**
 * Document types from the API contract (section 3) with display labels and
 * keyword scoring tables used by the rule-based extractor.
 * Pure data: safe to import in Node tests and in the browser.
 */

export const DOCUMENT_TYPE_LABELS = {
  passport: 'Passport',
  aadhaar: 'Aadhaar',
  pan: 'PAN card',
  driving_licence: 'Driving licence',
  voter_id: 'Voter ID',
  birth_certificate: 'Birth certificate',
  marksheet: 'Marksheet',
  degree: 'Degree',
  id_card: 'ID card',
  insurance: 'Insurance',
  medical_report: 'Medical report',
  prescription: 'Prescription',
  invoice: 'Invoice',
  receipt: 'Receipt',
  bank_statement: 'Bank statement',
  tax: 'Tax',
  salary_slip: 'Salary slip',
  contract: 'Contract',
  agreement: 'Agreement',
  letter: 'Letter',
  certificate: 'Certificate',
  property: 'Property',
  vehicle: 'Vehicle',
  utility_bill: 'Utility bill',
  ticket: 'Ticket',
  photo: 'Photo',
  note: 'Note',
  written: 'Written',
  other: 'Other',
}

export const DOCUMENT_TYPE_KEYS = Object.keys(DOCUMENT_TYPE_LABELS)

/** Keyword -> weight tables. Phrases are matched case-insensitively as whole words. */
export const TYPE_KEYWORDS = {
  passport: [['passport', 5], ['republic of india', 3], ['nationality', 2], ['place of birth', 2], ['place of issue', 2], ['type p', 2], ['surname', 1], ['given name', 1], ['given names', 1], ['country code', 2], ['ind<<', 4]],
  aadhaar: [['aadhaar', 6], ['aadhar', 6], ['adhaar', 5], ['uidai', 5], ['unique identification', 4], ['mera aadhaar', 3], ['meri pehchaan', 3], ['government of india', 1], ['vid', 1]],
  pan: [['permanent account number', 6], ['income tax department', 4], ['pan card', 6], ['pan', 2], ["father's name", 1], ['signature', 1]],
  driving_licence: [['driving licence', 6], ['driving license', 6], ['driver license', 5], ['dl no', 4], ['transport department', 3], ['motor vehicles', 2], ['lmv', 2], ['mcwg', 3], ['issuing authority', 1], ['blood group', 1], ['validity', 1]],
  voter_id: [['election commission', 6], ['voter', 5], ['elector', 5], ['epic', 3], ["elector's name", 4], ['identity card', 1]],
  birth_certificate: [['birth certificate', 6], ['certificate of birth', 6], ['date of birth', 1], ['registration of births', 5], ['municipal corporation', 2], ['registrar', 2]],
  marksheet: [['marksheet', 6], ['mark sheet', 6], ['statement of marks', 6], ['grade sheet', 5], ['marks obtained', 4], ['cgpa', 4], ['sgpa', 4], ['board of secondary', 3], ['cbse', 3], ['icse', 3], ['examination', 2], ['roll no', 2], ['subject', 1], ['grade', 1], ['semester', 2], ['percentage', 1]],
  degree: [['degree', 5], ['bachelor', 4], ['master of', 4], ['conferred', 4], ['university', 2], ['convocation', 4], ['vice chancellor', 3], ['doctor of philosophy', 4]],
  id_card: [['identity card', 4], ['id card', 5], ['employee id', 4], ['emp id', 3], ['student id', 4], ['membership', 2], ['valid through', 1]],
  insurance: [['insurance', 6], ['policy', 4], ['policy no', 4], ['policy number', 4], ['sum insured', 5], ['sum assured', 5], ['premium', 4], ['insured', 3], ['policyholder', 4], ['nominee', 2], ['lic', 2], ['mediclaim', 4], ['coverage', 2], ['third party', 2]],
  medical_report: [['medical report', 6], ['lab report', 5], ['laboratory', 3], ['pathology', 4], ['test report', 4], ['haemoglobin', 3], ['hemoglobin', 3], ['diagnosis', 3], ['blood test', 4], ['specimen', 3], ['reference range', 4], ['radiology', 4], ['x-ray', 3], ['ultrasound', 3], ['mri', 3], ['ct scan', 3], ['patient', 2], ['hospital', 1], ['discharge summary', 5]],
  prescription: [['prescription', 6], ['rx', 4], ['tablet', 3], ['tab.', 2], ['capsule', 3], ['mg', 1], ['twice daily', 3], ['once daily', 3], ['after food', 3], ['before food', 3], ['dr.', 1], ['clinic', 2], ['dosage', 3]],
  invoice: [['invoice', 6], ['tax invoice', 6], ['invoice no', 4], ['invoice number', 4], ['gstin', 3], ['gst', 2], ['hsn', 3], ['bill to', 3], ['ship to', 2], ['subtotal', 2], ['grand total', 2], ['amount due', 2], ['due date', 2], ['purchase order', 2], ['cgst', 2], ['sgst', 2], ['igst', 2]],
  receipt: [['receipt', 6], ['payment receipt', 6], ['received with thanks', 5], ['paid', 2], ['cash', 1], ['thank you for shopping', 4], ['transaction id', 2], ['change', 1], ['receipt no', 4], ['amount received', 4]],
  bank_statement: [['bank statement', 6], ['statement of account', 6], ['account statement', 6], ['opening balance', 5], ['closing balance', 5], ['withdrawal', 3], ['deposit', 2], ['ifsc', 3], ['account no', 2], ['transaction', 1], ['neft', 2], ['upi', 2], ['imps', 2], ['balance', 1], ['savings account', 3]],
  tax: [['income tax', 5], ['form 16', 6], ['itr', 5], ['tax return', 6], ['assessment year', 5], ['tds', 4], ['challan', 3], ['taxable income', 4], ['gst return', 5], ['gstr', 4], ['tax deducted', 4], ['acknowledgement number', 2]],
  salary_slip: [['salary slip', 6], ['pay slip', 6], ['payslip', 6], ['salary', 3], ['basic pay', 4], ['hra', 3], ['net pay', 4], ['gross pay', 4], ['earnings', 3], ['deductions', 3], ['provident fund', 3], ['pf', 1], ['esi', 1], ['employee code', 2], ['pay period', 3]],
  contract: [['contract', 6], ['contractor', 2], ['terms and conditions', 2], ['whereas', 2], ['party of the first part', 4], ['hereinafter', 3], ['in witness whereof', 4], ['obligations', 2], ['termination', 2]],
  agreement: [['agreement', 6], ['rent agreement', 6], ['rental agreement', 6], ['lease', 4], ['lessor', 4], ['lessee', 4], ['tenant', 3], ['landlord', 3], ['deed', 3], ['memorandum of understanding', 4], ['mou', 2], ['hereby agree', 3], ['witnesses', 1], ['stamp paper', 3]],
  letter: [['dear', 3], ['yours sincerely', 4], ['yours faithfully', 4], ['regards', 2], ['subject:', 2], ['to whom it may concern', 4], ['offer letter', 5], ['appointment letter', 5], ['relieving letter', 5], ['experience letter', 5], ['letter', 2]],
  certificate: [['certificate', 5], ['certified', 3], ['this is to certify', 6], ['has successfully completed', 5], ['awarded', 3], ['participation', 2], ['achievement', 2], ['course completion', 4], ['certificate no', 3]],
  property: [['property', 4], ['sale deed', 6], ['registry', 3], ['plot', 3], ['survey no', 4], ['khata', 4], ['mutation', 3], ['encumbrance', 4], ['property tax', 5], ['flat no', 3], ['sq. ft', 3], ['sq ft', 3], ['builder', 2], ['possession', 3], ['allotment', 3]],
  vehicle: [['registration certificate', 6], ['vehicle', 4], ['chassis', 5], ['engine no', 5], ['engine number', 5], ['regn no', 4], ['owner name', 2], ['puc', 4], ['pollution under control', 5], ['fitness', 2], ['manufacturer', 2], ['model', 1], ['road tax', 4], ['rto', 4]],
  utility_bill: [['electricity bill', 6], ['electricity', 4], ['power bill', 5], ['units consumed', 5], ['meter no', 4], ['meter reading', 5], ['consumer no', 4], ['consumer number', 4], ['water bill', 6], ['gas bill', 6], ['piped gas', 4], ['broadband', 4], ['postpaid', 3], ['bill period', 4], ['billing period', 3], ['bill date', 2], ['tariff', 3], ['kwh', 4], ['mobile bill', 4], ['telephone bill', 5]],
  ticket: [['ticket', 5], ['boarding pass', 6], ['pnr', 6], ['e-ticket', 6], ['seat', 3], ['coach', 3], ['departure', 3], ['arrival', 3], ['flight', 4], ['train no', 4], ['booking id', 3], ['passenger', 3], ['gate', 1], ['admit one', 4]],
  photo: [],
  note: [],
  written: [],
  other: [],
}

/** Words that give the type when they appear in a document name or a query. */
export const TYPE_SYNONYMS = {
  licence: 'driving_licence',
  license: 'driving_licence',
  dl: 'driving_licence',
  aadhar: 'aadhaar',
  adhaar: 'aadhaar',
  bill: 'utility_bill',
  policy: 'insurance',
  marks: 'marksheet',
  report: 'medical_report',
  statement: 'bank_statement',
  payslip: 'salary_slip',
  rc: 'vehicle',
}

/** Types that usually carry an expiry date. */
export const EXPIRING_TYPES = new Set(['passport', 'insurance', 'driving_licence', 'id_card', 'vehicle', 'voter_id', 'contract', 'agreement', 'ticket'])

/** Types where the first date on the page is almost always the issue date. */
export const DATED_TYPES = new Set(['invoice', 'receipt', 'utility_bill', 'salary_slip', 'bank_statement', 'medical_report', 'prescription', 'letter', 'certificate', 'marksheet', 'tax'])

export function typeLabel(key) {
  return DOCUMENT_TYPE_LABELS[key] || (key ? String(key).replace(/_/g, ' ') : '')
}
