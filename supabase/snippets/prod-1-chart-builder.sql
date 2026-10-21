-- =============================================================================
-- LANGKAH 1: chart builder (dashboard_query)
-- Isi: 20261018090000_chart_builder_query.sql + 20261018100000_chart_builder_query_perf.sql.
-- Lewati jika langkah 0 menunjukkan 20261018090000 dan 20261018100000 sudah ada.
-- Satu transaksi: kalau ada error, tidak ada yang berubah.
-- =============================================================================

begin;

-- =============================================================================
-- Chart builder: dashboard_query(form_id, spec, filters)
--
-- Runs one custom chart (src/lib/analytics/chart-spec.ts) as an aggregate in
-- Postgres. Access: _assert_can_view (signed-in users with view access, or the
-- secret key after the share API resolved a token). Output is bounded: at most
-- 500 groups (100 x 50 for two dimensions), 2,000 scatter points.
--
-- Safety: the SQL text is assembled only from fixed fragments chosen by
-- whitelisted spec values (chart, aggregation, grain, field kind). Question
-- keys, filter values and the global filters are bound parameters ($1..$4);
-- numbers that end up in the text (bin edges, limits, indexes) are computed
-- here and cast to numeric / integer first. Email and phone answers can never
-- be chart columns.
-- =============================================================================

