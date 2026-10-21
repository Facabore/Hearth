# M6b Addendum: Edit, Delete with Undo and Save Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person fix a mistake. Tapping a transaction row in Movimientos or in the home's recent list opens a detail sheet with its type, amount, date and time, category, account, description, who paid and, for a shared expense, each participant's share, plus Editar and Eliminar. Editar opens the record form prefilled and saves only what changed through `PATCH` with `If-Match`; a version conflict says so and loads the latest version. Eliminar deletes logically and shows a toast with Deshacer for about 8 s, which restores the transaction. Every successful save (record, edit, settle-up) announces itself in a `role=status` toast above the bottom navigation.

**Architecture:** Everything M6a and M6b built stays the frame. The UI talks only to `/api/v1` through the generated client (P117). Containers are pure `load*` functions plus async Server Components exported from `ui/server.ts` (P127, P153). Writes run in the browser. Three backend tasks come first, each with TDD:
- a restore endpoint, `POST …/transactions/{transactionId}/restore` (Task A1, P185);
- `PATCH …/transactions/{transactionId}` also accepts the accounts and who paid (Task A2, P186);
- `PATCH` also accepts how an expense is split (Task A3, P186).

The detail sheet is addressed by the URL (`?tx=<id>`), so Back closes it and a reload keeps it open. Its code loads with `next/dynamic` only when a `tx` is present (P189). Editing reuses `RecordForm` through one optional `edit` prop, so the record route keeps its budget. The prefill and the diff body are pure, tested modules that only the edit route imports (P191, P192). One shared `ToastProvider` in `src/shared/ui` lives in the signed-in layout. It has its own persistent live regions and adds no dependency (P195).

**Tech Stack:** unchanged from M6b: Node.js 24.21.0, pnpm 12.11.2, Next.js 16.4.0, React 19.3.0, TypeScript 6.0.3 strict, Zod 4.6.5 (server only), next-intl 4.14.9, Tailwind CSS 4.3.3, `radix-ui` 1.7.0, `openapi-typescript` 7.13.0 + `openapi-fetch` 0.17.0, Vitest 5.0.3 with jsdom 30.1.2 and Testing Library, axe-core 4.13.0, Playwright 1.63.0 with `playwright-bdd` 9.2.1 and `@axe-core/playwright` 4.13.0, Lighthouse 13.5.0 and `web-vitals` 6.2.3, PostgreSQL 18.6. **No new dependency.**

**Spec:** `docs/superpowers/specs/2026-10-11-hearth-design.md` covers:
- D8: every delete is logical, and the audit keeps the full history;
- D9: a member moves money only through accounts they own;
- D15: guests;
- spec 5.2: payments and shares;
- spec 5.3: the split rules;
- spec 7: `If-Match` and `ETag`.

