-- =============================================================================
-- FormPulse Phase 4: dashboard analytics (all aggregation in Postgres),
-- responses listing, identifier column privileges, demo data generator.
--
-- Security model for analytics RPCs: SECURITY DEFINER + an explicit access
-- check at the top (_assert_can_view). RLS per row would evaluate
-- can_view_form() for every answer row (tens of thousands), so one explicit
-- check is both faster and easier to reason about. Signed-in callers need
-- can_view_form; the secret key (service_role, auth.uid() is null) is allowed
-- so the Phase 5 public dashboard can call the same functions after it has
-- validated a share token. anon has no EXECUTE on any of them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Identifiers are visible to editors only (masked for viewers via RPCs).
-- Column privileges: authenticated can no longer read identifier columns
-- directly; RLS still decides which rows.
-- -----------------------------------------------------------------------------
revoke select on public.responses from authenticated;
grant select (id, form_id, form_version_id, submitted_at, duration_seconds, locale, device, is_demo)
  on public.responses to authenticated;

create or replace function public.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null then null
    when position('@' in p_email) <= 1 then '***'
    else left(p_email, 1) || '***@' || split_part(p_email, '@', 2)
  end;
$$;

create or replace function public.mask_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_phone is null then null else '***' || right(p_phone, 3) end;
$$;

