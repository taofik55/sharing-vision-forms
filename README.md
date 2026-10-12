# FormPulse

Dynamic forms with live, editable dashboards. Respondents fill public forms without an account; internal users (admin, editor, viewer) build forms and read dashboards.

## Quick start

```bash
nvm use                    # Node.js 22+ (see .nvmrc)
pnpm install
pnpm db:start              # local Supabase via Docker
cp .env.example .env.local # fill in keys from `pnpm exec supabase status`
pnpm db:reset && pnpm seed
pnpm dev                   # http://localhost:3000
```

DUMMY accounts (local only): `admin@formpulse.test`, `editor@formpulse.test`, `viewer@formpulse.test`, password `Password123!`.

## Scripts

| Script                                    | What it does                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm dev` / `build` / `start`            | Next.js                                                                           |
| `pnpm lint` / `typecheck` / `format`      | ESLint, `tsc`, Prettier                                                           |
| `pnpm test`                               | Vitest unit + RLS integration tests (needs the seeded Supabase from `.env.local`) |
| `pnpm e2e`                                | Playwright (starts `pnpm dev` if nothing is running)                              |
| `pnpm seed`                               | Idempotent seed (default workspace + dummy accounts)                              |
| `pnpm db:start` / `db:reset` / `db:types` | Local Supabase helpers                                                            |

## Docs

- [docs/progress.md](docs/progress.md): phase status, decisions, known gaps, verification checklist
- [docs/architecture.md](docs/architecture.md): ERD, RLS summary, request flow
- [docs/supabase-setup.md](docs/supabase-setup.md): local and hosted setup
