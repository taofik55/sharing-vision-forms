# Supabase setup

## Local (default for development and tests)

Requires Docker and Node.js 22+.

```bash
pnpm db:start                     # starts the local stack (Studio: http://127.0.0.1:54323)
pnpm exec supabase status         # prints API URL, publishable key, secret key
cp .env.example .env.local        # paste NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY
pnpm db:reset                     # applies supabase/migrations to a fresh database
pnpm seed                         # default workspace + DUMMY accounts
pnpm db:types                     # regenerates src/types/database.ts
```

`supabase/config.toml` disables public sign-ups and the services Phase 1 does not use (storage, edge runtime, analytics).

## Hosted project

1. Create a project. In **Authentication > Sign In / Providers**, turn off **Allow new users to sign up** (admins create users).
2. In **Authentication > URL Configuration**, set the Site URL to `NEXT_PUBLIC_SITE_URL` and add it to the redirect URLs.
3. In **Project Settings > API Keys**, copy the **publishable** key and create/copy a **secret** key. Do not use the legacy `anon` / `service_role` keys.
4. Push the schema and generate types:

   ```bash
   pnpm exec supabase login
   pnpm exec supabase link --project-ref <ref>
   pnpm exec supabase db push
   pnpm exec supabase gen types typescript --project-id <ref> --schema public > src/types/database.ts
   pnpm exec prettier --write src/types/database.ts
   ```

5. Optional, dev/demo projects only: `pnpm seed --allow-remote` with `.env.local` pointing at the project.

Recommended: enable asymmetric JWT signing keys so `auth.getClaims()` verifies tokens locally instead of calling the Auth server on every request.

## DUMMY accounts

Created by `scripts/seed.ts`. **For local development and demos only.** The password is public.

| Email                 | Password     | Role   |
| --------------------- | ------------ | ------ |
| admin@formpulse.test  | Password123! | admin  |
| editor@formpulse.test | Password123! | editor |
| viewer@formpulse.test | Password123! | viewer |

Never seed these into production. If they end up in a shared project, deactivate them in Admin > Users.

## Rules

- Schema changes only through new timestamp-prefixed files in `supabase/migrations/`. Never edit an applied migration.
- RLS on every public table, policies in migrations.
- `SECURITY DEFINER` functions: `set search_path = ''`, explicit permission checks, no `anon` execute.
- `SUPABASE_SECRET_KEY` is read only in `src/lib/supabase/admin.ts` (ESLint enforces this).
