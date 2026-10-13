-- =============================================================================
-- Phase 5: pre-aggregated dashboard summaries (scale to 100k responses)
--
-- Measured before this migration (local Docker, 100k responses / 1.08M
-- answers): dashboard_bundle 4.6-5.7 s, cross_suggestions 13 s. An index cannot
-- fix this: the default dashboard reads every answer of the form. Two summary
-- tables, maintained by statement-level triggers, hold the aggregates:
--
--   response_summary  form x UTC hour x version x device x locale:
--                     count, duration count/sum, first/last submission
--   answer_summary    form x question x Asia/Jakarta day x version x device x
--                     locale x (kind, value): counts (+ sums)
--
-- The dashboard reads the summaries whenever the filters allow it (date range
-- on hour / Jakarta-day boundaries, versions, device, language). Answer filters
-- (drill-down) still use the raw tables. Both paths return identical JSON
-- (tests/integration/scale.test.ts compares them).
--
-- Maintenance:
--   INSERT responses / response_answers: incremental upsert from the
--     transition table, serialized per form with an advisory lock.
--   DELETE responses: the affected (form, Jakarta day) slices are rebuilt from
--     the raw tables (answers are already gone through the cascade).
--   rebuild_dashboard_summary(form_id): full rebuild (secret key only). Use it
--     after changing responses with the secret key (the API cannot update them).
-- =============================================================================

create table public.response_summary (
  form_id uuid not null references public.forms (id) on delete cascade,
  hour timestamptz not null,
  form_version_id uuid not null,
  device text not null,
  locale text not null,
  cnt bigint not null,
  dur_n bigint not null,
  dur_sum numeric not null,
  first_at timestamptz not null,
  last_at timestamptz not null,
  primary key (form_id, hour, form_version_id, device, locale)
);

-- kind: 'a' answered (total = text length sum or checkbox selections sum),
--       'o' option id, 'p' checkbox pair (a || chr(31) || b, a < b),
--       'v' numeric value (trim_scale), 'd' date value (YYYY-MM-DD).
create table public.answer_summary (
  form_id uuid not null references public.forms (id) on delete cascade,
  question_key text not null,
  day date not null,
  form_version_id uuid not null,
  device text not null,
  locale text not null,
  kind "char" not null,
  value text not null,
  cnt bigint not null,
  total numeric,
  primary key (form_id, day, question_key, form_version_id, device, locale, kind, value)
);

alter table public.response_summary enable row level security;
alter table public.answer_summary enable row level security;
-- No policies: only SECURITY DEFINER functions read or write them.
revoke all on table public.response_summary from public, anon, authenticated;
revoke all on table public.answer_summary from public, anon, authenticated;

-- Ordered scans of one question's answers by response id (top-terms sample);
-- supersedes the (form_id, question_key) index.
create index response_answers_form_question_response_idx
  on public.response_answers (form_id, question_key, response_id);
drop index public.response_answers_form_question_idx;

-- -----------------------------------------------------------------------------
-- Aggregation SQL shared by the insert trigger and the rebuild:
--   %1$s  relation with response_answers' columns (transition table or table)
--   %2$s  condition on the joined responses row r
-- Returns answer_summary rows (one group-by per kind over one materialized set).
-- -----------------------------------------------------------------------------
create or replace function public._answer_summary_sql()
returns text
language sql
immutable
set search_path = ''
as $$
  select $q$
    with a as materialized (
      select ra.form_id, ra.question_key, ra.question_type, ra.value_text, ra.value_number,
             ra.value_date, ra.value_options,
             (r.submitted_at at time zone 'Asia/Jakarta')::date as day, r.form_version_id,
             coalesce(r.device, '') as device, coalesce(r.locale, '') as locale
      from %1$s ra
      join public.responses r on r.id = ra.response_id
      where %2$s
    )
    select form_id, day, question_key, form_version_id, device, locale, 'a'::"char", ''::text, count(*)::bigint,
           sum(case when question_type in ('short_text', 'paragraph') then char_length(value_text)::numeric
                    when question_type = 'checkboxes' then cardinality(value_options)::numeric end)
    from a group by 1, 2, 3, 4, 5, 6
    union all
    select form_id, day, question_key, form_version_id, device, locale, 'o'::"char", o, count(*)::bigint, null::numeric
    from a, unnest(a.value_options) as o group by 1, 2, 3, 4, 5, 6, 8
    union all
    select form_id, day, question_key, form_version_id, device, locale, 'p'::"char", o1 || chr(31) || o2,
           count(*)::bigint, null::numeric
    from a, unnest(a.value_options) as o1, unnest(a.value_options) as o2
    where a.question_type = 'checkboxes' and o1 < o2
    group by 1, 2, 3, 4, 5, 6, 8
    union all
    select form_id, day, question_key, form_version_id, device, locale, 'v'::"char", trim_scale(value_number)::text,
           count(*)::bigint, null::numeric
    from a where value_number is not null group by 1, 2, 3, 4, 5, 6, 8
    union all
    select form_id, day, question_key, form_version_id, device, locale, 'd'::"char",
           to_char(value_date at time zone 'UTC', 'YYYY-MM-DD'), count(*)::bigint, null::numeric
    from a where value_date is not null group by 1, 2, 3, 4, 5, 6, 8
  $q$;
$$;

create or replace function public._lock_form_summary(p_form_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('formpulse.summary:' || p_form_id::text, 0));
$$;

-- Rebuilds both summaries for responses submitted in [p_from, p_to).
-- p_from / p_to must be Asia/Jakarta midnights (or +/- infinity).
create or replace function public._rebuild_summary_slice(p_form_id uuid, p_from timestamptz, p_to timestamptz)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  delete from public.response_summary s
  where s.form_id = p_form_id and s.hour >= p_from and s.hour < p_to;

  insert into public.response_summary
    (form_id, hour, form_version_id, device, locale, cnt, dur_n, dur_sum, first_at, last_at)
  select r.form_id, date_trunc('hour', r.submitted_at, 'UTC'), r.form_version_id,
         coalesce(r.device, ''), coalesce(r.locale, ''),
         count(*), count(r.duration_seconds), coalesce(sum(r.duration_seconds), 0),
         min(r.submitted_at), max(r.submitted_at)
  from public.responses r
  where r.form_id = p_form_id and r.submitted_at >= p_from and r.submitted_at < p_to
  group by 1, 2, 3, 4, 5;

  delete from public.answer_summary s
  where s.form_id = p_form_id
    and s.day >= (p_from at time zone 'Asia/Jakarta')::date
    and s.day < (p_to at time zone 'Asia/Jakarta')::date;

  execute
    'insert into public.answer_summary
       (form_id, day, question_key, form_version_id, device, locale, kind, value, cnt, total) '
    || format(public._answer_summary_sql(), 'public.response_answers',
              'r.form_id = $1 and r.submitted_at >= $2 and r.submitted_at < $3')
  using p_form_id, p_from, p_to;
end;
$$;

-- -----------------------------------------------------------------------------
-- Triggers. SECURITY DEFINER because deletes run as the signed-in admin/owner,
-- who has no privileges on the summary tables.
-- -----------------------------------------------------------------------------
create or replace function public._summary_responses_inserted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form uuid;
begin
  for v_form in select distinct n.form_id from new_rows n order by 1 loop
    perform public._lock_form_summary(v_form);
  end loop;

  insert into public.response_summary as s
    (form_id, hour, form_version_id, device, locale, cnt, dur_n, dur_sum, first_at, last_at)
  select n.form_id, date_trunc('hour', n.submitted_at, 'UTC'), n.form_version_id,
         coalesce(n.device, ''), coalesce(n.locale, ''),
         count(*), count(n.duration_seconds), coalesce(sum(n.duration_seconds), 0),
         min(n.submitted_at), max(n.submitted_at)
  from new_rows n
  group by 1, 2, 3, 4, 5
  order by 1, 2, 3, 4, 5
  on conflict (form_id, hour, form_version_id, device, locale) do update
    set cnt = s.cnt + excluded.cnt,
        dur_n = s.dur_n + excluded.dur_n,
        dur_sum = s.dur_sum + excluded.dur_sum,
        first_at = least(s.first_at, excluded.first_at),
        last_at = greatest(s.last_at, excluded.last_at);
  return null;
end;
$$;

