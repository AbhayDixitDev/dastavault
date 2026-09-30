# DastaVault - Free Deployment Guide

This guide takes you from nothing to a working DastaVault running on free tiers. Follow the steps in order.
Every command is shown for Windows PowerShell and macOS/Linux where they differ. No credit card is needed for any
service in this guide (Cloudflare asks for a payment method only for paid R2 usage above the free 10 GB; the free
plan works without it).

Time needed: about 45 minutes the first time.

```
 What you will create
 +-------------------+     +---------------------+     +-------------------+     +--------------+
 | Supabase project  |     | Cloudflare account  |     | Brevo account     |     | Your machine |
 |  - Postgres + ext |     |  - R2 bucket        |     |  - verified sender|     |  - Node 20+  |
 |  - Auth           |     |  - Worker (API)     |     |  - API key        |     |  - git       |
 |  - URL + key      |     |  - Pages (frontend) |     +-------------------+     +--------------+
 +-------------------+     +---------------------+
```

## 0. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | 20 or newer | `node -v` |
| npm | 10 or newer | `npm -v` |
| Git | any recent | `git --version` |
| A GitHub (or GitLab) account | - | for Cloudflare Pages Git deploy |
| The repository cloned | - | `git clone <your fork> dastavault` |

Repository layout you will touch:

```
dastavault/
  backend/migrations/    SQL files to run in Supabase (step 1.3)
  backend/seed/          seed data (roles, permissions, terminology)
  worker/                Cloudflare Worker (API)
  frontend/              React app (Cloudflare Pages)
```

## 1. Supabase (database and auth)

### 1.1 Create the project

1. Go to https://supabase.com and sign up (GitHub login is easiest).
2. Click **New project**.
3. Organisation: your personal one. Name: `dastavault`. Database password: click **Generate a password** and
   **save it in Chaabi later** (you rarely need it, but keep it). Region: pick the one closest to your users
   (for India choose `ap-south-1` Mumbai or Singapore).
4. Plan: **Free**. Click **Create new project** and wait about 2 minutes.

### 1.2 Enable extensions

1. Left menu: **Database** -> **Extensions**.
2. Search `vector` and switch it **on** (schema `extensions` is fine; keep the default).
3. Search `pg_trgm` and switch it **on**.
4. `pgcrypto` is normally already on; if not, enable it (it provides `gen_random_uuid()`).

The first migration also runs `create extension if not exists ...`, so enabling here is a safety step.

### 1.3 Run migrations in order

1. Left menu: **SQL Editor** -> **New query**.
2. Open `backend/migrations/0001_extensions.sql` on your computer, copy all of it, paste, click **Run**.
3. Repeat for every file **in numeric order**: `0002_core.sql`, `0003_people.sql`, ... up to the last file.
   Do not skip a file. Each file is safe to run once; running it twice will error on "already exists", which you can ignore only if the first run succeeded.
4. Then run every file in `backend/seed/` (roles, permissions, terminology templates).
5. Verify: **Table Editor** should list `profiles`, `workspaces`, `documents`, `document_chunks`, `vaults` and the others.
   Run this check in the SQL editor:

```sql
select count(*) as tables from information_schema.tables where table_schema = 'public';
select extname from pg_extension where extname in ('vector','pg_trgm','pgcrypto');
select key from roles where workspace_id is null order by rank desc;   -- owner, admin, editor, viewer, restricted
```

Optional (recommended for later, not needed now): install the Supabase CLI and use `supabase db push`
instead of the SQL editor. The SQL editor is enough for the free plan.

### 1.4 Get the URL and keys

1. Left menu: **Project Settings** (gear) -> **API** (or **API Keys** in newer dashboards).
2. Copy:

