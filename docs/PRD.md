# DastaVault - Product Requirements Document

| | |
|---|---|
| Product | DastaVault |
| Modules | Documents, Search, Ask, Albums, People, Chaabi (Password Keeper), Notes and Write |
| Owner | Abhay Dixit (personal project) |
| Version | 1.0 |
| Date | 1 October 2026 |
| Status | Approved for build (Phase 1 in progress) |

---

## 1. Summary

DastaVault is a mobile-first, AI-assisted Document Management System for families, companies, schools,
organisations, teams and any custom group. A person photographs a paper document with their phone, the app cleans
the scan, reads the text, suggests a name, links it to the right person or group, and makes it searchable by
keyword, by meaning, by voice and by image. The same vault also keeps passwords behind a PIN (Chaabi) and simple
notes and written documents (Notes).

The first version must run on **free tiers only**: Cloudflare Pages, Cloudflare Workers, Cloudflare R2,
Supabase PostgreSQL with pgvector, Supabase Auth and Brevo email. Heavy processing (scanning, OCR, embeddings)
runs in the user's browser.

## 2. Goals and non-goals

### Goals

1. Anyone in a family, including a school student or a grandparent, can scan, find and share a document in under a minute.
2. Finding a document must work with natural words: "dad passport", "mom health insurance", "AWS invoice September".
3. Nothing is ever lost: originals, versions and history are always kept. Deletion goes to Trash first.
4. Private by default. Every file, every search and every AI answer is limited to the user's workspaces.
5. Zero monthly infrastructure cost for a small family or team.
6. Architecture must allow upgrading to paid or self-hosted services later without rewriting the frontend.

### Non-goals (V1)

- Real-time collaborative editing of the same note or document.
- Server-side OCR, server-side image processing or GPU services.
- Paid vector databases, paid OCR or mandatory paid AI APIs.
- E-signature, workflow approvals, or legal retention policies.
- Native iOS/Android apps (the PWA is the mobile app).

## 3. Users and personas

| Persona | Needs | Example |
|---|---|---|
| Family organiser (Meena, 42) | Keep passports, insurance, school certificates and house papers for 5 people. Find them fast. Remember expiry dates. | "Show Nikhil's birth certificate" |
| Student (Riya, 14) | Scan homework, certificates and ID cards on the phone. Simple language, big buttons. | Taps Scan, takes a photo, done. |
| Grandparent (Rajesh, 70) | Large text, voice search, no technical words. | Says "my pension letter" |
| Small company admin (Priya, 30) | Employees, departments, teams. Contracts, invoices, HR letters. Roles and permissions. | "Marketing contracts expiring this year" |
| School office (Arjun, 35) | Classes and sections, student records, staff documents. | "Class 8B transfer certificates" |
| Anyone | Keep passwords safely behind a PIN. Keep old passwords. Reset PIN by email if forgotten. | Unlocks Chaabi with PIN |
| Anyone | Write a quick note or a full document inside the app, edit it later, attach it to a person. | Writes "Rent agreement points" |

## 4. Workspace model and terminology

A **workspace** is the top-level container. A user may belong to many workspaces. On creation the app asks
**"What are you organising?"** and applies a terminology template. Every label in the UI comes from this
configuration, never from hard-coded words.

| Template | Workspace | Members | Groups | Subgroups | Example groups |
|---|---|---|---|---|---|
| Family | Family | Family Members | Family Groups | - | Parents, Kids |
| Company | Company | Employees | Departments | Teams | Engineering, Marketing, Finance |
| School | School | Students / Staff | Classes | Sections | Class 8, Section B |
| Organisation | Organisation | Members | Units | Teams | Volunteers, Board |
| Personal | My Documents | People | Folders | - | Home, Car, Tax |
| Custom | user-defined | user-defined | user-defined | user-defined | anything |

Terminology is stored per workspace (`workspace_terminology`) and editable later from Settings.

### 4.1 People, members and relationships

- A **person** is someone documents belong to. A person may or may not have a login. A child or grandparent
  usually has no login but has documents.
- A **member** is a user account with access to the workspace and a role.
- A person can be linked to a member (the same human), to groups, and to other people through **relationships**
  (Father, Mother, Parent, Child, Son, Daughter, Spouse, Brother, Sister, Grandparent, Guardian, Manager,
  Reports To, custom).