-- Type of a chart field: category | multi | number | date | text | time |
-- device | locale | version | duration. Raises 22023 for anything else.
create or replace function public._chart_field_type(p_form_id uuid, p_field jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_type text;
begin
  if p_field ->> 'kind' = 'meta' then
    v_type := case p_field ->> 'field'
      when 'submitted_at' then 'time'
      when 'device' then 'device'
      when 'locale' then 'locale'
      when 'version' then 'version'
      when 'duration' then 'duration'
    end;
  elsif p_field ->> 'kind' = 'question' then
    select case i.meta ->> 'type'
             when 'multiple_choice' then 'category'
             when 'dropdown' then 'category'
             when 'checkboxes' then 'multi'
             when 'number' then 'number'
             when 'rating' then 'number'
             when 'linear_scale' then 'number'
             when 'date' then 'date'
             when 'short_text' then 'text'
             when 'paragraph' then 'text'
           end
    into v_type
    from public._form_question_index(p_form_id) i
    where i.key = p_field ->> 'key';
  end if;
  if v_type is null then
    raise exception 'invalid chart field' using errcode = '22023';
  end if;
  return v_type;
end;
$$;

create or replace function public.dashboard_query(
  p_form_id uuid,
  p_spec jsonb,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set work_mem = '32MB'
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_spec jsonb := coalesce(p_spec, '{}'::jsonb);
  v_chart text := v_spec ->> 'chart';
  v_dims jsonb := coalesce(v_spec -> 'dimensions', '[]'::jsonb);
  v_metrics jsonb := coalesce(v_spec -> 'metrics', '[]'::jsonb);
  v_cfilters jsonb := coalesce(v_spec -> 'filters', '[]'::jsonb);
  v_limit integer := least(greatest(coalesce((v_spec ->> 'limit')::integer, 20), 1), 500);
  v_include_empty boolean := coalesce((v_spec -> 'options' ->> 'includeEmpty')::boolean, false);
  v_sort_dim boolean := (v_spec -> 'sort' ->> 'by') = 'dimension';
  v_dir text := case when (v_spec -> 'sort' ->> 'dir') = 'asc' then 'asc' else 'desc' end;
  v_keys text[] := '{}';
  v_ndims integer;
  v_nmetrics integer;
  v_cols text := '';
  v_joins text := '';
  v_where text := 'true';
  v_base text;
  v_dim_src text[] := '{}';      -- lateral producer per dimension
  v_dim_num boolean[] := '{}';   -- numeric sort per dimension
  v_metric_val text[] := '{}';   -- value column per metric
  v_metric_agg text[] := '{}';   -- aggregate per metric (over p)
  v_bins jsonb := '{}'::jsonb;
  v_sql text;
  v_result jsonb;
  v_field jsonb;
  v_type text;
  v_expr text;
  v_grain text;
  v_n integer;
  v_lo numeric;
  v_hi numeric;
  v_agg text;
  v_op text;
  v_vals text;
  v_dim_list text := '';
  v_group text := '';
  i integer;
begin
  perform public._assert_can_view(p_form_id);

  if v_chart is null or v_chart not in (
    'kpi', 'bar', 'column', 'line', 'area', 'donut', 'table', 'pivot', 'heatmap', 'scatter', 'histogram'
  ) then
    raise exception 'invalid chart' using errcode = '22023';
  end if;
  if jsonb_typeof(v_dims) <> 'array' or jsonb_typeof(v_metrics) <> 'array' or jsonb_typeof(v_cfilters) <> 'array' then
    raise exception 'invalid chart spec' using errcode = '22023';
  end if;
  v_ndims := jsonb_array_length(v_dims);
  v_nmetrics := jsonb_array_length(v_metrics);
  if v_ndims > 2 or v_nmetrics > 5 or jsonb_array_length(v_cfilters) > 10 then
    raise exception 'chart spec too large' using errcode = '22023';
  end if;

  -- ------------------------------------------------------------------ fields
  -- Question keys become columns o<i> / n<i> / t<i> / x<i> of a left-joined
  -- answer a<i> on the "base" row (one row per filtered response).

  -- Scatter: two numeric fields, one point per response.
  if v_chart = 'scatter' then
    for v_field in select value from jsonb_array_elements(jsonb_build_array(v_spec -> 'x', v_spec -> 'y')) loop
      if v_field is null or jsonb_typeof(v_field) <> 'object' then
        raise exception 'scatter needs x and y' using errcode = '22023';
      end if;
      v_type := public._chart_field_type(p_form_id, v_field);
      if v_type not in ('number', 'duration') then
        raise exception 'scatter needs numeric fields' using errcode = '22023';
      end if;
    end loop;
  end if;

  -- Collect question keys (dimensions, metric fields, filters, x / y).
  for v_field in
    select d -> 'field' from jsonb_array_elements(v_dims) d
    union all select m -> 'field' from jsonb_array_elements(v_metrics) m where m ? 'field'
    union all select f -> 'field' from jsonb_array_elements(v_cfilters) f
    union all select v_spec -> 'x' where v_chart = 'scatter'
    union all select v_spec -> 'y' where v_chart = 'scatter'
  loop
    perform public._chart_field_type(p_form_id, v_field); -- validates
    if v_field ->> 'kind' = 'question' and not ((v_field ->> 'key') = any (v_keys)) then
      v_keys := array_append(v_keys, ((v_field ->> 'key')));
    end if;
  end loop;

  for i in 1 .. coalesce(array_length(v_keys, 1), 0) loop
    v_cols := v_cols || format(
      ', a%1$s.value_options as o%1$s, a%1$s.value_number as n%1$s, a%1$s.value_date as t%1$s, a%1$s.value_text as x%1$s', i);
    v_joins := v_joins || format(
      ' left join public.response_answers a%1$s on a%1$s.response_id = r.id and a%1$s.form_id = $1 and a%1$s.question_key = $3[%1$s]', i);
  end loop;

  -- ----------------------------------------------------------- chart filters
  for i in 0 .. jsonb_array_length(v_cfilters) - 1 loop
    v_field := v_cfilters -> i -> 'field';
    v_type := public._chart_field_type(p_form_id, v_field);
    v_op := v_cfilters -> i ->> 'op';
    v_n := case when v_field ->> 'kind' = 'question' then array_position(v_keys, v_field ->> 'key') end;
    v_expr := case v_type
      when 'category' then format('a%s.value_options', v_n)
      when 'multi' then format('a%s.value_options', v_n)
      when 'number' then format('a%s.value_number', v_n)
      when 'date' then format('to_char(a%s.value_date at time zone ''UTC'', ''YYYY-MM-DD'')', v_n)
      when 'text' then format('nullif(btrim(a%s.value_text), '''')', v_n)
      when 'time' then 'r.submitted_at'
      when 'device' then 'coalesce(r.device, ''unknown'')'
      when 'locale' then 'coalesce(r.locale, ''unknown'')'
      when 'version' then 'fv.version_number'
      when 'duration' then 'r.duration_seconds'
    end;
    -- Bound values: $4 -> 'filters' -> i -> 'values'.
    v_vals := format('($4 -> ''filters'' -> %s -> ''values'')', i);
    v_where := v_where || ' and ' || case
      when v_op = 'is_answered' and v_type in ('category', 'multi') then format('coalesce(cardinality(%s), 0) > 0', v_expr)
      when v_op = 'is_empty' and v_type in ('category', 'multi') then format('coalesce(cardinality(%s), 0) = 0', v_expr)
      when v_op = 'is_answered' then format('%s is not null', v_expr)
      when v_op = 'is_empty' then format('%s is null', v_expr)
      when v_op in ('in', 'not_in') and v_type in ('category', 'multi') then format(
        '%scoalesce(%s && array(select jsonb_array_elements_text(%s)), false)',
        case when v_op = 'not_in' then 'not ' else '' end, v_expr, v_vals)
      when v_op in ('in', 'not_in') and v_type in ('number', 'duration', 'version') then format(
        '%scoalesce(%s = any (array(select (e)::numeric from jsonb_array_elements_text(%s) e where e ~ ''^-?[0-9]+(\.[0-9]+)?$'')), false)',
        case when v_op = 'not_in' then 'not ' else '' end, v_expr, v_vals)
      when v_op in ('in', 'not_in') and v_type in ('date', 'text', 'device', 'locale') then format(
        '%scoalesce(%s = any (array(select jsonb_array_elements_text(%s))), false)',
        case when v_op = 'not_in' then 'not ' else '' end, v_expr, v_vals)
      when v_op in ('gt', 'lt') and v_type in ('number', 'duration', 'version') then format(
        'coalesce(%s %s (select (e)::numeric from jsonb_array_elements_text(%s) e where e ~ ''^-?[0-9]+(\.[0-9]+)?$'' limit 1), false)',
        v_expr, case when v_op = 'gt' then '>' else '<' end, v_vals)
      when v_op in ('gt', 'lt') and v_type = 'date' then format(
        'coalesce(%s %s (select e from jsonb_array_elements_text(%s) e where e ~ ''^\d{4}-\d{2}-\d{2}$'' limit 1), false)',
        v_expr, case when v_op = 'gt' then '>' else '<' end, v_vals)
      when v_op in ('gt', 'lt') and v_type = 'time' then format(
        'coalesce(%s %s (select (e)::timestamptz from jsonb_array_elements_text(%s) e where e ~ ''^\d{4}-\d{2}-\d{2}'' limit 1), false)',
        v_expr, case when v_op = 'gt' then '>' else '<' end, v_vals)
      else null
    end;
    if v_where is null then
      raise exception 'invalid chart filter' using errcode = '22023';
    end if;
  end loop;

  v_base := format(
    'base as materialized (select r.id, r.submitted_at, r.device, r.locale, r.duration_seconds, fv.version_number%s
       from public._dashboard_responses($1, $2) r
       join public.form_versions fv on fv.id = r.form_version_id%s
      where %s)',
    v_cols, v_joins, v_where);

  -- ---------------------------------------------------------------- scatter
  if v_chart = 'scatter' then
    v_sql := format(
      'with %1$s, pts as (select %2$s::double precision as x, %3$s::double precision as y from base where %2$s is not null and %3$s is not null)
       select jsonb_build_object(
         ''total'', (select count(*) from base),
         ''n'', (select count(*) from pts),
         ''r'', (select case when count(*) >= 3 then round(corr(x, y)::numeric, 3) end from pts),
         ''points'', coalesce((select jsonb_agg(jsonb_build_array(x, y)) from (select x, y from pts limit 2000) s), ''[]''::jsonb))',
      v_base,
      case when v_spec -> 'x' ->> 'kind' = 'meta' then 'duration_seconds'
           else format('n%s', array_position(v_keys, v_spec -> 'x' ->> 'key')) end,
      case when v_spec -> 'y' ->> 'kind' = 'meta' then 'duration_seconds'
           else format('n%s', array_position(v_keys, v_spec -> 'y' ->> 'key')) end);
    execute v_sql into v_result using p_form_id, coalesce(p_filters, '{}'::jsonb), v_keys, v_spec;
    return v_result || jsonb_build_object('kind', 'scatter');
  end if;

  -- ------------------------------------------------------------- dimensions
  if v_chart in ('pivot', 'heatmap') and v_ndims <> 2 then
    raise exception 'chart needs two dimensions' using errcode = '22023';
  end if;
  if v_chart in ('bar', 'column', 'line', 'area', 'donut', 'histogram') and v_ndims < 1 then
    raise exception 'chart needs a dimension' using errcode = '22023';
  end if;
  if v_chart = 'kpi' and v_ndims > 0 then
    raise exception 'kpi has no dimension' using errcode = '22023';
  end if;
  if v_chart = 'donut' and v_ndims > 1 then
    raise exception 'donut has one dimension' using errcode = '22023';
  end if;

  for i in 0 .. v_ndims - 1 loop
    v_field := v_dims -> i -> 'field';
    v_type := public._chart_field_type(p_form_id, v_field);
    v_n := case when v_field ->> 'kind' = 'question' then array_position(v_keys, v_field ->> 'key') end;
    v_grain := coalesce(v_dims -> i ->> 'grain', 'day');
    if v_grain not in ('hour', 'day', 'week', 'month', 'weekday', 'hour_of_day') then
      raise exception 'invalid grain' using errcode = '22023';
    end if;

    if v_type in ('number', 'duration') and (v_dims -> i ? 'bins' or v_chart = 'histogram') then
      v_expr := case when v_type = 'number' then format('n%s', v_n) else 'duration_seconds' end;
      execute format('with %s select min(%s), max(%s) from base', v_base, v_expr, v_expr)
        into v_lo, v_hi using p_form_id, coalesce(p_filters, '{}'::jsonb), v_keys, v_spec;
      v_n := least(greatest(coalesce((v_dims -> i ->> 'bins')::integer, 10), 2), 50);
      v_lo := coalesce(v_lo, 0);
      v_hi := coalesce(v_hi, v_lo);
      v_bins := v_bins || jsonb_build_object(i::text, jsonb_build_object('lo', v_lo, 'hi', v_hi, 'n', v_n));
      v_dim_src := array_append(v_dim_src, (format(
        '(select case when %1$s is null then null when %3$s > %2$s then least(width_bucket(%1$s, %2$s, %3$s, %4$s), %4$s)::text else ''1'' end)',
        v_expr, v_lo::numeric, v_hi::numeric, v_n)));
      v_dim_num := array_append(v_dim_num, (true));
    elsif v_chart = 'histogram' then
      raise exception 'histogram needs a numeric dimension' using errcode = '22023';
    else
      v_dim_src := array_append(v_dim_src, (case v_type
        when 'category' then format('unnest(case when coalesce(cardinality(o%1$s), 0) = 0 then array[null::text] else o%1$s end)', v_n)
        when 'multi' then format('unnest(case when coalesce(cardinality(o%1$s), 0) = 0 then array[null::text] else o%1$s end)', v_n)
        when 'number' then format('(select trim_scale(n%s)::text)', v_n)
        when 'duration' then '(select duration_seconds::text)'
        when 'text' then format('(select nullif(btrim(x%s), ''''))', v_n)
        when 'device' then '(select coalesce(device, ''unknown''))'
        when 'locale' then '(select coalesce(locale, ''unknown''))'
        when 'version' then '(select version_number::text)'
        when 'date' then case v_grain
          when 'week' then format('(select to_char(date_trunc(''week'', t%s at time zone ''UTC''), ''YYYY-MM-DD''))', v_n)
          when 'month' then format('(select to_char(t%s at time zone ''UTC'', ''YYYY-MM''))', v_n)
          when 'weekday' then format('(select extract(isodow from t%s at time zone ''UTC'')::integer::text)', v_n)
          else format('(select to_char(t%s at time zone ''UTC'', ''YYYY-MM-DD''))', v_n)
        end
        when 'time' then case v_grain
          when 'hour' then '(select to_char(date_trunc(''hour'', submitted_at at time zone ''Asia/Jakarta''), ''YYYY-MM-DD"T"HH24:00''))'
          when 'week' then '(select to_char(date_trunc(''week'', submitted_at at time zone ''Asia/Jakarta''), ''YYYY-MM-DD''))'
          when 'month' then '(select to_char(submitted_at at time zone ''Asia/Jakarta'', ''YYYY-MM''))'
          when 'weekday' then '(select extract(isodow from submitted_at at time zone ''Asia/Jakarta'')::integer::text)'
          when 'hour_of_day' then '(select extract(hour from submitted_at at time zone ''Asia/Jakarta'')::integer::text)'
          else '(select to_char(submitted_at at time zone ''Asia/Jakarta'', ''YYYY-MM-DD''))'
        end
      end));
      v_dim_num := array_append(v_dim_num, ((
        v_type in ('number', 'duration', 'version')
        or (v_type in ('date', 'time') and v_grain in ('weekday', 'hour_of_day')))));
    end if;
  end loop;

  -- ---------------------------------------------------------------- metrics
  if v_nmetrics < 1 then
    raise exception 'chart needs a metric' using errcode = '22023';
  end if;
  for i in 0 .. v_nmetrics - 1 loop
    v_agg := v_metrics -> i ->> 'agg';
    if v_agg is null or v_agg not in ('count', 'percent', 'avg', 'median', 'min', 'max', 'sum', 'nps', 'csat') then
      raise exception 'invalid aggregation' using errcode = '22023';
    end if;
    if v_agg in ('count', 'percent') then
      v_metric_val := array_append(v_metric_val, ('null::numeric'));
    else
      v_field := v_metrics -> i -> 'field';
      if v_field is null then
        raise exception 'aggregation needs a field' using errcode = '22023';
      end if;
      v_type := public._chart_field_type(p_form_id, v_field);
      if v_type not in ('number', 'duration') then
        raise exception 'aggregation needs a numeric field' using errcode = '22023';
      end if;
      v_metric_val := array_append(v_metric_val, (case when v_type = 'number'
        then format('n%s', array_position(v_keys, v_field ->> 'key'))
        else 'duration_seconds::numeric' end));
    end if;
    v_metric_agg := array_append(v_metric_agg, (case v_agg
      when 'count' then 'count(distinct p.id)'
      when 'percent' then 'round(100.0 * count(distinct p.id) / nullif((select count(*) from base), 0), 1)'
      when 'avg' then format('round(avg(p.v%s), 2)', i)
      when 'median' then format('percentile_cont(0.5) within group (order by p.v%s)', i)
      when 'min' then format('min(p.v%s)', i)
      when 'max' then format('max(p.v%s)', i)
      when 'sum' then format('sum(p.v%s)', i)
      when 'nps' then format(
        'round(100.0 * (count(*) filter (where p.v%1$s >= 9) - count(*) filter (where p.v%1$s <= 6)) / nullif(count(p.v%1$s), 0), 1)', i)
      when 'csat' then format('round(100.0 * count(*) filter (where p.v%1$s >= 4) / nullif(count(p.v%1$s), 0), 1)', i)
    end));
  end loop;

  -- ---------------------------------------------------------------- assemble
  -- p: one row per response (per dimension value for checkboxes).
  v_sql := 'with ' || v_base || ', p as materialized (select base.id';
  for i in 0 .. v_ndims - 1 loop
    v_sql := v_sql || format(', d%1$s.v as d%1$s', i);
  end loop;
  for i in 0 .. v_nmetrics - 1 loop
    v_sql := v_sql || format(', %s as v%s', v_metric_val[i + 1], i);
  end loop;
  v_sql := v_sql || ' from base';
  for i in 0 .. v_ndims - 1 loop
    v_sql := v_sql || format(' cross join lateral %s as d%s(v)', v_dim_src[i + 1], i);
  end loop;
  v_sql := v_sql || ' where true';
  if not v_include_empty then
    for i in 0 .. v_ndims - 1 loop
      v_sql := v_sql || format(' and d%s.v is not null', i);
    end loop;
  end if;
  v_sql := v_sql || ')';

  if v_ndims = 0 then
    v_sql := v_sql || format(
      ' select jsonb_build_object(''rows'', jsonb_build_array(jsonb_build_array(%s)), ''total'', (select count(*) from base), ''groups'', 1) from p',
      array_to_string(v_metric_agg, ', '));
  elsif v_ndims = 1 then
    v_sql := v_sql || format(
      ', g as (select p.d0%1$s from p group by p.d0)
       select jsonb_build_object(
         ''rows'', coalesce((select jsonb_agg(jsonb_build_array(d0%2$s) order by %3$s) from (
             select * from g order by %3$s limit %4$s) s), ''[]''::jsonb),
         ''total'', (select count(*) from base),
         ''groups'', (select count(*) from g))',
      (select string_agg(format(', %s as m%s', v_metric_agg[k + 1], k), '') from generate_series(0, v_nmetrics - 1) k),
      (select string_agg(format(', m%s', k), '') from generate_series(0, v_nmetrics - 1) k),
      case when v_sort_dim
        then format('%s %s nulls last', case when v_dim_num[1] then 'd0::numeric' else 'd0' end, v_dir)
        else format('m0 %s nulls last, d0', v_dir) end,
      v_limit);
  else
    -- Two dimensions: keep the top N values of the first (by the first metric
    -- over that dimension alone) and the 50 most frequent of the second.
    v_sql := v_sql || format(
      ', g as (select p.d0, p.d1%1$s from p group by p.d0, p.d1),
         g0 as (select p.d0, %2$s as m from p group by p.d0),
         top0 as (select d0, row_number() over (order by %3$s) as rk from g0 order by %3$s limit %4$s),
         top1 as (select p.d1 from p group by p.d1 order by count(distinct p.id) desc, p.d1 limit 50)
       select jsonb_build_object(
         ''rows'', coalesce((select jsonb_agg(jsonb_build_array(g.d0, g.d1%5$s) order by top0.rk, %6$s)
                             from g join top0 using (d0) where exists (select 1 from top1 where top1.d1 is not distinct from g.d1)), ''[]''::jsonb),
         ''total'', (select count(*) from base),
         ''groups'', (select count(*) from g0))',
      (select string_agg(format(', %s as m%s', v_metric_agg[k + 1], k), '') from generate_series(0, v_nmetrics - 1) k),
      v_metric_agg[1],
      case when v_sort_dim
        then format('%s %s nulls last', case when v_dim_num[1] then 'd0::numeric' else 'd0' end, v_dir)
        else format('m %s nulls last, d0', v_dir) end,
      least(v_limit, 100),
      (select string_agg(format(', g.m%s', k), '') from generate_series(0, v_nmetrics - 1) k),
      case when v_dim_num[2] then 'g.d1::numeric' else 'g.d1' end);
  end if;

  execute v_sql into v_result using p_form_id, coalesce(p_filters, '{}'::jsonb), v_keys, v_spec;
  return v_result || jsonb_build_object('kind', 'grouped', 'bins', v_bins);
