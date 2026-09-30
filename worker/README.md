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
                         signing (HMAC), mime sniffing, vault crypto + aiCrypto (HKDF + AES-GCM), rate limit,
                         pagination, docs (document helpers + visibility gate), uploadFiles (multipart/R2/version
                         helpers), metadata (suggestions + confirmed metadata), queryUnderstanding, searchResults
                         (enrichment + RRF), sanitize (HTML), reminderCron, ai/ (openai, gemini, anthropic; fetch only)
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

The cron trigger (`0 */6 * * *`) runs `scheduled()` which (1) does a tiny `select` on `roles` so the free-tier Supabase
project is not paused for inactivity and (2) sends due reminders (`lib/reminderCron.js`: reminders with status
pending/snoozed and `remind_at <= now` -> `notifications` rows for the recipients and Brevo emails, then `status='sent'`).
Test locally with `curl "http://localhost:8787/__scheduled?cron=0+*/6+*+*+*"` (requires `wrangler dev --test-scheduled`).

## Conventions

- **Auth**: `Authorization: Bearer <supabase access token>`. `aud` must be `authenticated`. User id always comes from the token.
- **Workspace routes** (`/api/workspaces/:ws/...`): membership is loaded from `workspace_members`; 404 if the workspace is
  missing/soft-deleted, 403 if not a member or the role is too low. Role ranks: restricted 10 < viewer 20 < editor 30 < admin 40 < owner 50.
- **Responses**: success is a JSON object with the resource under a named key (`{ profile }`, `{ workspaces }`, ...).
  Errors are `{ error, code?, details?, request_id }` with the proper status. Every response carries `X-Request-Id`.
- **Pagination**: `?limit=&cursor=` and responses return `next_cursor` (null when done).
- **Contract**: request/response shapes follow `../docs/API_CONTRACT.md` (sections 1-9). Deviations are listed at the end of this file.

## Route map

Legend: **min role** for workspace routes. `auth` = any signed-in user. `sig` = HMAC signature in the URL.

### Core

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/health` | public | `{ ok, time, request_id }` |
| GET | `/api/me` | auth | `{ profile }` (created from the token on first call) |
| PATCH | `/api/me` | auth | `{ display_name, avatar_key, preferred_language (alias: locale), large_text, settings }` -> `{ profile }` |
| GET | `/api/notifications` | auth | `?unread=1&workspace_id=&limit=&cursor=` -> `{ items, next_cursor, unread_count }` |
| PATCH | `/api/notifications/read-all` | auth | `{ ok }` |
| PATCH | `/api/notifications/:id/read` | auth | `{ notification }` |

### Workspaces

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/workspaces` | auth | `{ workspaces: [ { ...workspace, role_key, terminology } ] }` |
| POST | `/api/workspaces` | auth | `{ name, kind, icon?, default_visibility?, features?, ocr_languages?, terminology? }` -> `{ workspace }` (owner). Sets `owner_id`; the DB trigger seeds membership + terminology, overrides are upserted. |
| GET | `/api/workspaces/:ws` | member | `{ workspace: { ..., role_key, terminology, member_count } }` |
| PATCH | `/api/workspaces/:ws` | admin | `{ name, icon, default_visibility, features, ocr_languages }` -> `{ workspace }` |
| DELETE | `/api/workspaces/:ws` | owner | soft delete (`deleted_at`) -> `{ ok }` |
| GET | `/api/workspaces/:ws/terminology` | member | `{ terminology }` |
| PUT | `/api/workspaces/:ws/terminology` | admin | partial labels -> `{ terminology }` |

