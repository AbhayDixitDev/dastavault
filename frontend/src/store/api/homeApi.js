import { baseApi } from './baseApi'

export const homeApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getHome: build.query({
      query: (workspaceId) => `/workspaces/${workspaceId}/home`,
      providesTags: (_r, _e, workspaceId) => [{ type: 'Home', id: workspaceId }, 'Documents'],
    }),
    getStats: build.query({
      query: (workspaceId) => `/workspaces/${workspaceId}/stats`,
      providesTags: (_r, _e, workspaceId) => [{ type: 'Home', id: workspaceId }],
    }),
  }),
})

export const { useGetHomeQuery, useGetStatsQuery } = homeApi
