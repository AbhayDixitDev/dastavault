import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { RouterProvider } from 'react-router-dom'
import { store } from '@/store'
import { router } from '@/routes'
import { AuthListener } from '@/components/common/AuthListener'
import { ThemeManager } from '@/components/common/ThemeManager'
import { AppUpdate } from '@/components/common/AppUpdate'
import { BackButtonHandler } from '@/components/common/BackButtonHandler'
import { Toaster } from '@/components/ui/sonner'
import { setupServiceWorker } from '@/lib/serviceWorker'
import './index.css'

setupServiceWorker()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={store}>
      <ThemeManager />
      <AuthListener />
      <RouterProvider router={router} />
      <AppUpdate />
      <BackButtonHandler />
      <Toaster position="top-center" richColors closeButton />
    </Provider>
  </StrictMode>,
)
