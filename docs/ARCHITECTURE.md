# DastaVault - Architecture

| | |
|---|---|
| Product | DastaVault (Documents, Search, Ask, Albums, People, Chaabi, Notes and Write) |
| Version | 1.0 |
| Date | 1 October 2026 |
| Companion docs | [PRD.md](PRD.md) (what to build), [SETUP.md](SETUP.md) (how to deploy for free) |

This document is the technical design. Every section is written so that a developer can build from it without
asking questions. Where the PRD says *what*, this document says *how*.

---

## 1. Overall architecture diagram

```
                                  USER DEVICE (phone, tablet, desktop)
 +------------------------------------------------------------------------------------------+
 |  React 19 + Vite PWA (JavaScript / JSX)  - served by Cloudflare Pages                    |
 |                                                                                          |
 |  UI (shadcn/ui, Tailwind, Motion)   Redux Toolkit + RTK Query   React Router             |
 |                                                                                          |
 |  Browser processing (all heavy work happens here, never in the Worker):                  |
 |    OpenCV.js  -> paper detection, perspective crop, deskew, filters                      |
 |    PDF.js     -> embedded text, page render                                              |
 |    Tesseract.js (Web Worker) -> OCR                                                      |
 |    Transformers.js (Web Worker) -> Xenova/all-MiniLM-L6-v2 embeddings (384 dims)         |
 |    WebCrypto  -> SHA-256 hashes, Chaabi AES-256-GCM + PBKDF2                             |
 |    browser-image-compression, pdf-lib, mammoth, Tiptap, DOMPurify                        |
 |                                                                                          |
 |  Dexie (IndexedDB): pendingCaptures, pendingUploads, drafts, recentCache                 |
 |  Service worker (vite-plugin-pwa): app shell cache, share target, background sync        |
 +--------------------+----------------------------------------------+----------------------+
                      |                                              |
        Supabase JS   | (sign in, sign up, refresh,                  |  fetch() with
        client        |  password reset, magic link)                 |  Authorization: Bearer <JWT>
                      v                                              v
 +--------------------------------+          +------------------------------------------------+
 |  Supabase Auth (GoTrue)        |          |  Cloudflare Worker  (Hono)  api.<domain>       |
 |  issues JWT (ES256, JWKS)      |<-------->|                                                |
 +--------------------------------+  JWKS    |  1. CORS + security headers                     |
                                    fetch    |  2. verify JWT (JWKS ES256, HS256 fallback)    |
                                             |  3. load membership + role for workspace       |
                                             |  4. route handler (validate with zod)           |
                                             |  5. write audit row (activity_logs)            |
                                             |                                                |
                                             |  Bindings:  FILES (R2)   Cron (keep-alive,     |
                                             |             reminders, trash purge, orphans)   |
                                             +------+--------------------+--------------------+
                                                    |                    |
                              service-role key      |                    |  R2 binding (no public URL)
                              (server only)         |                    |
                                                    v                    v
 +--------------------------------------------------------+   +-------------------------------+
 |  Supabase PostgreSQL                                    |   |  Cloudflare R2                |
 |  - tables (section 4), RLS on every table (section 6)   |   |  bucket: document-manager-files|
 |  - pgvector  vector(384) + HNSW cosine                  |   |  PRIVATE. Keys are UUIDs.     |
 |  - tsvector full text  + pg_trgm fuzzy                  |   |  workspaces/{ws}/documents/.. |
 |  - search_chunks(), search_documents() SQL functions    |   |  (section 7)                  |
 +--------------------------------------------------------+   +-------------------------------+

                                             +------------------------------------------------+
                                             |  Brevo (transactional email API)               |
                                             |  invites, reminders, Chaabi OTP codes          |
                                             +------------------------------------------------+
                                             +------------------------------------------------+
                                             |  Optional AI provider (user's own key)         |
                                             |  OpenAI / Gemini / Anthropic / Groq / local    |
                                             |  called from Worker with retrieved chunks only |
                                             +------------------------------------------------+
```

Key rules that follow from the diagram:

1. The browser talks to Supabase only for **auth**. All data reads and writes go through the Worker, so one place
   enforces permissions. (RLS is still on as a second wall; see section 6.)
2. The Worker does **I/O only**: JWT check, SQL, R2 streams, email. No image processing, no hashing of files,
   no OCR. This keeps every request well under the 10 ms CPU limit of the free plan.
3. R2 is never exposed. The only way to read a file is a Worker URL signed with `FILE_URL_SIGNING_SECRET`.

## 2. Complete tech stack

| Layer | Technology | Purpose | Why it is free |
|---|---|---|---|
| Frontend framework | React 19 + Vite 8, JavaScript + JSX (no TypeScript) | UI, routing, state | Open source |
| Styling | Tailwind CSS 4, shadcn/ui (Radix), Aceternity UI, tw-animate-css | Components, landing effects | Open source |
| Animation | Motion | Onboarding and empty-state animation only | Open source |
| Icons | Lucide React | Icons with labels | Open source |
| Routing | React Router 7 | Pages under `/w/:ws/*` | Open source |
| State | Redux Toolkit + RTK Query | Global state, API cache, optimistic updates | Open source |
| Forms | React Hook Form + Zod | Validation shared with the Worker | Open source |
| Offline DB | Dexie 4 (IndexedDB) | Upload queue, drafts, recent cache | Browser built-in |
| PWA | vite-plugin-pwa (Workbox) | Install, app shell cache, share target | Open source |
| Scanner | OpenCV.js (lazy loaded WASM) | Edge detection, perspective crop, deskew, filters | Runs on device |
| OCR | Tesseract.js 7 in a Web Worker | Text from images | Runs on device |
| PDF read | PDF.js (pdfjs-dist) | Embedded text and page rendering | Runs on device |
| PDF edit | pdf-lib | Rotate, reorder, merge pages, build PDF from scans | Runs on device |
| Embeddings | Transformers.js (`@huggingface/transformers`) with `Xenova/all-MiniLM-L6-v2` | 384-dim sentence vectors | Runs on device, model cached by service worker |
| Rich text | Tiptap (ProseMirror), DOMPurify, mammoth | Notes, written documents, DOCX import, sanitising | Open source |
| Image compress | browser-image-compression | Under 1.5 MB per page before upload | Runs on device |
| Hosting (frontend) | Cloudflare Pages | Static hosting, Git deploy, HTTPS | Free: unlimited requests, 500 builds/month |
| API | Cloudflare Workers + Hono | Serverless API, cron | Free: 100k requests/day, 10 ms CPU |
| File storage | Cloudflare R2 (Worker binding) | Originals, processed pages, thumbnails, PDFs | Free: 10 GB, 1M class A ops, zero egress |
| Database | Supabase PostgreSQL 15 + `vector` + `pg_trgm` + built-in FTS | All records, vector search, fuzzy search | Free: 500 MB, 2 projects |
| Auth | Supabase Auth | Email/password, magic link, reset, JWT | Free: 50k MAU |
| Email | Brevo transactional API | Invites, reminders, OTP | Free: 300 emails/day |
| AI (optional) | OpenAI / Gemini / Anthropic / Groq / local (Ollama, LM Studio) | Ask your documents, optional AI extraction | User supplies own key; app works without it |
| Speech | Web Speech API | Voice search | Browser built-in |
| Crypto | WebCrypto (SubtleCrypto) | SHA-256, PBKDF2, AES-GCM, HKDF | Browser and Worker built-in |

## 3. Repository / folder structure

```
dastavault/
  README.md
  docs/
    PRD.md
    ARCHITECTURE.md
    SETUP.md
  backend/
    migrations/                 numbered SQL files, run in order (0001_..., 0002_...)
      0001_extensions.sql       create extension vector, pg_trgm, pgcrypto
      0002_core.sql             profiles, workspaces, terminology, roles, permissions, members, invites
      0003_people.sql           groups, people, person_relationships, person_groups
      0004_documents.sql        documents, versions, files, pages, metadata, tags, links, upload_sessions
      0005_search.sql           document_chunks, tsvector columns, indexes, search functions
      0006_albums_reminders.sql albums, album_items, smart_album_rules, reminders
      0007_activity_shares.sql  activity_logs, shares, saved_searches, notifications
      0008_custom_fields.sql    custom_field_definitions, custom_field_values
      0009_notes.sql            notes, note_links
      0010_ai_vault.sql         ai_provider_keys, vaults, vault_items, vault_item_history, vault_otp_codes
      0011_rls.sql              helper functions + all policies
    seed/
      terminology_templates.sql roles, permissions, role_permissions, default terminology
  frontend/
    index.html
    vite.config.js              react, tailwind, pwa plugin (share target, runtime caching)
    .env.example
    public/                     icons, manifest assets, opencv.js (self-hosted), tesseract worker files
    src/
      main.jsx                  Provider, RouterProvider, PWA registration
      App.jsx
      index.css                 Tailwind, CSS variables, large-text mode
      routes/
        index.jsx               route tree (public, auth, /w/:ws/*, /account, /s/:token)
        guards.jsx              RequireAuth, RequireWorkspace, RequireRole
      pages/
        Landing.jsx  Login.jsx  Signup.jsx  ForgotPassword.jsx  ResetPassword.jsx  Verify.jsx
        Onboarding.jsx  WorkspaceSwitcher.jsx  Home.jsx  Search.jsx  Scan.jsx  Upload.jsx
        Documents.jsx  DocumentView.jsx  DocumentEdit.jsx  Trash.jsx
        People.jsx  Person.jsx  Groups.jsx  Group.jsx  Albums.jsx  Album.jsx
        Notes.jsx  Note.jsx  Chaabi.jsx  Reminders.jsx  Activity.jsx
        settings/  General.jsx Terminology.jsx Members.jsx Roles.jsx Features.jsx AiProvider.jsx Storage.jsx DangerZone.jsx
        Account.jsx  PublicShare.jsx  NotFound.jsx
      components/
        ui/          shadcn generated: button, input, dialog, sheet, drawer, tabs, badge, ...
        common/      EmptyState, ProgressWords, ConfirmDialog, OfflineBanner, SearchBox, VoiceButton, TagPicker
        documents/   DocumentCard, DocumentGrid, DocumentList, DocumentViewer, ImageViewer, PdfViewer,
                     DetailsPanel, SuggestedChips, VersionList, Timeline, DuplicateDialog, RelatedDocuments
        scanner/     CameraView, CornerOverlay, RectangleCrop, PerspectiveCrop, Magnifier, FilterBar, PageStrip
        search/      Filters, ResultCard, WhyMatched, AskPanel, Citation, ImageSearchDialog
        albums/      AlbumCard, SmartRuleBuilder
        people/      PersonCard, RelationshipPicker, PersonForm, GroupTree
        layout/      AppShell, BottomBar, Sidebar, TopBar, MoreMenu, WorkspaceSwitcherMenu, RightPanel
        notes/       NoteEditor (Tiptap), NoteCard, TemplatePicker, PageTools (pdf-lib)
        vault/       PinPad, PinSetup, VaultList, VaultItem, PasswordGenerator, StrengthMeter,
                     HistoryList, ForgotPinFlow, VaultSettings, LockOverlay
      store/
        index.js                configureStore, listener middleware
        slices/                 auth, workspace (current ws + terminology), ui (theme, large text),
                                uploadQueue, scanner (pages in progress), vault (unlocked key in memory only)
        api/                    RTK Query: baseApi.js (auth header, 401 retry), workspacesApi, peopleApi,
                                documentsApi, searchApi, albumsApi, remindersApi, notesApi, vaultApi, adminApi
      services/
        api/        client.js (fetch wrapper), uploads.js (chunked/idempotent upload), files.js (signed URL cache)
        supabase/   client.js (createClient), auth.js (sign in/up/reset, session listener)
        search/     queryParser.js (relationship/type/date words), hybrid.js, rrf.js, highlight.js
        ocr/        ocr.worker.js, ocrService.js, pdfText.js, cleanText.js
        scanner/    opencv.js loader, detect.js (largest quad), warp.js, filters.js, compress.js, pdfBuild.js
        embedding/  embed.worker.js, embedService.js (batching, model cache), chunker.js
        ai/         provider.js (AIProvider interface), openai.js, gemini.js, anthropic.js, groq.js, local.js
        vault/      crypto.js (PBKDF2, AES-GCM, wrap/unwrap), vaultService.js, clipboard.js, autoLock.js
        notes/      editor.js (Tiptap extensions), exportMarkdown.js, importDocx.js (mammoth), sanitize.js
        offline/    db.js (Dexie schema), queue.js, sync.js, network.js
        metadata/   extractors (types, dates, numbers, amounts, names), nameSuggester.js, dedupe.js (pHash)
      hooks/        useAuth, useWorkspace, useTerminology, useOnline, useUploadQueue, useVault, useSpeech,
                    useInfiniteList, useDebounce, useMediaQuery
      utils/        format.js (dates, sizes), hash.js (SHA-256 streaming), phash.js, sanitizeFilename.js, cn.js
      constants/    routes.js, docTypes.js, relationships.js, terminologyTemplates.js, limits.js, wording.js
      lib/          zodSchemas.js (shared with worker by copy), i18n.js (en, hi dictionaries)
  worker/
    wrangler.toml               name, compatibility date, R2 binding FILES, cron triggers, vars
    .dev.vars.example
    package.json
    src/
      index.js                  Hono app, middleware order, scheduled() handler
      lib/
        env.js                  typed access to bindings and secrets
        auth.js                 JWT verify (JWKS cache, ES256; HS256 fallback), getUser()
        supabase.js             service-role client factory, query helpers
        membership.js           requireMember(ws, minRole), role ordering
        r2.js                   put/get/delete, key builder, magic-byte MIME check
        signing.js              HMAC signed file URLs (5 min), presign helpers
        email.js                Brevo API client + templates (invite, reminder, otp)
        rateLimit.js            per-user and per-IP counters (Supabase table or Durable Object later)
        vaultCrypto.js          HKDF recovery key, AES-GCM wrap/unwrap for PIN reset
        ai.js                   AIProvider adapters for server-side RAG calls
        rrf.js                  Reciprocal Rank Fusion + exact boost
        activity.js             writeActivity() helper
        errors.js               AppError, error -> HTTP mapping
        validate.js             zod middleware
      routes/
        health.js  me.js  workspaces.js  terminology.js  members.js  invites.js  groups.js  people.js
        relationships.js  documents.js  uploads.js  files.js  versions.js  metadata.js  search.js
        albums.js  reminders.js  sharing.js  activity.js  notifications.js  rag.js  notes.js  vault.js  admin.js
      cron/
        keepAlive.js  reminders.js  purgeTrash.js  cleanupOrphans.js  purgeOtp.js
```