create or replace function public._summary_answers_inserted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form uuid;
begin
  for v_form in select distinct n.form_id from new_rows n order by 1 loop
    perform public._lock_form_summary(v_form);
  end loop;

  -- Dynamic SQL so the insert trigger and the rebuild share one definition;
  -- the transition table is visible to EXECUTE inside this trigger function.
  execute
    'insert into public.answer_summary as s
       (form_id, day, question_key, form_version_id, device, locale, kind, value, cnt, total)
     select * from ('
    || format(public._answer_summary_sql(), 'new_rows', 'true')
    || ') t order by 1, 2, 3, 4, 5, 6, 7, 8
       on conflict (form_id, day, question_key, form_version_id, device, locale, kind, value) do update
         set cnt = s.cnt + excluded.cnt,
             total = case when s.total is null and excluded.total is null then null
                          else coalesce(s.total, 0) + coalesce(excluded.total, 0) end';
  return null;
end;
$$;

create or replace function public._summary_responses_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slice record;
begin
  for v_slice in
    select distinct o.form_id, (o.submitted_at at time zone 'Asia/Jakarta')::date as day
    from old_rows o
    order by 1, 2
  loop
    perform public._lock_form_summary(v_slice.form_id);
    perform public._rebuild_summary_slice(
      v_slice.form_id,
      v_slice.day::timestamp at time zone 'Asia/Jakarta',
      (v_slice.day + 1)::timestamp at time zone 'Asia/Jakarta');
  end loop;
  return null;
end;
$$;

create trigger responses_summary_insert
  after insert on public.responses
  referencing new table as new_rows
  for each statement execute function public._summary_responses_inserted();

create trigger response_answers_summary_insert
  after insert on public.response_answers
  referencing new table as new_rows
  for each statement execute function public._summary_answers_inserted();

create trigger responses_summary_delete
  after delete on public.responses
  referencing old table as old_rows
  for each statement execute function public._summary_responses_deleted();

-- Full rebuild (all forms when p_form_id is null). Secret key only.
create or replace function public.rebuild_dashboard_summary(p_form_id uuid default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_form uuid;
  v_count integer := 0;
begin
  for v_form in
    select f.id from public.forms f where p_form_id is null or f.id = p_form_id order by 1
  loop
    perform public._lock_form_summary(v_form);
    perform public._rebuild_summary_slice(v_form, '-infinity'::timestamptz, 'infinity'::timestamptz);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Backfill existing data.
select public.rebuild_dashboard_summary();

-- -----------------------------------------------------------------------------
-- Overview: summary path (filters on hour boundaries, no answer filters),
-- raw path otherwise (the Phase 4 function, renamed).
-- -----------------------------------------------------------------------------
alter function public._dashboard_overview(uuid, jsonb) rename to _dashboard_overview_raw;

-- True when the filters can be answered from the summaries. p_day: the date
-- range must start/end on Asia/Jakarta midnights (answer_summary is daily);
-- otherwise on whole hours (response_summary is hourly).
create or replace function public._summary_filters_ok(p_filters jsonb, p_day boolean)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_array_length(case when jsonb_typeof(p_filters -> 'answers') = 'array'
                                          then p_filters -> 'answers' end), 0) = 0
     and (nullif(p_filters ->> 'from', '') is null
          or case when p_day
               then ((p_filters ->> 'from')::timestamptz at time zone 'Asia/Jakarta')::time = '00:00'
               else date_trunc('hour', (p_filters ->> 'from')::timestamptz, 'UTC') = (p_filters ->> 'from')::timestamptz end)
     and (nullif(p_filters ->> 'to', '') is null
          or case when p_day
               then ((p_filters ->> 'to')::timestamptz at time zone 'Asia/Jakarta')::time = '00:00'
               else date_trunc('hour', (p_filters ->> 'to')::timestamptz, 'UTC') = (p_filters ->> 'to')::timestamptz end);
$$;

create or replace function public._dashboard_overview(p_form_id uuid, p_filters jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_from timestamptz := nullif(p_filters ->> 'from', '')::timestamptz;
  v_to timestamptz := nullif(p_filters ->> 'to', '')::timestamptz;
  v_versions text[];
  v_device text := nullif(p_filters ->> 'device', '');
  v_locale text := nullif(p_filters ->> 'locale', '');
  v_start timestamptz;
  v_end timestamptz;
  v_gran text;
  v_median double precision;
  v_result jsonb;
begin
  if not public._summary_filters_ok(p_filters, false) then
    return public._dashboard_overview_raw(p_form_id, p_filters);
  end if;
  if jsonb_typeof(p_filters -> 'versionIds') = 'array' and jsonb_array_length(p_filters -> 'versionIds') > 0 then
    v_versions := array(select jsonb_array_elements_text(p_filters -> 'versionIds'));
  end if;

  select coalesce(v_from, min(s.first_at)), coalesce(v_to - interval '1 microsecond', now())
  into v_start, v_end
  from public.response_summary s
  where s.form_id = p_form_id
    and (v_versions is null or s.form_version_id::text = any (v_versions))
    and (v_device is null or s.device = v_device)
    and (v_locale is null or s.locale = v_locale)
    and (v_from is null or s.hour >= v_from)
    and (v_to is null or s.hour < v_to);

  v_gran := case
    when v_start is null then 'day'
    when v_end - v_start <= interval '2 days' then 'hour'
    when v_end - v_start <= interval '120 days' then 'day'
    else 'week' end;

  -- The exact median needs the raw durations (one indexed scan of responses).
  select percentile_cont(0.5) within group (order by r.duration_seconds)
  into v_median
  from public.responses r
  where r.form_id = p_form_id
    and r.duration_seconds is not null
    and (v_from is null or r.submitted_at >= v_from)
    and (v_to is null or r.submitted_at < v_to)
    and (v_versions is null or r.form_version_id::text = any (v_versions))
    and (v_device is null or r.device = v_device)
    and (v_locale is null or r.locale = v_locale);

  with nodates as materialized (
    select s.hour, s.form_version_id, s.device, s.locale, s.cnt, s.dur_n, s.dur_sum, s.first_at, s.last_at,
           (s.hour at time zone 'Asia/Jakarta') as local_hour
    from public.response_summary s
    where s.form_id = p_form_id
      and (v_versions is null or s.form_version_id::text = any (v_versions))
      and (v_device is null or s.device = v_device)
      and (v_locale is null or s.locale = v_locale)
  ),
  f as materialized (
    select * from nodates
    where (v_from is null or nodates.hour >= v_from) and (v_to is null or nodates.hour < v_to)
  ),
  local_now as (select now() at time zone 'Asia/Jakarta' as t)
  select jsonb_build_object(
    'total', (select coalesce(sum(cnt), 0) from f),
    'today', (select coalesce(sum(cnt), 0) from nodates, local_now
              where nodates.local_hour::date = local_now.t::date),
    'last7', (select coalesce(sum(cnt), 0) from nodates, local_now
              where nodates.local_hour::date > local_now.t::date - 7),
    'prev7', (select coalesce(sum(cnt), 0) from nodates, local_now
              where nodates.local_hour::date > local_now.t::date - 14
                and nodates.local_hour::date <= local_now.t::date - 7),
    'previous_period', case when v_from is not null and v_to is not null then (
      select coalesce(sum(cnt), 0) from nodates
      where hour >= v_from - (v_to - v_from) and hour < v_from) end,
    'first_at', (select min(first_at) from f),
    'last_at', (select max(last_at) from f),
    'timeline', jsonb_build_object(
      'granularity', v_gran,
      'buckets', case when v_start is null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('t', to_char(b.t, 'YYYY-MM-DD"T"HH24:MI'), 'count', coalesce(c.count, 0))
                         order by b.t)
        from generate_series(
               date_trunc(v_gran, v_start at time zone 'Asia/Jakarta'),
               date_trunc(v_gran, v_end at time zone 'Asia/Jakarta'),
               ('1 ' || v_gran)::interval) as b(t)
        left join (
          select date_trunc(v_gran, f.local_hour) as t, sum(f.cnt) as count
          from f group by 1
        ) c on c.t = b.t), '[]'::jsonb) end),
    'heatmap', coalesce((
      select jsonb_agg(jsonb_build_object('dow', dow, 'hour', hour, 'count', c) order by dow, hour)
      from (
        select extract(isodow from f.local_hour)::integer as dow,
               extract(hour from f.local_hour)::integer as hour,
               sum(f.cnt) as c
        from f group by 1, 2
      ) h), '[]'::jsonb),
    'duration', (
      select jsonb_build_object(
        'n', coalesce(sum(dur_n), 0),
        'mean', round(sum(dur_sum) / nullif(sum(dur_n), 0), 1),
        'median', v_median)
      from f),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('key', k, 'count', c) order by c desc, k)
      from (select coalesce(nullif(device, ''), 'unknown') as k, sum(cnt) as c from f group by 1) d), '[]'::jsonb),
    'locales', coalesce((
      select jsonb_agg(jsonb_build_object('key', k, 'count', c) order by c desc, k)
      from (select coalesce(nullif(locale, ''), 'unknown') as k, sum(cnt) as c from f group by 1) d), '[]'::jsonb),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'number', v.version_number,
                                          'published_at', v.published_at, 'count', coalesce(c.count, 0))
                       order by v.version_number)
      from public.form_versions v
      left join (select form_version_id, sum(cnt) as count from f group by 1) c on c.form_version_id = v.id
      where v.form_id = p_form_id), '[]'::jsonb),
    -- Drafts are deleted on submit, so open drafts are the abandoned starts.
    'funnel', (
      select jsonb_build_object(
        'submitted', (select coalesce(sum(cnt), 0) from f),
        'abandoned', count(*),
        'started', (select coalesce(sum(cnt), 0) from f) + count(*))
      from public.response_drafts d
      where d.form_id = p_form_id
        and (v_from is null or d.updated_at >= v_from)
        and (v_to is null or d.updated_at < v_to))
  ) into v_result;

  v_result := v_result || jsonb_build_object(
    'n', v_result -> 'total',
    'low_sample', (v_result ->> 'total')::integer < 30);
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Question stats: summary path (Jakarta-day date range, no answer filters), raw otherwise.
-- -----------------------------------------------------------------------------
create or replace function public._bundle_questions(p_form_id uuid, p_filters jsonb, p_only_key text default null)
returns jsonb
language plpgsql
stable
set search_path = ''
-- Enough memory to keep the per-call answer set and sorts in RAM at ~100k answers.
set work_mem = '32MB'
as $$
declare
  v_total integer;
  v_versions jsonb;
  v_counts jsonb;
  v_options jsonb;
  v_avgsel jsonb;
  v_pairs jsonb;
  v_nums jsonb;
  v_dist jsonb;
  v_hist jsonb;
  v_drange jsonb;
  v_dseries jsonb;
  v_dweek jsonb;
  v_terms jsonb;
  v_textlen jsonb;
  v_q record;
  v_key text;
  v_type text;
  v_n integer;
  v_eligible integer;
  v_min numeric;
  v_max numeric;
  v_stats jsonb;
  v_num jsonb;
  v_k integer;
  v_out jsonb := '{}'::jsonb;
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_unfiltered boolean;
  v_from timestamptz;
  v_to timestamptz;
  v_from_day date;
  v_to_day date;
  v_version_ids text[];
  v_device text;
  v_locale text;
