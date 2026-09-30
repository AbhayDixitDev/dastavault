-- =============================================================================
-- DastaVault - 009_vault.sql
-- Chaabi (password keeper): per-user vault, encrypted items, item history,
-- one-time codes for PIN reset, and per-user AI provider keys.
-- Requires: 002_profiles_workspaces.sql (auth.users only)
--
-- Zero-knowledge summary (PRD 5.12):
--   * The browser generates a random 256-bit Vault Key.
--   * PIN Key = PBKDF2-SHA256(PIN, pin_salt, kdf_iterations). Vault Key is
--     wrapped with the PIN Key (AES-256-GCM) -> pin_wrapped_key.
--   * The Worker wraps the Vault Key with a per-user recovery key derived from
--     a Worker secret -> recovery_wrapped_key (enables email PIN reset).
--   * PIN Verifier = PBKDF2(PIN, pin_verifier_salt) hashed again server side ->
--     pin_verifier_hash. The server counts wrong attempts and locks the vault
--     (failed_attempts / locked_until) without ever seeing the PIN.
--   * Every item / history entry is AES-GCM ciphertext under the Vault Key.
--     Title and website stay in plain text so lists and search work.
-- All wrapped keys, blobs, salts and IVs are stored base64-encoded.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vaults (one per user)
-- -----------------------------------------------------------------------------
create table if not exists public.vaults (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null unique references auth.users(id) on delete cascade,
  pin_salt               text not null,
  pin_verifier_salt      text not null,
  pin_verifier_hash      text not null,
  kdf                    text not null default 'PBKDF2-SHA256' check (kdf in ('PBKDF2-SHA256','Argon2id')),
  kdf_iterations         integer not null default 600000 check (kdf_iterations >= 100000),
  pin_wrapped_key        text not null,                      -- AES-GCM(VaultKey) under PIN Key
  pin_wrapped_key_iv     text not null,
  recovery_wrapped_key   text,                               -- AES-GCM(VaultKey) under Worker recovery key; null in "No recovery" mode
  recovery_wrapped_key_iv text,
  recovery_enabled       boolean not null default true,      -- PW-13: false = "No recovery" mode
  failed_attempts        integer not null default 0 check (failed_attempts >= 0),
  locked_until           timestamptz,                        -- PW-5: 5 attempts, 30 s wait, doubling
  pin_length             integer not null default 6 check (pin_length between 4 and 6),
  last_unlocked_at       timestamptz,
  pin_changed_at         timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (not recovery_enabled or recovery_wrapped_key is not null)
);

create index if not exists vaults_locked_until_idx on public.vaults (locked_until) where locked_until is not null;

select public.ensure_updated_at_trigger('vaults');

-- -----------------------------------------------------------------------------
-- vault_items
-- -----------------------------------------------------------------------------
create table if not exists public.vault_items (
  id             uuid primary key default gen_random_uuid(),
  vault_id       uuid not null references public.vaults(id) on delete cascade,
  title          text not null,                              -- plain text (list + search)
  website        text,                                       -- plain text (list + search)
  category       text not null default 'other'
                 check (category in ('personal','banking','work','social','wifi','cards','other')),
  tags           text[] not null default '{}',
  is_favorite    boolean not null default false,
  encrypted_blob text not null,                              -- AES-GCM ciphertext of {username, password, notes, totp?}
  iv             text not null,
  strength       smallint check (strength is null or strength between 0 and 4),  -- client-computed, optional
  last_used_at   timestamptz,
  deleted_at     timestamptz,                                -- PW-17: trash, 30 days
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists vault_items_vault_id_idx    on public.vault_items (vault_id, deleted_at, updated_at desc);
create index if not exists vault_items_category_idx    on public.vault_items (vault_id, category);
create index if not exists vault_items_title_trgm_gin  on public.vault_items using gin (title gin_trgm_ops);
create index if not exists vault_items_website_trgm_gin on public.vault_items using gin (website gin_trgm_ops);

select public.ensure_updated_at_trigger('vault_items');

-- -----------------------------------------------------------------------------
-- vault_item_history (PW-8: every change keeps the old encrypted blob)
-- -----------------------------------------------------------------------------
create table if not exists public.vault_item_history (
  id             uuid primary key default gen_random_uuid(),
  vault_item_id  uuid not null references public.vault_items(id) on delete cascade,
  encrypted_blob text not null,
  iv             text not null,
  replaced_at    timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index if not exists vault_item_history_vault_item_id_idx
  on public.vault_item_history (vault_item_id, replaced_at desc);

-- -----------------------------------------------------------------------------
-- vault_otp_codes (PW-11: 6-digit code by email, 10 minutes, 5 attempts,
-- one active code at a time - the Worker consumes/expires older codes before
-- issuing a new one). Only the hash of the code is stored.
-- -----------------------------------------------------------------------------
create table if not exists public.vault_otp_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  code_hash   text not null,
  purpose     text not null default 'pin_reset' check (purpose in ('pin_reset','recovery_disable','export')),
  expires_at  timestamptz not null default (now() + interval '10 minutes'),
  attempts    integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists vault_otp_codes_user_id_idx on public.vault_otp_codes (user_id, purpose, created_at desc);
create index if not exists vault_otp_codes_active_idx
  on public.vault_otp_codes (user_id, purpose) where consumed_at is null;

-- -----------------------------------------------------------------------------
-- vault_activity_logs (PW-16: unlock, PIN change/reset, item added/changed/
-- deleted. Never contains the secret itself.)
-- -----------------------------------------------------------------------------
create table if not exists public.vault_activity_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  action     text not null check (action in (
               'vault_created','unlocked','unlock_failed','locked_out','pin_changed','pin_reset_requested',
               'pin_reset','recovery_disabled','recovery_enabled','item_added','item_changed',
               'item_deleted','item_restored','item_purged','history_deleted','exported','imported')),
  item_id    uuid references public.vault_items(id) on delete set null,
  metadata   jsonb not null default '{}'::jsonb,
  ip_hash    text,
  created_at timestamptz not null default now()
);

create index if not exists vault_activity_logs_user_id_idx on public.vault_activity_logs (user_id, created_at desc);
create index if not exists vault_activity_logs_item_id_idx on public.vault_activity_logs (item_id);

-- -----------------------------------------------------------------------------
-- ai_provider_keys (ASK-5: user's own API keys, encrypted, never logged)
-- The key is encrypted in the Worker with a server secret (AES-GCM) so the
-- Worker can use it for RAG calls; iv stored alongside.
-- -----------------------------------------------------------------------------
create table if not exists public.ai_provider_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  provider      text not null check (provider in ('openai','gemini','anthropic','groq','local','custom')),
  label         text,
  encrypted_key text not null,
  iv            text not null,
  model         text,                                        -- preferred model id for this provider
  base_url      text,                                        -- for 'local' / 'custom'
  is_default    boolean not null default false,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists ai_provider_keys_user_id_idx on public.ai_provider_keys (user_id);
create unique index if not exists ai_provider_keys_one_default
  on public.ai_provider_keys (user_id) where is_default;

select public.ensure_updated_at_trigger('ai_provider_keys');