- Relationships are directional and stored from the point of view of a person. Search uses the **current user's**
  relationships: "dad" resolves to the person who is Father of the person linked to the current user.

### 4.2 Roles and permissions

| Role | Can |
|---|---|
| Owner | Everything, including delete workspace, billing later, transfer ownership |
| Admin | Manage members, groups, people, terminology, all documents, trash, settings |
| Editor | Add, edit, version and link documents, notes; create albums; cannot manage members |
| Viewer | View and search documents they are allowed to see; download if allowed |
| Restricted | Only documents explicitly shared with them or linked to their own person or groups |

Permissions are stored as rows (`permissions`, `role_permissions`) so custom roles can be added later.
Document-level visibility: **Workspace** (default), **Groups only**, **People only**, **Private to uploader**.

## 5. Functional requirements

Each requirement has an ID. Priority: **P0** = must ship in the listed phase, **P1** = should, **P2** = later.

### 5.1 Accounts and authentication (Phase 1)

| ID | Requirement | Priority |
|---|---|---|
| AUTH-1 | Sign up and sign in with email and password using Supabase Auth. | P0 |
| AUTH-2 | Magic link sign in. | P1 |
| AUTH-3 | Google sign in through Supabase Auth (client ID and secret configured only in the Supabase dashboard). | P0 |
| AUTH-4 | Email verification before creating a workspace. | P0 |
| AUTH-5 | Password reset by email. | P0 |
| AUTH-6 | Profile: display name, avatar, preferred language, large-text mode. | P0 |
| AUTH-7 | Every API request carries the Supabase JWT; the Worker validates it on every call. | P0 |
| AUTH-8 | Sessions survive app restart on the phone (PWA). | P0 |

### 5.2 Workspaces, members, groups (Phase 1)

| ID | Requirement | Priority |
|---|---|---|
| WS-1 | Create a workspace with the "What are you organising?" chooser and a name. | P0 |
| WS-2 | Terminology template applied automatically; custom template lets the user type their own words. | P0 |
| WS-3 | Switch between workspaces from the header or More menu. | P0 |
| WS-4 | Invite members by email with a role; invitation emails via Brevo; pending invites listed. | P0 |
| WS-5 | Change role, remove member, transfer ownership. | P0 |
| WS-6 | Groups with optional parent group (departments with teams, classes with sections). | P0 |
| WS-7 | People directory with name, photo, relation, groups, linked member, custom fields. | P0 |
| WS-8 | Relationships between people, with a simple picker ("Rajesh is the Father of Nikhil"). | P0 |
| WS-9 | Workspace settings: name, icon, terminology, default visibility, features on/off (face grouping, AI). | P0 |
| WS-10 | Delete workspace (owner only, typed confirmation, 30-day soft delete). | P1 |

### 5.3 Documents and files (Phase 2)

| ID | Requirement | Priority |
|---|---|---|
| DOC-1 | A logical document has many files (front, back, PDF) and many versions. | P0 |
| DOC-2 | Upload from file picker, camera, drag-and-drop (desktop) and share target (PWA). | P0 |
| DOC-3 | Allowed types: JPEG, PNG, WEBP, HEIC (converted in browser), PDF, TXT, MD, DOCX, XLSX, CSV. Maximum 25 MB per file in V1. | P0 |
| DOC-4 | Upload goes to the Worker which writes to R2 and creates rows. Presigned direct upload for files above 5 MB (P1). | P0 |
| DOC-5 | SHA-256 computed in the browser before upload and stored with each file. | P0 |
| DOC-6 | Documents list: grid and list views, sort, filter by type/person/group/tag/date, infinite scroll. | P0 |
| DOC-7 | Viewer: image zoom and pan, PDF page navigation, rotate, download, share, details panel, timeline, related documents. | P0 |
| DOC-8 | Details panel: name, type, people, groups, tags, dates, numbers, custom fields, notes. Everything editable. | P0 |
| DOC-9 | Favourites and pin to Home. | P1 |
| DOC-10 | Trash: soft delete, restore, auto-purge after 30 days, admin can purge earlier. | P0 |
| DOC-11 | File access only through short-lived signed Worker URLs; never a public bucket URL. | P0 |
| DOC-12 | Thumbnails generated in browser at upload; stored in R2 under `thumbnails/`. | P0 |