Stories:
- `docs/backlog/E4-ledger.md` HU-E4-06 (edit and soft delete with an audit trail; the API this plan extends);
- `docs/backlog/E9-web-ui.md` HU-E9-03 (#71) and its "Follow-ups after M6a", item 2: "Editing, deleting and restoring transactions from the Activity screen (M6b, ruling P140), with the `If-Match` flow and a restore endpoint for transactions; an untimed row gets its first time by editing";
- HU-E9-06 (#74) for the shared expense's payer and split;
- HU-E9-07 (#75) for the settle-up toast.

The UI rules are the owner's UX review of 2026-10-21:
- `.superpowers/sdd/2026-10-21-m6b/dispatch.md`, section "UI rules every screen must meet";
- `.superpowers/sdd/ux-state-of-the-art.md`, checklist items 20, 23, 27 and 28, and anti-patterns 8 and 9.

Format template, conventions and rulings in force: `docs/superpowers/plans/2026-10-21-m6b-shared-spaces-split-balances.md`, rulings P1–P183. This addendum rules **P184–P199**. M6c rules from P200.

**Baseline: `development` after M6b's Task 22 commit** (`docs: record M6b …`). M6b runs its Tasks 19–22 first, on the same branch. While planning, `origin/development` was at `09eaefb` (M6b Task 18). The worktree `C:/Things/hearth-worktrees/rb` held the same tree. The following was verified on that state:

- `GET`, `PATCH` and `DELETE /api/v1/spaces/{spaceId}/transactions/{transactionId}` exist (`src/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route.ts`).
  - `GET` and `PATCH` answer the `Transaction` with `etag: "<version>"` (`etagOf`). The DTO carries `version`.
  - `PATCH` reads `If-Match` with `ifMatchVersion`: absent means no check, malformed or stale means 412 `PreconditionFailed`. The repository compares versions again on save.
  - `PATCH`'s body today is `description`, `date`, `occurredAt` (null answers `TimeRequired`), `timeZone`, `categoryId` and `amount`, nothing else.
  - A new amount follows a sole payment and a sole share. Otherwise it fails with 409 `SharesDoNotMatchAmount` (HU-E4-06's scenario). So today **an amount of a shared expense cannot be corrected at all**, and no account, payer or split can change.
  - `DELETE` soft-deletes and answers 204. It checks `canModify` (OWNER and ADMIN any, MEMBER their own), the open period and `ensureCurrentParties`, then audits `DELETED` with every value `to: null`.
- **There is no restore or undo path for transactions.** Accounts and categories have `POST …/restore`. `TransactionRepository.findById(spaceId, id, includeDeleted = false)` can read a deleted row, and `save` writes `deletedAt`, so a restore needs no repository change.
- The audit's `action` is a `text` column (`drizzle/0005_ledger.sql`), with `["UPDATED", "DELETED"]` only in the TypeScript schema and the contract. A new value needs no migration.
  - The audit already stores an expense's `payments` and `shares` as deterministic JSON (D8, Task 0b of M3).
  - It does not store an income's or a transfer's accounts.
  - `DrizzleTransactionRepository.save` does not write `source_account_id` or `destination_account_id`.
- Recurrence occurrences point at their transaction (`recurrence_occurrences.transaction_id`). No ledger use case treats a recurring transaction differently: the API enforces no extra rule for them.
- `radix-ui` 1.7.0 exports `Toast` (`@radix-ui/react-toast` 1.2.2). Its `Root` renders an `<li>` with no role. A separate announce node with `role="status"` lives about 1 s. It needs `Collection`, `DismissableLayer` and `Portal` in the bundle of every page that mounts the provider. `Sheet` is lazy because Radix Dialog costs about 25 KiB (P134).
- The record route `/spaces/:id/new` measured 203 KiB of its 205 KiB script budget (the owner's report of 2026-10-21).
- In the UI:
  - `TransactionRow` is a server-and-client-safe `<li>`, used by `TransactionList`, `LoadMore` and `HomeSummary`. It opens nothing (P140).
  - `RecordForm` (435 lines) always POSTs, and `ScreenHeader` takes `backHref`.
  - The bottom navigation is `fixed bottom-0 z-10 h-[76px] pb-[env(safe-area-inset-bottom)]`, and sheets are `z-50`.
  - `errors.PreconditionFailed` reads "Alguien cambió esto mientras lo editabas. Recarga para ver la última versión."
  - There is no `(app)/layout.tsx`. Each `[spaceId]` layout remounts when the space changes.
  - `tests/e2e/layout.spec.ts` has the `sheets` list, the reflow paths and the "way back" screens.
  - `tests/e2e/a11y.spec.ts` scans M6a's screens, and M6b Task 21 adds `a11y*.spec.ts`.
  - `tests/performance/lighthouse.mjs` gains `routeUrl(route, ids)` in M6b Task 21.

**Out of scope (follow-ups):**
- more than one payer per expense (spec 5.2: v1 offers one);
- editing a settlement or a fund contribution in place: they are deleted and recorded again (P190);
- a fund warning after an edit (`PATCH` answers no `warnings`; P186);
- a transaction's audit history in the UI;
- a trash screen listing deleted transactions;
- bulk edits;
- changing an expense's type.

### Log

- **L1**, the owner, 2026-10-20: "Tu enfoque es terminar lo que tenemos en las HUS siempre con TDD y RDD, tienes granted para todo, resolvé con lo que tengas, luego al final organizamos las ideas de cosas pendientes"
- **L2**, the controller, 2026-10-21: M6a's P140 made transactions read-only and moved editing and deleting to M6b. The M6b plan left them out (P179). A journey-based usability review of 2026-10-21 found two problems:
  - "Fix a mistake: fail": rows are not interactive, and nothing edits or deletes;
  - "No save confirmation": the screen jumps to Movimientos with no status message.

  This addendum covers both. It names the backend changes, and the planner decides and records everything without asking the owner.

## Global Constraints

- **Versions are exactly M6b's** (`docs/stack-versions.md`).
  - **No new dependency** of any kind.
  - `pnpm check:pinned` passes, and every task leaves `pnpm-lock.yaml` unchanged.
  - The toast is the project's own component (P195), the sheets M6a's lazy `Sheet`.
- **The UI talks only to `/api/v1` through the generated client** (P117).
  - No server action, and no route handler written for the UI.
  - No import from a UI folder of `src/composition`, of a module's `domain`, `application`, `infrastructure` or `contracts`, or of `src/shared/http` or `src/shared/infrastructure` (P119, `pnpm lint:boundaries`).
  - A module's UI reaches another's only through `ui/index.ts` (client-safe) or `ui/server.ts` (containers, P153).
- **Every UI string is translatable** (es default, en).
  - Visible text, `aria-label`s and placeholders come from `src/i18n/messages/{es,en}.json`.
  - `pnpm i18n:check` fails on a key in one catalog only and on an error code without `errors.<Code>`.
  - **Spanish copy is neutral Latin American Spanish with tú** ("Elimínalo", "Puedes", "Elige"), never voseo.
- **Formats come from the effective preferences** (P121). Amounts, dates and times go only through `src/shared/ui/format/`. Wire amounts stay `{ amount: "<minor units>", currency }` and are parsed with `BigInt`, never `Number`.
- **The server is authoritative.**
  - The edit form sends only what changed (P192), with `If-Match: "<version>"` (P193).
  - The split preview mirrors `splitShares` (P166), but the body carries the person's choices.
  - An API problem is shown next to its field (P118), never as a raw code.
- **Deletes are logical** (D8): the UI never offers anything else, and undo is a restore (P185, P194). **No confirmation dialog for a reversible action**: undo instead (UX checklist 28, anti-pattern 8).
- **Status messages** (WCAG 4.1.3):
  - Success goes into a `role="status"` region that exists before the message, and failure into `role="alert"`.
  - Focus never moves to a toast. F8 focuses it.
  - It pauses while hovered or focused, and Escape or its close button dismisses it (WCAG 2.2.1, UX checklist 28).
- **Accessibility and layout** (dispatch "UI rules every screen must meet"):
  - Every non-top-level screen has the `ScreenHeader` Volver link to an explicit parent route.
  - No horizontal scroll at 390 px or 320 px. Every sheet's last control is visible above the bottom bar.
  - Targets are at least 44 × 44 px, and contrast meets WCAG AA in light and dark.
  - The toast sits above the bottom navigation and the safe area and never covers the navigation's Registrar button.
  - Component tests run `axeViolations`. The e2e run scans the new sheet, the edit route and the toast in both themes (Task A10).
- **Performance budgets fail CI** (P134, P154, P177).
  - The edit route and the list with an open sheet get budgets (P198).
  - `/spaces/:id/new` stays within 205 KiB with the toast provider. A missed budget is fixed by lazy loading, never raised.
  - The detail sheet loads behind `next/dynamic`, and the prefill and diff modules are imported only by the edit route.
- **Hexagonal boundaries** (ADR 0001) stay as they are for the backend. Tasks A1–A3 follow M6b's Tasks 1–2:
  - the use case authorizes;
  - problems are `problem+json` with stable codes;
  - `openapi/openapi.snapshot.json` is regenerated, never edited by hand;
  - `src/shared/ui/api/schema.d.ts` is regenerated with `pnpm api:types` in the same commit (P139).
- **Strict TDD**: every behaviour starts with a failing test that is run and seen failing.
  - Pure UI logic goes in `*.test.ts` (Vitest `unit`).
  - Components and containers go in `*.test.tsx` (Vitest `ui`).
  - Backend use cases have unit tests next to them, plus acceptance tests in `tests/acceptance` against PostgreSQL.
  - `@e2e` scenarios use Playwright + playwright-bdd against the standalone build and a disposable PostgreSQL.
  - After GREEN, run mutation checks on the load-bearing lines (the dispatch's discipline).
- Code, identifiers, comments, docs and generated artifacts are in English; UI copy is in the catalogs, and Gherkin is in English as M6b's is. Commits are conventional and reference the story issue (`Refs #<n>`). No AI attribution and no `Co-Authored-By` lines (the owner's global rule).
- Agents never read or edit `.env`, `.env.*` or `.env.production.example` (P114). This addendum adds no environment variable and no migration.
- **Gates for every task:**
  - `pnpm exec vitest run` with each of `--project unit`, `--project ui`, `--project integration` and `--project acceptance`;
  - `pnpm format`, `pnpm exec eslint .`, `pnpm exec tsc --noEmit` (delete `.next` first) and `pnpm exec prettier --check .`;
  - `pnpm lint:boundaries`, `pnpm db:check`, `pnpm check:pinned`, `pnpm api:check` and `pnpm i18n:check`;
  - from Task A4 on, also `pnpm build && pnpm test:e2e` (Docker running);
  - Tasks A4 and A10 also run `pnpm perf`.

## Review Focus

1. **Undo really undoes, and only once.**
   - Cases:
     - delete then restore, with the balance before, after and after again;
     - a double click on Deshacer;
     - Deshacer after the period was closed;
     - restoring a transaction that is not deleted;
     - a MEMBER restoring someone else's;
     - a deletion of an expense whose participant left.
   - Expected:
     - the row and its balance come back exactly, with the next version;
     - the audit reads `DELETED` then `RESTORED`;
     - a second restore changes nothing and writes no audit;
     - `PeriodClosed`, `InsufficientRole` and `NotASpaceMember` refuse as `DELETE` does.
   - Pinned in Task A1 (unit and acceptance) and Task A6 (one restore request for a double click, the alert toast on failure).
2. **Who may move money through an edit (D9).**
   - Cases:
     - Ana moves her expense to another of her accounts;
     - an OWNER moves a MEMBER's expense to the OWNER's account;
     - an income moved by someone other than its receiver;
     - an own transfer edited by an ADMIN;
     - a payer switched to a guest, to the fund, or to another registered member;
     - an archived account;
     - an account of another space;
     - a settlement's or a fund contribution's accounts.
   - Expected:
     - only the account's owner moves money from or into it (`AccountNotOwned`);
     - archived accounts take no new movement (`AccountArchived`);
     - parts a type does not have, settlements and fund contributions are `FieldNotEditable`;
     - the detail sheet offers Editar only where the API would accept the viewer's change.
   - Pinned in Task A2 (unit, acceptance) and Task A5 (`actionsFor`).
3. **A shared expense's new amount and split.**
   - Cases:
     - 300,000 EQUAL among Ana and Juan changed to 400,000;
     - a PERCENT 40/60 expense changed to 250,000;
     - an EXACT split whose amount changes;
     - a split that leaves a member who left;
     - a SHARES 2/1 expense.
   - Expected:
     - 200,000 each;
     - 100,000 / 150,000;
     - the EXACT form says what is unassigned and cannot save;
     - `NotASpaceMember`;
     - the SHARES expense prefills as PERCENT 66.67 / 33.33 and an untouched save sends no `split`;
     - the body never carries the preview, and the API's shares are what the list shows.
   - Pinned in Task A3 (unit, acceptance) and Task A7 (`initialOf`, `editBodyOf`).
4. **Only what changed travels, and conflicts are honest.**
   - Cases:
     - an untouched save;
     - a description cleared;
     - only the amount changed;
     - the date changed on a timed row in another zone;
     - an untimed recurring row given a time;
     - a stale `If-Match`.
   - Expected:
     - no request and no toast;
     - `{ description: "" }`;
     - `{ amount }`;
     - `date`, `occurredAt` and `timeZone` in the row's own zone;
     - the three time fields in the editor's zone;
     - a 412 shows `errors.PreconditionFailed` with "Cargar la última versión", which reloads the newest values and nothing is saved.
   - Pinned in Task A7 (`editBodyOf` table) and Task A8 (the conflict test).
5. **The sheet and the toast never trap or hide anything.**
   - Cases:
     - Back while the sheet is open;
     - a deep link to `?tx=<deleted id>`;
     - the toast at 320 px with a long Spanish message;
     - the toast while the bottom navigation is shown;
     - keyboard only.
   - Expected:
     - Back closes the sheet, and the deep link shows `errors.TransactionNotFound` inside the sheet;
     - the toast wraps, stays within the width and sits above the navigation without covering Registrar;
     - Deshacer is at least 44 px and F8 reaches it;
     - the status region exists before the first message.
   - Pinned in Task A4 (toast tests), Task A5 (the sheet's Back and missing states) and Task A10 (layout and axe).

## Execution Workflow

- Work on the long-lived branch `development` from the baseline above. Every task is implemented there with Strict TDD. Implementers stage; the controller commits.
- **This plan is committed before Task A1** (`docs(plans): add the M6b addendum for editing, deleting and save feedback (Refs #71)`), because Task A11 adds it to the `mkdocs.yml` nav and `mkdocs build --strict` fails on a page missing from the repository.
- **Issue numbers.**
  - HU-E9-03 is #71: M6a's follow-up 2 belongs to its Activity screen.
  - The shared parts reference HU-E9-06 (#74), and the settle-up toast HU-E9-07 (#75).
  - The controller confirms the numbers on Project #4 before Task A1.
- **RDD for every commit**, exactly as M6b's Execution Workflow describes it. The owner's standing answer to a review consent envelope is `granted`. Record per commit the tier and outcome in `.superpowers/sdd/2026-10-21-m6b-addendum/progress.md`.
- **Risk lines and verifiers.** Each of these gets its own commit and one independent verifier after its own checks:
  - Task A1: `Risk: item 1` (a persisted audit value, and balances move back);
  - Task A2: `Risk: items 1 and 2` (stored money parts change; the D9 guard on accounts);
  - Task A3: `Risk: item 1` (stored shares change).

  Every other task closes with `Risk: none`, its focused test and the suite run inline.
- Code blocks follow M6b's convention. They are complete where they decide something (contracts, pure functions, test files, exact copy) and are not guaranteed to match Prettier's wrapping, so run `pnpm format` before the gates. For React components the plan fixes:
  - the file and the exported name;
  - the props;
  - the roles and labels the tests query;
  - the catalog keys with both translations;
  - the tests.
- **Task labels and order:** A1 → A11 in order, 11 commits; Tasks A5 and A8 have named split points.
  - A1–A3 are backend and land first.
  - A4 comes before A6 and A8, which show toasts.
  - A5 comes before A6 and A8.
  - A7 comes before A8.
- **Sizes** (estimates, authored changed lines, excluding `schema.d.ts` and snapshot regenerations):

  | Task | Lines |
  |---|---|
  | A1 | ~300 |
  | A2 | ~430 |
  | A3 | ~260 |
  | A4 | ~380 |
  | **A5** | **~460** (split point in the task) |
  | A6 | ~260 |
  | A7 | ~420 |
  | **A8** | **~400** (split point in the task) |
  | A9 | ~330 |
  | A10 | ~300 |
  | A11 | ~180 |

  The controller measures each staged candidate (`git diff --cached --numstat`) and splits at the named point when it is over ~500.
- **OpenAPI changes:**
  - Task A1: `POST …/transactions/{transactionId}/restore`, and `RESTORED` in the audit entry's `action`.
  - Task A2: `accountId`, `payments`, `sourceAccountId` and `destinationAccountId` in `PATCH …/transactions/{transactionId}`, and its new codes.
  - Task A3: `split` in the same body.

  Each regenerates `schema.d.ts` in the same commit.
- **The pull request.** The M6b pull request from `development` into `main` (closing #73, #74, #75) also carries this addendum. Its description adds these PR notes:
  1. the three API changes and their D9 review;
  2. the two new budgets;
  3. the rulings P184–P199;
  4. the follow-ups.

  The addendum's commits reference #71, which stays closed (HU-E9-03 is `Done`); they are listed in the PR as M6a's follow-up 2.
- Task-to-issue map:

  | Issue | Tasks |
  |---|---|
  | #71 | A1, A2, A4, A5, A6, A7, A8, A9, A10, A11 |
  | #74 | A2, A3, A7, A9 |
  | #75 | A4 (the settle-up toast) |

## File Structure

```
.
├── openapi/openapi.snapshot.json                         # restore (A1); PATCH body and codes (A2, A3)
├── src/
│   ├── i18n/messages/{es,en}.json                        # errors.FieldNotEditable (A2); toast.* (A4); ledger.detail.*, ledger.toast.*, ledger.edit.* (A4–A8); balances.toast.settled (A4)
│   ├── modules/ledger/
│   │   ├── domain/transaction.ts                         # restore, restorationChanges (A1); parts in reviseTransaction, audited accounts (A2)
│   │   ├── application/
│   │   │   ├── restore-transaction.ts (+ .test.ts)       # (A1)
│   │   │   ├── payments.ts                               # resolvePayments, moved out of record-expense (A2)
│   │   │   ├── edited-parts.ts (+ edit-parts.test.ts)    # accounts, payer (A2), split (A3)
│   │   │   ├── edit-transaction.ts, record-expense.ts, ports.ts, index.ts   # (A1, A2, A3)
│   │   ├── infrastructure/{ledger.schema.ts, drizzle-transaction-repository.ts}   # RESTORED (A1); account columns on save (A2)
│   │   ├── contracts/ledger.contract.ts                  # restore path, RESTORED (A1); edit body, editChangesFromBody (A2, A3)
│   │   └── ui/
│   │       ├── transaction-row.tsx, transaction-list.tsx, load-more.tsx, transaction-list-container.tsx   # href, ?tx (A5)
│   │       ├── home/{home-summary.tsx, home-container.tsx}                                                # href, ?tx (A5)
│   │       ├── detail/{tx-href.ts, transaction-actions.ts, detail-loader.ts, transaction-sheet.tsx,
│   │       │          transaction-sheet-host.tsx, use-delete-with-undo.ts}                              # (A5, A6)
│   │       ├── edit/{edit-initial.ts, edit-request.ts, origin.ts, edit-container.tsx,
│   │       │        edit-transaction-form.tsx}                                                      # (A7, A8)
│   │       ├── record/record-form.tsx                    # toast (A4); edit prop (A7)
│   │       ├── split/shared-fields.tsx                   # defaultSplit prop (A7)
│   │       └── server.ts                                 # EditTransactionContainer (A8)
│   ├── modules/balances/ui/settle-up-sheet.tsx           # "Pago registrado" (A4)
│   ├── shared/
│   │   ├── http/problem.ts                               # FieldNotEditable's public `field` (A2)
│   │   └── ui/{molecules/toast.tsx, index.ts, icons/ui-icons.ts}   # ToastProvider, useToast (A4); pencil, trash (A5)
│   ├── app/api/v1/spaces/[spaceId]/transactions/[transactionId]/{route.ts, restore/route.ts}   # (A1, A2)
│   └── app/(web)/(app)/
│       ├── layout.tsx                                    # new: ToastProvider (A4)
│       └── spaces/[spaceId]/{page.tsx, transactions/page.tsx,
│                             transactions/[transactionId]/edit/page.tsx}   # ?tx (A5); the edit route (A8)
├── tests/
│   ├── acceptance/{ledger.test.ts, shared-expenses.test.ts}   # (A1, A2, A3)
│   ├── e2e/features/{edit-delete.feature, shared-expense.feature}, e2e/steps/edit.steps.ts, e2e/support/world.ts   # (A9)
│   ├── e2e/{layout.spec.ts, a11y-edit.spec.ts}           # (A10)
│   └── performance/{budgets.json, lighthouse.mjs}        # (A10)
└── docs/ (decisions, backlog E4 and E9, README) and mkdocs.yml   # (A11)
```

### How the UI reads and writes

| Need | Where it runs | Through |
|---|---|---|
| The transaction behind `?tx=<id>`, the members that name its payer and shares, the viewer's role | Server Component container (`loadTransactionDetail`) | `serverApi()`: `GET …/transactions/{id}`, `GET …/members` in a shared or direct space |
| The edit form's transaction, accounts, categories and shared context | Server Component (`loadEditContext`) | `serverApi()`, reusing `loadSharedContext` |
| Delete | Client (`useDeleteWithUndo`) | `browserApi()` `DELETE …/transactions/{id}`; then `router.replace(origin)` and `router.refresh()` |
| Undo | Client, from the toast's action | `browserApi()` `POST …/transactions/{id}/restore`; then `router.refresh()` |
| Save an edit | Client (`EditTransactionForm`) | `browserApi()` `PATCH …/transactions/{id}` with `If-Match: "<version>"`, the body from `editBodyOf` |
| Save feedback | Client, any form | `useToast().show(…)` from the `(app)` layout's `ToastProvider` |

### Helpers every task reuses (never re-implement them)

- **API:** `browserApi`, `serverApi`, `loaded`, `getMe`, `getSpaces` (`src/shared/ui/api/{client,server}.ts`); `problemFrom`, `type Problem` (`problem.ts`); `useProblemMessage`, `ProblemNotice`.
- **Formats and time:** `formatMoney`, `formatDate`, `formatTimeAt`, `formatNumber`, `decimalOf`, `MINUS` (`format/formatters.ts`); `currencyOf` (`format/currencies.ts`); `parseDecimal`, `minorOf` (`format/amount-input.ts`); `nowIn`, `occurredAtOf` (`time/when.ts`); `browserTimeZone`, `zoneCity` (`format/zones.ts`); `serverNow`.
- **Components:** `Sheet`, `Button`, `Icon`, `VisuallyHidden`, `ScreenHeader`, `ProblemNotice` (`@/shared/ui`); `CategoryIcon`, `categoryPath`, `findCategory`, `activeTree` (`@/modules/categories/ui`); `memberLabel`, `personalSpaceOf` (`@/modules/spaces/ui`).
- **Ledger UI:** `TransactionRow`, `RowContext`, `hrefOf`, `RecordForm`, `requestOf`, `recordFieldOf`, `loadSharedContext`, `sharedContextOf`, `SharedFields`, `SplitDraft`, `Payer`, `When`.
- **Backend:** `canModify`, `changedDebits`, `changesBetween`, `deletionChanges`, `softDelete`, `reviseTransaction` (domain); `openPeriod`, `ensureCurrentParties`, `ownAccount`, `accountInSpace`, `partyAccount`, `fundAccount`, `usableCategory` (`application/checks.ts`); `splitShares`; `etagOf`, `ifMatchVersion`; `whenFromBody`, `moneyFromDto`.
- **Tests:**
  - UI: `fakeApi`, `jsonResponse`, `problemResponse`, `renderWithIntl`, `axeViolations`, `transactionDto`, `accountDto`, `categoryDto`, `groupDto`, `spaceDto`, `householdSpace`, `memberDto`, `guestDto`, `rowContext`, `cop`.
  - Backend: `ledgerFixture`, `householdLedger`, `anExpense`, `anIncome`, `aTransfer`, `aSettlement`, `ACCOUNTS`, `codeOf`, `unwrap`, `money`, `memberOf`; `startTestApp`, `call`, `problemOf`, `registerUser`, `household`, `addGuest`, `balanceOf`, `post`, `inSpace`, `cop`.
  - e2e: the e2e `World`, `Given`/`When`/`Then`, `minor`, `shown`.

---

### Task A1: Restore a deleted transaction

The backend half of Deshacer (ruling P185). `POST /api/v1/spaces/{spaceId}/transactions/{transactionId}/restore`:
- reads the transaction with `includeDeleted`;
- checks what `DELETE` checks: membership, `canModify`, the open period and `ensureCurrentParties`;
- clears `deletedAt` with a compare-and-set on the version;
- audits `RESTORED`, with every value `from: null`;
- answers 200 with the transaction and its new ETag.

Restoring a transaction that is not deleted answers it unchanged and writes no audit, so a repeated Deshacer is harmless.

**Files:**
- Create: `src/modules/ledger/application/restore-transaction.ts`, `src/modules/ledger/application/restore-transaction.test.ts`, `src/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/restore/route.ts`
- Modify: `src/modules/ledger/domain/transaction.ts` (after `deletionChanges`), `src/modules/ledger/application/ports.ts` (the `AuditEntry` action), `src/modules/ledger/application/index.ts`, `src/modules/ledger/infrastructure/ledger.schema.ts` (the `action` enum), `src/modules/ledger/contracts/ledger.contract.ts` (`AuditEntrySchema`, a path), `src/composition/container.ts` (`ledger.restoreTransaction`), `src/modules/ledger/application/archived-space.test.ts`, `tests/acceptance/ledger.test.ts`, `openapi/openapi.snapshot.json`, `src/shared/ui/api/schema.d.ts`

**Interfaces:**
- Consumes: `canModify`, `deletionChanges`'s `auditedValues`, `openPeriod`, `ensureCurrentParties`, `TransactionRepository.findById(…, true)`, `save`.
- Produces:
  - `restore(tx: Transaction, now: Date): Transaction`;
  - `restorationChanges(tx: Transaction): ChangeSet` (domain);
  - `type RestoreTransaction = (input: { spaceId: string; userId: string; transactionId: string }) => Promise<Result<Transaction>>`;
  - `createRestoreTransaction(deps: LedgerDeps): RestoreTransaction`;
  - `Container["ledger"]["restoreTransaction"]`;
  - `AuditEntry["action"]` is `"UPDATED" | "DELETED" | "RESTORED"`;
  - the operation `restoreTransaction`.

- [ ] **Step 1: Write the failing tests**

`src/modules/ledger/application/restore-transaction.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { anExpense, householdLedger, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import { createDeleteTransaction } from "./delete-transaction";
import { createListAudit } from "./list-audit";
import { createListTransactions } from "./list-transactions";
import { createRestoreTransaction } from "./restore-transaction";

const asAna = { spaceId: "space-ana", userId: "u-ana" };

const setup = () => {
  const state = { closed: false };
  const fixture = ledgerFixture({ closedPeriods: { isClosed: async () => state.closed } });
  const market = anExpense("2026-10-31", 8_500_000n, { description: "Market" });
  fixture.store.rows.push(market);
  const list = createListTransactions(fixture.deps);
  return {
    ...fixture,
    state,
    market,
    remove: createDeleteTransaction(fixture.deps),
    restore: createRestoreTransaction(fixture.deps),
    history: createListAudit(fixture.deps),
    idsIn: async () =>
      unwrap(await list({ ...asAna, period: "2026-10", after: null, limit: 50 })).items.map((t) => t.id),
  };
};

describe("RestoreTransaction (ruling P185)", () => {
  it("brings a deleted expense back to the list with the next version and audits the restore", async () => {
    const { remove, restore, history, idsIn, market, deps } = setup();
    unwrap(await remove({ ...asAna, transactionId: market.id }));
    expect(await idsIn()).toEqual([]);
    const restored = unwrap(await restore({ ...asAna, transactionId: market.id }));
    expect(restored).toMatchObject({ id: market.id, deletedAt: null, version: 3, amount: 8_500_000n });
    expect(await idsIn()).toEqual([market.id]);
    const entries = unwrap(await history({ ...asAna, transactionId: market.id }));
    expect(entries.map((e) => e.action)).toEqual(["DELETED", "RESTORED"]);
    expect(entries[1]).toMatchObject({
      actorUserId: "u-ana",
      at: deps.clock.now(),
      changes: expect.objectContaining({
        description: { from: null, to: "Market" },
        amount: { from: null, to: "8500000" },
        payments: {
          from: null,
          to: '[{"memberId":"member-ana","accountId":"acc-bancolombia","amount":"8500000"}]',
        },
      }),
    });
  });

  it("answers a transaction that is not deleted unchanged and writes no audit (a second Deshacer)", async () => {
    const { restore, history, market } = setup();
    expect(unwrap(await restore({ ...asAna, transactionId: market.id })).version).toBe(1);
    expect(unwrap(await history({ ...asAna, transactionId: market.id }))).toEqual([]);
  });

  it("refuses an unknown id and a closed period, as deleting does (HU-E4-06)", async () => {
    const { remove, restore, state, market } = setup();
    expect(codeOf(await restore({ ...asAna, transactionId: "tx-unknown" }))).toBe("TransactionNotFound");
    unwrap(await remove({ ...asAna, transactionId: market.id }));
    state.closed = true;
    expect(codeOf(await restore({ ...asAna, transactionId: market.id }))).toBe("PeriodClosed");
  });

  it("lets OWNER and ADMIN restore any transaction, a MEMBER only their own, a VIEWER none", async () => {
    const { deps, store } = householdLedger();
    const deleted = anExpense("2026-10-20", 3_000_000n, {
      spaceId: "space-household",
      deletedAt: new Date("2026-10-27T12:00:00Z"),
      version: 2,
    });
    store.rows.push(deleted);
    const restore = createRestoreTransaction(deps);
    const as = (userId: string) => restore({ spaceId: "space-household", userId, transactionId: deleted.id });
    expect(codeOf(await as("u-luis"))).toBe("InsufficientRole");
    expect(codeOf(await as("u-sofi"))).toBe("InsufficientRole");
    expect(unwrap(await as("u-juan")).deletedAt).toBeNull();
  });

  it("keeps a member who left at their settled zero: their deleted expense stays deleted (Task 4b)", async () => {
    const { deps, store } = householdLedger();
    const withGone = anExpense("2026-10-20", 3_000_000n, {
      spaceId: "space-household",
      shares: [
        { memberId: "member-ana", amount: 1_500_000n, splitMethod: "EQUAL" },
        { memberId: "member-gone", amount: 1_500_000n, splitMethod: "EQUAL" },
      ],
      deletedAt: new Date("2026-10-27T12:00:00Z"),
      version: 2,
    });
    store.rows.push(withGone);
    const result = await createRestoreTransaction(deps)({
      spaceId: "space-household",
      userId: "u-ana",
      transactionId: withGone.id,
    });
    expect(codeOf(result)).toBe("NotASpaceMember");
  });
});
```

In `src/modules/ledger/application/archived-space.test.ts`, the file proves that `DeleteTransaction` refuses in an archived space. Read it first, then add the same case for `createRestoreTransaction`, built and called the way the delete case is, expecting `SpaceArchived`.

In `tests/acceptance/ledger.test.ts`:
- import `POST as restoreTransaction` from `@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/restore/route`;
- after the describe "edit and delete with an audit trail (HU-E4-06)", add:

```ts
describe("restore a deleted transaction (ruling P185)", () => {
  const restoreOf = (user: TestUser, id: string) =>
    onTransaction(restoreTransaction, "POST", user, id, { suffix: "/restore" });

  it("brings it back to lists and balances with the next ETag, once", async () => {
    const ana = await ledgerUser("Ana");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    expect((await onTransaction(deleteTransaction, "DELETE", ana, tx.id)).status).toBe(204);
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(2_000_000));
    const restored = await restoreOf(ana, tx.id);
    expect([restored.status, restored.headers.get("etag")]).toEqual([200, '"3"']);
    expect(((await restored.json()) as TransactionDto).amount).toEqual(cop(85_000));
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(1_915_000));
    expect((await listOf(ana, "?period=2026-10")).body.items.map((t) => t.id)).toEqual([tx.id]);
    const again = await restoreOf(ana, tx.id);
    expect([again.status, again.headers.get("etag")]).toEqual([200, '"3"']);
    expect((await auditOf(ana, tx.id)).map((e) => [e.action, e.actorUserId])).toEqual([
      ["DELETED", ana.userId],
      ["RESTORED", ana.userId],
    ]);
  });

  it("hides other users' transactions", async () => {
    const ana = await ledgerUser("Ana");
    const juan = await registerUser("Juan");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    await onTransaction(deleteTransaction, "DELETE", ana, tx.id);
    const response = await call(restoreTransaction, "POST", inSpace(ana, `transactions/${tx.id}/restore`), {
      user: juan,
      params: { spaceId: ana.spaceId, transactionId: tx.id },
    });
    expect(response.status).toBe(404);
  });
});
```

(`listOf`, `auditOf`, `onTransaction`, `recorded`, `market` and `ledgerUser` are the file's existing helpers, and `AuditDto` gains `"RESTORED"` where the file declares it.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/restore-transaction.test.ts`
Expected: FAIL. `./restore-transaction` cannot be resolved.

Run: `pnpm exec vitest run --project acceptance tests/acceptance/ledger.test.ts -t "restore a deleted transaction"`
Expected: FAIL. The restore route module does not exist.

- [ ] **Step 3: Implement**

In `src/modules/ledger/domain/transaction.ts`, after `deletionChanges`:

```ts
/** Ruling P185: undoing a deletion; the row comes back as it was deleted (D8). */
export const restore = (tx: Transaction, now: Date): Transaction => ({ ...tx, deletedAt: null, updatedAt: now });

/** Ruling P185: a restore brings every audited value back, each `from: null`, mirroring `deletionChanges`. */
export const restorationChanges = (tx: Transaction): ChangeSet => {
  const changes: Record<string, { from: null; to: string }> = {};
  for (const [key, to] of auditedValues(tx)) if (to !== null) changes[key] = { from: null, to };
  return changes;
};
```

In `src/modules/ledger/application/ports.ts`, change `readonly action: "UPDATED" | "DELETED";` to `readonly action: "UPDATED" | "DELETED" | "RESTORED";`. Make the same change to the `text("action", { enum: [...] })` list in `ledger.schema.ts` and to `AuditEntrySchema`'s `z.enum` in the contract. The column is `text`, so there is no migration, and `pnpm db:check` must report nothing to generate.

`src/modules/ledger/application/restore-transaction.ts`:

```ts
import { domainError, err, ok, type Result } from "@/shared/kernel";
import { canModify, restorationChanges, restore, type Transaction } from "../domain/transaction";
import { ensureCurrentParties, openPeriod } from "./checks";
import type { LedgerDeps } from "./deps";

export type RestoreTransaction = (input: {
  spaceId: string;
  userId: string;
  transactionId: string;
}) => Promise<Result<Transaction>>;

/**
 * Ruling P185: the undo of HU-E4-06's soft delete. The same guards as a deletion, because a restore moves the same
 * balances back; a transaction that is not deleted is answered unchanged, so a repeated undo changes nothing.
 */
export const createRestoreTransaction =
  (deps: LedgerDeps): RestoreTransaction =>
  (input) =>
    deps.tm.run(async () => {
      const membership = await deps.access(input.spaceId, input.userId);
      if (!membership.ok) return membership;
      const current = await deps.transactions.findById(membership.value.spaceId, input.transactionId, true);
      if (!current) return err(domainError("TransactionNotFound"));
      if (!canModify(membership.value.role, current.createdBy, input.userId)) {
        return err(domainError("InsufficientRole"));
      }
      if (current.deletedAt === null) return ok(current);
      const open = await openPeriod(deps, current.spaceId, current.date);
      if (!open.ok) return open;
      // HU-E1-08, HU-E1-12: a member who left keeps the zero balance they settled with (Task 4b).
      const parties = await ensureCurrentParties(deps, membership.value.spaceId, current);
      if (!parties.ok) return parties;
      const now = deps.clock.now();
      const restored = restore(current, now);
      if (!(await deps.transactions.save(restored, current.version))) {
        return err(domainError("PreconditionFailed"));
      }
      await deps.audit.append({
        id: deps.ids.next<"AuditEntry">(),
        transactionId: current.id,
        action: "RESTORED",
        actorUserId: input.userId,
        at: now,
        changes: restorationChanges(current),
      });
      return ok({ ...restored, version: current.version + 1 });
    });
```

Export it from `application/index.ts` beside `createDeleteTransaction`. In `container.ts`, wire it:
- `readonly restoreTransaction: RestoreTransaction;` in `Container["ledger"]`;
- `restoreTransaction: createRestoreTransaction(ledgerDeps),` beside `deleteTransaction`.

`src/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/restore/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { transactionDto } from "@/modules/ledger/contracts/ledger.contract";
import { etagOf } from "@/shared/http";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** Ruling P185: undo a deletion. No body and no Idempotency-Key: restoring twice changes nothing. */
export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().ledger.restoreTransaction({
      spaceId: params.spaceId!,
      userId: user!.id,
      transactionId: params.transactionId!,
    });
    return result.ok
      ? ok({
          status: 200,
          body: transactionDto(result.value),
          headers: [["etag", etagOf(result.value.version)] as const],
        })
      : result;
  },
});
```

In `ledgerPaths`, after `"/api/v1/spaces/{spaceId}/transactions/{transactionId}/audit"`:

```ts
  "/api/v1/spaces/{spaceId}/transactions/{transactionId}/restore": {
    post: {
      operationId: "restoreTransaction",
      summary: "Undo a deletion: the transaction returns to lists, balances and totals; restoring a live one changes nothing",
      ...securedByUser,
      requestParams: { path: TransactionPath },
      responses: {
        "200": { description: "The restored transaction with its new ETag", content: jsonContent(TransactionSchema) },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound, TransactionNotFound",
          "409": "PeriodClosed, SpaceArchived",
          "412": "PreconditionFailed",
          "422": "NotASpaceMember",
        }),
      },
    },
  },
```

Regenerate the snapshot (`UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts`) and the client types (`pnpm api:types`).

- [ ] **Step 4: Run the tests to verify they pass**

Run:
- `pnpm exec vitest run --project unit src/modules/ledger`
- `pnpm exec vitest run --project acceptance tests/acceptance/ledger.test.ts`
- then every gate.

Expected: PASS. `pnpm api:check` and `pnpm db:check` are clean.

Mutation checks:
- drop `if (current.deletedAt === null) return ok(current);`: the second test fails;
- drop `ensureCurrentParties`: the "member who left" test fails;
- change `canModify` to `true`: the role test fails.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ledger src/app/api/v1/spaces/[spaceId]/transactions src/composition/container.ts tests/acceptance/ledger.test.ts openapi/openapi.snapshot.json src/shared/ui/api/schema.d.ts
git commit -m "feat(ledger): restore a deleted transaction (Refs #71)"
```

Risk: item 1 (a new persisted audit value; balances move back). This commit gets its own verifier.

---

### Task A2: Edit an expense's account and payer, an income's account and a transfer's accounts

Ruling P186. `PATCH …/transactions/{transactionId}` gains four optional fields:
- `accountId`: on an EXPENSE, the requester pays everything from this account of theirs, as when recording (HU-E4-01's shorthand); on an INCOME, the receiving account;
- `payments`: who paid an EXPENSE, the same shape and rules as recording (spec 5.2, D9);
- `sourceAccountId` and `destinationAccountId`: an own TRANSFER's accounts.

The guards:
- A part a type does not have, any account of a SETTLEMENT and any account of a fund contribution answer 409 `FieldNotEditable`, with the public detail `field` (P188).
- Only the owner moves money from or into their account (D9):
  - the new account goes through `ownAccount` or `partyAccount` for the editor;
  - a changed debit of an old account still goes through `ownedDebits`;
  - an income's account changes only by its receiver;
  - an own transfer's accounts change only by its creator.
- New payments must add up to the amount, and a sole share follows the amount, as today.

The repository now writes the account columns, and the audit records an income's and a transfer's accounts (P187).

**Files:**
- Create: `src/modules/ledger/application/payments.ts`, `src/modules/ledger/application/edited-parts.ts`, `src/modules/ledger/application/edit-parts.test.ts`
- Modify: `src/modules/ledger/domain/transaction.ts` (`TransactionChanges`, `reviseTransaction`, `auditedValues`), `src/modules/ledger/application/{edit-transaction.ts, record-expense.ts}`, `src/modules/ledger/infrastructure/drizzle-transaction-repository.ts` (`save`), `src/modules/ledger/contracts/ledger.contract.ts` (`EditTransactionBodySchema`, `editChangesFromBody`, the PATCH codes), `src/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route.ts` (`PATCH`), `src/shared/http/problem.ts` (`PUBLIC_DETAILS`), `src/i18n/messages/{es,en}.json` (`errors.FieldNotEditable`), `src/modules/ledger/ui/record/record-request.ts` (`BY_CODE`), `tests/acceptance/{ledger.test.ts, shared-expenses.test.ts}`, `openapi/openapi.snapshot.json`, `src/shared/ui/api/schema.d.ts`

**Interfaces:**
- Consumes: `paymentOf` (moved, unchanged), `partyAccount`, `ownAccount`, `accountInSpace`, `changedDebits`, `ensureCurrentParties`, `Money.ofMinor`.
- Produces:
  - `resolvePayments(deps: Pick<LedgerDeps, "accounts">, space: SpaceMembership, members: readonly SpaceMember[], requested: readonly PaymentInput[], userId: string): Promise<Result<Payment[]>>` (`application/payments.ts`; `record-expense.ts` now calls it);
  - `EditChanges` gains `accountId?: string`, `payments?: readonly PaymentInput[]`, `sourceAccountId?: string` and `destinationAccountId?: string`;
  - `interface PartChanges { payments?: readonly Payment[]; shares?: readonly Share[]; sourceAccountId?: string; destinationAccountId?: string }`;
  - `editedParts(deps, space, current, changes, userId): Promise<Result<PartChanges>>`;
  - `TransactionChanges` gains `PartChanges`'s fields;
  - `editChangesFromBody(body): Result<EditChanges>` (contract);
  - the error code `FieldNotEditable` (409, public `field`).

- [ ] **Step 1: Write the failing tests**

`src/modules/ledger/application/edit-parts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import {
  ACCOUNTS,
  aSettlement,
  aTransfer,
  anExpense,
  anIncome,
  householdLedger,
  ledgerFixture,
} from "../../../../tests/support/in-memory-ledger";
import type { Expense, Income, Transfer } from "../domain/transaction";
import { createEditTransaction, type EditChanges } from "./edit-transaction";
import { createListAudit } from "./list-audit";

const asAna = { spaceId: "space-ana", userId: "u-ana" };

const personal = () => {
  const fixture = ledgerFixture();
  const market = anExpense("2026-10-31", 8_500_000n, { description: "Market" });
  const salary = anIncome("2026-10-30", 300_000_000n);
  const move = aTransfer("2026-10-29", 50_000_000n);
  fixture.store.rows.push(market, salary, move);
  const edit = createEditTransaction(fixture.deps);
  return {
    ...fixture,
    market,
    salary,
    move,
    history: createListAudit(fixture.deps),
    change: (transactionId: string, changes: EditChanges) =>
      edit({ ...asAna, transactionId, expectedVersion: null, changes }),
  };
};

const household = () => {
  const fixture = householdLedger();
  const shared = anExpense("2026-10-20", 3_000_000n, {
    spaceId: "space-household",
    shares: [
      { memberId: "member-ana", amount: 1_500_000n, splitMethod: "EQUAL" },
      { memberId: "member-juan", amount: 1_500_000n, splitMethod: "EQUAL" },
    ],
  });
  const juans = anExpense("2026-10-21", 1_000_000n, {
    spaceId: "space-household",
    createdBy: "u-juan",
    payments: [{ memberId: "member-juan", accountId: ACCOUNTS.davivienda.id, amount: 1_000_000n }],
    shares: [{ memberId: "member-juan", amount: 1_000_000n, splitMethod: "EQUAL" }],
  });
  fixture.store.rows.push(shared, juans);
  const edit = createEditTransaction(fixture.deps);
  return {
    ...fixture,
    shared,
    juans,
    change: (userId: string, transactionId: string, changes: EditChanges) =>
      edit({ spaceId: "space-household", userId, transactionId, expectedVersion: null, changes }),
  };
};

describe("EditTransaction changes accounts and who paid (ruling P186)", () => {
  it("moves a personal expense to another of Ana's accounts and audits the payment", async () => {
    const { change, history, market } = personal();
    const edited = unwrap(await change(market.id, { accountId: ACCOUNTS.nequi.id })) as Expense;
    expect(edited.payments).toEqual([{ memberId: "member-ana", accountId: "acc-nequi", amount: 8_500_000n }]);
    expect(edited.shares.map((s) => s.amount)).toEqual([8_500_000n]);
    const [entry] = unwrap(await history({ ...asAna, transactionId: market.id }));
    expect(entry!.changes).toEqual({
      payments: {
        from: '[{"memberId":"member-ana","accountId":"acc-bancolombia","amount":"8500000"}]',
        to: '[{"memberId":"member-ana","accountId":"acc-nequi","amount":"8500000"}]',
      },
    });
  });

  it("moves the account and the amount together: the sole payment and share follow both", async () => {
    const { change, market } = personal();
    const edited = unwrap(
      await change(market.id, { accountId: ACCOUNTS.nequi.id, amount: money(9_500_000n) }),
    ) as Expense;
    expect(edited.payments).toEqual([{ memberId: "member-ana", accountId: "acc-nequi", amount: 9_500_000n }]);
    expect(edited.shares.map((s) => s.amount)).toEqual([9_500_000n]);
  });

  it("moves an income to another receiving account and audits it (P187)", async () => {
    const { change, history, salary } = personal();
    const edited = unwrap(await change(salary.id, { accountId: ACCOUNTS.nequi.id })) as Income;
    expect(edited.destinationAccountId).toBe("acc-nequi");
    const [entry] = unwrap(await history({ ...asAna, transactionId: salary.id }));
    expect(entry!.changes).toEqual({ destinationAccountId: { from: "acc-bancolombia", to: "acc-nequi" } });
  });

  it("swaps an own transfer's accounts and refuses the same account on both sides", async () => {
    const { change, move } = personal();
    const swapped = unwrap(
      await change(move.id, { sourceAccountId: ACCOUNTS.nequi.id, destinationAccountId: ACCOUNTS.bancolombia.id }),
    ) as Transfer;
    expect([swapped.sourceAccountId, swapped.destinationAccountId]).toEqual(["acc-nequi", "acc-bancolombia"]);
    expect(codeOf(await change(move.id, { destinationAccountId: ACCOUNTS.nequi.id }))).toBe("SameAccountTransfer");
  });

  it("refuses another person's account and an archived one (D9)", async () => {
    const { change, market, salary } = personal();
    expect(codeOf(await change(market.id, { accountId: ACCOUNTS.davivienda.id }))).toBe("AccountNotOwned");
    expect(codeOf(await change(market.id, { accountId: ACCOUNTS.oldNequi.id }))).toBe("AccountArchived");
    expect(codeOf(await change(salary.id, { accountId: ACCOUNTS.davivienda.id }))).toBe("AccountNotOwned");
  });

  it("refuses parts a type does not have, and the accounts of settlements and fund contributions (P188)", async () => {
    const { change, salary, move, store } = personal();
    const settlement = aSettlement("2026-10-28", 1_000_000n, { spaceId: "space-ana" });
    const contribution = aTransfer("2026-10-28", 1_000_000n, { payerMemberId: "member-ana" });
    store.rows.push(settlement, contribution);
    const payments = [{ memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: money(300_000_000n) }];
    for (const [id, changes, field] of [
      [salary.id, { payments }, "payments"],
      [salary.id, { sourceAccountId: ACCOUNTS.nequi.id }, "sourceAccountId"],
      [move.id, { accountId: ACCOUNTS.nequi.id }, "accountId"],
      [settlement.id, { sourceAccountId: ACCOUNTS.bancolombia.id }, "sourceAccountId"],
      [contribution.id, { sourceAccountId: ACCOUNTS.nequi.id }, "sourceAccountId"],
    ] as const) {
      const result = await change(id, changes);
      expect(result.ok ? null : [result.error.code, result.error.details?.field]).toEqual(["FieldNotEditable", field]);
    }
  });

  it("changes who paid a shared expense: the recorder, a guest or the fund; never another member's account", async () => {
    const { change, shared } = household();
    const amount = money(3_000_000n);
    const guest = unwrap(
      await change("u-ana", shared.id, { payments: [{ memberId: "member-pedro", accountId: null, amount }] }),
    ) as Expense;
    expect(guest.payments).toEqual([{ memberId: "member-pedro", accountId: null, amount: 3_000_000n }]);
    const fund = unwrap(
      await change("u-ana", shared.id, {
        payments: [{ memberId: null, accountId: ACCOUNTS.householdFund.id, amount }],
      }),
    ) as Expense;
    expect(fund.payments).toEqual([{ memberId: null, accountId: "acc-household-fund", amount: 3_000_000n }]);
    expect(
      codeOf(
        await change("u-ana", shared.id, {
          payments: [{ memberId: "member-juan", accountId: ACCOUNTS.davivienda.id, amount }],
        }),
      ),
    ).toBe("AccountNotOwned");
    expect(
      codeOf(
        await change("u-ana", shared.id, {
          payments: [{ memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: money(2_000_000n) }],
        }),
      ),
    ).toBe("SharesDoNotMatchAmount");
  });

  it("keeps an OWNER from moving a member's expense to the OWNER's own account (D9)", async () => {
    const { change, juans } = household();
    expect(codeOf(await change("u-ana", juans.id, { accountId: ACCOUNTS.bancolombia.id }))).toBe("AccountNotOwned");
  });
});
```

In `tests/acceptance/ledger.test.ts`, inside "edit and delete with an audit trail (HU-E4-06)", add:

```ts
  it("moves an expense and an income to Nequi; both balances follow (ruling P186)", async () => {
    const ana = await ledgerUser("Ana");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    const salary = await recorded(
      post(recordIncome, ana, "incomes", {
        amount: cop(500_000),
        date: "2026-10-05",
        categoryId: ana.salary,
        accountId: ana.bancolombia,
      }),
    );
    const moved = await onTransaction(editTransaction, "PATCH", ana, tx.id, {
      body: { accountId: ana.nequi },
      ifMatch: '"1"',
    });
    expect([moved.status, moved.headers.get("etag")]).toEqual([200, '"2"']);
    expect(((await moved.json()) as TransactionDto).payments.map((p) => p.accountId)).toEqual([ana.nequi]);
    expect(
      (await onTransaction(editTransaction, "PATCH", ana, salary.id, { body: { accountId: ana.nequi } })).status,
    ).toBe(200);
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(2_000_000));
    expect(await balanceOf(ana, ana.nequi)).toEqual(cop(415_000));
  });

  it("refuses accountId together with payments, and a part the type does not have", async () => {
    const ana = await ledgerUser("Ana");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    const both = await onTransaction(editTransaction, "PATCH", ana, tx.id, {
      body: { accountId: ana.nequi, payments: [] },
    });
    expect((await both.json()).code).toBe("ValidationFailed");
    const wrong = await onTransaction(editTransaction, "PATCH", ana, tx.id, {
      body: { sourceAccountId: ana.nequi },
    });
    expect([wrong.status, (await wrong.json()).code]).toEqual([409, "FieldNotEditable"]);
  });
```

In `tests/acceptance/shared-expenses.test.ts`, add:

```ts
describe("change who paid an expense (ruling P186)", () => {
  it("hands the payment to the guest Pedro: Ana's account gets the money back", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    const tx = await recordedBy(
      h.ana,
      paidBy(h, h.ana, 300_000, { split: equal(h.ana.memberId, h.juan.memberId) }),
    );
    const path = `/api/v1/spaces/${h.spaceId}/transactions/${tx.id}`;
    const params = { spaceId: h.spaceId, transactionId: tx.id };
    const response = await call(editTransaction, "PATCH", path, {
      user: h.ana,
      params,
      body: { payments: [{ memberId: pedro, accountId: null, amount: cop(300_000) }] },
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as TransactionDto).payments).toEqual([
      { memberId: pedro, accountId: null, amount: cop(300_000) },
    ]);
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(cop(2_000_000));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/edit-parts.test.ts`
Expected: FAIL. `edited.payments` still holds `acc-bancolombia` (`accountId` is not an `EditChanges` field yet, and TypeScript reports it).

Run: `pnpm exec vitest run --project acceptance tests/acceptance/ledger.test.ts -t "ruling P186"`
Expected: FAIL. The body strips `accountId`, so the payment keeps Bancolombia.

- [ ] **Step 3: Implement**

1. `src/modules/ledger/application/payments.ts`: move `paymentOf` out of `record-expense.ts` unchanged. Move with it the duplicate-payer check, as:

```ts
/** Spec 5.2, D9: each requested payment resolved; each member pays at most once (fund payments are MixedFundPayment's). */
export const resolvePayments = async (
  deps: Pick<LedgerDeps, "accounts">,
  space: SpaceMembership,
  members: readonly SpaceMember[],
  requested: readonly PaymentInput[],
  userId: string,
): Promise<Result<Payment[]>> => {
  const payers = requested.flatMap((payment) => (payment.memberId === null ? [] : [payment.memberId]));
  if (new Set(payers).size !== payers.length) return err(domainError("InvalidSplit", { reason: "duplicatePayer" }));
  const payments: Payment[] = [];
  for (const payment of requested) {
    const resolved = await paymentOf(deps, space, members, payment, userId);
    if (!resolved.ok) return resolved;
    payments.push(resolved.value);
  }
  return ok(payments);
};
```

   `PaymentInput` moves there too. `record-expense.ts` re-exports it (`export type { PaymentInput } from "./payments"`), so existing imports keep compiling. `createRecordExpense` replaces its inline loop with `resolvePayments`: same order of checks, same errors. The existing `record-expense` tests are the proof that nothing changed.

2. In `domain/transaction.ts`, add to `TransactionChanges`: `payments?: readonly Payment[]`, `shares?: readonly Share[]`, `sourceAccountId?: string` and `destinationAccountId?: string`. In `reviseTransaction`:
   - `EXPENSE`:
     - `payments = changes.payments ?? (tx.payments.length === 1 ? [{ ...tx.payments[0]!, amount: amount.value }] : tx.payments)`;
     - `shares = changes.shares ?? (tx.shares.length === 1 ? [{ ...tx.shares[0]!, amount: amount.value }] : tx.shares)`;
     - then `checkParts`, as today.
   - `INCOME`: `destinationAccountId: changes.destinationAccountId ?? tx.destinationAccountId`.
   - `TRANSFER`:
     - `const source = changes.sourceAccountId ?? tx.sourceAccountId; const destination = changes.destinationAccountId ?? tx.destinationAccountId;`
     - `if (source === destination) return err(domainError("SameAccountTransfer"));`
     - keep the category refusal first.
   - `SETTLEMENT`: unchanged (the use case refuses its accounts before).

   In `auditedValues`, after the `EXPENSE` block, add:

```ts
  // Ruling P187: an income's, a transfer's and a settlement's accounts, so an edit of them is traceable.
  if (tx.type !== "EXPENSE") {
    values.set("sourceAccountId", tx.type === "INCOME" ? null : tx.sourceAccountId);
    values.set("destinationAccountId", tx.destinationAccountId);
  }
```

   Existing output changes in one place only: a deletion's or a restoration's audit of an INCOME, TRANSFER or SETTLEMENT now also lists its non-null accounts. If an existing test pins the whole `changes` of such a deletion, extend its expectation with those keys; that is the only change of existing output this task makes (P187).

3. `application/edited-parts.ts`:

```ts
import type { SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, flatMap, map, Money, ok, type Result } from "@/shared/kernel";
import type { Payment, Share, Transaction } from "../domain/transaction";
import { accountInSpace, ownAccount } from "./checks";
import type { LedgerDeps } from "./deps";
import type { EditChanges } from "./edit-transaction";
import { resolvePayments } from "./payments";

export interface PartChanges {
  readonly payments?: readonly Payment[];
  readonly shares?: readonly Share[];
  readonly sourceAccountId?: string;
  readonly destinationAccountId?: string;
}

type PartField = "accountId" | "payments" | "sourceAccountId" | "destinationAccountId";
const notEditable = (field: PartField): Result<never> => err(domainError("FieldNotEditable", { field }));
/** The first part of `fields` the request sends, if any. */
const sent = (changes: EditChanges, fields: readonly PartField[]): PartField | undefined =>
  fields.find((field) => changes[field] !== undefined);

/**
 * Ruling P186: the money parts an edit replaces, checked as when recording (spec 5.2, D9): a new account is the
 * editor's own; an income moves only by its receiver and an own transfer only by its creator; settlements and fund
 * contributions keep their accounts (P188). The old accounts' changed debits are `ownedDebits`' job.
 */
export const editedParts = async (
  deps: Pick<LedgerDeps, "accounts" | "members">,
  space: SpaceMembership,
  current: Transaction,
  changes: EditChanges,
  userId: string,
): Promise<Result<PartChanges>> => {
  switch (current.type) {
    case "EXPENSE": {
      const wrong = sent(changes, ["sourceAccountId", "destinationAccountId"]);
      if (wrong) return notEditable(wrong);
      if (changes.accountId === undefined && changes.payments === undefined) return ok({});
      // The edited amount, else the current one: the shorthand payment pays all of it (HU-E4-01).
      const whole = changes.amount === undefined ? Money.ofMinor(current.amount, current.currency) : ok(changes.amount);
      if (!whole.ok) return whole;
      const requested = changes.payments ?? [{ memberId: space.memberId, accountId: changes.accountId!, amount: whole.value }];
      const members = await deps.members.listCurrent(space.spaceId);
      return map(await resolvePayments(deps, space, members, requested, userId), (payments) => ({ payments }));
    }
    case "INCOME": {
      const wrong = sent(changes, ["payments", "sourceAccountId", "destinationAccountId"]);
      if (wrong) return notEditable(wrong);
      if (changes.accountId === undefined) return ok({});
      if (current.receivingMemberId !== space.memberId) return err(domainError("AccountNotOwned"));
      const account = flatMap(await ownAccount(deps, changes.accountId, userId), (a) => accountInSpace(a, space.spaceId));
      return map(account, (a) => ({ destinationAccountId: a.id }));
    }
    case "TRANSFER":
    case "SETTLEMENT": {
      const wrong = sent(changes, ["accountId", "payments"]);
      if (wrong) return notEditable(wrong);
      const moving = sent(changes, ["sourceAccountId", "destinationAccountId"]);
      if (!moving) return ok({});
      // P188: a settlement's and a fund contribution's accounts belong to their parties; delete and record again.
      if (current.type === "SETTLEMENT" || current.payerMemberId !== null) return notEditable(moving);
      if (current.createdBy !== userId) return err(domainError("AccountNotOwned"));
      const parts: { sourceAccountId?: string; destinationAccountId?: string } = {};
      for (const field of ["sourceAccountId", "destinationAccountId"] as const) {
        const id = changes[field];
        if (id === undefined) continue;
        const account = flatMap(await ownAccount(deps, id, userId), (a) => accountInSpace(a, space.spaceId));
        if (!account.ok) return account;
        parts[field] = account.value.id;
      }
      return ok(parts);
    }
  }
};
```

   `Money.ofMinor` returns a `Result` (as `tests/support/fakes.ts` shows); `Money` and `ok` come from `@/shared/kernel`.

4. `edit-transaction.ts`. Add the four fields to `EditChanges` with their doc comments (as in Interfaces). After the time is computed:

```ts
      const parts = await editedParts(deps, membership.value, current, input.changes, input.userId);
      if (!parts.ok) return parts;
```

   Then:
   - destructure the part fields out of `rest` (`const { accountId: _a, payments: _p, sourceAccountId: _s, destinationAccountId: _d, ...rest } = …`), so only the domain fields reach `reviseTransaction`;
   - pass `...parts.value` to `reviseTransaction`;
   - run `ensureCurrentParties` when `changes.amount || changes.payments || changes.shares`, so a member who left keeps their zero.

   `ownedDebits(changedDebits(current, revised.value))` stays as it is. It now also catches an old account left by a changed payment.

5. `drizzle-transaction-repository.ts` `save`: add `sourceAccountId` and `destinationAccountId` to the `set`, read from `transactionRow(transaction)`, the row builder `add` already uses:

```ts
    const row = transactionRow(transaction);
    // P186: an edit may move an income's or a transfer's accounts; an expense keeps both null (transactions_shape).
    …set({ …, sourceAccountId: row.sourceAccountId, destinationAccountId: row.destinationAccountId, … })
```

6. Contract. `EditTransactionBodySchema`:

```ts
/**
 * HU-E4-06, ruling P186: every field optional; an expense takes `accountId` (the requester pays it all from that
 * account) or `payments`, an income `accountId`, an own transfer `sourceAccountId` and `destinationAccountId`.
 */
export const EditTransactionBodySchema = z
  .object({
    description: Description,
    date: z.iso.date().optional(),
    occurredAt: Instant.nullable().optional(),
    timeZone: TimeZoneName.optional(),
    categoryId: Id.optional(),
    amount: MoneySchema.optional(),
    accountId: Id.optional(),
    payments: z.array(PaymentBodySchema).max(MAX_PARTS).optional(),
    sourceAccountId: Id.optional(),
    destinationAccountId: Id.optional(),
  })
  .refine((body) => body.accountId === undefined || body.payments === undefined, {
    error: "Send accountId or payments, not both",
    path: ["payments"],
  });

/** A validated edit body as EditTransaction's changes; fails only for currencies the kernel does not know. */
export const editChangesFromBody = (body: z.infer<typeof EditTransactionBodySchema>): Result<EditChanges> => {
  const amount = body.amount === undefined ? ok(undefined) : moneyFromDto(body.amount);
  if (!amount.ok) return amount;
  const when = whenFromBody(body);
  if (!when.ok) return when;
  let payments: PaymentInput[] | undefined;
  if (body.payments !== undefined) {
    payments = [];
    for (const payment of body.payments) {
      const paid = moneyFromDto(payment.amount);
      if (!paid.ok) return paid;
      payments.push({ memberId: payment.memberId, accountId: payment.accountId ?? null, amount: paid.value });
    }
  }
  return ok({
    description: body.description,
    ...when.value,
    categoryId: body.categoryId,
    amount: amount.value,
    accountId: body.accountId,
    payments,
    sourceAccountId: body.sourceAccountId,
    destinationAccountId: body.destinationAccountId,
  });
};
```

   The `PATCH` route replaces its inline mapping with `editChangesFromBody(body)`: a failure is returned as is, a success becomes `changes`. The PATCH path's summary becomes "Change description, date, time, category, amount, accounts or who paid; send If-Match with the current ETag". Its problems become:
   - `404`: "SpaceNotFound, TransactionNotFound, CategoryNotFound, AccountNotFound";
   - `409`: "SharesDoNotMatchAmount, CategoryArchived, PeriodClosed, SpaceArchived, TransferHasNoCategory, SettlementHasNoCategory, AccountArchived, SameAccountTransfer, GuestHasNoAccounts, MixedFundPayment, FieldNotEditable";
   - `422`: "ValidationFailed, InvalidAmount, InvalidDate, InvalidDescription, CurrencyMismatch, UnknownCurrency, AccountNotOwned, AccountNotInSpace, AccountRequired, PaymentsRequired, InvalidSplit, InvalidFundAccount, NotASpaceMember, DateTimeMismatch, TimeRequired, InvalidTimeZone".

7. `src/shared/http/problem.ts`: add `["FieldNotEditable", ["field"]],` to `PUBLIC_DETAILS`, with the comment `// Ruling P188: which part of the body the transaction's type keeps.` The status is the default 409.

8. Catalogs, `errors.FieldNotEditable`:
   - es: "Este dato no se puede cambiar en este tipo de movimiento."
   - en: "This detail cannot be changed for this kind of transaction."

9. `record-request.ts` `BY_CODE`: add `AccountArchived`, which already maps to `"account"`. Add nothing for `FieldNotEditable`: it is shown above the button.

Regenerate the snapshot and the types.

- [ ] **Step 4: Run the tests to verify they pass**

Run:
- `pnpm exec vitest run --project unit src/modules/ledger src/shared/http`
- `pnpm exec vitest run --project acceptance tests/acceptance/ledger.test.ts tests/acceptance/shared-expenses.test.ts`
- every gate.

Expected: PASS.

Mutation checks:
- drop `if (current.receivingMemberId !== space.memberId)`: the D9 income test still passes (the account is Juan's) but the guard stays required. Add `it("refuses an ADMIN moving another member's income")` with Juan's income in Household and Ana editing it, if no test fails without the line;
- drop `current.createdBy !== userId`: write the same kind of test for an own transfer if needed;
- drop `ensureCurrentParties` on payments: add a case with a share of `member-gone` whose payer changes, expecting `NotASpaceMember`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ledger src/app/api/v1/spaces/[spaceId]/transactions src/shared/http/problem.ts src/i18n/messages tests/acceptance openapi/openapi.snapshot.json src/shared/ui/api/schema.d.ts
git commit -m "feat(ledger): change an edited transaction's accounts and who paid (Refs #71, Refs #74)"
```

Risk: items 1 and 2 (stored money parts change; the D9 guard on accounts). This commit gets its own verifier.

---

### Task A3: Edit how an expense is split

Ruling P186, the split. `PATCH` takes `split`, the record body's `SplitBodySchema`: EQUAL, PERCENT, EXACT or SHARES. The shares are recomputed with `splitShares` on the edited amount (or the current one), among the space's **current** members, so a member who left cannot be given a share (`NotASpaceMember`). `split` on any type but EXPENSE is `FieldNotEditable` (this task adds `"split"` to `PartField` and to the INCOME and TRANSFER/SETTLEMENT lists of Task A2's switch). A changed amount on an expense with several shares and no `split` still answers `SharesDoNotMatchAmount` (HU-E4-06's scenario is unchanged): the UI sends the split whenever the amount changes (P192).

**Files:**
- Modify: `src/modules/ledger/application/{edited-parts.ts, edit-transaction.ts, edit-parts.test.ts}`, `src/modules/ledger/contracts/ledger.contract.ts` (`split` in the edit body; `splitFromBody` exported), `tests/acceptance/shared-expenses.test.ts`, `openapi/openapi.snapshot.json`, `src/shared/ui/api/schema.d.ts`

**Interfaces:**
- Consumes: `splitShares`, `SplitInput`, `splitFromBody`, `editedParts`.
- Produces: `EditChanges.split?: SplitInput`; `PartChanges.shares` filled from it.

- [ ] **Step 1: Write the failing tests**

Append to `src/modules/ledger/application/edit-parts.test.ts`:

```ts
describe("EditTransaction changes how an expense is split (ruling P186)", () => {
  const equal = (...memberIds: string[]) => ({ method: "EQUAL" as const, participants: memberIds.map((memberId) => ({ memberId })) });

  it("recomputes EQUAL shares on a new amount", async () => {
    const { change, shared } = household();
    const edited = unwrap(
      await change("u-ana", shared.id, { amount: money(4_000_000n), split: equal("member-ana", "member-juan") }),
    ) as Expense;
    expect(edited.payments.map((p) => p.amount)).toEqual([4_000_000n]);
    expect(edited.shares.map((s) => [s.memberId, s.amount, s.splitMethod])).toEqual([
      ["member-ana", 2_000_000n, "EQUAL"],
      ["member-juan", 2_000_000n, "EQUAL"],
    ]);
  });

  it("splits by percentage on the current amount when only the split changes", async () => {
    const { change, shared } = household();
    const edited = unwrap(
      await change("u-ana", shared.id, {
        split: {
          method: "PERCENT",
          participants: [
            { memberId: "member-ana", basisPoints: 4_000 },
            { memberId: "member-juan", basisPoints: 6_000 },
          ],
        },
      }),
    ) as Expense;
    expect(edited.shares.map((s) => s.amount)).toEqual([1_200_000n, 1_800_000n]);
  });

  it("still refuses a new amount without a split when there are several shares (HU-E4-06)", async () => {
    const { change, shared } = household();
    expect(codeOf(await change("u-ana", shared.id, { amount: money(4_000_000n) }))).toBe("SharesDoNotMatchAmount");
  });

  it("gives no share to someone who is not a current member, and refuses a split on an income", async () => {
    const { change, shared } = household();
    expect(codeOf(await change("u-ana", shared.id, { split: equal("member-ana", "member-gone") }))).toBe(
      "NotASpaceMember",
    );
    const { change: personalChange, salary } = personal();
    const result = await personalChange(salary.id, { split: equal("member-ana") });
    expect(result.ok ? null : [result.error.code, result.error.details?.field]).toEqual(["FieldNotEditable", "split"]);
  });
});
```

In `tests/acceptance/shared-expenses.test.ts`, append to "change who paid an expense (ruling P186)":

```ts
  it("changes the amount and the split together: 400,000 EQUAL gives 200,000 each", async () => {
    const h = await household();
    const tx = await recordedBy(h.ana, paidBy(h, h.ana, 300_000, { split: equal(h.ana.memberId, h.juan.memberId) }));
    const response = await call(editTransaction, "PATCH", `/api/v1/spaces/${h.spaceId}/transactions/${tx.id}`, {
      user: h.ana,
      params: { spaceId: h.spaceId, transactionId: tx.id },
      headers: { "if-match": '"1"' },
      body: { amount: cop(400_000), split: equal(h.ana.memberId, h.juan.memberId) },
    });
    expect(response.status).toBe(200);
    expect(sharesOf((await response.json()) as TransactionDto)).toEqual([
      [h.ana.memberId, cop(200_000), "EQUAL"],
      [h.juan.memberId, cop(200_000), "EQUAL"],
    ]);
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(cop(1_600_000));
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/edit-parts.test.ts -t "split"`
Expected: FAIL. `split` is not an `EditChanges` field, and the shares keep 1,500,000 each.

- [ ] **Step 3: Implement**

- `edit-transaction.ts`: `EditChanges` gains `readonly split?: SplitInput;` (doc: "Ruling P186: how an expense is split, recomputed on the edited amount among the current members.").
- `edited-parts.ts`: add `"split"` to `PartField`, to the INCOME `sent` list and to the TRANSFER/SETTLEMENT `wrong` list. Rewrite the `EXPENSE` case as:

```ts
    case "EXPENSE": {
      const wrong = sent(changes, ["sourceAccountId", "destinationAccountId"]);
      if (wrong) return notEditable(wrong);
      if (changes.accountId === undefined && changes.payments === undefined && changes.split === undefined) return ok({});
      const whole = changes.amount === undefined ? Money.ofMinor(current.amount, current.currency) : ok(changes.amount);
      if (!whole.ok) return whole;
      const members = await deps.members.listCurrent(space.spaceId);
      let shares: Share[] | undefined;
      if (changes.split !== undefined) {
        // P186: among the current members only, so a member who left is never given a share (NotASpaceMember).
        const split = splitShares(whole.value, changes.split, members.map((m) => m.id));
        if (!split.ok) return split;
        shares = split.value;
      }
      let payments: Payment[] | undefined;
      if (changes.accountId !== undefined || changes.payments !== undefined) {
        const requested = changes.payments ?? [
          { memberId: space.memberId, accountId: changes.accountId!, amount: whole.value },
        ];
        const resolved = await resolvePayments(deps, space, members, requested, userId);
        if (!resolved.ok) return resolved;
        payments = resolved.value;
      }
      return ok({ ...(shares ? { shares } : {}), ...(payments ? { payments } : {}) });
    }
```

  Import `splitShares` from `../domain/split`.
- Contract: export `splitFromBody`. `EditTransactionBodySchema` gains `split: SplitBodySchema.optional(),`, and `editChangesFromBody` maps it (`const split = splitFromBody(body.split); if (!split.ok) return split;` then `split: split.value`).
- The PATCH summary becomes "Change description, date, time, category, amount, accounts, who paid or how it is split; send If-Match with the current ETag". Add `ParticipantsRequired` to its 422 list.

Regenerate the snapshot and the types.

- [ ] **Step 4: Run the tests to verify they pass**

Run:
- `pnpm exec vitest run --project unit src/modules/ledger`
- `pnpm exec vitest run --project acceptance tests/acceptance/shared-expenses.test.ts`
- every gate.

Expected: PASS.

Mutation checks:
- pass `[]` instead of the current members' ids: the `NotASpaceMember` test fails;
- use `current.amount` instead of the edited one: the 400,000 test fails.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ledger tests/acceptance/shared-expenses.test.ts openapi/openapi.snapshot.json src/shared/ui/api/schema.d.ts
git commit -m "feat(ledger): change how an edited expense is split (Refs #74)"
```

Risk: item 1 (stored shares change). This commit gets its own verifier.

---

### Task A4: One toast for every save

Ruling P195 and P196. `src/shared/ui/molecules/toast.tsx` holds `ToastProvider`, `useToast`, `TOAST_MS` and `TOAST_ACTION_MS`.

The provider, as the layout mounts it:
- It renders a landmark `section` labelled `toast.region`, fixed above the bottom navigation and the safe area.
- The section holds two live regions that exist before any message: `role="status"` (polite) and `role="alert"` (assertive).
- A toast is a card inside one of them. It holds the message, an optional action button and a close button.
- One toast at a time; a new one replaces the current one.

The toast's behaviour:
- It hides after `TOAST_MS` (5 s), or after `TOAST_ACTION_MS` (8 s) with an action.
- The timer pauses while the pointer is on it or focus is inside it.
- Escape and the close button dismiss it, and F8 focuses it.
- The action runs once and closes the toast.

Outside a provider, `useToast().show` does nothing, so every existing component test renders unchanged. The provider is mounted once in a new `src/app/(web)/(app)/layout.tsx`, above every `[spaceId]` layout, so a toast survives the navigation that follows a save, even into another space (the split with someone).

The forms announce their saves:
- `RecordForm`: `ledger.toast.saved.<EXPENSE|INCOME|TRANSFER>`, and for a split with someone `ledger.toast.saved.EXPENSE`. No toast when the answer carries `FundBalanceNegative`, because the saved-with-warning notice speaks then (P170).
- M6b's `SettleUpSheet`: `balances.toast.settled`.

**Files:**
- Create: `src/shared/ui/molecules/toast.tsx`, `src/shared/ui/molecules/toast.test.tsx`, `src/app/(web)/(app)/layout.tsx`, `src/modules/ledger/ui/record/record-form-toast.test.tsx`
- Modify: `src/shared/ui/index.ts`, `src/modules/ledger/ui/record/record-form.tsx`, `src/modules/balances/ui/settle-up-sheet.tsx`, `src/modules/balances/ui/settle-up.test.tsx`, `src/i18n/messages/{es,en}.json`

**Interfaces:**
- Consumes: `Button`, `Icon`, `VisuallyHidden`; M6b Task 19's `SettleUpSheet` (its 201 branch: `renew()`, `onOpenChange(false)`, `router.refresh()`).
- Produces:
  - `interface ToastInput { message: string; tone?: "status" | "alert"; action?: { label: string; onAction: () => void } }`;
  - `useToast(): { show(toast: ToastInput): void; dismiss(): void }`;
  - `ToastProvider({ children })`;
  - `TOAST_MS = 5000`, `TOAST_ACTION_MS = 8000`;
  - all exported from `@/shared/ui`.

Catalog keys:

| Key | es | en |
|---|---|---|
| `toast.region` | Notificaciones (F8) | Notifications (F8) |
| `toast.dismiss` | Cerrar aviso | Dismiss |
| `ledger.toast.saved.EXPENSE` | Gasto guardado | Expense saved |
| `ledger.toast.saved.INCOME` | Ingreso guardado | Income saved |
| `ledger.toast.saved.TRANSFER` | Transferencia guardada | Transfer saved |
| `balances.toast.settled` | Pago registrado | Payment recorded |

- [ ] **Step 1: Write the failing tests**

`src/shared/ui/molecules/toast.test.tsx`:

```tsx
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { TOAST_ACTION_MS, TOAST_MS, ToastProvider, useToast, type ToastInput } from "./toast";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function Trigger({ toast, label = "Mostrar" }: { readonly toast: ToastInput; readonly label?: string }) {
  const { show } = useToast();
  return <button onClick={() => show(toast)}>{label}</button>;
}
const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
const withProvider = (toast: ToastInput) =>
  renderWithIntl(
    <ToastProvider>
      <Trigger toast={toast} />
    </ToastProvider>,
  );

describe("Toast (ruling P195)", () => {
  it("speaks a success in a status region that existed before the message (WCAG 4.1.3)", async () => {
    const { container } = withProvider({ message: "Gasto guardado" });
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    expect(screen.getByRole("region", { name: "Notificaciones (F8)" })).toContainElement(status);
    await user().click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByRole("status")).toHaveTextContent("Gasto guardado");
    expect(screen.getByRole("button", { name: "Mostrar" })).toHaveFocus();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("puts a failure in the alert region", async () => {
    withProvider({ message: "No se pudo deshacer", tone: "alert" });
    await user().click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo deshacer");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("hides a plain message after 5 s and one with an action after 8 s", async () => {
    const { unmount } = withProvider({ message: "Gasto guardado" });
    await user().click(screen.getByRole("button", { name: "Mostrar" }));
    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(screen.getByRole("status")).toHaveTextContent("Gasto guardado");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    unmount();
    withProvider({ message: "Gasto eliminado", action: { label: "Deshacer", onAction: () => {} } });
    await user().click(screen.getByRole("button", { name: "Mostrar" }));
    act(() => vi.advanceTimersByTime(TOAST_ACTION_MS - 1));
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument();
  });

  it("pauses while the pointer is on it or focus is inside it (WCAG 2.2.1)", async () => {
    withProvider({ message: "Gasto eliminado", action: { label: "Deshacer", onAction: () => {} } });
    const u = user();
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    await u.hover(screen.getByTestId("toast"));
    act(() => vi.advanceTimersByTime(TOAST_ACTION_MS * 3));
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
    await u.unhover(screen.getByTestId("toast"));
    act(() => vi.advanceTimersByTime(TOAST_ACTION_MS));
    expect(screen.queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument();
  });

  it("runs the action once and closes; Escape, the close button and F8 work from the keyboard", async () => {
    const onAction = vi.fn();
    withProvider({ message: "Gasto eliminado", action: { label: "Deshacer", onAction } });
    const u = user();
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    await u.keyboard("{F8}");
    expect(screen.getByTestId("toast")).toHaveFocus();
    await u.dblClick(screen.getByRole("button", { name: "Deshacer" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    await u.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await u.click(screen.getByRole("button", { name: "Mostrar" }));
    await u.keyboard("{F8}{Escape}");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("replaces the current toast with a new one", async () => {
    renderWithIntl(
      <ToastProvider>
        <Trigger toast={{ message: "Gasto guardado" }} label="Uno" />
        <Trigger toast={{ message: "Cambios guardados" }} label="Dos" />
      </ToastProvider>,
    );
    const u = user();
    await u.click(screen.getByRole("button", { name: "Uno" }));
    await u.click(screen.getByRole("button", { name: "Dos" }));
    expect(screen.getByRole("status")).toHaveTextContent("Cambios guardados");
    expect(screen.getByRole("status")).not.toHaveTextContent("Gasto guardado");
  });

  it("sits above the bottom navigation and the safe area, under the sheets", () => {
    withProvider({ message: "x" });
    const region = screen.getByRole("region", { name: "Notificaciones (F8)" });
    expect(region).toHaveClass("fixed", "z-40", "bottom-[calc(76px+env(safe-area-inset-bottom)+0.5rem)]", "lg:bottom-4");
  });

  it("does nothing outside a provider, so screens without one render as before", async () => {
    renderWithIntl(<Trigger toast={{ message: "Gasto guardado" }} />);
    await user().click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
```

`src/modules/ledger/ui/record/record-form-toast.test.tsx`: copy `record-form.test.tsx`'s router mock, fixtures (`groups`, `accounts`), its fake-time setup and the `enterMarket` helper, and render the form inside `ToastProvider`:

```tsx
describe("record form save feedback (ruling P196)", () => {
  it("announces Gasto guardado after a save", async () => {
    const { api } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": () => jsonResponse({ ...transactionDto({ id: "t-new" }), warnings: [] }, 201) });
    renderInProvider(api);
    await enterMarket();
    await userEvent.click(screen.getByRole("button", { name: "Usar Groceries" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Gasto guardado"));
    expect(router.push).toHaveBeenCalledWith("/spaces/s-personal/transactions");
  });

  it("announces Ingreso guardado and Transferencia guardada on their endpoints", async () => { /* INCOME: tab Ingreso, amount, category, "Cuenta que recibe" → Bancolombia; TRANSFER: tab Transferencia, Desde Bancolombia, Hacia Visa; each ends with the status text */ });

  it("stays silent when the saved-with-warning notice speaks (P170)", async () => {
    // A shared form whose 201 carries { code: "FundBalanceNegative", accountId: "a-fund", balance: … }; status stays empty, router.push gets the notice URL.
  });
});
```

Write the two elided bodies in full, following the visible test and `record-form.test.tsx`'s income and shared cases. The planner leaves no assertion open:
- INCOME's status text is "Ingreso guardado", and TRANSFER's is "Transferencia guardada";
- in the warning case, `screen.getByRole("status")` is empty after `router.push` was called with `/spaces/<id>/transactions?notice=FundBalanceNegative&account=a-fund`.

The space id is whatever `spaceDto()` gives; read it from `spaceDto().id`.

In `src/modules/balances/ui/settle-up.test.tsx` (M6b Task 19), add one test: render the balances screen in `ToastProvider`, record a payment (the file's existing "records a partial payment" flow) and expect `screen.getByRole("status")` to have "Pago registrado".

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project ui src/shared/ui/molecules/toast.test.tsx src/modules/ledger/ui/record/record-form-toast.test.tsx`
Expected: FAIL. `./toast` cannot be resolved.

- [ ] **Step 3: Implement**

`src/shared/ui/molecules/toast.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "../atoms/button";
import { Icon } from "../atoms/icon";
import { VisuallyHidden } from "../atoms/visually-hidden";

export const TOAST_MS = 5_000;
/** A toast with an action stays longer (UX checklist 28): 8 s, paused while hovered or focused. */
export const TOAST_ACTION_MS = 8_000;

export interface ToastInput {
  readonly message: string;
  /** "alert" only for a failure (WCAG 4.1.3); a success is a status. */
  readonly tone?: "status" | "alert";
  readonly action?: { readonly label: string; readonly onAction: () => void };
}

interface ToastApi {
  readonly show: (toast: ToastInput) => void;
  readonly dismiss: () => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {}, dismiss: () => {} });

/** Ruling P195: the toasts of the signed-in screens; outside a provider, showing one does nothing. */
export const useToast = (): ToastApi => useContext(ToastContext);

/**
 * Ruling P195: one toast at a time, inside live regions that exist before any message, so a screen reader speaks it
 * without focus moving. It sits above the bottom navigation and the safe area and under the sheets (z-50).
 */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const t = useTranslations("toast");
  const [toast, setToast] = useState<(ToastInput & { readonly id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const remaining = useRef(0);
  const startedAt = useRef(0);
  const paused = useRef(false);
  const card = useRef<HTMLDivElement>(null);
  const count = useRef(0);

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);
  const start = useCallback((ms: number) => {
    clearTimeout(timer.current);
    remaining.current = ms;
    startedAt.current = Date.now();
    timer.current = setTimeout(() => setToast(null), ms);
  }, []);
  const show = useCallback(
    (input: ToastInput) => {
      count.current += 1;
      paused.current = false;
      setToast({ ...input, id: count.current });
      start(input.action ? TOAST_ACTION_MS : TOAST_MS);
    },
    [start],
  );
  const pause = () => {
    if (paused.current) return;
    paused.current = true;
    clearTimeout(timer.current);
    remaining.current -= Date.now() - startedAt.current;
  };
  const resume = () => {
    if (!paused.current) return;
    paused.current = false;
    start(Math.max(remaining.current, 1_000));
  };

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    // F8 reaches the toast without a long tab walk, the convention Radix's toast viewport uses.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "F8") card.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  const cardIn = (tone: "status" | "alert") =>
    toast && (toast.tone ?? "status") === tone ? (
      <div
        key={toast.id}
        ref={card}
        tabIndex={-1}
        data-testid="toast"
        onPointerEnter={pause}
        onPointerLeave={resume}
        onFocus={pause}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resume();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") dismiss();
        }}
        className="pointer-events-auto flex min-h-14 w-full items-center gap-1 rounded-2xl bg-ink py-1 pr-1 pl-4 text-surface shadow-lg"
      >
        <p className="min-w-0 flex-1 py-2 break-words">{toast.message}</p>
        {toast.action ? (
          <Button
            variant="ghost"
            className="shrink-0 px-3 font-semibold text-surface underline"
            onClick={() => {
              const { onAction } = toast.action!;
              dismiss();
              onAction();
            }}
          >
            {toast.action.label}
          </Button>
        ) : null}
        <Button size="icon" variant="ghost" className="shrink-0 text-surface" onClick={dismiss}>
          <Icon name="close" />
          <VisuallyHidden>{t("dismiss")}</VisuallyHidden>
        </Button>
      </div>
    ) : null;

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section
        aria-label={t("region")}
        className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom)+0.5rem)] z-40 flex flex-col items-center px-4 lg:bottom-4 lg:pl-[256px]"
      >
        <div role="status" aria-live="polite" aria-atomic="true" className="w-full max-w-[480px]">
          {cardIn("status")}
        </div>
        <div role="alert" aria-live="assertive" aria-atomic="true" className="w-full max-w-[480px]">
          {cardIn("alert")}
        </div>
      </section>
    </ToastContext.Provider>
  );
}
```

(The action's double click runs once because the first click unmounts the card.)

- `src/shared/ui/index.ts`: `export { TOAST_ACTION_MS, TOAST_MS, ToastProvider, useToast, type ToastInput } from "./molecules/toast";`.
- `src/app/(web)/(app)/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { ToastProvider } from "@/shared/ui";

/** Ruling P195: one provider above every space's layout, so a toast survives the navigation after a save. */
export default function SignedInLayout({ children }: { readonly children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
```

- `record-form.tsx`:
  - `const toast = useToast();`
  - in the direct-split branch, before `router.push`: `if (!negative(split.expense.warnings)) toast.show({ message: t("toast.saved.EXPENSE") });`
  - in the POST branch: `if (!negative(warnings)) toast.show({ message: t(`toast.saved.${built.kind}`) });`
  - where `const negative = (warnings: RecordedExpenseDto["warnings"] = []) => warnings.some((w) => w.code === "FundBalanceNegative");` is defined in `record-request.ts` beside `afterSaveUrl`, exported as `fundWentNegative`, and `afterSaveUrl` reuses it.
- `settle-up-sheet.tsx`: in the 201 branch, `toast.show({ message: t("toast.settled") })` with `useTranslations("balances")`.

Measure: `pnpm build && pnpm perf`. `/spaces/:id/new` must stay ≤ 205 KiB. If it does not, move the card's JSX into `toast-card.tsx` behind `next/dynamic` (the live regions stay in the provider and the card mounts into them), and measure again. The budget is never raised (P198).

- [ ] **Step 4: Run the tests to verify they pass**

Run:
- `pnpm exec vitest run --project ui src/shared/ui src/modules/ledger/ui src/modules/balances/ui`
- then every gate, including `pnpm build && pnpm test:e2e` and `pnpm perf`.

Expected: PASS. The existing record-form tests pass unchanged (no provider means no toast).

Mutation checks:
- remove `pause()` from `onPointerEnter`: the pause test fails;
- render the status region only when a toast exists: the first test fails (`getByRole("status")` before the click).

- [ ] **Step 5: Commit**

```bash
git add src/shared/ui src/app/(web)/(app)/layout.tsx src/modules/ledger/ui/record src/modules/balances/ui src/i18n/messages
git commit -m "feat(web): announce saves with a status toast above the navigation (Refs #71, Refs #74, Refs #75)"
```

Risk: none.

---

### Task A5: The detail sheet, opened from a row

Rulings P189 and P190. A row of Movimientos, of "Cargar más" and of the home's recent list is a link to the same page with `?tx=<id>` (`scroll={false}`). The page's container reads `tx`:
- `loadTransactionDetail` fetches the transaction and, in a shared or direct space, the members;
- the page renders `TransactionSheetHost`, which loads `TransactionSheet` with `next/dynamic` only then.

The sheet:
- It is titled with the description, or the type's name when there is none.
- Its description is the signed amount.
- It lists, as a definition list:
  - Tipo;
  - Fecha y hora (the record's own zone, plus the city when it differs from the viewer's; "Sin hora" for an untimed row);
  - Categoría (path; not for transfers and settlements);
  - Cuenta, Cuenta que recibe, or Desde and Hacia;
  - Descripción;
  - Pagó (in a shared or direct space);
  - División (each participant, with their share and the method).
- Its footer holds Editar (a link to the edit route) and Eliminar (wired in Task A6), each only when `actionsFor` allows it, plus a note when only one of them is offered.
- Closing replaces the URL with the origin (no `tx`). Back closes it too, because opening was a push.
- An unknown or deleted `tx` opens the sheet with `errors.TransactionNotFound`.

**Files:**
- Create: `src/modules/ledger/ui/detail/{tx-href.ts, tx-href.test.ts, transaction-actions.ts, transaction-actions.test.ts, detail-loader.ts, transaction-sheet.tsx, transaction-sheet-host.tsx, transaction-sheet.test.tsx}`
- Modify: `src/modules/ledger/ui/{transaction-row.tsx, transaction-row.test.tsx, transaction-list.tsx, load-more.tsx, transaction-list-container.tsx, transaction-list.test.tsx}`, `src/modules/ledger/ui/home/{home-summary.tsx, home-container.tsx}`, `src/app/(web)/(app)/spaces/[spaceId]/{page.tsx, transactions/page.tsx}`, `src/shared/ui/icons/ui-icons.ts` (`pencil`, `trash`), `src/i18n/messages/{es,en}.json`

**Interfaces:**
- Consumes: `TransactionRow`, `RowContext`, `hrefOf`, `Sheet`, `memberLabel`, `categoryPath`, `formatMoney`, `formatDate`, `formatTimeAt`, `zoneCity`, `loaded`, `getMe`, `getSpaces`.
- Produces:
  - `withTx(href: string, id: string): string`; `withoutTx(href: string): string`;
  - `interface Viewer { userId: string; role: SpaceDto["role"]; memberId: string | null }`;
  - `interface TransactionActions { edit: boolean; delete: boolean; note: { key: "onlyOwner"; name: string } | { key: "SETTLEMENT" | "CONTRIBUTION" } | null }`;
  - `actionsFor(tx: TransactionDto, viewer: Viewer, members: readonly MemberDto[]): TransactionActions`;
  - `interface TransactionDetail { tx: TransactionDto | null; problem: Problem | null; members: MemberDto[]; viewer: Viewer }`;
  - `loadTransactionDetail(api: Api, input: { spaceId: string; transactionId: string; space: SpaceDto; meUserId: string }): Promise<TransactionDetail>`;
  - `TransactionSheet({ spaceId, detail, context, origin, api? })`;
  - `TransactionSheetHost` (same props);
  - `TransactionRow` gains `href?: string`;
  - `TransactionList` and `HomeSummary` gain `detail?: TransactionDetail`;
  - `LoadMore` gains `listHref: string`;
  - `TransactionListContainer` and `HomeContainer` gain `transactionId?: string`.

Catalog keys:

| Key | es | en |
|---|---|---|
| `ledger.detail.type` | Tipo | Type |
| `ledger.detail.when` | Fecha y hora | Date and time |
| `ledger.detail.noTime` | Sin hora | No time |
| `ledger.detail.noDescription` | Sin descripción | No description |
| `ledger.detail.payerAccount` | Cuenta de {name} | {name}'s account |
| `ledger.detail.edit` | Editar | Edit |
| `ledger.detail.delete` | Eliminar | Delete |
| `ledger.detail.note.onlyOwner` | Solo {name} puede editarlo, porque el dinero se mueve en su cuenta. Puedes eliminarlo. | Only {name} can edit it, because the money moves through their account. You can delete it. |
| `ledger.detail.note.SETTLEMENT` | Un pago entre miembros no se edita: elimínalo y regístralo de nuevo desde Saldos. | A payment between members is not edited: delete it and record it again from Balances. |
| `ledger.detail.note.CONTRIBUTION` | Un aporte al fondo no se edita: elimínalo y regístralo de nuevo. | A contribution to the fund is not edited: delete it and record it again. |
| `ledger.detail.open` | Ver detalle de {name} | Open the details of {name} |

The field labels reuse `ledger.form.amount`, `ledger.form.category`, `ledger.form.account`, `ledger.form.receivingAccount`, `ledger.form.from`, `ledger.form.to`, `ledger.form.description`, `ledger.split.payer`, `ledger.split.split` and `ledger.split.methods.<method>`, and `ledger.type.<TYPE>` names the type.

- [ ] **Step 1: Write the failing tests**

`src/modules/ledger/ui/detail/tx-href.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { withoutTx, withTx } from "./tx-href";

describe("the detail sheet's address (ruling P189)", () => {
  it.each([
    ["/spaces/s-1/transactions", "t-9", "/spaces/s-1/transactions?tx=t-9"],
    ["/spaces/s-1/transactions?period=2026-10&category=c-1", "t-9", "/spaces/s-1/transactions?period=2026-10&category=c-1&tx=t-9"],
    ["/spaces/s-1?tx=t-1", "t-9", "/spaces/s-1?tx=t-9"],
  ])("withTx(%s, %s) is %s", (href, id, expected) => expect(withTx(href, id)).toBe(expected));

  it.each([
    ["/spaces/s-1/transactions?period=2026-10&tx=t-9", "/spaces/s-1/transactions?period=2026-10"],
    ["/spaces/s-1?tx=t-9", "/spaces/s-1"],
    ["/spaces/s-1", "/spaces/s-1"],
  ])("withoutTx(%s) is %s", (href, expected) => expect(withoutTx(href)).toBe(expected));
});
```

`src/modules/ledger/ui/detail/transaction-actions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { guestDto, memberDto, transactionDto, cop } from "../../../../../tests/support/ui/dto";
import { actionsFor, type Viewer } from "./transaction-actions";

const ana: Viewer = { userId: "u-ana", role: "OWNER", memberId: "m-ana" };
const luis: Viewer = { userId: "u-luis", role: "MEMBER", memberId: "m-luis" };
const members = [
  memberDto({ id: "m-ana", userId: "u-ana", displayName: "Ana" }),
  memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan" }),
  memberDto({ id: "m-luis", userId: "u-luis", displayName: "Luis" }),
  guestDto({ id: "m-pedro", displayName: "Pedro" }),
];
const paidBy = (memberId: string | null, accountId: string | null, createdBy = "u-ana") =>
  transactionDto({
    type: "EXPENSE",
    createdBy,
    amount: cop(100_000),
    payments: [{ memberId, accountId, amount: cop(100_000) }],
    shares: [{ memberId: "m-ana", amount: cop(100_000), splitMethod: "EQUAL" }],
  });

describe("who sees Editar and Eliminar (ruling P190, D9)", () => {
  it("offers both to whoever's money it is: the recorder, a guest's or the fund's payment", () => {
    for (const tx of [paidBy("m-ana", "a-bank"), paidBy("m-pedro", null), paidBy(null, "a-fund")])
      expect(actionsFor(tx, ana, members)).toEqual({ edit: true, delete: true, note: null });
  });

  it("lets an OWNER delete but not edit an expense paid from another member's account", () => {
    expect(actionsFor(paidBy("m-juan", "a-juan", "u-juan"), ana, members)).toEqual({
      edit: false,
      delete: true,
      note: { key: "onlyOwner", name: "Juan" },
    });
  });

  it("gives a MEMBER nothing on someone else's transaction and a VIEWER nothing at all (HU-E4-06)", () => {
    expect(actionsFor(paidBy("m-ana", "a-bank"), luis, members)).toEqual({ edit: false, delete: false, note: null });
    expect(actionsFor(paidBy("m-ana", "a-bank"), { ...ana, role: "VIEWER" }, members)).toEqual({
      edit: false,
      delete: false,
      note: null,
    });
  });

  it("offers only Eliminar on a settlement and a fund contribution, saying why", () => {
    const settlement = transactionDto({ type: "SETTLEMENT", payerMemberId: "m-juan", receivingMemberId: "m-ana" });
    const contribution = transactionDto({ type: "TRANSFER", payerMemberId: "m-ana", destinationAccountId: "a-fund" });
    expect(actionsFor(settlement, ana, members)).toEqual({ edit: false, delete: true, note: { key: "SETTLEMENT" } });
    expect(actionsFor(contribution, ana, members)).toEqual({ edit: false, delete: true, note: { key: "CONTRIBUTION" } });
  });

  it("lets only the receiver edit an income and only the creator edit an own transfer", () => {
    const income = transactionDto({ type: "INCOME", createdBy: "u-juan", receivingMemberId: "m-juan" });
    const transfer = transactionDto({ type: "TRANSFER", createdBy: "u-juan", sourceAccountId: "a-1", destinationAccountId: "a-2" });
    expect(actionsFor(income, ana, members).edit).toBe(false);
    expect(actionsFor(transfer, ana, members)).toEqual({ edit: false, delete: true, note: { key: "onlyOwner", name: "Juan" } });
    expect(actionsFor(transfer, { ...ana, userId: "u-juan", memberId: "m-juan" }, members).edit).toBe(true);
  });

  it("in a personal space, where there are no members, everything is the viewer's own", () => {
    expect(actionsFor(paidBy("m-ana", "a-bank"), { ...ana, memberId: null }, [])).toEqual({ edit: true, delete: true, note: null });
  });
});
```

`src/modules/ledger/ui/detail/transaction-sheet.test.tsx`. Mock `next/navigation` (`useRouter` with `replace`, `refresh`, `push`), call `await preloadSheet()` from `@/shared/ui/molecules/sheet` in `beforeAll` as the ui setup does, and test:

```tsx
describe("transaction detail sheet (rulings P189, P190)", () => {
  it("shows a personal expense: type, amount, date and time, category path, account and description", async () => {
    // tx: EXPENSE "Market", cop(85_000), date 2026-10-31, occurredAt 2026-10-31T17:30:00.000Z, timeZone America/Bogota,
    // categoryId c-veg, payments [{ m-ana, a-bank, cop(85_000) }]; context = rowContext from tests/support/ui/dto
    // expect dialog name "Market"; its description "−$ 85.000"; definitions: Tipo "Gasto", Fecha y hora "31/10/2026 · 12:30",
    // Categoría "Food › Groceries › Vegetables" (as categoryPath prints it), Cuenta "Bancolombia", Descripción "Market";
    // links: "Editar" with href "/spaces/s-1/transactions/t-1/edit?from=%2Fspaces%2Fs-1%2Ftransactions"; button "Eliminar";
    // axeViolations(document.body) is []
  });
  it("shows who paid and each share of a shared expense, in the space's join order", async () => {
    // payments [{ m-juan, a-juan }], shares Ana 150,000 and Juan 150,000 EQUAL; members Ana, Juan;
    // Pagó "Juan"; Cuenta "Cuenta de Juan" (the account is not in the viewer's accountNames);
    // División: list items "Ana (tú) $ 150.000" and "Juan $ 150.000" and the method "Iguales";
    // note "Solo Juan puede editarlo, porque el dinero se mueve en su cuenta. Puedes eliminarlo."; no Editar link
  });
  it("reads an untimed row as Sin hora and a row from another zone with its city", async () => {});
  it("shows a transfer's Desde and Hacia and no category", async () => {});
  it("closes to the address it came from, without tx", async () => {
    // click "Cerrar" → router.replace("/spaces/s-1/transactions?period=2026-10", { scroll: false })
  });
  it("shows TransactionNotFound inside the sheet when the transaction is gone", async () => {
    // detail { tx: null, problem: { code: "TransactionNotFound", … } } → dialog with "No encontramos ese movimiento." and no actions
  });
});
```

Write each body in full. The comments state every value the test asserts, and the dates use `BUILT_IN_FORMATS` (`dd/MM/yyyy`, `H24`).

In `transaction-row.test.tsx`, add:
- "is a link to its detail when given an href, named by its whole row": `getByRole("link", { name: /Market/ })` has `href` `/spaces/s-1/transactions?tx=t-1`;
- the existing tests without `href` still find no link.

In `transaction-list.test.tsx`, add "every row links to its detail with the list's filter kept", with the period and category from `filter`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/ui/detail`
Expected: FAIL. `./tx-href` and `./transaction-actions` cannot be resolved.

Run: `pnpm exec vitest run --project ui src/modules/ledger/ui`
Expected: FAIL. `./transaction-sheet` cannot be resolved, and rows have no link.

- [ ] **Step 3: Implement**

`src/modules/ledger/ui/detail/tx-href.ts`:

```ts
/** Ruling P189: the detail sheet is addressed by `?tx=<id>` on the page that lists the row. */
export const withTx = (href: string, id: string): string => {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.set("tx", id);
  return `${path}?${params.toString()}`;
};

export const withoutTx = (href: string): string => {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.delete("tx");
  const text = params.toString();
  return text ? `${path}?${text}` : path!;
};
```

`src/modules/ledger/ui/detail/transaction-actions.ts`:

```ts
import type { MemberDto, SpaceDto, TransactionDto } from "@/shared/ui/api/dto";

export interface Viewer {
  readonly userId: string;
  readonly role: SpaceDto["role"];
  /** The viewer's member in a shared or direct space; null in the personal space, whose members are not read. */
  readonly memberId: string | null;
}

export interface TransactionActions {
  readonly edit: boolean;
  readonly delete: boolean;
  readonly note: { readonly key: "onlyOwner"; readonly name: string } | { readonly key: "SETTLEMENT" | "CONTRIBUTION" } | null;
}

const NONE: TransactionActions = { edit: false, delete: false, note: null };

/**
 * Ruling P190: HU-E4-06's `canModify` (OWNER and ADMIN any, MEMBER their own, VIEWER none) for both actions, and D9 for
 * Editar: only whoever's account the money moves through may change it, so the sheet never offers an edit the API
 * refuses. Settlements and fund contributions are deleted and recorded again (P188).
 */
export const actionsFor = (
  tx: TransactionDto,
  viewer: Viewer,
  members: readonly MemberDto[],
): TransactionActions => {
  const { role, userId } = viewer;
  if (!(role === "OWNER" || role === "ADMIN" || (role === "MEMBER" && tx.createdBy === userId))) return NONE;
  if (tx.type === "SETTLEMENT") return { edit: false, delete: true, note: { key: "SETTLEMENT" } };
  if (tx.type === "TRANSFER" && tx.payerMemberId !== null)
    return { edit: false, delete: true, note: { key: "CONTRIBUTION" } };
  const byUser = (id: string) => members.find((m) => m.userId === id);
  const byMember = (id: string | null) => members.find((m) => m.id === id);
  const owner =
    tx.type === "EXPENSE"
      ? byMember(tx.payments[0]?.memberId ?? null)
      : tx.type === "INCOME"
        ? (byMember(tx.receivingMemberId) ?? byUser(tx.createdBy))
        : byUser(tx.createdBy);
  // A guest or the fund paid (no user), or the money is the viewer's: theirs to change.
  if (!owner || owner.userId === null || owner.userId === userId) return { edit: true, delete: true, note: null };
  return { edit: false, delete: true, note: { key: "onlyOwner", name: owner.displayName } };
};
```

`src/modules/ledger/ui/detail/detail-loader.ts`:

```ts
import type { Api } from "@/shared/ui/api/client";
import type { MemberDto, SpaceDto, TransactionDto } from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import { loaded } from "@/shared/ui/api/server";
import type { Viewer } from "./transaction-actions";

export interface TransactionDetail {
  readonly tx: TransactionDto | null;
  readonly problem: Problem | null;
  readonly members: MemberDto[];
  readonly viewer: Viewer;
}

/** Ruling P189: the transaction behind `?tx=`, and in a shared or direct space the members who name its parts. */
export const loadTransactionDetail = async (
  api: Api,
  input: { readonly spaceId: string; readonly transactionId: string; readonly space: SpaceDto; readonly meUserId: string },
): Promise<TransactionDetail> => {
  const path = { spaceId: input.spaceId, transactionId: input.transactionId };
  const shared = input.space.kind !== "PERSONAL";
  const [tx, members] = await Promise.all([
    loaded(api.GET("/api/v1/spaces/{spaceId}/transactions/{transactionId}", { params: { path } })),
    shared
      ? loaded(api.GET("/api/v1/spaces/{spaceId}/members", { params: { path: { spaceId: input.spaceId } } }))
      : null,
  ]);
  const items = members?.ok ? members.data.items : [];
  return {
    tx: tx.ok ? tx.data : null,
    problem: tx.ok ? null : tx.problem,
    members: items,
    viewer: {
      userId: input.meUserId,
      role: input.space.role,
      memberId: items.find((m) => m.userId === input.meUserId)?.id ?? null,
    },
  };
};
```

(Check that `loaded` answers `{ ok: false, problem }` for a 404 instead of calling `notFound()`. If it calls `notFound()` for a 404, use `api.GET` directly with `problemFrom(error, response)`, so a deleted `tx` shows inside the sheet.)

`transaction-sheet.tsx` (`"use client"`), `TransactionSheet({ spaceId, detail, context, origin, api? })`:
- It is a `Sheet` with `open` true.
- `onOpenChange(false)` calls `router.replace(origin, { scroll: false })`.
- Title: `tx.description || t("type." + tx.type)`, or `errors("TransactionNotFound")` when `tx` is null.
- `description`: the signed amount, as `TransactionRow` signs it (`MINUS` for expenses, `+` for incomes).
- Body: a `<dl>` whose rows are `<div>` pairs of `<dt className="text-sm text-muted">` and `<dd className="font-medium text-ink break-words">`, in this order:
  - Tipo;
  - Fecha y hora: `formatDate(tx.date)` · `formatTimeAt(tx.occurredAt, tx.timeZone)`, with `· zoneCity(tx.timeZone)` when the zone is not the viewer's, or `ledger.detail.noTime`;
  - Categoría: `categoryPath`, EXPENSE and INCOME only;
  - the account row:
    - EXPENSE: `ledger.form.account` = the payment's account name from `context.accountNames`, else `ledger.detail.payerAccount` with the payer's label, else the fund's name;
    - INCOME: `ledger.form.receivingAccount`;
    - TRANSFER: `ledger.form.from` and `ledger.form.to`;
    - SETTLEMENT: `ledger.form.from` and `ledger.form.to`, with the two members' labels;
  - Descripción, or `ledger.detail.noDescription`;
  - in a shared or direct space, Pagó: the payer's `memberLabel`, or the fund's account name;
  - División: a `<ul aria-label={t("split.split")}>` with one `<li>` per share in the API's order: `memberLabel(member, viewer.userId, names)` and `formatMoney(share.amount)`, plus the method's `ledger.split.methods.<method>` once under the heading.
- When `detail.problem`: a `ProblemNotice` and no list.
- `footer`: `actionsFor(...)`:
  - when `edit`: a `Link` styled as a `lg` secondary button with the `pencil` icon and `ledger.detail.edit`, `href={`/spaces/${spaceId}/transactions/${tx.id}/edit?from=${encodeURIComponent(origin)}`}`;
  - when `delete`: a `lg` `danger` `Button` with the `trash` icon and `ledger.detail.delete` (its `onClick` comes in Task A6; here it is disabled with `aria-disabled` removed, so leave it out until A6 and add it there);
  - the note's text above them, when there is a note.
- Both actions sit in a two-column grid that wraps to one column under 360 px.

`transaction-sheet-host.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { TransactionSheet as Sheet } from "./transaction-sheet";

// Ruling P189: the sheet's code, and the Radix dialog under it, load only when a row was opened (P134).
const TransactionSheet = dynamic(() => import("./transaction-sheet").then((module) => module.TransactionSheet), {
  ssr: false,
});

export function TransactionSheetHost(props: ComponentProps<typeof Sheet>) {
  return <TransactionSheet {...props} />;
}
```

`transaction-row.tsx`: with `href`, the `<li>` keeps its classes minus the flex layout. It wraps its content in `<Link href={href} scroll={false} className="flex min-h-16 items-center gap-3 py-2 rounded-xl focus-visible:outline-2 …">`. Without `href` it renders exactly as today. The link's name is the row's text, which satisfies label-in-name.

`transaction-list.tsx`:
- every row gets `href={withTx(hrefOf(spaceId, filter), tx.id)}`;
- `LoadMore` gets `listHref={hrefOf(spaceId, filter)}` and gives its rows `withTx(listHref, tx.id)`;
- when `detail` is given it renders `<TransactionSheetHost spaceId={spaceId} detail={detail} context={context} origin={hrefOf(spaceId, filter)} />` (the origin keeps the notice out: closing the sheet never re-shows a dismissed notice).

`transaction-list-container.tsx` takes `transactionId?: string`. When present, it calls `loadTransactionDetail(api, { spaceId, transactionId, space, meUserId: me!.id })` in parallel with `loadTransactionList` and passes `detail`. The `space` comes from `getSpaces()`, which the container already reads.

`home-summary.tsx` and `home-container.tsx` do the same:
- the row's href is `withTx(`/spaces/${spaceId}`, tx.id)`;
- the origin is `/spaces/${spaceId}`;
- `HomeContainer({ spaceId, transactionId? })`.

The two pages read `searchParams.tx` and pass it as `transactionId`.

`ui-icons.ts`:

```ts
  pencil: "M4 20h4L19 9l-4-4L4 16v4Zm10-14 4 4",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
```

**Split point** (if the staged candidate is over ~500 lines):
1. `tx-href.ts`, `transaction-actions.ts`, their tests, the icons and the row's `href` (about 220 lines): `feat(ledger): link every transaction row to its detail (Refs #71)`.
2. The loader, the sheet, the host, the containers and the pages: `feat(ledger): open a transaction's detail sheet from its row (Refs #71)`.

Each part is green on its own (part 1's links open a page whose sheet simply is not rendered yet).

- [ ] **Step 4: Run the tests to verify they pass**

Run:
- `pnpm exec vitest run --project unit src/modules/ledger/ui`
- `pnpm exec vitest run --project ui src/modules/ledger/ui`
- every gate, including the e2e run (the M6a and M6b scenarios still find rows by `listitem`).

Expected: PASS.

Mutation checks:
- drop the `role === "MEMBER" && tx.createdBy === userId` clause: the MEMBER test fails;
- swap `owner.userId === userId`: the OWNER test fails.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ledger/ui src/app/(web)/(app)/spaces/[spaceId] src/shared/ui/icons/ui-icons.ts src/i18n/messages
git commit -m "feat(ledger): open a transaction's detail sheet from its row (Refs #71)"
```

Risk: none.

---

### Task A6: Delete with undo

Ruling P194. Eliminar runs `DELETE …/transactions/{id}` with no confirmation dialog, then:
- the sheet closes to the origin (`router.replace(origin, { scroll: false })`) and `router.refresh()` drops the row;
- a toast shows `ledger.toast.deleted.<TYPE>` with the action `ledger.toast.undo` (8 s).

Deshacer runs `POST …/restore` once, then `router.refresh()` and the toast `ledger.toast.restored.<TYPE>`. A refused delete keeps the sheet open, with the problem under the buttons (`PeriodClosed`, `NotASpaceMember`, `InsufficientRole`). A refused restore shows `ledger.toast.undoFailed` with the problem's message in the alert region. The button is disabled while pending, so a double click deletes once.

**Files:**
- Create: `src/modules/ledger/ui/detail/use-delete-with-undo.ts`, `src/modules/ledger/ui/detail/delete-undo.test.tsx`
- Modify: `src/modules/ledger/ui/detail/transaction-sheet.tsx`, `src/i18n/messages/{es,en}.json`

**Interfaces:**
- Consumes: `useToast`, `browserApi`, `problemFrom`, `useProblemMessage`, `withoutTx`.
- Produces: `useDeleteWithUndo(input: { api: Api; spaceId: string; tx: TransactionDto; origin: string }): { remove(): Promise<void>; pending: boolean; problem: Problem | null }`.

Catalog keys:

| Key | es | en |
|---|---|---|
| `ledger.toast.undo` | Deshacer | Undo |
| `ledger.toast.deleted.EXPENSE` | Gasto eliminado | Expense deleted |
| `ledger.toast.deleted.INCOME` | Ingreso eliminado | Income deleted |
| `ledger.toast.deleted.TRANSFER` | Transferencia eliminada | Transfer deleted |
| `ledger.toast.deleted.SETTLEMENT` | Pago eliminado | Payment deleted |
| `ledger.toast.restored.EXPENSE` | Gasto restaurado | Expense restored |
| `ledger.toast.restored.INCOME` | Ingreso restaurado | Income restored |
| `ledger.toast.restored.TRANSFER` | Transferencia restaurada | Transfer restored |
| `ledger.toast.restored.SETTLEMENT` | Pago restaurado | Payment restored |
| `ledger.toast.undoFailed` | No se pudo deshacer: {message} | Could not undo: {message} |

- [ ] **Step 1: Write the failing tests**

`src/modules/ledger/ui/detail/delete-undo.test.tsx`. Mock the router, preload the sheet, and render `TransactionSheet` inside `ToastProvider` with a `fakeApi`:

```tsx
describe("delete with undo (ruling P194)", () => {
  it("deletes at once, closes to the list, refreshes, and offers Deshacer in a status toast", async () => {
    const { api, requests } = fakeApi({
      "DELETE /api/v1/spaces/{spaceId}/transactions/{transactionId}": () => new Response(null, { status: 204 }),
    });
    renderSheet(api);
    await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "DELETE /api/v1/spaces/s-1/transactions/t-1",
    ]);
    expect(router.replace).toHaveBeenCalledWith("/spaces/s-1/transactions?period=2026-10", { scroll: false });
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Gasto eliminado");
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("restores once on Deshacer, refreshes again and says so", async () => {
    // DELETE 204; POST …/restore 200 transactionDto({ id: "t-1", version: 3 }); dblClick Deshacer
    // requests: DELETE then exactly one POST /api/v1/spaces/s-1/transactions/t-1/restore; router.refresh called twice;
    // status "Gasto restaurado"
  });

  it("keeps the sheet open with the problem when the delete is refused", async () => {
    // DELETE → problemResponse(409, "PeriodClosed"); the dialog stays; text errors.PeriodClosed; no toast; replace not called
  });

  it("says in an alert when the undo fails", async () => {
    // DELETE 204; restore → problemResponse(409, "PeriodClosed"); alert "No se pudo deshacer: Ese periodo está cerrado. Elige una fecha de un periodo abierto."
  });

  it("sends one DELETE for a double click", async () => {
    // a DELETE handler that resolves after a manual promise; dblClick Eliminar; one request
  });
});
```

Write the elided bodies in full; every expected value is in the comments.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project ui src/modules/ledger/ui/detail/delete-undo.test.tsx`
Expected: FAIL. There is no "Eliminar" button handler and no request is sent.

- [ ] **Step 3: Implement**

`use-delete-with-undo.ts`:

```ts
"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { useToast } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { TransactionDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";

/** Ruling P194: a soft delete at once (D8), undone by a restore from the toast; never a confirmation dialog. */
export const useDeleteWithUndo = ({ api, spaceId, tx, origin }: {
  readonly api: Api;
  readonly spaceId: string;
  readonly tx: TransactionDto;
  readonly origin: string;
}) => {
  const t = useTranslations("ledger.toast");
  const router = useRouter();
  const toast = useToast();
  const messageOf = useProblemMessage();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const restoring = useRef(false);
  const path = { spaceId, transactionId: tx.id };

  const undo = async () => {
    if (restoring.current) return;
    restoring.current = true;
    try {
      const { error, response } = await api.POST("/api/v1/spaces/{spaceId}/transactions/{transactionId}/restore", {
        params: { path },
      });
      if (response.ok) {
        router.refresh();
        toast.show({ message: t(`restored.${tx.type}`) });
      } else
        toast.show({ tone: "alert", message: t("undoFailed", { message: messageOf(problemFrom(error, response)).message }) });
    } catch (error) {
      toast.show({ tone: "alert", message: t("undoFailed", { message: messageOf(problemFrom(error, undefined)).message }) });
    }
  };

  const remove = async () => {
    if (pending) return;
    setPending(true);
    setProblem(null);
    try {
      const { error, response } = await api.DELETE("/api/v1/spaces/{spaceId}/transactions/{transactionId}", {
        params: { path },
      });
      if (response.ok) {
        router.replace(origin, { scroll: false });
        router.refresh();
        toast.show({ message: t(`deleted.${tx.type}`), action: { label: t("undo"), onAction: () => void undo() } });
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  return { remove, pending, problem };
};
```

In `transaction-sheet.tsx`, the Eliminar button calls `remove`, is `disabled={pending}`, and a `ProblemNotice` for `problem` sits above the footer's buttons. The hook is called only when `detail.tx` exists: the sheet renders an inner `Actions` component for that case.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project ui src/modules/ledger/ui/detail`, then every gate including e2e.
Expected: PASS.

Mutation checks:
- drop `restoring.current` guard: the double-click undo test fails;
- drop `if (pending) return;`: the double-click delete test fails.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ledger/ui/detail src/i18n/messages
git commit -m "feat(ledger): delete a transaction with an undo toast (Refs #71)"
```

Risk: none.

---

### Task A7: Prefill the record form from a transaction and send only what changed

Rulings P191 and P192, as pure modules plus one optional `RecordForm` prop. `initialOf` turns a transaction into the form's starting state:
- the amount is typed in the person's number format;
- the description, the category choice (a subcategory with its parent) and the accounts come from the transaction;
- the date and wall time come from the record's own zone when it has a time; an untimed row takes the editor's current time, which is not sent unless the person changes the date or time;
- for a shared expense, the payer is ME with the account, GUEST or FUND;
- the split is prefilled as follows:
  - EQUAL as EQUAL among the share holders;
  - EXACT as EXACT with each share's amount;
  - PERCENT, SHARES and BY_ALLOCATION as PERCENT derived from the shares (two decimals; the last participant in join order takes what makes 100.00);
- the split counts as `chosen`, so the plan's default never replaces it.

`editBodyOf` compares the request `requestOf` builds from that state (the baseline) with the request it builds now:
- it sends a key only when it differs;
- the three time fields travel together, only when the person changed the date or time;
- `payments` travel when the payer or its account changed;
- `split` travels when it changed, or whenever the amount changed on an expense with more than one share;
- a cleared description travels as `""`.

`RecordForm` gains `edit?: RecordEdit`. With it:
- the kind tabs are replaced by a read-only line with the type, and the title is `ledger.edit.title`;
- the back link is `edit.backHref`, and the save button reads `ledger.edit.save`;
- the split-with-someone control is hidden, and `SharedFields` gets `defaultSplit={false}` (no "Según el plan" in an edit, P192);
- Save calls `edit.onSave(built, { when })` instead of POSTing and keeps no Idempotency-Key;
- `edit.problemAction(problem)` renders under a form-level problem.

**Files:**
- Create: `src/modules/ledger/ui/edit/{edit-initial.ts, edit-initial.test.ts, edit-request.ts, edit-request.test.ts, origin.ts, origin.test.ts}`, `src/modules/ledger/ui/record/record-form-edit.test.tsx`
- Modify: `src/modules/ledger/ui/record/record-form.tsx`, `src/modules/ledger/ui/split/shared-fields.tsx` (`defaultSplit`), `src/i18n/messages/{es,en}.json`

**Interfaces:**
- Consumes: `requestOf`, `RecordDraft`, `RecordKind`, `When`, `SplitDraft`, `Payer`, `SharedExpenseContext`, `CategoryChoice`, `findCategory`, `formatNumber`, `decimalOf`, `currencyOf`, `nowIn`, `safeNext`.
- Produces:
  - `interface RecordInitial { kind: RecordKind; amount: string; description: string; category: CategoryChoice; accountId: string | null; toAccountId: string | null; when: When; split: SplitDraft | null }`;
  - `initialOf(tx: TransactionDto, input: { groups: readonly CategoryGroupDto[]; formats: Formats; zone: string; now: Date; shared?: SharedExpenseContext }): RecordInitial`;
  - `draftOf(initial: RecordInitial, zone: string): RecordDraft`;
  - `editBodyOf(input: { tx: TransactionDto; baseline: Record<string, unknown>; current: Record<string, unknown>; whenChanged: boolean }): Record<string, unknown>`;
  - `ifMatchOf(version: number): string`;
  - `originOf(from: string | undefined, spaceId: string): string`;
  - `interface RecordEdit { initial: RecordInitial; backHref: string; onSave(built: { kind: RecordKind; body: Record<string, unknown> }, state: { when: When }): Promise<Problem | null>; problemAction?(problem: Problem): ReactNode }`;
  - `RecordFormProps.edit?: RecordEdit`;
  - `SharedFieldsProps.defaultSplit?: boolean`.

Catalog keys:

| Key | es | en |
|---|---|---|
| `ledger.edit.title` | Editar movimiento | Edit transaction |
| `ledger.edit.save` | Guardar cambios | Save changes |
| `ledger.edit.kind` | Tipo: {type} | Type: {type} |

- [ ] **Step 1: Write the failing tests**

`src/modules/ledger/ui/edit/edit-initial.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { categoryDto, cop, groupDto, memberDto, guestDto, accountDto, transactionDto } from "../../../../../tests/support/ui/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { initialOf } from "./edit-initial";

const groups = [
  groupDto({
    id: "g-food",
    categories: [categoryDto({ id: "c-groceries", subcategories: [categoryDto({ id: "c-veg", parentCategoryId: "c-groceries" })] })],
  }),
];
const now = new Date("2026-11-01T04:30:00Z");
const base = { groups, formats: BUILT_IN_FORMATS, zone: "America/Bogota", now };
const shared = {
  members: [
    memberDto({ id: "m-ana", userId: "u-ana" }),
    memberDto({ id: "m-juan", userId: "u-juan" }),
    guestDto({ id: "m-pedro" }),
  ],
  meMemberId: "m-ana",
  myAccounts: [accountDto({ id: "a-bank" })],
  funds: [accountDto({ id: "a-fund", type: "SHARED_FUND" })],
};
const sharedExpense = (shares: [string, number, string][], payment: { memberId: string | null; accountId: string | null } = { memberId: "m-ana", accountId: "a-bank" }) =>
  transactionDto({
    type: "EXPENSE",
    amount: cop(shares.reduce((sum, [, pesos]) => sum + pesos, 0)),
    categoryId: "c-groceries",
    payments: [{ ...payment, amount: cop(shares.reduce((sum, [, pesos]) => sum + pesos, 0)) }],
    shares: shares.map(([memberId, pesos, splitMethod]) => ({ memberId, amount: cop(pesos), splitMethod: splitMethod as "EQUAL" })),
  });

describe("initialOf (ruling P192)", () => {
  it("prefills a timed personal expense in its own zone, with the subcategory under its parent", () => {
    const tx = transactionDto({
      type: "EXPENSE",
      description: "Market",
      amount: cop(85_000),
      date: "2026-10-31",
      occurredAt: "2026-10-31T17:30:00.000Z",
      timeZone: "America/Bogota",
      categoryId: "c-veg",
      payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(85_000) }],
      shares: [{ memberId: "m-ana", amount: cop(85_000), splitMethod: "EQUAL" }],
    });
    expect(initialOf(tx, { ...base, zone: "Europe/Madrid" })).toEqual({
      kind: "EXPENSE",
      amount: "85.000",
      description: "Market",
      category: { categoryId: "c-groceries", subcategoryId: "c-veg" },
      accountId: "a-bank",
      toAccountId: null,
      when: { date: "2026-10-31", wall: { hour: 12, minute: 30 } },
      split: null,
    });
  });

  it("gives an untimed row the editor's current time without changing its date", () => {
    const tx = transactionDto({ type: "INCOME", date: "2026-10-15", destinationAccountId: "a-bank", categoryId: "c-groceries", amount: cop(1_000) });
    expect(initialOf(tx, base)).toMatchObject({ kind: "INCOME", accountId: "a-bank", when: { date: "2026-10-15", wall: { hour: 23, minute: 30 } } });
  });

  it("prefills a transfer's two accounts", () => {
    const tx = transactionDto({ type: "TRANSFER", sourceAccountId: "a-bank", destinationAccountId: "a-nequi", amount: cop(50_000) });
    expect(initialOf(tx, base)).toMatchObject({ kind: "TRANSFER", accountId: "a-bank", toAccountId: "a-nequi", category: null });
  });

  it.each([
    ["EQUAL", [["m-ana", 150_000, "EQUAL"], ["m-juan", 150_000, "EQUAL"]], "EQUAL", {}],
    ["EXACT", [["m-ana", 100_000, "EXACT"], ["m-juan", 150_000, "EXACT"]], "EXACT", { "m-ana": "100.000", "m-juan": "150.000" }],
    ["PERCENT", [["m-ana", 100_000, "PERCENT"], ["m-juan", 150_000, "PERCENT"]], "PERCENT", { "m-ana": "40", "m-juan": "60" }],
    ["SHARES", [["m-ana", 200_000, "SHARES"], ["m-juan", 100_000, "SHARES"]], "PERCENT", { "m-ana": "66,67", "m-juan": "33,33" }],
    ["BY_ALLOCATION", [["m-ana", 800_000, "BY_ALLOCATION"], ["m-juan", 1_200_000, "BY_ALLOCATION"]], "PERCENT", { "m-ana": "40", "m-juan": "60" }],
  ] as const)("prefills a %s split as %s", (_name, shares, method, values) => {
    const split = initialOf(sharedExpense(shares.map((s) => [...s])), { ...base, shared })!.split!;
    expect(split).toEqual({
      payer: { kind: "ME", memberId: "m-ana", accountId: "a-bank" },
      method,
      selected: ["m-ana", "m-juan"],
      values,
      chosen: true,
    });
  });

  it("names a guest's and the fund's payment as their payer kinds", () => {
    expect(initialOf(sharedExpense([["m-ana", 100_000, "EQUAL"]], { memberId: "m-pedro", accountId: null }), { ...base, shared }).split!.payer).toEqual({ kind: "GUEST", memberId: "m-pedro" });
    expect(initialOf(sharedExpense([["m-ana", 100_000, "EQUAL"]], { memberId: null, accountId: "a-fund" }), { ...base, shared }).split!.payer).toEqual({ kind: "FUND", accountId: "a-fund" });
  });
});
```

Under `BUILT_IN_FORMATS` (the dots-and-comma number format the other tests use), "85.000" reads 85,000 and "66,67" is 66.67. Read `BUILT_IN_FORMATS.numberFormat` and keep these literals consistent with it.

`src/modules/ledger/ui/edit/edit-request.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cop, transactionDto } from "../../../../../tests/support/ui/dto";
import { editBodyOf, ifMatchOf } from "./edit-request";

const time = { date: "2026-10-31", occurredAt: "2026-10-31T17:30:00.000Z", timeZone: "America/Bogota" };
const personal = { description: "Market", ...time, categoryId: "c-groceries", amount: { amount: "8500000", currency: "COP" }, accountId: "a-bank" };
const single = transactionDto({ type: "EXPENSE", shares: [{ memberId: "m-ana", amount: cop(85_000), splitMethod: "EQUAL" }] });
const two = transactionDto({
  type: "EXPENSE",
  payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(300_000) }],
  shares: [
    { memberId: "m-ana", amount: cop(150_000), splitMethod: "EQUAL" },
    { memberId: "m-juan", amount: cop(150_000), splitMethod: "EQUAL" },
  ],
});
const payments = (pesos: number, accountId = "a-bank", memberId = "m-ana") => [{ memberId, accountId, amount: { amount: String(pesos * 100), currency: "COP" } }];
const equal = { method: "EQUAL", participants: [{ memberId: "m-ana" }, { memberId: "m-juan" }] };
const sharedBody = (pesos: number, extra: Record<string, unknown> = {}) => ({
  ...time,
  categoryId: "c-groceries",
  amount: { amount: String(pesos * 100), currency: "COP" },
  payments: payments(pesos),
  split: equal,
  ...extra,
});

describe("editBodyOf: only what changed travels (ruling P192)", () => {
  it.each([
    ["nothing changed", single, personal, personal, false, {}],
    ["the amount", single, personal, { ...personal, amount: { amount: "9500000", currency: "COP" } }, false, { amount: { amount: "9500000", currency: "COP" } }],
    ["a cleared description", single, personal, (({ description: _d, ...rest }) => rest)(personal), false, { description: "" }],
    ["the account", single, personal, { ...personal, accountId: "a-nequi" }, false, { accountId: "a-nequi" }],
    ["the date and time", single, personal, { ...personal, date: "2026-10-30", occurredAt: "2026-10-30T17:30:00.000Z" }, true, { date: "2026-10-30", occurredAt: "2026-10-30T17:30:00.000Z", timeZone: "America/Bogota" }],
    ["a time the form made up for an untimed row", single, personal, { ...personal, occurredAt: "2026-10-31T04:30:00.000Z" }, false, {}],
    ["the payer's account", two, sharedBody(300_000), sharedBody(300_000, { payments: payments(300_000, "a-nequi") }), false, { payments: payments(300_000, "a-nequi") }],
    ["the amount of a split expense, which re-sends the split", two, sharedBody(300_000), sharedBody(400_000), false, { amount: { amount: "40000000", currency: "COP" }, split: equal }],
    ["only the split", two, sharedBody(300_000), sharedBody(300_000, { split: { method: "PERCENT", participants: [{ memberId: "m-ana", percent: "40" }, { memberId: "m-juan", percent: "60" }] } }), false, { split: { method: "PERCENT", participants: [{ memberId: "m-ana", percent: "40" }, { memberId: "m-juan", percent: "60" }] } }],
  ] as const)("%s", (_name, tx, baseline, current, whenChanged, expected) =>
    expect(editBodyOf({ tx, baseline, current, whenChanged })).toEqual(expected),
  );

  it("names the version as the strong ETag the API sends", () => expect(ifMatchOf(4)).toBe('"4"'));
});
```

(The "amount of a split expense" case shows the payments are not re-sent: the API makes a sole payment follow the amount. `two` has one payment, and v1 offers one payer.)

`src/modules/ledger/ui/edit/origin.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { originOf } from "./origin";

describe("originOf: where an edit returns (ruling P191)", () => {
  it.each([
    ["/spaces/s-1/transactions?period=2026-10", "/spaces/s-1/transactions?period=2026-10"],
    ["/spaces/s-1", "/spaces/s-1"],
    ["/spaces/s-1/transactions?tx=t-1", "/spaces/s-1/transactions"],
    [undefined, "/spaces/s-1/transactions"],
    ["https://evil.example/spaces/s-1", "/spaces/s-1/transactions"],
    ["//evil.example", "/spaces/s-1/transactions"],
    ["/spaces/s-2/transactions", "/spaces/s-1/transactions"],
    ["/settings", "/spaces/s-1/transactions"],
  ])("from %s returns to %s", (from, expected) => expect(originOf(from, "s-1")).toBe(expected));
});
```

`src/modules/ledger/ui/record/record-form-edit.test.tsx`. Set up as `record-form.test.tsx` does, then:

```tsx
describe("record form in edit mode (ruling P191)", () => {
  it("starts from the transaction, hides the kind tabs and the split with someone, and hands Save to onSave", async () => {
    const onSave = vi.fn(async () => null);
    renderWithIntl(
      <RecordForm space={spaceDto()} accounts={accounts} groups={groups} formats={BUILT_IN_FORMATS} initialKind="EXPENSE"
        initialNow="2026-11-01T04:30:00.000Z" timeZone="America/Bogota" people={[]} api={fakeApi({}).api}
        edit={{ initial: { kind: "EXPENSE", amount: "85.000", description: "Market", category: { categoryId: "c-groceries", subcategoryId: null },
          accountId: "a-bank", toAccountId: null, when: { date: "2026-10-31", wall: { hour: 12, minute: 30 } }, split: null },
          backHref: "/spaces/s-1/transactions?tx=t-1", onSave }} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Editar movimiento" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByText("Tipo: Gasto")).toBeInTheDocument();
    expect(screen.getByLabelText("Monto")).toHaveValue("85.000");
    expect(screen.getByLabelText("Descripción")).toHaveValue("Market");
    expect(screen.getByTestId("when-chip")).toHaveTextContent("31/10/2026 · 12:30");
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/spaces/s-1/transactions?tx=t-1");
    expect(screen.queryByRole("button", { name: /Dividir con alguien/ })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Monto"));
    await userEvent.type(screen.getByLabelText("Monto"), "95000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "EXPENSE", body: expect.objectContaining({ amount: { amount: "9500000", currency: "COP" }, accountId: "a-bank" }) }),
      { when: { date: "2026-10-31", wall: { hour: 12, minute: 30 } } },
    );
  });

  it("shows the problem onSave answers above the button, with the problem's action", async () => {
    // onSave resolves { code: "PreconditionFailed", status: 412, … } ; problemAction renders <button>Cargar la última versión</button>
    // expect the errors.PreconditionFailed text and that button; the save button is enabled again
  });
});
```

(The direct-split button's real name is `ledger.direct.open`. Read it from the catalog and use it in place of `/Dividir con alguien/`. The test passes `people={[]}` to prove edit mode hides the control even when people exist.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/ui/edit`
Expected: FAIL. The modules cannot be resolved.

Run: `pnpm exec vitest run --project ui src/modules/ledger/ui/record/record-form-edit.test.tsx`
Expected: FAIL. `edit` is not a prop, and the heading is "Registrar movimiento".

- [ ] **Step 3: Implement**

`edit/edit-initial.ts`:

```ts
import { findCategory, type CategoryChoice } from "@/modules/categories/ui";
import type { CategoryGroupDto, TransactionDto } from "@/shared/ui/api/dto";
import { currencyOf } from "@/shared/ui/format/currencies";
import { decimalOf, formatNumber, type Formats } from "@/shared/ui/format/formatters";
import { nowIn } from "@/shared/ui/time/when";
import type { RecordDraft, RecordKind } from "../record/record-request";
import type { When } from "../record/when-label";
import type { SharedExpenseContext } from "../split/shared-context";
import type { Payer, SplitDraft } from "../split/split-request";

export interface RecordInitial {
  readonly kind: RecordKind;
  readonly amount: string;
  readonly description: string;
  readonly category: CategoryChoice;
  readonly accountId: string | null;
  readonly toAccountId: string | null;
  readonly when: When;
  readonly split: SplitDraft | null;
}

const typed = (minor: string, currency: string, formats: Formats) =>
  formatNumber(decimalOf(minor, currencyOf(currency).exponent), formats);

/** Basis points of each share, rounded half up, the last in join order taking what makes 10,000 (P192). */
const percentsOf = (shares: TransactionDto["shares"], total: bigint): bigint[] => {
  const points = shares.map((s) => (BigInt(s.amount.amount) * 20_000n + total) / (2n * total));
  points[points.length - 1] = 10_000n - points.slice(0, -1).reduce((sum, p) => sum + p, 0n);
  return points;
};
const percentText = (points: bigint, formats: Formats) =>
  formatNumber(`${points / 100n}.${String(points % 100n).padStart(2, "0")}`, formats);

const payerOf = (tx: TransactionDto, shared: SharedExpenseContext): Payer => {
  const paid = tx.payments[0]!;
  if (paid.memberId === null) return { kind: "FUND", accountId: paid.accountId! };
  const member = shared.members.find((m) => m.id === paid.memberId);
  return member && member.userId === null
    ? { kind: "GUEST", memberId: paid.memberId }
    : { kind: "ME", memberId: paid.memberId, accountId: paid.accountId };
};

/** Ruling P192: the split as the form shows it; one the form cannot type back (SHARES, the plan's) becomes percents. */
const splitOf = (tx: TransactionDto, shared: SharedExpenseContext, formats: Formats): SplitDraft => {
  const order = shared.members.map((m) => m.id);
  const shares = [...tx.shares].sort((a, b) => order.indexOf(a.memberId) - order.indexOf(b.memberId));
  const method = shares[0]?.splitMethod ?? "EQUAL";
  const selected = shares.map((s) => s.memberId);
  if (method === "EQUAL") return { payer: payerOf(tx, shared), method, selected, values: {}, chosen: true };
  if (method === "EXACT")
    return {
      payer: payerOf(tx, shared),
      method,
      selected,
      values: Object.fromEntries(shares.map((s) => [s.memberId, typed(s.amount.amount, s.amount.currency, formats)])),
      chosen: true,
    };
  const points = percentsOf(shares, BigInt(tx.amount.amount));
  return {
    payer: payerOf(tx, shared),
    method: "PERCENT",
    selected,
    values: Object.fromEntries(shares.map((s, i) => [s.memberId, percentText(points[i]!, formats)])),
    chosen: true,
  };
};

export const initialOf = (
  tx: TransactionDto,
  input: {
    readonly groups: readonly CategoryGroupDto[];
    readonly formats: Formats;
    /** The zone the form reads and writes in: the record's own when it has a time, else the editor's (P192). */
    readonly zone: string;
    readonly now: Date;
    readonly shared?: SharedExpenseContext;
  },
): RecordInitial => {
  const found = tx.categoryId ? findCategory(input.groups, tx.categoryId) : null;
  const category: CategoryChoice = found
    ? found.parent
      ? { categoryId: found.parent.id, subcategoryId: found.category.id }
      : { categoryId: found.category.id, subcategoryId: null }
    : null;
  const wall =
    tx.occurredAt && tx.timeZone ? nowIn(new Date(tx.occurredAt), tx.timeZone).wall : nowIn(input.now, input.zone).wall;
  const kind = tx.type as RecordKind;
  const sharedExpense = kind === "EXPENSE" && input.shared !== undefined;
  return {
    kind,
    amount: typed(tx.amount.amount, tx.amount.currency, input.formats),
    description: tx.description,
    category: kind === "TRANSFER" ? null : category,
    accountId:
      kind === "INCOME"
        ? tx.destinationAccountId
        : kind === "TRANSFER"
          ? tx.sourceAccountId
          : (tx.payments[0]?.accountId ?? null),
    toAccountId: kind === "TRANSFER" ? tx.destinationAccountId : null,
    when: { date: tx.date, wall },
    split: sharedExpense ? splitOf(tx, input.shared!, input.formats) : null,
  };
};

/** The draft `requestOf` reads, as RecordForm builds it from its state. */
export const draftOf = (initial: RecordInitial, zone: string): RecordDraft => ({
  kind: initial.kind,
  amount: initial.amount,
  description: initial.description,
  category: initial.category,
  accountId: initial.accountId,
  toAccountId: initial.toAccountId,
  when: initial.when,
  timeZone: zone,
});
```

`edit/edit-request.ts`:

```ts
import type { TransactionDto } from "@/shared/ui/api/dto";

type Body = Readonly<Record<string, unknown>>;
const json = (value: unknown) => JSON.stringify(value ?? null);
const payerOf = (body: Body) =>
  json((body.payments as { memberId: string | null; accountId: string | null }[] | undefined)?.map(({ memberId, accountId }) => ({ memberId, accountId })));

/** Spec 7: the version as the strong ETag `etagOf` writes. */
export const ifMatchOf = (version: number): string => `"${version}"`;

/**
 * Ruling P192: the PATCH body: each key whose request differs from the one the untouched form builds. The time
 * travels whole and only when the person changed it (an untimed row's made-up time never travels). A new amount
 * on an expense with several shares re-sends the split, since the API keeps shares that would no longer add up.
 */
export const editBodyOf = (input: {
  readonly tx: TransactionDto;
  readonly baseline: Body;
  readonly current: Body;
  readonly whenChanged: boolean;
}): Record<string, unknown> => {
  const { tx, baseline, current } = input;
  const differs = (key: string) => json(baseline[key]) !== json(current[key]);
  const body: Record<string, unknown> = {};
  if (differs("description")) body.description = current.description ?? "";
  if (differs("amount")) body.amount = current.amount;
  if (differs("categoryId") && current.categoryId !== undefined) body.categoryId = current.categoryId;
  if (input.whenChanged) {
    body.date = current.date;
    body.occurredAt = current.occurredAt;
    body.timeZone = current.timeZone;
  }
  for (const key of ["accountId", "sourceAccountId", "destinationAccountId"] as const)
    if (differs(key) && current[key] !== undefined) body[key] = current[key];
  if (tx.type === "EXPENSE" && current.payments !== undefined && payerOf(baseline) !== payerOf(current))
    body.payments = current.payments;
  if (tx.type === "EXPENSE" && current.split && (differs("split") || (body.amount !== undefined && tx.shares.length > 1)))
    body.split = current.split;
  return body;
};
```

`edit/origin.ts`:

```ts
import { safeNext } from "@/shared/ui/navigation/auth-redirect";
import { withoutTx } from "../detail/tx-href";

/** Ruling P191: an edit returns to the list or home of its own space it came from; anything else, to the list. */
export const originOf = (from: string | undefined, spaceId: string): string => {
  const fallback = `/spaces/${spaceId}/transactions`;
  const safe = safeNext(from);
  const own = `/spaces/${spaceId}`;
  if (safe === "/" || !(safe === own || safe.startsWith(`${own}?`) || safe.startsWith(`${own}/`))) return fallback;
  return withoutTx(safe);
};
```

`record-form.tsx`:
- Import `type RecordInitial` from `../edit/edit-initial` as a type only, so no runtime code of the edit modules enters the record route.
- Add the `RecordEdit` interface and the `edit` prop.
- State initializers read `edit?.initial`:
  - `kind`: `edit?.initial.kind ?? initialKind`;
  - `amount`, `description`, `category`, `accountId` and `toAccountId` likewise;
  - `chosenWhen`: `edit?.initial.when ?? null`;
  - `split`: `edit?.initial.split ?? (shared ? initialSplitDraft(shared) : null)`.
- `canSplit` adds `&& !edit`.
- The `Tabs.List` renders only without `edit`. With `edit`, render `<p className="text-sm text-muted">{t("edit.kind", { type: t(`type.${kind}`) })}</p>` above `Tabs.Content`, keeping `Tabs.Root` and `Tabs.Content` so the layout is identical.
- `ScreenHeader` takes `backHref={edit?.backHref ?? `/spaces/${space.id}`}` and `title={edit ? t("edit.title") : t("form.title")}`.
- The save label: `edit ? t("edit.save") : t(`form.save.${…}`)`.
- In `submit`, after the built check:

```ts
      if (edit) {
        const failed = await edit.onSave({ kind: built.kind, body: built.body }, { when });
        if (failed) {
          setProblem(failed);
          setPending(false);
        }
        return;
      }
```

- Under the form-level `ProblemNotice`: `{problem && where === "form" && edit?.problemAction ? edit.problemAction(problem) : null}`.
- `SharedFields` gets `defaultSplit={!edit}`.

`shared-fields.tsx`: `defaultSplit = true` in the props. Pass `enabled: defaultSplit` to `useDefaultSplit`, and skip the preselection effect when `!defaultSplit`.

- [ ] **Step 4: Run the tests to verify they pass**

Run:
- `pnpm exec vitest run --project unit src/modules/ledger/ui`
- `pnpm exec vitest run --project ui src/modules/ledger/ui`
- every gate.

Expected: PASS. Every existing record-form test passes unchanged, and `pnpm build` shows `/spaces/[spaceId]/new` without the `edit/` modules (`next build`'s route table; the e2e perf run in Task A10 confirms).

Mutation checks:
- send the time when `!whenChanged`: the "made up time" case fails;
- drop `tx.shares.length > 1`: the "amount of a split expense" case fails;
- in `percentsOf`, floor instead of rounding: the SHARES row ("66,67", "33,33") fails;
- drop the last-participant correction: add a three-way PERCENT case (100,000 among three, shares 33,334 / 33,333 / 33,333) whose prefilled percents must add to 100, if no test fails without it.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ledger/ui/edit src/modules/ledger/ui/record src/modules/ledger/ui/split/shared-fields.tsx src/i18n/messages
git commit -m "feat(ledger): prefill the record form from a transaction and send only what changed (Refs #71, Refs #74)"
```

Risk: none.

---

### Task A8: The edit route, saving with If-Match, and a version conflict

Rulings P191 and P193. `/spaces/{spaceId}/transactions/{transactionId}/edit?from=<origin>`:
- It renders `EditTransactionContainer`, which loads the transaction, the space's active accounts plus the transaction's current account even when archived, the categories with archived ones (so an old category still names itself), and, in a shared or direct space, `loadSharedContext`.
- When `actionsFor` gives no `edit`, it redirects to `withTx(origin, id)`.
- `EditTransactionForm` (client) computes `initial` with `initialOf` and the baseline once, with `requestOf(draftOf(initial, zone), …)`, and renders `RecordForm` with `edit`.

Saving:
- With an empty body, it returns to the origin with no request and no toast.
- Otherwise it sends `PATCH` with `If-Match: ifMatchOf(tx.version)` and the body from `editBodyOf`. On 200: `router.replace(origin)`, `router.refresh()` and the toast `ledger.toast.edited`.
- On a problem, it returns the problem to the form.
  - `PreconditionFailed` shows `errors.PreconditionFailed` with the button `ledger.edit.reload` and the line `ledger.edit.reloadNote`.
  - The button calls `router.refresh()`. The page passes `key={tx.version}` to the form, so the newest version remounts it with fresh values.

Volver leads to `withTx(origin, id)`, the sheet the person came from.

**Files:**
- Create: `src/modules/ledger/ui/edit/{edit-container.tsx, edit-transaction-form.tsx, edit-transaction-form.test.tsx}`, `src/app/(web)/(app)/spaces/[spaceId]/transactions/[transactionId]/edit/page.tsx`
- Modify: `src/modules/ledger/ui/server.ts`, `src/i18n/messages/{es,en}.json`

**Interfaces:**
- Consumes: `initialOf`, `draftOf`, `editBodyOf`, `ifMatchOf`, `originOf`, `withTx`, `actionsFor`, `loadSharedContext`, `requestOf`, `RecordForm`, `useToast`, `browserTimeZone`.
- Produces:
  - `loadEditContext(api, input: { spaceId: string; transactionId: string }): Promise<Loaded<EditContext | null>>`;
  - `EditTransactionContainer({ spaceId, transactionId, from })`;
  - `EditTransactionForm({ space, tx, accounts, groups, formats, profileZone, shared?, origin, api? })`.

Catalog keys:

| Key | es | en |
|---|---|---|
| `ledger.toast.edited` | Cambios guardados | Changes saved |
| `ledger.edit.reload` | Cargar la última versión | Load the latest version |
| `ledger.edit.reloadNote` | Se descartarán los cambios que escribiste. | The changes you typed will be discarded. |

- [ ] **Step 1: Write the failing tests**

`src/modules/ledger/ui/edit/edit-transaction-form.test.tsx`. Use the router mock, fake Date at 2026-11-01T04:30:00Z and `ToastProvider` around the form, with:

```tsx
const tx = transactionDto({
  id: "t-1",
  type: "EXPENSE",
  description: "Market",
  amount: cop(85_000),
  date: "2026-10-31",
  occurredAt: "2026-10-31T17:30:00.000Z",
  timeZone: "America/Bogota",
  categoryId: "c-groceries",
  payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(85_000) }],
  shares: [{ memberId: "m-ana", amount: cop(85_000), splitMethod: "EQUAL" }],
  version: 2,
});

describe("edit a transaction (rulings P191, P193)", () => {
  it("sends only the new amount with If-Match, returns to the list and says Cambios guardados", async () => {
    const { api, requests } = fakeApi({
      "PATCH /api/v1/spaces/{spaceId}/transactions/{transactionId}": () => jsonResponse({ ...tx, amount: cop(95_000), version: 3 }),
    });
    renderForm(api, "/spaces/s-1/transactions?period=2026-10");
    await userEvent.clear(screen.getByLabelText("Monto"));
    await userEvent.type(screen.getByLabelText("Monto"), "95000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    const [request] = requests;
    expect(request!.method).toBe("PATCH");
    expect(request!.headers.get("if-match")).toBe('"2"');
    expect(await request!.json()).toEqual({ amount: { amount: "9500000", currency: "COP" } });
    expect(router.replace).toHaveBeenCalledWith("/spaces/s-1/transactions?period=2026-10");
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Cambios guardados");
  });

  it("goes back without a request or a toast when nothing changed", async () => {
    // click Guardar cambios at once → requests [], router.replace(origin), status empty
  });

  it("moves the date with its time in the record's zone", async () => {
    // when chip → "Ayer" → Aplicar; body { date: "2026-10-30", occurredAt: "2026-10-30T17:30:00.000Z", timeZone: "America/Bogota" }
    // (read DateTimeSheet's button names from record-form.test.tsx's date tests)
  });

  it("shows a version conflict with a way to load the latest version, and saves nothing", async () => {
    // PATCH → problemResponse(412, "PreconditionFailed"); the text "Alguien cambió esto mientras lo editabas. …",
    // "Se descartarán los cambios que escribiste." and the button "Cargar la última versión" → router.refresh(); no replace, no toast
  });

  it("shows a field's problem next to it (P118)", async () => {
    // PATCH → problemResponse(422, "AccountNotOwned") → the account picker's error "Solo el dueño de esa cuenta …"
  });

  it("has a way back to the sheet it came from", () => {
    // link "Volver" href "/spaces/s-1/transactions?period=2026-10&tx=t-1"
  });
});
```

Write the elided bodies in full; every value is stated. `renderForm(api, origin)` renders `<ToastProvider><EditTransactionForm space={spaceDto({ id: "s-1" })} tx={tx} accounts={accounts} groups={groups} formats={BUILT_IN_FORMATS} profileZone="America/Bogota" origin={origin} api={api} /></ToastProvider>`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project ui src/modules/ledger/ui/edit/edit-transaction-form.test.tsx`
Expected: FAIL. `./edit-transaction-form` cannot be resolved.

- [ ] **Step 3: Implement**

`edit-transaction-form.tsx` (`"use client"`):

```tsx
export function EditTransactionForm({ space, tx, accounts, groups, formats, profileZone, shared, origin, api: injected }: {
  readonly space: SpaceDto;
  readonly tx: TransactionDto;
  readonly accounts: readonly AccountDto[];
  readonly groups: readonly CategoryGroupDto[];
  readonly formats: Formats;
  readonly profileZone: string;
  readonly shared?: SharedExpenseContext;
  readonly origin: string;
  readonly api?: Api;
}) {
  const t = useTranslations("ledger");
  const router = useRouter();
  const toast = useToast();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  // P192: a timed row is read and written in its own zone; an untimed one in the editor's.
  const zone = tx.timeZone ?? profileZone;
  const [initial] = useState(() => initialOf(tx, { groups, formats, zone, now: new Date(), ...(shared ? { shared } : {}) }));
  const [baseline] = useState(() => {
    const memberIds = shared?.members.map((m) => m.id) ?? [];
    const built = requestOf(draftOf(initial, zone), space.currency, formats.numberFormat,
      initial.split ? { split: initial.split, memberIds } : undefined);
    return built.ok ? built.body : {};
  });
  const onSave = async (built: { kind: RecordKind; body: Record<string, unknown> }, state: { when: When }) => {
    const whenChanged = JSON.stringify(state.when) !== JSON.stringify(initial.when);
    const body = editBodyOf({ tx, baseline, current: built.body, whenChanged });
    if (Object.keys(body).length === 0) {
      router.replace(origin);
      return null;
    }
    try {
      const { error, response } = await api.PATCH("/api/v1/spaces/{spaceId}/transactions/{transactionId}", {
        params: { path: { spaceId: space.id, transactionId: tx.id }, header: { "if-match": ifMatchOf(tx.version) } },
        body: body as never,
      });
      if (response.ok) {
        router.replace(origin);
        router.refresh();
        toast.show({ message: t("toast.edited") });
        return null;
      }
      return problemFrom(error, response);
    } catch (error) {
      return problemFrom(error, undefined);
    }
  };
  return (
    <RecordForm
      space={space} accounts={accounts} groups={groups} formats={formats} initialKind={initial.kind}
      initialNow={new Date().toISOString()} timeZone={zone} profileZone={profileZone} api={api}
      {...(shared ? { shared } : {})}
      edit={{
        initial,
        backHref: withTx(origin, tx.id),
        onSave,
        problemAction: (problem) =>
          problem.code === "PreconditionFailed" ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted">{t("edit.reloadNote")}</p>
              <Button variant="secondary" onClick={() => router.refresh()}>{t("edit.reload")}</Button>
            </div>
          ) : null,
      }}
    />
  );
}
```

(The `RecordForm` mounts with `timeZone={zone}`, so its own clock and the baseline agree. The when-chip shows the row's own zone.)

`edit-container.tsx`:
- `loadEditContext(api, { spaceId, transactionId })` reads, in parallel:
  - `getMe()`, `getSpaces()`;
  - `GET …/transactions/{transactionId}`;
  - `GET …/accounts?archived=true`;
  - `GET …/categories?archived=true`.
- It answers `null` data for a missing transaction (the page calls `notFound()`).
- The accounts given to the form are the active ones, plus the transaction's current accounts even when archived (so an untouched archived account still shows its name and the diff sends nothing for it).
- In a shared or direct space it adds `loadSharedContext(api, { spaceId, meUserId, personalSpaceId: personalSpaceOf(spaces).id, spaceAccounts })` and the members.

`EditTransactionContainer({ spaceId, transactionId, from })`:
- `const origin = originOf(from, spaceId);`
- when `actionsFor(tx, viewer, members).edit` is false, `redirect(withTx(origin, transactionId))`;
- else `<EditTransactionForm key={tx.version} … origin={origin} />` inside `<div className="mx-auto max-w-[560px]">`.

`src/app/(web)/(app)/spaces/[spaceId]/transactions/[transactionId]/edit/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { EditTransactionContainer } from "@/modules/ledger/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("ledger.edit"))("title") };
}

/** Ruling P191: edit a transaction; `?from=` is where it was opened (the list with its filter, or the home). */
export default async function EditTransactionPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string; transactionId: string }>;
  readonly searchParams: Promise<{ from?: string }>;
}) {
  const [{ spaceId, transactionId }, { from }] = await Promise.all([params, searchParams]);
  return <EditTransactionContainer spaceId={spaceId} transactionId={transactionId} from={from} />;
}
```

`server.ts`: `export { EditTransactionContainer } from "./edit/edit-container";`.

**Split point** (over ~500 lines):
1. `edit-transaction-form.tsx` and its test (about 280 lines): `feat(ledger): save an edited transaction with If-Match and reload on a conflict (Refs #71)`.
2. The container, the page and `server.ts`: `feat(ledger): add the edit route of a transaction (Refs #71)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run:
- `pnpm exec vitest run --project ui src/modules/ledger/ui`
- every gate including `pnpm build && pnpm test:e2e`.

Expected: PASS.

Mutation checks:
- drop the `if-match` header: the first test fails;
- send `built.body` instead of `editBodyOf(…)`: the first test's body assertion fails;
- drop `key={tx.version}`: covered by the e2e conflict scenario of Task A9 (the reloaded form must show the other change).

- [ ] **Step 5: Commit**

```bash
git add src/modules/ledger/ui src/app/(web)/(app)/spaces/[spaceId]/transactions/[transactionId] src/i18n/messages
git commit -m "feat(ledger): edit a transaction with If-Match and reload on a conflict (Refs #71)"
```

Risk: none.

---

### Task A9: The @e2e scenarios: fix a mistake, undo a delete, a version conflict, save feedback

Ruling P199. Two files change:
- a new feature `tests/e2e/features/edit-delete.feature`, with its steps in `tests/e2e/steps/edit.steps.ts`;
- one more scenario in `shared-expense.feature`.

The World keeps the ids of the transactions a scenario records (`World.transactions`). Clocks follow P178: the browser's clock is fixed inside the server's fixed period.

**Files:**
- Create: `tests/e2e/features/edit-delete.feature`, `tests/e2e/steps/edit.steps.ts`
- Modify: `tests/e2e/features/shared-expense.feature`, `tests/e2e/steps/shared.steps.ts`, `tests/e2e/support/world.ts`

**Interfaces:**
- Consumes: the ledger Background step (`ledger.steps.ts`), `World.record`, `World.api`, `World.t`, `minor`, `shown`, the shared Background (`shared.steps.ts`).
- Produces:
  - `World.transactions: Map<string, string>` (description → id);
  - `World.recordExpense(description: string, pesos: string, category: string, account: string): Promise<string>`.

- [ ] **Step 1: Write the scenarios (they fail: no rows link, no sheet)**

`tests/e2e/features/edit-delete.feature`:

```gherkin
Feature: Fix a mistake in a transaction

  Background:
    Given "Ana" is signed in with the timezone "America/Bogota", the account "Bancolombia" with opening balance 2,000,000 COP and the category "Groceries" in her personal space
    And the Clock reads 2026-11-01T04:30:00Z
    And "Ana" recorded "Market" for 85,000 COP in "Groceries" from "Bancolombia"

  @e2e
  Scenario: Edit an expense from its detail sheet
    When "Ana" opens "Market" from the transaction list
    Then the detail sheet shows "Gasto", 85,000 COP, "Groceries" and "Bancolombia"
    When "Ana" chooses "Editar", changes the amount to 95,000 COP and the description to "Supermarket" and saves
    Then the status message reads "Cambios guardados"
    And the transaction list shows "Supermarket" with 95,000 COP
    And the accounts screen shows "Bancolombia" with a balance of 1,905,000 COP

  @e2e
  Scenario: Delete an expense and undo it
    When "Ana" opens "Market" from the transaction list and chooses "Eliminar"
    Then the status message reads "Gasto eliminado" with the action "Deshacer"
    And "Market" is not in the transaction list
    When "Ana" chooses "Deshacer"
    Then the status message reads "Gasto restaurado"
    And the transaction list shows "Market" with 85,000 COP
    And the accounts screen shows "Bancolombia" with a balance of 1,915,000 COP

  @e2e
  Scenario: A version conflict asks to load the latest version
    Given "Ana" opened the edit form of "Market"
    And "Market" was renamed to "Market (Ana's phone)" somewhere else
    When "Ana" changes the amount to 90,000 COP and saves
    Then the form shows the message of the key "errors.PreconditionFailed"
    And the amount of "Market" is still 85,000 COP
    When "Ana" chooses "Cargar la última versión"
    Then the form shows the description "Market (Ana's phone)" and the amount 85,000 COP

  @e2e
  Scenario: Recording an expense says it was saved
    When "Ana" opens the new expense form
    And "Ana" enters "Bakery", 12,000 COP, "Groceries" and "Bancolombia" and saves
    Then the status message reads "Gasto guardado"
```

Append to `tests/e2e/features/shared-expense.feature`:

```gherkin
  @e2e
  Scenario: Correct the amount of a shared expense split equally
    Given "Ana" recorded "Groceries" in "Household" for 300,000 COP paid from "Bancolombia", split equally between "Ana" and "Juan"
    When "Ana" opens "Groceries" from the "Household" transaction list
    Then the detail sheet lists 150,000 COP for "Ana" and 150,000 COP for "Juan"
    When "Ana" chooses "Editar", changes the amount to 400,000 COP and saves
    Then the status message reads "Cambios guardados"
    And "Groceries" in "Household" has shares of 200,000 COP for "Ana" and 200,000 COP for "Juan"
```

- [ ] **Step 2: Write the steps**

`tests/e2e/support/world.ts`, add:

```ts
  readonly transactions = new Map<string, string>();

  /** An expense through the API at 2026-10-31 12:00 Bogotá, inside the server's fixed period (P178). */
  async recordExpense(description: string, pesos: string, category: string, account: string): Promise<string> {
    const recorded = (await this.record("expenses", {
      description,
      date: "2026-10-31",
      occurredAt: "2026-10-31T17:00:00.000Z",
      timeZone: "America/Bogota",
      categoryId: this.categories.get(category),
      amount: { amount: minor(pesos), currency: "COP" },
      accountId: this.accounts.get(account),
    })) as { id: string };
    this.transactions.set(description, recorded.id);
    return recorded.id;
  }
```

(`minor` is imported from `./money`.)

`tests/e2e/steps/edit.steps.ts`:

```ts
import { expect, type Page } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures";
import { minor, shown } from "../support/money";
import type { World } from "../support/world";

const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();
const list = (world: World) => `/spaces/${world.user!.spaceId}/transactions`;
const sheet = (page: Page) => page.getByRole("dialog");
const openRow = async (page: Page, world: World, description: string) => {
  await page.goto(list(world));
  await page.getByRole("link", { name: new RegExp(`^${description}`) }).click();
  await expect(sheet(page)).toBeVisible();
};

Given(
  /^"([^"]+)" recorded "([^"]+)" for ([\d,]+) COP in "([^"]+)" from "([^"]+)"$/,
  async ({ world }, _name: string, description: string, pesos: string, category: string, account: string) => {
    await world.recordExpense(description, pesos, category, account);
  },
);

When(/^"([^"]+)" opens "([^"]+)" from the transaction list$/, async ({ page, world }, _n: string, description: string) =>
  openRow(page, world, description),
);

When(
  /^"([^"]+)" opens "([^"]+)" from the transaction list and chooses "([^"]+)"$/,
  async ({ page, world }, _n: string, description: string, action: string) => {
    await openRow(page, world, description);
    await sheet(page).getByRole("button", { name: action }).click();
  },
);

Then(
  /^the detail sheet shows "([^"]+)", ([\d,]+) COP, "([^"]+)" and "([^"]+)"$/,
  async ({ page }, type: string, pesos: string, category: string, account: string) => {
    const text = norm(await sheet(page).textContent());
    for (const part of [type, norm(shown(pesos)), category, account]) expect(text).toContain(part);
  },
);

When(
  /^"([^"]+)" chooses "Editar", changes the amount to ([\d,]+) COP(?: and the description to "([^"]+)")? and saves$/,
  async ({ page }, _n: string, pesos: string, description?: string) => {
    await sheet(page).getByRole("link", { name: "Editar" }).click();
    await expect(page.locator("[data-ready='true']")).toBeAttached();
    await page.getByLabel("Monto").fill(pesos.replaceAll(",", ""));
    if (description) await page.getByLabel("Descripción").fill(description);
    await page.getByRole("button", { name: "Guardar cambios" }).click();
  },
);

Then(/^the status message reads "([^"]+)"$/, async ({ page }, message: string) => {
  await expect(page.getByRole("status").filter({ hasText: message })).toBeVisible();
});

Then(/^the status message reads "([^"]+)" with the action "([^"]+)"$/, async ({ page }, message: string, action: string) => {
  const status = page.getByRole("status").filter({ hasText: message });
  await expect(status).toBeVisible();
  await expect(status.getByRole("button", { name: action })).toBeVisible();
});

When(/^"([^"]+)" chooses "Deshacer"$/, async ({ page }) => {
  await page.getByRole("status").getByRole("button", { name: "Deshacer" }).click();
});