## 4. Supabase schema plan

Conventions for every table:

- Primary key `id uuid default gen_random_uuid()`.
- Workspace-scoped tables carry `workspace_id uuid not null references workspaces(id) on delete cascade`.
- `created_at timestamptz default now()`, `updated_at timestamptz default now()` (trigger `set_updated_at()`), `created_by uuid references auth.users(id)`.
- Soft delete: `deleted_at timestamptz null`. Lists always filter `deleted_at is null`. Trash shows `deleted_at is not null`.
- Composite indexes start with `workspace_id`.
- Enumerations are `text` with a `check` constraint, not Postgres enums, so they can be extended without migration locks.

### 4.1 Accounts and workspaces

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | `id uuid pk = auth.users.id`, `display_name`, `avatar_key`, `preferred_language text default 'en'`, `large_text boolean`, `last_workspace_id`, `created_at`, `updated_at` | Created by trigger on `auth.users` insert |
| `workspaces` | `id`, `name`, `slug unique`, `type text check (family, company, school, organisation, personal, custom)`, `icon`, `owner_id`, `default_visibility text default 'workspace'`, `features jsonb` (`{"faces":false,"ai":true,"semantic":true,"log_downloads":false}`), `ocr_languages text[] default '{eng}'`, `storage_bytes bigint default 0`, `created_at`, `updated_at`, `deleted_at` | 30-day soft delete |
| `workspace_terminology` | `workspace_id pk`, `workspace_label`, `member_singular`, `member_plural`, `group_singular`, `group_plural`, `subgroup_singular`, `subgroup_plural`, `person_singular`, `person_plural`, `updated_at` | One row per workspace, filled from template |
| `roles` | `id`, `workspace_id null` (null = system role), `key text` (owner, admin, editor, viewer, restricted), `name`, `rank int` (owner 100, admin 80, editor 60, viewer 40, restricted 20), `is_system boolean` | Custom roles later with `workspace_id` set |
| `permissions` | `id`, `key unique` (e.g. `documents.create`, `members.manage`, `vault.use`), `description` | Seeded |
| `role_permissions` | `role_id`, `permission_id`, pk(role_id, permission_id) | Seeded |
| `workspace_members` | `id`, `workspace_id`, `user_id`, `role_id`, `person_id null`, `status text check (active, suspended)`, `joined_at`, `created_at`, `updated_at`, unique(workspace_id, user_id) | The single source of truth for access |
| `workspace_invites` | `id`, `workspace_id`, `email`, `role_id`, `token_hash`, `invited_by`, `expires_at`, `accepted_at`, `created_at` | Token sent by Brevo, only hash stored |

### 4.2 People and groups

| Table | Key columns | Notes |
|---|---|---|
| `groups` | `id`, `workspace_id`, `parent_group_id null`, `name`, `description`, `icon`, `sort_order`, `created_by`, `created_at`, `updated_at`, `deleted_at` | Departments/teams, classes/sections |
| `people` | `id`, `workspace_id`, `full_name`, `nickname`, `aliases text[]`, `photo_key`, `email`, `phone`, `date_of_birth`, `member_user_id null`, `notes`, `name_trgm` (generated lower name), `created_by`, `created_at`, `updated_at`, `deleted_at` | `aliases` feed fuzzy matching ("Dad", "Papa") |
| `person_relationships` | `id`, `workspace_id`, `from_person_id`, `to_person_id`, `relation text` (father, mother, parent, child, son, daughter, spouse, brother, sister, grandparent, guardian, manager, reports_to, custom), `custom_label`, `created_by`, `created_at`, unique(from_person_id, to_person_id, relation) | Reads as "from_person is the `relation` of to_person" |
| `person_groups` | `person_id`, `group_id`, `workspace_id`, `role_in_group`, `created_at`, pk(person_id, group_id) | |

### 4.3 Documents

| Table | Key columns | Notes |
|---|---|---|
| `documents` | `id`, `workspace_id`, `title`, `original_filename`, `previous_titles text[]`, `doc_type text` (passport, invoice, ... , written, note_export, other), `kind text check (upload, scan, written)`, `visibility text check (workspace, groups, people, private)`, `current_version_id`, `summary`, `organisation`, `primary_date date`, `expiry_date date`, `language`, `is_favourite`, `is_pinned`, `search_vector tsvector` (generated: title A, organisation B, summary C, ocr D), `sha256_primary`, `phash`, `created_by`, `created_at`, `updated_at`, `deleted_at`, `deleted_by`, `purge_after` | Logical document |
| `document_versions` | `id`, `workspace_id`, `document_id`, `version_number int`, `comment`, `previous_version_id`, `restored_from_version_id`, `ocr_text`, `ocr_clean_text`, `ocr_language`, `ocr_confidence numeric`, `ocr_status text check (pending, done, failed, manual, skipped)`, `text_vector tsvector` (generated from ocr_clean_text), `content_html`, `content_text` (for written docs), `created_by`, `created_at`, unique(document_id, version_number) | Never updated once OCR done, except by the OCR result write |
| `document_files` | `id`, `workspace_id`, `document_id`, `version_id`, `role text check (original, processed, thumbnail, pdf, page)`, `page_index int`, `r2_key`, `mime_type`, `size_bytes`, `sha256`, `width`, `height`, `created_by`, `created_at` | R2 object metadata; `r2_key` follows section 7 |
| `document_pages` | `id`, `workspace_id`, `version_id`, `page_number`, `file_id`, `text_raw`, `text_clean`, `confidence`, `language`, `word_boxes jsonb null`, `source text check (pdf_text, ocr, manual)`, `created_at` | Page-level text; used for citations |
| `document_metadata` | `document_id pk`, `workspace_id`, `names text[]`, `dates jsonb` (`{"issue":"2020-01-05","expiry":"2030-01-04","invoice":null}`), `numbers jsonb` (`{"passport":"N1234567","policy":null}`), `amount numeric`, `currency`, `emails text[]`, `phones text[]`, `address`, `organisation`, `keywords text[]`, `custom jsonb`, `updated_by`, `updated_at` | Confirmed values |
| `document_metadata_suggestions` | `id`, `workspace_id`, `document_id`, `version_id`, `field text`, `value jsonb`, `confidence numeric`, `source text check (rules, ai, person_match)`, `status text check (pending, accepted, rejected)`, `created_at`, `resolved_at` | "Suggested" chips |
| `tags` | `id`, `workspace_id`, `name`, `colour`, `usage_count int`, `created_by`, `created_at`, unique(workspace_id, lower(name)) | |
| `document_tags` | `document_id`, `tag_id`, `workspace_id`, `created_by`, `created_at`, pk(document_id, tag_id) | |
| `document_people` | `document_id`, `person_id`, `workspace_id`, `role text` (owner, mentioned, signatory), `created_by`, `created_at`, pk(document_id, person_id) | |
| `document_groups` | `document_id`, `group_id`, `workspace_id`, `created_by`, `created_at`, pk(document_id, group_id) | |
| `document_chunks` | see section 5 | Vector search |
| `upload_sessions` | `id` (client-generated upload id), `workspace_id`, `user_id`, `document_id null`, `version_id null`, `status text check (started, stored, committed, failed, abandoned)`, `expected_sha256`, `expected_size`, `mime_type`, `r2_key`, `error`, `created_at`, `updated_at`, `expires_at` | Idempotency and orphan cleanup |
| `custom_field_definitions` | `id`, `workspace_id`, `doc_type null`, `name`, `key`, `field_type text check (text, number, date, choice)`, `choices text[]`, `required boolean`, `sort_order`, `created_at`, `updated_at`, `deleted_at` | |
| `custom_field_values` | `id`, `workspace_id`, `definition_id`, `document_id null`, `person_id null`, `value jsonb`, `updated_by`, `updated_at` | One of document_id / person_id set |

### 4.4 Albums, reminders, activity, sharing

| Table | Key columns | Notes |
|---|---|---|
| `albums` | `id`, `workspace_id`, `name`, `kind text check (manual, person, type, group, event, smart)`, `person_id`, `group_id`, `doc_type`, `cover_document_id`, `sort text`, `created_by`, `created_at`, `updated_at`, `deleted_at` | |
| `album_items` | `album_id`, `document_id`, `workspace_id`, `sort_order`, `added_by`, `added_at`, pk(album_id, document_id) | Manual albums only |
| `smart_album_rules` | `id`, `workspace_id`, `album_id`, `field text` (person, group, doc_type, tag, date, expiry, organisation), `operator text` (eq, neq, in, contains, before, after, between), `value jsonb`, `join text check (and, or)`, `sort_order` | Compiled to SQL in the Worker |
| `reminders` | `id`, `workspace_id`, `document_id`, `field text` (expiry, renewal, custom), `remind_on date`, `offsets int[] default '{30,7,1}'`, `channel text[] default '{inapp,email}'`, `recipient_user_ids uuid[]`, `last_sent_at`, `status text check (active, done, cancelled)`, `created_by`, `created_at`, `updated_at` | Cron sends at 08:00 workspace-local |
| `activity_logs` | `id`, `workspace_id`, `actor_user_id`, `entity_type text` (document, version, person, group, member, album, note, vault, share, workspace), `entity_id`, `action text`, `details jsonb`, `ip_hash`, `created_at` | Append-only; timeline sentences rendered in UI |
| `shares` | `id`, `workspace_id`, `document_id null`, `album_id null`, `target_type text check (member, group, link)`, `target_user_id`, `target_group_id`, `token_hash`, `password_hash null`, `allow_download boolean`, `expires_at`, `revoked_at`, `view_count int`, `created_by`, `created_at` | Public links only by token hash |
| `saved_searches` | `id`, `workspace_id`, `user_id`, `name`, `query text`, `filters jsonb`, `created_at`, `updated_at` | Recent searches live in Dexie only |
| `notifications` | `id`, `workspace_id null`, `user_id`, `kind text` (reminder, share, invite, upload, system), `title`, `body`, `link`, `read_at`, `created_at` | |

### 4.5 Notes, AI keys, Chaabi

| Table | Key columns | Notes |
|---|---|---|
| `notes` | `id`, `workspace_id`, `title`, `content_html`, `content_text`, `colour`, `is_pinned`, `is_private boolean` (Chaabi-locked), `encrypted_content bytea null`, `content_iv bytea null`, `template`, `search_vector tsvector` (generated), `created_by`, `created_at`, `updated_at`, `deleted_at` | Private notes store only ciphertext; html/text null |
| `note_links` | `note_id`, `workspace_id`, `target_type text check (person, group, document, note)`, `target_id`, `created_at`, pk(note_id, target_type, target_id) | |
| `ai_provider_keys` | `id`, `user_id`, `provider text check (openai, gemini, anthropic, groq, local)`, `encrypted_key bytea`, `key_iv bytea`, `model`, `base_url` (local only), `is_default boolean`, `created_at`, `updated_at`, `last_used_at` | Encrypted with AES-GCM using HKDF(FILE_URL_SIGNING_SECRET, 'ai-keys', user_id) in the Worker; never returned to the client, never logged |
| `vaults` | `id`, `user_id unique`, `pin_salt bytea`, `pin_kdf text default 'pbkdf2-sha256'`, `pin_iterations int default 600000`, `pin_wrapped_key bytea`, `pin_wrap_iv bytea`, `verifier_salt bytea`, `pin_verifier bytea`, `recovery_wrapped_key bytea null`, `recovery_wrap_iv bytea null`, `recovery_enabled boolean default true`, `failed_attempts int default 0`, `locked_until timestamptz null`, `lockout_level int default 0`, `pin_length int`, `auto_lock_seconds int default 120`, `created_at`, `updated_at` | One per user |
| `vault_items` | `id`, `vault_id`, `user_id`, `title` (plain), `website` (plain), `category text` (personal, banking, work, social, wifi, cards, other), `tags text[]`, `is_favourite`, `enc_payload bytea` (AES-GCM of `{username,password,notes}`), `payload_iv bytea`, `enc_version int default 1`, `created_at`, `updated_at`, `deleted_at` | Server never sees the payload key |
| `vault_item_history` | `id`, `item_id`, `vault_id`, `user_id`, `enc_password bytea`, `password_iv bytea`, `changed_at`, `deleted_at` | Old passwords; user can delete rows |
| `vault_otp_codes` | `id`, `user_id`, `code_hash bytea`, `salt bytea`, `purpose text check (pin_reset)`, `attempts int default 0`, `expires_at`, `consumed_at`, `created_at`, `ip_hash` | Only one row with `consumed_at is null and expires_at > now()` per user |

