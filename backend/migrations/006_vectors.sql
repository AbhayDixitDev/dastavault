-- =============================================================================
-- DastaVault - 006_vectors.sql
-- Chunk embeddings for "search by meaning" and "Ask your documents".
-- Requires: 005_search.sql (documents), pgvector extension from 001.
--
-- IMPORTANT: the embedding dimension must match the model used in the browser.
-- Default model: Xenova/all-MiniLM-L6-v2 (Transformers.js) => 384 dimensions.
-- A different model with a different dimension needs a new column or table
-- (pgvector columns are fixed-size); embedding_model/embedding_version are
-- stored on every row so the app can tell which rows belong to which model.
-- =============================================================================

create table if not exists public.document_chunks (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  document_id       uuid not null references public.documents(id) on delete cascade,
  version_id        uuid references public.document_versions(id) on delete cascade,
  chunk_number      integer not null check (chunk_number >= 0),
  page_number       integer,
  section           text,                                    -- heading / part of the document, optional
  content           text not null check (char_length(content) <= 4000),
  embedding         vector(384),                             -- dimension = model output size
  embedding_model   text not null default 'Xenova/all-MiniLM-L6-v2',
  embedding_version text not null default '1',
  token_count       integer,
  metadata          jsonb not null default '{}'::jsonb,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (document_id, version_id, embedding_model, chunk_number)
);

create index if not exists document_chunks_workspace_id_idx on public.document_chunks (workspace_id);
create index if not exists document_chunks_document_id_idx  on public.document_chunks (document_id);
create index if not exists document_chunks_version_id_idx   on public.document_chunks (version_id);
create index if not exists document_chunks_created_by_idx   on public.document_chunks (created_by);
create index if not exists document_chunks_model_idx        on public.document_chunks (embedding_model, embedding_version);

-- Approximate nearest neighbour index (cosine distance). HNSW needs no
-- training step and works well while the table is small (free tier).
create index if not exists document_chunks_embedding_hnsw
  on public.document_chunks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

select public.ensure_updated_at_trigger('document_chunks');

comment on column public.document_chunks.embedding is
  'vector(384) - must match the browser embedding model (default Xenova/all-MiniLM-L6-v2 = 384 dims).';

-- -----------------------------------------------------------------------------
-- search_chunks(ws, query_embedding, lim)
--
-- Nearest chunks by cosine similarity, restricted to workspace `ws` AND to
-- callers who are members of it. SECURITY INVOKER: when called by a user
-- through PostgREST the document_chunks RLS policies (document visibility)
-- apply as well; the Worker may call it with the service role after its own
-- checks. Rows of soft-deleted documents are excluded.
-- -----------------------------------------------------------------------------
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
    and public.is_workspace_member(ws)
    and c.embedding is not null
    and d.deleted_at is null
  order by c.embedding <=> query_embedding
  limit greatest(coalesce(lim, 20), 1);
$$;

grant execute on function public.search_chunks(uuid, vector, int) to authenticated, service_role;