Then(/^"([^"]+)" is not in the transaction list$/, async ({ page }, description: string) => {
  await expect(page.getByRole("link", { name: new RegExp(`^${description}`) })).toHaveCount(0);
});

Then(/^the transaction list shows "([^"]+)" with ([\d,]+) COP$/, async ({ page, world }, description: string, pesos: string) => {
  if (!new URL(page.url()).pathname.endsWith("/transactions")) await page.goto(list(world));
  const row = page.getByRole("listitem").filter({ hasText: description });
  await expect(row).toBeVisible();
  expect(norm(await row.textContent())).toContain(norm(shown(pesos)));
});

Given(/^"([^"]+)" opened the edit form of "([^"]+)"$/, async ({ page, world }, _n: string, description: string) => {
  const id = world.transactions.get(description)!;
  await page.goto(`${list(world)}/${id}/edit?from=${encodeURIComponent(list(world))}`);
  await expect(page.locator("[data-ready='true']")).toBeAttached();
});

Given(/^"([^"]+)" was renamed to "([^"]+)" somewhere else$/, async ({ world }, description: string, renamed: string) => {
  const id = world.transactions.get(description)!;
  await world.api.patch(`/api/v1/spaces/${world.user!.spaceId}/transactions/${id}`, { description: renamed });
});

When(/^"([^"]+)" changes the amount to ([\d,]+) COP and saves$/, async ({ page }, _n: string, pesos: string) => {
  await page.getByLabel("Monto").fill(pesos.replaceAll(",", ""));
  await page.getByRole("button", { name: "Guardar cambios" }).click();
});

