/**
 * Terminology templates (PRD section 4). Every UI label comes from the
 * workspace's stored terminology, never from hard-coded words.
 */
export const TERMINOLOGY_TEMPLATES = Object.freeze({
  family: {
    workspace_label: 'Family',
    member_label: 'Family Member',
    member_label_plural: 'Family Members',
    group_label: 'Family Group',
    group_label_plural: 'Family Groups',
    subgroup_label: null,
    subgroup_label_plural: null,
    person_label: 'Family Member',
    person_label_plural: 'Family Members',
  },
  company: {
    workspace_label: 'Company',
    member_label: 'Employee',
    member_label_plural: 'Employees',
    group_label: 'Department',
    group_label_plural: 'Departments',
    subgroup_label: 'Team',
    subgroup_label_plural: 'Teams',
    person_label: 'Employee',
    person_label_plural: 'Employees',
  },
  school: {
    workspace_label: 'School',
    member_label: 'Staff',
    member_label_plural: 'Staff',
    group_label: 'Class',
    group_label_plural: 'Classes',
    subgroup_label: 'Section',
    subgroup_label_plural: 'Sections',
    person_label: 'Student',
    person_label_plural: 'Students',
  },
  organization: {
    workspace_label: 'Organisation',
    member_label: 'Member',
    member_label_plural: 'Members',
    group_label: 'Unit',
    group_label_plural: 'Units',
    subgroup_label: 'Team',
    subgroup_label_plural: 'Teams',
    person_label: 'Member',
    person_label_plural: 'Members',
  },
  personal: {
    workspace_label: 'My Documents',
    member_label: 'Person',
    member_label_plural: 'People',
    group_label: 'Folder',
    group_label_plural: 'Folders',
    subgroup_label: null,
    subgroup_label_plural: null,
    person_label: 'Person',
    person_label_plural: 'People',
  },
  custom: {
    workspace_label: 'Workspace',
    member_label: 'Member',
    member_label_plural: 'Members',
    group_label: 'Group',
    group_label_plural: 'Groups',
    subgroup_label: 'Subgroup',
    subgroup_label_plural: 'Subgroups',
    person_label: 'Person',
    person_label_plural: 'People',
  },
})

/** Template for `kind`, with optional per-field overrides (used by the custom template). */
export function buildTerminology(kind, overrides = {}) {
  const base = TERMINOLOGY_TEMPLATES[kind] || TERMINOLOGY_TEMPLATES.custom
  const out = { ...base }
  for (const [k, v] of Object.entries(overrides || {})) {
    if (k in base && v !== undefined) out[k] = v
  }
  return out
}