### 4.6 Important indexes

```sql
create index on workspace_members (user_id, workspace_id);
create index on documents (workspace_id, deleted_at, updated_at desc);
create index on documents using gin (search_vector);
create index on documents using gin (title gin_trgm_ops);
create index on documents (workspace_id, expiry_date) where deleted_at is null;
create index on document_versions using gin (text_vector);
create index on document_files (workspace_id, sha256);
create index on people using gin (full_name gin_trgm_ops);
create index on document_people (person_id, workspace_id);
create index on activity_logs (workspace_id, created_at desc);
create index on notes using gin (search_vector);
create index on reminders (remind_on) where status = 'active';
```

## 5. pgvector schema

### 5.1 `document_chunks`

```sql
create table document_chunks (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  document_id      uuid not null references documents(id) on delete cascade,
  version_id       uuid not null references document_versions(id) on delete cascade,
  source_type      text not null default 'document' check (source_type in ('document','note')),
  source_id        uuid,                      -- note id when source_type = 'note'
  page_number      int,
  chunk_index      int not null,
  content          text not null check (char_length(content) <= 1000),
  content_hash     text not null,             -- sha256 of content, skips re-embedding unchanged chunks
  embedding        vector(384),               -- Xenova/all-MiniLM-L6-v2
  embedding_model  text not null default 'Xenova/all-MiniLM-L6-v2',
  embedding_version text not null default '1',
  embedded_at      timestamptz,
  created_at       timestamptz not null default now(),
  unique (version_id, chunk_index)
);

create index document_chunks_embedding_hnsw
  on document_chunks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index on document_chunks (workspace_id, document_id);
```

Why these choices:

- **384 dimensions** matches `all-MiniLM-L6-v2`, which runs in about 20 to 80 ms per chunk on a mid-range phone.
- **HNSW with cosine** gives fast approximate search without a training step (IVFFlat needs data first).
  On the free tier the index is small enough (10k documents x ~8 chunks x 384 x 4 bytes = ~120 MB worst case) but
  `content` is capped at 1,000 characters to protect the 500 MB budget.
- The embedding is computed in the browser and sent as a JSON array of 384 floats; the Worker validates
  length and finite values before inserting.

### 5.2 Adding another dimension later

The model name and version are stored on every row, so a new model is added without touching old rows:

1. Add a column: `alter table document_chunks add column embedding_768 vector(768);` (or a new table
   `document_chunks_768` if you prefer to keep the table narrow).
2. Add an HNSW index on the new column.
3. Set `embedding_model = 'new-model'` when the browser or a server job writes the new column.
4. `search_chunks()` receives the `model` argument and picks the column to compare. The query vector must have
   the same dimension as the column it compares against; the function checks `vector_dims()`.
5. Re-embed in the background: select rows where `embedding_model <> 'new-model'`, embed, update. Old column
   can be dropped when no rows use it.

### 5.3 `search_chunks()` - workspace filter inside SQL

```sql
create or replace function search_chunks(
  p_workspace_id uuid,
  p_user_id      uuid,
  p_query        vector(384),
  p_limit        int default 40,
  p_model        text default 'Xenova/all-MiniLM-L6-v2'
) returns table (
  chunk_id uuid, document_id uuid, version_id uuid, page_number int,
  content text, score float
)
language sql stable security definer set search_path = public as $$
  select c.id, c.document_id, c.version_id, c.page_number, c.content,
         1 - (c.embedding <=> p_query) as score
  from document_chunks c
  join documents d on d.id = c.document_id
  where c.workspace_id = p_workspace_id
    and c.embedding_model = p_model
    and c.embedding is not null
    and d.deleted_at is null
    and can_view_document(p_user_id, d.id)     -- visibility rules, section 6.1
  order by c.embedding <=> p_query
  limit p_limit;
$$;
```

`security definer` lets the Worker call it with the service role while the function itself enforces the workspace
and permission filter, so no caller can forget it. The `<=>` operator in both `select` and `order by` uses the HNSW
index. Set `hnsw.ef_search = 100` in the session for better recall when the result feels thin.

## 6. RLS strategy

Row Level Security is on for every table in `public`. Two callers exist:

| Caller | Key | Sees |
|---|---|---|
| Browser (Supabase client) | publishable/anon key + user JWT | Only its own rows through policies; used only for `profiles` and (later) realtime `notifications` |
| Worker | service-role key | Bypasses RLS; must run its own checks first (6.4) |

### 6.1 Helper functions

```sql
-- true when the user is an active member of the workspace
create or replace function is_workspace_member(p_ws uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = p_ws and m.user_id = p_user and m.status = 'active');
$$;

-- returns role key ('owner','admin','editor','viewer','restricted') or null
create or replace function workspace_role(p_ws uuid, p_user uuid default auth.uid())
returns text language sql stable security definer set search_path = public as $$
  select r.key from workspace_members m join roles r on r.id = m.role_id
  where m.workspace_id = p_ws and m.user_id = p_user and m.status = 'active';
$$;

-- rank comparison so policies can say "at least editor"
create or replace function has_min_role(p_ws uuid, p_min text, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select r.rank from workspace_members m join roles r on r.id = m.role_id
                   where m.workspace_id = p_ws and m.user_id = p_user and m.status = 'active'), 0)
         >= (select rank from roles where key = p_min and workspace_id is null);
$$;

-- document visibility for a user (used by policies AND by search functions)
create or replace function can_view_document(p_user uuid, p_doc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from documents d
    join workspace_members m on m.workspace_id = d.workspace_id and m.user_id = p_user and m.status = 'active'
    join roles r on r.id = m.role_id
    where d.id = p_doc and (
      r.key in ('owner','admin')
      or (d.visibility = 'workspace' and r.key <> 'restricted')
      or d.created_by = p_user
      or exists (select 1 from document_people dp where dp.document_id = d.id and dp.person_id = m.person_id)
      or exists (select 1 from document_groups dg join person_groups pg on pg.group_id = dg.group_id
                 where dg.document_id = d.id and pg.person_id = m.person_id)
      or exists (select 1 from shares s where s.document_id = d.id and s.revoked_at is null
                 and (s.expires_at is null or s.expires_at > now())
                 and (s.target_user_id = p_user or s.target_group_id in
                      (select group_id from person_groups where person_id = m.person_id)))
    ));
$$;
```

### 6.2 Policy matrix

R = read, C = create, U = update, D = delete (soft). "own" = row where `created_by = auth.uid()` or `user_id = auth.uid()`.

| Table | Owner | Admin | Editor | Viewer | Restricted |
|---|---|---|---|---|---|
| profiles | own RU | own RU | own RU | own RU | own RU |
| workspaces | RUD | RU | R | R | R |
| workspace_terminology | RU | RU | R | R | R |
| workspace_members | RCUD | RCUD (not owner row) | R | R | own R |
| workspace_invites | RCD | RCD | - | - | - |
| roles, permissions, role_permissions | R (+CU custom later) | R | R | R | R |
| groups | RCUD | RCUD | R | R | own groups R |
| people | RCUD | RCUD | RCU | R | own person R |
| person_relationships | RCUD | RCUD | RCU | R | own R |
| person_groups | RCUD | RCUD | RCU | R | own R |
| documents | RCUD | RCUD | RCU (D own) | R (can_view) | R (can_view) |
| document_versions, document_files, document_pages | RC | RC | RC | R (can_view) | R (can_view) |
| document_metadata(+_suggestions) | RCU | RCU | RCU | R | R |
| tags, document_tags, document_people, document_groups | RCUD | RCUD | RCUD | R | R |
| document_chunks | R (via function) | R | R | R | R |
| upload_sessions | own RCU | own RCU | own RCU | - | - |
| custom_field_definitions | RCUD | RCUD | R | R | R |
| custom_field_values | RCU | RCU | RCU | R | R |
| albums, album_items, smart_album_rules | RCUD | RCUD | RCUD (own D) | R | R (shared) |
| reminders | RCUD | RCUD | RCU | R | own R |
| activity_logs | R | R | R (own + docs can view) | own R | own R |
| shares | RCUD | RCUD | own RCUD | R (targeted) | R (targeted) |
| saved_searches | own RCUD | own | own | own | own |
| notifications | own RU | own RU | own RU | own RU | own RU |
| notes, note_links | RCUD | RCUD | RCUD | R | own R |
| ai_provider_keys | own RCUD (user scoped) | own | own | own | own |
| vaults, vault_items, vault_item_history, vault_otp_codes | own only (user scoped, no workspace role) | own | own | own | own |

Example policy for `documents` (pattern used everywhere):

```sql
alter table documents enable row level security;

create policy documents_select on documents for select
  using (can_view_document(auth.uid(), id) and (deleted_at is null or has_min_role(workspace_id, 'admin') or created_by = auth.uid()));

create policy documents_insert on documents for insert
  with check (has_min_role(workspace_id, 'editor') and created_by = auth.uid());

create policy documents_update on documents for update
  using (has_min_role(workspace_id, 'editor') and can_view_document(auth.uid(), id));

-- no delete policy: rows are soft deleted through update; hard purge is service-role only
```

### 6.3 Service-role usage rules in the Worker

1. The service-role key exists only as a Wrangler secret. It never appears in a `VITE_` variable or in a response.
2. Before any service-role query the Worker calls `requireMember(workspaceId, minRole)` and, for a document,
   `canViewDocument(userId, documentId)` (same SQL function as RLS). The user id comes from the verified JWT only.
3. Every query still includes `workspace_id = $1` in the `where` clause. Never fetch by `id` alone.
4. Multi-table writes (upload commit, version restore, PIN reset) run inside a single SQL function or a
   transaction via `rpc()` so partial failures roll back.
5. For read-only list endpoints the Worker may instead forward the user's JWT to PostgREST (`Authorization`
   header) so RLS does the filtering; this is the default for `GET` routes and keeps the Worker code smaller.
6. The Worker logs the route, user id and workspace id, never request bodies or file contents.

## 7. R2 file structure

Bucket: `document-manager-files`, **private** (no public access, no custom domain), bound in `wrangler.toml` as `FILES`.

Key pattern:

```
workspaces/{workspace_id}/documents/{document_id}/versions/{version_id}/{role}/{file_uuid}.{ext}

role  = original | processed | thumbnails | pdf
ext   = jpg | png | webp | pdf | txt | md | docx | xlsx | csv     (from verified MIME, not from the user)

Examples
workspaces/2d1c.../documents/9b7e.../versions/41aa.../original/6f2a....jpg     camera photo, untouched
workspaces/2d1c.../documents/9b7e.../versions/41aa.../processed/8c10....jpg    cropped + filtered page 1
workspaces/2d1c.../documents/9b7e.../versions/41aa.../thumbnails/8c10....webp  320px wide, made in browser
workspaces/2d1c.../documents/9b7e.../versions/41aa.../pdf/1e55....pdf          merged multi-page PDF

Other prefixes
workspaces/{ws}/people/{person_id}/photo/{uuid}.webp
users/{user_id}/avatar/{uuid}.webp
exports/{ws}/{job_id}.zip          (P1, expires after 24 h)
```

Rules:

- Object keys contain only UUIDs and fixed words. The user's filename is stored in `document_files`/`documents.original_filename`
  after `sanitizeFilename()` (strip path separators and control characters, collapse spaces, max 200 characters, keep the extension for display only).
- MIME is verified by magic bytes in the Worker (`lib/r2.js`): JPEG `FF D8 FF`, PNG `89 50 4E 47`, WEBP `52 49 46 46 .. 57 45 42 50`, PDF `25 50 44 46`, DOCX/XLSX `50 4B 03 04`. Text types are checked to be valid UTF-8. HEIC is converted to JPEG in the browser before upload and is never stored.
- Custom metadata on each object: `sha256`, `workspace`, `document`, `uploaded-by`. Used by the orphan cleanup cron.
- **Reads**: `GET /files/:fileId?exp=<unix>&sig=<hmac>`. The Worker signs `fileId|exp|userId` with `FILE_URL_SIGNING_SECRET` (HMAC-SHA256), links live 5 minutes, and the Worker streams `FILES.get(key).body` with `Content-Type`, `Content-Disposition: inline; filename="<sanitised>"`, `Cache-Control: private, max-age=300`, and `ETag`. Range requests are forwarded so PDF.js can read partially.
- **Writes (V1)**: multipart `POST /uploads/:uploadId/file` through the Worker, streamed to `FILES.put()` (no buffering). Limit 25 MB.
- **Presigned PUT (P1)**: for files above 5 MB the Worker issues an S3-style presigned URL using `aws4fetch` with the R2 S3 API, 10 minutes, one key, `Content-Length` and `x-amz-content-sha256` conditions. Needs R2 CORS (JSON in SETUP.md). The browser then calls `POST /uploads/:id/commit` and the Worker verifies the object exists and its size matches before writing DB rows.
- Deletion: files are removed from R2 only by the trash purge cron after the 30-day window, or by the orphan cleanup cron when an `upload_sessions` row is `stored` but never `committed` for more than 24 hours.