Then(/^the form shows the message of the key "([^"]+)"$/, async ({ page, world }, key: string) => {
  await expect(page.getByText(world.t(key))).toBeVisible();
});

Then(/^the amount of "([^"]+)" is still ([\d,]+) COP$/, async ({ world }, description: string, pesos: string) => {
  const id = world.transactions.get(description)!;
  const tx = (await world.api.get(`/api/v1/spaces/${world.user!.spaceId}/transactions/${id}`)) as { amount: { amount: string } };
  expect(tx.amount.amount).toBe(minor(pesos));
});

When(/^"([^"]+)" chooses "Cargar la última versión"$/, async ({ page }) => {
  await page.getByRole("button", { name: "Cargar la última versión" }).click();
});

Then(
  /^the form shows the description "([^"]+)" and the amount ([\d,]+) COP$/,
  async ({ page }, description: string, pesos: string) => {
    await expect(page.getByLabel("Descripción")).toHaveValue(description);
    await expect(page.getByLabel("Monto")).toHaveValue(norm(shown(pesos)).replace(/^\$\s?/, ""));
  },
);
```

(When `shown(pesos)` already gives the amount field's own text, use that and drop the `replace`. Read `support/money.ts` first.)

In `shared.steps.ts`, add the three shared steps:
- "recorded … split equally between": through the API with `payments` and `split` EQUAL, the World's people and the household space id;
- "opens … from the "Household" transaction list": `page.goto("/spaces/<household>/transactions")`, then click the row link;
- "has shares of …": `GET` the transaction and compare `shares` with `minor(pesos)` per member id.

"the detail sheet lists … for … and …" reads the sheet's `División` list items. Use the helpers `shared.steps.ts` already has for the household's id and members.

- [ ] **Step 3: Run the scenarios**

Run: `pnpm build && pnpm test:e2e -- --grep "Fix a mistake|Correct the amount"`
Expected: PASS for all five (Tasks A1–A8 are in).

Run: `pnpm test:e2e`
Expected: the whole suite passes.

Mutation checks:
- stub `editBodyOf` to return `{}` in a scratch build: the edit scenario fails;
- drop `router.refresh()` after restore: the undo scenario fails.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e
git commit -m "test(web): edit, delete with undo and a version conflict, end to end (Refs #71, Refs #74)"
```

