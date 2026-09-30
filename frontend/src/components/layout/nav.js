import {
  Home,
  Search,
  ScanLine,
  FileText,
  MoreHorizontal,
  Users,
  FolderTree,
  Images,
  StickyNote,
  KeyRound,
  BellRing,
  Activity,
  Settings,
} from 'lucide-react'

/** Bottom bar items on mobile. Labels come from terminology where relevant. */
export function primaryNav(t) {
  return [
    { to: '', label: 'Home', icon: Home, end: true },
    { to: 'search', label: 'Search', icon: Search },
    { to: 'scan', label: 'Scan', icon: ScanLine, primary: true },
    { to: 'documents', label: 'Documents', icon: FileText },
    { to: 'more', label: 'More', icon: MoreHorizontal, more: true },
  ].map((i) => ({ ...i, t }))
}

/** Everything shown in the sidebar (desktop) and the More sheet (mobile). */
export function secondaryNav(t) {
  return [
    { to: 'people', label: t.person_label_plural, icon: Users },
    { to: 'groups', label: t.group_label_plural, icon: FolderTree },
    { to: 'albums', label: 'Albums', icon: Images },
    { to: 'notes', label: 'Notes', icon: StickyNote },
    { to: 'chaabi', label: 'Chaabi', icon: KeyRound, hint: 'Passwords' },
    { to: 'reminders', label: 'Reminders', icon: BellRing },
    { to: 'activity', label: 'Activity', icon: Activity },
    { to: 'settings', label: 'Settings', icon: Settings },
  ]
}
