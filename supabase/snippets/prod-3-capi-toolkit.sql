-- =============================================================================
-- LANGKAH 3: CAPI toolkit (wawancara, kuota, screen-out, QC, foto)
-- Isi: 20261021090100_capi_toolkit.sql.
-- Jalankan setelah langkah 2 selesai. Satu transaksi: kalau error, tidak ada yang berubah.
-- Aman diulang: kolom, tabel dan indeks yang sudah ada dilewati, fungsi diganti.
-- Setelah ini deploy kode aplikasi terbaru (fungsi submit_response dan
-- export_responses berganti parameter).
-- =============================================================================

begin;

-- =============================================================================
-- CAPI toolkit: face-to-face interviews with quotas, screen-outs, surveyor
-- attribution, respondent IDs, photos and QC (BRI UMKM questionnaire).
--
-- * Advanced question types are flattened for analysis by
--   _analysis_questions (mirror of src/lib/forms/analysis.ts): grid rows and
--   ranking positions become ordinary choice questions, so dashboards, the
--   chart builder and exports work unchanged.
-- * Screen-outs live in response_screenouts and QC-rejected interviews in
--   response_archive: neither ever reaches the analytics tables.
-- * Every function: SECURITY DEFINER where it reads protected tables,
--   search_path = '', explicit permission checks, minimal grants.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permissions: surveyors fill interviews only
-- -----------------------------------------------------------------------------

-- Viewable by: admin, owner, or a non-surveyor form member. Surveyor
-- assignments never open dashboards or responses.
create or replace function public.can_view_form(p_form_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.forms f
    join public.profiles p
      on p.id = (select auth.uid()) and p.is_active and p.workspace_id = f.workspace_id
    where f.id = p_form_id
      and (
        p.role = 'admin'
        or f.owner_id = p.id
        or exists (
          select 1 from public.form_members m
          where m.form_id = f.id and m.user_id = p.id and m.role <> 'surveyor'
        )
      )
  );
$$;

-- Editable by: admin, owner, or an editor-role account with an editor
-- membership. Viewer and surveyor accounts are never editors.
create or replace function public.can_edit_form(p_form_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.forms f
    join public.profiles p
      on p.id = (select auth.uid()) and p.is_active and p.workspace_id = f.workspace_id
    where f.id = p_form_id
      and (
        p.role = 'admin'
        or f.owner_id = p.id
        or (
          p.role = 'editor'
          and exists (
            select 1 from public.form_members m
            where m.form_id = f.id and m.user_id = p.id and m.role = 'editor'
          )
        )
      )
  );
$$;

-- May run interviews: admin, owner, editors of the form and assigned surveyors.
create or replace function public.can_interview(p_form_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_edit_form(p_form_id) or exists (
    select 1
    from public.forms f
    join public.profiles p
      on p.id = (select auth.uid()) and p.is_active and p.workspace_id = f.workspace_id
    join public.form_members m on m.form_id = f.id and m.user_id = p.id
    where f.id = p_form_id and m.role in ('surveyor', 'editor')
  );
$$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

-- CAPI settings (not versioned): mode, dimensions, quota, respondent ID, QC.
-- Shape validated by src/lib/forms/capi.ts.
alter table public.forms
  add column if not exists capi_settings jsonb not null default '{}'::jsonb;

alter table public.responses
  add column if not exists surveyor_id uuid references public.profiles (id) on delete set null,
  add column if not exists respondent_code text,
  add column if not exists quota_cell text,
  add column if not exists is_reserve boolean not null default false,
  add column if not exists notes jsonb not null default '{}'::jsonb,
  add column if not exists qc_status text not null default 'pending'
    check (qc_status in ('pending', 'approved', 'backcheck')),
  add column if not exists qc_flags text[] not null default '{}',
  add column if not exists qc_note text check (qc_note is null or char_length(qc_note) <= 2000),
  add column if not exists qc_reviewed_by uuid references public.profiles (id) on delete set null,
  add column if not exists qc_reviewed_at timestamptz,
  add column if not exists backcheck_at timestamptz;

create unique index if not exists responses_form_respondent_code_uidx
  on public.responses (form_id, respondent_code) where respondent_code is not null;
create index if not exists responses_form_quota_cell_idx
  on public.responses (form_id, quota_cell) where quota_cell is not null;
create index if not exists responses_form_surveyor_idx
  on public.responses (form_id, surveyor_id) where surveyor_id is not null;

-- Monotonic respondent ID sequence per form and quota cell (never reused).
create table if not exists public.interview_sequences (
  form_id uuid not null references public.forms (id) on delete cascade,
  prefix text not null check (char_length(prefix) between 1 and 60),
  last_seq integer not null default 0,
  primary key (form_id, prefix)
);

-- Photos (resized JPEG, <= 3 MB). Survive QC rejection (set null) so a
-- restored interview gets them back.
create table if not exists public.response_photos (
  id uuid primary key,
  form_id uuid not null references public.forms (id) on delete cascade,
  response_id uuid references public.responses (id) on delete set null,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  data bytea not null check (octet_length(data) <= 3 * 1024 * 1024),
  created_at timestamptz not null default now()
);
create index if not exists response_photos_form_idx on public.response_photos (form_id);
create index if not exists response_photos_response_idx on public.response_photos (response_id);

-- Interviews that ended in screening (or on a full quota cell).
create table if not exists public.response_screenouts (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  form_version_id uuid not null,
  submission_token uuid not null unique,
  surveyor_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('rule', 'quota')),
  question_key text check (question_key is null or char_length(question_key) <= 64),
  question_code text check (question_code is null or char_length(question_code) <= 20),
  reason text check (reason is null or char_length(reason) <= 300),
  quota_cell text,
  answers jsonb not null default '{}'::jsonb,
  notes jsonb not null default '{}'::jsonb,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  device text,
  locale text,
  submitted_at timestamptz not null default now(),
  constraint response_screenouts_version_fk
    foreign key (form_version_id, form_id) references public.form_versions (id, form_id)
);
create index if not exists response_screenouts_form_idx on public.response_screenouts (form_id, submitted_at);

