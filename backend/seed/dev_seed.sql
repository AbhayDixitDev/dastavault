-- =============================================================================
-- DastaVault - seed/dev_seed.sql  (OPTIONAL, development only)
--
-- Creates a small "Patel Family" workspace for one existing auth user:
--   people: Rajesh (Dad), Meena (Mom), Nikhil (linked to the user)
--   relationships, groups (Parents, Kids), tags, one Passport document with a
--   version, a placeholder file row, metadata, a reminder, activity and a note.
--
-- HOW TO USE
--   1. Sign up once through the app, or add a user in the dashboard under
--      Authentication > Users. Verify the user exists in auth.users.
--   2. Replace the UUID in the `v_user` line below with that user's id.
--   3. Run this file in the Supabase SQL editor AFTER migrations 001..010.
--
-- Re-running is a no-op while the seeded workspace still exists.
-- The SQL editor runs as `postgres` (table owner) so RLS does not apply here;
-- auth.uid() is null, which is why owner_id / created_by are set explicitly.
-- The document_files row points at a placeholder R2 key; upload a real file
-- through the app to see a preview.
-- =============================================================================

do $$
declare
  v_user    uuid := '00000000-0000-0000-0000-000000000000';   -- <-- REPLACE with a real auth.users.id
  v_ws      uuid;
  v_rajesh  uuid;
  v_meena   uuid;
  v_nikhil  uuid;
  v_parents uuid;
  v_kids    uuid;
  v_tag_id  uuid;
  v_tag_tr  uuid;
  v_doc     uuid;
  v_ver     uuid;
  v_file    uuid;
  v_note    uuid;