## 8. Worker route map

All routes are prefixed with `/api/v1`. Auth "JWT" means a valid Supabase JWT is required. "Min role" is checked against the workspace given in the path (`/workspaces/:ws/...`); the body's workspace id is ignored.

| Group | Method + path | Auth | Min role | Notes |
|---|---|---|---|---|
| health | `GET /health` | none | - | Returns `{ok, version, time}`; used by keep-alive |
| health | `GET /health/db` | none | - | `select 1` on Supabase; used by cron |
| me | `GET /me` | JWT | - | Profile + memberships + terminology per workspace |
| me | `PATCH /me` | JWT | - | display_name, avatar, language, large_text |
| me | `GET /me/notifications`, `PATCH /me/notifications/:id/read`, `POST /me/notifications/read-all` | JWT | - | |
| me | `GET/PUT/DELETE /me/ai-keys`, `POST /me/ai-keys/test` | JWT | - | Encrypted at rest; never returned |
| workspaces | `POST /workspaces` | JWT | - | Creates workspace, owner member, terminology from template |
| workspaces | `GET /workspaces/:ws` | JWT | restricted | |
| workspaces | `PATCH /workspaces/:ws` | JWT | admin | name, icon, default_visibility, features, ocr_languages |
| workspaces | `DELETE /workspaces/:ws` | JWT | owner | Typed confirmation, 30-day soft delete |
| workspaces | `POST /workspaces/:ws/transfer-ownership` | JWT | owner | |
| workspaces | `GET /workspaces/:ws/storage` | JWT | admin | Bytes used, counts, warnings |
| terminology | `GET /workspaces/:ws/terminology` | JWT | restricted | |
| terminology | `PUT /workspaces/:ws/terminology` | JWT | admin | |
| members | `GET /workspaces/:ws/members` | JWT | viewer | Restricted sees only self |
| members | `PATCH /workspaces/:ws/members/:id` | JWT | admin | role, person link, status |
| members | `DELETE /workspaces/:ws/members/:id` | JWT | admin | Cannot remove owner |
| invites | `GET/POST /workspaces/:ws/invites` | JWT | admin | Sends Brevo email |
| invites | `DELETE /workspaces/:ws/invites/:id` | JWT | admin | |
| invites | `POST /invites/accept` | JWT | - | Body `{token}`; creates member |
| groups | `GET/POST /workspaces/:ws/groups` | JWT | viewer / admin | Tree with parent_group_id |
| groups | `GET/PATCH/DELETE /workspaces/:ws/groups/:id` | JWT | viewer / admin | |
| groups | `GET /workspaces/:ws/groups/:id/documents` | JWT | viewer | |
| people | `GET/POST /workspaces/:ws/people` | JWT | viewer / editor | Search `?q=` uses trigram |
| people | `GET/PATCH/DELETE /workspaces/:ws/people/:id` | JWT | viewer / editor (admin for delete) | |
| people | `POST /workspaces/:ws/people/:id/photo` | JWT | editor | |
| people | `PUT /workspaces/:ws/people/:id/groups` | JWT | editor | Replace group list |
| people | `GET /workspaces/:ws/people/:id/documents` | JWT | viewer | |
| relationships | `GET /workspaces/:ws/relationships?person=` | JWT | viewer | |
| relationships | `POST /workspaces/:ws/relationships` | JWT | editor | `{from, to, relation}` |
| relationships | `DELETE /workspaces/:ws/relationships/:id` | JWT | editor | |
| relationships | `GET /workspaces/:ws/relationships/resolve?word=dad` | JWT | viewer | Resolves from current user's person |
| documents | `GET /workspaces/:ws/documents` | JWT | restricted | Cursor pagination, filters, sort |
| documents | `POST /workspaces/:ws/documents` | JWT | editor | Creates document + version 1 (files attached by uploads) |
| documents | `GET /workspaces/:ws/documents/:id` | JWT | restricted (can_view) | Document, current version, files with signed URLs, metadata, people, groups, tags |
| documents | `PATCH /workspaces/:ws/documents/:id` | JWT | editor | title, type, visibility, dates, favourite, pinned |
| documents | `DELETE /workspaces/:ws/documents/:id` | JWT | editor (own) / admin | To trash |
| documents | `POST /workspaces/:ws/documents/:id/restore` | JWT | editor | |
| documents | `DELETE /workspaces/:ws/documents/:id/purge` | JWT | admin | Immediate purge |
| documents | `GET /workspaces/:ws/documents/trash` | JWT | editor | |
| documents | `PUT /workspaces/:ws/documents/:id/people` `/groups` `/tags` | JWT | editor | Replace link lists |
| documents | `GET /workspaces/:ws/documents/:id/related` | JWT | restricted | Same person/type/organisation |
| documents | `GET /workspaces/:ws/documents/:id/timeline` | JWT | restricted | From activity_logs |
| documents | `POST /workspaces/:ws/documents/check-duplicates` | JWT | editor | `{sha256, phash, numbers}` |
| uploads | `POST /workspaces/:ws/uploads` | JWT | editor | Body `{uploadId, sha256, size, mime, documentId?, versionId?, role}`; idempotent |
| uploads | `POST /workspaces/:ws/uploads/:uploadId/file` | JWT | editor | Multipart stream to R2 (V1) |
| uploads | `POST /workspaces/:ws/uploads/:uploadId/presign` | JWT | editor | P1, files above 5 MB |
| uploads | `POST /workspaces/:ws/uploads/:uploadId/commit` | JWT | editor | Creates document_files (+ document/version if new) |
| uploads | `GET /workspaces/:ws/uploads/:uploadId` | JWT | editor | Status for retry |
| files | `GET /files/:fileId?exp=&sig=` | signed URL | - | Streams from R2; range supported |
| files | `POST /workspaces/:ws/files/:fileId/sign` | JWT | restricted (can_view) | Returns fresh signed URL (5 min) |
| files | `GET /workspaces/:ws/files/:fileId/download` | JWT | restricted (can_view) | `Content-Disposition: attachment`; logs if auditing on |
| versions | `GET /workspaces/:ws/documents/:id/versions` | JWT | restricted | |
| versions | `POST /workspaces/:ws/documents/:id/versions` | JWT | editor | New version with comment; files via uploads |
| versions | `POST /workspaces/:ws/documents/:id/versions/:vid/restore` | JWT | editor | Copies into a new version |
| versions | `GET /workspaces/:ws/documents/:id/versions/:vid/diff?with=` | JWT | restricted | Text diff (P1) |
| versions | `PUT /workspaces/:ws/documents/:id/versions/:vid/text` | JWT | editor | OCR/PDF text + pages from browser |
| versions | `PUT /workspaces/:ws/documents/:id/versions/:vid/chunks` | JWT | editor | Chunk texts + embeddings (batched) |
| metadata | `GET/PUT /workspaces/:ws/documents/:id/metadata` | JWT | restricted / editor | Confirmed values |
| metadata | `POST /workspaces/:ws/documents/:id/suggestions` | JWT | editor | Bulk insert from browser extractor |
| metadata | `POST /workspaces/:ws/documents/:id/suggestions/:sid/accept` `/reject` | JWT | editor | |
| metadata | `POST /workspaces/:ws/documents/:id/suggest-with-ai` | JWT | editor | Uses user's AI key (P1) |
| metadata | `GET/POST/PATCH/DELETE /workspaces/:ws/custom-fields` | JWT | viewer / admin | Definitions |
| search | `POST /workspaces/:ws/search` | JWT | restricted | `{q, embedding?, filters, cursor}`; hybrid pipeline |
| search | `POST /workspaces/:ws/search/image` | JWT | restricted | `{phash, ocrText, embedding?}` |
| search | `GET /workspaces/:ws/search/suggest?q=` | JWT | restricted | People, tags, types (trigram) |
| search | `GET/POST/DELETE /workspaces/:ws/saved-searches` | JWT | restricted | |
| albums | `GET/POST /workspaces/:ws/albums` | JWT | viewer / editor | |
| albums | `GET/PATCH/DELETE /workspaces/:ws/albums/:id` | JWT | viewer / editor | |
| albums | `PUT /workspaces/:ws/albums/:id/items` | JWT | editor | Manual albums |
| albums | `PUT /workspaces/:ws/albums/:id/rules` | JWT | editor | Smart albums; `GET /albums/:id/preview` |
| reminders | `GET/POST /workspaces/:ws/reminders` | JWT | viewer / editor | |
| reminders | `PATCH/DELETE /workspaces/:ws/reminders/:id` | JWT | editor | |
| reminders | `GET /workspaces/:ws/reminders/upcoming?days=30` | JWT | restricted | Home "Expiring soon" |
| sharing | `GET/POST /workspaces/:ws/shares` | JWT | editor | member, group or link |
| sharing | `DELETE /workspaces/:ws/shares/:id` | JWT | editor (own) / admin | Revoke |
| sharing | `GET /s/:token` | none (rate limited) | - | Public metadata; 404 on unknown/expired |
| sharing | `POST /s/:token/unlock` | none (rate limited) | - | `{password}` -> short-lived signed file URLs |
| activity | `GET /workspaces/:ws/activity?member=&action=&from=&to=` | JWT | viewer (own) / admin (all) | |
| notifications | `POST /workspaces/:ws/notifications/test` | JWT | admin | Sends a test email via Brevo |
| rag | `POST /workspaces/:ws/ask` | JWT | restricted | `{question, embedding, documentId?, provider?}`; streams answer + citations |
| rag | `POST /workspaces/:ws/ask/compare` | JWT | restricted | `{documentId, versionA, versionB, question}` (P1) |
| notes | `GET/POST /workspaces/:ws/notes` | JWT | viewer / editor | |
| notes | `GET/PATCH/DELETE /workspaces/:ws/notes/:id` | JWT | viewer / editor | Autosave uses PATCH with `updated_at` check |
| notes | `PUT /workspaces/:ws/notes/:id/links` | JWT | editor | |
| notes | `PUT /workspaces/:ws/notes/:id/chunks` | JWT | editor | Embeddings for notes |
| vault (Chaabi) | `GET /vault` | JWT | - | Vault status, salts, wrapped keys, lock state (no secrets) |
| vault | `POST /vault/setup` | JWT | - | `{pinSalt, pinWrappedKey, pinWrapIv, verifierSalt, pinVerifier, recoveryEnabled, vaultKeyForRecovery?}` |
| vault | `POST /vault/verify` | JWT (rate limited) | - | `{pinVerifier}`; enforces lockout; returns `pin_wrapped_key` on success |
| vault | `POST /vault/change-pin` | JWT | - | Current verifier + new salts/wrapped key/verifier |
| vault | `POST /vault/recovery/request` | JWT (rate limited) | - | Sends OTP via Brevo |
| vault | `POST /vault/recovery/verify` | JWT (rate limited) | - | `{code}` -> one-time reset token (5 min) |
| vault | `POST /vault/recovery/reset` | JWT | - | `{resetToken, newPinSalt, newVerifierSalt, newPinVerifier, ephemeralPublicKey}` (section 21.6) |
| vault | `PATCH /vault/settings` | JWT | - | auto_lock_seconds, recovery_enabled (needs current verifier) |
| vault | `GET/POST /vault/items`, `GET/PATCH/DELETE /vault/items/:id` | JWT | - | Ciphertext only |
| vault | `GET /vault/items/:id/history`, `DELETE /vault/items/:id/history/:hid` | JWT | - | |
| vault | `POST /vault/items/:id/restore` | JWT | - | From trash (P1) |
| vault | `GET /vault/export` / `POST /vault/import` | JWT | - | Encrypted blob (P1) |
| vault | `GET /vault/activity` | JWT | - | Unlock, PIN change, reset, add, change, delete |
| admin | `GET /workspaces/:ws/admin/storage` | JWT | admin | Per-type usage and free-tier warnings |
| admin | `POST /workspaces/:ws/admin/export` | JWT | owner | Zip + JSON job (P1) |
| admin | `POST /workspaces/:ws/admin/purge-trash` | JWT | admin | |
| admin | `POST /workspaces/:ws/admin/reindex` | JWT | admin | Marks versions for re-OCR/re-embed |
| cron | `scheduled()` | Cloudflare | - | Every 6 h: keep-alive; daily 02:30 UTC: reminders, trash purge, orphan cleanup, expired OTP purge |

Middleware order in `worker/src/index.js`: `cors(ALLOWED_ORIGINS)` -> `secureHeaders` -> `requestId` -> `auth` (skips `/health`, `/s/*`, `/files/*`) -> `rateLimit` (route-specific) -> `validate(zod)` -> handler -> `errorHandler`.

## 9. Authentication flow

```
 Browser (React)             Supabase Auth              Worker (Hono)                 PostgreSQL
      |                           |                          |                              |
      |-- signUp(email,pw) ------>|                          |                              |
      |<- "check your email" -----|   (verification mail)    |                              |
      |-- click verify link ----->|                          |                              |
      |<- session {access_token (JWT ES256, 1 h), refresh_token}                            |
      |   stored by supabase-js in localStorage (survives PWA restart)                       |
      |                           |                          |                              |
      |-- GET /api/v1/me  Authorization: Bearer <JWT> ------>|                              |
      |                           |                          |-- kid in JWT header?         |
      |                           |<-- GET /auth/v1/.well-known/jwks.json (cached 10 min) --|
      |                           |--- JWKS (ES256 public keys) --------------------------->|
      |                           |                          |-- verify signature, exp,     |
      |                           |                          |   iss = SUPABASE_URL/auth/v1,|
      |                           |                          |   aud = 'authenticated'      |
      |                           |                          |-- userId = payload.sub       |
      |                           |                          |-- select memberships ------->|
      |                           |                          |<-----------------------------|
      |<-- 200 {profile, workspaces[], terminology} ---------|                              |
      |                           |                          |                              |
      |   ... 55 min later, token near expiry ...            |                              |
      |-- supabase-js auto refresh (refresh_token) -------->|                              |
      |<-- new JWT ---------------|                          |                              |
      |                           |                          |                              |
      |-- request gets 401 {code:'token_expired'} ----------|                              |
      |-- baseApi: refreshSession() once, then retry ------->|                              |
```

