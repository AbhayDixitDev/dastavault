import { baseApi } from './baseApi'

export const remindersApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getReminders: build.query({
      query: ({ workspaceId, upcoming_days, document_id }) => {
        const usp = new URLSearchParams()
        if (upcoming_days) usp.set('upcoming_days', upcoming_days)
        if (document_id) usp.set('document_id', document_id)
        const s = usp.toString()
        return `/workspaces/${workspaceId}/reminders${s ? `?${s}` : ''}`
      },
      transformResponse: (r) => r?.reminders ?? [],
      providesTags: (_r, _e, { workspaceId }) => ['Reminders', { type: 'Reminders', id: workspaceId }],
    }),
    getExpiring: build.query({
      query: ({ workspaceId, days = 60 }) => `/workspaces/${workspaceId}/reminders/expiring?days=${days}`,
      transformResponse: (r) => r?.documents ?? [],
      providesTags: ['Reminders', 'Documents'],
    }),
    createReminder: build.mutation({
      query: ({ workspaceId, ...body }) => ({
        url: `/workspaces/${workspaceId}/reminders`,
        method: 'POST',
        body,
      }),
      transformResponse: (r) => r?.reminder,
      invalidatesTags: ['Reminders', 'Home'],
    }),
    updateReminder: build.mutation({
      query: ({ workspaceId, reminderId, ...body }) => ({
        url: `/workspaces/${workspaceId}/reminders/${reminderId}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (r) => r?.reminder,
      invalidatesTags: ['Reminders'],
    }),
    deleteReminder: build.mutation({
      query: ({ workspaceId, reminderId }) => ({
        url: `/workspaces/${workspaceId}/reminders/${reminderId}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Reminders'],
    }),
    /** POST /documents/:id/reminders/auto - 30, 7 and 1 day reminders for the expiry date. */
    createAutoReminders: build.mutation({
      query: ({ workspaceId, documentId }) => ({
        url: `/workspaces/${workspaceId}/documents/${documentId}/reminders/auto`,
        method: 'POST',
      }),
      transformResponse: (r) => r?.reminders ?? [],
      invalidatesTags: ['Reminders'],
    }),
  }),
})

export const {
  useGetRemindersQuery,
  useGetExpiringQuery,
  useCreateReminderMutation,
  useUpdateReminderMutation,
  useDeleteReminderMutation,
  useCreateAutoRemindersMutation,
} = remindersApi
