-- =============================================================================
-- DastaVault - 008_notes.sql
-- Notes (Tiptap rich text saved as HTML + plain text) and links from notes to
-- people, groups, documents and albums.
-- Requires: 007_albums_reminders_activity.sql
-- =============================================================================

create table if not exists public.notes (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  title          text not null default '',
  content_html   text,                                       -- sanitised with DOMPurify before save
  content_text   text,                                       -- plain text for search
  color          text,
  tags           text[] not null default '{}',
  is_pinned      boolean not null default false,
  is_private     boolean not null default false,             -- NOTE-11: locked with the Chaabi PIN
  encrypted_blob text,                                       -- when is_private: AES-GCM ciphertext of {title, html, text}
  iv             text,                                       -- IV for encrypted_blob (base64)
  template       text,                                       -- 'blank','meeting','checklist','letter','agreement'
  search_text    tsvector,                                   -- trigger-maintained (array_to_string is not immutable)
  created_by     uuid references auth.users(id) on delete set null,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (not is_private or encrypted_blob is not null)
);

create index if not exists notes_workspace_id_idx  on public.notes (workspace_id, is_pinned desc, updated_at desc);
create index if not exists notes_created_by_idx    on public.notes (created_by);
create index if not exists notes_deleted_at_idx    on public.notes (deleted_at) where deleted_at is not null;
create index if not exists notes_search_text_gin   on public.notes using gin (search_text);
create index if not exists notes_title_trgm_gin    on public.notes using gin (title gin_trgm_ops);
create index if not exists notes_tags_gin          on public.notes using gin (tags);

select public.ensure_updated_at_trigger('notes');

-- Keyword search vector for notes (NOTE-4). Private notes carry no plain text.
create or replace function public.notes_search_text_trigger()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.search_text :=
       setweight(to_tsvector('simple',  coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('simple',  coalesce(array_to_string(new.tags, ' '), '')), 'B')
    || setweight(to_tsvector('english', coalesce(new.content_text, '')), 'C');
  return new;
end;
$$;

drop trigger if exists notes_search_text on public.notes;
create trigger notes_search_text
  before insert or update of title, tags, content_text on public.notes
  for each row execute function public.notes_search_text_trigger();

create table if not exists public.note_links (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  note_id      uuid not null references public.notes(id) on delete cascade,
  entity_type  text not null check (entity_type in ('person','group','document','album')),
  entity_id    uuid not null,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (note_id, entity_type, entity_id)
);

create index if not exists note_links_workspace_id_idx on public.note_links (workspace_id);
create index if not exists note_links_entity_idx       on public.note_links (entity_type, entity_id);
create index if not exists note_links_created_by_idx   on public.note_links (created_by);