begin
  if not exists (select 1 from auth.users where id = v_user) then
    raise exception 'Seed aborted: no auth.users row with id %. Edit v_user at the top of dev_seed.sql.', v_user;
  end if;

  if exists (select 1 from public.workspaces where owner_id = v_user and name = 'Patel Family (dev seed)') then
    raise notice 'Seed skipped: workspace "Patel Family (dev seed)" already exists for user %.', v_user;
    return;
  end if;

  -- Workspace (trigger adds owner membership + Family terminology)
  insert into public.workspaces (name, kind, icon, owner_id, created_by)
  values ('Patel Family (dev seed)', 'family', 'home', v_user, v_user)
  returning id into v_ws;

  -- People
  insert into public.people (workspace_id, display_name, first_name, last_name, relation_label, date_of_birth, created_by)
  values (v_ws, 'Rajesh Patel', 'Rajesh', 'Patel', 'Dad', date '1968-03-12', v_user)
  returning id into v_rajesh;

  insert into public.people (workspace_id, display_name, first_name, last_name, relation_label, date_of_birth, created_by)
  values (v_ws, 'Meena Patel', 'Meena', 'Patel', 'Mom', date '1972-07-30', v_user)
  returning id into v_meena;

  insert into public.people (workspace_id, display_name, first_name, last_name, relation_label, date_of_birth, user_id, created_by)
  values (v_ws, 'Nikhil Patel', 'Nikhil', 'Patel', 'Me', date '2000-11-05', v_user, v_user)
  returning id into v_nikhil;

  -- Relationships (from IS <relation> OF to)
  insert into public.person_relationships (workspace_id, from_person_id, to_person_id, relation, created_by) values
    (v_ws, v_rajesh, v_nikhil, 'father', v_user),
    (v_ws, v_meena,  v_nikhil, 'mother', v_user),
    (v_ws, v_nikhil, v_rajesh, 'son',    v_user),
    (v_ws, v_nikhil, v_meena,  'son',    v_user),
    (v_ws, v_rajesh, v_meena,  'spouse', v_user),
    (v_ws, v_meena,  v_rajesh, 'spouse', v_user);

  -- Groups
  insert into public.groups (workspace_id, name, icon, created_by)
  values (v_ws, 'Parents', 'users', v_user) returning id into v_parents;

  insert into public.groups (workspace_id, name, icon, created_by)
  values (v_ws, 'Kids', 'baby', v_user) returning id into v_kids;

  insert into public.person_groups (workspace_id, person_id, group_id, created_by) values
    (v_ws, v_rajesh, v_parents, v_user),
    (v_ws, v_meena,  v_parents, v_user),
    (v_ws, v_nikhil, v_kids,    v_user);

  -- Tags
  insert into public.tags (workspace_id, name, color, created_by)
  values (v_ws, 'identity', '#2563eb', v_user) returning id into v_tag_id;

  insert into public.tags (workspace_id, name, color, created_by)
  values (v_ws, 'travel', '#16a34a', v_user) returning id into v_tag_tr;

  -- Document: Rajesh's passport
  insert into public.documents (
    workspace_id, name, original_filename, document_type, status, visibility,
    summary, organisation, document_number, issue_date, expiry_date, page_count, created_by
  ) values (
    v_ws, 'Rajesh Patel - Passport - 2031', 'IMG_20260914_101522.jpg', 'Passport', 'ready', 'workspace',
    'Indian passport of Rajesh Patel, valid until September 2031.',
    'Passport Seva, Ministry of External Affairs', 'M1234567',
    date '2021-09-14', date '2031-09-13', 1, v_user
  ) returning id into v_doc;

  insert into public.document_versions (
    workspace_id, document_id, version_number, comment, source, hash,
    ocr_text, ocr_language, ocr_confidence, ocr_status, created_by
  ) values (
    v_ws, v_doc, 1, 'Scanned with phone', 'scan',
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'REPUBLIC OF INDIA PASSPORT Type P Country Code IND Passport No. M1234567 '
    'Surname PATEL Given Names RAJESH Nationality INDIAN Date of Birth 12/03/1968 '
    'Place of Issue MUMBAI Date of Issue 14/09/2021 Date of Expiry 13/09/2031',
    'eng', 93.40, 'done', v_user
  ) returning id into v_ver;

  update public.documents set current_version_id = v_ver where id = v_doc;

  insert into public.document_files (
    workspace_id, document_id, version_id, r2_object_key, original_filename,
    mime_type, size_bytes, sha256, page_number, kind, width, height, created_by
  ) values (
    v_ws, v_doc, v_ver, 'workspaces/' || v_ws || '/documents/' || v_doc || '/' || v_ver || '/page-1-processed.jpg',
    'IMG_20260914_101522.jpg', 'image/jpeg', 812345,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 1, 'processed', 1654, 2339, v_user
  ) returning id into v_file;

  insert into public.document_pages (
    workspace_id, document_id, version_id, page_number, file_id, ocr_text, ocr_language, ocr_confidence, created_by
  ) values (
    v_ws, v_doc, v_ver, 1, v_file,
    'REPUBLIC OF INDIA PASSPORT ... Passport No. M1234567 ... Date of Expiry 13/09/2031',
    'eng', 93.40, v_user
  );

  insert into public.document_metadata (workspace_id, document_id, key, value_text, value_date, source, confirmed_by, created_by) values
    (v_ws, v_doc, 'passport_number', 'M1234567', null,              'rule', v_user, v_user),
    (v_ws, v_doc, 'place_of_issue',  'Mumbai',   null,              'rule', v_user, v_user),
    (v_ws, v_doc, 'date_of_birth',   null,       date '1968-03-12', 'rule', v_user, v_user);

  insert into public.document_metadata_suggestions (workspace_id, document_id, version_id, key, value_text, confidence, source, status, created_by) values
    (v_ws, v_doc, v_ver, 'nationality', 'Indian', 0.91, 'rule', 'pending', v_user);

  insert into public.document_people (workspace_id, document_id, person_id, link_type, created_by)
  values (v_ws, v_doc, v_rajesh, 'owner', v_user);

  insert into public.document_groups (workspace_id, document_id, group_id, created_by)
  values (v_ws, v_doc, v_parents, v_user);

  insert into public.document_tags (workspace_id, document_id, tag_id, created_by) values
    (v_ws, v_doc, v_tag_id, v_user),
    (v_ws, v_doc, v_tag_tr, v_user);

  -- Reminders 30 / 7 / 1 days before expiry
  insert into public.reminders (workspace_id, document_id, title, field_name, due_date, days_before, remind_at, created_by)
  select v_ws, v_doc, 'Passport of Rajesh Patel expires soon', 'expiry_date', date '2031-09-13', d,
         (date '2031-09-13' - d)::timestamp at time zone 'Asia/Kolkata' + interval '9 hours', v_user
  from unnest(array[30, 7, 1]) as d;

  -- Album
  insert into public.albums (workspace_id, name, kind, person_id, cover_document_id, created_by)
  values (v_ws, 'Rajesh Patel', 'person', v_rajesh, v_doc, v_user);

  -- Activity
  insert into public.activity_logs (workspace_id, actor_id, entity_type, entity_id, action, message, metadata) values
    (v_ws, v_user, 'workspace', v_ws,  'created',  'Nikhil created the workspace.', '{}'),
    (v_ws, v_user, 'document',  v_doc, 'uploaded', 'Nikhil uploaded this document.', jsonb_build_object('version', 1)),
    (v_ws, v_user, 'document',  v_doc, 'person_linked', 'Rajesh Patel was linked to this document.', jsonb_build_object('person_id', v_rajesh));

  -- Note
  insert into public.notes (workspace_id, title, content_html, content_text, color, is_pinned, tags, created_by)
  values (
    v_ws, 'Passport renewal checklist',
    '<h2>Passport renewal</h2><ul><li>Old passport</li><li>Address proof</li><li>Two photos</li></ul>',
    'Passport renewal. Old passport. Address proof. Two photos.',
    '#fef3c7', true, array['todo','passport'], v_user
  ) returning id into v_note;

  insert into public.note_links (workspace_id, note_id, entity_type, entity_id, created_by) values
    (v_ws, v_note, 'person',   v_rajesh, v_user),
    (v_ws, v_note, 'document', v_doc,    v_user);

  raise notice 'Seed complete. workspace_id = %', v_ws;
end;
$$;

-- Quick check (run separately after the block above):
-- select * from public.search_documents_fts('<workspace_id>', 'dad passport', 10);
-- Note: in the SQL editor auth.uid() is null, so is_workspace_member() is false
-- and the search returns no rows; call it from the app (or with a user JWT) instead.
