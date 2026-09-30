import { baseApi } from './baseApi'

/**
 * Chaabi vault endpoints. The vault is per user (no workspace in the path).
 * Field names match worker/src/routes/vault.js exactly.
 */
export const vaultApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getVault: build.query({
      query: () => '/vault',
      transformResponse: (r) => r.vault ?? null,
      providesTags: ['Vault'],
    }),
    setupVault: build.mutation({
      // body: { pin_salt, pin_verifier_salt, pin_verifier_hash, kdf, kdf_iterations, pin_wrapped_key, wrap_iv, pin_length, recovery_enabled, vault_key }
      query: (body) => ({ url: '/vault/setup', method: 'POST', body }),
      transformResponse: (r) => r.vault,
      invalidatesTags: ['Vault'],
    }),
    unlockVault: build.mutation({
      // body: { pin_verifier_hash } -> { pin_salt, kdf, kdf_iterations, pin_wrapped_key, wrap_iv }
      query: (body) => ({ url: '/vault/unlock', method: 'POST', body }),
      invalidatesTags: ['Vault'],
    }),
    changePin: build.mutation({
      // body: { current_pin_verifier_hash, ...new pin fields }
      query: (body) => ({ url: '/vault/change-pin', method: 'POST', body }),
      transformResponse: (r) => r.vault,
      invalidatesTags: ['Vault'],
    }),
    forgotPinRequest: build.mutation({
      query: () => ({ url: '/vault/forgot-pin/request', method: 'POST', body: {} }),
    }),
    forgotPinVerify: build.mutation({
      // { code } -> { vault_key, reset_token, expires_in }
      query: (body) => ({ url: '/vault/forgot-pin/verify', method: 'POST', body }),
    }),
    forgotPinComplete: build.mutation({
      // { reset_token, ...new pin fields }
      query: (body) => ({ url: '/vault/forgot-pin/complete', method: 'POST', body }),
      transformResponse: (r) => r.vault,
      invalidatesTags: ['Vault'],
    }),

    /* ---------- items ---------- */
    getVaultItems: build.query({
      query: (params = {}) => {
        const qs = new URLSearchParams()
        if (params.q) qs.set('q', params.q)
        if (params.category) qs.set('category', params.category)
        if (params.favorite) qs.set('favorite', '1')
        const s = qs.toString()
        return `/vault/items${s ? `?${s}` : ''}`
      },
      transformResponse: (r) => r.items ?? [],
      providesTags: ['VaultItems'],
    }),
    getVaultItem: build.query({
      query: (id) => `/vault/items/${id}`,
      transformResponse: (r) => r.item,
      providesTags: (_r, _e, id) => [{ type: 'VaultItems', id }],
    }),
    createVaultItem: build.mutation({
      query: (body) => ({ url: '/vault/items', method: 'POST', body }),
      transformResponse: (r) => r.item,
      invalidatesTags: ['VaultItems'],
    }),
    updateVaultItem: build.mutation({
      query: ({ id, ...body }) => ({ url: `/vault/items/${id}`, method: 'PATCH', body }),
      transformResponse: (r) => r.item,
      invalidatesTags: (_r, _e, { id }) => ['VaultItems', { type: 'VaultItems', id }, { type: 'VaultItems', id: `history-${id}` }],
    }),
    deleteVaultItem: build.mutation({
      query: ({ id, purge = false }) => ({ url: `/vault/items/${id}${purge ? '?purge=1' : ''}`, method: 'DELETE' }),
      invalidatesTags: ['VaultItems'],
    }),
    restoreVaultItem: build.mutation({
      query: (id) => ({ url: `/vault/items/${id}/restore`, method: 'POST', body: {} }),
      invalidatesTags: ['VaultItems'],
    }),
    getVaultTrash: build.query({
      query: () => '/vault/items/trash',
      transformResponse: (r) => r.items ?? [],
      providesTags: ['VaultItems'],
    }),

    /* ---------- history ---------- */
    getVaultItemHistory: build.query({
      query: (id) => `/vault/items/${id}/history`,
      transformResponse: (r) => r.history ?? [],
      providesTags: (_r, _e, id) => [{ type: 'VaultItems', id: `history-${id}` }],
    }),
    deleteVaultHistoryEntry: build.mutation({
      query: ({ id, hid }) => ({ url: `/vault/items/${id}/history/${hid}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'VaultItems', id: `history-${id}` }],
    }),
  }),
})

export const {
  useGetVaultQuery,
  useSetupVaultMutation,
  useUnlockVaultMutation,
  useChangePinMutation,
  useForgotPinRequestMutation,
  useForgotPinVerifyMutation,
  useForgotPinCompleteMutation,
  useGetVaultItemsQuery,
  useGetVaultItemQuery,
  useLazyGetVaultItemQuery,
  useCreateVaultItemMutation,
  useUpdateVaultItemMutation,
  useDeleteVaultItemMutation,
  useRestoreVaultItemMutation,
  useGetVaultTrashQuery,
  useGetVaultItemHistoryQuery,
  useDeleteVaultHistoryEntryMutation,
} = vaultApi
