-- Fix: INSERT ... RETURNING on forms failed RLS for the creator.
-- The SELECT policy is also checked on the returned row, and can_view_form()
-- (STABLE, own snapshot) cannot see a row inserted by the same statement.
-- Owners are matched directly on the row instead. current_app_role() is null
-- for inactive profiles, so deactivated owners still see nothing.
drop policy "forms: select if viewable" on public.forms;

create policy "forms: select if viewable"
  on public.forms for select to authenticated
  using (
    (owner_id = (select auth.uid()) and (select public.current_app_role()) is not null)
    or public.can_view_form(id)
  );
