-- =============================================================================
-- DastaVault - 010_rls.sql
-- Row Level Security on every table.
-- Requires: 001 .. 009
--
-- Model
--   * Policies are written for the `authenticated` role (Supabase JWT users).
--     `anon` gets nothing. The Worker uses the service role (bypasses RLS)
--     only after its own JWT + membership + role checks (PRD 9.3).
--   * Membership/role checks go through the SECURITY DEFINER helpers from 001
--     (is_workspace_member / workspace_role / is_workspace_admin /
--     is_workspace_editor) so policies never recurse into each other.
--   * Document-level visibility (workspace / groups / people / private,
--     restricted role, explicit shares) is centralised in can_read_document()
--     and can_edit_document() below and reused by every document-bound table.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: does the current user share at least one workspace with `other`?
-- -----------------------------------------------------------------------------
create or replace function public.shares_workspace_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members a
    join public.workspace_members b on b.workspace_id = a.workspace_id
    where a.user_id = auth.uid()
      and b.user_id = other
  );
$$;

-- -----------------------------------------------------------------------------
-- Helper: can the current user read document `doc_id`?
--   owner/admin ..................... everything in the workspace
--   creator ......................... own documents (incl. private)
--   visibility = 'workspace' ........ any member except 'restricted'
--   visibility = 'groups'/'people' .. members whose linked person is linked to
--                                     the document, or belongs to a linked group
--   restricted role ................. same as groups/people, any visibility
--   explicit share .................. shared with the user or one of their groups
-- Soft-deleted (trashed) documents stay visible to whoever could read them.
-- -----------------------------------------------------------------------------
create or replace function public.can_read_document(doc_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_doc  record;
  v_role text;
begin
  if v_uid is null or doc_id is null then
    return false;
  end if;

  select d.id, d.workspace_id, d.visibility, d.created_by
    into v_doc
  from public.documents d
  where d.id = doc_id;

  if not found then
    return false;
  end if;

  v_role := public.workspace_role(v_doc.workspace_id);
  if v_role is null then
    return false;
  end if;

  if v_doc.created_by = v_uid then
    return true;
  end if;
  if v_role in ('owner', 'admin') then
    return true;
  end if;
  if v_doc.visibility = 'private' then
    return false;
  end if;
  if v_doc.visibility = 'workspace' and v_role <> 'restricted' then
    return true;
  end if;

  -- linked to the member's own person
  if exists (
    select 1
    from public.document_people dp
    join public.people p on p.id = dp.person_id
    where dp.document_id = v_doc.id
      and p.user_id = v_uid
  ) then
    return true;
  end if;

  -- linked to a group that contains the member's person
  if exists (
    select 1
    from public.document_groups dg
    join public.person_groups pg on pg.group_id = dg.group_id
    join public.people p on p.id = pg.person_id
    where dg.document_id = v_doc.id
      and p.user_id = v_uid
  ) then
    return true;
  end if;

  -- explicitly shared with the member or one of their groups
  if exists (
    select 1
    from public.shares s
    where s.document_id = v_doc.id
      and s.revoked_at is null
      and (s.expires_at is null or s.expires_at > now())
      and (
        s.shared_with_user_id = v_uid
        or s.shared_with_group_id in (
          select pg.group_id
          from public.person_groups pg
          join public.people p on p.id = pg.person_id
          where p.user_id = v_uid
        )
      )
  ) then
    return true;
  end if;

  return false;
end;
$$;

-- -----------------------------------------------------------------------------
-- Helper: can the current user edit document `doc_id`?
--   owner/admin: always. editor: any document they can read. others: no.
-- -----------------------------------------------------------------------------
create or replace function public.can_edit_document(doc_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ws   uuid;
  v_role text;
begin
  if auth.uid() is null or doc_id is null then
    return false;
  end if;
  select d.workspace_id into v_ws from public.documents d where d.id = doc_id;
  if not found then
    return false;
  end if;
  v_role := public.workspace_role(v_ws);
  if v_role in ('owner', 'admin') then
    return true;
  end if;
  if v_role = 'editor' then
    return public.can_read_document(doc_id);
  end if;
  return false;
end;
$$;

grant execute on function public.shares_workspace_with(uuid) to authenticated, service_role;
grant execute on function public.can_read_document(uuid)     to authenticated, service_role;
grant execute on function public.can_edit_document(uuid)     to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Policy generator for the common shapes (idempotent: drop + create).
--   dv_apply_policies(table, read_expr, write_expr)
-- creates <table>_select / _insert / _update / _delete for `authenticated`.
-- -----------------------------------------------------------------------------
create or replace function public.dv_apply_policies(p_table text, p_read text, p_write text)
returns void
language plpgsql
as $$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_select', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_insert', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_update', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_delete', p_table);
  execute format('create policy %I on public.%I for select to authenticated using (%s)',
                 p_table || '_select', p_table, p_read);
  execute format('create policy %I on public.%I for insert to authenticated with check (%s)',
                 p_table || '_insert', p_table, p_write);
  execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
                 p_table || '_update', p_table, p_write, p_write);
  execute format('create policy %I on public.%I for delete to authenticated using (%s)',
                 p_table || '_delete', p_table, p_write);
