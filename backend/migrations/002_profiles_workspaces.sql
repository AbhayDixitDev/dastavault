-- =============================================================================
-- DastaVault - 002_profiles_workspaces.sql
-- Profiles, workspaces, terminology, roles/permissions, members, invites.
-- Requires: 001_extensions.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text,
  display_name       text,
  avatar_key         text,                       -- R2 object key
  preferred_language text not null default 'en',
  large_text         boolean not null default false,
  settings           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

select public.ensure_updated_at_trigger('profiles');

-- Auto-create a profile whenever a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1)
    )
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- roles and permissions (global catalogue, rows so custom roles can come later)
-- -----------------------------------------------------------------------------
create table if not exists public.roles (
  key         text primary key,
  name        text not null,
  description text,
  rank        integer not null,                 -- higher = more powerful
  is_system   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.permissions (
  key         text primary key,
  description text,
  created_at  timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_key       text not null references public.roles(key) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_key, permission_key)
);

create index if not exists role_permissions_permission_key_idx
  on public.role_permissions (permission_key);

insert into public.roles (key, name, description, rank) values
  ('owner',      'Owner',      'Everything, including deleting the workspace and transferring ownership.', 100),
  ('admin',      'Admin',      'Manage members, groups, people, terminology, all documents, trash and settings.', 80),
  ('editor',     'Editor',     'Add, edit, version and link documents and notes; create albums.', 60),
  ('viewer',     'Viewer',     'View and search documents they are allowed to see.', 40),
  ('restricted', 'Restricted', 'Only documents explicitly shared with them or linked to their own person or groups.', 20)
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      rank = excluded.rank;

insert into public.permissions (key, description) values
  ('workspace.manage', 'Rename, delete, transfer the workspace'),
  ('members.manage',   'Invite, remove and change roles of members'),
  ('groups.manage',    'Create and edit groups and subgroups'),
  ('people.manage',    'Create and edit people and relationships'),
  ('documents.create', 'Upload, scan and write documents'),
  ('documents.read',   'View and search documents'),
  ('documents.update', 'Edit details, versions, tags and links of documents'),
  ('documents.delete', 'Move documents to trash and restore them'),
  ('documents.share',  'Share documents with members, groups or links'),
  ('notes.manage',     'Create and edit notes'),
  ('albums.manage',    'Create and edit albums'),
  ('activity.read',    'View the workspace activity log'),
  ('settings.manage',  'Change workspace settings, terminology and features')
on conflict (key) do update
  set description = excluded.description;

