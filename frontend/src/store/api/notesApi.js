import { baseApi } from './baseApi'

/** Notes are workspace-scoped: /api/workspaces/:ws/notes (API contract section 7). */
export const notesApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getNotes: build.query({
      query: ({ workspaceId, q, pinned, cursor } = {}) => {
        const qs = new URLSearchParams()
        if (q) qs.set('q', q)
        if (pinned) qs.set('pinned', '1')
        if (cursor) qs.set('cursor', cursor)
        const s = qs.toString()
        return `/workspaces/${workspaceId}/notes${s ? `?${s}` : ''}`
      },
      transformResponse: (r) => ({ notes: r.notes ?? [], next_cursor: r.next_cursor ?? null }),
      providesTags: (_r, _e, { workspaceId }) => ['Notes', { type: 'Notes', id: workspaceId }],
    }),
    getNote: build.query({
      query: ({ workspaceId, noteId }) => `/workspaces/${workspaceId}/notes/${noteId}`,
      transformResponse: (r) => r.note,
      providesTags: (_r, _e, { noteId }) => [{ type: 'Note', id: noteId }],
    }),
    createNote: build.mutation({
      query: ({ workspaceId, ...body }) => ({ url: `/workspaces/${workspaceId}/notes`, method: 'POST', body }),
      transformResponse: (r) => r.note,
      invalidatesTags: ['Notes'],
    }),
    updateNote: build.mutation({
      // body may include updated_at; a stale value returns 409 { code: 'conflict', note }
      query: ({ workspaceId, noteId, ...body }) => ({ url: `/workspaces/${workspaceId}/notes/${noteId}`, method: 'PATCH', body }),
      transformResponse: (r) => r.note,
      invalidatesTags: (_r, _e, { noteId }) => ['Notes', { type: 'Note', id: noteId }],
    }),
    deleteNote: build.mutation({
      query: ({ workspaceId, noteId }) => ({ url: `/workspaces/${workspaceId}/notes/${noteId}`, method: 'DELETE' }),
      invalidatesTags: ['Notes'],
    }),
    restoreNote: build.mutation({
      query: ({ workspaceId, noteId }) => ({ url: `/workspaces/${workspaceId}/notes/${noteId}/restore`, method: 'POST', body: {} }),
      transformResponse: (r) => r.note,
      invalidatesTags: ['Notes'],
    }),
  }),
})

export const {
  useGetNotesQuery,
  useGetNoteQuery,
  useCreateNoteMutation,
  useUpdateNoteMutation,
  useDeleteNoteMutation,
  useRestoreNoteMutation,
} = notesApi