### Members and invites

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/workspaces/:ws/members` | member | `{ members: [ { id, user_id, role_key, joined_at, person_id, profile } ] }` (`person_id` comes from `people.user_id`) |
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
| POST | `/api/workspaces/:ws/groups` | editor | `{ name, description?, icon?, color?, position?, parent_group_id? }` -> `{ group }` (two levels max; names unique per parent) |
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
| POST | `/api/workspaces/:ws/people/:pid/relationships` | editor | `{ to_person_id, relation, custom_label? }` -> `{ relationship }`. Relations: father, mother, parent, child, son, daughter, spouse, brother, sister, grandparent, grandchild, guardian, manager, reports_to, custom. Stores the inverse when unambiguous (father/mother/parent -> child, child/son/daughter -> parent, spouse <-> spouse, grandparent <-> grandchild, manager <-> reports_to). brother/sister/guardian/custom store no inverse. |
| DELETE | `/api/workspaces/:ws/people/:pid/relationships/:rid` | editor | also deletes the stored inverse -> `{ ok }` |
| POST | `/api/workspaces/:ws/people/:pid/groups` | editor | `{ group_id, role_in_group? }` -> `{ ok }` |
| DELETE | `/api/workspaces/:ws/people/:pid/groups/:groupId` | editor | `{ ok }` |

### Documents and files

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/api/workspaces/:ws/uploads` | editor | multipart: `files[]` (1..20, <= 25 MB each; `file` still accepted), `name?` (alias `title`), `document_id?`, `new_version?=1`, `page_number?` / `page_numbers[]?`, `kind?`, `sha256?` / `sha256[]?`, `visibility?`, `person_id?` / `person_ids?` (json array), `group_ids?`, `document_type?`, `perceptual_hash?`, `client_upload_id?` (uuid, idempotent via `upload_sessions`) -> `{ document, version, files, file }`. Magic-byte MIME check (jpeg/png/webp/gif/heic/pdf, txt/md/csv, docx/xlsx). Creates `documents` + `document_versions` (source upload, hash) + `document_files` + `document_pages`, links `document_people` / `document_groups`. R2 key `workspaces/{ws}/documents/{docId}/versions/{verId}/{kind}/{fileId}.{ext}` |
| GET | `/api/workspaces/:ws/documents` | member | `?q=&person_id=&group_id=&document_type=&favorite=1&sort=created_at\|updated_at\|name\|expiry_date&order=&limit=&cursor=` -> `{ documents, next_cursor }` (each with `files` of the current version, `people`, `groups`) |
| GET | `/api/workspaces/:ws/documents/trash` | editor | `{ documents, next_cursor }` |
| GET | `/api/workspaces/:ws/documents/:id` | member | `{ document: { ..., versions, files, people, groups } }` |
| PATCH | `/api/workspaces/:ws/documents/:id` | editor | `{ name, document_type, visibility, summary, organisation, document_number, issue_date, expiry_date, is_favorite, is_pinned, person_ids?, group_ids? }` -> `{ document }` (renames are kept in `previous_names`) |
| DELETE | `/api/workspaces/:ws/documents/:id` | editor | soft delete (editors only their own; admins any) -> `{ ok }` |
| POST | `/api/workspaces/:ws/documents/:id/restore` | editor | `{ document }` |
| DELETE | `/api/workspaces/:ws/documents/:id/purge` | admin | permanent (R2 objects + rows), only from trash -> `{ ok }` |
| GET | `/api/workspaces/:ws/files/:fileId/url` | member | `?download=1` -> `{ url, expires_at, file_id, mime_type, size_bytes }` (5 minute signed URL) |
| GET | `/api/files/:fileId?exp=&sig=[&download=1]` | sig | streams from R2 with `Content-Type`, `ETag`, `Cache-Control: private, max-age=300`, Range support |

### Versions, text, written documents (contract section 2)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/workspaces/:ws/documents/:id/versions` | member | `{ versions: [Version & { ocr_text, files }] }` |
| POST | `/api/workspaces/:ws/documents/:id/versions` | editor | multipart like `/uploads` + `comment?` -> `{ version, files }` (new version, previous kept, `current_version_id` updated, activity `version_uploaded`) |
| POST | `/api/workspaces/:ws/documents/:id/versions/:vid/restore` | editor | `{ comment? }` -> `{ version }` (new version `source=restore`; files are copied in R2, pages and text copied; chunks are not copied - re-run the pipeline) |
| POST | `/api/workspaces/:ws/documents/:id/versions/:vid/files` | editor | multipart `files[]`, `kind` (processed\|thumbnail\|pdf\|attachment), `page_numbers[]?` -> `{ files }` (thumbnails also set `document_pages.thumbnail_file_id`) |
| PUT | `/api/workspaces/:ws/documents/:id/text` | editor | `{ version_id, ocr_text, ocr_language, ocr_confidence, ocr_status, pages[] }` -> `{ ok }`. Updates `document_versions.ocr_*` (the DB trigger refreshes `search_text`), upserts `document_pages`, sets `status='ready'` + `page_count` |
| GET | `/api/workspaces/:ws/documents/:id/timeline` | member | `{ items: [{ id, action, message, actor: {id, display_name}, metadata, created_at }] }` from `activity_logs` |
| POST | `/api/workspaces/:ws/documents/written` | editor | `{ name, content_html, content_text, document_type?='written', person_ids?, group_ids? }` -> `{ document, version, files }`; HTML (sanitised) stored in R2 as kind `original` / `text/html`, text as `ocr_text` |
| PUT | `/api/workspaces/:ws/documents/:id/written` | editor | `{ content_html, content_text, comment? }` -> `{ version, files }` (new version, `source=edit`) |
| GET | `/api/workspaces/:ws/documents/:id/content` | member | `{ content_html, content_text, version_id }` (reads the HTML/text file of the current version back from R2) |

