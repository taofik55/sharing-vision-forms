-- =============================================================================
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
    $json${"schemaVersion":1,"sections":[{"id":"jwGBqfaWJztf","title":"Tentang Anda","questions":[{"id":"chD5r1ccoXA3","required":false,"key":"XH4UrKTZOfZP","type":"short_text","title":"Nama Anda"},{"id":"qyeCXIuVCkwY","required":false,"key":"fQahGOVpx18m","type":"email","title":"Alamat email","description":"Hanya untuk menindaklanjuti masukan Anda."},{"id":"Ko6V8K8VwMLM","required":false,"key":"6DEz9gDWEBv7","type":"date","title":"Tanggal kunjungan terakhir"},{"id":"vq3x4QbqIDYw","key":"cIFNwdLfOy62","type":"number","title":"Berapa lama Anda menunggu untuk dilayani? (menit)","required":true,"validation":{"min":0,"max":120,"integerOnly":true}},{"id":"h0yCmBcgs61F","key":"huVtkYhAQfIk","type":"number","title":"Usia Anda","required":true,"validation":{"min":16,"max":90,"integerOnly":true}},{"id":"fy79jw6eqXJf","required":false,"key":"lAuB8zEAI4K6","type":"number","title":"Berapa kali Anda berkunjung tahun ini?","validation":{"min":0,"max":365,"integerOnly":true}}]},{"id":"8fsniahWDFe6","title":"Pengalaman Anda","questions":[{"id":"vCPfpj0YBAHD","required":true,"key":"oCNF96l3esI4","type":"rating","title":"Secara keseluruhan, seberapa puas Anda?","rating":{"max":5}},{"id":"DYxIyVfXqeNl","required":true,"key":"U14YhTf2Ciu4","type":"linear_scale","title":"Seberapa mungkin Anda merekomendasikan kami kepada teman?","scale":{"min":0,"max":10,"minLabel":"Sangat tidak mungkin","maxLabel":"Sangat mungkin"}},{"id":"DXyOCe1IBbBl","required":false,"key":"wdxHUthpUgtt","type":"checkboxes","title":"Produk apa saja yang Anda gunakan?","options":[{"id":"web","label":"Situs web"},{"id":"app","label":"Aplikasi seluler"},{"id":"store","label":"Toko fisik"},{"id":"support","label":"Layanan pelanggan"}],"allowOther":true},{"id":"FwvB55ySqqqw","required":false,"key":"mJwG7vz7Tnbm","type":"dropdown","title":"Dari mana Anda mengetahui kami?","options":[{"id":"social","label":"Media sosial"},{"id":"friend","label":"Teman atau keluarga"},{"id":"search","label":"Mesin pencari"},{"id":"ads","label":"Iklan"}]},{"id":"d3OQbv8VB5Re","required":true,"key":"v383t55Ybrl5","type":"paragraph","title":"Apa yang perlu kami perbaiki?","showIf":{"combinator":"and","conditions":[{"questionKey":"oCNF96l3esI4","operator":"lt","value":3}]}},{"id":"S75qxw1VGEf9","required":false,"key":"gC0noMZFRe4R","type":"paragraph","title":"Apa yang paling Anda sukai?","showIf":{"combinator":"and","conditions":[{"questionKey":"oCNF96l3esI4","operator":"gt","value":3}]}},{"id":"cRRkasH5xISu","required":true,"key":"N9TvblJGILmF","type":"multiple_choice","title":"Bolehkah kami menghubungi Anda terkait jawaban ini?","options":[{"id":"yes","label":"Ya"},{"id":"no","label":"Tidak"}]},{"id":"HY9FiB1eAXQo","required":true,"key":"HE7JQURbgpBu","type":"phone","title":"Nomor telepon","showIf":{"combinator":"and","conditions":[{"questionKey":"N9TvblJGILmF","operator":"equals","value":"yes"}]}}]}]}$json$::jsonb);
  insert into public.form_members (form_id, user_id, role) values
    (v_survey, v_viewer, 'viewer'), (v_survey, v_editor2, 'editor');
  perform pg_temp.dummy_responses(v_survey, 400, 60);

  -- 2. Employee feedback with two versions: v1 (120 responses over 90 days),
  --    v2 adds a rating question (80 responses over the last 20 days).
  --    Owner: editor2. Shared: editor (editor), viewer2 (viewer).
  v_employee := pg_temp.dummy_form('dummy-umpan-balik-karyawan', 'Umpan Balik Karyawan Q4',
    'Data dummy: dua versi formulir, pertanyaan baru di versi 2.', v_editor2,
    $json${"schemaVersion":1,"sections":[{"id":"pzThqaT0xIQz","title":"Peran Anda","questions":[{"id":"1TcVxz9uROm6","required":true,"key":"Vy9NYX1rHhuo","type":"dropdown","title":"Departemen","options":[{"id":"engineering","label":"Teknik"},{"id":"sales","label":"Penjualan"},{"id":"operations","label":"Operasional"},{"id":"hr","label":"SDM"},{"id":"finance","label":"Keuangan"}]},{"id":"IMhdKWAvUppq","required":true,"key":"Rt60Uh3LVjif","type":"multiple_choice","title":"Sudah berapa lama Anda bekerja di sini?","options":[{"id":"lt1","label":"Kurang dari 1 tahun"},{"id":"1to3","label":"1–3 tahun"},{"id":"3to5","label":"3–5 tahun"},{"id":"gt5","label":"Lebih dari 5 tahun"}]}]},{"id":"0NMrABNmUF3Q","title":"Umpan balik Anda","questions":[{"id":"nzMqs7eGXVBJ","required":true,"key":"PlQyariadwDX","type":"linear_scale","title":"Seberapa puas Anda dengan pekerjaan Anda?","scale":{"min":1,"max":5,"minLabel":"Sangat tidak puas","maxLabel":"Sangat puas"}},{"id":"SuhmamREvlFF","required":true,"key":"DqQbtvF7NE8M","type":"rating","title":"Nilai dukungan dari atasan Anda","rating":{"max":5}},{"id":"pqNNa3H67N1o","required":false,"key":"x1VrCsgbnwyK","type":"checkboxes","title":"Apa yang membantu keseimbangan kerja Anda?","options":[{"id":"remote","label":"Kerja jarak jauh"},{"id":"flexible","label":"Jam kerja fleksibel"},{"id":"leave","label":"Cuti berbayar"},{"id":"wellness","label":"Program kesehatan"}],"allowOther":true},{"id":"0RbJUl5ypJiD","required":true,"key":"Syy4Qvh8qmwf","type":"multiple_choice","title":"Apakah Anda akan merekomendasikan perusahaan ini sebagai tempat kerja?","options":[{"id":"yes","label":"Ya"},{"id":"maybe","label":"Mungkin"},{"id":"no","label":"Tidak"}]},{"id":"i3D8TaxggRSq","required":true,"key":"XevxHdyJkjer","type":"paragraph","title":"Apa hal utama yang perlu kami ubah?","showIf":{"combinator":"or","conditions":[{"questionKey":"PlQyariadwDX","operator":"lt","value":3},{"questionKey":"DqQbtvF7NE8M","operator":"lt","value":3},{"questionKey":"Syy4Qvh8qmwf","operator":"equals","value":"no"}]}},{"id":"PFtO9JzwWIlJ","required":false,"key":"QpQ0PTPwz7E5","type":"paragraph","title":"Ada ide lain?"}]}]}$json$::jsonb);
  insert into public.form_members (form_id, user_id, role) values
    (v_employee, v_editor, 'editor'), (v_employee, v_viewer2, 'viewer');
  perform pg_temp.dummy_responses(v_employee, 120, 90);
  perform pg_temp.dummy_publish(v_employee, $json${"schemaVersion":1,"sections":[{"id":"pzThqaT0xIQz","title":"Peran Anda","questions":[{"id":"1TcVxz9uROm6","required":true,"key":"Vy9NYX1rHhuo","type":"dropdown","title":"Departemen","options":[{"id":"engineering","label":"Teknik"},{"id":"sales","label":"Penjualan"},{"id":"operations","label":"Operasional"},{"id":"hr","label":"SDM"},{"id":"finance","label":"Keuangan"}]},{"id":"IMhdKWAvUppq","required":true,"key":"Rt60Uh3LVjif","type":"multiple_choice","title":"Sudah berapa lama Anda bekerja di sini?","options":[{"id":"lt1","label":"Kurang dari 1 tahun"},{"id":"1to3","label":"1–3 tahun"},{"id":"3to5","label":"3–5 tahun"},{"id":"gt5","label":"Lebih dari 5 tahun"}]}]},{"id":"0NMrABNmUF3Q","title":"Umpan balik Anda","questions":[{"id":"nzMqs7eGXVBJ","required":true,"key":"PlQyariadwDX","type":"linear_scale","title":"Seberapa puas Anda dengan pekerjaan Anda?","scale":{"min":1,"max":5,"minLabel":"Sangat tidak puas","maxLabel":"Sangat puas"}},{"id":"SuhmamREvlFF","required":true,"key":"DqQbtvF7NE8M","type":"rating","title":"Nilai dukungan dari atasan Anda","rating":{"max":5}},{"id":"DZGixA77t4mR","key":"WP8PnsCPRknS","type":"rating","title":"Seberapa puas Anda dengan fasilitas kantor?","required":false,"rating":{"max":5}},{"id":"pqNNa3H67N1o","required":false,"key":"x1VrCsgbnwyK","type":"checkboxes","title":"Apa yang membantu keseimbangan kerja Anda?","options":[{"id":"remote","label":"Kerja jarak jauh"},{"id":"flexible","label":"Jam kerja fleksibel"},{"id":"leave","label":"Cuti berbayar"},{"id":"wellness","label":"Program kesehatan"}],"allowOther":true},{"id":"0RbJUl5ypJiD","required":true,"key":"Syy4Qvh8qmwf","type":"multiple_choice","title":"Apakah Anda akan merekomendasikan perusahaan ini sebagai tempat kerja?","options":[{"id":"yes","label":"Ya"},{"id":"maybe","label":"Mungkin"},{"id":"no","label":"Tidak"}]},{"id":"i3D8TaxggRSq","required":true,"key":"XevxHdyJkjer","type":"paragraph","title":"Apa hal utama yang perlu kami ubah?","showIf":{"combinator":"or","conditions":[{"questionKey":"PlQyariadwDX","operator":"lt","value":3},{"questionKey":"DqQbtvF7NE8M","operator":"lt","value":3},{"questionKey":"Syy4Qvh8qmwf","operator":"equals","value":"no"}]}},{"id":"PFtO9JzwWIlJ","required":false,"key":"QpQ0PTPwz7E5","type":"paragraph","title":"Ada ide lain?"}]}]}$json$::jsonb, v_editor2);
  perform pg_temp.dummy_responses(v_employee, 80, 20);

  -- 3. Event registration with identifier mode "email": one response per email.
  --    Owner: admin. Shared: viewer (viewer) -> sees masked emails.
  v_event := pg_temp.dummy_form('dummy-pendaftaran-acara', 'Pendaftaran Webinar Sharing Vision',
    'Data dummy: identitas email per responden (tampil tersamar untuk viewer).', v_admin,
    $json${"schemaVersion":1,"sections":[{"id":"kNgZbjel9MOR","title":"Data peserta","questions":[{"id":"GidY1EKJqmt2","required":true,"key":"Ilhah8VZTLry","type":"short_text","title":"Nama lengkap","validation":{"minLength":2,"maxLength":100}},{"id":"tj6gJPbiWzAQ","required":true,"key":"MUoHBBG2C5FB","type":"email","title":"Email"},{"id":"IKljCBFT20aN","required":true,"key":"ooObjp1rpGrU","type":"phone","title":"Nomor telepon"},{"id":"EsfkhkcjKMKx","required":false,"key":"itDhhoSPERv9","type":"short_text","title":"Organisasi"}]},{"id":"s9U53dFgVgyd","title":"Tiket dan sesi","questions":[{"id":"szjKNh0ipwiY","required":true,"key":"ds5iqqWS4YPE","type":"multiple_choice","title":"Jenis tiket","options":[{"id":"regular","label":"Reguler"},{"id":"student","label":"Pelajar/Mahasiswa"},{"id":"vip","label":"VIP"}]},{"id":"2OKPqGxG6liE","required":true,"key":"MxbDZkwneWxT","type":"short_text","title":"Nomor induk pelajar/mahasiswa","validation":{"pattern":"[A-Za-z0-9-]{4,20}"},"showIf":{"combinator":"and","conditions":[{"questionKey":"ds5iqqWS4YPE","operator":"equals","value":"student"}]}},{"id":"La5mm3WuU0cB","required":true,"key":"GCYlTnuVXZZY","type":"checkboxes","title":"Sesi mana yang akan Anda ikuti?","validation":{"min":1,"max":3},"options":[{"id":"keynote","label":"Pembukaan utama"},{"id":"workshop","label":"Lokakarya praktik"},{"id":"panel","label":"Diskusi panel"},{"id":"networking","label":"Makan malam networking"}]},{"id":"dhSBjhLynz5p","required":false,"key":"Xv6TEAUuZLv1","type":"dropdown","title":"Preferensi makanan","options":[{"id":"none","label":"Tidak ada"},{"id":"vegetarian","label":"Vegetarian"},{"id":"halal","label":"Halal"},{"id":"gluten_free","label":"Bebas gluten"}],"allowOther":true,"showIf":{"combinator":"and","conditions":[{"questionKey":"GCYlTnuVXZZY","operator":"contains","value":"networking"}]}},{"id":"YOLEwyKLiJpL","required":false,"key":"ru7JJR11hS9c","type":"number","title":"Jumlah tamu tambahan","validation":{"min":0,"max":5,"integerOnly":true}},{"id":"LZ78kgPkwoVW","required":false,"key":"W2NpxIDEE7NJ","type":"date","title":"Tanggal kedatangan"}]},{"id":"Mlpr36ukVOxr","title":"Ada lagi?","questions":[{"id":"EkSnV7USIWrv","required":false,"key":"sNB8ViyaGPtK","type":"multiple_choice","title":"Apakah Anda memerlukan dukungan aksesibilitas?","options":[{"id":"yes","label":"Ya"},{"id":"no","label":"Tidak"}]},{"id":"Z7kycNcnACG5","required":true,"key":"CNrh75dkD4NE","type":"paragraph","title":"Ceritakan kebutuhan Anda","showIf":{"combinator":"and","conditions":[{"questionKey":"sNB8ViyaGPtK","operator":"equals","value":"yes"}]}},{"id":"MW3ciIW8YV6O","required":false,"key":"szgcSUyE1PVi","type":"paragraph","title":"Komentar atau pertanyaan"}]}]}$json$::jsonb, true, 'email');
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
    $json${"schemaVersion":1,"sections":[{"id":"E7r1bSYqRWNi","title":"Tentang Anda","questions":[{"id":"WSmTgb8CvWVx","required":false,"key":"qqTDd5WHl8FG","type":"short_text","title":"Nama Anda"},{"id":"XoE3DujAiKCO","required":false,"key":"9ljzfNTRas0V","type":"email","title":"Alamat email","description":"Hanya untuk menindaklanjuti masukan Anda."},{"id":"h1ZrBIEztdpC","required":false,"key":"keKz5hPxiYB1","type":"date","title":"Tanggal kunjungan terakhir"},{"id":"1oWr9Y9r1FPE","required":false,"key":"QUWDtJAOxpiG","type":"number","title":"Berapa kali Anda berkunjung tahun ini?","validation":{"min":0,"max":365,"integerOnly":true}}]},{"id":"sbL8WC4ZhFpl","title":"Pengalaman Anda","questions":[{"id":"Tlkmj0TNHPZu","required":true,"key":"5gxcji0FdHI3","type":"rating","title":"Secara keseluruhan, seberapa puas Anda?","rating":{"max":5}},{"id":"ZwU5Z7pPIjBN","required":true,"key":"8ugyEJpP15gT","type":"linear_scale","title":"Seberapa mungkin Anda merekomendasikan kami kepada teman?","scale":{"min":0,"max":10,"minLabel":"Sangat tidak mungkin","maxLabel":"Sangat mungkin"}},{"id":"TSTig47JnBwD","required":false,"key":"Hng1STow4Ld2","type":"checkboxes","title":"Produk apa saja yang Anda gunakan?","options":[{"id":"web","label":"Situs web"},{"id":"app","label":"Aplikasi seluler"},{"id":"store","label":"Toko fisik"},{"id":"support","label":"Layanan pelanggan"}],"allowOther":true},{"id":"qKCJ1V1o5bLg","required":false,"key":"3zpXlkcrxyj7","type":"dropdown","title":"Dari mana Anda mengetahui kami?","options":[{"id":"social","label":"Media sosial"},{"id":"friend","label":"Teman atau keluarga"},{"id":"search","label":"Mesin pencari"},{"id":"ads","label":"Iklan"}]},{"id":"kLUXsjOwQ9qS","required":true,"key":"3z0KpScGlY4C","type":"paragraph","title":"Apa yang perlu kami perbaiki?","showIf":{"combinator":"and","conditions":[{"questionKey":"5gxcji0FdHI3","operator":"lt","value":3}]}},{"id":"5yFBXIfPzMfL","required":false,"key":"rLm3vyvpZDyy","type":"paragraph","title":"Apa yang paling Anda sukai?","showIf":{"combinator":"and","conditions":[{"questionKey":"5gxcji0FdHI3","operator":"gt","value":3}]}},{"id":"vflWvpakGG43","required":true,"key":"y2btI2h5gm9w","type":"multiple_choice","title":"Bolehkah kami menghubungi Anda terkait jawaban ini?","options":[{"id":"yes","label":"Ya"},{"id":"no","label":"Tidak"}]},{"id":"H4egjbnOFOlD","required":true,"key":"O6CAnLt8i4vZ","type":"phone","title":"Nomor telepon","showIf":{"combinator":"and","conditions":[{"questionKey":"y2btI2h5gm9w","operator":"equals","value":"yes"}]}}]}]}$json$::jsonb);
  perform pg_temp.dummy_responses(v_closed, 30, 30);
  update public.forms
  set status = 'closed', deadline_at = now() - interval '3 days',
      closed_message = 'Survei ini sudah ditutup. Terima kasih!'
  where id = v_closed;

  -- 5. Archived form, 15 responses. Owner: editor2 (hidden unless filtered by status).
  v_archived := pg_temp.dummy_form('dummy-arsip-2025', 'Umpan Balik Tahunan 2025 (arsip)',
    'Data dummy: formulir yang diarsipkan.', v_editor2,
    $json${"schemaVersion":1,"sections":[{"id":"z2PisDk1awEs","title":"Peran Anda","questions":[{"id":"pKVM9WEab0jA","required":true,"key":"QJDRiIYFB9a7","type":"dropdown","title":"Departemen","options":[{"id":"engineering","label":"Teknik"},{"id":"sales","label":"Penjualan"},{"id":"operations","label":"Operasional"},{"id":"hr","label":"SDM"},{"id":"finance","label":"Keuangan"}]},{"id":"xOiTqBDNEptE","required":true,"key":"EPzj1DOimFyb","type":"multiple_choice","title":"Sudah berapa lama Anda bekerja di sini?","options":[{"id":"lt1","label":"Kurang dari 1 tahun"},{"id":"1to3","label":"1–3 tahun"},{"id":"3to5","label":"3–5 tahun"},{"id":"gt5","label":"Lebih dari 5 tahun"}]}]},{"id":"Be5adrBNx0bY","title":"Umpan balik Anda","questions":[{"id":"THUseaYrXpi6","required":true,"key":"cyHK47Yl0KDc","type":"linear_scale","title":"Seberapa puas Anda dengan pekerjaan Anda?","scale":{"min":1,"max":5,"minLabel":"Sangat tidak puas","maxLabel":"Sangat puas"}},{"id":"KrHXOmlU9tjJ","required":true,"key":"SvpfpkOvi3RU","type":"rating","title":"Nilai dukungan dari atasan Anda","rating":{"max":5}},{"id":"pCVqexb9Nbpx","required":false,"key":"I9HzRYQq0HF0","type":"checkboxes","title":"Apa yang membantu keseimbangan kerja Anda?","options":[{"id":"remote","label":"Kerja jarak jauh"},{"id":"flexible","label":"Jam kerja fleksibel"},{"id":"leave","label":"Cuti berbayar"},{"id":"wellness","label":"Program kesehatan"}],"allowOther":true},{"id":"eIGeG26Vscrf","required":true,"key":"VGpkOXTses8Q","type":"multiple_choice","title":"Apakah Anda akan merekomendasikan perusahaan ini sebagai tempat kerja?","options":[{"id":"yes","label":"Ya"},{"id":"maybe","label":"Mungkin"},{"id":"no","label":"Tidak"}]},{"id":"X15XWihN08V1","required":true,"key":"nvKpZLJuMHmw","type":"paragraph","title":"Apa hal utama yang perlu kami ubah?","showIf":{"combinator":"or","conditions":[{"questionKey":"cyHK47Yl0KDc","operator":"lt","value":3},{"questionKey":"SvpfpkOvi3RU","operator":"lt","value":3},{"questionKey":"VGpkOXTses8Q","operator":"equals","value":"no"}]}},{"id":"tz4TChe36NpG","required":false,"key":"jwFbNEf6DW0G","type":"paragraph","title":"Ada ide lain?"}]}]}$json$::jsonb);
  perform pg_temp.dummy_responses(v_archived, 15, 90);
  update public.forms set status = 'archived' where id = v_archived;

  -- 6. Draft, never published. Owner: editor.
  v_draft := pg_temp.dummy_form('dummy-draf-baru', 'Formulir Draf (belum terbit)',
    null, v_editor, $json${"schemaVersion":1,"sections":[{"id":"yG8dM4FMwDHL","title":"Bagian 1","questions":[{"id":"zdan3f23qfyC","required":false,"key":"OiHQrKQoCHCy","type":"short_text","title":"Pertanyaan tanpa judul"}]}]}$json$::jsonb, false);

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
