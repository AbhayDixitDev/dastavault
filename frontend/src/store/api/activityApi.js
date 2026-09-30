import { baseApi } from './baseApi'

function toQuery(params) {
  const usp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') usp.set(k, v)
  })
  const s = usp.toString()
  return s ? `?${s}` : ''
}

export const activityApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /**
     * GET /workspaces/:ws/activity?limit=&cursor=&action=&entity_type=
     * Returns { items: [{ id, actor_id, actor: {display_name,email}, action, entity_type, entity_id, message, metadata, created_at }], next_cursor }
     */
    getActivity: build.query({
      query: ({ workspaceId, cursor, limit = 40, action, entity_type, entity_id, actor_id, date_from, date_to }) =>
        `/workspaces/${workspaceId}/activity${toQuery({ cursor, limit, action, entity_type, entity_id, actor_id, date_from, date_to })}`,
      transformResponse: (r) => ({ items: r?.items ?? [], next_cursor: r?.next_cursor ?? null }),
      providesTags: ['Activity'],
    }),
    /** GET /api/notifications?workspace_id=&unread=&limit=&cursor= */
    getNotifications: build.query({
      query: ({ workspaceId, unread, cursor, limit = 50 } = {}) =>
        `/notifications${toQuery({ workspace_id: workspaceId, unread: unread ? '1' : undefined, cursor, limit })}`,
      transformResponse: (r) => ({
        items: r?.items ?? [],
        next_cursor: r?.next_cursor ?? null,
        unread_count: r?.unread_count ?? 0,
      }),
      providesTags: ['Notifications'],
    }),
    markNotificationRead: build.mutation({
      query: ({ id }) => ({ url: `/notifications/${id}/read`, method: 'PATCH' }),
      invalidatesTags: ['Notifications'],
    }),
    markAllNotificationsRead: build.mutation({
      query: () => ({ url: `/notifications/read-all`, method: 'PATCH' }),
      invalidatesTags: ['Notifications'],
    }),
  }),
})

export const {
  useGetActivityQuery,
  useLazyGetActivityQuery,
  useGetNotificationsQuery,
  useLazyGetNotificationsQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
} = activityApi