Risk: none.

---

### Task A10: Layout, axe and budgets of the sheet, the edit route and the toast

Ruling P198. The new screens join the guards every screen meets:
- `tests/e2e/layout.spec.ts`:
  - the detail sheet joins `sheets` (width, last control on top, short phone);
  - the edit route joins the reflow paths at 390 and 320 px, with and without the wide font;
  - the edit route joins the "way back" screens; its parent is the list (pathname `/spaces/<id>/transactions`; the query brings the sheet back);
  - a toast test is new: after a delete, at 390 and 320 px:
    - the toast fits the width and its bottom is above the navigation's top;
    - it does not cover Registrar;
    - Deshacer and the close button are at least 44 × 44 px and topmost at their centres;
    - a long English message wraps instead of widening the page.
- `tests/e2e/a11y-edit.spec.ts` scans in light and dark:
  - the list with the sheet open, for a personal and a shared expense;
  - the edit route;
  - the list with the undo toast shown.
- `tests/performance/budgets.json` gains the two routes of P198, and `lighthouse.mjs` seeds `tx`.

**Files:**
- Create: `tests/e2e/a11y-edit.spec.ts`
- Modify: `tests/e2e/layout.spec.ts`, `tests/performance/budgets.json`, `tests/performance/lighthouse.mjs`, `tests/performance/budgets.test.mjs`

