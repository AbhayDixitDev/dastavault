import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { FullPageLoader } from '@/components/common/FullPageLoader'

export function ProtectedRoute() {
  const { isLoading, isSignedIn } = useAuth()
  const location = useLocation()

  if (isLoading) return <FullPageLoader label="Opening your vault..." />
  if (!isSignedIn) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}