### Details, suggestions, tags, duplicates, chunks (contract section 3)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/workspaces/:ws/documents/:id/suggestions` | member | `{ suggestions: [{ id, key, value, confidence, source, accepted_at, status }] }` (`source` `rules` maps to the DB value `rule`) |
| PUT | `/api/workspaces/:ws/documents/:id/suggestions` | editor | `{ version_id?, suggestions[] }` replaces the set -> `{ suggestions }` |
| POST | `/api/workspaces/:ws/documents/:id/suggestions/:sid/accept` | editor | copies the value into `document_metadata` (+ mirrors well-known keys) -> `{ document, metadata }` |
| PATCH | `/api/workspaces/:ws/documents/:id/metadata` | editor | `{ fields: { key: value \| null } }` -> `{ metadata, document }`. Mirrors `document_type, organisation, document_number, issue_date, expiry_date, summary` to columns, `person_name`/`person_id` -> `document_people`, `group_id` -> `document_groups`, `suggested_name` -> rename |
| GET/POST | `/api/workspaces/:ws/tags` | member / editor | `{ tags: [{ id, name, color, document_count }] }` / `{ name, color? }` -> `{ tag }` (case-insensitive unique) |
| PATCH/DELETE | `/api/workspaces/:ws/tags/:id` | editor / admin | `{ tag }` / `{ ok }` |
| PUT | `/api/workspaces/:ws/documents/:id/tags` | editor | `{ tag_ids?, names? }` replaces the set (names created if missing) -> `{ tags }` |
| POST | `/api/workspaces/:ws/documents/check-duplicates` | member | `{ sha256?[], perceptual_hash?, document_number?, text_sample?, exclude_document_id? }` -> `{ matches: [{ document, reason, score }] }` (exact sha256 via `document_files`, dHash hamming <= 10 on `documents.perceptual_hash`, same number, pg_trgm text similarity via `similar_documents_by_text()` from migration 011) |
| PUT | `/api/workspaces/:ws/documents/:id/chunks` | editor | `{ version_id, embedding_model, embedding_version, dimension (384), chunks[] }` deletes the version's chunks, inserts in batches of 100 -> `{ count }` |
| GET | `/api/workspaces/:ws/documents/:id/chunks?version_id` | member | `{ chunks: [{ id, chunk_number, page_number, section, content }] }` |

### Search (contract section 4)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/workspaces/:ws/search` | member | `q, person_id, group_id, document_type, tag, date_from, date_to, expiry_from, expiry_to, uploaded_by, file_type, limit` -> `SearchResponse`. Query understanding (`lib/queryUnderstanding.js`: relation words via `people.user_id` + `person_relationships`, type synonyms, years/months, document numbers, people by trigram similarity) + `search_documents_fts()` + exact name/number matches; filters applied in SQL; RRF (k=60) then boosts (+0.05 exact name, +0.04 person, +0.04 number); notes matching `notes.search_text` are included with `kind:'note'`. Each hit carries `thumbnail_file_id`, `people`, `tags` (3 batched queries). Also records the query in `saved_searches` (`kind='recent'`) |
| POST | `/api/workspaces/:ws/search/hybrid` | member | `{ q, embedding?[384], filters?, limit? }` -> adds `search_chunks()` (vector) to the fusion |
| POST | `/api/workspaces/:ws/search/image` | member | `{ perceptual_hash?, text_sample?, embedding? }` -> hamming <= 10 matches boosted + text sample FTS + vector |
| GET | `/api/workspaces/:ws/search/suggest?q=` | member | `{ people, tags, types, recent }` |
| GET/POST | `/api/workspaces/:ws/search/saved` | member | `{ searches }` / `{ name, query, filters }` -> `{ search }` (per user) |
| DELETE | `/api/workspaces/:ws/search/saved/:id` | member | `{ ok }` |

