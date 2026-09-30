import { baseApi } from './baseApi'

/** AI keys are per user: /api/ai/keys (API contract section 6). The key itself is never returned. */
export const aiApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getAiKeys: build.query({
      query: () => '/ai/keys',
      transformResponse: (r) => r.keys ?? [],
      providesTags: ['AiKeys'],
    }),
    createAiKey: build.mutation({
      // { provider, api_key, label?, model?, base_url?, is_default? }
      query: (body) => ({ url: '/ai/keys', method: 'POST', body }),
      transformResponse: (r) => r.key,
      invalidatesTags: ['AiKeys'],
    }),
    deleteAiKey: build.mutation({
      query: (id) => ({ url: `/ai/keys/${id}`, method: 'DELETE' }),
      invalidatesTags: ['AiKeys'],
    }),
    testAiKey: build.mutation({
      // -> { ok, model, latency_ms }
      query: (id) => ({ url: `/ai/keys/${id}/test`, method: 'POST', body: {} }),
    }),
  }),
})

export const { useGetAiKeysQuery, useCreateAiKeyMutation, useDeleteAiKeyMutation, useTestAiKeyMutation } = aiApi