| Name in dashboard | Goes to | Variable |
|---|---|---|
| Project URL, e.g. `https://abcd1234.supabase.co` | frontend and Worker | `VITE_SUPABASE_URL`, `SUPABASE_URL` |
| Publishable key `sb_publishable_...` (older projects: `anon` `public` key) | frontend | `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Secret key `sb_secret_...` (older projects: `service_role` key) | Worker only | `SUPABASE_SERVICE_ROLE_KEY` |
| JWT Secret (under **JWT Settings**; only exists for projects still using HS256) | Worker, optional | `SUPABASE_JWT_SECRET` |

Never paste the secret / service_role key anywhere in `frontend/`.

3. Check how your project signs tokens: **Project Settings** -> **JWT Keys** (or **Auth** -> **JWT**). If you see
   "Current key: ECC (P-256)" you are on ES256 and the Worker verifies through JWKS with no secret. If you only see
   a "JWT Secret" (legacy), copy it into `SUPABASE_JWT_SECRET`. You can migrate to asymmetric keys from that page
   at any time; the Worker supports both.

### 1.5 Auth settings

Left menu: **Authentication**.

1. **Providers** -> **Email**: keep enabled. Keep **Confirm email** on (PRD requires verification before creating a workspace).
   Turn on **Secure email change**. Leave magic link available (it is the same provider).
2. **URL Configuration**:
   - **Site URL**: `http://localhost:5173` for now. Change to your Pages URL in step 6.4.
   - **Redirect URLs**: add all of these (one per line):
     ```
     http://localhost:5173/**
     https://dastavault.pages.dev/**
     https://*.dastavault.pages.dev/**
     ```
     (replace `dastavault` with your Pages project name later; the wildcard covers preview deployments).
3. **Email Templates**: for each of *Confirm signup*, *Magic Link*, *Reset Password*, *Change Email Address*
   set the redirect link to your app's page, for example in *Reset Password*:
   ```html
   <h2>Reset your DastaVault password</h2>
   <p><a href="{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery">Set a new password</a></p>
   <p>If you did not ask for this, you can ignore this email.</p>
   ```
   and in *Confirm signup*:
   ```html
   <h2>Welcome to DastaVault</h2>
   <p><a href="{{ .SiteURL }}/verify?token_hash={{ .TokenHash }}&type=signup">Confirm your email</a></p>
   ```
   Keep the wording simple; the same templates work for family members and students.
4. **Rate limits**: defaults are fine on the free plan (Supabase's built-in mailer allows about 2 emails per hour
   per project for auth emails). If you hit that during testing, configure **SMTP settings** with your Brevo SMTP
   credentials (Brevo -> **SMTP & API** -> **SMTP**): host `smtp-relay.brevo.com`, port `587`, login = your Brevo
   account email, password = SMTP key, sender = your verified sender. This raises the auth email limit to Brevo's 300/day.
5. **Sessions**: leave JWT expiry at 3600 s. The app refreshes tokens automatically.

### 1.6 Google sign-in

The app already has a **Continue with Google** button on the sign-in and sign-up pages. It calls Supabase
(`signInWithOAuth({ provider: 'google' })`), so the Google client ID and secret live **only in the Supabase
dashboard**. Never put the client secret in `.env.local`, in the Worker, or in Git.

