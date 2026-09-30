import { Link, useNavigate } from 'react-router-dom'
import { Search, Mic, ImageIcon, LogOut, UserCircle, Repeat } from 'lucide-react'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useAuth } from '@/hooks/useAuth'
import { Logo } from '@/components/common/Logo'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { initials, displayNameOf } from '@/utils/format'

export function TopBar() {
  const isDesktop = useIsDesktop()
  const { workspace, workspaceId } = useWorkspace()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const goSearch = (e) => {
    e.preventDefault()
    const q = new FormData(e.currentTarget).get('q')
    navigate(`/w/${workspaceId}/search${q ? `?q=${encodeURIComponent(q)}` : ''}`)
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
      {!isDesktop && (
        <Link to={`/w/${workspaceId}`} className="flex items-center gap-2">
          <Logo className="size-7" />
          <span className="max-w-[40vw] truncate font-semibold">{workspace?.name}</span>
        </Link>
      )}

      {isDesktop && (
        <form onSubmit={goSearch} className="relative mx-auto w-full max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            name="q"
            placeholder="Search your documents"
            className="h-10 w-full rounded-full border bg-muted/40 pl-9 pr-20 text-sm outline-none focus:ring-2 focus:ring-ring/50"
          />
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5">
            <Button type="button" variant="ghost" size="icon" className="size-8" title="Search by voice">
              <Mic className="size-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="size-8" title="Search with a photo">
              <ImageIcon className="size-4" />
            </Button>
          </div>
        </form>
      )}

      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="rounded-full outline-none ring-ring/50 focus-visible:ring-2">
              <Avatar className="size-9">
                <AvatarFallback>{initials(displayNameOf(user) || '?')}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate">{user?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/account')}>
              <UserCircle /> My account
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/w')}>
              <Repeat /> Switch workspace
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut()}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
