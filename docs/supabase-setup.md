# Supabase setup

Step-by-step configuration for Sharing Vision Form App (code name FormPulse), matching what is in this repository. Two targets:

- **Local** (Docker): development, tests, benchmarks.
- **Hosted** (supabase.com): staging and production.

The app needs Postgres (with RLS), Auth (email + password, invite-only) and Realtime. Storage, Edge Functions and analytics are not used.

## 1. Local stack

Requires Docker Desktop and Node.js 22+ (`nvm use`, see `.nvmrc`).

```bash
pnpm install
pnpm db:start                     # supabase start without imgproxy, vector, logflare, edge-runtime, storage-api
pnpm exec supabase status         # API URL, publishable key, secret key, Studio URL (http://127.0.0.1:54323)
cp .env.example .env.local        # paste the values (see "Environment variables" below)
pnpm db:reset                     # fresh database + every file in supabase/migrations, in order
pnpm seed                         # default workspace + DUMMY accounts
pnpm seed:demo                    # optional: demo form with 300 generated responses
pnpm db:types                     # regenerates src/types/database.ts after schema changes
```

`supabase/config.toml` already matches production settings that matter: `enable_signup = false` (no public sign-ups), email provider with password, `site_url = "http://localhost:3000"`, redirect URLs for localhost.

## 2. Hosted project

### 2.1 Create the project

1. supabase.com > **New project**. Region: **Southeast Asia (Singapore)** (`ap-southeast-1`), next to the Vercel functions in `sin1` (see README > Deploy).
2. Set a strong database password and keep it in your password manager (only needed for `supabase link` / `db push`).
3. Postgres 17 (the version used locally, `major_version = 17` in `supabase/config.toml`).

### 2.2 API keys

**Project Settings > API Keys**. Use the new key types, not the legacy `anon` / `service_role` JWT keys.

| Key                                       | Where it goes                          | Notes                                                                                                        |
| ----------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Publishable key (`sb_publishable_...`)    | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Safe in the browser. RLS protects the data.                                                                  |
| Secret key (`sb_secret_...`)              | `SUPABASE_SECRET_KEY`                  | Bypasses RLS. Server only, never `NEXT_PUBLIC_`. Read only by `src/lib/supabase/admin.ts` (ESLint enforces). |
| Project URL (`https://<ref>.supabase.co`) | `NEXT_PUBLIC_SUPABASE_URL`             |                                                                                                              |

Create a separate secret key per environment (staging, production) so one can be revoked without touching the other.

### 2.3 Environment variables

Same names locally (`.env.local`) and on Vercel (Project Settings > Environment Variables).

| Variable                               | Required | Example / how to get it     | Purpose                                                                              |
| -------------------------------------- | -------- | --------------------------- | ------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | yes      | `https://<ref>.supabase.co` | Supabase API                                                                         |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes      | `sb_publishable_...`        | Browser + server client (RLS applies)                                                |
| `SUPABASE_SECRET_KEY`                  | yes      | `sb_secret_...`             | Server only: public form submissions, share links, admin user management, demo tools |
| `NEXT_PUBLIC_SITE_URL`                 | yes      | `https://forms.example.com` | Absolute links (public form URL, QR code, share links)                               |
| `IP_HASH_SALT`                         | yes      | `openssl rand -base64 48`   | Salted HMAC of respondent IPs for rate limiting (raw IPs are never stored)           |
| `ENABLE_DEMO_TOOLS`                    | no       | `false` (default)           | `true` enables `/admin/demo/scale`. Keep `false` in production.                      |

### 2.4 Apply the migrations

Migrations run in file-name order. Current files:

