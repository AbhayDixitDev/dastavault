// Relationship types between people. "from" is the person being edited.
// Sentence: "{from} is the {label} of {to}".
export const RELATIONS = [
  { key: 'father', label: 'Father', words: ['dad', 'father', 'papa', 'daddy'] },
  { key: 'mother', label: 'Mother', words: ['mom', 'mum', 'mother', 'mummy', 'mama'] },
  { key: 'parent', label: 'Parent', words: ['parent'] },
  { key: 'child', label: 'Child', words: ['child', 'kid'] },
  { key: 'son', label: 'Son', words: ['son'] },
  { key: 'daughter', label: 'Daughter', words: ['daughter'] },
  { key: 'spouse', label: 'Spouse', words: ['wife', 'husband', 'spouse', 'partner'] },
  { key: 'brother', label: 'Brother', words: ['brother', 'bro'] },
  { key: 'sister', label: 'Sister', words: ['sister', 'sis'] },
  { key: 'grandparent', label: 'Grandparent', words: ['grandpa', 'grandma', 'grandfather', 'grandmother', 'nana', 'dada', 'dadi', 'nani'] },
  { key: 'grandchild', label: 'Grandchild', words: ['grandson', 'granddaughter', 'grandchild'] },
  { key: 'guardian', label: 'Guardian', words: ['guardian'] },
  { key: 'manager', label: 'Manager', words: ['manager', 'boss'] },
  { key: 'reports_to', label: 'Reports to', words: [] },
  { key: 'custom', label: 'Custom', words: [] },
]

export function relationLabel(key, customLabel) {
  if (key === 'custom' && customLabel) return customLabel
  return RELATIONS.find((r) => r.key === key)?.label ?? key
}

export const RELATION_LABELS_FOR_PERSON = [
  'Father',
  'Mother',
  'Son',
  'Daughter',
  'Spouse',
  'Brother',
  'Sister',
  'Grandfather',
  'Grandmother',
  'Guardian',
  'Me',
  'Employee',
  'Student',
  'Staff',
  'Other',
]