-- QC-rejected interviews (out of dashboards and quota counts, restorable).
create table if not exists public.response_archive (
  id uuid primary key,
  form_id uuid not null references public.forms (id) on delete cascade,
  response jsonb not null,
  answers jsonb not null,
  reason text check (reason is null or char_length(reason) <= 2000),
  archived_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz not null default now()
);
create index if not exists response_archive_form_idx on public.response_archive (form_id, archived_at);

alter table public.interview_sequences enable row level security;
alter table public.response_photos enable row level security;
alter table public.response_screenouts enable row level security;
alter table public.response_archive enable row level security;
-- No policies: read and written only through the functions below.
revoke all on table public.interview_sequences from public, anon, authenticated;
revoke all on table public.response_photos from public, anon, authenticated;
revoke all on table public.response_screenouts from public, anon, authenticated;
revoke all on table public.response_archive from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Analysis questions (keep in step with src/lib/forms/analysis.ts)
-- -----------------------------------------------------------------------------
create or replace function public._analysis_questions(p_q jsonb, p_def jsonb)
returns setof jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_type text := p_q ->> 'type';
  v_rows jsonb;
  v_row jsonb;
  v_i integer;
  v_max integer;
  v_source text;
begin
  if v_type = 'grid' then
    v_source := p_q -> 'grid' ->> 'rowsFrom';
    if v_source is not null then
      select q -> 'options' into v_rows
      from jsonb_path_query(p_def, '$.sections[*].questions[*]') as s(q)
      where q ->> 'key' = v_source
      limit 1;
    else
      v_rows := p_q -> 'grid' -> 'rows';
    end if;
    for v_row, v_i in
      select x.r, x.n::integer from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) with ordinality as x(r, n)
    loop
      return next jsonb_strip_nulls(jsonb_build_object(
        'id', (p_q ->> 'id') || '__' || (v_row ->> 'id'),
        'key', (p_q ->> 'key') || '__' || (v_row ->> 'id'),
        'type', case when coalesce((p_q -> 'grid' ->> 'multiple')::boolean, false)
                     then 'checkboxes' else 'multiple_choice' end,
        'title', (p_q ->> 'title') || ' — ' || (v_row ->> 'label'),
        'required', coalesce(p_q -> 'required', 'false'::jsonb),
        'options', coalesce(p_q -> 'options', '[]'::jsonb),
        'code', case when p_q ->> 'code' is not null
                     then (p_q ->> 'code') || '.' || coalesce(nullif(v_row ->> 'code', ''), v_i::text) end
      ));
    end loop;
    return;
  end if;

  if v_type = 'ranking' then
    v_max := coalesce((p_q -> 'ranking' ->> 'max')::integer, 1);
    return next jsonb_strip_nulls(jsonb_build_object(
      'id', p_q ->> 'id',
      'key', p_q ->> 'key',
      'type', 'checkboxes',
      'title', p_q ->> 'title',
      'required', coalesce(p_q -> 'required', 'false'::jsonb),
      'options', coalesce(p_q -> 'options', '[]'::jsonb),
      'code', p_q ->> 'code',
      'allowOther', p_q -> 'allowOther'
    ));
    for v_rank in 1 .. v_max loop
      return next jsonb_strip_nulls(jsonb_build_object(
        'id', (p_q ->> 'id') || '__r' || v_rank,
        'key', (p_q ->> 'key') || '__r' || v_rank,
        'type', 'multiple_choice',
        'title', (p_q ->> 'title') || ' (#' || v_rank || ')',
        'required', coalesce(p_q -> 'required', 'false'::jsonb),
        'options', coalesce(p_q -> 'options', '[]'::jsonb),
        'code', case when p_q ->> 'code' is not null then (p_q ->> 'code') || '_' || v_rank end,
        'allowOther', p_q -> 'allowOther'
      ));
    end loop;
    return;
  end if;

  -- Location and photo answers are not analysed (exports and the drawer only).
  if v_type in ('location', 'photo') then
    return;
  end if;
  return next p_q;
end;
$$;

create or replace function public._form_question_index(p_form_id uuid)
returns table (key text, meta jsonb, version_ids uuid[], version_numbers integer[], in_current boolean, ord integer)
language sql
stable
set search_path = ''
as $$
  with qs as (
    select x.aq ->> 'key' as key, x.aq as q, v.id as version_id, v.version_number,
           (v.id = f.current_version_id) as is_current, (j.ord * 100 + x.sub)::integer as ord
    from public.forms f
    join public.form_versions v on v.form_id = f.id
    cross join lateral jsonb_path_query(v.definition, '$.sections[*].questions[*]') with ordinality as j(q, ord)
    cross join lateral public._analysis_questions(j.q, v.definition) with ordinality as x(aq, sub)
    where f.id = p_form_id
  )
  select key,
         (array_agg(q order by version_number desc))[1],
         array_agg(version_id order by version_number),
         array_agg(version_number order by version_number),
         bool_or(is_current),
         coalesce(min(ord) filter (where is_current), 10000000 + min(ord))::integer
  from qs
  group by key;
$$;

-- -----------------------------------------------------------------------------
-- Submission (public forms and interviews)
-- -----------------------------------------------------------------------------
drop function if exists public.submit_response(uuid, uuid, uuid, jsonb, text, text, text, integer, text, text, uuid);

