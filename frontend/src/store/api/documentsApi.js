import { baseApi } from './baseApi'

/** Builds a query string from an object, skipping empty values. */
function qs(params = {}) {
  const sp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || v === false) return
    sp.set(k, v === true ? '1' : String(v))
  })
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const docTag = (id) => ({ type: 'Document', id })

export const documentsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /* ---------- lists ---------- */
    getDocuments: build.query({
      query: ({ workspaceId, ...filters }) => `/workspaces/${workspaceId}/documents${qs(filters)}`,
      transformResponse: (r) => ({ documents: r.documents ?? [], next_cursor: r.next_cursor ?? null }),
      providesTags: (result) => [
        'Documents',
        ...(result?.documents ?? []).map((d) => docTag(d.id)),
      ],
    }),
    getTrash: build.query({
      query: ({ workspaceId, ...filters }) => `/workspaces/${workspaceId}/documents/trash${qs(filters)}`,
      transformResponse: (r) => ({ documents: r.documents ?? [], next_cursor: r.next_cursor ?? null }),
      providesTags: ['Documents', { type: 'Documents', id: 'TRASH' }],
    }),

    /* ---------- one document ---------- */
    getDocument: build.query({
      query: ({ workspaceId, documentId }) => `/workspaces/${workspaceId}/documents/${documentId}`,
      transformResponse: (r) => r.document,
      providesTags: (_r, _e, { documentId }) => [docTag(documentId)],
    }),
    updateDocument: build.mutation({
      query: ({ workspaceId, documentId, ...body }) => ({
        url: `/workspaces/${workspaceId}/documents/${documentId}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (r) => r.document,
      // Optimistic edit of the cached document so the page feels instant.
      async onQueryStarted({ workspaceId, documentId, ...body }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          documentsApi.util.updateQueryData('getDocument', { workspaceId, documentId }, (draft) => {
            if (!draft) return
            Object.entries(body).forEach(([k, v]) => {
              if (k === 'person_ids' || k === 'group_ids') return
              draft[k] = v
            })
          }),
        )
        try {
          await queryFulfilled
        } catch {
          patch.undo()
        }
      },
      invalidatesTags: (_r, _e, { documentId }) => ['Documents', docTag(documentId), 'Home'],
    }),
    deleteDocument: build.mutation({
      query: ({ workspaceId, documentId }) => ({
        url: `/workspaces/${workspaceId}/documents/${documentId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_r, _e, { documentId }) => ['Documents', docTag(documentId), 'Home'],
    }),
    restoreDocument: build.mutation({
      query: ({ workspaceId, documentId }) => ({
        url: `/workspaces/${workspaceId}/documents/${documentId}/restore`,
        method: 'POST',
      }),
      transformResponse: (r) => r.document,
      invalidatesTags: (_r, _e, { documentId }) => ['Documents', docTag(documentId), 'Home'],
    }),
    purgeDocument: build.mutation({
      query: ({ workspaceId, documentId }) => ({
        url: `/workspaces/${workspaceId}/documents/${documentId}/purge`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Documents', 'Home'],
    }),

    /* ---------- versions ---------- */
    getVersions: build.query({
      query: ({ workspaceId, documentId }) => `/workspaces/${workspaceId}/documents/${documentId}/versions`,
      transformResponse: (r) => r.versions ?? [],
      providesTags: (_r, _e, { documentId }) => [{ type: 'Versions', id: documentId }],
    }),
    uploadVersion: build.mutation({
      // formData: files[], comment?, sha256[]?, kind?, page_numbers[]?
      query: ({ workspaceId, documentId, formData }) => ({
        url: `/workspaces/${workspaceId}/documents/${documentId}/versions`,
        method: 'POST',
        body: formData,
      }),
      invalidatesTags: (_r, _e, { documentId }) => [{ type: 'Versions', id: documentId }, docTag(documentId), 'Documents'],
    }),
    restoreVersion: build.mutation({
      query: ({ workspaceId, documentId, versionId, comment }) => ({
        url: `/workspaces/${workspaceId}/documents/${documentId}/versions/${versionId}/restore`,
        method: 'POST',
        body: comment ? { comment } : {},
      }),
      transformResponse: (r) => r.version,
      invalidatesTags: (_r, _e, { documentId }) => [{ type: 'Versions', id: documentId }, docTag(documentId), 'Documents'],
    }),
    addVersionFiles: build.mutation({
      // formData: files[], kind, page_numbers[]?
      query: ({ workspaceId, documentId, versionId, formData }) => ({
        url: `/workspaces/${workspaceId}/documents/${documentId}/versions/${versionId}/files`,
        method: 'POST',
        body: formData,
      }),
      invalidatesTags: (_r, _e, { documentId }) => [{ type: 'Versions', id: documentId }, docTag(documentId)],
    }),
    getTimeline: build.query({
      query: ({ workspaceId, documentId }) => `/workspaces/${workspaceId}/documents/${documentId}/timeline`,
      transformResponse: (r) => r.items ?? [],
      providesTags: (_r, _e, { documentId }) => [docTag(documentId), { type: 'Activity', id: documentId }],
    }),
    getDocumentContent: build.query({
      query: ({ workspaceId, documentId }) => `/workspaces/${workspaceId}/documents/${documentId}/content`,
      providesTags: (_r, _e, { documentId }) => [docTag(documentId)],
    }),

    /* ---------- files ---------- */
    getFileUrl: build.query({
      query: ({ workspaceId, fileId, download }) =>
        `/workspaces/${workspaceId}/files/${fileId}/url${download ? '?download=1' : ''}`,
      keepUnusedDataFor: 240,
    }),

    /* ---------- tags ---------- */
    getTags: build.query({
      query: (workspaceId) => `/workspaces/${workspaceId}/tags`,
      transformResponse: (r) => r.tags ?? [],
      providesTags: (_r, _e, workspaceId) => ['Tags', { type: 'Tags', id: workspaceId }],
    }),
    createTag: build.mutation({
      query: ({ workspaceId, ...body }) => ({ url: `/workspaces/${workspaceId}/tags`, method: 'POST', body }),
      transformResponse: (r) => r.tag,
      invalidatesTags: ['Tags'],
    }),
    updateDocumentTags: build.mutation({
      query: ({ workspaceId, documentId, tag_ids, names }) => ({
        url: `/workspaces/${workspaceId}/documents/${documentId}/tags`,
        method: 'PUT',
        body: { ...(tag_ids ? { tag_ids } : {}), ...(names ? { names } : {}) },
      }),
      transformResponse: (r) => r.tags ?? [],
      invalidatesTags: (_r, _e, { documentId }) => [docTag(documentId), 'Tags', 'Documents'],
    }),

    /* ---------- suggestions and details ---------- */
    getSuggestions: build.query({
      query: ({ workspaceId, documentId }) => `/workspaces/${workspaceId}/documents/${documentId}/suggestions`,
      transformResponse: (r) => r.suggestions ?? [],
      providesTags: (_r, _e, { documentId }) => [{ type: 'Suggestions', id: documentId }],
    }),
    acceptSuggestion: build.mutation({
      query: ({ workspaceId, documentId, suggestionId }) => ({
        url: `/workspaces/${workspaceId}/documents/${documentId}/suggestions/${suggestionId}/accept`,
        method: 'POST',
      }),
      invalidatesTags: (_r, _e, { documentId }) => [docTag(documentId), { type: 'Suggestions', id: documentId }, 'Documents'],
    }),
    updateMetadata: build.mutation({
      query: ({ workspaceId, documentId, fields }) => ({
        url: `/workspaces/${workspaceId}/documents/${documentId}/metadata`,
        method: 'PATCH',
        body: { fields },
      }),
      transformResponse: (r) => r.metadata ?? {},
      invalidatesTags: (_r, _e, { documentId }) => [docTag(documentId), 'Documents'],
    }),
    checkDuplicates: build.mutation({
      query: ({ workspaceId, ...body }) => ({
        url: `/workspaces/${workspaceId}/documents/check-duplicates`,
        method: 'POST',
        body,
      }),
      transformResponse: (r) => r.matches ?? [],
    }),

    /* ---------- shares ---------- */
    getShares: build.query({
      query: ({ workspaceId, documentId }) => `/workspaces/${workspaceId}/shares${qs({ document_id: documentId })}`,
      transformResponse: (r) => r.shares ?? [],
      providesTags: (_r, _e, { documentId }) => ['Shares', { type: 'Shares', id: documentId }],
    }),
    createShare: build.mutation({
      query: ({ workspaceId, ...body }) => ({ url: `/workspaces/${workspaceId}/shares`, method: 'POST', body }),
      transformResponse: (r) => r.share,
      invalidatesTags: (_r, _e, { document_id }) => ['Shares', { type: 'Shares', id: document_id }],
    }),
    deleteShare: build.mutation({
      query: ({ workspaceId, shareId }) => ({ url: `/workspaces/${workspaceId}/shares/${shareId}`, method: 'DELETE' }),
      invalidatesTags: ['Shares'],
    }),
  }),
})

export const {
  useGetDocumentsQuery,
  useLazyGetDocumentsQuery,
  useGetTrashQuery,
  useLazyGetTrashQuery,
  useGetDocumentQuery,
  useUpdateDocumentMutation,
  useDeleteDocumentMutation,
  useRestoreDocumentMutation,
  usePurgeDocumentMutation,
  useGetVersionsQuery,
  useUploadVersionMutation,
  useRestoreVersionMutation,
  useAddVersionFilesMutation,
  useGetTimelineQuery,
  useGetDocumentContentQuery,
  useLazyGetFileUrlQuery,
  useGetTagsQuery,
  useCreateTagMutation,
  useUpdateDocumentTagsMutation,
  useGetSuggestionsQuery,
  useAcceptSuggestionMutation,
  useUpdateMetadataMutation,
  useCheckDuplicatesMutation,
  useGetSharesQuery,
  useCreateShareMutation,
  useDeleteShareMutation,
} = documentsApi