Worker verification details (`worker/src/lib/auth.js`):

1. Read `Authorization: Bearer <jwt>`. Missing -> 401 `{code:'no_token'}`.
2. Decode the header. If `alg === 'ES256'` and `kid` is present, fetch the JWKS from
   `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` (cached in a module-level Map with 10 minute TTL and
   re-fetched once on unknown `kid`). Verify with `jose`'s `jwtVerify` and the matching JWK.
3. **HS256 fallback**: if `alg === 'HS256'` (older Supabase projects, or a project that has not rotated to
   asymmetric keys) and `SUPABASE_JWT_SECRET` is set, verify with that secret. If the secret is not set, reject.
4. Check `exp`, `iss`, `aud`. Reject `role !== 'authenticated'`.
5. `c.set('user', { id: payload.sub, email: payload.email })`. The user id is only ever read from here.
6. For workspace routes, `requireMember(ws, minRole)` loads the member row once per request and caches it in
   `c.var`.

Browser side:

- `services/supabase/auth.js` listens to `onAuthStateChange` and writes `{user, session}` into the `auth` slice.
- `RequireAuth` guard redirects to `/login?next=`. `RequireWorkspace` loads `/me` and picks
  `profile.last_workspace_id` or shows `/w`.
- Password reset and magic link land on `/reset-password` and `/verify` where `supabase.auth.exchangeCodeForSession()` runs.
- On sign out: clear Redux, clear Dexie `recentCache` and `drafts` that belong to the user, lock Chaabi.

## 10. Upload flow

```
 Browser                                                      Worker                    R2        DB
   |                                                            |                       |         |
   | 1. pick/capture file(s); uploadId = crypto.randomUUID()    |                       |         |
   | 2. HEIC -> JPEG; images re-encoded; compress (<1.5 MB/page)|                       |         |
   | 3. SHA-256 (streaming, WebCrypto) + pHash for images        |                       |         |
   | 4. thumbnail 320px WEBP (canvas)                            |                       |         |
   | 5. write Dexie pendingUploads {uploadId, blobs, meta, state:'saved'}                |         |
   |                                                            |                       |         |
   | 6. POST /documents/check-duplicates {sha256, phash} ------>|-- query sha/phash ------------->|
   |<-- {matches:[...]} (show dialog if any) -------------------|                       |         |
   |                                                            |                       |         |
   | 7. POST /uploads {uploadId, sha256, size, mime, role} ---->|-- upsert upload_sessions ------>|
   |<-- {uploadId, status:'started'}  (same id twice = same row)|                       |         |
   |                                                            |                       |         |
   | 8. POST /uploads/:id/file  (multipart stream) ------------>|-- magic bytes check   |         |
   |                                                            |-- FILES.put(key) ---->|         |
   |                                                            |-- session -> 'stored' ----------|
   |<-- {status:'stored', r2Key}                                |                       |         |
   |    (repeat 7-8 for original, processed, thumbnail, pdf)    |                       |         |
   |                                                            |                       |         |
   | 9. POST /uploads/:id/commit {title, docType, files:[...]} ->|-- transaction:        |         |
   |                                                            |   documents + version 1         |
   |                                                            |   document_files rows           |
   |                                                            |   activity_logs 'uploaded'      |
   |                                                            |   session -> 'committed' ------>|
   |<-- {documentId, versionId}                                 |                       |         |
   | 10. Dexie state 'uploaded'; toast "Uploaded"; start OCR (section 11)                |         |
```

Rules:

- **Idempotent ids.** `uploadId` is generated in the browser and is the primary key of `upload_sessions`. Retrying
  step 7 or 8 after a network drop returns the existing state instead of creating a second file. Commit is
  idempotent too: if the session is already `committed`, the same `{documentId, versionId}` is returned.
- **Order of writes.** R2 first, DB rows last. A crash between them leaves a `stored` session; the daily
  `cleanupOrphans` cron deletes R2 objects for sessions older than 24 hours that never committed.
- **Size and type.** Browser refuses files above 25 MB before uploading. Worker enforces `Content-Length` and
  magic bytes; a mismatch deletes the object and returns 415.
- **Multi-page scans.** One document, one version, N `processed` files with `page_index`, N `original` files,
  N thumbnails, optionally one `pdf` file built with pdf-lib in the browser.
- **New version.** Same flow with `documentId` and a freshly created `versionId` from `POST /documents/:id/versions`.
- **Offline queue.** If `navigator.onLine` is false or step 7 fails with a network error, the Dexie row stays
  `saved` and the UI shows "Saved on this device. Will upload when online." `services/offline/sync.js` retries on
  `online` event and on app start with exponential backoff (5 s, 30 s, 2 min, 10 min). Never mark `uploaded` before
  the commit response arrives. Background Sync registers a `sync` tag where supported.
- **Storage meter.** Commit adds `size_bytes` to `workspaces.storage_bytes` via trigger on `document_files`.

## 11. OCR flow

```
 after commit (or on "Read text again")
   |
   v
 Is the file a PDF?
   |-- yes --> PDF.js getTextContent() per page
   |           page text length > 50 chars and not only symbols? --> use it (source='pdf_text')
   |           otherwise render page to canvas at 150-200 dpi --> OCR that page
   |-- no  --> image (processed file, not the original) --> OCR
   |
   v
 Tesseract.js in ocr.worker.js (Web Worker; lang from workspace.ocr_languages; traineddata cached by SW)
   progress -> "Reading text from this document... 40%"
   |
   v
 cleanText(): fix line breaks, join hyphenated words, collapse spaces, strip OCR noise (|, ~, repeated punctuation)
   |
   v
 PUT /documents/:id/versions/:vid/text
   { pages:[{page, textRaw, textClean, confidence, language, source, wordBoxes?}], status:'done'|'failed' }
   |
   v
 Worker writes document_pages + document_versions.ocr_text/ocr_clean_text/ocr_confidence/ocr_status
 -> triggers text_vector and documents.search_vector refresh
   |
   v
 then: metadata extraction (section 4.3 suggestions) and chunk embedding (section 5, 12)
```

Rules:

- **Never block save.** The document is committed and visible before OCR starts. OCR runs in the background,
  the user can leave the page, and the queue continues from Dexie `pendingUploads.ocrState` if the tab was closed.
- **Status words.** `pending` -> "Reading text from this document..."; `done` -> "Document is ready to search";
  `failed` -> "We could not read the text. You can still search by name." with buttons "Try again" and "Type the text".
- **Manual text.** "Type the text" saves with `source='manual'`, `ocr_status='manual'`.
- **Word boxes** are stored only when the page has fewer than 2,000 words (JSON stays under ~200 KB); otherwise `null`.
- **Language.** English is always loaded; Hindi (`hin`) and others download on demand with a size warning
  and are cached by the service worker.
- **Free-tier guard.** OCR text is stored once per version (not per document), and `document_pages.text_raw` is
  dropped when `text_clean` is confirmed unchanged after 30 days (P2 cleanup).

## 12. Search flow

One request `POST /workspaces/:ws/search` with `{q, embedding?, filters, cursor}`. The embedding is computed in the
browser (Transformers.js) at the same time the request is prepared; if the model is not ready in 300 ms the request
goes without it and vector results are skipped (keyword search still works).

### 12.1 Pipeline

```
 "dad passport"
     |
     v
 1. normalise         lower-case, trim, NFKC, remove punctuation except - / . , keep digits
     |
     v
 2. detect            relationship words  : dad, papa, father, mom, mummy, wife, son ...  -> personIds via person_relationships
                      type words          : passport, invoice, aadhaar, policy, marksheet -> docType filter (soft)
                      date words          : "last year", "2026", "september", "sept 2025" -> date range (soft)
                      numbers             : N1234567, INV-2025-091, PAN pattern -> exact number lookup
                      organisation words  : matched against distinct documents.organisation (trigram)
                      remaining tokens    : "passport" (if type word already used, keep it in FTS too)
     |
     v
 3. run in parallel (all inside SQL with workspace + can_view_document filters)
     a. FTS       : documents.search_vector || document_versions.text_vector  @@ websearch_to_tsquery('simple', q)
                     ranked by ts_rank_cd; plus pg_trgm: similarity(title, q) > 0.3 for typos ("pasport")
     b. Vector    : search_chunks(ws, user, embedding, 40) -> best chunk per document
     c. Metadata  : documents matching detected filters (personIds, docType, date range, organisation)
     d. Exact     : title ilike, document_metadata.numbers ->> value = number, people.full_name = token
     |
     v
 4. Reciprocal Rank Fusion   score(doc) = sum over lists L of  1 / (k + rank_L(doc)),  k = 60
     |
     v
 5. exact boosting          +0.05 exact person match, +0.05 exact doc type, +0.10 exact number, +0.03 title equals q
     |
     v
 6. hard filters            user-chosen filters (person, group, type, date, expiry, uploaded by, tags, file type)
                             are applied as WHERE clauses in step 3, not after
     |
     v
 7. response                 [{document, score, matched:["Rajesh Patel","Passport"], snippet, page}]
```

RRF example with k = 60. Document X is rank 1 in FTS, rank 3 in vector, rank 1 in metadata:

```
score(X) = 1/(60+1) + 1/(60+3) + 1/(60+1) = 0.01639 + 0.01587 + 0.01639 = 0.04866
```

A document that appears in only one list at rank 1 gets 0.01639, so agreement between lists wins, which is the
point of RRF: no list's raw score needs calibrating.

### 12.2 "dad passport" resolved through `person_relationships`

1. Current user `u1` has `workspace_members.person_id = p_meena`.
2. Relationship word `dad` maps to relations `{father, parent(male)}` in `constants/relationships.js`.
3. SQL: `select from_person_id from person_relationships where workspace_id = ws and to_person_id = p_meena and relation in ('father')`
   -> `p_rajesh`. If the user has no linked person, the word is treated as plain text and the UI suggests
   "Link yourself to a person to use words like dad or mom".
4. Type word `passport` -> `doc_type = 'passport'` (soft filter and FTS token).
5. List c (metadata) = documents where `document_people.person_id = p_rajesh` and `doc_type = 'passport'`, ranked
   by `updated_at desc`. List a (FTS) matches "passport" in title/OCR. List b (vector) matches "travel document".
6. RRF fuses; exact boosting adds +0.05 for person and +0.05 for type. Rajesh Patel's passport lands at rank 1
   with `matched: ["Rajesh Patel (dad)", "Passport"]`.

Voice search feeds recognised text into the same box. Image search runs pHash + OCR in the browser and calls
`/search/image`, which fuses `phash` hamming distance (<= 10), FTS on the OCR text and vector search the same way.
Notes are included by unioning `notes.search_vector` and `document_chunks.source_type = 'note'` into lists a and b.

## 13. RAG flow ("Ask your documents")

```
 question "When does Dad's passport expire?"
     |
     v
 1. browser: embed question (384) ; POST /ask {question, embedding, documentId?}
     |
     v
 2. Worker: permission-first retrieval
      - same hybrid pipeline as section 12 with the question as q  (workspace + can_view inside SQL)
      - if documentId is given: restrict to that document's current version
      - take top 8 chunks (max 1,000 chars each), plus document_metadata of the top 3 documents as short facts
        ("Rajesh Patel - Passport - expiry 2030-01-04")
      - if no chunk scores above 0.25 cosine AND no FTS hit -> return the fixed sentence, do not call the AI
     |
     v
 3. build prompt (below), call AIProvider with the user's key, stream tokens back (SSE)
     |
     v
 4. parse citations [n] -> {documentId, versionId, page}; UI renders chips; tap opens viewer at that page
     |
     v
 5. activity_logs 'asked' with question length only (never the question text unless log_questions feature is on)
```

Chunking rules (`services/embedding/chunker.js`, same rules for notes):

- Chunk by page first. Inside a page, split on blank lines, then sentences, target 600 characters, hard cap 1,000, overlap 80 characters.
- Prefix each chunk with a short header: `"<title> | <doc type> | page <n>"` so the vector carries context.
- Skip chunks under 40 characters. Written documents chunk from `content_text`.
- `content_hash` prevents re-embedding unchanged chunks on a new version.

Prompt shape:

```
system:
  You answer questions using only the provided document excerpts. Cite every fact as [n] where n is the excerpt number.
  If the excerpts do not contain the answer, reply exactly: "I could not find that information in your documents."
  Do not guess. Keep answers short and in plain language.

user:
  Question: When does Dad's passport expire?

  Excerpts:
  [1] Rajesh Patel - Passport - page 2 (doc 9b7e..., version 41aa...)
      "... Date of expiry 04/01/2030 ..."
  [2] Rajesh Patel - Passport - facts
      "expiry_date: 2030-01-04; number: N1234567"
  [3] ...
```

