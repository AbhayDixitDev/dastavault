import {
  BookUser, Fingerprint, CreditCard, Car, Vote, Baby, GraduationCap, Award, IdCard, ShieldCheck,
  Stethoscope, Pill, Receipt, ReceiptText, Landmark, Percent, Wallet, FileSignature, Handshake,
  Mail, BadgeCheck, Home, CarFront, Zap, Ticket, Image, StickyNote, PenLine, File,
} from 'lucide-react'

/**
 * Document types from the API contract, with plain-English labels, an icon and
 * the (neutral) colour classes of its icon. Order matters: common ones first.
 */
// One calm style for every type: the icon tells types apart, not a colour.
const NEUTRAL = 'bg-muted text-foreground/70'

export const DOCUMENT_TYPES = [
  { key: 'passport', label: 'Passport', icon: BookUser, color: NEUTRAL, group: 'Identity' },
  { key: 'aadhaar', label: 'Aadhaar card', icon: Fingerprint, color: NEUTRAL, group: 'Identity' },
  { key: 'pan', label: 'PAN card', icon: CreditCard, color: NEUTRAL, group: 'Identity' },
  { key: 'driving_licence', label: 'Driving licence', icon: Car, color: NEUTRAL, group: 'Identity' },
  { key: 'voter_id', label: 'Voter ID', icon: Vote, color: NEUTRAL, group: 'Identity' },
  { key: 'id_card', label: 'ID card', icon: IdCard, color: NEUTRAL, group: 'Identity' },
  { key: 'birth_certificate', label: 'Birth certificate', icon: Baby, color: NEUTRAL, group: 'Identity' },
  { key: 'marksheet', label: 'Marksheet', icon: GraduationCap, color: NEUTRAL, group: 'Education' },
  { key: 'degree', label: 'Degree', icon: Award, color: NEUTRAL, group: 'Education' },
  { key: 'certificate', label: 'Certificate', icon: BadgeCheck, color: NEUTRAL, group: 'Education' },
  { key: 'insurance', label: 'Insurance', icon: ShieldCheck, color: NEUTRAL, group: 'Money' },
  { key: 'medical_report', label: 'Medical report', icon: Stethoscope, color: NEUTRAL, group: 'Health' },
  { key: 'prescription', label: 'Prescription', icon: Pill, color: NEUTRAL, group: 'Health' },
  { key: 'invoice', label: 'Invoice', icon: ReceiptText, color: NEUTRAL, group: 'Money' },
  { key: 'receipt', label: 'Receipt', icon: Receipt, color: NEUTRAL, group: 'Money' },
  { key: 'bank_statement', label: 'Bank statement', icon: Landmark, color: NEUTRAL, group: 'Money' },
  { key: 'tax', label: 'Tax', icon: Percent, color: NEUTRAL, group: 'Money' },
  { key: 'salary_slip', label: 'Salary slip', icon: Wallet, color: NEUTRAL, group: 'Money' },
  { key: 'contract', label: 'Contract', icon: FileSignature, color: NEUTRAL, group: 'Legal' },
  { key: 'agreement', label: 'Agreement', icon: Handshake, color: NEUTRAL, group: 'Legal' },
  { key: 'letter', label: 'Letter', icon: Mail, color: NEUTRAL, group: 'Other' },
  { key: 'property', label: 'Property', icon: Home, color: NEUTRAL, group: 'Home' },
  { key: 'vehicle', label: 'Vehicle', icon: CarFront, color: NEUTRAL, group: 'Home' },
  { key: 'utility_bill', label: 'Utility bill', icon: Zap, color: NEUTRAL, group: 'Home' },
  { key: 'ticket', label: 'Ticket', icon: Ticket, color: NEUTRAL, group: 'Other' },
  { key: 'photo', label: 'Photo', icon: Image, color: NEUTRAL, group: 'Other' },
  { key: 'note', label: 'Note', icon: StickyNote, color: NEUTRAL, group: 'Other' },
  { key: 'written', label: 'Written document', icon: PenLine, color: NEUTRAL, group: 'Other' },
  { key: 'other', label: 'Other', icon: File, color: NEUTRAL, group: 'Other' },
]

export const DOCUMENT_TYPE_MAP = Object.fromEntries(DOCUMENT_TYPES.map((t) => [t.key, t]))

export function documentTypeLabel(key) {
  return DOCUMENT_TYPE_MAP[key]?.label ?? (key ? key.replace(/_/g, ' ') : 'Document')
}

export function documentTypeInfo(key) {
  return DOCUMENT_TYPE_MAP[key] ?? DOCUMENT_TYPE_MAP.other
}

export const VISIBILITY_OPTIONS = [
  { key: 'workspace', label: 'Everyone in this workspace' },
  { key: 'groups', label: 'Only linked groups' },
  { key: 'people', label: 'Only linked people' },
  { key: 'private', label: 'Only me' },
]

export const SORT_OPTIONS = [
  { key: 'created_at:desc', label: 'Newest first' },
  { key: 'created_at:asc', label: 'Oldest first' },
  { key: 'name:asc', label: 'Name A to Z' },
  { key: 'name:desc', label: 'Name Z to A' },
  { key: 'updated_at:desc', label: 'Recently changed' },
  { key: 'expiry_date:asc', label: 'Expiring soon' },
]
