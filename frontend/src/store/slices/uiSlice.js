import { createSlice } from '@reduxjs/toolkit'

function readPref(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : JSON.parse(v)
  } catch {
    return fallback
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

const initialState = {
  theme: readPref('dv.theme', 'system'), // 'light' | 'dark' | 'system'
  largeText: readPref('dv.largeText', false),
  lastWorkspaceId: readPref('dv.lastWorkspaceId', null),
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  sidebarCollapsed: readPref('dv.sidebarCollapsed', false),
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setTheme(state, action) {
      state.theme = action.payload
      writePref('dv.theme', action.payload)
    },
    setLargeText(state, action) {
      state.largeText = action.payload
      writePref('dv.largeText', action.payload)
    },
    setLastWorkspaceId(state, action) {
      state.lastWorkspaceId = action.payload
      writePref('dv.lastWorkspaceId', action.payload)
    },
    setOnline(state, action) {
      state.online = action.payload
    },
    setSidebarCollapsed(state, action) {
      state.sidebarCollapsed = action.payload
      writePref('dv.sidebarCollapsed', action.payload)
    },
  },
})

export const { setTheme, setLargeText, setLastWorkspaceId, setOnline, setSidebarCollapsed } = uiSlice.actions
export default uiSlice.reducer
export const selectUi = (state) => state.ui
