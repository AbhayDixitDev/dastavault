import { createBrowserRouter, Navigate } from 'react-router-dom'
import { ProtectedRoute } from '@/components/common/ProtectedRoute'
import { AppShell } from '@/components/layout/AppShell'
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
import { ComingSoonPage } from '@/pages/ComingSoon/ComingSoonPage'
import { NotFoundPage } from '@/pages/NotFound/NotFoundPage'

export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/verify', element: <VerifyPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      { path: '/onboarding', element: <OnboardingPage /> },
      { path: '/w', element: <WorkspaceSwitcherPage /> },
      { path: '/invite/:token', element: <InviteAcceptPage /> },
      { path: '/account', element: <AccountPage /> },
      {
        path: '/w/:ws',
        element: <AppShell />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'search', element: <ComingSoonPage feature="search" /> },
          { path: 'scan', element: <ComingSoonPage feature="scan" /> },
          { path: 'upload', element: <ComingSoonPage feature="upload" /> },
          { path: 'documents', element: <ComingSoonPage feature="documents" /> },
          { path: 'documents/trash', element: <ComingSoonPage feature="trash" /> },
          { path: 'documents/:id', element: <ComingSoonPage feature="document" /> },
          { path: 'people', element: <PeoplePage /> },
          { path: 'people/:id', element: <PersonPage /> },
          { path: 'groups', element: <GroupsPage /> },
          { path: 'groups/:id', element: <GroupsPage /> },
          { path: 'albums', element: <ComingSoonPage feature="albums" /> },
          { path: 'notes', element: <ComingSoonPage feature="notes" /> },
          { path: 'chaabi', element: <ComingSoonPage feature="chaabi" /> },
          { path: 'reminders', element: <ComingSoonPage feature="reminders" /> },
          { path: 'activity', element: <ComingSoonPage feature="activity" /> },
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