### 5.4 Scanner (Phase 3)

| ID | Requirement | Priority |
|---|---|---|
| SCAN-1 | Camera view with capture button, flash toggle, gallery import, multi-page mode. | P0 |
| SCAN-2 | Automatic paper detection using OpenCV.js: resize copy, grayscale, blur, edges, contours, largest quadrilateral. | P0 |
| SCAN-3 | Live overlay of the detected corners before capture where the device is fast enough. | P1 |
| SCAN-4 | Rectangle crop mode with draggable edges and corners. | P0 |
| SCAN-5 | Perspective crop mode with four independently draggable corners and magnifier. | P0 |
| SCAN-6 | Buttons: Use Suggested Crop, Adjust Corners, Reset, Rotate, Continue. | P0 |
| SCAN-7 | Perspective transform, deskew, auto contrast and brightness, colour / grayscale / black-and-white filters. | P0 |
| SCAN-8 | Original photo is always kept as a file in the same version. | P0 |
| SCAN-9 | Compression with browser-image-compression before upload; target under 1.5 MB per page. | P0 |
| SCAN-10 | Pages can be reordered, retaken and deleted before saving; result can be saved as images or combined into one PDF. | P0 |
| SCAN-11 | If offline, the capture is saved in IndexedDB and uploaded later with clear status. | P0 |

### 5.5 Reading text (OCR and PDF) (Phase 3)

| ID | Requirement | Priority |
|---|---|---|
| OCR-1 | Tesseract.js in a Web Worker; English by default, Hindi and other languages selectable per workspace. | P0 |
| OCR-2 | PDF.js extracts embedded text; only pages without reliable text are rendered and sent to OCR. | P0 |
| OCR-3 | Store raw text, cleaned text, language, confidence, page number, word boxes where practical. | P0 |
| OCR-4 | OCR failure never blocks saving. The document shows "We could not read the text. You can still search by name." | P0 |
| OCR-5 | User can re-run reading, or type or paste text manually. | P1 |
| OCR-6 | Progress shown in plain words: "Reading text from this document..." | P0 |

### 5.6 Smart details and naming (Phase 4)

| ID | Requirement | Priority |
|---|---|---|
| META-1 | Rule-based extraction in the browser: document type, names, dates (issue, expiry, invoice date), numbers (passport, policy, invoice, registration, PAN, Aadhaar-masked), amounts and currency, email, phone, address, organisation, keywords. | P0 |
| META-2 | Optional AI extraction using the user's own API key through the AI provider abstraction. | P1 |
| META-3 | Suggestions stored separately from confirmed values; UI shows "Suggested" chips that the user accepts or edits. | P0 |
| META-4 | Suggested name: `Person or Group - Type - Organisation or Identifier - Date`, short and readable. | P0 |
| META-5 | Keep original filename, display name, previous names and the storage key. | P0 |
| META-6 | Person suggestion by matching names in text against the people directory (fuzzy). | P0 |
| META-7 | Group suggestion from person membership and from keywords. | P1 |
| META-8 | Tags: free text, autocomplete, colour. | P0 |
| META-9 | Custom fields per workspace and per document type (text, number, date, choice). | P1 |
| META-10 | Duplicate detection at upload: exact SHA-256, perceptual hash of images, same document number, high OCR similarity. Show "This document may already exist" with View Existing, Add as New Version, Keep Both, Cancel. Never auto-delete. | P0 |

### 5.7 Search (Phase 5 and 6)

