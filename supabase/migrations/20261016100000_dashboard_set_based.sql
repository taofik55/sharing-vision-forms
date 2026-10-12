-- =============================================================================
-- Phase 4 performance: set-based question statistics and cross analysis.
--
-- The first version computed stats question by question over an array of
-- response ids. At 10k responses that became 10k-iteration nested loops per
-- question (11–30 s per bundle, worse once PL/pgSQL switched to generic
-- plans). Now:
--   * the filtered responses and their answers are read ONCE per call
--     (hash join), and every statistic is a GROUP BY question_key over that set;
--   * per-question JSON is assembled from those aggregate maps;
--   * cross analysis joins the filtered set instead of an id array, and the
--     suggestions evaluate all candidate pairs in one statement.
-- Output shapes are unchanged.
-- =============================================================================

-- All question statistics for the filtered responses (optionally one key).
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
begin
  with f as materialized (
    select r.id, r.form_version_id from public._dashboard_responses(p_form_id, coalesce(p_filters, '{}'::jsonb)) r
  ),
  a as materialized (
    select ra.question_key as k, ra.question_type as t, ra.response_id, ra.value_text, ra.value_number,
           ra.value_date, ra.value_options
    from public.response_answers ra
    join f on f.id = ra.response_id
    where ra.form_id = p_form_id and (p_only_key is null or ra.question_key = p_only_key)
  ),
  nums as (
    select k, min(value_number) as lo, max(value_number) as hi, count(*) as n,
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
    (select coalesce(jsonb_object_agg(k, c), '{}') from (select k, count(*) as c from a group by k) x),
    (select coalesce(jsonb_object_agg(k, arr), '{}') from (
       select k, jsonb_agg(jsonb_build_object('id', o, 'count', c) order by c desc, o) as arr
       from (select k, o, count(*) as c from a, unnest(a.value_options) o group by k, o) x group by k) y),
    (select coalesce(jsonb_object_agg(k, v), '{}') from (
       select k, round(avg(cardinality(value_options)), 2) as v from a where t = 'checkboxes' group by k) x),
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
         from a, regexp_split_to_table(lower(a.value_text), '[^[:alnum:]]+') as term
         where a.t in ('short_text', 'paragraph') and char_length(term) >= 3 and term !~ '^[0-9]+$'
           and term <> all (public._stop_words())
         group by a.k, term
       ) x where rn <= 15 group by k) y),
    (select coalesce(jsonb_object_agg(k, v), '{}') from (
       select k, round(avg(char_length(value_text)), 1) as v from a
       where t in ('short_text', 'paragraph') and value_text is not null group by k) x)
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
        'terms', coalesce(v_terms -> v_key, '[]'::jsonb));
    end if;

    v_out := v_out || jsonb_build_object(v_key, v_stats);
  end loop;

  return v_out;
end;
$$;