Fixed not-found sentence: `I could not find that information in your documents.` The Worker also checks the
model's output; if it contains no citation and is not this sentence, the UI shows it with a warning "This answer has no sources."

AIProvider abstraction (`worker/src/lib/ai.js` and `frontend/src/services/ai/provider.js`):

```js
// interface
{ name, chat({ system, messages, maxTokens, stream }) -> AsyncIterable<string>, test() -> {ok, model} }
```

| Provider | Endpoint | Default model | Notes |
|---|---|---|---|
| openai | `https://api.openai.com/v1/chat/completions` | `gpt-4o-mini` | SSE streaming |
| gemini | `https://generativelanguage.googleapis.com/v1beta/models/{m}:streamGenerateContent` | `gemini-2.0-flash` | |
| anthropic | `https://api.anthropic.com/v1/messages` | `claude-haiku` family | `anthropic-version` header |
| groq | `https://api.groq.com/openai/v1/chat/completions` | `llama-3.1-8b-instant` | OpenAI-compatible |
| local | user `base_url` (Ollama/LM Studio) | user choice | Called from the **browser**, not the Worker, since localhost is not reachable from Cloudflare |

Keys: pasted in Settings > AI provider, sent once over HTTPS to `PUT /me/ai-keys`, encrypted with AES-256-GCM
using `HKDF-SHA256(ikm = FILE_URL_SIGNING_SECRET, salt = 'ai-keys', info = userId)`, stored in `ai_provider_keys`.
Decrypted only inside the `/ask` handler, held in a local variable, never logged, never returned. Without a key
the Ask tab shows "Add your AI key in Settings to ask questions" and the rest of search works.

## 14. Mobile navigation

```
 +--------------------------------------------------+
 |  [ws icon] Family            [bell] [avatar]     |   top bar (workspace name from terminology)
 |--------------------------------------------------|
 |                                                  |
 |   page content (scrolls)                         |
 |                                                  |
 |   Right panel content (details) opens as a       |
 |   bottom Sheet on mobile                         |
 |                                                  |
 |--------------------------------------------------|
 |  Home     Search    ( SCAN )   Documents   More  |   bottom bar, 5 items, 44px+ targets
 |  house    magnifier  camera    files       dots  |   Scan is a raised 64px circle button
 +--------------------------------------------------+

 More (bottom sheet):
   People | Groups | Albums | Notes | Chaabi | Reminders | Activity | Settings | Switch workspace | Account
   (labels come from workspace_terminology: "Family Members", "Family Groups" ...)
```

- Scan opens full-screen camera (`/w/:ws/scan`), bottom bar hidden; back gesture asks "Discard pages?" if any exist.
- Search page: box with mic and image buttons under it, filter chips scroll horizontally, "Ask" is a tab inside Search.
- Document page: viewer full width, tabs under it: Details, Versions, Timeline, Ask, Related. Primary actions (Share, Edit, More) in a sticky bottom action bar.
- Long-press on a document card opens a context sheet; multi-select mode for tagging and album adding.
- PWA share target (`POST /share-target` handled by the service worker) opens `/w/:ws/upload` with the shared files.

## 15. Desktop navigation

```
 +----------------+---------------------------------------------------+------------------+
 | [ws switcher]  |  [ search box .......................... mic img ] [bell] [avatar]  |
 |                |---------------------------------------------------+------------------|
 | Home           |                                                   |  Details panel   |
 | Search         |                                                   |  (optional,      |
 | Documents      |   main content                                    |   resizable,     |
 | People*        |   (grid/list, viewer, editor ...)                 |   remembers      |
 | Groups*        |                                                   |   open/closed)   |
 | Albums         |                                                   |                  |
 | Notes          |                                                   |                  |
 | Chaabi         |                                                   |                  |
 | Reminders      |                                                   |                  |
 | Activity       |                                                   |                  |
 | Settings       |                                                   |                  |
 |                |                                                   |                  |
 | [+ Upload]     |                                                   |                  |
 | [Scan (QR to   |                                                   |                  |
 |  phone)]       |                                                   |                  |
 +----------------+---------------------------------------------------+------------------+
   * labels from terminology (Employees / Departments, Students / Classes ...)
```

- Sidebar 240 px, collapsible to icons at < 1280 px; tablet portrait shows bottom bar instead.
- Keyboard: `/` focuses search, `u` upload, `n` new note, `Esc` closes panel, arrows move in grid, `Enter` opens.
- Drag-and-drop files anywhere on Documents or Home starts the upload queue.
- Right panel shows document details, person details or album details depending on selection; on the Document page it holds Details/Versions/Timeline tabs.
- Scan on desktop shows a QR code that opens `/w/:ws/scan` on the phone (same account); webcam capture is a fallback.

## 16. Complete page list

| Route | Page component | Guard | Notes |
|---|---|---|---|
| `/` | `Landing` | public | Aceternity hero, feature scroll, install prompt; signed-in users are redirected to `/w` |
| `/login` | `Login` | public | Email + password, magic link (P1), Google (P2) |
| `/signup` | `Signup` | public | |
| `/forgot-password` | `ForgotPassword` | public | |
| `/reset-password` | `ResetPassword` | code in URL | |
| `/verify` | `Verify` | code in URL | Email verification landing |
| `/onboarding` | `Onboarding` | auth | "What are you organising?" cards with Motion; creates first workspace |
| `/w` | `WorkspaceSwitcher` | auth | List, create, accept invite |
| `/w/:ws` | `Home` | member | Search box, Scan, Upload, Recent, People, Groups, Albums, Favourites, Expiring soon |
| `/w/:ws/search` | `Search` | member | Box, mic, image, filters, results, Ask tab |
| `/w/:ws/scan` | `Scan` | editor | Camera, crop, filters, pages, save |
| `/w/:ws/upload` | `Upload` | editor | Picker, queue, duplicate check |
| `/w/:ws/documents` | `Documents` | member | Grid/list, filters, sort, infinite scroll |
| `/w/:ws/documents/trash` | `Trash` | editor | Restore, purge (admin) |
| `/w/:ws/documents/:id` | `DocumentView` | can_view | Viewer, details, versions, timeline, ask, related |
| `/w/:ws/documents/:id/edit` | `DocumentEdit` | editor | Tiptap for written/text docs; page tools for scans/PDF |
| `/w/:ws/people` | `People` | member | Directory, search, add |
| `/w/:ws/people/:id` | `Person` | member | Documents of this person, relationships, groups, custom fields |
| `/w/:ws/groups` | `Groups` | member | Tree |
| `/w/:ws/groups/:id` | `Group` | member | Members, subgroups, documents |
| `/w/:ws/albums` | `Albums` | member | Manual and smart |
| `/w/:ws/albums/:id` | `Album` | member | Items, cover, rules |
| `/w/:ws/notes` | `Notes` | member | List, search, pin, colour |
| `/w/:ws/notes/:id` | `Note` | member | Editor, links, private toggle |
| `/w/:ws/chaabi` | `Chaabi` | auth (per user) | PIN screen, list, item, generator, history, settings, forgot PIN |
| `/w/:ws/reminders` | `Reminders` | member | Upcoming, done, create |
| `/w/:ws/activity` | `Activity` | member (own) / admin (all) | Filters by member, action, date |
| `/w/:ws/settings` | `settings/General` | admin | Name, icon, default visibility |
| `/w/:ws/settings/terminology` | `settings/Terminology` | admin | |
| `/w/:ws/settings/members` | `settings/Members` | admin | Members, invites, roles |
| `/w/:ws/settings/roles` | `settings/Roles` | owner | Role matrix (read-only in V1) |
| `/w/:ws/settings/features` | `settings/Features` | admin | Face grouping, AI, semantic search, download logging, OCR languages |
| `/w/:ws/settings/ai` | `settings/AiProvider` | member | Per-user key (the page is under settings but the key belongs to the user) |
| `/w/:ws/settings/storage` | `settings/Storage` | admin | Usage meter, free-tier warnings, export |
| `/w/:ws/settings/danger` | `settings/DangerZone` | owner | Delete workspace, transfer ownership |
| `/account` | `Account` | auth | Profile, security, sessions, language, large text |
| `/s/:token` | `PublicShare` | none | Viewer for shared link; password prompt if set |
| `*` | `NotFound` | - | |

## 17. Environment variables

### Frontend (`frontend/.env.local`, all public, safe to ship)

| Variable | Example | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://abcd1234.supabase.co` | Supabase project URL for auth |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` (or legacy `anon` JWT) | Public client key; RLS protects data |
| `VITE_API_URL` | `http://localhost:8787` locally, `https://dastavault-api.<you>.workers.dev` in production | Worker base URL (without `/api/v1`) |

Never put a service-role key, a Brevo key or any signing secret in a `VITE_` variable: Vite inlines them into the public bundle.

### Worker secrets (`npx wrangler secret put NAME`; locally in `worker/.dev.vars`)

| Secret | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes | Also used to build the JWKS URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-side DB access (bypasses RLS) |
| `SUPABASE_JWT_SECRET` | optional | HS256 fallback for projects without asymmetric keys |
| `FILE_URL_SIGNING_SECRET` | yes | HMAC for signed file URLs; also HKDF ikm for AI key encryption. 32+ random bytes, base64 |
| `VAULT_RECOVERY_SECRET` | yes | HKDF ikm for Chaabi recovery keys. 32+ random bytes. **Losing it disables PIN reset for everyone; back it up** |
| `BREVO_API_KEY` | yes | Transactional email |
| `BREVO_SENDER_EMAIL` | yes | Verified sender, e.g. `no-reply@yourdomain.com` |
| `BREVO_SENDER_NAME` | yes | e.g. `DastaVault` |

### Worker vars (`[vars]` in `wrangler.toml`, not secret)

| Var | Example | Purpose |
|---|---|---|
| `ALLOWED_ORIGINS` | `http://localhost:5173,https://dastavault.pages.dev` | CORS allow list, comma separated, exact origins |
| `APP_URL` | `https://dastavault.pages.dev` | Links in emails (invites, reminders, share links) |
| `MAX_UPLOAD_BYTES` | `26214400` | 25 MB |
| `SIGNED_URL_TTL_SECONDS` | `300` | |

Bindings in `wrangler.toml`: `[[r2_buckets]] binding = "FILES" bucket_name = "document-manager-files"`, `[triggers] crons = ["0 */6 * * *", "30 2 * * *"]`.

Generate secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

## 18. Free deployment steps (summary)

1. Supabase: create project, enable `vector` and `pg_trgm`, run `backend/migrations/*.sql` in order, then `backend/seed/*.sql`. Copy URL and publishable key. Set Auth site URL and redirect URLs.
2. Cloudflare: `npx wrangler login`, `npx wrangler r2 bucket create document-manager-files`, set secrets with `npx wrangler secret put`, set `ALLOWED_ORIGINS` and `APP_URL` in `wrangler.toml`, `npx wrangler deploy`.
3. Brevo: create account, verify a sender, create an API key, put it in Worker secrets.
4. Frontend: fill `.env.local`, `npm run dev` to test, then connect the Git repo to Cloudflare Pages (root `frontend`, build `npm run build`, output `dist`, env vars `VITE_*`).
5. Update `ALLOWED_ORIGINS` and Supabase redirect URLs with the final `*.pages.dev` URL and redeploy the Worker.
6. Confirm the keep-alive cron hits `/health/db` every 6 hours so the Supabase free project does not pause.

Every step with screenshots-level detail, commands and troubleshooting is in [SETUP.md](SETUP.md).

## 19. MVP development phases

| Phase | Scope | Acceptance test (from PRD 13) |
|---|---|---|
| 1 | App shell, routing, theme, Supabase Auth (sign up, verify, sign in, reset), profiles, workspaces, terminology templates, members, invites via Brevo, groups, people, relationships, roles | A user signs up, creates a Family, adds 4 people with relationships, invites a member, and the UI shows "Family Members" not "Employees" |
| 2 | Worker upload to R2, upload_sessions, documents + versions + files, list (grid/list), viewer (image, PDF), details panel, trash, offline upload queue, PWA install | Upload a PDF and an image from a phone; view it; move to trash; restore |
| 3 | Scanner (OpenCV.js detection, rectangle and perspective crop, filters, compression, multi-page, PDF build), OCR (PDF.js text, Tesseract.js worker), page text storage | Photograph a tilted page; auto crop; adjust corners; save; text is readable and searchable by name |
| 4 | Rule-based metadata extraction, suggestions UI, name suggestion, person fuzzy match, tags, people/group links, duplicate detection (sha256, pHash, numbers) | Passport scan is named "Name - Passport - YYYY", linked to the right person; uploading it again warns about duplicate |
| 5 | Full-text search (tsvector + websearch), pg_trgm typo tolerance, query parser (relationship, type, date, number words), filters, saved searches | "dad passport" finds Rajesh Patel's passport; typo "pasport" still finds it |
| 6 | Transformers.js embeddings in a Web Worker, document_chunks, `search_chunks()`, hybrid RRF + exact boosting, "why it matched" | "travel document for father" finds the passport by meaning |
| 7 | Versions (upload, restore, compare P1), timeline sentences, reminders + daily Brevo email cron, albums (manual, person, type, group, event), sharing (member, group, link) | Upload version 2; timeline lists it; expiry reminder email arrives |
| 8 | Ask your documents (RAG, AIProvider, encrypted keys), voice search, image search, smart albums, optional face grouping (P2) | "When does Dad's passport expire?" answers with page citation; unknown question returns the fixed sentence |
| 9 | Chaabi (PIN setup, vault crypto, items, history, generator, lockout, OTP reset, no-recovery mode), Notes (Tiptap, autosave, offline drafts, links), Write a document, edit uploaded text docs, page tools for scans/PDF | Set PIN; add password; change it; old password appears in history; forget PIN; receive OTP by email; set new PIN; passwords intact. Write a document; edit; version 2 created |