begin
  v_unfiltered := nullif(v_filters ->> 'from', '') is null and nullif(v_filters ->> 'to', '') is null
    and coalesce(jsonb_array_length(case when jsonb_typeof(v_filters -> 'versionIds') = 'array' then v_filters -> 'versionIds' end), 0) = 0
    and coalesce(jsonb_array_length(case when jsonb_typeof(v_filters -> 'answers') = 'array' then v_filters -> 'answers' end), 0) = 0
    and nullif(v_filters ->> 'device', '') is null and nullif(v_filters ->> 'locale', '') is null;

  if public._summary_filters_ok(v_filters, true) then
    v_from := nullif(v_filters ->> 'from', '')::timestamptz;
    v_to := nullif(v_filters ->> 'to', '')::timestamptz;
    v_from_day := (v_from at time zone 'Asia/Jakarta')::date;
    v_to_day := (v_to at time zone 'Asia/Jakarta')::date;
    v_device := nullif(v_filters ->> 'device', '');
    v_locale := nullif(v_filters ->> 'locale', '');
    if jsonb_typeof(v_filters -> 'versionIds') = 'array' and jsonb_array_length(v_filters -> 'versionIds') > 0 then
      v_version_ids := array(select jsonb_array_elements_text(v_filters -> 'versionIds'));
    end if;

    with s as materialized (
      select x.question_key as k, x.kind, x.value, sum(x.cnt) as c, sum(x.total) as tot
      from public.answer_summary x
      where x.form_id = p_form_id
        and (p_only_key is null or x.question_key = p_only_key)
        and (v_from_day is null or x.day >= v_from_day)
        and (v_to_day is null or x.day < v_to_day)
        and (v_version_ids is null or x.form_version_id::text = any (v_version_ids))
        and (v_device is null or x.device = v_device)
        and (v_locale is null or x.locale = v_locale)
      group by 1, 2, 3
    ),
    rs as (
      select x.form_version_id, sum(x.cnt) as c
      from public.response_summary x
      where x.form_id = p_form_id
        and (v_from is null or x.hour >= v_from)
        and (v_to is null or x.hour < v_to)
        and (v_version_ids is null or x.form_version_id::text = any (v_version_ids))
        and (v_device is null or x.device = v_device)
        and (v_locale is null or x.locale = v_locale)
      group by 1
    ),
    agg as (select k, c as answered, tot from s where kind = 'a'),
    nv as (select k, value::numeric as v, c from s where kind = 'v'),
    -- Same arithmetic as avg() / stddev_samp() on numeric, from value counts.
    nums as (
      select k, sum(c) as n, min(v) as lo, max(v) as hi,
             sum(v * c) / sum(c) as mean,
             case when sum(c) > 1 then sqrt(greatest(sum(c) * sum(v * v * c) - sum(v * c) * sum(v * c), 0)
                                            / (sum(c) * (sum(c) - 1))) end as sd,
             greatest(1, ceil(ln(sum(c)::bigint) / ln(2) + 1))::integer as buckets
      from nv group by k
    ),
    -- percentile_cont over value counts: value at 0-based row i is the v whose
    -- cumulative range [cs, ce) contains i; interpolation as in PostgreSQL.
    qv as (
      select k, v::double precision as v,
             sum(c) over (partition by k order by v) - c as cs,
             sum(c) over (partition by k order by v) as ce
      from nv
    ),
    qs as (
      select nums.k, p.ord,
             floor(p.p * (nums.n - 1)::double precision) as lo_i,
             ceil(p.p * (nums.n - 1)::double precision) as hi_i,
             p.p * (nums.n - 1)::double precision - floor(p.p * (nums.n - 1)::double precision) as prop
      from nums cross join unnest(array[0.25, 0.5, 0.75, 0.9]::double precision[]) with ordinality as p(p, ord)
    ),
    qr as (
      select qs.k, qs.ord,
             case when qs.lo_i = qs.hi_i then lo.v else lo.v + (qs.prop * (hi.v - lo.v)) end as q
      from qs
      join qv lo on lo.k = qs.k and qs.lo_i >= lo.cs and qs.lo_i < lo.ce
      join qv hi on hi.k = qs.k and qs.hi_i >= hi.cs and qs.hi_i < hi.ce
    ),
    dts as (select k, value::date as d, c from s where kind = 'd'),
    drange as (
      select k, min(d) as lo, max(d) as hi,
             case when max(d) - min(d) <= 92 then 'day' when max(d) - min(d) <= 730 then 'week' else 'month' end as g
      from dts group by k
    )
    select
      (select coalesce(sum(c), 0) from rs),
      (select coalesce(jsonb_object_agg(form_version_id, c), '{}') from rs),
      (select coalesce(jsonb_object_agg(k, answered), '{}') from agg),
      (select coalesce(jsonb_object_agg(k, arr), '{}') from (
         select k, jsonb_agg(jsonb_build_object('id', value, 'count', c) order by c desc, value) as arr
         from s where kind = 'o' group by k) y),
      (select coalesce(jsonb_object_agg(k, round(tot / answered, 2)), '{}') from agg where tot is not null),
      (select coalesce(jsonb_object_agg(k, arr), '{}') from (
         select k, jsonb_agg(jsonb_build_object('a', o1, 'b', o2, 'count', c) order by c desc, o1, o2) as arr
         from (
           select k, split_part(value, chr(31), 1) as o1, split_part(value, chr(31), 2) as o2, c,
                  row_number() over (partition by k order by c desc, split_part(value, chr(31), 1),
                                     split_part(value, chr(31), 2)) as rn
           from s where kind = 'p'
         ) p where rn <= 5 group by k) y),
      (select coalesce(jsonb_object_agg(nums.k, jsonb_build_object(
         'lo', lo, 'hi', hi, 'n', n, 'mean', mean, 'sd', sd,
         'q', (select jsonb_agg(qr.q order by qr.ord) from qr where qr.k = nums.k), 'buckets', buckets)), '{}') from nums),
      (select coalesce(jsonb_object_agg(k, m), '{}') from (
         select k, jsonb_object_agg(v::text, c) as m from nv group by k) y),
      (select coalesce(jsonb_object_agg(k, m), '{}') from (
         select k, jsonb_object_agg(b::text, c) as m
         from (select nv.k, least(width_bucket(nv.v, nums.lo, nums.hi, nums.buckets), nums.buckets) as b, sum(nv.c) as c
               from nv join nums using (k)
               where nums.hi > nums.lo
               group by nv.k, 2) x group by k) y),
      (select coalesce(jsonb_object_agg(k, jsonb_build_object('lo', lo, 'hi', hi, 'g', g)), '{}') from drange),
      (select coalesce(jsonb_object_agg(k, arr), '{}') from (
         select k, jsonb_agg(jsonb_build_object('t', to_char(t, 'YYYY-MM-DD'), 'count', c) order by t) as arr
         from (select dts.k, date_trunc(drange.g, dts.d)::date as t, sum(dts.c) as c
               from dts join drange using (k) group by 1, 2) x group by k) y),
      (select coalesce(jsonb_object_agg(k, m), '{}') from (
         select k, jsonb_object_agg(dow::text, c) as m
         from (select k, extract(isodow from d)::integer as dow, sum(c) as c from dts group by 1, 2) x group by k) y),
      -- Top terms: same deterministic sample as the raw path (first 2,000 text
      -- answers by response id), read through the (form, question, response) index.
      (select coalesce(jsonb_object_agg(k, arr), '{}') from (
         select k, jsonb_agg(jsonb_build_object('term', term, 'count', c) order by c desc, term) as arr
         from (
           select t.k, term, count(distinct t.response_id) as c,
                  row_number() over (partition by t.k order by count(distinct t.response_id) desc, term) as rn
           from (
             select q.key as k, sample.response_id, sample.value_text
             from (select distinct x.k as key from s x
                   where x.kind = 'a' and x.tot is not null) q
             cross join lateral (
               select ra.response_id, ra.value_text
               from public.response_answers ra
               where ra.form_id = p_form_id and ra.question_key = q.key
                 and ra.question_type in ('short_text', 'paragraph') and ra.value_text is not null
                 and (v_unfiltered or exists (
                       select 1 from public.responses r
                       where r.id = ra.response_id
                         and (v_from is null or r.submitted_at >= v_from)
                         and (v_to is null or r.submitted_at < v_to)
                         and (v_version_ids is null or r.form_version_id::text = any (v_version_ids))
                         and (v_device is null or r.device = v_device)
                         and (v_locale is null or r.locale = v_locale)))
               order by ra.response_id
               limit 2000
             ) sample
           ) t, regexp_split_to_table(lower(t.value_text), '[^[:alnum:]]+') as term
           where char_length(term) >= 3 and term !~ '^[0-9]+$'
             and term <> all (public._stop_words())
           group by t.k, term
         ) x where rn <= 15 group by k) y),
      (select coalesce(jsonb_object_agg(k, round(tot / answered, 1)), '{}') from agg where tot is not null)
    into v_total, v_versions, v_counts, v_options, v_avgsel, v_pairs, v_nums, v_dist, v_hist,
         v_drange, v_dseries, v_dweek, v_terms, v_textlen;
  else
    with f as materialized (
      select r.id, r.form_version_id from public._dashboard_responses(p_form_id, v_filters) r
    ),
    a as materialized (
      select ra.question_key as k, ra.question_type as t, ra.response_id,
             case when ra.question_type in ('short_text', 'paragraph') then ra.value_text end as value_text,
             ra.value_number, ra.value_date, ra.value_options
      from public.response_answers ra
      where ra.form_id = p_form_id
        and (p_only_key is null or ra.question_key = p_only_key)
        and (v_unfiltered or ra.response_id in (select f.id from f))
    ),
    -- Plain aggregates (hash aggregate, no sort).
    agg as (
      select k, count(*) as answered,
             round(avg(cardinality(value_options)) filter (where t = 'checkboxes'), 2) as avgsel,
             round(avg(char_length(value_text)) filter (where t in ('short_text', 'paragraph')), 1) as textlen
      from a group by k
    ),
    -- Numeric stats and quantiles only over numeric answers.
    nums as (
      select k, count(*) as n, min(value_number) as lo, max(value_number) as hi,
             avg(value_number) as mean, stddev_samp(value_number) as sd,
             percentile_cont(array[0.25, 0.5, 0.75, 0.9]) within group (order by value_number) as q,
             greatest(1, ceil(ln(count(*)) / ln(2) + 1))::integer as buckets
      from a where value_number is not null group by k
    ),
    dates as (select k, (value_date at time zone 'UTC')::date as d from a where value_date is not null),
    drange as (
      select k, min(d) as lo, max(d) as hi,
             case when max(d) - min(d) <= 92 then 'day' when max(d) - min(d) <= 730 then 'week' else 'month' end as g
      from dates group by k
    )
    select
      (select count(*) from f),
      (select coalesce(jsonb_object_agg(form_version_id, c), '{}') from (select form_version_id, count(*) as c from f group by 1) x),
      (select coalesce(jsonb_object_agg(k, answered), '{}') from agg),
      (select coalesce(jsonb_object_agg(k, arr), '{}') from (
         select k, jsonb_agg(jsonb_build_object('id', o, 'count', c) order by c desc, o) as arr
         from (select k, o, count(*) as c from a, unnest(a.value_options) o group by k, o) x group by k) y),
      (select coalesce(jsonb_object_agg(k, avgsel), '{}') from agg where avgsel is not null),
      (select coalesce(jsonb_object_agg(k, arr), '{}') from (
         select k, jsonb_agg(jsonb_build_object('a', o1, 'b', o2, 'count', c) order by c desc, o1, o2) as arr
         from (
           select a.k, o1, o2, count(*) as c,
                  row_number() over (partition by a.k order by count(*) desc, o1, o2) as rn
           from a, unnest(a.value_options) o1, unnest(a.value_options) o2
           where a.t = 'checkboxes' and o1 < o2
           group by a.k, o1, o2
         ) p where rn <= 5 group by k) y),
      (select coalesce(jsonb_object_agg(k, jsonb_build_object(
         'lo', lo, 'hi', hi, 'n', n, 'mean', mean, 'sd', sd, 'q', to_jsonb(q), 'buckets', buckets)), '{}') from nums),
      (select coalesce(jsonb_object_agg(k, m), '{}') from (
         select k, jsonb_object_agg(v::text, c) as m
         from (select k, value_number as v, count(*) as c from a
               where t in ('rating', 'linear_scale') and value_number is not null group by k, value_number) x group by k) y),
      (select coalesce(jsonb_object_agg(k, m), '{}') from (
         select k, jsonb_object_agg(b::text, c) as m
         from (select a.k, least(width_bucket(a.value_number, nums.lo, nums.hi, nums.buckets), nums.buckets) as b, count(*) as c
               from a join nums using (k)
               where a.t = 'number' and a.value_number is not null and nums.hi > nums.lo
               group by a.k, 2) x group by k) y),
      (select coalesce(jsonb_object_agg(k, jsonb_build_object('lo', lo, 'hi', hi, 'g', g)), '{}') from drange),
      (select coalesce(jsonb_object_agg(k, arr), '{}') from (
         select k, jsonb_agg(jsonb_build_object('t', to_char(t, 'YYYY-MM-DD'), 'count', c) order by t) as arr
         from (select dates.k, date_trunc(drange.g, dates.d)::date as t, count(*) as c
               from dates join drange using (k) group by 1, 2) x group by k) y),
      (select coalesce(jsonb_object_agg(k, m), '{}') from (
         select k, jsonb_object_agg(dow::text, c) as m
         from (select k, extract(isodow from d)::integer as dow, count(*) as c from dates group by 1, 2) x group by k) y),
      (select coalesce(jsonb_object_agg(k, arr), '{}') from (
         select k, jsonb_agg(jsonb_build_object('term', term, 'count', c) order by c desc, term) as arr
         from (
           select a.k, term, count(distinct a.response_id) as c,
                  row_number() over (partition by a.k order by count(distinct a.response_id) desc, term) as rn
           from (
             select k, response_id, value_text,
                    row_number() over (partition by k order by response_id) as sample_rn
             from a where t in ('short_text', 'paragraph') and value_text is not null
           ) a, regexp_split_to_table(lower(a.value_text), '[^[:alnum:]]+') as term
           where a.sample_rn <= 2000 and char_length(term) >= 3 and term !~ '^[0-9]+$'
             and term <> all (public._stop_words())
           group by a.k, term
         ) x where rn <= 15 group by k) y),
      (select coalesce(jsonb_object_agg(k, textlen), '{}') from agg where textlen is not null)
    into v_total, v_versions, v_counts, v_options, v_avgsel, v_pairs, v_nums, v_dist, v_hist,
         v_drange, v_dseries, v_dweek, v_terms, v_textlen;
  end if;

  for v_q in
    select * from public._form_question_index(p_form_id) i
    where p_only_key is null or i.key = p_only_key
    order by i.ord
  loop
    v_key := v_q.key;
    v_type := v_q.meta ->> 'type';
    v_n := coalesce((v_counts ->> v_key)::integer, 0);
    select coalesce(sum((v_versions ->> vid::text)::integer), 0) into v_eligible from unnest(v_q.version_ids) as vid;
    v_stats := jsonb_build_object(
      'key', v_key, 'type', v_type, 'n', v_n, 'total', v_total, 'eligible', v_eligible, 'low_sample', v_n < 30,
      'version_numbers', to_jsonb(v_q.version_numbers), 'in_current', v_q.in_current);
    v_num := v_nums -> v_key;

    if v_type in ('multiple_choice', 'dropdown') then
      v_stats := v_stats || jsonb_build_object(
        'options', coalesce(v_options -> v_key, '[]'::jsonb),
        'other', coalesce((select (e ->> 'count')::integer from jsonb_array_elements(v_options -> v_key) e
                           where e ->> 'id' = '__other__'), 0));

    elsif v_type = 'checkboxes' then
      v_stats := v_stats || jsonb_build_object(
        'options', coalesce((
          select jsonb_agg(e || jsonb_build_object('percent', round(100.0 * (e ->> 'count')::numeric / nullif(v_n, 0), 1))
                           order by ord)
          from jsonb_array_elements(v_options -> v_key) with ordinality as x(e, ord)), '[]'::jsonb),
        'avg_selections', v_avgsel -> v_key,
        'pairs', coalesce(v_pairs -> v_key, '[]'::jsonb));

    elsif v_type in ('rating', 'linear_scale') then
      if v_type = 'rating' then
        v_min := 1;
        v_max := coalesce((v_q.meta -> 'rating' ->> 'max')::numeric, 5);
      else
        v_min := coalesce((v_q.meta -> 'scale' ->> 'min')::numeric, 1);
        v_max := coalesce((v_q.meta -> 'scale' ->> 'max')::numeric, 5);
      end if;
      v_stats := v_stats || jsonb_build_object(
        'min', v_min, 'max', v_max,
        'mean', round((v_num ->> 'mean')::numeric, 2),
        'median', (v_num -> 'q' ->> 1)::double precision,
        'stddev', round((v_num ->> 'sd')::numeric, 2),
        'distribution', (
          select jsonb_agg(jsonb_build_object('value', s.value,
                                              'count', coalesce((v_dist -> v_key ->> s.value::numeric::text)::integer, 0))
                           order by s.value)
          from generate_series(v_min::integer, v_max::integer) as s(value)),
        'nps', case when v_min = 0 and v_max = 10 and v_n > 0 then (
          select round(100.0 * (coalesce(sum(c) filter (where v >= 9), 0) - coalesce(sum(c) filter (where v <= 6), 0)) / v_n, 1)
          from (select key::numeric as v, value::integer as c from jsonb_each_text(v_dist -> v_key)) d) end,
        'promoters', case when v_min = 0 and v_max = 10 then (
          select coalesce(sum(value::integer) filter (where key::numeric >= 9), 0) from jsonb_each_text(v_dist -> v_key)) end,
        'passives', case when v_min = 0 and v_max = 10 then (
          select coalesce(sum(value::integer) filter (where key::numeric between 7 and 8), 0) from jsonb_each_text(v_dist -> v_key)) end,
        'detractors', case when v_min = 0 and v_max = 10 then (
          select coalesce(sum(value::integer) filter (where key::numeric <= 6), 0) from jsonb_each_text(v_dist -> v_key)) end,
        'csat', case when v_max = 5 and v_n > 0 then (
          select round(100.0 * coalesce(sum(value::integer) filter (where key::numeric >= 4), 0) / v_n, 1)
          from jsonb_each_text(v_dist -> v_key)) end);

    elsif v_type = 'number' then
      v_k := coalesce((v_num ->> 'buckets')::integer, 1);
      v_stats := v_stats || jsonb_build_object(
        'min', (v_num ->> 'lo')::numeric,
        'max', (v_num ->> 'hi')::numeric,
        'mean', round((v_num ->> 'mean')::numeric, 2),
        'median', (v_num -> 'q' ->> 1)::double precision,
        'p25', (v_num -> 'q' ->> 0)::double precision,
        'p75', (v_num -> 'q' ->> 2)::double precision,
        'p90', (v_num -> 'q' ->> 3)::double precision,
        'stddev', round((v_num ->> 'sd')::numeric, 2),
        'histogram', case
          when v_num is null then '[]'::jsonb
          when (v_num ->> 'lo')::numeric = (v_num ->> 'hi')::numeric then jsonb_build_array(jsonb_build_object(
            'from', (v_num ->> 'lo')::numeric, 'to', (v_num ->> 'hi')::numeric, 'count', (v_num ->> 'n')::integer))
          else (
            select jsonb_agg(jsonb_build_object(
                     'from', round(lo + (b - 1) * (hi - lo) / v_k, 4),
                     'to', round(lo + b * (hi - lo) / v_k, 4),
                     'count', coalesce((v_hist -> v_key ->> b::text)::integer, 0)) order by b)
            from generate_series(1, v_k) as b,
                 lateral (select (v_num ->> 'lo')::numeric as lo, (v_num ->> 'hi')::numeric as hi) bounds)
          end);

    elsif v_type = 'date' then
      v_stats := v_stats || jsonb_build_object(
        'granularity', v_drange -> v_key ->> 'g',
        'min', v_drange -> v_key -> 'lo',
        'max', v_drange -> v_key -> 'hi',
        'series', coalesce(v_dseries -> v_key, '[]'::jsonb),
        'weekdays', (
          select jsonb_agg(jsonb_build_object('dow', w, 'count', coalesce((v_dweek -> v_key ->> w::text)::integer, 0))
                           order by w)
          from generate_series(1, 7) as w));

    elsif v_type in ('short_text', 'paragraph') then
      v_stats := v_stats || jsonb_build_object(
        'avg_length', v_textlen -> v_key,
        'terms', coalesce(v_terms -> v_key, '[]'::jsonb),
        -- Top terms use at most 2,000 answers per question (sample by response id).
        'terms_based_on', least(v_n, 2000));
    end if;

    v_out := v_out || jsonb_build_object(v_key, v_stats);
  end loop;

  return v_out;
