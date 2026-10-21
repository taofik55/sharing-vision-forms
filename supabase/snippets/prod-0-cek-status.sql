-- =============================================================================
-- LANGKAH 0: cek status prod (read-only, aman dijalankan kapan saja)
-- Jalankan langkah 1-3 HANYA untuk kolom yang hasilnya false.
-- =============================================================================

-- Objek penanda tiap langkah (false = langkah itu belum dijalankan).
select
  exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'dashboard_query') as langkah1_chart_builder,
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'app_role' and e.enumlabel = 'surveyor')           as langkah2_role_surveyor,
  exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'qc_overview')     as langkah3_capi_toolkit,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'forms' and column_name = 'capi_settings')          as langkah3_kolom_capi;
