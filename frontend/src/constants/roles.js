export const ROLES = [
  { key: 'owner', name: 'Owner', rank: 100, description: 'Can do everything, including deleting the workspace.' },
  { key: 'admin', name: 'Admin', rank: 80, description: 'Manages members, groups, people and settings.' },
  { key: 'editor', name: 'Editor', rank: 60, description: 'Adds and edits documents, notes and albums.' },
  { key: 'viewer', name: 'Viewer', rank: 40, description: 'Can view and search documents.' },
  { key: 'restricted', name: 'Restricted', rank: 20, description: 'Only sees documents shared with them.' },
]

export const ROLE_RANK = Object.fromEntries(ROLES.map((r) => [r.key, r.rank]))

export function roleName(key) {
  return ROLES.find((r) => r.key === key)?.name ?? key
}

export function hasRole(roleKey, minRoleKey) {
  return (ROLE_RANK[roleKey] ?? 0) >= (ROLE_RANK[minRoleKey] ?? 0)
}

export const ASSIGNABLE_ROLES = ROLES.filter((r) => r.key !== 'owner')