### Albums, reminders, shares (contract section 5)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET/POST | `/api/workspaces/:ws/albums` | member / editor | `{ albums: [{ id, name, kind, description, cover_file_id, item_count, rules, created_at }] }` / `{ name, kind, description?, rules? }` -> `{ album }`. `rules` (`{ all: [{ field, op, value }] }`) is stored in `albums.rules` (migration 011) and evaluated live as one PostgREST query; `person_id`/`group_id`/`tag` rules resolve through the link tables (`.in('id', ids)`) |
| GET | `/api/workspaces/:ws/albums/:id?cursor&limit` | member | `{ album, documents, next_cursor }` |
| PATCH/DELETE | `/api/workspaces/:ws/albums/:id` | editor | `{ name?, description?, rules?, cover_file_id? }` -> `{ album }` / `{ ok }` |
| POST | `/api/workspaces/:ws/albums/:id/items` | editor | `{ document_ids }` -> `{ added }` (manual albums only) |
| DELETE | `/api/workspaces/:ws/albums/:id/items/:documentId` | editor | `{ ok }` |
| GET | `/api/workspaces/:ws/reminders?upcoming_days=30&document_id=` | member | `{ reminders: [{ id, document_id, document_name, title, remind_at, field, channel, status, created_at }] }` (`field` = `field_name`, `channel` app\|email\|both = `channels[]`) |
| GET | `/api/workspaces/:ws/reminders/expiring?days=30` | member | `{ documents: [Doc & { days_left }] }` |
| POST | `/api/workspaces/:ws/reminders` | editor | `{ document_id, title, remind_at, field?, channel? }` -> `{ reminder }` |
| PATCH/DELETE | `/api/workspaces/:ws/reminders/:id` | editor | `{ title?, remind_at?, status?, channel? }` -> `{ reminder }` / `{ ok }` |
| POST | `/api/workspaces/:ws/documents/:id/reminders/auto` | editor | creates the missing 30/7/1-day reminders for `expiry_date` (only future ones) -> `{ reminders }` |
| GET | `/api/workspaces/:ws/shares?document_id=` | member | `{ shares: [{ id, document_id, kind, target_id, token, url, expires_at, allow_download, has_password, views, created_at }] }` (non-admins see their own / shared-with-them) |
| POST | `/api/workspaces/:ws/shares` | editor | `{ document_id, kind, target_id?, expires_in_hours?=72, password?, allow_download? }` -> `{ share }` (`url = ${APP_URL}/s/${token}`; password stored as sha256(`token:password`); member shares also create a notification) |
| DELETE | `/api/workspaces/:ws/shares/:id` | editor | sets `revoked_at` -> `{ ok }` |
| GET | `/api/shares/:token` | public, rate limited | header `x-share-password?` -> `{ document: { id, name, document_type, page_count }, files: [{ id, kind, page_number, mime_type, url, download_url? }], allow_download }`; 401 `{ code: 'password_required' }`, 410 when expired. File URLs are signed for 15 minutes; `view_count` incremented |

### AI keys and Ask your documents (contract section 6)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET/POST | `/api/ai/keys` | auth | `{ keys }` (never the key) / `{ provider, api_key, label?, model?, base_url?, is_default? }` -> `{ key }`. One key per provider per user (upsert); encrypted with AES-GCM under HKDF(`VAULT_RECOVERY_SECRET`, `ai:<userId>`) (`lib/aiCrypto.js`) |
| DELETE | `/api/ai/keys/:id` | auth | `{ ok }` |
| POST | `/api/ai/keys/:id/test` | auth | `{ ok, model, latency_ms }` (`ok:false` + `error` when the provider rejects the key) |
| POST | `/api/workspaces/:ws/rag/ask` | member | `{ question, embedding?, document_id?, key_id?, history? }` -> `{ answer, not_found, sources: [{ document_id, document_name, page_number, chunk_id, snippet }], provider, model }`. Retrieval: `search_documents_fts` + keyword chunks + `search_chunks` (when `embedding` given), RRF-fused, visibility-scoped, max 12 chunks, `[n]` citations. `400 { code: 'ai_key_required' }` when the user has no key |
| POST | `/api/workspaces/:ws/rag/extract` | editor | `{ document_id, version_id, key_id? }` -> `{ suggestions }` (first 12k chars of the version text -> JSON with the well-known keys, stored as suggestions `source='ai'`) |

