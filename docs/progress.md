# FormPulse progress

## Phase 1: foundation, auth, roles, schema, seed, app shell

Status: **done** (2026-10-12)

### Plan (written at phase start)

1. Scaffold Next.js (latest stable: 16.4) + TS strict + Tailwind 4 + shadcn/ui, ESLint, Prettier, Vitest, Playwright.
2. next-intl with `id` (default) and `en`, locale prefix always.
3. Supabase clients (browser, server, admin) and a `proxy.ts` that refreshes the session and runs next-intl.
4. One migration with the full Phase 1 schema, permission helpers, triggers, grants and RLS.
5. Idempotent seed for the default workspace and three dummy accounts.
6. Login/logout, route protection, 403 page, inactive-user handling.
7. App shell (sidebar, header, user menu, language switcher, theme toggle, role badge), home with empty states.
8. Admin > Users (create, change role, activate/deactivate) through server actions.
9. Unit, integration (RLS) and e2e tests. Docs.

### Assumptions

- Phase numbering for TODOs is assumed: **2** = forms list + builder + `publish_form`, **3** = public form rendering/submission (`/f`, `/api/f`), **4** = dashboards + share links (`/d`, `/api/d`), **5** = export + demo/scale tools. Adjust the `TODO(phase-N)` tags if the real plan differs.
- Integration tests run against the **local Supabase stack** (Docker) configured in `.env.local`. They also work against a hosted dev project if `.env.local` points there and it has been seeded.
- Users are deactivated, never deleted, so FKs to `profiles` use `no action` / `set null` (see architecture).

### What is done

- Scaffold: Next.js 16.4 (App Router, Turbopack), React 19.3, TypeScript strict, Tailwind 4, shadcn/ui (Radix base), ESLint (+ prettier config), Prettier (+ Tailwind plugin), Vitest 5, Playwright.
- Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `e2e`, `seed`, `db:start`, `db:reset`, `db:types`, `format`.
- `.env.example` with the new Supabase key names (publishable / secret).
- i18n: `src/lib/i18n/{routing,request,navigation}.ts`, `messages/{en,id}.json` by feature namespace, typed message keys (`src/types/next-intl.d.ts`), language switcher on every page (app shell, login, public pages).
- Supabase: `src/lib/supabase/{client,server,admin}.ts`; `admin.ts` imports `server-only` and is the only reader of `SUPABASE_SECRET_KEY` (ESLint rule enforces it).
- `src/proxy.ts` (Next 16 renamed `middleware` to `proxy`): session refresh, auth redirect, next-intl routing. API routes are excluded and authorize themselves.
- Migration `supabase/migrations/20261012120000_init.sql`: enums, 11 tables, indexes, helper functions, triggers, grants, RLS, realtime publication.
- `src/types/database.ts` generated with `supabase gen types`.
- Seed `scripts/seed.ts` (idempotent; refuses non-local targets without `--allow-remote`).
- Auth UI: login (server action, friendly i18n errors), logout, inactive users are signed out with a message, `next` redirect with open-redirect protection.
- Guards: `(app)` layout requires a session; `/admin/*` layout calls `forbidden()` → real **HTTP 403** page inside the shell.
- Public stubs that do not require auth: `/[locale]/f/[slug]`, `/[locale]/d/[token]`, `/api/f/[slug]/submit|draft`, `/api/d/[token]/stats` (501).
- App shell with role-aware navigation; home and forms pages with empty states; viewers see no create buttons.
- Admin > Users: table, create user dialog (react-hook-form + zod), role select, activate/deactivate; admin cannot change their own row (UI, server action and database trigger).
- Tests: 79 Vitest tests (unit + integration), 6 Playwright tests. All green.

### Decisions

1. **Next.js 16.4 + `proxy.ts`**. `middleware.ts` is deprecated in 16. Session refresh runs first and writes rotated cookies onto the request, then next-intl runs, so Server Components see fresh cookies.
2. **Cache Components disabled** (create-next-app 16.4 enables it by default). Every internal page reads the session cookie, so request-time rendering is simpler and safe. Revisit for public pages later.
3. **Node.js 22+ required.** `@supabase/supabase-js` 2.117 needs native WebSocket. Node 24 LTS was installed via nvm (`nvm use 24.21.0`); `.nvmrc` and `engines` added.
4. **Role on sign-up comes from `raw_app_meta_data`, not `raw_user_meta_data`** (deviation from the spec, for security). User metadata is client-controlled on public sign-up and would let anyone register as admin. The seed and the admin UI still send `user_metadata { role, full_name }` as specified, and also set `app_metadata.role` and the profile role explicitly with the admin client.
5. **App role `viewer` is read-only everywhere**: `can_edit_form` ignores a `form_members.role = editor` row when the user's app role is viewer.
6. **Inactive users get no permissions**: every helper (`is_admin`, `can_view_form`, …) requires `is_active`. Deactivation also bans the auth user (`ban_duration`), so they cannot sign in or refresh tokens; the next request is redirected to `/api/auth/signout?reason=inactive`, which clears the session and shows a message.
7. **403 via `forbidden()`** (`experimental.authInterrupts`) with `(app)/forbidden.tsx`, so the status code is a real 403 and the page is translated.
8. **Extra integrity**: composite FKs make `responses.form_version_id` and `forms.current_version_id` point at a version of the same form. `form_versions` is immutable even for the secret key; the only delete allowed is the cascade when its form is deleted.
9. **Defense in depth on grants**: anon has no table, sequence or function privileges (also via default privileges for future objects). `TRUNCATE` (which bypasses RLS) is revoked from `authenticated`. `profiles` only grants `UPDATE (full_name, locale, role, is_active)`; a trigger blocks non-admins from changing role/status/workspace/email and blocks admins from demoting or deactivating themselves. A second trigger blocks non-admins from changing a form's owner or workspace.
10. **Public sign-ups disabled** in `supabase/config.toml` (internal users are created by admins). Do the same on hosted projects.
11. Dates are formatted on the server with next-intl in `Asia/Jakarta` to avoid hydration mismatches.
12. shadcn CLI 4 uses the official `cn` package (`src/lib/utils.ts` re-exports it).

### Known gaps

- The language switcher does not yet persist the choice to `profiles.locale` (the next-intl cookie remembers it per browser).
- Admin > Users loads up to 500 users without pagination (`TODO(phase-later)`).
- Editors cannot list other users' profiles yet; form sharing (Phase 2+) will need a narrow RPC for that.
- A deactivated user's access token stays valid until it expires (≤ 1 h), but the database denies all access and the app signs them out on the next request.
- `tests/e2e/admin-users.spec.ts` creates `e2e-<timestamp>@formpulse.test` users each run. Reset with `pnpm db:reset && pnpm seed`.
- `tests/integration/admin-route.test.ts` (HTTP 403 checks) is skipped when the app is not running at `APP_URL`. Playwright covers the same paths.
- `supabase db push` was verified against a **fresh local database** (`supabase db reset` + `supabase db lint`), not against a hosted project.
- No password reset / email flows (internal users only for now).

### How to run

```bash
nvm use 24                     # Node 22+ required
pnpm install
pnpm db:start                  # local Supabase (Docker)
cp .env.example .env.local     # then paste keys from: pnpm exec supabase status
pnpm db:reset && pnpm seed
pnpm dev                       # http://localhost:3000
pnpm lint && pnpm typecheck && pnpm test && pnpm e2e
```

### Manual verification checklist

