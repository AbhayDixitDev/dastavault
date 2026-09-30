import { baseApi } from './baseApi'

export const albumsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getAlbums: build.query({
      query: (workspaceId) => `/workspaces/${workspaceId}/albums`,
      transformResponse: (r) => r?.albums ?? [],
      providesTags: (_r, _e, workspaceId) => ['Albums', { type: 'Albums', id: workspaceId }],
    }),
    getAlbum: build.query({
      query: ({ workspaceId, albumId, cursor }) =>
        `/workspaces/${workspaceId}/albums/${albumId}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      transformResponse: (r) => ({
        album: r?.album ?? null,
        documents: r?.documents ?? [],
        next_cursor: r?.next_cursor ?? null,
      }),
      providesTags: (_r, _e, { albumId }) => [{ type: 'Album', id: albumId }],
    }),
    createAlbum: build.mutation({
      query: ({ workspaceId, ...body }) => ({
        url: `/workspaces/${workspaceId}/albums`,
        method: 'POST',
        body,
      }),
      transformResponse: (r) => r?.album,
      invalidatesTags: ['Albums', 'Home'],
    }),
    updateAlbum: build.mutation({
      query: ({ workspaceId, albumId, ...body }) => ({
        url: `/workspaces/${workspaceId}/albums/${albumId}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (r) => r?.album,
      invalidatesTags: (_r, _e, { albumId }) => ['Albums', { type: 'Album', id: albumId }],
    }),
    deleteAlbum: build.mutation({
      query: ({ workspaceId, albumId }) => ({
        url: `/workspaces/${workspaceId}/albums/${albumId}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Albums', 'Home'],
    }),
    addAlbumItems: build.mutation({
      query: ({ workspaceId, albumId, document_ids }) => ({
        url: `/workspaces/${workspaceId}/albums/${albumId}/items`,
        method: 'POST',
        body: { document_ids },
      }),
      transformResponse: (r) => r?.added ?? 0,
      invalidatesTags: (_r, _e, { albumId }) => ['Albums', { type: 'Album', id: albumId }],
    }),
    removeAlbumItem: build.mutation({
      query: ({ workspaceId, albumId, documentId }) => ({
        url: `/workspaces/${workspaceId}/albums/${albumId}/items/${documentId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_r, _e, { albumId }) => ['Albums', { type: 'Album', id: albumId }],
    }),
  }),
})

export const {
  useGetAlbumsQuery,
  useGetAlbumQuery,
  useLazyGetAlbumQuery,
  useCreateAlbumMutation,
  useUpdateAlbumMutation,
  useDeleteAlbumMutation,
  useAddAlbumItemsMutation,
  useRemoveAlbumItemMutation,
} = albumsApi
