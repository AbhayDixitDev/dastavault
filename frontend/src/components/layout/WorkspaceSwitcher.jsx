import { useNavigate } from 'react-router-dom'
import { ChevronsUpDown, Plus, Check } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { WORKSPACE_KINDS } from '@/constants/terminology'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function kindEmoji(kind) {
  return WORKSPACE_KINDS.find((k) => k.key === kind)?.emoji ?? '📁'
}

export function WorkspaceSwitcher() {
  const { workspace, workspaces } = useWorkspace()
  const navigate = useNavigate()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left text-sm hover:bg-accent"
        >
          <span className="text-lg">{kindEmoji(workspace?.kind)}</span>
          <span className="flex-1 truncate">
            <span className="block truncate font-medium">{workspace?.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{workspace?.terminology?.workspace_label}</span>
          </span>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Your workspaces</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} onClick={() => navigate(`/w/${w.id}`)}>
            <span>{kindEmoji(w.kind)}</span>
            <span className="flex-1 truncate">{w.name}</span>
            {w.id === workspace?.id && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/onboarding')}>
          <Plus /> Create a new workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