end;
$$;

-- Small helper to drop + create one policy.
create or replace function public.dv_policy(p_name text, p_table text, p_cmd text, p_using text, p_check text default null)
returns void
language plpgsql
as $$
begin
  execute format('drop policy if exists %I on public.%I', p_name, p_table);
  if p_cmd = 'insert' then
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)',
                   p_name, p_table, coalesce(p_check, p_using));
  elsif p_cmd = 'update' then
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
                   p_name, p_table, p_using, coalesce(p_check, p_using));
  else
    execute format('create policy %I on public.%I for %s to authenticated using (%s)',
                   p_name, p_table, p_cmd, p_using);
  end if;
end;
$$;

-- =============================================================================
-- 1. Enable RLS everywhere (explicit list = every table from 002..009)
-- =============================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles','roles','permissions','role_permissions','workspaces','workspace_terminology',
    'workspace_members','workspace_invites',
    'groups','people','person_relationships','person_groups',
    'documents','document_versions','document_files','document_pages','document_metadata',
    'document_metadata_suggestions','tags','document_tags','document_people','document_groups',
    'upload_sessions','custom_field_definitions','custom_field_values',
    'document_chunks',
    'albums','album_items','smart_album_rules','reminders','activity_logs','shares',
    'saved_searches','notifications',
    'notes','note_links',
    'vaults','vault_items','vault_item_history','vault_otp_codes','vault_activity_logs','ai_provider_keys'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- =============================================================================
-- 2. profiles
-- =============================================================================
select public.dv_policy('profiles_select', 'profiles', 'select',
  'id = auth.uid() or public.shares_workspace_with(id)');
select public.dv_policy('profiles_insert', 'profiles', 'insert', 'id = auth.uid()');
select public.dv_policy('profiles_update', 'profiles', 'update', 'id = auth.uid()');
select public.dv_policy('profiles_delete', 'profiles', 'delete', 'id = auth.uid()');

-- =============================================================================
-- 3. roles / permissions / role_permissions: read-only catalogue
-- =============================================================================
select public.dv_policy('roles_select',            'roles',            'select', 'true');
select public.dv_policy('permissions_select',      'permissions',      'select', 'true');
select public.dv_policy('role_permissions_select', 'role_permissions', 'select', 'true');

-- =============================================================================
-- 4. workspaces
-- =============================================================================
select public.dv_policy('workspaces_select', 'workspaces', 'select',
  'public.is_workspace_member(id) or owner_id = auth.uid()');
select public.dv_policy('workspaces_insert', 'workspaces', 'insert',
  'owner_id = auth.uid()');
select public.dv_policy('workspaces_update', 'workspaces', 'update',
  'public.is_workspace_admin(id)',
  'public.is_workspace_admin(id) and (owner_id = (select w.owner_id from public.workspaces w where w.id = workspaces.id) or public.workspace_role(id) = ''owner'')');
select public.dv_policy('workspaces_delete', 'workspaces', 'delete',
  'public.workspace_role(id) = ''owner''');

-- workspace_terminology: members read, owner/admin write
select public.dv_apply_policies('workspace_terminology',
  'public.is_workspace_member(workspace_id)',
  'public.is_workspace_admin(workspace_id)');

-- =============================================================================
-- 5. workspace_members
-- =============================================================================
select public.dv_policy('workspace_members_select', 'workspace_members', 'select',
  'public.is_workspace_member(workspace_id)');