Providers (`lib/ai/`): `openai.js` (OpenAI, Groq, local/custom via `base_url`, chat completions), `gemini.js` (`generateContent`), `anthropic.js` (`/v1/messages`). fetch only, no SDKs.

### Notes (contract section 7)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/workspaces/:ws/notes?q&pinned=1&cursor&limit` | member | `{ notes, next_cursor }` (others' private notes hidden) |
| GET | `/api/workspaces/:ws/notes/trash` | editor | trashed notes |
| POST | `/api/workspaces/:ws/notes` | editor | `{ title, content_html, content_text, color?, is_pinned?, is_private?, tags?, links?, encrypted_blob?, iv? }` -> `{ note }` (HTML sanitised again: `<script>`, `on*=`, `javascript:` stripped; private notes need `encrypted_blob`) |
| GET | `/api/workspaces/:ws/notes/:id` | member | `{ note: Note & { links } }` |
| PATCH | `/api/workspaces/:ws/notes/:id` | editor | same fields + `updated_at`; stale -> `409 { code: 'conflict', note }`; `links` replaces `note_links`. Creator, or admin for non-private notes |
| DELETE | `/api/workspaces/:ws/notes/:id` | editor | soft -> `{ ok }` |
| POST | `/api/workspaces/:ws/notes/:id/restore` | editor | `{ note }` |

### Home and stats (contract section 9)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/workspaces/:ws/home` | member | `{ recent, expiring (days_left), favorites, counts: { documents, people, groups, albums, notes }, storage_bytes }` |
| GET | `/api/workspaces/:ws/stats` | admin | `{ documents, versions, files, storage_bytes, people, groups, members, chunks, last_activity_at }` |

Visibility: editors and above see all workspace documents; viewers see everything except others' `private` uploads;
restricted members only see documents they uploaded or that are linked (`document_people`) to the person whose
`people.user_id` is theirs.

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
salt) only to count wrong attempts. Lockout is derived from `failed_attempts` alone: every 5th wrong PIN locks the vault for
`30s * 2^(failed_attempts/5 - 1)` (cap 24 h); a correct PIN resets the counter. Every vault action is audited in
`vault_activity_logs` (action, item_id, metadata, hashed IP; never the secrets). The client field `wrap_iv` is stored as
`vaults.pin_wrapped_key_iv` and returned as `wrap_iv` by `/unlock`.

1. **Setup** - browser generates the Vault Key, derives PIN Key and PIN Verifier, wraps the Vault Key (`pin_wrapped_key`
   + `wrap_iv`) and sends them with the raw `vault_key` (base64, over TLS, once). The Worker wraps that key with
   AES-256-GCM under a per-user key `HKDF(VAULT_RECOVERY_SECRET, info="user:<id>")` and stores `recovery_wrapped_key`.
   The wrapped value (`v1.<iv>.<ct>`) is stored in `recovery_wrapped_key` and its iv is mirrored in `recovery_wrapped_key_iv`.
   With `recovery_enabled: false` ("No recovery" mode) no `vault_key` is sent and PIN reset is impossible.
2. **Unlock** - client sends the verifier; on success it receives `pin_salt`, `kdf`, `kdf_iterations`, `pin_wrapped_key`,
   `wrap_iv` and unwraps the Vault Key locally.
3. **Change PIN** - requires the current verifier; the client re-wraps the Vault Key with the new PIN Key and sends the new
   salts, verifier and wrapped key in one call.
4. **Forgot PIN** - `request` emails a 6-digit code (`vault_otp_codes`, purpose `pin_reset`, sha256 stored, 10 min, one
   active code, `max_attempts` default 5, `consumed_at` on use). `verify`
   consumes the code, unwraps the recovery copy and returns the raw `vault_key` plus a 5-minute signed `reset_token`.
   The client re-wraps the key with the new PIN and calls `complete` with the token, new salts, verifier and wrapped key.
   All passwords are kept.

