-- =============================================================================
-- FormPulse Phase 2: publishing, form listing, sharing helpers.
-- =============================================================================

-- A published or closed form must point at a version.
alter table public.forms
  add constraint forms_published_requires_version
  check (status not in ('published', 'closed') or current_version_id is not null);

create index forms_status_idx on public.forms (status);

-- Replaces the Phase 1 guard: additionally, API callers can never set
-- current_version_id directly (only publish_form, which runs as definer).
create or replace function public.forms_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.current_version_id is distinct from old.current_version_id then
    raise exception 'current_version_id is managed by publish_form' using errcode = '42501';
  end if;

  if not public.is_admin()
     and (new.owner_id is distinct from old.owner_id
          or new.workspace_id is distinct from old.workspace_id) then
    raise exception 'only admins can change form owner or workspace' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Same rule on insert: new forms start without a version.
create or replace function public.forms_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and new.current_version_id is not null then
    raise exception 'current_version_id is managed by publish_form' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger forms_insert_guard
  before insert on public.forms
  for each row execute function public.forms_insert_guard();

-- -----------------------------------------------------------------------------
-- publish_form: snapshot draft_definition into a new immutable version.
-- The server action validates the definition with Zod BEFORE calling this.
-- p_expected_updated_at (optional) rejects publishing a draft that changed
-- since the caller validated it (SQLSTATE 40001).
-- -----------------------------------------------------------------------------
create or replace function public.publish_form(
  p_form_id uuid,
  p_expected_updated_at timestamptz default null
)
returns table (version_id uuid, version_number integer, updated_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_form public.forms%rowtype;
  v_next integer;
  v_version_id uuid;
  v_updated_at timestamptz;
begin
  if not public.can_edit_form(p_form_id) then
    raise exception 'not allowed to publish this form' using errcode = '42501';
  end if;

  select * into v_form from public.forms f where f.id = p_form_id for update;
  if not found then
    raise exception 'form not found' using errcode = 'P0002';
  end if;

  if p_expected_updated_at is not null and v_form.updated_at <> p_expected_updated_at then
    raise exception 'draft changed since validation' using errcode = '40001';
  end if;

  if jsonb_typeof(v_form.draft_definition -> 'sections') is distinct from 'array'
     or jsonb_array_length(v_form.draft_definition -> 'sections') = 0 then
    raise exception 'draft definition is not publishable' using errcode = '22023';
  end if;

  select coalesce(max(v.version_number), 0) + 1 into v_next
  from public.form_versions v
  where v.form_id = p_form_id;

  insert into public.form_versions (form_id, version_number, definition, published_by)
  values (p_form_id, v_next, v_form.draft_definition, (select auth.uid()))
  returning id into v_version_id;

  update public.forms f
  set current_version_id = v_version_id, status = 'published'
  where f.id = p_form_id
  returning f.updated_at into v_updated_at;

  return query select v_version_id, v_next, v_updated_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- list_forms: one page of viewable forms with response aggregates.
-- Aggregation happens here, never in the browser.
-- -----------------------------------------------------------------------------
create or replace function public.list_forms(
  p_search text default null,
  p_status public.form_status default null,
  p_owner uuid default null,
  p_scope text default 'all',
  p_sort text default 'updated_desc',
  p_limit integer default 20,
  p_offset integer default 0
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
      coalesce(rs.response_count, 0) as response_count,
      rs.last_response_at,
      fv.version_number as current_version_number,
      (fv.id is not null and fv.definition is distinct from v.draft_definition) as has_unpublished_changes,
      public.can_edit_form(v.id) as can_edit,
      case
        when v.owner_id = me.uid then 'owner'
        when me.admin then 'admin'
        else coalesce((select m.role::text from public.form_members m
                       where m.form_id = v.id and m.user_id = me.uid), 'viewer')
      end as access
    from visible v
    cross join me
    left join public.profiles p on p.id = v.owner_id
    left join public.form_versions fv on fv.id = v.current_version_id
    left join lateral (
      select count(*) as response_count, max(r.submitted_at) as last_response_at
      from public.responses r
      where r.form_id = v.id
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

-- Owners of forms the caller can view (for the owner filter).
create or replace function public.list_form_owners()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.id, coalesce(nullif(p.full_name, ''), p.email) as name
  from public.forms f
  join public.profiles p on p.id = f.owner_id
  where public.can_view_form(f.id)
  order by name;
$$;

-- -----------------------------------------------------------------------------
-- Sharing. Editors cannot read other profiles directly, so these definer
-- functions expose the minimum needed, after explicit permission checks.
-- -----------------------------------------------------------------------------
create or replace function public.list_form_members(p_form_id uuid)
returns table (user_id uuid, email text, full_name text, role public.member_role, app_role public.app_role)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, p.email, p.full_name, m.role, p.role
  from public.form_members m
  join public.profiles p on p.id = m.user_id
  where m.form_id = p_form_id
    and public.can_view_form(p_form_id)
  order by lower(coalesce(p.full_name, p.email));
$$;

create or replace function public.add_form_member(
  p_form_id uuid,
  p_email text,
  p_role public.member_role
)
returns table (user_id uuid, email text, full_name text, role public.member_role, app_role public.app_role)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_form public.forms%rowtype;
  v_profile public.profiles%rowtype;
begin
  if not (public.can_edit_form(p_form_id)
          and (public.is_admin() or public.is_form_owner(p_form_id))) then
    raise exception 'only the owner or an admin can share this form' using errcode = '42501';
  end if;

  select * into v_form from public.forms f where f.id = p_form_id;

  select * into v_profile
  from public.profiles p
  where lower(p.email) = lower(trim(p_email))
    and p.workspace_id = v_form.workspace_id
    and p.is_active;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  if v_profile.id = v_form.owner_id then
    raise exception 'owner_cannot_be_member' using errcode = '22023';
  end if;

  insert into public.form_members (form_id, user_id, role)
  values (p_form_id, v_profile.id, p_role)
  on conflict (form_id, user_id) do update set role = excluded.role;

  return query
  select v_profile.id, v_profile.email, v_profile.full_name, p_role, v_profile.role;
end;
$$;

-- Slugs are public (they appear in /f/<slug>), so revealing whether one is
-- taken leaks nothing sensitive. Requires a signed-in active user.
create or replace function public.is_slug_available(p_slug text, p_form_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_app_role() is not null
    and not exists (
      select 1 from public.forms f
      where f.slug = p_slug and f.id is distinct from p_form_id
    );
$$;

-- -----------------------------------------------------------------------------
-- Privileges: callable by signed-in users only (each function checks access).
-- -----------------------------------------------------------------------------
revoke all on function public.publish_form(uuid, timestamptz) from public, anon;
revoke all on function public.list_forms(text, public.form_status, uuid, text, text, integer, integer) from public, anon;
revoke all on function public.list_form_owners() from public, anon;
revoke all on function public.list_form_members(uuid) from public, anon;
revoke all on function public.add_form_member(uuid, text, public.member_role) from public, anon;
revoke all on function public.is_slug_available(text, uuid) from public, anon;
revoke all on function public.forms_insert_guard() from public, anon, authenticated;

grant execute on function public.publish_form(uuid, timestamptz) to authenticated;
grant execute on function public.list_forms(text, public.form_status, uuid, text, text, integer, integer) to authenticated;
grant execute on function public.list_form_owners() to authenticated;
grant execute on function public.list_form_members(uuid) to authenticated;
grant execute on function public.add_form_member(uuid, text, public.member_role) to authenticated;
grant execute on function public.is_slug_available(text, uuid) to authenticated;