-- Admins add members (never as owner). Owner rows come from the workspace
-- trigger / transfer_workspace_ownership(); invitees join via accept_workspace_invite().
select public.dv_policy('workspace_members_insert', 'workspace_members', 'insert',
  'public.is_workspace_admin(workspace_id) and role_key <> ''owner''');
select public.dv_policy('workspace_members_update', 'workspace_members', 'update',
  'public.workspace_role(workspace_id) = ''owner'' or (public.workspace_role(workspace_id) = ''admin'' and role_key <> ''owner'')',
  'public.workspace_role(workspace_id) = ''owner'' or (public.workspace_role(workspace_id) = ''admin'' and role_key <> ''owner'')');
-- Admins remove non-owners; anyone can leave unless they are the owner.
select public.dv_policy('workspace_members_delete', 'workspace_members', 'delete',
  '(public.is_workspace_admin(workspace_id) and role_key <> ''owner'') or (user_id = auth.uid() and role_key <> ''owner'')');

-- =============================================================================
-- 6. workspace_invites: admins, or the invitee (by JWT email)
-- =============================================================================
select public.dv_policy('workspace_invites_select', 'workspace_invites', 'select',
  'public.is_workspace_admin(workspace_id) or lower(email) = lower(coalesce(auth.jwt() ->> ''email'', ''''))');
select public.dv_policy('workspace_invites_insert', 'workspace_invites', 'insert',
  'public.is_workspace_admin(workspace_id)');
select public.dv_policy('workspace_invites_update', 'workspace_invites', 'update',
  'public.is_workspace_admin(workspace_id)');
select public.dv_policy('workspace_invites_delete', 'workspace_invites', 'delete',
  'public.is_workspace_admin(workspace_id)');

-- =============================================================================
-- 7. People and groups: members read, owner/admin write (people.manage,
--    groups.manage are admin permissions)
-- =============================================================================
select public.dv_apply_policies('groups',
  'public.is_workspace_member(workspace_id)', 'public.is_workspace_admin(workspace_id)');
select public.dv_apply_policies('people',
  'public.is_workspace_member(workspace_id)', 'public.is_workspace_admin(workspace_id)');
select public.dv_apply_policies('person_relationships',
  'public.is_workspace_member(workspace_id)', 'public.is_workspace_admin(workspace_id)');
select public.dv_apply_policies('person_groups',
  'public.is_workspace_member(workspace_id)', 'public.is_workspace_admin(workspace_id)');
select public.dv_apply_policies('custom_field_definitions',
  'public.is_workspace_member(workspace_id)', 'public.is_workspace_admin(workspace_id)');

-- =============================================================================
-- 8. documents
-- =============================================================================
select public.dv_policy('documents_select', 'documents', 'select',
  'public.can_read_document(id)');
select public.dv_policy('documents_insert', 'documents', 'insert',
  'public.is_workspace_editor(workspace_id) and (created_by is null or created_by = auth.uid())');
select public.dv_policy('documents_update', 'documents', 'update',
  'public.can_edit_document(id)',
  'public.is_workspace_editor(workspace_id)');
-- Hard delete (purge): owner/admin, or an editor purging their own trashed document.
select public.dv_policy('documents_delete', 'documents', 'delete',
  'public.is_workspace_admin(workspace_id) or (public.is_workspace_editor(workspace_id) and created_by = auth.uid())');

-- Document-bound tables: read if the document is readable, write if editable.
select public.dv_apply_policies('document_versions',
  'public.can_read_document(document_id)', 'public.can_edit_document(document_id)');
select public.dv_apply_policies('document_files',
  'public.can_read_document(document_id)', 'public.can_edit_document(document_id)');
select public.dv_apply_policies('document_pages',
  'public.can_read_document(document_id)', 'public.can_edit_document(document_id)');
select public.dv_apply_policies('document_metadata',
  'public.can_read_document(document_id)', 'public.can_edit_document(document_id)');
select public.dv_apply_policies('document_metadata_suggestions',
  'public.can_read_document(document_id)', 'public.can_edit_document(document_id)');
select public.dv_apply_policies('document_tags',
  'public.can_read_document(document_id)', 'public.can_edit_document(document_id)');
select public.dv_apply_policies('document_people',
  'public.can_read_document(document_id)', 'public.can_edit_document(document_id)');
select public.dv_apply_policies('document_groups',
  'public.can_read_document(document_id)', 'public.can_edit_document(document_id)');
select public.dv_apply_policies('document_chunks',
  'public.can_read_document(document_id)', 'public.can_edit_document(document_id)');

-- tags: members read, editors write
select public.dv_apply_policies('tags',
  'public.is_workspace_member(workspace_id)', 'public.is_workspace_editor(workspace_id)');

-- custom_field_values: attached to a document or a person
select public.dv_apply_policies('custom_field_values',
  'public.is_workspace_member(workspace_id) and (document_id is null or public.can_read_document(document_id))',
  'public.is_workspace_editor(workspace_id) and (document_id is null or public.can_edit_document(document_id))');

-- upload_sessions: own sessions (editors), admins see all
select public.dv_policy('upload_sessions_select', 'upload_sessions', 'select',
  'public.is_workspace_admin(workspace_id) or (public.is_workspace_editor(workspace_id) and created_by = auth.uid())');
select public.dv_policy('upload_sessions_insert', 'upload_sessions', 'insert',
  'public.is_workspace_editor(workspace_id) and created_by = auth.uid()');
select public.dv_policy('upload_sessions_update', 'upload_sessions', 'update',
  'public.is_workspace_admin(workspace_id) or (public.is_workspace_editor(workspace_id) and created_by = auth.uid())');
select public.dv_policy('upload_sessions_delete', 'upload_sessions', 'delete',
  'public.is_workspace_admin(workspace_id) or (public.is_workspace_editor(workspace_id) and created_by = auth.uid())');

-- =============================================================================
-- 9. Albums, reminders, activity, shares, saved searches, notifications
-- =============================================================================
select public.dv_apply_policies('albums',
  'public.is_workspace_member(workspace_id)', 'public.is_workspace_editor(workspace_id)');
select public.dv_apply_policies('smart_album_rules',
  'public.is_workspace_member(workspace_id)', 'public.is_workspace_editor(workspace_id)');
select public.dv_apply_policies('album_items',
  'public.is_workspace_member(workspace_id) and public.can_read_document(document_id)',
  'public.is_workspace_editor(workspace_id) and public.can_read_document(document_id)');

select public.dv_apply_policies('reminders',
  'public.is_workspace_member(workspace_id) and (document_id is null or public.can_read_document(document_id))',
  'public.is_workspace_editor(workspace_id) and (document_id is null or public.can_read_document(document_id))');

-- activity_logs: append-only. Readable by members with activity.read
-- (everyone except restricted); users can only log as themselves.
select public.dv_policy('activity_logs_select', 'activity_logs', 'select',
  'public.is_workspace_member(workspace_id) and public.workspace_role(workspace_id) <> ''restricted''');
