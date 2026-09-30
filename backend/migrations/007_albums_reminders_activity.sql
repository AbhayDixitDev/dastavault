-- =============================================================================
-- DastaVault - 007_albums_reminders_activity.sql
-- Albums (manual + smart), reminders, activity log, shares, saved searches,
-- notifications.
-- Requires: 004_documents.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- albums
-- -----------------------------------------------------------------------------
create table if not exists public.albums (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  name              text not null,
  description       text,
  kind              text not null default 'manual' check (kind in ('manual','person','type','group','event','smart')),
  person_id         uuid references public.people(id) on delete cascade,      -- for kind = 'person'
  group_id          uuid references public.groups(id) on delete cascade,      -- for kind = 'group'
  document_type     text,                                                     -- for kind = 'type'
  event_date        date,                                                     -- for kind = 'event'
  cover_document_id uuid references public.documents(id) on delete set null,
  sort_by           text not null default 'added_desc'
                    check (sort_by in ('added_desc','added_asc','name_asc','name_desc','date_desc','date_asc','manual')),
  is_shared         boolean not null default false,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists albums_workspace_id_idx      on public.albums (workspace_id);
create index if not exists albums_person_id_idx         on public.albums (person_id);
create index if not exists albums_group_id_idx          on public.albums (group_id);
create index if not exists albums_cover_document_id_idx on public.albums (cover_document_id);
create index if not exists albums_created_by_idx        on public.albums (created_by);

select public.ensure_updated_at_trigger('albums');

create table if not exists public.album_items (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  album_id     uuid not null references public.albums(id) on delete cascade,
  document_id  uuid not null references public.documents(id) on delete cascade,
  position     integer not null default 0,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (album_id, document_id)
);

create index if not exists album_items_workspace_id_idx on public.album_items (workspace_id);
create index if not exists album_items_document_id_idx  on public.album_items (document_id);
create index if not exists album_items_created_by_idx   on public.album_items (created_by);

select public.ensure_updated_at_trigger('album_items');

-- Smart album rules: field <operator> value, combined with AND/OR in order.
-- e.g. (person_id = <uuid>) AND (document_type = 'Medical Report')
create table if not exists public.smart_album_rules (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  album_id     uuid not null references public.albums(id) on delete cascade,
  field        text not null check (field in (
                 'person_id','group_id','document_type','tag_id','organisation',
                 'issue_date','expiry_date','created_at','created_by','name','status','is_favorite')),
  operator     text not null check (operator in (
                 'eq','neq','contains','not_contains','in','not_in','gt','gte','lt','lte','between','is_null','not_null')),
  value        jsonb not null default 'null'::jsonb,
  conjunction  text not null default 'and' check (conjunction in ('and','or')),
  position     integer not null default 0,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists smart_album_rules_workspace_id_idx on public.smart_album_rules (workspace_id);
create index if not exists smart_album_rules_album_id_idx     on public.smart_album_rules (album_id, position);
create index if not exists smart_album_rules_created_by_idx   on public.smart_album_rules (created_by);

select public.ensure_updated_at_trigger('smart_album_rules');

-- -----------------------------------------------------------------------------
-- reminders (REM-1: on any date field; 30/7/1 day defaults => one row each)
-- -----------------------------------------------------------------------------
create table if not exists public.reminders (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id  uuid references public.documents(id) on delete cascade,
  person_id    uuid references public.people(id) on delete cascade,
  title        text not null,
  field_name   text,                                         -- 'expiry_date', 'issue_date', custom field key ...
  due_date     date not null,
  days_before  integer not null default 0 check (days_before >= 0),
  remind_at    timestamptz not null,                         -- when to notify (due_date - days_before, at local time)
  channels     text[] not null default '{in_app,email}',
  status       text not null default 'scheduled' check (status in ('scheduled','sent','dismissed','cancelled')),
  sent_at      timestamptz,
  user_id      uuid references auth.users(id) on delete cascade,  -- null = notify all members with access
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (document_id is not null or person_id is not null)
);

create index if not exists reminders_workspace_id_idx on public.reminders (workspace_id);
create index if not exists reminders_document_id_idx  on public.reminders (document_id);
create index if not exists reminders_person_id_idx    on public.reminders (person_id);
create index if not exists reminders_user_id_idx      on public.reminders (user_id);
create index if not exists reminders_created_by_idx   on public.reminders (created_by);
create index if not exists reminders_due_idx          on public.reminders (status, remind_at);
create unique index if not exists reminders_unique_offset
  on public.reminders (document_id, coalesce(field_name, ''), days_before) where document_id is not null;

select public.ensure_updated_at_trigger('reminders');

-- -----------------------------------------------------------------------------
-- activity_logs (append-only timeline; message is a plain sentence, TL-1)
-- -----------------------------------------------------------------------------
create table if not exists public.activity_logs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id     uuid references auth.users(id) on delete set null,
  entity_type  text not null,                                -- 'document','person','group','workspace','note','album','share','member'
  entity_id    uuid,
  action       text not null,                                -- 'created','uploaded','renamed','details_edited','version_uploaded',
                                                             -- 'tag_added','person_linked','group_linked','shared','downloaded',
                                                             -- 'archived','deleted','restored', ...
  message      text not null,                                -- "Rahul uploaded this document."
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists activity_logs_workspace_id_idx on public.activity_logs (workspace_id, created_at desc);
create index if not exists activity_logs_actor_id_idx     on public.activity_logs (actor_id);
create index if not exists activity_logs_entity_idx       on public.activity_logs (entity_type, entity_id, created_at desc);
create index if not exists activity_logs_action_idx       on public.activity_logs (workspace_id, action);

-- -----------------------------------------------------------------------------
-- shares (member, group or expiring link; documents or albums)
-- -----------------------------------------------------------------------------
create table if not exists public.shares (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  document_id         uuid references public.documents(id) on delete cascade,
  album_id            uuid references public.albums(id) on delete cascade,
  kind                text not null check (kind in ('member','group','link')),
  shared_with_user_id uuid references auth.users(id) on delete cascade,
  shared_with_group_id uuid references public.groups(id) on delete cascade,
  token               text unique,                            -- for kind = 'link' (served by the Worker at /s/:token)
  password_hash       text,                                   -- optional link password (bcrypt/argon in Worker)
  allow_download      boolean not null default false,
  expires_at          timestamptz,
  revoked_at          timestamptz,
  view_count          integer not null default 0,
  last_viewed_at      timestamptz,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((document_id is not null)::int + (album_id is not null)::int = 1),
  check (kind <> 'member' or shared_with_user_id is not null),
  check (kind <> 'group'  or shared_with_group_id is not null),
  check (kind <> 'link'   or token is not null)
);

create index if not exists shares_workspace_id_idx         on public.shares (workspace_id);
create index if not exists shares_document_id_idx          on public.shares (document_id);
create index if not exists shares_album_id_idx             on public.shares (album_id);
create index if not exists shares_shared_with_user_id_idx  on public.shares (shared_with_user_id);
create index if not exists shares_shared_with_group_id_idx on public.shares (shared_with_group_id);
create index if not exists shares_created_by_idx           on public.shares (created_by);

select public.ensure_updated_at_trigger('shares');

-- -----------------------------------------------------------------------------
-- saved_searches (saved and recent searches, per user per workspace)
-- -----------------------------------------------------------------------------
create table if not exists public.saved_searches (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null default 'saved' check (kind in ('saved','recent')),
  name         text,
  query        text not null,
  filters      jsonb not null default '{}'::jsonb,
  use_count    integer not null default 1,
  last_used_at timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists saved_searches_workspace_id_idx on public.saved_searches (workspace_id);
create index if not exists saved_searches_user_id_idx      on public.saved_searches (user_id, workspace_id, kind, last_used_at desc);
create index if not exists saved_searches_created_by_idx   on public.saved_searches (created_by);

select public.ensure_updated_at_trigger('saved_searches');

-- -----------------------------------------------------------------------------
-- notifications (ADM-4: reminders, shares, invites, upload results)
-- workspace_id is nullable: account-level notifications (e.g. Chaabi PIN reset)
-- have no workspace.
-- -----------------------------------------------------------------------------
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  type         text not null,                                -- 'reminder','share','invite','upload','system'
  title        text not null,
  body         text,
  data         jsonb not null default '{}'::jsonb,           -- e.g. {document_id, share_id, invite_id, url}
  read_at      timestamptz,
  email_sent_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists notifications_workspace_id_idx on public.notifications (workspace_id);
create index if not exists notifications_user_id_idx      on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx       on public.notifications (user_id) where read_at is null;

select public.ensure_updated_at_trigger('notifications');
