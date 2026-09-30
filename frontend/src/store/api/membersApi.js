import { baseApi } from './baseApi'

export const membersApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getMembers: build.query({
      query: (workspaceId) => `/workspaces/${workspaceId}/members`,
      transformResponse: (r) => r.members ?? [],
      providesTags: (_r, _e, workspaceId) => [{ type: 'Members', id: workspaceId }],
    }),
    updateMemberRole: build.mutation({
      query: ({ workspaceId, memberId, role_key }) => ({
        url: `/workspaces/${workspaceId}/members/${memberId}`,
        method: 'PATCH',
        body: { role_key },
      }),
      invalidatesTags: (_r, _e, { workspaceId }) => [{ type: 'Members', id: workspaceId }],
    }),
    removeMember: build.mutation({
      query: ({ workspaceId, memberId }) => ({
        url: `/workspaces/${workspaceId}/members/${memberId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_r, _e, { workspaceId }) => [{ type: 'Members', id: workspaceId }],
    }),
    getInvites: build.query({
      query: (workspaceId) => `/workspaces/${workspaceId}/invites`,
      transformResponse: (r) => r.invites ?? [],
      providesTags: (_r, _e, workspaceId) => [{ type: 'Invites', id: workspaceId }],
    }),
    createInvite: build.mutation({
      query: ({ workspaceId, ...body }) => ({
        url: `/workspaces/${workspaceId}/invites`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_r, _e, { workspaceId }) => [{ type: 'Invites', id: workspaceId }],
    }),
    deleteInvite: build.mutation({
      query: ({ workspaceId, inviteId }) => ({
        url: `/workspaces/${workspaceId}/invites/${inviteId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_r, _e, { workspaceId }) => [{ type: 'Invites', id: workspaceId }],
    }),
    getInvite: build.query({
      query: (token) => `/invites/${token}`,
      transformResponse: (r) => r.invite,
    }),
    acceptInvite: build.mutation({
      query: (token) => ({ url: `/invites/${token}/accept`, method: 'POST' }),
      invalidatesTags: ['Workspaces'],
    }),
  }),
})

export const {
  useGetMembersQuery,
  useUpdateMemberRoleMutation,
  useRemoveMemberMutation,
  useGetInvitesQuery,
  useCreateInviteMutation,
  useDeleteInviteMutation,
  useGetInviteQuery,
  useAcceptInviteMutation,
} = membersApi