| ID | Requirement | Priority |
|---|---|---|
| SRCH-1 | One search box on Home and the Search tab: "Search your documents". | P0 |
| SRCH-2 | Keyword search with PostgreSQL full text over name, OCR text, summary, tags, people, organisation, type. | P0 |
| SRCH-3 | Typo tolerance with `pg_trgm` similarity. | P0 |
| SRCH-4 | Query understanding: relationship words (dad, mom, wife, son), document type words, dates ("last year", "2026", "September"), organisation names, document numbers. | P0 |
| SRCH-5 | Filters: Person, Group, Document Type, Date, Expiry, Uploaded By, Tags, File Type. | P0 |
| SRCH-6 | Semantic search with pgvector over chunk embeddings generated in the browser with Transformers.js. | P0 |
| SRCH-7 | Hybrid ranking: full text + vector + metadata + exact name + exact person + exact number, fused with Reciprocal Rank Fusion, then exact-match boosting. | P0 |
| SRCH-8 | Every retrieval query includes the workspace and permission filter inside SQL. Never filter after retrieval. | P0 |
| SRCH-9 | Saved searches and recent searches. | P1 |
| SRCH-10 | Voice search using the browser Speech Recognition API with visible recognised text and graceful fallback. | P0 (Phase 8) |
| SRCH-11 | Image search: pick a photo, run perceptual hash and OCR in the browser, find similar documents. | P0 (Phase 8) |
| SRCH-12 | Results show why they matched in plain words: "Matched: Rajesh Patel, Passport". | P1 |

### 5.8 Ask your documents (RAG) (Phase 8)

| ID | Requirement | Priority |
|---|---|---|
| ASK-1 | Chat-style question box on the Search tab and inside a document. | P0 |
| ASK-2 | Retrieval reuses hybrid search limited to the user's permitted documents; top chunks are sent to the AI provider. | P0 |
| ASK-3 | Answers cite document and page; tapping a citation opens that page. | P0 |
| ASK-4 | If nothing relevant exists the answer is exactly: "I could not find that information in your documents." | P0 |
| ASK-5 | AI provider abstraction: OpenAI, Gemini, Anthropic, Groq, local. The user pastes their own key; keys are stored encrypted per user and never logged. | P0 |
| ASK-6 | Without an AI key the feature shows how to add one; everything else keeps working. | P0 |
| ASK-7 | "Compare versions" question uses both versions' text. | P1 |

### 5.9 Versions, timeline, reminders, albums (Phase 7)

| ID | Requirement | Priority |
|---|---|---|
| VER-1 | Upload New Version with comment; the previous version is never overwritten. | P0 |
| VER-2 | Version list with number, who, when, comment, files, hash, previous version. | P0 |
| VER-3 | Restore Previous Version creates a new version copied from the old one. | P0 |
| VER-4 | Compare Versions: side by side preview and text diff. | P1 |
| TL-1 | Timeline in plain sentences: "Rahul uploaded this document.", "Expiry date was updated." | P0 |
| TL-2 | Events: created, uploaded, renamed, details edited, version uploaded, tag added, person linked, group linked, shared, downloaded (if auditing on), archived, deleted, restored. | P0 |
| REM-1 | Reminders on any date field (expiry, renewal) with 30, 7 and 1 day defaults; in-app and email via Brevo. | P0 |
| REM-2 | Home shows "Expiring soon". | P0 |
| ALB-1 | Manual albums, people albums, type albums, group albums, event albums. | P0 |
| ALB-2 | Smart albums with rules (person = Rahul AND type = Medical Report). | P0 (Phase 8) |
| ALB-3 | Album cover, sort, share album. | P1 |

### 5.10 Sharing (Phase 7)

| ID | Requirement | Priority |
|---|---|---|
| SHR-1 | Share a document with a member, a group or by expiring link (view only, optional password, optional download). | P0 |
| SHR-2 | Share links are served through the Worker, expire, and are revocable. | P0 |
| SHR-3 | Share to another app on the phone using the Web Share API. | P1 |

### 5.11 Face grouping (Phase 8, optional, off by default)

| ID | Requirement | Priority |
|---|---|---|
| FACE-1 | When enabled by the workspace admin, faces are detected and embedded on the device. | P2 |
| FACE-2 | Similar faces are grouped; the app says "These photos may show the same person." | P2 |
| FACE-3 | Confirm Person, Merge Group, Split Group, Remove Photo, Delete Face Data, Disable Face Matching. | P2 |
| FACE-4 | Face data is deleted completely when disabled. | P2 |

### 5.12 Chaabi - Password Keeper (Phase 9)

