import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { ProtectedRoute } from '@/components/common/ProtectedRoute'
import { AppShell } from '@/components/layout/AppShell'
import { RouteErrorPage } from '@/components/common/ErrorPage'
import { FullPageLoader } from '@/components/common/FullPageLoader'
import { LandingPage } from '@/pages/Landing/LandingPage'
import { LoginPage } from '@/pages/Auth/LoginPage'
import { SignupPage } from '@/pages/Auth/SignupPage'
import { ForgotPasswordPage } from '@/pages/Auth/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/Auth/ResetPasswordPage'
import { VerifyPage } from '@/pages/Auth/VerifyPage'
import { OnboardingPage } from '@/pages/Onboarding/OnboardingPage'
import { WorkspaceSwitcherPage } from '@/pages/Workspaces/WorkspaceSwitcherPage'
import { HomePage } from '@/pages/Home/HomePage'
import { PeoplePage } from '@/pages/People/PeoplePage'
import { PersonPage } from '@/pages/People/PersonPage'
import { GroupsPage } from '@/pages/Groups/GroupsPage'
import { SettingsPage } from '@/pages/Settings/SettingsPage'
import { AccountPage } from '@/pages/Account/AccountPage'
import { InviteAcceptPage } from '@/pages/Invite/InviteAcceptPage'
import { NotFoundPage } from '@/pages/NotFound/NotFoundPage'

// Heavier feature pages are code-split so the shell loads fast on phones.
const DocumentsPage = lazy(() => import('@/pages/Documents/DocumentsPage').then((m) => ({ default: m.DocumentsPage })))
const TrashPage = lazy(() => import('@/pages/Trash/TrashPage').then((m) => ({ default: m.TrashPage })))
const DocumentDetailPage = lazy(() => import('@/pages/DocumentDetail/DocumentDetailPage').then((m) => ({ default: m.DocumentDetailPage })))
const DocumentEditPage = lazy(() => import('@/pages/DocumentEdit/DocumentEditPage').then((m) => ({ default: m.DocumentEditPage })))
const NewWrittenDocumentPage = lazy(() => import('@/pages/DocumentEdit/NewWrittenDocumentPage').then((m) => ({ default: m.NewWrittenDocumentPage })))
const UploadPage = lazy(() => import('@/pages/Upload/UploadPage').then((m) => ({ default: m.UploadPage })))
const ScannerPage = lazy(() => import('@/pages/Scanner/ScannerPage').then((m) => ({ default: m.ScannerPage })))
const SearchPage = lazy(() => import('@/pages/Search/SearchPage').then((m) => ({ default: m.SearchPage })))
const AlbumsPage = lazy(() => import('@/pages/Albums/AlbumsPage').then((m) => ({ default: m.AlbumsPage })))
const AlbumPage = lazy(() => import('@/pages/Albums/AlbumPage').then((m) => ({ default: m.AlbumPage })))
const RemindersPage = lazy(() => import('@/pages/Reminders/RemindersPage').then((m) => ({ default: m.RemindersPage })))
const ActivityPage = lazy(() => import('@/pages/Activity/ActivityPage').then((m) => ({ default: m.ActivityPage })))
const NotesPage = lazy(() => import('@/pages/Notes/NotesPage').then((m) => ({ default: m.NotesPage })))
const NotePage = lazy(() => import('@/pages/Notes/NotePage').then((m) => ({ default: m.NotePage })))
const ChaabiPage = lazy(() => import('@/pages/Chaabi/ChaabiPage').then((m) => ({ default: m.ChaabiPage })))
const SharePage = lazy(() => import('@/pages/Share/SharePage').then((m) => ({ default: m.SharePage })))

const L = (Component) => (
  <Suspense fallback={<FullPageLoader label="Loading..." />}>
    <Component />
  </Suspense>
)

export const router = createBrowserRouter([
  { path: '/', element: <LandingPage />, errorElement: <RouteErrorPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/verify', element: <VerifyPage /> },
  { path: '/s/:token', element: L(SharePage), errorElement: <RouteErrorPage /> },
  {
    element: <ProtectedRoute />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/onboarding', element: <OnboardingPage /> },
      { path: '/w', element: <WorkspaceSwitcherPage /> },
      { path: '/invite/:token', element: <InviteAcceptPage /> },
      { path: '/account', element: <AccountPage /> },
      {
        path: '/w/:ws',
        element: <AppShell />,
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'search', element: L(SearchPage) },
          { path: 'scan', element: L(ScannerPage) },
          { path: 'upload', element: L(UploadPage) },
          { path: 'documents', element: L(DocumentsPage) },
          { path: 'documents/new', element: L(NewWrittenDocumentPage) },
          { path: 'documents/trash', element: L(TrashPage) },
          { path: 'documents/:id', element: L(DocumentDetailPage) },
          { path: 'documents/:id/edit', element: L(DocumentEditPage) },
          { path: 'people', element: <PeoplePage /> },
          { path: 'people/:id', element: <PersonPage /> },
          { path: 'groups', element: <GroupsPage /> },
          { path: 'groups/:id', element: <GroupsPage /> },
          { path: 'albums', element: L(AlbumsPage) },
          { path: 'albums/:id', element: L(AlbumPage) },
          { path: 'notes', element: L(NotesPage) },
          { path: 'notes/:id', element: L(NotePage) },
          { path: 'chaabi', element: L(ChaabiPage) },
          { path: 'reminders', element: L(RemindersPage) },
          { path: 'activity', element: L(ActivityPage) },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'settings/:tab', element: <SettingsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
  { path: '/app', element: <Navigate to="/w" replace /> },
  { path: '*', element: <NotFoundPage /> },
])
