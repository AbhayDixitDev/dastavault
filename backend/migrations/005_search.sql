-- =============================================================================
-- DastaVault - 005_search.sql
-- Full-text search over documents (name, summary, OCR text, tags, people,
-- organisation, type), typo tolerance with pg_trgm, search_documents_fts().
-- Requires: 004_documents.sql
--
-- Note: a GENERATED tsvector column cannot reference other tables (tags,
-- people, versions), so documents.search_text is maintained by triggers.
-- =============================================================================

alter table public.documents add column if not exists search_text tsvector;

-- -----------------------------------------------------------------------------
-- Build the tsvector for one document from its own columns + related rows.
-- Weights: A = name, document number, people; B = type, organisation, tags;
--          C = summary; D = OCR text of the current version.
-- Names/numbers/tags are indexed with the 'simple' config (no stemming, keeps
-- proper nouns intact) and free text with 'english'.
-- -----------------------------------------------------------------------------
create or replace function public.build_document_search_text(
  p_document_id        uuid,
  p_name               text,
  p_summary            text,
  p_organisation       text,
  p_document_type      text,
  p_document_number    text,
  p_current_version_id uuid
)
returns tsvector
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
      setweight(to_tsvector('simple',  coalesce(p_name, '')), 'A')
   || setweight(to_tsvector('english', coalesce(p_name, '')), 'A')
   || setweight(to_tsvector('simple',  coalesce(p_document_number, '')), 'A')
   || setweight(to_tsvector('simple', coalesce((
        select string_agg(
                 concat_ws(' ', p.display_name, p.first_name, p.last_name, p.relation_label), ' ')
        from public.document_people dp
        join public.people p on p.id = dp.person_id
        where dp.document_id = p_document_id
      ), '')), 'A')
   || setweight(to_tsvector('simple',  coalesce(p_document_type, '')), 'B')
   || setweight(to_tsvector('english', coalesce(p_document_type, '')), 'B')
   || setweight(to_tsvector('simple',  coalesce(p_organisation, '')), 'B')
   || setweight(to_tsvector('english', coalesce(p_organisation, '')), 'B')
   || setweight(to_tsvector('simple', coalesce((
        select string_agg(t.name, ' ')
        from public.document_tags dt
        join public.tags t on t.id = dt.tag_id
        where dt.document_id = p_document_id
      ), '')), 'B')
   || setweight(to_tsvector('english', coalesce(p_summary, '')), 'C')
   || setweight(to_tsvector('english', left(coalesce((
        select v.ocr_text
        from public.document_versions v
        where v.id = p_current_version_id
      ), ''), 200000)), 'D');
$$;

-- Recompute search_text for one document (used by triggers on related tables).
-- Note: this update also bumps documents.updated_at via set_updated_at.
create or replace function public.refresh_document_search_text(p_document_id uuid)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  update public.documents d
     set search_text = public.build_document_search_text(
           d.id, d.name, d.summary, d.organisation, d.document_type, d.document_number, d.current_version_id)
   where d.id = p_document_id;
$$;

-- documents: compute on insert and on change of any contributing column.
create or replace function public.documents_search_text_trigger()
returns trigger
language plpgsql
as $$
begin
  new.search_text := public.build_document_search_text(
    new.id, new.name, new.summary, new.organisation, new.document_type, new.document_number, new.current_version_id);
  return new;
end;
$$;

drop trigger if exists documents_search_text on public.documents;
create trigger documents_search_text
  before insert or update of name, summary, organisation, document_type, document_number, current_version_id
  on public.documents
  for each row execute function public.documents_search_text_trigger();

-- document_tags / document_people: link added or removed.
create or replace function public.document_link_search_refresh_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_document_search_text(old.document_id);
  else
    perform public.refresh_document_search_text(new.document_id);
    if tg_op = 'UPDATE' and new.document_id is distinct from old.document_id then
      perform public.refresh_document_search_text(old.document_id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists document_tags_search_refresh on public.document_tags;
create trigger document_tags_search_refresh
  after insert or update or delete on public.document_tags
  for each row execute function public.document_link_search_refresh_trigger();

drop trigger if exists document_people_search_refresh on public.document_people;
create trigger document_people_search_refresh
  after insert or update or delete on public.document_people
  for each row execute function public.document_link_search_refresh_trigger();

-- tags: renamed -> refresh every document carrying the tag.
create or replace function public.tags_search_refresh_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_document_search_text(dt.document_id)
  from public.document_tags dt
  where dt.tag_id = new.id;
  return null;
end;
$$;

drop trigger if exists tags_search_refresh on public.tags;
create trigger tags_search_refresh
  after update of name on public.tags
  for each row execute function public.tags_search_refresh_trigger();

-- people: renamed -> refresh every linked document.
create or replace function public.people_search_refresh_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_document_search_text(dp.document_id)
  from public.document_people dp
  where dp.person_id = new.id;
  return null;
end;
$$;

drop trigger if exists people_search_refresh on public.people;
create trigger people_search_refresh
  after update of display_name, first_name, last_name, relation_label on public.people
  for each row execute function public.people_search_refresh_trigger();

-- document_versions: OCR text changed on the current version -> refresh.
create or replace function public.document_versions_search_refresh_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_document_search_text(d.id)
  from public.documents d
  where d.id = new.document_id
    and d.current_version_id = new.id;
  return null;
end;
$$;

drop trigger if exists document_versions_search_refresh on public.document_versions;
create trigger document_versions_search_refresh
  after update of ocr_text on public.document_versions
  for each row execute function public.document_versions_search_refresh_trigger();

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
create index if not exists documents_search_text_gin
  on public.documents using gin (search_text);

create index if not exists documents_name_trgm_gin
  on public.documents using gin (name gin_trgm_ops);

create index if not exists documents_organisation_trgm_gin
  on public.documents using gin (organisation gin_trgm_ops);

create index if not exists people_display_name_trgm_gin
  on public.people using gin (display_name gin_trgm_ops);

create index if not exists tags_name_trgm_gin
  on public.tags using gin (name gin_trgm_ops);

-- Backfill for rows created before this migration.
update public.documents d
   set search_text = public.build_document_search_text(
         d.id, d.name, d.summary, d.organisation, d.document_type, d.document_number, d.current_version_id)
 where d.search_text is null;

-- -----------------------------------------------------------------------------
-- search_documents_fts(ws, q, lim)
--
-- Ranked keyword search restricted to workspace `ws` AND to callers who are
-- members of it (is_workspace_member). The function is SECURITY INVOKER, so
-- when called by an authenticated user through PostgREST the documents RLS
-- policies (document-level visibility) also apply inside the query. The
-- Worker may call it with the service role after its own permission checks.
--
-- Matching: websearch syntax ("dad passport", "aws -invoice", quoted phrases)
-- against search_text with both 'english' and 'simple' configs, plus trigram
-- similarity on the name for typos ("pasport").
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
    and public.is_workspace_member(ws)
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
