# DastaVault API (Cloudflare Worker)

Hono + plain JavaScript (ESM) Worker that fronts Supabase (Postgres via PostgREST, service role) and a private R2 bucket.
Every request is authenticated with the Supabase JWT, every workspace route checks membership and role, and files are
only ever served through short-lived HMAC-signed URLs.

## Layout

```
worker/
  wrangler.jsonc         name, R2 binding, vars, cron trigger
  .dev.vars.example      secrets template (copy to .dev.vars)
  src/index.js           app: request id, secure headers, CORS, error handler, route mounts, scheduled()
  src/lib/               auth (jose), workspace/role middleware, validation (zod), email (Brevo),
                         signing (HMAC), mime sniffing, vault crypto (HKDF + AES-GCM), rate limit, pagination
  src/routes/            one file per module (see route map)
  scripts/check.js       `node --check` over every file
```

## Setup

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars   # fill in the secrets
npm run dev                       # http://localhost:8787
```

Requirements: Node 20+, a Supabase project with the migrations from `../database/migrations` applied, and an R2 bucket
named `document-manager-files` (`wrangler r2 bucket create document-manager-files`).

### Secrets

| Name | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes | Project URL. Also used to fetch `/auth/v1/.well-known/jwks.json` for JWT verification. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service-role key. The Worker does its own auth/role checks before every query. |
| `SUPABASE_JWT_SECRET` | no | Only for legacy projects issuing HS256 access tokens. New projects use ES256/RS256 via JWKS. |
| `FILE_URL_SIGNING_SECRET` | yes | HMAC key for signed file URLs (5 minute TTL). |
| `VAULT_RECOVERY_SECRET` | yes | Root secret for Chaabi PIN recovery (per-user key via HKDF). Rotating it breaks recovery for existing vaults. |
| `BREVO_API_KEY` | no | Transactional email. When missing, emails are skipped with a `console.warn`. |
| `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` | no | Sender identity for Brevo. |

Production: `wrangler secret put NAME` for each. Non-secret vars (`ALLOWED_ORIGINS`, `APP_URL`) live in `wrangler.jsonc`;
override per environment there. `ALLOWED_ORIGINS` is a comma-separated list.

### Run / deploy

| Command | What |
|---|---|
| `npm run dev` | Local dev on `http://localhost:8787` with `.dev.vars` |
| `npm run check` | Syntax-check every file |
| `npm run deploy` | `wrangler deploy` |
| `npm run tail` | Live logs |

The cron trigger (`0 */6 * * *`) runs `scheduled()` which does a tiny `select` on `roles` so the free-tier Supabase project
is not paused for inactivity. Test locally with `curl "http://localhost:8787/__scheduled?cron=0+*/6+*+*+*"` (requires
`wrangler dev --test-scheduled`).

## Conventions

- **Auth**: `Authorization: Bearer <supabase access token>`. `aud` must be `authenticated`. User id always comes from the token.
- **Workspace routes** (`/api/workspaces/:ws/...`): membership is loaded from `workspace_members`; 404 if the workspace is
  missing/soft-deleted, 403 if not a member or the role is too low. Role ranks: restricted 10 < viewer 20 < editor 30 < admin 40 < owner 50.
- **Responses**: success is a JSON object with the resource under a named key (`{ profile }`, `{ workspaces }`, ...).
  Errors are `{ error, code?, details?, request_id }` with the proper status. Every response carries `X-Request-Id`.
- **Pagination**: `?limit=&cursor=` and responses return `next_cursor` (null when done).
- **Unbuilt routes** respond `501 { error: "Not implemented yet", code: "not_implemented" }` but already enforce role checks.

## Route map

Legend: **min role** for workspace routes. `auth` = any signed-in user. `sig` = HMAC signature in the URL.