create or replace function public.submit_response(
  p_form_id uuid,
  p_version_id uuid,
  p_submission_token uuid,
  p_answers jsonb,
  p_identifier_email text default null,
  p_identifier_phone text default null,
  p_identifier_key text default null,
  p_duration_seconds integer default null,
  p_locale text default null,
  p_device text default null,
  p_draft_token uuid default null,
  -- Interviews (CAPI)
  p_surveyor_id uuid default null,
  p_notes jsonb default null,
  p_quota_cell text default null,
  p_quota_target integer default null,
  p_quota_reserve integer default null,
  p_id_digits integer default null,
  p_qc_flags text[] default null,
  p_photos jsonb default null,
  -- Seeding sample data only (the API never passes it).
  p_submitted_at timestamptz default null
)
returns table (response_id uuid, replayed boolean, respondent_code text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_form public.forms%rowtype;
  v_response_id uuid;
  v_constraint text;
  v_count integer;
  v_seq integer;
  v_code text;
begin
  if p_submission_token is null then
    raise exception 'INVALID_ANSWERS' using errcode = 'P0001';
  end if;

  -- Idempotent replay.
  select r.id, r.respondent_code into v_response_id, v_code
  from public.responses r
  where r.submission_token = p_submission_token and r.form_id = p_form_id;
  if found then
    return query select v_response_id, true, v_code;
    return;
  end if;

  select * into v_form from public.forms f where f.id = p_form_id;
  if not found then
    raise exception 'FORM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_form.status <> 'published' or (v_form.deadline_at is not null and now() > v_form.deadline_at) then
    raise exception 'FORM_CLOSED' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.form_versions v where v.id = p_version_id and v.form_id = p_form_id
  ) then
    raise exception 'INVALID_VERSION' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers) > 3000 then
    raise exception 'INVALID_ANSWERS' using errcode = 'P0001';
  end if;
  if p_notes is not null and (jsonb_typeof(p_notes) <> 'object' or octet_length(p_notes::text) > 200000) then
    raise exception 'INVALID_ANSWERS' using errcode = 'P0001';
  end if;

  if v_form.identifier_mode <> 'none' then
    if p_identifier_key is null then
      raise exception 'IDENTIFIER_REQUIRED' using errcode = 'P0001';
    end if;
    -- Serialize identifier checks per form so the email/phone cross-check is race free.
    perform pg_advisory_xact_lock(hashtextextended('formpulse:submit:' || p_form_id::text, 0));
    if exists (
      select 1 from public.responses r
      where r.form_id = p_form_id
        and r.is_demo = false
        and (
          r.identifier_key = p_identifier_key
          or (p_identifier_email is not null and r.identifier_email = p_identifier_email)
          or (p_identifier_phone is not null and r.identifier_phone = p_identifier_phone)
          or (p_identifier_phone is not null and r.identifier_key = p_identifier_phone)
          or (p_identifier_email is not null and r.identifier_key = p_identifier_email)
        )
    ) then
      raise exception 'ALREADY_SUBMITTED' using errcode = 'P0001';
    end if;
  end if;

  -- Quota per cell (city x sector x segment): serialized per cell.
  if p_quota_cell is not null then
    if p_quota_cell !~ '^[A-Za-z0-9_-]{1,60}$' then
      raise exception 'INVALID_ANSWERS' using errcode = 'P0001';
    end if;
    perform pg_advisory_xact_lock(
      hashtextextended('formpulse:quota:' || p_form_id::text || ':' || p_quota_cell, 0));
    if p_quota_target is not null then
      select count(*) into v_count
      from public.responses r
      where r.form_id = p_form_id and r.quota_cell = p_quota_cell;
      if v_count >= p_quota_target + coalesce(p_quota_reserve, 0) then
        raise exception 'QUOTA_FULL' using errcode = 'P0001';
      end if;
    end if;
    if p_id_digits is not null then
      insert into public.interview_sequences as s (form_id, prefix, last_seq)
      values (p_form_id, p_quota_cell, 1)
      on conflict (form_id, prefix) do update set last_seq = s.last_seq + 1
      returning s.last_seq into v_seq;
      v_code := p_quota_cell || '-' || lpad(v_seq::text, greatest(least(p_id_digits, 6), 1), '0');
    end if;
  end if;

  begin
    insert into public.responses (
      form_id, form_version_id, identifier_email, identifier_phone, identifier_key,
      duration_seconds, locale, device, submission_token, submitted_at,
      surveyor_id, respondent_code, quota_cell, is_reserve, notes, qc_flags
    )
    values (
      p_form_id, p_version_id, p_identifier_email, p_identifier_phone,
      case when v_form.identifier_mode = 'none' then null else p_identifier_key end,
      p_duration_seconds, left(p_locale, 10), left(p_device, 20), p_submission_token,
      coalesce(p_submitted_at, now()),
      p_surveyor_id, v_code, p_quota_cell,
      coalesce(p_quota_target is not null and v_count >= p_quota_target, false),
      coalesce(p_notes, '{}'::jsonb), coalesce(p_qc_flags, '{}'::text[])
    )
    returning id into v_response_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'responses_submission_token_key' then
      select r.id, r.respondent_code into v_response_id, v_code
      from public.responses r where r.submission_token = p_submission_token;
      return query select v_response_id, true, v_code;
      return;
    end if;
    raise exception 'ALREADY_SUBMITTED' using errcode = 'P0001';
  end;

  insert into public.response_answers (
    response_id, form_id, question_key, question_type,
    value_text, value_number, value_date, value_options, value_json
  )
  select v_response_id, p_form_id, a.question_key, a.question_type,
         a.value_text, a.value_number, a.value_date, a.value_options, a.value_json
  from jsonb_to_recordset(p_answers) as a(
    question_key text,
    question_type text,
    value_text text,
    value_number numeric,
    value_date timestamptz,
    value_options text[],
    value_json jsonb
  );

  if exists (
    select 1 from public.response_answers ra
    where ra.response_id = v_response_id
      and (ra.question_key is null
           or char_length(ra.question_key) > 64
           or ra.question_type not in ('short_text', 'paragraph', 'multiple_choice', 'checkboxes',
                                       'dropdown', 'number', 'date', 'rating', 'linear_scale',
                                       'email', 'phone', 'location', 'photo')
           or char_length(ra.value_text) > 5000
           or octet_length(ra.value_json::text) > 1000)
  ) then
    raise exception 'INVALID_ANSWERS' using errcode = 'P0001';
  end if;

  if p_photos is not null and jsonb_typeof(p_photos) = 'array' then
    insert into public.response_photos (id, form_id, response_id, mime, data)
    select (e ->> 'id')::uuid, p_form_id, v_response_id, e ->> 'mime', decode(e ->> 'data', 'base64')
    from jsonb_array_elements(p_photos) e;
  end if;

  if p_draft_token is not null then
    delete from public.response_drafts d where d.draft_token = p_draft_token and d.form_id = p_form_id;
  end if;

  return query select v_response_id, false, v_code;
