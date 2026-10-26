# M4 Insight API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Hearth's insight API (milestone M4): every member of a space reads, for any period of the space's policy, the planned, spent and available amount of each budget line with Unbudgeted spending and overspent flags (HU-E7-01), the assigned, contributed, consumed and gap figures of every current member on every line (HU-E7-02) and each member's expected versus actual contributions to the shared fund (HU-E7-03); every user reads one unified view of their own consumption and cash out across every space they are or were a member of, in their personal period (HU-E7-04); both compare period over period, per line and for the user's own consumption (HU-E7-05); and every member of a space, and every user across their own spaces, reads the spending of a period by category group, then category, then subcategory, each node with its share of its parent (HU-E7-06).

**Architecture:** A new `reporting` module (`src/modules/reporting/{domain,application,contracts}`, no infrastructure and no table) holds the read models of spec 5.1. Its domain gains pure rules: `matrixRow` (Task 3, `domain/member-matrix.ts`), `fundContributions` (Task 3, `domain/fund-contributions.ts`), `consumptionGroups` and `cashOutOf` (Task 8a, `domain/unified-view.ts`), `periodsEndingWith`, `changeFrom`, `tracedLines` (Task 10, `domain/trend.ts`), `placeIn` (Task 13, `domain/category-tree.ts`) and `spendingTree` (Task 14a, `domain/spending-by-group.ts`). Space reports reuse budgeting's read side instead of deriving figures again: `spaceReport` resolves the period by label and reads the plan whose stored period it is through budgeting's own `loadPlanView` (Task 1, exported through budgeting's public API with `lineForCategory` in Task 5; ruling P32). The new sums are SQL aggregates on read (D7): `DrizzleLedgerQueries` gains `memberSumsByCategory` and `fundContributionsByMember` (Task 4) and `consumptionByCategory` and `cashOut` (Task 7), `DrizzleSpaceRepository` gains `placesOf` (Task 7) and `DrizzleCategoryRepository` gains `treesOf` (Task 13); reporting declares the matching ports (`SpaceMemberSums`, Task 5; `PersonalSums`, `ReportCategories`, `SavingsAccountsOf`, Task 8b; `CategoryTrees`, Task 13) and only `src/composition/container.ts` binds them, so no module imports reporting. The spending by group sums nothing of its own: it places the rows of `expensesByCategory` (a space) and of the unified view's `consumptionByCategory` (the caller) in the category trees as they stand now (ruling P80). Eight GET endpoints serve the reports (Tasks 2a, 6a, 6b, 9a, 12a, 12b, 15a, 16a). No migration.

**Tech Stack:** Node.js 24.21.0, pnpm 12.11.2, Next.js 16.4.0 (App Router route handlers), React 19.3.0, TypeScript 6.0.3 strict, Zod 4.6.5, zod-openapi 6.0.2, drizzle-orm 0.45.4 + drizzle-kit 0.31.11, pg 8.23.1, better-auth 1.7.7, Vitest 5.0.3, PostgreSQL 18.6 (Docker CLI in tests). No new dependencies.

**Spec:** `docs/specs/2026-10-11-hearth-design.md` (approved 2026-10-11; sections 4, 5.1 (`reporting`: read models), 5.2 (SpaceMember, Account, Transaction, Payment, Share, BudgetPlan, BudgetLine), 5.3 (period labels, comparisons with the previous period of the same policy), 5.4 (every derived metric, the fund level and the unified personal view), 7, 8 and decisions D2, D5, D6, D7, D8, D9, D10, D11, D13, D15 bind this plan). Stories: `docs/backlog/E7-reporting.md` (HU-E7-01 … HU-E7-06 and the epic's shared fixture), the unified-view assertions of HU-E1-11 in `docs/backlog/E1-identity-and-spaces.md` (deferred to M4 by `docs/backlog/README.md`), and the dependency rows of `docs/backlog/README.md` (HU-E7-01 ← HU-E6-09; HU-E7-02 ← HU-E6-08, HU-E7-01; HU-E7-03 ← HU-E4-09, HU-E6-05; HU-E7-04 ← HU-E4-07, HU-E4-10; HU-E7-05 ← HU-E7-01, HU-E7-04; HU-E7-06 ← HU-E3-02, HU-E3-04, HU-E3-05, HU-E7-04; every dependency is `Done`, HU-E3-04 and HU-E3-05 since the M3-D merge). Format template and precedent: `docs/plans/2026-10-15-m3b-plan-lifecycle.md`. Rulings in force: M3-A's P1–P9 (P8 as amended), M3-B's P10–P19 (P17 as amended), M3-C's P20–P31 and the preflight notes N1–N6, M3-D's rulings as merged (HU-E7-06 reads the roll-up of P48 and the group keys back-filled under P56), the HU-E7-06 rulings P74–P77 (P74 as amended) and P80–P82, the M4 preflight rulings P95–P97 (P95 resolves P83) and the M4 execution rulings P98–P106. GitHub Project: https://github.com/users/Facabore/projects/4.

**Baseline: `development` at `9e1c920`, with M3-C and M3-D merged.** This plan targets the merged code of `docs/plans/2026-10-16-m3c-recurring-and-history.md` (recurring transactions and the balance history) and `docs/plans/2026-10-17-m3d-ledger-refinements.md` (subcategories, category styles and the group keys). The M4 preflight dry run applied every task, in order, at `9e1c920` and verified every anchor and every name the plan relies on there; its fixes are in the tasks (rulings P95 – P97). In `src/composition/container.ts` the plan anchors on `import { DrizzleBudgetPlanRepository } from "@/modules/budgeting/infrastructure/drizzle-budget-plan-repository";`, `  /** Brute-force guards for the unauthenticated identity routes; false means "reject with 429". */`, `  const invitationRepository = new DrizzleInvitationRepository(tm);`, `    authThrottle: {`, `  const categoriesDeps: CategoriesDeps = {` and `    categories: new DrizzleCategoryRepository(tm),`, then only on lines this plan writes; in `src/composition/openapi.ts`, on `import { BudgetPlanSchema, budgetingPaths } from "@/modules/budgeting/contracts/budgeting.contract";` and `      ...budgetingPaths,`; in `src/modules/ledger/infrastructure/drizzle-ledger-queries.ts`, on `  isNull,` and `  private matching(f: TransactionFilter) {` (M3-C's `memberHistory` sits before the same line, so this plan's methods land after it); in `src/modules/budgeting/application/plan-view.ts`, on `type ViewDeps = Pick<BudgetingDeps, "members" | "plans" | "spending" | "savingsAccounts" | "categories">;` (M3-D's Task 10 added `categories`, so `ReportingDeps` carries budgeting's `categories` as well, ruling P95); in `src/modules/categories/infrastructure/drizzle-category-repository.ts`, on `import { and, eq, isNull, sql } from "drizzle-orm";` (M3-D's `lockTree` imports `sql`), `import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";` and `  async saveGroup(group: CategoryGroup): Promise<void> {`. `openapi/openapi.snapshot.json` is regenerated, never edited by hand. Tasks 13 – 16b (HU-E7-06) read `Category.parentCategoryId` (M3-D Task 9a), the subcategory endpoints (M3-D Task 9b) and the group `key` that M3-D's Task 17a adds and back-fills in `0017_category_styles` (ruling P74 as amended). The migrations 0011 (M3-C) and 0012 – 0018 (M3-D) are merged; this plan adds none.

**Out of scope (later plans):** M5 hardening, epic E8 (HU-E8-01 backups, HU-E8-02 logging and health, HU-E8-04 and HU-E8-05 imports, HU-E8-06 multi-currency spaces — the unified view leaves other currencies out instead, ruling P37 — and the Won't-v1 placeholders HU-E8-07 … HU-E8-10); the web UI, epic E9 (HU-E9-10 space dashboards with their charts and the "create or copy a plan" prompt, HU-E9-11 personal dashboards and trend charts); everything M3-C delivers (HU-E4-11 … HU-E4-13 recurring transactions and pending occurrences, HU-E5-04 balance history), including the pending occurrences HU-E4-13's note says the dashboard "may" return as expected (ruling P34). Also out: a default `period` (the current period) for the reports, pagination, trends of unbudgeted spending or of lines the end period's plan no longer has (ruling P38), and stored or materialized read models (D7). For HU-E7-06, as its notes say: trends, budget lines and transaction filters by group, and the drill-down charts and labels (HU-E9-10, HU-E9-11).

## Global Constraints

- Node.js `24.21.0`; pnpm `12.11.2`; Next.js `16.4.0`; React `19.3.0`; TypeScript `6.0.3` with `strict: true` and `noUncheckedIndexedAccess: true`; Zod `4.6.5`; zod-openapi `6.0.2`; drizzle-orm `0.45.4`; drizzle-kit `0.31.11`; pg `8.23.1`; better-auth `1.7.7`; Vitest `5.0.3`; PostgreSQL image `postgres:18.6-alpine`. No new dependencies; `pnpm check:pinned` must keep passing.
- Money is `bigint` minor units in code and `bigint` columns in PostgreSQL (D6); over HTTP it is `{ "amount": "<minor units as string>", "currency": "<ISO 4217>" }`. COP has exponent 2: 1,575,000 COP is `"157500000"` on the wire. Sums come from SQL `sum(...)::text` parsed as bigint, never floats. Available amounts, gaps, differences and changes may be negative. A trend's percentage is basis points in code, rounded half away from zero, and a signed two-decimal string on the wire (`"-3.70"`, ruling P38). A breakdown's share is basis points of its parent's total in code, rounded half up on each level, and a two-decimal string on the wire (`"56.94"`, ruling P75).
- **Figures are derived on read (D7):** every report is computed per request from the ledger, the plans and the spaces; no stored read model, cache or migration (none unless measured slow). Space reports take a plan's figures from budgeting's `loadPlanView`, exactly as `GET …/plans/{planId}` shows them (carry-over included), and never derive them again (ruling P32).
- Every money reference points to a `SpaceMember` (D15). **Only current members count (ruling P7):** the matrix and the fund tracking list the space's current members in join order, guests included, and a former member's payments, shares and contributions count for nobody there. The unified view works through every member row linked to the caller instead, rows they left and a claimed guest place included (spec 5.4), so their own history stays theirs.
- **SAVINGS lines (ruling P8 as amended, carried):** a SAVINGS line's spending and per-member contribution count only the accounts it names whose owner is a current registered member of the plan's space, evaluated on read; a transfer is credited to the owner of the account it reached (ruling P35). The unified view's savings transfers are those into the caller's own SAVINGS accounts only; a transfer into an INVESTMENT account (an account type M3-D added) is not cash out (ruling P97).
- **Privacy of a member's personal space (spec, HU-E7-04 notes):** a shared view never exposes another member's personal data. Space reports read only the space's own transactions plus the transfers into the accounts their owners attached to a SAVINGS line (P8); they never name an account or a personal-space figure. The unified view, the personal trend and the personal spending by group read only the caller's own member rows (`placesOf(caller)`), so no other member's personal space, and no shared view of anyone else, reaches them.
- **Every delete is logical (owner directive, spec D8):** M4 writes nothing; every new endpoint is a GET. Soft-deleted transactions never count (E7: "exclude soft-deleted transactions"); left members and archived categories and spaces keep their rows and history.
- **Authorization only through the permission matrix, membership first:** space reports are `space.read` through `authorizeSpaceAction` (non-members and malformed ids get `404 SpaceNotFound` before anything else); `/api/v1/me/…` reports read the caller's own rows and need no space action. M4 adds no matrix action and no hardcoded role list (`src/modules/spaces/domain/permissions.ts` is unchanged).
- **Archived spaces read (HU-E1-09):** every space report answers `200` in an archived space, and the unified view includes archived spaces' rows.
- Repositories guard identifiers from requests with `isUuid` (malformed ids answer `[]`, zero sums or `SpaceNotFound`, never a `500`): the new ledger methods guard their space and member ids; `placesOf` takes the session's user id; `treesOf` guards its space ids. Period labels are checked by `periodByLabel` (`InvalidPeriodLabel`).
- HTTP errors are RFC 9457 `application/problem+json` with a stable `code` and `requestId`; status mapping lives only in `src/shared/http/problem.ts`. **No new code:** reports answer `SpaceNotFound` (404), `InvalidPeriodLabel` (422 by the `Invalid*` default) and the edge code `ValidationFailed` (422, a missing `period` or `endPeriod`, `periods` outside 1–24). Reasons and statuses of the reports (`NOT_ALLOCATED`, `OVER_CONTRIBUTED`, `NEW`, …) are codes the web UI translates, never errors.
- Hexagonal boundaries (ADR 0001): domain imports only its own domain and `src/shared/kernel`; application never imports infrastructure, contracts, HTTP, frameworks or the ORM; other modules are reached only through `src/modules/<m>/application/index.ts`; no import cycles (`no-circular` counts type-only imports, `tsPreCompilationDeps: true`). **Reporting reaches budgeting and spaces only through their public API, and no module imports reporting:** the ledger implements `SpaceMemberSums` and `PersonalSums`, spaces `MemberPlaceRepository`, categories `ReportCategories` and `CategoryTrees` and accounts `SavingsAccountsOf` with their own types, bound by `src/composition/container.ts` only.
- **No schema change:** no migration and no `*.schema.ts` edit; `pnpm db:check` keeps reporting no drift.
- Strict TDD: every behaviour starts with a failing test that is run and seen failing. Golden scenarios run as domain or use-case unit tests and again over HTTP; `@critical` scenarios run in-process against the route handlers with real PostgreSQL (`tests/acceptance/`); every new SQL aggregate is pinned against PostgreSQL (`*.int.test.ts`).
- Code, identifiers, comments, docs and generated artifacts in English. Conventional commits referencing the story issue (`Refs #<n>`); no AI attribution or `Co-Authored-By` lines.
- Gates for every task: `pnpm exec vitest run --project unit`, `pnpm exec vitest run --project integration`, `pnpm exec vitest run --project acceptance`, `pnpm format`, `pnpm exec eslint .`, `pnpm exec tsc --noEmit`, `pnpm exec prettier --check .`, `pnpm lint:boundaries`, `pnpm db:check`.
- OpenAPI: **no new component and no new `…Output` variant.** Eight new operations with inline response schemas; amounts reference the existing `Money` (rendered `MoneyOutput` in responses, as today) and periods the existing `Period` component, as `GET …/periods` already does.

## Review Focus

1. **Members who left, rejoined, guests and viewers** (Luis paid Groceries in November and left, Pedro the guest has no capacity, Sofi the VIEWER reads, Ana left a space whose expenses she shared, Pedro claimed his guest place): the matrix and the fund tracking list only current members with zeros where they did nothing and count Luis's money for nobody; Ana's and Pedro's unified views keep their history — pinned in Task 3 (a former member's contribution), Task 5 (`member-luis` sums ignored, Sofi and Pedro on target with 0), Task 6a (Sofi over HTTP), Task 7 (`placesOf` keeps left and claimed rows) and Task 9b (Pedro's Hotel share after the claim).
2. **Period labels, edges and policies** (an expense on 2026-11-30 and on 2026-12-01, "2026-11 H1" in a MONTHLY space, a plan whose stored period differs from the policy, a period without a plan in the middle of a trend window, a MONTHLY(25) space read in a MONTHLY(1) personal period): exactly the stored dates count, `InvalidPeriodLabel` for labels the policy does not name, null trend points and `NEW` after a gap — pinned in Tasks 1, 2a, 2b, 4, 7, 8b, 9b, 10 and 11.
3. **Privacy between members** (Juan's personal expenses, Juan's savings account receiving transfers in the same period, Luis's account named on a SAVINGS line, Ana's view read while Juan's personal space has data): Ana's view and the space reports never include them — pinned in Task 5 (Luis's account credits nobody), Task 7 (the sums read only the given member ids), Task 8b (only Ana's rows are asked for; `acc-juan-savings` is not hers) and Task 9b (Juan's 90,000 COP stays out of Ana's view and in his).
4. **Money signs and rounding** (Home at −130,000 COP, Juan's gap of −482,000 COP, −50,000 COP over 1,350,000 COP as "-3.70", one third, half a basis point, a previous figure of 0, a soft-deleted expense and contribution, the fund's Rent counting for nobody's payment and everybody's share): negative figures stay exact bigints, percentages round half away from zero, `NEW` instead of a division by zero — pinned in Tasks 3, 4, 7, 10 and 12a.
5. **Identifiers from elsewhere, archived spaces and currencies** (a non-member, a malformed space id, an archived space, a USD trip in a COP user's places, a period label of another policy): `404 SpaceNotFound` (never `500`), `200` in archived spaces, the USD space left out and named in `otherCurrencySpaces` — pinned in Tasks 1, 2b, 5, 8b and 12a.
6. **Category trees changed under existing data** (Restaurants moved from Food to Leisure after an October expense, Groceries with Vegetables and Meat, an archived group and category with spending, a deleted category, seeded groups renamed in a shared space, a group key only shared spaces hold, Restaurants under Food in one space and under Leisure in another): the tree as it is now counts, a subcategory's expense counts once, archived nodes stay listed and flagged, merged rows take the personal space's names (P76); a subcategory's payments and shares count on its parent's matrix line (P96) and its consumption in its parent's unified-view row (P95) — pinned in Tasks 5, 8a, 8b, 13 (`treesOf`, `placeIn`), 14a and 15b.

## Execution Workflow

- Work on the long-lived branch `development`, with M3-C and M3-D merged (`9e1c920` or later); every task is implemented there with Strict TDD. Implementers stage; the controller commits.
- **RDD before every commit** (receipt-driven development is on; check with `gentle-ai review mode status`). Each "Commit" step means:
  1. Run every source-mutating normalizer first (`pnpm format`, regenerated snapshots), then stage exactly the files of the task.
  2. Run `gentle-ai review status --cwd . --contract gentle-ai.review-integration/v2 --agent claude-code --next-transition` and follow only the returned `next_transition` (`execute` its operation, satisfy `collect` inputs, or stop on `stop` and report its reason code with its documented continuation). Medium/high-risk candidates may return a consent envelope; relay it to the owner and wait.
  3. Commit only after the provider-returned `review.validate` allows the `pre-commit` gate for that exact staged candidate; the commit must not change the reviewed bytes.
  4. If the owner disables RDD (`gentle-ai review mode disable --scope clone --cwd .`), commit under ordinary policy and report `disabled/unmanaged`.
- Code blocks in this plan are complete but not guaranteed to match Prettier's line wrapping: run `pnpm format` before the gates of every task (the gates then run `prettier --check`). Anchors in this plan name lines that Prettier leaves alone (short statements, JSDoc and `//` comments, existing lines already formatted, the last line of a file). Where a later task edits a line an earlier task wrote, the earlier task writes it in its final Prettier form (a single-line import while it fits in 110 columns, multi-line once it does not).
- Every code block the executor writes is introduced by a line naming its file path in backticks and ending with a colon. "Create" blocks are whole files; edits to existing files name a unique anchor line ("after the line …", "replace the line …", "insert before the line …", "append to the end of the file", "insert before the last line of the file").
- **Task labels:** split halves of a task carry a lower-case letter (2a, 2b, 6a, 6b, 8a, 8b, 9a, 9b, 12a, 12b, 14a, 14b, 15a, 15b, 16a, 16b); each half is its own commit and RDD pass, executed in the order 1, 2a, 2b, 3, 4, 5, 6a, 6b, 7, 8a, 8b, 9a, 9b, 10, 11, 12a, 12b, 13, 14a, 14b, 15a, 15b, 16a, 16b (24 commits). Tasks 2b, 9b, 15b and 16b are the test-and-docs halves of HTTP tasks: their scenarios pin behaviour that Tasks 1, 7, 8b, 13, 14a and 14b drove red first, so they pass on their first run (each step says how to see a test bite) and commit as `test(reporting)`.
- **Ports and test doubles:** the use-case tests use fixed sums keyed by the first day of the period asked for (`SpendingByPeriod`, `MemberSumsByPeriod` in `tests/support/reporting-world.ts`, `PersonalSumsByPeriod` in `tests/support/personal-world.ts`), as M3-A's `FixedSpending` does; each new SQL method is pinned against PostgreSQL with exact expected rows (`drizzle-report-sums.int.test.ts`, Tasks 4 and 7; `drizzle-member-places.int.test.ts`, Task 7; `drizzle-category-trees.int.test.ts`, Task 13), the use-case tests read fixed category trees (`HOUSEHOLD_TREE`, `ANA_TREE` in `tests/support/category-trees.ts`, Task 13), and the acceptance tests run the real adapters end to end.
- **Measured sizes (preflight N1, carried from M3-A, M3-B and M3-C):** each task is one commit sized for review, target under ~400 changed lines (OpenAPI snapshot growth included), and **a task over ~500 changed lines is split into two commits, each green on its own**. The M4 preflight dry run measured one throwaway commit per task at `9e1c920`, its fixes included (`git show --numstat` after `prettier --write`; the snapshot included, `drizzle/` excluded, which no task writes): Task 1 417, **2a 489** (fallback split point if it grows over ~500: the contract, route, container, `openapi.ts` and snapshot | `tests/support/reporting.ts` and the golden scenario), 2b 48, 3 274, 4 247, **5 498** (at the limit; split point if it grows: `member-sums.ts`, the matrix use case, the world's sums and `member-matrix.test.ts` | the fund use case and `fund-tracking.test.ts`), **6a 485** (split point: the contract, route, container, snapshot, support and the golden scenario | the other three scenarios and the backlog note), 6b 306, 7 315, 8a 230, 8b 465, 9a 458, 9b 95, 10 181, 11 332, 12a 429, 12b 296, 13 383, 14a 462, 14b 278, 15a 449, 15b 132, 16a 435, 16b 58; 67 files, 7,724 insertions and 4 deletions in all, and no task needs a split. The **snapshot growth measured** there: `GET …/reports/lines` 200 lines, `…/member-matrix` 250, `…/fund-contributions` 147, `GET /api/v1/me/unified-view` 216 (`name` included, ruling P95), `…/reports/trend` 214, `GET /api/v1/me/trend` 133, `…/reports/spending-by-group` 216, `GET /api/v1/me/reports/spending-by-group` 270 (both inline; reusing their node schemas adds no component). The controller measures each staged candidate (`git diff --cached --numstat`, generated files excluded) before RDD and splits at the named point when it is over ~500.
- The OpenAPI snapshot changes in Tasks 2a (`GET …/reports/lines`), 6a (`GET …/reports/member-matrix`), 6b (`GET …/reports/fund-contributions`), 9a (`GET /api/v1/me/unified-view`), 12a (`GET …/reports/trend`), 12b (`GET /api/v1/me/trend`), 15a (`GET …/reports/spending-by-group`) and 16a (`GET /api/v1/me/reports/spending-by-group`); no component changes. If a `PeriodOutput` or any other new `…Output` variant appears in a snapshot diff, fix the contract (for `Period`, the `PeriodSchema.extend({})` precedent of `BudgetPlanSchema`) instead of accepting the snapshot.
- When a task starts, move its story issues to **In Progress** on Project #4. When all tasks are done, open one pull request from `development` into `main`. It closes #56, #57, #58, #59, #60 and #113 and completes milestone M4. Its description also lists, as PR notes: (1) the new `reporting` module and its eight GET endpoints, each derived on read with no migration; (2) the privacy guarantee: space reports expose only the space's own transactions and P8 accounts, and `/api/v1/me/…` reads only the caller's own member rows; (3) the controller rulings P32–P39, P74–P77, P80–P83 and P95–P106 of the Self-Review, as ruled (P95 resolves P83); (4) the follow-ups in the Self-Review.
- Task-to-issue map (issues are titled with their story ID): HU-E7-01 → #56 (Tasks 1, 2a, 2b), HU-E7-02 → #57 (Tasks 3, 4, 5, 6a), HU-E7-03 → #58 (Tasks 3, 4, 5, 6b), HU-E7-04 → #59 (Tasks 7, 8a, 8b, 9a, 9b), HU-E7-05 → #60 (Tasks 10, 11, 12a, 12b), HU-E7-06 → #113 (Tasks 13, 14a, 14b, 15a, 15b, 16a, 16b). Task 9b also references the closed M2 story HU-E1-11 (#20), whose unified-view assertions it pins, without reopening it.

## File Structure

```
.
├── docs/backlog/
│   ├── E7-reporting.md                                              # notes of HU-E7-01 … HU-E7-06 (Tasks 2b, 6a, 6b, 9b, 12a, 12b, 15b, 16b)
│   └── E1-identity-and-spaces.md                                    # HU-E1-11 unified-view note (Task 9b)
├── openapi/openapi.snapshot.json                                    # Tasks 2a, 6a, 6b, 9a, 12a, 12b, 15a, 16a
├── src/
│   ├── composition/
│   │   ├── container.ts                                             # Container.reporting, reportingDeps (2a, 6a, 6b, 9a, 12a, 12b, 15a, 16a), categoryRepository (15a)
│   │   └── openapi.ts                                               # reportingPaths (Task 2a)
│   ├── modules/
│   │   ├── budgeting/application/{plan-view,index}.ts               # export loadPlanView, PlanViewDeps (1), lineForCategory, rolledUpCategory (5)
│   │   ├── ledger/infrastructure/drizzle-ledger-queries.ts          # space sums (Task 4), personal sums (Task 7)
│   │   ├── ledger/infrastructure/drizzle-report-sums.int.test.ts    # Tasks 4, 7, 13 (a subcategory's own id)
│   │   ├── spaces/application/{member-places,index}.ts              # MemberPlace, MemberPlaceRepository (Task 7)
│   │   ├── spaces/infrastructure/drizzle-space-repository.ts        # placesOf (Task 7, + drizzle-member-places.int.test.ts)
│   │   ├── categories/infrastructure/drizzle-category-repository.ts # treesOf (Task 13, + drizzle-category-trees.int.test.ts)
│   │   └── reporting/
│   │       ├── domain/member-matrix.ts                              # matrixRow, reasons, statuses (Task 3)
│   │       ├── domain/fund-contributions.ts                         # fundContributions (Task 3)
│   │       ├── domain/unified-view.ts                               # consumptionGroups, cashOutOf (Task 8a)
│   │       ├── domain/trend.ts                                      # periodsEndingWith, changeFrom, tracedLines (Task 10)
│   │       ├── domain/category-tree.ts                              # TreeCategory, TreePlace, treeById, placeIn (Task 13)
│   │       ├── domain/spending-by-group.ts                          # spendingTree, shareOf, Grouping (Task 14a)
│   │       ├── application/deps.ts                                  # ReportingDeps (Task 1)
│   │       ├── application/space-report.ts                          # spaceReport, planViewIn (Task 1), spacePeriod (Task 14b)
│   │       ├── application/get-line-dashboard.ts                    # GetLineDashboard (Task 1)
│   │       ├── application/member-sums.ts                           # SpaceMemberSums, MemberSumsDeps (Task 5)
│   │       ├── application/get-member-line-matrix.ts                # GetMemberLineMatrix (Task 5)
│   │       ├── application/get-fund-contributions.ts                # GetFundContributions (Task 5)
│   │       ├── application/personal-scope.ts                        # PersonalDeps, personalScope (Task 8b), consumptionRows (Task 14b)
│   │       ├── application/get-unified-personal-view.ts             # GetUnifiedPersonalView (Task 8b)
│   │       ├── application/get-line-trend.ts                        # GetLineTrend (Task 11)
│   │       ├── application/get-personal-trend.ts                    # GetPersonalTrend (Task 11)
│   │       ├── application/category-trees.ts                        # CategoryTrees (Task 13)
│   │       ├── application/get-spending-by-group.ts                 # GetSpendingByGroup (Task 14b)
│   │       ├── application/get-personal-spending-by-group.ts        # GetPersonalSpendingByGroup (Task 14b)
│   │       ├── application/index.ts                                 # Tasks 1, 5, 8b, 11, 13, 14b
│   │       └── contracts/reporting.contract.ts                      # Tasks 2a, 6a, 6b, 9a, 12a, 12b, 15a, 16a
│   └── app/api/v1/
│       ├── spaces/[spaceId]/reports/lines/route.ts                  # GET (Task 2a)
│       ├── spaces/[spaceId]/reports/member-matrix/route.ts          # GET (Task 6a)
│       ├── spaces/[spaceId]/reports/fund-contributions/route.ts     # GET (Task 6b)
│       ├── spaces/[spaceId]/reports/trend/route.ts                  # GET (Task 12a)
│       ├── spaces/[spaceId]/reports/spending-by-group/route.ts      # GET (Task 15a)
│       ├── me/unified-view/route.ts                                 # GET (Task 9a)
│       ├── me/reports/spending-by-group/route.ts                    # GET (Task 16a)
│       └── me/trend/route.ts                                        # GET (Task 12b)
└── tests/
    ├── support/
    │   ├── reporting-world.ts         # SpendingByPeriod, reportingWorld (1), MemberSumsByPeriod (5)
    │   ├── personal-world.ts          # PersonalSumsByPeriod, place, ANA_PLACES, personalWorld (8b)
    │   ├── category-trees.ts          # node, spent, HOUSEHOLD_TREE, ANA_FOOD, ANA_TREE (13)
    │   └── reporting.ts               # HTTP helpers, reportHousehold, spend, contribute, DTO types (2a, 6a, 6b, 9a, 12a, 12b, 15a, 16a), category helpers (15b)
    └── acceptance/
        ├── reports-lines.test.ts              # Tasks 2a, 2b
        ├── reports-member-matrix.test.ts      # Task 6a
        ├── reports-fund-contributions.test.ts # Task 6b
        ├── unified-view.test.ts               # Tasks 9a, 9b, 16a, 16b (personal spending by group)
        ├── reports-trend.test.ts              # Task 12a
        ├── personal-trend.test.ts             # Task 12b
        └── reports-spending-by-group.test.ts  # Tasks 15a, 15b
```

Test layout follows M0–M3-C: unit tests next to the code as `*.test.ts` (no database), integration tests as `*.int.test.ts` (real PostgreSQL via `testDatabase()`), acceptance tests in `tests/acceptance/` calling the exported route handlers in-process. Shared test doubles live in `tests/support/`. Run a single file with `pnpm exec vitest run --project <unit|integration|acceptance> <path>`. Integration and acceptance projects start a disposable PostgreSQL container through the Docker CLI and apply every migration in `drizzle/`, so Docker must be running. Integration files run in parallel on one database, so every new integration test builds its own users and spaces (`sharedLedgerFixture`, `personalSpaceFixture`) and asserts only on them; acceptance files run one at a time and assert only on their own fresh household.

### How report actions are authorized

No matrix action is added; M4 reuses `space.read` and the session's own user.

| Use case | Matrix action | Roles | Other rules (where they live) |
|---|---|---|---|
| `GetLineDashboard`, `GetMemberLineMatrix`, `GetFundContributions`, `GetLineTrend`, `GetSpendingByGroup` | `space.read` | every role | `spaceReport` (Task 1): membership first (`SpaceNotFound`), archived spaces read, the period by label (`InvalidPeriodLabel`), through `spacePeriod` since Task 14b; current members only (P7, Task 5) |
| `GetUnifiedPersonalView`, `GetPersonalTrend`, `GetPersonalSpendingByGroup` | none: the caller's own rows | any signed-in user | `personalScope` (Task 8b): `placesOf(caller)`, the personal space's policy and stored periods (D10), one currency (D6, P37) |

### Every path that touches a report rule

| Rule | Paths | Where it is enforced |
|---|---|---|
| A report's figures are the plan's figures, derived on read (D7, P32) | dashboard, matrix, fund tracking, line trend | `planViewIn` → budgeting's `loadPlanView` (Task 1) |
| The period is the stored one with that label, else the policy's (D10); its plan is read whatever its status (P33) | every report | `spaceReport` (Task 1), `personalScope` (Task 8b) |
| An expense counts on the line its category consumes (HU-E6-04), a subcategory's on its parent category's line (HU-E3-04, P96) | dashboard, matrix | `planFigures` (M3-A) and `loadPlanView`'s roll-up (M3-D), `rolledUpCategory` and `lineForCategory` (Task 5) |
| Only current members count (P7) | matrix, fund tracking | `listCurrent` (Task 5), `fundContributions(memberIds, …)` (Task 3) |
| SAVINGS counts only current registered members' accounts, credited to their owner (P8, P35) | dashboard, matrix | `loadPlanView` (M3-A), `savingsByMember` (Task 5) |
| NONE lines report consumption only; SHARED_FUND contribution is tracked at fund level (spec 5.4, D5) | matrix, fund tracking | `matrixRow`, `fundContributions` (Task 3) |
| No shared view exposes another member's personal data; the unified view reads only the caller's rows | every report | space reports read the space's transactions only (Tasks 4, 5, 14b); `placesOf(caller)` and sums by member ids (Tasks 7, 8b, 14b) |
| Soft-deleted transactions never count (D8, E7) | every report | the ledger's SQL (`deleted_at IS NULL`, Tasks 4, 7 and M3-A's `expensesByCategory`, `transfersIntoAccounts`) |
| A period is compared with the previous period of the same policy (spec 5.3) | line and personal trends | `periodsEndingWith`, `changeFrom` (Task 10) |
| One currency per sum (D6) | unified view, personal trend, personal spending by group | `personalScope` keeps the personal space's currency (Task 8b) |
| The unified view groups by catalog key or "space / category", a subcategory under its parent category, each group named by the personal space when it holds the key, else by the space spending most in it (P76, P95) | unified view | `consumptionGroups` (Task 8a), the personal space's catalog listed (Task 8b) |
| Savings transfers are cash out only into the caller's own SAVINGS accounts, never INVESTMENT ones (P37, P97) | unified view | `savingsAccountsOf` (Task 9a) |
| An expense counts in `rollUp(categoryId)`, under the group that category sits in now (HU-E3-04, HU-E3-02) | both spending-by-group reports | `treesOf` (Task 13), `placeIn` (Task 13), `spendingTree` (Task 14a) |
| A breakdown sums the existing sums, never its own: amounts for a space, the unified view's shares for the caller (P80) | both spending-by-group reports | `expensesByCategory` (M3-A), `consumptionRows` (Task 14b) |
| Seeded groups and categories merge across the caller's spaces by catalog key, named by the personal space; custom rows and subcategories keep their space (P76, P77, P81) | personal spending by group | `spendingTree` with `PERSONAL` (Task 14a) |

---


### Task 1: Reporting — the line dashboard of a period, from its plan's figures

Implements HU-E7-01 (issue #56) at the use-case level: the new `reporting` module reads a space's period by label, finds the plan whose stored period it is and reports budgeting's own figures for it (`loadPlanView`, ruling P32), or every expense as Unbudgeted when the period has no plan (ruling P33). Pins the golden table and every HU-E7-01 scenario with in-memory adapters.

**Files:**
- Modify: `src/modules/budgeting/application/plan-view.ts`, `src/modules/budgeting/application/index.ts`
- Create: `src/modules/reporting/application/deps.ts`, `src/modules/reporting/application/space-report.ts`, `src/modules/reporting/application/get-line-dashboard.ts`, `src/modules/reporting/application/index.ts`
- Create (test): `tests/support/reporting-world.ts`, `src/modules/reporting/application/line-dashboard.test.ts`

**Interfaces:**
- Consumes: `loadPlanView(deps, space, plan): Promise<BudgetPlanView>` (M3-B Task 11, exported here); `BudgetPlanRepository.covering` and `storedPeriods`; `authorizeSpaceAction(access, spaceId, userId, "space.read")`; `periodByLabel(policy, stored, label): Result<Period>`; `budgetingWorld`, `HOUSEHOLD`, `NOW`, `savingsAccounts` (`tests/support/budgeting-world.ts`); `aLine`, `referenceLines` (`tests/support/budget-fixtures.ts`); `InMemoryBudgetPlans.add`, `seed`.
- Produces: `PlanViewDeps` and `loadPlanView` exported by `@/modules/budgeting/application`; `ReportingDeps { access, members, plans, spending, savingsAccounts, categories }`; `SpaceReportInput { spaceId, userId, period }`; `SpaceReport { space, period, view: BudgetPlanView | null }`; `planViewIn(deps, space, period): Promise<BudgetPlanView | null>`; `spaceReport(deps, input): Promise<Result<SpaceReport>>`; `ReportPlan { id, status }`; `DashboardLine`, `LineDashboard`, `GetLineDashboard`, `createGetLineDashboard(deps: ReportingDeps)`; test support `SpendingByPeriod` (`expenses`, `transfers` keyed by the first day asked for) and `reportingWorld(options)` returning `{ spaces, plans, spending, deps, plan(label, parts?, extra?) }`.

- [ ] **Step 1: Write the failing tests**

`tests/support/reporting-world.ts`:

```ts
import type {
  BudgetPlan,
  BudgetPlanId,
  PlanContents,
  PlanSpending,
  PlanStatus,
} from "@/modules/budgeting/application";
import type { ReportingDeps } from "@/modules/reporting/application";
import type { SpaceMember } from "@/modules/spaces/application";
import { periodByLabel, type LocalDate, type PeriodPolicy } from "@/shared/kernel";
import { budgetingWorld, HOUSEHOLD, NOW, savingsAccounts } from "./budgeting-world";
import { unwrap } from "./fakes";

/** PlanSpending of each period, keyed by the first day the ledger is asked for, as it sums them on read (D7). */
export class SpendingByPeriod implements PlanSpending {
  readonly expenses: Record<string, { categoryId: string; amount: bigint }[]> = {};
  readonly transfers: Record<string, { accountId: string; amount: bigint }[]> = {};

  async expensesByCategory(_spaceId: string, from: LocalDate) {
    return [...(this.expenses[from] ?? [])];
  }

  async transfersIntoAccounts(accountIds: readonly string[], from: LocalDate) {
    return (this.transfers[from] ?? []).filter((t) => accountIds.includes(t.accountId));
  }
}

/**
 * HU-E7 Background: Household (`space-household`, COP) with the HU-E6 members unless given (OWNER Ana, MEMBER
 * Juan, VIEWER Sofi, the guest Pedro), in-memory plans and the ledger's spending per period. `plan` stores a plan of
 * Household for a period label with its parts, ACTIVE unless told otherwise, as budgeting's use cases leave it.
 */
export const reportingWorld = (
  options: { readonly members?: readonly SpaceMember[]; readonly periodPolicy?: PeriodPolicy } = {},
) => {
  const w = budgetingWorld(options);
  const spending = new SpendingByPeriod();
  const deps: ReportingDeps = {
    access: w.deps.access,
    members: w.spaces,
    plans: w.plans,
    spending,
    savingsAccounts,
    categories: w.deps.categories,
  };
  let created = 0;
  const plan = async (
    label: string,
    parts: Partial<PlanContents> = {},
    extra: { readonly status?: PlanStatus; readonly createdFrom?: string } = {},
  ): Promise<BudgetPlan> => {
    const policy = options.periodPolicy ?? { kind: "MONTHLY", day: 1 };
    const period = unwrap(periodByLabel(policy, await w.plans.storedPeriods(HOUSEHOLD), label));
    created += 1;
    const stored: BudgetPlan = {
      id: `plan-${created}` as BudgetPlanId,
      spaceId: HOUSEHOLD,
      period,
      status: extra.status ?? "ACTIVE",
      createdFrom: (extra.createdFrom ?? null) as BudgetPlanId | null,
      version: 1,
      createdBy: "u-ana",
      createdAt: NOW,
    };
    await w.plans.add(stored);
    w.plans.seed(stored.id, parts);
    return stored;
  };
  return { ...w, spending, deps, plan };
};
```

`src/modules/reporting/application/line-dashboard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BudgetLineId } from "@/modules/budgeting/application";
import { aLine, referenceLines } from "../../../../tests/support/budget-fixtures";
import { HOUSEHOLD } from "../../../../tests/support/budgeting-world";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { reportingWorld } from "../../../../tests/support/reporting-world";
import { createGetLineDashboard, type LineDashboard } from "./get-line-dashboard";

const pesos = (n: number) => BigInt(n) * 100n;
const NOVEMBER = "2026-11-01";

/** Spec section 4 with Free not the catch-all (ruling P34) and the E7 mappings; Restaurants stays unmapped. */
const referenceParts = () => ({
  capacities: [
    { memberId: "member-ana", amount: pesos(1_600_000) },
    { memberId: "member-juan", amount: pesos(2_400_000) },
  ],
  lines: referenceLines().map((line) => (line.name === "Free" ? { ...line, isCatchAll: false } : line)),
  mappings: [
    { lineId: "line-rent", categoryId: "cat-rent" },
    { lineId: "line-home", categoryId: "cat-groceries" },
    { lineId: "line-home", categoryId: "cat-utilities" },
    { lineId: "line-free", categoryId: "cat-entertainment" },
  ],
});

/** HU-E7-01 Background: November 2026 by category, as the ledger sums it. */
const novemberSpending = () => [
  { categoryId: "cat-rent", amount: pesos(1_200_000) },
  { categoryId: "cat-groceries", amount: pesos(900_000) },
  { categoryId: "cat-utilities", amount: pesos(400_000) },
  { categoryId: "cat-entertainment", amount: pesos(250_000) },
  { categoryId: "cat-restaurants", amount: pesos(60_000) },
];

const read = (w: ReturnType<typeof reportingWorld>, userId = "u-ana", period = "2026-11") =>
  createGetLineDashboard(w.deps)({ spaceId: HOUSEHOLD, userId, period });
const rows = (dashboard: LineDashboard) =>
  dashboard.lines.map((l) => [l.name, l.planned, l.spent, l.available, l.overspent]);

describe("line dashboard (HU-E7-01)", () => {
  it("reports planned, spent and available per line and the unmapped spending as Unbudgeted (@golden)", async () => {
    const w = reportingWorld();
    const plan = await w.plan("2026-11", referenceParts());
    w.spending.expenses[NOVEMBER] = novemberSpending();
    const dashboard = unwrap(await read(w));
    expect(dashboard.plan).toEqual({ id: plan.id, status: "ACTIVE" });
    expect(dashboard.period).toEqual({ start: "2026-11-01", end: "2026-11-30", label: "2026-11" });
    expect(rows(dashboard)).toEqual([
      ["Rent", pesos(1_200_000), pesos(1_200_000), 0n, false],
      ["Home", pesos(1_470_000), pesos(1_300_000), pesos(170_000), false],
      ["Savings", pesos(600_000), 0n, pesos(600_000), false],
      ["Free", pesos(730_000), pesos(250_000), pesos(480_000), false],
    ]);
    expect(dashboard.unbudgeted).toEqual({ spent: pesos(60_000), available: -pesos(60_000), overspent: true });
  });

  it("flags Home as overspent once a 300,000 COP Groceries expense takes it to -130,000 COP", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", referenceParts());
    w.spending.expenses[NOVEMBER] = [...novemberSpending(), { categoryId: "cat-groceries", amount: pesos(300_000) }];
    const dashboard = unwrap(await read(w));
    expect(dashboard.lines.find((l) => l.name === "Home")).toMatchObject({
      spent: pesos(1_600_000),
      available: -pesos(130_000),
      overspent: true,
    });
    expect(dashboard.lines.filter((l) => l.overspent).map((l) => l.name)).toEqual(["Home"]);
  });

  it("includes Home's ROLLOVER carry-over of 200,000 COP from 2026-10 in its available amount", async () => {
    const w = reportingWorld();
    const october = await w.plan(
      "2026-10",
      {
        capacities: [{ memberId: "member-ana", amount: pesos(4_000_000) }],
        lines: [aLine("Home", pesos(1_470_000), { id: "line-home-oct" as BudgetLineId, rolloverMode: "ROLLOVER" })],
        mappings: [{ lineId: "line-home-oct", categoryId: "cat-groceries" }],
      },
      { status: "CLOSED" },
    );
    const parts = referenceParts();
    await w.plan(
      "2026-11",
      {
        ...parts,
        lines: parts.lines.map((l) =>
          l.name === "Home" ? { ...l, originLineId: "line-home-oct", rolloverMode: "ROLLOVER" as const } : l,
        ),
      },
      { createdFrom: october.id },
    );
    w.spending.expenses["2026-10-01"] = [{ categoryId: "cat-groceries", amount: pesos(1_270_000) }];
    w.spending.expenses[NOVEMBER] = novemberSpending();
    expect(unwrap(await read(w)).lines.find((l) => l.name === "Home")).toMatchObject({
      carryOver: pesos(200_000),
      available: pesos(370_000),
    });
  });

  it("reports every expense of a period without a plan under Unbudgeted, and that no plan exists", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", referenceParts());
    w.spending.expenses["2027-01-01"] = [
      { categoryId: "cat-groceries", amount: pesos(100_000) },
      { categoryId: "cat-restaurants", amount: pesos(60_000) },
    ];
    const dashboard = unwrap(await read(w, "u-ana", "2027-01"));
    expect(dashboard).toMatchObject({
      plan: null,
      lines: [],
      period: { label: "2027-01", start: "2027-01-01", end: "2027-01-31" },
    });
    expect(dashboard.unbudgeted).toEqual({ spent: pesos(160_000), available: -pesos(160_000), overspent: true });
  });

  it("has no Unbudgeted entry when the plan has a catch-all line, which consumes the unmapped spending", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", { ...referenceParts(), lines: referenceLines() });
    w.spending.expenses[NOVEMBER] = novemberSpending();
    const dashboard = unwrap(await read(w));
    expect(dashboard.unbudgeted).toBeNull();
    expect(dashboard.lines.find((l) => l.name === "Free")).toMatchObject({
      isCatchAll: true,
      spent: pesos(310_000),
      available: pesos(420_000),
    });
  });

  it("reports a DRAFT plan's figures as well, whatever its status (ruling P33)", async () => {
    const w = reportingWorld();
    const plan = await w.plan("2026-11", referenceParts(), { status: "DRAFT" });
    w.spending.expenses[NOVEMBER] = novemberSpending();
    const dashboard = unwrap(await read(w));
    expect(dashboard.plan).toEqual({ id: plan.id, status: "DRAFT" });
    expect(dashboard.lines.map((l) => l.name)).toEqual(["Rent", "Home", "Savings", "Free"]);
  });

  it("lets every member read it, VIEWER Sofi included, and an archived space too (HU-E1-09)", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", referenceParts());
    expect(unwrap(await read(w, "u-sofi")).lines).toHaveLength(4);
    w.spaces.archived.add(HOUSEHOLD);
    expect(unwrap(await read(w, "u-juan")).lines).toHaveLength(4);
  });

  it("hides the space from non-members and malformed ids, and refuses labels the policy does not name", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", referenceParts());
    expect(codeOf(await read(w, "u-marta"))).toBe("SpaceNotFound");
    const malformed = await createGetLineDashboard(w.deps)({ spaceId: "not-a-uuid", userId: "u-ana", period: "2026-11" });
    expect(codeOf(malformed)).toBe("SpaceNotFound");
    for (const label of ["2026-13", "2026-11 H1", "November"]) {
      expect(codeOf(await read(w, "u-ana", label))).toBe("InvalidPeriodLabel");
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting`
Expected: FAIL — `Cannot find module './get-line-dashboard'` (and `@/modules/reporting/application` in the world).

- [ ] **Step 3: Implement**

In `src/modules/budgeting/application/plan-view.ts`, insert after the line `type ViewDeps = Pick<BudgetingDeps, "members" | "plans" | "spending" | "savingsAccounts" | "categories">;`:

```ts
/** What reading a plan's figures takes; reporting reads plans through the same ports (HU-E7-01, ruling P32). */
export type PlanViewDeps = ViewDeps;
```

In `src/modules/budgeting/application/index.ts`, append to the end of the file:

```ts
export { loadPlanView, type PlanViewDeps } from "./plan-view";
```

`src/modules/reporting/application/deps.ts`:

```ts
import type {
  BudgetCategories,
  BudgetPlanRepository,
  PlanSpending,
  SavingsAccountReader,
} from "@/modules/budgeting/application";
import type { SpaceAccess, SpaceMemberRepository } from "@/modules/spaces/application";

/**
 * What every space report needs (HU-E7-01 … HU-E7-03, HU-E7-05): the space access, its current members (ruling P7),
 * and budgeting's plans and the ledger's spending through budgeting's own ports, so a report's figures are the
 * plan's figures, derived on read (D7, ruling P32). The composition root binds the adapters it gives budgeting.
 */
export interface ReportingDeps {
  readonly access: SpaceAccess;
  readonly members: Pick<SpaceMemberRepository, "listCurrent">;
  readonly plans: BudgetPlanRepository;
  readonly spending: PlanSpending;
  readonly savingsAccounts: SavingsAccountReader;
  /** HU-E3-04: the space's live categories with their parents, so a plan's figures roll subcategories up (D20). */
  readonly categories: BudgetCategories;
}
```

`src/modules/reporting/application/space-report.ts`:

```ts
import { loadPlanView, type BudgetPlanView, type PlanStatus } from "@/modules/budgeting/application";
import { authorizeSpaceAction, type SpaceMembership } from "@/modules/spaces/application";
import { ok, periodByLabel, type Period, type Result } from "@/shared/kernel";
import type { ReportingDeps } from "./deps";

/** Who reads which space's report, for which period label of the space policy ("2026-11", "2026-11 H1"). */
export interface SpaceReportInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly period: string;
}

/** The plan a report reads, whatever its status (ruling P33). */
export interface ReportPlan {
  readonly id: string;
  readonly status: PlanStatus;
}

/** A period of a space and the plan whose stored period it is, with every figure derived on read (D7). */
export interface SpaceReport {
  readonly space: SpaceMembership;
  readonly period: Period;
  /** Null when no plan has this period (ruling P33). */
  readonly view: BudgetPlanView | null;
}

/** The plan whose stored period holds `period`'s first day, whatever its status (ruling P33), with its figures. */
export const planViewIn = async (
  deps: ReportingDeps,
  space: SpaceMembership,
  period: Period,
): Promise<BudgetPlanView | null> => {
  const plan = await deps.plans.covering(space.spaceId, period.start);
  return plan === null ? null : loadPlanView(deps, space, plan);
};

/**
 * HU-E7-01 … HU-E7-03, HU-E7-05: every member reads a space's reports (space.read), archived spaces included
 * (HU-E1-09). The period is the stored one with that label, else the policy's period around the stored ones (D10).
 */
export const spaceReport = async (
  deps: ReportingDeps,
  input: SpaceReportInput,
): Promise<Result<SpaceReport>> => {
  const reader = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
  if (!reader.ok) return reader;
  const space = reader.value;
  const period = periodByLabel(space.periodPolicy, await deps.plans.storedPeriods(space.spaceId), input.period);
  if (!period.ok) return period;
  return ok({ space, period: period.value, view: await planViewIn(deps, space, period.value) });
};

export const reportPlanOf = (view: BudgetPlanView | null): ReportPlan | null =>
  view === null ? null : { id: view.plan.id, status: view.plan.status };
```

`src/modules/reporting/application/get-line-dashboard.ts`:

```ts
import type { Funding } from "@/modules/budgeting/application";
import { ok, type Period, type Result } from "@/shared/kernel";
import type { ReportingDeps } from "./deps";
import { reportPlanOf, spaceReport, type ReportPlan, type SpaceReportInput } from "./space-report";

/** HU-E7-01: one budget line of the period's plan; `overspent` while its available amount is negative. */
export interface DashboardLine {
  readonly lineId: string;
  readonly name: string;
  readonly funding: Funding;
  readonly isCatchAll: boolean;
  readonly planned: bigint;
  readonly spent: bigint;
  readonly carryOver: bigint;
  readonly available: bigint;
  readonly overspent: boolean;
}

/** Spending no line consumes, available = −spent (HU-E6-04); `overspent` once anything was spent there. */
export interface UnbudgetedSpending {
  readonly spent: bigint;
  readonly available: bigint;
  readonly overspent: boolean;
}

export interface LineDashboard {
  readonly spaceId: string;
  readonly currency: string;
  readonly period: Period;
  /** Null when the period has no plan; every expense is then Unbudgeted (ruling P33). */
  readonly plan: ReportPlan | null;
  /** The plan's lines in plan order; none without a plan. */
  readonly lines: readonly DashboardLine[];
  /** Null when the plan has a catch-all line, which consumes every unmapped category (HU-E6-04, ruling P34). */
  readonly unbudgeted: UnbudgetedSpending | null;
}

export type GetLineDashboard = (input: SpaceReportInput) => Promise<Result<LineDashboard>>;

const unbudgeted = (spent: bigint): UnbudgetedSpending => ({ spent, available: -spent, overspent: spent > 0n });

/**
 * HU-E7-01: planned, spent, carry-over and available per line of the period's plan, exactly as the plan reports
 * them (`loadPlanView`, spec 5.4, ruling P32), computed on read (D7).
 */
export const createGetLineDashboard =
  (deps: ReportingDeps): GetLineDashboard =>
  async (input) => {
    const report = await spaceReport(deps, input);
    if (!report.ok) return report;
    const { space, period, view } = report.value;
    const base = { spaceId: space.spaceId, currency: space.currency, period, plan: reportPlanOf(view) };
    if (view === null) {
      const spending = await deps.spending.expensesByCategory(space.spaceId, period.start, period.end);
      return ok({ ...base, lines: [], unbudgeted: unbudgeted(spending.reduce((sum, c) => sum + c.amount, 0n)) });
    }
    const { figures } = view;
    return ok({
      ...base,
      lines: figures.lines.map((f) => ({
        lineId: f.line.id,
        name: f.line.name,
        funding: f.line.funding,
        isCatchAll: f.line.isCatchAll,
        planned: f.line.plannedAmount,
        spent: f.spent,
        carryOver: f.carryOver,
        available: f.available,
        overspent: f.available < 0n,
      })),
      unbudgeted: figures.unbudgeted === null ? null : unbudgeted(figures.unbudgeted.spent),
    });
  };
```

`src/modules/reporting/application/index.ts`:

```ts
export type { ReportingDeps } from "./deps";
export type { ReportPlan, SpaceReport, SpaceReportInput } from "./space-report";
export {
  createGetLineDashboard,
  type DashboardLine,
  type GetLineDashboard,
  type LineDashboard,
  type UnbudgetedSpending,
} from "./get-line-dashboard";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/reporting src/modules/budgeting`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0; `pnpm lint:boundaries` accepts `reporting` reaching `budgeting` and `spaces` only through their `application/index.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/application/plan-view.ts src/modules/budgeting/application/index.ts src/modules/reporting/application tests/support/reporting-world.ts
git commit -m "feat(reporting): derive a period's line dashboard from its plan's figures (Refs #56)"
```

---

### Task 2a: HTTP — the line dashboard

Implements HU-E7-01 (issue #56) over HTTP: `GET /api/v1/spaces/{spaceId}/reports/lines?period=<label>`. Creates the reporting contract, the `Container.reporting` group and the shared acceptance support every later report uses. Pins the `@critical @golden` scenario against PostgreSQL; Task 2b adds the remaining scenarios and the backlog note (this half measures 489 lines, 200 of them snapshot; see Measured sizes for its fallback split point).

**Files:**
- Create: `src/modules/reporting/contracts/reporting.contract.ts`, `src/app/api/v1/spaces/[spaceId]/reports/lines/route.ts`
- Modify: `src/composition/container.ts`, `src/composition/openapi.ts`, `openapi/openapi.snapshot.json`
- Create (test): `tests/support/reporting.ts`, `tests/acceptance/reports-lines.test.ts`

**Interfaces:**
- Consumes: `createGetLineDashboard`, `GetLineDashboard`, `LineDashboard`, `ReportPlan`, `UnbudgetedSpending` (Task 1); `FUNDINGS`, `PLAN_STATUSES` (`@/modules/budgeting/application`); `MoneySchema`, `PeriodSchema`, `periodDto`, `problems`, `jsonContent`, `securedByUser`, `MoneyDto` (`@/shared/http/contracts`); `referencePlan`, `putCategories` (`tests/support/budgeting.ts`); `categoryWithKey`, `cop`, `newAccount`, `post`, `HouseholdMember` (`tests/support/ledger.ts`); `call`, `RouteHandler`, `TestUser` (`tests/support/app.ts`).
- Produces: `ReportQuerySchema`, `ReportPlanSchema`, `reportPlanDto`, `moneyOf`, `reportProblems`, `SpacePath`, `LineDashboardSchema`, `lineDashboardDto`, `reportingPaths` in `reporting.contract.ts`; `Container.reporting.getLineDashboard`; `reportingDeps` in the composition root; test support `getWithQuery(handler, user, path, query, params)`, `getLineDashboard(user, spaceId, query)`, `reportHousehold()` returning the `referencePlan()` result plus `category { rent, groceries, utilities, entertainment, restaurants }` and `fund`, `spend(payer, categoryId, pesos, date, fund?)`, and the DTO types `ReportPlanDto`, `ReportPeriodDto`, `DashboardLineDto`, `LineDashboardDto`.

- [ ] **Step 1: Write the failing tests**

`tests/support/reporting.ts`:

```ts
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { GET as linesRoute } from "@/app/api/v1/spaces/[spaceId]/reports/lines/route";
import { call, type RouteHandler, type TestUser } from "./app";
import { putCategories, referencePlan } from "./budgeting";
import { categoryWithKey, cop, newAccount, post, type HouseholdMember, type MoneyDto } from "./ledger";

export interface ReportPeriodDto {
  label: string;
  startDate: string;
  endDate: string;
}
export interface ReportPlanDto {
  id: string;
  status: string;
}
export interface DashboardLineDto {
  lineId: string;
  name: string;
  funding: string;
  isCatchAll: boolean;
  planned: MoneyDto;
  spent: MoneyDto;
  carryOver: MoneyDto;
  available: MoneyDto;
  overspent: boolean;
}
export interface LineDashboardDto {
  spaceId: string;
  period: ReportPeriodDto;
  plan: ReportPlanDto | null;
  lines: DashboardLineDto[];
  unbudgeted: { spent: MoneyDto; available: MoneyDto; overspent: boolean } | null;
}

/** GETs `path` with `query` in its search string as `user`; `params` are the route's path parameters. */
export const getWithQuery = (
  handler: RouteHandler,
  user: TestUser,
  path: string,
  query: Record<string, string | number>,
  params: Record<string, string> = {},
) => {
  const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  return call(handler, "GET", `${path}?${search.toString()}`, { user, params });
};

/** HU-E7-01: `user` reads the line dashboard of `spaceId`. */
export const getLineDashboard = (user: TestUser, spaceId: string, query: Record<string, string>) =>
  getWithQuery(linesRoute, user, `/api/v1/spaces/${spaceId}/reports/lines`, query, { spaceId });

/**
 * HU-E7 Background: `referencePlan()` (2026-11, DRAFT, no catch-all line, ruling P34) with Rent → Rent, Groceries and
 * Utilities → Home and Entertainment → Free (Restaurants unmapped), and the SHARED_FUND "Household Fund".
 */
export const reportHousehold = async () => {
  const ref = await referencePlan();
  const { h, planId, lineId } = ref;
  const category = {
    rent: await categoryWithKey(h.ana, "rent"),
    groceries: h.groceries,
    utilities: await categoryWithKey(h.ana, "utilities"),
    entertainment: await categoryWithKey(h.ana, "entertainment"),
    restaurants: await categoryWithKey(h.ana, "restaurants"),
  };
  const map = async (line: string, categoryIds: string[]) => {
    const response = await putCategories(h.ana, h.spaceId, planId, lineId(line), categoryIds);
    if (response.status !== 200) throw new Error(`mapping failed with status ${response.status}`);
  };
  await map("Rent", [category.rent]);
  await map("Home", [category.groceries, category.utilities]);
  await map("Free", [category.entertainment]);
  return { ...ref, category, fund: await newAccount(h.ana, "Household Fund", 1_500_000, "SHARED_FUND") };
};

/**
 * `payer` records an expense of `pesos` in the household on `date`, from their own account or from `fund`; without a
 * split, so the default split applies (spec 5.3: BY_ALLOCATION under an ACTIVE plan, else EQUAL).
 */
export const spend = async (
  payer: HouseholdMember,
  categoryId: string,
  pesos: number,
  date: string,
  fund?: string,
): Promise<void> => {
  const paidBy =
    fund === undefined
      ? { accountId: payer.account }
      : { payments: [{ memberId: null, accountId: fund, amount: cop(pesos) }] };
  const response = await post(recordExpense, payer, "expenses", {
    description: "Expense",
    date,
    categoryId,
    amount: cop(pesos),
    ...paidBy,
  });
  if (response.status !== 201) throw new Error(`expense failed with status ${response.status}`);
};
```

`tests/acceptance/reports-lines.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setContainerForTests, type Container } from "@/composition/container";
import { startTestApp, type TestUser } from "../support/app";
import { cop } from "../support/ledger";
import { getLineDashboard, reportHousehold, spend, type LineDashboardDto } from "../support/reporting";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

type ReportHousehold = Awaited<ReturnType<typeof reportHousehold>>;

/** HU-E7-01 Background: November 2026's expenses; Restaurants on the period's last day. */
const novemberExpenses = async ({ h, category, fund }: ReportHousehold) => {
  await spend(h.ana, category.rent, 1_200_000, "2026-11-01", fund);
  await spend(h.ana, category.groceries, 900_000, "2026-11-05");
  await spend(h.juan, category.utilities, 400_000, "2026-11-10");
  await spend(h.juan, category.entertainment, 250_000, "2026-11-15");
  await spend(h.ana, category.restaurants, 60_000, "2026-11-30");
};

const dashboardOf = async (user: TestUser, spaceId: string, period: string): Promise<LineDashboardDto> => {
  const response = await getLineDashboard(user, spaceId, { period });
  expect(response.status).toBe(200);
  return (await response.json()) as LineDashboardDto;
};

describe("line dashboard over HTTP (HU-E7-01)", () => {
  it("reports planned, spent and available per line, and Restaurants as Unbudgeted (@critical @golden)", async () => {
    const r = await reportHousehold();
    await novemberExpenses(r);
    // Review Focus 2: the next period's first day is not November's.
    await spend(r.h.ana, r.category.groceries, 70_000, "2026-12-01");
    const dashboard = await dashboardOf(r.h.ana, r.h.spaceId, "2026-11");
    expect(dashboard.plan).toEqual({ id: r.planId, status: "DRAFT" });
    expect(dashboard.period).toEqual({ label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" });
    expect(dashboard.lines.map((l) => [l.name, l.planned, l.spent, l.available, l.overspent])).toEqual([
      ["Rent", cop(1_200_000), cop(1_200_000), cop(0), false],
      ["Home", cop(1_470_000), cop(1_300_000), cop(170_000), false],
      ["Savings", cop(600_000), cop(0), cop(600_000), false],
      ["Free", cop(730_000), cop(250_000), cop(480_000), false],
    ]);
    expect(dashboard.unbudgeted).toEqual({ spent: cop(60_000), available: cop(-60_000), overspent: true });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/reports-lines.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/v1/spaces/[spaceId]/reports/lines/route'`.

- [ ] **Step 3: Implement**

`src/modules/reporting/contracts/reporting.contract.ts`:

```ts
import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { FUNDINGS, PLAN_STATUSES } from "@/modules/budgeting/application";
import {
  jsonContent,
  MoneySchema,
  PeriodSchema,
  periodDto,
  problems,
  securedByUser,
  type MoneyDto,
} from "@/shared/http/contracts";
import type { LineDashboard, ReportPlan, UnbudgetedSpending } from "../application";

const moneyOf = (minor: bigint, currency: string): MoneyDto => ({ amount: minor.toString(), currency });

/** HU-E7-01 … HU-E7-03: the period's label in the space policy, "2026-11" (MONTHLY) or "2026-11 H1" (SEMI_MONTHLY). */
export const ReportQuerySchema = z.object({ period: z.string().min(1).max(32) });

/** The plan the report reads, whatever its status; null when the period has no plan (ruling P33). */
const ReportPlanSchema = z.object({ id: z.string(), status: z.enum(PLAN_STATUSES) }).nullable();

const reportPlanDto = (plan: ReportPlan | null): z.infer<typeof ReportPlanSchema> =>
  plan === null ? null : { id: plan.id, status: plan.status };

/** HU-E7-01: each line as the plan derives it (spec 5.4, D7). */
export const LineDashboardSchema = z.object({
  spaceId: z.string(),
  period: PeriodSchema,
  plan: ReportPlanSchema,
  /** The plan's lines in plan order; empty without a plan. */
  lines: z.array(
    z.object({
      lineId: z.string(),
      name: z.string(),
      funding: z.enum(FUNDINGS),
      isCatchAll: z.boolean(),
      planned: MoneySchema,
      spent: MoneySchema,
      /** HU-E6-09: carried from the line this one was copied from, by its rollover mode. */
      carryOver: MoneySchema,
      /** planned + carry-over − spent. */
      available: MoneySchema,
      /** The available amount is negative. */
      overspent: z.boolean(),
    }),
  ),
  /** What no line consumes, every expense without a plan; null when the plan has a catch-all line (ruling P34). */
  unbudgeted: z.object({ spent: MoneySchema, available: MoneySchema, overspent: z.boolean() }).nullable(),
});

const unbudgetedDto = (unbudgeted: UnbudgetedSpending | null, currency: string) =>
  unbudgeted === null
    ? null
    : {
        spent: moneyOf(unbudgeted.spent, currency),
        available: moneyOf(unbudgeted.available, currency),
        overspent: unbudgeted.overspent,
      };

export const lineDashboardDto = (dashboard: LineDashboard): z.infer<typeof LineDashboardSchema> => ({
  spaceId: dashboard.spaceId,
  period: periodDto(dashboard.period),
  plan: reportPlanDto(dashboard.plan),
  lines: dashboard.lines.map((line) => ({
    lineId: line.lineId,
    name: line.name,
    funding: line.funding,
    isCatchAll: line.isCatchAll,
    planned: moneyOf(line.planned, dashboard.currency),
    spent: moneyOf(line.spent, dashboard.currency),
    carryOver: moneyOf(line.carryOver, dashboard.currency),
    available: moneyOf(line.available, dashboard.currency),
    overspent: line.overspent,
  })),
  unbudgeted: unbudgetedDto(dashboard.unbudgeted, dashboard.currency),
});

const SpacePath = z.object({ spaceId: z.string() });
const reportProblems = problems({
  "401": "Unauthenticated",
  "404": "SpaceNotFound",
  "422": "ValidationFailed, InvalidPeriodLabel",
});

export const reportingPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces/{spaceId}/reports/lines": {
    get: {
      operationId: "getLineDashboard",
      summary: "Planned, spent and available per budget line for a period; computed on read",
      description:
        "Every member reads it, archived spaces included. The period's plan is reported whatever its status; without one, `plan` is null and every expense is under `unbudgeted`.",
      ...securedByUser,
      requestParams: { path: SpacePath, query: ReportQuerySchema },
      responses: {
        "200": {
          description: "The lines of the period's plan in plan order, and what no line consumes",
          content: jsonContent(LineDashboardSchema),
        },
        ...reportProblems,
      },
    },
  },
};
```

`src/app/api/v1/spaces/[spaceId]/reports/lines/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { lineDashboardDto, ReportQuerySchema } from "@/modules/reporting/contracts/reporting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: ReportQuerySchema,
  handler: async ({ user, params, query }) => {
    const result = await getContainer().reporting.getLineDashboard({
      spaceId: params.spaceId!,
      userId: user!.id,
      period: query.period,
    });
    return result.ok ? ok({ status: 200, body: lineDashboardDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert after the line `import { DrizzleBudgetPlanRepository } from "@/modules/budgeting/infrastructure/drizzle-budget-plan-repository";`:

```ts
import { createGetLineDashboard, type GetLineDashboard } from "@/modules/reporting/application";
```

2. Insert before the line `  /** Brute-force guards for the unauthenticated identity routes; false means "reject with 429". */`:

```ts
  readonly reporting: {
    readonly getLineDashboard: GetLineDashboard;
  };
```

3. Insert before the line `  const invitationRepository = new DrizzleInvitationRepository(tm);`:

```ts
  // HU-E7-01 … HU-E7-05: reports read budgeting's figures and the ledger's sums through ports, on read (D7, P32).
  const reportingDeps = {
    access,
    members: spaceRepository,
    plans: budgetPlans,
    spending: ledgerQueries,
    savingsAccounts,
    categories: budgetCategories,
  };
```

4. Insert before the line `    authThrottle: {`:

```ts
    reporting: {
      getLineDashboard: createGetLineDashboard(reportingDeps),
    },
```

In `src/composition/openapi.ts`:

1. Insert after the line `import { BudgetPlanSchema, budgetingPaths } from "@/modules/budgeting/contracts/budgeting.contract";`:

```ts
import { reportingPaths } from "@/modules/reporting/contracts/reporting.contract";
```

2. Insert after the line `      ...budgetingPaths,`:

```ts
      ...reportingPaths,
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds only `GET /api/v1/spaces/{spaceId}/reports/lines` (about 200 lines; `period` references the existing `Period` component and the amounts the existing `MoneyOutput`); no component is added or changed. If a `PeriodOutput` or any other new `…Output` component appears, replace `period: PeriodSchema` with `period: PeriodSchema.extend({})` (the `BudgetPlanSchema` precedent) instead of accepting it.
Then run: `pnpm exec vitest run --project acceptance tests/acceptance/reports-lines.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/reporting/contracts/reporting.contract.ts "src/app/api/v1/spaces/[spaceId]/reports/lines/route.ts" src/composition/container.ts src/composition/openapi.ts openapi/openapi.snapshot.json tests/support/reporting.ts tests/acceptance/reports-lines.test.ts
git commit -m "feat(reporting): serve the line dashboard over HTTP (Refs #56)"
```

---

### Task 2b: HTTP — the line dashboard's other scenarios and its backlog note

Completes HU-E7-01 (issue #56) over HTTP: the overspent line, the period without a plan, who may read and the refused labels, against PostgreSQL, and the story's backlog note. The behaviour was test-driven at the use-case level in Task 1 and served in Task 2a, so these tests pass on their first run; each pins one HTTP-observable outcome.

**Files:**
- Modify: `tests/acceptance/reports-lines.test.ts`, `docs/backlog/E7-reporting.md`

**Interfaces:**
- Consumes: `novemberExpenses`, `dashboardOf` (Task 2a, in the test file); `reportHousehold`, `spend`, `getLineDashboard` (Task 2a); `joinHousehold`, `cop`; `problemOf`, `registerUser`.
- Produces: nothing new.

- [ ] **Step 1: Write the tests**

In `tests/acceptance/reports-lines.test.ts`:

1. Replace the line `import { startTestApp, type TestUser } from "../support/app";` with:

```ts
import { problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
```

2. Replace the line `import { cop } from "../support/ledger";` with:

```ts
import { cop, joinHousehold } from "../support/ledger";
```

3. Insert before the last line of the file (`});`, the end of the `describe`):

```ts

  it("flags Home as overspent after a 300,000 COP Groceries expense on 2026-11-20", async () => {
    const r = await reportHousehold();
    await novemberExpenses(r);
    await spend(r.h.ana, r.category.groceries, 300_000, "2026-11-20");
    const home = (await dashboardOf(r.h.juan, r.h.spaceId, "2026-11")).lines.find((l) => l.name === "Home");
    expect(home).toMatchObject({ spent: cop(1_600_000), available: cop(-130_000), overspent: true });
  });

  it("answers plan null and reports every expense under Unbudgeted for 2027-01, which has no plan", async () => {
    const r = await reportHousehold();
    await spend(r.h.ana, r.category.groceries, 100_000, "2027-01-10");
    const dashboard = await dashboardOf(r.h.ana, r.h.spaceId, "2027-01");
    expect(dashboard).toMatchObject({ plan: null, lines: [], period: { label: "2027-01" } });
    expect(dashboard.unbudgeted).toEqual({ spent: cop(100_000), available: cop(-100_000), overspent: true });
  });

  it("lets VIEWER Sofi read it and hides the space from non-members and malformed ids", async () => {
    const r = await reportHousehold();
    const sofi = await joinHousehold(r.h, "Sofi", "VIEWER");
    expect((await dashboardOf(sofi, r.h.spaceId, "2026-11")).lines).toHaveLength(4);
    const marta = await registerUser("Marta");
    expect(await problemOf(await getLineDashboard(marta, r.h.spaceId, { period: "2026-11" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    expect(await problemOf(await getLineDashboard(r.h.ana, "not-a-uuid", { period: "2026-11" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
  });

  it("refuses a missing period and a label the space policy does not name", async () => {
    const r = await reportHousehold();
    expect(await problemOf(await getLineDashboard(r.h.ana, r.h.spaceId, {}))).toEqual([422, "ValidationFailed"]);
    expect(await problemOf(await getLineDashboard(r.h.ana, r.h.spaceId, { period: "2026-11 H1" }))).toEqual([
      422,
      "InvalidPeriodLabel",
    ]);
  });
```

In `docs/backlog/E7-reporting.md`, insert after the line `- Uses `RolloverCalculator` from `budgeting` for available amounts. Charts and the "create or copy a plan" prompt are web UI (HU-E9-10).`:

```markdown
- `GET …/reports/lines?period=<label>` is `space.read` (every role; archived spaces read, HU-E1-09). The period is the stored period with that label, else the policy's period (D10); the plan is the one whose stored period it is, whatever its status (M4 ruling P33). Each line carries `planned`, `spent`, `carryOver`, `available` and `overspent` (available < 0), exactly as `GET …/plans/{planId}` derives them; `unbudgeted` (`spent`, `available` = −spent, `overspent`) holds what no line consumes and is null when the plan has a catch-all line (ruling P34). Without a plan, `plan` is null, `lines` is empty and every expense is under `unbudgeted`. Pending occurrences are not reported as "expected" (ruling P34). Errors: `SpaceNotFound` (404), `ValidationFailed` and `InvalidPeriodLabel` (422).
```

- [ ] **Step 2: Run the tests**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/reports-lines.test.ts`
Expected: PASS (Task 1 drove each behaviour red first; to see each test bite, invert one expectation, run, see it fail, restore it).

- [ ] **Step 3: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/acceptance/reports-lines.test.ts docs/backlog/E7-reporting.md
git commit -m "test(reporting): pin the overspent, planless and refused line dashboards over HTTP (Refs #56)"
```

---

### Task 3: Reporting domain — member by line cells and fund contributions

Implements the spec 5.4 per-member and fund-level formulas behind HU-E7-02 (issue #57) and HU-E7-03 (issue #58) as pure functions: `contributed`, `consumed`, `gap` and its status per member and line with the reason codes of ruling P35, and `expected`, `actual` and `difference` per member (ruling P36). Pins both golden tables.

**Files:**
- Create: `src/modules/reporting/domain/member-matrix.ts`, `src/modules/reporting/domain/fund-contributions.ts`
- Create (test): `src/modules/reporting/domain/member-matrix.test.ts`, `src/modules/reporting/domain/fund-contributions.test.ts`

**Interfaces:**
- Consumes: nothing outside the module.
- Produces: `MATRIX_REASONS`, `MatrixReason` (`"NOT_ALLOCATED" | "TRACKED_AT_FUND_LEVEL" | "INVALID_ALLOCATION"`), `GAP_STATUSES`, `GapStatus` (`"OVER_CONTRIBUTED" | "UNDER_CONTRIBUTED" | "ON_TARGET"`), `LineSums { funding, allocated, invalid, members: { memberId, assigned, contributed, consumed }[] }`, `MatrixCell { memberId, assigned, contributed, consumed, gap, status }`, `MatrixRow { reason, members }`, `gapStatus(gap)`, `matrixRow(line: LineSums): MatrixRow`; `FundLine { members: { memberId, assigned }[] }`, `FundContribution { memberId, expected, actual, difference }`, `fundContributions(memberIds, fundLines, contributions): FundContribution[]`.

- [ ] **Step 1: Write the failing tests**

`src/modules/reporting/domain/member-matrix.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { gapStatus, matrixRow, type LineSums } from "./member-matrix";

const pesos = (n: number) => BigInt(n) * 100n;
const member = (memberId: string, assigned: number | null, contributed: number, consumed: number) => ({
  memberId,
  assigned: assigned === null ? null : pesos(assigned),
  contributed: pesos(contributed),
  consumed: pesos(consumed),
});
const line = (overrides: Partial<LineSums>): LineSums => ({
  funding: "DIRECT",
  allocated: true,
  invalid: false,
  members: [],
  ...overrides,
});

describe("member by line matrix (HU-E7-02, spec 5.4)", () => {
  it("gives Home's DIRECT row: assigned, contributed, consumed and gap per member (@golden)", () => {
    const home = line({ members: [member("ana", 588_000, 900_000, 520_000), member("juan", 882_000, 400_000, 780_000)] });
    expect(matrixRow(home)).toEqual({
      reason: null,
      members: [
        {
          memberId: "ana",
          assigned: pesos(588_000),
          contributed: pesos(900_000),
          consumed: pesos(520_000),
          gap: pesos(312_000),
          status: "OVER_CONTRIBUTED",
        },
        {
          memberId: "juan",
          assigned: pesos(882_000),
          contributed: pesos(400_000),
          consumed: pesos(780_000),
          gap: -pesos(482_000),
          status: "UNDER_CONTRIBUTED",
        },
      ],
    });
  });

  it("leaves a SHARED_FUND line's contribution and gap to the fund, keeping its assigned and consumed amounts", () => {
    const rent = line({
      funding: "SHARED_FUND",
      members: [member("ana", 480_000, 0, 480_000), member("juan", 720_000, 0, 720_000)],
    });
    const row = matrixRow(rent);
    expect(row.reason).toBe("TRACKED_AT_FUND_LEVEL");
    expect(row.members.map((m) => [m.assigned, m.contributed, m.consumed, m.gap, m.status])).toEqual([
      [pesos(480_000), null, pesos(480_000), null, null],
      [pesos(720_000), null, pesos(720_000), null, null],
    ]);
  });

  it("reports only consumption on a line without allocation (NONE)", () => {
    const free = line({ allocated: false, members: [member("ana", null, 50_000, 25_000), member("juan", null, 0, 25_000)] });
    const row = matrixRow(free);
    expect(row.reason).toBe("NOT_ALLOCATED");
    expect(row.members.map((m) => [m.assigned, m.contributed, m.consumed, m.gap, m.status])).toEqual([
      [null, null, pesos(25_000), null, null],
      [null, null, pesos(25_000), null, null],
    ]);
  });

  it("assigns nobody on an invalid allocation and keeps what each member contributed", () => {
    expect(matrixRow(line({ invalid: true, members: [member("ana", null, 100_000, 50_000)] }))).toEqual({
      reason: "INVALID_ALLOCATION",
      members: [
        { memberId: "ana", assigned: null, contributed: pesos(100_000), consumed: pesos(50_000), gap: null, status: null },
      ],
    });
  });

  it("has no consumption on a SAVINGS line, whose contribution is the transfers into the members' accounts", () => {
    const savings = line({
      funding: "SAVINGS",
      members: [member("ana", 240_000, 300_000, 0), member("juan", 360_000, 0, 0)],
    });
    expect(matrixRow(savings).members.map((m) => [m.contributed, m.consumed, m.gap, m.status])).toEqual([
      [pesos(300_000), null, pesos(60_000), "OVER_CONTRIBUTED"],
      [0n, null, -pesos(360_000), "UNDER_CONTRIBUTED"],
    ]);
  });

  it("names the gap by its sign: positive over-contributed, negative under-contributed, zero on target", () => {
    expect([gapStatus(1n), gapStatus(-1n), gapStatus(0n)]).toEqual([
      "OVER_CONTRIBUTED",
      "UNDER_CONTRIBUTED",
      "ON_TARGET",
    ]);
  });
});
```

`src/modules/reporting/domain/fund-contributions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fundContributions } from "./fund-contributions";

const pesos = (n: number) => BigInt(n) * 100n;
const rent = {
  members: [
    { memberId: "ana", assigned: pesos(480_000) },
    { memberId: "juan", assigned: pesos(720_000) },
  ],
};

describe("fund contributions (HU-E7-03, spec 5.4)", () => {
  it("compares each member's expected and actual contributions (@golden)", () => {
    const actual = [
      { memberId: "ana", amount: pesos(480_000) },
      { memberId: "juan", amount: pesos(500_000) },
    ];
    expect(fundContributions(["ana", "juan"], [rent], actual)).toEqual([
      { memberId: "ana", expected: pesos(480_000), actual: pesos(480_000), difference: 0n },
      { memberId: "juan", expected: pesos(720_000), actual: pesos(500_000), difference: -pesos(220_000) },
    ]);
  });

  it("expects 0 from every member of a plan without SHARED_FUND lines", () => {
    expect(fundContributions(["ana", "juan"], [], []).map((c) => [c.expected, c.actual])).toEqual([
      [0n, 0n],
      [0n, 0n],
    ]);
  });

  it("sums every fund line and counts an invalid allocation as nothing assigned", () => {
    const water = {
      members: [
        { memberId: "ana", assigned: pesos(40_000) },
        { memberId: "juan", assigned: pesos(60_000) },
      ],
    };
    const invalid = {
      members: [
        { memberId: "ana", assigned: null },
        { memberId: "juan", assigned: null },
      ],
    };
    expect(fundContributions(["ana", "juan"], [rent, water, invalid], []).map((c) => c.expected)).toEqual([
      pesos(520_000),
      pesos(780_000),
    ]);
  });

  it("lists only the members it is given, so a former member's contribution counts for nobody (ruling P7)", () => {
    const actual = [
      { memberId: "luis", amount: pesos(100_000) },
      { memberId: "ana", amount: pesos(200_000) },
      { memberId: "ana", amount: pesos(280_000) },
    ];
    expect(fundContributions(["ana"], [rent], actual)).toEqual([
      { memberId: "ana", expected: pesos(480_000), actual: pesos(480_000), difference: 0n },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/domain`
Expected: FAIL — `Cannot find module './member-matrix'` and `'./fund-contributions'`.

- [ ] **Step 3: Implement**

`src/modules/reporting/domain/member-matrix.ts`:

```ts
/** HU-E7-02 (ruling P35): why some figures of a line's row are null. */
export const MATRIX_REASONS = ["NOT_ALLOCATED", "TRACKED_AT_FUND_LEVEL", "INVALID_ALLOCATION"] as const;
export type MatrixReason = (typeof MATRIX_REASONS)[number];

/** HU-E7-02: the sign of the gap; positive means the member over-contributed (spec 5.4). */
export const GAP_STATUSES = ["OVER_CONTRIBUTED", "UNDER_CONTRIBUTED", "ON_TARGET"] as const;
export type GapStatus = (typeof GAP_STATUSES)[number];

/** What the plan and the ledger give one line for one period. */
export interface LineSums {
  readonly funding: "DIRECT" | "SHARED_FUND" | "SAVINGS";
  /** False for the rule NONE: group money without per-member responsibility (D13). */
  readonly allocated: boolean;
  /** HU-E6-05: the allocation does not hold, so nobody has an assigned amount. */
  readonly invalid: boolean;
  /** Every current member in join order (ruling P7). */
  readonly members: readonly {
    readonly memberId: string;
    readonly assigned: bigint | null;
    /** DIRECT: Σ the member's payments of the line's expenses; SAVINGS: Σ transfers into their accounts on the line. */
    readonly contributed: bigint;
    /** Σ the member's shares of the line's expenses. */
    readonly consumed: bigint;
  }[];
}

export interface MatrixCell {
  readonly memberId: string;
  readonly assigned: bigint | null;
  readonly contributed: bigint | null;
  readonly consumed: bigint | null;
  /** contributed − assigned. */
  readonly gap: bigint | null;
  readonly status: GapStatus | null;
}

export interface MatrixRow {
  /** Null when every figure of the row is defined. */
  readonly reason: MatrixReason | null;
  readonly members: readonly MatrixCell[];
}

export const gapStatus = (gap: bigint): GapStatus =>
  gap > 0n ? "OVER_CONTRIBUTED" : gap < 0n ? "UNDER_CONTRIBUTED" : "ON_TARGET";

const reasonOf = (line: LineSums): MatrixReason | null => {
  if (!line.allocated) return "NOT_ALLOCATED";
  if (line.funding === "SHARED_FUND") return "TRACKED_AT_FUND_LEVEL";
  return line.invalid ? "INVALID_ALLOCATION" : null;
};

/**
 * HU-E7-02, spec 5.4 (ruling P35): one line's row. A NONE line reports consumption only; a SHARED_FUND line leaves
 * contribution and gap to the fund (D5); an invalid allocation assigns nobody, so it has no gap; a SAVINGS line has
 * no consumption (its spending is transfers, not shares).
 */
export const matrixRow = (line: LineSums): MatrixRow => {
  const reason = reasonOf(line);
  const contributes = reason === null || reason === "INVALID_ALLOCATION";
  return {
    reason,
    members: line.members.map((m) => {
      const assigned = line.allocated && !line.invalid ? m.assigned : null;
      const gap = reason === null && assigned !== null ? m.contributed - assigned : null;
      return {
        memberId: m.memberId,
        assigned,
        contributed: contributes ? m.contributed : null,
        consumed: line.funding === "SAVINGS" ? null : m.consumed,
        gap,
        status: gap === null ? null : gapStatus(gap),
      };
    }),
  };
};
```

`src/modules/reporting/domain/fund-contributions.ts`:

```ts
/** A SHARED_FUND line's assigned amounts: null on an invalid allocation, no members on a NONE line. */
export interface FundLine {
  readonly members: readonly { readonly memberId: string; readonly assigned: bigint | null }[];
}

export interface FundContribution {
  readonly memberId: string;
  readonly expected: bigint;
  readonly actual: bigint;
  /** actual − expected: negative while the member still has to pay in. */
  readonly difference: bigint;
}

/**
 * HU-E7-03, spec 5.4 fund level (ruling P36): expected(m) = Σ assigned(m) over the plan's SHARED_FUND lines, an
 * invalid or NONE line assigning nothing; actual(m) = Σ m's fund contributions in the period; for `memberIds` only.
 */
export const fundContributions = (
  memberIds: readonly string[],
  fundLines: readonly FundLine[],
  contributions: readonly { readonly memberId: string; readonly amount: bigint }[],
): FundContribution[] =>
  memberIds.map((memberId) => {
    const expected = fundLines.reduce(
      (sum, line) => sum + (line.members.find((m) => m.memberId === memberId)?.assigned ?? 0n),
      0n,
    );
    const actual = contributions.filter((c) => c.memberId === memberId).reduce((sum, c) => sum + c.amount, 0n);
    return { memberId, expected, actual, difference: actual - expected };
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/reporting/domain`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/reporting/domain
git commit -m "feat(reporting): compute member by line cells and fund contributions (Refs #57, Refs #58)"
```

---

### Task 4: Ledger — per-member sums for the space reports, in SQL

Gives the ledger's read side the two aggregates HU-E7-02 (issue #57) and HU-E7-03 (issue #58) need, computed on read (D7): each member's payments and shares per category, and each member's fund contributions, within a period's dates. `DrizzleLedgerQueries` implements them with its own types; reporting declares the matching port in Task 5 and the composition root binds them (ruling P32; the ledger never imports reporting).

**Files:**
- Modify: `src/modules/ledger/infrastructure/drizzle-ledger-queries.ts`
- Create (test): `src/modules/ledger/infrastructure/drizzle-report-sums.int.test.ts`

**Interfaces:**
- Consumes: `sharedLedgerFixture`, `categoryFixture`, `SpaceFixture` (`tests/support/fixtures.ts`); `recordExpense`, `recordFundContribution`, `recordTransfer`, `softDelete` (`../domain/transaction`); `DrizzleTransactionRepository.add`; `testDatabase()`.
- Produces: `DrizzleLedgerQueries.memberSumsByCategory(spaceId, from, to): Promise<{ categoryId: string; memberId: string; paid: bigint; consumed: bigint }[]>` and `DrizzleLedgerQueries.fundContributionsByMember(spaceId, from, to): Promise<{ memberId: string; amount: bigint }[]>`; in the test file, the helpers `pesos`, `nov1`, `nov30`, `base`, `expense`, `contribution`, `store`, `sorted` that Task 7 reuses.

- [ ] **Step 1: Write the failing tests**

`src/modules/ledger/infrastructure/drizzle-report-sums.int.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { Money, type LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { unwrap } from "../../../../tests/support/fakes";
import { categoryFixture, sharedLedgerFixture, type SpaceFixture } from "../../../../tests/support/fixtures";
import {
  recordExpense,
  recordFundContribution,
  recordTransfer,
  softDelete,
  type Transaction,
  type TransactionId,
} from "../domain/transaction";
import { DrizzleLedgerQueries } from "./drizzle-ledger-queries";
import { DrizzleTransactionRepository } from "./drizzle-transaction-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleTransactionRepository(tm);
const queries = new DrizzleLedgerQueries(tm);

afterAll(() => pool.end());

const pesos = (n: bigint) => n * 100n;
const nov1 = "2026-11-01" as LocalDate;
const nov30 = "2026-11-30" as LocalDate;
const base = (space: SpaceFixture, amount: bigint, date: string) => ({
  id: randomUUID() as TransactionId,
  spaceId: space.spaceId,
  date: date as LocalDate,
  amount,
  currency: "COP",
  createdBy: space.userId,
  now: new Date(),
});
/** An expense of `space` in `categoryId` on `date`, paid in full by `payer` and split equally among `participants`. */
const expense = (
  space: SpaceFixture,
  categoryId: string,
  date: string,
  amount: bigint,
  payer: { memberId: string | null; accountId: string | null },
  participants: readonly string[],
): Transaction => {
  const parts = unwrap(unwrap(Money.ofMinor(amount, "COP")).allocate(participants.map(() => 1)));
  return unwrap(
    recordExpense({
      ...base(space, amount, date),
      categoryId,
      payments: [{ ...payer, amount }],
      shares: participants.map((memberId, index) => ({
        memberId,
        amount: parts[index]!.minor,
        splitMethod: "EQUAL" as const,
      })),
    }),
  );
};
/** `payerMemberId` pays `amount` into `fund` on `date`, from `sourceAccountId` or from outside the app (null). */
const contribution = (
  space: SpaceFixture,
  fund: string,
  date: string,
  amount: bigint,
  payerMemberId: string,
  sourceAccountId: string | null,
): Transaction =>
  unwrap(
    recordFundContribution({
      ...base(space, amount, date),
      payerMemberId,
      sourceAccountId,
      destinationAccountId: fund,
    }),
  );
const store = async (...txs: Transaction[]) => {
  for (const tx of txs) await repo.add(tx);
};
/** Rows in the adapters' order: by the joined ids (UUIDs have one length, so this is the tuple order). */
const sorted = <T>(rows: T[], key: (row: T) => string): T[] =>
  [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

describe("per-member sums for the space reports (HU-E7-02, HU-E7-03)", () => {
  it("sums each member's payments and shares per category within the dates; a fund payment counts for nobody", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const ana = w.household.memberId;
    const both = [ana, w.pedro];
    const utilities = await categoryFixture(db, w.household, "Utilities");
    const byAna = { memberId: ana, accountId: w.bank };
    await store(
      expense(w.household, w.groceries, "2026-11-01", pesos(300_000n), byAna, both),
      expense(w.household, w.groceries, "2026-11-30", pesos(100_000n), { memberId: w.pedro, accountId: null }, both),
      expense(w.household, utilities, "2026-11-15", pesos(1_200_000n), { memberId: null, accountId: w.fund }, both),
      // Review Focus 2 and D8: the days around the period and a deleted expense count for nobody.
      expense(w.household, w.groceries, "2026-10-31", pesos(70_000n), byAna, both),
      expense(w.household, w.groceries, "2026-12-01", pesos(80_000n), byAna, both),
      softDelete(expense(w.household, w.groceries, "2026-11-10", pesos(90_000n), byAna, both), new Date()),
      contribution(w.household, w.fund, "2026-11-02", pesos(480_000n), ana, w.bank),
    );
    const expected = [
      { categoryId: w.groceries, memberId: ana, paid: pesos(300_000n), consumed: pesos(200_000n) },
      { categoryId: w.groceries, memberId: w.pedro, paid: pesos(100_000n), consumed: pesos(200_000n) },
      { categoryId: utilities, memberId: ana, paid: 0n, consumed: pesos(600_000n) },
      { categoryId: utilities, memberId: w.pedro, paid: 0n, consumed: pesos(600_000n) },
    ];
    expect(await queries.memberSumsByCategory(w.household.spaceId, nov1, nov30)).toEqual(
      sorted(expected, (row) => `${row.categoryId}/${row.memberId}`),
    );
    expect(await queries.memberSumsByCategory("not-a-uuid", nov1, nov30)).toEqual([]);
  });

  it("sums each member's fund contributions within the dates, from outside the app too, and nothing else", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const ana = w.household.memberId;
    await store(
      contribution(w.household, w.fund, "2026-11-02", pesos(480_000n), ana, w.bank),
      contribution(w.household, w.fund, "2026-11-03", pesos(20_000n), ana, w.bank),
      contribution(w.household, w.fund, "2026-11-30", pesos(200_000n), w.pedro, null),
      contribution(w.household, w.fund, "2026-10-31", pesos(720_000n), ana, w.bank),
      softDelete(contribution(w.household, w.fund, "2026-11-15", pesos(50_000n), ana, w.bank), new Date()),
      // HU-E4-03: a transfer without a contributing member is no contribution.
      unwrap(
        recordTransfer({
          ...base(w.household, pesos(30_000n), "2026-11-04"),
          sourceAccountId: w.bank,
          destinationAccountId: w.fund,
        }),
      ),
    );
    const expected = [
      { memberId: ana, amount: pesos(500_000n) },
      { memberId: w.pedro, amount: pesos(200_000n) },
    ];
    expect(await queries.fundContributionsByMember(w.household.spaceId, nov1, nov30)).toEqual(
      sorted(expected, (row) => row.memberId),
    );
    expect(await queries.fundContributionsByMember("not-a-uuid", nov1, nov30)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project integration src/modules/ledger/infrastructure/drizzle-report-sums.int.test.ts`
Expected: FAIL — `queries.memberSumsByCategory is not a function`.

- [ ] **Step 3: Implement**

In `src/modules/ledger/infrastructure/drizzle-ledger-queries.ts`:

1. Insert before the line `  isNull,`:

```ts
  isNotNull,
```

2. Insert before the line `  private matching(f: TransactionFilter) {`:

```ts
  /**
   * HU-E7-02, spec 5.4: per category and member, Σ the member's payments and Σ their shares over the live expenses of
   * the space dated within [from, to]. A fund payment has no member, so it counts for nobody (D5). One statement, so
   * both sums come from one snapshot; sorted by category, then member; `[]` for malformed ids.
   */
  async memberSumsByCategory(
    spaceId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<{ categoryId: string; memberId: string; paid: bigint; consumed: bigint }[]> {
    if (!isUuid(spaceId)) return [];
    const db = this.tm.executor();
    type Field = "paid" | "consumed";
    // Same selection shape in both branches of the UNION ALL.
    const idOf = (column: AnyColumn) => sql<string | null>`${column}`;
    const expenses = and(
      eq(transactions.spaceId, spaceId),
      eq(transactions.type, "EXPENSE"),
      isNull(transactions.deletedAt),
      between(transactions.date, from, to),
    );
    const rows = await unionAll(
      db
        .select({
          categoryId: idOf(transactions.categoryId),
          memberId: idOf(payments.memberId),
          field: sql<Field>`'paid'::text`,
          total: sumAsText(payments.amount),
        })
        .from(payments)
        .innerJoin(transactions, eq(transactions.id, payments.transactionId))
        .where(expenses)
        .groupBy(transactions.categoryId, payments.memberId),
      db
        .select({
          categoryId: idOf(transactions.categoryId),
          memberId: idOf(shares.memberId),
          field: sql<Field>`'consumed'::text`,
          total: sumAsText(shares.amount),
        })
        .from(shares)
        .innerJoin(transactions, eq(transactions.id, shares.transactionId))
        .where(expenses)
        .groupBy(transactions.categoryId, shares.memberId),
    );
    const sums = new Map<string, { categoryId: string; memberId: string; paid: bigint; consumed: bigint }>();
    for (const row of rows) {
      if (row.categoryId === null || row.memberId === null) continue;
      const key = `${row.categoryId}/${row.memberId}`;
      const entry = sums.get(key) ?? { categoryId: row.categoryId, memberId: row.memberId, paid: 0n, consumed: 0n };
      entry[row.field] += BigInt(row.total);
      sums.set(key, entry);
    }
    return [...sums.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, entry]) => entry);
  }

  /**
   * HU-E7-03, spec 5.4: Σ the live fund contributions of the space (transfers with a contributing member, HU-E4-09)
   * dated within [from, to], per member, those from outside the app included; sorted by member; `[]` for malformed ids.
   */
  async fundContributionsByMember(
    spaceId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<{ memberId: string; amount: bigint }[]> {
    if (!isUuid(spaceId)) return [];
    const rows = await this.tm
      .executor()
      .select({ memberId: transactions.payerMemberId, total: sumAsText(transactions.amount) })
      .from(transactions)
      .where(
        and(
          eq(transactions.spaceId, spaceId),
          eq(transactions.type, "TRANSFER"),
          isNotNull(transactions.payerMemberId),
          isNull(transactions.deletedAt),
          between(transactions.date, from, to),
        ),
      )
      .groupBy(transactions.payerMemberId)
      .orderBy(asc(transactions.payerMemberId));
    return rows.flatMap((row) =>
      row.memberId === null ? [] : [{ memberId: row.memberId, amount: BigInt(row.total) }],
    );
  }

```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project integration src/modules/ledger/infrastructure/drizzle-report-sums.int.test.ts src/modules/ledger/infrastructure/drizzle-ledger-queries.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/infrastructure/drizzle-ledger-queries.ts src/modules/ledger/infrastructure/drizzle-report-sums.int.test.ts
git commit -m "feat(ledger): sum payments, shares and fund contributions per member for reports (Refs #57, Refs #58)"
```

---

### Task 5: Reporting — GetMemberLineMatrix and GetFundContributions

Implements HU-E7-02 (issue #57) and HU-E7-03 (issue #58) at the use-case level: the plan's figures (assigned amounts, mappings, catch-all) from `loadPlanView`, the ledger's per-member sums attributed to lines with budgeting's own `lineForCategory` after `rolledUpCategory` counts a subcategory's sums in its category (HU-E3-04, ruling P96), and the Task 3 formulas. Pins every scenario of both stories with in-memory adapters.

**Files:**
- Modify: `src/modules/budgeting/application/index.ts`, `src/modules/reporting/application/index.ts`, `tests/support/reporting-world.ts`
- Create: `src/modules/reporting/application/member-sums.ts`, `src/modules/reporting/application/get-member-line-matrix.ts`, `src/modules/reporting/application/get-fund-contributions.ts`
- Create (test): `src/modules/reporting/application/member-matrix.test.ts`, `src/modules/reporting/application/fund-tracking.test.ts`

**Interfaces:**
- Consumes: `spaceReport`, `reportPlanOf`, `ReportPlan`, `SpaceReportInput`, `ReportingDeps` (Task 1); `matrixRow`, `MatrixCell`, `MatrixReason`, `fundContributions`, `FundContribution` (Task 3); `lineForCategory(categoryId, { lines, mappings }): string | null` (`budgeting/domain/plan-figures.ts`, exported here); `rolledUpCategory(categoryId, categories): string` (`budgeting/domain/category-rollup.ts`, exported here) and `ReportingDeps.categories.list` (Task 1); `LineFigure`, `AllocationRule`, `Funding`, `BudgetLine`; `SavingsAccountReader.find`, `PlanSpending.transfersIntoAccounts`; `reportingWorld`, `SpendingByPeriod` (Task 1); `BUDGET_MEMBERS`, `ACCOUNTS` (`acc-savings` is Ana's, `acc-luis-savings` Luis's, who is not a member).
- Produces: `SpaceMemberSums { memberSumsByCategory, fundContributionsByMember }` (the shapes `DrizzleLedgerQueries` implements since Task 4), `MemberSumsDeps extends ReportingDeps { sums }`; `MatrixLine { lineId, name, funding, rule, reason, members }`, `MemberLineMatrix { spaceId, currency, period, plan, lines }`, `GetMemberLineMatrix`, `createGetMemberLineMatrix(deps: MemberSumsDeps)`; `FundContributionReport { spaceId, currency, period, plan, members }`, `GetFundContributions`, `createGetFundContributions(deps: MemberSumsDeps)`; the application index re-exports `MATRIX_REASONS`, `GAP_STATUSES`, `GapStatus`, `MatrixCell`, `MatrixReason`, `FundContribution`; test support `MemberSumsByPeriod` (`byCategory`, `contributions` keyed by the first day asked for), and `reportingWorld()` now also returns `sums` and `memberDeps`.

- [ ] **Step 1: Write the failing tests**

In `tests/support/reporting-world.ts`:

1. Replace the line `import type { ReportingDeps } from "@/modules/reporting/application";` with:

```ts
import type { ReportingDeps, SpaceMemberSums } from "@/modules/reporting/application";
```

2. Insert after the line `import { unwrap } from "./fakes";`:

```ts

/** The ledger's per-member sums of each period, keyed by the first day it is asked for (D7). */
export class MemberSumsByPeriod implements SpaceMemberSums {
  readonly byCategory: Record<string, { categoryId: string; memberId: string; paid: bigint; consumed: bigint }[]> = {};
  readonly contributions: Record<string, { memberId: string; amount: bigint }[]> = {};

  async memberSumsByCategory(_spaceId: string, from: LocalDate) {
    return [...(this.byCategory[from] ?? [])];
  }

  async fundContributionsByMember(_spaceId: string, from: LocalDate) {
    return [...(this.contributions[from] ?? [])];
  }
}
```

3. Replace the line `  return { ...w, spending, deps, plan };` with:

```ts
  const sums = new MemberSumsByPeriod();
  return { ...w, spending, sums, deps, memberDeps: { ...deps, sums }, plan };
```

`src/modules/reporting/application/member-matrix.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BudgetLine } from "@/modules/budgeting/application";
import type { SpaceMember } from "@/modules/spaces/application";
import { referenceLines } from "../../../../tests/support/budget-fixtures";
import { BUDGET_MEMBERS, HOUSEHOLD } from "../../../../tests/support/budgeting-world";
import { unwrap } from "../../../../tests/support/fakes";
import { reportingWorld } from "../../../../tests/support/reporting-world";
import { createGetMemberLineMatrix, type MemberLineMatrix } from "./get-member-line-matrix";

const pesos = (n: number) => BigInt(n) * 100n;
const NOVEMBER = "2026-11-01";
const ANA_AND_JUAN = BUDGET_MEMBERS.slice(0, 2);

/** Spec section 4 with the E7 mappings; Free has no allocation (NONE) and is not the catch-all unless told. */
const parts = (free: Partial<BudgetLine> = {}) => ({
  capacities: [
    { memberId: "member-ana", amount: pesos(1_600_000) },
    { memberId: "member-juan", amount: pesos(2_400_000) },
  ],
  lines: referenceLines().map((l) =>
    l.name === "Free" ? { ...l, allocationRule: "NONE" as const, isCatchAll: false, ...free } : l,
  ),
  mappings: [
    { lineId: "line-rent", categoryId: "cat-rent" },
    { lineId: "line-home", categoryId: "cat-groceries" },
    { lineId: "line-home", categoryId: "cat-utilities" },
    { lineId: "line-free", categoryId: "cat-entertainment" },
  ],
});
const sum = (categoryId: string, memberId: string, paid: number, consumed: number) => ({
  categoryId,
  memberId,
  paid: pesos(paid),
  consumed: pesos(consumed),
});
/**
 * HU-E7-02 Background as the ledger sums it: Ana's 900,000 and Juan's 400,000 COP split BY_ALLOCATION 40 / 60, the
 * fund's 1,200,000 COP Rent split BY_ALLOCATION, and Ana's 50,000 COP Outings (Entertainment) split EQUAL.
 */
const novemberSums = () => [
  sum("cat-groceries", "member-ana", 900_000, 360_000),
  sum("cat-groceries", "member-juan", 0, 540_000),
  sum("cat-utilities", "member-ana", 0, 160_000),
  sum("cat-utilities", "member-juan", 400_000, 240_000),
  sum("cat-rent", "member-ana", 0, 480_000),
  sum("cat-rent", "member-juan", 0, 720_000),
  sum("cat-entertainment", "member-ana", 50_000, 25_000),
  sum("cat-entertainment", "member-juan", 0, 25_000),
];

const world = async (members: readonly SpaceMember[] = ANA_AND_JUAN, free: Partial<BudgetLine> = {}) => {
  const w = reportingWorld({ members });
  await w.plan("2026-11", parts(free));
  w.sums.byCategory[NOVEMBER] = novemberSums();
  return w;
};
const read = (w: Awaited<ReturnType<typeof world>>, userId = "u-ana", period = "2026-11") =>
  createGetMemberLineMatrix(w.memberDeps)({ spaceId: HOUSEHOLD, userId, period });
const lineOf = (matrix: MemberLineMatrix, name: string) => matrix.lines.find((l) => l.name === name)!;
const cells = (matrix: MemberLineMatrix, name: string) =>
  lineOf(matrix, name).members.map((c) => [c.memberId, c.assigned, c.contributed, c.consumed, c.gap, c.status]);

describe("member by line matrix (HU-E7-02)", () => {
  it("gives Home's DIRECT row per member, Ana over-contributed by 312,000 COP (@golden)", async () => {
    const matrix = unwrap(await read(await world()));
    expect(lineOf(matrix, "Home")).toMatchObject({ funding: "DIRECT", rule: "PROPORTIONAL", reason: null });
    expect(cells(matrix, "Home")).toEqual([
      ["member-ana", pesos(588_000), pesos(900_000), pesos(520_000), pesos(312_000), "OVER_CONTRIBUTED"],
      ["member-juan", pesos(882_000), pesos(400_000), pesos(780_000), -pesos(482_000), "UNDER_CONTRIBUTED"],
    ]);
  });

  it("defers Rent's contribution to the fund and reports its consumption, 480,000 and 720,000 COP", async () => {
    const matrix = unwrap(await read(await world()));
    expect(lineOf(matrix, "Rent").reason).toBe("TRACKED_AT_FUND_LEVEL");
    expect(cells(matrix, "Rent")).toEqual([
      ["member-ana", pesos(480_000), null, pesos(480_000), null, null],
      ["member-juan", pesos(720_000), null, pesos(720_000), null, null],
    ]);
  });

  it("reports only consumption on Free, which has no allocation (NONE)", async () => {
    const matrix = unwrap(await read(await world()));
    expect(lineOf(matrix, "Free")).toMatchObject({ rule: "NONE", reason: "NOT_ALLOCATED" });
    expect(cells(matrix, "Free")).toEqual([
      ["member-ana", null, null, pesos(25_000), null, null],
      ["member-juan", null, null, pesos(25_000), null, null],
    ]);
  });

  it("attributes a SAVINGS line's transfers to each counted account's owner, never to a non-member's (P8)", async () => {
    const w = reportingWorld({ members: ANA_AND_JUAN });
    const base = parts();
    await w.plan("2026-11", {
      ...base,
      lines: base.lines.map((l) =>
        l.name === "Savings" ? { ...l, savingsAccountIds: ["acc-savings", "acc-luis-savings"] } : l,
      ),
    });
    w.spending.transfers[NOVEMBER] = [
      { accountId: "acc-savings", amount: pesos(300_000) },
      { accountId: "acc-luis-savings", amount: pesos(50_000) },
    ];
    const matrix = unwrap(await read(w));
    expect(lineOf(matrix, "Savings").reason).toBeNull();
    expect(cells(matrix, "Savings")).toEqual([
      ["member-ana", pesos(240_000), pesos(300_000), null, pesos(60_000), "OVER_CONTRIBUTED"],
      ["member-juan", pesos(360_000), 0n, null, -pesos(360_000), "UNDER_CONTRIBUTED"],
    ]);
  });

  it("leaves unmapped spending out without a catch-all line, and puts it on the catch-all line otherwise", async () => {
    const without = await world();
    without.sums.byCategory[NOVEMBER] = [...novemberSums(), sum("cat-restaurants", "member-ana", 60_000, 30_000)];
    expect(cells(unwrap(await read(without)), "Free")[0]).toEqual(["member-ana", null, null, pesos(25_000), null, null]);
    const withCatchAll = await world(ANA_AND_JUAN, { isCatchAll: true });
    withCatchAll.sums.byCategory[NOVEMBER] = [...novemberSums(), sum("cat-restaurants", "member-ana", 60_000, 30_000)];
    expect(cells(unwrap(await read(withCatchAll)), "Free")[0]).toEqual([
      "member-ana",
      null,
      null,
      pesos(55_000),
      null,
      null,
    ]);
  });

  it("assigns nobody on Home while its allocation does not hold", async () => {
    const w = reportingWorld({ members: ANA_AND_JUAN });
    const base = parts();
    await w.plan("2026-11", {
      ...base,
      lines: base.lines.map((l) => (l.name === "Home" ? { ...l, allocationRule: "PERCENT" as const } : l)),
      allocations: [{ lineId: "line-home", memberId: "member-ana", value: 5_000n }],
    });
    w.sums.byCategory[NOVEMBER] = novemberSums();
    const matrix = unwrap(await read(w));
    expect(lineOf(matrix, "Home").reason).toBe("INVALID_ALLOCATION");
    expect(cells(matrix, "Home")[0]).toEqual(["member-ana", null, pesos(900_000), pesos(520_000), null, null]);
  });

  it("lists every current member in join order for VIEWER Sofi, guests included, and nobody who left (P7)", async () => {
    const w = await world(BUDGET_MEMBERS);
    w.sums.byCategory[NOVEMBER] = [...novemberSums(), sum("cat-groceries", "member-luis", 100_000, 0)];
    const matrix = unwrap(await read(w, "u-sofi"));
    expect(cells(matrix, "Home")).toEqual([
      ["member-ana", pesos(588_000), pesos(900_000), pesos(520_000), pesos(312_000), "OVER_CONTRIBUTED"],
      ["member-juan", pesos(882_000), pesos(400_000), pesos(780_000), -pesos(482_000), "UNDER_CONTRIBUTED"],
      ["member-sofi", 0n, 0n, 0n, 0n, "ON_TARGET"],
      ["member-pedro", 0n, 0n, 0n, 0n, "ON_TARGET"],
    ]);
  });

  it("counts a subcategory's payments and shares on the line its category consumes (HU-E3-04)", async () => {
    const w = await world();
    w.sums.byCategory[NOVEMBER] = [...novemberSums(), sum("cat-vegetables", "member-ana", 100_000, 50_000)];
    expect(cells(unwrap(await read(w)), "Home")[0]).toEqual([
      "member-ana",
      pesos(588_000),
      pesos(1_000_000),
      pesos(570_000),
      pesos(412_000),
      "OVER_CONTRIBUTED",
    ]);
  });

  it("has no lines for a period without a plan", async () => {
    const matrix = unwrap(await read(await world(), "u-ana", "2027-01"));
    expect(matrix).toMatchObject({ plan: null, lines: [], period: { label: "2027-01" } });
  });
});
```

`src/modules/reporting/application/fund-tracking.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { aLine, referenceLines } from "../../../../tests/support/budget-fixtures";
import { BUDGET_MEMBERS, HOUSEHOLD } from "../../../../tests/support/budgeting-world";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { reportingWorld } from "../../../../tests/support/reporting-world";
import { createGetFundContributions } from "./get-fund-contributions";

const pesos = (n: number) => BigInt(n) * 100n;
const capacities = [
  { memberId: "member-ana", amount: pesos(1_600_000) },
  { memberId: "member-juan", amount: pesos(2_400_000) },
];
const read = (w: ReturnType<typeof reportingWorld>, period: string, userId = "u-ana") =>
  createGetFundContributions(w.memberDeps)({ spaceId: HOUSEHOLD, userId, period });
const rows = async (w: ReturnType<typeof reportingWorld>, period: string) =>
  unwrap(await read(w, period)).members.map((m) => [m.memberId, m.expected, m.actual, m.difference]);

describe("fund contribution tracking (HU-E7-03)", () => {
  it("compares each member's expected and actual contributions to the fund (@golden)", async () => {
    const w = reportingWorld({ members: BUDGET_MEMBERS.slice(0, 2) });
    const plan = await w.plan("2026-11", { capacities, lines: referenceLines() });
    w.sums.contributions["2026-11-01"] = [
      { memberId: "member-ana", amount: pesos(480_000) },
      { memberId: "member-juan", amount: pesos(500_000) },
    ];
    expect(unwrap(await read(w, "2026-11")).plan).toEqual({ id: plan.id, status: "ACTIVE" });
    expect(await rows(w, "2026-11")).toEqual([
      ["member-ana", pesos(480_000), pesos(480_000), 0n],
      ["member-juan", pesos(720_000), pesos(500_000), -pesos(220_000)],
    ]);
  });

  it("expects nothing from anyone when the plan has no SHARED_FUND line, and counts what they paid in", async () => {
    const w = reportingWorld({ members: BUDGET_MEMBERS.slice(0, 2) });
    await w.plan("2026-12", { capacities, lines: [aLine("Home", pesos(1_470_000))] });
    w.sums.contributions["2026-12-01"] = [{ memberId: "member-juan", amount: pesos(100_000) }];
    expect(await rows(w, "2026-12")).toEqual([
      ["member-ana", 0n, 0n, 0n],
      ["member-juan", 0n, pesos(100_000), pesos(100_000)],
    ]);
  });

  it("expects nothing in a period without a plan", async () => {
    const w = reportingWorld({ members: BUDGET_MEMBERS.slice(0, 2) });
    const tracking = unwrap(await read(w, "2027-01"));
    expect(tracking.plan).toBeNull();
    expect(tracking.members.map((m) => m.expected)).toEqual([0n, 0n]);
  });

  it("lists every current member for VIEWER Sofi, and no contribution of a member who left (P7)", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", { capacities, lines: referenceLines() });
    w.sums.contributions["2026-11-01"] = [{ memberId: "member-luis", amount: pesos(300_000) }];
    const tracking = unwrap(await read(w, "2026-11", "u-sofi"));
    expect(tracking.members.map((m) => [m.memberId, m.actual])).toEqual([
      ["member-ana", 0n],
      ["member-juan", 0n],
      ["member-sofi", 0n],
      ["member-pedro", 0n],
    ]);
    expect(codeOf(await read(w, "2026-11", "u-marta"))).toBe("SpaceNotFound");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/application`
Expected: FAIL — `Cannot find module './get-member-line-matrix'` and `'./get-fund-contributions'`.

- [ ] **Step 3: Implement**

In `src/modules/budgeting/application/index.ts`, append to the end of the file:

```ts
export { lineForCategory } from "../domain/plan-figures";
export { rolledUpCategory } from "../domain/category-rollup";
```

`src/modules/reporting/application/member-sums.ts`:

```ts
import type { LocalDate } from "@/shared/kernel";
import type { ReportingDeps } from "./deps";

/** HU-E7-02, HU-E7-03: per-member sums of a space's live ledger within dates (spec 5.4, D7); bound to the ledger. */
export interface SpaceMemberSums {
  /** Per category and member: Σ the member's payments and Σ their shares of the space's expenses. */
  memberSumsByCategory(
    spaceId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<
    readonly { readonly categoryId: string; readonly memberId: string; readonly paid: bigint; readonly consumed: bigint }[]
  >;
  /** Per member: Σ their fund contributions recorded in the space (HU-E4-09). */
  fundContributionsByMember(
    spaceId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<readonly { readonly memberId: string; readonly amount: bigint }[]>;
}

export interface MemberSumsDeps extends ReportingDeps {
  readonly sums: SpaceMemberSums;
}
```

`src/modules/reporting/application/get-member-line-matrix.ts`:

```ts
import {
  lineForCategory,
  rolledUpCategory,
  type AllocationRule,
  type BudgetLine,
  type Funding,
} from "@/modules/budgeting/application";
import type { SpaceMember } from "@/modules/spaces/application";
import { ok, type Period, type Result } from "@/shared/kernel";
import { matrixRow, type MatrixCell, type MatrixReason } from "../domain/member-matrix";
import type { MemberSumsDeps } from "./member-sums";
import { reportPlanOf, spaceReport, type ReportPlan, type SpaceReportInput } from "./space-report";

export interface MatrixLine {
  readonly lineId: string;
  readonly name: string;
  readonly funding: Funding;
  readonly rule: AllocationRule;
  readonly reason: MatrixReason | null;
  /** Every current member in join order (ruling P7). */
  readonly members: readonly MatrixCell[];
}

export interface MemberLineMatrix {
  readonly spaceId: string;
  readonly currency: string;
  readonly period: Period;
  readonly plan: ReportPlan | null;
  /** The plan's lines in plan order; none without a plan (ruling P35). */
  readonly lines: readonly MatrixLine[];
}

export type GetMemberLineMatrix = (input: SpaceReportInput) => Promise<Result<MemberLineMatrix>>;

/**
 * Spec 5.4 SAVINGS contribution (rulings P8, P35): what reached each account the line names that a current
 * registered member owns, credited to that owner, who is the one who transferred (HU-E4-03).
 */
const savingsByMember = async (
  deps: MemberSumsDeps,
  members: readonly SpaceMember[],
  line: BudgetLine,
  period: Period,
): Promise<Map<string, bigint>> => {
  const owned = await Promise.all(
    line.savingsAccountIds.map(async (accountId) => {
      const account = await deps.savingsAccounts.find(accountId);
      const owner = members.find((m) => m.userId !== null && m.userId === account?.ownerUserId);
      return owner === undefined ? [] : [{ accountId, memberId: owner.id }];
    }),
  );
  const counted = owned.flat();
  const transfers =
    counted.length === 0
      ? []
      : await deps.spending.transfersIntoAccounts(
          counted.map((a) => a.accountId),
          period.start,
          period.end,
        );
  const byMember = new Map<string, bigint>();
  for (const transfer of transfers) {
    const memberId = counted.find((a) => a.accountId === transfer.accountId)?.memberId;
    if (memberId !== undefined) byMember.set(memberId, (byMember.get(memberId) ?? 0n) + transfer.amount);
  }
  return byMember;
};

/**
 * HU-E7-02, spec 5.4: assigned, contributed, consumed and gap per current member and line of the period's plan,
 * each expense attributed to the line its category consumes (HU-E6-04), computed on read (D7, ruling P35).
 */
export const createGetMemberLineMatrix =
  (deps: MemberSumsDeps): GetMemberLineMatrix =>
  async (input) => {
    const report = await spaceReport(deps, input);
    if (!report.ok) return report;
    const { space, period, view } = report.value;
    const base = { spaceId: space.spaceId, currency: space.currency, period, plan: reportPlanOf(view) };
    if (view === null) return ok({ ...base, lines: [] });
    const members = await deps.members.listCurrent(space.spaceId);
    const figures = view.figures.lines;
    const parts = {
      lines: figures.map((f) => f.line),
      mappings: figures.flatMap((f) => f.categoryIds.map((categoryId) => ({ lineId: f.line.id, categoryId }))),
    };
    const categories = await deps.categories.list(space.spaceId);
    const sums = new Map<string, { paid: bigint; consumed: bigint }>();
    for (const row of await deps.sums.memberSumsByCategory(space.spaceId, period.start, period.end)) {
      // HU-E3-04: a subcategory's payments and shares count on the line its category consumes, as its spending does.
      const lineId = lineForCategory(rolledUpCategory(row.categoryId, categories), parts);
      if (lineId === null) continue;
      const key = `${lineId}/${row.memberId}`;
      const sum = sums.get(key) ?? { paid: 0n, consumed: 0n };
      sums.set(key, { paid: sum.paid + row.paid, consumed: sum.consumed + row.consumed });
    }
    const lines = await Promise.all(
      figures.map(async ({ line, allocation }): Promise<MatrixLine> => {
        const savings = line.funding === "SAVINGS" ? await savingsByMember(deps, members, line, period) : null;
        const row = matrixRow({
          funding: line.funding,
          allocated: allocation.rule !== "NONE",
          invalid: allocation.invalid,
          members: members.map((m) => {
            const sum = sums.get(`${line.id}/${m.id}`);
            return {
              memberId: m.id,
              assigned: allocation.members.find((a) => a.memberId === m.id)?.assigned ?? null,
              contributed: savings === null ? (sum?.paid ?? 0n) : (savings.get(m.id) ?? 0n),
              consumed: sum?.consumed ?? 0n,
            };
          }),
        });
        return { lineId: line.id, name: line.name, funding: line.funding, rule: allocation.rule, ...row };
      }),
    );
    return ok({ ...base, lines });
  };
```

`src/modules/reporting/application/get-fund-contributions.ts`:

```ts
import { ok, type Period, type Result } from "@/shared/kernel";
import { fundContributions, type FundContribution } from "../domain/fund-contributions";
import type { MemberSumsDeps } from "./member-sums";
import { reportPlanOf, spaceReport, type ReportPlan, type SpaceReportInput } from "./space-report";

export interface FundContributionReport {
  readonly spaceId: string;
  readonly currency: string;
  readonly period: Period;
  readonly plan: ReportPlan | null;
  /** Every current member in join order (ruling P7). */
  readonly members: readonly FundContribution[];
}

export type GetFundContributions = (input: SpaceReportInput) => Promise<Result<FundContributionReport>>;

/**
 * HU-E7-03, spec 5.4 fund level: each current member's expected contribution (their assigned amounts on the plan's
 * SHARED_FUND lines) against what they paid into the space's funds in the period (ruling P36), computed on read (D7).
 */
export const createGetFundContributions =
  (deps: MemberSumsDeps): GetFundContributions =>
  async (input) => {
    const report = await spaceReport(deps, input);
    if (!report.ok) return report;
    const { space, period, view } = report.value;
    const members = await deps.members.listCurrent(space.spaceId);
    const fundLines = (view?.figures.lines ?? [])
      .filter((f) => f.line.funding === "SHARED_FUND")
      .map((f) => ({ members: f.allocation.members }));
    const actual = await deps.sums.fundContributionsByMember(space.spaceId, period.start, period.end);
    return ok({
      spaceId: space.spaceId,
      currency: space.currency,
      period,
      plan: reportPlanOf(view),
      members: fundContributions(
        members.map((m) => m.id),
        fundLines,
        actual,
      ),
    });
  };
```

In `src/modules/reporting/application/index.ts`, append to the end of the file:

```ts
export {
  GAP_STATUSES,
  MATRIX_REASONS,
  type GapStatus,
  type MatrixCell,
  type MatrixReason,
} from "../domain/member-matrix";
export type { FundContribution } from "../domain/fund-contributions";
export type { MemberSumsDeps, SpaceMemberSums } from "./member-sums";
export {
  createGetMemberLineMatrix,
  type GetMemberLineMatrix,
  type MatrixLine,
  type MemberLineMatrix,
} from "./get-member-line-matrix";
export {
  createGetFundContributions,
  type FundContributionReport,
  type GetFundContributions,
} from "./get-fund-contributions";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/reporting src/modules/budgeting`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/application/index.ts src/modules/reporting/application tests/support/reporting-world.ts
git commit -m "feat(reporting): derive the member by line matrix and fund tracking of a period (Refs #57, Refs #58)"
```

---

### Task 6a: HTTP — the member by line matrix

Implements HU-E7-02 (issue #57) over HTTP: `GET /api/v1/spaces/{spaceId}/reports/member-matrix?period=<label>`, with reasons and statuses as codes the web UI translates. Pins the `@critical @golden` scenario end to end: an ACTIVE reference plan, two expenses recorded without a split (so `BY_ALLOCATION`, HU-E6-08), the fund's Rent, and the matrix the ledger and the plan give.

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/reports/member-matrix/route.ts`
- Modify: `src/modules/reporting/contracts/reporting.contract.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E7-reporting.md`, `tests/support/reporting.ts`
- Create (test): `tests/acceptance/reports-member-matrix.test.ts`

**Interfaces:**
- Consumes: `createGetMemberLineMatrix`, `GetMemberLineMatrix`, `MemberLineMatrix`, `MATRIX_REASONS`, `GAP_STATUSES` (Task 5); `DrizzleLedgerQueries.memberSumsByCategory` (Task 4); `ReportQuerySchema`, `ReportPlanSchema`, `reportPlanDto`, `moneyOf`, `reportProblems`, `SpacePath`, `reportingPaths` (Task 2a); `ALLOCATION_RULES`; `reportHousehold`, `spend`, `getWithQuery`, `ReportPeriodDto`, `ReportPlanDto` (Task 2a); `activatePlan`, `putAllocation`, `lineNamed`, `planOf` (`tests/support/budgeting.ts`); `joinHousehold`.
- Produces: `MemberMatrixSchema`, `memberMatrixDto`, `moneyOrNull` in the contract; `Container.reporting.getMemberLineMatrix`; `reportingDeps.sums` (bound to `ledgerQueries`); test support `getMemberMatrix(user, spaceId, query)`, `MatrixCellDto`, `MemberMatrixDto`.

- [ ] **Step 1: Write the failing tests**

In `tests/support/reporting.ts`:

1. Insert after the line `import { GET as linesRoute } from "@/app/api/v1/spaces/[spaceId]/reports/lines/route";`:

```ts
import { GET as matrixRoute } from "@/app/api/v1/spaces/[spaceId]/reports/member-matrix/route";
```

2. Append to the end of the file:

```ts

export interface MatrixCellDto {
  memberId: string;
  assigned: MoneyDto | null;
  contributed: MoneyDto | null;
  consumed: MoneyDto | null;
  gap: MoneyDto | null;
  status: string | null;
}
export interface MemberMatrixDto {
  spaceId: string;
  period: ReportPeriodDto;
  plan: ReportPlanDto | null;
  lines: { lineId: string; name: string; funding: string; rule: string; reason: string | null; members: MatrixCellDto[] }[];
}

/** HU-E7-02: `user` reads the member by line matrix of `spaceId`. */
export const getMemberMatrix = (user: TestUser, spaceId: string, query: Record<string, string>) =>
  getWithQuery(matrixRoute, user, `/api/v1/spaces/${spaceId}/reports/member-matrix`, query, { spaceId });
```

`tests/acceptance/reports-member-matrix.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setContainerForTests, type Container } from "@/composition/container";
import { problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { activatePlan, putAllocation } from "../support/budgeting";
import { cop, joinHousehold } from "../support/ledger";
import { getMemberMatrix, reportHousehold, spend, type MemberMatrixDto } from "../support/reporting";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** The E7 household with its 2026-11 plan ACTIVE, so expenses without a split follow their line's allocation. */
const activeHousehold = async (beforeActivation?: (r: Awaited<ReturnType<typeof reportHousehold>>) => Promise<void>) => {
  const r = await reportHousehold();
  await beforeActivation?.(r);
  expect((await activatePlan(r.h.ana, r.h.spaceId, r.planId)).status).toBe(200);
  return r;
};
const matrixOf = async (user: TestUser, spaceId: string): Promise<MemberMatrixDto> => {
  const response = await getMemberMatrix(user, spaceId, { period: "2026-11" });
  expect(response.status).toBe(200);
  return (await response.json()) as MemberMatrixDto;
};
const cells = (matrix: MemberMatrixDto, name: string) =>
  matrix.lines
    .find((l) => l.name === name)!
    .members.map((c) => [c.memberId, c.assigned, c.contributed, c.consumed, c.gap, c.status]);

describe("member by line matrix over HTTP (HU-E7-02)", () => {
  it("gives Home's row from expenses split BY_ALLOCATION (@critical @golden)", async () => {
    const r = await activeHousehold();
    await spend(r.h.ana, r.category.groceries, 900_000, "2026-11-05");
    await spend(r.h.juan, r.category.utilities, 400_000, "2026-11-10");
    const matrix = await matrixOf(r.h.ana, r.h.spaceId);
    expect(matrix.plan).toEqual({ id: r.planId, status: "ACTIVE" });
    expect(matrix.lines.find((l) => l.name === "Home")?.reason).toBeNull();
    expect(cells(matrix, "Home")).toEqual([
      [r.h.ana.memberId, cop(588_000), cop(900_000), cop(520_000), cop(312_000), "OVER_CONTRIBUTED"],
      [r.h.juan.memberId, cop(882_000), cop(400_000), cop(780_000), cop(-482_000), "UNDER_CONTRIBUTED"],
    ]);
  });

  it("defers Rent's contribution to the fund: the fund's rent consumed 480,000 and 720,000 COP", async () => {
    const r = await activeHousehold();
    await spend(r.h.ana, r.category.rent, 1_200_000, "2026-11-01", r.fund);
    const matrix = await matrixOf(r.h.juan, r.h.spaceId);
    expect(matrix.lines.find((l) => l.name === "Rent")?.reason).toBe("TRACKED_AT_FUND_LEVEL");
    expect(cells(matrix, "Rent")).toEqual([
      [r.h.ana.memberId, cop(480_000), null, cop(480_000), null, null],
      [r.h.juan.memberId, cop(720_000), null, cop(720_000), null, null],
    ]);
  });

  it("reports only consumption on Free once it has no allocation: Ana's 50,000 COP split EQUAL", async () => {
    const r = await activeHousehold(async ({ h, planId, lineId }) => {
      expect((await putAllocation(h.ana, h.spaceId, planId, lineId("Free"), { rule: "NONE" })).status).toBe(200);
    });
    await spend(r.h.ana, r.category.entertainment, 50_000, "2026-11-12");
    const matrix = await matrixOf(r.h.ana, r.h.spaceId);
    expect(matrix.lines.find((l) => l.name === "Free")).toMatchObject({ rule: "NONE", reason: "NOT_ALLOCATED" });
    expect(cells(matrix, "Free")).toEqual([
      [r.h.ana.memberId, null, null, cop(25_000), null, null],
      [r.h.juan.memberId, null, null, cop(25_000), null, null],
    ]);
  });

  it("lets VIEWER Sofi read the matrix, where she has nothing assigned, and hides it from non-members", async () => {
    const r = await activeHousehold();
    const sofi = await joinHousehold(r.h, "Sofi", "VIEWER");
    const matrix = await matrixOf(sofi, r.h.spaceId);
    expect(cells(matrix, "Home")[2]).toEqual([sofi.memberId, cop(0), cop(0), cop(0), cop(0), "ON_TARGET"]);
    const marta = await registerUser("Marta");
    expect(await problemOf(await getMemberMatrix(marta, r.h.spaceId, { period: "2026-11" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    expect(await problemOf(await getMemberMatrix(r.h.ana, r.h.spaceId, { period: "2026-11 H2" }))).toEqual([
      422,
      "InvalidPeriodLabel",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/reports-member-matrix.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/v1/spaces/[spaceId]/reports/member-matrix/route'`.

- [ ] **Step 3: Implement**

In `src/modules/reporting/contracts/reporting.contract.ts`:

1. Replace the line `import { FUNDINGS, PLAN_STATUSES } from "@/modules/budgeting/application";` with:

```ts
import { ALLOCATION_RULES, FUNDINGS, PLAN_STATUSES } from "@/modules/budgeting/application";
```

2. Replace the line `import type { LineDashboard, ReportPlan, UnbudgetedSpending } from "../application";` with:

```ts
import {
  GAP_STATUSES,
  MATRIX_REASONS,
  type LineDashboard,
  type MemberLineMatrix,
  type ReportPlan,
  type UnbudgetedSpending,
} from "../application";
```

3. Insert before the line `const SpacePath = z.object({ spaceId: z.string() });`:

```ts
/** HU-E7-02: every line of the period's plan with every current member's figures (spec 5.4, ruling P35). */
export const MemberMatrixSchema = z.object({
  spaceId: z.string(),
  period: PeriodSchema,
  plan: ReportPlanSchema,
  lines: z.array(
    z.object({
      lineId: z.string(),
      name: z.string(),
      funding: z.enum(FUNDINGS),
      rule: z.enum(ALLOCATION_RULES),
      /** Why figures are null: NONE lines report consumption only, SHARED_FUND lines leave contribution to the fund. */
      reason: z.enum(MATRIX_REASONS).nullable(),
      /** Every current member in join order, guests included. */
      members: z.array(
        z.object({
          memberId: z.string(),
          assigned: MoneySchema.nullable(),
          contributed: MoneySchema.nullable(),
          /** Null on SAVINGS lines. */
          consumed: MoneySchema.nullable(),
          /** contributed − assigned; positive means the member over-contributed. */
          gap: MoneySchema.nullable(),
          status: z.enum(GAP_STATUSES).nullable(),
        }),
      ),
    }),
  ),
});

const moneyOrNull = (minor: bigint | null, currency: string): MoneyDto | null =>
  minor === null ? null : moneyOf(minor, currency);

export const memberMatrixDto = (matrix: MemberLineMatrix): z.infer<typeof MemberMatrixSchema> => ({
  spaceId: matrix.spaceId,
  period: periodDto(matrix.period),
  plan: reportPlanDto(matrix.plan),
  lines: matrix.lines.map((line) => ({
    lineId: line.lineId,
    name: line.name,
    funding: line.funding,
    rule: line.rule,
    reason: line.reason,
    members: line.members.map((cell) => ({
      memberId: cell.memberId,
      assigned: moneyOrNull(cell.assigned, matrix.currency),
      contributed: moneyOrNull(cell.contributed, matrix.currency),
      consumed: moneyOrNull(cell.consumed, matrix.currency),
      gap: moneyOrNull(cell.gap, matrix.currency),
      status: cell.status,
    })),
  })),
});

```

4. Insert before the last line of the file (`};`, the end of `reportingPaths`):

```ts
  "/api/v1/spaces/{spaceId}/reports/member-matrix": {
    get: {
      operationId: "getMemberLineMatrix",
      summary: "Assigned, contributed, consumed and gap per member and budget line for a period; computed on read",
      description:
        "Every member reads it, viewers and archived spaces included. Reasons (NOT_ALLOCATED, TRACKED_AT_FUND_LEVEL, INVALID_ALLOCATION) and statuses (OVER_CONTRIBUTED, UNDER_CONTRIBUTED, ON_TARGET) are codes.",
      ...securedByUser,
      requestParams: { path: SpacePath, query: ReportQuerySchema },
      responses: {
        "200": {
          description: "The lines of the period's plan, each with every current member in join order",
          content: jsonContent(MemberMatrixSchema),
        },
        ...reportProblems,
      },
    },
  },
```

`src/app/api/v1/spaces/[spaceId]/reports/member-matrix/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { memberMatrixDto, ReportQuerySchema } from "@/modules/reporting/contracts/reporting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: ReportQuerySchema,
  handler: async ({ user, params, query }) => {
    const result = await getContainer().reporting.getMemberLineMatrix({
      spaceId: params.spaceId!,
      userId: user!.id,
      period: query.period,
    });
    return result.ok ? ok({ status: 200, body: memberMatrixDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Replace the line `import { createGetLineDashboard, type GetLineDashboard } from "@/modules/reporting/application";` with:

```ts
import {
  createGetLineDashboard,
  createGetMemberLineMatrix,
  type GetLineDashboard,
  type GetMemberLineMatrix,
} from "@/modules/reporting/application";
```

2. Insert after the line `    readonly getLineDashboard: GetLineDashboard;`:

```ts
    readonly getMemberLineMatrix: GetMemberLineMatrix;
```

3. Insert after the line `  const reportingDeps = {`:

```ts
    // HU-E7-02, HU-E7-03: the ledger sums payments, shares and fund contributions per member in SQL (D7).
    sums: ledgerQueries,
```

4. Insert after the line `      getLineDashboard: createGetLineDashboard(reportingDeps),`:

```ts
      getMemberLineMatrix: createGetMemberLineMatrix(reportingDeps),
```

In `docs/backlog/E7-reporting.md`, insert after the line `- Golden test: the reference example fixture produces exactly these values.`:

```markdown
- `GET …/reports/member-matrix?period=<label>` is `space.read` and finds the period and its plan like HU-E7-01 (M4 ruling P33). Each line carries `funding`, `rule`, `reason` and every current member in join order, guests included (ruling P7), with `assigned`, `contributed`, `consumed`, `gap` and `status`. Expenses count on the line their category consumes (its mapping, else the catch-all line; unmapped ones without a catch-all are not in the matrix), a subcategory's on its parent category's line (HU-E3-04, M4 ruling P96). Reasons: `NOT_ALLOCATED` (rule NONE: only `consumed`), `TRACKED_AT_FUND_LEVEL` (SHARED_FUND: `contributed` and `gap` null, HU-E7-03 tracks them), `INVALID_ALLOCATION` (`assigned` and `gap` null). Statuses: `OVER_CONTRIBUTED` (gap > 0), `UNDER_CONTRIBUTED` (gap < 0), `ON_TARGET` (0). SAVINGS lines have no `consumed`; their `contributed` is what reached each account the line names, credited to the account's owner, only for accounts of current registered members (ruling P35, P8). Without a plan, `lines` is empty.
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds only `GET /api/v1/spaces/{spaceId}/reports/member-matrix` (about 250 lines); no component is added or changed, and no new `…Output` component appears.
Then run: `pnpm exec vitest run --project acceptance tests/acceptance/reports-member-matrix.test.ts tests/acceptance/reports-lines.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/v1/spaces/[spaceId]/reports/member-matrix/route.ts" src/modules/reporting/contracts/reporting.contract.ts src/composition/container.ts openapi/openapi.snapshot.json docs/backlog/E7-reporting.md tests/support/reporting.ts tests/acceptance/reports-member-matrix.test.ts
git commit -m "feat(reporting): serve the member by line matrix over HTTP (Refs #57)"
```

---

### Task 6b: HTTP — shared fund contribution tracking

Implements HU-E7-03 (issue #58) over HTTP: `GET /api/v1/spaces/{spaceId}/reports/fund-contributions?period=<label>`. Pins the `@golden` scenario and the contribution outside the period against PostgreSQL.

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/reports/fund-contributions/route.ts`
- Modify: `src/modules/reporting/contracts/reporting.contract.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E7-reporting.md`, `tests/support/reporting.ts`
- Create (test): `tests/acceptance/reports-fund-contributions.test.ts`

**Interfaces:**
- Consumes: `createGetFundContributions`, `GetFundContributions`, `FundContributionReport` (Task 5); `DrizzleLedgerQueries.fundContributionsByMember` (Task 4); `reportingDeps.sums` (Task 6a); `ReportQuerySchema`, `ReportPlanSchema`, `reportPlanDto`, `moneyOf`, `reportProblems`, `SpacePath` (Task 2a); `reportHousehold`, `getWithQuery`, `ReportPeriodDto`, `ReportPlanDto` (Task 2a); `newPlan` (`tests/support/budgeting.ts`); `post`, `cop`, `HouseholdMember`.
- Produces: `FundContributionsSchema`, `fundContributionsDto`; `Container.reporting.getFundContributions`; test support `getFundContributions(user, spaceId, query)`, `contribute(member, fund, pesos, date)`, `FundContributionsDto`.

- [ ] **Step 1: Write the failing tests**

In `tests/support/reporting.ts`:

1. Insert after the line `import { GET as matrixRoute } from "@/app/api/v1/spaces/[spaceId]/reports/member-matrix/route";`:

```ts
import { GET as fundRoute } from "@/app/api/v1/spaces/[spaceId]/reports/fund-contributions/route";
import { POST as recordContribution } from "@/app/api/v1/spaces/[spaceId]/fund-contributions/route";
```

2. Append to the end of the file:

```ts

export interface FundContributionsDto {
  spaceId: string;
  period: ReportPeriodDto;
  plan: ReportPlanDto | null;
  members: { memberId: string; expected: MoneyDto; actual: MoneyDto; difference: MoneyDto }[];
}

/** HU-E7-03: `user` reads the fund contribution tracking of `spaceId`. */
export const getFundContributions = (user: TestUser, spaceId: string, query: Record<string, string>) =>
  getWithQuery(fundRoute, user, `/api/v1/spaces/${spaceId}/reports/fund-contributions`, query, { spaceId });

/** HU-E4-09: `member` pays `pesos` into `fund` from their own account on `date`; throws unless 201. */
export const contribute = async (member: HouseholdMember, fund: string, pesos: number, date: string) => {
  const response = await post(recordContribution, member, "fund-contributions", {
    date,
    amount: cop(pesos),
    fundAccountId: fund,
    sourceAccountId: member.account,
  });
  if (response.status !== 201) throw new Error(`contribution failed with status ${response.status}`);
};
```

`tests/acceptance/reports-fund-contributions.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setContainerForTests, type Container } from "@/composition/container";
import { problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { newPlan } from "../support/budgeting";
import { cop } from "../support/ledger";
import {
  contribute,
  getFundContributions,
  reportHousehold,
  type FundContributionsDto,
} from "../support/reporting";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const trackingOf = async (user: TestUser, spaceId: string, period: string) => {
  const response = await getFundContributions(user, spaceId, { period });
  expect(response.status).toBe(200);
  const tracking = (await response.json()) as FundContributionsDto;
  return tracking.members.map((m) => [m.memberId, m.expected, m.actual, m.difference]);
};

describe("fund contribution tracking over HTTP (HU-E7-03)", () => {
  it("compares expected and actual contributions, leaving out those dated outside the period (@golden)", async () => {
    const { h, fund } = await reportHousehold();
    await contribute(h.ana, fund, 480_000, "2026-11-02");
    await contribute(h.juan, fund, 500_000, "2026-11-03");
    await contribute(h.juan, fund, 720_000, "2026-10-31");
    expect(await trackingOf(h.ana, h.spaceId, "2026-11")).toEqual([
      [h.ana.memberId, cop(480_000), cop(480_000), cop(0)],
      [h.juan.memberId, cop(720_000), cop(500_000), cop(-220_000)],
    ]);
  });

  it("expects nothing from anyone in the 2026-12 plan, which has no SHARED_FUND line", async () => {
    const { h, fund } = await reportHousehold();
    await newPlan(h.ana, h.spaceId, "2026-12");
    await contribute(h.ana, fund, 100_000, "2026-12-01");
    expect(await trackingOf(h.juan, h.spaceId, "2026-12")).toEqual([
      [h.ana.memberId, cop(0), cop(100_000), cop(100_000)],
      [h.juan.memberId, cop(0), cop(0), cop(0)],
    ]);
  });

  it("hides the space from non-members", async () => {
    const { h } = await reportHousehold();
    const marta = await registerUser("Marta");
    expect(await problemOf(await getFundContributions(marta, h.spaceId, { period: "2026-11" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/reports-fund-contributions.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/v1/spaces/[spaceId]/reports/fund-contributions/route'`.

- [ ] **Step 3: Implement**

In `src/modules/reporting/contracts/reporting.contract.ts`:

1. Insert before the line `  type LineDashboard,`:

```ts
  type FundContributionReport,
```

2. Insert before the line `const SpacePath = z.object({ spaceId: z.string() });`:

```ts
/** HU-E7-03: each current member's expected and actual contributions to the shared fund (spec 5.4, ruling P36). */
export const FundContributionsSchema = z.object({
  spaceId: z.string(),
  period: PeriodSchema,
  plan: ReportPlanSchema,
  /** Every current member in join order, guests included. */
  members: z.array(
    z.object({
      memberId: z.string(),
      /** Σ the member's assigned amounts on the plan's SHARED_FUND lines; 0 without a plan. */
      expected: MoneySchema,
      /** Σ the member's fund contributions dated in the period. */
      actual: MoneySchema,
      /** actual − expected; negative while the member still has to pay in. */
      difference: MoneySchema,
    }),
  ),
});

export const fundContributionsDto = (report: FundContributionReport): z.infer<typeof FundContributionsSchema> => ({
  spaceId: report.spaceId,
  period: periodDto(report.period),
  plan: reportPlanDto(report.plan),
  members: report.members.map((m) => ({
    memberId: m.memberId,
    expected: moneyOf(m.expected, report.currency),
    actual: moneyOf(m.actual, report.currency),
    difference: moneyOf(m.difference, report.currency),
  })),
});

```

3. Insert before the last line of the file (`};`, the end of `reportingPaths`):

```ts
  "/api/v1/spaces/{spaceId}/reports/fund-contributions": {
    get: {
      operationId: "getFundContributions",
      summary: "Expected versus actual contributions to the shared fund per member for a period; computed on read",
      description:
        "Every member reads it, archived spaces included. Expected comes from the plan's SHARED_FUND lines (0 without a plan); actual counts fund contributions dated in the period.",
      ...securedByUser,
      requestParams: { path: SpacePath, query: ReportQuerySchema },
      responses: {
        "200": {
          description: "Every current member in join order",
          content: jsonContent(FundContributionsSchema),
        },
        ...reportProblems,
      },
    },
  },
```

`src/app/api/v1/spaces/[spaceId]/reports/fund-contributions/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { fundContributionsDto, ReportQuerySchema } from "@/modules/reporting/contracts/reporting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: ReportQuerySchema,
  handler: async ({ user, params, query }) => {
    const result = await getContainer().reporting.getFundContributions({
      spaceId: params.spaceId!,
      userId: user!.id,
      period: query.period,
    });
    return result.ok ? ok({ status: 200, body: fundContributionsDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert before the line `  type GetLineDashboard,`:

```ts
  createGetFundContributions,
  type GetFundContributions,
```

2. Insert after the line `    readonly getMemberLineMatrix: GetMemberLineMatrix;`:

```ts
    readonly getFundContributions: GetFundContributions;
```

3. Insert after the line `      getMemberLineMatrix: createGetMemberLineMatrix(reportingDeps),`:

```ts
      getFundContributions: createGetFundContributions(reportingDeps),
```

In `docs/backlog/E7-reporting.md`, insert after the line `- expectedFundContribution(m) = Σ assigned(m) over SHARED_FUND lines; actualFundContribution(m) = Σ fund-contribution transfers by m in the period.`:

```markdown
- `GET …/reports/fund-contributions?period=<label>` is `space.read` and finds the period and its plan like HU-E7-01 (M4 ruling P33). It lists every current member in join order (ruling P7) with `expected` (Σ assigned over the plan's SHARED_FUND lines; a NONE line or an invalid allocation assigns nothing; 0 without a plan), `actual` (Σ the member's live fund contributions recorded in the space and dated in the period, from outside the app included) and `difference` = actual − expected (ruling P36).
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds only `GET /api/v1/spaces/{spaceId}/reports/fund-contributions` (about 150 lines); no component is added or changed.
Then run: `pnpm exec vitest run --project acceptance tests/acceptance/reports-fund-contributions.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/v1/spaces/[spaceId]/reports/fund-contributions/route.ts" src/modules/reporting/contracts/reporting.contract.ts src/composition/container.ts openapi/openapi.snapshot.json docs/backlog/E7-reporting.md tests/support/reporting.ts tests/acceptance/reports-fund-contributions.test.ts
git commit -m "feat(reporting): serve shared fund contribution tracking over HTTP (Refs #58)"
```

---

### Task 7: Spaces and ledger — a user's places and their personal sums, in SQL

Gives HU-E7-04 (issue #59) its two read sides, computed on read (D7): the spaces module lists every member row linked to a user, current or former, claimed guest places included (spec 5.4 "every SpaceMember row linked to u", D15); the ledger sums one set of member ids' shares per space and category, and their payments and fund contributions with the part "outside the app". Reporting declares the matching ports in Task 8b (ruling P32).

**Files:**
- Create: `src/modules/spaces/application/member-places.ts`
- Modify: `src/modules/spaces/application/index.ts`, `src/modules/spaces/infrastructure/drizzle-space-repository.ts`, `src/modules/ledger/infrastructure/drizzle-ledger-queries.ts`, `src/modules/ledger/infrastructure/drizzle-report-sums.int.test.ts`
- Create (test): `src/modules/spaces/infrastructure/drizzle-member-places.int.test.ts`

**Interfaces:**
- Consumes: `personalSpaceFixture`, `sharedSpaceFixture(db, ownerId, now)`, `guestMemberFixture`, `userFixture`, `categoryFixture`, `sharedLedgerFixture` (`tests/support/fixtures.ts`); `DrizzleSpaceRepository.addMember`, `markLeft`, `claimGuest`; the Task 4 test helpers `pesos`, `nov1`, `nov30`, `expense`, `contribution`, `store`, `sorted`, `queries`.
- Produces: `MemberPlace { memberId, spaceId, spaceName, spaceKind, currency, periodPolicy }` and `MemberPlaceRepository { placesOf(userId): Promise<MemberPlace[]> }` exported by `@/modules/spaces/application`; `DrizzleSpaceRepository.placesOf`; `DrizzleLedgerQueries.consumptionByCategory(memberIds, from, to): Promise<{ spaceId: string; categoryId: string; amount: bigint }[]>` and `DrizzleLedgerQueries.cashOut(memberIds, from, to): Promise<{ payments: bigint; paymentsOutsideTheApp: bigint; fundContributions: bigint; contributionsOutsideTheApp: bigint }>`.

- [ ] **Step 1: Write the failing tests**

`src/modules/spaces/infrastructure/drizzle-member-places.int.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { testDatabase } from "../../../../tests/support/database";
import {
  guestMemberFixture,
  personalSpaceFixture,
  sharedSpaceFixture,
  userFixture,
} from "../../../../tests/support/fixtures";
import type { SpaceMember, SpaceMemberId } from "../domain/space";
import { DrizzleSpaceRepository } from "./drizzle-space-repository";

const { db, pool } = testDatabase();
const repo = new DrizzleSpaceRepository(new DrizzleTransactionManager(db));

afterAll(() => pool.end());

const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
const place = (spaceId: string, memberId: string, spaceName: string, spaceKind: string) => ({
  memberId,
  spaceId,
  spaceName,
  spaceKind,
  currency: "COP",
  periodPolicy: { kind: "MONTHLY", day: 1 },
});

describe("a user's places (HU-E7-04, D15)", () => {
  it("lists every member row of the user, left and claimed ones included, oldest space first, and no one else's", async () => {
    const ana = await personalSpaceFixture(db, pool, "Ana");
    const juan = await userFixture(pool, "Juan");
    const household = await sharedSpaceFixture(db, ana.userId, later(1));
    const trip = await sharedSpaceFixture(db, juan.id, later(2));
    const left: SpaceMember = {
      id: randomUUID() as SpaceMemberId,
      kind: "USER",
      userId: ana.userId,
      displayName: "Ana B",
      role: "MEMBER",
      contactEmail: null,
      joinedAt: later(3),
    };
    expect(await repo.addMember(trip.id, left)).toBe("added");
    expect(await repo.markLeft(trip.id, left.id, "USER", later(4))).toBe(true);
    const camping = await sharedSpaceFixture(db, juan.id, later(5));
    const guest = await guestMemberFixture(
      pool,
      { userId: juan.id, spaceId: camping.id, memberId: camping.members[0]!.id },
      "Pedro",
    );
    const claimed: SpaceMember = { ...left, id: guest as SpaceMemberId, displayName: "Pedro", joinedAt: later(6) };
    expect(await repo.claimGuest(camping.id, claimed, later(7))).toBe("claimed");
    expect(await repo.placesOf(ana.userId)).toEqual([
      place(ana.spaceId, ana.memberId, "Personal", "PERSONAL"),
      place(household.id, household.members[0]!.id, "Household", "SHARED"),
      place(trip.id, left.id, "Household", "SHARED"),
      place(camping.id, guest, "Household", "SHARED"),
    ]);
    expect(await repo.placesOf(randomUUID())).toEqual([]);
  });
});
```

In `src/modules/ledger/infrastructure/drizzle-report-sums.int.test.ts`, append to the end of the file:

```ts

describe("one user's sums across their places (HU-E7-04)", () => {
  it("sums the shares of the user's member rows per space and category within the dates, and no one else's", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const ana = w.household.memberId;
    const anaAtHome = w.personal.memberId;
    const market = await categoryFixture(db, w.personal, "Market");
    const byAnaAtHome = { memberId: anaAtHome, accountId: w.bank };
    await store(
      expense(w.personal, market, "2026-11-03", pesos(85_000n), byAnaAtHome, [anaAtHome]),
      expense(w.household, w.groceries, "2026-11-05", pesos(300_000n), { memberId: w.pedro, accountId: null }, [
        ana,
        w.pedro,
      ]),
      expense(w.household, w.groceries, "2026-11-26", pesos(200_000n), { memberId: null, accountId: w.fund }, [
        ana,
        w.pedro,
      ]),
      // Pedro's own expense, the next period's and a deleted one count for nobody here.
      expense(w.household, w.groceries, "2026-11-07", pesos(40_000n), { memberId: w.pedro, accountId: null }, [
        w.pedro,
      ]),
      expense(w.household, w.groceries, "2026-12-01", pesos(60_000n), { memberId: ana, accountId: w.bank }, [ana]),
      softDelete(expense(w.personal, market, "2026-11-04", pesos(10_000n), byAnaAtHome, [anaAtHome]), new Date()),
    );
    const expected = [
      { spaceId: w.personal.spaceId, categoryId: market, amount: pesos(85_000n) },
      { spaceId: w.household.spaceId, categoryId: w.groceries, amount: pesos(250_000n) },
    ];
    expect(await queries.consumptionByCategory([anaAtHome, ana], nov1, nov30)).toEqual(
      sorted(expected, (row) => `${row.spaceId}/${row.categoryId}`),
    );
    expect(await queries.consumptionByCategory(["not-a-uuid"], nov1, nov30)).toEqual([]);
  });

  it("sums what the user's member rows paid out, each with the part outside the app", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const ana = w.household.memberId;
    const anaAtHome = w.personal.memberId;
    const market = await categoryFixture(db, w.personal, "Market");
    const both = [ana, w.pedro];
    await store(
      expense(w.personal, market, "2026-11-03", pesos(85_000n), { memberId: anaAtHome, accountId: w.bank }, [
        anaAtHome,
      ]),
      expense(w.household, w.groceries, "2026-11-05", pesos(2_000_000n), { memberId: ana, accountId: w.bank }, both),
      // Recorded while Ana was a guest of the space, before her claim: no account.
      expense(w.household, w.groceries, "2026-11-06", pesos(30_000n), { memberId: ana, accountId: null }, both),
      // Not Ana's payments: Pedro's and the fund's.
      expense(w.household, w.groceries, "2026-11-07", pesos(300_000n), { memberId: w.pedro, accountId: null }, both),
      expense(w.household, w.groceries, "2026-11-08", pesos(1_200_000n), { memberId: null, accountId: w.fund }, both),
      contribution(w.household, w.fund, "2026-11-01", pesos(480_000n), ana, w.bank),
      contribution(w.household, w.fund, "2026-11-02", pesos(20_000n), ana, null),
      contribution(w.household, w.fund, "2026-12-01", pesos(99_000n), ana, w.bank),
    );
    expect(await queries.cashOut([anaAtHome, ana], nov1, nov30)).toEqual({
      payments: pesos(2_115_000n),
      paymentsOutsideTheApp: pesos(30_000n),
      fundContributions: pesos(500_000n),
      contributionsOutsideTheApp: pesos(20_000n),
    });
    expect(await queries.cashOut([], nov1, nov30)).toEqual({
      payments: 0n,
      paymentsOutsideTheApp: 0n,
      fundContributions: 0n,
      contributionsOutsideTheApp: 0n,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project integration src/modules/spaces/infrastructure/drizzle-member-places.int.test.ts src/modules/ledger/infrastructure/drizzle-report-sums.int.test.ts`
Expected: FAIL — `repo.placesOf is not a function`, `queries.consumptionByCategory is not a function`, `queries.cashOut is not a function`.

- [ ] **Step 3: Implement**

`src/modules/spaces/application/member-places.ts`:

```ts
import type { PeriodPolicy } from "@/shared/kernel";
import type { SpaceId, SpaceKind, SpaceMemberId } from "../domain/space";

/** HU-E7-04, D15: one member row of a user in one space, current or former; a claimed guest place included. */
export interface MemberPlace {
  readonly memberId: SpaceMemberId;
  readonly spaceId: SpaceId;
  readonly spaceName: string;
  readonly spaceKind: SpaceKind;
  readonly currency: string;
  readonly periodPolicy: PeriodPolicy;
}

export interface MemberPlaceRepository {
  /**
   * Every member row linked to the user (spec 5.4: the unified view works through all of them), rows the user left
   * and archived spaces included, oldest space first; `[]` for unknown users.
   */
  placesOf(userId: string): Promise<MemberPlace[]>;
}
```

In `src/modules/spaces/application/index.ts`, append to the end of the file:

```ts
export type { MemberPlace, MemberPlaceRepository } from "./member-places";
```

In `src/modules/spaces/infrastructure/drizzle-space-repository.ts`:

1. Insert after the line `import type { SpaceRepository, SpaceSummary } from "../application/space-repository";`:

```ts
import type { MemberPlace, MemberPlaceRepository } from "../application/member-places";
```

2. Replace the line `  implements SpaceRepository, SpaceSettingsRepository, SpaceMemberRepository` with:

```ts
  implements SpaceRepository, SpaceSettingsRepository, SpaceMemberRepository, MemberPlaceRepository
```

3. Insert before the line `  async findMembership(spaceId: string, userId: string): Promise<SpaceMembership | null> {`:

```ts
  async placesOf(userId: string): Promise<MemberPlace[]> {
    const rows = await this.tm
      .executor()
      .select({
        memberId: spaceMembers.id,
        spaceId: spaces.id,
        spaceName: spaces.name,
        spaceKind: spaces.kind,
        currency: spaces.currency,
        periodPolicy: spaces.periodPolicy,
      })
      .from(spaceMembers)
      .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
      // D15: left rows keep their history and a claim keeps the guest's row, so neither filters by leftAt or kind.
      .where(eq(spaceMembers.userId, userId))
      .orderBy(asc(spaces.createdAt), asc(spaceMembers.joinedAt), asc(spaceMembers.id));
    return rows.map((row) => ({ ...row, memberId: row.memberId as SpaceMemberId, spaceId: row.spaceId as SpaceId }));
  }

```

In `src/modules/ledger/infrastructure/drizzle-ledger-queries.ts`, insert before the line `  private matching(f: TransactionFilter) {`:

```ts
  /**
   * HU-E7-04, spec 5.4 (D11): Σ the shares of `memberIds`, one user's member rows, over live expenses dated within
   * [from, to], per space and category, whatever space recorded them; sorted by space, then category; `[]` without
   * well-formed ids.
   */
  async consumptionByCategory(
    memberIds: readonly string[],
    from: LocalDate,
    to: LocalDate,
  ): Promise<{ spaceId: string; categoryId: string; amount: bigint }[]> {
    const ids = memberIds.filter(isUuid);
    if (ids.length === 0) return [];
    const rows = await this.tm
      .executor()
      .select({
        spaceId: transactions.spaceId,
        categoryId: transactions.categoryId,
        total: sumAsText(shares.amount),
      })
      .from(shares)
      .innerJoin(transactions, eq(transactions.id, shares.transactionId))
      .where(
        and(
          inArray(shares.memberId, ids),
          eq(transactions.type, "EXPENSE"),
          isNull(transactions.deletedAt),
          between(transactions.date, from, to),
        ),
      )
      .groupBy(transactions.spaceId, transactions.categoryId)
      .orderBy(asc(transactions.spaceId), asc(transactions.categoryId));
    return rows.flatMap((row) =>
      row.categoryId === null
        ? []
        : [{ spaceId: row.spaceId, categoryId: row.categoryId, amount: BigInt(row.total) }],
    );
  }

  /**
   * HU-E7-04, spec 5.4: what `memberIds` paid out within [from, to]: their payments of live expenses and their live
   * fund contributions, each with the part without an account ("outside the app": a guest's history before a claim).
   */
  async cashOut(
    memberIds: readonly string[],
    from: LocalDate,
    to: LocalDate,
  ): Promise<{
    payments: bigint;
    paymentsOutsideTheApp: bigint;
    fundContributions: bigint;
    contributionsOutsideTheApp: bigint;
  }> {
    const ids = memberIds.filter(isUuid);
    if (ids.length === 0) {
      return { payments: 0n, paymentsOutsideTheApp: 0n, fundContributions: 0n, contributionsOutsideTheApp: 0n };
    }
    const db = this.tm.executor();
    const live = and(isNull(transactions.deletedAt), between(transactions.date, from, to));
    const [paid] = await db
      .select({
        total: sql<string>`coalesce(sum(${payments.amount}), 0)::text`,
        outside: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.accountId} is null), 0)::text`,
      })
      .from(payments)
      .innerJoin(transactions, eq(transactions.id, payments.transactionId))
      .where(and(live, eq(transactions.type, "EXPENSE"), inArray(payments.memberId, ids)));
    const [contributed] = await db
      .select({
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text`,
        outside: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.sourceAccountId} is null), 0)::text`,
      })
      .from(transactions)
      .where(and(live, eq(transactions.type, "TRANSFER"), inArray(transactions.payerMemberId, ids)));
    return {
      payments: BigInt(paid?.total ?? "0"),
      paymentsOutsideTheApp: BigInt(paid?.outside ?? "0"),
      fundContributions: BigInt(contributed?.total ?? "0"),
      contributionsOutsideTheApp: BigInt(contributed?.outside ?? "0"),
    };
  }

```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project integration src/modules/spaces/infrastructure src/modules/ledger/infrastructure`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/application/member-places.ts src/modules/spaces/application/index.ts src/modules/spaces/infrastructure/drizzle-space-repository.ts src/modules/spaces/infrastructure/drizzle-member-places.int.test.ts src/modules/ledger/infrastructure/drizzle-ledger-queries.ts src/modules/ledger/infrastructure/drizzle-report-sums.int.test.ts
git commit -m "feat(ledger): sum one user's consumption and cash out across every place they hold (Refs #59)"
```

---

### Task 8a: Reporting domain — consumption groups and cash out

Implements the pure rules of HU-E7-04 (issue #59): consumption grouped by catalog key across spaces, custom categories kept per space (D11), a subcategory's consumption counted in its parent category (HU-E3-04) and every group named (ruling P76; both ruling P95), and cash out = payments + fund contributions + savings transfers with the part outside the app (spec 5.4, ruling P37).

**Files:**
- Create: `src/modules/reporting/domain/unified-view.ts`
- Create (test): `src/modules/reporting/domain/unified-view.test.ts`

**Interfaces:**
- Consumes: nothing outside the module.
- Produces: `CategoryConsumption { spaceId, categoryId, amount }`, `ConsumptionCategory { spaceId, id, key, name, parentCategoryId }`, `ConsumptionGroup { key, name, spaceId, categoryId, amount }`, `ConsumptionNaming { personalSpaceId, spaceNames }`, `consumptionGroups(rows, categories, naming): ConsumptionGroup[]`, `CashOut { total, payments, fundContributions, savingsTransfers, outsideTheApp }`, `cashOutOf(sums, savingsTransfers): CashOut`.

- [ ] **Step 1: Write the failing tests**

`src/modules/reporting/domain/unified-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cashOutOf, consumptionGroups, type ConsumptionCategory } from "./unified-view";

const pesos = (n: number) => BigInt(n) * 100n;
const category = (
  spaceId: string,
  id: string,
  name: string,
  key: string | null = null,
  parentCategoryId: string | null = null,
): ConsumptionCategory => ({ spaceId, id, key, name, parentCategoryId });
const CATEGORIES: readonly ConsumptionCategory[] = [
  category("space-ana", "cat-ana-groceries", "Groceries", "groceries"),
  category("space-ana", "cat-ana-restaurants", "Restaurants", "restaurants"),
  category("space-ana", "cat-ana-pets", "Pets"),
  category("space-ana", "cat-ana-verduras", "Verduras", null, "cat-ana-groceries"),
  category("space-household", "cat-groceries", "Mercado", "groceries"),
  category("space-household", "cat-rent", "Arriendo", "rent"),
  category("space-household", "cat-pets", "Pets"),
  category("space-household", "cat-vet", "Vet", null, "cat-pets"),
  category("space-trip", "cat-trip-rent", "Cabin", "rent"),
];
const NAMING = {
  personalSpaceId: "space-ana",
  spaceNames: new Map([
    ["space-ana", "Personal"],
    ["space-household", "Household"],
    ["space-trip", "Trip"],
  ]),
};

describe("unified personal view (HU-E7-04, D11)", () => {
  it("groups seeded categories of every space under their catalog key, the largest first", () => {
    const rows = [
      { spaceId: "space-ana", categoryId: "cat-ana-groceries", amount: pesos(85_000) },
      { spaceId: "space-ana", categoryId: "cat-ana-restaurants", amount: pesos(60_000) },
      { spaceId: "space-household", categoryId: "cat-groceries", amount: pesos(950_000) },
      { spaceId: "space-household", categoryId: "cat-rent", amount: pesos(480_000) },
    ];
    expect(consumptionGroups(rows, CATEGORIES, NAMING)).toEqual([
      { key: "groceries", name: "Groceries", spaceId: null, categoryId: null, amount: pesos(1_035_000) },
      { key: "rent", name: "Arriendo", spaceId: null, categoryId: null, amount: pesos(480_000) },
      { key: "restaurants", name: "Restaurants", spaceId: null, categoryId: null, amount: pesos(60_000) },
    ]);
  });

  it("keeps custom categories apart, one group per space and category", () => {
    const rows = [
      { spaceId: "space-ana", categoryId: "cat-ana-pets", amount: pesos(30_000) },
      { spaceId: "space-household", categoryId: "cat-pets", amount: pesos(30_000) },
    ];
    expect(consumptionGroups(rows, CATEGORIES, NAMING)).toEqual([
      { key: null, name: "Pets", spaceId: "space-ana", categoryId: "cat-ana-pets", amount: pesos(30_000) },
      { key: null, name: "Pets", spaceId: "space-household", categoryId: "cat-pets", amount: pesos(30_000) },
    ]);
  });

  it("rolls a subcategory up into its category: under the parent's key, or into the parent's custom row (HU-E3-04)", () => {
    const rows = [
      { spaceId: "space-ana", categoryId: "cat-ana-verduras", amount: pesos(20_000) },
      { spaceId: "space-household", categoryId: "cat-groceries", amount: pesos(100_000) },
      { spaceId: "space-household", categoryId: "cat-vet", amount: pesos(25_000) },
      { spaceId: "space-household", categoryId: "cat-pets", amount: pesos(5_000) },
    ];
    expect(consumptionGroups(rows, CATEGORIES, NAMING)).toEqual([
      { key: "groceries", name: "Groceries", spaceId: null, categoryId: null, amount: pesos(120_000) },
      { key: null, name: "Pets", spaceId: "space-household", categoryId: "cat-pets", amount: pesos(30_000) },
    ]);
  });

  it("names a merged group as the personal space does, else as the space spending most in it (ruling P76)", () => {
    const rows = [
      { spaceId: "space-household", categoryId: "cat-groceries", amount: pesos(900_000) },
      { spaceId: "space-household", categoryId: "cat-rent", amount: pesos(100_000) },
      { spaceId: "space-trip", categoryId: "cat-trip-rent", amount: pesos(300_000) },
    ];
    expect(consumptionGroups(rows, CATEGORIES, NAMING).map((g) => [g.key, g.name])).toEqual([
      ["groceries", "Groceries"],
      ["rent", "Cabin"],
    ]);
  });

  it("adds payments, fund contributions and savings transfers into cash out, with what left outside the app", () => {
    const sums = {
      payments: pesos(2_145_000),
      paymentsOutsideTheApp: pesos(30_000),
      fundContributions: pesos(480_000),
      contributionsOutsideTheApp: pesos(20_000),
    };
    expect(cashOutOf(sums, pesos(200_000))).toEqual({
      total: pesos(2_825_000),
      payments: pesos(2_145_000),
      fundContributions: pesos(480_000),
      savingsTransfers: pesos(200_000),
      outsideTheApp: pesos(50_000),
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/domain/unified-view.test.ts`
Expected: FAIL — `Cannot find module './unified-view'`.

- [ ] **Step 3: Implement**

`src/modules/reporting/domain/unified-view.ts`:

```ts
/** What a user consumed in one category of one space (spec 5.4: their shares). */
export interface CategoryConsumption {
  readonly spaceId: string;
  readonly categoryId: string;
  readonly amount: bigint;
}

/** A live category of one of the user's spaces, as the unified view places and names it (D11, HU-E3-04). */
export interface ConsumptionCategory {
  readonly spaceId: string;
  readonly id: string;
  /** The seeded category's catalog key; null for categories users create and for every subcategory. */
  readonly key: string | null;
  readonly name: string;
  /** HU-E3-04: the category a subcategory belongs to; null for a category directly in its group. */
  readonly parentCategoryId: string | null;
}

/** D11: a catalog key groups seeded categories of every space; a custom category (key null) stays its own. */
export interface ConsumptionGroup {
  readonly key: string | null;
  /** A merged group's name in the personal space, else in the space spending most in it (P76); a custom one's own. */
  readonly name: string;
  /** The custom category and its space; null under a catalog key. */
  readonly spaceId: string | null;
  readonly categoryId: string | null;
  readonly amount: bigint;
}

/** Who names a merged group: the caller's personal space, else the space spending most in it (ruling P76). */
export interface ConsumptionNaming {
  readonly personalSpaceId: string;
  readonly spaceNames: ReadonlyMap<string, string>;
}

interface Group {
  readonly key: string | null;
  readonly spaceId: string | null;
  readonly categoryId: string | null;
  amount: bigint;
  /** What each space spent in the group, and the name the group's category has there. */
  readonly parts: Map<string, { readonly name: string; amount: bigint }>;
}

const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * HU-E7-04, spec 5.4, D11: consumption by catalog key, or by space and category for custom categories; a
 * subcategory's consumption counts in its parent category (HU-E3-04: under the parent's key, or as the parent's custom
 * row). The largest group first, ties in the order of their keys (ruling P37).
 */
export const consumptionGroups = (
  rows: readonly CategoryConsumption[],
  categories: readonly ConsumptionCategory[],
  naming: ConsumptionNaming,
): ConsumptionGroup[] => {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const own = byId.get(row.categoryId);
    // A subcategory whose parent is not listed counts as a category of its own (ruling P48 keeps such a parent).
    const parentId = own?.parentCategoryId ?? null;
    const category = (parentId === null ? undefined : byId.get(parentId)) ?? own;
    const categoryId = category?.id ?? row.categoryId;
    const key = category?.key ?? null;
    const id = key === null ? `custom/${row.spaceId}/${categoryId}` : `key/${key}`;
    const group = groups.get(id) ?? {
      key,
      spaceId: key === null ? row.spaceId : null,
      categoryId: key === null ? categoryId : null,
      amount: 0n,
      parts: new Map(),
    };
    group.amount += row.amount;
    const part = group.parts.get(row.spaceId) ?? { name: category?.name ?? "", amount: 0n };
    part.amount += row.amount;
    group.parts.set(row.spaceId, part);
    groups.set(id, group);
  }
  // Ruling P76: a merged group takes the name its key has in the personal space, even without consumption there.
  const personalNames = new Map(
    categories.flatMap((c) =>
      c.spaceId === naming.personalSpaceId && c.key !== null && c.parentCategoryId === null ? [[c.key, c.name]] : [],
    ),
  );
  const spaceName = (spaceId: string) => naming.spaceNames.get(spaceId) ?? "";
  const nameOf = (group: Group): string =>
    (group.key === null ? undefined : personalNames.get(group.key)) ??
    [...group.parts.entries()].sort(([a, x], [b, y]) =>
      x.amount !== y.amount ? (x.amount > y.amount ? -1 : 1) : ordinal(spaceName(a), spaceName(b)) || ordinal(a, b),
    )[0]![1].name;
  return [...groups.entries()]
    .sort(([a, x], [b, y]) => (x.amount !== y.amount ? (x.amount > y.amount ? -1 : 1) : ordinal(a, b)))
    .map(([, group]) => ({
      key: group.key,
      name: nameOf(group),
      spaceId: group.spaceId,
      categoryId: group.categoryId,
      amount: group.amount,
    }));
};

/** Spec 5.4: payments + fund contributions + savings transfers; `outsideTheApp` is the part without an account. */
export interface CashOut {
  readonly total: bigint;
  readonly payments: bigint;
  readonly fundContributions: bigint;
  readonly savingsTransfers: bigint;
  readonly outsideTheApp: bigint;
}

export const cashOutOf = (
  sums: {
    readonly payments: bigint;
    readonly paymentsOutsideTheApp: bigint;
    readonly fundContributions: bigint;
    readonly contributionsOutsideTheApp: bigint;
  },
  savingsTransfers: bigint,
): CashOut => ({
  total: sums.payments + sums.fundContributions + savingsTransfers,
  payments: sums.payments,
  fundContributions: sums.fundContributions,
  savingsTransfers,
  outsideTheApp: sums.paymentsOutsideTheApp + sums.contributionsOutsideTheApp,
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/reporting/domain`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/reporting/domain/unified-view.ts src/modules/reporting/domain/unified-view.test.ts
git commit -m "feat(reporting): group consumption by catalog key and add up cash out (Refs #59)"
```

---

### Task 8b: Reporting — GetUnifiedPersonalView

Implements HU-E7-04 (issue #59) at the use-case level: the caller's personal period (stored first, D10), every member row linked to them (spec 5.4), consumption grouped by catalog key or by space and category (D11, Task 8a), a subcategory's in its parent category and each group named as the personal space names its key (ruling P95), and cash out = payments + fund contributions + savings transfers with the part outside the app (ruling P37). Only the caller's own rows are ever asked for, so no shared view and no other member's personal space reaches the answer (spec, HU-E7-04 notes).

**Files:**
- Create: `src/modules/reporting/application/personal-scope.ts`, `src/modules/reporting/application/get-unified-personal-view.ts`
- Modify: `src/modules/reporting/application/index.ts`
- Create (test): `tests/support/personal-world.ts`, `src/modules/reporting/application/unified-view.test.ts`

**Interfaces:**
- Consumes: `consumptionGroups(rows, categories, naming)`, `cashOutOf`, `CashOut` (Task 8a); `MemberPlace`, `MemberPlaceRepository` (Task 7); `BudgetPlanRepository.storedPeriods`, `PlanSpending.transfersIntoAccounts`; `periodByLabel`; `InMemoryBudgetPlans`.
- Produces: `PersonalSums { consumptionByCategory, cashOut }` (the shapes `DrizzleLedgerQueries` implements since Task 7), `ReportCategories { listCategories(spaceId) }` (each category with `id`, `key`, `name`, `parentCategoryId`), `SavingsAccountsOf`, `PersonalDeps { places, plans, sums, catalog, spending, savingsAccountsOf }` (`catalog`, not `categories`: the shared `reportingDeps` holds budgeting's `categories`, ruling P95), `PersonalScope { personal, period, stored, places, otherCurrencies }`, `personalScope(deps, userId, label): Promise<Result<PersonalScope>>`, `consumptionTotal(deps, scope, period): Promise<bigint>`; `UnifiedGroup { key, name, space, category, amount }`, `UnifiedPersonalView { currency, period, consumption: { total, groups }, cashOut, otherCurrencySpaces }`, `GetUnifiedPersonalView = (input: { userId; period }) => …`, `createGetUnifiedPersonalView(deps: PersonalDeps)`; test support `PersonalSumsByPeriod`, `place(spaceId, memberId, spaceName, overrides?)`, `ANA_PLACES`, `personalWorld(places?)` returning `{ plans, sums, transfers, deps }`.

- [ ] **Step 1: Write the failing tests**

`tests/support/personal-world.ts`:

```ts
import type { PersonalDeps, PersonalSums } from "@/modules/reporting/application";
import type { MemberPlace, SpaceId, SpaceMemberId } from "@/modules/spaces/application";
import type { LocalDate } from "@/shared/kernel";
import { InMemoryBudgetPlans } from "./in-memory-budgeting";

const NOTHING_PAID = { payments: 0n, paymentsOutsideTheApp: 0n, fundContributions: 0n, contributionsOutsideTheApp: 0n };

/** One user's sums per period, keyed by the first day asked for, as the ledger sums them; records every question. */
export class PersonalSumsByPeriod implements PersonalSums {
  readonly consumption: Record<string, { spaceId: string; categoryId: string; amount: bigint }[]> = {};
  readonly paidOut: Record<string, typeof NOTHING_PAID> = {};
  readonly asked: { memberIds: readonly string[]; from: LocalDate; to: LocalDate }[] = [];

  async consumptionByCategory(memberIds: readonly string[], from: LocalDate, to: LocalDate) {
    this.asked.push({ memberIds, from, to });
    return [...(this.consumption[from] ?? [])];
  }

  async cashOut(memberIds: readonly string[], from: LocalDate, to: LocalDate) {
    this.asked.push({ memberIds, from, to });
    return this.paidOut[from] ?? NOTHING_PAID;
  }
}

/** A member row of Ana: a shared COP space with MONTHLY(1) unless told otherwise. */
export const place = (
  spaceId: string,
  memberId: string,
  spaceName: string,
  overrides: Partial<MemberPlace> = {},
): MemberPlace => ({
  memberId: memberId as SpaceMemberId,
  spaceId: spaceId as SpaceId,
  spaceName,
  spaceKind: "SHARED",
  currency: "COP",
  periodPolicy: { kind: "MONTHLY", day: 1 },
  ...overrides,
});

/** HU-E7-04 Background: Ana's personal space, MONTHLY(1), and Household, MONTHLY(25). */
export const ANA_PLACES: readonly MemberPlace[] = [
  place("space-ana", "member-ana-personal", "Personal", { spaceKind: "PERSONAL" }),
  place("space-household", "member-ana", "Household", { periodPolicy: { kind: "MONTHLY", day: 25 } }),
];

/**
 * Ana (`u-ana`) with `places`, the categories of her personal space and of Household (seeded ones with catalog keys,
 * one custom "Pets" in each, a subcategory in each), her savings account `acc-savings`, in-memory plans and the
 * ledger's sums per period.
 */
export const personalWorld = (places: readonly MemberPlace[] = ANA_PLACES) => {
  const plans = new InMemoryBudgetPlans();
  const sums = new PersonalSumsByPeriod();
  const transfers: Record<string, { accountId: string; amount: bigint }[]> = {};
  const category = (id: string, key: string | null, name: string, parentCategoryId: string | null = null) => ({
    id,
    key,
    name,
    parentCategoryId,
  });
  const categories: Record<string, ReturnType<typeof category>[]> = {
    "space-ana": [
      category("cat-ana-groceries", "groceries", "Groceries"),
      category("cat-ana-restaurants", "restaurants", "Restaurants"),
      category("cat-ana-pets", null, "Pets"),
      // HU-E3-04: a subcategory of her Groceries.
      category("cat-ana-verduras", null, "Verduras", "cat-ana-groceries"),
    ],
    "space-household": [
      category("cat-groceries", "groceries", "Mercado"),
      category("cat-rent", "rent", "Rent"),
      category("cat-pets", null, "Pets"),
      category("cat-vet", null, "Vet", "cat-pets"),
    ],
  };
  const deps: PersonalDeps = {
    places: { placesOf: async (userId) => (userId === "u-ana" ? [...places] : []) },
    plans,
    sums,
    catalog: { listCategories: async (spaceId) => categories[spaceId] ?? [] },
    spending: {
      transfersIntoAccounts: async (accountIds, from) =>
        (transfers[from] ?? []).filter((t) => accountIds.includes(t.accountId)),
    },
    savingsAccountsOf: async (userId) => (userId === "u-ana" ? ["acc-savings"] : []),
  };
  return { plans, sums, transfers, deps };
};
```

`src/modules/reporting/application/unified-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BudgetPlanId } from "@/modules/budgeting/application";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { ANA_PLACES, personalWorld, place } from "../../../../tests/support/personal-world";
import { createGetUnifiedPersonalView } from "./get-unified-personal-view";

const pesos = (n: number) => BigInt(n) * 100n;
const NOVEMBER = "2026-11-01";

/** HU-E7-04 Background as the ledger sums Ana's rows: her personal Market and Dinner, her shares in Household. */
const background = () => {
  const w = personalWorld();
  w.sums.consumption[NOVEMBER] = [
    { spaceId: "space-ana", categoryId: "cat-ana-groceries", amount: pesos(85_000) },
    { spaceId: "space-ana", categoryId: "cat-ana-restaurants", amount: pesos(60_000) },
    { spaceId: "space-household", categoryId: "cat-groceries", amount: pesos(950_000) },
    { spaceId: "space-household", categoryId: "cat-rent", amount: pesos(480_000) },
  ];
  w.sums.paidOut[NOVEMBER] = {
    payments: pesos(2_145_000),
    paymentsOutsideTheApp: 0n,
    fundContributions: pesos(480_000),
    contributionsOutsideTheApp: 0n,
  };
  return w;
};
const read = (w: ReturnType<typeof personalWorld>, period = "2026-11", userId = "u-ana") =>
  createGetUnifiedPersonalView(w.deps)({ userId, period });

describe("unified personal view (HU-E7-04)", () => {
  it("totals Ana's consumption across spaces, Groceries of both under the key groceries (@critical)", async () => {
    const view = unwrap(await read(background()));
    expect(view.consumption.total).toBe(pesos(1_575_000));
    // Ruling P76: Household's "Mercado" takes the name Ana's personal space gives the key.
    expect(view.consumption.groups).toEqual([
      { key: "groceries", name: "Groceries", space: null, category: null, amount: pesos(1_035_000) },
      { key: "rent", name: "Rent", space: null, category: null, amount: pesos(480_000) },
      { key: "restaurants", name: "Restaurants", space: null, category: null, amount: pesos(60_000) },
    ]);
  });

  it("reports cash out apart from consumption, the 480,000 COP fund contribution included (@critical)", async () => {
    const view = unwrap(await read(background()));
    expect(view.cashOut).toEqual({
      total: pesos(2_625_000),
      payments: pesos(2_145_000),
      fundContributions: pesos(480_000),
      savingsTransfers: 0n,
      outsideTheApp: 0n,
    });
    expect(view.consumption.total).toBe(pesos(1_575_000));
  });

  it("adds the transfers into Ana's own savings accounts and names what left outside the app", async () => {
    const w = background();
    w.transfers[NOVEMBER] = [
      { accountId: "acc-savings", amount: pesos(200_000) },
      { accountId: "acc-juan-savings", amount: pesos(50_000) },
    ];
    w.sums.paidOut[NOVEMBER] = {
      payments: pesos(2_145_000),
      paymentsOutsideTheApp: pesos(30_000),
      fundContributions: pesos(480_000),
      contributionsOutsideTheApp: pesos(20_000),
    };
    expect(unwrap(await read(w)).cashOut).toMatchObject({
      total: pesos(2_825_000),
      savingsTransfers: pesos(200_000),
      outsideTheApp: pesos(50_000),
    });
  });

  it("asks only about Ana's own member rows, within her personal period, whatever Household's policy", async () => {
    const w = background();
    const view = unwrap(await read(w));
    expect(view.period).toEqual({ start: "2026-11-01", end: "2026-11-30", label: "2026-11" });
    expect(w.sums.asked).toEqual([
      { memberIds: ["member-ana-personal", "member-ana"], from: "2026-11-01", to: "2026-11-30" },
      { memberIds: ["member-ana-personal", "member-ana"], from: "2026-11-01", to: "2026-11-30" },
    ]);
  });

  it("uses the stored period of a plan of her personal space (D10)", async () => {
    const w = background();
    await w.plans.add({
      id: "plan-ana" as BudgetPlanId,
      spaceId: "space-ana",
      period: { start: "2026-11-05" as LocalDate, end: "2026-12-04" as LocalDate, label: "2026-11" },
      status: "ACTIVE",
      createdFrom: null,
      version: 1,
      createdBy: "u-ana",
      createdAt: new Date("2026-10-14T12:00:00Z"),
    });
    expect(unwrap(await read(w)).period).toMatchObject({ start: "2026-11-05", end: "2026-12-04" });
  });

  it("keeps custom categories apart under their space and category", async () => {
    const w = personalWorld();
    w.sums.consumption[NOVEMBER] = [
      { spaceId: "space-ana", categoryId: "cat-ana-pets", amount: pesos(40_000) },
      { spaceId: "space-household", categoryId: "cat-pets", amount: pesos(30_000) },
    ];
    expect(unwrap(await read(w)).consumption.groups).toEqual([
      {
        key: null,
        name: "Pets",
        space: { id: "space-ana", name: "Personal" },
        category: { id: "cat-ana-pets", name: "Pets" },
        amount: pesos(40_000),
      },
      {
        key: null,
        name: "Pets",
        space: { id: "space-household", name: "Household" },
        category: { id: "cat-pets", name: "Pets" },
        amount: pesos(30_000),
      },
    ]);
  });

  it("counts a subcategory's consumption in its category, under its key or its custom row (HU-E3-04)", async () => {
    const w = personalWorld();
    w.sums.consumption[NOVEMBER] = [
      { spaceId: "space-ana", categoryId: "cat-ana-verduras", amount: pesos(20_000) },
      { spaceId: "space-household", categoryId: "cat-groceries", amount: pesos(100_000) },
      { spaceId: "space-household", categoryId: "cat-vet", amount: pesos(25_000) },
    ];
    expect(unwrap(await read(w)).consumption.groups.map((g) => [g.key, g.name, g.category?.id ?? null, g.amount])).toEqual([
      ["groceries", "Groceries", null, pesos(120_000)],
      [null, "Pets", "cat-pets", pesos(25_000)],
    ]);
  });

  it("leaves spaces in another currency out of every sum and names them once (D6)", async () => {
    const trip = place("space-trip", "member-ana-trip", "Trip", { currency: "USD" });
    const again = place("space-trip", "member-ana-trip-2", "Trip", { currency: "USD" });
    const w = personalWorld([...ANA_PLACES, trip, again]);
    const view = unwrap(await read(w));
    expect(view.otherCurrencySpaces).toEqual([{ spaceId: "space-trip", name: "Trip", currency: "USD" }]);
    expect(w.sums.asked[0]?.memberIds).toEqual(["member-ana-personal", "member-ana"]);
    expect(view.currency).toBe("COP");
  });

  it("refuses a label her personal policy does not name", async () => {
    expect(codeOf(await read(background(), "2026-11 H1"))).toBe("InvalidPeriodLabel");
    expect(codeOf(await read(background(), "2026-11", "u-nobody"))).toBe("SpaceNotFound");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting`
Expected: FAIL — `Cannot find module './get-unified-personal-view'` (and `PersonalDeps` missing from `@/modules/reporting/application` in the world).

- [ ] **Step 3: Implement**

`src/modules/reporting/application/personal-scope.ts`:

```ts
import type { BudgetPlanRepository, PlanSpending } from "@/modules/budgeting/application";
import type { MemberPlace, MemberPlaceRepository } from "@/modules/spaces/application";
import {
  domainError,
  err,
  ok,
  periodByLabel,
  type LocalDate,
  type Period,
  type Result,
  type StoredPeriod,
} from "@/shared/kernel";

/** HU-E7-04: one user's sums across their member rows, by the ledger on read (D7). */
export interface PersonalSums {
  /** Σ the members' shares of live expenses per space and category. */
  consumptionByCategory(
    memberIds: readonly string[],
    from: LocalDate,
    to: LocalDate,
  ): Promise<readonly { readonly spaceId: string; readonly categoryId: string; readonly amount: bigint }[]>;
  /** Σ the members' payments and fund contributions, each with the part without an account. */
  cashOut(
    memberIds: readonly string[],
    from: LocalDate,
    to: LocalDate,
  ): Promise<{
    readonly payments: bigint;
    readonly paymentsOutsideTheApp: bigint;
    readonly fundContributions: bigint;
    readonly contributionsOutsideTheApp: bigint;
  }>;
}

/**
 * The live categories of a space with their catalog keys (D11) and parents (HU-E3-04), archived ones included;
 * bound to the categories module.
 */
export interface ReportCategories {
  listCategories(spaceId: string): Promise<
    readonly {
      readonly id: string;
      readonly key: string | null;
      readonly name: string;
      readonly parentCategoryId: string | null;
    }[]
  >;
}

/** The ids of the user's own SAVINGS accounts, archived ones included; bound to the accounts module. */
export type SavingsAccountsOf = (userId: string) => Promise<readonly string[]>;

/** What the caller's own reports need (HU-E7-04, HU-E7-05); the composition root binds each port. */
export interface PersonalDeps {
  readonly places: MemberPlaceRepository;
  readonly plans: Pick<BudgetPlanRepository, "storedPeriods">;
  readonly sums: PersonalSums;
  /** Not `categories`: the shared `reportingDeps` holds budgeting's port under that key for `loadPlanView`. */
  readonly catalog: ReportCategories;
  readonly spending: Pick<PlanSpending, "transfersIntoAccounts">;
  readonly savingsAccountsOf: SavingsAccountsOf;
}

export interface PersonalScope {
  readonly personal: MemberPlace;
  readonly period: Period;
  /** The stored periods of the personal space's plans (D10). */
  readonly stored: readonly StoredPeriod[];
  /** The caller's member rows in spaces of the personal space's currency (D6, ruling P37). */
  readonly places: readonly MemberPlace[];
  /** The caller's member rows in spaces of another currency, left out of every sum (ruling P37). */
  readonly otherCurrencies: readonly MemberPlace[];
}

/**
 * HU-E7-04, D11: the caller's personal space, the period named `label` in its policy (a stored one first, D10) and
 * every member row linked to the caller (spec 5.4). Only the caller's own rows are read, so no one else's personal
 * data can reach their view.
 */
export const personalScope = async (
  deps: PersonalDeps,
  userId: string,
  label: string,
): Promise<Result<PersonalScope>> => {
  const places = await deps.places.placesOf(userId);
  // HU-E1-02: every user has one personal space; without one there is nothing to read.
  const personal = places.find((p) => p.spaceKind === "PERSONAL");
  if (personal === undefined) return err(domainError("SpaceNotFound"));
  const stored = await deps.plans.storedPeriods(personal.spaceId);
  const period = periodByLabel(personal.periodPolicy, stored, label);
  if (!period.ok) return period;
  return ok({
    personal,
    period: period.value,
    stored,
    places: places.filter((p) => p.currency === personal.currency),
    otherCurrencies: places.filter((p) => p.currency !== personal.currency),
  });
};

/** Σ the caller's consumption within `period` across `scope.places` (spec 5.4). */
export const consumptionTotal = async (
  deps: PersonalDeps,
  scope: PersonalScope,
  period: Period,
): Promise<bigint> => {
  const rows = await deps.sums.consumptionByCategory(
    scope.places.map((p) => p.memberId),
    period.start,
    period.end,
  );
  return rows.reduce((sum, row) => sum + row.amount, 0n);
};
```

`src/modules/reporting/application/get-unified-personal-view.ts`:

```ts
import { ok, type Period, type Result } from "@/shared/kernel";
import { cashOutOf, consumptionGroups, type CashOut } from "../domain/unified-view";
import { personalScope, type PersonalDeps } from "./personal-scope";

/** One group of the caller's consumption: a catalog key, or a custom category with its space ("space / category"). */
export interface UnifiedGroup {
  readonly key: string | null;
  /** A merged group's name in the personal space, else in the space spending most in it (ruling P76). */
  readonly name: string;
  readonly space: { readonly id: string; readonly name: string } | null;
  readonly category: { readonly id: string; readonly name: string | null } | null;
  readonly amount: bigint;
}

export interface UnifiedPersonalView {
  /** The personal space's currency, every amount's (D6). */
  readonly currency: string;
  /** The caller's personal-space period; shared transactions are placed in it by date (D11). */
  readonly period: Period;
  readonly consumption: { readonly total: bigint; readonly groups: readonly UnifiedGroup[] };
  readonly cashOut: CashOut;
  /** Spaces in another currency, left out of every sum, each named once (ruling P37). */
  readonly otherCurrencySpaces: readonly { readonly spaceId: string; readonly name: string; readonly currency: string }[];
}

export type GetUnifiedPersonalView = (input: {
  readonly userId: string;
  readonly period: string;
}) => Promise<Result<UnifiedPersonalView>>;

/**
 * HU-E7-04, spec 5.4, D11: everything the caller consumed in a personal period (their shares in every space they are
 * or were a member of, the history of a claimed guest place included) and their cash out, computed on read (D7).
 */
export const createGetUnifiedPersonalView =
  (deps: PersonalDeps): GetUnifiedPersonalView =>
  async ({ userId, period: label }) => {
    const scope = await personalScope(deps, userId, label);
    if (!scope.ok) return scope;
    const { personal, period, places, otherCurrencies } = scope.value;
    const memberIds = places.map((p) => p.memberId);
    const rows = await deps.sums.consumptionByCategory(memberIds, period.start, period.end);
    // The personal space's categories name the merged groups, even without consumption there (ruling P76).
    const spaceIds = [...new Set<string>([personal.spaceId, ...rows.map((row) => row.spaceId)])];
    const listed = await Promise.all(
      spaceIds.map(async (spaceId) =>
        (await deps.catalog.listCategories(spaceId)).map((c) => ({ ...c, spaceId })),
      ),
    );
    const categories = listed.flat();
    const spaceNames = new Map(places.map((p) => [p.spaceId as string, p.spaceName]));
    const savings = await deps.savingsAccountsOf(userId);
    const transfers =
      savings.length === 0 ? [] : await deps.spending.transfersIntoAccounts(savings, period.start, period.end);
    const paidOut = await deps.sums.cashOut(memberIds, period.start, period.end);
    const others = new Map(otherCurrencies.map((p) => [p.spaceId as string, p]));
    return ok({
      currency: personal.currency,
      period,
      consumption: {
        total: rows.reduce((sum, row) => sum + row.amount, 0n),
        groups: consumptionGroups(rows, categories, { personalSpaceId: personal.spaceId, spaceNames }).map((g) => ({
          key: g.key,
          name: g.name,
          space: g.spaceId === null ? null : { id: g.spaceId, name: spaceNames.get(g.spaceId) ?? "" },
          category: g.categoryId === null ? null : { id: g.categoryId, name: g.name },
          amount: g.amount,
        })),
      },
      cashOut: cashOutOf(
        paidOut,
        transfers.reduce((sum, t) => sum + t.amount, 0n),
      ),
      otherCurrencySpaces: [...others.values()].map((p) => ({
        spaceId: p.spaceId,
        name: p.spaceName,
        currency: p.currency,
      })),
    });
  };
```

In `src/modules/reporting/application/index.ts`, append to the end of the file:

```ts
export type { CashOut, ConsumptionGroup } from "../domain/unified-view";
export type {
  PersonalDeps,
  PersonalScope,
  PersonalSums,
  ReportCategories,
  SavingsAccountsOf,
} from "./personal-scope";
export {
  createGetUnifiedPersonalView,
  type GetUnifiedPersonalView,
  type UnifiedGroup,
  type UnifiedPersonalView,
} from "./get-unified-personal-view";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/reporting`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/reporting/application tests/support/personal-world.ts
git commit -m "feat(reporting): derive the unified personal view across every place of the user (Refs #59)"
```

---

### Task 9a: HTTP — the unified personal view

Implements HU-E7-04 (issue #59) over HTTP: `GET /api/v1/me/unified-view?period=<label>`, the caller's own view only. Pins both `@critical` scenarios against PostgreSQL; Task 9b adds the privacy and period-placement scenarios, the HU-E1-11 assertions and the backlog notes (this half measures 458 lines, 216 of them snapshot).

**Files:**
- Create: `src/app/api/v1/me/unified-view/route.ts`
- Modify: `src/modules/reporting/contracts/reporting.contract.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`, `tests/support/reporting.ts`
- Create (test): `tests/acceptance/unified-view.test.ts`

**Interfaces:**
- Consumes: `createGetUnifiedPersonalView`, `GetUnifiedPersonalView`, `UnifiedPersonalView` (Task 8b); `DrizzleSpaceRepository.placesOf`, `DrizzleLedgerQueries.consumptionByCategory`, `cashOut` (Task 7); `transfersIntoAccounts` (M3-A); `categoriesDeps.categories.listCategories` (bound as `catalog`, ruling P95), `accountsDeps.accounts.listBySpace`, `spaceRepository.listForUser` in the composition root; `ReportQuerySchema`, `moneyOf`, `periodDto` (Task 2a); `reportHousehold`, `spend`, `contribute` (Tasks 2a, 6b); `activatePlan`; `categoryWithKey`, `post`, `cop`, `HouseholdMember`.
- Produces: `UnifiedViewSchema`, `unifiedViewDto`; `Container.reporting.getUnifiedPersonalView`; `savingsAccountsOf` and `reportingDeps.places`, `.catalog`, `.savingsAccountsOf` in the composition root; `consumption.categories[].name` on the wire (`UnifiedGroup.name`, ruling P95); test support `getUnifiedView(user, query)`, `UnifiedViewDto`.

- [ ] **Step 1: Write the failing tests**

In `tests/support/reporting.ts`:

1. Insert after the line `import { GET as fundRoute } from "@/app/api/v1/spaces/[spaceId]/reports/fund-contributions/route";`:

```ts
import { GET as unifiedRoute } from "@/app/api/v1/me/unified-view/route";
```

2. Append to the end of the file:

```ts

export interface UnifiedViewDto {
  currency: string;
  period: ReportPeriodDto;
  consumption: {
    total: MoneyDto;
    categories: {
      key: string | null;
      name: string;
      space: { id: string; name: string } | null;
      category: { id: string; name: string | null } | null;
      amount: MoneyDto;
    }[];
  };
  cashOut: {
    total: MoneyDto;
    payments: MoneyDto;
    fundContributions: MoneyDto;
    savingsTransfers: MoneyDto;
    outsideTheApp: MoneyDto;
  };
  otherCurrencySpaces: { spaceId: string; name: string; currency: string }[];
}

/** HU-E7-04: `user` reads their own unified view. */
export const getUnifiedView = (user: TestUser, query: Record<string, string>) =>
  getWithQuery(unifiedRoute, user, "/api/v1/me/unified-view", query);
```

`tests/acceptance/unified-view.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { activatePlan } from "../support/budgeting";
import { categoryWithKey, cop, post, type HouseholdMember } from "../support/ledger";
import {
  contribute,
  getUnifiedView,
  reportHousehold,
  spend,
  type UnifiedViewDto,
} from "../support/reporting";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const viewOf = async (user: TestUser, period = "2026-11"): Promise<UnifiedViewDto> => {
  const response = await getUnifiedView(user, { period });
  expect(response.status).toBe(200);
  return (await response.json()) as UnifiedViewDto;
};

/** `member` records an expense in their own personal space, from their own account. */
const spendAtHome = async (member: HouseholdMember, key: string, pesos: number, date: string) => {
  const response = await post(recordExpense, member.personal, "expenses", {
    description: "Personal",
    date,
    categoryId: await categoryWithKey(member.personal, key),
    amount: cop(pesos),
    accountId: member.account,
  });
  expect(response.status).toBe(201);
};

/**
 * HU-E7-04 Background: Ana's personal Market (85,000) and Dinner (60,000); in Household, under its ACTIVE 2026-11
 * plan, her 2,000,000 COP Home purchase and the fund's 1,200,000 COP Rent split BY_ALLOCATION (40 %), Juan's
 * 300,000 COP market split EQUAL, and her 480,000 COP fund contribution from Bancolombia on 2026-11-01.
 */
const background = async () => {
  const r = await reportHousehold();
  const { h, category, fund } = r;
  expect((await activatePlan(h.ana, h.spaceId, r.planId)).status).toBe(200);
  await spendAtHome(h.ana, "groceries", 85_000, "2026-11-03");
  await spendAtHome(h.ana, "restaurants", 60_000, "2026-11-04");
  await spend(h.ana, category.groceries, 2_000_000, "2026-11-05");
  await spend(h.ana, category.rent, 1_200_000, "2026-11-01", fund);
  const market = await post(recordExpense, h.juan, "expenses", {
    description: "Weekly market",
    date: "2026-11-12",
    categoryId: category.groceries,
    amount: cop(300_000),
    payments: [{ memberId: h.juan.memberId, accountId: h.juan.account, amount: cop(300_000) }],
    split: { method: "EQUAL", participants: [{ memberId: h.ana.memberId }, { memberId: h.juan.memberId }] },
  });
  expect(market.status).toBe(201);
  await contribute(h.ana, fund, 480_000, "2026-11-01");
  return r;
};

describe("unified personal view over HTTP (HU-E7-04)", () => {
  it("totals Ana's consumption across spaces, Groceries of both under the key groceries (@critical)", async () => {
    const { h } = await background();
    const view = await viewOf(h.ana);
    expect(view.consumption.total).toEqual(cop(1_575_000));
    expect(view.consumption.categories).toEqual([
      // Named as Ana's personal space names each key (ruling P76), seeded in Spanish.
      { key: "groceries", name: "Mercado", space: null, category: null, amount: cop(1_035_000) },
      { key: "rent", name: "Arriendo", space: null, category: null, amount: cop(480_000) },
      { key: "restaurants", name: "Restaurantes", space: null, category: null, amount: cop(60_000) },
    ]);
  });

  it("reports Ana's cash out of 2,625,000 COP, the fund contribution included, apart from consumption (@critical)", async () => {
    const { h } = await background();
    const view = await viewOf(h.ana);
    expect(view.cashOut).toEqual({
      total: cop(2_625_000),
      payments: cop(2_145_000),
      fundContributions: cop(480_000),
      savingsTransfers: cop(0),
      outsideTheApp: cop(0),
    });
    expect(view.consumption.total).toEqual(cop(1_575_000));
    expect(view.otherCurrencySpaces).toEqual([]);
  });

  it("refuses a missing period and a label the caller's personal policy does not name", async () => {
    const ana = await registerUser("Ana");
    expect(await problemOf(await getUnifiedView(ana, {}))).toEqual([422, "ValidationFailed"]);
    expect(await problemOf(await getUnifiedView(ana, { period: "2026-11 H1" }))).toEqual([422, "InvalidPeriodLabel"]);
  });
});

```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/unified-view.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/v1/me/unified-view/route'`.

- [ ] **Step 3: Implement**

In `src/modules/reporting/contracts/reporting.contract.ts`:

1. Insert before the line `  type LineDashboard,`:

```ts
  type UnifiedPersonalView,
```

2. Insert before the line `const SpacePath = z.object({ spaceId: z.string() });`:

```ts
/** HU-E7-04: the caller's consumption and cash out in their personal period (spec 5.4, D11, ruling P37). */
export const UnifiedViewSchema = z.object({
  /** The personal space's currency, every amount's (D6). */
  currency: z.string(),
  /** The caller's personal-space period; shared transactions are placed in it by date. */
  period: PeriodSchema,
  consumption: z.object({
    total: MoneySchema,
    /** The largest first: a catalog `key` groups seeded categories of every space; a custom one comes with its space. */
    categories: z.array(
      z.object({
        key: z.string().nullable(),
        /** A merged group's name in the caller's personal space, else in the space spending most in it. */
        name: z.string(),
        space: z.object({ id: z.string(), name: z.string() }).nullable(),
        category: z.object({ id: z.string(), name: z.string().nullable() }).nullable(),
        amount: MoneySchema,
      }),
    ),
  }),
  /** payments + fund contributions + savings transfers (spec 5.4); settlements are not cash out. */
  cashOut: z.object({
    total: MoneySchema,
    payments: MoneySchema,
    fundContributions: MoneySchema,
    savingsTransfers: MoneySchema,
    /** The part paid without an account, while the caller was a guest. */
    outsideTheApp: MoneySchema,
  }),
  /** Spaces in another currency, left out of every amount. */
  otherCurrencySpaces: z.array(z.object({ spaceId: z.string(), name: z.string(), currency: z.string() })),
});

export const unifiedViewDto = (view: UnifiedPersonalView): z.infer<typeof UnifiedViewSchema> => {
  const money = (minor: bigint) => moneyOf(minor, view.currency);
  return {
    currency: view.currency,
    period: periodDto(view.period),
    consumption: {
      total: money(view.consumption.total),
      categories: view.consumption.groups.map((g) => ({
        key: g.key,
        name: g.name,
        space: g.space,
        category: g.category,
        amount: money(g.amount),
      })),
    },
    cashOut: {
      total: money(view.cashOut.total),
      payments: money(view.cashOut.payments),
      fundContributions: money(view.cashOut.fundContributions),
      savingsTransfers: money(view.cashOut.savingsTransfers),
      outsideTheApp: money(view.cashOut.outsideTheApp),
    },
    otherCurrencySpaces: view.otherCurrencySpaces.map((s) => ({ ...s })),
  };
};

```

3. Insert before the last line of the file (`};`, the end of `reportingPaths`):

```ts
  "/api/v1/me/unified-view": {
    get: {
      operationId: "getUnifiedPersonalView",
      summary: "The caller's consumption and cash out in a personal period, across every space they are or were in",
      description:
        "Only the caller's own member rows are read, a claimed guest place's history included; other members' personal spaces never appear. Shared transactions are placed by date into the caller's personal period; categories group by catalog key, a subcategory under its parent category, and a merged group takes the name the caller's personal space gives its key.",
      ...securedByUser,
      requestParams: { query: ReportQuerySchema },
      responses: {
        "200": {
          description: "The caller's consumption by category and cash out, in the personal space's currency",
          content: jsonContent(UnifiedViewSchema),
        },
        ...problems({ "401": "Unauthenticated", "422": "ValidationFailed, InvalidPeriodLabel" }),
      },
    },
  },
```

`src/app/api/v1/me/unified-view/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ReportQuerySchema, unifiedViewDto } from "@/modules/reporting/contracts/reporting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: ReportQuerySchema,
  handler: async ({ user, query }) => {
    const result = await getContainer().reporting.getUnifiedPersonalView({
      userId: user!.id,
      period: query.period,
    });
    return result.ok ? ok({ status: 200, body: unifiedViewDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert before the line `  type GetLineDashboard,`:

```ts
  createGetUnifiedPersonalView,
  type GetUnifiedPersonalView,
```

2. Insert after the line `    readonly getFundContributions: GetFundContributions;`:

```ts
    readonly getUnifiedPersonalView: GetUnifiedPersonalView;
```

3. Insert before the line `  // HU-E7-01 … HU-E7-05: reports read budgeting's figures and the ledger's sums through ports, on read (D7, P32).`:

```ts
  // HU-E7-04 (ruling P37): the caller's own SAVINGS accounts live in their personal space (HU-E2-01), archived too.
  const savingsAccountsOf = async (userId: string): Promise<string[]> => {
    const personal = (await spaceRepository.listForUser(userId)).find((s) => s.kind === "PERSONAL");
    if (!personal) return [];
    const accounts = await accountsDeps.accounts.listBySpace(personal.id);
    return accounts.filter((a) => a.type === "SAVINGS" && a.ownerUserId === userId).map((a) => a.id);
  };
```

4. Insert after the line `  const reportingDeps = {`:

```ts
    // HU-E7-04: the caller's own member rows (spaces), category keys (catalog) and savings accounts (accounts).
    places: spaceRepository,
    catalog: categoriesDeps.categories,
    savingsAccountsOf,
```

5. Insert after the line `      getFundContributions: createGetFundContributions(reportingDeps),`:

```ts
      getUnifiedPersonalView: createGetUnifiedPersonalView(reportingDeps),
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds only `GET /api/v1/me/unified-view` (about 216 lines, `name` included); no component is added or changed.
Then run: `pnpm exec vitest run --project acceptance tests/acceptance/unified-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/me/unified-view/route.ts src/modules/reporting/contracts/reporting.contract.ts src/composition/container.ts openapi/openapi.snapshot.json tests/support/reporting.ts tests/acceptance/unified-view.test.ts
git commit -m "feat(reporting): serve the unified personal view over HTTP (Refs #59)"
```

---

### Task 9b: HTTP — privacy, the personal period and the claimed guest place

Completes HU-E7-04 (issue #59) over HTTP: another member's personal expense never reaches the caller's view, a shared expense is placed in the caller's personal period whatever its space's policy, and the unified-view assertions that HU-E1-11 (issue #20) deferred to M4 (`docs/backlog/README.md`: "become testable once HU-E7-04 lands"). The behaviour was test-driven in Task 7 (`placesOf` keeps claimed and left rows; the sums read only the given member ids) and Task 8b, so these tests pass on their first run; each pins one HTTP-observable outcome. Adds both backlog notes.

**Files:**
- Modify: `tests/acceptance/unified-view.test.ts`, `docs/backlog/E7-reporting.md`, `docs/backlog/E1-identity-and-spaces.md`

**Interfaces:**
- Consumes: `viewOf`, `spendAtHome`, `background` (Task 9a, in the test file); `getLineDashboard`, `LineDashboardDto` (Task 2a); `household`, `addGuest`, `newAccount`, `categoryWithKey`, `post`, `cop`; `actingIn`, `claimLink`, `newSharedSpace` (`tests/support/spaces.ts`); `call`, `registerUser`.
- Produces: nothing new.

- [ ] **Step 1: Write the tests**

In `tests/acceptance/unified-view.test.ts`:

1. Insert after the line `import { afterAll, beforeAll, describe, expect, it } from "vitest";`:

```ts
import { POST as acceptClaim } from "@/app/api/v1/claims/[token]/accept/route";
```

2. Insert after the line `import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";`:

```ts
import { PATCH as updateSpace } from "@/app/api/v1/spaces/[spaceId]/route";
```

3. Replace the line `import { problemOf, registerUser, startTestApp, type TestUser } from "../support/app";` with:

```ts
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
```

4. Replace the line `import { categoryWithKey, cop, post, type HouseholdMember } from "../support/ledger";` with:

```ts
import {
  addGuest,
  categoryWithKey,
  cop,
  household,
  newAccount,
  post,
  type HouseholdMember,
} from "../support/ledger";
```

5. Replace the seven lines of the reporting import, from `import {` to `} from "../support/reporting";` (as Task 9a writes it, already in Prettier's form), with:

```ts
import {
  contribute,
  getLineDashboard,
  getUnifiedView,
  reportHousehold,
  spend,
  type LineDashboardDto,
  type UnifiedViewDto,
} from "../support/reporting";
import { actingIn, claimLink, newSharedSpace } from "../support/spaces";
```

6. Insert before the last line of the file (`});`, the end of the first `describe`):

```ts

  it("never includes Juan's personal expense in Ana's view, while Juan's own view has it", async () => {
    const { h } = await background();
    await spendAtHome(h.juan, "groceries", 90_000, "2026-11-06");
    expect((await viewOf(h.ana)).consumption.total).toEqual(cop(1_575_000));
    // Juan's 90,000 COP and his shares: 1,200,000 Home, 720,000 Rent and 150,000 market.
    expect((await viewOf(h.juan)).consumption.total).toEqual(cop(2_160_000));
  });

  it("places a shared expense of 2026-11-26 in Ana's 2026-11, while MONTHLY(25) Casa counts it in 2026-12", async () => {
    const ana = await registerUser("Ana");
    const casa = await newSharedSpace(ana, "Casa");
    const policy = await call(updateSpace, "PATCH", `/api/v1/spaces/${casa}`, {
      user: ana,
      params: { spaceId: casa },
      body: { periodPolicy: { kind: "MONTHLY", day: 25 } },
    });
    expect(policy.status).toBe(200);
    const inCasa = actingIn(ana, casa);
    const recorded = await post(recordExpense, inCasa, "expenses", {
      description: "Market",
      date: "2026-11-26",
      categoryId: await categoryWithKey(inCasa, "groceries"),
      amount: cop(100_000),
      accountId: await newAccount(ana, "Bancolombia", 1_000_000),
    });
    expect(recorded.status).toBe(201);
    expect((await viewOf(ana)).consumption.total).toEqual(cop(100_000));
    const dashboard = (await (await getLineDashboard(ana, casa, { period: "2026-12" })).json()) as LineDashboardDto;
    expect(dashboard.period).toEqual({ label: "2026-12", startDate: "2026-11-25", endDate: "2026-12-24" });
    expect(dashboard.unbudgeted?.spent).toEqual(cop(100_000));
  });
```

7. Append to the end of the file:

```ts

describe("the unified view of a claimed guest place (HU-E1-11)", () => {
  it("includes Pedro's Hotel share recorded while he was a guest, and no share of Trip 2026's own Pedro (@critical)", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    const hotel = await post(recordExpense, h.ana, "expenses", {
      description: "Hotel",
      date: "2026-10-08",
      categoryId: h.groceries,
      amount: cop(300_000),
      payments: [{ memberId: pedro, accountId: null, amount: cop(300_000) }],
      split: { method: "EQUAL", participants: [h.ana.memberId, h.juan.memberId, pedro].map((memberId) => ({ memberId })) },
    });
    expect(hotel.status).toBe(201);
    const trip = await newSharedSpace(h.ana.personal, "Trip 2026");
    const inTrip = actingIn(h.ana.personal, trip);
    const tripPedro = await addGuest({ ...h, spaceId: trip }, "Pedro");
    const cabin = await post(recordExpense, inTrip, "expenses", {
      description: "Cabin",
      date: "2026-10-09",
      categoryId: await categoryWithKey(inTrip, "travel"),
      amount: cop(200_000),
      payments: [{ memberId: tripPedro, accountId: null, amount: cop(200_000) }],
      split: { method: "EQUAL", participants: [{ memberId: tripPedro }] },
    });
    expect(cabin.status).toBe(201);
    const link = await claimLink(h.ana, h.spaceId, pedro);
    const pedroUser = await registerUser("Pedro");
    const claimed = await call(acceptClaim, "POST", `/api/v1/claims/${link.token}/accept`, {
      user: pedroUser,
      params: { token: link.token },
    });
    expect(claimed.status).toBe(200);
    const view = await viewOf(pedroUser, "2026-10");
    expect(view.consumption.total).toEqual(cop(100_000));
    expect(view.cashOut).toMatchObject({ payments: cop(300_000), outsideTheApp: cop(300_000) });
  });
});
```

In `docs/backlog/E7-reporting.md`, insert after the line `- A row merged by catalog key takes its name from the viewer's personal space, or from the space where the row has the most spending when the personal space has none. Subcategories are never merged across spaces, because they carry no catalog key.`:

```markdown
- `GET /api/v1/me/unified-view?period=<label>` reads only the caller's own member rows: every row linked to them, current or former, a claimed guest place's history included, archived spaces too (M4 ruling P37). The label names a period of the caller's personal space (its stored period first, D10). `consumption.total` sums the caller's shares of live expenses dated in it; `consumption.categories` groups them by catalog `key` (seeded categories of every space together) or, for custom categories, by `space` and `category`, the largest first; a subcategory's consumption counts in its parent category (HU-E3-04), and each group carries a `name`: a merged group's is the one the caller's personal space gives its key, else the one in the space with the most consumption in it, ties by space name (rulings P76, P95). `cashOut` = `payments` (of live expenses) + `fundContributions` + `savingsTransfers` (live transfers into the caller's own SAVINGS accounts; a transfer into an INVESTMENT account is not cash out, M4 ruling P97), with `outsideTheApp`, the part paid without an account; settlements are not cash out. Amounts are in the personal space's currency; spaces in another currency are left out and listed in `otherCurrencySpaces` (D6). Errors: `ValidationFailed` and `InvalidPeriodLabel` (422).
```

In `docs/backlog/E1-identity-and-spaces.md`, replace the line `- The unified-view assertions become testable in M4 with HU-E7-04; until then the scenarios check the member's shares through the ledger.` with:

```markdown
- The unified-view assertions are pinned over HTTP by `tests/acceptance/unified-view.test.ts` since M4 (HU-E7-04).
```

- [ ] **Step 2: Run the tests**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/unified-view.test.ts tests/acceptance/guest-claims.test.ts`
Expected: PASS (Tasks 7 and 8b drove each behaviour red first; to see each test bite, invert one expectation, run, see it fail, restore it).

- [ ] **Step 3: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/acceptance/unified-view.test.ts docs/backlog/E7-reporting.md docs/backlog/E1-identity-and-spaces.md
git commit -m "test(reporting): pin the unified view's privacy, period placement and claimed guest history (Refs #59, Refs #20)"
```

---

### Task 10: Reporting domain — trend windows, changes and line continuity

Implements the pure rules behind HU-E7-05 (issue #60): a window of periods ending with a given one, each the previous period of the same policy (spec 5.3), not the calendar month; the change between two figures with a two-decimal percentage and the `NEW` status instead of a division by zero; and which line of each earlier plan a line continues (ruling P38).

**Files:**
- Create: `src/modules/reporting/domain/trend.ts`
- Create (test): `src/modules/reporting/domain/trend.test.ts`

**Interfaces:**
- Consumes: `resolvePeriod(policy, stored, date)`, `addDays`, `periodByLabel`, `LocalDate`, `Period`, `PeriodPolicy`, `StoredPeriod` (`@/shared/kernel`).
- Produces: `periodsEndingWith(policy, stored, end: Period, count): Period[]` (oldest first); `CHANGE_STATUSES`, `ChangeStatus` (`"NEW" | "INCREASED" | "DECREASED" | "UNCHANGED"`), `Change { amount: bigint | null; basisPoints: number | null; status }`, `changeFrom(previous: bigint | null, current: bigint): Change`; `TrendLine { id, originLineId, name }`, `tracedLines<L extends TrendLine>(plans: readonly (readonly L[] | null)[], line: L): (L | null)[]`.

- [ ] **Step 1: Write the failing tests**

`src/modules/reporting/domain/trend.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { periodByLabel, type LocalDate, type PeriodPolicy, type StoredPeriod } from "@/shared/kernel";
import { unwrap } from "../../../../tests/support/fakes";
import { changeFrom, periodsEndingWith, tracedLines } from "./trend";

const pesos = (n: number) => BigInt(n) * 100n;
const labels = (policy: PeriodPolicy, end: string, count: number) =>
  periodsEndingWith(policy, [], unwrap(periodByLabel(policy, [], end)), count).map((p) => p.label);

describe("trend windows (HU-E7-05, spec 5.3)", () => {
  it("ends with the given period and steps back through the previous periods of the policy, oldest first", () => {
    expect(labels({ kind: "MONTHLY", day: 1 }, "2026-11", 6)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(labels({ kind: "MONTHLY", day: 25 }, "2026-12", 2)).toEqual(["2026-11", "2026-12"]);
  });

  it("compares H2 with H1 of the same month and H1 with the previous month's H2", () => {
    expect(labels({ kind: "SEMI_MONTHLY", day1: 1, day2: 16 }, "2026-11 H2", 3)).toEqual([
      "2026-10 H2",
      "2026-11 H1",
      "2026-11 H2",
    ]);
  });

  it("follows a period's stored boundaries (D10)", () => {
    const policy: PeriodPolicy = { kind: "MONTHLY", day: 1 };
    const stored: StoredPeriod[] = [{ start: "2026-10-05" as LocalDate, end: "2026-11-04" as LocalDate, label: "2026-10" }];
    const end = unwrap(periodByLabel(policy, stored, "2026-11"));
    expect(periodsEndingWith(policy, stored, end, 2)).toEqual([
      { start: "2026-10-05", end: "2026-11-04", label: "2026-10" },
      { start: "2026-11-05", end: "2026-11-30", label: "2026-11" },
    ]);
  });
});

describe("period-over-period change (HU-E7-05)", () => {
  it("gives the change and its percentage with two decimals", () => {
    expect(changeFrom(pesos(1_350_000), pesos(1_300_000))).toEqual({
      amount: -pesos(50_000),
      basisPoints: -370,
      status: "DECREASED",
    });
    expect(changeFrom(pesos(400_000), pesos(500_000))).toEqual({
      amount: pesos(100_000),
      basisPoints: 2_500,
      status: "INCREASED",
    });
    expect(changeFrom(pesos(500_000), pesos(450_000))).toMatchObject({ basisPoints: -1_000 });
    expect(changeFrom(pesos(80_000), pesos(80_000))).toEqual({ amount: 0n, basisPoints: 0, status: "UNCHANGED" });
  });

  it("rounds half away from zero", () => {
    expect(changeFrom(3n, 1n).basisPoints).toBe(-6_667);
    expect(changeFrom(3n, 4n).basisPoints).toBe(3_333);
    expect(changeFrom(20_000n, 20_001n).basisPoints).toBe(1);
    expect(changeFrom(20_000n, 19_999n).basisPoints).toBe(-1);
  });

  it("is NEW without a previous figure or when the previous one is 0, with no change and no percentage", () => {
    expect(changeFrom(null, pesos(80_000))).toEqual({ amount: null, basisPoints: null, status: "NEW" });
    expect(changeFrom(0n, pesos(80_000))).toEqual({ amount: null, basisPoints: null, status: "NEW" });
  });
});

describe("line continuity (HU-E7-05, ruling P38)", () => {
  const line = (id: string, name: string, originLineId: string | null = null) => ({ id, name, originLineId });

  it("follows each line back through the line it was copied from, a renamed one included", () => {
    const home = line("home-12", "Home", "house-11");
    const plans = [[line("home-10", "Home")], [line("house-11", "House", "home-10")], [home]];
    expect(tracedLines(plans, home).map((l) => l?.id ?? null)).toEqual(["home-10", "house-11", "home-12"]);
  });

  it("falls back to the same name, case ignored, and across a period without a plan", () => {
    const home = line("home-12", "Home");
    const plans = [[line("home-09", "HOME")], null, [line("home-11", "home")], [home]];
    expect(tracedLines(plans, home).map((l) => l?.id ?? null)).toEqual(["home-09", null, "home-11", "home-12"]);
  });

  it("finds nothing for a line that exists only in the last plan", () => {
    const pets = line("pets-11", "Pets");
    expect(tracedLines([[line("home-10", "Home")], [pets]], pets).map((l) => l?.id ?? null)).toEqual([
      null,
      "pets-11",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/domain/trend.test.ts`
Expected: FAIL — `Cannot find module './trend'`.

- [ ] **Step 3: Implement**

`src/modules/reporting/domain/trend.ts`:

```ts
import { addDays, resolvePeriod, type Period, type PeriodPolicy, type StoredPeriod } from "@/shared/kernel";

/**
 * Spec 5.3: `count` periods ending with `end`, oldest first, each the previous period of the same policy (the
 * stored one covering the day before, else the policy's period around the stored ones, D10), never the calendar month.
 */
export const periodsEndingWith = (
  policy: PeriodPolicy,
  stored: readonly StoredPeriod[],
  end: Period,
  count: number,
): Period[] => {
  const periods = [end];
  while (periods.length < count) periods.unshift(resolvePeriod(policy, stored, addDays(periods[0]!.start, -1)));
  return periods;
};

/** HU-E7-05: how a figure moved from the previous period. */
export const CHANGE_STATUSES = ["NEW", "INCREASED", "DECREASED", "UNCHANGED"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export interface Change {
  /** current − previous; null when NEW. */
  readonly amount: bigint | null;
  /** The change over the previous figure in basis points (−3.70 % is −370), half away from zero; null when NEW. */
  readonly basisPoints: number | null;
  readonly status: ChangeStatus;
}

const magnitude = (n: bigint): bigint => (n < 0n ? -n : n);

/** HU-E7-05 (ruling P38): NEW without a previous figure or when it is 0 (never a division by zero). */
export const changeFrom = (previous: bigint | null, current: bigint): Change => {
  if (previous === null || previous === 0n) return { amount: null, basisPoints: null, status: "NEW" };
  const amount = current - previous;
  const base = magnitude(previous);
  const rounded = (2n * magnitude(amount) * 10_000n + base) / (2n * base);
  return {
    amount,
    basisPoints: Number(amount < 0n ? -rounded : rounded),
    status: amount > 0n ? "INCREASED" : amount < 0n ? "DECREASED" : "UNCHANGED",
  };
};

/** What a trend follows of a line: its id, the line it was copied from and its name. */
export interface TrendLine {
  readonly id: string;
  readonly originLineId: string | null;
  readonly name: string;
}

/**
 * HU-E7-05 (ruling P38): the line of each plan that `line` continues, aligned with `plans` (oldest first, null for a
 * period without a plan; the last is `line`'s own plan). Walking back, a line continues the one it was copied from
 * (the origin link that carry-overs follow, P15), else the one with its name, case ignored; after a period where it
 * has none, the name of `line` itself.
 */
export const tracedLines = <L extends TrendLine>(plans: readonly (readonly L[] | null)[], line: L): (L | null)[] => {
  const traced: (L | null)[] = plans.map(() => null);
  traced[plans.length - 1] = line;
  for (let i = plans.length - 2; i >= 0; i -= 1) {
    const lines = plans[i];
    if (!lines) continue;
    const later = traced[i + 1] ?? null;
    const byOrigin =
      later === null || later.originLineId === null ? undefined : lines.find((l) => l.id === later.originLineId);
    const name = (later ?? line).name.toLowerCase();
    traced[i] = byOrigin ?? lines.find((l) => l.name.toLowerCase() === name) ?? null;
  }
  return traced;
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/reporting/domain`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/reporting/domain/trend.ts src/modules/reporting/domain/trend.test.ts
git commit -m "feat(reporting): compare each period with the previous period of its policy (Refs #60)"
```

---

### Task 11: Reporting — GetLineTrend and GetPersonalTrend

Implements HU-E7-05 (issue #60) at the use-case level: each line of the end period's plan followed back through a window of periods of the space policy, with its spent amount and change per period, and the caller's consumption per personal period. Reuses `spaceReport`, `planViewIn` (Task 1) and `personalScope`, `consumptionTotal` (Task 8b), so every figure is the dashboard's and the unified view's (ruling P32).

**Files:**
- Create: `src/modules/reporting/application/get-line-trend.ts`, `src/modules/reporting/application/get-personal-trend.ts`
- Modify: `src/modules/reporting/application/index.ts`
- Create (test): `src/modules/reporting/application/trend.test.ts`

**Interfaces:**
- Consumes: `periodsEndingWith`, `changeFrom`, `tracedLines`, `Change`, `CHANGE_STATUSES` (Task 10); `spaceReport`, `planViewIn`, `reportPlanOf`, `ReportPlan`, `ReportingDeps` (Task 1); `personalScope`, `consumptionTotal`, `PersonalDeps` (Task 8b); `reportingWorld` (Tasks 1, 5); `personalWorld` (Task 8b); `aLine` (`tests/support/budget-fixtures.ts`).
- Produces: `TrendInput { spaceId, userId, endPeriod, periods }`, `TrendPoint { period, spent, change }`, `LineTrendSeries { lineId, name, points }`, `LineTrend { spaceId, currency, periods, plan, lines }`, `GetLineTrend`, `createGetLineTrend(deps: ReportingDeps)`; `PersonalTrendInput { userId, endPeriod, periods }`, `PersonalTrendPoint { period, consumption, change }`, `PersonalTrend { currency, periods, points }`, `GetPersonalTrend`, `createGetPersonalTrend(deps: PersonalDeps)`; the index re-exports `CHANGE_STATUSES`, `Change`, `ChangeStatus`.

- [ ] **Step 1: Write the failing tests**

`src/modules/reporting/application/trend.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BudgetLineId } from "@/modules/budgeting/application";
import type { PeriodPolicy } from "@/shared/kernel";
import { aLine } from "../../../../tests/support/budget-fixtures";
import { HOUSEHOLD } from "../../../../tests/support/budgeting-world";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { personalWorld } from "../../../../tests/support/personal-world";
import { reportingWorld } from "../../../../tests/support/reporting-world";
import { createGetLineTrend, type LineTrend } from "./get-line-trend";
import { createGetPersonalTrend } from "./get-personal-trend";

const pesos = (n: number) => BigInt(n) * 100n;
const capacities = [{ memberId: "member-ana", amount: pesos(4_000_000) }];

/**
 * Household with a chain of copied plans: Home in each `label`, mapped to Groceries, copied from the previous one,
 * and the Groceries spending of each period by its first day.
 */
const chain = async (policy: PeriodPolicy, spentFrom: readonly (readonly [string, string, number])[]) => {
  const w = reportingWorld({ periodPolicy: policy });
  let previous: { planId: string; lineId: string } | null = null;
  for (const [label, from, spent] of spentFrom) {
    const lineId = `line-home-${from}`;
    const plan = await w.plan(
      label,
      {
        capacities,
        lines: [aLine("Home", pesos(1_470_000), { id: lineId as BudgetLineId, originLineId: previous?.lineId ?? null })],
        mappings: [{ lineId, categoryId: "cat-groceries" }],
      },
      { createdFrom: previous?.planId },
    );
    w.spending.expenses[from] = [{ categoryId: "cat-groceries", amount: pesos(spent) }];
    previous = { planId: plan.id, lineId };
  }
  return w;
};
const trendOf = (w: Awaited<ReturnType<typeof chain>>, endPeriod: string, periods = 6, userId = "u-ana") =>
  createGetLineTrend(w.deps)({ spaceId: HOUSEHOLD, userId, endPeriod, periods });
const points = (trend: LineTrend, name: string) =>
  trend.lines
    .find((l) => l.name === name)!
    .points.map((p) => [p.period.label, p.spent, p.change?.amount ?? null, p.change?.basisPoints ?? null, p.change?.status ?? null]);

describe("line trend (HU-E7-05)", () => {
  it("gives Home's change versus the previous period: -50,000 COP (-3.70 %)", async () => {
    const w = await chain({ kind: "MONTHLY", day: 1 }, [
      ["2026-10", "2026-10-01", 1_350_000],
      ["2026-11", "2026-11-01", 1_300_000],
    ]);
    const trend = unwrap(await trendOf(w, "2026-11", 2));
    expect(trend.periods.map((p) => p.label)).toEqual(["2026-10", "2026-11"]);
    expect(points(trend, "Home")).toEqual([
      ["2026-10", pesos(1_350_000), null, null, "NEW"],
      ["2026-11", pesos(1_300_000), -pesos(50_000), -370, "DECREASED"],
    ]);
  });

  it("compares semi-monthly periods with the previous half-month", async () => {
    const w = await chain({ kind: "SEMI_MONTHLY", day1: 1, day2: 16 }, [
      ["2026-10 H2", "2026-10-16", 400_000],
      ["2026-11 H1", "2026-11-01", 500_000],
      ["2026-11 H2", "2026-11-16", 450_000],
    ]);
    expect(points(unwrap(await trendOf(w, "2026-11 H2", 2)), "Home")).toEqual([
      ["2026-11 H1", pesos(500_000), pesos(100_000), 2_500, "INCREASED"],
      ["2026-11 H2", pesos(450_000), -pesos(50_000), -1_000, "DECREASED"],
    ]);
  });

  it("marks Pets, a line only in the 2026-11 plan, NEW with no percentage, and earlier periods without a figure", async () => {
    const w = reportingWorld();
    const october = await w.plan("2026-10", {
      capacities,
      lines: [aLine("Home", pesos(1_470_000), { id: "line-home-oct" as BudgetLineId })],
    });
    await w.plan(
      "2026-11",
      {
        capacities,
        lines: [
          aLine("Home", pesos(1_470_000), { originLineId: "line-home-oct" }),
          aLine("Pets", pesos(100_000)),
        ],
        mappings: [{ lineId: "line-pets", categoryId: "cat-pets" }],
      },
      { createdFrom: october.id },
    );
    w.spending.expenses["2026-11-01"] = [{ categoryId: "cat-pets", amount: pesos(80_000) }];
    const trend = unwrap(await trendOf(w, "2026-11", 3));
    expect(points(trend, "Pets")).toEqual([
      ["2026-09", null, null, null, null],
      ["2026-10", null, null, null, null],
      ["2026-11", pesos(80_000), null, null, "NEW"],
    ]);
    expect(points(trend, "Home").map((p) => p[1])).toEqual([null, 0n, 0n]);
  });

  it("has no lines when the end period has no plan, and six periods by default", async () => {
    const w = reportingWorld();
    const trend = unwrap(await trendOf(w, "2026-11"));
    expect(trend).toMatchObject({ plan: null, lines: [] });
    expect(trend.periods.map((p) => p.label)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
  });

  it("hides the space from non-members and refuses an end period the policy does not name", async () => {
    const w = reportingWorld();
    expect(codeOf(await trendOf(w, "2026-11", 6, "u-marta"))).toBe("SpaceNotFound");
    expect(codeOf(await trendOf(w, "2026-11 H1"))).toBe("InvalidPeriodLabel");
  });
});

describe("personal trend (HU-E7-05)", () => {
  it("returns six personal consumption values from 2026-06 to 2026-11, each compared with the one before", async () => {
    const w = personalWorld();
    const byMonth: Record<string, number> = {
      "2026-05-01": 100_000,
      "2026-06-01": 200_000,
      "2026-07-01": 150_000,
      "2026-08-01": 150_000,
      "2026-09-01": 300_000,
      "2026-10-01": 270_000,
      "2026-11-01": 297_000,
    };
    for (const [from, amount] of Object.entries(byMonth)) {
      w.sums.consumption[from] = [{ spaceId: "space-ana", categoryId: "cat-ana-groceries", amount: pesos(amount) }];
    }
    const trend = unwrap(await createGetPersonalTrend(w.deps)({ userId: "u-ana", endPeriod: "2026-11", periods: 6 }));
    expect(trend.points.map((p) => [p.period.label, p.consumption, p.change.basisPoints, p.change.status])).toEqual([
      ["2026-06", pesos(200_000), 10_000, "INCREASED"],
      ["2026-07", pesos(150_000), -2_500, "DECREASED"],
      ["2026-08", pesos(150_000), 0, "UNCHANGED"],
      ["2026-09", pesos(300_000), 10_000, "INCREASED"],
      ["2026-10", pesos(270_000), -1_000, "DECREASED"],
      ["2026-11", pesos(297_000), 1_000, "INCREASED"],
    ]);
  });

  it("reports 0 for a personal period without consumption, and NEW after it", async () => {
    const w = personalWorld();
    w.sums.consumption["2026-11-01"] = [{ spaceId: "space-ana", categoryId: "cat-ana-groceries", amount: pesos(50_000) }];
    const trend = unwrap(await createGetPersonalTrend(w.deps)({ userId: "u-ana", endPeriod: "2026-11", periods: 2 }));
    expect(trend.points.map((p) => [p.period.label, p.consumption, p.change.status])).toEqual([
      ["2026-10", 0n, "NEW"],
      ["2026-11", pesos(50_000), "NEW"],
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/application/trend.test.ts`
Expected: FAIL — `Cannot find module './get-line-trend'` and `'./get-personal-trend'`.

- [ ] **Step 3: Implement**

`src/modules/reporting/application/get-line-trend.ts`:

```ts
import { ok, type Period, type Result } from "@/shared/kernel";
import { changeFrom, periodsEndingWith, tracedLines, type Change } from "../domain/trend";
import type { ReportingDeps } from "./deps";
import { planViewIn, reportPlanOf, spaceReport, type ReportPlan } from "./space-report";

/** A line's figure in one period of the window; null where it has none (no plan, or no line it continues). */
export interface TrendPoint {
  readonly period: Period;
  readonly spent: bigint | null;
  /** Versus the previous period of the policy; null where `spent` is null. */
  readonly change: Change | null;
}

export interface LineTrendSeries {
  readonly lineId: string;
  readonly name: string;
  /** Aligned with the trend's periods, oldest first. */
  readonly points: readonly TrendPoint[];
}

export interface LineTrend {
  readonly spaceId: string;
  readonly currency: string;
  /** `periods` periods of the space policy, oldest first, ending with the end period (spec 5.3). */
  readonly periods: readonly Period[];
  /** The end period's plan, whose lines the trend follows; null without one, and then no lines (ruling P38). */
  readonly plan: ReportPlan | null;
  readonly lines: readonly LineTrendSeries[];
}

export interface TrendInput {
  readonly spaceId: string;
  readonly userId: string;
  /** The end period's label in the space policy. */
  readonly endPeriod: string;
  /** How many periods the window shows (HU-E7-05: 6 by default, set by the contract). */
  readonly periods: number;
}

export type GetLineTrend = (input: TrendInput) => Promise<Result<LineTrend>>;

/**
 * HU-E7-05, spec 5.3: each line of the end period's plan followed back through the window by its origin link, else
 * its name (ruling P38), with what it spent in each period (`loadPlanView`, D7) and the change from the period before;
 * the window reads one period more than it shows, so the first period shown is compared too.
 */
export const createGetLineTrend =
  (deps: ReportingDeps): GetLineTrend =>
  async (input) => {
    const report = await spaceReport(deps, {
      spaceId: input.spaceId,
      userId: input.userId,
      period: input.endPeriod,
    });
    if (!report.ok) return report;
    const { space, period, view } = report.value;
    const stored = await deps.plans.storedPeriods(space.spaceId);
    const window = periodsEndingWith(space.periodPolicy, stored, period, input.periods + 1);
    const earlier = await Promise.all(window.slice(0, -1).map((p) => planViewIn(deps, space, p)));
    const plans = [...earlier, view].map((v) =>
      v === null
        ? null
        : v.figures.lines.map((f) => ({
            id: f.line.id,
            originLineId: f.line.originLineId,
            name: f.line.name,
            spent: f.spent,
          })),
    );
    const lines = (plans.at(-1) ?? []).map((line) => {
      const spent = tracedLines(plans, line).map((traced) => traced?.spent ?? null);
      return {
        lineId: line.id,
        name: line.name,
        points: window.slice(1).map((p, i) => {
          const current = spent[i + 1] ?? null;
          return { period: p, spent: current, change: current === null ? null : changeFrom(spent[i] ?? null, current) };
        }),
      };
    });
    return ok({
      spaceId: space.spaceId,
      currency: space.currency,
      periods: window.slice(1),
      plan: reportPlanOf(view),
      lines,
    });
  };
```

`src/modules/reporting/application/get-personal-trend.ts`:

```ts
import { ok, type Period, type Result } from "@/shared/kernel";
import { changeFrom, periodsEndingWith, type Change } from "../domain/trend";
import { consumptionTotal, personalScope, type PersonalDeps } from "./personal-scope";

export interface PersonalTrendPoint {
  readonly period: Period;
  /** The caller's consumption in the period, as the unified view totals it (HU-E7-04). */
  readonly consumption: bigint;
  readonly change: Change;
}

export interface PersonalTrend {
  readonly currency: string;
  /** The caller's personal periods, oldest first, ending with the end period. */
  readonly periods: readonly Period[];
  readonly points: readonly PersonalTrendPoint[];
}

export interface PersonalTrendInput {
  readonly userId: string;
  readonly endPeriod: string;
  readonly periods: number;
}

export type GetPersonalTrend = (input: PersonalTrendInput) => Promise<Result<PersonalTrend>>;

/**
 * HU-E7-05: the caller's consumption per period of their personal space's policy, each compared with the one before,
 * the first one shown included; only the caller's own member rows are read (HU-E7-04).
 */
export const createGetPersonalTrend =
  (deps: PersonalDeps): GetPersonalTrend =>
  async (input) => {
    const scope = await personalScope(deps, input.userId, input.endPeriod);
    if (!scope.ok) return scope;
    const { personal, period, stored } = scope.value;
    const window = periodsEndingWith(personal.periodPolicy, stored, period, input.periods + 1);
    const totals = await Promise.all(window.map((p) => consumptionTotal(deps, scope.value, p)));
    const shown = window.slice(1);
    return ok({
      currency: personal.currency,
      periods: shown,
      points: shown.map((p, i) => {
        const consumption = totals[i + 1] ?? 0n;
        return { period: p, consumption, change: changeFrom(totals[i] ?? null, consumption) };
      }),
    });
  };
```

In `src/modules/reporting/application/index.ts`, append to the end of the file:

```ts
export { CHANGE_STATUSES, type Change, type ChangeStatus } from "../domain/trend";
export {
  createGetLineTrend,
  type GetLineTrend,
  type LineTrend,
  type LineTrendSeries,
  type TrendInput,
  type TrendPoint,
} from "./get-line-trend";
export {
  createGetPersonalTrend,
  type GetPersonalTrend,
  type PersonalTrend,
  type PersonalTrendInput,
  type PersonalTrendPoint,
} from "./get-personal-trend";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/reporting`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/reporting/application
git commit -m "feat(reporting): follow each line and the caller's consumption period over period (Refs #60)"
```

---

### Task 12a: HTTP — the line trend

Implements HU-E7-05 (issue #60) over HTTP for a space: `GET /api/v1/spaces/{spaceId}/reports/trend?endPeriod=<label>&periods=<n>`. Adds the trend query (`periods` 1–24, default 6, ruling P38) and the signed two-decimal percentage the personal trend reuses (Task 12b). Pins the line change and the `NEW` line end to end.

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/reports/trend/route.ts`
- Modify: `src/modules/reporting/contracts/reporting.contract.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E7-reporting.md`, `tests/support/reporting.ts`
- Create (test): `tests/acceptance/reports-trend.test.ts`

**Interfaces:**
- Consumes: `createGetLineTrend`, `GetLineTrend`, `LineTrend`, `Change`, `CHANGE_STATUSES` (Task 11); `percentOf` (`@/shared/http/contracts`); `ReportPlanSchema`, `reportPlanDto`, `moneyOf`, `reportProblems`, `SpacePath` (Task 2a); `reportHousehold`, `spend`, `getWithQuery`, `ReportPeriodDto`, `ReportPlanDto` (Task 2a); `newPlan`, `setCapacities`, `addLine`, `lineNamed`, `putCategories` (`tests/support/budgeting.ts`); `categoryWithKey`, `cop`.
- Produces: `TrendQuerySchema`, `signedPercent(basisPoints)`, `changeDto(change, currency)`, `LineTrendSchema`, `lineTrendDto`; `Container.reporting.getLineTrend`; test support `getLineTrend(user, spaceId, query)`, `TrendPointDto`, `LineTrendDto`.

- [ ] **Step 1: Write the failing tests**

In `tests/support/reporting.ts`:

1. Insert after the line `import { GET as unifiedRoute } from "@/app/api/v1/me/unified-view/route";`:

```ts
import { GET as lineTrendRoute } from "@/app/api/v1/spaces/[spaceId]/reports/trend/route";
```

2. Append to the end of the file:

```ts

export interface TrendPointDto {
  period: string;
  spent: MoneyDto | null;
  change: MoneyDto | null;
  changePercent: string | null;
  changeStatus: string | null;
}
export interface LineTrendDto {
  spaceId: string;
  periods: ReportPeriodDto[];
  plan: ReportPlanDto | null;
  lines: { lineId: string; name: string; points: TrendPointDto[] }[];
}

/** HU-E7-05: `user` reads the line trend of `spaceId`. */
export const getLineTrend = (user: TestUser, spaceId: string, query: Record<string, string | number>) =>
  getWithQuery(lineTrendRoute, user, `/api/v1/spaces/${spaceId}/reports/trend`, query, { spaceId });
```

`tests/acceptance/reports-trend.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setContainerForTests, type Container } from "@/composition/container";
import { problemOf, registerUser, startTestApp } from "../support/app";
import { addLine, lineNamed, newPlan, putCategories, setCapacities } from "../support/budgeting";
import { categoryWithKey, cop } from "../support/ledger";
import { getLineTrend, reportHousehold, spend, type LineTrendDto } from "../support/reporting";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

describe("line trend over HTTP (HU-E7-05)", () => {
  it("gives Home's change versus 2026-10, -50,000 COP (-3.70 %), and Pets, new in 2026-11, the status NEW", async () => {
    const r = await reportHousehold();
    const { h, category } = r;
    // 2026-10 has its own Home (not a copy): the trend follows it by name (ruling P38).
    const october = await newPlan(h.ana, h.spaceId, "2026-10");
    await setCapacities(h.ana, h.spaceId, october.id, [[h.ana.memberId, 1_600_000]]);
    const withHome = await addLine(h.ana, h.spaceId, october.id, { name: "Home", pesos: 1_470_000 });
    const mapped = await putCategories(h.ana, h.spaceId, october.id, lineNamed(withHome, "Home").id, [
      category.groceries,
    ]);
    expect(mapped.status).toBe(200);
    // Pets joins 2026-11 with capacity to spare.
    await setCapacities(h.ana, h.spaceId, r.planId, [
      [h.ana.memberId, 1_700_000],
      [h.juan.memberId, 2_400_000],
    ]);
    const withPets = await addLine(h.ana, h.spaceId, r.planId, { name: "Pets", pesos: 100_000 });
    const maintenance = await categoryWithKey(h.ana, "maintenance");
    expect((await putCategories(h.ana, h.spaceId, r.planId, lineNamed(withPets, "Pets").id, [maintenance])).status).toBe(
      200,
    );
    await spend(h.ana, category.groceries, 1_350_000, "2026-10-10");
    await spend(h.ana, category.groceries, 900_000, "2026-11-05");
    await spend(h.juan, category.utilities, 400_000, "2026-11-10");
    await spend(h.ana, maintenance, 80_000, "2026-11-11");
    const response = await getLineTrend(h.ana, h.spaceId, { endPeriod: "2026-11", periods: 2 });
    expect(response.status).toBe(200);
    const trend = (await response.json()) as LineTrendDto;
    expect(trend.periods.map((p) => p.label)).toEqual(["2026-10", "2026-11"]);
    expect(trend.plan).toEqual({ id: r.planId, status: "DRAFT" });
    expect(trend.lines.find((l) => l.name === "Home")?.points).toEqual([
      { period: "2026-10", spent: cop(1_350_000), change: null, changePercent: null, changeStatus: "NEW" },
      { period: "2026-11", spent: cop(1_300_000), change: cop(-50_000), changePercent: "-3.70", changeStatus: "DECREASED" },
    ]);
    expect(trend.lines.find((l) => l.name === "Pets")?.points).toEqual([
      { period: "2026-10", spent: null, change: null, changePercent: null, changeStatus: null },
      { period: "2026-11", spent: cop(80_000), change: null, changePercent: null, changeStatus: "NEW" },
    ]);
  });

  it("shows six periods by default and refuses windows outside 1 to 24 periods", async () => {
    const { h } = await reportHousehold();
    const response = await getLineTrend(h.ana, h.spaceId, { endPeriod: "2026-11" });
    expect(((await response.json()) as LineTrendDto).periods.map((p) => p.label)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    for (const periods of [0, 25, "six"]) {
      expect(await problemOf(await getLineTrend(h.ana, h.spaceId, { endPeriod: "2026-11", periods }))).toEqual([
        422,
        "ValidationFailed",
      ]);
    }
    expect(await problemOf(await getLineTrend(h.ana, h.spaceId, { endPeriod: "2026-11 H2" }))).toEqual([
      422,
      "InvalidPeriodLabel",
    ]);
    const marta = await registerUser("Marta");
    expect(await problemOf(await getLineTrend(marta, h.spaceId, { endPeriod: "2026-11" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/reports-trend.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/v1/spaces/[spaceId]/reports/trend/route'`.

- [ ] **Step 3: Implement**

In `src/modules/reporting/contracts/reporting.contract.ts`:

1. Insert before the line `  PeriodSchema,`:

```ts
  percentOf,
```

2. Insert before the line `  type LineDashboard,`:

```ts
  CHANGE_STATUSES,
  type Change,
  type LineTrend,
```

3. Insert before the line `const SpacePath = z.object({ spaceId: z.string() });`:

```ts
/** HU-E7-05: the end period's label and how many periods to show, 6 by default (ruling P38). */
export const TrendQuerySchema = z.object({
  endPeriod: z.string().min(1).max(32),
  periods: z.coerce.number().int().min(1).max(24).default(6),
});

/** −370 basis points → "-3.70": signed, exactly two decimals. */
const signedPercent = (basisPoints: number | null): string | null =>
  basisPoints === null ? null : `${basisPoints < 0 ? "-" : ""}${percentOf(Math.abs(basisPoints))}`;

const changeDto = (change: Change | null, currency: string) => ({
  change: change === null || change.amount === null ? null : moneyOf(change.amount, currency),
  changePercent: signedPercent(change?.basisPoints ?? null),
});

/** HU-E7-05: each line of the end period's plan over the window, versus the previous period of the policy. */
export const LineTrendSchema = z.object({
  spaceId: z.string(),
  /** The window, oldest first, ending with `endPeriod`. */
  periods: z.array(PeriodSchema),
  plan: ReportPlanSchema,
  lines: z.array(
    z.object({
      lineId: z.string(),
      name: z.string(),
      /** One per period, in the order of `periods`. */
      points: z.array(
        z.object({
          /** The period's label. */
          period: z.string(),
          /** Null where the line has no figure (no plan, or no line it continues). */
          spent: MoneySchema.nullable(),
          change: MoneySchema.nullable(),
          /** Signed, two decimals ("-3.70"); null when NEW. */
          changePercent: z.string().nullable(),
          /** NEW without a previous figure or when it was 0; null where `spent` is null. */
          changeStatus: z.enum(CHANGE_STATUSES).nullable(),
        }),
      ),
    }),
  ),
});

export const lineTrendDto = (trend: LineTrend): z.infer<typeof LineTrendSchema> => ({
  spaceId: trend.spaceId,
  periods: trend.periods.map(periodDto),
  plan: reportPlanDto(trend.plan),
  lines: trend.lines.map((line) => ({
    lineId: line.lineId,
    name: line.name,
    points: line.points.map((p) => ({
      period: p.period.label,
      spent: p.spent === null ? null : moneyOf(p.spent, trend.currency),
      ...changeDto(p.change, trend.currency),
      changeStatus: p.change?.status ?? null,
    })),
  })),
});

```

4. Insert before the last line of the file (`};`, the end of `reportingPaths`):

```ts
  "/api/v1/spaces/{spaceId}/reports/trend": {
    get: {
      operationId: "getLineTrend",
      summary: "Spent per budget line over a window of periods, each versus the previous period of the space policy",
      description:
        "Follows the lines of the end period's plan back by their origin link, else their name. Percentages are signed with two decimals; without a previous figure, or when it was 0, the status is NEW and the change and percentage are null.",
      ...securedByUser,
      requestParams: { path: SpacePath, query: TrendQuerySchema },
      responses: {
        "200": {
          description: "The window, oldest first, and every line of the end period's plan",
          content: jsonContent(LineTrendSchema),
        },
        ...reportProblems,
      },
    },
  },
```

`src/app/api/v1/spaces/[spaceId]/reports/trend/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { lineTrendDto, TrendQuerySchema } from "@/modules/reporting/contracts/reporting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: TrendQuerySchema,
  handler: async ({ user, params, query }) => {
    const result = await getContainer().reporting.getLineTrend({
      spaceId: params.spaceId!,
      userId: user!.id,
      endPeriod: query.endPeriod,
      periods: query.periods,
    });
    return result.ok ? ok({ status: 200, body: lineTrendDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert before the line `  type GetLineDashboard,`:

```ts
  createGetLineTrend,
  type GetLineTrend,
```

2. Insert after the line `    readonly getUnifiedPersonalView: GetUnifiedPersonalView;`:

```ts
    readonly getLineTrend: GetLineTrend;
```

3. Insert after the line `      getUnifiedPersonalView: createGetUnifiedPersonalView(reportingDeps),`:

```ts
      getLineTrend: createGetLineTrend(reportingDeps),
```

In `docs/backlog/E7-reporting.md`, insert after the line `- Percent change with two decimals; division by zero returned as the status `NEW` with a null percentage; default window 6 periods. Charts are web UI (HU-E9-11).`:

```markdown
- `GET …/reports/trend?endPeriod=<label>&periods=<n>` is `space.read`; `periods` runs from 1 to 24, 6 by default (M4 ruling P38). `periods` lists the window oldest first, ending with `endPeriod`; each line of the end period's plan is followed back by its origin link, else its name (case ignored), and each of its points carries the period's label, `spent` (null where the line has no figure), `change`, `changePercent` (signed, two decimals, rounded half away from zero, "-3.70") and `changeStatus` (`NEW`, `INCREASED`, `DECREASED`, `UNCHANGED`; `NEW`, with change and percentage null, when the previous figure is missing or 0). The first period shown is compared with the one before it. Without a plan for `endPeriod`, `plan` is null and there are no lines; unbudgeted spending is not trended. Errors: `SpaceNotFound` (404), `ValidationFailed` and `InvalidPeriodLabel` (422).
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds only `GET /api/v1/spaces/{spaceId}/reports/trend` (about 220 lines; `periods` references the existing `Period` component); no component is added or changed.
Then run: `pnpm exec vitest run --project acceptance tests/acceptance/reports-trend.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/v1/spaces/[spaceId]/reports/trend/route.ts" src/modules/reporting/contracts/reporting.contract.ts src/composition/container.ts openapi/openapi.snapshot.json docs/backlog/E7-reporting.md tests/support/reporting.ts tests/acceptance/reports-trend.test.ts
git commit -m "feat(reporting): serve each line's period-over-period trend over HTTP (Refs #60)"
```

---

### Task 12b: HTTP — the personal trend

Implements HU-E7-05 (issue #60) over HTTP for the caller: `GET /api/v1/me/trend?endPeriod=<label>&periods=<n>`, the caller's consumption per personal period, reading only their own member rows like HU-E7-04. Pins the six-period series end to end.

**Files:**
- Create: `src/app/api/v1/me/trend/route.ts`
- Modify: `src/modules/reporting/contracts/reporting.contract.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E7-reporting.md`, `tests/support/reporting.ts`
- Create (test): `tests/acceptance/personal-trend.test.ts`

**Interfaces:**
- Consumes: `createGetPersonalTrend`, `GetPersonalTrend`, `PersonalTrend` (Task 11); `TrendQuerySchema`, `changeDto`, `CHANGE_STATUSES` (Task 12a); `moneyOf`, `periodDto`, `problems` (Task 2a); `getWithQuery`, `ReportPeriodDto` (Task 2a); `registerUser`, `problemOf`; `newAccount`, `categoryWithKey`, `post`, `cop`.
- Produces: `PersonalTrendSchema`, `personalTrendDto`; `Container.reporting.getPersonalTrend`; test support `getPersonalTrend(user, query)`, `PersonalTrendDto`.

- [ ] **Step 1: Write the failing tests**

In `tests/support/reporting.ts`:

1. Insert after the line `import { GET as lineTrendRoute } from "@/app/api/v1/spaces/[spaceId]/reports/trend/route";`:

```ts
import { GET as personalTrendRoute } from "@/app/api/v1/me/trend/route";
```

2. Append to the end of the file:

```ts

export interface PersonalTrendDto {
  currency: string;
  periods: ReportPeriodDto[];
  points: {
    period: string;
    consumption: MoneyDto;
    change: MoneyDto | null;
    changePercent: string | null;
    changeStatus: string;
  }[];
}

/** HU-E7-05: `user` reads their own consumption trend. */
export const getPersonalTrend = (user: TestUser, query: Record<string, string | number>) =>
  getWithQuery(personalTrendRoute, user, "/api/v1/me/trend", query);
```

`tests/acceptance/personal-trend.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { problemOf, registerUser, startTestApp } from "../support/app";
import { categoryWithKey, cop, newAccount, post } from "../support/ledger";
import { getPersonalTrend, type PersonalTrendDto } from "../support/reporting";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

describe("personal trend over HTTP (HU-E7-05)", () => {
  it("returns six consumption values from 2026-06 to 2026-11, each compared with the period before", async () => {
    const ana = await registerUser("Ana");
    const account = await newAccount(ana, "Bancolombia", 5_000_000);
    const groceries = await categoryWithKey(ana, "groceries");
    const spent: [string, number][] = [
      ["2026-05-20", 100_000],
      ["2026-06-03", 200_000],
      ["2026-07-03", 150_000],
      ["2026-08-03", 150_000],
      ["2026-09-30", 300_000],
      ["2026-10-01", 270_000],
      ["2026-11-30", 297_000],
    ];
    for (const [date, pesos] of spent) {
      const response = await post(recordExpense, ana, "expenses", {
        description: "Market",
        date,
        categoryId: groceries,
        amount: cop(pesos),
        accountId: account,
      });
      expect(response.status).toBe(201);
    }
    const response = await getPersonalTrend(ana, { endPeriod: "2026-11" });
    expect(response.status).toBe(200);
    const trend = (await response.json()) as PersonalTrendDto;
    expect(trend.periods.map((p) => p.label)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(trend.points.map((p) => [p.period, p.consumption, p.changePercent, p.changeStatus])).toEqual([
      ["2026-06", cop(200_000), "100.00", "INCREASED"],
      ["2026-07", cop(150_000), "-25.00", "DECREASED"],
      ["2026-08", cop(150_000), "0.00", "UNCHANGED"],
      ["2026-09", cop(300_000), "100.00", "INCREASED"],
      ["2026-10", cop(270_000), "-10.00", "DECREASED"],
      ["2026-11", cop(297_000), "10.00", "INCREASED"],
    ]);
  });

  it("refuses a missing end period, a window over 24 periods and a label the personal policy does not name", async () => {
    const ana = await registerUser("Ana");
    expect(await problemOf(await getPersonalTrend(ana, {}))).toEqual([422, "ValidationFailed"]);
    expect(await problemOf(await getPersonalTrend(ana, { endPeriod: "2026-11", periods: 25 }))).toEqual([
      422,
      "ValidationFailed",
    ]);
    expect(await problemOf(await getPersonalTrend(ana, { endPeriod: "2026-11 H1" }))).toEqual([
      422,
      "InvalidPeriodLabel",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/personal-trend.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/v1/me/trend/route'`.

- [ ] **Step 3: Implement**

In `src/modules/reporting/contracts/reporting.contract.ts`:

1. Insert before the line `  type LineDashboard,`:

```ts
  type PersonalTrend,
```

2. Insert before the line `const SpacePath = z.object({ spaceId: z.string() });`:

```ts
/** HU-E7-05: the caller's consumption per personal period (HU-E7-04), each versus the period before. */
export const PersonalTrendSchema = z.object({
  /** The personal space's currency. */
  currency: z.string(),
  /** The caller's personal periods, oldest first, ending with `endPeriod`. */
  periods: z.array(PeriodSchema),
  /** One per period, in the order of `periods`. */
  points: z.array(
    z.object({
      period: z.string(),
      consumption: MoneySchema,
      change: MoneySchema.nullable(),
      /** Signed, two decimals; null when NEW. */
      changePercent: z.string().nullable(),
      changeStatus: z.enum(CHANGE_STATUSES),
    }),
  ),
});

export const personalTrendDto = (trend: PersonalTrend): z.infer<typeof PersonalTrendSchema> => ({
  currency: trend.currency,
  periods: trend.periods.map(periodDto),
  points: trend.points.map((p) => ({
    period: p.period.label,
    consumption: moneyOf(p.consumption, trend.currency),
    ...changeDto(p.change, trend.currency),
    changeStatus: p.change.status,
  })),
});

```

3. Insert before the last line of the file (`};`, the end of `reportingPaths`):

```ts
  "/api/v1/me/trend": {
    get: {
      operationId: "getPersonalTrend",
      summary: "The caller's consumption per personal period over a window, each versus the period before",
      description:
        "Consumption as the unified view totals it, from the caller's own member rows only. Percentages are signed with two decimals; after a period without consumption the status is NEW.",
      ...securedByUser,
      requestParams: { query: TrendQuerySchema },
      responses: {
        "200": {
          description: "The caller's personal periods, oldest first, with their consumption",
          content: jsonContent(PersonalTrendSchema),
        },
        ...problems({ "401": "Unauthenticated", "422": "ValidationFailed, InvalidPeriodLabel" }),
      },
    },
  },
```

`src/app/api/v1/me/trend/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { personalTrendDto, TrendQuerySchema } from "@/modules/reporting/contracts/reporting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: TrendQuerySchema,
  handler: async ({ user, query }) => {
    const result = await getContainer().reporting.getPersonalTrend({
      userId: user!.id,
      endPeriod: query.endPeriod,
      periods: query.periods,
    });
    return result.ok ? ok({ status: 200, body: personalTrendDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert before the line `  type GetLineDashboard,`:

```ts
  createGetPersonalTrend,
  type GetPersonalTrend,
```

2. Insert after the line `    readonly getLineTrend: GetLineTrend;`:

```ts
    readonly getPersonalTrend: GetPersonalTrend;
```

3. Insert after the line `      getLineTrend: createGetLineTrend(reportingDeps),`:

```ts
      getPersonalTrend: createGetPersonalTrend(reportingDeps),
```

In `docs/backlog/E7-reporting.md`, insert after the line `- Percent change with two decimals; division by zero returned as the status `NEW` with a null percentage; default window 6 periods. Charts are web UI (HU-E9-11).`:

```markdown
- `GET /api/v1/me/trend?endPeriod=<label>&periods=<n>` gives the caller's `consumption` per period of their personal space's policy, as HU-E7-04 totals it from their own member rows only, with the window, query and change fields of the line trend below; a period without consumption counts 0, so the next one is `NEW`.
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds only `GET /api/v1/me/trend` (about 135 lines); no component is added or changed.
Then run: `pnpm exec vitest run --project acceptance tests/acceptance/personal-trend.test.ts tests/acceptance/reports-trend.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/me/trend/route.ts src/modules/reporting/contracts/reporting.contract.ts src/composition/container.ts openapi/openapi.snapshot.json docs/backlog/E7-reporting.md tests/support/reporting.ts tests/acceptance/personal-trend.test.ts
git commit -m "feat(reporting): serve the caller's consumption trend over HTTP (Refs #60)"
```

---

### Task 13: Categories — the category trees a report reads, in SQL

Gives HU-E7-06 (issue #113) its one new read side, computed on read (D7): the categories module lists the category trees of several spaces in one statement, every category and subcategory where it sits now with both catalog keys and its archived flags; reporting declares the matching `CategoryTrees` port and the roll-up rule that places spending in a tree (ruling P32). The sums themselves are not derived again (ruling P80): this task pins on PostgreSQL that the ledger's existing sums keep a subcategory's spending under its own id, so the report rolls it up and counts it once.

**Decisions:**
- The amounts come from the ports reporting already binds: a space's breakdown sums `PlanSpending.expensesByCategory` (M3-A: the amount of every live expense, whoever paid, the fund included), the personal one Task 7's `consumptionByCategory` through Task 8b's `personalScope` (the unified view's consumption). A single SQL statement over transactions and categories is not possible without the ledger importing the categories schema, which `modules-only-through-public-application-api` forbids (ruling P80).
- `treesOf` reads every space it is given in one statement: categories joined with the group they sit in now (HU-E3-02 records no move), deleted ones left out (D8), archived ones kept with their flags (HU-E3-03). Malformed ids answer `[]`, like every repository read from a request.
- `placeIn` applies HU-E3-04's `rollUp(categoryId) = parentCategoryId ?? categoryId`: spending in a subcategory counts in its parent category and in the parent's group. A subcategory whose parent the tree lacks counts as a category of its own (unreachable while ruling P48 keeps a parent with subcategories in use).
- The port's key in the composition root is `trees` (Task 15a), because the shared `reportingDeps` already holds `categories` (budgeting's `BudgetCategories`, which `loadPlanView` reads, Task 1) and `catalog` (Task 8b's `ReportCategories`, ruling P95).

**Files:**
- Create: `src/modules/reporting/domain/category-tree.ts`, `src/modules/reporting/application/category-trees.ts`
- Modify: `src/modules/reporting/application/index.ts`, `src/modules/categories/infrastructure/drizzle-category-repository.ts`, `src/modules/ledger/infrastructure/drizzle-report-sums.int.test.ts`
- Create (test): `tests/support/category-trees.ts`, `src/modules/reporting/domain/category-tree.test.ts`, `src/modules/categories/infrastructure/drizzle-category-trees.int.test.ts`

**Interfaces:**
- Consumes: `Category.parentCategoryId` and `categories.parentCategoryId` (M3-D Task 9a); `CategoryGroup.key` and the `category_groups.key` column that M3-D's Task 17a adds and back-fills in `0017_category_styles` (ruling P74 as amended); `Category.style` (M3-D Task 17a); `seedTree` (`src/modules/categories/domain/default-catalog.ts`); `DrizzleCategoryRepository.addGroups`, `addCategories`, `saveCategories`, `deleteCategory`, `listCategories`; `personalSpaceFixture`, `sharedLedgerFixture`, `SpaceFixture` (`tests/support/fixtures.ts`); `UuidV7IdGenerator`; the Task 4 test helpers `tm`, `pesos`, `nov1`, `nov30`, `base`, `expense`, `contribution`, `store`, `sorted`, `queries`; `DrizzleLedgerQueries.expensesByCategory` (M3-A) and `consumptionByCategory` (Task 7).
- Produces: `TreeCategory { spaceId, groupId, groupKey, groupName, groupArchived, categoryId, categoryKey, categoryName, categoryArchived, parentCategoryId }`, `TreePlace { category, subcategory }`, `treeById(nodes): Map<string, TreeCategory>`, `placeIn(tree, categoryId): TreePlace | null` (`domain/category-tree.ts`); `CategoryTrees { treesOf(spaceIds): Promise<readonly TreeCategory[]> }`; `TreeCategory`, `TreePlace` and `CategoryTrees` exported by `@/modules/reporting/application`; `DrizzleCategoryRepository.treesOf(spaceIds)`; test support `GroupSpec`, `node(group, id, name, options?)`, `spent(spaceId, categoryId, pesos)`, `HOUSING`, `FOOD`, `TRANSPORT`, `LEISURE`, `PETS`, `HOUSEHOLD_TREE`, `ANA_FOOD`, `ANA_TREE` in `tests/support/category-trees.ts`.

- [ ] **Step 1: Write the failing tests**

`tests/support/category-trees.ts`:

```ts
import type { TreeCategory } from "@/modules/reporting/application";

/** A group of a space as a tree holds it; seeded groups carry their catalog key (HU-E3-05). */
export interface GroupSpec {
  readonly spaceId: string;
  readonly id: string;
  readonly name: string;
  readonly key?: string | null;
  readonly archived?: boolean;
}

/** A category of `group`; `parent` makes it a subcategory (HU-E3-04), which never has a catalog key. */
export const node = (
  group: GroupSpec,
  id: string,
  name: string,
  options: { readonly key?: string; readonly parent?: string; readonly archived?: boolean } = {},
): TreeCategory => ({
  spaceId: group.spaceId,
  groupId: group.id,
  groupKey: group.key ?? null,
  groupName: group.name,
  groupArchived: group.archived ?? false,
  categoryId: id,
  categoryKey: options.key ?? null,
  categoryName: name,
  categoryArchived: options.archived ?? false,
  parentCategoryId: options.parent ?? null,
});

/** What was spent in one category of one space, as the ledger sums it per space and category. */
export const spent = (spaceId: string, categoryId: string, pesos: number) => ({
  spaceId,
  categoryId,
  amount: BigInt(pesos) * 100n,
});

const household = (id: string, name: string, key: string | null = null): GroupSpec => ({
  spaceId: "space-household",
  id,
  name,
  key,
});
export const HOUSING = household("grp-housing", "Housing", "housing");
export const FOOD = household("grp-food", "Food", "food");
export const TRANSPORT = household("grp-transport", "Transport", "transport");
export const LEISURE = household("grp-leisure", "Leisure", "leisure");
export const PETS = household("grp-pets", "Pets");

/**
 * HU-E7-06: Household's English seeded groups with the E7 fixture's categories (Groceries with Vegetables and Meat),
 * Fuel in Transport and the custom group Pets with Vet; the ids `reportingWorld` and `personalWorld` sum.
 */
export const HOUSEHOLD_TREE: readonly TreeCategory[] = [
  node(HOUSING, "cat-rent", "Rent", { key: "rent" }),
  node(HOUSING, "cat-utilities", "Utilities", { key: "utilities" }),
  node(FOOD, "cat-groceries", "Groceries", { key: "groceries" }),
  node(FOOD, "cat-vegetables", "Vegetables", { parent: "cat-groceries" }),
  node(FOOD, "cat-meat", "Meat", { parent: "cat-groceries" }),
  node(FOOD, "cat-restaurants", "Restaurants", { key: "restaurants" }),
  node(TRANSPORT, "cat-fuel", "Fuel", { key: "fuel" }),
  node(LEISURE, "cat-entertainment", "Entertainment", { key: "entertainment" }),
  node(PETS, "cat-vet", "Vet"),
];

export const ANA_FOOD: GroupSpec = { spaceId: "space-ana", id: "grp-ana-food", name: "Food", key: "food" };

/** Ana's personal space (`space-ana`): Food and Housing seeded, and her custom group Pets with Vet. */
export const ANA_TREE: readonly TreeCategory[] = [
  node(ANA_FOOD, "cat-ana-groceries", "Groceries", { key: "groceries" }),
  node(ANA_FOOD, "cat-ana-restaurants", "Restaurants", { key: "restaurants" }),
  node({ spaceId: "space-ana", id: "grp-ana-housing", name: "Housing", key: "housing" }, "cat-ana-rent", "Rent", {
    key: "rent",
  }),
  node({ spaceId: "space-ana", id: "grp-ana-pets", name: "Pets" }, "cat-ana-vet", "Vet"),
];
```

`src/modules/reporting/domain/category-tree.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HOUSEHOLD_TREE } from "../../../../tests/support/category-trees";
import { placeIn, treeById } from "./category-tree";

const tree = treeById(HOUSEHOLD_TREE);

describe("where spending counts in a category tree (HU-E3-04, HU-E7-06)", () => {
  it("places spending recorded in a category in that category, with no subcategory", () => {
    expect(placeIn(tree, "cat-groceries")).toEqual({ category: tree.get("cat-groceries"), subcategory: null });
  });

  it("rolls spending recorded in a subcategory up into its category, keeping the subcategory", () => {
    expect(placeIn(tree, "cat-vegetables")).toEqual({
      category: tree.get("cat-groceries"),
      subcategory: tree.get("cat-vegetables"),
    });
  });

  it("has no place for a category the tree does not hold", () => {
    expect(placeIn(tree, "cat-unknown")).toBeNull();
  });
});
```

`src/modules/categories/infrastructure/drizzle-category-trees.int.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import type { CategoryTrees } from "@/modules/reporting/application";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { testDatabase } from "../../../../tests/support/database";
import { personalSpaceFixture } from "../../../../tests/support/fixtures";
import type { Category, CategoryGroup } from "../domain/category";
import { seedTree } from "../domain/default-catalog";
import { DrizzleCategoryRepository } from "./drizzle-category-repository";

const { db, pool } = testDatabase();
const repo = new DrizzleCategoryRepository(new DrizzleTransactionManager(db));
// Reporting's port, implemented by the repository with its own types (ruling P32): this line is the type check.
const trees: CategoryTrees = repo;
const ids = new UuidV7IdGenerator();

afterAll(() => pool.end());

/** A fresh space with the seeded tree in `locale` (HU-E3-01), its groups keyed by the catalog (HU-E3-05). */
const seeded = async (locale: string) => {
  const { spaceId } = await personalSpaceFixture(db, pool);
  const tree = seedTree({ spaceId, locale, now: new Date("2026-10-16T12:00:00Z"), ids });
  await repo.addGroups(tree.groups);
  await repo.addCategories(tree.categories);
  return {
    spaceId,
    group: (key: string): CategoryGroup => tree.groups.find((g) => g.key === key)!,
    category: (key: string): Category => tree.categories.find((c) => c.key === key)!,
  };
};

describe("the category trees a report reads (HU-E7-06)", () => {
  it("lists every category and subcategory where it sits now, with both catalog keys, archived ones too", async () => {
    const s = await seeded("en");
    const groceries = s.category("groceries");
    const restaurants = s.category("restaurants");
    const leisure = s.group("leisure");
    const pets: CategoryGroup = { ...s.group("food"), id: ids.next<"CategoryGroup">(), name: "Pets", key: null };
    await repo.addGroups([pets]);
    // Copies of a stored row, so each has every column its level needs (HU-E3-05: a subcategory has no style).
    const vet: Category = { ...groceries, id: ids.next<"Category">(), groupId: pets.id, name: "Vet", key: null };
    const vegetables: Category = {
      ...groceries,
      id: ids.next<"Category">(),
      parentCategoryId: groceries.id,
      name: "Vegetables",
      key: null,
      style: null,
    };
    const gone: Category = { ...groceries, id: ids.next<"Category">(), name: "Gone", key: null };
    await repo.addCategories([vet, vegetables, gone]);
    await repo.deleteCategory(s.spaceId, gone.id, new Date());
    // HU-E3-02: a moved category sits in its new group; HU-E3-03: an archived one is still listed.
    await repo.saveCategories([{ ...restaurants, groupId: leisure.id, archivedAt: new Date() }]);
    const rows = await trees.treesOf([s.spaceId]);
    // The 13 seeded categories, Vet and Vegetables; the deleted one is left out (D8).
    expect(rows).toHaveLength(15);
    expect(rows.find((r) => r.categoryId === restaurants.id)).toEqual({
      spaceId: s.spaceId,
      groupId: leisure.id,
      groupKey: "leisure",
      groupName: "Leisure",
      groupArchived: false,
      categoryId: restaurants.id,
      categoryKey: "restaurants",
      categoryName: "Restaurants",
      categoryArchived: true,
      parentCategoryId: null,
    });
    expect(rows.find((r) => r.categoryId === vegetables.id)).toMatchObject({
      groupKey: "food",
      categoryKey: null,
      parentCategoryId: groceries.id,
    });
    expect(rows.find((r) => r.categoryId === vet.id)).toMatchObject({ groupId: pets.id, groupKey: null, groupName: "Pets" });
    expect(rows.some((r) => r.categoryId === gone.id)).toBe(false);
    expect([...new Set(rows.flatMap((r) => (r.groupKey === null ? [] : [r.groupKey])))].sort()).toEqual([
      "food",
      "health",
      "housing",
      "income",
      "leisure",
      "transport",
    ]);
  });

  it("answers only the spaces asked for, several in one statement, by space and then category", async () => {
    const en = await seeded("en");
    const es = await seeded("es");
    const other = await seeded("en");
    const rows = await trees.treesOf([es.spaceId, en.spaceId, "not-a-uuid"]);
    expect(rows).toHaveLength(26);
    expect(rows.some((r) => r.spaceId === other.spaceId)).toBe(false);
    expect(rows.find((r) => r.categoryId === es.category("groceries").id)).toMatchObject({
      groupKey: "food",
      groupName: "Alimentación",
      categoryKey: "groceries",
      categoryName: "Mercado",
    });
    const order = rows.map((r) => `${r.spaceId}/${r.categoryId}`);
    expect(order).toEqual([...order].sort());
    expect(await trees.treesOf(["not-a-uuid"])).toEqual([]);
    expect(await trees.treesOf([])).toEqual([]);
  });
});
```

In `src/modules/ledger/infrastructure/drizzle-report-sums.int.test.ts`:

1. Insert after the line `import { afterAll, describe, expect, it } from "vitest";`:

```ts
import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";
```

2. Append to the end of the file:

```ts

/** A subcategory of `parentId` (HU-E3-04), copied from the parent as stored so it has every column its level needs. */
const subcategoryOf = async (space: SpaceFixture, parentId: string, name: string): Promise<string> => {
  const categories = new DrizzleCategoryRepository(tm);
  const parent = (await categories.listCategories(space.spaceId)).find((c) => c.id === parentId)!;
  const id = randomUUID() as typeof parent.id;
  await categories.addCategories([{ ...parent, id, parentCategoryId: parent.id, name, key: null, style: null }]);
  return id;
};

describe("spending in a subcategory, for the breakdown by group (HU-E7-06)", () => {
  it("keeps a subcategory's expenses under its own id, as amounts for the space and as shares for its members", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const ana = w.household.memberId;
    const byAna = { memberId: ana, accountId: w.bank };
    const vegetables = await subcategoryOf(w.household, w.groceries, "Vegetables");
    await store(
      expense(w.household, w.groceries, "2026-11-05", pesos(85_000n), byAna, [ana]),
      expense(w.household, vegetables, "2026-11-06", pesos(40_000n), byAna, [ana, w.pedro]),
      // A fund contribution and a transfer are no spending: neither sum counts them.
      contribution(w.household, w.fund, "2026-11-01", pesos(480_000n), ana, w.bank),
      unwrap(
        recordTransfer({
          ...base(w.household, pesos(200_000n), "2026-11-05"),
          sourceAccountId: w.bank,
          destinationAccountId: w.fund,
        }),
      ),
    );
    const household = w.household.spaceId;
    expect(await queries.expensesByCategory(household, nov1, nov30)).toEqual(
      sorted(
        [
          { categoryId: w.groceries, amount: pesos(85_000n) },
          { categoryId: vegetables, amount: pesos(40_000n) },
        ],
        (row) => row.categoryId,
      ),
    );
    expect(await queries.consumptionByCategory([ana], nov1, nov30)).toEqual(
      sorted(
        [
          { spaceId: household, categoryId: w.groceries, amount: pesos(85_000n) },
          { spaceId: household, categoryId: vegetables, amount: pesos(20_000n) },
        ],
        (row) => row.categoryId,
      ),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/domain/category-tree.test.ts`
Expected: FAIL — `Cannot find module './category-tree'`.

Run: `pnpm exec vitest run --project integration src/modules/categories/infrastructure/drizzle-category-trees.int.test.ts src/modules/ledger/infrastructure/drizzle-report-sums.int.test.ts`
Expected: FAIL — `trees.treesOf is not a function` in both tree tests. The new ledger test already passes: it pins that the ledger leaves the roll-up to its readers (M3-D Task 10 rolls up inside budgeting, not in SQL), which Task 14a relies on; to see it bite, change `pesos(20_000n)` to `pesos(40_000n)`, run, see it fail, restore it.

- [ ] **Step 3: Implement**

`src/modules/reporting/domain/category-tree.ts`:

```ts
/**
 * HU-E7-06: one category or subcategory of a space where it sits now (HU-E3-02: nothing records a move), archived
 * ones included (HU-E3-03), with the catalog key of its group (HU-E3-05) and its own (D11).
 */
export interface TreeCategory {
  readonly spaceId: string;
  readonly groupId: string;
  /** The seeded group's catalog key; null for groups users create and those the back-fill left without one. */
  readonly groupKey: string | null;
  readonly groupName: string;
  readonly groupArchived: boolean;
  readonly categoryId: string;
  /** The seeded category's catalog key; null for categories users create and for every subcategory. */
  readonly categoryKey: string | null;
  readonly categoryName: string;
  readonly categoryArchived: boolean;
  /** HU-E3-04: the category a subcategory belongs to; null for a category directly in its group. */
  readonly parentCategoryId: string | null;
}

/** Where spending recorded in one category counts: its category, and the subcategory it was recorded in, if any. */
export interface TreePlace {
  readonly category: TreeCategory;
  readonly subcategory: TreeCategory | null;
}

/** The nodes of one or more trees by category id, as `placeIn` reads them. */
export const treeById = (nodes: readonly TreeCategory[]): Map<string, TreeCategory> =>
  new Map(nodes.map((node) => [node.categoryId, node]));

/**
 * HU-E3-04: rollUp(categoryId) = parentCategoryId ?? categoryId, so spending in a subcategory counts in its category
 * and in that category's group (spec 5.4); null for a category the tree does not hold.
 */
export const placeIn = (tree: ReadonlyMap<string, TreeCategory>, categoryId: string): TreePlace | null => {
  const node = tree.get(categoryId);
  if (node === undefined) return null;
  // A subcategory whose parent the tree lacks counts as a category of its own (ruling P48 keeps such a parent).
  const parent = node.parentCategoryId === null ? undefined : tree.get(node.parentCategoryId);
  return parent === undefined ? { category: node, subcategory: null } : { category: parent, subcategory: node };
};
```

`src/modules/reporting/application/category-trees.ts`:

```ts
import type { TreeCategory } from "../domain/category-tree";

/** HU-E7-06: the category trees of spaces as they stand now; the composition root binds the categories module. */
export interface CategoryTrees {
  /**
   * Every category and subcategory of `spaceIds` that is not deleted (D8), archived ones included (HU-E3-03), with
   * the group it sits in now and both catalog keys; `[]` without well-formed ids.
   */
  treesOf(spaceIds: readonly string[]): Promise<readonly TreeCategory[]>;
}
```

In `src/modules/reporting/application/index.ts`, append to the end of the file:

```ts
export type { TreeCategory, TreePlace } from "../domain/category-tree";
export type { CategoryTrees } from "./category-trees";
```

In `src/modules/categories/infrastructure/drizzle-category-repository.ts` (the file as M3-D's Task 17a writes it):

1. Replace the line `import { and, eq, isNull, sql } from "drizzle-orm";` (M3-D's `lockTree` already imports `sql`) with:

```ts
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
```

2. Insert after the line `import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";`:

```ts
import { isUuid } from "@/shared/kernel";
```

3. Insert before the line `  async saveGroup(group: CategoryGroup): Promise<void> {`:

```ts
  /**
   * HU-E7-06: the categories and subcategories of `spaceIds` not deleted (D8; archived ones included, HU-E3-03), each
   * with the group it sits in now and both catalog keys, in one statement; sorted by space, then category; `[]`
   * without well-formed ids (these come from ledger rows, not from a resolved membership).
   */
  async treesOf(spaceIds: readonly string[]): Promise<
    {
      spaceId: string;
      groupId: string;
      groupKey: string | null;
      groupName: string;
      groupArchived: boolean;
      categoryId: string;
      categoryKey: string | null;
      categoryName: string;
      categoryArchived: boolean;
      parentCategoryId: string | null;
    }[]
  > {
    const ids = spaceIds.filter(isUuid);
    if (ids.length === 0) return [];
    const rows = await this.tm
      .executor()
      .select({
        spaceId: categories.spaceId,
        groupId: categoryGroups.id,
        groupKey: categoryGroups.key,
        groupName: categoryGroups.name,
        groupArchivedAt: categoryGroups.archivedAt,
        categoryId: categories.id,
        categoryKey: categories.key,
        categoryName: categories.name,
        categoryArchivedAt: categories.archivedAt,
        parentCategoryId: categories.parentCategoryId,
      })
      .from(categories)
      .innerJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
      .where(and(inArray(categories.spaceId, ids), isNull(categories.deletedAt)))
      .orderBy(asc(categories.spaceId), asc(categories.id));
    return rows.map(({ groupArchivedAt, categoryArchivedAt, ...row }) => ({
      ...row,
      groupArchived: groupArchivedAt !== null,
      categoryArchived: categoryArchivedAt !== null,
    }));
  }

```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/reporting/domain && pnpm exec vitest run --project integration src/modules/categories/infrastructure src/modules/ledger/infrastructure`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0; `pnpm lint:boundaries` accepts that the categories module never imports reporting (only its test file names the port).

- [ ] **Step 6: Commit**

```bash
git add src/modules/reporting/domain/category-tree.ts src/modules/reporting/domain/category-tree.test.ts src/modules/reporting/application/category-trees.ts src/modules/reporting/application/index.ts src/modules/categories/infrastructure/drizzle-category-repository.ts src/modules/categories/infrastructure/drizzle-category-trees.int.test.ts src/modules/ledger/infrastructure/drizzle-report-sums.int.test.ts tests/support/category-trees.ts
git commit -m "feat(categories): read the category trees of several spaces for reports (Refs #113)"
```

---

### Task 14a: Reporting domain — spending by group, category and subcategory

Implements the pure rules of HU-E7-06 (issue #113): spending placed by `placeIn` (Task 13) and summed per group, category and subcategory of the current tree, each node's share of its parent rounded half up on its own level, every level largest first, and, for the personal breakdown, seeded rows merged across spaces by catalog key and named by ruling P76 (rulings P75–P77, P81).

**Decisions:**
- One fold serves both breakdowns. `SPACE` keeps every node apart (each has its `id`); `PERSONAL` merges a group with a catalog key into one row per key, and inside a group row a category with a key into one row per key; such a row has `id` and `space` null. Rows without a key (custom groups and categories) and every subcategory keep their `id` and their `space` (ruling P76).
- A merged row is named as the caller's personal space names that key, whenever the personal space's tree holds it, with or without spending there; otherwise as the space with the most spending in the row, ties by space name, then id. It is `archived` only when it is archived in every space that spends in it (ruling P81).
- The spending recorded in a category itself is one entry with `subcategoryId` and `name` null, listed only beside a subcategory with spending; under a merged category it sums that spending of every space (ruling P81).
- `share` is basis points of the parent's total, rounded half up (amounts are never negative), so siblings may add up to 99.99 or 100.01 % (ruling P75); `total` is the sum of the groups listed. A row whose category the tree does not hold, and a row of 0, are left out: nodes without spending are not listed.
- Order at every level: total descending; then the entry without a subcategory last; then name ascending with `localeCompare(…, "es", { sensitivity: "accent" })` (case ignored, accents not, as `ListCategories` sorts names in Spanish); then space name; then id (ruling P82).

**Files:**
- Create: `src/modules/reporting/domain/spending-by-group.ts`
- Create (test): `src/modules/reporting/domain/spending-by-group.test.ts`

**Interfaces:**
- Consumes: `TreeCategory`, `treeById`, `placeIn` (Task 13); `CategoryConsumption` (Task 8a); `ANA_FOOD`, `ANA_TREE`, `HOUSEHOLD_TREE`, `LEISURE`, `node`, `spent` (`tests/support/category-trees.ts`, Task 13).
- Produces: `SpaceRef { id, name }`, `SubcategorySpending { subcategoryId, name, archived, space, total, share }`, `CategorySpending { id, key, name, archived, space, total, share, subcategories }`, `GroupSpending { id, key, name, archived, space, total, share, categories }`, `SpendingTree { total, groups }`, `Grouping` (`{ kind: "SPACE" }` or `{ kind: "PERSONAL", personalSpaceId, spaceNames }`), `shareOf(part, whole): number`, `spendingTree(rows, nodes, grouping): SpendingTree`.

- [ ] **Step 1: Write the failing tests**

`src/modules/reporting/domain/spending-by-group.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ANA_FOOD, ANA_TREE, HOUSEHOLD_TREE, LEISURE, node, spent } from "../../../../tests/support/category-trees";
import { shareOf, spendingTree, type Grouping } from "./spending-by-group";

const pesos = (n: number) => BigInt(n) * 100n;
const inHousehold = (categoryId: string, amount: number) => spent("space-household", categoryId, amount);
const atHome = (categoryId: string, amount: number) => spent("space-ana", categoryId, amount);
const SPACE: Grouping = { kind: "SPACE" };
const PERSONAL: Grouping = {
  kind: "PERSONAL",
  personalSpaceId: "space-ana",
  spaceNames: new Map([
    ["space-ana", "Personal"],
    ["space-household", "Household"],
    ["space-trip", "Trip"],
  ]),
};

/** HU-E7-01 Background: Household's November 2026 by category, as the ledger sums it. */
const november = () => [
  inHousehold("cat-rent", 1_200_000),
  inHousehold("cat-groceries", 900_000),
  inHousehold("cat-utilities", 400_000),
  inHousehold("cat-entertainment", 250_000),
  inHousehold("cat-restaurants", 60_000),
];
const figures = (nodes: readonly { name: string | null; total: bigint; share: number }[]) =>
  nodes.map((n) => [n.name, n.total, n.share]);
/** Household's tree after Ana moved Restaurants from Food to Leisure (HU-E3-02). */
const moved = HOUSEHOLD_TREE.map((n) =>
  n.categoryId === "cat-restaurants" ? node(LEISURE, "cat-restaurants", "Restaurants", { key: "restaurants" }) : n,
);

describe("spending by category group (HU-E7-06)", () => {
  it("totals a space's spending by group, the largest first, each a share of the period's total (@critical)", () => {
    const tree = spendingTree(november(), HOUSEHOLD_TREE, SPACE);
    expect(tree.total).toBe(pesos(2_810_000));
    // Transport and Pets have no spending, so they are not listed.
    expect(tree.groups.map((g) => [g.id, g.key, g.name, g.space, g.total, g.share])).toEqual([
      ["grp-housing", "housing", "Housing", null, pesos(1_600_000), 5_694],
      ["grp-food", "food", "Food", null, pesos(960_000), 3_416],
      ["grp-leisure", "leisure", "Leisure", null, pesos(250_000), 890],
    ]);
  });

  it("drills down from Food to its categories and from Groceries to its subcategories", () => {
    const spending = [
      ...november().filter((row) => row.categoryId !== "cat-groceries"),
      inHousehold("cat-groceries", 450_000),
      inHousehold("cat-vegetables", 270_000),
      inHousehold("cat-meat", 180_000),
    ];
    const food = spendingTree(spending, HOUSEHOLD_TREE, SPACE).groups.find((g) => g.key === "food")!;
    expect(figures(food.categories)).toEqual([
      ["Groceries", pesos(900_000), 9_375],
      ["Restaurants", pesos(60_000), 625],
    ]);
    expect(food.categories[0]!.subcategories.map((s) => [s.subcategoryId, s.name, s.total, s.share])).toEqual([
      [null, null, pesos(450_000), 5_000],
      ["cat-vegetables", "Vegetables", pesos(270_000), 3_000],
      ["cat-meat", "Meat", pesos(180_000), 2_000],
    ]);
    // Restaurants has no subcategory with spending, so it lists none.
    expect(food.categories[1]!.subcategories).toEqual([]);
  });

  it("counts an expense in a subcategory once, in its category and in its group", () => {
    const spending = [
      inHousehold("cat-groceries", 85_000),
      inHousehold("cat-vegetables", 40_000),
      inHousehold("cat-restaurants", 60_000),
    ];
    const tree = spendingTree(spending, HOUSEHOLD_TREE, SPACE);
    expect(tree.total).toBe(pesos(185_000));
    expect(figures(tree.groups)).toEqual([["Food", pesos(185_000), 10_000]]);
    const groceries = tree.groups[0]!.categories[0]!;
    expect([groceries.name, groceries.total]).toEqual(["Groceries", pesos(125_000)]);
    expect(groceries.subcategories.map((s) => [s.name, s.total])).toEqual([
      [null, pesos(85_000)],
      ["Vegetables", pesos(40_000)],
    ]);
  });

  it("reads the tree as it is now, so a moved category counts under its new group in every period", () => {
    expect(figures(spendingTree(november(), moved, SPACE).groups)).toEqual([
      ["Housing", pesos(1_600_000), 5_694],
      ["Food", pesos(900_000), 3_203],
      ["Leisure", pesos(310_000), 1_103],
    ]);
    const october = spendingTree([inHousehold("cat-restaurants", 30_000)], moved, SPACE);
    expect(october.groups.map((g) => [g.key, g.categories.map((c) => c.key)])).toEqual([["leisure", ["restaurants"]]]);
  });

  it("orders equal totals by name ignoring case, the spending without a subcategory last, and flags archived nodes", () => {
    const auto = { spaceId: "space-household", id: "grp-auto", name: "Auto" };
    const bills = { spaceId: "space-household", id: "grp-bills", name: "bills", archived: true };
    const nodes = [...HOUSEHOLD_TREE, node(auto, "cat-car", "Car"), node(bills, "cat-water", "water", { archived: true })];
    const spending = [
      inHousehold("cat-water", 20_000),
      inHousehold("cat-car", 20_000),
      inHousehold("cat-groceries", 10_000),
      inHousehold("cat-meat", 10_000),
    ];
    const tree = spendingTree(spending, nodes, SPACE);
    expect(tree.groups.map((g) => [g.name, g.archived])).toEqual([
      ["Auto", false],
      ["bills", true],
      ["Food", false],
    ]);
    expect(tree.groups[1]!.categories[0]).toMatchObject({ name: "water", archived: true });
    expect(tree.groups[2]!.categories[0]!.subcategories.map((s) => s.name)).toEqual(["Meat", null]);
  });

  it("answers 0 and no groups without spending, and leaves out what the tree does not hold", () => {
    expect(spendingTree([], HOUSEHOLD_TREE, SPACE)).toEqual({ total: 0n, groups: [] });
    expect(spendingTree([inHousehold("cat-unknown", 5_000)], HOUSEHOLD_TREE, SPACE)).toEqual({ total: 0n, groups: [] });
  });

  it("rounds each share half up on its own level, so siblings may add up to 99.99 or 100.01", () => {
    expect([shareOf(1n, 3n), shareOf(1n, 3n), shareOf(1n, 3n)]).toEqual([3_333, 3_333, 3_333]);
    expect([shareOf(1n, 6n), shareOf(1n, 6n), shareOf(4n, 6n)]).toEqual([1_667, 1_667, 6_667]);
    expect(shareOf(1n, 20_000n)).toBe(1);
    expect(shareOf(1n, 20_001n)).toBe(0);
    expect(shareOf(0n, 0n)).toBe(0);
  });

  it("merges seeded groups and categories across spaces by catalog key and keeps each custom group with its space (@critical)", () => {
    // HU-E7-04 Background as Ana's shares, her 40,000 COP Vet at home and her 25,000 COP share of Household's Vet.
    const spending = [
      atHome("cat-ana-groceries", 85_000),
      atHome("cat-ana-restaurants", 60_000),
      inHousehold("cat-groceries", 950_000),
      inHousehold("cat-rent", 480_000),
      atHome("cat-ana-vet", 40_000),
      inHousehold("cat-vet", 25_000),
    ];
    const tree = spendingTree(spending, [...ANA_TREE, ...HOUSEHOLD_TREE], PERSONAL);
    expect(tree.total).toBe(pesos(1_640_000));
    expect(tree.groups.map((g) => [g.name, g.key, g.id, g.space, g.total, g.share])).toEqual([
      ["Food", "food", null, null, pesos(1_095_000), 6_677],
      ["Housing", "housing", null, null, pesos(480_000), 2_927],
      ["Pets", null, "grp-ana-pets", { id: "space-ana", name: "Personal" }, pesos(40_000), 244],
      ["Pets", null, "grp-pets", { id: "space-household", name: "Household" }, pesos(25_000), 152],
    ]);
    expect(tree.groups[0]!.categories.map((c) => [c.key, c.id, c.space, c.total])).toEqual([
      ["groceries", null, null, pesos(1_035_000)],
      ["restaurants", null, null, pesos(60_000)],
    ]);
  });

  it("names a merged row as the personal space does, even without spending there, else as the space spending most", () => {
    // Household renamed its seeded Food and Housing; only Household and Trip hold Leisure.
    const household = HOUSEHOLD_TREE.map((n) =>
      n.groupKey === "food" ? { ...n, groupName: "Comida" } : n.groupKey === "housing" ? { ...n, groupName: "Vivienda" } : n,
    );
    const trip = { spaceId: "space-trip", id: "grp-trip-leisure", name: "Ocio", key: "leisure" };
    const nodes = [...ANA_TREE, ...household, node(trip, "cat-trip-fun", "Entretenimiento", { key: "entertainment" })];
    const spending = [
      inHousehold("cat-groceries", 900_000),
      atHome("cat-ana-groceries", 10_000),
      inHousehold("cat-rent", 100_000),
      inHousehold("cat-entertainment", 30_000),
      spent("space-trip", "cat-trip-fun", 50_000),
    ];
    const tree = spendingTree(spending, nodes, PERSONAL);
    expect(tree.groups.map((g) => [g.key, g.name, g.total])).toEqual([
      ["food", "Food", pesos(910_000)],
      ["housing", "Housing", pesos(100_000)],
      ["leisure", "Ocio", pesos(80_000)],
    ]);
    expect(tree.groups[2]!.categories.map((c) => [c.key, c.name])).toEqual([["entertainment", "Entretenimiento"]]);
  });

  it("lists subcategories per space under a merged category, and a seeded category under each group its spaces chose", () => {
    const verduras = node(ANA_FOOD, "cat-ana-verduras", "Verduras", { parent: "cat-ana-groceries" });
    const spending = [
      atHome("cat-ana-groceries", 50_000),
      inHousehold("cat-groceries", 10_000),
      inHousehold("cat-vegetables", 30_000),
      atHome("cat-ana-verduras", 20_000),
      atHome("cat-ana-restaurants", 60_000),
      inHousehold("cat-restaurants", 40_000),
    ];
    const tree = spendingTree(spending, [...ANA_TREE, verduras, ...moved], PERSONAL);
    const food = tree.groups.find((g) => g.key === "food")!;
    expect(food.categories.map((c) => [c.key, c.total])).toEqual([
      ["groceries", pesos(110_000)],
      ["restaurants", pesos(60_000)],
    ]);
    // The spending in Groceries itself merges; each space's subcategory keeps its space.
    expect(food.categories[0]!.subcategories.map((s) => [s.name, s.space?.name ?? null, s.total, s.share])).toEqual([
      [null, null, pesos(60_000), 5_455],
      ["Vegetables", "Household", pesos(30_000), 2_727],
      ["Verduras", "Personal", pesos(20_000), 1_818],
    ]);
    // Household moved Restaurants to Leisure, so its 40,000 COP sits there, apart from Ana's in Food.
    expect(tree.groups.find((g) => g.key === "leisure")!.categories.map((c) => [c.key, c.total])).toEqual([
      ["restaurants", pesos(40_000)],
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/domain/spending-by-group.test.ts`
Expected: FAIL — `Cannot find module './spending-by-group'`.

- [ ] **Step 3: Implement**

`src/modules/reporting/domain/spending-by-group.ts`:

```ts
import { placeIn, treeById, type TreeCategory } from "./category-tree";
import type { CategoryConsumption } from "./unified-view";

/** A space a personal row keeps apart, so the web UI writes "space / group" (HU-E9-11). */
export interface SpaceRef {
  readonly id: string;
  readonly name: string;
}

/** What every node of a breakdown carries (HU-E7-06). */
interface SpendingNode {
  readonly archived: boolean;
  /** The node's space in the personal breakdown when it does not merge across spaces; null otherwise (P76). */
  readonly space: SpaceRef | null;
  readonly total: bigint;
  /** Basis points of the parent's total, rounded half up on each level (ruling P75). */
  readonly share: number;
}

/** A subcategory of a category, or (`subcategoryId` and `name` null) what was spent in the category itself. */
export interface SubcategorySpending extends SpendingNode {
  readonly subcategoryId: string | null;
  readonly name: string | null;
}

export interface CategorySpending extends SpendingNode {
  /** Null for a personal row merged by catalog key (ruling P76). */
  readonly id: string | null;
  readonly key: string | null;
  readonly name: string;
  readonly subcategories: readonly SubcategorySpending[];
}

export interface GroupSpending extends SpendingNode {
  /** Null for a personal row merged by catalog key (ruling P76). */
  readonly id: string | null;
  readonly key: string | null;
  readonly name: string;
  readonly categories: readonly CategorySpending[];
}

export interface SpendingTree {
  /** Σ the groups listed. */
  readonly total: bigint;
  /** Largest first at every level; nodes without spending are left out (ruling P75). */
  readonly groups: readonly GroupSpending[];
}

/**
 * HU-E7-06: a space's own breakdown keeps every node apart; the personal one merges seeded groups and categories of
 * every space by catalog key and gives the other rows their space, named by `spaceNames` (rulings P76, P77).
 */
export type Grouping =
  | { readonly kind: "SPACE" }
  | { readonly kind: "PERSONAL"; readonly personalSpaceId: string; readonly spaceNames: ReadonlyMap<string, string> };

/** Basis points of `part` in `whole`, rounded half up (amounts are never negative); 0 of nothing. */
export const shareOf = (part: bigint, whole: bigint): number =>
  whole === 0n ? 0 : Number((part * 20_000n + whole) / (2n * whole));

/** One space's part of a row: the name and archived flag the row has there, and what was spent there. */
interface Part {
  readonly name: string | null;
  readonly archived: boolean;
  amount: bigint;
}

/** A row being summed: a group, a category or a subcategory entry. */
interface Row {
  readonly id: string | null;
  readonly key: string | null;
  /** The space of a row that does not merge across spaces. */
  readonly spaceId: string | null;
  readonly parts: Map<string, Part>;
  readonly children: Map<string, Row>;
  total: bigint;
}

const rowAt = (rows: Map<string, Row>, at: string, fresh: Pick<Row, "id" | "key" | "spaceId">): Row => {
  const found = rows.get(at);
  if (found !== undefined) return found;
  const row: Row = { ...fresh, parts: new Map(), children: new Map(), total: 0n };
  rows.set(at, row);
  return row;
};

const add = (row: Row, spaceId: string, name: string | null, archived: boolean, amount: bigint): void => {
  row.total += amount;
  const part = row.parts.get(spaceId);
  if (part === undefined) row.parts.set(spaceId, { name, archived, amount });
  else part.amount += amount;
};

/** Case ignored, accents not, as `ListCategories` sorts names (ruling P82). */
const compareText = (a: string, b: string): number => a.localeCompare(b, "es", { sensitivity: "accent" });
const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Total descending; then the entry without a subcategory last, name, space name and id (rulings P75, P82). */
const ordered = <T extends { readonly name: string | null; readonly space: SpaceRef | null; readonly total: bigint }>(
  nodes: T[],
  idOf: (node: T) => string,
): T[] =>
  nodes.sort((a, b) =>
    a.total !== b.total
      ? a.total > b.total
        ? -1
        : 1
      : (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) ||
        compareText(a.name ?? "", b.name ?? "") ||
        compareText(a.space?.name ?? "", b.space?.name ?? "") ||
        ordinal(idOf(a), idOf(b)),
  );

/**
 * HU-E7-06, spec 5.4: `rows` (spending per space and category) by group, category and subcategory of the trees as they
 * stand now. An expense counts in `rollUp(categoryId)` and under the group that category sits in (HU-E3-04, HU-E3-02).
 */
export const spendingTree = (
  rows: readonly CategoryConsumption[],
  nodes: readonly TreeCategory[],
  grouping: Grouping,
): SpendingTree => {
  const tree = treeById(nodes);
  const merges = grouping.kind === "PERSONAL";
  const spaceName = (spaceId: string): string =>
    grouping.kind === "PERSONAL" ? (grouping.spaceNames.get(spaceId) ?? "") : "";
  const groups = new Map<string, Row>();
  for (const { categoryId, amount } of rows) {
    const place = placeIn(tree, categoryId);
    if (place === null || amount === 0n) continue;
    const { category, subcategory } = place;
    const { spaceId } = category;
    const groupMerges = merges && category.groupKey !== null;
    const group = rowAt(groups, groupMerges ? `key/${category.groupKey}` : `id/${category.groupId}`, {
      id: groupMerges ? null : category.groupId,
      key: category.groupKey,
      spaceId: groupMerges ? null : spaceId,
    });
    add(group, spaceId, category.groupName, category.groupArchived, amount);
    const categoryMerges = merges && category.categoryKey !== null;
    const row = rowAt(group.children, categoryMerges ? `key/${category.categoryKey}` : `id/${category.categoryId}`, {
      id: categoryMerges ? null : category.categoryId,
      key: category.categoryKey,
      spaceId: categoryMerges ? null : spaceId,
    });
    add(row, spaceId, category.categoryName, category.categoryArchived, amount);
    // Subcategories never merge (no catalog key, HU-E3-04); what was spent in the category itself is one entry.
    const entry = rowAt(row.children, subcategory === null ? "direct" : `id/${subcategory.categoryId}`, {
      id: subcategory?.categoryId ?? null,
      key: null,
      spaceId: subcategory === null ? null : spaceId,
    });
    add(entry, spaceId, subcategory?.categoryName ?? null, subcategory?.categoryArchived ?? false, amount);
  }

  // Ruling P76: a merged row takes the name it has in the caller's personal space, even without spending there.
  const own = grouping.kind === "PERSONAL" ? nodes.filter((n) => n.spaceId === grouping.personalSpaceId) : [];
  const groupNames = new Map(own.flatMap((n) => (n.groupKey === null ? [] : [[n.groupKey, n.groupName] as const])));
  const categoryNames = new Map(
    own.flatMap((n) => (n.categoryKey === null ? [] : [[n.categoryKey, n.categoryName] as const])),
  );
  /** The part with the most spending, ties by space name, then id: where a merged row is named otherwise. */
  const largest = (row: Row): Part =>
    [...row.parts.entries()].sort(([a, x], [b, y]) =>
      x.amount !== y.amount ? (x.amount > y.amount ? -1 : 1) : compareText(spaceName(a), spaceName(b)) || ordinal(a, b),
    )[0]![1];
  const nameOf = (row: Row, names: ReadonlyMap<string, string>): string =>
    (row.id === null && row.key !== null ? names.get(row.key) : undefined) ?? largest(row).name ?? "";
  const node = (row: Row, parentTotal: bigint) => ({
    // Ruling P81: a merged row is archived only where every space spending in it archived it.
    archived: [...row.parts.values()].every((part) => part.archived),
    space: merges && row.spaceId !== null ? { id: row.spaceId, name: spaceName(row.spaceId) } : null,
    total: row.total,
    share: shareOf(row.total, parentTotal),
  });
  const subcategoriesOf = (category: Row): SubcategorySpending[] => {
    const entries = [...category.children.values()];
    // A category without spending in a subcategory lists none, not one entry for its own spending (ruling P75).
    if (entries.every((entry) => entry.id === null)) return [];
    return ordered(
      entries.map((entry) => ({
        subcategoryId: entry.id,
        name: entry.id === null ? null : largest(entry).name,
        ...node(entry, category.total),
      })),
      (entry) => entry.subcategoryId ?? "",
    );
  };

  const total = [...groups.values()].reduce((sum, group) => sum + group.total, 0n);
  return {
    total,
    groups: ordered(
      [...groups.values()].map((group) => ({
        id: group.id,
        key: group.key,
        name: nameOf(group, groupNames),
        ...node(group, total),
        categories: ordered(
          [...group.children.values()].map((category) => ({
            id: category.id,
            key: category.key,
            name: nameOf(category, categoryNames),
            ...node(category, group.total),
            subcategories: subcategoriesOf(category),
          })),
          (category) => category.id ?? category.key ?? "",
        ),
      })),
      (group) => group.id ?? group.key ?? "",
    ),
  };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/reporting/domain`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/reporting/domain/spending-by-group.ts src/modules/reporting/domain/spending-by-group.test.ts
git commit -m "feat(reporting): break spending down by group, category and subcategory with shares (Refs #113)"
```

---

### Task 14b: Reporting — GetSpendingByGroup and GetPersonalSpendingByGroup

Implements HU-E7-06 (issue #113) at the use-case level: a space's breakdown reads the period as every space report does (space.read, archived spaces, stored periods first, D10) and the amounts of its live expenses; the caller's breakdown reads exactly the consumption rows of the unified view (HU-E7-04: their own member rows, their personal period, one currency) and groups them with Task 14a's fold. Neither derives a sum of its own (ruling P80).

**Decisions:**
- The space and period checks of `spaceReport` move into `spacePeriod`, which `spaceReport` now calls, so the breakdown checks access and resolves labels exactly as the other space reports do without loading a plan it does not need.
- `consumptionRows` is the one read of the caller's consumption rows: `consumptionTotal` (and so the personal trend) and the personal breakdown both go through it, so the breakdown's total equals the unified view's consumption.
- The personal breakdown asks for the trees of every space with consumption and always of the personal space, whose names the merged rows take (ruling P76). Spaces in another currency stay out through `personalScope` (D6, ruling P37); the response names the currency, not those spaces (ruling P82).

**Files:**
- Create: `src/modules/reporting/application/get-spending-by-group.ts`, `src/modules/reporting/application/get-personal-spending-by-group.ts`
- Modify: `src/modules/reporting/application/space-report.ts`, `src/modules/reporting/application/personal-scope.ts`, `src/modules/reporting/application/index.ts`
- Create (test): `src/modules/reporting/application/spending-by-group.test.ts`

**Interfaces:**
- Consumes: `spendingTree`, `SpendingTree` (Task 14a); `CategoryTrees` (Task 13); `ReportingDeps`, `SpaceReportInput`, `spaceReport` (Task 1); `PersonalDeps`, `PersonalScope`, `personalScope`, `consumptionTotal` (Task 8b); `createGetUnifiedPersonalView` (Task 8b); `PlanSpending.expensesByCategory`; `reportingWorld`, `HOUSEHOLD`; `personalWorld`, `place`, `ANA_PLACES`; `ANA_TREE`, `HOUSEHOLD_TREE`, `spent` (Task 13).
- Produces: `spacePeriod(deps, input): Promise<Result<{ space, period }>>` (`space-report.ts`); `consumptionRows(deps, scope, period)` (`personal-scope.ts`); `SpendingByGroupDeps`, `SpendingByGroup { spaceId, currency, period, total, groups }`, `GetSpendingByGroup = (input: SpaceReportInput) => …`, `createGetSpendingByGroup(deps)`; `PersonalSpendingByGroupDeps`, `PersonalSpendingByGroup { currency, period, total, groups }`, `GetPersonalSpendingByGroup = (input: { userId; period }) => …`, `createGetPersonalSpendingByGroup(deps)`; the index re-exports these and `CategorySpending`, `GroupSpending`, `SpaceRef`, `SpendingTree`, `SubcategorySpending`.

- [ ] **Step 1: Write the failing tests**

`src/modules/reporting/application/spending-by-group.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HOUSEHOLD } from "../../../../tests/support/budgeting-world";
import { ANA_TREE, HOUSEHOLD_TREE, spent } from "../../../../tests/support/category-trees";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { ANA_PLACES, personalWorld, place } from "../../../../tests/support/personal-world";
import { reportingWorld } from "../../../../tests/support/reporting-world";
import type { CategoryTrees } from "./category-trees";
import { createGetPersonalSpendingByGroup } from "./get-personal-spending-by-group";
import { createGetSpendingByGroup } from "./get-spending-by-group";
import { createGetUnifiedPersonalView } from "./get-unified-personal-view";

const pesos = (n: number) => BigInt(n) * 100n;
const NOVEMBER = "2026-11-01";

/** The trees of the spaces asked for, from Ana's and Household's (Task 13); records every question. */
const treesOf = () => {
  const asked: (readonly string[])[] = [];
  const trees: CategoryTrees = {
    treesOf: async (spaceIds) => {
      asked.push(spaceIds);
      return [...ANA_TREE, ...HOUSEHOLD_TREE].filter((n) => spaceIds.includes(n.spaceId));
    },
  };
  return { trees, asked };
};

describe("spending by group of a space (HU-E7-06)", () => {
  const read = (
    w: ReturnType<typeof reportingWorld>,
    trees: CategoryTrees,
    userId = "u-ana",
    period = "2026-11",
    spaceId: string = HOUSEHOLD,
  ) => createGetSpendingByGroup({ ...w.deps, trees })({ spaceId, userId, period });

  it("totals Household's November by group for Ana and VIEWER Sofi alike (@critical)", async () => {
    const w = reportingWorld();
    w.spending.expenses[NOVEMBER] = [
      { categoryId: "cat-rent", amount: pesos(1_200_000) },
      { categoryId: "cat-groceries", amount: pesos(900_000) },
      { categoryId: "cat-utilities", amount: pesos(400_000) },
      { categoryId: "cat-entertainment", amount: pesos(250_000) },
      { categoryId: "cat-restaurants", amount: pesos(60_000) },
    ];
    const t = treesOf();
    const ana = unwrap(await read(w, t.trees));
    expect(ana).toMatchObject({ spaceId: HOUSEHOLD, currency: "COP", total: pesos(2_810_000) });
    expect(ana.period).toEqual({ start: "2026-11-01", end: "2026-11-30", label: "2026-11" });
    expect(ana.groups.map((g) => [g.key, g.total, g.share])).toEqual([
      ["housing", pesos(1_600_000), 5_694],
      ["food", pesos(960_000), 3_416],
      ["leisure", pesos(250_000), 890],
    ]);
    expect(unwrap(await read(w, t.trees, "u-sofi"))).toEqual(ana);
    // Only Household's tree is read.
    expect(t.asked).toEqual([[HOUSEHOLD], [HOUSEHOLD]]);
  });

  it("reads October's expenses for 2026-10 and counts Vegetables once, inside Groceries", async () => {
    const w = reportingWorld();
    w.spending.expenses["2026-10-01"] = [
      { categoryId: "cat-groceries", amount: pesos(85_000) },
      { categoryId: "cat-vegetables", amount: pesos(40_000) },
      { categoryId: "cat-restaurants", amount: pesos(60_000) },
    ];
    const october = unwrap(await read(w, treesOf().trees, "u-ana", "2026-10"));
    expect(october.total).toBe(pesos(185_000));
    expect(october.groups[0]!.categories[0]).toMatchObject({ key: "groceries", total: pesos(125_000) });
  });

  it("reads an archived space with nothing spent, and hides the space from non-members and malformed ids", async () => {
    const w = reportingWorld();
    w.spaces.archived.add(HOUSEHOLD);
    const { trees } = treesOf();
    expect(unwrap(await read(w, trees, "u-juan"))).toMatchObject({ total: 0n, groups: [] });
    expect(codeOf(await read(w, trees, "u-marta"))).toBe("SpaceNotFound");
    expect(codeOf(await read(w, trees, "u-ana", "2026-11", "not-a-uuid"))).toBe("SpaceNotFound");
    expect(codeOf(await read(w, trees, "u-ana", "2026-11 H1"))).toBe("InvalidPeriodLabel");
  });
});

describe("personal spending by group (HU-E7-06)", () => {
  const read = (w: ReturnType<typeof personalWorld>, trees: CategoryTrees, period = "2026-11", userId = "u-ana") =>
    createGetPersonalSpendingByGroup({ ...w.deps, trees })({ userId, period });
  /** HU-E7-04 Background as the ledger sums Ana's rows (Task 8b). */
  const background = () => [
    spent("space-ana", "cat-ana-groceries", 85_000),
    spent("space-ana", "cat-ana-restaurants", 60_000),
    spent("space-household", "cat-groceries", 950_000),
    spent("space-household", "cat-rent", 480_000),
  ];

  it("groups Ana's consumption across her spaces, asking only about her own rows in her personal period (@critical)", async () => {
    const w = personalWorld();
    w.sums.consumption[NOVEMBER] = [
      ...background(),
      spent("space-ana", "cat-ana-vet", 40_000),
      spent("space-household", "cat-vet", 25_000),
    ];
    const t = treesOf();
    const breakdown = unwrap(await read(w, t.trees));
    expect(breakdown).toMatchObject({
      currency: "COP",
      total: pesos(1_640_000),
      period: { label: "2026-11", start: "2026-11-01", end: "2026-11-30" },
    });
    expect(breakdown.groups.map((g) => [g.key, g.space?.name ?? null, g.total, g.share])).toEqual([
      ["food", null, pesos(1_095_000), 6_677],
      ["housing", null, pesos(480_000), 2_927],
      [null, "Personal", pesos(40_000), 244],
      [null, "Household", pesos(25_000), 152],
    ]);
    expect(w.sums.asked).toEqual([
      { memberIds: ["member-ana-personal", "member-ana"], from: "2026-11-01", to: "2026-11-30" },
    ]);
    // Her personal space's tree is always read, to name the merged rows (ruling P76).
    expect(t.asked).toEqual([["space-ana", "space-household"]]);
  });

  it("totals exactly the consumption of Ana's unified view", async () => {
    const w = personalWorld();
    w.sums.consumption[NOVEMBER] = background();
    const breakdown = unwrap(await read(w, treesOf().trees));
    const view = unwrap(await createGetUnifiedPersonalView(w.deps)({ userId: "u-ana", period: "2026-11" }));
    expect(breakdown.total).toBe(pesos(1_575_000));
    expect(breakdown.total).toBe(view.consumption.total);
  });

  it("leaves spaces in another currency out and refuses a label her personal policy does not name", async () => {
    const trip = place("space-trip", "member-ana-trip", "Trip", { currency: "USD" });
    const w = personalWorld([...ANA_PLACES, trip]);
    const { trees } = treesOf();
    expect(unwrap(await read(w, trees)).currency).toBe("COP");
    expect(w.sums.asked[0]?.memberIds).toEqual(["member-ana-personal", "member-ana"]);
    expect(codeOf(await read(w, trees, "2026-11 H1"))).toBe("InvalidPeriodLabel");
    expect(codeOf(await read(w, trees, "2026-11", "u-nobody"))).toBe("SpaceNotFound");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/application/spending-by-group.test.ts`
Expected: FAIL — `Cannot find module './get-personal-spending-by-group'`.

- [ ] **Step 3: Implement**

In `src/modules/reporting/application/space-report.ts`:

1. Replace the lines from `  const reader = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");` to `  return ok({ space, period: period.value, view: await planViewIn(deps, space, period.value) });` (the body of `spaceReport`) with:

```ts
  const scoped = await spacePeriod(deps, input);
  if (!scoped.ok) return scoped;
  const { space, period } = scoped.value;
  return ok({ space, period, view: await planViewIn(deps, space, period) });
```

2. Insert before the line `export const reportPlanOf = (view: BudgetPlanView | null): ReportPlan | null =>`:

```ts
/**
 * HU-E7-01 … HU-E7-06: the reader's membership (space.read, every role, archived spaces included) and the period
 * named `input.period`: the stored one with that label, else the policy's period around the stored ones (D10).
 */
export const spacePeriod = async (
  deps: Pick<ReportingDeps, "access" | "plans">,
  input: SpaceReportInput,
): Promise<Result<{ readonly space: SpaceMembership; readonly period: Period }>> => {
  const reader = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
  if (!reader.ok) return reader;
  const space = reader.value;
  const period = periodByLabel(space.periodPolicy, await deps.plans.storedPeriods(space.spaceId), input.period);
  if (!period.ok) return period;
  return ok({ space, period: period.value });
};

```

In `src/modules/reporting/application/personal-scope.ts`:

1. Insert before the line `/** Σ the caller's consumption within `period` across `scope.places` (spec 5.4). */`:

```ts
/** The caller's shares of live expenses within `period` across `scope.places`, per space and category (spec 5.4). */
export const consumptionRows = (deps: PersonalDeps, scope: PersonalScope, period: Period) =>
  deps.sums.consumptionByCategory(
    scope.places.map((p) => p.memberId),
    period.start,
    period.end,
  );

```

2. Replace the five lines from `  const rows = await deps.sums.consumptionByCategory(` to the `  );` that closes that call (inside `consumptionTotal`) with:

```ts
  const rows = await consumptionRows(deps, scope, period);
```

`src/modules/reporting/application/get-spending-by-group.ts`:

```ts
import { ok, type Period, type Result } from "@/shared/kernel";
import { spendingTree, type SpendingTree } from "../domain/spending-by-group";
import type { CategoryTrees } from "./category-trees";
import type { ReportingDeps } from "./deps";
import { spacePeriod, type SpaceReportInput } from "./space-report";

/** What a space's breakdown reads: the space reports' ports and the category tree (HU-E7-06). */
export type SpendingByGroupDeps = ReportingDeps & { readonly trees: CategoryTrees };

/** HU-E7-06: a space's spending in a period by group, category and subcategory. */
export interface SpendingByGroup extends SpendingTree {
  readonly spaceId: string;
  readonly currency: string;
  readonly period: Period;
}

export type GetSpendingByGroup = (input: SpaceReportInput) => Promise<Result<SpendingByGroup>>;

/**
 * HU-E7-06: the amount of every live expense of the space dated in the period, whoever paid it and from whichever
 * account (an expense paid from the fund counts once), placed in the space's tree as it is now (ruling P80); every
 * node is the space's own, so nothing merges. Computed on read (D7).
 */
export const createGetSpendingByGroup =
  (deps: SpendingByGroupDeps): GetSpendingByGroup =>
  async (input) => {
    const scoped = await spacePeriod(deps, input);
    if (!scoped.ok) return scoped;
    const { space, period } = scoped.value;
    const spent = await deps.spending.expensesByCategory(space.spaceId, period.start, period.end);
    const rows = spent.map((row) => ({ spaceId: space.spaceId, categoryId: row.categoryId, amount: row.amount }));
    const tree = await deps.trees.treesOf([space.spaceId]);
    return ok({
      spaceId: space.spaceId,
      currency: space.currency,
      period,
      ...spendingTree(rows, tree, { kind: "SPACE" }),
    });
  };
```

`src/modules/reporting/application/get-personal-spending-by-group.ts`:

```ts
import { ok, type Period, type Result } from "@/shared/kernel";
import { spendingTree, type SpendingTree } from "../domain/spending-by-group";
import type { CategoryTrees } from "./category-trees";
import { consumptionRows, personalScope, type PersonalDeps } from "./personal-scope";

/** What the caller's breakdown reads: the unified view's ports and the category trees (HU-E7-06). */
export type PersonalSpendingByGroupDeps = PersonalDeps & { readonly trees: CategoryTrees };

/** HU-E7-06: the caller's consumption in a personal period by group, category and subcategory. */
export interface PersonalSpendingByGroup extends SpendingTree {
  /** The personal space's currency, every amount's; spaces in another currency are left out (D6, ruling P37). */
  readonly currency: string;
  /** The caller's personal-space period; shared expenses are placed in it by date (D11). */
  readonly period: Period;
}

export type GetPersonalSpendingByGroup = (input: {
  readonly userId: string;
  readonly period: string;
}) => Promise<Result<PersonalSpendingByGroup>>;

/**
 * HU-E7-06: the caller's consumption exactly as the unified view sums it (HU-E7-04: their shares in every space they
 * are or were a member of, their own member rows only), grouped by the trees as they are now: seeded groups and
 * categories merge across spaces by catalog key, custom ones stay with their space (rulings P76, P77).
 */
export const createGetPersonalSpendingByGroup =
  (deps: PersonalSpendingByGroupDeps): GetPersonalSpendingByGroup =>
  async ({ userId, period: label }) => {
    const scope = await personalScope(deps, userId, label);
    if (!scope.ok) return scope;
    const { personal, period, places } = scope.value;
    const rows = await consumptionRows(deps, scope.value, period);
    // The personal space's tree names the merged rows, even where it has no spending (ruling P76).
    const tree = await deps.trees.treesOf([...new Set<string>([personal.spaceId, ...rows.map((row) => row.spaceId)])]);
    const spaceNames = new Map(places.map((p) => [p.spaceId as string, p.spaceName]));
    return ok({
      currency: personal.currency,
      period,
      ...spendingTree(rows, tree, { kind: "PERSONAL", personalSpaceId: personal.spaceId, spaceNames }),
    });
  };
```

In `src/modules/reporting/application/index.ts`, append to the end of the file:

```ts
export type {
  CategorySpending,
  GroupSpending,
  SpaceRef,
  SpendingTree,
  SubcategorySpending,
} from "../domain/spending-by-group";
export {
  createGetSpendingByGroup,
  type GetSpendingByGroup,
  type SpendingByGroup,
  type SpendingByGroupDeps,
} from "./get-spending-by-group";
export {
  createGetPersonalSpendingByGroup,
  type GetPersonalSpendingByGroup,
  type PersonalSpendingByGroup,
  type PersonalSpendingByGroupDeps,
} from "./get-personal-spending-by-group";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/reporting`
Expected: PASS, the line dashboard, matrix, fund, unified view and trend tests of Tasks 1, 5, 8b and 11 included (`spaceReport` and `consumptionTotal` answer as before).

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/reporting/application
git commit -m "feat(reporting): derive a space's and the caller's spending by group (Refs #113)"
```

---

### Task 15a: HTTP — a space's spending by group

Implements HU-E7-06 (issue #113) over HTTP for a space: `GET /api/v1/spaces/{spaceId}/reports/spending-by-group?period=<label>`. Pins the `@critical` scenario (VIEWER Sofi included) and the errors against PostgreSQL; Task 15b adds the drill-down, subcategory and moved-category scenarios and the backlog note (this half measures 449 lines, 216 of them snapshot).

**Decisions:**
- The response is inline (ruling P39): `spaceId`, `period`, `total` and `groups[]` → `categories[]` → `subcategories[]`. Groups and categories carry `id`, `key`, `name`, `archived`, `total` and `share`; subcategory entries `subcategoryId`, `name`, `archived`, `total` and `share`. `id` is nullable because both breakdowns share the domain type (only a merged personal row lacks one); a space's own breakdown always has it, and carries no `space` field (ruling P82).
- `share` goes out as a decimal string in percent with two decimals through the existing `percentOf` ("56.94", "100.00"), the same rendering as HU-E6's shares.
- No new error code: `SpaceNotFound` (404), `ValidationFailed` (422, a missing `period`) and `InvalidPeriodLabel` (422) through `reportProblems`.

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/reports/spending-by-group/route.ts`
- Modify: `src/modules/reporting/contracts/reporting.contract.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`, `tests/support/reporting.ts`
- Create (test): `tests/acceptance/reports-spending-by-group.test.ts`

**Interfaces:**
- Consumes: `createGetSpendingByGroup`, `GetSpendingByGroup`, `SpendingByGroup`, `CategorySpending`, `SubcategorySpending` (Task 14b); `DrizzleCategoryRepository.treesOf` (Task 13); `ReportQuerySchema`, `moneyOf`, `reportProblems`, `SpacePath` (Task 2a); `percentOf`, `periodDto`, `MoneySchema`, `PeriodSchema` (`@/shared/http/contracts`); `getWithQuery`, `spend`, `ReportPeriodDto` (Task 2a); `household`, `joinHousehold`, `categoryWithKey`, `cop`, `Household`; `registerUser`, `problemOf`.
- Produces: `spendingNode`, `SubcategorySpendingSchema`, `SpendingByGroupSchema`, `spendingNodeDto`, `subcategorySpendingDto`, `spendingByGroupDto` in `reporting.contract.ts`; `Container.reporting.getSpendingByGroup`; `categoryRepository` and `reportingDeps.trees` in the composition root; test support `getSpendingByGroup(user, spaceId, query)`, `SpendingNodeDto`, `SubcategorySpendingDto`, `SpendingByGroupDto`; in the test file `categoriesOf`, `novemberExpenses`, `breakdownOf`.

- [ ] **Step 1: Write the failing tests**

In `tests/support/reporting.ts`:

1. Insert after the line `import { GET as personalTrendRoute } from "@/app/api/v1/me/trend/route";`:

```ts
import { GET as spendingByGroupRoute } from "@/app/api/v1/spaces/[spaceId]/reports/spending-by-group/route";
```

2. Append to the end of the file:

```ts

export interface SpendingNodeDto {
  id: string | null;
  key: string | null;
  name: string;
  archived: boolean;
  total: MoneyDto;
  share: string;
}
export interface SubcategorySpendingDto {
  subcategoryId: string | null;
  name: string | null;
  archived: boolean;
  total: MoneyDto;
  share: string;
}
export interface SpendingByGroupDto {
  spaceId: string;
  period: ReportPeriodDto;
  total: MoneyDto;
  groups: (SpendingNodeDto & { categories: (SpendingNodeDto & { subcategories: SubcategorySpendingDto[] })[] })[];
}

/** HU-E7-06: `user` reads the spending by group of `spaceId`. */
export const getSpendingByGroup = (user: TestUser, spaceId: string, query: Record<string, string>) =>
  getWithQuery(spendingByGroupRoute, user, `/api/v1/spaces/${spaceId}/reports/spending-by-group`, query, {
    spaceId,
  });
```

`tests/acceptance/reports-spending-by-group.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setContainerForTests, type Container } from "@/composition/container";
import { problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { categoryWithKey, cop, household, joinHousehold, type Household } from "../support/ledger";
import { getSpendingByGroup, spend, type SpendingByGroupDto } from "../support/reporting";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** HU-E7-01 Background's categories of Household, by catalog key; Household's groups are seeded (HU-E3-05). */
const categoriesOf = async (h: Household) => ({
  rent: await categoryWithKey(h.ana, "rent"),
  groceries: h.groceries,
  utilities: await categoryWithKey(h.ana, "utilities"),
  entertainment: await categoryWithKey(h.ana, "entertainment"),
  restaurants: await categoryWithKey(h.ana, "restaurants"),
});
type Categories = Awaited<ReturnType<typeof categoriesOf>>;

/** HU-E7-01 Background: November 2026 in Household; `groceries` splits Groceries' 900,000 COP when given. */
const novemberExpenses = async (
  h: Household,
  c: Categories,
  groceries: [string, number][] = [[c.groceries, 900_000]],
) => {
  await spend(h.ana, c.rent, 1_200_000, "2026-11-01");
  for (const [categoryId, pesos] of groceries) await spend(h.ana, categoryId, pesos, "2026-11-05");
  await spend(h.juan, c.utilities, 400_000, "2026-11-10");
  await spend(h.juan, c.entertainment, 250_000, "2026-11-15");
  await spend(h.ana, c.restaurants, 60_000, "2026-11-30");
};

const breakdownOf = async (user: TestUser, spaceId: string, period: string): Promise<SpendingByGroupDto> => {
  const response = await getSpendingByGroup(user, spaceId, { period });
  expect(response.status).toBe(200);
  return (await response.json()) as SpendingByGroupDto;
};

describe("spending by group of a space over HTTP (HU-E7-06)", () => {
  it("totals Household's November by group, the largest first, the same for VIEWER Sofi (@critical)", async () => {
    const h = await household();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    await novemberExpenses(h, await categoriesOf(h));
    // Review Focus 2: the next period's first day is not November's.
    await spend(h.ana, h.groceries, 70_000, "2026-12-01");
    const breakdown = await breakdownOf(h.ana, h.spaceId, "2026-11");
    expect(breakdown.total).toEqual(cop(2_810_000));
    expect(breakdown.period).toEqual({ label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" });
    // Transport has no spending, so it is not listed.
    expect(breakdown.groups.map((g) => [g.key, g.total, g.share])).toEqual([
      ["housing", cop(1_600_000), "56.94"],
      ["food", cop(960_000), "34.16"],
      ["leisure", cop(250_000), "8.90"],
    ]);
    expect(await breakdownOf(sofi, h.spaceId, "2026-11")).toEqual(breakdown);
  });

  it("hides the space from non-members and malformed ids, refuses bad periods and answers 0 for an empty one", async () => {
    const h = await household();
    const marta = await registerUser("Marta");
    expect(await problemOf(await getSpendingByGroup(marta, h.spaceId, { period: "2026-11" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    expect(await problemOf(await getSpendingByGroup(h.ana, "not-a-uuid", { period: "2026-11" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    expect(await problemOf(await getSpendingByGroup(h.ana, h.spaceId, {}))).toEqual([422, "ValidationFailed"]);
    expect(await problemOf(await getSpendingByGroup(h.ana, h.spaceId, { period: "2026-11 H1" }))).toEqual([
      422,
      "InvalidPeriodLabel",
    ]);
    expect(await breakdownOf(h.ana, h.spaceId, "2027-01")).toMatchObject({ total: cop(0), groups: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/reports-spending-by-group.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/v1/spaces/[spaceId]/reports/spending-by-group/route'`.

- [ ] **Step 3: Implement**

In `src/modules/reporting/contracts/reporting.contract.ts`:

1. Insert before the line `  type LineDashboard,`:

```ts
  type CategorySpending,
  type SpendingByGroup,
  type SubcategorySpending,
```

2. Insert before the line `const SpacePath = z.object({ spaceId: z.string() });`:

```ts
/** HU-E7-06: what every group and category of a breakdown carries. */
const spendingNode = {
  /** Null only for a personal row merged by catalog key; a space's own breakdown always has it. */
  id: z.string().nullable(),
  /** The catalog key of a seeded group or category (HU-E3-05, D11); null for those users create. */
  key: z.string().nullable(),
  name: z.string(),
  /** Archived nodes still appear while they have spending in the period (HU-E3-03). */
  archived: z.boolean(),
  total: MoneySchema,
  /** Percent of the parent's total with two decimals, each level rounded half up on its own ("56.94"). */
  share: z.string(),
};

/** HU-E7-06: one subcategory, or (`subcategoryId` and `name` null) what was spent in the category itself. */
const SubcategorySpendingSchema = z.object({
  subcategoryId: z.string().nullable(),
  name: z.string().nullable(),
  archived: z.boolean(),
  total: MoneySchema,
  share: z.string(),
});

/** HU-E7-06: a space's spending in a period by group, category and subcategory, every level largest first. */
export const SpendingByGroupSchema = z.object({
  spaceId: z.string(),
  period: PeriodSchema,
  total: MoneySchema,
  groups: z.array(
    z.object({
      ...spendingNode,
      categories: z.array(z.object({ ...spendingNode, subcategories: z.array(SubcategorySpendingSchema) })),
    }),
  ),
});

type SpendingNodeOf = Pick<CategorySpending, "id" | "key" | "name" | "archived" | "total" | "share">;

const spendingNodeDto = (node: SpendingNodeOf, currency: string) => ({
  id: node.id,
  key: node.key,
  name: node.name,
  archived: node.archived,
  total: moneyOf(node.total, currency),
  share: percentOf(node.share),
});

const subcategorySpendingDto = (entry: SubcategorySpending, currency: string) => ({
  subcategoryId: entry.subcategoryId,
  name: entry.name,
  archived: entry.archived,
  total: moneyOf(entry.total, currency),
  share: percentOf(entry.share),
});

export const spendingByGroupDto = (report: SpendingByGroup): z.infer<typeof SpendingByGroupSchema> => ({
  spaceId: report.spaceId,
  period: periodDto(report.period),
  total: moneyOf(report.total, report.currency),
  groups: report.groups.map((group) => ({
    ...spendingNodeDto(group, report.currency),
    categories: group.categories.map((category) => ({
      ...spendingNodeDto(category, report.currency),
      subcategories: category.subcategories.map((entry) => subcategorySpendingDto(entry, report.currency)),
    })),
  })),
});

```

3. Insert before the last line of the file (`};`, the end of `reportingPaths`):

```ts
  "/api/v1/spaces/{spaceId}/reports/spending-by-group": {
    get: {
      operationId: "getSpendingByGroup",
      summary: "A space's spending in a period by category group, then category, then subcategory; computed on read",
      description:
        "Every member reads it, archived spaces included. Live expenses count by amount, whoever paid, under the tree as it is now; nodes without spending are left out and each share is of its parent's total.",
      ...securedByUser,
      requestParams: { path: SpacePath, query: ReportQuerySchema },
      responses: {
        "200": {
          description: "The groups with spending, largest first, each with its categories and subcategories",
          content: jsonContent(SpendingByGroupSchema),
        },
        ...reportProblems,
      },
    },
  },
```

`src/app/api/v1/spaces/[spaceId]/reports/spending-by-group/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ReportQuerySchema, spendingByGroupDto } from "@/modules/reporting/contracts/reporting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: ReportQuerySchema,
  handler: async ({ user, params, query }) => {
    const result = await getContainer().reporting.getSpendingByGroup({
      spaceId: params.spaceId!,
      userId: user!.id,
      period: query.period,
    });
    return result.ok ? ok({ status: 200, body: spendingByGroupDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert before the line `  type GetLineDashboard,`:

```ts
  createGetSpendingByGroup,
  type GetSpendingByGroup,
```

2. Insert after the line `    readonly getPersonalTrend: GetPersonalTrend;`:

```ts
    readonly getSpendingByGroup: GetSpendingByGroup;
```

3. `categoriesDeps.categories` is typed `CategoryRepository`, which has no `treesOf`, so the composition root keeps the repository itself: insert before the line `  const categoriesDeps: CategoriesDeps = {`:

```ts
  const categoryRepository = new DrizzleCategoryRepository(tm);
```

and replace the line `    categories: new DrizzleCategoryRepository(tm),` with:

```ts
    categories: categoryRepository,
```

4. Insert after the line `  const reportingDeps = {`:

```ts
    // HU-E7-06: the category trees as they stand now, with group and category keys (categories, P74).
    trees: categoryRepository,
```

5. Insert after the line `      getPersonalTrend: createGetPersonalTrend(reportingDeps),`:

```ts
      getSpendingByGroup: createGetSpendingByGroup(reportingDeps),
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds only `GET /api/v1/spaces/{spaceId}/reports/spending-by-group` (about 217 lines; the amounts reference the existing `MoneyOutput`, `period` the existing `Period`); no component is added or changed.
Then run: `pnpm exec vitest run --project acceptance tests/acceptance/reports-spending-by-group.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/v1/spaces/[spaceId]/reports/spending-by-group/route.ts" src/modules/reporting/contracts/reporting.contract.ts src/composition/container.ts openapi/openapi.snapshot.json tests/support/reporting.ts tests/acceptance/reports-spending-by-group.test.ts
git commit -m "feat(reporting): serve a space's spending by group over HTTP (Refs #113)"
```

---

### Task 15b: HTTP — drill-down, subcategories and a moved category

Completes HU-E7-06 (issue #113) over HTTP for a space: the drill-down from Food to Groceries' subcategories, an expense in a subcategory counted once, and a moved category counted under its current group in every period, with the tree changed through the categories endpoints themselves. The behaviour was test-driven in Tasks 13 (`placeIn`, `treesOf` after a move), 14a and 14b, and Task 15a serves it, so these tests pass on their first run; each pins one HTTP-observable outcome. Adds the category helpers Task 16a reuses and the backlog note.

**Decisions:**
- The tree changes go through `POST …/categories` (`groupId` or `parentCategoryId`, M3-D Task 9b), `PATCH …/categories/{categoryId}` (`groupId`) and `POST …/category-groups`, so the report is pinned against the tree as users change it, not against rows written by hand.
- Subcategory entries are compared by `subcategoryId` and groups and categories by `key`, so the tests hold in the language the household's categories were seeded in.

**Files:**
- Modify: `tests/support/reporting.ts`, `tests/acceptance/reports-spending-by-group.test.ts`, `docs/backlog/E7-reporting.md`

**Interfaces:**
- Consumes: `categoriesOf`, `novemberExpenses`, `breakdownOf` (Task 15a, in the test file); `household`, `spend`, `cop`; `call`, `inSpace`; the routes `GET`/`POST …/categories`, `PATCH …/categories/{categoryId}` (M3-D Task 9b: `parentCategoryId`), `POST …/category-groups`; `GET …/categories` answering each group's `key` (M3-D Task 17a as amended, ruling P74).
- Produces: test support `newCategoryGroup(user, name)`, `newCategory(user, name, parent)`, `moveCategory(user, categoryId, groupId)`, `groupWithKey(user, key)` in `tests/support/reporting.ts`.

- [ ] **Step 1: Write the tests**

In `tests/support/reporting.ts`:

1. Insert after the line `import { GET as spendingByGroupRoute } from "@/app/api/v1/spaces/[spaceId]/reports/spending-by-group/route";`:

```ts
import { GET as listCategories, POST as createCategory } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { PATCH as updateCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route";
import { POST as createCategoryGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/route";
```

2. Replace the line `import { categoryWithKey, cop, newAccount, post, type HouseholdMember, type MoneyDto } from "./ledger";` with:

```ts
import {
  categoryWithKey,
  cop,
  inSpace,
  newAccount,
  post,
  type HouseholdMember,
  type MoneyDto,
} from "./ledger";
```

3. Append to the end of the file:

```ts

/** HU-E3-02: `user` creates the category group `name` in their space; returns its id. */
export const newCategoryGroup = async (user: TestUser, name: string): Promise<string> => {
  const response = await call(createCategoryGroup, "POST", inSpace(user, "category-groups"), {
    user,
    params: { spaceId: user.spaceId },
    body: { name },
  });
  if (response.status !== 201) throw new Error(`group creation failed with status ${response.status}`);
  return ((await response.json()) as { id: string }).id;
};

/** HU-E3-02, HU-E3-04: `user` creates `name` in a group, or as a subcategory of a category; returns its id. */
export const newCategory = async (
  user: TestUser,
  name: string,
  parent: { readonly groupId: string } | { readonly parentCategoryId: string },
): Promise<string> => {
  const response = await call(createCategory, "POST", inSpace(user, "categories"), {
    user,
    params: { spaceId: user.spaceId },
    body: { name, ...parent },
  });
  if (response.status !== 201) throw new Error(`category creation failed with status ${response.status}`);
  return ((await response.json()) as { id: string }).id;
};

/** HU-E3-02: `user` moves the category `categoryId` to the group `groupId` of their space. */
export const moveCategory = async (user: TestUser, categoryId: string, groupId: string): Promise<void> => {
  const response = await call(updateCategory, "PATCH", inSpace(user, `categories/${categoryId}`), {
    user,
    params: { spaceId: user.spaceId, categoryId },
    body: { groupId },
  });
  if (response.status !== 200) throw new Error(`category move failed with status ${response.status}`);
};

/** HU-E3-05: the id of the seeded group with the catalog `key` in `user`'s space. */
export const groupWithKey = async (user: TestUser, key: string): Promise<string> => {
  const response = await call(listCategories, "GET", inSpace(user, "categories"), {
    user,
    params: { spaceId: user.spaceId },
  });
  const { items } = (await response.json()) as { items: { id: string; key: string | null }[] };
  return items.find((g) => g.key === key)!.id;
};
```

In `tests/acceptance/reports-spending-by-group.test.ts`:

1. Replace the line `import { getSpendingByGroup, spend, type SpendingByGroupDto } from "../support/reporting";` with:

```ts
import {
  getSpendingByGroup,
  groupWithKey,
  moveCategory,
  newCategory,
  spend,
  type SpendingByGroupDto,
} from "../support/reporting";
```

2. Insert before the last line of the file (`});`, the end of the `describe`):

```ts

  it("drills down from Food to its categories and from Groceries to its subcategories", async () => {
    const h = await household();
    const c = await categoriesOf(h);
    const vegetables = await newCategory(h.ana, "Vegetables", { parentCategoryId: c.groceries });
    const meat = await newCategory(h.ana, "Meat", { parentCategoryId: c.groceries });
    await novemberExpenses(h, c, [
      [c.groceries, 450_000],
      [vegetables, 270_000],
      [meat, 180_000],
    ]);
    const food = (await breakdownOf(h.ana, h.spaceId, "2026-11")).groups.find((g) => g.key === "food")!;
    expect(food.categories.map((x) => [x.key, x.total, x.share])).toEqual([
      ["groceries", cop(900_000), "93.75"],
      ["restaurants", cop(60_000), "6.25"],
    ]);
    expect(food.categories[0]!.subcategories.map((s) => [s.subcategoryId, s.total, s.share])).toEqual([
      [null, cop(450_000), "50.00"],
      [vegetables, cop(270_000), "30.00"],
      [meat, cop(180_000), "20.00"],
    ]);
    expect(food.categories[1]!.subcategories).toEqual([]);
  });

  it("counts an October expense in Vegetables once, in Groceries and in Food", async () => {
    const h = await household();
    const c = await categoriesOf(h);
    const vegetables = await newCategory(h.ana, "Vegetables", { parentCategoryId: c.groceries });
    await spend(h.ana, c.groceries, 85_000, "2026-10-03");
    await spend(h.ana, vegetables, 40_000, "2026-10-04");
    await spend(h.juan, c.restaurants, 60_000, "2026-10-05");
    const october = await breakdownOf(h.ana, h.spaceId, "2026-10");
    expect(october.total).toEqual(cop(185_000));
    expect(october.groups.map((g) => [g.key, g.total])).toEqual([["food", cop(185_000)]]);
    const groceries = october.groups[0]!.categories.find((x) => x.key === "groceries")!;
    expect(groceries.total).toEqual(cop(125_000));
    expect(groceries.subcategories.map((s) => [s.subcategoryId, s.total])).toEqual([
      [null, cop(85_000)],
      [vegetables, cop(40_000)],
    ]);
  });

  it("counts Restaurants under Leisure once it moved there, in November and in the October recorded under Food", async () => {
    const h = await household();
    const c = await categoriesOf(h);
    await novemberExpenses(h, c);
    await spend(h.ana, c.restaurants, 30_000, "2026-10-08");
    await moveCategory(h.ana, c.restaurants, await groupWithKey(h.ana, "leisure"));
    expect((await breakdownOf(h.ana, h.spaceId, "2026-11")).groups.map((g) => [g.key, g.total, g.share])).toEqual([
      ["housing", cop(1_600_000), "56.94"],
      ["food", cop(900_000), "32.03"],
      ["leisure", cop(310_000), "11.03"],
    ]);
    const october = await breakdownOf(h.ana, h.spaceId, "2026-10");
    expect(october.groups.map((g) => [g.key, g.categories.map((x) => [x.key, x.total])])).toEqual([
      ["leisure", [["restaurants", cop(30_000)]]],
    ]);
  });
```

In `docs/backlog/E7-reporting.md`, insert after the line `- Not in scope: trends by group (HU-E7-05 stays by line), budget lines by group (HU-E6-04 maps categories) and filtering transactions by group. Charts, the drill-down navigation and the labels are web UI (HU-E9-10, HU-E9-11).`:

```markdown
- `GET /api/v1/spaces/{spaceId}/reports/spending-by-group?period=<label>` is `space.read` (every role; archived spaces read, HU-E1-09). The period is the stored period with that label, else the policy's period (D10). It sums the amount of every live expense of the space dated in it, whoever paid and from whichever account, through the same ledger sum as the line dashboard (M4 ruling P80), and places it in `rollUp(categoryId)` under the group that category sits in now. The answer holds `spaceId`, `period`, `total` and `groups[]` → `categories[]` → `subcategories[]`; groups and categories carry `id`, `key`, `name`, `archived`, `total` and `share`, subcategory entries `subcategoryId`, `name`, `archived`, `total` and `share` (rulings P75, P82). Errors: `SpaceNotFound` (404), `ValidationFailed` and `InvalidPeriodLabel` (422).
```

- [ ] **Step 2: Run the tests**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/reports-spending-by-group.test.ts`
Expected: PASS (Tasks 13, 14a and 14b drove each behaviour red first; to see each test bite, invert one expectation, run, see it fail, restore it).

- [ ] **Step 3: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/support/reporting.ts tests/acceptance/reports-spending-by-group.test.ts docs/backlog/E7-reporting.md
git commit -m "test(reporting): pin the drill-down, subcategory roll-up and moved categories over HTTP (Refs #113)"
```

---

### Task 16a: HTTP — the caller's spending by group

Implements HU-E7-06 (issue #113) over HTTP for the caller: `GET /api/v1/me/reports/spending-by-group?period=<label>`, the caller's own rows only, like HU-E7-04. Pins the `@critical` personal scenario against PostgreSQL, on the HU-E7-04 fixture of `tests/acceptance/unified-view.test.ts`, whose `background()` it reuses instead of building it again; Task 16b adds the "what is no spending" and privacy scenarios and the backlog note (this half measures 435 lines, 270 of them snapshot).

**Decisions:**
- The response is inline: `currency`, `period`, `total` and the tree of Task 15a with `space` on every group, category and subcategory entry (`{ id, name }` or null). A merged row has `id` and `space` null and its `key`; a custom row its `id` and `space` (ruling P76). Spaces in another currency are left out, as in the unified view and the personal trend; the response does not list them (ruling P82).
- The node schemas and DTO helpers of Task 15a are reused (`spendingNode`, `SubcategorySpendingSchema.extend({ space })`, `spendingNodeDto`, `subcategorySpendingDto`); reusing them in a second operation adds no component (rendered with the repository's zod-openapi: both operations inline, no new `…Output`).
- No `404`: the caller's own report has no space to hide; errors are `ValidationFailed` and `InvalidPeriodLabel` (422).

**Files:**
- Create: `src/app/api/v1/me/reports/spending-by-group/route.ts`
- Modify: `src/modules/reporting/contracts/reporting.contract.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`, `tests/support/reporting.ts`, `tests/acceptance/unified-view.test.ts`

**Interfaces:**
- Consumes: `createGetPersonalSpendingByGroup`, `GetPersonalSpendingByGroup`, `PersonalSpendingByGroup` (Task 14b); `spendingNode`, `SubcategorySpendingSchema`, `spendingNodeDto`, `subcategorySpendingDto`, `SpendingNodeDto`, `SubcategorySpendingDto` (Task 15a); `newCategoryGroup`, `newCategory` (Task 15b); `background` (Task 9a, in `unified-view.test.ts`); `ReportQuerySchema`, `moneyOf` (Task 2a); `percentOf`, `periodDto`; `getWithQuery`, `ReportPeriodDto`; `post`, `cop`.
- Produces: `SpaceRefSchema`, `PersonalSpendingByGroupSchema`, `personalSpendingByGroupDto` in `reporting.contract.ts`; `Container.reporting.getPersonalSpendingByGroup`; test support `getPersonalSpendingByGroup(user, query)`, `SpaceRefDto`, `PersonalSpendingByGroupDto`; in `unified-view.test.ts` the `describe` "personal spending by group over HTTP (HU-E7-06)" with its `breakdownOf`.

- [ ] **Step 1: Write the failing tests**

In `tests/support/reporting.ts`:

1. Insert after the line `import { GET as spendingByGroupRoute } from "@/app/api/v1/spaces/[spaceId]/reports/spending-by-group/route";`:

```ts
import { GET as personalSpendingByGroupRoute } from "@/app/api/v1/me/reports/spending-by-group/route";
```

2. Append to the end of the file:

```ts

export interface SpaceRefDto {
  id: string;
  name: string;
}
export interface PersonalSpendingByGroupDto {
  currency: string;
  period: ReportPeriodDto;
  total: MoneyDto;
  groups: (SpendingNodeDto & {
    space: SpaceRefDto | null;
    categories: (SpendingNodeDto & {
      space: SpaceRefDto | null;
      subcategories: (SubcategorySpendingDto & { space: SpaceRefDto | null })[];
    })[];
  })[];
}

/** HU-E7-06: `user` reads their own spending by group. */
export const getPersonalSpendingByGroup = (user: TestUser, query: Record<string, string>) =>
  getWithQuery(personalSpendingByGroupRoute, user, "/api/v1/me/reports/spending-by-group", query);
```

In `tests/acceptance/unified-view.test.ts` (as Tasks 9a and 9b leave it):

1. Replace the line `  getUnifiedView,` (inside the `../support/reporting` import) with:

```ts
  getPersonalSpendingByGroup,
  getUnifiedView,
  newCategory,
  newCategoryGroup,
```

2. Replace the line `  type UnifiedViewDto,` (inside the same import) with:

```ts
  type PersonalSpendingByGroupDto,
  type UnifiedViewDto,
```

3. Append to the end of the file:

```ts

describe("personal spending by group over HTTP (HU-E7-06)", () => {
  const breakdownOf = async (user: TestUser, period = "2026-11"): Promise<PersonalSpendingByGroupDto> => {
    const response = await getPersonalSpendingByGroup(user, { period });
    expect(response.status).toBe(200);
    return (await response.json()) as PersonalSpendingByGroupDto;
  };

  it("merges seeded groups across Ana's spaces by catalog key and keeps each space's Pets apart (@critical)", async () => {
    const { h } = await background();
    const vetAtHome = await newCategory(h.ana.personal, "Vet", {
      groupId: await newCategoryGroup(h.ana.personal, "Pets"),
    });
    const atHome = await post(recordExpense, h.ana.personal, "expenses", {
      description: "Vet",
      date: "2026-11-08",
      categoryId: vetAtHome,
      amount: cop(40_000),
      accountId: h.ana.account,
    });
    expect(atHome.status).toBe(201);
    const vet = await newCategory(h.ana, "Vet", { groupId: await newCategoryGroup(h.ana, "Pets") });
    const shared = await post(recordExpense, h.ana, "expenses", {
      description: "Vet",
      date: "2026-11-09",
      categoryId: vet,
      amount: cop(50_000),
      payments: [{ memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(50_000) }],
      split: { method: "EQUAL", participants: [{ memberId: h.ana.memberId }, { memberId: h.juan.memberId }] },
    });
    expect(shared.status).toBe(201);
    const breakdown = await breakdownOf(h.ana);
    expect(breakdown.total).toEqual(cop(1_640_000));
    expect(breakdown.groups.map((g) => [g.key, g.id === null, g.space?.id ?? null, g.total, g.share])).toEqual([
      ["food", true, null, cop(1_095_000), "66.77"],
      ["housing", true, null, cop(480_000), "29.27"],
      [null, false, h.ana.personal.spaceId, cop(40_000), "2.44"],
      [null, false, h.spaceId, cop(25_000), "1.52"],
    ]);
    expect(breakdown.groups.slice(2).map((g) => g.name)).toEqual(["Pets", "Pets"]);
    // Groceries of both spaces is one row under its catalog key.
    expect(breakdown.groups[0]!.categories.filter((c) => c.key === "groceries")).toMatchObject([
      { id: null, space: null, total: cop(1_035_000) },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/unified-view.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/v1/me/reports/spending-by-group/route'`.

- [ ] **Step 3: Implement**

In `src/modules/reporting/contracts/reporting.contract.ts`:

1. Insert before the line `  type LineDashboard,`:

```ts
  type PersonalSpendingByGroup,
```

2. Insert before the line `const SpacePath = z.object({ spaceId: z.string() });`:

```ts
/** HU-E7-06: the space of a personal row that does not merge, so the web UI writes "space / group" (HU-E9-11). */
const SpaceRefSchema = z.object({ id: z.string(), name: z.string() }).nullable();

/** HU-E7-06: the caller's consumption (HU-E7-04) by group, category and subcategory, every level largest first. */
export const PersonalSpendingByGroupSchema = z.object({
  /** The personal space's currency, every amount's; spaces in another currency are left out (D6). */
  currency: z.string(),
  /** The caller's personal-space period. */
  period: PeriodSchema,
  total: MoneySchema,
  /** Seeded groups and categories merge across spaces by catalog key (`id` and `space` null). */
  groups: z.array(
    z.object({
      ...spendingNode,
      space: SpaceRefSchema,
      categories: z.array(
        z.object({
          ...spendingNode,
          space: SpaceRefSchema,
          /** Listed per space: subcategories carry no catalog key (HU-E3-04). */
          subcategories: z.array(SubcategorySpendingSchema.extend({ space: SpaceRefSchema })),
        }),
      ),
    }),
  ),
});

export const personalSpendingByGroupDto = (
  report: PersonalSpendingByGroup,
): z.infer<typeof PersonalSpendingByGroupSchema> => ({
  currency: report.currency,
  period: periodDto(report.period),
  total: moneyOf(report.total, report.currency),
  groups: report.groups.map((group) => ({
    ...spendingNodeDto(group, report.currency),
    space: group.space,
    categories: group.categories.map((category) => ({
      ...spendingNodeDto(category, report.currency),
      space: category.space,
      subcategories: category.subcategories.map((entry) => ({
        ...subcategorySpendingDto(entry, report.currency),
        space: entry.space,
      })),
    })),
  })),
});

```

3. Insert before the last line of the file (`};`, the end of `reportingPaths`):

```ts
  "/api/v1/me/reports/spending-by-group": {
    get: {
      operationId: "getPersonalSpendingByGroup",
      summary: "The caller's consumption in a personal period by category group, category and subcategory",
      description:
        "The unified view's consumption, from the caller's own member rows only. Seeded groups and categories merge across spaces by catalog key and carry no id; custom ones keep their id and space.",
      ...securedByUser,
      requestParams: { query: ReportQuerySchema },
      responses: {
        "200": {
          description: "The caller's groups with consumption, largest first, in the personal space's currency",
          content: jsonContent(PersonalSpendingByGroupSchema),
        },
        ...problems({ "401": "Unauthenticated", "422": "ValidationFailed, InvalidPeriodLabel" }),
      },
    },
  },
```

`src/app/api/v1/me/reports/spending-by-group/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { personalSpendingByGroupDto, ReportQuerySchema } from "@/modules/reporting/contracts/reporting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: ReportQuerySchema,
  handler: async ({ user, query }) => {
    const result = await getContainer().reporting.getPersonalSpendingByGroup({
      userId: user!.id,
      period: query.period,
    });
    return result.ok ? ok({ status: 200, body: personalSpendingByGroupDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert before the line `  type GetLineDashboard,`:

```ts
  createGetPersonalSpendingByGroup,
  type GetPersonalSpendingByGroup,
```

2. Insert after the line `    readonly getSpendingByGroup: GetSpendingByGroup;`:

```ts
    readonly getPersonalSpendingByGroup: GetPersonalSpendingByGroup;
```

3. Insert after the line `      getSpendingByGroup: createGetSpendingByGroup(reportingDeps),`:

```ts
      getPersonalSpendingByGroup: createGetPersonalSpendingByGroup(reportingDeps),
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds only `GET /api/v1/me/reports/spending-by-group` (about 271 lines); no component is added or changed.
Then run: `pnpm exec vitest run --project acceptance tests/acceptance/unified-view.test.ts tests/acceptance/reports-spending-by-group.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/me/reports/spending-by-group/route.ts src/modules/reporting/contracts/reporting.contract.ts src/composition/container.ts openapi/openapi.snapshot.json tests/support/reporting.ts tests/acceptance/unified-view.test.ts
git commit -m "feat(reporting): serve the caller's spending by group over HTTP (Refs #113)"
```

---

### Task 16b: HTTP — what is no spending, and the caller's own rows only

Completes HU-E7-06 (issue #113) over HTTP: an income, a transfer between Ana's own accounts, a settlement and the fund contribution count in no group, in Ana's breakdown or in Household's, while the rent paid from the fund counts once; Juan's personal expense never reaches Ana's breakdown; and the personal endpoint's errors. The behaviour was test-driven in Task 7 (`consumptionByCategory` sums live expenses only, of the given member ids), Task 13 (a contribution and a transfer in SQL) and Task 14b (the total equals the unified view's), so these tests pass on their first run; each pins one HTTP-observable outcome. Adds the backlog note.

**Decisions:**
- One test reads both breakdowns after the same movements, so "her total spending equals her consumption" is compared with the unified view itself, and Household's 3,500,000 COP shows the fund's rent counted once.

**Files:**
- Modify: `tests/acceptance/unified-view.test.ts`, `docs/backlog/E7-reporting.md`

**Interfaces:**
- Consumes: `background`, `viewOf`, `spendAtHome` (Tasks 9a, 9b, in the test file); `breakdownOf` (Task 16a, in the test file); `getPersonalSpendingByGroup` (Task 16a); `getSpendingByGroup`, `SpendingByGroupDto` (Task 15a); `newAccount`, `categoryWithKey`, `post`, `cop`; `problemOf`; the routes `POST …/incomes`, `POST …/transfers`, `POST …/settlements`.
- Produces: nothing new.

- [ ] **Step 1: Write the tests**

In `tests/acceptance/unified-view.test.ts`:

1. Insert after the line `import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";`:

```ts
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
```

2. Replace the line `  getPersonalSpendingByGroup,` (inside the `../support/reporting` import) with:

```ts
  getPersonalSpendingByGroup,
  getSpendingByGroup,
```

3. Replace the line `  type PersonalSpendingByGroupDto,` (inside the same import) with:

```ts
  type PersonalSpendingByGroupDto,
  type SpendingByGroupDto,
```

4. Insert before the last line of the file (`});`, the end of the `describe` of Task 16a):

```ts

  it("counts no income, transfer, settlement or fund contribution as spending, in Ana's breakdown or Household's", async () => {
    const { h } = await background();
    const income = await post(recordIncome, h.ana.personal, "incomes", {
      description: "Salary",
      date: "2026-11-05",
      categoryId: await categoryWithKey(h.ana.personal, "salary"),
      amount: cop(3_000_000),
      accountId: h.ana.account,
    });
    expect(income.status).toBe(201);
    const transfer = await post(recordTransfer, h.ana.personal, "transfers", {
      date: "2026-11-05",
      amount: cop(200_000),
      sourceAccountId: h.ana.account,
      destinationAccountId: await newAccount(h.ana.personal, "Nequi", 0),
    });
    expect(transfer.status).toBe(201);
    const settlement = await post(recordSettlement, h.juan, "settlements", {
      date: "2026-11-30",
      amount: cop(100_000),
      payerMemberId: h.juan.memberId,
      receivingMemberId: h.ana.memberId,
    });
    expect(settlement.status).toBe(201);
    const mine = await breakdownOf(h.ana);
    expect(mine.total).toEqual(cop(1_575_000));
    expect(mine.total).toEqual((await viewOf(h.ana)).consumption.total);
    // No Income group, and the 480,000 COP fund contribution of 2026-11-01 is in no group.
    expect(mine.groups.map((g) => g.key)).toEqual(["food", "housing"]);
    const response = await getSpendingByGroup(h.ana, h.spaceId, { period: "2026-11" });
    const shared = (await response.json()) as SpendingByGroupDto;
    // The 1,200,000 COP rent paid from Household Fund counts once.
    expect(shared.total).toEqual(cop(3_500_000));
    expect(shared.groups.map((g) => [g.key, g.total, g.share])).toEqual([
      ["food", cop(2_300_000), "65.71"],
      ["housing", cop(1_200_000), "34.29"],
    ]);
  });

  it("never includes Juan's personal expense in Ana's breakdown, and refuses a missing period and a foreign label", async () => {
    const { h } = await background();
    await spendAtHome(h.juan, "groceries", 90_000, "2026-11-06");
    expect((await breakdownOf(h.ana)).total).toEqual(cop(1_575_000));
    // Juan's 90,000 COP and his shares: 1,200,000 Home, 720,000 Rent and 150,000 market.
    expect((await breakdownOf(h.juan)).total).toEqual(cop(2_160_000));
    expect(await problemOf(await getPersonalSpendingByGroup(h.ana, {}))).toEqual([422, "ValidationFailed"]);
    expect(await problemOf(await getPersonalSpendingByGroup(h.ana, { period: "2026-11 H1" }))).toEqual([
      422,
      "InvalidPeriodLabel",
    ]);
  });
```

In `docs/backlog/E7-reporting.md`, insert after the line that Task 15b added (it starts with `- `GET /api/v1/spaces/{spaceId}/reports/spending-by-group?period=<label>` is `space.read``):

```markdown
- `GET /api/v1/me/reports/spending-by-group?period=<label>` groups the caller's consumption exactly as `GET /api/v1/me/unified-view` sums it: their own member rows only, their personal period (its stored period first, D10) and the personal space's currency, spaces in another currency left out (D6, M4 ruling P37). It answers `currency`, `period`, `total` and the tree of the space breakdown with `space` (`{ id, name }` or null) on every node. A seeded group, or a seeded category inside a group row, merges across spaces by catalog key (`id` and `space` null) and takes the name the caller's personal space gives that key when the personal space holds it, else the name in the space with the most spending in the row; custom rows and subcategories keep their `id` and `space`; under a merged category the entry without a subcategory sums every space's spending in the category itself (rulings P76, P81). Errors: `ValidationFailed` and `InvalidPeriodLabel` (422).
```

- [ ] **Step 2: Run the tests**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/unified-view.test.ts`
Expected: PASS (Tasks 7, 13 and 14b drove each behaviour red first; to see each test bite, invert one expectation, run, see it fail, restore it).

- [ ] **Step 3: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/acceptance/unified-view.test.ts docs/backlog/E7-reporting.md
git commit -m "test(reporting): pin that only expenses count and only the caller's rows are read (Refs #113)"
```

---

## Self-Review

### Story coverage

| Story (issue) | Scenario or technical note | Domain / application test | PostgreSQL / HTTP test |
|---|---|---|---|
| HU-E7-01 (#56) | Planned, spent and available per line, Unbudgeted −60,000 COP (@critical @golden) | Task 1 "reports planned, spent and available per line …" | Task 2a (golden over HTTP, 2026-11-30 counted, 2026-12-01 not) |
| | Overspent line is flagged (Home −130,000 COP) | Task 1 | Task 2b |
| | Available includes carry-over (ROLLOVER, 200,000 → 370,000 COP) | Task 1 (the chain read by `loadPlanView`) | — (M3-B Task 12 pins carry-over over HTTP; the dashboard returns the same figure) |
| | Month without a plan: all spending Unbudgeted, `plan: null` | Task 1 | Task 2b |
| | Notes: `GetLineDashboard`, `GET …/reports/lines?period=`, `planned`/`spent`/`available`/`overspent`, `plan: null`, the RolloverCalculator | Task 1 (catch-all, DRAFT, viewer, archived, labels) | Tasks 2a, 2b |
| HU-E7-02 (#57) | Matrix values for a DIRECT line (Home 588,000 / 900,000 / 520,000 / 312,000) (@critical @golden) | Task 3 (domain), Task 5 (use case) | Task 4 (the sums in SQL), Task 6a (BY_ALLOCATION expenses over HTTP) |
| | Shared-fund lines defer contribution to the fund (`TRACKED_AT_FUND_LEVEL`) | Tasks 3, 5 | Task 6a |
| | Positive gap means over-contribution (`OVER_CONTRIBUTED`) | Tasks 3, 5 | Task 6a |
| | Lines without allocation show only consumption (`NOT_ALLOCATED`, 25,000 / 25,000 COP) | Tasks 3, 5 | Task 6a |
| | Viewer can read the matrix | Task 5 (Sofi) | Task 6a |
| | Notes: `GetMemberLineMatrix`, `GET …/reports/member-matrix?period=`, codes, spec 5.4 metrics, golden fixture | Tasks 3, 5 (SAVINGS, invalid allocation, catch-all, P7, a subcategory's sums on its parent's line, P96) | Tasks 4, 6a |
| HU-E7-03 (#58) | Expected versus actual (Juan −220,000 COP) (@golden) | Task 3, Task 5 | Task 4, Task 6b |
| | Contributions outside the period are excluded | Task 5 (the period's dates are asked) | Task 4 (2026-10-31 in SQL), Task 6b |
| | Plan without shared-fund lines: every member expected 0 | Tasks 3, 5 | Task 6b |
| | Notes: `GetFundContributions`, `GET …/reports/fund-contributions?period=`, the two formulas | Tasks 3, 5 | Tasks 4, 6b |
| HU-E7-04 (#59) | Total consumption includes shares across spaces; Groceries under the key `groceries` with 1,035,000 COP (@critical) | Task 8a (grouping), Task 8b | Task 7 (the sums in SQL), Task 9a |
| | Cash out versus consumption: 2,625,000 COP with the 480,000 COP contribution (@critical) | Tasks 8a, 8b | Tasks 7, 9a |
| | Other members' personal spaces are never included | Task 8b (only Ana's member ids are asked) | Task 7 (Pedro's own expense counts for nobody else), Task 9b (Juan's 90,000 COP) |
| | Shared expenses are placed in the viewer's personal period (MONTHLY(1) vs MONTHLY(25), 2026-11-26) | Task 8b (the personal period, a stored one first) | Task 9b (Casa counts it in its 2026-12) |
| | Notes: `GetUnifiedPersonalView`, `GET /api/v1/me/unified-view?period=`, current and former rows, claimed guest places, catalog keys and "space / category", cash out formula, D11 | Tasks 8a, 8b (custom categories, savings transfers, outside the app, other currencies) | Task 7 (`placesOf`), Task 9b |
| | Note (M3-D): a subcategory groups under its parent category, under the parent's catalog key or as the parent's "space / category" row (P95) | Task 8a (Verduras under `groceries`, Vet in Household's Pets), Task 8b | — (the roll-up is domain logic; Task 9a pins the shape over HTTP) |
| | Note (M3-D): a merged row takes its name from the viewer's personal space, else from the space with the most spending (P76, P95) | Task 8a ("Groceries" over "Mercado", "Cabin" by the most spending), Task 8b | Task 9a (`name` as Ana's personal space names each key) |
| HU-E1-11 (#20, closed) | The unified view of Pedro includes his 100,000 COP Hotel share; no shares from "Trip 2026" | Task 7 (`placesOf` keeps the claimed row) | Task 9b |
| HU-E7-05 (#60) | Line change versus the previous period (Home −50,000 COP, −3.70 %) | Task 10 (`changeFrom`), Task 11 | Task 12a |
| | Semi-monthly periods compare with the previous half-month | Task 10 (the window), Task 11 (+100,000 / 25.00 % and −50,000 / −10.00 %) | — (the window is policy logic; Task 12a pins the query and the rendering) |
| | Six-period personal consumption series | Task 11 | Task 12b |
| | Line without a previous period: `NEW`, no percentage | Tasks 10, 11 | Task 12a (Pets) |
| | Notes: `GetLineTrend`, `GetPersonalTrend`, both endpoints, previous period of the same policy, two decimals, `NEW` on division by zero, default window 6 | Tasks 10, 11 | Tasks 12a, 12b (default 6, 1–24, labels) |
| HU-E7-06 (#113) | Group totals for a space in a period: 2,810,000 COP; Housing 56.94 %, Food 34.16 %, Leisure 8.90 %; Transport not listed; VIEWER Sofi gets the same (@critical) | Task 14a (the fold), Task 14b (Sofi, the period, Household's tree only) | Task 13 (the tree and the sums in SQL), Task 15a (2026-12-01 out) |
| | Drill down from a group to its categories (Groceries 93.75 %, Restaurants 6.25 %) and from Groceries to its subcategories (no subcategory 50.00 %, Vegetables 30.00 %, Meat 20.00 %) | Task 14a | Task 15b (subcategories created over HTTP) |
| | An expense in a subcategory counts in its category and its group, once (Food 185,000 COP, Groceries 125,000 COP with Vegetables 40,000 COP) | Task 13 (`placeIn`), Task 14a, Task 14b (2026-10) | Task 13 (the ledger keeps the subcategory's own id), Task 15b |
| | The personal breakdown merges seeded groups across spaces and keeps custom groups apart: 1,640,000 COP; Food 66.77 %, Housing 29.27 %, Pets of Personal 2.44 %, Pets of Household 1.52 %; one Groceries row of 1,035,000 COP (@critical) | Task 14a, Task 14b (only Ana's rows, her personal period, her personal tree) | Task 16a |
| | Incomes, transfers, settlements and fund contributions are not spending: Ana's 1,575,000 COP equals her consumption; Household's 3,500,000 COP (Food 65.71 %, Housing 34.29 %) counts the fund's rent once | Task 14b (equal to the unified view's total) | Task 13 (a contribution and a transfer in SQL), Task 16b |
| | A moved category counts under its current group: November Food 32.03 %, Leisure 11.03 %; October's 30,000 COP Restaurants in Leisure | Task 14a | Task 13 (`treesOf` after a move), Task 15b (moved over HTTP) |
| | Notes: both queries and endpoints, `space.read` (VIEWER, archived, `SpaceNotFound`), `period` required, `InvalidPeriodLabel`, the personal period; what counts; the current tree, `rollUp`, archived nodes flagged, nodes without spending omitted, an empty period; the response shape, shares half up per level, the entry without a subcategory, the ordering; personal rows (key and no id, custom id and space, subcategories per space, one category under two groups, the P76 name); the group key only read | Task 13 (keys, archived, deleted, several spaces), Task 14a (ordering, archived, empty, rounding, P76 names, two group rows), Task 14b (archived space, Marta, malformed id, labels, other currencies) | Task 13 (`treesOf`), Task 15a (errors, an empty period), Task 16b (Juan's personal expense, errors) |

No scenario of HU-E7-01 … HU-E7-06 is left without a test. M3-C's stories, E8 and E9 are not planned here (see Out of scope).

### Review Focus pins

| Review Focus | Pinned by |
|---|---|
| 1. Members who left, rejoined, guests and viewers | Task 3 "lists only the members it is given …"; Task 5 "lists every current member in join order for VIEWER Sofi, guests included, and nobody who left" and the fund test with `member-luis`; Task 6a (Sofi on target with 0); Task 7 `placesOf` (a left row, a claimed row); Task 9b (Pedro's history after his claim) |
| 2. Period labels, edges and policies | Task 1 (labels refused, a period without a plan); Task 2a (2026-11-30 in, 2026-12-01 out); Task 2b ("2026-11 H1"); Tasks 4 and 7 (2026-10-31 and 2026-12-01 in SQL); Task 8b (a stored personal period); Task 9b (MONTHLY(25) Casa); Task 10 (SEMI_MONTHLY and stored windows); Task 11 (a period without a plan inside the window) |
| 3. Privacy between members | Task 5 (Luis's account on the SAVINGS line credits nobody); Task 7 (sums by member ids only); Task 8b (only Ana's rows asked, `acc-juan-savings` filtered); Task 9b (Juan's personal expense) |
| 4. Money signs and rounding | Task 3 (negative gaps and differences); Task 4 (fund payment, soft deletes); Task 7 (outside the app, soft deletes); Task 10 (half away from zero, 0 previous); Task 12a ("-3.70" on the wire) |
| 5. Identifiers from elsewhere, archived spaces and currencies | Task 1 (malformed id, Marta, archived Household); Task 2b (malformed id over HTTP); Task 5 (Marta); Task 8b (a USD trip, an unknown user); Task 12a (Marta); Task 13 (`treesOf` with a malformed id); Task 14b (archived Household, Marta, a USD trip); Task 15a (Marta, malformed id) |
| 6. Category trees changed under existing data | Task 13 (`treesOf`: Restaurants moved and archived, a deleted category, a custom group, a subcategory; `placeIn`); Task 14a (moved Restaurants in November and October, equal totals of Auto and an archived bills, renamed seeded groups, a key only Household and Trip hold, Restaurants under two groups); Task 15b (subcategories and a move over HTTP); Task 5 (Vegetables' payments and shares on Home, P96); Tasks 8a and 8b (Verduras and Vet counted in their categories, P95) |

### Spec contradictions found

1. **Spec section 4** ("Free is the catch-all line") **vs HU-E7-01's golden table**, which maps Entertainment to Free explicitly and reports Restaurants under an "Unbudgeted" line, possible only without a catch-all line (HU-E6-04). **Ruled by the controller (P34):** accepted that the E7 fixture's Free is not the catch-all (as `referencePlan()` already builds it, "no catch-all yet"), that `unbudgeted` (`spent`, `available` = −spent, `overspent`) is present exactly when the plan has no catch-all line, as in `BudgetPlan`, that `overspent` means available < 0 for lines and `unbudgeted` alike, and that HU-E4-13's note ("may be returned by the line dashboard as expected") is not taken in M4: pending occurrences never count as spent and the dashboard's scenarios name none. The alternative is a catch-all Free that also consumes Restaurants (310,000 COP) and a golden table without Unbudgeted.
2. **Spec 5.4** ("SAVINGS lines: Σ transfers by m into the line's savings accounts") **vs HU-E4-03** (a transfer between one's own accounts records no paying member). **Ruled by the controller (P35):** accepted that a transfer into an account a SAVINGS line names is credited to that account's owner, who is the only one who can move money into their own account, and only for accounts of current registered members (P8); that `consumed` is null on SAVINGS lines (spec 5.4: "not applicable"); that a SHARED_FUND line keeps showing `assigned` while `contributed` and `gap` are null (`TRACKED_AT_FUND_LEVEL`), an invalid allocation shows `contributed` with `assigned` and `gap` null (`INVALID_ALLOCATION`), and a NONE line only `consumed` (`NOT_ALLOCATED`); statuses `OVER_CONTRIBUTED`, `UNDER_CONTRIBUTED`, `ON_TARGET`; the matrix lists the plan's lines only (no Unbudgeted row) and no line without a plan. The alternative is a new payer column on plain transfers, a migration for a figure the account owner already determines.
3. **HU-E7-04** (one total across every space) **vs D6** (one currency per space, multi-currency deferred to HU-E8-06). **Ruled by the controller (P37):** accepted that the unified view and the personal trend are in the personal space's currency, that spaces in another currency are left out of every sum and listed once in `otherCurrencySpaces`, that the caller's places are every member row linked to them (left rows, claimed guest places and archived spaces included: "where u is or was a member"), that savings transfers are the live transfers into the caller's own SAVINGS accounts dated in the period whatever their source (a move between two of the caller's savings accounts counts too; a transfer into an INVESTMENT account is not one, ruling P97), that settlements are not cash out (spec 5.4 names payments, fund contributions and savings transfers only), that `outsideTheApp` is the part of payments and contributions without an account, and that groups come largest first. The alternative is one total per currency, which HU-E8-06 would have to redesign anyway.
4. **HU-E7-05's two `NEW` cases** ("division by zero" and "a line without a previous period") **and its silence on how a line is found in earlier plans.** **Ruled by the controller (P38):** accepted that the line trend follows the lines of the end period's plan, each traced back by its origin link (as carry-overs, P15) and else by its name, case ignored; that a point's `spent` is null where the line has no figure; that `NEW`, with change and percentage null, covers a missing previous figure and a previous figure of 0 alike; that percentages are basis points rounded half away from zero, rendered as signed two-decimal strings; that the window reads one more period than it shows so the first period shown is compared too; that `periods` runs from 1 to 24 (the `GET …/periods` bound) with 6 by default; that the personal trend is the unified view's consumption per personal period; and that unbudgeted spending and lines the end plan no longer has are not trended. The alternative is matching by name only, which loses a renamed line, or by origin only, which marks every line of a plan created without copying as `NEW`.

### Assumptions

1. **Reuse instead of new derivations** (Tasks 1, 5, 11). Reporting's application imports budgeting's `loadPlanView` and `lineForCategory` through budgeting's public API and binds the same adapters budgeting uses; the ledger, spaces, categories and accounts implement reporting's ports with their own types; nothing imports reporting. **Ruled by the controller (P32):** accepted; no table, no migration, no stored read model (D7). The alternative is reporting SQL over the other modules' tables, which `modules-only-through-public-application-api` forbids and which would derive every plan figure a second time.
2. **The plan a report reads** (Tasks 1, 5, 11). The period is resolved by `periodByLabel` with the space's stored periods (D10); the plan is the one covering its first day, whatever its status, so a DRAFT plan reports too (like P15). **Ruled by the controller (P33):** accepted; the alternative is reporting only ACTIVE and CLOSED plans, which would hide a plan being prepared.
3. **Fund tracking** (Tasks 3, 4, 5). Expected sums the assigned amounts over the plan's SHARED_FUND lines (a NONE line or an invalid allocation assigns nothing, no plan expects 0); actual counts the live fund contributions recorded in the space and dated in the period, into any of its funds, those from outside the app included; current members only. **Ruled by the controller (P36):** accepted; the alternative is counting contributions by the fund account a SHARED_FUND line would name, which lines do not carry.
4. **Endpoints and errors** (Tasks 2a, 6a, 6b, 9a, 12a, 12b). `period` and `endPeriod` are required (no default to the current period); no pagination; no new error code; every response schema inline, so no component is added. **Ruled by the controller (P39):** accepted; the alternatives (a default period, registered `Report*` components) add contract surface no scenario needs.
5. **Request cost** (Tasks 1, 11, 13). The line trend reads `periods + 1` plan views (up to 25 at `periods=24`). Since P105 the views share one request-scoped cache of plan figures by plan id, so each plan's figures, carry-over chain included, are computed once per request: O(window + chain) computations of about 3–4 queries each. Before P105 each view re-walked the whole carry-over chain, so the cost grew with window × chain (final review I1; preflight N8 counted views, not chain walks). The unified view lists the categories of the personal space and of each space with consumption (ruling P95), and the personal spending by group reads the trees of those spaces in one statement (Task 13). The cost still grows with the length of the plan chain, so follow-up 2 measures it before M6 (D7).
6. `cashOut` is one statement over two derived tables (payments and contributions), so its parts are consistent with each other. The unified view's consumption, cash out and savings transfers are still separate reads, so a write between them could show one and not the other in one answer; acceptable for a read report (balances keep their single-statement guarantee).
7. Every user has a personal space (HU-E1-02); a user without one gets `SpaceNotFound` from the `/me` reports, which no flow can reach.
8. A member who left a space and joined again has two member rows; both feed the unified view, and a space in another currency is listed once.
9. **HU-E7-06's group key and modules** (Tasks 13, 14a). **Ruled by the controller (P74, as amended):** accepted that the seeded groups' catalog key (`housing`, `food`, `transport`, `health`, `leisure`, `income`) ships in M3-D (HU-E3-05: Task 17a and the back-fill of `0017_category_styles`) and that HU-E7-06 only reads it; reporting reaches the categories module through its own port (`CategoryTrees`, Task 13).
10. **Periods, shares and the spending recorded in a category itself** (Tasks 14a, 15a). **Ruled by the controller (P75):** accepted that the endpoints take `period=<label>`, that each share is of the parent's total and rounded half up on each level, that a null-subcategory entry holds the spending recorded directly in a category, and that nodes without spending are omitted.
11. **Merged personal rows** (Task 14a). **Ruled by the controller (P76):** accepted that a merged row is named from the viewer's personal space, else from the space with the most spending, that subcategories never merge across spaces, and that HU-E7-04 takes the same rule (P95 applies it to the unified view).
12. **Group keys and their matching** (Task 13). **Ruled by the controller (P77):** accepted that a group's key is the one M3-D's back-fill gives it (from the seeded categories it holds, then its exact Spanish or English name, else none), so a group without one shows as "space / group".
13. **Sums reused, only the tree read anew** (Tasks 13, 14b). Neither breakdown sums anything of its own: a space's reads `PlanSpending.expensesByCategory` (the amount of every live expense, whoever paid, the fund's once), the caller's the unified view's `consumptionByCategory` rows through `consumptionRows`, and both place them in the trees `CategoryTrees.treesOf` reads in one statement (categories with the group they sit in now, not deleted, archived included). **Ruled by the controller (P80):** accepted; the alternative is one SQL statement joining transactions with the category tables, which `modules-only-through-public-application-api` forbids in the ledger and which would derive the unified view's consumption a second time.
14. **Merged rows at their edges** (Task 14a). The personal space's name wins whenever its tree holds the key, even without spending there (else the most spending, ties by space name, then id); a merged row is `archived` only when every space spending in it archived it; under a merged category the entry without a subcategory sums every space's spending in the category itself (one entry, `space` null) while subcategory entries keep their `space`; a row whose category the tree no longer holds is left out (D8 and P48 keep used categories, so none). **Ruled by the controller (P81):** accepted; the alternative, always the name of the space with the most spending, would rename a row from one period to the next.
15. **Response shapes and order** (Tasks 14a, 15a, 16a). One domain shape serves both breakdowns; a space's response keeps `id` nullable and carries no `space`; the personal response carries `currency` and, like the personal trend, does not list the spaces in another currency (the unified view does); `share` goes out through the existing `percentOf`; ties order by name with `localeCompare(…, "es", { sensitivity: "accent" })` (case ignored, accents not), then space name, then id. **Ruled by the controller (P82):** accepted; the alternative, one response schema with `space` everywhere, adds about 80 snapshot lines for a field a space's own breakdown never fills.
16. **M3-D under Tasks 1 – 12b** (header, Baseline; Tasks 1, 2a, 8a, 8b, 9a, 9b). M3-D's Task 10 added `categories: BudgetCategories` to `PlanViewDeps`, and HU-E7-04's new notes ask the unified view to roll subcategories up and to name merged rows. **Ruled by the controller (P83, resolved by P95):** accepted as the preflight proposed: `ReportingDeps` carries budgeting's own `categories`, bound to `budgetCategories`, and `planViewIn` passes `deps` straight to `loadPlanView`; Task 8b's port is `PersonalDeps.catalog: ReportCategories`, which also returns `parentCategoryId`, bound to `categoriesDeps.categories` with no new adapter code; `consumptionGroups` counts a subcategory's consumption in its parent category (under the parent's key, or in the parent's "space / category" row; a subcategory whose parent is not listed counts as its own); every group carries `name` (`consumption.categories[].name` on the wire, and `category.name` equals it for custom rows): a merged group's is the one its key has in the caller's personal space whenever that space holds the key, even without consumption there (as P81 rules for HU-E7-06), else the one in the space with the most consumption in the group, ties by space name, then space id, and a custom group's is its own; Tasks 13 – 16b keep the port `trees`. The alternative is placing the unified view's rows through `CategoryTrees` and `placeIn`, which needs Task 13 before Task 8a and rebases Tasks 8a – 12b on it, a wider change for the same behaviour.
17. **The member matrix under subcategories** (Task 5). **Ruled by the controller (P96):** accepted that the matrix counts a subcategory's payments and shares on the line its parent category consumes (`rolledUpCategory` before `lineForCategory`), exactly as `loadPlanView` counts its spending, so the matrix and the dashboard agree on every line (HU-E3-04, P48, P93). The alternative, the raw category id, puts a subcategory's money on no line or on the catch-all line.
18. **Investment accounts and cash out** (Tasks 8b, 9a). **Ruled by the controller (P97):** accepted that cash out counts transfers into the caller's own SAVINGS accounts only (P37 as written, spec 5.4's "savings transfers"): `savingsAccountsOf` keeps `type === "SAVINGS"`, so a transfer into an INVESTMENT account, a type M3-D added, is not cash out in v1. The alternative counts every account the caller saves in, which spec 5.4 does not name.
19. **A period with no plan in a line's trace** (Task 10, execution). **Ruled by the controller (P98):** accepted that, walking back, a period with no plan at all is skipped: the next earlier plan is matched against the nearest later line found (its origin link, else its name), not against the end line's name. Only a plan that exists and holds no matching line ends the chain, and the walk then falls back to the end line's own name (P38 as written). Reason: no plan is missing data, not a removed line; `[[House h0], null, [House h2], [Home h3←h2]]` must trace h0.
20. **A name match and a line another line continues** (Task 10, execution). **Ruled by the controller (P99):** accepted that a name match in an earlier plan skips a line that some other line of the later plan (the one the trace came from) names as its origin. Reason: when "House" is renamed "Home" and a new "House" is added, the new "House" is NEW, and the old spending is not counted twice.
21. **A percentage beyond 2^53 basis points** (Task 12a, execution). **Ruled by the controller (P100):** accepted that `changePercent` is null when the change is NEW, or when its basis points exceed `Number.MAX_SAFE_INTEGER` (a change above about 90 trillion percent, e.g. 1 minor unit to 9e11). The amount and status are still answered. The schema describes both cases. Reason: such figures do not occur in real use, and widening `Change.basisPoints` to bigint would reopen Tasks 10–11 for no user-visible gain.
22. **A keyed subcategory and a merged row's name** (Task 13 review, for Task 14a). **Ruled by the controller (P101):** accepted that, when a report names a row merged by catalog key from the personal space, only top-level categories (no parent) lend their name. A seeded category moved under another keeps its key (spec 5.2) but counts in its parent, so it never names the row of its key. Same rule as the unified view (P95, Task 8a's "rent group named Cabin" test).
23. **Which personal rows lose their id and space** (Task 14a review). **Ruled by the controller (P102):** accepted that, in the personal breakdown, a category row has `id` and `space` null and the personal space's name only when it is a merged row: a keyed category inside a merged (keyed) group row. Inside a custom group row, which always belongs to one space, every category, a seeded one moved there included, keeps its `id`, its `space` and its own name.
24. **The own-spending entry and archiving** (Task 14a review). **Ruled by the controller (P103):** accepted that the entry for the spending recorded in a category itself (`subcategoryId` and `name` null) answers `archived: false`; the category row above it carries the category's archived flag.
25. **The own-spending entry carries no space** (Task 16a review). **Ruled by the controller (P104):** accepted that, in the personal breakdown, the entry for what was spent in a category itself (`subcategoryId` null) answers `space: null` in every case; the category row above it carries the category's space (or null when the category is merged). The entry is not a node of any tree, so it names no space of its own. Same reasoning as P103.
26. **One request computes each plan once** (final review I1). **Ruled by the controller (P105):** accepted that, within one request, plan figures are shared by plan id: the line trend (and any report that loads several plan views) passes one request-scoped cache to `loadPlanView`, so the carry-over chain walk reuses figures already computed. A request then costs O(window + chain) plan computations, not O(window × chain). Pinned by a test that counts plan loads. The alternative, materializing the figures (D7), waits for a measurement (follow-up 2).
27. **One naming tie-break for every personal report** (final review M3). **Ruled by the controller (P106):** accepted that the unified view and the personal spending by group break naming ties the same way: the space name in Spanish collation ignoring case (`localeCompare(…, "es", { sensitivity: "accent" })`), then the space id (P82, P95). The same catalog key always gets the same name in both.

### Follow-ups

1. Pending occurrences as "expected" on the line dashboard (HU-E4-13 note), now that M3-C's occurrences exist (P34).
2. Measure report latency before M6, with the line trend at `periods=24` over a 24-plan ROLLOVER chain and the unified view at household scale (preflight N8, now with P105's request-scoped cache), and materialize or cache report figures if they measure slow (D7). The M6 Core Web Vitals budgets for the HU-E9-10 and HU-E9-11 dashboards depend on it. **Resolved 2026-10-25 (issue #128), ruled by the controller (P249):** the request cost is bounded and pinned deterministically rather than by a wall-clock figure, because the repository's test rule forbids clocks and network in committed tests. The line trend at `periods=24` over a 30-plan ROLLOVER chain reads each plan once—`contents` 30×, `find` 29×, `expensesByCategory` 30×, `members` 1× (`src/modules/reporting/application/trend.test.ts`, the `it.each([6, 24])` P105 pin), confirming O(window + chain) of about 3–4 small indexed queries each and no duplicate computation under the `Promise.all` fan-out, which `planViewCache` dedupes by caching the in-flight promise by plan id (`src/modules/budgeting/application/plan-view.ts`). The unified view and the personal spending by group read each space's tree and expenses once (`cash-flow.test.ts`, `spending-by-group.test.ts`). No report figures are materialized or cached (D7 stands); should a VPS benchmark ever contradict this bound, caching reopens as a new change. The alternative, a committed wall-clock benchmark, breaks the no-clock test rule and depends on host hardware.

   Accepted on this machine with no disposable PostgreSQL (Docker off) and no credentials for the local server, so the VPS-like wall-clock run was not executed; the deterministic read-count pins above are the measurement of record.
3. Multi-currency unified view with HU-E8-06 (P37).
4. Trends of unbudgeted spending and of lines the end period's plan no longer has (P38).
5. A default `period` and `endPeriod` (the current period of the policy) if the web UI (HU-E9-10, HU-E9-11) needs them (P39).
6. Move HU-E7-01 … HU-E7-06 to `Done` in `docs/backlog/README.md` when the pull request merges.
7. Resolved by the preflight: the unified view's subcategory roll-up and merged-row names (HU-E7-04's new notes) ship in Tasks 8a, 8b and 9a (P95, resolving P83).
8. A catalog key for groups users create, or matching them by name, if "space / group" rows prove noisy in the personal breakdown (P77).
9. Whether transfers into the caller's own INVESTMENT accounts count as cash out after v1 (P97).
10. A personal seeded group with no live category cannot lend its name to a merged row (P81 edge): `treesOf` lists categories, not empty groups, so the row is named from the space with the most spending. Fixing it needs the port to list groups too (Task 13, Task 14a).
11. Acceptance cases still missing for the 401 of the lines, matrix and fund-contributions routes, and a pin that a `userId` in a `/me/...` query is ignored. Low risk, because `defineRoute` is shared and every `/me/...` route passes only the session's user id.
12. Duplicate labels inside a trend window: a stored period "2026-10" running Oct 5 – Nov 4 sits next to a derived Oct 1–4 stub also labelled "2026-10". The spec is silent. `points[].period` is a bare label, but the `periods` array is index-aligned and carries the dates, so a client can tell them apart.

### Placeholder and consistency scan

- No "TBD", "TODO", "similar to Task N" or step without its code; every code step names its file and anchor, every test step its command and expected outcome. No placeholder remains: HU-E7-06's issue exists as `#113`, which Tasks 13 – 16b, the task-to-issue map and the pull request name.
- Names used across tasks match their definitions: `PlanViewDeps`, `loadPlanView` (budgeting, Task 1), `lineForCategory`, `rolledUpCategory` (budgeting, Task 5); `ReportingDeps`, `SpaceReportInput`, `SpaceReport`, `ReportPlan`, `planViewIn`, `spaceReport`, `reportPlanOf`, `DashboardLine`, `UnbudgetedSpending`, `LineDashboard`, `GetLineDashboard`, `createGetLineDashboard` (Task 1); `MATRIX_REASONS`, `MatrixReason`, `GAP_STATUSES`, `GapStatus`, `LineSums`, `MatrixCell`, `MatrixRow`, `gapStatus`, `matrixRow`, `FundLine`, `FundContribution`, `fundContributions` (Task 3); `memberSumsByCategory`, `fundContributionsByMember` (Task 4); `SpaceMemberSums`, `MemberSumsDeps`, `MatrixLine`, `MemberLineMatrix`, `GetMemberLineMatrix`, `createGetMemberLineMatrix`, `FundContributionReport`, `GetFundContributions`, `createGetFundContributions` (Task 5); `MemberPlace`, `MemberPlaceRepository`, `placesOf`, `consumptionByCategory`, `cashOut` (Task 7); `CategoryConsumption`, `ConsumptionCategory`, `ConsumptionGroup`, `ConsumptionNaming`, `consumptionGroups`, `CashOut`, `cashOutOf` (Task 8a); `PersonalSums`, `ReportCategories`, `SavingsAccountsOf`, `PersonalDeps`, `PersonalScope`, `personalScope`, `consumptionTotal`, `UnifiedGroup`, `UnifiedPersonalView`, `GetUnifiedPersonalView`, `createGetUnifiedPersonalView` (Task 8b); `periodsEndingWith`, `CHANGE_STATUSES`, `ChangeStatus`, `Change`, `changeFrom`, `TrendLine`, `tracedLines` (Task 10); `TrendInput`, `TrendPoint`, `LineTrendSeries`, `LineTrend`, `GetLineTrend`, `createGetLineTrend`, `PersonalTrendInput`, `PersonalTrendPoint`, `PersonalTrend`, `GetPersonalTrend`, `createGetPersonalTrend` (Task 11); `TreeCategory`, `TreePlace`, `treeById`, `placeIn`, `CategoryTrees`, `treesOf` (Task 13); `SpaceRef`, `SubcategorySpending`, `CategorySpending`, `GroupSpending`, `SpendingTree`, `Grouping`, `shareOf`, `spendingTree` (Task 14a); `spacePeriod`, `consumptionRows`, `SpendingByGroupDeps`, `SpendingByGroup`, `GetSpendingByGroup`, `createGetSpendingByGroup`, `PersonalSpendingByGroupDeps`, `PersonalSpendingByGroup`, `GetPersonalSpendingByGroup`, `createGetPersonalSpendingByGroup` (Task 14b).
- Contract names: `ReportQuerySchema`, `ReportPlanSchema`, `reportPlanDto`, `moneyOf`, `reportProblems`, `SpacePath`, `LineDashboardSchema`, `lineDashboardDto`, `reportingPaths` (2a); `MemberMatrixSchema`, `moneyOrNull`, `memberMatrixDto` (6a); `FundContributionsSchema`, `fundContributionsDto` (6b); `UnifiedViewSchema`, `unifiedViewDto` (9a); `TrendQuerySchema`, `signedPercent`, `changeDto`, `LineTrendSchema`, `lineTrendDto` (12a); `PersonalTrendSchema`, `personalTrendDto` (12b); `spendingNode`, `SubcategorySpendingSchema`, `SpendingByGroupSchema`, `spendingNodeDto`, `subcategorySpendingDto`, `spendingByGroupDto` (15a); `SpaceRefSchema`, `PersonalSpendingByGroupSchema`, `personalSpendingByGroupDto` (16a).
- `Container.reporting` keys: `getLineDashboard` (2a), `getMemberLineMatrix` (6a), `getFundContributions` (6b), `getUnifiedPersonalView` (9a), `getLineTrend` (12a), `getPersonalTrend` (12b), `getSpendingByGroup` (15a), `getPersonalSpendingByGroup` (16a); `reportingDeps` holds `access`, `members`, `plans`, `spending`, `savingsAccounts`, `categories` (2a, budgeting's `budgetCategories` for `loadPlanView`), `sums` (6a), `places`, `catalog` (`categoriesDeps.categories`), `savingsAccountsOf` (9a), `trees` (15a, the `categoryRepository` that `categoriesDeps` now shares); no key appears twice (ruling P95). Every route calls one of them.
- Test support: `SpendingByPeriod`, `reportingWorld` (1), `MemberSumsByPeriod`, `sums`, `memberDeps` (5) in `tests/support/reporting-world.ts`; `PersonalSumsByPeriod`, `place`, `ANA_PLACES`, `personalWorld` (8b) in `tests/support/personal-world.ts`; `getWithQuery`, `getLineDashboard`, `reportHousehold`, `spend`, `ReportPeriodDto`, `ReportPlanDto`, `DashboardLineDto`, `LineDashboardDto` (2a), `getMemberMatrix`, `MatrixCellDto`, `MemberMatrixDto` (6a), `getFundContributions`, `contribute`, `FundContributionsDto` (6b), `getUnifiedView`, `UnifiedViewDto` (9a), `getLineTrend`, `TrendPointDto`, `LineTrendDto` (12a), `getPersonalTrend`, `PersonalTrendDto` (12b), `getSpendingByGroup`, `SpendingNodeDto`, `SubcategorySpendingDto`, `SpendingByGroupDto` (15a), `newCategoryGroup`, `newCategory`, `moveCategory`, `groupWithKey` (15b), `getPersonalSpendingByGroup`, `SpaceRefDto`, `PersonalSpendingByGroupDto` (16a) in `tests/support/reporting.ts`; `GroupSpec`, `node`, `spent`, `HOUSING`, `FOOD`, `TRANSPORT`, `LEISURE`, `PETS`, `HOUSEHOLD_TREE`, `ANA_FOOD`, `ANA_TREE` (13) in `tests/support/category-trees.ts`.
- Error codes and statuses: no new code; `SpaceNotFound` (404), `InvalidPeriodLabel` (422 by the `Invalid*` default) and `ValidationFailed` (422) are listed in every new operation's problem descriptions and in the E7 notes.
- Migrations: none (0011 is M3-C's, 0012 – 0018 M3-D's; HU-E7-06 reads the group keys of M3-D's `0017`). OpenAPI components added: none; eight operations added.
- Open controller proposals: none. P32 – P39, P74 – P77, P80 – P82 and P95 – P106 are ruled, and P95 resolves P83.
