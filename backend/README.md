# DastaVault database (Supabase / PostgreSQL)

This folder holds the schema for DastaVault: PostgreSQL 15+ on Supabase with
`pgvector`, `pg_trgm` and Supabase Auth.

```
backend/
  migrations/
    001_extensions.sql                 extensions, set_updated_at(), membership helpers
    002_profiles_workspaces.sql        profiles, workspaces, terminology, roles, members, invites
    003_people_groups.sql              groups, people, relationships, person_groups
    004_documents.sql                  documents, versions, files, pages, metadata, tags, links, uploads, custom fields
    005_search.sql                     documents.search_text (trigger-maintained), trigram indexes, search_documents_fts()
    006_vectors.sql                    document_chunks with vector(384), HNSW index, search_chunks()
    007_albums_reminders_activity.sql  albums, smart rules, reminders, activity_logs, shares, saved_searches, notifications
    008_notes.sql                      notes, note_links
    009_vault.sql                      Chaabi: vaults, vault_items, vault_item_history, vault_otp_codes, ai_provider_keys
    010_rls.sql                        row level security on every table + can_read_document()/can_edit_document()
  seed/
    dev_seed.sql                       optional tiny dev data set (needs a real auth user id)
```

## Running the migrations in the Supabase SQL editor

1. Open your project in the Supabase dashboard, then **SQL Editor** > **New query**.
2. Open `migrations/001_extensions.sql`, paste the whole file, press **Run**.
3. Repeat for `002` ... `010` **in numeric order**. Each file depends on the
   ones before it (tables, helper functions, triggers).
4. Every file is idempotent (`create table if not exists`, `create index if not
   exists`, `create or replace function`, `drop policy if exists` + `create policy`).
   Running a file twice is safe; running a *newer* file before an older one is not.

The SQL editor runs as the `postgres` role, whose `search_path` already includes
the `extensions` schema where Supabase installs extensions. If you run the
files with `psql` on a plain PostgreSQL server instead, run
`set search_path to public, extensions;` first (or install the extensions into
`public`), and create the `auth` schema stubs Supabase normally provides
(`auth.users`, `auth.uid()`, `auth.jwt()`), otherwise `002` and `010` will fail.

### Using the Supabase CLI instead

```
supabase db push            # applies files in supabase/migrations
```

If you use the CLI, copy `backend/migrations/*.sql` into `supabase/migrations/`
keeping the numeric prefixes (the CLI expects `<timestamp>_<name>.sql`; rename
`001_extensions.sql` to e.g. `20261001000001_extensions.sql` and so on).

## Verifying extensions

Run this after `001_extensions.sql`:

```sql
select extname, extversion, nspname as schema
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where extname in ('uuid-ossp', 'pgcrypto', 'vector', 'pg_trgm')
order by extname;
```

You should see all four rows (`vector` 0.5 or newer is required for the HNSW
index in `006`). Quick functional checks:

```sql
select gen_random_uuid();                                -- pgcrypto / core
select '[1,2,3]'::vector <=> '[1,2,4]'::vector;           -- pgvector cosine distance
select similarity('passport', 'pasport');                 -- pg_trgm (~0.5)
select public.is_workspace_member(gen_random_uuid());     -- helper from 001; returns false in the editor
```

## Verifying the schema after `010`

```sql
-- all application tables exist and have RLS enabled
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

-- policies per table
select tablename, count(*) as policies
from pg_policies
where schemaname = 'public'
group by tablename
order by tablename;

-- helper functions
select proname from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('is_workspace_member','workspace_role','is_workspace_admin','is_workspace_editor',
                  'can_read_document','can_edit_document','search_documents_fts','search_chunks',
                  'accept_workspace_invite','transfer_workspace_ownership','handle_new_user');

-- the auth trigger that creates profiles
select tgname from pg_trigger where tgname = 'on_auth_user_created';
```

Every row in `pg_tables` should show `rowsecurity = true`.

## How the pieces fit

- **Membership helpers** (`is_workspace_member`, `workspace_role`,
  `is_workspace_admin`, `is_workspace_editor`) are `SECURITY DEFINER` and read
  `workspace_members` for `auth.uid()`. All policies go through them, so
  policies never recurse into each other.
- **Document visibility** (`workspace` / `groups` / `people` / `private`, the
  `restricted` role and explicit `shares`) is implemented once in
  `can_read_document(doc_id)` and `can_edit_document(doc_id)` (010) and reused by
  every document-bound table (`document_versions`, `document_files`,
  `document_chunks`, ...).
- **Keyword search**: `documents.search_text` is a trigger-maintained
  `tsvector` (a generated column cannot look at other tables). It combines
  name, document number, linked people names, type, organisation, tags,
  summary and the current version's OCR text. Triggers on `document_tags`,
  `document_people`, `tags`, `people` and `document_versions` keep it fresh.
  `search_documents_fts(ws, q, lim)` returns ranked rows for members only and,
  because it is `SECURITY INVOKER`, RLS applies when called from the client.
- **Search by meaning**: `document_chunks.embedding` is `vector(384)` for the
  default browser model `Xenova/all-MiniLM-L6-v2`. If you switch to a model
  with a different output size, add a new column/table; the dimension is fixed
  per column. `search_chunks(ws, query_embedding, lim)` returns nearest chunks
  for members only.
- **Worker and the service role**: the Cloudflare Worker uses the service-role
  key (which bypasses RLS) only for file writes, cross-table transactions,
  Chaabi PIN verification / lockout / OTP handling and share-link resolution,
  and always after validating the JWT and checking membership itself. Everything
  the browser does directly through Supabase is covered by RLS.
- **Sign-up**: `handle_new_user()` (trigger on `auth.users`) creates the
  `profiles` row. `handle_new_workspace()` (trigger on `workspaces`) adds the
  owner to `workspace_members` and fills `workspace_terminology` from the
  template for the workspace `kind`.
- **Invites**: `accept_workspace_invite(token)` adds the signed-in user (matched
  by the JWT email) to the workspace. `transfer_workspace_ownership(ws, user)`
  is the only way to change the owner.

## Dev seed

`seed/dev_seed.sql` creates a small "Patel Family" workspace with people,
relationships, groups, one document (with version, file row, metadata, tag,
reminder and activity) and one note. It needs a real user id:

1. Sign up once through the app (or **Authentication > Users > Add user** in
   the dashboard).
2. Copy the user's UUID and paste it into the `v_user` line at the top of the
   seed file.
3. Run the file in the SQL editor. Re-running it is a no-op while the seeded
   workspace exists.

The seed does not create R2 objects; the `document_files.r2_object_key` it
inserts is a placeholder, so the viewer will show "file not found" for that
document until you upload something real.

## Resetting during development

To start over on a dev project (destroys all data):

```sql
drop schema public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
drop trigger if exists on_auth_user_created on auth.users;
```

then run `001` ... `010` again.
