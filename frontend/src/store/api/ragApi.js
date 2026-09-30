import { baseApi } from './baseApi'

/**
 * "Ask your documents" endpoints (contract section 6).
 * The AI keys list is read here only to know whether asking is possible;
 * managing keys lives in the Settings > AI panel (vault-notes agent, aiApi.js).
 * Endpoint names are prefixed to avoid clashing with aiApi.js.
 */
export const ragApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    askDocuments: build.mutation({
      query: ({ workspaceId, question, embedding, document_id, key_id, history }) => ({
        url: `/workspaces/${workspaceId}/rag/ask`,
        method: 'POST',
        body: {
          question,
          embedding: embedding || undefined,
          document_id: document_id || undefined,
          key_id: key_id || undefined,
          history: history?.length ? history : undefined,
        },
      }),
      transformResponse: (r) => ({
        answer: r?.answer ?? '',
        not_found: Boolean(r?.not_found),
        sources: Array.isArray(r?.sources) ? r.sources : [],
        provider: r?.provider ?? null,
        model: r?.model ?? null,
      }),
    }),
    /** GET /api/ai/keys - status only (never returns the key itself). */
    getAskKeyStatus: build.query({
      query: () => `/ai/keys`,
      transformResponse: (r) => {
        const keys = Array.isArray(r?.keys) ? r.keys : []
        return { hasKey: keys.length > 0, keys }
      },
      providesTags: ['AiKeys'],
    }),
  }),
})

export const { useAskDocumentsMutation, useGetAskKeyStatusQuery } = ragApi