### Core

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/health` | public | `{ ok, time, request_id }` |
| GET | `/api/me` | auth | `{ profile }` (created from the token on first call) |
| PATCH | `/api/me` | auth | `{ display_name, avatar_url, locale, large_text }` -> `{ profile }` |
| GET | `/api/notifications` | auth | `?unread=1&workspace_id=&limit=&cursor=` -> `{ items, next_cursor, unread_count }` |
| PATCH | `/api/notifications/read-all` | auth | `{ ok }` |
| PATCH | `/api/notifications/:id/read` | auth | `{ notification }` |

### Workspaces

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/workspaces` | auth | `{ workspaces: [ { ...workspace, role_key, terminology } ] }` |
| POST | `/api/workspaces` | auth | `{ name, kind, icon?, default_visibility?, settings?, terminology? }` -> `{ workspace }` (owner). Sets `owner_id`; DB trigger seeds membership + terminology, overrides are upserted. |
| GET | `/api/workspaces/:ws` | member | `{ workspace: { ..., role_key, terminology, member_count } }` |
| PATCH | `/api/workspaces/:ws` | admin | `{ name, icon, default_visibility, settings }` -> `{ workspace }` |
| DELETE | `/api/workspaces/:ws` | owner | soft delete (`deleted_at`) -> `{ ok }` |
| GET | `/api/workspaces/:ws/terminology` | member | `{ terminology }` |
| PUT | `/api/workspaces/:ws/terminology` | admin | partial labels -> `{ terminology }` |

### Members and invites

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/workspaces/:ws/members` | member | `{ members: [ { id, user_id, role_key, joined_at, person_id, profile } ] }` |
| PATCH | `/api/workspaces/:ws/members/:memberId` | admin | `{ role_key }` -> `{ member }`. Only owners touch the owner role; last owner cannot be demoted. |
| DELETE | `/api/workspaces/:ws/members/:memberId` | admin | owners cannot be removed; only owners remove admins -> `{ ok }` |
| POST | `/api/workspaces/:ws/invites` | admin | `{ email, role_key }` -> `{ invite }` (7 day expiry, Brevo email with `${APP_URL}/invite/${token}`) |
| GET | `/api/workspaces/:ws/invites` | admin | pending invites -> `{ invites }` |
| DELETE | `/api/workspaces/:ws/invites/:inviteId` | admin | marks `status='revoked'` -> `{ ok }` |
| GET | `/api/invites/:token` | auth | `{ invite: { email, role_key, workspace: {id,name,kind}, status, expires_at, accepted_at, expired } }` |
| POST | `/api/invites/:token/accept` | auth | email must match the signed-in user -> `{ workspace_id }` |

### Groups and people

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/workspaces/:ws/groups` | member | `{ groups: [ { ..., parent, member_count } ] }` |
| POST | `/api/workspaces/:ws/groups` | editor | `{ name, description?, color?, parent_group_id? }` -> `{ group }` (two levels max) |
| GET | `/api/workspaces/:ws/groups/:gid` | member | `{ group: { ..., parent, children, people } }` |
| PATCH | `/api/workspaces/:ws/groups/:gid` | editor | `{ group }` |
| DELETE | `/api/workspaces/:ws/groups/:gid` | admin | subgroups are re-parented -> `{ ok }` |
| GET | `/api/workspaces/:ws/people` | member | `?q=&group_id=&deleted=1` -> `{ people: [ { ..., groups } ] }` |
| POST | `/api/workspaces/:ws/people` | editor | person fields + `group_ids?` -> `{ person }` |
| GET | `/api/workspaces/:ws/people/:pid` | member | `{ person: { ..., groups, relationships } }` |
| PATCH | `/api/workspaces/:ws/people/:pid` | editor | `{ person }` |
| DELETE | `/api/workspaces/:ws/people/:pid` | editor | soft delete -> `{ ok }` |
| POST | `/api/workspaces/:ws/people/:pid/restore` | editor | `{ person }` |
| GET | `/api/workspaces/:ws/people/:pid/relationships` | member | `{ relationships }` |
| POST | `/api/workspaces/:ws/people/:pid/relationships` | editor | `{ to_person_id, relation, custom_label? }` -> `{ relationship }`. Stores the inverse when unambiguous (father/mother/parent -> child, child/son/daughter -> parent, spouse <-> spouse, grandparent <-> grandchild, guardian <-> ward, manager <-> reports_to). brother/sister/sibling/custom store no inverse. |
| DELETE | `/api/workspaces/:ws/people/:pid/relationships/:rid` | editor | also deletes the stored inverse -> `{ ok }` |
| POST | `/api/workspaces/:ws/people/:pid/groups` | editor | `{ group_id, role_in_group? }` -> `{ ok }` |
| DELETE | `/api/workspaces/:ws/people/:pid/groups/:groupId` | editor | `{ ok }` |

