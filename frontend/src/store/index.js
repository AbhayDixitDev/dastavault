import { configureStore } from '@reduxjs/toolkit'
import { baseApi } from './api/baseApi'
import authReducer from './slices/authSlice'
import uiReducer from './slices/uiSlice'

// Register endpoint modules so their hooks are available app-wide.
import './api/workspacesApi'
import './api/membersApi'
import './api/groupsApi'
import './api/peopleApi'

export const store = configureStore({
  reducer: {
    auth: authReducer,
    ui: uiReducer,
    [baseApi.reducerPath]: baseApi.reducer,
  },
  middleware: (getDefault) => getDefault().concat(baseApi.middleware),
  devTools: import.meta.env.DEV,
})
