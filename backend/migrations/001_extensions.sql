-- =============================================================================
-- DastaVault - 001_extensions.sql
-- Extensions, generic trigger helpers and workspace membership helpers.
--
-- Run first. Safe to re-run (idempotent).
-- Target: Supabase (PostgreSQL 15+, pgvector, pg_trgm, Supabase Auth).
-- =============================================================================

-- Supabase keeps extensions in the `extensions` schema and includes it in the
-- default search_path. On plain PostgreSQL the schema is created here so the
-- same file works; add `extensions` to your search_path in that case.
create schema if not exists extensions;

create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto    with schema extensions;
create extension if not exists vector      with schema extensions;
create extension if not exists pg_trgm     with schema extensions;

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger function: stamps updated_at = now().';

-- Convenience: (re)create the standard updated_at trigger on a table.
-- Usage: select public.ensure_updated_at_trigger('documents');
create or replace function public.ensure_updated_at_trigger(p_table text)
returns void
language plpgsql
as $$
begin
  execute format('drop trigger if exists set_updated_at on public.%I', p_table);
  execute format(
    'create trigger set_updated_at before update on public.%I
       for each row execute function public.set_updated_at()',
    p_table
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Workspace membership helpers (used by RLS policies and search functions).
--
-- These are SECURITY DEFINER so they can read public.workspace_members without
-- triggering that table's own RLS policies (avoids policy recursion).
-- They are written in plpgsql so this file can be executed before
-- workspace_members exists (SQL-language bodies are validated at creation).
-- -----------------------------------------------------------------------------
create or replace function public.is_workspace_member(ws uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  if ws is null or auth.uid() is null then
    return false;
  end if;
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = ws
      and m.user_id = auth.uid()
  ) into v_found;
  return coalesce(v_found, false);
end;
$$;

comment on function public.is_workspace_member(uuid) is
  'True when the current auth user is a member of workspace ws.';

create or replace function public.workspace_role(ws uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if ws is null or auth.uid() is null then
    return null;
  end if;
  select m.role_key into v_role
  from public.workspace_members m
  where m.workspace_id = ws
    and m.user_id = auth.uid()
  limit 1;
  return v_role;
end;
$$;

comment on function public.workspace_role(uuid) is
  'Role key (owner/admin/editor/viewer/restricted) of the current user in workspace ws, or null.';

-- Convenience wrappers used by many policies.
create or replace function public.is_workspace_admin(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.workspace_role(ws) in ('owner', 'admin');
$$;

create or replace function public.is_workspace_editor(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.workspace_role(ws) in ('owner', 'admin', 'editor');
$$;

grant execute on function public.is_workspace_member(uuid)  to authenticated, service_role;
grant execute on function public.workspace_role(uuid)       to authenticated, service_role;
grant execute on function public.is_workspace_admin(uuid)   to authenticated, service_role;
grant execute on function public.is_workspace_editor(uuid)  to authenticated, service_role;