### Documents and files

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/api/workspaces/:ws/uploads` | editor | multipart: `file` (<= 25 MB), `title?`, `document_id?`, `new_version?=1`, `page_number?`, `kind?`, `sha256?`, `visibility?`, `person_id?` -> `{ document, version, files, file }`. Magic-byte MIME check (jpeg/png/webp/gif/heic/pdf, txt/md/csv, docx/xlsx). R2 key `workspaces/{ws}/documents/{docId}/versions/{verId}/{kind}/{fileId}.{ext}` |
| GET | `/api/workspaces/:ws/documents` | member | `?q=&person_id=&sort=&order=&limit=&cursor=` -> `{ documents, next_cursor }` (current-version files attached) |
| GET | `/api/workspaces/:ws/documents/trash` | editor | `{ documents, next_cursor }` |
| GET | `/api/workspaces/:ws/documents/:id` | member | `{ document: { ..., versions, files } }` |
| PATCH | `/api/workspaces/:ws/documents/:id` | editor | `{ title, description, doc_type, visibility, person_id }` -> `{ document }` |
| DELETE | `/api/workspaces/:ws/documents/:id` | editor | soft delete (editors only their own; admins any) -> `{ ok }` |
| POST | `/api/workspaces/:ws/documents/:id/restore` | editor | `{ document }` |
| DELETE | `/api/workspaces/:ws/documents/:id/purge` | admin | permanent (R2 objects + rows), only from trash -> `{ ok }` |
| GET | `/api/workspaces/:ws/files/:fileId/url` | member | `?download=1` -> `{ url, expires_at, file_id, mime_type, size_bytes }` (5 minute signed URL) |
| GET | `/api/files/:fileId?exp=&sig=[&download=1]` | sig | streams from R2 with `Content-Type`, `ETag`, `Cache-Control: private, max-age=300`, Range support |
| * | `/api/workspaces/:ws/documents/:id/versions[...]` | editor/admin | 501 skeleton (Phase 7) |

Visibility: editors and above see all workspace documents; viewers see everything except others' `private` uploads;
restricted members only see documents they uploaded or that are linked to their own person.

### Chaabi (password vault)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/vault` | auth | `{ vault: null \| { recovery_enabled, locked_until, failed_attempts, kdf, kdf_iterations } }` |
| POST | `/api/vault/setup` | auth | `{ pin_salt, pin_verifier_salt, pin_verifier_hash, kdf?, kdf_iterations?, pin_wrapped_key, wrap_iv, recovery_enabled?, vault_key? }` -> `{ vault }` |
| POST | `/api/vault/unlock` | auth, rate limited | `{ pin_verifier_hash }` -> `{ pin_salt, kdf, kdf_iterations, pin_wrapped_key, wrap_iv }` |
| POST | `/api/vault/change-pin` | auth | `{ current_pin_verifier_hash, ...new kdf fields, pin_wrapped_key, wrap_iv }` -> `{ vault }` |
| POST | `/api/vault/forgot-pin/request` | auth, rate limited | emails a 6-digit code -> `{ ok, sent_to, expires_at }` |
| POST | `/api/vault/forgot-pin/verify` | auth, rate limited | `{ code }` -> `{ vault_key, reset_token, expires_in }` |
| POST | `/api/vault/forgot-pin/complete` | auth | `{ reset_token, ...new kdf fields, pin_wrapped_key, wrap_iv }` -> `{ vault }` |
| GET | `/api/vault/items` | auth | `?q=&category=&favorite=1` -> `{ items }` |
| POST | `/api/vault/items` | auth | `{ title, website?, category?, is_favorite?, encrypted_blob, iv }` -> `{ item }` |
| GET | `/api/vault/items/trash` | auth | `{ items }` |
| GET | `/api/vault/items/:id` | auth | `{ item }` |
| PATCH | `/api/vault/items/:id` | auth | a new `encrypted_blob` moves the old blob to history -> `{ item }` |
| POST | `/api/vault/items/:id/restore` | auth | `{ item }` |
| DELETE | `/api/vault/items/:id` | auth | soft delete; `?purge=1` deletes permanently -> `{ ok }` |
| GET | `/api/vault/items/:id/history` | auth | `{ history }` |
| DELETE | `/api/vault/items/:id/history/:hid` | auth | `{ ok }` |

#### Chaabi flows

Server-side rules: the PIN never leaves the device; the server stores `pin_verifier_hash` (PBKDF2 of the PIN with its own
salt) only to count wrong attempts. Lockout: 5 wrong verifiers -> 30 s, doubling on each further lockout (cap 24 h); a
correct PIN resets it. Everything is logged to `activity_logs` with `workspace_id = NULL` (never the secrets).