- [ ] `http://localhost:3000/` redirects to `/id`, then to `/id/login` when signed out.
- [ ] Log in as `admin@formpulse.test` / `Password123!`: sidebar shows Beranda, Formulir, and the Administrasi section (Pengguna, Alat demo); badge says Admin.
- [ ] Log in as `editor@formpulse.test`: no admin section; "Buat formulir" button visible (disabled, tooltip "coming soon").
- [ ] Log in as `viewer@formpulse.test`: no admin section and no create button.
- [ ] As editor or viewer, open `/id/admin/users`: "Akses ditolak" page, HTTP 403 in DevTools.
- [ ] Wrong password shows "Email atau kata sandi salah." (and the English text on `/en/login`).
- [ ] Language switcher on login, home, forms, admin and `/id/f/test` switches between Bahasa Indonesia and English and keeps the page.
- [ ] Theme toggle switches light/dark/system and survives a reload.
- [ ] Admin > Users: create a user, change their role, deactivate them. Your own row's role select and button are disabled.
- [ ] Deactivated user who is signed in elsewhere is sent to login with "Akun Anda tidak aktif…" on the next navigation, and cannot sign in again.
- [ ] `/id/f/anything` and `/en/d/anything` load without signing in; `POST /api/f/x/submit` returns 501.
- [ ] Studio (`http://127.0.0.1:54323`): every public table shows RLS enabled.

## Phase 2: form definition, form management, builder, publishing

Status: **done** (2026-10-12)

### Plan

1. `src/lib/forms/schema.ts`: the single Zod `formDefinitionSchema` + `validateDefinition()` (semantic checks with i18n problem codes). Pure modules `logic.ts`, `validation.ts`, `operations.ts` (builder mutations), `templates.ts`, `hash.ts`.
2. Migration `<ts>_phase2_forms.sql`: `publish_form` RPC, `list_forms` / `list_form_owners` (aggregated in SQL), `add_form_member` / `list_form_members`, `is_slug_available`, status/version check constraint, guard against direct writes to `current_version_id`.
3. `/forms` list (search, filters, sort, table/cards, actions), "New form" dialog with templates.
4. `/forms/[id]` layout with tabs; builder (palette, canvas with dnd-kit, inspector, logic editor, autosave with optimistic concurrency, undo/redo, preview, validation panel, publish).
5. `FormRenderer` (preview mode) in `src/components/renderer`.
6. `/forms/[id]/settings` (details, slug check, deadline in Asia/Jakarta, sharing, danger zone) + public link box with QR.
7. Dashboard / responses route placeholders (view access only).
8. Tests: unit (schema, logic, answer schema, templates, operations), integration (RLS + publish), Playwright builder flow.

### Assumptions

- Answers are keyed by question `key`. Value shapes: text types → string; number/rating/linear_scale → number; date → `YYYY-MM-DD`; choice types → `{ selected: optionId[], otherText? }` with the reserved option id `__other__`.
- Conditions on a hidden question treat its answer as empty (hidden chains collapse).
- "Blank" template = one section with one short-answer question (a valid minimal form); the other three templates carry the type mix and conditional rules.
- Section and question titles must both be non-empty to publish.
- Restoring an archived form sets status `closed` if it was ever published (never re-opens publicly by surprise), else `draft`.
- Asia/Jakarta has a fixed UTC+7 offset (no DST), so deadline conversion uses that offset.

### What is done

- **Form definition** (`src/lib/forms/schema.ts`): the single Zod schema + inferred types, `validateDefinition()` with i18n problem codes (unique ids/keys, at least 1 question, at least 2 options, non-empty titles, valid ranges/patterns, conditions only reference EARLIER questions, operator/value fit the referenced type).
- **Shared pure modules** (reused by Phase 3 on client and server): `logic.ts` (`evaluateCondition`, `evaluateConditionGroup`, `getVisibleQuestions`, `getVisibleSections`), `validation.ts` (`buildAnswerSchema`, `validateAnswers`), `operations.ts` (builder mutations, `cloneDefinitionWithNewKeys`), `hash.ts`, `templates.ts`, `slug.ts`, `settings.ts`, `list-query.ts`; `src/lib/time.ts` (Asia/Jakarta).
- **Migrations**: `20261013090000_phase2_forms.sql` (`publish_form`, `list_forms`, `list_form_owners`, `list_form_members`, `add_form_member`, `is_slug_available`, published-requires-version check, `current_version_id` write guard), `20261013090100_fix_add_form_member.sql`, `20261013090200_forms_owner_select.sql` (see decisions).
- **/forms**: table and card views, search, status / access (all, mine, shared) / owner filters, sort, server-side pagination (20 per page). Columns: title, status (+ version and "unpublished changes" badges), response count, last response, updated. Actions: builder, dashboard, settings, duplicate (new keys), archive/restore, delete (admin/owner, confirm). Counts come from `list_forms` in SQL.
- **New form dialog**: Blank + 3 templates, localized by the current locale at creation.
- **Builder** (`src/components/builder/`): palette (click or drag); canvas with sections as cards and questions sortable within and across sections (dnd-kit: mouse, touch long-press, keyboard via the drag handle); inspector (title, description, required, type change with a warning when options would be lost, move to section, options editor with drag reorder / paste many / "Other", validation, scale, rating, logic editor with AND/OR rows and type-aware operators and values, stable key display); duplicate / delete (confirm) questions; add / rename / reorder / delete (confirm if not empty) sections; autosave (800 ms debounce, 1 s max wait, Saving / Saved / Error + Retry); optimistic concurrency on `updated_at` with a conflict dialog (load latest / overwrite); localStorage mirror so a reload never loses edits; undo/redo (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y, toolbar); problems panel (click to jump); preview dialog (desktop / phone frame) using the real `FormRenderer`; publish; version and "Unpublished changes" badges; existing-responses banner; public link popover.
- **FormRenderer** (`src/components/renderer/`): one section per page, live conditional logic, per-page validation with `validateAnswers`, all 11 question types, accessible (fieldset/legend, aria-invalid, aria-describedby, focus on the first error). Preview mode only (`TODO(phase-3)` for live submission).
- **Settings** (`/forms/[id]/settings`): title, description, slug (generate from title, live availability check), identifier mode, deadline (datetime-local in WIB, stored as UTC), closed / thank-you messages; sharing (add by email as viewer/editor, change role, remove; read-only for non-owners); publishing card (live version, close / reopen, public link + QR); danger zone (archive/restore, delete).
- **Routes**: `/forms/[id]` layout with role-aware tabs; builder and settings require edit access (403 otherwise); dashboard and responses placeholders require view access; forms the caller cannot see return 404.
- **Home** lists the 5 most recently updated forms.
- **Tests**: 223 Vitest tests (unit: schema, every operator, AND/OR, hidden chains, answer schema for every type, operations, templates in both locales, history reducer, slug, time, status transitions, query parsing; integration: forms / form_members / form_versions RLS, sharing RPCs, publish v1/v2, immutability, stale publish, HTTP 403/404/200 on form routes) and 11 Playwright tests (Phase 1 + builder: template, drag-and-drop, logic, reload, mobile preview, publish v1, edit, publish v2; undo/redo; keyboard reorder; touch reorder; concurrent-editor conflict).

### Decisions