**Interfaces:**
- Consumes: `session`, `sheets`, `overflowReport`, `settle`, `lastControlIsOnTop`, `TARGET` (`layout.spec.ts`); `routeUrl`, `isVisitorRoute` (M6b Task 21).
- Produces:
  - budgets `"/spaces/:id/transactions?tx=:tx": 235` and `"/spaces/:id/transactions/:tx/edit": 210`;
  - the seeded id `tx` (the first of the twenty expenses).

- [ ] **Step 1: Write the checks (they fail until wired: no `tx` id, no entries)**

In `layout.spec.ts`, add to `sheets`:

```ts
  {
    name: "transaction detail sheet",
    path: "transactions",
    open: async (page) => {
      await page.getByRole("link", { name: /^Market/ }).first().click();
      await expect(page.getByRole("link", { name: es.ledger.detail.edit })).toBeVisible();
    },
  },
```

(`session` seeds a "Market" expense in the personal space, the way `seedLong` and `seedLedger` already record expenses. If it seeds none, record one there with the same body as `seedLong`'s expense and the description "Market".)

Add to the reflow paths `editPath`, and to the "way back" screens:

```ts
    { name: "edit a transaction", at: ids.edit, parent: `/spaces/${ids.spaceId}/transactions` },
```

where `edit` (built in the test from the seeded expense's id) is `/spaces/${spaceId}/transactions/${txId}/edit?from=${encodeURIComponent(`/spaces/${spaceId}/transactions`)}`.

The toast test:

```ts
test.describe("the toast sits above the navigation and never covers Registrar (ruling P195)", () => {
  for (const viewport of [PHONE, SMALL_PHONE]) {
    test(`after a delete at ${viewport.width} px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const { spaceId } = await session(page, `toast-${viewport.width}`);
      await page.goto(`/spaces/${spaceId}/transactions`);
      await page.getByRole("link", { name: /^Market/ }).first().click();
      await page.getByRole("button", { name: es.ledger.detail.delete }).click();
      const toast = page.getByTestId("toast");
      await expect(toast).toBeVisible();
      const box = (await toast.boundingBox())!;
      const nav = (await page.locator("nav[aria-label]").boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(nav.y);
      for (const name of [es.ledger.toast.undo, es.toast.dismiss]) {
        const control = page.getByTestId("toast").getByRole("button", { name });
        const target = (await control.boundingBox())!;
        expect.soft(target.width, name).toBeGreaterThanOrEqual(TARGET);
        expect.soft(target.height, name).toBeGreaterThanOrEqual(TARGET);
        expect.soft(
          await control.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const top = window.paintedAt(r.left + r.width / 2, r.top + r.height / 2);
            return top !== null && el.contains(top) ? "ok" : `covered by <${top?.tagName ?? "nothing"}>`;
          }),
          name,
        ).toBe("ok");
      }
      const record = page.locator("nav[aria-label]").getByRole("link", { name: es.shell.nav.record });
      const fab = (await record.boundingBox())!;
      expect(fab.y).toBeGreaterThanOrEqual(box.y + box.height);
      const { overflow, message } = await overflowReport(page, "the toast");
      expect(overflow, message).toBeLessThanOrEqual(0);
    });
  }
});
```

(Read the navigation's Registrar link name from `nav-links.tsx`'s key, `shell.nav.record` or its actual key, and use that.)

`tests/e2e/a11y-edit.spec.ts`. Same shape as `a11y.spec.ts`: `WCAG` tags, both color schemes, and `signUp` and `seedLedger` from `./support/seed`. Then:
- open the first row of `/spaces/<id>/transactions` and scan "detail sheet";
- follow Editar and scan "edit a transaction" (after `[data-ready='true']`);
- go back to the list, open the row, choose Eliminar, wait for the toast and scan "undo toast";
- for the shared sheet, create a shared space with one EQUAL expense through `post` (as `layout.spec.ts`'s `session` does) and scan its sheet.

`tests/performance/budgets.json`, add:

```json
    "/spaces/:id/transactions?tx=:tx": 235,
    "/spaces/:id/transactions/:tx/edit": 210
