# DastaVault

**Your family's, team's or company's documents, passwords and notes. In one private vault. Searchable by meaning, on any phone.**

DastaVault is a mobile-first, AI-assisted Document Management System built to run on free-tier services.
It scans paper with your phone camera, reads the text, names the file for you, links it to the right person
or group, and lets you find it later by typing or speaking something as simple as *"dad passport"*.

It also includes **Chaabi**, a PIN-protected password keeper, and **Notes**, a simple place to write and keep
text documents next to your files.

> "Dastavez" (दस्तावेज़) means *document*. "Chaabi" (चाबी) means *key*.

---

## What it does

| Area | Highlights |
|------|-----------|
| Scan | Camera capture, automatic edge detection, perspective fix, rectangle or 4-corner crop, deskew, contrast boost. Original is always kept. |
| Read | OCR in the browser (Tesseract.js), text extraction from PDFs (PDF.js). Upload never fails because reading failed. |
| Understand | Suggests document type, person, dates, numbers, organisation, a short summary and a clean name like `Rahul Patel - Passport - 2032`. You can correct anything. |
| Find | Hybrid search: keyword (PostgreSQL full text), meaning (pgvector), exact matches, filters, relationship words like *mom* or *dad*. Voice search and image search. |
| Ask | "When does Dad's passport expire?" answered only from your own documents, with page sources. Bring your own AI key. |
| Organise | Workspaces with their own words (Family / Company / School / custom), members, groups, relationships, tags, albums and smart albums. |
| Keep safe | Versions, timeline, duplicate warnings, trash and restore, reminders for expiry dates. |
| Passwords (Chaabi) | PIN-locked vault, encrypted on your device, password history, PIN reset by email OTP (Brevo). |
| Notes | Write notes and documents in the app, edit them later, attach them to people and folders. |
| Offline | Installable PWA. Captures are saved on the phone and uploaded when the network is back. |

## Tech stack

**Frontend:** React 19, Vite, JavaScript + JSX (no TypeScript), Tailwind CSS, shadcn/ui, Aceternity UI, Motion,
Lucide icons, React Router, Redux Toolkit + RTK Query, React Hook Form + Zod, Dexie (IndexedDB), vite-plugin-pwa,
OpenCV.js, Tesseract.js, PDF.js, Transformers.js.

**Backend:** Cloudflare Workers + Hono (serverless API), Cloudflare R2 (private file storage, accessed through a Worker binding).

**Data:** Supabase PostgreSQL with `pgvector` (semantic search), full-text search and `pg_trgm` (fuzzy matching). Supabase Auth for sign-in.

**Email:** Brevo (transactional email for OTP codes and reminders, free tier).

Everything is chosen so the first version costs **zero or near zero** per month.

## Repository layout

```
dastavault/
  frontend/        React + Vite PWA (Cloudflare Pages)
  worker/          Cloudflare Worker + Hono API
  backend/
    migrations/    SQL migrations for Supabase PostgreSQL (Supabase is the database)
  docs/
    PRD.md         Product Requirements Document
    ARCHITECTURE.md  Architecture, schema, flows, security, deployment
    SETUP.md       Step-by-step free deployment guide
  README.md
```

## Quick start (local)

Prerequisites: Node.js 20+, a free [Supabase](https://supabase.com) project, a free [Cloudflare](https://cloudflare.com) account.

1. **Database**: run every file in `backend/migrations/` in order through the Supabase SQL editor. Enable the `vector` and `pg_trgm` extensions (the first migration does this).
2. **Worker**
   ```bash
   cd worker
   npm install
   cp .dev.vars.example .dev.vars   # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BREVO_API_KEY ...
   npx wrangler r2 bucket create document-manager-files
   npx wrangler dev
   ```
3. **Frontend**
   ```bash
   cd frontend
   npm install
   cp .env.example .env.local        # fill in VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_API_URL
   npm run dev
   ```
4. Open http://localhost:5173, create an account, create your first workspace.

Full deployment instructions (Supabase, R2, Worker secrets, Cloudflare Pages) are in [docs/SETUP.md](docs/SETUP.md).

## Development phases

The product is built phase by phase. Each phase is usable on its own.

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | App shell, routing, theme, Supabase Auth (email, magic link, Google), workspaces, terminology, members, groups, people, relationships, roles | Done |
| 2 | R2 upload, document records, list, viewer, details, trash | Done |
| 3 | Mobile scanner, OpenCV crop, manual and perspective crop, compression, OCR | Done |
| 4 | Smart details, smart names, tags, people and group links, duplicate detection | Done |
| 5 | Full-text search, fuzzy matching, filters | Done |
| 6 | pgvector, local embeddings, hybrid search with Reciprocal Rank Fusion | Done |
| 7 | Versions, timeline, reminders, albums, sharing | Done |
| 8 | Ask your documents (RAG), voice search, image search, smart albums | Done (face grouping deferred) |
| 9 | Chaabi password keeper, Notes, in-app writing and document editing | Done |

## Status of the running pieces

| Piece | State |
|-------|-------|
| `backend/migrations` | 11 SQL files, run in order in the Supabase SQL editor |
| `worker/` | About 200 routes covering every module; verified end to end against a live Supabase project |
| `frontend/` | All screens built; heavy pages are code-split; OpenCV, Tesseract and the embedding model load on demand |

See [docs/API_CONTRACT.md](docs/API_CONTRACT.md) for every route and response shape.

See [docs/PRD.md](docs/PRD.md) for the complete requirements and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the technical design.

## Security in one paragraph

Files live in a private R2 bucket and are only ever read or written by the Worker, after it has checked the user's
session and workspace membership. The browser never sees R2 keys or the Supabase service-role key. Every search,
including vector search, is filtered by workspace inside the database query. Passwords in Chaabi are encrypted on
the device with a key derived from your PIN; the server stores only ciphertext.

## License

MIT. Personal project by [Abhay Dixit](https://github.com/AbhayDixitDev).