```
supabase/migrations/20261012120000_init.sql                       schema, helpers, RLS, grants, realtime publication
supabase/migrations/20261013090000_phase2_forms.sql               publish_form, list_forms, sharing RPCs
supabase/migrations/20261013090100_fix_add_form_member.sql
supabase/migrations/20261013090200_forms_owner_select.sql
supabase/migrations/20261014090000_phase3_submissions.sql         submit_response, drafts, rate limits
supabase/migrations/20261015090000_phase4_dashboard.sql           dashboard RPCs, column privileges, demo generator
supabase/migrations/20261015090100_phase4_no_temp_tables.sql
supabase/migrations/20261016090000_overview_calendar_days.sql
supabase/migrations/20261016100000_dashboard_set_based.sql
supabase/migrations/20261016100100_fix_cross_suggestions_score.sql
supabase/migrations/20261016110000_bundle_questions_single_pass.sql
supabase/migrations/20261016120000_bundle_questions_memory.sql
supabase/migrations/20261017090000_phase5_scale_export.sql        summaries, export, share-safe RPCs, demo tools
```

**With the CLI (recommended):**

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref <ref>        # asks for the database password
pnpm exec supabase db push --dry-run               # lists the migrations it will apply
pnpm exec supabase db push
pnpm exec supabase migration list                  # local and remote columns must match
pnpm exec supabase gen types typescript --project-id <ref> --schema public > src/types/database.ts
pnpm exec prettier --write src/types/database.ts   # should produce no diff against the committed file
```

**Fallback without the CLI (SQL editor):** open **SQL Editor**, paste each file above **in order**, one per run, and check that each run succeeds before the next. Then record them as applied so a later `db push` does not run them again:

```bash
pnpm exec supabase migration repair --status applied 20261012120000 20261013090000 20261013090100 \
  20261013090200 20261014090000 20261015090000 20261015090100 20261016090000 20261016100000 \
  20261016100100 20261016110000 20261016120000 20261017090000
```

Rules: schema changes only through **new** timestamp-prefixed files; never edit a migration that has been applied anywhere.

### 2.5 Auth settings

**Authentication > Sign In / Providers**

- **Email**: enabled, password sign-in. Confirm email can stay on: admins create users with `email_confirm: true` (Admin > Users).
- **Allow new users to sign up: off.** FormPulse is invite-only; only admins create accounts. (Locally: `enable_signup = false`.)
- Other providers: off.

**Authentication > URL Configuration**

- **Site URL**: the value of `NEXT_PUBLIC_SITE_URL` (e.g. `https://forms.example.com`).
- **Redirect URLs**: `https://forms.example.com/**` and, for previews, `https://*-<team>.vercel.app/**`.

**Authentication > JWT Keys** (recommended): switch to asymmetric signing keys so `auth.getClaims()` verifies sessions locally instead of calling the Auth server on each request.

Roles are stored in `profiles.role` (and `raw_app_meta_data.role`, which users cannot change). The first admin is created by the seed (dev) or manually (production, see 2.6).

### 2.6 Seed

- **Development / staging**: `pnpm seed --allow-remote` with `.env.local` pointing at the project. Creates the default workspace and the three DUMMY accounts. `pnpm seed:demo --allow-remote` adds the demo form (optional).
- **Production**: do **not** run the seed (its DUMMY accounts have a public password). The init migration already creates the default workspace (`00000000-0000-0000-0000-000000000001`). Create the first admin by hand:
  1. **Authentication > Users > Add user** with your email and a strong password, **Auto Confirm User** on.
  2. SQL editor:

     ```sql
     update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}' where email = 'you@example.com';
     update public.profiles set role = 'admin', is_active = true where email = 'you@example.com';
     ```

     The `on_auth_user_created` trigger created the profile (role `viewer`); the updates make it an admin. Everyone else is created from Admin > Users.

  3. If DUMMY accounts ever reached a shared project: deactivate them in Admin > Users (this also bans the auth user) or delete them under Authentication > Users.

### 2.7 Realtime

The init migration adds `public.responses` to the `supabase_realtime` publication. Check it:

```sql
select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime';
-- expected: public | responses
```

If the row is missing (the publication did not exist when the migration ran): `alter publication supabase_realtime add table public.responses;`

