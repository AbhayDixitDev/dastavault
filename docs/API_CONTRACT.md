# DastaVault API and module contract (Phases 2 to 9)

This file is the single source of truth that the Worker and the frontend are built against.
Every response is a JSON object with the resource under a named key. Errors are
`{ error, code, details?, request_id }` with a proper HTTP status. All routes are under
`/api`, need `Authorization: Bearer <supabase access token>` unless marked public, and
workspace routes are `/api/workspaces/:ws/...` with membership and role checks in the Worker.

Roles: restricted 10, viewer 20, editor 30, admin 40, owner 50. "editor+" means rank >= editor.

Pagination: list endpoints accept `?limit=` (default 40, max 100) and `?cursor=` and return
`next_cursor` (null when done).

---

## 1. Documents, uploads, files (already implemented, keep shapes)

| Method | Path | Role | Body / query | Returns |
|---|---|---|---|---|
| GET | `/documents` | member | `q, person_id, group_id, document_type, tag, favorite=1, status, sort(created_at\|name\|updated_at\|expiry_date), order, cursor, limit` | `{ documents: [Doc], next_cursor }` |
| GET | `/documents/trash` | editor+ | | `{ documents, next_cursor }` |
| GET | `/documents/:id` | member | | `{ document: Doc & { versions: [Version], files: [File], people: [{id,display_name}], groups: [{id,name}], tags: [Tag], metadata: {key: value}, suggestions: [Suggestion] } }` |
| PATCH | `/documents/:id` | editor+ | any of `name, document_type, summary, organisation, document_number, issue_date, expiry_date, visibility, is_favorite, is_pinned, person_ids[], group_ids[]` | `{ document }` |
| DELETE | `/documents/:id` | editor+ | soft delete | `{ ok: true }` |
| POST | `/documents/:id/restore` | editor+ | | `{ document }` |
| DELETE | `/documents/:id/purge` | admin+ | removes R2 objects and rows | `{ ok: true }` |
| POST | `/uploads` | editor+ | multipart: `files[]` (1..20), `name?`, `document_type?`, `person_ids?` (json array), `group_ids?`, `client_upload_id?` (uuid, idempotent), `sha256[]?` (one per file, hex), `kind?` (`original` default), `page_numbers[]?` | `{ document, version, files: [File] }` |
| GET | `/files/:fileId/url` | member | `?download=1` | `{ url, expires_at }` (signed, 5 min) |
| GET | `/api/files/:fileId?exp&sig` | public (signature) | | streams the object |

Doc fields: `id, workspace_id, name, original_filename, previous_names[], document_type, status ('processing'|'ready'|'failed'), visibility, summary, organisation, document_number, issue_date, expiry_date, current_version_id, page_count, perceptual_hash, is_favorite, is_pinned, created_by, created_at, updated_at, deleted_at`.
Version: `id, document_id, version_number, comment, source, hash, previous_version_id, ocr_text, ocr_language, ocr_confidence, ocr_status, created_by, created_at`.
File: `id, document_id, version_id, r2_object_key, original_filename, mime_type, size_bytes, sha256, page_number, kind ('original'|'processed'|'thumbnail'|'pdf'|'attachment'), width, height, created_at`.

## 2. Versions, files and text (Phase 2, 3, 7)

