-- =============================================================================
-- FormPulse Phase 3: public submissions, drafts, rate limiting.
-- Respondents never call these directly: Route Handlers under /api/f use the
-- secret key (service_role) after validating input server-side.
-- =============================================================================

-- Idempotency: a retried submit with the same token returns the original row.
alter table public.responses add column submission_token uuid;
alter table public.responses
  add constraint responses_submission_token_key unique (submission_token);

-- Duplicate checks for email_or_phone forms look at both columns.
create index responses_form_identifier_email_idx
  on public.responses (form_id, identifier_email)
  where identifier_email is not null and is_demo = false;
create index responses_form_identifier_phone_idx
  on public.responses (form_id, identifier_phone)
  where identifier_phone is not null and is_demo = false;

-- -----------------------------------------------------------------------------
-- check_rate_limit: fixed-window counter. Returns true while within the limit.
-- Buckets contain only salted hashes (never raw IPs).
-- -----------------------------------------------------------------------------
create or replace function public.check_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_bucket is null or char_length(p_bucket) > 200 or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit arguments' using errcode = '22023';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits as rl (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = rl.hits + 1
  returning rl.hits into v_hits;

  -- Opportunistic cleanup of old windows (about 1% of calls).
  if random() < 0.01 then
    delete from public.rate_limits where window_start < clock_timestamp() - interval '1 day';
  end if;

  return v_hits <= p_limit;
end;
$$;

-- -----------------------------------------------------------------------------
-- Drafts (no identifier stored). A token can only ever belong to one form.
-- -----------------------------------------------------------------------------
create or replace function public.save_response_draft(
  p_form_id uuid,
  p_draft_token uuid,
  p_version_id uuid,
  p_data jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_saved boolean;
begin
  if not exists (
    select 1 from public.form_versions v where v.id = p_version_id and v.form_id = p_form_id
  ) then
    raise exception 'INVALID_VERSION' using errcode = 'P0001';
  end if;

  insert into public.response_drafts as d (form_id, draft_token, version_id, data, expires_at)
  values (p_form_id, p_draft_token, p_version_id, coalesce(p_data, '{}'::jsonb), now() + interval '30 days')
  on conflict (draft_token) do update
    set version_id = excluded.version_id,
        data = excluded.data,
        expires_at = excluded.expires_at
    where d.form_id = excluded.form_id;
  get diagnostics v_saved = row_count;

  if random() < 0.01 then
    delete from public.response_drafts where expires_at < now();
  end if;

  return v_saved;
end;
$$;

create or replace function public.delete_response_draft(p_form_id uuid, p_draft_token uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.response_drafts d
  where d.form_id = p_form_id and d.draft_token = p_draft_token;
$$;

-- -----------------------------------------------------------------------------
-- submit_response: ONE transaction for the response and its typed answers.
-- The Route Handler has already validated the answers against the version.
-- This function re-checks everything that must be authoritative.
--
-- p_answers: [{question_key, question_type, value_text, value_number,
--              value_date, value_options}]
-- Errors (message, SQLSTATE P0001): FORM_NOT_FOUND, FORM_CLOSED,
-- INVALID_VERSION, IDENTIFIER_REQUIRED, ALREADY_SUBMITTED, INVALID_ANSWERS.
-- -----------------------------------------------------------------------------
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
  p_draft_token uuid default null
)
returns table (response_id uuid, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_form public.forms%rowtype;
  v_response_id uuid;
  v_constraint text;
begin
  if p_submission_token is null then
    raise exception 'INVALID_ANSWERS' using errcode = 'P0001';
  end if;

  -- Idempotent replay.
  select r.id into v_response_id
  from public.responses r
  where r.submission_token = p_submission_token and r.form_id = p_form_id;
  if found then
    return query select v_response_id, true;
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
  if jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers) > 300 then
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

  begin
    insert into public.responses (
      form_id, form_version_id, identifier_email, identifier_phone, identifier_key,
      duration_seconds, locale, device, submission_token
    )
    values (
      p_form_id, p_version_id, p_identifier_email, p_identifier_phone,
      case when v_form.identifier_mode = 'none' then null else p_identifier_key end,
      p_duration_seconds, left(p_locale, 10), left(p_device, 20), p_submission_token
    )
    returning id into v_response_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'responses_submission_token_key' then
      select r.id into v_response_id from public.responses r where r.submission_token = p_submission_token;
      return query select v_response_id, true;
      return;
    end if;
    raise exception 'ALREADY_SUBMITTED' using errcode = 'P0001';
  end;

  insert into public.response_answers (
    response_id, form_id, question_key, question_type,
    value_text, value_number, value_date, value_options
  )
  select v_response_id, p_form_id, a.question_key, a.question_type,
         a.value_text, a.value_number, a.value_date, a.value_options
  from jsonb_to_recordset(p_answers) as a(
    question_key text,
    question_type text,
    value_text text,
    value_number numeric,
    value_date timestamptz,
    value_options text[]
  );

  if exists (
    select 1 from public.response_answers ra
    where ra.response_id = v_response_id
      and (ra.question_key is null
           or ra.question_type not in ('short_text', 'paragraph', 'multiple_choice', 'checkboxes',
                                       'dropdown', 'number', 'date', 'rating', 'linear_scale',
                                       'email', 'phone')
           or char_length(ra.value_text) > 5000)
  ) then
    raise exception 'INVALID_ANSWERS' using errcode = 'P0001';
  end if;

  if p_draft_token is not null then
    delete from public.response_drafts d where d.draft_token = p_draft_token and d.form_id = p_form_id;
  end if;

  return query select v_response_id, false;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges: server-side (service_role) only. Never anon or authenticated.
-- -----------------------------------------------------------------------------
revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.save_response_draft(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.delete_response_draft(uuid, uuid) from public, anon, authenticated;
revoke all on function public.submit_response(uuid, uuid, uuid, jsonb, text, text, text, integer, text, text, uuid)
  from public, anon, authenticated;

grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
grant execute on function public.save_response_draft(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.delete_response_draft(uuid, uuid) to service_role;
grant execute on function public.submit_response(uuid, uuid, uuid, jsonb, text, text, text, integer, text, text, uuid)
  to service_role;