**Name.** The password module is called **Chaabi** (Hindi for *key*), matching the DastaVault name.
Alternatives considered: KeyNest, PassPocket, SafeKey, LockBox. Chaabi is recommended because it is short,
memorable and fits the product family.

**Principle.** Passwords are encrypted on the device. The server stores only ciphertext. A **PIN** is required
every time the vault is opened. Without the PIN, nobody, including the server, can read a password.

| ID | Requirement | Priority |
|---|---|---|
| PW-1 | Each user has one personal vault. Shared workspace vaults are P2. | P0 |
| PW-2 | First use: set a 4 to 6 digit PIN (6 recommended) and confirm it. | P0 |
| PW-3 | Opening Chaabi always asks for the PIN. No PIN, no access. | P0 |
| PW-4 | Auto-lock after 2 minutes idle, when the app goes to background, on tab close, and on sign out. Manual Lock button. | P0 |
| PW-5 | Wrong PIN: 5 attempts then 30 seconds wait, doubling each time, enforced by the server. | P0 |
| PW-6 | Add password: title, website or app, username or email, password, notes, category, tags, favourite. | P0 |
| PW-7 | Password generator with length, symbols, numbers, readable mode; strength meter. | P0 |
| PW-8 | Password history: every change keeps the old password with its date. "Old passwords" list on each item. User can delete an old entry. | P0 |
| PW-9 | Copy to clipboard with automatic clear after 30 seconds; show or hide password; large tap targets. | P0 |
| PW-10 | Search by title, website and username. Categories: Personal, Banking, Work, Social, Wi-Fi, Cards, Other. | P0 |
| PW-11 | Forgot PIN: send a 6-digit one-time code to the account email using Brevo. Code valid 10 minutes, 5 attempts, one active code at a time. After verification the user sets a new PIN and keeps all passwords. | P0 |
| PW-12 | Change PIN with the current PIN. | P0 |
| PW-13 | Optional "No recovery" mode: PIN reset is disabled and a forgotten PIN means the vault cannot be opened. Clearly explained. | P1 |
| PW-14 | Optional fingerprint or face unlock using WebAuthn on supported phones, as a shortcut for the PIN. | P2 |
| PW-15 | Export encrypted backup; import from CSV (Chrome, Bitwarden). | P1 |
| PW-16 | Activity: unlock, PIN change, PIN reset, item added, item changed, item deleted. Never log the secret itself. | P0 |
| PW-17 | Trash for deleted items, 30 days. | P1 |

**Encryption design (summary; details in ARCHITECTURE.md section 21).**

1. The browser generates a random 256-bit **Vault Key**.
2. From the PIN and a random salt the browser derives a **PIN Key** (PBKDF2-SHA256, 600,000 iterations; Argon2id later).
3. The Vault Key is wrapped with the PIN Key (AES-256-GCM) and stored on the server as `pin_wrapped_key`.
4. The Vault Key is also wrapped by the Worker with a per-user recovery key derived from a Worker secret and stored as `recovery_wrapped_key`. This is what makes email PIN reset possible without losing data.
5. Every item and every history entry is encrypted with the Vault Key before it leaves the device. Title and website stay in plain text so lists and search work; username, password and notes are encrypted.
6. A separate **PIN Verifier** (PBKDF2 with a different salt) is sent to the server so it can count wrong attempts and lock the vault without ever knowing the PIN.
7. Trade-off, stated in the UI: during PIN reset only, the Worker briefly unwraps the Vault Key in memory to re-wrap it for the new PIN. Users who want strict zero-knowledge can turn on "No recovery" mode.

### 5.13 Notes and Write (Phase 9)

