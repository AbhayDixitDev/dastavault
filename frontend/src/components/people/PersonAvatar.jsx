import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initials } from '@/utils/format'

/** A person's photo (custom.photo, the face from their photo) or their initials. */
export function PersonAvatar({ person, className }) {
  const photo = person?.custom?.photo
  return (
    <Avatar className={className}>
      {photo && <AvatarImage src={photo} alt="" className="object-cover" />}
      <AvatarFallback>{initials(person?.display_name)}</AvatarFallback>
    </Avatar>
  )
}