### Activity

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/workspaces/:ws/activity` | member | `?limit=&cursor=&entity_type=&entity_id=&action=` -> `{ items: [ { action, entity_type, entity_id, message, metadata, actor, created_at } ], next_cursor }` |

## Database alignment

Phase 1 and document tables follow `backend/migrations/001-008` exactly (profiles `avatar_key`/`preferred_language`,
workspaces `owner_id`/`features`/`ocr_languages`/`storage_bytes`, invites `status`/`accepted_by`, groups `icon`/`position`,
documents `name`/`document_type`/`status`/..., versions `source`/`hash`/`comment`, activity `message`/`metadata`).
Notable behaviours that depend on the schema:

- `workspaces` insert sets `owner_id` explicitly (its default `auth.uid()` is NULL under the service role); the
  `handle_new_workspace()` trigger creates the owner membership and the terminology row.
- Invite acceptance is done in the Worker (not `accept_workspace_invite()`, which needs `auth.jwt()`).
- `people.user_id` is unique per workspace; the Worker pre-checks and returns 409 with a friendly message.
- Groups have a unique name per parent; duplicates return 409.

Chaabi follows `009_vault.sql`:

- `vaults` (one per `user_id`): `pin_wrapped_key` + `pin_wrapped_key_iv` (client `wrap_iv`), `recovery_wrapped_key` (+ `_iv`),
  `recovery_enabled`, `failed_attempts`, `locked_until`, `pin_length` (DB default 6), `last_unlocked_at`, `pin_changed_at`.
- `vault_items` have no `user_id`: every query is scoped by `vault_id` after loading the caller's vault.
  `tags`, `strength`, `last_used_at` exist and are returned; `last_used_at` is set on `GET /items/:id`.
- `vault_item_history` has no `vault_id`: ownership is checked through `vault_items.vault_id`. Purging an item cascades.
- `vault_otp_codes` are keyed by `user_id` + `purpose` with `consumed_at` / `max_attempts`.
- `vault_activity_logs` records `vault_created, unlocked, unlock_failed, locked_out, pin_changed, pin_reset_requested,
  pin_reset, item_added, item_changed, item_deleted, item_restored, item_purged, history_deleted`.

Phase 2-9 routes need `backend/migrations/011_phase_features.sql` (additive, idempotent):

- `reminders.status` accepts the contract values (`pending`, `done`, `snoozed`) and the unique offset index only applies
  when `field_name` is set (several ad-hoc reminders per document).
- `albums.rules jsonb` (smart album rules as sent by the API) and `albums.cover_file_id`.
- `search_documents_fts()` / `search_chunks()` also work when called by the Worker with the service role
  (`current_user = 'service_role'`); before 011 they returned no rows outside a user session because
  `is_workspace_member()` needs `auth.uid()`.
- `similar_documents_by_text(ws, sample, lim)` for duplicate detection by text.

### Contract deviations

- `POST /documents/:id/versions/:vid/restore` copies files, pages and text but not `document_chunks` (re-run the pipeline).
- Suggestions: `source: 'rules'` is stored as `rule` (DB check constraint) and mapped back on read.
- Smart album rules live in `albums.rules` (jsonb), not `smart_album_rules` (its field/operator check list does not match
  the contract's rule fields).
- Reminders: `field` <-> `field_name`, `channel` <-> `channels[]`; older rows with `status='scheduled'` are reported as `pending`.
- `GET /api/shares/:token` also returns `download_url` per file when `allow_download` is true, and 410 for expired links.
- `POST /api/ai/keys` upserts on `(user_id, provider)` (the table allows one key per provider per user).
- Search responses always return `next_cursor: null` (results are ranked, capped at `limit`).

## Security notes

- R2 is private; the only read path is `GET /api/files/:fileId` with a valid HMAC (`file:<id>:<exp>`), 5 minute TTL.
- Object keys are ids; filenames are sanitised and stored only as metadata. MIME is decided by magic bytes.
- `secureHeaders` sets CSP (`default-src 'none'`), HSTS, `nosniff`, Referrer-Policy and Permissions-Policy on every response.
- Rate limiting (`src/lib/rateLimit.js`) is an in-memory, per-isolate, best-effort limiter for OTP and PIN routes. The
  authoritative protection is the DB-backed lockout. Move to a Durable Object / Rate Limiting binding when a global
  guarantee is required.
- Secrets are only read from Wrangler secrets / `.dev.vars`; nothing sensitive is logged (request logs print method, path,
  status and duration only).