-- -----------------------------------------------------------------------------
-- Internal helpers (prefixed with _, not executable by API roles)
-- -----------------------------------------------------------------------------
create or replace function public._assert_can_view(p_form_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- auth.uid() is null only for the secret key / migrations (anon has no EXECUTE).
  if (select auth.uid()) is not null and not public.can_view_form(p_form_id) then
    raise exception 'not allowed to view this form' using errcode = '42501';
  end if;
end;
$$;

create or replace function public._can_see_identifiers(p_form_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and public.can_edit_form(p_form_id);
$$;

-- Common English + Indonesian stop words for the "top terms" of text answers.
create or replace function public._stop_words()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'the','and','for','are','but','not','you','all','any','can','had','her','was','one','our','out','has','have',
    'him','his','how','its','may','new','now','old','see','two','who','did','get','got','let','she','too','use',
    'that','this','with','from','they','will','would','there','their','what','about','which','when','were','been',
    'more','very','also','than','then','them','some','just','into','your','only','much','because','could','should',
    'yang','dan','untuk','dengan','ini','itu','dari','pada','ada','tidak','juga','saya','kami','kita','akan','atau',
    'bisa','sudah','lebih','karena','sangat','agar','oleh','dalam','para','jika','tapi','tetapi','namun','masih',
    'harus','belum','lagi','saja','hanya','semua','banyak','sekali','nya','kalau','apa','bagi','dapat','sebagai'
  ];
$$;

-- Latest definition of a question key across all versions of a form.
create or replace function public._question_meta(p_form_id uuid, p_key text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select q
  from public.form_versions v,
       lateral jsonb_path_query_first(
         v.definition,
         '$.sections[*].questions[*] ? (@.key == $k)',
         jsonb_build_object('k', p_key)
       ) q
  where v.form_id = p_form_id and q is not null
  order by v.version_number desc
  limit 1;
$$;

-- Filtered responses. p_filters:
-- { from, to, versionIds: [], device, locale,
--   answers: [{ questionKey, operator: "any_of", values: [] }] }
-- Answer filters are ANDed; values inside one filter are ORed.
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
    and not exists (
      select 1
      from jsonb_array_elements(
             case when jsonb_typeof(p_filters -> 'answers') = 'array' then p_filters -> 'answers' else '[]'::jsonb end
           ) f
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
    );
$$;

-- Per-key metadata: latest definition, versions containing it, in current version.
create or replace function public._form_question_index(p_form_id uuid)
returns table (key text, meta jsonb, version_ids uuid[], version_numbers integer[], in_current boolean, ord integer)
language sql
stable
set search_path = ''
as $$
  with qs as (
    select q ->> 'key' as key, q, v.id as version_id, v.version_number,
           (v.id = f.current_version_id) as is_current, ord
    from public.forms f
    join public.form_versions v on v.form_id = f.id
    cross join lateral jsonb_path_query(v.definition, '$.sections[*].questions[*]') with ordinality as j(q, ord)
    where f.id = p_form_id
  )
  select key,
         (array_agg(q order by version_number desc))[1],
         array_agg(version_id order by version_number),
         array_agg(version_number order by version_number),
         bool_or(is_current),
         coalesce(min(ord) filter (where is_current), 100000 + min(ord))::integer
  from qs
  group by key;
$$;

-- Statistics for one question over a set of response ids.
create or replace function public._question_stats(
  p_form_id uuid,
  p_q jsonb,
  p_ids uuid[],
  p_total integer,
  p_eligible integer
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_key text := p_q ->> 'key';
  v_type text := p_q ->> 'type';
  v_base jsonb;
  v_stats jsonb;
  v_n integer;
  v_min numeric;
  v_max numeric;
begin
  select count(*) into v_n
  from public.response_answers ra
  join unnest(p_ids) as f(id) on f.id = ra.response_id
  where ra.form_id = p_form_id and ra.question_key = v_key;

  v_base := jsonb_build_object(
    'key', v_key, 'type', v_type, 'n', v_n, 'total', p_total, 'eligible', p_eligible,
    'low_sample', v_n < 30
  );

  if v_type in ('multiple_choice', 'dropdown') then
    with a as (
      select ra.value_options from public.response_answers ra
      join unnest(p_ids) as f(id) on f.id = ra.response_id
      where ra.form_id = p_form_id and ra.question_key = v_key
    )
    select jsonb_build_object(
      'options', coalesce((
        select jsonb_agg(jsonb_build_object('id', o, 'count', c) order by c desc, o)
        from (select o, count(*) as c from a, unnest(a.value_options) o group by o) x), '[]'::jsonb),
      'other', (select count(*) from a where '__other__' = any (a.value_options))
    ) into v_stats;

  elsif v_type = 'checkboxes' then
    with a as (
      select ra.value_options from public.response_answers ra
      join unnest(p_ids) as f(id) on f.id = ra.response_id
      where ra.form_id = p_form_id and ra.question_key = v_key
    )
    select jsonb_build_object(
      'options', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', o, 'count', c,
                 'percent', round(100.0 * c / nullif(v_n, 0), 1)) order by c desc, o)
        from (select o, count(*) as c from a, unnest(a.value_options) o group by o) x), '[]'::jsonb),
      'avg_selections', (select round(avg(cardinality(a.value_options)), 2) from a),
      'pairs', coalesce((
        select jsonb_agg(jsonb_build_object('a', o1, 'b', o2, 'count', c) order by c desc, o1, o2)
        from (
          select o1, o2, count(*) as c
          from a, unnest(a.value_options) o1, unnest(a.value_options) o2
          where o1 < o2
          group by o1, o2
          order by c desc, o1, o2
          limit 5
        ) p), '[]'::jsonb)
    ) into v_stats;

  elsif v_type in ('rating', 'linear_scale') then
    if v_type = 'rating' then
      v_min := 1;
      v_max := coalesce((p_q -> 'rating' ->> 'max')::numeric, 5);
    else
      v_min := coalesce((p_q -> 'scale' ->> 'min')::numeric, 1);
      v_max := coalesce((p_q -> 'scale' ->> 'max')::numeric, 5);
    end if;
    with a as (
      select ra.value_number as v from public.response_answers ra
      join unnest(p_ids) as f(id) on f.id = ra.response_id
      where ra.form_id = p_form_id and ra.question_key = v_key and ra.value_number is not null
    )
    select jsonb_build_object(
      'min', v_min, 'max', v_max,
      'mean', (select round(avg(v), 2) from a),
      'median', (select percentile_cont(0.5) within group (order by v) from a),
      'stddev', (select round(stddev_samp(v), 2) from a),
      'distribution', coalesce((
        select jsonb_agg(jsonb_build_object('value', s.value, 'count', coalesce(c.count, 0)) order by s.value)
        from generate_series(v_min::integer, v_max::integer) as s(value)
        left join (select v, count(*) as count from a group by v) c on c.v = s.value), '[]'::jsonb),
      'nps', case when v_min = 0 and v_max = 10 and v_n > 0 then (
        select round(100.0 * (count(*) filter (where v >= 9) - count(*) filter (where v <= 6)) / count(*), 1)
        from a) end,
      'promoters', case when v_min = 0 and v_max = 10 then (select count(*) filter (where v >= 9) from a) end,
      'passives', case when v_min = 0 and v_max = 10 then (select count(*) filter (where v between 7 and 8) from a) end,
      'detractors', case when v_min = 0 and v_max = 10 then (select count(*) filter (where v <= 6) from a) end,
      'csat', case when v_max = 5 and v_n > 0 then (
        select round(100.0 * count(*) filter (where v >= 4) / count(*), 1) from a) end
    ) into v_stats;

  elsif v_type = 'number' then
    with a as (
      select ra.value_number as v from public.response_answers ra
      join unnest(p_ids) as f(id) on f.id = ra.response_id
      where ra.form_id = p_form_id and ra.question_key = v_key and ra.value_number is not null
    ),
    s as (
      select min(v) as lo, max(v) as hi, count(*) as n,
             greatest(1, ceil(ln(greatest(count(*), 1)) / ln(2) + 1))::integer as k -- Sturges
      from a
    )
    select jsonb_build_object(
      'min', s.lo, 'max', s.hi,
      'mean', (select round(avg(v), 2) from a),
      'median', (select percentile_cont(0.5) within group (order by v) from a),
      'p25', (select percentile_cont(0.25) within group (order by v) from a),
      'p75', (select percentile_cont(0.75) within group (order by v) from a),
      'p90', (select percentile_cont(0.9) within group (order by v) from a),
      'stddev', (select round(stddev_samp(v), 2) from a),
      'histogram', case when s.n = 0 then '[]'::jsonb
        when s.lo = s.hi then jsonb_build_array(jsonb_build_object('from', s.lo, 'to', s.hi, 'count', s.n))
        else (
          select jsonb_agg(jsonb_build_object(
                   'from', round(s.lo + (b.i - 1) * (s.hi - s.lo) / s.k, 4),
                   'to', round(s.lo + b.i * (s.hi - s.lo) / s.k, 4),
                   'count', coalesce(c.count, 0)) order by b.i)
          from generate_series(1, s.k) as b(i)
          left join (
            select least(width_bucket(v, s.lo, s.hi, s.k), s.k) as i, count(*) as count
            from a group by 1
          ) c on c.i = b.i)
        end
    ) into v_stats
    from s;

  elsif v_type = 'date' then
    with a as (
      select (ra.value_date at time zone 'UTC')::date as d from public.response_answers ra
      join unnest(p_ids) as f(id) on f.id = ra.response_id
      where ra.form_id = p_form_id and ra.question_key = v_key and ra.value_date is not null
    ),
    g as (
      select case when max(d) - min(d) <= 92 then 'day'
                  when max(d) - min(d) <= 730 then 'week'
                  else 'month' end as granularity
      from a
    )
    select jsonb_build_object(
      'granularity', g.granularity,
      'min', (select min(d) from a),
      'max', (select max(d) from a),
      'series', coalesce((
        select jsonb_agg(jsonb_build_object('t', to_char(t, 'YYYY-MM-DD'), 'count', c) order by t)
        from (select date_trunc(g.granularity, d)::date as t, count(*) as c from a group by 1) x), '[]'::jsonb),
      'weekdays', coalesce((
        select jsonb_agg(jsonb_build_object('dow', w.dow, 'count', coalesce(c.count, 0)) order by w.dow)
        from generate_series(1, 7) as w(dow)
        left join (select extract(isodow from d)::integer as dow, count(*) as count from a group by 1) c
          on c.dow = w.dow), '[]'::jsonb)
    ) into v_stats
    from g;

  elsif v_type in ('short_text', 'paragraph') then
    with a as (
      select ra.response_id, ra.value_text from public.response_answers ra
      join unnest(p_ids) as f(id) on f.id = ra.response_id
      where ra.form_id = p_form_id and ra.question_key = v_key and ra.value_text is not null
    )
    select jsonb_build_object(
      'avg_length', (select round(avg(char_length(value_text)), 1) from a),
      'terms', coalesce((
        select jsonb_agg(jsonb_build_object('term', term, 'count', c) order by c desc, term)
        from (
          select term, count(distinct a.response_id) as c
          from a, regexp_split_to_table(lower(a.value_text), '[^[:alnum:]]+') as term
          where char_length(term) >= 3
            and term !~ '^[0-9]+$'
            and term <> all (public._stop_words())
          group by term
          order by c desc, term
          limit 15
        ) t), '[]'::jsonb)
    ) into v_stats;

  else
    v_stats := '{}'::jsonb; -- email / phone: only counted
  end if;

  return v_base || coalesce(v_stats, '{}'::jsonb);
