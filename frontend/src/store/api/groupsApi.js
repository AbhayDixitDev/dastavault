import { baseApi } from './baseApi'

export const groupsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getGroups: build.query({
      query: (workspaceId) => `/workspaces/${workspaceId}/groups`,
      transformResponse: (r) => r.groups ?? [],
      providesTags: (_r, _e, workspaceId) => [{ type: 'Groups', id: workspaceId }],
    }),
    createGroup: build.mutation({
      query: ({ workspaceId, ...body }) => ({
        url: `/workspaces/${workspaceId}/groups`,
        method: 'POST',
        body,
      }),
      transformResponse: (r) => r.group,
      invalidatesTags: (_r, _e, { workspaceId }) => [{ type: 'Groups', id: workspaceId }],
    }),
    updateGroup: build.mutation({
      query: ({ workspaceId, groupId, ...body }) => ({
        url: `/workspaces/${workspaceId}/groups/${groupId}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (r) => r.group,
      invalidatesTags: (_r, _e, { workspaceId }) => [{ type: 'Groups', id: workspaceId }, 'People'],
    }),
    deleteGroup: build.mutation({
      query: ({ workspaceId, groupId }) => ({
        url: `/workspaces/${workspaceId}/groups/${groupId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_r, _e, { workspaceId }) => [{ type: 'Groups', id: workspaceId }, 'People'],
    }),
  }),
})

export const { useGetGroupsQuery, useCreateGroupMutation, useUpdateGroupMutation, useDeleteGroupMutation } =
  groupsApi