1. **Setup** - browser generates the Vault Key, derives PIN Key and PIN Verifier, wraps the Vault Key (`pin_wrapped_key`
   + `wrap_iv`) and sends them with the raw `vault_key` (base64, over TLS, once). The Worker wraps that key with
   AES-256-GCM under a per-user key `HKDF(VAULT_RECOVERY_SECRET, info="user:<id>")` and stores `recovery_wrapped_key`.
   With `recovery_enabled: false` ("No recovery" mode) no `vault_key` is sent and PIN reset is impossible.
2. **Unlock** - client sends the verifier; on success it receives `pin_salt`, `kdf`, `kdf_iterations`, `pin_wrapped_key`,
   `wrap_iv` and unwraps the Vault Key locally.
3. **Change PIN** - requires the current verifier; the client re-wraps the Vault Key with the new PIN Key and sends the new
   salts, verifier and wrapped key in one call.
4. **Forgot PIN** - `request` emails a 6-digit code (sha256 stored, 10 min, one active code, 5 attempts). `verify`
   consumes the code, unwraps the recovery copy and returns the raw `vault_key` plus a 5-minute signed `reset_token`.
   The client re-wraps the key with the new PIN and calls `complete` with the token, new salts, verifier and wrapped key.
   All passwords are kept.

### Activity and skeletons

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/workspaces/:ws/activity` | member | `?limit=&cursor=&entity_type=&entity_id=&action=` -> `{ items, next_cursor }` (actor profile attached) |
| GET/POST | `/api/workspaces/:ws/search[/semantic\|/saved]` | member | 501 (Phase 5/6) |
| * | `/api/workspaces/:ws/albums[...]` | member/editor | 501 (Phase 7) |
| * | `/api/workspaces/:ws/reminders[...]` | member/editor | 501 (Phase 7) |
| * | `/api/workspaces/:ws/shares[...]`, `/api/shares/:token` | editor / public | 501 (Phase 7) |
| POST | `/api/workspaces/:ws/rag/ask`, `/rag/index/:docId` | viewer / editor | 501 (Phase 8) |
| * | `/api/workspaces/:ws/notes[...]` | member/editor | 501 (Phase 9) |

## Columns this worker expects (Phase 2+ tables)

The Phase 1 tables follow the migrations exactly. For the tables still being finalised, the worker reads/writes these columns:

- `documents`: `id, workspace_id, title, description, doc_type, visibility, person_id, current_version_id, created_by, created_at, updated_at, deleted_at, deleted_by`
- `document_versions`: `id, document_id, workspace_id, version_number, label, created_by, created_at`
- `document_files`: `id, document_id, version_id, workspace_id, r2_object_key, original_filename, mime_type, size_bytes, sha256, page_number, kind, width, height, created_by, created_at`
- `vaults`: `id, user_id (unique), pin_salt, pin_verifier_salt, pin_verifier_hash, kdf, kdf_iterations, pin_wrapped_key, wrap_iv, recovery_wrapped_key, recovery_enabled, failed_attempts, lockout_level, locked_until, created_at, updated_at`
- `vault_items`: `id, vault_id, user_id, title, website, category, is_favorite, encrypted_blob, iv, created_at, updated_at, deleted_at`
- `vault_item_history`: `id, vault_item_id, vault_id, encrypted_blob, iv, replaced_at`
- `vault_otp_codes`: `id, vault_id, user_id, code_hash, expires_at, attempts, used_at, created_at`
- `activity_logs.workspace_id` must be nullable (vault events have no workspace).
- `person_groups` needs a unique key on `(person_id, group_id)` (used by upsert).

## Security notes

- R2 is private; the only read path is `GET /api/files/:fileId` with a valid HMAC (`file:<id>:<exp>`), 5 minute TTL.
- Object keys are ids; filenames are sanitised and stored only as metadata. MIME is decided by magic bytes.
- `secureHeaders` sets CSP (`default-src 'none'`), HSTS, `nosniff`, Referrer-Policy and Permissions-Policy on every response.
- Rate limiting (`src/lib/rateLimit.js`) is an in-memory, per-isolate, best-effort limiter for OTP and PIN routes. The
  authoritative protection is the DB-backed lockout. Move to a Durable Object / Rate Limiting binding when a global
  guarantee is required.
- Secrets are only read from Wrangler secrets / `.dev.vars`; nothing sensitive is logged (request logs print method, path,
  status and duration only).