end;
$$;

revoke all on function public._chart_field_type(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.dashboard_query(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.dashboard_query(uuid, jsonb, jsonb) to authenticated, service_role;

-- =============================================================================
-- Chart builder performance (dashboard_query at 100k responses)
--
-- - Hash joins instead of per-response index lookups (enable_nestloop off).
-- - count(*) instead of count(distinct id) per group: every row of p is one
--   (response, group) pair, so the sort for DISTINCT is unnecessary. The
--   two-dimension ranking (g0) still counts each response once per value.
-- Same signature, grants unchanged.
-- =============================================================================

create or replace function public.dashboard_query(
  p_form_id uuid,
  p_spec jsonb,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set work_mem = '32MB'
set plan_cache_mode = 'force_custom_plan'
-- Hash joins: the row estimate of _dashboard_responses is far too low, and a
-- nested loop of per-response index lookups is several times slower at scale.
set enable_nestloop = off
as $$
declare
  v_spec jsonb := coalesce(p_spec, '{}'::jsonb);
  v_chart text := v_spec ->> 'chart';
  v_dims jsonb := coalesce(v_spec -> 'dimensions', '[]'::jsonb);
  v_metrics jsonb := coalesce(v_spec -> 'metrics', '[]'::jsonb);
  v_cfilters jsonb := coalesce(v_spec -> 'filters', '[]'::jsonb);
  v_limit integer := least(greatest(coalesce((v_spec ->> 'limit')::integer, 20), 1), 500);
  v_include_empty boolean := coalesce((v_spec -> 'options' ->> 'includeEmpty')::boolean, false);
  v_sort_dim boolean := (v_spec -> 'sort' ->> 'by') = 'dimension';
  v_dir text := case when (v_spec -> 'sort' ->> 'dir') = 'asc' then 'asc' else 'desc' end;
  v_keys text[] := '{}'::text[];
  v_ndims integer;
  v_nmetrics integer;
  v_cols text := '';
  v_joins text := '';
  v_where text := 'true';
  v_base text;
  v_dim_src text[] := '{}'::text[];      -- lateral producer per dimension
  v_dim_num boolean[] := '{}'::boolean[];   -- numeric sort per dimension
  v_metric_val text[] := '{}'::text[];   -- value column per metric
  v_metric_agg text[] := '{}'::text[];   -- aggregate per metric (over p)
  v_bins jsonb := '{}'::jsonb;
  v_sql text;
  v_result jsonb;
  v_field jsonb;
  v_type text;
  v_expr text;
  v_grain text;
  v_n integer;
  v_lo numeric;
  v_hi numeric;
  v_agg text;
  v_op text;
  v_vals text;
begin
  perform public._assert_can_view(p_form_id);

  if v_chart is null or v_chart not in (
    'kpi', 'bar', 'column', 'line', 'area', 'donut', 'table', 'pivot', 'heatmap', 'scatter', 'histogram'
  ) then
    raise exception 'invalid chart' using errcode = '22023';
  end if;
  if jsonb_typeof(v_dims) <> 'array' or jsonb_typeof(v_metrics) <> 'array' or jsonb_typeof(v_cfilters) <> 'array' then
    raise exception 'invalid chart spec' using errcode = '22023';
  end if;
  v_ndims := jsonb_array_length(v_dims);
  v_nmetrics := jsonb_array_length(v_metrics);
  if v_ndims > 2 or v_nmetrics > 5 or jsonb_array_length(v_cfilters) > 10 then
    raise exception 'chart spec too large' using errcode = '22023';
  end if;

  -- ------------------------------------------------------------------ fields
  -- Question keys become columns o<i> / n<i> / t<i> / x<i> of a left-joined
  -- answer a<i> on the "base" row (one row per filtered response).

  -- Scatter: two numeric fields, one point per response.
  if v_chart = 'scatter' then
    for v_field in select value from jsonb_array_elements(jsonb_build_array(v_spec -> 'x', v_spec -> 'y')) loop
      if v_field is null or jsonb_typeof(v_field) <> 'object' then
        raise exception 'scatter needs x and y' using errcode = '22023';
      end if;
      v_type := public._chart_field_type(p_form_id, v_field);
      if v_type not in ('number', 'duration') then
        raise exception 'scatter needs numeric fields' using errcode = '22023';
      end if;
    end loop;
  end if;

  -- Collect question keys (dimensions, metric fields, filters, x / y).
  for v_field in
    select d -> 'field' from jsonb_array_elements(v_dims) d
    union all select m -> 'field' from jsonb_array_elements(v_metrics) m where m ? 'field'
    union all select f -> 'field' from jsonb_array_elements(v_cfilters) f
    union all select v_spec -> 'x' where v_chart = 'scatter'
    union all select v_spec -> 'y' where v_chart = 'scatter'
  loop
    perform public._chart_field_type(p_form_id, v_field); -- validates
    if v_field ->> 'kind' = 'question' and not ((v_field ->> 'key') = any (v_keys)) then
      v_keys := array_append(v_keys, ((v_field ->> 'key')));
    end if;
  end loop;

  for i in 1 .. coalesce(array_length(v_keys, 1), 0) loop
    v_cols := v_cols || format(
      ', a%1$s.value_options as o%1$s, a%1$s.value_number as n%1$s, a%1$s.value_date as t%1$s, a%1$s.value_text as x%1$s', i);
    v_joins := v_joins || format(
      ' left join public.response_answers a%1$s on a%1$s.response_id = r.id and a%1$s.form_id = $1 and a%1$s.question_key = $3[%1$s]', i);
  end loop;

  -- ----------------------------------------------------------- chart filters
  for i in 0 .. jsonb_array_length(v_cfilters) - 1 loop
    v_field := v_cfilters -> i -> 'field';
    v_type := public._chart_field_type(p_form_id, v_field);
    v_op := v_cfilters -> i ->> 'op';
    v_n := case when v_field ->> 'kind' = 'question' then array_position(v_keys, v_field ->> 'key') end;
    v_expr := case v_type
      when 'category' then format('a%s.value_options', v_n)
      when 'multi' then format('a%s.value_options', v_n)
      when 'number' then format('a%s.value_number', v_n)
      when 'date' then format('to_char(a%s.value_date at time zone ''UTC'', ''YYYY-MM-DD'')', v_n)
      when 'text' then format('nullif(btrim(a%s.value_text), '''')', v_n)
      when 'time' then 'r.submitted_at'
      when 'device' then 'coalesce(r.device, ''unknown'')'
      when 'locale' then 'coalesce(r.locale, ''unknown'')'
      when 'version' then 'fv.version_number'
      when 'duration' then 'r.duration_seconds'
    end;
    -- Bound values: $4 -> 'filters' -> i -> 'values'.
    v_vals := format('($4 -> ''filters'' -> %s -> ''values'')', i);
    v_where := v_where || ' and ' || case
      when v_op = 'is_answered' and v_type in ('category', 'multi') then format('coalesce(cardinality(%s), 0) > 0', v_expr)
      when v_op = 'is_empty' and v_type in ('category', 'multi') then format('coalesce(cardinality(%s), 0) = 0', v_expr)
      when v_op = 'is_answered' then format('%s is not null', v_expr)
      when v_op = 'is_empty' then format('%s is null', v_expr)
      when v_op in ('in', 'not_in') and v_type in ('category', 'multi') then format(
        '%scoalesce(%s && array(select jsonb_array_elements_text(%s)), false)',
        case when v_op = 'not_in' then 'not ' else '' end, v_expr, v_vals)
      when v_op in ('in', 'not_in') and v_type in ('number', 'duration', 'version') then format(
        '%scoalesce(%s = any (array(select (e)::numeric from jsonb_array_elements_text(%s) e where e ~ ''^-?[0-9]+(\.[0-9]+)?$'')), false)',
        case when v_op = 'not_in' then 'not ' else '' end, v_expr, v_vals)
      when v_op in ('in', 'not_in') and v_type in ('date', 'text', 'device', 'locale') then format(
        '%scoalesce(%s = any (array(select jsonb_array_elements_text(%s))), false)',
        case when v_op = 'not_in' then 'not ' else '' end, v_expr, v_vals)
      when v_op in ('gt', 'lt') and v_type in ('number', 'duration', 'version') then format(
        'coalesce(%s %s (select (e)::numeric from jsonb_array_elements_text(%s) e where e ~ ''^-?[0-9]+(\.[0-9]+)?$'' limit 1), false)',
        v_expr, case when v_op = 'gt' then '>' else '<' end, v_vals)
      when v_op in ('gt', 'lt') and v_type = 'date' then format(
        'coalesce(%s %s (select e from jsonb_array_elements_text(%s) e where e ~ ''^\d{4}-\d{2}-\d{2}$'' limit 1), false)',
        v_expr, case when v_op = 'gt' then '>' else '<' end, v_vals)
      when v_op in ('gt', 'lt') and v_type = 'time' then format(
        'coalesce(%s %s (select (e)::timestamptz from jsonb_array_elements_text(%s) e where e ~ ''^\d{4}-\d{2}-\d{2}'' limit 1), false)',
        v_expr, case when v_op = 'gt' then '>' else '<' end, v_vals)
      else null
    end;
    if v_where is null then
      raise exception 'invalid chart filter' using errcode = '22023';
    end if;
  end loop;

  v_base := format(
    'base as materialized (select r.id, r.submitted_at, r.device, r.locale, r.duration_seconds, fv.version_number%s
       from public._dashboard_responses($1, $2) r
       join public.form_versions fv on fv.id = r.form_version_id%s
      where %s)',
    v_cols, v_joins, v_where);

  -- ---------------------------------------------------------------- scatter
  if v_chart = 'scatter' then
    v_sql := format(
      'with %1$s, pts as (select %2$s::double precision as x, %3$s::double precision as y from base where %2$s is not null and %3$s is not null)
       select jsonb_build_object(
         ''total'', (select count(*) from base),
         ''n'', (select count(*) from pts),
         ''r'', (select case when count(*) >= 3 then round(corr(x, y)::numeric, 3) end from pts),
         ''points'', coalesce((select jsonb_agg(jsonb_build_array(x, y)) from (select x, y from pts limit 2000) s), ''[]''::jsonb))',
      v_base,
      case when v_spec -> 'x' ->> 'kind' = 'meta' then 'duration_seconds'
           else format('n%s', array_position(v_keys, v_spec -> 'x' ->> 'key')) end,
      case when v_spec -> 'y' ->> 'kind' = 'meta' then 'duration_seconds'
           else format('n%s', array_position(v_keys, v_spec -> 'y' ->> 'key')) end);
    execute v_sql into v_result using p_form_id, coalesce(p_filters, '{}'::jsonb), v_keys, v_spec;
    return v_result || jsonb_build_object('kind', 'scatter');
  end if;

  -- ------------------------------------------------------------- dimensions
  if v_chart in ('pivot', 'heatmap') and v_ndims <> 2 then
    raise exception 'chart needs two dimensions' using errcode = '22023';
  end if;
  if v_chart in ('bar', 'column', 'line', 'area', 'donut', 'histogram') and v_ndims < 1 then
    raise exception 'chart needs a dimension' using errcode = '22023';
  end if;
  if v_chart = 'kpi' and v_ndims > 0 then
    raise exception 'kpi has no dimension' using errcode = '22023';
  end if;
  if v_chart = 'donut' and v_ndims > 1 then
    raise exception 'donut has one dimension' using errcode = '22023';
  end if;

  for i in 0 .. v_ndims - 1 loop
    v_field := v_dims -> i -> 'field';
    v_type := public._chart_field_type(p_form_id, v_field);
    v_n := case when v_field ->> 'kind' = 'question' then array_position(v_keys, v_field ->> 'key') end;
    v_grain := coalesce(v_dims -> i ->> 'grain', 'day');
    if v_grain not in ('hour', 'day', 'week', 'month', 'weekday', 'hour_of_day') then
      raise exception 'invalid grain' using errcode = '22023';
    end if;

    if v_type in ('number', 'duration') and (v_dims -> i ? 'bins' or v_chart = 'histogram') then
      v_expr := case when v_type = 'number' then format('n%s', v_n) else 'duration_seconds' end;
      execute format('with %s select min(%s), max(%s) from base', v_base, v_expr, v_expr)
        into v_lo, v_hi using p_form_id, coalesce(p_filters, '{}'::jsonb), v_keys, v_spec;
      v_n := least(greatest(coalesce((v_dims -> i ->> 'bins')::integer, 10), 2), 50);
      v_lo := coalesce(v_lo, 0);
      v_hi := coalesce(v_hi, v_lo);
      v_bins := v_bins || jsonb_build_object(i::text, jsonb_build_object('lo', v_lo, 'hi', v_hi, 'n', v_n));
      v_dim_src := array_append(v_dim_src, (format(
        '(select case when %1$s is null then null when %3$s > %2$s then least(width_bucket(%1$s, %2$s, %3$s, %4$s), %4$s)::text else ''1'' end)',
        v_expr, v_lo::numeric, v_hi::numeric, v_n)));
      v_dim_num := array_append(v_dim_num, (true));
    elsif v_chart = 'histogram' then
      raise exception 'histogram needs a numeric dimension' using errcode = '22023';
    else
      v_dim_src := array_append(v_dim_src, (case v_type
        when 'category' then format('unnest(case when coalesce(cardinality(o%1$s), 0) = 0 then array[null::text] else o%1$s end)', v_n)
        when 'multi' then format('unnest(case when coalesce(cardinality(o%1$s), 0) = 0 then array[null::text] else o%1$s end)', v_n)
        when 'number' then format('(select trim_scale(n%s)::text)', v_n)
        when 'duration' then '(select duration_seconds::text)'
        when 'text' then format('(select nullif(btrim(x%s), ''''))', v_n)
        when 'device' then '(select coalesce(device, ''unknown''))'
        when 'locale' then '(select coalesce(locale, ''unknown''))'
        when 'version' then '(select version_number::text)'
        when 'date' then case v_grain
          when 'week' then format('(select to_char(date_trunc(''week'', t%s at time zone ''UTC''), ''YYYY-MM-DD''))', v_n)
          when 'month' then format('(select to_char(t%s at time zone ''UTC'', ''YYYY-MM''))', v_n)
          when 'weekday' then format('(select extract(isodow from t%s at time zone ''UTC'')::integer::text)', v_n)
          else format('(select to_char(t%s at time zone ''UTC'', ''YYYY-MM-DD''))', v_n)
        end
        when 'time' then case v_grain
          when 'hour' then '(select to_char(date_trunc(''hour'', submitted_at at time zone ''Asia/Jakarta''), ''YYYY-MM-DD"T"HH24:00''))'
          when 'week' then '(select to_char(date_trunc(''week'', submitted_at at time zone ''Asia/Jakarta''), ''YYYY-MM-DD''))'
          when 'month' then '(select to_char(submitted_at at time zone ''Asia/Jakarta'', ''YYYY-MM''))'
          when 'weekday' then '(select extract(isodow from submitted_at at time zone ''Asia/Jakarta'')::integer::text)'
          when 'hour_of_day' then '(select extract(hour from submitted_at at time zone ''Asia/Jakarta'')::integer::text)'
          else '(select to_char(submitted_at at time zone ''Asia/Jakarta'', ''YYYY-MM-DD''))'
        end
      end));
      v_dim_num := array_append(v_dim_num, ((
        v_type in ('number', 'duration', 'version')
        or (v_type in ('date', 'time') and v_grain in ('weekday', 'hour_of_day')))));
    end if;
  end loop;

  -- ---------------------------------------------------------------- metrics
  if v_nmetrics < 1 then
    raise exception 'chart needs a metric' using errcode = '22023';
  end if;
  for i in 0 .. v_nmetrics - 1 loop
    v_agg := v_metrics -> i ->> 'agg';
    if v_agg is null or v_agg not in ('count', 'percent', 'avg', 'median', 'min', 'max', 'sum', 'nps', 'csat') then
      raise exception 'invalid aggregation' using errcode = '22023';
    end if;
    if v_agg in ('count', 'percent') then
      v_metric_val := array_append(v_metric_val, ('null::numeric'));
    else
      v_field := v_metrics -> i -> 'field';
      if v_field is null then
        raise exception 'aggregation needs a field' using errcode = '22023';
      end if;
      v_type := public._chart_field_type(p_form_id, v_field);
      if v_type not in ('number', 'duration') then
        raise exception 'aggregation needs a numeric field' using errcode = '22023';
      end if;
      v_metric_val := array_append(v_metric_val, (case when v_type = 'number'
        then format('n%s', array_position(v_keys, v_field ->> 'key'))
        else 'duration_seconds::numeric' end));
    end if;
    v_metric_agg := array_append(v_metric_agg, (case v_agg
      -- p has one row per (response, group): option arrays hold distinct ids.
      when 'count' then 'count(*)'
      when 'percent' then 'round(100.0 * count(*) / nullif((select count(*) from base), 0), 1)'
      when 'avg' then format('round(avg(p.v%s), 2)', i)
      when 'median' then format('percentile_cont(0.5) within group (order by p.v%s)', i)
      when 'min' then format('min(p.v%s)', i)
      when 'max' then format('max(p.v%s)', i)
      when 'sum' then format('sum(p.v%s)', i)
      when 'nps' then format(
        'round(100.0 * (count(*) filter (where p.v%1$s >= 9) - count(*) filter (where p.v%1$s <= 6)) / nullif(count(p.v%1$s), 0), 1)', i)
      when 'csat' then format('round(100.0 * count(*) filter (where p.v%1$s >= 4) / nullif(count(p.v%1$s), 0), 1)', i)
    end));
  end loop;

  -- ---------------------------------------------------------------- assemble
  -- p: one row per response (per dimension value for checkboxes).
  v_sql := 'with ' || v_base || ', p as materialized (select base.id';
  for i in 0 .. v_ndims - 1 loop
    v_sql := v_sql || format(', d%1$s.v as d%1$s', i);
  end loop;
  for i in 0 .. v_nmetrics - 1 loop
    v_sql := v_sql || format(', %s as v%s', v_metric_val[i + 1], i);
  end loop;
  v_sql := v_sql || ' from base';
  for i in 0 .. v_ndims - 1 loop
    v_sql := v_sql || format(' cross join lateral %s as d%s(v)', v_dim_src[i + 1], i);
  end loop;
  v_sql := v_sql || ' where true';
  if not v_include_empty then
    for i in 0 .. v_ndims - 1 loop
      v_sql := v_sql || format(' and d%s.v is not null', i);
    end loop;
  end if;
  v_sql := v_sql || ')';

  if v_ndims = 0 then
    v_sql := v_sql || format(
      ' select jsonb_build_object(''rows'', jsonb_build_array(jsonb_build_array(%s)), ''total'', (select count(*) from base), ''groups'', 1) from p',
      array_to_string(v_metric_agg, ', '));
  elsif v_ndims = 1 then
    v_sql := v_sql || format(
      ', g as (select p.d0%1$s from p group by p.d0)
       select jsonb_build_object(
         ''rows'', coalesce((select jsonb_agg(jsonb_build_array(d0%2$s) order by %3$s) from (
             select * from g order by %3$s limit %4$s) s), ''[]''::jsonb),
         ''total'', (select count(*) from base),
         ''groups'', (select count(*) from g))',
      (select string_agg(format(', %s as m%s', v_metric_agg[k + 1], k), '') from generate_series(0, v_nmetrics - 1) k),
      (select string_agg(format(', m%s', k), '') from generate_series(0, v_nmetrics - 1) k),
      case when v_sort_dim
        then format('%s %s nulls last', case when v_dim_num[1] then 'd0::numeric' else 'd0' end, v_dir)
        else format('m0 %s nulls last, d0', v_dir) end,
      v_limit);
  else
    -- Two dimensions: keep the top N values of the first (by the first metric
    -- over that dimension alone) and the 50 most frequent of the second.
    v_sql := v_sql || format(
      ', g as (select p.d0, p.d1%1$s from p group by p.d0, p.d1),
         g0 as (select p.d0, %2$s as m from (select distinct p.id, p.d0, p.v0 from p) p group by p.d0),
         top0 as (select d0, row_number() over (order by %3$s) as rk from g0 order by %3$s limit %4$s),
         top1 as (select p.d1 from p group by p.d1 order by count(*) desc, p.d1 limit 50)
       select jsonb_build_object(
         ''rows'', coalesce((select jsonb_agg(jsonb_build_array(g.d0, g.d1%5$s) order by top0.rk, %6$s)
                             from g join top0 using (d0) where exists (select 1 from top1 where top1.d1 is not distinct from g.d1)), ''[]''::jsonb),
         ''total'', (select count(*) from base),
         ''groups'', (select count(*) from g0))',
      (select string_agg(format(', %s as m%s', v_metric_agg[k + 1], k), '') from generate_series(0, v_nmetrics - 1) k),
      v_metric_agg[1],
      case when v_sort_dim
        then format('%s %s nulls last', case when v_dim_num[1] then 'd0::numeric' else 'd0' end, v_dir)
        else format('m %s nulls last, d0', v_dir) end,
      least(v_limit, 100),
      (select string_agg(format(', g.m%s', k), '') from generate_series(0, v_nmetrics - 1) k),
      case when v_dim_num[2] then 'g.d1::numeric' else 'g.d1' end);
  end if;

  execute v_sql into v_result using p_form_id, coalesce(p_filters, '{}'::jsonb), v_keys, v_spec;
  return v_result || jsonb_build_object('kind', 'grouped', 'bins', v_bins);
end;
$$;

-- Dicatat hanya jika prod memakai riwayat Supabase CLI (tabel ada).
do $rec$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name)
    values ('20261018090000', 'chart_builder_query')
    on conflict (version) do nothing;
  end if;
end
$rec$;
-- Dicatat hanya jika prod memakai riwayat Supabase CLI (tabel ada).
do $rec$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name)
    values ('20261018100000', 'chart_builder_query_perf')
    on conflict (version) do nothing;
  end if;
end
$rec$;

commit;
