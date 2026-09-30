-- =============================================================================
-- DastaVault - 004_documents.sql
-- Documents, versions, files, pages, metadata, tags, links, uploads,
-- custom fields.
-- Requires: 003_people_groups.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- documents (logical document; has many versions, each version has many files)
-- -----------------------------------------------------------------------------
create table if not exists public.documents (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  name               text not null,
  original_filename  text,
  previous_names     text[] not null default '{}',
  document_type      text,                                   -- "Passport", "Invoice", "Written" ...
  status             text not null default 'processing' check (status in ('processing','ready','failed')),
  visibility         text not null default 'workspace' check (visibility in ('workspace','groups','people','private')),
  summary            text,
  organisation       text,
  document_number    text,
  issue_date         date,
  expiry_date        date,
  current_version_id uuid,                                   -- FK added below (circular with document_versions)
  page_count         integer,
  perceptual_hash    text,                                   -- image pHash for duplicate detection (META-10)
  is_favorite        boolean not null default false,
  is_pinned          boolean not null default false,
  created_by         uuid references auth.users(id) on delete set null,
  deleted_by         uuid references auth.users(id) on delete set null,
  deleted_at         timestamptz,                            -- trash (DOC-10)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists documents_workspace_id_idx       on public.documents (workspace_id);
create index if not exists documents_created_by_idx         on public.documents (created_by);
create index if not exists documents_deleted_by_idx         on public.documents (deleted_by);
create index if not exists documents_current_version_id_idx on public.documents (current_version_id);
create index if not exists documents_ws_type_idx            on public.documents (workspace_id, document_type);
create index if not exists documents_ws_expiry_idx          on public.documents (workspace_id, expiry_date) where expiry_date is not null;
create index if not exists documents_ws_updated_idx         on public.documents (workspace_id, updated_at desc);
create index if not exists documents_ws_number_idx          on public.documents (workspace_id, document_number) where document_number is not null;
create index if not exists documents_ws_phash_idx           on public.documents (workspace_id, perceptual_hash) where perceptual_hash is not null;
create index if not exists documents_deleted_at_idx         on public.documents (deleted_at) where deleted_at is not null;

select public.ensure_updated_at_trigger('documents');

-- -----------------------------------------------------------------------------
-- document_versions
-- -----------------------------------------------------------------------------
create table if not exists public.document_versions (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  document_id         uuid not null references public.documents(id) on delete cascade,
  version_number      integer not null,
  comment             text,
  previous_version_id uuid references public.document_versions(id) on delete set null,
  source              text not null default 'upload' check (source in ('upload','scan','written','edit','restore','import')),
  hash                text,                                   -- SHA-256 of the primary file (hex)
  ocr_text            text,                                   -- cleaned text of the whole version
  ocr_text_raw        text,
  ocr_language        text,
  ocr_confidence      numeric(5,2),
  ocr_status          text not null default 'pending' check (ocr_status in ('pending','done','failed','skipped','manual')),
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (document_id, version_number)
);

create index if not exists document_versions_workspace_id_idx        on public.document_versions (workspace_id);
create index if not exists document_versions_document_id_idx         on public.document_versions (document_id);
create index if not exists document_versions_previous_version_id_idx on public.document_versions (previous_version_id);
create index if not exists document_versions_created_by_idx          on public.document_versions (created_by);
create index if not exists document_versions_hash_idx                on public.document_versions (workspace_id, hash) where hash is not null;

select public.ensure_updated_at_trigger('document_versions');

-- documents.current_version_id -> document_versions (added after both tables exist)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'documents_current_version_id_fkey'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table public.documents
      add constraint documents_current_version_id_fkey
      foreign key (current_version_id) references public.document_versions(id) on delete set null;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- document_files (physical objects in R2)
-- -----------------------------------------------------------------------------
create table if not exists public.document_files (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  document_id       uuid not null references public.documents(id) on delete cascade,
  version_id        uuid not null references public.document_versions(id) on delete cascade,
  r2_object_key     text not null unique,                     -- ids only, never user filenames
  original_filename text,
  mime_type         text not null,
  size_bytes        bigint not null default 0 check (size_bytes >= 0),
  sha256            text,
  page_number       integer,
  kind              text not null default 'original' check (kind in ('original','processed','thumbnail','pdf','attachment')),
  width             integer,
  height            integer,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists document_files_workspace_id_idx on public.document_files (workspace_id);
create index if not exists document_files_document_id_idx  on public.document_files (document_id);
create index if not exists document_files_version_id_idx   on public.document_files (version_id);
create index if not exists document_files_created_by_idx   on public.document_files (created_by);
create index if not exists document_files_sha256_idx       on public.document_files (workspace_id, sha256) where sha256 is not null;

select public.ensure_updated_at_trigger('document_files');

-- -----------------------------------------------------------------------------
-- document_pages (per-page OCR results and thumbnails)
-- -----------------------------------------------------------------------------
create table if not exists public.document_pages (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  document_id       uuid not null references public.documents(id) on delete cascade,
  version_id        uuid not null references public.document_versions(id) on delete cascade,
  page_number       integer not null check (page_number >= 1),
  file_id           uuid references public.document_files(id) on delete set null,
  thumbnail_file_id uuid references public.document_files(id) on delete set null,
  has_embedded_text boolean not null default false,          -- PDF text layer found (OCR-2)
  ocr_text_raw      text,
  ocr_text          text,
  ocr_language      text,
  ocr_confidence    numeric(5,2),
  word_boxes        jsonb,                                    -- [{text,x0,y0,x1,y1,conf}] where practical
  rotation          integer not null default 0,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (version_id, page_number)
);

create index if not exists document_pages_workspace_id_idx      on public.document_pages (workspace_id);
create index if not exists document_pages_document_id_idx       on public.document_pages (document_id);
create index if not exists document_pages_file_id_idx           on public.document_pages (file_id);
create index if not exists document_pages_thumbnail_file_id_idx on public.document_pages (thumbnail_file_id);
create index if not exists document_pages_created_by_idx        on public.document_pages (created_by);

select public.ensure_updated_at_trigger('document_pages');

-- -----------------------------------------------------------------------------
-- document_metadata (confirmed values, key/value rows)
-- Keys are free text, e.g. 'passport_number', 'invoice_total', 'currency'.
-- -----------------------------------------------------------------------------
create table if not exists public.document_metadata (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id  uuid not null references public.documents(id) on delete cascade,
  key          text not null,
  value_text   text,
  value_number numeric,
  value_date   date,
  value_json   jsonb,
  source       text not null default 'manual' check (source in ('rule','ai','manual','import')),
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (document_id, key)
);

create index if not exists document_metadata_workspace_id_idx on public.document_metadata (workspace_id);
create index if not exists document_metadata_confirmed_by_idx on public.document_metadata (confirmed_by);
create index if not exists document_metadata_created_by_idx   on public.document_metadata (created_by);
create index if not exists document_metadata_ws_key_text_idx  on public.document_metadata (workspace_id, key, value_text);

select public.ensure_updated_at_trigger('document_metadata');

-- -----------------------------------------------------------------------------
-- document_metadata_suggestions (rule/AI suggestions awaiting the user, META-3)
-- Also used for suggested name (key='name'), person (key='person', value_json={person_id})
-- and group (key='group') suggestions.
-- -----------------------------------------------------------------------------
create table if not exists public.document_metadata_suggestions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id  uuid not null references public.documents(id) on delete cascade,
  version_id   uuid references public.document_versions(id) on delete cascade,
  key          text not null,
  value_text   text,
  value_number numeric,
  value_date   date,
  value_json   jsonb,
  confidence   numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source       text not null default 'rule' check (source in ('rule','ai','ocr','duplicate')),
  status       text not null default 'pending' check (status in ('pending','accepted','rejected')),
  reviewed_by  uuid references auth.users(id) on delete set null,
  reviewed_at  timestamptz,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists document_metadata_suggestions_workspace_id_idx on public.document_metadata_suggestions (workspace_id);
create index if not exists document_metadata_suggestions_document_id_idx  on public.document_metadata_suggestions (document_id, status);
create index if not exists document_metadata_suggestions_version_id_idx   on public.document_metadata_suggestions (version_id);
create index if not exists document_metadata_suggestions_reviewed_by_idx  on public.document_metadata_suggestions (reviewed_by);
create index if not exists document_metadata_suggestions_created_by_idx   on public.document_metadata_suggestions (created_by);

select public.ensure_updated_at_trigger('document_metadata_suggestions');

-- -----------------------------------------------------------------------------
-- tags and document_tags
-- -----------------------------------------------------------------------------
create table if not exists public.tags (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  color        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists tags_workspace_id_idx on public.tags (workspace_id);
create index if not exists tags_created_by_idx   on public.tags (created_by);
create unique index if not exists tags_workspace_name_unique on public.tags (workspace_id, lower(name));

select public.ensure_updated_at_trigger('tags');

create table if not exists public.document_tags (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id  uuid not null references public.documents(id) on delete cascade,
  tag_id       uuid not null references public.tags(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (document_id, tag_id)
);

create index if not exists document_tags_workspace_id_idx on public.document_tags (workspace_id);
create index if not exists document_tags_tag_id_idx       on public.document_tags (tag_id);
create index if not exists document_tags_created_by_idx   on public.document_tags (created_by);

-- -----------------------------------------------------------------------------
-- document_people and document_groups (links)
-- -----------------------------------------------------------------------------
create table if not exists public.document_people (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id  uuid not null references public.documents(id) on delete cascade,
  person_id    uuid not null references public.people(id) on delete cascade,
  link_type    text not null default 'owner' check (link_type in ('owner','mentioned','signatory','other')),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (document_id, person_id)
);

create index if not exists document_people_workspace_id_idx on public.document_people (workspace_id);
create index if not exists document_people_person_id_idx    on public.document_people (person_id);
create index if not exists document_people_created_by_idx   on public.document_people (created_by);

create table if not exists public.document_groups (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id  uuid not null references public.documents(id) on delete cascade,
  group_id     uuid not null references public.groups(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (document_id, group_id)
);

create index if not exists document_groups_workspace_id_idx on public.document_groups (workspace_id);
create index if not exists document_groups_group_id_idx     on public.document_groups (group_id);
create index if not exists document_groups_created_by_idx   on public.document_groups (created_by);

-- -----------------------------------------------------------------------------
-- upload_sessions (idempotent uploads; client_upload_id generated in browser)
-- -----------------------------------------------------------------------------
create table if not exists public.upload_sessions (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  client_upload_id  text not null,
  document_id       uuid references public.documents(id) on delete set null,
  version_id        uuid references public.document_versions(id) on delete set null,
  file_id           uuid references public.document_files(id) on delete set null,
  status            text not null default 'pending' check (status in ('pending','uploading','uploaded','failed','cancelled')),
  original_filename text,
  mime_type         text,
  size_bytes        bigint check (size_bytes is null or size_bytes >= 0),
  sha256            text,
  r2_object_key     text,
  error             text,
  presigned_until   timestamptz,                             -- direct-upload URL expiry (10 min)
  expires_at        timestamptz not null default (now() + interval '1 day'),
  completed_at      timestamptz,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (workspace_id, client_upload_id)
);

create index if not exists upload_sessions_document_id_idx on public.upload_sessions (document_id);
create index if not exists upload_sessions_version_id_idx  on public.upload_sessions (version_id);
create index if not exists upload_sessions_file_id_idx     on public.upload_sessions (file_id);
create index if not exists upload_sessions_created_by_idx  on public.upload_sessions (created_by);
create index if not exists upload_sessions_status_idx      on public.upload_sessions (status, expires_at);

select public.ensure_updated_at_trigger('upload_sessions');

-- -----------------------------------------------------------------------------
-- custom_field_definitions and custom_field_values (META-9, WS-7)
-- -----------------------------------------------------------------------------
create table if not exists public.custom_field_definitions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  applies_to    text not null default 'document' check (applies_to in ('document','person')),
  document_type text,                                        -- null = all document types
  key           text not null,
  label         text not null,
  field_type    text not null check (field_type in ('text','number','date','choice','boolean')),
  options       jsonb not null default '[]'::jsonb,          -- for 'choice'
  is_required   boolean not null default false,
  position      integer not null default 0,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists custom_field_definitions_workspace_id_idx on public.custom_field_definitions (workspace_id);
create index if not exists custom_field_definitions_created_by_idx   on public.custom_field_definitions (created_by);
create unique index if not exists custom_field_definitions_unique_key
  on public.custom_field_definitions (workspace_id, applies_to, coalesce(document_type, ''), key);

select public.ensure_updated_at_trigger('custom_field_definitions');

create table if not exists public.custom_field_values (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  field_id     uuid not null references public.custom_field_definitions(id) on delete cascade,
  document_id  uuid references public.documents(id) on delete cascade,
  person_id    uuid references public.people(id) on delete cascade,
  value_text   text,
  value_number numeric,
  value_date   date,
  value_bool   boolean,
  value_json   jsonb,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check ((document_id is not null)::int + (person_id is not null)::int = 1)
);

create index if not exists custom_field_values_workspace_id_idx on public.custom_field_values (workspace_id);
create index if not exists custom_field_values_field_id_idx     on public.custom_field_values (field_id);
create index if not exists custom_field_values_document_id_idx  on public.custom_field_values (document_id);
create index if not exists custom_field_values_person_id_idx    on public.custom_field_values (person_id);
create index if not exists custom_field_values_created_by_idx   on public.custom_field_values (created_by);
create unique index if not exists custom_field_values_field_document_unique
  on public.custom_field_values (field_id, document_id) where document_id is not null;
create unique index if not exists custom_field_values_field_person_unique
  on public.custom_field_values (field_id, person_id) where person_id is not null;

select public.ensure_updated_at_trigger('custom_field_values');
