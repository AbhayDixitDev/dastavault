/**
 * Terminology templates (PRD section 4). Values mirror the DB trigger
 * `handle_new_workspace()` in 002_profiles_workspaces.sql, which seeds the
 * row on workspace insert; the Worker only writes overrides on top.
 * All labels are NOT NULL in the table.
 */
export const TERMINOLOGY_TEMPLATES = Object.freeze({
  family: {
    workspace_label: 'Family',
    member_label: 'Family Member',
    member_label_plural: 'Family Members',
    group_label: 'Family Group',
    group_label_plural: 'Family Groups',
    subgroup_label: 'Subgroup',
    subgroup_label_plural: 'Subgroups',
    person_label: 'Person',
    person_label_plural: 'People',
  },
  company: {
    workspace_label: 'Company',
    member_label: 'Employee',
    member_label_plural: 'Employees',
    group_label: 'Department',
    group_label_plural: 'Departments',
    subgroup_label: 'Team',
    subgroup_label_plural: 'Teams',
    person_label: 'Person',
    person_label_plural: 'People',
  },
  school: {
    workspace_label: 'School',
    member_label: 'Student',
    member_label_plural: 'Students',
    group_label: 'Class',
    group_label_plural: 'Classes',
    subgroup_label: 'Section',
    subgroup_label_plural: 'Sections',
    person_label: 'Person',
    person_label_plural: 'People',
  },
  organization: {
    workspace_label: 'Organisation',
    member_label: 'Member',
    member_label_plural: 'Members',
    group_label: 'Unit',
    group_label_plural: 'Units',
    subgroup_label: 'Team',
    subgroup_label_plural: 'Teams',
    person_label: 'Person',
    person_label_plural: 'People',
  },
  personal: {
    workspace_label: 'My Documents',
    member_label: 'Person',
    member_label_plural: 'People',
    group_label: 'Folder',
    group_label_plural: 'Folders',
    subgroup_label: 'Subfolder',
    subgroup_label_plural: 'Subfolders',
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
    if (k in base && v !== undefined && v !== null && v !== '') out[k] = v
  }
  return out
}
