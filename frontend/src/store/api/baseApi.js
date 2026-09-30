import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import { getAccessToken } from '@/lib/supabase'

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8787').replace(/\/$/, '')

const rawBaseQuery = fetchBaseQuery({
  baseUrl: `${API_URL}/api`,
  prepareHeaders: async (headers) => {
    const token = await getAccessToken()
    if (token) headers.set('authorization', `Bearer ${token}`)
    return headers
  },
})

async function baseQuery(args, api, extraOptions) {
  const result = await rawBaseQuery(args, api, extraOptions)
  if (result.error) {
    const data = result.error.data
    const message =
      (data && typeof data === 'object' && data.error) ||
      (typeof data === 'string' && data) ||
      (result.error.status === 'FETCH_ERROR' ? 'Cannot reach the server. Check your connection.' : 'Something went wrong.')
    result.error = { ...result.error, message }
  }
  return result
}

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: [
    'Me',
    'Workspaces',
    'Workspace',
    'Members',
    'Invites',
    'Groups',
    'People',
    'Person',
    'Documents',
    'Document',
    'Versions',
    'Suggestions',
    'Tags',
    'Search',
    'SavedSearches',
    'Albums',
    'Album',
    'Reminders',
    'Shares',
    'Activity',
    'Notifications',
    'Notes',
    'Note',
    'Vault',
    'VaultItems',
    'AiKeys',
    'Home',
  ],
  endpoints: () => ({}),
})
