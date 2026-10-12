-- Fix: add_form_member's OUT parameters (user_id, role) made the ON CONFLICT
-- column list ambiguous in PL/pgSQL. Target the primary key constraint instead.

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
  on conflict on constraint form_members_pkey do update set role = excluded.role;

  return query
  select v_profile.id, v_profile.email, v_profile.full_name, p_role, v_profile.role;
end;
$$;

revoke all on function public.add_form_member(uuid, text, public.member_role) from public, anon;
grant execute on function public.add_form_member(uuid, text, public.member_role) to authenticated;
