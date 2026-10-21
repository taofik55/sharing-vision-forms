-- =============================================================================
-- CAPI (face-to-face interviews): surveyor roles.
--
-- app_role 'surveyor': field staff accounts that only run interviews.
-- member_role 'surveyor': a form assigned to a surveyor (fills interviews,
--   no dashboards or responses).
-- New enum values must be committed before use, so they get their own file.
-- =============================================================================

alter type public.app_role add value if not exists 'surveyor';
alter type public.member_role add value if not exists 'surveyor';
