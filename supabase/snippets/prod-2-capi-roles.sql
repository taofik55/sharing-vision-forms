-- =============================================================================
-- LANGKAH 2: role surveyor (enum)
-- Isi: 20261021090000_capi_roles.sql.
-- Jalankan SENDIRI dan sampai selesai sebelum langkah 3: nilai enum baru
-- harus sudah di-commit sebelum dipakai oleh fungsi di langkah 3.
-- =============================================================================

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

-- Dicatat hanya jika prod memakai riwayat Supabase CLI (tabel ada).
do $rec$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name)
    values ('20261021090000', 'capi_roles')
    on conflict (version) do nothing;
  end if;
end
$rec$;