| ID | Requirement | Priority |
|---|---|---|
| NOTE-1 | Notes list with search, pin, colour, tags, links to people, groups and documents. | P0 |
| NOTE-2 | Rich text editor (headings, bold, lists, checklists, links, tables, images) using Tiptap, saved as HTML plus plain text. | P0 |
| NOTE-3 | Autosave every few seconds; offline drafts in IndexedDB; conflict shows "Saved on this device" until synced. | P0 |
| NOTE-4 | Notes are included in search (keyword and meaning). | P0 |
| NOTE-5 | **Write a document**: creates a document of type "Written" with the same editor, full version history and timeline like any other document. | P0 |
| NOTE-6 | Export written document as PDF (browser print to PDF) and Markdown; DOCX export later. | P1 |
| NOTE-7 | **Edit an uploaded document**: text uploads (TXT, MD, HTML, DOCX imported with mammoth) open in the editor; the original file stays as version 1 and each save creates a new version. | P0 |
| NOTE-8 | **Edit scanned or PDF documents**: rotate, reorder, delete and add pages, re-crop a page, merge into one PDF using pdf-lib in the browser; saved as a new version. | P0 |
| NOTE-9 | Annotate images and PDFs (highlight, text box, arrow) as a new version. | P2 |
| NOTE-10 | Templates: blank, meeting notes, checklist, letter, agreement outline. | P1 |
| NOTE-11 | Locked notes: a note can be marked "private" and then requires the Chaabi PIN to open; content encrypted with the Vault Key. | P1 |

### 5.14 Offline and PWA (Phase 2 onward)

| ID | Requirement | Priority |
|---|---|---|
| PWA-1 | Installable with icon, splash, standalone display, share target. | P0 |
| PWA-2 | App shell and static assets cached; recent documents list and thumbnails cached for offline viewing. | P0 |
| PWA-3 | Upload queue in Dexie with states: Saved on this device, Uploading, Uploaded, Upload Failed (retry). | P0 |
| PWA-4 | "Waiting for internet connection." banner; automatic retry on reconnect; never say Uploaded before the server confirms. | P0 |
| PWA-5 | Background Sync where supported. | P1 |

### 5.15 Admin and activity

| ID | Requirement | Priority |
|---|---|---|
| ADM-1 | Workspace activity page with filters by member, action and date. | P0 |
| ADM-2 | Storage usage per workspace with free-tier warnings (R2 10 GB, Supabase 500 MB). | P0 |
| ADM-3 | Export all workspace data (files zip + JSON) for portability. | P1 |
| ADM-4 | Notification centre: reminders, shares, invites, upload results. | P0 |

## 6. User experience

### 6.1 Principles

1. Mobile first, thumb reachable. Primary actions at the bottom.
2. Simple language a young student understands. See the wording table below.
3. Calm inside the app. Animation and 3D only on landing, onboarding, workspace choice and empty states.
4. Large tap targets (minimum 44 px), clear icons with labels, very few hidden gestures.
5. Every long process shows progress in words and never blocks the user from leaving the screen.
6. Accessible: keyboard navigation, focus rings, contrast AA, large-text mode, screen reader labels.

### 6.2 Wording rules

| Never show | Show instead |
|---|---|
| Vector embedding generated | Document is ready to search |
| OCR processing | Reading text from this document... |
| Metadata | Document details |
| Semantic search | Search by meaning |
| RAG / LLM | Ask your documents |
| Perspective transform | Straighten |
| SHA-256 duplicate | This document may already exist |
| Sync conflict | Saved on this device. Will upload when online. |
| Ciphertext / key derivation | Locked with your PIN |

### 6.3 Navigation

**Mobile bottom bar:** Home, Search, **Scan** (large centre button), Documents, More.
More contains: People, Groups, Albums, Notes, Chaabi, Reminders, Activity, Settings, Switch workspace.

**Desktop:** left sidebar (workspace switcher, Home, Search, Documents, People, Groups, Albums, Notes, Chaabi,
Reminders, Activity, Settings), top search bar with microphone and image buttons, main content, optional right
details panel.

**Tablet:** collapsible sidebar plus bottom bar in portrait.

### 6.4 Pages

