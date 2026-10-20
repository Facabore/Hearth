# M6a Web Shell, Auth, i18n, Personal Ledger and Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Hearth's first web UI (milestone M6a): a visitor signs up or signs in and lands in an app shell with a space switcher and a user menu (HU-E9-01, #69); every text is in Spanish by default and in English, while numbers, dates and times follow the person's preferences and never the language (HU-E9-02, #70); a person records expenses, income and transfers with a time and an optional subcategory, reads the period's transactions by day and time with totals and a category filter, and reads their accounts by type with balances, card figures and the Available and Net worth totals, creating, archiving and restoring accounts (HU-E9-03, #71); and a Settings screen changes formats, time zone, theme and language with a live preview (HU-E9-13, #111). Follow-up #125 (one style vocabulary for accounts and categories) is resolved first, so the account screens are built once on the final contract.

**Architecture:** A route group `src/app/(web)` holds the pages; there is no URL locale prefix (ruling P120). **The UI talks only to `/api/v1`, through a client generated from `openapi/openapi.snapshot.json`** (`openapi-typescript` types + `openapi-fetch`, ruling P117): Server Components read over loopback HTTP (`INTERNAL_API_ORIGIN`, default `http://127.0.0.1:$PORT`) forwarding the request's cookie, and every write runs in the browser against the same endpoints; there are no server actions, so a future PWA or Capacitor shell reuses the same calls. Dependency-cruiser enforces it: UI code never imports a module's `domain`, `application`, `infrastructure` or `contracts`, nor `src/composition` (ruling P119). Each module gets a `ui/` folder with containers (data loading, state, calls) over presentational components (DTOs and props only); shared atoms and molecules, the formatters, the API client and the theme live in `src/shared/ui/`. `next-intl` 4.14.9 picks `es` or `en` texts from the signed-in user's stored locale, a visitor cookie or `Accept-Language`; a shared `formatters` module renders every amount, date and time from the effective preferences of `GET /api/v1/me`. Three small API changes come first: accounts take the categories' palette and symbol names (Task 1, migration `0019`), accounts can be restored (Task 2), and `GET /api/v1/me` answers the installation's default time zone and language (Task 3). Speed is a gate, not a hope: Lighthouse (mobile, simulated slow 4G, 4× CPU) fails CI above LCP 2.5 s, CLS 0.1, TBT 200 ms or a per-route script budget, and a Playwright run measures INP ≤ 200 ms over the record flow (ruling P134).

**Tech Stack:** Node.js 24.21.0, pnpm 12.11.2, Next.js 16.4.0 (App Router, `proxy.ts`), React 19.3.0, TypeScript 6.0.3 strict, Zod 4.6.5 (server only), next-intl 4.14.9, Tailwind CSS 4.3.3 (`@tailwindcss/postcss` 4.3.3), shadcn/ui-style components on `radix-ui` 1.7.0 with `class-variance-authority` 0.7.1, `clsx` 2.1.1 and `tailwind-merge` 3.7.0, `openapi-typescript` 7.13.0 + `openapi-fetch` 0.17.0, Vitest 5.0.3 with jsdom 30.1.2, `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2, `@testing-library/user-event` 14.6.7, `@testing-library/jest-dom` 7.0.1, `axe-core` 4.13.0; Playwright 1.63.0 with `playwright-bdd` 9.2.1 and `@axe-core/playwright` 4.13.0; Lighthouse 13.5.0 and `web-vitals` 6.2.3; `eslint-plugin-react-hooks` 7.1.1; PostgreSQL 18.6 (Docker CLI in tests). Recharts is not added: M6a has no chart (it arrives, lazy-loaded, with HU-E9-10 and HU-E9-11).

**Spec:** `docs/superpowers/specs/2026-10-11-hearth-design.md` (D18: Next.js is the BFF and `/api/v1` the primary contract; D19 time of a transaction; D20 subcategories; D21 account switches; D22 styles; D23 formats never from the language; section 7 "Architecture"; section 9 testing). Stories: `docs/backlog/E9-web-ui.md` (the epic's rules, HU-E9-01, HU-E9-02, HU-E9-03, HU-E9-13; HU-E9-04 is out except what HU-E9-03's category picker needs), `docs/backlog/README.md` (UI Definition of Done; every dependency of these four stories is `Done`), follow-up issue #125. **Approved design:** the canvas "Hearth Web UI — Batch 1" (https://claude.ai/artifact/4tjCFckXYwb6BhLNRkGq8y), artboards Main (sign-in), SignUp, Home, QuickAdd, CategoryPicker, Activity, Accounts, NewAccount, SpaceSheet, ProfileSheet, Locale, Desktop, NavMap and Settings; FlowPicker and FlowNewCategory show HU-E9-12 (Should, out of scope); CardPurchase and CDT are marked "concepto futuro" and are out of scope; Categories, CategoryEdit and BrandRules belong to HU-E9-04 and HU-E9-14 (out). Where a story and an artboard disagree the story wins (Self-Review, "Design deviations"). Format template and precedent: `docs/superpowers/plans/2026-10-17-m4-insight-api.md` and `docs/superpowers/plans/2026-10-19-m5-nightly-backups.md`. Rulings in force: P1–P116; this plan rules **P117–P152** (P142–P152 from the owner's flow review, see "Owner flow review: sign-up and sign-in"). GitHub Project: https://github.com/users/Facabore/projects/4.

**Baseline: `development` at `8ade8fb` or later.** Verified at that commit while planning: `src/app/` holds only `api/v1/**` route handlers (no layout, no page); `next.config.ts` is `{ output: "standalone", poweredByHeader: false }`; `eslint.config.mjs` has the JS and TypeScript blocks only; `.dependency-cruiser.cjs` has the seven rules quoted in Task 4a; `vitest.config.ts` has the projects `unit`, `integration`, `acceptance` and `operations`; `package.json` pins exactly the versions listed in `docs/stack-versions.md`; the snapshot has 85 operations and its 4xx descriptions name 118 distinct error codes (Task 5b extracts them); the latest migration is `0018_user_preferences`; accounts use ten lower-case palette keys and sixteen Lucide icon names while categories use the sixteen upper-case keys and 58 Hearth symbol names (`src/modules/categories/domain/category-style.ts`); there is no account restore endpoint; `GET /api/v1/me` answers `preferences.defaults` with the four formats only. Every npm version below was read from the registry on 2026-10-19 and is at least two weeks old (published on or before 2026-10-05); newer ones are listed in follow-up 4.

**Out of scope (later plans):** HU-E9-04 categories screen and HU-E9-12 (create or edit a category from the form: the picker shows no create, edit or "Manage" control), HU-E9-05 … HU-E9-11 and HU-E9-14 (shared spaces, split editor, balances, planner, recurrences, dashboards with Recharts, installation rules), editing and deleting transactions (M6b, with their `If-Match` flow; ruling P140), editing accounts (#120), the PWA (HU-E8-07), the "concepto futuro" artboards (card installments HU-E8-11, CDT yield HU-E8-12), a text search in the transaction list (the API has none), and per-space brand (HU-E8-18). Ruling P126 lists every design control M6a leaves out.

## Global Constraints

- Versions: Node.js `24.21.0`; pnpm `12.11.2`; Next.js `16.4.0`; React `19.3.0`; TypeScript `6.0.3` (`strict`, `noUncheckedIndexedAccess`); Zod `4.6.5`; zod-openapi `6.0.2`; drizzle-orm `0.45.4`; drizzle-kit `0.31.11`; better-auth `1.7.7`; Vitest `5.0.3`; PostgreSQL `postgres:18.6-alpine`. **New dependencies, exact pins only** (`pnpm check:pinned` forbids ranges), each published on or before 2026-10-05: dependencies `next-intl 4.14.9`, `radix-ui 1.7.0`, `class-variance-authority 0.7.1`, `clsx 2.1.1`, `tailwind-merge 3.7.0`, `openapi-fetch 0.17.0`; devDependencies `tailwindcss 4.3.3`, `@tailwindcss/postcss 4.3.3`, `openapi-typescript 7.13.0`, `jsdom 30.1.2`, `@testing-library/react 16.3.3`, `@testing-library/dom 10.4.2`, `@testing-library/user-event 14.6.7`, `@testing-library/jest-dom 7.0.1`, `axe-core 4.13.0`, `@playwright/test 1.63.0`, `playwright-bdd 9.2.1`, `@axe-core/playwright 4.13.0`, `lighthouse 13.5.0`, `web-vitals 6.2.3`, `eslint-plugin-react-hooks 7.1.1`. Nothing else (no `lucide-react`, no `tw-animate-css`, no shadcn CLI, no `@lhci/cli`, no `eslint-config-next`, no `recharts`).
- **The UI talks only to `/api/v1` through the generated client** (ruling P117). No server action, no route handler written for the UI, no import of `src/composition`, of a module's `domain`, `application`, `infrastructure` or `contracts`, of `src/shared/http` or `src/shared/infrastructure`, or of `drizzle-orm`, `pg`, `better-auth` or `zod-openapi` from `src/app/(web)`, `src/i18n`, `src/proxy.ts`, `src/shared/ui` or any `src/modules/*/ui` (ruling P119; `pnpm lint:boundaries` fails otherwise). The UI may import only `src/shared/kernel/time-zone.ts`, `local-date.ts` and `style.ts` from the kernel.
- **Every UI string is translatable** (es default, en): visible text, `aria-label`s, placeholders and `<title>`s come from `src/i18n/messages/{es,en}.json`; `pnpm i18n:check` fails on a key present in one catalog only and on an OpenAPI error code without `errors.<Code>`; the API's codes are never shown raw. User data (space, account, category names, the seeded "Personal") is shown as stored, never translated.
- **Numbers, dates and times come from the person's effective preferences** (`GET /api/v1/me` `preferences.effective`), never from the language: only `src/shared/ui/format/` may call `Intl.NumberFormat`, `Intl.DateTimeFormat` or `toLocale*String` (ruling P121; `tests/architecture/ui-formatting.test.ts` fails otherwise). Amounts on the wire stay `{ amount: "<minor units>", currency }`; the UI parses them with `BigInt`, never `Number`.
- **Deletes are logical:** the UI offers archive and restore, never a hard delete; archived accounts and categories are never offered in a picker.
- **Accessibility:** every control has a label, every screen works with the keyboard alone, focus is visible (2 px outline in the accent), touch targets are at least 44 px, contrast meets WCAG AA in light and dark themes. Component tests run `axe-core` (contrast off in jsdom); the e2e run scans every screen with `@axe-core/playwright` in light and dark.
- **Performance budgets fail CI** (ruling P134): per route, median of three Lighthouse 13.5.0 mobile runs: LCP ≤ 2500 ms, CLS ≤ 0.1, TBT ≤ 200 ms, script transfer within the budget of `tests/performance/budgets.json`; INP ≤ 200 ms over the record flow with 4× CPU throttling. Server Components by default; a client component only where state or events need it; no client component imports a chart, a date library or a whole icon set.
- Hexagonal boundaries (ADR 0001) stay as they are for the backend; the backend Tasks 1–3 follow M4's conventions (use case authorizes, `problem+json` with stable codes, `openapi/openapi.snapshot.json` regenerated, never edited by hand).
- Strict TDD: every behaviour starts with a failing test that is run and seen failing. Component and container tests in the Vitest `ui` project; `@e2e` scenarios in Playwright + playwright-bdd against `next start`'s standalone server and a disposable PostgreSQL.
- Code, identifiers, comments, docs and generated artifacts in English; UI copy in the catalogs (Spanish and English). Conventional commits referencing the story issue (`Refs #<n>`); no AI attribution or `Co-Authored-By` lines.
- Agents never read or edit `.env`, `.env.*` or `.env.production.example` (ruling P114, carried): every new variable has a default (`INTERNAL_API_ORIGIN`) or is test-only (`HEARTH_E2E_FIXED_NOW`), and is documented in `docs/operations/deploy.md`.
- Gates for every task: `pnpm exec vitest run --project unit`, `pnpm exec vitest run --project integration`, `pnpm exec vitest run --project acceptance`, `pnpm format`, `pnpm exec eslint .`, `pnpm exec tsc --noEmit`, `pnpm exec prettier --check .`, `pnpm lint:boundaries`, `pnpm db:check`, `pnpm check:pinned`; from Task 4a on also `pnpm exec vitest run --project ui`; from Task 4b `pnpm api:check`; from Task 5b `pnpm i18n:check`; from Task 10 `pnpm build && pnpm test:e2e` (Docker running); from Task 19 `pnpm perf`. The `operations` project is unchanged and still runs in CI.

## Review Focus

1. **The language leaking into formats.** A person with locale `en` and `DOT_COMMA`/`DMY`/`H24` must read `$ 1.600.000`, `5/10/2026` and `14:30`; changing the language in Settings must not move the preview. Expected: no component formats with `Intl` defaults or `toLocaleString` — pinned in Task 6 (the HU-E9-02 outline, the architecture scan), Task 11b (language change keeps the preview) and Task 18 (the settings e2e reads the list in the new formats).
2. **Day boundaries and zones.** At 2026-11-01T04:30Z Bogotá is still 31 October 23:30; a transaction recorded in `Europe/Madrid` and read by a Bogotá viewer shows Madrid's wall-clock time plus the zone; rows without a time sort last and show none; stepping 23:55 by +5 minutes gives 00:00 of the same chosen day. Expected: the record's own zone wins and the day never shifts silently — pinned in Task 6 (`nowIn`, `stepMinutes`), Task 15 (row times and zones), Task 16 (sheet) and Task 18 (both e2e outlines).
3. **Sessions and redirects.** An expired cookie that is still present, `next=//evil.example`, `next=https://evil.example`, `next=/\evil`, `next=%2F%09%2Fevil.example` (a tab the URL parser drops), a signed-in person opening `/sign-in`, a protected page with a query string. Expected: only same-origin paths are honoured, everything else lands on `/`, the query string survives the round trip, a signed-in person on `/sign-in` lands on the home, and an expired session ends on the sign-in screen with `next` and never loops — pinned in Task 8a (`safeNext`, `redirectFor`, the public layout's real session check) and Task 9 (the shell's 401 path).
4. **Double submits and retries.** A double click on Save, a network failure followed by a retry, an edit after a 422. Expected: one transaction, never `IdempotencyKeyConflict`, and the error next to its field — pinned in Task 17a (`useIdempotencyKey`, the form container's submit tests).
5. **Codes without a message and broken responses.** A code missing from the catalogs, a 500, an HTML 502 from the proxy, a `fetch` that rejects offline, a `ValidationFailed` with field paths. Expected: `errors.Unknown` with the request id when there is one, the field highlighted when the path or code names one, never a raw code or a stack — pinned in Task 4b (`problemFrom`), Task 5b (`useProblemMessage`), Task 8b (sign-up fields) and Task 17a (record fields).
6. **Archived and foreign data in pickers.** An archived account, an archived category or subcategory, an account of another type in a transfer, a space the person left. Expected: never offered; restore brings an account back — pinned in Task 12 (archived section), Task 13 (restore), Task 14 (pickers) and Task 18 (the accounts e2e).

## Execution Workflow

- Work on the long-lived branch `development` (`8ade8fb` or later); every task is implemented there with Strict TDD. Implementers stage; the controller commits.
- **This plan is committed before Task 1.** The controller commits this file on `development` first (`docs(plans): add the M6a web shell and ledger plan (Refs #69)`), because Task 19 adds it to the `mkdocs.yml` nav and links it from `docs/decisions/README.md`, and `mkdocs build --strict` fails on a page missing from the repository.
- **RDD before every commit** (receipt-driven development is on; check with `gentle-ai review mode status`). Each "Commit" step means:
  1. Run every source-mutating normalizer first (`pnpm format`, `pnpm api:types` when the snapshot changed), then stage exactly the files of the task.
  2. Run `gentle-ai review status --cwd . --contract gentle-ai.review-integration/v2 --agent claude-code --next-transition` and follow only the returned `next_transition` (`execute` its operation, satisfy `collect` inputs, or stop on `stop` and report its reason code with its documented continuation). Medium/high-risk candidates may return a consent envelope; relay it to the owner and wait.
  3. Commit only after the provider-returned `review.validate` allows the `pre-commit` gate for that exact staged candidate; the commit must not change the reviewed bytes.
  4. If the owner disables RDD (`gentle-ai review mode disable --scope clone --cwd .`), commit under ordinary policy and report `disabled/unmanaged`.
- Code blocks are complete where they decide something (configuration, scripts, pure functions the tests do not determine, exact copy, test files) and are not guaranteed to match Prettier's wrapping: run `pnpm format` before the gates. Every code block the executor writes is introduced by a line naming its file in backticks; "Create" blocks are whole files; edits name a unique anchor line ("after the line …", "replace the line …"). For React components the plan fixes the file, the exported name, the props, the roles and labels the tests query, and the tests; the markup follows the named artboard.
- **Task labels and order:** 1, 2, 3, 4a, 4b, 5a, 5b, 6, 7a, 7b, 8a, 8b, 9, 10, 11a, 11b, 12, 13, 14, 15, 16, 17a, 17b, 18, 19 (25 commits). Lettered halves are separate commits and RDD passes, each green on its own.
- **Sizes (Tasks 1–10 measured by preflight A, Tasks 11–19 estimated while planning):** each task is one commit sized for review, target under ~400 changed lines, and a task over ~500 is split at its named split point into two commits, each green on its own. Excluded from the count, like `drizzle/` before: `pnpm-lock.yaml`, the generated `src/shared/ui/api/schema.d.ts`, `drizzle/meta/` and `openapi/openapi.snapshot.json` regenerations of more than 30 lines (their diff is reviewed separately and must be explained by the task's contract change). Measured in preflight A (the dry run of Tasks 1–10, with its fixes folded in): 1 492, 2 107, 3 32, 4a 148, 4b 436, **5 570, so it is planned as 5a ~150 and 5b ~420**, 6 370, 7a 406, 7b 446, 8a 398, 8b 300, **9 496** (split point: `profile-sheet.tsx` and its test, `space-helpers.ts` and its test, `space-switcher.tsx`, `nav-links.tsx`, `app-shell.tsx`, `shell.test.tsx`, both `ui/index.ts` files and the `shell` and `home` catalog keys, about 390 | `app-shell-container.tsx`, `redirectToSignIn` in `server.ts`, the `(app)` pages, `error.tsx` and `not-found.tsx`, about 105; Task 9's commit step spells out both passes), 10 377 (split point, if a later change pushes it over: the clock seam, `scripts/e2e-server.mjs`, `playwright.config.ts`, the global teardown and CI | the features, steps and fixtures). Estimates: 11a ~400, 11b ~340, 12 ~400, 13 ~420, 14 ~360, **15 ~460** (split point: `day-groups.ts`, `transaction-row.tsx` and their tests | the container, filters, load-more and the page), 16 ~390, **17a ~460** (split point: `record-request.ts`, `problem-fields.ts`, `use-idempotency-key.ts` and their tests | the form, its container and the page), 17b ~280, 18 ~340, 19 ~420. The controller measures each staged candidate (`git diff --cached --numstat`, exclusions above) before RDD and splits at the named point when it is over ~500.
- The OpenAPI snapshot changes in Tasks 1 (account `color` and `icon` enums), 2 (`POST …/accounts/{accountId}/restore`) and 3 (`preferences.defaults.timezone` and `.locale`); each regenerates `src/shared/ui/api/schema.d.ts` from Task 4b on (Tasks 1–3 run before 4b, so 4b generates it from the final snapshot).
- When a task starts, move its story issue to **In Progress** on Project #4. When all tasks are done, open one pull request from `development` into `main` that closes #69, #70, #71, #111 and #125 and completes the M6a part of milestone M6. Its description lists, as PR notes: (1) the UI's single contract (P117) and the new boundary rules (P119); (2) the three API changes (Tasks 1–3) and migration `0019_account_style_vocabulary`; (3) the new CI jobs `e2e` and `performance` and their budgets; (4) the rulings P117–P152 as ruled (P142–P152 from the owner's flow review); (5) the follow-ups in the Self-Review; (6) the owner's answers to the planner's two questions (P140: transactions are read-only in M6a; P141: no Plan and Saldos tabs yet).
- Task-to-issue map: #125 → Task 1; HU-E9-03 (#71) → Tasks 2, 12–18; HU-E9-13 (#111) → Tasks 3, 11a, 11b; HU-E9-01 (#69) → Tasks 4a, 4b, 7a, 7b, 8a, 8b, 9, 10; HU-E9-02 (#70) → Tasks 5a, 5b, 6; Task 19 references #69, #70, #71 and #111.

## File Structure

```
.
├── package.json                               # deps, scripts api:types, api:check, i18n:check, test:ui, test:e2e, perf (4a, 4b, 5b, 10, 19)
├── pnpm-workspace.yaml                        # allowBuilds: next-intl's @parcel/watcher and @swc/core denied (5a)
├── next.config.ts                             # next-intl plugin (5a)
├── postcss.config.mjs                         # new: @tailwindcss/postcss (4a)
├── playwright.config.ts                       # new: e2e, a11y, perf projects (10, 18, 19)
├── vitest.config.ts                           # ui project (4a)
├── eslint.config.mjs                          # react-hooks, ignores (4a)
├── .dependency-cruiser.cjs                    # UI boundary rules (4a)
├── .prettierignore, .gitignore                # generated files (4b, 10)
├── .github/workflows/ci.yml                   # api:check, i18n:check (4b, 5b), e2e job (10), performance job (19)
├── drizzle/0019_account_style_vocabulary.sql  # new: account colors and icons mapped (1)
├── scripts/
│   ├── api-types.mjs                          # new: generate/check the client types (4b)
│   ├── i18n-check.mjs (+ .test.mjs)           # new (5b)
│   └── e2e-server.mjs                         # new: disposable PostgreSQL + standalone server (10)
├── src/
│   ├── proxy.ts                               # new: session redirect (8a)
│   ├── i18n/{locale.ts, request.ts, global.d.ts, messages/es.json, messages/en.json}   # (5a; 5b the errors; every UI task adds keys)
│   ├── shared/kernel/style.ts                 # new: PALETTE, SYMBOLS (1)
│   ├── shared/infrastructure/env.ts           # HEARTH_E2E_FIXED_NOW (10)
│   ├── composition/container.ts               # restoreAccount (2), profile region defaults (3), e2e clock (10)
│   ├── modules/accounts/{domain,application,contracts,infrastructure}/…   # (1, 2)
│   ├── modules/identity/{application,contracts}/…                         # (3)
│   ├── shared/ui/
│   │   ├── api/{schema.d.ts (generated), client.ts, server.ts, problem.ts, use-problem-message.ts}   # (4b, 5b)
│   │   ├── format/{formatters.ts, currencies.ts, zones.ts, amount-input.ts} # (6, 13)
│   │   ├── time/{when.ts, server-now.ts}                                   # (6)
│   │   ├── navigation/auth-redirect.ts                                     # (8a)
│   │   ├── theme/theme.ts                                                  # (7a)
│   │   ├── icons/{symbols.ts, ui-icons.ts}                                 # (7a)
│   │   ├── cn.ts, atoms/*, molecules/*                                     # (7a, 7b)
│   │   └── index.ts
│   ├── modules/identity/ui/   # sign-in, sign-up, language toggle, profile sheet (8a, 8b, 9), settings/* (11a, 11b)
│   ├── modules/spaces/ui/     # app shell, space switcher, shell container (9)
│   ├── modules/accounts/ui/   # accounts screen (12), new account form, archive and restore (13), account picker (14)
│   ├── modules/categories/ui/ # category picker, category icon, tree helpers (14)
│   ├── modules/ledger/ui/     # transaction list (15), date-time sheet (16), record form (17a), home (17b)
│   └── app/(web)/
│       ├── layout.tsx, globals.css                                         # (7a, 8a)
│       ├── (public)/sign-in/page.tsx, (public)/sign-up/page.tsx            # (8a, 8b)
│       └── (app)/layout.tsx, page.tsx, error.tsx, not-found.tsx, settings/page.tsx,
│           spaces/[spaceId]/{page.tsx, transactions/page.tsx, accounts/page.tsx, accounts/new/page.tsx, new/page.tsx}
├── tests/
│   ├── architecture/{boundaries.test.ts, ui-formatting.test.ts, fixtures/…}   # (4a, 6)
│   ├── support/ui/{fake-api.ts, render.tsx, axe.ts, dto.ts}, support/ui-setup.ts   # (4a, 4b)
│   ├── e2e/{features/*.feature, steps/*.ts, support/*.ts, a11y.spec.ts, perf/inp.spec.ts}   # (10, 18, 19)
│   └── performance/{lighthouse.mjs, budgets.json}   # (19)
└── docs/ (architecture, stack-versions, adr/0003, adr/0004, decisions, README, backlog E2/E9, operations/deploy, data-model)   # (1, 19)
```

Test layout: pure UI logic (`*.test.ts`) runs in the `unit` project (Node); components and containers (`*.test.tsx`) run in the new `ui` project (jsdom) next to their code; e2e runs with Playwright. Run one file with `pnpm exec vitest run --project ui <path>`.

### How the UI reads and writes

| Need | Where it runs | Through |
|---|---|---|
| A page's data (me, spaces, accounts, transactions, categories, periods) | Server Component container (`load*` function) | `serverApi()` → loopback `INTERNAL_API_ORIGIN` with the request's `cookie`, `x-forwarded-for` and `accept-language` (Task 4b) |
| Sign up, sign in, sign out | Client container in the browser | `browserApi()` → same-origin `/api/v1/auth/*` (the cookie is set by the API response; the throttles see the real client, P117) |
| Record, create, archive, restore, PATCH `/me` | Client container in the browser | `browserApi()`; then `router.refresh()` so Server Components read again |
| "Load more" of the transaction list | Client component | `browserApi()` with the page's cursor |
| Locale of a request | `src/i18n/request.ts` | `getMe()` (the same cached call the shell uses) when a session cookie is present |

---

### Owner flow review: sign-up and sign-in (2026-10-20, rulings P142–P152)

The owner reviewed the sign-up, sign-in, sign-out and session flow before any UI code. They approved closing sign-up with an environment variable and an operator password reset. They asked for a "confirm password" field and for sessions of 15 days, and approved the rest of the draft as proposed ("el resto de cosas de una"). P142–P144 and P150 are backend changes, already shipped on `development` as `9ca118b`, `0c8bb02` and the P150 commit. The others amend the UI tasks named in each entry. Where an entry contradicts a task's text below, the entry wins.

| Ruling | Decision | Task |
|---|---|---|
| P142 | `POST /api/v1/auth/sign-up` takes an optional `locale` (`es`, `en`). The sign-up container sends the screen's current locale, so a visitor who switched to English stays in English after sign-up. | 3b (shipped), 8b |
| P143 | `HEARTH_SIGN_UP=open\|closed`. While `closed`, sign-up needs an `invitationToken` that names a usable invitation; otherwise it answers 403 `SignUpClosed`. The public `GET /api/v1/auth/sign-up` answers `{ signUp: "open" \| "closed" }`. | 3b (shipped), 8a, 8b |
| P144 | A forgotten password is reset by the operator with `scripts/reset-password.mjs` in the migrator image (`docs/operations/accounts.md`). There is no email reset until Hearth can send mail. | 3c (shipped), 8a |
| P145 | A signed-in person who opens `/sign-in` or `/sign-up` goes to `/`, their personal space. The page (a Server Component) calls `getMe()` and redirects when it answers a profile; the proxy keeps letting public paths through whatever the cookie says, because a stale or expired cookie must still reach the form (a cookie-based redirect would loop with `loaded()`'s 401 redirect). `getMe()` answers null only on a 401 and throws on any other failure (`meFrom`, Task 4b), so a server error never reads as "signed out". Tests: both pages redirect with a profile and render the form with a stale cookie. | 4b, 8a, 8b |
| P146 | The sign-in screen: (1) under the password, a "¿Olvidaste tu contraseña?" / "Forgot your password?" button (`auth.signIn.forgot`) shows an inline note, `auth.signIn.forgotHelp` "Pídele a quien administra Hearth que la restablezca." / "Ask whoever runs Hearth to reset it.", with `aria-expanded` and `aria-controls`; (2) the "Crear una cuenta" link is not rendered when `GET /api/v1/auth/sign-up` answers `closed` (the page reads it on the server); (3) after a problem, the email keeps its value, the password is cleared and gets focus. | 8a |
| P147 | The sign-up screen: (1) a fourth field `auth.signUp.confirmPassword` "Confirmar contraseña" / "Confirm password" (`PasswordField`, `autoComplete="new-password"`, like the password field). When it differs from the password, the form sends nothing and shows `auth.signUp.passwordMismatch` "Las contraseñas no coinciden." / "The passwords do not match." under it, and focuses it. The body never carries the confirmation. (2) The body adds `locale` (P142) and, when the URL has `?invitation=<token>`, `invitationToken`; the sign-in screen's link to sign-up keeps that parameter. (3) When the mode is `closed` and the URL has no `invitation`, the page renders no form. It shows `auth.signUp.closedTitle` "El registro está cerrado" / "Sign-up is closed", `auth.signUp.closedBody` "Pídele una invitación a alguien de tu hogar." / "Ask someone in your household for an invitation." and a link to sign in. A `SignUpClosed` answer shows the same notice. (4) Under the form: `auth.signUp.haveAccount` "¿Ya tienes cuenta?" / "Already have an account?" with the link `auth.signUp.signIn` "Inicia sesión" / "Sign in". | 8b |
| P148 | First use: the home of a space whose account list is empty shows a card `home.firstAccount.title` "Agrega tu primera cuenta" / "Add your first account", with `home.firstAccount.body` and a primary link to the accounts screen. It takes the place of the period summary until an account exists. | 17b |
| P149 | Sign-out writes the signed-in user's stored locale to the `hearth.locale` cookie before it calls `POST /api/v1/auth/sign-out`, so the sign-in screen keeps their language. | 9 |
| P150 | A session lasts 15 days from its last use: Better Auth's `session.expiresIn`, renewed once a day while in use. | backend (shipped) |
| P151 | An expired session. A page load already goes to `/sign-in?next=<path>` (`loaded()`, Task 4b). In the browser, `browserApi()` gets an `openapi-fetch` middleware: a 401 from any path outside `/api/v1/auth/*` calls `window.location.assign("/sign-in?next=<current path and query>&expired=1")`. The sign-in screen shows `auth.sessionExpired` "Tu sesión venció. Vuelve a entrar." / "Your session expired. Sign in again." when `expired=1`; `safeNext` ignores `expired`. A half-filled form is lost; that is accepted for M6a. | 8a |
| P152 | The public screens' "ES · EN" toggle changes only the visitor cookie, never the stored locale. After sign-in the stored locale wins (P120) and changes only in Settings. | 8a (unchanged behaviour, now explicit) |

---

### Task 1: One style vocabulary for accounts and categories (#125)

Resolves follow-up #125 (ruling P122) before any screen draws an account: accounts take the categories' sixteen upper-case palette keys and Hearth symbol names, the shared lists move to the kernel, and migration `0019_account_style_vocabulary` maps the stored values. The categories' API is unchanged (still 58 symbols).

**Files:**
- Create: `src/shared/kernel/style.ts`, `src/shared/kernel/style.test.ts`, `drizzle/0019_account_style_vocabulary.sql` (with its `drizzle/meta/0019_snapshot.json` and journal entry from `pnpm db:generate --custom`), `src/modules/accounts/infrastructure/account-style-vocabulary.int.test.ts`
- Modify: `src/shared/kernel/index.ts`, `src/modules/categories/domain/category-style.ts`, `src/modules/accounts/domain/account.ts`, `src/modules/accounts/domain/account.test.ts`, `src/modules/accounts/application/create-account.test.ts`, `src/modules/accounts/application/manage-accounts.test.ts`, `src/modules/accounts/infrastructure/accounts.schema.ts`, `src/modules/accounts/infrastructure/drizzle-account-repository.int.test.ts`, `src/modules/accounts/contracts/accounts.contract.test.ts`, `tests/acceptance/account-attributes.test.ts`, `openapi/openapi.snapshot.json` (regenerated), `docs/backlog/E2-accounts.md`, `docs/architecture/data-model.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PALETTE` (16 keys, color-row order) and `type PaletteKey`; `SYMBOLS` (61 names: the 58 category symbols plus `cash`, `trend`, `wallet`, alphabetical) and `type SymbolName`, exported from `@/shared/kernel` and importable by UI code as `@/shared/kernel/style`. `ACCOUNT_COLORS = PALETTE`; `ACCOUNT_ICONS` = `cash, bank, wallet, card, piggy, trend, coins, dots, users, briefcase, car, star, gift, home, plane, phone`; type defaults CASH `cash`, BANK `bank`, WALLET `wallet`, CREDIT_CARD `card`, SAVINGS `piggy`, INVESTMENT `trend`, LOAN `coins`, OTHER `dots`, SHARED_FUND `users`. Later tasks draw every account and category icon from one registry keyed by `SymbolName` (Task 7a).

- [ ] **Step 1: Write the failing kernel test**

`src/shared/kernel/style.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ACCOUNT_COLORS, ACCOUNT_ICONS } from "@/modules/accounts/domain/account";
import { CATEGORY_COLORS, CATEGORY_SYMBOLS } from "@/modules/categories/domain/category-style";
import { PALETTE, SYMBOLS } from "./style";

describe("the shared style vocabulary (#125, ruling P122)", () => {
  it("is one palette of sixteen keys for categories and accounts", () => {
    expect(PALETTE).toHaveLength(16);
    expect(CATEGORY_COLORS).toBe(PALETTE);
    expect(ACCOUNT_COLORS).toBe(PALETTE);
  });

  it("names every symbol once, alphabetically, and both allow-lists are subsets", () => {
    expect([...SYMBOLS]).toEqual([...SYMBOLS].sort());
    expect(new Set(SYMBOLS).size).toBe(61);
    expect(SYMBOLS.filter((name) => !(CATEGORY_SYMBOLS as readonly string[]).includes(name))).toEqual([
      "cash",
      "trend",
      "wallet",
    ]);
    expect(ACCOUNT_ICONS.every((name) => (SYMBOLS as readonly string[]).includes(name))).toBe(true);
    expect(ACCOUNT_ICONS).toHaveLength(16);
  });
});
```

(Test files are excluded from dependency-cruiser, so a kernel test may read both modules.)

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec vitest run --project unit src/shared/kernel/style.test.ts`
Expected: FAIL — `Failed to resolve import "./style"`.

- [ ] **Step 3: Create the kernel vocabulary**

`src/shared/kernel/style.ts`:

```ts
/**
 * D22, #125 (ruling P122): the one palette of the app, in the order the color row shows it. The UI maps each key to its
 * light and dark tokens; no hex value is stored.
 */
export const PALETTE = [
  "PINE",
  "SAGE",
  "OLIVE",
  "SAND",
  "MUSTARD",
  "AMBER",
  "EMBER",
  "CORAL",
  "ROSE",
  "PLUM",
  "LAVENDER",
  "INDIGO",
  "SKY",
  "TEAL",
  "STEEL",
  "GRAPHITE",
] as const;
export type PaletteKey = (typeof PALETTE)[number];

/**
 * Ruling P122: every symbol name the UI draws, alphabetical. Categories allow 58 of them (`CATEGORY_SYMBOLS`), accounts
 * 16 (`ACCOUNT_ICONS`); `cash`, `trend` and `wallet` are account-only.
 */
export const SYMBOLS = [
  "apple", "bag", "bank", "basket", "bike", "book", "bread", "briefcase", "bulb", "bus", "calendar", "car", "card",
  "cart", "cash", "chart", "coins", "cross", "cup", "dots", "droplet", "flame", "fork", "fuel", "game", "gift", "globe",
  "graduation", "gym", "heart", "home", "key", "laptop", "leaf", "music", "parking", "paw", "percent", "phone", "piggy",
  "pill", "pizza", "plane", "receipt", "scissors", "shield", "shirt", "sofa", "star", "tag", "ticket", "tooth", "train",
  "trend", "tv", "umbrella", "users", "wallet", "wifi", "wine", "wrench",
] as const;
export type SymbolName = (typeof SYMBOLS)[number];
```

In `src/shared/kernel/index.ts`, after the line `export * from "./time-zone";` add `export * from "./style";`.

- [ ] **Step 4: Point categories at the kernel**

In `src/modules/categories/domain/category-style.ts`: replace the line `import { domainError, err, ok, type Result } from "@/shared/kernel";` with `import { domainError, err, ok, PALETTE, type PaletteKey, type Result, type SymbolName } from "@/shared/kernel";`; replace the whole `CATEGORY_COLORS` array (from `export const CATEGORY_COLORS = [` through its `] as const;`) and the line `export type CategoryColor = (typeof CATEGORY_COLORS)[number];` with:

```ts
export const CATEGORY_COLORS = PALETTE;
export type CategoryColor = PaletteKey;
```

and replace the `] as const;` that closes `CATEGORY_SYMBOLS` (the line after `"wrench",`) with `] as const satisfies readonly SymbolName[];`. The existing `category-style.test.ts` (58 names, sixteen keys in order) passes unchanged; `categories.schema.ts` keeps importing `CATEGORY_COLORS`.

- [ ] **Step 5: Accounts adopt the vocabulary**

In `src/modules/accounts/domain/account.ts`: replace the line `import { domainError, err, ok, type Id, type Result } from "@/shared/kernel";` with `import { domainError, err, ok, PALETTE, type Id, type PaletteKey, type Result, type SymbolName } from "@/shared/kernel";`, and replace everything from `/** HU-E2-05: the palette keys an account may take. */` through the closing `};` of `DEFAULT_ICONS` with:

```ts
/** HU-E2-05, ruling P122: an account takes any key of the app's one palette. */
export const ACCOUNT_COLORS = PALETTE;
export type AccountColor = PaletteKey;

/** HU-E2-05, rulings P50 and P122: allow-listed Hearth symbols: each type's default plus a few household ones. */
export const ACCOUNT_ICONS = [
  "cash",
  "bank",
  "wallet",
  "card",
  "piggy",
  "trend",
  "coins",
  "dots",
  "users",
  "briefcase",
  "car",
  "star",
  "gift",
  "home",
  "plane",
  "phone",
] as const satisfies readonly SymbolName[];
export type AccountIcon = (typeof ACCOUNT_ICONS)[number];

const DEFAULT_ICONS: Readonly<Record<AccountType, AccountIcon>> = {
  CASH: "cash",
  BANK: "bank",
  WALLET: "wallet",
  CREDIT_CARD: "card",
  SAVINGS: "piggy",
  INVESTMENT: "trend",
  LOAN: "coins",
  OTHER: "dots",
  SHARED_FUND: "users",
};
```

In `src/modules/accounts/infrastructure/accounts.schema.ts` (as shipped after the Task 1 review: the enums import `PALETTE` from `@/shared/kernel` and `ACCOUNT_ICONS` from the accounts domain, like `categories.schema.ts` does, and `pnpm db:check` reports no drift): replace the ten values of the `color` enum with the sixteen `PALETTE` keys in order and the sixteen values of the `icon` enum with the sixteen `ACCOUNT_ICONS` above in order; change the comment above them to `// HU-E2-05, ruling P122: the app's palette keys and Hearth symbol names; a null icon means the type's default (P50).`

- [ ] **Step 6: Update the existing account tests to the new names**

Mechanical replacements; nothing else in these tests changes:
- `src/modules/accounts/domain/account.test.ts`: `"pine"` → `"PINE"` (all three), `"ember"` → `"EMBER"`, `"sky"` → `"SKY"`; `"banknote"` → `"cash"`; the type-default list becomes `["cash", "bank", "wallet", "card", "piggy", "trend", "coins", "dots", "users"]`.
- `src/modules/accounts/application/create-account.test.ts`: `"pine"` → `"PINE"`.
- `src/modules/accounts/application/manage-accounts.test.ts`: `"pine"` → `"PINE"` (both).
- `src/modules/accounts/contracts/accounts.contract.test.ts`: in `refused`, after `["color", "Pine"],` add `["color", "pine"],` and after `["icon", "Wallet"],` add `["icon", "credit-card"],` (the old names are refused now); `color: "rose", icon: "smartphone"` → `color: "ROSE", icon: "phone"`; `color: "pine", icon: "wallet"` → `color: "PINE", icon: "wallet"` (both places).
- `src/modules/accounts/infrastructure/drizzle-account-repository.int.test.ts`: `"pine"` → `"PINE"`, `"ember"` → `"EMBER"`.
- `tests/acceptance/account-attributes.test.ts`: `"pine"` → `"PINE"`, `"ember"` → `"EMBER"`, `"sky"` → `"SKY"`, `"gem"` → `"star"`, `"banknote"` → `"cash"`.
- `tests/acceptance/category-styles.test.ts` keeps `[{ color: "sand" }, [422, "ValidationFailed"]]`: lower case is still refused.

- [ ] **Step 7: Write the failing migration test**

Generate the empty custom migration first: `pnpm db:generate --custom --name account_style_vocabulary` (creates `drizzle/0019_account_style_vocabulary.sql`, its snapshot and the journal entry; `pnpm db:check` stays clean because the schema's DDL does not change).

`src/modules/accounts/infrastructure/account-style-vocabulary.int.test.ts` is built like `src/modules/categories/infrastructure/category-styles-backfill.int.test.ts` (reuse its `beforeAll`, `afterAll`, `insertSpace` and `openDatabase` shapes with `TAG = "0019_account_style_vocabulary"`): copy `drizzle/` to a temporary folder whose journal stops before the tag, create a throwaway database from `inject("adminDatabaseUrl")`, migrate it with that copy, insert rows with raw SQL, then run `runMigrations(url, "drizzle")` and read them back; `afterAll` drops every database and the folder whatever failed. The rows are SHARED_FUND accounts of the SHARED space `insertSpace` creates (owner `NULL`, so no user row is needed):

```ts
const OLD_COLORS = ["pine", "ember", "sand", "sky", "plum", "moss", "clay", "slate", "gold", "rose"];
const OLD_ICONS = [
  "banknote", "landmark", "wallet", "credit-card", "piggy-bank", "trending-up", "hand-coins", "circle-ellipsis",
  "users", "briefcase", "car", "gem", "gift", "house", "plane", "smartphone",
];

describe(`${TAG} (#125, ruling P122)`, () => {
  it("maps every stored account color and icon to the shared vocabulary and keeps nulls", async () => {
    const db = await openDatabase(before);
    const insert = (name: string, order: number, color: string | null, icon: string | null) =>
      db.client.query(
        `INSERT INTO accounts (id, space_id, name, type, owner_user_id, opening_balance, color, icon, created_at)
         VALUES (gen_random_uuid(), $1, $2, 'SHARED_FUND', NULL, 0, $3, $4, now() + make_interval(secs => $5))`,
        [db.space, name, color, icon, order],
      );
    for (const [i, icon] of OLD_ICONS.entries()) await insert(`Fund ${i}`, i, OLD_COLORS[i % 10]!, icon);
    await insert("Plain", 99, null, null);
    await runMigrations(db.url, "drizzle");
    const { rows } = await db.client.query<{ color: string | null; icon: string | null }>(
      `SELECT color, icon FROM accounts WHERE space_id = $1 ORDER BY created_at`,
      [db.space],
    );
    expect(rows.map((r) => [r.color, r.icon])).toEqual([
      ["PINE", "cash"], ["EMBER", "bank"], ["SAND", "wallet"], ["SKY", "card"], ["PLUM", "piggy"],
      ["SAGE", "trend"], ["CORAL", "coins"], ["STEEL", "dots"], ["MUSTARD", "users"], ["ROSE", "briefcase"],
      ["PINE", "car"], ["EMBER", "star"], ["SAND", "gift"], ["SKY", "home"], ["PLUM", "plane"], ["SAGE", "phone"],
      [null, null],
    ]);
  });
});
```

- [ ] **Step 8: Run it and see it fail**

Run: `pnpm exec vitest run --project integration src/modules/accounts/infrastructure/account-style-vocabulary.int.test.ts`
Expected: FAIL — the first row comes back `["pine", "banknote"]`, because the generated migration is empty.

- [ ] **Step 9: Write the migration**

`drizzle/0019_account_style_vocabulary.sql` (replaces the generated placeholder):

```sql
-- #125, ruling P122: accounts take the categories' palette keys and Hearth symbol names. Written by hand: no DDL, the
-- columns stay text (the contract refuses other values, ruling P50). No value outside the old lists can be stored, so
-- the CASE never meets one; if it did, NULL means "the type's default".
UPDATE "accounts" SET "color" = CASE "color"
  WHEN 'pine' THEN 'PINE' WHEN 'ember' THEN 'EMBER' WHEN 'sand' THEN 'SAND' WHEN 'sky' THEN 'SKY'
  WHEN 'plum' THEN 'PLUM' WHEN 'moss' THEN 'SAGE' WHEN 'clay' THEN 'CORAL' WHEN 'slate' THEN 'STEEL'
  WHEN 'gold' THEN 'MUSTARD' WHEN 'rose' THEN 'ROSE' END
WHERE "color" IS NOT NULL;--> statement-breakpoint
UPDATE "accounts" SET "icon" = CASE "icon"
  WHEN 'banknote' THEN 'cash' WHEN 'landmark' THEN 'bank' WHEN 'wallet' THEN 'wallet' WHEN 'credit-card' THEN 'card'
  WHEN 'piggy-bank' THEN 'piggy' WHEN 'trending-up' THEN 'trend' WHEN 'hand-coins' THEN 'coins'
  WHEN 'circle-ellipsis' THEN 'dots' WHEN 'users' THEN 'users' WHEN 'briefcase' THEN 'briefcase' WHEN 'car' THEN 'car'
  WHEN 'gem' THEN 'star' WHEN 'gift' THEN 'gift' WHEN 'house' THEN 'home' WHEN 'plane' THEN 'plane'
  WHEN 'smartphone' THEN 'phone' END
WHERE "icon" IS NOT NULL;
```

- [ ] **Step 10: Regenerate the snapshot and run the gates**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` — the diff is exactly the `color` and `icon` enums of `Account` and of the create and update bodies (no new component). Then every gate of the Global Constraints.
Expected: all PASS, including the migration test and `pnpm db:check` ("No schema changes").

- [ ] **Step 11: Update the docs of HU-E2-05**

`docs/backlog/E2-accounts.md`: in HU-E2-05's scenarios `color "pine"` → `color "PINE"`, `"banknote"` → `"cash"`, `"ember"` → `"EMBER"`; replace the two notes that start with `` - `color`: one palette key`` and `` - `icon`: an allow-listed Lucide name`` with:

```markdown
  - `color`: one key of the app's palette (`PINE`, `SAGE`, `OLIVE`, `SAND`, `MUSTARD`, `AMBER`, `EMBER`, `CORAL`, `ROSE`, `PLUM`, `LAVENDER`, `INDIGO`, `SKY`, `TEAL`, `STEEL`, `GRAPHITE`), the same sixteen as categories (D22; #125, ruling P122 of the M6a plan).
  - `icon`: an allow-listed Hearth symbol name: `cash`, `bank`, `wallet`, `card`, `piggy`, `trend`, `coins`, `dots`, `users`, `briefcase`, `car`, `star`, `gift`, `home`, `plane`, `phone`. Defaults by type: CASH `cash`, BANK `bank`, WALLET `wallet`, CREDIT_CARD `card`, SAVINGS `piggy`, INVESTMENT `trend`, LOAN `coins`, OTHER `dots`, SHARED_FUND `users`. Migration `0019_account_style_vocabulary` mapped the earlier lower-case keys and Lucide names.
```

`docs/architecture/data-model.md`: after the migrations-table row of `0018_user_preferences.sql`, add a row in the same format: `` | [`0019_account_style_vocabulary.sql`](https://github.com/Facabore/Hearth/blob/development/drizzle/0019_account_style_vocabulary.sql) | Maps `accounts.color` to the shared palette keys and `accounts.icon` to Hearth symbol names (no DDL). | M6a, Task 1 | ``. The controller updates the HU-E2-05 issue body to the new notes in the same change (`docs/backlog/README.md` rule).

- [ ] **Step 12: Commit**

```bash
git add src/shared/kernel src/modules/categories/domain/category-style.ts src/modules/accounts \
  drizzle/0019_account_style_vocabulary.sql drizzle/meta tests/acceptance/account-attributes.test.ts \
  openapi/openapi.snapshot.json docs/backlog/E2-accounts.md docs/architecture/data-model.md
git commit -m "feat(accounts): take the shared palette and Hearth symbols for account styles (Refs #125)"
```

---

### Task 2: Restore an archived account

The UI shows archive and restore, never a hard delete, and accounts can only be archived today. Adds `RestoreAccount` and `POST /api/v1/spaces/{spaceId}/accounts/{accountId}/restore` (ruling P123), mirroring the archive path and its authorization.

**Files:**
- Create: `src/modules/accounts/application/restore-account.ts`, `src/app/api/v1/spaces/[spaceId]/accounts/[accountId]/restore/route.ts`
- Modify: `src/modules/accounts/domain/account.ts`, `src/modules/accounts/domain/account.test.ts`, `src/modules/accounts/application/index.ts`, `src/modules/accounts/application/manage-accounts.test.ts`, `src/modules/accounts/contracts/accounts.contract.ts`, `src/composition/container.ts`, `tests/acceptance/accounts.test.ts`, `openapi/openapi.snapshot.json`

**Interfaces:**
- Consumes: `accountForChange`, `withBalances`, `todayFor` (accounts application), `accountDto`.
- Produces: `restoreAccount(account: Account): Account` (domain; `archivedAt: null`, the same object when already active); `type RestoreAccount = (input: { spaceId: string; userId: string; accountId: string }) => Promise<Result<AccountView>>` and `createRestoreAccount(deps: AccountsDeps): RestoreAccount`; `Container.accounts.restoreAccount`; operation `restoreAccount` answering `200` with the `Account` schema, `401 Unauthenticated`, `403 InsufficientRole`, `404 SpaceNotFound, AccountNotFound`, `409 SpaceArchived`. Task 13 calls it.

- [ ] **Step 1: Write the failing tests**

`src/modules/accounts/domain/account.test.ts`, inside the archive tests' describe (import `archiveAccount` and `restoreAccount` next to `openAccount`):

```ts
it("restores an archived account and leaves an active one as it is (ruling P123)", () => {
  const account = unwrap(open({ name: "Nequi", type: "CASH" }));
  const archived = archiveAccount(account, new Date("2026-10-20T12:00:00Z"));
  expect(restoreAccount(archived)).toEqual({ ...archived, archivedAt: null });
  expect(restoreAccount(account)).toBe(account);
});
```

`src/modules/accounts/application/manage-accounts.test.ts`: add `restore: createRestoreAccount(deps),` to `setup()`'s result (import from `./restore-account`) and, after the archive test:

```ts
it("restores an archived account, which lists as active again (ruling P123)", async () => {
  const { archive, restore, list } = setup();
  await archive({ ...asAna, accountId: "acc-nequi" });
  expect(unwrap(await restore({ ...asAna, accountId: "acc-nequi" })).archivedAt).toBeNull();
  const active = unwrap(await list({ ...asAna, includeArchived: false })).items;
  expect(active.map((a) => a.name)).toEqual(["Bancolombia", "Nequi"]);
  expect(codeOf(await restore({ ...asAna, accountId: "acc-davivienda" }))).toBe("AccountNotFound");
});
```

`tests/acceptance/accounts.test.ts`: import `POST as restoreAccount` from `@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/restore/route`; in "corrects the opening balance, keeps the type, archives and filters archived accounts", after the line `expect((await accountCall(getAccount, "GET", ana, nequi)).status).toBe(200);` add:

```ts
    const restored = await accountCall(restoreAccount, "POST", ana, nequi, undefined, "/restore");
    expect([restored.status, (await restored.json()).archivedAt]).toEqual([200, null]);
    expect((await list(ana)).body.items.map((a: AccountDto) => a.name)).toEqual(["Bancolombia", "Nequi"]);
    const juan = await registerUser("Juan");
    const foreign = await call(restoreAccount, "POST", `/api/v1/spaces/${ana.spaceId}/accounts/${nequi.id}/restore`, {
      user: juan,
      params: { spaceId: ana.spaceId, accountId: nequi.id },
    });
    expect([foreign.status, (await foreign.json()).code]).toEqual([404, "SpaceNotFound"]);
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/accounts` and `pnpm exec vitest run --project acceptance tests/acceptance/accounts.test.ts`
Expected: FAIL — `restoreAccount` is not exported / `Cannot find module …/restore/route`.

- [ ] **Step 3: Implement**

`src/modules/accounts/domain/account.ts`, after `archiveAccount`:

```ts
/** Ruling P123: an archived account takes movements again; its history never changed. */
export const restoreAccount = (account: Account): Account =>
  account.archivedAt === null ? account : { ...account, archivedAt: null };
```

`src/modules/accounts/application/restore-account.ts` is `archive-account.ts` with `RestoreAccount`, `createRestoreAccount` and `restoreAccount(target.value.account)` in place of `archiveAccount(target.value.account, deps.clock.now())`. Export it from `application/index.ts` after the line `export { createArchiveAccount, type ArchiveAccount } from "./archive-account";`. In `src/composition/container.ts`, import `createRestoreAccount` and `type RestoreAccount` beside the archive ones, add `readonly restoreAccount: RestoreAccount;` after `readonly archiveAccount: ArchiveAccount;` and `restoreAccount: createRestoreAccount(accountsDeps),` after `archiveAccount: createArchiveAccount(accountsDeps),`. The route is the archive route calling `restoreAccount`. In `accounts.contract.ts`, after the `"/api/v1/spaces/{spaceId}/accounts/{accountId}/archive"` entry, add the same entry for `"/api/v1/spaces/{spaceId}/accounts/{accountId}/restore"` with `operationId: "restoreAccount"`, `summary: "Restore an archived account; it takes new movements again"` and `"200": one("The restored account")`.

- [ ] **Step 4: Run the tests, regenerate the snapshot, run the gates**

Run: Step 2's commands, `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` (one new operation, no new component), then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/accounts "src/app/api/v1/spaces/[spaceId]/accounts/[accountId]/restore/route.ts" \
  src/composition/container.ts tests/acceptance/accounts.test.ts openapi/openapi.snapshot.json
git commit -m "feat(accounts): restore an archived account (Refs #71)"
```

---

### Task 3: The installation's default time zone and language in the profile

HU-E9-13's "Reset" of the time zone and of the language "stores the installation's value", and its "Default" label needs that value, but `GET /api/v1/me` answers only the formats' defaults. `preferences.defaults` gains `timezone` (`APP_TIMEZONE`) and `locale` (`"es"`, the built-in language until HU-E8-18 stores one) (ruling P124).

**Files:**
- Modify: `src/modules/identity/application/profile.ts`, `src/modules/identity/application/profile.test.ts`, `src/modules/identity/contracts/me.contract.ts`, `src/composition/container.ts`, `tests/acceptance/formatting-preferences.test.ts`, `openapi/openapi.snapshot.json`

**Interfaces:**
- Produces: `ProfileView.preferences.defaults: FormatPreferences & { readonly timezone: string; readonly locale: Locale }`; `createGetProfile(deps: { profiles; rules; regionDefaults: { readonly timezone: string; readonly locale: Locale } })`. On the wire `preferences.defaults.timezone` (string) and `preferences.defaults.locale` (`"es" | "en"`). Task 11b reads them.

- [ ] **Step 1: Write the failing tests**

`src/modules/identity/application/profile.test.ts`: in `world()` pass `regionDefaults: { timezone: "America/Bogota", locale: "es" }` to `createGetProfile`; in the expectation that holds `defaults: RULES,` replace that line with `defaults: { ...RULES, timezone: "America/Bogota", locale: "es" },`.

`tests/acceptance/formatting-preferences.test.ts`: widen the local `defaults: Formats;` to `defaults: Formats & { timezone: string; locale: string };` and replace `expect(preferences).toEqual({ stored: NONE, effective: RULES, defaults: RULES, locked: [] });` with:

```ts
    expect(preferences).toEqual({
      stored: NONE,
      effective: RULES,
      defaults: { ...RULES, timezone: "America/Bogota", locale: "es" },
      locked: [],
    });
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/identity/application/profile.test.ts` and `pnpm exec vitest run --project acceptance tests/acceptance/formatting-preferences.test.ts`
Expected: FAIL — `defaults` has no `timezone` or `locale`.

- [ ] **Step 3: Implement**

In `profile.ts`, type `defaults` as above (import `type Locale` from `../domain/preferences`), add `readonly regionDefaults: { readonly timezone: string; readonly locale: Locale };` to `createGetProfile`'s deps and answer `defaults: { ...rules.defaults, ...deps.regionDefaults }`. In `me.contract.ts`, replace `defaults: Formats,` with `defaults: Formats.extend({ timezone: z.string(), locale: z.enum(LOCALES) }),`. In `container.ts`, replace `getProfile: createGetProfile({ profiles, rules: installationRules }),` with:

```ts
      // HU-E9-13, ruling P124: the installation's zone and, until HU-E8-18 stores one, its built-in language.
      getProfile: createGetProfile({
        profiles,
        rules: installationRules,
        regionDefaults: { timezone: env.APP_TIMEZONE, locale: "es" },
      }),
```

- [ ] **Step 4: Run the tests, regenerate the snapshot, run the gates**

Run: Step 2's commands, `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` (two properties under `getMe` and `updateMe`), then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity src/composition/container.ts tests/acceptance/formatting-preferences.test.ts \
  openapi/openapi.snapshot.json
git commit -m "feat(identity): answer the installation's default time zone and language in the profile (Refs #111)"
```

---

### Task 4a: The UI toolchain and its boundaries

Adds what every UI task needs and nothing else yet: Tailwind CSS through PostCSS, the `cn()` class helper, the Vitest `ui` project on jsdom with Testing Library and axe, the React hooks lint rules, and the dependency-cruiser rules that keep the UI on the API contract (ruling P119). The first atom (`VisuallyHidden`) proves the `ui` project end to end.

**Files:**
- Create: `postcss.config.mjs`, `src/shared/ui/cn.ts`, `src/shared/ui/cn.test.ts`, `src/shared/ui/atoms/visually-hidden.tsx`, `src/shared/ui/atoms/visually-hidden.test.tsx`, `tests/support/ui-setup.ts`, `tests/support/ui/axe.ts`, `tests/architecture/fixtures/web-imports-composition/src/app/(web)/page.ts`, `tests/architecture/fixtures/web-imports-composition/src/composition/container.ts`, `tests/architecture/fixtures/ui-imports-application/src/modules/ledger/ui/form.ts`, `tests/architecture/fixtures/ui-imports-application/src/modules/ledger/application/index.ts`, `tests/architecture/fixtures/ui-crosses-module-ui/src/modules/ledger/ui/form.ts`, `tests/architecture/fixtures/ui-crosses-module-ui/src/modules/categories/ui/picker.ts`, `tests/architecture/fixtures/ui-imports-kernel-barrel/src/shared/ui/money.ts`, `tests/architecture/fixtures/ui-imports-kernel-barrel/src/shared/kernel/index.ts`, `tests/architecture/fixtures/allowed/src/modules/ledger/ui/form.ts`, `tests/architecture/fixtures/allowed/src/modules/categories/ui/index.ts`, `tests/architecture/fixtures/allowed/src/shared/kernel/style.ts`
- Modify: `package.json`, `pnpm-lock.yaml`, `vitest.config.ts`, `eslint.config.mjs`, `tsconfig.json`, `.dependency-cruiser.cjs`, `tests/architecture/boundaries.test.ts`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` (clsx + tailwind-merge); `VisuallyHidden({ children }: { children: ReactNode })` (renders `<span className="sr-only">`); `axeViolations(root: Element): Promise<string[]>` (each `"<rule id>: <targets>"`; `color-contrast` and `region` off because jsdom has no layout and components render outside landmarks); the Vitest project `ui` (`src/**/*.test.tsx`, jsdom, `tests/support/ui-setup.ts`); dependency-cruiser rules `ui-talks-only-to-the-api`, `ui-modules-only-through-public-ui-api` and `only-ui-reaches-ui`.

- [ ] **Step 1: Install the toolchain**

```bash
pnpm add clsx@2.1.1 tailwind-merge@3.7.0
pnpm add -D tailwindcss@4.3.3 @tailwindcss/postcss@4.3.3 jsdom@30.1.2 @testing-library/react@16.3.3 \
  @testing-library/dom@10.4.2 @testing-library/user-event@14.6.7 @testing-library/jest-dom@7.0.1 \
  axe-core@4.13.0 eslint-plugin-react-hooks@7.1.1
```

Then check `package.json` holds exact versions (`pnpm check:pinned`). `pnpm` may warn that `jsdom` 30 wants Node `^24.15.0`: CI and `.nvmrc` use 24.21.0; a local host below 24.15 must upgrade (the `engines` floor stays, follow-up 9).

- [ ] **Step 2: Write the failing tests**

`src/shared/ui/cn.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins classes, drops falsy ones and lets the later Tailwind utility win", () => {
    const hidden: boolean = false;
    expect(cn("p-2 text-ink", hidden && "hidden", undefined, "p-4")).toBe("text-ink p-4");
  });
});
```

(The typed `hidden` keeps the falsy case: a literal `false && "hidden"` is an error under ESLint's `no-constant-binary-expression`.)

`src/shared/ui/atoms/visually-hidden.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { VisuallyHidden } from "./visually-hidden";

describe("VisuallyHidden", () => {
  it("names an icon-only control for assistive technology", async () => {
    const { container } = render(
      <button type="button">
        <svg aria-hidden="true" />
        <VisuallyHidden>Cerrar</VisuallyHidden>
      </button>,
    );
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});
```

In `tests/architecture/boundaries.test.ts`, add to the `it.each` table:

```ts
    ["web-imports-composition", "ui-talks-only-to-the-api"],
    ["ui-imports-application", "ui-talks-only-to-the-api"],
    ["ui-imports-kernel-barrel", "ui-talks-only-to-the-api"],
    ["ui-crosses-module-ui", "ui-modules-only-through-public-ui-api"],
```

The fixtures are one-line files with relative imports, like the existing ones: `web-imports-composition/src/app/(web)/page.ts` holds `import "../../composition/container";` and its `container.ts` holds `export const container = {};`; `ui-imports-application/src/modules/ledger/ui/form.ts` holds `import "../application/index";`; `ui-crosses-module-ui/src/modules/ledger/ui/form.ts` holds `import "../../categories/ui/picker";`; `ui-imports-kernel-barrel/src/shared/ui/money.ts` holds `import "../kernel/index";`. The `allowed` fixture gains `src/modules/ledger/ui/form.ts` with `import "../../categories/ui/index"; import "../../../shared/kernel/style";` plus the two targets (`export {};`).

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/shared/ui/cn.test.ts tests/architecture/boundaries.test.ts`
Expected: FAIL — `./cn` cannot be resolved, and the four new fixtures report no rule (the rules do not exist). `pnpm exec vitest run --project ui` reports `No projects matched the filter "ui"`.

- [ ] **Step 4: Add the project, the configs and the rules**

`vitest.config.ts`: after the `unit` project's closing `},` (the line after `exclude: ["src/**/*.int.test.ts"],` and its `},`) insert:

```ts
      {
        // Components and containers (HU-E9-*): jsdom, Testing Library and axe-core (ruling P132).
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./tests/support/ui-setup.ts"],
        },
      },
```

`tests/support/ui-setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
```

`tests/support/ui/axe.ts`:

```ts
import axe from "axe-core";

/**
 * The axe-core violations under `root`, as "<rule>: <targets>". jsdom computes no layout, so contrast is left to the
 * e2e scans in a real browser (light and dark); components render outside landmarks here, so `region` is off too.
 */
export const axeViolations = async (root: Element): Promise<string[]> => {
  const result = await axe.run(root, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
};
```

`src/shared/ui/cn.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind classes joined, falsy ones dropped, conflicting utilities resolved in favour of the later one. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
```

`src/shared/ui/atoms/visually-hidden.tsx`:

```tsx
import type { ReactNode } from "react";

/** Text for assistive technology only (Tailwind's `sr-only`): the name of an icon-only control. */
export function VisuallyHidden({ children }: { readonly children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
```

`postcss.config.mjs`:

```js
/** Tailwind CSS 4 through PostCSS, as Next.js loads it (globals.css: Task 7a). */
export default { plugins: { "@tailwindcss/postcss": {} } };
```

`tsconfig.json`: after the line `"tests/**/*.ts",` add `"tests/**/*.tsx",`.

`eslint.config.mjs`: add `import reactHooks from "eslint-plugin-react-hooks";` after the `tseslint` import, and after the `**/*.{ts,tsx}` block add:

```js
  {
    // HU-E9-*: the Rules of Hooks for components and hooks (ruling P136; eslint-config-next does not support ESLint 10).
    files: ["src/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat.recommended,
  },
```

(`.ts` too, because hooks such as `use-problem-message.ts` (Task 5b) and `use-idempotency-key.ts` (Task 17a) are `.ts`; only under `src/`, so a Playwright fixture's `use()` in `tests/e2e/**/*.ts` is never read as a hook.)

`.dependency-cruiser.cjs`: in `modules-only-through-public-application-api`, replace `to: { path: "^src/modules/(?!$1/)[^/]+/", pathNot: "^src/modules/[^/]+/application/index\\.ts$" },` with:

```js
      to: {
        path: "^src/modules/(?!$1/)[^/]+/",
        pathNot: ["^src/modules/[^/]+/application/index\\.ts$", "^src/modules/[^/]+/ui/index\\.ts$"],
      },
```

and insert before the line `    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },`:

```js
    {
      name: "ui-talks-only-to-the-api",
      severity: "error",
      comment:
        "Ruling P119: the web pages, the proxy, i18n and every ui folder reach the backend only over /api/v1 through the generated client: never a module's domain, application, infrastructure or contracts, the composition root, the API routes, the HTTP or infrastructure layers or server-only packages; of the kernel only time-zone.ts, local-date.ts and style.ts.",
      from: {
        path: ["^src/app/\\(web\\)/", "^src/i18n/", "^src/proxy\\.ts$", "^src/shared/ui/", "^src/modules/[^/]+/ui/"],
      },
      to: {
        path: [
          "^src/modules/[^/]+/(domain|application|infrastructure|contracts)/",
          "^src/composition/",
          "^src/app/api/",
          "^src/shared/(http|infrastructure)/",
          "^src/shared/kernel/(?!(time-zone|local-date|style)\\.ts$)",
          "node_modules/(drizzle-orm|pg|better-auth|@better-auth|zod-openapi|zod)/",
        ],
      },
    },
    {
      name: "ui-modules-only-through-public-ui-api",
      severity: "error",
      comment:
        "A module's ui reaches another module's ui only through src/modules/<module>/ui/index.ts, and the web pages reach every module only through it.",
      from: { path: ["^src/modules/([^/]+)/ui/", "^src/app/\\(web\\)/"] },
      to: { path: "^src/modules/[^/]+/ui/", pathNot: ["^src/modules/[^/]+/ui/index\\.ts$", "^src/modules/$1/ui/"] },
    },
    {
      name: "only-ui-reaches-ui",
      severity: "error",
      comment: "Server layers never import a ui folder: the UI depends on the API, never the other way round.",
      from: { path: "^src/modules/[^/]+/(domain|application|infrastructure|contracts)/" },
      to: { path: "^src/modules/[^/]+/ui/" },
    },
```

- [ ] **Step 5: Run the tests and the gates**

Run: `pnpm exec vitest run --project unit src/shared/ui tests/architecture`, `pnpm exec vitest run --project ui`, then every gate.
Expected: PASS; `pnpm lint:boundaries` reports no violation on `src/`.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml postcss.config.mjs vitest.config.ts eslint.config.mjs tsconfig.json \
  .dependency-cruiser.cjs src/shared/ui tests/support/ui-setup.ts tests/support/ui tests/architecture
git commit -m "build(web): add the UI toolchain, the ui test project and the UI boundary rules (Refs #69)"
```

---

### Task 4b: The generated API client

The UI's only way to the backend (ruling P117): TypeScript types generated from `openapi/openapi.snapshot.json` by `openapi-typescript` (committed, checked in CI like `db:check`, ruling P139), a tiny `openapi-fetch` client for the browser and for Server Components, the problem reader and the fake API every container test uses.

**Files:**
- Create: `scripts/api-types.mjs`, `scripts/api-types.test.mjs`, `src/shared/ui/api/schema.d.ts` (generated), `src/shared/ui/api/client.ts`, `src/shared/ui/api/dto.ts`, `src/shared/ui/api/problem.ts`, `src/shared/ui/api/problem.test.ts`, `src/shared/ui/api/session.ts`, `src/shared/ui/api/server.ts`, `src/shared/ui/api/server.test.ts`, `tests/support/ui/fake-api.ts`, `tests/support/ui/fake-api.test.ts`, `tests/support/ui/dto.ts`
- Modify: `package.json`, `pnpm-lock.yaml`, `.prettierignore`, `eslint.config.mjs`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces:
  - `pnpm api:types` (writes `src/shared/ui/api/schema.d.ts`) and `pnpm api:check` (fails when the file differs from what the snapshot generates); `generatedTypes(snapshotPath: string): Promise<string>` exported by `scripts/api-types.mjs`.
  - `client.ts`: `type Api = Client<paths>`; `createApi(options: { baseUrl: string; headers?: Record<string, string>; fetch?: (request: Request) => Promise<Response> }): Api` (every request `cache: "no-store"`); `browserApi(): Api` (same origin; client code only).
  - `dto.ts`: `MeDto`, `SpaceDto`, `SpaceListDto`, `AccountDto`, `AccountListDto`, `TransactionDto`, `TransactionPageDto`, `CategoryGroupDto`, `CategoryDto`, `PeriodDto`, `MoneyDto`, `ProblemDto`, read from `paths` and `components` (for example `MeDto = paths["/api/v1/me"]["get"]["responses"][200]["content"]["application/json"]`).
  - `problem.ts`: `interface Problem { readonly code: string; readonly status: number; readonly requestId: string | null; readonly errors: readonly { path: string; message: string }[]; readonly field: string | null }`; `problemFrom(error: unknown, response: Response | undefined): Problem` (a problem body keeps its code; anything else is `Unknown`, with the `x-request-id` header when there is one and `status` 0 without a response).
  - `session.ts`: `SESSION_COOKIES = ["hearth.session_token", "__Secure-hearth.session_token"]`, `hasSession(cookies: { has(name: string): boolean }): boolean`.
  - `server.ts` (Server Components only): `internalOrigin(env?): string` (`INTERNAL_API_ORIGIN`, else `http://127.0.0.1:${PORT ?? 3000}`); `forwardedHeaders(incoming: Headers): Record<string, string>` (`cookie`, `x-forwarded-for` or `x-real-ip` as `x-forwarded-for`, `accept-language`); `serverApi(): Promise<Api>` (React `cache`, one per request); `type Outcome<T> = { kind: "ok"; data: T } | { kind: "unauthenticated" } | { kind: "missing" } | { kind: "problem"; problem: Problem }`; `outcomeOf<T>(result: { data?: T; error?: unknown; response: Response }): Outcome<T>`; `type Loaded<T> = { ok: true; data: T } | { ok: false; problem: Problem }`; `loaded<T>(call: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<Loaded<T>>` (401 → `redirect` to the sign-in screen with `next` from the `x-hearth-path` request header; 404 → `notFound()`; a rejected call → `Unknown`); `getMe(): Promise<MeDto | null>` and `getSpaces(): Promise<SpaceDto[]>` (React `cache`; `getMe` is null on 401).
  - Test support: `fakeApi(routes: Record<string, FakeHandler>): { api: Api; requests: Request[] }` with keys like `"GET /api/v1/spaces/{spaceId}/accounts"` and `type FakeHandler = (request: Request, params: Record<string, string>) => Response | Promise<Response>`; `jsonResponse(body: unknown, status?: number): Response`; `problemResponse(status: number, code: string, extra?: Record<string, unknown>): Response`; DTO builders `meDto(overrides?)`, `spaceDto(overrides?)`, `cop(pesos: number): MoneyDto` (more builders join in later tasks).

- [ ] **Step 1: Install and generate**

```bash
pnpm add openapi-fetch@0.17.0
pnpm add -D openapi-typescript@7.13.0
```

`openapi-typescript` 7.13.0 declares `typescript ^5.x` as a peer; Hearth uses 6.0.3. pnpm only warns (no `strict-peer-dependencies`); Step 5 proves the generated file type-checks with 6.0.3 (risk 3).

- [ ] **Step 2: Write the failing tests**

`scripts/api-types.test.mjs` (unit project, which already includes `scripts/**/*.test.mjs`):

```js
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generatedTypes } from "./api-types.mjs";

describe("api:types", () => {
  it("generates the committed client types from the snapshot, headed as generated", async () => {
    const generated = await generatedTypes("openapi/openapi.snapshot.json");
    expect(generated.startsWith("// Generated by scripts/api-types.mjs")).toBe(true);
    expect(generated).toContain('"/api/v1/spaces/{spaceId}/accounts/{accountId}/restore"');
    expect(generated).toBe(readFileSync("src/shared/ui/api/schema.d.ts", "utf8"));
  });
});
```

`src/shared/ui/api/problem.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { problemFrom } from "./problem";

const response = (status: number, requestId?: string) =>
  new Response(null, { status, headers: requestId ? { "x-request-id": requestId } : {} });

describe("problemFrom (HU-E9-02)", () => {
  it("keeps the code, request id, field errors and public field of a problem body", () => {
    const body = {
      type: "urn:hearth:problem:ValidationFailed",
      title: "Unprocessable Content",
      status: 422,
      code: "ValidationFailed",
      requestId: "req-1",
      errors: [{ path: "amount.amount", message: "Amount must be an integer string in minor units" }],
    };
    expect(problemFrom(body, response(422, "req-1"))).toEqual({
      code: "ValidationFailed",
      status: 422,
      requestId: "req-1",
      errors: [{ path: "amount.amount", message: "Amount must be an integer string in minor units" }],
      field: null,
    });
    expect(problemFrom({ ...body, code: "AccountAttributeNotAllowed", field: "monthlyRate" }, response(409)).field).toBe(
      "monthlyRate",
    );
  });

  it("reads anything else as Unknown, with the request id when the response has one", () => {
    expect(problemFrom("<html>502 Bad Gateway</html>", response(502, "req-2"))).toEqual({
      code: "Unknown",
      status: 502,
      requestId: "req-2",
      errors: [],
      field: null,
    });
    expect(problemFrom(new TypeError("Failed to fetch"), undefined)).toEqual({
      code: "Unknown",
      status: 0,
      requestId: null,
      errors: [],
      field: null,
    });
  });
});
```

`src/shared/ui/api/server.test.ts` (Node; `next/headers` and `next/navigation` are not loaded by the functions under test, so `vi.mock` them to empty modules at the top):

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({}));
const { forwardedHeaders, internalOrigin, outcomeOf } = await import("./server");

describe("server reads (ruling P117)", () => {
  it("calls the API over loopback unless INTERNAL_API_ORIGIN says otherwise", () => {
    expect(internalOrigin({})).toBe("http://127.0.0.1:3000");
    expect(internalOrigin({ PORT: "3100" })).toBe("http://127.0.0.1:3100");
    expect(internalOrigin({ INTERNAL_API_ORIGIN: "http://app:3000", PORT: "3100" })).toBe("http://app:3000");
  });

  it("forwards only the cookie, the client address and the language", () => {
    const incoming = new Headers({
      cookie: "hearth.session_token=abc",
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
      "accept-language": "es-CO,es;q=0.9",
      authorization: "Bearer leak",
      host: "hearth.example.com",
    });
    expect(forwardedHeaders(incoming)).toEqual({
      cookie: "hearth.session_token=abc",
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
      "accept-language": "es-CO,es;q=0.9",
    });
    expect(forwardedHeaders(new Headers({ "x-real-ip": "203.0.113.9" }))).toEqual({ "x-forwarded-for": "203.0.113.9" });
  });

  it("sorts an answer into ok, unauthenticated, missing or problem", () => {
    expect(outcomeOf({ data: { id: "s1" }, response: new Response(null, { status: 200 }) })).toEqual({
      kind: "ok",
      data: { id: "s1" },
    });
    expect(outcomeOf({ error: { code: "Unauthenticated" }, response: new Response(null, { status: 401 }) }).kind).toBe(
      "unauthenticated",
    );
    expect(outcomeOf({ error: { code: "SpaceNotFound" }, response: new Response(null, { status: 404 }) }).kind).toBe(
      "missing",
    );
    expect(
      outcomeOf({
        error: { code: "SpaceArchived", status: 409, requestId: "r", title: "", type: "" },
        response: new Response(null, { status: 409 }),
      }),
    ).toMatchObject({ kind: "problem", problem: { code: "SpaceArchived", requestId: "r" } });
  });
});
```

`tests/support/ui/fake-api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeApi, jsonResponse, problemResponse } from "./fake-api";

describe("fakeApi", () => {
  it("routes typed calls by method and path template and records the requests", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/accounts": (request, params) =>
        jsonResponse({ items: [], totals: { available: { amount: "0", currency: "COP" }, netWorth: { amount: "0", currency: "COP" } }, echo: params.spaceId }),
      "POST /api/v1/auth/sign-in": () => problemResponse(401, "InvalidCredentials"),
    });
    const accounts = await api.GET("/api/v1/spaces/{spaceId}/accounts", {
      params: { path: { spaceId: "s1" }, query: { archived: "true" } },
    });
    expect(accounts.data).toMatchObject({ echo: "s1" });
    expect(new URL(requests[0]!.url).search).toBe("?archived=true");
    const signIn = await api.POST("/api/v1/auth/sign-in", { body: { email: "a@example.com", password: "x" } });
    expect(signIn.error).toMatchObject({ code: "InvalidCredentials" });
    await expect(api.GET("/api/v1/me")).rejects.toThrow("No fake route for GET /api/v1/me");
  });
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm exec vitest run --project unit scripts/api-types.test.mjs src/shared/ui/api tests/support/ui`
Expected: FAIL — the modules do not exist.

- [ ] **Step 4: Implement**

`scripts/api-types.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const SNAPSHOT = "openapi/openapi.snapshot.json";
const TARGET = "src/shared/ui/api/schema.d.ts";
const HEADER = "// Generated by scripts/api-types.mjs from openapi/openapi.snapshot.json. Do not edit: run pnpm api:types.\n";

/** Ruling P139: the UI's client types, generated from the reviewed snapshot (never from a running server). */
export const generatedTypes = async (snapshot = SNAPSHOT) =>
  HEADER + astToString(await openapiTS(JSON.parse(readFileSync(snapshot, "utf8"))));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const generated = await generatedTypes();
  if (process.argv.includes("--check")) {
    if (readFileSync(TARGET, "utf8") !== generated) {
      console.error(`${TARGET} is out of date with ${SNAPSHOT}: run "pnpm api:types" and commit the result.`);
      process.exit(1);
    }
    console.log(`${TARGET} matches ${SNAPSHOT}.`);
  } else {
    writeFileSync(TARGET, generated);
    console.log(`Wrote ${TARGET}.`);
  }
}
```

`package.json` scripts, after `"check:pinned": …`: `"api:types": "node scripts/api-types.mjs",` and `"api:check": "node scripts/api-types.mjs --check",`. Run `pnpm api:types` once and commit its output. `.prettierignore` gains `src/shared/ui/api/schema.d.ts`; `eslint.config.mjs`'s `globalIgnores` gains `"src/shared/ui/api/schema.d.ts",`. `.github/workflows/ci.yml`: in the `lint` job, after `      - run: pnpm db:check` add `      - run: pnpm api:check`.

`src/shared/ui/api/client.ts`:

```ts
import createClient, { type Client } from "openapi-fetch";
import type { paths } from "./schema";

/** Ruling P117: the one client of /api/v1, typed by the generated `paths`. */
export type Api = Client<paths>;

export const createApi = (options: {
  readonly baseUrl: string;
  readonly headers?: Record<string, string>;
  readonly fetch?: (request: Request) => Promise<Response>;
}): Api =>
  createClient<paths>({ baseUrl: options.baseUrl, headers: options.headers, fetch: options.fetch, cache: "no-store" });

/** In the browser: same origin, the session cookie travels by itself. Call it from client code only. */
export const browserApi = (): Api => createApi({ baseUrl: globalThis.location?.origin ?? "" });
```

`problem.ts` implements `problemFrom`: a plain object whose `code` is a non-empty string is a problem (take `status` from the body, else the response; `requestId` from the body, else `x-request-id`; `errors` an array or `[]`; `field` a string or `null`); otherwise `{ code: "Unknown", status: response?.status ?? 0, requestId: response?.headers.get("x-request-id") ?? null, errors: [], field: null }`.

`session.ts` exports `SESSION_COOKIES` and `hasSession` as in the Interfaces (Better Auth names its cookie with the `hearth` prefix, and with `__Secure-` over HTTPS).

`server.ts` starts with `import { cookies, headers } from "next/headers";`, `import { notFound, redirect } from "next/navigation";` and `import { cache } from "react";`, and implements the Interfaces block: `serverApi` builds `createApi({ baseUrl: internalOrigin(), headers: forwardedHeaders(await headers()) })`; `loaded` awaits the call inside `try` (a rejection becomes `problemFrom(error, undefined)`), then maps `outcomeOf`: `unauthenticated` → `redirect("/sign-in?next=" + encodeURIComponent((await headers()).get("x-hearth-path") ?? "/"))`, `missing` → `notFound()`; `getMe` skips the call and answers `null` when `hasSession(await cookies())` is false; `getSpaces` returns `items` of `GET /api/v1/spaces` through `loaded` and throws on a problem (the shell cannot render without spaces). Its header comment: `// Server Components only: it reads the request's headers. Client code uses browserApi().`

`dto.ts` declares the aliases of the Interfaces block (types only).

`tests/support/ui/fake-api.ts`: `fakeApi` builds `createApi({ baseUrl: "http://hearth.test", fetch })` where `fetch` records the `Request`, matches `"<METHOD> <pathname>"` against each key (template segments `{name}` become `([^/]+)` and name the `params`), calls the handler, and throws `new Error(\`No fake route for ${method} ${pathname}\`)` when none matches. `jsonResponse` and `problemResponse` set `content-type` (`application/json`, `application/problem+json`) and `x-request-id: req-test`; a problem body is `{ type: \`urn:hearth:problem:${code}\`, title: "", status, code, requestId: "req-test", ...extra }`.

`tests/support/ui/dto.ts`: `cop(pesos)` → `{ amount: String(pesos * 100), currency: "COP" }` (string arithmetic is safe for test amounts); `meDto()` → Ana (`id "u-ana"`, `locale "es"`, `timezone "America/Bogota"`, every stored format `null`, effective and defaults the built-in rules, defaults with `timezone "America/Bogota"` and `locale "es"`, `locked []`); `spaceDto()` → `{ id: "sp-personal", name: "Personal", kind: "PERSONAL", currency: "COP", periodPolicy: { kind: "MONTHLY", day: 1 }, role: "OWNER" }`. Both take a partial override.

- [ ] **Step 5: Run the tests and the gates**

Run: Step 3's command, `pnpm api:check`, `pnpm exec tsc --noEmit` (the generated file type-checks under TypeScript 6.0.3), then every gate.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml scripts/api-types.mjs scripts/api-types.test.mjs src/shared/ui/api \
  tests/support/ui .prettierignore eslint.config.mjs .github/workflows/ci.yml
git commit -m "feat(web): generate the API client from the OpenAPI snapshot (Refs #69)"
```

---

### Task 5a: Spanish by default, English on demand

HU-E9-02's language half, first commit: `next-intl` picks `es` or `en` texts (ruling P120) from the stored locale, the visitor cookie or the browser, the catalogs start with the `common` namespace, and the test wrapper every component test uses throws on a missing message (scenario "Signed-in user preference wins"). Task 5b adds the `errors` namespace and the catalog check. Preflight A measured Task 5 whole at 570 changed lines, so it is planned as two commits at this boundary (about 150 | 420), each green on its own.

**Files:**
- Create: `src/i18n/locale.ts`, `src/i18n/locale.test.ts`, `src/i18n/request.ts`, `src/i18n/global.d.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`, `tests/support/ui/render.tsx`
- Modify: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `next.config.ts`

**Interfaces:**
- Consumes: `getMe()`, `hasSession()` (Task 4b).
- Produces: `LOCALES = ["es", "en"]`, `type Locale`, `DEFAULT_LOCALE = "es"`, `LOCALE_COOKIE = "hearth.locale"`, `resolveLocale(input: { userLocale?: string | null; cookieLocale?: string | null; acceptLanguage?: string | null }): Locale`; `IntlWrapper(locale: Locale)` and `renderWithIntl(ui: ReactElement, options?: { locale?: Locale }): RenderResult` (missing messages throw). Message namespaces: `common` (here), `errors` (Task 5b), `auth` (Task 8a), `shell` (Task 9), `settings` (Task 11a), `accounts` (Task 12), `ledger` (Task 14), `categories` (Task 15), `home` (Task 17b).

- [ ] **Step 1: Install**

`pnpm add next-intl@4.14.9`

`next-intl` 4.14.9 depends on `@swc/core` 1.16.18 and `@parcel/watcher` 2.6.0, which both have install scripts; pnpm 12 ends every install with `Ignored build scripts: @parcel/watcher@2.6.0, @swc/core@1.16.18` and **exit code 1** (printed after `+ next-intl 4.14.9`, so it is easy to miss), which would fail every CI job's and the Dockerfile's `pnpm install --frozen-lockfile`. Their builds serve only next-intl's message extraction, which Hearth does not use, and both ship prebuilt binaries, so deny them. In `pnpm-workspace.yaml`, under `allowBuilds:`, before the line `  esbuild: true`, add:

```yaml
  "@parcel/watcher": false
  "@swc/core": false
```

Then `pnpm install --frozen-lockfile; echo $?` prints `0`.

- [ ] **Step 2: Write the failing test**

`src/i18n/locale.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveLocale } from "./locale";

describe("resolveLocale (HU-E9-02, ruling P120)", () => {
  it("lets the signed-in user's stored locale win over the cookie and the browser", () => {
    expect(resolveLocale({ userLocale: "en", cookieLocale: "es", acceptLanguage: "es-CO,es;q=0.9" })).toBe("en");
  });

  it("then takes the visitor's cookie, then the first supported browser language by weight", () => {
    expect(resolveLocale({ cookieLocale: "en", acceptLanguage: "es-CO" })).toBe("en");
    expect(resolveLocale({ acceptLanguage: "en-US,en;q=0.8" })).toBe("en");
    expect(resolveLocale({ acceptLanguage: "de-DE, fr;q=0.9, en;q=0.5" })).toBe("en");
    expect(resolveLocale({ acceptLanguage: "en;q=0.4, es;q=0.6" })).toBe("es");
  });

  it("falls back to Spanish for no supported preference and ignores unsupported stored values", () => {
    expect(resolveLocale({ acceptLanguage: "fr-FR,fr;q=0.9" })).toBe("es");
    expect(resolveLocale({ acceptLanguage: null })).toBe("es");
    expect(resolveLocale({ userLocale: "pt", cookieLocale: "xx", acceptLanguage: "en" })).toBe("en");
  });
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `pnpm exec vitest run --project unit src/i18n`
Expected: FAIL — `Cannot find module './locale'`.

- [ ] **Step 4: Implement**

`src/i18n/locale.ts`:

```ts
/** HU-E9-02: the interface languages; a language never sets a format (D23). Mirrors identity's LOCALES. */
export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";
/** Ruling P120: a visitor's choice on the sign-in and sign-up screens. */
export const LOCALE_COOKIE = "hearth.locale";

const supported = (value: string | null | undefined): Locale | null =>
  (LOCALES as readonly string[]).includes(value ?? "") ? (value as Locale) : null;

/** The first supported language of an Accept-Language header, by weight then order. */
const fromAcceptLanguage = (header: string | null | undefined): Locale | null =>
  (header ?? "")
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { language: tag.toLowerCase().split("-")[0] ?? "", weight: q ? Number(q.slice(2)) : 1, index };
    })
    .filter((entry) => entry.weight > 0 && supported(entry.language) !== null)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map((entry) => entry.language as Locale)[0] ?? null;

/** HU-E9-02, ruling P120: the stored locale, then the visitor cookie, then Accept-Language, then Spanish. */
export const resolveLocale = (input: {
  readonly userLocale?: string | null;
  readonly cookieLocale?: string | null;
  readonly acceptLanguage?: string | null;
}): Locale =>
  supported(input.userLocale) ?? supported(input.cookieLocale) ?? fromAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE;
```

`src/i18n/request.ts`:

```ts
import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getMe } from "@/shared/ui/api/server";
import { hasSession } from "@/shared/ui/api/session";
import { LOCALE_COOKIE, resolveLocale } from "./locale";

/** HU-E9-02, ruling P120: no locale in the URL; the signed-in user's stored locale wins. */
export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const me = hasSession(cookieStore) ? await getMe() : null;
  const locale = resolveLocale({
    userLocale: me?.locale,
    cookieLocale: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get("accept-language"),
  });
  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
    // next-intl's own formatting is never used (ruling P121); the zone only keeps it from warning.
    timeZone: me?.timezone ?? "America/Bogota",
  };
});
```

`src/i18n/global.d.ts`:

```ts
import type messages from "./messages/es.json";
import type { Locale } from "./locale";

// Typed keys: a message used in code but missing from es.json fails `tsc --noEmit`.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
```

`next.config.ts`:

```ts
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl({
  output: "standalone",
  poweredByHeader: false,
} satisfies NextConfig);
```

`tests/support/ui/render.tsx` exports `IntlWrapper(locale: Locale)` (a component rendering `NextIntlClientProvider` with `locale`, that locale's catalog, `timeZone="America/Bogota"` and `onError={(error) => { throw error; }}`) and `renderWithIntl(ui, { locale = "es" } = {})` (`render(ui, { wrapper: IntlWrapper(locale) })`).

The catalogs: both files hold the same keys, and for now only `common`: `appName` ("Hearth" in both), `save` (Guardar / Save), `cancel` (Cancelar / Cancel), `back` (Volver / Back), `close` (Cerrar / Close), `retry` (Reintentar / Try again), `loading` (Cargando… / Loading…), `default` (Predeterminado / Default), `reset` (Restablecer / Reset).

- [ ] **Step 5: Run the tests and the gates**

Run: Step 3's command, `pnpm install --frozen-lockfile` (exits 0), `pnpm build` (the plugin finds `src/i18n/request.ts`; no page exists yet, so the build only proves the config), then every gate.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml next.config.ts src/i18n tests/support/ui/render.tsx
git commit -m "feat(web): pick the interface language, Spanish by default (Refs #70)"
```

---

### Task 5b: Every error code translated, and the catalog check

HU-E9-02's language half, second commit: the catalogs hold a message for every error code of the OpenAPI document, `useProblemMessage` shows it (or `errors.Unknown` with the request id), and `pnpm i18n:check` blocks a merge when a key is missing in one catalog or a code has no message (scenarios "API error codes are translated, with a fallback", "A missing key blocks the merge").

**Files:**
- Create: `src/shared/ui/api/use-problem-message.ts`, `src/shared/ui/api/use-problem-message.test.tsx`, `scripts/i18n-check.mjs`, `scripts/i18n-check.test.mjs`
- Modify: `src/i18n/messages/es.json`, `src/i18n/messages/en.json`, `package.json`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `Problem` (Task 4b); `IntlWrapper` (Task 5a).
- Produces: `useProblemMessage(): (problem: Problem) => { message: string; reference: string | null }`; `pnpm i18n:check`; `checkCatalogs(input: { es: object; en: object; openapi: object }): string[]` and `errorCodesOf(openapi: object): string[]` from `scripts/i18n-check.mjs`; the `errors` namespace.

- [ ] **Step 1: Write the failing tests**

`src/shared/ui/api/use-problem-message.test.tsx`:

```tsx
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlWrapper } from "../../../../tests/support/ui/render";
import { useProblemMessage } from "./use-problem-message";

const problem = (code: string, requestId: string | null = "req-9") => ({
  code,
  status: 403,
  requestId,
  errors: [],
  field: null,
});

describe("useProblemMessage (HU-E9-02)", () => {
  it("translates a known code in the user's language", () => {
    const { result } = renderHook(() => useProblemMessage(), { wrapper: IntlWrapper("es") });
    expect(result.current(problem("InsufficientRole"))).toEqual({
      message: "No tienes permiso para hacer esto en este espacio.",
      reference: null,
    });
  });

  it("shows errors.Unknown with the request id for a code without a key", () => {
    const es = renderHook(() => useProblemMessage(), { wrapper: IntlWrapper("es") }).result.current;
    expect(es(problem("NoSuchCode"))).toEqual({
      message: "Algo salió mal. Intenta de nuevo.",
      reference: "Referencia: req-9",
    });
    const en = renderHook(() => useProblemMessage(), { wrapper: IntlWrapper("en") }).result.current;
    expect(en(problem("NoSuchCode", null))).toEqual({ message: "Something went wrong. Please try again.", reference: null });
  });
});
```

`scripts/i18n-check.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import { checkCatalogs, errorCodesOf } from "./i18n-check.mjs";

const openapi = {
  paths: {
    "/x": {
      post: {
        responses: {
          201: { description: "Created" },
          401: { description: "Not signed in" },
          409: { description: "OutstandingBalance (with the outstanding amount), SpaceArchived" },
          422: { description: "ValidationFailed (including the template, type, payer), InvalidAmount" },
        },
      },
    },
  },
};
const errors = (codes) => Object.fromEntries(codes.map((code) => [code, code]));

describe("i18n:check (HU-E9-02)", () => {
  it("reads every error code named in the 4xx and 5xx descriptions, plus the codes the UI always shows", () => {
    expect(errorCodesOf(openapi)).toEqual(["InternalError", "InvalidAmount", "OutstandingBalance", "SpaceArchived", "Unknown", "ValidationFailed"]);
  });

  it("fails naming the key missing in en", () => {
    const base = { errors: errors(errorCodesOf(openapi)) };
    const es = { ...base, ledger: { expense: { title: "Nuevo gasto" } } };
    expect(checkCatalogs({ es, en: base, openapi })).toEqual(["Missing in en: ledger.expense.title"]);
  });

  it("fails naming an error code without a message, and a key that is not a message", () => {
    const es = { errors: { ...errors(errorCodesOf(openapi)), SpaceArchived: undefined }, common: { save: 3 } };
    const en = { errors: errors(errorCodesOf(openapi)), common: { save: "Save" } };
    expect(checkCatalogs({ es, en, openapi })).toEqual([
      "Not a message in es: common.save",
      "Missing in es: errors.SpaceArchived",
    ]);
  });

  it("passes when both catalogs hold the same messages and every code", () => {
    const both = { errors: errors(errorCodesOf(openapi)) };
    expect(checkCatalogs({ es: both, en: both, openapi })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit scripts/i18n-check.test.mjs` and `pnpm exec vitest run --project ui src/shared/ui/api`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Implement**

`src/shared/ui/api/use-problem-message.ts` (`"use client"`): with `const t = useTranslations("errors")`, answer `t.has(code) ? t(code) : t("Unknown")` as the message (cast the dynamic key: `code as "Unknown"`) and `reference` = `t("reference", { requestId })` only when the code has no key and `requestId` is not null. A code with its own key never shows the reference (the code tells the person what to do).

The `errors` namespace, in both catalogs after `common`: one message per code `errorCodesOf` returns (the 118 named in the snapshot plus `Unknown` and `InternalError`: 120 keys) and `reference` (`Referencia: {requestId}` / `Reference: {requestId}`). Copy rules: Spanish of Colombia with "tú", English plain; one short sentence saying what happened and, when it helps, what to do; never the code, a stack or a field path. **Every code gets real copy in both languages, never a placeholder**: the table below is the copy to write (the first eight rows are fixed by the design and the stories; the others are derived from each code's meaning in its domain module and the backlog's error catalogue). If `pnpm i18n:check` names a code the table lacks (a snapshot changed since this plan), write its copy the same way: read where the code is raised (`rg '"<Code>"' src/modules src/shared`) and the backlog's catalogue entry, then say what happened in the person's terms.

| Key | es | en |
|---|---|---|
| `errors.InsufficientRole` | No tienes permiso para hacer esto en este espacio. | You do not have permission to do this in this space. |
| `errors.Unknown` | Algo salió mal. Intenta de nuevo. | Something went wrong. Please try again. |
| `errors.EmailTaken` | Ya existe una cuenta con este correo. | An account with this email already exists. |
| `errors.InvalidCredentials` | El correo o la contraseña no coinciden. | The email or the password does not match. |
| `errors.PasswordTooShort` | La contraseña debe tener al menos 8 caracteres. | The password must have at least 8 characters. |
| `errors.InvalidAmount` | El monto debe ser mayor que cero. | The amount must be greater than zero. |
| `errors.TooManyRequests` | Demasiados intentos. Espera unos minutos e intenta de nuevo. | Too many attempts. Wait a few minutes and try again. |
| `errors.ValidationFailed` | Revisa los datos marcados. | Check the highlighted fields. |
| `errors.AccountArchived` | Esta cuenta está archivada. Restáurala para registrar movimientos en ella. | This account is archived. Restore it to record transactions in it. |
| `errors.AccountAttributeNotAllowed` | Este tipo de cuenta no lleva ese dato. | This account type does not take that detail. |
| `errors.AccountNameTaken` | Ya hay una cuenta con ese nombre en este espacio. | There is already an account with that name in this space. |
| `errors.AccountNotFound` | No encontramos esa cuenta. | That account was not found. |
| `errors.AccountNotInSpace` | Esa cuenta no pertenece a este espacio. | That account does not belong to this space. |
| `errors.AccountNotOwned` | Solo el dueño de esa cuenta puede registrar movimientos con ella. | Only the owner of that account can record transactions with it. |
| `errors.AccountRequired` | Elige la cuenta con la que se pagó. | Choose the account it was paid from. |
| `errors.AccountTypeImmutable` | El tipo de una cuenta no se puede cambiar. | An account's type cannot be changed. |
| `errors.AlreadyMember` | Esa persona ya es miembro de este espacio. | That person is already a member of this space. |
| `errors.BudgetLineNameTaken` | Ya hay una línea con ese nombre en este plan. | There is already a line with that name in this plan. |
| `errors.BudgetLineNotFound` | No encontramos esa línea del plan. | That plan line was not found. |
| `errors.BudgetPlanNotFound` | No encontramos ese plan. | That plan was not found. |
| `errors.CatchAllLineAlreadySet` | Este plan ya tiene una línea para todo lo demás. | This plan already has a line for everything else. |
| `errors.CategoryAlreadyMapped` | Esa categoría ya está en otra línea del plan. | That category is already in another line of the plan. |
| `errors.CategoryArchived` | Esta categoría está archivada. Elige otra o restáurala. | This category is archived. Choose another one or restore it. |
| `errors.CategoryDepthExceeded` | Las categorías admiten como máximo tres niveles. | Categories allow at most three levels. |
| `errors.CategoryGroupArchived` | Este grupo de categorías está archivado. Restáuralo primero. | This category group is archived. Restore it first. |
| `errors.CategoryGroupNameTaken` | Ya hay un grupo con ese nombre. | There is already a group with that name. |
| `errors.CategoryGroupNotFound` | No encontramos ese grupo de categorías. | That category group was not found. |
| `errors.CategoryInUse` | Esta categoría tiene subcategorías o movimientos. Archívala en lugar de borrarla. | This category has subcategories or transactions. Archive it instead of deleting it. |
| `errors.CategoryNameTaken` | Ya hay una categoría con ese nombre aquí. | There is already a category with that name here. |
| `errors.CategoryNotFound` | No encontramos esa categoría. | That category was not found. |
| `errors.CategoryNotInSpace` | Esa categoría no pertenece a este espacio. | That category does not belong to this space. |
| `errors.CategoryRequired` | Elige una categoría. | Choose a category. |
| `errors.CurrencyMismatch` | El monto debe estar en la moneda del espacio. | The amount must be in the space's currency. |
| `errors.DateTimeMismatch` | La fecha no coincide con la hora elegida. Revisa la fecha y la hora. | The date does not match the chosen time. Check the date and the time. |
| `errors.DirectSpaceIsFull` | Un espacio entre dos personas no admite a nadie más. | A space between two people cannot take anyone else. |
| `errors.DirectSpaceMembersFixed` | Los miembros de un espacio entre dos personas no cambian. Archívalo si ya no lo usan. | The members of a space between two people do not change. Archive it if you no longer use it. |
| `errors.GuestAlreadyClaimed` | Este lugar de invitado ya fue reclamado. | This guest place has already been claimed. |
| `errors.GuestHasNoAccounts` | Un invitado no tiene cuentas: quita la cuenta de su pago. | A guest has no accounts: remove the account from their payment. |
| `errors.GuestHasNoRole` | Los invitados no tienen rol en el espacio. | Guests have no role in the space. |
| `errors.IdempotencyKeyConflict` | Este envío ya se hizo con otros datos. Intenta de nuevo. | This submission was already made with other data. Please try again. |
| `errors.InternalError` | Tuvimos un problema de nuestro lado. Intenta de nuevo en unos minutos. | Something went wrong on our side. Try again in a few minutes. |
| `errors.InvalidAccountName` | El nombre de la cuenta debe tener entre 1 y 60 caracteres. | The account name must have 1 to 60 characters. |
| `errors.InvalidAllocation` | El reparto de esta línea no cuadra. Revisa los porcentajes o los montos. | This line's allocation does not add up. Check the percentages or the amounts. |
| `errors.InvalidBillingDay` | Los días de corte y de pago van del 1 al 31. | The cut-off and payment days go from 1 to 31. |
| `errors.InvalidBudgetLineName` | El nombre de la línea debe tener entre 1 y 60 caracteres. | The line name must have 1 to 60 characters. |
| `errors.InvalidCapacity` | La capacidad de cada miembro debe ser cero o más, y cada miembro va una sola vez. | Each member's capacity must be zero or more, and each member appears once. |
| `errors.InvalidCategoryIcon` | Ese ícono no está disponible. Elige otro. | That icon is not available. Choose another one. |
| `errors.InvalidCategoryName` | El nombre debe tener entre 1 y 60 caracteres. | The name must have 1 to 60 characters. |
| `errors.InvalidCreditLimit` | El cupo debe ser mayor que cero. | The credit limit must be greater than zero. |
| `errors.InvalidCursor` | La lista cambió. Recarga la página para seguir. | The list has changed. Reload the page to continue. |
| `errors.InvalidDate` | Esa fecha no es válida. | That date is not valid. |
| `errors.InvalidDescription` | La descripción puede tener hasta 200 caracteres. | The description can have up to 200 characters. |
| `errors.InvalidDirectCounterpart` | No puedes dividir un gasto contigo ni con un invitado de otro espacio. | You cannot split an expense with yourself or with a guest of another space. |
| `errors.InvalidEmail` | Escribe un correo válido. | Enter a valid email address. |
| `errors.InvalidFundAccount` | Esa cuenta no es un fondo compartido. | That account is not a shared fund. |
| `errors.InvalidIdempotencyKey` | No pudimos enviar esto. Recarga la página e intenta de nuevo. | This could not be sent. Reload the page and try again. |
| `errors.InvalidInvitationRole` | Elige un rol válido para la invitación. | Choose a valid role for the invitation. |
| `errors.InvalidMemberName` | El nombre debe tener entre 1 y 100 caracteres. | The name must have 1 to 100 characters. |
| `errors.InvalidOccurrenceDate` | La fecha debe estar dentro del periodo de este movimiento programado. | The date must be within the period of this scheduled transaction. |
| `errors.InvalidPassword` | La contraseña no es válida. Usa entre 8 y 128 caracteres. | The password is not valid. Use 8 to 128 characters. |
| `errors.InvalidPeriodLabel` | Ese periodo no es válido. | That period is not valid. |
| `errors.InvalidPeriodPolicy` | La forma de contar los periodos no es válida. | The period setting is not valid. |
| `errors.InvalidPlanTransition` | El plan no puede pasar a ese estado ahora. | The plan cannot move to that state now. |
| `errors.InvalidPlannedAmount` | El monto planeado no es válido. | The planned amount is not valid. |
| `errors.InvalidRate` | La tasa debe estar entre 0 % y 100 %. | The rate must be between 0% and 100%. |
| `errors.InvalidRecurrence` | Revisa la programación: la fecha final no puede ser antes del inicio y debe quedar al menos una fecha. | Check the schedule: the end date cannot be before the start, and at least one date must remain. |
| `errors.InvalidRecurrenceTransition` | Este movimiento recurrente no puede pasar a ese estado ahora. | This recurring transaction cannot move to that state now. |
| `errors.InvalidSavingsAccount` | Elige solo tus cuentas de ahorro, cada una una sola vez. | Choose only your own savings accounts, each one once. |
| `errors.InvalidSettlementParties` | Quien paga y quien recibe deben ser personas distintas. | The payer and the receiver must be different people. |
| `errors.InvalidSpaceName` | El nombre del espacio debe tener entre 1 y 80 caracteres. | The space name must have 1 to 80 characters. |
| `errors.InvalidSplit` | Revisa cómo se divide el gasto. | Check how the expense is split. |
| `errors.InvalidTerm` | El plazo del crédito debe ser de al menos un mes. | The loan term must be at least one month. |
| `errors.InvalidTermDeposit` | Un CDT necesita el plazo y la fecha de vencimiento, los dos juntos. | A term deposit needs both the term and the maturity date. |
| `errors.InvalidTimeZone` | Esa zona horaria no es válida. | That time zone is not valid. |
| `errors.InvitationAlreadyUsed` | Esta invitación ya se usó. | This invitation has already been used. |
| `errors.InvitationEmailMismatch` | Esta invitación es para otro correo. | This invitation is for another email address. |
| `errors.InvitationExpired` | Esta invitación venció. Pide una nueva. | This invitation has expired. Ask for a new one. |
| `errors.InvitationNotFound` | No encontramos esta invitación. | This invitation was not found. |
| `errors.InvitationRevoked` | Esta invitación fue cancelada. | This invitation was revoked. |
| `errors.LastOwnerRequired` | El espacio necesita al menos un propietario. Nombra otro primero. | The space needs at least one owner. Name another one first. |
| `errors.MemberNameTaken` | Ya hay un miembro con ese nombre en este espacio. | There is already a member with that name in this space. |
| `errors.MemberNotFound` | No encontramos a esa persona en el espacio. | That person was not found in the space. |
| `errors.MixedFundPayment` | Un gasto pagado con el fondo no puede tener otros pagos. | An expense paid from the fund cannot have other payments. |
| `errors.NoPreviousPlan` | No hay un plan anterior para copiar. | There is no previous plan to copy. |
| `errors.NotAGuest` | Esa persona no es un invitado. | That person is not a guest. |
| `errors.NotASpaceMember` | Esa persona no es miembro de este espacio. | That person is not a member of this space. |
| `errors.OccurrenceNotFound` | No encontramos ese movimiento programado. | That scheduled transaction was not found. |
| `errors.OccurrenceNotPending` | Ese movimiento programado ya se registró o se omitió. | That scheduled transaction was already recorded or skipped. |
| `errors.OutstandingBalance` | Quedan saldos pendientes. Sáldalos antes de continuar. | There are outstanding balances. Settle them before continuing. |
| `errors.ParentCategoryArchived` | La categoría superior está archivada. Restáurala primero. | The parent category is archived. Restore it first. |
| `errors.ParticipantsRequired` | Elige al menos una persona para dividir el gasto. | Choose at least one person to split the expense with. |
| `errors.PaymentsRequired` | Indica quién pagó el gasto. | Say who paid the expense. |
| `errors.PeriodClosed` | Ese periodo está cerrado. Elige una fecha de un periodo abierto. | That period is closed. Choose a date in an open period. |
| `errors.PeriodNotOver` | El periodo aún no termina. Podrás cerrar el plan después de su último día. | The period is not over yet. You can close the plan after its last day. |
| `errors.PersonalAccountRequiresPersonalSpace` | Este tipo de cuenta solo existe en tu espacio personal. | This account type exists only in your personal space. |
| `errors.PersonalSpaceAlreadyExists` | Ya tienes un espacio personal. | You already have a personal space. |
| `errors.PersonalSpaceNotArchivable` | Tu espacio personal no se puede archivar. | Your personal space cannot be archived. |
| `errors.PersonalSpaceNotShareable` | Tu espacio personal es solo tuyo y no se puede compartir. | Your personal space is yours alone and cannot be shared. |
| `errors.PlanAlreadyExists` | Ya hay un plan para ese periodo. | There is already a plan for that period. |
| `errors.PlanExceedsCapacity` | Lo planeado supera la capacidad de los miembros. | The plan exceeds the members' capacity. |
| `errors.PreconditionFailed` | Alguien cambió esto mientras lo editabas. Recarga para ver la última versión. | Someone changed this while you were editing it. Reload to see the latest version. |
| `errors.PreferenceLocked` | La instalación fija este ajuste y no se puede cambiar. | The installation fixes this setting, so it cannot be changed. |
| `errors.RecurrenceEnded` | Este movimiento recurrente ya terminó y no se puede cambiar. | This recurring transaction has ended and cannot be changed. |
| `errors.RecurrenceNotFound` | No encontramos ese movimiento recurrente. | That recurring transaction was not found. |
| `errors.SameAccountTransfer` | Elige cuentas de origen y destino distintas. | Choose different source and destination accounts. |
| `errors.SavingsAccountAlreadyUsed` | Esa cuenta de ahorro ya está en otra línea del plan. | That savings account is already in another line of the plan. |
| `errors.SavingsAccountRequired` | Una línea de ahorro necesita al menos una cuenta de ahorro. | A savings line needs at least one savings account. |
| `errors.SavingsLineNotMappable` | Una línea de ahorro no lleva categorías. | A savings line does not take categories. |
| `errors.SettlementHasNoCategory` | Un pago entre personas no lleva categoría. | A settlement between people has no category. |
| `errors.SharedFundRequiresSharedSpace` | Un fondo compartido solo existe en un espacio compartido. | A shared fund exists only in a shared space. |
| `errors.SharesDoNotMatchAmount` | Los pagos y las partes deben sumar el monto total. | The payments and the shares must add up to the total amount. |
| `errors.SpaceArchived` | Este espacio está archivado y no admite cambios. | This space is archived and does not take changes. |
| `errors.SpaceCurrencyLocked` | La moneda del espacio ya no se puede cambiar: tiene movimientos o un plan. | The space's currency can no longer change: it has transactions or a plan. |
| `errors.SpaceNotFound` | No encontramos ese espacio, o ya no eres miembro. | That space was not found, or you are no longer a member. |
| `errors.SubcategoryNotMappable` | Las subcategorías no se asignan al plan: asigna su categoría. | Subcategories are not mapped to the plan: map their category. |
| `errors.TimeRequired` | La hora no se puede quitar. Elige otra si quieres cambiarla. | The time cannot be removed. Choose another one to change it. |
| `errors.TransactionNotFound` | No encontramos ese movimiento. | That transaction was not found. |
| `errors.TransferHasNoCategory` | Una transferencia no lleva categoría. | A transfer has no category. |
| `errors.Unauthenticated` | Tu sesión terminó. Inicia sesión de nuevo. | Your session has ended. Sign in again. |
| `errors.UnknownCurrency` | Esa moneda no está disponible. | That currency is not available. |

(Write the keys in each catalog in alphabetical order, then `reference`, so the two files diff line by line.)

`scripts/i18n-check.mjs`:

```js
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Codes the UI shows whatever the document says: the fallback and the server failure. */
const ALWAYS = ["InternalError", "Unknown"];

/**
 * Ruling P120: the error codes an operation can answer, read from its 4xx and 5xx descriptions ("AccountArchived,
 * SpaceArchived (…)"): parentheticals dropped, then every comma-separated PascalCase word; prose ("Not signed in") is not
 * a code.
 */
export const errorCodesOf = (openapi) => {
  const codes = new Set(ALWAYS);
  for (const operations of Object.values(openapi.paths ?? {}))
    for (const operation of Object.values(operations))
      for (const [status, response] of Object.entries(operation.responses ?? {}))
        if (Number(status) >= 400)
          for (const part of String(response.description ?? "").replace(/\([^)]*\)/g, "").split(","))
            if (/^[A-Z][A-Za-z]+$/.test(part.trim())) codes.add(part.trim());
  return [...codes].sort();
};

const leaves = (node, prefix = "") =>
  Object.entries(node ?? {}).flatMap(([key, value]) =>
    value !== null && typeof value === "object" ? leaves(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]],
  );

/** Every problem with the two catalogs: a key missing in one, a leaf that is not a string, an error code without a message. */
export const checkCatalogs = ({ es, en, openapi }) => {
  const catalogs = { es: new Map(leaves(es)), en: new Map(leaves(en)) };
  const keys = new Set([...catalogs.es.keys(), ...catalogs.en.keys(), ...errorCodesOf(openapi).map((c) => `errors.${c}`)]);
  const problems = [];
  for (const key of [...keys].sort())
    for (const [name, catalog] of Object.entries(catalogs)) {
      const value = catalog.get(key);
      if (value === undefined) problems.push(`Missing in ${name}: ${key}`);
      else if (typeof value !== "string") problems.push(`Not a message in ${name}: ${key}`);
    }
  return problems;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = (path) => JSON.parse(readFileSync(path, "utf8"));
  const problems = checkCatalogs({
    es: read("src/i18n/messages/es.json"),
    en: read("src/i18n/messages/en.json"),
    openapi: read("openapi/openapi.snapshot.json"),
  });
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log("Both catalogs hold the same keys and every error code has a message.");
}
```

(`leaves` reports an `undefined` value as a leaf, so the second test sees `errors.SpaceArchived` missing in `es`.) `package.json` scripts gain `"i18n:check": "node scripts/i18n-check.mjs",`; `.github/workflows/ci.yml`'s `lint` job gains `      - run: pnpm i18n:check` after `      - run: pnpm api:check`.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, `pnpm i18n:check` ("Both catalogs hold the same keys and every error code has a message."), then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json src/i18n/messages src/shared/ui/api/use-problem-message.ts \
  src/shared/ui/api/use-problem-message.test.tsx scripts/i18n-check.mjs scripts/i18n-check.test.mjs \
  .github/workflows/ci.yml
git commit -m "feat(web): translate every error code into es and en and check the catalogs in CI (Refs #70)"
```

---

### Task 6: Formats from the preferences, never from the language

HU-E9-02's format half (scenario outline "Numbers, dates and times follow the user's preferences, not the language"): one `formatters` module takes the preferences as arguments and never reads a locale (ruling P121), time helpers turn instants into the wall-clock of a zone and step a time, and an architecture test fails on any UI file that formats with `Intl` or `toLocale*` outside that module.

**Files:**
- Create: `src/shared/ui/format/currencies.ts`, `src/shared/ui/format/formatters.ts`, `src/shared/ui/format/formatters.test.ts`, `src/shared/ui/format/zones.ts`, `src/shared/ui/format/zones.test.ts`, `src/shared/ui/time/when.ts`, `src/shared/ui/time/when.test.ts`, `src/shared/ui/time/server-now.ts`, `src/shared/ui/time/server-now.test.ts`, `tests/architecture/ui-formatting.test.ts`

**Interfaces:**
- Consumes: `localDateIn`, `wallTimeIn`, `instantAt` from `@/shared/kernel/time-zone`; `addDays`, `partsOf`, `daysInMonth`, `type LocalDate` from `@/shared/kernel/local-date`.
- Produces:
  - `formatters.ts`: `type NumberFormat = "DOT_COMMA" | "COMMA_DOT" | "SPACE_COMMA"`, `type DateFormat = "DMY" | "MDY" | "YMD"`, `type TimeFormat = "H24" | "H12"`, `type WeekStart = "MONDAY" | "SUNDAY"`, `interface Formats { numberFormat; dateFormat; timeFormat; weekStart }`, `BUILT_IN_FORMATS` (`DOT_COMMA`, `DMY`, `H24`, `MONDAY`), `interface Wall { readonly hour: number; readonly minute: number }`, `formatNumber(decimal: string, f): string`, `decimalOf(minor: string, exponent: number): string`, `formatMoney(money: { amount: string; currency: string }, f): string`, `formatDate(isoDate: string, f): string`, `formatTime(wall: Wall, f): string`, `formatTimeAt(instantIso: string, timeZone: string, f): string`, `NBSP = " "`, `MINUS = "−"`.
  - `currencies.ts`: `currencyOf(code: string): { symbol: string; exponent: number }` (COP `$`, USD `US$`, EUR `€`, exponent 2; an unknown code shows itself with exponent 2).
  - `zones.ts`: `browserTimeZone(): string`, `allTimeZones(): string[]` (`Intl.supportedValuesOf("timeZone")`), `zoneCity(zone: string): string` (`"America/Bogota"` → `"Bogota"`, underscores as spaces), `zoneOffset(zone: string, at: Date): string` (`"GMT-5"`).
  - `when.ts`: `nowIn(now: Date, timeZone: string): { date: LocalDate; wall: Wall }`, `relativeDay(date: string, today: string): "today" | "yesterday" | "dayBeforeYesterday" | null`, `stepMinutes(wall: Wall, delta: 5 | -5): Wall`, `stepHour(wall: Wall, delta: 1 | -1): Wall`, `withHalf(wall: Wall, half: "AM" | "PM"): Wall`, `occurredAtOf(date: string, wall: Wall, timeZone: string): string` (ISO instant), `monthGrid(year: number, month: number, weekStart: WeekStart): (LocalDate | null)[]`.
  - `server-now.ts`: `serverNow(env?: Record<string, string | undefined>): Date` (`HEARTH_E2E_FIXED_NOW` when set, ruling P133; else the system clock).

- [ ] **Step 1: Write the failing tests**

`src/shared/ui/format/formatters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BUILT_IN_FORMATS, decimalOf, formatDate, formatMoney, formatNumber, formatTime, formatTimeAt, type Formats } from "./formatters";

const norm = (text: string) => text.replace(/\s/g, " ");
const formats = (numberFormat: Formats["numberFormat"], dateFormat: Formats["dateFormat"], timeFormat: Formats["timeFormat"]): Formats => ({
  numberFormat,
  dateFormat,
  timeFormat,
  weekStart: "MONDAY",
});

describe("formatters (HU-E9-02 outline, ruling P121): the preferences, never the language", () => {
  // The outline's three rows; the locale column is absent on purpose: no formatter takes one.
  it.each([
    ["DOT_COMMA", "DMY", "H24", "$ 1.600.000", "5/10/2026", "14:30"],
    ["COMMA_DOT", "MDY", "H12", "$ 1,600,000", "10/5/2026", "2:30 PM"],
    ["DOT_COMMA", "DMY", "H24", "$ 1.600.000", "5/10/2026", "14:30"],
  ] as const)("%s %s %s → %s, %s, %s", (numberFormat, dateFormat, timeFormat, amount, date, time) => {
    const f = formats(numberFormat, dateFormat, timeFormat);
    expect(norm(formatMoney({ amount: "160000000", currency: "COP" }, f))).toBe(amount);
    expect(formatDate("2026-10-05", f)).toBe(date);
    expect(norm(formatTime({ hour: 14, minute: 30 }, f))).toBe(time);
  });

  it("writes the other patterns of the story", () => {
    expect(norm(formatNumber("1234567.89", formats("SPACE_COMMA", "DMY", "H24")))).toBe("1 234 567,89");
    expect(formatNumber("1234567.89", BUILT_IN_FORMATS)).toBe("1.234.567,89");
    expect(formatNumber("1234567.89", formats("COMMA_DOT", "DMY", "H24"))).toBe("1,234,567.89");
    expect(formatDate("2026-10-05", formats("DOT_COMMA", "YMD", "H24"))).toBe("2026/10/5");
    expect(formatDate("2026-10-16", BUILT_IN_FORMATS)).toBe("16/10/2026");
  });

  it("drops a zero fraction, keeps another one whole and puts the minus before the symbol", () => {
    expect(norm(formatMoney({ amount: "123456789", currency: "COP" }, BUILT_IN_FORMATS))).toBe("$ 1.234.567,89");
    expect(norm(formatMoney({ amount: "123456780", currency: "COP" }, BUILT_IN_FORMATS))).toBe("$ 1.234.567,80");
    expect(norm(formatMoney({ amount: "-35000000", currency: "COP" }, BUILT_IN_FORMATS))).toBe("−$ 350.000");
    expect(norm(formatMoney({ amount: "0", currency: "COP" }, BUILT_IN_FORMATS))).toBe("$ 0");
    expect(norm(formatMoney({ amount: "1250", currency: "USD" }, formats("COMMA_DOT", "MDY", "H12")))).toBe("US$ 12.50");
    expect(decimalOf("5", 2)).toBe("0.05");
    expect(decimalOf("-922337203685477580", 2)).toBe("-9223372036854775.80");
  });

  it("writes 24-hour times with two-digit hours and 12-hour times with AM and PM", () => {
    expect(formatTime({ hour: 8, minute: 10 }, BUILT_IN_FORMATS)).toBe("08:10");
    const twelve = formats("DOT_COMMA", "DMY", "H12");
    expect(norm(formatTime({ hour: 0, minute: 5 }, twelve))).toBe("12:05 AM");
    expect(norm(formatTime({ hour: 12, minute: 0 }, twelve))).toBe("12:00 PM");
    expect(norm(formatTime({ hour: 19, minute: 0 }, twelve))).toBe("7:00 PM");
  });

  it("reads an instant on the clock of the record's own zone", () => {
    expect(formatTimeAt("2026-11-01T04:30:00Z", "America/Bogota", BUILT_IN_FORMATS)).toBe("23:30");
    expect(formatTimeAt("2026-11-01T04:30:00Z", "Europe/Madrid", BUILT_IN_FORMATS)).toBe("05:30");
  });
});
```

`src/shared/ui/format/zones.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { allTimeZones, zoneCity, zoneOffset } from "./zones";

describe("time zone labels (HU-E9-13)", () => {
  it("names a zone by its city and its offset at an instant", () => {
    expect(zoneCity("America/Bogota")).toBe("Bogota");
    expect(zoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(zoneOffset("America/Bogota", new Date("2026-10-16T12:00:00Z"))).toBe("GMT-5");
    expect(zoneOffset("UTC", new Date("2026-10-16T12:00:00Z"))).toBe("GMT");
  });

  it("lists the IANA zones the runtime knows, Bogotá among them", () => {
    expect(allTimeZones()).toContain("America/Bogota");
  });
});
```

`src/shared/ui/time/when.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { monthGrid, nowIn, occurredAtOf, relativeDay, stepHour, stepMinutes, withHalf } from "./when";

describe("time of a record (HU-E9-03, ruling P129)", () => {
  it("reads now on the zone's clock: 04:30Z is still 31 October in Bogotá", () => {
    expect(nowIn(new Date("2026-11-01T04:30:00Z"), "America/Bogota")).toEqual({
      date: "2026-10-31",
      wall: { hour: 23, minute: 30 },
    });
  });

  it("names today, yesterday and the day before yesterday, and nothing older or later", () => {
    expect(relativeDay("2026-10-31", "2026-10-31")).toBe("today");
    expect(relativeDay("2026-10-30", "2026-10-31")).toBe("yesterday");
    expect(relativeDay("2026-10-29", "2026-10-31")).toBe("dayBeforeYesterday");
    expect(relativeDay("2026-10-28", "2026-10-31")).toBeNull();
    expect(relativeDay("2026-11-01", "2026-10-31")).toBeNull();
  });

  it("steps minutes to the next multiple of five in the direction pressed, within the day", () => {
    expect(stepMinutes({ hour: 22, minute: 32 }, 5)).toEqual({ hour: 22, minute: 35 });
    expect(stepMinutes({ hour: 22, minute: 32 }, -5)).toEqual({ hour: 22, minute: 30 });
    expect(stepMinutes({ hour: 19, minute: 30 }, -5)).toEqual({ hour: 19, minute: 25 });
    expect(stepMinutes({ hour: 23, minute: 55 }, 5)).toEqual({ hour: 0, minute: 0 });
    expect(stepMinutes({ hour: 0, minute: 0 }, -5)).toEqual({ hour: 23, minute: 55 });
    expect(stepHour({ hour: 0, minute: 10 }, -1)).toEqual({ hour: 23, minute: 10 });
    expect(stepHour({ hour: 23, minute: 10 }, 1)).toEqual({ hour: 0, minute: 10 });
  });

  it("switches between AM and PM without touching the minutes", () => {
    expect(withHalf({ hour: 19, minute: 0 }, "AM")).toEqual({ hour: 7, minute: 0 });
    expect(withHalf({ hour: 7, minute: 0 }, "PM")).toEqual({ hour: 19, minute: 0 });
    expect(withHalf({ hour: 12, minute: 15 }, "PM")).toEqual({ hour: 12, minute: 15 });
  });

  it("turns a local date and time in a zone into the instant sent as occurredAt", () => {
    expect(occurredAtOf("2026-10-15", { hour: 19, minute: 0 }, "America/Bogota")).toBe("2026-10-16T00:00:00.000Z");
    expect(occurredAtOf("2026-10-31", { hour: 23, minute: 30 }, "America/Bogota")).toBe("2026-11-01T04:30:00.000Z");
  });

  it("lays a month out from the person's first weekday", () => {
    const monday = monthGrid(2026, 10, "MONDAY"); // 1 October 2026 is a Thursday
    expect(monday.slice(0, 4)).toEqual([null, null, null, "2026-10-01"]);
    expect(monday).toHaveLength(34);
    expect(monthGrid(2026, 10, "SUNDAY").slice(0, 5)).toEqual([null, null, null, null, "2026-10-01"]);
  });
});
```

`src/shared/ui/time/server-now.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { serverNow } from "./server-now";

describe("serverNow (ruling P133)", () => {
  it("is the e2e instant when HEARTH_E2E_FIXED_NOW is set, else the system clock", () => {
    expect(serverNow({ HEARTH_E2E_FIXED_NOW: "2026-11-01T04:30:00Z" }).toISOString()).toBe("2026-11-01T04:30:00.000Z");
    const before = Date.now();
    expect(serverNow({}).getTime()).toBeGreaterThanOrEqual(before);
  });
});
```

`tests/architecture/ui-formatting.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Ruling P121: the calls that format with a locale's defaults, and next-intl's formatter, which does too. */
const LOCALE_FORMATTING = /\b(toLocaleString|toLocaleDateString|toLocaleTimeString|Intl\.(NumberFormat|DateTimeFormat|RelativeTimeFormat|ListFormat)|useFormatter|getFormatter)\b/;
const ROOTS = ["src/app/(web)", "src/i18n", "src/shared/ui", "src/modules"];
const ALLOWED = /^src[\\/]shared[\\/]ui[\\/]format[\\/]/;

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

export const offendersIn = (paths: readonly string[], read: (path: string) => string): string[] =>
  paths.filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p) && !ALLOWED.test(p) && LOCALE_FORMATTING.test(read(p)));

describe("UI formatting (HU-E9-02)", () => {
  it("flags a component that formats with the locale's defaults", () => {
    const sources: Record<string, string> = {
      "src/modules/ledger/ui/row.tsx": "amount.toLocaleString('es-CO')",
      "src/shared/ui/format/formatters.ts": "new Intl.DateTimeFormat('en-US', { timeZone })",
      "src/modules/ledger/ui/ok.tsx": "formatMoney(money, formats)",
    };
    expect(offendersIn(Object.keys(sources), (p) => sources[p]!)).toEqual(["src/modules/ledger/ui/row.tsx"]);
  });

  it("finds no UI file outside src/shared/ui/format that formats with Intl or toLocale*", () => {
    const uiFiles = ROOTS.flatMap((root) => {
      try {
        return files(root);
      } catch {
        return [];
      }
    }).filter((p) => !p.startsWith(join("src", "modules")) || /[\\/]ui[\\/]/.test(p));
    expect(offendersIn(uiFiles, (p) => readFileSync(p, "utf8"))).toEqual([]);
  });
});
```

(It lives in `tests/architecture/`, which the unit project already includes.)

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/shared/ui/format src/shared/ui/time tests/architecture/ui-formatting.test.ts`
Expected: FAIL — the modules do not exist (the architecture test's second case already passes).

- [ ] **Step 3: Implement**

`src/shared/ui/format/currencies.ts` and `zones.ts` as in the Interfaces block (`browserTimeZone` is `Intl.DateTimeFormat().resolvedOptions().timeZone`). `zoneOffset`'s body is fixed, because Node 24's ICU 78 writes `GMT+0` for UTC, `Etc/UTC` and `Africa/Abidjan` where older ICU (and so browsers) write `GMT`; normalizing keeps server and browser renders identical:

```ts
/** The zone's offset at an instant, as "GMT-5" ("GMT" for UTC: ICU 78 and later write "GMT+0", older ones "GMT"). */
export const zoneOffset = (zone: string, at: Date): string => {
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;
  return !offset || offset === "GMT+0" ? "GMT" : offset;
};
```

`src/shared/ui/time/server-now.ts`:

```ts
/**
 * Ruling P133: "now" for a server render. The e2e run fixes it with HEARTH_E2E_FIXED_NOW, the same variable that fixes
 * the API's clock (Task 10), so the screens and the API agree on "today"; otherwise the system clock.
 */
export const serverNow = (env: Record<string, string | undefined> = process.env): Date =>
  env.HEARTH_E2E_FIXED_NOW ? new Date(env.HEARTH_E2E_FIXED_NOW) : new Date();
```

`src/shared/ui/format/formatters.ts` (the patterns are decisions, so the bodies are fixed here):

```ts
import { wallTimeIn } from "@/shared/kernel/time-zone";
import { currencyOf } from "./currencies";

export type NumberFormat = "DOT_COMMA" | "COMMA_DOT" | "SPACE_COMMA";
export type DateFormat = "DMY" | "MDY" | "YMD";
export type TimeFormat = "H24" | "H12";
export type WeekStart = "MONDAY" | "SUNDAY";
/** HU-E1-15: the effective preferences of `GET /api/v1/me`; the only input of every formatter (D23, ruling P121). */
export interface Formats {
  readonly numberFormat: NumberFormat;
  readonly dateFormat: DateFormat;
  readonly timeFormat: TimeFormat;
  readonly weekStart: WeekStart;
}
/** The installation's built-in rules (es-CO's formats), for screens without a signed-in person. */
export const BUILT_IN_FORMATS: Formats = { numberFormat: "DOT_COMMA", dateFormat: "DMY", timeFormat: "H24", weekStart: "MONDAY" };
export interface Wall {
  readonly hour: number;
  readonly minute: number;
}

/** A non-breaking space keeps "$ 1.600.000" and "2:30 PM" on one line; U+2212 is the typographic minus. */
export const NBSP = " ";
export const MINUS = "−";
const SEPARATORS: Readonly<Record<NumberFormat, readonly [group: string, point: string]>> = {
  DOT_COMMA: [".", ","],
  COMMA_DOT: [",", "."],
  SPACE_COMMA: [NBSP, ","],
};
const pad = (n: number) => String(n).padStart(2, "0");

/** "-1234567.89" → "−1.234.567,89"; a fraction of zeros is dropped, any other is kept whole. */
export const formatNumber = (decimal: string, f: Pick<Formats, "numberFormat">): string => {
  const negative = decimal.startsWith("-");
  const [whole = "0", fraction = ""] = decimal.replace(/^-/, "").split(".");
  const [group, point] = SEPARATORS[f.numberFormat];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${negative ? MINUS : ""}${grouped}${/^0*$/.test(fraction) ? "" : point + fraction}`;
};

/** Minor units as a decimal string, exactly (BigInt, never Number): ("5", 2) → "0.05". */
export const decimalOf = (minor: string, exponent: number): string => {
  const value = BigInt(minor);
  const digits = (value < 0n ? -value : value).toString().padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  return `${value < 0n ? "-" : ""}${whole}${exponent > 0 ? "." + digits.slice(digits.length - exponent) : ""}`;
};

/** "$ 1.600.000", "−$ 350.000": the currency's symbol, never the language's (P68). */
export const formatMoney = (money: { readonly amount: string; readonly currency: string }, f: Pick<Formats, "numberFormat">): string => {
  const { symbol, exponent } = currencyOf(money.currency);
  const text = formatNumber(decimalOf(money.amount, exponent), f);
  return text.startsWith(MINUS) ? `${MINUS}${symbol}${NBSP}${text.slice(1)}` : `${symbol}${NBSP}${text}`;
};

/** Numeric, with "/" and no leading zeros: 5/10/2026, 10/5/2026 or 2026/10/5. */
export const formatDate = (isoDate: string, f: Pick<Formats, "dateFormat">): string => {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (f.dateFormat === "DMY") return `${day}/${month}/${year}`;
  return f.dateFormat === "MDY" ? `${month}/${day}/${year}` : `${year}/${month}/${day}`;
};

/** "14:30" or "2:30 PM"; 24-hour times keep two-digit hours. */
export const formatTime = (wall: Wall, f: Pick<Formats, "timeFormat">): string =>
  f.timeFormat === "H24"
    ? `${pad(wall.hour)}:${pad(wall.minute)}`
    : `${wall.hour % 12 || 12}:${pad(wall.minute)}${NBSP}${wall.hour < 12 ? "AM" : "PM"}`;

/** The wall-clock time of an instant in a zone (the record's own, HU-E9-03). */
export const formatTimeAt = (instantIso: string, timeZone: string, f: Pick<Formats, "timeFormat">): string =>
  formatTime(wallTimeIn(new Date(instantIso), timeZone), f);
```

`src/shared/ui/time/when.ts` implements the Interfaces block on top of the kernel: `nowIn` with `localDateIn` and `wallTimeIn`; `relativeDay` compares with `addDays(today, -1)` and `addDays(today, -2)`; `stepMinutes` is the design's directional step — `const offset = wall.minute % 5; const step = offset === 0 ? delta : delta > 0 ? 5 - offset : -offset;` then `(hour * 60 + minute + step + 1440) % 1440` split back into hour and minute (the day never changes, ruling P129); `stepHour` adds ±1 modulo 24; `withHalf` adds or subtracts 12 only when the hour is in the other half; `occurredAtOf` is `instantAt(date, { ...wall, second: 0, millisecond: 0 }, timeZone).toISOString()`; `monthGrid` puts `(weekday of the 1st − first weekday + 7) % 7` nulls before the month's days, the weekday from `new Date(Date.UTC(year, month - 1, 1)).getUTCDay()` (0 = Sunday).

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's command, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ui/format src/shared/ui/time tests/architecture/ui-formatting.test.ts
git commit -m "feat(web): format amounts, dates and times from the preferences, never the language (Refs #70)"
```

---

### Task 7a: Design tokens, theme and icons

The approved canvas's visual language as code: the color tokens of the Home artboard (light and dark), the sixteen palette keys with their light tints and inks from the QuickAdd artboard and dark ones derived from them (ruling P135), the theme as a device setting applied before paint, and one icon registry: the 58 category symbols and the three account-only ones (paths copied verbatim from the QuickAdd and NewAccount artboards) plus the UI icons.

**Files:**
- Create: `src/app/(web)/globals.css`, `src/shared/ui/theme/theme.ts`, `src/shared/ui/theme/theme.test.ts`, `src/shared/ui/icons/symbols.ts`, `src/shared/ui/icons/symbols.test.ts`, `src/shared/ui/icons/ui-icons.ts`, `src/shared/ui/atoms/icon.tsx`, `src/shared/ui/atoms/icon.test.tsx`, `src/shared/ui/palette.ts`, `tests/architecture/palette-tokens.test.ts`

**Interfaces:**
- Consumes: `SYMBOLS`, `PALETTE`, `type SymbolName`, `type PaletteKey` (`@/shared/kernel/style`, Task 1).
- Produces: `THEME_KEY = "hearth.theme"`, `type Theme = "system" | "light" | "dark"`, `resolveTheme(theme: Theme, prefersDark: boolean): "light" | "dark"`, `readTheme(storage: Pick<Storage, "getItem"> | undefined): Theme` (anything unreadable is `"system"`), `saveTheme(theme: Theme): void` (writes `localStorage`, sets `document.documentElement.dataset.theme`), `THEME_BOOTSTRAP: string` (an inline script for `<head>`); `SYMBOL_PATHS: Readonly<Record<SymbolName, string>>`; `UI_ICONS` and `type UiIconName` (`back`, `chevronDown`, `chevronRight`, `plus`, `close`, `check`, `search`, `eye`, `home`, `list`, `sliders`, `signOut`, `lock`, `alert`, `calendar`); `Icon({ name: UiIconName; size?: number; className?: string })` and `SymbolIcon({ name: SymbolName; size?: number; className?: string })` (both `aria-hidden` SVGs, 24 × 24 view box, `currentColor` stroke 1.75, round caps and joins); `paletteVars(key: PaletteKey): CSSProperties` (`--tint` and `--ink` pointing at the key's tokens). CSS utilities used by later tasks: `bg-bg`, `bg-surface`, `border-line`, `text-ink`, `text-muted`, `bg-accent`, `text-on-accent`, `bg-accent-soft`, `text-danger`, `border-field`, `bg-track`, and the custom variant `dark:`.

- [ ] **Step 1: Write the failing tests**

`src/shared/ui/icons/symbols.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SYMBOLS } from "@/shared/kernel/style";
import { SYMBOL_PATHS } from "./symbols";

describe("the symbol registry (ruling P122)", () => {
  it("draws every symbol name the API accepts, and only those", () => {
    expect(Object.keys(SYMBOL_PATHS).sort()).toEqual([...SYMBOLS]);
    for (const path of Object.values(SYMBOL_PATHS)) expect(path).toMatch(/^[Mm]\d/);
  });
});
```

`src/shared/ui/theme/theme.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { readTheme, resolveTheme, saveTheme, THEME_BOOTSTRAP, THEME_KEY } from "./theme";

describe("theme (HU-E9-13, ruling P135)", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("follows the system unless the person chose light or dark", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("reads anything unknown or unreadable as system", () => {
    expect(readTheme({ getItem: () => "sepia" })).toBe("system");
    expect(readTheme({ getItem: () => { throw new Error("blocked"); } })).toBe("system");
    expect(readTheme(undefined)).toBe("system");
  });

  it("applies a saved choice before paint and on change", () => {
    saveTheme("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    delete document.documentElement.dataset.theme;
    new Function(THEME_BOOTSTRAP)();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
```

`src/shared/ui/atoms/icon.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SYMBOL_PATHS } from "../icons/symbols";
import { UI_ICONS } from "../icons/ui-icons";
import { Icon, SymbolIcon } from "./icon";

describe("Icon and SymbolIcon", () => {
  it("draws a decorative stroke icon from the registry", () => {
    const { container } = render(
      <>
        <Icon name="back" />
        <SymbolIcon name="cart" size={20} />
      </>,
    );
    const [back, cart] = [...container.querySelectorAll("svg")];
    expect(back).toHaveAttribute("aria-hidden", "true");
    expect(back?.querySelector("path")).toHaveAttribute("d", UI_ICONS.back);
    expect(cart).toHaveAttribute("width", "20");
    expect(cart?.querySelector("path")).toHaveAttribute("d", SYMBOL_PATHS.cart);
  });
});
```

`tests/architecture/palette-tokens.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PALETTE } from "@/shared/kernel/style";

describe("palette tokens (ruling P135)", () => {
  it("defines a tint and an ink for every palette key, in light and in dark", () => {
    const css = readFileSync("src/app/(web)/globals.css", "utf8");
    const [light = "", dark = ""] = css.split("/* dark palette */");
    for (const key of PALETTE.map((k) => k.toLowerCase())) {
      expect(light).toContain(`--pal-${key}-tint:`);
      expect(light).toContain(`--pal-${key}-ink:`);
      expect(dark).toContain(`--pal-${key}-tint:`);
      expect(dark).toContain(`--pal-${key}-ink:`);
    }
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/shared/ui/icons src/shared/ui/theme tests/architecture/palette-tokens.test.ts` and `pnpm exec vitest run --project ui src/shared/ui/atoms/icon.test.tsx`
Expected: FAIL — the modules and `globals.css` do not exist.

- [ ] **Step 3: Implement**

`src/shared/ui/icons/symbols.ts` — the paths are exact copy from the approved canvas (QuickAdd's `ICONS`, NewAccount's cash, wallet and investment icons):

```ts
import type { SymbolName } from "@/shared/kernel/style";

/** Ruling P122: every Hearth symbol as a 24 × 24 stroke path, from the approved Batch 1 canvas. */
export const SYMBOL_PATHS: Readonly<Record<SymbolName, string>> = {
  apple: "M12 7.5c-1.6-1.6-5-1.2-6 1.6-1.1 3.1.4 7.4 2.6 9.6 1.2 1.2 2.3 1 3.4.5 1.1.5 2.2.7 3.4-.5 2.2-2.2 3.7-6.5 2.6-9.6-1-2.8-4.4-3.2-6-1.6Zm0 0c0-2 1-3.5 3-4",
  bag: "M6 8h12l1 13H5L6 8Zm3 0V6a3 3 0 0 1 6 0v2",
  bank: "M3 10 12 4l9 6M5 10v8m4-8v8m6-8v8m4-8v8M3 21h18",
  basket: "M4 10h16l-1.5 9h-13L4 10Zm3 0 3-6m7 6-3-6M9 14v2m6-2v2",
  bike: "M3 16a3 3 0 1 0 6 0 3 3 0 1 0-6 0Zm12 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0ZM6 16l4-7h5l3 7M8.5 6H11",
  book: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm0 13a3 3 0 0 1 3-3h11",
  bread: "M4 14c0-4 3.6-7 8-7s8 3 8 7v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2Zm5-7v11m6-11v11",
  briefcase: "M4 8h16v11H4V8Zm5 0V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 13h16",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3Z",
  bus: "M6 17V7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v10M6 13h12M8 20v-3m8 3v-3",
  calendar: "M4 6h16v14H4V6Zm0 4h16M8 3v4m8-4v4",
  car: "M5 16v-4l2-5h10l2 5v4M4 12h16M5 16h14M5 16v2m14-2v2M7.5 14h.01M16.5 14h.01",
  card: "M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11ZM3 10h18M7 15h4",
  cart: "M5 8h14l-1.5 11h-11L5 8Zm4 0V6a3 3 0 0 1 6 0v2",
  cash: "M3 7h18v10H3V7Zm9 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  chart: "M4 20V4m0 16h16M8 16v-5m4 5V8m4 8v-3",
  coins: "M8 7c0 1.1 2 2 4.5 2S17 8.1 17 7s-2-2-4.5-2S8 5.9 8 7Zm0 0v4c0 1.1 2 2 4.5 2s4.5-.9 4.5-2V7M3.5 12c0 1.1 2 2 4.5 2M3.5 12v4c0 1.1 2 2 4.5 2s4.5-.9 4.5-2v-1M3.5 12c0-1.1 2-2 4.5-2",
  cross: "M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z",
  cup: "M5 9h11v5a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5V9Zm11 1h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3m3-3v3",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  droplet: "M12 3.5s6 6.3 6 10.7a6 6 0 0 1-12 0c0-4.4 6-10.7 6-10.7Z",
  flame: "M12 21a6 6 0 0 0 6-6c0-3.8-2.6-5.7-3.6-8.6-.9 1.9-1.9 2.8-3.1 3.2C11 7.5 10 5.4 9.7 3.9 7.7 6 6 8.9 6 12.5V15a6 6 0 0 0 6 6Z",
  fork: "M7 3v8m-2-8v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-2 6 0 8v10",
  fuel: "M5 20V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15M4 20h11M14 9h2l2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3",
  game: "M7 8h10a4 4 0 0 1 4 4v2a3 3 0 0 1-5.5 1.7L14.5 14h-5l-1 1.7A3 3 0 0 1 3 14v-2a4 4 0 0 1 4-4Zm1 3v3m-1.5-1.5h3M15 12h.01M17 14h.01",
  gift: "M4 11h16v9H4v-9Zm-1-4h18v4H3V7Zm9 0v13M12 7c-1.5-3-5-3-5 0m5 0c1.5-3 5-3 5 0",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z",
  graduation: "M2 9l10-5 10 5-10 5L2 9Zm4 2v5c2 2 10 2 12 0v-5M22 9v6",
  gym: "M6 8v8M3 10v4M18 8v8M21 10v4M6 12h12",
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z",
  home: "M4 10.5 12 4l8 6.5V20H4v-9.5Z",
  key: "M14.5 9.5a4 4 0 1 0-1.4 3.1L20 19.5M17 16.5l2-2M15.5 15l1.5-1.5",
  laptop: "M5 6h14v9H5V6ZM3 18h18",
  leaf: "M5 19c0-8 5-13 14-14 0 9-5 14-13 14Zm0 0 7-7",
  music: "M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  parking: "M5 4h14v16H5V4Zm5 12V8h3a2.5 2.5 0 0 1 0 5h-3",
  paw: "M12 13c-3 0-5 3-5 5a2 2 0 0 0 2 2c1 0 2-.7 3-.7s2 .7 3 .7a2 2 0 0 0 2-2c0-2-2-5-5-5ZM4.5 10a1.5 2 0 1 0 3 0 1.5 2 0 1 0-3 0Zm12 0a1.5 2 0 1 0 3 0 1.5 2 0 1 0-3 0ZM8 6a1.5 2 0 1 0 3 0 1.5 2 0 1 0-3 0Zm5 0a1.5 2 0 1 0 3 0 1.5 2 0 1 0-3 0Z",
  percent: "M5 19 19 5M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  phone: "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3 15h2",
  piggy: "M4 12a7 6 0 0 1 12.5-3.5H19l.5 2.5 1.5 1v3l-1.5.5-1 2.5H16l-1 2h-2l-.5-1.5h-3L9 20.5H7L6.5 18A6 6 0 0 1 4 12Zm11.5-1h.01M10 7.5h3",
  pill: "M10.5 20.5a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 7l-6 6ZM8.5 8.5l7 7",
  pizza: "M12 21 3.5 6.5a12 12 0 0 1 17 0L12 21Zm-3.5-11h.01M13.5 9h.01M11.5 14h.01",
  plane: "M21 15.5 13 11V5a1.5 1.5 0 0 0-3 0v6l-8 4.5V18l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-3.5l8 2.5v-2.5Z",
  receipt: "M6 3h12v18l-2-1.5L14 21l-2-1.5-2 1.5-2-1.5L6 21V3Zm3 5h6m-6 4h6m-6 4h3",
  scissors: "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm2.5-13.5L20 19M8.5 16.5 20 5",
  shield: "M12 3 4 6v6c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V6l-8-3Z",
  shirt: "M8 3 4 6l2 4 2-1v12h8V9l2 1 2-4-4-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3Z",
  sofa: "M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3M3 11a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v6H3v-6Zm2 6v2m14-2v2",
  star: "M12 3.5 14.6 9l6 .6-4.5 4 1.3 5.9L12 16.5l-5.4 3 1.3-5.9-4.5-4 6-.6L12 3.5Z",
  tag: "M3 12V4h8l10 10-8 8L3 12Zm4.5-4.5h.01",
  ticket: "M4 7a2 2 0 0 0 2-2h12a2 2 0 0 0 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 0-2 2H6a2 2 0 0 0-2-2v-3a2 2 0 0 0 0-4V7Zm10-2v14",
  tooth: "M7 3C5 3 3 5 3.5 8c.4 2.5 1.5 4 2 7 .4 2.5 1 5 2.5 5s1.5-4 4-4 2.5 4 4 4 2.1-2.5 2.5-5c.5-3 1.6-4.5 2-7C21 5 19 3 17 3c-2 0-3 1-5 1S9 3 7 3Z",
  train: "M7 4h10a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2Zm-2 7h14M9 21l1.5-3m4.5 3-1.5-3M8.5 15h.01M15.5 15h.01",
  trend: "M4 19h16M5 15l4-4 3 3 7-7M15 7h4v4",
  tv: "M4 6h16v11H4V6Zm4 15h8M9 2.5 12 6l3-3.5",
  umbrella: "M3 12a9 9 0 0 1 18 0H3Zm9 0v6.5a2.5 2.5 0 0 1-5 0",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 6.5M21 20a6 6 0 0 0-4-5.6",
  wallet: "M4 7.5A2.5 2.5 0 0 1 6.5 5H18v4M4 7.5V17a2 2 0 0 0 2 2h14V9H6.5A2.5 2.5 0 0 1 4 7.5ZM16 14h.01",
  wifi: "M3.5 9a12 12 0 0 1 17 0M6.5 12.5a8 8 0 0 1 11 0M9.5 16a4 4 0 0 1 5 0M12 19.5h.01",
  wine: "M8 3h8l-.5 5a3.5 3.5 0 0 1-7 0L8 3Zm4 8.5V20m-3.5 0h7",
  wrench: "M14 6a4 4 0 0 0-5 5l-5 5 3 3 5-5a4 4 0 0 0 5-5l-2 2-2-1-1-2 2-2Z",
};
```

`src/shared/ui/icons/ui-icons.ts` (from the Main, SignUp, Home, Activity, Settings, SpaceSheet and ProfileSheet artboards; `close`, `alert` and `lock`'s body are drawn to the same grid):

```ts
/** The interface's own stroke icons (24 × 24), from the approved canvas. */
export const UI_ICONS = {
  back: "m15 5-7 7 7 7",
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 6 6 6-6 6",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6 6 18",
  check: "m5 12.5 4.5 4.5L19 7.5",
  search: "M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Zm-1.5 5 4 4",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  home: "M4 10.5 12 4l8 6.5V20H4v-9.5Z",
  list: "M4 6h16M4 12h16M4 18h10",
  sliders: "M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6",
  signOut: "M9 4H5v16h4M15 8l4 4-4 4M19 12H9.5",
  lock: "M8 11V8a4 4 0 0 1 8 0v3M6 11h12v9H6v-9Z",
  alert: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4.5v5.5m0 3.5h.01",
  calendar: "M4 6h16v14H4V6Zm0 4h16M8 3v4m8-4v4",
} as const;
export type UiIconName = keyof typeof UI_ICONS;
```

`src/shared/ui/atoms/icon.tsx` renders `<svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}><path d={…} stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" /></svg>` for both components (size defaults to 24).

`src/shared/ui/palette.ts`:

```ts
import type { CSSProperties } from "react";
import type { PaletteKey } from "@/shared/kernel/style";

/** Ruling P135: a palette key's tokens as CSS variables; classes then use `bg-[var(--tint)] text-[var(--ink)]`. */
export const paletteVars = (key: PaletteKey): CSSProperties =>
  ({ "--tint": `var(--pal-${key.toLowerCase()}-tint)`, "--ink": `var(--pal-${key.toLowerCase()}-ink)` }) as CSSProperties;
```

`src/shared/ui/theme/theme.ts`:

```ts
export const THEME_KEY = "hearth.theme";
export type Theme = "system" | "light" | "dark";
const THEMES: readonly Theme[] = ["system", "light", "dark"];

/** HU-E9-13, ruling P135: the theme is a device setting, outside the profile and the installation rules. */
export const resolveTheme = (theme: Theme, prefersDark: boolean): "light" | "dark" =>
  theme === "system" ? (prefersDark ? "dark" : "light") : theme;

export const readTheme = (storage: Pick<Storage, "getItem"> | undefined): Theme => {
  try {
    const value = storage?.getItem(THEME_KEY);
    return THEMES.includes(value as Theme) ? (value as Theme) : "system";
  } catch {
    return "system";
  }
};

const prefersDark = () => globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

export const saveTheme = (theme: Theme): void => {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // A private window may refuse storage: the choice still applies to this page.
  }
  document.documentElement.dataset.theme = resolveTheme(theme, prefersDark());
};

/** Runs in <head> before the first paint, so a dark choice never flashes light (and nothing shifts, CLS). */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});var d=t==="dark"||((t!=="light")&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){}})();`;
```

`src/app/(web)/globals.css` (tokens from the Home artboard's light and dark sets, Main's input border and SignUp's error red; the dark palette is derived, ruling P135):

```css
@import "tailwindcss";
/* Tailwind scans every file git does not ignore: keep the plans' Markdown out of the CSS (ruling P134's budgets). */
@source not "../../../docs";

@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

:root {
  color-scheme: light;
  --bg: #f6f4ef;
  --surface: #ffffff;
  --line: #e3e0d8;
  --field: #d6d2c8;
  --ink: #1c211f;
  --muted: #5b635f;
  --accent: #2e5e4e;
  --accent-strong: #234839;
  --accent-soft: #e5eeea;
  --on-accent: #ffffff;
  --owe: #b5562f;
  --owe-soft: #f6e9e1;
  --track: #e3e0d8;
  --danger: #b42318;
  --scrim: rgb(28 33 31 / 0.45);

  --pal-pine-tint: #e5eeea; --pal-pine-ink: #2e5e4e;
  --pal-sage-tint: #e9efe4; --pal-sage-ink: #4e6b3a;
  --pal-olive-tint: #eeeedd; --pal-olive-ink: #5e5a1f;
  --pal-sand-tint: #f3eedc; --pal-sand-ink: #7a6420;
  --pal-mustard-tint: #f7ecd3; --pal-mustard-ink: #8a5a00;
  --pal-amber-tint: #fbe9d8; --pal-amber-ink: #8f4a0e;
  --pal-ember-tint: #f6e9e1; --pal-ember-ink: #96441f;
  --pal-coral-tint: #fbe7e3; --pal-coral-ink: #9c3b2a;
  --pal-rose-tint: #f4e6e8; --pal-rose-ink: #8a3b47;
  --pal-plum-tint: #efe6f0; --pal-plum-ink: #6b3f72;
  --pal-lavender-tint: #ece8f5; --pal-lavender-ink: #5a4a8c;
  --pal-indigo-tint: #e8eaf2; --pal-indigo-ink: #434c78;
  --pal-sky-tint: #e3eef6; --pal-sky-ink: #245c80;
  --pal-teal-tint: #e1f0ef; --pal-teal-ink: #1f625e;
  --pal-steel-tint: #e6ecef; --pal-steel-ink: #3c5663;
  --pal-graphite-tint: #ecebe8; --pal-graphite-ink: #3e4542;
}

/* dark palette */
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #121614;
  --surface: #1a1f1c;
  --line: #2c332f;
  --field: #3a423e;
  --ink: #e8e6e1;
  --muted: #a3aaa6;
  --accent: #7fb89e;
  --accent-strong: #a6d1bd;
  --accent-soft: #22302a;
  --on-accent: #121614;
  --owe: #e09a78;
  --owe-soft: #2e231e;
  --track: #2c332f;
  --danger: #f97066;
  --scrim: rgb(0 0 0 / 0.6);
}
:root[data-theme="dark"] {
  --pal-pine-tint: color-mix(in oklab, #2e5e4e 32%, #1a1f1c); --pal-pine-ink: color-mix(in oklab, #2e5e4e 35%, #e8e6e1);
  --pal-sage-tint: color-mix(in oklab, #4e6b3a 32%, #1a1f1c); --pal-sage-ink: color-mix(in oklab, #4e6b3a 35%, #e8e6e1);
  --pal-olive-tint: color-mix(in oklab, #5e5a1f 32%, #1a1f1c); --pal-olive-ink: color-mix(in oklab, #5e5a1f 35%, #e8e6e1);
  --pal-sand-tint: color-mix(in oklab, #7a6420 32%, #1a1f1c); --pal-sand-ink: color-mix(in oklab, #7a6420 35%, #e8e6e1);
  --pal-mustard-tint: color-mix(in oklab, #8a5a00 32%, #1a1f1c); --pal-mustard-ink: color-mix(in oklab, #8a5a00 35%, #e8e6e1);
  --pal-amber-tint: color-mix(in oklab, #8f4a0e 32%, #1a1f1c); --pal-amber-ink: color-mix(in oklab, #8f4a0e 35%, #e8e6e1);
  --pal-ember-tint: color-mix(in oklab, #96441f 32%, #1a1f1c); --pal-ember-ink: color-mix(in oklab, #96441f 35%, #e8e6e1);
  --pal-coral-tint: color-mix(in oklab, #9c3b2a 32%, #1a1f1c); --pal-coral-ink: color-mix(in oklab, #9c3b2a 35%, #e8e6e1);
  --pal-rose-tint: color-mix(in oklab, #8a3b47 32%, #1a1f1c); --pal-rose-ink: color-mix(in oklab, #8a3b47 35%, #e8e6e1);
  --pal-plum-tint: color-mix(in oklab, #6b3f72 32%, #1a1f1c); --pal-plum-ink: color-mix(in oklab, #6b3f72 35%, #e8e6e1);
  --pal-lavender-tint: color-mix(in oklab, #5a4a8c 32%, #1a1f1c); --pal-lavender-ink: color-mix(in oklab, #5a4a8c 35%, #e8e6e1);
  --pal-indigo-tint: color-mix(in oklab, #434c78 32%, #1a1f1c); --pal-indigo-ink: color-mix(in oklab, #434c78 35%, #e8e6e1);
  --pal-sky-tint: color-mix(in oklab, #245c80 32%, #1a1f1c); --pal-sky-ink: color-mix(in oklab, #245c80 35%, #e8e6e1);
  --pal-teal-tint: color-mix(in oklab, #1f625e 32%, #1a1f1c); --pal-teal-ink: color-mix(in oklab, #1f625e 35%, #e8e6e1);
  --pal-steel-tint: color-mix(in oklab, #3c5663 32%, #1a1f1c); --pal-steel-ink: color-mix(in oklab, #3c5663 35%, #e8e6e1);
  --pal-graphite-tint: color-mix(in oklab, #3e4542 32%, #1a1f1c); --pal-graphite-ink: color-mix(in oklab, #3e4542 35%, #e8e6e1);
}

@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-line: var(--line);
  --color-field: var(--field);
  --color-ink: var(--ink);
  --color-muted: var(--muted);
  --color-accent: var(--accent);
  --color-accent-strong: var(--accent-strong);
  --color-accent-soft: var(--accent-soft);
  --color-on-accent: var(--on-accent);
  --color-owe: var(--owe);
  --color-owe-soft: var(--owe-soft);
  --color-track: var(--track);
  --color-danger: var(--danger);
  --color-scrim: var(--scrim);
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

@layer base {
  body {
    background: var(--bg);
    color: var(--ink);
    font-family: var(--font-sans);
  }
  :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
}
```

(System fonts only: no web font download stands between the first byte and LCP. Without `@source not`, Tailwind's automatic source detection reads the plans in `docs/` (and the Docker build's `COPY . .` does the same) and ships 36 unused rules on every page, 18.3 KB of CSS instead of 13.3 KB. The dark palette passes or fails AA in the e2e dark scans of Task 18; a failing pair is fixed there by moving its mix percentage, never by turning the rule off.)

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(web)/globals.css" src/shared/ui/theme src/shared/ui/icons src/shared/ui/atoms/icon.tsx \
  src/shared/ui/atoms/icon.test.tsx src/shared/ui/palette.ts tests/architecture/palette-tokens.test.ts
git commit -m "feat(web): add the design tokens, the theme and the icon registry (Refs #69)"
```

---

### Task 7b: Atoms and molecules

The shared, shadcn/ui-style components every screen composes (atomic design), built on `radix-ui` primitives where behaviour matters (dialog focus trap, radio group arrows, switch) and on the tokens of Task 7a.

**Files:**
- Create: `src/shared/ui/atoms/{button,text-field,switch,badge,avatar,logo}.tsx`, `src/shared/ui/molecules/{sheet,choice-group,problem-notice}.tsx`, `src/shared/ui/atoms/atoms.test.tsx`, `src/shared/ui/molecules/molecules.test.tsx`, `src/shared/ui/index.ts`
- Modify: `package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `cn`, `Icon`, `useProblemMessage`, `Problem`.
- Produces (all exported from `src/shared/ui/index.ts`, with `VisuallyHidden`, `Icon`, `SymbolIcon`, `paletteVars`, `cn`):
  - `Button(props: ButtonHTMLAttributes & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "lg" | "md" | "icon"; asChild?: boolean })` — `lg` 56 px high (the forms' main action), `md` 48 px, `icon` 48 × 48; `asChild` renders its child (a `Link`) through radix `Slot`.
  - `TextField(props: InputHTMLAttributes & { id: string; label: string; hint?: string; error?: ReactNode })` — label above, 52 px input, `aria-invalid` and `aria-describedby` (`<id>-hint`, `<id>-error`) when given, the error in `text-danger` with the `alert` icon; `trailing?: ReactNode` (a show-password button).
  - `Switch({ id, label, description?, checked, onCheckedChange, disabled? })` (radix `Switch`, labelled by its label).
  - `ChoiceGroup<T extends string>({ label, value, options: readonly { value: T; label: ReactNode; disabled?: boolean }[], onValueChange: (value: T) => void, disabled?: boolean, layout?: "segmented" | "chips" | "grid" })` (radix `RadioGroup`; arrow keys move and select).
  - `Badge({ tone?: "neutral" | "accent" | "owe"; icon?: UiIconName; children })`, `Avatar({ name: string; size?: number })` (first letter, `aria-hidden`), `Logo()` (the Main artboard's two-path mark, a house in the accent and a flame in the owe color, and "Hearth"; code fixed in Step 4).
  - `Sheet({ open, onOpenChange, title, description?, children, footer? })` (radix `Dialog`: a bottom sheet under 1024 px, a centered panel above; the title names the dialog; a close button labelled `common.close`; Escape and the scrim close it; focus returns to the trigger).
  - `ProblemNotice({ problem }: { problem: Problem })` (`role="alert"`, the translated message and the reference line).

- [ ] **Step 1: Install**

`pnpm add radix-ui@1.7.0 class-variance-authority@0.7.1`

- [ ] **Step 2: Write the failing tests**

`src/shared/ui/atoms/atoms.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { Button } from "./button";
import { Switch } from "./switch";
import { TextField } from "./text-field";

describe("atoms", () => {
  it("renders a link as a button when asked", async () => {
    renderWithIntl(
      <Button asChild variant="secondary">
        <a href="/sign-up">Crear una cuenta</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Crear una cuenta" })).toHaveAttribute("href", "/sign-up");
  });

  it("ties a field's label, hint and error together for assistive technology", async () => {
    const { container } = renderWithIntl(
      <TextField id="su-email" label="Correo electrónico" hint="Te escribiremos aquí" error="Ya existe una cuenta con este correo." />,
    );
    const input = screen.getByLabelText("Correo electrónico");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Te escribiremos aquí Ya existe una cuenta con este correo.");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("switches with the keyboard", async () => {
    function Harness() {
      const [on, setOn] = useState(true);
      return <Switch id="na-available" label="Contar en el disponible" checked={on} onCheckedChange={setOn} />;
    }
    const { container } = renderWithIntl(<Harness />);
    const toggle = screen.getByRole("switch", { name: "Contar en el disponible" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    toggle.focus();
    await userEvent.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(await axeViolations(container)).toEqual([]);
  });
});
```

`src/shared/ui/molecules/molecules.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { ChoiceGroup } from "./choice-group";
import { ProblemNotice } from "./problem-notice";
import { Sheet } from "./sheet";

describe("molecules", () => {
  it("opens a sheet named by its title, closes it with Escape and with its labelled close button", async () => {
    const onOpenChange = vi.fn();
    renderWithIntl(
      <Sheet open onOpenChange={onOpenChange} title="Espacios">
        <p>Personal</p>
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "Espacios" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("moves through a choice group with the arrow keys and skips disabled choices", async () => {
    function Harness() {
      const [value, setValue] = useState<"DMY" | "MDY" | "YMD">("DMY");
      return (
        <ChoiceGroup
          label="Fecha"
          value={value}
          onValueChange={setValue}
          options={[
            { value: "DMY", label: "16/10/2026" },
            { value: "MDY", label: "10/16/2026", disabled: true },
            { value: "YMD", label: "2026/10/16" },
          ]}
        />
      );
    }
    const { container } = renderWithIntl(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "Fecha" });
    expect(screen.getByRole("radio", { name: "16/10/2026" })).toBeChecked();
    screen.getByRole("radio", { name: "16/10/2026" }).focus();
    // Radix moves focus in a timeout after keydown and selects only while the arrow is still down, as in a browser.
    await userEvent.keyboard("{ArrowRight>}");
    await userEvent.keyboard("{/ArrowRight}");
    expect(screen.getByRole("radio", { name: "2026/10/16" })).toBeChecked();
    expect(group).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("announces a problem with its message and reference", () => {
    renderWithIntl(
      <ProblemNotice problem={{ code: "Nope", status: 500, requestId: "req-7", errors: [], field: null }} />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Algo salió mal. Intenta de nuevo.");
    expect(alert).toHaveTextContent("Referencia: req-7");
  });
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm exec vitest run --project ui src/shared/ui`
Expected: FAIL — the components do not exist.

- [ ] **Step 4: Implement**

Each component follows its Interfaces line; `Button`'s variants with `cva` (`primary`: `bg-accent text-on-accent`, `secondary`: `bg-surface border border-line text-ink`, `ghost`: transparent `text-accent`, `danger`: `bg-surface border border-danger text-danger`), radius 14 px (the canvas's buttons), `font-semibold`, disabled at 50 % opacity with `cursor-not-allowed`. `Sheet` uses `Dialog.Root`, `Dialog.Portal`, `Dialog.Overlay` (`bg-scrim`), `Dialog.Content` (`rounded-t-[20px]` with a 40 × 5 px grab bar on mobile, `lg:rounded-[20px] lg:max-w-[480px]` centered above 1024 px), `Dialog.Title`, an optional `Dialog.Description` (else `aria-describedby={undefined}`), and `Dialog.Close` wrapping `Button size="icon" variant="ghost"` with `<Icon name="close" />` and `<VisuallyHidden>{t("close")}</VisuallyHidden>` (`useTranslations("common")`). `ChoiceGroup` labels its `RadioGroup.Root` with `aria-label={label}` and renders each item as a 44 px-high pill (`segmented` inside a `bg-track` rail, `chips` wrapping, `grid` a 4-column grid for the account types), the checked one `bg-surface` with a shadow (segmented) or `border-accent bg-accent-soft` (chips, grid). `ProblemNotice` is a client component: `const { message, reference } = useProblemMessage()(problem)`.

`src/shared/ui/atoms/logo.tsx` (the paths are exact copy from the Main artboard's 28 × 28 mark; its `#2E5E4E` and `#B5562F` strokes are the `--accent` and `--owe` tokens, so the mark follows the theme):

```tsx
import { useTranslations } from "next-intl";

/** The Main artboard's mark (a house holding a flame) and the product name. */
export function Logo() {
  const t = useTranslations("common");
  return (
    <span className="inline-flex items-center gap-2 text-lg font-semibold text-ink">
      <svg width={28} height={28} viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <path d="M5 13 14 5.5 23 13v10H5V13Z" stroke="var(--accent)" strokeWidth={1.75} strokeLinejoin="round" />
        <path
          d="M14 21c-2.2 0-3.6-1.6-3.6-3.6 0-2.6 3.6-5 3.6-6.6 0 1.6 3.6 4 3.6 6.6 0 2-1.4 3.6-3.6 3.6Z"
          stroke="var(--owe)"
          strokeWidth={1.75}
          strokeLinejoin="round"
        />
      </svg>
      {t("appName")}
    </span>
  );
}
```

Catalog keys: none new (Task 5a added `common.close`).

- [ ] **Step 5: Run the tests and the gates**

Run: Step 3's command, then every gate.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/shared/ui
git commit -m "feat(web): add the shared atoms and molecules on radix-ui (Refs #69)"
```

---

### Task 8a: The web root, the session redirect and the sign-in screen

**Amended by the owner's flow review (P143–P146, P151, P152):** the table in "Owner flow review: sign-up and sign-in" wins over this task's text where they differ; add its keys to both catalogs and a test per entry.

HU-E9-01's entry: the root layout of `src/app/(web)` (language, theme before paint, catalogs), `src/proxy.ts` sending a request without a session to `/sign-in?next=<path>` (only same-origin paths honoured, ruling P125), and the sign-in screen of the Main artboard with its language toggle (scenario "A protected page returns the visitor after sign-in").

**Files:**
- Create: `src/app/(web)/layout.tsx`, `src/app/(web)/(public)/layout.tsx`, `src/app/(web)/(public)/sign-in/page.tsx`, `src/proxy.ts`, `src/shared/ui/api/server-headers.ts`, `src/shared/ui/navigation/auth-redirect.ts`, `src/shared/ui/navigation/auth-redirect.test.ts`, `src/modules/identity/ui/sign-in-form.tsx`, `src/modules/identity/ui/sign-in-form-container.tsx`, `src/modules/identity/ui/password-field.tsx`, `src/modules/identity/ui/language-toggle.tsx`, `src/modules/identity/ui/sign-in.test.tsx`, `src/modules/identity/ui/index.ts`
- Modify: `src/shared/ui/api/server.ts` (reads `PATH_HEADER` from `server-headers.ts` instead of the literal), `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `browserApi`, `type Api`, `problemFrom`, `hasSession`, `getMe` (Task 4b); `LOCALE_COOKIE` (Task 5a); `TextField`, `Button`, `Logo`, `ProblemNotice` (Task 7b); `THEME_BOOTSTRAP` (Task 7a).
- Produces: `PUBLIC_PATHS = ["/sign-in", "/sign-up"]`; `safeNext(next: string | null | undefined): string` (a path starting with one `/`, not `//`, with no backslash and no control character anywhere, not a public path; otherwise `/`); `redirectFor(input: { pathname: string; search: string; hasSession: boolean }): string | null`; `PATH_HEADER = "x-hearth-path"` (set by the proxy, read by `loaded()`'s sign-in redirect); `SignInFormContainer({ next, api? }: { next: string; api?: Api })`; `SignInForm({ onSubmit, pending, problem, problemField })`; `PasswordField(props)` (a `TextField` with a show/hide toggle labelled `auth.showPassword` / `auth.hidePassword`); `LanguageToggle({ locale }: { locale: Locale })`. Catalog namespace `auth`.

- [ ] **Step 1: Write the failing tests**

`src/shared/ui/navigation/auth-redirect.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { redirectFor, safeNext } from "./auth-redirect";

describe("safeNext (HU-E9-01, ruling P125): only same-origin paths are honoured", () => {
  it.each([
    ["/spaces/s1/transactions?period=2026-10", "/spaces/s1/transactions?period=2026-10"],
    ["/settings", "/settings"],
    ["//evil.example/x", "/"],
    ["https://evil.example", "/"],
    ["/\\evil.example", "/"],
    ["/\t/evil.example", "/"],
    ["/\n/evil.example", "/"],
    ["spaces/s1", "/"],
    ["/sign-in", "/"],
    ["/sign-up?next=/x", "/"],
    ["", "/"],
    [null, "/"],
    [undefined, "/"],
  ])("%j → %j", (next, expected) => {
    expect(safeNext(next)).toBe(expected);
  });
});

describe("redirectFor", () => {
  it("sends a request without a session to the sign-in screen, keeping the path and its query", () => {
    expect(redirectFor({ pathname: "/spaces/s1/transactions", search: "?period=2026-10", hasSession: false })).toBe(
      "/sign-in?next=%2Fspaces%2Fs1%2Ftransactions%3Fperiod%3D2026-10",
    );
    expect(redirectFor({ pathname: "/", search: "", hasSession: false })).toBe("/sign-in");
  });

  it("lets public screens through, and protected ones when a session cookie is present", () => {
    expect(redirectFor({ pathname: "/sign-in", search: "?next=%2Fsettings", hasSession: false })).toBeNull();
    expect(redirectFor({ pathname: "/sign-up", search: "", hasSession: true })).toBeNull();
    expect(redirectFor({ pathname: "/settings", search: "", hasSession: true })).toBeNull();
  });
});
```

`src/modules/identity/ui/sign-in.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { meDto } from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { LanguageToggle } from "./language-toggle";
import { SignInFormContainer } from "./sign-in-form-container";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const signIn = async () => {
  await userEvent.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
  await userEvent.type(screen.getByLabelText("Contraseña"), "123456789012");
  await userEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
};

describe("sign-in screen (HU-E9-01)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("signs in and returns to the protected page the visitor opened", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/auth/sign-in": () => jsonResponse({ user: meDto(), token: "t" }),
    });
    const { container } = renderWithIntl(<SignInFormContainer next="/spaces/sp-personal/transactions" api={api} />);
    expect(await axeViolations(container)).toEqual([]);
    await signIn();
    expect(await requests[0]!.json()).toEqual({ email: "ana@example.com", password: "123456789012" });
    expect(router.replace).toHaveBeenCalledWith("/spaces/sp-personal/transactions");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("shows InvalidCredentials as a form message and stays on the screen", async () => {
    const { api } = fakeApi({ "POST /api/v1/auth/sign-in": () => problemResponse(401, "InvalidCredentials") });
    renderWithIntl(<SignInFormContainer next="/" api={api} />);
    await signIn();
    expect(await screen.findByRole("alert")).toHaveTextContent("El correo o la contraseña no coinciden.");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("switches the language with a cookie and reloads the texts", async () => {
    renderWithIntl(<LanguageToggle locale="es" />);
    await userEvent.click(screen.getByRole("button", { name: "Cambiar idioma, actual español" }));
    expect(document.cookie).toContain("hearth.locale=en");
    expect(router.refresh).toHaveBeenCalled();
  });
});
```

(The show-password toggle is covered in Task 8b's test.)

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/shared/ui/navigation` and `pnpm exec vitest run --project ui src/modules/identity/ui`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Implement**

`src/shared/ui/navigation/auth-redirect.ts`:

```ts
/** HU-E9-01: the screens a visitor without a session may open. */
export const PUBLIC_PATHS = ["/sign-in", "/sign-up"] as const;

const isPublic = (pathname: string) => PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}?`));

/** The URL parser drops tabs and newlines and reads "\" as "/", so "/\t/evil.example" would leave the origin. */
const bends = (c: string) => c === "\\" || c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f;

/** Ruling P125: only a same-origin path is honoured as `next`; anything else, or a public screen, lands on "/". */
export const safeNext = (next: string | null | undefined): string => {
  if (!next || !next.startsWith("/") || next.startsWith("//") || [...next].some(bends)) return "/";
  return isPublic(next.split("?")[0] ?? "") ? "/" : next;
};

/**
 * The proxy's optimistic check (a cookie, not a session lookup): a protected path without a session cookie goes to the
 * sign-in screen with the path to return to. An expired cookie passes here and is caught by the shell (Task 9).
 */
export const redirectFor = (input: { pathname: string; search: string; hasSession: boolean }): string | null => {
  if (input.hasSession || isPublic(input.pathname)) return null;
  const target = `${input.pathname}${input.search}`;
  return target === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(target)}`;
};
```

`src/proxy.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { PATH_HEADER } from "@/shared/ui/api/server-headers";
import { hasSession } from "@/shared/ui/api/session";
import { redirectFor } from "@/shared/ui/navigation/auth-redirect";

/** HU-E9-01 (Next.js 16 `proxy.ts`): session-less requests to protected pages go to the sign-in screen. */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const target = redirectFor({ pathname, search, hasSession: hasSession(request.cookies) });
  if (target) return NextResponse.redirect(new URL(target, request.url));
  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, `${pathname}${search}`);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!api/|_next/|favicon.ico|robots.txt).*)"] };
```

(The WHATWG URL parser removes ASCII tab, CR and LF anywhere in a URL, so `?next=%2F%09%2Fevil.example` would reach `router.replace("/\t/evil.example")` and resolve to `https://evil.example/`. `bends` is a character test rather than a regular expression because a control-character class trips ESLint's `no-control-regex`. A backslash anywhere is refused, not only after the first `/`.)

`PATH_HEADER` lives in the tiny `src/shared/ui/api/server-headers.ts` (`export const PATH_HEADER = "x-hearth-path";`) so the proxy does not import `server.ts` and its `next/headers`; `server.ts` imports it from there.

`src/app/(web)/layout.tsx`:

```tsx
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { THEME_BOOTSTRAP } from "@/shared/ui/theme/theme";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Hearth", template: "%s · Hearth" } };
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#121614" },
  ],
};

/** The web UI's root (route group `(web)`; the API routes have no layout). */
export default async function WebLayout({ children }: { readonly children: ReactNode }) {
  const locale = await getLocale();
  return (
    // The bootstrap script sets data-theme before hydration, hence the suppressed warning on <html> only.
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
```

`src/app/(web)/(public)/layout.tsx` (server): when `hasSession(await cookies())` and `await getMe()` is not null, `redirect("/")` (a real session check, so an expired cookie never loops); otherwise renders a 390 px-max column (`mx-auto max-w-[420px] px-4 pb-6 pt-4`) with the `Logo`, the `LanguageToggle` (`locale` from `getLocale()`) and `children`.

`src/app/(web)/(public)/sign-in/page.tsx`: `export async function generateMetadata()` → `{ title: (await getTranslations("auth.signIn"))("title") }`; the page reads `searchParams: Promise<{ next?: string }>` and renders `<SignInFormContainer next={safeNext((await searchParams).next)} />`.

`SignInFormContainer` (`"use client"`): `const api = props.api ?? browserApi()` (memoized), state `{ pending, problem }`; on submit it calls `api.POST("/api/v1/auth/sign-in", { body })` inside `try` (a rejection becomes `problemFrom(error, undefined)`); on `response.ok` it calls `router.replace(next)` then `router.refresh()`; otherwise it keeps the problem and re-enables the form. Every sign-in problem is form-level (`InvalidCredentials`, `TooManyRequests`, `Unknown`): `SignInForm` shows `ProblemNotice` above the button. `SignInForm` follows the Main artboard: `h1` `auth.signIn.title`, the subtitle, `TextField` email (`type="email"`, `autoComplete="username"`, `inputMode="email"`), `PasswordField` (`autoComplete="current-password"`), the `lg` primary button (disabled while pending) and a secondary link to `/sign-up` (`auth.signIn.createAccount`), keeping `?next=` when it is not `/`. `LanguageToggle` (`"use client"`) is the canvas's "ES · EN" pill: `aria-label` `auth.language.label` with `{ language }` the current language's name (`auth.language.es` / `auth.language.en`); clicking writes `document.cookie = \`hearth.locale=${other}; path=/; max-age=31536000; samesite=lax\`` and calls `router.refresh()`.

`src/modules/identity/ui/index.ts` exports `SignInFormContainer`, `LanguageToggle`.

Catalog keys (`auth`), es / en: `signIn.title` Hola de nuevo / Welcome back; `signIn.subtitle` Entra para ver tus cuentas y lo que queda del mes. / Sign in to see your accounts and what is left of the month.; `signIn.submit` Iniciar sesión / Sign in; `signIn.createAccount` Crear una cuenta / Create an account; `email` Correo electrónico / Email; `password` Contraseña / Password; `showPassword` Mostrar contraseña / Show password; `hidePassword` Ocultar contraseña / Hide password; `language.label` Cambiar idioma, actual {language} / Change language, current {language}; `language.es` español / Spanish; `language.en` inglés / English; `language.short` ES · EN / ES · EN.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, `pnpm build` (the proxy and the first page compile), then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(web)/layout.tsx" "src/app/(web)/(public)" src/proxy.ts src/shared/ui/navigation \
  src/shared/ui/api/server.ts src/shared/ui/api/server-headers.ts src/modules/identity/ui src/i18n/messages
git commit -m "feat(identity): add the sign-in screen and the session redirect (Refs #69)"
```

---

### Task 8b: The sign-up screen

**Amended by the owner's flow review (P142, P143, P147):** the table in "Owner flow review: sign-up and sign-in" wins over this task's text where they differ; add its keys to both catalogs and a test per entry.

The SignUp artboard (scenarios "Sign up lands in the personal space" at component level and "API error codes are shown as translated messages"): name, email and password, the browser's time zone sent with them (HU-E1-14), each API code shown next to its field (ruling P118).

**Files:**
- Create: `src/modules/identity/ui/sign-up-form.tsx`, `src/modules/identity/ui/sign-up-form-container.tsx`, `src/modules/identity/ui/sign-up.test.tsx`, `src/app/(web)/(public)/sign-up/page.tsx`
- Modify: `src/shared/ui/api/problem.ts`, `src/shared/ui/api/problem.test.ts`, `src/modules/identity/ui/index.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: Task 8a's `PasswordField`, `browserTimeZone()` (Task 6).
- Produces: `fieldOf<F extends string>(problem: Problem, byCode: Readonly<Partial<Record<string, F>>>, fields: readonly F[]): F | "form"` (the code's field, else the first segment of the first `errors[].path` when it names a field, else the problem's public `field` when it names one, else `"form"`); `SignUpFormContainer({ api? })`, `SignUpForm(...)`.

- [ ] **Step 1: Write the failing tests**

Add to `src/shared/ui/api/problem.test.ts`:

```ts
describe("fieldOf (ruling P118)", () => {
  const problem = (code: string, extra: Partial<Problem> = {}): Problem => ({
    code, status: 422, requestId: "r", errors: [], field: null, ...extra,
  });
  const fields = ["name", "email", "password"] as const;
  const byCode = { EmailTaken: "email", PasswordTooShort: "password" } as const;

  it("puts a code next to its field, then a validation path, else on the form", () => {
    expect(fieldOf(problem("EmailTaken"), byCode, fields)).toBe("email");
    expect(fieldOf(problem("ValidationFailed", { errors: [{ path: "name", message: "Too small" }] }), byCode, fields)).toBe("name");
    expect(fieldOf(problem("ValidationFailed", { errors: [{ path: "", message: "Body must be valid JSON" }] }), byCode, fields)).toBe("form");
    expect(fieldOf(problem("TooManyRequests"), byCode, fields)).toBe("form");
  });
});
```

(import `fieldOf` and `type Problem` from `./problem`.)

`src/modules/identity/ui/sign-up.test.tsx` (same `router` mock as Task 8a):

```tsx
describe("sign-up screen (HU-E9-01)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the account with the browser's time zone and lands on the personal space", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/auth/sign-up": () => jsonResponse({ user: meDto() }, 201) });
    const { container } = renderWithIntl(<SignUpFormContainer api={api} />);
    expect(await axeViolations(container)).toEqual([]);
    expect(screen.getByLabelText("Contraseña")).toHaveAccessibleDescription("Al menos 8 caracteres");
    await userEvent.type(screen.getByLabelText("Nombre"), "Ana");
    await userEvent.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Contraseña"), "123456789012");
    await userEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "text");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await requests[0]!.json()).toEqual({
      name: "Ana",
      email: "ana@example.com",
      password: "123456789012",
      timezone: browserTimeZone(),
    });
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("shows errors.EmailTaken next to the email field and stays on the screen", async () => {
    const { api } = fakeApi({ "POST /api/v1/auth/sign-up": () => problemResponse(409, "EmailTaken") });
    renderWithIntl(<SignUpFormContainer api={api} />);
    await userEvent.type(screen.getByLabelText("Nombre"), "Ana");
    await userEvent.type(screen.getByLabelText("Correo electrónico"), "ANA@example.com");
    await userEvent.type(screen.getByLabelText("Contraseña"), "123456789012");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    const email = screen.getByLabelText("Correo electrónico");
    await waitFor(() => expect(email).toHaveAttribute("aria-invalid", "true"));
    expect(email).toHaveAccessibleDescription("Ya existe una cuenta con este correo. Inicia sesión");
    // The footer has its own "Inicia sesión" link: look inside the email field's error.
    const emailError = document.getElementById(email.getAttribute("aria-describedby")!)!;
    expect(within(emailError).getByRole("link", { name: "Inicia sesión" })).toHaveAttribute("href", "/sign-in");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("shows a too-short password next to the password field", async () => {
    const { api } = fakeApi({ "POST /api/v1/auth/sign-up": () => problemResponse(422, "PasswordTooShort") });
    renderWithIntl(<SignUpFormContainer api={api} />);
    await userEvent.type(screen.getByLabelText("Nombre"), "Ana");
    await userEvent.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Contraseña"), "1234567");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Contraseña")).toHaveAccessibleDescription(
        "Al menos 8 caracteres La contraseña debe tener al menos 8 caracteres.",
      ),
    );
  });
});
```

(imports as in Task 8a plus `waitFor` and `within` beside `screen` — `import { screen, waitFor, within } from "@testing-library/react";` — and `browserTimeZone` from `@/shared/ui/format/zones`.)

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/shared/ui/api/problem.test.ts` and `pnpm exec vitest run --project ui src/modules/identity/ui/sign-up.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`fieldOf` as in the Interfaces. The container posts `{ name, email, password, timezone: browserTimeZone() }`, maps problems with `fieldOf(problem, { EmailTaken: "email", InvalidEmail: "email", PasswordTooShort: "password", InvalidPassword: "password" }, ["name", "email", "password"])`, shows a field's message under it (for `EmailTaken`, followed by a link "Inicia sesión" to `/sign-in`, as the SignUp artboard draws it) and a form problem in `ProblemNotice`; on 201 it calls `router.replace("/")` and `router.refresh()`. The password hint follows the API's rule of 8 characters, not the artboard's 12 (ruling P118). The page sets the title `auth.signUp.title`.

Catalog keys (`auth.signUp`), es / en: `title` Crea tu cuenta / Create your account; `subtitle` Tu espacio personal se crea solo, con categorías listas. / Your personal space is created for you, with categories ready.; `name` Nombre / Name; `passwordHint` Al menos 8 caracteres / At least 8 characters; `submit` Crear cuenta / Create account; `haveAccount` ¿Ya tienes cuenta? / Already have an account?; `signIn` Inicia sesión / Sign in.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ui/api/problem.ts src/shared/ui/api/problem.test.ts src/modules/identity/ui \
  "src/app/(web)/(public)/sign-up" src/i18n/messages
git commit -m "feat(identity): add the sign-up screen with translated field errors (Refs #69)"
```

---

### Task 9: The app shell, the space switcher and the user menu

**Amended by the owner's flow review (P149):** the table in "Owner flow review: sign-up and sign-in" wins over this task's text where they differ; add its keys to both catalogs and a test per entry.

The Home, Desktop, SpaceSheet, ProfileSheet and NavMap artboards (scenarios "The space switcher lists every current space" and the component halves of "Sign up lands in the personal space" and "Sign out returns to the sign-in screen"): a header with the active space and the avatar, a bottom navigation on phones and a side navigation from 1024 px, the space sheet and the profile sheet. The active space is the URL's (ruling P125); `/` sends a signed-in person to their personal space.

**Files:**
- Create: `src/modules/spaces/ui/{app-shell.tsx, app-shell-container.tsx, space-switcher.tsx, nav-links.tsx, space-helpers.ts, space-helpers.test.ts, shell.test.tsx, index.ts}`, `src/modules/identity/ui/profile-sheet.tsx`, `src/modules/identity/ui/profile-sheet.test.tsx`, `src/app/(web)/(app)/page.tsx`, `src/app/(web)/(app)/spaces/[spaceId]/layout.tsx`, `src/app/(web)/(app)/spaces/[spaceId]/page.tsx`, `src/app/(web)/(app)/settings/layout.tsx`, `src/app/(web)/(app)/error.tsx`, `src/app/(web)/(app)/not-found.tsx`
- Modify: `src/modules/identity/ui/index.ts`, `src/shared/ui/api/server.ts` (export `redirectToSignIn(): Promise<never>`), `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `getMe`, `getSpaces`, `MeDto`, `SpaceDto` (Task 4b); `Sheet`, `Avatar`, `Button`, `Icon`, `Logo` (Task 7b).
- Produces: `type SpaceSummary = Pick<SpaceDto, "id" | "name" | "kind" | "role">`; `personalSpaceOf(spaces: readonly SpaceDto[]): SpaceDto` (the `PERSONAL` one; throws when absent, which sign-up makes impossible); `activeSpaceOf(spaces, spaceId: string | null): SpaceDto | null` (the personal space for `null`, `null` for an id that is not listed); `AppShell({ me: { name: string; email: string }; spaces: readonly SpaceSummary[]; activeSpace: SpaceSummary; children })`; `AppShellContainer({ spaceId, children }: { spaceId: string | null; children: ReactNode })` (server: no profile → `redirectToSignIn()`; unknown space → `notFound()`); `SpaceSwitcher({ spaces, activeSpace }: { spaces: readonly SpaceSummary[]; activeSpace: SpaceSummary })` (the trigger's name `shell.space.current` needs the active space's name, which `AppShell` holds); `NavLinks({ spaceId })` (client: one `nav`, `aria-current="page"` from `usePathname()`); `ProfileSheet({ me, spaceId, api? })` (sign out: `POST /api/v1/auth/sign-out`, then `router.replace("/sign-in")` and `router.refresh()`). The shell renders `<main id="main">` around `children`; pages render their own `h1`. Catalog namespace `shell`.

- [ ] **Step 1: Write the failing tests**

`src/modules/spaces/ui/space-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { spaceDto } from "../../../../tests/support/ui/dto";
import { activeSpaceOf, personalSpaceOf } from "./space-helpers";

const personal = spaceDto();
const household = spaceDto({ id: "sp-household", name: "Household", kind: "SHARED", role: "MEMBER" });

describe("space helpers (ruling P125)", () => {
  it("finds the personal space whatever the order", () => {
    expect(personalSpaceOf([household, personal]).id).toBe("sp-personal");
  });

  it("takes the URL's space, the personal one without an id, and nothing for a space not listed", () => {
    expect(activeSpaceOf([personal, household], "sp-household")?.name).toBe("Household");
    expect(activeSpaceOf([personal, household], null)?.id).toBe("sp-personal");
    expect(activeSpaceOf([personal, household], "sp-gone")).toBeNull();
  });
});
```

`src/modules/spaces/ui/shell.test.tsx` (mock `next/navigation`'s `usePathname` to `"/spaces/sp-personal"`, and `useRouter` as in Task 8a):

```tsx
describe("app shell (HU-E9-01)", () => {
  const spaces = [
    { id: "sp-personal", name: "Personal", kind: "PERSONAL", role: "OWNER" },
    { id: "sp-household", name: "Household", kind: "SHARED", role: "MEMBER" },
  ] as const;

  it("shows the active space, the user menu and the navigation of the space", async () => {
    const { container } = renderWithIntl(
      <AppShell me={{ name: "Ana", email: "ana@example.com" }} spaces={spaces} activeSpace={spaces[0]}>
        <h1>Inicio</h1>
      </AppShell>,
    );
    expect(screen.getByRole("button", { name: "Espacio actual: Personal. Cambiar de espacio" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Perfil de Ana" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(within(nav).getByRole("link", { name: "Inicio" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Movimientos" })).toHaveAttribute("href", "/spaces/sp-personal/transactions");
    expect(within(nav).getByRole("link", { name: "Registrar movimiento" })).toHaveAttribute("href", "/spaces/sp-personal/new");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("lists every current space in the switcher and links to the chosen one", async () => {
    renderWithIntl(
      <AppShell me={{ name: "Ana", email: "ana@example.com" }} spaces={spaces} activeSpace={spaces[0]}>
        <h1>Inicio</h1>
      </AppShell>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Espacio actual: Personal. Cambiar de espacio" }));
    const sheet = screen.getByRole("dialog", { name: "Espacios" });
    expect(within(sheet).getByRole("link", { name: /Personal/ })).toHaveAttribute("aria-current", "true");
    expect(within(sheet).getByRole("link", { name: /Household/ })).toHaveAttribute("href", "/spaces/sp-household");
  });

  it("makes the chosen space the active one in the shell", () => {
    renderWithIntl(
      <AppShell me={{ name: "Ana", email: "ana@example.com" }} spaces={spaces} activeSpace={spaces[1]}>
        <h1>Inicio</h1>
      </AppShell>,
    );
    expect(screen.getByRole("button", { name: "Espacio actual: Household. Cambiar de espacio" })).toBeInTheDocument();
  });
});
```

`src/modules/identity/ui/profile-sheet.test.tsx`:

```tsx
describe("profile sheet (HU-E9-01)", () => {
  it("shows the person, links to settings and accounts, and signs out to the sign-in screen", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/auth/sign-out": () => new Response(null, { status: 204 }) });
    renderWithIntl(<ProfileSheet me={{ name: "Ana", email: "ana@example.com" }} spaceId="sp-personal" api={api} />);
    await userEvent.click(screen.getByRole("button", { name: "Perfil de Ana" }));
    const sheet = screen.getByRole("dialog", { name: "Ana" });
    expect(within(sheet).getByText("ana@example.com")).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: /Ajustes/ })).toHaveAttribute("href", "/settings");
    expect(within(sheet).getByRole("link", { name: /Cuentas/ })).toHaveAttribute("href", "/spaces/sp-personal/accounts");
    await userEvent.click(within(sheet).getByRole("button", { name: "Cerrar sesión" }));
    expect(requests[0]!.method).toBe("POST");
    expect(router.replace).toHaveBeenCalledWith("/sign-in");
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/spaces/ui` and `pnpm exec vitest run --project ui src/modules/spaces/ui src/modules/identity/ui/profile-sheet.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`space-helpers.ts` as in the Interfaces. `AppShell` (server-renderable) composes: a 60 px header (the space button opening `SpaceSwitcher`, then the `ProfileSheet` trigger, an `Avatar` in a 40 px circle) inside a `max-w-[1200px]` frame, and one `NavLinks` labelled `shell.nav.main` that CSS restyles by breakpoint: under 1024 px a bar fixed at the bottom (76 px high, safe-area padding; Inicio, the 56 px round Registrar link in the center, Movimientos), from 1024 px a 240 px left rail (the Desktop artboard: logo, Registrar as a primary button, then Inicio and Movimientos). One element per destination in both layouts, so there is one landmark and the Registrar link keeps the accessible name `shell.nav.record` everywhere (its short label `shell.nav.recordShort` is visible on the rail only). Plan and Saldos are not rendered, not even disabled, until HU-E9-08 and HU-E9-07 build their screens (rulings P126 and P141), so the bottom bar has three slots. `SpaceSwitcher` lists each space as a link (`/spaces/<id>`) with its initial, its name and `shell.role.<ROLE>` (or `shell.space.onlyYou` for the personal space), `aria-current="true"` on the active one; no create or join actions (HU-E9-05). `ProfileSheet` holds the avatar, the name as the sheet's title, the email, a link to `/settings` (`shell.profile.settings` with its hint), a link to the space's accounts and the sign-out button; the Categories, Members and Installation rules entries come with HU-E9-04, HU-E9-05 and HU-E9-14 (ruling P126).

`AppShellContainer`: `const me = await getMe(); if (!me) await redirectToSignIn();` then `getSpaces()`, `activeSpaceOf(spaces, spaceId) ?? notFound()`. `redirectToSignIn` (in `server.ts`) redirects to `/sign-in?next=<encoded x-hearth-path>` (or `/sign-in` when the path is `/`).

Pages: `(app)/page.tsx` → `redirect(\`/spaces/${personalSpaceOf(await getSpaces()).id}\`)` after the same `getMe()` check; `(app)/spaces/[spaceId]/layout.tsx` → `<AppShellContainer spaceId={(await params).spaceId}>{children}</AppShellContainer>`; `(app)/settings/layout.tsx` → `<AppShellContainer spaceId={null}>`; `(app)/spaces/[spaceId]/page.tsx` → for now `<h1>{t("home.title")}</h1>` (Task 17b fills the Home); `(app)/error.tsx` (client, `"use client"`) → a `ProblemNotice` of `{ code: "Unknown", requestId: error.digest ?? null, … }` with a retry button calling `reset()` (Next.js hides server error messages in production, ruling P127); `(app)/not-found.tsx` → `shell.notFound` with a link to `/`.

Catalog keys (`shell`), es / en: `nav.main` Principal / Main; `nav.home` Inicio / Home; `nav.transactions` Movimientos / Transactions; `nav.record` Registrar movimiento / Record a transaction; `nav.recordShort` Registrar / Record; `space.current` Espacio actual: {name}. Cambiar de espacio / Current space: {name}. Switch space; `space.title` Espacios / Spaces; `space.onlyYou` Solo tú / Only you; `role.OWNER` Propietario / Owner; `role.ADMIN` Administrador / Admin; `role.MEMBER` Miembro / Member; `role.VIEWER` Lector / Viewer; `profile.open` Perfil de {name} / {name}'s profile; `profile.settings` Ajustes / Settings; `profile.settingsHint` Formatos, hora, zona horaria, tema e idioma / Formats, time, time zone, theme and language; `profile.accounts` Cuentas / Accounts; `profile.signOut` Cerrar sesión / Sign out; `notFound` Esta página no existe o ya no está disponible. / This page does not exist or is no longer available.; and `home.title` Inicio / Home.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, `pnpm build`, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/spaces/ui src/modules/identity/ui "src/app/(web)/(app)" src/shared/ui/api/server.ts src/i18n/messages
git commit -m "feat(spaces): add the app shell with the space switcher and the user menu (Refs #69)"
```

**Split point.** Preflight A measured this task at 496 changed lines, at the limit. When the staged candidate is over ~500, implement and commit it in two passes, each green on its own (every gate run before each commit). The components come first, because `AppShell` renders `ProfileSheet` and both component tests need the `shell` keys (missing messages throw); not the other way round, as the preflight report suggested:

```bash
# 9 (1/2), about 390 lines: space-helpers.ts and its test, space-switcher.tsx, nav-links.tsx, app-shell.tsx,
# shell.test.tsx, profile-sheet.tsx and its test, both ui/index.ts files (spaces exports personalSpaceOf only) and the
# shell and home catalog keys. No route uses them yet.
git add src/modules/spaces/ui src/modules/identity/ui src/i18n/messages
git commit -m "feat(spaces): add the app shell components, the space switcher and the user menu (Refs #69)"
# 9 (2/2), about 105 lines: app-shell-container.tsx (and its export), redirectToSignIn, the (app) pages, error.tsx and
# not-found.tsx.
git add src/modules/spaces/ui "src/app/(web)/(app)" src/shared/ui/api/server.ts
git commit -m "feat(spaces): serve the app shell on the space pages and redirect an expired session (Refs #69)"
```

---

### Task 10: End-to-end harness and the first @e2e scenarios

Playwright + playwright-bdd against the production build (the standalone server, as the Docker image runs it) and a disposable PostgreSQL started through the Docker CLI, like the test projects do. The run fixes "now" for the API and for the server renders with `HEARTH_E2E_FIXED_NOW`, and every test gets its own client address so the auth throttles see distinct visitors (ruling P133). Lands HU-E9-01's two `@e2e` scenarios and HU-E9-02's "Spanish is the default locale", and the CI job that runs them.

**Files:**
- Create: `playwright.config.ts`, `scripts/e2e-server.mjs`, `tests/e2e/support/global-teardown.ts`, `tests/e2e/support/fixtures.ts`, `tests/e2e/support/world.ts`, `tests/e2e/support/api.ts`, `tests/e2e/steps/auth.steps.ts`, `tests/e2e/features/app-shell.feature`, `tests/e2e/features/i18n.feature`, `src/shared/infrastructure/system-clock.test.ts`
- Modify: `package.json`, `pnpm-lock.yaml`, `src/shared/infrastructure/env.ts`, `src/shared/infrastructure/env.test.ts`, `src/shared/infrastructure/system-clock.ts`, `src/composition/container.ts`, `src/i18n/request.ts`, `.gitignore`, `.prettierignore`, `eslint.config.mjs`, `tsconfig.json`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `serverNow` (Task 6); every screen of Tasks 8a–9.
- Produces: `Env.HEARTH_E2E_FIXED_NOW?: string` (an ISO instant); `clockFrom(fixedNow: string | undefined): Clock` (`src/shared/infrastructure/system-clock.ts`); `pnpm test:e2e` (`bddgen && playwright test`); the playwright project `e2e` (Pixel 7, `es-CO`, `America/Bogota`, base URL `http://127.0.0.1:3100`); test support used by Tasks 18 and 19: `test`, `Given`, `When`, `Then` (`tests/e2e/support/fixtures.ts`), `World` with `page`, `t(key, values?)` (the es catalog), `email(alias)` (a per-test unique address for a scenario's email), `signUp(name, options?: { timezone?: string })`, `user` (`{ name, email, spaceId }`), `accounts` and `categories` (name → id), `headers(extra)` (merges `x-forwarded-for` with extra request headers) and `api` (`SeedApi`: `post(path, body)`, `patch(path, body)`, `get(path)`, each through `page.request` with the test's headers, throwing on a non-2xx answer).

- [ ] **Step 1: Install**

`pnpm add -D @playwright/test@1.63.0 playwright-bdd@9.2.1` then `pnpm exec playwright install chromium` (browsers are downloaded by Playwright's own CLI, not by `pnpm install`; CI uses `--with-deps`).

- [ ] **Step 2: Write the failing unit tests of the clock seam**

`src/shared/infrastructure/system-clock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clockFrom, SystemClock } from "./system-clock";

describe("clockFrom (ruling P133)", () => {
  it("fixes the clock at HEARTH_E2E_FIXED_NOW, else reads the system clock", () => {
    expect(clockFrom("2026-11-01T04:30:00Z").now().toISOString()).toBe("2026-11-01T04:30:00.000Z");
    expect(clockFrom(undefined)).toBeInstanceOf(SystemClock);
  });
});
```

`src/shared/infrastructure/env.test.ts`, inside `describe("loadEnv")`:

```ts
  it("accepts an ISO instant for the e2e clock and refuses anything else", () => {
    expect(loadEnv({ ...valid, HEARTH_E2E_FIXED_NOW: "2026-11-01T04:30:00Z" }).HEARTH_E2E_FIXED_NOW).toBe(
      "2026-11-01T04:30:00Z",
    );
    expect(() => loadEnv({ ...valid, HEARTH_E2E_FIXED_NOW: "tomorrow" })).toThrow(/HEARTH_E2E_FIXED_NOW/);
  });
```

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/shared/infrastructure`
Expected: FAIL — `clockFrom` is not exported; `HEARTH_E2E_FIXED_NOW` is dropped.

- [ ] **Step 4: Implement the seam**

`env.ts`: after `RECURRENCE_JOB_INTERVAL_SECONDS: …default(300),` add:

```ts
  /**
   * Ruling P133, e2e only: fixes the API's clock (and, through serverNow, the server renders') at this instant, so a
   * scenario's "Given the Clock reads …" holds on both sides. Never set in production: `docker compose` does not pass it.
   */
  HEARTH_E2E_FIXED_NOW: z.iso.datetime({ offset: true }).optional(),
```

`system-clock.ts`: add `import { FixedClock, type Clock } from "@/shared/kernel";` (replacing the type-only import) and:

```ts
/** Ruling P133: the e2e run's fixed instant, else the system clock. */
export const clockFrom = (fixedNow: string | undefined): Clock =>
  fixedNow ? new FixedClock(new Date(fixedNow)) : new SystemClock();
```

`container.ts`: import `clockFrom` beside `SystemClock` and replace `const clock = options.clock ?? new SystemClock();` with `const clock = options.clock ?? clockFrom(env.HEARTH_E2E_FIXED_NOW);` (drop the `SystemClock` import if nothing else uses it). `src/i18n/request.ts`: return `now: serverNow()` beside `timeZone` (import from `@/shared/ui/time/server-now`).

- [ ] **Step 5: Write the harness**

`scripts/e2e-server.mjs`:

```js
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import { runMigrations } from "./migrate.mjs";

/**
 * Ruling P133: the e2e server. A disposable PostgreSQL through the Docker CLI (or TEST_DATABASE_URL), every migration,
 * then the standalone build exactly as the Docker image runs it. Playwright starts this script and stops it at the end.
 */
const PORT = process.env.E2E_PORT ?? "3100";
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();
let container;
let server;

const stop = () => {
  server?.kill("SIGTERM");
  server = undefined;
  if (container) {
    try {
      docker("rm", "-f", "--volumes", container);
    } catch (error) {
      console.warn(`Could not remove the e2e database container ${container}`, error);
    }
    container = undefined;
  }
};
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => (stop(), process.exit(0)));
process.on("exit", stop);

if (!existsSync(".next/standalone/server.js")) {
  console.error("Missing .next/standalone/server.js: run `pnpm build` first.");
  process.exit(1);
}

let url = process.env.TEST_DATABASE_URL;
if (!url) {
  container = docker(
    "run", "-d", "--rm", "--label", "hearth.test=e2e",
    "-e", "POSTGRES_DB=hearth", "-e", "POSTGRES_USER=hearth", "-e", "POSTGRES_PASSWORD=hearth",
    "--tmpfs", "/var/lib/postgresql", "-p", "127.0.0.1::5432", "postgres:18.6-alpine",
  );
  url = `postgres://hearth:hearth@127.0.0.1:${docker("port", container, "5432/tcp").split("\n")[0].split(":").pop()}/hearth`;
}
for (let deadline = Date.now() + 60_000; ; ) {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.query("SELECT 1");
    break;
  } catch (error) {
    if (Date.now() > deadline) throw new Error("PostgreSQL not ready after 60 s", { cause: error });
    await sleep(500);
  } finally {
    await client.end().catch(() => undefined);
  }
}
await runMigrations(url, "drizzle");
// The standalone server serves .next/static only from beside itself, as the Dockerfile copies it.
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
server = spawn(process.execPath, [".next/standalone/server.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT,
    HOSTNAME: "127.0.0.1",
    DATABASE_URL: url,
    BETTER_AUTH_SECRET: "e2e-only-secret-0123456789abcdef0123",
    BETTER_AUTH_URL: `http://127.0.0.1:${PORT}`,
    APP_TIMEZONE: "America/Bogota",
    LOG_LEVEL: "error",
    RECURRENCE_JOB_INTERVAL_SECONDS: "0",
    INTERNAL_API_ORIGIN: `http://127.0.0.1:${PORT}`,
    HEARTH_E2E_FIXED_NOW: process.env.HEARTH_E2E_FIXED_NOW ?? "2026-11-01T04:30:00Z",
  },
});
server.on("exit", (code) => {
  stop();
  process.exit(code ?? 1);
});
```

`playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

const BASE_URL = "http://127.0.0.1:3100";

const bddDir = defineBddConfig({
  features: "tests/e2e/features/*.feature",
  steps: ["tests/e2e/steps/*.ts", "tests/e2e/support/fixtures.ts"],
  outputDir: "tests/e2e/.features-gen",
});

/** HU-E9-*: @e2e scenarios against the standalone build and a disposable PostgreSQL (ruling P132). */
export default defineConfig({
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"]],
  globalTeardown: "./tests/e2e/support/global-teardown.ts",
  use: { baseURL: BASE_URL, locale: "es-CO", timezoneId: "America/Bogota", trace: "retain-on-failure" },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `${BASE_URL}/api/v1/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // POSIX: lets scripts/e2e-server.mjs remove its database (Windows always force-kills: see globalTeardown).
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
  projects: [{ name: "e2e", testDir: bddDir, use: { ...devices["Pixel 7"] } }],
});
```

`tests/e2e/support/global-teardown.ts` (without `gracefulShutdown`, Playwright 1.63 stops the web server with SIGKILL on POSIX, and on Windows it always runs `taskkill /pid … /T /F`, so `scripts/e2e-server.mjs`'s SIGTERM and `exit` handlers never run and the database container outlives every run and every Ctrl-C):

```ts
import { execFileSync } from "node:child_process";

/**
 * Playwright force-kills the web server on Windows (taskkill /F) and, without `gracefulShutdown`, with SIGKILL elsewhere,
 * so the exit handler of scripts/e2e-server.mjs may never run: remove every e2e database container here.
 */
export default function globalTeardown(): void {
  const ids = execFileSync("docker", ["ps", "-aq", "--filter", "label=hearth.test=e2e"], { encoding: "utf8" })
    .split(/\s+/)
    .filter(Boolean);
  if (ids.length > 0) execFileSync("docker", ["rm", "-f", "--volumes", ...ids], { stdio: "ignore" });
}
```

(`globalTeardown` runs before Playwright stops the web server, so the server may log `Connection terminated unexpectedly` a few times from idle pg clients; the run stays green and the noise is expected.)

`tests/e2e/support/world.ts` implements `World` (Interfaces): `t(key, values)` walks `src/i18n/messages/es.json` (imported with `with { type: "json" }`) by the dotted key and replaces each `{name}` with `values[name]`, throwing on a missing key; `email("ana@example.com")` answers `ana+<8 hex chars of the test id>@example.com` (one Ana per test in one database); `headers(extra)` returns `{ "x-forwarded-for": this.ip, ...extra }` and `page.context().setExtraHTTPHeaders` is always called with it (the call replaces the previous set); `signUp(name, { timezone = "America/Bogota" })` posts `{ name, email: this.email(`${name.toLowerCase()}@example.com`), password: "123456789012", timezone }` to `/api/v1/auth/sign-up` through `page.request` (whose cookies are the page's), reads the personal space from `GET /api/v1/spaces` and stores `user`. `tests/e2e/support/fixtures.ts`:

```ts
import { createBdd, test as base } from "playwright-bdd";
import { World } from "./world";

let tests = 0;

/** Each test is one visitor with its own address, so the sign-up and sign-in throttles never meet (ruling P133). */
export const test = base.extend<{ world: World }>({
  world: async ({ page }, use, testInfo) => {
    tests += 1;
    const ip = `10.${testInfo.workerIndex % 250}.${Math.floor(tests / 250) % 250}.${(tests % 250) + 1}`;
    const world = new World(page, testInfo.testId, ip);
    await page.context().setExtraHTTPHeaders(world.headers());
    await use(world);
  },
});

export const { Given, When, Then } = createBdd(test);
```

`tests/e2e/features/app-shell.feature` holds HU-E9-01's two `@e2e` scenarios verbatim (`Feature: App shell and authentication screens`, "Sign up lands in the personal space", "Sign out returns to the sign-in screen"); `tests/e2e/features/i18n.feature` holds HU-E9-02's "Spanish is the default locale" (`Feature: Localized interface`). `tests/e2e/steps/auth.steps.ts`:

```ts
import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures";

const MENU_ITEMS: Record<string, string> = { "Sign out": "shell.profile.signOut" };

Given("a visitor on the sign-up screen", async ({ page }) => {
  await page.goto("/sign-up");
});

When(
  "the visitor enters the name {string}, the email {string} and a 12-character password and submits",
  async ({ page, world }, name: string, email: string) => {
    await page.getByLabel(world.t("auth.signUp.name")).fill(name);
    await page.getByLabel(world.t("auth.email")).fill(world.email(email));
    await page.getByLabel(world.t("auth.password")).fill("123456789012");
    await page.getByRole("button", { name: world.t("auth.signUp.submit") }).click();
  },
);

Then("the visitor lands on the home page of her personal space", async ({ page, world }) => {
  await expect(page).toHaveURL(/\/spaces\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: world.t("home.title") })).toBeAttached();
});

Then(
  "the shell shows {string} in the user menu and the personal space in the space switcher",
  async ({ page, world }, name: string) => {
    await expect(page.getByRole("button", { name: world.t("shell.profile.open", { name }) })).toBeVisible();
    await expect(page.getByRole("button", { name: world.t("shell.space.current", { name: "Personal" }) })).toBeVisible();
  },
);

Given("{string} is signed in", async ({ page, world }, name: string) => {
  await world.signUp(name);
  await page.goto("/");
});

When("{string} chooses {string} in the user menu", async ({ page, world }, name: string, item: string) => {
  await page.getByRole("button", { name: world.t("shell.profile.open", { name }) }).click();
  await page.getByRole("button", { name: world.t(MENU_ITEMS[item]!) }).click();
});

Then("the sign-in screen is shown", async ({ page, world }) => {
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { level: 1, name: world.t("auth.signIn.title") })).toBeVisible();
});

Then("opening the home page again redirects to the sign-in screen", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
});

Given("a visitor whose browser sends no supported language preference", async ({ page, world }) => {
  await page.context().setExtraHTTPHeaders(world.headers({ "accept-language": "fr-FR,fr;q=0.9" }));
});

When("the visitor opens the sign-in page", async ({ page }) => {
  await page.goto("/sign-in");
});

Then("the page is rendered in Spanish", async ({ page, world }) => {
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(world.t("auth.signIn.title"));
});
```

`package.json` scripts: `"test:e2e": "bddgen && playwright test"`. `.gitignore`, `.prettierignore` and `eslint.config.mjs`'s `globalIgnores` gain `tests/e2e/.features-gen/`, `test-results/` and `playwright-report/`; `tsconfig.json`'s `exclude` gains `"tests/e2e/.features-gen"`. `.github/workflows/ci.yml` gains, after the `test` job:

```yaml
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm build
      - name: End-to-end scenarios (standalone server, PostgreSQL through the Docker CLI)
        run: pnpm test:e2e
```

and `build-image`'s `needs: [lint, boundaries, typecheck, test]` becomes `needs: [lint, boundaries, typecheck, test, e2e]`.

- [ ] **Step 6: Run the scenarios and see them pass, then bite**

Run: `pnpm exec vitest run --project unit src/shared/infrastructure`, `pnpm build`, `pnpm test:e2e`.
Expected: the three scenarios PASS, and afterwards `docker ps -a --filter label=hearth.test=e2e` lists nothing. To see one bite, delete `ProfileSheet`'s sign-out call (the line `await api.POST("/api/v1/auth/sign-out");`) locally, `pnpm build` and `pnpm test:e2e`: "Sign out returns to the sign-in screen" fails on `Then the sign-in screen is shown`, because the public layout's real session check sends the still-signed-in person back to `/`; revert and rebuild. (A mutation of `safeNext` does not bite here: sign-out calls `router.replace("/sign-in")` directly, and `/` redirects through the proxy and `redirectToSignIn`, so neither path reads `next`; `safeNext` is pinned by its unit table and by Task 18's protected-page scenario.)

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml playwright.config.ts scripts/e2e-server.mjs tests/e2e src/shared/infrastructure \
  src/composition/container.ts src/i18n/request.ts .gitignore .prettierignore eslint.config.mjs tsconfig.json \
  .github/workflows/ci.yml
git commit -m "test(web): run the @e2e scenarios against the standalone build (Refs #69)"
```

---

### Task 11a: Settings — formats with a live preview, Default, Reset and locks

HU-E9-13's Formats section (the Settings artboard): number, date and time formats and the first weekday, each choice sent with `PATCH /api/v1/me` as it is made, optimistic and rolled back with its error next to the field (ruling P137); a preview of fixed samples with the same formatters as the rest of the app; the `settings.default` label, "Reset" and the `settings.locked` badge (scenarios "A field following the rule says Default …" and "A field locked by the installation rules shows a lock badge", and the component half of "Change the formats and see them applied at once").

**Files:**
- Create: `src/modules/identity/ui/settings/settings-form.tsx`, `src/modules/identity/ui/settings/format-preview.tsx`, `src/modules/identity/ui/settings/lock-badge.tsx`, `src/modules/identity/ui/settings/preference-row.tsx`, `src/modules/identity/ui/settings/settings-state.ts`, `src/modules/identity/ui/settings/settings-state.test.ts`, `src/modules/identity/ui/settings/settings-form.test.tsx`, `src/modules/identity/ui/settings/settings-container.tsx`, `src/app/(web)/(app)/settings/page.tsx`
- Modify: `src/modules/identity/ui/index.ts`, `tests/support/ui/dto.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `MeDto` (with Task 3's `defaults.timezone` and `defaults.locale`), `formatNumber`, `formatDate`, `formatTime`, `Formats`, `ChoiceGroup`, `Badge`, `Button`.
- Produces: `type FormatField = "numberFormat" | "dateFormat" | "timeFormat" | "weekStart"`; `interface Preferences { stored; effective; defaults; locked }` (the `MeDto["preferences"]` shape); `choose(preferences, field, value): { next: Preferences; patch: Record<FormatField, string | null> }` (choosing the rule's own value stores `null`, so the field follows the rule; ruling P137); `reset(preferences, field)` (`patch` `{ [field]: null }`); `rowState(preferences, field): "locked" | "default" | "custom"`; `FormatPreview({ formats }: { formats: Formats })` (`aria-live="polite"`); `LockBadge()`; `SettingsForm({ me, api? })` (client); `SettingsContainer()` (server: `getMe()`); the page `/settings`. Task 11b adds the other two sections to `SettingsForm`.

- [ ] **Step 1: Write the failing tests**

`src/modules/identity/ui/settings/settings-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { meDto } from "../../../../../tests/support/ui/dto";
import { choose, reset, rowState } from "./settings-state";

const preferences = meDto().preferences;

describe("settings state (HU-E9-13, ruling P137)", () => {
  it("stores a choice that differs from the rule, and clears one equal to it", () => {
    const comma = choose(preferences, "numberFormat", "COMMA_DOT");
    expect(comma.patch).toEqual({ numberFormat: "COMMA_DOT" });
    expect(comma.next.effective.numberFormat).toBe("COMMA_DOT");
    expect(rowState(comma.next, "numberFormat")).toBe("custom");
    const back = choose(comma.next, "numberFormat", "DOT_COMMA");
    expect(back.patch).toEqual({ numberFormat: null });
    expect(rowState(back.next, "numberFormat")).toBe("default");
  });

  it("resets a changed field to the rule", () => {
    const twelve = choose(preferences, "timeFormat", "H12").next;
    const { next, patch } = reset(twelve, "timeFormat");
    expect(patch).toEqual({ timeFormat: null });
    expect([next.stored.timeFormat, next.effective.timeFormat, rowState(next, "timeFormat")]).toEqual([null, "H24", "default"]);
  });

  it("marks a field the installation locks, whatever is stored", () => {
    const locked = { ...preferences, stored: { ...preferences.stored, dateFormat: "MDY" as const }, locked: ["dateFormat" as const] };
    expect(rowState(locked, "dateFormat")).toBe("locked");
    expect(rowState(locked, "timeFormat")).toBe("default");
  });
});
```

`src/modules/identity/ui/settings/settings-form.test.tsx` (mock `next/navigation`'s `useRouter` as in Task 8a):

```tsx
const patchedMe = (body: Record<string, unknown>, base = meDto()) => {
  const stored = { ...base.preferences.stored, ...body };
  const effective = Object.fromEntries(
    Object.entries(base.preferences.defaults).map(([k, v]) => [k, (stored as Record<string, unknown>)[k] ?? v]),
  );
  return { ...base, preferences: { ...base.preferences, stored, effective: { ...base.preferences.effective, ...effective } } };
};

describe("settings: formats (HU-E9-13)", () => {
  it("previews the installation's formats and stores each choice as it is made", async () => {
    const bodies: unknown[] = [];
    let me = meDto();
    const { api } = fakeApi({
      "PATCH /api/v1/me": async (request) => {
        const body = await request.json();
        bodies.push(body);
        me = patchedMe(body, me);
        return jsonResponse(me);
      },
    });
    const { container } = renderWithIntl(<SettingsForm me={meDto()} api={api} />);
    const preview = screen.getByRole("status");
    expect(preview).toHaveTextContent("1.234.567,89");
    expect(preview).toHaveTextContent("16/10/2026");
    expect(preview).toHaveTextContent("14:30");
    await userEvent.click(screen.getByRole("radio", { name: "1,234,567.89" }));
    await userEvent.click(screen.getByRole("radio", { name: "10/16/2026" }));
    await userEvent.click(screen.getByRole("radio", { name: "12 horas" }));
    await waitFor(() => expect(bodies).toEqual([{ numberFormat: "COMMA_DOT" }, { dateFormat: "MDY" }, { timeFormat: "H12" }]));
    expect(normalized(preview.textContent)).toContain("1,234,567.89");
    expect(normalized(preview.textContent)).toContain("10/16/2026");
    expect(normalized(preview.textContent)).toContain("2:30 PM");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("labels a field that follows the rule and offers Reset on a changed one", async () => {
    const twelve = patchedMe({ timeFormat: "H12" });
    const { api, requests } = fakeApi({ "PATCH /api/v1/me": () => jsonResponse(meDto()) });
    renderWithIntl(<SettingsForm me={twelve} api={api} />);
    const date = screen.getByRole("group", { name: "Fecha" });
    expect(within(date).getByText("Predeterminado")).toBeInTheDocument();
    expect(within(date).getByRole("radio", { name: "16/10/2026" })).toBeChecked();
    const time = screen.getByRole("group", { name: "Hora" });
    await userEvent.click(within(time).getByRole("button", { name: "Restablecer" }));
    expect(await requests[0]!.json()).toEqual({ timeFormat: null });
    expect(screen.getByRole("status")).toHaveTextContent("14:30");
    expect(within(time).getByText("Predeterminado")).toBeInTheDocument();
  });

  it("shows a locked field read-only with its effective value and keeps the others editable", () => {
    const base = meDto();
    const locked = {
      ...base,
      preferences: { ...base.preferences, stored: { ...base.preferences.stored, dateFormat: "MDY" }, locked: ["dateFormat"] },
    };
    renderWithIntl(<SettingsForm me={locked} api={fakeApi({}).api} />);
    const date = screen.getByRole("group", { name: "Fecha" });
    expect(within(date).getByText("Lo define tu instalación")).toBeInTheDocument();
    expect(within(date).getByRole("radio", { name: "16/10/2026" })).toBeChecked();
    for (const radio of within(date).getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(within(date).queryByRole("button", { name: "Restablecer" })).toBeNull();
    for (const radio of within(screen.getByRole("group", { name: "Hora" })).getAllByRole("radio")) expect(radio).toBeEnabled();
  });

  it("rolls a refused choice back and shows its error next to the field", async () => {
    const { api } = fakeApi({ "PATCH /api/v1/me": () => problemResponse(409, "PreferenceLocked") });
    renderWithIntl(<SettingsForm me={meDto()} api={api} />);
    const numbers = screen.getByRole("group", { name: "Números" });
    await userEvent.click(within(numbers).getByRole("radio", { name: "1,234,567.89" }));
    await waitFor(() => expect(within(numbers).getByRole("radio", { name: "1.234.567,89" })).toBeChecked());
    expect(within(numbers).getByText("Esta preferencia la define tu instalación.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1.234.567,89");
  });
});
```

(`normalized = (text) => (text ?? "").replace(/\s/g, " ")`; `meDto().preferences` gets `defaults.timezone`/`locale` in `tests/support/ui/dto.ts` already from Task 4b.)

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/identity/ui/settings` and `pnpm exec vitest run --project ui src/modules/identity/ui/settings`
Expected: FAIL.

- [ ] **Step 3: Implement**

`settings-state.ts`: pure functions of the Interfaces; `next.effective[field]` is `locked ? defaults[field] : (stored[field] ?? defaults[field])`, the API's own rule (HU-E1-15). `PreferenceRow` renders a `fieldset` (role `group`) whose `legend` is the field's label, the `ChoiceGroup` (`layout="segmented"`; its own `aria-label` repeats the legend), and on the label's line either `Badge` `settings.default`, a `ghost` `Button` `settings.reset`, or `LockBadge` (the `lock` icon and `settings.locked`); a locked row disables every option and shows no Reset; an error line under the group comes from `useProblemMessage`. Option labels are samples written by the formatters themselves for each choice (`formatNumber("1234567.89", { numberFormat: v })`, `formatDate("2026-10-16", { dateFormat: v })`), so the options never drift from the preview; the time options are `settings.timeFormat.H24` / `settings.timeFormat.H12` and the weekdays `settings.weekStart.MONDAY` / `SUNDAY`. `SettingsForm` holds `preferences` in state; a choice applies `choose` at once, sends `patch` through `api.PATCH("/api/v1/me", { body: patch })`, replaces the state with the answer's `preferences` on success, and on failure restores the previous state and keeps the problem on that row. The preview sits at the top in a `role="status"` box (`settings.preview.label` and the three samples on one line), fed by `preferences.effective`. `SettingsContainer` (server) renders `<SettingsForm me={(await getMe())!} />` (the shell already redirected a missing session); the page renders `h1` `settings.title` and the container.

Catalog keys (`settings`), es / en: `title` Ajustes / Settings; `preview.label` Así se verá / This is how it will look; `formats` Formatos / Formats; `numberFormat` Números / Numbers; `dateFormat` Fecha / Date; `timeFormat` Hora / Time; `timeFormat.H24` 24 horas / 24-hour; `timeFormat.H12` 12 horas / 12-hour; `weekStart` La semana empieza / The week starts on; `weekStart.MONDAY` Lunes / Monday; `weekStart.SUNDAY` Domingo / Sunday; `default` Predeterminado / Default; `reset` Restablecer / Reset; `locked` Lo define tu instalación / Set by your installation; and `errors.PreferenceLocked` Esta preferencia la define tu instalación. / Your installation sets this preference. (nest the field names as `field.numberFormat` … when a key would be both a message and a namespace, for example `settings.field.timeFormat` and `settings.timeFormat.H24`).

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/ui "src/app/(web)/(app)/settings/page.tsx" tests/support/ui/dto.ts src/i18n/messages
git commit -m "feat(identity): add the settings formats with a live preview, Default, Reset and locks (Refs #111)"
```

---

### Task 11b: Settings — region, theme and language

The other two sections of HU-E9-13: the time zone from a searchable list of IANA zones, the theme (system, light, dark: a device setting) and the language (`es`, `en`), with "Reset" storing the installation's zone or language (Task 3, ruling P137); choosing the language reloads the screen's texts and never moves a format (scenario "The language changes only the texts").

**Files:**
- Create: `src/modules/identity/ui/settings/time-zone-sheet.tsx`, `src/modules/identity/ui/settings/region-section.tsx`, `src/modules/identity/ui/settings/appearance-section.tsx`, `src/modules/identity/ui/settings/region-and-appearance.test.tsx`
- Modify: `src/modules/identity/ui/settings/settings-form.tsx`, `src/modules/identity/ui/settings/settings-state.ts`, `src/modules/identity/ui/settings/settings-state.test.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `allTimeZones`, `zoneCity`, `zoneOffset` (Task 6), `readTheme`, `saveTheme` (Task 7a), `Sheet`, `ChoiceGroup`.
- Produces: `chooseRegion(me: MeDto, field: "timezone" | "locale", value: string): { next: MeDto; patch: Record<string, string> }` and `regionState(me, field): "locked" | "default" | "custom"` (`custom` when the value differs from `preferences.defaults[field]`; Reset sends the default value, never `null`, because the API keeps both concrete, P64); `TimeZoneSheet({ value, onChoose })` (search field labelled `settings.timezone.search`, a list of radio choices "<city> (<offset>)", `settings.timezone.none` when nothing matches); the sections `Region` and `Appearance and language` in `SettingsForm` (headings `settings.formats`, `settings.region`, `settings.appearance`).

- [ ] **Step 1: Write the failing tests**

Add to `settings-state.test.ts`:

```ts
describe("region state (HU-E9-13, rulings P124 and P137)", () => {
  it("is custom when the zone or language differs from the installation's, and Reset sends that value", () => {
    const me = meDto({ timezone: "Europe/Madrid" });
    expect(regionState(me, "timezone")).toBe("custom");
    expect(chooseRegion(me, "timezone", me.preferences.defaults.timezone).patch).toEqual({ timezone: "America/Bogota" });
    expect(regionState(meDto(), "locale")).toBe("default");
  });
});
```

`region-and-appearance.test.tsx` (mock `useRouter`):

```tsx
describe("settings: region, theme and language (HU-E9-13)", () => {
  it("shows the three sections", () => {
    renderWithIntl(<SettingsForm me={meDto()} api={fakeApi({}).api} />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Formatos",
      "Región",
      "Apariencia e idioma",
    ]);
  });

  it("finds a zone by searching and stores it", async () => {
    const { api, requests } = fakeApi({ "PATCH /api/v1/me": () => jsonResponse(meDto({ timezone: "Europe/Madrid" })) });
    renderWithIntl(<SettingsForm me={meDto()} api={api} />);
    await userEvent.click(screen.getByRole("button", { name: /Zona horaria.*Bogota \(GMT-5\)/ }));
    const sheet = screen.getByRole("dialog", { name: "Zona horaria" });
    await userEvent.type(within(sheet).getByLabelText("Buscar zona horaria"), "madr");
    await userEvent.click(within(sheet).getByRole("radio", { name: /Madrid/ }));
    expect(await requests[0]!.json()).toEqual({ timezone: "Europe/Madrid" });
    await userEvent.click(screen.getByRole("button", { name: /Zona horaria/ }));
    await userEvent.type(screen.getByLabelText("Buscar zona horaria"), "zzz");
    expect(screen.getByText("Ninguna zona coincide con «zzz».")).toBeInTheDocument();
  });

  it("keeps the theme on the device", async () => {
    renderWithIntl(<SettingsForm me={meDto()} api={fakeApi({}).api} />);
    await userEvent.click(screen.getByRole("radio", { name: "Oscuro" }));
    expect(localStorage.getItem("hearth.theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("changes only the texts when the language changes", async () => {
    const custom = patchedMe({ numberFormat: "COMMA_DOT", timeFormat: "H12" });
    const english = { ...custom, locale: "en" };
    const { api, requests } = fakeApi({ "PATCH /api/v1/me": () => jsonResponse(english) });
    const view = renderWithIntl(<SettingsForm me={custom} api={api} />);
    await userEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(await requests[0]!.json()).toEqual({ locale: "en" });
    expect(router.refresh).toHaveBeenCalled();
    view.unmount();
    renderWithIntl(<SettingsForm me={english} api={api} />, { locale: "en" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Settings");
    expect(normalized(screen.getByRole("status").textContent)).toContain("1,234,567.89");
    expect(normalized(screen.getByRole("status").textContent)).toContain("2:30 PM");
  });
});
```

(`SettingsForm` renders the page's `h1` itself so the screen test sees it; move it out of the page in Task 11a's code if it was put there. `patchedMe` and `normalized` are shared helpers: move them to `tests/support/ui/dto.ts` as `patchedMe` and `normalized`.)

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/identity/ui/settings` and `pnpm exec vitest run --project ui src/modules/identity/ui/settings`
Expected: FAIL.

- [ ] **Step 3: Implement**

`RegionSection`: one row "Zona horaria" — a button showing `zoneCity` and `zoneOffset(zone, new Date())` with the Default badge or Reset, opening `TimeZoneSheet`; its hint `settings.timezone.hint`. `TimeZoneSheet` filters `allTimeZones()` by the search (case-insensitive, on the zone name and its city, underscores as spaces), shows at most 50 matches (a long list stays fast), and closes when a zone is chosen. The design's "Moneda de tus espacios" row is not built: no story asks for it (ruling P126). `AppearanceSection`: the theme `ChoiceGroup` (`settings.theme.system` / `light` / `dark`, initial value `readTheme(localStorage)` read after mount, `saveTheme` on change) and the language `ChoiceGroup` (`Español`, `English` — each language named in itself, in both catalogs) with the hint `settings.language.hint`; a language change PATCHes `{ locale }` and calls `router.refresh()` on success. Region and language rows also honour `preferences.locked` (`timezone`, `locale`) like the formats.

Catalog keys (`settings`), es / en: `region` Región / Region; `appearance` Apariencia e idioma / Appearance and language; `timezone` Zona horaria / Time zone; `timezone.hint` Define el día y la hora de cada movimiento que registras. / Sets the day and time of every transaction you record.; `timezone.search` Buscar zona horaria / Search time zone; `timezone.none` Ninguna zona coincide con «{query}». / No time zone matches “{query}”.; `theme` Tema / Theme; `theme.system` Sistema / System; `theme.light` Claro / Light; `theme.dark` Oscuro / Dark; `language` Idioma / Language; `language.hint` Solo cambia los textos. Los formatos de arriba no dependen del idioma. / Only the texts change. The formats above do not depend on the language. (Split message/namespace collisions as in Task 11a.)

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/ui/settings tests/support/ui/dto.ts src/i18n/messages
git commit -m "feat(identity): add the settings region, theme and language (Refs #111)"
```

---

### Task 12: The accounts screen

The Accounts artboard (scenario "Accounts screen shows types, balances and totals" at component level): the space's accounts grouped by type, each with its type icon and color, institution and last four digits, its balance, a card's available credit and next payment date, "outside available" when the account does not count there; the "Available" and "Net worth" totals of the API; archived accounts in their own section (ruling P131).

**Files:**
- Create: `src/modules/accounts/ui/{account-sections.ts, account-sections.test.ts, account-look.ts, account-row.tsx, accounts-screen.tsx, accounts-container.tsx, accounts.test.tsx, index.ts}`, `src/app/(web)/(app)/spaces/[spaceId]/accounts/page.tsx`
- Modify: `tests/support/ui/dto.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `AccountDto`, `AccountListDto`, `MeDto` (Task 4b); `formatMoney`, `formatDate`, `formatNumber`, `Formats` (Task 6); `SymbolIcon`, `paletteVars`, `ProblemNotice`; `loaded`, `serverApi`, `getMe`.
- Produces: `ACCOUNT_SECTIONS` (`everyday`: BANK, WALLET, CASH; `cards`: CREDIT_CARD; `savings`: SAVINGS, INVESTMENT; `debts`: LOAN; `other`: OTHER; `funds`: SHARED_FUND, in that order); `sectionsOf(items: readonly AccountDto[]): { active: { key: SectionKey; accounts: AccountDto[] }[]; archived: AccountDto[] }` (empty sections dropped, API order kept); `TYPE_COLORS: Record<AccountType, PaletteKey>` (the look of an account without a color: CASH PINE, BANK STEEL, WALLET PINE, CREDIT_CARD PLUM, SAVINGS SAND, INVESTMENT SAND, LOAN EMBER, OTHER GRAPHITE, SHARED_FUND TEAL — UI only, from the artboard); `colorOf(account): PaletteKey`; `rateText(rate: string, formats): string` (`"11.2000"` → `11,2`); `AccountRow({ account, formats, actions? })` (the icon box carries `data-icon` and `data-color` for the e2e checks); `AccountsScreen({ spaceId, list, formats })`; `loadAccounts(api: Api, spaceId: string): Promise<Loaded<AccountListDto>>` (`GET …/accounts?archived=true`); `AccountsContainer({ spaceId })`; `accountDto(overrides?)` test builder. Task 13 passes `actions` (archive, restore).

- [ ] **Step 1: Write the failing tests**

`src/modules/accounts/ui/account-sections.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { accountDto } from "../../../../tests/support/ui/dto";
import { colorOf, rateText, sectionsOf } from "./account-sections";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";

describe("account sections (HU-E9-03, ruling P131)", () => {
  it("groups active accounts by type in the screen's order and sets archived ones apart", () => {
    const items = [
      accountDto({ id: "a-visa", name: "Visa", type: "CREDIT_CARD" }),
      accountDto({ id: "a-bank", name: "Bancolombia", type: "BANK" }),
      accountDto({ id: "a-old", name: "Old wallet", type: "WALLET", archivedAt: "2026-10-01T12:00:00.000Z" }),
      accountDto({ id: "a-nequi", name: "Nequi", type: "WALLET" }),
    ];
    const { active, archived } = sectionsOf(items);
    expect(active.map((s) => [s.key, s.accounts.map((a) => a.name)])).toEqual([
      ["everyday", ["Bancolombia", "Nequi"]],
      ["cards", ["Visa"]],
    ]);
    expect(archived.map((a) => a.name)).toEqual(["Old wallet"]);
  });

  it("takes the account's color, else its type's, and writes rates in the number format", () => {
    expect(colorOf(accountDto({ type: "BANK", color: null }))).toBe("STEEL");
    expect(colorOf(accountDto({ type: "BANK", color: "ROSE" }))).toBe("ROSE");
    expect(rateText("11.2000", BUILT_IN_FORMATS)).toBe("11,2");
    expect(rateText("1.8900", { ...BUILT_IN_FORMATS, numberFormat: "COMMA_DOT" })).toBe("1.89");
  });
});
```

`src/modules/accounts/ui/accounts.test.tsx`:

```tsx
const list = {
  items: [
    accountDto({
      id: "a-bank", name: "Bancolombia", type: "BANK", balance: cop(4_415_000), institution: "Bancolombia",
      lastFour: "1203", color: "STEEL", icon: "bank", includeInAvailable: true,
    }),
    accountDto({ id: "a-nequi", name: "Nequi", type: "WALLET", balance: cop(500_000), icon: "wallet" }),
    accountDto({
      id: "a-visa", name: "Visa", type: "CREDIT_CARD", balance: cop(-350_000), icon: "card", includeInAvailable: false,
      terms: { ...accountDto().terms, creditLimit: cop(5_000_000), paymentDay: 15 },
      derived: { ...accountDto().derived, availableCredit: cop(4_650_000), nextPaymentDate: "2026-11-15" },
    }),
    accountDto({ id: "a-old", name: "Old wallet", type: "WALLET", archivedAt: "2026-10-01T12:00:00.000Z" }),
  ],
  totals: { available: cop(4_915_000), netWorth: cop(4_565_000) },
};
const norm = (text: string | null) => (text ?? "").replace(/\s/g, " ");

describe("accounts screen (HU-E9-03)", () => {
  it("shows types, balances, card figures and the space's totals", async () => {
    const { container } = renderWithIntl(<AccountsScreen spaceId="sp-personal" list={list} formats={BUILT_IN_FORMATS} />);
    const totals = screen.getByRole("region", { name: "Totales" });
    expect(norm(totals.textContent)).toContain("Disponible$ 4.915.000");
    expect(norm(totals.textContent)).toContain("Patrimonio neto$ 4.565.000");
    const bank = screen.getByRole("listitem", { name: /Bancolombia/ });
    expect(norm(bank.textContent)).toContain("$ 4.415.000");
    expect(norm(bank.textContent)).toContain("Bancolombia ···1203");
    expect(bank.querySelector("[data-icon='bank'][data-color='STEEL']")).not.toBeNull();
    const visa = screen.getByRole("listitem", { name: /Visa/ });
    expect(norm(visa.textContent)).toContain("−$ 350.000");
    expect(norm(visa.textContent)).toContain("Disponible $ 4.650.000");
    expect(norm(visa.textContent)).toContain("Paga antes del 15/11/2026");
    expect(norm(visa.textContent)).toContain("fuera del disponible");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Bancos, billeteras y efectivo",
      "Tarjetas de crédito",
      "Archivadas",
    ]);
    const archived = screen.getByRole("region", { name: "Archivadas" });
    expect(within(archived).getByText("Old wallet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nueva cuenta" })).toHaveAttribute("href", "/spaces/sp-personal/accounts/new");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("loads every account, archived ones included, from the API", async () => {
    const { api, requests } = fakeApi({ "GET /api/v1/spaces/{spaceId}/accounts": () => jsonResponse(list) });
    expect(await loadAccounts(api, "sp-personal")).toEqual({ ok: true, data: list });
    expect(new URL(requests[0]!.url).searchParams.get("archived")).toBe("true");
  });
});
```

(`loadAccounts` lives in `accounts-container.tsx` but is pure over the `Api`; the test mocks `next/headers` and `next/navigation` to empty modules, as Task 4b's server test does, because the file imports `server.ts`. `accountDto()` in `tests/support/ui/dto.ts`: a BANK account `a-1` "Cuenta" of `sp-personal` with `cop(0)` balances, every attribute and term `null`, every derived figure `null`, `icon` "bank", `includeInAvailable` true, `includeInNetWorth` true, `archivedAt` null.)

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/accounts/ui` and `pnpm exec vitest run --project ui src/modules/accounts/ui`
Expected: FAIL.

- [ ] **Step 3: Implement**

`account-sections.ts` and `account-look.ts` (`TYPE_COLORS`, `colorOf`) as in the Interfaces; `rateText` strips trailing zeros and the point before `formatNumber`. `AccountRow` follows the artboard's row: a 40 px rounded box with `paletteVars(colorOf(account))` and `SymbolIcon name={account.icon}` (`data-icon`, `data-color`), the name, a detail line and the balance on the right (`text-owe` when negative) with `accounts.outsideAvailable` under it when `includeInAvailable` is false. The detail line joins with " · ": the institution and `···<lastFour>` (as "Bancolombia ···1203"); for a card `accounts.card.limit` with the limit, `accounts.card.available` with `derived.availableCredit` and `accounts.card.payBy` with `derived.nextPaymentDate` in the date format, each only when present; for savings `accounts.savings.rate` with `rateText(terms.annualRate)` and `accounts.savings.maturity` with the maturity date; for a loan `accounts.loan.principal` and `accounts.loan.months`. The row is an `li` named by `aria-labelledby` its name. `AccountsScreen`: the header (back link to the space's home, `h1` `accounts.title`, the "+" link `accounts.new` to `…/accounts/new`), a `section` labelled `accounts.totals` with `accounts.available` and `accounts.netWorth` from `list.totals`, then one `section` per active section (`h2` `accounts.section.<key>`, a `ul`), then the archived `section` (`h2` `accounts.archived`) when any. No per-section totals: only the API's totals are figures (ruling P131). `AccountsContainer` (server): `const [me, accounts] = await Promise.all([getMe(), loadAccounts(await serverApi(), spaceId)])`, a `ProblemNotice` when not ok, else the screen with `me!.preferences.effective`. The page reads `params.spaceId`.

Catalog keys (`accounts`), es / en: `title` Cuentas / Accounts; `new` Nueva cuenta / New account; `totals` Totales / Totals; `available` Disponible / Available; `netWorth` Patrimonio neto / Net worth; `section.everyday` Bancos, billeteras y efectivo / Banks, wallets and cash; `section.cards` Tarjetas de crédito / Credit cards; `section.savings` Ahorros e inversiones / Savings and investments; `section.debts` Deudas / Debts; `section.other` Otras / Other; `section.funds` Fondos compartidos / Shared funds; `archived` Archivadas / Archived; `outsideAvailable` fuera del disponible / outside available; `card.limit` Cupo {amount} / Limit {amount}; `card.available` Disponible {amount} / Available {amount}; `card.payBy` Paga antes del {date} / Pay by {date}; `savings.rate` {rate} % E.A. / {rate}% APY; `savings.maturity` Vence {date} / Matures {date}; `loan.principal` Crédito {amount} / Loan {amount}; `loan.months` {months} meses / {months} months; `backHome` Volver a Inicio / Back to Home.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/accounts/ui "src/app/(web)/(app)/spaces/[spaceId]/accounts/page.tsx" tests/support/ui/dto.ts src/i18n/messages
git commit -m "feat(accounts): add the accounts screen with types, balances and totals (Refs #71)"
```

---

### Task 13: Create, archive and restore accounts

The NewAccount artboard: the type chosen first, then only that type's attributes and the two switches (ruling P131); the type cannot change afterwards (the form only creates). Archive from the account's sheet with a confirmation, restore from the archived section (Task 2's endpoint). Adds the amount parser every form uses (ruling P138).

**Files:**
- Create: `src/shared/ui/format/amount-input.ts`, `src/shared/ui/format/amount-input.test.ts`, `src/modules/accounts/ui/{account-fields.ts, account-fields.test.ts, new-account-form.tsx, new-account-form.test.tsx, account-actions.tsx, account-actions.test.tsx}`, `src/app/(web)/(app)/spaces/[spaceId]/accounts/new/page.tsx`
- Modify: `src/modules/accounts/ui/accounts-screen.tsx`, `src/modules/accounts/ui/account-row.tsx`, `src/modules/accounts/ui/index.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `currencyOf` (Task 6), `ChoiceGroup`, `TextField`, `Switch`, `Sheet`, `Button`, `fieldOf`, `useProblemMessage`, `browserApi`, `SpaceDto`.
- Produces:
  - `amount-input.ts`: `parseDecimal(text: string, numberFormat: NumberFormat): string | null` (group separators optional, one decimal separator of the format: `"4.000.000"` → `"4000000"`, `"1,89"` → `"1.89"` in `DOT_COMMA`; letters, two decimal separators or misplaced groups → `null`); `minorOf(decimal: string, exponent: number): string | null` (more decimals than the exponent → `null`; `"85000"`, 2 → `"8500000"`).
  - `account-fields.ts`: `PERSONAL_TYPES` (`BANK`, `WALLET`, `CASH`, `CREDIT_CARD`, `SAVINGS`, `INVESTMENT`, `LOAN`, `OTHER`, the artboard's order), `type AccountField = "institution" | "lastFour" | "creditLimit" | "cutOffDay" | "paymentDay" | "monthlyRate" | "annualRate" | "termDays" | "maturityDate" | "principal" | "termMonths"`, `FIELDS_BY_TYPE: Record<AccountType, readonly AccountField[]>` (BANK and WALLET: institution, lastFour; CASH: none; CREDIT_CARD: institution, lastFour, creditLimit, cutOffDay, paymentDay, monthlyRate; SAVINGS: institution, lastFour, annualRate, termDays, maturityDate; INVESTMENT, OTHER and SHARED_FUND: institution; LOAN: institution, principal, annualRate, termMonths — the API's own allow-list, HU-E2-06), `OWED_TYPES = ["CREDIT_CARD", "LOAN"]` (the opening balance is asked as "you owe today" and sent negative), `SWITCH_DEFAULTS: Record<AccountType, { includeInAvailable: boolean; includeInNetWorth: boolean }>`, `interface AccountDraft { type; name; opening: string; fields: Partial<Record<AccountField, string>>; includeInAvailable: boolean | null; includeInNetWorth: boolean | null }`, `accountBodyOf(draft, currency, numberFormat): { ok: true; body } | { ok: false; field: "opening" | AccountField }` (a switch left alone is not sent, so the API applies the type's default, P51), `accountFieldOf(problem): "name" | "opening" | AccountField | "form"`.
  - `NewAccountForm({ space, formats, api? })` (client); `ArchiveAccountButton({ spaceId, account, api? })`, `RestoreAccountButton({ spaceId, account, api? })` (client; both `router.refresh()` after success).

- [ ] **Step 1: Write the failing tests**

`src/shared/ui/format/amount-input.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { minorOf, parseDecimal } from "./amount-input";

describe("amount input (ruling P138)", () => {
  it("reads what a person types in their number format", () => {
    expect(parseDecimal("4.000.000", "DOT_COMMA")).toBe("4000000");
    expect(parseDecimal("4000000", "DOT_COMMA")).toBe("4000000");
    expect(parseDecimal("1,89", "DOT_COMMA")).toBe("1.89");
    expect(parseDecimal("1,234,567.89", "COMMA_DOT")).toBe("1234567.89");
    expect(parseDecimal("1 234 567,89", "SPACE_COMMA")).toBe("1234567.89");
    expect(parseDecimal(" 85.000 ", "DOT_COMMA")).toBe("85000");
  });

  it("refuses what is not a number in that format", () => {
    for (const text of ["", "abc", "1,2,3", "1.23", "12.34.5", "-5", "1e5"]) expect(parseDecimal(text, "DOT_COMMA")).toBeNull();
  });

  it("turns a decimal into minor units of the currency, refusing extra decimals", () => {
    expect(minorOf("85000", 2)).toBe("8500000");
    expect(minorOf("12.5", 2)).toBe("1250");
    expect(minorOf("0.05", 2)).toBe("5");
    expect(minorOf("1.234", 2)).toBeNull();
  });
});
```

(`"1.23"` in `DOT_COMMA` is refused: a dot groups exactly three digits.)

`src/modules/accounts/ui/account-fields.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ACCOUNT_TYPES, switchesOf } from "@/modules/accounts/domain/account";
import { accountBodyOf, accountFieldOf, FIELDS_BY_TYPE, SWITCH_DEFAULTS } from "./account-fields";

describe("account form fields (HU-E9-03, ruling P131)", () => {
  it("shows each type's default switches exactly as the API applies them", () => {
    for (const type of ACCOUNT_TYPES) {
      expect(SWITCH_DEFAULTS[type]).toEqual(switchesOf({ type, includeInAvailable: null, includeInNetWorth: null }));
    }
  });

  it("asks a card for its limit, days and rate, and cash for nothing", () => {
    expect(FIELDS_BY_TYPE.CREDIT_CARD).toEqual(["institution", "lastFour", "creditLimit", "cutOffDay", "paymentDay", "monthlyRate"]);
    expect(FIELDS_BY_TYPE.CASH).toEqual([]);
  });

  it("builds a card's body: owed balance negative, terms typed, untouched switches left out", () => {
    const body = accountBodyOf(
      {
        type: "CREDIT_CARD",
        name: " Visa ",
        opening: "350.000",
        fields: { creditLimit: "5.000.000", cutOffDay: "25", paymentDay: "15", lastFour: "4821", monthlyRate: "1,89" },
        includeInAvailable: null,
        includeInNetWorth: null,
      },
      "COP",
      "DOT_COMMA",
    );
    expect(body).toEqual({
      ok: true,
      body: {
        name: "Visa",
        type: "CREDIT_CARD",
        openingBalance: { amount: "-35000000", currency: "COP" },
        lastFour: "4821",
        terms: {
          creditLimit: { amount: "500000000", currency: "COP" },
          cutOffDay: 25,
          paymentDay: 15,
          monthlyRate: "1.89",
        },
      },
    });
  });

  it("points an unreadable amount at its field and maps API codes and paths", () => {
    const draft = { type: "BANK", name: "B", opening: "dos", fields: {}, includeInAvailable: null, includeInNetWorth: null } as const;
    expect(accountBodyOf(draft, "COP", "DOT_COMMA")).toEqual({ ok: false, field: "opening" });
    const p = (code: string, extra = {}) => ({ code, status: 409, requestId: "r", errors: [], field: null, ...extra });
    expect(accountFieldOf(p("AccountNameTaken"))).toBe("name");
    expect(accountFieldOf(p("AccountAttributeNotAllowed", { field: "monthlyRate" }))).toBe("monthlyRate");
    expect(accountFieldOf(p("ValidationFailed", { errors: [{ path: "terms.cutOffDay", message: "x" }] }))).toBe("cutOffDay");
    expect(accountFieldOf(p("InvalidBillingDay"))).toBe("form");
  });
});
```

`src/modules/accounts/ui/new-account-form.test.tsx` (mock `useRouter`):

```tsx
describe("new account form (HU-E9-03)", () => {
  it("shows only the chosen type's attributes and creates the account", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/accounts": () => jsonResponse(accountDto({ name: "Visa" }), 201),
    });
    const { container } = renderWithIntl(<NewAccountForm space={spaceDto()} formats={BUILT_IN_FORMATS} api={api} />);
    await userEvent.click(screen.getByRole("radio", { name: "Efectivo" }));
    expect(screen.queryByLabelText("Últimos 4")).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Tarjeta de crédito" }));
    for (const label of ["Nombre", "Debes hoy", "Cupo", "Día de corte", "Día de pago", "Últimos 4", "Interés M.V."])
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.queryByLabelText("Tasa E.A.")).toBeNull();
    expect(screen.getByRole("switch", { name: "Contar en el disponible" })).toHaveAttribute("aria-checked", "false");
    await userEvent.type(screen.getByLabelText("Nombre"), "Visa");
    await userEvent.type(screen.getByLabelText("Debes hoy"), "350.000");
    await userEvent.type(screen.getByLabelText("Cupo"), "5.000.000");
    await userEvent.type(screen.getByLabelText("Día de pago"), "15");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await requests[0]!.json()).toEqual({
      name: "Visa",
      type: "CREDIT_CARD",
      openingBalance: { amount: "-35000000", currency: "COP" },
      terms: { creditLimit: { amount: "500000000", currency: "COP" }, paymentDay: 15 },
    });
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-personal/accounts");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows a taken name next to the name field", async () => {
    const { api } = fakeApi({ "POST /api/v1/spaces/{spaceId}/accounts": () => problemResponse(409, "AccountNameTaken") });
    renderWithIntl(<NewAccountForm space={spaceDto()} formats={BUILT_IN_FORMATS} api={api} />);
    await userEvent.click(screen.getByRole("radio", { name: "Banco" }));
    await userEvent.type(screen.getByLabelText("Nombre"), "Bancolombia");
    await userEvent.type(screen.getByLabelText("Saldo inicial"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveAttribute("aria-invalid", "true"));
  });
});
```

`src/modules/accounts/ui/account-actions.test.tsx` (mock `useRouter`): clicking `ArchiveAccountButton` ("Archivar Nequi") opens a sheet named "¿Archivar Nequi?" whose description reads `accounts.archive.explain`; confirming posts to `/api/v1/spaces/sp-personal/accounts/a-nequi/archive` and calls `router.refresh()`; `RestoreAccountButton` ("Restaurar Old wallet") posts to `…/a-old/restore` and refreshes; a `SpaceArchived` problem shows its message in the sheet and keeps it open.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/shared/ui/format/amount-input.test.ts src/modules/accounts/ui` and `pnpm exec vitest run --project ui src/modules/accounts/ui`
Expected: FAIL.

- [ ] **Step 3: Implement**

`parseDecimal`: trim; build the format's pattern — integer part either plain digits or 1–3 digits followed by groups of `<group separator>` + exactly 3 digits, then optionally the decimal separator and digits — and answer the digits with a `.` decimal point, else `null`. `minorOf` pads or refuses the fraction against the exponent and strips leading zeros (`"0"` stays `"0"`). `SWITCH_DEFAULTS` copies the table `switchesOf` encodes (available by default for CASH, BANK, WALLET and SHARED_FUND; net worth for every type); the test above pins it. `accountBodyOf` trims the name; sends `institution` and `lastFour` only when typed; days and months as integers; rates through `parseDecimal`; dates as typed (`<input type="date">` answers ISO); a type's terms only from `FIELDS_BY_TYPE[type]`. `accountFieldOf`: `AccountNameTaken` and `InvalidAccountName` → `name`; `InvalidAmount` and `CurrencyMismatch` → `opening`; `InvalidCreditLimit` → `creditLimit`; `InvalidTermDeposit` → `termDays`; `InvalidTerm` → `termMonths`; `AccountAttributeNotAllowed` → its public `field`; `ValidationFailed` → the path's last segment when it is a field (`name`, `lastFour`, `institution`, or `terms.<field>`); anything else (`InvalidBillingDay`, `InvalidRate`, …) → `form`, shown in a `ProblemNotice` above the button.

`NewAccountForm` (the artboard as a page, not a sheet): `h1` `accounts.newTitle`; the type `ChoiceGroup layout="grid"` (each with its default icon; SHARED_FUND offered only when `space.kind === "SHARED"`); `TextField` name; the opening balance labelled `accounts.field.opening` or, for `OWED_TYPES`, `accounts.field.owed`, `inputMode="decimal"`; the type's fields (labels `accounts.field.<field>`; days `inputMode="numeric"`, rates `inputMode="decimal"`, the maturity date `type="date"`); the two `Switch`es with their explanations (`accounts.switch.available`, `accounts.switch.netWorth`), initially `SWITCH_DEFAULTS[type]`, a touched switch sending its value; a read-only currency line (`accounts.currency` with `space.currency`); the `lg` button `accounts.create`. On 201: `router.push(\`/spaces/${space.id}/accounts\`)` and `router.refresh()`. The page (server) loads the space from `getSpaces()` and the formats from `getMe()`.

`ArchiveAccountButton` and `RestoreAccountButton` as in the Interfaces; `AccountsScreen` gives each active row an archive button (an icon button labelled `accounts.archive.open` with the name) and each archived row a restore button (`accounts.restore` with the name). Archived accounts are never offered elsewhere: every picker lists only `archivedAt === null` (Task 14).

Catalog keys (`accounts`), es / en: `newTitle` Nueva cuenta / New account; `create` Crear cuenta / Create account; `type` Tipo de cuenta / Account type; `type.BANK` Banco / Bank; `type.WALLET` Billetera / Wallet; `type.CASH` Efectivo / Cash; `type.CREDIT_CARD` Tarjeta de crédito / Credit card; `type.SAVINGS` Ahorro o CDT / Savings or term deposit; `type.INVESTMENT` Inversión / Investment; `type.LOAN` Préstamo o deuda / Loan or debt; `type.OTHER` Otra / Other; `type.SHARED_FUND` Fondo compartido / Shared fund; `field.name` Nombre / Name; `field.opening` Saldo inicial / Opening balance; `field.owed` Debes hoy / You owe today; `field.institution` Entidad / Institution; `field.lastFour` Últimos 4 / Last 4; `field.creditLimit` Cupo / Credit limit; `field.cutOffDay` Día de corte / Cut-off day; `field.paymentDay` Día de pago / Payment day; `field.monthlyRate` Interés M.V. / Monthly rate; `field.annualRate` Tasa E.A. / Annual rate; `field.termDays` Plazo en días / Term in days; `field.maturityDate` Vencimiento / Maturity date; `field.principal` Monto del crédito / Loan amount; `field.termMonths` Plazo en meses / Term in months; `switch.available` Contar en el disponible / Count in available; `switch.availableHint` Lo que tiene esta cuenta se suma a tu dinero disponible. / What this account holds adds to your available money.; `switch.netWorth` Contar en el patrimonio / Count in net worth; `switch.netWorthHint` Su saldo se suma a tu patrimonio neto. / Its balance adds to your net worth.; `currency` Moneda: {currency} / Currency: {currency}; `amountUnreadable` Escribe un monto como 1.500.000. / Type an amount like 1,500,000. (the example written with `formatNumber("1500000")` of the person's format — pass it as `{example}`); `archive.open` Archivar {name} / Archive {name}; `archive.title` ¿Archivar {name}? / Archive {name}?; `archive.explain` Su historial se conserva y deja de recibir movimientos nuevos. Puedes restaurarla cuando quieras. / Its history stays and it takes no new transactions. You can restore it at any time.; `archive.confirm` Archivar / Archive; `restore` Restaurar {name} / Restore {name}.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ui/format/amount-input.ts src/shared/ui/format/amount-input.test.ts src/modules/accounts/ui \
  "src/app/(web)/(app)/spaces/[spaceId]/accounts/new" src/i18n/messages
git commit -m "feat(accounts): create accounts by type and archive or restore them (Refs #71)"
```

---

### Task 14: The category and account pickers

The QuickAdd and CategoryPicker artboards' sheets that the record form (Task 17a) and the transaction filter (Task 15) share: parent categories first, grouped, each with its icon and color; choosing one shows its subcategories as optional chips in the same sheet, "Sin subcategoría" preselected (scenario "Pick an optional subcategory" at component level); archived categories and accounts are never offered (ruling P126: no create, edit or "Manage" control in M6a).

**Files:**
- Create: `src/modules/categories/ui/{category-tree.ts, category-tree.test.ts, category-icon.tsx, category-picker.tsx, category-picker.test.tsx, index.ts}`, `src/modules/accounts/ui/account-picker.tsx`, `src/modules/accounts/ui/account-picker.test.tsx`
- Modify: `src/modules/accounts/ui/index.ts`, `tests/support/ui/dto.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `CategoryGroupDto`, `CategoryDto`, `AccountDto`; `Sheet`, `SymbolIcon`, `paletteVars`, `ChoiceGroup`.
- Produces: `activeTree(groups: readonly CategoryGroupDto[]): CategoryGroupDto[]` (archived groups, categories and subcategories removed); `findCategory(groups, id): { category: CategoryDto; parent: CategoryDto | null; group: CategoryGroupDto } | null`; `categoryPath(groups, id): string | null` (`"Groceries › Vegetables"`, or the category's name); `matches(name: string, query: string): boolean` (case and accent insensitive); `CategoryIcon({ icon, color, size? })` (a symbol through `SymbolIcon` or an emoji in a `span aria-hidden`, on the palette tint); `CategoryPicker({ open, onOpenChange, groups, value, onChoose, title? })` where `value` and `onChoose` take `{ categoryId: string; subcategoryId: string | null } | null`; `AccountPicker({ open, onOpenChange, accounts, value, onChoose, label })` (active accounts only, each with its icon, name and institution). `groupDto()` and `categoryDto()` test builders.

- [ ] **Step 1: Write the failing tests**

`src/modules/categories/ui/category-tree.test.ts`:

```ts
const groceries = categoryDto({
  id: "c-groceries",
  name: "Groceries",
  subcategories: [
    categoryDto({ id: "c-veg", name: "Vegetables", parentCategoryId: "c-groceries" }),
    categoryDto({ id: "c-old", name: "Old", parentCategoryId: "c-groceries", archivedAt: "2026-10-01T00:00:00.000Z" }),
  ],
});
const groups = [
  groupDto({ id: "g-food", name: "Food", categories: [groceries, categoryDto({ id: "c-gone", name: "Gone", archivedAt: "2026-10-01T00:00:00.000Z" })] }),
  groupDto({ id: "g-closed", name: "Closed", archivedAt: "2026-10-01T00:00:00.000Z", categories: [categoryDto({ id: "c-x", name: "X" })] }),
];

describe("category tree (HU-E9-03)", () => {
  it("offers only live groups, categories and subcategories", () => {
    const tree = activeTree(groups);
    expect(tree.map((g) => g.name)).toEqual(["Food"]);
    expect(tree[0]!.categories.map((c) => [c.name, c.subcategories.map((s) => s.name)])).toEqual([["Groceries", ["Vegetables"]]]);
  });

  it("names a subcategory with its parent and finds archived ones for the history", () => {
    expect(categoryPath(groups, "c-veg")).toBe("Groceries › Vegetables");
    expect(categoryPath(groups, "c-groceries")).toBe("Groceries");
    expect(categoryPath(groups, "c-gone")).toBe("Gone");
    expect(categoryPath(groups, "c-missing")).toBeNull();
  });

  it("searches ignoring case and accents", () => {
    expect(matches("Alimentación", "alimentacion")).toBe(true);
    expect(matches("Mercado", "MERC")).toBe(true);
    expect(matches("Mercado", "pan")).toBe(false);
  });
});
```

`src/modules/categories/ui/category-picker.test.tsx`:

```tsx
describe("category picker (HU-E9-03)", () => {
  it("offers the subcategories as optional chips, none chosen by default", async () => {
    const onChoose = vi.fn();
    renderWithIntl(<CategoryPicker open onOpenChange={() => undefined} groups={groups} value={null} onChoose={onChoose} />);
    const sheet = screen.getByRole("dialog", { name: "Categoría" });
    expect(within(sheet).queryByText("Gone")).toBeNull();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Groceries" }));
    const subs = within(sheet).getByRole("radiogroup", { name: "Subcategorías de Groceries" });
    expect(within(subs).getByRole("radio", { name: "Sin subcategoría" })).toBeChecked();
    expect(within(subs).getByRole("radio", { name: "Vegetables" })).toBeInTheDocument();
    expect(within(subs).queryByRole("radio", { name: "Old" })).toBeNull();
    await userEvent.click(within(sheet).getByRole("button", { name: "Usar Groceries" }));
    expect(onChoose).toHaveBeenLastCalledWith({ categoryId: "c-groceries", subcategoryId: null });
  });

  it("chooses a subcategory in the same sheet", async () => {
    const onChoose = vi.fn();
    renderWithIntl(<CategoryPicker open onOpenChange={() => undefined} groups={groups} value={null} onChoose={onChoose} />);
    await userEvent.click(screen.getByRole("radio", { name: "Groceries" }));
    await userEvent.click(screen.getByRole("radio", { name: "Vegetables" }));
    await userEvent.click(screen.getByRole("button", { name: "Usar Groceries › Vegetables" }));
    expect(onChoose).toHaveBeenLastCalledWith({ categoryId: "c-groceries", subcategoryId: "c-veg" });
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("filters by name and says when nothing matches", async () => {
    renderWithIntl(<CategoryPicker open onOpenChange={() => undefined} groups={groups} value={null} onChoose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Buscar categoría"), "pana");
    expect(screen.getByText("No hay ninguna categoría «pana».")).toBeInTheDocument();
  });
});
```

`src/modules/accounts/ui/account-picker.test.tsx`: with Bancolombia, Nequi and the archived "Old wallet", the dialog named by `label` lists "Bancolombia" and "Nequi" as radios and no "Old wallet"; choosing "Nequi" calls `onChoose("a-nequi")`; axe clean.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/categories/ui` and `pnpm exec vitest run --project ui src/modules/categories/ui src/modules/accounts/ui/account-picker.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`category-tree.ts` as in the Interfaces (`matches` compares `name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()` with the query treated the same way). `CategoryPicker` (`"use client"`, a `Sheet` titled `categories.picker.title` or `title`): a search field (`categories.picker.search`); then each live group as a heading with its `CategoryIcon` and a `ChoiceGroup layout="chips"` of its categories (each chip with the category's icon on its tint); when a category is focused, a second `ChoiceGroup` labelled `categories.picker.subcategoriesOf` with `{name}` shows `categories.picker.none` ("Sin subcategoría", value `""`) first and the live subcategories after it — only when the category has any; a subcategory is never required. Choosing a category without live subcategories chooses it at once and closes the sheet (one tap). The confirm button reads `categories.picker.use` with `{path}` and calls `onChoose`, then closes. A query hides non-matching categories and groups and, when nothing is left, shows `categories.picker.noMatch` with `{query}`. `AccountPicker` is a `Sheet` with one `ChoiceGroup` of the active accounts (filtered by `archivedAt === null` inside, whatever is passed).

Catalog keys (`categories.picker`), es / en: `title` Categoría / Category; `search` Buscar categoría / Search category; `subcategoriesOf` Subcategorías de {name} / Subcategories of {name}; `none` Sin subcategoría / No subcategory; `use` Usar {path} / Use {path}; `noMatch` No hay ninguna categoría «{query}». / There is no category “{query}”.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/categories/ui src/modules/accounts/ui tests/support/ui/dto.ts src/i18n/messages
git commit -m "feat(categories): add the category and account pickers with optional subcategories (Refs #71)"
```

---

### Task 15: The transaction list

The Activity artboard (scenario "Transaction list by day and time, with totals and filters", and the list half of "Pay the credit card with a transfer"): the period's transactions grouped by day, newest first, headings `ledger.day.today` and `ledger.day.yesterday` then the date in the person's format; each row with its wall-clock time in the record's own zone (plus the zone's city when it differs from the viewer's), the category path or the accounts of a transfer, and the amount; the API's period totals; the period selector, the category filter and "Load more" (50 per page) (ruling P130).

**Files:**
- Create: `src/modules/ledger/ui/{day-groups.ts, day-groups.test.ts, transaction-row.tsx, transaction-list.tsx, list-filters.tsx, load-more.tsx, transaction-list-container.tsx, transaction-list.test.tsx, index.ts}`, `src/app/(web)/(app)/spaces/[spaceId]/transactions/page.tsx`
- Modify: `tests/support/ui/dto.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `TransactionDto`, `TransactionPageDto`, `PeriodDto`, `CategoryGroupDto`, `AccountDto`; `categoryPath`, `CategoryPicker` (Task 14); `formatMoney`, `formatDate`, `formatTimeAt`, `relativeDay` (Task 6); `zoneCity`; `serverNow`; `loaded`, `serverApi`, `getMe`.
- Produces: `groupByDay(items: readonly TransactionDto[], today: string): { date: string; relative: "today" | "yesterday" | null; items: TransactionDto[] }[]` (consecutive rows of one date, the API's order kept: newest day first, then time, untimed rows last, P43); `interface RowContext { formats: Formats; viewerZone: string; groups: CategoryGroupDto[]; accountNames: Record<string, string> }`; `TransactionRow({ tx, context })` (client-safe); `TransactionList({ spaceId, page, context, today, filter })`; `loadTransactionList(api, input: { spaceId: string; period?: string; categoryId?: string }): Promise<Loaded<{ page; groups; accounts; previous: PeriodDto | null; next: PeriodDto | null }>>`; `TransactionListContainer({ spaceId, period?, categoryId? })`; `LoadMore({ spaceId, query, cursor, lastDate, context })` (client); `transactionDto(overrides?)` test builder. The page takes `?period=<label>&category=<id>`.

- [ ] **Step 1: Write the failing tests**

`src/modules/ledger/ui/day-groups.test.ts`:

```ts
describe("groupByDay (HU-E9-03, ruling P130)", () => {
  it("keeps the API's order and names today and yesterday only", () => {
    const items = [
      transactionDto({ id: "t1", date: "2026-10-31" }),
      transactionDto({ id: "t2", date: "2026-10-30" }),
      transactionDto({ id: "t3", date: "2026-10-30" }),
      transactionDto({ id: "t4", date: "2026-10-29" }),
    ];
    expect(groupByDay(items, "2026-10-31").map((g) => [g.date, g.relative, g.items.map((t) => t.id)])).toEqual([
      ["2026-10-31", "today", ["t1"]],
      ["2026-10-30", "yesterday", ["t2", "t3"]],
      ["2026-10-29", null, ["t4"]],
    ]);
  });
});
```

`src/modules/ledger/ui/transaction-list.test.tsx` (the story's October 2026 data; `today` 2026-10-31):

```tsx
const groups = [
  groupDto({ id: "g-food", name: "Food", categories: [
    categoryDto({ id: "c-groceries", name: "Groceries", subcategories: [categoryDto({ id: "c-veg", name: "Vegetables", parentCategoryId: "c-groceries" })] }),
    categoryDto({ id: "c-dining", name: "Restaurants" }),
  ] }),
  groupDto({ id: "g-income", name: "Income", categories: [categoryDto({ id: "c-salary", name: "Wages" })] }),
];
const context = { formats: BUILT_IN_FORMATS, viewerZone: "America/Bogota", groups, accountNames: { "a-bank": "Bancolombia", "a-visa": "Visa" } };
const expense = (id: string, description: string, pesos: number, date: string, at: string | null, categoryId: string) =>
  transactionDto({
    id, type: "EXPENSE", description, amount: cop(pesos), date, categoryId,
    occurredAt: at, timeZone: at ? "America/Bogota" : null,
    payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(pesos) }],
  });
const page = {
  period: { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" },
  totals: { expenses: cop(245_000), income: cop(3_200_000) },
  items: [
    transactionDto({ id: "t-salary", type: "INCOME", description: "Salary", amount: cop(3_200_000), date: "2026-10-25", categoryId: "c-salary", destinationAccountId: "a-bank" }),
    expense("t-dinner", "Dinner", 60_000, "2026-10-12", "2026-10-13T01:45:00.000Z", "c-dining"),
    expense("t-market2", "Market", 100_000, "2026-10-12", "2026-10-12T23:02:00.000Z", "c-veg"),
    expense("t-market1", "Market", 85_000, "2026-10-05", "2026-10-05T13:10:00.000Z", "c-groceries"),
  ],
  nextCursor: null,
};

describe("transaction list (HU-E9-03)", () => {
  it("groups by day, newest first, with times, category paths and the period totals", async () => {
    const { container } = renderWithIntl(
      <TransactionList spaceId="sp-personal" page={page} context={context} today="2026-10-31" filter={{ period: "2026-10" }} />,
    );
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["25/10/2026", "12/10/2026", "5/10/2026"]);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => within(r).getByText(/Dinner|Market|Salary/).textContent)).toEqual(["Salary", "Dinner", "Market", "Market"]);
    expect(rows[1]).toHaveTextContent("20:45");
    expect(rows[2]).toHaveTextContent("Groceries › Vegetables");
    expect(rows[0]).not.toHaveTextContent(/\d{2}:\d{2}/);
    const totals = screen.getByRole("region", { name: "Totales del período" });
    expect(norm(totals.textContent)).toContain("$ 245.000");
    expect(norm(totals.textContent)).toContain("$ 3.200.000");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows a transfer between accounts without a category, and a record's own zone", () => {
    const transfer = transactionDto({
      id: "t-pay", type: "TRANSFER", description: "", amount: cop(200_000), date: "2026-10-25",
      occurredAt: "2026-10-25T15:00:00.000Z", timeZone: "America/Bogota", sourceAccountId: "a-bank", destinationAccountId: "a-visa",
    });
    const madrid = { ...expense("t-mad", "Tapas", 30_000, "2026-10-31", "2026-11-01T04:30:00.000Z", "c-dining"), timeZone: "Europe/Madrid" };
    renderWithIntl(
      <TransactionList spaceId="sp-personal" page={{ ...page, items: [madrid, transfer] }} context={context} today="2026-10-31" filter={{}} />,
    );
    const [mad, pay] = screen.getAllByRole("listitem");
    expect(mad).toHaveTextContent("05:30 · Madrid");
    expect(screen.getByRole("heading", { level: 2, name: "Hoy" })).toBeInTheDocument();
    expect(pay).toHaveTextContent("Bancolombia → Visa");
    expect(pay).toHaveTextContent("Transferencia");
    expect(pay).not.toHaveTextContent("Groceries");
  });

  it("asks the API for the chosen category's period and shows its total", async () => {
    const filtered = { ...page, totals: { expenses: cop(185_000), income: cop(0) }, items: page.items.slice(2) };
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/transactions": () => jsonResponse(filtered),
      "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: groups }),
      "GET /api/v1/spaces/{spaceId}/accounts": () => jsonResponse({ items: [], totals: { available: cop(0), netWorth: cop(0) } }),
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [page.period] }),
    });
    const result = await loadTransactionList(api, { spaceId: "sp-personal", period: "2026-10", categoryId: "c-groceries" });
    const query = new URL(requests[0]!.url).searchParams;
    expect([query.get("period"), query.get("categoryIds"), query.get("limit")]).toEqual(["2026-10", "c-groceries", "50"]);
    expect(result.ok && result.data.page.items).toHaveLength(2);
  });
});
```

(`norm` as in Task 12. `transactionDto()` in `tests/support/ui/dto.ts`: an EXPENSE `t-1` "Item" of `cop(0)` on `2026-10-01`, untimed, no category, no payments, shares, accounts or members, `createdBy "u-ana"`, `version 1`, ISO timestamps.)

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/ui` and `pnpm exec vitest run --project ui src/modules/ledger/ui`
Expected: FAIL.

- [ ] **Step 3: Implement**

`groupByDay` as in the Interfaces (`relative` from `relativeDay`, keeping only `today` and `yesterday`). `TransactionRow` (no `"use client"`, no server-only import, so both the server list and `LoadMore` render it): a 64 px `li` with the category's `CategoryIcon` (a transfer shows `SymbolIcon name="cash"` on `GRAPHITE`, a row without a category `SymbolIcon name="dots"` on `GRAPHITE`), the description (else `ledger.type.<TYPE>`), a meta line joining with " · " the time (`formatTimeAt(occurredAt, timeZone)`, only when `occurredAt` is set) plus `zoneCity(timeZone)` when it differs from `viewerZone`, then the category path (expense and income) or `{source} → {destination}` (transfer, from `accountNames`), and the account of an expense or income; the amount on the right: an expense `−` + `formatMoney`, an income `+`, a transfer or settlement unsigned in `text-muted`. `TransactionList`: `h1` `ledger.list.title`; `ListFilters` (client: the period label with links to the previous and next periods `?period=<label>` — keeping `category` — and a category filter button opening `CategoryPicker` with `title` `ledger.list.filterTitle`, which navigates with `?category=<id>`; a chosen filter shows as a pressed chip `{name} ✕` that removes it); the totals `section` labelled `ledger.list.totals` ("Gastos … · Ingresos …"); one `section` per day labelled by its heading (`aria-labelledby`; `h2` `ledger.day.today`, `ledger.day.yesterday` or `formatDate(date)`, then an `ol` of rows); `ledger.list.empty` when no rows; `LoadMore` when `nextCursor` is set. No per-day totals: a day can span two pages (ruling P130). `LoadMore` fetches `GET …/transactions` with the same `period`, `categoryIds` and `limit=50` plus `cursor`, groups the new rows with `groupByDay` and omits the heading of a first group whose date equals `lastDate`. `loadTransactionList` calls the list, the categories (`archived=true`, so archived names still show in history), the accounts (`archived=true`) and the periods in parallel, then `GET …/periods?from=<startDate − 1 day>&count=1` and `?from=<endDate + 1 day>&count=1` for the neighbours. `TransactionListContainer` builds `RowContext` from `getMe()` (`preferences.effective`, `timezone`) and `today` from `nowIn(serverNow(), me.timezone).date`. The page passes `searchParams.period` and `searchParams.category`.

Catalog keys (`ledger`), es / en: `list.title` Movimientos / Transactions; `list.totals` Totales del período / Period totals; `list.expenses` Gastos {amount} / Expenses {amount}; `list.income` Ingresos {amount} / Income {amount}; `list.previous` Período anterior / Previous period; `list.next` Período siguiente / Next period; `list.period` Período {label} / Period {label}; `list.filterCategory` Categoría / Category; `list.filterTitle` Filtrar por categoría / Filter by category; `list.removeFilter` Quitar el filtro {name} / Remove the {name} filter; `list.empty` No hay movimientos en este período. / There are no transactions in this period.; `list.loadMore` Cargar más / Load more; `day.today` Hoy / Today; `day.yesterday` Ayer / Yesterday; `day.dayBeforeYesterday` Anteayer / The day before yesterday; `type.EXPENSE` Gasto / Expense; `type.INCOME` Ingreso / Income; `type.TRANSFER` Transferencia / Transfer; `type.SETTLEMENT` Pago entre miembros / Settlement; `transfer` {from} → {to} / {from} → {to}.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ledger/ui "src/app/(web)/(app)/spaces/[spaceId]/transactions" tests/support/ui/dto.ts src/i18n/messages
git commit -m "feat(ledger): add the transaction list by day and time with totals and filters (Refs #71)"
```

---

### Task 16: The date and time sheet

HU-E9-03's sheet (the QuickAdd artboard's "Fecha y hora"): three quick-day buttons, a month calendar starting on the person's `weekStart`, hour and minute steppers (5-minute steps that first reach the next multiple of five in the direction pressed), minute shortcuts and "Now", a clock that follows `timeFormat` with an AM/PM switch for `H12`; no way to clear the time (ruling P129). Covers the component half of the outline "Pick yesterday at 19:00 in two steps".

**Files:**
- Create: `src/modules/ledger/ui/record/when-label.ts`, `src/modules/ledger/ui/record/when-label.test.ts`, `src/modules/ledger/ui/record/date-time-sheet.tsx`, `src/modules/ledger/ui/record/date-time-sheet.test.tsx`
- Modify: `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `relativeDay`, `stepMinutes`, `stepHour`, `withHalf`, `monthGrid`, `formatDate`, `formatTime`, `Wall`, `Formats`; `Sheet`, `ChoiceGroup`, `Button`.
- Produces: `interface When { readonly date: string; readonly wall: Wall }`; `whenLabel(when: When, today: string, formats: Formats, days: { today: string; yesterday: string; dayBeforeYesterday: string }): string` (`"Hoy · 23:30"`; an older or later day shows its date in the person's format); `DateTimeSheet({ open, onOpenChange, value, today, now, formats, onApply })` where `value` and `now` are `When` and `onApply(when: When)`; days after `today` are disabled. The clock is a `group` labelled `ledger.when.time` whose text reads `<hour> : <minute>` (`19 : 00`, or `7 : 00` with the `ledger.when.pm` radio checked), so the e2e steps read it as the outline writes it.

- [ ] **Step 1: Write the failing tests**

`src/modules/ledger/ui/record/when-label.test.ts`:

```ts
const es = { today: "Hoy", yesterday: "Ayer", dayBeforeYesterday: "Anteayer" };
const norm = (text: string) => text.replace(/\s/g, " ");

describe("whenLabel (HU-E9-03)", () => {
  it("reads the day, a middle dot and the time in the person's format", () => {
    expect(whenLabel({ date: "2026-10-31", wall: { hour: 23, minute: 30 } }, "2026-10-31", BUILT_IN_FORMATS, es)).toBe("Hoy · 23:30");
    const twelve = { ...BUILT_IN_FORMATS, timeFormat: "H12" as const };
    expect(norm(whenLabel({ date: "2026-10-15", wall: { hour: 19, minute: 0 } }, "2026-10-16", twelve, es))).toBe("Ayer · 7:00 PM");
    expect(whenLabel({ date: "2026-10-14", wall: { hour: 19, minute: 0 } }, "2026-10-16", BUILT_IN_FORMATS, es)).toBe("Anteayer · 19:00");
    expect(whenLabel({ date: "2026-10-01", wall: { hour: 9, minute: 5 } }, "2026-10-16", BUILT_IN_FORMATS, es)).toBe("1/10/2026 · 09:05");
  });
});
```

`src/modules/ledger/ui/record/date-time-sheet.test.tsx`:

```tsx
const open = (overrides: Partial<Parameters<typeof DateTimeSheet>[0]> = {}) => {
  const onApply = vi.fn();
  renderWithIntl(
    <DateTimeSheet
      open
      onOpenChange={() => undefined}
      value={{ date: "2026-10-16", wall: { hour: 22, minute: 30 } }}
      now={{ date: "2026-10-16", wall: { hour: 22, minute: 30 } }}
      today="2026-10-16"
      formats={BUILT_IN_FORMATS}
      onApply={onApply}
      {...overrides}
    />,
  );
  return { onApply, sheet: screen.getByRole("dialog", { name: "Fecha y hora" }) };
};
const clockText = () => screen.getByRole("group", { name: "Hora" }).textContent?.replace(/\s+/g, " ").trim();

describe("date and time sheet (HU-E9-03, ruling P129)", () => {
  it("offers the quick days above a calendar that starts on the person's first weekday", async () => {
    const { sheet } = open();
    const days = within(sheet).getByRole("radiogroup", { name: "Día" });
    expect(within(days).getAllByRole("radio").map((r) => r.textContent)).toEqual([
      expect.stringContaining("Hoy"),
      expect.stringContaining("Ayer"),
      expect.stringContaining("Anteayer"),
    ]);
    const calendar = within(sheet).getByRole("grid", { name: "octubre de 2026" });
    expect(days.compareDocumentPosition(calendar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(calendar).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["L", "M", "M", "J", "V", "S", "D"]);
    expect(within(calendar).getByRole("button", { name: "17/10/2026" })).toBeDisabled();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("picks yesterday at 19:00 in two steps on a 24-hour clock", async () => {
    const { sheet, onApply } = open();
    await userEvent.click(within(sheet).getByRole("radio", { name: /Ayer/ }));
    for (let i = 0; i < 3; i += 1) await userEvent.click(within(sheet).getByRole("button", { name: "Una hora menos" }));
    await userEvent.click(within(sheet).getByRole("button", { name: ":00" }));
    expect(clockText()).toBe("19 : 00");
    await userEvent.click(within(sheet).getByRole("button", { name: /^Usar/ }));
    expect(onApply).toHaveBeenCalledWith({ date: "2026-10-15", wall: { hour: 19, minute: 0 } });
  });

  it("shows 7 : 00 with PM selected on a 12-hour clock", async () => {
    const { sheet } = open({ formats: { ...BUILT_IN_FORMATS, timeFormat: "H12" }, value: { date: "2026-10-15", wall: { hour: 19, minute: 0 } } });
    expect(clockText()).toContain("7 : 00");
    expect(within(sheet).getByRole("radio", { name: "PM" })).toBeChecked();
    await userEvent.click(within(sheet).getByRole("radio", { name: "AM" }));
    expect(clockText()).toContain("7 : 00");
  });

  it("steps a carried-over :32 to :35 or :30, and goes back to now", async () => {
    const { sheet } = open({ value: { date: "2026-10-16", wall: { hour: 22, minute: 32 } } });
    await userEvent.click(within(sheet).getByRole("button", { name: "Cinco minutos más" }));
    expect(clockText()).toBe("22 : 35");
    await userEvent.click(within(sheet).getByRole("button", { name: "Cinco minutos menos" }));
    expect(clockText()).toBe("22 : 30");
    await userEvent.click(within(sheet).getByRole("radio", { name: /Anteayer/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Ahora" }));
    expect(within(sheet).getByRole("radio", { name: /Hoy/ })).toBeChecked();
    expect(clockText()).toBe("22 : 30");
    expect(within(sheet).queryByRole("button", { name: /Sin hora/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/ui/record` and `pnpm exec vitest run --project ui src/modules/ledger/ui/record`
Expected: FAIL.

- [ ] **Step 3: Implement**

`whenLabel` joins `days[relativeDay(date, today)]` (or `formatDate(date)`) and `formatTime(wall)` with `" · "`. `DateTimeSheet` (`"use client"`; a `Sheet` titled `ledger.when.title`) keeps a draft `When` and the shown month: the quick days as a `ChoiceGroup layout="segmented"` labelled `ledger.when.day` (each with its relative name and its `formatDate` below); the month header with previous and next buttons (`ledger.when.previousMonth`, `ledger.when.nextMonth`) and the month name `common.month.<n>` with the year (`ledger.when.month` "{month} de {year}" / "{month} {year}") naming a `table role="grid"` whose `columnheader`s are `common.weekdayShort.<DAY>` in `weekStart` order and whose cells are buttons labelled with `formatDate(date)`, `aria-pressed` on the chosen day, disabled after `today`; the clock `group` (`ledger.when.time`): `−` / `+` buttons (`ledger.when.hourDown`, `hourUp`, `minuteDown`, `minuteUp`) around two `output`s (hours two-digit for `H24`, `1`–`12` for `H12`) separated by an `aria-hidden` `" : "`, and for `H12` a `ChoiceGroup` `ledger.when.half` with `AM` and `PM` (`withHalf`); the minute shortcuts `:00`, `:15`, `:30`, `:45` (`aria-pressed`) and `ledger.when.now` (sets the draft to `now`); the apply button `ledger.when.apply` with `{label}` = `whenLabel(draft)`. Opening the sheet resets the draft to `value`.

Catalog keys, es / en: `common.month.1` … `common.month.12` (enero … diciembre / January … December); `common.weekdayShort.MONDAY` … `SUNDAY` (L, M, M, J, V, S, D / M, T, W, T, F, S, S); `ledger.when.title` Fecha y hora / Date and time; `ledger.when.day` Día / Day; `ledger.when.month` {month} de {year} / {month} {year}; `ledger.when.previousMonth` Mes anterior / Previous month; `ledger.when.nextMonth` Mes siguiente / Next month; `ledger.when.time` Hora / Time; `ledger.when.hourDown` Una hora menos / One hour earlier; `ledger.when.hourUp` Una hora más / One hour later; `ledger.when.minuteDown` Cinco minutos menos / Five minutes earlier; `ledger.when.minuteUp` Cinco minutos más / Five minutes later; `ledger.when.half` Mañana o tarde / Morning or afternoon; `ledger.when.am` AM / AM; `ledger.when.pm` PM / PM; `ledger.when.now` Ahora / Now; `ledger.when.apply` Usar {label} / Use {label}. AM and PM stay "AM" and "PM" in Spanish: the 12-hour format is a format, not a language (D23).

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ledger/ui/record src/i18n/messages
git commit -m "feat(ledger): add the date and time sheet with quick days, calendar and steppers (Refs #71)"
```

---

### Task 17a: The record form

The QuickAdd artboard as a page (`/spaces/{spaceId}/new?type=expense|income|transfer`): amount first with the keypad, description, category with its optional subcategory (expense and income), account (and the destination of a transfer), the date and time chip, Save. It posts to `/api/v1/spaces/{spaceId}/expenses`, `/incomes` or `/transfers` with `date`, `occurredAt` and the browser's `timeZone`, one `Idempotency-Key` per draft (ruling P128), and shows every API error next to its field (scenarios "Record a personal expense from the form" and "Pick an optional subcategory" at component level, the form half of "Pay the credit card with a transfer").

**Files:**
- Create: `src/modules/ledger/ui/record/{record-request.ts, record-request.test.ts, use-idempotency-key.ts, use-idempotency-key.test.tsx, amount-field.tsx, record-form.tsx, record-form.test.tsx, record-form-container.tsx}`, `src/app/(web)/(app)/spaces/[spaceId]/new/page.tsx`
- Modify: `src/modules/ledger/ui/index.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `parseDecimal`, `minorOf`, `currencyOf` (Tasks 6, 13); `occurredAtOf`, `nowIn`, `browserTimeZone`; `CategoryPicker`, `findCategory`, `categoryPath`, `activeTree` (Task 14); `AccountPicker` (Task 14); `DateTimeSheet`, `whenLabel`, `When` (Task 16); `useProblemMessage`, `ProblemNotice`, `browserApi`, `getMe`, `getSpaces`, `serverNow`.
- Produces:
  - `type RecordKind = "EXPENSE" | "INCOME" | "TRANSFER"`; `interface RecordDraft { kind: RecordKind; amount: string; description: string; category: { categoryId: string; subcategoryId: string | null } | null; accountId: string | null; toAccountId: string | null; when: When; timeZone: string }`; `requestOf(draft, currency: string, numberFormat: NumberFormat): { ok: true; kind: RecordKind; body: Record<string, unknown> } | { ok: false; field: "amount" | "account" | "toAccount" }`; `type RecordField = "amount" | "description" | "category" | "account" | "toAccount" | "when"`; `recordFieldOf(problem: Problem): RecordField | "form"`.
  - `useIdempotencyKey(signature: string): { key: string; renew(): void }` (a fresh UUID when the signature changes and after `renew()`; the same key for repeated submits of one unchanged draft).
  - `RecordForm({ space, accounts, groups, formats, initialKind, initialNow, timeZone?, api? })` (client; `initialNow` an ISO instant from the server render, `timeZone` defaults to `browserTimeZone()` after mount); the root carries `data-ready="true"` once hydrated (the e2e steps wait for it); the when chip carries `data-testid="when-chip"`.
  - `RecordFormContainer({ spaceId, kind })` (server).

- [ ] **Step 1: Write the failing tests**

`src/modules/ledger/ui/record/record-request.test.ts`:

```ts
const draft = (overrides: Partial<RecordDraft> = {}): RecordDraft => ({
  kind: "EXPENSE",
  amount: "85.000",
  description: " Market ",
  category: { categoryId: "c-groceries", subcategoryId: null },
  accountId: "a-bank",
  toAccountId: null,
  when: { date: "2026-10-31", wall: { hour: 23, minute: 30 } },
  timeZone: "America/Bogota",
  ...overrides,
});

describe("requestOf (HU-E9-03, ruling P118)", () => {
  it("sends an expense with its local date, its instant and the recorder's zone", () => {
    expect(requestOf(draft(), "COP", "DOT_COMMA")).toEqual({
      ok: true,
      kind: "EXPENSE",
      body: {
        description: "Market",
        date: "2026-10-31",
        occurredAt: "2026-11-01T04:30:00.000Z",
        timeZone: "America/Bogota",
        categoryId: "c-groceries",
        amount: { amount: "8500000", currency: "COP" },
        accountId: "a-bank",
      },
    });
  });

  it("records a chosen subcategory, and nothing optional when nothing was chosen", () => {
    const sub = requestOf(draft({ category: { categoryId: "c-groceries", subcategoryId: "c-veg" } }), "COP", "DOT_COMMA");
    expect(sub.ok && sub.body.categoryId).toBe("c-veg");
    const bare = requestOf(draft({ description: "  ", category: null }), "COP", "DOT_COMMA");
    expect(bare.ok && Object.keys(bare.body)).toEqual(["date", "occurredAt", "timeZone", "amount", "accountId"]);
  });

  it("sends a transfer between two accounts without a category", () => {
    const transfer = requestOf(
      draft({ kind: "TRANSFER", amount: "200000", description: "", accountId: "a-bank", toAccountId: "a-visa", when: { date: "2026-10-25", wall: { hour: 10, minute: 0 } } }),
      "COP",
      "DOT_COMMA",
    );
    expect(transfer).toEqual({
      ok: true,
      kind: "TRANSFER",
      body: {
        date: "2026-10-25",
        occurredAt: "2026-10-25T15:00:00.000Z",
        timeZone: "America/Bogota",
        amount: { amount: "20000000", currency: "COP" },
        sourceAccountId: "a-bank",
        destinationAccountId: "a-visa",
      },
    });
  });

  it("refuses to build what it cannot send, and leaves the rest to the API", () => {
    expect(requestOf(draft({ amount: "ochenta" }), "COP", "DOT_COMMA")).toEqual({ ok: false, field: "amount" });
    expect(requestOf(draft({ accountId: null }), "COP", "DOT_COMMA")).toEqual({ ok: false, field: "account" });
    expect(requestOf(draft({ kind: "TRANSFER", toAccountId: null }), "COP", "DOT_COMMA")).toEqual({ ok: false, field: "toAccount" });
    expect(requestOf(draft({ amount: "0" }), "COP", "DOT_COMMA").ok).toBe(true);
  });

  it("puts each API code next to its field", () => {
    const p = (code: string, errors: { path: string; message: string }[] = []) => ({ code, status: 422, requestId: "r", errors, field: null });
    expect(recordFieldOf(p("InvalidAmount"))).toBe("amount");
    expect(recordFieldOf(p("CategoryArchived"))).toBe("category");
    expect(recordFieldOf(p("AccountArchived"))).toBe("account");
    expect(recordFieldOf(p("SameAccountTransfer"))).toBe("toAccount");
    expect(recordFieldOf(p("DateTimeMismatch"))).toBe("when");
    expect(recordFieldOf(p("ValidationFailed", [{ path: "destinationAccountId", message: "x" }]))).toBe("toAccount");
    expect(recordFieldOf(p("IdempotencyKeyConflict"))).toBe("form");
  });
});
```

`src/modules/ledger/ui/record/use-idempotency-key.test.tsx`:

```tsx
describe("useIdempotencyKey (HU-E0-10, ruling P128)", () => {
  it("keeps one key per unchanged draft and renews it when the draft changes or after a save", () => {
    const { result, rerender } = renderHook(({ signature }) => useIdempotencyKey(signature), { initialProps: { signature: "a" } });
    const first = result.current.key;
    rerender({ signature: "a" });
    expect(result.current.key).toBe(first);
    rerender({ signature: "b" });
    const second = result.current.key;
    expect(second).not.toBe(first);
    act(() => result.current.renew());
    expect(result.current.key).not.toBe(second);
    expect(result.current.key).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

`src/modules/ledger/ui/record/record-form.test.tsx` (mock `useRouter`; `vi.useFakeTimers({ toFake: ["Date"] })` with `vi.setSystemTime(new Date("2026-11-01T04:30:00Z"))` so the form's mount reads the scenario's clock):

```tsx
const groceries = categoryDto({ id: "c-groceries", name: "Groceries", subcategories: [categoryDto({ id: "c-veg", name: "Vegetables", parentCategoryId: "c-groceries" }), categoryDto({ id: "c-meat", name: "Meat", parentCategoryId: "c-groceries" })] });
const groups = [groupDto({ id: "g-food", name: "Food", categories: [groceries] })];
const accounts = [
  accountDto({ id: "a-bank", name: "Bancolombia", type: "BANK" }),
  accountDto({ id: "a-visa", name: "Visa", type: "CREDIT_CARD", icon: "card" }),
];
const form = (api: Api, kind: RecordKind = "EXPENSE") =>
  renderWithIntl(
    <RecordForm space={spaceDto()} accounts={accounts} groups={groups} formats={BUILT_IN_FORMATS} initialKind={kind}
      initialNow="2026-11-01T04:30:00.000Z" timeZone="America/Bogota" api={api} />,
  );
const recorded = () => jsonResponse(transactionDto({ id: "t-new" }), 201);
const enterMarket = async () => {
  await userEvent.type(screen.getByLabelText("Monto"), "85000");
  await userEvent.type(screen.getByLabelText("Descripción"), "Market");
  await userEvent.click(screen.getByRole("button", { name: /Categoría/ }));
  await userEvent.click(screen.getByRole("radio", { name: "Groceries" }));
};

describe("record form (HU-E9-03)", () => {
  it("records a personal expense now, in the browser's zone, with one idempotency key", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": recorded });
    const { container } = form(api);
    expect(screen.getByTestId("when-chip")).toHaveTextContent("Hoy · 23:30");
    await enterMarket();
    await userEvent.click(screen.getByRole("button", { name: "Usar Groceries" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    const [request] = requests;
    expect(request!.headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await request!.json()).toEqual({
      description: "Market",
      date: "2026-10-31",
      occurredAt: "2026-11-01T04:30:00.000Z",
      timeZone: "America/Bogota",
      categoryId: "c-groceries",
      amount: { amount: "8500000", currency: "COP" },
      accountId: "a-bank",
    });
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-personal/transactions");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("records the chosen subcategory and shows it as Groceries › Vegetables", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": recorded });
    form(api);
    await enterMarket();
    await userEvent.click(screen.getByRole("radio", { name: "Vegetables" }));
    await userEvent.click(screen.getByRole("button", { name: "Usar Groceries › Vegetables" }));
    expect(screen.getByRole("button", { name: /Categoría/ })).toHaveTextContent("Groceries › Vegetables");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect((await requests[0]!.json()).categoryId).toBe("c-veg");
  });

  it("shows errors.InvalidAmount next to the amount and creates nothing", async () => {
    const { api } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": () => problemResponse(422, "InvalidAmount") });
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(screen.getByLabelText("Monto")).toHaveAccessibleDescription("El monto debe ser mayor que cero."));
    expect(router.push).not.toHaveBeenCalled();
  });

  it("sends a double click once, and retries a failed request with the same key", async () => {
    let calls = 0;
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/expenses": async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("Failed to fetch");
        return recorded();
      },
    });
    form(api);
    await enterMarket();
    await userEvent.click(screen.getByRole("button", { name: "Usar Groceries" }));
    const save = screen.getByRole("button", { name: "Guardar gasto" });
    await userEvent.dblClick(save);
    await screen.findByRole("alert");
    await userEvent.click(save);
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(requests).toHaveLength(2);
    expect(requests[1]!.headers.get("idempotency-key")).toBe(requests[0]!.headers.get("idempotency-key"));
  });

  it("pays the credit card with a transfer between two accounts, without a category", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/transfers": recorded });
    form(api, "TRANSFER");
    expect(screen.queryByRole("button", { name: /Categoría/ })).toBeNull();
    await userEvent.type(screen.getByLabelText("Monto"), "200000");
    await userEvent.click(screen.getByRole("button", { name: /Hacia/ }));
    const to = screen.getByRole("dialog", { name: "Hacia" });
    expect(within(to).queryByRole("radio", { name: /Bancolombia/ })).toBeNull();
    await userEvent.click(within(to).getByRole("radio", { name: /Visa/ }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar transferencia" }));
    expect(await requests[0]!.json()).toMatchObject({ sourceAccountId: "a-bank", destinationAccountId: "a-visa", amount: { amount: "20000000" } });
  });
});
```

(The fake throws for the first call, which `openapi-fetch` turns into a rejected promise: the form shows `errors.Unknown`; `dblClick` proves the disabled-while-pending button sent only one request then.)

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/ui/record` and `pnpm exec vitest run --project ui src/modules/ledger/ui/record`
Expected: FAIL.

- [ ] **Step 3: Implement**

`requestOf`: `parseDecimal` then `minorOf` with `currencyOf(currency).exponent` (else `amount`); `accountId` required for every kind and `toAccountId` for a transfer; the body omits an empty description and a missing category; `occurredAt` is `occurredAtOf(when.date, when.wall, timeZone)`; the date is always sent with its instant and zone (the form never sends a date alone, HU-E9-03). `recordFieldOf`: `InvalidAmount`, `CurrencyMismatch`, `UnknownCurrency` → amount; `CategoryRequired`, `CategoryNotInSpace`, `CategoryArchived` → category; `AccountRequired`, `AccountArchived`, `AccountNotOwned`, `AccountNotInSpace` → account; `SameAccountTransfer` → toAccount; `InvalidDescription` → description; `InvalidDate`, `DateTimeMismatch`, `TimeRequired`, `InvalidTimeZone`, `PeriodClosed` → when; `ValidationFailed` by the first path segment (`amount`, `description`, `categoryId`, `accountId`/`sourceAccountId`, `destinationAccountId`, `date`/`occurredAt`/`timeZone`); anything else → form. `useIdempotencyKey` keeps `{ signature, key }` in a ref-backed state and `crypto.randomUUID()` on change or `renew`.

`RecordForm` (`"use client"`): `Tabs` (radix) `ledger.form.kind` with `ledger.type.EXPENSE`, `INCOME`, `TRANSFER`; `AmountField` (a large `TextField` labelled `ledger.form.amount`, `inputMode="decimal"`, the currency symbol before it, the keypad under it: 1–9, `000`, `0` and a backspace labelled `ledger.form.backspace`, each a 56 px button writing into the field); `TextField` `ledger.form.description`; for expense and income the category button (`ledger.form.category`, showing `categoryPath` of the choice) opening `CategoryPicker` over `activeTree(groups)`; the account button (`ledger.form.account`, or `ledger.form.from` and `ledger.form.to` for a transfer, `ledger.form.receivingAccount` for income) opening `AccountPicker` (a transfer's "to" picker leaves out the "from" account); the chip button `data-testid="when-chip"` with `whenLabel(draft.when, today, formats, days)` opening `DateTimeSheet`; a `ProblemNotice` for form-level problems; the `lg` save button `ledger.form.save.<KIND>`, disabled while pending. The draft starts with the first account of `accounts` and `nowIn(new Date(initialNow), timeZone)`; on mount it re-reads `nowIn(new Date(), browserTimeZone())` unless the person already chose a time, then sets `data-ready`. The signature passed to `useIdempotencyKey` is `JSON.stringify` of the built body (so a change after an error makes a new key and an identical retry keeps it). Submit: `requestOf`; on `ok: false` mark the field (`ledger.form.amountUnreadable`, `ledger.form.accountRequired`); else `api.POST` on the kind's path with `params: { path: { spaceId }, header: { "idempotency-key": key } }` inside `try`; on 201 `renew()`, `router.push(\`/spaces/${space.id}/transactions\`)` and `router.refresh()`; on a problem `recordFieldOf` puts its message under the field (`aria-describedby`) or in the `ProblemNotice`.

`RecordFormContainer` (server): `getMe()`, `getSpaces()` (the space), `GET …/accounts` (active only) and `GET …/categories` (active only), in parallel through `loaded`; `initialNow = serverNow().toISOString()`. The page maps `?type=income|transfer` to `INCOME` / `TRANSFER` (anything else is `EXPENSE`) and titles itself `ledger.form.title`.

Catalog keys (`ledger.form`), es / en: `title` Registrar movimiento / Record a transaction; `kind` Tipo de movimiento / Type of transaction; `amount` Monto / Amount; `backspace` Borrar / Delete; `description` Descripción / Description; `category` Categoría / Category; `chooseCategory` Elegir categoría / Choose a category; `account` Cuenta / Account; `receivingAccount` Cuenta que recibe / Receiving account; `from` Desde / From; `to` Hacia / To; `chooseAccount` Elegir cuenta / Choose an account; `when` Fecha y hora: {label}. Cambiar / Date and time: {label}. Change (the chip's accessible name); `save.EXPENSE` Guardar gasto / Save expense; `save.INCOME` Guardar ingreso / Save income; `save.TRANSFER` Guardar transferencia / Save transfer; `amountUnreadable` Escribe un monto como {example}. / Type an amount like {example}.; `accountRequired` Elige una cuenta. / Choose an account.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ledger/ui/record src/modules/ledger/ui/index.ts "src/app/(web)/(app)/spaces/[spaceId]/new" src/i18n/messages
git commit -m "feat(ledger): record expenses, income and transfers with time, subcategory and one idempotency key per draft (Refs #71)"
```

---

### Task 17b: The home of a space

**Amended by the owner's flow review (P148):** the table in "Owner flow review: sign-up and sign-in" wins over this task's text where they differ; add its keys to both catalogs and a test per entry.

The Home and Desktop artboards for M6a (the "no plan" variant: plans and balances come with HU-E9-08 and HU-E9-07, ruling P126): the period's spending and income from the transaction list's totals, the space's accounts with their balances and a "See all" link, and the three most recent transactions with "See all".

**Files:**
- Create: `src/modules/ledger/ui/home/{home-summary.tsx, home-container.tsx, home.test.tsx, period-name.ts, period-name.test.ts}`
- Modify: `src/app/(web)/(app)/spaces/[spaceId]/page.tsx`, `src/modules/ledger/ui/index.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `TransactionRow`, `RowContext` (Task 15), `AccountDto`, `formatMoney`, `formatDate`.
- Produces: `periodName(period: PeriodDto, policy: SpaceDto["periodPolicy"]): { kind: "month"; month: number; year: number } | { kind: "range"; start: string; end: string }` (a `MONTHLY` day-1 period is its month; anything else its dates); `HomeSummary({ spaceId, policy, page, accounts, context })`; `HomeContainer({ spaceId })` (server: `GET …/transactions?limit=3` for the current period, `GET …/accounts`, `getMe()`).

- [ ] **Step 1: Write the failing tests**

`period-name.test.ts`:

```ts
describe("periodName (HU-E9-01 home)", () => {
  it("names a calendar month by its month and any other period by its dates", () => {
    expect(periodName({ label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" }, { kind: "MONTHLY", day: 1 })).toEqual({ kind: "month", month: 10, year: 2026 });
    expect(periodName({ label: "2026-10", startDate: "2026-10-25", endDate: "2026-11-24" }, { kind: "MONTHLY", day: 25 })).toEqual({ kind: "range", start: "2026-10-25", end: "2026-11-24" });
  });
});
```

`home.test.tsx`:

```tsx
describe("home (HU-E9-01)", () => {
  it("shows the period's spending and income, the accounts and the latest transactions", async () => {
    const { container } = renderWithIntl(
      <HomeSummary
        spaceId="sp-personal"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={{ ...octoberPage, items: octoberPage.items.slice(0, 3) }}
        accounts={[accountDto({ name: "Bancolombia", balance: cop(4_455_000) }), accountDto({ id: "a-2", name: "Nequi", balance: cop(500_000) })]}
        context={rowContext}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Inicio" })).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Resumen del período" });
    expect(norm(summary.textContent)).toContain("Gastado en octubre");
    expect(norm(summary.textContent)).toContain("$ 245.000");
    expect(norm(summary.textContent)).toContain("+$ 3.200.000");
    expect(norm(screen.getByRole("region", { name: "Cuentas" }).textContent)).toContain("Bancolombia$ 4.455.000");
    expect(within(screen.getByRole("region", { name: "Recientes" })).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Ver todas las cuentas" })).toHaveAttribute("href", "/spaces/sp-personal/accounts");
    expect(screen.getByRole("link", { name: "Ver todos los movimientos" })).toHaveAttribute("href", "/spaces/sp-personal/transactions");
    expect(await axeViolations(container)).toEqual([]);
  });
});
```

(Task 15's `page` and `context` move to `tests/support/ui/dto.ts` as `octoberPage` and `rowContext`, and Task 15's test imports them from there, so both tests share them.)

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/ui/home` and `pnpm exec vitest run --project ui src/modules/ledger/ui/home`
Expected: FAIL.

- [ ] **Step 3: Implement**

`HomeSummary` (server-renderable): an `h1` `home.title` (visually hidden: the space chip names the screen), the summary `section` (`home.summary`): `home.spentIn` with `common.month.<n>` (or `home.spentBetween` with both dates) above the expenses total at 40 px, then `home.income` "Ingresos +{amount}"; the accounts `section` (`home.accounts`): a horizontally scrolling row of 156 px cards (name, balance) with the link `home.allAccounts` (visible text "Ver todas"); the recent `section` (`home.recent`): an `ol` of `TransactionRow`s and the link `home.allTransactions` (visible text "Ver todo"). From 1024 px the summary and accounts sit in a left column and the recent list on the right (the Desktop artboard). The page becomes `<HomeContainer spaceId={spaceId} />`.

Catalog keys (`home`), es / en: `summary` Resumen del período / Period summary; `spentIn` Gastado en {month} / Spent in {month}; `spentBetween` Gastado del {start} al {end} / Spent from {start} to {end}; `income` Ingresos +{amount} / Income +{amount}; `accounts` Cuentas / Accounts; `allAccounts` Ver todas las cuentas / See all accounts; `allAccountsShort` Ver todas / See all; `recent` Recientes / Recent; `allTransactions` Ver todos los movimientos / See all transactions; `allTransactionsShort` Ver todo / See all. (The links' accessible names are the long forms, `aria-label`, and their visible text the short ones.)

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, `pnpm build`, `pnpm test:e2e` (the sign-up scenario still finds the `h1` "Inicio"), then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ledger/ui "src/app/(web)/(app)/spaces/[spaceId]/page.tsx" tests/support/ui/dto.ts src/i18n/messages
git commit -m "feat(ledger): show the period's spending, the accounts and the latest transactions on the home (Refs #71)"
```

---

### Task 18: The ledger and settings @e2e scenarios, and accessibility scans

HU-E9-03's `@e2e` scenarios ("Record a personal expense from the form" and the outline "Pick yesterday at 19:00 in two steps"), the two flows the owner asked to run end to end beyond the story's tags (HU-E9-03's "Accounts screen shows types, balances and totals" and HU-E9-01's "A protected page returns the visitor after sign-in", the sign-in through the screen; both tagged `@e2e` here and in the backlog), HU-E9-13's "Change the formats and see them applied at once", and an axe scan of every screen and sheet in light and dark (WCAG 2.1 AA).

**Files:**
- Create: `tests/e2e/features/ledger.feature`, `tests/e2e/features/settings.feature`, `tests/e2e/steps/ledger.steps.ts`, `tests/e2e/steps/settings.steps.ts`, `tests/e2e/support/money.ts`, `tests/e2e/a11y.spec.ts`
- Modify: `playwright.config.ts`, `package.json`, `tests/e2e/support/world.ts`, `tests/e2e/features/app-shell.feature`, `tests/e2e/steps/auth.steps.ts`, `docs/backlog/E9-web-ui.md`

**Interfaces:**
- Consumes: Task 10's `World`, `Given`/`When`/`Then`; every screen.
- Produces: `minor(pesos: string): string` (`"2,000,000"` → `"200000000"`) and `shown(pesos: string, formats?)` (the amount as the screen writes it, through the app's own `formatMoney`) in `tests/e2e/support/money.ts`; `World.seedAccount(name, body)`, `World.seedCategory(name)` (in the group whose key is `food`), `World.record(kind, body)` (POST with an `Idempotency-Key`); the Playwright project `a11y` (`tests/e2e/a11y.spec.ts`); `test:e2e` runs the `e2e` and `a11y` projects.

- [ ] **Step 1: Write the features**

`tests/e2e/features/ledger.feature`: `Feature: Personal ledger screens`, the story's `Background` verbatim, then three scenarios copied verbatim from HU-E9-03: "Record a personal expense from the form" (`@e2e`), "Accounts screen shows types, balances and totals" (with an `@e2e` tag added) and the outline "Pick yesterday at 19:00 in two steps" (`@e2e`, both example rows). `tests/e2e/features/settings.feature`: `Feature: Settings screen`, HU-E9-13's `Background` and "Change the formats and see them applied at once" (`@e2e`). `tests/e2e/features/app-shell.feature` gains HU-E9-01's "A protected page returns the visitor after sign-in" verbatim with an `@e2e` tag (it needs the transaction list of Task 15, which is why it lands here and not in Task 10). In `docs/backlog/E9-web-ui.md`, tag both added scenarios `@e2e` too (the backlog and the feature files stay identical).

- [ ] **Step 2: Write the steps**

`tests/e2e/steps/ledger.steps.ts` — the step texts are the features' lines; regular expressions where an amount is written bare (`2,000,000 COP`):

```ts
import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures";
import { minor, shown } from "../support/money";

const DAY_KEYS: Record<string, string> = {
  Today: "ledger.day.today",
  Yesterday: "ledger.day.yesterday",
  "The day before yesterday": "ledger.day.dayBeforeYesterday",
};
/** "Today · 23:30" as the Spanish screen writes it: the day translated, the time as it is (a format, not a language). */
const onScreen = (world: { t: (key: string) => string }, english: string) => {
  const [day = "", time = ""] = english.split(" · ");
  return `${world.t(DAY_KEYS[day]!)} · ${time}`;
};
const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();

Given(
  /^"([^"]+)" is signed in with the timezone "([^"]+)", the account "([^"]+)" with opening balance ([\d,]+) COP and the category "([^"]+)" in her personal space$/,
  async ({ page, world }, name: string, zone: string, account: string, pesos: string, category: string) => {
    await world.signUp(name, { timezone: zone });
    await world.seedAccount(account, {
      type: "BANK", openingBalance: { amount: minor(pesos), currency: "COP" },
      institution: account, lastFour: "1203", color: "STEEL",
    });
    await world.seedCategory(category);
    await page.goto("/");
  },
);

Given(/^the Clock reads (\S+)$/, async ({ page }, instant: string) => {
  // The browser's clock; the server's is HEARTH_E2E_FIXED_NOW (2026-11-01T04:30:00Z), which only the "today" headings read.
  await page.clock.setFixedTime(new Date(instant));
});

When("{string} opens the new expense form", async ({ page, world }) => {
  await page.goto(`/spaces/${world.user!.spaceId}/new`);
  await expect(page.locator("[data-ready='true']")).toBeAttached();
});

Then("the date and time chip reads {string}", async ({ page, world }, chip: string) => {
  await expect(page.getByTestId("when-chip")).toHaveText(onScreen(world, chip), { useInnerText: true });
});

When(
  /^"([^"]+)" enters "([^"]+)", ([\d,]+) COP, "([^"]+)" and "([^"]+)" and saves$/,
  async ({ page, world }, _name: string, description: string, pesos: string, category: string, account: string) => {
    await page.getByLabel(world.t("ledger.form.amount")).fill(pesos.replaceAll(",", ""));
    await page.getByLabel(world.t("ledger.form.description")).fill(description);
    await page.getByRole("button", { name: new RegExp(world.t("ledger.form.category")) }).click();
    await page.getByRole("radio", { name: category }).click();
    await page.getByRole("button", { name: new RegExp(world.t("ledger.form.account")) }).click();
    await page.getByRole("radio", { name: new RegExp(account) }).click();
    await page.getByRole("button", { name: world.t("ledger.form.save.EXPENSE") }).click();
    await expect(page).toHaveURL(/\/transactions/);
  },
);

Then(
  /^the transaction has date (\S+), occurredAt "([^"]+)" and timeZone "([^"]+)"$/,
  async ({ world }, date: string, occurredAt: string, zone: string) => {
    const page = await world.api.get(`/api/v1/spaces/${world.user!.spaceId}/transactions?period=${date.slice(0, 7)}`);
    const tx = page.items.find((t: { description: string }) => t.description === "Market");
    expect([tx.date, new Date(tx.occurredAt).toISOString(), tx.timeZone]).toEqual([date, new Date(occurredAt).toISOString(), zone]);
  },
);

Then(
  /^the transaction list shows "([^"]+)" with ([\d,]+) COP at (\S+) under the day heading of the key "([^"]+)"$/,
  async ({ page, world }, description: string, pesos: string, time: string, key: string) => {
    const day = page.getByRole("region", { name: world.t(key) });
    const row = day.getByRole("listitem").filter({ hasText: description });
    await expect(row).toContainText(time);
    expect(norm(await row.textContent())).toContain(norm(shown(pesos)));
  },
);

Then(/^the accounts screen shows "([^"]+)" with a balance of ([\d,]+) COP$/, async ({ page, world }, account: string, pesos: string) => {
  await page.goto(`/spaces/${world.user!.spaceId}/accounts`);
  expect(norm(await page.getByRole("listitem", { name: account }).textContent())).toContain(norm(shown(pesos)));
});
```

The remaining steps of the feature follow the same pattern, each named here with what it does:
- `an income of ([\d,]+) COP into "([^"]+)", an expense of ([\d,]+) COP from "([^"]+)" and a transfer of ([\d,]+) COP from "([^"]+)" to the WALLET "([^"]+)" opened with ([\d,]+) COP` — seeds the WALLET, then records the three movements through `world.record` on 2026-10-31 at 12:00 Bogotá (the expense in the seeded category).
- `the CREDIT_CARD "([^"]+)" with balance (-?[\d,]+) COP, credit limit ([\d,]+) COP and payment day (\d+)` — seeds the card with `terms: { creditLimit, paymentDay }` and a negative opening balance.
- `"([^"]+)" archived the account "([^"]+)"` — seeds a WALLET with that name and posts its `/archive`.
- `"{string}" opens the accounts screen` — goes to the screen.
- `"([^"]+)" shows a balance of ([\d,]+) COP with its type icon, color, institution and last four digits` — the row holds the amount, `"<name> ···1203"` and `[data-icon='bank'][data-color='STEEL']`.
- `"([^"]+)" shows (-?[\d,]+) COP with an available credit of ([\d,]+) COP and its next payment date` — the row holds `shown("-350,000")`, `world.t("accounts.card.available", { amount: shown(…) })` and `world.t("accounts.card.payBy", { date })` with `date` = `formatDate` of the account's `derived.nextPaymentDate` read from the API.
- `the header shows "Available" ([\d,]+) COP and "Net worth" ([\d,]+) COP` — the totals region holds both.
- `"([^"]+)" is listed under archived accounts and is not offered in the account picker of the new expense form` — the archived region holds it; the form's account sheet has no radio of that name.
- `"([^"]+)" has the timeFormat "([^"]+)" and the weekStart "([^"]+)"` — `PATCH /api/v1/me`.
- `"{string}" opens the date and time sheet of the new expense form` — opens the form, waits for `data-ready`, clicks the chip.
- `the quick-day buttons "([^"]+)", "([^"]+)" and "([^"]+)" are shown above a month calendar whose week starts on Monday` — the three radios carry the translated names, the day group precedes the `grid` in the document, and the grid's first `columnheader` is `world.t("common.weekdayShort.MONDAY")`.
- `"([^"]+)" chooses "(Today|Yesterday|The day before yesterday)"` — clicks that radio.
- `sets the time to (\d\d):(\d\d)` — under `H12` first clicks the half (`PM` for hours ≥ 12), then presses the hour button toward the target until the hour `output` shows it, then clicks the minute shortcut `:<mm>`.
- `the sheet clock shows "([^"]+)"` — the clock group's text is the quoted value up to " with PM selected"; when that suffix is present the `PM` radio is checked.
- `the chip reads "([^"]+)"` — applies the sheet (the `ledger.when.apply` button) and checks the chip as above.

`tests/e2e/steps/auth.steps.ts` gains the protected-page steps: "a visitor without a session opens the transactions page of her personal space" signs Ana up through a separate `request.newContext()` (so the page has no cookie), keeps her space id and opens `/spaces/<id>/transactions`; "the visitor is redirected to the sign-in screen and signs in as {string}" expects `/sign-in?next=%2Fspaces%2F<id>%2Ftransactions`, fills the email and password and submits; "the transactions page of her personal space is shown" expects that URL and the `h1` `ledger.list.title`.

`tests/e2e/steps/settings.steps.ts` maps the feature's English names to keys (`Formats` → `settings.formats`, `Region` → `settings.region`, `Appearance and language` → `settings.appearance`; `12-hour` → `settings.timeFormat.H12`): the Background signs Ana up and PATCHes her `locale`, then checks `GET /api/v1/me`'s `preferences.defaults` against the four installation values; "chooses the number format …" clicks the three radios by their sample labels and waits for each `PATCH /api/v1/me` answer (`page.waitForResponse`, status 200), which is what "stored as she makes it" means; "the preview reads …" compares the `status` region's normalized text; "the transaction list shows her amounts, dates and times in the new formats" seeds an account and an expense of 1,234,567.89 COP on 2026-10-16 at 14:30 Bogotá, opens `…/transactions?period=2026-10` and finds `$ 1,234,567.89`, `2:30 PM` and the heading `10/16/2026`.

`tests/e2e/support/money.ts`: `minor("2,000,000")` → `"200000000"` (`-` kept); `shown(pesos, formats = BUILT_IN_FORMATS)` → `formatMoney({ amount: minor(pesos), currency: "COP" }, formats)` importing the app's formatter, so the expected text is written exactly as the screen writes it.

- [ ] **Step 3: Write the accessibility scan**

`tests/e2e/a11y.spec.ts`:

```ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`accessibility in ${colorScheme} (UI Definition of Done)`, () => {
    test.use({ colorScheme });

    test("every M6a screen and sheet has no WCAG 2.1 AA violation", async ({ page }) => {
      const scan = async (where: string) => {
        const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
        expect(violations.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      };
      for (const path of ["/sign-in", "/sign-up"]) {
        await page.goto(path);
        await scan(path);
      }
      // A fresh person with one account, one category and one expense (the same seeding as the e2e World).
      const spaceId = await seedPerson(page, colorScheme);
      for (const path of [`/spaces/${spaceId}`, `/spaces/${spaceId}/transactions`, `/spaces/${spaceId}/accounts`,
        `/spaces/${spaceId}/accounts/new`, `/spaces/${spaceId}/new`, "/settings"]) {
        await page.goto(path);
        await scan(path);
      }
      await page.goto(`/spaces/${spaceId}/new`);
      await page.getByTestId("when-chip").click();
      await scan("date and time sheet");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /Categoría/ }).click();
      await scan("category picker");
    });
  });
}
```

(`seedPerson(page, tag)` signs a person up through `page.request` with its own `x-forwarded-for`, creates "Bancolombia", a category and one expense, and returns the personal space id; it lives in the same file.) `playwright.config.ts`'s `projects` gains `{ name: "a11y", testDir: "tests/e2e", testMatch: "a11y.spec.ts", use: { ...devices["Pixel 7"] } }`, and `package.json`'s `test:e2e` becomes `bddgen && playwright test --project e2e --project a11y`.

- [ ] **Step 4: Run them and see them bite**

Run: `pnpm build && pnpm test:e2e`.
Expected: PASS. To see the scenarios bite: in `whenLabel` swap the zone for `"UTC"` locally — the chip reads "Hoy · 04:30" instead of "Hoy · 23:30" and "Record a personal expense" fails; revert. A dark-theme contrast failure is fixed by moving that token's mix in `globals.css`, never by disabling the rule (ruling P135).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e playwright.config.ts package.json docs/backlog/E9-web-ui.md
git commit -m "test(web): run the ledger and settings @e2e scenarios and scan every screen with axe (Refs #71)"
```

---

### Task 19: Performance gates and the M6a documentation

The owner's condition for keeping React and Next.js: Core Web Vitals budgets that fail CI (ruling P134). Lighthouse 13.5.0's Node API runs each route three times with its mobile defaults (a mid-range phone, simulated slow 4G at 150 ms RTT and 1.6 Mbit/s, 4× CPU slowdown) against the standalone build and checks the medians of LCP, CLS, TBT (the lab stand-in for INP) and the script bytes each route transfers; a Playwright run measures INP itself with `web-vitals` over the record flow on a 4× slower CPU. Then the docs: two ADRs, the decisions index with P117–P141, the architecture page's web section and the stack versions.

**Files:**
- Create: `tests/performance/lighthouse.mjs`, `tests/performance/budgets.json`, `tests/performance/budgets.test.mjs`, `tests/e2e/perf/inp.spec.ts`, `docs/adr/0003-web-ui-talks-to-the-api-through-a-generated-client.md`, `docs/adr/0004-web-ui-testing-and-performance-gates.md`
- Modify: `package.json`, `pnpm-lock.yaml`, `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`, `docs/architecture/README.md`, `docs/stack-versions.md`, `docs/decisions/README.md`, `docs/README.md`, `docs/operations/deploy.md`, `docs/backlog/E9-web-ui.md`, `mkdocs.yml`

**Interfaces:**
- Produces: `pnpm perf` (`node tests/performance/lighthouse.mjs && playwright test --project perf`); `budgetFailures(results: { route: string; lcp: number; cls: number; tbt: number; scriptKb: number }[], budgets): string[]` exported by `tests/performance/lighthouse.mjs`; the CI job `performance`.

- [ ] **Step 1: Install**

`pnpm add -D lighthouse@13.5.0 web-vitals@6.2.3`

- [ ] **Step 2: Write the failing budget test**

`tests/performance/budgets.json` (budgets in KiB of compressed script per route; the metrics are the owner's):

```json
{
  "metrics": { "lcpMs": 2500, "cls": 0.1, "tbtMs": 200, "inpMs": 200 },
  "scriptKb": {
    "/sign-in": 150,
    "/sign-up": 150,
    "/spaces/:id": 170,
    "/spaces/:id/transactions": 175,
    "/spaces/:id/accounts": 170,
    "/spaces/:id/new": 190,
    "/settings": 180
  }
}
```

`tests/performance/budgets.test.mjs` (add `"tests/performance/**/*.test.mjs"` to the `unit` project's `include`):

```js
import { describe, expect, it } from "vitest";
import budgets from "./budgets.json" with { type: "json" };
import { budgetFailures } from "./lighthouse.mjs";

describe("performance budgets (ruling P134)", () => {
  it("names every route and metric over its budget, and passes the ones within", () => {
    const results = [
      { route: "/sign-in", lcp: 1800, cls: 0, tbt: 90, scriptKb: 120 },
      { route: "/spaces/:id/new", lcp: 2600, cls: 0.12, tbt: 250, scriptKb: 201 },
    ];
    expect(budgetFailures(results, budgets)).toEqual([
      "/spaces/:id/new: LCP 2600 ms > 2500 ms",
      "/spaces/:id/new: CLS 0.12 > 0.1",
      "/spaces/:id/new: TBT 250 ms > 200 ms",
      "/spaces/:id/new: script 201 KiB > 190 KiB",
    ]);
  });

  it("fails a route with no budget instead of passing it silently", () => {
    expect(budgetFailures([{ route: "/new-route", lcp: 1, cls: 0, tbt: 0, scriptKb: 1 }], budgets)).toEqual([
      "/new-route: no script budget in tests/performance/budgets.json",
    ]);
  });
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `pnpm exec vitest run --project unit tests/performance`
Expected: FAIL — `lighthouse.mjs` does not exist.

- [ ] **Step 4: Write the gates**

`tests/performance/lighthouse.mjs`:

```js
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";

const BASE = "http://127.0.0.1:3100";
const RUNS = 3;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Ruling P134: every route and metric over its budget; a route without a budget fails rather than passes. */
export const budgetFailures = (results, budgets) =>
  results.flatMap(({ route, lcp, cls, tbt, scriptKb }) => {
    const limit = budgets.scriptKb[route];
    if (limit === undefined) return [`${route}: no script budget in tests/performance/budgets.json`];
    const { lcpMs, cls: maxCls, tbtMs } = budgets.metrics;
    return [
      lcp > lcpMs && `${route}: LCP ${lcp} ms > ${lcpMs} ms`,
      cls > maxCls && `${route}: CLS ${cls} > ${maxCls}`,
      tbt > tbtMs && `${route}: TBT ${tbt} ms > ${tbtMs} ms`,
      scriptKb > limit && `${route}: script ${scriptKb} KiB > ${limit} KiB`,
    ].filter(Boolean);
  });

/** The medians of one route over RUNS Lighthouse runs (mobile defaults: simulated slow 4G, 4× CPU). */
const measure = async (port, url, cookie) => {
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    const { lhr } = await lighthouse(url, { port, output: "json", logLevel: "error", onlyCategories: ["performance"], extraHeaders: cookie ? { cookie } : {} });
    // Fail closed: a missing audit must never read as "0 KiB of script" or "no LCP problem".
    const requests = lhr.audits["network-requests"]?.details?.items;
    if (!Array.isArray(requests)) throw new Error(`Lighthouse returned no network-requests audit for ${url}`);
    if (!lhr.audits["largest-contentful-paint"]?.numericValue) throw new Error(`Lighthouse measured no LCP for ${url}`);
    const scripts = requests.filter((r) => r.resourceType === "Script");
    runs.push({
      lcp: Math.round(lhr.audits["largest-contentful-paint"].numericValue),
      cls: Number((lhr.audits["cumulative-layout-shift"].numericValue ?? 0).toFixed(3)),
      tbt: Math.round(lhr.audits["total-blocking-time"].numericValue ?? 0),
      scriptKb: Math.round(scripts.reduce((sum, r) => sum + (r.transferSize ?? 0), 0) / 1024),
    });
  }
  return Object.fromEntries(["lcp", "cls", "tbt", "scriptKb"].map((k) => [k, median(runs.map((r) => r[k]))]));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const budgets = JSON.parse(readFileSync("tests/performance/budgets.json", "utf8"));
  const server = spawn(process.execPath, ["scripts/e2e-server.mjs"], { stdio: "inherit" });
  const failures = [];
  try {
    for (let deadline = Date.now() + 180_000; ; await sleep(1000)) {
      if (await fetch(`${BASE}/api/v1/health`).then((r) => r.ok, () => false)) break;
      if (Date.now() > deadline) throw new Error("The server did not start within 180 s");
    }
    // A person with data, so the screens render what a household sees (an account, a category, a few expenses).
    const headers = { "content-type": "application/json", "x-forwarded-for": "10.250.0.1" };
    const signUp = await fetch(`${BASE}/api/v1/auth/sign-up`, {
      method: "POST", headers,
      body: JSON.stringify({ name: "Perf", email: `perf-${Date.now()}@example.com`, password: "123456789012", timezone: "America/Bogota" }),
    });
    const cookie = signUp.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const api = async (method, path, body) => {
      const response = await fetch(`${BASE}${path}`, { method, headers: { ...headers, cookie, "idempotency-key": crypto.randomUUID() }, body: body && JSON.stringify(body) });
      if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}`);
      return response.json();
    };
    const { items: [space] } = await api("GET", "/api/v1/spaces");
    const account = await api("POST", `/api/v1/spaces/${space.id}/accounts`, { name: "Bancolombia", type: "BANK", openingBalance: { amount: "200000000", currency: "COP" } });
    const { items: groups } = await api("GET", `/api/v1/spaces/${space.id}/categories`);
    const categoryId = groups.flatMap((g) => g.categories)[0].id;
    for (let i = 0; i < 20; i += 1)
      await api("POST", `/api/v1/spaces/${space.id}/expenses`, {
        description: `Item ${i}`, date: "2026-10-31", occurredAt: new Date(Date.UTC(2026, 9, 31, 13, i)).toISOString(),
        timeZone: "America/Bogota", categoryId, amount: { amount: "1500000", currency: "COP" }, accountId: account.id,
      });
    const browser = await chromium.launch({ args: ["--remote-debugging-port=9223"] });
    try {
      const routes = Object.keys(budgets.scriptKb);
      const results = [];
      for (const route of routes) {
        const url = `${BASE}${route.replace(":id", space.id)}`;
        const result = { route, ...(await measure(9223, url, route.startsWith("/sign") ? null : cookie)) };
        console.log(JSON.stringify(result));
        results.push(result);
      }
      failures.push(...budgetFailures(results, budgets));
    } finally {
      await browser.close();
    }
  } finally {
    server.kill("SIGTERM");
  }
  for (const failure of failures) console.error(failure);
  process.exit(failures.length > 0 ? 1 : 0);
}
```

`tests/e2e/perf/inp.spec.ts`:

```ts
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import budgets from "../../performance/budgets.json" with { type: "json" };

const WEB_VITALS = createRequire(import.meta.url).resolve("web-vitals"); // dist/web-vitals.umd.cjs: window.webVitals

test("INP stays within budget over the record flow on a 4× slower CPU (ruling P134)", async ({ page }) => {
  await page.request.post("/api/v1/auth/sign-up", {
    headers: { "x-forwarded-for": "10.251.0.1" },
    data: { name: "Inp", email: `inp-${Date.now()}@example.com`, password: "123456789012", timezone: "America/Bogota" },
  });
  const { items: [space] } = await (await page.request.get("/api/v1/spaces")).json();
  await page.request.post(`/api/v1/spaces/${space.id}/accounts`, {
    data: { name: "Bancolombia", type: "BANK", openingBalance: { amount: "0", currency: "COP" } },
  });
  await page.addInitScript({ path: WEB_VITALS });
  await page.addInitScript(() => {
    (window as unknown as { __inp: number }).__inp = 0;
    addEventListener("load", () =>
      (window as unknown as { webVitals: { onINP: (cb: (m: { value: number }) => void, o: object) => void } }).webVitals.onINP(
        (metric) => { (window as unknown as { __inp: number }).__inp = metric.value; },
        { reportAllChanges: true },
      ),
    );
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto(`/spaces/${space.id}/new`);
  await expect(page.locator("[data-ready='true']")).toBeAttached();
  for (const digit of ["8", "5", "0", "0", "0"]) await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: /Categoría/ }).click();
  await page.getByRole("radio").first().click();
  await page.getByTestId("when-chip").click();
  await page.getByRole("button", { name: "Una hora menos" }).click();
  await page.keyboard.press("Escape");
  const inp = await page.evaluate(() => (window as unknown as { __inp: number }).__inp);
  expect(inp).toBeGreaterThan(0);
  expect(inp).toBeLessThanOrEqual(budgets.metrics.inpMs);
});
```

`playwright.config.ts`'s `projects` gains `{ name: "perf", testDir: "tests/e2e/perf", use: { ...devices["Pixel 7"] } }`. `package.json` scripts gain `"perf": "node tests/performance/lighthouse.mjs && playwright test --project perf"`. `.github/workflows/ci.yml` gains a `performance` job after `e2e` with the same steps as `e2e` except its last one: `- name: Core Web Vitals and script budgets (Lighthouse mobile, INP with web-vitals)` running `pnpm perf`; `build-image`'s `needs` gains `performance`.

The keypad's digit buttons are named by their digit (`exact: true` keeps "0" from matching "000"); if Task 17a labelled them otherwise, use those labels.

- [ ] **Step 5: Run the gates and read the numbers**

Run: `pnpm exec vitest run --project unit tests/performance`, `pnpm build`, `pnpm perf`.
Expected: every route within its budgets and INP ≤ 200 ms; the script prints one JSON line per route. **If a route misses a budget, do not raise the budget:** stop and report the numbers to the owner (a "Needs your decision" result, risk 1); the usual fixes are moving a client component's import behind `next/dynamic`, splitting a large client component, or rendering a list on the server.

- [ ] **Step 6: Write the documentation**

- `docs/adr/0003-web-ui-talks-to-the-api-through-a-generated-client.md` (Status Accepted, 2026-10-20): Context (D18, the owner's PWA-then-Capacitor direction, the epic's original "server actions" note), Decision (P117, P119, P139: `openapi-typescript` 7.13.0 + `openapi-fetch` 0.17.0, loopback reads with the forwarded cookie, browser writes, no server actions, dependency-cruiser rules), Consequences (one contract for every client; a loopback hop per server read; the auth throttles keep seeing real clients; forms do not share Zod schemas with the server, P118).
- `docs/adr/0004-web-ui-testing-and-performance-gates.md` (Accepted, 2026-10-20): the testing stack of P132 with why (jsdom over happy-dom for axe-core's computations and Testing Library's maturity; Playwright with playwright-bdd because the stories are Gherkin; axe in jsdom without contrast and in real Chromium with it) and the performance gates of P134 (Lighthouse's Node API instead of LHCI: no authenticated-route hook and a heavier dependency tree; INP measured with `web-vitals` because a navigation run has none).
- `docs/decisions/README.md`: the ADR table gains 0003 and 0004; the ruling range becomes P1–P141 (intro line and the "ranges are" sentence: "… M5 P107–P116, and M6a P117–P141"); a new section `### M6a: web shell and ledger (P117–P141)` with the plan link and one row per ruling, "Where" = "Rulings, <n>" (the Self-Review's numbering below).
- `docs/README.md`: "every ruling P1 to P116" → "every ruling P1 to P141". (The range reads P141 since the owner's answers became rulings P140 and P141 after preflight A.)
- `docs/architecture/README.md`: the mermaid `web["Web UI (planned, M6)"]` becomes `web["Web UI (Next.js pages in app, M6)"]`; the Modules paragraph says the `ui/` layer exists in `identity`, `spaces`, `accounts`, `categories` and `ledger`; a new section "Web UI" after "Request lifecycle" describing P117's two paths (Server Component → loopback `/api/v1` with the cookie; browser → same-origin `/api/v1`), the proxy, next-intl without a URL prefix, the formatters rule and the boundary rules, linking ADR 0003.
- `docs/stack-versions.md`: rows for every new dependency with its version and date; `next-intl` "4.14.9 — installed (M6a)"; `Playwright` becomes "1.63.0 — 1.64.0 (2026-10-07) was under two weeks old when M6a was planned (follow-up 4)"; `Tailwind CSS` "4.3.3 — installed (M6a)"; `eslint-config-next` "— not adopted: its plugins do not support ESLint 10 (ruling P136); eslint-plugin-react-hooks 7.1.1 instead".
- `docs/operations/deploy.md`: a "Web UI" note: the UI calls `/api/v1` on `INTERNAL_API_ORIGIN` (default `http://127.0.0.1:$PORT`, which the image's `HOSTNAME=0.0.0.0` serves), nothing to set in `.env`; `HEARTH_E2E_FIXED_NOW` is test-only and must never be set in production.
- `docs/backlog/E9-web-ui.md`: the epic's "Modules involved" and "Container-presentational" lines say pages and containers call `/api/v1` through the generated client, with no server actions (P117); HU-E9-01's technical note "Server actions call `SignUp`…" becomes "The containers call `POST /api/v1/auth/sign-up`, `sign-in` and `sign-out` and `GET /api/v1/spaces` through the generated client; problem+json codes map to `errors.<Code>` keys"; HU-E9-03's "Forms validate with the same Zod contracts … then call server actions wrapping …" becomes "Forms check only what they need to build a request (an amount they can read, an account) and call `POST …/expenses`, `/incomes` and `/transfers`; the API's codes are shown next to their fields (P118)".
- `mkdocs.yml`: the ADR list gains `"0003 Web UI API client"` and `"0004 Web UI tests and performance gates"`; the plans list gains `"M6a Web shell and ledger": superpowers/plans/2026-10-20-m6a-web-shell-and-ledger.md` after M5.

- [ ] **Step 7: Run every gate**

Run: every gate, `pnpm test:e2e`, `pnpm perf`, and `pipx run mkdocs build --strict` if mkdocs is available locally (CI's docs job runs it).
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tests/performance tests/e2e/perf package.json pnpm-lock.yaml vitest.config.ts playwright.config.ts \
  .github/workflows/ci.yml docs mkdocs.yml
git commit -m "ci(web): fail the build on Core Web Vitals and script budgets, and document M6a (Refs #69, #70, #71, #111)"
```

---

## Self-Review

### Story coverage

**HU-E9-01 — App shell, sign-in and sign-up screens (#69)**

| Scenario or technical note | Covered by |
|---|---|
| `@e2e` Sign up lands in the personal space | Task 10 `app-shell.feature` (standalone build); Task 8b container test (body with the browser's zone, lands on `/`); Task 9 shell test ("Perfil de Ana", "Espacio actual: Personal") |
| API error codes are shown as translated messages (`errors.EmailTaken` on the email field, stays) | Task 8b "shows errors.EmailTaken next to the email field and stays on the screen"; Task 8b `fieldOf` |
| `@e2e` Sign out returns to the sign-in screen, and home redirects again | Task 10 `app-shell.feature`; Task 9 profile-sheet test |
| A protected page returns the visitor after sign-in | Task 8a `redirectFor` (path and query kept), `safeNext`, the container's `router.replace(next)`; Task 9 `redirectToSignIn` for an expired cookie; Task 18 runs it end to end through the sign-in screen (`@e2e` added, owner constraint) |
| The space switcher lists every current space; choosing Household makes it active | Task 9 shell tests (both spaces listed, links, `aria-current`, the active chip follows the URL's space) |
| Note: containers over presentational `SignUpForm`, `SignInForm`, `AppShell`, shadcn/ui form components | Tasks 7b, 8a, 8b, 9 (radix-ui primitives in the shadcn/ui style, ruling P117 for the calls) |
| Note: "server actions call `SignUp`, `SignIn`, `SignOut`…" | Replaced by the generated client (ruling P117); the note is amended in Task 19 |
| Note: middleware redirects to `/sign-in?next=<path>`, only same-origin `next` | Next.js 16's `src/proxy.ts` (Task 8a), `safeNext` table |

**HU-E9-02 — Internationalization setup (#70)**

| Scenario or technical note | Covered by |
|---|---|
| `@e2e` Spanish is the default locale | Task 10 `i18n.feature` (`fr-FR` browser); Task 5a `resolveLocale` |
| Signed-in user preference wins | Task 5a `resolveLocale` ("en" over cookie and browser) and `request.ts` reading `getMe()`; Task 11b (language change reloads in English) |
| Outline: numbers, dates and times follow the preferences, not the language (three rows) | Task 6 formatter table (the locale column has no input on purpose); Task 18 settings e2e (the list in the new formats) |
| API error codes are translated, with a fallback (`errors.Unknown` with the request id) | Task 5b `useProblemMessage` and real es and en copy for all 120 codes; Task 7b `ProblemNotice`; Task 4b `problemFrom` (HTML 502, offline) |
| A missing key blocks the merge (`pnpm i18n:check` in the lint job) | Task 5b `i18n-check.test.mjs` ("Missing in en: ledger.expense.title") and the CI step |
| Note: a shared `formatters` module; a test fails on any component that formats with the locale's defaults | Task 6 `formatters.ts`, `tests/architecture/ui-formatting.test.ts` |
| Note: the patterns of `numberFormat`, `dateFormat`, `timeFormat`; COP without a zero fraction; the symbol of the currency; whitespace normalized | Task 6 tests (P121) |
| Note: instants in the user's zone; a transaction in its own zone | Task 6 `formatTimeAt`; Task 15 row test (Madrid) |
| Note: `i18n:check` also requires an `errors.<Code>` for every OpenAPI error code | Task 5b `errorCodesOf` (118 codes + `Unknown`, `InternalError`) |
| Note: built-in es-CO defaults until HU-E1-15 | HU-E1-15 is `Done`; `BUILT_IN_FORMATS` serves only the screens without a person |

**HU-E9-03 — Personal ledger screens (#71)**

| Scenario or technical note | Covered by |
|---|---|
| `@e2e` Record a personal expense from the form (chip "Today · 23:30", date 2026-10-31, occurredAt, zone, list under `ledger.day.today`, balance 1,915,000) | Task 18 `ledger.feature`; Task 17a form test (the exact body); Task 6 `nowIn`, `occurredAtOf`; Task 15 headings; Task 12 balance row |
| Accounts screen shows types, balances and totals (icon, color, institution, last four; card available credit and next payment; Available and Net worth; archived not offered) | Task 12 screen test; Task 14 account picker leaves archived out; Task 18 end to end (`@e2e` added, owner constraint) |
| Pick an optional subcategory (chips in the same sheet; none → category; Vegetables → "Groceries › Vegetables") | Task 14 picker tests; Task 17a body `c-veg` / `c-groceries`; Task 15 row path |
| Transaction list by day and time, with totals and filters | Task 15 list tests (order, "20:45", untimed Salary, 4 rows, totals, the filter's query and total) |
| `@e2e` Outline: pick yesterday at 19:00 in two steps (H24 and H12) | Task 18 outline (both rows); Task 16 sheet tests ("19 : 00", "7 : 00" with PM) |
| Pay the credit card with a transfer (no category; expense counted once; Available down, Net worth unchanged) | Task 17a transfer test; Task 15 transfer row. The figures are the API's (HU-E2-07, `tests/acceptance/account-totals.test.ts`) and the UI only shows them (Task 12), so no UI test recomputes them |
| Note: containers per screen | `AccountsContainer`, `TransactionListContainer`; one `RecordFormContainer` with the three kinds as tabs instead of three form containers (one form, one artboard; Design deviations 7) |
| Note: Zod contracts on the client, server actions, a fresh `Idempotency-Key` per submit | Rulings P117, P118, P128 (one key per draft; a double click and a retry never duplicate) |
| Note: cursor pagination with "Load more" (50), period selector by the space policy | Task 15 (`LoadMore`, `GET …/periods` neighbours) |
| Note: time rules (defaults to now, always `occurredAt` with the zone, no clearing, untimed rows last and without a time, zone name when it differs) | Tasks 6, 15, 16, 17a (ruling P129) |
| Note: the date and time sheet (quick days, calendar from `weekStart`, steppers, 5-minute steps, shortcuts, Now, H24/H12 clock) | Task 16 |
| Note: validation errors next to their field, nothing created | Task 17a (`errors.InvalidAmount`) |
| Note: category picker (parents first with icon and color, subcategory chips, never required) | Task 14 |
| Note: accounts screen and account form (type's attributes only, two switches, type immutable) | Tasks 12, 13 (the form only creates, so the type cannot change) |

**HU-E9-13 — Settings screen (#111)**

| Scenario or technical note | Covered by |
|---|---|
| `@e2e` Change the formats and see them applied at once | Task 18 `settings.feature`; Task 11a form test (three PATCHes, the preview) |
| The language changes only the texts | Task 11b |
| A field following the rule says "Default", and Reset returns a changed field to the rule (`timeFormat` null) | Task 11a (`settings-state` and the form test) |
| A field locked by the installation rules shows a lock badge (component test with a stubbed `locked`) | Task 11a, as the story's note says |
| Note: `SettingsContainer` over `SettingsForm`, `FormatPreview`, `LockBadge`; `GET` and `PATCH /api/v1/me`; codes next to the field | Tasks 11a, 11b |
| Note: sections Formats, Region (searchable IANA list), Appearance and language | Tasks 11a, 11b |
| Note: no Save button, optimistic with rollback; fixed samples with the shared formatters | Task 11a (rollback test) |
| Note: Default and Reset semantics (formats → null, zone and language → the installation's value) | Task 3 (the API answers the installation's zone and language), Task 11b |
| Note: theme as a device setting; the language reloads the texts | Tasks 7a, 11b |

**Owner constraints**

| Constraint | Covered by |
|---|---|
| Core Web Vitals in CI (LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1, mid-range phone on 4G) and per-route JS budgets that fail the build | Task 19 (`performance` job; `build-image` needs it) |
| Server Components first, small client components, charts lazy | Pages and lists are Server Components; client components only for forms, sheets and "Load more"; no chart in M6a |
| Only `/api/v1` through the generated client | Tasks 4a, 4b (P117, P119, P139) |
| #125 before the account form | Task 1 |
| Deletes are logical; archive and restore | Tasks 2, 13 |
| Component tests, e2e of the critical flows, accessibility in CI | Tasks 4a, 10, 18 (sign-up, sign-out and sign-in; record with time and subcategory; accounts with totals; settings formats; axe light and dark) |
| Every string translatable; formats from the preferences | Tasks 5a, 5b, 6 and every UI task's catalog keys |

### Review Focus pins

| Review Focus | Pinned by |
|---|---|
| 1. The language leaking into formats | Task 6 table and the architecture scan; Task 11b language test; Task 18 settings e2e |
| 2. Day boundaries and zones | Task 6 `nowIn`, `stepMinutes`, `formatTimeAt`; Task 15 Madrid row; Task 16 steppers; Task 18 both outlines |
| 3. Sessions and redirects | Task 8a `safeNext` (including the tab and newline rows) and `redirectFor` tables, the public layout's real session check; Task 9 `redirectToSignIn` |
| 4. Double submits and retries | Task 17a `useIdempotencyKey` and "sends a double click once, and retries a failed request with the same key" |
| 5. Codes without a message and broken responses | Task 4b `problemFrom`; Task 5b `useProblemMessage`; Tasks 8b and 17a field mapping |
| 6. Archived and foreign data in pickers | Tasks 12, 13, 14 and the Task 18 accounts scenario |

### Rulings

1. **The UI's only way to the backend** (Tasks 4b, 8a, 9, 13, 15, 17a). **Ruled by the controller (P117):** accepted that every screen talks to `/api/v1` through one client generated from `openapi/openapi.snapshot.json` (`openapi-typescript` 7.13.0 types, `openapi-fetch` 0.17.0 at run time). Server Components read through it over loopback HTTP (`INTERNAL_API_ORIGIN`, default `http://127.0.0.1:$PORT`), forwarding only the request's `cookie`, client address and `accept-language`; every write (sign-up, sign-in, sign-out, records, accounts, `PATCH /me`) runs in the browser against the same endpoints, then `router.refresh()`. There are no server actions. Reasons: the owner's PWA-then-Capacitor direction needs every screen to work over the public contract alone; writes from the browser keep the auth throttles keyed on the real client (a server action would make every sign-in come from 127.0.0.1); one contract keeps the UI from depending on use cases. Amends the epic's "pages and server actions" notes and HU-E9-01's and HU-E9-03's (Task 19). Alternatives rejected: server actions calling use cases (bypass the contract), server actions calling the API (an extra hop and the throttle problem), calling route handlers in-process (no public Next.js API, a hand-kept route table), a hand-written client (drifts from the snapshot).
2. **Forms and the server's schemas** (Tasks 8b, 13, 17a). **Ruled by the controller (P118):** forms do not import `src/modules/*/contracts` (server code that pulls application modules and `zod-openapi` into the bundle); they check only what they need to build a request (an amount they can read, an account) and the API is the validator: each problem code, `ValidationFailed` path or public `field` is shown next to its field, else above the button. The sign-up hint follows the API's 8-character rule, not the SignUp artboard's 12. Amends HU-E9-03's "Forms validate with the same Zod contracts".
3. **UI boundaries** (Task 4a). **Ruled by the controller (P119):** dependency-cruiser's `ui-talks-only-to-the-api` forbids `src/app/(web)`, `src/i18n`, `src/proxy.ts`, `src/shared/ui` and every `src/modules/*/ui` from importing a module's `domain`, `application`, `infrastructure` or `contracts`, `src/composition`, `src/app/api`, `src/shared/http`, `src/shared/infrastructure`, the kernel beyond `time-zone.ts`, `local-date.ts` and `style.ts`, and `drizzle-orm`, `pg`, `better-auth`, `zod-openapi` and `zod`; `ui-modules-only-through-public-ui-api` lets a module's ui reach another's only through `ui/index.ts` (and the pages likewise); `only-ui-reaches-ui` keeps server layers out of `ui/`. The kernel's three pure files are allowed because the record form needs the same time arithmetic as the server (`instantAt`) and the style vocabulary.
4. **Locale resolution** (Tasks 5a, 5b). **Ruled by the controller (P120):** no locale in the URL. The signed-in user's stored locale wins, then the visitor's `hearth.locale` cookie (the sign-in screens' "ES · EN" toggle), then the first supported `Accept-Language` by weight, then Spanish. Messages are typed (`AppConfig`), so a key used in code but missing from `es.json` fails `tsc`, and tests throw on a missing message; `pnpm i18n:check` reads the error codes from the 4xx and 5xx descriptions of the snapshot (parentheticals dropped, comma-separated PascalCase words) plus `Unknown` and `InternalError`. Alternatives rejected: `[locale]` routes (two URLs per screen for a choice stored in the profile), `next-intl`'s middleware (the stored locale needs the session).
5. **Formatting** (Task 6). **Ruled by the controller (P121):** only `src/shared/ui/format/` formats, from the effective preferences as arguments; non-breaking spaces between the symbol and the number and in `SPACE_COMMA` groups; U+2212 before the symbol for negatives; a zero fraction dropped for every currency, any other kept whole; symbols COP `$`, USD `US$`, EUR `€`, exponent 2; 24-hour times with two-digit hours, 12-hour with `AM`/`PM` in both languages; dates numeric with `/` and no leading zeros. `tests/architecture/ui-formatting.test.ts` fails on `toLocale*`, `Intl.NumberFormat`, `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`, `Intl.ListFormat`, `useFormatter` or `getFormatter` anywhere else in the UI.
6. **One style vocabulary** (Task 1, #125). **Ruled by the controller (P122):** the kernel's `PALETTE` (the sixteen upper-case keys) is the palette of categories and accounts alike; the kernel's `SYMBOLS` names 61 symbols, the 58 of categories plus `cash`, `trend` and `wallet`; categories still allow their 58, accounts allow `cash`, `bank`, `wallet`, `card`, `piggy`, `trend`, `coins`, `dots`, `users`, `briefcase`, `car`, `star`, `gift`, `home`, `plane`, `phone`. Migration `0019_account_style_vocabulary` maps stored values (moss → SAGE, clay → CORAL, slate → STEEL, gold → MUSTARD, the rest by name; banknote → cash, landmark → bank, credit-card → card, piggy-bank → piggy, trending-up → trend, hand-coins → coins, circle-ellipsis → dots, gem → star, house → home, smartphone → phone). Alternatives rejected: two vocabularies with two UI mappings (the issue's problem), adding the account names to the categories' list (changes HU-E3-05's 58, P60), Lucide icons in the UI (a third set and a dependency). The account style enum change stays in `/api/v1` (not `/api/v2`, spec 7) because v1 has no released client yet (our own UI is the only consumer), and migration `0019` is not backward compatible: rolling the app back past it means restoring the pre-upgrade backup (`docs/operations/backups.md`).
7. **Restoring an account** (Task 2). **Ruled by the controller (P123):** `POST /api/v1/spaces/{spaceId}/accounts/{accountId}/restore` (`RestoreAccount`), with the archive's authorization (its owner, or OWNER and ADMIN for a shared fund) and answers; restoring an active account answers it unchanged. Names stay unique among archived and active accounts, so a restore never collides.
8. **Default zone and language** (Task 3). **Ruled by the controller (P124):** `preferences.defaults` of `GET` and `PATCH /api/v1/me` gains `timezone` (`APP_TIMEZONE`) and `locale` (`"es"` until HU-E8-18 stores an installation language), so Settings shows "Default" and sends the installation's value on Reset (the API keeps both concrete, P64).
9. **Routes and redirects** (Tasks 8a, 9). **Ruled by the controller (P125):** `/sign-in`, `/sign-up`, `/` (to the personal space), `/spaces/{spaceId}` (home), `…/transactions`, `…/accounts`, `…/accounts/new`, `…/new?type=`, `/settings`; the active space is the URL's, and `/settings` shows the personal space in the shell. `src/proxy.ts` (Next.js 16) sends a request without a session cookie to `/sign-in?next=<path and query>`; `next` is honoured only when it starts with one `/` (not `//`), holds no backslash and no control character anywhere (the URL parser drops tabs and newlines, so `/\t/evil.example` would leave the origin; preflight A) and is not a public screen; the public screens check the session for real and send a signed-in person home, so an expired cookie never loops.
10. **What M6a leaves out of the approved design** (Tasks 9, 12, 14, 15, 17a, 17b). **Ruled by the controller (P126):** no Plan and Saldos tabs, Home plan figures or balance card (HU-E9-08, HU-E9-07), no hide-balances eye, no recent-category chips, no Categories, Members or Installation rules entries in the user menu (HU-E9-04, HU-E9-05, HU-E9-14), no create-or-join in the space sheet (HU-E9-05), no create, edit or Manage controls in the category picker (HU-E9-12), no split or space chips in the record form (HU-E9-06), no transaction search or account and type filters (the API has no search), no "Moneda de tus espacios" settings row, no transaction editing or deleting (M6b), no account editing (#120). The owner confirmed the transaction and tab choices as P140 and P141.
11. **Container-presentational in the App Router** (every UI task). **Ruled by the controller (P127):** server containers are a pure `load*` function over the `Api` (tested with the fake API) plus an async component; presentational components take DTOs, `formats` (serializable, so the same component renders on the server and in a client list) and `useTranslations`; a 401 redirects to sign-in, a 404 renders `notFound()`, any other problem renders a `ProblemNotice`, because Next.js hides server error messages in production.
12. **Idempotency keys** (Task 17a). **Ruled by the controller (P128):** one key per draft: a fresh UUID when the body changes and after a save; a double click (the button is disabled while pending) and a retry of an unchanged draft reuse it, so they never duplicate and never answer `IdempotencyKeyConflict`. Amends HU-E9-03's "each submit sends a fresh Idempotency-Key".
13. **The time of a record** (Tasks 6, 16, 17a). **Ruled by the controller (P129):** the form's zone is the browser's (the recorder's, P41), falling back to the profile's during the server render; the first instant is the render's, replaced by the browser's clock on mount unless the person already chose one; the minute steppers move to the next multiple of five in the direction pressed (the approved QuickAdd logic: :32 → :35 or :30), wrapping within the chosen day; days after today are disabled; there is no "no time" control.
14. **The transaction list** (Task 15). **Ruled by the controller (P130):** day headings `ledger.day.today` and `ledger.day.yesterday`, else the date in the person's format (the artboard's "Vie 24 oct" names are language text, D23); no per-day totals (a day can span two pages; only the API's period totals are figures); periods navigated with `GET …/periods` from the day before the start and after the end; the category filter sends `categoryIds` (the API rolls subcategories up); archived categories and accounts still name old rows.
15. **The accounts screen and form** (Tasks 12, 13). **Ruled by the controller (P131):** sections Banks, wallets and cash; Credit cards; Savings and investments; Debts; Other; Shared funds; then Archived; no per-section totals; an account without a color takes its type's (`TYPE_COLORS`, from the artboard); archive from a confirmation sheet, restore from the archived section; the create form asks only the type's attributes (`FIELDS_BY_TYPE`, the API's allow-list), asks a card or loan for what is owed and sends it negative, and sends a switch only when the person touches it (null keeps the type's default, P51), its starting position from `SWITCH_DEFAULTS`, which a test pins to `switchesOf`.
16. **Testing stack** (Tasks 4a, 10). **Ruled by the controller (P132):** a Vitest `ui` project on jsdom 30.1.2 with Testing Library (react 16.3.3, dom 10.4.2, user-event 14.6.7, jest-dom 7.0.1) and axe-core 4.13.0 without the contrast rule; Playwright 1.63.0 with playwright-bdd 9.2.1 for the `@e2e` scenarios and `@axe-core/playwright` 4.13.0 for WCAG 2.1 AA scans in light and dark, against the standalone build and a disposable PostgreSQL. jsdom over happy-dom: axe-core's ARIA and name computations are validated on jsdom, and happy-dom's 21 line is under two weeks old. Newer versions under two weeks old are not pinned (follow-up 4).
17. **The e2e clock and clients** (Task 10). **Ruled by the controller (P133):** `HEARTH_E2E_FIXED_NOW` (an ISO instant, default 2026-11-01T04:30:00Z in `scripts/e2e-server.mjs`) fixes the container's `Clock` and the UI's `serverNow()`, so "today" agrees on both sides; each scenario sets the browser's clock with `page.clock.setFixedTime`; each test sends its own `x-forwarded-for`, so the sign-up throttle (10 per hour per address) never trips. Never set in production (documented in `docs/operations/deploy.md`).
18. **Performance gates** (Task 19). **Ruled by the controller (P134):** Lighthouse 13.5.0's Node API with its mobile defaults, three runs per route, medians: LCP ≤ 2500 ms, CLS ≤ 0.1, TBT ≤ 200 ms, and compressed script per route within `tests/performance/budgets.json` (sign-in and sign-up 150 KiB, home and accounts 170, transactions 175, settings 180, record form 190); INP ≤ 200 ms measured with `web-vitals` 6.2.3 over the record flow on a 4× slower CPU; a route without a budget fails; the job blocks the image build. A missed budget is the owner's decision, never a silent raise. Alternatives rejected: `@lhci/cli` 0.15.1 (no hook for authenticated routes, a heavier dependency tree with an Express server), Next.js 16's build output (it no longer prints per-route sizes), TBT alone for INP (a lab proxy, not the metric).
19. **Theme and palette** (Task 7a). **Ruled by the controller (P135):** the theme (system, light, dark) is a device setting in `localStorage` (`hearth.theme`), applied before paint by an inline script; light tokens are the Home artboard's and the palette's tints and inks the QuickAdd artboard's; the canvas has no dark palette, so dark tints and inks are mixed from the light inks (`color-mix` in oklab) and verified by the dark axe scans, a failing pair fixed by moving its mix.
20. **Lint** (Task 4a). **Ruled by the controller (P136):** no `eslint-config-next` (its plugin tree targets ESLint ≤ 9); `eslint-plugin-react-hooks` 7.1.1 (ESLint 10 supported) on `src/**/*.{ts,tsx}` (hooks live in `.ts` files too; Playwright fixtures under `tests/` stay out); accessibility is checked by axe at run time rather than `jsx-a11y`.
21. **Settings behaviour** (Tasks 11a, 11b). **Ruled by the controller (P137):** each choice is PATCHed at once, applied optimistically and rolled back with its error next to the field; choosing the installation's own value stores `null` (the field follows the rule, as the approved Settings artboard does); Reset of a format sends `null`, of the zone or language the installation's value; the zone list is `Intl.supportedValuesOf("timeZone")` filtered by name and city, at most 50 shown; a locked field shows its effective value read-only with no Reset.
22. **Amount input** (Task 13). **Ruled by the controller (P138):** amounts are typed or tapped in the person's number format (group separators optional, groups of exactly three, one decimal separator), turned into minor units of the currency's exponent with `BigInt`-safe strings, more decimals than the exponent refused before the request; 0 is sent and the API's `InvalidAmount` shown.
23. **The generated client in the repository** (Task 4b). **Ruled by the controller (P139):** `src/shared/ui/api/schema.d.ts` is committed, generated only from the reviewed snapshot (never from a running server), excluded from Prettier, ESLint and the review-size count, and checked by `pnpm api:check` in the lint job; a snapshot change regenerates it in the same commit.
24. **Transactions are read-only in M6a** (Tasks 15, 17a). **Ruled by the controller (P140), agreed by the owner on 2026-10-20:** M6a records and lists transactions and does not edit or delete them; the Activity screen's rows open nothing. Editing and deleting from Activity (with the `If-Match` flow of `PATCH` and `DELETE …/transactions/{transactionId}`, which the API already has) is an M6b follow-up (follow-up 2). Reasons: HU-E9-03's acceptance criteria record and list only; the Activity artboard's edit sheet and the story's "an untimed row gets its first time by editing" belong to the editing story. Alternative rejected: bringing editing into M6a (a second form mode, the `If-Match` conflict path and its e2e, for no criterion of these four stories).
25. **No Plan and Saldos tabs yet** (Tasks 9, 17b). **Ruled by the controller (P141), agreed by the owner on 2026-10-20:** the Plan and Saldos tabs are hidden, not shown disabled, until HU-E9-08 and HU-E9-07 build their screens, so M6a's bottom bar has three slots (Inicio, Registrar, Movimientos) and the desktop rail the same destinations. Reasons: a disabled tab is a dead control that every screen reader announces and a "coming soon" label is copy to translate and remove; each tab arrives with its screen. Alternative rejected: disabled tabs with a "coming soon" label.

### Preflight A (Tasks 1–10)

A dry run applied Tasks 1–10 verbatim on `61df4d0` (Windows 11, Docker Desktop, Node 24.15.0 with ICU 78.2, pnpm 12.11.2), ran every gate after every task and `pnpm test:e2e` after Task 10, and reported READY WITH FIXES. Its fixes are folded into the tasks above:

- **B1** (Task 1, step 6): the `"pine"`, `"ember"` and `"sky"` replacements in `account.test.ts`, `create-account.test.ts` and `manage-accounts.test.ts` (the last two added to the Files list); without them `tsc` fails with TS2820.
- **B2** (Task 4a): `cn.test.ts` takes a typed `hidden` instead of `false && "hidden"` (`no-constant-binary-expression`).
- **B3** (Task 5a, step 1): `pnpm-workspace.yaml`'s `allowBuilds` denies `@parcel/watcher` and `@swc/core`, next-intl's two packages with install scripts; otherwise `pnpm install --frozen-lockfile` exits 1 in CI and in the Docker build.
- **B4** (Task 6): `zoneOffset` writes `GMT` for ICU 78's `GMT+0`.
- **B5** (Task 7b): the `ChoiceGroup` arrow test holds the key down (`{ArrowRight>}` then `{/ArrowRight}`), because radix selects on focus only while the arrow is pressed.
- **B6** (Task 8a, security, Review Focus 3): `safeNext` refuses a backslash or a control character anywhere, and its table gains the tab and newline rows; `/\t/evil.example` otherwise resolves to `https://evil.example/`.
- **B7** (Task 8b): the `EmailTaken` test looks for "Inicia sesión" inside the email field's error, because the footer has a link with the same name.
- **B8** (Task 10): `webServer.gracefulShutdown` and a `globalTeardown` that removes every container labelled `hearth.test=e2e`; Playwright otherwise force-kills the server and the database container outlives every run.
- Accepted non-blocking fixes: Task 5 is two commits, 5a (about 150 lines) and 5b (about 420), at the corrected boundary (`problem.ts` belongs to 4b and `auth` to 8a, and `use-problem-message.test.tsx` needs the `errors` namespace); Task 5b writes real es and en copy for all 120 error codes; Task 7a's `globals.css` keeps `docs/` out of Tailwind's scan (`@source not`); Task 4a's hooks rule covers `src/**/*.{ts,tsx}`; Task 7b's `Logo` takes the Main artboard's two exact paths; Task 9 has a named split point (components first, because `AppShell` renders `ProfileSheet`); Task 10's bite check deletes the sign-out call (a `safeNext` mutation does not bite there). Three small corrections ride along: `SpaceSwitcher` takes `activeSpace` (its trigger names the active space), Task 7b's Files list no longer names the catalogs (it adds no key), and Task 10 notes the teardown's expected `Connection terminated unexpectedly` log lines (N12).
- Not folded in (cosmetic or for later, left to the controller): dependency-cruiser cruising `.test.tsx` files (N7), the two stale "0018" lines of `docs/architecture/data-model.md` (N8), the schema comment's placement (N9), old values in stored idempotent replays (N10), Vitest 5's `Cannot find module` RED wording on `.ts` files (N11; Task 5a's step 3 already uses it), the pre-existing Turbopack warning about `src/instrumentation.ts` (N13), a test pinning the unknown-space 404 (N16, a candidate row for Task 18).

Measured sizes (changed lines from `git diff --cached --numstat`, excluding `pnpm-lock.yaml`, `schema.d.ts`, the snapshot and `drizzle/meta/`):

| Task | Estimate | Measured | Note |
|---|---|---|---|
| 1 | ~380 | 492 | includes B1; Prettier puts the 61 `SYMBOLS` one per line |
| 2 | ~220 | 107 | |
| 3 | ~130 | 32 | |
| 4a | ~360 | 148 | includes B2 |
| 4b | ~260 | 436 | |
| 5 | ~480 | 570 | over 500: planned as 5a ~150 and 5b ~420 |
| 6 | ~330 | 370 | includes B4 |
| 7a | ~340 | 406 | Prettier puts every CSS declaration on its own line |
| 7b | ~390 | 446 | includes B5 (B3's two lines moved to 5a) |
| 8a | ~380 | 398 | includes B6 |
| 8b | ~300 | 300 | includes B7 |
| 9 | ~420 | 496 | at the limit: named split point, about 390 and 105 |
| 10 | ~480 | 377 | includes B8 (+15) |

With the fixes, every gate was green after every task: `unit`, `ui`, `integration` and `acceptance` (245 files, 3,365 tests), `tsc`, `eslint`, `prettier --check`, depcruise, `db:check`, `check:pinned`, `api:check`, `i18n:check`, `next build` and three `pnpm test:e2e` runs (3 scenarios, plus two mutation runs). All 21 new pins exist and were published on or before 2026-10-05. Part B (Tasks 11–19) runs separately; Tasks 11–19 are unchanged here except for the ruling range in Task 19's docs step (P117–P141).

### Design deviations (the stories win)

1. Locale artboard: the English column writes `COP 1,355,000`; HU-E9-02 and P68 put the currency's symbol and the person's formats in both languages, so both read `$ 1.355.000` for `DOT_COMMA`.
2. Settings artboard: the date options show ISO `2026-10-16` and the times `19:00` / `7:00 p. m.`; HU-E9-02's `YMD` is `2026/10/16` and HU-E9-13's samples are 1,234,567.89, 2026-10-16 and 14:30 with `2:30 PM`; the artboard's currency row is not built (P126).
3. SignUp artboard: "Al menos 12 caracteres"; the API's rule is 8 (P118).
4. Activity artboard: day headings with weekday and month names and per-day totals; the story asks for `ledger.day.*` keys then the date in the person's format, and no per-day totals are built (P130); its search field and Cuenta and Tipo filters are not built (P126).
5. Home and Desktop artboards: the plan figure, the balance card and the eye toggle wait for HU-E9-07 and HU-E9-08 (P126); the bottom bar has three slots, not five (P141).
6. QuickAdd artboard: its "sin hora" option is forbidden by HU-E9-03; its split and space chips are HU-E9-06; its pencil and "Nueva categoría" controls are HU-E9-12; its recent-category chips are deferred (P126).
7. The three form containers of HU-E9-03's notes are one `RecordFormContainer` with the kinds as tabs, as the QuickAdd artboard draws one sheet.
8. CategoryPicker and QuickAdd draw two picker layouts; M6a builds one (search, groups with chips, subcategory chips in the same sheet).
9. NewAccount artboard: no color or icon pickers are drawn, so none are built (the type's defaults apply); its "Debes hoy" label is used for cards and loans.
10. Accounts artboard: per-section totals and rows linking to detail screens (CardPurchase, CDT: "concepto futuro") are not built (P131).

### Risks

1. The script budgets and the LCP limit are planning figures, not measurements: React 19 and the Next.js runtime alone take a large part of 150 KiB. If Task 19 measures a route over budget, the executor stops and reports (a "Needs your decision" result) instead of raising it.
2. Lighthouse's simulated throttling on shared CI runners varies between runs; medians of three reduce, not remove, the noise.
3. `openapi-typescript` 7.13.0 declares a TypeScript ^5 peer while Hearth uses 6.0.3; Task 4b's type check proves the generated file, and a future TypeScript bump must re-run `pnpm api:check`.
4. Every Server Component read is one loopback HTTP hop; `INTERNAL_API_ORIGIN` must reach the app from inside its container (the default `127.0.0.1:$PORT` does with the image's `HOSTNAME=0.0.0.0`).
5. The e2e server's clock is fixed for the whole run; a future scenario that needs another server "today" needs its own server (or a request-scoped clock).
6. jsdom 30 requires Node ≥ 24.15; `engines` still allows 24.12 (follow-up 9).
7. Cookie-authenticated writes from the browser rely on Better Auth's `SameSite=Lax` cookie against cross-site requests, and `defineRoute` parses a JSON body whatever its content type (follow-up 7).
8. The theme's inline script will need a hash or nonce once a Content-Security-Policy is added (follow-up 8).
9. The derived dark palette may fail AA on some keys; Task 18's dark scan finds them and the token is moved.
10. `radix-ui` 1.7.0 and `web-vitals` 6.2.3 were published exactly two weeks before the pin date (2026-10-05).

### Follow-ups

1. The account edit form, with #120 (answer stored and effective icon and switches).
2. Editing, deleting and restoring transactions from the Activity screen (M6b, P140), with the `If-Match` flow and a restore endpoint for transactions; an untimed row gets its first time by editing (HU-E9-03 note).
3. A text search, and account and type filters, in the transaction list (an API story first).
4. Bump on or after the two-week mark: `@playwright/test` 1.64.x (1.64.0 on 2026-10-21), `jsdom` 30.1.3 (2026-10-29), `@axe-core/playwright` and `axe-core` 4.14.0 (2026-10-29), `@testing-library/user-event` 14.6.8 (2026-10-27), `radix-ui` 1.8.1 (2026-10-26); the dates are each release's day plus fourteen.
5. The deferred controls of P126 with their stories (HU-E9-04, HU-E9-05, HU-E9-06, HU-E9-07, HU-E9-08, HU-E9-12, HU-E9-14), the recent-category chips and the hide-balances toggle.
6. A designer's review of the derived dark palette.
7. Refuse cookie-authenticated writes whose `content-type` is not `application/json` (or whose `Origin` is foreign) in `defineRoute`.
8. A Content-Security-Policy with a hash for the theme script.
9. Raise `engines.node` to `>=24.15.0 <25` for jsdom 30.
10. Move HU-E9-01, HU-E9-02, HU-E9-03 and HU-E9-13 to `Done` in `docs/backlog/README.md` and update their issue bodies (Task 19's amended notes) when the pull request merges.
11. #128 (report latency before the dashboards) is carried to M6's dashboards.

### Placeholder and consistency scan

- No "TBD" and no step without its file, its test or its command; every component step names its file, its exported name, its props, the roles and labels its test queries, and its catalog keys with both translations.
- Names across tasks: `PALETTE`, `PaletteKey`, `SYMBOLS`, `SymbolName` (Task 1); `restoreAccount`, `RestoreAccount` (2); `regionDefaults` (3); `cn`, `VisuallyHidden`, `axeViolations` (4a); `Api`, `createApi`, `browserApi`, `serverApi`, `getMe`, `getSpaces`, `loaded`, `Loaded`, `outcomeOf`, `Problem`, `problemFrom`, `hasSession`, `SESSION_COOKIES`, `PATH_HEADER`, `fakeApi`, `jsonResponse`, `problemResponse`, `meDto`, `spaceDto`, `cop` (4b, 8a); `resolveLocale`, `LOCALE_COOKIE`, `renderWithIntl`, `IntlWrapper` (5a); `useProblemMessage`, `checkCatalogs`, `errorCodesOf` (5b); `Formats`, `BUILT_IN_FORMATS`, `Wall`, `formatNumber`, `decimalOf`, `formatMoney`, `formatDate`, `formatTime`, `formatTimeAt`, `currencyOf`, `browserTimeZone`, `allTimeZones`, `zoneCity`, `zoneOffset`, `nowIn`, `relativeDay`, `stepMinutes`, `stepHour`, `withHalf`, `occurredAtOf`, `monthGrid`, `serverNow` (6); `THEME_KEY`, `Theme`, `resolveTheme`, `readTheme`, `saveTheme`, `THEME_BOOTSTRAP`, `SYMBOL_PATHS`, `UI_ICONS`, `UiIconName`, `Icon`, `SymbolIcon`, `paletteVars` (7a); `Button`, `TextField`, `Switch`, `ChoiceGroup`, `Badge`, `Avatar`, `Logo`, `Sheet`, `ProblemNotice` (7b); `PUBLIC_PATHS`, `safeNext`, `redirectFor`, `SignInFormContainer`, `SignInForm`, `PasswordField`, `LanguageToggle` (8a); `fieldOf`, `SignUpFormContainer` (8b); `SpaceSummary`, `personalSpaceOf`, `activeSpaceOf`, `AppShell`, `AppShellContainer`, `SpaceSwitcher`, `NavLinks`, `ProfileSheet`, `redirectToSignIn` (9); `clockFrom`, `globalTeardown`, `World`, `test`, `Given`, `When`, `Then` (10); `choose`, `reset`, `rowState`, `FormatPreview`, `LockBadge`, `SettingsForm`, `SettingsContainer`, `chooseRegion`, `regionState`, `TimeZoneSheet` (11a, 11b); `ACCOUNT_SECTIONS`, `sectionsOf`, `TYPE_COLORS`, `colorOf`, `rateText`, `AccountRow`, `AccountsScreen`, `loadAccounts`, `AccountsContainer`, `accountDto` (12); `parseDecimal`, `minorOf`, `PERSONAL_TYPES`, `FIELDS_BY_TYPE`, `OWED_TYPES`, `SWITCH_DEFAULTS`, `accountBodyOf`, `accountFieldOf`, `NewAccountForm`, `ArchiveAccountButton`, `RestoreAccountButton` (13); `activeTree`, `findCategory`, `categoryPath`, `matches`, `CategoryIcon`, `CategoryPicker`, `AccountPicker`, `groupDto`, `categoryDto` (14); `groupByDay`, `RowContext`, `TransactionRow`, `TransactionList`, `loadTransactionList`, `TransactionListContainer`, `LoadMore`, `transactionDto` (15); `When`, `whenLabel`, `DateTimeSheet` (16); `RecordKind`, `RecordDraft`, `requestOf`, `RecordField`, `recordFieldOf`, `useIdempotencyKey`, `RecordForm`, `RecordFormContainer` (17a); `periodName`, `HomeSummary`, `HomeContainer`, `octoberPage`, `rowContext` (17b); `minor`, `shown` (18); `budgetFailures` (19).
- Environment variables: `INTERNAL_API_ORIGIN` (optional, defaulted), `HEARTH_E2E_FIXED_NOW` (test-only), `E2E_PORT` (test-only, default 3100), `TEST_DATABASE_URL` (existing); nothing new for `.env.production.example` (P114 carried).
- Migrations: one, `0019_account_style_vocabulary` (no DDL). OpenAPI changes: Tasks 1, 2, 3 only.
- New dependencies: exactly the Global Constraints list; `pnpm check:pinned` passes after each install task.

## Open questions for the owner

None. The planner's two questions were ruled by the controller and agreed by the owner on 2026-10-20: transactions stay read-only in M6a, and editing and deleting from Activity is an M6b follow-up (P140); the Plan and Saldos tabs are hidden until their screens exist (P141).