end;
$$;

-- A screen-out (screening rule or full quota cell). Idempotent per token.
create or replace function public.record_screenout(
  p_form_id uuid,
  p_version_id uuid,
  p_submission_token uuid,
  p_kind text,
  p_question_key text default null,
  p_question_code text default null,
  p_reason text default null,
  p_answers jsonb default null,
  p_notes jsonb default null,
  p_surveyor_id uuid default null,
  p_quota_cell text default null,
  p_duration_seconds integer default null,
  p_locale text default null,
  p_device text default null,
  p_submitted_at timestamptz default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select s.id into v_id from public.response_screenouts s
  where s.submission_token = p_submission_token and s.form_id = p_form_id;
  if found then
    return v_id;
  end if;
  if not exists (
    select 1 from public.form_versions v where v.id = p_version_id and v.form_id = p_form_id
  ) then
    raise exception 'INVALID_VERSION' using errcode = 'P0001';
  end if;
  if octet_length(coalesce(p_answers, '{}'::jsonb)::text) > 200000
     or octet_length(coalesce(p_notes, '{}'::jsonb)::text) > 200000 then
    raise exception 'INVALID_ANSWERS' using errcode = 'P0001';
  end if;
  insert into public.response_screenouts (
    form_id, form_version_id, submission_token, surveyor_id, kind, question_key, question_code,
    reason, quota_cell, answers, notes, duration_seconds, device, locale, submitted_at
  ) values (
    p_form_id, p_version_id, p_submission_token, p_surveyor_id, p_kind, left(p_question_key, 64),
    left(p_question_code, 20), left(p_reason, 300), left(p_quota_cell, 60),
    coalesce(p_answers, '{}'::jsonb), coalesce(p_notes, '{}'::jsonb), p_duration_seconds,
    left(p_device, 20), left(p_locale, 10), coalesce(p_submitted_at, now())
  )
  on conflict (submission_token) do nothing
  returning id into v_id;
  if v_id is null then
    select s.id into v_id from public.response_screenouts s where s.submission_token = p_submission_token;
  end if;
  return v_id;
end;
$$;

-- Interviews counted in a quota cell (rejected ones are archived, not counted).
create or replace function public.quota_count(p_form_id uuid, p_cell text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.responses r
  where r.form_id = p_form_id and r.quota_cell = p_cell;
$$;

-- -----------------------------------------------------------------------------
-- Interviewer view
-- -----------------------------------------------------------------------------
create or replace function public.list_interview_forms()
returns table (
  id uuid,
  title text,
  status public.form_status,
  my_today integer,
  my_total integer,
  my_screenouts integer,
  total integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.title, f.status,
         (select count(*)::integer from public.responses r
          where r.form_id = f.id and r.surveyor_id = (select auth.uid())
            and (r.submitted_at at time zone 'Asia/Jakarta')::date = (now() at time zone 'Asia/Jakarta')::date),
         (select count(*)::integer from public.responses r
          where r.form_id = f.id and r.surveyor_id = (select auth.uid())),
         (select count(*)::integer from public.response_screenouts s
          where s.form_id = f.id and s.surveyor_id = (select auth.uid())),
         (select count(*)::integer from public.responses r where r.form_id = f.id)
  from public.forms f
  where coalesce((f.capi_settings ->> 'enabled')::boolean, false)
    and f.status in ('published', 'closed')
    and f.current_version_id is not null
    and public.can_interview(f.id)
  order by f.updated_at desc;
$$;

-- -----------------------------------------------------------------------------
-- QC (editors and admins)
-- -----------------------------------------------------------------------------
create or replace function public._assert_can_edit(p_form_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not public.can_edit_form(p_form_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.qc_overview(p_form_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._assert_can_edit(p_form_id);
  return jsonb_build_object(
    'cells', coalesce((
      select jsonb_agg(jsonb_build_object('cell', c.quota_cell, 'count', c.n, 'reserve', c.reserve) order by c.quota_cell)
      from (select r.quota_cell, count(*) as n, count(*) filter (where r.is_reserve) as reserve
            from public.responses r where r.form_id = p_form_id and r.quota_cell is not null
            group by r.quota_cell) c), '[]'::jsonb),
    'total', (select count(*) from public.responses r where r.form_id = p_form_id),
    'statuses', coalesce((
      select jsonb_object_agg(s.qc_status, s.n)
      from (select r.qc_status, count(*) as n from public.responses r
            where r.form_id = p_form_id group by r.qc_status) s), '{}'::jsonb),
    'flagged', (select count(*) from public.responses r
                where r.form_id = p_form_id and cardinality(r.qc_flags) > 0),
    'flags', coalesce((
      select jsonb_object_agg(x.flag, x.n)
      from (select f as flag, count(*) as n from public.responses r, unnest(r.qc_flags) f
            where r.form_id = p_form_id group by f) x), '{}'::jsonb),
    'rejected', (select count(*) from public.response_archive a where a.form_id = p_form_id),
    'screenouts', coalesce((
      select jsonb_agg(jsonb_build_object('kind', s.kind, 'code', s.question_code, 'key', s.question_key, 'count', s.n)
                       order by s.n desc)
      from (select so.kind, so.question_code, so.question_key, count(*) as n
            from public.response_screenouts so where so.form_id = p_form_id
            group by so.kind, so.question_code, so.question_key) s), '[]'::jsonb),
    'surveyors', coalesce((
      select jsonb_agg(x order by x ->> 'name')
      from (
        select jsonb_build_object(
          'id', u.sid,
          'name', coalesce(p.full_name, p.email, '—'),
          'complete', (select count(*) from public.responses r where r.form_id = p_form_id and r.surveyor_id is not distinct from u.sid),
          'screenouts', (select count(*) from public.response_screenouts s where s.form_id = p_form_id and s.surveyor_id is not distinct from u.sid),
          'rejected', (select count(*) from public.response_archive a where a.form_id = p_form_id
                       and (a.response ->> 'surveyor_id') is not distinct from u.sid::text),
          'avg_minutes', (select round(avg(r.duration_seconds) / 60.0, 1) from public.responses r
                          where r.form_id = p_form_id and r.surveyor_id is not distinct from u.sid),
          'flagged', (select count(*) from public.responses r where r.form_id = p_form_id
                      and r.surveyor_id is not distinct from u.sid and cardinality(r.qc_flags) > 0),
          'backcheck', (select count(*) from public.responses r where r.form_id = p_form_id
                        and r.surveyor_id is not distinct from u.sid and r.backcheck_at is not null),
          'backcheck_done', (select count(*) from public.responses r where r.form_id = p_form_id
                             and r.surveyor_id is not distinct from u.sid and r.backcheck_at is not null
                             and r.qc_status = 'approved')
        ) as x
        from (
          select distinct r.surveyor_id as sid from public.responses r where r.form_id = p_form_id
          union
          select distinct s.surveyor_id from public.response_screenouts s where s.form_id = p_form_id
        ) u
        left join public.profiles p on p.id = u.sid
      ) y), '[]'::jsonb)
  );
end;
$$;

-- Interviews for QC review. p_view: all | flagged | backcheck | approved | rejected.
create or replace function public.qc_list(
  p_form_id uuid,
  p_view text default 'all',
  p_surveyor_id uuid default null,
  p_offset integer default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform public._assert_can_edit(p_form_id);
  if p_view = 'rejected' then
    return jsonb_build_object(
      'total', (select count(*) from public.response_archive a where a.form_id = p_form_id
                and (p_surveyor_id is null or (a.response ->> 'surveyor_id') = p_surveyor_id::text)),
      'rows', coalesce((
        select jsonb_agg(x order by x ->> 'archived_at' desc)
        from (
          select jsonb_build_object(
            'id', a.id,
            'respondent_code', a.response ->> 'respondent_code',
            'quota_cell', a.response ->> 'quota_cell',
            'submitted_at', a.response ->> 'submitted_at',
            'duration_seconds', (a.response ->> 'duration_seconds')::integer,
            'surveyor', (select coalesce(p.full_name, p.email) from public.profiles p
                         where p.id::text = a.response ->> 'surveyor_id'),
            'qc_flags', a.response -> 'qc_flags',
            'qc_status', 'rejected',
            'reason', a.reason,
            'archived_at', a.archived_at
          ) as x
          from public.response_archive a
          where a.form_id = p_form_id
            and (p_surveyor_id is null or (a.response ->> 'surveyor_id') = p_surveyor_id::text)
          order by a.archived_at desc
          offset v_offset limit v_limit
        ) y), '[]'::jsonb)
    );
  end if;

  return jsonb_build_object(
    'total', (
      select count(*) from public.responses r
      where r.form_id = p_form_id
        and (p_surveyor_id is null or r.surveyor_id = p_surveyor_id)
        and (p_view = 'all'
             or (p_view = 'flagged' and cardinality(r.qc_flags) > 0)
             or (p_view = 'backcheck' and r.backcheck_at is not null)
             or (p_view = 'approved' and r.qc_status = 'approved'))),
    'rows', coalesce((
      select jsonb_agg(x order by ord)
      from (
        select row_number() over (order by r.submitted_at desc, r.id) as ord,
               jsonb_build_object(
                 'id', r.id,
                 'respondent_code', r.respondent_code,
                 'quota_cell', r.quota_cell,
                 'is_reserve', r.is_reserve,
                 'submitted_at', r.submitted_at,
                 'duration_seconds', r.duration_seconds,
                 'surveyor', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = r.surveyor_id),
                 'qc_status', r.qc_status,
                 'qc_flags', to_jsonb(r.qc_flags),
                 'qc_note', r.qc_note,
                 'backcheck_at', r.backcheck_at,
                 -- Phone answers for the backcheck call (editors only).
                 'phone', (select ra.value_text from public.response_answers ra
                           where ra.response_id = r.id and ra.question_type = 'phone'
                           order by ra.id limit 1)
               ) as x
        from public.responses r
        where r.form_id = p_form_id
          and (p_surveyor_id is null or r.surveyor_id = p_surveyor_id)
          and (p_view = 'all'
               or (p_view = 'flagged' and cardinality(r.qc_flags) > 0)
               or (p_view = 'backcheck' and r.backcheck_at is not null)
               or (p_view = 'approved' and r.qc_status = 'approved'))
        order by r.submitted_at desc, r.id
        offset v_offset limit v_limit
      ) y), '[]'::jsonb)
  );
end;
$$;

-- Picks a random backcheck sample: at least p_percent % of each surveyor's
-- interviews (rounded up), only from those not yet sampled and still pending.
create or replace function public.qc_select_backcheck(p_form_id uuid, p_percent integer default 20)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform public._assert_can_edit(p_form_id);
  with per as (
    select r.surveyor_id,
           ceil(count(*) * least(greatest(coalesce(p_percent, 20), 1), 100) / 100.0)::integer as need,
           count(*) filter (where r.backcheck_at is not null) as have
    from public.responses r
    where r.form_id = p_form_id
    group by r.surveyor_id
  ),
  pick as (
    select c.id
    from per
    cross join lateral (
      select r.id from public.responses r
      where r.form_id = p_form_id
        and r.surveyor_id is not distinct from per.surveyor_id
        and r.backcheck_at is null and r.qc_status = 'pending'
      order by random()
      limit greatest(per.need - per.have, 0)
    ) c
  )
  update public.responses r
  set backcheck_at = now(), qc_status = 'backcheck'
  from pick where r.id = pick.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.qc_set_status(p_response_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_form uuid;
begin
  select r.form_id into v_form from public.responses r where r.id = p_response_id;
  if v_form is null then
    raise exception 'response not found' using errcode = 'P0002';
  end if;
  perform public._assert_can_edit(v_form);
  if p_status not in ('pending', 'approved', 'backcheck') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  update public.responses r
  set qc_status = p_status,
      qc_note = coalesce(nullif(trim(p_note), ''), r.qc_note),
      qc_reviewed_by = (select auth.uid()),
      qc_reviewed_at = now(),
      backcheck_at = case when p_status = 'backcheck' then coalesce(r.backcheck_at, now()) else r.backcheck_at end
  where r.id = p_response_id;
end;
$$;

-- Rejects an interview: snapshot into the archive, then delete it (the
-- delete trigger rebuilds the dashboard summaries; the quota cell frees up).
create or replace function public.qc_reject(p_response_id uuid, p_reason text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_r public.responses%rowtype;
begin
  select * into v_r from public.responses r where r.id = p_response_id;
  if not found then
    raise exception 'response not found' using errcode = 'P0002';
  end if;
  perform public._assert_can_edit(v_r.form_id);
  insert into public.response_archive (id, form_id, response, answers, reason, archived_by)
  values (
    v_r.id, v_r.form_id, to_jsonb(v_r),
    coalesce((select jsonb_agg(to_jsonb(ra) - 'id' order by ra.id)
              from public.response_answers ra where ra.response_id = v_r.id), '[]'::jsonb),
    left(nullif(trim(p_reason), ''), 2000), (select auth.uid())
  );
  delete from public.responses r where r.id = v_r.id;
end;
$$;

-- Restores an archived interview with its id, answers and photos.
create or replace function public.qc_restore(p_archive_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_a public.response_archive%rowtype;
begin
  select * into v_a from public.response_archive a where a.id = p_archive_id;
  if not found then
    raise exception 'archive not found' using errcode = 'P0002';
  end if;
  perform public._assert_can_edit(v_a.form_id);
  insert into public.responses
  select * from jsonb_populate_record(null::public.responses, v_a.response);
  insert into public.response_answers (
    response_id, form_id, question_key, question_type,
    value_text, value_number, value_date, value_options, value_json
  )
  select a.response_id, a.form_id, a.question_key, a.question_type,
         a.value_text, a.value_number, a.value_date, a.value_options, a.value_json
  from jsonb_populate_recordset(null::public.response_answers, v_a.answers) a;
  update public.response_photos p set response_id = v_a.id
  where p.form_id = v_a.form_id and p.response_id is null
    and p.id::text in (
      select ans -> 'value_json' ->> 'photoId' from jsonb_array_elements(v_a.answers) ans
      where ans ->> 'question_type' = 'photo');
  delete from public.response_archive a where a.id = p_archive_id;
end;
$$;

create or replace function public.list_screenouts(
  p_form_id uuid,
  p_offset integer default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._assert_can_edit(p_form_id);
  return jsonb_build_object(
    'total', (select count(*) from public.response_screenouts s where s.form_id = p_form_id),
    'rows', coalesce((
      select jsonb_agg(x order by ord)
      from (
        select row_number() over (order by s.submitted_at desc, s.id) as ord,
               jsonb_build_object(
                 'id', s.id, 'kind', s.kind, 'code', s.question_code, 'key', s.question_key,
                 'reason', s.reason, 'quota_cell', s.quota_cell, 'submitted_at', s.submitted_at,
                 'duration_seconds', s.duration_seconds,
                 'surveyor', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = s.surveyor_id),
                 'answers', s.answers, 'notes', s.notes
               ) as x
        from public.response_screenouts s
        where s.form_id = p_form_id
        order by s.submitted_at desc, s.id
        offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 50), 1), 500)
      ) y), '[]'::jsonb)
  );
end;
$$;

-- Photo bytes for someone who can view the form (or the secret key).
create or replace function public.get_response_photo(p_photo_id uuid)
returns table (mime text, data bytea)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_form uuid;
begin
  select p.form_id into v_form from public.response_photos p where p.id = p_photo_id;
  if v_form is null then
    raise exception 'photo not found' using errcode = 'P0002';
  end if;
  perform public._assert_can_view(v_form);
  return query select p.mime, p.data from public.response_photos p where p.id = p_photo_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Response detail and list: interview fields
-- -----------------------------------------------------------------------------
create or replace function public.get_response(p_response_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_r public.responses%rowtype;
  v_full boolean;
begin
  select * into v_r from public.responses r where r.id = p_response_id;
  if not found then
    raise exception 'response not found' using errcode = 'P0002';
  end if;
  perform public._assert_can_view(v_r.form_id);
  v_full := public._can_see_identifiers(v_r.form_id);
  return jsonb_build_object(
    'id', v_r.id,
    'form_id', v_r.form_id,
    'form_version_id', v_r.form_version_id,
    'version_number', (select version_number from public.form_versions where id = v_r.form_version_id),
    'submitted_at', v_r.submitted_at,
    'duration_seconds', v_r.duration_seconds,
    'device', v_r.device,
    'locale', v_r.locale,
    'is_demo', v_r.is_demo,
    'identifier_email', case when v_full then v_r.identifier_email else public.mask_email(v_r.identifier_email) end,
    'identifier_phone', case when v_full then v_r.identifier_phone else public.mask_phone(v_r.identifier_phone) end,
    'identifiers_masked', not v_full,
    'respondent_code', v_r.respondent_code,
    'quota_cell', v_r.quota_cell,
    'is_reserve', v_r.is_reserve,
    'surveyor', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = v_r.surveyor_id),
    'qc_status', v_r.qc_status,
    'qc_flags', to_jsonb(v_r.qc_flags),
    'qc_note', v_r.qc_note,
    'notes', v_r.notes,
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'question_key', ra.question_key, 'question_type', ra.question_type,
               'value_text', public._answer_text(ra.question_type, ra.value_text, v_full), 'value_number', ra.value_number,
               'value_date', to_char(ra.value_date at time zone 'UTC', 'YYYY-MM-DD'),
               'value_options', ra.value_options,
               -- Locations are personal data: viewers see them rounded (~1 km).
               'value_json', case when ra.question_type = 'location' and not v_full
                                  then jsonb_build_object(
                                         'lat', round((ra.value_json ->> 'lat')::numeric, 2),
                                         'lng', round((ra.value_json ->> 'lng')::numeric, 2))
                                  else ra.value_json end) order by ra.id)
      from public.response_answers ra where ra.response_id = v_r.id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.list_responses(
  p_form_id uuid,
  p_filters jsonb default '{}'::jsonb,
  p_search text default null,
  p_sort text default 'newest',
  p_cursor jsonb default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_full boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_rows jsonb;
  v_total bigint;
  v_cursor_ts timestamptz;
  v_cursor_num numeric;
  v_cursor_id uuid;
begin
  perform public._assert_can_view(p_form_id);
  v_full := public._can_see_identifiers(p_form_id);
  if p_cursor is not null then
    v_cursor_id := (p_cursor ->> 'id')::uuid;
    if p_sort in ('duration_desc', 'duration_asc') then
      v_cursor_num := (p_cursor ->> 'v')::numeric;
    else
      v_cursor_ts := (p_cursor ->> 'v')::timestamptz;
    end if;
  end if;

  with f as materialized (
    select r.id, r.submitted_at, coalesce(r.duration_seconds, -1) as dur
    from public._dashboard_responses(p_form_id, coalesce(p_filters, '{}'::jsonb)) r
    where v_search is null
       or exists (select 1 from public.response_answers ra
                  where ra.response_id = r.id and ra.value_text ilike '%' || v_search || '%'
                    and (v_full or ra.question_type not in ('email', 'phone')))
       or (v_full and exists (select 1 from public.responses x
                              where x.id = r.id
                                and (x.identifier_email ilike '%' || v_search || '%'
                                     or x.identifier_phone like '%' || v_search || '%')))
       or exists (select 1 from public.responses x
                  where x.id = r.id and x.respondent_code ilike '%' || v_search || '%')
  ),
  page as (
    select f.*
    from f
    where p_cursor is null
       or (p_sort = 'oldest' and (f.submitted_at, f.id) > (v_cursor_ts, v_cursor_id))
       or (p_sort = 'duration_desc' and (f.dur, f.id) < (v_cursor_num, v_cursor_id))
       or (p_sort = 'duration_asc' and (f.dur, f.id) > (v_cursor_num, v_cursor_id))
       or (p_sort not in ('oldest', 'duration_desc', 'duration_asc') and (f.submitted_at, f.id) < (v_cursor_ts, v_cursor_id))
    order by
      case when p_sort = 'oldest' then f.submitted_at end asc,
      case when p_sort = 'duration_desc' then f.dur end desc,
      case when p_sort = 'duration_asc' then f.dur end asc,
      case when p_sort not in ('oldest', 'duration_desc', 'duration_asc') then f.submitted_at end desc,
      case when p_sort in ('oldest', 'duration_asc') then f.id end asc,
      f.id desc
    limit v_limit + 1
  )
  select (select count(*) from f),
         (select jsonb_agg(jsonb_build_object(
                   'id', p.id,
                   'submitted_at', p.submitted_at,
                   'version_number', v.version_number,
                   'duration_seconds', r.duration_seconds,
                   'device', r.device,
                   'locale', r.locale,
                   'respondent_code', r.respondent_code,
                   'surveyor', (select coalesce(sp.full_name, sp.email) from public.profiles sp where sp.id = r.surveyor_id),
                   'qc_status', r.qc_status,
                   'qc_flags', to_jsonb(r.qc_flags),
                   'identifier', case when v_full then coalesce(r.identifier_email, r.identifier_phone)
                                      else coalesce(public.mask_email(r.identifier_email), public.mask_phone(r.identifier_phone)) end,
                   'answers', coalesce((
                     select jsonb_object_agg(ra.question_key, jsonb_strip_nulls(jsonb_build_object(
                              't', public._answer_text(ra.question_type, ra.value_text, v_full), 'n', ra.value_number,
                              'd', to_char(ra.value_date at time zone 'UTC', 'YYYY-MM-DD'), 'o', ra.value_options)))
                     from public.response_answers ra where ra.response_id = p.id), '{}'::jsonb),
                   'sort_v', case when p_sort in ('duration_desc', 'duration_asc') then p.dur::text
                                  else p.submitted_at::text end)
                 order by p.ord)
          from (select page.*, row_number() over (
                  order by
                    case when p_sort = 'oldest' then page.submitted_at end asc,
                    case when p_sort = 'duration_desc' then page.dur end desc,
                    case when p_sort = 'duration_asc' then page.dur end asc,
                    case when p_sort not in ('oldest', 'duration_desc', 'duration_asc') then page.submitted_at end desc,
                    case when p_sort in ('oldest', 'duration_asc') then page.id end asc,
                    page.id desc) as ord
                from page) p
          join public.responses r on r.id = p.id
          join public.form_versions v on v.id = r.form_version_id)
  into v_total, v_rows;

  v_rows := coalesce(v_rows, '[]'::jsonb);
  return jsonb_build_object(
    'total', v_total,
    'rows', (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
             from jsonb_array_elements(v_rows) with ordinality as x(e, ord) where ord <= v_limit),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then
      jsonb_build_object('v', v_rows -> (v_limit - 1) ->> 'sort_v', 'id', v_rows -> (v_limit - 1) ->> 'id') end,
    'identifiers_masked', not v_full
  );
end;
$$;

-- Export: interview columns and location / photo answers.
drop function if exists public.export_responses(uuid, jsonb, timestamptz, uuid, integer);

create or replace function public.export_responses(
  p_form_id uuid,
  p_filters jsonb default '{}'::jsonb,
  p_after_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 1000
)
returns table (
  id uuid,
  submitted_at timestamptz,
  version_number integer,
  identifier_email text,
  identifier_phone text,
  respondent_code text,
  surveyor text,
  quota_cell text,
  qc_status text,
  duration_seconds integer,
  notes jsonb,
  answers jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_full boolean;
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_from timestamptz := nullif(v_filters ->> 'from', '')::timestamptz;
  v_to timestamptz := nullif(v_filters ->> 'to', '')::timestamptz;
  v_version_ids text[];
  v_device text := nullif(v_filters ->> 'device', '');
  v_locale text := nullif(v_filters ->> 'locale', '');
  v_answer_filters jsonb := case when jsonb_typeof(v_filters -> 'answers') = 'array'
                                 then v_filters -> 'answers' else '[]'::jsonb end;
begin
  perform public._assert_can_view(p_form_id);
  v_full := (select auth.uid()) is null or public.can_edit_form(p_form_id);
  if jsonb_typeof(v_filters -> 'versionIds') = 'array' and jsonb_array_length(v_filters -> 'versionIds') > 0 then
    v_version_ids := array(select jsonb_array_elements_text(v_filters -> 'versionIds'));
  end if;

  return query
  select r.id, r.submitted_at, v.version_number,
         case when v_full then r.identifier_email end,
         case when v_full then r.identifier_phone end,
         r.respondent_code,
         (select coalesce(p.full_name, p.email) from public.profiles p where p.id = r.surveyor_id),
         r.quota_cell,
         r.qc_status,
         r.duration_seconds,
         case when v_full then r.notes else '{}'::jsonb end,
         coalesce((
           select jsonb_object_agg(ra.question_key, jsonb_strip_nulls(jsonb_build_object(
                    't', public._answer_text(ra.question_type, ra.value_text, v_full),
                    'n', ra.value_number,
                    'd', to_char(ra.value_date at time zone 'UTC', 'YYYY-MM-DD'),
                    'o', ra.value_options,
                    'j', case when ra.question_type = 'location' and not v_full
                              then jsonb_build_object(
                                     'lat', round((ra.value_json ->> 'lat')::numeric, 2),
                                     'lng', round((ra.value_json ->> 'lng')::numeric, 2))
                              else ra.value_json end)))
           from public.response_answers ra where ra.response_id = r.id), '{}'::jsonb)
  from public.responses r
  join public.form_versions v on v.id = r.form_version_id
  where r.form_id = p_form_id
    and (p_after_at is null or (r.submitted_at, r.id) > (p_after_at, p_after_id))
    and (v_from is null or r.submitted_at >= v_from)
    and (v_to is null or r.submitted_at < v_to)
    and (v_version_ids is null or r.form_version_id::text = any (v_version_ids))
    and (v_device is null or r.device = v_device)
    and (v_locale is null or r.locale = v_locale)
    and not exists (
      select 1
      from jsonb_array_elements(v_answer_filters) f
      where not exists (
        select 1
        from public.response_answers ra
        where ra.response_id = r.id
          and ra.question_key = f ->> 'questionKey'
          and (
            ra.value_options && array(select jsonb_array_elements_text(f -> 'values'))
            or ra.value_text = any (array(select jsonb_array_elements_text(f -> 'values')))
            or (ra.value_number is not null
                and ra.value_number::text = any (array(select jsonb_array_elements_text(f -> 'values'))))
            or (ra.value_date is not null
                and to_char(ra.value_date at time zone 'UTC', 'YYYY-MM-DD')
                    = any (array(select jsonb_array_elements_text(f -> 'values'))))
          )
      )
    )
  order by r.submitted_at, r.id
  limit least(greatest(coalesce(p_limit, 1000), 1), 5000);
end;
$$;

alter function public.export_responses(uuid, jsonb, timestamptz, uuid, integer) set plan_cache_mode = 'force_custom_plan';

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public._analysis_questions(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public._assert_can_edit(uuid) from public, anon, authenticated, service_role;

revoke all on function public.submit_response(uuid, uuid, uuid, jsonb, text, text, text, integer, text, text, uuid,
  uuid, jsonb, text, integer, integer, integer, text[], jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.submit_response(uuid, uuid, uuid, jsonb, text, text, text, integer, text, text, uuid,
  uuid, jsonb, text, integer, integer, integer, text[], jsonb, timestamptz) to service_role;

revoke all on function public.record_screenout(uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, uuid, text,
  integer, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_screenout(uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, uuid, text,
  integer, text, text, timestamptz) to service_role;

revoke all on function public.quota_count(uuid, text) from public, anon, authenticated;
grant execute on function public.quota_count(uuid, text) to service_role;

revoke all on function public.can_interview(uuid) from public, anon;
grant execute on function public.can_interview(uuid) to authenticated, service_role;
revoke all on function public.list_interview_forms() from public, anon;
grant execute on function public.list_interview_forms() to authenticated;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.qc_overview(uuid)',
    'public.qc_list(uuid, text, uuid, integer, integer)',
    'public.qc_select_backcheck(uuid, integer)',
    'public.qc_set_status(uuid, text, text)',
    'public.qc_reject(uuid, text)',
    'public.qc_restore(uuid)',
    'public.list_screenouts(uuid, integer, integer)',
    'public.get_response_photo(uuid)',
    'public.export_responses(uuid, jsonb, timestamptz, uuid, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end;
$$;

-- Dicatat hanya jika prod memakai riwayat Supabase CLI (tabel ada).
do $rec$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name)
    values ('20261021090100', 'capi_toolkit')
    on conflict (version) do nothing;
  end if;
end
$rec$;

commit;