```

`lighthouse.mjs`: in the seeding block, keep the first expense's id from the loop (`const first = …` on `i === 0`) and add `tx: first.id` to `ids`. `budgets.test.mjs` adds the expectations:
- `routeUrl("/spaces/:id/transactions/:tx/edit", ids)` is `/spaces/<id>/transactions/<tx>/edit`;
- `routeUrl("/spaces/:id/transactions?tx=:tx", ids)` keeps its query.

- [ ] **Step 2: Run them**

Run: `pnpm build && pnpm test:e2e && pnpm perf`
Expected: PASS.

The two new budgets are planning figures. Set each from its measurement:
- the open sheet: its measurement rounded up to the next 5 KiB, at most 235;
- the edit route: at most 210.

A measurement above its cap is fixed by lazy loading (P198), never by a higher number. `/spaces/:id/new` stays ≤ 205 and `/spaces/:id/transactions` ≤ 205.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e tests/performance
git commit -m "ci(web): cover the detail sheet, the edit form and the toast with layout, axe and budgets (Refs #71)"
```

Risk: none.

---

### Task A11: The addendum's documentation

**Files:**
- Modify:
  - `docs/decisions/README.md` (rulings P184–P199 in the index, the range line);
  - `docs/backlog/E9-web-ui.md` ("Follow-ups after M6a" item 2 marked done with a link to this plan);
  - `docs/backlog/E4-ledger.md` (HU-E4-06's technical notes: the restore endpoint and the editable parts);
  - `docs/README.md` (if it lists plans);
  - `mkdocs.yml` (the nav entry "M6b addendum: edit, delete and feedback" after M6b's).

- [ ] **Step 1: Write the docs**
  - `docs/decisions/README.md`: add rows P184–P199 with the one-line summaries of this plan's "Rulings", the source "Rulings, <n>", and extend the range sentence with "the M6b addendum P184–P199".
  - HU-E4-06's technical notes gain two bullets:
    - "Ruling P185: `POST …/transactions/{transactionId}/restore` undoes a deletion with the delete's guards and audits `RESTORED`."
    - "Ruling P186: `PATCH` also takes `accountId`, `payments`, `split`, `sourceAccountId` and `destinationAccountId`; settlements and fund contributions answer `FieldNotEditable`."
  - E9 follow-up 2 reads: "Done in the M6b addendum ([plan](../superpowers/plans/2026-10-21-m6b-addendum-edit-delete-feedback.md))."

- [ ] **Step 2: Verify**

Run: `pnpm exec prettier --check docs mkdocs.yml`, then `mkdocs build --strict` if MkDocs is installed (CI runs it).
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add docs mkdocs.yml
git commit -m "docs: record the edit, delete and save-feedback addendum (Refs #71)"
```

Risk: none.

---

## Self-Review

### Coverage of the requested scope

| Requirement (controller's brief, L2) | Covered by |
|---|---|
| Tapping a row in Movimientos or the home's recent list opens a sheet | Task A5 (`TransactionRow.href`, `withTx`, the host on the list, "Cargar más" and home) |
| The sheet shows type, amount, date and time, category path, account, description, payer; a shared expense's split per participant; Editar and Eliminar | Task A5 (`TransactionSheet` definitions, División list, `actionsFor`) |
| Editar opens the record form prefilled: amount, description, category, account, date and time, payer and split | Task A7 (`initialOf`, `RecordForm.edit`), Task A8 (the route) |
| Saving uses the edit API with `If-Match` and the ETag | Task A8 (`ifMatchOf(tx.version)`, the PATCH), Task A7 (`editBodyOf`) |
| The real endpoints, payloads and concurrency errors | Baseline facts; the API cannot change accounts, payers or splits, so Tasks A2–A3 extend `PATCH` (P186) |
| A version conflict shows a clear message and lets the user reload | Task A8 (`errors.PreconditionFailed` plus "Cargar la última versión" → `router.refresh()`, `key={tx.version}`), Task A9 (e2e) |
| Recurrence-generated transactions keep the API's rule | P197: the API enforces none; untimed rows get a time only when the person changes it (Task A7's `whenChanged`) |
| Transfers and income as the API allows | Task A2 (income account, own transfer's accounts), Task A5 (`actionsFor` for income and transfer), Task A7 (prefill of both) |
| Eliminar removes through the API, logically | Task A6 (`DELETE`, D8) |
| A toast with `role=status` and Deshacer, about 8 s | Task A4 (`TOAST_ACTION_MS = 8000`, status region), Task A6 |
| If the API has no restore, a minimal backend task with TDD, justified | Task A1 (P185, with its alternatives) |
| Save feedback after record, edit, settle-up ("Gasto guardado", "Cambios guardados", "Pago registrado") with `role=status` | Task A4 (record and settle-up), Task A8 (edit), P196 |
| One shared Toast and provider in `src/shared/ui`, no new dependency; prefer Radix Toast if exported | Task A4; Radix Toast is exported but rejected in P195 with the reasons |
| Above the bottom navigation, safe area, never covering the primary action | Task A4 (classes, test), Task A10 (layout test against the navigation and Registrar) |
| UI rules: a way back, phone width, 44 px targets, return-to-origin, the layout spec | Task A8 (Volver to the sheet), Task A5 (closing to the origin), Task A10 (sheets, reflow, way back, toast) |
| UX checklist: undo toasts instead of confirm dialogs; validation timing | Task A6 (no dialog; test asserts no `alertdialog`); the edit form keeps `RecordForm`'s validation (on save, next to the field, P118) |
| Neutral tú copy | Every catalog line ("Elimínalo y regístralo de nuevo", "Puedes eliminarlo", "Se descartarán los cambios que escribiste") |
| Each task about 400 lines, failing tests first | Sizes in the Execution Workflow; Step 1 of every task |
| @e2e for edit, delete with undo, a version conflict; layout and axe of the sheet and toast; script budgets; lazy sheet | Task A9, Task A10, Task A5 (`next/dynamic` host) |
| Rulings P184–P199; ask nothing | Below; "Open questions": none |

### Review Focus pins

| Review Focus | Pinned by |
|---|---|
| 1. Undo really undoes, and only once | Task A1 unit (version, audit, no-op, roles, member who left, closed period) and acceptance (balances, ETag, second restore); Task A6 (one restore for a double click, alert on failure) |
| 2. Who may move money through an edit | Task A2 unit (own account, archived, other's, guest, fund, OWNER on a member's, `FieldNotEditable`) and acceptance; Task A5 `actionsFor` |
| 3. A shared expense's new amount and split | Task A3 unit and acceptance (EQUAL 400k, PERCENT, refusal without split, non-member); Task A7 `initialOf` table and `editBodyOf` table; Task A9 e2e |
| 4. Only what changed travels | Task A7 `editBodyOf` table; Task A8 (only the amount, nothing changed, date in the row's zone, conflict) |
| 5. The sheet and the toast never trap or hide anything | Task A4 toast tests; Task A5 (close to origin, missing transaction); Task A10 layout and axe |

### Rulings

1. **Scope and order** (all tasks). **Ruled by the planner (P184):**
   - This addendum amends P179: editing, deleting and restoring transactions join M6b, on `development` after M6b's Task 22, inside the same pull request. Commits reference #71 (M6a's follow-up 2), #74 and #75.
   - Settlements and fund contributions are deleted and recorded again, never edited in place (P190).
   - Reasons: the journey review's "Fix a mistake: fail" blocks the stories' purpose, and the owner's L1 asks to finish the stories with what exists.
   - Alternative rejected: a separate milestone after M6c (the household screens would ship with uncorrectable mistakes).
2. **Restore endpoint** (Task A1). **Ruled by the planner (P185):**
   - `POST /api/v1/spaces/{spaceId}/transactions/{transactionId}/restore` runs the guards of `DELETE` (membership, `canModify`, open period, `ensureCurrentParties`).
   - It clears `deletedAt` with a compare-and-set on the version and audits `RESTORED`.
   - It answers 200 with the transaction and its ETag. A transaction that is not deleted is answered unchanged with no audit, so a repeated Deshacer is harmless.
   - There is no time window, and no `Idempotency-Key` (it is idempotent by nature).
   - Reasons: the API had no undo path, and D8 keeps the row, so a restore is the minimal honest undo. It also serves a future trash screen.
   - Alternatives rejected:
     - delaying the `DELETE` in the browser until the toast expires: the deletion is lost on a closed tab or a navigation, and other members see the row meanwhile;
     - an undo token valid for a few seconds: new state, and no benefit over a guarded restore.
3. **Editable parts** (Tasks A2, A3). **Ruled by the planner (P186):**
   - `PATCH` also takes:
     - `accountId`: an expense's shorthand, as when recording, or an income's receiving account;
     - `payments`: an expense's, resolved with recording's `resolvePayments`;
     - `split`: an expense's, recomputed with `splitShares` among the current members;
     - `sourceAccountId` and `destinationAccountId`: an own transfer's.
   - D9 holds: only an account's owner moves money from or into it, an income moves only by its receiver, and an own transfer only by its creator.
   - A changed amount with several shares and no `split` still answers `SharesDoNotMatchAmount` (HU-E4-06). `PATCH` reports no fund warnings (a follow-up).
   - Reasons: without it, no amount of a shared expense could be corrected, and no account or payer at all. The brief asks to edit them.
   - Alternatives rejected:
     - locking those fields: the journey still fails for shared spaces;
     - "delete and record again" from the form: two requests that are not atomic, and the audit loses the link between them.
4. **Audit vocabulary** (Tasks A1, A2). **Ruled by the planner (P187):**
   - The audit's `action` gains `RESTORED`. The column is `text`, so there is no migration, and the contract's enum grows by one value.
   - The audited values gain `sourceAccountId` and `destinationAccountId` for incomes, transfers and settlements, so a deletion's audit of those types now also lists their accounts. That is the only change of existing output.
5. **`FieldNotEditable`** (Task A2). **Ruled by the planner (P188):** 409, with the public detail `field`. It answers:
   - a part a type does not have;
   - any account of a settlement or a fund contribution;
   - `accountId` on a transfer, and `payments` or `split` on anything but an expense.

   Reason: a settlement's and a contribution's accounts belong to two parties and a fund. Changing them in place would need the settle-up rules again, while deleting and recording again keeps them.
6. **Detail sheet by address** (Task A5). **Ruled by the planner (P189):**
   - Rows are links to their page with `?tx=<id>` (`scroll={false}`). The container reads the transaction and, in a shared or direct space, the members.
   - The sheet loads with `next/dynamic` only then. Closing replaces the address with the origin, and Back closes it.
   - A missing or deleted transaction shows `errors.TransactionNotFound` inside the sheet.
   - Alternatives rejected:
     - client state on a button: lost on reload, and Back would leave the page;
     - a full detail page: the brief asks for a sheet, and it would add a route without an artboard.
7. **Sheet content and actions** (Task A5). **Ruled by the planner (P190):**
   - The definitions are:
     - type, amount, date and time (the record's zone with its city when it differs, "Sin hora" when untimed);
     - category path;
     - the account fields of the type;
     - description;
     - payer;
     - each share with the method.
   - An account the viewer cannot read is "Cuenta de {name}".
   - `actionsFor`:
     - both actions follow HU-E4-06's `canModify`;
     - Editar also needs the money to move through the viewer's own account, a guest's payment or the fund (D9);
     - settlements and fund contributions offer Eliminar with a note.
   - A control the viewer may not use is hidden, as in P158.
8. **Edit route and return-to-origin** (Tasks A7, A8). **Ruled by the planner (P191):**
   - The route is `/spaces/{spaceId}/transactions/{transactionId}/edit?from=<origin>`. `originOf` keeps only a same-space path (through `safeNext`), without `tx`, else the list.
   - Volver opens the sheet again. Saving replaces the address with the origin and shows "Cambios guardados".
   - `RecordForm` takes one `edit` prop (no kind tabs, no split with someone), and the edit modules are imported only by the edit route, which keeps the record route's budget (P198).
9. **Prefill and the diff body** (Task A7). **Ruled by the planner (P192):**
   - The amount is typed in the person's format, and a subcategory is shown under its parent.
   - A timed row is read and written in its own zone. An untimed row takes the editor's zone and current time, which is sent only if the person changes the date or time, and that gives the row its first time (E9 follow-up 2).
   - Splits prefill as follows:
     - EQUAL as EQUAL;
     - EXACT as EXACT;
     - PERCENT, SHARES and BY_ALLOCATION as PERCENT derived from the shares (two decimals, the last participant in join order completing 100.00);
     - the split counts as chosen, and the plan's default is not offered in an edit.
   - Only changed keys travel; the time travels whole. `payments` travel when the payer changed, and `split` when it changed or the amount changed on an expense with several shares.
   - Alternatives rejected:
     - sending the whole form: it would rewrite parts nobody touched, and the audit with them;
     - comparing with the transaction instead of a baseline request: percents and units cannot be compared to shares.
10. **Version conflict** (Task A8). **Ruled by the planner (P193):**
    - `If-Match` is the DTO's `version` as `"<version>"` (`ifMatchOf`, the same string `etagOf` writes).
    - A 412 shows `errors.PreconditionFailed`, the note that typed changes will be discarded, and "Cargar la última versión", which calls `router.refresh()`. The form is keyed by the version, so it remounts with the newest values.
    - Alternative rejected: merging the person's changes into the newer version (silent overwrites of another person's change).
11. **Delete with undo** (Task A6). **Ruled by the planner (P194):**
    - The delete runs at once, with no confirmation dialog (UX checklist 28). The sheet closes to the origin and refreshes, and a status toast with Deshacer stays 8 s.
    - Deshacer restores once and says so.
    - A refused delete keeps the sheet with the problem. A refused restore says so in the alert region.
12. **Toast** (Task A4). **Ruled by the planner (P195):**
    - `ToastProvider` and `useToast` live in `src/shared/ui`, mounted in a new `(app)/layout.tsx` above every space's layout.
    - It has two live regions that exist before any message (status for success, alert for failure) and one toast at a time.
    - Timing: 5 s plain, 8 s with an action. It pauses on hover and focus; Escape and its close button dismiss it, and F8 focuses it.
    - Position: above the bottom navigation and the safe area, under the sheets.
    - Outside a provider it does nothing.
    - Alternatives rejected:
      - Radix Toast 1.7.0: its announce node lives about 1 s, its card has no status role, and its `Collection`, `DismissableLayer` and `Portal` code would ship to every signed-in route, including the record route at 203 of 205 KiB;
      - a toast library: a new dependency.
13. **Save feedback** (Tasks A4, A8). **Ruled by the planner (P196):**
    - The messages:

      | Save | Toast |
      |---|---|
      | Recording an expense, or splitting with someone | "Gasto guardado" |
      | Recording an income | "Ingreso guardado" |
      | Recording a transfer | "Transferencia guardada" |
      | An edit | "Cambios guardados" |
      | Settle-up | "Pago registrado" |
      | A deletion | "<Type> eliminado/a" |
      | An undo | "<Type> restaurado/a" |

    - There is no toast when the saved-with-warning notice speaks (P170) or when an edit changed nothing.
14. **Recurring and untimed rows** (Tasks A5, A7). **Ruled by the planner (P197):**
    - The API gives recurrence-generated transactions no special rule.
    - Editing changes that transaction only, never its recurrence.
    - Deleting leaves its occurrence `RECORDED`, and restoring brings the same row back.
    - Their rows have no time until an edit gives them one (P192).
15. **Budgets** (Tasks A4, A10). **Ruled by the planner (P198), under the owner's standing delegation of P154 and P177:**
    - `/spaces/:id/transactions?tx=:tx` 235 KiB (the list plus the lazily loaded sheet and the Radix dialog);
    - `/spaces/:id/transactions/:tx/edit` 210 KiB (the record form plus the edit modules);
    - both are set from their measurements, never above these caps;
    - `/spaces/:id/new` stays 205 with the toast provider, the card moving behind `next/dynamic` if needed;
    - LCP, CLS, TBT and INP are unchanged.
16. **End-to-end coverage** (Tasks A9, A10). **Ruled by the planner (P199):**
    - five `@e2e` scenarios: edit, delete with undo, a version conflict, save feedback, and a shared expense's corrected amount;
    - `World.transactions` keeps the recorded ids;
    - clocks follow P178;
    - the sheet, the edit route and the toast join `layout.spec.ts`, and a new `a11y-edit.spec.ts` scans them in light and dark.

### Design deviations

There is no artboard for the detail sheet, the edit form or the toast. They follow the M6a and M6b patterns:
- the Sheet's header and body, and the record form;
- `bg-ink`/`text-surface` for the toast, which inverts the theme and so keeps AA contrast in both themes;
- the two-column action footer of M6b's sheets.

The owner reviews them at the end (L1).

### Risks

1. Tasks A2 and A3 extend a contract other clients may use (`PATCH`). The new fields are optional and existing bodies behave the same. One behaviour changes: a deletion's audit of incomes, transfers and settlements now lists their accounts (P187).
2. `PATCH` returns no `warnings`, so an edit that leaves a shared fund negative is not announced (a follow-up). The balances screen still shows the fund's balance.
3. The budget figures are planning figures. Task A10 measures them and stops rather than raise one. The record route's 2 KiB headroom is the tightest: Task A4 measures it first.
4. `loaded()` may call `notFound()` on a 404. Task A5 checks this, and the fallback is named, so a deleted `tx` shows inside the sheet.
5. The edit route reads members, accounts and categories with archived ones on every open: four loopback calls, the same as the record form plus one.
6. Closing the sheet replaces the history entry. After closing, Back returns to where the person was before the list, not to the sheet. That is intended: the sheet is not a page.

### Follow-ups

1. Report `warnings` (a fund left negative) from `PATCH`, and show them after an edit.
2. A trash screen of deleted transactions, using the restore endpoint.
3. Edit a settlement's amount and date from the balances screen.
4. A transaction's audit history in the detail sheet (`GET …/audit`).
5. More than one payer per expense (spec 5.2).
6. Lower the new budgets after measuring them (P154's follow-up carried).
7. Mark E9 follow-up 2 `Done` in the backlog overview when the pull request merges (Task A11 writes the note).

### Placeholder and consistency scan

- No "TBD". Each component step names its file, its exported name, its props, the roles and labels its tests query, and its catalog keys with both translations. Test bodies left as comments state every value they assert and say "write in full". The implementer writes them; the planner left no value open.
- Names across tasks:

  | Task | Names |
  |---|---|
  | A1 | `restore`, `restorationChanges`, `RestoreTransaction`, `createRestoreTransaction`, `restoreTransaction` |
  | A2 | `resolvePayments`, `PaymentInput` (moved), `PartChanges`, `editedParts`, `EditChanges.accountId`, `.payments`, `.sourceAccountId`, `.destinationAccountId`, `editChangesFromBody`, `FieldNotEditable` |
  | A3 | `EditChanges.split`, exported `splitFromBody` |
  | A4 | `ToastInput`, `useToast`, `ToastProvider`, `TOAST_MS`, `TOAST_ACTION_MS`, `fundWentNegative` |
  | A5 | `withTx`, `withoutTx`, `Viewer`, `TransactionActions`, `actionsFor`, `TransactionDetail`, `loadTransactionDetail`, `TransactionSheet`, `TransactionSheetHost`, `TransactionRow.href`, `LoadMore.listHref` |
  | A6 | `useDeleteWithUndo` |
  | A7 | `RecordInitial`, `initialOf`, `draftOf`, `editBodyOf`, `ifMatchOf`, `originOf`, `RecordEdit`, `RecordFormProps.edit`, `SharedFieldsProps.defaultSplit` |
  | A8 | `loadEditContext`, `EditTransactionContainer`, `EditTransactionForm` |
  | A9 | `World.transactions`, `World.recordExpense` |

- Environment variables: none new. Migrations: none. OpenAPI changes: Tasks A1, A2 and A3 only.
- New dependencies: none; `pnpm check:pinned` and the lockfile are untouched.

## Open questions for the owner

None. Every decision was ruled under the owner's standing instruction (L1) and is listed above (P184–P199).