select public.dv_policy('activity_logs_insert', 'activity_logs', 'insert',
  'public.is_workspace_member(workspace_id) and actor_id = auth.uid()');

-- shares: visible to admins, the creator and the recipient; editors create
-- shares for documents they can read; creator/admin manage them. Public link
-- resolution (/s/:token) happens in the Worker with the service role.
select public.dv_policy('shares_select', 'shares', 'select',
  'public.is_workspace_member(workspace_id) and (public.is_workspace_admin(workspace_id) or created_by = auth.uid() or shared_with_user_id = auth.uid())');
select public.dv_policy('shares_insert', 'shares', 'insert',
  'public.is_workspace_editor(workspace_id) and created_by = auth.uid() and (document_id is null or public.can_read_document(document_id))');
select public.dv_policy('shares_update', 'shares', 'update',
  'public.is_workspace_admin(workspace_id) or created_by = auth.uid()');
select public.dv_policy('shares_delete', 'shares', 'delete',
  'public.is_workspace_admin(workspace_id) or created_by = auth.uid()');

-- saved_searches: strictly per user
select public.dv_apply_policies('saved_searches',
  'user_id = auth.uid() and public.is_workspace_member(workspace_id)',
  'user_id = auth.uid() and public.is_workspace_member(workspace_id)');

-- notifications: strictly per user (the Worker creates notifications for others)
select public.dv_apply_policies('notifications',
  'user_id = auth.uid()',
  'user_id = auth.uid()');

