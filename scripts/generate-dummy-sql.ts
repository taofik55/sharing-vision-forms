/**
 * Writes supabase/dummy-data.sql (dummy accounts, forms, versions, members,
 * responses, drafts, share links) for the Supabase SQL editor or psql:
 *
 *   pnpm db:dummy-sql
 *
 * Form definitions come from the app templates (Indonesian) and are validated
 * with the form schema, so regenerate after changing templates or the schema.
 * Question keys are random per run; the output is committed.
 */
import { writeFileSync } from "node:fs";
import { newId } from "../src/lib/forms/operations";
import {
  formDefinitionSchema,
  type FormDefinition,
  type Question,
} from "../src/lib/forms/schema";
import { instantiateTemplate } from "../src/lib/forms/templates";

function check(def: FormDefinition): string {
  const parsed = formDefinitionSchema.safeParse(def);
  if (!parsed.success)
    throw new Error(JSON.stringify(parsed.error.issues.slice(0, 3)));
  return JSON.stringify(def);
}

// Survey: template + waiting time and age (the generator correlates number #1
// with satisfaction and number #2 with the acquisition channel).
const survey = instantiateTemplate("customer_satisfaction", "id");
const surveyExtra: Question[] = [
  {
    id: newId(),
    key: newId(),
    type: "number",
    title: "Berapa lama Anda menunggu untuk dilayani? (menit)",
    required: true,
    validation: { min: 0, max: 120, integerOnly: true },
  },
  {
    id: newId(),
    key: newId(),
    type: "number",
    title: "Usia Anda",
    required: true,
    validation: { min: 16, max: 90, integerOnly: true },
  },
];
const about = survey.definition.sections[0];
about.questions.splice(
  about.questions.findIndex((q) => q.type === "number"),
  0,
  ...surveyExtra,
);

const employeeV1 = instantiateTemplate("employee_feedback", "id");
const employeeV2: FormDefinition = structuredClone(employeeV1.definition);
employeeV2.sections[1].questions.splice(2, 0, {
  id: newId(),
  key: newId(),
  type: "rating",
  title: "Seberapa puas Anda dengan fasilitas kantor?",
  required: false,
  rating: { max: 5 },
});

const event = instantiateTemplate("event_registration", "id");
const blank = instantiateTemplate("blank", "id");
const closed = instantiateTemplate("customer_satisfaction", "id");
const archived = instantiateTemplate("employee_feedback", "id");

const J = (def: FormDefinition) => `$json$${check(def)}$json$::jsonb`;

