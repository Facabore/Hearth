# M3-D Ledger Refinements for the UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle the model that M4's reports and E9's screens read: every user keeps an IANA time zone on their profile (taken from the browser at sign-up, `PATCH /api/v1/me` to change it); every transaction keeps the instant it happened and its zone next to the local date it counts in, every transaction a person records has a time (a date alone takes the current time of day; `occurredAt: null` answers `TimeRequired`, so a time is replaced but never removed), and lists show the newest day first, then the newest time, with the untimed scheduler occurrences and pre-M3-D rows last; categories get one optional subcategory level whose spending, default splits and filters roll up into its parent; accounts gain the types WALLET, INVESTMENT, LOAN and OTHER, common attributes (institution, last four digits, color, icon), the terms of credit cards, savings and term deposits and loans, and two switches that feed the space's "Disponible" and "Patrimonio neto" totals; category groups and categories get an icon (one of a fixed set of symbols, or one emoji) and a palette color, which a subcategory always shows from its parent, and the seeded groups an immutable catalog key (`housing` … `income`) that M4's reports read; and each user chooses how numbers, times and dates are written and which day the week starts on, apart from the interface language, following the installation's built-in es-CO rules until they override one.

**Architecture:** The kernel gains pure zone arithmetic (`canonicalTimeZone`, `parseTimeZone`, `localDateIn`, `wallTimeIn`, `instantAt`) and the `UserTimeZones` port (Task 2); identity implements it with `DrizzleUserProfiles` and adds `UpdateProfile` (Task 3), and the composition root binds it to the ledger and to accounts, which never import identity. The ledger domain gains `TransactionTime`, `timeOf` and `retimed`, where a date alone takes the current time of day and `occurredAt: null` is `TimeRequired` (Task 4); one migration adds `occurred_at` and `time_zone` and re-keys the list index, and `reviseTransaction` never clears a stored time (Task 5a); the list and its cursor follow (date, occurred_at nulls last, created_at, id) (Task 5b); every create use case resolves its time through `whenOf` with the recorder's zone, and only M3-C's `recordOccurrence` asks for none (`untimed`, Task 6). Categories gain `parentCategoryId` with the depth, sibling, cascade and restore rules in the domain (Task 8, migration in 9a); budgeting rolls spending and default splits up through its own `rolledUpCategory` over its `BudgetCategories` port (Task 10) and the ledger expands a category filter through its `CategoryReader` port (Task 11), so neither imports categories. Accounts keep everything in their module: attributes and switches on `Account` with "null means the type's default" (Tasks 12, 16), terms as typed columns with exact integer rates (Tasks 14, 15a), and totals computed on read by `ListAccounts` (D7, Task 16). Categories also gain a style: the icon (a symbol or one emoji grapheme) and palette value objects, defaults copied from the group and seeded by catalog key, and subcategories that show their parent's through `shownStyle` and `CategoryView` live in the categories domain and use cases, and `0017` adds the columns and the seeded groups' catalog `key` with a back-fill of existing rows (Task 17a); every group, category and subcategory answer carries `icon` and `color`, and a group answer its `key` (Task 17b). Identity gains the formatting preferences: the four formats and their resolution (the rule when locked, otherwise the stored value, otherwise the rule) in a new `identity/domain`, four nullable columns on the `user` row in `0018`, the `InstallationRulesReader` port with a built-in es-CO adapter that HU-E8-18 replaces in the composition root, and `GetProfile` beside `UpdateProfile`, which checks the locks (Task 18a); `GET` and `PATCH /api/v1/me` carry `preferences`, and `PATCH` also `locale` and the formats (Task 18b). Seven migrations, `0012` … `0018`.

**Tech Stack:** Node.js 24.21.0, pnpm 12.11.2, Next.js 16.4.0 (App Router route handlers), React 19.3.0, TypeScript 6.0.3 strict, Zod 4.6.5, zod-openapi 6.0.2, drizzle-orm 0.45.4 + drizzle-kit 0.31.11, pg 8.23.1, better-auth 1.7.7, Vitest 5.0.3, PostgreSQL 18.6 (Docker CLI in tests). No new dependencies: zone arithmetic uses `Intl.DateTimeFormat`, rate arithmetic uses `bigint`, the one-emoji rule uses `Intl.Segmenter`.

**Spec:** `docs/superpowers/specs/2026-10-11-hearth-design.md` (approved 2026-10-11; sections 2, 3, 5 (table), 5.2 (User, Account, Transaction, Recurrence, CategoryGroup / Category, BudgetLine), 5.3 (default split), 5.4, 6, 7, 8, 10 and decisions D5, D6, D7, D8, D9, D10, D11, D15 bind this plan; Task 1 amends it for M3-D and adds decisions D19 … D23). Stories (committed by the controller before Task 1 from the drafted backlog): `docs/backlog/E1-identity-and-spaces.md` HU-E1-14 and HU-E1-15, `docs/backlog/E4-ledger.md` HU-E4-14 (as amended by the backlog commit `ca3cd6a`: every transaction a person records has a time), `docs/backlog/E3-categories.md` HU-E3-04, HU-E3-05 and the amended HU-E3-02, `docs/backlog/E2-accounts.md` HU-E2-05 … HU-E2-07, and the M3-D rows of `docs/backlog/README.md`. Format template and precedent: `docs/superpowers/plans/2026-10-15-m3b-plan-lifecycle.md`; the rulings P1–P9 (M3-A, P8 as amended), P10–P19 (M3-B, **P17 as amended after its final review: a plan closes only after its period has ended, `PeriodNotOver` 409**) and P20–P31 (M3-C) and the preflight notes N1–N6 stay in force, with this plan's rulings P40–P73, P78, P79 and the preflight's P84–P88 (Self-Review) and M4's group-key rulings P74 and P77. GitHub Project: https://github.com/users/Facabore/projects/4.

**Baseline: `development` after the M3-C merge; preflight dry run then.** This plan executes, and its preflight dry run runs, only after `docs/superpowers/plans/2026-10-16-m3c-recurring-and-history.md` is merged. It relies on M3-C's names as that plan's code blocks show them (`recordOccurrence` passes only an occurrence's `date`, from the `base` object Task 6 extends; `src/modules/ledger/application/record-occurrence.test.ts` with `recurrenceWorld`, `recurrenceOf`, `fromTheFund`, `on`; `tests/acceptance/recurring-occurrences.test.ts` with `householdWithFund`, `define` (from the file's `trackedRecurrences()`), `rentBody`, `schedulerRunsOn`, `expensesIn`). Where M3-C changes a file this plan also edits (`src/composition/container.ts`, `src/modules/ledger/application/index.ts`, `tests/support/in-memory-ledger.ts`, `src/shared/http/problem.ts`, the spec's **Recurrence** paragraph), the anchors below name lines M3-C does not touch, or append to the end of the file or paragraph. Migrations continue at `0012` (M3-C added `0011_recurrences`) and end at `0018`.

**Out of scope (later plans):** the E8 future stories that build on M3-D (HU-E8-11 card installments with interest, HU-E8-12 CDT yield projection, HU-E8-13 loan amortization, HU-E8-14 savings goals, HU-E8-15 debts with people outside my spaces, HU-E8-16 reminders and its `Notifier`, HU-E8-17 net worth over time, HU-E8-06 a currency per account); M4, epic E7 (the line dashboard and the unified personal view, which apply this plan's roll-up rule when they are built: HU-E7-04's grouping of a subcategory under its parent's catalog key is not testable before M4); the web UI, epic E9 (HU-E9-03, HU-E9-04 and the sign-up form that sends the browser's zone; the formatters of HU-E9-02 and the settings screen of HU-E9-13, which read `preferences`); the installation rules themselves (HU-E8-18, M5: stored defaults and locks, brand and audit; until then HU-E1-15 runs on the built-in rules behind `InstallationRulesReader`, and its locked scenario on a fake reader). Also out: a per-space time zone (the recurrence scheduler, closing a plan and `GET …/periods` keep `APP_TIMEZONE`, HU-E1-14's note), imports with a time column (HU-E8-04, HU-E8-05), tags or split lines instead of a third category level, uploaded category images, arbitrary hex colors and per-member styles (HU-E3-05), managing categories from the expense form (HU-E9-12, M6), market values of investments, and a cross-space "all my money" total.

## Global Constraints

- Node.js `24.21.0`; pnpm `12.11.2`; Next.js `16.4.0`; React `19.3.0`; TypeScript `6.0.3` with `strict: true` and `noUncheckedIndexedAccess: true`; Zod `4.6.5`; zod-openapi `6.0.2`; drizzle-orm `0.45.4`; drizzle-kit `0.31.11`; pg `8.23.1`; better-auth `1.7.7`; Vitest `5.0.3`; PostgreSQL image `postgres:18.6-alpine`. No new dependencies; `pnpm check:pinned` must keep passing.
- Money is `bigint` minor units in code and `bigint` columns in PostgreSQL (D6); over HTTP it is `{ "amount": "<minor units as string>", "currency": "<ISO 4217>" }`. COP has exponent 2: 5,000,000 COP is `"500000000"`. Account terms that are money (`creditLimit`, `principal`) are `bigint` minor units in the space currency (`CurrencyMismatch` otherwise). **Rates are never floats:** a rate is an integer number of parts per million (`2.0 %` = `20000`), exchanged as a percent string with at most four decimals and returned with exactly four (`"26.8242"`); equivalent rates are computed in `bigint` (ruling P52).
- **Every delete is logical (owner directive, spec D8):** M3-D removes nothing. A transaction's recorded time is never removed (`TimeRequired`, HU-E4-14); clearing a format returns it to the installation rule (`null`, HU-E1-15); archiving a category archives its subcategories; deleting one is the existing `deleted_at`; clearing an account attribute sets it to null. No task in this plan adds a physical delete.
- **Authorization only through the permission matrix** (`src/modules/spaces/domain/permissions.ts`, unchanged; membership first): ledger writes keep `money.record` and `canModify`; category writes keep `authorizeManager` (OWNER, ADMIN); account writes keep their M1/M2 checks (writers, `fund.manage` for SHARED_FUND); `ListAccounts`, `GetAccount` and `ListCategories` stay `space.read`. `UpdateProfile` and `GetProfile` act only on the signed-in user and reach no space; installation locks are rules, not roles (HU-E1-15). M3-D adds no matrix action and no hardcoded role list.
- **Archived spaces only read (HU-E1-09):** every new write path (a subcategory, a category or group style, an account attribute, a switch, a transaction time) answers `409 SpaceArchived` through the existing `SpaceAccess` checks, while `GET …/accounts` (with its totals), `GET …/categories` and `GET …/transactions` keep answering `200`.
- Repositories guard identifiers that come from requests with `isUuid` before querying `uuid` columns (malformed ids return `null`, `false` or `[]`, never a `500`). Category ids from requests (`parentCategoryId`, `categoryIds` filters) are checked against lists already loaded from the space; the transaction cursor carries a UUID and two ISO instants that `positionFromCursor` validates (`InvalidCursor`). User ids are Better Auth text ids, never cast.
- HTTP errors are RFC 9457 `application/problem+json` with a stable `code` (the domain error name) and `requestId`; the API never returns translated text. Status mapping lives only in `src/shared/http/problem.ts` (explicit map, then `*NotFound` → 404, `Invalid*` → 422, else 409). New codes: `DateTimeMismatch` and `TimeRequired` (explicit 422, HU-E4-14), `PreferenceLocked` (explicit 409, HU-E1-15), `InvalidTimeZone`, `InvalidCreditLimit`, `InvalidBillingDay`, `InvalidRate`, `InvalidTermDeposit`, `InvalidTerm` (422 by default), `SubcategoryNotMappable`, `ParentCategoryArchived`, `AccountAttributeNotAllowed` (409 by default), `InvalidCategoryIcon` (422 by default); `CategoryDepthExceeded`, `CategoryInUse`, `AccountTypeImmutable`, `InvalidAmount` and `ValidationFailed` (an icon or color sent for a subcategory; an unknown format or language) gain new causes. Each joins the backlog's catalogue (spec 8) in the task that exposes it over HTTP, as a note of its story.
- Hexagonal boundaries (ADR 0001): domain imports only its own domain and `src/shared/kernel`; application never imports infrastructure, contracts, HTTP, frameworks or the ORM; other modules are reached only through `src/modules/<m>/application/index.ts`; `*.schema.ts` may import other modules' `*.schema.ts`; no import cycles (`no-circular` counts type-only imports, `tsPreCompilationDeps: true`). **The ledger and accounts never import identity, budgeting never imports categories or the ledger, and the ledger never imports categories:** each declares its port (`UserTimeZones` in the kernel, `BudgetCategories` in budgeting, `CategoryReader` in the ledger) and only `src/composition/container.ts` binds them. Identity's own `InstallationRulesReader` is bound there too, so HU-E8-18 swaps its adapter without touching a use case.
- **Seven schema changes**, each generated with `pnpm db:generate --name <name>` and committed with its `drizzle/meta/00NN_snapshot.json` and journal entry: `0012_transaction_time` (Task 5a), `0013_subcategories` (Task 9a), `0014_account_attributes` (Task 12), `0015_account_terms` (Task 15a), `0016_account_switches` (Task 16), `0017_category_styles` (Task 17a-2), `0018_user_preferences` (Task 18a). `0012` … `0016` and `0018` are never edited by hand: every column they add is nullable, so none back-fills a row (rulings P40, P50, P51, P64). `0017` is the one exception: its group columns are `NOT NULL` with the custom default, it adds the nullable group `key` with its unique index, and a hand-written back-fill, inserted into the generated SQL before its checks, keys the seeded groups and styles the existing rows by catalog key (Task 17a-2, rulings P56, P77). `pnpm db:check` reports no drift after each.
- Strict TDD: every behaviour starts with a failing test that is run and seen failing. Scenarios run as domain or use-case unit tests first; `@critical` scenarios and every HTTP contract also run in-process against the route handlers with real PostgreSQL (`tests/acceptance/`).
- Code, identifiers, comments, docs and generated artifacts in English. Conventional commits referencing the story issue (`Refs #<n>`); no AI attribution or `Co-Authored-By` lines.
- Gates for every task: `pnpm exec vitest run --project unit`, `pnpm exec vitest run --project integration`, `pnpm exec vitest run --project acceptance`, `pnpm format`, `pnpm exec eslint .`, `pnpm exec tsc --noEmit`, `pnpm exec prettier --check .`, `pnpm lint:boundaries`, `pnpm db:check`.
- OpenAPI: **no new component and no new `…Output` variant.** `Transaction` gains `occurredAt` and `timeZone`; `Category` gains `parentCategoryId`; `CategoryGroup.categories[]` gains `subcategories`; `Category`, `CategoryGroupSummary` and `CategoryGroup` gain `icon` and `color` (inline; `Category` and its existing `CategoryOutput`, both in the snapshot since M1, change together, Task 17b), and the two group schemas `key`; `Account` gains the attributes, `terms` and `derived`; the list of accounts gains `totals`; `PATCH /api/v1/me` is a new operation that references nothing new; the answers of `GET` and `PATCH /api/v1/me` gain `preferences` (inline) and the `PATCH` body `locale` and the four formats (Task 18b). Request bodies stay inline.

## Review Focus

1. **Instants near midnight and across zones and clock changes** (an expense at 2026-10-31T23:30-05:00, a Madrid user and a Bogotá user recording at the same instant, moving a Madrid expense recorded at 02:30 to 2026-03-29 or 2026-10-25, a user who changes zone after recording, an `occurredAt` sent with a `date` one day off, a date alone for a past day, or for Madrid's 2026-03-29 when now is 02:30 there, `occurredAt: null`): the date is always the local date in the record's own zone and never moves afterwards, a date alone takes now's time of day and a date-only edit keeps the wall-clock time (a skipped 02:30 becomes 03:30, a repeated one the first), `DateTimeMismatch` for a disagreeing pair, `TimeRequired` for a null time — pinned in Tasks 2 (`instantAt` on both 2026 Madrid transitions), 4, 6, 7a and 7b.
2. **Paging through a day that mixes timed and untimed items** (limit 1 through Lunch, Market, Rent, Taxi; 120 rows sharing a date and a creation instant; a cursor from before M3-D): every row exactly once in the order date desc, time desc nulls last, creation desc, id desc; the old cursor answers `422 InvalidCursor`, never a `500` — pinned in Task 5b (PostgreSQL keyset against the in-memory twin and the cursor's contract test) and Task 7b.
3. **A category tree changed under existing data** (a mapped category moved under another, a category with subcategories moved under one, a subcategory restored while its parent is archived, a category deleted while a subcategory is only archived, filtering by a parent whose subcategory is archived): the moved category's old mapping stops counting and copies drop it, `CategoryDepthExceeded`, `ParentCategoryArchived`, `CategoryInUse`, and archived subcategories still roll up into totals — pinned in Tasks 8, 9a, 10 and 11.
4. **Account terms at their edges** (a card with cut-off day 31 in November and February, a payment day before today's date, a 0 % rate, `"100"`, `"100.0001"`, `"-1"`, `"2,5"`, a term deposit with only one of term and maturity, a loan of 0 COP, a positive card balance, a BANK account sent a credit limit, a type change in the same request as a valid attribute): clamped dates on or after today in the user's zone, rates exact to the millionth, `InvalidRate` for every malformed string, `AccountAttributeNotAllowed` and `AccountTypeImmutable` before anything is stored — pinned in Tasks 14, 15a and 15b.
5. **Totals that must never double count or leak across spaces** (paying the card from the bank, an archived account, `?archived=true`, `?asOf=` before a transfer, a shared space beside its members' personal spaces, a VIEWER of the shared space, an archived space): the card payment is a transfer that moves available and leaves net worth, archived accounts never count even when listed, totals follow `asOf`, each space totals only its own accounts and answers `200` to every reader — pinned in Task 16.
6. **Icons and styles at their edges** (a ZWJ family, a skin tone, a flag, a keycap, `"🛒🍞"`, `"a"`, one grapheme of 34 code units; a group restyled after its categories were created; a parent restyled after its subcategory was promoted; a group holding seeded categories of two catalog groups before the back-fill, two groups holding the categories of one catalog group, a custom group named like a seed, a deleted seeded category): exactly one emoji grapheme, copies that never follow later changes, a derived style that always does, back-filled rows that satisfy `categories_style_by_level`, and at most one group per catalog key and space, never changed by a rename or a request — pinned in Tasks 17a and 17b.
7. **Preferences under locks and resets** (a locked field sent with a new value, with `null`, with the value it already applies, beside an unlocked one, or a locked `timezone` sent invalid; a lock lifted after a person stored a value; the language changed after formats were set; `"DOT_DOT"`, `"fr"`): `PreferenceLocked` before any validation and before anything is written, the stored value back once the lock lifts, formats unchanged by `locale`, `ValidationFailed` with nothing stored — pinned in Tasks 18a and 18b.

## Execution Workflow

- Work on the long-lived branch `development` after the M3-C merge; every task is implemented there with Strict TDD. Implementers stage; the controller commits.
- **RDD before every commit** (receipt-driven development is on; check with `gentle-ai review mode status`). Each "Commit" step means:
  1. Run every source-mutating normalizer first (`pnpm format`, regenerated migrations or snapshots), then stage exactly the files of the task.
  2. Run `gentle-ai review status --cwd . --contract gentle-ai.review-integration/v2 --agent claude-code --next-transition` and follow only the returned `next_transition` (`execute` its operation, satisfy `collect` inputs, or stop on `stop` and report its reason code with its documented continuation). Medium/high-risk candidates may return a consent envelope; relay it to the owner and wait.
  3. Commit only after the provider-returned `review.validate` allows the `pre-commit` gate for that exact staged candidate; the commit must not change the reviewed bytes.
  4. If the owner disables RDD (`gentle-ai review mode disable --scope clone --cwd .`), commit under ordinary policy and report `disabled/unmanaged`.
- Code blocks in this plan are complete but not guaranteed to match Prettier's line wrapping: run `pnpm format` before the gates of every task (the gates then run `prettier --check`). Anchors in this plan name lines that Prettier leaves alone (short statements, JSDoc and `//` comments, existing lines already formatted, the last line of a file); when an anchor is a range, it is given by its first and last lines. Where a later task edits a line an earlier task wrote, the earlier task writes it in its final Prettier form.
- Every code block the executor writes is introduced by a line naming its file path in backticks and ending with a colon. "Create" blocks are whole files; "Replace the contents" blocks are whole files too; edits to existing files name a unique anchor line ("after the line …", "replace the line …", "insert before the line …", "append to the end of the file").
- **Literal sites that a new required field breaks.** Tasks 3, 5a, 6, 8, 10, 11, 12, 15a, 17a and 18a add required fields to types that tests build as object literals (`SignUpDeps`, `Transaction`, `LedgerDeps`, `Category`, `BudgetingDeps`, `CategoryReader`, `Account`, `AccountsDeps`, `CategoryGroup`, `UserProfiles`; Task 18a narrows `SignUpDeps.profiles` so the sign-up tests keep theirs), and Tasks 7a, 9b, 13, 15b, 16, 17b and 18b add fields to answers (`Transaction`, `Category`, `Account`, the account list, `CategoryGroup`, `GET /api/v1/me`). Each task names every site the current code has; M3-C may have added more, and an existing test that compares a whole changed answer or object with `toEqual` gains the new fields. Before its gates, the implementer runs the `rg` command the task gives and adds the same line to every site it lists, then lets `pnpm exec tsc --noEmit` confirm none is left.
- **Task labels:** split halves of a task carry a lower-case letter (5a, 5b, 7a, 7b, 9a, 9b, 15a, 15b, 17a, 17b, 18a, 18b), and the commits of a half the preflight split further carry a number (rulings P84, P86, P87). Each label below is its own commit and RDD pass, executed in this order: 1, 2, 3, 4, 5a, 5b, 6, 7a, 7b, 8, 9a, 9b, 10, 11, 12, 13, 14, 15a, 15b-1, 15b-2, 16, 17a-1, 17a-2, 17a-3, 17a-4, 17b-1, 17b-2, 18a, 18b-1, 18b-2 (30 commits). An unsuffixed label (Task 15b, 17a, 17b, 18b) names all of its commits. Tasks 17a, 17b, 18a and 18b carry a letter so that no earlier task or migration is renumbered; they run last, in that order: 17a and 17b build on Tasks 8, 9a and 9b, and 18a and 18b on Task 3, after 17a so that `0018_user_preferences` follows `0017_category_styles` and the migrations stay in execution order.
- **Repository changes are pinned against their twins**, as in M3-A … M3-C: `src/modules/ledger/infrastructure/drizzle-ledger-queries.int.test.ts` runs the new ordering against PostgreSQL and compares it with `InMemoryTransactions` (Task 5b); `src/modules/categories/infrastructure/drizzle-category-repository.int.test.ts` stores and reads subcategories (Task 9a) and styles (Task 17a-2), and `category-styles-backfill.int.test.ts` runs `0017`'s back-fill on rows stored before it (Task 17a-3); `src/modules/accounts/infrastructure/drizzle-account-repository.int.test.ts` stores and reads every new account column (Tasks 12, 15a, 16); `src/modules/identity/infrastructure/drizzle-user-profiles.int.test.ts` pins the profile adapter (Task 3) and its formats and checks (Task 18a).
- **Measured sizes (preflight N1, carried from M3-A … M3-C):** each task is one commit sized for review, target under ~400 changed lines (OpenAPI snapshot growth included), and **a task over ~500 changed lines is split into commits, each green on its own**. Hand-written SQL inside a generated migration file counts toward that size; only drizzle-kit output is excluded (ruling P85). The preflight dry run at `ce923a0` measured every task with its fixes applied (one throwaway commit per task, `git show --numstat --minimal`, generated `drizzle/` files excluded, OpenAPI snapshot lines included and shown in parentheses; a `~` marks a commit the preflight measured at its split point or by regenerating the snapshot with that half alone):

| Task | Changed lines | Task | Changed lines |
|---|---|---|---|
| 1 | 53 | 15a | 381 |
| 2 | 187 | 15b-1 | ~245 (snapshot +188/−5) |
| 3 | 431 (91) | 15b-2 | ~345 (snapshot +218) |
| 4 | 228 | 16 | 360 (45) |
| 5a | 140 (+3,137 generated) | 17a-1 | 271 |
| 5b | 161 | 17a-2 | ~437, plus 75 hand-written SQL lines in `0017` |
| 6 | 420 | 17a-3 | 177 |
| 7a | 439 (154) | 17a-4 | 264 |
| 7b | 172 (19) | 17b-1 | ~450 (snapshot +340/−8) |
| 8 | 176 | 17b-2 | ~450 (snapshot +241/−4) |
| 9a | 273 | 18a | 499 (= 246 + 253 at its split point) |
| 9b | 279 (93) | 18b-1 | ~280 (snapshot +182/−1) |
| 10 | 160 (2) | 18b-2 | ~370 (snapshot +258/−2) |
| 11 | 134 | | |
| 12 | 299 (12) | | |
| 13 | 355 (179) | | |
| 14 | 299 | | |

- Tasks 3, 6, 16 and 18a measured under ~500 and stay one commit each; their named split points stay in case a staged candidate measures more: Task 3 the profile port, adapter, use cases and their tests | routes, contracts, container, snapshot and the acceptance file; Task 6 `whenOf` and the five create use cases | the edit, the list, the container and `recordOccurrence`; Task 16 the switches, the totals and the use case | the contract, route, snapshot and acceptance file; Task 18a Steps 1–5, the formats, the columns and the adapter | Steps 6–8, the port, the use cases and the container. The controller measures each staged candidate (`git diff --cached --numstat`) before RDD and splits at the named point when it is over ~500.
- The OpenAPI snapshot changes in Tasks 3 (`PATCH /api/v1/me`; the sign-up body gains `timezone`), 7a (`Transaction` gains `occurredAt`, `timeZone`; the six create bodies gain `occurredAt` (nullable, for `TimeRequired`) and `timeZone`; `DateTimeMismatch`, `TimeRequired` and `InvalidTimeZone` in their 422 descriptions), 7b (the edit body gains `occurredAt`, `timeZone`, and its 422 description the same codes), 9b (`Category.parentCategoryId`, `CategoryGroup.categories[].subcategories`, the create and update bodies), 10 (`SubcategoryNotMappable` in the mapping's 409 description), 12 (the four new account types in the `type` enums), 13 (`Account` attributes and the create and update bodies), 15b-1 (`Account.terms` and `Account.derived`), 15b-2 (`terms` in both bodies and their descriptions), 16 (`Account.includeInAvailable`, `includeInNetWorth`, the bodies, and `totals` in the list), 17b-1 (`icon` and `color` in `Category`, `CategoryOutput`, `CategoryGroupSummary` and `CategoryGroup`, and `key` in the two group schemas), 17b-2 (`icon` and `color` in the four create and update bodies; `InvalidCategoryIcon` in their 422 descriptions), 18b-1 (`preferences` in the answer of `GET /api/v1/me`) and 18b-2 (`preferences` in the answer of `PATCH /api/v1/me`; `locale` and the four formats in its body; `PreferenceLocked` in a new 409). Each of them regenerates it for its own contract change, so every commit is green on its own: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts`. If any `…Output` component appears in a snapshot diff, a request schema is reusing a response schema: fix the contract instead of accepting the snapshot.
- The story issues exist (created with the backlog commit `d8b61d8` by `tools/gh_sync.py`, in the GitHub milestone **M3 Allocated budgets API** and on Project #4): HU-E1-14 #94, HU-E2-05 #95, HU-E2-06 #96, HU-E2-07 #97, HU-E3-04 #98, HU-E4-14 #99, and HU-E3-05 #107 (added with the backlog commit `152d300`), and HU-E1-15 #109 (added with the backlog commit `ca3cd6a`, which also amended HU-E4-14). When a task starts, move its story issues to **In Progress**. When all tasks are done, open one pull request from `development` into `main` that closes #94 … #99, #107 and #109. Its description also lists, as PR notes: (1) every transaction a person records now carries `occurredAt` and `timeZone` (a date alone takes the current time of day), `occurredAt: null` answers `TimeRequired` on create and edit, only scheduler and confirmed occurrences and pre-M3-D rows stay untimed, and list cursors issued before M3-D answer `InvalidCursor`; (2) `GET /api/v1/me` and `PATCH /api/v1/me` carry the user's zone, language and formatting `preferences` (built-in es-CO rules, no lock, until HU-E8-18), and sign-up accepts an optional `timezone`; (3) `GET …/categories` nests `subcategories`, and a mapping of a category that became a subcategory stops counting; (4) the new account types, attributes, terms, switches and the `totals` of `GET …/accounts`; (5) every group, category and subcategory answer carries `icon` and `color`, the create and update bodies accept them, group answers carry a read-only catalog `key` (seeded groups only), and `0017` keys the seeded groups and back-fills the styles of existing rows by catalog key; (6) the controller rulings P40–P73, P78, P79 and P84–P88 of the Self-Review; (7) the follow-ups in the Self-Review.
- Task-to-issue map: HU-E1-14 (#94) → Tasks 2, 3; HU-E1-15 (#109) → Tasks 18a, 18b-1, 18b-2; HU-E4-14 (#99) → Tasks 2, 4, 5a, 5b, 6, 7a, 7b; HU-E3-04 (#98, and the amended HU-E3-02) → Tasks 8, 9a, 9b, 10, 11; HU-E2-05 (#95) → Tasks 12, 13; HU-E2-06 (#96) → Tasks 14, 15a, 15b-1, 15b-2; HU-E2-07 (#97) → Task 16; HU-E3-05 (#107) → Tasks 17a-1, 17a-2, 17a-3, 17a-4, 17b-1, 17b-2. Task 1 references all eight.

## File Structure

```
.
├── docs/
│   ├── superpowers/specs/2026-10-11-hearth-design.md                # M3-D amendments, D19–D23 (Task 1)
│   └── backlog/{E1-identity-and-spaces,E4-ledger,E3-categories,E2-accounts}.md   # error-catalogue notes (Tasks 3, 7a, 9b, 10, 13, 15b, 16, 17b, 18b)
├── drizzle/0012_transaction_time.sql … 0018_user_preferences.sql (+ meta)       # Tasks 5a, 9a, 12, 15a, 16, 17a, 18a, generated (0017 with a hand-written back-fill)
├── openapi/openapi.snapshot.json                                     # Tasks 3, 7a, 7b, 9b, 10, 12, 13, 15b-1, 15b-2, 16, 17b-1, 17b-2, 18b-1, 18b-2
├── src/
│   ├── shared/kernel/time-zone.ts (+ .test.ts, index.ts)             # zone arithmetic, UserTimeZones (Task 2)
│   ├── shared/http/problem.ts                                        # DateTimeMismatch, TimeRequired 422 (Task 7a); PreferenceLocked 409 (Task 18b)
│   ├── composition/container.ts                                      # Tasks 3, 6, 10, 11, 15a, 18a
│   ├── composition/openapi.test.ts                                   # no new …Output variant (Task 17b)
│   ├── app/api/v1/me/route.ts                                        # PATCH (Task 3); the profile with preferences (Task 18b)
│   ├── app/api/v1/routes.test.ts                                     # GET /me answers preferences (Task 18b)
│   ├── app/api/v1/spaces/[spaceId]/{incomes,transfers}/route.ts      # time inputs (Task 7a)
│   ├── app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route.ts   # time edits (Task 7b)
│   ├── app/api/v1/spaces/[spaceId]/categories/{route,[categoryId]/route}.ts  # parentCategoryId (Task 9b), icon and color (Task 17b)
│   ├── app/api/v1/spaces/[spaceId]/category-groups/{route,[groupId]/route}.ts  # icon and color (Task 17b)
│   ├── app/api/v1/spaces/[spaceId]/accounts/{route,[accountId]/route}.ts     # Tasks 13, 15b, 16
│   └── modules/
│       ├── identity/
│       │   ├── domain/preferences.ts (+ .test.ts)                    # formats, InstallationRules, effectivePreferences (Task 18a)
│       │   ├── application/profile.ts (+ .test.ts)                   # UserProfiles, UpdateProfile (Task 3); GetProfile, locks (Task 18a)
│       │   ├── application/installation-rules.ts                     # InstallationRulesReader (Task 18a)
│       │   ├── application/{sign-up,index}.ts                        # the browser's zone (Task 3); Pick of UserProfiles, exports (Task 18a)
│       │   ├── infrastructure/drizzle-user-profiles.ts (+ .int.test.ts)  # Tasks 3, 18a
│       │   ├── infrastructure/auth.schema.ts                         # four format columns and checks (Task 18a)
│       │   ├── infrastructure/built-in-installation-rules.ts         # es-CO defaults, no lock (Task 18a)
│       │   ├── infrastructure/{better-auth,better-auth-provider}.ts  # APP_TIMEZONE default (Task 3)
│       │   └── contracts/{auth,me}.contract.ts                       # Task 3; ProfileResponseSchema, meDto, the PATCH body (Task 18b)
│       ├── ledger/
│       │   ├── domain/transaction-time.ts (+ .test.ts)               # TransactionTime, timeOf, retimed (Task 4)
│       │   ├── domain/transaction.ts                                 # occurredAt, timeZone, audit (Task 5a)
│       │   ├── application/when.ts (+ .test.ts)                      # whenOf, editedTime (Task 6)
│       │   ├── application/{record-*,edit-transaction,list-transactions,deps,ports,index}.ts   # Tasks 5b, 6, 11; record-occurrence: untimed (Task 6)
│       │   ├── infrastructure/{ledger.schema,transaction-rows,drizzle-transaction-repository,drizzle-ledger-queries}.ts  # Tasks 5a, 5b
│       │   └── contracts/ledger.contract.ts                          # cursor (5b), Tasks 7a, 7b
│       ├── categories/
│       │   ├── domain/category.ts                                    # subcategories (Task 8), styles, shownStyle (Task 17a)
│       │   ├── domain/category-style.ts (+ .test.ts)                 # icons, one emoji, palette (Task 17a-1)
│       │   ├── domain/default-catalog.ts (+ .test.ts)                # seeded styles by catalog key (Task 17a)
│       │   ├── application/{create,update,archive,restore,delete,list}-categor*.ts, lookups.ts  # Tasks 9a, 17a
│       │   ├── application/{create,rename}-category-group.ts, category-view.ts, category-repository.ts  # Task 17a
│       │   ├── infrastructure/{categories.schema,drizzle-category-repository}.ts  # Tasks 9a, 17a
│       │   ├── infrastructure/category-styles-backfill.int.test.ts   # 0017's back-fill (Task 17a-3)
│       │   └── contracts/categories.contract.ts                      # Tasks 9b, 17b
│       ├── budgeting/
│       │   ├── domain/category-rollup.ts (+ .test.ts)                # rolledUpCategory, rolledUpSpending (Task 10)
│       │   ├── domain/budget-line.ts                                 # SubcategoryNotMappable (Task 10)
│       │   └── application/{deps,ports,plan-view,default-split,copy-budget-plan}.ts  # Task 10
│       └── accounts/
│           ├── domain/account.ts                                     # types, attributes, switches (Tasks 12, 16)
│           ├── domain/rate.ts (+ .test.ts)                           # ppm rates, equivalent rates (Task 14)
│           ├── domain/account-terms.ts (+ .test.ts)                  # terms, billing dates (Task 14)
│           ├── domain/account-type.ts                                # the type list (Task 12)
│           ├── domain/account-totals.ts (+ .test.ts)                 # available, net worth (Task 16)
│           ├── application/{create-account,update-account,list-accounts,archive-account,account-view,deps,index}.ts  # Tasks 12, 15a, 16
│           ├── infrastructure/{accounts.schema,drizzle-account-repository}.ts  # Tasks 12, 15a, 16
│           └── contracts/accounts.contract.ts                        # Tasks 13, 15b, 16
└── tests/
    ├── support/fakes.ts                       # fixedTimeZones (Task 2)
    ├── support/fixtures.ts                    # parentCategoryId (Task 8), NO_ATTRIBUTES (Task 12), a style in categoryFixture (Task 17a-2)
    ├── support/in-memory-ledger.ts            # time fields, order, subcategories (Tasks 5a, 5b, 6, 11)
    ├── support/budgeting-world.ts             # categories in BudgetingDeps (Task 10)
    ├── support/ledger.ts                      # TransactionDto time fields (Task 7a)
    └── acceptance/
        ├── time-zone.test.ts                  # Task 3
        ├── transaction-time.test.ts           # Tasks 7a, 7b
        ├── subcategories.test.ts              # Tasks 9b, 11
        ├── account-attributes.test.ts         # Tasks 13, 15b
        ├── account-totals.test.ts             # Task 16
        ├── ledger.test.ts                     # a deletion audit retires the time (Task 6)
        ├── category-styles.test.ts            # Task 17b
        ├── formatting-preferences.test.ts     # Task 18b
        └── recurring-occurrences.test.ts      # M3-C's file: untimed occurrences appended (Task 7b)
```

Test layout follows M0–M3-C: unit tests next to the code as `*.test.ts` (no database), integration tests as `*.int.test.ts` (real PostgreSQL via `testDatabase()`), acceptance tests in `tests/acceptance/` calling the exported route handlers in-process. Run a single file with `pnpm exec vitest run --project <unit|integration|acceptance> <path>`. Integration and acceptance projects start a disposable PostgreSQL container through the Docker CLI and apply every migration in `drizzle/`, so Docker must be running. Acceptance files run one at a time and assert only on their own fresh users.

### How M3-D actions are authorized

No matrix action is added.

| Use case | Authorization | Other rules (where they live) |
|---|---|---|
| `UpdateProfile` (`PATCH /api/v1/me`) | the signed-in user, on their own profile only | `lockedFieldsIn` (`PreferenceLocked`, Task 18a) first, then `parseTimeZone` (`InvalidTimeZone`, Task 2) |
| `GetProfile` (`GET /api/v1/me`, the answer of `PATCH`) | the signed-in user, on their own profile only | `effectivePreferences` over `InstallationRulesReader` (Task 18a) |
| `SignUp` | none (the throttled public route) | an unusable `timezone` falls back to `APP_TIMEZONE` (P45) |
| `RecordExpense`, `RecordIncome`, `RecordTransfer`, `RecordFundContribution`, `RecordSettlement`, direct splits | `money.record` (unchanged) | `whenOf` with the recorder's zone; a date alone takes now's time of day; `TimeRequired` (P41, P66, Task 6) |
| `EditTransaction` | membership, then `canModify` (unchanged) | `editedTime` → `retimed` (`TimeRequired`); the closed period of the resulting date (Task 6) |
| `ListTransactions` | `space.read` (unchanged) | today in the requester's zone; `categoryIds` with their subcategories (Tasks 6, 11) |
| `CreateCategory`, `UpdateCategory`, `ArchiveCategory`, `RestoreCategory`, `DeleteCategory` | `authorizeManager` (unchanged) | `newCategory`, `reviseCategory`, `archivedTree`, `restoreCategory`, `CategoryInUse` (Tasks 8, 9a) |
| `CreateCategoryGroup`, `RenameCategoryGroup`, `CreateCategory`, `UpdateCategory` with an icon or a color | `authorizeManager` (unchanged) | `categoryIconOf` (`InvalidCategoryIcon`), `newGroup`, `restyleGroup`, `newCategory`, `reviseCategory` (`ValidationFailed` for a subcategory) (Task 17a) |
| `MapCategoriesToLine` | `plan.manage` (unchanged) | `checkedMapping`: `SubcategoryNotMappable` (Task 10) |
| `CreateAccount`, `UpdateAccount` | writers; `fund.manage` for SHARED_FUND (unchanged) | `openAccount`, `reviseAccount`, `revisedTerms` (Tasks 12, 14, 16) |
| `ListAccounts`, `GetAccount` | `space.read` (unchanged) | today in the requester's zone; `totalsOf` (Tasks 15a, 16) |

### Every path that touches an M3-D rule

| Rule | Paths | Where it is enforced |
|---|---|---|
| A transaction's date is the local date of its instant in its own zone, and never moves on its own (HU-E4-14, D19) | every create, every edit | `timeOf`, `retimed` (Task 4) through `whenOf`, `editedTime` (Task 6) |
| The zone is the recorder's, never the payer's or the space's (P41) | every create without `timeZone`; an edit that adds a time | `UserTimeZones` (Tasks 2, 3) read by `whenOf` (Task 6) |
| Every transaction a person records has a time; a date alone takes now's time of day; a time is replaced or added, never removed (HU-E4-14 as amended, D19, P66) | every create, every edit | `timeOf`, `retimed` (Task 4), `reviseTransaction` (Task 5a), `whenOf` (Task 6), `TimeRequired` 422 (Task 7a) |
| AUTO and confirmed occurrences carry only their date (HU-E4-14, P42, P66) | M3-C's `recordOccurrence` | it sends its `date` with `untimed: true`, which no request body maps to (Task 6; end to end in Task 7b) |
| Lists: date desc, time desc nulls last, creation desc, id desc, keyset-stable (P43) | `GET …/transactions` | `DrizzleLedgerQueries.list`, the index `transactions_space_order_idx`, `positionFromCursor` (Tasks 5a, 5b) |
| At most three levels; siblings unique per parent; a subcategory is in its parent's group (HU-E3-04, D20) | create, update (move) | `newCategory`, `reviseCategory`, `categories_parent_name_uq` (Tasks 8, 9a) |
| Archiving cascades, restoring needs a live parent, deleting needs no live subcategory (P47, P48) | archive, restore, delete, archive a group | `archivedTree`, `restoreCategory`, `DeleteCategory` (Tasks 8, 9a) |
| Subcategories roll up into their parent; only categories are mapped (P48) | plan figures, default splits, mappings, copies, the transaction filter | `rolledUpSpending`, `rolledUpCategory`, `checkedMapping`, `mappable` (Task 10); `subcategoriesOf` (Task 11) |
| A group or category has an icon (a fixed symbol or exactly one emoji grapheme) and a palette color, never a hex value (HU-E3-05, D22) | create and update of groups and categories | `categoryIconOf`, `CATEGORY_COLORS` (Task 17a), `ColorSchema` (Task 17b) |
| A category without a style copies its group's at creation; a subcategory has none and shows its parent's; a promoted one keeps a copy (HU-E3-05) | create, update, every read, the back-fill | `newCategory`, `reviseCategory`, `shownStyle`, `viewOf`, `categories_style_by_level`, `0017` (Task 17a) |
| A seeded group has an immutable catalog key, unique per space; a group users create has none; no request writes it (HU-E3-05, P74, P77) | the seed, the back-fill, create and rename of groups, every read | `DEFAULT_CATALOG`, `seedTree`, `saveGroup` (never writes it), `category_groups_space_key_uq`, `0017` (Task 17a); `CategoryGroupSummarySchema.key`, bodies without it (Task 17b) |
| Personal account types live in personal spaces; the type never changes (HU-E2-05) | create, update | `openAccount`, `reviseAccount` (Task 12) |
| Terms only on their type; exact rates; clamped billing days (HU-E2-06) | create, update, every read | `revisedTerms`, `ratePpmOf`, `nextBillingDate`, `termFigures` (Task 14), `AccountView.figures` (Task 15a) |
| available / net worth = Σ signed balances of active accounts with the switch, per space, on read (HU-E2-07, D21) | `GET …/accounts` | `totalsOf` in `ListAccounts` (Task 16) |
| A format's effective value is the rule when locked, otherwise the stored value, otherwise the rule; never the language (HU-E1-15, D23) | `GET` and `PATCH /api/v1/me` | `effectivePreferences` in `GetProfile` over `InstallationRulesReader` (Task 18a) |
| A locked field refuses every change, even to clear it or to repeat its value; a lock never deletes a stored value (HU-E1-15) | `PATCH /api/v1/me` | `lockedFieldsIn` in `UpdateProfile` (Task 18a), `PreferenceLocked` 409 (Task 18b) |
| Archived spaces only read | every write above | `SpaceAccess` without `readOnly` (unchanged) |

---

### Task 1: Spec — amend the design for M3-D

Applies the "Spec impact" notes of HU-E1-14, HU-E1-15, HU-E4-14 (as the backlog commit `ca3cd6a` amended it), HU-E3-04, HU-E3-05, HU-E2-05, HU-E2-06 and HU-E2-07 to the design spec, as M3-A amended it with its plan. Documentation only: no code, no test. The backlog files themselves were committed by the controller before this task.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-11-hearth-design.md`

- [ ] **Step 1: Section 2 (Non-goals) — investments**

Replace the line `- Bank synchronization, OCR receipts, investments, multi-currency conversion, native mobile apps.` with:

```markdown
- Bank synchronization, OCR receipts, investment market data and brokerage sync (an `INVESTMENT` account's ledger balance is in scope, HU-E2-05), multi-currency conversion, native mobile apps.
```

- [ ] **Step 2: Section 3 — the deployment zone and the formats become defaults**

Replace the line `- Primary locale es-CO, currency COP, timezone America/Bogota. Code, identifiers and docs in English; UI i18n-ready (es, en).` with:

```markdown
- Primary locale es-CO, currency COP. es-CO's formats (`1.234.567,89`, a 24-hour clock, day-month-year dates, weeks from Monday) are the built-in defaults of the installation rules, which each user may override; the interface language never sets them (HU-E1-15, D23). Each user has their own time zone; America/Bogota is the deployment default (`APP_TIMEZONE`), which also drives the space-level clocks (the recurrence scheduler, closing a plan). Code, identifiers and docs in English; UI i18n-ready (es, en).
```

- [ ] **Step 3: Section 5 table — the period follows the local date**

Replace the line `| Period | Which month does it count in? | \`Period\` (derived from date + space period settings) |` with:

```markdown
| Period | Which month does it count in? | `Period` (derived from the transaction's local date + space period settings; its time of day never moves it) |
```

- [ ] **Step 4: Section 5.2 — User, Account, Transaction**

Replace the line `**User** — id, name, email, locale, timezone.` with:

```markdown
**User** — id, name, email, locale, timezone, numberFormat, timeFormat, dateFormat, weekStart. `timezone` is an IANA zone, taken from the browser at sign-up (`APP_TIMEZONE` when it is missing or unknown) and changed with `PATCH /api/v1/me`. It decides "today" and the time of what the user records; changing it never moves recorded transactions. `locale` (`es` | `en`) is the interface language, also changed with `PATCH /api/v1/me`.
- **Formats (HU-E1-15, D23):** `numberFormat` (`DOT_COMMA` `1.234.567,89` | `COMMA_DOT` `1,234,567.89` | `SPACE_COMMA` `1 234 567,89`), `timeFormat` (`H24` | `H12`), `dateFormat` (`DMY` | `MDY` | `YMD`) and `weekStart` (`MONDAY` | `SUNDAY`), each nullable: null follows the installation rule. The effective value is the rule when the installation locks the field, otherwise the stored value, otherwise the rule; a lock never deletes a stored value, and a locked field refuses every change (`PreferenceLocked`). Until stored rules exist (HU-E8-18), the rules are built in: es-CO's formats and no lock. Formats never derive from `locale`, and the API's wire forms (minor-unit amounts, `YYYY-MM-DD` dates, RFC 3339 instants) never depend on them.
```

Replace the paragraph that starts with `**Account** — id, spaceId, name, type (` with:

```markdown
**Account** — id, spaceId, name, type (`CASH` | `BANK` | `WALLET` | `CREDIT_CARD` | `SAVINGS` | `INVESTMENT` | `LOAN` | `OTHER` | `SHARED_FUND`), ownerUserId (null for shared accounts), openingBalance, archivedAt. A personal account belongs to the user's personal space; a `SHARED_FUND` account belongs to a shared space. The type never changes.
- Common optional attributes on every type: institution, lastFour (exactly four digits; a full card or account number is never stored), color (a palette key) and icon (an allow-listed name; null means the type's default).
- Type-specific terms, optional, refused on any other type (`AccountAttributeNotAllowed`): `CREDIT_CARD` creditLimit, cutOffDay and paymentDay (1–31, clamped to the month's last day like `PeriodPolicy`) and monthlyRate; `SAVINGS` annualRate and, for a term deposit (CDT), termDays and maturityDate together; `LOAN` principal, annualRate and termMonths. Derived on read: available credit (limit + balance), the next cut-off and payment dates on or after the requesting user's today, the equivalent rates (`EA = (1 + i_m)^12 − 1`) and a term deposit's start date.
- Switches `includeInAvailable` and `includeInNetWorth` (D21), null meaning the type's default: CASH, BANK, WALLET and SHARED_FUND count in both; SAVINGS, INVESTMENT, CREDIT_CARD, LOAN and OTHER in net worth only.
- Liabilities (`CREDIT_CARD`, `LOAN`) carry negative balances for the money owed, so a signed sum is assets minus debts.
```

Replace the line `**Transaction** — id, spaceId, type, description, date, categoryId (nullable for transfers and settlements), amount (minor units), currency, createdBy, deletedAt.` with:

```markdown
**Transaction** — id, spaceId, type, description, date, occurredAt, timeZone, categoryId (nullable for transfers and settlements), amount (minor units), currency, createdBy, deletedAt.
- **Time (D19):** `date` is the local calendar date the transaction counts in (periods, plans, balances `asOf`, budgets, reports). `occurredAt` is the UTC instant it happened; `timeZone` is the IANA zone of the user who recorded it (`createdBy`, never the payer or the space), set exactly when `occurredAt` is. With `occurredAt`, `date` is its local date in `timeZone`. Every transaction a person records has a time: a date alone takes the current time of day in the zone, and `occurredAt: null` answers `TimeRequired`. Only recurring occurrences (automatic or confirmed), imports and rows older than M3-D have no time, until someone edits one in; a time is then replaced, never removed. `occurredAt` only orders and displays; no boundary ever reads it.
```

Insert after the line that starts with `- \`TRANSFER\`: source account → destination account.`:

```markdown
- Paying a credit card is a `TRANSFER` from the paying account to the card: no category, never spending, never split (D21). The purchase is the expense, on its date and with its category; interest and fees are new expenses when they are charged.
```

- [ ] **Step 5: Section 5.2 — Recurrence, categories, their styles and budget lines**

Append to the end of the paragraph that starts with `**Recurrence** —` (as M3-C left it) the sentence:

```markdown
 Occurrences are recorded with their date and no time (D19).
```

Replace the paragraph that starts with `**CategoryGroup / Category** — two levels, per space,` with:

```markdown
**CategoryGroup / Category** — per space, seeded from defaults, renamable and archivable, at most three levels: group → category → optional subcategory (D20). A subcategory (`parentCategoryId`) is always in its parent's group and moves with it; a subcategory never has subcategories, and a category with subcategories never becomes one (`CategoryDepthExceeded`). Names are unique among siblings (the same parent, or the same group for categories). Subcategories have no catalog key and are never seeded. A seeded group has an immutable catalog `key` too, stable across spaces and renames like a category's (`housing`, `food`, `transport`, `health`, `leisure`, `income`); groups users create have none, no rename, move or archive changes a key, and at most one group per space holds a given key. Archiving a group archives its categories, and archiving a category archives its subcategories; a subcategory is restored only while its parent is not archived (`ParentCategoryArchived`). A category nothing references can also be deleted, logically (`deleted_at`, D8): the row stays, it leaves every list and lookup, and its name is free again; a referenced one, or one with live subcategories, is archived instead (`CategoryInUse`). Groups are archived, never deleted. Every group and category has an icon, one of a fixed set of 58 symbols or exactly one emoji (one grapheme: a ZWJ sequence or a skin tone counts as one), and a color, one of sixteen palette keys (D22); a category created without them copies its group's at creation, and a group created without them takes `tag` in `GRAPHITE`. A subcategory has no style of its own: it always shows its parent's, and keeps a copy of it when it becomes a category. Seeded groups and categories take their default style by catalog key (HU-E3-01, HU-E3-05); a seeded category takes its group's color:

| Seeded group | Key | Icon | Color | Its categories' icons, by catalog key |
|---|---|---|---|---|
| Housing | `housing` | `home` | `INDIGO` | `rent` → `key`, `utilities` → `bulb`, `maintenance` → `wrench` |
| Food | `food` | `apple` | `SAND` | `groceries` → `cart`, `restaurants` → `fork` |
| Transport | `transport` | `car` | `STEEL` | `fuel` → `fuel`, `public_transport` → `bus` |
| Health | `health` | `heart` | `ROSE` | `medical` → `cross`, `pharmacy` → `pill` |
| Leisure | `leisure` | `ticket` | `PLUM` | `entertainment` → `tv`, `travel` → `plane` |
| Income | `income` | `coins` | `PINE` | `salary` → `briefcase`, `other_income` → `gift` |
```

In the paragraph that starts with `**BudgetLine** —`, replace the sentence `A category maps to at most one line per plan.` with:

```markdown
Only categories are mapped, never subcategories (`SubcategoryNotMappable`); a category maps to at most one line per plan, and its subcategories' expenses count where it is mapped (D20).
```

- [ ] **Step 6: Sections 5.3 and 5.4 — roll-up and the account totals**

Replace the text `- **Default split:** expenses that resolve (by mapping or catch-all)` with:

```markdown
- **Default split:** expenses that resolve (through their category, or a subcategory's parent, by mapping or catch-all)
```

Replace the line `- \`spent(L)\` = Σ amount of EXPENSE transactions in P whose category maps to L. For \`SAVINGS\` lines: Σ transfers in P into the line's savings accounts.` with:

```markdown
- `spent(L)` = Σ amount of EXPENSE transactions in P whose category, or whose subcategory's parent, maps to L. For `SAVINGS` lines: Σ transfers in P into the line's savings accounts.
```

Replace the line that starts with `- **Grouping:** by category catalog key.` with the same line followed by ` A subcategory groups under its parent category.` at its end.

Insert before the line `Unified personal view for user u (D11). It works through every SpaceMember row linked to u, including history recorded while u was a guest before claiming:`:

```markdown
Accounts, per space, at a date (HU-E2-07, D21): `available` = Σ balance(a) over the space's active accounts with `includeInAvailable`; `netWorth` = Σ balance(a) over those with `includeInNetWorth`. Balances are the computed, signed ones (opening balance + movements up to the date). A personal space totals its owner's accounts and a shared space its shared funds; spaces never mix.

```

- [ ] **Step 7: Section 6 — decisions D19 … D23**

Insert after the line that starts with `| D18 |`:

```markdown
| D19 | A transaction keeps its local date, plus a UTC instant and the recorder's IANA zone; every transaction a person records has a time (a date alone takes the current time of day), and only recurring occurrences, imports and rows older than M3-D have none | Periods and reports keep the date they count in, lists show what happened when, nothing moves when someone travels or changes zone, and no one's own record sorts as untimed | One timestamp per transaction with the date derived on read (history moves with a zone change); midnight back-filled for old rows (fake times); a "no time" choice when recording (each day would mix untimed records with timed ones) |
| D20 | One optional subcategory level; budgets, splits, filters and reports roll subcategories up into their category | Detail when a member wants it, while plans keep mapping a handful of categories | Unlimited depth; tags or split lines instead of a third level |
| D21 | Each account has two switches, available and net worth, with defaults by type; a card payment is a transfer, never spending | Members choose what "Disponible" means without new account kinds, and nothing counts twice | Fixed rules per type; recording a card payment as an expense |
| D22 | Category groups and categories carry an icon (a fixed symbol or one emoji) and a color that is one of sixteen palette keys, never a hex value; subcategories derive their parent's icon and color | Light and dark themes map each key to their own tokens, and a subcategory always looks like the category it rolls up into | Free hex colors or uploaded images; a copied style per subcategory that drifts from its parent |
| D23 | Number, time and date formats and the first weekday are four profile preferences, null meaning "follow the installation rule", and never derive from the language | A person can read Spanish with `1,234.56` or a 12-hour clock if that is what they are used to; the rules and locks of a white-label installation (HU-E8-18) plug in behind one port without touching the profile | Formats taken from the locale (`es` → `1.234,56`); concrete values copied onto each profile at sign-up (a later change of the default would never reach anyone) |
```

- [ ] **Step 8: Sections 7, 8 and 10**

In the table under `### HTTP API conventions`, insert after the line that starts with `| Pagination |`:

```markdown
| Dates, times and rates | Local dates as `YYYY-MM-DD`; instants as RFC 3339, accepted with any offset and returned in UTC (`Z`); time zones as IANA names; rates as percent decimal strings with at most four decimals (`"2.0"`, `"28.59"`), returned with exactly four (`"2.0000"`) |
| Transaction lists | Newest day first, then newest time, untimed items last in their day, then newest recorded, then id; the cursor carries that position |
| Profile | `GET /api/v1/me` returns the user with their `timezone`, `locale` and `preferences` (`stored`, `effective` and `defaults`, each with the four formats, and the names of the `locked` fields); `PATCH /api/v1/me` changes `timezone` (`InvalidTimeZone`, 422), `locale` and the four formats: an omitted field is unchanged and `null` returns a format to the rule; a locked field answers `PreferenceLocked` (409) |
```

In section 8, replace the text `closed period 409, precondition failed 412.` with:

```markdown
closed period 409, precondition failed 412, an instant and a date that disagree 422 (`DateTimeMismatch`), a transaction time sent as null 422 (`TimeRequired`), a preference the installation locks 409 (`PreferenceLocked`).
```

In the table under `## 10. Delivery`, insert after the line that starts with `| M3 Allocated budgets API |`:

```markdown
| M3-D Ledger refinements for the UI | Each user's time zone and formatting preferences, the time of every transaction, optional subcategories, category icons and colors, more account types with their attributes, available money and net worth |
```

- [ ] **Step 9: Check the amendments**

Run: `rg -n "D19|D20|D21|D22|D23|M3-D|occurredAt|TimeRequired|numberFormat|PreferenceLocked|SubcategoryNotMappable|includeInAvailable|GRAPHITE" docs/superpowers/specs/2026-10-11-hearth-design.md`
Expected: the new decisions, the M3-D row, the Transaction time bullet (with `TimeRequired`), the User formats bullet, the Profile row, the section 8 codes, the BudgetLine sentence, the Account switches and the category styles (the CategoryGroup / Category paragraph, followed by the seed table) each appear once; `pnpm exec prettier --check docs/superpowers/specs/2026-10-11-hearth-design.md` passes after `pnpm format`.

- [ ] **Step 10: Commit**

```bash
git add docs/superpowers/specs/2026-10-11-hearth-design.md
git commit -m "docs(spec): amend the design for M3-D ledger refinements (Refs #94, Refs #109, Refs #99, Refs #98, Refs #107, Refs #95, Refs #96, Refs #97)"
```

---

### Task 2: Kernel — time zones and the UserTimeZones port

Implements the zone arithmetic HU-E1-14 and HU-E4-14 need, with `Intl.DateTimeFormat` only (no dependency).

Decisions:
- A zone is valid when `Intl.DateTimeFormat` accepts it, and its canonical name (`resolvedOptions().timeZone`) is what is stored (HU-E1-14 note). `parseTimeZone` answers `InvalidTimeZone` (422 by default) for an explicitly sent zone.
- `instantAt(date, wall, zone)` turns a wall-clock time back into an instant. On a clock change it follows the "compatible" rule: a skipped time (Madrid 2026-03-29 02:30) moves forward by the gap (03:30), and a repeated one (Madrid 2026-10-25 02:30) takes the earlier instant (ruling P42).
- `UserTimeZones` is a kernel port, like `Clock`: identity implements it (Task 3) and the composition root hands it to the ledger and to accounts, which never import identity (ruling P45).

**Files:**
- Create: `src/shared/kernel/time-zone.ts`, `src/shared/kernel/time-zone.test.ts`
- Modify: `src/shared/kernel/index.ts`, `tests/support/fakes.ts`

**Interfaces:**
- Consumes: `LocalDate`, `fromParts`, `partsOf` (kernel); `domainError`, `ok`, `err`, `Result`.
- Produces:
  - `interface UserTimeZones { timeZoneOf(userId: string): Promise<string> }`
  - `interface WallTime { hour: number; minute: number; second: number; millisecond: number }`
  - `canonicalTimeZone(raw: string): string | null`
  - `parseTimeZone(raw: string): Result<string>` — `InvalidTimeZone` (`details.value`)
  - `localDateIn(instant: Date, timeZone: string): LocalDate`
  - `wallTimeIn(instant: Date, timeZone: string): WallTime`
  - `instantAt(date: LocalDate, wall: WallTime, timeZone: string): Date`
  - `fixedTimeZones(byUser?: Record<string, string>, fallback?: string): UserTimeZones & { asked: string[] }` (tests/support/fakes.ts)

- [ ] **Step 1: Write the failing tests**

Create `src/shared/kernel/time-zone.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "./local-date";
import { canonicalTimeZone, instantAt, localDateIn, parseTimeZone, wallTimeIn } from "./time-zone";

const at = (iso: string) => new Date(iso);
const wall = (hour: number, minute: number) => ({ hour, minute, second: 0, millisecond: 0 });
const day = (iso: string) => iso as LocalDate;

describe("time zones (HU-E1-14)", () => {
  it("accepts what Intl accepts, by its canonical name", () => {
    expect(canonicalTimeZone("america/bogota")).toBe("America/Bogota");
    expect(canonicalTimeZone("Europe/Madrid")).toBe("Europe/Madrid");
    expect(canonicalTimeZone("UTC")).toBe("UTC");
  });

  it.each(["Bogota", "Mars/Olympus", ""])("refuses %j", (raw) => {
    expect(canonicalTimeZone(raw)).toBeNull();
    expect(parseTimeZone(raw)).toEqual({ ok: false, error: { code: "InvalidTimeZone", details: { value: raw } } });
  });
});

describe("local dates and wall-clock times (HU-E4-14)", () => {
  it("reads an instant's date and time in a zone", () => {
    expect(localDateIn(at("2026-11-01T04:30:00Z"), "America/Bogota")).toBe("2026-10-31");
    expect(localDateIn(at("2026-11-01T04:30:00Z"), "Europe/Madrid")).toBe("2026-11-01");
    expect(wallTimeIn(at("2026-10-16T19:32:07.250Z"), "America/Bogota")).toEqual({
      hour: 14,
      minute: 32,
      second: 7,
      millisecond: 250,
    });
    expect(wallTimeIn(at("2026-10-17T03:30:00Z"), "Europe/Madrid")).toEqual(wall(5, 30));
  });

  it("finds the instant of a wall-clock time", () => {
    expect(instantAt(day("2026-10-14"), wall(14, 32), "America/Bogota").toISOString()).toBe(
      "2026-10-14T19:32:00.000Z",
    );
    expect(instantAt(day("2026-03-29"), wall(10, 0), "Europe/Madrid").toISOString()).toBe(
      "2026-03-29T08:00:00.000Z",
    );
    expect(instantAt(day("2026-03-29"), wall(0, 30), "Europe/Madrid").toISOString()).toBe(
      "2026-03-28T23:30:00.000Z",
    );
  });

  it("moves a skipped time forward and takes the first of a repeated one (Review Focus 1)", () => {
    // 02:00 → 03:00 on 2026-03-29 in Madrid: 02:30 does not exist and becomes 03:30 CEST.
    expect(instantAt(day("2026-03-29"), wall(2, 30), "Europe/Madrid").toISOString()).toBe(
      "2026-03-29T01:30:00.000Z",
    );
    // 03:00 → 02:00 on 2026-10-25 in Madrid: 02:30 happens twice; the first is 02:30 CEST.
    expect(instantAt(day("2026-10-25"), wall(2, 30), "Europe/Madrid").toISOString()).toBe(
      "2026-10-25T00:30:00.000Z",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/shared/kernel/time-zone.test.ts`
Expected: FAIL — `Cannot find module './time-zone'`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/kernel/time-zone.ts`:

```ts
import { domainError } from "./domain-error";
import { fromParts, partsOf, type LocalDate } from "./local-date";
import { err, ok, type Result } from "./result";

/** HU-E1-14: each user's own IANA zone; the composition root binds it to identity's profiles. */
export interface UserTimeZones {
  /** The user's canonical zone; the deployment's APP_TIMEZONE for an unknown user or an unusable stored value. */
  timeZoneOf(userId: string): Promise<string>;
}

/** A time of day as a zone's clock shows it. */
export interface WallTime {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatterOf = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

/** HU-E1-14: the canonical name of a zone Intl accepts ("america/bogota" → "America/Bogota"); null otherwise. */
export const canonicalTimeZone = (raw: string): string | null => {
  if (raw === "") return null;
  try {
    return new Intl.DateTimeFormat("en", { timeZone: raw }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
};

/** HU-E1-14: a zone sent explicitly; an unknown one is InvalidTimeZone. */
export const parseTimeZone = (raw: string): Result<string> => {
  const zone = canonicalTimeZone(raw);
  return zone === null ? err(domainError("InvalidTimeZone", { value: raw })) : ok(zone);
};

const fieldsOf = (instant: Date, timeZone: string) => {
  const parts = new Map(formatterOf(timeZone).formatToParts(instant).map((p) => [p.type, Number(p.value)]));
  const field = (name: Intl.DateTimeFormatPartTypes) => parts.get(name) ?? 0;
  return {
    year: field("year"),
    month: field("month"),
    day: field("day"),
    hour: field("hour"),
    minute: field("minute"),
    second: field("second"),
  };
};

export const localDateIn = (instant: Date, timeZone: string): LocalDate => {
  const { year, month, day } = fieldsOf(instant, timeZone);
  return fromParts(year, month, day);
};

export const wallTimeIn = (instant: Date, timeZone: string): WallTime => {
  const { hour, minute, second } = fieldsOf(instant, timeZone);
  return { hour, minute, second, millisecond: instant.getUTCMilliseconds() };
};

/** The zone's offset from UTC at `instant`, in milliseconds (whole seconds). */
const offsetAt = (instant: number, timeZone: string): number => {
  const f = fieldsOf(new Date(instant), timeZone);
  return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second) - Math.floor(instant / 1000) * 1000;
};

const HALF_DAY = 12 * 60 * 60 * 1000;

/**
 * HU-E4-14, ruling P42: the instant at which `timeZone`'s clock shows `wall` on `date`. A repeated time takes the
 * earlier instant; a skipped time moves forward by the gap (the offset before the change applies).
 */
export const instantAt = (date: LocalDate, wall: WallTime, timeZone: string): Date => {
  const { year, month, day } = partsOf(date);
  const local = Date.UTC(year, month - 1, day, wall.hour, wall.minute, wall.second, wall.millisecond);
  const before = local - offsetAt(local - HALF_DAY, timeZone);
  const after = local - offsetAt(local + HALF_DAY, timeZone);
  const valid = [before, after]
    .sort((a, b) => a - b)
    .find((candidate) => local - candidate === offsetAt(candidate, timeZone));
  return new Date(valid ?? before);
};
```

In `src/shared/kernel/index.ts`, append to the end of the file:

```ts
export * from "./time-zone";
```

In `tests/support/fakes.ts`, replace the line `import { Money, type Id, type IdGenerator, type Result, type TransactionManager } from "@/shared/kernel";` with:

```ts
import {
  Money,
  type Id,
  type IdGenerator,
  type Result,
  type TransactionManager,
  type UserTimeZones,
} from "@/shared/kernel";
```

Append to the end of `tests/support/fakes.ts`:

```ts

/** HU-E1-14: each user's zone, `fallback` unless named; records whom it was asked about. */
export const fixedTimeZones = (
  byUser: Readonly<Record<string, string>> = {},
  fallback = "America/Bogota",
): UserTimeZones & { readonly asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    timeZoneOf: async (userId) => {
      asked.push(userId);
      return byUser[userId] ?? fallback;
    },
  };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/shared/kernel/time-zone.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the gates, then commit**

Run the gates of Global Constraints, then:

```bash
git add src/shared/kernel/time-zone.ts src/shared/kernel/time-zone.test.ts src/shared/kernel/index.ts tests/support/fakes.ts
git commit -m "feat(kernel): read and build instants in a user's time zone (Refs #94, Refs #99)"
```

---

### Task 3: Identity — each user's time zone

Implements HU-E1-14: sign-up takes the browser's zone, `PATCH /api/v1/me` changes it, and `UserTimeZones` reads it.

Decisions:
- Better Auth keeps `timezone` as `input: false`; its default becomes `APP_TIMEZONE` (no more literal). `SignUp` writes the browser's zone through `UserProfiles` right after the provider creates the user and before provisioning, inside the same compensation: a failed write removes the half-created user like a failed provisioning (ruling P45). An invalid or missing zone falls back to `APP_TIMEZONE`, so an unusual browser never blocks registration.
- `PATCH /api/v1/me` with an unknown zone answers `422 InvalidTimeZone` and changes nothing; `{}` changes nothing and answers the user. `GET /api/v1/me` keeps returning the session's user, which Better Auth reads from the `user` row on every request.
- `DrizzleUserProfiles.timeZoneOf` answers `APP_TIMEZONE` for an unknown user and for a stored value Intl no longer accepts, so no reader ever throws a `RangeError` (ruling P45).
- The DB column default `'America/Bogota'` stays (no migration): every sign-up now writes the zone explicitly.

**Files:**
- Create: `src/modules/identity/application/profile.ts`, `src/modules/identity/application/profile.test.ts`, `src/modules/identity/infrastructure/drizzle-user-profiles.ts`, `src/modules/identity/infrastructure/drizzle-user-profiles.int.test.ts`, `tests/acceptance/time-zone.test.ts`
- Modify: `src/modules/identity/application/sign-up.ts`, `src/modules/identity/application/sign-up.test.ts`, `src/modules/identity/application/index.ts`, `src/modules/identity/infrastructure/better-auth.ts`, `src/modules/identity/infrastructure/better-auth-provider.ts`, `src/modules/identity/infrastructure/better-auth-provider.int.test.ts`, `src/modules/identity/contracts/auth.contract.ts`, `src/modules/identity/contracts/me.contract.ts`, `src/app/api/v1/me/route.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E1-identity-and-spaces.md`

**Interfaces:**
- Consumes: `canonicalTimeZone`, `parseTimeZone`, `UserTimeZones` (Task 2); `AuthUser` (kernel).
- Produces:
  - `interface UserProfiles { setTimeZone(userId: string, timeZone: string): Promise<void> }`
  - `type UpdateProfile = (input: { user: AuthUser; timezone?: string }) => Promise<Result<AuthUser>>`, `createUpdateProfile(deps: { profiles: UserProfiles })`
  - `SignUpDeps` gains `profiles: UserProfiles` and `defaultTimeZone: string`; `SignUp` input gains `timezone?: string`
  - `class DrizzleUserProfiles implements UserProfiles, UserTimeZones` — `constructor(tm: DrizzleTransactionManager, fallback: string)`
  - `createAuth(opts)` gains `defaultTimeZone: string`; `new BetterAuthProvider(auth, db, defaultTimeZone)`
  - `Container.identity.updateProfile: UpdateProfile`; `Container.profiles: DrizzleUserProfiles` is not exposed (Task 6 binds it inside `buildContainer`)

- [ ] **Step 1: Write the failing unit tests**

Create `src/modules/identity/application/profile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AuthUser } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { createUpdateProfile, type UserProfiles } from "./profile";

const ana: AuthUser = { id: "u-ana", name: "Ana", email: "ana@example.com", locale: "es", timezone: "America/Bogota" };
const world = () => {
  const stored = new Map<string, string>();
  const profiles: UserProfiles = { setTimeZone: async (userId, zone) => void stored.set(userId, zone) };
  return { stored, update: createUpdateProfile({ profiles }) };
};

describe("UpdateProfile (HU-E1-14)", () => {
  it("changes my time zone, stored by its canonical name", async () => {
    const { stored, update } = world();
    expect(unwrap(await update({ user: ana, timezone: "america/new_york" })).timezone).toBe("America/New_York");
    expect(stored.get("u-ana")).toBe("America/New_York");
  });

  it("refuses an unknown zone and keeps mine", async () => {
    const { stored, update } = world();
    expect(codeOf(await update({ user: ana, timezone: "Bogota" }))).toBe("InvalidTimeZone");
    expect(stored.size).toBe(0);
  });

  it("changes nothing without a zone, or with the zone I already have", async () => {
    const { stored, update } = world();
    expect(unwrap(await update({ user: ana }))).toEqual(ana);
    expect(unwrap(await update({ user: ana, timezone: "America/Bogota" }))).toEqual(ana);
    expect(stored.size).toBe(0);
  });
});
```

In `src/modules/identity/application/sign-up.test.ts`:

1. Replace the line `import { createSignUp, normalizeEmail } from "./sign-up";` with:

```ts
import { createSignUp as createSignUpWith, normalizeEmail, type SignUpDeps } from "./sign-up";
```

2. Insert after the line `const input = { name: "Ana", email: "a@b.co", password: "x" };`:

```ts
/** HU-E1-14: the zone port and the deployment default; existing tests sign up without a zone. */
const zones = () => ({ profiles: { setTimeZone: vi.fn(async () => undefined) }, defaultTimeZone: "America/Bogota" });
const createSignUp = (deps: Pick<SignUpDeps, "auth" | "provisionUser">) => createSignUpWith({ ...zones(), ...deps });
```

3. Append to the end of the file:

```ts

describe("SignUp time zone (HU-E1-14)", () => {
  const signUpWith = (setTimeZone: SignUpDeps["profiles"]["setTimeZone"], defaultTimeZone = "America/New_York") =>
    createSignUpWith({
      auth: provider(),
      provisionUser: async () => ok(undefined),
      profiles: { setTimeZone },
      defaultTimeZone,
    });

  it("stores the browser's zone by its canonical name", async () => {
    const setTimeZone = vi.fn(async () => undefined);
    const result = await signUpWith(setTimeZone)({ ...input, timezone: "europe/madrid" });
    expect(result.ok && result.value.user.timezone).toBe("Europe/Madrid");
    expect(setTimeZone).toHaveBeenCalledWith("u-ana", "Europe/Madrid");
  });

  it.each([undefined, "", "Mars/Olympus"])("falls back to APP_TIMEZONE for %j", async (timezone) => {
    const setTimeZone = vi.fn(async () => undefined);
    const result = await signUpWith(setTimeZone)({ ...input, timezone });
    expect(result.ok && result.value.user.timezone).toBe("America/New_York");
    expect(setTimeZone).toHaveBeenCalledWith("u-ana", "America/New_York");
  });

  it("writes nothing when the provider already holds the zone", async () => {
    const setTimeZone = vi.fn(async () => undefined);
    await signUpWith(setTimeZone, "America/Bogota")(input);
    expect(setTimeZone).not.toHaveBeenCalled();
  });

  it("removes the half-created user when the zone cannot be stored", async () => {
    const auth = provider();
    const result = await createSignUpWith({
      auth,
      provisionUser: async () => ok(undefined),
      profiles: { setTimeZone: async () => Promise.reject(new Error("db down")) },
      defaultTimeZone: "America/Bogota",
    })({ ...input, timezone: "Europe/Madrid" });
    expect(!result.ok && result.error.details).toEqual({ cause: "ProvisioningThrew" });
    expect(auth.deleteUser).toHaveBeenCalledWith("u-ana");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/identity/application`
Expected: FAIL — `Cannot find module './profile'`, and the sign-up file does not compile (`SignUpDeps` has no `profiles`).

- [ ] **Step 3: Write the application code**

Create `src/modules/identity/application/profile.ts`:

```ts
import { ok, parseTimeZone, type AuthUser, type Result } from "@/shared/kernel";

/** HU-E1-14: where a user's own settings live (the provider's `user` row). */
export interface UserProfiles {
  setTimeZone(userId: string, timeZone: string): Promise<void>;
}

export type UpdateProfile = (input: {
  readonly user: AuthUser;
  readonly timezone?: string;
}) => Promise<Result<AuthUser>>;

/** HU-E1-14: the signed-in user changes their own zone; an unknown zone sent explicitly is InvalidTimeZone. */
export const createUpdateProfile =
  (deps: { readonly profiles: UserProfiles }): UpdateProfile =>
  async (input) => {
    if (input.timezone === undefined) return ok(input.user);
    const zone = parseTimeZone(input.timezone);
    if (!zone.ok) return zone;
    if (zone.value !== input.user.timezone) await deps.profiles.setTimeZone(input.user.id, zone.value);
    return ok({ ...input.user, timezone: zone.value });
  };
```

Replace the contents of `src/modules/identity/application/sign-up.ts`:

```ts
import { canonicalTimeZone, domainError, err, ok, type AuthUser, type Result } from "@/shared/kernel";
import type { AuthProvider, AuthSession } from "./auth-provider";
import type { UserProfiles } from "./profile";

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export interface SignUpDeps {
  readonly auth: AuthProvider;
  /** Creates everything a new user needs (the personal space, Task 11). */
  readonly provisionUser: (user: AuthUser) => Promise<Result<void>>;
  /** HU-E1-14: stores the browser's zone. */
  readonly profiles: UserProfiles;
  /** APP_TIMEZONE: the zone of a user whose browser sent none, or one Intl does not know. */
  readonly defaultTimeZone: string;
}

export type SignUp = (input: {
  name: string;
  email: string;
  password: string;
  /** HU-E1-14: the browser's IANA zone; unusable values fall back to APP_TIMEZONE. */
  timezone?: string;
}) => Promise<Result<AuthSession>>;

export const createSignUp =
  (deps: SignUpDeps): SignUp =>
  async ({ timezone, ...input }) => {
    const created = await deps.auth.signUp({ ...input, email: normalizeEmail(input.email) });
    if (!created.ok) return created;
    const { user } = created.value;
    const zone = canonicalTimeZone(timezone ?? "") ?? deps.defaultTimeZone;
    let cause: string;
    try {
      if (zone !== user.timezone) await deps.profiles.setTimeZone(user.id, zone);
      const provisioned = await deps.provisionUser(user);
      if (provisioned.ok) return ok({ ...created.value, user: { ...user, timezone: zone } });
      cause = provisioned.error.code;
    } catch {
      cause = "ProvisioningThrew";
    }
    // The provider commits the user before provisioning runs; compensate so no half-created user remains.
    try {
      await deps.auth.deleteUser(user.id);
    } catch {
      // The user exists without provisioning; the details let operators find and repair it.
      return err(domainError("InternalError", { cause, compensation: "failed", userId: user.id }));
    }
    return err(domainError("InternalError", { cause }));
  };
```

In `src/modules/identity/application/index.ts`, append to the end of the file:

```ts
export { createUpdateProfile, type UpdateProfile, type UserProfiles } from "./profile";
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/identity/application`
Expected: PASS (the existing sign-up tests unchanged, plus 3 + 6 new).

- [ ] **Step 5: Write the failing adapter test**

Create `src/modules/identity/infrastructure/drizzle-user-profiles.int.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { testDatabase } from "../../../../tests/support/database";
import { userFixture } from "../../../../tests/support/fixtures";
import { DrizzleUserProfiles } from "./drizzle-user-profiles";

const { db, pool } = testDatabase();
const profiles = new DrizzleUserProfiles(new DrizzleTransactionManager(db), "America/Bogota");

afterAll(() => pool.end());

describe("DrizzleUserProfiles (HU-E1-14)", () => {
  it("stores a user's zone and reads it back", async () => {
    const juan = await userFixture(pool, "Juan");
    expect(await profiles.timeZoneOf(juan.id)).toBe("America/Bogota");
    await profiles.setTimeZone(juan.id, "Europe/Madrid");
    expect(await profiles.timeZoneOf(juan.id)).toBe("Europe/Madrid");
  });

  it("answers the deployment zone for an unknown user and for a stored value Intl refuses", async () => {
    expect(await profiles.timeZoneOf("nobody")).toBe("America/Bogota");
    const luis = await userFixture(pool, "Luis");
    await pool.query(`UPDATE "user" SET timezone = 'Mars/Olympus' WHERE id = $1`, [luis.id]);
    expect(await profiles.timeZoneOf(luis.id)).toBe("America/Bogota");
  });
});
```

Run: `pnpm exec vitest run --project integration src/modules/identity/infrastructure/drizzle-user-profiles.int.test.ts`
Expected: FAIL — `Cannot find module './drizzle-user-profiles'`.

- [ ] **Step 6: Write the adapter and the provider defaults**

Create `src/modules/identity/infrastructure/drizzle-user-profiles.ts`:

```ts
import { eq } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { canonicalTimeZone, type UserTimeZones } from "@/shared/kernel";
import type { UserProfiles } from "../application/profile";
import { user } from "./auth.schema";

/** HU-E1-14: the zone on Better Auth's `user` row; read inside the caller's transaction when there is one. */
export class DrizzleUserProfiles implements UserProfiles, UserTimeZones {
  constructor(
    private readonly tm: DrizzleTransactionManager,
    /** APP_TIMEZONE. */
    private readonly fallback: string,
  ) {}

  async setTimeZone(userId: string, timeZone: string): Promise<void> {
    await this.tm.executor().update(user).set({ timezone: timeZone, updatedAt: new Date() }).where(eq(user.id, userId));
  }

  async timeZoneOf(userId: string): Promise<string> {
    const [row] = await this.tm
      .executor()
      .select({ timezone: user.timezone })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    // Ruling P45: never hand a caller a zone Intl would throw on.
    return canonicalTimeZone(row?.timezone ?? "") ?? this.fallback;
  }
}
```

In `src/modules/identity/infrastructure/better-auth.ts`:
1. Replace the line `export const createAuth = (opts: { db: Database; secret: string; baseURL: string }) =>` with:

```ts
export const createAuth = (opts: { db: Database; secret: string; baseURL: string; defaultTimeZone: string }) =>
```

2. Replace the line `        timezone: { type: "string", required: false, defaultValue: "America/Bogota", input: false },` with:

```ts
        // HU-E1-14: sign-up writes the browser's zone through UserProfiles; APP_TIMEZONE until then.
        timezone: { type: "string", required: false, defaultValue: opts.defaultTimeZone, input: false },
```

In `src/modules/identity/infrastructure/better-auth-provider.ts`:
1. Replace the line `const toAuthUser = (u: Record<string, unknown>): AuthUser => ({` with `const toAuthUser = (u: Record<string, unknown>, defaultTimeZone: string): AuthUser => ({`.
2. Replace the line `  timezone: String(u.timezone ?? "America/Bogota"),` with `  timezone: String(u.timezone ?? defaultTimeZone),`.
3. Replace the line `    private readonly db: Database,` with:

```ts
    private readonly db: Database,
    /** APP_TIMEZONE (HU-E1-14). */
    private readonly defaultTimeZone: string,
```

4. Replace the line `    return result ? toAuthUser(result.user as Record<string, unknown>) : null;` with `    return result ? toAuthUser(result.user as Record<string, unknown>, this.defaultTimeZone) : null;`.
5. Replace the line `      user: toAuthUser(body.user),` with `      user: toAuthUser(body.user, this.defaultTimeZone),`.

In `src/modules/identity/infrastructure/better-auth-provider.int.test.ts`, replace the lines from `const provider = new BetterAuthProvider(` to its closing `);` with:

```ts
const provider = new BetterAuthProvider(
  createAuth({
    db,
    secret: "test-secret-0123456789abcdef0123456789",
    baseURL: "http://localhost:3000",
    defaultTimeZone: "America/Bogota",
  }),
  db,
  "America/Bogota",
);
```

Run: `pnpm exec vitest run --project integration src/modules/identity/infrastructure`
Expected: PASS.

- [ ] **Step 7: Write the failing acceptance test**

Create `tests/acceptance/time-zone.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as signUp } from "@/app/api/v1/auth/sign-up/route";
import { GET as getMe, PATCH as patchMe } from "@/app/api/v1/me/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { apiRequest, call, cookieHeader, problemOf, startTestApp, uniqueEmail } from "../support/app";

let app: Container;
beforeAll(() => {
  app = startTestApp(); // APP_TIMEZONE is America/Bogota
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** Signs up over HTTP with an optional browser zone; returns the session cookie. */
const signedUp = async (name: string, timezone?: string) => {
  const response = await signUp(
    apiRequest("POST", "/api/v1/auth/sign-up", {
      body: { name, email: uniqueEmail(name.toLowerCase()), password: "123456789012", timezone },
    }),
  );
  expect(response.status).toBe(201);
  return cookieHeader(response);
};
const zoneOf = async (cookie: string) =>
  ((await (await call(getMe, "GET", "/api/v1/me", { headers: { cookie } })).json()) as { timezone: string }).timezone;
const setZone = (cookie: string, timezone: string) =>
  call(patchMe, "PATCH", "/api/v1/me", { headers: { cookie }, body: { timezone } });

describe("user time zone (HU-E1-14)", () => {
  it("takes the browser's zone at sign-up", async () => {
    expect(await zoneOf(await signedUp("Juan", "Europe/Madrid"))).toBe("Europe/Madrid");
  });

  it("falls back to APP_TIMEZONE without a usable browser zone", async () => {
    expect(await zoneOf(await signedUp("Ana"))).toBe("America/Bogota");
    expect(await zoneOf(await signedUp("Luis", "Mars/Olympus"))).toBe("America/Bogota");
  });

  it("changes my zone, and refuses an unknown one", async () => {
    const ana = await signedUp("Ana");
    const changed = await setZone(ana, "America/New_York");
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as { timezone: string }).timezone).toBe("America/New_York");
    expect(await zoneOf(ana)).toBe("America/New_York");
    expect(await problemOf(await setZone(ana, "Bogota"))).toEqual([422, "InvalidTimeZone"]);
    expect(await zoneOf(ana)).toBe("America/New_York");
  });

  it("needs a session", async () => {
    expect(await problemOf(await call(patchMe, "PATCH", "/api/v1/me", { body: { timezone: "UTC" } }))).toEqual([
      401,
      "Unauthenticated",
    ]);
  });
});
```

Run: `pnpm exec vitest run --project acceptance tests/acceptance/time-zone.test.ts`
Expected: FAIL — `PATCH` is not exported by `src/app/api/v1/me/route.ts`.

- [ ] **Step 8: Wire contracts, route and container**

In `src/modules/identity/contracts/auth.contract.ts`, replace the line `  password: z.string().max(128),` that belongs to `SignUpBodySchema` (the first one in the file) with:

```ts
  password: z.string().max(128),
  /** HU-E1-14: the browser's IANA zone; a missing or unknown one becomes APP_TIMEZONE. */
  timezone: z.string().max(64).optional(),
```

Replace the contents of `src/modules/identity/contracts/me.contract.ts`:

```ts
import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { problemContent } from "@/shared/http/contracts";

export const MeResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  locale: z.string(),
  /** HU-E1-14: the user's IANA time zone. */
  timezone: z.string(),
});

/** HU-E1-14: the profile fields a user changes; validity of the zone is checked by the use case. */
export const UpdateMeBodySchema = z.object({ timezone: z.string().min(1).max(64).optional() });

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }];
const user = (description: string) => ({ description, content: { "application/json": { schema: MeResponseSchema } } });

export const mePaths: ZodOpenApiPathsObject = {
  "/api/v1/me": {
    get: {
      operationId: "getMe",
      summary: "The signed-in user",
      security,
      responses: {
        "200": user("Current user"),
        "401": { description: "Not signed in", content: problemContent },
      },
    },
    patch: {
      operationId: "updateMe",
      summary: "Change the signed-in user's time zone (HU-E1-14)",
      security,
      requestBody: { content: { "application/json": { schema: UpdateMeBodySchema } } },
      responses: {
        "200": user("The updated user"),
        "401": { description: "Not signed in", content: problemContent },
        "422": { description: "ValidationFailed, InvalidTimeZone", content: problemContent },
      },
    },
  },
};
```

Replace the contents of `src/app/api/v1/me/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { UpdateMeBodySchema } from "@/modules/identity/contracts/me.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user }) => ok({ status: 200, body: user }),
});

export const PATCH = defineRoute({
  auth: "required",
  body: UpdateMeBodySchema,
  handler: async ({ user, body }) => {
    const result = await getContainer().identity.updateProfile({ user: user!, timezone: body.timezone });
    return result.ok ? ok({ status: 200, body: result.value }) : result;
  },
});
```

In `src/composition/container.ts`:
1. Insert after the line `  createSignUp,`: `  createUpdateProfile,`; insert before the line `} from "@/modules/identity/application";`: `  type UpdateProfile,`.
2. Insert after the line `import { BetterAuthProvider } from "@/modules/identity/infrastructure/better-auth-provider";`:

```ts
import { DrizzleUserProfiles } from "@/modules/identity/infrastructure/drizzle-user-profiles";
```

3. Replace the line `  readonly identity: { readonly signUp: SignUp; readonly signIn: SignIn; readonly signOut: SignOut };` with:

```ts
  readonly identity: {
    readonly signUp: SignUp;
    readonly signIn: SignIn;
    readonly signOut: SignOut;
    readonly updateProfile: UpdateProfile;
  };
```

4. Replace the lines from `  const provider = new BetterAuthProvider(` to its closing `  );` with:

```ts
  const provider = new BetterAuthProvider(
    createAuth({
      db,
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      defaultTimeZone: env.APP_TIMEZONE,
    }),
    db,
    env.APP_TIMEZONE,
  );
  // HU-E1-14: every user's own zone; the ledger and accounts read it through the kernel's UserTimeZones.
  const profiles = new DrizzleUserProfiles(tm, env.APP_TIMEZONE);
```

5. Replace the line `      signUp: createSignUp({ auth: provider, provisionUser }),` with:

```ts
      signUp: createSignUp({ auth: provider, provisionUser, profiles, defaultTimeZone: env.APP_TIMEZONE }),
      updateProfile: createUpdateProfile({ profiles }),
```

In `docs/backlog/E1-identity-and-spaces.md`, insert after the line `- The last scenario becomes testable with HU-E4-14.`:

```markdown
- Errors (catalogue, spec 8): `InvalidTimeZone` (422) from `PATCH /api/v1/me`; sign-up never refuses a zone (M3-D Task 3).
```

Regenerate the snapshot: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts`. Expected diff: `PATCH /api/v1/me` and the sign-up body's optional `timezone`; no new component.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/time-zone.test.ts tests/acceptance/auth.test.ts`
Expected: PASS.

- [ ] **Step 10: Run the gates, then commit**

```bash
git add src/modules/identity src/app/api/v1/me/route.ts src/composition/container.ts tests/acceptance/time-zone.test.ts openapi/openapi.snapshot.json docs/backlog/E1-identity-and-spaces.md
git commit -m "feat(identity): keep each user's time zone from sign-up and change it with PATCH /me (Refs #94)"
```

---

### Task 4: Ledger domain — the time rules of a transaction

Implements HU-E4-14's create and edit rules as pure functions over a `TransactionTime`; Task 5a puts the fields on `Transaction`.

Decisions:
- `date` keeps its meaning: the local calendar date the transaction counts in; nothing in M3-D renames it to `local_date` (ruling P40). With `occurredAt`, `date` is its local date in `timeZone`; a `date` sent along that differs answers `DateTimeMismatch` (`details.date`, `details.localDate`).
- Every transaction a person records has a time (HU-E4-14 as amended, ruling P66). Create (`timeOf`): `occurredAt` given → its local date; only `date` → that date at `now`'s wall-clock time in the zone, through `instantAt` (a skipped time moves forward, a repeated one takes the first, ruling P42; a date that is today in the zone takes `now` itself); neither → now in the zone; `occurredAt: null` → `TimeRequired` (the zone is the caller's choice, Task 6). Only system paths record a date without a time, and they never reach `timeOf` (Task 6).
- Edit (`retimed`): `occurredAt: null` answers `TimeRequired`, on a transaction with or without a time (a recorded time is replaced, never removed); a new `occurredAt` recomputes the date in the sent zone, else the stored one, else the editor's (ruling P41); a new `date` alone keeps the wall-clock time in the stored zone, through `instantAt` (a skipped time moves forward, a repeated one takes the first, ruling P42); a date alone on a transaction without a time changes only the date.

**Files:**
- Create: `src/modules/ledger/domain/transaction-time.ts`, `src/modules/ledger/domain/transaction-time.test.ts`

**Interfaces:**
- Consumes: `localDateIn`, `wallTimeIn`, `instantAt` (Task 2).
- Produces:
  - `interface TransactionTime { date: LocalDate; occurredAt: Date | null; timeZone: string | null }`
  - `interface TimeChange { date?: LocalDate; occurredAt?: Date | null; timeZone?: string }` (`null` answers `TimeRequired`)
  - `timeOf(input: { date?: LocalDate; occurredAt?: Date | null; timeZone: string; now: Date }): Result<TransactionTime>` — `DateTimeMismatch`, `TimeRequired`
  - `retimed(current: TransactionTime, change: TimeChange, fallbackZone: string): Result<TransactionTime>` — `DateTimeMismatch`, `TimeRequired`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/ledger/domain/transaction-time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { retimed, timeOf, type TransactionTime } from "./transaction-time";

const BOGOTA = "America/Bogota";
const MADRID = "Europe/Madrid";
const day = (iso: string) => iso as LocalDate;
const now = new Date("2026-10-17T03:30:00Z");
const coffee: TransactionTime = { date: day("2026-10-16"), occurredAt: new Date("2026-10-16T19:32:00Z"), timeZone: BOGOTA };
const untimed: TransactionTime = { date: day("2026-10-15"), occurredAt: null, timeZone: null };

describe("timeOf (HU-E4-14)", () => {
  it("dates an instant in the recorder's zone (@critical)", () => {
    const at = new Date("2026-10-16T14:32:00-05:00");
    expect(unwrap(timeOf({ occurredAt: at, timeZone: BOGOTA, now }))).toEqual(coffee);
  });

  it("takes the moment of recording in each user's zone when neither is sent", () => {
    expect(unwrap(timeOf({ timeZone: BOGOTA, now }))).toEqual({ date: "2026-10-16", occurredAt: now, timeZone: BOGOTA });
    expect(unwrap(timeOf({ timeZone: MADRID, now }))).toEqual({ date: "2026-10-17", occurredAt: now, timeZone: MADRID });
  });

  it("gives a date alone the wall-clock time of now in the zone (ruling P66)", () => {
    // `now` is 22:30 on 2026-10-16 in Bogotá and 05:30 on 2026-10-17 in Madrid.
    expect(unwrap(timeOf({ date: day("2026-10-15"), timeZone: BOGOTA, now }))).toEqual({
      date: "2026-10-15",
      occurredAt: new Date("2026-10-16T03:30:00Z"),
      timeZone: BOGOTA,
    });
    expect(unwrap(timeOf({ date: day("2026-10-15"), timeZone: MADRID, now }))).toEqual({
      date: "2026-10-15",
      occurredAt: new Date("2026-10-15T03:30:00Z"),
      timeZone: MADRID,
    });
    expect(unwrap(timeOf({ date: day("2026-10-16"), timeZone: BOGOTA, now })).occurredAt).toEqual(now);
  });

  it("moves a date alone forward when now's time of day is skipped on that date (Review Focus 1)", () => {
    // 02:30 in Madrid on 2026-03-28; on 2026-03-29 02:30 does not exist and becomes 03:30 CEST.
    const early = new Date("2026-03-28T01:30:00Z");
    expect(unwrap(timeOf({ date: day("2026-03-29"), timeZone: MADRID, now: early }))).toEqual({
      date: "2026-03-29",
      occurredAt: new Date("2026-03-29T01:30:00Z"),
      timeZone: MADRID,
    });
  });

  it("refuses an explicit null time (TimeRequired)", () => {
    expect(timeOf({ occurredAt: null, timeZone: BOGOTA, now })).toEqual({ ok: false, error: { code: "TimeRequired" } });
    expect(codeOf(timeOf({ date: day("2026-10-15"), occurredAt: null, timeZone: BOGOTA, now }))).toBe("TimeRequired");
  });

  it("refuses a date that is not the instant's local date", () => {
    const result = timeOf({ date: day("2026-10-15"), occurredAt: coffee.occurredAt!, timeZone: BOGOTA, now });
    expect(result).toEqual({
      ok: false,
      error: { code: "DateTimeMismatch", details: { date: "2026-10-15", localDate: "2026-10-16" } },
    });
    expect(codeOf(timeOf({ date: day("2026-10-16"), occurredAt: coffee.occurredAt!, timeZone: BOGOTA, now }))).toBe("ok");
  });

  it("counts 23:30 on 2026-10-31 in Bogotá in October, whatever its UTC date (Review Focus 1)", () => {
    const late = new Date("2026-10-31T23:30:00-05:00");
    expect(unwrap(timeOf({ occurredAt: late, timeZone: BOGOTA, now })).date).toBe("2026-10-31");
  });
});

describe("retimed (HU-E4-06, HU-E4-14)", () => {
  it("keeps the wall-clock time when only the date changes", () => {
    expect(unwrap(retimed(coffee, { date: day("2026-10-14") }, MADRID))).toEqual({
      date: "2026-10-14",
      occurredAt: new Date("2026-10-14T19:32:00Z"),
      timeZone: BOGOTA,
    });
  });

  it("refuses to remove a time, on a transaction with or without one (TimeRequired)", () => {
    expect(retimed(coffee, { occurredAt: null }, BOGOTA)).toEqual({ ok: false, error: { code: "TimeRequired" } });
    expect(codeOf(retimed(coffee, { occurredAt: null, date: day("2026-10-14") }, BOGOTA))).toBe("TimeRequired");
    expect(codeOf(retimed(untimed, { occurredAt: null }, BOGOTA))).toBe("TimeRequired");
  });

  it("recomputes the date of a new time in the sent zone, else the stored one, else the editor's", () => {
    const at = new Date("2026-10-17T03:30:00Z");
    expect(unwrap(retimed(coffee, { occurredAt: at }, MADRID))).toEqual({ date: "2026-10-16", occurredAt: at, timeZone: BOGOTA });
    expect(unwrap(retimed(coffee, { occurredAt: at, timeZone: MADRID }, BOGOTA)).date).toBe("2026-10-17");
    expect(unwrap(retimed(untimed, { occurredAt: at }, MADRID))).toEqual({ date: "2026-10-17", occurredAt: at, timeZone: MADRID });
    expect(codeOf(retimed(coffee, { occurredAt: at, date: day("2026-10-17") }, MADRID))).toBe("DateTimeMismatch");
  });

  it("changes only the date of a transaction without a time, and nothing without a change", () => {
    expect(unwrap(retimed(untimed, { date: day("2026-10-20") }, BOGOTA))).toEqual({ ...untimed, date: "2026-10-20" });
    expect(unwrap(retimed(coffee, {}, BOGOTA))).toEqual(coffee);
  });

  it("moves a skipped 02:30 forward when a Madrid expense moves onto 2026-03-29 (Review Focus 1)", () => {
    const madrid: TransactionTime = { date: day("2026-03-28"), occurredAt: new Date("2026-03-28T01:30:00Z"), timeZone: MADRID };
    expect(unwrap(retimed(madrid, { date: day("2026-03-29") }, BOGOTA)).occurredAt).toEqual(new Date("2026-03-29T01:30:00Z"));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/domain/transaction-time.test.ts`
Expected: FAIL — `Cannot find module './transaction-time'`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/ledger/domain/transaction-time.ts`:

```ts
import {
  domainError,
  err,
  instantAt,
  localDateIn,
  ok,
  wallTimeIn,
  type LocalDate,
  type Result,
} from "@/shared/kernel";

/** HU-E4-14, D19: the local date a transaction counts in, and when it happened when it has a time. */
export interface TransactionTime {
  readonly date: LocalDate;
  /** The UTC instant; null only for occurrences and rows older than M3-D (ruling P66). */
  readonly occurredAt: Date | null;
  /** The recorder's IANA zone; set exactly when `occurredAt` is. */
  readonly timeZone: string | null;
}

/** What an edit asks for (HU-E4-06): `occurredAt: null` is TimeRequired, since a time is replaced, never removed. */
export interface TimeChange {
  readonly date?: LocalDate;
  readonly occurredAt?: Date | null;
  readonly timeZone?: string;
}

const mismatch = (date: LocalDate, localDate: LocalDate) =>
  err(domainError("DateTimeMismatch", { date, localDate }));

/** HU-E4-14, ruling P66: every transaction a person records or edits has a time. */
const timeRequired = () => err(domainError("TimeRequired"));

/**
 * HU-E4-14, ruling P66: a new transaction's time. With neither a date nor an instant, `now` in `timeZone`; a date
 * alone takes `now`'s time of day on that date there (ruling P42 for a skipped or repeated time).
 */
export const timeOf = (input: {
  readonly date?: LocalDate;
  readonly occurredAt?: Date | null;
  readonly timeZone: string;
  readonly now: Date;
}): Result<TransactionTime> => {
  if (input.occurredAt === null) return timeRequired();
  if (input.occurredAt === undefined && input.date !== undefined) {
    const today = localDateIn(input.now, input.timeZone);
    const occurredAt =
      input.date === today ? input.now : instantAt(input.date, wallTimeIn(input.now, input.timeZone), input.timeZone);
    return ok({ date: input.date, occurredAt, timeZone: input.timeZone });
  }
  const occurredAt = input.occurredAt ?? input.now;
  const date = localDateIn(occurredAt, input.timeZone);
  if (input.date !== undefined && input.date !== date) return mismatch(input.date, date);
  return ok({ date, occurredAt, timeZone: input.timeZone });
};

/**
 * HU-E4-06, HU-E4-14, rulings P41, P42 and P66: an edited time. `fallbackZone` (the editor's) is used only when a
 * new instant is sent and neither the change nor the transaction names a zone. A `timeZone` without an instant
 * changes nothing (ruling P44). A time is replaced, never removed; a row without one keeps none until it gets one.
 */
export const retimed = (
  current: TransactionTime,
  change: TimeChange,
  fallbackZone: string,
): Result<TransactionTime> => {
  if (change.occurredAt === null) return timeRequired();
  if (change.occurredAt !== undefined) {
    const timeZone = change.timeZone ?? current.timeZone ?? fallbackZone;
    const date = localDateIn(change.occurredAt, timeZone);
    if (change.date !== undefined && change.date !== date) return mismatch(change.date, date);
    return ok({ date, occurredAt: change.occurredAt, timeZone });
  }
  if (change.date === undefined) return ok(current);
  if (current.occurredAt === null || current.timeZone === null) return ok({ ...current, date: change.date });
  const wall = wallTimeIn(current.occurredAt, current.timeZone);
  return ok({
    date: change.date,
    occurredAt: instantAt(change.date, wall, current.timeZone),
    timeZone: current.timeZone,
  });
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/ledger/domain/transaction-time.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Run the gates, then commit**

```bash
git add src/modules/ledger/domain/transaction-time.ts src/modules/ledger/domain/transaction-time.test.ts
git commit -m "feat(ledger): define the date and time rules of recording and editing a transaction (Refs #99)"
```

---

### Task 5a: Ledger — the time of every transaction, in the domain and in PostgreSQL

Puts `occurredAt` and `timeZone` on every transaction type, audits them, and stores them in migration `0012_transaction_time`.

Decisions:
- Both columns are nullable; existing rows keep both null ("sin hora") and are never back-filled, from `created_at` or as midnight (HU-E4-14, ruling P40). The check `transactions_time_zone` pins "both or neither"; the domain guards the same invariant with the internal `InvalidTransactionTime`, which no HTTP path can reach (Task 6 always passes a whole `TransactionTime`).
- A stored time is never removed (HU-E4-14 as amended, ruling P66): `reviseTransaction` answers `TimeRequired` when a change would clear it. `retimed` (Task 4) refuses the request first; this guard keeps the invariant for any other caller. A row without a time may get its first one.
- The list index is rebuilt now as `transactions_space_order_idx` on (space, date, `coalesce(occurred_at, '-infinity')`, created_at, id), the order Task 5b queries (ruling P43).
- The audit records `occurredAt` (ISO UTC) and `timeZone` before and after, like every other audited field (HU-E4-14 "an audit entry records its date and time before and after").

**Files:**
- Modify: `src/modules/ledger/domain/transaction.ts`, `src/modules/ledger/domain/transaction.test.ts`, `src/modules/ledger/infrastructure/ledger.schema.ts`, `src/modules/ledger/infrastructure/transaction-rows.ts`, `src/modules/ledger/infrastructure/drizzle-transaction-repository.ts`, `src/modules/ledger/infrastructure/drizzle-transaction-repository.int.test.ts`, `tests/support/in-memory-ledger.ts`, `src/modules/ledger/application/record-occurrence.test.ts` (M3-C's)
- Create (generated): `drizzle/0012_transaction_time.sql`, `drizzle/meta/0012_snapshot.json`, `drizzle/meta/_journal.json` entry

**Interfaces:**
- Consumes: `TransactionTime` (Task 4).
- Produces: every `Transaction` has `occurredAt: Date | null` and `timeZone: string | null`; `NewTransaction` (the input of `recordExpense`, `recordIncome`, `recordTransfer`, `recordFundContribution`, `recordSettlement`) takes optional `occurredAt` and `timeZone`; `TransactionChanges` takes optional `occurredAt: Date | null` and `timeZone: string | null` (`reviseTransaction` answers `TimeRequired` when they would clear a stored time); audit keys `occurredAt`, `timeZone`; columns `transactions.occurred_at`, `transactions.time_zone`.

- [ ] **Step 1: Write the failing domain tests**

In `src/modules/ledger/domain/transaction.test.ts`, insert after each of the two lines `      deletedAt: null,` (the full-object expectations of a recorded expense):

```ts
      occurredAt: null,
      timeZone: null,
```

Append to the end of `src/modules/ledger/domain/transaction.test.ts`:

```ts

describe("transaction time (HU-E4-14)", () => {
  const at = new Date("2026-10-16T19:32:00Z");
  const timed = () =>
    unwrap(
      recordTransfer({
        id: "tx-time" as TransactionId,
        spaceId: "space-ana",
        date: "2026-10-16" as LocalDate,
        occurredAt: at,
        timeZone: "America/Bogota",
        amount: 50_000_000n,
        currency: "COP",
        createdBy: "u-ana",
        now: at,
        sourceAccountId: "acc-bancolombia",
        destinationAccountId: "acc-nequi",
      }),
    );

  it("keeps the instant and the zone it was recorded in", () => {
    expect(timed()).toMatchObject({ date: "2026-10-16", occurredAt: at, timeZone: "America/Bogota" });
  });

  it("refuses an instant without a zone, and a zone without an instant", () => {
    const base = { id: "tx-x" as TransactionId, spaceId: "space-ana", date: "2026-10-16" as LocalDate, amount: 1n };
    const shape = { currency: "COP", createdBy: "u-ana", now: at, sourceAccountId: "a", destinationAccountId: "b" };
    expect(codeOf(recordTransfer({ ...base, ...shape, occurredAt: at }))).toBe("InvalidTransactionTime");
    expect(codeOf(recordTransfer({ ...base, ...shape, timeZone: "America/Bogota" }))).toBe("InvalidTransactionTime");
  });

  it("revises the time and audits it before and after, and never removes it", () => {
    const before = timed();
    const after = unwrap(
      reviseTransaction(before, { date: "2026-10-14" as LocalDate, occurredAt: new Date("2026-10-14T19:32:00Z") }, at),
    );
    expect(changesBetween(before, after)).toEqual({
      date: { from: "2026-10-16", to: "2026-10-14" },
      occurredAt: { from: "2026-10-16T19:32:00.000Z", to: "2026-10-14T19:32:00.000Z" },
    });
    // HU-E4-14, ruling P66: a recorded time is replaced, never removed.
    expect(codeOf(reviseTransaction(after, { occurredAt: null, timeZone: null }, at))).toBe("TimeRequired");
  });
});
```

If the file does not yet import `recordTransfer`, `reviseTransaction`, `changesBetween`, `codeOf`, `LocalDate` or `TransactionId`, add them to its existing import lines from `./transaction`, `../../../../tests/support/fakes` and `@/shared/kernel`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/domain/transaction.test.ts`
Expected: FAIL — `occurredAt` does not exist in type `NewTransaction`, the two full-object expectations miss `occurredAt`, and clearing the time is not refused.

- [ ] **Step 3: Add the fields to the domain**

In `src/modules/ledger/domain/transaction.ts`:

1. Replace the two lines
`  /** Calendar date in the space timezone; its period is derived on read (HU-E4-04). */` and `  readonly date: LocalDate;` (inside `interface TransactionBase`) with:

```ts
  /** The local calendar date it counts in; its period is derived on read (HU-E4-04, HU-E4-14). */
  readonly date: LocalDate;
  /** HU-E4-14, D19: when it happened (UTC); null for a transaction without a time. */
  readonly occurredAt: Date | null;
  /** HU-E4-14: the recorder's IANA zone; set exactly when `occurredAt` is. */
  readonly timeZone: string | null;
```

2. Insert after the line `  readonly date?: LocalDate;` (inside `interface TransactionChanges`):

```ts
  /** HU-E4-14: the resulting time; null keeps a row without one untimed and never clears a stored one (P66). */
  readonly occurredAt?: Date | null;
  readonly timeZone?: string | null;
```

3. Insert after the line `  readonly now: Date;` (inside `interface NewTransaction`):

```ts
  /** HU-E4-14: both absent for a transaction without a time. */
  readonly occurredAt?: Date | null;
  readonly timeZone?: string | null;
```

4. Replace the lines from `const baseOf = (input: NewTransaction): Result<TransactionBase> => {` to its `  const description = descriptionOf(input.description);` line with:

```ts
const baseOf = (input: NewTransaction): Result<TransactionBase> => {
  const amount = positiveAmount(input.amount);
  if (!amount.ok) return amount;
  const occurredAt = input.occurredAt ?? null;
  const timeZone = input.timeZone ?? null;
  // HU-E4-14: an instant and its zone come together (transactions_time_zone); never reachable over HTTP.
  if ((occurredAt === null) !== (timeZone === null)) return err(domainError("InvalidTransactionTime"));
  const description = descriptionOf(input.description);
```

and insert after the line `    date: input.date,` (inside `baseOf`):

```ts
    occurredAt,
    timeZone,
```

5. Insert before the line `  const common = {` (inside `reviseTransaction`):

```ts
  // HU-E4-14, ruling P66: a recorded time is replaced, never removed (retimed refuses the request first).
  if (tx.occurredAt !== null && changes.occurredAt === null) return err(domainError("TimeRequired"));
```

   and insert after the line `    date: changes.date ?? tx.date,` (inside `reviseTransaction`):

```ts
    occurredAt: changes.occurredAt === undefined ? tx.occurredAt : changes.occurredAt,
    timeZone: changes.timeZone === undefined ? tx.timeZone : changes.timeZone,
```

6. Insert before the line `  if (tx.type === "EXPENSE") {` (inside `auditedValues`):

```ts
  // HU-E4-14: the instant as ISO UTC and its zone, so an edit records the time before and after.
  values.set("occurredAt", tx.occurredAt?.toISOString() ?? null);
  values.set("timeZone", tx.timeZone);
```

In `tests/support/in-memory-ledger.ts`, insert after the line `  date: date as LocalDate,` (inside `baseOf`):

```ts
  occurredAt: null,
  timeZone: null,
```

Literal sites: run `rg -n "deletedAt: null," src tests --type ts` and add `occurredAt: null, timeZone: null` beside every hit that builds or expects a whole `Transaction` (today: the two expectations above, `baseOf`, and M3-C's `recordedForAna` in `src/modules/ledger/application/record-occurrence.test.ts` at :66, without which 5 of its tests fail).

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: PASS.

- [ ] **Step 4: Write the failing repository test**

Append to the end of `src/modules/ledger/infrastructure/drizzle-transaction-repository.int.test.ts`:

```ts

describe("transaction time (HU-E4-14)", () => {
  it("round-trips the instant and the zone, and gives a row without them its first time", async () => {
    const at = new Date("2026-10-05T19:32:00.000Z");
    const coffee: Expense = { ...expense(1_200_000n), occurredAt: at, timeZone: "America/Bogota" };
    await repo.add(coffee);
    expect(await repo.findById(space.spaceId, coffee.id)).toEqual(coffee);
    const old = expense(1_100_000n); // as the migration leaves a row: no time
    await repo.add(old);
    expect(await repo.findById(space.spaceId, old.id)).toMatchObject({ occurredAt: null, timeZone: null });
    expect(await repo.save({ ...old, occurredAt: at, timeZone: "America/Bogota" }, old.version)).toBe(true);
    expect(await repo.findById(space.spaceId, old.id)).toMatchObject({ occurredAt: at, timeZone: "America/Bogota", version: 2 });
  });

  it("refuses an instant without its zone (transactions_time_zone)", async () => {
    const market = expense(1_000_000n);
    await repo.add(market);
    await expect(
      pool.query(`UPDATE transactions SET occurred_at = now() WHERE id = $1`, [market.id]),
    ).rejects.toMatchObject({ constraint: "transactions_time_zone" });
  });
});
```

Run: `pnpm exec vitest run --project integration src/modules/ledger/infrastructure/drizzle-transaction-repository.int.test.ts`
Expected: FAIL — the loaded expense has no `occurredAt`, and nothing refuses the broken row.

- [ ] **Step 5: Add the columns, the check and the index, and generate the migration**

In `src/modules/ledger/infrastructure/ledger.schema.ts`:

1. Insert after the line `    date: date("date", { mode: "string" }).notNull(),`:

```ts
    // HU-E4-14, D19: when it happened (UTC) and the recorder's zone; both null for a transaction without a time.
    occurredAt: tz("occurred_at"),
    timeZone: text("time_zone"),
```

2. Replace the two lines `    // The monthly view: one space, a date range, newest first (keyset on date, id).` and `    index("transactions_space_date_idx").on(t.spaceId, t.date, t.id),` with:

```ts
    // HU-E4-14, ruling P43: the list order and its keyset: date, time with untimed rows last, creation, id.
    index("transactions_space_order_idx").on(
      t.spaceId,
      t.date,
      sql`coalesce(${t.occurredAt}, '-infinity'::timestamptz)`,
      t.createdAt,
      t.id,
    ),
```

3. Insert after the line `    check("transactions_amount_positive", sql\`${t.amount} > 0\`),`:

```ts
    check("transactions_time_zone", sql`(${t.occurredAt} IS NULL) = (${t.timeZone} IS NULL)`),
```

In `src/modules/ledger/infrastructure/transaction-rows.ts`, insert after the line `  date: tx.date,` (inside `transactionRow`):

```ts
  occurredAt: tx.occurredAt,
  timeZone: tx.timeZone,
```

and insert after the line `    date: row.date as LocalDate,` (inside `toTransaction`):

```ts
    occurredAt: row.occurredAt,
    timeZone: row.timeZone,
```

In `src/modules/ledger/infrastructure/drizzle-transaction-repository.ts`, insert after the line `        date: transaction.date,` (inside `save`):

```ts
        occurredAt: transaction.occurredAt,
        timeZone: transaction.timeZone,
```

Run: `pnpm db:generate --name transaction_time`
Expected: `drizzle/0012_transaction_time.sql` adds `occurred_at` and `time_zone`, drops `transactions_space_date_idx`, creates `transactions_space_order_idx` and adds `transactions_time_zone`; nothing else.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project integration src/modules/ledger/infrastructure`
Expected: PASS.

- [ ] **Step 7: Run the gates, then commit**

```bash
git add src/modules/ledger/domain/transaction.ts src/modules/ledger/domain/transaction.test.ts src/modules/ledger/infrastructure tests/support/in-memory-ledger.ts src/modules/ledger/application/record-occurrence.test.ts drizzle/0012_transaction_time.sql drizzle/meta
git commit -m "feat(ledger): store when each transaction happened and in which zone (Refs #99)"
```

---

### Task 5b: Ledger — newest day, then newest time, untimed items last

Implements HU-E4-14's list order and its keyset cursor.

Decisions:
- Order: `date DESC, coalesce(occurred_at, '-infinity') DESC, created_at DESC, id DESC`, which is `occurred_at DESC NULLS LAST` written so that one row-value comparison is the keyset predicate and the index of Task 5a serves it (ruling P43). The order is total (id breaks every tie), so a row that nobody edits is visited exactly once; a row edited while a client pages may move across the cursor, as a date edit already could.
- `TransactionPosition` grows from (date, id) to (date, occurredAt, createdAt, id); the cursor's sort key is `date|occurredAt|createdAt` in ISO UTC (empty for no time). A cursor issued before M3-D has no `|` and answers `422 InvalidCursor` (cursors are opaque and short-lived; PR note 1).

**Files:**
- Modify: `src/modules/ledger/application/ports.ts`, `src/modules/ledger/application/list-transactions.ts`, `src/modules/ledger/application/index.ts`, `src/modules/ledger/infrastructure/drizzle-ledger-queries.ts`, `src/modules/ledger/infrastructure/drizzle-ledger-queries.int.test.ts`, `src/modules/ledger/contracts/ledger.contract.ts`, `src/modules/ledger/contracts/ledger.contract.test.ts`, `tests/support/in-memory-ledger.ts`

**Interfaces:**
- Consumes: `Transaction.occurredAt`, `Transaction.createdAt` (Task 5a).
- Produces:
  - `interface TransactionPosition { date: LocalDate; occurredAt: Date | null; createdAt: Date; id: string }`
  - `positionOf(tx: Transaction): TransactionPosition` (`list-transactions.ts`, exported by the ledger's `application/index.ts`)
  - `positionFromCursor(raw: string): Result<TransactionPosition>` with the new sort key; `listOrder(a, b): number` (in-memory twin only)

- [ ] **Step 1: Write the failing tests**

In `src/modules/ledger/infrastructure/drizzle-ledger-queries.int.test.ts`:

1. Insert after the line `import type { TransactionFilter, TransactionPosition } from "../application/ports";`:

```ts
import { InMemoryTransactions } from "../../../../tests/support/in-memory-ledger";
import { positionOf } from "../application/list-transactions";
```

2. Replace the line `    await store(...Array.from({ length: 120 }, () => expense(w, "2026-10-15", 100n)));` with:

```ts
    // One creation instant for all 120: the id alone breaks their ties (ruling P43).
    const at = new Date("2026-10-15T12:00:00.000Z");
    await store(...Array.from({ length: 120 }, () => ({ ...expense(w, "2026-10-15", 100n), createdAt: at })));
```

3. Replace the line `      after = rows.length > 50 && last ? { date: last.date, id: last.id } : null;` with:

```ts
      after = rows.length > 50 && last ? positionOf(last) : null;
```

4. Append to the end of the file:

```ts

describe("the order of a day (HU-E4-14)", () => {
  it("lists Lunch, Market, Rent, Taxi one page at a time, as the in-memory twin does (Review Focus 2)", async () => {
    const w = await world();
    const timed = (date: string, iso: string) => ({
      ...expense(w, date, 100n),
      occurredAt: new Date(iso),
      timeZone: "America/Bogota",
    });
    const taxi = timed("2026-10-15", "2026-10-16T03:40:00.000Z"); // 22:40 on the 15th in Bogotá
    const market = timed("2026-10-16", "2026-10-16T13:10:00.000Z"); // 08:10
    const rent = expense(w, "2026-10-16", 100n); // no time, recorded last
    const lunch = timed("2026-10-16", "2026-10-16T18:05:00.000Z"); // 13:05
    await store(taxi, market, rent, lunch);
    const seen: string[] = [];
    let after: TransactionPosition | null = null;
    do {
      const rows = await queries.list(october(w), after, 2);
      const first = rows[0];
      if (first) seen.push(first.id);
      after = rows.length > 1 && first ? positionOf(first) : null;
    } while (after);
    expect(seen).toEqual([lunch.id, market.id, rent.id, taxi.id]);
    const twin = new InMemoryTransactions();
    twin.rows.push(taxi, rent, lunch, market);
    expect((await twin.list(october(w), null, 50)).map((t) => t.id)).toEqual(seen);
  });
});
```

Append to the end of `src/modules/ledger/contracts/ledger.contract.test.ts` (add `positionFromCursor` and `transactionPageDto` to its import from `./ledger.contract` if absent, and `encodeCursor` from `@/shared/http/pagination`):

```ts

describe("transaction cursors (HU-E4-14)", () => {
  const position = {
    date: "2026-10-16" as LocalDate,
    occurredAt: new Date("2026-10-16T18:05:00.000Z"),
    createdAt: new Date("2026-10-16T18:05:01.000Z"),
    id: "0199f3a2-7c1e-7a10-8b2c-1d2e3f405060",
  };
  const cursorOf = (p: TransactionPosition) =>
    transactionPageDto({
      period: { start: "2026-10-01" as LocalDate, end: "2026-10-31" as LocalDate, label: "2026-10" },
      currency: "COP",
      totals: { expenses: 0n, income: 0n },
      items: [],
      nextPosition: p,
    }).nextCursor!;

  it("round-trips a timed and an untimed position", () => {
    expect(positionFromCursor(cursorOf(position))).toEqual({ ok: true, value: position });
    const untimed = { ...position, occurredAt: null };
    expect(positionFromCursor(cursorOf(untimed))).toEqual({ ok: true, value: untimed });
  });

  it.each([
    ["a cursor from before M3-D", encodeCursor({ sortKey: "2026-10-16", id: position.id })],
    ["an impossible instant", encodeCursor({ sortKey: "2026-10-16||2026-13-45T00:00:00.000Z", id: position.id })],
    ["a malformed id", encodeCursor({ sortKey: "2026-10-16||2026-10-16T18:05:01.000Z", id: "x" })],
  ])("answers InvalidCursor for %s (Review Focus 2)", (_, raw) => {
    expect(positionFromCursor(raw)).toEqual({ ok: false, error: { code: "InvalidCursor" } });
  });
});
```

(`LocalDate` comes from `@/shared/kernel` and `TransactionPosition` from `../application`; add them to the file's imports as types if absent.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run --project integration src/modules/ledger/infrastructure/drizzle-ledger-queries.int.test.ts` and `pnpm exec vitest run --project unit src/modules/ledger/contracts`
Expected: FAIL — `positionOf` is not exported, and the cursor keeps only the date.

- [ ] **Step 3: Write the implementation**

In `src/modules/ledger/application/ports.ts`, replace the lines from `/** Keyset position in the newest-first order (date desc, id desc). */` to the closing `}` of `TransactionPosition` with:

```ts
/** Keyset position in the list order (ruling P43): date, time with untimed rows last, creation, id, all descending. */
export interface TransactionPosition {
  readonly date: LocalDate;
  readonly occurredAt: Date | null;
  readonly createdAt: Date;
  readonly id: string;
}
```

In `src/modules/ledger/application/list-transactions.ts`, replace the line `      nextPosition: rows.length > input.limit && last ? { date: last.date, id: last.id } : null,` with:

```ts
      nextPosition: rows.length > input.limit && last ? positionOf(last) : null,
```

and append to the end of the file:

```ts

/** Ruling P43: where `tx` stands in the list order, for the next page's cursor. */
export const positionOf = (tx: Transaction): TransactionPosition => ({
  date: tx.date,
  occurredAt: tx.occurredAt,
  createdAt: tx.createdAt,
  id: tx.id,
});
```

In `src/modules/ledger/application/index.ts`, append to the end of the file:

```ts
export { positionOf } from "./list-transactions";
```

In `src/modules/ledger/infrastructure/drizzle-ledger-queries.ts`, insert after the line `const sumAsText = (column: AnyColumn) => sql<string>\`sum(${column})::text\`;`:

```ts

// HU-E4-14, ruling P43: untimed rows sort as the earliest time of their day, so they come last in DESC order.
const listTime = sql`coalesce(${transactions.occurredAt}, '-infinity'::timestamptz)`;
```

and replace the method that starts with the line `  async list(` and ends with its first `    return loadTransactions(db, rows);` and closing `  }` with:

```ts
  async list(
    filter: TransactionFilter,
    after: TransactionPosition | null,
    limit: number,
  ): Promise<Transaction[]> {
    const db = this.tm.executor();
    const rows = await db
      .select()
      .from(transactions)
      .where(
        and(
          this.matching(filter),
          after === null
            ? undefined
            : sql`(${transactions.date}, ${listTime}, ${transactions.createdAt}, ${transactions.id}) < (${after.date}::date, ${after.occurredAt?.toISOString() ?? "-infinity"}::timestamptz, ${after.createdAt.toISOString()}::timestamptz, ${after.id}::uuid)`,
        ),
      )
      .orderBy(desc(transactions.date), desc(listTime), desc(transactions.createdAt), desc(transactions.id))
      .limit(limit);
    return loadTransactions(db, rows);
  }
```

Remove the imports ESLint then reports unused in that file (`lt` and `or` if nothing else uses them).

In `tests/support/in-memory-ledger.ts`, insert before the line `/** Repository and query side over one array; mirrors the SQL semantics pinned in Tasks 20–21. */`:

```ts
type Ordered = Pick<Transaction, "date" | "occurredAt" | "createdAt"> & { readonly id: string };

/** Ruling P43, as PostgreSQL orders the list: negative when `a` comes first, positive when it comes after `b`. */
export const listOrder = (a: Ordered, b: Ordered): number => {
  const time = (t: Ordered) => t.occurredAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const keys: [string | number, string | number][] = [
    [b.date, a.date],
    [time(b), time(a)],
    [b.createdAt.getTime(), a.createdAt.getTime()],
    [b.id, a.id],
  ];
  for (const [x, y] of keys) if (x !== y) return x < y ? -1 : 1;
  return 0;
};

```

Replace the line `      .filter((t) => after === null || t.date < after.date || (t.date === after.date && t.id < after.id))` with `      .filter((t) => after === null || listOrder(t, after) > 0)`, and the line `      .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));` with `      .sort(listOrder);`.

In `src/modules/ledger/contracts/ledger.contract.ts`, replace the line `    ? encodeCursor({ sortKey: page.nextPosition.date, id: page.nextPosition.id })` with `    ? encodeCursor(cursorOf(page.nextPosition))`, and replace the lines from `/** A cursor must hold a real date and a UUID, or the keyset query would fail its casts. */` to the closing `};` of `positionFromCursor` with:

```ts
/** Ruling P43: the position as the cursor's sort key `date|occurredAt|createdAt` (ISO UTC; empty without a time). */
const cursorOf = (p: TransactionPosition) => ({
  sortKey: [p.date, p.occurredAt?.toISOString() ?? "", p.createdAt.toISOString()].join("|"),
  id: p.id,
});

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const instantOf = (iso: string): Date | null => {
  const instant = ISO_INSTANT.test(iso) ? new Date(iso) : null;
  return instant !== null && !Number.isNaN(instant.getTime()) && instant.toISOString() === iso ? instant : null;
};

/** A cursor must hold a real date, real instants and a UUID, or the keyset query would fail its casts. */
export const positionFromCursor = (raw: string): Result<TransactionPosition> => {
  const cursor = decodeCursor(raw);
  if (!cursor.ok) return cursor;
  const [date = "", occurred = "", created = "", ...rest] = cursor.value.sortKey.split("|");
  const day = localDate(date);
  const occurredAt = occurred === "" ? null : instantOf(occurred);
  const createdAt = instantOf(created);
  const valid =
    day.ok && rest.length === 0 && createdAt !== null && (occurred === "" || occurredAt !== null) && isUuid(cursor.value.id);
  return valid
    ? ok({ date: day.value, occurredAt, createdAt, id: cursor.value.id })
    : err(domainError("InvalidCursor"));
};
```

`cursorOf` is declared after `transactionPageDto` uses it; both are module-level `const`s used inside a function body, so the order is safe; if ESLint's `no-use-before-define` is configured, move the `cursorOf` block above `transactionPageDto`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/ledger` and `pnpm exec vitest run --project integration src/modules/ledger`
Expected: PASS (the existing paging tests of `list-transactions.test.ts` included).

- [ ] **Step 4b: Mutation check (ruling P88)**

In `src/modules/ledger/infrastructure/drizzle-ledger-queries.ts`, change `'-infinity'` to `'infinity'` in `listTime` and run `pnpm exec vitest run --project integration src/modules/ledger/infrastructure/drizzle-ledger-queries.int.test.ts`.
Expected: FAIL — 2 tests of `drizzle-ledger-queries.int.test.ts` fail. Revert the change and run it again: PASS.

- [ ] **Step 5: Run the gates, then commit**

```bash
git add src/modules/ledger tests/support/in-memory-ledger.ts
git commit -m "feat(ledger): list each day newest time first with untimed items last, keyset by time (Refs #99)"
```

---

### Task 6: Ledger — every write takes its time in the recorder's zone

Implements HU-E4-14's inputs in the five create use cases (direct splits reach `RecordExpense`), the edit rules in `EditTransaction`, and HU-E1-14's "today" in `ListTransactions`.

Decisions:
- The zone is the recorder's (`createdBy`), resolved through `UserTimeZones` when the request sends none; never the payer's (a guest has no zone) nor the space's (ruling P41). Only an untimed system record reads no zone at all.
- Every transaction a person records has a time (HU-E4-14 as amended, ruling P66): a `date` alone takes the Clock's time of day in the zone (Task 4), and `occurredAt: null` answers `TimeRequired` on every create and edit. Only system paths record a date without a time: M3-C's `recordOccurrence`, shared by AUTO runs and confirmations, sends `untimed: true`, an input field no request body maps to (ruling P70).
- A `timeZone` is always validated (`InvalidTimeZone`). On a create it is the zone of the resulting time, with an instant or with a date alone; on an edit without `occurredAt` it is ignored (ruling P44, narrowed to edits by the amended HU-E4-14; ruling P69).
- `ListTransactions` without a period resolves it from today in the requester's zone. Space-level clocks keep `LedgerDeps.timeZone` (`APP_TIMEZONE`): M3-C's scheduler, plan closing and `GET …/periods` (HU-E1-14 note).
- Validation order of a create: the existing checks, then the time (`InvalidTimeZone`, `TimeRequired`, `DateTimeMismatch`), then the closed period of the resulting date (P14 unchanged).

**Files:**
- Create: `src/modules/ledger/application/when.ts`, `src/modules/ledger/application/when.test.ts`, `src/modules/ledger/application/transaction-time.test.ts`
- Modify: `src/modules/ledger/application/deps.ts`, `src/modules/ledger/application/record-expense.ts`, `src/modules/ledger/application/record-income.ts`, `src/modules/ledger/application/record-transfer.ts`, `src/modules/ledger/application/record-fund-contribution.ts`, `src/modules/ledger/application/record-settlement.ts`, `src/modules/ledger/application/record-occurrence.ts`, `src/modules/ledger/application/record-occurrence.test.ts` (both M3-C's), `src/modules/ledger/application/edit-transaction.ts`, `src/modules/ledger/application/list-transactions.ts`, `src/composition/container.ts`, `tests/support/in-memory-ledger.ts`, `src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts`, `src/modules/ledger/infrastructure/concurrent-occurrences.int.test.ts` (M3-C's), `tests/acceptance/ledger.test.ts`

**Interfaces:**
- Consumes: `UserTimeZones`, `parseTimeZone` (Task 2); `timeOf`, `retimed`, `TransactionTime`, `TimeChange` (Task 4); `DrizzleUserProfiles` as `profiles` in `buildContainer` (Task 3); `fixedTimeZones` (Task 2); M3-C's `recordOccurrence` (its `base` object) and the file-local helpers of `record-occurrence.test.ts` (`recurrenceWorld`, `recurrenceOf`, `fromTheFund`, `on`).
- Produces:
  - `LedgerDeps.userTimeZones: UserTimeZones`
  - `interface WhenInput { userId: string; date?: LocalDate; occurredAt?: Date | null; timeZone?: string; untimed?: true }`
  - `whenOf(deps: Pick<LedgerDeps, "clock" | "userTimeZones">, input: WhenInput): Promise<Result<TransactionTime>>` — `InvalidTimeZone`, `DateTimeMismatch`, `TimeRequired`
  - `editedTime(deps: Pick<LedgerDeps, "userTimeZones">, current: TransactionTime, userId: string, change: TimeChange): Promise<Result<TransactionTime>>`
  - `RecordExpenseInput`, `RecordIncomeInput`, `RecordTransferInput`, `RecordFundContributionInput`, `RecordSettlementInput` gain `occurredAt?: Date | null`, `timeZone?: string` and `untimed?: true` (system paths only); `EditChanges` gains `occurredAt?: Date | null` (`null` answers `TimeRequired`) and `timeZone?: string`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/ledger/application/when.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock, type LocalDate } from "@/shared/kernel";
import { codeOf, fixedTimeZones, unwrap } from "../../../../tests/support/fakes";
import { editedTime, whenOf } from "./when";

const now = new Date("2026-10-17T03:30:00Z");
const depsWith = (zones = fixedTimeZones({ "u-juan": "Europe/Madrid" })) => ({
  clock: new FixedClock(now),
  userTimeZones: zones,
});

describe("whenOf (HU-E4-14)", () => {
  it("takes each recorder's own zone for the moment of recording", async () => {
    expect(unwrap(await whenOf(depsWith(), { userId: "u-ana" }))).toEqual({
      date: "2026-10-16",
      occurredAt: now,
      timeZone: "America/Bogota",
    });
    expect(unwrap(await whenOf(depsWith(), { userId: "u-juan" }))).toEqual({
      date: "2026-10-17",
      occurredAt: now,
      timeZone: "Europe/Madrid",
    });
  });

  it("prefers a sent zone by its canonical name and refuses an unknown one", async () => {
    expect(unwrap(await whenOf(depsWith(), { userId: "u-ana", timeZone: "europe/madrid" })).timeZone).toBe(
      "Europe/Madrid",
    );
    expect(codeOf(await whenOf(depsWith(), { userId: "u-ana", timeZone: "Bogota" }))).toBe("InvalidTimeZone");
  });

  it("gives a date alone the time of day of now, in the sent zone or the recorder's (P66)", async () => {
    const date = "2026-10-15" as LocalDate;
    expect(unwrap(await whenOf(depsWith(), { userId: "u-ana", date }))).toEqual({
      date,
      occurredAt: new Date("2026-10-16T03:30:00Z"), // 22:30 in Bogotá
      timeZone: "America/Bogota",
    });
    expect(unwrap(await whenOf(depsWith(), { userId: "u-ana", date, timeZone: "Europe/Madrid" }))).toEqual({
      date,
      occurredAt: new Date("2026-10-15T03:30:00Z"), // 05:30 in Madrid
      timeZone: "Europe/Madrid",
    });
  });

  it("refuses a null time, and leaves only an untimed system record without one, reading no zone (P66)", async () => {
    expect(codeOf(await whenOf(depsWith(), { userId: "u-ana", occurredAt: null }))).toBe("TimeRequired");
    const zones = fixedTimeZones();
    const date = "2026-10-15" as LocalDate;
    expect(unwrap(await whenOf(depsWith(zones), { userId: "u-ana", date, untimed: true }))).toEqual({
      date,
      occurredAt: null,
      timeZone: null,
    });
    expect(zones.asked).toEqual([]);
  });
});

describe("editedTime (HU-E4-06, HU-E4-14)", () => {
  const untimed = { date: "2026-10-15" as LocalDate, occurredAt: null, timeZone: null };

  it("asks the editor's zone only for a new time on a transaction without one", async () => {
    const zones = fixedTimeZones({ "u-juan": "Europe/Madrid" });
    expect(unwrap(await editedTime({ userTimeZones: zones }, untimed, "u-juan", { occurredAt: now }))).toEqual({
      date: "2026-10-17",
      occurredAt: now,
      timeZone: "Europe/Madrid",
    });
    await editedTime({ userTimeZones: zones }, untimed, "u-juan", { date: "2026-10-20" as LocalDate });
    expect(zones.asked).toEqual(["u-juan"]);
  });

  it("refuses an unknown zone and a null time", async () => {
    expect(codeOf(await editedTime({ userTimeZones: fixedTimeZones() }, untimed, "u-ana", { timeZone: "x" }))).toBe(
      "InvalidTimeZone",
    );
    expect(codeOf(await editedTime({ userTimeZones: fixedTimeZones() }, untimed, "u-ana", { occurredAt: null }))).toBe(
      "TimeRequired",
    );
  });
});
```

Create `src/modules/ledger/application/transaction-time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock, type LocalDate } from "@/shared/kernel";
import { codeOf, fixedTimeZones, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, anExpense, CATEGORIES, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import { createEditTransaction } from "./edit-transaction";
import { createListTransactions } from "./list-transactions";
import { createRecordExpense } from "./record-expense";
import { createRecordIncome } from "./record-income";
import { createRecordTransfer } from "./record-transfer";

const at = new Date("2026-10-17T03:30:00Z");
const fixture = (zones: Record<string, string> = {}, clock = at) =>
  ledgerFixture({ clock: new FixedClock(clock), userTimeZones: fixedTimeZones(zones) });
const asAna = { spaceId: "space-ana", userId: "u-ana" };
const coffee = {
  ...asAna,
  description: "Coffee",
  categoryId: CATEGORIES.restaurants.id,
  amount: money(1_200_000n),
  accountId: ACCOUNTS.bancolombia.id,
};
const timeOf = (tx: { date: string; occurredAt: Date | null; timeZone: string | null }) => [
  tx.date,
  tx.occurredAt?.toISOString() ?? null,
  tx.timeZone,
];

describe("recording with a time (HU-E4-14)", () => {
  it("takes the moment of recording in the recorder's zone", async () => {
    const recorded = unwrap(await createRecordExpense(fixture().deps)(coffee)).expense;
    expect(timeOf(recorded)).toEqual(["2026-10-16", "2026-10-17T03:30:00.000Z", "America/Bogota"]);
    const inMadrid = unwrap(await createRecordExpense(fixture({ "u-ana": "Europe/Madrid" }).deps)(coffee)).expense;
    expect(timeOf(inMadrid)).toEqual(["2026-10-17", "2026-10-17T03:30:00.000Z", "Europe/Madrid"]);
  });

  it("records the instant it happened, gives a date alone the time of day of now, and refuses the rest", async () => {
    const record = createRecordExpense(fixture().deps);
    const occurredAt = new Date("2026-10-16T14:32:00-05:00");
    expect(timeOf(unwrap(await record({ ...coffee, occurredAt })).expense)).toEqual([
      "2026-10-16",
      "2026-10-16T19:32:00.000Z",
      "America/Bogota",
    ]);
    const date = "2026-10-15" as LocalDate;
    expect(timeOf(unwrap(await record({ ...coffee, date })).expense)).toEqual([
      "2026-10-15",
      "2026-10-16T03:30:00.000Z",
      "America/Bogota",
    ]);
    expect(codeOf(await record({ ...coffee, date, occurredAt }))).toBe("DateTimeMismatch");
    expect(codeOf(await record({ ...coffee, occurredAt: null }))).toBe("TimeRequired");
    expect(codeOf(await record({ ...coffee, timeZone: "Bogota" }))).toBe("InvalidTimeZone");
  });

  it("gives incomes and transfers the same time rules", async () => {
    const { deps } = fixture();
    const occurredAt = new Date("2026-10-16T14:32:00-05:00");
    const income = unwrap(
      await createRecordIncome(deps)({
        ...asAna,
        categoryId: CATEGORIES.salary.id,
        amount: money(320_000_000n),
        accountId: ACCOUNTS.bancolombia.id,
        occurredAt,
      }),
    );
    const transfer = unwrap(
      await createRecordTransfer(deps)({
        ...asAna,
        amount: money(50_000_000n),
        sourceAccountId: ACCOUNTS.bancolombia.id,
        destinationAccountId: ACCOUNTS.nequi.id,
        occurredAt,
        timeZone: "Europe/Madrid",
      }),
    );
    expect(timeOf(income)).toEqual(["2026-10-16", "2026-10-16T19:32:00.000Z", "America/Bogota"]);
    expect(timeOf(transfer)).toEqual(["2026-10-16", "2026-10-16T19:32:00.000Z", "Europe/Madrid"]);
  });
});

describe("editing a time (HU-E4-06, HU-E4-14)", () => {
  it("keeps the local time when the date changes, audits it, never removes it, and times an old row", async () => {
    const { deps, store, audit } = fixture();
    const stored = anExpense("2026-10-16", 1_200_000n, {
      occurredAt: new Date("2026-10-16T19:32:00Z"),
      timeZone: "America/Bogota",
    });
    store.rows.push(stored);
    const edit = createEditTransaction(deps);
    const moved = unwrap(
      await edit({ ...asAna, transactionId: stored.id, expectedVersion: null, changes: { date: "2026-10-14" as LocalDate } }),
    );
    expect(timeOf(moved)).toEqual(["2026-10-14", "2026-10-14T19:32:00.000Z", "America/Bogota"]);
    expect(audit.entries.at(-1)?.changes).toEqual({
      date: { from: "2026-10-16", to: "2026-10-14" },
      occurredAt: { from: "2026-10-16T19:32:00.000Z", to: "2026-10-14T19:32:00.000Z" },
    });
    const removal = await edit({ ...asAna, transactionId: stored.id, expectedVersion: null, changes: { occurredAt: null } });
    expect(codeOf(removal)).toBe("TimeRequired");
    expect(timeOf(store.rows.find((t) => t.id === stored.id)!)).toEqual([
      "2026-10-14",
      "2026-10-14T19:32:00.000Z",
      "America/Bogota",
    ]);
    // "Old market", as the migration left it: no time until someone edits one in, in the editor's zone.
    const old = anExpense("2026-09-20", 1_000_000n);
    store.rows.push(old);
    const timed = unwrap(
      await edit({
        ...asAna,
        transactionId: old.id,
        expectedVersion: null,
        changes: { occurredAt: new Date("2026-09-20T10:00:00-05:00") },
      }),
    );
    expect(timeOf(timed)).toEqual(["2026-09-20", "2026-09-20T15:00:00.000Z", "America/Bogota"]);
  });
});

describe("the current period (HU-E1-14, HU-E4-14)", () => {
  it("is the period of today in the requester's zone", async () => {
    const instant = new Date("2026-11-01T04:30:00Z");
    const list = (zones: Record<string, string>) =>
      createListTransactions(fixture(zones, instant).deps)({ ...asAna, after: null, limit: 50 });
    expect(unwrap(await list({})).period.label).toBe("2026-10");
    expect(unwrap(await list({ "u-ana": "Europe/Madrid" })).period.label).toBe("2026-11");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/when.test.ts src/modules/ledger/application/transaction-time.test.ts`
Expected: FAIL — `Cannot find module './when'`, and `userTimeZones` is not a `LedgerDeps` property.

- [ ] **Step 3: Write `when.ts` and the port**

Create `src/modules/ledger/application/when.ts`:

```ts
import { ok, parseTimeZone, type LocalDate, type Result } from "@/shared/kernel";
import { retimed, timeOf, type TimeChange, type TransactionTime } from "../domain/transaction-time";
import type { LedgerDeps } from "./deps";

/** HU-E4-14: what a create request says about when it happened. */
export interface WhenInput {
  readonly userId: string;
  readonly date?: LocalDate;
  /** Null answers TimeRequired (ruling P66). */
  readonly occurredAt?: Date | null;
  readonly timeZone?: string;
  /** Ruling P66: system paths only (M3-C's recordOccurrence), the date with no time; no request body maps to it. */
  readonly untimed?: true;
}

const sentZone = (raw: string | undefined): Result<string | null> =>
  raw === undefined ? ok(null) : parseTimeZone(raw);

/** HU-E4-14, rulings P41 and P66: the recorder's zone unless one is sent; only an untimed system record reads none. */
export const whenOf = async (
  deps: Pick<LedgerDeps, "clock" | "userTimeZones">,
  input: WhenInput,
): Promise<Result<TransactionTime>> => {
  const sent = sentZone(input.timeZone);
  if (!sent.ok) return sent;
  if (input.untimed === true && input.date !== undefined && input.occurredAt === undefined) {
    return ok({ date: input.date, occurredAt: null, timeZone: null });
  }
  const timeZone = sent.value ?? (await deps.userTimeZones.timeZoneOf(input.userId));
  return timeOf({ date: input.date, occurredAt: input.occurredAt, timeZone, now: deps.clock.now() });
};

/** HU-E4-06, HU-E4-14: the time an edit asks for; the editor's zone only for a new time with no zone anywhere. */
export const editedTime = async (
  deps: Pick<LedgerDeps, "userTimeZones">,
  current: TransactionTime,
  userId: string,
  change: TimeChange,
): Promise<Result<TransactionTime>> => {
  const sent = sentZone(change.timeZone);
  if (!sent.ok) return sent;
  const needsEditorZone = change.occurredAt instanceof Date && sent.value === null && current.timeZone === null;
  // `retimed` reads the fallback only in that case; any other value is never used.
  const fallback = needsEditorZone ? await deps.userTimeZones.timeZoneOf(userId) : "UTC";
  return retimed(current, { date: change.date, occurredAt: change.occurredAt, timeZone: sent.value ?? undefined }, fallback);
};
```

In `src/modules/ledger/application/deps.ts`:
1. Replace the line `import type { Clock, IdGenerator, TransactionManager } from "@/shared/kernel";` with `import type { Clock, IdGenerator, TransactionManager, UserTimeZones } from "@/shared/kernel";`.
2. Replace the lines `  /** The space timezone; v1 uses the deployment timezone (APP_TIMEZONE). */` and `  readonly timeZone: string;` with:

```ts
  /** The deployment time zone (APP_TIMEZONE), for space-level clocks only (HU-E1-14). */
  readonly timeZone: string;
  /** HU-E1-14, HU-E4-14: each user's own zone, for "today" and the time of what they record. */
  readonly userTimeZones: UserTimeZones;
```

- [ ] **Step 4: Use it in the five create use cases**

In each of `record-expense.ts`, `record-income.ts`, `record-transfer.ts`, `record-fund-contribution.ts` and `record-settlement.ts` (all in `src/modules/ledger/application/`):

1. Insert after the line `  readonly date?: LocalDate;` (inside the `Record…Input` interface):

```ts
  /** HU-E4-14: when it happened; a `date` sent with it must be its local date in the zone; null is TimeRequired. */
  readonly occurredAt?: Date | null;
  /** HU-E4-14: an IANA zone; the recorder's when absent. */
  readonly timeZone?: string;
  /** HU-E4-14, ruling P66: system paths only (M3-C's `recordOccurrence`): the `date` with no time. */
  readonly untimed?: true;
```

2. Replace the line `      const date = input.date ?? todayIn(deps.clock, deps.timeZone);` with:

```ts
      // HU-E4-14: the recorder's zone unless the request names one (ruling P41).
      const when = await whenOf(deps, input);
      if (!when.ok) return when;
      const { date, occurredAt, timeZone } = when.value;
```

3. Insert after the line `        createdBy: input.userId,`:

```ts
        occurredAt,
        timeZone,
```

4. Insert after the line `import type { LedgerDeps } from "./deps";`: `import { whenOf } from "./when";`.

5. Remove `todayIn` from the `@/shared/kernel` import: in `record-expense.ts` the line becomes `import { domainError, err, map, ok, type LocalDate, type Money, type Result } from "@/shared/kernel";`; in `record-income.ts` `import { flatMap, type LocalDate, type Money, type Result } from "@/shared/kernel";`; in `record-transfer.ts` `import { domainError, err, flatMap, type LocalDate, type Money, type Result } from "@/shared/kernel";`; in `record-fund-contribution.ts` and `record-settlement.ts` `import type { LocalDate, Money, Result } from "@/shared/kernel";`.

- [ ] **Step 5: Edits and the current period**

In `src/modules/ledger/application/edit-transaction.ts`:
1. Insert after the line `  readonly date?: LocalDate;` (inside `EditChanges`):

```ts
  /** HU-E4-14: a new instant; null answers TimeRequired, since a time is replaced, never removed (P66). */
  readonly occurredAt?: Date | null;
  readonly timeZone?: string;
```

2. Replace the line `      const { amount, ...rest } = input.changes;` with `      const { amount, date, occurredAt, timeZone, ...rest } = input.changes;`.
3. Replace the line `      const revised = reviseTransaction(current, { ...rest, amount: amount?.minor }, now);` with:

```ts
      // HU-E4-14: a new date keeps the wall-clock time; a new time recomputes the date (ruling P42).
      const time = await editedTime(deps, current, input.userId, { date, occurredAt, timeZone });
      if (!time.ok) return time;
      // Only the three time fields: retimed answers the transaction itself when the time does not change.
      const { date: newDate, occurredAt: newOccurredAt, timeZone: newTimeZone } = time.value;
      const revised = reviseTransaction(
        current,
        { ...rest, date: newDate, occurredAt: newOccurredAt, timeZone: newTimeZone, amount: amount?.minor },
        now,
      );
```

4. Replace the line `import type { LedgerDeps } from "./deps";` with:

```ts
import type { LedgerDeps } from "./deps";
import { editedTime } from "./when";
```

In `src/modules/ledger/application/list-transactions.ts`, replace the line `        ? ok(resolvePeriod(space.periodPolicy, stored, todayIn(deps.clock, deps.timeZone)))` with:

```ts
        ? ok(resolvePeriod(space.periodPolicy, stored, todayIn(deps.clock, await deps.userTimeZones.timeZoneOf(input.userId))))
```

- [ ] **Step 5b: Bind the port and fix the literal sites**

In `src/composition/container.ts`, insert after the line `    accountBalances: accountBalancesFrom(getAccount),`:

```ts
    // HU-E1-14, HU-E4-14: each recorder's own zone; the ledger never imports identity.
    userTimeZones: profiles,
```

In `tests/support/in-memory-ledger.ts`, replace the line `import { fakeSpaceAccess, memoryTm, membership, noStoredPeriods, sequentialIds } from "./fakes";` with:

```ts
import { fakeSpaceAccess, fixedTimeZones, memoryTm, membership, noStoredPeriods, sequentialIds } from "./fakes";
```

and insert after the line `    timeZone: "America/Bogota",` (inside `ledgerFixture`):

```ts
    userTimeZones: fixedTimeZones(),
```

Literal sites: run `rg -n "closedPeriods:" src tests --type ts`; every object literal it lists that is a `LedgerDeps` (today `ledgerFixture`, the ledger deps of `src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts`, which passes `closedPeriods,` in shorthand, so the rg lists only its parameter at :352, and M3-C's `src/modules/ledger/infrastructure/concurrent-occurrences.int.test.ts` at :76, whose import from `tests/support/fakes` gains `fixedTimeZones`) gains the line `userTimeZones: fixedTimeZones(),` with `fixedTimeZones` imported from `tests/support/fakes`. Every record through a create use case now has a time, with or without a `date` (ruling P66): if an existing test expects a whole recorded transaction with the `occurredAt: null, timeZone: null` of Task 5a's literal sites, it now expects the recorded time (`occurredAt: expect.any(Date)` and the recorder's zone), and if it asserts a whole audit `changes` object after a date edit, that object now also holds `occurredAt`: add that key; and a deletion audit of a recorded transaction now also retires its `occurredAt` and `timeZone` (the `tests/acceptance/ledger.test.ts` edit below). A list expectation that relied on date-only records sorting after the timed ones of their day now follows their times (on a fixed clock they tie and fall back to creation order); the preflight runs `rg -n "date: \"20" tests/acceptance --type ts` and checks each same-day order it finds. Occurrences recorded by M3-C keep both null once the next block lands.

In `tests/acceptance/ledger.test.ts` (the `DELETED` entry of "returns the split an edit replaced and the whole version a deletion retired"), insert after the line `          date: { from: "2026-10-05", to: null },`:

```ts
          // HU-E4-14: a date alone took the time of day of recording; a deletion retires it too.
          occurredAt: { from: expect.any(String), to: null },
          timeZone: { from: "America/Bogota", to: null },
```

Append to the end of `src/modules/ledger/application/record-occurrence.test.ts` (M3-C's file; its helpers are in scope):

```ts

describe("occurrences have no time (HU-E4-14, ruling P66)", () => {
  it("records an occurrence with its date and no time, as the scheduler and a confirmation do", async () => {
    const { deps } = recurrenceWorld();
    const recorded = unwrap(
      await recordOccurrence(occurrenceRecorders(deps), recurrenceOf(fromTheFund), on("u-ana", 1_200_000n)),
    );
    expect(recorded.transaction).toMatchObject({ date: "2026-12-01", occurredAt: null, timeZone: null });
  });
});
```

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/record-occurrence.test.ts`
Expected: FAIL — the occurrence takes the Clock's time of day on 2026-12-01, because `recordOccurrence` sends only its `date`.

In `src/modules/ledger/application/record-occurrence.ts`, insert after the line `    date: occurrence.date,` (inside `recordOccurrence`'s `base`):

```ts
    // HU-E4-14, ruling P66: an occurrence, AUTO or confirmed, carries its date and no time.
    untimed: true as const,
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/ledger`, `pnpm exec vitest run --project integration src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts src/modules/ledger/infrastructure/concurrent-occurrences.int.test.ts` and `pnpm exec vitest run --project acceptance tests/acceptance/ledger.test.ts`
Expected: PASS (`record-occurrence.test.ts` included).

- [ ] **Step 6b: Mutation check (ruling P88)**

Delete the line `    untimed: true as const,` from `recordOccurrence` in `src/modules/ledger/application/record-occurrence.ts` and run `pnpm exec vitest run --project unit src/modules/ledger/application/record-occurrence.test.ts`.
Expected: FAIL — 6 tests of `record-occurrence.test.ts` fail. Restore the line and run it again: PASS.

- [ ] **Step 7: Run the gates, then commit**

```bash
git add src/modules/ledger/application src/composition/container.ts tests/support/in-memory-ledger.ts src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts src/modules/ledger/infrastructure/concurrent-occurrences.int.test.ts tests/acceptance/ledger.test.ts
git commit -m "feat(ledger): record and edit each transaction's time in its recorder's zone (Refs #99, Refs #94)"
```

---

### Task 7a: HTTP — every create endpoint takes `occurredAt` and `timeZone`

Exposes Task 6 on `POST …/expenses`, `…/incomes`, `…/transfers`, `…/fund-contributions`, `…/settlements` and `POST /api/v1/direct-splits`, and returns the time on every transaction.

Decisions:
- `occurredAt` is RFC 3339 with any offset (`z.iso.datetime({ offset: true })`), returned in UTC by `toISOString()` (milliseconds included, like `createdAt`); `timeZone` is a string of 1–64 characters whose validity is the use case's (`InvalidTimeZone`) (ruling P44).
- `DateTimeMismatch` maps explicitly to 422 in `src/shared/http/problem.ts` (the default would be 409, HU-E4-14 note).
- `occurredAt` is `nullable()` in the six create bodies only so that an explicit `null` reaches the use case and answers `TimeRequired`, mapped explicitly to 422 like `DateTimeMismatch`, instead of `ValidationFailed` (HU-E4-14 as amended, rulings P66 and P70).

**Files:**
- Modify: `src/modules/ledger/contracts/ledger.contract.ts`, `src/modules/ledger/contracts/ledger.contract.test.ts`, `src/app/api/v1/spaces/[spaceId]/incomes/route.ts`, `src/app/api/v1/spaces/[spaceId]/transfers/route.ts`, `src/shared/http/problem.ts`, `src/shared/http/problem.test.ts`, `tests/support/ledger.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E4-ledger.md`
- Create: `tests/acceptance/transaction-time.test.ts`

**Interfaces:**
- Consumes: the use case inputs of Task 6.
- Produces: `whenFromBody(body: { date?: string; occurredAt?: string | null; timeZone?: string }): Result<{ date?: LocalDate; occurredAt?: Date | null; timeZone?: string }>`; `Instant`, `TimeZoneName` (module constants); `TransactionSchema.occurredAt`, `TransactionSchema.timeZone`; `TransactionDto.occurredAt`, `TransactionDto.timeZone` (tests/support/ledger.ts).

- [ ] **Step 1: Write the failing tests**

Append to the end of `src/shared/http/problem.test.ts`:

```ts

describe("statusForCode (HU-E1-14, HU-E4-14)", () => {
  it.each([
    ["DateTimeMismatch", 422],
    ["TimeRequired", 422],
    ["InvalidTimeZone", 422],
  ])("maps %s to %i", (code, status) => {
    expect(statusForCode(code)).toBe(status);
  });
});
```

Create `tests/acceptance/transaction-time.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PATCH as patchMe } from "@/app/api/v1/me/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordFundContribution } from "@/app/api/v1/spaces/[spaceId]/fund-contributions/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { FixedClock } from "@/shared/kernel";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { categoryWithKey, cop, household, newAccount, post, type TransactionDto } from "../support/ledger";

let app: Container;
beforeAll(() => {
  // HU-E4-14 Background: the Clock reads 2026-10-17T03:30:00Z.
  app = startTestApp({ clock: new FixedClock(new Date("2026-10-17T03:30:00Z")) });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const setZone = (user: TestUser, timezone: string) =>
  call(patchMe, "PATCH", "/api/v1/me", { user, body: { timezone } });
/** Ana (Bogotá by APP_TIMEZONE) with "Bancolombia" in her personal space. */
const ana = async () => {
  const user = await registerUser("Ana");
  return { user, bank: await newAccount(user, "Bancolombia", 2_000_000), restaurants: await categoryWithKey(user, "restaurants") };
};
type Ana = Awaited<ReturnType<typeof ana>>;
const expense = (a: Ana, extra: Record<string, unknown>) =>
  post(recordExpense, a.user, "expenses", {
    description: "Coffee",
    categoryId: a.restaurants,
    amount: cop(12_000),
    accountId: a.bank,
    ...extra,
  });
const timeOf = async (response: Response) => {
  expect(response.status).toBe(201);
  const tx = (await response.json()) as TransactionDto;
  return [tx.date, tx.occurredAt, tx.timeZone];
};

describe("recording the time of a transaction (HU-E4-14)", () => {
  it("records an expense with the time it happened (@critical)", async () => {
    const a = await ana();
    expect(await timeOf(await expense(a, { occurredAt: "2026-10-16T14:32:00-05:00" }))).toEqual([
      "2026-10-16",
      "2026-10-16T19:32:00.000Z",
      "America/Bogota",
    ]);
  });

  it("takes the moment of recording in each user's zone without a date or a time", async () => {
    const a = await ana();
    const juan = await ana();
    expect((await setZone(juan.user, "Europe/Madrid")).status).toBe(200);
    expect(await timeOf(await expense(a, {}))).toEqual(["2026-10-16", "2026-10-17T03:30:00.000Z", "America/Bogota"]);
    expect(await timeOf(await expense(juan, {}))).toEqual(["2026-10-17", "2026-10-17T03:30:00.000Z", "Europe/Madrid"]);
  });

  it("gives a date alone the time of day of now, and refuses a disagreeing pair, a null time or an unknown zone", async () => {
    const a = await ana();
    expect(await timeOf(await expense(a, { date: "2026-10-15" }))).toEqual([
      "2026-10-15",
      "2026-10-16T03:30:00.000Z",
      "America/Bogota",
    ]);
    expect(await problemOf(await expense(a, { date: "2026-10-15", occurredAt: "2026-10-16T14:32:00-05:00" }))).toEqual([
      422,
      "DateTimeMismatch",
    ]);
    expect(await problemOf(await expense(a, { occurredAt: null }))).toEqual([422, "TimeRequired"]);
    expect(await problemOf(await expense(a, { timeZone: "Bogota" }))).toEqual([422, "InvalidTimeZone"]);
  });

  it("takes a time on incomes, transfers, fund contributions and settlements", async () => {
    const a = await ana();
    const occurredAt = "2026-10-16T14:32:00-05:00";
    const salary = await categoryWithKey(a.user, "salary");
    const wallet = await newAccount(a.user, "Nequi", 0);
    const income = await post(recordIncome, a.user, "incomes", { categoryId: salary, amount: cop(100_000), accountId: a.bank, occurredAt });
    const transfer = await post(recordTransfer, a.user, "transfers", {
      amount: cop(50_000),
      sourceAccountId: a.bank,
      destinationAccountId: wallet,
      occurredAt,
      timeZone: "Europe/Madrid",
    });
    expect(await timeOf(income)).toEqual(["2026-10-16", "2026-10-16T19:32:00.000Z", "America/Bogota"]);
    expect(await timeOf(transfer)).toEqual(["2026-10-16", "2026-10-16T19:32:00.000Z", "Europe/Madrid"]);
    const h = await household();
    const fund = await newAccount(h.ana, "Household Fund", 0, "SHARED_FUND");
    const contribution = await post(recordFundContribution, h.ana, "fund-contributions", {
      amount: cop(100_000),
      fundAccountId: fund,
      sourceAccountId: h.ana.account,
      occurredAt,
    });
    const settlement = await post(recordSettlement, h.juan, "settlements", {
      amount: cop(10_000),
      payerMemberId: h.juan.memberId,
      receivingMemberId: h.ana.memberId,
      occurredAt,
    });
    expect(await timeOf(contribution)).toEqual(["2026-10-16", "2026-10-16T19:32:00.000Z", "America/Bogota"]);
    expect(await timeOf(settlement)).toEqual(["2026-10-16", "2026-10-16T19:32:00.000Z", "America/Bogota"]);
  });
});
```

Run: `pnpm exec vitest run --project unit src/shared/http/problem.test.ts` and `pnpm exec vitest run --project acceptance tests/acceptance/transaction-time.test.ts`
Expected: FAIL — `DateTimeMismatch` and `TimeRequired` map to 409, and the bodies strip `occurredAt` (Zod drops unknown keys), so the first test answers the moment of recording.

- [ ] **Step 2: Map the codes and extend the contract**

In `src/shared/http/problem.ts`, insert after the line `  ["CategoryNotInSpace", 422],`:

```ts
  // HU-E4-14: the request's date and instant disagree; the default would be 409.
  ["DateTimeMismatch", 422],
  // HU-E4-14, ruling P66: `occurredAt: null`; a time is replaced, never removed; the default would be 409.
  ["TimeRequired", 422],
```

In `src/modules/ledger/contracts/ledger.contract.ts`:

1. Insert after the line `const Description = z.string().max(1000).optional();`:

```ts
/** HU-E4-14: an RFC 3339 instant with any offset ("2026-10-16T14:32:00-05:00"); answers return it in UTC. */
const Instant = z.iso.datetime({ offset: true });
/** HU-E4-14: an IANA zone; whether it exists is the use case's (InvalidTimeZone). */
const TimeZoneName = z.string().min(1).max(64);

/** HU-E4-14: a body's date, instant and zone as the use cases take them; fails only for impossible dates. */
export const whenFromBody = (body: {
  readonly date?: string;
  readonly occurredAt?: string | null;
  readonly timeZone?: string;
}): Result<{ date?: LocalDate; occurredAt?: Date | null; timeZone?: string }> => {
  const date = optionalLocalDate(body.date);
  if (!date.ok) return date;
  return ok({
    date: date.value,
    // Ruling P66: an explicit null reaches the use case, which answers TimeRequired.
    occurredAt: body.occurredAt === undefined || body.occurredAt === null ? body.occurredAt : new Date(body.occurredAt),
    timeZone: body.timeZone,
  });
};
```

   and add `type LocalDate` to the file's import from `@/shared/kernel`.

2. In each of the six create bodies (`RecordExpenseBodySchema`, `RecordIncomeBodySchema`, `RecordTransferBodySchema`, `RecordFundContributionBodySchema`, `RecordSettlementBodySchema`, `DirectSplitBodySchema`), insert after its line `date: z.iso.date().optional(),`, at the same indentation (4 spaces in `RecordExpenseBodySchema`):

```ts
  occurredAt: Instant.nullable().optional(),
  timeZone: TimeZoneName.optional(),
```

   (`EditTransactionBodySchema` is Task 7b's.)

3. In `expenseFromBody`, `fundContributionFromBody`, `settlementFromBody` and `directSplitFromBody` only (`whenFromBody`, inserted above, holds the same pair and the same `date: date.value,` line and keeps them, so each anchor below is unique only inside the function it names), replace the two lines `  const date = optionalLocalDate(body.date);` and `  if (!date.ok) return date;` with:

```ts
  const when = whenFromBody(body);
  if (!when.ok) return when;
```

   and the line `    date: date.value,` (in `directSplitFromBody`, `      date: date.value,`) with `    ...when.value,` at the same indentation.

4. Replace the line `export type DirectSplitExpense = Pick<RecordExpenseInput, "description" | "date" | "amount" | "accountId"> & {` with:

```ts
export type DirectSplitExpense = Pick<
  RecordExpenseInput,
  "description" | "date" | "occurredAt" | "timeZone" | "amount" | "accountId"
> & {
```

5. Inside `TransactionSchema`, insert after the line `  date: z.iso.date(),`:

```ts
  /** HU-E4-14: when it happened, in UTC; null only for occurrences and rows older than M3-D. */
  occurredAt: z.iso.datetime().nullable(),
  /** HU-E4-14: the IANA zone it was recorded in; null exactly when occurredAt is. */
  timeZone: z.string().nullable(),
```

   and inside `transactionDto`, insert after the line `    date: tx.date,`:

```ts
    occurredAt: tx.occurredAt?.toISOString() ?? null,
    timeZone: tx.timeZone,
```

6. In `ledgerPaths`, append `, DateTimeMismatch, TimeRequired, InvalidTimeZone` to the `"422"` description of the six create operations (`POST …/expenses`, `…/incomes`, `…/transfers`, `…/fund-contributions`, `…/settlements`, `POST /api/v1/direct-splits`).

In `src/app/api/v1/spaces/[spaceId]/incomes/route.ts` and `src/app/api/v1/spaces/[spaceId]/transfers/route.ts`: replace the two lines `    const date = optionalLocalDate(body.date);` and `    if (!date.ok) return date;` with `    const when = whenFromBody(body);` and `    if (!when.ok) return when;`, replace the line `      date: date.value,` with `      ...when.value,`, remove `optionalLocalDate` from the `@/shared/http/contracts` import and add `whenFromBody` to the import from `@/modules/ledger/contracts/ledger.contract`.

In `tests/support/ledger.ts`, insert after the line `  date: string;` (inside `TransactionDto`):

```ts
  occurredAt: string | null;
  timeZone: string | null;
```

Append to the end of `src/modules/ledger/contracts/ledger.contract.test.ts` (add `RecordExpenseBodySchema` and `whenFromBody` to its import from `./ledger.contract` if absent):

```ts

describe("time inputs (HU-E4-14)", () => {
  it("accepts any RFC 3339 offset and refuses a local time without one", () => {
    const body = { amount: { amount: "1200000", currency: "COP" } };
    expect(RecordExpenseBodySchema.safeParse({ ...body, occurredAt: "2026-10-16T14:32:00-05:00" }).success).toBe(true);
    expect(RecordExpenseBodySchema.safeParse({ ...body, occurredAt: "2026-10-16T19:32:00Z" }).success).toBe(true);
    expect(RecordExpenseBodySchema.safeParse({ ...body, occurredAt: "2026-10-16T14:32:00" }).success).toBe(false);
  });

  it("turns the instant into a Date and keeps the zone as sent", () => {
    expect(whenFromBody({ occurredAt: "2026-10-16T14:32:00-05:00", timeZone: "europe/madrid" })).toEqual({
      ok: true,
      value: { date: undefined, occurredAt: new Date("2026-10-16T19:32:00Z"), timeZone: "europe/madrid" },
    });
  });

  it("lets an explicit null through, for the use case to answer TimeRequired (P66)", () => {
    const body = { amount: { amount: "1200000", currency: "COP" } };
    expect(RecordExpenseBodySchema.safeParse({ ...body, occurredAt: null }).success).toBe(true);
    expect(whenFromBody({ occurredAt: null })).toEqual({
      ok: true,
      value: { date: undefined, occurredAt: null, timeZone: undefined },
    });
  });
});
```

In `docs/backlog/E4-ledger.md`, insert before the line that starts with `- **Spec impact:** section 5 table (the period derives from the local date)`:

```markdown
- Errors (catalogue, spec 8): `DateTimeMismatch` and `TimeRequired` (422, explicit) and `InvalidTimeZone` (422) on every create endpoint and on `PATCH …/transactions/{transactionId}`; list cursors issued before M3-D answer `InvalidCursor` (M3-D Tasks 7a, 7b).
```

Regenerate the snapshot (`UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts`). Expected diff: `Transaction` gains two properties, the six create bodies gain two (`occurredAt` nullable), six 422 descriptions change; no new component.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/shared/http src/modules/ledger/contracts` and `pnpm exec vitest run --project acceptance tests/acceptance/transaction-time.test.ts tests/acceptance/ledger.test.ts tests/acceptance/direct-splits.test.ts`
Expected: PASS.

- [ ] **Step 4: Run the gates, then commit**

```bash
git add src/modules/ledger/contracts src/app/api/v1/spaces src/shared/http tests/support/ledger.ts tests/acceptance/transaction-time.test.ts openapi/openapi.snapshot.json docs/backlog/E4-ledger.md
git commit -m "feat(ledger): take and return the time of every transaction over HTTP (Refs #99)"
```

---

### Task 7b: HTTP — edit the time, and list each day newest time first

Exposes the edit rules on `PATCH …/transactions/{transactionId}` (a time is replaced or added, never removed: `TimeRequired`) and pins HU-E4-14's ordering, period and zone-change scenarios end to end, plus the untimed recurring occurrence of M3-C. No person's request writes a transaction without a time any more (ruling P66), so the acceptance file makes its untimed rows the way the scheduler and the migration leave them: it clears both columns of a recorded row in PostgreSQL.

**Files:**
- Modify: `src/modules/ledger/contracts/ledger.contract.ts`, `src/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route.ts`, `tests/acceptance/transaction-time.test.ts`, `tests/acceptance/recurring-occurrences.test.ts`, `openapi/openapi.snapshot.json`

**Interfaces:**
- Consumes: `EditChanges.occurredAt`, `EditChanges.timeZone` (Task 6); `Instant`, `TimeZoneName` (Task 7a); M3-C's `householdWithFund`, `define` (from the file's `trackedRecurrences()`), `rentBody`, `schedulerRunsOn`, `expensesIn` (file-local helpers of `tests/acceptance/recurring-occurrences.test.ts`).
- Produces: `EditTransactionBodySchema.occurredAt` (`Instant`, nullable), `EditTransactionBodySchema.timeZone`.

- [ ] **Step 1: Write the failing tests**

In `tests/acceptance/transaction-time.test.ts`, insert after the line `import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";`:

```ts
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import {
  GET as getTransaction,
  PATCH as editTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { GET as listAudit } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/audit/route";
```

and append to the end of the file:

```ts

const edit = (a: Ana, tx: TransactionDto, body: unknown) =>
  call(editTransaction, "PATCH", `/api/v1/spaces/${a.user.spaceId}/transactions/${tx.id}`, {
    user: a.user,
    params: { spaceId: a.user.spaceId, transactionId: tx.id },
    body,
  });
const listed = async (a: Ana, query: string) => {
  const response = await call(listTransactions, "GET", `/api/v1/spaces/${a.user.spaceId}/transactions?${query}`, {
    user: a.user,
    params: { spaceId: a.user.spaceId },
  });
  return { status: response.status, body: (await response.json()) as { items: TransactionDto[]; nextCursor: string | null } };
};
const recorded = async (response: Response) => (await response.json()) as TransactionDto;
/** A row as M3-C's scheduler or the M3-D migration leaves it; no person's request writes one (ruling P66). */
const withoutTime = async (tx: TransactionDto) => {
  await app.pool.query(`UPDATE transactions SET occurred_at = NULL, time_zone = NULL WHERE id = $1`, [tx.id]);
};

describe("lists and edits of timed transactions (HU-E4-14)", () => {
  it("lists newest day first, then newest time, untimed items last, page by page (Review Focus 2)", async () => {
    const a = await ana();
    for (const [description, extra] of [
      ["Taxi", { occurredAt: "2026-10-15T22:40:00-05:00" }],
      ["Market", { occurredAt: "2026-10-16T08:10:00-05:00" }],
      ["Rent", { date: "2026-10-16" }],
      ["Lunch", { occurredAt: "2026-10-16T13:05:00-05:00" }],
    ] as const) {
      const response = await expense(a, { description, ...extra });
      expect(response.status).toBe(201);
      // Rent stands for the AUTO occurrence of the scenario: recorded with its date and no time.
      if (description === "Rent") await withoutTime(await recorded(response));
    }
    const page = await listed(a, "period=2026-10");
    expect(page.body.items.map((t) => t.description)).toEqual(["Lunch", "Market", "Rent", "Taxi"]);
    expect(page.body.items[2]).toMatchObject({ occurredAt: null, timeZone: null });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const next = await listed(a, `period=2026-10&limit=1${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...next.body.items.map((t) => t.description));
      cursor = next.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(["Lunch", "Market", "Rent", "Taxi"]);
  });

  it("answers InvalidCursor for a cursor from before M3-D", async () => {
    const a = await ana();
    const old = Buffer.from(JSON.stringify(["2026-10-16", "0199f3a2-7c1e-7a10-8b2c-1d2e3f405060"])).toString("base64url");
    expect((await listed(a, `period=2026-10&cursor=${old}`)).status).toBe(422);
  });

  it("keeps the local time when the date changes, audits it, never removes it, and times an old row", async () => {
    const a = await ana();
    const coffee = await recorded(await expense(a, { occurredAt: "2026-10-16T14:32:00-05:00" }));
    const moved = await edit(a, coffee, { date: "2026-10-14" });
    expect(moved.status).toBe(200);
    expect(await recorded(moved)).toMatchObject({ date: "2026-10-14", occurredAt: "2026-10-14T19:32:00.000Z" });
    const audit = await call(listAudit, "GET", `/api/v1/spaces/${a.user.spaceId}/transactions/${coffee.id}/audit`, {
      user: a.user,
      params: { spaceId: a.user.spaceId, transactionId: coffee.id },
    });
    const { items } = (await audit.json()) as { items: { changes: Record<string, unknown> }[] };
    expect(items[0]?.changes).toEqual({
      date: { from: "2026-10-16", to: "2026-10-14" },
      occurredAt: { from: "2026-10-16T19:32:00.000Z", to: "2026-10-14T19:32:00.000Z" },
    });
    expect(await problemOf(await edit(a, coffee, { occurredAt: null }))).toEqual([422, "TimeRequired"]);
    const read = await call(getTransaction, "GET", `/api/v1/spaces/${a.user.spaceId}/transactions/${coffee.id}`, {
      user: a.user,
      params: { spaceId: a.user.spaceId, transactionId: coffee.id },
    });
    expect(await recorded(read)).toMatchObject({ date: "2026-10-14", occurredAt: "2026-10-14T19:32:00.000Z" });
    expect(await problemOf(await edit(a, coffee, { date: "2026-10-15", occurredAt: "2026-10-16T14:32:00-05:00" }))).toEqual([
      422,
      "DateTimeMismatch",
    ]);
    const old = await recorded(await expense(a, { description: "Old market", date: "2026-09-20" }));
    await withoutTime(old);
    expect(await problemOf(await edit(a, old, { occurredAt: null }))).toEqual([422, "TimeRequired"]);
    const timed = await edit(a, old, { occurredAt: "2026-09-20T10:00:00-05:00" });
    expect(timed.status).toBe(200);
    expect(await recorded(timed)).toMatchObject({
      date: "2026-09-20",
      occurredAt: "2026-09-20T15:00:00.000Z",
      timeZone: "America/Bogota",
    });
  });

  it("counts by the local date, and a zone change moves nothing (HU-E1-14, Review Focus 1)", async () => {
    const a = await ana();
    const late = await recorded(await expense(a, { amount: cop(85_000), occurredAt: "2026-10-31T23:30:00-05:00" }));
    expect(late).toMatchObject({ date: "2026-10-31", occurredAt: "2026-11-01T04:30:00.000Z" });
    expect((await listed(a, "period=2026-10")).body.items.map((t) => t.id)).toContain(late.id);
    expect((await setZone(a.user, "Europe/Madrid")).status).toBe(200);
    const after = (await listed(a, "period=2026-10")).body.items.find((t) => t.id === late.id);
    expect(after).toMatchObject({ date: "2026-10-31", timeZone: "America/Bogota" });
  });
});
```

Append to the end of `tests/acceptance/recurring-occurrences.test.ts` (M3-C's file; its helpers are in scope):

```ts

describe("occurrences have no time (HU-E4-14)", () => {
  it("records the Rent with its date and no time", async () => {
    const h = await householdWithFund();
    await define(h.ana, h.spaceId, rentBody(h, { endDate: "2027-01-31" }));
    await schedulerRunsOn("2026-12-01");
    const [rent] = await expensesIn(h, "2026-12");
    expect(rent).toMatchObject({ date: "2026-12-01", occurredAt: null, timeZone: null });
  });
});
```

Run: `pnpm exec vitest run --project acceptance tests/acceptance/transaction-time.test.ts tests/acceptance/recurring-occurrences.test.ts`
Expected: FAIL — the edit body strips `occurredAt`, so `{ "occurredAt": null }` answers 200 instead of `422 TimeRequired` and "Old market" gets no time; the other new tests already pass (characterization of Tasks 5b and 6; their red evidence is Task 5b's integration test and Task 6's unit tests).

- [ ] **Step 2: Accept time edits**

In `src/modules/ledger/contracts/ledger.contract.ts`, inside `EditTransactionBodySchema`, insert after the line `  date: z.iso.date().optional(),`:

```ts
  /** HU-E4-14: a new instant (any offset); null answers TimeRequired, since a time is never removed. */
  occurredAt: Instant.nullable().optional(),
  timeZone: TimeZoneName.optional(),
```

and append `, DateTimeMismatch, TimeRequired, InvalidTimeZone` to the `"422"` description of the `PATCH …/transactions/{transactionId}` operation in `ledgerPaths`.

In `src/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route.ts`, insert after the line `        date: date.value,`:

```ts
        occurredAt:
          body.occurredAt === undefined || body.occurredAt === null ? body.occurredAt : new Date(body.occurredAt),
        timeZone: body.timeZone,
```

Regenerate the snapshot. Expected diff: the edit body gains `occurredAt` (nullable) and `timeZone`, and its 422 description; no new component.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/transaction-time.test.ts tests/acceptance/recurring-occurrences.test.ts tests/acceptance/ledger.test.ts`
Expected: PASS.

- [ ] **Step 4: Run the gates, then commit**

```bash
git add src/modules/ledger/contracts/ledger.contract.ts "src/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route.ts" tests/acceptance/transaction-time.test.ts tests/acceptance/recurring-occurrences.test.ts openapi/openapi.snapshot.json
git commit -m "feat(ledger): edit a transaction's time over HTTP without ever removing it, and pin the day order (Refs #99, Refs #94)"
```

---

### Task 8: Categories domain — optional subcategories

Implements HU-E3-04's tree rules and the amended HU-E3-02 invariant as pure functions.

Decisions:
- At most three levels: group → category → subcategory. `CategoryDepthExceeded` refuses a parent that is itself a subcategory, a category made the subcategory of itself, and moving a category that has subcategories under another category (ruling P46). A leaf category may become a subcategory and back.
- A subcategory always has its parent's `groupId` (`movedTree` carries the subcategories along when their category changes group); a `group` alone on a subcategory makes it a category of that group, the same as `parent: null` with that group (ruling P46).
- Siblings share group and parent; names are unique among them ignoring case, so a subcategory may share its name with a category elsewhere.
- Creating under an archived category, or moving under one, is `ParentCategoryArchived`; archiving a category archives its subcategories (`archivedTree`); restoring a subcategory needs a live parent, and restoring a category restores only itself (ruling P47).

**Files:**
- Modify: `src/modules/categories/domain/category.ts`, `src/modules/categories/domain/category.test.ts`, `src/modules/categories/domain/default-catalog.ts`, `src/modules/categories/infrastructure/drizzle-category-repository.ts`, `tests/support/fixtures.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `Category.parentCategoryId: CategoryId | null`
  - `newCategory(input: { id; group: CategoryGroup; parent?: Category; name; now; categories })` — `CategoryDepthExceeded`, `ParentCategoryArchived` (new), `CategoryGroupArchived`, `CategoryNameTaken`
  - `reviseCategory(category, change: { name?; group?: CategoryGroup; parent?: Category | null }, categories)` — the same codes
  - `movedTree(revised: Category, categories: readonly Category[]): Category[]` (the category first)
  - `archivedTree(category: Category, categories: readonly Category[], now: Date): Category[]` (the category first)
  - `restoreCategory(category, group, parent?: Category | null)` — `ParentCategoryArchived` (new), `CategoryGroupArchived`

- [ ] **Step 1: Write the failing tests**

In `src/modules/categories/domain/category.test.ts`:

1. Replace the lines from `import {` to `} from "./category";` (the first import block from `./category`) with:

```ts
import {
  archiveGroup,
  archivedTree,
  movedTree,
  newCategory,
  newGroup,
  renameGroup,
  restoreCategory,
  reviseCategory,
  type Category,
  type CategoryGroup,
} from "./category";
```

2. Insert after the line `  groupId: groupId as CategoryGroup["id"],` (inside the `category` helper):

```ts
  parentCategoryId: null,
```

3. Append to the end of the file:

```ts

describe("subcategories (HU-E3-04)", () => {
  const sub = (id: string, parent: Category, name: string): Category => ({
    ...category(id, parent.groupId, name),
    parentCategoryId: parent.id,
  });
  const vegetables = sub("c-vegetables", groceries, "Vegetables");
  const meat = sub("c-meat", groceries, "Meat");
  const tree = [...all, vegetables, meat];
  const create = (parent: Category, name: string, categories: readonly Category[] = tree) =>
    newCategory({ id: ids.next<"Category">(), group: food, parent, name, now, categories });

  it("creates a subcategory in its parent's group, without catalog key", () => {
    expect(unwrap(create(groceries, " Fruit "))).toMatchObject({
      groupId: "g-food",
      parentCategoryId: "c-groceries",
      name: "Fruit",
      key: null,
    });
  });

  it("refuses a fourth level, and a parent that is archived", () => {
    expect(codeOf(create(vegetables, "Organic"))).toBe("CategoryDepthExceeded");
    expect(codeOf(create({ ...groceries, archivedAt: now }, "Fruit"))).toBe("ParentCategoryArchived");
  });

  it("keeps names unique among siblings only", () => {
    expect(codeOf(create(groceries, "vegetables"))).toBe("CategoryNameTaken");
    expect(codeOf(create(groceries, "Pharmacy"))).toBe("ok");
  });

  it("moves a leaf under a category and back to a group, but never a category that has subcategories", () => {
    expect(unwrap(reviseCategory(pharmacy, { parent: groceries }, tree))).toMatchObject({
      groupId: "g-food",
      parentCategoryId: "c-groceries",
    });
    expect(unwrap(reviseCategory(vegetables, { parent: null }, tree))).toMatchObject({
      groupId: "g-food",
      parentCategoryId: null,
    });
    expect(unwrap(reviseCategory(vegetables, { group: health }, tree))).toMatchObject({
      groupId: "g-health",
      parentCategoryId: null,
    });
    expect(codeOf(reviseCategory(groceries, { parent: pharmacy }, tree))).toBe("CategoryDepthExceeded");
    expect(codeOf(reviseCategory(pharmacy, { parent: vegetables }, tree))).toBe("CategoryDepthExceeded");
    expect(codeOf(reviseCategory(pharmacy, { parent: pharmacy }, tree))).toBe("CategoryDepthExceeded");
  });

  it("carries the subcategories along when their category changes group", () => {
    const moved = unwrap(reviseCategory(groceries, { group: health }, tree));
    expect(movedTree(moved, tree).map((c) => [c.id, c.groupId])).toEqual([
      ["c-groceries", "g-health"],
      ["c-vegetables", "g-health"],
      ["c-meat", "g-health"],
    ]);
  });

  it("archives the subcategories with their category, and restores one only under a live parent", () => {
    const archived = archivedTree(groceries, tree, now);
    expect(archived.map((c) => [c.id, c.archivedAt])).toEqual([
      ["c-groceries", now],
      ["c-vegetables", now],
      ["c-meat", now],
    ]);
    const [parent, archivedVegetables] = archived as [Category, Category];
    expect(codeOf(restoreCategory(archivedVegetables, food, parent))).toBe("ParentCategoryArchived");
    expect(unwrap(restoreCategory(archivedVegetables, food, groceries)).archivedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/categories/domain`
Expected: FAIL — `movedTree` and `archivedTree` are not exported, and `parentCategoryId` does not exist in type `Category`.

- [ ] **Step 3: Write the implementation**

In `src/modules/categories/domain/category.ts`:

1. Insert after the line `  readonly groupId: CategoryGroupId;` (inside `interface Category`):

```ts
  /** HU-E3-04: the category this subcategory refines; null for a category directly in its group. */
  readonly parentCategoryId: CategoryId | null;
```

2. Replace the lines from `const nameTakenIn = (categories: readonly Category[], groupId: string, name: string, exceptId?: string) =>` to its next line `  categories.some((c) => c.groupId === groupId && c.id !== exceptId && sameName(c.name, name));` with:

```ts
/** HU-E3-02, HU-E3-04: siblings share the group and the parent; their names are unique ignoring case. */
const nameTakenIn = (
  categories: readonly Category[],
  siblings: { readonly groupId: string; readonly parentCategoryId: string | null },
  name: string,
  exceptId?: string,
) =>
  categories.some(
    (c) =>
      c.groupId === siblings.groupId &&
      c.parentCategoryId === siblings.parentCategoryId &&
      c.id !== exceptId &&
      sameName(c.name, name),
  );

const hasSubcategories = (categories: readonly Category[], categoryId: string): boolean =>
  categories.some((c) => c.parentCategoryId === categoryId);

/** HU-E3-04, ruling P46: a parent is a live category directly in its group; a subcategory is never one. */
const usableParent = (parent: Category): Result<Category> => {
  if (parent.parentCategoryId !== null) return err(domainError("CategoryDepthExceeded"));
  return parent.archivedAt === null ? ok(parent) : err(domainError("ParentCategoryArchived"));
};
```

3. Replace the lines from `export const newCategory = (input: {` to the closing `};` of `newCategory` with:

```ts
/** HU-E3-02, HU-E3-04: a category of `group`, or, with `parent`, a subcategory of it (`group` is the parent's). */
export const newCategory = (input: {
  id: CategoryId;
  group: CategoryGroup;
  parent?: Category;
  name: string;
  now: Date;
  categories: readonly Category[];
}): Result<Category> => {
  if (input.group.archivedAt !== null) return err(domainError("CategoryGroupArchived"));
  if (input.parent !== undefined) {
    const parent = usableParent(input.parent);
    if (!parent.ok) return parent;
  }
  const name = nameOf(input.name);
  if (!name.ok) return name;
  const siblings = { groupId: input.group.id, parentCategoryId: input.parent?.id ?? null };
  if (nameTakenIn(input.categories, siblings, name.value)) return err(domainError("CategoryNameTaken"));
  return ok({
    id: input.id,
    spaceId: input.group.spaceId,
    groupId: input.group.id,
    parentCategoryId: siblings.parentCategoryId,
    name: name.value,
    key: null,
    archivedAt: null,
    createdAt: input.now,
  });
};
```

4. Replace the lines from `/** Rename and/or move in one step: the final name must be free in the final group; the key never changes. */` to the closing `};` of `reviseCategory` with:

```ts
/**
 * HU-E3-02, HU-E3-04, ruling P46: rename and/or move in one step; the key never changes. `parent` undefined keeps the
 * parent unless a `group` is given, which makes the category a category of that group; `null` makes it a category
 * of `group` (or of its own group); a category makes it that category's subcategory, in that category's group.
 */
export const reviseCategory = (
  category: Category,
  change: { readonly name?: string; readonly group?: CategoryGroup; readonly parent?: Category | null },
  categories: readonly Category[],
): Result<Category> => {
  const name = change.name === undefined ? ok(category.name) : nameOf(change.name);
  if (!name.ok) return name;
  const target = change.group;
  if (target && target.id !== category.groupId && target.archivedAt !== null) {
    return err(domainError("CategoryGroupArchived"));
  }
  let groupId: CategoryGroupId = target?.id ?? category.groupId;
  let parentCategoryId: CategoryId | null =
    target === undefined && change.parent === undefined ? category.parentCategoryId : null;
  if (change.parent) {
    if (change.parent.id === category.id || hasSubcategories(categories, category.id)) {
      return err(domainError("CategoryDepthExceeded"));
    }
    const parent = usableParent(change.parent);
    if (!parent.ok) return parent;
    groupId = parent.value.groupId;
    parentCategoryId = parent.value.id;
  }
  if (nameTakenIn(categories, { groupId, parentCategoryId }, name.value, category.id)) {
    return err(domainError("CategoryNameTaken"));
  }
  return ok({ ...category, name: name.value, groupId, parentCategoryId });
};

/** HU-E3-04: a category's subcategories follow it to its group; the revised category comes first. */
export const movedTree = (revised: Category, categories: readonly Category[]): Category[] => [
  revised,
  ...categories
    .filter((c) => c.parentCategoryId === revised.id && c.groupId !== revised.groupId)
    .map((c) => ({ ...c, groupId: revised.groupId })),
];
```

5. Replace the lines from `export const restoreCategory = (category: Category, group: CategoryGroup): Result<Category> =>` to its `    : ok({ ...category, archivedAt: null });` line with:

```ts
/** HU-E3-03, HU-E3-04, ruling P47: a subcategory comes back only under a live parent; a category restores alone. */
export const restoreCategory = (
  category: Category,
  group: CategoryGroup,
  parent: Category | null = null,
): Result<Category> => {
  if (group.archivedAt !== null) return err(domainError("CategoryGroupArchived"));
  if (parent !== null && parent.archivedAt !== null) return err(domainError("ParentCategoryArchived"));
  return ok({ ...category, archivedAt: null });
};

/** HU-E3-04: archiving a category archives its subcategories, as archiving a group archives its categories. */
export const archivedTree = (category: Category, categories: readonly Category[], now: Date): Category[] => [
  archiveCategory(category, now),
  ...categories.filter((c) => c.parentCategoryId === category.id).map((c) => archiveCategory(c, now)),
];
```

In `src/modules/categories/domain/default-catalog.ts`, insert after the line `        groupId: group.id,`:

```ts
        // HU-E3-04: the seed has no subcategories.
        parentCategoryId: null,
```

In `src/modules/categories/infrastructure/drizzle-category-repository.ts`, replace the line `    return rows.map((row) => ({ ...row, id: row.id as CategoryId, groupId: row.groupId as CategoryGroupId }));` (inside `listCategories`; the column arrives in Task 9a) with:

```ts
    return rows.map((row) => ({
      ...row,
      id: row.id as CategoryId,
      groupId: row.groupId as CategoryGroupId,
      // HU-E3-04: stored from Task 9a's migration on.
      parentCategoryId: null,
    }));
```

In `tests/support/fixtures.ts` (`categoryFixture`), insert after the line `      groupId,` the line `      parentCategoryId: null,`.

Literal sites: run `rg -n "key: (null|\"|c\.|row)" src tests --type ts` and add `parentCategoryId: null` to every other object literal it shows that builds a whole `Category` (today the `category` helper above and `categoryFixture`, edited above; `drizzle-category-repository.int.test.ts` is Task 9a's). The rg does not list the repository's `rows.map` in `listCategories`, edited above.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/categories` and `pnpm exec vitest run --project integration src/modules/categories`
Expected: PASS (the use cases still compile: they call `restoreCategory` with two arguments and `newCategory` without `parent`).

- [ ] **Step 5: Run the gates, then commit**

```bash
git add src/modules/categories/domain src/modules/categories/infrastructure/drizzle-category-repository.ts tests/support/fixtures.ts
git commit -m "feat(categories): allow one optional subcategory level with its depth, move and archive rules (Refs #98)"
```

---

### Task 9a: Categories — subcategories in PostgreSQL and in the use cases

Stores `parentCategoryId` (migration `0013_subcategories`) and applies Task 8 in the five category use cases.

Decisions:
- `parent_category_id` references `categories(id)`; siblings are unique on `(coalesce(parent_category_id, group_id), lower(name))` among rows not deleted (`categories_parent_name_uq` replaces `categories_group_name_uq`; UUIDs never collide across the two kinds of parent); `categories_not_own_parent` refuses a self-reference.
- `CreateCategory` takes `groupId` or `parentCategoryId`; an unknown parent is `CategoryNotFound` (404), as an unknown group is `CategoryGroupNotFound`. A `groupId` that names a category keeps answering `CategoryDepthExceeded` (M1 behaviour).
- `DeleteCategory` refuses a category that has subcategories not deleted, archived ones included, with `CategoryInUse`, before asking the ledger and budgeting (ruling P48).
- `ListCategories` nests each category's subcategories (`CategoryNode.subcategories`), sorted by name, with the same archived filter.

**Files:**
- Modify: `src/modules/categories/infrastructure/categories.schema.ts`, `src/modules/categories/infrastructure/drizzle-category-repository.ts`, `src/modules/categories/infrastructure/drizzle-category-repository.int.test.ts`, `src/modules/categories/application/create-category.ts`, `src/modules/categories/application/update-category.ts`, `src/modules/categories/application/archive-category.ts`, `src/modules/categories/application/restore-category.ts`, `src/modules/categories/application/delete-category.ts`, `src/modules/categories/application/list-categories.ts`, `src/modules/categories/application/index.ts`
- Create: `src/modules/categories/application/subcategories.test.ts`, `drizzle/0013_subcategories.sql` (+ meta, generated)

**Interfaces:**
- Consumes: Task 8's domain functions.
- Produces:
  - `CreateCategory` input `{ spaceId; userId; name; groupId?: string; parentCategoryId?: string }`
  - `UpdateCategory` input gains `parentCategoryId?: string | null`
  - `interface CategoryNode extends Category { subcategories: readonly Category[] }`; `CategoryGroupView.categories: readonly CategoryNode[]`
  - column `categories.parent_category_id`

- [ ] **Step 1: Write the failing use-case tests**

Create `src/modules/categories/application/subcategories.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
import { codeOf, fakeSpaceAccess, memoryTm, membership, sequentialIds, unwrap } from "../../../../tests/support/fakes";
import { InMemoryCategories } from "../../../../tests/support/in-memory-categories";
import { createArchiveCategory } from "./archive-category";
import { createCreateCategory } from "./create-category";
import { createDeleteCategory } from "./delete-category";
import type { CategoriesDeps } from "./deps";
import { createListCategories } from "./list-categories";
import { createRestoreCategory } from "./restore-category";
import { createSeedDefaultCategories } from "./seed-default-categories";
import { createUpdateCategory } from "./update-category";

const asAna = { spaceId: "space-ana", userId: "u-ana" };

/** Ana's personal space, seeded in Spanish: "Mercado" and "Restaurantes" in "Alimentación". */
const setup = async () => {
  const categories = new InMemoryCategories();
  const deps: CategoriesDeps = {
    categories,
    access: fakeSpaceAccess(membership()),
    ids: sequentialIds("cat"),
    clock: new FixedClock(new Date("2026-10-16T12:00:00Z")),
    tm: memoryTm,
  };
  unwrap(await createSeedDefaultCategories(deps)({ spaceId: "space-ana", locale: "es" }));
  const named = (name: string) => categories.categories.find((c) => c.name === name)!;
  const create = createCreateCategory(deps);
  const sub = async (parent: string, name: string) =>
    unwrap(await create({ ...asAna, parentCategoryId: named(parent).id, name }));
  return {
    named,
    sub,
    create,
    update: createUpdateCategory(deps),
    archive: createArchiveCategory(deps),
    restore: createRestoreCategory(deps),
    remove: createDeleteCategory({ ...deps, usage: { isCategoryReferenced: async () => false } }),
    list: createListCategories(deps),
  };
};

describe("subcategories (HU-E3-04)", () => {
  it("creates Verduras and Carnes under Mercado and lists them nested", async () => {
    const w = await setup();
    await w.sub("Mercado", "Verduras");
    await w.sub("Mercado", "Carnes");
    const groups = unwrap(await w.list({ ...asAna, includeArchived: false }));
    const mercado = groups.flatMap((g) => g.categories).find((c) => c.name === "Mercado")!;
    expect(mercado.subcategories.map((s) => [s.name, s.groupId, s.key])).toEqual([
      ["Carnes", mercado.groupId, null],
      ["Verduras", mercado.groupId, null],
    ]);
    expect(groups.flatMap((g) => g.categories).some((c) => c.name === "Verduras")).toBe(false);
  });

  it("refuses a fourth level, an unknown parent and moving a category with subcategories under another", async () => {
    const w = await setup();
    const verduras = await w.sub("Mercado", "Verduras");
    expect(codeOf(await w.create({ ...asAna, parentCategoryId: verduras.id, name: "Orgánico" }))).toBe(
      "CategoryDepthExceeded",
    );
    expect(codeOf(await w.create({ ...asAna, parentCategoryId: "nope", name: "X" }))).toBe("CategoryNotFound");
    const moved = await w.update({ ...asAna, categoryId: w.named("Mercado").id, parentCategoryId: w.named("Restaurantes").id });
    expect(codeOf(moved)).toBe("CategoryDepthExceeded");
  });

  it("moves the subcategories with their category to another group", async () => {
    const w = await setup();
    const verduras = await w.sub("Mercado", "Verduras");
    const otherGroup = w.named("Farmacia").groupId;
    unwrap(await w.update({ ...asAna, categoryId: w.named("Mercado").id, groupId: otherGroup }));
    expect(w.named("Verduras")).toMatchObject({ id: verduras.id, groupId: otherGroup, parentCategoryId: w.named("Mercado").id });
  });

  it("archives the subcategories with Mercado, and restores Verduras only once Mercado is back", async () => {
    const w = await setup();
    const verduras = await w.sub("Mercado", "Verduras");
    unwrap(await w.archive({ ...asAna, categoryId: w.named("Mercado").id }));
    expect(w.named("Verduras").archivedAt).not.toBeNull();
    expect(codeOf(await w.restore({ ...asAna, categoryId: verduras.id }))).toBe("ParentCategoryArchived");
    unwrap(await w.restore({ ...asAna, categoryId: w.named("Mercado").id }));
    expect(w.named("Verduras").archivedAt).not.toBeNull(); // a category restores alone (P47)
    expect(unwrap(await w.restore({ ...asAna, categoryId: verduras.id })).archivedAt).toBeNull();
  });

  it("keeps a category with live subcategories, archived ones included, from being deleted", async () => {
    const w = await setup();
    const verduras = await w.sub("Mercado", "Verduras");
    unwrap(await w.archive({ ...asAna, categoryId: verduras.id }));
    expect(codeOf(await w.remove({ ...asAna, categoryId: w.named("Mercado").id }))).toBe("CategoryInUse");
    unwrap(await w.remove({ ...asAna, categoryId: verduras.id }));
    expect(codeOf(await w.remove({ ...asAna, categoryId: w.named("Mercado").id }))).toBe("ok");
  });
});
```

(`Farmacia` is a seeded Spanish category in another group than `Mercado`, HU-E3-01.)

Run: `pnpm exec vitest run --project unit src/modules/categories/application/subcategories.test.ts`
Expected: FAIL — `parentCategoryId` is not part of the `CreateCategory` input.

- [ ] **Step 2: Apply the rules in the use cases**

Replace the contents of `src/modules/categories/application/create-category.ts`:

```ts
import { type Result } from "@/shared/kernel";
import { newCategory, type Category } from "../domain/category";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";
import { categoryById, groupById } from "./lookups";

/** HU-E3-02, HU-E3-04: a category in `groupId`, or a subcategory of `parentCategoryId` (the contract sends one). */
export type CreateCategory = (input: {
  spaceId: string;
  userId: string;
  groupId?: string;
  parentCategoryId?: string;
  name: string;
}) => Promise<Result<Category>>;

export const createCreateCategory =
  (deps: CategoriesDeps): CreateCategory =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      const categories = await deps.categories.listCategories(spaceId);
      const groups = await deps.categories.listGroups(spaceId);
      const parent = input.parentCategoryId === undefined ? undefined : categoryById(categories, input.parentCategoryId);
      if (parent !== undefined && !parent.ok) return parent;
      const group = groupById(groups, categories, parent?.value.groupId ?? input.groupId ?? "");
      if (!group.ok) return group;
      const category = newCategory({
        id: deps.ids.next<"Category">(),
        group: group.value,
        parent: parent?.value,
        name: input.name,
        now: deps.clock.now(),
        categories,
      });
      if (!category.ok) return category;
      await deps.categories.addCategories([category.value]);
      return category;
    });
```

In `src/modules/categories/application/update-category.ts`:
1. Replace the line `import { reviseCategory, type Category } from "../domain/category";` with `import { movedTree, reviseCategory, type Category } from "../domain/category";`.
2. Replace the line `  groupId?: string;` with:

```ts
  groupId?: string;
  /** HU-E3-04: a category to become its subcategory, or null to become a category of `groupId` (or its group). */
  parentCategoryId?: string | null;
```

3. Replace the lines from `      const revised = reviseCategory(category.value, { name: input.name, group: target.value }, categories);` to `      await deps.categories.saveCategories([revised.value]);` with:

```ts
      const parent =
        input.parentCategoryId === undefined || input.parentCategoryId === null
          ? ok(input.parentCategoryId)
          : categoryById(categories, input.parentCategoryId);
      if (!parent.ok) return parent;
      const revised = reviseCategory(
        category.value,
        { name: input.name, group: target.value, parent: parent.value },
        categories,
      );
      if (!revised.ok) return revised;
      // HU-E3-04: its subcategories follow it to the new group.
      await deps.categories.saveCategories(movedTree(revised.value, categories));
```

In `src/modules/categories/application/archive-category.ts`:
1. Replace the line `import { archiveCategory, type Category } from "../domain/category";` with `import { archivedTree, type Category } from "../domain/category";`.
2. Replace the lines from `      const category = categoryById(` to `      return ok(archived);` with:

```ts
      const categories = await deps.categories.listCategories(manager.value.spaceId);
      const category = categoryById(categories, input.categoryId);
      if (!category.ok) return category;
      // HU-E3-04: its subcategories are archived with it.
      const archived = archivedTree(category.value, categories, deps.clock.now());
      await deps.categories.saveCategories(archived);
      return ok(archived[0]!);
```

In `src/modules/categories/application/restore-category.ts`, replace the lines from `      const category = categoryById(await deps.categories.listCategories(spaceId), input.categoryId);` to `      const restored = restoreCategory(category.value, group);` with:

```ts
      const categories = await deps.categories.listCategories(spaceId);
      const category = categoryById(categories, input.categoryId);
      if (!category.ok) return category;
      const group = (await deps.categories.listGroups(spaceId)).find((g) => g.id === category.value.groupId);
      if (!group) return err(domainError("CategoryGroupNotFound"));
      // HU-E3-04: a live subcategory's parent is never deleted (DeleteCategory), so it is in the list.
      const parent = categories.find((c) => c.id === category.value.parentCategoryId) ?? null;
      const restored = restoreCategory(category.value, group, parent);
```

In `src/modules/categories/application/delete-category.ts`, replace the lines from `      const category = categoryById(` to `      if (await deps.usage.isCategoryReferenced(category.value.id)) return err(domainError("CategoryInUse"));` with:

```ts
      const categories = await deps.categories.listCategories(manager.value.spaceId);
      const category = categoryById(categories, input.categoryId);
      if (!category.ok) return category;
      // HU-E3-04, ruling P48: subcategories that are not deleted, archived ones included, keep their category.
      if (categories.some((c) => c.parentCategoryId === category.value.id)) return err(domainError("CategoryInUse"));
      if (await deps.usage.isCategoryReferenced(category.value.id)) return err(domainError("CategoryInUse"));
```

In `src/modules/categories/application/list-categories.ts`:
1. Replace the lines `export interface CategoryGroupView extends CategoryGroup {` and `  readonly categories: readonly Category[];` with:

```ts
/** HU-E3-04: a category with its subcategories, each sorted by name. */
export interface CategoryNode extends Category {
  readonly subcategories: readonly Category[];
}

export interface CategoryGroupView extends CategoryGroup {
  readonly categories: readonly CategoryNode[];
```

2. Replace the line `          categories: visible(categories.filter((c) => c.groupId === group.id)).sort(byName),` with:

```ts
          categories: visible(categories.filter((c) => c.groupId === group.id && c.parentCategoryId === null))
            .sort(byName)
            .map((category) => ({
              ...category,
              subcategories: visible(categories.filter((c) => c.parentCategoryId === category.id)).sort(byName),
            })),
```

In `src/modules/categories/application/index.ts`, replace the line `export { createListCategories, type CategoryGroupView, type ListCategories } from "./list-categories";` with:

```ts
export {
  createListCategories,
  type CategoryGroupView,
  type CategoryNode,
  type ListCategories,
} from "./list-categories";
```

Run: `pnpm exec vitest run --project unit src/modules/categories`
Expected: PASS.

- [ ] **Step 3: Write the failing repository test**

In `src/modules/categories/infrastructure/drizzle-category-repository.int.test.ts`, add `parentCategoryId: null,` to every whole `Category` literal it builds (`rg -n "groupId:" src/modules/categories/infrastructure/drizzle-category-repository.int.test.ts`), replace the comment text `(partial categories_group_name_uq)` with `(partial categories_parent_name_uq)`, and append to the end of the file:

```ts

describe("subcategories (HU-E3-04)", () => {
  it("stores a subcategory under its parent and moves it with its siblings' names", async () => {
    const { repo, space, food, category } = await subcategoryWorld();
    const groceries = category("Groceries", null);
    const vegetables = category("Vegetables", groceries.id);
    await repo.addCategories([groceries, vegetables]);
    expect((await repo.listCategories(space)).find((c) => c.id === vegetables.id)).toEqual(vegetables);
    // A subcategory may share its name with a category elsewhere, never with a sibling.
    await repo.addCategories([category("Vegetables", null)]);
    await expect(repo.addCategories([category("vegetables", groceries.id)])).rejects.toThrow();
    await repo.saveCategories([{ ...vegetables, parentCategoryId: null, name: "Veggies" }]);
    expect((await repo.listCategories(space)).find((c) => c.id === vegetables.id)).toMatchObject({
      parentCategoryId: null,
      groupId: food,
    });
  });
});
```

and insert before that `describe` the helper (it uses the file's `db`, `pool`, `repo`, `randomUUID` and `personalSpaceFixture`; add `import type { Category, CategoryGroupId, CategoryId } from "../domain/category";`):

```ts
/** A fresh space with the group "Food"; `category(name, parentId)` builds a live category of it. */
const subcategoryWorld = async () => {
  const space = (await personalSpaceFixture(db, pool)).spaceId;
  const food = randomUUID();
  await repo.addGroups([{ id: food as CategoryGroupId, spaceId: space, name: "Food", archivedAt: null, createdAt: new Date() }]);
  const category = (name: string, parentId: string | null): Category => ({
    id: randomUUID() as CategoryId,
    spaceId: space,
    groupId: food as CategoryGroupId,
    parentCategoryId: parentId as CategoryId | null,
    name,
    key: null,
    archivedAt: null,
    createdAt: new Date("2026-10-16T12:00:00.000Z"),
  });
  return { repo, space, food, category };
};
```

Run: `pnpm exec vitest run --project integration src/modules/categories/infrastructure`
Expected: FAIL — `column "parent_category_id" does not exist` once the repository writes it (Step 4), or the loaded rows lack `parentCategoryId` (now).

- [ ] **Step 4: Add the column and generate the migration**

In `src/modules/categories/infrastructure/categories.schema.ts`:
1. Replace the line `import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";` with:

```ts
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
```

2. Insert after the line `      .references(() => categoryGroups.id),`:

```ts
    // HU-E3-04: the category a subcategory refines; null for a category directly in its group.
    parentCategoryId: uuid("parent_category_id").references((): AnyPgColumn => categories.id),
```

3. Replace the lines from `    // HU-E3-02: unique per parent ignoring case among rows not deleted (archived ones included; D8).` to `      .where(sql\`${t.deletedAt} IS NULL\`),` with:

```ts
    // HU-E3-02, HU-E3-04: unique among siblings ignoring case, rows not deleted (archived ones included; D8). Siblings
    // share a parent: the parent category of a subcategory, else the group (UUIDs never collide across the two).
    uniqueIndex("categories_parent_name_uq")
      .on(sql`coalesce(${t.parentCategoryId}, ${t.groupId})`, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
    index("categories_parent_idx").on(t.parentCategoryId),
    check("categories_not_own_parent", sql`${t.parentCategoryId} <> ${t.id}`),
```

In `src/modules/categories/infrastructure/drizzle-category-repository.ts`: insert after the line `          groupId: c.groupId,` the line `          parentCategoryId: c.parentCategoryId,`; insert after the line `        groupId: categories.groupId,` the line `        parentCategoryId: categories.parentCategoryId,`; replace the two lines `      // HU-E3-04: stored from Task 9a's migration on.` and `      parentCategoryId: null,` (Task 8's, inside `listCategories`) with the line `      parentCategoryId: row.parentCategoryId as CategoryId | null,`; and replace the line `        .set({ name: c.name, groupId: c.groupId, archivedAt: c.archivedAt })` with:

```ts
        .set({ name: c.name, groupId: c.groupId, parentCategoryId: c.parentCategoryId, archivedAt: c.archivedAt })
```

Run: `pnpm db:generate --name subcategories`
Expected: `drizzle/0013_subcategories.sql` adds `parent_category_id` with its foreign key, drops `categories_group_name_uq`, creates `categories_parent_name_uq` and `categories_parent_idx`, adds `categories_not_own_parent`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project integration src/modules/categories` and `pnpm exec vitest run --project unit src/modules/categories`
Expected: PASS.

- [ ] **Step 6: Run the gates, then commit**

```bash
git add src/modules/categories drizzle/0013_subcategories.sql drizzle/meta
git commit -m "feat(categories): store subcategories and apply the tree rules in every category use case (Refs #98)"
```

---

### Task 9b: HTTP — subcategories in the category endpoints

Exposes HU-E3-04 on `POST …/categories` (`groupId` or `parentCategoryId`, exactly one), `PATCH …/categories/{categoryId}` (`parentCategoryId`, `null` to promote) and `GET …/categories` (nested `subcategories`).

**Files:**
- Modify: `src/modules/categories/contracts/categories.contract.ts`, `src/app/api/v1/spaces/[spaceId]/categories/route.ts`, `src/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E3-categories.md`
- Create: `tests/acceptance/subcategories.test.ts`

**Interfaces:**
- Consumes: Task 9a's inputs and `CategoryNode`.
- Produces: `CategorySchema.parentCategoryId`; `CategoryGroupSchema.categories[].subcategories`; `CreateCategoryBodySchema` (`groupId` xor `parentCategoryId`), `UpdateCategoryBodySchema.parentCategoryId`; test helpers `subcategory(user, parentId, name)` and `treeOf(user)` in the new acceptance file.

- [ ] **Step 1: Write the failing acceptance test**

Create `tests/acceptance/subcategories.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listCategories, POST as createCategory } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import {
  DELETE as deleteCategory,
  PATCH as updateCategory,
} from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route";
import { POST as archiveCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/archive/route";
import { POST as restoreCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/restore/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { categoryWithKey, cop, inSpace, newAccount, post } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface CategoryDto {
  id: string;
  groupId: string;
  parentCategoryId: string | null;
  name: string;
  key: string | null;
  archivedAt: string | null;
}
type Tree = { id: string; categories: (CategoryDto & { subcategories: CategoryDto[] })[] }[];

const createIn = (user: TestUser, body: unknown) =>
  call(createCategory, "POST", inSpace(user, "categories"), { user, params: { spaceId: user.spaceId }, body });
const subcategory = async (user: TestUser, parentCategoryId: string, name: string): Promise<CategoryDto> => {
  const response = await createIn(user, { parentCategoryId, name });
  if (response.status !== 201) throw new Error(`subcategory failed with status ${response.status}`);
  return (await response.json()) as CategoryDto;
};
const treeOf = async (user: TestUser, archived = false): Promise<Tree> =>
  ((await (
    await call(listCategories, "GET", inSpace(user, `categories?archived=${archived}`), {
      user,
      params: { spaceId: user.spaceId },
    })
  ).json()) as { items: Tree }).items;
const onCategory = (handler: typeof updateCategory, method: string, user: TestUser, id: string, body?: unknown) =>
  call(handler, method, inSpace(user, `categories/${id}`), { user, params: { spaceId: user.spaceId, categoryId: id }, body });

describe("optional subcategories (HU-E3-04)", () => {
  it("creates Verduras and Carnes under Mercado, in its group and without catalog key", async () => {
    const ana = await registerUser("Ana");
    const mercado = await categoryWithKey(ana, "groceries");
    const verduras = await subcategory(ana, mercado, "Verduras");
    await subcategory(ana, mercado, "Carnes");
    const node = (await treeOf(ana)).flatMap((g) => g.categories).find((c) => c.id === mercado)!;
    expect(node.subcategories.map((s) => [s.name, s.parentCategoryId, s.groupId, s.key])).toEqual([
      ["Carnes", mercado, node.groupId, null],
      ["Verduras", mercado, node.groupId, null],
    ]);
    expect(verduras.parentCategoryId).toBe(mercado);
  });

  it("asks for exactly one of groupId and parentCategoryId", async () => {
    const ana = await registerUser("Ana");
    const mercado = await categoryWithKey(ana, "groceries");
    const group = (await treeOf(ana))[0]!.id;
    expect(await problemOf(await createIn(ana, { name: "X" }))).toEqual([422, "ValidationFailed"]);
    expect(await problemOf(await createIn(ana, { groupId: group, parentCategoryId: mercado, name: "X" }))).toEqual([
      422,
      "ValidationFailed",
    ]);
  });

  it("refuses a fourth level and moving Mercado under Restaurantes", async () => {
    const ana = await registerUser("Ana");
    const mercado = await categoryWithKey(ana, "groceries");
    const verduras = await subcategory(ana, mercado, "Verduras");
    expect(await problemOf(await createIn(ana, { parentCategoryId: verduras.id, name: "Orgánico" }))).toEqual([
      409,
      "CategoryDepthExceeded",
    ]);
    const restaurantes = await categoryWithKey(ana, "restaurants");
    const moved = await onCategory(updateCategory, "PATCH", ana, mercado, { parentCategoryId: restaurantes });
    expect(await problemOf(moved)).toEqual([409, "CategoryDepthExceeded"]);
  });

  it("archives the subcategories with their category and restores one only under a live parent", async () => {
    const ana = await registerUser("Ana");
    const bank = await newAccount(ana, "Bancolombia", 1_000_000);
    const mercado = await categoryWithKey(ana, "groceries");
    const verduras = await subcategory(ana, mercado, "Verduras");
    expect((await onCategory(archiveCategory, "POST", ana, mercado)).status).toBe(200);
    const archivedNode = (await treeOf(ana, true)).flatMap((g) => g.categories).find((c) => c.id === mercado)!;
    expect(archivedNode.subcategories[0]?.archivedAt).not.toBeNull();
    const spent = await post(recordExpense, ana, "expenses", { categoryId: verduras.id, amount: cop(40_000), accountId: bank });
    expect(await problemOf(spent)).toEqual([409, "CategoryArchived"]);
    expect(await problemOf(await onCategory(restoreCategory, "POST", ana, verduras.id))).toEqual([
      409,
      "ParentCategoryArchived",
    ]);
  });

  it("keeps a category with subcategories, and promotes a subcategory back to a category", async () => {
    const ana = await registerUser("Ana");
    const group = (await treeOf(ana))[0]!.id;
    const pets = (await (await createIn(ana, { groupId: group, name: "Mascotas" })).json()) as CategoryDto;
    const vet = await subcategory(ana, pets.id, "Veterinario");
    expect(await problemOf(await onCategory(deleteCategory, "DELETE", ana, pets.id))).toEqual([409, "CategoryInUse"]);
    const promoted = await onCategory(updateCategory, "PATCH", ana, vet.id, { parentCategoryId: null });
    expect(await promoted.json()).toMatchObject({ parentCategoryId: null, groupId: group });
    expect((await onCategory(deleteCategory, "DELETE", ana, pets.id)).status).toBe(204);
  });
});
```

Run: `pnpm exec vitest run --project acceptance tests/acceptance/subcategories.test.ts`
Expected: FAIL — `groupId` is required by `CreateCategoryBodySchema`, so the first subcategory answers 422.

- [ ] **Step 2: Extend the contract and the routes**

In `src/modules/categories/contracts/categories.contract.ts`:

1. Insert after the line `  groupId: z.string(),` (inside `CategorySchema`):

```ts
  /** HU-E3-04: the category this subcategory refines; null for a category directly in its group. */
  parentCategoryId: z.string().nullable(),
```

2. Replace the line `export const CategoryGroupSchema = CategoryGroupSummarySchema.extend({ categories: z.array(CategorySchema) });` with:

```ts
export const CategoryGroupSchema = CategoryGroupSummarySchema.extend({
  /** HU-E3-04: the group's categories, each with its subcategories. */
  categories: z.array(CategorySchema.extend({ subcategories: z.array(CategorySchema) })),
});
```

3. Replace the lines `export const CreateCategoryBodySchema = z.object({ groupId: ParentId, name: Name });` and `export const UpdateCategoryBodySchema = z.object({ name: Name.optional(), groupId: ParentId.optional() });` with:

```ts
/** HU-E3-04: a category of `groupId`, or a subcategory of `parentCategoryId`; exactly one. */
export const CreateCategoryBodySchema = z
  .object({ groupId: ParentId.optional(), parentCategoryId: ParentId.optional(), name: Name })
  .refine((body) => (body.groupId === undefined) !== (body.parentCategoryId === undefined), {
    error: "Send exactly one of groupId and parentCategoryId",
    path: ["groupId"],
  });
/** HU-E3-04: `parentCategoryId` makes it a subcategory (in its parent's group); null makes it a category again. */
export const UpdateCategoryBodySchema = z
  .object({ name: Name.optional(), groupId: ParentId.optional(), parentCategoryId: ParentId.nullable().optional() })
  .refine((body) => body.groupId === undefined || typeof body.parentCategoryId !== "string", {
    error: "A subcategory takes its parent's group",
    path: ["groupId"],
  });
```

4. Insert after the line `  groupId: c.groupId,` (inside `categoryDto`): `  parentCategoryId: c.parentCategoryId,`.
5. Replace the line `  categories: g.categories.map(categoryDto),` with `  categories: g.categories.map((c) => ({ ...categoryDto(c), subcategories: c.subcategories.map(categoryDto) })),`.
6. In `categoriesPaths`, append `, ParentCategoryArchived` to the `"409"` descriptions of the create and update operations and of `POST …/categories/{categoryId}/restore`, and `, CategoryNotFound` to the create operation's `"404"` description.

In `src/app/api/v1/spaces/[spaceId]/categories/route.ts`, insert after the line `      groupId: body.groupId,`: `      parentCategoryId: body.parentCategoryId,`. In `src/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route.ts`, insert after the line `      groupId: body.groupId,`: `      parentCategoryId: body.parentCategoryId,`.

In `docs/backlog/E3-categories.md`, insert before the line that starts with `- **Spec impact:** 5.2 **CategoryGroup / Category** ("two levels" becomes`:

```markdown
- Errors (catalogue, spec 8): `CategoryDepthExceeded` (409) for a fourth level or a category with subcategories moved under another; `ParentCategoryArchived` (409) for a subcategory created, moved or restored under an archived category; `CategoryInUse` (409) for a category with subcategories that are not deleted; `CategoryNotFound` (404) for an unknown `parentCategoryId`; `ValidationFailed` (422) without exactly one of `groupId` and `parentCategoryId` (M3-D Task 9b).
```

Regenerate the snapshot. Expected diff: `Category.parentCategoryId`, `CategoryGroup.categories[].subcategories`, both bodies and the descriptions; no new component.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/subcategories.test.ts tests/acceptance/categories.test.ts`
Expected: PASS (M1's "third level" test sends a category id as `groupId` and still answers `CategoryDepthExceeded`).

- [ ] **Step 4: Run the gates, then commit**

```bash
git add src/modules/categories/contracts "src/app/api/v1/spaces/[spaceId]/categories" tests/acceptance/subcategories.test.ts openapi/openapi.snapshot.json docs/backlog/E3-categories.md
git commit -m "feat(categories): create, move and list subcategories over HTTP (Refs #98)"
```

---

### Task 10: Budgeting — subcategories roll up into their category's line

Implements HU-E3-04's roll-up rule `rollUp(categoryId) = parentCategoryId ?? categoryId` for budgets: spending, the catch-all line and "Unbudgeted", the default split, mappings and copies.

Decisions:
- Budgeting learns the parent through its own `BudgetCategories` port (`parentCategoryId`, optional: absent means a category directly in its group); `BudgetingDeps` gains `categories`, which every plan view reads. Budgeting never imports categories.
- Only categories are mapped: `checkedMapping` answers `SubcategoryNotMappable` (409) for a subcategory. A mapping of a category that later became a subcategory is never consulted (its spending rolls up to its new parent first) and a copy leaves it out, reporting it in `dropped.mappings` like an archived category (ruling P48).
- The default split of an expense in a subcategory resolves its parent's line (spec 5.3 as amended).

**Files:**
- Create: `src/modules/budgeting/domain/category-rollup.ts`, `src/modules/budgeting/domain/category-rollup.test.ts`
- Modify: `src/modules/budgeting/application/ports.ts`, `src/modules/budgeting/application/deps.ts`, `src/modules/budgeting/application/plan-view.ts`, `src/modules/budgeting/application/default-split.ts`, `src/modules/budgeting/application/copy-budget-plan.ts`, `src/modules/budgeting/domain/budget-line.ts`, `src/modules/budgeting/application/mappings.test.ts`, `src/modules/budgeting/contracts/budgeting.contract.ts`, `tests/support/budgeting-world.ts`, `src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts`, `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E6-budgeting.md`

**Interfaces:**
- Consumes: `Category.parentCategoryId` through the container's `budgetCategories` adapter (Task 9a).
- Produces:
  - `BudgetCategories.list(spaceId): Promise<{ id: string; archived: boolean; parentCategoryId?: string | null }[]>`
  - `BudgetingDeps.categories: BudgetCategories`
  - `interface CategoryParent { id: string; parentCategoryId?: string | null }`
  - `rolledUpCategory(categoryId: string, categories: readonly CategoryParent[]): string`
  - `rolledUpSpending(byCategory, categories): { categoryId: string; amount: bigint }[]`
  - `mappable<T extends CategoryParent>(categories: readonly T[]): T[]`
  - `defaultSplitOf(deps: Pick<BudgetingDeps, "plans" | "categories">, expense)`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/budgeting/domain/category-rollup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mappable, rolledUpCategory, rolledUpSpending } from "./category-rollup";

const categories = [
  { id: "cat-groceries" },
  { id: "cat-vegetables", parentCategoryId: "cat-groceries" },
  { id: "cat-meat", parentCategoryId: "cat-groceries" },
  { id: "cat-restaurants", parentCategoryId: null },
];

describe("subcategory roll-up (HU-E3-04)", () => {
  it("counts a subcategory as its parent and anything else as itself", () => {
    expect(rolledUpCategory("cat-vegetables", categories)).toBe("cat-groceries");
    expect(rolledUpCategory("cat-groceries", categories)).toBe("cat-groceries");
    expect(rolledUpCategory("cat-unknown", categories)).toBe("cat-unknown");
  });

  it("sums the spending of Vegetables and Meat into Groceries, first seen first", () => {
    expect(
      rolledUpSpending(
        [
          { categoryId: "cat-vegetables", amount: 4_000_000n },
          { categoryId: "cat-restaurants", amount: 6_000_000n },
          { categoryId: "cat-meat", amount: 6_000_000n },
          { categoryId: "cat-groceries", amount: 8_500_000n },
        ],
        categories,
      ),
    ).toEqual([
      { categoryId: "cat-groceries", amount: 18_500_000n },
      { categoryId: "cat-restaurants", amount: 6_000_000n },
    ]);
  });

  it("maps only categories directly in their group", () => {
    expect(mappable(categories).map((c) => c.id)).toEqual(["cat-groceries", "cat-restaurants"]);
  });
});
```

Append to the end of `src/modules/budgeting/application/mappings.test.ts`:

```ts

describe("subcategories (HU-E3-04)", () => {
  it("counts Vegetables and Meat as spent where Groceries is mapped, and refuses to map them", async () => {
    const { mapTo, spending, lineIn } = await world();
    spending.byCategory = [
      { categoryId: "cat-vegetables", amount: 4_000_000n },
      { categoryId: "cat-meat", amount: 6_000_000n },
      { categoryId: "cat-groceries", amount: 8_500_000n },
    ];
    const view = unwrap(await mapTo("home", ["cat-groceries"]));
    expect(lineIn(view, "Home").spent).toBe(18_500_000n);
    expect(view.figures.unbudgeted).toEqual({ spent: 0n, available: 0n });
    expect(codeOf(await mapTo("free", ["cat-vegetables"]))).toBe("SubcategoryNotMappable");
  });

  it("counts an unmapped subcategory of an unmapped category as Unbudgeted", async () => {
    const { mapTo, spending } = await world();
    spending.byCategory = [{ categoryId: "cat-vegetables", amount: 4_000_000n }];
    expect(unwrap(await mapTo("home", ["cat-utilities"])).figures.unbudgeted).toEqual({
      spent: 4_000_000n,
      available: -4_000_000n,
    });
  });
});
```

In `tests/support/budgeting-world.ts`, replace the line `          { id: "cat-old", archived: true },` with:

```ts
          { id: "cat-old", archived: true },
          // HU-E3-04: Groceries' subcategories.
          { id: "cat-vegetables", archived: false, parentCategoryId: "cat-groceries" },
          { id: "cat-meat", archived: false, parentCategoryId: "cat-groceries" },
```

and insert after the line `    savingsAccounts,` (inside `budgetingWorld`'s `deps`): `    categories: householdCategories,`. (`householdCategories` is declared further down the file; it is a module-level `const` read when `budgetingWorld` runs, so the order is safe.)

Run: `pnpm exec vitest run --project unit src/modules/budgeting`
Expected: FAIL — `Cannot find module './category-rollup'`, and the Home line counts only 8,500,000.

- [ ] **Step 2: Write the roll-up and apply it**

Create `src/modules/budgeting/domain/category-rollup.ts`:

```ts
/** HU-E3-04: what budgeting knows of a category's place in the tree; absent or null means directly in its group. */
export interface CategoryParent {
  readonly id: string;
  readonly parentCategoryId?: string | null;
}

/** HU-E3-04, D20: rollUp(categoryId) = parentCategoryId ?? categoryId. */
export const rolledUpCategory = (categoryId: string, categories: readonly CategoryParent[]): string =>
  categories.find((c) => c.id === categoryId)?.parentCategoryId ?? categoryId;

/** HU-E3-04: spending per category with each subcategory's amount added to its parent, in first-seen order. */
export const rolledUpSpending = (
  byCategory: readonly { readonly categoryId: string; readonly amount: bigint }[],
  categories: readonly CategoryParent[],
): { categoryId: string; amount: bigint }[] => {
  const sums = new Map<string, bigint>();
  for (const { categoryId, amount } of byCategory) {
    const into = rolledUpCategory(categoryId, categories);
    sums.set(into, (sums.get(into) ?? 0n) + amount);
  }
  return [...sums].map(([categoryId, amount]) => ({ categoryId, amount }));
};

/** HU-E3-04, ruling P48: only categories directly in their group are mapped to lines. */
export const mappable = <T extends CategoryParent>(categories: readonly T[]): T[] =>
  categories.filter((c) => (c.parentCategoryId ?? null) === null);
```

In `src/modules/budgeting/application/ports.ts`, replace the line `  list(spaceId: string): Promise<{ readonly id: string; readonly archived: boolean }[]>;` with:

```ts
  list(
    spaceId: string,
  ): Promise<{ readonly id: string; readonly archived: boolean; readonly parentCategoryId?: string | null }[]>;
```

In `src/modules/budgeting/application/deps.ts`, replace the line `import type { BudgetPlanRepository, PlanSpending, SavingsAccountReader } from "./ports";` with `import type { BudgetCategories, BudgetPlanRepository, PlanSpending, SavingsAccountReader } from "./ports";`, and insert after the line `  readonly savingsAccounts: SavingsAccountReader;`:

```ts
  /** HU-E3-04: the space's live categories with their parents, so subcategories roll up (D20). */
  readonly categories: BudgetCategories;
```

In `src/modules/budgeting/application/plan-view.ts`:
1. Replace the line `type ViewDeps = Pick<BudgetingDeps, "members" | "plans" | "spending" | "savingsAccounts">;` with `type ViewDeps = Pick<BudgetingDeps, "members" | "plans" | "spending" | "savingsAccounts" | "categories">;`.
2. Replace the line `    byCategory: await deps.spending.expensesByCategory(space.spaceId, start, end),` with:

```ts
    // HU-E3-04: a subcategory's expenses count where its category is mapped, the catch-all and Unbudgeted included.
    byCategory: rolledUpSpending(
      await deps.spending.expensesByCategory(space.spaceId, start, end),
      await deps.categories.list(space.spaceId),
    ),
```

3. Add `import { rolledUpSpending } from "../domain/category-rollup";` to its imports.

In `src/modules/budgeting/application/default-split.ts`:
1. Replace the line `  deps: Pick<BudgetingDeps, "plans">,` with `  deps: Pick<BudgetingDeps, "plans" | "categories">,`.
2. Replace the line `  const lineId = lineForCategory(expense.categoryId, parts);` with:

```ts
  // HU-E3-04: an expense in a subcategory follows its parent's line.
  const categoryId = rolledUpCategory(expense.categoryId, await deps.categories.list(expense.spaceId));
  const lineId = lineForCategory(categoryId, parts);
```

3. Add `import { rolledUpCategory } from "../domain/category-rollup";` to its imports.

In `src/modules/budgeting/application/copy-budget-plan.ts`, replace the line `        categories: await deps.categories.list(space.spaceId),` with:

```ts
        // HU-E3-04, ruling P48: a mapping of a category that became a subcategory is dropped like an archived one.
        categories: mappable(await deps.categories.list(space.spaceId)),
```

and add `import { mappable } from "../domain/category-rollup";` to its imports.

In `src/modules/budgeting/domain/budget-line.ts`:
1. Replace the line `    readonly categories: readonly { readonly id: string; readonly archived: boolean }[];` (inside `checkedMapping`'s `context`) with:

```ts
    readonly categories: readonly {
      readonly id: string;
      readonly archived: boolean;
      readonly parentCategoryId?: string | null;
    }[];
```

2. Insert after the line `    if (category === undefined) return err(domainError("CategoryNotInSpace"));`:

```ts
    // HU-E3-04: only categories are mapped; a subcategory follows its parent (D20).
    if ((category.parentCategoryId ?? null) !== null) return err(domainError("SubcategoryNotMappable"));
```

In `src/composition/container.ts`:
1. Cut the block from the line `  // HU-E6-04: plans map the space's live categories; deleted ones never appear (D8).` to the closing `  };` of `budgetCategories`, and paste it before the line `  const ledgerDeps: LedgerDeps = {`, with its mapping line `        archived: c.archivedAt !== null,` followed by the new line `        parentCategoryId: c.parentCategoryId,`.
2. Replace the line `        const split = await defaultSplitOf({ plans: budgetPlans }, expense);` with `        const split = await defaultSplitOf({ plans: budgetPlans, categories: budgetCategories }, expense);`.

In `src/modules/budgeting/contracts/budgeting.contract.ts`, append `, SubcategoryNotMappable` to the `"409"` description of `PUT …/plans/{planId}/lines/{lineId}/categories`.

In `docs/backlog/E6-budgeting.md`, insert after the line that starts with `- Subcategories (HU-E3-04, M3-D) are never mapped (\`SubcategoryNotMappable\`)`:

```markdown
- Errors (catalogue, spec 8): `SubcategoryNotMappable` (409) from `PUT …/lines/{lineId}/categories`; a mapping of a category that later became a subcategory stops counting and copies drop it into `dropped.mappings` (M3-D Task 10).
```

Literal sites: run `rg -n "const deps: BudgetingDeps|: BudgetingDeps = " src tests --type ts` and `rg -n "savingsAccounts:" src/modules/budgeting`; every `BudgetingDeps` literal they list gains `categories: householdCategories,` (or the test's own categories). Two integration files build untyped deps literals that the first rg does not list: insert `categories: { list: async () => [] },` before the `savingsAccounts:` line of `household()` in `src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts` (baseline line 174) and of each deps literal of `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts` that lacks one (baseline lines 484, 681, 784 and 1292; the literal at 1053 already passes `categories`).

Regenerate the snapshot. Expected diff: one 409 description.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/budgeting` and `pnpm exec vitest run --project integration src/modules/budgeting`
Expected: PASS.

- [ ] **Step 4: Run the gates, then commit**

```bash
git add src/modules/budgeting tests/support/budgeting-world.ts src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts src/composition/container.ts openapi/openapi.snapshot.json docs/backlog/E6-budgeting.md
git commit -m "feat(budgeting): roll subcategories up into their category's line, splits and copies (Refs #98)"
```

---

### Task 11: Ledger — a category filter also lists its subcategories

Implements the filter half of HU-E3-04's roll-up (HU-E4-05 as refined), and pins the budget and list scenarios end to end.

Decisions:
- `ListTransactions` expands `categoryIds` with the subcategories of every listed category, archived ones included (they keep their transactions), through the ledger's own `CategoryReader.subcategoriesOf`; a subcategory listed alone matches only itself. Totals use the same expanded filter (ruling P48).

**Files:**
- Modify: `src/modules/ledger/application/ports.ts`, `src/modules/ledger/application/list-transactions.ts`, `src/modules/ledger/application/list-transactions.test.ts`, `tests/support/in-memory-ledger.ts`, `src/composition/container.ts`, `src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts`, `src/modules/ledger/application/materialize-occurrences.test.ts`, `src/modules/ledger/application/record-income-and-transfer.test.ts`, `src/modules/ledger/application/manage-recurrences.test.ts`, `src/modules/ledger/infrastructure/concurrent-occurrences.int.test.ts` (the last four are literal sites, three of them M3-C's), `tests/acceptance/subcategories.test.ts`

**Interfaces:**
- Consumes: `Category.parentCategoryId` (Task 9a); `SubcategoryNotMappable` and the roll-up (Task 10).
- Produces: `CategoryReader.subcategoriesOf(spaceId: string, categoryIds: readonly string[]): Promise<string[]>`; `CATEGORIES.vegetables` (`cat-vegetables`, parent `cat-groceries`) in the ledger's in-memory fixture.

- [ ] **Step 1: Write the failing tests**

Append to the end of `src/modules/ledger/application/list-transactions.test.ts`:

```ts

describe("subcategories (HU-E3-04)", () => {
  it("lists a category with its subcategories, totals included, and a subcategory alone", async () => {
    const { deps, store } = ledgerFixture();
    store.rows.push(
      anExpense("2026-10-05", 8_500_000n, { description: "Groceries" }),
      anExpense("2026-10-06", 4_000_000n, { description: "Vegetables", categoryId: CATEGORIES.vegetables.id }),
      anExpense("2026-10-07", 6_000_000n, { description: "Dinner", categoryId: CATEGORIES.restaurants.id }),
    );
    const byGroceries = unwrap(await list(deps, { period: "2026-10", categoryIds: [CATEGORIES.groceries.id] }));
    expect(byGroceries.items.map((t) => t.description)).toEqual(["Vegetables", "Groceries"]);
    expect(byGroceries.totals.expenses).toBe(12_500_000n);
    const byVegetables = unwrap(await list(deps, { period: "2026-10", categoryIds: [CATEGORIES.vegetables.id] }));
    expect(byVegetables.items.map((t) => t.description)).toEqual(["Vegetables"]);
  });
});
```

Append to the end of `tests/acceptance/subcategories.test.ts` (and add the imports it names to the top of the file):

```ts

describe("subcategories roll up (HU-E3-04)", () => {
  it("never requires a subcategory, and filters a category with its subcategories", async () => {
    const h = await household();
    const vegetables = await subcategory(h.ana, h.groceries, "Vegetables");
    const restaurants = await categoryWithKey(h.ana, "restaurants");
    for (const [categoryId, pesos] of [
      [h.groceries, 85_000],
      [vegetables.id, 40_000],
      [restaurants, 60_000],
    ] as const) {
      const recorded = await post(recordExpense, h.ana, "expenses", {
        date: "2026-10-12",
        categoryId,
        amount: cop(pesos),
        accountId: h.ana.account,
      });
      expect(recorded.status).toBe(201);
    }
    const listed = async (categoryId: string) =>
      (await (
        await call(listTransactions, "GET", inSpace(h.ana, `transactions?period=2026-10&categoryIds=${categoryId}`), {
          user: h.ana,
          params: { spaceId: h.spaceId },
        })
      ).json()) as { items: { categoryId: string }[]; totals: { expenses: { amount: string } } };
    const byGroceries = await listed(h.groceries);
    expect([byGroceries.items.length, byGroceries.totals.expenses]).toEqual([2, cop(125_000)]);
    expect((await listed(vegetables.id)).items.map((t) => t.categoryId)).toEqual([vegetables.id]);
  });

  it("counts Vegetables and Meat as spent in Home and splits a Meat expense by Home's allocation", async () => {
    const { h, planId, lineId } = await referencePlan();
    const vegetables = await subcategory(h.ana, h.groceries, "Vegetables");
    const meat = await subcategory(h.ana, h.groceries, "Meat");
    expect((await putCategories(h.ana, h.spaceId, planId, lineId("Home"), [h.groceries])).status).toBe(200);
    expect((await activatePlan(h.ana, h.spaceId, planId)).status).toBe(200);
    let meatExpense: { shares: { splitMethod: string }[] } | undefined;
    for (const [categoryId, pesos] of [
      [vegetables.id, 40_000],
      [meat.id, 60_000],
      [h.groceries, 85_000],
    ] as const) {
      const recorded = await post(recordExpense, h.ana, "expenses", {
        date: "2026-11-10",
        categoryId,
        amount: cop(pesos),
        accountId: h.ana.account,
      });
      expect(recorded.status).toBe(201);
      if (categoryId === meat.id) meatExpense = await recorded.json();
    }
    expect(lineNamed(await planOf(h.ana, h.spaceId, planId), "Home").spent).toEqual(cop(185_000));
    expect(meatExpense?.shares.map((s) => s.splitMethod)).toEqual(["BY_ALLOCATION", "BY_ALLOCATION"]);
    expect(await problemOf(await putCategories(h.ana, h.spaceId, planId, lineId("Free"), [vegetables.id]))).toEqual([
      409,
      "SubcategoryNotMappable",
    ]);
  });
});
```

Imports to add to `tests/acceptance/subcategories.test.ts`: `import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";`, `household` from `../support/ledger`, and `activatePlan`, `lineNamed`, `planOf`, `putCategories`, `referencePlan` from `../support/budgeting`.

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/list-transactions.test.ts` and `pnpm exec vitest run --project acceptance tests/acceptance/subcategories.test.ts`
Expected: FAIL — `CATEGORIES.vegetables` does not exist, and filtering by Groceries lists one expense.

- [ ] **Step 2: Write the implementation**

In `src/modules/ledger/application/ports.ts`, insert after the line `  find(spaceId: string, categoryId: string): Promise<LedgerCategory | null>;`:

```ts
  /** HU-E3-04: the ids of the subcategories (archived ones included, deleted ones not) of the listed categories. */
  subcategoriesOf(spaceId: string, categoryIds: readonly string[]): Promise<string[]>;
```

In `src/modules/ledger/application/list-transactions.ts`, insert before the line `    const filter: TransactionFilter = {`:

```ts
    // HU-E3-04, ruling P48: a category's filter also matches its subcategories; a subcategory matches itself.
    const categoryIds =
      input.categoryIds === undefined || input.categoryIds.length === 0
        ? input.categoryIds
        : [...new Set([...input.categoryIds, ...(await deps.categories.subcategoriesOf(space.spaceId, input.categoryIds))])];
```

and replace the line `      categoryIds: input.categoryIds,` with `      categoryIds,`.

In `tests/support/in-memory-ledger.ts`:
1. Insert after the line `  readonly archived: boolean;` (inside `interface CategoryRow`): `  readonly parentCategoryId?: string;`.
2. Insert after the line `  restaurants: { id: "cat-restaurants", spaceId: "space-ana", archived: false },`:

```ts
  // HU-E3-04: a subcategory of Groceries.
  vegetables: { id: "cat-vegetables", spaceId: "space-ana", archived: false, parentCategoryId: "cat-groceries" },
```

3. Replace the whole `categoryReader` constant (from the line `const categoryReader = (rows: readonly CategoryRow[]): CategoryReader => ({` to its closing `});`) with:

```ts
const categoryReader = (rows: readonly CategoryRow[]): CategoryReader => ({
  find: async (spaceId, id) => {
    const row = rows.find((r) => r.spaceId === spaceId && r.id === id);
    return row ? { id: row.id, archived: row.archived } : null;
  },
  subcategoriesOf: async (spaceId, ids) =>
    rows
      .filter((r) => r.spaceId === spaceId && r.parentCategoryId !== undefined && ids.includes(r.parentCategoryId))
      .map((r) => r.id),
});
```

In `src/composition/container.ts`, replace the lines from `    categories: {` (inside `ledgerDeps`) to its closing `    },` with:

```ts
    categories: {
      find: async (spaceId, categoryId) => {
        const category = (await categoriesDeps.categories.listCategories(spaceId)).find(
          (c) => c.id === categoryId,
        );
        return category ? { id: category.id, archived: category.archivedAt !== null } : null;
      },
      // HU-E3-04: the filter's subcategories; listCategories skips deleted rows and keeps archived ones.
      subcategoriesOf: async (spaceId, categoryIds) =>
        (await categoriesDeps.categories.listCategories(spaceId))
          .filter((c) => c.parentCategoryId !== null && categoryIds.includes(c.parentCategoryId))
          .map((c) => c.id),
    },
```

Literal sites: run `rg -U -n "categories: \{\s*find" src tests` (multi-line); every `CategoryReader` literal it lists gains `subcategoriesOf: async () => []`. Today there are five: the ledger deps of `src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts` (:373), M3-C's `src/modules/ledger/application/materialize-occurrences.test.ts` (:499), `src/modules/ledger/application/record-income-and-transfer.test.ts` (:50), M3-C's `src/modules/ledger/infrastructure/concurrent-occurrences.int.test.ts` (:70), and M3-C's `src/modules/ledger/application/manage-recurrences.test.ts` (:100), which wraps `w.deps.categories` and so delegates instead: `subcategoriesOf: (spaceId, ids) => w.deps.categories.subcategoriesOf(spaceId, ids),`.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/ledger`, `pnpm exec vitest run --project integration src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts src/modules/ledger/infrastructure/concurrent-occurrences.int.test.ts` and `pnpm exec vitest run --project acceptance tests/acceptance/subcategories.test.ts tests/acceptance/ledger.test.ts`
Expected: PASS.

- [ ] **Step 4: Run the gates, then commit**

```bash
git add src/modules/ledger/application src/modules/ledger/application/materialize-occurrences.test.ts src/modules/ledger/application/record-income-and-transfer.test.ts src/modules/ledger/application/manage-recurrences.test.ts tests/support/in-memory-ledger.ts src/composition/container.ts src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts src/modules/ledger/infrastructure/concurrent-occurrences.int.test.ts tests/acceptance/subcategories.test.ts
git commit -m "feat(ledger): filter a category together with its subcategories (Refs #98)"
```

---

### Task 12: Accounts — more types and common attributes, in the domain and in PostgreSQL

Implements HU-E2-05's model: four new personal types and four optional attributes on every type (migration `0014_account_attributes`).

Decisions:
- `WALLET`, `INVESTMENT`, `LOAN` and `OTHER` are personal types like CASH, BANK, CREDIT_CARD and SAVINGS (`PersonalAccountRequiresPersonalSpace` unchanged). `accounts.type` is a `text` column whose value list lives only in TypeScript, so the new values need no migration (ruling P49). The lists move to `domain/account-type.ts` so the terms of Task 14 can name a type without an import cycle.
- `institution`, `lastFour`, `color` and `icon` are nullable columns. A null icon means the type's default (`iconOf`), so existing accounts show their default without a back-fill and `PATCH` with `null` returns an account to it (ruling P50). The icon allow-list is the nine defaults plus `briefcase`, `car`, `gem`, `gift`, `house`, `plane`, `smartphone`.
- Patterns and enums are the contract's (`ValidationFailed`, Task 13); `accounts_last_four` (`^[0-9]{4}$`) guards PostgreSQL so a full card number can never be stored.
- `NO_ATTRIBUTES` is every optional field of an account, unset; test helpers that build an `Account` spread it, so Tasks 15a and 16 extend it without touching them again.

**Files:**
- Create: `src/modules/accounts/domain/account-type.ts`, `drizzle/0014_account_attributes.sql` (+ meta, generated)
- Modify: `src/modules/accounts/domain/account.ts`, `src/modules/accounts/domain/account.test.ts`, `src/modules/accounts/application/create-account.ts`, `src/modules/accounts/application/update-account.ts`, `src/modules/accounts/application/index.ts`, `src/modules/accounts/application/manage-accounts.test.ts`, `src/modules/accounts/application/archived-space.test.ts`, `src/modules/accounts/infrastructure/accounts.schema.ts`, `src/modules/accounts/infrastructure/drizzle-account-repository.ts`, `src/modules/accounts/infrastructure/drizzle-account-repository.int.test.ts`, `tests/support/fixtures.ts`, `openapi/openapi.snapshot.json`

**Interfaces:**
- Produces:
  - `ACCOUNT_TYPES` (nine values, `account-type.ts`, re-exported by `account.ts`), `ACCOUNT_COLORS`, `ACCOUNT_ICONS`, `AccountColor`, `AccountIcon`
  - `interface AccountAttributes { institution: string | null; lastFour: string | null; color: AccountColor | null; icon: AccountIcon | null }`; `Account extends AccountAttributes`
  - `NO_ATTRIBUTES`; `type AttributeChanges = { [K in keyof AccountAttributes]?: AccountAttributes[K] }`
  - `iconOf(account: Pick<Account, "type" | "icon">): AccountIcon`
  - `openAccount` input gains `attributes?: AttributeChanges`; `reviseAccount` change gains `attributes?: AttributeChanges`
  - `CreateAccountInput.attributes?`, `AccountChanges.attributes?`

- [ ] **Step 1: Write the failing tests**

In `src/modules/accounts/domain/account.test.ts`:
1. Replace the line `import { archiveAccount, openAccount, reviseAccount, type Account, type AccountId } from "./account";` with:

```ts
import {
  ACCOUNT_TYPES,
  archiveAccount,
  iconOf,
  NO_ATTRIBUTES,
  openAccount,
  reviseAccount,
  type Account,
  type AccountId,
} from "./account";
```

2. Insert after the line `      createdAt: now,` (inside the first `toEqual`): `      ...NO_ATTRIBUTES,`.
3. Append to the end of the file:

```ts

describe("account types and common attributes (HU-E2-05)", () => {
  it("opens a wallet with its institution, last four digits, color and icon", () => {
    const wallet = unwrap(
      open({
        name: "Nequi",
        type: "WALLET",
        attributes: { institution: "Nequi", lastFour: "4821", color: "pine", icon: "wallet" },
      }),
    );
    expect(wallet).toMatchObject({ type: "WALLET", institution: "Nequi", lastFour: "4821", color: "pine", icon: "wallet" });
  });

  it("leaves attributes empty and shows each type's default icon", () => {
    const cash = unwrap(open({ name: "Efectivo", type: "CASH" }));
    expect([cash.institution, cash.lastFour, cash.color, cash.icon, iconOf(cash)]).toEqual([null, null, null, null, "banknote"]);
    expect(ACCOUNT_TYPES.map((type) => iconOf({ type, icon: null }))).toEqual([
      "banknote",
      "landmark",
      "wallet",
      "credit-card",
      "piggy-bank",
      "trending-up",
      "hand-coins",
      "circle-ellipsis",
      "users",
    ]);
  });

  it.each(["WALLET", "INVESTMENT", "LOAN", "OTHER"] as const)("keeps %s accounts in personal spaces", (type) => {
    expect(codeOf(open({ type, spaceKind: "SHARED" }))).toBe("PersonalAccountRequiresPersonalSpace");
  });

  it("changes and clears attributes, and never the type, whatever else the change holds", () => {
    const wallet = unwrap(open({ type: "WALLET", attributes: { color: "pine", institution: "Nequi" } }));
    expect(unwrap(reviseAccount(wallet, { attributes: { color: "ember", institution: null } }, [wallet]))).toMatchObject({
      color: "ember",
      institution: null,
    });
    expect(codeOf(reviseAccount(wallet, { type: "BANK", attributes: { color: "sky" } }, [wallet]))).toBe(
      "AccountTypeImmutable",
    );
  });
});
```

In `src/modules/accounts/application/manage-accounts.test.ts`, `src/modules/accounts/application/archived-space.test.ts` and `src/modules/accounts/infrastructure/drizzle-account-repository.int.test.ts`, insert before the line `  ...overrides,` of each `account` helper the line `  ...NO_ATTRIBUTES,`, and add `NO_ATTRIBUTES` to the file's import from the domain (`../domain/account`). Literal sites: `rg -n "createdAt: (now|new Date)" src/modules/accounts tests/support --type ts` lists every helper; add the spread to each one that builds a whole `Account`. Today that includes `accountFixture` (:52) and `fundAccountFixture` (:143) in `tests/support/fixtures.ts`, which have no `...overrides`: insert `    ...NO_ATTRIBUTES,` after the line `    createdAt: new Date(),` of each, and import `NO_ATTRIBUTES` from `@/modules/accounts/domain/account`.

Append to the end of `src/modules/accounts/infrastructure/drizzle-account-repository.int.test.ts`:

```ts

describe("account attributes (HU-E2-05)", () => {
  it("round-trips the new types and the common attributes, and refuses a full card number", async () => {
    const space = await personalSpaceFixture(db, pool);
    const wallet = account(space, {
      name: "Nequi",
      type: "WALLET",
      institution: "Nequi",
      lastFour: "4821",
      color: "pine",
      icon: "wallet",
    });
    await repo.add(wallet);
    expect(await repo.findById(wallet.id)).toEqual(wallet);
    await repo.save({ ...wallet, color: "ember", icon: null });
    expect(await repo.findById(wallet.id)).toMatchObject({ color: "ember", icon: null });
    await expect(
      pool.query(`UPDATE accounts SET last_four = '4111111111111111' WHERE id = $1`, [wallet.id]),
    ).rejects.toMatchObject({ constraint: "accounts_last_four" });
  });
});
```

Run: `pnpm exec vitest run --project unit src/modules/accounts`
Expected: FAIL — `NO_ATTRIBUTES` and `iconOf` are not exported, and `"WALLET"` is not an `AccountType`.

- [ ] **Step 2: Write the domain**

Create `src/modules/accounts/domain/account-type.ts`:

```ts
/** HU-E2-01, HU-E2-05: every account type; all but SHARED_FUND are personal (HU-E2-02). The type never changes. */
export const ACCOUNT_TYPES = [
  "CASH",
  "BANK",
  "WALLET",
  "CREDIT_CARD",
  "SAVINGS",
  "INVESTMENT",
  "LOAN",
  "OTHER",
  "SHARED_FUND",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
```

In `src/modules/accounts/domain/account.ts`:
1. Replace the line `import { domainError, err, ok, type Id, type Result } from "@/shared/kernel";` with:

```ts
import { domainError, err, ok, type Id, type Result } from "@/shared/kernel";
import type { AccountType } from "./account-type";

export { ACCOUNT_TYPES, type AccountType } from "./account-type";
```

2. Replace the lines `export const ACCOUNT_TYPES = ["CASH", "BANK", "CREDIT_CARD", "SAVINGS", "SHARED_FUND"] as const;` and `export type AccountType = (typeof ACCOUNT_TYPES)[number];` with:

```ts
/** HU-E2-05: the palette keys an account may take. */
export const ACCOUNT_COLORS = ["pine", "ember", "sand", "sky", "plum", "moss", "clay", "slate", "gold", "rose"] as const;
export type AccountColor = (typeof ACCOUNT_COLORS)[number];

/** HU-E2-05, ruling P50: allow-listed Lucide names: each type's default plus a few household ones. */
export const ACCOUNT_ICONS = [
  "banknote",
  "landmark",
  "wallet",
  "credit-card",
  "piggy-bank",
  "trending-up",
  "hand-coins",
  "circle-ellipsis",
  "users",
  "briefcase",
  "car",
  "gem",
  "gift",
  "house",
  "plane",
  "smartphone",
] as const;
export type AccountIcon = (typeof ACCOUNT_ICONS)[number];

const DEFAULT_ICONS: Readonly<Record<AccountType, AccountIcon>> = {
  CASH: "banknote",
  BANK: "landmark",
  WALLET: "wallet",
  CREDIT_CARD: "credit-card",
  SAVINGS: "piggy-bank",
  INVESTMENT: "trending-up",
  LOAN: "hand-coins",
  OTHER: "circle-ellipsis",
  SHARED_FUND: "users",
};

/** HU-E2-05: optional attributes common to every type, SHARED_FUND included. */
export interface AccountAttributes {
  /** User data, 1–60 characters (the UI may suggest a Colombian catalog). */
  readonly institution: string | null;
  /** Exactly four digits; a full card or account number is never stored. */
  readonly lastFour: string | null;
  readonly color: AccountColor | null;
  /** Null: the type's default (`iconOf`, ruling P50). */
  readonly icon: AccountIcon | null;
}

/** Every optional field of an account, unset. */
export const NO_ATTRIBUTES: AccountAttributes = { institution: null, lastFour: null, color: null, icon: null };

/** Undefined keeps an attribute, null clears it. */
export type AttributeChanges = { readonly [K in keyof AccountAttributes]?: AccountAttributes[K] };

const withChanges = (current: AccountAttributes, change: AttributeChanges): AccountAttributes => ({
  institution: change.institution === undefined ? current.institution : change.institution,
  lastFour: change.lastFour === undefined ? current.lastFour : change.lastFour,
  color: change.color === undefined ? current.color : change.color,
  icon: change.icon === undefined ? current.icon : change.icon,
});

/** HU-E2-05: the icon an account shows. */
export const iconOf = (account: Pick<Account, "type" | "icon">): AccountIcon => account.icon ?? DEFAULT_ICONS[account.type];
```

3. Replace the line `export interface Account {` with `export interface Account extends AccountAttributes {`.
4. Insert after the line `  siblings: readonly Account[];` (inside `openAccount`'s input): `  attributes?: AttributeChanges;`.
5. Insert after the line `    createdAt: input.now,` (inside `openAccount`): `    ...withChanges(NO_ATTRIBUTES, input.attributes ?? {}),`.
6. Replace the line `  change: { readonly name?: string; readonly type?: AccountType; readonly openingBalance?: bigint },` with:

```ts
  change: {
    readonly name?: string;
    readonly type?: AccountType;
    readonly openingBalance?: bigint;
    readonly attributes?: AttributeChanges;
  },
```

7. Insert after the line `    openingBalance: change.openingBalance ?? account.openingBalance,` (inside `reviseAccount`): `    ...withChanges(account, change.attributes ?? {}),`.

In `src/modules/accounts/application/index.ts`, replace the lines `export type { Account, AccountId, AccountType } from "../domain/account";` and `export { ACCOUNT_TYPES } from "../domain/account";` with:

```ts
export type {
  Account,
  AccountAttributes,
  AccountColor,
  AccountIcon,
  AccountId,
  AccountType,
  AttributeChanges,
} from "../domain/account";
export { ACCOUNT_COLORS, ACCOUNT_ICONS, ACCOUNT_TYPES, iconOf, NO_ATTRIBUTES } from "../domain/account";
```

In `src/modules/accounts/application/create-account.ts`: replace the line `import { openAccount, type AccountType } from "../domain/account";` with `import { openAccount, type AccountType, type AttributeChanges } from "../domain/account";`; insert after the line `  readonly openingBalance: Money;` (inside `CreateAccountInput`) the line `  readonly attributes?: AttributeChanges;`; insert after the line `        openingBalance: openingBalance.value,` the line `        attributes: input.attributes,`.

In `src/modules/accounts/application/update-account.ts`: replace the line `import { reviseAccount, type AccountType } from "../domain/account";` with `import { reviseAccount, type AccountType, type AttributeChanges } from "../domain/account";`; insert after the line `  readonly openingBalance?: Money;` (inside `AccountChanges`) the line `  readonly attributes?: AttributeChanges;`; replace the line `        { name: changes.name, type: changes.type, openingBalance: openingBalance.value },` with `        { name: changes.name, type: changes.type, openingBalance: openingBalance.value, attributes: changes.attributes },`.

Run: `pnpm exec vitest run --project unit src/modules/accounts`
Expected: PASS.

- [ ] **Step 3: Add the columns and generate the migration**

In `src/modules/accounts/infrastructure/accounts.schema.ts`:
1. Replace the line `    type: text("type", { enum: ["CASH", "BANK", "CREDIT_CARD", "SAVINGS", "SHARED_FUND"] }).notNull(),` with:

```ts
    type: text("type", {
      enum: ["CASH", "BANK", "WALLET", "CREDIT_CARD", "SAVINGS", "INVESTMENT", "LOAN", "OTHER", "SHARED_FUND"],
    }).notNull(),
```

2. Insert after the line `    archivedAt: tz("archived_at"),`:

```ts
    // HU-E2-05: optional common attributes; a null icon means the type's default (ruling P50).
    institution: text("institution"),
    lastFour: text("last_four"),
    color: text("color", { enum: ["pine", "ember", "sand", "sky", "plum", "moss", "clay", "slate", "gold", "rose"] }),
    icon: text("icon"),
```

3. Insert after the line `    check("accounts_shared_fund_owner", sql\`(${t.type} = 'SHARED_FUND') = (${t.ownerUserId} IS NULL)\`),`:

```ts
    // HU-E2-05: only the last four digits, never a full card or account number.
    check("accounts_last_four", sql`${t.lastFour} ~ '^[0-9]{4}$'`),
```

In `src/modules/accounts/infrastructure/drizzle-account-repository.ts`:
1. Replace the line `import type { Account, AccountId } from "../domain/account";` with `import type { Account, AccountIcon, AccountId } from "../domain/account";`.
2. Replace the line `const toAccount = (row: typeof accounts.$inferSelect): Account => ({ ...row, id: row.id as AccountId });` with:

```ts
const toAccount = (row: typeof accounts.$inferSelect): Account => ({
  ...row,
  id: row.id as AccountId,
  icon: row.icon as AccountIcon | null,
});
```

3. Insert after the line `      createdAt: account.createdAt,` (inside `add`):

```ts
      institution: account.institution,
      lastFour: account.lastFour,
      color: account.color,
      icon: account.icon,
```

4. Replace the line `      .set({ name: account.name, openingBalance: account.openingBalance, archivedAt: account.archivedAt })` with:

```ts
      .set({
        name: account.name,
        openingBalance: account.openingBalance,
        archivedAt: account.archivedAt,
        institution: account.institution,
        lastFour: account.lastFour,
        color: account.color,
        icon: account.icon,
      })
```

Run: `pnpm db:generate --name account_attributes`
Expected: `drizzle/0014_account_attributes.sql` adds the four nullable columns and `accounts_last_four`; nothing about `type`.

`AccountTypeSchema` in `accounts.contract.ts` is `z.enum(ACCOUNT_TYPES)`, so the new types reach the contract now: regenerate the snapshot (`UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts`). Expected diff: the four new values in the `type` enums of `Account` and both account bodies (about 12 lines); no new component.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project integration src/modules/accounts` and `pnpm exec vitest run --project unit src/modules/accounts src/composition/openapi.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the gates, then commit**

```bash
git add src/modules/accounts tests/support/fixtures.ts drizzle/0014_account_attributes.sql drizzle/meta openapi/openapi.snapshot.json
git commit -m "feat(accounts): add wallet, investment, loan and other accounts with common attributes (Refs #95)"
```

---

### Task 13: HTTP — account types and common attributes

Exposes Task 12 on `POST …/accounts`, `PATCH …/accounts/{accountId}` and every account answer.

Decisions:
- `institution` is trimmed, 1–60 characters; `lastFour` matches `^\d{4}$`; `color` and `icon` are enums; anything else is `422 ValidationFailed` from the contract, so nothing is stored (HU-E2-05 note). `PATCH` takes `null` to clear each one. The answer's `icon` is always the shown one (`iconOf`), never null.

**Files:**
- Modify: `src/modules/accounts/contracts/accounts.contract.ts`, `src/app/api/v1/spaces/[spaceId]/accounts/route.ts`, `src/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E2-accounts.md`
- Create: `tests/acceptance/account-attributes.test.ts`

**Interfaces:**
- Consumes: Task 12's `AttributeChanges`, `iconOf`, `ACCOUNT_COLORS`, `ACCOUNT_ICONS`.
- Produces: `AccountSchema.institution`, `.lastFour`, `.color`, `.icon`; `attributesFromBody(body): AttributeChanges`; acceptance helpers `create`, `patch`, `listOf` in `account-attributes.test.ts`.

- [ ] **Step 1: Write the failing acceptance test**

Create `tests/acceptance/account-attributes.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listAccounts, POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { PATCH as updateAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { cop, inSpace } from "../support/ledger";
import { actingIn, newSharedSpace } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

export interface AccountDto {
  id: string;
  name: string;
  type: string;
  balance: { amount: string; currency: string };
  institution: string | null;
  lastFour: string | null;
  color: string | null;
  icon: string;
  [field: string]: unknown;
}
const create = (user: TestUser, body: Record<string, unknown>) =>
  call(createAccount, "POST", inSpace(user, "accounts"), { user, params: { spaceId: user.spaceId }, body });
const created = async (user: TestUser, body: Record<string, unknown>): Promise<AccountDto> => {
  const response = await create(user, body);
  if (response.status !== 201) throw new Error(`account failed with status ${response.status}`);
  return (await response.json()) as AccountDto;
};
const patch = (user: TestUser, id: string, body: unknown) =>
  call(updateAccount, "PATCH", inSpace(user, `accounts/${id}`), { user, params: { spaceId: user.spaceId, accountId: id }, body });
const listOf = async (user: TestUser) =>
  ((await (await call(listAccounts, "GET", inSpace(user, "accounts"), { user, params: { spaceId: user.spaceId } })).json()) as {
    items: AccountDto[];
  }).items;

describe("account types and common attributes (HU-E2-05)", () => {
  it("creates a wallet with its common attributes", async () => {
    const ana = await registerUser("Ana");
    const nequi = await created(ana, {
      name: "Nequi",
      type: "WALLET",
      openingBalance: cop(300_000),
      institution: "Nequi",
      lastFour: "4821",
      color: "pine",
      icon: "wallet",
    });
    expect(nequi).toMatchObject({ type: "WALLET", institution: "Nequi", lastFour: "4821", color: "pine", icon: "wallet" });
    expect((await listOf(ana)).map((a) => a.id)).toEqual([nequi.id]);
  });

  it("gives attributes left out the type defaults", async () => {
    const ana = await registerUser("Ana");
    const cash = await created(ana, { name: "Efectivo", type: "CASH", openingBalance: cop(0) });
    expect([cash.icon, cash.institution, cash.lastFour, cash.color]).toEqual(["banknote", null, null, null]);
  });

  it.each(["WALLET", "INVESTMENT", "LOAN", "OTHER"])("keeps %s accounts out of shared spaces", async (type) => {
    const ana = await registerUser("Ana");
    const household = actingIn(ana, await newSharedSpace(ana));
    expect(await problemOf(await create(household, { name: "X", type, openingBalance: cop(0) }))).toEqual([
      409,
      "PersonalAccountRequiresPersonalSpace",
    ]);
  });

  it("accepts only the last four digits of a card", async () => {
    const ana = await registerUser("Ana");
    const visa = await created(ana, { name: "Visa", type: "CREDIT_CARD", openingBalance: cop(-350_000) });
    expect(await problemOf(await patch(ana, visa.id, { lastFour: "4111111111111111" }))).toEqual([422, "ValidationFailed"]);
    expect((await listOf(ana))[0]?.lastFour).toBeNull();
  });

  it("changes and clears common attributes, never the type", async () => {
    const ana = await registerUser("Ana");
    const nequi = await created(ana, { name: "Nequi", type: "WALLET", openingBalance: cop(0), color: "pine", icon: "gem" });
    expect(await (await patch(ana, nequi.id, { color: "ember", icon: null })).json()).toMatchObject({
      color: "ember",
      icon: "wallet",
    });
    expect(await problemOf(await patch(ana, nequi.id, { type: "BANK" }))).toEqual([409, "AccountTypeImmutable"]);
    expect(await problemOf(await patch(ana, nequi.id, { color: "purple" }))).toEqual([422, "ValidationFailed"]);
  });
});
```

Run: `pnpm exec vitest run --project acceptance tests/acceptance/account-attributes.test.ts`
Expected: FAIL — `"WALLET"` is not a valid `type` in the contract (`ValidationFailed`).

- [ ] **Step 2: Extend the contract and the routes**

In `src/modules/accounts/contracts/accounts.contract.ts`:
1. Replace the line `import { ACCOUNT_TYPES, type AccountView } from "../application";` with:

```ts
import {
  ACCOUNT_COLORS,
  ACCOUNT_ICONS,
  ACCOUNT_TYPES,
  iconOf,
  type AttributeChanges,
  type AccountView,
} from "../application";
```

2. Insert after the line `const AccountTypeSchema = z.enum(ACCOUNT_TYPES);`:

```ts
// HU-E2-05: patterns and enums are refused here (ValidationFailed), so nothing invalid is ever stored.
const Institution = z.string().trim().min(1).max(60);
const LastFour = z.string().regex(/^\d{4}$/, { error: "Exactly the last four digits" });
const Color = z.enum(ACCOUNT_COLORS);
const Icon = z.enum(ACCOUNT_ICONS);
```

3. Insert after the line `  archivedAt: z.iso.datetime().nullable(),` (inside `AccountSchema`):

```ts
  institution: z.string().nullable(),
  lastFour: z.string().nullable(),
  color: Color.nullable(),
  /** The icon shown: the chosen one, else the type's default. */
  icon: Icon,
```

4. Replace the lines from `export const CreateAccountBodySchema = z.object({` to the closing `});` of `UpdateAccountBodySchema` with:

```ts
export const CreateAccountBodySchema = z.object({
  name: z.string().max(200),
  type: AccountTypeSchema,
  openingBalance: MoneySchema,
  institution: Institution.optional(),
  lastFour: LastFour.optional(),
  color: Color.optional(),
  icon: Icon.optional(),
});
/** HU-E2-05: `null` clears an attribute (the icon goes back to the type's default). */
export const UpdateAccountBodySchema = z.object({
  name: z.string().max(200).optional(),
  type: AccountTypeSchema.optional(),
  openingBalance: MoneySchema.optional(),
  institution: Institution.nullable().optional(),
  lastFour: LastFour.nullable().optional(),
  color: Color.nullable().optional(),
  icon: Icon.nullable().optional(),
});

/** HU-E2-05: the common attributes of a create or update body. */
export const attributesFromBody = (
  body: Pick<z.infer<typeof UpdateAccountBodySchema>, "institution" | "lastFour" | "color" | "icon">,
): AttributeChanges => ({
  institution: body.institution,
  lastFour: body.lastFour,
  color: body.color,
  icon: body.icon,
});
```

5. Insert after the line `  archivedAt: view.archivedAt?.toISOString() ?? null,` (inside `accountDto`):

```ts
  institution: view.institution,
  lastFour: view.lastFour,
  color: view.color,
  icon: iconOf(view),
```

In `src/app/api/v1/spaces/[spaceId]/accounts/route.ts`, insert after the line `      openingBalance: openingBalance.value,` the line `      attributes: attributesFromBody(body),` and add `attributesFromBody` to the import from `@/modules/accounts/contracts/accounts.contract`. In `src/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route.ts`, replace the line `      changes: { name: body.name, type: body.type, openingBalance: openingBalance.value },` with:

```ts
      changes: {
        name: body.name,
        type: body.type,
        openingBalance: openingBalance.value,
        attributes: attributesFromBody(body),
      },
```

and add `attributesFromBody` to its import from `@/modules/accounts/contracts/accounts.contract`.

In `docs/backlog/E2-accounts.md`, insert before the line that starts with `- **Spec impact:** 5.2 **Account** (new types, common attributes, sign of liabilities)`:

```markdown
- Errors (catalogue, spec 8): `ValidationFailed` (422) for an unknown type, color or icon, a `lastFour` that is not four digits, or an `institution` outside 1–60 characters; `PersonalAccountRequiresPersonalSpace` (409) for the new types in a shared space; `AccountTypeImmutable` (409) (M3-D Task 13).
```

Regenerate the snapshot. Expected diff: `Account` gains four properties and both bodies gain four properties (the four new `type` values are Task 12's); no new component.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/account-attributes.test.ts tests/acceptance/accounts.test.ts`
Expected: PASS.

- [ ] **Step 4: Run the gates, then commit**

```bash
git add src/modules/accounts/contracts "src/app/api/v1/spaces/[spaceId]/accounts" tests/acceptance/account-attributes.test.ts openapi/openapi.snapshot.json docs/backlog/E2-accounts.md
git commit -m "feat(accounts): create and edit the new account types and their common attributes over HTTP (Refs #95)"
```

---

### Task 14: Accounts domain — exact rates and type-specific terms

Implements HU-E2-06's rules as pure functions: rates, the terms each type may carry, their ranges, billing dates and the derived figures.

Decisions:
- A rate is an integer number of parts per million (`2.0 %` = 20,000), from 0 to 100 % (1,000,000). `ratePpmOf` reads a percent with at most four decimals and answers `InvalidRate` for anything else (`"-1"`, `"2,5"`, `"100.0001"`), so the contract can pass the string through (ruling P52). `percentText` returns exactly four decimals.
- Equivalent rates are exact to the nearest millionth in `bigint`: `EA = (1 + i_m)^12 − 1` by powers, `i_m = (1 + EA)^(1/12) − 1` by bisection on a 10^18 scale (no `Math.pow`, no float).
- Terms by type (anything else on any other type is `AccountAttributeNotAllowed`, `details.attribute`): CREDIT_CARD `creditLimit` (> 0, `InvalidCreditLimit`), `cutOffDay`, `paymentDay` (1–31, `InvalidBillingDay`), `monthlyRatePpm`; SAVINGS `annualRatePpm`, `termDays` (1–3,660) and `maturityDate` together or not at all (`InvalidTermDeposit`); LOAN `principal` (> 0, `InvalidAmount`, ruling P52), `annualRatePpm`, `termMonths` (1–480, `InvalidTerm`). SHARED_FUND, CASH, BANK, WALLET, INVESTMENT and OTHER carry none (ruling P54).
- Billing days clamp to the month's last day; the next date is on or after today (ruling P55). A term deposit starts `termDays` before its maturity.

**Files:**
- Create: `src/modules/accounts/domain/rate.ts`, `src/modules/accounts/domain/rate.test.ts`, `src/modules/accounts/domain/account-terms.ts`, `src/modules/accounts/domain/account-terms.test.ts`

**Interfaces:**
- Consumes: `AccountType` (`account-type.ts`, Task 12); kernel dates.
- Produces:
  - `MAX_RATE_PPM`, `ratePpmOf(percent: string): Result<number>`, `percentText(ppm: number): string`, `effectiveAnnualPpm(monthlyPpm: number): number`, `equivalentMonthlyPpm(annualPpm: number): number`
  - `interface AccountTerms { creditLimit: bigint | null; cutOffDay: number | null; paymentDay: number | null; monthlyRatePpm: number | null; annualRatePpm: number | null; termDays: number | null; maturityDate: LocalDate | null; principal: bigint | null; termMonths: number | null }`, `NO_TERMS`, `type TermsChange = { [K in keyof AccountTerms]?: AccountTerms[K] }`
  - `revisedTerms(type: AccountType, current: AccountTerms, change: TermsChange): Result<AccountTerms>`
  - `nextBillingDate(day: number, today: LocalDate): LocalDate`
  - `interface TermFigures { availableCredit: bigint | null; nextCutOffDate: LocalDate | null; nextPaymentDate: LocalDate | null; effectiveAnnualRatePpm: number | null; equivalentMonthlyRatePpm: number | null; startDate: LocalDate | null }`, `termFigures(terms: AccountTerms, balance: bigint, today: LocalDate): TermFigures`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/accounts/domain/rate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { effectiveAnnualPpm, equivalentMonthlyPpm, percentText, ratePpmOf } from "./rate";

describe("rates (HU-E2-06)", () => {
  it.each([
    ["2.0", 20_000],
    ["28.59", 285_900],
    ["0", 0],
    ["100", 1_000_000],
    ["9.5", 95_000],
    ["1.3888", 13_888],
  ])("reads %j as %i parts per million", (percent, ppm) => {
    expect(ratePpmOf(percent)).toEqual({ ok: true, value: ppm });
  });

  it.each(["-1", "2,5", "100.0001", "1.23456", "", "abc", "1000"])("refuses %j (Review Focus 4)", (percent) => {
    expect(ratePpmOf(percent)).toEqual({ ok: false, error: { code: "InvalidRate", details: { value: percent } } });
  });

  it("writes a rate with exactly four decimals", () => {
    expect([percentText(20_000), percentText(268_242), percentText(0), percentText(1_000_000)]).toEqual([
      "2.0000",
      "26.8242",
      "0.0000",
      "100.0000",
    ]);
  });

  it("converts 2.0 % M.V. into 26.8242 % E.A. and 18 % E.A. into 1.3888 % M.V.", () => {
    expect(percentText(effectiveAnnualPpm(20_000))).toBe("26.8242");
    expect(percentText(equivalentMonthlyPpm(180_000))).toBe("1.3888");
    expect([effectiveAnnualPpm(0), equivalentMonthlyPpm(0)]).toEqual([0, 0]);
  });
});
```

Create `src/modules/accounts/domain/account-terms.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { nextBillingDate, NO_TERMS, revisedTerms, termFigures } from "./account-terms";

const day = (iso: string) => iso as LocalDate;
const visa = { creditLimit: 500_000_000n, cutOffDay: 20, paymentDay: 5, monthlyRatePpm: 20_000 };
const cdt = { annualRatePpm: 95_000, termDays: 180, maturityDate: day("2027-04-14") };

describe("type-specific terms (HU-E2-06)", () => {
  it("keeps a card's, a CDT's and a loan's terms", () => {
    expect(unwrap(revisedTerms("CREDIT_CARD", NO_TERMS, visa))).toEqual({ ...NO_TERMS, ...visa });
    expect(unwrap(revisedTerms("SAVINGS", NO_TERMS, cdt))).toEqual({ ...NO_TERMS, ...cdt });
    const loan = { principal: 2_000_000_000n, annualRatePpm: 180_000, termMonths: 36 };
    expect(unwrap(revisedTerms("LOAN", NO_TERMS, loan))).toEqual({ ...NO_TERMS, ...loan });
    expect(unwrap(revisedTerms("SAVINGS", NO_TERMS, { annualRatePpm: 40_000 })).termDays).toBeNull();
  });

  it("refuses terms of another type, naming the attribute", () => {
    expect(revisedTerms("BANK", NO_TERMS, { creditLimit: 100_000_000n })).toEqual({
      ok: false,
      error: { code: "AccountAttributeNotAllowed", details: { attribute: "creditLimit" } },
    });
    expect(codeOf(revisedTerms("SHARED_FUND", NO_TERMS, { annualRatePpm: 1 }))).toBe("AccountAttributeNotAllowed");
    expect(codeOf(revisedTerms("CREDIT_CARD", NO_TERMS, { termMonths: 12 }))).toBe("AccountAttributeNotAllowed");
  });

  it.each([
    ["CREDIT_CARD", { cutOffDay: 32 }, "InvalidBillingDay"],
    ["CREDIT_CARD", { paymentDay: 0 }, "InvalidBillingDay"],
    ["CREDIT_CARD", { creditLimit: 0n }, "InvalidCreditLimit"],
    ["CREDIT_CARD", { monthlyRatePpm: 1_000_001 }, "InvalidRate"],
    ["SAVINGS", { termDays: 180 }, "InvalidTermDeposit"],
    ["SAVINGS", { termDays: 3_661, maturityDate: day("2036-10-16") }, "InvalidTermDeposit"],
    ["LOAN", { termMonths: 0 }, "InvalidTerm"],
    ["LOAN", { principal: 0n }, "InvalidAmount"],
  ] as const)("refuses %s %o with %s", (type, change, code) => {
    expect(codeOf(revisedTerms(type, NO_TERMS, change))).toBe(code);
  });

  it("clears a term with null and keeps what the change leaves out", () => {
    const card = unwrap(revisedTerms("CREDIT_CARD", NO_TERMS, visa));
    expect(unwrap(revisedTerms("CREDIT_CARD", card, { monthlyRatePpm: null }))).toEqual({
      ...card,
      monthlyRatePpm: null,
    });
    const deposit = unwrap(revisedTerms("SAVINGS", NO_TERMS, cdt));
    expect(codeOf(revisedTerms("SAVINGS", deposit, { maturityDate: null }))).toBe("InvalidTermDeposit");
  });
});

describe("billing dates and figures (HU-E2-06)", () => {
  it("clamps billing days to short months and finds the next one on or after today (Review Focus 4)", () => {
    expect(nextBillingDate(31, day("2026-11-16"))).toBe("2026-11-30");
    expect(nextBillingDate(15, day("2026-11-16"))).toBe("2026-12-15");
    expect(nextBillingDate(16, day("2026-11-16"))).toBe("2026-11-16");
    expect(nextBillingDate(31, day("2027-02-01"))).toBe("2027-02-28");
    expect(nextBillingDate(30, day("2028-02-29"))).toBe("2028-02-29");
    expect(nextBillingDate(5, day("2026-12-20"))).toBe("2027-01-05");
  });

  it("derives available credit, next dates, equivalent rates and a CDT's start date", () => {
    const card = unwrap(revisedTerms("CREDIT_CARD", NO_TERMS, visa));
    expect(termFigures(card, -35_000_000n, day("2026-10-16"))).toEqual({
      availableCredit: 465_000_000n,
      nextCutOffDate: "2026-10-20",
      nextPaymentDate: "2026-11-05",
      effectiveAnnualRatePpm: 268_242,
      equivalentMonthlyRatePpm: null,
      startDate: null,
    });
    const deposit = unwrap(revisedTerms("SAVINGS", NO_TERMS, cdt));
    expect(termFigures(deposit, 1_000_000_000n, day("2026-10-16"))).toMatchObject({ startDate: "2026-10-16" });
    expect(termFigures(NO_TERMS, 0n, day("2026-10-16"))).toEqual({
      availableCredit: null,
      nextCutOffDate: null,
      nextPaymentDate: null,
      effectiveAnnualRatePpm: null,
      equivalentMonthlyRatePpm: null,
      startDate: null,
    });
  });
});
```

Run: `pnpm exec vitest run --project unit src/modules/accounts/domain`
Expected: FAIL — `Cannot find module './rate'` and `'./account-terms'`.

- [ ] **Step 2: Write the implementation**

Create `src/modules/accounts/domain/rate.ts`:

```ts
import { domainError, err, ok, type Result } from "@/shared/kernel";

/** HU-E2-06, ruling P52: rates are integer parts per million of the base (2.0 % = 20,000), from 0 to 100 %. */
export const MAX_RATE_PPM = 1_000_000;

const PERCENT = /^(\d{1,3})(?:\.(\d{1,4}))?$/;

/** "2.0", "28.59" → parts per million; anything else, or above 100 %, is InvalidRate. */
export const ratePpmOf = (percent: string): Result<number> => {
  const match = PERCENT.exec(percent);
  const ppm = match ? Number(match[1]) * 10_000 + Number((match[2] ?? "").padEnd(4, "0")) : Number.NaN;
  return Number.isInteger(ppm) && ppm <= MAX_RATE_PPM
    ? ok(ppm)
    : err(domainError("InvalidRate", { value: percent }));
};

/** 268,242 → "26.8242": a percent with exactly four decimals (spec 7 as amended). */
export const percentText = (ppm: number): string =>
  `${Math.floor(ppm / 10_000)}.${String(ppm % 10_000).padStart(4, "0")}`;

const MILLION = 1_000_000n;
const roundedDiv = (n: bigint, d: bigint): bigint => (n + d / 2n) / d;

/** HU-E2-06: EA = (1 + i_m)^12 − 1, to the nearest part per million. */
export const effectiveAnnualPpm = (monthlyPpm: number): number =>
  Number(roundedDiv((MILLION + BigInt(monthlyPpm)) ** 12n, MILLION ** 11n) - MILLION);

const SCALE = 10n ** 18n;

/** HU-E2-06: i_m = (1 + EA)^(1/12) − 1, to the nearest part per million (a 12th root by bisection, no floats). */
export const equivalentMonthlyPpm = (annualPpm: number): number => {
  const target = ((MILLION + BigInt(annualPpm)) * SCALE ** 12n) / MILLION;
  let low = SCALE;
  let high = 2n * SCALE;
  while (high - low > 1n) {
    const mid = (low + high) / 2n;
    if (mid ** 12n <= target) low = mid;
    else high = mid;
  }
  return Number(roundedDiv((low - SCALE) * MILLION, SCALE));
};
```

Create `src/modules/accounts/domain/account-terms.ts`:

```ts
import {
  addDays,
  addMonths,
  daysInMonth,
  domainError,
  err,
  fromParts,
  ok,
  partsOf,
  type LocalDate,
  type Result,
} from "@/shared/kernel";
import type { AccountType } from "./account-type";
import { effectiveAnnualPpm, equivalentMonthlyPpm, MAX_RATE_PPM } from "./rate";

/** HU-E2-06: the terms of credit cards, savings and term deposits (CDT), and loans; money in minor units. */
export interface AccountTerms {
  readonly creditLimit: bigint | null;
  readonly cutOffDay: number | null;
  readonly paymentDay: number | null;
  /** % M.V., in parts per million. */
  readonly monthlyRatePpm: number | null;
  /** % E.A., in parts per million. */
  readonly annualRatePpm: number | null;
  readonly termDays: number | null;
  readonly maturityDate: LocalDate | null;
  readonly principal: bigint | null;
  readonly termMonths: number | null;
}

export const NO_TERMS: AccountTerms = {
  creditLimit: null,
  cutOffDay: null,
  paymentDay: null,
  monthlyRatePpm: null,
  annualRatePpm: null,
  termDays: null,
  maturityDate: null,
  principal: null,
  termMonths: null,
};

/** Undefined keeps a term, null clears it. */
export type TermsChange = { readonly [K in keyof AccountTerms]?: AccountTerms[K] };

const ALLOWED: Readonly<Partial<Record<AccountType, readonly (keyof AccountTerms)[]>>> = {
  CREDIT_CARD: ["creditLimit", "cutOffDay", "paymentDay", "monthlyRatePpm"],
  SAVINGS: ["annualRatePpm", "termDays", "maturityDate"],
  LOAN: ["principal", "annualRatePpm", "termMonths"],
};

const within = (value: number | null, min: number, max: number): boolean =>
  value === null || (Number.isInteger(value) && value >= min && value <= max);

/** HU-E2-06, rulings P52 and P54: the terms after `change`, checked for the account's type. */
export const revisedTerms = (type: AccountType, current: AccountTerms, change: TermsChange): Result<AccountTerms> => {
  const pick = <K extends keyof AccountTerms>(key: K): AccountTerms[K] =>
    change[key] === undefined ? current[key] : (change[key] as AccountTerms[K]);
  const next: AccountTerms = {
    creditLimit: pick("creditLimit"),
    cutOffDay: pick("cutOffDay"),
    paymentDay: pick("paymentDay"),
    monthlyRatePpm: pick("monthlyRatePpm"),
    annualRatePpm: pick("annualRatePpm"),
    termDays: pick("termDays"),
    maturityDate: pick("maturityDate"),
    principal: pick("principal"),
    termMonths: pick("termMonths"),
  };
  const allowed = ALLOWED[type] ?? [];
  const foreign = (Object.keys(next) as (keyof AccountTerms)[]).find((k) => next[k] !== null && !allowed.includes(k));
  if (foreign !== undefined) return err(domainError("AccountAttributeNotAllowed", { attribute: foreign }));
  if (next.creditLimit !== null && next.creditLimit <= 0n) return err(domainError("InvalidCreditLimit"));
  if (!within(next.cutOffDay, 1, 31) || !within(next.paymentDay, 1, 31)) return err(domainError("InvalidBillingDay"));
  if (!within(next.monthlyRatePpm, 0, MAX_RATE_PPM) || !within(next.annualRatePpm, 0, MAX_RATE_PPM)) {
    return err(domainError("InvalidRate"));
  }
  if ((next.termDays === null) !== (next.maturityDate === null) || !within(next.termDays, 1, 3_660)) {
    return err(domainError("InvalidTermDeposit"));
  }
  if (next.principal !== null && next.principal <= 0n) {
    return err(domainError("InvalidAmount", { amount: next.principal.toString() }));
  }
  if (!within(next.termMonths, 1, 480)) return err(domainError("InvalidTerm"));
  return ok(next);
};

/** HU-E2-06, ruling P55: the next `day` of a month (clamped to its last day, like PeriodPolicy) on or after today. */
export const nextBillingDate = (day: number, today: LocalDate): LocalDate => {
  const { year, month } = partsOf(today);
  const inMonth = (y: number, m: number) => fromParts(y, m, Math.min(day, daysInMonth(y, m)));
  const thisMonth = inMonth(year, month);
  if (thisMonth >= today) return thisMonth;
  const next = addMonths(year, month, 1);
  return inMonth(next.year, next.month);
};

/** HU-E2-06: what the terms say on read, today being the requesting user's local date. */
export interface TermFigures {
  /** limit + balance; a card's balance is negative while money is owed. */
  readonly availableCredit: bigint | null;
  readonly nextCutOffDate: LocalDate | null;
  readonly nextPaymentDate: LocalDate | null;
  /** The card's monthly rate as % E.A. */
  readonly effectiveAnnualRatePpm: number | null;
  /** A savings account's or loan's annual rate as % M.V. */
  readonly equivalentMonthlyRatePpm: number | null;
  /** A term deposit's start: maturityDate − termDays. */
  readonly startDate: LocalDate | null;
}

export const termFigures = (terms: AccountTerms, balance: bigint, today: LocalDate): TermFigures => ({
  availableCredit: terms.creditLimit === null ? null : terms.creditLimit + balance,
  nextCutOffDate: terms.cutOffDay === null ? null : nextBillingDate(terms.cutOffDay, today),
  nextPaymentDate: terms.paymentDay === null ? null : nextBillingDate(terms.paymentDay, today),
  effectiveAnnualRatePpm: terms.monthlyRatePpm === null ? null : effectiveAnnualPpm(terms.monthlyRatePpm),
  equivalentMonthlyRatePpm: terms.annualRatePpm === null ? null : equivalentMonthlyPpm(terms.annualRatePpm),
  startDate:
    terms.maturityDate === null || terms.termDays === null ? null : addDays(terms.maturityDate, -terms.termDays),
});
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/accounts/domain`
Expected: PASS.

- [ ] **Step 4: Run the gates, then commit**

```bash
git add src/modules/accounts/domain/rate.ts src/modules/accounts/domain/rate.test.ts src/modules/accounts/domain/account-terms.ts src/modules/accounts/domain/account-terms.test.ts
git commit -m "feat(accounts): define exact rates, the terms each account type takes and their billing dates (Refs #96)"
```

---

### Task 15a: Accounts — terms on every account, stored and derived on read

Puts `terms` on `Account` (migration `0015_account_terms`) and answers every account with its `figures`, today being the requesting user's local date (HU-E1-14).

Decisions:
- Terms are typed nullable columns, not `jsonb`: reminders (HU-E8-16) and schedules (HU-E8-11 … HU-E8-13) will query cut-off days and maturity dates across accounts, `bigint` money stays exact, and PostgreSQL checks pin which type holds which column (ruling P52).
- Money terms arrive as `Money` and are converted in the space currency (`CurrencyMismatch`, `UnknownCurrency`); the domain sees minor units.
- `AccountsDeps` gains `userTimeZones`; every account answer (create, update, archive, get, list) carries `figures` computed with today in the requester's zone and the balance at `asOf` (ruling P55).

**Files:**
- Modify: `src/modules/accounts/domain/account.ts`, `src/modules/accounts/application/account-view.ts`, `src/modules/accounts/application/deps.ts`, `src/modules/accounts/application/create-account.ts`, `src/modules/accounts/application/update-account.ts`, `src/modules/accounts/application/list-accounts.ts`, `src/modules/accounts/application/archive-account.ts`, `src/modules/accounts/application/index.ts`, `src/modules/accounts/application/manage-accounts.test.ts`, `src/modules/accounts/application/create-account.test.ts`, `src/modules/accounts/application/shared-fund.test.ts`, `src/modules/accounts/application/archived-space.test.ts`, `src/modules/accounts/infrastructure/accounts.schema.ts`, `src/modules/accounts/infrastructure/drizzle-account-repository.ts`, `src/modules/accounts/infrastructure/drizzle-account-repository.int.test.ts`, `src/composition/container.ts`
- Create: `src/modules/accounts/application/account-terms.test.ts`, `drizzle/0015_account_terms.sql` (+ meta, generated)

**Interfaces:**
- Consumes: Task 14's `AccountTerms`, `NO_TERMS`, `TermsChange`, `revisedTerms`, `termFigures`; `UserTimeZones`, `fixedTimeZones` (Task 2); `profiles` in `buildContainer` (Task 3).
- Produces:
  - `Account.terms: AccountTerms`; `NO_ATTRIBUTES` gains `terms: NO_TERMS`; `openAccount` input and `reviseAccount` change gain `terms?: TermsChange`
  - `interface TermsInput` (application): `TermsChange` with `creditLimit?: Money | null` and `principal?: Money | null`
  - `CreateAccountInput.terms?: TermsInput`, `AccountChanges.terms?: TermsInput`
  - `AccountView.figures: TermFigures`; `toView(account, currency, today, net?)`; `withBalances(movements, accounts, currency, asOf, today)`; `todayFor(deps, userId): Promise<LocalDate>`
  - `AccountsDeps.userTimeZones: UserTimeZones`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/accounts/application/account-terms.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock, type LocalDate } from "@/shared/kernel";
import { codeOf, fakeSpaceAccess, fixedTimeZones, memoryTm, membership, money, sequentialIds, unwrap } from "../../../../tests/support/fakes";
import { FixedMovements, InMemoryAccounts } from "../../../../tests/support/in-memory-accounts";
import { createCreateAccount } from "./create-account";
import type { AccountsDeps } from "./deps";
import { createGetAccount } from "./list-accounts";
import { createUpdateAccount } from "./update-account";

const asAna = { spaceId: "space-ana", userId: "u-ana" };
/** Ana's personal space on 2026-10-16 at 12:00 UTC (07:00 in Bogotá); her zone unless `zone` says otherwise. */
const setup = (zone?: string, now = new Date("2026-10-16T12:00:00Z")) => {
  const deps: AccountsDeps = {
    accounts: new InMemoryAccounts(),
    access: fakeSpaceAccess(membership()),
    movements: new FixedMovements(),
    ids: sequentialIds("acc"),
    clock: new FixedClock(now),
    userTimeZones: fixedTimeZones(zone ? { "u-ana": zone } : {}),
    tm: memoryTm,
  };
  return { create: createCreateAccount(deps), update: createUpdateAccount(deps), get: createGetAccount(deps) };
};
const visa = {
  ...asAna,
  name: "Visa",
  type: "CREDIT_CARD" as const,
  openingBalance: money(-35_000_000n),
  terms: { creditLimit: money(500_000_000n), cutOffDay: 20, paymentDay: 5, monthlyRatePpm: 20_000 },
};

describe("type-specific terms (HU-E2-06)", () => {
  it("returns a card's terms with its available credit, next dates and effective annual rate", async () => {
    const card = unwrap(await setup().create(visa));
    expect(card.terms).toMatchObject({ creditLimit: 500_000_000n, cutOffDay: 20, paymentDay: 5, monthlyRatePpm: 20_000 });
    expect(card.figures).toMatchObject({
      availableCredit: 465_000_000n,
      nextCutOffDate: "2026-10-20",
      nextPaymentDate: "2026-11-05",
      effectiveAnnualRatePpm: 268_242,
    });
  });

  it("returns a CDT with its start date, and a loan with its equivalent monthly rate", async () => {
    const w = setup();
    const cdt = unwrap(
      await w.create({
        ...asAna,
        name: "CDT Davivienda",
        type: "SAVINGS",
        openingBalance: money(1_000_000_000n),
        terms: { annualRatePpm: 95_000, termDays: 180, maturityDate: "2027-04-14" as LocalDate },
      }),
    );
    expect(cdt.figures.startDate).toBe("2026-10-16");
    const loan = unwrap(
      await w.create({
        ...asAna,
        name: "Crédito libre inversión",
        type: "LOAN",
        openingBalance: money(-2_000_000_000n),
        terms: { principal: money(2_000_000_000n), annualRatePpm: 180_000, termMonths: 36 },
      }),
    );
    expect(loan.figures.equivalentMonthlyRatePpm).toBe(13_888);
  });

  it("refuses terms of another type, another currency, and a type change before any term", async () => {
    const w = setup();
    const bank = unwrap(await w.create({ ...asAna, name: "Bancolombia", type: "BANK", openingBalance: money(0n) }));
    const change = (changes: Parameters<ReturnType<typeof createUpdateAccount>>[0]["changes"]) =>
      w.update({ ...asAna, accountId: bank.id, changes });
    expect(codeOf(await change({ terms: { creditLimit: money(100_000_000n) } }))).toBe("AccountAttributeNotAllowed");
    expect(codeOf(await change({ type: "CREDIT_CARD", terms: { creditLimit: money(100_000_000n) } }))).toBe(
      "AccountTypeImmutable",
    );
    expect(codeOf(await w.create({ ...visa, name: "USD card", terms: { creditLimit: money(100n, "USD") } }))).toBe(
      "CurrencyMismatch",
    );
  });

  it("dates the next cut-off with today in the requester's zone (Review Focus 4)", async () => {
    // 2026-10-21T02:00Z is still the 20th in Bogotá and already the 21st in Madrid.
    const at = new Date("2026-10-21T02:00:00Z");
    const inBogota = unwrap(await setup(undefined, at).create(visa));
    const inMadrid = unwrap(await setup("Europe/Madrid", at).create(visa));
    expect([inBogota.figures.nextCutOffDate, inMadrid.figures.nextCutOffDate]).toEqual(["2026-10-20", "2026-11-20"]);
  });
});
```

Append to the end of `src/modules/accounts/infrastructure/drizzle-account-repository.int.test.ts`:

```ts

describe("account terms (HU-E2-06)", () => {
  it("round-trips every term exactly and pins which type holds which", async () => {
    const space = await personalSpaceFixture(db, pool);
    const card = account(space, {
      name: "Visa",
      type: "CREDIT_CARD",
      terms: { ...NO_TERMS, creditLimit: 9_223_372_036_854_775_807n, cutOffDay: 31, paymentDay: 15, monthlyRatePpm: 20_000 },
    });
    const cdt = account(space, {
      name: "CDT",
      type: "SAVINGS",
      terms: { ...NO_TERMS, annualRatePpm: 95_000, termDays: 180, maturityDate: "2027-04-14" as LocalDate },
    });
    await repo.add(card);
    await repo.add(cdt);
    expect(await repo.findById(card.id)).toEqual(card);
    expect(await repo.findById(cdt.id)).toEqual(cdt);
    await expect(pool.query(`UPDATE accounts SET credit_limit = 1 WHERE id = $1`, [cdt.id])).rejects.toMatchObject({
      constraint: "accounts_card_terms",
    });
    await expect(pool.query(`UPDATE accounts SET maturity_date = NULL WHERE id = $1`, [cdt.id])).rejects.toMatchObject({
      constraint: "accounts_term_deposit",
    });
  });
});
```

(add `NO_TERMS` to the file's domain import, from `../domain/account-terms`, and `type LocalDate` from `@/shared/kernel`.)

Run: `pnpm exec vitest run --project unit src/modules/accounts/application/account-terms.test.ts`
Expected: FAIL — `userTimeZones` is not an `AccountsDeps` property and `terms` is not an input.

- [ ] **Step 2: Put the terms on the account**

In `src/modules/accounts/domain/account.ts`:
1. Insert after the line `import type { AccountType } from "./account-type";`:

```ts
import { NO_TERMS, revisedTerms, type AccountTerms, type TermsChange } from "./account-terms";
```

2. Replace the lines from `export const NO_ATTRIBUTES: AccountAttributes = {` to its closing `};` (Prettier has split Task 12's one-liner) with:

```ts
export const NO_ATTRIBUTES: AccountAttributes & { readonly terms: AccountTerms } = {
  institution: null,
  lastFour: null,
  color: null,
  icon: null,
  terms: NO_TERMS,
};
```

3. Insert after the line `  readonly openingBalance: bigint;` (inside `interface Account`):

```ts
  /** HU-E2-06: the type's terms; all null for a type without any. */
  readonly terms: AccountTerms;
```

4. Insert after the line `  attributes?: AttributeChanges;` (inside `openAccount`'s input): `  terms?: TermsChange;`.
5. Replace the line `  if (nameTaken(input.siblings, name.value)) return err(domainError("AccountNameTaken"));` with:

```ts
  if (nameTaken(input.siblings, name.value)) return err(domainError("AccountNameTaken"));
  const terms = revisedTerms(input.type, NO_TERMS, input.terms ?? {});
  if (!terms.ok) return terms;
```

   and insert after the line `    ...withChanges(NO_ATTRIBUTES, input.attributes ?? {}),`: `    terms: terms.value,`.
6. Insert after the line `    readonly attributes?: AttributeChanges;` (inside `reviseAccount`'s change): `    readonly terms?: TermsChange;`.
7. Replace the line `  if (nameTaken(siblings, name.value, account.id)) return err(domainError("AccountNameTaken"));` with:

```ts
  if (nameTaken(siblings, name.value, account.id)) return err(domainError("AccountNameTaken"));
  const terms = revisedTerms(account.type, account.terms, change.terms ?? {});
  if (!terms.ok) return terms;
```

   and insert after the line `    ...withChanges(account, change.attributes ?? {}),`: `    terms: terms.value,`.

(`account-terms.ts` imports only `account-type.ts`, so there is no cycle.)

- [ ] **Step 3: Today, figures and money terms in the use cases**

Replace the contents of `src/modules/accounts/application/account-view.ts`:

```ts
import { todayIn, type LocalDate } from "@/shared/kernel";
import type { Account } from "../domain/account";
import { termFigures, type TermFigures } from "../domain/account-terms";
import type { AccountMovements } from "./account-movements";
import type { AccountsDeps } from "./deps";

/** An account with its balance computed on read (D7): opening balance plus net movements, and what its terms say. */
export interface AccountView extends Account {
  readonly currency: string;
  readonly balance: bigint;
  /** HU-E2-06: derived with today in the requester's zone. */
  readonly figures: TermFigures;
}

/** HU-E1-14, ruling P55: the requester's local date. */
export const todayFor = async (deps: Pick<AccountsDeps, "clock" | "userTimeZones">, userId: string) =>
  todayIn(deps.clock, await deps.userTimeZones.timeZoneOf(userId));

export const toView = (account: Account, currency: string, today: LocalDate, net = 0n): AccountView => {
  const balance = account.openingBalance + net;
  return { ...account, currency, balance, figures: termFigures(account.terms, balance, today) };
};

export const withBalances = async (
  movements: AccountMovements,
  accounts: readonly Account[],
  currency: string,
  asOf: LocalDate | null,
  today: LocalDate,
): Promise<AccountView[]> => {
  if (accounts.length === 0) return [];
  const net = await movements.netMovements(
    accounts.map((a) => a.id),
    asOf,
  );
  return accounts.map((a) => toView(a, currency, today, net.get(a.id) ?? 0n));
};
```

In `src/modules/accounts/application/deps.ts`, replace the line `import type { Clock, IdGenerator, TransactionManager } from "@/shared/kernel";` with `import type { Clock, IdGenerator, TransactionManager, UserTimeZones } from "@/shared/kernel";` and insert after the line `  readonly clock: Clock;`:

```ts
  /** HU-E1-14: "today" for the next billing dates is the requester's local date (HU-E2-06). */
  readonly userTimeZones: UserTimeZones;
```

Create the money-terms helper at the end of `src/modules/accounts/application/currency.ts` (append to the end of the file):

```ts

/** HU-E2-06: terms as the use cases take them; money terms are Money in the space currency. */
export type TermsInput = Omit<TermsChange, "creditLimit" | "principal"> & {
  readonly creditLimit?: Money | null;
  readonly principal?: Money | null;
};

/** The terms in minor units of `currency` (CurrencyMismatch, UnknownCurrency). */
export const termsIn = (currency: string, input: TermsInput | undefined): Result<TermsChange> => {
  if (input === undefined) return ok({});
  const minor = (money: Money | null | undefined): Result<bigint | null | undefined> =>
    money === undefined || money === null ? ok(money) : minorIn(currency, money);
  const creditLimit = minor(input.creditLimit);
  if (!creditLimit.ok) return creditLimit;
  const principal = minor(input.principal);
  if (!principal.ok) return principal;
  return ok({ ...input, creditLimit: creditLimit.value, principal: principal.value });
};
```

and add to its imports `import type { TermsChange } from "../domain/account-terms";` plus `ok`, `type Money`, `type Result` from `@/shared/kernel` if the file does not import them yet (it already exports `minorIn(currency, money): Result<bigint>`).

In `src/modules/accounts/application/create-account.ts`:
1. Replace the line `import { toView, type AccountView } from "./account-view";` with `import { todayFor, toView, type AccountView } from "./account-view";` and the line `import { minorIn } from "./currency";` with `import { minorIn, termsIn, type TermsInput } from "./currency";`.
2. Insert after the line `  readonly attributes?: AttributeChanges;`: `  readonly terms?: TermsInput;`.
3. Replace the line `      if (!openingBalance.ok) return openingBalance;` with:

```ts
      if (!openingBalance.ok) return openingBalance;
      const terms = termsIn(space.currency, input.terms);
      if (!terms.ok) return terms;
```

4. Insert after the line `        attributes: input.attributes,`: `        terms: terms.value,`.
5. Replace the line `      return ok(toView(account.value, space.currency));` with `      return ok(toView(account.value, space.currency, await todayFor(deps, input.userId)));`.

In `src/modules/accounts/application/update-account.ts`:
1. Replace the line `import { withBalances, type AccountView } from "./account-view";` with `import { todayFor, withBalances, type AccountView } from "./account-view";` and the line `import { minorIn } from "./currency";` with `import { minorIn, termsIn, type TermsInput } from "./currency";`.
2. Insert after the line `  readonly attributes?: AttributeChanges;` (inside `AccountChanges`): `  readonly terms?: TermsInput;`.
3. Replace the line `      if (!openingBalance.ok) return openingBalance;` with:

```ts
      if (!openingBalance.ok) return openingBalance;
      const terms = termsIn(space.currency, changes.terms);
      if (!terms.ok) return terms;
```

4. Insert after the line `          attributes: changes.attributes,` (inside the `reviseAccount` call; Prettier has split Task 12's one-liner) the line `          terms: terms.value,`.

5. Replace the line `      const [view] = await withBalances(deps.movements, [revised.value], space.currency, null);` with:

```ts
      const today = await todayFor(deps, input.userId);
      const [view] = await withBalances(deps.movements, [revised.value], space.currency, null, today);
```

In `src/modules/accounts/application/list-accounts.ts`, replace the line `import { withBalances, type AccountView } from "./account-view";` with `import { todayFor, withBalances, type AccountView } from "./account-view";`; replace the line `    return ok(await withBalances(deps.movements, accounts, membership.value.currency, input.asOf ?? null));` with:

```ts
    const today = await todayFor(deps, input.userId);
    return ok(await withBalances(deps.movements, accounts, membership.value.currency, input.asOf ?? null, today));
```

and replace the line `      input.asOf ?? null,` (inside `createGetAccount`) with:

```ts
      input.asOf ?? null,
      await todayFor(deps, input.userId),
```

In `src/modules/accounts/application/archive-account.ts`, add `today` the same way to its `withBalances(…)` call (its last argument becomes `await todayFor(deps, input.userId)`), importing `todayFor` from `./account-view`.

In `src/modules/accounts/application/index.ts`: append to the end of the file:

```ts
export type { AccountTerms, TermFigures, TermsChange } from "../domain/account-terms";
export { NO_TERMS } from "../domain/account-terms";
export { percentText, ratePpmOf } from "../domain/rate";
export type { TermsInput } from "./currency";
```

In `src/composition/container.ts`, insert after the line `    movements: ledgerQueries,` (inside `accountsDeps`):

```ts
    // HU-E1-14, HU-E2-06: the requester's today for next billing dates; accounts never import identity.
    userTimeZones: profiles,
```

Literal sites: every `AccountsDeps` literal (`rg -n "const deps: AccountsDeps" src tests --type ts`: today `manage-accounts.test.ts`, `create-account.test.ts`, `shared-fund.test.ts`, `archived-space.test.ts`) gains `userTimeZones: fixedTimeZones(),` after its `clock:` line, with `fixedTimeZones` imported from `tests/support/fakes`. Every direct call of `toView(account, currency)` or `withBalances(…, asOf)` the compiler then reports gains the `today` argument.

- [ ] **Step 4: Add the columns and generate the migration**

In `src/modules/accounts/infrastructure/accounts.schema.ts`:
1. Replace the line `import { bigint, check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";` with:

```ts
import { bigint, check, date, integer, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
```

2. Insert after the line `    icon: text("icon"),`:

```ts
    // HU-E2-06, ruling P52: type-specific terms as typed columns; money in minor units, rates in parts per million.
    creditLimit: bigint("credit_limit", { mode: "bigint" }),
    cutOffDay: smallint("cut_off_day"),
    paymentDay: smallint("payment_day"),
    monthlyRatePpm: integer("monthly_rate_ppm"),
    annualRatePpm: integer("annual_rate_ppm"),
    termDays: smallint("term_days"),
    maturityDate: date("maturity_date", { mode: "string" }),
    principal: bigint("principal", { mode: "bigint" }),
    termMonths: smallint("term_months"),
```

3. Insert after the line `    check("accounts_last_four", sql\`${t.lastFour} ~ '^[0-9]{4}$'\`),`:

```ts
    // HU-E2-06: which type holds which term; the domain answers AccountAttributeNotAllowed first.
    check(
      "accounts_card_terms",
      sql`${t.type} = 'CREDIT_CARD' OR (${t.creditLimit} IS NULL AND ${t.cutOffDay} IS NULL AND ${t.paymentDay} IS NULL AND ${t.monthlyRatePpm} IS NULL)`,
    ),
    check("accounts_annual_rate", sql`${t.annualRatePpm} IS NULL OR ${t.type} IN ('SAVINGS', 'LOAN')`),
    check("accounts_loan_terms", sql`${t.type} = 'LOAN' OR (${t.principal} IS NULL AND ${t.termMonths} IS NULL)`),
    check(
      "accounts_term_deposit",
      sql`(${t.termDays} IS NULL) = (${t.maturityDate} IS NULL) AND (${t.termDays} IS NULL OR ${t.type} = 'SAVINGS')`,
    ),
```

In `src/modules/accounts/infrastructure/drizzle-account-repository.ts`:
1. Replace the lines from `const toAccount = (row: typeof accounts.$inferSelect): Account => ({` to its closing `});` with:

```ts
const toAccount = (row: typeof accounts.$inferSelect): Account => {
  const { creditLimit, cutOffDay, paymentDay, monthlyRatePpm, annualRatePpm, termDays, maturityDate, principal, termMonths, ...rest } = row;
  return {
    ...rest,
    id: row.id as AccountId,
    icon: row.icon as AccountIcon | null,
    terms: {
      creditLimit,
      cutOffDay,
      paymentDay,
      monthlyRatePpm,
      annualRatePpm,
      termDays,
      maturityDate: maturityDate as LocalDate | null,
      principal,
      termMonths,
    },
  };
};
```

   (import `type LocalDate` from `@/shared/kernel`, beside `isUuid`).
2. Insert after the line `      icon: account.icon,` inside `add` and again inside `save`'s `.set({ … })` the line `      ...account.terms,` (in `save`, at the indentation of the other `.set` fields).

Run: `pnpm db:generate --name account_terms`
Expected: `drizzle/0015_account_terms.sql` adds the nine nullable columns and the four checks.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/accounts` and `pnpm exec vitest run --project integration src/modules/accounts`
Expected: PASS.

- [ ] **Step 6: Run the gates, then commit**

```bash
git add src/modules/accounts src/composition/container.ts drizzle/0015_account_terms.sql drizzle/meta
git commit -m "feat(accounts): store card, savings and loan terms and derive their figures on read (Refs #96, Refs #94)"
```

---

### Task 15b-1: HTTP — account terms and derived figures in every account answer

Exposes Task 15a: `terms` in both bodies and in every account answer, with `derived`.

Task 15b lands as two commits, each its own RDD pass and each green on its own (ruling P87): Task 15b-1 the answers (`Account.terms`, `Account.derived`, `accountDto`; measured ~245, snapshot +188/−5), Task 15b-2 the bodies (`TermsBodySchema`, `termsFromBody`, the routes, the acceptance test and the backlog note; measured ~345, snapshot +218). The Decisions and the Interfaces below cover both.

Decisions:
- Rates travel as percent strings (`"2.0"`, `"28.59"`, `RateSchema` is any string of 1–16 characters) and are parsed by `ratePpmOf`, so `"-1"` answers `422 InvalidRate`, not `ValidationFailed` (HU-E2-06 outline). Days and terms are integers whose ranges are the domain's (`InvalidBillingDay`, `InvalidTerm`, `InvalidTermDeposit`). Answers return every rate with four decimals, `null` when unset.
- The answer's `terms` lists the nine stored terms; `derived` lists `availableCredit`, `nextCutOffDate`, `nextPaymentDate`, `effectiveAnnualRate`, `equivalentMonthlyRate` and `startDate` (`null` when they do not apply).

**Files:**
- Modify: `src/modules/accounts/contracts/accounts.contract.ts`, `openapi/openapi.snapshot.json`

**Interfaces (Tasks 15b-1 and 15b-2):**
- Consumes: `TermsInput`, `ratePpmOf`, `percentText`, `AccountView.terms`, `AccountView.figures` (Tasks 14, 15a).
- Produces: `TermsBodySchema`; `termsFromBody(body): Result<TermsInput | undefined>`; `AccountSchema.terms`, `AccountSchema.derived`.

- [ ] **Step 1: Extend the answer**

In `src/modules/accounts/contracts/accounts.contract.ts`:
1. Add `percentText` to the import from `../application`.
2. Insert after the line `  icon: Icon,` (inside `AccountSchema`):

```ts
  /** HU-E2-06: the type's stored terms; rates as percent strings with four decimals. */
  terms: z.object({
    creditLimit: MoneySchema.nullable(),
    cutOffDay: z.number().int().nullable(),
    paymentDay: z.number().int().nullable(),
    monthlyRate: z.string().nullable(),
    annualRate: z.string().nullable(),
    termDays: z.number().int().nullable(),
    maturityDate: z.iso.date().nullable(),
    principal: MoneySchema.nullable(),
    termMonths: z.number().int().nullable(),
  }),
  /** HU-E2-06: derived on read, today being the requester's local date. */
  derived: z.object({
    availableCredit: MoneySchema.nullable(),
    nextCutOffDate: z.iso.date().nullable(),
    nextPaymentDate: z.iso.date().nullable(),
    effectiveAnnualRate: z.string().nullable(),
    equivalentMonthlyRate: z.string().nullable(),
    startDate: z.iso.date().nullable(),
  }),
```

3. Insert after the line `  icon: iconOf(view),` (inside `accountDto`):

```ts
  terms: {
    creditLimit: amountOf(view.terms.creditLimit, view.currency),
    cutOffDay: view.terms.cutOffDay,
    paymentDay: view.terms.paymentDay,
    monthlyRate: rateOf(view.terms.monthlyRatePpm),
    annualRate: rateOf(view.terms.annualRatePpm),
    termDays: view.terms.termDays,
    maturityDate: view.terms.maturityDate,
    principal: amountOf(view.terms.principal, view.currency),
    termMonths: view.terms.termMonths,
  },
  derived: {
    availableCredit: amountOf(view.figures.availableCredit, view.currency),
    nextCutOffDate: view.figures.nextCutOffDate,
    nextPaymentDate: view.figures.nextPaymentDate,
    effectiveAnnualRate: rateOf(view.figures.effectiveAnnualRatePpm),
    equivalentMonthlyRate: rateOf(view.figures.equivalentMonthlyRatePpm),
    startDate: view.figures.startDate,
  },
```

   and insert before the line `export const accountDto = (view: AccountView): z.infer<typeof AccountSchema> => ({`:

```ts
const amountOf = (minor: bigint | null, currency: string) => (minor === null ? null : { amount: minor.toString(), currency });
const rateOf = (ppm: number | null) => (ppm === null ? null : percentText(ppm));

```

- [ ] **Step 2: See the contract test fail, then regenerate the snapshot**

Run: `pnpm exec vitest run --project unit src/composition/openapi.test.ts`
Expected: FAIL — "matches the committed snapshot operation by operation": `Account` gains `terms` and `derived`. This half adds no request field, so the snapshot test is its failing test; the scenarios that send terms are Task 15b-2's.

Regenerate the snapshot (`UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts`). Expected diff (measured +188/−5): `Account.terms` and `Account.derived`; no body changes yet, no new component.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/composition/openapi.test.ts src/modules/accounts` and `pnpm exec vitest run --project acceptance tests/acceptance/account-attributes.test.ts tests/acceptance/accounts.test.ts`
Expected: PASS.

- [ ] **Step 4: Run the gates, then commit**

This half is green on its own: its snapshot holds only the answer changes, and every gate passes before Task 15b-2 starts.

```bash
git add src/modules/accounts/contracts/accounts.contract.ts openapi/openapi.snapshot.json
git commit -m "feat(accounts): return each account's terms and derived figures over HTTP (Refs #96)"
```

---

### Task 15b-2: HTTP — account terms in the create and update bodies

Continues Task 15b-1 (Decisions and Interfaces there): `terms` in both bodies, parsed by `termsFromBody`, with their error codes in the descriptions and the backlog.

**Files:**
- Modify: `src/modules/accounts/contracts/accounts.contract.ts`, `src/app/api/v1/spaces/[spaceId]/accounts/route.ts`, `src/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route.ts`, `tests/acceptance/account-attributes.test.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E2-accounts.md`

- [ ] **Step 1: Write the failing acceptance test**

Append to the end of `tests/acceptance/account-attributes.test.ts`:

```ts

describe("type-specific account attributes (HU-E2-06)", () => {
  it("creates a card with its terms, available credit and effective annual rate", async () => {
    const ana = await registerUser("Ana");
    const visa = await created(ana, {
      name: "Visa",
      type: "CREDIT_CARD",
      openingBalance: cop(-350_000),
      terms: { creditLimit: cop(5_000_000), cutOffDay: 20, paymentDay: 5, monthlyRate: "2.0" },
    });
    expect(visa.terms).toMatchObject({ creditLimit: cop(5_000_000), cutOffDay: 20, paymentDay: 5, monthlyRate: "2.0000" });
    expect(visa.derived).toMatchObject({ availableCredit: cop(4_650_000), effectiveAnnualRate: "26.8242" });
  });

  it("creates a CDT with its start date and a loan with its equivalent monthly rate", async () => {
    const ana = await registerUser("Ana");
    const cdt = await created(ana, {
      name: "CDT Davivienda",
      type: "SAVINGS",
      openingBalance: cop(10_000_000),
      terms: { annualRate: "9.5", termDays: 180, maturityDate: "2027-04-14" },
    });
    expect(cdt.terms).toMatchObject({ annualRate: "9.5000", termDays: 180, maturityDate: "2027-04-14" });
    expect(cdt.derived).toMatchObject({ startDate: "2026-10-16" });
    const loan = await created(ana, {
      name: "Crédito libre inversión",
      type: "LOAN",
      openingBalance: cop(-20_000_000),
      terms: { principal: cop(20_000_000), annualRate: "18", termMonths: 36 },
    });
    expect(loan.derived).toMatchObject({ equivalentMonthlyRate: "1.3888" });
  });

  it.each([
    ["CREDIT_CARD", { cutOffDay: 32 }, "InvalidBillingDay"],
    ["CREDIT_CARD", { creditLimit: cop(0) }, "InvalidCreditLimit"],
    ["CREDIT_CARD", { monthlyRate: "-1" }, "InvalidRate"],
    ["SAVINGS", { termDays: 180 }, "InvalidTermDeposit"],
    ["LOAN", { termMonths: 0 }, "InvalidTerm"],
  ])("refuses a %s with %o: %s", async (type, terms, code) => {
    const ana = await registerUser("Ana");
    expect(await problemOf(await create(ana, { name: "X", type, openingBalance: cop(0), terms }))).toEqual([422, code]);
  });

  it("refuses a credit limit on a BANK account", async () => {
    const ana = await registerUser("Ana");
    const bank = await created(ana, { name: "Bancolombia", type: "BANK", openingBalance: cop(0) });
    expect(await problemOf(await patch(ana, bank.id, { terms: { creditLimit: cop(1_000_000) } }))).toEqual([
      409,
      "AccountAttributeNotAllowed",
    ]);
  });
});
```

(The test container runs on the system clock, so the CDT's start date is fixed by its own terms; `cop(-350_000)` and friends come from `tests/support/ledger.ts`.)

Run: `pnpm exec vitest run --project acceptance tests/acceptance/account-attributes.test.ts`
Expected: FAIL — the bodies strip `terms`, so the card answers with every term null.

- [ ] **Step 2: Extend the bodies and the routes**

In `src/modules/accounts/contracts/accounts.contract.ts`:
1. Add `ratePpmOf` and `type TermsInput` to the import from `../application`, and `type LocalDate`, `type Result`, `ok`, `localDate` from `@/shared/kernel`, and `moneyFromDto` from `@/shared/http/contracts`.
2. Insert after the line `const Icon = z.enum(ACCOUNT_ICONS);`:

```ts
// HU-E2-06: ranges and rates are the domain's (InvalidBillingDay, InvalidRate, …); the contract only bounds sizes.
const Rate = z.string().min(1).max(16);
const Count = z.number().int().min(-100_000).max(100_000);
export const TermsBodySchema = z.object({
  creditLimit: MoneySchema.nullable().optional(),
  cutOffDay: Count.nullable().optional(),
  paymentDay: Count.nullable().optional(),
  monthlyRate: Rate.nullable().optional(),
  annualRate: Rate.nullable().optional(),
  termDays: Count.nullable().optional(),
  maturityDate: z.iso.date().nullable().optional(),
  principal: MoneySchema.nullable().optional(),
  termMonths: Count.nullable().optional(),
});
type TermsBody = z.infer<typeof TermsBodySchema>;

/** HU-E2-06: the body's terms as the use cases take them: rates in ppm (InvalidRate), money as Money. */
export const termsFromBody = (terms: TermsBody | undefined): Result<TermsInput | undefined> => {
  if (terms === undefined) return ok(undefined);
  const rate = (raw: string | null | undefined): Result<number | null | undefined> =>
    raw === undefined || raw === null ? ok(raw) : ratePpmOf(raw);
  const money = (dto: TermsBody["creditLimit"]) => (dto === undefined || dto === null ? ok(dto) : moneyFromDto(dto));
  const monthlyRatePpm = rate(terms.monthlyRate);
  if (!monthlyRatePpm.ok) return monthlyRatePpm;
  const annualRatePpm = rate(terms.annualRate);
  if (!annualRatePpm.ok) return annualRatePpm;
  const creditLimit = money(terms.creditLimit);
  if (!creditLimit.ok) return creditLimit;
  const principal = money(terms.principal);
  if (!principal.ok) return principal;
  const maturity = terms.maturityDate === undefined || terms.maturityDate === null ? ok(terms.maturityDate) : localDate(terms.maturityDate);
  if (!maturity.ok) return maturity;
  return ok({
    creditLimit: creditLimit.value,
    cutOffDay: terms.cutOffDay,
    paymentDay: terms.paymentDay,
    monthlyRatePpm: monthlyRatePpm.value,
    annualRatePpm: annualRatePpm.value,
    termDays: terms.termDays,
    maturityDate: maturity.value as LocalDate | null | undefined,
    principal: principal.value,
    termMonths: terms.termMonths,
  });
};
```

3. In both `CreateAccountBodySchema` and `UpdateAccountBodySchema`, insert after their `icon:` line: `  terms: TermsBodySchema.optional(),`.
4. In `accountsPaths`, append `, AccountAttributeNotAllowed` to the `"409"` descriptions of `createAccount` and `updateAccount`, and `, InvalidCreditLimit, InvalidBillingDay, InvalidRate, InvalidTermDeposit, InvalidTerm, InvalidAmount, InvalidDate` to their `"422"` descriptions.

In `src/app/api/v1/spaces/[spaceId]/accounts/route.ts`, replace the line `    if (!openingBalance.ok) return openingBalance;` (inside `POST`) with:

```ts
    if (!openingBalance.ok) return openingBalance;
    const terms = termsFromBody(body.terms);
    if (!terms.ok) return terms;
```

and insert after the line `      attributes: attributesFromBody(body),` the line `      terms: terms.value,`; add `termsFromBody` to its contract import. In `src/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route.ts`, make the same two changes inside `PATCH` (the terms go in `changes`, after `        attributes: attributesFromBody(body),`).

In `docs/backlog/E2-accounts.md`, insert before the line that starts with `- **Spec impact:** 5.2 **Account** (attributes per type, derived fields, clamping of billing days)`:

```markdown
- Errors (catalogue, spec 8): `AccountAttributeNotAllowed` (409, `attribute` stays in the log); `InvalidCreditLimit`, `InvalidBillingDay`, `InvalidRate`, `InvalidTermDeposit`, `InvalidTerm` (422); a loan principal that is not positive is `InvalidAmount` (422); a money term in another currency is `CurrencyMismatch` (422) (M3-D Task 15b).
```

Regenerate the snapshot. Expected diff (measured +218): `terms` in both bodies and the `409` and `422` descriptions of `createAccount` and `updateAccount`; no new component.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/account-attributes.test.ts tests/acceptance/accounts.test.ts`
Expected: PASS.

- [ ] **Step 4: Run the gates, then commit**

This half is green on its own: its snapshot adds only the body changes to Task 15b-1's.

```bash
git add src/modules/accounts/contracts/accounts.contract.ts "src/app/api/v1/spaces/[spaceId]/accounts" tests/acceptance/account-attributes.test.ts openapi/openapi.snapshot.json docs/backlog/E2-accounts.md
git commit -m "feat(accounts): take card, savings and loan terms in the account bodies over HTTP (Refs #96)"
```

---

### Task 16: Accounts — available money and net worth

Implements HU-E2-07: two switches on every account (migration `0016_account_switches`) and the space's totals on `GET …/accounts`.

Decisions:
- `includeInAvailable` and `includeInNetWorth` are nullable booleans where null is the type's default (CASH, BANK, WALLET, SHARED_FUND count in both; every other type in net worth only), so the migration adds two columns and back-fills nothing, and `PATCH` with `null` returns a switch to its default; the answer always shows the effective value (ruling P51).
- `available = Σ balance` over the space's active accounts with `includeInAvailable`, `netWorth = Σ balance` over those with `includeInNetWorth`; balances are the computed, signed ones at `asOf` (liabilities negative, ruling P53). `ListAccounts` returns them as `totals` beside `items`; archived accounts never count, even with `archived=true`. A space totals only its own accounts (a personal space its owner's, a shared space its funds, D5); every reader of the space sees them (`space.read`), archived spaces included (D7, ruling P51).
- A card payment is an ordinary `TRANSFER` from the paying account to the card: no category, never spending (spec 5.2 as amended, D21); nothing in the ledger changes.

**Files:**
- Create: `src/modules/accounts/domain/account-totals.ts`, `src/modules/accounts/domain/account-totals.test.ts`, `tests/acceptance/account-totals.test.ts`, `drizzle/0016_account_switches.sql` (+ meta, generated)
- Modify: `src/modules/accounts/domain/account.ts`, `src/modules/accounts/application/list-accounts.ts`, `src/modules/accounts/application/index.ts`, `src/modules/accounts/application/manage-accounts.test.ts`, `src/modules/accounts/application/archived-space.test.ts`, `src/modules/accounts/infrastructure/accounts.schema.ts`, `src/modules/accounts/infrastructure/drizzle-account-repository.ts`, `src/modules/accounts/contracts/accounts.contract.ts`, `src/app/api/v1/spaces/[spaceId]/accounts/route.ts`, `src/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E2-accounts.md`

**Interfaces:**
- Consumes: `AccountView.balance` (Task 15a); `attributesFromBody` (Task 13).
- Produces:
  - `AccountAttributes.includeInAvailable: boolean | null`, `AccountAttributes.includeInNetWorth: boolean | null`
  - `switchesOf(account: Pick<Account, "type" | "includeInAvailable" | "includeInNetWorth">): { includeInAvailable: boolean; includeInNetWorth: boolean }`
  - `interface AccountTotals { available: bigint; netWorth: bigint }`, `totalsOf(accounts: readonly (Account & { balance: bigint })[]): AccountTotals`
  - `ListAccounts` answers `Result<AccountList>`, `interface AccountList { items: readonly AccountView[]; currency: string; totals: AccountTotals }`; `accountListDto(list: AccountList)`
  - `ListAccountsResponseSchema.totals: { available: Money; netWorth: Money }`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/accounts/domain/account-totals.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NO_ATTRIBUTES, switchesOf, type Account, type AccountId, type AccountType } from "./account";
import { totalsOf } from "./account-totals";

const at = new Date("2026-10-16T12:00:00Z");
const held = (name: string, type: AccountType, pesos: number, overrides: Partial<Account> = {}) => ({
  ...NO_ATTRIBUTES,
  id: `acc-${name}` as AccountId,
  spaceId: "space-ana",
  name,
  type,
  ownerUserId: "u-ana",
  openingBalance: 0n,
  archivedAt: null,
  createdAt: at,
  ...overrides,
  balance: BigInt(pesos) * 100n,
});
const ana = [
  held("Bancolombia", "BANK", 2_000_000),
  held("Nequi", "WALLET", 300_000),
  held("Visa", "CREDIT_CARD", -350_000),
  held("CDT", "SAVINGS", 10_000_000),
  held("Loan", "LOAN", -8_000_000),
];

describe("available money and net worth (HU-E2-07)", () => {
  it("defaults by type: CASH, BANK, WALLET and SHARED_FUND count in both, the rest in net worth only", () => {
    const types = ["CASH", "BANK", "WALLET", "SHARED_FUND", "CREDIT_CARD", "SAVINGS", "INVESTMENT", "LOAN", "OTHER"] as const;
    expect(types.map((type) => switchesOf({ type, includeInAvailable: null, includeInNetWorth: null }).includeInAvailable)).toEqual([
      true, true, true, true, false, false, false, false, false,
    ]);
    expect(types.every((type) => switchesOf({ type, includeInAvailable: null, includeInNetWorth: null }).includeInNetWorth)).toBe(true);
  });

  it("totals 2,300,000 available and 3,950,000 net worth with the default switches (@critical)", () => {
    expect(totalsOf(ana)).toEqual({ available: 230_000_000n, netWorth: 395_000_000n });
  });

  it("follows the switches and leaves archived accounts out", () => {
    const switched = ana.map((a) =>
      a.name === "CDT" ? { ...a, includeInAvailable: true } : a.name === "Nequi" ? { ...a, includeInNetWorth: false } : a,
    );
    expect(totalsOf(switched)).toEqual({ available: 1_230_000_000n, netWorth: 365_000_000n });
    const archived = ana.map((a) => (a.name === "Nequi" ? { ...a, archivedAt: at } : a));
    expect(totalsOf(archived)).toEqual({ available: 200_000_000n, netWorth: 365_000_000n });
  });
});
```

In `src/modules/accounts/application/manage-accounts.test.ts`, replace each `unwrap(await list({ ...asAna, includeArchived: false }))` with `unwrap(await list({ ...asAna, includeArchived: false })).items` and `unwrap(await list({ ...asAna, includeArchived: true }))` with `unwrap(await list({ ...asAna, includeArchived: true })).items`; in `src/modules/accounts/application/archived-space.test.ts`, replace `unwrap(await w.list({ ...ana, includeArchived: false })).map((a) => a.id)` with `unwrap(await w.list({ ...ana, includeArchived: false })).items.map((a) => a.id)`.

Create `tests/acceptance/account-totals.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listAccounts } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { PATCH as updateAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type TestUser } from "../support/app";
import { categoryWithKey, cop, inSpace, newAccount, post, type MoneyDto } from "../support/ledger";
import { actingIn, joinAs, newSharedSpace } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const totalsOf = async (user: TestUser, query = "") => {
  const response = await call(listAccounts, "GET", inSpace(user, `accounts${query}`), {
    user,
    params: { spaceId: user.spaceId },
  });
  expect(response.status).toBe(200);
  const { totals } = (await response.json()) as { totals: { available: MoneyDto; netWorth: MoneyDto } };
  return [totals.available, totals.netWorth];
};
const patch = (user: TestUser, accountId: string, body: unknown) =>
  call(updateAccount, "PATCH", inSpace(user, `accounts/${accountId}`), { user, params: { spaceId: user.spaceId, accountId }, body });

/** HU-E2-07 Background: Ana's five active accounts with their default switches. */
const background = async () => {
  const ana = await registerUser("Ana");
  return {
    ana,
    bancolombia: await newAccount(ana, "Bancolombia", 2_000_000, "BANK"),
    nequi: await newAccount(ana, "Nequi", 300_000, "WALLET"),
    visa: await newAccount(ana, "Visa", -350_000, "CREDIT_CARD"),
    cdt: await newAccount(ana, "CDT Davivienda", 10_000_000, "SAVINGS"),
    loan: await newAccount(ana, "Crédito libre inversión", -8_000_000, "LOAN"),
  };
};

describe("available money and net worth (HU-E2-07)", () => {
  it("totals the accounts with the default switches (@critical)", async () => {
    const w = await background();
    expect(await totalsOf(w.ana)).toEqual([cop(2_300_000), cop(3_950_000)]);
  });

  it("follows the switches, and null returns a switch to its default", async () => {
    const w = await background();
    expect((await patch(w.ana, w.cdt, { includeInAvailable: true })).status).toBe(200);
    const nequi = await patch(w.ana, w.nequi, { includeInNetWorth: false });
    expect(await nequi.json()).toMatchObject({ includeInAvailable: true, includeInNetWorth: false });
    expect(await totalsOf(w.ana)).toEqual([cop(12_300_000), cop(3_650_000)]);
    expect((await patch(w.ana, w.cdt, { includeInAvailable: null })).status).toBe(200);
    expect(await totalsOf(w.ana)).toEqual([cop(2_300_000), cop(3_650_000)]);
  });

  it("counts a card payment as a transfer, so nothing counts twice (Review Focus 5)", async () => {
    const w = await background();
    const groceries = await categoryWithKey(w.ana, "groceries");
    const purchase = await post(recordExpense, w.ana, "expenses", {
      date: "2026-10-10",
      categoryId: groceries,
      amount: cop(200_000),
      accountId: w.visa,
    });
    expect(purchase.status).toBe(201);
    expect(await totalsOf(w.ana)).toEqual([cop(2_300_000), cop(3_750_000)]);
    const payment = await post(recordTransfer, w.ana, "transfers", {
      date: "2026-10-25",
      amount: cop(200_000),
      sourceAccountId: w.bancolombia,
      destinationAccountId: w.visa,
    });
    expect(await payment.json()).toMatchObject({ type: "TRANSFER", categoryId: null });
    const period = await call(listTransactions, "GET", inSpace(w.ana, "transactions?period=2026-10"), {
      user: w.ana,
      params: { spaceId: w.ana.spaceId },
    });
    expect(((await period.json()) as { totals: { expenses: MoneyDto } }).totals.expenses).toEqual(cop(200_000));
    expect(await totalsOf(w.ana)).toEqual([cop(2_100_000), cop(3_750_000)]);
    expect(await totalsOf(w.ana, "?asOf=2026-10-24")).toEqual([cop(2_300_000), cop(3_750_000)]);
  });

  it("leaves archived accounts out, even when they are listed", async () => {
    const w = await background();
    const archived = await call(archiveAccount, "POST", inSpace(w.ana, `accounts/${w.nequi}/archive`), {
      user: w.ana,
      params: { spaceId: w.ana.spaceId, accountId: w.nequi },
    });
    expect(archived.status).toBe(200);
    expect(await totalsOf(w.ana)).toEqual([cop(2_000_000), cop(3_650_000)]);
    expect(await totalsOf(w.ana, "?archived=true")).toEqual([cop(2_000_000), cop(3_650_000)]);
  });

  it("totals a shared space's fund only, for every reader, and leaves personal totals alone", async () => {
    const w = await background();
    const household = actingIn(w.ana, await newSharedSpace(w.ana));
    await newAccount(household, "Household Fund", 1_500_000, "SHARED_FUND");
    const sofi = await registerUser("Sofi");
    await joinAs(w.ana, household.spaceId, sofi, "VIEWER");
    expect(await totalsOf(household)).toEqual([cop(1_500_000), cop(1_500_000)]);
    expect(await totalsOf(actingIn(sofi, household.spaceId))).toEqual([cop(1_500_000), cop(1_500_000)]);
    expect(await totalsOf(w.ana)).toEqual([cop(2_300_000), cop(3_950_000)]);
  });
});
```

Run: `pnpm exec vitest run --project unit src/modules/accounts` and `pnpm exec vitest run --project acceptance tests/acceptance/account-totals.test.ts`
Expected: FAIL — `switchesOf` and `./account-totals` do not exist, and the list has no `totals`.

- [ ] **Step 2: Write the switches and the totals**

In `src/modules/accounts/domain/account.ts`:
1. Insert after the line `  readonly icon: AccountIcon | null;` (inside `interface AccountAttributes`):

```ts
  /** HU-E2-07, ruling P51: null means the type's default (`switchesOf`). */
  readonly includeInAvailable: boolean | null;
  readonly includeInNetWorth: boolean | null;
```

2. Replace the line `  icon: null,` inside `NO_ATTRIBUTES` with:

```ts
  icon: null,
  includeInAvailable: null,
  includeInNetWorth: null,
```

3. Insert after the line `  icon: change.icon === undefined ? current.icon : change.icon,` (inside `withChanges`):

```ts
  includeInAvailable: change.includeInAvailable === undefined ? current.includeInAvailable : change.includeInAvailable,
  includeInNetWorth: change.includeInNetWorth === undefined ? current.includeInNetWorth : change.includeInNetWorth,
```

4. Append to the end of the file:

```ts

/** HU-E2-07: types that count in available money by default; every type counts in net worth by default. */
const AVAILABLE_BY_DEFAULT: ReadonlySet<AccountType> = new Set(["CASH", "BANK", "WALLET", "SHARED_FUND"]);

/** HU-E2-07, ruling P51: the switches an account shows: the chosen value, else the type's default. */
export const switchesOf = (account: Pick<Account, "type" | "includeInAvailable" | "includeInNetWorth">) => ({
  includeInAvailable: account.includeInAvailable ?? AVAILABLE_BY_DEFAULT.has(account.type),
  includeInNetWorth: account.includeInNetWorth ?? true,
});
```

Create `src/modules/accounts/domain/account-totals.ts`:

```ts
import { switchesOf, type Account } from "./account";

/** HU-E2-07, D21: a space's "Disponible" and "Patrimonio neto", in minor units of its currency. */
export interface AccountTotals {
  readonly available: bigint;
  readonly netWorth: bigint;
}

/**
 * HU-E2-07, rulings P51 and P53: Σ signed balances of the active accounts with each switch (liabilities are negative,
 * so net worth is assets minus debts); archived accounts never count. Computed on read (D7).
 */
export const totalsOf = (accounts: readonly (Account & { readonly balance: bigint })[]): AccountTotals => {
  let available = 0n;
  let netWorth = 0n;
  for (const account of accounts) {
    if (account.archivedAt !== null) continue;
    const switches = switchesOf(account);
    if (switches.includeInAvailable) available += account.balance;
    if (switches.includeInNetWorth) netWorth += account.balance;
  }
  return { available, netWorth };
};
```

In `src/modules/accounts/application/list-accounts.ts`:
1. Replace the line `}) => Promise<Result<AccountView[]>>;` (the end of the `ListAccounts` type) with:

```ts
}) => Promise<Result<AccountList>>;

/** HU-E2-03/04/07: the accounts with their balances, and the space's totals over its active ones. */
export interface AccountList {
  readonly items: readonly AccountView[];
  /** The space currency, so an empty space still totals 0 in it. */
  readonly currency: string;
  readonly totals: AccountTotals;
}
```

2. Replace the lines from `    return ok(` to the next `    );` (inside `createListAccounts`; Prettier has split Task 15a's one-liner) with:

```ts
    const { currency } = membership.value;
    const items = await withBalances(deps.movements, accounts, currency, input.asOf ?? null, today);
    // totalsOf skips archived accounts, so `includeArchived` never changes the totals.
    return ok({ items, currency, totals: totalsOf(items) });
```

3. Add `import { totalsOf, type AccountTotals } from "../domain/account-totals";` to its imports.

In `src/modules/accounts/application/index.ts`: replace the line `export { createGetAccount, createListAccounts, type GetAccount, type ListAccounts } from "./list-accounts";` with:

```ts
export {
  createGetAccount,
  createListAccounts,
  type AccountList,
  type GetAccount,
  type ListAccounts,
} from "./list-accounts";
export type { AccountTotals } from "../domain/account-totals";
```

and add `switchesOf` to the existing `export { ACCOUNT_COLORS, … } from "../domain/account";` line.

- [ ] **Step 3: Persist the switches and generate the migration**

In `src/modules/accounts/infrastructure/accounts.schema.ts`, insert after the line `  bigint,` (in the import from `drizzle-orm/pg-core`, which Prettier has split one name per line) the line `  boolean,`, and insert after the line `    icon: text("icon"),`:

```ts
    // HU-E2-07, ruling P51: null means the type's default; nothing is back-filled.
    includeInAvailable: boolean("include_in_available"),
    includeInNetWorth: boolean("include_in_net_worth"),
```

In `src/modules/accounts/infrastructure/drizzle-account-repository.ts`, insert after the line `      icon: account.icon,` inside `add` and inside `save`'s `.set({ … })` (after Task 15a's Prettier pass both sit at 8 spaces; match the trimmed line inside each function, at its indentation):

```ts
      includeInAvailable: account.includeInAvailable,
      includeInNetWorth: account.includeInNetWorth,
```

Run: `pnpm db:generate --name account_switches`
Expected: `drizzle/0016_account_switches.sql` adds the two nullable boolean columns.

- [ ] **Step 4: Expose the switches and the totals**

In `src/modules/accounts/contracts/accounts.contract.ts`:
1. Add `switchesOf` to the import from `../application`.
2. Insert after the line `  icon: Icon,` (inside `AccountSchema`):

```ts
  /** HU-E2-07: whether it counts in the space's available money and net worth (the type's default unless set). */
  includeInAvailable: z.boolean(),
  includeInNetWorth: z.boolean(),
```

3. Insert after the line `  icon: Icon.optional(),` (inside `CreateAccountBodySchema`):

```ts
  includeInAvailable: z.boolean().optional(),
  includeInNetWorth: z.boolean().optional(),
```

   and after the line `  icon: Icon.nullable().optional(),` (inside `UpdateAccountBodySchema`):

```ts
  /** null returns a switch to the type's default. */
  includeInAvailable: z.boolean().nullable().optional(),
  includeInNetWorth: z.boolean().nullable().optional(),
```

4. Replace the line `  body: Pick<z.infer<typeof UpdateAccountBodySchema>, "institution" | "lastFour" | "color" | "icon">,` with:

```ts
  body: Pick<
    z.infer<typeof UpdateAccountBodySchema>,
    "institution" | "lastFour" | "color" | "icon" | "includeInAvailable" | "includeInNetWorth"
  >,
```

   and insert after the line `  icon: body.icon,` (inside `attributesFromBody`):

```ts
  includeInAvailable: body.includeInAvailable,
  includeInNetWorth: body.includeInNetWorth,
```

5. Insert after the line `  icon: iconOf(view),` (inside `accountDto`): `  ...switchesOf(view),`.
6. Replace the line `export const ListAccountsResponseSchema = z.object({ items: z.array(AccountSchema) });` with:

```ts
export const ListAccountsResponseSchema = z.object({
  items: z.array(AccountSchema),
  /** HU-E2-07: over the space's active accounts at `asOf`, whatever `archived` lists. */
  totals: z.object({ available: MoneySchema, netWorth: MoneySchema }),
});

/** HU-E2-07: a list answer. */
export const accountListDto = (list: AccountList): z.infer<typeof ListAccountsResponseSchema> => ({
  items: list.items.map(accountDto),
  totals: {
    available: { amount: list.totals.available.toString(), currency: list.currency },
    netWorth: { amount: list.totals.netWorth.toString(), currency: list.currency },
  },
});
```

   adding `type AccountList` to the import from `../application`.

In `src/app/api/v1/spaces/[spaceId]/accounts/route.ts`, replace the line `    return result.ok ? ok({ status: 200, body: { items: result.value.map(accountDto) } }) : result;` with:

```ts
    return result.ok ? ok({ status: 200, body: accountListDto(result.value) }) : result;
```

Add `accountListDto` to the route's contract import (`accountDto` stays: `POST` uses it).

In `docs/backlog/E2-accounts.md`, insert before the line that starts with `- **Spec impact:** 5.2 **Account** (the two switches and their defaults)`:

```markdown
- Delivered (M3-D Task 16): `GET …/accounts` answers `totals: { available, netWorth }` over the active accounts at `asOf`, whatever `archived` lists; `PATCH` with `null` returns a switch to its type's default. No new error code.
```

Regenerate the snapshot. Expected diff: `Account` gains the two switches, both bodies gain them, the list answer gains `totals`; no new component.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/accounts` and `pnpm exec vitest run --project acceptance tests/acceptance/account-totals.test.ts tests/acceptance/accounts.test.ts tests/acceptance/archived-space.test.ts`
Expected: PASS.

- [ ] **Step 5b: Mutation check (ruling P88)**

Make `totalsOf` count archived accounts (delete the line `    if (account.archivedAt !== null) continue;` in `src/modules/accounts/domain/account-totals.ts`) and run `pnpm exec vitest run --project unit src/modules/accounts/domain/account-totals.test.ts`.
Expected: FAIL — 1 test of `account-totals.test.ts` fails. Restore the line and run it again: PASS.

- [ ] **Step 6: Run the gates, then commit**

```bash
git add src/modules/accounts "src/app/api/v1/spaces/[spaceId]/accounts" tests/acceptance/account-totals.test.ts drizzle/0016_account_switches.sql drizzle/meta openapi/openapi.snapshot.json docs/backlog/E2-accounts.md
git commit -m "feat(accounts): count each account in available money and net worth and total them per space (Refs #97)"
```

---

### Task 17a-1: Categories — the icon set, the one-emoji rule and the palette

Implements HU-E3-05's model: an icon and a palette color on every group and category, defaults copied from the group and seeded by catalog key, subcategories that show their parent's style, an immutable catalog `key` on the seeded groups (which HU-E7-06 reads in M4), and migration `0017_category_styles` with its back-fill.

Task 17a lands as four commits, each green on its own and each its own RDD pass (ruling P84): Task 17a-1 the style values, Task 17a-2 the domain, the seed, PostgreSQL and `0017` with its back-fill, Task 17a-3 the back-fill's characterization test, and Task 17a-4 the use cases and `CategoryView`. The Decisions, the seed table and the Interfaces below cover all four; this commit writes only `category-style.ts` and its test, a pure module nothing uses yet.

Decisions:
- `CategoryIcon` is `{ kind: "SYMBOL", name }`, with `name` one of the 58 names of `CATEGORY_SYMBOLS` (the set HU-E3-05 lists; Hearth's own short names, which the UI maps to its icon set; the nine sections of the icon library are UI metadata that the web layer keeps (HU-E9-04), so the domain, the contract and PostgreSQL know only the flat names), or `{ kind: "EMOJI", value }`, with `value` exactly one emoji. "One emoji" is one extended grapheme cluster as `Intl.Segmenter` counts it (UAX #29): a ZWJ sequence (👩‍💻, 👨‍👩‍👧‍👦) is one grapheme because the joiner glues its pictographs together, a skin tone (👍🏽) is one because the modifier extends its emoji, and a flag (🇨🇴) is one pair of regional indicators. The grapheme must start with an `Extended_Pictographic` code point or be a flag, so letters, digits and keycaps (1️⃣) are refused while a text-default pictograph such as `©` is accepted; it may take at most 32 UTF-16 code units (the longest RGI sequences take 15), so a grapheme stretched by combining marks is refused. Anything else is `InvalidCategoryIcon` (ruling P59).
- `CategoryColor` is one of the sixteen palette keys of `CATEGORY_COLORS`, in the order the color row of the UI shows them; the contract refuses any other value (`ValidationFailed`, Task 17b) and PostgreSQL stores the key, never a hex value (D22). Like the account types (ruling P49), the lists live only in TypeScript; PostgreSQL checks only the shape of a style.
- `CategoryGroup.style` always exists. `Category.style` is a category's own style and is null exactly for a subcategory, which shows its parent's through `shownStyle`: derived on every read, never copied, so it follows its parent (ruling P57). The use cases that answer one category answer a `CategoryView` (`shown`: the style shown), and `ListCategories` nests views.
- Defaults are copied, part by part: a group created without a style takes `CUSTOM_GROUP_STYLE` (`tag`, `GRAPHITE`); a category created without one copies its group's (a `color` alone keeps the group's icon), and later changes of the group never reach it; seeded rows take the table below by catalog key, a seeded category its group's color.
- `CategoryGroup.key` is the immutable catalog key of a seeded group (`housing`, `food`, `transport`, `health`, `leisure`, `income`, one per entry of `DEFAULT_CATALOG`), like `Category.key`: `null` for a group users create, and unique per space when present (`category_groups_space_key_uq`, as `categories_space_key_uq` does for categories). Nothing writes it after the seed and the back-fill: `newGroup` sets `null`, `renameGroup`, `restyleGroup` and `archiveGroup` spread the group, `saveGroup` leaves the column out of its `set`, and no request body takes it (Task 17b). HU-E7-06 (M4) reads it to find the seeded groups across spaces and renames (rulings P74, P77); the answers return it, read-only, as they do a category's (ruling P79).
- A sent `icon` or `color` is `ValidationFailed` when the result of the change is a subcategory: a `POST` with `parentCategoryId`, a `PATCH` of a subcategory that stays one, or of a category that becomes one. A `PATCH` that makes a subcategory a category may restyle it in the same request (ruling P58). A category that becomes a subcategory drops its own style; a subcategory that becomes a category keeps a copy of its former parent's current style, because `reviseCategory` starts from the style it shows.
- Migration `0017_category_styles` adds `icon_kind`, `icon_value` (a symbol's name or the emoji itself) and `color` to both tables: `NOT NULL` with the custom default on `category_groups`, nullable on `categories` with `categories_style_whole` (all three or none) and `categories_style_by_level` (a category has a style, a subcategory none). It also adds the nullable `key` and the unique index `category_groups_space_key_uq` to `category_groups`. A hand-written back-fill, inserted before the generated checks, keys and styles the existing rows (rulings P56, P77, P78): a group takes the key of the catalog group whose seeded categories it holds, the one it holds the most of (the first in catalog order on a tie); when several groups of a space claim one key, the group holding the most of that catalog group's categories keeps it (the oldest on a tie); a group still without a key takes the key of the catalog group whose es or en name equals its name exactly, while that key is free in its space; otherwise it stays keyless. A keyed group then takes its catalog style by key, a seeded category its catalog style by key, any other category its group's; keyless groups keep the column defaults, subcategories stay unstyled.
- `RenameCategoryGroup` keeps its M1 name and binding while it also restyles: its `name` becomes optional (ruling P61).

Seed defaults (HU-E3-01, HU-E3-05; 6 groups and 13 categories, plus the custom default):

| Group (es / en) | Group key | Group icon | Color (group and its categories) | Category icons by catalog key |
|---|---|---|---|---|
| Vivienda / Housing | `housing` | `home` | `INDIGO` | `rent` → `key`, `utilities` → `bulb`, `maintenance` → `wrench` |
| Alimentación / Food | `food` | `apple` | `SAND` | `groceries` → `cart`, `restaurants` → `fork` |
| Transporte / Transport | `transport` | `car` | `STEEL` | `fuel` → `fuel`, `public_transport` → `bus` |
| Salud / Health | `health` | `heart` | `ROSE` | `medical` → `cross`, `pharmacy` → `pill` |
| Ocio / Leisure | `leisure` | `ticket` | `PLUM` | `entertainment` → `tv`, `travel` → `plane` |
| Ingresos / Income | `income` | `coins` | `PINE` | `salary` → `briefcase`, `other_income` → `gift` |
| any group created without a style | none | `tag` | `GRAPHITE` | — |

Every icon and color in the table is a member of `CATEGORY_SYMBOLS` and `CATEGORY_COLORS` (the types enforce it in `default-catalog.ts`); `medical` takes `cross` and `entertainment` `tv` because the 58-name set has no `stethoscope` or `film`. The six group keys are plain strings like the category keys; the seed writes them for new spaces, and the back-fill repeats them for the existing ones (Task 17a-3's drift guard compares the two).

**Files:**
- Create: `src/modules/categories/domain/category-style.ts`, `src/modules/categories/domain/category-style.test.ts`

**Interfaces (Tasks 17a-1 … 17a-4):**
- Consumes: Task 8's `Category.parentCategoryId`, `newCategory`, `reviseCategory`; Task 9a's `CategoryNode`, `parent_category_id` and the five category use cases as it leaves them.
- Produces:
  - `category-style.ts`: `CATEGORY_COLORS`, `CategoryColor`, `CATEGORY_SYMBOLS`, `CategorySymbol`, `CategoryIcon`, `IconInput`, `CategoryStyle`, `StyleChange`, `CUSTOM_GROUP_STYLE`, `isOneEmoji(value): boolean`, `categoryIconOf(input: IconInput): Result<CategoryIcon>` (`InvalidCategoryIcon`, new), `styleChangeOf(input: { icon?: IconInput; color?: CategoryColor }): Result<StyleChange>`, `changesStyle(change): boolean`, `restyled(style, change): CategoryStyle`
  - `CategoryGroup.style: CategoryStyle` and `CategoryGroup.key: string | null`; `Category.style: CategoryStyle | null`; `DEFAULT_CATALOG` entries gain `key`
  - `newGroup` input gains `style?: StyleChange` (the group's `key` is `null`); `restyleGroup(group, change): CategoryGroup`
  - `newCategory` input and `reviseCategory` change gain `style?: StyleChange` (`ValidationFailed`, new for both)
  - `shownStyle(category, categories): CategoryStyle`
  - `interface CategoryView extends Category { shown: CategoryStyle }`, `viewOf(category, categories): CategoryView`; `CategoryNode extends CategoryView { subcategories: readonly CategoryView[] }`
  - `CreateCategoryGroup`, `CreateCategory` and `UpdateCategory` inputs gain `icon?: IconInput; color?: CategoryColor`; `RenameCategoryGroup` gains them and its `name` becomes optional; `CreateCategory`, `UpdateCategory`, `ArchiveCategory` and `RestoreCategory` answer `CategoryView`
  - columns `icon_kind`, `icon_value`, `color` on `category_groups` and `categories`; checks `categories_style_whole`, `categories_style_by_level`; column `key` and unique index `category_groups_space_key_uq` on `category_groups`

- [ ] **Step 1: Write the failing tests of the icons and the palette**

Create `src/modules/categories/domain/category-style.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import {
  CATEGORY_COLORS,
  CATEGORY_SYMBOLS,
  CUSTOM_GROUP_STYLE,
  categoryIconOf,
  isOneEmoji,
  restyled,
  styleChangeOf,
  type CategoryStyle,
} from "./category-style";

/** The nine sections of the icon library (HU-E3-05): UI metadata, so the domain keeps only the flat set they add up to. */
const SECTIONS: readonly (readonly [string, readonly string[]])[] = [
  ["Food", ["cart", "bread", "cup", "fork", "apple", "wine", "pizza", "basket"]],
  ["Home", ["home", "bulb", "droplet", "flame", "wifi", "wrench", "key", "sofa"]],
  ["Transport", ["bus", "car", "fuel", "bike", "plane", "train", "parking"]],
  ["Health and care", ["heart", "pill", "cross", "tooth", "gym", "scissors", "leaf"]],
  ["Leisure", ["ticket", "music", "game", "tv", "book", "gift", "globe"]],
  ["Shopping", ["shirt", "bag", "tag", "phone", "laptop"]],
  ["Money", ["card", "bank", "piggy", "coins", "chart", "receipt", "percent"]],
  ["People and work", ["users", "paw", "graduation", "briefcase"]],
  ["Other", ["star", "umbrella", "shield", "calendar", "dots"]],
];

describe("category icons (HU-E3-05)", () => {
  it("takes exactly the 58 names of the nine sections, each once, and no other", () => {
    const listed = SECTIONS.flatMap(([, names]) => names);
    expect(SECTIONS).toHaveLength(9);
    expect(listed).toHaveLength(58);
    expect(CATEGORY_SYMBOLS).toHaveLength(58);
    expect(new Set(CATEGORY_SYMBOLS).size).toBe(58);
    expect([...CATEGORY_SYMBOLS].sort()).toEqual([...listed].sort());
    for (const name of listed) {
      expect(unwrap(categoryIconOf({ kind: "SYMBOL", name }))).toEqual({ kind: "SYMBOL", name });
    }
  });

  it("refuses a name outside the set, or spelled in another case", () => {
    for (const name of ["unicorn", "Cart", "CART", " cart", "cart ", ""]) {
      expect(codeOf(categoryIconOf({ kind: "SYMBOL", name }))).toBe("InvalidCategoryIcon");
    }
  });

  it.each([
    ["🛒", "one emoji"],
    ["❤️", "an emoji with its presentation selector"],
    ["👍🏽", "a skin tone, which extends its emoji"],
    ["👩‍💻", "a ZWJ sequence"],
    ["👨‍👩‍👧‍👦", "a ZWJ family of four"],
    ["🇨🇴", "a flag of two regional indicators"],
  ])("takes %s (%s) as exactly one emoji", (value) => {
    expect(isOneEmoji(value)).toBe(true);
    expect(unwrap(categoryIconOf({ kind: "EMOJI", value }))).toEqual({ kind: "EMOJI", value });
  });

  it.each([
    ["🛒🍞", "two emojis"],
    ["a", "a letter"],
    ["", "nothing"],
    [" 🛒", "a space before an emoji"],
    ["1️⃣", "a keycap"],
    ["🛒".padEnd(34, "́"), "one grapheme of 34 code units"],
  ])("refuses %s (%s)", (value) => {
    expect(isOneEmoji(value)).toBe(false);
    expect(codeOf(categoryIconOf({ kind: "EMOJI", value }))).toBe("InvalidCategoryIcon");
  });
});

describe("category styles (HU-E3-05, D22)", () => {
  const sand: CategoryStyle = { icon: { kind: "SYMBOL", name: "cart" }, color: "SAND" };

  it("has sixteen palette keys, in the order of the color row, and a custom default for groups", () => {
    expect(CATEGORY_COLORS).toEqual([
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
    ]);
    expect(new Set(CATEGORY_COLORS).size).toBe(16);
    expect(CUSTOM_GROUP_STYLE).toEqual({ icon: { kind: "SYMBOL", name: "tag" }, color: "GRAPHITE" });
  });

  it("changes only the parts that are sent, and checks a sent icon", () => {
    expect(restyled(sand, {})).toEqual(sand);
    expect(restyled(sand, { color: "ROSE" })).toEqual({ icon: sand.icon, color: "ROSE" });
    expect(unwrap(styleChangeOf({ icon: { kind: "EMOJI", value: "🛒" } }))).toEqual({
      icon: { kind: "EMOJI", value: "🛒" },
    });
    expect(codeOf(styleChangeOf({ icon: { kind: "SYMBOL", name: "unicorn" }, color: "ROSE" }))).toBe(
      "InvalidCategoryIcon",
    );
  });
});
```

Run: `pnpm exec vitest run --project unit src/modules/categories/domain/category-style.test.ts`
Expected: FAIL — `./category-style` does not exist.

- [ ] **Step 2: Write the icons and the palette**

Create `src/modules/categories/domain/category-style.ts`:

```ts
import { domainError, err, ok, type Result } from "@/shared/kernel";

/**
 * HU-E3-05, D22: the palette, in the order the color row shows it. The UI maps each key to its light and dark theme
 * tokens; no hex value is stored.
 */
export const CATEGORY_COLORS = [
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
export type CategoryColor = (typeof CATEGORY_COLORS)[number];

/**
 * HU-E3-05: the fixed symbol set, 58 names in alphabetical order. The UI draws each name with its own icon set and
 * groups the names in the nine sections of its icon library; a section is UI metadata and never appears here.
 */
export const CATEGORY_SYMBOLS = [
  "apple",
  "bag",
  "bank",
  "basket",
  "bike",
  "book",
  "bread",
  "briefcase",
  "bulb",
  "bus",
  "calendar",
  "car",
  "card",
  "cart",
  "chart",
  "coins",
  "cross",
  "cup",
  "dots",
  "droplet",
  "flame",
  "fork",
  "fuel",
  "game",
  "gift",
  "globe",
  "graduation",
  "gym",
  "heart",
  "home",
  "key",
  "laptop",
  "leaf",
  "music",
  "parking",
  "paw",
  "percent",
  "phone",
  "piggy",
  "pill",
  "pizza",
  "plane",
  "receipt",
  "scissors",
  "shield",
  "shirt",
  "sofa",
  "star",
  "tag",
  "ticket",
  "tooth",
  "train",
  "tv",
  "umbrella",
  "users",
  "wifi",
  "wine",
  "wrench",
] as const;
export type CategorySymbol = (typeof CATEGORY_SYMBOLS)[number];

export type CategoryIcon =
  | { readonly kind: "SYMBOL"; readonly name: CategorySymbol }
  | { readonly kind: "EMOJI"; readonly value: string };

/** An icon as a request sends it, before `categoryIconOf` checks it. */
export type IconInput =
  | { readonly kind: "SYMBOL"; readonly name: string }
  | { readonly kind: "EMOJI"; readonly value: string };

export interface CategoryStyle {
  readonly icon: CategoryIcon;
  readonly color: CategoryColor;
}

/** What a create or an update changes; a part left out keeps the current (or copied) one. */
export interface StyleChange {
  readonly icon?: CategoryIcon;
  readonly color?: CategoryColor;
}

/** HU-E3-05: the style of a group created without one, and of the custom groups that existed before 0017. */
export const CUSTOM_GROUP_STYLE: CategoryStyle = { icon: { kind: "SYMBOL", name: "tag" }, color: "GRAPHITE" };

// The longest RGI emoji sequences (a kiss with two skin tones, a subdivision flag) take 15 UTF-16 code units.
const MAX_EMOJI_LENGTH = 32;
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
const PICTOGRAPHIC_START = /^\p{Extended_Pictographic}/u;
const FLAG = /^\p{Regional_Indicator}{2}$/u;

/**
 * HU-E3-05, ruling P59: exactly one user-perceived character (one extended grapheme cluster, UAX #29) that is an
 * emoji. A ZWJ sequence and a skin tone are one grapheme (the joiner and the modifier extend the cluster), a flag is
 * one pair of regional indicators; the grapheme must start with an Extended_Pictographic code point or be a flag.
 */
export const isOneEmoji = (value: string): boolean => {
  if (value.length === 0 || value.length > MAX_EMOJI_LENGTH) return false;
  if ([...graphemes.segment(value)].length !== 1) return false;
  return PICTOGRAPHIC_START.test(value) || FLAG.test(value);
};

const isSymbol = (name: string): name is CategorySymbol => (CATEGORY_SYMBOLS as readonly string[]).includes(name);

/** HU-E3-05: an unknown symbol, or a value that is not exactly one emoji, is `InvalidCategoryIcon`. */
export const categoryIconOf = (input: IconInput): Result<CategoryIcon> => {
  if (input.kind === "SYMBOL") {
    return isSymbol(input.name)
      ? ok<CategoryIcon>({ kind: "SYMBOL", name: input.name })
      : err(domainError("InvalidCategoryIcon"));
  }
  return isOneEmoji(input.value)
    ? ok<CategoryIcon>({ kind: "EMOJI", value: input.value })
    : err(domainError("InvalidCategoryIcon"));
};

/** A request's style change: the icon checked here, the color already a palette key (the contract's enum). */
export const styleChangeOf = (input: {
  readonly icon?: IconInput;
  readonly color?: CategoryColor;
}): Result<StyleChange> => {
  if (input.icon === undefined) return ok({ color: input.color });
  const icon = categoryIconOf(input.icon);
  return icon.ok ? ok({ icon: icon.value, color: input.color }) : icon;
};

export const changesStyle = (change: StyleChange): boolean =>
  change.icon !== undefined || change.color !== undefined;

/** `change` over `style`, part by part. */
export const restyled = (style: CategoryStyle, change: StyleChange): CategoryStyle => ({
  icon: change.icon ?? style.icon,
  color: change.color ?? style.color,
});
```

Run: `pnpm exec vitest run --project unit src/modules/categories/domain/category-style.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the gates, then commit**

```bash
git add src/modules/categories/domain/category-style.ts src/modules/categories/domain/category-style.test.ts
git commit -m "feat(categories): define the category icon set, the one-emoji rule and the palette (Refs #107)"
```

---

### Task 17a-2: Categories — styles and group keys in the domain, the seed and PostgreSQL, with `0017`'s back-fill

Continues Task 17a-1 (its Decisions, seed table and Interfaces apply): groups and categories carry a style and the seeded groups a catalog `key` in the domain and the seed, the repository stores and reads them, and `0017_category_styles` adds the columns with its hand-written back-fill. The back-fill's characterization test is Task 17a-3. Review size: the 75 hand-written back-fill lines in `drizzle/0017_category_styles.sql` count toward this commit's ~500 (ruling P85), although `drizzle/` is otherwise excluded as generated; measured ~437 + 75.

**Files:**
- Create: `drizzle/0017_category_styles.sql` (+ meta, generated, then the back-fill)
- Modify: `src/modules/categories/domain/category.ts`, `src/modules/categories/domain/category.test.ts`, `src/modules/categories/domain/default-catalog.ts`, `src/modules/categories/domain/default-catalog.test.ts`, `src/modules/categories/application/category-repository.ts`, `src/modules/categories/infrastructure/categories.schema.ts`, `src/modules/categories/infrastructure/drizzle-category-repository.ts`, `src/modules/categories/infrastructure/drizzle-category-repository.int.test.ts`, `tests/support/fixtures.ts`

- [ ] **Step 1: Write the failing tests of the styled tree and the seed**

In `src/modules/categories/domain/category.test.ts`:

1. Replace the lines from `import {` to `} from "./category";` (the import block from `./category`, as Task 8 left it) with:

```ts
import {
  archiveGroup,
  archivedTree,
  movedTree,
  newCategory,
  newGroup,
  renameGroup,
  restoreCategory,
  restyleGroup,
  reviseCategory,
  shownStyle,
  type Category,
  type CategoryGroup,
} from "./category";
import { CUSTOM_GROUP_STYLE, type CategoryStyle, type StyleChange } from "./category-style";
```

2. Replace the line `  archivedAt,` (inside the `group` helper; the `category` helper has `archivedAt: null,`) with:

```ts
  key: null,
  style: CUSTOM_GROUP_STYLE,
  archivedAt,
```

3. Insert after the line `  parentCategoryId: null,` (inside the `category` helper, Task 8):

```ts
  style: CUSTOM_GROUP_STYLE,
```

4. Append to the end of the file:

```ts

describe("category styles (HU-E3-05)", () => {
  const cart: CategoryStyle = { icon: { kind: "SYMBOL", name: "cart" }, color: "SAND" };
  const plum: CategoryStyle = { icon: { kind: "EMOJI", value: "🛒" }, color: "PLUM" };
  const styledFood: CategoryGroup = { ...food, style: { icon: { kind: "SYMBOL", name: "apple" }, color: "SAND" } };
  const styledGroceries: Category = { ...groceries, style: cart };
  const vegetables: Category = {
    ...category("c-vegetables", "g-food", "Vegetables"),
    parentCategoryId: groceries.id,
    style: null,
  };
  const tree = [styledGroceries, pharmacy, vegetables];
  const create = (style?: StyleChange, parent?: Category) =>
    newCategory({ id: ids.next<"Category">(), group: styledFood, parent, name: "Bakery", now, categories: tree, style });

  it("gives a new group the custom style under what is sent, and restyles a group part by part", () => {
    const pets = (style?: StyleChange) =>
      unwrap(newGroup({ id: ids.next<"CategoryGroup">(), spaceId: "space-ana", name: "Pets", now, groups: [], style }));
    expect(pets().style).toEqual(CUSTOM_GROUP_STYLE);
    expect(pets({ color: "MUSTARD" }).style).toEqual({ icon: CUSTOM_GROUP_STYLE.icon, color: "MUSTARD" });
    expect(restyleGroup(styledFood, { icon: plum.icon }).style).toEqual({ icon: plum.icon, color: "SAND" });
  });

  it("gives a new group no catalog key, and keeps a seeded group's key through a rename, a restyle and an archive", () => {
    const seeded: CategoryGroup = { ...styledFood, key: "food" };
    const pets = unwrap(newGroup({ id: ids.next<"CategoryGroup">(), spaceId: "space-ana", name: "Pets", now, groups: [] }));
    expect(pets.key).toBeNull();
    expect(unwrap(renameGroup(seeded, "Eating", [seeded])).key).toBe("food");
    expect(restyleGroup(seeded, { color: "ROSE" }).key).toBe("food");
    expect(archiveGroup(seeded, [], now).group.key).toBe("food");
  });

  it("copies the group's style into a new category, under what is sent", () => {
    expect(unwrap(create()).style).toEqual(styledFood.style);
    expect(unwrap(create({ color: "ROSE" })).style).toEqual({ icon: styledFood.style.icon, color: "ROSE" });
  });

  it("gives a subcategory no style of its own, refuses one, and shows its parent's", () => {
    expect(unwrap(create(undefined, styledGroceries)).style).toBeNull();
    expect(codeOf(create({ color: "ROSE" }, styledGroceries))).toBe("ValidationFailed");
    expect(codeOf(reviseCategory(vegetables, { style: { color: "ROSE" } }, tree))).toBe("ValidationFailed");
    expect(shownStyle(vegetables, tree)).toEqual(cart);
    expect(shownStyle(vegetables, [{ ...styledGroceries, style: plum }, vegetables])).toEqual(plum);
    expect(shownStyle(styledGroceries, tree)).toEqual(cart);
  });

  it("restyles a category; a promoted subcategory keeps a copy of its parent's, a demoted category drops its own", () => {
    const bread: CategoryStyle = { icon: { kind: "SYMBOL", name: "bread" }, color: "ROSE" };
    expect(unwrap(reviseCategory(styledGroceries, { style: bread }, tree)).style).toEqual(bread);
    expect(unwrap(reviseCategory(vegetables, { parent: null }, tree)).style).toEqual(cart);
    expect(unwrap(reviseCategory(vegetables, { parent: null, style: { color: "SAGE" } }, tree)).style).toEqual({
      icon: cart.icon,
      color: "SAGE",
    });
    expect(unwrap(reviseCategory(pharmacy, { parent: styledGroceries }, tree)).style).toBeNull();
  });
});
```

In `src/modules/categories/domain/default-catalog.test.ts`, insert after the line `import { catalogLanguage, DEFAULT_CATALOG, seedTree } from "./default-catalog";`:

```ts
import type { CategoryStyle } from "./category-style";
```

and append to the end of the file:

```ts

describe("default styles (HU-E3-05)", () => {
  const iconName = (style: CategoryStyle | null): string | null => {
    if (style === null) return null;
    return style.icon.kind === "SYMBOL" ? style.icon.name : style.icon.value;
  };

  it("seeds a symbol and a palette color for every group, and a symbol for every category by catalog key", () => {
    const t = tree("en");
    expect(t.groups.map((g) => [g.name, iconName(g.style), g.style.color])).toEqual([
      ["Housing", "home", "INDIGO"],
      ["Food", "apple", "SAND"],
      ["Transport", "car", "STEEL"],
      ["Health", "heart", "ROSE"],
      ["Leisure", "ticket", "PLUM"],
      ["Income", "coins", "PINE"],
    ]);
    expect(t.categories.map((c) => [c.key, iconName(c.style)])).toEqual([
      ["rent", "key"],
      ["utilities", "bulb"],
      ["maintenance", "wrench"],
      ["groceries", "cart"],
      ["restaurants", "fork"],
      ["fuel", "fuel"],
      ["public_transport", "bus"],
      ["medical", "cross"],
      ["pharmacy", "pill"],
      ["entertainment", "tv"],
      ["travel", "plane"],
      ["salary", "briefcase"],
      ["other_income", "gift"],
    ]);
  });

  it("gives every seeded category the color of its group", () => {
    const t = tree("es");
    const groupColor = (groupId: string) => t.groups.find((g) => g.id === groupId)?.style.color;
    expect(t.categories.every((c) => c.style?.color === groupColor(c.groupId))).toBe(true);
  });
});

describe("group catalog keys (HU-E3-05, HU-E7-06)", () => {
  const KEYS = ["housing", "food", "transport", "health", "leisure", "income"];

  it("gives each seeded group its catalog key, the same in every language", () => {
    expect(DEFAULT_CATALOG.map((entry) => entry.key)).toEqual(KEYS);
    expect(tree("es").groups.map((g) => g.key)).toEqual(KEYS);
    expect(tree("en").groups.map((g) => g.key)).toEqual(KEYS);
  });
});
```

Run: `pnpm exec vitest run --project unit src/modules/categories/domain`
Expected: FAIL — `restyleGroup` and `shownStyle` are not exported, `CategoryGroup` has no `key`, and neither it nor `Category` has a `style`.

- [ ] **Step 2: Put the style on groups and categories, and in the seed**

In `src/modules/categories/domain/category.ts`:

1. Replace the line `import { domainError, err, ok, type Id, type Result } from "@/shared/kernel";` with:

```ts
import { domainError, err, ok, type Id, type Result } from "@/shared/kernel";
import { CUSTOM_GROUP_STYLE, changesStyle, restyled, type CategoryStyle, type StyleChange } from "./category-style";
```

2. Replace the lines from `export interface CategoryGroup {` to its closing `}` with:

```ts
export interface CategoryGroup {
  readonly id: CategoryGroupId;
  readonly spaceId: string;
  readonly name: string;
  /** HU-E3-05: the immutable catalog key of a seeded group (spec D11, like `Category.key`); null for groups users create. */
  readonly key: string | null;
  /** HU-E3-05: the group's icon and color. */
  readonly style: CategoryStyle;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
}
```

3. Insert after the line `  readonly key: string | null;` (inside `interface Category`):

```ts
  /** HU-E3-05: its own icon and color; null for a subcategory, which shows its parent's (`shownStyle`). */
  readonly style: CategoryStyle | null;
```

4. Replace the lines from `export const newGroup = (input: {` to the closing `};` of `newGroup` with:

```ts
/** HU-E3-02, HU-E3-05: a group takes `style` over the custom default (`tag`, `GRAPHITE`) and has no catalog key. */
export const newGroup = (input: {
  id: CategoryGroupId;
  spaceId: string;
  name: string;
  now: Date;
  groups: readonly CategoryGroup[];
  style?: StyleChange;
}): Result<CategoryGroup> => {
  const name = nameOf(input.name);
  if (!name.ok) return name;
  if (input.groups.some((g) => sameName(g.name, name.value)))
    return err(domainError("CategoryGroupNameTaken"));
  return ok({
    id: input.id,
    spaceId: input.spaceId,
    name: name.value,
    key: null,
    style: restyled(CUSTOM_GROUP_STYLE, input.style ?? {}),
    archivedAt: null,
    createdAt: input.now,
  });
};

/** HU-E3-05: a new icon and/or color for a group; its categories keep theirs (each copied its own at creation). */
export const restyleGroup = (group: CategoryGroup, change: StyleChange): CategoryGroup => ({
  ...group,
  style: restyled(group.style, change),
});
```

5. Replace the lines from `/** HU-E3-02, HU-E3-04: a category of \`group\`, or, with \`parent\`, a subcategory of it (\`group\` is the parent's). */` to the closing `};` of `newCategory` (Task 8) with:

```ts
/** HU-E3-05, ruling P58: a category's own style, `change` over `base`; a subcategory has none and refuses one. */
const ownStyle = (
  parentCategoryId: string | null,
  base: CategoryStyle,
  change: StyleChange,
): Result<CategoryStyle | null> => {
  if (parentCategoryId === null) return ok(restyled(base, change));
  return changesStyle(change) ? err(domainError("ValidationFailed", { field: "style" })) : ok(null);
};

/**
 * HU-E3-05, ruling P57: the style a category shows: its own, or a subcategory's parent's, derived on every read so it
 * follows the parent. A live subcategory's parent is never deleted (HU-E3-04), so the fallback is never reached.
 */
export const shownStyle = (category: Category, categories: readonly Category[]): CategoryStyle =>
  category.style ?? categories.find((c) => c.id === category.parentCategoryId)?.style ?? CUSTOM_GROUP_STYLE;

/**
 * HU-E3-02, HU-E3-04, HU-E3-05: a category of `group`, or, with `parent`, a subcategory of it (`group` is the
 * parent's). A category starts from a copy of its group's style with `style` over it; a subcategory has none.
 */
export const newCategory = (input: {
  id: CategoryId;
  group: CategoryGroup;
  parent?: Category;
  name: string;
  now: Date;
  categories: readonly Category[];
  style?: StyleChange;
}): Result<Category> => {
  if (input.group.archivedAt !== null) return err(domainError("CategoryGroupArchived"));
  if (input.parent !== undefined) {
    const parent = usableParent(input.parent);
    if (!parent.ok) return parent;
  }
  const name = nameOf(input.name);
  if (!name.ok) return name;
  const siblings = { groupId: input.group.id, parentCategoryId: input.parent?.id ?? null };
  if (nameTakenIn(input.categories, siblings, name.value)) return err(domainError("CategoryNameTaken"));
  const style = ownStyle(siblings.parentCategoryId, input.group.style, input.style ?? {});
  if (!style.ok) return style;
  return ok({
    id: input.id,
    spaceId: input.group.spaceId,
    groupId: input.group.id,
    parentCategoryId: siblings.parentCategoryId,
    name: name.value,
    key: null,
    style: style.value,
    archivedAt: null,
    createdAt: input.now,
  });
};
```

6. Replace the line `  change: { readonly name?: string; readonly group?: CategoryGroup; readonly parent?: Category | null },` (inside `reviseCategory`) with:

```ts
  change: {
    readonly name?: string;
    readonly group?: CategoryGroup;
    readonly parent?: Category | null;
    /** HU-E3-05: a new icon and/or color; `ValidationFailed` when the result is a subcategory. */
    readonly style?: StyleChange;
  },
```

7. Replace the line `  return ok({ ...category, name: name.value, groupId, parentCategoryId });` with:

```ts
  // HU-E3-05: a category keeps the style it shows, so a subcategory that becomes one keeps a copy of its parent's.
  const style = ownStyle(parentCategoryId, shownStyle(category, categories), change.style ?? {});
  if (!style.ok) return style;
  return ok({ ...category, name: name.value, groupId, parentCategoryId, style: style.value });
```

Replace the contents of `src/modules/categories/domain/default-catalog.ts`:

```ts
import type { IdGenerator } from "@/shared/kernel";
import type { Category, CategoryGroup } from "./category";
import type { CategoryColor, CategorySymbol } from "./category-style";

interface Names {
  readonly es: string;
  readonly en: string;
}

interface CatalogGroup {
  /** HU-E3-05: the group's catalog key, stable across spaces, languages and renames (spec D11, like a category's). */
  readonly key: string;
  readonly names: Names;
  /** HU-E3-05: the group's default style; its categories take its color. */
  readonly icon: CategorySymbol;
  readonly color: CategoryColor;
  readonly categories: readonly { readonly key: string; readonly names: Names; readonly icon: CategorySymbol }[];
}

/** HU-E3-01 default tree. Keys are stable across spaces and renames (spec D11); names become user data. */
export const DEFAULT_CATALOG: readonly CatalogGroup[] = [
  {
    key: "housing",
    names: { es: "Vivienda", en: "Housing" },
    icon: "home",
    color: "INDIGO",
    categories: [
      { key: "rent", names: { es: "Arriendo", en: "Rent" }, icon: "key" },
      { key: "utilities", names: { es: "Servicios", en: "Utilities" }, icon: "bulb" },
      { key: "maintenance", names: { es: "Mantenimiento", en: "Maintenance" }, icon: "wrench" },
    ],
  },
  {
    key: "food",
    names: { es: "Alimentación", en: "Food" },
    icon: "apple",
    color: "SAND",
    categories: [
      { key: "groceries", names: { es: "Mercado", en: "Groceries" }, icon: "cart" },
      { key: "restaurants", names: { es: "Restaurantes", en: "Restaurants" }, icon: "fork" },
    ],
  },
  {
    key: "transport",
    names: { es: "Transporte", en: "Transport" },
    icon: "car",
    color: "STEEL",
    categories: [
      { key: "fuel", names: { es: "Combustible", en: "Fuel" }, icon: "fuel" },
      { key: "public_transport", names: { es: "Transporte público", en: "Public transport" }, icon: "bus" },
    ],
  },
  {
    key: "health",
    names: { es: "Salud", en: "Health" },
    icon: "heart",
    color: "ROSE",
    categories: [
      { key: "medical", names: { es: "Médico", en: "Medical" }, icon: "cross" },
      { key: "pharmacy", names: { es: "Farmacia", en: "Pharmacy" }, icon: "pill" },
    ],
  },
  {
    key: "leisure",
    names: { es: "Ocio", en: "Leisure" },
    icon: "ticket",
    color: "PLUM",
    categories: [
      { key: "entertainment", names: { es: "Entretenimiento", en: "Entertainment" }, icon: "tv" },
      { key: "travel", names: { es: "Viajes", en: "Travel" }, icon: "plane" },
    ],
  },
  {
    key: "income",
    names: { es: "Ingresos", en: "Income" },
    icon: "coins",
    color: "PINE",
    categories: [
      { key: "salary", names: { es: "Salario", en: "Salary" }, icon: "briefcase" },
      { key: "other_income", names: { es: "Otros ingresos", en: "Other income" }, icon: "gift" },
    ],
  },
];

/** English for "en…" locales; Spanish otherwise (primary locale es-CO). */
export const catalogLanguage = (locale: string): keyof Names =>
  locale.toLowerCase().startsWith("en") ? "en" : "es";

/** The default tree for one space, named in the creator's language, keyed and styled by catalog key (HU-E3-05). */
export const seedTree = (input: {
  spaceId: string;
  locale: string;
  now: Date;
  ids: IdGenerator;
}): { groups: CategoryGroup[]; categories: Category[] } => {
  const language = catalogLanguage(input.locale);
  const groups: CategoryGroup[] = [];
  const categories: Category[] = [];
  for (const entry of DEFAULT_CATALOG) {
    const group: CategoryGroup = {
      id: input.ids.next<"CategoryGroup">(),
      spaceId: input.spaceId,
      name: entry.names[language],
      key: entry.key,
      style: { icon: { kind: "SYMBOL", name: entry.icon }, color: entry.color },
      archivedAt: null,
      createdAt: input.now,
    };
    groups.push(group);
    for (const item of entry.categories) {
      categories.push({
        id: input.ids.next<"Category">(),
        spaceId: input.spaceId,
        groupId: group.id,
        // HU-E3-04: the seed has no subcategories.
        parentCategoryId: null,
        name: item.names[language],
        key: item.key,
        // HU-E3-05: a seeded category takes its group's color.
        style: { icon: { kind: "SYMBOL", name: item.icon }, color: entry.color },
        archivedAt: null,
        createdAt: input.now,
      });
    }
  }
  return { groups, categories };
};
```

Literal sites: run `rg -n 'CategoryGroupId|Id<"CategoryGroup">|CategoryGroup\["id"\]' src tests --type ts` and give every whole `CategoryGroup` literal it leads to `key: null` and `style: CUSTOM_GROUP_STYLE` and every whole `Category` literal a `style` (`null` for a subcategory). Today, besides the helpers of Step 1:
- `tests/support/fixtures.ts`: insert before the line `import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";` the line `import { CUSTOM_GROUP_STYLE } from "@/modules/categories/domain/category-style";`, then, inside `categoryFixture`, insert `      key: null,` and `      style: CUSTOM_GROUP_STYLE,` after the line ``      name: `Group ${groupId}`,`` (the group literal) and `      style: CUSTOM_GROUP_STYLE,` after the line `      name,` (the category literal, which already has its `key: null,`).
- `src/modules/categories/infrastructure/drizzle-category-repository.int.test.ts` (Task 9a's `subcategoryWorld`): insert before the line `import { seedTree } from "../domain/default-catalog";` the line `import { CUSTOM_GROUP_STYLE, type CategoryStyle } from "../domain/category-style";`; add `key: null, style: CUSTOM_GROUP_STYLE` to the group object that `subcategoryWorld` passes to `repo.addGroups`; insert after the line `    key: null,` (inside its `category` builder) the line `    style: parentId === null ? CUSTOM_GROUP_STYLE : null,`; and replace the line `    await repo.saveCategories([{ ...vegetables, parentCategoryId: null, name: "Veggies" }]);` with `    await repo.saveCategories([{ ...vegetables, parentCategoryId: null, name: "Veggies", style: CUSTOM_GROUP_STYLE }]);` (a category always stores a style, `categories_style_by_level`).

Run: `pnpm exec vitest run --project unit src/modules/categories/domain`
Expected: PASS (the use cases still compile: `newGroup`, `newCategory` and `reviseCategory` take `style` as optional, and `restoreCategory`, `archivedTree` and `movedTree` spread it along).

- [ ] **Step 3: Write the failing repository tests**

Append to the end of `src/modules/categories/infrastructure/drizzle-category-repository.int.test.ts`:

```ts

describe("category styles (HU-E3-05)", () => {
  it("stores a symbol, an emoji and no style for a subcategory, and refuses a style on the wrong level", async () => {
    const { space, tree } = await seeded();
    const food = tree.groups[1]!;
    const mercado = tree.categories.find((c) => c.key === "groceries")!;
    const verduras: Category = {
      ...mercado,
      id: ids.next<"Category">(),
      parentCategoryId: mercado.id,
      name: "Verduras",
      key: null,
      style: null,
    };
    await repo.addCategories([verduras]);
    const family: CategoryStyle = { icon: { kind: "EMOJI", value: "👨‍👩‍👧" }, color: "PLUM" };
    await repo.saveCategories([{ ...mercado, style: family }]);
    await repo.saveGroup({ ...food, style: family });
    const stored = await repo.listCategories(space.spaceId);
    expect(stored.find((c) => c.id === mercado.id)?.style).toEqual(family);
    expect(stored.find((c) => c.id === verduras.id)?.style).toBeNull();
    const groups = await repo.listGroups(space.spaceId);
    expect(groups.find((g) => g.id === food.id)?.style).toEqual(family);
    expect(groups.find((g) => g.id === tree.groups[0]!.id)?.style).toEqual({
      icon: { kind: "SYMBOL", name: "home" },
      color: "INDIGO",
    });
    // categories_style_by_level: a category always has its own style, a subcategory never.
    await expect(repo.saveCategories([{ ...mercado, style: null }])).rejects.toThrow();
    await expect(repo.saveCategories([{ ...verduras, style: family }])).rejects.toThrow();
  });

  it("stores a seeded group's catalog key, never rewrites it, and allows one group per key and space", async () => {
    const { space, tree } = await seeded();
    const food = tree.groups[1]!;
    await repo.saveGroup({ ...food, name: "Comida", key: "transport" });
    const groups = await repo.listGroups(space.spaceId);
    expect(groups.map((g) => g.key).sort()).toEqual(["food", "health", "housing", "income", "leisure", "transport"]);
    expect(groups.find((g) => g.id === food.id)).toMatchObject({ name: "Comida", key: "food" });
    // category_groups_space_key_uq: a second group of the space cannot take a held key; groups without one never collide.
    const pets = { ...food, id: ids.next<"CategoryGroup">(), name: "Mascotas" };
    await expect(repo.addGroups([{ ...pets, key: "food" }])).rejects.toThrow();
    await repo.addGroups([
      { ...pets, key: null },
      { ...pets, id: ids.next<"CategoryGroup">(), name: "Viajes", key: null },
    ]);
    // Another space seeds the same six keys.
    await seeded();
  });
});
```

Run: `pnpm exec vitest run --project integration src/modules/categories/infrastructure/drizzle-category-repository.int.test.ts`
Expected: FAIL — the repository neither writes nor reads a style or a group key (`column "icon_kind" does not exist` once it does).

- [ ] **Step 4: Add the columns, generate the migration and write its back-fill**

In `src/modules/categories/infrastructure/categories.schema.ts`:

1. Insert before the line `export const categoryGroups = pgTable(`:

```ts
// HU-E3-05, D22: the palette keys (CATEGORY_COLORS); the value list lives in TypeScript only (ruling P49).
const CATEGORY_COLOR_KEYS = [
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

```

2. Insert after the line `    key: text("key"),` (the only one so far, inside `categories`):

```ts
    // HU-E3-05: a category's own style; none for a subcategory, which shows its parent's.
    iconKind: text("icon_kind", { enum: ["SYMBOL", "EMOJI"] }),
    iconValue: text("icon_value"),
    color: text("color", { enum: CATEGORY_COLOR_KEYS }),
```

3. Replace the lines from `export const categoryGroups = pgTable(` to its closing `);` with:

```ts
export const categoryGroups = pgTable(
  "category_groups",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // HU-E3-05, HU-E7-06: the catalog key of a seeded group (housing, food, ...); null for groups users create.
    key: text("key"),
    // HU-E3-05: a symbol's name or the emoji itself; the defaults are CUSTOM_GROUP_STYLE (ruling P56).
    iconKind: text("icon_kind", { enum: ["SYMBOL", "EMOJI"] })
      .notNull()
      .default("SYMBOL"),
    iconValue: text("icon_value").notNull().default("tag"),
    color: text("color", { enum: CATEGORY_COLOR_KEYS }).notNull().default("GRAPHITE"),
    archivedAt: tz("archived_at"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("category_groups_space_name_uq").on(t.spaceId, sql`lower(${t.name})`),
    // HU-E3-05: at most one group per catalog key and space; NULL keys (groups users create) never collide.
    uniqueIndex("category_groups_space_key_uq").on(t.spaceId, t.key),
  ],
);
```

4. Insert after the line `    check("categories_not_own_parent", sql\`${t.parentCategoryId} <> ${t.id}\`),` (Task 9a):

```ts
    // HU-E3-05: an icon and a color together; a category has its own, a subcategory none (ruling P57).
    check("categories_style_whole", sql`num_nulls(${t.iconKind}, ${t.iconValue}, ${t.color}) IN (0, 3)`),
    check("categories_style_by_level", sql`(${t.parentCategoryId} IS NULL) = (${t.color} IS NOT NULL)`),
```

Replace the contents of `src/modules/categories/infrastructure/drizzle-category-repository.ts`:

```ts
import { and, eq, isNull } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { CategoryRepository } from "../application/category-repository";
import type { Category, CategoryGroup, CategoryGroupId, CategoryId } from "../domain/category";
import type { CategoryColor, CategoryIcon, CategoryStyle, CategorySymbol } from "../domain/category-style";
import { categories, categoryGroups } from "./categories.schema";

type IconKind = CategoryIcon["kind"];

/** HU-E3-05: an icon as its two columns; `icon_value` holds a symbol's name or the emoji itself. */
const iconColumns = (icon: CategoryIcon) => ({
  iconKind: icon.kind,
  iconValue: icon.kind === "SYMBOL" ? icon.name : icon.value,
});

const iconOf = (kind: IconKind, value: string): CategoryIcon =>
  kind === "SYMBOL" ? { kind, name: value as CategorySymbol } : { kind, value };

/** A category's own style as columns; a subcategory stores none (`categories_style_by_level`). */
const styleColumns = (style: CategoryStyle | null) =>
  style === null
    ? { iconKind: null, iconValue: null, color: null }
    : { ...iconColumns(style.icon), color: style.color };

const styleOfRow = (row: {
  iconKind: IconKind | null;
  iconValue: string | null;
  color: CategoryColor | null;
}): CategoryStyle | null =>
  row.iconKind === null || row.iconValue === null || row.color === null
    ? null
    : { icon: iconOf(row.iconKind, row.iconValue), color: row.color };

// Space ids always come from a resolved membership, so they are valid UUIDs here.
export class DrizzleCategoryRepository implements CategoryRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async hasAny(spaceId: string): Promise<boolean> {
    const rows = await this.tm
      .executor()
      .select({ id: categoryGroups.id })
      .from(categoryGroups)
      .where(eq(categoryGroups.spaceId, spaceId))
      .limit(1);
    return rows.length > 0;
  }

  async addGroups(groups: readonly CategoryGroup[]): Promise<void> {
    if (groups.length === 0) return;
    await this.tm
      .executor()
      .insert(categoryGroups)
      .values(
        groups.map((g) => ({
          id: g.id,
          spaceId: g.spaceId,
          name: g.name,
          key: g.key,
          ...iconColumns(g.style.icon),
          color: g.style.color,
          archivedAt: g.archivedAt,
          createdAt: g.createdAt,
        })),
      );
  }

  async addCategories(rows: readonly Category[]): Promise<void> {
    if (rows.length === 0) return;
    await this.tm
      .executor()
      .insert(categories)
      .values(
        rows.map((c) => ({
          id: c.id,
          spaceId: c.spaceId,
          groupId: c.groupId,
          parentCategoryId: c.parentCategoryId,
          name: c.name,
          key: c.key,
          ...styleColumns(c.style),
          archivedAt: c.archivedAt,
          createdAt: c.createdAt,
        })),
      );
  }

  async listGroups(spaceId: string): Promise<CategoryGroup[]> {
    const rows = await this.tm
      .executor()
      .select()
      .from(categoryGroups)
      .where(eq(categoryGroups.spaceId, spaceId));
    return rows.map(({ iconKind, iconValue, color, ...row }) => ({
      ...row,
      id: row.id as CategoryGroupId,
      style: { icon: iconOf(iconKind, iconValue), color },
    }));
  }

  async listCategories(spaceId: string): Promise<Category[]> {
    // D8 (Task 0a): deleted categories stay stored, but every read skips them, so they answer as missing.
    const rows = await this.tm
      .executor()
      .select({
        id: categories.id,
        spaceId: categories.spaceId,
        groupId: categories.groupId,
        parentCategoryId: categories.parentCategoryId,
        name: categories.name,
        key: categories.key,
        iconKind: categories.iconKind,
        iconValue: categories.iconValue,
        color: categories.color,
        archivedAt: categories.archivedAt,
        createdAt: categories.createdAt,
      })
      .from(categories)
      .where(and(eq(categories.spaceId, spaceId), isNull(categories.deletedAt)));
    return rows.map(({ iconKind, iconValue, color, ...row }) => ({
      ...row,
      id: row.id as CategoryId,
      groupId: row.groupId as CategoryGroupId,
      parentCategoryId: row.parentCategoryId as CategoryId | null,
      style: styleOfRow({ iconKind, iconValue, color }),
    }));
  }

  async saveGroup(group: CategoryGroup): Promise<void> {
    await this.tm
      .executor()
      .update(categoryGroups)
      .set({
        // HU-E3-05: the catalog key is set when the group is added and never rewritten.
        name: group.name,
        ...iconColumns(group.style.icon),
        color: group.style.color,
        archivedAt: group.archivedAt,
      })
      .where(eq(categoryGroups.id, group.id));
  }

  async saveCategories(rows: readonly Category[]): Promise<void> {
    const db = this.tm.executor();
    for (const c of rows) {
      // HU-E3-05: the level and the style change in one statement, so categories_style_by_level always holds.
      await db
        .update(categories)
        .set({
          name: c.name,
          groupId: c.groupId,
          parentCategoryId: c.parentCategoryId,
          ...styleColumns(c.style),
          archivedAt: c.archivedAt,
        })
        .where(eq(categories.id, c.id));
    }
  }

  async deleteCategory(spaceId: string, categoryId: string, deletedAt: Date): Promise<void> {
    await this.tm
      .executor()
      .update(categories)
      .set({ deletedAt })
      .where(and(eq(categories.spaceId, spaceId), eq(categories.id, categoryId)));
  }
}
```

In `src/modules/categories/application/category-repository.ts`, replace the line `  /** Persists name and archive state. */` with `  /** Persists name, style and archive state. */` and the line `  /** Persists name, group and archive state of each category. */` with `  /** Persists name, group, parent, style and archive state of each category. */`.

Run: `pnpm db:generate --name category_styles`
Expected: `drizzle/0017_category_styles.sql` adds `icon_kind`, `icon_value` and `color` to `categories` (nullable) and to `category_groups` (`NOT NULL` with the defaults `'SYMBOL'`, `'tag'` and `'GRAPHITE'`), adds the nullable `key` to `category_groups`, then creates `category_groups_space_key_uq` and adds `categories_style_whole` and `categories_style_by_level`; nothing else.

Insert the block below into `drizzle/0017_category_styles.sql`, before its first line that starts with `ALTER TABLE "categories" ADD CONSTRAINT` (drizzle-kit writes the columns, then the foreign keys and indexes, then the checks, as `0009_member_lifecycle.sql` shows), so that every existing group has its key and style, and every existing category its style, when `categories_style_by_level` is checked. The unique index already exists when the block runs, so a back-fill that gave two groups one key would fail the migration instead of passing unnoticed. The block is this plan's only hand-written SQL (rulings P56, P77); `pnpm db:check` compares the schema with `drizzle/meta`, which the block does not touch, so it still reports no drift:

```sql
-- HU-E3-05 back-fill, written by hand (rulings P56 and P77). It keys the seeded groups, then styles every row.
-- 1. A group takes the key of the catalog group whose seeded categories it holds: the one it holds the most of (the
--    first in catalog order on a tie). When several groups of a space claim one key, the group holding the most of
--    that catalog group's categories keeps it (the oldest on a tie) and the others stay keyless. Deleted categories
--    are not held.
WITH "held" AS (
  SELECT c."group_id", g."space_id", g."created_at", d."group_key", d."position", count(*) AS "n"
  FROM "categories" AS c
  JOIN "category_groups" AS g ON g."id" = c."group_id"
  JOIN (VALUES
    ('rent', 'housing', 1), ('utilities', 'housing', 1), ('maintenance', 'housing', 1),
    ('groceries', 'food', 2), ('restaurants', 'food', 2),
    ('fuel', 'transport', 3), ('public_transport', 'transport', 3),
    ('medical', 'health', 4), ('pharmacy', 'health', 4),
    ('entertainment', 'leisure', 5), ('travel', 'leisure', 5),
    ('salary', 'income', 6), ('other_income', 'income', 6)
  ) AS d ("category_key", "group_key", "position") ON d."category_key" = c."key"
  WHERE c."deleted_at" IS NULL
  GROUP BY c."group_id", g."space_id", g."created_at", d."group_key", d."position"
), "chosen" AS (
  SELECT DISTINCT ON ("group_id") "group_id", "space_id", "created_at", "group_key", "n"
  FROM "held"
  ORDER BY "group_id", "n" DESC, "position"
), "winners" AS (
  SELECT DISTINCT ON ("space_id", "group_key") "group_id", "group_key"
  FROM "chosen"
  ORDER BY "space_id", "group_key", "n" DESC, "created_at", "group_id"
)
UPDATE "category_groups" AS g
SET "key" = w."group_key"
FROM "winners" AS w
WHERE g."id" = w."group_id";--> statement-breakpoint
-- 2. A group still without a key takes the catalog group whose es or en name equals its name exactly, while that key
--    is free in its space (the oldest group on a tie).
UPDATE "category_groups" AS g
SET "key" = w."group_key"
FROM (
  SELECT DISTINCT ON (u."space_id", d."group_key") u."id", d."group_key"
  FROM "category_groups" AS u
  JOIN (VALUES
    ('housing', 'Vivienda', 'Housing'), ('food', 'Alimentación', 'Food'), ('transport', 'Transporte', 'Transport'),
    ('health', 'Salud', 'Health'), ('leisure', 'Ocio', 'Leisure'), ('income', 'Ingresos', 'Income')
  ) AS d ("group_key", "es", "en") ON u."name" IN (d."es", d."en")
  WHERE u."key" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "category_groups" AS k WHERE k."space_id" = u."space_id" AND k."key" = d."group_key"
    )
  ORDER BY u."space_id", d."group_key", u."created_at", u."id"
) AS w
WHERE g."id" = w."id";--> statement-breakpoint
-- 3. A keyed group takes the style of its catalog group; the other groups keep the column defaults (tag, GRAPHITE).
UPDATE "category_groups" AS g
SET "icon_kind" = 'SYMBOL', "icon_value" = d."icon", "color" = d."color"
FROM (VALUES
  ('housing', 'home', 'INDIGO'), ('food', 'apple', 'SAND'), ('transport', 'car', 'STEEL'),
  ('health', 'heart', 'ROSE'), ('leisure', 'ticket', 'PLUM'), ('income', 'coins', 'PINE')
) AS d ("group_key", "icon", "color")
WHERE g."key" = d."group_key";--> statement-breakpoint
-- 4. A seeded category takes its catalog style by key, in whatever group it is now; any other category takes its
--    group's. Subcategories keep no style.
UPDATE "categories" AS c
SET "icon_kind" = 'SYMBOL', "icon_value" = d."icon", "color" = d."color"
FROM (VALUES
  ('rent', 'key', 'INDIGO'), ('utilities', 'bulb', 'INDIGO'), ('maintenance', 'wrench', 'INDIGO'),
  ('groceries', 'cart', 'SAND'), ('restaurants', 'fork', 'SAND'),
  ('fuel', 'fuel', 'STEEL'), ('public_transport', 'bus', 'STEEL'),
  ('medical', 'cross', 'ROSE'), ('pharmacy', 'pill', 'ROSE'),
  ('entertainment', 'tv', 'PLUM'), ('travel', 'plane', 'PLUM'),
  ('salary', 'briefcase', 'PINE'), ('other_income', 'gift', 'PINE')
) AS d ("category_key", "icon", "color")
WHERE c."key" = d."category_key" AND c."parent_category_id" IS NULL;--> statement-breakpoint
UPDATE "categories" AS c
SET "icon_kind" = g."icon_kind", "icon_value" = g."icon_value", "color" = g."color"
FROM "category_groups" AS g
WHERE g."id" = c."group_id" AND c."key" IS NULL AND c."parent_category_id" IS NULL;--> statement-breakpoint
```

Run: `pnpm exec vitest run --project integration src/modules/categories`, then `pnpm db:check`
Expected: PASS, and "No schema drift: migrations match the Drizzle schema."

- [ ] **Step 5: Run the gates, then commit**

```bash
git add src/modules/categories/domain/category.ts src/modules/categories/domain/category.test.ts src/modules/categories/domain/default-catalog.ts src/modules/categories/domain/default-catalog.test.ts src/modules/categories/application/category-repository.ts src/modules/categories/infrastructure/categories.schema.ts src/modules/categories/infrastructure/drizzle-category-repository.ts src/modules/categories/infrastructure/drizzle-category-repository.int.test.ts tests/support/fixtures.ts drizzle/0017_category_styles.sql drizzle/meta
git commit -m "feat(categories): store an icon and a palette color on groups and categories and a catalog key on seeded groups, seeded and back-filled (Refs #107)"
```

---

### Task 17a-3: Categories — pin `0017`'s back-fill against PostgreSQL

Characterizes the back-fill Task 17a-2 wrote (rulings P56, P77, P78): the first test migrates a fresh database up to `0016`, stores groups and categories as they existed before HU-E3-05, runs `0017` and reads the keys and styles it left; the second is the drift guard between the back-fill's `VALUES` lists and `DEFAULT_CATALOG`. Both pass as soon as they are written, so their red evidence is the mutation of Step 2 (ruling P88).

**Files:**
- Create: `src/modules/categories/infrastructure/category-styles-backfill.int.test.ts`

- [ ] **Step 1: Write the back-fill test**

Create `src/modules/categories/infrastructure/category-styles-backfill.int.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { runMigrations } from "../../../../scripts/migrate.mjs";
import { DEFAULT_CATALOG } from "../domain/default-catalog";

const TAG = "0017_category_styles";
const dbName = `m_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: inject("adminDatabaseUrl") });
const url = new URL(inject("adminDatabaseUrl"));
url.pathname = `/${dbName}`;
/** A copy of drizzle/ whose journal stops before 0017: the schema a database had before HU-E3-05. */
const before = mkdtempSync(join(tmpdir(), "hearth-before-0017-"));
let cut = -1;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  cpSync("drizzle", before, { recursive: true });
  const journalFile = join(before, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalFile, "utf8")) as { entries: { tag: string }[] };
  cut = journal.entries.findIndex((entry) => entry.tag === TAG);
  writeFileSync(journalFile, JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) }));
});

afterAll(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
  rmSync(before, { recursive: true, force: true });
});

describe(`${TAG} back-fill (HU-E3-05, rulings P56 and P77)`, () => {
  it("keys the seeded groups and styles every row, leaving the others keyless and subcategories unstyled", async () => {
    expect(cut).toBeGreaterThan(0);
    await runMigrations(url.toString(), before);
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    try {
      const space = randomUUID();
      await client.query(
        `INSERT INTO spaces (id, name, kind, currency, period_policy, created_at)
         VALUES ($1, 'Household', 'SHARED', 'COP', '{}', now())`,
        [space],
      );
      const group = async (name: string, day: number): Promise<string> => {
        const id = randomUUID();
        await client.query(`INSERT INTO category_groups (id, space_id, name, created_at) VALUES ($1, $2, $3, $4)`, [
          id,
          space,
          name,
          new Date(Date.UTC(2026, 0, day)),
        ]);
        return id;
      };
      const category = async (
        groupId: string,
        name: string,
        key: string | null,
        options: { parent?: string; deleted?: boolean } = {},
      ): Promise<string> => {
        const { rows } = await client.query(
          `INSERT INTO categories (id, space_id, group_id, parent_category_id, name, key, deleted_at, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, CASE WHEN $6::boolean THEN now() END, now()) RETURNING id`,
          [space, groupId, options.parent ?? null, name, key, options.deleted ?? false],
        );
        return (rows[0] as { id: string }).id;
      };
      // Groups, oldest first: a tie goes to the older one.
      const taller = await group("Taller", 1);
      const casa = await group("Casa", 2);
      const despensa = await group("Despensa", 3);
      const fuera = await group("Fuera", 4);
      const mixto = await group("Mixto", 5);
      const hogar = await group("Hogar", 6);
      await group("salud", 7);
      const health = await group("Health", 8);
      await group("Ingresos", 9);
      const mascotas = await group("Mascotas", 10);
      await group("Vivienda", 11);
      // Housing: "Casa" holds the most of it (2 against 1) although "Taller" is older.
      await category(taller, "Mantenimiento", "maintenance");
      await category(casa, "Arriendo", "rent");
      await category(casa, "Servicios", "utilities");
      // Food: a tie of 1 and 1, so the older "Despensa" keeps the key and "Fuera" stays without one.
      const mercado = await category(despensa, "Mercado", "groceries");
      await category(despensa, "Panadería", null);
      await category(despensa, "Verduras", null, { parent: mercado });
      await category(fuera, "Restaurantes", "restaurants");
      // "Mixto" holds two Leisure categories and one Health: the most wins over catalog order.
      await category(mixto, "Cine", "entertainment");
      await category(mixto, "Viajes", "travel");
      await category(mixto, "Farmacia", "pharmacy");
      // "Hogar" holds one Transport and one Income category: a tie goes to the first in catalog order.
      await category(hogar, "Gasolina", "fuel");
      await category(hogar, "Salario", "salary");
      // "Health" and "Ingresos" hold no seeded category and match a seed name exactly, "salud" is a near miss of
      // "Salud", "Vivienda" matches a name whose key "Casa" holds, and a deleted category is not held.
      await category(health, "Gimnasio", null);
      await category(mascotas, "Veterinario", null);
      await category(mascotas, "Otros ingresos", "other_income", { deleted: true });
      await runMigrations(url.toString());
      const rows = async (query: string) => (await client.query(query, [space])).rows;
      expect(
        await rows(
          `SELECT name, key, icon_value, color FROM category_groups WHERE space_id = $1 ORDER BY name COLLATE "C"`,
        ),
      ).toEqual([
        { name: "Casa", key: "housing", icon_value: "home", color: "INDIGO" },
        { name: "Despensa", key: "food", icon_value: "apple", color: "SAND" },
        { name: "Fuera", key: null, icon_value: "tag", color: "GRAPHITE" },
        { name: "Health", key: "health", icon_value: "heart", color: "ROSE" },
        { name: "Hogar", key: "transport", icon_value: "car", color: "STEEL" },
        { name: "Ingresos", key: "income", icon_value: "coins", color: "PINE" },
        { name: "Mascotas", key: null, icon_value: "tag", color: "GRAPHITE" },
        { name: "Mixto", key: "leisure", icon_value: "ticket", color: "PLUM" },
        { name: "Taller", key: null, icon_value: "tag", color: "GRAPHITE" },
        { name: "Vivienda", key: null, icon_value: "tag", color: "GRAPHITE" },
        { name: "salud", key: null, icon_value: "tag", color: "GRAPHITE" },
      ]);
      expect(
        await rows(
          `SELECT name, icon_kind, icon_value, color FROM categories WHERE space_id = $1 ORDER BY name COLLATE "C"`,
        ),
      ).toEqual([
        { name: "Arriendo", icon_kind: "SYMBOL", icon_value: "key", color: "INDIGO" },
        { name: "Cine", icon_kind: "SYMBOL", icon_value: "tv", color: "PLUM" },
        { name: "Farmacia", icon_kind: "SYMBOL", icon_value: "pill", color: "ROSE" },
        { name: "Gasolina", icon_kind: "SYMBOL", icon_value: "fuel", color: "STEEL" },
        { name: "Gimnasio", icon_kind: "SYMBOL", icon_value: "heart", color: "ROSE" },
        { name: "Mantenimiento", icon_kind: "SYMBOL", icon_value: "wrench", color: "INDIGO" },
        { name: "Mercado", icon_kind: "SYMBOL", icon_value: "cart", color: "SAND" },
        { name: "Otros ingresos", icon_kind: "SYMBOL", icon_value: "gift", color: "PINE" },
        { name: "Panadería", icon_kind: "SYMBOL", icon_value: "apple", color: "SAND" },
        { name: "Restaurantes", icon_kind: "SYMBOL", icon_value: "fork", color: "SAND" },
        { name: "Salario", icon_kind: "SYMBOL", icon_value: "briefcase", color: "PINE" },
        { name: "Servicios", icon_kind: "SYMBOL", icon_value: "bulb", color: "INDIGO" },
        { name: "Verduras", icon_kind: null, icon_value: null, color: null },
        { name: "Veterinario", icon_kind: "SYMBOL", icon_value: "tag", color: "GRAPHITE" },
        { name: "Viajes", icon_kind: "SYMBOL", icon_value: "plane", color: "PLUM" },
      ]);
    } finally {
      await client.end();
    }
  });

  it("repeats the seed's group keys, names, styles and category keys, so the back-fill and the seed never drift", () => {
    const sql = readFileSync(`drizzle/${TAG}.sql`, "utf8");
    // Every `(VALUES …) AS d (columns)` list of the back-fill, by its column names.
    const lists = new Map<string, string[][]>();
    for (const match of sql.matchAll(/\(VALUES\s+([\s\S]*?)\s*\) AS d \(([^)]*)\)/g)) {
      const columns = match[2]!.split(",").map((column) => column.trim().replaceAll('"', ""));
      const tuples = [...match[1]!.matchAll(/\(([^()]*)\)/g)].map((tuple) =>
        tuple[1]!.split(",").map((value) => value.trim().replace(/^'|'$/g, "")),
      );
      lists.set(columns.join(","), tuples);
    }
    const groups = DEFAULT_CATALOG.map((group, index) => ({ ...group, position: String(index + 1) }));
    const categories = groups.flatMap((group) => group.categories.map((category) => ({ ...category, group })));
    expect([...lists.keys()].sort()).toEqual([
      "category_key,group_key,position",
      "category_key,icon,color",
      "group_key,es,en",
      "group_key,icon,color",
    ]);
    expect(lists.get("category_key,group_key,position")).toEqual(
      categories.map((c) => [c.key, c.group.key, c.group.position]),
    );
    expect(lists.get("group_key,es,en")).toEqual(groups.map((g) => [g.key, g.names.es, g.names.en]));
    expect(lists.get("group_key,icon,color")).toEqual(groups.map((g) => [g.key, g.icon, g.color]));
    expect(lists.get("category_key,icon,color")).toEqual(categories.map((c) => [c.key, c.icon, c.group.color]));
  });
});
```

Run: `pnpm exec vitest run --project integration src/modules/categories/infrastructure/category-styles-backfill.int.test.ts`
Expected: PASS (2 tests), a characterization of Task 17a-2's back-fill.

- [ ] **Step 2: Mutation check (ruling P88)**

In `drizzle/0017_category_styles.sql`, change the `winners` tie-break `"created_at"` to `"created_at" DESC` (in the line `  ORDER BY "space_id", "group_key", "n" DESC, "created_at", "group_id"`) and run the same command.
Expected: FAIL — 1 test of `category-styles-backfill.int.test.ts` fails (the tie of "Despensa" and "Fuera" goes to the younger group). Revert the change (`git diff drizzle/` shows nothing) and run it again: PASS.

- [ ] **Step 3: Run the gates, then commit**

```bash
git add src/modules/categories/infrastructure/category-styles-backfill.int.test.ts
git commit -m "test(categories): pin the 0017 back-fill of group keys and styles against PostgreSQL (Refs #107)"
```

---

### Task 17a-4: Categories — icons and colors in the use cases, answered as `CategoryView`

Continues Tasks 17a-1 … 17a-3 (Decisions and Interfaces in Task 17a-1): the group and category use cases take `icon` and `color`, and the single-category use cases and `ListCategories` answer `CategoryView`s with the style each shows.

**Files:**
- Create: `src/modules/categories/application/category-view.ts`, `src/modules/categories/application/category-styles.test.ts`
- Modify: `src/modules/categories/application/create-category-group.ts`, `src/modules/categories/application/rename-category-group.ts`, `src/modules/categories/application/create-category.ts`, `src/modules/categories/application/update-category.ts`, `src/modules/categories/application/archive-category.ts`, `src/modules/categories/application/restore-category.ts`, `src/modules/categories/application/list-categories.ts`, `src/modules/categories/application/index.ts`

- [ ] **Step 1: Write the failing use-case tests**

Create `src/modules/categories/application/category-styles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
import { codeOf, fakeSpaceAccess, memoryTm, membership, sequentialIds, unwrap } from "../../../../tests/support/fakes";
import { InMemoryCategories } from "../../../../tests/support/in-memory-categories";
import { createCreateCategory } from "./create-category";
import { createCreateCategoryGroup } from "./create-category-group";
import type { CategoriesDeps } from "./deps";
import { createListCategories } from "./list-categories";
import { createRenameCategoryGroup } from "./rename-category-group";
import { createSeedDefaultCategories } from "./seed-default-categories";
import { createUpdateCategory } from "./update-category";

const asAna = { spaceId: "space-ana", userId: "u-ana" };
const cart = { icon: { kind: "SYMBOL", name: "cart" }, color: "SAND" } as const;
const apple = { icon: { kind: "SYMBOL", name: "apple" }, color: "SAND" } as const;
const emoji = { kind: "EMOJI", value: "🛒" } as const;

/** Ana's personal space, seeded in English: "Groceries" and "Restaurants" in "Food". */
const setup = async () => {
  const categories = new InMemoryCategories();
  const deps: CategoriesDeps = {
    categories,
    access: fakeSpaceAccess(membership()),
    ids: sequentialIds("cat"),
    clock: new FixedClock(new Date("2026-10-16T12:00:00Z")),
    tm: memoryTm,
  };
  unwrap(await createSeedDefaultCategories(deps)({ spaceId: "space-ana", locale: "en" }));
  return {
    named: (name: string) => categories.categories.find((c) => c.name === name)!,
    group: (name: string) => categories.groups.find((g) => g.name === name)!,
    create: createCreateCategory(deps),
    update: createUpdateCategory(deps),
    createGroup: createCreateCategoryGroup(deps),
    renameGroup: createRenameCategoryGroup(deps),
    list: createListCategories(deps),
  };
};

describe("category icon and color (HU-E3-05)", () => {
  it("starts seeded and new categories with a default style, copied from the group at creation", async () => {
    const w = await setup();
    expect([w.group("Food").style, w.named("Groceries").style]).toEqual([apple, cart]);
    const bakery = unwrap(await w.create({ ...asAna, groupId: w.group("Food").id, name: "Bakery" }));
    expect(bakery.shown).toEqual(apple);
    unwrap(await w.renameGroup({ ...asAna, groupId: w.group("Food").id, color: "EMBER" }));
    expect(w.named("Bakery").style).toEqual(apple);
  });

  it("gives a seeded group its catalog key and a group users create none, and keeps the key through a rename and a restyle", async () => {
    const w = await setup();
    const food = w.group("Food").id;
    expect(w.group("Food").key).toBe("food");
    unwrap(await w.renameGroup({ ...asAna, groupId: food, name: "Eating", color: "EMBER" }));
    expect([w.group("Eating").key, w.group("Eating").style.color]).toEqual(["food", "EMBER"]);
    expect(unwrap(await w.createGroup({ ...asAna, name: "Pets" })).key).toBeNull();
  });

  it("changes a category's icon and color, never its group's, and a symbol or an emoji replaces the other", async () => {
    const w = await setup();
    const groceries = w.named("Groceries").id;
    const changed = await w.update({ ...asAna, categoryId: groceries, icon: { kind: "SYMBOL", name: "bread" }, color: "ROSE" });
    expect(unwrap(changed).shown).toEqual({ icon: { kind: "SYMBOL", name: "bread" }, color: "ROSE" });
    expect(w.group("Food").style).toEqual(apple);
    unwrap(await w.update({ ...asAna, categoryId: groceries, icon: emoji }));
    expect(w.named("Groceries").style).toEqual({ icon: emoji, color: "ROSE" });
  });

  it.each([
    [{ kind: "SYMBOL", name: "unicorn" }],
    [{ kind: "EMOJI", value: "🛒🍞" }],
    [{ kind: "EMOJI", value: "a" }],
  ] as const)("refuses the icon %o with InvalidCategoryIcon and changes nothing", async (icon) => {
    const w = await setup();
    const groceries = w.named("Groceries").id;
    expect(codeOf(await w.update({ ...asAna, categoryId: groceries, icon, color: "ROSE" }))).toBe("InvalidCategoryIcon");
    expect(codeOf(await w.createGroup({ ...asAna, name: "Pets", icon }))).toBe("InvalidCategoryIcon");
    expect(w.named("Groceries").style).toEqual(cart);
  });

  it("shows a subcategory with its parent's style, which it follows, and refuses one of its own", async () => {
    const w = await setup();
    const groceries = w.named("Groceries").id;
    const vegetables = unwrap(await w.create({ ...asAna, parentCategoryId: groceries, name: "Vegetables" }));
    expect([vegetables.style, vegetables.shown]).toEqual([null, cart]);
    unwrap(await w.update({ ...asAna, categoryId: groceries, icon: emoji, color: "PLUM" }));
    const food = unwrap(await w.list({ ...asAna, includeArchived: false })).find((g) => g.name === "Food")!;
    const node = food.categories.find((c) => c.id === groceries)!;
    expect(node.subcategories.map((s) => [s.name, s.shown])).toEqual([["Vegetables", { icon: emoji, color: "PLUM" }]]);
    expect(codeOf(await w.update({ ...asAna, categoryId: vegetables.id, color: "ROSE" }))).toBe("ValidationFailed");
    const meat = await w.create({ ...asAna, parentCategoryId: groceries, name: "Meat", color: "ROSE" });
    expect(codeOf(meat)).toBe("ValidationFailed");
  });

  it("keeps a copy of the parent's style when a subcategory becomes a category", async () => {
    const w = await setup();
    const groceries = w.named("Groceries").id;
    unwrap(await w.update({ ...asAna, categoryId: groceries, icon: emoji, color: "PLUM" }));
    const vegetables = unwrap(await w.create({ ...asAna, parentCategoryId: groceries, name: "Vegetables" }));
    const promoted = unwrap(
      await w.update({ ...asAna, categoryId: vegetables.id, parentCategoryId: null, groupId: w.group("Food").id }),
    );
    expect([promoted.parentCategoryId, promoted.style]).toEqual([null, { icon: emoji, color: "PLUM" }]);
    unwrap(await w.update({ ...asAna, categoryId: groceries, color: "SAGE" }));
    expect(w.named("Vegetables").style).toEqual({ icon: emoji, color: "PLUM" });
  });

  it("creates groups with or without a style, and restyles one without renaming it", async () => {
    const w = await setup();
    expect(unwrap(await w.createGroup({ ...asAna, name: "Pets" })).style).toEqual({
      icon: { kind: "SYMBOL", name: "tag" },
      color: "GRAPHITE",
    });
    const kids = unwrap(await w.createGroup({ ...asAna, name: "Kids", icon: { kind: "SYMBOL", name: "users" } }));
    const restyled = unwrap(await w.renameGroup({ ...asAna, groupId: kids.id, color: "PINE" }));
    expect([restyled.name, restyled.style]).toEqual(["Kids", { icon: { kind: "SYMBOL", name: "users" }, color: "PINE" }]);
  });
});
```

Run: `pnpm exec vitest run --project unit src/modules/categories/application/category-styles.test.ts`
Expected: FAIL — the answers have no `shown`, and the use cases ignore `icon` and `color`.

- [ ] **Step 2: Take icons and colors in the use cases and answer views**

Create `src/modules/categories/application/category-view.ts`:

```ts
import { shownStyle, type Category } from "../domain/category";
import type { CategoryStyle } from "../domain/category-style";

/** HU-E3-05: a category as answers show it: `shown` is its own style, or a subcategory's parent's. */
export interface CategoryView extends Category {
  readonly shown: CategoryStyle;
}

export const viewOf = (category: Category, categories: readonly Category[]): CategoryView => ({
  ...category,
  shown: shownStyle(category, categories),
});
```

Replace the contents of `src/modules/categories/application/create-category-group.ts`:

```ts
import type { Result } from "@/shared/kernel";
import { newGroup, type CategoryGroup } from "../domain/category";
import { styleChangeOf, type CategoryColor, type IconInput } from "../domain/category-style";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";

export type CreateCategoryGroup = (input: {
  spaceId: string;
  userId: string;
  name: string;
  /** HU-E3-05: without them, the group takes the custom style (`tag`, `GRAPHITE`). */
  icon?: IconInput;
  color?: CategoryColor;
}) => Promise<Result<CategoryGroup>>;

export const createCreateCategoryGroup =
  (deps: CategoriesDeps): CreateCategoryGroup =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      const style = styleChangeOf(input);
      if (!style.ok) return style;
      const group = newGroup({
        id: deps.ids.next<"CategoryGroup">(),
        spaceId,
        name: input.name,
        now: deps.clock.now(),
        groups: await deps.categories.listGroups(spaceId),
        style: style.value,
      });
      if (!group.ok) return group;
      await deps.categories.addGroups([group.value]);
      return group;
    });
```

Replace the contents of `src/modules/categories/application/rename-category-group.ts`:

```ts
import { domainError, err, ok, type Result } from "@/shared/kernel";
import { renameGroup, restyleGroup, type CategoryGroup } from "../domain/category";
import { styleChangeOf, type CategoryColor, type IconInput } from "../domain/category-style";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";

/** HU-E3-02, HU-E3-05, ruling P61: renames and/or restyles a group; its categories keep their own styles. */
export type RenameCategoryGroup = (input: {
  spaceId: string;
  userId: string;
  groupId: string;
  name?: string;
  icon?: IconInput;
  color?: CategoryColor;
}) => Promise<Result<CategoryGroup>>;

export const createRenameCategoryGroup =
  (deps: CategoriesDeps): RenameCategoryGroup =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const groups = await deps.categories.listGroups(manager.value.spaceId);
      const group = groups.find((g) => g.id === input.groupId);
      if (!group) return err(domainError("CategoryGroupNotFound"));
      const renamed = input.name === undefined ? ok(group) : renameGroup(group, input.name, groups);
      if (!renamed.ok) return renamed;
      const style = styleChangeOf(input);
      if (!style.ok) return style;
      const updated = restyleGroup(renamed.value, style.value);
      await deps.categories.saveGroup(updated);
      return ok(updated);
    });
```

Replace the contents of `src/modules/categories/application/create-category.ts`:

```ts
import { ok, type Result } from "@/shared/kernel";
import { newCategory } from "../domain/category";
import { styleChangeOf, type CategoryColor, type IconInput } from "../domain/category-style";
import { authorizeManager } from "./authorize";
import { viewOf, type CategoryView } from "./category-view";
import type { CategoriesDeps } from "./deps";
import { categoryById, groupById } from "./lookups";

/**
 * HU-E3-02, HU-E3-04, HU-E3-05: a category in `groupId`, or a subcategory of `parentCategoryId` (the contract sends
 * one). A category copies its group's style with `icon` and `color` over it; a subcategory takes neither.
 */
export type CreateCategory = (input: {
  spaceId: string;
  userId: string;
  groupId?: string;
  parentCategoryId?: string;
  name: string;
  icon?: IconInput;
  color?: CategoryColor;
}) => Promise<Result<CategoryView>>;

export const createCreateCategory =
  (deps: CategoriesDeps): CreateCategory =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      const categories = await deps.categories.listCategories(spaceId);
      const groups = await deps.categories.listGroups(spaceId);
      const parent = input.parentCategoryId === undefined ? undefined : categoryById(categories, input.parentCategoryId);
      if (parent !== undefined && !parent.ok) return parent;
      const group = groupById(groups, categories, parent?.value.groupId ?? input.groupId ?? "");
      if (!group.ok) return group;
      const style = styleChangeOf(input);
      if (!style.ok) return style;
      const category = newCategory({
        id: deps.ids.next<"Category">(),
        group: group.value,
        parent: parent?.value,
        name: input.name,
        now: deps.clock.now(),
        categories,
        style: style.value,
      });
      if (!category.ok) return category;
      await deps.categories.addCategories([category.value]);
      return ok(viewOf(category.value, categories));
    });
```

Replace the contents of `src/modules/categories/application/update-category.ts`:

```ts
import { ok, type Result } from "@/shared/kernel";
import { movedTree, reviseCategory } from "../domain/category";
import { styleChangeOf, type CategoryColor, type IconInput } from "../domain/category-style";
import { authorizeManager } from "./authorize";
import { viewOf, type CategoryView } from "./category-view";
import type { CategoriesDeps } from "./deps";
import { categoryById, groupById } from "./lookups";

export type UpdateCategory = (input: {
  spaceId: string;
  userId: string;
  categoryId: string;
  name?: string;
  groupId?: string;
  /** HU-E3-04: a category to become its subcategory, or null to become a category of `groupId` (or its group). */
  parentCategoryId?: string | null;
  /** HU-E3-05: `ValidationFailed` when the result is a subcategory (ruling P58). */
  icon?: IconInput;
  color?: CategoryColor;
}) => Promise<Result<CategoryView>>;

/** HU-E3-02: rename and/or move; existing transactions keep the category (its id never changes). */
export const createUpdateCategory =
  (deps: CategoriesDeps): UpdateCategory =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      const categories = await deps.categories.listCategories(spaceId);
      const category = categoryById(categories, input.categoryId);
      if (!category.ok) return category;
      const target =
        input.groupId === undefined
          ? ok(undefined)
          : groupById(await deps.categories.listGroups(spaceId), categories, input.groupId);
      if (!target.ok) return target;
      const parent =
        input.parentCategoryId === undefined || input.parentCategoryId === null
          ? ok(input.parentCategoryId)
          : categoryById(categories, input.parentCategoryId);
      if (!parent.ok) return parent;
      const style = styleChangeOf(input);
      if (!style.ok) return style;
      const revised = reviseCategory(
        category.value,
        { name: input.name, group: target.value, parent: parent.value, style: style.value },
        categories,
      );
      if (!revised.ok) return revised;
      // HU-E3-04: its subcategories follow it to the new group.
      await deps.categories.saveCategories(movedTree(revised.value, categories));
      return ok(viewOf(revised.value, categories));
    });
```

In `src/modules/categories/application/archive-category.ts`:
1. Replace the line `import { archivedTree, type Category } from "../domain/category";` with `import { archivedTree } from "../domain/category";`, and insert after the line `import { authorizeManager } from "./authorize";` the line `import { viewOf, type CategoryView } from "./category-view";`.
2. Replace the line `}) => Promise<Result<Category>>;` with `}) => Promise<Result<CategoryView>>;`.
3. Replace the line `      return ok(archived[0]!);` with:

```ts
      // HU-E3-05: a subcategory answers with its parent's style.
      return ok(viewOf(archived[0]!, categories));
```

In `src/modules/categories/application/restore-category.ts`:
1. Replace the line `import { domainError, err, type Result } from "@/shared/kernel";` with `import { domainError, err, ok, type Result } from "@/shared/kernel";`, the line `import { restoreCategory, type Category } from "../domain/category";` with `import { restoreCategory } from "../domain/category";`, and insert after the line `import { authorizeManager } from "./authorize";` the line `import { viewOf, type CategoryView } from "./category-view";`.
2. Replace the line `}) => Promise<Result<Category>>;` with `}) => Promise<Result<CategoryView>>;`.
3. Replace the line `      return restored;` with `      return ok(viewOf(restored.value, categories));`.

Replace the contents of `src/modules/categories/application/list-categories.ts`:

```ts
import { authorizeSpaceAction } from "@/modules/spaces/application";
import { ok, type Result } from "@/shared/kernel";
import type { CategoryGroup } from "../domain/category";
import { viewOf, type CategoryView } from "./category-view";
import type { CategoriesDeps } from "./deps";

/** HU-E3-04, HU-E3-05: a category with its subcategories, each sorted by name; each shows its style. */
export interface CategoryNode extends CategoryView {
  readonly subcategories: readonly CategoryView[];
}

export interface CategoryGroupView extends CategoryGroup {
  readonly categories: readonly CategoryNode[];
}

export type ListCategories = (input: {
  spaceId: string;
  userId: string;
  includeArchived: boolean;
}) => Promise<Result<CategoryGroupView[]>>;

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "es");

export const createListCategories =
  (deps: CategoriesDeps): ListCategories =>
  async (input) => {
    const membership = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!membership.ok) return membership;
    const { spaceId } = membership.value;
    const visible = <T extends { archivedAt: Date | null }>(rows: readonly T[]): T[] =>
      input.includeArchived ? [...rows] : rows.filter((row) => row.archivedAt === null);
    const groups = await deps.categories.listGroups(spaceId);
    const categories = await deps.categories.listCategories(spaceId);
    return ok(
      visible(groups)
        .sort(byName)
        .map((group) => ({
          ...group,
          categories: visible(categories.filter((c) => c.groupId === group.id && c.parentCategoryId === null))
            .sort(byName)
            .map((category) => ({
              ...viewOf(category, categories),
              // HU-E3-05: derived on every read, so a subcategory follows its parent's style.
              subcategories: visible(categories.filter((c) => c.parentCategoryId === category.id))
                .sort(byName)
                .map((subcategory) => viewOf(subcategory, categories)),
            })),
        })),
    );
  };
```

In `src/modules/categories/application/index.ts`, insert after the line `export type { Category, CategoryGroup, CategoryGroupId, CategoryId } from "../domain/category";`:

```ts
export {
  CATEGORY_COLORS,
  CATEGORY_SYMBOLS,
  CUSTOM_GROUP_STYLE,
  type CategoryColor,
  type CategoryIcon,
  type CategoryStyle,
  type IconInput,
} from "../domain/category-style";
export type { CategoryView } from "./category-view";
```

Run: `pnpm exec vitest run --project unit src/modules/categories`
Expected: PASS (the routes still compile: `categoryDto` takes a `Category`, and a `CategoryView` is one).

- [ ] **Step 3: Run the gates, then commit**

```bash
git add src/modules/categories/application/category-view.ts src/modules/categories/application/category-styles.test.ts src/modules/categories/application/create-category-group.ts src/modules/categories/application/rename-category-group.ts src/modules/categories/application/create-category.ts src/modules/categories/application/update-category.ts src/modules/categories/application/archive-category.ts src/modules/categories/application/restore-category.ts src/modules/categories/application/list-categories.ts src/modules/categories/application/index.ts
git commit -m "feat(categories): take icons and colors in the category use cases and answer the style each category shows (Refs #107)"
```

---

### Task 17b-1: HTTP — category icons, colors and group keys in every category answer

Exposes Task 17a on `POST` and `PATCH` of groups and categories (optional `icon` and `color`) and on every group, category and subcategory answer, `GET …/categories` included; group answers also return the group's catalog `key`, read-only.

Task 17b lands as two commits, each its own RDD pass (ruling P86): Task 17b-1 the answers, Task 17b-2 the bodies. The Decisions and the Interfaces below cover both.

Decisions:
- A group answer carries `key` (`string | null`): the catalog key of a seeded group, `null` for a group users create. It is read-only and matches the category answer, which has returned its catalog `key` since M1 (ruling P79). It is the same field in `CategoryGroupSummary`, and so in `CategoryGroup`. No body lists it: `CategoryGroupBodySchema` and `UpdateCategoryGroupBodySchema` take `name`, `icon` and `color` only, and Zod drops what a body does not list, so a `key` sent to `POST` or `PATCH` is ignored and a renamed or restyled seeded group answers the key it had.
- `icon` is a union on `kind` (`{ kind: "SYMBOL", name }` or `{ kind: "EMOJI", value }`) and `color` an enum of the sixteen palette keys, both inline: no new component. Answers always carry both, a subcategory with its parent's (`CategoryView.shown`); bodies take both as optional.
- The symbol name and the emoji are the domain's to judge (`InvalidCategoryIcon`, 422 by the `Invalid*` convention of `statusForCode`, so `src/shared/http/problem.ts` gains no entry); an unknown `kind` or a color outside the palette (`"#C0FFEE"`) is `422 ValidationFailed` from the contract before any use case runs; an icon or color for a subcategory is `422 ValidationFailed` from the domain (Task 17a). Nothing is stored in any of these cases.
- `PATCH …/category-groups/{groupId}` takes the new `UpdateCategoryGroupBodySchema` (`name` optional, so a group can be restyled alone); `POST` keeps `CategoryGroupBodySchema`, which gains the two fields (ruling P61).
- OpenAPI: `CategorySchema` is registered as `Category` and already renders twice in the snapshot, as `Category` and `CategoryOutput` (since M1); both gain the fields, as do `CategoryGroupSummary` and `CategoryGroup` (its inline category items included). No `…Output` variant appears beyond the existing `MoneyOutput` and `CategoryOutput`, which `openapi.test.ts` now pins. Measured on a scratch document with zod-openapi 6.0.2, the two fields render about 56 lines per schema with ten keys (the `oneOf` of two objects and the enum), and the sixteen-key enum adds six more to each. `key` renders in `CategoryGroupSummary` and `CategoryGroup` as `Category.key` does (six lines for the property and one for `required`), 14 lines in all. The snapshot grows by about 590 lines: about 345 in the answers and 245 in the four bodies.
- Size (ruling P86): two commits, each failing first, regenerating the snapshot for its own contract change and green on its own. Task 17b-1 is the answers (`IconSchema`, `ColorSchema`, the four answer schemas with the group `key`, `categoryDto`, `categoryGroupDto`, the `openapi.test.ts` assertion and the first scenario), measured ~450 (snapshot +340/−8); Task 17b-2 is the bodies (the four body schemas, the four routes, the descriptions, the backlog note and the other scenarios, the group-key scenario included because its `PATCH` also restyles the group, which needs 17b-2's body), measured ~450 (snapshot +241/−4).

**Files:**
- Modify: `src/modules/categories/contracts/categories.contract.ts`, `src/composition/openapi.test.ts`, `openapi/openapi.snapshot.json`
- Create: `tests/acceptance/category-styles.test.ts`

**Interfaces (Tasks 17b-1 and 17b-2):**
- Consumes: Task 17a's `CategoryView`, `CATEGORY_COLORS`, the `icon` and `color` inputs of `CreateCategoryGroup`, `RenameCategoryGroup`, `CreateCategory` and `UpdateCategory`; Task 9b's contract and routes.
- Produces: `CategorySchema.icon`, `.color`; `CategoryGroupSummarySchema.icon`, `.color`, `.key` (and so `CategoryGroupSchema`); the optional `icon` and `color` of `CategoryGroupBodySchema`, `CreateCategoryBodySchema` and `UpdateCategoryBodySchema`; `UpdateCategoryGroupBodySchema`; `categoryDto(c: CategoryView)`; acceptance helpers `household`, `treeOf`, `named`, `patch` in `category-styles.test.ts`.

- [ ] **Step 1: Write the failing acceptance and OpenAPI tests**

Create `tests/acceptance/category-styles.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listCategories, POST as createCategory } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type TestUser } from "../support/app";
import { inSpace } from "../support/ledger";
import { actingIn, newSharedSpace } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

type Icon = { kind: "SYMBOL"; name: string } | { kind: "EMOJI"; value: string };
interface Styled {
  id: string;
  name: string;
  icon: Icon;
  color: string;
}
interface CategoryDto extends Styled {
  groupId: string;
  parentCategoryId: string | null;
  key: string | null;
}
type Tree = (Styled & { key: string | null; categories: (CategoryDto & { subcategories: CategoryDto[] })[] })[];

const symbol = (name: string): Icon => ({ kind: "SYMBOL", name });
const styleOf = ({ icon, color }: Styled) => ({ icon, color });

/** HU-E3-05 Background: "Ana", with locale "en", creates the shared space "Household", seeded in English. */
const household = async (): Promise<TestUser> => {
  const ana = await registerUser("Ana");
  await app.pool.query(`UPDATE "user" SET locale = 'en' WHERE id = $1`, [ana.userId]);
  return actingIn(ana, await newSharedSpace(ana));
};
const treeOf = async (user: TestUser): Promise<Tree> => {
  const response = await call(listCategories, "GET", inSpace(user, "categories"), {
    user,
    params: { spaceId: user.spaceId },
  });
  return ((await response.json()) as { items: Tree }).items;
};
const groupNamed = async (user: TestUser, name: string) => (await treeOf(user)).find((g) => g.name === name)!;
const createIn = (user: TestUser, body: unknown) =>
  call(createCategory, "POST", inSpace(user, "categories"), { user, params: { spaceId: user.spaceId }, body });
const created = async (user: TestUser, body: unknown): Promise<CategoryDto> => {
  const response = await createIn(user, body);
  if (response.status !== 201) throw new Error(`category creation failed with status ${response.status}`);
  return (await response.json()) as CategoryDto;
};

describe("category icon and color (HU-E3-05)", () => {
  it("starts seeded and new categories with a default icon and color, copied from the group at creation", async () => {
    const ana = await household();
    const food = await groupNamed(ana, "Food");
    expect(food.color).toBe("SAND");
    expect(styleOf(food.categories.find((c) => c.key === "groceries")!)).toEqual({ icon: symbol("cart"), color: "SAND" });
    for (const group of await treeOf(ana)) {
      expect(group.categories.every((c) => c.color === group.color)).toBe(true);
    }
    const bakery = await created(ana, { groupId: food.id, name: "Bakery" });
    expect(styleOf(bakery)).toEqual(styleOf(food));
  });
});
```

In `src/composition/openapi.test.ts`, insert before the line `  it("names the operations that were added, removed or changed", () => {`:

```ts
  it("gives every category node an icon and a palette color, and every group its key, with no new Output variant (HU-E3-05)", () => {
    const schemas = doc.components.schemas as Record<string, { properties?: Record<string, { enum?: unknown[] }> }>;
    for (const name of ["Category", "CategoryOutput", "CategoryGroup", "CategoryGroupSummary"]) {
      expect(Object.keys(schemas[name]?.properties ?? {})).toEqual(expect.arrayContaining(["icon", "color"]));
    }
    expect(schemas.CategoryGroupSummary?.properties?.color?.enum).toHaveLength(16);
    // A group answers its catalog key, as a category does.
    for (const name of ["CategoryGroup", "CategoryGroupSummary"]) {
      expect(Object.keys(schemas[name]?.properties ?? {})).toContain("key");
    }
    expect(Object.keys(schemas).filter((name) => name.endsWith("Output")).sort()).toEqual([
      "CategoryOutput",
      "MoneyOutput",
    ]);
  });

```

(If the post-M3-C baseline already lists another `…Output` component, the preflight adds it to that list; M3-C adds none.)

Run: `pnpm exec vitest run --project acceptance tests/acceptance/category-styles.test.ts` and `pnpm exec vitest run --project unit src/composition/openapi.test.ts`
Expected: FAIL — answers carry no `icon` or `color` and group answers no `key`, and the new OpenAPI test finds no `icon` in `Category`.

- [ ] **Step 2: Extend the answers**

In `src/modules/categories/contracts/categories.contract.ts`:

1. Replace the line `import type { Category, CategoryGroup, CategoryGroupView } from "../application";` with:

```ts
import { CATEGORY_COLORS, type CategoryGroup, type CategoryGroupView, type CategoryView } from "../application";
```

2. Insert before the line `export const CategorySchema = z.object({`:

```ts
/** HU-E3-05: a symbol of the fixed set or exactly one emoji, judged by the domain (InvalidCategoryIcon). */
const IconSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("SYMBOL"), name: z.string().max(64) }),
  z.object({ kind: z.literal("EMOJI"), value: z.string().max(64) }),
]);
/** HU-E3-05, D22: a palette key, never a hex value; anything else is ValidationFailed. */
const ColorSchema = z.enum(CATEGORY_COLORS);

```

3. Replace the lines from `export const CategorySchema = z.object({` to the closing `});` of `CategoryGroupSummarySchema` with:

```ts
export const CategorySchema = z.object({
  id: z.string(),
  groupId: z.string(),
  /** HU-E3-04: the category this subcategory refines; null for a category directly in its group. */
  parentCategoryId: z.string().nullable(),
  name: z.string(),
  /** Stable catalog key of seeded categories; null for user-created ones. */
  key: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  /** HU-E3-05: the icon and color it shows; a subcategory shows its parent's. */
  icon: IconSchema,
  color: ColorSchema,
});
export const CategoryGroupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** HU-E3-05: stable catalog key of seeded groups (`food`); null for groups users create. Read-only: no body takes it. */
  key: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  /** HU-E3-05: the group's icon and color. */
  icon: IconSchema,
  color: ColorSchema,
});
```

4. Replace the line `export const categoryDto = (c: Category): z.infer<typeof CategorySchema> => ({` with `export const categoryDto = (c: CategoryView): z.infer<typeof CategorySchema> => ({`; insert after the line `  archivedAt: isoOrNull(c.archivedAt),` the lines `  icon: c.shown.icon,` and `  color: c.shown.color,`; insert after the line `  name: g.name,` the line `  key: g.key,`, and after the line `  archivedAt: isoOrNull(g.archivedAt),` the lines `  icon: g.style.icon,` and `  color: g.style.color,`.

Regenerate the snapshot: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts`. Expected diff (measured +340/−8): `Category` and `CategoryOutput`, `CategoryGroupSummary` and `CategoryGroup` (its inline category items included) gain `icon` (a `oneOf` of the symbol and the emoji object) and `color` (an enum of sixteen keys) in their `properties` and `required`, and `CategoryGroupSummary` and `CategoryGroup` also `key` (a nullable string); no body changes yet, no new component and no `…Output` variant. If any other `…Output` component appears, a request schema is reusing a response schema: fix the contract instead of accepting the snapshot.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/category-styles.test.ts tests/acceptance/subcategories.test.ts tests/acceptance/categories.test.ts tests/acceptance/shared-spaces.test.ts` and `pnpm exec vitest run --project unit src/composition/openapi.test.ts`
Expected: PASS (M1's tests read categories and groups by field, so the new answer fields change none of them).

- [ ] **Step 4: Run the gates, then commit**

This half is green on its own: its snapshot holds only the answer changes, and every gate passes before Task 17b-2 starts.

```bash
git add src/modules/categories/contracts/categories.contract.ts src/composition/openapi.test.ts tests/acceptance/category-styles.test.ts openapi/openapi.snapshot.json
git commit -m "feat(categories): show the icon and color of every category node and the catalog key of seeded groups over HTTP (Refs #107)"
```

---

### Task 17b-2: HTTP — icons and colors in the category and group bodies

Continues Task 17b-1 (Decisions and Interfaces there): `POST` and `PATCH` of groups and categories take the optional `icon` and `color`, the group `PATCH` takes `UpdateCategoryGroupBodySchema`, and no body takes a `key`.

**Files:**
- Modify: `src/modules/categories/contracts/categories.contract.ts`, `src/app/api/v1/spaces/[spaceId]/categories/route.ts`, `src/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route.ts`, `src/app/api/v1/spaces/[spaceId]/category-groups/route.ts`, `src/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/route.ts`, `tests/acceptance/category-styles.test.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E3-categories.md`

- [ ] **Step 1: Write the failing acceptance tests**

Replace the contents of `tests/acceptance/category-styles.test.ts` (Task 17b-1's helpers and first scenario, plus the helpers and scenarios of the bodies):

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listCategories, POST as createCategory } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { PATCH as updateCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route";
import { POST as createGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/route";
import { PATCH as updateGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { inSpace } from "../support/ledger";
import { actingIn, joinAs, newSharedSpace } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

type Icon = { kind: "SYMBOL"; name: string } | { kind: "EMOJI"; value: string };
interface Styled {
  id: string;
  name: string;
  icon: Icon;
  color: string;
}
interface CategoryDto extends Styled {
  groupId: string;
  parentCategoryId: string | null;
  key: string | null;
}
type Tree = (Styled & { key: string | null; categories: (CategoryDto & { subcategories: CategoryDto[] })[] })[];

const symbol = (name: string): Icon => ({ kind: "SYMBOL", name });
const emoji = (value: string): Icon => ({ kind: "EMOJI", value });
const styleOf = ({ icon, color }: Styled) => ({ icon, color });

/** HU-E3-05 Background: "Ana", with locale "en", creates the shared space "Household", seeded in English. */
const household = async (): Promise<TestUser> => {
  const ana = await registerUser("Ana");
  await app.pool.query(`UPDATE "user" SET locale = 'en' WHERE id = $1`, [ana.userId]);
  return actingIn(ana, await newSharedSpace(ana));
};
const treeOf = async (user: TestUser): Promise<Tree> => {
  const response = await call(listCategories, "GET", inSpace(user, "categories"), {
    user,
    params: { spaceId: user.spaceId },
  });
  return ((await response.json()) as { items: Tree }).items;
};
const groupNamed = async (user: TestUser, name: string) => (await treeOf(user)).find((g) => g.name === name)!;
/** A category or a subcategory of the tree, by name. */
const named = async (user: TestUser, name: string): Promise<CategoryDto> =>
  (await treeOf(user))
    .flatMap((g) => g.categories.flatMap((c) => [c, ...c.subcategories]))
    .find((c) => c.name === name)!;
const createIn = (user: TestUser, body: unknown) =>
  call(createCategory, "POST", inSpace(user, "categories"), { user, params: { spaceId: user.spaceId }, body });
const created = async (user: TestUser, body: unknown): Promise<CategoryDto> => {
  const response = await createIn(user, body);
  if (response.status !== 201) throw new Error(`category creation failed with status ${response.status}`);
  return (await response.json()) as CategoryDto;
};
const patch = (user: TestUser, categoryId: string, body: unknown) =>
  call(updateCategory, "PATCH", inSpace(user, `categories/${categoryId}`), {
    user,
    params: { spaceId: user.spaceId, categoryId },
    body,
  });

describe("category icon and color (HU-E3-05)", () => {
  it("starts seeded and new categories with a default icon and color, copied from the group at creation", async () => {
    const ana = await household();
    const food = await groupNamed(ana, "Food");
    expect(food.color).toBe("SAND");
    expect(styleOf(food.categories.find((c) => c.key === "groceries")!)).toEqual({ icon: symbol("cart"), color: "SAND" });
    for (const group of await treeOf(ana)) {
      expect(group.categories.every((c) => c.color === group.color)).toBe(true);
    }
    const bakery = await created(ana, { groupId: food.id, name: "Bakery" });
    expect(styleOf(bakery)).toEqual(styleOf(food));
  });

  it("changes the icon and color of a category, never its group's, and only for managers", async () => {
    const ana = await household();
    const sofi = await registerUser("Sofi");
    await joinAs(ana, ana.spaceId, sofi, "VIEWER");
    const groceries = await named(ana, "Groceries");
    const changed = await patch(ana, groceries.id, { icon: symbol("bread"), color: "ROSE" });
    expect(styleOf((await changed.json()) as Styled)).toEqual({ icon: symbol("bread"), color: "ROSE" });
    // A symbol from the last section and a key added to the palette travel the same way.
    const library = await patch(ana, groceries.id, { icon: symbol("umbrella"), color: "TEAL" });
    expect(styleOf((await library.json()) as Styled)).toEqual({ icon: symbol("umbrella"), color: "TEAL" });
    expect(styleOf(await groupNamed(ana, "Food"))).toEqual({ icon: symbol("apple"), color: "SAND" });
    expect(await problemOf(await patch(actingIn(sofi, ana.spaceId), groceries.id, { color: "PINE" }))).toEqual([
      403,
      "InsufficientRole",
    ]);
  });

  it("takes one emoji as the icon, and a symbol replaces it again", async () => {
    const ana = await household();
    const groceries = await named(ana, "Groceries");
    const withEmoji = (await (await patch(ana, groceries.id, { icon: emoji("🛒") })).json()) as Styled;
    expect(styleOf(withEmoji)).toEqual({ icon: emoji("🛒"), color: "SAND" });
    const withSymbol = (await (await patch(ana, groceries.id, { icon: symbol("cart") })).json()) as Styled;
    expect(styleOf(withSymbol)).toEqual({ icon: symbol("cart"), color: "SAND" });
  });

  it("refuses unknown symbols, anything but one emoji, and colors outside the palette, and changes nothing", async () => {
    const ana = await household();
    const groceries = await named(ana, "Groceries");
    const refusals = [
      [{ icon: symbol("unicorn") }, [422, "InvalidCategoryIcon"]],
      [{ icon: emoji("🛒🍞") }, [422, "InvalidCategoryIcon"]],
      [{ icon: emoji("a") }, [422, "InvalidCategoryIcon"]],
      [{ color: "#C0FFEE" }, [422, "ValidationFailed"]],
      [{ icon: { kind: "IMAGE", url: "https://example.com/cart.png" } }, [422, "ValidationFailed"]],
    ] as const;
    for (const [body, problem] of refusals) {
      expect(await problemOf(await patch(ana, groceries.id, body))).toEqual(problem);
    }
    expect(styleOf(await named(ana, "Groceries"))).toEqual({ icon: symbol("cart"), color: "SAND" });
  });

  it("shows subcategories with their parent's icon and color, and refuses one of their own", async () => {
    const ana = await household();
    const groceries = await named(ana, "Groceries");
    const vegetables = await created(ana, { parentCategoryId: groceries.id, name: "Vegetables" });
    expect(styleOf(vegetables)).toEqual({ icon: symbol("cart"), color: "SAND" });
    await created(ana, { parentCategoryId: groceries.id, name: "Meat" });
    await patch(ana, groceries.id, { icon: emoji("🛒"), color: "PLUM" });
    const node = (await groupNamed(ana, "Food")).categories.find((c) => c.id === groceries.id)!;
    expect(node.subcategories.map((s) => [s.name, styleOf(s)])).toEqual([
      ["Meat", { icon: emoji("🛒"), color: "PLUM" }],
      ["Vegetables", { icon: emoji("🛒"), color: "PLUM" }],
    ]);
    expect(await problemOf(await patch(ana, vegetables.id, { color: "ROSE" }))).toEqual([422, "ValidationFailed"]);
    const fruit = await createIn(ana, { parentCategoryId: groceries.id, name: "Fruit", color: "ROSE" });
    expect(await problemOf(fruit)).toEqual([422, "ValidationFailed"]);
    expect((await named(ana, "Vegetables")).color).toBe("PLUM");
  });

  it("keeps a copy of the parent's style when a subcategory becomes a category", async () => {
    const ana = await household();
    const food = await groupNamed(ana, "Food");
    const groceries = await named(ana, "Groceries");
    await patch(ana, groceries.id, { icon: emoji("🛒"), color: "PLUM" });
    const vegetables = await created(ana, { parentCategoryId: groceries.id, name: "Vegetables" });
    const promoted = await patch(ana, vegetables.id, { parentCategoryId: null, groupId: food.id });
    expect(await promoted.json()).toMatchObject({
      parentCategoryId: null,
      groupId: food.id,
      icon: emoji("🛒"),
      color: "PLUM",
    });
    await patch(ana, groceries.id, { color: "SAGE" });
    expect((await named(ana, "Vegetables")).color).toBe("PLUM");
  });

  it("creates and restyles groups; a group created without a style takes tag and GRAPHITE", async () => {
    const ana = await household();
    const inGroups = (body: unknown) =>
      call(createGroup, "POST", inSpace(ana, "category-groups"), { user: ana, params: { spaceId: ana.spaceId }, body });
    const pets = (await (await inGroups({ name: "Pets" })).json()) as Styled;
    expect(styleOf(pets)).toEqual({ icon: symbol("tag"), color: "GRAPHITE" });
    const restyled = await call(updateGroup, "PATCH", inSpace(ana, `category-groups/${pets.id}`), {
      user: ana,
      params: { spaceId: ana.spaceId, groupId: pets.id },
      body: { icon: emoji("🐶"), color: "MUSTARD" },
    });
    expect(await restyled.json()).toMatchObject({ name: "Pets", icon: emoji("🐶"), color: "MUSTARD" });
    expect(await problemOf(await inGroups({ name: "Kids", icon: symbol("unicorn") }))).toEqual([
      422,
      "InvalidCategoryIcon",
    ]);
  });

  it("returns a seeded group's catalog key, none for a group users create, and takes no key from any body", async () => {
    const ana = await household();
    expect(Object.fromEntries((await treeOf(ana)).map((g) => [g.name, g.key]))).toEqual({
      Food: "food",
      Health: "health",
      Housing: "housing",
      Income: "income",
      Leisure: "leisure",
      Transport: "transport",
    });
    const inGroups = (body: unknown) =>
      call(createGroup, "POST", inSpace(ana, "category-groups"), { user: ana, params: { spaceId: ana.spaceId }, body });
    const pets = await inGroups({ name: "Pets", key: "food" });
    expect(await pets.json()).toMatchObject({ name: "Pets", key: null });
    const food = await groupNamed(ana, "Food");
    const renamed = await call(updateGroup, "PATCH", inSpace(ana, `category-groups/${food.id}`), {
      user: ana,
      params: { spaceId: ana.spaceId, groupId: food.id },
      body: { name: "Eating", color: "EMBER", key: "housing" },
    });
    expect(await renamed.json()).toMatchObject({ name: "Eating", color: "EMBER", key: "food" });
    expect((await groupNamed(ana, "Eating")).key).toBe("food");
  });
});
```

Run: `pnpm exec vitest run --project acceptance tests/acceptance/category-styles.test.ts`
Expected: FAIL — the bodies strip `icon` and `color`, so the restyles answer the old style and the refusals 200 or 201 instead of 422, and the group `PATCH` without `name` answers `422 ValidationFailed`; the first scenario passes (Task 17b-1).

- [ ] **Step 2: Extend the bodies and the routes**

In `src/modules/categories/contracts/categories.contract.ts`:

1. Replace the line `export const CategoryGroupBodySchema = z.object({ name: Name });` with:

```ts
/** HU-E3-05: every create and update body takes an optional icon and color (the cap only bounds payload size). */
const Style = { icon: IconSchema.optional(), color: ColorSchema.optional() };
export const CategoryGroupBodySchema = z.object({ name: Name, ...Style });
/** HU-E3-05, ruling P61: rename and/or restyle; a group can change its style alone. */
export const UpdateCategoryGroupBodySchema = z.object({ name: Name.optional(), ...Style });
```

2. Replace the lines from `/** HU-E3-04: a category of \`groupId\`, or a subcategory of \`parentCategoryId\`; exactly one. */` to the closing `  });` of `UpdateCategoryBodySchema` (Task 9b's two body schemas, in whatever form Prettier gave them) with:

```ts
/** HU-E3-04: a category of `groupId`, or a subcategory of `parentCategoryId`; exactly one. */
export const CreateCategoryBodySchema = z
  .object({ groupId: ParentId.optional(), parentCategoryId: ParentId.optional(), name: Name, ...Style })
  .refine((body) => (body.groupId === undefined) !== (body.parentCategoryId === undefined), {
    error: "Send exactly one of groupId and parentCategoryId",
    path: ["groupId"],
  });
/** HU-E3-04: `parentCategoryId` makes it a subcategory (in its parent's group); null makes it a category again. */
export const UpdateCategoryBodySchema = z
  .object({
    name: Name.optional(),
    groupId: ParentId.optional(),
    parentCategoryId: ParentId.nullable().optional(),
    ...Style,
  })
  .refine((body) => body.groupId === undefined || typeof body.parentCategoryId !== "string", {
    error: "A subcategory takes its parent's group",
    path: ["groupId"],
  });
```

3. In `categoriesPaths`: replace each of the four lines `          "422": "ValidationFailed, InvalidCategoryName",` (in `createCategory`, `updateCategory`, `createCategoryGroup` and `renameCategoryGroup`) with `          "422": "ValidationFailed, InvalidCategoryName, InvalidCategoryIcon",`; replace the line `      summary: "Rename a category group",` with `      summary: "Rename a category group and/or change its icon and color",`; and inside `renameCategoryGroup` (the second of the two identical lines) replace `      requestBody: { content: jsonContent(CategoryGroupBodySchema) },` with `      requestBody: { content: jsonContent(UpdateCategoryGroupBodySchema) },`.

In `src/app/api/v1/spaces/[spaceId]/categories/route.ts` and in `src/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route.ts`, insert after the line `      parentCategoryId: body.parentCategoryId,` (Task 9b):

```ts
      icon: body.icon,
      color: body.color,
```

In `src/app/api/v1/spaces/[spaceId]/category-groups/route.ts`, insert the same two lines after the line `      name: body.name,`.

In `src/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/route.ts`: replace the lines `  CategoryGroupBodySchema,` and `  categoryGroupDto,` (the import list) with `  categoryGroupDto,` and `  UpdateCategoryGroupBodySchema,`; replace the line `  body: CategoryGroupBodySchema,` with `  body: UpdateCategoryGroupBodySchema,`; and insert the same two lines after the line `      name: body.name,`.

In `docs/backlog/E3-categories.md`, insert before the line that starts with `- **Spec impact:** 5.2 **CategoryGroup / Category** (gain \`icon\` and \`color\`)`:

```markdown
- Seeded styles (M3-D Task 17a), from the 58 symbols and the 16 colors listed above: Housing `home` in `INDIGO` (rent `key`, utilities `bulb`, maintenance `wrench`); Food `apple` in `SAND` (groceries `cart`, restaurants `fork`); Transport `car` in `STEEL` (fuel `fuel`, public_transport `bus`); Health `heart` in `ROSE` (medical `cross`, pharmacy `pill`); Leisure `ticket` in `PLUM` (entertainment `tv`, travel `plane`); Income `coins` in `PINE` (salary `briefcase`, other_income `gift`); a group created without a style takes `tag` in `GRAPHITE`. "One emoji" is one grapheme of at most 32 UTF-16 code units that starts with an Extended_Pictographic code point or is a flag (ZWJ sequences and skin tones count as one).
- Errors (catalogue, spec 8): `InvalidCategoryIcon` (422) for an unknown symbol or an emoji `value` that is not exactly one emoji; `ValidationFailed` (422) for a color outside the palette, an unknown icon `kind`, or an `icon` or `color` sent for a subcategory (M3-D Task 17b).
- Group catalog key (M3-D Task 17b): every group answer (`GET …/categories`, `POST` and `PATCH` of groups) carries `key`, `null` for a group users create; no body takes it, and a `key` sent is ignored.
```

Regenerate the snapshot: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts`. Expected diff (measured +241/−4): the bodies of `createCategory`, `updateCategory`, `createCategoryGroup` and `renameCategoryGroup` gain the optional `icon` and `color` (and `renameCategoryGroup`'s `name` leaves `required`); four 422 descriptions and one summary change; no new component and no `…Output` variant. If any other `…Output` component appears, a request schema is reusing a response schema: fix the contract instead of accepting the snapshot.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/category-styles.test.ts tests/acceptance/subcategories.test.ts tests/acceptance/categories.test.ts tests/acceptance/shared-spaces.test.ts` and `pnpm exec vitest run --project unit src/composition/openapi.test.ts`
Expected: PASS (M1's tests read categories and groups by field, so the new answer fields change none of them; `rg -n "toEqual\(\{" tests/acceptance/categories.test.ts tests/acceptance/subcategories.test.ts` shows no whole-answer comparison).

- [ ] **Step 4: Run the gates, then commit**

This half is green on its own: its snapshot adds only the body changes to Task 17b-1's.

```bash
git add src/modules/categories/contracts/categories.contract.ts "src/app/api/v1/spaces/[spaceId]/categories" "src/app/api/v1/spaces/[spaceId]/category-groups" tests/acceptance/category-styles.test.ts openapi/openapi.snapshot.json docs/backlog/E3-categories.md
git commit -m "feat(categories): set the icon and color of groups and categories over HTTP (Refs #107)"
```

---

### Task 18a: Identity — formatting preferences in the domain, PostgreSQL and the profile use cases

Implements HU-E1-15's model: four nullable formats on each user's profile, resolved against the installation rules through the `InstallationRulesReader` port with built-in es-CO rules, the lock check in `UpdateProfile`, the `GetProfile` query, and migration `0018_user_preferences`. It runs after Task 17b, so its migration follows `0017_category_styles` and no earlier task or migration is renumbered (ruling P73).

Decisions:
- The formats are fixed lists in a new `src/modules/identity/domain/preferences.ts`: `numberFormat` (`DOT_COMMA` `1.234.567,89`, `COMMA_DOT` `1,234,567.89`, `SPACE_COMMA` `1 234 567,89`), `timeFormat` (`H24`, `H12`), `dateFormat` (`DMY`, `MDY`, `YMD`) and `weekStart` (`MONDAY`, `SUNDAY`), with `LOCALES` (`es`, `en`) beside them. Only the four formats are nullable, null meaning "follow the installation rule"; `timezone` and `locale` stay concrete values (ruling P64). Nothing reads `locale` to resolve a format (D23).
- Resolution (`effectivePreferences`): the rule when the field is locked, otherwise the stored value, otherwise the rule. A lock never deletes a stored value, so lifting it brings the person's choice back.
- The rules come through `InstallationRulesReader`, an application port of `identity` (ruling P62). Its built-in adapter, `BuiltInInstallationRules`, answers `BUILT_IN_RULES` (`DOT_COMMA`, `H24`, `DMY`, `MONDAY`, no lock), so the story works before HU-E8-18, which binds an adapter of the stored rules in the composition root and changes nothing else. `InstallationRules.locked` already names any of the six lockable fields (the four formats, `timezone`, `locale`), so HU-E8-18 adds no type. `ContainerOptions.installationRules` is the test seam for locks (Task 18b).
- `UpdateProfile` checks the locks first, in the use case: a change that names a locked field answers `PreferenceLocked` (`details.fields`), even to clear it or to repeat its value, and nothing is written; then an unknown zone answers `InvalidTimeZone` (HU-E1-14). It writes the fields that change in one `saveProfile` call (a zone or a language equal to the current one is not written, as in Task 3; a sent format always is) and still answers the updated `AuthUser`. `GetProfile` builds the view (`stored`, `effective`, `defaults`, `locked`) that `GET` and `PATCH /api/v1/me` answer (Task 18b; rulings P71 and P72).
- Storage: four nullable `text` columns on Better Auth's `user` row (`number_format`, `time_format`, `date_format`, `week_start`), each checked against its list (`user_number_format`, `user_time_format`, `user_date_format`, `user_week_start`), in the generated migration `0018_user_preferences`. Existing users keep null and are never back-filled: they follow the rule. The columns are not Better Auth `additionalFields`: Better Auth inserts only its own fields, so a new user starts with all four null, and `DrizzleUserProfiles` alone reads and writes them.
- `SignUpDeps.profiles` narrows to `Pick<UserProfiles, "setTimeZone">`, so sign-up and its tests keep needing one method while the port grows.
- Size: measured 499 changed lines in the preflight dry run (246 | 253 at the split point), so one commit. Split point if the staged candidate measures over ~500: Steps 1–5 (the preferences, the columns, the migration and the adapter) | Steps 6–8 (the port, the use cases and the container); each half fails first and is green on its own.

**Files:**
- Create: `src/modules/identity/domain/preferences.ts`, `src/modules/identity/domain/preferences.test.ts`, `src/modules/identity/application/installation-rules.ts`, `src/modules/identity/infrastructure/built-in-installation-rules.ts`, `drizzle/0018_user_preferences.sql` (+ meta, generated)
- Modify: `src/modules/identity/infrastructure/auth.schema.ts`, `src/modules/identity/infrastructure/drizzle-user-profiles.ts`, `src/modules/identity/infrastructure/drizzle-user-profiles.int.test.ts`, `src/modules/identity/application/profile.ts`, `src/modules/identity/application/profile.test.ts`, `src/modules/identity/application/sign-up.ts`, `src/modules/identity/application/index.ts`, `src/composition/container.ts`

**Interfaces:**
- Consumes: Task 3's `UserProfiles`, `UpdateProfile`, `createUpdateProfile`, `DrizzleUserProfiles`, `SignUpDeps`, the `profiles` binding of `buildContainer` and the `identity` block of `Container`; `parseTimeZone` (Task 2); `userFixture`, `testDatabase` (tests/support).
- Produces:
  - `preferences.ts`: `NUMBER_FORMATS`, `TIME_FORMATS`, `DATE_FORMATS`, `WEEK_STARTS`, `LOCALES`, `NumberFormat`, `TimeFormat`, `DateFormat`, `WeekStart`, `Locale`, `FormatPreferences`, `StoredPreferences`, `NO_PREFERENCES`, `FORMAT_FIELDS`, `FormatField`, `LOCKABLE_FIELDS`, `LockableField`, `InstallationRules`, `BUILT_IN_RULES`, `ProfileChange`, `effectivePreferences(stored, rules): FormatPreferences`, `lockedFieldsIn(change, rules): LockableField[]`, `formatsIn(change): Partial<StoredPreferences>`
  - `interface InstallationRulesReader { rules(): Promise<InstallationRules> }`; `class BuiltInInstallationRules implements InstallationRulesReader`
  - `UserProfiles` gains `preferencesOf(userId: string): Promise<StoredPreferences>` and `saveProfile(userId: string, fields: ProfileChange): Promise<void>`
  - `interface ProfileView { user: AuthUser; preferences: { stored: StoredPreferences; effective: FormatPreferences; defaults: FormatPreferences; locked: readonly LockableField[] } }`
  - `type GetProfile = (input: { user: AuthUser }) => Promise<Result<ProfileView>>`, `createGetProfile(deps: { profiles: Pick<UserProfiles, "preferencesOf">; rules: InstallationRulesReader })`
  - `type UpdateProfile = (input: { user: AuthUser } & ProfileChange) => Promise<Result<AuthUser>>` — `PreferenceLocked` (new, `details.fields`), `InvalidTimeZone`; `createUpdateProfile(deps: { profiles: Pick<UserProfiles, "saveProfile">; rules: InstallationRulesReader })`
  - columns `user.number_format`, `user.time_format`, `user.date_format`, `user.week_start`; checks `user_number_format`, `user_time_format`, `user_date_format`, `user_week_start`
  - `Container.identity.getProfile: GetProfile`; `ContainerOptions.installationRules?: InstallationRulesReader`

- [ ] **Step 1: Write the failing tests of the formats and their resolution**

Create `src/modules/identity/domain/preferences.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_RULES,
  NO_PREFERENCES,
  effectivePreferences,
  formatsIn,
  lockedFieldsIn,
  type InstallationRules,
} from "./preferences";

const lockingDates: InstallationRules = { ...BUILT_IN_RULES, locked: ["dateFormat"] };

describe("formatting preferences (HU-E1-15)", () => {
  it("builds in es-CO's formats and no lock until HU-E8-18 stores the rules", () => {
    expect(BUILT_IN_RULES).toEqual({
      defaults: { numberFormat: "DOT_COMMA", timeFormat: "H24", dateFormat: "DMY", weekStart: "MONDAY" },
      locked: [],
    });
    expect(effectivePreferences(NO_PREFERENCES, BUILT_IN_RULES)).toEqual(BUILT_IN_RULES.defaults);
  });

  it("applies a stored value over the rule, field by field", () => {
    expect(effectivePreferences({ ...NO_PREFERENCES, timeFormat: "H12" }, BUILT_IN_RULES)).toEqual({
      ...BUILT_IN_RULES.defaults,
      timeFormat: "H12",
    });
  });

  it("applies the rule of a locked field, and the stored value again once the lock is lifted", () => {
    const stored = { ...NO_PREFERENCES, dateFormat: "MDY" as const };
    expect(effectivePreferences(stored, lockingDates).dateFormat).toBe("DMY");
    expect(effectivePreferences(stored, BUILT_IN_RULES).dateFormat).toBe("MDY");
  });

  it("names the locked fields a change touches, even to clear them or to repeat their value", () => {
    const rules: InstallationRules = { ...BUILT_IN_RULES, locked: ["dateFormat", "timezone"] };
    expect(lockedFieldsIn({ dateFormat: "MDY", timeFormat: "H12" }, rules)).toEqual(["dateFormat"]);
    expect(lockedFieldsIn({ dateFormat: null }, rules)).toEqual(["dateFormat"]);
    expect(lockedFieldsIn({ dateFormat: "DMY" }, rules)).toEqual(["dateFormat"]);
    expect(lockedFieldsIn({ locale: "en", timezone: "Europe/Madrid" }, rules)).toEqual(["timezone"]);
    expect(lockedFieldsIn({ timeFormat: "H12" }, rules)).toEqual([]);
  });

  it("keeps only the formats a change sets or clears", () => {
    expect(formatsIn({ timezone: "UTC", locale: "en", timeFormat: null, weekStart: "SUNDAY" })).toEqual({
      timeFormat: null,
      weekStart: "SUNDAY",
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/identity/domain/preferences.test.ts`
Expected: FAIL — `Cannot find module './preferences'`.

- [ ] **Step 3: Write the formats and their resolution**

Create `src/modules/identity/domain/preferences.ts`:

```ts
/** HU-E1-15: how numbers are written: 1.234.567,89, 1,234,567.89 or 1 234 567,89. */
export const NUMBER_FORMATS = ["DOT_COMMA", "COMMA_DOT", "SPACE_COMMA"] as const;
/** HU-E1-15: a 24-hour or a 12-hour clock. */
export const TIME_FORMATS = ["H24", "H12"] as const;
/** HU-E1-15: day-month-year, month-day-year or year-month-day. */
export const DATE_FORMATS = ["DMY", "MDY", "YMD"] as const;
/** HU-E1-15: the first day of the week. */
export const WEEK_STARTS = ["MONDAY", "SUNDAY"] as const;
/** HU-E1-15: the interface languages; a language never sets a format (D23). */
export const LOCALES = ["es", "en"] as const;

export type NumberFormat = (typeof NUMBER_FORMATS)[number];
export type TimeFormat = (typeof TIME_FORMATS)[number];
export type DateFormat = (typeof DATE_FORMATS)[number];
export type WeekStart = (typeof WEEK_STARTS)[number];
export type Locale = (typeof LOCALES)[number];

/** The four formats as they apply. */
export interface FormatPreferences {
  readonly numberFormat: NumberFormat;
  readonly timeFormat: TimeFormat;
  readonly dateFormat: DateFormat;
  readonly weekStart: WeekStart;
}

/** The four formats as a person stored them; null follows the installation rule (ruling P64). */
export type StoredPreferences = { readonly [K in keyof FormatPreferences]: FormatPreferences[K] | null };

/** A person who stored no format. */
export const NO_PREFERENCES: StoredPreferences = {
  numberFormat: null,
  timeFormat: null,
  dateFormat: null,
  weekStart: null,
};

export const FORMAT_FIELDS = ["numberFormat", "timeFormat", "dateFormat", "weekStart"] as const;
export type FormatField = (typeof FORMAT_FIELDS)[number];

/** The person-level fields an installation may lock (HU-E8-18): the four formats, the time zone and the language. */
export const LOCKABLE_FIELDS = [...FORMAT_FIELDS, "timezone", "locale"] as const;
export type LockableField = (typeof LOCKABLE_FIELDS)[number];

/** HU-E1-15, HU-E8-18: the installation's defaults and the fields people may not change. */
export interface InstallationRules {
  readonly defaults: FormatPreferences;
  readonly locked: readonly LockableField[];
}

/** HU-E1-15: the rules until HU-E8-18 stores the installation's own: es-CO's formats, nothing locked. */
export const BUILT_IN_RULES: InstallationRules = {
  defaults: { numberFormat: "DOT_COMMA", timeFormat: "H24", dateFormat: "DMY", weekStart: "MONDAY" },
  locked: [],
};

/** What a person asks to change: an omitted field is unchanged; a null format returns to the rule. */
export interface ProfileChange {
  readonly timezone?: string;
  readonly locale?: Locale;
  readonly numberFormat?: NumberFormat | null;
  readonly timeFormat?: TimeFormat | null;
  readonly dateFormat?: DateFormat | null;
  readonly weekStart?: WeekStart | null;
}

const effective = <K extends FormatField>(
  field: K,
  stored: StoredPreferences,
  rules: InstallationRules,
): FormatPreferences[K] =>
  rules.locked.includes(field) ? rules.defaults[field] : (stored[field] ?? rules.defaults[field]);

/** HU-E1-15: the rule when the field is locked, otherwise the stored value, otherwise the rule; never the language. */
export const effectivePreferences = (stored: StoredPreferences, rules: InstallationRules): FormatPreferences => ({
  numberFormat: effective("numberFormat", stored, rules),
  timeFormat: effective("timeFormat", stored, rules),
  dateFormat: effective("dateFormat", stored, rules),
  weekStart: effective("weekStart", stored, rules),
});

/** HU-E1-15: the locked fields a change names, even to clear them or to repeat their value (PreferenceLocked). */
export const lockedFieldsIn = (change: ProfileChange, rules: InstallationRules): LockableField[] =>
  LOCKABLE_FIELDS.filter((field) => change[field] !== undefined && rules.locked.includes(field));

/** HU-E1-15: the formats a change sets or clears, without the ones it leaves out. */
export const formatsIn = (change: ProfileChange): Partial<StoredPreferences> =>
  Object.fromEntries(
    FORMAT_FIELDS.filter((field) => change[field] !== undefined).map((field) => [field, change[field]]),
  ) as Partial<StoredPreferences>;
```

Run: `pnpm exec vitest run --project unit src/modules/identity/domain/preferences.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 4: Write the failing repository test**

In `src/modules/identity/infrastructure/drizzle-user-profiles.int.test.ts` (Task 3's), insert after the line `import { DrizzleUserProfiles } from "./drizzle-user-profiles";`:

```ts
import { NO_PREFERENCES } from "../domain/preferences";
```

and append to the end of the file:

```ts

describe("DrizzleUserProfiles formats (HU-E1-15)", () => {
  it("stores no format at first, then only the fields a change names; null clears one", async () => {
    const ana = await userFixture(pool, "Ana");
    expect(await profiles.preferencesOf(ana.id)).toEqual(NO_PREFERENCES);
    await profiles.saveProfile(ana.id, { timeFormat: "H12", locale: "en" });
    await profiles.saveProfile(ana.id, { numberFormat: "SPACE_COMMA", weekStart: "SUNDAY" });
    await profiles.saveProfile(ana.id, { weekStart: null });
    expect(await profiles.preferencesOf(ana.id)).toEqual({
      ...NO_PREFERENCES,
      numberFormat: "SPACE_COMMA",
      timeFormat: "H12",
    });
    const { rows } = await pool.query(`SELECT locale, timezone FROM "user" WHERE id = $1`, [ana.id]);
    expect(rows).toEqual([{ locale: "en", timezone: "America/Bogota" }]);
    expect(await profiles.preferencesOf("nobody")).toEqual(NO_PREFERENCES);
  });

  it.each([
    ["number_format", "DOT_DOT", "user_number_format"],
    ["time_format", "H13", "user_time_format"],
    ["date_format", "DDMM", "user_date_format"],
    ["week_start", "FRIDAY", "user_week_start"],
  ])("refuses an unknown %s (%s)", async (column, value, constraint) => {
    const luis = await userFixture(pool, "Luis");
    await expect(pool.query(`UPDATE "user" SET ${column} = $1 WHERE id = $2`, [value, luis.id])).rejects.toMatchObject({
      constraint,
    });
  });
});
```

Run: `pnpm exec vitest run --project integration src/modules/identity/infrastructure/drizzle-user-profiles.int.test.ts`
Expected: FAIL — `profiles.preferencesOf is not a function`, and the `user` table has no `number_format` column.

- [ ] **Step 5: Add the columns, generate the migration and extend the adapter**

In `src/modules/identity/infrastructure/auth.schema.ts`:

1. Replace the line `import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";` with:

```ts
import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { DATE_FORMATS, NUMBER_FORMATS, TIME_FORMATS, WEEK_STARTS } from "../domain/preferences";
```

2. Replace the lines from `export const user = pgTable("user", {` to its closing `});` with:

```ts
export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    locale: text("locale").notNull().default("es"),
    timezone: text("timezone").notNull().default("America/Bogota"),
    // HU-E1-15, D23: null follows the installation rule; Better Auth never reads or writes these four.
    numberFormat: text("number_format", { enum: NUMBER_FORMATS }),
    timeFormat: text("time_format", { enum: TIME_FORMATS }),
    dateFormat: text("date_format", { enum: DATE_FORMATS }),
    weekStart: text("week_start", { enum: WEEK_STARTS }),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("user_number_format", sql`${t.numberFormat} IN ('DOT_COMMA', 'COMMA_DOT', 'SPACE_COMMA')`),
    check("user_time_format", sql`${t.timeFormat} IN ('H24', 'H12')`),
    check("user_date_format", sql`${t.dateFormat} IN ('DMY', 'MDY', 'YMD')`),
    check("user_week_start", sql`${t.weekStart} IN ('MONDAY', 'SUNDAY')`),
  ],
);
```

Replace the contents of `src/modules/identity/infrastructure/drizzle-user-profiles.ts` (Task 3's two methods are unchanged):

```ts
import { eq } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { canonicalTimeZone, type UserTimeZones } from "@/shared/kernel";
import type { UserProfiles } from "../application/profile";
import { NO_PREFERENCES, type ProfileChange, type StoredPreferences } from "../domain/preferences";
import { user } from "./auth.schema";

/**
 * HU-E1-14, HU-E1-15: the zone, the language and the formats on Better Auth's `user` row; read and written inside the
 * caller's transaction when there is one.
 */
export class DrizzleUserProfiles implements UserProfiles, UserTimeZones {
  constructor(
    private readonly tm: DrizzleTransactionManager,
    /** APP_TIMEZONE. */
    private readonly fallback: string,
  ) {}

  async setTimeZone(userId: string, timeZone: string): Promise<void> {
    await this.tm.executor().update(user).set({ timezone: timeZone, updatedAt: new Date() }).where(eq(user.id, userId));
  }

  async timeZoneOf(userId: string): Promise<string> {
    const [row] = await this.tm
      .executor()
      .select({ timezone: user.timezone })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    // Ruling P45: never hand a caller a zone Intl would throw on.
    return canonicalTimeZone(row?.timezone ?? "") ?? this.fallback;
  }

  /** HU-E1-15: the four formats as stored; an unknown user stores none. */
  async preferencesOf(userId: string): Promise<StoredPreferences> {
    const [row] = await this.tm
      .executor()
      .select({
        numberFormat: user.numberFormat,
        timeFormat: user.timeFormat,
        dateFormat: user.dateFormat,
        weekStart: user.weekStart,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return row ?? NO_PREFERENCES;
  }

  /** HU-E1-15: one UPDATE; drizzle leaves the undefined fields out of SET, and null clears a format. */
  async saveProfile(userId: string, fields: ProfileChange): Promise<void> {
    await this.tm
      .executor()
      .update(user)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(user.id, userId));
  }
}
```

Run: `pnpm db:generate --name user_preferences`
Expected: `drizzle/0018_user_preferences.sql` adds `number_format`, `time_format`, `date_format` and `week_start` to `user` and the checks `user_number_format`, `user_time_format`, `user_date_format` and `user_week_start`; nothing else (no back-fill: every column is nullable).

Run: `pnpm exec vitest run --project integration src/modules/identity/infrastructure`
Expected: PASS (Task 3's adapter and provider tests included).

- [ ] **Step 6: Write the failing use-case tests**

Replace the contents of `src/modules/identity/application/profile.test.ts` (Task 3's three tests are kept, now reading the writes of `saveProfile`):

```ts
import { describe, expect, it } from "vitest";
import type { AuthUser } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import {
  BUILT_IN_RULES,
  NO_PREFERENCES,
  formatsIn,
  type InstallationRules,
  type ProfileChange,
  type StoredPreferences,
} from "../domain/preferences";
import { createGetProfile, createUpdateProfile, type UserProfiles } from "./profile";

const ana: AuthUser = { id: "u-ana", name: "Ana", email: "ana@example.com", locale: "es", timezone: "America/Bogota" };

/** Profiles in memory as DrizzleUserProfiles keeps them; `writes` records every save. */
const world = (rules: InstallationRules = BUILT_IN_RULES) => {
  const stored = new Map<string, StoredPreferences>();
  const writes: [string, ProfileChange][] = [];
  const profiles: UserProfiles = {
    setTimeZone: async () => undefined,
    preferencesOf: async (userId) => stored.get(userId) ?? NO_PREFERENCES,
    saveProfile: async (userId, fields) => {
      writes.push([userId, fields]);
      stored.set(userId, { ...(stored.get(userId) ?? NO_PREFERENCES), ...formatsIn(fields) });
    },
  };
  const reader = { rules: async () => rules };
  const getProfile = createGetProfile({ profiles, rules: reader });
  return {
    writes,
    update: createUpdateProfile({ profiles, rules: reader }),
    preferencesOf: async (user: AuthUser = ana) => unwrap(await getProfile({ user })).preferences,
  };
};

describe("UpdateProfile (HU-E1-14)", () => {
  it("changes my time zone, stored by its canonical name", async () => {
    const { writes, update } = world();
    expect(unwrap(await update({ user: ana, timezone: "america/new_york" })).timezone).toBe("America/New_York");
    expect(writes).toEqual([["u-ana", { timezone: "America/New_York" }]]);
  });

  it("refuses an unknown zone and keeps mine", async () => {
    const { writes, update } = world();
    expect(codeOf(await update({ user: ana, timezone: "Bogota" }))).toBe("InvalidTimeZone");
    expect(writes).toEqual([]);
  });

  it("changes nothing without a change, or with the zone and the language I already have", async () => {
    const { writes, update } = world();
    expect(unwrap(await update({ user: ana }))).toEqual(ana);
    expect(unwrap(await update({ user: ana, timezone: "America/Bogota", locale: "es" }))).toEqual(ana);
    expect(writes).toEqual([]);
  });
});

describe("formatting preferences (HU-E1-15)", () => {
  const RULES = BUILT_IN_RULES.defaults;

  it("follow the installation rules without an override, with nothing locked", async () => {
    expect(await world().preferencesOf()).toEqual({
      stored: NO_PREFERENCES,
      effective: RULES,
      defaults: RULES,
      locked: [],
    });
  });

  it("let one person override the time format while the others keep the rule", async () => {
    const { update, preferencesOf } = world();
    unwrap(await update({ user: ana, timeFormat: "H12" }));
    const mine = await preferencesOf();
    expect([mine.stored, mine.effective]).toEqual([
      { ...NO_PREFERENCES, timeFormat: "H12" },
      { ...RULES, timeFormat: "H12" },
    ]);
    expect((await preferencesOf({ ...ana, id: "u-juan", name: "Juan" })).effective.timeFormat).toBe("H24");
  });

  it("stay as they are when the language changes", async () => {
    const { writes, update, preferencesOf } = world();
    unwrap(await update({ user: ana, numberFormat: "COMMA_DOT", timeFormat: "H12" }));
    const english = unwrap(await update({ user: ana, locale: "en" }));
    expect(english.locale).toBe("en");
    expect(writes.at(-1)).toEqual(["u-ana", { locale: "en" }]);
    expect((await preferencesOf(english)).effective).toEqual({ ...RULES, numberFormat: "COMMA_DOT", timeFormat: "H12" });
  });

  it("return to the rule when set to null", async () => {
    const { update, preferencesOf } = world();
    unwrap(await update({ user: ana, timeFormat: "H12" }));
    unwrap(await update({ user: ana, timeFormat: null }));
    const { stored, effective } = await preferencesOf();
    expect([stored.timeFormat, effective.timeFormat]).toEqual([null, "H24"]);
  });

  it("refuse a locked field, even to clear it or to repeat its value, and write nothing (PreferenceLocked)", async () => {
    const { writes, update, preferencesOf } = world({ ...BUILT_IN_RULES, locked: ["dateFormat", "timezone"] });
    const changes: ProfileChange[] = [
      { dateFormat: "MDY" },
      { dateFormat: null },
      { dateFormat: "DMY" },
      { timeFormat: "H12", dateFormat: "MDY" },
      { timezone: "Bogota" },
    ];
    for (const change of changes) {
      expect(codeOf(await update({ user: ana, ...change }))).toBe("PreferenceLocked");
    }
    expect(writes).toEqual([]);
    const { locked, effective } = await preferencesOf();
    expect([locked, effective.dateFormat]).toEqual([["dateFormat", "timezone"], "DMY"]);
  });
});
```

Run: `pnpm exec vitest run --project unit src/modules/identity/application/profile.test.ts`
Expected: FAIL — `createGetProfile is not a function`, and `UpdateProfile` calls `setTimeZone` instead of `saveProfile`.

- [ ] **Step 7: Write the port, the use cases and the binding**

Create `src/modules/identity/application/installation-rules.ts`:

```ts
import type { InstallationRules } from "../domain/preferences";

/**
 * HU-E1-15: where the installation's defaults and locks come from. `BuiltInInstallationRules` answers es-CO's formats
 * and no lock; HU-E8-18 binds an adapter of the stored rules in the composition root, and nothing else changes.
 */
export interface InstallationRulesReader {
  rules(): Promise<InstallationRules>;
}
```

Create `src/modules/identity/infrastructure/built-in-installation-rules.ts`:

```ts
import type { InstallationRulesReader } from "../application/installation-rules";
import { BUILT_IN_RULES, type InstallationRules } from "../domain/preferences";

/** HU-E1-15: the rules before HU-E8-18 stores them: es-CO's formats, nothing locked. */
export class BuiltInInstallationRules implements InstallationRulesReader {
  rules(): Promise<InstallationRules> {
    return Promise.resolve(BUILT_IN_RULES);
  }
}
```

Replace the contents of `src/modules/identity/application/profile.ts`:

```ts
import { domainError, err, ok, parseTimeZone, type AuthUser, type Result } from "@/shared/kernel";
import {
  effectivePreferences,
  formatsIn,
  lockedFieldsIn,
  type FormatPreferences,
  type LockableField,
  type ProfileChange,
  type StoredPreferences,
} from "../domain/preferences";
import type { InstallationRulesReader } from "./installation-rules";

/** HU-E1-14, HU-E1-15: where a user's own settings live (the provider's `user` row). */
export interface UserProfiles {
  setTimeZone(userId: string, timeZone: string): Promise<void>;
  /** HU-E1-15: the four formats as stored; null follows the installation rule. */
  preferencesOf(userId: string): Promise<StoredPreferences>;
  /** HU-E1-15: writes the fields present, in one go; a null format returns to the rule. */
  saveProfile(userId: string, fields: ProfileChange): Promise<void>;
}

/** HU-E1-15: the profile that `GET` and `PATCH /api/v1/me` answer. */
export interface ProfileView {
  readonly user: AuthUser;
  readonly preferences: {
    readonly stored: StoredPreferences;
    readonly effective: FormatPreferences;
    readonly defaults: FormatPreferences;
    readonly locked: readonly LockableField[];
  };
}

export type GetProfile = (input: { readonly user: AuthUser }) => Promise<Result<ProfileView>>;

/** HU-E1-15: the stored formats, the rules' defaults and locks, and what applies; never derived from `locale` (D23). */
export const createGetProfile =
  (deps: {
    readonly profiles: Pick<UserProfiles, "preferencesOf">;
    readonly rules: InstallationRulesReader;
  }): GetProfile =>
  async ({ user }) => {
    const [stored, rules] = await Promise.all([deps.profiles.preferencesOf(user.id), deps.rules.rules()]);
    return ok({
      user,
      preferences: {
        stored,
        effective: effectivePreferences(stored, rules),
        defaults: rules.defaults,
        locked: rules.locked,
      },
    });
  };

export type UpdateProfile = (input: { readonly user: AuthUser } & ProfileChange) => Promise<Result<AuthUser>>;

/**
 * HU-E1-14, HU-E1-15: the signed-in user changes their own zone, language and formats. A change that names a locked
 * field is PreferenceLocked, even to clear it or to repeat its value; then an unknown zone is InvalidTimeZone. Nothing
 * is written unless the whole change passes, and a zone or a language equal to the current one is not written.
 */
export const createUpdateProfile =
  (deps: {
    readonly profiles: Pick<UserProfiles, "saveProfile">;
    readonly rules: InstallationRulesReader;
  }): UpdateProfile =>
  async ({ user, ...change }) => {
    // The check lives here, never only in the handler (HU-E1-15).
    const locked = lockedFieldsIn(change, await deps.rules.rules());
    if (locked.length > 0) return err(domainError("PreferenceLocked", { fields: locked }));
    const zone = change.timezone === undefined ? ok(user.timezone) : parseTimeZone(change.timezone);
    if (!zone.ok) return zone;
    const locale = change.locale ?? user.locale;
    const fields: ProfileChange = {
      ...(zone.value === user.timezone ? {} : { timezone: zone.value }),
      ...(locale === user.locale ? {} : { locale: change.locale }),
      ...formatsIn(change),
    };
    if (Object.keys(fields).length > 0) await deps.profiles.saveProfile(user.id, fields);
    return ok({ ...user, timezone: zone.value, locale });
  };
```

In `src/modules/identity/application/sign-up.ts` (Task 3's), replace the line `  readonly profiles: UserProfiles;` with:

```ts
  readonly profiles: Pick<UserProfiles, "setTimeZone">;
```

In `src/modules/identity/application/index.ts`, replace the line `export { createUpdateProfile, type UpdateProfile, type UserProfiles } from "./profile";` (Task 3's) with:

```ts
export {
  createGetProfile,
  createUpdateProfile,
  type GetProfile,
  type ProfileView,
  type UpdateProfile,
  type UserProfiles,
} from "./profile";
export type { InstallationRulesReader } from "./installation-rules";
export {
  BUILT_IN_RULES,
  DATE_FORMATS,
  LOCALES,
  LOCKABLE_FIELDS,
  NUMBER_FORMATS,
  TIME_FORMATS,
  WEEK_STARTS,
  type FormatPreferences,
  type InstallationRules,
  type LockableField,
  type ProfileChange,
  type StoredPreferences,
} from "../domain/preferences";
```

In `src/composition/container.ts`:
1. Insert before the line `  createSignIn,`: `  createGetProfile,`; insert before the line `  type SignIn,` the two lines `  type GetProfile,` and `  type InstallationRulesReader,`.
2. Insert after the line `import { BetterAuthProvider } from "@/modules/identity/infrastructure/better-auth-provider";`:

```ts
import { BuiltInInstallationRules } from "@/modules/identity/infrastructure/built-in-installation-rules";
```

3. Insert after the line `  readonly clock?: Clock;` (inside `ContainerOptions`):

```ts
  /** Test seam: the installation's defaults and locks (HU-E1-15); the built-in es-CO rules until HU-E8-18. */
  readonly installationRules?: InstallationRulesReader;
```

4. Insert after the line `    readonly updateProfile: UpdateProfile;` (Task 3's `identity` block of `Container`):

```ts
    readonly getProfile: GetProfile;
```

5. Insert after the line `  const profiles = new DrizzleUserProfiles(tm, env.APP_TIMEZONE);` (Task 3's):

```ts
  // HU-E1-15: the installation's defaults and locks; HU-E8-18 binds its stored rules here.
  const installationRules = options.installationRules ?? new BuiltInInstallationRules();
```

6. Replace the line `      updateProfile: createUpdateProfile({ profiles }),` (Task 3's) with:

```ts
      updateProfile: createUpdateProfile({ profiles, rules: installationRules }),
      getProfile: createGetProfile({ profiles, rules: installationRules }),
```

Run: `pnpm exec vitest run --project unit src/modules/identity` and `pnpm exec tsc --noEmit`
Expected: PASS (5 + 8 new, and Task 3's sign-up tests unchanged); `tsc` reports nothing: `PATCH /api/v1/me` still passes only `timezone` and answers the `AuthUser`, until Task 18b.

- [ ] **Step 7b: Mutation check (ruling P88)**

In `lockedFieldsIn` (`src/modules/identity/domain/preferences.ts`), change `change[field] !== undefined` to `change[field] != null` and run `pnpm exec vitest run --project unit src/modules/identity`.
Expected: FAIL — 2 identity unit tests fail (a locked field sent as `null` no longer answers `PreferenceLocked`). Revert the change and run it again: PASS.

- [ ] **Step 8: Run the gates, then commit**

```bash
git add src/modules/identity src/composition/container.ts drizzle/0018_user_preferences.sql drizzle/meta
git commit -m "feat(identity): keep each user's formatting preferences and resolve them against the installation rules (Refs #109)"
```

---

### Task 18b-1: HTTP — the formatting preferences in the answer of `GET /api/v1/me`

Exposes Task 18a: `GET /api/v1/me` and `PATCH /api/v1/me` answer the profile with `preferences` (`stored`, `effective`, `defaults`, `locked`), and `PATCH` also takes `locale` and the four formats (ruling P65).

Task 18b lands as two commits, each its own RDD pass (ruling P87): Task 18b-1 the answers, Task 18b-2 the changes. The Decisions and the Interfaces below cover both.

Decisions:
- The answer keeps the user's fields (`id`, `name`, `email`, `locale`, `timezone`) where they are and adds `preferences`, inline: no new component. Sign-up and sign-in keep answering `MeResponseSchema` without `preferences`, because they never read the profile.
- The `PATCH` body takes `locale` (`es` | `en`, never null) and the four formats as top-level fields beside `timezone`, each an enum of its list and nullable: an omitted field is unchanged, a value sets it, `null` returns it to the rule (ruling P71). An unknown value, a null `locale` or a null `timezone` is `422 ValidationFailed` before any use case runs, and nothing is stored.
- `PATCH` runs `UpdateProfile`, then `GetProfile` for its answer, so the answer shows what applies after the change.
- `PreferenceLocked` maps explicitly to 409 in `src/shared/http/problem.ts`: the naming convention already gives 409, and the story asks for the entry so that no later convention moves it. Its `details.fields` stay in the log (ruling P72). The locked scenario runs against a fake `InstallationRulesReader` through `ContainerOptions.installationRules` until HU-E8-18 stores locks.
- Formatting stays a client concern: amounts, dates and instants keep their wire forms whatever the preferences (HU-E0-09).
- Size (ruling P87): two commits, each failing first, regenerating the snapshot for its own contract change and green on its own. Task 18b-1 is the answers (`ProfileResponseSchema`, `meDto`, the `GET` route, `routes.test.ts` and the first scenario), measured ~280 (snapshot +182/−1); Task 18b-2 is the changes (the `PATCH` body, route and answer, the `PreferenceLocked` entry, the backlog note and the other scenarios), measured ~370 (snapshot +258/−2).

**Files:**
- Modify: `src/modules/identity/contracts/me.contract.ts`, `src/app/api/v1/me/route.ts`, `src/app/api/v1/routes.test.ts`, `openapi/openapi.snapshot.json`
- Create: `tests/acceptance/formatting-preferences.test.ts`

**Interfaces (Tasks 18b-1 and 18b-2):**
- Consumes: Task 18a's `GetProfile`, `ProfileView`, `UpdateProfile` with `ProfileChange`, the lists of `preferences.ts`, `BUILT_IN_RULES` and `InstallationRules` (all through `src/modules/identity/application/index.ts`), `ContainerOptions.installationRules`; Task 3's `MeResponseSchema`, `UpdateMeBodySchema`, `mePaths` and the `/me` route; `call`, `problemOf`, `registerUser`, `startTestApp`, `TestUser` (`tests/support/app.ts`).
- Produces: `ProfileResponseSchema` (`MeResponseSchema` plus `preferences`), `meDto(profile: ProfileView)`; `UpdateMeBodySchema` gains `locale`, `numberFormat`, `timeFormat`, `dateFormat`, `weekStart`; `PATCH /api/v1/me` gains a 409 response.

- [ ] **Step 1: Write the failing tests**

In `src/app/api/v1/routes.test.ts`:

1. Replace the line `import type { AuthUser } from "@/shared/kernel";` with `import { ok, type AuthUser } from "@/shared/kernel";`.
2. Insert before the line `const use = (resolve: (h: Headers) => Promise<AuthUser | null>) =>`:

```ts
const RULES = { numberFormat: "DOT_COMMA", timeFormat: "H24", dateFormat: "DMY", weekStart: "MONDAY" };
const PREFERENCES = {
  stored: { numberFormat: null, timeFormat: null, dateFormat: null, weekStart: null },
  effective: RULES,
  defaults: RULES,
  locked: [],
};
```

3. Replace the line `  setContainerForTests({ sessionResolver: { resolve }, logger: jsonLogger } as Container);` with:

```ts
  setContainerForTests({
    sessionResolver: { resolve },
    logger: jsonLogger,
    // HU-E1-15: GET /me answers the profile query; here with no stored format and the built-in rules.
    identity: { getProfile: async ({ user }: { user: AuthUser }) => ok({ user, preferences: PREFERENCES }) },
  } as unknown as Container);
```

4. Replace the line `    expect(await response.json()).toEqual(ana);` with `    expect(await response.json()).toEqual({ ...ana, preferences: PREFERENCES });`.

Create `tests/acceptance/formatting-preferences.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getMe } from "@/app/api/v1/me/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type TestUser } from "../support/app";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface Formats {
  numberFormat: string;
  timeFormat: string;
  dateFormat: string;
  weekStart: string;
}
interface Me {
  locale: string;
  timezone: string;
  preferences: { stored: Record<keyof Formats, string | null>; effective: Formats; defaults: Formats; locked: string[] };
}
const RULES = { numberFormat: "DOT_COMMA", timeFormat: "H24", dateFormat: "DMY", weekStart: "MONDAY" };
const NONE = { numberFormat: null, timeFormat: null, dateFormat: null, weekStart: null };
const me = async (user: TestUser) => (await (await call(getMe, "GET", "/api/v1/me", { user })).json()) as Me;

describe("formatting preferences (HU-E1-15)", () => {
  it("follow the installation rules without an override, with nothing locked", async () => {
    const ana = await registerUser("Ana");
    expect(await me(ana)).toMatchObject({
      locale: "es",
      preferences: { stored: NONE, effective: RULES, defaults: RULES, locked: [] },
    });
  });
});
```

Run: `pnpm exec vitest run --project unit src/app/api/v1/routes.test.ts` and `pnpm exec vitest run --project acceptance tests/acceptance/formatting-preferences.test.ts`
Expected: FAIL — `GET /me` answers no `preferences` (`routes.test.ts` and the scenario).

- [ ] **Step 2: Answer the profile on `GET`**

Replace the contents of `src/modules/identity/contracts/me.contract.ts` (Task 3's body and `PATCH` answer are kept until Task 18b-2):

```ts
import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { problemContent } from "@/shared/http/contracts";
import {
  DATE_FORMATS,
  LOCKABLE_FIELDS,
  NUMBER_FORMATS,
  TIME_FORMATS,
  WEEK_STARTS,
  type ProfileView,
} from "../application";

export const MeResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  locale: z.string(),
  /** HU-E1-14: the user's IANA time zone. */
  timezone: z.string(),
});

const NumberFormat = z.enum(NUMBER_FORMATS);
const TimeFormat = z.enum(TIME_FORMATS);
const DateFormat = z.enum(DATE_FORMATS);
const WeekStart = z.enum(WEEK_STARTS);
const Formats = z.object({ numberFormat: NumberFormat, timeFormat: TimeFormat, dateFormat: DateFormat, weekStart: WeekStart });

/** HU-E1-15: the user, with the formats as stored (null follows the rule), as they apply, the rules' defaults and locks. */
export const ProfileResponseSchema = MeResponseSchema.extend({
  preferences: z.object({
    stored: z.object({
      numberFormat: NumberFormat.nullable(),
      timeFormat: TimeFormat.nullable(),
      dateFormat: DateFormat.nullable(),
      weekStart: WeekStart.nullable(),
    }),
    effective: Formats,
    defaults: Formats,
    locked: z.array(z.enum(LOCKABLE_FIELDS)),
  }),
});

/** HU-E1-14: the profile fields a user changes; validity of the zone is checked by the use case. */
export const UpdateMeBodySchema = z.object({ timezone: z.string().min(1).max(64).optional() });

/** HU-E1-15: the profile as `GET /api/v1/me` answers it (and `PATCH` from Task 18b-2). */
export const meDto = (profile: ProfileView) => ({ ...profile.user, preferences: profile.preferences });

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }];
const user = (description: string) => ({ description, content: { "application/json": { schema: MeResponseSchema } } });
const profile = (description: string) => ({
  description,
  content: { "application/json": { schema: ProfileResponseSchema } },
});

export const mePaths: ZodOpenApiPathsObject = {
  "/api/v1/me": {
    get: {
      operationId: "getMe",
      summary: "The signed-in user",
      security,
      responses: {
        "200": profile("Current user"),
        "401": { description: "Not signed in", content: problemContent },
      },
    },
    patch: {
      operationId: "updateMe",
      summary: "Change the signed-in user's time zone (HU-E1-14)",
      security,
      requestBody: { content: { "application/json": { schema: UpdateMeBodySchema } } },
      responses: {
        "200": user("The updated user"),
        "401": { description: "Not signed in", content: problemContent },
        "422": { description: "ValidationFailed, InvalidTimeZone", content: problemContent },
      },
    },
  },
};
```

In `src/app/api/v1/me/route.ts` (Task 3's file), replace the line `import { UpdateMeBodySchema } from "@/modules/identity/contracts/me.contract";` with `import { meDto, UpdateMeBodySchema } from "@/modules/identity/contracts/me.contract";` and the line `  handler: async ({ user }) => ok({ status: 200, body: user }),` (inside `GET`) with:

```ts
  handler: async ({ user }) => {
    // HU-E1-15: the user with their formatting preferences, as they apply.
    const profile = await getContainer().identity.getProfile({ user: user! });
    return profile.ok ? ok({ status: 200, body: meDto(profile.value) }) : profile;
  },
```

Regenerate the snapshot: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts`. Expected diff (measured +182/−1): the `getMe` answer gains the inline `preferences` object; `updateMe` is unchanged; no new component and no `…Output` variant.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/app/api/v1/routes.test.ts src/composition/openapi.test.ts` and `pnpm exec vitest run --project acceptance tests/acceptance/formatting-preferences.test.ts tests/acceptance/time-zone.test.ts tests/acceptance/auth.test.ts`
Expected: PASS (`time-zone.test.ts` and `auth.test.ts` read `timezone` and `id` by field, so `preferences` changes neither).

- [ ] **Step 4: Run the gates, then commit**

This half is green on its own: its snapshot holds only the `GET` answer, and every gate passes before Task 18b-2 starts.

```bash
git add src/modules/identity/contracts/me.contract.ts src/app/api/v1/me/route.ts src/app/api/v1/routes.test.ts tests/acceptance/formatting-preferences.test.ts openapi/openapi.snapshot.json
git commit -m "feat(identity): answer GET /me with the user's formatting preferences (Refs #109)"
```

---

### Task 18b-2: HTTP — change the formats and the language with `PATCH /api/v1/me`

Continues Task 18b-1 (Decisions and Interfaces there): the `PATCH` body takes `locale` and the four formats, its answer is the profile with `preferences`, and `PreferenceLocked` gets its explicit 409.

**Files:**
- Modify: `src/modules/identity/contracts/me.contract.ts`, `src/app/api/v1/me/route.ts`, `src/shared/http/problem.ts`, `src/shared/http/problem.test.ts`, `tests/acceptance/formatting-preferences.test.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E1-identity-and-spaces.md`

- [ ] **Step 1: Write the failing tests**

Append to the end of `src/shared/http/problem.test.ts`:

```ts

describe("statusForCode (HU-E1-15)", () => {
  it("maps PreferenceLocked to 409", () => {
    expect(statusForCode("PreferenceLocked")).toBe(409);
  });
});
```

Replace the contents of `tests/acceptance/formatting-preferences.test.ts` (Task 18b-1's helpers and first scenario, plus the `PATCH` helper, the fake rules and the other scenarios):

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getMe, PATCH as patchMe } from "@/app/api/v1/me/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { BUILT_IN_RULES, type InstallationRules } from "@/modules/identity/application";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";

// HU-E1-15 Background: the built-in rules (DOT_COMMA, H24, DMY, MONDAY); the locked scenario swaps them for its run.
let rules: InstallationRules = BUILT_IN_RULES;
let app: Container;
beforeAll(() => {
  app = startTestApp({ installationRules: { rules: async () => rules } });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface Formats {
  numberFormat: string;
  timeFormat: string;
  dateFormat: string;
  weekStart: string;
}
interface Me {
  locale: string;
  timezone: string;
  preferences: { stored: Record<keyof Formats, string | null>; effective: Formats; defaults: Formats; locked: string[] };
}
const RULES = { numberFormat: "DOT_COMMA", timeFormat: "H24", dateFormat: "DMY", weekStart: "MONDAY" };
const NONE = { numberFormat: null, timeFormat: null, dateFormat: null, weekStart: null };
const me = async (user: TestUser) => (await (await call(getMe, "GET", "/api/v1/me", { user })).json()) as Me;
const patch = (user: TestUser, body: Record<string, unknown>) => call(patchMe, "PATCH", "/api/v1/me", { user, body });

describe("formatting preferences (HU-E1-15)", () => {
  it("follow the installation rules without an override, with nothing locked", async () => {
    const ana = await registerUser("Ana");
    expect(await me(ana)).toMatchObject({
      locale: "es",
      preferences: { stored: NONE, effective: RULES, defaults: RULES, locked: [] },
    });
  });

  it("let one person override the time format while the others keep the rule", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const changed = await patch(ana, { timeFormat: "H12" });
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as Me).preferences.effective.timeFormat).toBe("H12");
    const { stored, effective } = (await me(ana)).preferences;
    expect([stored, effective]).toEqual([
      { ...NONE, timeFormat: "H12" },
      { ...RULES, timeFormat: "H12" },
    ]);
    expect((await me(juan)).preferences.effective.timeFormat).toBe("H24");
  });

  it("stay as they are when the language changes", async () => {
    const ana = await registerUser("Ana");
    expect((await patch(ana, { numberFormat: "COMMA_DOT", timeFormat: "H12" })).status).toBe(200);
    const english = (await (await patch(ana, { locale: "en" })).json()) as Me;
    expect([english.locale, english.preferences.effective]).toEqual([
      "en",
      { ...RULES, numberFormat: "COMMA_DOT", timeFormat: "H12" },
    ]);
    expect((await me(ana)).locale).toBe("en");
  });

  it("return to the rule when set to null", async () => {
    const ana = await registerUser("Ana");
    expect((await patch(ana, { timeFormat: "H12" })).status).toBe(200);
    expect((await patch(ana, { timeFormat: null })).status).toBe(200);
    const { stored, effective } = (await me(ana)).preferences;
    expect([stored.timeFormat, effective.timeFormat]).toEqual([null, "H24"]);
  });

  it("refuse a locked preference with 409 PreferenceLocked and show the lock", async () => {
    const ana = await registerUser("Ana");
    rules = { ...BUILT_IN_RULES, locked: ["dateFormat"] };
    try {
      expect(await problemOf(await patch(ana, { dateFormat: "MDY" }))).toEqual([409, "PreferenceLocked"]);
      const { locked, effective } = (await me(ana)).preferences;
      expect([locked, effective.dateFormat]).toEqual([["dateFormat"], "DMY"]);
    } finally {
      rules = BUILT_IN_RULES;
    }
  });

  it("refuse an unknown value with 422 ValidationFailed and keep what is stored", async () => {
    const ana = await registerUser("Ana");
    expect(await problemOf(await patch(ana, { numberFormat: "DOT_DOT" }))).toEqual([422, "ValidationFailed"]);
    expect(await problemOf(await patch(ana, { locale: "fr" }))).toEqual([422, "ValidationFailed"]);
    expect(await me(ana)).toMatchObject({ locale: "es", preferences: { stored: NONE } });
  });
});
```

Run: `pnpm exec vitest run --project unit src/shared/http/problem.test.ts` and `pnpm exec vitest run --project acceptance tests/acceptance/formatting-preferences.test.ts`
Expected: FAIL — the `PATCH` body strips the formats and `locale` (Zod drops unknown keys), so nothing is stored, refused or locked, and the `PATCH` answer has no `preferences`; the first scenario passes (Task 18b-1). `PreferenceLocked` already answers 409 by the convention, so its unit test passes before the entry exists (it pins the explicit entry).

- [ ] **Step 2: Extend the `PATCH` contract, the route and the problem map**

Replace the contents of `src/modules/identity/contracts/me.contract.ts`:

```ts
import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { problemContent } from "@/shared/http/contracts";
import {
  DATE_FORMATS,
  LOCALES,
  LOCKABLE_FIELDS,
  NUMBER_FORMATS,
  TIME_FORMATS,
  WEEK_STARTS,
  type ProfileView,
} from "../application";

export const MeResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  locale: z.string(),
  /** HU-E1-14: the user's IANA time zone. */
  timezone: z.string(),
});

const NumberFormat = z.enum(NUMBER_FORMATS);
const TimeFormat = z.enum(TIME_FORMATS);
const DateFormat = z.enum(DATE_FORMATS);
const WeekStart = z.enum(WEEK_STARTS);
const Formats = z.object({ numberFormat: NumberFormat, timeFormat: TimeFormat, dateFormat: DateFormat, weekStart: WeekStart });

/** HU-E1-15: the user, with the formats as stored (null follows the rule), as they apply, the rules' defaults and locks. */
export const ProfileResponseSchema = MeResponseSchema.extend({
  preferences: z.object({
    stored: z.object({
      numberFormat: NumberFormat.nullable(),
      timeFormat: TimeFormat.nullable(),
      dateFormat: DateFormat.nullable(),
      weekStart: WeekStart.nullable(),
    }),
    effective: Formats,
    defaults: Formats,
    locked: z.array(z.enum(LOCKABLE_FIELDS)),
  }),
});

/**
 * HU-E1-14, HU-E1-15: the profile fields a user changes. An omitted field is unchanged and `null` returns a format to
 * the installation rule; the zone's validity and the locks are the use case's.
 */
export const UpdateMeBodySchema = z.object({
  timezone: z.string().min(1).max(64).optional(),
  locale: z.enum(LOCALES).optional(),
  numberFormat: NumberFormat.nullable().optional(),
  timeFormat: TimeFormat.nullable().optional(),
  dateFormat: DateFormat.nullable().optional(),
  weekStart: WeekStart.nullable().optional(),
});

/** HU-E1-15: the profile as `GET` and `PATCH /api/v1/me` answer it. */
export const meDto = (profile: ProfileView) => ({ ...profile.user, preferences: profile.preferences });

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }];
const profile = (description: string) => ({
  description,
  content: { "application/json": { schema: ProfileResponseSchema } },
});

export const mePaths: ZodOpenApiPathsObject = {
  "/api/v1/me": {
    get: {
      operationId: "getMe",
      summary: "The signed-in user",
      security,
      responses: {
        "200": profile("Current user"),
        "401": { description: "Not signed in", content: problemContent },
      },
    },
    patch: {
      operationId: "updateMe",
      summary: "Change the signed-in user's time zone, language and formats (HU-E1-14, HU-E1-15)",
      security,
      requestBody: { content: { "application/json": { schema: UpdateMeBodySchema } } },
      responses: {
        "200": profile("The updated user"),
        "401": { description: "Not signed in", content: problemContent },
        "409": { description: "PreferenceLocked", content: problemContent },
        "422": { description: "ValidationFailed, InvalidTimeZone", content: problemContent },
      },
    },
  },
};
```

Replace the contents of `src/app/api/v1/me/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { meDto, UpdateMeBodySchema } from "@/modules/identity/contracts/me.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user }) => {
    // HU-E1-15: the user with their formatting preferences, as they apply.
    const profile = await getContainer().identity.getProfile({ user: user! });
    return profile.ok ? ok({ status: 200, body: meDto(profile.value) }) : profile;
  },
});

export const PATCH = defineRoute({
  auth: "required",
  body: UpdateMeBodySchema,
  handler: async ({ user, body }) => {
    const { identity } = getContainer();
    const updated = await identity.updateProfile({ user: user!, ...body });
    if (!updated.ok) return updated;
    // HU-E1-15: the answer shows what applies after the change.
    const profile = await identity.getProfile({ user: updated.value });
    return profile.ok ? ok({ status: 200, body: meDto(profile.value) }) : profile;
  },
});
```

In `src/shared/http/problem.ts`, insert after the line `  ["EmailTaken", 409],`:

```ts
  // HU-E1-15: the installation rules lock the field; explicit, as the story asks.
  ["PreferenceLocked", 409],
```

In `docs/backlog/E1-identity-and-spaces.md`, insert before the line that starts with `- **Spec impact:** section 3 (the primary locale es-CO becomes the built-in default`:

```markdown
- Errors (catalogue, spec 8): `PreferenceLocked` (409, explicit) from `PATCH /api/v1/me`; an unknown format or language is `ValidationFailed` (422) (M3-D Task 18b).
```

Regenerate the snapshot: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts`. Expected diff (measured +258/−2): the `updateMe` answer gains the inline `preferences` object, the `updateMe` body gains `locale` and the four nullable formats, and `updateMe` gains a 409 response and its new summary; no new component and no `…Output` variant.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/shared/http src/app/api/v1/routes.test.ts src/composition/openapi.test.ts` and `pnpm exec vitest run --project acceptance tests/acceptance/formatting-preferences.test.ts tests/acceptance/time-zone.test.ts tests/acceptance/auth.test.ts`
Expected: PASS (`time-zone.test.ts` and `auth.test.ts` read `timezone` and `id` by field, so `preferences` changes neither).

- [ ] **Step 4: Run the gates, then commit**

This half is green on its own: its snapshot adds only the `PATCH` changes to Task 18b-1's.

```bash
git add src/modules/identity/contracts/me.contract.ts src/app/api/v1/me/route.ts src/shared/http tests/acceptance/formatting-preferences.test.ts openapi/openapi.snapshot.json docs/backlog/E1-identity-and-spaces.md
git commit -m "feat(identity): change formatting preferences and the language with PATCH /me, refusing locked ones (Refs #109)"
```

---

## Self-Review

### Story coverage

| Story | Scenario or technical note | Domain / application test | PostgreSQL / HTTP test |
|---|---|---|---|
| HU-E1-14 | Sign-up takes the browser's zone; without a usable one APP_TIMEZONE applies | Task 3 (`SignUp time zone`) | Task 3 (`time-zone.test.ts`) |
| | Change my zone; an unknown zone is `InvalidTimeZone` and changes nothing | Tasks 2, 3 (`UpdateProfile`) | Task 3 |
| | Changing the zone never moves recorded transactions | Task 4 (`retimed` keeps stored zones) | Task 7b ("a zone change moves nothing") |
| | Notes: `PATCH /api/v1/me`; canonical names; Better Auth default from APP_TIMEZONE; consumers (default time, current period) | Tasks 2, 3, 6 (current period per zone) | Task 3 (`drizzle-user-profiles.int.test.ts`) |
| HU-E1-15 | Without an override the installation rules apply; every stored preference is null; nothing is locked | Task 18a (`preferences.test.ts`: `BUILT_IN_RULES`; `profile.test.ts`) | Task 18b (`formatting-preferences.test.ts`, `routes.test.ts`) |
| | A person overrides the time format; the others still follow the rules | Task 18a (`profile.test.ts`) | Tasks 18a (`drizzle-user-profiles.int.test.ts`: only the named fields change), 18b |
| | The language does not change the formats | Task 18a (`profile.test.ts`: `locale` written alone, effective unchanged) | Task 18b |
| | Reset a preference to the default with null | Tasks 18a (`formatsIn`, `profile.test.ts`) | Tasks 18a (null clears a column), 18b |
| | A locked preference is `PreferenceLocked` (409), even to clear it or to repeat its value; `locked` lists it and the rule applies | Task 18a (`lockedFieldsIn`, `effectivePreferences` before and after a lock; `profile.test.ts` with a fake `InstallationRulesReader`) | Task 18b (a fake reader through `ContainerOptions.installationRules`) |
| | An unknown value is `ValidationFailed` and changes nothing | — (the contract's enums) | Tasks 18a (the four `user_*` checks), 18b (`"DOT_DOT"`, `"fr"`) |
| | Notes: `locale` on `PATCH`; `preferences {stored, effective, defaults, locked}`; built-in es-CO rules behind `InstallationRulesReader`; locks on `timezone` and `locale` honoured; formats never change the wire forms | Task 18a (a locked `timezone`) | Task 18b (`openapi` snapshot; `time-zone.test.ts` and `auth.test.ts` unchanged) |
| HU-E4-14 | Record an expense with its time (@critical) | Tasks 4, 6 | Task 7a |
| | Without a date or a time, now in each user's zone | Tasks 4, 6 (`whenOf`) | Task 7a (Bogotá and Madrid users) |
| | A date alone takes the current time of day; a disagreeing pair is `DateTimeMismatch`; `occurredAt: null` is `TimeRequired` | Tasks 4 (Bogotá, Madrid, today, Madrid's skipped 02:30), 6 (`whenOf`, `RecordExpense`) | Task 7a |
| | Newest day, then newest time, untimed last | Task 5b (twin) | Task 5b (PostgreSQL keyset), Task 7b (over HTTP, page by page, Rent untimed as the scheduler leaves it) |
| | Editing keeps the local time, audited; a time is replaced or added, never removed (`TimeRequired`); a migrated row gets its first time | Tasks 4, 5a (audit, `reviseTransaction` guard), 6 ("Old market" in the editor's zone) | Tasks 5a (a row's first time in PostgreSQL), 7b |
| | The period follows the local date, whatever happens later | Task 4 (23:30 on 10-31) | Task 7b |
| | Notes: every type takes a time; the recorder's zone; AUTO and confirmed occurrences untimed; existing rows null; ordering and cursor; `TimeRequired` explicit 422 | Tasks 5a, 6 (incomes, transfers; `record-occurrence.test.ts`) | Tasks 5a (round-trip, check), 7a (fund contributions, settlements, `TimeRequired` 422), 7b (M3-C's Rent occurrence, old cursor) |
| HU-E3-02 (amended) | A fourth level is not allowed | Task 8 | Task 9b (and M1's third-level test, still green) |
| HU-E3-04 | Create subcategories under a category | Tasks 8, 9a | Task 9b |
| | Choosing a subcategory is never required | Task 11 (filter) | Task 11 |
| | Budget lines count subcategories in their category's line; `BY_ALLOCATION` for Meat; `SubcategoryNotMappable` | Task 10 (`mappings.test.ts`, roll-up) | Task 11 (reference plan, activated) |
| | Lists and reports roll subcategories up | Tasks 10, 11 | Task 11 (filter with totals); the unified view is M4 (HU-E7-04) |
| | A fourth level, and moving a category with subcategories under another | Tasks 8, 9a | Task 9b |
| | Archiving a category archives its subcategories; `CategoryArchived`; `ParentCategoryArchived` | Tasks 8, 9a | Task 9b |
| | Notes: `parentCategoryId`, group follows parent, siblings' names, exactly one of `groupId`/`parentCategoryId`, `CategoryInUse`, no seeded subcategories, copies unchanged | Tasks 8, 9a, 10 (`mappable`) | Tasks 9a (index, round-trip), 9b |
| HU-E2-05 | Create a wallet with its common attributes; defaults; the new types are personal; only four digits; attributes change, the type never | Task 12 | Tasks 12 (round-trip, `accounts_last_four`), 13 |
| HU-E2-06 | Card terms with available credit and E.A. rate; a CDT with its start date; loan terms with M.V. rate | Tasks 14, 15a | Task 15b |
| | Attributes of another type are rejected; the outline of invalid terms | Task 14 | Task 15b |
| | Billing days clamp to short months; today in the user's zone | Tasks 14, 15a | — (fixed-clock unit tests; the acceptance container runs on the system clock) |
| HU-E2-07 | Totals with the default switches (@critical); switching; card payment as a transfer; archived accounts; a shared space's fund | Task 16 (domain) | Task 16 (`account-totals.test.ts`, `asOf`, VIEWER, `archived=true`) |
| HU-E3-05 | Seeded and new categories start with a default icon and color; every seeded category has its group's color; a new one copies its group's | Task 17a (`default-catalog.test.ts` table, `category.test.ts`, `category-styles.test.ts`) | Task 17a (`drizzle-category-repository.int.test.ts`; existing rows in `category-styles-backfill.int.test.ts`), Task 17b (`category-styles.test.ts`) |
| | Change the icon and color of a category; the group keeps its own; a VIEWER gets `InsufficientRole` | Task 17a (`category-styles.test.ts`) | Task 17b |
| | Choose an emoji as the icon; a symbol replaces it again | Task 17a (`category-style.test.ts`, `category-styles.test.ts`) | Task 17b |
| | Invalid icons, emojis and colors are rejected (`InvalidCategoryIcon`, `ValidationFailed`) and change nothing | Task 17a (`category-style.test.ts`: unicorn, two emojis, a letter, a keycap, 34 code units) | Task 17b (also an unknown `kind`) |
| | Subcategories show their parent's icon and color; one of their own is `ValidationFailed` | Task 17a (`shownStyle`, `ownStyle`, `ListCategories`) | Task 17a (`categories_style_by_level`), Task 17b |
| | A subcategory that becomes a category keeps a copy of its parent's style | Task 17a (`reviseCategory`, `UpdateCategory`) | Task 17b |
| | Notes: the fixed symbol set of 58 names; one emoji grapheme (ZWJ sequences, skin tones, flags); sixteen palette keys, never hex; seeded defaults by catalog key; group endpoints; `GET` on every node | Task 17a | Task 17a (round-trip, back-fill and its drift guard), Task 17b (group endpoints, `openapi.test.ts`) |
| | Notes: a seeded group has an immutable catalog `key` (`housing` … `income`), a group users create none, at most one per key and space, never changed by a rename; the migration back-fills it by the seeded categories a group holds, then by its exact es or en name; `GET` returns it and no body takes it | Task 17a (`default-catalog.test.ts`, `category.test.ts`, `category-styles.test.ts`) | Task 17a (`drizzle-category-repository.int.test.ts`; `category-styles-backfill.int.test.ts` and its drift guard), Task 17b (`category-styles.test.ts`, `openapi.test.ts`) |

No scenario of the eight stories is left without a test, except HU-E3-04's unified-view assertion, which its own note defers to HU-E7-04 (M4).

### Review Focus pins

| Review Focus | Pinned by |
|---|---|
| 1. Instants near midnight and across zones and clock changes | Task 2 (`instantAt` on 2026-03-29 and 2026-10-25 in Madrid, 00:30 and 10:00 next to the change); Task 4 (23:30 on 10-31 in Bogotá, a Madrid expense moved onto 2026-03-29, a date alone for a past day in Bogotá and Madrid and for Madrid's skipped 02:30, `DateTimeMismatch`, `TimeRequired`); Task 6 (Bogotá and Madrid recorders at one instant; a date alone in the sent zone; the current period at 2026-11-01T04:30Z); Task 7a (a date alone and `TimeRequired` over HTTP); Task 7b (a zone change moves nothing) |
| 2. Paging through a day that mixes timed and untimed items | Task 5b (limit 1 through Lunch, Market, Rent, Taxi against PostgreSQL, compared with the twin; 120 rows sharing a creation instant; `InvalidCursor` for an old, an impossible and a malformed cursor); Task 7b (the same day over HTTP with `limit=1`, an old cursor answers 422) |
| 3. A category tree changed under existing data | Task 8 (a category with subcategories under another, a self-parent, a leaf promoted by a group alone); Task 9a (restore under an archived parent, delete while an archived subcategory remains, subcategories moved with their category); Task 10 (an unmapped subcategory of an unmapped category counts as Unbudgeted; `mappable` drops a demoted category's mapping from copies); Task 11 (a subcategory filtered alone) |
| 4. Account terms at their edges | Task 14 (cut-off day 31 in November and February, 2028-02-29, a payment day already past, `"0"`, `"100"`, `"100.0001"`, `"-1"`, `"2,5"`, one of term and maturity, a loan of 0, a BANK credit limit); Task 15a (a positive balance is not refused; today in Madrid vs Bogotá; a type change with a term is `AccountTypeImmutable`); Task 15b (the outline over HTTP) |
| 5. Totals that must never double count or leak across spaces | Task 16 (the card payment, an archived account with and without `archived=true`, `asOf` before the transfer, the shared space beside the personal one, a VIEWER) |
| 6. Icons and styles at their edges | Task 17a (`category-style.test.ts`: a ZWJ family, a skin tone, a flag, a keycap, `"🛒🍞"`, `"a"`, one grapheme of 34 code units; `category-styles.test.ts`: Food restyled after Bakery was created, Groceries restyled after Vegetables was promoted; `category-styles-backfill.int.test.ts`: "Casa" and "Taller" holding one catalog group's categories (the most beats the older group), "Despensa" and "Fuera" tied (the older keeps the key), "Mixto" holding two Leisure categories and one Health (the most beats catalog order), "Hogar" holding one Transport and one Income category (catalog order), a seed name matched exactly in both languages, `salud` and a name whose key is held left keyless, a deleted seeded category not held, a subcategory left unstyled; `drizzle-category-repository.int.test.ts`: `categories_style_by_level` refusing both wrong levels and `category_groups_space_key_uq`; `category.test.ts` and `category-styles.test.ts`: the key kept through a rename, a restyle and an archive); Task 17b (the same over HTTP, a `key` sent to `POST` and `PATCH` ignored) |
| 7. Preferences under locks and resets | Task 18a (`preferences.test.ts`: a lock applies the rule and lifting it brings the stored value back, a cleared or repeated locked field; `profile.test.ts`: five locked changes including a locked `timezone` sent invalid and a locked field beside an unlocked one, with nothing written; the language changed after the formats; `drizzle-user-profiles.int.test.ts`: the four checks); Task 18b (409 `PreferenceLocked`, `"DOT_DOT"` and `"fr"` with nothing stored) |

### Spec contradictions found and controller proposals

Every point below was a proposal for the controller; each task implements the proposed behaviour. All thirty are ruled: points 1–23 as each records, points 24–28 (P69–P73) and 29–30 (P78, P79) accepted as proposed. The preflight's rulings P84–P88 follow the list. M4's rulings P74 and P77 (the group key) bind Task 17a and are quoted in point 17.

1. **HU-E4-14's model** ("`date` keeps its meaning … gains `occurredAt` … and `timeZone`") **vs the brief's storage names** (`occurred_at` plus `local_date` plus `time_zone`). **Ruled by the controller (P40):** proposal — accept that the column `date` stays as the local date (renaming it to `local_date` would touch every query, index and test for no change in meaning), that `occurred_at timestamptz` and `time_zone text` are nullable and set together (`transactions_time_zone`), and that existing rows keep both null ("sin hora") and are never back-filled; the alternatives are back-filling midnight local (a fake time that would sort old rows before every morning item) or back-filling from `created_at` (HU-E4-14 forbids it).
2. **Whose zone** when the members of a shared space live in different zones: HU-E4-14 says the recorder's; spec 5.2 had no zone per transaction. **Ruled by the controller (P41):** proposal — accept the recorder's (`createdBy`) zone from their profile unless the request sends one; never the payer's (a guest has no zone) nor the space's (there is no per-space zone in v1); a new time on an edit uses the sent zone, else the stored one, else the editor's; `ListTransactions` without a period uses the requester's today; space-level clocks (M3-C's scheduler, plan closing, `GET …/periods`) keep `APP_TIMEZONE`; the alternative is a space zone, which needs a new setting and still misdates a traveller's coffee.
3. **What a period, an occurrence, an import and a date-only edit do to the time** (HU-E4-14 notes, spec 5.2 Recurrence). **Ruled by the controller (P42):** proposal — accept that no period, balance or report boundary reads `occurredAt`; that AUTO and confirmed occurrences carry only their date (M3-C's `recordOccurrence` sends no instant, pinned in Task 7b); that imports carry no time (E8); that a date-only edit keeps the wall-clock time in the stored zone, a skipped time moving forward and a repeated one taking the first instant; and that `occurredAt: null` removes the time; the alternative is dropping the time on a date edit. **Amended by P66** (backlog commit `ca3cd6a`): `occurredAt: null` answers `TimeRequired` on create and edit, a date alone takes the current time of day, and occurrences reach the ledger with `untimed: true` instead of relying on a date alone (Tasks 4, 5a, 6, 7a, 7b).
4. **The order "date desc, occurred_at desc nulls last, id"** (the brief) **vs HU-E4-14's note** (which adds `created_at desc` before `id`). **Ruled by the controller (P43):** proposal — accept `date DESC, coalesce(occurred_at, '-infinity') DESC, created_at DESC, id DESC` (identical to `NULLS LAST`, written as one row-value keyset over the expression index `transactions_space_order_idx`), a cursor carrying (date, occurredAt, createdAt, id), and `InvalidCursor` for cursors issued before M3-D; the order is total, so a row nobody edits is visited exactly once, while a row edited during paging may move across the cursor as a date edit already could (Review Focus 2); the alternative is accepting old cursors by guessing their missing keys, which could skip or repeat rows.
5. **HU-E4-14's examples** (`"2026-10-16T19:32:00Z"`) **vs the API's existing instants** (`createdAt` via `toISOString()`, with milliseconds) and the unspecified handling of a `timeZone` sent without a time. **Ruled by the controller (P44):** proposal — accept that answers use `toISOString()` (`"2026-10-16T19:32:00.000Z"`, still RFC 3339 in UTC), that `occurredAt` is accepted with any offset, that a sent `timeZone` is always validated (`InvalidTimeZone`) and is ignored when no time results (a `date` alone, or an edit without `occurredAt`), and that `DateTimeMismatch` maps explicitly to 422; the alternative is refusing a zone without a time with `ValidationFailed`. Since P66 a `date` alone results in a time, so on a create the sent zone now applies (ruling P69).
6. **HU-E1-14's note** (Better Auth declares `timezone` `input: false` with a literal default). **Ruled by the controller (P45):** proposal — accept a kernel `UserTimeZones` port implemented by identity's `DrizzleUserProfiles` and bound to the ledger and accounts in the container; Better Auth keeps `input: false` with `APP_TIMEZONE` as its default, and `SignUp` writes the browser's zone through `UserProfiles` inside its compensation (a failed write removes the half-created user); a stored zone Intl refuses reads as `APP_TIMEZONE`; validity is "Intl accepts it" as the story says, which also admits offset names such as `"+05:00"` (follow-up 2); the alternative is `input: true`, which hands validation to Better Auth.
7. **HU-E3-04's depth rule** leaves open a `groupId` sent alone for a subcategory and a `groupId` that names a category. **Ruled by the controller (P46):** proposal — accept three levels at most; `CategoryDepthExceeded` for a parent that is a subcategory, a category made its own parent, a category with subcategories moved under another, and (as in M1) a `groupId` that names a category; a `groupId` alone on a subcategory makes it a category of that group, like `parentCategoryId: null`; `POST` takes exactly one of `groupId` and `parentCategoryId` (`ValidationFailed`), `PATCH` refuses both a `groupId` and a parent category; an unknown parent is `CategoryNotFound`; the alternative is refusing a `groupId` alone on a subcategory.
8. **What a subcategory inherits** (HU-E3-04: group, archive; restore of a parent unspecified). **Ruled by the controller (P47):** proposal — accept that a subcategory always carries its parent's group and moves with it, is archived with it, is restored only under a live parent (`ParentCategoryArchived`), and is renamed on its own; restoring a category restores only itself, as no group restore exists either; siblings' names are unique per parent (`categories_parent_name_uq` on `coalesce(parent, group)`); the alternative is restoring a category's subcategories with it, which would revive ones archived on purpose earlier.
9. **Roll-up and use** (HU-E3-04: `CategoryInUse`, mappings, reports) and a case the story does not name, a mapped category that becomes a subcategory. **Ruled by the controller (P48):** proposal — accept that a category with subcategories not deleted (archived included) is `CategoryInUse`; that budgets roll a subcategory's spending, catch-all, Unbudgeted and default split into its parent through budgeting's own `BudgetCategories` port; that only categories are mapped (`SubcategoryNotMappable`); that a mapping of a category that later became a subcategory is never consulted and a copy drops it into `dropped.mappings`; that a ledger filter by a category adds its subcategories; and that M4's reports apply the same `rollUp`; the alternative is refusing to move a mapped category under another, which needs a categories → budgeting port.
10. **HU-E2-05's new types** and the stored type list. **Ruled by the controller (P49):** proposal — accept WALLET, INVESTMENT, LOAN and OTHER as personal types; `accounts.type` is a `text` column whose values live only in TypeScript, so no migration changes them; the alternative is a PostgreSQL enum or check on the type, which no earlier milestone had.
11. **HU-E2-05's migration note** ("existing accounts get their type's default icon"). **Ruled by the controller (P50):** proposal — accept nullable `institution`, `last_four`, `color`, `icon` where a null icon means the type's default on read (so existing accounts show their default with nothing back-filled and `PATCH` with `null` returns to it); the allow-list is the nine defaults plus `briefcase`, `car`, `gem`, `gift`, `house`, `plane`, `smartphone`; patterns and enums are refused by the contract (`ValidationFailed`) and `accounts_last_four` guards PostgreSQL; the alternative is a back-filling `UPDATE` in a hand-edited migration.
12. **HU-E2-07's migration and computation notes** ("the migration sets existing accounts to their type defaults"; "computed on read by `GetAccountBalances`", a use case that does not exist). **Ruled by the controller (P51):** proposal — accept nullable switches where null means the type's default (no back-fill, `PATCH null` resets), and the totals computed on read by `ListAccounts` (`totals` beside `items`) over the space's active accounts at `asOf`, the same for every reader and unchanged by `archived=true`; the alternative is NOT NULL switches with a hand-written back-fill and a separate totals use case.
13. **HU-E2-06's storage and wire formats** (rates "stored exactly", "at most 4 fractional digits"; no error named for a loan principal). **Ruled by the controller (P52):** proposal — accept typed nullable columns with checks per type, not `jsonb` (reminders and schedules will query them); rates as integer parts per million, sent as percent strings and returned with exactly four decimals, any malformed string `InvalidRate`; equivalent rates in `bigint`; a principal that is not positive `InvalidAmount`; `AccountAttributeNotAllowed` at the default 409; the alternative is `jsonb` terms validated only in the domain.
14. **Sign conventions** (HU-E2-05: liabilities negative). **Ruled by the controller (P53):** proposal — accept the convention without enforcing it (an overpaid card has a positive balance, so its available credit exceeds its limit; a loan's principal is positive and its balance negative), and net worth as the signed sum; the alternative is refusing positive card or loan balances, which would block recording an overpayment.
15. **SHARED_FUND** under HU-E2-05 … HU-E2-07. **Ruled by the controller (P54):** proposal — accept that a fund takes the common attributes and both switches (on by default) and no terms (`AccountAttributeNotAllowed`), and that a shared space totals only its funds (D5).
16. **"Today" for the next billing dates** (HU-E2-06). **Ruled by the controller (P55):** proposal — accept the requesting user's local date (`UserTimeZones`, the same port as the ledger), billing days clamped to the month's last day, and the next date on or after today; the alternative is `APP_TIMEZONE`.
17. **HU-E3-05's migration** ("seed defaults by catalog key" for existing rows) **vs this plan's "generated, never edited by hand, no back-fill"**, and groups that carry no catalog key. **Ruled by the controller (P56), amended by M4's P74 and P77 (the group key ships here):** proposal — one migration `0017_category_styles`, generated, plus a hand-written back-fill inserted before its generated checks (`pnpm db:check` compares `drizzle/meta` only); group columns `NOT NULL` with the custom default (`SYMBOL`, `tag`, `GRAPHITE`); the same migration adds the seeded groups' immutable catalog `key` (`housing`, `food`, `transport`, `health`, `leisure`, `income`; nullable, unique per space) and the back-fill matches a group by the seeded categories it holds, then by its exact es or en seed name, otherwise it stays keyless (P77; the tie-breaks are P78), so a keyed group takes its catalog style by key where P56 took the style of the catalog group of its seeded categories alone; a seeded category takes its catalog style by key, any other category its group's, subcategories none; pinned against PostgreSQL by `category-styles-backfill.int.test.ts` and its drift guard; the alternatives are a separate `drizzle-kit generate --custom` migration `0018` (seven migrations, no hand edit of a generated file) or matching groups by their names alone (lost on a rename, which is why the seeded categories come first).
18. **How a subcategory "has no style of its own"** (HU-E3-05: derived, not copied). **Ruled by the controller (P57):** proposal — `Category.style` is null exactly for a subcategory (`categories_style_by_level`), and `shownStyle` derives the parent's on every read; the use cases that answer one category answer a `CategoryView` (`shown`), and `ListCategories` nests views; a category that becomes a subcategory drops its own style; the alternative is a stored copy on each subcategory that every restyle of its parent rewrites.
19. **When an icon or color "for a subcategory" is refused** (HU-E3-05 names `POST` with `parentCategoryId` and `PATCH` of a subcategory). **Ruled by the controller (P58):** proposal — the domain decides on the result of the change: refused for a `POST` of a subcategory, a `PATCH` of a subcategory that stays one, and a `PATCH` that makes a category a subcategory; allowed in the `PATCH` that makes a subcategory a category (it restyles the copy); the contract adds no refinement; the alternative is refusing any style sent to a category that is a subcategory before the change.
20. **"Exactly one emoji grapheme"** (HU-E3-05 leaves the test open). **Ruled by the controller (P59):** proposal — one extended grapheme by `Intl.Segmenter`, at most 32 UTF-16 code units, that starts with an `Extended_Pictographic` code point or is a regional-indicator flag; keycaps (1️⃣) are refused and text-default pictographs such as `©` accepted; the value is stored as sent (no normalization); verified on Node 24.15 with ICU 78.2 (Unicode 17); the alternative is an allow-list of RGI emoji, which needs a data table that tracks Unicode releases.
21. **The full symbol set and the two palettes** (HU-E3-05: "the plan fixes the full list"; HU-E2-05 already defines account colors). **Ruled by the controller (P60, amended after the owner's review of the category UI on 2026-10-16):** proposal — the 58 Hearth names of the design's icon library, which HU-E3-05 lists in nine sections that are UI metadata only (the domain keeps the flat set, in alphabetical order, and the UI maps each name to its icon set), the seed table of Task 17a (`cross` for `medical` and `tv` for `entertainment`, the names the library has in place of `stethoscope` and `film`), `tag` in `GRAPHITE` for groups created without a style; the category palette is HU-E3-05's sixteen upper-case keys while accounts keep HU-E2-05's ten lower-case ones (Task 12), the two sets differing in names and members (follow-up 8); the alternative is one shared palette now, which changes Task 12 and HU-E2-05.
22. **Restyling a group** (HU-E3-05: `PATCH` of groups accepts `icon` and `color`; M1's `PATCH` requires `name`). **Ruled by the controller (P61):** proposal — `PATCH …/category-groups/{groupId}` takes `UpdateCategoryGroupBodySchema` with `name` optional, and `RenameCategoryGroup` keeps its M1 name and container binding while it also restyles; `POST` keeps `CategoryGroupBodySchema` with the two new fields; the alternative is renaming the use case to `UpdateCategoryGroup`, which touches the container, the index and M1's tests.
23. **The backlog of 2026-10-16** (HU-E1-15, HU-E8-18 and the time-mandatory amendment of HU-E4-14, backlog commit `ca3cd6a`). **Ruled by the controller (P62–P68):** the installation rules live in `identity`, with no `installation` module (P62, so `InstallationRulesReader` is an identity port); HU-E8-18's administrator bootstrap is an operator script (P63, M5); only the four formats are nullable, `timezone` and `locale` stay concrete and the theme stays a browser setting (P64); `PATCH /api/v1/me` also accepts `locale` and `GET /api/v1/me` gains `preferences {stored, effective, defaults, locked}`, while the UI formats from built-in es-CO defaults until HU-E1-15 is Done (P65); confirmed occurrences and imports stay untimed and `occurredAt: null` answers `TimeRequired` on create and edit (P66); HU-E9-13's screen and COP's symbol and the logo rules (P67, P68) concern E9 and HU-E8-18 only. Tasks 4, 5a, 6, 7a, 7b, 18a and 18b implement P62, P64, P65 and P66.
24. **A sent `timeZone` with a `date` alone on a create** (P44 ignored it because no time resulted; since P66 one does). **Ruled by the controller (P69):** proposal — on a create, a valid sent zone is the zone of the resulting time, with an instant or with a date alone, and the date then takes now's time of day in that zone; a date that is today in the zone takes the Clock's instant itself; when now's time of day does not exist on that date (Madrid's 2026-03-29 at 02:30), it moves forward by the gap as P42 rules for edits; P44 keeps covering edits, where a zone without an instant still changes nothing; the alternative is ignoring the sent zone and always using the recorder's, which would date a traveller's expense in a zone they did not choose.
25. **How a system path records a date without a time** now that a date alone gets one, and how `null` reaches `TimeRequired`. **Ruled by the controller (P70):** proposal — the five record inputs gain an internal `untimed?: true` that only M3-C's `recordOccurrence` sets (AUTO runs and confirmations share it) and no request body maps to; `occurredAt` is `nullable()` in the six create bodies only so that `null` reaches the use case and answers `TimeRequired` (explicit 422) rather than `ValidationFailed`; `reviseTransaction` also refuses clearing a stored time, as a domain guard behind `retimed`; acceptance files make untimed rows by clearing the two columns of a recorded row in PostgreSQL, as the scheduler or the migration leaves them; the alternative is a separate `recordUntimedOccurrence` path per type, which duplicates the four record use cases that P21 made occurrences share.
26. **The shape of `GET` and `PATCH /api/v1/me`** (P65 names the fields, not the layout). **Ruled by the controller (P71):** proposal — the `PATCH` body takes `locale` and the four formats as top-level fields beside `timezone` (not nested under `preferences`); both answers are the user's fields where they were plus `preferences`; `UpdateProfile` keeps answering the `AuthUser` and the `PATCH` route reads `GetProfile` after it, so Task 3's use case and tests keep their shape; sign-up and sign-in keep answering the user without `preferences`; the alternative is `PATCH { preferences: { … } }`, which splits one partial update across two levels.
27. **Locks before validation, and what a lock reveals** (HU-E1-15: a locked field answers `PreferenceLocked` "even to clear it or to set the value it already has"). **Ruled by the controller (P72):** proposal — `UpdateProfile` checks every lock before any validation, so a locked `timezone` sent invalid answers `PreferenceLocked`, and writes nothing unless the whole change passes; `details.fields` names the locked fields in the log but is not a public extension (`GET /api/v1/me` already lists `locked`); `PreferenceLocked` is an explicit 409 entry although the convention gives 409; the alternative is validating first, which would tell a person their zone is invalid for a field they may not change.
28. **Where HU-E1-15 sits in the plan** (the brief offered two tasks right after Task 3, or two tasks after Task 17b). **Ruled by the controller (P73):** proposal — Tasks 18a and 18b, run after Task 17b, with the generated `0018_user_preferences` on Better Auth's `user` row (four nullable `text` columns with `CHECK`s, not Better Auth `additionalFields`), so migrations stay in execution order and no task or migration is renumbered; the alternative is two tasks right after Task 3 whose migration `0018` would run before `0012` … `0017` exist, which drizzle-kit cannot generate without renumbering them.
29. **Ties and conflicts in the group-key back-fill** (HU-E3-05's note says "the one holding the most; the oldest group on a tie", and P77 fixes only the order of the two matches). **Ruled by the controller (P78):** proposal — a group takes the catalog group it holds the most live seeded categories of, the first in catalog order on a tie (P56 took the first in catalog order alone); a catalog group's key goes to the group of the space holding the most of its categories, the oldest and then the lowest id on a tie, and the other claimants stay keyless instead of falling back to a second choice; a deleted category is not held; a keyless group then takes the catalog group whose es or en name equals its name exactly (case-sensitive), only while that key is free in its space; a keyed group takes its catalog style by key, a keyless one keeps `tag` in `GRAPHITE` even when it is named like a seed whose key another group holds; `category_groups_space_key_uq` exists before the back-fill runs, so a flaw fails the migration instead of storing a duplicate; the alternatives are P56's first-in-catalog-order for a group with several, a second choice for the losers (iterative SQL), or refusing the migration on a conflict (a user's data would block the deployment).
30. **Whether a group answer returns its `key`** (M4's P74 needs it server side only, but the categories contract already returns the category `key` and HU-E3-05's note says `GET …/categories` returns the group `key` or null). **Ruled by the controller (P79):** proposal — `CategoryGroupSummary.key`, a nullable string (so `CategoryGroup` too), read-only like the category's: the bodies do not list it, Zod drops a `key` sent to `POST` or `PATCH`, `saveGroup` never writes the column, and a seeded group keeps its key through renames, restyles and archive; the alternative is keeping the key server-only (14 fewer snapshot lines, but a group would answer less than its categories and a client could not tell the seeded groups apart).

### Preflight rulings (P84–P88)

The preflight dry run at `ce923a0` (verdict READY WITH FIXES) applied B1–B11 and N1, N2, N3, N5, N6 and N7 as written; its rulings change the task list:

- **P84 (B12):** Task 17a, measured at 1,149 changed lines, is four commits: Task 17a-1 the style values (Steps 1–2, 271), Task 17a-2 the domain, the seed, the schema, the repository and `0017` with its back-fill (~437 + 75 hand-written SQL), Task 17a-3 the back-fill's characterization test (177, red evidence by mutating the `winners` tie-break), Task 17a-4 the use cases and `CategoryView` (264).
- **P85:** hand-written SQL inside a generated migration file (`0017`'s 75 back-fill lines) counts toward the ~500 review size; only drizzle-kit output is excluded.
- **P86 (N4):** Task 17b is two commits, the answers (Task 17b-1) | the bodies (Task 17b-2), ~450 | ~450 measured; the snapshot exception once ruled for 17b is withdrawn.
- **P87 (N4):** Task 15b is two commits, the answers (Task 15b-1) | the bodies (Task 15b-2), ~245 | ~345, and Task 18b two, the answers (Task 18b-1) | the changes (Task 18b-2), ~280 | ~370. The plan has 30 commits.
- **P88 (N8):** the five mutation checks the preflight ran are the red evidence of the characterization tests, as steps of Tasks 5b, 6, 16, 17a-3 and 18a: each applies its mutation, sees the named test file fail, and reverts it.

### Assumptions

1. Better Auth 1.7.7 reads the `user` row on every `getSession` (no cookie cache is configured), so `GET /api/v1/me` shows a zone changed by `PATCH` at once; Task 3's acceptance test pins it.
2. `InvalidTransactionTime` (Task 5a) is an internal guard; no HTTP path can send an instant without its zone, so it is not in the catalogue.
3. drizzle-kit 0.31.11 generates expression indexes (`coalesce(...)` in `transactions_space_order_idx` and `categories_parent_name_uq`) as it already does for `lower(name)`; the preflight confirms the generated SQL of Tasks 5a and 9a.
4. `z.iso.datetime({ offset: true })` in Zod 4.6.5 accepts both `Z` and `±hh:mm` and refuses a local time without one (pinned in Task 7a's contract test).
5. M3-C's file-local helpers named in Task 7b exist on the merged M3-C, as the preflight confirmed, except that a recurrence is defined with `define` from the file's `trackedRecurrences()` (preflight B5), which Task 7b uses so that `afterEach`'s `endAll()` ends it.
6. An existing acceptance test that asserts a whole transaction, category or account answer with `toEqual` gains the new fields in the task that adds them (Execution Workflow, literal sites).
7. drizzle-kit 0.31.11 writes a migration's `ADD COLUMN` statements, then its foreign keys and indexes, then its `CHECK` constraints (as in `0007_shared_money.sql`, `0009_member_lifecycle.sql`), so Task 17a's back-fill can go right before the checks, after `category_groups_space_key_uq`; an `ADD COLUMN … DEFAULT … NOT NULL` fills existing groups with the custom default.
8. zod-openapi 6.0.2 renders the unregistered `IconSchema` and `ColorSchema` inline in every request and response (measured on a scratch document: about 56 lines per schema with ten palette keys, six more with sixteen) and creates no component for them; `Category` keeps rendering as both `Category` and `CategoryOutput`, as it has since M1.
9. `Intl.Segmenter` in Node 24.21.0 (full ICU) treats ZWJ sequences, emoji modifiers and regional-indicator pairs as one grapheme, as Node 24.15.0 with ICU 78.2 does (checked while writing Task 17a).
10. drizzle-orm 0.45.4 leaves `undefined` values out of an `update().set()` and writes `null` as `NULL`, so `saveProfile` changes only the fields present (pinned by Task 18a's integration test).
11. Better Auth 1.7.7 inserts only the fields it declares and ignores other columns of its `user` table, so the four format columns start null at sign-up and its session user carries none of them (Task 18b's acceptance test signs up fresh users and reads `NONE`).
12. M3-C's `record-occurrence.ts` builds the recorders' input from one `base` object holding `date: occurrence.date`, as the preflight confirmed. `recurrenceWorld`'s ledger deps spread `ledgerFixture`'s, so they are not a `closedPeriods:` literal site; M3-C's literal sites are `concurrent-occurrences.int.test.ts` (Tasks 6, 11), `manage-recurrences.test.ts` and `materialize-occurrences.test.ts` (Task 11), which those tasks name (preflight N1, N2, B8).
13. PostgreSQL 18.6 treats the NULL keys of groups as distinct in `category_groups_space_key_uq`, as `categories_space_key_uq` already does for categories, and runs each `WITH … UPDATE` of Task 17a's back-fill as one statement; the migrator splits a file only at `--> statement-breakpoint`.

### Follow-ups

1. A per-space time zone for space-level clocks (the scheduler's "today", closing a plan, `GET …/periods`) if households span zones (P41).
2. Restrict zones to IANA names, refusing offset names such as `"+05:00"` that Intl accepts (P45).
3. M4: apply `rollUp` in the line dashboard (HU-E7-01) and group subcategories under their parent's key in the unified view (HU-E7-04).
4. Imports with a time column read in the importing user's zone (HU-E8-04, HU-E8-05).
5. E9: the sign-up form sends the browser's zone; the forms send `occurredAt` with the device's zone; the account form shows each type's terms and both switches (HU-E9-01, HU-E9-03).
6. A cross-space "all my money" total, if wanted (HU-E2-07 leaves it out).
7. Move HU-E1-14, HU-E1-15, HU-E4-14, HU-E3-04, HU-E3-05, HU-E2-05, HU-E2-06 and HU-E2-07 to `Done` in `docs/backlog/README.md` when the pull request merges, and add M3-D's row to its milestone table as delivered.
8. One palette for categories and accounts (HU-E3-05's upper-case keys vs HU-E2-05's lower-case ones), and the icon library of HU-E9-04 and HU-E9-12 (quick choices, sections, search) reading `CATEGORY_SYMBOLS` for the names while it keeps the nine sections itself (P60).
9. HU-E8-18 (M5): bind an adapter of the stored rules to `InstallationRulesReader`, extend `InstallationRules.defaults` with `timezone` and `locale` for sign-up, and make a locked `timezone` or `locale` the effective value (HU-E1-15 only refuses changes to them).
10. E9: HU-E9-02's formatters and HU-E9-03's date and time sheet read `preferences.effective`; HU-E9-13's settings screen labels "Default" from `preferences.defaults` and shows the lock badge from `preferences.locked`.
11. M4 (HU-E7-06): find the seeded groups through `CategoryGroup.key`, read through a categories port, never by name (P74, P77).

### Placeholder and consistency scan

- No "TBD", "TODO", "similar to Task N" or step without its code; every code step names its file and anchor, every test step its command and expected outcome.
- Names used across tasks match their definitions: `UserTimeZones`, `WallTime`, `canonicalTimeZone`, `parseTimeZone`, `localDateIn`, `wallTimeIn`, `instantAt`, `fixedTimeZones` (Task 2); `UserProfiles`, `UpdateProfile`, `createUpdateProfile`, `SignUpDeps.profiles`, `SignUpDeps.defaultTimeZone`, `DrizzleUserProfiles`, `UpdateMeBodySchema` (Task 3); `TransactionTime`, `TimeChange`, `timeOf`, `retimed` (Task 4); `Transaction.occurredAt`, `Transaction.timeZone`, `InvalidTransactionTime`, `transactions_time_zone`, `transactions_space_order_idx` (Task 5a); `TransactionPosition` (four fields), `positionOf`, `listOrder`, `cursorOf`, `positionFromCursor` (Task 5b); `LedgerDeps.userTimeZones`, `WhenInput`, `whenOf`, `editedTime` (Task 6); `Instant`, `TimeZoneName`, `whenFromBody`, `TransactionDto.occurredAt` (Task 7a); `EditTransactionBodySchema.occurredAt` (Task 7b); `Category.parentCategoryId`, `movedTree`, `archivedTree`, `restoreCategory(…, parent)` (Task 8); `CategoryNode`, `categories_parent_name_uq` (Task 9a); `CreateCategoryBodySchema`, `UpdateCategoryBodySchema.parentCategoryId` (Task 9b); `CategoryParent`, `rolledUpCategory`, `rolledUpSpending`, `mappable`, `BudgetingDeps.categories` (Task 10); `CategoryReader.subcategoriesOf`, `CATEGORIES.vegetables` (Task 11); `ACCOUNT_TYPES` in `account-type.ts`, `ACCOUNT_COLORS`, `ACCOUNT_ICONS`, `AccountAttributes`, `NO_ATTRIBUTES`, `AttributeChanges`, `iconOf` (Task 12); `attributesFromBody` (Task 13); `MAX_RATE_PPM`, `ratePpmOf`, `percentText`, `effectiveAnnualPpm`, `equivalentMonthlyPpm`, `AccountTerms`, `NO_TERMS`, `TermsChange`, `revisedTerms`, `nextBillingDate`, `TermFigures`, `termFigures` (Task 14); `Account.terms`, `TermsInput`, `termsIn`, `todayFor`, `AccountView.figures`, `AccountsDeps.userTimeZones` (Task 15a); `TermsBodySchema`, `termsFromBody`, `AccountSchema.terms`, `AccountSchema.derived` (Task 15b); `switchesOf`, `AccountTotals`, `totalsOf`, `AccountList`, `accountListDto` (Task 16); `CATEGORY_COLORS`, `CategoryColor`, `CATEGORY_SYMBOLS`, `CategorySymbol`, `CategoryIcon`, `IconInput`, `CategoryStyle`, `StyleChange`, `CUSTOM_GROUP_STYLE`, `isOneEmoji`, `categoryIconOf`, `styleChangeOf`, `changesStyle`, `restyled` (Task 17a, `category-style.ts`); `CategoryGroup.style`, `CategoryGroup.key`, `Category.style`, `restyleGroup`, `ownStyle`, `shownStyle`, the `style` of `newGroup`, `newCategory` and `reviseCategory`, `CategoryView`, `viewOf`, `CategoryNode extends CategoryView`, the `key` of each `DEFAULT_CATALOG` group, `categories_style_whole`, `categories_style_by_level`, `category_groups_space_key_uq` (Task 17a); `IconSchema`, `ColorSchema`, `UpdateCategoryGroupBodySchema`, `categoryDto(c: CategoryView)`, `CategoryGroupSummarySchema.key` (Task 17b); `NUMBER_FORMATS`, `TIME_FORMATS`, `DATE_FORMATS`, `WEEK_STARTS`, `LOCALES`, `FormatPreferences`, `StoredPreferences`, `NO_PREFERENCES`, `FORMAT_FIELDS`, `LOCKABLE_FIELDS`, `LockableField`, `InstallationRules`, `BUILT_IN_RULES`, `ProfileChange`, `effectivePreferences`, `lockedFieldsIn`, `formatsIn`, `InstallationRulesReader`, `BuiltInInstallationRules`, `UserProfiles.preferencesOf`, `UserProfiles.saveProfile`, `ProfileView`, `GetProfile`, `createGetProfile`, `ContainerOptions.installationRules`, `user_number_format`, `user_time_format`, `user_date_format`, `user_week_start` (Task 18a); `ProfileResponseSchema`, `meDto` (Task 18b); `WhenInput.untimed` and the `untimed` of the five record inputs (Task 6). `iconOf` exists twice on purpose: Task 12's exported account default and Task 17a's private column mapper in `drizzle-category-repository.ts`; the categories domain names its checker `categoryIconOf`.
- Container bindings: `profiles` (Task 3) → `identity.signUp`, `identity.updateProfile` (Task 3), `identity.getProfile` (Task 18a), `ledgerDeps.userTimeZones` (Task 6), `accountsDeps.userTimeZones` (Task 15a); `installationRules` (`ContainerOptions.installationRules`, else `BuiltInInstallationRules`) → `identity.updateProfile`, `identity.getProfile` (Task 18a); `budgetCategories` moved before `ledgerDeps` and passed to `defaultSplitOf` (Task 10); `ledgerDeps.categories.subcategoriesOf` (Task 11).
- Error codes and statuses: `DateTimeMismatch` (422, explicit, Task 7a), `TimeRequired` (422, explicit, Task 7a; raised by Tasks 4 and 5a), `PreferenceLocked` (409, explicit, Task 18b; raised by Task 18a), `InvalidTimeZone` (422, Tasks 3, 7a), `CategoryDepthExceeded`, `ParentCategoryArchived`, `CategoryInUse` (409), `CategoryNotFound` (404) (Task 9b), `SubcategoryNotMappable` (409, Task 10), `AccountAttributeNotAllowed` (409), `InvalidCreditLimit`, `InvalidBillingDay`, `InvalidRate`, `InvalidTermDeposit`, `InvalidTerm`, `InvalidAmount` (422) (Task 15b), `InvalidCursor` (422, Task 5b), `InvalidCategoryIcon` (422 by default, Task 17b; the domain raises it in Task 17a) and `ValidationFailed` (422) for an icon or color sent for a subcategory (Task 17a) and for an unknown format or language (Task 18b); each is in the OpenAPI descriptions and a backlog note of its story.
- Migrations: `0012_transaction_time` (5a), `0013_subcategories` (9a), `0014_account_attributes` (12), `0015_account_terms` (15a), `0016_account_switches` (16), `0017_category_styles` (17a-2), `0018_user_preferences` (18a); all generated, in execution order; only `0017` back-fills, through its hand-written block (P56, P77, P78). OpenAPI components added: none; `Category`, `CategoryOutput`, `CategoryGroupSummary` and `CategoryGroup` change in 17b-1; the inline answer of `GET /api/v1/me` changes in 18b-1 and that of `PATCH` in 18b-2.
- Task references: Tasks 17a and 17b build on Tasks 8, 9a and 9b and name their anchors in the form those tasks leave (Task 9b's body schemas by a range, since Prettier rewraps them); Tasks 18a and 18b build on Task 3 and name its lines as it leaves them (`profile.ts`, `profile.test.ts`, `drizzle-user-profiles.ts` and `me.contract.ts` are replaced whole, with Task 3's behaviour kept); Task 6 edits M3-C's `record-occurrence.ts` and appends to its test. The plan runs as 30 commits in the order of the header's task list (1 … 4, 5a, 5b, 6, 7a, 7b, 8, 9a, 9b, 10 … 14, 15a, 15b-1, 15b-2, 16, 17a-1 … 17a-4, 17b-1, 17b-2, 18a, 18b-1, 18b-2; rulings P84, P86, P87); an unsuffixed label (Task 15b, 17a, 17b, 18b) names all of its commits.
- Controller rulings: P40–P73, P78 and P79 ruled (P69–P73, the HU-E4-14 amendment and HU-E1-15, and P78, P79, the group key's back-fill tie-breaks and its read-only answer, accepted as proposed), M4's P74 and P77 (the group key) applied in Task 17a, and the preflight's P84–P88 applied (Task 17a in four commits, hand-written SQL counted toward review size, Tasks 15b, 17b and 18b in two each, the five mutation checks); no proposal is open, and each task states the behaviour it implements.

## Execution rulings (recorded after the merge)

These rulings were made while the plan was being preflighted, executed and finally reviewed. They were kept outside the repository until the merge; they are recorded here, with their source, so the decisions index can point at them. P84–P88 are already in "Preflight rulings (P84–P88)" above.

### From the backlog of 2026-10-16

The plan records P67 and P68 above only as concerning E9 and HU-E8-18. Their text:

- **P67 (amended):** HU-E9-13 has no Save button: each choice is PATCHed as it is made. "Default" is a label for a field that follows the installation rule, and "Reset" returns a changed field to the rule. This matches the design.
- **P68:** the COP symbol is `$` in both languages. The installation logo is a PNG, JPEG or WebP of at most 256 KB stored in the database; SVG is not accepted. The design text was updated.

### From the preflight (opus dry run at `ce923a0`)

- **B3:** the fix is the destructuring fix (the three time fields only), not a rewrite of `retimed`. B1–B11 were otherwise accepted as the preflight wrote them.
- **P89 (Task 7a review):** the local date an instant gives in its zone must be a valid `LocalDate` (years 1900 to 9999); otherwise the answer is `422 InvalidDate` with `details.value` set to the `occurredAt` sent. It is enforced in the domain (`timeOf`, `retimed`), so create and edit agree.
- **P90 (Task 9a review):** every write to a space's category tree (create, update, archive, restore and delete of categories; create, rename and archive of groups) first takes `pg_advisory_xact_lock(hashtextextended('categories:' || space_id, 0))` through `CategoryRepository.lockTree`, so concurrent writes see each other: a sibling-name race answers `CategoryNameTaken`, and no fourth level, orphan, cross-group or archived-parent subcategory can be stored by a race. Follow-up: make the in-memory categories fake enforce the sibling-name and self-parent rules.
- **P91 (Tasks 14 and 15a):** a stored value that a read would throw on is refused by PostgreSQL itself. Migration `0015` adds CHECKs for `cut_off_day` and `payment_day` (1 to 31) and for `monthly_rate_ppm` and `annual_rate_ppm` (0 to `MAX_RATE_PPM`), beyond the brief's four checks. The Task 15a review extended it to the domain ranges of the other stored terms: `term_days` 1 to 3660, `term_months` 1 to 480, `credit_limit` > 0 and `principal` > 0.
- **P92 (Task 15b-2):** `AccountAttributeNotAllowed` answers a public detail `field` that names the refused body field by its public name (`monthlyRate`, `annualRate`, `creditLimit`, and so on), mapped from the domain key. Domain details of 4xx answers stay unlogged by design.

### From a task review

- **P72, clarified (Task 18b-2 review):** "locks before validation" means the use case's own validation (for example, whether a zone is valid). A malformed value is refused by the request schema (`422 ValidationFailed`) before any lock check, by design.

### From the final review (opus, "With fixes", 0/0/11 findings)

- **P93 (M2):** plan figures, closed plans and the carry-over chain included, follow the current category tree and the current members (the existing precedent). Spec 5.4 says so. Demoting a mapped category is not refused.
- **P94 (M5):** the API keeps `timezone` on the user (sign-up, `/me`) and `timeZone` on transactions; spec 7 documents both spellings.
- **Fix wave:** M1 (hide subcategory mappings from a line's `categoryIds`), the spec sentences for P93, M3 (a moved seeded category keeps its key, and groupings by key roll up first) and P94, and the HU-E9-04 icon-slot clipping note. Follow-ups #119 to #126 were opened; #118 stays.
