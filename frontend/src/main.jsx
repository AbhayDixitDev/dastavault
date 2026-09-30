import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { RouterProvider } from 'react-router-dom'
import { store } from '@/store'
import { router } from '@/routes'
import { AuthListener } from '@/components/common/AuthListener'
import { ThemeManager } from '@/components/common/ThemeManager'
import { Toaster } from '@/components/ui/sonner'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={store}>
      <ThemeManager />
      <AuthListener />
      <RouterProvider router={router} />
      <Toaster position="top-center" richColors closeButton />
    </Provider>
  </StrictMode>,
)
