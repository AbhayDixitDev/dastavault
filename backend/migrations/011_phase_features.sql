-- =============================================================================
-- DastaVault - 011_phase_features.sql
-- Additive changes needed by the Phase 2-9 Worker routes.
-- Requires: 001 .. 010. Safe to re-run (idempotent).
--
--  1. reminders: accept the API contract status values (pending/done/snoozed)
--     and allow several ad-hoc reminders per document (unique offset only
--     applies when a field_name is set).
--  2. albums: `rules` (smart album JSON from the API contract) and
--     `cover_file_id` (a document_files row used as the album cover).
--  3. search_documents_fts / search_chunks: also usable by the Worker, which
--     calls them with the service role (auth.uid() is null there, so the
--     is_workspace_member() guard alone would return no rows). The Worker
--     performs its own membership + visibility checks before calling.
--  4. similar_documents_by_text(ws, sample, lim): pg_trgm similarity of the
--     current version's text (duplicate detection).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. reminders
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.reminders'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.reminders drop constraint %I', r.conname);
  end loop;
end;
$$;

alter table public.reminders
  add constraint reminders_status_check
  check (status in ('scheduled','pending','sent','done','snoozed','dismissed','cancelled'));

alter table public.reminders alter column status set default 'pending';

drop index if exists public.reminders_unique_offset;
create unique index if not exists reminders_unique_offset
  on public.reminders (document_id, field_name, days_before)
  where document_id is not null and field_name is not null;

-- -----------------------------------------------------------------------------
-- 2. albums
-- -----------------------------------------------------------------------------
alter table public.albums add column if not exists rules jsonb not null default '{}'::jsonb;
alter table public.albums add column if not exists cover_file_id uuid references public.document_files(id) on delete set null;
create index if not exists albums_cover_file_id_idx on public.albums (cover_file_id);

-- -----------------------------------------------------------------------------
-- 3. search functions callable by the Worker (service role)
-- -----------------------------------------------------------------------------
create or replace function public.search_documents_fts(ws uuid, q text, lim int default 20)
returns table (
  document_id     uuid,
  name            text,
  document_type   text,
  organisation    text,
  summary         text,
  issue_date      date,
  expiry_date     date,
  status          text,
  is_favorite     boolean,
  updated_at      timestamptz,
  rank            real,
  name_similarity real,
  headline        text
)
language sql
stable
set search_path = public, extensions
as $$
  with params as (
    select
      websearch_to_tsquery('english', coalesce(q, '')) as tsq_en,
      websearch_to_tsquery('simple',  coalesce(q, '')) as tsq_simple,
      coalesce(q, '') as raw
  )
  select
    d.id,
    d.name,
    d.document_type,
    d.organisation,
    d.summary,
    d.issue_date,
    d.expiry_date,
    d.status,
    d.is_favorite,
    d.updated_at,
    greatest(
      ts_rank_cd(d.search_text, p.tsq_en),
      ts_rank_cd(d.search_text, p.tsq_simple)
    )::real as rank,
    similarity(d.name, p.raw)::real as name_similarity,
    ts_headline('english', coalesce(d.summary, d.name), p.tsq_en,
                'MaxWords=20, MinWords=8, MaxFragments=1') as headline
  from public.documents d
  cross join params p
  where d.workspace_id = ws
    and (current_user = 'service_role' or public.is_workspace_member(ws))
    and d.deleted_at is null
    and length(p.raw) > 0
    and (
         d.search_text @@ p.tsq_en
      or d.search_text @@ p.tsq_simple
      or d.name % p.raw
    )
  order by
    (greatest(ts_rank_cd(d.search_text, p.tsq_en), ts_rank_cd(d.search_text, p.tsq_simple))
       + similarity(d.name, p.raw)) desc,
    d.updated_at desc
  limit greatest(coalesce(lim, 20), 1);
$$;

grant execute on function public.search_documents_fts(uuid, text, int) to authenticated, service_role;

create or replace function public.search_chunks(ws uuid, query_embedding vector(384), lim int default 20)
returns table (
  chunk_id     uuid,
  document_id  uuid,
  version_id   uuid,
  chunk_number integer,
  page_number  integer,
  section      text,
  content      text,
  similarity   real
)
language sql
stable
set search_path = public, extensions
as $$
  select
    c.id,
    c.document_id,
    c.version_id,
    c.chunk_number,
    c.page_number,
    c.section,
    c.content,
    (1 - (c.embedding <=> query_embedding))::real as similarity
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.workspace_id = ws
    and (current_user = 'service_role' or public.is_workspace_member(ws))
    and c.embedding is not null
    and d.deleted_at is null
  order by c.embedding <=> query_embedding
  limit greatest(coalesce(lim, 20), 1);
$$;

grant execute on function public.search_chunks(uuid, vector, int) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. similar_documents_by_text(ws, sample, lim)
-- Trigram similarity between a text sample and the first 4000 characters of
-- the current version's text. Used by POST /documents/check-duplicates.
-- -----------------------------------------------------------------------------
create or replace function public.similar_documents_by_text(ws uuid, sample text, lim int default 10)
returns table (
  document_id uuid,
  similarity  real
)
language sql
stable
set search_path = public, extensions
as $$
  select
    d.id,
    similarity(left(v.ocr_text, 4000), left(coalesce(sample, ''), 2000))::real as similarity
  from public.documents d
  join public.document_versions v on v.id = d.current_version_id
  where d.workspace_id = ws
    and (current_user = 'service_role' or public.is_workspace_member(ws))
    and d.deleted_at is null
    and v.ocr_text is not null
    and length(coalesce(sample, '')) >= 20
  order by similarity(left(v.ocr_text, 4000), left(coalesce(sample, ''), 2000)) desc
  limit greatest(coalesce(lim, 10), 1);
$$;

grant execute on function public.similar_documents_by_text(uuid, text, int) to authenticated, service_role;