insert into public.role_permissions (role_key, permission_key)
select r.key, p.key
from public.roles r
cross join public.permissions p
where
  (r.key = 'owner')
  or (r.key = 'admin'  and p.key <> 'workspace.manage')
  or (r.key = 'editor' and p.key in ('documents.create','documents.read','documents.update',
                                     'documents.delete','documents.share','notes.manage',
                                     'albums.manage','activity.read'))
  or (r.key = 'viewer' and p.key in ('documents.read','activity.read'))
  or (r.key = 'restricted' and p.key in ('documents.read'))
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- workspaces
-- -----------------------------------------------------------------------------
create table if not exists public.workspaces (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  kind               text not null check (kind in ('family','company','school','organization','personal','custom')),
  icon               text,
  default_visibility text not null default 'workspace'
                     check (default_visibility in ('workspace','groups','people','private')),
  features           jsonb not null default '{"ai": true, "semantic_search": true, "face_grouping": false, "log_downloads": false}'::jsonb,
  ocr_languages      text[] not null default '{eng}',
  storage_bytes      bigint not null default 0,
  owner_id           uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_by         uuid default auth.uid() references auth.users(id) on delete set null,
  deleted_at         timestamptz,                  -- 30-day soft delete (WS-10)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists workspaces_owner_id_idx   on public.workspaces (owner_id);
create index if not exists workspaces_created_by_idx on public.workspaces (created_by);
create index if not exists workspaces_deleted_at_idx on public.workspaces (deleted_at) where deleted_at is not null;

select public.ensure_updated_at_trigger('workspaces');

-- -----------------------------------------------------------------------------
-- workspace_terminology (one row per workspace, every UI label comes from here)
-- -----------------------------------------------------------------------------
create table if not exists public.workspace_terminology (
  workspace_id          uuid primary key references public.workspaces(id) on delete cascade,
  workspace_label       text not null default 'Workspace',
  member_label          text not null default 'Member',
  member_label_plural   text not null default 'Members',
  group_label           text not null default 'Group',
  group_label_plural    text not null default 'Groups',
  subgroup_label        text not null default 'Subgroup',
  subgroup_label_plural text not null default 'Subgroups',
  person_label          text not null default 'Person',
  person_label_plural   text not null default 'People',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

select public.ensure_updated_at_trigger('workspace_terminology');

-- -----------------------------------------------------------------------------
-- workspace_members
-- -----------------------------------------------------------------------------
create table if not exists public.workspace_members (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role_key     text not null references public.roles(key) on delete restrict,
  invited_by   uuid references auth.users(id) on delete set null,
  joined_at    timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists workspace_members_user_id_idx    on public.workspace_members (user_id);
create index if not exists workspace_members_role_key_idx   on public.workspace_members (role_key);
create index if not exists workspace_members_invited_by_idx on public.workspace_members (invited_by);

select public.ensure_updated_at_trigger('workspace_members');

-- -----------------------------------------------------------------------------
-- workspace_invites
-- -----------------------------------------------------------------------------
create table if not exists public.workspace_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email        text not null,
  role_key     text not null references public.roles(key) on delete restrict,
  token        text not null unique default encode(gen_random_bytes(24), 'hex'),
  status       text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  message      text,
  invited_by   uuid references auth.users(id) on delete set null,
  expires_at   timestamptz not null default (now() + interval '7 days'),
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (role_key <> 'owner')
);

create index if not exists workspace_invites_workspace_id_idx on public.workspace_invites (workspace_id);
create index if not exists workspace_invites_email_idx        on public.workspace_invites (lower(email));
create index if not exists workspace_invites_invited_by_idx   on public.workspace_invites (invited_by);
create index if not exists workspace_invites_role_key_idx     on public.workspace_invites (role_key);
create unique index if not exists workspace_invites_pending_unique
  on public.workspace_invites (workspace_id, lower(email)) where status = 'pending';

select public.ensure_updated_at_trigger('workspace_invites');

-- -----------------------------------------------------------------------------
-- New workspace bootstrap: owner membership + terminology template
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role_key)
  values (new.id, new.owner_id, 'owner')
  on conflict (workspace_id, user_id) do update set role_key = 'owner';

  insert into public.workspace_terminology (
    workspace_id, workspace_label,
    member_label, member_label_plural,
    group_label, group_label_plural,
    subgroup_label, subgroup_label_plural,
    person_label, person_label_plural
  )
  select
    new.id,
    t.workspace_label, t.member_label, t.member_label_plural,
    t.group_label, t.group_label_plural,
    t.subgroup_label, t.subgroup_label_plural,
    t.person_label, t.person_label_plural
  from (values
    ('family',       'Family',        'Family Member', 'Family Members', 'Family Group', 'Family Groups', 'Subgroup',  'Subgroups',  'Person', 'People'),
    ('company',      'Company',       'Employee',      'Employees',      'Department',   'Departments',   'Team',      'Teams',      'Person', 'People'),
    ('school',       'School',        'Student',       'Students',       'Class',        'Classes',       'Section',   'Sections',   'Person', 'People'),
    ('organization', 'Organisation',  'Member',        'Members',        'Unit',         'Units',         'Team',      'Teams',      'Person', 'People'),
    ('personal',     'My Documents',  'Person',        'People',         'Folder',       'Folders',       'Subfolder', 'Subfolders', 'Person', 'People'),
    ('custom',       'Workspace',     'Member',        'Members',        'Group',        'Groups',        'Subgroup',  'Subgroups',  'Person', 'People')
  ) as t(kind, workspace_label, member_label, member_label_plural, group_label, group_label_plural,
         subgroup_label, subgroup_label_plural, person_label, person_label_plural)
  where t.kind = new.kind
  on conflict (workspace_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_workspace_created on public.workspaces;
create trigger on_workspace_created
  after insert on public.workspaces
  for each row execute function public.handle_new_workspace();

-- -----------------------------------------------------------------------------
-- accept_workspace_invite(token): invitee (by JWT email) joins the workspace.
-- Returns the workspace id. Raises on invalid / expired / wrong-email token.
-- -----------------------------------------------------------------------------
create or replace function public.accept_workspace_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.workspace_invites%rowtype;
  v_email  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_uid    uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into v_invite
  from public.workspace_invites
  where token = p_token
  for update;

  if not found or v_invite.status <> 'pending' then
    raise exception 'Invite not found or no longer valid' using errcode = 'P0002';
  end if;
  if v_invite.expires_at < now() then
    update public.workspace_invites set status = 'expired' where id = v_invite.id;
    raise exception 'Invite has expired' using errcode = 'P0002';
  end if;
  if lower(v_invite.email) <> v_email then
    raise exception 'This invite was sent to a different email address' using errcode = '42501';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role_key, invited_by)
  values (v_invite.workspace_id, v_uid, v_invite.role_key, v_invite.invited_by)
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invites
     set status = 'accepted', accepted_at = now(), accepted_by = v_uid
   where id = v_invite.id;

  return v_invite.workspace_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- transfer_workspace_ownership(ws, new_owner): owner only.
-- -----------------------------------------------------------------------------
create or replace function public.transfer_workspace_ownership(ws uuid, new_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if public.workspace_role(ws) is distinct from 'owner' then
    raise exception 'Only the workspace owner can transfer ownership' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workspace_members where workspace_id = ws and user_id = new_owner) then
    raise exception 'The new owner must already be a member of the workspace' using errcode = 'P0002';
  end if;

  update public.workspace_members set role_key = 'admin' where workspace_id = ws and user_id = v_uid;
  update public.workspace_members set role_key = 'owner' where workspace_id = ws and user_id = new_owner;
  update public.workspaces set owner_id = new_owner where id = ws;
end;
$$;

grant execute on function public.accept_workspace_invite(text)             to authenticated;
grant execute on function public.transfer_workspace_ownership(uuid, uuid)  to authenticated;