1. **Answer value shapes** are fixed now (see assumptions) so Phase 3 storage maps cleanly: choice answers go to `value_options` (+ `value_text` for "Other").
2. **Pattern validation** uses full-match semantics (`^(?:pattern)$`, Unicode). Input length is capped (500 for short answers) to bound regex cost; patterns come from internal editors only.
3. **`validation.min/max`** are value bounds for `number` and selection-count bounds for `checkboxes`.
4. **Builder state is always structurally valid**: every edit is checked with `formDefinitionSchema` before it is applied, so autosave never stores garbage. Semantic problems (empty titles, broken logic) are allowed in drafts and only block publishing.
5. **Collision detection** is `closestCenter`; non-empty sections are disabled as droppables so questions are always the targets (this made keyboard and touch sorting reliable); empty sections accept drops.
6. **Palette and keyboard**: Enter/Space on a palette item adds the question. Keyboard dragging is for reordering via question drag handles; "Move to section" in the inspector covers cross-section moves without a pointer.
7. **`publish_form(form_id, expected_updated_at)`**: the optional second argument rejects publishing a draft that changed after the server validated it (SQLSTATE 40001). The form row is locked, so concurrent publishes get consecutive version numbers.
8. **`forms.current_version_id` is only writable by `publish_form`** (trigger), and `published` / `closed` require a version (check constraint).
9. **Forms SELECT policy fix** (`20261013090200`): `INSERT ... RETURNING` re-checks the SELECT policy, and `can_view_form()` cannot see a row inserted by the same statement, so creators got an RLS error. The owner is now matched directly on the row (still requiring an active profile). Found by the e2e test.
10. **`add_form_member` fix** (`20261013090100`): PL/pgSQL OUT parameters made `ON CONFLICT (form_id, user_id)` ambiguous (caught by `supabase db lint`). The already-applied migration was not edited; a new migration replaces the function.
11. **Restore** sets `closed` if the form was ever published, else `draft`; it never re-opens a form publicly.
12. **Unpublished changes**: `list_forms` compares `draft_definition` and the current version as jsonb; the builder compares a stable FNV-1a hash of key-sorted JSON, so jsonb key reordering causes no false positives.
13. **Deleting a question** only removes it from the draft. Published versions and `response_answers` (keyed by `question_key`) are untouched, so old answers are kept.
14. QR codes are rendered on the server as SVG with the `qrcode` package.

### Known gaps

- `FormRenderer` has no live submission yet (`TODO(phase-3)`); `/f/[slug]` is still a placeholder.
- Dashboard and responses pages are placeholders (`TODO(phase-4)`).
- `list_forms` counts responses for every visible form before paging (needed for "most responses" sorting). Fine for hundreds of forms; Phase 5 scale tests may need a cached counter.
- Undo history is per tab and not kept across reloads (the draft itself is).
- Sections are reordered with up/down buttons (keyboard accessible), not drag-and-drop.
- Users whose app role is viewer can be shared as "editor" but stay read-only; the sharing UI shows a note instead of blocking it.
- E2E tests leave their forms in the local database (reset with `pnpm db:reset && pnpm seed`).

### Manual verification checklist

- [ ] As editor: Formulir, "Formulir baru": each template creates a form and opens the builder with no problems listed.
- [ ] Drag a type from the palette into a section (mouse); click a palette item to add it after the selected question.
- [ ] Reorder questions by mouse, by keyboard (focus the drag handle, Space, arrows, Space) and on a touch device (long-press the handle).
- [ ] Move a question to another section via the inspector; delete a non-empty section (confirmation shown).
- [ ] Options: add, remove, drag to reorder, paste several lines, toggle "Other". Change a choice question to short answer: a warning is shown.
- [ ] Logic: enable "Show this question only if...", add AND/OR rows; operators change with the referenced type; moving a referenced question below shows a problem.
- [ ] Type in a title and reload within a second: the edit is still there. Save status goes Saving, Saved; stop the local DB to see Error + Retry.
- [ ] Open the same form in two browsers and edit in both: the second gets the "newer draft" dialog.
- [ ] Ctrl+Z / Ctrl+Shift+Z undo and redo.
- [ ] Preview, Ponsel: phone frame; required questions block "Berikutnya"; logic shows/hides questions live.
- [ ] Publish: "v1"; edit: "Perubahan belum diterbitkan" badge; publish again: "v2". The public link popover shows the URL, copy button and QR code.
- [ ] Settings: change the slug (availability check), deadline (WIB), identifier mode; share with viewer@formpulse.test as viewer.
- [ ] As viewer: the form appears under "Dibagikan ke saya" and opens on Dasbor without builder/settings tabs; `/id/forms/<id>/builder` shows 403.
- [ ] Close / reopen, archive / restore, duplicate (new keys, draft), delete (owner/admin only) from the list and from settings.

## Phase 3: public form, drafts, submission pipeline, anti-spam

Status: **done** (2026-10-12)

### Plan

1. Migration `<ts>_phase3_submissions.sql`: `responses.submission_token` (unique), identifier lookup indexes, RPCs `check_rate_limit`, `submit_response`, `save_response_draft`, `delete_response_draft` (all `SECURITY DEFINER`, executable by `service_role` only).
2. Pure modules: `lib/forms/identifier.ts` (email/phone normalization, Indonesian phone rules), `lib/forms/submission.ts` (payload schema, hidden-answer stripping, typed column mapping, device), `lib/forms/drafts.ts` (draft migration across versions), `lib/rate-limit` (IP hashing with `IP_HASH_SALT`, buckets).
3. Route handlers `/api/f/[slug]/submit` and `/api/f/[slug]/draft` (admin client only, validated server-side).
4. Public page `/[locale]/f/[slug]`: admin-client loader returning only the current version (or a closed state), noindex, friendly 404.
5. `PublicForm` client: resume prompt, identifier step, `FormRenderer` live mode (progress bar, honeypot, large touch targets), local + server drafts, submit with retry, thank-you screen.
6. Tests: unit (identifier, stripping, mapping, draft migration), integration (HTTP + RPC), Playwright mobile flow.

### Assumptions

- Submissions are rate limited by a fixed window per bucket (simple, can allow up to 2x at a window boundary).
- The client IP is taken from `x-real-ip`, else the first `x-forwarded-for` entry. The hosting proxy must overwrite these headers (true on Vercel); otherwise rate limits can be bypassed by spoofing them.
- Server drafts store answers, current section and start time only, never the identifier (no PII in drafts).
- Archived forms show the closed page if they were ever published; drafts (never published) are 404.
- Dates are stored in `value_date` as midnight UTC of the chosen day.

### What is done

- **Migration** `20261014090000_phase3_submissions.sql`: `responses.submission_token` (unique, idempotency), identifier lookup indexes, RPCs `check_rate_limit`, `submit_response`, `save_response_draft`, `delete_response_draft`. All `SECURITY DEFINER`, `search_path = ''`, executable by `service_role` only (anon and authenticated have no execute).
- **Public page** `/[locale]/f/[slug]` (no auth, `force-dynamic`, `noindex`): loaded with the admin client through `src/lib/forms/public.ts`, which selects an explicit column list and returns only the current published version (or a closed state with `closed_message`). Drafts (never published) and unknown slugs get a friendly 404 without links into the internal app.
- **Respondent UI** (`src/components/public/public-form.tsx`): resume prompt, identifier step with privacy note, `FormPages` (the Phase 2 renderer, now controlled) with progress bar, Back/Next, live logic, inline validation on Next and Submit, honeypot, 44 px touch targets and 16 px text on phones, "closes soon" banner (< 24 h), thank-you screen ("Submit another response" only for forms without identifier), closed screen, retry on failures. The language switcher changes UI chrome only; form content stays as authored.
- **Identifiers** (`src/lib/forms/identifier.ts`): email trimmed and lowercased; phones reduced to digits with Indonesian rules (`08…` → `628…`, `+62`/`0062` → `62…`, `812…` → `62812…`, `+62 0812…` fixed), valid at 8–15 digits. `identifier_key` = email when given, else phone; for `email_or_phone` the phone is checked for duplicates too.
- **Drafts**: localStorage `fp:draft:<formId>` (version id, answers, section, identifier, step, startedAt, draft/submission tokens) written 500 ms after each change and on tab hide; server copy via `PUT /api/f/[slug]/draft` every ~5 s while changing, on every page change and on tab close (`keepalive`), upserted with `expires_at = now() + 30 days`. Resuming an older version maps answers by `question_key`, drops answers that no longer exist or fit, and tells the respondent. Drafts are deleted after a successful submit (local and server). "Start over" deletes both.
- **Submit pipeline** `POST /api/f/[slug]/submit`, in order: rate limit (salted IP hash + slug: 10 / 10 min; salted IP hash: 60 / 10 min) → 100 KB body limit → payload schema → honeypot (fake success, nothing stored) → minimum 3 s fill time → form exists → idempotent replay by `submission_token` → status published and deadline not passed → version belongs to this form (validated against THAT version) → shared answer validation (hidden questions and unknown keys dropped, 5000-char text cap) → identifier → `submit_response` (one transaction: re-checks status, deadline, version and duplicates under a per-form advisory lock; inserts `responses` + typed `response_answers`; deletes the draft). Errors return a code and a localized message (`ALREADY_SUBMITTED` → 409).
- **Typed columns**: text types → `value_text`; number, rating, linear_scale → `value_number`; date → `value_date` (midnight UTC); multiple_choice / dropdown → `value_options` with one option id; checkboxes → `value_options` with many; "Other" text → `value_text`. Option ids are stored, never labels.
- **Resilience**: answers never leave the device on failure; the submit button is disabled while sending; 30 s client timeout; the retry reuses the same `submission_token`, so a request that actually succeeded is not duplicated.
- **Tests**: 283 Vitest tests (new unit: Indonesian phone formats, email/identifier rules, hidden-question stripping, typed column mapping, draft migration, payload schema, device, IP hashing; new integration over HTTP + DB: happy path with typed columns, idempotent resubmit, duplicate by email, duplicate by phone, invalid identifier, deadline passed, closed form, unknown slug, rate limit trip, honeypot, too fast, oversized payload, field errors, old version after republish, foreign version, draft save/read/scope/delete, no draft data on the public page, anon cannot call the RPCs) and 12 Playwright tests (new: phone viewport: identifier, half the form, reload, resume, finish, submit, blocked second submit with the same email).

