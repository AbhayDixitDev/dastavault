import { baseApi } from './baseApi'

export const workspacesApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getMe: build.query({
      query: () => '/me',
      transformResponse: (r) => r.profile,
      providesTags: ['Me'],
    }),
    updateMe: build.mutation({
      query: (body) => ({ url: '/me', method: 'PATCH', body }),
      invalidatesTags: ['Me'],
    }),
    getWorkspaces: build.query({
      query: () => '/workspaces',
      transformResponse: (r) => r.workspaces ?? [],
      providesTags: (result = []) => [
        'Workspaces',
        ...result.map((w) => ({ type: 'Workspace', id: w.id })),
      ],
    }),
    getWorkspace: build.query({
      query: (id) => `/workspaces/${id}`,
      transformResponse: (r) => r.workspace,
      providesTags: (_r, _e, id) => [{ type: 'Workspace', id }],
    }),
    createWorkspace: build.mutation({
      query: (body) => ({ url: '/workspaces', method: 'POST', body }),
      transformResponse: (r) => r.workspace,
      // Put the new workspace into the cached list immediately so the app can
      // open it without waiting for a refetch (avoids bouncing back to onboarding).
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data: ws } = await queryFulfilled
          dispatch(
            workspacesApi.util.updateQueryData('getWorkspaces', undefined, (draft) => {
              if (!draft.some((w) => w.id === ws.id)) draft.push(ws)
            }),
          )
        } catch {
          /* handled by caller */
        }
      },
      invalidatesTags: ['Workspaces'],
    }),
    updateWorkspace: build.mutation({
      query: ({ id, ...body }) => ({ url: `/workspaces/${id}`, method: 'PATCH', body }),
      transformResponse: (r) => r.workspace,
      invalidatesTags: (_r, _e, { id }) => ['Workspaces', { type: 'Workspace', id }],
    }),
    deleteWorkspace: build.mutation({
      query: (id) => ({ url: `/workspaces/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Workspaces'],
    }),
    updateTerminology: build.mutation({
      query: ({ workspaceId, ...body }) => ({
        url: `/workspaces/${workspaceId}/terminology`,
        method: 'PUT',
        body,
      }),
      transformResponse: (r) => r.terminology,
      invalidatesTags: (_r, _e, { workspaceId }) => ['Workspaces', { type: 'Workspace', id: workspaceId }],
    }),
  }),
})

export const {
  useGetMeQuery,
  useUpdateMeMutation,
  useGetWorkspacesQuery,
  useGetWorkspaceQuery,
  useCreateWorkspaceMutation,
  useUpdateWorkspaceMutation,
  useDeleteWorkspaceMutation,
  useUpdateTerminologyMutation,
} = workspacesApi
