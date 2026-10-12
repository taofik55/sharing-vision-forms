-- =============================================================================
-- Phase 4 performance, step 2 (_bundle_questions):
-- * without row filters the form's answers are read directly (no join to the
--   filtered response set);
-- * counts, numeric stats, quantiles, average selections and text length come
--   from ONE aggregate pass instead of four;
-- * top terms are computed from at most 2,000 answers per question
--   (deterministic sample by response id), reported as terms_based_on.
-- =============================================================================

create or replace function public._bundle_questions(p_form_id uuid, p_filters jsonb, p_only_key text default null)
returns jsonb
language plpgsql
stable
set search_path = ''
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
begin
  v_unfiltered := nullif(v_filters ->> 'from', '') is null and nullif(v_filters ->> 'to', '') is null
    and coalesce(jsonb_array_length(case when jsonb_typeof(v_filters -> 'versionIds') = 'array' then v_filters -> 'versionIds' end), 0) = 0
    and coalesce(jsonb_array_length(case when jsonb_typeof(v_filters -> 'answers') = 'array' then v_filters -> 'answers' end), 0) = 0
    and nullif(v_filters ->> 'device', '') is null and nullif(v_filters ->> 'locale', '') is null;

  with f as materialized (
    select r.id, r.form_version_id from public._dashboard_responses(p_form_id, v_filters) r
  ),
  a as materialized (
    select ra.question_key as k, ra.question_type as t, ra.response_id, ra.value_text, ra.value_number,
           ra.value_date, ra.value_options
    from public.response_answers ra
    where ra.form_id = p_form_id
      and (p_only_key is null or ra.question_key = p_only_key)
      and (v_unfiltered or ra.response_id in (select f.id from f))
  ),
  agg as (
    select k, count(*) as answered,
           count(value_number) as n, min(value_number) as lo, max(value_number) as hi,
           avg(value_number) as mean, stddev_samp(value_number) as sd,
           percentile_cont(array[0.25, 0.5, 0.75, 0.9]) within group (order by value_number) as q,
           greatest(1, ceil(ln(greatest(count(value_number), 1)) / ln(2) + 1))::integer as buckets,
           round(avg(cardinality(value_options)) filter (where t = 'checkboxes'), 2) as avgsel,
           round(avg(char_length(value_text)) filter (where t in ('short_text', 'paragraph')), 1) as textlen
    from a group by k
  ),
  nums as (select * from agg where n > 0),
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
