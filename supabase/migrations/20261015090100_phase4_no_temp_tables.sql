-- =============================================================================
-- Phase 4 follow-up: remove temp tables from list_responses and
-- generate_demo_responses. They worked at runtime, but temp tables are invisible
-- to `supabase db lint` (false "relation does not exist" errors) and forced
-- list_responses to be VOLATILE. The demo latent values (s, seg) are now derived
-- deterministically from the response id, so no shared scratch table is needed.
-- =============================================================================

-- Latent satisfaction s ~ N(0,1) and segment draw seg ~ U(0,1) from the id.
create or replace function public._demo_latent(p_id uuid)
returns table (response_id uuid, s double precision, seg double precision)
language sql
immutable
set search_path = ''
as $$
  with u as (
    select ('x' || substr(md5(p_id::text || ':a'), 1, 8))::bit(32)::bigint / 4294967296.0 as u1,
           ('x' || substr(md5(p_id::text || ':b'), 1, 8))::bit(32)::bigint / 4294967296.0 as u2,
           ('x' || substr(md5(p_id::text || ':c'), 1, 8))::bit(32)::bigint / 4294967296.0 as u3
  )
  select p_id,
         sqrt(-2 * ln(greatest(u1, 1e-12))) * cos(2 * pi() * u2),
         u3
  from u;
$$;

revoke all on function public._demo_latent(uuid) from public, anon, authenticated, service_role;

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
  v_ids uuid[];
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

  select coalesce(array_agg(r.id), '{}') into v_ids
  from public._dashboard_responses(p_form_id, coalesce(p_filters, '{}'::jsonb)) r
  join public.responses x on x.id = r.id
  where v_search is null
     or exists (select 1 from public.response_answers ra
                where ra.response_id = r.id and ra.value_text ilike '%' || v_search || '%')
     or (v_full and (x.identifier_email ilike '%' || v_search || '%' or x.identifier_phone like '%' || v_search || '%'));

  v_total := cardinality(v_ids);

  with page as (
    select r.*, v.version_number
    from public.responses r
    join unnest(v_ids) as f(id) on f.id = r.id
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
      from unnest(v_new) as n(response_id) cross join lateral public._demo_latent(n.response_id) d
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
      from unnest(v_new) as n(response_id) cross join lateral public._demo_latent(n.response_id) d
      where (v_visible is null or d.response_id = any (v_visible)) and random() < v_rate;

    elsif v_type = 'email' then
      insert into public.response_answers (response_id, form_id, question_key, question_type, value_text)
      select d.response_id, p_form_id, v_key, v_type, 'demo.' || left(md5(d.response_id::text), 8) || '@example.com'
      from unnest(v_new) as n(response_id) cross join lateral public._demo_latent(n.response_id) d
      where (v_visible is null or d.response_id = any (v_visible)) and random() < v_rate;

    elsif v_type = 'phone' then
      insert into public.response_answers (response_id, form_id, question_key, question_type, value_text)
      select d.response_id, p_form_id, v_key, v_type, '62812' || lpad(floor(random() * 100000000)::text, 8, '0')
      from unnest(v_new) as n(response_id) cross join lateral public._demo_latent(n.response_id) d
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
      from unnest(v_new) as n(response_id) cross join lateral public._demo_latent(n.response_id) d
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
      from unnest(v_new) as n(response_id) cross join lateral public._demo_latent(n.response_id) d
      where (v_visible is null or d.response_id = any (v_visible)) and random() < v_rate;

    elsif v_type in ('multiple_choice', 'dropdown') and v_k > 0 then
      insert into public.response_answers (response_id, form_id, question_key, question_type, value_options, value_text)
      select d.response_id, p_form_id, v_key, v_type,
             case when c.other then array['__other__'] else array[v_opts[c.idx + 1]] end,
             case when c.other then (array['Lainnya', 'Something else', 'Teman kantor'])[1 + floor(random() * 3)::integer] end
      from unnest(v_new) as n(response_id) cross join lateral public._demo_latent(n.response_id) d
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
      from unnest(v_new) as n(response_id) cross join lateral public._demo_latent(n.response_id) d
      where (v_visible is null or d.response_id = any (v_visible)) and random() < v_rate;

    elsif v_type = 'date' then
      insert into public.response_answers (response_id, form_id, question_key, question_type, value_date)
      select d.response_id, p_form_id, v_key, v_type,
             ((current_date - floor(power(random(), 1.4) * p_days)::integer)::timestamp at time zone 'UTC')
      from unnest(v_new) as n(response_id) cross join lateral public._demo_latent(n.response_id) d
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
