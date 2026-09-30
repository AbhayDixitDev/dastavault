import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useAuth } from '@/hooks/useAuth'
import { primaryNav, secondaryNav } from './nav'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { LogOut, Repeat, UserCircle } from 'lucide-react'

export function BottomNav() {
  const { terminology, workspace } = useWorkspace()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)
  const items = primaryNav(terminology)

  return (
    <>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
        <ul className="grid grid-cols-5">
          {items.map((item) => {
            const Icon = item.icon
            if (item.more) {
              return (
                <li key="more">
                  <button
                    type="button"
                    onClick={() => setMoreOpen(true)}
                    className="tap-target flex w-full flex-col items-center justify-center gap-0.5 py-2 text-[11px] text-muted-foreground"
                  >
                    <Icon className="size-5" />
                    {item.label}
                  </button>
                </li>
              )
            }
            if (item.primary) {
              return (
                <li key={item.to} className="relative">
                  <NavLink
                    to={item.to}
                    className="absolute left-1/2 top-0 flex -translate-x-1/2 -translate-y-5 flex-col items-center"
                  >
                    <span className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background">
                      <Icon className="size-7" />
                    </span>
                    <span className="mt-1 text-[11px] font-medium text-primary">{item.label}</span>
                  </NavLink>
                </li>
              )
            }
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'tap-target flex flex-col items-center justify-center gap-0.5 py-2 text-[11px]',
                      isActive ? 'text-primary' : 'text-muted-foreground',
                    )
                  }
                >
                  <Icon className="size-5" />
                  {item.label}
                </NavLink>
              </li>
            )
          })}
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-8">
          <SheetHeader>
            <SheetTitle>{workspace?.name}</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-4 gap-3 px-4">
            {secondaryNav(terminology).map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className="flex flex-col items-center gap-1 rounded-xl border p-3 text-center text-xs hover:bg-accent"
                >
                  <Icon className="size-6 text-primary" />
                  <span className="leading-tight">{item.label}</span>
                </NavLink>
              )
            })}
          </div>
          <div className="mt-4 flex flex-col gap-2 px-4">
            <Button variant="outline" onClick={() => { setMoreOpen(false); navigate('/w') }}>
              <Repeat /> Switch workspace
            </Button>
            <Button variant="outline" onClick={() => { setMoreOpen(false); navigate('/account') }}>
              <UserCircle /> My account
            </Button>
            <Button variant="ghost" onClick={() => signOut()}>
              <LogOut /> Sign out
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
