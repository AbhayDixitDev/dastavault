import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { WifiOff } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { selectUi, setLastWorkspaceId } from '@/store/slices/uiSlice'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { TopBar } from './TopBar'
import { FullPageLoader } from '@/components/common/FullPageLoader'
import { ErrorBox } from '@/components/common/ErrorBox'
import { UploadQueueBanner } from '@/components/scanner/UploadQueueBanner'
import { startUploadQueue } from '@/services/offline/uploadQueue'

let queueStarted = false

export function AppShell() {
  const { workspaceId, workspace, isLoading, isFetching, error, refetch } = useWorkspace()
  const isDesktop = useIsDesktop()
  const dispatch = useDispatch()
  const { online } = useSelector(selectUi)

  useEffect(() => {
    if (workspace?.id) dispatch(setLastWorkspaceId(workspace.id))
  }, [workspace?.id, dispatch])

  // Pending uploads (offline captures) retry automatically once the shell is up.
  useEffect(() => {
    if (queueStarted) return
    queueStarted = true
    try {
      startUploadQueue()
    } catch {
      /* queue unavailable; uploads still work directly */
    }
  }, [])

  // First load, or a refetch that has not yet delivered a workspace we were just sent to.
  if (isLoading || (!workspace && isFetching)) return <FullPageLoader label="Opening your workspace..." />

  if (error) {
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorBox error={error} title="Could not load your workspace" onRetry={refetch} />
      </div>
    )
  }

  if (!workspace) return <Navigate to="/w" replace state={{ missing: workspaceId }} />

  return (
    <div className="flex min-h-svh bg-background">
      {isDesktop && <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        {!online && (
          <div className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
            <WifiOff className="size-4" />
            Waiting for internet connection. Your changes are saved on this device.
          </div>
        )}
        <UploadQueueBanner workspaceId={workspaceId} className="mx-4 mt-3 md:mx-6" />
        <main className="flex-1 px-4 pb-24 pt-4 md:px-6 lg:pb-8">
          <Outlet />
        </main>
        {!isDesktop && <BottomNav />}
      </div>
    </div>
  )
}
