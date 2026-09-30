import { useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useSelector } from 'react-redux'
import { motion } from 'motion/react'
import { Plus, ChevronRight, LogOut } from 'lucide-react'
import { useGetWorkspacesQuery } from '@/store/api/workspacesApi'
import { selectUi } from '@/store/slices/uiSlice'
import { useAuth } from '@/hooks/useAuth'
import { kindEmoji } from '@/components/layout/WorkspaceSwitcher'
import { Logo } from '@/components/common/Logo'
import { FullPageLoader } from '@/components/common/FullPageLoader'
import { ErrorBox } from '@/components/common/ErrorBox'
import { Button } from '@/components/ui/button'
import { roleName } from '@/constants/roles'

export function WorkspaceSwitcherPage() {
  const { data: workspaces, isLoading, error, refetch } = useGetWorkspacesQuery()
  const { lastWorkspaceId } = useSelector(selectUi)
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!workspaces) return
    if (workspaces.length === 0) {
      navigate('/onboarding', { replace: true })
      return
    }
    // Auto-open the last used workspace when arriving from login.
    if (!location.state?.missing && lastWorkspaceId && workspaces.some((w) => w.id === lastWorkspaceId) && location.key === 'default') {
      navigate(`/w/${lastWorkspaceId}`, { replace: true })
    }
  }, [workspaces, lastWorkspaceId, navigate, location])

  if (isLoading) return <FullPageLoader label="Finding your workspaces..." />

  return (
    <div className="min-h-svh bg-muted/30 px-4 py-8">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo className="size-8" />
            <span className="font-semibold">DastaVault</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => signOut()}>
            <LogOut /> Sign out
          </Button>
        </div>
        <h1 className="text-2xl font-bold">Choose a workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">Signed in as {user?.email}</p>

        {error && <ErrorBox error={error} className="mt-4" onRetry={refetch} />}

        <div className="mt-6 grid gap-3">
          {(workspaces ?? []).map((w, i) => (
            <motion.div key={w.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
              <Link
                to={`/w/${w.id}`}
                className="flex items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary hover:bg-primary/5"
              >
                <span className="text-2xl">{kindEmoji(w.kind)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{w.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {w.terminology?.workspace_label} · You are {roleName(w.role_key)}
                  </span>
                </span>
                <ChevronRight className="size-5 text-muted-foreground" />
              </Link>
            </motion.div>
          ))}
          <Button asChild variant="outline" size="lg" className="justify-start">
            <Link to="/onboarding">
              <Plus /> Create a new workspace
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
