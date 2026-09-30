import { cn } from '@/lib/utils'
import { documentTypeInfo } from './documentTypes'

/** Coloured rounded tile with the icon for a document type. */
export function DocumentTypeIcon({ type, size = 'md', className }) {
  const info = documentTypeInfo(type)
  const Icon = info.icon
  const box = size === 'xl' ? 'size-20 rounded-3xl' : size === 'lg' ? 'size-14 rounded-2xl' : size === 'sm' ? 'size-8 rounded-lg' : 'size-10 rounded-xl'
  const icon = size === 'xl' ? 'size-10' : size === 'lg' ? 'size-7' : size === 'sm' ? 'size-4' : 'size-5'
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center', box, info.color, className)} aria-label={info.label}>
      <Icon className={icon} />
    </span>
  )
}
