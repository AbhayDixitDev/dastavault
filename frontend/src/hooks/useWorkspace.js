import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useGetWorkspacesQuery } from '@/store/api/workspacesApi'
import { terminologyFor } from '@/constants/terminology'
import { hasRole } from '@/constants/roles'

/**
 * Returns the active workspace (from the :ws route param), its terminology
 * and the current user's role in it.
 */
export function useWorkspace() {
  const { ws } = useParams()
  const { data: workspaces = [], isLoading, isFetching, error, refetch } = useGetWorkspacesQuery()

  const workspace = useMemo(() => workspaces.find((w) => w.id === ws) ?? null, [workspaces, ws])

  const terminology = useMemo(() => {
    const base = terminologyFor(workspace?.kind ?? 'custom')
    return { ...base, ...(workspace?.terminology ?? {}) }
  }, [workspace])

  const role = workspace?.role_key ?? null

  return {
    workspaceId: ws,
    workspace,
    workspaces,
    terminology,
    role,
    can: (minRole) => hasRole(role, minRole),
    isLoading,
    isFetching,
    error,
    refetch,
  }
}

/** Shorthand for terminology only. */
export function useTerminology() {
  return useWorkspace().terminology
}
