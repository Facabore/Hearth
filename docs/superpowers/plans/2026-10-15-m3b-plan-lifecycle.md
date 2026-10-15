# M3-B Plan Lifecycle, Copies, Rollover and Default Splits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Hearth's allocated-budgets API: an OWNER or ADMIN activates a DRAFT plan once its lines fit its capacity and every allocation holds, and closes an ACTIVE plan, after which nothing in the plan and no transaction of its space dated in its period changes (`PeriodClosed`, HU-E4-06); creates the next period's plan as a copy of the previous period's plan of the space's policy, with new ids, origin links and a report of what the copy left out; sees each line's carry-over (RESET, ROLLOVER, ADJUSTED) derived on read along the chain of copies; and records expenses whose default split follows the allocation of the line their category consumes in the ACTIVE plan covering their date (`BY_ALLOCATION`), with a preview endpoint for clients.

**Architecture:** Everything stays in the `budgeting` module of M3-A (`src/modules/budgeting/{domain,application,infrastructure,contracts}`) plus one ledger port. The domain gains pure rules: `transitioned`, `editablePlan` (Task 1, `domain/plan.ts`), `activationCheck` (Task 1, `domain/plan-figures.ts`), `copiedParts` (Task 6, `domain/plan-copy.ts`), the RolloverCalculator `carryOver` (Task 10, `domain/rollover.ts`) and a `carryOver` figure on every line of `planFigures` (Task 10; ruling P4: M3-B extends `planFigures` instead of introducing fields). The one write helper `planForWrite` reads the plan again after its row lock and refuses a CLOSED plan there (preflight N4, Task 3), so every M3-A write refuses closed plans without touching its use case. The plan repository gains `covering(spaceId, date, { share })` and a `PlanStatusRepository` (Task 2). The ledger never imports budgeting and budgeting never imports the ledger: `src/composition/container.ts` binds the ledger's existing `ClosedPeriodGuard` to budgeting's `createClosedPeriodGuard` (Task 5b) and its new `DefaultSplitSource` port (Task 13) to budgeting's `defaultSplitOf` (Task 15b). No migration: the columns of `0010_budgeting` (`status`, `created_from_plan_id`, `origin_line_id`) carry everything.

**Tech Stack:** Node.js 24.21.0, pnpm 12.11.2, Next.js 16.4.0 (App Router route handlers), React 19.3.0, TypeScript 6.0.3 strict, Zod 4.6.5, zod-openapi 6.0.2, drizzle-orm 0.45.4 + drizzle-kit 0.31.11, pg 8.23.1, better-auth 1.7.7, Vitest 5.0.3, PostgreSQL 18.6 (Docker CLI in tests). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-hearth-design.md` (approved 2026-10-11; sections 4, 5.2 (BudgetPlan, BudgetLine, Allocation as amended by M3-A ruling P1, Share, Recurrence), 5.3 (default split, rounding, previous period of the same policy), 5.4 (available, carry-over), 7, 8 and decisions D4, D7, D8, D9, D10, D12, D13, D15, D17 bind this plan). Stories: `docs/backlog/E6-budgeting.md` (HU-E6-06 … HU-E6-09), the closed-period scenario of `docs/backlog/E4-ledger.md` HU-E4-06 (activated here, as its note and `docs/backlog/README.md` say) and the dependency rows of `docs/backlog/README.md`. Format template and precedent: `docs/superpowers/plans/2026-10-14-m3a-budget-plans.md`, whose rulings P1–P9 (P8 as amended after its final review) and preflight notes N1–N6 stay in force. GitHub Project: https://github.com/users/Facabore/projects/4. Baseline: `development` at `8ddb888` (`a5e24fc` plus the docs-only M3-A merge bookkeeping).

**Out of scope (later plans):** M3-C — HU-E4-11 … HU-E4-13 recurring transactions (#40, #41, #42; their `BY_ALLOCATION` per occurrence and their skip of CLOSED periods reuse this plan's `DefaultSplitSource` and `ClosedPeriodGuard`) and HU-E5-04 balance history (#46). Also out: listing a space's plans (`GET …/plans`, M3-A follow-up 1), copying from a template (spec 5.2 `createdFrom` "previous plan or template"), reopening a CLOSED plan (HU-E6-07: "no reopening in v1"), requesting `BY_ALLOCATION` explicitly (ruling P16), per-member `contributed`, `consumed` and `gap` (HU-E7-02), the line dashboard (HU-E7-01) and the planner screens (HU-E9-08).

## Global Constraints

- Node.js `24.21.0`; pnpm `12.11.2`; Next.js `16.4.0`; React `19.3.0`; TypeScript `6.0.3` with `strict: true` and `noUncheckedIndexedAccess: true`; Zod `4.6.5`; zod-openapi `6.0.2`; drizzle-orm `0.45.4`; drizzle-kit `0.31.11`; pg `8.23.1`; better-auth `1.7.7`; Vitest `5.0.3`; PostgreSQL image `postgres:18.6-alpine`. No new dependencies; `pnpm check:pinned` must keep passing.
- Money is `bigint` minor units in code and `bigint` columns in PostgreSQL (D6); over HTTP it is `{ "amount": "<minor units as string>", "currency": "<ISO 4217>" }`. COP has exponent 2 and a rounding unit of 100 minor units (`src/shared/kernel/currency.ts`, spec 5.3): 1,600,000 COP is `"160000000"` on the wire. Splits and allocations use `Money.allocate` (largest remainder in rounding units, ties to members in join order, Σ parts = total exactly, spec 5.3); `BY_ALLOCATION` weighs by the line's assigned amounts in minor units (bigint weights, which `Money.allocate` takes since M3-A Task 3). Carry-overs may be negative (ADJUSTED) and are bigint too.
- Every money reference points to a `SpaceMember`, never to a user (D15). Figures, copies and default splits follow the **current** members (`listCurrent`, join order): a member who left keeps their rows but drops out of totals, assignments, copies and splits (ruling P7).
- **Every delete is logical (owner directive, spec D8):** M3-B removes nothing. Transitions change `budget_plans.status`; a copy inserts new rows and leaves its source untouched; default splits store ordinary share rows whose `split_method` snapshot is `BY_ALLOCATION`. No task in this plan adds a physical delete.
- **Authorization only through the permission matrix:** `CopyBudgetPlan`, `ActivateBudgetPlan` and `CloseBudgetPlan` are `plan.manage` (OWNER, ADMIN); `ResolveDefaultSplit` is `space.read`; the ledger's writes keep `money.record`. M3-B adds no matrix action and no hardcoded role list (`src/modules/spaces/domain/permissions.ts` is unchanged).
- **Archived spaces only read (HU-E1-09):** `SpaceAccess` answers `409 SpaceArchived` to every copy, activation and close (they reach the space without `readOnly`), while `GET …/plans/{planId}` and `GET …/default-split` keep answering `200`.
- **Plan writes (carried from M3-A, P3, P9, N4):** every write to a plan or its parts goes through `planForWrite`: membership, matrix, plan, `lockForWrite` (the plan row `FOR NO KEY UPDATE`, compare and bump the version), then the plan **found again inside the same transaction**, and only that re-read plan's status is checked (`lockForWrite` returns only the version; never decide on the pre-lock read, preflight N4). `If-Match` is optional (`412 PreconditionFailed` when stale); every write answers the whole plan and its new `ETag` (P9), transitions included. A copy is a creation: `201`, `ETag: "1"`, `Location`.
- **SAVINGS accounts (carried from M3-A, P8 as amended):** a SAVINGS line newly names only the caller's own SAVINGS accounts; every other account answers the identical `404 AccountNotFound`; a line's spending counts only accounts whose owner is a current registered member of the plan's space, evaluated on read; a newly named account must be in the plan currency. A copy names no account anew: it keeps a source line's account only while it still qualifies (SAVINGS, not archived, plan currency, owner a current registered member) and reports the others; a SAVINGS line left without accounts is not copied (ruling P10, Task 7).
- Repositories guard identifiers that come from requests with `isUuid` before querying `uuid` columns (malformed ids return `null`, `false` or `[]`, never a `500`); `covering` guards its space id the same way. Category and member ids from requests are checked against lists already loaded from the space and the plan.
- HTTP errors are RFC 9457 `application/problem+json` with a stable `code` (the domain error name) and `requestId`; the API never returns translated text. Status mapping lives only in `src/shared/http/problem.ts` (explicit map, then `*NotFound` → 404, `Invalid*` → 422, else 409). New codes: `InvalidPlanTransition` (explicit 409, ruling P12), `NoPreviousPlan` (409 by default), and the existing `PeriodClosed` (409) now reachable; `InvalidAllocation` on activation carries the public extension member `lineIds` (ruling P13). Each joins the backlog's catalogue (spec 8) in the task that exposes it over HTTP, as a note of its story in `docs/backlog/E6-budgeting.md`.
- Hexagonal boundaries (ADR 0001): domain imports only its own domain and `src/shared/kernel`; application never imports infrastructure, contracts, HTTP, frameworks or the ORM; other modules are reached only through `src/modules/<m>/application/index.ts`; `*.schema.ts` may import other modules' `*.schema.ts`; no import cycles (`no-circular` counts type-only imports, `tsPreCompilationDeps: true`). **The ledger never imports budgeting, and budgeting never imports the ledger:** the ledger declares `ClosedPeriodGuard` (M1) and `DefaultSplitSource` (Task 13) with its own types, and only `src/composition/container.ts` binds them to budgeting's `createClosedPeriodGuard` and `defaultSplitOf`.
- **No schema change:** M3-B needs no migration (0011 stays unused); no task edits a `*.schema.ts`, so `pnpm db:check` keeps reporting no drift.
- Strict TDD: every behaviour starts with a failing test that is run and seen failing. Golden scenarios (the reference plan of spec section 4) run as domain or use-case unit tests and again over HTTP; acceptance tests call the route handlers in-process against real PostgreSQL.
- Code, identifiers, comments, docs and generated artifacts in English. Conventional commits referencing the story issue (`Refs #<n>`); no AI attribution or `Co-Authored-By` lines.
- Gates for every task: `pnpm exec vitest run --project unit`, `pnpm exec vitest run --project integration`, `pnpm exec vitest run --project acceptance`, `pnpm format`, `pnpm exec eslint .`, `pnpm exec tsc --noEmit`, `pnpm exec prettier --check .`, `pnpm lint:boundaries`, `pnpm db:check`.
- OpenAPI: no new component and no new `…Output` variant. `BudgetPlan` (response-only) gains `lines[].originLineId`, `lines[].carryOver` and the optional `dropped`; `Problem` gains the optional `lineIds`; the new operations reference existing components.

## Review Focus