-- Cross statistics over the filtered responses (hash joins, no id arrays).
create or replace function public._cross_stats_f(p_form_id uuid, p_qa jsonb, p_qb jsonb, p_filters jsonb)
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
    v_a := p_qb; -- categorical first
    v_b := p_qa;
  end if;

  if (v_a ->> 'type') = any (v_cat) and (v_b ->> 'type') = any (v_cat) then
    with f as materialized (select r.id from public._dashboard_responses(p_form_id, coalesce(p_filters, '{}'::jsonb)) r),
    pa as (select ra.response_id, o from public.response_answers ra join f on f.id = ra.response_id, unnest(ra.value_options) o
           where ra.form_id = p_form_id and ra.question_key = v_a ->> 'key'),
    pb as (select ra.response_id, o from public.response_answers ra join f on f.id = ra.response_id, unnest(ra.value_options) o
           where ra.form_id = p_form_id and ra.question_key = v_b ->> 'key'),
    cells as (select pa.o as a, pb.o as b, count(*)::numeric as c from pa join pb using (response_id) group by 1, 2),
    rows_ as (select a, sum(c) as r from cells group by a),
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
          then round(sqrt(chi.chi2 / (tot.n * (least((select count(*) from rows_), (select count(*) from cols)) - 1))), 3) end
        from chi, tot)
    ) into v_result;

  elsif (v_a ->> 'type') = any (v_cat) and (v_b ->> 'type') = any (v_num) then
    with f as materialized (select r.id from public._dashboard_responses(p_form_id, coalesce(p_filters, '{}'::jsonb)) r),
    pa as (select ra.response_id, o from public.response_answers ra join f on f.id = ra.response_id, unnest(ra.value_options) o
           where ra.form_id = p_form_id and ra.question_key = v_a ->> 'key'),
    pb as (select ra.response_id, ra.value_number as v from public.response_answers ra join f on f.id = ra.response_id
           where ra.form_id = p_form_id and ra.question_key = v_b ->> 'key' and ra.value_number is not null),
    joined as (select pa.o, pb.v, pa.response_id from pa join pb using (response_id)),
    groups as (select o, count(*) as n, avg(v) as mean, stddev_samp(v) as sd from joined group by o),
    overall as (select stddev_samp(v) as sd, count(distinct response_id) as n from joined)
    select jsonb_build_object(
      'kind', 'cat_num',
      'n', overall.n,
      'groups', coalesce((select jsonb_agg(jsonb_build_object('option', o, 'n', n, 'mean', round(mean, 2),
                                                             'stddev', round(sd, 2)) order by mean desc) from groups), '[]'::jsonb),
      'effect', (select case when overall.sd > 0 and count(*) >= 2 then round((max(mean) - min(mean)) / overall.sd, 3) end
                 from groups where n >= 5)
    ) into v_result
    from overall;

  elsif (v_a ->> 'type') = any (v_num) and (v_b ->> 'type') = any (v_num) then
    with f as materialized (select r.id from public._dashboard_responses(p_form_id, coalesce(p_filters, '{}'::jsonb)) r),
    pa as (select ra.response_id, ra.value_number as x from public.response_answers ra join f on f.id = ra.response_id
           where ra.form_id = p_form_id and ra.question_key = v_a ->> 'key' and ra.value_number is not null),
    pb as (select ra.response_id, ra.value_number as y from public.response_answers ra join f on f.id = ra.response_id
           where ra.form_id = p_form_id and ra.question_key = v_b ->> 'key' and ra.value_number is not null),
    j as (select x, y from pa join pb using (response_id))
    select jsonb_build_object(
      'kind', 'num_num',
      'n', (select count(*) from j),
      'r', (select case when count(*) >= 30 then round(corr(x, y)::numeric, 3) end from j),
      'points', (select jsonb_agg(jsonb_build_object('x', x, 'y', y)) from (select x, y from j limit 500) p)
    ) into v_result;
  else
    v_result := jsonb_build_object('kind', 'unsupported', 'n', 0);
  end if;

  return jsonb_build_object('a', v_a ->> 'key', 'b', v_b ->> 'key')
         || v_result
         || jsonb_build_object('low_sample', coalesce((v_result ->> 'n')::integer, 0) < 30);
end;
$$;

-- -----------------------------------------------------------------------------
-- Public RPCs now use the set-based helpers (signatures unchanged).
-- -----------------------------------------------------------------------------
create or replace function public.question_stats(p_form_id uuid, p_question_key text, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform public._assert_can_view(p_form_id);
  v_result := public._bundle_questions(p_form_id, coalesce(p_filters, '{}'::jsonb), p_question_key) -> p_question_key;
  if v_result is null then
    raise exception 'unknown question' using errcode = 'P0002';
  end if;
  return v_result - 'version_numbers' - 'in_current';
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
  v_a jsonb := public._question_meta(p_form_id, p_question_a);
  v_b jsonb := public._question_meta(p_form_id, p_question_b);
begin
  perform public._assert_can_view(p_form_id);
  if v_a is null or v_b is null then
    raise exception 'unknown question' using errcode = 'P0002';
  end if;
  return public._cross_stats_f(p_form_id, v_a, v_b, p_filters);
end;
$$;

create or replace function public.dashboard_bundle(p_form_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_form record;
begin
  perform public._assert_can_view(p_form_id);
  select f.title, f.description, f.created_at, coalesce(nullif(p.full_name, ''), p.email) as creator
  into v_form
  from public.forms f join public.profiles p on p.id = f.owner_id
  where f.id = p_form_id;

  return jsonb_build_object(
    'generated_at', now(),
    'form', jsonb_build_object('title', v_form.title, 'description', v_form.description,
                               'created_at', v_form.created_at, 'creator', v_form.creator),
    'overview', public._dashboard_overview(p_form_id, v_filters),
    'questions', public._bundle_questions(p_form_id, v_filters)
  );
end;
$$;

-- Suggestions: every candidate pair (max 10 candidates) in one statement.
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

  with f as materialized (
    select r.id from public._dashboard_responses(p_form_id, coalesce(p_filters, '{}'::jsonb)) r
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
           abs(r) / 0.3 as score, n
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

-- Fresh planner statistics after bulk demo inserts (secret key only).
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
end;
$$;

drop function public._cross_stats(uuid, jsonb, jsonb, uuid[]);
drop function public._question_stats(uuid, jsonb, uuid[], integer, integer);

revoke all on function public._bundle_questions(uuid, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public._cross_stats_f(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.analyze_response_tables() from public, anon, authenticated;
grant execute on function public.analyze_response_tables() to service_role;
