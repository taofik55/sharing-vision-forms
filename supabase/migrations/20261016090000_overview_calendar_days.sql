-- =============================================================================
-- Phase 4 follow-up: _dashboard_overview
-- 1. "Last 7 days" / "previous 7 days" now use Asia/Jakarta calendar days
--    (today + 6 days before), the same window as the dashboard's "7d" preset,
--    so the KPI equals the filtered total for that preset.
-- 2. The timeline no longer shows an empty bucket for the exclusive end of the
--    date filter (e.g. tomorrow 00:00 WIB).
-- =============================================================================

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
  -- p_filters.to is exclusive: the last bucket is the one containing to - 1 µs.
  select coalesce(v_from, min(r.submitted_at)), coalesce(v_to - interval '1 microsecond', now())
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
    -- Calendar days in Asia/Jakarta (today + 6 previous days), matching the "7d" date preset.
    'last7', (select count(*) from nodates, local_now
              where (nodates.submitted_at at time zone 'Asia/Jakarta')::date > local_now.t::date - 7),
    'prev7', (select count(*) from nodates, local_now
              where (nodates.submitted_at at time zone 'Asia/Jakarta')::date > local_now.t::date - 14
                and (nodates.submitted_at at time zone 'Asia/Jakarta')::date <= local_now.t::date - 7),
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
