import { Home, Building2, GraduationCap, HeartHandshake, User, Sparkles, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'

const ICONS = {
  family: Home,
  company: Building2,
  school: GraduationCap,
  organization: HeartHandshake,
  personal: User,
  custom: Sparkles,
}

const COLORS = {
  family: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300',
  company: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300',
  school: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300',
  organization: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300',
  personal: 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300',
  custom: 'bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-900/40 dark:text-fuchsia-300',
}

/** Coloured rounded icon tile for a workspace kind. */
export function KindIcon({ kind, size = 'md', className }) {
  const Icon = ICONS[kind] ?? Folder
  const box = size === 'lg' ? 'size-14 rounded-2xl' : size === 'sm' ? 'size-8 rounded-lg' : 'size-10 rounded-xl'
  const icon = size === 'lg' ? 'size-7' : size === 'sm' ? 'size-4' : 'size-5'
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center', box, COLORS[kind] ?? COLORS.custom, className)}>
      <Icon className={icon} />
    </span>
  )
}