| Method | Path | Role | Body | Returns |
|---|---|---|---|---|
| GET | `/documents/:id/versions` | member | | `{ versions: [Version & { files: [File] }] }` |
| POST | `/documents/:id/versions` | editor+ | multipart like `/uploads` plus `comment?` | `{ version, files }` (document.current_version_id updated, previous kept) |
| POST | `/documents/:id/versions/:vid/restore` | editor+ | `{ comment? }` | `{ version }` (new version copied from the old one) |
| POST | `/documents/:id/versions/:vid/files` | editor+ | multipart `files[]`, `kind` (`processed`\|`thumbnail`\|`pdf`\|`attachment`), `page_numbers[]?` | `{ files }` (adds derived files, e.g. browser-made thumbnail or PDF) |
| PUT | `/documents/:id/text` | editor+ | `{ version_id, ocr_text, ocr_language, ocr_confidence, ocr_status ('done'\|'failed'\|'skipped'), pages: [{ page_number, text, confidence, width?, height? }] }` | `{ ok: true }` (updates version + document_pages, refreshes search_text, sets document.status='ready') |
| GET | `/documents/:id/timeline` | member | | `{ items: [{ id, action, message, actor: {id, display_name}, metadata, created_at }] }` |
| POST | `/documents/written` | editor+ | `{ name, content_html, content_text, document_type? ('written'), person_ids?, group_ids? }` | `{ document, version, files }` (stores HTML as file kind `original` mime `text/html`, plain text as ocr_text) |
| PUT | `/documents/:id/written` | editor+ | `{ content_html, content_text, comment? }` | `{ version, files }` (new version) |
| GET | `/documents/:id/content` | member | | `{ content_html, content_text, version_id }` (for written or imported text docs) |

## 3. Details, suggestions, tags, duplicates, chunks (Phase 4, 6)

| Method | Path | Role | Body | Returns |
|---|---|---|---|---|
| GET | `/documents/:id/suggestions` | member | | `{ suggestions: [{ id, key, value, confidence, source, accepted_at }] }` |
| PUT | `/documents/:id/suggestions` | editor+ | `{ version_id?, suggestions: [{ key, value, confidence (0..1), source ('rules'\|'ai'\|'ocr') }] }` replaces suggestions for the doc | `{ suggestions }` |
| POST | `/documents/:id/suggestions/:sid/accept` | editor+ | | `{ document, metadata }` (copies value into confirmed metadata or the matching column) |
| PATCH | `/documents/:id/metadata` | editor+ | `{ fields: { key: value \| null } }` | `{ metadata }` (confirmed values; well-known keys also mirror to document columns: document_type, organisation, document_number, issue_date, expiry_date, summary, person_name) |
| GET | `/tags` | member | | `{ tags: [{ id, name, color, document_count }] }` |
| POST | `/tags` | editor+ | `{ name, color? }` | `{ tag }` (case-insensitive unique) |
| PATCH | `/tags/:id` | editor+ | `{ name?, color? }` | `{ tag }` |
| DELETE | `/tags/:id` | admin+ | | `{ ok: true }` |
| PUT | `/documents/:id/tags` | editor+ | `{ tag_ids?: [], names?: [] }` (replaces the set; names are created if missing) | `{ tags }` |
| POST | `/documents/check-duplicates` | member | `{ sha256?: [], perceptual_hash?, document_number?, text_sample? (<= 2000 chars), exclude_document_id? }` | `{ matches: [{ document: Doc, reason ('exact_file'\|'similar_image'\|'same_number'\|'similar_text'), score (0..1) }] }` |
| PUT | `/documents/:id/chunks` | editor+ | `{ version_id, embedding_model, embedding_version, dimension (must be 384), chunks: [{ chunk_number, page_number, section?, content, embedding: [384 floats], metadata? }] }` replaces chunks of that version | `{ count }` |
| GET | `/documents/:id/chunks` | member | `?version_id` | `{ chunks: [{ id, chunk_number, page_number, section, content }] }` (no embeddings) |

Well-known suggestion / metadata keys: `document_type, person_name, organisation, document_number, issue_date, expiry_date, invoice_number, amount, currency, vendor, policy_number, registration_number, email, phone, address, category, keywords (comma list), summary, suggested_name, person_id, group_id`.

Document types (string keys, display label in UI): `passport, aadhaar, pan, driving_licence, voter_id, birth_certificate, marksheet, degree, id_card, insurance, medical_report, prescription, invoice, receipt, bank_statement, tax, salary_slip, contract, agreement, letter, certificate, property, vehicle, utility_bill, ticket, photo, note, written, other`.

## 4. Search (Phase 5, 6, 8)

