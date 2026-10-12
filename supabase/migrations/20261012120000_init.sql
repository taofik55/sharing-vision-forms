-- =============================================================================
-- FormPulse Phase 1: initial schema, permission helpers, triggers and RLS.
-- Never edit this file after it has been applied. Add a new migration instead.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'editor', 'viewer');
create type public.form_status as enum ('draft', 'published', 'closed', 'archived');
create type public.identifier_mode as enum ('none', 'email', 'phone', 'email_or_phone');
create type public.member_role as enum ('viewer', 'editor');

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  created_at timestamptz not null default now()
);

-- Single-tenant for now: one well-known default workspace.
insert into public.workspaces (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Default workspace');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id),
  email text not null,
  full_name text check (full_name is null or char_length(full_name) <= 200),
  role public.app_role not null default 'viewer',
  is_active boolean not null default true,
  locale text not null default 'id' check (locale in ('id', 'en')),
  created_at timestamptz not null default now()
);
create index profiles_workspace_id_idx on public.profiles (workspace_id);

create table public.forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  owner_id uuid not null references public.profiles (id),
  title text not null check (char_length(title) between 1 and 300),
  description text,
  slug text not null unique check (slug ~ '^[A-Za-z0-9_-]{3,100}$'),
  status public.form_status not null default 'draft',
  draft_definition jsonb not null default '{}'::jsonb,
  current_version_id uuid null,
  identifier_mode public.identifier_mode not null default 'none',
  deadline_at timestamptz null,
  closed_message text null,
  thank_you_message text null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index forms_workspace_id_idx on public.forms (workspace_id);
create index forms_owner_id_idx on public.forms (owner_id);

create table public.form_versions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  version_number integer not null check (version_number > 0),
  definition jsonb not null,
  published_by uuid references public.profiles (id),
  published_at timestamptz not null default now(),
  unique (form_id, version_number),
  -- Target for composite FKs that guarantee a version belongs to the same form.
  unique (id, form_id)
);

-- current_version_id must point at a version of the same form.
alter table public.forms
  add constraint forms_current_version_fk
  foreign key (current_version_id, id) references public.form_versions (id, form_id);

create table public.form_members (
  form_id uuid not null references public.forms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (form_id, user_id)
);
create index form_members_user_id_idx on public.form_members (user_id);

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  form_version_id uuid not null,
  submitted_at timestamptz not null default now(),
  identifier_email text,
  identifier_phone text,
  -- Normalized identifier: lowercase email, or digits-only phone.
  identifier_key text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  locale text,
  device text,
  is_demo boolean not null default false,
  constraint responses_form_version_fk
    foreign key (form_version_id, form_id) references public.form_versions (id, form_id)
);
create unique index responses_form_identifier_uidx
  on public.responses (form_id, identifier_key)
  where identifier_key is not null and is_demo = false;
create index responses_form_submitted_idx on public.responses (form_id, submitted_at);
create index responses_form_version_id_idx on public.responses (form_version_id);

create table public.response_answers (
  id bigint generated always as identity primary key,
  response_id uuid not null references public.responses (id) on delete cascade,
  form_id uuid not null references public.forms (id) on delete cascade,
  question_key text not null,
  question_type text not null,
  value_text text,
  value_number numeric,
  value_date timestamptz,
  value_options text[],
  value_json jsonb
);
create index response_answers_form_question_idx on public.response_answers (form_id, question_key);
create index response_answers_response_id_idx on public.response_answers (response_id);
create index response_answers_value_options_gin on public.response_answers using gin (value_options);

