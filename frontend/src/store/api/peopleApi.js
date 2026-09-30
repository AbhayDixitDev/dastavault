import { baseApi } from './baseApi'

export const peopleApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getPeople: build.query({
      query: (workspaceId) => `/workspaces/${workspaceId}/people`,
      transformResponse: (r) => r.people ?? [],
      providesTags: (_r, _e, workspaceId) => ['People', { type: 'People', id: workspaceId }],
    }),
    getPerson: build.query({
      query: ({ workspaceId, personId }) => `/workspaces/${workspaceId}/people/${personId}`,
      transformResponse: (r) => r.person,
      providesTags: (_r, _e, { personId }) => [{ type: 'Person', id: personId }],
    }),
    createPerson: build.mutation({
      query: ({ workspaceId, ...body }) => ({
        url: `/workspaces/${workspaceId}/people`,
        method: 'POST',
        body,
      }),
      transformResponse: (r) => r.person,
      invalidatesTags: ['People'],
    }),
    updatePerson: build.mutation({
      query: ({ workspaceId, personId, ...body }) => ({
        url: `/workspaces/${workspaceId}/people/${personId}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (r) => r.person,
      invalidatesTags: (_r, _e, { personId }) => ['People', { type: 'Person', id: personId }],
    }),
    deletePerson: build.mutation({
      query: ({ workspaceId, personId }) => ({
        url: `/workspaces/${workspaceId}/people/${personId}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['People'],
    }),
    addRelationship: build.mutation({
      query: ({ workspaceId, personId, ...body }) => ({
        url: `/workspaces/${workspaceId}/people/${personId}/relationships`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_r, _e, { personId, to_person_id }) => [
        { type: 'Person', id: personId },
        { type: 'Person', id: to_person_id },
        'People',
      ],
    }),
    removeRelationship: build.mutation({
      query: ({ workspaceId, personId, relationshipId }) => ({
        url: `/workspaces/${workspaceId}/people/${personId}/relationships/${relationshipId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_r, _e, { personId }) => [{ type: 'Person', id: personId }, 'People'],
    }),
    addPersonToGroup: build.mutation({
      query: ({ workspaceId, personId, group_id }) => ({
        url: `/workspaces/${workspaceId}/people/${personId}/groups`,
        method: 'POST',
        body: { group_id },
      }),
      invalidatesTags: (_r, _e, { personId }) => [{ type: 'Person', id: personId }, 'People', 'Groups'],
    }),
    removePersonFromGroup: build.mutation({
      query: ({ workspaceId, personId, groupId }) => ({
        url: `/workspaces/${workspaceId}/people/${personId}/groups/${groupId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_r, _e, { personId }) => [{ type: 'Person', id: personId }, 'People', 'Groups'],
    }),
  }),
})

export const {
  useGetPeopleQuery,
  useGetPersonQuery,
  useCreatePersonMutation,
  useUpdatePersonMutation,
  useDeletePersonMutation,
  useAddRelationshipMutation,
  useRemoveRelationshipMutation,
  useAddPersonToGroupMutation,
  useRemovePersonFromGroupMutation,
} = peopleApi