-- =============================================================================
-- 10. notes and note_links
-- =============================================================================
select public.dv_policy('notes_select', 'notes', 'select',
  'public.is_workspace_member(workspace_id) and (not is_private or created_by = auth.uid())');
select public.dv_policy('notes_insert', 'notes', 'insert',
  'public.is_workspace_editor(workspace_id) and created_by = auth.uid()');
select public.dv_policy('notes_update', 'notes', 'update',
  'public.is_workspace_editor(workspace_id) and (created_by = auth.uid() or (public.is_workspace_admin(workspace_id) and not is_private))',
  'public.is_workspace_editor(workspace_id)');
select public.dv_policy('notes_delete', 'notes', 'delete',
  'public.is_workspace_editor(workspace_id) and (created_by = auth.uid() or (public.is_workspace_admin(workspace_id) and not is_private))');

-- note_links: visible when the note is visible (notes RLS applies inside the subquery)
select public.dv_policy('note_links_select', 'note_links', 'select',
  'public.is_workspace_member(workspace_id) and exists (select 1 from public.notes n where n.id = note_links.note_id)');
select public.dv_policy('note_links_insert', 'note_links', 'insert',
  'public.is_workspace_editor(workspace_id) and exists (select 1 from public.notes n where n.id = note_links.note_id)');
select public.dv_policy('note_links_update', 'note_links', 'update',
  'public.is_workspace_editor(workspace_id) and exists (select 1 from public.notes n where n.id = note_links.note_id)');
select public.dv_policy('note_links_delete', 'note_links', 'delete',
  'public.is_workspace_editor(workspace_id) and exists (select 1 from public.notes n where n.id = note_links.note_id)');

-- =============================================================================
-- 11. Chaabi vault tables: only the owning user (auth.uid() = user_id).
--     Writes to `vaults` (PIN verification, lockout counters, key wrapping)
--     and to `vault_otp_codes` go through the Worker with the service role so
--     the lockout (PW-5) and OTP limits (PW-11) cannot be bypassed by a client.
-- =============================================================================
select public.dv_policy('vaults_select', 'vaults', 'select', 'user_id = auth.uid()');

select public.dv_apply_policies('vault_items',
  'exists (select 1 from public.vaults v where v.id = vault_items.vault_id and v.user_id = auth.uid())',
  'exists (select 1 from public.vaults v where v.id = vault_items.vault_id and v.user_id = auth.uid())');

select public.dv_policy('vault_item_history_select', 'vault_item_history', 'select',
  'exists (select 1 from public.vault_items i join public.vaults v on v.id = i.vault_id where i.id = vault_item_history.vault_item_id and v.user_id = auth.uid())');
select public.dv_policy('vault_item_history_insert', 'vault_item_history', 'insert',
  'exists (select 1 from public.vault_items i join public.vaults v on v.id = i.vault_id where i.id = vault_item_history.vault_item_id and v.user_id = auth.uid())');
select public.dv_policy('vault_item_history_delete', 'vault_item_history', 'delete',
  'exists (select 1 from public.vault_items i join public.vaults v on v.id = i.vault_id where i.id = vault_item_history.vault_item_id and v.user_id = auth.uid())');

-- OTP codes: read own rows only (hashes); issue/verify/consume is Worker-only.
select public.dv_policy('vault_otp_codes_select', 'vault_otp_codes', 'select', 'user_id = auth.uid()');

-- Vault activity: read own; insert own (the Worker also writes with the service role).
select public.dv_policy('vault_activity_logs_select', 'vault_activity_logs', 'select', 'user_id = auth.uid()');
select public.dv_policy('vault_activity_logs_insert', 'vault_activity_logs', 'insert', 'user_id = auth.uid()');

-- AI provider keys: strictly per user
select public.dv_apply_policies('ai_provider_keys', 'user_id = auth.uid()', 'user_id = auth.uid()');

-- =============================================================================
-- 12. Grants (Supabase default privileges normally cover these; explicit for
--     clarity). `anon` deliberately gets nothing on application tables.
-- =============================================================================
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;

-- Clean up the policy helpers (they are only needed while this file runs).
drop function if exists public.dv_apply_policies(text, text, text);
drop function if exists public.dv_policy(text, text, text, text, text);