| Route | Page | Notes |
|---|---|---|
| `/` | Landing | Aceternity hero, feature scroll, install prompt |
| `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify` | Auth | shadcn forms |
| `/onboarding` | Create first workspace | "What are you organising?" cards with Motion |
| `/w` | Workspace switcher | |
| `/w/:ws` | Home | Search, Scan, Upload, Recent, People, Groups, Albums, Favourites, Expiring soon |
| `/w/:ws/search` | Search | Box, mic, image, filters, results, Ask tab |
| `/w/:ws/scan` | Scanner | Camera, crop, filters, pages, save |
| `/w/:ws/upload` | Upload | Picker, queue, duplicate check |
| `/w/:ws/documents` | Documents | Grid/list, filters |
| `/w/:ws/documents/:id` | Document | Viewer, details, versions, timeline, ask, related |
| `/w/:ws/documents/:id/edit` | Edit document | Editor for written docs, page tools for scans/PDF |
| `/w/:ws/documents/trash` | Trash | |
| `/w/:ws/people`, `/w/:ws/people/:id` | People and person | Documents of this person, relationships |
| `/w/:ws/groups`, `/w/:ws/groups/:id` | Groups and group | Members, subgroups, documents |
| `/w/:ws/albums`, `/w/:ws/albums/:id` | Albums | Manual and smart |
| `/w/:ws/notes`, `/w/:ws/notes/:id` | Notes | List and editor |
| `/w/:ws/chaabi` | Chaabi | PIN screen, list, item, generator, settings |
| `/w/:ws/reminders` | Reminders | |
| `/w/:ws/activity` | Activity | |
| `/w/:ws/settings/*` | Settings | General, Terminology, Members, Roles, Features, AI provider, Storage, Danger zone |
| `/account` | Account | Profile, security, sessions, language |
| `/s/:token` | Public share view | Served by Worker with checks |

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| Cost | Free tiers only for V1: Pages, Workers (100k req/day), R2 (10 GB, no egress fee), Supabase (500 MB DB, 50k MAU), Brevo (300 emails/day). |
| Performance | First load under 3 s on 4G; scan crop preview under 1 s on a mid-range Android; search results under 500 ms at 10k documents. |
| Reliability | Uploads are idempotent (client-generated upload id). Partial failures leave no orphan rows: R2 write, then DB insert, and a cleanup job for orphans. |
| Security | See section 9. |
| Privacy | No analytics that send document content. AI providers receive only the retrieved chunks needed for the question and only when the user has configured a key. |
| Data portability | Full export; standard formats (PDF, JPEG, JSON, CSV). |
| Browser support | Last 2 versions of Chrome, Safari, Firefox, Edge; Android Chrome and iOS Safari for camera and PWA. |
| Localisation | UI strings in a single dictionary; English first, Hindi second. OCR language selectable. |
| Accessibility | WCAG 2.1 AA targets. |

## 8. Data model (summary)

Full DDL is in `backend/migrations/`. Tables:

`profiles, workspaces, workspace_terminology, workspace_members, workspace_invites, roles, permissions,
role_permissions, groups, people, person_relationships, person_groups, documents, document_versions, document_files,
document_pages, document_metadata, document_metadata_suggestions, tags, document_tags, document_people,
document_groups, document_chunks, albums, album_items, smart_album_rules, reminders, activity_logs, shares,
saved_searches, notifications, custom_field_definitions, custom_field_values, notes, note_links, ai_provider_keys,
vaults, vault_items, vault_item_history, vault_otp_codes, upload_sessions`.

Every workspace-scoped table carries `workspace_id`, `created_at`, `updated_at`, `created_by`. All ids are UUIDs.
`document_chunks.embedding` is `vector(384)` for the default browser model (`Xenova/all-MiniLM-L6-v2`); the model
name and version are stored on each row so the dimension can change per model in a new column or table later.

## 9. Security requirements

1. Supabase JWT validated on every Worker request; user id taken from the token, never from the body.
2. Workspace membership and role checked on every request; `workspaceId` from the client is only a hint.
3. Row Level Security enabled on all tables; policies based on `workspace_members`. The Worker uses the
   service-role key only where necessary (file writes, cross-table transactions), and always after its own checks.
4. R2 is private. All file reads are served by the Worker through short-lived signed URLs (HMAC, 5 minutes).
5. Presigned direct uploads (later) expire in 10 minutes, permit one PUT to one unpredictable key, and are only issued after permission checks.
6. Object keys are IDs, never user filenames. Filenames are sanitised for metadata.
7. MIME type verified by magic bytes in the Worker; size limits enforced; images re-encoded in browser.
8. Rate limiting per user and per IP on auth-sensitive routes (OTP, PIN verify, share links).
9. Security headers: CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy (camera allowed only on own origin).
10. XSS: all rich text sanitised with DOMPurify on save and on render.
11. IDOR: every resource is fetched with `workspace_id` in the query, not just by id.
12. Search, vector search and RAG retrieval apply workspace and permission constraints inside SQL.
13. Chaabi: PIN never sent in clear; vault key never stored in clear; server-side lockout; OTP single-use; all vault actions logged.
14. Secrets only in Wrangler secrets and `.dev.vars`; never in `VITE_` variables or Git.
15. Dependencies pinned; `npm audit` in CI.