1. **Closing a plan while others write** (an expense recorded in the plan's period at the instant it closes, a line added while the close holds the lock, a copy made while its source is being edited): the ledger write either commits before the close or sees `PeriodClosed`, never after it; the queued plan edit answers `409 PeriodClosed`; the copy carries the edited source — pinned in Task 8 (rendezvous tests that turn red when `covering` stops locking `FOR SHARE` or `planForWrite` checks the pre-lock status), Task 3 (N4 at the use case) and Task 13 (the closed period is checked before the default split is read).
2. **Dates on a period's edges and the policy's shape** (an expense on 2026-11-30 and on 2026-12-01 once November is CLOSED; moving a December expense to 2026-11-20; copying "2026-11 H2" and "2026-12 H1" in a SEMI_MONTHLY space; copying "2026-12" when only "2026-10" has a plan): `PeriodClosed` exactly inside the stored dates, the copy source is the plan covering the day before the new period starts, and `NoPreviousPlan` otherwise — pinned in Tasks 2 (`covering` edges against PostgreSQL), 3 (the guard), 5b (HTTP) and 7.
3. **Members who left, guests and members without capacity across copies and splits** (Luis allocated 10 % of Free then leaving, Luis's savings account on a line, the guest Pedro alone on a FIXED Home, Sofi with no capacity, Juan leaving after a copy): former members' rows are left out of a copy and Free is flagged `InvalidAllocation`; a SAVINGS line left without accounts is not copied and is reported; `BY_ALLOCATION` weighs only current members with a positive assigned amount — pinned in Tasks 6, 7, 9b and 14.
4. **Money that carries over, splits and rounds** (ADJUSTED overspend through three periods, ROLLOVER floored at 0, 2,000,000 COP over 588,000 / 882,000 COP, 300,000 COP over 490,000 / 980,000 COP, a 0 weight): carry-overs chain exactly and may be negative, shares sum to the amount exactly with remainders to the earliest-joined members, and a non-positive weight answers `InvalidSplit` — pinned in Tasks 10, 11, 13 and 14.
5. **Identifiers from elsewhere and archived spaces** (another space's category in the default-split preview, an origin line removed from the source, an unknown or malformed plan id on activate or close, any transition or copy in an archived space): `422 CategoryNotInSpace`, a carry-over of 0, `404 BudgetPlanNotFound` (never `500`), `409 SpaceArchived` for every write while reads answer `200` — pinned in Tasks 5a, 5b, 9b, 11 and 15a.

## Execution Workflow

- Work on the long-lived branch `development`; every task is implemented there with Strict TDD. Implementers stage; the controller commits.
- **RDD before every commit** (receipt-driven development is on; check with `gentle-ai review mode status`). Each "Commit" step means:
  1. Run every source-mutating normalizer first (`pnpm format`, regenerated migrations or snapshots), then stage exactly the files of the task.
  2. Run `gentle-ai review status --cwd . --contract gentle-ai.review-integration/v2 --agent claude-code --next-transition` and follow only the returned `next_transition` (`execute` its operation, satisfy `collect` inputs, or stop on `stop` and report its reason code with its documented continuation). Medium/high-risk candidates may return a consent envelope; relay it to the owner and wait.
  3. Commit only after the provider-returned `review.validate` allows the `pre-commit` gate for that exact staged candidate; the commit must not change the reviewed bytes.
  4. If the owner disables RDD (`gentle-ai review mode disable --scope clone --cwd .`), commit under ordinary policy and report `disabled/unmanaged`.
- Code blocks in this plan are complete but not guaranteed to match Prettier's line wrapping: run `pnpm format` before the gates of every task (the gates then run `prettier --check`). Anchors in this plan name lines that Prettier leaves alone (short statements, JSDoc and `//` comments, existing lines already formatted, the last line of a file); when an anchor is a range, it is given by its first and last lines. Where a later task edits a line an earlier task wrote, the earlier task writes it in its final Prettier form (multi-line imports when they exceed 110 characters).
- Every code block the executor writes is introduced by a line naming its file path in backticks and ending with a colon. "Create" blocks are whole files; "Replace the contents" blocks are whole files too; edits to existing files name a unique anchor line ("after the line …", "replace the line …", "insert before the line …", "append to the end of the file", "insert before the last line of the file").
- **Task labels:** split halves of a task carry a lower-case letter (5a, 5b, 9a, 9b, 15a, 15b); each half is its own commit and RDD pass, executed in the order 1 … 4, 5a, 5b, 6, 7, 8, 9a, 9b, 10 … 14, 15a, 15b.
- **Repository ports are separate interfaces**, as in M3-A: `PlanStatusRepository` (Task 2) is new; `BudgetPlanRepository` gains `covering` (Task 2). Both are introduced with their in-memory twin methods, their PostgreSQL methods and the integration test that runs the same sequence against both and compares the outcomes (`src/modules/budgeting/infrastructure/plan-lifecycle.int.test.ts`), so a twin that drifts from its adapter fails a test. A copy (Task 7) writes only through the M3-A ports (`setCapacities`, `addLine`, `mapCategories`, `setAllocation`), each already pinned against PostgreSQL; Task 8 runs a copy against PostgreSQL. The ledger's `DefaultSplitSource` (Task 13) and its existing `ClosedPeriodGuard` are bound in the composition root.
- **Measured sizes (preflight N1 as ruled for M3-A, carried here):** each task is one commit sized for review, target under ~400 changed lines (OpenAPI snapshot growth included), and **a task over ~500 changed lines is split into two commits, each green on its own**. M3-A's commits measured 1.4–1.9 × its estimates (`git log --numstat dad4b82..a5e24fc`: Task 17 committed 658 lines, Task 14a 685, Task 12a 664, Task 15 649, Task 9b's first half 569), so every estimate below is that measured ratio applied, not a raw count. Measured snapshot growth on M3-A: a body-less plan write about 107 lines (`DELETE …/lines/{lineId}`), a plan write with a body 140–220, a GET 64–90; acceptance files were 180–390 lines per commit. Estimates: Task 1 ~260, 2 ~330, 3 ~380, 4 ~420, **5a ~460** (split point if it measures over ~500: the contract path, route, problem rows, container and the first two scenarios | the remaining scenarios and the backlog note), **5b ~480** (split point: the close path, route, container and ledger scenarios | the `planWrite` `PeriodClosed` change, its snapshot and the "every edit refused" scenario), 6 ~380, **7 ~480** (split point: `openedPlan`, `copyableSavingsAccounts` and their tests | `CopyBudgetPlan` and `copies.test.ts`), 8 ~380, 9a ~280, 9b ~430, 10 ~280, 11 ~360, 12 ~360, 13 ~420, **14 ~460** (split point: `defaultSplitOf` and its tests | `ResolveDefaultSplit` and its tests), 15a ~430, 15b ~400. The controller measures each staged candidate (`git diff --cached --numstat`, generated files excluded) before RDD and splits at the named point when it is over ~500.
- The OpenAPI snapshot changes in Tasks 5a (`POST …/activate`; `Problem.lineIds`), 5b (`POST …/close`; `PeriodClosed` in the 409 description of the six M3-A plan writes), 9a (`BudgetPlan` gains `lines[].originLineId` and the optional `dropped`; `POST …/plans` gains `copyFrom`), 12 (`BudgetPlan` gains `lines[].carryOver`) and 15a (`GET …/default-split`). If a `BudgetPlanOutput`, `ProblemOutput` or any other new `…Output` variant appears in a snapshot diff, a request schema is reusing a response schema: fix the contract instead of accepting the snapshot.
- **One concurrency task (Task 8)** adds four rendezvous tests to `src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts`; each is red when the lock it pins is removed (named per test).
- When a task starts, move its story issues to **In Progress** on Project #4. When all tasks are done, open one pull request from `development` into `main`. It closes #52, #53, #54 and #55 and states that #40–#42 and #46 (M3-C) stay open for the next plan. Its description also lists, as PR notes: (1) a CLOSED plan freezes its space's transactions dated in its period (`PeriodClosed`, HU-E4-06 now active), and a ledger write in a planned period briefly locks the plan row `FOR SHARE`; (2) an expense recorded without a split now defaults to `BY_ALLOCATION` when its category resolves to an allocated line of the ACTIVE plan covering its date, and `RecordExpense` checks a closed period before resolving the split (P14); (3) `BudgetPlan` lines carry `originLineId` and `carryOver`, and the answer to a copy carries `dropped`; (4) the controller rulings P10–P19 of the Self-Review, as ruled; (5) the follow-ups in the Self-Review.
- Task-to-issue map (issues are titled with their story ID): HU-E6-06 → #52 (Tasks 2, 6, 7, 8, 9a, 9b), HU-E6-07 → #53 (Tasks 1, 2, 3, 4, 5a, 5b, 8), HU-E6-08 → #54 (Tasks 2, 13, 14, 15a, 15b), HU-E6-09 → #55 (Tasks 10, 11, 12). Task 3 and Task 5b also reference the closed M1 story HU-E4-06 (#35), and Task 13 and Task 15b the closed M2 story HU-E4-07 (#36), without reopening them.

## File Structure

```
.
├── docs/backlog/
│   ├── E6-budgeting.md                                              # notes of HU-E6-06 … HU-E6-09 (Tasks 5a, 5b, 9b, 12, 15a, 15b)
│   ├── E4-ledger.md                                                 # HU-E4-06 closed-period note (Task 5b)
│   └── README.md                                                    # HU-E4-06 dependency note (Task 5b)
├── openapi/openapi.snapshot.json                                    # Tasks 5a, 5b, 9a, 12, 15a
├── src/
│   ├── shared/http/
│   │   ├── contracts.ts                                             # Problem.lineIds (Task 5a)
│   │   └── problem.ts                                               # InvalidPlanTransition 409, public lineIds (Task 5a)
│   ├── composition/container.ts                                     # Tasks 5a, 5b, 9b, 13, 15a, 15b
│   ├── modules/
│   │   ├── ledger/
│   │   │   ├── domain/split.ts                                      # AllocationSplit, BY_ALLOCATION shares (Task 13)
│   │   │   └── application/{ports,deps,record-expense,index}.ts     # DefaultSplitSource, the default split (Task 13)
│   │   └── budgeting/
│   │       ├── domain/plan.ts                                       # transitioned, editablePlan (Task 1)
│   │       ├── domain/plan-figures.ts                               # activationCheck (Task 1), carryOver figures (Task 10)
│   │       ├── domain/plan-copy.ts                                  # copiedParts, CopyDrops (Task 6)
│   │       ├── domain/rollover.ts                                   # carryOver, the RolloverCalculator (Task 10)
│   │       ├── application/ports.ts                                 # covering, PlanStatusRepository (Task 2)
│   │       ├── application/plan-access.ts                           # planForWrite re-reads after the lock (Task 3)
│   │       ├── application/closed-periods.ts                        # createClosedPeriodGuard (Task 3)
│   │       ├── application/plan-lifecycle.ts                        # Activate/CloseBudgetPlan (Task 4)
│   │       ├── application/create-budget-plan.ts                    # openedPlan (Task 7)
│   │       ├── application/copy-budget-plan.ts                      # CopyBudgetPlan (Task 7)
│   │       ├── application/line-checks.ts                           # copyableSavingsAccounts (Task 7)
│   │       ├── application/plan-view.ts                             # carry-over along the plan chain (Task 11)
│   │       ├── application/default-split.ts                         # defaultSplitOf, ResolveDefaultSplit (Task 14)
│   │       ├── application/index.ts                                 # Tasks 3, 4, 7, 14
│   │       ├── infrastructure/drizzle-budget-plan-repository.ts     # covering, setStatus (Task 2)
│   │       ├── infrastructure/plan-lifecycle.int.test.ts            # Task 2
│   │       ├── infrastructure/concurrent-plan-writes.int.test.ts    # Tasks 2, 8
│   │       └── contracts/budgeting.contract.ts                      # Tasks 5a, 5b, 9a, 12, 15a (+ .test.ts, 9a, 12)
│   └── app/api/v1/spaces/[spaceId]/
│       ├── plans/route.ts                                           # POST with copyFrom (Task 9b)
│       ├── plans/[planId]/activate/route.ts                         # POST (Task 5a)
│       ├── plans/[planId]/close/route.ts                            # POST (Task 5b)
│       └── default-split/route.ts                                   # GET (Task 15a)
└── tests/
    ├── support/
    │   ├── in-memory-budgeting.ts     # covering, setStatus (Task 2)
    │   ├── in-memory-ledger.ts        # defaultSplits in ledgerFixture (Task 13)
    │   └── budgeting.ts               # activatePlan (5a), closePlan (5b), copyPlan (9b), getDefaultSplit (15a), DTO types
    └── acceptance/
        ├── budget-lifecycle.test.ts       # Tasks 5a, 5b
        ├── budget-copies.test.ts          # Task 9b
        ├── budget-rollover.test.ts        # Task 12
        └── budget-default-split.test.ts   # Tasks 15a, 15b
```

Test layout follows M0–M3-A: unit tests next to the code as `*.test.ts` (no database), integration tests as `*.int.test.ts` (real PostgreSQL via `testDatabase()`), acceptance tests in `tests/acceptance/` calling the exported route handlers in-process. Shared test doubles live in `tests/support/`. Run a single file with `pnpm exec vitest run --project <unit|integration|acceptance> <path>`. Integration and acceptance projects start a disposable PostgreSQL container through the Docker CLI (`tests/support/postgres-global-setup.ts`) and apply every migration in `drizzle/`, so Docker must be running.

### How plan actions are authorized

No matrix action is added; M3-B reuses `plan.manage` and `space.read`.

| Use case | Matrix action | Roles | Other rules (where they live) |
|---|---|---|---|
| `CopyBudgetPlan` | `plan.manage` | OWNER, ADMIN | the period resolves like a creation (`openedPlan`); the source is the plan covering the day before (`NoPreviousPlan`); `copiedParts`, `copyableSavingsAccounts` (P10) |
| `ActivateBudgetPlan` | `plan.manage` | OWNER, ADMIN | `transitioned(…, "ACTIVE")` after the lock (N4), then `activationCheck` |
| `CloseBudgetPlan` | `plan.manage` | OWNER, ADMIN | `transitioned(…, "CLOSED")` after the lock (N4) |
| every M3-A plan write | unchanged | unchanged | `editablePlan` after the lock (N4): CLOSED answers `PeriodClosed` |
| `ResolveDefaultSplit` | `space.read` | every role | a live category of the space (`CategoryNotInSpace`); `defaultSplitOf` |
| ledger writes (`RecordExpense`, …) | `money.record` (unchanged) | OWNER, ADMIN, MEMBER | `ClosedPeriodGuard` → `createClosedPeriodGuard`; `RecordExpense` without a split → `DefaultSplitSource` → `defaultSplitOf` |

### Every path that touches a plan rule

| Rule | Paths | Where it is enforced |
|---|---|---|
| DRAFT → ACTIVE → CLOSED, nothing else, no reopening (HU-E6-07) | `ActivateBudgetPlan`, `CloseBudgetPlan` | `transitioned` (Task 1) passed to `planForWrite` (Task 3), checked on the plan read after the lock |
| A plan is activated only while Σ planned ≤ total capacity and every allocation holds (spec 5.2, HU-E6-07) | `ActivateBudgetPlan` only; later edits of an ACTIVE plan are not re-checked (P13) | `activationCheck` (Task 1) over `planFigures` of the locked parts (Task 4) |
| A CLOSED plan and its parts never change (HU-E6-07) | `SetMemberCapacities`, `AddBudgetLine`, `UpdateBudgetLine`, `RemoveBudgetLine`, `MapCategoriesToLine`, `AllocateBudgetLine` | `editablePlan`, the default `accepts` of `planForWrite` (Task 3), raced in Task 8 |
| Transactions of a space dated in a CLOSED plan's period never change (HU-E4-06) | every ledger write that calls `openPeriod` (record expense, income, transfer, fund contribution, settlement; edit, both dates; delete) | `createClosedPeriodGuard` (Task 3), bound in Task 5b; reads the covering plan `FOR SHARE` (P14), raced in Task 8 |
| The copy source is the plan of the previous period of the policy (HU-E6-06, spec 5.3) | `CopyBudgetPlan` | `covering(space, day before the new period starts, { share: true })` (Tasks 2, 7) |
| A copy leaves out former members, archived or gone categories and accounts that no longer qualify (HU-E6-06, P8, P10) | `CopyBudgetPlan` | `copiedParts` (Task 6), `copyableSavingsAccounts` (Task 7) |
| available = planned + carry-over − spent; carry by the receiving line's mode from its origin line (spec 5.4, HU-E6-09, P15) | every read of a plan and every write's answer | `carryOver` and `planFigures` (Task 10), the chain in `loadPlanView` (Task 11) |
| BY_ALLOCATION is the default for expenses whose category resolves to an allocated line of the ACTIVE plan; EQUAL otherwise (spec 5.3, D4, HU-E6-08, P16) | `RecordExpense` without a split; `GET …/default-split` | `defaultSplitOf` (Task 14) through `DefaultSplitSource` (Tasks 13, 15b); `splitShares` (Task 13) |
| Archived spaces only read | `CopyBudgetPlan`, `ActivateBudgetPlan`, `CloseBudgetPlan` refuse; `ResolveDefaultSplit` reads | `SpaceAccess` without `readOnly` (`openedPlan`, `planForWrite`); `space.read` (`authorizeSpaceAction`) |

---

### Task 1: Budgeting domain — plan lifecycle rules

Implements the pure rules of HU-E6-07 (issue #53).

Decisions:
- `transitioned(plan, to)` allows DRAFT → ACTIVE and ACTIVE → CLOSED only; every other move, CLOSED → anything included, is `InvalidPlanTransition` with `{ from, to }` (details stay in the log; HU-E6-07 "no reopening in v1", ruling P12).
- `editablePlan(plan)` refuses every edit of a CLOSED plan or its parts with `PeriodClosed` (HU-E6-07 "Closed plan rejects plan edits"); DRAFT and ACTIVE plans stay editable (ruling P13).
- `activationCheck(figures)` refuses `PlanExceedsCapacity` while unallocated capacity is negative (spec 5.2: "a plan whose capacity was later reduced below Σ plannedAmount cannot be activated"), checked first, then `InvalidAllocation` whose `lineIds` name every flagged line in plan order (HU-E6-07 "naming the line Free", ruling P13). Neither reads spending.

**Files:**
- Modify: `src/modules/budgeting/domain/plan.ts`, `src/modules/budgeting/domain/plan-figures.ts`
- Test: `src/modules/budgeting/domain/plan.test.ts`, `src/modules/budgeting/domain/plan-figures.test.ts`

**Interfaces:**
- Consumes: `BudgetPlan`, `PlanStatus` (M3-A Task 1); `PlanFigures`, `LineFigure` (M3-A Task 4).
- Produces:
  - `transitioned(plan: BudgetPlan, to: PlanStatus): Result<BudgetPlan>` — `InvalidPlanTransition`
  - `editablePlan(plan: BudgetPlan): Result<BudgetPlan>` — `PeriodClosed`
  - `activationCheck(figures: Pick<PlanFigures, "unallocated" | "lines">): Result<void>` — `PlanExceedsCapacity`, `InvalidAllocation` (`details.lineIds: string[]`)

- [ ] **Step 1: Write the failing tests**

In `src/modules/budgeting/domain/plan.test.ts`, replace the line `import { openPlan, type BudgetPlanId } from "./plan";` with:

```ts
import {
  editablePlan,
  openPlan,
  transitioned,
  type BudgetPlan,
  type BudgetPlanId,
  type PlanStatus,
} from "./plan";
```

Append to the end of `src/modules/budgeting/domain/plan.test.ts`:

```ts

describe("plan lifecycle (HU-E6-07)", () => {
  const november = (status: PlanStatus): BudgetPlan => ({
    ...unwrap(open(unwrap(periodByLabel(MONTHLY_1, [], "2026-11")))),
    status,
  });

  it("activates a DRAFT plan and closes an ACTIVE one", () => {
    expect(unwrap(transitioned(november("DRAFT"), "ACTIVE")).status).toBe("ACTIVE");
    expect(unwrap(transitioned(november("ACTIVE"), "CLOSED")).status).toBe("CLOSED");
  });

  it.each<[PlanStatus, PlanStatus]>([
    ["DRAFT", "CLOSED"],
    ["DRAFT", "DRAFT"],
    ["ACTIVE", "ACTIVE"],
    ["ACTIVE", "DRAFT"],
    ["CLOSED", "ACTIVE"],
    ["CLOSED", "DRAFT"],
    ["CLOSED", "CLOSED"],
  ])("refuses %s → %s: no other move, and no reopening in v1", (from, to) => {
    expect(transitioned(november(from), to)).toEqual({
      ok: false,
      error: { code: "InvalidPlanTransition", details: { from, to } },
    });
  });

  it("lets DRAFT and ACTIVE plans be edited, never a CLOSED one", () => {
    expect(codeOf(editablePlan(november("DRAFT")))).toBe("ok");
    expect(codeOf(editablePlan(november("ACTIVE")))).toBe("ok");
    expect(codeOf(editablePlan(november("CLOSED")))).toBe("PeriodClosed");
  });
});
```

In `src/modules/budgeting/domain/plan-figures.test.ts`:

1. Insert before the line `  lineForCategory,`:

```ts
  activationCheck,
```

2. Insert after the line `import { aLine, referenceLines } from "../../../../tests/support/budget-fixtures";`:

```ts
import { codeOf } from "../../../../tests/support/fakes";
```

3. Append to the end of the file:

```ts

describe("activationCheck (HU-E6-07)", () => {
  it("accepts the reference plan: its lines fit its capacity and every allocation holds", () => {
    expect(codeOf(activationCheck(figures(reference())))).toBe("ok");
  });

  it("refuses Free at 42 % / 57 %, naming it", () => {
    const allocations = [
      { lineId: "line-free", memberId: ANA, value: 4200n },
      { lineId: "line-free", memberId: JUAN, value: 5700n },
    ];
    expect(activationCheck(figures(reference({ allocations })))).toEqual({
      ok: false,
      error: { code: "InvalidAllocation", details: { lineIds: ["line-free"] } },
    });
  });

  it("refuses a plan whose capacity was reduced below its lines: Juan at 2,000,000 COP", () => {
    const capacities = [
      { memberId: ANA, amount: 160_000_000n },
      { memberId: JUAN, amount: 200_000_000n },
    ];
    expect(codeOf(activationCheck(figures(reference({ capacities }))))).toBe("PlanExceedsCapacity");
  });

  it("names every flagged line in plan order, and reports the capacity first when both fail", () => {
    const lines = reference().lines.map((l) =>
      l.name === "Home" ? { ...l, allocationRule: "FIXED" as const } : l,
    );
    const allocations = [
      { lineId: "line-home", memberId: ANA, value: 50_000_000n },
      { lineId: "line-free", memberId: ANA, value: 4200n },
      { lineId: "line-free", memberId: JUAN, value: 5700n },
    ];
    expect(activationCheck(figures(reference({ lines, allocations })))).toEqual({
      ok: false,
      error: { code: "InvalidAllocation", details: { lineIds: ["line-home", "line-free"] } },
    });
    const capacities = [{ memberId: ANA, amount: 100_000_000n }];
    expect(codeOf(activationCheck(figures(reference({ lines, allocations, capacities }))))).toBe(
      "PlanExceedsCapacity",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/domain/plan.test.ts src/modules/budgeting/domain/plan-figures.test.ts`
Expected: FAIL — `transitioned is not a function`, `editablePlan is not a function` and `activationCheck is not a function` (the missing exports resolve to `undefined` under Vitest).

- [ ] **Step 3: Implement**

In `src/modules/budgeting/domain/plan.ts`, replace the line `  /** DRAFT until HU-E6-07 activates and closes plans; DRAFT plans never drive splits (spec 5.3). */` with:

```ts
  /** HU-E6-07: DRAFT → ACTIVE → CLOSED; only ACTIVE plans drive splits (spec 5.3), CLOSED ones never change. */
```

Append to the end of `src/modules/budgeting/domain/plan.ts`:

```ts

/** HU-E6-07: the only moves of a plan's status; nothing leaves CLOSED (no reopening in v1). */
const NEXT = new Map<PlanStatus, PlanStatus>([
  ["DRAFT", "ACTIVE"],
  ["ACTIVE", "CLOSED"],
]);

/** HU-E6-07: the plan moved to `to`; any other move is InvalidPlanTransition (ruling P12). */
export const transitioned = (plan: BudgetPlan, to: PlanStatus): Result<BudgetPlan> =>
  NEXT.get(plan.status) === to
    ? ok({ ...plan, status: to })
    : err(domainError("InvalidPlanTransition", { from: plan.status, to }));

/**
 * HU-E6-07: a CLOSED plan's figures are frozen, so neither the plan nor its parts change any more (PeriodClosed);
 * DRAFT and ACTIVE plans are edited (ruling P13).
 */
export const editablePlan = (plan: BudgetPlan): Result<BudgetPlan> =>
  plan.status === "CLOSED" ? err(domainError("PeriodClosed")) : ok(plan);
```

In `src/modules/budgeting/domain/plan-figures.ts`:

1. Insert before the line `import { assignedAmounts, type LineAllocation } from "./allocation";`:

```ts
import { domainError, err, ok, type Result } from "@/shared/kernel";
```

2. Append to the end of the file:

```ts

/**
 * HU-E6-07, spec 5.2: a plan is activated only while its lines fit its capacity (PlanExceedsCapacity, checked
 * first) and every allocation holds (InvalidAllocation, its `lineIds` naming every flagged line in plan order,
 * ruling P13). Neither depends on what was spent.
 */
export const activationCheck = (figures: Pick<PlanFigures, "unallocated" | "lines">): Result<void> => {
  if (figures.unallocated < 0n) return err(domainError("PlanExceedsCapacity"));
  const lineIds = figures.lines.filter((l) => l.allocation.invalid).map((l) => l.line.id);
  return lineIds.length === 0 ? ok(undefined) : err(domainError("InvalidAllocation", { lineIds }));
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/domain`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/domain/plan.ts src/modules/budgeting/domain/plan.test.ts src/modules/budgeting/domain/plan-figures.ts src/modules/budgeting/domain/plan-figures.test.ts
git commit -m "feat(budgeting): move plans from draft to active to closed and check them before activation (Refs #53)"
```

---

### Task 2: Budgeting persistence — plans by date and plan statuses

Implements the persistence HU-E6-06 (issue #52, the copy source), HU-E6-07 (issue #53, transitions and the closed-period guard) and HU-E6-08 (issue #54, the plan covering an expense) share.

Decisions:
- `BudgetPlanRepository.covering(spaceId, date, { share })` answers the space's plan whose stored period covers `date` (D10: stored periods never overlap, so at most one). With `share: true` the row is read `FOR SHARE`: it conflicts with the `FOR NO KEY UPDATE` that `lockForWrite` takes, so the reader waits for a plan write in progress and keeps new ones waiting until its own transaction ends, while other readers share it (ruling P14). Without `share` it is a plain read.
- A new port `PlanStatusRepository.setStatus(planId, status, at)` changes the status and `updated_at` and leaves the version alone (the caller already bumped it under `lockForWrite`). No migration: `budget_plans.status` exists since `0010_budgeting` (ruling P18).

**Files:**
- Modify: `src/modules/budgeting/application/ports.ts`, `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.ts`, `tests/support/in-memory-budgeting.ts`, `src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts`
- Create (test): `src/modules/budgeting/infrastructure/plan-lifecycle.int.test.ts`

**Interfaces:**
- Consumes: `BudgetPlanRepository`, `toPlan`, `budgetPlans` (M3-A Tasks 5, 6); `InMemoryBudgetPlans` (M3-A Task 6); `userFixture`, `sharedSpaceFixture` (`tests/support/fixtures.ts`).
- Produces:
  - `BudgetPlanRepository.covering(spaceId: string, date: LocalDate, options?: { readonly share?: boolean }): Promise<BudgetPlan | null>`
  - `interface PlanStatusRepository { setStatus(planId: BudgetPlanId, status: PlanStatus, at: Date): Promise<void> }`
  - `DrizzleBudgetPlanRepository.covering`, `.setStatus`; `InMemoryBudgetPlans.covering(spaceId: string, date: LocalDate)`, `.setStatus(planId: string, status: PlanStatus)`

- [ ] **Step 1: Write the port and the failing integration test**

In `src/modules/budgeting/application/ports.ts`:

1. Replace the line `import type { BudgetPlan, BudgetPlanId } from "../domain/plan";` with:

```ts
import type { BudgetPlan, BudgetPlanId, PlanStatus } from "../domain/plan";
```

2. Insert before the line `  /** Capacities by member; lines that are not deleted in creation order; current mappings and values by line. */`:

```ts
  /**
   * HU-E6-06 … HU-E6-08: the space's plan whose stored period covers `date` (stored periods never overlap, D10);
   * null when none does and for malformed ids. With `share`, the row is locked FOR SHARE until the caller's
   * transaction ends: the read waits for a write to the plan in progress (FOR NO KEY UPDATE, `lockForWrite`) and
   * keeps new writes waiting until then, while other readers share it (ruling P14).
   */
  covering(spaceId: string, date: LocalDate, options?: { readonly share?: boolean }): Promise<BudgetPlan | null>;
```

3. Append to the end of the file:

```ts

/** HU-E6-07: a plan's status changes only through its transitions, under the plan's version lock. */
export interface PlanStatusRepository {
  /** Sets the status and the update time; the version is the one `lockForWrite` already gave the plan. */
  setStatus(planId: BudgetPlanId, status: PlanStatus, at: Date): Promise<void>;
}
```

`src/modules/budgeting/infrastructure/plan-lifecycle.int.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";
import { InMemoryBudgetPlans } from "../../../../tests/support/in-memory-budgeting";
import type { BudgetPlanRepository, PlanStatusRepository } from "../application/ports";
import type { BudgetPlan, BudgetPlanId } from "../domain/plan";
import { DrizzleBudgetPlanRepository } from "./drizzle-budget-plan-repository";

const { db, pool } = testDatabase();
const repo = new DrizzleBudgetPlanRepository(new DrizzleTransactionManager(db));
const at = new Date("2026-10-15T12:00:00Z");
const later = new Date("2026-12-01T12:00:00Z");

afterAll(() => pool.end());

const aPlan = (spaceId: string, label: string, start: string, end: string): BudgetPlan => ({
  id: randomUUID() as BudgetPlanId,
  spaceId,
  period: { label, start: start as LocalDate, end: end as LocalDate },
  status: "DRAFT",
  createdFrom: null,
  version: 1,
  createdBy: "u-ana",
  createdAt: at,
});

describe("DrizzleBudgetPlanRepository plans by date and status (HU-E6-06, HU-E6-07, HU-E6-08)", () => {
  it("finds the plan covering a date, its edges included, and changes its status like its in-memory twin", async () => {
    const ana = await userFixture(pool, "Ana");
    const space = await sharedSpaceFixture(db, ana.id);
    const november = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    const december = aPlan(space.id, "2026-12", "2026-12-01", "2026-12-31");
    const run = async (plans: BudgetPlanRepository & PlanStatusRepository) => {
      await plans.add(november);
      await plans.add(december);
      const covering = async (spaceId: string, date: string, share = false) =>
        (await plans.covering(spaceId, date as LocalDate, { share }))?.id ?? null;
      const found = [
        await covering(space.id, "2026-10-31"),
        await covering(space.id, "2026-11-01"),
        await covering(space.id, "2026-11-30", true),
        await covering(space.id, "2026-12-01"),
        await covering(randomUUID(), "2026-11-15"),
        await covering("not-a-uuid", "2026-11-15"),
      ];
      await plans.setStatus(november.id, "ACTIVE", at);
      await plans.setStatus(november.id, "CLOSED", later);
      const closed = await plans.find(space.id, november.id);
      const untouched = await plans.find(space.id, december.id);
      return { found, november: [closed?.status, closed?.version], december: untouched?.status };
    };
    const expected = {
      found: [null, november.id, november.id, december.id, null, null],
      november: ["CLOSED", 1],
      december: "DRAFT",
    };
    expect(await run(new InMemoryBudgetPlans())).toEqual(expected);
    expect(await run(repo)).toEqual(expected);
    const { rows } = await pool.query("SELECT status, updated_at FROM budget_plans WHERE id = $1", [
      november.id,
    ]);
    expect(rows[0]).toEqual({ status: "CLOSED", updated_at: later });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project integration src/modules/budgeting/infrastructure/plan-lifecycle.int.test.ts`
Expected: FAIL — `plans.covering is not a function`.

- [ ] **Step 3: Implement**

In `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.ts`:

1. Replace the line `import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";` with:

```ts
import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
```

2. Replace the line `import type { BudgetPlan, BudgetPlanId } from "../domain/plan";` with:

```ts
import type { BudgetPlan, BudgetPlanId, PlanStatus } from "../domain/plan";
```

3. Insert before the line `  async lockForWrite(planId: BudgetPlanId, expectedVersion: number | null, at: Date): Promise<number | null> {`:

```ts
  async covering(
    spaceId: string,
    date: LocalDate,
    options: { readonly share?: boolean } = {},
  ): Promise<BudgetPlan | null> {
    if (!isUuid(spaceId)) return null;
    const query = this.tm
      .executor()
      .select()
      .from(budgetPlans)
      .where(
        and(eq(budgetPlans.spaceId, spaceId), lte(budgetPlans.startDate, date), gte(budgetPlans.endDate, date)),
      )
      .limit(1);
    // P14: FOR SHARE conflicts with the FOR NO KEY UPDATE of lockForWrite and with nothing other readers take.
    const [row] = options.share === true ? await query.for("share") : await query;
    return row ? toPlan(row) : null;
  }

```

4. Insert before the last line of the file (`}`):

```ts

  async setStatus(planId: BudgetPlanId, status: PlanStatus, at: Date): Promise<void> {
    await this.tm.executor().update(budgetPlans).set({ status, updatedAt: at }).where(eq(budgetPlans.id, planId));
  }
```

In `tests/support/in-memory-budgeting.ts`:

1. Insert before the line `  PlanContents,`:

```ts
  PlanStatus,
```

2. Replace the line `import type { StoredPeriod } from "@/shared/kernel";` with:

```ts
import type { LocalDate, StoredPeriod } from "@/shared/kernel";
```

3. Insert before the line `  async lockForWrite(planId: string, expectedVersion: number | null): Promise<number | null> {`:

```ts
  /** Like DrizzleBudgetPlanRepository.covering; there is nothing to lock in memory. */
  async covering(spaceId: string, date: LocalDate): Promise<BudgetPlan | null> {
    return this.plans.find((p) => p.spaceId === spaceId && p.period.start <= date && date <= p.period.end) ?? null;
  }

```

4. Insert before the line `  /** Test setup: parts of a plan as earlier writes would have left them. */`:

```ts
  /** PlanStatusRepository, like DrizzleBudgetPlanRepository.setStatus: the version stays. */
  async setStatus(planId: string, status: PlanStatus): Promise<void> {
    this.plans = this.plans.map((p) => (p.id === planId ? { ...p, status } : p));
  }

```

In `src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts`, insert after the line `  hasPlans: (spaceId) => plans.hasPlans(spaceId),`:

```ts
  covering: (spaceId, date, options) => plans.covering(spaceId, date, options),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project integration src/modules/budgeting/infrastructure && pnpm exec vitest run --project unit src/modules/budgeting`
Expected: PASS. Mutation check: temporarily replace `await query.for("share")` with `await query` — this test still passes (the lock is pinned by Task 8, which turns red then); restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/application/ports.ts src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.ts src/modules/budgeting/infrastructure/plan-lifecycle.int.test.ts src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts tests/support/in-memory-budgeting.ts
git commit -m "feat(budgeting): find the plan covering a date and change plan statuses in PostgreSQL (Refs #52, Refs #53, Refs #54)"
```

---

### Task 3: Budgeting — plan writes check the status after the lock, and the closed-period guard

Implements HU-E6-07 (issue #53) for every M3-A write and HU-E4-06's guard (issue #35, closed in M1; not reopened). Pins Review Focus 1 at the use case (N4) and Review Focus 2 (the guard on the period's edges).

Decisions:
- `planForWrite` finds the plan, takes `lockForWrite`, then **finds the plan again** inside the same transaction and checks only that read (preflight N4): the transaction sees the version it just gave the plan and the status as committed when the lock was granted, so a close committed while this write waited is seen. The status rule is a fourth parameter, `accepts`, defaulting to `editablePlan` (CLOSED → `PeriodClosed`); transitions pass their own (Task 4). Every M3-A write therefore refuses a CLOSED plan with no change to its use case.
- `createClosedPeriodGuard(plans)` is the ledger's `ClosedPeriodGuard`: a date is closed when the space's plan covering it is CLOSED; it reads that plan `FOR SHARE` (P14) so a ledger write and a close of its period run one after the other (raced in Task 8). It is bound in the composition root in Task 5b, when closing is reachable over HTTP.
- The in-memory transaction manager rolls nothing back, so an in-memory refusal after the lock leaves the version bumped; the PostgreSQL refusal rolls it back (Task 5b checks it over HTTP).

**Files:**
- Create: `src/modules/budgeting/application/closed-periods.ts`
- Modify: `src/modules/budgeting/application/plan-access.ts`, `src/modules/budgeting/application/index.ts`
- Test: `src/modules/budgeting/application/plans.test.ts`, create `src/modules/budgeting/application/closed-plans.test.ts`

**Interfaces:**
- Consumes: `editablePlan` (Task 1); `covering`, `InMemoryBudgetPlans.setStatus` (Task 2); every M3-A write use case; `budgetingWorld`, `householdCategories`, `referenceLines`.
- Produces:
  - `planForWrite(deps, input, authorize = managePlan, accepts: (plan: BudgetPlan) => Result<unknown> = editablePlan): Promise<Result<PlanWrite>>` — `PlanWrite.plan` is the plan read after the lock
  - `interface ClosedPeriods { isClosed(spaceId: string, date: LocalDate): Promise<boolean> }`; `createClosedPeriodGuard(plans: Pick<BudgetPlanRepository, "covering">): ClosedPeriods`

- [ ] **Step 1: Write the failing tests**

In `src/modules/budgeting/application/plans.test.ts`:

1. Insert after the line `import { requirePermission, type SpaceId } from "@/modules/spaces/application";`:

```ts
import { ok } from "@/shared/kernel";
```

2. Replace the line `import { planForWrite } from "./plan-access";` with:

```ts
import { managePlan, planForWrite } from "./plan-access";
```

3. Insert before the last line of the file (`});`):

```ts

  it("checks the status read after the lock, so a close committed while it waited refuses the write (N4)", async () => {
    const { deps, plans } = budgetingWorld();
    const plan = unwrap(await createCreateBudgetPlan(deps)(as("u-ana"))).plan;
    const lockForWrite = plans.lockForWrite.bind(plans);
    // A close commits while this write waits for the row lock: the plan it read before the lock is still DRAFT.
    plans.lockForWrite = async (planId, expectedVersion) => {
      await plans.setStatus(planId, "CLOSED");
      return lockForWrite(planId, expectedVersion);
    };
    expect(codeOf(await planForWrite(deps, write("u-ana", plan.id)))).toBe("PeriodClosed");
  });

  it("applies the status rule a transition passes instead of refusing CLOSED plans", async () => {
    const { deps, plans } = budgetingWorld();
    const plan = unwrap(await createCreateBudgetPlan(deps)(as("u-ana"))).plan;
    await plans.setStatus(plan.id, "CLOSED");
    const anyStatus = () => ok(undefined);
    expect(codeOf(await planForWrite(deps, write("u-ana", plan.id), managePlan, anyStatus))).toBe("ok");
    expect(codeOf(await planForWrite(deps, write("u-ana", plan.id)))).toBe("PeriodClosed");
  });
```

`src/modules/budgeting/application/closed-plans.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate, Result } from "@/shared/kernel";
import { referenceLines } from "../../../../tests/support/budget-fixtures";
import { budgetingWorld, HOUSEHOLD, householdCategories } from "../../../../tests/support/budgeting-world";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import type { PlanStatus } from "../domain/plan";
import { createAddBudgetLine } from "./add-budget-line";
import { createAllocateBudgetLine } from "./allocate-budget-line";
import { createClosedPeriodGuard } from "./closed-periods";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createMapCategoriesToLine } from "./map-categories-to-line";
import { createRemoveBudgetLine } from "./remove-budget-line";
import { createSetMemberCapacities } from "./set-member-capacities";
import { createUpdateBudgetLine } from "./update-budget-line";

const cop = (pesos: number) => money(BigInt(pesos) * 100n);

/**
 * The reference lines in Household's 2026-11 plan with `status`, 4,400,000 COP of capacity so that every write
 * below fits, and every M3-A write over it, in an order in which each succeeds on an editable plan.
 */
const world = async (status: PlanStatus) => {
  const w = budgetingWorld();
  const deps = {
    ...w.deps,
    capacities: w.plans,
    lines: w.plans,
    mappings: w.plans,
    allocations: w.plans,
    categories: householdCategories,
  };
  const create = createCreateBudgetPlan(deps);
  const plan = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" })).plan;
  w.plans.seed(plan.id, {
    capacities: [
      { memberId: "member-ana", amount: 200_000_000n },
      { memberId: "member-juan", amount: 240_000_000n },
    ],
    lines: referenceLines(),
  });
  await w.plans.setStatus(plan.id, status);
  const write = { spaceId: HOUSEHOLD, userId: "u-ana", planId: plan.id, expectedVersion: null };
  const home = { ...write, lineId: "line-home" };
  const writes: [string, () => Promise<Result<unknown>>][] = [
    ["add a line", () => createAddBudgetLine(deps)({ ...write, line: { name: "Travel", plannedAmount: cop(1) } })],
    ["edit a line", () => createUpdateBudgetLine(deps)({ ...home, changes: { plannedAmount: cop(1_500_000) } })],
    ["map categories", () => createMapCategoriesToLine(deps)({ ...home, categoryIds: ["cat-groceries"] })],
    ["allocate a line", () => createAllocateBudgetLine(deps)({ ...home, allocation: { rule: "NONE" } })],
    ["remove a line", () => createRemoveBudgetLine(deps)({ ...write, lineId: "line-free" })],
    [
      "set capacities",
      () =>
        createSetMemberCapacities(deps)({
          ...write,
          capacities: [{ memberId: "member-ana", amount: cop(1_500_000) }],
        }),
    ],
  ];
  return { ...w, plan, writes };
};

const answersOf = async (writes: [string, () => Promise<Result<unknown>>][]) => {
  const answers: [string, string][] = [];
  for (const [what, write] of writes) answers.push([what, codeOf(await write())]);
  return answers;
};

describe("a CLOSED plan refuses every edit (HU-E6-07)", () => {
  it("answers PeriodClosed to every write of the plan or its parts, and changes no part", async () => {
    const { plans, plan, writes } = await world("CLOSED");
    const before = await plans.contents(plan.id);
    expect(await answersOf(writes)).toEqual(writes.map(([what]) => [what, "PeriodClosed"]));
    expect(await plans.contents(plan.id)).toEqual(before);
  });

  it.each<PlanStatus>(["DRAFT", "ACTIVE"])("lets a %s plan be edited", async (status) => {
    const { writes } = await world(status);
    expect(await answersOf(writes)).toEqual(writes.map(([what]) => [what, "ok"]));
  });
});

describe("the closed-period guard (HU-E4-06, HU-E6-07)", () => {
  it("closes exactly the stored dates of a CLOSED plan of the space", async () => {
    const { plans, plan } = await world("ACTIVE");
    const guard = createClosedPeriodGuard(plans);
    const closed = (spaceId: string, date: string) => guard.isClosed(spaceId, date as LocalDate);
    expect(await closed(HOUSEHOLD, "2026-11-15")).toBe(false);
    await plans.setStatus(plan.id, "CLOSED");
    expect([
      await closed(HOUSEHOLD, "2026-10-31"),
      await closed(HOUSEHOLD, "2026-11-01"),
      await closed(HOUSEHOLD, "2026-11-30"),
      await closed(HOUSEHOLD, "2026-12-01"),
      await closed("space-ana", "2026-11-15"),
    ]).toEqual([false, true, true, false, false]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/application/plans.test.ts src/modules/budgeting/application/closed-plans.test.ts`
Expected: FAIL — `Failed to resolve import "./closed-periods"`; in `plans.test.ts` the N4 test gets `"ok"` instead of `"PeriodClosed"`.

- [ ] **Step 3: Implement**

Replace the contents of `src/modules/budgeting/application/plan-access.ts` with:

```ts
import {
  authorizeSpaceAction,
  requirePermission,
  type SpaceMember,
  type SpaceMembership,
} from "@/modules/spaces/application";
import { domainError, err, ok, type Result } from "@/shared/kernel";
import { editablePlan, type BudgetPlan } from "../domain/plan";
import type { BudgetingDeps } from "./deps";
import type { PlanContents } from "./ports";

/** A plan of a space the user may read (space.read); archived spaces read too (HU-E1-09). */
export const readablePlan = async (
  deps: Pick<BudgetingDeps, "access" | "plans">,
  input: { readonly spaceId: string; readonly userId: string; readonly planId: string },
): Promise<Result<{ space: SpaceMembership; plan: BudgetPlan }>> => {
  const reader = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
  if (!reader.ok) return reader;
  const plan = await deps.plans.find(reader.value.spaceId, input.planId);
  return plan === null ? err(domainError("BudgetPlanNotFound")) : ok({ space: reader.value, plan });
};

/** HU-E6-01 … HU-E6-07: writing a plan is the matrix action plan.manage (OWNER, ADMIN). */
export const managePlan = (membership: SpaceMembership): Result<SpaceMembership> =>
  requirePermission(membership, "plan.manage");

/** What a write to a plan sees once it holds the plan's version lock. */
export interface PlanWrite {
  readonly space: SpaceMembership;
  /** The plan as read after the lock (N4): its committed status and the version this write gives it (its ETag). */
  readonly plan: BudgetPlan;
  /** Current members in join order. */
  readonly members: readonly SpaceMember[];
  /** The plan's parts as committed before this write. */
  readonly parts: PlanContents;
}

/**
 * Every plan write starts here, inside its transaction: the membership (an archived space refuses, HU-E1-09), the
 * matrix (`authorize`), the plan, the version lock (If-Match, spec 7), the plan again, and only then the members
 * and parts, so writes to one plan run one at a time on committed data. The status rule (`accepts`: by default a
 * CLOSED plan refuses every edit, HU-E6-07) judges the plan read after the lock, never the one read before it
 * (preflight N4): a close committed while this write waited for the lock is seen.
 */
export const planForWrite = async (
  deps: Pick<BudgetingDeps, "access" | "members" | "plans" | "clock">,
  input: {
    readonly spaceId: string;
    readonly userId: string;
    readonly planId: string;
    readonly expectedVersion: number | null;
  },
  authorize: (membership: SpaceMembership) => Result<SpaceMembership> = managePlan,
  accepts: (plan: BudgetPlan) => Result<unknown> = editablePlan,
): Promise<Result<PlanWrite>> => {
  const membership = await deps.access(input.spaceId, input.userId);
  if (!membership.ok) return membership;
  const allowed = authorize(membership.value);
  if (!allowed.ok) return allowed;
  const space = allowed.value;
  const found = await deps.plans.find(space.spaceId, input.planId);
  if (found === null) return err(domainError("BudgetPlanNotFound"));
  const version = await deps.plans.lockForWrite(found.id, input.expectedVersion, deps.clock.now());
  if (version === null) return err(domainError("PreconditionFailed"));
  // N4: read again under the lock; this transaction sees the version it just gave the plan and its current status.
  const plan = await deps.plans.find(space.spaceId, found.id);
  if (plan === null) return err(domainError("BudgetPlanNotFound"));
  const accepted = accepts(plan);
  if (!accepted.ok) return accepted;
  const members = await deps.members.listCurrent(space.spaceId);
  const parts = await deps.plans.contents(plan.id);
  return ok({ space, plan, members, parts });
};
```

`src/modules/budgeting/application/closed-periods.ts`:

```ts
import type { LocalDate } from "@/shared/kernel";
import type { BudgetPlanRepository } from "./ports";

/** HU-E4-06, HU-E6-07: whether a date of a space falls within a CLOSED plan's stored period. */
export interface ClosedPeriods {
  isClosed(spaceId: string, date: LocalDate): Promise<boolean>;
}

/**
 * The ledger's ClosedPeriodGuard, bound by the composition root (the ledger never imports budgeting). It reads the
 * plan covering the date FOR SHARE (ruling P14): a ledger write waits for a close of that plan in progress and then
 * sees it, and a close waits for the ledger writes already inside the period.
 */
export const createClosedPeriodGuard = (plans: Pick<BudgetPlanRepository, "covering">): ClosedPeriods => ({
  isClosed: async (spaceId, date) => (await plans.covering(spaceId, date, { share: true }))?.status === "CLOSED",
});
```

Append to `src/modules/budgeting/application/index.ts`:

```ts
export { createClosedPeriodGuard, type ClosedPeriods } from "./closed-periods";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/budgeting && pnpm exec vitest run --project integration src/modules/budgeting`
Expected: PASS. Mutation check: in `planForWrite`, temporarily pass `found` instead of `plan` to `accepts` — the N4 test fails with `"ok"`; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/application/plan-access.ts src/modules/budgeting/application/closed-periods.ts src/modules/budgeting/application/index.ts src/modules/budgeting/application/plans.test.ts src/modules/budgeting/application/closed-plans.test.ts
git commit -m "feat(budgeting): refuse edits of closed plans after the row lock and guard closed periods (Refs #53, Refs #35)"
```

---

### Task 4: Budgeting — ActivateBudgetPlan and CloseBudgetPlan

Implements HU-E6-07 (issue #53) at the use-case level.

Decisions:
- Both go through `planForWrite` with `managePlan` and `(plan) => transitioned(plan, to)`, so their status check reads the plan after the lock (N4), a stale `If-Match` answers `PreconditionFailed`, and an archived space answers `SpaceArchived`.
- Activation checks `activationCheck` over `planFigures` of the parts read under the lock, with no spending (neither rule depends on it), **before** `setStatus`, so an in-memory refusal stores nothing either. Closing checks nothing but the transition: a plan whose figures no longer hold can still be closed (ruling P13).
- Both answer the whole plan with its new status and version (P9).

**Files:**
- Create: `src/modules/budgeting/application/plan-lifecycle.ts`
- Modify: `src/modules/budgeting/application/index.ts`
- Test: `src/modules/budgeting/application/lifecycle.test.ts`

**Interfaces:**
- Consumes: `transitioned`, `activationCheck` (Task 1); `PlanStatusRepository`, `InMemoryBudgetPlans.setStatus` (Task 2); `planForWrite`, `managePlan` (Task 3); `planFigures`, `loadPlanView` (M3-A).
- Produces:
  - `interface PlanTransitionInput { spaceId: string; userId: string; planId: string; expectedVersion: number | null }`
  - `type ActivateBudgetPlan = (input: PlanTransitionInput) => Promise<Result<BudgetPlanView>>`; `type CloseBudgetPlan` (same shape); `type PlanStatusDeps = BudgetingDeps & { statuses: PlanStatusRepository }`
  - `createActivateBudgetPlan(deps: PlanStatusDeps)` — `SpaceNotFound`, `SpaceArchived`, `InsufficientRole`, `BudgetPlanNotFound`, `PreconditionFailed`, `InvalidPlanTransition`, `PlanExceedsCapacity`, `InvalidAllocation`
  - `createCloseBudgetPlan(deps: PlanStatusDeps)` — the same without `PlanExceedsCapacity` and `InvalidAllocation`

- [ ] **Step 1: Write the failing tests**

`src/modules/budgeting/application/lifecycle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { referenceLines } from "../../../../tests/support/budget-fixtures";
import { BUDGET_MEMBERS, budgetingWorld, HOUSEHOLD } from "../../../../tests/support/budgeting-world";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import type { LineAllocation } from "../domain/allocation";
import type { BudgetLine } from "../domain/budget-line";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createActivateBudgetPlan, createCloseBudgetPlan } from "./plan-lifecycle";

const ANA_AND_JUAN = BUDGET_MEMBERS.filter((m) => m.displayName === "Ana" || m.displayName === "Juan");

/** HU-E6-07 Background: the reference plan for 2026-11 in Household, DRAFT, Ana 1,600,000 and Juan 2,400,000 COP. */
const world = async (
  parts: { lines?: BudgetLine[]; allocations?: LineAllocation[]; juan?: bigint } = {},
) => {
  const w = budgetingWorld({ members: ANA_AND_JUAN });
  const deps = { ...w.deps, statuses: w.plans };
  const create = createCreateBudgetPlan(deps);
  const plan = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" })).plan;
  w.plans.seed(plan.id, {
    capacities: [
      { memberId: "member-ana", amount: 160_000_000n },
      { memberId: "member-juan", amount: parts.juan ?? 240_000_000n },
    ],
    lines: parts.lines ?? referenceLines(),
    allocations: parts.allocations ?? [],
  });
  const input = (userId = "u-ana", expectedVersion: number | null = null) => ({
    spaceId: HOUSEHOLD,
    userId,
    planId: plan.id,
    expectedVersion,
  });
  const status = async () => (await w.plans.find(HOUSEHOLD, plan.id))?.status;
  return {
    ...w,
    plan,
    input,
    status,
    activate: createActivateBudgetPlan(deps),
    close: createCloseBudgetPlan(deps),
  };
};

describe("ActivateBudgetPlan (HU-E6-07)", () => {
  it("activates the valid reference plan and answers it with its new status and version", async () => {
    const { activate, input, status } = await world();
    const view = unwrap(await activate(input("u-ana", 1)));
    expect([view.plan.status, view.plan.version, await status()]).toEqual(["ACTIVE", 2, "ACTIVE"]);
    expect(view.figures.lines).toHaveLength(4);
  });

  it("refuses a plan whose Free percentages sum to 99 %, naming the line Free", async () => {
    const lines = referenceLines().map((l) =>
      l.name === "Free" ? { ...l, allocationRule: "PERCENT" as const } : l,
    );
    const allocations = [
      { lineId: "line-free", memberId: "member-ana", value: 4200n },
      { lineId: "line-free", memberId: "member-juan", value: 5700n },
    ];
    const { activate, input, status } = await world({ lines, allocations });
    expect(await activate(input())).toEqual({
      ok: false,
      error: { code: "InvalidAllocation", details: { lineIds: ["line-free"] } },
    });
    expect(await status()).toBe("DRAFT");
  });

  it("refuses a plan whose capacity was reduced: Juan at 2,000,000 COP", async () => {
    const { activate, input, status } = await world({ juan: 200_000_000n });
    expect(codeOf(await activate(input()))).toBe("PlanExceedsCapacity");
    expect(await status()).toBe("DRAFT");
  });

  it("activates only a DRAFT plan, only for owners and admins, and honours If-Match", async () => {
    const { activate, input } = await world();
    expect(codeOf(await activate(input("u-juan")))).toBe("InsufficientRole");
    expect(codeOf(await activate(input("u-ana", 7)))).toBe("PreconditionFailed");
    unwrap(await activate(input()));
    expect(codeOf(await activate(input()))).toBe("InvalidPlanTransition");
    expect(codeOf(await activate({ ...input(), planId: "budget-404" }))).toBe("BudgetPlanNotFound");
  });
});

describe("CloseBudgetPlan (HU-E6-07)", () => {
  it("closes an ACTIVE plan", async () => {
    const { activate, close, input, status } = await world();
    unwrap(await activate(input()));
    const view = unwrap(await close(input()));
    expect([view.plan.status, view.plan.version, await status()]).toEqual(["CLOSED", 3, "CLOSED"]);
  });

  it("closes only an ACTIVE plan: a DRAFT one answers InvalidPlanTransition", async () => {
    const { close, input, status } = await world();
    expect(codeOf(await close(input()))).toBe("InvalidPlanTransition");
    expect(await status()).toBe("DRAFT");
  });

  it("never reopens a CLOSED plan, nor closes it twice", async () => {
    const { activate, close, input } = await world();
    unwrap(await activate(input()));
    unwrap(await close(input()));
    expect([codeOf(await activate(input())), codeOf(await close(input()))]).toEqual([
      "InvalidPlanTransition",
      "InvalidPlanTransition",
    ]);
  });

  it("closes an ACTIVE plan whose figures no longer hold: only activation checks them (P13)", async () => {
    const { activate, close, input, plans, plan } = await world();
    unwrap(await activate(input()));
    plans.seed(plan.id, { capacities: [{ memberId: "member-juan", amount: 0n }] });
    expect(unwrap(await close(input())).figures.unallocated).toBe(-240_000_000n);
  });

  it("lets only owners and admins close", async () => {
    const { activate, close, input } = await world();
    unwrap(await activate(input()));
    expect(codeOf(await close(input("u-juan")))).toBe("InsufficientRole");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/application/lifecycle.test.ts`
Expected: FAIL — `Failed to resolve import "./plan-lifecycle"`.

- [ ] **Step 3: Implement**

`src/modules/budgeting/application/plan-lifecycle.ts`:

```ts
import { ok, type Result } from "@/shared/kernel";
import { transitioned } from "../domain/plan";
import { activationCheck, planFigures } from "../domain/plan-figures";
import type { BudgetingDeps } from "./deps";
import { managePlan, planForWrite } from "./plan-access";
import { loadPlanView, type BudgetPlanView } from "./plan-view";
import type { PlanStatusRepository } from "./ports";

export interface PlanTransitionInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly planId: string;
  /** If-Match: the plan version the caller last read; null skips the check. */
  readonly expectedVersion: number | null;
}

export type ActivateBudgetPlan = (input: PlanTransitionInput) => Promise<Result<BudgetPlanView>>;
export type CloseBudgetPlan = (input: PlanTransitionInput) => Promise<Result<BudgetPlanView>>;

export type PlanStatusDeps = BudgetingDeps & { readonly statuses: PlanStatusRepository };

/** Activation rules depend on capacities, lines and allocations only. */
const NO_SPENDING = { byCategory: [], byAccount: [] };

/**
 * HU-E6-07: an OWNER or ADMIN activates a DRAFT plan while its lines fit its capacity (PlanExceedsCapacity) and
 * every allocation holds (InvalidAllocation, naming the lines). From then on it drives default splits (HU-E6-08).
 */
export const createActivateBudgetPlan =
  (deps: PlanStatusDeps): ActivateBudgetPlan =>
  (input) =>
    deps.tm.run(async () => {
      const write = await planForWrite(deps, input, managePlan, (plan) => transitioned(plan, "ACTIVE"));
      if (!write.ok) return write;
      const { space, plan, members, parts } = write.value;
      const figures = planFigures({
        currency: space.currency,
        memberIds: members.map((m) => m.id),
        parts,
        spending: NO_SPENDING,
      });
      const valid = activationCheck(figures);
      if (!valid.ok) return valid;
      await deps.statuses.setStatus(plan.id, "ACTIVE", deps.clock.now());
      return ok(await loadPlanView(deps, space, { ...plan, status: "ACTIVE" }));
    });

/**
 * HU-E6-07: an OWNER or ADMIN closes an ACTIVE plan. From then on neither the plan nor the space's transactions
 * dated within its period change (PeriodClosed, HU-E4-06); there is no reopening in v1.
 */
export const createCloseBudgetPlan =
  (deps: PlanStatusDeps): CloseBudgetPlan =>
  (input) =>
    deps.tm.run(async () => {
      const write = await planForWrite(deps, input, managePlan, (plan) => transitioned(plan, "CLOSED"));
      if (!write.ok) return write;
      const { space, plan } = write.value;
      await deps.statuses.setStatus(plan.id, "CLOSED", deps.clock.now());
      return ok(await loadPlanView(deps, space, { ...plan, status: "CLOSED" }));
    });
```

Append to `src/modules/budgeting/application/index.ts`:

```ts
export type { PlanStatusRepository } from "./ports";
export {
  createActivateBudgetPlan,
  createCloseBudgetPlan,
  type ActivateBudgetPlan,
  type CloseBudgetPlan,
  type PlanStatusDeps,
  type PlanTransitionInput,
} from "./plan-lifecycle";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/budgeting`
Expected: PASS. Mutation check: temporarily move `await deps.statuses.setStatus(plan.id, "ACTIVE", …)` above `activationCheck` — "refuses a plan whose Free percentages sum to 99 %" fails on `status()` being `ACTIVE`; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/application/plan-lifecycle.ts src/modules/budgeting/application/index.ts src/modules/budgeting/application/lifecycle.test.ts
git commit -m "feat(budgeting): activate valid draft plans and close active ones (Refs #53)"
```

---

### Task 5a: HTTP — activate a plan

Implements HU-E6-07 (issue #53) over HTTP for activation. Pins Review Focus 3 (Luis leaves after taking 1 % of Free) and Review Focus 5 (unknown and malformed plan ids, an archived space).

Decisions:
- `POST /api/v1/spaces/{spaceId}/plans/{planId}/activate` has no body, honours an optional `If-Match` and answers `200` with the whole plan and its new `ETag` (P9, HU-E6-07 note "both honour If-Match").
- `InvalidPlanTransition` maps to `409` explicitly (a plan's state, not the request, refuses the move; without the entry the `Invalid*` convention would answer 422, ruling P12). `InvalidAllocation` gets one public extension member, `lineIds` (`publicDetailsOf`), so the problem names the flagged lines (HU-E6-07 "naming the line Free"); `AllocateBudgetLine`'s `InvalidAllocation` carries only `reason`, which stays private. `Problem` documents the optional `lineIds`.
- The container gets `activatePlan` and binds `statuses` to the plan repository.

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/plans/[planId]/activate/route.ts`, `tests/acceptance/budget-lifecycle.test.ts`
- Modify: `src/modules/budgeting/contracts/budgeting.contract.ts`, `src/shared/http/problem.ts`, `src/shared/http/contracts.ts`, `src/composition/container.ts`, `tests/support/budgeting.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E6-budgeting.md`
- Test: `src/shared/http/problem.test.ts`, `tests/acceptance/budget-lifecycle.test.ts`

**Interfaces:**
- Consumes: `createActivateBudgetPlan`, `ActivateBudgetPlan` (Task 4); `planWrite`, `PlanPath`, `planSuccess` (M3-A Tasks 9b, 11); `referencePlan`, `putAllocation`, `setCapacities`, `planOf`, `ifMatch`, `plansPath` (`tests/support/budgeting.ts`); `joinHousehold` (`tests/support/ledger.ts`).
- Produces: `Container.budgeting.activatePlan: ActivateBudgetPlan`; `activatePlan(user: TestUser, spaceId: string, planId: string, version?: number): Promise<Response>` in `tests/support/budgeting.ts`.

- [ ] **Step 1: Write the failing tests**

In `src/shared/http/problem.test.ts`:

1. Insert after the line `    ["InvalidAllocation", 422],`:

```ts
    ["InvalidPlanTransition", 409],
```

2. Insert before the last line of the file (`});`):

```ts

  it("names the flagged lines of an InvalidAllocation, and none of AllocateBudgetLine's reasons (HU-E6-07)", () => {
    expect(publicDetailsOf("InvalidAllocation", { lineIds: ["line-free"] })).toEqual({ lineIds: ["line-free"] });
    expect(publicDetailsOf("InvalidAllocation", { reason: "percentNotHundred" })).toEqual({});
  });
```

In `tests/support/budgeting.ts`:

1. Insert after the line `import { PUT as putAllocationRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/allocation/route";`:

```ts
import { POST as activateRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/activate/route";
```

2. Append to the end of the file:

```ts

/** HU-E6-07: `user` activates the plan. */
export const activatePlan = (user: TestUser, spaceId: string, planId: string, version?: number) =>
  call(activateRoute, "POST", plansPath(spaceId, `/${planId}/activate`), {
    user,
    params: { spaceId, planId },
    headers: ifMatch(version),
  });
```

`tests/acceptance/budget-lifecycle.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, startTestApp } from "../support/app";
import {
  activatePlan,
  planOf,
  putAllocation,
  referencePlan,
  setCapacities,
  type PlanDto,
} from "../support/budgeting";
import { joinHousehold } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** Activates the plan and returns it; fails the test unless 200. */
const activated = async (...args: Parameters<typeof activatePlan>): Promise<PlanDto> => {
  const response = await activatePlan(...args);
  expect(response.status).toBe(200);
  return (await response.json()) as PlanDto;
};

/** HU-E1-09: `owner` archives the space; nothing was recorded, so every balance is settled. */
const archive = async (owner: Parameters<typeof activatePlan>[0], spaceId: string) => {
  const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${spaceId}/archive`, {
    user: owner,
    params: { spaceId },
  });
  expect(archived.status).toBe(204);
};

describe("activating a plan (HU-E6-07)", () => {
  it("activates the valid reference plan and answers it with its new ETag", async () => {
    const { h, planId, plan } = await referencePlan();
    const response = await activatePlan(h.ana, h.spaceId, planId, plan.version);
    expect([response.status, response.headers.get("etag")]).toEqual([200, `"${plan.version + 1}"`]);
    const body = (await response.json()) as PlanDto;
    expect([body.status, body.version, body.lines.length]).toEqual(["ACTIVE", plan.version + 1, 4]);
    expect((await planOf(h.juan, h.spaceId, planId)).status).toBe("ACTIVE");
  });

  it("refuses a plan whose Free percentages sum to 99 % once Luis left, naming Free (Review Focus 3)", async () => {
    const { h, planId, lineId } = await referencePlan();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    const free = lineId("Free");
    const split = {
      rule: "PERCENT",
      members: [
        { memberId: h.ana.memberId, percent: "42" },
        { memberId: h.juan.memberId, percent: "57" },
        { memberId: luis.memberId, percent: "1" },
      ],
    };
    expect((await putAllocation(h.ana, h.spaceId, planId, free, split)).status).toBe(200);
    const left = await call(leaveSpace, "POST", `/api/v1/spaces/${h.spaceId}/leave`, {
      user: luis,
      params: { spaceId: h.spaceId },
    });
    expect(left.status).toBe(204);
    const response = await activatePlan(h.ana, h.spaceId, planId);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "InvalidAllocation", lineIds: [free] });
    expect((await planOf(h.ana, h.spaceId, planId)).status).toBe("DRAFT");
  });

  it("refuses a plan whose capacity was reduced below its lines: Juan at 2,000,000 COP", async () => {
    const { h, planId } = await referencePlan();
    await setCapacities(h.ana, h.spaceId, planId, [[h.juan.memberId, 2_000_000]]);
    expect(await problemOf(await activatePlan(h.ana, h.spaceId, planId))).toEqual([409, "PlanExceedsCapacity"]);
  });

  it("activates only a DRAFT plan, only for owners and admins, and honours If-Match", async () => {
    const { h, planId, plan } = await referencePlan();
    expect(await problemOf(await activatePlan(h.juan, h.spaceId, planId))).toEqual([403, "InsufficientRole"]);
    expect(await problemOf(await activatePlan(h.ana, h.spaceId, planId, plan.version + 5))).toEqual([
      412,
      "PreconditionFailed",
    ]);
    await activated(h.ana, h.spaceId, planId);
    expect(await problemOf(await activatePlan(h.ana, h.spaceId, planId))).toEqual([409, "InvalidPlanTransition"]);
  });

  it("answers BudgetPlanNotFound for unknown and malformed plan ids, and SpaceArchived in an archived space", async () => {
    const { h, planId } = await referencePlan();
    expect(await problemOf(await activatePlan(h.ana, h.spaceId, "not-a-uuid"))).toEqual([
      404,
      "BudgetPlanNotFound",
    ]);
    expect(
      await problemOf(await activatePlan(h.ana, h.spaceId, "0190a0a0-0000-7000-8000-000000000000")),
    ).toEqual([404, "BudgetPlanNotFound"]);
    await archive(h.ana, h.spaceId);
    expect(await problemOf(await activatePlan(h.ana, h.spaceId, planId))).toEqual([409, "SpaceArchived"]);
    expect((await planOf(h.ana, h.spaceId, planId)).status).toBe("DRAFT");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/shared/http/problem.test.ts && pnpm exec vitest run --project acceptance tests/acceptance/budget-lifecycle.test.ts`
Expected: FAIL — `maps InvalidPlanTransition to 409` gets 422, the public-details test gets `{}`, and the acceptance file fails with `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/plans/[planId]/activate/route"`.

- [ ] **Step 3: Implement**

In `src/shared/http/problem.ts`:

1. Insert before the line `  ["InvitationEmailMismatch", 403],`:

```ts
  // HU-E6-07: the plan's state, not the request, refuses the move (ruling P12).
  ["InvalidPlanTransition", 409],
```

2. Insert after the line `  ["OutstandingBalance", ["outstanding"]],`:

```ts
  ["InvalidAllocation", ["lineIds"]],
```

In `src/shared/http/contracts.ts`, insert after the line `  outstanding: MoneySchema.optional(),`:

```ts
  /** InvalidAllocation on activation only (HU-E6-07): the lines whose allocation does not hold, in plan order. */
  lineIds: z.array(z.string()).optional(),
```

In `src/modules/budgeting/contracts/budgeting.contract.ts`, insert before the last line of the file (`};`):

```ts
  "/api/v1/spaces/{spaceId}/plans/{planId}/activate": {
    post: planWrite(
      "activateBudgetPlan",
      "Activate a DRAFT plan whose lines fit its capacity and whose every allocation holds; it then drives default splits",
      PlanPath,
      null,
      {
        "404": "SpaceNotFound, BudgetPlanNotFound",
        "409": "InvalidPlanTransition, PlanExceedsCapacity, SpaceArchived",
        "422": "InvalidAllocation (lineIds names the lines whose allocation does not hold)",
      },
    ),
  },
```

`src/app/api/v1/spaces/[spaceId]/plans/[planId]/activate/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { planSuccess } from "@/modules/budgeting/contracts/budgeting.contract";
import { ifMatchVersion } from "@/shared/http";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ request, user, params }) => {
    // Spec 7, HU-E6-07: If-Match is checked when present; a stale version is 412.
    const expectedVersion = ifMatchVersion(request);
    if (!expectedVersion.ok) return expectedVersion;
    const result = await getContainer().budgeting.activatePlan({
      spaceId: params.spaceId!,
      userId: user!.id,
      planId: params.planId!,
      expectedVersion: expectedVersion.value,
    });
    return result.ok ? ok(planSuccess(result.value)) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert before the line `  type CreateBudgetPlan,`:

```ts
  createActivateBudgetPlan,
  type ActivateBudgetPlan,
```

2. Insert after the line `    readonly allocateLine: AllocateBudgetLine;`:

```ts
    readonly activatePlan: ActivateBudgetPlan;
```

3. Insert after the line `    allocations: budgetPlans,`:

```ts
    statuses: budgetPlans,
```

4. Insert after the line `      allocateLine: createAllocateBudgetLine(budgetingDeps),`:

```ts
      activatePlan: createActivateBudgetPlan(budgetingDeps),
```

In `docs/backlog/E6-budgeting.md`, insert after the line `- Provides the `ClosedPeriodGuard` adapter used by `ledger` (HU-E4-06).`:

```markdown
- `POST …/plans/{planId}/activate` has no body, honours an optional `If-Match` and answers the whole plan with its new `ETag` (like every plan write). Activation checks, in this order, that Σ planned does not exceed the current members' capacity (`PlanExceedsCapacity`, 409) and that every allocation holds (`InvalidAllocation`, 422, whose problem lists the flagged lines in `lineIds`). An ACTIVE plan stays editable and is not checked again. Other errors: `InvalidPlanTransition` (409: any move other than DRAFT → ACTIVE → CLOSED), `BudgetPlanNotFound` (404, malformed ids included), `SpaceArchived` (409).
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `POST /api/v1/spaces/{spaceId}/plans/{planId}/activate` (about 110 lines, referencing `BudgetPlan`) and the optional `lineIds` of `components.schemas.Problem` (about 8 lines); no `…Output` variant appears.
Then run: `pnpm exec vitest run --project unit src/shared/http src/composition && pnpm exec vitest run --project acceptance tests/acceptance/budget-lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/v1/spaces/[spaceId]/plans/[planId]/activate/route.ts" src/modules/budgeting/contracts/budgeting.contract.ts src/shared/http/problem.ts src/shared/http/problem.test.ts src/shared/http/contracts.ts src/composition/container.ts openapi/openapi.snapshot.json docs/backlog/E6-budgeting.md tests/support/budgeting.ts tests/acceptance/budget-lifecycle.test.ts
git commit -m "feat(budgeting): activate a plan over HTTP, naming the lines whose allocation does not hold (Refs #53)"
```

---

### Task 5b: HTTP — close a plan and freeze its period

Implements HU-E6-07 (issue #53) over HTTP for closing, and activates HU-E4-06's closed-period scenario (issue #35, closed in M1; not reopened). Pins Review Focus 2 (the period's edges, moving an expense into it) and Review Focus 5 (archived spaces).

Decisions:
- `POST /api/v1/spaces/{spaceId}/plans/{planId}/close` mirrors activation (no body, optional `If-Match`, whole plan and `ETag`).
- The container binds the ledger's `closedPeriods` to `createClosedPeriodGuard(budgetPlans)`: every ledger write that calls `openPeriod` (record expense, income, transfer, fund contribution and settlement; edit, both the old and the new date; delete) answers `409 PeriodClosed` inside a CLOSED plan's stored dates. Transactions of other spaces are not affected, so a transfer into a SAVINGS line's account recorded in a personal space still moves that line's `spent` after the close (ruling P19).
- `planWrite` documents `PeriodClosed` on the 409 of every edit of a plan or its parts; activation and closing pass `editsPlan = false` (they answer `InvalidPlanTransition` instead).

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/plans/[planId]/close/route.ts`
- Modify: `src/modules/budgeting/contracts/budgeting.contract.ts`, `src/composition/container.ts`, `tests/support/budgeting.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E6-budgeting.md`, `docs/backlog/E4-ledger.md`, `docs/backlog/README.md`
- Test: `tests/acceptance/budget-lifecycle.test.ts`

**Interfaces:**
- Consumes: `createCloseBudgetPlan`, `CloseBudgetPlan` (Task 4); `createClosedPeriodGuard` (Task 3); `activatePlan` (Task 5a); the M3-A HTTP helpers; `post`, `cop` (`tests/support/ledger.ts`); the ledger's expense and transaction routes.
- Produces: `Container.budgeting.closePlan: CloseBudgetPlan`; `closePlan(user: TestUser, spaceId: string, planId: string, version?: number): Promise<Response>` in `tests/support/budgeting.ts`.

- [ ] **Step 1: Write the failing tests**

In `tests/support/budgeting.ts`:

1. Insert after the line `import { POST as activateRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/activate/route";`:

```ts
import { POST as closeRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/close/route";
```

2. Append to the end of the file:

```ts

/** HU-E6-07: `user` closes the plan. */
export const closePlan = (user: TestUser, spaceId: string, planId: string, version?: number) =>
  call(closeRoute, "POST", plansPath(spaceId, `/${planId}/close`), {
    user,
    params: { spaceId, planId },
    headers: ifMatch(version),
  });
```

In `tests/acceptance/budget-lifecycle.test.ts`:

1. Replace the line `import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";` with:

```ts
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import {
  DELETE as deleteTransaction,
  PATCH as editTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
```

2. Replace the block from the two-line anchor `import {` + `  activatePlan,` (the `../support/budgeting` import; item 1 added a second `import {`) through the line `} from "../support/budgeting";` with:

```ts
import {
  activatePlan,
  closePlan,
  deleteLine,
  patchLine,
  planOf,
  postLine,
  putAllocation,
  putCapacities,
  putCategories,
  referencePlan,
  setCapacities,
  type PlanDto,
} from "../support/budgeting";
```

3. Replace the line `import { joinHousehold } from "../support/ledger";` with:

```ts
import { cop, joinHousehold, post, type HouseholdMember } from "../support/ledger";
```

4. Append to the end of the file:

```ts

/** `payer` pays `pesos` of groceries on `date` from their own account, split by default. */
const spend = (payer: HouseholdMember, categoryId: string, pesos: number, date: string) =>
  post(recordExpense, payer, "expenses", {
    description: "Market",
    date,
    categoryId,
    amount: cop(pesos),
    accountId: payer.account,
  });
const idOf = async (response: Response) => {
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
};

/** The reference plan with expenses on 2026-11-03 and 2026-12-02, then activated and closed. */
const closedReference = async () => {
  const ref = await referencePlan();
  const { h, planId } = ref;
  const november = await idOf(await spend(h.ana, h.groceries, 85_000, "2026-11-03"));
  const december = await idOf(await spend(h.ana, h.groceries, 40_000, "2026-12-02"));
  await activated(h.ana, h.spaceId, planId);
  const response = await closePlan(h.ana, h.spaceId, planId);
  expect(response.status).toBe(200);
  const plan = (await response.json()) as PlanDto;
  expect([plan.status, response.headers.get("etag")]).toEqual(["CLOSED", `"${plan.version}"`]);
  const transaction = (id: string) => `/api/v1/spaces/${h.spaceId}/transactions/${id}`;
  const edit = (id: string, body: unknown) =>
    call(editTransaction, "PATCH", transaction(id), {
      user: h.ana,
      params: { spaceId: h.spaceId, transactionId: id },
      body,
    });
  const remove = (id: string) =>
    call(deleteTransaction, "DELETE", transaction(id), {
      user: h.ana,
      params: { spaceId: h.spaceId, transactionId: id },
    });
  return { ...ref, plan, november, december, edit, remove };
};

describe("closing a plan (HU-E6-07)", () => {
  it("closes an ACTIVE plan, after which its period's transactions no longer change (@critical, HU-E4-06)", async () => {
    const { h, november, december, edit, remove } = await closedReference();
    expect(await problemOf(await spend(h.ana, h.groceries, 50_000, "2026-11-15"))).toEqual([409, "PeriodClosed"]);
    expect(await problemOf(await spend(h.juan, h.groceries, 50_000, "2026-11-30"))).toEqual([409, "PeriodClosed"]);
    expect(await problemOf(await edit(november, { description: "Market, corrected" }))).toEqual([
      409,
      "PeriodClosed",
    ]);
    expect(await problemOf(await remove(november))).toEqual([409, "PeriodClosed"]);
    expect(await problemOf(await edit(december, { date: "2026-11-20" }))).toEqual([409, "PeriodClosed"]);
    await idOf(await spend(h.ana, h.groceries, 50_000, "2026-12-01"));
    await idOf(await spend(h.ana, h.groceries, 50_000, "2026-10-31"));
  });

  it("refuses every edit of a CLOSED plan with 409 PeriodClosed, and changes nothing", async () => {
    const { h, planId, lineId, plan } = await closedReference();
    const home = lineId("Home");
    const writes: [string, () => Promise<Response>][] = [
      ["set capacities", () => putCapacities(h.ana, h.spaceId, planId, [[h.ana.memberId, 1]])],
      ["add a line", () => postLine(h.ana, h.spaceId, planId, { name: "Travel", pesos: 1 })],
      ["edit a line", () => patchLine(h.ana, h.spaceId, planId, home, { pesos: 1_500_000 })],
      ["remove a line", () => deleteLine(h.ana, h.spaceId, planId, home)],
      ["map categories", () => putCategories(h.ana, h.spaceId, planId, home, [h.groceries])],
      ["allocate a line", () => putAllocation(h.ana, h.spaceId, planId, home, { rule: "NONE" })],
    ];
    const answers: [string, number, string][] = [];
    for (const [what, write] of writes) answers.push([what, ...(await problemOf(await write()))]);
    expect(answers).toEqual(writes.map(([what]) => [what, 409, "PeriodClosed"]));
    expect(await problemOf(await activatePlan(h.ana, h.spaceId, planId))).toEqual([409, "InvalidPlanTransition"]);
    expect(await problemOf(await closePlan(h.ana, h.spaceId, planId))).toEqual([409, "InvalidPlanTransition"]);
    expect(await planOf(h.ana, h.spaceId, planId)).toEqual(plan);
  });

  it("closes only an ACTIVE plan, only for owners and admins", async () => {
    const { h, planId } = await referencePlan();
    expect(await problemOf(await closePlan(h.ana, h.spaceId, planId))).toEqual([409, "InvalidPlanTransition"]);
    await activated(h.ana, h.spaceId, planId);
    expect(await problemOf(await closePlan(h.juan, h.spaceId, planId))).toEqual([403, "InsufficientRole"]);
    expect(await problemOf(await closePlan(h.ana, h.spaceId, planId, 1))).toEqual([412, "PreconditionFailed"]);
  });

  it("refuses to close in an archived space (HU-E1-09)", async () => {
    const { h, planId } = await referencePlan();
    await activated(h.ana, h.spaceId, planId);
    await archive(h.ana, h.spaceId);
    expect(await problemOf(await closePlan(h.ana, h.spaceId, planId))).toEqual([409, "SpaceArchived"]);
    expect((await planOf(h.ana, h.spaceId, planId)).status).toBe("ACTIVE");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/budget-lifecycle.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/plans/[planId]/close/route"`.

- [ ] **Step 3: Implement**

In `src/modules/budgeting/contracts/budgeting.contract.ts`:

1. Replace the block from the line `/** A write to a plan (HU-E6-02 … HU-E6-05): If-Match is optional, and the answer is the plan with its new ETag. */` through the line `});` that ends `planWrite` (the last line before the blank line above `export const budgetingPaths: ZodOpenApiPathsObject = {`) with:

```ts
/**
 * A write to a plan (HU-E6-02 … HU-E6-07): If-Match is optional, and the answer is the plan with its new ETag. Every
 * edit of a plan or its parts answers 409 PeriodClosed once the plan is CLOSED; its transitions (`editsPlan` false)
 * answer InvalidPlanTransition instead.
 */
const planWrite = <P extends z.ZodObject>(
  operationId: string,
  summary: string,
  path: P,
  body: z.ZodType | null,
  errors: Record<string, string>,
  status: "200" | "201" = "200",
  editsPlan = true,
) => ({
  operationId,
  summary,
  ...securedByUser,
  requestParams: { path, header: IfMatchHeader },
  ...(body === null ? {} : { requestBody: { content: jsonContent(body) } }),
  responses: {
    [status]: planResponse("The plan with its new ETag"),
    ...problems({
      "401": "Unauthenticated",
      "403": "InsufficientRole",
      "412": "PreconditionFailed",
      ...errors,
      ...(editsPlan ? { "409": ["PeriodClosed", errors["409"]].filter(Boolean).join(", ") } : {}),
    }),
  },
});
```

2. Replace the block from the line `  "/api/v1/spaces/{spaceId}/plans/{planId}/activate": {` through the line `  },` that closes it (the last line before the final `};`) with:

```ts
  "/api/v1/spaces/{spaceId}/plans/{planId}/activate": {
    post: planWrite(
      "activateBudgetPlan",
      "Activate a DRAFT plan whose lines fit its capacity and whose every allocation holds; it then drives default splits",
      PlanPath,
      null,
      {
        "404": "SpaceNotFound, BudgetPlanNotFound",
        "409": "InvalidPlanTransition, PlanExceedsCapacity, SpaceArchived",
        "422": "InvalidAllocation (lineIds names the lines whose allocation does not hold)",
      },
      "200",
      false,
    ),
  },
  "/api/v1/spaces/{spaceId}/plans/{planId}/close": {
    post: planWrite(
      "closeBudgetPlan",
      "Close an ACTIVE plan: neither the plan nor the space's transactions dated in its period change any more",
      PlanPath,
      null,
      { "404": "SpaceNotFound, BudgetPlanNotFound", "409": "InvalidPlanTransition, SpaceArchived" },
      "200",
      false,
    ),
  },
```

`src/app/api/v1/spaces/[spaceId]/plans/[planId]/close/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { planSuccess } from "@/modules/budgeting/contracts/budgeting.contract";
import { ifMatchVersion } from "@/shared/http";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ request, user, params }) => {
    // Spec 7, HU-E6-07: If-Match is checked when present; a stale version is 412.
    const expectedVersion = ifMatchVersion(request);
    if (!expectedVersion.ok) return expectedVersion;
    const result = await getContainer().budgeting.closePlan({
      spaceId: params.spaceId!,
      userId: user!.id,
      planId: params.planId!,
      expectedVersion: expectedVersion.value,
    });
    return result.ok ? ok(planSuccess(result.value)) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert before the line `  type CreateBudgetPlan,`:

```ts
  createCloseBudgetPlan,
  createClosedPeriodGuard,
  type CloseBudgetPlan,
```

2. Insert after the line `    readonly activatePlan: ActivateBudgetPlan;`:

```ts
    readonly closePlan: CloseBudgetPlan;
```

3. Replace the two lines `    // Closing plans arrives with HU-E6-07; until then no period is closed.` and `    closedPeriods: { isClosed: async () => false },` with:

```ts
    // HU-E4-06, HU-E6-07: a CLOSED plan's period takes no change; budgeting answers, the ledger never imports it.
    closedPeriods: createClosedPeriodGuard(budgetPlans),
```

4. Insert after the line `      activatePlan: createActivateBudgetPlan(budgetingDeps),`:

```ts
      closePlan: createCloseBudgetPlan(budgetingDeps),
```

In `docs/backlog/E6-budgeting.md`, insert after the line that starts with `- `POST …/plans/{planId}/activate` has no body,` (added in Task 5a):

```markdown
- `POST …/plans/{planId}/close` mirrors activation and checks nothing but the transition (ACTIVE → CLOSED). Once CLOSED, every edit of the plan or its parts answers `PeriodClosed` (409), and so does every write of the space's ledger dated within the plan's stored dates (record, edit on either date, delete; HU-E4-06). The guard reads the plan covering the date `FOR SHARE`, so a ledger write and a close of its period run one after the other. Figures stay derived on read: a transfer recorded in a personal space into a SAVINGS line's account, or a member leaving, still changes a closed plan's figures.
```

In `docs/backlog/E4-ledger.md`, replace the line `- The closed-period scenario becomes active with HU-E6-07; until then the `ClosedPeriodGuard` port has an always-open adapter.` with:

```markdown
- The closed-period scenario is active since HU-E6-07 (M3-B): the composition root binds `ClosedPeriodGuard` to budgeting's guard, which reads the plan covering the date `FOR SHARE`, so a write and a close of that period run one after the other.
```

In `docs/backlog/README.md`, replace the line `- The closed-period scenario of HU-E4-06 (M1) activates once HU-E6-07 (M3) provides the `ClosedPeriodGuard` adapter.` with:

```markdown
- The closed-period scenario of HU-E4-06 (M1) is active since HU-E6-07 (M3-B) provides the `ClosedPeriodGuard` adapter.
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds `POST /api/v1/spaces/{spaceId}/plans/{planId}/close` (about 100 lines) and changes only the 409 description of `setMemberCapacities`, `addBudgetLine`, `updateBudgetLine`, `removeBudgetLine`, `mapCategoriesToLine` and `allocateBudgetLine` (each now starts with `PeriodClosed, `); `activateBudgetPlan` and every component are unchanged.
Then run: `pnpm exec vitest run --project acceptance tests/acceptance/budget-lifecycle.test.ts tests/acceptance/ledger.test.ts tests/acceptance/shared-expenses.test.ts`
Expected: PASS. Mutation check: temporarily restore `closedPeriods: { isClosed: async () => false }` — the @critical scenario fails with 201 instead of 409; restore the binding.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/v1/spaces/[spaceId]/plans/[planId]/close/route.ts" src/modules/budgeting/contracts/budgeting.contract.ts src/composition/container.ts openapi/openapi.snapshot.json docs/backlog/E6-budgeting.md docs/backlog/E4-ledger.md docs/backlog/README.md tests/support/budgeting.ts tests/acceptance/budget-lifecycle.test.ts
git commit -m "feat(budgeting): close a plan over HTTP and freeze its period in the ledger (Refs #53, Refs #35)"
```

---

### Task 6: Budgeting domain — copy a plan's parts

Implements the pure deep clone of HU-E6-06 (issue #52). Pins Review Focus 3 (Luis left; accounts that no longer qualify) at the domain level.

Decisions:
- `copiedParts` clones the source plan's committed parts with new line ids (given in source order): each line keeps its name, planned amount, funding, rollover mode, catch-all flag and allocation rule, and links to its source line through `originLineId` (HU-E6-09). Copies are created one millisecond apart, starting at `now`, so every reader lists them in the source's order (`contents` orders by `created_at`, then id).
- Left out: capacities and allocation values of members who are no longer current (HU-E6-06 note "former members … excluded"; a PERCENT or FIXED line that named them is then flagged `InvalidAllocation` on read, ruling P7); mappings to categories that are archived or no longer live (listed in `dropped.mappings` by the copied line); savings accounts not in `usableAccountIds` (listed in `dropped.savingsAccounts` by the copied line); and SAVINGS lines left without any account, which are not copied (listed in `dropped.lines` by their source line and name, because a SAVINGS line needs an account, `budget_lines_savings_accounts`). Ruling P10.
- Nothing is checked against capacity: the copy is a DRAFT and activation checks it (HU-E6-07).

**Files:**
- Create: `src/modules/budgeting/domain/plan-copy.ts`
- Test: `src/modules/budgeting/domain/plan-copy.test.ts`

**Interfaces:**
- Consumes: `PlanParts` (M3-A Task 4); `BudgetLine`, `BudgetLineId`, `CategoryMapping` (M3-A Task 2); `LineAllocation` (M3-A Task 3); `aLine`, `referenceLines`.
- Produces:
  - `interface CopyDrops { mappings: readonly CategoryMapping[]; savingsAccounts: readonly { lineId: string; accountId: string }[]; lines: readonly { originLineId: string; name: string }[] }`
  - `interface CopyInput { planId: string; now: Date; source: PlanParts; lineIds: readonly BudgetLineId[]; memberIds: readonly string[]; categories: readonly { id: string; archived: boolean }[]; usableAccountIds: readonly string[] }`
  - `copiedParts(input: CopyInput): { parts: PlanParts; dropped: CopyDrops }`

- [ ] **Step 1: Write the failing test**

`src/modules/budgeting/domain/plan-copy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { aLine, referenceLines } from "../../../../tests/support/budget-fixtures";
import type { BudgetLineId } from "./budget-line";
import { copiedParts, type CopyInput } from "./plan-copy";
import type { PlanParts } from "./plan-figures";

const NOW = new Date("2026-11-30T12:00:00Z");
const ANA = "member-ana";
const JUAN = "member-juan";
const LUIS = "member-luis";

/** HU-E6-06 Background: the reference plan for 2026-11 with its capacities, lines, mappings and allocations. */
const november = (overrides: Partial<PlanParts> = {}): PlanParts => ({
  capacities: [
    { memberId: ANA, amount: 160_000_000n },
    { memberId: JUAN, amount: 240_000_000n },
  ],
  lines: referenceLines().map((l) => (l.name === "Free" ? { ...l, allocationRule: "PERCENT" as const } : l)),
  mappings: [
    { lineId: "line-home", categoryId: "cat-groceries" },
    { lineId: "line-home", categoryId: "cat-utilities" },
  ],
  allocations: [
    { lineId: "line-free", memberId: ANA, value: 4200n },
    { lineId: "line-free", memberId: JUAN, value: 5800n },
  ],
  ...overrides,
});

const copy = (source: PlanParts, overrides: Partial<CopyInput> = {}) =>
  copiedParts({
    planId: "plan-december",
    now: NOW,
    source,
    lineIds: source.lines.map((l) => `copy-${l.id}` as BudgetLineId),
    memberIds: [ANA, JUAN],
    categories: [
      { id: "cat-groceries", archived: false },
      { id: "cat-utilities", archived: false },
    ],
    usableAccountIds: ["acc-savings"],
    ...overrides,
  });

describe("copiedParts (HU-E6-06)", () => {
  it("clones capacities, lines, mappings and allocations with new ids and links to the source lines (@critical)", () => {
    const { parts, dropped } = copy(november());
    expect(parts.capacities).toEqual(november().capacities);
    expect(
      parts.lines.map((l) => [l.id, l.planId, l.originLineId, l.name, l.plannedAmount, l.funding, l.rolloverMode]),
    ).toEqual([
      ["copy-line-rent", "plan-december", "line-rent", "Rent", 120_000_000n, "SHARED_FUND", "RESET"],
      ["copy-line-home", "plan-december", "line-home", "Home", 147_000_000n, "DIRECT", "RESET"],
      ["copy-line-savings", "plan-december", "line-savings", "Savings", 60_000_000n, "SAVINGS", "RESET"],
      ["copy-line-free", "plan-december", "line-free", "Free", 73_000_000n, "DIRECT", "RESET"],
    ]);
    expect(parts.lines.map((l) => [l.isCatchAll, l.allocationRule, l.savingsAccountIds])).toEqual([
      [false, "PROPORTIONAL", []],
      [false, "PROPORTIONAL", []],
      [false, "PROPORTIONAL", ["acc-savings"]],
      [true, "PERCENT", []],
    ]);
    expect(parts.mappings).toEqual([
      { lineId: "copy-line-home", categoryId: "cat-groceries" },
      { lineId: "copy-line-home", categoryId: "cat-utilities" },
    ]);
    expect(parts.allocations).toEqual([
      { lineId: "copy-line-free", memberId: ANA, value: 4200n },
      { lineId: "copy-line-free", memberId: JUAN, value: 5800n },
    ]);
    expect(dropped).toEqual({ mappings: [], savingsAccounts: [], lines: [] });
  });

  it("keeps the source's line order: each copy is created a millisecond after the one before", () => {
    const { parts } = copy(november());
    expect(parts.lines.map((l) => l.createdAt.getTime() - NOW.getTime())).toEqual([0, 1, 2, 3]);
  });

  it("drops the mapping of a category archived since, and one that is no longer live, listing both", () => {
    const archived = copy(november(), {
      categories: [
        { id: "cat-groceries", archived: false },
        { id: "cat-utilities", archived: true },
      ],
    });
    expect(archived.parts.mappings).toEqual([{ lineId: "copy-line-home", categoryId: "cat-groceries" }]);
    expect(archived.dropped.mappings).toEqual([{ lineId: "copy-line-home", categoryId: "cat-utilities" }]);
    const gone = copy(november(), { categories: [{ id: "cat-groceries", archived: false }] });
    expect(gone.dropped.mappings).toEqual([{ lineId: "copy-line-home", categoryId: "cat-utilities" }]);
  });

  it("leaves out Luis, who left: his capacity and his 10 % of Free, whose values then no longer add up", () => {
    const { parts } = copy(
      november({
        capacities: [
          { memberId: ANA, amount: 160_000_000n },
          { memberId: JUAN, amount: 240_000_000n },
          { memberId: LUIS, amount: 50_000_000n },
        ],
        allocations: [
          { lineId: "line-free", memberId: ANA, value: 4200n },
          { lineId: "line-free", memberId: JUAN, value: 4800n },
          { lineId: "line-free", memberId: LUIS, value: 1000n },
        ],
      }),
    );
    expect(parts.capacities.map((c) => c.memberId)).toEqual([ANA, JUAN]);
    expect(parts.allocations.map((a) => [a.memberId, a.value])).toEqual([
      [ANA, 4200n],
      [JUAN, 4800n],
    ]);
  });

  it("keeps the accounts that still qualify, lists the others, and leaves out a SAVINGS line left without one (P10)", () => {
    const lines = [
      aLine("Savings", 60_000_000n, { funding: "SAVINGS", savingsAccountIds: ["acc-savings", "acc-juan-savings"] }),
      aLine("Reserve", 10_000_000n, { funding: "SAVINGS", savingsAccountIds: ["acc-old-savings"] }),
      aLine("Home", 147_000_000n),
    ];
    const { parts, dropped } = copy(november({ lines, mappings: [], allocations: [] }));
    expect(parts.lines.map((l) => [l.name, l.savingsAccountIds])).toEqual([
      ["Savings", ["acc-savings"]],
      ["Home", []],
    ]);
    expect(dropped).toEqual({
      mappings: [],
      savingsAccounts: [{ lineId: "copy-line-savings", accountId: "acc-juan-savings" }],
      lines: [{ originLineId: "line-reserve", name: "Reserve" }],
    });
    expect(parts.lines.map((l) => l.createdAt.getTime() - NOW.getTime())).toEqual([0, 1]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/domain/plan-copy.test.ts`
Expected: FAIL — `Failed to resolve import "./plan-copy"`.

- [ ] **Step 3: Implement**

`src/modules/budgeting/domain/plan-copy.ts`:

```ts
import type { LineAllocation } from "./allocation";
import type { BudgetLine, BudgetLineId, CategoryMapping } from "./budget-line";
import type { PlanParts } from "./plan-figures";

/** HU-E6-06: what a copy leaves out, as its answer lists it (ruling P11); former members' rows go unlisted. */
export interface CopyDrops {
  /** Mappings to categories that are no longer live, unarchived categories of the space, by the copied line. */
  readonly mappings: readonly CategoryMapping[];
  /** Accounts a copied SAVINGS line no longer names because they no longer qualify (P10), by the copied line. */
  readonly savingsAccounts: readonly { readonly lineId: string; readonly accountId: string }[];
  /** SAVINGS lines not copied because none of their accounts still qualifies (P10), by the source line. */
  readonly lines: readonly { readonly originLineId: string; readonly name: string }[];
}

export interface CopyInput {
  /** The new plan. */
  readonly planId: string;
  readonly now: Date;
  /** The source plan's parts as committed: capacities, current lines, mappings and allocation values. */
  readonly source: PlanParts;
  /** One new id per source line, in the source's line order. */
  readonly lineIds: readonly BudgetLineId[];
  /** The space's current members in join order, registered and guests (D15). */
  readonly memberIds: readonly string[];
  /** The space's live categories, archived ones flagged. */
  readonly categories: readonly { readonly id: string; readonly archived: boolean }[];
  /** Of the accounts the source's SAVINGS lines name, those a copy may keep (P10). */
  readonly usableAccountIds: readonly string[];
}

/**
 * HU-E6-06: a deep clone of the source plan's parts with new ids. Each copied line keeps its name, planned amount,
 * funding, rollover mode, catch-all flag and allocation rule, links to its source line (`originLineId`, HU-E6-09)
 * and is created a millisecond after the one before, so readers list the copies in the source's order. Former
 * members' capacities and values, mappings to categories that are archived or gone, and accounts that no longer
 * qualify are left out, and a SAVINGS line left without accounts is not copied. Nothing is checked against
 * capacity: the copy is a DRAFT, and activation checks it (HU-E6-07).
 */
export const copiedParts = (input: CopyInput): { parts: PlanParts; dropped: CopyDrops } => {
  const live = new Set(input.categories.filter((c) => !c.archived).map((c) => c.id));
  const current = new Set(input.memberIds);
  const lines: BudgetLine[] = [];
  const mappings: CategoryMapping[] = [];
  const allocations: LineAllocation[] = [];
  const droppedMappings: CategoryMapping[] = [];
  const droppedAccounts: { lineId: string; accountId: string }[] = [];
  const droppedLines: { originLineId: string; name: string }[] = [];
  input.source.lines.forEach((line, index) => {
    const id = input.lineIds[index]!;
    const kept = line.savingsAccountIds.filter((accountId) => input.usableAccountIds.includes(accountId));
    if (line.funding === "SAVINGS" && kept.length === 0) {
      droppedLines.push({ originLineId: line.id, name: line.name });
      return;
    }
    for (const accountId of line.savingsAccountIds.filter((a) => !kept.includes(a))) {
      droppedAccounts.push({ lineId: id, accountId });
    }
    lines.push({
      ...line,
      id,
      planId: input.planId,
      originLineId: line.id,
      savingsAccountIds: kept,
      createdAt: new Date(input.now.getTime() + lines.length),
    });
    for (const mapping of input.source.mappings.filter((m) => m.lineId === line.id)) {
      const copied = { lineId: id, categoryId: mapping.categoryId };
      (live.has(mapping.categoryId) ? mappings : droppedMappings).push(copied);
    }
    for (const value of input.source.allocations) {
      if (value.lineId === line.id && current.has(value.memberId)) {
        allocations.push({ lineId: id, memberId: value.memberId, value: value.value });
      }
    }
  });
  return {
    parts: {
      capacities: input.source.capacities.filter((c) => current.has(c.memberId)),
      lines,
      mappings,
      allocations,
    },
    dropped: { mappings: droppedMappings, savingsAccounts: droppedAccounts, lines: droppedLines },
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/domain`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/domain/plan-copy.ts src/modules/budgeting/domain/plan-copy.test.ts
git commit -m "feat(budgeting): clone a plan's parts for the next period and report what it leaves out (Refs #52)"
```

---

### Task 7: Budgeting — CopyBudgetPlan

Implements HU-E6-06 (issue #52) at the use-case level. Pins Review Focus 2 (the source of a SEMI_MONTHLY copy; `NoPreviousPlan` when only 2026-10 has a plan) and Review Focus 3 (Luis left; Juan's, Marta's and Luis's savings accounts).

Decisions:
- `openedPlan` (extracted from `CreateBudgetPlan`, unchanged behaviour) authorizes `plan.manage`, resolves the label around the stored plans and opens the DRAFT plan, `PlanAlreadyExists` included; `CreateBudgetPlan` stores it, `CopyBudgetPlan` first finds its source.
- The source is the plan covering the day before the new period starts (`covering`, `share: true`): "the plan of the previous period of the same policy" (HU-E6-06 note, spec 5.3), so "2026-11 H2" copies "2026-11 H1", "2026-12 H1" copies "2026-11 H2", and a period that starts the day after a stored plan (D10) copies that plan. Without one: `NoPreviousPlan` (409). Reading it `FOR SHARE` keeps the source's writes out until the copy commits, so the copy reads one committed version of it (ruling P14, raced in Task 8).
- `copyableSavingsAccounts` keeps an account of a source SAVINGS line only while it is a SAVINGS account, not archived, in the plan space's currency and owned by a current registered member of the space (P8 amended, ruling P10). The copy names no account anew, so the caller's identity plays no part.
- The copy writes only through M3-A's ports (`add`, `setCapacities`, `addLine`, `mapCategories`, `setAllocation`), so it needs no new adapter code; its plan keeps version 1 (`add`), and its answer is the new plan and the `dropped` report (ruling P11).

**Files:**
- Create: `src/modules/budgeting/application/copy-budget-plan.ts`
- Modify: `src/modules/budgeting/application/create-budget-plan.ts`, `src/modules/budgeting/application/line-checks.ts`, `src/modules/budgeting/application/index.ts`
- Test: `src/modules/budgeting/application/copies.test.ts`

**Interfaces:**
- Consumes: `copiedParts`, `CopyDrops` (Task 6); `covering` (Task 2); `openPlan`, `loadPlanView`, `BudgetingDeps` and the M3-A repository ports; `budgetingWorld`, `BUDGET_MEMBERS`, `ACCOUNTS` (through `savingsAccounts`), `aLine`, `referenceLines`.
- Produces:
  - `interface NewPlanInput { spaceId: string; userId: string; period: string }`; `openedPlan(deps: Pick<BudgetingDeps, "access" | "plans" | "ids" | "clock">, input: NewPlanInput): Promise<Result<{ space: SpaceMembership; plan: BudgetPlan }>>`
  - `copyableSavingsAccounts(accounts: SavingsAccountReader, space: { members: readonly SpaceMember[]; spaceCurrency: string }, accountIds: readonly string[]): Promise<string[]>`
  - `interface PlanCopy { view: BudgetPlanView; dropped: CopyDrops }`; `type CopyBudgetPlan = (input: NewPlanInput) => Promise<Result<PlanCopy>>`; `type CopyDeps = BudgetingDeps & { capacities; lines; mappings; allocations; categories }`; `createCopyBudgetPlan(deps: CopyDeps)` — `SpaceNotFound`, `SpaceArchived`, `InsufficientRole`, `InvalidPeriodLabel`, `PlanAlreadyExists`, `NoPreviousPlan`

- [ ] **Step 1: Write the failing tests**

`src/modules/budgeting/application/copies.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SpaceMember } from "@/modules/spaces/application";
import type { PeriodPolicy } from "@/shared/kernel";
import { aLine, referenceLines } from "../../../../tests/support/budget-fixtures";
import { BUDGET_MEMBERS, budgetingWorld, HOUSEHOLD, NOW } from "../../../../tests/support/budgeting-world";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import type { PlanParts } from "../domain/plan-figures";
import { createCopyBudgetPlan, type PlanCopy } from "./copy-budget-plan";
import { createCreateBudgetPlan } from "./create-budget-plan";
import type { BudgetCategories } from "./ports";

const ANA_AND_JUAN = BUDGET_MEMBERS.filter((m) => m.displayName === "Ana" || m.displayName === "Juan");

/** Household's live categories; `archived` names those archived since the source plan was made. */
const categories = (archived: readonly string[]): BudgetCategories => ({
  list: async () =>
    ["cat-groceries", "cat-utilities", "cat-outings"].map((id) => ({ id, archived: archived.includes(id) })),
});

/**
 * HU-E6-06 Background: Household's plan for the first of `periods` (2026-11 unless given) with the reference
 * capacities, lines (Free PERCENT 42 / 58, catch-all), Groceries and Utilities mapped to Home; `parts` overrides.
 */
const world = async (
  options: {
    readonly members?: readonly SpaceMember[];
    readonly parts?: Partial<PlanParts>;
    readonly archived?: readonly string[];
    readonly periodPolicy?: PeriodPolicy;
    readonly periods?: readonly string[];
  } = {},
) => {
  const w = budgetingWorld({ members: options.members ?? ANA_AND_JUAN, periodPolicy: options.periodPolicy });
  const deps = {
    ...w.deps,
    capacities: w.plans,
    lines: w.plans,
    mappings: w.plans,
    allocations: w.plans,
    categories: categories(options.archived ?? []),
  };
  const create = createCreateBudgetPlan(deps);
  const [first] = options.periods ?? ["2026-11"];
  const source = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: first! })).plan;
  w.plans.seed(source.id, {
    capacities: [
      { memberId: "member-ana", amount: 160_000_000n },
      { memberId: "member-juan", amount: 240_000_000n },
    ],
    lines: referenceLines().map((l) => (l.name === "Free" ? { ...l, allocationRule: "PERCENT" as const } : l)),
    mappings: [
      { lineId: "line-home", categoryId: "cat-groceries" },
      { lineId: "line-home", categoryId: "cat-utilities" },
    ],
    allocations: [
      { lineId: "line-free", memberId: "member-ana", value: 4200n },
      { lineId: "line-free", memberId: "member-juan", value: 5800n },
    ],
    ...options.parts,
  });
  const copy = createCopyBudgetPlan(deps);
  const copyInto = (period: string, userId = "u-ana") => copy({ spaceId: HOUSEHOLD, userId, period });
  return { ...w, source, copyInto };
};
const line = (copy: PlanCopy, name: string) => copy.view.figures.lines.find((l) => l.line.name === name)!;

describe("CopyBudgetPlan (HU-E6-06)", () => {
  it("creates the 2026-12 plan as a DRAFT copy of 2026-11 (@critical)", async () => {
    const { source, copyInto } = await world();
    const copy = unwrap(await copyInto("2026-12"));
    expect(copy.view.plan).toEqual({
      id: "budget-2",
      spaceId: HOUSEHOLD,
      period: { label: "2026-12", start: "2026-12-01", end: "2026-12-31" },
      status: "DRAFT",
      createdFrom: source.id,
      version: 1,
      createdBy: "u-ana",
      createdAt: NOW,
    });
    expect(copy.view.figures.capacities.map((c) => [c.memberId, c.amount])).toEqual([
      ["member-ana", 160_000_000n],
      ["member-juan", 240_000_000n],
    ]);
    expect(
      copy.view.figures.lines.map((l) => [
        l.line.name,
        l.line.plannedAmount,
        l.line.funding,
        l.line.rolloverMode,
        l.line.allocationRule,
        l.line.originLineId,
        l.categoryIds,
      ]),
    ).toEqual([
      ["Rent", 120_000_000n, "SHARED_FUND", "RESET", "PROPORTIONAL", "line-rent", []],
      ["Home", 147_000_000n, "DIRECT", "RESET", "PROPORTIONAL", "line-home", ["cat-groceries", "cat-utilities"]],
      ["Savings", 60_000_000n, "SAVINGS", "RESET", "PROPORTIONAL", "line-savings", []],
      ["Free", 73_000_000n, "DIRECT", "RESET", "PERCENT", "line-free", []],
    ]);
    expect(line(copy, "Free").allocation.members.map((m) => [m.memberId, m.value])).toEqual([
      ["member-ana", 4200n],
      ["member-juan", 5800n],
    ]);
    expect([line(copy, "Free").line.isCatchAll, line(copy, "Savings").line.savingsAccountIds]).toEqual([
      true,
      ["acc-savings"],
    ]);
    expect(copy.dropped).toEqual({ mappings: [], savingsAccounts: [], lines: [] });
  });

  it("leaves the 2026-11 plan as it was", async () => {
    const { plans, source, copyInto } = await world();
    const before = [await plans.find(HOUSEHOLD, source.id), await plans.contents(source.id)];
    unwrap(await copyInto("2026-12"));
    expect([await plans.find(HOUSEHOLD, source.id), await plans.contents(source.id)]).toEqual(before);
  });

  it("answers NoPreviousPlan without a plan for 2026-11, even when 2026-10 has one", async () => {
    const { plans, copyInto } = await world({ periods: ["2026-10"] });
    expect(codeOf(await copyInto("2026-12"))).toBe("NoPreviousPlan");
    expect(plans.plans).toHaveLength(1);
  });

  it("copies from the previous period of a SEMI_MONTHLY policy: H2 from H1, then the next H1 from H2 (spec 5.3)", async () => {
    const { source, copyInto } = await world({
      periodPolicy: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 },
      periods: ["2026-11 H1"],
    });
    const h2 = unwrap(await copyInto("2026-11 H2")).view.plan;
    const h1 = unwrap(await copyInto("2026-12 H1")).view.plan;
    expect([h2.createdFrom, h2.period.start, h1.createdFrom, h1.period.start]).toEqual([
      source.id,
      "2026-11-16",
      h2.id,
      "2026-12-01",
    ]);
  });

  it("drops the mapping of Utilities, archived after the 2026-11 plan was made, and lists it", async () => {
    const { copyInto } = await world({ archived: ["cat-utilities"] });
    const copy = unwrap(await copyInto("2026-12"));
    expect(line(copy, "Home").categoryIds).toEqual(["cat-groceries"]);
    expect(copy.dropped.mappings).toEqual([{ lineId: line(copy, "Home").line.id, categoryId: "cat-utilities" }]);
  });

  it("leaves out Luis, who left after being allocated 10 % of Free, which is flagged until it adds up again", async () => {
    const { plans, copyInto } = await world({
      parts: {
        capacities: [
          { memberId: "member-ana", amount: 160_000_000n },
          { memberId: "member-juan", amount: 240_000_000n },
          { memberId: "member-luis", amount: 50_000_000n },
        ],
        allocations: [
          { lineId: "line-free", memberId: "member-ana", value: 4200n },
          { lineId: "line-free", memberId: "member-juan", value: 4800n },
          { lineId: "line-free", memberId: "member-luis", value: 1000n },
        ],
      },
    });
    const copy = unwrap(await copyInto("2026-12"));
    expect(line(copy, "Free").allocation).toEqual({
      rule: "PERCENT",
      members: [
        { memberId: "member-ana", value: 4200n, assigned: null },
        { memberId: "member-juan", value: 4800n, assigned: null },
      ],
      invalid: true,
    });
    const stored = await plans.contents(copy.view.plan.id);
    expect(stored.capacities.map((c) => c.memberId)).toEqual(["member-ana", "member-juan"]);
  });

  it("keeps savings accounts of current members that still qualify, and leaves out a line left without one (P10)", async () => {
    const lines = [
      aLine("Savings", 60_000_000n, {
        funding: "SAVINGS",
        savingsAccountIds: ["acc-savings", "acc-juan-savings", "acc-marta-savings"],
      }),
      aLine("Reserve", 10_000_000n, { funding: "SAVINGS", savingsAccountIds: ["acc-old-savings", "acc-usd-savings"] }),
      aLine("Trip", 10_000_000n, { funding: "SAVINGS", savingsAccountIds: ["acc-luis-savings"] }),
    ];
    const { copyInto } = await world({ parts: { lines, mappings: [], allocations: [] } });
    const copy = unwrap(await copyInto("2026-12"));
    expect(copy.view.figures.lines.map((l) => [l.line.name, l.line.savingsAccountIds])).toEqual([
      ["Savings", ["acc-savings", "acc-juan-savings"]],
    ]);
    expect(copy.dropped).toEqual({
      mappings: [],
      savingsAccounts: [{ lineId: line(copy, "Savings").line.id, accountId: "acc-marta-savings" }],
      lines: [
        { originLineId: "line-reserve", name: "Reserve" },
        { originLineId: "line-trip", name: "Trip" },
      ],
    });
  });

  it("lets only owners and admins copy, refuses a period that has a plan, and an archived space", async () => {
    const { copyInto, spaces, plans } = await world();
    expect(codeOf(await copyInto("2026-12", "u-juan"))).toBe("InsufficientRole");
    expect(codeOf(await copyInto("2026-12", "u-marta"))).toBe("SpaceNotFound");
    expect(codeOf(await copyInto("2026-11"))).toBe("PlanAlreadyExists");
    spaces.archived.add(HOUSEHOLD);
    expect(codeOf(await copyInto("2026-12"))).toBe("SpaceArchived");
    expect(plans.plans).toHaveLength(1);
  });

  it("answers PlanAlreadyExists when the unique index decides a concurrent copy of the period", async () => {
    const { copyInto, plans } = await world();
    plans.add = async () => false;
    expect(codeOf(await copyInto("2026-12"))).toBe("PlanAlreadyExists");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/application/copies.test.ts`
Expected: FAIL — `Failed to resolve import "./copy-budget-plan"`.

- [ ] **Step 3: Implement**

Replace the contents of `src/modules/budgeting/application/create-budget-plan.ts` with:

```ts
import { authorizeSpaceAction, type SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, ok, periodByLabel, type Result } from "@/shared/kernel";
import { openPlan, type BudgetPlan } from "../domain/plan";
import type { BudgetingDeps } from "./deps";
import { loadPlanView, type BudgetPlanView } from "./plan-view";

/** HU-E6-01, HU-E6-06: who asks for a new plan, and for which period. */
export interface NewPlanInput {
  readonly spaceId: string;
  readonly userId: string;
  /** The period's label in the space policy: "2026-11" (MONTHLY) or "2026-11 H1" (SEMI_MONTHLY). */
  readonly period: string;
}

export type CreateBudgetPlan = (input: NewPlanInput) => Promise<Result<BudgetPlanView>>;

/**
 * HU-E6-01, HU-E6-06: the DRAFT plan an OWNER or ADMIN may create for the period named `period`, resolved with the
 * space policy around the stored plans (D10), not stored yet; personal spaces too.
 */
export const openedPlan = async (
  deps: Pick<BudgetingDeps, "access" | "plans" | "ids" | "clock">,
  input: NewPlanInput,
): Promise<Result<{ space: SpaceMembership; plan: BudgetPlan }>> => {
  const manager = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "plan.manage");
  if (!manager.ok) return manager;
  const space = manager.value;
  const stored = await deps.plans.storedPeriods(space.spaceId);
  const period = periodByLabel(space.periodPolicy, stored, input.period);
  if (!period.ok) return period;
  const plan = openPlan({
    id: deps.ids.next<"BudgetPlan">(),
    spaceId: space.spaceId,
    period: period.value,
    stored,
    createdBy: input.userId,
    now: deps.clock.now(),
  });
  return plan.ok ? ok({ space, plan: plan.value }) : plan;
};

/** HU-E6-01: an OWNER or ADMIN creates an empty DRAFT plan for a period, its boundaries stored as they are (D10). */
export const createCreateBudgetPlan =
  (deps: BudgetingDeps): CreateBudgetPlan =>
  (input) =>
    deps.tm.run(async () => {
      const opened = await openedPlan(deps, input);
      if (!opened.ok) return opened;
      const { space, plan } = opened.value;
      // budget_plans_space_start_uq decides a concurrent creation of the same period.
      if (!(await deps.plans.add(plan))) {
        return err(domainError("PlanAlreadyExists", { label: plan.period.label }));
      }
      return ok(await loadPlanView(deps, space, plan));
    });
```

Append to the end of `src/modules/budgeting/application/line-checks.ts`:

```ts

/**
 * HU-E6-06, ruling P10: of the accounts a source plan's SAVINGS lines name, the ones its copy keeps: still a SAVINGS
 * account, not archived, in the plan space's currency (D6), and owned by a current registered member of the space
 * (P8 amended). Their owners attached them (P8), so a copy names no account anew and asks nothing of its caller.
 */
export const copyableSavingsAccounts = async (
  accounts: SavingsAccountReader,
  space: { readonly members: readonly SpaceMember[]; readonly spaceCurrency: string },
  accountIds: readonly string[],
): Promise<string[]> => {
  const owners = new Set(space.members.flatMap((m) => (m.userId === null ? [] : [m.userId])));
  const kept: string[] = [];
  for (const accountId of new Set(accountIds)) {
    const account = await accounts.find(accountId);
    if (account === null || !owners.has(account.ownerUserId)) continue;
    if (account.isSavings && !account.archived && account.currency === space.spaceCurrency) kept.push(accountId);
  }
  return kept;
};
```

`src/modules/budgeting/application/copy-budget-plan.ts`:

```ts
import { addDays, domainError, err, ok, type Result } from "@/shared/kernel";
import { copiedParts, type CopyDrops } from "../domain/plan-copy";
import { openedPlan, type NewPlanInput } from "./create-budget-plan";
import type { BudgetingDeps } from "./deps";
import { copyableSavingsAccounts } from "./line-checks";
import { loadPlanView, type BudgetPlanView } from "./plan-view";
import type {
  AllocationRepository,
  BudgetCategories,
  BudgetLineRepository,
  CapacityRepository,
  CategoryMappingRepository,
} from "./ports";

/** HU-E6-06: the copy, and what it left out (ruling P11). */
export interface PlanCopy {
  readonly view: BudgetPlanView;
  readonly dropped: CopyDrops;
}

export type CopyBudgetPlan = (input: NewPlanInput) => Promise<Result<PlanCopy>>;

export type CopyDeps = BudgetingDeps & {
  readonly capacities: CapacityRepository;
  readonly lines: BudgetLineRepository;
  readonly mappings: CategoryMappingRepository;
  readonly allocations: AllocationRepository;
  readonly categories: BudgetCategories;
};

/**
 * HU-E6-06: an OWNER or ADMIN creates the DRAFT plan for `period` as a copy of the plan of the previous period of
 * the space's policy: the plan covering the day before the new period starts, so "2026-11 H2" copies "2026-11 H1",
 * never simply the previous calendar month. The source is read FOR SHARE (ruling P14): a write to it in progress
 * ends first and none starts until the copy commits, so the copy reads one committed version of it.
 */
export const createCopyBudgetPlan =
  (deps: CopyDeps): CopyBudgetPlan =>
  (input) =>
    deps.tm.run(async () => {
      const opened = await openedPlan(deps, input);
      if (!opened.ok) return opened;
      const { space } = opened.value;
      const { label, start } = opened.value.plan.period;
      const source = await deps.plans.covering(space.spaceId, addDays(start, -1), { share: true });
      if (source === null) return err(domainError("NoPreviousPlan", { label }));
      const plan = { ...opened.value.plan, createdFrom: source.id };
      // budget_plans_space_start_uq decides a concurrent creation or copy of the same period.
      if (!(await deps.plans.add(plan))) return err(domainError("PlanAlreadyExists", { label }));
      const members = await deps.members.listCurrent(space.spaceId);
      const parts = await deps.plans.contents(source.id);
      const at = deps.clock.now();
      const copy = copiedParts({
        planId: plan.id,
        now: at,
        source: parts,
        lineIds: parts.lines.map(() => deps.ids.next<"BudgetLine">()),
        memberIds: members.map((m) => m.id),
        categories: await deps.categories.list(space.spaceId),
        usableAccountIds: await copyableSavingsAccounts(
          deps.savingsAccounts,
          { members, spaceCurrency: space.currency },
          parts.lines.flatMap((line) => line.savingsAccountIds),
        ),
      });
      await deps.capacities.setCapacities(plan.id, copy.parts.capacities, at);
      for (const line of copy.parts.lines) {
        await deps.lines.addLine(line, at);
        const categoryIds = copy.parts.mappings.filter((m) => m.lineId === line.id).map((m) => m.categoryId);
        if (categoryIds.length > 0) await deps.mappings.mapCategories(plan.id, line.id, categoryIds, at);
        const values = copy.parts.allocations
          .filter((a) => a.lineId === line.id)
          .map(({ memberId, value }) => ({ memberId, value }));
        if (values.length > 0) {
          await deps.allocations.setAllocation(plan.id, line.id, line.allocationRule, values, at);
        }
      }
      return ok({ view: await loadPlanView(deps, space, plan), dropped: copy.dropped });
    });
```

Append to `src/modules/budgeting/application/index.ts`:

```ts
export type { CopyDrops } from "../domain/plan-copy";
export type { NewPlanInput } from "./create-budget-plan";
export { createCopyBudgetPlan, type CopyBudgetPlan, type CopyDeps, type PlanCopy } from "./copy-budget-plan";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/budgeting && pnpm exec vitest run --project integration src/modules/budgeting`
Expected: PASS (`plans.test.ts` keeps passing: `CreateBudgetPlan` behaves as before). Mutation check: temporarily replace `addDays(start, -1)` with `start` — the @critical test fails with `NoPreviousPlan`; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/application/copy-budget-plan.ts src/modules/budgeting/application/create-budget-plan.ts src/modules/budgeting/application/line-checks.ts src/modules/budgeting/application/index.ts src/modules/budgeting/application/copies.test.ts
git commit -m "feat(budgeting): copy the previous period's plan into a new draft plan (Refs #52)"
```

---

### Task 8: Budgeting — closing and copying races against PostgreSQL

Pins Review Focus 1 for HU-E6-07 (issue #53) and HU-E6-06 (issue #52) with four rendezvous tests in the existing concurrency file. Each test is red when the lock it pins is removed (inferred from PostgreSQL's row-lock conflict table: `FOR SHARE` conflicts with `FOR NO KEY UPDATE`; `KEY SHARE`, which foreign keys take, conflicts with neither).

Decisions:
- `holder()` stops a transaction at an observed point until another backend queues behind a lock it holds (`pg_blocking_pids`) or the other side reports it finished without queueing; it never sleeps a fixed delay. The other side is started only once the holder has stopped (`held`), so the order of the two transactions is fixed by the test, not by scheduling.
- The four races: (1) a line added while a close holds the plan's lock answers `PeriodClosed` (red when `planForWrite` checks the pre-lock read, N4); (2) a ledger write's guard queued behind a close sees the period closed (red when `covering` drops `FOR SHARE`); (3) a close queued behind a ledger write that already checked the period commits after it (red when `covering` drops `FOR SHARE`: the close then commits first while that write is still open); (4) a copy made while its source's line is being edited copies the edited amount (red when `CopyBudgetPlan` reads its source without `share`).

**Files:**
- Modify (test): `src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts`

**Interfaces:**
- Consumes: `createCloseBudgetPlan` (Task 4); `createClosedPeriodGuard` (Task 3); `createCopyBudgetPlan` (Task 7); `covering`, `setStatus` (Task 2); `until`, `someoneWaitsFor`, `outcomesOf`, `household`, `plans`, `tm` of the file (M3-A Task 13).
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the tests**

In `src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts`:

1. Replace the line `import { FixedClock, type Result } from "@/shared/kernel";` with:

```ts
import { FixedClock, ok, type LocalDate, type Result } from "@/shared/kernel";
```

2. Insert after the line `import { createCreateBudgetPlan } from "../application/create-budget-plan";`:

```ts
import { createClosedPeriodGuard } from "../application/closed-periods";
import { createCopyBudgetPlan } from "../application/copy-budget-plan";
import { createCloseBudgetPlan } from "../application/plan-lifecycle";
```

3. Insert before the line `/** What a writer that failed reports: the database's own message when there is one, so it reads in the diff. */`:

```ts
/**
 * A transaction that stops in `hold()` until another backend queues behind a lock it holds, or until `release()`
 * says the other side finished without queueing; `held` resolves once it stopped there. Both ends are observed
 * events, never a delay.
 */
const holder = () => {
  let released = false;
  let stopped: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    stopped = resolve;
  });
  const hold = async () => {
    const { rows } = await tm.executor().execute(sql`SELECT pg_backend_pid() AS pid`);
    const pid = Number(rows[0]?.pid);
    stopped();
    await until(
      `another backend to queue behind backend ${pid}, or the other side to finish`,
      async () => released || (await someoneWaitsFor(pid)),
    );
  };
  const release = () => {
    released = true;
  };
  return { held, hold, release };
};

```

4. Append to the end of the file:

```ts

describe("closing and copying while others write (HU-E6-06, HU-E6-07, Review Focus 1)", () => {
  /** An ACTIVE 2026-11 plan in which Ana has 1,000,000 COP, and its close, which stops in `h.hold` once it set CLOSED. */
  const activePlan = async () => {
    const { ana, space, deps } = await household();
    const { plan } = unwrap(
      await createCreateBudgetPlan(deps)({ spaceId: space.id, userId: ana.id, period: "2026-11" }),
    );
    await plans.setCapacities(plan.id, [{ memberId: space.members[0]!.id, amount: 100_000_000n }], at);
    await plans.setStatus(plan.id, "ACTIVE", at);
    const write = { spaceId: space.id, userId: ana.id, planId: plan.id, expectedVersion: null };
    const closeHolding = (h: ReturnType<typeof holder>) =>
      createCloseBudgetPlan({
        ...deps,
        statuses: {
          setStatus: async (planId, status, changedAt) => {
            await plans.setStatus(planId, status, changedAt);
            await h.hold();
          },
        },
      })(write);
    return { ana, space, deps, plan, write, closeHolding };
  };

  it("refuses a line added while the plan was being closed: its status is read after the lock (N4)", async () => {
    const { deps, plan, write, closeHolding } = await activePlan();
    const h = holder();
    const closing = closeHolding(h);
    await h.held;
    const adding = createAddBudgetLine({ ...deps, lines: plans })({
      ...write,
      line: { name: "Home", plannedAmount: money(10_000_000n) },
    }).finally(h.release);
    expect(await outcomesOf(closing, adding)).toEqual(["PeriodClosed", "ok"]);
    expect((await plans.contents(plan.id)).lines).toEqual([]);
  });

  it("makes a ledger write wait for a close in progress, which it then sees (P14)", async () => {
    const { space, closeHolding } = await activePlan();
    const guard = createClosedPeriodGuard(plans);
    const h = holder();
    const closing = closeHolding(h);
    await h.held;
    const checking = tm
      .run(async () => ok(await guard.isClosed(space.id, "2026-11-15" as LocalDate)))
      .finally(h.release);
    expect(codeOf(await closing)).toBe("ok");
    expect(unwrap(await checking)).toBe(true);
  });

  it("makes a close wait for a ledger write that already checked the period (P14)", async () => {
    const { space, deps, write } = await activePlan();
    const guard = createClosedPeriodGuard(plans);
    const h = holder();
    const order: string[] = [];
    const recording = tm
      .run(async () => {
        const closed = await guard.isClosed(space.id, "2026-11-15" as LocalDate);
        await h.hold();
        return ok(closed);
      })
      .then((result) => {
        order.push("ledger write");
        return result;
      });
    await h.held;
    const closing = createCloseBudgetPlan({ ...deps, statuses: plans })(write)
      .then((result) => {
        order.push("close");
        return result;
      })
      .finally(h.release);
    expect([unwrap(await recording), codeOf(await closing)]).toEqual([false, "ok"]);
    expect(order).toEqual(["ledger write", "close"]);
  });

  it("copies the version of its source that a write in progress commits (P14)", async () => {
    const { ana, space, deps } = await household();
    const { plan: november } = unwrap(
      await createCreateBudgetPlan(deps)({ spaceId: space.id, userId: ana.id, period: "2026-11" }),
    );
    await plans.setCapacities(november.id, [{ memberId: space.members[0]!.id, amount: 100_000_000n }], at);
    const write = { spaceId: space.id, userId: ana.id, planId: november.id, expectedVersion: null };
    unwrap(
      await createAddBudgetLine({ ...deps, lines: plans })({
        ...write,
        line: { name: "Home", plannedAmount: money(30_000_000n) },
      }),
    );
    const [home] = (await plans.contents(november.id)).lines;
    const h = holder();
    const updating = createUpdateBudgetLine({
      ...deps,
      lines: {
        addLine: (line, addedAt) => plans.addLine(line, addedAt),
        deleteLine: (planId, lineId, deletedAt) => plans.deleteLine(planId, lineId, deletedAt),
        saveLine: async (line, savedAt) => {
          await plans.saveLine(line, savedAt);
          await h.hold();
        },
      },
    })({ ...write, lineId: home!.id, changes: { plannedAmount: money(40_000_000n) } });
    await h.held;
    const copying = createCopyBudgetPlan({
      ...deps,
      capacities: plans,
      lines: plans,
      mappings: plans,
      allocations: plans,
      categories: { list: async () => [] },
    })({ spaceId: space.id, userId: ana.id, period: "2026-12" }).finally(h.release);
    expect(await outcomesOf(updating, copying)).toEqual(["ok", "ok"]);
    const december = unwrap(await copying).view;
    expect(december.figures.lines.map((l) => [l.line.name, l.line.plannedAmount, l.line.originLineId])).toEqual([
      ["Home", 40_000_000n, home!.id],
    ]);
  });
});
```

- [ ] **Step 2: Run the tests and the mutation checks**

Run: `pnpm exec vitest run --project integration src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts`
Expected: PASS (the file's M3-A tests included).
Mutation checks, one at a time, each restored before the next: (a) in `planForWrite`, pass `found` instead of `plan` to `accepts` — "refuses a line added while the plan was being closed" fails with `["ok", "ok"]`; (b) in `DrizzleBudgetPlanRepository.covering`, replace `await query.for("share")` with `await query` — "makes a ledger write wait" fails with `false`, "makes a close wait" fails with the order `["close", "ledger write"]`, and "copies the version" fails with `30_000_000n`; (c) in `CopyBudgetPlan`, drop `{ share: true }` — "copies the version" fails with `30_000_000n`.

- [ ] **Step 3: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts
git commit -m "test(budgeting): pin closes against ledger writes and plan edits, and copies against source edits (Refs #52, Refs #53)"
```

---

### Task 9a: Contracts — the copy request, line origins and the copy report on the wire

Implements the wire format of HU-E6-06 (issue #52); no route changes yet.

Decisions:
- `POST …/plans` takes an optional `copyFrom: "previous"` (HU-E6-06 note); any other value is `422 ValidationFailed`.
- Every line on the wire carries `originLineId` (null for lines not copied), so a client can relate a copy to its source and follow the carry-over link of HU-E6-09.
- The copy report is the optional `dropped` member of the `BudgetPlan` body, present only in the `201` answer to a copy (ruling P11): `mappings` and `savingsAccounts` by the copied line, `lines` by the source line and name. One response shape for both creations, no new component.

**Files:**
- Modify: `src/modules/budgeting/contracts/budgeting.contract.ts`, `openapi/openapi.snapshot.json`
- Test: `src/modules/budgeting/contracts/budgeting.contract.test.ts`

**Interfaces:**
- Consumes: `PlanCopy`, `CopyDrops` (Task 7); `budgetPlanDto`, `planCreated` (M3-A Task 9a).
- Produces: `CreatePlanBodySchema` with `copyFrom?: "previous"`; `BudgetLineSchema.originLineId: string | null`; `BudgetPlanSchema.dropped?: { mappings: { lineId; categoryId }[]; savingsAccounts: { lineId; accountId }[]; lines: { originLineId; name }[] }`; `planCopied(copy: PlanCopy): HttpSuccess`.

- [ ] **Step 1: Write the failing tests**

In `src/modules/budgeting/contracts/budgeting.contract.test.ts`:

1. Replace the line `import { budgetPlanDto, planCreated, planSuccess } from "./budgeting.contract";` with:

```ts
import { budgetPlanDto, CreatePlanBodySchema, planCopied, planCreated, planSuccess } from "./budgeting.contract";
```

2. In the expected `home` line, insert after the line `      id: "line-home",`:

```ts
      originLineId: null,
```

3. Insert before the last line of the file (`});`):

```ts

  it("prints a copy's line origins and what it left out (HU-E6-06)", () => {
    const lines = referenceLines().map((l) => ({ ...l, originLineId: `nov-${l.id}` }));
    const dropped = {
      mappings: [{ lineId: "line-home", categoryId: "cat-utilities" }],
      savingsAccounts: [{ lineId: "line-savings", accountId: "acc-juan-savings" }],
      lines: [{ originLineId: "nov-line-trip", name: "Trip" }],
    };
    const copied = planCopied({ view: view(lines), dropped });
    expect(copied).toMatchObject({
      status: 201,
      headers: [
        ["etag", '"4"'],
        ["location", "/api/v1/spaces/space-household/plans/plan-november"],
      ],
    });
    const body = copied.body as ReturnType<typeof budgetPlanDto>;
    expect(body.lines.map((l) => l.originLineId)).toEqual([
      "nov-line-rent",
      "nov-line-home",
      "nov-line-savings",
      "nov-line-free",
    ]);
    expect(body.dropped).toEqual(dropped);
    expect(budgetPlanDto(view())).not.toHaveProperty("dropped");
  });

  it("takes copyFrom: previous, and nothing else, on POST …/plans", () => {
    expect(CreatePlanBodySchema.safeParse({ period: "2026-12", copyFrom: "previous" }).success).toBe(true);
    expect(CreatePlanBodySchema.safeParse({ period: "2026-12" }).success).toBe(true);
    expect(CreatePlanBodySchema.safeParse({ period: "2026-12", copyFrom: "template" }).success).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/contracts/budgeting.contract.test.ts`
Expected: FAIL — `planCopied is not a function`, the `home` line lacks `originLineId`, and `copyFrom: "template"` parses.

- [ ] **Step 3: Implement**

In `src/modules/budgeting/contracts/budgeting.contract.ts`:

1. Insert before the line `  type LineChanges,`:

```ts
  type CopyDrops,
  type PlanCopy,
```

2. Insert before the line `  name: z.string(),`:

```ts
  /** HU-E6-06, HU-E6-09: the line of the previous period's plan this one was copied from; null for new lines. */
  originLineId: z.string().nullable(),
```

3. Insert after the line `  unbudgeted: z.object({ spent: MoneySchema, available: MoneySchema }).nullable(),`:

```ts
  /**
   * HU-E6-06: only in the answer to a copy (`copyFrom: "previous"`), what it left out (rulings P10, P11): mappings to
   * archived or deleted categories and savings accounts that no longer qualify, by the copied line, and SAVINGS lines
   * left without accounts, by the source line.
   */
  dropped: z
    .object({
      mappings: z.array(z.object({ lineId: z.string(), categoryId: z.string() })),
      savingsAccounts: z.array(z.object({ lineId: z.string(), accountId: z.string() })),
      lines: z.array(z.object({ originLineId: z.string(), name: z.string() })),
    })
    .optional(),
```

4. Replace the two lines `/** HU-E6-01: the period's label in the space policy, e.g. "2026-11" (MONTHLY) or "2026-11 H1" (SEMI_MONTHLY). */` and `export const CreatePlanBodySchema = z.object({ period: z.string().max(20) });` with:

```ts
/**
 * HU-E6-01: the period's label in the space policy, e.g. "2026-11" (MONTHLY) or "2026-11 H1" (SEMI_MONTHLY).
 * HU-E6-06: with `copyFrom: "previous"`, the plan of the previous period of the policy is copied into it.
 */
export const CreatePlanBodySchema = z.object({
  period: z.string().max(20),
  copyFrom: z.enum(["previous"]).optional(),
});
```

5. Insert before the line `    name: line.name,`:

```ts
    originLineId: line.originLineId,
```

6. Insert before the line `const SpacePath = z.object({ spaceId: z.string() });`:

```ts
const droppedDto = (dropped: CopyDrops): NonNullable<z.infer<typeof BudgetPlanSchema>["dropped"]> => ({
  mappings: dropped.mappings.map((m) => ({ lineId: m.lineId, categoryId: m.categoryId })),
  savingsAccounts: dropped.savingsAccounts.map((s) => ({ lineId: s.lineId, accountId: s.accountId })),
  lines: dropped.lines.map((l) => ({ originLineId: l.originLineId, name: l.name })),
});

/** HU-E6-06: 201 like a creation, its body also listing what the copy left out (ruling P11). */
export const planCopied = ({ view, dropped }: PlanCopy): HttpSuccess => ({
  ...planCreated(view),
  body: { ...budgetPlanDto(view), dropped: droppedDto(dropped) },
});

```

7. Replace the block from the line `    post: {` that follows `  "/api/v1/spaces/{spaceId}/plans": {` through the line `      summary: "Create a DRAFT plan for a period of the space's policy; its boundaries are stored (D10)",` with:

```ts
    post: {
      operationId: "createBudgetPlan",
      summary:
        "Create a DRAFT plan for a period of the space's policy, empty or copied from the previous period's plan",
      description:
        "The period's boundaries are stored (D10). With copyFrom: previous, the plan covering the day before the period starts is deep-copied with new ids; its former members, archived categories and savings accounts that no longer qualify are left out and listed in dropped.",
```

8. In the same operation, replace the line `          "409": "PlanAlreadyExists, SpaceArchived",` with:

```ts
          "409": "PlanAlreadyExists, NoPreviousPlan, SpaceArchived",
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: `components.schemas.BudgetPlan` gains `lines[].originLineId` (also in its `required` list) and the optional `dropped` (about 80 lines together); `POST /api/v1/spaces/{spaceId}/plans` changes its summary, gains its description, `NoPreviousPlan` and the optional `copyFrom` of its body; nothing else changes and no `…Output` variant appears.
Then run: `pnpm exec vitest run --project unit src/modules/budgeting src/composition`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0. (Acceptance tests compare lines with `toMatchObject`, so the new `originLineId` changes none of them.)

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/contracts/budgeting.contract.ts src/modules/budgeting/contracts/budgeting.contract.test.ts openapi/openapi.snapshot.json
git commit -m "feat(budgeting): describe plan copies, line origins and what a copy leaves out on the wire (Refs #52)"
```

---

### Task 9b: HTTP — copy a plan from the previous period

Implements HU-E6-06 (issue #52) over HTTP. Pins Review Focus 3 (Luis leaves with 10 % of Free and with his own savings line) and Review Focus 5 (archived spaces).

Decisions:
- `POST …/plans` with `copyFrom: "previous"` calls `CopyBudgetPlan` and answers `201` with `ETag: "1"`, `Location` and the `dropped` report; without it nothing changes.
- `NoPreviousPlan` maps to 409 by the default rule (it is a conflict with the space's state).

**Files:**
- Modify: `src/app/api/v1/spaces/[spaceId]/plans/route.ts`, `src/composition/container.ts`, `src/shared/http/problem.test.ts`, `tests/support/budgeting.ts`, `docs/backlog/E6-budgeting.md`
- Create (test): `tests/acceptance/budget-copies.test.ts`

**Interfaces:**
- Consumes: `createCopyBudgetPlan`, `CopyBudgetPlan` (Task 7); `planCopied`, `CreatePlanBodySchema` (Task 9a); `referencePlan`, `putCategories`, `patchLine`, `putAllocation`, `setCapacities`, `addLine`, `lineNamed`, `planOf` (`tests/support/budgeting.ts`); `joinHousehold`, `newAccount`, `categoryWithKey` (`tests/support/ledger.ts`); `registerUser` (`tests/support/app.ts`).
- Produces: `Container.budgeting.copyPlan: CopyBudgetPlan`; `copyPlan(user: TestUser, spaceId: string, period: string): Promise<Response>`; `LineDto.originLineId: string | null` and `PlanDto.dropped?` in `tests/support/budgeting.ts`.

- [ ] **Step 1: Write the failing tests**

In `src/shared/http/problem.test.ts`, insert after the line `    ["PlanAlreadyExists", 409],`:

```ts
    ["NoPreviousPlan", 409],
```

In `tests/support/budgeting.ts`:

1. Insert after the two-line anchor `export interface LineDto {` + `  id: string;`:

```ts
  originLineId: string | null;
```

2. Insert after the line `  unbudgeted: { spent: MoneyDto; available: MoneyDto } | null;`:

```ts
  /** HU-E6-06: only in the answer to a copy. */
  dropped?: {
    mappings: { lineId: string; categoryId: string }[];
    savingsAccounts: { lineId: string; accountId: string }[];
    lines: { originLineId: string; name: string }[];
  };
```

3. Append to the end of the file:

```ts

/** HU-E6-06: `user` creates the plan for `period` as a copy of the previous period's plan. */
export const copyPlan = (user: TestUser, spaceId: string, period: string) =>
  call(createPlanRoute, "POST", plansPath(spaceId), {
    user,
    params: { spaceId },
    body: { period, copyFrom: "previous" },
  });
```

`tests/acceptance/budget-copies.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { POST as archiveCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/archive/route";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  addLine,
  copyPlan,
  lineNamed,
  newPlan,
  patchLine,
  planOf,
  putAllocation,
  putCategories,
  referencePlan,
  setCapacities,
  type PlanDto,
} from "../support/budgeting";
import { categoryWithKey, household, joinHousehold, newAccount } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** Copies into `period` and returns the copy; fails the test unless 201. */
const copied = async (user: TestUser, spaceId: string, period: string): Promise<PlanDto> => {
  const response = await copyPlan(user, spaceId, period);
  expect(response.status).toBe(201);
  return (await response.json()) as PlanDto;
};

/** `member` leaves the household. */
const leaves = async (member: TestUser, spaceId: string) => {
  const left = await call(leaveSpace, "POST", `/api/v1/spaces/${spaceId}/leave`, {
    user: member,
    params: { spaceId },
  });
  expect(left.status).toBe(204);
};

/**
 * HU-E6-06 Background: the reference plan for 2026-11 with Groceries and Utilities mapped to Home, Free the
 * catch-all line allocated 42 % / 58 %.
 */
const november = async () => {
  const ref = await referencePlan();
  const { h, planId, lineId } = ref;
  const utilities = await categoryWithKey(h.ana, "utilities");
  expect((await putCategories(h.ana, h.spaceId, planId, lineId("Home"), [h.groceries, utilities])).status).toBe(
    200,
  );
  expect((await patchLine(h.ana, h.spaceId, planId, lineId("Free"), { isCatchAll: true })).status).toBe(200);
  const split = {
    rule: "PERCENT",
    members: [
      { memberId: h.ana.memberId, percent: "42" },
      { memberId: h.juan.memberId, percent: "58" },
    ],
  };
  expect((await putAllocation(h.ana, h.spaceId, planId, lineId("Free"), split)).status).toBe(200);
  return { ...ref, utilities };
};

describe("copying a plan from the previous period (HU-E6-06)", () => {
  it("creates the 2026-12 plan as a DRAFT copy of 2026-11 (@critical)", async () => {
    const { h, planId, lineId, savings, utilities } = await november();
    const response = await copyPlan(h.ana, h.spaceId, "2026-12");
    expect([response.status, response.headers.get("etag")]).toEqual([201, '"1"']);
    const copy = (await response.json()) as PlanDto;
    expect(response.headers.get("location")).toBe(`/api/v1/spaces/${h.spaceId}/plans/${copy.id}`);
    expect(copy).toMatchObject({
      status: "DRAFT",
      createdFrom: planId,
      period: { label: "2026-12", startDate: "2026-12-01", endDate: "2026-12-31" },
      capacities: [
        { memberId: h.ana.memberId, amount: { amount: "160000000", currency: "COP" }, share: "40.00" },
        { memberId: h.juan.memberId, amount: { amount: "240000000", currency: "COP" }, share: "60.00" },
      ],
      dropped: { mappings: [], savingsAccounts: [], lines: [] },
    });
    expect(
      copy.lines.map((l) => [l.name, l.plannedAmount.amount, l.funding, l.rolloverMode, l.originLineId]),
    ).toEqual([
      ["Rent", "120000000", "SHARED_FUND", "RESET", lineId("Rent")],
      ["Home", "147000000", "DIRECT", "RESET", lineId("Home")],
      ["Savings", "60000000", "SAVINGS", "RESET", lineId("Savings")],
      ["Free", "73000000", "DIRECT", "RESET", lineId("Free")],
    ]);
    expect([...lineNamed(copy, "Home").categoryIds].sort()).toEqual([h.groceries, utilities].sort());
    expect(lineNamed(copy, "Savings").savingsAccountIds).toEqual([savings]);
    expect(lineNamed(copy, "Free")).toMatchObject({
      isCatchAll: true,
      allocation: {
        rule: "PERCENT",
        members: [
          { memberId: h.ana.memberId, percent: "42.00" },
          { memberId: h.juan.memberId, percent: "58.00" },
        ],
        error: null,
      },
    });
    const read = await planOf(h.juan, h.spaceId, copy.id);
    expect(read).not.toHaveProperty("dropped");
    expect(read.lines.map((l) => l.id)).toEqual(copy.lines.map((l) => l.id));
  });

  it("answers NoPreviousPlan when Household has no plan for 2026-11, even with one for 2026-10", async () => {
    const h = await household();
    const october = await newPlan(h.ana, h.spaceId, "2026-10");
    expect(await problemOf(await copyPlan(h.ana, h.spaceId, "2026-12"))).toEqual([409, "NoPreviousPlan"]);
    expect((await copied(h.ana, h.spaceId, "2026-11")).createdFrom).toBe(october.id);
    expect(await problemOf(await copyPlan(h.ana, h.spaceId, "2026-11"))).toEqual([409, "PlanAlreadyExists"]);
  });

  it("drops the mapping of Utilities, archived after the 2026-11 plan was made, and lists it", async () => {
    const { h, utilities } = await november();
    const archived = await call(archiveCategory, "POST", `/api/v1/spaces/${h.spaceId}/categories/${utilities}/archive`, {
      user: h.ana,
      params: { spaceId: h.spaceId, categoryId: utilities },
    });
    expect(archived.status).toBe(200);
    const copy = await copied(h.ana, h.spaceId, "2026-12");
    const home = lineNamed(copy, "Home");
    expect(home.categoryIds).toEqual([h.groceries]);
    expect(copy.dropped?.mappings).toEqual([{ lineId: home.id, categoryId: utilities }]);
  });

  it("flags Free with InvalidAllocation when Luis, allocated 10 % of it in 2026-11, has left (Review Focus 3)", async () => {
    const { h, planId, lineId } = await november();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    const split = {
      rule: "PERCENT",
      members: [
        { memberId: h.ana.memberId, percent: "42" },
        { memberId: h.juan.memberId, percent: "48" },
        { memberId: luis.memberId, percent: "10" },
      ],
    };
    expect((await putAllocation(h.ana, h.spaceId, planId, lineId("Free"), split)).status).toBe(200);
    await leaves(luis, h.spaceId);
    const free = lineNamed(await copied(h.ana, h.spaceId, "2026-12"), "Free");
    expect(free.allocation).toMatchObject({
      rule: "PERCENT",
      members: [
        { memberId: h.ana.memberId, percent: "42.00", assigned: null },
        { memberId: h.juan.memberId, percent: "48.00", assigned: null },
      ],
      error: "InvalidAllocation",
    });
  });

  it("leaves out the savings line of Luis, who left, and keeps Ana's (P10, Review Focus 3)", async () => {
    const { h, planId, savings } = await november();
    const luis = await joinHousehold(h, "Luis", "ADMIN");
    const luisSavings = await newAccount(luis.personal, "Ahorros Luis", 0, "SAVINGS");
    await setCapacities(h.ana, h.spaceId, planId, [[luis.memberId, 100_000]]);
    const withTrip = await addLine(luis, h.spaceId, planId, {
      name: "Trip",
      pesos: 100_000,
      funding: "SAVINGS",
      savingsAccountIds: [luisSavings],
    });
    await leaves(luis, h.spaceId);
    const copy = await copied(h.ana, h.spaceId, "2026-12");
    expect(copy.lines.map((l) => l.name)).toEqual(["Rent", "Home", "Savings", "Free"]);
    expect(lineNamed(copy, "Savings").savingsAccountIds).toEqual([savings]);
    expect(copy.dropped).toEqual({
      mappings: [],
      savingsAccounts: [],
      lines: [{ originLineId: lineNamed(withTrip, "Trip").id, name: "Trip" }],
    });
  });

  it("lets only owners and admins copy, and refuses non-members and archived spaces (Review Focus 5)", async () => {
    const { h } = await referencePlan();
    const marta = await registerUser("Marta");
    expect(await problemOf(await copyPlan(h.juan, h.spaceId, "2026-12"))).toEqual([403, "InsufficientRole"]);
    expect(await problemOf(await copyPlan(marta, h.spaceId, "2026-12"))).toEqual([404, "SpaceNotFound"]);
    const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    expect(archived.status).toBe(204);
    expect(await problemOf(await copyPlan(h.ana, h.spaceId, "2026-12"))).toEqual([409, "SpaceArchived"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/shared/http/problem.test.ts && pnpm exec vitest run --project acceptance tests/acceptance/budget-copies.test.ts`
Expected: the unit test passes already (the default rule maps `NoPreviousPlan` to 409; the row pins it); the acceptance tests FAIL — the copies answer an empty `201` plan without `dropped` (the route ignores `copyFrom`).

- [ ] **Step 3: Implement**

Replace the contents of `src/app/api/v1/spaces/[spaceId]/plans/route.ts` with:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  CreatePlanBodySchema,
  planCopied,
  planCreated,
} from "@/modules/budgeting/contracts/budgeting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: CreatePlanBodySchema,
  handler: async ({ user, params, body }) => {
    const budgeting = getContainer().budgeting;
    const input = { spaceId: params.spaceId!, userId: user!.id, period: body.period };
    // HU-E6-06: `copyFrom: "previous"` copies the plan of the previous period of the space's policy.
    if (body.copyFrom === "previous") {
      const copy = await budgeting.copyPlan(input);
      return copy.ok ? ok(planCopied(copy.value)) : copy;
    }
    const result = await budgeting.createPlan(input);
    return result.ok ? ok(planCreated(result.value)) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert before the line `  type CreateBudgetPlan,`:

```ts
  createCopyBudgetPlan,
  type CopyBudgetPlan,
```

2. Insert after the line `    readonly createPlan: CreateBudgetPlan;`:

```ts
    readonly copyPlan: CopyBudgetPlan;
```

3. Insert after the line `      createPlan: createCreateBudgetPlan(budgetingDeps),`:

```ts
      copyPlan: createCopyBudgetPlan(budgetingDeps),
```

In `docs/backlog/E6-budgeting.md`, insert after the line `- Supports success criterion "plan in under 5 minutes".`:

```markdown
- The copy answers `201` like a creation (`ETag`, `Location`), and only that answer carries `dropped`: `mappings` (to categories archived or deleted since, by the copied line), `savingsAccounts` (accounts that no longer qualify, by the copied line) and `lines` (SAVINGS lines left without accounts, by the source line). Each copied line keeps its name, planned amount, funding, rollover mode, catch-all flag and allocation rule, links to its source through `originLineId` and is listed in the source's order; capacities and PERCENT/FIXED values of former members are left out, so a line that named one is flagged `InvalidAllocation` until it is allocated again. A savings account is kept while it is a SAVINGS account, not archived, in the plan's currency and owned by a current registered member of the space; the copy names no account anew, so it does not depend on who copies. Nothing is checked against capacity: activation does (HU-E6-07). Errors: `NoPreviousPlan` (409), `PlanAlreadyExists` (409), `InvalidPeriodLabel` (422), `SpaceArchived` (409).
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/budget-copies.test.ts tests/acceptance/budget-plans.test.ts && pnpm exec vitest run --project unit src/composition`
Expected: PASS; the OpenAPI snapshot is unchanged in this task (Task 9a wrote it).

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/v1/spaces/[spaceId]/plans/route.ts" src/composition/container.ts src/shared/http/problem.test.ts docs/backlog/E6-budgeting.md tests/support/budgeting.ts tests/acceptance/budget-copies.test.ts
git commit -m "feat(budgeting): copy the previous period's plan over HTTP (Refs #52)"
```

---

### Task 10: Budgeting domain — rollover modes and the carry-over figure

Implements the pure rules of HU-E6-09 (issue #55): the RolloverCalculator and the carry-over term of `available` (spec 5.4). Pins Review Focus 4 (negative and floored carry-overs) at the domain level.

Decisions:
- `carryOver(mode, previousAvailable)`: RESET carries 0; ROLLOVER the previous available floored at 0 (Firefly semantics); ADJUSTED only a negative previous available (an overspend reduces the next period); no previous available carries 0 (HU-E6-09 note "lines without an origin get carry 0").
- The mode that decides is the **receiving** line's own `rolloverMode` (spec 5.4 "carry-over from rolloverMode" of L; ruling P15).
- `planFigures` takes the optional `previousAvailable` (the `available` of each line of the plan this one was copied from) and reports `carryOver` on every line; `available = planned + carryOver − spent`. A line finds its previous available only through `originLineId`, never by name (HU-E6-09 "Carry-over follows the copied line, not its name"). This extends `planFigures` instead of adding fields elsewhere (ruling P4). `unbudgeted` carries nothing.

**Files:**
- Create: `src/modules/budgeting/domain/rollover.ts`
- Modify: `src/modules/budgeting/domain/plan-figures.ts`
- Test: create `src/modules/budgeting/domain/rollover.test.ts`; modify `src/modules/budgeting/domain/plan-figures.test.ts`

**Interfaces:**
- Consumes: `RolloverMode`, `BudgetLine` (M3-A Task 2); `planFigures`, `LineFigure` (M3-A Task 4).
- Produces:
  - `carryOver(mode: RolloverMode, previousAvailable: bigint | null): bigint`
  - `interface PreviousAvailable { lineId: string; available: bigint }`; `planFigures(input: { currency; memberIds; parts; spending; previousAvailable?: readonly PreviousAvailable[] })`; `LineFigure.carryOver: bigint`

- [ ] **Step 1: Write the failing tests**

`src/modules/budgeting/domain/rollover.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RolloverMode } from "./budget-line";
import { carryOver } from "./rollover";

describe("carryOver (HU-E6-09 RolloverCalculator, spec 5.4)", () => {
  it.each<[RolloverMode, bigint | null, bigint]>([
    ["RESET", 20_000_000n, 0n],
    ["RESET", -13_000_000n, 0n],
    ["ROLLOVER", 20_000_000n, 20_000_000n],
    ["ROLLOVER", -13_000_000n, 0n],
    ["ROLLOVER", 0n, 0n],
    ["ADJUSTED", 20_000_000n, 0n],
    ["ADJUSTED", -13_000_000n, -13_000_000n],
    ["ROLLOVER", null, 0n],
    ["ADJUSTED", null, 0n],
  ])("%s with a previous available of %s carries %s", (mode, previous, carried) => {
    expect(carryOver(mode, previous)).toBe(carried);
  });
});
```

In `src/modules/budgeting/domain/plan-figures.test.ts`:

1. Insert after the line `import { codeOf } from "../../../../tests/support/fakes";` (added in Task 1):

```ts
import type { BudgetLine, BudgetLineId, RolloverMode } from "./budget-line";
```

2. Append to the end of the file:

```ts

describe("carry-over (HU-E6-09)", () => {
  const groceries = [{ lineId: "line-home", categoryId: "cat-groceries" }];
  const spentOnGroceries = (amount: bigint): PeriodSpending => ({
    byCategory: [{ categoryId: "cat-groceries", amount }],
    byAccount: [],
  });
  const home = (mode: RolloverMode, overrides: Partial<BudgetLine> = {}) =>
    aLine("Home", 147_000_000n, { rolloverMode: mode, ...overrides });
  /** Home in 2026-11, spent `spent`; the figures of its 2026-12 copies `december`, before any December spending. */
  const rolled = (mode: RolloverMode, spent: bigint, december: BudgetLine[]) => {
    const nov = figures(
      reference({ lines: [home(mode)], mappings: groceries, allocations: [] }),
      [ANA, JUAN],
      spentOnGroceries(spent),
    );
    const dec = planFigures({
      currency: "COP",
      memberIds: [ANA, JUAN],
      parts: reference({ lines: december, mappings: [], allocations: [] }),
      spending: NOTHING,
      previousAvailable: nov.lines.map((l) => ({ lineId: l.line.id, available: l.available })),
    });
    return { nov, dec };
  };
  const copied = (mode: RolloverMode) => home(mode, { id: "dec-home" as BudgetLineId, originLineId: "line-home" });

  it.each<[RolloverMode, bigint, bigint, bigint]>([
    ["RESET", 127_000_000n, 20_000_000n, 147_000_000n],
    ["RESET", 160_000_000n, -13_000_000n, 147_000_000n],
    ["ROLLOVER", 127_000_000n, 20_000_000n, 167_000_000n],
    ["ROLLOVER", 160_000_000n, -13_000_000n, 147_000_000n],
    ["ADJUSTED", 127_000_000n, 20_000_000n, 147_000_000n],
    ["ADJUSTED", 160_000_000n, -13_000_000n, 134_000_000n],
  ])("%s, spent %s in 2026-11: November available %s, December available %s (golden outline)", (mode, spent, nov, dec) => {
    const result = rolled(mode, spent, [copied(mode)]);
    expect([line(result.nov, "Home").available, line(result.dec, "Home").available]).toEqual([nov, dec]);
    expect(line(result.dec, "Home").carryOver).toBe(dec - 147_000_000n);
  });

  it("follows the origin link, not the name: House carries Home's 200,000 COP, a new Home carries nothing", () => {
    const house = home("ROLLOVER", { id: "dec-house" as BudgetLineId, name: "House", originLineId: "line-home" });
    const newHome = home("ROLLOVER", { id: "dec-home" as BudgetLineId });
    const { dec } = rolled("ROLLOVER", 127_000_000n, [house, newHome]);
    expect(dec.lines.map((l) => [l.line.name, l.carryOver, l.available])).toEqual([
      ["House", 20_000_000n, 167_000_000n],
      ["Home", 0n, 147_000_000n],
    ]);
  });

  it("carries 0 from an origin the previous figures do not list, and nothing at all without previous figures", () => {
    const orphan = home("ROLLOVER", { id: "dec-home" as BudgetLineId, originLineId: "line-removed" });
    expect(line(rolled("ROLLOVER", 127_000_000n, [orphan]).dec, "Home").carryOver).toBe(0n);
    expect(figures(reference()).lines.map((l) => l.carryOver)).toEqual([0n, 0n, 0n, 0n]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/domain/rollover.test.ts src/modules/budgeting/domain/plan-figures.test.ts`
Expected: FAIL — `Failed to resolve import "./rollover"`, and in `plan-figures.test.ts` the December available ignores the carry-over (`carryOver` is `undefined`).

- [ ] **Step 3: Implement**

`src/modules/budgeting/domain/rollover.ts`:

```ts
import type { RolloverMode } from "./budget-line";

/**
 * HU-E6-09 RolloverCalculator, spec 5.4: what a line carries over from the line it was copied from, by its own
 * rollover mode (ruling P15). RESET carries nothing; ROLLOVER the previous available floored at 0 (Firefly
 * semantics); ADJUSTED only an overspend, a negative previous available. Without a previous available it carries 0.
 */
export const carryOver = (mode: RolloverMode, previousAvailable: bigint | null): bigint => {
  if (previousAvailable === null || mode === "RESET") return 0n;
  if (mode === "ROLLOVER") return previousAvailable > 0n ? previousAvailable : 0n;
  return previousAvailable < 0n ? previousAvailable : 0n;
};
```

In `src/modules/budgeting/domain/plan-figures.ts`:

1. Insert after the line `import { capacityOf, shareOfTotal, totalCapacity, type MemberCapacity } from "./capacity";`:

```ts
import { carryOver } from "./rollover";
```

2. Insert before the line `export interface CapacityFigure {`:

```ts
/** HU-E6-09: what a line of the plan this one was copied from has available, by that line's id. */
export interface PreviousAvailable {
  readonly lineId: string;
  readonly available: bigint;
}

```

3. Insert after the line `  readonly spent: bigint;` (the `LineFigure` field; `  readonly available: bigint;` matches twice once item 2 ran):

```ts
  /** HU-E6-09: carried from the line this one was copied from, by this line's rollover mode; 0 without one. */
  readonly carryOver: bigint;
```

4. Replace the block from the line ` * HU-E6-02 … HU-E6-05, spec 5.4: every figure of a plan for its current members (`memberIds`, join order),` through the line `  const planned = parts.lines.reduce((sum, line) => sum + line.plannedAmount, 0n);` with:

```ts
 * HU-E6-02 … HU-E6-05, HU-E6-09, spec 5.4: every figure of a plan for its current members (`memberIds`, join
 * order), derived on read (D7). available = planned + carry-over − spent; a line's carry-over follows its origin
 * line in `previousAvailable` (the figures of the plan it was copied from), by its own rollover mode (ruling P15),
 * and is 0 without one.
 */
export const planFigures = (input: {
  readonly currency: string;
  readonly memberIds: readonly string[];
  readonly parts: PlanParts;
  readonly spending: PeriodSpending;
  readonly previousAvailable?: readonly PreviousAvailable[];
}): PlanFigures => {
  const { currency, memberIds, parts, spending, previousAvailable = [] } = input;
  const total = totalCapacity(parts.capacities, memberIds);
  const members = memberIds.map((memberId) => ({
    memberId,
    capacity: capacityOf(parts.capacities, memberId),
  }));
  const spentOn = new Map<string | null, bigint>();
  for (const { categoryId, amount } of spending.byCategory) {
    const lineId = lineForCategory(categoryId, parts);
    spentOn.set(lineId, (spentOn.get(lineId) ?? 0n) + amount);
  }
  const transfersInto = (accountIds: readonly string[]) =>
    spending.byAccount.filter((a) => accountIds.includes(a.accountId)).reduce((sum, a) => sum + a.amount, 0n);
  const lines = parts.lines.map((line): LineFigure => {
    const spent =
      line.funding === "SAVINGS" ? transfersInto(line.savingsAccountIds) : (spentOn.get(line.id) ?? 0n);
    // HU-E6-09: by the origin link only, never by name.
    const origin = previousAvailable.find((p) => p.lineId === line.originLineId);
    const carried = carryOver(line.rolloverMode, origin?.available ?? null);
    return {
      line,
      categoryIds: parts.mappings.filter((m) => m.lineId === line.id).map((m) => m.categoryId),
      capacityShareBasisPoints: shareOfTotal(line.plannedAmount, total),
      allocation: allocationFigure(line, parts.allocations, members, currency),
      spent,
      carryOver: carried,
      available: line.plannedAmount + carried - spent,
    };
  });
  const planned = parts.lines.reduce((sum, line) => sum + line.plannedAmount, 0n);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/budgeting`
Expected: PASS (every M3-A figure test keeps passing: without `previousAvailable` every carry-over is 0).

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/domain/rollover.ts src/modules/budgeting/domain/rollover.test.ts src/modules/budgeting/domain/plan-figures.ts src/modules/budgeting/domain/plan-figures.test.ts
git commit -m "feat(budgeting): carry each line's available over by its rollover mode (Refs #55)"
```

---

### Task 11: Budgeting — carry-over along the chain of copies on read

Implements HU-E6-09 (issue #55) at the use-case level: every read of a plan, and every write's answer, derives its carry-over from the plan it was copied from (D7). Pins Review Focus 4 (an ADJUSTED overspend through three periods) and Review Focus 5 (an origin removed from its plan).

Decisions:
- `loadPlanView` computes a plan's figures with `previousAvailable` taken from the figures of `plan.createdFrom`, recursively; it reads the earlier plan only when one of the lines has an origin and a mode other than RESET, so plans that carry nothing cost no extra read. The chain ends because `createdFrom` always names a plan that existed when the copy was made (an earlier period); a `seen` set stops it anyway.
- Every earlier plan is read with the space's **current** members (the carry-over depends on planned and spent, not on members, except SAVINGS spending, which follows P8's current-member filter), and regardless of its status (ruling P15: the carry-over is derived on read, also while the previous plan is still ACTIVE or the copy a DRAFT).
- An origin line that is no longer a current line of its plan (removed after the copy) is not in the earlier figures, so it carries 0.

**Files:**
- Modify: `src/modules/budgeting/application/plan-view.ts`
- Test: create `src/modules/budgeting/application/rollover.test.ts`

**Interfaces:**
- Consumes: `planFigures` with `previousAvailable`, `PreviousAvailable` (Task 10); `createCopyBudgetPlan` (Task 7); `createUpdateBudgetLine`, `createRemoveBudgetLine`, `createGetBudgetPlan` (M3-A); `budgetingWorld`, `householdCategories`, `aLine`.
- Produces: `loadPlanView(deps, space, plan)` with the same signature, now carrying `figures.lines[].carryOver`.

- [ ] **Step 1: Write the failing tests**

`src/modules/budgeting/application/rollover.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { aLine } from "../../../../tests/support/budget-fixtures";
import {
  BUDGET_MEMBERS,
  budgetingWorld,
  HOUSEHOLD,
  householdCategories,
} from "../../../../tests/support/budgeting-world";
import { unwrap } from "../../../../tests/support/fakes";
import type { RolloverMode } from "../domain/budget-line";
import { createCopyBudgetPlan } from "./copy-budget-plan";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createGetBudgetPlan } from "./get-budget-plan";
import type { BudgetPlanView } from "./plan-view";
import type { PlanSpending } from "./ports";
import { createRemoveBudgetLine } from "./remove-budget-line";
import { createUpdateBudgetLine } from "./update-budget-line";

const ANA_AND_JUAN = BUDGET_MEMBERS.filter((m) => m.displayName === "Ana" || m.displayName === "Juan");
const pesos = (n: number) => BigInt(n) * 100n;

/** Groceries spending by the first day of each plan's period, as the ledger sums it; records each period asked. */
class SpendingByPeriod implements PlanSpending {
  readonly asked: LocalDate[] = [];
  constructor(private readonly groceriesFrom: Readonly<Record<string, bigint>>) {}

  async expensesByCategory(_spaceId: string, from: LocalDate) {
    this.asked.push(from);
    const amount = this.groceriesFrom[from];
    return amount === undefined ? [] : [{ categoryId: "cat-groceries", amount }];
  }

  async transfersIntoAccounts() {
    return [];
  }
}

/**
 * HU-E6-09 Background: Home planned 1,470,000 COP with `mode` in Household's 2026-11 plan, Groceries mapped to it,
 * and the ledger's Groceries spending per period start; later plans are copies made with CopyBudgetPlan.
 */
const world = async (mode: RolloverMode, groceriesFrom: Readonly<Record<string, bigint>>) => {
  const w = budgetingWorld({ members: ANA_AND_JUAN });
  const spending = new SpendingByPeriod(groceriesFrom);
  const deps = {
    ...w.deps,
    spending,
    capacities: w.plans,
    lines: w.plans,
    mappings: w.plans,
    allocations: w.plans,
    categories: householdCategories,
  };
  const create = createCreateBudgetPlan(deps);
  const november = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" })).plan;
  w.plans.seed(november.id, {
    capacities: [{ memberId: "member-ana", amount: 400_000_000n }],
    lines: [aLine("Home", 147_000_000n, { rolloverMode: mode })],
    mappings: [{ lineId: "line-home", categoryId: "cat-groceries" }],
  });
  const copyInto = async (period: string) =>
    unwrap(await createCopyBudgetPlan(deps)({ spaceId: HOUSEHOLD, userId: "u-ana", period })).view;
  const read = async (planId: string) =>
    unwrap(await createGetBudgetPlan(deps)({ spaceId: HOUSEHOLD, userId: "u-ana", planId }));
  const write = (planId: string, lineId: string) => ({
    spaceId: HOUSEHOLD,
    userId: "u-ana",
    planId,
    lineId,
    expectedVersion: null,
  });
  return { ...w, deps, spending, november, copyInto, read, write };
};
const home = (view: BudgetPlanView) => {
  const [line] = view.figures.lines;
  return [line!.line.name, line!.carryOver, line!.available];
};

describe("carry-over along the chain of copies (HU-E6-09)", () => {
  it("carries Home's 200,000 COP left in 2026-11 into its 2026-12 copy with ROLLOVER, reading November for it", async () => {
    const { copyInto, read, november, spending } = await world("ROLLOVER", { "2026-11-01": pesos(1_270_000) });
    spending.asked.length = 0;
    const december = await copyInto("2026-12");
    expect(spending.asked).toEqual(["2026-12-01", "2026-11-01"]);
    expect(home(await read(november.id))).toEqual(["Home", 0n, pesos(200_000)]);
    expect(home(december)).toEqual(["Home", pesos(200_000), pesos(1_670_000)]);
  });

  it("reads no earlier plan when no line carries over", async () => {
    const { copyInto, spending } = await world("RESET", { "2026-11-01": pesos(1_270_000) });
    spending.asked.length = 0;
    expect(home(await copyInto("2026-12"))).toEqual(["Home", 0n, pesos(1_470_000)]);
    expect(spending.asked).toEqual(["2026-12-01"]);
  });

  it("carries an ADJUSTED overspend along the chain: 2026-11 into 2026-12 into 2027-01 (Review Focus 4)", async () => {
    const { copyInto } = await world("ADJUSTED", {
      "2026-11-01": pesos(1_600_000),
      "2026-12-01": pesos(1_500_000),
    });
    expect(home(await copyInto("2026-12"))).toEqual(["Home", pesos(-130_000), pesos(-160_000)]);
    expect(home(await copyInto("2027-01"))).toEqual(["Home", pesos(-160_000), pesos(1_310_000)]);
  });

  it("follows the copied line after a rename: House still receives Home's 200,000 COP", async () => {
    const { copyInto, deps, read, write } = await world("ROLLOVER", { "2026-11-01": pesos(1_270_000) });
    const december = await copyInto("2026-12");
    const [copied] = december.figures.lines;
    unwrap(
      await createUpdateBudgetLine(deps)({ ...write(december.plan.id, copied!.line.id), changes: { name: "House" } }),
    );
    expect(home(await read(december.plan.id))).toEqual(["House", pesos(200_000), pesos(1_670_000)]);
  });

  it("carries 0 once the origin line was removed from the earlier plan (Review Focus 5)", async () => {
    const { copyInto, deps, read, write, november } = await world("ROLLOVER", { "2026-11-01": pesos(1_270_000) });
    const december = await copyInto("2026-12");
    unwrap(await createRemoveBudgetLine(deps)(write(november.id, "line-home")));
    expect(home(await read(december.plan.id))).toEqual(["Home", 0n, pesos(1_470_000)]);
  });

  it("carries nothing into a plan that was not copied: no previous plan means no carry-over", async () => {
    const { read, november } = await world("ROLLOVER", {});
    expect(home(await read(november.id))).toEqual(["Home", 0n, pesos(1_470_000)]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/application/rollover.test.ts`
Expected: FAIL — every copy reports a carry-over of 0 (`loadPlanView` passes no `previousAvailable`), and the first test's `spending.asked` lacks `"2026-11-01"`.

- [ ] **Step 3: Implement**

Replace the contents of `src/modules/budgeting/application/plan-view.ts` with:

```ts
import type { SpaceMember, SpaceMembership } from "@/modules/spaces/application";
import type { BudgetPlan } from "../domain/plan";
import { planFigures, type PlanFigures, type PreviousAvailable } from "../domain/plan-figures";
import type { BudgetingDeps } from "./deps";
import type { PlanContents, SavingsAccountReader } from "./ports";

/** A plan with every figure derived on read (D7), its amounts in the space currency. */
export interface BudgetPlanView {
  readonly plan: BudgetPlan;
  readonly currency: string;
  readonly figures: PlanFigures;
}

type ViewDeps = Pick<BudgetingDeps, "members" | "plans" | "spending" | "savingsAccounts">;

/**
 * P8: of the accounts SAVINGS lines name, the ones whose owner is a current registered member of the plan's space.
 * The account of a member who left stays on its line but stops counting, for every reader.
 */
const accountsOfMembers = async (
  accounts: SavingsAccountReader,
  members: readonly SpaceMember[],
  accountIds: readonly string[],
): Promise<string[]> => {
  const owners = new Set(members.flatMap((m) => (m.userId === null ? [] : [m.userId])));
  // Resolved together; Promise.all keeps the order of the ids, so the counted ones keep the lines' order.
  const found = await Promise.all(
    accountIds.map(async (accountId) => ({ accountId, account: await accounts.find(accountId) })),
  );
  return found
    .filter(({ account }) => account !== null && owners.has(account.ownerUserId))
    .map(({ accountId }) => accountId);
};

/**
 * HU-E6-09: what the lines of the plan `plan` was copied from have available, read only when one of its lines
 * carries over (an origin and a mode other than RESET). The chain follows createdFrom, which always names an
 * earlier plan, so it ends; `seen` stops it anyway. Earlier plans are read whatever their status (ruling P15).
 */
const previousAvailable = async (
  deps: ViewDeps,
  space: SpaceMembership,
  plan: BudgetPlan,
  context: {
    readonly parts: PlanContents;
    readonly members: readonly SpaceMember[];
    readonly seen: ReadonlySet<string>;
  },
): Promise<PreviousAvailable[]> => {
  const rolls = context.parts.lines.some((line) => line.originLineId !== null && line.rolloverMode !== "RESET");
  if (!rolls || plan.createdFrom === null || context.seen.has(plan.createdFrom)) return [];
  const source = await deps.plans.find(space.spaceId, plan.createdFrom);
  if (source === null) return [];
  const figures = await figuresOf(deps, space, source, context.members, new Set([...context.seen, plan.id]));
  return figures.lines.map((figure) => ({ lineId: figure.line.id, available: figure.available }));
};

/** The figures of `plan` for the current members: its parts, the spending within its stored dates, its carry-over. */
const figuresOf = async (
  deps: ViewDeps,
  space: SpaceMembership,
  plan: BudgetPlan,
  members: readonly SpaceMember[],
  seen: ReadonlySet<string>,
): Promise<PlanFigures> => {
  const parts = await deps.plans.contents(plan.id);
  const { start, end } = plan.period;
  const accountIds = await accountsOfMembers(
    deps.savingsAccounts,
    members,
    parts.lines.flatMap((line) => line.savingsAccountIds),
  );
  const spending = {
    byCategory: await deps.spending.expensesByCategory(space.spaceId, start, end),
    byAccount:
      accountIds.length === 0 ? [] : await deps.spending.transfersIntoAccounts(accountIds, start, end),
  };
  return planFigures({
    currency: space.currency,
    memberIds: members.map((m) => m.id),
    parts,
    spending,
    previousAvailable: await previousAvailable(deps, space, plan, { parts, members, seen }),
  });
};

/** The plan's parts, its space's current members, the spending within its stored dates and its carry-over. */
export const loadPlanView = async (
  deps: ViewDeps,
  space: SpaceMembership,
  plan: BudgetPlan,
): Promise<BudgetPlanView> => {
  const members = await deps.members.listCurrent(space.spaceId);
  return { plan, currency: space.currency, figures: await figuresOf(deps, space, plan, members, new Set()) };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/budgeting && pnpm exec vitest run --project integration src/modules/budgeting`
Expected: PASS (M3-A's `plans.test.ts` "asks for every named account before waiting for any …" and the spending-period checks keep passing: plans without copies read nothing more). Mutation check: temporarily drop the `!rolls ||` condition — "reads no earlier plan when no line carries over" fails with `["2026-12-01", "2026-11-01"]`; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/application/plan-view.ts src/modules/budgeting/application/rollover.test.ts
git commit -m "feat(budgeting): derive each line's carry-over along the chain of copied plans on read (Refs #55)"
```

---

### Task 12: HTTP — carry-over on every line

Implements HU-E6-09 (issue #55) over HTTP: `carryOver` joins `available` on each line of `GET …/plans/{planId}` and of every write's answer (HU-E6-09 note). Pins the HU-E6-09 outline end to end.

**Files:**
- Modify: `src/modules/budgeting/contracts/budgeting.contract.ts`, `src/modules/budgeting/contracts/budgeting.contract.test.ts`, `openapi/openapi.snapshot.json`, `tests/support/budgeting.ts`, `docs/backlog/E6-budgeting.md`
- Create (test): `tests/acceptance/budget-rollover.test.ts`

**Interfaces:**
- Consumes: `LineFigure.carryOver` (Task 10), the chain on read (Task 11); `copyPlan` (Task 9b); `referencePlan`, `putCategories`, `patchLine`, `planOf`, `lineNamed`; `post`, `cop`.
- Produces: `BudgetLineSchema.carryOver: Money`; `LineDto.carryOver: MoneyDto` in `tests/support/budgeting.ts`.

- [ ] **Step 1: Write the failing tests**

In `src/modules/budgeting/contracts/budgeting.contract.test.ts`, insert before the line `      available: cop(570_000),`:

```ts
      carryOver: cop(0),
```

In `tests/support/budgeting.ts`, insert before the line `  available: MoneyDto;`:

```ts
  carryOver: MoneyDto;
```

`tests/acceptance/budget-rollover.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { startTestApp } from "../support/app";
import {
  copyPlan,
  lineNamed,
  patchLine,
  planOf,
  putCategories,
  referencePlan,
  type PlanDto,
} from "../support/budgeting";
import { cop, post } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/**
 * HU-E6-09 Background: the reference plan for 2026-11 with Groceries mapped to Home and Home's rollover `mode`; Ana
 * spends `pesos` in Groceries on 2026-11-10; then 2026-12 is copied from it, before any December spending.
 */
const rolledInto = async (mode: string, pesos: number) => {
  const ref = await referencePlan();
  const { h, planId, lineId } = ref;
  expect((await putCategories(h.ana, h.spaceId, planId, lineId("Home"), [h.groceries])).status).toBe(200);
  expect((await patchLine(h.ana, h.spaceId, planId, lineId("Home"), { rolloverMode: mode })).status).toBe(200);
  const spent = await post(recordExpense, h.ana, "expenses", {
    description: "Market",
    date: "2026-11-10",
    categoryId: h.groceries,
    amount: cop(pesos),
    accountId: h.ana.account,
  });
  expect(spent.status).toBe(201);
  const copied = await copyPlan(h.ana, h.spaceId, "2026-12");
  expect(copied.status).toBe(201);
  return { ...ref, december: (await copied.json()) as PlanDto };
};

describe("rollover modes (HU-E6-09)", () => {
  it.each<[string, number, number, number]>([
    ["RESET", 1_270_000, 200_000, 1_470_000],
    ["RESET", 1_600_000, -130_000, 1_470_000],
    ["ROLLOVER", 1_270_000, 200_000, 1_670_000],
    ["ROLLOVER", 1_600_000, -130_000, 1_470_000],
    ["ADJUSTED", 1_270_000, 200_000, 1_470_000],
    ["ADJUSTED", 1_600_000, -130_000, 1_340_000],
  ])("%s, %i COP spent in 2026-11: November available %i, December available %i (outline)", async (mode, spent, nov, dec) => {
    const { h, planId, december } = await rolledInto(mode, spent);
    expect(lineNamed(await planOf(h.ana, h.spaceId, planId), "Home").available).toEqual(cop(nov));
    expect(lineNamed(december, "Home")).toMatchObject({ carryOver: cop(dec - 1_470_000), available: cop(dec) });
    expect(lineNamed(await planOf(h.juan, h.spaceId, december.id), "Home").available).toEqual(cop(dec));
  });

  it("carries nothing into a plan without a previous plan", async () => {
    const { h, planId, lineId } = await referencePlan();
    expect((await patchLine(h.ana, h.spaceId, planId, lineId("Home"), { rolloverMode: "ROLLOVER" })).status).toBe(
      200,
    );
    expect(lineNamed(await planOf(h.ana, h.spaceId, planId), "Home")).toMatchObject({
      carryOver: cop(0),
      available: cop(1_470_000),
    });
  });

  it("carries over through the origin line, not the name: Home renamed House still receives 200,000 COP", async () => {
    const { h, lineId, december } = await rolledInto("ROLLOVER", 1_270_000);
    const renamed = await patchLine(h.ana, h.spaceId, december.id, lineNamed(december, "Home").id, {
      name: "House",
    });
    expect(renamed.status).toBe(200);
    expect(lineNamed((await renamed.json()) as PlanDto, "House")).toMatchObject({
      originLineId: lineId("Home"),
      carryOver: cop(200_000),
      available: cop(1_670_000),
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/contracts && pnpm exec vitest run --project acceptance tests/acceptance/budget-rollover.test.ts`
Expected: FAIL — the DTO has no `carryOver` (the unit `toEqual` and every acceptance `carryOver` expectation fail; the available amounts already match).

- [ ] **Step 3: Implement**

In `src/modules/budgeting/contracts/budgeting.contract.ts`:

1. Replace the line `  /** planned + carry-over − spent; the carry-over is 0 until lines are copied (HU-E6-06, HU-E6-09). */` with:

```ts
  /** HU-E6-09: carried from the line this one was copied from (`originLineId`), by this line's rollover mode. */
  carryOver: MoneySchema,
  /** planned + carry-over − spent, computed on read (D7). */
```

2. Insert before the line `    available: moneyOf(figure.available, currency),`:

```ts
    carryOver: moneyOf(figure.carryOver, currency),
```

In `docs/backlog/E6-budgeting.md`:

1. Replace the text `(planned − spent; HU-E6-09's carry-over is 0 until lines are copied)` in the HU-E6-04 note with `(planned + carry-over − spent; the carry-over of HU-E6-09)`.
2. Insert after the line `- Computed on read (D7); recursion bounded by the plan chain. Exposed as `available` and `carryOver` on each line of `GET /api/v1/spaces/{spaceId}/plans/{planId}`.`:

```markdown
- The mode that decides is the receiving line's own `rolloverMode`; the previous available is the origin line's `available` in the plan the line was copied from (itself with its own carry-over), whatever that plan's status. An origin removed from its plan after the copy carries 0. Every write's answer carries the same figures.
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: only `components.schemas.BudgetPlan` changes, gaining `lines[].carryOver` (a `MoneyOutput` reference, also in `required`, and the new `available` description; about 8 lines); no operation and no other component changes.
Then run: `pnpm exec vitest run --project unit src/modules/budgeting src/composition && pnpm exec vitest run --project acceptance tests/acceptance/budget-rollover.test.ts tests/acceptance/budget-lines.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/contracts/budgeting.contract.ts src/modules/budgeting/contracts/budgeting.contract.test.ts openapi/openapi.snapshot.json docs/backlog/E6-budgeting.md tests/support/budgeting.ts tests/acceptance/budget-rollover.test.ts
git commit -m "feat(budgeting): report each line's carry-over over HTTP (Refs #55)"
```

---

### Task 13: Ledger — BY_ALLOCATION shares and the default-split port

Implements the ledger side of HU-E6-08 (issue #54; touches `RecordExpense` of HU-E4-07, issue #36, closed in M2; not reopened). Pins Review Focus 1 (the closed period is checked before the default is read) and Review Focus 4 (bigint weights, a 0 weight).

Decisions:
- `splitShares` takes a fifth method, `BY_ALLOCATION`, only as the domain type `AllocationSplit` (participants with positive bigint `weight`s, the line's assigned amounts). It is never part of `SplitInput`, so clients cannot request it (ruling P16) and the ledger contract does not change.
- A new port `DefaultSplitSource.allocationWeights({ spaceId, currency, categoryId, date })` answers the BY_ALLOCATION weights or null; `RecordExpense` asks it only when the request has no `split`, and null keeps today's default (EQUAL among every current member). The port is the ledger's own type; the composition root binds it to budgeting in Task 15b and answers null until then.
- `RecordExpense` now resolves the date and checks the closed period **before** the split (ruling P14): a closed period takes nothing, so no default is read for it, and the `FOR SHARE` lock the guard took on the covering plan keeps plan writes out while the default is read, so the shares follow one committed version of the plan. A request that is both in a closed period and has an invalid split now answers `PeriodClosed` first (previously `InvalidSplit`).

**Files:**
- Modify: `src/modules/ledger/domain/split.ts`, `src/modules/ledger/application/ports.ts`, `src/modules/ledger/application/deps.ts`, `src/modules/ledger/application/record-expense.ts`, `src/modules/ledger/application/index.ts`, `tests/support/in-memory-ledger.ts`, `src/composition/container.ts`
- Test: `src/modules/ledger/domain/split.test.ts`, create `src/modules/ledger/application/default-split.test.ts`

**Interfaces:**
- Consumes: `splitShares`, `SplitInput` (M2-B); `openPeriod`, `LedgerDeps`, `householdLedger`, `ledgerFixture` (M1, M2-B).
- Produces:
  - `interface AllocationSplit { method: "BY_ALLOCATION"; participants: readonly { memberId: string; weight: bigint }[] }`; `splitShares(amount: Money, split: SplitInput | AllocationSplit, memberIds: readonly string[]): Result<Share[]>` — `InvalidSplit` (`weightNotPositive`)
  - `interface DefaultSplitQuery { spaceId: SpaceId; currency: string; categoryId: string; date: LocalDate }`; `interface DefaultSplitSource { allocationWeights(expense: DefaultSplitQuery): Promise<readonly { memberId: string; weight: bigint }[] | null> }`; `LedgerDeps.defaultSplits: DefaultSplitSource`

- [ ] **Step 1: Write the failing tests**

In `src/modules/ledger/domain/split.test.ts`:

1. Replace the line `import { splitShares, type SplitInput } from "./split";` with:

```ts
import { splitShares, type AllocationSplit, type SplitInput } from "./split";
```

2. Append to the end of the file:

```ts

describe("BY_ALLOCATION (HU-E6-08)", () => {
  const byAllocation = (...weights: [string, bigint][]): AllocationSplit => ({
    method: "BY_ALLOCATION",
    participants: weights.map(([memberId, weight]) => ({ memberId, weight })),
  });

  it("splits 2,000,000 COP by Home's assigned 588,000 / 882,000 COP: 800,000 / 1,200,000 (golden)", () => {
    const split = byAllocation(["member-juan", 88_200_000n], ["member-ana", 58_800_000n]);
    expect(unwrap(splitShares(pesos(2_000_000n), split, MEMBERS))).toEqual([
      { memberId: "member-ana", amount: 80_000_000n, splitMethod: "BY_ALLOCATION" },
      { memberId: "member-juan", amount: 120_000_000n, splitMethod: "BY_ALLOCATION" },
    ]);
  });

  it("splits 300,000 COP by fixed amounts of 490,000 / 980,000 COP: 100,000 / 200,000", () => {
    const split = byAllocation(["member-ana", 49_000_000n], ["member-juan", 98_000_000n]);
    expect(unwrap(splitShares(pesos(300_000n), split, MEMBERS)).map((s) => s.amount)).toEqual([
      10_000_000n,
      20_000_000n,
    ]);
  });

  it("refuses a weight that is not positive", () => {
    const split = byAllocation(["member-ana", 0n], ["member-juan", 98_000_000n]);
    expect(splitShares(pesos(300_000n), split, MEMBERS)).toEqual({
      ok: false,
      error: { code: "InvalidSplit", details: { reason: "weightNotPositive" } },
    });
  });
});
```

`src/modules/ledger/application/default-split.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES, householdLedger } from "../../../../tests/support/in-memory-ledger";
import type { Expense, Transaction } from "../domain/transaction";
import type { DefaultSplitQuery, DefaultSplitSource } from "./ports";
import { createRecordExpense, type RecordExpenseInput } from "./record-expense";

const cop = (pesos: bigint) => money(pesos * 100n);

/** Budgeting's answer for Home in the ACTIVE 2026-11 plan, Ana 588,000 and Juan 882,000 COP; records each ask. */
const budgeting = (
  answer: readonly { memberId: string; weight: bigint }[] | null = [
    { memberId: "member-ana", weight: 58_800_000n },
    { memberId: "member-juan", weight: 88_200_000n },
  ],
) => {
  const asked: DefaultSplitQuery[] = [];
  const defaultSplits: DefaultSplitSource = {
    allocationWeights: async (expense) => {
      asked.push(expense);
      return answer;
    },
  };
  return { defaultSplits, asked };
};

/** HU-E6-08: Ana pays `pesos` of household groceries alone from Bancolombia on 2026-11-08, choosing no split. */
const groceries = (pesos: bigint, overrides: Partial<RecordExpenseInput> = {}): RecordExpenseInput => ({
  spaceId: "space-household",
  userId: "u-ana",
  description: "Groceries",
  date: "2026-11-08" as LocalDate,
  categoryId: CATEGORIES.household.id,
  amount: cop(pesos),
  payments: [{ memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: cop(pesos) }],
  ...overrides,
});
const sharesOf = (rows: readonly Transaction[]) =>
  (rows.at(-1) as Expense).shares.map((s) => [s.memberId, s.amount, s.splitMethod]);

describe("the default split of RecordExpense (HU-E6-08, spec 5.3)", () => {
  it("defaults to BY_ALLOCATION by Home's assigned amounts: 800,000 COP for Ana, 1,200,000 COP for Juan (golden)", async () => {
    const { defaultSplits, asked } = budgeting();
    const { deps, store } = householdLedger(undefined, { defaultSplits });
    unwrap(await createRecordExpense(deps)(groceries(2_000_000n)));
    expect(sharesOf(store.rows)).toEqual([
      ["member-ana", 80_000_000n, "BY_ALLOCATION"],
      ["member-juan", 120_000_000n, "BY_ALLOCATION"],
    ]);
    expect(asked).toEqual([
      { spaceId: "space-household", currency: "COP", categoryId: "cat-household", date: "2026-11-08" },
    ]);
  });

  it("defaults to EQUAL among every current member when budgeting has no allocated line", async () => {
    const { defaultSplits } = budgeting(null);
    const { deps, store } = householdLedger(undefined, { defaultSplits });
    unwrap(await createRecordExpense(deps)(groceries(500_000n)));
    expect(sharesOf(store.rows)).toEqual(
      ["member-ana", "member-juan", "member-luis", "member-sofi", "member-pedro"].map((memberId) => [
        memberId,
        10_000_000n,
        "EQUAL",
      ]),
    );
  });

  it("keeps the split the member chose, and never asks for a default", async () => {
    const { defaultSplits, asked } = budgeting();
    const { deps, store } = householdLedger(undefined, { defaultSplits });
    const split = { method: "EQUAL" as const, participants: [{ memberId: "member-ana" }, { memberId: "member-juan" }] };
    unwrap(await createRecordExpense(deps)(groceries(2_000_000n, { split })));
    expect(sharesOf(store.rows)).toEqual([
      ["member-ana", 100_000_000n, "EQUAL"],
      ["member-juan", 100_000_000n, "EQUAL"],
    ]);
    expect(asked).toEqual([]);
  });

  it("asks for the default of today in the space timezone when the expense has no date", async () => {
    const { defaultSplits, asked } = budgeting();
    const { deps } = householdLedger(undefined, { defaultSplits });
    unwrap(await createRecordExpense(deps)(groceries(2_000_000n, { date: undefined })));
    expect(asked.map((a) => a.date)).toEqual(["2026-10-28"]);
  });

  it("refuses a closed period before reading any default (P14, Review Focus 1)", async () => {
    const { defaultSplits, asked } = budgeting();
    const { deps } = householdLedger(undefined, { defaultSplits, closedPeriods: { isClosed: async () => true } });
    expect(codeOf(await createRecordExpense(deps)(groceries(2_000_000n)))).toBe("PeriodClosed");
    expect(asked).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/domain/split.test.ts src/modules/ledger/application/default-split.test.ts`
Expected: FAIL — `splitShares` answers `InvalidSplit` for BY_ALLOCATION (`amountsOf` has no such case and returns `undefined`, so the test errors on `amounts.ok`), and `RecordExpense` never asks `defaultSplits` (EQUAL among five members).

- [ ] **Step 3: Implement**

In `src/modules/ledger/domain/split.ts`:

1. Insert before the line `/** 100 % in basis points. */`:

```ts
/**
 * HU-E6-08: BY_ALLOCATION, the default split of an expense whose category resolves to an allocated line of the
 * ACTIVE plan (spec 5.3). Never requested by a client (ruling P16): the weights are the line's assigned amounts.
 */
export interface AllocationSplit {
  readonly method: "BY_ALLOCATION";
  readonly participants: readonly { readonly memberId: string; readonly weight: bigint }[];
}

```

2. Replace the line `const allocated = (amount: Money, weights: readonly number[]): Result<bigint[]> =>` with:

```ts
const allocated = (amount: Money, weights: readonly (number | bigint)[]): Result<bigint[]> =>
```

3. Replace the line `const amountsOf = (amount: Money, split: SplitInput, order: readonly number[]): Result<bigint[]> => {` with:

```ts
const amountsOf = (
  amount: Money,
  split: SplitInput | AllocationSplit,
  order: readonly number[],
): Result<bigint[]> => {
```

4. Insert before the line `    case "EXACT": {`:

```ts
    case "BY_ALLOCATION": {
      const weights = order.map((index) => split.participants[index]!.weight);
      if (weights.some((weight) => weight <= 0n)) return invalid("weightNotPositive");
      return allocated(amount, weights);
    }
```

5. Replace the line `  split: SplitInput,` inside `splitShares`'s parameters with:

```ts
  split: SplitInput | AllocationSplit,
```

In `src/modules/ledger/application/ports.ts`:

1. Insert before the line `import type { LocalDate } from "@/shared/kernel";`:

```ts
import type { SpaceId } from "@/modules/spaces/application";
```

2. Insert before the line `export interface TransactionRepository {`:

```ts
/** HU-E6-08: the expense whose default split is asked for. */
export interface DefaultSplitQuery {
  readonly spaceId: SpaceId;
  readonly currency: string;
  readonly categoryId: string;
  readonly date: LocalDate;
}

/**
 * HU-E6-08, spec 5.3: the BY_ALLOCATION weights of an expense recorded without a split, bound by the composition
 * root to budgeting (the ledger never imports it). Null means EQUAL among every current member: no ACTIVE plan
 * covers the date, the category resolves to no line, or the line is NONE or its allocation does not hold.
 */
export interface DefaultSplitSource {
  allocationWeights(
    expense: DefaultSplitQuery,
  ): Promise<readonly { readonly memberId: string; readonly weight: bigint }[] | null>;
}

```

In `src/modules/ledger/application/deps.ts`:

1. Insert before the line `  ClosedPeriodGuard,`:

```ts
  DefaultSplitSource,
```

2. Insert after the line `  readonly closedPeriods: ClosedPeriodGuard;`:

```ts
  /** HU-E6-08: the default split of an expense recorded without one (BY_ALLOCATION or EQUAL). */
  readonly defaultSplits: DefaultSplitSource;
```

In `src/modules/ledger/application/record-expense.ts`:

1. Replace the line `import { splitShares, type SplitInput } from "../domain/split";` with:

```ts
import { splitShares, type AllocationSplit, type SplitInput } from "../domain/split";
```

2. Replace the line `import type { LedgerDeps } from "./deps";` with:

```ts
import type { LedgerDeps } from "./deps";
import type { DefaultSplitQuery } from "./ports";
```

3. Replace the line `  /** HU-E4-07/08: how the amount is shared; EQUAL among every current member when absent (spec 5.3). */` with:

```ts
  /** HU-E4-07/08: how the amount is shared; when absent, the default split (spec 5.3, HU-E6-08). */
```

4. Insert before the line `/** HU-E4-10: the fund may go negative; the expense is recorded and the response warns. */`:

```ts
/**
 * Spec 5.3, HU-E6-08: without a chosen split, BY_ALLOCATION by the line the category consumes in the ACTIVE plan
 * covering the date, else EQUAL among every current member. The member can always choose another split.
 */
const defaultSplit = async (
  deps: Pick<LedgerDeps, "defaultSplits">,
  expense: DefaultSplitQuery,
  members: readonly SpaceMember[],
): Promise<SplitInput | AllocationSplit> => {
  const weights = await deps.defaultSplits.allocationWeights(expense);
  return weights === null
    ? { method: "EQUAL", participants: members.map((m) => ({ memberId: m.id })) }
    : { method: "BY_ALLOCATION", participants: weights };
};

```

5. Replace the block from the line `      const split: SplitInput = input.split ?? {` through the line `      if (!open.ok) return open;` with:

```ts
      const date = input.date ?? todayIn(deps.clock, deps.timeZone);
      // HU-E4-06 first (P14): a closed period takes nothing, and the guard's FOR SHARE lock on the covering plan keeps
      // plan writes out while the default split reads it.
      const open = await openPeriod(deps, space.spaceId, date);
      if (!open.ok) return open;
      const split =
        input.split ??
        (await defaultSplit(
          deps,
          { spaceId: space.spaceId, currency: space.currency, categoryId: category.value, date },
          members,
        ));
      const shares = splitShares(
        input.amount,
        split,
        members.map((m) => m.id),
      );
      if (!shares.ok) return shares;
```

In `src/modules/ledger/application/index.ts`:

1. Replace the line `export type { SplitInput } from "../domain/split";` with:

```ts
export type { AllocationSplit, SplitInput } from "../domain/split";
```

2. Insert before the line `  LedgerAccount,`:

```ts
  DefaultSplitQuery,
  DefaultSplitSource,
```

In `tests/support/in-memory-ledger.ts`, insert after the line `    closedPeriods: { isClosed: async () => false },`:

```ts
    // HU-E6-08: EQUAL unless a test binds budgeting's allocation weights.
    defaultSplits: { allocationWeights: async () => null },
```

In `src/composition/container.ts`, insert after the line `    closedPeriods: createClosedPeriodGuard(budgetPlans),` (written in Task 5b):

```ts
    // HU-E6-08: EQUAL until the composition root binds budgeting's allocation weights.
    defaultSplits: { allocationWeights: async () => null },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/ledger && pnpm exec vitest run --project acceptance tests/acceptance/shared-expenses.test.ts tests/acceptance/ledger.test.ts`
Expected: PASS (every M1–M2 ledger test keeps passing: the port answers null outside these tests).

Mutation check: "refuses a closed period before reading any default" passes before the implementation (nothing asks the port yet), so move the `openPeriod` check below the default-split resolution in `record-expense.ts` and rerun the unit file: that test must fail (`ok` instead of `PeriodClosed`). Restore the order.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (the OpenAPI snapshot is unchanged: `SplitBodySchema` did not change).

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/domain/split.ts src/modules/ledger/domain/split.test.ts src/modules/ledger/application/ports.ts src/modules/ledger/application/deps.ts src/modules/ledger/application/record-expense.ts src/modules/ledger/application/index.ts src/modules/ledger/application/default-split.test.ts tests/support/in-memory-ledger.ts src/composition/container.ts
git commit -m "feat(ledger): split expenses by allocation weights when no split is chosen (Refs #54, Refs #36)"
```

---

### Task 14: Budgeting — the default split of an expense

Implements the budgeting side of HU-E6-08 (issue #54). Pins Review Focus 3 (the guest Pedro alone on a FIXED Home; Sofi and Pedro without capacity) and Review Focus 4 (golden and FIXED ratios).

Decisions:
- `defaultSplitOf(deps, { spaceId, currency, categoryId, date })` (no authorization: its callers authorized) finds the plan covering the date; unless it is ACTIVE, the default is EQUAL (spec 5.3: "DRAFT plans never drive splits"; a CLOSED period records nothing anyway). The category resolves to its mapped line, else the catch-all line (`lineForCategory`, HU-E6-04); NONE, an allocation that does not hold, or no line at all give EQUAL. Otherwise the weights are the line's assigned amounts for the current members (`assignedAmounts`, the same derivation as the plan's figures), keeping only positive ones: BY_ALLOCATION ratios = assigned amounts of the line for the expense's period (HU-E6-08 note).
- EQUAL weighs every current member 1, which is the ledger's own EQUAL default, so the preview and the recorded expense agree.
- `ResolveDefaultSplit` (the public query of HU-E6-08) authorizes `space.read` (a preview records nothing; archived spaces read), requires a live category of the space (`CategoryNotInSpace` for anything else, unknown ids included, ruling P6; archived categories still resolve), and previews the shares of an optional amount with `Money.allocate` over the same weights. `availableMethods` lists BY_ALLOCATION only when it is the default (HU-E6-08 "does not list BY_ALLOCATION among the available methods"), then EQUAL, PERCENT, EXACT and SHARES.

**Files:**
- Create: `src/modules/budgeting/application/default-split.ts`
- Modify: `src/modules/budgeting/application/index.ts`
- Test: create `src/modules/budgeting/application/default-split.test.ts`

**Interfaces:**
- Consumes: `covering` (Task 2); `lineForCategory` (M3-A Task 4); `assignedAmounts` (M3-A Task 3); `capacityOf` (M3-A Task 1); `BudgetCategories` (M3-A Task 15); `budgetingWorld`, `householdCategories`, `BUDGET_MEMBERS`, `referenceLines`.
- Produces:
  - `SPLIT_METHODS = ["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"] as const`; `type SplitMethodName`
  - `interface ExpenseToSplit { spaceId: SpaceId; currency: string; categoryId: string; date: LocalDate }`
  - `interface DefaultSplit { method: "BY_ALLOCATION" | "EQUAL"; lineId: string | null; weights: readonly { memberId: string; weight: bigint }[] }`; `defaultSplitOf(deps: Pick<BudgetingDeps, "members" | "plans">, expense: ExpenseToSplit): Promise<DefaultSplit>`
  - `interface DefaultSplitView { method; availableMethods: readonly SplitMethodName[]; lineId: string | null; currency: string; shares: readonly { memberId: string; amount: bigint }[] | null }`; `type ResolveDefaultSplit = (input: { spaceId; userId; categoryId: string; date: LocalDate; amount: bigint | null }) => Promise<Result<DefaultSplitView>>`; `type DefaultSplitDeps = BudgetingDeps & { categories: BudgetCategories }`; `createResolveDefaultSplit(deps: DefaultSplitDeps)` — `SpaceNotFound`, `CategoryNotInSpace`

- [ ] **Step 1: Write the failing tests**

`src/modules/budgeting/application/default-split.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SpaceId, SpaceMember } from "@/modules/spaces/application";
import type { LocalDate } from "@/shared/kernel";
import { referenceLines } from "../../../../tests/support/budget-fixtures";
import {
  BUDGET_MEMBERS,
  budgetingWorld,
  HOUSEHOLD,
  householdCategories,
  NOW,
} from "../../../../tests/support/budgeting-world";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import type { LineAllocation } from "../domain/allocation";
import type { BudgetLine } from "../domain/budget-line";
import type { PlanStatus } from "../domain/plan";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createResolveDefaultSplit, defaultSplitOf, type DefaultSplitView } from "./default-split";

const ANA_AND_JUAN = BUDGET_MEMBERS.filter((m) => m.displayName === "Ana" || m.displayName === "Juan");
const pesos = (n: number) => BigInt(n) * 100n;
const ALL_METHODS = ["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"];

/**
 * HU-E6-08 Background: Household's reference plan for 2026-11, ACTIVE unless `status` says otherwise, Ana
 * 1,600,000 and Juan 2,400,000 COP, Groceries mapped to Home (PROPORTIONAL, 40 % / 60 %), Free the catch-all line.
 */
const world = async (
  options: {
    readonly status?: PlanStatus;
    readonly lines?: BudgetLine[];
    readonly allocations?: LineAllocation[];
    readonly members?: readonly SpaceMember[];
  } = {},
) => {
  const w = budgetingWorld({ members: options.members ?? ANA_AND_JUAN });
  const deps = { ...w.deps, categories: householdCategories };
  const create = createCreateBudgetPlan(deps);
  const plan = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" })).plan;
  w.plans.seed(plan.id, {
    capacities: [
      { memberId: "member-ana", amount: 160_000_000n },
      { memberId: "member-juan", amount: 240_000_000n },
    ],
    lines: options.lines ?? referenceLines(),
    mappings: [{ lineId: "line-home", categoryId: "cat-groceries" }],
    allocations: options.allocations ?? [],
  });
  await w.plans.setStatus(plan.id, options.status ?? "ACTIVE");
  const resolve = createResolveDefaultSplit(deps);
  const preview = (
    categoryId: string,
    ask: { readonly date?: string; readonly amount?: bigint | null; readonly userId?: string } = {},
  ) =>
    resolve({
      spaceId: HOUSEHOLD,
      userId: ask.userId ?? "u-ana",
      categoryId,
      date: (ask.date ?? "2026-11-08") as LocalDate,
      amount: ask.amount === undefined ? pesos(2_000_000) : ask.amount,
    });
  return { ...w, deps, plan, preview };
};
const sharesOf = (view: DefaultSplitView) => view.shares?.map((s) => [s.memberId, s.amount]) ?? null;
const withRule = (name: string, allocationRule: BudgetLine["allocationRule"]) =>
  referenceLines().map((l) => (l.name === name ? { ...l, allocationRule } : l));

describe("ResolveDefaultSplit (HU-E6-08, spec 5.3)", () => {
  it("defaults a Groceries expense to BY_ALLOCATION by Home: 800,000 and 1,200,000 COP of 2,000,000 (golden)", async () => {
    const { preview } = await world();
    expect(unwrap(await preview("cat-groceries"))).toEqual({
      method: "BY_ALLOCATION",
      availableMethods: ALL_METHODS,
      lineId: "line-home",
      currency: "COP",
      shares: [
        { memberId: "member-ana", amount: pesos(800_000) },
        { memberId: "member-juan", amount: pesos(1_200_000) },
      ],
    });
  });

  it("splits by fixed amounts: Home FIXED 490,000 / 980,000 COP shares 300,000 COP as 100,000 / 200,000", async () => {
    const allocations = [
      { lineId: "line-home", memberId: "member-ana", value: pesos(490_000) },
      { lineId: "line-home", memberId: "member-juan", value: pesos(980_000) },
    ];
    const { preview } = await world({ lines: withRule("Home", "FIXED"), allocations });
    expect(sharesOf(unwrap(await preview("cat-groceries", { amount: pesos(300_000) })))).toEqual([
      ["member-ana", pesos(100_000)],
      ["member-juan", pesos(200_000)],
    ]);
  });

  it("defaults an unmapped Outings expense to EQUAL when the catch-all Free is NONE, without offering BY_ALLOCATION", async () => {
    const { preview } = await world({ lines: withRule("Free", "NONE") });
    expect(unwrap(await preview("cat-outings", { amount: pesos(50_000) }))).toEqual({
      method: "EQUAL",
      availableMethods: ["EQUAL", "PERCENT", "EXACT", "SHARES"],
      lineId: "line-free",
      currency: "COP",
      shares: [
        { memberId: "member-ana", amount: pesos(25_000) },
        { memberId: "member-juan", amount: pesos(25_000) },
      ],
    });
  });

  it.each<PlanStatus>(["DRAFT", "CLOSED"])("defaults to EQUAL while the plan is %s: only ACTIVE plans drive splits", async (status) => {
    const { preview } = await world({ status });
    const view = unwrap(await preview("cat-groceries"));
    expect([view.method, view.lineId, sharesOf(view)]).toEqual([
      "EQUAL",
      null,
      [
        ["member-ana", pesos(1_000_000)],
        ["member-juan", pesos(1_000_000)],
      ],
    ]);
  });

  it("defaults to EQUAL on a date no plan covers, and while Home's allocation does not hold", async () => {
    const { preview } = await world();
    expect(unwrap(await preview("cat-groceries", { date: "2026-12-05" }))).toMatchObject({
      method: "EQUAL",
      lineId: null,
    });
    const allocations = [
      { lineId: "line-home", memberId: "member-ana", value: 4200n },
      { lineId: "line-home", memberId: "member-juan", value: 5700n },
    ];
    const broken = await world({ lines: withRule("Home", "PERCENT"), allocations });
    expect(unwrap(await broken.preview("cat-groceries"))).toMatchObject({ method: "EQUAL", lineId: "line-home" });
  });

  it("weighs only members with a positive assigned amount: Sofi and Pedro hold no capacity, Pedro alone a FIXED Home", async () => {
    const proportional = await world({ members: BUDGET_MEMBERS });
    expect(sharesOf(unwrap(await proportional.preview("cat-groceries")))).toEqual([
      ["member-ana", pesos(800_000)],
      ["member-juan", pesos(1_200_000)],
    ]);
    const allocations = [{ lineId: "line-home", memberId: "member-pedro", value: pesos(1_470_000) }];
    const pedro = await world({ members: BUDGET_MEMBERS, lines: withRule("Home", "FIXED"), allocations });
    expect(sharesOf(unwrap(await pedro.preview("cat-groceries")))).toEqual([["member-pedro", pesos(2_000_000)]]);
  });

  it("previews no shares without an amount", async () => {
    const { preview } = await world();
    expect(unwrap(await preview("cat-groceries", { amount: null })).shares).toBeNull();
  });

  it("answers any member, Sofi the VIEWER included, and refuses other spaces' categories and non-members", async () => {
    const { preview } = await world({ members: BUDGET_MEMBERS });
    expect(codeOf(await preview("cat-groceries", { userId: "u-sofi" }))).toBe("ok");
    expect(codeOf(await preview("cat-old"))).toBe("ok");
    expect(codeOf(await preview("cat-personal"))).toBe("CategoryNotInSpace");
    expect(codeOf(await preview("cat-unknown"))).toBe("CategoryNotInSpace");
    expect(codeOf(await preview("cat-groceries", { userId: "u-marta" }))).toBe("SpaceNotFound");
  });
});

describe("defaultSplitOf (what the ledger's DefaultSplitSource answers)", () => {
  it("weighs the current members only: once Juan left, Ana alone carries Home", async () => {
    const { deps, spaces } = await world();
    const expense = { spaceId: HOUSEHOLD as SpaceId, currency: "COP", categoryId: "cat-groceries", date: "2026-11-08" as LocalDate };
    expect(await defaultSplitOf(deps, expense)).toEqual({
      method: "BY_ALLOCATION",
      lineId: "line-home",
      weights: [
        { memberId: "member-ana", weight: 58_800_000n },
        { memberId: "member-juan", weight: 88_200_000n },
      ],
    });
    await spaces.markLeft(HOUSEHOLD, "member-juan", "USER", NOW);
    expect((await defaultSplitOf(deps, expense)).weights).toEqual([{ memberId: "member-ana", weight: 147_000_000n }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/application/default-split.test.ts`
Expected: FAIL — `Failed to resolve import "./default-split"`.

- [ ] **Step 3: Implement**

`src/modules/budgeting/application/default-split.ts`:

```ts
import { authorizeSpaceAction, type SpaceId } from "@/modules/spaces/application";
import { domainError, err, Money, ok, type LocalDate, type Result } from "@/shared/kernel";
import { assignedAmounts } from "../domain/allocation";
import { capacityOf } from "../domain/capacity";
import { lineForCategory } from "../domain/plan-figures";
import type { BudgetingDeps } from "./deps";
import type { BudgetCategories } from "./ports";

/** The ledger's split methods, as a member picks them (spec 5.2 Share); BY_ALLOCATION only as the default. */
export const SPLIT_METHODS = ["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"] as const;
export type SplitMethodName = (typeof SPLIT_METHODS)[number];

/** HU-E6-08: an expense of the space in `categoryId` dated `date`, its amounts in `currency`. */
export interface ExpenseToSplit {
  readonly spaceId: SpaceId;
  readonly currency: string;
  readonly categoryId: string;
  readonly date: LocalDate;
}

export interface DefaultSplit {
  readonly method: "BY_ALLOCATION" | "EQUAL";
  /** The line of the ACTIVE plan covering the date that the category consumes; null without one. */
  readonly lineId: string | null;
  /** BY_ALLOCATION: the line's positive assigned amounts; EQUAL: 1 per current member. Join order. */
  readonly weights: readonly { readonly memberId: string; readonly weight: bigint }[];
}

/**
 * HU-E6-08, spec 5.3, D4: the default split of an expense. BY_ALLOCATION by the line the category consumes (its
 * mapped line, else the catch-all line, HU-E6-04) in the ACTIVE plan covering the date, weighted by the line's
 * assigned amounts for the current members, the positive ones only; EQUAL among every current member otherwise: no
 * plan, a DRAFT or CLOSED one, no line, a NONE line, or an allocation that does not hold (ruling P16). It authorizes
 * nothing: its callers have.
 */
export const defaultSplitOf = async (
  deps: Pick<BudgetingDeps, "members" | "plans">,
  expense: ExpenseToSplit,
): Promise<DefaultSplit> => {
  const members = await deps.members.listCurrent(expense.spaceId);
  const equal = (lineId: string | null): DefaultSplit => ({
    method: "EQUAL",
    lineId,
    weights: members.map((m) => ({ memberId: m.id, weight: 1n })),
  });
  const plan = await deps.plans.covering(expense.spaceId, expense.date);
  if (plan === null || plan.status !== "ACTIVE") return equal(null);
  const parts = await deps.plans.contents(plan.id);
  const lineId = lineForCategory(expense.categoryId, parts);
  const line = parts.lines.find((l) => l.id === lineId);
  if (line === undefined) return equal(null);
  const assigned = assignedAmounts(
    line,
    parts.allocations.filter((a) => a.lineId === line.id),
    members.map((m) => ({ memberId: m.id, capacity: capacityOf(parts.capacities, m.id) })),
    expense.currency,
  );
  const weights =
    assigned.ok && assigned.value !== null
      ? assigned.value.filter((a) => a.amount > 0n).map((a) => ({ memberId: a.memberId, weight: a.amount }))
      : [];
  return weights.length === 0 ? equal(line.id) : { method: "BY_ALLOCATION", lineId: line.id, weights };
};

export interface DefaultSplitView {
  readonly method: DefaultSplit["method"];
  /** What a member may pick; BY_ALLOCATION only when it is the default, since no client requests it (P16). */
  readonly availableMethods: readonly SplitMethodName[];
  readonly lineId: string | null;
  readonly currency: string;
  /** The amount shared by the default, in join order; null when no amount was given. */
  readonly shares: readonly { readonly memberId: string; readonly amount: bigint }[] | null;
}

export type ResolveDefaultSplit = (input: {
  spaceId: string;
  userId: string;
  categoryId: string;
  date: LocalDate;
  /** Minor units of the space currency. */
  amount: bigint | null;
}) => Promise<Result<DefaultSplitView>>;

export type DefaultSplitDeps = BudgetingDeps & { readonly categories: BudgetCategories };

/**
 * HU-E6-08 ResolveDefaultSplit, the public query behind GET …/default-split: any member previews the default split
 * of an expense in a live category of the space (archived ones included), and of an amount when given. A preview
 * records nothing, so it is space.read and archived spaces answer it too.
 */
export const createResolveDefaultSplit =
  (deps: DefaultSplitDeps): ResolveDefaultSplit =>
  async (input) => {
    const reader = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!reader.ok) return reader;
    const space = reader.value;
    // P6: any id that is not a live category of this space, unknown ones included, answers the same.
    const categories = await deps.categories.list(space.spaceId);
    if (!categories.some((c) => c.id === input.categoryId)) return err(domainError("CategoryNotInSpace"));
    const split = await defaultSplitOf(deps, {
      spaceId: space.spaceId,
      currency: space.currency,
      categoryId: input.categoryId,
      date: input.date,
    });
    let shares: { memberId: string; amount: bigint }[] | null = null;
    if (input.amount !== null) {
      const total = Money.ofMinor(input.amount, space.currency);
      if (!total.ok) return total;
      const parts = total.value.allocate(split.weights.map((w) => w.weight));
      if (!parts.ok) return parts;
      shares = split.weights.map((w, index) => ({ memberId: w.memberId, amount: parts.value[index]!.minor }));
    }
    return ok({
      method: split.method,
      availableMethods: SPLIT_METHODS.filter((m) => m !== "BY_ALLOCATION" || split.method === "BY_ALLOCATION"),
      lineId: split.lineId,
      currency: space.currency,
      shares,
    });
  };
```

Append to `src/modules/budgeting/application/index.ts`:

```ts
export {
  createResolveDefaultSplit,
  defaultSplitOf,
  SPLIT_METHODS,
  type DefaultSplit,
  type DefaultSplitDeps,
  type DefaultSplitView,
  type ExpenseToSplit,
  type ResolveDefaultSplit,
  type SplitMethodName,
} from "./default-split";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/budgeting`
Expected: PASS. Mutation check: temporarily drop `|| plan.status !== "ACTIVE"` — the DRAFT and CLOSED cases fail with `BY_ALLOCATION`; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/application/default-split.ts src/modules/budgeting/application/default-split.test.ts src/modules/budgeting/application/index.ts
git commit -m "feat(budgeting): resolve the default split of an expense from the active plan's allocation (Refs #54)"
```

---

### Task 15a: HTTP — preview the default split

Implements HU-E6-08's endpoint (issue #54): `GET /api/v1/spaces/{spaceId}/default-split?categoryId=<id>&date=<date>&amount=<minor>`. Pins Review Focus 5 (another space's category, malformed dates and amounts, an archived space).

Decisions:
- `categoryId` and `date` are required; `amount` (positive minor units of the space currency, digits only) is optional, and without it `shares` is null (the web form loads the default before an amount is typed, HU-E9-06). The answer is `{ method, availableMethods, lineId, shares }`, inline in the operation (no component; money references `MoneyOutput`).
- A date outside the kernel's range is `422 InvalidDate`; a malformed one or a non-positive amount is `422 ValidationFailed`.

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/default-split/route.ts`, `tests/acceptance/budget-default-split.test.ts`
- Modify: `src/modules/budgeting/contracts/budgeting.contract.ts`, `src/composition/container.ts`, `tests/support/budgeting.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E6-budgeting.md`

**Interfaces:**
- Consumes: `createResolveDefaultSplit`, `ResolveDefaultSplit`, `DefaultSplitView` (Task 14); `activatePlan` (Task 5a); `referencePlan`, `putCategories`, `patchLine`, `putAllocation`; `categoryWithKey`, `cop`.
- Produces: `DefaultSplitQuerySchema`, `DefaultSplitSchema`, `defaultSplitDto(view: DefaultSplitView)`; `Container.budgeting.resolveDefaultSplit`; `getDefaultSplit(user: TestUser, spaceId: string, query: { categoryId: string; date: string; amount?: string }): Promise<Response>` in `tests/support/budgeting.ts`; `activeReference(options?)` in `tests/acceptance/budget-default-split.test.ts`.

- [ ] **Step 1: Write the failing tests**

In `tests/support/budgeting.ts`:

1. Insert after the line `import { POST as closeRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/close/route";`:

```ts
import { GET as defaultSplitRoute } from "@/app/api/v1/spaces/[spaceId]/default-split/route";
```

2. Append to the end of the file:

```ts

/** HU-E6-08: the default split `user` would get for an expense in `query.categoryId` on `query.date`. */
export const getDefaultSplit = (
  user: TestUser,
  spaceId: string,
  query: { categoryId: string; date: string; amount?: string },
) => {
  const search = new URLSearchParams(
    Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return call(defaultSplitRoute, "GET", `/api/v1/spaces/${spaceId}/default-split?${search.toString()}`, {
    user,
    params: { spaceId },
  });
};
```

`tests/acceptance/budget-default-split.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp } from "../support/app";
import {
  activatePlan,
  getDefaultSplit,
  patchLine,
  putAllocation,
  putCategories,
  referencePlan,
} from "../support/budgeting";
import { categoryWithKey, cop } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/**
 * HU-E6-08 Background: the reference plan for 2026-11 in Household with Groceries mapped to Home (PROPORTIONAL,
 * Ana 40 % and Juan 60 %) and Free the catch-all line, NONE when `freeIsGroupMoney`; ACTIVE unless `draft`.
 * "Outings" is the seeded entertainment category, mapped to no line.
 */
const activeReference = async (options: { draft?: boolean; freeIsGroupMoney?: boolean } = {}) => {
  const ref = await referencePlan();
  const { h, planId, lineId } = ref;
  expect((await putCategories(h.ana, h.spaceId, planId, lineId("Home"), [h.groceries])).status).toBe(200);
  expect((await patchLine(h.ana, h.spaceId, planId, lineId("Free"), { isCatchAll: true })).status).toBe(200);
  if (options.freeIsGroupMoney) {
    expect((await putAllocation(h.ana, h.spaceId, planId, lineId("Free"), { rule: "NONE" })).status).toBe(200);
  }
  if (!options.draft) expect((await activatePlan(h.ana, h.spaceId, planId)).status).toBe(200);
  return { ...ref, outings: await categoryWithKey(h.ana, "entertainment") };
};

describe("previewing the default split (HU-E6-08)", () => {
  it("defaults Groceries to BY_ALLOCATION by Home: 800,000 and 1,200,000 COP of 2,000,000 (golden)", async () => {
    const { h, lineId } = await activeReference();
    const response = await getDefaultSplit(h.juan, h.spaceId, {
      categoryId: h.groceries,
      date: "2026-11-08",
      amount: "200000000",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      method: "BY_ALLOCATION",
      availableMethods: ["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"],
      lineId: lineId("Home"),
      shares: [
        { memberId: h.ana.memberId, amount: cop(800_000) },
        { memberId: h.juan.memberId, amount: cop(1_200_000) },
      ],
    });
  });

  it("defaults an unmapped Outings expense to EQUAL through the NONE catch-all Free, without BY_ALLOCATION", async () => {
    const { h, lineId, outings } = await activeReference({ freeIsGroupMoney: true });
    const response = await getDefaultSplit(h.ana, h.spaceId, {
      categoryId: outings,
      date: "2026-11-12",
      amount: "5000000",
    });
    expect(await response.json()).toEqual({
      method: "EQUAL",
      availableMethods: ["EQUAL", "PERCENT", "EXACT", "SHARES"],
      lineId: lineId("Free"),
      shares: [
        { memberId: h.ana.memberId, amount: cop(25_000) },
        { memberId: h.juan.memberId, amount: cop(25_000) },
      ],
    });
  });

  it("defaults to EQUAL while the plan is a DRAFT, and previews no shares without an amount", async () => {
    const { h } = await activeReference({ draft: true });
    const response = await getDefaultSplit(h.ana, h.spaceId, { categoryId: h.groceries, date: "2026-11-08" });
    expect(await response.json()).toMatchObject({ method: "EQUAL", lineId: null, shares: null });
  });

  it("refuses other spaces' categories, malformed dates and amounts, and hides the space from non-members", async () => {
    const { h } = await activeReference({ draft: true });
    const marta = await registerUser("Marta");
    const personal = await categoryWithKey(h.ana.personal, "groceries");
    const ask = (user: typeof h.ana | typeof marta, query: { categoryId: string; date: string; amount?: string }) =>
      getDefaultSplit(user, h.spaceId, query);
    expect(await problemOf(await ask(h.ana, { categoryId: personal, date: "2026-11-08" }))).toEqual([
      422,
      "CategoryNotInSpace",
    ]);
    expect(await problemOf(await ask(h.ana, { categoryId: h.groceries, date: "not-a-date" }))).toEqual([
      422,
      "ValidationFailed",
    ]);
    expect(await problemOf(await ask(h.ana, { categoryId: h.groceries, date: "1899-12-31" }))).toEqual([
      422,
      "InvalidDate",
    ]);
    expect(await problemOf(await ask(h.ana, { categoryId: h.groceries, date: "2026-11-08", amount: "0" }))).toEqual(
      [422, "ValidationFailed"],
    );
    expect(await problemOf(await ask(marta, { categoryId: h.groceries, date: "2026-11-08" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
  });

  it("previews in an archived space too, which only reads (HU-E1-09)", async () => {
    const { h } = await activeReference({ draft: true });
    const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    expect(archived.status).toBe(204);
    const response = await getDefaultSplit(h.juan, h.spaceId, { categoryId: h.groceries, date: "2026-11-08" });
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/budget-default-split.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/default-split/route"`.

- [ ] **Step 3: Implement**

In `src/modules/budgeting/contracts/budgeting.contract.ts`:

1. Insert before the line `  type LineChanges,`:

```ts
  type DefaultSplitView,
```

2. Insert before the line `const lineDto = (figure: LineFigure, currency: string): z.infer<typeof BudgetLineSchema> => {`:

```ts
/** HU-E6-08: the expense whose default split is previewed; `amount` in minor units of the space currency. */
export const DefaultSplitQuerySchema = z.object({
  categoryId: Id,
  date: z.iso.date(),
  amount: z
    .string()
    .regex(/^[1-9]\d{0,17}$/, { error: "A positive amount in minor units, digits only" })
    .optional(),
});

/** HU-E6-08: the default method, what a member may pick instead, the line it follows and the preview of the amount. */
export const DefaultSplitSchema = z.object({
  method: z.enum(["BY_ALLOCATION", "EQUAL"]),
  /** BY_ALLOCATION is listed only when it is the default; a client gets it by sending no split. */
  availableMethods: z.array(z.enum(["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"])),
  /** The line of the ACTIVE plan covering the date that the category consumes; null without one. */
  lineId: z.string().nullable(),
  /** The amount shared by the default, in join order; null without an amount. */
  shares: z.array(z.object({ memberId: z.string(), amount: MoneySchema })).nullable(),
});

export const defaultSplitDto = (view: DefaultSplitView): z.infer<typeof DefaultSplitSchema> => ({
  method: view.method,
  availableMethods: [...view.availableMethods],
  lineId: view.lineId,
  shares:
    view.shares === null
      ? null
      : view.shares.map((s) => ({ memberId: s.memberId, amount: moneyOf(s.amount, view.currency) })),
});

```

3. Insert before the last line of the file (`};`):

```ts
  "/api/v1/spaces/{spaceId}/default-split": {
    get: {
      operationId: "resolveDefaultSplit",
      summary:
        "The default split of an expense in a category on a date: BY_ALLOCATION by its line in the ACTIVE plan, else EQUAL",
      ...securedByUser,
      requestParams: { path: SpacePath, query: DefaultSplitQuerySchema },
      responses: {
        "200": {
          description: "The default method, the methods a member may pick and the preview of the amount",
          content: jsonContent(DefaultSplitSchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "404": "SpaceNotFound",
          "422": "ValidationFailed, InvalidDate, CategoryNotInSpace",
        }),
      },
    },
  },
```

`src/app/api/v1/spaces/[spaceId]/default-split/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { DefaultSplitQuerySchema, defaultSplitDto } from "@/modules/budgeting/contracts/budgeting.contract";
import { localDate, ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: DefaultSplitQuerySchema,
  handler: async ({ user, params, query }) => {
    const date = localDate(query.date);
    if (!date.ok) return date;
    const result = await getContainer().budgeting.resolveDefaultSplit({
      spaceId: params.spaceId!,
      userId: user!.id,
      categoryId: query.categoryId,
      date: date.value,
      amount: query.amount === undefined ? null : BigInt(query.amount),
    });
    return result.ok ? ok({ status: 200, body: defaultSplitDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert before the line `  type CreateBudgetPlan,`:

```ts
  createResolveDefaultSplit,
  type ResolveDefaultSplit,
```

2. Insert after the line `    readonly closePlan: CloseBudgetPlan;`:

```ts
    readonly resolveDefaultSplit: ResolveDefaultSplit;
```

3. Insert after the line `      closePlan: createCloseBudgetPlan(budgetingDeps),`:

```ts
      resolveDefaultSplit: createResolveDefaultSplit(budgetingDeps),
```

In `docs/backlog/E6-budgeting.md`, insert after the line `- EQUAL is the default when the resolved line has rule `NONE`, when there is no line, or when the plan is not `ACTIVE` (spec 5.3).`:

```markdown
- `GET …/default-split` is `space.read` (any member; archived spaces answer too) and takes `categoryId` and `date` (required) and `amount` (optional, positive minor units of the space currency). It answers `{ method, availableMethods, lineId, shares }`: `shares` is null without an amount; `availableMethods` lists `BY_ALLOCATION` only when it is the default, because a client gets it by sending no split (it is never requested explicitly). The weights are the line's assigned amounts for the current members, positive ones only (a member without capacity or without a FIXED amount takes no share); EQUAL weighs every current member alike, and so does an allocation that does not hold. Errors: `CategoryNotInSpace` (422: any id that is not a live category of the space; archived categories still resolve), `InvalidDate` (422), `ValidationFailed` (422), `SpaceNotFound` (404).
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `GET /api/v1/spaces/{spaceId}/default-split` with its three query parameters and inline response (about 160 lines, money as `MoneyOutput`); components are unchanged.
Then run: `pnpm exec vitest run --project acceptance tests/acceptance/budget-default-split.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/v1/spaces/[spaceId]/default-split/route.ts" src/modules/budgeting/contracts/budgeting.contract.ts src/composition/container.ts openapi/openapi.snapshot.json docs/backlog/E6-budgeting.md tests/support/budgeting.ts tests/acceptance/budget-default-split.test.ts
git commit -m "feat(budgeting): preview an expense's default split over HTTP (Refs #54)"
```

---

### Task 15b: HTTP — expenses default to their line's allocation

Implements HU-E6-08 end to end (issue #54; HU-E4-07, issue #36, closed in M2, is not reopened): the composition root binds the ledger's `DefaultSplitSource` to budgeting's `defaultSplitOf`, so `POST …/expenses` without a `split` records `BY_ALLOCATION` shares when an ACTIVE plan allocates the line. Pins the @critical golden scenario with balances (D4, HU-E5-01).

Decisions:
- The binding answers the weights only for BY_ALLOCATION and null for EQUAL, so the ledger keeps its own EQUAL among every current member. It reads with the ledger's transaction (the same `DrizzleTransactionManager`), after the guard's `FOR SHARE` (Task 13).
- Shares are snapshots (spec 5.2): reallocating the line later changes no recorded share.
- The ledger contract does not change: `SplitBodySchema` keeps its four methods; the expense body's documentation names the new default.

**Files:**
- Modify: `src/composition/container.ts`, `src/modules/ledger/contracts/ledger.contract.ts`, `docs/backlog/E6-budgeting.md`
- Test: `tests/acceptance/budget-default-split.test.ts`

**Interfaces:**
- Consumes: `defaultSplitOf` (Task 14); `DefaultSplitSource` (Task 13); `activeReference` (Task 15a); `copyPlan` (Task 9b); `balancesOf`, `post`, `cop`, `HouseholdMember`, `TransactionDto` (`tests/support/ledger.ts`); the expense and transaction routes.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing tests**

In `tests/acceptance/budget-default-split.test.ts`:

1. Replace the line `import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";` with:

```ts
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { GET as getTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
```

2. Replace the block from the line `import {` that starts the `../support/budgeting` import through the line `} from "../support/budgeting";` with:

```ts
import {
  activatePlan,
  copyPlan,
  getDefaultSplit,
  lineNamed,
  patchLine,
  planOf,
  putAllocation,
  putCategories,
  referencePlan,
} from "../support/budgeting";
```

3. Replace the line `import { categoryWithKey, cop } from "../support/ledger";` with:

```ts
import {
  balancesOf,
  categoryWithKey,
  cop,
  post,
  type HouseholdMember,
  type TransactionDto,
} from "../support/ledger";
```

4. Append to the end of the file:

```ts

/** `payer` pays `pesos` on `date` in `categoryId` from their own account, with `split` when given. */
const pays = async (
  payer: HouseholdMember,
  categoryId: string,
  pesos: number,
  date: string,
  split?: unknown,
): Promise<TransactionDto> => {
  const response = await post(recordExpense, payer, "expenses", {
    description: "Market",
    date,
    categoryId,
    amount: cop(pesos),
    accountId: payer.account,
    ...(split === undefined ? {} : { split }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as TransactionDto;
};
const sharesOf = (tx: TransactionDto) => tx.shares.map((s) => [s.memberId, s.amount, s.splitMethod]);

describe("expenses default to their line's allocation (HU-E6-08, D4)", () => {
  it("splits Ana's 2,000,000 COP Groceries expense 800,000 / 1,200,000 BY_ALLOCATION: Juan owes Ana 1,200,000 COP (@critical, golden)", async () => {
    const { h } = await activeReference();
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
    ]);
    const tx = await pays(h.ana, h.groceries, 2_000_000, "2026-11-08");
    expect(sharesOf(tx)).toEqual([
      [h.ana.memberId, cop(800_000), "BY_ALLOCATION"],
      [h.juan.memberId, cop(1_200_000), "BY_ALLOCATION"],
    ]);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(1_200_000)],
      [h.juan.memberId, cop(-1_200_000)],
    ]);
  });

  it("keeps the split a member chooses: EQUAL gives 1,000,000 COP each", async () => {
    const { h } = await activeReference();
    const equal = { method: "EQUAL", participants: [{ memberId: h.ana.memberId }, { memberId: h.juan.memberId }] };
    expect(sharesOf(await pays(h.ana, h.groceries, 2_000_000, "2026-11-08", equal))).toEqual([
      [h.ana.memberId, cop(1_000_000), "EQUAL"],
      [h.juan.memberId, cop(1_000_000), "EQUAL"],
    ]);
  });

  it("splits by fixed amounts: Home FIXED 490,000 / 980,000 COP shares Juan's 300,000 COP as 100,000 / 200,000", async () => {
    const { h, planId, lineId } = await activeReference();
    const fixed = {
      rule: "FIXED",
      members: [
        { memberId: h.ana.memberId, amount: cop(490_000) },
        { memberId: h.juan.memberId, amount: cop(980_000) },
      ],
    };
    expect((await putAllocation(h.ana, h.spaceId, planId, lineId("Home"), fixed)).status).toBe(200);
    expect(sharesOf(await pays(h.juan, h.groceries, 300_000, "2026-11-10"))).toEqual([
      [h.ana.memberId, cop(100_000), "BY_ALLOCATION"],
      [h.juan.memberId, cop(200_000), "BY_ALLOCATION"],
    ]);
  });

  it("keeps recorded shares as a snapshot when Home is allocated 50 % / 50 % afterwards", async () => {
    const { h, planId, lineId } = await activeReference();
    const tx = await pays(h.ana, h.groceries, 2_000_000, "2026-11-08");
    expect(sharesOf(tx).map((share) => share[2])).toEqual(["BY_ALLOCATION", "BY_ALLOCATION"]);
    const half = {
      rule: "PERCENT",
      members: [
        { memberId: h.ana.memberId, percent: "50" },
        { memberId: h.juan.memberId, percent: "50" },
      ],
    };
    expect((await putAllocation(h.ana, h.spaceId, planId, lineId("Home"), half)).status).toBe(200);
    const read = await call(getTransaction, "GET", `/api/v1/spaces/${h.spaceId}/transactions/${tx.id}`, {
      user: h.ana,
      params: { spaceId: h.spaceId, transactionId: tx.id },
    });
    expect(sharesOf((await read.json()) as TransactionDto)).toEqual(sharesOf(tx));
  });

  it("defaults an unmapped Outings expense to EQUAL through the NONE catch-all Free, which it consumes", async () => {
    const { h, planId, outings } = await activeReference({ freeIsGroupMoney: true });
    expect(sharesOf(await pays(h.ana, outings, 50_000, "2026-11-12"))).toEqual([
      [h.ana.memberId, cop(25_000), "EQUAL"],
      [h.juan.memberId, cop(25_000), "EQUAL"],
    ]);
    expect(lineNamed(await planOf(h.ana, h.spaceId, planId), "Free").spent).toEqual(cop(50_000));
  });

  it("defaults to EQUAL in a DRAFT plan: the 2026-12 copy does not drive splits", async () => {
    const { h } = await activeReference();
    expect((await copyPlan(h.ana, h.spaceId, "2026-12")).status).toBe(201);
    expect(sharesOf(await pays(h.ana, h.groceries, 100_000, "2026-12-05"))).toEqual([
      [h.ana.memberId, cop(50_000), "EQUAL"],
      [h.juan.memberId, cop(50_000), "EQUAL"],
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/budget-default-split.test.ts`
Expected: FAIL — the golden, FIXED and snapshot scenarios record `EQUAL` shares (the container still answers null); the EQUAL, Outings and DRAFT scenarios already pass.

- [ ] **Step 3: Implement**

In `src/composition/container.ts`:

1. Insert before the line `  type CreateBudgetPlan,`:

```ts
  defaultSplitOf,
```

2. Replace the two lines `    // HU-E6-08: EQUAL until the composition root binds budgeting's allocation weights.` and `    defaultSplits: { allocationWeights: async () => null },` with:

```ts
    // HU-E6-08, spec 5.3: an expense recorded without a split follows its line's allocation in the ACTIVE plan;
    // the ledger asks budgeting through its own port, so neither module imports the other.
    defaultSplits: {
      allocationWeights: async (expense) => {
        const split = await defaultSplitOf({ members: spaceRepository, plans: budgetPlans }, expense);
        return split.method === "BY_ALLOCATION" ? split.weights : null;
      },
    },
```

In `src/modules/ledger/contracts/ledger.contract.ts`, replace the two lines ` * sends `payments` instead. Without `split` the amount is shared EQUAL among every current member` and ` * (spec 5.3), which in a personal space is the requester alone.` with:

```ts
 * sends `payments` instead. Without `split` the amount takes the default split (spec 5.3, HU-E6-08):
 * BY_ALLOCATION when the category resolves to an allocated line of the ACTIVE plan covering the date, else
 * EQUAL among every current member, which in a personal space is the requester alone.
```

In `docs/backlog/E6-budgeting.md`, insert after the line that starts with `- `GET …/default-split` is `space.read`` (added in Task 15a):

```markdown
- `RecordExpense` asks for the default only when the request has no `split`, after checking the closed period (HU-E4-06 first); its shares store `splitMethod = BY_ALLOCATION` and are never recomputed when the plan changes. `BY_ALLOCATION` cannot be requested explicitly: the split methods a client sends stay `EQUAL`, `PERCENT`, `EXACT` and `SHARES`.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/budget-default-split.test.ts tests/acceptance/shared-expenses.test.ts tests/acceptance/balances.test.ts tests/acceptance/budget-mappings.test.ts && pnpm exec vitest run --project unit src/composition`
Expected: PASS; the OpenAPI snapshot is unchanged (a JSDoc comment is not part of the document). Mutation check: temporarily make the binding return `null` always — the golden scenario fails with `EQUAL` shares; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0; `pnpm lint:boundaries` confirms the ledger still imports nothing from budgeting.

- [ ] **Step 6: Commit**

```bash
git add src/composition/container.ts src/modules/ledger/contracts/ledger.contract.ts docs/backlog/E6-budgeting.md tests/acceptance/budget-default-split.test.ts
git commit -m "feat(budgeting): default expense splits to the active plan's allocation (Refs #54, Refs #36)"
```

---

## Self-Review

### Story coverage

| Story (issue) | Scenario or technical note | Domain / application test | PostgreSQL / HTTP test |
|---|---|---|---|
| HU-E6-06 (#52) | Copy into the next period: DRAFT, `createdFrom`, capacities, lines with planned amounts, funding, rollover modes, mappings and allocation rules (@critical) | Task 6 "clones capacities, lines, mappings and allocations …", Task 7 "creates the 2026-12 plan as a DRAFT copy of 2026-11" | Task 8 (a copy against PostgreSQL, racing a source edit), Task 9b "creates the 2026-12 plan as a DRAFT copy of 2026-11" |
| | No previous plan to copy (`NoPreviousPlan`) | Task 7 (only 2026-10 has a plan) | Task 9b |
| | Archived categories are dropped from mappings, and the copy lists them | Tasks 6, 7 | Tasks 9a (DTO), 9b (Utilities archived over HTTP) |
| | A member who left invalidates percentage allocations (Luis's 10 % of Free) | Tasks 6, 7 | Task 9b |
| | Notes: `POST …/plans` with `copyFrom: "previous"`; the response lists dropped mappings; the source is the previous period of the same policy (SEMI_MONTHLY H2 ← H1, next H1 ← H2); deep clone with new ids; former members and archived categories excluded | Task 7 (SEMI_MONTHLY, new ids, source untouched) | Tasks 9a, 9b |
| HU-E6-07 (#53) | Activate a valid plan | Tasks 1, 4 | Task 5a |
| | A plan with an invalid allocation (Free at 99 %) cannot be activated, naming Free | Tasks 1, 4 | Task 5a (`lineIds`, Luis leaves) |
| | A plan exceeding capacity (Juan at 2,000,000 COP) cannot be activated | Tasks 1, 4 | Task 5a |
| | Closed period rejects ledger changes: recording on 2026-11-15, editing the 2026-11-03 expense (@critical) | Task 3 (the guard on the period's edges) | Task 5b (also delete, moving a December expense in, 2026-11-30 and 2026-12-01), Task 8 (races) |
| | Closed plan rejects plan edits (Home to 1,500,000 COP → `PeriodClosed`) | Task 3 (every M3-A write) | Task 5b (every M3-A endpoint, nothing changes) |
| | Only an active plan can be closed (`InvalidPlanTransition`) | Tasks 1, 4 | Task 5b |
| | Notes: activate and close honour `If-Match`; DRAFT → ACTIVE → CLOSED, no reopening; the `ClosedPeriodGuard` adapter used by the ledger | Tasks 1, 3, 4 | Tasks 5a, 5b, 8 |
| HU-E6-08 (#54) | Ana pays a Home expense alone: BY_ALLOCATION 800,000 / 1,200,000 COP, Juan owes Ana 1,200,000 COP (@critical @golden) | Tasks 13 (shares), 14 (weights) | Task 15a (preview), Task 15b (recorded shares and balances) |
| | A member overrides the default split (EQUAL) | Task 13 | Task 15b |
| | A FIXED allocation splits proportionally to fixed amounts (490,000 / 980,000 → 100,000 / 200,000) | Tasks 13, 14 | Task 15b |
| | Shares are a snapshot | — (share rows are stored as recorded) | Task 15b (reallocated 50 / 50 afterwards) |
| | Lines without allocation default to EQUAL; the resolved default for Outings does not list BY_ALLOCATION; Outings counts as spent in Free | Task 14 | Tasks 15a, 15b |
| | Draft plans do not drive splits | Task 14 (DRAFT and CLOSED) | Task 15b (the 2026-12 copy) |
| | Notes: `ResolveDefaultSplit` and `GET …/default-split`; ratios = assigned amounts via `Money.allocate`; `splitMethod = BY_ALLOCATION` snapshot; EQUAL for NONE, no line or a plan not ACTIVE | Tasks 13, 14 | Tasks 15a, 15b |
| HU-E6-09 (#55) | Outline: RESET, ROLLOVER and ADJUSTED with 1,270,000 and 1,600,000 COP spent | Task 10 (domain, golden outline), Task 11 (chain on read) | Task 12 (all six rows over HTTP) |
| | No previous plan means no carry-over | Tasks 10, 11 | Task 12 |
| | Carry-over follows the copied line, not its name (Home renamed House) | Tasks 10, 11 | Task 12 |
| | Notes: `RolloverCalculator`; origin link, carry 0 without one; computed on read, recursion bounded by the plan chain; `available` and `carryOver` on each line | Tasks 10, 11 (ADJUSTED through three periods, removed origin, no extra read for RESET) | Task 12 |
| HU-E4-06 (#35, closed) | Transactions in a closed period cannot change | Task 3 (the guard) | Task 5b |

No scenario of HU-E6-06 … HU-E6-09 is left without a test. M3-C scenarios are not planned here (see Out of scope).

### Review Focus pins

| Review Focus | Pinned by |
|---|---|
| 1. Closing a plan while others write | Task 8 "refuses a line added while the plan was being closed" (red when `planForWrite` checks the pre-lock read), "makes a ledger write wait for a close in progress" and "makes a close wait for a ledger write that already checked the period" (red without `FOR SHARE`), "copies the version of its source that a write in progress commits" (red without `share` in the copy or in `covering`); Task 3 "checks the status read after the lock …" (N4 at the use case); Task 13 "refuses a closed period before reading any default" |
| 2. Dates on a period's edges and the policy's shape | Task 2 (`covering` on 2026-10-31, 11-01, 11-30, 12-01 against PostgreSQL); Task 3 (the guard on the same edges); Task 5b (2026-11-30 refused, 2026-12-01 and 2026-10-31 recorded, a December expense moved to 2026-11-20 refused); Task 7 (SEMI_MONTHLY sources, `NoPreviousPlan` with only 2026-10) |
| 3. Members who left, guests and members without capacity | Task 6 and Task 7 "leaves out Luis …" and the P10 savings tests; Task 9b (Luis leaves with 10 % of Free and with his savings line); Task 5a (Luis's 1 % flags Free on activation); Task 14 "weighs only members with a positive assigned amount …" and "once Juan left, Ana alone carries Home" |
| 4. Money that carries over, splits and rounds | Task 10 (the RolloverCalculator table and the golden outline, negative carry-overs); Task 11 (ADJUSTED through three periods); Task 13 (bigint weights, `weightNotPositive`); Task 14 (golden and FIXED ratios, Pedro alone) |
| 5. Identifiers from elsewhere and archived spaces | Task 5a (malformed and unknown plan ids, archived activation); Task 5b (archived close); Task 9b (non-member, archived copy); Task 11 (removed origin carries 0); Task 14 and Task 15a (`CategoryNotInSpace` for Ana's personal category and unknown ids, malformed dates and amounts, the archived space's preview answers 200) |

### Spec contradictions found

1. **HU-E6-07's user story** ("close it when the month is over, so that … figures freeze afterwards") **vs D7, ruling P7 and ruling P8** (figures are derived on read for the current members; a SAVINGS line counts transfers into its accounts recorded in any space). Closing freezes the plan and the space's ledger in its period (Tasks 3, 5b), but a transfer recorded in a member's personal space into a SAVINGS line's account, or a member leaving, still changes a closed plan's figures. **Ruled by the controller (P19):** accepted that closing freezes the plan and the space's own transactions, not every input of its figures; the alternative is snapshotting a closed plan's figures (a stored read model, against D7) or closing the dates of every account a SAVINGS line names (which would block a member's personal transfers by another space's close).
2. **HU-E6-06's note** ("the response lists dropped mappings") **vs ruling P9** (every plan write answers the whole plan with its `ETag`). **Ruled by the controller (P11):** accepted that a copy answers the `BudgetPlan` body like a creation, plus the optional `dropped` member present only in that answer (mappings and savings accounts by the copied line, SAVINGS lines left out by the source line), and that every line now carries `originLineId`; the alternative is a separate response component (`{ plan, dropped }`) for one branch of `POST …/plans`.
3. **HU-E6-08's note** ("returns the method, the available methods and the share preview") **vs the ledger's request contract** (a client sends `EQUAL`, `PERCENT`, `EXACT` or `SHARES`). **Ruled by the controller (P16):** accepted that `BY_ALLOCATION` is only ever a default: a client gets it by sending no `split`, `availableMethods` lists it only when it is the default, the weights are the line's positive assigned amounts for the current members, and a flagged allocation, a NONE line, no line or a plan that is not ACTIVE give EQUAL among every current member; `GET …/default-split` is `space.read`, takes an optional `amount`, and requires a live category of the space (archived ones resolve); the alternative is a fifth request method `BY_ALLOCATION` that fails when no allocated line resolves.
4. **HU-E6-09's dependency on HU-E6-07** **vs D7** (computed on read) and the scenarios (no status is given). **Ruled by the controller (P15):** accepted that the carry-over is derived on read whatever the statuses (a DRAFT copy already shows what an ACTIVE November leaves it), that the receiving line's own `rolloverMode` decides (spec 5.4 "carry-over from rolloverMode" of L), that the previous available is the origin line's `available` in the plan the line was copied from (with its own carry-over, recursively), that an origin removed from its plan carries 0, and that earlier plans are read with the space's current members; the alternative is carrying over only from CLOSED plans.
5. **Ruling P8 as amended** ("a SAVINGS line may newly name only the caller's own savings accounts") **vs HU-E6-06** ("a deep clone"; success criterion "plan in under 5 minutes"). Applying P8's caller rule to a copy would drop every co-member's account each month. **Ruled by the controller (P10):** accepted that a copy names no account anew: it keeps a source line's account while it is a SAVINGS account, not archived, in the plan currency and owned by a current registered member of the space (P8's read-time filter), lists the others in `dropped.savingsAccounts`, and leaves out a SAVINGS line left without accounts (`dropped.lines`), because a SAVINGS line needs one (`budget_lines_savings_accounts`); every account on a line was attached by its owner (P8), so the invariant "a member's savings reach the group only by their own act" holds across copies. Cost: the copy's report reveals that a current member's account stopped qualifying (archived or in another currency), without saying which. The alternative is P8's caller rule (only the copier's own accounts survive).
6. **The status convention** (`Invalid*` → 422) **vs spec 8** ("conflicts and invariant violations 409") for `InvalidPlanTransition`. **Ruled by the controller (P12):** accepted the explicit `409` (the plan's state, not the request, refuses the move), and that every transition from a wrong state answers `InvalidPlanTransition`, a CLOSED plan included, while edits of a CLOSED plan answer `PeriodClosed`.

### Assumptions

1. **Activation checks** (Tasks 1, 4, 5a). `PlanExceedsCapacity` is checked before `InvalidAllocation`, which names every flagged line in plan order through the public extension member `lineIds`; an ACTIVE plan stays editable and is not checked again (later edits may unbalance it, as M3-A's capacity edits may); closing checks only the transition. **Ruled by the controller (P13):** accepted; the alternative is re-checking every write to an ACTIVE plan, which would forbid lowering a capacity mid-month.
2. **Locks** (Tasks 2, 3, 7, 8, 13). The closed-period guard and the copy read the covering plan `FOR SHARE`, so ledger writes in a planned period and copies serialize with that plan's writes and transitions (readers share it); `RecordExpense` checks the closed period before resolving its default split, so a closed period reads no default and the default reads a plan no write can change meanwhile. A request that is both in a closed period and carries an invalid split now answers `PeriodClosed` instead of `InvalidSplit`. **Ruled by the controller (P14):** accepted; deadlock-free because no transaction holds a lock on one plan while waiting for an exclusive lock on another (share locks are compatible with each other).
3. **Lifecycle freedom** (Tasks 1, 4). Several plans of a space may be ACTIVE at once (one per period, D10), a plan may be activated before or after its period, and a plan may be closed before its period ends (then its remaining days take no transactions). **Ruled by the controller (P17):** accepted; the alternatives (one ACTIVE plan per space, closing only after the period ends) are not in the spec.
4. **No migration** (all tasks). `budget_plans.status`, `created_from_plan_id` and `budget_lines.origin_line_id` exist since `0010_budgeting`; a transition is audited by `updated_at` and the version; no `activated_at`, `closed_at` or status `CHECK` is added. **Ruled by the controller (P18):** accepted; follow-up 3 adds them if an audit trail of transitions is wanted.
5. A copy writes through M3-A's ports one line at a time (`addLine`, `mapCategories`, `setAllocation`): a handful of statements per line, inside one transaction; acceptable for a household plan (a dozen lines).
6. A copy is not checked against capacity: capacities of members who left are dropped, so Σ planned may exceed the copy's total capacity (negative unallocated), and activation refuses it until fixed.
7. The default split weighs only members with a positive assigned amount; Money.allocate can still give a 0 share to a tiny amount (one peso over 40 / 60), which `splitShares` refuses as `InvalidSplit` (`shareNotPositive`), exactly as the EQUAL default already does.
8. `RecordExpenseByCategoryKey` (direct splits, HU-E1-13) calls `RecordExpense`, so it inherits the default; a new direct space has no plan, so it stays EQUAL.
9. **Personal spaces (controller ruling, preflight N5):** `defaultSplitOf` does not tell personal spaces apart. A personal space with an ACTIVE plan whose resolved line gives its owner a positive assigned amount records an expense without a split as one `BY_ALLOCATION` share instead of `EQUAL`. Accepted: it is spec 5.3 applied uniformly, the owner still carries the whole amount, and only `splitMethod` differs. The pull request notes it.

### Follow-ups

1. Reopening a CLOSED plan (v2), with `closed_at` and `closed_by` on `budget_plans` (P18).
2. Freezing a closed plan's figures entirely (P19): snapshot its members at close, or close SAVINGS accounts' dates.
3. A `CHECK` on `budget_plans.status` values and transition audit columns (P18).
4. An explicit `BY_ALLOCATION` request method if the web form (HU-E9-06) needs to return to the default after another choice without omitting `split` (P16).
5. M3-C: recurrences resolve `BY_ALLOCATION` per occurrence through `DefaultSplitSource` and skip CLOSED periods through `ClosedPeriodGuard` (HU-E4-12, HU-E4-13).
6. The carry-over chain reads one earlier plan per non-RESET hop on every read; materialize carry-overs when measured slow (D7).
7. Copying from a template (spec 5.2 `createdFrom` "previous plan or template").
8. Move HU-E6-06 … HU-E6-09 to `Done` in `docs/backlog/README.md` when the pull request merges.

### Placeholder and consistency scan

- No "TBD", "TODO", "similar to Task N" or step without its code; every code step names its file and anchor, every test step its command and expected outcome.
- Names used across tasks match their definitions: `transitioned`, `editablePlan`, `activationCheck` (Task 1); `covering`, `PlanStatusRepository`, `setStatus` (Task 2); `planForWrite(…, accepts)`, `createClosedPeriodGuard`, `ClosedPeriods` (Task 3); `createActivateBudgetPlan`, `createCloseBudgetPlan`, `ActivateBudgetPlan`, `CloseBudgetPlan`, `PlanStatusDeps`, `PlanTransitionInput` (Task 4); `copiedParts`, `CopyInput`, `CopyDrops` (Task 6); `openedPlan`, `NewPlanInput`, `copyableSavingsAccounts`, `createCopyBudgetPlan`, `CopyBudgetPlan`, `CopyDeps`, `PlanCopy` (Task 7); `holder` (Task 8); `planCopied`, `CreatePlanBodySchema.copyFrom`, `BudgetLineSchema.originLineId`, `BudgetPlanSchema.dropped` (Task 9a); `carryOver`, `PreviousAvailable`, `LineFigure.carryOver` (Task 10); `BudgetLineSchema.carryOver` (Task 12); `AllocationSplit`, `DefaultSplitQuery`, `DefaultSplitSource`, `LedgerDeps.defaultSplits` (Task 13); `defaultSplitOf`, `ExpenseToSplit`, `DefaultSplit`, `createResolveDefaultSplit`, `ResolveDefaultSplit`, `DefaultSplitDeps`, `DefaultSplitView`, `SPLIT_METHODS`, `SplitMethodName` (Task 14); `DefaultSplitQuerySchema`, `DefaultSplitSchema`, `defaultSplitDto` (Task 15a).
- `Container.budgeting` keys: `createPlan`, `copyPlan` (9b), `getPlan`, `setCapacities`, `suggestCapacity`, `addLine`, `updateLine`, `removeLine`, `mapCategories`, `allocateLine`, `activatePlan` (5a), `closePlan` (5b), `resolveDefaultSplit` (15a); `budgetingDeps.statuses` (5a). Ledger bindings: `closedPeriods` (5b), `defaultSplits` (placeholder in 13, bound in 15b). Every route calls one of them.
- Test support: `covering`, `setStatus` on `InMemoryBudgetPlans` (Task 2); `defaultSplits` in `ledgerFixture` (Task 13); `activatePlan` (5a), `closePlan` (5b), `copyPlan`, `LineDto.originLineId`, `PlanDto.dropped` (9b), `LineDto.carryOver` (12), `getDefaultSplit` (15a) in `tests/support/budgeting.ts`.
- Error codes and statuses: `InvalidPlanTransition` (409, explicit, Task 5a), `NoPreviousPlan` (409 by default, pinned in Task 9b), `PeriodClosed` (409 by default, existing row), `InvalidAllocation` with public `lineIds` (Task 5a), `CategoryNotInSpace` (422, existing explicit row); all pinned in `problem.test.ts` and listed in the OpenAPI problem descriptions and the E6 notes.
- Migrations: none (0011 unused). OpenAPI components added: none; `BudgetPlan` (Tasks 9a, 12) and `Problem` (Task 5a) gain fields.
- Open controller proposals: P10 – P19 (none blocks execution; each task states the behaviour it implements).
