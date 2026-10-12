# FormPulse: project context

## Product
FormPulse is a dynamic form platform similar to Google Forms. Respondents (no login) fill public forms. Internal users (login) build forms and view live, auto-generated, manually editable dashboards.

## Stack (fixed, do not swap)
- Next.js (latest stable) App Router, TypeScript strict, pnpm
- Tailwind CSS + shadcn/ui, lucide-react
- Supabase: Postgres, Auth, Realtime. Clients via @supabase/ssr
- dnd-kit (form builder), react-grid-layout (dashboard layout), Recharts (charts)
- Zod, react-hook-form, TanStack Query, next-intl (en, id), date-fns, exceljs, html-to-image
- Vitest (unit), Playwright (e2e)

## Roles
- admin: manages users and roles, sees and manages every form, can delete any form/response.
- editor: creates forms, edits own forms and forms shared to them as editor, views their dashboards.
- viewer: read-only access to dashboards and responses of forms shared to them.
- respondent: no account, fills public forms only.
Form-level access is stored in form_members (viewer or editor). Single-tenant now, but every key table carries workspace_id so multi-tenant is a later migration, not a rewrite.

## Architecture rules (non-negotiable)
1. RLS is enabled on every table in the public schema. Policies live in migrations.
2. SUPABASE_SECRET_KEY is used only in src/lib/supabase/admin.ts, which imports 'server-only'. Never in client code, never prefixed NEXT_PUBLIC.
3. Respondents never talk to Supabase directly. They use Route Handlers under /api/f/... that validate input server-side and call RPCs with the admin client.
4. The form definition is JSON validated by ONE Zod schema in src/lib/forms/schema.ts, shared by the builder, renderer, server validation and analytics.
5. Every question has a stable key (nanoid) that never changes across versions. Answers store question_key, never question position.
6. Published form versions are immutable snapshots. Editing a published form edits a draft; publishing creates version N+1. Old responses keep their form_version_id.
7. Aggregations run in Postgres (SQL/RPC). Never load all raw rows into the browser. Raw rows are always paginated server-side.
8. SECURITY DEFINER functions must set search_path = '', check permission explicitly, and revoke execute from anon/authenticated unless intentionally public.
9. All user-facing strings go through next-intl (messages/en.json, messages/id.json). No hardcoded strings. Default locale: id.
10. Schema changes only via new timestamp-prefixed files in supabase/migrations. Never edit an applied migration.
11. DB types are generated with supabase gen types into src/types/database.ts.

## Folder structure
```
src/
  app/
    [locale]/
      (auth)/login/
      (app)/forms/                 list
      (app)/forms/[id]/builder/
      (app)/forms/[id]/dashboard/
      (app)/forms/[id]/responses/
      (app)/forms/[id]/settings/
      (app)/admin/users/
      (app)/admin/demo/scale/
      f/[slug]/                    public form, no auth
      d/[token]/                   public read-only dashboard
    api/f/[slug]/submit|draft
    api/d/[token]/stats
    api/forms/[id]/export
  components/ ui/ builder/ renderer/ dashboard/ charts/
  lib/ supabase/ forms/ analytics/ rate-limit/ i18n/
  types/
supabase/migrations/
scripts/seed.ts
messages/en.json id.json
docs/progress.md supabase-setup.md architecture.md
```

## Working agreement
- Implement ONLY the current phase. If something belongs to a later phase, stub it and leave a TODO(phase-N).
- Start each phase by writing a short plan and your assumptions in docs/progress.md.
- End each phase with pnpm lint, pnpm typecheck and pnpm test all green. Update docs/progress.md with: what is done, decisions made, known gaps, and a manual verification checklist.
- Server components by default. Client components only where interaction is needed.
- Do not ask me questions unless truly blocked. Pick the sensible default and document it.