### Decisions

1. **Idempotency is checked before the closed/deadline check**, so a retry of a request that succeeded right before the form closed still gets its success.
2. **Duplicates are enforced inside `submit_response`** under `pg_advisory_xact_lock` per form, covering the email/phone cross-check that a unique index alone cannot. The Phase 1 partial unique index on `(form_id, identifier_key)` stays as the last line of defense.
3. **Normalized identifiers are stored** in `identifier_email` / `identifier_phone` (not the raw input), so duplicate checks compare like with like.
4. **Server drafts never contain the identifier** (no PII outside responses). A draft token is bound to one form: saving it through another form's slug is ignored.
5. **Rate limiting** uses fixed windows in `rate_limits` keyed by salted HMACs; it fails open if the RPC itself errors (the submit would fail anyway). Rate limit is applied before the body is read; the per-form bucket uses the slug so no lookup is needed first.
6. **Client IP** comes from `x-real-ip`, else the first `x-forwarded-for` entry. The hosting proxy must overwrite these headers (Vercel does).
7. **Archived forms** that were published show the closed page; never-published drafts are 404.
8. `FormRenderer` was split: `FormPages` is controlled (used by the public form) and `FormRenderer` wraps it with local state for the builder preview.

### Known gaps / limitations

- **Email and phone are not verified.** They prevent accidental double submissions, not a person using two addresses or numbers. Respondents are told this in the privacy note.
- **Resuming on a different device is out of scope** for the MVP: the draft token lives in the browser's localStorage. The server copy is a safety net and future building block (`GET /api/f/[slug]/draft?token=` exists).
- The 3-second minimum and the honeypot stop naive bots only; `startedAt` is client-provided. A CAPTCHA can be added later if abuse appears.
- Expired drafts and old rate-limit windows are purged opportunistically (about 1% of calls), not by a scheduled job.
- Fixed-window rate limits allow up to 2x the limit across a window boundary.
- Duplicate submissions are only detected at submit time (checking at the identifier step would let anyone probe which emails have responded).

### Manual verification checklist

- [ ] Publish a template, set "Respondent identifier" to Email in settings, open the public link in a private window on a phone (or devtools mobile mode): no login needed.
- [ ] Identifier step: empty or invalid email is rejected with a friendly message; the privacy note is shown.
- [ ] Fill page 1, go to page 2, close the tab, reopen the link: "Continue where you left off" restores answers and page. "Start over" clears them.
- [ ] Logic: rating below 3 shows "What should we improve?"; changing it back hides it (and its answer is not stored).
- [ ] Submit: thank-you message is shown. In Supabase Studio (Table Editor) a new row appears in `responses` (with `form_version_id`, `identifier_key`, `device`, `duration_seconds`) and rows in `response_answers` in the typed columns.
- [ ] Submit again with the same email in another case/with spaces: blocked with "already submitted".
- [ ] Phone mode: `0812-3456-7890` and `+62 812 3456 7890` count as the same person.
- [ ] Set a deadline in the past or close the form: the public page shows the closed message; set a deadline within 24 h: the "closes" banner appears.
- [ ] Turn off the network (devtools offline) and submit: the error with "Try again" appears and answers stay; reconnect and retry succeeds once.
- [ ] Switch the language on the public page: buttons and messages change, questions stay as written.
- [ ] Republish the form while a respondent has an older draft: on resume they see the "form was updated" notice.

## Phase 4: dynamic dashboard, live updates, customization, filters, responses

Status: **done** (2026-10-13)

### Plan

(The plan was not written into this file at the start of the phase, as the working agreement asks; it is recorded here together with the outcome.)

1. Demo data: SQL generator `generate_demo_responses(form_id, n, days)` + `pnpm seed:demo`.
2. Data layer in Postgres: filtered response set, per-question statistics, overview, cross statistics, suggestions, one-call bundle, responses listing; all access-checked.
3. Pure TypeScript: auto-dashboard rules, config schema, merge strategy, filters (URL), insight templates, stats helpers.
4. UI: widget cards with context, charts (Recharts), grid (react-grid-layout), live updates (Realtime + TanStack Query), edit mode, filters, responses tab, presentation mode.
5. Tests: unit, RPC integration with hand-computed values, Playwright two-context live test.

### Assumptions

- All times are shown in Asia/Jakarta (WIB). "Today", "last 7 days" and the date presets are WIB calendar days.
- Completion funnel: drafts are deleted on submit, so `started = submitted + open drafts` (abandoned starts) in the date range. Drafts only exist once a respondent changed something (first server sync), so the rate is an upper bound.
- Answer filters use "any of" semantics (OR inside one filter, AND between filters); numeric answers match by their exact value.
- Cross-question suggestions use questions of the current version only.

### What is done