create table public.response_drafts (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  draft_token uuid not null unique default gen_random_uuid(),
  version_id uuid references public.form_versions (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);
create index response_drafts_form_id_idx on public.response_drafts (form_id);
create index response_drafts_version_id_idx on public.response_drafts (version_id);
create index response_drafts_expires_at_idx on public.response_drafts (expires_at);

create table public.dashboards (
  form_id uuid primary key references public.forms (id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.dashboard_shares (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  -- 64 hex chars from two random v4 UUIDs (~244 bits of entropy).
  token text not null unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
    check (char_length(token) >= 32),
  include_text_answers boolean not null default false,
  is_active boolean not null default true,
  expires_at timestamptz null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index dashboard_shares_form_id_idx on public.dashboard_shares (form_id);

create table public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

-- -----------------------------------------------------------------------------
-- Permission helpers (SECURITY DEFINER, empty search_path).
-- They bypass RLS internally so policies can call them without recursion.
-- Inactive profiles never get any permission.
-- -----------------------------------------------------------------------------
create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.workspace_id
  from public.profiles p
  where p.id = (select auth.uid()) and p.is_active;
$$;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid()) and p.is_active;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid()) and p.is_active and p.role = 'admin'
  );
$$;

create or replace function public.is_form_owner(p_form_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.forms f
    join public.profiles p on p.id = f.owner_id
    where f.id = p_form_id and f.owner_id = (select auth.uid()) and p.is_active
  );
$$;

-- Viewable by: admin of the workspace, owner, or any form_members row.
create or replace function public.can_view_form(p_form_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.forms f
    join public.profiles p
      on p.id = (select auth.uid()) and p.is_active and p.workspace_id = f.workspace_id
    where f.id = p_form_id
      and (
        p.role = 'admin'
        or f.owner_id = p.id
        or exists (
          select 1 from public.form_members m
          where m.form_id = f.id and m.user_id = p.id
        )
      )
  );
$$;

-- Editable by: admin of the workspace, owner, or a form_members row with role
-- editor. A user whose app role is 'viewer' is read-only everywhere, even if a
-- form_members row says editor.
create or replace function public.can_edit_form(p_form_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.forms f
    join public.profiles p
      on p.id = (select auth.uid()) and p.is_active and p.workspace_id = f.workspace_id
    where f.id = p_form_id
      and (
        p.role = 'admin'
        or f.owner_id = p.id
        or (
          p.role <> 'viewer'
          and exists (
            select 1 from public.form_members m
            where m.form_id = f.id and m.user_id = p.id and m.role = 'editor'
          )
        )
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

-- updated_at maintenance
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger forms_set_updated_at
  before update on public.forms
  for each row execute function public.set_updated_at();
create trigger dashboards_set_updated_at
  before update on public.dashboards
  for each row execute function public.set_updated_at();
create trigger response_drafts_set_updated_at
  before update on public.response_drafts
  for each row execute function public.set_updated_at();

-- Create a profile for every new auth user.
-- SECURITY: the role is read from raw_app_meta_data (only settable with the
-- secret key), NOT from raw_user_meta_data, because user metadata is
-- client-controlled on sign-up and would allow self-promotion to admin.
-- Server code that creates users (seed, admin UI) sets the role explicitly.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := 'viewer';
  v_workspace uuid;
  v_locale text;
begin
  begin
    v_role := coalesce(nullif(new.raw_app_meta_data ->> 'role', ''), 'viewer')::public.app_role;
  exception when invalid_text_representation then
    v_role := 'viewer';
  end;

  v_locale := coalesce(new.raw_user_meta_data ->> 'locale', 'id');
  if v_locale not in ('id', 'en') then
    v_locale := 'id';
  end if;

  select w.id into v_workspace
  from public.workspaces w
  order by w.created_at, w.id
  limit 1;

  insert into public.profiles (id, workspace_id, email, full_name, role, locale)
  values (
    new.id,
    v_workspace,
    coalesce(new.email, ''),
    nullif(left(new.raw_user_meta_data ->> 'full_name', 200), ''),
    v_role,
    v_locale
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Non-admin API callers may only change their own full_name and locale.
-- Also: nobody (admin included) can demote or deactivate themselves via the API.
-- Runs as SECURITY INVOKER so current_user reflects the API role; the secret
-- key (service_role) and migrations (postgres) are not restricted.
create or replace function public.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.created_at is distinct from old.created_at then
    raise exception 'profile id and created_at are immutable' using errcode = '42501';
  end if;

  if not public.is_admin() then
    if new.role is distinct from old.role
       or new.is_active is distinct from old.is_active
       or new.workspace_id is distinct from old.workspace_id
       or new.email is distinct from old.email then
      raise exception 'only admins can change role, status, workspace or email'
        using errcode = '42501';
    end if;
  elsif old.id = (select auth.uid())
        and (new.role <> 'admin' or not new.is_active) then
    raise exception 'admins cannot demote or deactivate themselves' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- Only admins may move a form to another owner or workspace.
create or replace function public.forms_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
     and not public.is_admin()
     and (new.owner_id is distinct from old.owner_id
          or new.workspace_id is distinct from old.workspace_id) then
    raise exception 'only admins can change form owner or workspace' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger forms_guard
  before update on public.forms
  for each row execute function public.forms_guard();

-- Published versions are immutable snapshots. The only allowed delete is the
-- cascade that happens when the parent form itself is deleted.
create or replace function public.form_versions_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and not exists (select 1 from public.forms f where f.id = old.form_id) then
    return old;
  end if;
  raise exception 'form_versions rows are immutable' using errcode = '42501';
end;
$$;

create trigger form_versions_immutable
  before update or delete on public.form_versions
  for each row execute function public.form_versions_immutable();

-- -----------------------------------------------------------------------------
-- Privileges
-- Deny by default: anon gets nothing; authenticated gets only what RLS needs.
-- TRUNCATE bypasses RLS, so it is revoked everywhere.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from public, anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;

revoke truncate, references, trigger on all tables in schema public from authenticated;

revoke insert, update, delete on public.workspaces from authenticated;

revoke insert, update, delete on public.profiles from authenticated;
-- role/is_active are column-granted for the admin UI; profiles_guard blocks non-admins.
grant update (full_name, locale, role, is_active) on public.profiles to authenticated;

revoke insert, update, delete on public.form_versions from authenticated;
revoke insert, update on public.responses from authenticated;
revoke insert, update on public.response_answers from authenticated;
revoke all on public.response_drafts from authenticated;
revoke all on public.rate_limits from authenticated;

-- Policy helpers must be executable by authenticated (RLS evaluates them as the
-- caller). They only reveal booleans about the caller's own permissions.
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.profiles_guard() from authenticated;
revoke execute on function public.forms_guard() from authenticated;
revoke execute on function public.form_versions_immutable() from authenticated;
revoke execute on function public.set_updated_at() from authenticated;
grant execute on function public.current_workspace_id() to authenticated;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_form_owner(uuid) to authenticated;
grant execute on function public.can_view_form(uuid) to authenticated;
grant execute on function public.can_edit_form(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.forms enable row level security;
alter table public.form_versions enable row level security;
alter table public.form_members enable row level security;
alter table public.responses enable row level security;
alter table public.response_answers enable row level security;
alter table public.response_drafts enable row level security;
alter table public.dashboards enable row level security;
alter table public.dashboard_shares enable row level security;
alter table public.rate_limits enable row level security;

-- workspaces
create policy "workspaces: members read own workspace"
  on public.workspaces for select to authenticated
  using (id = (select public.current_workspace_id()));

-- profiles
create policy "profiles: read own row"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles: admin reads workspace"
  on public.profiles for select to authenticated
  using ((select public.is_admin()) and workspace_id = (select public.current_workspace_id()));

create policy "profiles: update own row"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "profiles: admin updates workspace"
  on public.profiles for update to authenticated
  using ((select public.is_admin()) and workspace_id = (select public.current_workspace_id()))
  with check ((select public.is_admin()) and workspace_id = (select public.current_workspace_id()));

-- forms
create policy "forms: select if viewable"
  on public.forms for select to authenticated
  using (public.can_view_form(id));

create policy "forms: admin or editor creates own"
  on public.forms for insert to authenticated
  with check (
    (select public.current_app_role()) in ('admin', 'editor')
    and owner_id = (select auth.uid())
    and workspace_id = (select public.current_workspace_id())
  );

create policy "forms: update if editable"
  on public.forms for update to authenticated
  using (public.can_edit_form(id))
  with check (public.can_edit_form(id));

create policy "forms: admin or owner deletes"
  on public.forms for delete to authenticated
  using ((select public.is_admin()) or public.is_form_owner(id));

-- form_versions (no client writes; publish_form RPC arrives in Phase 2)
create policy "form_versions: select if form viewable"
  on public.form_versions for select to authenticated
  using (public.can_view_form(form_id));

-- form_members
create policy "form_members: select if form viewable"
  on public.form_members for select to authenticated
  using (public.can_view_form(form_id));

create policy "form_members: admin or owner inserts"
  on public.form_members for insert to authenticated
  with check (
    public.can_edit_form(form_id)
    and ((select public.is_admin()) or public.is_form_owner(form_id))
  );

create policy "form_members: admin or owner updates"
  on public.form_members for update to authenticated
  using (
    public.can_edit_form(form_id)
    and ((select public.is_admin()) or public.is_form_owner(form_id))
  )
  with check (
    public.can_edit_form(form_id)
    and ((select public.is_admin()) or public.is_form_owner(form_id))
  );

create policy "form_members: admin or owner deletes"
  on public.form_members for delete to authenticated
  using (
    public.can_edit_form(form_id)
    and ((select public.is_admin()) or public.is_form_owner(form_id))
  );

-- responses
create policy "responses: select if form viewable"
  on public.responses for select to authenticated
  using (public.can_view_form(form_id));

create policy "responses: admin or owner deletes"
  on public.responses for delete to authenticated
  using ((select public.is_admin()) or public.is_form_owner(form_id));

-- response_answers
create policy "response_answers: select if form viewable"
  on public.response_answers for select to authenticated
  using (public.can_view_form(form_id));

create policy "response_answers: admin or owner deletes"
  on public.response_answers for delete to authenticated
  using ((select public.is_admin()) or public.is_form_owner(form_id));

-- dashboards
create policy "dashboards: select if form viewable"
  on public.dashboards for select to authenticated
  using (public.can_view_form(form_id));

create policy "dashboards: insert if form editable"
  on public.dashboards for insert to authenticated
  with check (public.can_edit_form(form_id));

create policy "dashboards: update if form editable"
  on public.dashboards for update to authenticated
  using (public.can_edit_form(form_id))
  with check (public.can_edit_form(form_id));

-- dashboard_shares
create policy "dashboard_shares: select if form editable"
  on public.dashboard_shares for select to authenticated
  using (public.can_edit_form(form_id));

create policy "dashboard_shares: insert if form editable"
  on public.dashboard_shares for insert to authenticated
  with check (public.can_edit_form(form_id));

create policy "dashboard_shares: update if form editable"
  on public.dashboard_shares for update to authenticated
  using (public.can_edit_form(form_id))
  with check (public.can_edit_form(form_id));

create policy "dashboard_shares: delete if form editable"
  on public.dashboard_shares for delete to authenticated
  using (public.can_edit_form(form_id));

-- response_drafts, rate_limits: RLS on, no policies, no grants => no client access.

-- -----------------------------------------------------------------------------
-- Realtime: live dashboards subscribe to new responses (RLS still applies).
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.responses;
  end if;
end;
$$;