end;
$$;

-- Overview: totals, trends, timeline, heatmap, durations, splits, funnel, versions.
create or replace function public._dashboard_overview(p_form_id uuid, p_filters jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_from timestamptz := nullif(p_filters ->> 'from', '')::timestamptz;
  v_to timestamptz := nullif(p_filters ->> 'to', '')::timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_gran text;
  v_result jsonb;
begin
  select coalesce(v_from, min(r.submitted_at)), coalesce(v_to, now())
  into v_start, v_end
  from public._dashboard_responses(p_form_id, p_filters) r;

  v_gran := case
    when v_start is null then 'day'
    when v_end - v_start <= interval '2 days' then 'hour'
    when v_end - v_start <= interval '120 days' then 'day'
    else 'week' end;

  with f as (select * from public._dashboard_responses(p_form_id, p_filters)),
       nodates as (select * from public._dashboard_responses(p_form_id, p_filters, true)),
       local_now as (select now() at time zone 'Asia/Jakarta' as t)
  select jsonb_build_object(
    'total', (select count(*) from f),
    'today', (select count(*) from nodates, local_now
              where (nodates.submitted_at at time zone 'Asia/Jakarta')::date = local_now.t::date),
    'last7', (select count(*) from nodates where submitted_at >= now() - interval '7 days'),
    'prev7', (select count(*) from nodates
              where submitted_at >= now() - interval '14 days' and submitted_at < now() - interval '7 days'),
    'previous_period', case when v_from is not null and v_to is not null then (
      select count(*) from nodates
      where submitted_at >= v_from - (v_to - v_from) and submitted_at < v_from) end,
    'first_at', (select min(submitted_at) from f),
    'last_at', (select max(submitted_at) from f),
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
          select date_trunc(v_gran, submitted_at at time zone 'Asia/Jakarta') as t, count(*) as count
          from f group by 1
        ) c on c.t = b.t), '[]'::jsonb) end),
    'heatmap', coalesce((
      select jsonb_agg(jsonb_build_object('dow', dow, 'hour', hour, 'count', c) order by dow, hour)
      from (
        select extract(isodow from submitted_at at time zone 'Asia/Jakarta')::integer as dow,
               extract(hour from submitted_at at time zone 'Asia/Jakarta')::integer as hour,
               count(*) as c
        from f group by 1, 2
      ) h), '[]'::jsonb),
    'duration', (
      select jsonb_build_object(
        'n', count(duration_seconds),
        'mean', round(avg(duration_seconds), 1),
        'median', percentile_cont(0.5) within group (order by duration_seconds))
      from f where duration_seconds is not null),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('key', k, 'count', c) order by c desc, k)
      from (select coalesce(device, 'unknown') as k, count(*) as c from f group by 1) d), '[]'::jsonb),
    'locales', coalesce((
      select jsonb_agg(jsonb_build_object('key', k, 'count', c) order by c desc, k)
      from (select coalesce(locale, 'unknown') as k, count(*) as c from f group by 1) d), '[]'::jsonb),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'number', v.version_number,
                                          'published_at', v.published_at, 'count', coalesce(c.count, 0))
                       order by v.version_number)
      from public.form_versions v
      left join (select form_version_id, count(*) as count from f group by 1) c on c.form_version_id = v.id
      where v.form_id = p_form_id), '[]'::jsonb),
    -- Drafts are deleted on submit, so open drafts are the abandoned starts.
    'funnel', (
      select jsonb_build_object(
        'submitted', (select count(*) from f),
        'abandoned', count(*),
        'started', (select count(*) from f) + count(*))
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

-- Cross statistics of two questions over a set of response ids.
create or replace function public._cross_stats(p_form_id uuid, p_qa jsonb, p_qb jsonb, p_ids uuid[])
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_cat text[] := array['multiple_choice', 'dropdown', 'checkboxes'];
  v_num text[] := array['rating', 'linear_scale', 'number'];
  v_a jsonb := p_qa;
  v_b jsonb := p_qb;
  v_result jsonb;
begin
  if (v_a ->> 'type') = any (v_num) and (v_b ->> 'type') = any (v_cat) then
    v_a := p_qb; -- normalize: categorical first
    v_b := p_qa;
  end if;

  if (v_a ->> 'type') = any (v_cat) and (v_b ->> 'type') = any (v_cat) then
    with pa as (
      select ra.response_id, o from public.response_answers ra
      join unnest(p_ids) as f(id) on f.id = ra.response_id, unnest(ra.value_options) o
      where ra.form_id = p_form_id and ra.question_key = v_a ->> 'key'
    ), pb as (
      select ra.response_id, o from public.response_answers ra
      join unnest(p_ids) as f(id) on f.id = ra.response_id, unnest(ra.value_options) o
      where ra.form_id = p_form_id and ra.question_key = v_b ->> 'key'
    ), cells as (
      select pa.o as a, pb.o as b, count(*)::numeric as c from pa join pb using (response_id) group by 1, 2
    ), rows_ as (select a, sum(c) as r from cells group by a),
       cols as (select b, sum(c) as k from cells group by b),
       tot as (select sum(c) as n from cells),
       chi as (
         select sum(power(coalesce(cells.c, 0) - rows_.r * cols.k / tot.n, 2) / (rows_.r * cols.k / tot.n)) as chi2
         from rows_ cross join cols cross join tot
         left join cells on cells.a = rows_.a and cells.b = cols.b
       )
    select jsonb_build_object(
      'kind', 'cat_cat',
      'n', (select count(distinct pa.response_id) from pa join pb using (response_id)),
      'cells', coalesce((select jsonb_agg(jsonb_build_object('a', a, 'b', b, 'count', c) order by a, b) from cells), '[]'::jsonb),
      'chi2', (select round(chi2, 3) from chi),
      'cramers_v', (
        select case when least((select count(*) from rows_), (select count(*) from cols)) > 1 and tot.n > 0
          then round(sqrt(chi.chi2 / (tot.n * (least((select count(*) from rows_), (select count(*) from cols)) - 1))), 3)
        end
        from chi, tot)
    ) into v_result;

  elsif (v_a ->> 'type') = any (v_cat) and (v_b ->> 'type') = any (v_num) then
    with pa as (
      select ra.response_id, o from public.response_answers ra
      join unnest(p_ids) as f(id) on f.id = ra.response_id, unnest(ra.value_options) o
      where ra.form_id = p_form_id and ra.question_key = v_a ->> 'key'
    ), pb as (
      select ra.response_id, ra.value_number as v from public.response_answers ra
      join unnest(p_ids) as f(id) on f.id = ra.response_id
      where ra.form_id = p_form_id and ra.question_key = v_b ->> 'key' and ra.value_number is not null
    ), joined as (select pa.o, pb.v, pa.response_id from pa join pb using (response_id)),
       groups as (
         select o, count(*) as n, avg(v) as mean, stddev_samp(v) as sd from joined group by o
       ),
       overall as (select stddev_samp(v) as sd, count(distinct response_id) as n from joined)
    select jsonb_build_object(
      'kind', 'cat_num',
      'n', overall.n,
      'groups', coalesce((select jsonb_agg(jsonb_build_object('option', o, 'n', n, 'mean', round(mean, 2),
                                                             'stddev', round(sd, 2)) order by mean desc)
                          from groups), '[]'::jsonb),
      -- Standardized spread between the highest and lowest group mean (groups with n >= 5).
      'effect', (select case when overall.sd > 0 and count(*) >= 2
                   then round((max(mean) - min(mean)) / overall.sd, 3) end
                 from groups where n >= 5)
    ) into v_result
    from overall;

  elsif (v_a ->> 'type') = any (v_num) and (v_b ->> 'type') = any (v_num) then
    with pa as (
      select ra.response_id, ra.value_number as x from public.response_answers ra
      join unnest(p_ids) as f(id) on f.id = ra.response_id
      where ra.form_id = p_form_id and ra.question_key = v_a ->> 'key' and ra.value_number is not null
    ), pb as (
      select ra.response_id, ra.value_number as y from public.response_answers ra
      join unnest(p_ids) as f(id) on f.id = ra.response_id
      where ra.form_id = p_form_id and ra.question_key = v_b ->> 'key' and ra.value_number is not null
    )
    select jsonb_build_object(
      'kind', 'num_num',
      'n', count(*),
      -- Pearson r only with enough pairs.
      'r', case when count(*) >= 30 then round(corr(x, y)::numeric, 3) end,
      'points', (select jsonb_agg(jsonb_build_object('x', x, 'y', y))
                 from (select x, y from pa join pb using (response_id) limit 500) p)
    ) into v_result
    from pa join pb using (response_id);
  else
    v_result := jsonb_build_object('kind', 'unsupported', 'n', 0);
  end if;

  return jsonb_build_object('a', v_a ->> 'key', 'b', v_b ->> 'key')
         || v_result
         || jsonb_build_object('low_sample', coalesce((v_result ->> 'n')::integer, 0) < 30);
end;
$$;

-- -----------------------------------------------------------------------------
-- Public RPCs (authenticated with view access, or the secret key)
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_overview(p_form_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public._assert_can_view(p_form_id);
  return public._dashboard_overview(p_form_id, coalesce(p_filters, '{}'::jsonb));
end;
$$;

create or replace function public.question_stats(p_form_id uuid, p_question_key text, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_meta record;
  v_eligible integer;
begin
  perform public._assert_can_view(p_form_id);
  select * into v_meta from public._form_question_index(p_form_id) i where i.key = p_question_key;
  if not found then
    raise exception 'unknown question' using errcode = 'P0002';
  end if;
  select array_agg(r.id), count(*) filter (where r.form_version_id = any (v_meta.version_ids))
  into v_ids, v_eligible
  from public._dashboard_responses(p_form_id, coalesce(p_filters, '{}'::jsonb)) r;
  return public._question_stats(p_form_id, v_meta.meta, coalesce(v_ids, '{}'), cardinality(coalesce(v_ids, '{}')), v_eligible);
end;
$$;

create or replace function public.cross_stats(
  p_form_id uuid,
  p_question_a text,
  p_question_b text,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_a jsonb := public._question_meta(p_form_id, p_question_a);
  v_b jsonb := public._question_meta(p_form_id, p_question_b);
begin
  perform public._assert_can_view(p_form_id);
  if v_a is null or v_b is null then
    raise exception 'unknown question' using errcode = 'P0002';
  end if;
  select array_agg(r.id) into v_ids from public._dashboard_responses(p_form_id, coalesce(p_filters, '{}'::jsonb)) r;
  return public._cross_stats(p_form_id, v_a, v_b, coalesce(v_ids, '{}'));
end;
$$;

-- Ranked "possible relationships" between candidate questions (max 4).
create or replace function public.cross_suggestions(p_form_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_candidates jsonb[];
  v_stats jsonb;
  v_score numeric;
  v_metric text;
  v_value numeric;
  v_out jsonb := '[]'::jsonb;
begin
  perform public._assert_can_view(p_form_id);
  select array_agg(r.id) into v_ids from public._dashboard_responses(p_form_id, coalesce(p_filters, '{}'::jsonb)) r;
  if coalesce(cardinality(v_ids), 0) < 30 then
    return '[]'::jsonb;
  end if;

  -- Candidates from the current version: categorical (<= 8 options), rating/scale, number. Max 10.
  select array_agg(meta order by ord) into v_candidates
  from (
    select meta, ord from public._form_question_index(p_form_id)
    where in_current
      and ((meta ->> 'type') in ('rating', 'linear_scale', 'number')
           or ((meta ->> 'type') in ('multiple_choice', 'dropdown', 'checkboxes')
               and jsonb_array_length(coalesce(meta -> 'options', '[]'::jsonb)) between 2 and 8))
    order by ord
    limit 10
  ) c;

  if v_candidates is null then
    return '[]'::jsonb;
  end if;

  for v_i in 1 .. cardinality(v_candidates) loop
    for v_j in v_i + 1 .. cardinality(v_candidates) loop
      v_stats := public._cross_stats(p_form_id, v_candidates[v_i], v_candidates[v_j], v_ids);
      continue when coalesce((v_stats ->> 'n')::integer, 0) < 30;
      v_metric := null;
      if v_stats ->> 'kind' = 'cat_cat' and (v_stats ->> 'cramers_v')::numeric >= 0.2 then
        v_metric := 'cramers_v'; v_value := (v_stats ->> 'cramers_v')::numeric; v_score := v_value / 0.2;
      elsif v_stats ->> 'kind' = 'cat_num' and (v_stats ->> 'effect')::numeric >= 0.5 then
        v_metric := 'effect'; v_value := (v_stats ->> 'effect')::numeric; v_score := v_value / 0.5;
      elsif v_stats ->> 'kind' = 'num_num' and abs((v_stats ->> 'r')::numeric) >= 0.3 then
        v_metric := 'r'; v_value := (v_stats ->> 'r')::numeric; v_score := abs(v_value) / 0.3;
      end if;
      if v_metric is not null then
        v_out := v_out || jsonb_build_object(
          'a', v_stats ->> 'a', 'b', v_stats ->> 'b', 'kind', v_stats ->> 'kind',
          'metric', v_metric, 'value', v_value, 'score', round(v_score, 3), 'n', v_stats -> 'n');
      end if;
    end loop;
  end loop;

  return coalesce((
    select jsonb_agg(s order by (s ->> 'score')::numeric desc)
    from (select s from jsonb_array_elements(v_out) s order by (s ->> 'score')::numeric desc limit 4) top
  ), '[]'::jsonb);
end;
$$;

-- Everything the dashboard needs in one round trip.
create or replace function public.dashboard_bundle(p_form_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_ids uuid[];
  v_versions jsonb;
  v_questions jsonb := '{}'::jsonb;
  v_q record;
  v_eligible integer;
  v_total integer;
  v_form record;
begin
  perform public._assert_can_view(p_form_id);

  select f.title, f.description, f.created_at,
         coalesce(nullif(p.full_name, ''), p.email) as creator
  into v_form
  from public.forms f join public.profiles p on p.id = f.owner_id
  where f.id = p_form_id;

  select coalesce(array_agg(r.id), '{}') into v_ids
  from public._dashboard_responses(p_form_id, v_filters) r;
  v_total := cardinality(v_ids);

  select coalesce(jsonb_object_agg(form_version_id, c), '{}'::jsonb) into v_versions
  from (
    select r.form_version_id, count(*) as c
    from public.responses r join unnest(v_ids) as f(id) on f.id = r.id
    group by r.form_version_id
  ) vc;

  for v_q in select * from public._form_question_index(p_form_id) order by ord loop
    select coalesce(sum((v_versions ->> vid::text)::integer), 0) into v_eligible
    from unnest(v_q.version_ids) as vid;
    v_questions := v_questions || jsonb_build_object(
      v_q.key,
      public._question_stats(p_form_id, v_q.meta, v_ids, v_total, v_eligible)
        || jsonb_build_object('version_numbers', to_jsonb(v_q.version_numbers), 'in_current', v_q.in_current)
    );
  end loop;

  return jsonb_build_object(
    'generated_at', now(),
    'form', jsonb_build_object('title', v_form.title, 'description', v_form.description,
                               'created_at', v_form.created_at, 'creator', v_form.creator),
    'overview', public._dashboard_overview(p_form_id, v_filters),
    'questions', v_questions
  );
end;
$$;

-- Latest raw text answers (keyset pagination: submitted_at desc, response id desc).
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
    and (p_before_at is null or (r.submitted_at, r.id) < (p_before_at, p_before_id))
  order by r.submitted_at desc, r.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;

-- Responses table: keyset pagination, search, sort, masked identifiers for viewers.
-- p_cursor: { "v": <sort value as text>, "id": <uuid> } from the previous page.
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
volatile -- uses a temp table for the filtered id set
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

  create temp table if not exists _lr (id uuid primary key) on commit drop;
  truncate _lr;
  insert into _lr
  select r.id
  from public._dashboard_responses(p_form_id, coalesce(p_filters, '{}'::jsonb)) r
  join public.responses x on x.id = r.id
  where v_search is null
     or exists (select 1 from public.response_answers ra
                where ra.response_id = r.id and ra.value_text ilike '%' || v_search || '%')
     or (v_full and (x.identifier_email ilike '%' || v_search || '%' or x.identifier_phone like '%' || v_search || '%'));

  select count(*) into v_total from _lr;

  with page as (
    select r.*, v.version_number
    from public.responses r
    join _lr on _lr.id = r.id
    join public.form_versions v on v.id = r.form_version_id
    where p_cursor is null
       or (p_sort = 'oldest' and (r.submitted_at, r.id) > (v_cursor_ts, v_cursor_id))
       or (p_sort = 'duration_desc' and (coalesce(r.duration_seconds, -1), r.id) < (v_cursor_num, v_cursor_id))
       or (p_sort = 'duration_asc' and (coalesce(r.duration_seconds, -1), r.id) > (v_cursor_num, v_cursor_id))
       or (p_sort not in ('oldest', 'duration_desc', 'duration_asc') and (r.submitted_at, r.id) < (v_cursor_ts, v_cursor_id))
    order by
      case when p_sort = 'oldest' then r.submitted_at end asc,
      case when p_sort = 'duration_desc' then coalesce(r.duration_seconds, -1) end desc,
      case when p_sort = 'duration_asc' then coalesce(r.duration_seconds, -1) end asc,
      case when p_sort not in ('oldest', 'duration_desc', 'duration_asc') then r.submitted_at end desc,
      case when p_sort in ('oldest', 'duration_asc') then r.id end asc,
      r.id desc
    limit v_limit + 1
  )
  select jsonb_agg(jsonb_build_object(
           'id', p.id,
           'submitted_at', p.submitted_at,
           'version_number', p.version_number,
           'duration_seconds', p.duration_seconds,
           'device', p.device,
           'locale', p.locale,
           'identifier', case when v_full then coalesce(p.identifier_email, p.identifier_phone)
                              else coalesce(public.mask_email(p.identifier_email), public.mask_phone(p.identifier_phone)) end,
           'answers', coalesce((
             select jsonb_object_agg(ra.question_key, jsonb_strip_nulls(jsonb_build_object(
                      't', ra.value_text, 'n', ra.value_number,
                      'd', to_char(ra.value_date at time zone 'UTC', 'YYYY-MM-DD'), 'o', ra.value_options)))
             from public.response_answers ra where ra.response_id = p.id), '{}'::jsonb),
           'sort_v', case when p_sort in ('duration_desc', 'duration_asc') then coalesce(p.duration_seconds, -1)::text
                          else p.submitted_at::text end))
  into v_rows
  from (select * from page) p;

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
               'value_text', ra.value_text, 'value_number', ra.value_number,
               'value_date', to_char(ra.value_date at time zone 'UTC', 'YYYY-MM-DD'),
               'value_options', ra.value_options) order by ra.id)
      from public.response_answers ra where ra.response_id = v_r.id), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Demo data (is_demo = true). Used by `pnpm seed:demo` and Phase 5 scale tools.
-- Set-based: one INSERT per question over generate_series, with correlations:
-- a latent satisfaction score s ~ N(0,1) per response drives ratings, scales
-- and most choices; the 1st number question falls as s rises (e.g. waiting
-- time lowers the rating); the 2nd number question rises with the "segment"
-- (the first dropdown / multiple choice with >= 3 options, e.g. an older
-- channel). Conditional questions are only answered when visible.
-- -----------------------------------------------------------------------------
create or replace function public._demo_normal()
returns double precision
language sql
volatile
set search_path = ''
as $$
  select sqrt(-2 * ln(greatest(random(), 1e-12))) * cos(2 * pi() * random());
$$;

create or replace function public.generate_demo_responses(p_form_id uuid, p_n integer, p_days integer default 30)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
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

  create temp table if not exists _demo (
    response_id uuid primary key, s double precision, seg double precision
  ) on commit drop;
  truncate _demo;

  insert into _demo (response_id, s, seg)
  select gen_random_uuid(), public._demo_normal(), random()
  from generate_series(1, p_n);

  insert into public.responses (id, form_id, form_version_id, submitted_at, duration_seconds, locale, device, is_demo)
  select d.response_id, p_form_id, v_version_id,
         least(now(), (
           date_trunc('day', now() at time zone 'Asia/Jakarta')
           - make_interval(days => floor(power(random(), 1.3) * p_days)::integer)
           + make_interval(hours => 7 + floor(power(random(), 0.85) * 15)::integer,
                           mins => floor(random() * 60)::integer)
         ) at time zone 'Asia/Jakarta'),
         (90 + exp(4.2 + random() * 1.8))::integer,
         case when random() < 0.7 then 'id' else 'en' end,
         case when x.r < 0.62 then 'mobile' when x.r < 0.93 then 'desktop' else 'tablet' end,
         true
  from _demo d cross join lateral (select random() + 0 * d.s as r) x;

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
        from _demo d
        left join public.response_answers ra
          on ra.response_id = d.response_id and ra.question_key = v_cond ->> 'questionKey'
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
      from _demo d
      where (v_visible is null or d.response_id = any (v_visible)) and random() < v_rate;

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
      from _demo d
      where (v_visible is null or d.response_id = any (v_visible)) and random() < v_rate;

    elsif v_type = 'email' then
      insert into public.response_answers (response_id, form_id, question_key, question_type, value_text)
      select d.response_id, p_form_id, v_key, v_type, 'demo.' || left(md5(d.response_id::text), 8) || '@example.com'
      from _demo d
      where (v_visible is null or d.response_id = any (v_visible)) and random() < v_rate;

    elsif v_type = 'phone' then
      insert into public.response_answers (response_id, form_id, question_key, question_type, value_text)
      select d.response_id, p_form_id, v_key, v_type, '62812' || lpad(floor(random() * 100000000)::text, 8, '0')
      from _demo d
      where (v_visible is null or d.response_id = any (v_visible)) and random() < v_rate;

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
      from _demo d
      where (v_visible is null or d.response_id = any (v_visible)) and random() < v_rate;

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
      from _demo d
      where (v_visible is null or d.response_id = any (v_visible)) and random() < v_rate;

    elsif v_type in ('multiple_choice', 'dropdown') and v_k > 0 then
      insert into public.response_answers (response_id, form_id, question_key, question_type, value_options, value_text)
      select d.response_id, p_form_id, v_key, v_type,
             case when c.other then array['__other__'] else array[v_opts[c.idx + 1]] end,
             case when c.other then (array['Lainnya', 'Something else', 'Teman kantor'])[1 + floor(random() * 3)::integer] end
      from _demo d
      cross join lateral (
        select v_allow_other and random() < 0.05 as other,
               least(v_k - 1, greatest(0, case
                 when v_key = v_seg_key then floor(d.seg * v_k)
                 else floor(v_k / (1 + exp(1.7 * (0.9 * d.s + 0.6 * public._demo_normal()))))
               end))::integer as idx
      ) c
      where (v_visible is null or d.response_id = any (v_visible)) and random() < v_rate;

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
      from _demo d
      where (v_visible is null or d.response_id = any (v_visible)) and random() < v_rate;

    elsif v_type = 'date' then
      insert into public.response_answers (response_id, form_id, question_key, question_type, value_date)
      select d.response_id, p_form_id, v_key, v_type,
             ((current_date - floor(power(random(), 1.4) * p_days)::integer)::timestamp at time zone 'UTC')
      from _demo d
      where (v_visible is null or d.response_id = any (v_visible)) and random() < v_rate;
    end if;
  end loop;

  -- Abandoned drafts for the completion funnel (about 18% of starts).
  insert into public.response_drafts (form_id, version_id, data, updated_at, expires_at)
  select p_form_id, v_version_id, '{"demo": true}'::jsonb,
         now() - make_interval(secs => floor(random() * p_days * 86400)::integer),
         now() + interval '30 days'
  from generate_series(1, ceil(p_n * 0.18)::integer);

  return p_n;
end;
$$;

create or replace function public.delete_demo_responses(p_form_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.responses r where r.form_id = p_form_id and r.is_demo;
  get diagnostics v_count = row_count;
  delete from public.response_drafts d where d.form_id = p_form_id and d.data ->> 'demo' = 'true';
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  -- Internal helpers: owner only (called from SECURITY DEFINER functions).
  foreach fn in array array[
    'public._assert_can_view(uuid)',
    'public._can_see_identifiers(uuid)',
    'public._stop_words()',
    'public._question_meta(uuid, text)',
    'public._dashboard_responses(uuid, jsonb, boolean)',
    'public._form_question_index(uuid)',
    'public._question_stats(uuid, jsonb, uuid[], integer, integer)',
    'public._dashboard_overview(uuid, jsonb)',
    'public._cross_stats(uuid, jsonb, jsonb, uuid[])',
    'public._demo_normal()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
  end loop;

  -- Analytics: signed-in users with view access (checked inside) and the secret key.
  foreach fn in array array[
    'public.dashboard_overview(uuid, jsonb)',
    'public.question_stats(uuid, text, jsonb)',
    'public.cross_stats(uuid, text, text, jsonb)',
    'public.cross_suggestions(uuid, jsonb)',
    'public.dashboard_bundle(uuid, jsonb)',
    'public.question_text_answers(uuid, text, jsonb, timestamptz, uuid, integer)',
    'public.list_responses(uuid, jsonb, text, text, jsonb, integer)',
    'public.get_response(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;

  -- Demo data: secret key only.
  foreach fn in array array[
    'public.generate_demo_responses(uuid, integer, integer)',
    'public.delete_demo_responses(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;

  -- Masking helpers are harmless pure functions.
  execute 'revoke all on function public.mask_email(text) from public, anon';
  execute 'revoke all on function public.mask_phone(text) from public, anon';
  execute 'grant execute on function public.mask_email(text) to authenticated, service_role';
  execute 'grant execute on function public.mask_phone(text) to authenticated, service_role';
end;
$$;