- **Demo data**: `pnpm seed:demo [--n N --days D]` creates "Customer Satisfaction Survey (Demo)" (template + waiting-time and age questions), publishes it, shares it with the dummy viewer and calls `generate_demo_responses` (set-based, `is_demo = true`, abandoned drafts for the funnel). Correlations: a latent satisfaction score drives ratings / NPS / most choices; the first number question (waiting time) falls as satisfaction rises (r ≈ −0.9 with NPS); the second (age) rises with the acquisition channel. Conditional questions are only answered when visible. 300 responses take 0.3 s, 10 000 take 8 s.
- **RPCs** (all `SECURITY DEFINER` with an explicit access check, see Decisions): `dashboard_bundle`, `dashboard_overview`, `question_stats`, `cross_stats`, `cross_suggestions`, `question_text_answers` (keyset), `list_responses` (keyset, search, sort, masking), `get_response`. Every statistic carries `n` and `low_sample` (n < 30).
- **Overview**: total, today, last 7 vs previous 7 WIB days, previous period of the same length (compare toggle), timeline with automatic hour/day/week buckets, weekday × hour heatmap, mean/median duration, device and language split, completion funnel, counts per version, first/last response.
- **Question stats**: choice counts + Other; checkboxes counts, % of respondents, average selections, top 5 pairs; rating/scale distribution, mean, median, stddev, NPS (0–10), CSAT (max 5); number min/max/mean/median/p25/p75/p90/stddev + Sturges histogram; date series (auto granularity) + weekday distribution; text n, average length, top 15 terms (en + id stop words, min 3 chars).
- **Cross stats**: contingency table + χ² + Cramér's V; group means for categorical × numeric; Pearson r for numeric × numeric only with n ≥ 30.
- **Auto dashboard** (`src/lib/analytics/auto.ts`): default chart per type with allowed alternatives, overview block, possible-relationships block (max 4, Cramér's V ≥ 0.2, standardized mean difference ≥ 0.5, |r| ≥ 0.3, n ≥ 30, labeled "Possible relationship, not proof of causation"), 12-column layout grouped under section headings.
- **Widget context**: title, type + "n of N answered (rate)", chart / data-table toggle, key insight from i18n templates with real numbers, "How to read this chart" popover, badges (low sample, required/optional, "Only shown when …", "Only in versions …", "Question removed (historical data)"), PNG download (html-to-image). Header with editable title/description and an "About this data" panel (description, versions, period, total, creator, demo note).
- **Live updates**: Realtime `postgres_changes` INSERT (filtered by form) and DELETE; instant counter bump in the query cache, "last response X ago" ticker, debounced refetch (1.5 s trailing, 5 s max wait), Live / Reconnecting / Paused badge, pause with "N new responses, apply" pill, 10 s polling fallback while the channel is down, highlight of widgets whose numbers changed, quiet refetch for responses outside the date range. Measured locally: counter 0.3–1.8 s, charts 2.4–4.5 s after submit.
- **Customization** (editors only): edit mode with drag (grip) and resize, widget menu (hide/show, rename, context note, chart type, palette, size, remove user widgets), add widget (question chart, cross-tab, text/heading, KPI: count / average / NPS), reset to auto (confirm), debounced persistence to `dashboards.config` (`configVersion: 1`) with Saving/Saved/Error. Viewers get no edit controls but can filter.
- **Merge on publish** (`src/lib/analytics/merge.ts`): widgets keyed by question key; never-seen questions get auto widgets under a "New questions" heading at the bottom; removed questions keep their widgets; user changes are never overwritten.
- **Filters** (URL state): date presets (all, today, 7d, 30d) and custom range, version, answer filters (multiple), device, language, compare toggle, chips, clear all; drill-down by clicking bars, slices and legend rows.
- **Responses tab**: keyset-paginated, virtualized table (infinite scroll), text search, sort (newest, oldest, duration), column visibility, same filter bar, drawer with the full response, delete for owner/admin (confirm). Identifiers are full for editors and masked for viewers (`a***@example.com`, `***789`).
- **Presentation mode**: full screen, larger type, periodic refresh, light/dark via the theme toggle.
- **Tests**: 321 Vitest tests (new unit: auto mapping for every type, insights in en and id, NPS / median / quantiles / trend, filter serialization and Jakarta windows, merge strategy; new integration: every RPC against a 6-response fixture with hand-computed values, filters, previous period, keyset pagination, masking, access denied for an unshared viewer, column privileges, demo generator restricted to the secret key) and 14 Playwright tests (new: live update across two browser contexts, responses tab with delete, customization surviving reload, viewer without edit controls, republish adding a "New questions" widget).

### Decisions

1. **SECURITY DEFINER + explicit check** for analytics RPCs. With `SECURITY INVOKER`, RLS would evaluate `can_view_form()` for every answer row (≈100k at 10k responses). One check at the top (`_assert_can_view`) is faster and auditable. Signed-in callers need `can_view_form`; the secret key (no `auth.uid()`) is allowed so the Phase 5 public dashboard can reuse the same functions after validating a share token. `anon` has no EXECUTE.
2. **Identifier columns are no longer selectable by `authenticated`** (column privileges). Editors get identifiers through `list_responses` / `get_response`; viewers get them masked. Realtime respects the column grants (payloads omit identifiers).
3. **Set-based statistics.** The first implementation computed stats question by question over an id array and took 11–30 s per bundle at 10k responses (nested loops, worse with PL/pgSQL generic plans). The final version reads the filtered answers once per call, computes counts / averages / quantiles in one aggregate pass and the rest in a few typed passes, with `work_mem = 32MB` for the call (see architecture.md for numbers). Top terms use at most 2,000 answers per question (deterministic sample, reported as `terms_based_on`).
4. **Applied migrations were never edited.** Each fix is its own migration: `20261015090100` (no temp tables), `20261016090000` (calendar-day KPIs, timeline end), `20261016100000` / `110000` / `120000` (performance), `20261016100100` (numeric cast).
5. **Recharts animations are production-only.** Recharts 3.10 never starts its entry animation under React StrictMode double mounting (dev only), leaving marks invisible. Charts animate in production builds (verified) and render without animation in development.
6. **Realtime joins with the user's JWT**: the browser client loads the cookie session and calls `realtime.setAuth()` before subscribing; otherwise the channel joins as anon and RLS drops every event.
7. Chart colors use the dataviz reference palette (validated with the six-checks script against white and `#171717` cards): categorical slots in fixed order, a blue sequential ramp for scores and the heatmap, status colors only for trend arrows with an icon. Three light slots are below 3:1 contrast, so every chart has value labels and a data-table view.
8. Widget sizes are fixed grid units; content taller than its box is clipped until an editor resizes it. On screens below 768 px widgets stack in one column.

### Known gaps

- `dashboard_bundle` takes ~390–410 ms locally (Docker Desktop on Windows) at 10k responses / 107k answers without filters, 0.2–0.8 s with filters (answer filters are the slowest). The p95 < 400 ms target is to be verified on production-like hardware in Phase 5; next step if needed is pre-aggregated per-question tables maintained by a trigger.
- `cross_suggestions` takes ~0.9 s at 10k responses; it is cached for 5 minutes and re-ranked only when the dataset grows by ~10%.
- Responses that are deleted trigger a refetch for every open dashboard (DELETE events cannot be filtered by form).
- Drill-down works on choice, rating/scale and split widgets; histogram bars (ranges) and dates are not filterable yet.
- Presentation mode relies on the browser Fullscreen API; without it the dashboard still switches to the large layout.
- The Playwright suite uses 2 workers locally: more parallel browsers overload the on-demand dev server.

### Manual verification checklist

- [ ] `pnpm seed:demo`, then sign in as editor@formpulse.test and open the demo form's Dashboard: KPI cards, timeline, heatmap, devices, languages, possible relationships, then one widget per question (not for the email/phone questions), each with an insight sentence and badges.
- [ ] Check numbers against SQL in Studio, e.g. `select round(avg(value_number),2) from response_answers where question_key = '<rating key>'` equals the rating widget's average.
- [ ] Open the public form in another window and submit: the total updates within ~2 s, the charts within ~5 s, the changed widgets flash; "Last response … ago" resets.
- [ ] Pause live updates, submit again: "1 new response, apply" appears; applying refreshes.
- [ ] Filters: 7 days, a version, "Filter by answer", device, language; chips appear and the URL changes; copy the URL into another tab and get the same view. Click a donut slice / bar to add a filter.
- [ ] Edit dashboard: drag and resize widgets, rename one, hide one, add a note, switch a chart type, add a cross-tab and a KPI card. Reload: everything stays. Reset to auto restores the default.
- [ ] Sign in as viewer@formpulse.test (shared on the demo form): dashboard without Edit, responses with masked identifiers, no delete button.
- [ ] Add a question in the builder and publish: the dashboard shows it under "New questions" and customized widgets are unchanged.
- [ ] Responses tab: search "queue", sort by duration, hide columns, open a row, delete it as the owner.
- [ ] Present mode: full screen, larger type, live updates keep working; toggle dark mode.
- [ ] Download a widget as PNG.

## Phase 5: export, public dashboard link, scale demo, hardening, deployment

Status: **done** (2026-10-13)

### Plan (written at phase start)

1. Measure the current RPCs at 1k / 10k / 50k / 100k responses first; if `dashboard_bundle` misses p95 < 400 ms at 10k or < 1 s at 100k, apply the cheapest fix (indexes, narrower queries, then a trigger-maintained summary table) and re-measure. Results go to `docs/scale-report.md`.
2. Migration `…_phase5.sql`: `export_responses` (keyset batches, identifiers only with edit rights), demo helpers (live simulator batch, demo-form filter for `list_forms`), anything the benchmark requires.
3. Export: `/api/forms/[id]/export?format=csv|xlsx` + the dashboard filters. CSV (UTF-8 BOM, RFC 4180) and XLSX (exceljs streaming writer, `Responses` + `Summary`) are written from keyset batches of 1000 rows straight into the HTTP stream; formula-injection guard. Unit test for 100k rows with bounded memory.
4. Public dashboard: share dialog (create, activate/deactivate, expiry, include text answers, regenerate, revoke, list), `/[locale]/d/[token]` page and `/api/d/[token]/stats` (admin client, form fixed by the token, whitelisted RPCs, date range only, no identifiers, text answers stripped unless allowed, rate limited, `noindex`, 10 s polling). The dashboard components get a pluggable data source so the same widgets run against Supabase (app), the share API (public) and a timed API (scale page).
5. Print stylesheet + "Print / Save as PDF" button.
6. `/[locale]/admin/demo/scale` (admin + `ENABLE_DEMO_TOOLS=true`): ensure a demo form, generate presets in chunks with progress, clear, live simulator (browser calls a server action every second), dashboard preview with a performance panel. Demo forms hidden from the forms list unless "Show demo forms". Live UI updates batched to ≤ 4 renders per second.
7. Hardening: loading skeletons, empty states, error boundaries, toasts; axe checks (login, builder, public form, dashboard) and 360 px; security headers; client-bundle secret scan; RLS tests for new objects; `ENABLE_DEMO_TOOLS=false` by default.
8. One Playwright journey across roles, public link and CSV export.
9. Docs: README (setup, env table, scripts, Vercel `sin1`, post-deploy checklist), `docs/supabase-setup.md` rewritten against the real migrations, progress + architecture.

### Assumptions

- "Summary" sheet = per-question counts from the same aggregation as the dashboard (`dashboard_bundle`), so export and dashboard never disagree.
- Exports use the latest question title per key (removed questions included at the end) and the dashboard filters from the URL; dates in the CSV are ISO (UTC) plus a separate Asia/Jakarta column.
- Public dashboards use the saved dashboard layout (hidden widgets stay hidden) and show only the date-range filter; drill-down is disabled.
- The scale page owns one demo form (`demo-scale-test`, owned by the admin who creates it); generation runs in chunks of 500 driven by the browser so each server call stays far below the 8 s API statement timeout and progress is real.

### What is done

- **Scale (summaries)**: migration `20261017090000_phase5_scale_export.sql` adds `response_summary` (hourly) and `answer_summary` (daily, per value) maintained by statement-level triggers; dashboard functions read them whenever the filters allow (no filter, date ranges on day / hour boundaries, versions, device, language) and fall back to the raw tables for answer filters. Integration tests prove both paths return identical JSON and that the incremental summary equals a full rebuild after inserts and deletes. `cross_suggestions` uses the latest 5,000 responses; answer filters, `list_responses` and the demo generator were rewritten for linear cost. Results: `docs/scale-report.md` (dashboard_bundle p95 98 ms at 10k and 227 ms at 100k through the API; targets < 400 ms / < 1 s met).
- **Export**: `GET /api/forms/[id]/export?format=csv|xlsx` with the dashboard / responses filters (Export menu on both tabs). Keyset batches of 1,000 rows streamed straight to the client; CSV with UTF-8 BOM, RFC 4180, CRLF; XLSX through the exceljs streaming writer with `Responses` and `Summary` sheets (backpressure added on top of exceljs). Columns: response id, submitted at (UTC ISO 8601 and Asia/Jakarta), version, identifiers (editors only), one column per question (latest title, short key on collisions), option labels, checkboxes joined with `; `. Formula-injection guard. Unit test streams 100k rows through both writers with bounded memory and no fetch-ahead.
- **Public dashboard links**: Share dialog (editors / admins): create with optional "valid until" date and "include free-text answers" (off by default), list, activate / deactivate, change expiry, regenerate (new token, old URL dies), revoke. `/[locale]/d/[token]`: read-only, no login, 10 s polling, date filter only, no drill-down, `noindex`, saved layout. `/api/d/[token]/stats`: token resolved server-side, admin client scoped to that form, whitelisted calls, rate limited (600 / 10 min per IP and token), no identifiers, text content stripped unless allowed, no creator name.
- **Print / Save as PDF**: button on every dashboard; static two-column layout at A4-landscape width, light theme, widgets never split across pages, app shell / filters / widget buttons hidden.
- **Scale demo page** `/[locale]/admin/demo/scale` (admin + `ENABLE_DEMO_TOOLS=true`, re-checked by every action): DEMO DATA banner, "Scale test (Demo)" form (`is_demo`), presets 1k / 10k / 50k / 100k over 7 / 30 / 90 days generated in the database in browser-driven chunks with progress, elapsed time and cancel; clear (demo rows only, chunks of 20,000); live simulator 1 / 5 / 20 responses per second (one server action per second; closing the tab stops it); the real dashboard next to a Performance panel (per-RPC server time, round trip, payload, p50 / p95 of the last 20 calls, total, render time, green / amber / red against the targets). Demo forms hidden from the forms list unless "Show demo forms".
- **Live batching**: Realtime inserts are applied at most every 250 ms (≤ 4 counter renders per second); charts refetch after 1.5 s quiet, at most every 5 s.
- **Hardening**: route loading skeletons (dashboard, responses, scale page, shared dashboard), error boundaries (app shell, public pages, global), translated toasts for every new action; axe (WCAG 2.1 A/AA) clean on login, builder, public form and dashboard, no horizontal scrolling at 360 px; security headers; `pnpm check:secrets`; viewers can no longer read raw answers (email / phone answers masked in every RPC).
- **Tests**: Vitest 349 tests (19 files; new: export format / streams incl. 100k rows, scale integration suite: summary == raw, summary == rebuild after inserts / deletes, export keyset + masking, viewer answer privacy, share-link RLS, demo filtering and privileges); Playwright 21 tests, all passing in 4.1 min (new: cross-role journey with mobile respondent, live dashboard, viewer, public link with polling and revoke, CSV / XLSX export; accessibility + 360 px + print; scale page).
- **Docs**: README (setup, env table, scripts, Vercel `sin1` deploy, post-deploy checklist), `docs/supabase-setup.md` (rewritten step by step against the real migrations and commands), `docs/scale-report.md`, architecture (summaries, export, public links, data sources, demo tools, headers).

### Decisions

1. **Summary tables maintained by triggers** (the spec's last-resort option) after the cheaper ones were tried and measured: indexes could not help (the default dashboard reads every answer), narrower queries got 10k to ~400 ms but 100k stayed at ~5 s. Statement-level triggers with transition tables keep submissions cheap (one indexed lookup per answer) and a per-form advisory lock prevents deadlocks. Deletes rebuild the touched Jakarta days because the cascaded answers are gone by the time a statement trigger runs.
2. **Day / hour grain** so every date preset (WIB calendar days) and custom range is served from the summaries; device and language are part of the key (drill-down on them stays fast). Answer filters (drill-down on a chart) use the raw path, rewritten set-based.
3. **Exactness over approximation**: medians, quantiles and standard deviations are computed from value counts with the same formulas Postgres uses; the integration test compares the JSON of both paths. Only `cross_suggestions` (a hint) samples the latest 5,000 responses.
4. **Viewers lose direct table access to `response_answers`** (security review): identifiers were masked in Phase 4, but email / phone _answers_ were readable by viewers through the table and the RPCs. All reads now go through RPCs that mask them; the RLS policies stay as a second layer.
5. **Pluggable data source** for `DashboardView` instead of a second public dashboard: the same widgets render app, public and scale-page dashboards (Supabase / share API / timed demo API).
6. **Browser-driven demo jobs**: PostgREST stops statements after 8 s and serverless functions are short-lived, so generation (500 per call), cleanup (20,000 per call) and the simulator are short calls driven by the page.
7. **Share tokens generated in Node** (32 random bytes, base64url) and stored through RLS as the signed-in user; the admin client is used only after a token resolved to an active share.
8. **Public forms stay embeddable** (no frame protection on `/{locale}/f/...`); all other pages send `X-Frame-Options: DENY` + `frame-ancestors 'none'`.
9. **Loading skeletons only below access checks**: a `loading.tsx` above a layout or page that calls `forbidden()` / `notFound()` makes Next stream the response, which then keeps HTTP 200 (caught by the HTTP route tests). Skeletons live under `forms/[id]` (whose layout checks access) and on the scale / shared-dashboard pages; the forms list, builder and admin pages render without one.
10. **Migration editing during the phase**: `20261017090000_phase5_scale_export.sql` was iterated locally (applied via psql for measurements) before it was ever applied through the migration tooling, then verified with a full `supabase db reset` + `db lint`. Applied migrations from earlier phases were not touched.

### Known gaps

- Measured on Docker Desktop / Windows; repeat `pnpm bench:dashboard` on staging (hosted Supabase in Singapore) before launch.
- Answer-filtered dashboards (drill-down) and `cross_stats` read raw rows: p95 2.0 s (answer filter) and 1.6 s (`cross_stats`) at 100k.
- The demo generator gets slower as the tables grow (bulk trigger joins scan `responses`): ~2.6 ms per response at 50–100k (100k ≈ 4–5 minutes from the scale page). Real submissions are single rows and use the primary-key index.
- Summaries assume responses are immutable; changing `submitted_at`, version, device or language with the secret key requires `rebuild_dashboard_summary(form_id)`.
- The XLSX backpressure relies on exceljs 4.4.0 internals (`zip.pointer()`, stream pipes); the version is pinned and covered by a unit test.
- Bulk demo generation produces Realtime INSERT events for every row; other open dashboards of the demo form receive them (the scale page switches its own preview to polling during jobs).
- Printing via the browser menu (Ctrl+P) instead of the button keeps the screen grid, which may split widgets; the button is the supported path.
- `pnpm e2e` uses 2 workers locally; the journey test takes ~1.5 minutes.

### Manual verification checklist

- [ ] `pnpm db:reset && pnpm seed && pnpm seed:demo`, `pnpm dev`.
- [ ] Editor > demo form > Dashboard: Export > CSV and Excel; open both in Excel. Indonesian text intact, one row per response, option labels, `Summary` sheet counts match the dashboard. Apply "Last 7 days" and export again: fewer rows.
- [ ] Viewer (shared on the demo form): export has no identifier columns and masked email answers; Responses tab shows masked emails; there is no Share button.
- [ ] Share > Create link (valid until tomorrow, free text off) > open it in a private window: no login, "Auto-refresh every 10 s", only the date filter, text widgets say free-text is hidden, no identifiers. Submit the public form: the shared dashboard updates within ~10 s. Turn on "Include free-text answers": latest answers appear. Deactivate, Regenerate (old URL dies), Revoke: the page says the link is not available.
- [ ] Print / Save as PDF: two columns, no buttons, no widget cut in half; dark mode prints light.
- [ ] Admin > Demo tools (with `ENABLE_DEMO_TOOLS=true`): banner; Create demo form; Generate 10,000 over 30 days (progress, duration); total 10,000; performance panel green for `dashboard_bundle`; simulator 20/s: counter moves smoothly, charts refresh every few seconds; Stop; Clear demo data: total 0.
- [ ] Forms list hides demo forms; "Show demo forms" shows them with a Demo badge.
- [ ] Set `ENABLE_DEMO_TOOLS=false`, restart: the demo page says tools are off and its actions return "not allowed".
- [ ] `pnpm build && pnpm check:secrets` passes; `curl -I http://localhost:3000/id/login` shows the security headers; `/id/f/<slug>` has no `X-Frame-Options`.
- [ ] 360 px wide (DevTools): login, public form, forms list, dashboard without horizontal scrolling.

### Follow-up (2026-10-13): branding and theme script warning

- Product name is now **Sharing Vision Form App** (`metadata.title`, `common.appName`, login title, admin subtitle; `common.productName` = "Form App" under the wordmark). Code name, package name and dummy accounts stay `formpulse`.
- Brand: `public/sharing-vision.svg` wordmark (`src/components/brand.tsx`) in the sidebar, mobile header and menu, login card and public pages (forms, shared dashboards). Brand colours taken from the logo: red `#CF2A22`, orange `#F7A350`.
- New icons (Next.js file conventions, all derived from one vector "sv." monogram): `src/app/icon.svg`, `src/app/favicon.ico` (16/32/48), `src/app/apple-icon.png` (180, full bleed), `src/app/opengraph-image.png` (1200x630, + alt text) with `metadataBase` from `NEXT_PUBLIC_SITE_URL`.
- Fixed the dev console error "Encountered a script tag while rendering React component" when switching language: switching remounts the `[locale]` layout, so next-themes rendered its inline script on the client. On the client the script is now an inert `application/json` block (it only has to run from the server HTML; next-themes already suppresses the hydration attribute difference). `navigation.spec.ts` now switches id -> en -> id and fails on any console error. Taofik

### Follow-up (2026-10-16): builder editing in place, radio vs searchable dropdown, placeholders

- **Edit on the card**: the selected question card is an inline editor (title, description, placeholder, options with radio / checkbox markers, "Other", required). After adding a question (palette click or drag), its title is focused and selected, so typing replaces "Untitled question". The right panel is now **Advanced settings** only: type, section, scale / stars, validation, logic, key. Unselected cards show a small, inert preview of the field (placeholder, radio circles, checkboxes, dropdown, stars, scale).
- **Few options = radio, many = searchable dropdown**: single-choice cards have a "Show options as: Radio buttons / Dropdown with search" switch (changes the question type between `multiple_choice` and `dropdown`; answers, analytics and logic are identical) with a hint above 5 options. Respondents get a searchable dropdown (`src/components/combobox.tsx`, cmdk; plain "contains" match on the label). In the builder, short fixed lists are radio buttons (and / or, logic operators, star count, scale ends) and long lists are searchable dropdowns (question type, section, logic question and value; search appears above 7 entries).
- **Placeholder**: new optional `placeholder` (max 200) in the form schema for short answer, paragraph, email, phone, number and dropdown. Empty = "Jawaban Anda" / "Your answer" (dropdown: "Pilih" / "Choose"). Changing to a type without placeholders drops it. Existing definitions stay valid (optional field, published versions untouched).
- Tests: schema / operations unit tests for the placeholder; `builder.spec.ts` updated for in-place editing and radio operators, plus a new test (focus after adding, placeholder, dropdown suggestion and switch, typing to filter the respondent dropdown). `public-form.spec.ts` waits for the 3 s anti-spam window after the reload (a production build is fast enough to trip it).

## Chart builder (Superset / Looker style custom charts)

Status: **done** (2026-10-16)

### Plan (written at start)

1. **Spec** (`src/lib/analytics/chart-spec.ts`, Zod): chart type, dimensions (question or metadata field, with time grain or numeric bins), metrics (count, % of responses, average, median, min, max, sum, NPS, CSAT), per-chart filters, sort, top-N, display options. One schema shared by the builder, the widget renderer and the server checks.
2. **Query RPC** (`dashboard_query(form_id, spec, filters)`, new migration): `SECURITY DEFINER`, `search_path = ''`, `_assert_can_view`, global dashboard filters + chart filters, aggregation in Postgres, bounded output (≤ 500 rows, pivot ≤ 100 × 50, scatter ≤ 2,000 points). Dynamic SQL built only from fixed fragments; every user value (question keys, filter values) is a bound parameter. Email / phone answers are never chart columns.
3. **Widget kind `custom`** in the dashboard config (additive, configVersion stays 1).
4. **Builder UI** (full screen, editors / admins): columns panel (questions + metadata, search, drag or click), chart gallery (KPI, bar, column, line, area, donut, table, pivot, heatmap, scatter, histogram; stacked option), slots per chart, settings per slot (aggregation, grain, bins, label), filters, sort / limit, display options, live preview. Opens from "Add widget" and from a widget's menu (existing question widgets can be opened in the builder).
5. **Rendering**: new chart pieces (multi-series bar / line / area, pivot, KPI, scatter) following the dataviz palette rules; public dashboards run only charts saved in the dashboard config (never a spec from the request).
6. **Tests**: spec unit tests, RPC integration tests with hand-computed values and access checks, Playwright flow (build, save, reload, viewer read-only).

### What is done

- **Spec** `src/lib/analytics/chart-spec.ts`: one Zod schema (`chartSpecSchema`) for chart type, up to 2 dimensions (question or response metadata: submitted at, device, language, form version, time to complete; time grain hour / day / week / month / weekday / hour of day; numeric ranges), up to 5 metrics (response count, % of responses, average, median, min, max, sum, NPS, CSAT), up to 10 chart filters, sort, limit and display options. Pure helpers drive the UI: `CHART_SHAPES` / `slotsFor` (which slots a chart has), `slotAccepts`, `placeField` (drop), `autoPlace` (click), `changeChart` (switch type, keeping what fits), `specProblems` (what is missing), `cleanSpec` (filters without a value are skipped), `specFromQuestion`.
- **Query RPC** `dashboard_query(form_id, spec, filters)` (`20261018090000_chart_builder_query.sql`, tuned in `20261018100000_chart_builder_query_perf.sql`): SECURITY DEFINER, `search_path = ''`, `_assert_can_view`, dashboard filters + chart filters, aggregation in Postgres. Output is bounded (≤ 500 groups; two dimensions: top 100 × 50 most frequent; scatter ≤ 2,000 points). Every reference is re-validated against the form (`_chart_field_type`); email / phone answers are rejected (22023). SQL text comes only from fixed fragments; question keys, filter values and filters are bound parameters.
- **Results** `src/lib/analytics/chart-result.ts`: query result → chart model (KPI, single series, multi series, matrix, table, scatter) + accessible data table, with option / device / language / version / weekday / period / range labels, "(no answer)", number formats by aggregation, empty histogram ranges, stable series order (form option order), top 8 series for the colour slots (the rest stays in the table).
- **Charts** `src/components/charts/custom-charts.tsx`: grouped / stacked bars and columns, multi-line and (stacked) area with a legend for ≥ 2 series, pivot and heatmap matrices (values always printed), scatter with correlation, big-number KPI. `BarChart` gained `showValues`; axes allow decimals for averages; long category labels no longer overlap.
- **Widget** kind `custom` (`CustomChartWidget`): title (custom or generated, e.g. "Average X by Y"), "From N responses", badges (chart filters, "showing 20 of 35 groups", hidden colour groups), key insight (highest group, correlation), table toggle, PNG download, drill-down on single-dimension choice charts, edit button for editors.
- **Builder** (`chart-builder.tsx`, `chart-builder-panels.tsx`): full-screen dialog for editors / admins. Columns panel (search; questions, response info, removed questions; drag with dnd-kit, click to auto-place, "+" menu to pick the slot). Chart gallery (11 types with a one-line hint). Slots named per chart (Group by / Break down by (colour) / Value; Rows / Columns; Slices; X / Y), each droppable with highlight for compatible columns and a "+ Add" picker. Chip settings: calculation (with a hint per aggregation), "of column", time grain, ranges, custom label. Chart filters (any of / none of / greater / less / after / before / answered / not answered, with option checkboxes). Sort & limit. Display tab: palette, number format, stack, values, legend, include unanswered, note. Live preview (debounced 300 ms, aggregated in Postgres) with "what is missing" guidance, quick-start ideas for an empty chart, and the data rows. Discard confirmation, Esc-safe. On phones: Columns / Setup / Preview tabs.
- **Entry points**: "Build chart" in the dashboard header (editors, no need to enter edit mode); pencil on a custom chart; widget menu "Edit chart" / "Open in chart builder" (question charts open as a new chart).
- **Public links**: `/api/d/{token}/stats?fn=chart&widget={id}` runs only a non-hidden custom chart saved in the dashboard config (never a spec from the request); text columns follow the share's free-text setting (403 otherwise).
- **i18n**: all builder strings in `messages/en.json` / `id.json` (`chartBuilder.*`).
- **Tests**: unit `tests/unit/chart-builder.test.ts` (placement, auto-place, chart switching, problems, cleaning, schema round trip, labels, formats, models); integration `tests/integration/chart-query.test.ts` (17: hand-computed counts, averages, checkbox percentages, grains, ranges, sort, table metrics, filters, breakdown, pivot, scatter r, safety 22023, injection, access 42501, public share API 200 / 404 / 403 / 400); e2e `tests/e2e/chart-builder.spec.ts` (click + drag columns, change calculation to NPS, preview, save, reload, table, edit to KPI, open a question chart in the builder, viewer read-only) and axe on the open builder (`a11y.spec.ts`).
- Results: lint (0 errors, 2 existing warnings), typecheck, Vitest 387 / 387, Playwright 23 / 23 (after `pnpm seed:demo`), `supabase db lint` clean, `supabase db reset` applies all migrations.

### Decisions

- Builder access: editors and admins (`canEdit`); viewers and public links only see saved charts.
- Custom charts are additive widgets (`kind: "custom"`, `configVersion` stays 1); old configs stay valid. "Open in chart builder" on a question chart creates a new chart and leaves the original (hide it if not needed).
- One RPC for every chart type; the browser never sends SQL or column names, only the spec, and the server re-validates it.
- Counts are response counts. A checkbox dimension counts each response once per selected option, so groups can add up to more than the total (as in the auto charts).
- Time is grouped in WIB (Asia/Jakarta) for submission time, UTC for date answers (no time of day). A time axis defaults to up to 500 points; other dimensions to the top 20.
- Numeric questions of type "number" and time-to-complete default to 10 equal ranges; ratings and scales use exact values.
- Performance at 100k responses (local, median of 5): 180–440 ms per chart (KPI 180, one dimension 215, per-day average 350, two dimensions 420, five-metric table with filter 425, histogram 435). Hash joins (`enable_nestloop = off` on the function) and `count(*)` instead of `count(distinct)` took them from 0.5–1.5 s.

### Known gaps

- No calculated fields, custom SQL, joins across forms, or dual axes (by design).
- Free-text dimensions group exact answers (no word extraction); long-tail text is cut by the limit.
- Two dimensions show the top 100 × 50; larger cross tables are summarized.
- Keyboard users place columns with the "+" menu or click (no keyboard drag).
- Histogram ranges are equal width between the observed min and max (edges may be fractional).

### Manual verification checklist

- [ ] As editor, open a dashboard → **Build chart** → quick-start "Responses per day" shows a line.
- [ ] Pick **Column**, drag a choice question to _Group by_ and a checkbox question to _Break down by_; toggle **Stack groups**; legend shows each option.
- [ ] Drag a rating to _Value_ → "Average"; change calculation to Median / CSAT; set a custom label.
- [ ] Add a chart filter (e.g. Device is any of Mobile); badge "1 chart filter" appears on the saved widget.
- [ ] Switch to Heatmap / Pivot / Table / Scatter / Histogram / KPI; the preview updates and "what is missing" explains empty slots.
- [ ] Save → widget appears at the bottom; reload → still there; pencil → edit → save changes.
- [ ] Dashboard date / answer filters change the custom chart too.
- [ ] Viewer: sees the chart, no Build chart / pencil.
- [ ] Public link: the chart renders; a chart on a free-text column shows "hidden" unless text answers are allowed.
- [ ] Phone width: Columns / Setup / Preview tabs work; dark mode and Indonesian labels look right.