## 10. Free-tier limits and guard rails

| Service | Free limit | Guard rail in app |
|---|---|---|
| Cloudflare R2 | 10 GB storage, 1M class A ops/month | Storage meter in Settings, warning at 80% |
| Cloudflare Workers | 100k requests/day, 10 ms CPU per request | No CPU-heavy work in Worker; hashing and OCR in browser |
| Supabase DB | 500 MB, pauses after 7 days inactivity | Chunk text capped at 1,000 characters; OCR text stored once per version; keep-alive ping via scheduled Worker |
| Supabase Auth | 50k MAU | - |
| Brevo | 300 emails/day | Batch reminder emails once a day; OTP is on demand |
| Cloudflare Pages | 500 builds/month | - |

## 11. Success metrics

- Time from opening the app to a saved, named, searchable scan: under 60 seconds on a phone.
- 90% of scans need no manual corner adjustment.
- 80% of documents keep the suggested name without editing.
- Search returns the intended document in the top 3 results for 90% of test queries.
- Zero cross-workspace data exposure in the security test suite.
- Monthly cost for a family with 2,000 documents: 0.

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| OpenCV.js and Tesseract.js are heavy (8 MB+ and 2 MB+) | Lazy load only on the Scan page; cache with the service worker; show a one-time "Preparing scanner" message. |
| Browser embeddings are slow on old phones | Run in a Web Worker, batch chunks, allow "Search by meaning" to be turned off; server-side provider later. |
| Supabase free project pauses | Scheduled Worker ping every 6 hours; clear message if it happens. |
| Email OTP for PIN reset weakens zero-knowledge | Documented trade-off; "No recovery" mode; OTP rate limits; re-wrapping only in Worker memory. |
| Worker 10 ms CPU limit | Keep Worker to I/O; no image processing; streaming R2 reads. |
| Users confuse "saved on device" with "uploaded" | Distinct icons and words for both states; upload queue always visible. |

## 13. Phases and acceptance

| Phase | Deliverable | Acceptance test |
|---|---|---|
| 1 | Auth, workspaces, terminology, members, groups, people, relationships, roles | A user signs up, creates a Family, adds 4 people with relationships, invites a member, and the UI shows "Family Members" not "Employees". |
| 2 | Upload, list, viewer, details, trash | Upload a PDF and an image from a phone; view it; move to trash; restore. |
| 3 | Scanner and OCR | Photograph a tilted page; auto crop; adjust corners; save; text is readable and searchable by name. |
| 4 | Smart details, names, links, duplicates | Passport scan is named "Name - Passport - YYYY", linked to the right person; uploading it again warns about duplicate. |
| 5 | Full-text search and filters | "dad passport" finds Rajesh Patel's passport; typo "pasport" still finds it. |
| 6 | Hybrid search | "travel document for father" finds the passport by meaning. |
| 7 | Versions, timeline, reminders, albums | Upload version 2; timeline lists it; expiry reminder email arrives. |
| 8 | Ask, voice, image search, smart albums | "When does Dad's passport expire?" answers with page citation; unknown question returns the fixed sentence. |
| 9 | Chaabi, Notes and Write | Set PIN; add password; change it; old password appears in history; forget PIN; receive OTP by email; set new PIN; passwords intact. Write a document; edit; version 2 created. |

## 14. Open questions

1. Should Chaabi vaults be shareable within a workspace in V1 (for family Wi-Fi passwords)? Proposed: V2, using per-item wrapping with member public keys.
2. Should OCR languages other than English be downloaded on demand or bundled? Proposed: on demand with a size warning.
3. Default retention for Trash: 30 days. Confirm.
4. Should downloads be logged by default? Proposed: off for Family, on for Company.