1. **Google Cloud Console** (<https://console.cloud.google.com/apis/credentials>):
   - Create or open an **OAuth 2.0 Client ID** of type **Web application**.
   - **Authorised JavaScript origins**: `http://localhost:5173` and later `https://YOUR-PROJECT.pages.dev`.
   - **Authorised redirect URIs**: exactly `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
     (copy the value shown in the Supabase Google provider page).
   - If the consent screen is in *Testing* mode, add the Google accounts you will sign in with under **Test users**.
2. **Supabase** -> **Authentication** -> **Providers** -> **Google**:
   - Toggle **Enable Sign in with Google**.
   - Paste the **Client ID** and **Client Secret** from Google.
   - Save.
3. Make sure the **Redirect URLs** list from step 1.5 includes your app origin, otherwise Supabase will
   refuse to send the user back to `/w` after Google finishes.
4. Test: open the app, click **Continue with Google**. The first time, Supabase creates the account and the
   `handle_new_user` trigger creates the profile row automatically. Users who first signed up with email and
   later use Google with the same address are linked to the same account.

If you ever paste the client secret anywhere public (chat, screenshot, commit), open the Google client, click
**Reset secret**, and paste the new one into Supabase.

## 2. Cloudflare account and Wrangler

### 2.1 Account

1. Sign up at https://dash.cloudflare.com/sign-up (free plan).
2. Verify your email. No domain is required; Workers and Pages get `*.workers.dev` and `*.pages.dev` addresses.
3. In the dashboard, open **Workers & Pages** once and accept the free plan; pick your `workers.dev` subdomain
   (for example `abhay`). Your API will live at `https://dastavault-api.abhay.workers.dev`.

### 2.2 Log in with Wrangler

```powershell
cd dastavault\worker
npm install
npx wrangler login
```

A browser window opens; click **Allow**. Check it worked:

```powershell
npx wrangler whoami
```

## 3. R2 bucket (private file storage)

1. In the dashboard, **R2 Object Storage** -> **Overview** -> if asked, click **Enable R2** (free plan; it may
   ask you to add a payment method for overage. The free allowance is 10 GB storage, 1 million class A operations
   and 10 million class B operations per month, and no egress charge).
2. Create the bucket from your terminal:

```powershell
npx wrangler r2 bucket create document-manager-files
```

3. Confirm:

```powershell
npx wrangler r2 bucket list
```

4. Leave **Public access** off (this is the default). Do **not** connect a custom domain to the bucket and do
   **not** enable the r2.dev subdomain. Files are only served through the Worker.
5. `worker/wrangler.toml` already contains the binding; check it matches:

```toml
name = "dastavault-api"
main = "src/index.js"
compatibility_date = "2026-09-01"

[[r2_buckets]]
binding = "FILES"
bucket_name = "document-manager-files"

[triggers]
crons = ["0 */6 * * *", "30 2 * * *"]

[vars]
ALLOWED_ORIGINS = "http://localhost:5173"
APP_URL = "http://localhost:5173"
MAX_UPLOAD_BYTES = "26214400"
SIGNED_URL_TTL_SECONDS = "300"
```

## 4. Brevo (email)

1. Sign up at https://www.brevo.com (free plan: 300 emails per day).
2. Complete the account profile (Brevo may hold new accounts for a short review; transactional sending works after that).
3. **Senders, Domains & Dedicated IPs** -> **Senders** -> **Add a sender**. Use an address you can read, for example
   `no-reply@yourdomain.com` or your Gmail address for testing. Open the confirmation email and click the link.
   The sender must show **Verified**.
   - If you own a domain, also authenticate it (**Domains** -> add DKIM/DMARC records). This improves delivery
     of OTP and reminder emails and is free.
4. **SMTP & API** -> **API Keys** -> **Generate a new API key**. Name it `dastavault-worker`. Copy the key now; it is shown once.
5. You will put three values into Worker secrets in step 5.2: the API key, the verified sender email, and a sender name (`DastaVault`).

## 5. Worker (API)

### 5.1 Local secrets for development

Create `worker/.dev.vars` (this file is git-ignored):

```powershell
Copy-Item .dev.vars.example .dev.vars     # macOS/Linux: cp .dev.vars.example .dev.vars
```

Fill it in:

```
SUPABASE_URL=https://abcd1234.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
SUPABASE_JWT_SECRET=                      # only if your project uses HS256; otherwise leave empty
FILE_URL_SIGNING_SECRET=<32 random bytes, base64>
VAULT_RECOVERY_SECRET=<32 random bytes, base64>
BREVO_API_KEY=xkeysib-...
BREVO_SENDER_EMAIL=no-reply@yourdomain.com
BREVO_SENDER_NAME=DastaVault
```

Generate the two random secrets (run twice, one per secret):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Back up `VAULT_RECOVERY_SECRET` somewhere safe** (for example in a password manager). If it is lost, the
Chaabi "Forgot PIN" flow stops working for every user; nothing else breaks.

### 5.2 Run locally

```powershell
npx wrangler dev
```

Open http://localhost:8787/api/v1/health - you should see `{"ok":true,...}`. Local R2 is simulated on disk
under `.wrangler/state`, so uploads work offline too.

### 5.3 Put production secrets

Run each command; Wrangler prompts you to paste the value (it is not echoed):

```powershell
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SUPABASE_JWT_SECRET          # skip if your project is on ES256 / JWKS
npx wrangler secret put FILE_URL_SIGNING_SECRET
npx wrangler secret put VAULT_RECOVERY_SECRET
npx wrangler secret put BREVO_API_KEY
npx wrangler secret put BREVO_SENDER_EMAIL
npx wrangler secret put BREVO_SENDER_NAME
```

Check the list (values are never shown):

```powershell
npx wrangler secret list
```

### 5.4 Deploy

```powershell
npx wrangler deploy
```

The output ends with the URL, for example `https://dastavault-api.abhay.workers.dev`. Test it:

```powershell
curl https://dastavault-api.abhay.workers.dev/api/v1/health
```

Write this URL down; it becomes `VITE_API_URL` in the frontend. You will redeploy once more in step 6.4 after you
know the Pages URL.

## 6. Frontend

### 6.1 Local environment

```powershell
cd ..\frontend
npm install
Copy-Item .env.example .env.local
```

Edit `frontend/.env.local`:

```
VITE_SUPABASE_URL=https://abcd1234.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_API_URL=http://localhost:8787
```

### 6.2 Run locally

Keep `npx wrangler dev` running in the `worker` folder, then in the `frontend` folder:

```powershell
npm run dev
```

Open http://localhost:5173. Sign up, open the confirmation email, sign in, create a workspace.
To test on your phone on the same Wi-Fi, run `npm run dev -- --host` and open `http://<your-pc-ip>:5173`.
The camera needs HTTPS or localhost; on a phone use the Pages deployment (step 6.3) or a tunnel such as
`npx cloudflared tunnel --url http://localhost:5173`.

### 6.3 Deploy to Cloudflare Pages (Git)

1. Push your repository to GitHub.
2. Cloudflare dashboard -> **Workers & Pages** -> **Create** -> **Pages** -> **Connect to Git**.
3. Authorise GitHub, choose the `dastavault` repository, click **Begin setup**.
4. Settings:

| Field | Value |
|---|---|
| Project name | `dastavault` (this gives `https://dastavault.pages.dev`; pick another if taken) |
| Production branch | `main` |
| Framework preset | Vite (or None) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory (Advanced) | `frontend` |

5. **Environment variables** (Production, and again for Preview if you use previews):

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://abcd1234.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` |
| `VITE_API_URL` | `https://dastavault-api.abhay.workers.dev` |
| `NODE_VERSION` | `20` |

6. Click **Save and Deploy**. The first build takes 2 to 4 minutes. Your app is at `https://dastavault.pages.dev`.
7. Every push to `main` deploys production; other branches get preview URLs like `https://<hash>.dastavault.pages.dev`.

The repository ships `frontend/public/_headers` with the security headers (CSP, HSTS, Permissions-Policy allowing
camera and microphone on the app origin) and `frontend/public/_redirects` with `/* /index.html 200` for React Router.

### 6.4 Point everything at the real URLs

1. **Worker CORS**: edit `worker/wrangler.toml`:

```toml
[vars]
ALLOWED_ORIGINS = "http://localhost:5173,https://dastavault.pages.dev"
APP_URL = "https://dastavault.pages.dev"
```

   If you want preview deployments to work too, add `https://*.dastavault.pages.dev` (the Worker's CORS
   middleware supports one wildcard subdomain pattern). Then:

```powershell
cd ..\worker
npx wrangler deploy
```

2. **Supabase Auth**: **Authentication** -> **URL Configuration** -> Site URL = `https://dastavault.pages.dev`.
   Make sure the redirect URLs from step 1.5 include the Pages URL.
3. Open `https://dastavault.pages.dev` on your phone, sign in, tap the browser menu -> **Add to Home screen**
   (Android) or **Share** -> **Add to Home Screen** (iOS) to install the PWA.

## 7. R2 CORS (only for presigned direct uploads, later)

V1 uploads go through the Worker, so R2 needs no CORS. When you enable presigned direct uploads for files above
5 MB (P1), the browser will `PUT` straight to R2 and the bucket needs a CORS policy.

Dashboard: **R2** -> `document-manager-files` -> **Settings** -> **CORS policy** -> **Add** and paste:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "https://dastavault.pages.dev"
    ],
    "AllowedMethods": ["PUT", "HEAD"],
    "AllowedHeaders": ["content-type", "content-length", "x-amz-content-sha256", "x-amz-date", "authorization"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Also create an R2 API token for presigning: **R2** -> **Manage R2 API Tokens** -> **Create API token** ->
permission **Object Read & Write**, limited to this bucket -> copy **Access Key ID**, **Secret Access Key** and the
S3 endpoint `https://<account_id>.r2.cloudflarestorage.com`, and store them as Worker secrets
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`. Keep `GET` out of the allowed methods; reads always
go through the Worker's signed URLs.

## 8. Keep-alive cron (stops Supabase from pausing)

Supabase pauses free projects after 7 days without activity. The Worker's cron trigger `0 */6 * * *` (every 6
hours) calls `/health/db`, which runs `select 1` against the database. This counts as activity and keeps the
project awake at no cost (about 120 requests per month).

- The trigger is already in `wrangler.toml`; `npx wrangler deploy` registers it. Confirm in the dashboard:
  **Workers & Pages** -> `dastavault-api` -> **Settings** -> **Triggers** -> **Cron Triggers**.
- The second trigger `30 2 * * *` (02:30 UTC daily) sends reminder emails, purges trash older than 30 days,
  cleans orphaned uploads and expired OTP codes.
- Test locally: `npx wrangler dev --test-scheduled` then open `http://localhost:8787/__scheduled?cron=0+*/6+*+*+*`.
- If the project still gets paused (for example the Worker was down for a week), open the Supabase dashboard
  and click **Restore project**; data is kept for 90 days after pausing.

## 9. Free-tier limits to remember

| Service | Free limit | What the app does |
|---|---|---|
| Cloudflare Pages | 500 builds/month, unlimited bandwidth | Only `main` and PR branches build |
| Cloudflare Workers | 100,000 requests/day, 10 ms CPU each | Storage meter warns; heavy work stays in the browser |
| Cloudflare R2 | 10 GB, 1M class A (writes) and 10M class B (reads) per month, zero egress | Settings > Storage shows a meter and warns at 80% |
| Supabase | 500 MB database, 1 GB file storage (unused), 50k MAU, pauses after 7 idle days | Chunk text capped at 1,000 characters; keep-alive cron |
| Brevo | 300 emails/day | Reminders batched once a day; OTP on demand |

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `npx wrangler login` opens no browser | Headless or remote shell | Run `npx wrangler login --browser=false`, open the printed URL manually, paste the callback URL |
| `Error: No such bucket` on deploy | Bucket name typo or created in another account | `npx wrangler r2 bucket list`; check `bucket_name` in `wrangler.toml` |
| API returns `401 {"code":"invalid_token"}` | `SUPABASE_URL` in the Worker does not match the project that issued the JWT, or project uses HS256 and `SUPABASE_JWT_SECRET` is empty | Compare URLs; set the JWT secret or migrate the project to asymmetric keys (Project Settings -> JWT Keys) |
| API returns `401 {"code":"token_expired"}` constantly | Device clock is wrong | Fix the clock; the app refreshes tokens automatically otherwise |
| Browser console: CORS error on `/api/v1/...` | Pages URL not in `ALLOWED_ORIGINS` | Add the exact origin (scheme + host, no trailing slash) and redeploy the Worker |
| Sign-up email never arrives | Supabase built-in mailer limit (2 per hour) or spam folder | Configure Brevo SMTP in Supabase Auth (step 1.5.4); check spam |
| Confirmation link opens `localhost` in production | Site URL still `http://localhost:5173` | Update Site URL and redirect URLs (step 6.4) |
| `relation "documents" does not exist` | Migrations not run or run out of order | Run `backend/migrations/` files in numeric order in the SQL editor |
| `type "vector" does not exist` | `vector` extension not enabled | Database -> Extensions -> enable `vector`, rerun the migration |
| `function gen_random_uuid() does not exist` | `pgcrypto` off | Enable `pgcrypto` |
| Search finds nothing after upload | OCR/embedding still running in the browser, or document not committed | Wait for "Document is ready to search"; check the upload queue screen |
| "Search by meaning" never becomes ready | Model download blocked or browser too old | Check network tab for `huggingface.co` model files; first load is about 25 MB and is cached; older phones: turn off semantic search in Settings > Features |
| Camera does not open on phone | Page served over HTTP or Permissions-Policy blocks it | Use the HTTPS Pages URL; check `_headers` allows `camera=(self)` |
| Scanner shows "Preparing scanner" forever | `opencv.js` not served | Confirm `frontend/public/opencv.js` exists and builds into `dist`; check the browser console for a 404 |
| Upload fails with 413 or 415 | File over 25 MB, or type not allowed / magic bytes mismatch | Compress or split; allowed types are JPEG, PNG, WEBP, HEIC (converted), PDF, TXT, MD, DOCX, XLSX, CSV |
| Files return 403 `signature_invalid` | `FILE_URL_SIGNING_SECRET` changed between sign and read, or the link is older than 5 minutes | The app re-signs automatically on refresh; keep the secret stable |
| Chaabi says "PIN reset is not available" | `recovery_enabled` is off, or `VAULT_RECOVERY_SECRET` missing in the Worker | Check `npx wrangler secret list`; if the secret was regenerated, existing vaults cannot be recovered by email (users must remember their PIN) |
| OTP email not received | Brevo sender not verified, daily limit reached, or account under review | Brevo -> Senders must show Verified; check **Transactional** -> **Logs** |
| Reminder emails never sent | Cron trigger missing or Worker error | Dashboard -> Worker -> **Logs** (Real-time logs); confirm the cron trigger exists |
| Supabase project paused | No activity for 7 days and cron was not running | Restore in the Supabase dashboard; confirm the cron trigger |
| Pages build fails: `Cannot find module` | Root directory not set to `frontend` | Set **Root directory** = `frontend`, rebuild |
| Pages build fails on Node version | Old default Node | Add env var `NODE_VERSION=20` |
| `npx wrangler dev` error `.dev.vars` not found | File not created | Copy `.dev.vars.example` to `.dev.vars` and fill it |
| Local uploads vanish after restart | Local R2 simulation reset | Normal for `wrangler dev`; use `--persist-to .wrangler/state` (default) and do not delete that folder |
| Worker logs `CPU time limit exceeded` | Something heavy landed in the Worker (hashing, image processing) | Move it to the browser; the Worker must stay I/O only |

## 11. Checklist before inviting your family or team

- [ ] Migrations and seed run; `select key from roles` returns 5 rows
- [ ] `vector` and `pg_trgm` enabled
- [ ] Site URL and redirect URLs point at the Pages URL
- [ ] Email templates link to `/verify` and `/reset-password`
- [ ] Worker secrets set (8 of them); `VAULT_RECOVERY_SECRET` backed up
- [ ] `ALLOWED_ORIGINS` and `APP_URL` contain the Pages URL; Worker redeployed
- [ ] R2 bucket is private (no public access, no r2.dev domain)
- [ ] Brevo sender verified; a test invite email arrived
- [ ] Cron triggers visible in the Worker dashboard
- [ ] PWA installs on a phone; camera opens; a scan uploads and becomes searchable
- [ ] `.env.local` and `.dev.vars` are not committed (`git status` shows them ignored)