| Method | Path | Role | Body / query | Returns |
|---|---|---|---|---|
| GET | `/search` | member | `q, person_id, group_id, document_type, tag, date_from, date_to, expiry_from, expiry_to, uploaded_by, file_type (image\|pdf\|text), limit` | `SearchResponse` |
| POST | `/search/hybrid` | member | `{ q, embedding?: [384], filters?: {same as GET}, limit? }` | `SearchResponse` (FTS + vector + exact + metadata fused with RRF k=60, then exact boosts) |
| POST | `/search/image` | member | `{ perceptual_hash?, text_sample?, embedding?: [384] }` | `SearchResponse` |
| GET | `/search/suggest` | member | `q` | `{ people: [{id, display_name}], tags: [], types: [], recent: [] }` |
| GET | `/search/saved` | member | | `{ searches: [{ id, name, query, filters, created_at }] }` |
| POST | `/search/saved` | member | `{ name, query, filters }` | `{ search }` |
| DELETE | `/search/saved/:id` | member | | `{ ok: true }` |

`SearchResponse = { results: [{ document: Doc & { thumbnail_file_id, people: [], tags: [] }, score, matched: ['name'|'text'|'meaning'|'person'|'number'|'type'|'tag'], snippet }], resolved: { terms: [], person_ids: [], person_names: [], document_type, date_range, relation_words: [{ word, person_id }] }, next_cursor }`.

Query understanding (Worker, `src/lib/queryUnderstanding.js`): lowercase, strip punctuation, detect relation words (dad, father, papa, mom, mum, mother, wife, husband, spouse, son, daughter, brother, sister, grandpa, grandma, guardian) and resolve through `people.user_id = current user` -> `person_relationships`; detect document type words and synonyms (passport, insurance -> insurance, bill -> utility_bill or invoice, marksheet, licence/license -> driving_licence, aadhar/aadhaar, pan card); detect years, month names, "last year", "this year", "expiring"; detect document numbers (tokens with 6+ alphanumerics); match remaining words against people.display_name (trigram similarity > 0.4).

## 5. Albums, reminders, shares, notifications (Phase 7, 8)

| Method | Path | Role | Body | Returns |
|---|---|---|---|---|
| GET | `/albums` | member | | `{ albums: [{ id, name, kind ('manual'\|'smart'\|'person'\|'type'\|'group'\|'event'), description, cover_file_id, item_count, rules, created_at }] }` |
| POST | `/albums` | editor+ | `{ name, kind, description?, rules? }` | `{ album }` |
| GET | `/albums/:id` | member | `?cursor` | `{ album, documents: [Doc], next_cursor }` (smart albums evaluate `rules` live) |
| PATCH | `/albums/:id` | editor+ | `{ name?, description?, rules?, cover_file_id? }` | `{ album }` |
| DELETE | `/albums/:id` | editor+ | | `{ ok: true }` |
| POST | `/albums/:id/items` | editor+ | `{ document_ids: [] }` | `{ added }` |
| DELETE | `/albums/:id/items/:documentId` | editor+ | | `{ ok: true }` |

Smart album `rules` JSON: `{ "all": [ { "field": "person_id"|"group_id"|"document_type"|"tag"|"created_after"|"created_before"|"expiry_within_days"|"organisation"|"text", "op": "eq"|"in"|"contains"|"gte"|"lte", "value": ... } ] }`. Stored in `smart_album_rules`.

| Method | Path | Role | Body | Returns |
|---|---|---|---|---|
| GET | `/reminders` | member | `?upcoming_days=30&document_id=` | `{ reminders: [{ id, document_id, document_name, title, remind_at, field, channel ('app'\|'email'\|'both'), status ('pending'\|'sent'\|'done'\|'snoozed'), created_at }] }` |
| POST | `/reminders` | editor+ | `{ document_id, title, remind_at, field? ('expiry_date'...), channel? }` | `{ reminder }` |
| PATCH | `/reminders/:id` | editor+ | `{ title?, remind_at?, status?, channel? }` | `{ reminder }` |
| DELETE | `/reminders/:id` | editor+ | | `{ ok: true }` |
| GET | `/reminders/expiring` | member | `?days=30` | `{ documents: [Doc & { days_left }] }` (documents with expiry_date within N days) |
| POST | `/documents/:id/reminders/auto` | editor+ | creates 30/7/1-day reminders for expiry_date | `{ reminders }` |