end;
$$;

-- -----------------------------------------------------------------------------
-- cross_suggestions: bounded sample.
-- -----------------------------------------------------------------------------
create or replace function public.cross_suggestions(p_form_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  perform public._assert_can_view(p_form_id);

  -- Suggestions are a hint, so they use at most the latest 5,000 responses
  -- (bounded cost at any scale; each pair still reports its own n).
  with f as materialized (
    select r.id from public._dashboard_responses(p_form_id, coalesce(p_filters, '{}'::jsonb)) r
    order by r.submitted_at desc, r.id desc
    limit 5000
  ),
  cand as (
    select i.key, i.meta ->> 'type' as t
    from public._form_question_index(p_form_id) i
    where i.in_current
      and ((i.meta ->> 'type') in ('rating', 'linear_scale', 'number')
           or ((i.meta ->> 'type') in ('multiple_choice', 'dropdown', 'checkboxes')
               and jsonb_array_length(coalesce(i.meta -> 'options', '[]'::jsonb)) between 2 and 8))
    order by i.ord
    limit 10
  ),
  a as materialized (
    select ra.response_id, ra.question_key as k,
           case when c.t in ('rating', 'linear_scale', 'number') then ra.value_number end as x,
           case when c.t in ('multiple_choice', 'dropdown', 'checkboxes') then ra.value_options end as o
    from public.response_answers ra
    join f on f.id = ra.response_id
    join cand c on c.key = ra.question_key
    where ra.form_id = p_form_id
  ),
  -- number x number: Pearson r
  nn as (
    select a1.k as ka, a2.k as kb, count(*) as n, corr(a1.x, a2.x) as r
    from a a1 join a a2 on a2.response_id = a1.response_id and a1.k < a2.k
    where a1.x is not null and a2.x is not null
    group by 1, 2
  ),
  -- categorical x number: spread of group means in overall standard deviations
  cn_rows as (
    select c1.k as kc, n2.k as kn, oc, n2.x, c1.response_id
    from a c1 cross join lateral unnest(c1.o) as oc
    join a n2 on n2.response_id = c1.response_id and n2.x is not null
    where c1.o is not null
  ),
  cn_groups as (select kc, kn, oc, count(*) as n, avg(x) as m from cn_rows group by 1, 2, 3),
  cn_overall as (select kc, kn, stddev_samp(x) as sd, count(distinct response_id) as n from cn_rows group by 1, 2),
  cn as (
    select g.kc, g.kn, o.n,
           (max(g.m) filter (where g.n >= 5) - min(g.m) filter (where g.n >= 5)) / nullif(o.sd, 0) as effect,
           count(*) filter (where g.n >= 5) as groups
    from cn_groups g join cn_overall o using (kc, kn)
    group by g.kc, g.kn, o.n, o.sd
  ),
  -- categorical x categorical: Cramér's V
  cc_pairs as (
    select c1.k as ka, c2.k as kb, c1.response_id, c1.o as o1s, c2.o as o2s
    from a c1 join a c2 on c2.response_id = c1.response_id and c1.k < c2.k
    where c1.o is not null and c2.o is not null
  ),
  cc_cells as (
    select ka, kb, o1, o2, count(*)::numeric as c
    from cc_pairs, unnest(o1s) as o1, unnest(o2s) as o2
    group by 1, 2, 3, 4
  ),
  cc_r as (select ka, kb, o1, sum(c) as r from cc_cells group by 1, 2, 3),
  cc_c as (select ka, kb, o2, sum(c) as k from cc_cells group by 1, 2, 3),
  cc_t as (select ka, kb, sum(c) as n, count(distinct o1) as nr, count(distinct o2) as nc from cc_cells group by 1, 2),
  cc_chi as (
    select r.ka, r.kb, sum(power(coalesce(cell.c, 0) - r.r * c.k / t.n, 2) / (r.r * c.k / t.n)) as chi2
    from cc_r r join cc_c c using (ka, kb) join cc_t t using (ka, kb)
    left join cc_cells cell on cell.ka = r.ka and cell.kb = r.kb and cell.o1 = r.o1 and cell.o2 = c.o2
    group by 1, 2
  ),
  cc as (
    select t.ka, t.kb, (select count(distinct p.response_id) from cc_pairs p where p.ka = t.ka and p.kb = t.kb) as n,
           case when least(t.nr, t.nc) > 1 and t.n > 0 then sqrt(chi.chi2 / (t.n * (least(t.nr, t.nc) - 1))) end as v
    from cc_t t join cc_chi chi using (ka, kb)
  ),
  scored as (
    select ka as a, kb as b, 'num_num' as kind, 'r' as metric, round(r::numeric, 3) as value,
           (abs(r) / 0.3)::numeric as score, n
    from nn where n >= 30 and abs(r) >= 0.3
    union all
    select kc, kn, 'cat_num', 'effect', round(effect, 3), effect / 0.5, n
    from cn where n >= 30 and groups >= 2 and effect >= 0.5
    union all
    select ka, kb, 'cat_cat', 'cramers_v', round(v, 3), v / 0.2, n
    from cc where n >= 30 and v >= 0.2
  )
  select coalesce(jsonb_agg(jsonb_build_object('a', a, 'b', b, 'kind', kind, 'metric', metric, 'value', value,
                                               'score', round(score, 3), 'n', n) order by score desc), '[]'::jsonb)
  into v_out
  from (select * from scored order by score desc limit 4) top;

  return v_out;
end;
$$;

-- -----------------------------------------------------------------------------
-- Text answers: only free-text questions (never email / phone answers).
-- -----------------------------------------------------------------------------
create or replace function public.question_text_answers(
  p_form_id uuid,
  p_question_key text,
  p_filters jsonb default '{}'::jsonb,
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 20
)
returns table (response_id uuid, submitted_at timestamptz, value text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._assert_can_view(p_form_id);
  return query
  select r.id, r.submitted_at, ra.value_text
  from public._dashboard_responses(p_form_id, coalesce(p_filters, '{}'::jsonb)) r
  join public.response_answers ra on ra.response_id = r.id and ra.question_key = p_question_key
  where ra.value_text is not null
    and ra.question_type in ('short_text', 'paragraph')
    and (p_before_at is null or (r.submitted_at, r.id) < (p_before_at, p_before_id))
  order by r.submitted_at desc, r.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;

-- -----------------------------------------------------------------------------
-- Answer masking: email / phone answers are personal data like the identifier
-- columns, so viewers get them masked in every RPC.
-- -----------------------------------------------------------------------------
create or replace function public._answer_text(p_type text, p_text text, p_full boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_full or p_text is null then p_text
    when p_type = 'email' then public.mask_email(p_text)
    when p_type = 'phone' then public.mask_phone(p_text)
    else p_text end;
$$;

-- -----------------------------------------------------------------------------
-- Export: one keyset page (submitted_at, id ascending) with answers as a JSON
-- object keyed by question key. Identifiers / email / phone answers only for
-- users with edit rights (and the secret key).
-- -----------------------------------------------------------------------------
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

  -- Same predicates as _dashboard_responses, inline so the keyset uses
  -- responses (form_id, submitted_at).
  return query
  select r.id, r.submitted_at, v.version_number,
         case when v_full then r.identifier_email end,
         case when v_full then r.identifier_phone end,
         coalesce((
           select jsonb_object_agg(ra.question_key, jsonb_strip_nulls(jsonb_build_object(
                    't', public._answer_text(ra.question_type, ra.value_text, v_full),
                    'n', ra.value_number,
                    'd', to_char(ra.value_date at time zone 'UTC', 'YYYY-MM-DD'),
                    'o', ra.value_options)))
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

-- -----------------------------------------------------------------------------
-- Forms list: demo forms hidden unless asked for; counts from the summary.
-- -----------------------------------------------------------------------------
drop function public.list_forms(text, public.form_status, uuid, text, text, integer, integer);

create or replace function public.list_forms(
  p_search text default null,
  p_status public.form_status default null,
  p_owner uuid default null,
  p_scope text default 'all',
  p_sort text default 'updated_desc',
  p_limit integer default 20,
  p_offset integer default 0,
  p_include_demo boolean default false
)
returns table (
  id uuid,
  title text,
  slug text,
  status public.form_status,
  owner_id uuid,
  owner_name text,
  created_at timestamptz,
  updated_at timestamptz,
  response_count bigint,
  last_response_at timestamptz,
  current_version_number integer,
  has_unpublished_changes boolean,
  can_edit boolean,
  access text,
  is_demo boolean,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid, public.is_admin() as admin
  ),
  visible as (
    select f.*
    from public.forms f, me
    where public.can_view_form(f.id)
      and (coalesce(p_include_demo, false) or not f.is_demo)
      and (case when p_status is null then f.status <> 'archived' else f.status = p_status end)
      and (p_owner is null or f.owner_id = p_owner)
      and (
        p_search is null or p_search = ''
        or f.title ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      )
      and (
        coalesce(p_scope, 'all') = 'all'
        or (p_scope = 'mine' and f.owner_id = me.uid)
        or (p_scope = 'shared' and f.owner_id <> me.uid and exists (
              select 1 from public.form_members m where m.form_id = f.id and m.user_id = me.uid))
      )
  ),
  enriched as (
    select
      v.id, v.title, v.slug, v.status, v.owner_id,
      coalesce(nullif(p.full_name, ''), p.email) as owner_name,
      v.created_at, v.updated_at,
      coalesce(rs.response_count, 0)::bigint as response_count,
      rs.last_response_at,
      fv.version_number as current_version_number,
      (fv.id is not null and fv.definition is distinct from v.draft_definition) as has_unpublished_changes,
      public.can_edit_form(v.id) as can_edit,
      case
        when v.owner_id = me.uid then 'owner'
        when me.admin then 'admin'
        else coalesce((select m.role::text from public.form_members m
                       where m.form_id = v.id and m.user_id = me.uid), 'viewer')
      end as access,
      v.is_demo
    from visible v
    cross join me
    left join public.profiles p on p.id = v.owner_id
    left join public.form_versions fv on fv.id = v.current_version_id
    left join lateral (
      select sum(s.cnt) as response_count, max(s.last_at) as last_response_at
      from public.response_summary s
      where s.form_id = v.id
    ) rs on true
  )
  select e.*, count(*) over () as total_count
  from enriched e
  order by
    case when p_sort = 'title_asc' then lower(e.title) end asc,
    case when p_sort = 'title_desc' then lower(e.title) end desc,
    case when p_sort = 'responses_desc' then e.response_count end desc,
    case when p_sort = 'last_response_desc' then e.last_response_at end desc nulls last,
    case when p_sort = 'created_desc' then e.created_at end desc,
    case when p_sort = 'updated_asc' then e.updated_at end asc,
    e.updated_at desc,
    e.id
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Fresh planner statistics after bulk demo inserts, summaries included.
create or replace function public.analyze_response_tables()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  analyze public.responses;
  analyze public.response_answers;
  analyze public.response_summary;
  analyze public.answer_summary;
end;
$$;

-- Demo cleanup in chunks (PostgREST stops statements after 8 s; 100k rows
-- take ~8 s in one statement). Oldest first, so each chunk touches few days of
-- the summaries. Returns the number deleted; drafts go with the last chunk.
drop function public.delete_demo_responses(uuid);

create or replace function public.delete_demo_responses(p_form_id uuid, p_limit integer default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.responses r
  where r.id in (
    select x.id from public.responses x
    where x.form_id = p_form_id and x.is_demo
    order by x.submitted_at
    limit coalesce(p_limit, 2147483647)
  );
  get diagnostics v_count = row_count;
  if p_limit is null or v_count < p_limit then
    delete from public.response_drafts d where d.form_id = p_form_id and d.data ->> 'demo' = 'true';
  end if;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Demo generator: p_live (submitted now, for the live simulator) and a linear
-- visibility check (100k responses: 124 s before).
-- -----------------------------------------------------------------------------
drop function public.generate_demo_responses(uuid, integer, integer);

create or replace function public.generate_demo_responses(
  p_form_id uuid,
  p_n integer,
  p_days integer default 30,
  p_live boolean default false
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
-- Plans depend on the batch size and table size; never reuse a generic plan.
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_version_id uuid;
  v_def jsonb;
  v_q jsonb;
  v_type text;
  v_key text;
  v_required boolean;
  v_opts text[];
  v_k integer;
  v_seg_key text;
  v_seg_k integer;
  v_num_idx integer := 0;
  v_min numeric;
  v_max numeric;
  v_visible uuid[];
  v_set uuid[];
  v_cond jsonb;
  v_op text;
  v_val_text text;
  v_val_num numeric;
  v_combinator text;
  v_allow_other boolean;
  v_rate double precision;
  v_new uuid[];
begin
  if p_n is null or p_n < 1 or p_n > 200000 or p_days is null or p_days < 1 or p_days > 3650 then
    raise exception 'invalid demo arguments' using errcode = '22023';
  end if;

  select f.current_version_id, v.definition into v_version_id, v_def
  from public.forms f join public.form_versions v on v.id = f.current_version_id
  where f.id = p_form_id;
  if v_version_id is null then
    raise exception 'form has no published version' using errcode = 'P0002';
  end if;

  -- Segment question: first dropdown, else first multiple choice, with >= 3 options.
  select q ->> 'key', jsonb_array_length(q -> 'options') into v_seg_key, v_seg_k
  from jsonb_path_query(v_def, '$.sections[*].questions[*]') with ordinality as j(q, ord)
  where q ->> 'type' in ('dropdown', 'multiple_choice') and jsonb_array_length(coalesce(q -> 'options', '[]')) >= 3
  order by (q ->> 'type' = 'dropdown') desc, ord
  limit 1;

  with ins as (
    insert into public.responses (form_id, form_version_id, submitted_at, duration_seconds, locale, device, is_demo)
    select p_form_id, v_version_id,
         case when p_live then now() - random() * interval '1 second' else least(now(), (
           date_trunc('day', now() at time zone 'Asia/Jakarta')
           - make_interval(days => floor(power(random(), 1.3) * p_days)::integer)
           + make_interval(hours => 7 + floor(power(random(), 0.85) * 15)::integer,
                           mins => floor(random() * 60)::integer)
         ) at time zone 'Asia/Jakarta') end,
         (90 + exp(4.2 + random() * 1.8))::integer,
         case when random() < 0.7 then 'id' else 'en' end,
         case when x.r < 0.62 then 'mobile' when x.r < 0.93 then 'desktop' else 'tablet' end,
         true
    from generate_series(1, p_n) g cross join lateral (select random() + 0 * g as r) x
    returning id
  )
  select array_agg(id) into v_new from ins;

  for v_q in select q from jsonb_path_query(v_def, '$.sections[*].questions[*]') q loop
    v_type := v_q ->> 'type';
    v_key := v_q ->> 'key';
    v_required := coalesce((v_q ->> 'required')::boolean, false);
    v_rate := case when v_required then 1.0 else 0.78 end;
    v_opts := array(select jsonb_array_elements(coalesce(v_q -> 'options', '[]')) ->> 'id');
    v_k := cardinality(v_opts);
    v_allow_other := coalesce((v_q ->> 'allowOther')::boolean, false);

    -- Visibility from showIf, evaluated against answers inserted so far.
    v_visible := null;
    if jsonb_array_length(coalesce(v_q -> 'showIf' -> 'conditions', '[]')) > 0 then
      v_combinator := v_q -> 'showIf' ->> 'combinator';
      for v_cond in select jsonb_array_elements(v_q -> 'showIf' -> 'conditions') loop
        v_op := v_cond ->> 'operator';
        v_val_text := v_cond ->> 'value';
        v_val_num := case when jsonb_typeof(v_cond -> 'value') = 'number' then (v_cond ->> 'value')::numeric end;
        select coalesce(array_agg(d.response_id), '{}') into v_set
        from unnest(v_new) as n(response_id) cross join lateral public._demo_latent(n.response_id) d
        left join lateral (
          select x.id, x.value_options, x.value_number, x.value_text, x.value_date
          from public.response_answers x
          where x.response_id = d.response_id and x.question_key = v_cond ->> 'questionKey'
          limit 1
        ) ra on true
        where case v_op
          when 'is_answered' then ra.id is not null
          when 'is_empty' then ra.id is null
          when 'equals' then coalesce(ra.value_options @> array[v_val_text] or ra.value_number = v_val_num
                                      or lower(trim(ra.value_text)) = lower(trim(v_val_text)), false)
          when 'not_equals' then ra.id is null or not coalesce(ra.value_options @> array[v_val_text]
                                      or ra.value_number = v_val_num or lower(trim(ra.value_text)) = lower(trim(v_val_text)), false)
          when 'contains' then coalesce(ra.value_options @> array[v_val_text]
                                        or position(lower(v_val_text) in lower(ra.value_text)) > 0, false)
          when 'gt' then coalesce(ra.value_number > v_val_num
                                  or to_char(ra.value_date at time zone 'UTC', 'YYYY-MM-DD') > v_val_text, false)
          when 'lt' then coalesce(ra.value_number < v_val_num
                                  or to_char(ra.value_date at time zone 'UTC', 'YYYY-MM-DD') < v_val_text, false)
          else false end;
        if v_visible is null then
          v_visible := v_set;
        elsif v_combinator = 'or' then
          v_visible := array(select unnest(v_visible) union select unnest(v_set));
        else
          v_visible := array(select unnest(v_visible) intersect select unnest(v_set));
        end if;
      end loop;
    end if;

    if v_type = 'short_text' then
      insert into public.response_answers (response_id, form_id, question_key, question_type, value_text)
      select d.response_id, p_form_id, v_key, v_type,
             (array['Ani','Budi','Citra','Dewi','Eko','Fajar','Gita','Hadi','Intan','Joko','Kartika','Lina'])[1 + floor(random() * 12)::integer]
      from unnest(coalesce(v_visible, v_new)) as n(response_id) cross join lateral public._demo_latent(n.response_id) d
      where random() < v_rate;

    elsif v_type = 'paragraph' then
      insert into public.response_answers (response_id, form_id, question_key, question_type, value_text)
      select d.response_id, p_form_id, v_key, v_type,
             case when d.s > 0.3 then
               (array['Friendly staff and fast service.', 'Pelayanan cepat dan staf ramah.',
                      'The app makes ordering easy.', 'Clean store, friendly staff, fair price.',
                      'Aplikasi mudah dipakai dan harga terjangkau.'])[1 + floor(random() * 5)::integer]
             else
               (array['The queue was too long and staff seemed busy.', 'Antrean terlalu lama, waktu tunggu lama.',
                      'Waiting time is too long at the counter.', 'Price is high and the app is slow.',
                      'Aplikasi lambat dan antrean panjang.'])[1 + floor(random() * 5)::integer]
             end
      from unnest(coalesce(v_visible, v_new)) as n(response_id) cross join lateral public._demo_latent(n.response_id) d
      where random() < v_rate;

    elsif v_type = 'email' then
      insert into public.response_answers (response_id, form_id, question_key, question_type, value_text)
      select d.response_id, p_form_id, v_key, v_type, 'demo.' || left(md5(d.response_id::text), 8) || '@example.com'
      from unnest(coalesce(v_visible, v_new)) as n(response_id) cross join lateral public._demo_latent(n.response_id) d
      where random() < v_rate;

    elsif v_type = 'phone' then
      insert into public.response_answers (response_id, form_id, question_key, question_type, value_text)
      select d.response_id, p_form_id, v_key, v_type, '62812' || lpad(floor(random() * 100000000)::text, 8, '0')
      from unnest(coalesce(v_visible, v_new)) as n(response_id) cross join lateral public._demo_latent(n.response_id) d
      where random() < v_rate;

    elsif v_type = 'number' then
      v_num_idx := v_num_idx + 1;
      v_min := coalesce((v_q -> 'validation' ->> 'min')::numeric, 0);
      v_max := coalesce((v_q -> 'validation' ->> 'max')::numeric, 100);
      insert into public.response_answers (response_id, form_id, question_key, question_type, value_number)
      select d.response_id, p_form_id, v_key, v_type,
             greatest(v_min, least(v_max, round(case
               when v_num_idx = 1 then 18 - 9 * d.s + 4 * public._demo_normal()            -- e.g. waiting minutes
               when v_num_idx = 2 then 24 + 9 * floor(d.seg * greatest(coalesce(v_seg_k, 1), 1))
                                       + 5 * public._demo_normal()                          -- e.g. age by segment
               else v_min + (v_max - v_min) * (0.2 + 0.05 * d.s + 0.04 * public._demo_normal())
             end::numeric)))
      from unnest(coalesce(v_visible, v_new)) as n(response_id) cross join lateral public._demo_latent(n.response_id) d
      where random() < v_rate;

    elsif v_type in ('rating', 'linear_scale') then
      if v_type = 'rating' then
        v_min := 1;
        v_max := coalesce((v_q -> 'rating' ->> 'max')::numeric, 5);
      else
        v_min := coalesce((v_q -> 'scale' ->> 'min')::numeric, 1);
        v_max := coalesce((v_q -> 'scale' ->> 'max')::numeric, 5);
      end if;
      insert into public.response_answers (response_id, form_id, question_key, question_type, value_number)
      select d.response_id, p_form_id, v_key, v_type,
             greatest(v_min, least(v_max, round((
               (v_min + v_max) / 2.0 + 0.55 + d.s * (v_max - v_min) / 4.0 + 0.5 * public._demo_normal()
             )::numeric)))
      from unnest(coalesce(v_visible, v_new)) as n(response_id) cross join lateral public._demo_latent(n.response_id) d
      where random() < v_rate;

    elsif v_type in ('multiple_choice', 'dropdown') and v_k > 0 then
      insert into public.response_answers (response_id, form_id, question_key, question_type, value_options, value_text)
      select d.response_id, p_form_id, v_key, v_type,
             case when c.other then array['__other__'] else array[v_opts[c.idx + 1]] end,
             case when c.other then (array['Lainnya', 'Something else', 'Teman kantor'])[1 + floor(random() * 3)::integer] end
      from unnest(coalesce(v_visible, v_new)) as n(response_id) cross join lateral public._demo_latent(n.response_id) d
      cross join lateral (
        select v_allow_other and random() < 0.05 as other,
               least(v_k - 1, greatest(0, case
                 when v_key = v_seg_key then floor(d.seg * v_k)
                 else floor(v_k / (1 + exp(1.7 * (0.9 * d.s + 0.6 * public._demo_normal()))))
               end))::integer as idx
      ) c
      where random() < v_rate;

    elsif v_type = 'checkboxes' and v_k > 0 then
      insert into public.response_answers (response_id, form_id, question_key, question_type, value_options)
      select d.response_id, p_form_id, v_key, v_type,
             coalesce(
               nullif(array(
                 select o from unnest(v_opts) with ordinality as u(o, i)
                 where random() < 0.18 + 0.35 * (1 - (i - 1)::double precision / v_k)
                                  + case when i = 1 then 0.15 * sign(d.s) else 0 end
               ), '{}'),
               array[v_opts[1 + floor(random() * v_k)::integer]])
      from unnest(coalesce(v_visible, v_new)) as n(response_id) cross join lateral public._demo_latent(n.response_id) d
      where random() < v_rate;

    elsif v_type = 'date' then
      insert into public.response_answers (response_id, form_id, question_key, question_type, value_date)
      select d.response_id, p_form_id, v_key, v_type,
             ((current_date - floor(power(random(), 1.4) * p_days)::integer)::timestamp at time zone 'UTC')
      from unnest(coalesce(v_visible, v_new)) as n(response_id) cross join lateral public._demo_latent(n.response_id) d
      where random() < v_rate;
    end if;
  end loop;

  -- Abandoned drafts for the completion funnel (about 18% of starts).
  insert into public.response_drafts (form_id, version_id, data, updated_at, expires_at)
  select p_form_id, v_version_id, '{"demo": true}'::jsonb,
         case when p_live then now() else now() - make_interval(secs => floor(random() * p_days * 86400)::integer) end,
         now() + interval '30 days'
  from generate_series(1, floor(p_n * 0.18 + random())::integer);

  return p_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- Raw paths at scale.
-- _dashboard_responses: answer filters were NOT EXISTS probes that rebuilt the
-- value arrays for every response (1.1 s per call at 70k). Now each filter's
-- matching responses are read once through (form_id, question_key, ...) and
-- intersected. Same semantics: OR inside a filter, AND between filters.
-- -----------------------------------------------------------------------------
create or replace function public._dashboard_responses(
  p_form_id uuid,
  p_filters jsonb,
  p_ignore_dates boolean default false
)
returns table (
  id uuid,
  form_version_id uuid,
  submitted_at timestamptz,
  duration_seconds integer,
  device text,
  locale text
)
language sql
stable
set search_path = ''
as $$
  with af as materialized (
    select x.ord, x.f ->> 'questionKey' as k,
           array(select jsonb_array_elements_text(x.f -> 'values')) as vals
    from jsonb_array_elements(
           case when jsonb_typeof(p_filters -> 'answers') = 'array' then p_filters -> 'answers' else '[]'::jsonb end
         ) with ordinality as x(f, ord)
  ),
  matched as materialized (
    select ra.response_id
    from af
    join public.response_answers ra on ra.form_id = p_form_id and ra.question_key = af.k
    where ra.value_options && af.vals
       or ra.value_text = any (af.vals)
       or (ra.value_number is not null and ra.value_number::text = any (af.vals))
       or (ra.value_date is not null
           and to_char(ra.value_date at time zone 'UTC', 'YYYY-MM-DD') = any (af.vals))
    group by ra.response_id
    having count(distinct af.ord) = (select count(*) from af)
  )
  select r.id, r.form_version_id, r.submitted_at, r.duration_seconds, r.device, r.locale
  from public.responses r
  where r.form_id = p_form_id
    and (p_ignore_dates or nullif(p_filters ->> 'from', '') is null
         or r.submitted_at >= (p_filters ->> 'from')::timestamptz)
    and (p_ignore_dates or nullif(p_filters ->> 'to', '') is null
         or r.submitted_at < (p_filters ->> 'to')::timestamptz)
    and (jsonb_typeof(p_filters -> 'versionIds') is distinct from 'array'
         or jsonb_array_length(p_filters -> 'versionIds') = 0
         or r.form_version_id::text in (select jsonb_array_elements_text(p_filters -> 'versionIds')))
    and (nullif(p_filters ->> 'device', '') is null or r.device = p_filters ->> 'device')
    and (nullif(p_filters ->> 'locale', '') is null or r.locale = p_filters ->> 'locale')
    and (not exists (select 1 from af) or r.id in (select m.response_id from matched m));
$$;

-- -----------------------------------------------------------------------------
-- list_responses: no id array (the unnest join was a nested loop over every
-- response); one materialized filtered set for the total and the keyset page.
-- Viewers get email / phone answers masked and cannot search them.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- get_response: viewers get email / phone answers masked.
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
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'question_key', ra.question_key, 'question_type', ra.question_type,
               'value_text', public._answer_text(ra.question_type, ra.value_text, v_full), 'value_number', ra.value_number,
               'value_date', to_char(ra.value_date at time zone 'UTC', 'YYYY-MM-DD'),
               'value_options', ra.value_options) order by ra.id)
      from public.response_answers ra where ra.response_id = v_r.id), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Raw answers are read only through the RPCs above (masking, aggregation).
-- RLS policies stay as a second layer.
-- -----------------------------------------------------------------------------
revoke select on public.response_answers from authenticated;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  -- Internal helpers and trigger functions: no API role.
  foreach fn in array array[
    'public._answer_summary_sql()',
    'public._lock_form_summary(uuid)',
    'public._rebuild_summary_slice(uuid, timestamptz, timestamptz)',
    'public._summary_responses_inserted()',
    'public._summary_answers_inserted()',
    'public._summary_responses_deleted()',
    'public._summary_filters_ok(jsonb, boolean)',
    'public._dashboard_overview(uuid, jsonb)',
    'public._dashboard_overview_raw(uuid, jsonb)',
    'public._answer_text(text, text, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
  end loop;

  -- Signed-in users (access checked inside) and the secret key.
  execute 'revoke all on function public.export_responses(uuid, jsonb, timestamptz, uuid, integer) from public, anon';
  execute 'grant execute on function public.export_responses(uuid, jsonb, timestamptz, uuid, integer) to authenticated, service_role';
  execute 'revoke all on function public.list_forms(text, public.form_status, uuid, text, text, integer, integer, boolean) from public, anon';
  execute 'grant execute on function public.list_forms(text, public.form_status, uuid, text, text, integer, integer, boolean) to authenticated';

  -- Secret key only.
  foreach fn in array array[
    'public.generate_demo_responses(uuid, integer, integer, boolean)',
    'public.rebuild_dashboard_summary(uuid)',
    'public.delete_demo_responses(uuid, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Plan caching: PL/pgSQL switches to a generic plan after five calls on the same
-- connection (PostgREST pools connections). For these functions the best plan
-- depends on the filters and table sizes; the generic one was up to 2x slower
-- (dashboard_bundle 170 -> 330 ms at 86k). Planning each call costs ~1 ms.
-- -----------------------------------------------------------------------------
alter function public._bundle_questions(uuid, jsonb, text) set plan_cache_mode = 'force_custom_plan';
alter function public._dashboard_overview(uuid, jsonb) set plan_cache_mode = 'force_custom_plan';
alter function public._dashboard_overview_raw(uuid, jsonb) set plan_cache_mode = 'force_custom_plan';
alter function public._cross_stats_f(uuid, jsonb, jsonb, jsonb) set plan_cache_mode = 'force_custom_plan';
alter function public.cross_suggestions(uuid, jsonb) set plan_cache_mode = 'force_custom_plan';
alter function public.list_responses(uuid, jsonb, text, text, jsonb, integer) set plan_cache_mode = 'force_custom_plan';
alter function public.question_text_answers(uuid, text, jsonb, timestamptz, uuid, integer) set plan_cache_mode = 'force_custom_plan';
alter function public.export_responses(uuid, jsonb, timestamptz, uuid, integer) set plan_cache_mode = 'force_custom_plan';
