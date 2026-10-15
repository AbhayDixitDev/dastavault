import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { QuickAddSheet } from './QuickAddSheet'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/hooks/useWorkspace'
import { primaryNav, secondaryNav } from './nav'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { Logo } from '@/components/common/Logo'

function SideLink({ to, label, icon: Icon, end, primary }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60',
          primary && 'bg-primary text-primary-foreground hover:bg-primary/90',
        )
      }
    >
      <Icon className="size-5" />
      <span>{label}</span>
    </NavLink>
  )
}

export function Sidebar() {
  const { terminology } = useWorkspace()
  const primary = primaryNav(terminology).filter((i) => !i.more && !i.primary)
  const [addOpen, setAddOpen] = useState(false)
  const secondary = secondaryNav(terminology)

  return (
    <aside className="sticky top-0 flex h-svh w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-4 py-4">
        <Logo className="size-7" />
        <span className="text-lg font-semibold tracking-tight">DastaVault</span>
      </div>
      <div className="px-3 pb-3">
        <WorkspaceSwitcher />
      </div>
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-gradient px-3 py-2.5 text-sm font-semibold text-white shadow-lift transition active:scale-[0.98]"
        >
          <Plus className="size-5" /> Add
        </button>
        <QuickAddSheet open={addOpen} onOpenChange={setAddOpen} />
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3">
        {primary.map((item) => (
          <SideLink key={item.to} {...item} />
        ))}
        <div className="my-2 border-t" />
        {secondary.map((item) => (
          <SideLink key={item.to} {...item} />
        ))}
      </nav>
      <div className="px-4 py-3 text-xs text-muted-foreground">Private. Free. Yours.</div>
    </aside>
  )
}
