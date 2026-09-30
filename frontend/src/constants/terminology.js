// Terminology templates. Every label shown in the UI comes from the active
// workspace's terminology, never from a hard-coded word.

export const WORKSPACE_KINDS = [
  {
    key: 'family',
    title: 'Family',
    description: 'Passports, insurance, school papers and house documents for everyone at home.',
    exampleGroups: ['Parents', 'Kids'],
  },
  {
    key: 'company',
    title: 'Company',
    description: 'Employees, departments and teams. Contracts, invoices and HR letters.',
    exampleGroups: ['Engineering', 'Marketing', 'Finance'],
  },
  {
    key: 'school',
    title: 'School',
    description: 'Students, staff, classes and sections. Certificates and records.',
    exampleGroups: ['Class 8', 'Class 9'],
  },
  {
    key: 'organization',
    title: 'Organisation',
    description: 'Members, units and teams for clubs, NGOs and societies.',
    exampleGroups: ['Volunteers', 'Board'],
  },
  {
    key: 'personal',
    title: 'Personal Documents',
    description: 'Just your own papers, neatly organised in folders.',
    exampleGroups: ['Home', 'Car', 'Tax'],
  },
  {
    key: 'custom',
    title: 'Something Else',
    description: 'Choose your own words for members and groups.',
    exampleGroups: [],
  },
]

export const TERMINOLOGY_TEMPLATES = {
  family: {
    workspace_label: 'Family',
    member_label: 'Family Member',
    member_label_plural: 'Family Members',
    group_label: 'Family Group',
    group_label_plural: 'Family Groups',
    subgroup_label: 'Sub Group',
    subgroup_label_plural: 'Sub Groups',
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
    member_label: 'Staff Member',
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
    subgroup_label: 'Sub Folder',
    subgroup_label_plural: 'Sub Folders',
    person_label: 'Person',
    person_label_plural: 'People',
  },
  custom: {
    workspace_label: 'Workspace',
    member_label: 'Member',
    member_label_plural: 'Members',
    group_label: 'Group',
    group_label_plural: 'Groups',
    subgroup_label: 'Sub Group',
    subgroup_label_plural: 'Sub Groups',
    person_label: 'Person',
    person_label_plural: 'People',
  },
}

export const TERMINOLOGY_FIELDS = [
  ['workspace_label', 'What do you call this workspace?'],
  ['member_label', 'One member with a login'],
  ['member_label_plural', 'Many members with a login'],
  ['person_label', 'One person who owns documents'],
  ['person_label_plural', 'Many people who own documents'],
  ['group_label', 'One group'],
  ['group_label_plural', 'Many groups'],
  ['subgroup_label', 'One sub group'],
  ['subgroup_label_plural', 'Many sub groups'],
]

export function terminologyFor(kind) {
  return { ...TERMINOLOGY_TEMPLATES[kind] ?? TERMINOLOGY_TEMPLATES.custom }
}