## 20. Security checklist

- [ ] Supabase JWT verified on every Worker request (JWKS ES256, HS256 fallback only with secret set); `sub` is the only source of user id
- [ ] `requireMember(ws, minRole)` runs before every workspace route handler; client-supplied workspace id in bodies is ignored
- [ ] RLS enabled on all `public` tables; helper functions are `security definer` with `search_path = public`
- [ ] Service-role key only in Wrangler secrets / `.dev.vars`; `.dev.vars` in `.gitignore`
- [ ] No secret in any `VITE_` variable; `.env.local` in `.gitignore`
- [ ] R2 bucket private; no public bucket URL or custom domain; reads only via 5-minute HMAC signed Worker URLs
- [ ] Presigned PUT (P1) expires in 10 minutes, one key, size condition, issued after permission check
- [ ] Object keys are UUIDs; filenames sanitised before storage in metadata; `Content-Disposition` filename escaped
- [ ] MIME verified by magic bytes; size limit 25 MB enforced in Worker; HEIC converted in browser; SVG never accepted as an image
- [ ] Every SQL query includes `workspace_id`; documents fetched with `can_view_document()`; no lookup by bare id
- [ ] Search, vector search and RAG retrieval filter workspace and permissions inside SQL (`search_chunks()`), never after
- [ ] Rate limits: `/vault/verify` 10/min per user, `/vault/recovery/*` 3/10 min per user and IP, `/s/:token/unlock` 5/min per IP, `/invites/accept` 10/h per user, auth-sensitive routes return 429 with `Retry-After`
- [ ] Security headers on Pages (`_headers`) and Worker: CSP (`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://*.supabase.co https://<worker>; img-src 'self' blob: data: https://<worker>; worker-src 'self' blob:`), HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), microphone=(self), geolocation=()`
- [ ] Rich text sanitised with DOMPurify on save (browser) and on render; Worker re-sanitises `content_html` with a server-side allow list
- [ ] Share links: token 32 random bytes, only SHA-256 hash stored, optional password hashed with PBKDF2, expiry and revoke checked on every request, 404 for unknown and expired
- [ ] Chaabi: PIN never leaves the device; verifier uses a separate salt; server lockout 5 attempts -> 30 s doubling; OTP hashed, single-use, 10 minutes, 5 attempts, one active; reset token single-use 5 minutes; vault key never written to disk in the Worker
- [ ] AI keys encrypted with AES-256-GCM (HKDF-derived per-user key), never logged, never returned; AI provider receives only retrieved chunks
- [ ] Activity logs never contain secrets, passwords, OCR text or question text (unless feature enabled)
- [ ] Invite tokens hashed; expire in 7 days; accepting requires the invited email to match the signed-in user
- [ ] Dependencies pinned in lockfiles; `npm audit --audit-level=high` in CI; Wrangler and supabase-js updated monthly
- [ ] Trash purge and orphan cleanup crons verify `workspace_id` prefix before `FILES.delete()`
- [ ] Error responses carry a stable `code` and no stack traces in production
- [ ] Cross-workspace test suite: a user in workspace A calls every route with ids from workspace B and receives 403/404 every time

## 21. Chaabi password keeper cryptography

All primitives come from WebCrypto (`crypto.subtle`) in the browser and in the Worker. Wording in the UI is
"Locked with your PIN"; none of the terms below are shown to users.

### 21.1 Keys

| Key | Where made | How | Stored |
|---|---|---|---|
| **Vault Key (VK)** | Browser, once at setup | `crypto.getRandomValues(32 bytes)` | Never in clear. Only wrapped copies (below). Held in memory (Redux `vault` slice, non-persisted) while unlocked |
| **PIN Key (PK)** | Browser, each unlock | `PBKDF2-SHA256(pin, pin_salt (16 bytes), 600,000 iterations)` -> 256-bit AES-GCM key, `extractable=false` | Never stored |
| **PIN Verifier (PV)** | Browser, each unlock | `PBKDF2-SHA256(pin, verifier_salt (16 bytes, different from pin_salt), 600,000 iterations)` -> 32 bytes | Sent to server; server stores it and compares with constant-time equality |
| **Recovery Key (RK)** | Worker only | `HKDF-SHA256(ikm = VAULT_RECOVERY_SECRET, salt = 'chaabi-recovery-v1', info = userId, 32 bytes)` -> AES-GCM key | Never stored; re-derived on demand |
| **Item keys** | none | Items are encrypted directly with VK | - |

Why two PBKDF2 outputs from one PIN: the server must be able to count wrong attempts, but it must not hold
anything that unwraps the vault. PV and PK use different salts, so knowing PV gives no information about PK
(PBKDF2 outputs with different salts are independent for an attacker who does not have the PIN). A 6-digit PIN
has only 1,000,000 possibilities, so offline brute force of PV would take about 1,000,000 x 600k iterations; the
server-side lockout is the real protection, and the PIN is never sent.

### 21.2 Setup (first use)

```
Browser                                                   Worker                       DB
  | PIN entered twice (4-6 digits, 6 recommended)            |                          |
  | VK  = random 32 bytes                                    |                          |
  | pin_salt, verifier_salt = random 16 bytes each           |                          |
  | PK  = PBKDF2(pin, pin_salt, 600000)                      |                          |
  | pin_wrapped_key = AES-256-GCM(PK, iv1, VK)               |                          |
  | PV  = PBKDF2(pin, verifier_salt, 600000)                 |                          |
  |                                                          |                          |
  | if recovery enabled:                                     |                          |
  |   GET /vault/recovery-pubkey ---------------------------->| ECDH P-256 ephemeral    |
  |   <-- {kid, publicKey} (kept 5 min in Worker memory/KV)  |                          |
  |   shared = ECDH(browserEphemeral, workerPub) -> AES key   |                          |
  |   vk_for_recovery = AES-GCM(shared, iv2, VK)             |                          |
  |                                                          |                          |
  | POST /vault/setup {pin_salt, pin_wrapped_key, iv1,       |                          |
  |   verifier_salt, PV, recoveryEnabled,                    |                          |
  |   vk_for_recovery?, browserPub?, kid?} ----------------->| unwrap VK with ECDH key  |
  |                                                          | RK = HKDF(secret, userId) |
  |                                                          | recovery_wrapped_key =    |
  |                                                          |   AES-GCM(RK, iv3, VK)   |
  |                                                          | zero VK from memory       |
  |                                                          | insert vaults row ------->|
  |<-- 201 {vault}                                           |                          |
```

The ECDH step exists so that VK is never sent in clear even over TLS; the Worker sees VK only inside the handler
for the few milliseconds needed to wrap it with RK. If "No recovery" is chosen, `vk_for_recovery` is omitted and
`recovery_wrapped_key` stays `null`.

### 21.3 Unlock

```
Browser                                                   Worker
  | PIN entered                                              |
  | GET /vault -> {pin_salt, verifier_salt, locked_until}    |
  | if locked_until > now: show "Try again in 27 s"          |
  | PV = PBKDF2(pin, verifier_salt)                          |
  | POST /vault/verify {PV} -------------------------------->| locked? -> 423 {retryAfter}
  |                                                          | timingSafeEqual(PV, stored)?
  |                                                          |   no  -> failed_attempts++;
  |                                                          |          if failed_attempts >= 5:
  |                                                          |            lockout_level++; locked_until = now + 30s * 2^(level-1)
  |                                                          |            failed_attempts = 0
  |                                                          |          -> 401 {attemptsLeft | retryAfter}
  |                                                          |   yes -> failed_attempts = 0, lockout_level = 0
  |                                                          |          log 'vault.unlock'
  |<-- 200 {pin_wrapped_key, iv1} ---------------------------|
  | PK = PBKDF2(pin, pin_salt)                               |
  | VK = AES-GCM-decrypt(PK, iv1, pin_wrapped_key)           |   (a wrong PIN that somehow passed PV fails here: GCM tag)
  | keep VK in memory; start auto-lock timer                 |
```

Lockout sequence: 5 wrong -> 30 s, 5 more -> 60 s, then 120 s, 240 s ... capped at 24 h. The counters are
server-side so clearing browser storage does not help an attacker.

### 21.4 Items and history

- `enc_payload = AES-256-GCM(VK, iv, JSON{username, password, notes})`, fresh 12-byte IV per encryption.
- `title`, `website`, `category`, `tags` are plain so the list renders and search works without decrypting every row.
- On password change the browser encrypts the old password alone as `vault_item_history.enc_password` before
  overwriting the item. History rows are deletable by the user (`DELETE /vault/items/:id/history/:hid`).
- Clipboard: `navigator.clipboard.writeText`, then `setTimeout(30 s)` writes an empty string if the clipboard still
  contains the same value.
- `enc_version` allows a future migration to a different wrapping scheme (for example Argon2id via WASM) without
  a big-bang re-encrypt: items are re-encrypted lazily when opened.

### 21.5 Change PIN (knows current PIN)

Browser unlocks as in 21.3 (VK in memory), derives new `pin_salt`, `verifier_salt`, new PK and PV, wraps VK again,
`POST /vault/change-pin {currentPV, newPinSalt, newPinWrappedKey, newIv, newVerifierSalt, newPV}`. The server
checks `currentPV` before writing. `recovery_wrapped_key` is unchanged because VK did not change. Log `vault.pin_changed`.

### 21.6 Forgot PIN: OTP reset flow (recovery enabled)

```
Step 1  Browser: "Forgot PIN?" -> POST /vault/recovery/request
Step 2  Worker : rate limit (3 per 10 min per user and IP)
                 if recovery_enabled = false -> 400 "PIN reset is turned off for this vault"
                 invalidate any active vault_otp_codes for the user (one active code at a time)
                 code = 6 random digits (crypto), salt = 16 bytes, code_hash = PBKDF2(code, salt, 100k)
                 insert vault_otp_codes {expires_at = now + 10 min, attempts = 0}
                 Brevo: send "Your DastaVault PIN reset code is 482 913. It expires in 10 minutes.
                        If you did not ask for this, ignore this email." to the account email (from JWT)
                 log 'vault.reset_requested'
Step 3  Browser: user types the code -> POST /vault/recovery/verify {code}
Step 4  Worker : find active code; attempts++; if attempts > 5 -> consume and 429
                 hash and compare constant-time; wrong -> 401 {attemptsLeft}
                 right -> consumed_at = now; issue resetToken = random 32 bytes, stored hashed with 5 min expiry
                 respond {resetToken, workerEphemeralPublicKey, kid}
Step 5  Browser: new PIN entered twice
                 new pin_salt, verifier_salt; newPK = PBKDF2(newPin, pin_salt); newPV = PBKDF2(newPin, verifier_salt)
                 browser ephemeral ECDH P-256 key pair; shared = ECDH(browserPriv, workerPub) -> AES key
                 (the browser does not have VK yet; it sends the material the Worker needs)
                 POST /vault/recovery/reset {resetToken, newPinSalt, newVerifierSalt, newPV, browserPublicKey, kid}
Step 6  Worker : check resetToken (single use, not expired); derive RK = HKDF(VAULT_RECOVERY_SECRET, userId)
                 VK = AES-GCM-decrypt(RK, recovery_wrapped_key)          <-- the stated trade-off moment
                 encrypt VK for the browser: vk_for_browser = AES-GCM(ECDH shared key, VK)
                 store new salts and newPV; failed_attempts = 0; locked_until = null
                 respond {vk_for_browser, iv}; zero VK and shared key variables
                 log 'vault.pin_reset'
Step 7  Browser: VK = decrypt(vk_for_browser); pin_wrapped_key = AES-GCM(newPK, VK)
                 POST /vault/change-pin (variant: with resetToken instead of currentPV) to store pin_wrapped_key
                 vault is unlocked with all items intact; toast "Your PIN was changed. All passwords are kept."
