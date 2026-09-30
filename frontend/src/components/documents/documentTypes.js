import {
  BookUser, Fingerprint, CreditCard, Car, Vote, Baby, GraduationCap, Award, IdCard, ShieldCheck,
  Stethoscope, Pill, Receipt, ReceiptText, Landmark, Percent, Wallet, FileSignature, Handshake,
  Mail, BadgeCheck, Home, CarFront, Zap, Ticket, Image, StickyNote, PenLine, File,
} from 'lucide-react'

/**
 * Document types from the API contract, with plain-English labels, an icon and
 * a colour class pair (light and dark). Order matters: common ones first.
 */
export const DOCUMENT_TYPES = [
  { key: 'passport', label: 'Passport', icon: BookUser, color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300', group: 'Identity' },
  { key: 'aadhaar', label: 'Aadhaar card', icon: Fingerprint, color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', group: 'Identity' },
  { key: 'pan', label: 'PAN card', icon: CreditCard, color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300', group: 'Identity' },
  { key: 'driving_licence', label: 'Driving licence', icon: Car, color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', group: 'Identity' },
  { key: 'voter_id', label: 'Voter ID', icon: Vote, color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300', group: 'Identity' },
  { key: 'id_card', label: 'ID card', icon: IdCard, color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300', group: 'Identity' },
  { key: 'birth_certificate', label: 'Birth certificate', icon: Baby, color: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300', group: 'Identity' },
  { key: 'marksheet', label: 'Marksheet', icon: GraduationCap, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', group: 'Education' },
  { key: 'degree', label: 'Degree', icon: Award, color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300', group: 'Education' },
  { key: 'certificate', label: 'Certificate', icon: BadgeCheck, color: 'bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300', group: 'Education' },
  { key: 'insurance', label: 'Insurance', icon: ShieldCheck, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', group: 'Money' },
  { key: 'medical_report', label: 'Medical report', icon: Stethoscope, color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300', group: 'Health' },
  { key: 'prescription', label: 'Prescription', icon: Pill, color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', group: 'Health' },
  { key: 'invoice', label: 'Invoice', icon: ReceiptText, color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', group: 'Money' },
  { key: 'receipt', label: 'Receipt', icon: Receipt, color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300', group: 'Money' },
  { key: 'bank_statement', label: 'Bank statement', icon: Landmark, color: 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300', group: 'Money' },
  { key: 'tax', label: 'Tax', icon: Percent, color: 'bg-stone-100 text-stone-700 dark:bg-stone-800/60 dark:text-stone-300', group: 'Money' },
  { key: 'salary_slip', label: 'Salary slip', icon: Wallet, color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300', group: 'Money' },
  { key: 'contract', label: 'Contract', icon: FileSignature, color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300', group: 'Legal' },
  { key: 'agreement', label: 'Agreement', icon: Handshake, color: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300', group: 'Legal' },
  { key: 'letter', label: 'Letter', icon: Mail, color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300', group: 'Other' },
  { key: 'property', label: 'Property', icon: Home, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', group: 'Home' },
  { key: 'vehicle', label: 'Vehicle', icon: CarFront, color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', group: 'Home' },
  { key: 'utility_bill', label: 'Utility bill', icon: Zap, color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300', group: 'Home' },
  { key: 'ticket', label: 'Ticket', icon: Ticket, color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', group: 'Other' },
  { key: 'photo', label: 'Photo', icon: Image, color: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300', group: 'Other' },
  { key: 'note', label: 'Note', icon: StickyNote, color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300', group: 'Other' },
  { key: 'written', label: 'Written document', icon: PenLine, color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300', group: 'Other' },
  { key: 'other', label: 'Other', icon: File, color: 'bg-muted text-muted-foreground', group: 'Other' },
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
