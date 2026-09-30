-- =============================================================================
-- DastaVault - 003_people_groups.sql
-- Groups (with subgroups), people, relationships and person <-> group links.
-- Requires: 002_profiles_workspaces.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- groups (departments/teams, classes/sections, family groups, folders ...)
-- -----------------------------------------------------------------------------
create table if not exists public.groups (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  parent_group_id uuid references public.groups(id) on delete set null,
  name            text not null,
  description     text,
  icon            text,
  color           text,
  position        integer not null default 0,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (parent_group_id is distinct from id)
);

create index if not exists groups_workspace_id_idx    on public.groups (workspace_id);
create index if not exists groups_parent_group_id_idx on public.groups (parent_group_id);
create index if not exists groups_created_by_idx      on public.groups (created_by);
-- Unique name among siblings (top-level groups share the all-zero sentinel).
create unique index if not exists groups_unique_name_per_parent
  on public.groups (workspace_id, coalesce(parent_group_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

select public.ensure_updated_at_trigger('groups');

-- -----------------------------------------------------------------------------
-- people (someone documents belong to; may or may not have a login)
-- -----------------------------------------------------------------------------
create table if not exists public.people (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  display_name   text not null,
  first_name     text,
  last_name      text,
  relation_label text,                          -- free label shown in UI, e.g. "Dad", "Class Teacher"
  email          text,
  phone          text,
  date_of_birth  date,
  avatar_key     text,                          -- R2 object key
  user_id        uuid references auth.users(id) on delete set null,  -- linked login (member), nullable
  notes          text,
  custom         jsonb not null default '{}'::jsonb,
  created_by     uuid references auth.users(id) on delete set null,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists people_workspace_id_idx on public.people (workspace_id);
create index if not exists people_user_id_idx      on public.people (user_id);
create index if not exists people_created_by_idx   on public.people (created_by);
create index if not exists people_deleted_at_idx   on public.people (deleted_at) where deleted_at is not null;
create index if not exists people_ws_display_name_idx on public.people (workspace_id, lower(display_name));
-- One person row per linked member in a workspace.
create unique index if not exists people_workspace_user_unique
  on public.people (workspace_id, user_id) where user_id is not null;

select public.ensure_updated_at_trigger('people');

-- -----------------------------------------------------------------------------
-- person_relationships (directional: from_person IS <relation> OF to_person)
-- e.g. from = Rajesh, to = Nikhil, relation = 'father'  => "Rajesh is the Father of Nikhil"
-- -----------------------------------------------------------------------------
create table if not exists public.person_relationships (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  from_person_id uuid not null references public.people(id) on delete cascade,
  to_person_id   uuid not null references public.people(id) on delete cascade,
  relation       text not null check (relation in (
                   'father','mother','parent','child','son','daughter','spouse',
                   'brother','sister','grandparent','grandchild','guardian',
                   'manager','reports_to','custom')),
  custom_label   text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (from_person_id, to_person_id, relation),
  check (from_person_id <> to_person_id),
  check (relation <> 'custom' or custom_label is not null)
);

create index if not exists person_relationships_workspace_id_idx   on public.person_relationships (workspace_id);
create index if not exists person_relationships_from_person_id_idx on public.person_relationships (from_person_id);
create index if not exists person_relationships_to_person_id_idx   on public.person_relationships (to_person_id);
create index if not exists person_relationships_created_by_idx     on public.person_relationships (created_by);

select public.ensure_updated_at_trigger('person_relationships');

-- -----------------------------------------------------------------------------
-- person_groups (membership of a person in a group)
-- -----------------------------------------------------------------------------
create table if not exists public.person_groups (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  person_id     uuid not null references public.people(id) on delete cascade,
  group_id      uuid not null references public.groups(id) on delete cascade,
  role_in_group text,                           -- e.g. "Head", "Class Teacher"
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (person_id, group_id)
);

create index if not exists person_groups_workspace_id_idx on public.person_groups (workspace_id);
create index if not exists person_groups_group_id_idx     on public.person_groups (group_id);
create index if not exists person_groups_created_by_idx   on public.person_groups (created_by);

select public.ensure_updated_at_trigger('person_groups');
