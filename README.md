# Sharing Vision Form App

Internal code name: FormPulse (used in identifiers such as the dummy `@formpulse.test` accounts).

Dynamic forms with live, editable dashboards. Respondents fill public forms without an account; internal users (admin, editor, viewer) build forms, read live dashboards, export responses and share read-only dashboard links.

Stack: Next.js 16 (App Router, TypeScript), Tailwind + shadcn/ui, Supabase (Postgres + RLS, Auth, Realtime), TanStack Query, Recharts, react-grid-layout, next-intl (Indonesian default, English), exceljs, Vitest, Playwright.

## Local setup

Requirements: Node.js 22+ (`nvm use`, see `.nvmrc`), pnpm, Docker Desktop.

```bash
nvm use
pnpm install
pnpm db:start                     # local Supabase in Docker (Studio: http://127.0.0.1:54323)
pnpm exec supabase status         # prints the URL and keys for .env.local
cp .env.example .env.local        # fill in the variables below
pnpm db:reset                     # applies supabase/migrations to a fresh database
pnpm seed                         # default workspace + DUMMY accounts
pnpm seed:demo                    # optional: demo survey with 300 generated responses
pnpm dev                          # http://localhost:3000
```

DUMMY accounts (local / staging only, public password): `admin@formpulse.test`, `editor@formpulse.test`, `viewer@formpulse.test`, password `Password123!`.

Full Supabase guide (hosted project, keys, migrations, Auth, Realtime, RLS checks, hardening, troubleshooting): [docs/supabase-setup.md](docs/supabase-setup.md).

## Environment variables

| Variable                               | Required | Exposed to browser | Purpose                                                                                                        |
| -------------------------------------- | -------- | ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | yes      | yes                | Supabase project URL                                                                                           |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes      | yes                | Publishable key (`sb_publishable_...`); RLS protects the data                                                  |
| `SUPABASE_SECRET_KEY`                  | yes      | **never**          | Secret key (`sb_secret_...`), read only in `src/lib/supabase/admin.ts`; public forms, share links, admin tools |
| `NEXT_PUBLIC_SITE_URL`                 | yes      | yes                | Absolute base URL for public form links, QR codes and dashboard share links                                    |
| `IP_HASH_SALT`                         | yes      | **never**          | Long random string; respondent IPs are stored only as salted HMACs for rate limiting                           |
| `ENABLE_DEMO_TOOLS`                    | no       | no                 | `true` enables `/admin/demo/scale` (demo data, simulator, benchmark panel). Default and production: `false`    |

## Scripts

| Script                                    | What it does                                                                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev` / `build` / `start`            | Next.js                                                                                                                                                                        |
| `pnpm lint` / `typecheck` / `format`      | ESLint, `tsc`, Prettier                                                                                                                                                        |
| `pnpm test`                               | Vitest: unit + RLS / RPC integration tests (needs the seeded Supabase from `.env.local`)                                                                                       |
| `pnpm e2e`                                | Playwright (starts `pnpm dev` if nothing is running); the scale test needs `ENABLE_DEMO_TOOLS=true`                                                                            |
| `pnpm seed`                               | Idempotent seed (default workspace + DUMMY accounts); refuses non-local targets without `--allow-remote`                                                                       |
| `pnpm seed:demo [--n 300 --days 30]`      | Demo form "Customer Satisfaction Survey (Demo)" with generated, correlated responses (`is_demo`)                                                                               |
| `pnpm db:dummy-sql`                       | Regenerates `supabase/dummy-data.sql`: dummy accounts, forms (published / two versions / identifier / closed / archived / draft), responses and share links for the SQL editor |
| `pnpm bench:dashboard [--sizes 1000,...]` | Grows the scale demo form to each size and times every dashboard RPC through the API (local only)                                                                              |
| `pnpm check:secrets`                      | After `pnpm build`: fails if `SUPABASE_SECRET_KEY`, `IP_HASH_SALT` or any `sb_secret_` key is in client files                                                                  |
| `pnpm db:start` / `db:reset` / `db:types` | Local Supabase helpers (`db:types` regenerates `src/types/database.ts`)                                                                                                        |

Before merging: `pnpm lint && pnpm typecheck && pnpm test`, and `pnpm e2e` for UI changes.

## Deploy (Vercel + Supabase)

1. **Supabase**: create the project in **Singapore (ap-southeast-1)** and follow [docs/supabase-setup.md](docs/supabase-setup.md) sections 2.1–2.9 (keys, `supabase db push`, Auth invite-only, first admin, Realtime check).
2. **Vercel**: import the repository (framework preset Next.js, install `pnpm install`, build `pnpm build`).
   - **Settings > Functions > Function Region: `sin1` (Singapore)**, next to the database. Every dashboard request makes one or more database round trips; another region adds ~150–250 ms each.
   - **Settings > Environment Variables**: the six variables above for Production (and Preview with a staging project). `NEXT_PUBLIC_SITE_URL` must be the production domain. Keep `ENABLE_DEMO_TOOLS=false` in Production.
   - Node.js 22.x or newer (Settings > General).
   - The export route asks for up to 300 s (`maxDuration = 300`). Check your plan's maximum function duration: a 100k-row export streams for about a minute (see docs/scale-report.md); a lower limit cuts large exports short (export a date range instead).
3. **Auth URLs** in Supabase: Site URL = production domain; redirect URLs = `https://<domain>/**` (+ `https://*-<team>.vercel.app/**` for previews).
4. Deploy, then run the checklist below.

### Post-deploy checklist

- [ ] `https://<domain>/` redirects to `/id/login`; sign-up is not offered; the language switcher works.
- [ ] Sign in as the first admin; Admin > Users lists only real accounts (no `@formpulse.test` users active).
- [ ] Create an editor, sign in as them, create a form from a template, publish it, open the public link in a private window and submit from a phone.
- [ ] The editor's dashboard shows the response within a few seconds (badge "Live").
- [ ] Responses tab: the row is there; Export CSV and XLSX download and open in Excel (Indonesian characters intact).
- [ ] Share > Create link: the link opens in a private window without login, shows no identifiers, and stops working after Revoke.
- [ ] `/id/admin/demo/scale` says demo tools are off.
- [ ] Response headers on an app page include `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`.
- [ ] Locally against the same commit: `pnpm build && pnpm check:secrets` passes.
- [ ] Supabase: RLS checks from docs/supabase-setup.md 2.8 return no rows; backups / PITR enabled.

## Docs

- [docs/progress.md](docs/progress.md): phase status, decisions, known gaps, manual verification checklists
- [docs/architecture.md](docs/architecture.md): ERD, RLS summary, request flow, dashboard data layer, summaries, export, public links
- [docs/scale-report.md](docs/scale-report.md): measured RPC timings at 1k–100k responses, EXPLAIN ANALYZE, fixes
- [docs/supabase-setup.md](docs/supabase-setup.md): step-by-step Supabase configuration (local and hosted)
