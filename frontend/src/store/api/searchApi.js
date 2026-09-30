import { baseApi } from './baseApi'

/** Query-string keys the search endpoints understand (contract section 4). */
export const SEARCH_FILTER_KEYS = [
  'person_id',
  'group_id',
  'document_type',
  'tag',
  'date_from',
  'date_to',
  'expiry_from',
  'expiry_to',
  'uploaded_by',
  'file_type',
]

/** Keeps only the known filter keys with non-empty values. */
export function cleanFilters(filters = {}) {
  const out = {}
  for (const k of SEARCH_FILTER_KEYS) {
    const v = filters[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') out[k] = v
  }
  return out
}

function toQuery(params) {
  const usp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') usp.set(k, v)
  })
  const s = usp.toString()
  return s ? `?${s}` : ''
}

const emptySearch = { results: [], resolved: {}, next_cursor: null }

function normaliseSearch(r) {
  return {
    results: Array.isArray(r?.results) ? r.results : [],
    resolved: r?.resolved ?? {},
    next_cursor: r?.next_cursor ?? null,
  }
}

export const searchApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /** GET /search - fast keyword search. */
    search: build.query({
      query: ({ workspaceId, q, limit, ...filters }) =>
        `/workspaces/${workspaceId}/search${toQuery({ q, limit, ...cleanFilters(filters) })}`,
      transformResponse: normaliseSearch,
      providesTags: ['Search'],
    }),
    /** POST /search/hybrid - keyword + meaning, fused. */
    hybridSearch: build.mutation({
      query: ({ workspaceId, q, embedding, filters, limit }) => ({
        url: `/workspaces/${workspaceId}/search/hybrid`,
        method: 'POST',
        body: { q, embedding: embedding ?? undefined, filters: cleanFilters(filters), limit },
      }),
      transformResponse: normaliseSearch,
    }),
    /** POST /search/image - find documents that look like a photo. */
    imageSearch: build.mutation({
      query: ({ workspaceId, perceptual_hash, text_sample, embedding }) => ({
        url: `/workspaces/${workspaceId}/search/image`,
        method: 'POST',
        body: {
          perceptual_hash: perceptual_hash || undefined,
          text_sample: text_sample || undefined,
          embedding: embedding || undefined,
        },
      }),
      transformResponse: normaliseSearch,
    }),
    /** GET /search/suggest?q= */
    suggest: build.query({
      query: ({ workspaceId, q }) => `/workspaces/${workspaceId}/search/suggest${toQuery({ q })}`,
      transformResponse: (r) => ({
        people: r?.people ?? [],
        tags: r?.tags ?? [],
        types: r?.types ?? [],
        recent: r?.recent ?? [],
      }),
      keepUnusedDataFor: 30,
    }),
    getSavedSearches: build.query({
      query: (workspaceId) => `/workspaces/${workspaceId}/search/saved`,
      transformResponse: (r) => r?.searches ?? [],
      providesTags: (_r, _e, workspaceId) => [{ type: 'SavedSearches', id: workspaceId }],
    }),
    createSavedSearch: build.mutation({
      query: ({ workspaceId, name, query, filters }) => ({
        url: `/workspaces/${workspaceId}/search/saved`,
        method: 'POST',
        body: { name, query, filters: cleanFilters(filters) },
      }),
      transformResponse: (r) => r?.search,
      invalidatesTags: (_r, _e, { workspaceId }) => [{ type: 'SavedSearches', id: workspaceId }],
    }),
    deleteSavedSearch: build.mutation({
      query: ({ workspaceId, id }) => ({
        url: `/workspaces/${workspaceId}/search/saved/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_r, _e, { workspaceId }) => [{ type: 'SavedSearches', id: workspaceId }],
    }),
    /** GET /files/:id/url - short-lived signed URL for thumbnails and covers. */
    getFileUrl: build.query({
      query: ({ workspaceId, fileId, download }) =>
        `/workspaces/${workspaceId}/files/${fileId}/url${download ? '?download=1' : ''}`,
      transformResponse: (r) => r?.url ?? null,
      keepUnusedDataFor: 240,
    }),
    /** GET /documents (already implemented) - used by pickers so they work before search ships. */
    pickDocuments: build.query({
      query: ({ workspaceId, q, limit = 30, ...filters }) =>
        `/workspaces/${workspaceId}/documents${toQuery({ q, limit, ...filters })}`,
      transformResponse: (r) => ({ documents: r?.documents ?? [], next_cursor: r?.next_cursor ?? null }),
      providesTags: ['Documents'],
    }),
    /** GET /tags - for the Tags filter chip. */
    getTagList: build.query({
      query: (workspaceId) => `/workspaces/${workspaceId}/tags`,
      transformResponse: (r) => r?.tags ?? [],
      providesTags: ['Tags'],
    }),
  }),
})

export const EMPTY_SEARCH = emptySearch

export const {
  useSearchQuery,
  useLazySearchQuery,
  useHybridSearchMutation,
  useImageSearchMutation,
  useSuggestQuery,
  useGetSavedSearchesQuery,
  useCreateSavedSearchMutation,
  useDeleteSavedSearchMutation,
  useGetFileUrlQuery,
  usePickDocumentsQuery,
  useLazyPickDocumentsQuery,
  useGetTagListQuery,
} = searchApi
