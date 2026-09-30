import dayjs from 'dayjs'
import { CalendarClock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** Days until an expiry date (negative when already past). Null when there is no date. */
export function daysUntil(date) {
  if (!date) return null
  const d = dayjs(date)
  if (!d.isValid()) return null
  return d.startOf('day').diff(dayjs().startOf('day'), 'day')
}

/** Small chip shown when a document expires within `within` days (or already has). */
export function ExpiryChip({ date, within = 60, className, always = false }) {
  const days = daysUntil(date)
  if (days === null) return null
  if (!always && days > within) return null

  let text
  let variant = 'warning'
  if (days < 0) {
    text = days === -1 ? 'Expired yesterday' : `Expired ${Math.abs(days)} days ago`
    variant = 'destructive'
  } else if (days === 0) {
    text = 'Expires today'
    variant = 'destructive'
  } else if (days === 1) {
    text = 'Expires tomorrow'
  } else if (days <= within) {
    text = `Expires in ${days} days`
  } else {
    text = `Expires ${dayjs(date).format('D MMM YYYY')}`
    variant = 'secondary'
  }

  return (
    <Badge variant={variant} className={cn('gap-1 whitespace-nowrap', className)}>
      <CalendarClock className="size-3" /> {text}
    </Badge>
  )
}