The scheduled Worker cron (`0 */6 * * *`) also sends due reminder emails via Brevo and creates notifications.

| Method | Path | Role | Body | Returns |
|---|---|---|---|---|
| GET | `/shares` | member | `?document_id` | `{ shares: [{ id, document_id, kind ('link'\|'member'\|'group'), target_id, token, url, expires_at, allow_download, has_password, views, created_at }] }` |
| POST | `/shares` | editor+ | `{ document_id, kind, target_id?, expires_in_hours? (default 72), password?, allow_download? }` | `{ share }` (url = `${APP_URL}/s/${token}`) |
| DELETE | `/shares/:id` | editor+ | | `{ ok: true }` |
| GET | `/api/shares/:token` | public | header `x-share-password?` | `{ document: { id, name, document_type, page_count }, files: [{ id, kind, page_number, mime_type, url }], allow_download }` or 401 `{ code: 'password_required' }` |

Notifications exist: `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `PATCH /api/notifications/read-all`.

## 6. Ask your documents and AI keys (Phase 8)

| Method | Path | Role | Body | Returns |
|---|---|---|---|---|
| GET | `/api/ai/keys` | auth | | `{ keys: [{ id, provider, label, model, base_url, is_default, created_at }] }` (never the key) |
| POST | `/api/ai/keys` | auth | `{ provider ('openai'\|'gemini'\|'anthropic'\|'groq'\|'local'\|'custom'), api_key, label?, model?, base_url?, is_default? }` | `{ key }` (encrypted with HKDF(VAULT_RECOVERY_SECRET, 'ai:'+userId) AES-GCM) |
| DELETE | `/api/ai/keys/:id` | auth | | `{ ok: true }` |
| POST | `/api/ai/keys/:id/test` | auth | | `{ ok, model, latency_ms }` |
| POST | `/rag/ask` | member | `{ question, embedding?: [384], document_id?, key_id?, history?: [{role, content}] }` | `{ answer, not_found (bool), sources: [{ document_id, document_name, page_number, chunk_id, snippet }], provider, model }` |
| POST | `/rag/extract` | editor+ | `{ document_id, version_id, key_id? }` | `{ suggestions }` (AI metadata extraction from stored text, stored as suggestions with source 'ai') |

Worker `src/lib/ai/`: `index.js` exports `getProvider({ provider, apiKey, model, baseUrl })` returning `{ name, chat({ system, messages, maxTokens }) -> { text, model, usage } }`; implementations `openai.js` (also used for groq/custom/local via base_url), `gemini.js`, `anthropic.js`. The fixed not-found sentence: `I could not find that information in your documents.` Retrieval must use `search_chunks(ws, embedding)` and `search_documents_fts` restricted to the workspace and the caller's readable documents; never send more than 12 chunks; cite `[n]`.

## 7. Notes (Phase 9)

| Method | Path | Role | Body | Returns |
|---|---|---|---|---|
| GET | `/notes` | member | `?q, pinned=1, cursor` | `{ notes: [Note], next_cursor }` |
| POST | `/notes` | editor+ | `{ title, content_html, content_text, color?, is_pinned?, is_private?, tags?, links?: [{ entity_type ('person'\|'group'\|'document'), entity_id }] }` | `{ note }` |
| GET | `/notes/:id` | member | | `{ note: Note & { links: [] } }` |
| PATCH | `/notes/:id` | editor+ | same fields, plus `updated_at` (if stale -> 409 `{ code: 'conflict', note }`) | `{ note }` |
| DELETE | `/notes/:id` | editor+ | soft | `{ ok: true }` |
| POST | `/notes/:id/restore` | editor+ | | `{ note }` |

Note: `id, workspace_id, title, content_html (sanitised with DOMPurify in the browser before sending; the Worker strips `<script>` and `on*=` again), content_text, color, is_pinned, is_private, encrypted_blob, iv, tags[], created_by, created_at, updated_at, deleted_at`. Notes are included in `/search` results with `document_type: 'note'` and `kind: 'note'` on the result.

## 8. Chaabi vault (implemented; keep)

`GET /api/vault`, `POST /api/vault/setup`, `POST /api/vault/unlock`, `POST /api/vault/change-pin`, `POST /api/vault/forgot-pin/request`, `POST /api/vault/forgot-pin/verify` -> `{ vault_key, reset_token }`, `POST /api/vault/forgot-pin/complete`, items `GET|POST /api/vault/items`, `GET /api/vault/items/trash`, `GET|PATCH|DELETE /api/vault/items/:id` (`?purge=1`), `POST /api/vault/items/:id/restore`, `GET /api/vault/items/:id/history`, `DELETE /api/vault/items/:id/history/:hid`. See `worker/README.md` "Chaabi flows" for the exact field names (`pin_salt, pin_verifier_salt, pin_verifier_hash, kdf, kdf_iterations, pin_wrapped_key, wrap_iv, pin_length, vault_key (setup only), recovery_enabled`).

Client crypto (frontend `src/services/vault/crypto.js`): PBKDF2-SHA256 600k iterations, 32-byte salts, AES-256-GCM, 12-byte IVs, all base64. PIN Key = PBKDF2(pin, pin_salt). Verifier = PBKDF2(pin, pin_verifier_salt) sent as base64. Vault Key random 32 bytes. Item blob = AES-GCM(vaultKey, JSON {username, password, notes, totp?}).

## 9. Home and stats

| Method | Path | Role | Returns |
|---|---|---|---|
| GET | `/home` | member | `{ recent: [Doc], expiring: [Doc & {days_left}], favorites: [Doc], counts: { documents, people, groups, albums, notes }, storage_bytes }` |
| GET | `/stats` | admin+ | `{ documents, versions, files, storage_bytes, people, groups, members, chunks, last_activity_at }` |

---

## 10. Frontend module interfaces (so agents can work in parallel)

All plain JS. Every function must never throw on a bad input; return a result object with `ok:false` where sensible.

### `src/services/files/index.js` (documents agent)
- `sha256Hex(blob) -> Promise<string>`
- `makeThumbnail(blobOrCanvas, { maxSize = 512 }) -> Promise<Blob webp>`
- `compressImage(file, { maxSizeMB = 1.5, maxWidthOrHeight = 2200 }) -> Promise<File>` (browser-image-compression)
- `fileKind(file) -> 'image' | 'pdf' | 'text' | 'docx' | 'other'`

### `src/services/pdf/index.js` (documents agent)
- `loadPdf(blob) -> { numPages, getPageImage(pageNumber, scale) -> Promise<Blob>, getPageText(pageNumber) -> Promise<{ text, hasText }>, destroy() }` using `pdfjs-dist` with the worker configured via `?url` import.

### `src/services/ocr/index.js` (scanner agent)
- `readText(blob, { lang = 'eng', onProgress }) -> Promise<{ ok, text, confidence, words: [{text, bbox, confidence}] }>` in a Web Worker via tesseract.js.
- `readDocument({ files, pages }, { lang, onProgress }) -> { ok, text, language, confidence, pages: [{ page_number, text, confidence }] }` chooses PDF embedded text first (uses `src/services/pdf`), OCR only when needed.

### `src/services/extraction/index.js` (scanner agent)
- `extractSuggestions(text, { people: [{id, display_name}], groups: [{id,name}], workspaceKind }) -> [{ key, value, confidence, source: 'rules' }]`
- `suggestDocumentName({ suggestions, people, fallbackName }) -> string` following `Person - Type - Organisation/Identifier - Date`.
- `perceptualHash(imageBlob) -> Promise<string>` (64-bit dHash hex) and `hammingDistance(a, b)`.
- `chunkText(text, pages) -> [{ chunk_number, page_number, section, content }]` (paragraph-aware, 200-800 chars, 1-sentence overlap).

### `src/services/embedding/index.js` (scanner agent)
- `getEmbeddingProvider() -> { name: 'Xenova/all-MiniLM-L6-v2', version: '1', dimension: 384, embed(texts: string[]) -> Promise<number[][]>, warmup() }` running Transformers.js in a Web Worker; provider selection via `localStorage 'dv.embeddingProvider'` for later swaps. Must resolve `{ ok:false }` gracefully when WASM is unavailable.

### `src/services/pipeline/processDocument.js` (scanner agent)
- `processDocument({ workspaceId, documentId, versionId, files: [{ id, kind, mime_type, page_number, blob }], people, groups, onStatus }) -> Promise<{ ok, textOk, suggestionsOk, embeddingsOk }>`
  Runs: read text -> `PUT /documents/:id/text` -> extract suggestions + name -> `PUT /documents/:id/suggestions` -> chunk + embed -> `PUT /documents/:id/chunks`. Reports `onStatus('Reading text from this document...')`, `onStatus('Finding details...')`, `onStatus('Making it searchable...')`, `onStatus('Document is ready to search.')`. Never throws; a failed step reports and continues.

### `src/services/offline/uploadQueue.js` (scanner agent)
- `enqueueUpload({ workspaceId, files: [{ blob, name, kind, page_number }], name, document_type, person_ids, group_ids, sha256s }) -> id`
- `startUploadQueue()` retries when online, updates Dexie `pendingUploads.status` (`saved_on_device|uploading|uploaded|failed`), uses `api.post('/workspaces/:ws/uploads', formData, { onUploadProgress })`, then calls `processDocument`.
- `useUploadQueue()` hook -> `{ items, retry(id), remove(id) }`.

### `src/services/search/voice.js` (search agent)
- `isVoiceSupported()`, `listenOnce({ lang, onInterim }) -> Promise<{ ok, transcript }>` with graceful fallback.

### Shared already present
`src/services/api/client.js` (`api.get/post/put/patch/delete`, `ApiError`), `src/hooks/useWorkspace.js`, `src/store/api/baseApi.js` (`baseApi.injectEndpoints`, tag types include `Documents, Document, Activity, Notifications, Vault, VaultItems`; add new tag types only by editing `tagTypes` there, coordinated by the integrator), `src/components/ui/*`, `src/components/common/ErrorBox.jsx (errorMessage)`, `src/utils/format.js`.

## 11. Ownership map (who edits what)

| Agent | Owns |
|---|---|
| worker | everything under `worker/`, plus `backend/migrations/011_*.sql` if needed |
| documents | `frontend/src/pages/{Documents,DocumentDetail,Upload,Trash}/`, `components/documents/`, `store/api/documentsApi.js`, `services/files/`, `services/pdf/`, `components/viewer/` |
| scanner | `pages/Scanner/`, `components/scanner/`, `services/{scanner,ocr,extraction,embedding,pipeline,offline/uploadQueue.js}`, `workers/` |
| search | `pages/{Search,Albums,Reminders,Activity}/`, `components/{search,albums,reminders}/`, `store/api/{searchApi,albumsApi,remindersApi,activityApi,ragApi}.js`, `services/search/`, `services/imageSearch/` |
| vault-notes | `pages/{Chaabi,Notes,DocumentEdit}/`, `components/{vault,notes,editor}/`, `services/vault/`, `store/api/{vaultApi,notesApi,aiApi}.js`, `components/settings/AiKeysPanel.jsx` |
| integrator (main session) | `routes/index.jsx`, `store/index.js`, `store/api/baseApi.js` tagTypes, `components/layout/*`, `pages/Home/*`, `pages/Settings/SettingsPage.jsx`, README and docs |

Agents must not edit files outside their ownership; they report what routes and store modules they created so the integrator wires them.