const sql = `-- =============================================================================
-- Sharing Vision Form App: dummy data (accounts, forms, versions, members,
-- responses, abandoned drafts, dashboard share links).
--
-- !!! DEVELOPMENT / DEMO ONLY. All passwords are public: Password123! !!!
-- Never run this against production (see docs/supabase-setup.md 2.6).
--
-- How to run (as postgres, after all migrations):
--   * Supabase Studio > SQL Editor: paste the whole file, Run.
--   * Local: docker exec -i supabase_db_formpulse psql -U postgres < supabase/dummy-data.sql
--   * Hosted: psql "<connection string>" -f supabase/dummy-data.sql
--
-- Re-runnable: accounts are updated in place (same ids), the dummy forms are
-- deleted (by slug) and recreated with fresh responses. Takes ~10-20 s.
-- Responses come from generate_demo_responses() and are flagged is_demo, so
-- the scale page's "Clear" (or delete_demo_responses) can remove them.
-- Form definitions are the app's Indonesian templates (valid for the Zod schema).
-- =============================================================================

-- Helpers live in pg_temp: they disappear when the session ends.

-- Creates or updates an auth user + profile; returns the user id.
create or replace function pg_temp.dummy_user(
  p_email text, p_full_name text, p_role public.app_role, p_active boolean default true
) returns uuid
language plpgsql as $fn$
declare
  v_id uuid;
  v_app jsonb := jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', p_role);
  v_meta jsonb := jsonb_build_object('full_name', p_full_name, 'role', p_role);
begin
  select u.id into v_id from auth.users u where lower(u.email) = lower(p_email);
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', lower(p_email),
      extensions.crypt('Password123!', extensions.gen_salt('bf')), now(),
      v_app, v_meta, now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), v_id, v_id::text, 'email',
      jsonb_build_object('sub', v_id::text, 'email', lower(p_email), 'email_verified', true, 'phone_verified', false),
      now(), now(), now()
    );
  else
    update auth.users
    set encrypted_password = extensions.crypt('Password123!', extensions.gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || v_app,
        raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || v_meta,
        updated_at = now()
    where id = v_id;
  end if;

  -- The on_auth_user_created trigger made the profile; enforce role and status.
  update public.profiles
  set role = p_role, full_name = p_full_name, is_active = p_active,
      workspace_id = '00000000-0000-0000-0000-000000000001'
  where id = v_id;
  -- Deactivated users are also banned in Auth (same as Admin > Users).
  update auth.users
  set banned_until = case when p_active then null else now() + interval '100 years' end
  where id = v_id;
  return v_id;
end;
$fn$;

-- Creates a form (deleting a previous one with the same slug) and, unless it is
-- a draft, publishes version 1. Returns the form id.
create or replace function pg_temp.dummy_form(
  p_slug text, p_title text, p_description text, p_owner uuid, p_definition jsonb,
  p_publish boolean default true, p_identifier public.identifier_mode default 'none'
) returns uuid
language plpgsql as $fn$
declare
  v_form uuid;
  v_version uuid;
begin
  delete from public.forms f where f.slug = p_slug;
  insert into public.forms (workspace_id, owner_id, title, description, slug, draft_definition,
                            identifier_mode, thank_you_message, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000001', p_owner, p_title, p_description, p_slug, p_definition,
          p_identifier, 'Terima kasih atas tanggapan Anda!', now() - interval '95 days', now())
  returning id into v_form;
  if p_publish then
    insert into public.form_versions (form_id, version_number, definition, published_by, published_at)
    values (v_form, 1, p_definition, p_owner, now() - interval '92 days')
    returning id into v_version;
    update public.forms set current_version_id = v_version, status = 'published' where id = v_form;
  end if;
  return v_form;
end;
$fn$;

-- Publishes the next version of a form with a new definition.
create or replace function pg_temp.dummy_publish(p_form uuid, p_definition jsonb, p_by uuid)
returns uuid
language plpgsql as $fn$
declare
  v_version uuid;
begin
  insert into public.form_versions (form_id, version_number, definition, published_by)
  select p_form, coalesce(max(v.version_number), 0) + 1, p_definition, p_by
  from public.form_versions v where v.form_id = p_form
  returning id into v_version;
  update public.forms set current_version_id = v_version, draft_definition = p_definition, status = 'published'
  where id = p_form;
  return v_version;
end;
$fn$;

-- Generates responses in chunks of 1,000 (same function as the demo tools).
create or replace function pg_temp.dummy_responses(p_form uuid, p_n integer, p_days integer)
returns void
language plpgsql as $fn$
declare
  v_done integer := 0;
begin
  while v_done < p_n loop
    perform public.generate_demo_responses(p_form, least(1000, p_n - v_done), p_days);
    v_done := v_done + 1000;
  end loop;
end;
$fn$;

do $$
declare
  v_admin uuid;
  v_editor uuid;
  v_viewer uuid;
  v_editor2 uuid;
  v_viewer2 uuid;
  v_survey uuid;
  v_employee uuid;
  v_event uuid;
  v_closed uuid;
  v_archived uuid;
  v_draft uuid;
begin
  insert into public.workspaces (id, name)
  values ('00000000-0000-0000-0000-000000000001', 'Default workspace')
  on conflict (id) do nothing;

  -- ---------------------------------------------------------------- accounts
  v_admin   := pg_temp.dummy_user('admin@formpulse.test',   'Dummy Admin',   'admin');
  v_editor  := pg_temp.dummy_user('editor@formpulse.test',  'Dummy Editor',  'editor');
  v_viewer  := pg_temp.dummy_user('viewer@formpulse.test',  'Dummy Viewer',  'viewer');
  v_editor2 := pg_temp.dummy_user('editor2@formpulse.test', 'Rina Editor',   'editor');
  v_viewer2 := pg_temp.dummy_user('viewer2@formpulse.test', 'Budi Viewer',   'viewer');
  perform pg_temp.dummy_user('inactive@formpulse.test', 'Akun Nonaktif', 'editor', false);

  -- ------------------------------------------------------------------- forms
  -- 1. Published survey, 400 responses over 60 days. Owner: editor.
  --    Shared: viewer (viewer), editor2 (editor). Public link: /id/f/dummy-survei-kepuasan
  v_survey := pg_temp.dummy_form('dummy-survei-kepuasan', 'Survei Kepuasan Pelanggan 2026',
    'Data dummy: survei kepuasan pelanggan toko dan aplikasi.', v_editor,
    ${J(survey.definition)});
  insert into public.form_members (form_id, user_id, role) values
    (v_survey, v_viewer, 'viewer'), (v_survey, v_editor2, 'editor');
  perform pg_temp.dummy_responses(v_survey, 400, 60);

  -- 2. Employee feedback with two versions: v1 (120 responses over 90 days),
  --    v2 adds a rating question (80 responses over the last 20 days).
  --    Owner: editor2. Shared: editor (editor), viewer2 (viewer).
  v_employee := pg_temp.dummy_form('dummy-umpan-balik-karyawan', 'Umpan Balik Karyawan Q4',
    'Data dummy: dua versi formulir, pertanyaan baru di versi 2.', v_editor2,
    ${J(employeeV1.definition)});
  insert into public.form_members (form_id, user_id, role) values
    (v_employee, v_editor, 'editor'), (v_employee, v_viewer2, 'viewer');
  perform pg_temp.dummy_responses(v_employee, 120, 90);
  perform pg_temp.dummy_publish(v_employee, ${J(employeeV2)}, v_editor2);
  perform pg_temp.dummy_responses(v_employee, 80, 20);

  -- 3. Event registration with identifier mode "email": one response per email.
  --    Owner: admin. Shared: viewer (viewer) -> sees masked emails.
  v_event := pg_temp.dummy_form('dummy-pendaftaran-acara', 'Pendaftaran Webinar Sharing Vision',
    'Data dummy: identitas email per responden (tampil tersamar untuk viewer).', v_admin,
    ${J(event.definition)}, true, 'email');
  insert into public.form_members (form_id, user_id, role) values (v_event, v_viewer, 'viewer');
  perform pg_temp.dummy_responses(v_event, 60, 14);
  -- Identifier columns come from the email answer (the generator leaves them empty).
  update public.responses r
  set identifier_email = a.value_text, identifier_key = lower(a.value_text)
  from public.response_answers a
  where a.response_id = r.id and a.question_type = 'email' and r.form_id = v_event;

  -- 4. Closed form (deadline passed), 30 responses. Owner: editor.
  v_closed := pg_temp.dummy_form('dummy-survei-ditutup', 'Survei Promo Ramadan (ditutup)',
    'Data dummy: formulir yang sudah ditutup.', v_editor,
    ${J(closed.definition)});
  perform pg_temp.dummy_responses(v_closed, 30, 30);
  update public.forms
  set status = 'closed', deadline_at = now() - interval '3 days',
      closed_message = 'Survei ini sudah ditutup. Terima kasih!'
  where id = v_closed;

  -- 5. Archived form, 15 responses. Owner: editor2 (hidden unless filtered by status).
  v_archived := pg_temp.dummy_form('dummy-arsip-2025', 'Umpan Balik Tahunan 2025 (arsip)',
    'Data dummy: formulir yang diarsipkan.', v_editor2,
    ${J(archived.definition)});
  perform pg_temp.dummy_responses(v_archived, 15, 90);
  update public.forms set status = 'archived' where id = v_archived;

  -- 6. Draft, never published. Owner: editor.
  v_draft := pg_temp.dummy_form('dummy-draf-baru', 'Formulir Draf (belum terbit)',
    null, v_editor, ${J(blank.definition)}, false);

  -- ----------------------------------------------------- dashboard share links
  -- Tokens are fixed so the links are predictable in development. Real links
  -- are created from the dashboard's Share dialog with random tokens.
  insert into public.dashboard_shares (form_id, token, include_text_answers, is_active, expires_at, created_by) values
    (v_survey,   'dummy-share-survei-kepuasan-aktif-000000001', false, true,  null,                       v_editor),
    (v_survey,   'dummy-share-survei-kepuasan-teks-0000000002', true,  true,  now() + interval '30 days', v_editor),
    (v_employee, 'dummy-share-karyawan-nonaktif-00000000000003', false, false, null,                      v_editor2),
    (v_event,    'dummy-share-acara-kedaluwarsa-0000000000004', false, true,  now() - interval '1 day',  v_admin);
end;
$$;

-- Fresh planner statistics after the bulk inserts.
select public.analyze_response_tables();

-- ----------------------------------------------------------------- summary
select u.email, p.role, p.is_active, 'Password123!' as password
from public.profiles p join auth.users u on u.id = p.id
where u.email in ('admin@formpulse.test', 'editor@formpulse.test', 'viewer@formpulse.test',
                  'editor2@formpulse.test', 'viewer2@formpulse.test', 'inactive@formpulse.test')
order by p.role, u.email;

select f.slug, f.title, f.status, f.identifier_mode, o.email as owner,
       (select count(*) from public.form_versions v where v.form_id = f.id) as versions,
       (select count(*) from public.responses r where r.form_id = f.id) as responses,
       (select string_agg(pm.email || ' (' || m.role || ')', ', ' order by pm.email)
          from public.form_members m join public.profiles pm on pm.id = m.user_id
         where m.form_id = f.id) as shared_with,
       '/id/f/' || f.slug as public_form
from public.forms f join public.profiles o on o.id = f.owner_id
where f.slug like 'dummy-%'
order by f.created_at, f.slug;

select f.slug, s.is_active, s.include_text_answers, s.expires_at, '/id/d/' || s.token as public_dashboard
from public.dashboard_shares s join public.forms f on f.id = s.form_id
where s.token like 'dummy-share-%'
order by f.slug, s.token;
`;

writeFileSync("supabase/dummy-data.sql", sql);
console.log("written", sql.length);
