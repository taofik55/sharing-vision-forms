-- Fix: in cross_suggestions the num x num score came from corr() (double
-- precision) and round(double precision, integer) does not exist. Cast to numeric.

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
