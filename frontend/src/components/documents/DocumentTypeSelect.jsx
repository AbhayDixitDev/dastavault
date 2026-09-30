import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DOCUMENT_TYPES } from './documentTypes'
import { cn } from '@/lib/utils'

/**
 * Select for the document type. `value` is the type key ('' or null for none).
 * Pass `allowAny` to include an "Any type" option (for filters).
 */
export function DocumentTypeSelect({ value, onChange, allowAny = false, placeholder = 'Choose a type', className, size, disabled }) {
  const ANY = '__any__'
  return (
    <Select value={value || (allowAny ? ANY : undefined)} onValueChange={(v) => onChange?.(v === ANY ? '' : v)} disabled={disabled}>
      <SelectTrigger className={cn('w-full', className)} size={size}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowAny && <SelectItem value={ANY}>Any type</SelectItem>}
        {DOCUMENT_TYPES.map((t) => {
          const Icon = t.icon
          return (
            <SelectItem key={t.key} value={t.key}>
              <Icon className="size-4" /> {t.label}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}