Realtime applies RLS and column privileges to each subscriber: viewers receive only the columns they may read (no identifiers). Dashboards join the channel with the user's access token (`realtime.setAuth`). Anonymous public dashboards poll instead.

### 2.8 Verify RLS and grants

```sql
-- every public table has RLS enabled (expect no rows)
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- anon has no table privileges (expect no rows)
select table_name, privilege_type from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public';

-- SECURITY DEFINER functions all pin search_path (expect no rows)
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%');
```

Then run the test suite against a **staging** project (it creates and deletes test forms; never against production):

```bash
pnpm exec supabase db lint --linked     # plpgsql_check: no errors
pnpm test                               # unit + RLS / RPC integration tests (.env.local -> staging)
```

### 2.9 Production hardening

- `ENABLE_DEMO_TOOLS=false` (default). The demo page and its server actions refuse to run otherwise.
- No DUMMY accounts: never seed them, or deactivate them in Admin > Users and rotate their passwords. Their password is public (`Password123!`).
- Public sign-ups off; leaked-password protection and a minimum password length of 10+ in **Authentication > Policies**.
- Custom SMTP (**Authentication > Emails**) if you send password-reset emails; the built-in sender is rate-limited.
- Secret key: one per environment, only in Vercel env vars; rotate it (Project Settings > API Keys) if it was ever shared, then redeploy.
- `IP_HASH_SALT`: long random value per environment. Rotating it resets rate-limit buckets only.
- **Database > Network Restrictions**: limit direct Postgres access to your IPs (the app uses the HTTPS API).
- Backups: daily backups are included on paid plans; enable Point-in-Time Recovery for production.
- Statement timeouts: API roles stop statements after 8 s (`authenticated`) / 3 s (`anon`). The app keeps every call short (dashboard summaries, keyset pagination, chunked demo jobs); do not raise them to hide slow queries.

## 3. Troubleshooting

| Symptom                                                                  | Cause / fix                                                                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `Missing environment variable ...` on start                              | `.env.local` / Vercel env vars incomplete (see 2.3).                                                                                       |
| `WebSocket is not defined` / Realtime errors in scripts                  | Node.js < 22. Use Node 22+ (`nvm use`).                                                                                                    |
| Dashboard never shows "Live", only polling                               | `public.responses` not in the publication (2.7), or Realtime disabled for the project.                                                     |
| `permission denied for table response_answers` in your own queries       | Intended: signed-in users read answers only through RPCs (masking, aggregation). Use `list_responses`, `get_response`, `export_responses`. |
| `canceling statement due to statement timeout` (57014) from demo tools   | Chunks too large for the 8 s API timeout. The app uses 1,000 per generator call and 20,000 per cleanup call; keep it that way.             |
| Dashboard numbers look stale after editing responses with the secret key | Summaries are maintained on INSERT / DELETE only. Run `select public.rebuild_dashboard_summary('<form id>');` (secret key / SQL editor).   |
| `supabase db push` wants to re-apply migrations                          | They were applied in the SQL editor without `migration repair` (2.4).                                                                      |
| Local `supabase db reset` hangs at "gotrue migrate"                      | Docker Desktop issue: `docker rm -f` the stuck `gotrue` container (or restart Docker) and run `pnpm db:reset` again.                       |
| `src/types/database.ts` out of date (type errors after pulling)          | `pnpm db:types` (local) or the `gen types --project-id` command in 2.4.                                                                    |
| `/admin/demo/scale` says demo tools are off                              | `ENABLE_DEMO_TOOLS` is not `true` for this deployment (intended in production).                                                            |

## DUMMY accounts (local / staging only)

| Email                 | Password     | Role   |
| --------------------- | ------------ | ------ |
| admin@formpulse.test  | Password123! | admin  |
| editor@formpulse.test | Password123! | editor |
| viewer@formpulse.test | Password123! | viewer |