Step 8  Worker : Brevo notification "Your Chaabi PIN was reset on <date> from <device>" (security notice)
```

If the browser loses connection between step 6 and 7, `recovery_wrapped_key` and items are untouched; the
user simply requests a new code. Nothing is ever deleted during reset.

### 21.7 Auto-lock rules

| Trigger | Action |
|---|---|
| 2 minutes without pointer, key or touch events on Chaabi pages (`auto_lock_seconds`, user-configurable 30 s to 10 min) | Lock |
| `visibilitychange` to hidden (app in background, phone locked) | Lock immediately |
| `pagehide` / tab close | Lock (memory is gone anyway) |
| Sign out | Lock and clear |
| Manual "Lock" button (always visible in Chaabi header) | Lock |
| Navigation away from `/w/:ws/chaabi` | Lock after 30 s grace |
| Private note opened elsewhere | Uses the same unlocked VK; same timers apply |

"Lock" means: overwrite VK bytes with zeros, drop the CryptoKey reference, clear decrypted items from Redux,
clear the clipboard if it still holds a copied password, show `LockOverlay`. Nothing about the vault is ever
written to IndexedDB or localStorage.

### 21.8 Threat model and the stated trade-off

| Threat | Protection |
|---|---|
| Database leak (Supabase compromised) | Attacker gets ciphertext, salts, PV, `recovery_wrapped_key`. Items need VK; VK needs the PIN (PK) or `VAULT_RECOVERY_SECRET` (RK), which lives only in Cloudflare secrets. Brute-forcing PV offline costs 600k PBKDF2 per guess |
| Worker code or secrets leak | Attacker with `VAULT_RECOVERY_SECRET` and DB access can unwrap VK for users with recovery enabled. This is the **stated trade-off**: email PIN reset is possible only because the Worker can recover VK. Users who do not accept this choose "No recovery" (21.9) |
| Stolen phone, app open | Auto-lock on background and 2 min idle; PIN required on every open |
| Stolen phone, app closed | Nothing decryptable on disk; PIN lockout is server-side |
| Guessing the PIN online | 5 attempts then doubling lockout; enforced by the server per vault |
| Attacker with the account email (hijacked mailbox) | Can reset the PIN if recovery is on. Mitigations: OTP also requires a valid session JWT for the account, security email after reset, "No recovery" mode, 2FA on the account (P2) |
| Malicious script on the page (XSS) | CSP, DOMPurify, no inline scripts; VK is `extractable=false` where possible (PK and ECDH keys) though VK bytes must be raw for wrapping; the risk is stated and mitigated by short unlock windows |
| Server learns the PIN | Never sent. PV is not reversible. Timing-safe compare |
| Replay of OTP or reset token | Single-use, hashed, short expiry, bound to user id |

What the UI says (Settings > Chaabi): "Your passwords are locked with your PIN and encrypted on your device.
If you forget your PIN, we can send a code to your email so you can set a new PIN without losing anything. To do
this, our server keeps a sealed copy of your vault key that only it can open during a reset. If you prefer that
nobody, not even our server, can ever open your vault, turn on No recovery."

### 21.9 "No recovery" mode

- Setting `recovery_enabled = false` requires the current PIN (verify) and a typed confirmation "I understand".
- The Worker sets `recovery_wrapped_key = null`, `recovery_wrap_iv = null` and logs `vault.recovery_disabled`.
- `/vault/recovery/request` returns 400 for this vault. Forgot PIN screen shows: "PIN reset is turned off for this vault. If you cannot remember your PIN, the passwords in Chaabi cannot be opened. You can delete the vault and start again."
- Turning recovery back on requires an unlocked vault (VK in memory) and repeats the setup step 21.2 to produce a new `recovery_wrapped_key`.
- Export encrypted backup (P1) is recommended before enabling; the UI links to it.

## 22. Notes and Write module design

### 22.1 Editor

- **Tiptap** (ProseMirror) with StarterKit, Heading (1-3), Bold/Italic/Underline/Strike, BulletList, OrderedList,
  TaskList + TaskItem (checklists), Link, Table, Image (images upload through the normal upload flow and are inserted
  as signed URLs re-signed on render), Placeholder, CharacterCount, History.
- Mobile toolbar: sticky bottom bar with the 8 most used buttons; desktop: top toolbar plus bubble menu.
- Templates (`TemplatePicker`): blank, meeting notes, checklist, letter, agreement outline. Templates are HTML strings in `constants/noteTemplates.js`.

### 22.2 Storage

| Field | Notes | Written documents |
|---|---|---|
| `content_html` | `notes.content_html` | `document_versions.content_html` |
| `content_text` | Generated in the browser with `editor.getText()`; used for FTS and chunking | same |
| Sanitising | DOMPurify in the browser on save with an allow list (headings, p, ul, ol, li, input[type=checkbox], a[href^=http], strong, em, u, s, table/tr/td/th, img[src^=https://<worker>]), then again in the Worker (`lib/sanitize.js` using a small HTML parser allow list) and again on render (`dangerouslySetInnerHTML` only after DOMPurify) | same |
| Autosave | Every 3 s of inactivity: `PATCH /notes/:id {content_html, content_text, expected_updated_at}`; Worker returns 409 if `updated_at` moved (another device); UI then shows "Saved on this device" and offers Keep mine / Use theirs | Written documents autosave into a **draft** (Dexie `drafts`) and create a new version only on "Save version" or after 10 minutes of edits |
| Offline | `drafts` table in Dexie keyed by note id; synced on reconnect | same |
| Private notes | `is_private = true`: browser encrypts `{html, text}` with the Chaabi VK, stores `encrypted_content` + `content_iv`, leaves `content_html`/`content_text` null and excludes the note from FTS and embeddings. Opening asks for the PIN | not supported for documents |
| Search | `notes.search_vector` (title A, content_text B) and chunks with `source_type='note'` | via document_versions as usual |

### 22.3 Write a document

1. `POST /documents {kind:'written', docType:'written', title}` creates the document and version 1 with `content_html` = template.
2. `/w/:ws/documents/:id/edit` opens Tiptap. "Save version" calls `POST /documents/:id/versions {comment, content_html, content_text}`. The Worker also stores a `txt` copy in R2 (`processed/{uuid}.txt`) so the file exists for export and full history like any upload.
3. Timeline events: `written`, `version uploaded` with comment. Versions list and restore work exactly as for scans.
4. Export: "Download as PDF" uses `window.print()` with a print stylesheet (`@page` margins, hide chrome); "Download as Markdown" uses `services/notes/exportMarkdown.js` (Turndown). DOCX export is P1 (docx library).

### 22.4 Editing uploaded documents

| Source | How it opens | On save |
|---|---|---|
| TXT, MD | Text read from R2 via signed URL; MD converted to HTML with `marked` then DOMPurify | New version with `content_html` + `.txt`/`.md` file in R2 |
| HTML | Sanitised with DOMPurify | New version |
| DOCX | `mammoth.convertToHtml(arrayBuffer)` in the browser; styles mapped to headings, lists, tables; images extracted and uploaded as files | New version with HTML; the DOCX stays as version 1's `original` file, untouched |
| XLSX, CSV | Read-only table preview (SheetJS community); editing is out of scope for V1 | - |
| Scans and PDFs | **Page tools** (`components/notes/PageTools.jsx`): thumbnails strip; rotate 90, drag to reorder, delete page, add page (camera/file), re-crop (opens the scanner crop step for that page), merge into one PDF | `pdf-lib` builds the new PDF in the browser (`PDFDocument.load`, `copyPages`, `setRotation`, `embedJpg` for new pages); uploaded as a new version through the normal upload flow with `comment: 'Pages edited'`; OCR re-runs only for new pages (old page texts are copied by page id mapping) |
| Annotate (P2) | Fabric.js overlay flattened into the image/PDF | New version |

The original version is never modified; every save is a new `document_versions` row with `previous_version_id` set.

## 23. Offline / PWA design

`vite-plugin-pwa` with Workbox `generateSW`:

- Precache: app shell (`index.html`, JS/CSS chunks, icons, fonts). `navigateFallback: '/index.html'` excluding `/api/*` and `/s/*`.
- Runtime caching: `CacheFirst` for `opencv.js`, Tesseract core/worker/traineddata and Transformers.js model files (1 year, versioned URLs); `StaleWhileRevalidate` for thumbnails from `/files/*` (max 500 entries, 7 days); `NetworkOnly` for `/api/*`.
- Manifest: `display: standalone`, `share_target` (`POST`, `multipart/form-data`, `files[]` accepting images and PDF), icons 192/512 maskable, `theme_color`.
- Share target handler in the SW stores files into Dexie `pendingCaptures` and opens `/w/:ws/upload?shared=1`.

Dexie schema (`services/offline/db.js`, database `dastavault`, version 1):

| Table | Key / indexes | Row shape | Purpose |
|---|---|---|---|
| `pendingCaptures` | `id` (uuid), `workspaceId`, `createdAt` | `{id, workspaceId, pages:[{originalBlob, processedBlob, thumbBlob, corners, filter, rotation}], name, docType, state}` | Scanner pages saved before the user finishes, and share-target files |
| `pendingUploads` | `uploadId`, `[workspaceId+state]`, `createdAt` | `{uploadId, workspaceId, documentId?, versionId?, files:[{role, pageIndex, blob, sha256, mime, size, stored:boolean}], meta:{title, docType, people, groups, tags}, state, attempts, lastError, ocrState}` | The upload queue |
| `drafts` | `id` (note id or `doc:<versionId>`), `workspaceId`, `updatedAt` | `{id, workspaceId, type:'note'|'document', contentHtml, contentText, baseUpdatedAt, dirty}` | Editor autosave when offline or before version save |
| `recentCache` | `key` (`ws:<id>:documents`, `doc:<id>`, `ws:<id>:people` ...), `workspaceId`, `cachedAt` | `{key, workspaceId, data, cachedAt}` | Last 50 documents list, last 20 opened documents (details + thumbnail URL), people, groups, terminology for offline viewing |

Upload states shown to the user (PRD PWA-3), stored in `pendingUploads.state`:

```
 saved  ---------> uploading ---------> uploaded (row deleted after 1 h)
 "Saved on this    "Uploading 2 of 3"   "Uploaded"
  device"              |
                       v
                    failed  ---- retry (auto on reconnect, manual button) ----> uploading
                    "Upload failed. Tap to retry."
```

Rules:

- `useOnline()` combines `navigator.onLine` with a 10 s heartbeat to `/health` (network can be "online" without internet). Offline banner: "Waiting for internet connection."
- Sync runs one upload at a time, oldest first, with backoff 5 s, 30 s, 2 min, 10 min, then hourly; `attempts` and `lastError` are visible in the queue screen.
- Background Sync: `registration.sync.register('upload-queue')` after each enqueue; the SW posts a message to the page (or, when no page is open, performs the upload itself using the stored session token from Dexie `session` meta, P1).
- Blobs in Dexie count against origin storage; the queue screen shows total size and warns above 200 MB. `navigator.storage.persist()` is requested after the first scan.
- On sign out, rows for that user are deleted; on workspace switch nothing is deleted.
- Redux `uploadQueue` slice mirrors Dexie through `liveQuery` so every screen shows the same state.

## 24. Future migration path

The frontend talks only to the Worker's `/api/v1` contract and to Supabase Auth. Each of the following can be
replaced behind that contract without changing React code.

| Concern | V1 (free) | Swap to | How |
|---|---|---|---|
| Embedding provider | Transformers.js in browser, 384 dims | Server-side (OpenAI `text-embedding-3-small` 1536, Voyage, Cohere, self-hosted TEI) | Worker gains `POST /versions/:vid/embed` that computes embeddings itself; add `vector(1536)` column per section 5.2; `search_chunks(p_model)` picks the column; browser stops sending `embedding` and the Worker embeds the query |
| OCR provider | Tesseract.js in browser | Google Vision, Azure Document Intelligence, self-hosted PaddleOCR | Worker route `POST /versions/:vid/ocr` writes `document_pages` with `source='cloud'`; browser skips local OCR when `workspace.features.cloud_ocr` is on. Text storage format is unchanged |
| Storage | Cloudflare R2 via binding | S3, Backblaze B2, MinIO, Supabase Storage | `worker/src/lib/r2.js` is the only file touching the bucket; it exposes `put/get/delete/head/presign`. Keys (section 7) are provider-neutral. Signed URL logic stays in the Worker |
| Search engine | Postgres FTS + pg_trgm + pgvector | Typesense, Meilisearch, OpenSearch, Qdrant/Weaviate for vectors | `routes/search.js` calls `lib/searchProviders/{postgres,typesense}.js` that each return ranked lists; RRF in `lib/rrf.js` fuses whatever lists exist. Permission filters must move into the engine's filter syntax (tenant + allowed document ids) |
| Background jobs | Worker cron + browser-driven processing | Cloudflare Queues (paid), Supabase Edge Functions + pg_cron, a small VPS worker | Add a `jobs` table (`type, payload, status, run_after, attempts`) written by routes; cron or a queue consumer drains it. Browser-side OCR/embedding remains as the free path |
| Database | Supabase free (500 MB) | Supabase Pro, Neon, self-hosted Postgres with pgvector | Migrations are plain SQL; only `SUPABASE_URL` and keys change. If leaving Supabase Auth, the Worker's `lib/auth.js` verifies a different issuer's JWKS |
| Auth | Supabase Auth | Clerk, Auth0, Keycloak, self-hosted GoTrue | Frontend `services/supabase/auth.js` and Worker `lib/auth.js` are the only two touch points; `profiles.id` stays the subject id |
| Email | Brevo | Resend, Postmark, SES | `worker/src/lib/email.js` exposes `send({to, template, data})`; templates are local |
| AI answers | User's own key per provider | Workspace-level key, self-hosted model behind an OpenAI-compatible endpoint | `AIProvider` interface unchanged; add `workspace_ai_keys` table with the same encryption |
| Key derivation (Chaabi) | PBKDF2-SHA256 600k | Argon2id (WASM) | `vaults.pin_kdf` and `vault_items.enc_version` already record the scheme; re-wrap on next unlock |
| Hosting | Cloudflare Pages + Workers | Vercel/Netlify for static, Node/Bun server for Hono | Hono runs unchanged on Node, Bun and Deno; only `env` access (`lib/env.js`) and the R2 adapter change |
| Realtime | Polling on notifications | Supabase Realtime or Durable Objects | Notifications table already has RLS for per-user select; subscribe from the browser with the publishable key |
