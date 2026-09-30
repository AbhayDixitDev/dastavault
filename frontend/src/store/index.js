import { configureStore } from '@reduxjs/toolkit'
import { baseApi } from './api/baseApi'
import authReducer from './slices/authSlice'
import uiReducer from './slices/uiSlice'

// Register endpoint modules so their hooks are available app-wide.
import './api/workspacesApi'
import './api/membersApi'
import './api/groupsApi'
import './api/peopleApi'
import './api/documentsApi'
import './api/searchApi'
import './api/albumsApi'
import './api/remindersApi'
import './api/activityApi'
import './api/ragApi'
import './api/vaultApi'
import './api/notesApi'
import './api/aiApi'
import './api/homeApi'

export const store = configureStore({
  reducer: {
    auth: authReducer,
    ui: uiReducer,
    [baseApi.reducerPath]: baseApi.reducer,
  },
  middleware: (getDefault) =>
    getDefault({
      // Files and blobs are never stored in Redux, but FormData bodies pass through mutations.
      serializableCheck: false,
    }).concat(baseApi.middleware),
  devTools: import.meta.env.DEV,
})
