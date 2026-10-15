# M3-A Budget Plans, Capacities, Lines, Category Mappings and Allocations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start Hearth's allocated-budgets API: an OWNER or ADMIN creates a DRAFT plan for one period of the space's period policy (its boundaries stored, D10); records every member's capacity, guests included, while a registered member may record their own after a private suggestion from their previous-period income (D17); adds budget lines with a planned amount, a funding source and a rollover mode without ever planning more than the total capacity (zero-based budgeting); maps categories to lines, with at most one catch-all line and an implicit "Unbudgeted" line otherwise; and allocates each line among members proportionally to capacity, by percentage, by fixed amount or not at all. Every figure of a plan (total capacity, unallocated capacity, shares, assigned amounts, spending and availability) is derived on read (D7).

**Architecture:** A new `budgeting` module (`src/modules/budgeting/{domain,application,infrastructure,contracts}`). The domain is pure: `openPlan` (Task 1), `checkedCapacities` (Task 1), `newLine`, `reviseLine` and `checkedMapping` (Task 2), the AllocationCalculator `checkedAllocation` and `assignedAmounts` over `Money.allocate`, which now also takes bigint weights (Task 3), and `planFigures`, which derives every figure for the current members (Task 4). Use cases authorize only through the `spaces` permission matrix (new actions `plan.manage` and `capacity.setOwn`, Task 8) and reach members, categories, accounts and ledger spending only through ports that `src/composition/container.ts` binds; budgeting imports nothing but `spaces`' public API and the kernel, and no module imports budgeting, so HU-E6-08 can later make the ledger depend on it without a cycle. Every plan write goes through one helper, `planForWrite` (Task 8): authorize, find the plan, bump its version under a row lock (writes to one plan run one at a time on committed data, and a stale `If-Match` answers `412`), then read its parts; it is the single place where HU-E6-07 will add its CLOSED check. Persistence is one migration, `0010_budgeting` (five tables, Task 5), and one `DrizzleBudgetPlanRepository` with an in-memory twin that each persistence step pins against it. Nothing is deleted physically: a removed line sets `deleted_at` and ends its category mappings, a replaced mapping sets `unmapped_at`, a replaced allocation value sets `superseded_at`, capacities are edited in place. The plans' stored periods now feed `ListSpacePeriods` and the ledger's period labels (D10), and a plan locks its space's currency (D6, Task 9b).

**Tech Stack:** Node.js 24.21.0, pnpm 12.11.2, Next.js 16.4.0 (App Router route handlers), React 19.3.0, TypeScript 6.0.3 strict, Zod 4.6.5, zod-openapi 6.0.2, drizzle-orm 0.45.4 + drizzle-kit 0.31.11, pg 8.23.1, better-auth 1.7.7, Vitest 5.0.3, PostgreSQL 18.6 (Docker CLI in tests). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-hearth-design.md` (approved 2026-10-11; sections 4, 5.2 (SpaceMember, BudgetPlan, MemberCapacity, BudgetLine, Allocation), 5.3, 5.4, 7, 8 and decisions D2, D6, D7, D8, D10, D12, D13, D15, D17 bind this plan). Stories: `docs/backlog/E6-budgeting.md` (HU-E6-01 … HU-E6-05) and the dependency rows of `docs/backlog/README.md`; the HU-E3-03 note "Reference check uses ports to `ledger` (transactions) and `budgeting` (line mappings)" is closed by Task 16. Format template and precedent: `docs/superpowers/plans/2026-10-14-m2c-member-lifecycle.md`. GitHub Project: https://github.com/users/Facabore/projects/4. Baseline: `development` at `dad4b82`.

**Out of scope (later plans):** M3-B — HU-E6-06 copy a plan from the previous period (#52), HU-E6-07 activate and close a plan (#53: `ACTIVE`, `CLOSED`, `PeriodClosed`, `InvalidPlanTransition`, the ledger's `ClosedPeriodGuard`), HU-E6-08 default split by allocation (#54) and HU-E6-09 rollover modes (#55: `carryOver`). M3-C — HU-E4-11 … HU-E4-13 recurring transactions (#40, #41, #42) and HU-E5-04 balance history (#46). Also out: listing a space's plans (`GET …/plans`), per-member `contributed`, `consumed` and `gap` (HU-E7-02), the line dashboard (HU-E7-01) and the planner screens (HU-E9-08). **M3-A stays self-contained:** every plan it creates is `DRAFT` until HU-E6-07 activates it, and DRAFT plans never drive splits (spec 5.3), so recording money is unchanged; rollover modes are stored and validated, and every carry-over is 0 because no line has an origin before HU-E6-06 copies one (HU-E6-09 note "lines without an origin get carry 0").

## Global Constraints

- Node.js `24.21.0`; pnpm `12.11.2`; Next.js `16.4.0`; React `19.3.0`; TypeScript `6.0.3` with `strict: true` and `noUncheckedIndexedAccess: true`; Zod `4.6.5`; zod-openapi `6.0.2`; drizzle-orm `0.45.4`; drizzle-kit `0.31.11`; pg `8.23.1`; better-auth `1.7.7`; Vitest `5.0.3`; PostgreSQL image `postgres:18.6-alpine`. No new dependencies; `pnpm check:pinned` must keep passing.
- Money is `bigint` minor units in code and `bigint` columns in PostgreSQL (D6); over HTTP it is `{ "amount": "<minor units as string>", "currency": "<ISO 4217>" }`. COP has exponent 2 and a rounding unit of 100 minor units (`src/shared/kernel/currency.ts`, spec 5.3): 1,600,000 COP is `"160000000"` on the wire. Allocations use `Money.allocate` (largest remainder in rounding units, ties to members in join order, Σ parts = total exactly, spec 5.3). Percentages travel as strings with at most two decimals in requests (`"42"`, `"33.33"`, as HU-E4-08 does) and exactly two in responses (`"36.75"`); they are stored as basis points (42 % = 4200, HU-E6-05).
- Every money reference points to a `SpaceMember`, never to a user (D15): capacities and allocation values name member ids, so a guest holds capacity and is allocated like anyone. Figures follow the **current** members (`listCurrent`, join order): a member who left keeps their rows but drops out of totals and assignments.
- **Every delete is logical (owner directive, spec D8):** plans, lines, mappings and allocations are never removed. Removing a line sets `budget_lines.deleted_at` and ends its mappings; replacing a line's categories sets `budget_line_categories.unmapped_at`; allocating a line again sets `budget_allocations.superseded_at`; capacities are edited in place. Partial unique indexes keep names, catch-all lines and category mappings unique among current rows only. No task in this plan adds a physical delete.
- **Authorization only through the permission matrix:** every use case authorizes with `authorizeSpaceAction` or `access` + `requirePermission` from `@/modules/spaces/application` (membership first, so a non-member gets `404 SpaceNotFound`, spec 8; then the role). The new actions `plan.manage` (OWNER, ADMIN) and `capacity.setOwn` (OWNER, ADMIN, MEMBER) are added to `src/modules/spaces/domain/permissions.ts` and nowhere else; no hardcoded role lists.
- **Archived spaces only read (HU-E1-09):** `SpaceAccess` answers `409 SpaceArchived` unless the caller only reads, and only `space.read` reads, so every plan write is refused in an archived space and `GET …/plans/{planId}` and `GET …/capacity-suggestion` keep answering `200` (pinned endpoint by endpoint in Task 19).
- Repositories guard identifiers that come from requests with `isUuid` before querying `uuid` columns (malformed ids return `null`, `false` or `[]`, never a `500`). Line, member and category ids from requests are checked against lists already loaded from the plan and the space before any write uses them.
- HTTP errors are RFC 9457 `application/problem+json` with a stable `code` (the domain error name) and `requestId`; the API never returns translated text. Status mapping lives only in `src/shared/http/problem.ts` (explicit map, then `*NotFound` → 404, `Invalid*` → 422, else 409). New error codes join the backlog's catalogue (spec 8: "the backlog is the full catalogue") in the task that exposes them over HTTP, as notes of their story in `docs/backlog/E6-budgeting.md`.
- Spec 7 concurrency: `GET …/plans/{planId}` and every plan write answer `ETag: "<version>"`; every plan write accepts an optional `If-Match` and answers `412 PreconditionFailed` when it is stale. Plan endpoints create no transactions, so `Idempotency-Key` does not apply to them (spec 7 lists transactions, direct splits and recurrences).
- Hexagonal boundaries (ADR 0001): domain imports only its own domain and `src/shared/kernel`; application never imports infrastructure, contracts, HTTP, frameworks or the ORM; other modules are reached only through `src/modules/<m>/application/index.ts`; `*.schema.ts` may import other modules' `*.schema.ts`; no import cycles (`no-circular` counts type-only imports, `tsPreCompilationDeps: true`). So budgeting reaches the ledger, categories and accounts only through ports bound in `src/composition/container.ts`, and no module imports budgeting.
- Strict TDD: every behaviour starts with a failing test that is run and seen failing. Golden scenarios (the reference plan of spec section 4) run as domain unit tests and again over HTTP; acceptance tests call the route handlers in-process against real PostgreSQL.
- Code, identifiers, comments, docs and generated artifacts in English. Conventional commits referencing the story issue (`Refs #<n>`); no AI attribution or `Co-Authored-By` lines.
- Gates for every task: `pnpm exec vitest run --project unit`, `pnpm exec vitest run --project integration`, `pnpm exec vitest run --project acceptance`, `pnpm format`, `pnpm exec eslint .`, `pnpm exec tsc --noEmit`, `pnpm exec prettier --check .`, `pnpm lint:boundaries`, `pnpm db:check`.

## Review Focus

1. **Two writes to one plan at the same moment** (two lines that each fit the capacity but not together, two creations of the same period, an edit sent with an `If-Match` another write already made stale): exactly one line is added and the other answers `409 PlanExceedsCapacity`, exactly one plan is created and the other answers `409 PlanAlreadyExists`, a stale `If-Match` answers `412` and changes nothing — pinned in Task 13 (a rendezvous that makes the test fail when the version lock is removed, and two simultaneous creations against PostgreSQL), Task 6 (`add` refuses a second start date) and Tasks 11, 14a, 14b (HTTP `412`).
2. **Members who are guests, who left, or who never belonged** (a capacity and a fixed allocation for the guest Pedro, Juan leaving after "Free" was split 42 / 58, Marta's member id, a member listed twice): guests count like anyone (D15); a former member drops out of total capacity and proportional shares, and a PERCENT or FIXED line that names them is flagged `InvalidAllocation` until it is allocated again; non-members answer `422 NotASpaceMember`; duplicates `422 InvalidCapacity` or `InvalidAllocation` — pinned in Tasks 1, 3, 4, 10, 17 and 18 (HTTP, Juan leaves).
3. **Money that does not divide evenly or has nothing to follow** (100,000 COP among three equal capacities, a planned amount with a sub-peso remainder, a member without capacity first in join order, every capacity at 0, capacities reduced below the planned lines): Σ assigned equals the planned amount exactly, remainders go to the earliest-joined weighted members in rounding units, a member without weight never receives a remainder, a PROPORTIONAL line without capacity is flagged `InvalidAllocation` with no shares, and unallocated capacity goes negative instead of failing — pinned in Tasks 3, 4, 14a and 18.
4. **The period policy or the currency changing once a plan exists** (MONTHLY(1) to MONTHLY(25) after the 2026-11 plan, then a plan for "2026-12"; COP to USD): the periods list and the ledger keep the plan's stored boundaries, the new plan starts the day after the stored one ends (D10), and the currency answers `409 SpaceCurrencyLocked` (D6) — pinned in Task 8 (use case) and Task 9b (HTTP).
5. **Identifiers from elsewhere, and archived spaces** (an unknown or malformed plan or line id, another space's plan, a category of Ana's personal space, Marta's savings account, Juan's BANK account on a SAVINGS line, any plan write in an archived space): `404 BudgetPlanNotFound` or `BudgetLineNotFound` (never `500`), `422 CategoryNotInSpace`, `404 AccountNotFound` (another user's account is never revealed), `422 InvalidSavingsAccount`, and `409 SpaceArchived` for every write while both reads answer `200` — pinned in Tasks 6, 8, 9b, 14a, 16 and 19.
6. **Removing or replacing parts of a plan** (a removed line whose name and categories are reused, a category moved from one line to another, a line allocated twice, deleting a category that a plan maps or once mapped): the old rows stay with `deleted_at`, `unmapped_at` or `superseded_at`, names and categories are free again, and deleting the category answers `409 CategoryInUse` — pinned in Tasks 5, 12a, 14b, 15, 16, 17 and 18 (SQL checks).

## Execution Workflow

- Work on the long-lived branch `development`; every task is implemented there with Strict TDD. Implementers stage; the controller commits.
- **RDD before every commit** (receipt-driven development is on; check with `gentle-ai review mode status`). Each "Commit" step means:
  1. Run every source-mutating normalizer first (`pnpm format`, regenerated migrations or snapshots), then stage exactly the files of the task.
  2. Run `gentle-ai review status --cwd . --contract gentle-ai.review-integration/v2 --agent claude-code --next-transition` and follow only the returned `next_transition` (`execute` its operation, satisfy `collect` inputs, or stop on `stop` and report its reason code with its documented continuation). Medium/high-risk candidates may return a consent envelope; relay it to the owner and wait.
  3. Commit only after the provider-returned `review.validate` allows the `pre-commit` gate for that exact staged candidate; the commit must not change the reviewed bytes.
  4. If the owner disables RDD (`gentle-ai review mode disable --scope clone --cwd .`), commit under ordinary policy and report `disabled/unmanaged`.
- Code blocks in this plan are complete but not guaranteed to match Prettier's line wrapping: run `pnpm format` before the gates of every task (the gates then run `prettier --check`). Anchors in this plan name lines that Prettier leaves alone (short statements, JSDoc and `//` comments, existing lines already formatted, the last line of a file); when an anchor is a range, it is given by its first and last lines. Where a later task edits a line an earlier task wrote, the earlier task writes it in its final Prettier form (multi-line imports when they exceed 110 characters).
- Every code block the executor writes is introduced by a line naming its file path in backticks and ending with a colon. "Create" blocks are whole files; edits to existing files name a unique anchor line ("after the line …", "replace the line …", "insert before the line …", "append to the end of the file", "insert before the last line of the file").
- **Task labels:** split halves of a task carry a lower-case letter (9a, 9b, 12a, 12b, 14a, 14b); each half is its own commit and RDD pass, executed in the order 1 … 8, 9a, 9b, 10, 11, 12a, 12b, 13, 14a, 14b, 15 … 19.
- **Repository ports are separate interfaces** (`BudgetPlanRepository` in Task 6, `CapacityRepository` in Task 10, `BudgetLineRepository` in Task 12a, `CategoryMappingRepository` in Task 15, `AllocationRepository` in Task 17), each introduced with its use case, its in-memory twin methods, its PostgreSQL methods and the integration test that runs the same sequence against both and compares the outcomes, so a twin that drifts from its adapter fails a test. Class headers (`DrizzleBudgetPlanRepository implements BudgetPlanRepository`, `InMemoryBudgetPlans implements BudgetPlanRepository`) are left as Task 6 writes them; each later port is checked against both by its integration test, which passes them where the intersection type is expected (`run(plans: BudgetPlanRepository & CapacityRepository)`), and again where the composition root binds them. The other ports (`PlanSpending`, `PreviousIncome`, `SavingsAccountReader`, `BudgetCategories`) are bound in the composition root to the ledger, spaces, accounts and categories modules.
- Each task is one commit sized for review (target under ~400 changed lines, OpenAPI snapshot growth included; generated Drizzle files not counted). Measured on the M2-C snapshot, a body-less operation is about 65–90 lines and an operation with a body about 130–310; every plan write here references the `BudgetPlan` component instead of repeating it. Tasks over or near the limit, with their split points (each part green, each with its own RDD pass):
- **Measured sizes (preflight N1, controller ruling):** a dry run measured Tasks 9a (612), 9b (628), 11 (559), 14b (463) and 18 (518) above the target; they are executed as two commits each, every part green on its own: **9a** schema, DTO, percent move and their tests | component registration and snapshot; **9b** POST with the container wiring (stored periods, currency lock) and the helpers | GET; **11** PUT capacities | GET capacity-suggestion; **14b** PATCH | DELETE; **18** contract, route and the four golden rule scenarios | the guard and history scenarios. Tasks 2 (426), 6 (435), 8 (456), 14a (448) and 16 (405) stay single commits. In Task 9b, zod-openapi moves `BudgetPlan` before `MoneyOutput` and `CategoryOutput` (about 58 lines deleted and re-added, semantically unchanged).
  - **Task 9, ~820**: **9a** (~380, of which ~250 are the generated `BudgetPlan` component) the shared percent helpers, the ledger contract importing them, the `BudgetPlan` schema and DTO with their unit test, the component registration and the snapshot | **9b** (~440, of which ~130 are the generated operations) the create and read routes and paths, the container wiring (plans, stored periods, currency lock), the HTTP helpers, `budget-plans.test.ts` and the backlog notes.
  - **Task 12, ~540**: **12a** (~350) `BudgetLineRepository`, `SavingsAccountReader`, the twin and PostgreSQL methods with their integration test, the shared line checks and `AddBudgetLine` with `lines.test.ts` | **12b** (~200) `UpdateBudgetLine`, `RemoveBudgetLine` and the second `describe` block of `lines.test.ts`.
  - **Task 14, ~640**: **14a** (~370) the line body schemas, `POST …/lines`, the container wiring for all three line use cases, the problem-status rows, the `referencePlan` helper, the snapshot and `budget-lines.test.ts` | **14b** (~270) `PATCH` and `DELETE …/lines/{lineId}`, the snapshot and the second `describe` block (catch-all, edits, logical removal).
  - Every other task is under ~400 lines (largest: Task 18 ~380, Task 16 ~360, Task 8 ~350, Task 4 ~330, Task 11 ~330; Task 5 is ~300 without its generated migration).
- The generated Drizzle files are committed once, in Task 5: `drizzle/0010_budgeting.sql`, `drizzle/meta/0010_snapshot.json` and the journal entry. No later task changes a `*.schema.ts`, so `pnpm db:check` keeps reporting no drift. The OpenAPI snapshot changes in the HTTP tasks only: Task 9a (the `BudgetPlan` component; no operation, and the ledger's operations stay byte-identical), Task 9b (two operations), Tasks 11, 14a, 14b, 16 and 18 (operations only; components unchanged).
- **One concurrency test is added (Task 13).** Two `AddBudgetLine` calls race on one plan; a rendezvous in the plan-contents port holds the first writer until the second has read the plan or 2 s passed. With the version lock, the second writer waits in `lockForWrite` and then sees the first line (one `PlanExceedsCapacity`); replacing the body of `lockForWrite` with `return expectedVersion ?? 1;` lets both writers read an empty plan and both lines land, so the test fails (inferred; the margin costs 2 s only when the lock is present). The same file pins two simultaneous creations of one period against the unique index.
- When a task starts, move its story issues to **In Progress** on Project #4. When all tasks are done, open one pull request from `development` into `main`. It closes #47, #48, #49, #50 and #51 and states that #52–#55 (M3-B) and #40–#42, #46 (M3-C) stay open for the next plans. Its description also lists, as PR notes: (1) plans' stored boundaries now take precedence in `GET …/periods` and in the ledger's `?period=` labels (D10), and a space with a plan answers `409 SpaceCurrencyLocked` to a currency change (D6); (2) a category that any plan maps or once mapped can no longer be deleted (`409 CategoryInUse`, HU-E3-03 note); (3) `percent` strings and basis points moved from the ledger contract to `src/shared/http/contracts.ts` with no contract change; (4) the controller rulings P1–P9 of the Self-Review, as ruled; (5) the follow-ups in the Self-Review.
- Task-to-issue map (issues are titled with their story ID): HU-E6-01 → #47 (Tasks 1, 5, 6, 8, 9a, 9b, 13, 19), HU-E6-02 → #48 (Tasks 1, 4, 10, 11), HU-E6-03 → #49 (Tasks 2, 4, 7, 12a, 12b, 13, 14a, 14b), HU-E6-04 → #50 (Tasks 2, 4, 7, 12a, 12b, 14b, 15, 16), HU-E6-05 → #51 (Tasks 3, 4, 17, 18). Tasks 5, 9a and 19 reference every issue they serve; Task 16 also references the closed M1 story HU-E3-03 (#29) without reopening it (its note "Reference check uses ports to … `budgeting` (line mappings)" is fulfilled there).
- zod-openapi lesson from M1–M2-C: a component registered in `components.schemas` that is used in **both** a request and a response is emitted twice (`<Name>` and `<Name>Output`). This plan registers one new component, `BudgetPlan`, used in responses only; it references the existing `MoneyOutput` (its period is an inline copy of `PeriodSchema`, so `Period` keeps a single form). If a `BudgetPlanOutput` or any other new `…Output` variant appears in a snapshot diff, a request schema is reusing a response schema: fix the contract instead of accepting the snapshot.

## File Structure

```
.
├── docs/backlog/E6-budgeting.md                                    # error catalogue and rules per story (Tasks 9b, 11, 14a, 16, 18)
├── drizzle/
│   └── 0010_budgeting.sql (+ meta/0010_snapshot.json, _journal.json) # Task 5
├── openapi/openapi.snapshot.json                                    # Tasks 9a, 9b, 11, 14a, 14b, 16, 18
├── src/
│   ├── shared/kernel/money.ts                                       # allocate takes bigint weights (Task 3)
│   ├── shared/http/
│   │   ├── contracts.ts                                             # PercentSchema, basisPointsOf, percentOf (Task 9a)
│   │   └── problem.ts                                               # SavingsAccountRequired (14a), CategoryNotInSpace (16) → 422
│   ├── composition/openapi.ts                                       # BudgetPlan component (9a), budgetingPaths (9b)
│   ├── composition/container.ts                                     # Tasks 9b, 11, 14a, 16, 18
│   ├── modules/
│   │   ├── spaces/domain/permissions.ts                             # plan.manage, capacity.setOwn (Task 8)
│   │   ├── ledger/contracts/ledger.contract.ts                      # imports the shared percent helpers (Task 9a)
│   │   ├── ledger/infrastructure/drizzle-ledger-queries.ts          # expensesByCategory, transfersIntoAccounts (Task 7)
│   │   ├── categories/application/delete-category.ts                # mappings count as references (comment, Task 16)
│   │   └── budgeting/
│   │       ├── domain/plan.ts                                       # BudgetPlan, openPlan (Task 1)
│   │       ├── domain/capacity.ts                                   # checkedCapacities, totalCapacity, shareOfTotal (Task 1)
│   │       ├── domain/budget-line.ts                                # newLine, reviseLine, checkedMapping (Task 2)
│   │       ├── domain/allocation.ts                                 # checkedAllocation, assignedAmounts (Task 3)
│   │       ├── domain/plan-figures.ts                               # planFigures, lineForCategory (Task 4)
│   │       ├── application/ports.ts                                 # Tasks 6, 8, 10, 12a, 15, 17
│   │       ├── application/deps.ts                                  # BudgetingDeps (Task 8)
│   │       ├── application/{plan-view,plan-access}.ts               # loadPlanView, readablePlan, managePlan, planForWrite (Task 8)
│   │       ├── application/{create-budget-plan,get-budget-plan}.ts  # Task 8
│   │       ├── application/{set-member-capacities,suggest-capacity}.ts # Task 10
│   │       ├── application/line-checks.ts                           # inSpaceCurrency, lineOf, lineContext, usableSavingsAccounts (Task 12a)
│   │       ├── application/add-budget-line.ts                       # Task 12a
│   │       ├── application/{update-budget-line,remove-budget-line}.ts # Task 12b
│   │       ├── application/map-categories-to-line.ts                # Task 15
│   │       ├── application/allocate-budget-line.ts                  # Task 17
│   │       ├── application/index.ts                                 # Tasks 6, 8, 10, 12a, 12b, 15, 17
│   │       ├── infrastructure/budgeting.schema.ts                   # Task 5 (+ budgeting-schema.int.test.ts)
│   │       ├── infrastructure/drizzle-budget-plan-repository.ts     # Tasks 6, 10, 12a, 15, 17 (+ its .int.test.ts)
│   │       ├── infrastructure/concurrent-plan-writes.int.test.ts    # Task 13
│   │       └── contracts/budgeting.contract.ts                      # Tasks 9a, 9b, 11, 14a, 14b, 16, 18 (+ .test.ts, 9a)
│   └── app/api/v1/spaces/[spaceId]/plans/
│       ├── route.ts                                                 # POST (Task 9b)
│       └── [planId]/
│           ├── route.ts                                             # GET (Task 9b)
│           ├── capacities/route.ts                                  # PUT (Task 11)
│           ├── capacity-suggestion/route.ts                         # GET (Task 11)
│           └── lines/
│               ├── route.ts                                         # POST (Task 14a)
│               └── [lineId]/
│                   ├── route.ts                                     # PATCH, DELETE (Task 14b)
│                   ├── categories/route.ts                          # PUT (Task 16)
│                   └── allocation/route.ts                          # PUT (Task 18)
└── tests/
    ├── support/
    │   ├── budget-fixtures.ts         # aLine, referenceLines (Task 2)
    │   ├── in-memory-budgeting.ts     # InMemoryBudgetPlans (Task 6; 10, 12a, 15, 17)
    │   ├── budgeting-world.ts         # FixedSpending, budgetingWorld (Task 8), fixedIncome (10), savings accounts (12a), categories (15)
    │   └── budgeting.ts               # HTTP helpers (Task 9b; 11, 14a, 14b, 16, 18)
    └── acceptance/
        ├── budget-plans.test.ts       # Task 9b
        ├── budget-capacities.test.ts  # Task 11
        ├── budget-lines.test.ts       # Tasks 14a, 14b
        ├── budget-mappings.test.ts    # Task 16
        ├── budget-allocations.test.ts # Task 18
        └── budget-archived.test.ts    # Task 19
```

Test layout follows M0–M2-C: unit tests next to the code as `*.test.ts` (no database), integration tests as `*.int.test.ts` (real PostgreSQL via `testDatabase()`), acceptance tests in `tests/acceptance/` calling the exported route handlers in-process. Shared test doubles live in `tests/support/` so production folders hold no test code. Run a single file with `pnpm exec vitest run --project <unit|integration|acceptance> <path>`. Integration and acceptance projects start a disposable PostgreSQL container through the Docker CLI (`tests/support/postgres-global-setup.ts`) and apply every migration in `drizzle/`, so Docker must be running.

### How plan actions are authorized

Two matrix actions are added in Task 8; reads reuse `space.read`.

| Use case | Matrix action | Roles | Other rules (where they live) |
|---|---|---|---|
| `CreateBudgetPlan` | `plan.manage` (new) | OWNER, ADMIN | the label resolves with the space policy around stored plans (`periodByLabel`); one plan per period (`openPlan`, `budget_plans_space_start_uq`) |
| `GetBudgetPlan` | `space.read` | every role | archived spaces read |
| `SetMemberCapacities` | `capacity.setOwn` (new) when every listed capacity is the caller's own, otherwise `plan.manage` | own: OWNER, ADMIN, MEMBER; anyone's: OWNER, ADMIN | current members only, never negative, space currency (`checkedCapacities`) |
| `SuggestCapacity` | `space.read` | every role | only the caller's own member and personal-space income (D17); nothing is saved |
| `AddBudgetLine`, `UpdateBudgetLine`, `RemoveBudgetLine` | `plan.manage` | OWNER, ADMIN | `newLine`, `reviseLine` (capacity, names, catch-all, savings), `usableSavingsAccounts` |
| `MapCategoriesToLine` | `plan.manage` | OWNER, ADMIN | `checkedMapping` |
| `AllocateBudgetLine` | `plan.manage` | OWNER, ADMIN | `checkedAllocation` |

### Every path that touches a plan rule

| Rule | Paths | Where it is enforced |
|---|---|---|
| Σ planned ≤ total capacity when a line is added or increased (spec 5.2) | `AddBudgetLine`, `UpdateBudgetLine` (only when the planned amount grows); `SetMemberCapacities` and `RemoveBudgetLine` never refuse (unallocated may go negative, HU-E6-02); HU-E6-07 will refuse to activate such a plan | `checked` in `domain/budget-line.ts` (Task 2) over the parts read after the version lock (Task 8), raced in Task 13 |
| One catch-all line per plan; SAVINGS lines are never catch-all | `AddBudgetLine`, `UpdateBudgetLine` | `checked` (Task 2); `budget_lines_catch_all_uq`, `budget_lines_savings_catch_all` (Task 5) |
| A category maps to at most one current line per plan; archived categories are not newly mapped; SAVINGS lines take no categories | `MapCategoriesToLine`; `RemoveBudgetLine` ends the line's mappings; `UpdateBudgetLine` refuses SAVINGS while categories are mapped | `checkedMapping` (Task 2), `deleteLine` (Task 12a), `budget_line_categories_current_uq` (Task 5) |
| SAVINGS lines name ≥ 1 savings account, other lines none; an account backs one line per plan; newly named accounts are SAVINGS, not archived, owned by the caller and in the space currency (P8, amended) | `AddBudgetLine`, `UpdateBudgetLine` | `checked` (Task 2), `usableSavingsAccounts` (Task 12a), `budget_lines_savings_accounts` (Task 5) |
| Allocation values add up and name current members | `AllocateBudgetLine` (refuses); every read (`planFigures` flags a line whose values no longer add up) | `checkedAllocation`, `assignedAmounts` (Task 3), `planFigures` (Task 4) |
| Changing the planned amount of a FIXED line leaves its values stale (N6): the change is accepted and the line is flagged, not refused | `UpdateBudgetLine` (accepts it); every read flags the line `InvalidAllocation` (`fixedNotPlanned`) until `AllocateBudgetLine` sets the values again; HU-E6-07 will refuse to activate a plan with a flagged line | `assignedAmounts` (Task 3), `planFigures` (Task 4); pinned by `allocations.test.ts` and `budget-allocations.test.ts` |
| A SAVINGS line's spending counts transfers only into accounts whose owner is a current registered member of the plan's space (P8, amended): an owner who left stops counting, one who rejoins counts again, for every reader | every read of a plan and every write's answer, since each answers the whole plan | `accountsOfMembers` in `loadPlanView` over `members.listCurrent` and the `SavingsAccountReader`, evaluated at read time over the whole period; pinned by `plans.test.ts`, `lines.test.ts` and `budget-lines.test.ts` |
| Every write bumps the version under a row lock and honours `If-Match` | `SetMemberCapacities`, `AddBudgetLine`, `UpdateBudgetLine`, `RemoveBudgetLine`, `MapCategoriesToLine`, `AllocateBudgetLine` | `planForWrite` (Task 8) over `lockForWrite` (Task 6); HU-E6-07 adds its CLOSED check here |
| Archived spaces only read | every write above and `CreateBudgetPlan` | `SpaceAccess` without `readOnly` (`planForWrite`, `authorizeSpaceAction("plan.manage")`); reads opt in through `space.read` (`readablePlan`); pinned in Task 19 |
| Nothing is deleted physically (D8) | `RemoveBudgetLine` (`deleted_at`), `MapCategoriesToLine` (`unmapped_at`), `AllocateBudgetLine` (`superseded_at`), `SetMemberCapacities` (in place); `DeleteCategory` counts every mapping ever made | Tasks 5, 10, 12a, 15, 16, 17 |
| Stored plan boundaries win over the policy (D10); a plan locks the currency (D6) | `CreateBudgetPlan`, `ListSpacePeriods`, `ListTransactions` (`storedPeriods`), `UpdateSpaceSettings` (`hasMoneyRecords`) | `periodByLabel` (kernel), the container bindings of Task 9b |

---

### Task 1: Budgeting domain — plans and member capacities

Implements the pure rules of HU-E6-01 (issue #47) and HU-E6-02 (issue #48). Pins Review Focus 2 (guests, former members, non-members) at the domain level.

Decisions:
- A plan is created only from a period that `periodByLabel` (kernel, HU-E4-04) resolved with the space policy and the stored plan periods. That function returns the stored period itself for a label that already has a plan, so `openPlan` answers `PlanAlreadyExists` exactly when the resolved period starts where a stored one starts; a label whose natural period overlaps a stored plan is already clipped to the gap after it (spec 5.2, D10).
- `version` starts at 1 and is the plan's ETag; `createdFrom` stays null until HU-E6-06 copies plans.
- `checkedCapacities` validates a request's entries only; members not listed keep their capacity (ruling P5). Per entry: a current member (`NotASpaceMember`), the space currency (`CurrencyMismatch`), never negative (`InvalidCapacity`); a member listed twice is ambiguous (`InvalidCapacity`, reason `duplicateMember`).
- `totalCapacity` sums the current members only (ruling P7): a member who left keeps their row (D8) but no longer counts. A member without a row counts as 0 (HU-E6-02 note).
- Shares are basis points rounded half up (`shareOfTotal`), so "40.00 %" is 4000 and "36.75 %" is 3675; there is no share without capacity.

**Files:**
- Create: `src/modules/budgeting/domain/plan.ts`, `src/modules/budgeting/domain/capacity.ts`
- Test: `src/modules/budgeting/domain/plan.test.ts`, `src/modules/budgeting/domain/capacity.test.ts`

**Interfaces:**
- Consumes: `periodByLabel`, `Period`, `StoredPeriod`, `Money`, `Result`, `domainError`, `Id` (`src/shared/kernel`); `codeOf`, `money`, `unwrap` (`tests/support/fakes.ts`).
- Produces:
  - `type BudgetPlanId = Id<"BudgetPlan">`; `PLAN_STATUSES = ["DRAFT", "ACTIVE", "CLOSED"] as const`; `type PlanStatus`
  - `interface BudgetPlan { id: BudgetPlanId; spaceId: string; period: Period; status: PlanStatus; createdFrom: BudgetPlanId | null; version: number; createdBy: string; createdAt: Date }`
  - `openPlan(input: { id: BudgetPlanId; spaceId: string; period: Period; stored: readonly StoredPeriod[]; createdBy: string; now: Date }): Result<BudgetPlan>` — `PlanAlreadyExists`
  - `interface MemberCapacity { memberId: string; amount: bigint }`
  - `checkedCapacities(entries: readonly { memberId: string; amount: Money }[], memberIds: readonly string[], currency: string): Result<MemberCapacity[]>` — `InvalidCapacity`, `NotASpaceMember`, `CurrencyMismatch`
  - `capacityOf(capacities: readonly MemberCapacity[], memberId: string): bigint`; `totalCapacity(capacities: readonly MemberCapacity[], memberIds: readonly string[]): bigint`; `shareOfTotal(part: bigint, total: bigint): number | null`

- [ ] **Step 1: Write the failing tests**

`src/modules/budgeting/domain/plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { periodByLabel, type Period, type PeriodPolicy, type StoredPeriod } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { openPlan, type BudgetPlanId } from "./plan";

const now = new Date("2026-10-14T12:00:00Z");
const MONTHLY_1: PeriodPolicy = { kind: "MONTHLY", day: 1 };
const SEMI_1_16: PeriodPolicy = { kind: "SEMI_MONTHLY", day1: 1, day2: 16 };
const open = (period: Period, stored: readonly StoredPeriod[] = []) =>
  openPlan({
    id: "plan-1" as BudgetPlanId,
    spaceId: "space-household",
    period,
    stored,
    createdBy: "u-ana",
    now,
  });

describe("openPlan (HU-E6-01)", () => {
  it("opens a DRAFT plan for 2026-11 that runs from 2026-11-01 to 2026-11-30", () => {
    const november = unwrap(periodByLabel(MONTHLY_1, [], "2026-11"));
    expect(unwrap(open(november))).toEqual({
      id: "plan-1",
      spaceId: "space-household",
      period: { label: "2026-11", start: "2026-11-01", end: "2026-11-30" },
      status: "DRAFT",
      createdFrom: null,
      version: 1,
      createdBy: "u-ana",
      createdAt: now,
    });
  });

  it("allows only one plan per period", () => {
    const november = unwrap(periodByLabel(MONTHLY_1, [], "2026-11"));
    const again = unwrap(periodByLabel(MONTHLY_1, [november], "2026-11"));
    const refused = open(again, [november]);
    expect(refused).toEqual({
      ok: false,
      error: { code: "PlanAlreadyExists", details: { label: "2026-11" } },
    });
  });

  it("gives a semi-monthly space two plans per month, 2026-11 H1 and 2026-11 H2", () => {
    const h1 = unwrap(periodByLabel(SEMI_1_16, [], "2026-11 H1"));
    const h2 = unwrap(periodByLabel(SEMI_1_16, [h1], "2026-11 H2"));
    expect([h1, h2]).toEqual([
      { label: "2026-11 H1", start: "2026-11-01", end: "2026-11-15" },
      { label: "2026-11 H2", start: "2026-11-16", end: "2026-11-30" },
    ]);
    expect(codeOf(open(h2, [h1]))).toBe("ok");
  });
});
```

`src/modules/budgeting/domain/capacity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { capacityOf, checkedCapacities, shareOfTotal, totalCapacity } from "./capacity";

const MEMBERS = ["member-ana", "member-juan", "member-pedro"];
const cop = (pesos: number) => money(BigInt(pesos) * 100n);

describe("member capacities (HU-E6-02)", () => {
  it("defines the proportional ratio Ana 40.00 % and Juan 60.00 % of 4,000,000 COP (golden)", () => {
    const capacities = unwrap(
      checkedCapacities(
        [
          { memberId: "member-ana", amount: cop(1_600_000) },
          { memberId: "member-juan", amount: cop(2_400_000) },
        ],
        MEMBERS,
        "COP",
      ),
    );
    expect(capacities).toEqual([
      { memberId: "member-ana", amount: 160_000_000n },
      { memberId: "member-juan", amount: 240_000_000n },
    ]);
    const total = totalCapacity(capacities, MEMBERS);
    expect(total).toBe(400_000_000n);
    expect([shareOfTotal(160_000_000n, total), shareOfTotal(240_000_000n, total)]).toEqual([4000, 6000]);
  });

  it("counts a member without an explicit capacity, the guest Pedro here, as 0 COP", () => {
    const capacities = [{ memberId: "member-ana", amount: 160_000_000n }];
    expect(capacityOf(capacities, "member-pedro")).toBe(0n);
    expect(totalCapacity(capacities, MEMBERS)).toBe(160_000_000n);
  });

  it("lets a guest hold capacity like anyone (D15)", () => {
    const pedro = checkedCapacities([{ memberId: "member-pedro", amount: cop(300_000) }], MEMBERS, "COP");
    expect(unwrap(pedro)).toEqual([{ memberId: "member-pedro", amount: 30_000_000n }]);
  });

  it("rejects a negative capacity", () => {
    const negative = checkedCapacities([{ memberId: "member-juan", amount: cop(-100_000) }], MEMBERS, "COP");
    expect(negative).toEqual({ ok: false, error: { code: "InvalidCapacity", details: { reason: "negative" } } });
  });

  it("rejects a capacity for Marta, who is neither a registered member nor a guest", () => {
    const marta = checkedCapacities([{ memberId: "member-marta", amount: cop(100_000) }], MEMBERS, "COP");
    expect(codeOf(marta)).toBe("NotASpaceMember");
  });

  it("rejects a member listed twice and an amount in another currency", () => {
    const twice = checkedCapacities(
      [
        { memberId: "member-ana", amount: cop(1) },
        { memberId: "member-ana", amount: cop(2) },
      ],
      MEMBERS,
      "COP",
    );
    expect(twice).toEqual({ ok: false, error: { code: "InvalidCapacity", details: { reason: "duplicateMember" } } });
    const dollars = checkedCapacities([{ memberId: "member-ana", amount: money(100n, "USD") }], MEMBERS, "COP");
    expect(codeOf(dollars)).toBe("CurrencyMismatch");
  });

  it("counts only current members: a member who left no longer adds to the total (Review Focus 2)", () => {
    const capacities = [
      { memberId: "member-ana", amount: 160_000_000n },
      { memberId: "member-luis", amount: 50_000_000n },
    ];
    expect(totalCapacity(capacities, ["member-ana"])).toBe(160_000_000n);
  });

  it("rounds shares half up to basis points, and has none without capacity", () => {
    expect(shareOfTotal(147_000_000n, 400_000_000n)).toBe(3675);
    expect(shareOfTotal(1n, 3n)).toBe(3333);
    expect(shareOfTotal(2n, 3n)).toBe(6667);
    expect(shareOfTotal(0n, 0n)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/domain`
Expected: FAIL — `Failed to resolve import "./plan"` and `Failed to resolve import "./capacity"`.

- [ ] **Step 3: Implement**

`src/modules/budgeting/domain/plan.ts`:

```ts
import { domainError, err, ok, type Id, type Period, type Result, type StoredPeriod } from "@/shared/kernel";

export type BudgetPlanId = Id<"BudgetPlan">;
export const PLAN_STATUSES = ["DRAFT", "ACTIVE", "CLOSED"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** Spec 5.2 BudgetPlan: one per period of the space's policy, its boundaries stored when it is created (D10). */
export interface BudgetPlan {
  readonly id: BudgetPlanId;
  readonly spaceId: string;
  readonly period: Period;
  /** DRAFT until HU-E6-07 activates and closes plans; DRAFT plans never drive splits (spec 5.3). */
  readonly status: PlanStatus;
  /** HU-E6-06: the plan this one was copied from; null for a plan created empty. */
  readonly createdFrom: BudgetPlanId | null;
  /** Bumped by every write to the plan or its parts; its ETag (spec 7, HU-E0-10). */
  readonly version: number;
  readonly createdBy: string;
  readonly createdAt: Date;
}

/**
 * HU-E6-01: a DRAFT plan for `period`, which `periodByLabel` resolved with the space policy around the stored
 * plan periods. That resolution returns a stored period for a label that already has a plan, so a period that
 * starts where a stored one starts already has its plan.
 */
export const openPlan = (input: {
  id: BudgetPlanId;
  spaceId: string;
  period: Period;
  stored: readonly StoredPeriod[];
  createdBy: string;
  now: Date;
}): Result<BudgetPlan> =>
  input.stored.some((s) => s.start === input.period.start)
    ? err(domainError("PlanAlreadyExists", { label: input.period.label }))
    : ok({
        id: input.id,
        spaceId: input.spaceId,
        period: input.period,
        status: "DRAFT",
        createdFrom: null,
        version: 1,
        createdBy: input.createdBy,
        createdAt: input.now,
      });
```

`src/modules/budgeting/domain/capacity.ts`:

```ts
import { domainError, err, ok, type Money, type Result } from "@/shared/kernel";

/** Spec 5.2 MemberCapacity: what a member, registered or guest (D15), puts in for the plan's period. */
export interface MemberCapacity {
  readonly memberId: string;
  /** Minor units of the space currency, never negative. */
  readonly amount: bigint;
}

/**
 * HU-E6-02: the capacities a request sets, for current members (`memberIds`), in the space currency and never
 * negative. Members it does not list keep theirs; listing a member twice is ambiguous and refused.
 */
export const checkedCapacities = (
  entries: readonly { readonly memberId: string; readonly amount: Money }[],
  memberIds: readonly string[],
  currency: string,
): Result<MemberCapacity[]> => {
  if (new Set(entries.map((e) => e.memberId)).size !== entries.length) {
    return err(domainError("InvalidCapacity", { reason: "duplicateMember" }));
  }
  const checked: MemberCapacity[] = [];
  for (const entry of entries) {
    if (!memberIds.includes(entry.memberId)) return err(domainError("NotASpaceMember"));
    if (entry.amount.currency.code !== currency) {
      return err(domainError("CurrencyMismatch", { expected: currency, actual: entry.amount.currency.code }));
    }
    if (entry.amount.minor < 0n) return err(domainError("InvalidCapacity", { reason: "negative" }));
    checked.push({ memberId: entry.memberId, amount: entry.amount.minor });
  }
  return ok(checked);
};

/** HU-E6-02: a member without an explicit capacity counts as 0. */
export const capacityOf = (capacities: readonly MemberCapacity[], memberId: string): bigint =>
  capacities.find((c) => c.memberId === memberId)?.amount ?? 0n;

/** HU-E6-02: Σ capacities of the current members; a member who left keeps their row but no longer counts. */
export const totalCapacity = (capacities: readonly MemberCapacity[], memberIds: readonly string[]): bigint =>
  memberIds.reduce((sum, memberId) => sum + capacityOf(capacities, memberId), 0n);

/** `part` in basis points of `total`, rounded half up (36.75 % = 3675); null when there is no total. */
export const shareOfTotal = (part: bigint, total: bigint): number | null =>
  total <= 0n ? null : Number((part * 20_000n + total) / (2n * total));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/domain`
Expected: PASS (11 tests). Mutation check: temporarily replace `s.start === input.period.start` with `s.label === "x"` — "allows only one plan per period" fails; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (`domain-must-be-pure` holds: both files import only `@/shared/kernel`).

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/domain/plan.ts src/modules/budgeting/domain/plan.test.ts src/modules/budgeting/domain/capacity.ts src/modules/budgeting/domain/capacity.test.ts
git commit -m "feat(budgeting): open period plans and check member capacities (Refs #47, Refs #48)"
```

---

### Task 2: Budgeting domain — budget lines, the catch-all line and category mappings

Implements the pure rules of HU-E6-03 (issue #49) and HU-E6-04 (issue #50). Pins Review Focus 6 (a removed line's name is free: siblings are the current lines only).

Decisions:
- A line validates its fields against its **context**: the plan's other current lines (`siblings`), the total capacity of the current members and how many categories are mapped to it. Order of checks: name (1–60 characters after trimming, `InvalidBudgetLineName`), planned amount (> 0, `InvalidPlannedAmount`), savings accounts (`SavingsAccountRequired` for a SAVINGS line without one; `InvalidSavingsAccount` for accounts on another line or an account listed twice), SAVINGS lines are never catch-all and take no categories (`SavingsLineNotMappable`, ruling P8), name unique ignoring case (`BudgetLineNameTaken`), one catch-all line (`CatchAllLineAlreadySet`), one SAVINGS line per account (`SavingsAccountAlreadyUsed`, ruling P8), then capacity (`PlanExceedsCapacity`).
- Spec 5.2: "Adding or editing a line that would push Σ plannedAmount above total capacity is rejected". The capacity check runs when a line is added or its planned amount grows; renaming or lowering a line of a plan that is already over capacity (after a capacity reduction, HU-E6-02) stays allowed, so the plan can be repaired.
- A new line is PROPORTIONAL (HU-E6-05 "Proportional allocation is the default") and has no origin (HU-E6-06 sets it when copying). `reviseLine` never changes the allocation rule; a line that stops being SAVINGS drops its savings accounts.
- `checkedMapping` replaces a line's category set (HU-E6-04 `PUT …/categories`). Categories the line already maps are kept as they are, even if archived since; each newly mapped one must be a live category of the space (`CategoryNotInSpace` for anything else, unknown ids included, ruling P6), not archived (`CategoryArchived`, HU-E6-04 note) and not mapped to another current line of the plan (`CategoryAlreadyMapped`). Duplicates in the request collapse.
- Test data live in `tests/support/budget-fixtures.ts` so the figures, application and integration tests share the reference lines of spec section 4.

**Files:**
- Create: `src/modules/budgeting/domain/budget-line.ts`, `tests/support/budget-fixtures.ts`
- Test: `src/modules/budgeting/domain/budget-line.test.ts`

**Interfaces:**
- Consumes: `Result`, `domainError`, `Id` (kernel); `codeOf`, `unwrap` (`tests/support/fakes.ts`).
- Produces:
  - `type BudgetLineId = Id<"BudgetLine">`; `FUNDINGS`, `ROLLOVER_MODES`, `ALLOCATION_RULES` (`as const` tuples) with `type Funding`, `type RolloverMode`, `type AllocationRule`
  - `interface BudgetLine { id: BudgetLineId; planId: string; originLineId: string | null; name: string; plannedAmount: bigint; funding: Funding; savingsAccountIds: readonly string[]; rolloverMode: RolloverMode; isCatchAll: boolean; allocationRule: AllocationRule; createdAt: Date }`
  - `interface CategoryMapping { lineId: string; categoryId: string }`
  - `interface LineFields { name: string; plannedAmount: bigint; funding: Funding; savingsAccountIds: readonly string[]; rolloverMode: RolloverMode; isCatchAll: boolean }`; `interface LineContext { siblings: readonly BudgetLine[]; totalCapacity: bigint; mappedCategories: number }`
  - `newLine(input: { id: BudgetLineId; planId: string; now: Date; fields: LineFields }, context: LineContext): Result<BudgetLine>`
  - `reviseLine(line: BudgetLine, change: Partial<LineFields>, context: LineContext): Result<BudgetLine>`
  - `checkedMapping(line: Pick<BudgetLine, "id" | "funding">, categoryIds: readonly string[], context: { categories: readonly { id: string; archived: boolean }[]; mappings: readonly CategoryMapping[] }): Result<string[]>`
  - `aLine(name: string, plannedAmount: bigint, overrides?: Partial<BudgetLine>): BudgetLine` (id `line-<name>`, plan `plan-november`); `referenceLines(): BudgetLine[]` (Rent SHARED_FUND, Home, Savings SAVINGS into `acc-savings`, Free catch-all; 4,000,000 COP) — `tests/support/budget-fixtures.ts`

- [ ] **Step 1: Write the test data and the failing tests**

`tests/support/budget-fixtures.ts`:

```ts
import type { BudgetLine, BudgetLineId } from "@/modules/budgeting/domain/budget-line";

const CREATED = new Date("2026-10-14T12:00:00Z");

/** A line of `plan-november` with the id `line-<name>`: DIRECT, RESET and PROPORTIONAL unless overridden. */
export const aLine = (name: string, plannedAmount: bigint, overrides: Partial<BudgetLine> = {}): BudgetLine => ({
  id: `line-${name.toLowerCase()}` as BudgetLineId,
  planId: "plan-november",
  originLineId: null,
  name,
  plannedAmount,
  funding: "DIRECT",
  savingsAccountIds: [],
  rolloverMode: "RESET",
  isCatchAll: false,
  allocationRule: "PROPORTIONAL",
  createdAt: CREATED,
  ...overrides,
});

/** Spec section 4: Rent (shared fund), Home, Savings (into acc-savings) and Free (catch-all), 4,000,000 COP in all. */
export const referenceLines = (): BudgetLine[] => [
  aLine("Rent", 120_000_000n, { funding: "SHARED_FUND", createdAt: new Date("2026-10-14T12:00:00Z") }),
  aLine("Home", 147_000_000n, { createdAt: new Date("2026-10-14T12:01:00Z") }),
  aLine("Savings", 60_000_000n, {
    funding: "SAVINGS",
    savingsAccountIds: ["acc-savings"],
    createdAt: new Date("2026-10-14T12:02:00Z"),
  }),
  aLine("Free", 73_000_000n, { isCatchAll: true, createdAt: new Date("2026-10-14T12:03:00Z") }),
];
```

`src/modules/budgeting/domain/budget-line.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { aLine, referenceLines } from "../../../../tests/support/budget-fixtures";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import {
  checkedMapping,
  newLine,
  reviseLine,
  type BudgetLine,
  type BudgetLineId,
  type LineContext,
  type LineFields,
} from "./budget-line";

const now = new Date("2026-10-14T12:30:00Z");
const fields = (overrides: Partial<LineFields> = {}): LineFields => ({
  name: "Home",
  plannedAmount: 147_000_000n,
  funding: "DIRECT",
  savingsAccountIds: [],
  rolloverMode: "RESET",
  isCatchAll: false,
  ...overrides,
});
// HU-E6-03 Background: capacities Ana 1,600,000 COP and Juan 2,400,000 COP.
const context = (siblings: readonly BudgetLine[] = [], overrides: Partial<LineContext> = {}): LineContext => ({
  siblings,
  totalCapacity: 400_000_000n,
  mappedCategories: 0,
  ...overrides,
});
const add = (f: LineFields, c: LineContext = context()) =>
  newLine({ id: "line-new" as BudgetLineId, planId: "plan-november", now, fields: f }, c);
const withoutFree = () => referenceLines().filter((l) => l.name !== "Free");

describe("newLine (HU-E6-03)", () => {
  it("adds Rent with its funding and rollover mode, PROPORTIONAL and without an origin", () => {
    const rent = unwrap(add(fields({ name: "  Rent ", plannedAmount: 120_000_000n, funding: "SHARED_FUND" })));
    expect(rent).toEqual({
      id: "line-new",
      planId: "plan-november",
      originLineId: null,
      name: "Rent",
      plannedAmount: 120_000_000n,
      funding: "SHARED_FUND",
      savingsAccountIds: [],
      rolloverMode: "RESET",
      isCatchAll: false,
      allocationRule: "PROPORTIONAL",
      createdAt: now,
    });
  });

  it("fills the capacity exactly with the full reference plan, and refuses one peso more", () => {
    const free = add(fields({ name: "Free", plannedAmount: 73_000_000n }), context(withoutFree()));
    expect(codeOf(free)).toBe("ok");
    const travel = add(fields({ name: "Travel", plannedAmount: 10_000_000n }), context(referenceLines()));
    expect(codeOf(travel)).toBe("PlanExceedsCapacity");
  });

  it("refuses any line while the plan has no capacity", () => {
    expect(codeOf(add(fields(), context([], { totalCapacity: 0n })))).toBe("PlanExceedsCapacity");
  });

  it("keeps line names unique within a plan ignoring case", () => {
    expect(codeOf(add(fields({ name: "home" }), context([aLine("Home", 1n)])))).toBe("BudgetLineNameTaken");
  });

  it("refuses a planned amount that is not positive, 0 COP included", () => {
    for (const plannedAmount of [0n, -100n]) {
      expect(codeOf(add(fields({ name: "Gifts", plannedAmount })))).toBe("InvalidPlannedAmount");
    }
  });

  it.each(["   ", "x".repeat(61)])("refuses the name %j", (name) => {
    expect(codeOf(add(fields({ name })))).toBe("InvalidBudgetLineName");
  });

  it("requires a savings account on a SAVINGS line and refuses accounts on other lines", () => {
    expect(codeOf(add(fields({ name: "Savings", funding: "SAVINGS" })))).toBe("SavingsAccountRequired");
    const direct = add(fields({ savingsAccountIds: ["acc-savings"] }));
    expect(direct).toEqual({
      ok: false,
      error: { code: "InvalidSavingsAccount", details: { reason: "notSavingsLine" } },
    });
    const twice = add(fields({ name: "Savings", funding: "SAVINGS", savingsAccountIds: ["acc-1", "acc-1"] }));
    expect(twice).toEqual({ ok: false, error: { code: "InvalidSavingsAccount", details: { reason: "duplicate" } } });
  });

  it("backs one SAVINGS line per plan with each account", () => {
    const again = add(
      fields({ name: "Emergency", funding: "SAVINGS", savingsAccountIds: ["acc-savings"], plannedAmount: 1n }),
      context(withoutFree()),
    );
    expect(codeOf(again)).toBe("SavingsAccountAlreadyUsed");
  });

  it("never makes a SAVINGS line the catch-all", () => {
    const savings = add(fields({ name: "Savings", funding: "SAVINGS", savingsAccountIds: ["a"], isCatchAll: true }));
    expect(codeOf(savings)).toBe("SavingsLineNotMappable");
  });

  it("allows one catch-all line per plan (HU-E6-04)", () => {
    const second = add(
      fields({ name: "Groceries", plannedAmount: 1n, isCatchAll: true }),
      context(referenceLines(), { totalCapacity: 500_000_000n }),
    );
    expect(codeOf(second)).toBe("CatchAllLineAlreadySet");
  });
});

describe("reviseLine (HU-E6-03, HU-E6-04)", () => {
  const home = aLine("Home", 147_000_000n);
  const others = referenceLines().filter((l) => l.name !== "Home");

  it("refuses an increase past the capacity and allows one within it", () => {
    expect(codeOf(reviseLine(home, { plannedAmount: 150_000_000n }, context(others)))).toBe("PlanExceedsCapacity");
    const within = reviseLine(home, { plannedAmount: 150_000_000n }, context(others, { totalCapacity: 410_000_000n }));
    expect(unwrap(within).plannedAmount).toBe(150_000_000n);
  });

  it("lets a plan over its capacity lower or rename a line (HU-E6-02)", () => {
    const over = context(others, { totalCapacity: 360_000_000n });
    expect(codeOf(reviseLine(home, { plannedAmount: 140_000_000n }, over))).toBe("ok");
    expect(unwrap(reviseLine(home, { name: "House" }, over)).name).toBe("House");
  });

  it("marks one line as catch-all, and refuses a second", () => {
    const free = aLine("Free", 73_000_000n);
    const marked = unwrap(reviseLine(free, { isCatchAll: true }, context(withoutFree())));
    expect(marked.isCatchAll).toBe(true);
    const second = reviseLine(home, { isCatchAll: true }, context([...others.filter((l) => l.name !== "Free"), marked]));
    expect(codeOf(second)).toBe("CatchAllLineAlreadySet");
  });

  it("keeps the allocation rule and drops the savings accounts of a line that stops being SAVINGS", () => {
    const savings = aLine("Savings", 60_000_000n, {
      funding: "SAVINGS",
      savingsAccountIds: ["acc-savings"],
      allocationRule: "FIXED",
    });
    const direct = unwrap(reviseLine(savings, { funding: "DIRECT" }, context([])));
    expect([direct.funding, direct.savingsAccountIds, direct.allocationRule]).toEqual(["DIRECT", [], "FIXED"]);
  });

  it("refuses to turn a line with mapped categories into a SAVINGS line", () => {
    const change = { funding: "SAVINGS" as const, savingsAccountIds: ["acc-2"] };
    expect(codeOf(reviseLine(home, change, context(others, { mappedCategories: 2 })))).toBe("SavingsLineNotMappable");
  });
});

describe("checkedMapping (HU-E6-04)", () => {
  const categories = [
    { id: "cat-groceries", archived: false },
    { id: "cat-utilities", archived: false },
    { id: "cat-old", archived: true },
  ];
  const home = { id: "line-home" as BudgetLineId, funding: "DIRECT" as const };

  it("maps Groceries and Utilities to Home, collapsing duplicates", () => {
    const mapped = checkedMapping(home, ["cat-groceries", "cat-utilities", "cat-groceries"], {
      categories,
      mappings: [],
    });
    expect(unwrap(mapped)).toEqual(["cat-groceries", "cat-utilities"]);
  });

  it("refuses a category mapped to another line of the plan, but keeps the line's own", () => {
    const mappings = [{ lineId: "line-free", categoryId: "cat-groceries" }];
    const free = { id: "line-free" as BudgetLineId, funding: "DIRECT" as const };
    expect(codeOf(checkedMapping(home, ["cat-groceries"], { categories, mappings }))).toBe("CategoryAlreadyMapped");
    expect(unwrap(checkedMapping(free, ["cat-groceries"], { categories, mappings }))).toEqual(["cat-groceries"]);
  });

  it("refuses categories that are not live categories of the space, and newly mapped archived ones", () => {
    expect(codeOf(checkedMapping(home, ["cat-personal"], { categories, mappings: [] }))).toBe("CategoryNotInSpace");
    expect(codeOf(checkedMapping(home, ["cat-old"], { categories, mappings: [] }))).toBe("CategoryArchived");
    const kept = checkedMapping(home, ["cat-old"], {
      categories,
      mappings: [{ lineId: "line-home", categoryId: "cat-old" }],
    });
    expect(unwrap(kept)).toEqual(["cat-old"]);
  });

  it("maps nothing to a SAVINGS line, whose spending is transfers (spec 5.4)", () => {
    const savings = { id: "line-savings" as BudgetLineId, funding: "SAVINGS" as const };
    expect(codeOf(checkedMapping(savings, ["cat-groceries"], { categories, mappings: [] }))).toBe(
      "SavingsLineNotMappable",
    );
    expect(unwrap(checkedMapping(savings, [], { categories, mappings: [] }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/domain/budget-line.test.ts`
Expected: FAIL — `Failed to resolve import "./budget-line"` (from the test and from `tests/support/budget-fixtures.ts`).

- [ ] **Step 3: Implement**

`src/modules/budgeting/domain/budget-line.ts`:

```ts
import { domainError, err, ok, type Id, type Result } from "@/shared/kernel";

export type BudgetLineId = Id<"BudgetLine">;
export const FUNDINGS = ["DIRECT", "SHARED_FUND", "SAVINGS"] as const;
export type Funding = (typeof FUNDINGS)[number];
export const ROLLOVER_MODES = ["RESET", "ROLLOVER", "ADJUSTED"] as const;
export type RolloverMode = (typeof ROLLOVER_MODES)[number];
export const ALLOCATION_RULES = ["PROPORTIONAL", "PERCENT", "FIXED", "NONE"] as const;
export type AllocationRule = (typeof ALLOCATION_RULES)[number];

/** Spec 5.2 BudgetLine: an envelope of a plan; its categories are CategoryMapping rows. */
export interface BudgetLine {
  readonly id: BudgetLineId;
  readonly planId: string;
  /** HU-E6-06, HU-E6-09: the line it was copied from, for rollover; null until plans are copied. */
  readonly originLineId: string | null;
  readonly name: string;
  /** Minor units of the space currency, positive. */
  readonly plannedAmount: bigint;
  readonly funding: Funding;
  /** SAVINGS lines only: their spending is the transfers into these accounts (spec 5.4). */
  readonly savingsAccountIds: readonly string[];
  readonly rolloverMode: RolloverMode;
  readonly isCatchAll: boolean;
  /** HU-E6-05: one rule per line, PROPORTIONAL by default; PERCENT and FIXED keep member values, NONE none. */
  readonly allocationRule: AllocationRule;
  readonly createdAt: Date;
}

/** HU-E6-04: expenses in the category consume the line; one current line per category and plan. */
export interface CategoryMapping {
  readonly lineId: string;
  readonly categoryId: string;
}

/** What a request sets on a line. */
export interface LineFields {
  readonly name: string;
  readonly plannedAmount: bigint;
  readonly funding: Funding;
  readonly savingsAccountIds: readonly string[];
  readonly rolloverMode: RolloverMode;
  readonly isCatchAll: boolean;
}

/** The rest of the plan, as a line written into it sees it. */
export interface LineContext {
  /** The plan's other current lines. */
  readonly siblings: readonly BudgetLine[];
  /** HU-E6-02: Σ capacities of the current members. */
  readonly totalCapacity: bigint;
  /** Categories currently mapped to this line; 0 for a new line. */
  readonly mappedCategories: number;
}

const MAX_NAME = 60;
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const checked = (fields: LineFields, context: LineContext, previousPlanned: bigint | null): Result<LineFields> => {
  const name = fields.name.trim();
  if (name.length < 1 || name.length > MAX_NAME) {
    return err(domainError("InvalidBudgetLineName", { length: name.length }));
  }
  if (fields.plannedAmount <= 0n) return err(domainError("InvalidPlannedAmount"));
  const savings = fields.funding === "SAVINGS";
  const accounts = fields.savingsAccountIds;
  if (savings && accounts.length === 0) return err(domainError("SavingsAccountRequired"));
  if (!savings && accounts.length > 0) {
    return err(domainError("InvalidSavingsAccount", { reason: "notSavingsLine" }));
  }
  if (new Set(accounts).size !== accounts.length) {
    return err(domainError("InvalidSavingsAccount", { reason: "duplicate" }));
  }
  // Spec 5.4: a SAVINGS line consumes transfers into its accounts, never expense categories.
  if (savings && (fields.isCatchAll || context.mappedCategories > 0)) {
    return err(domainError("SavingsLineNotMappable"));
  }
  const { siblings } = context;
  if (siblings.some((line) => sameName(line.name, name))) return err(domainError("BudgetLineNameTaken"));
  if (fields.isCatchAll && siblings.some((line) => line.isCatchAll)) {
    return err(domainError("CatchAllLineAlreadySet"));
  }
  if (accounts.some((id) => siblings.some((line) => line.savingsAccountIds.includes(id)))) {
    return err(domainError("SavingsAccountAlreadyUsed"));
  }
  // Spec 5.2: adding a line or increasing it never pushes Σ planned above total capacity; other edits may.
  const grows = previousPlanned === null || fields.plannedAmount > previousPlanned;
  const plannedElsewhere = siblings.reduce((sum, line) => sum + line.plannedAmount, 0n);
  if (grows && plannedElsewhere + fields.plannedAmount > context.totalCapacity) {
    return err(domainError("PlanExceedsCapacity"));
  }
  return ok({ ...fields, name });
};

/** HU-E6-03: a new line of the plan, PROPORTIONAL until it is allocated otherwise (HU-E6-05). */
export const newLine = (
  input: { id: BudgetLineId; planId: string; now: Date; fields: LineFields },
  context: LineContext,
): Result<BudgetLine> => {
  const fields = checked(input.fields, context, null);
  if (!fields.ok) return fields;
  return ok({
    id: input.id,
    planId: input.planId,
    originLineId: null,
    ...fields.value,
    allocationRule: "PROPORTIONAL",
    createdAt: input.now,
  });
};

/** HU-E6-03, HU-E6-04: edits a line; its allocation rule stays, and a line that stops being SAVINGS drops its accounts. */
export const reviseLine = (line: BudgetLine, change: Partial<LineFields>, context: LineContext): Result<BudgetLine> => {
  const funding = change.funding ?? line.funding;
  const fields = checked(
    {
      name: change.name ?? line.name,
      plannedAmount: change.plannedAmount ?? line.plannedAmount,
      funding,
      savingsAccountIds: change.savingsAccountIds ?? (funding === "SAVINGS" ? line.savingsAccountIds : []),
      rolloverMode: change.rolloverMode ?? line.rolloverMode,
      isCatchAll: change.isCatchAll ?? line.isCatchAll,
    },
    context,
    line.plannedAmount,
  );
  return fields.ok ? ok({ ...line, ...fields.value }) : fields;
};

/**
 * HU-E6-04: the categories the line maps once `categoryIds` replaces its set. The line's own mappings stay as they
 * are; a newly mapped category is a live category of the space (anything else is CategoryNotInSpace, so other
 * spaces' categories never leak), not archived and not mapped to another current line of the plan.
 */
export const checkedMapping = (
  line: Pick<BudgetLine, "id" | "funding">,
  categoryIds: readonly string[],
  context: {
    readonly categories: readonly { readonly id: string; readonly archived: boolean }[];
    readonly mappings: readonly CategoryMapping[];
  },
): Result<string[]> => {
  const wanted = [...new Set(categoryIds)];
  if (wanted.length > 0 && line.funding === "SAVINGS") return err(domainError("SavingsLineNotMappable"));
  const own = new Set(context.mappings.filter((m) => m.lineId === line.id).map((m) => m.categoryId));
  for (const categoryId of wanted) {
    if (own.has(categoryId)) continue;
    const category = context.categories.find((c) => c.id === categoryId);
    if (category === undefined) return err(domainError("CategoryNotInSpace"));
    if (category.archived) return err(domainError("CategoryArchived"));
    if (context.mappings.some((m) => m.categoryId === categoryId)) return err(domainError("CategoryAlreadyMapped"));
  }
  return ok(wanted);
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/domain`
Expected: PASS. Mutation checks: temporarily replace `const grows = previousPlanned === null || fields.plannedAmount > previousPlanned;` with `const grows = true;` — "lets a plan over its capacity lower or rename a line" fails; temporarily delete the line `    if (own.has(categoryId)) continue;` — "keeps the line's own" and the archived-but-kept case fail; restore both.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/domain/budget-line.ts src/modules/budgeting/domain/budget-line.test.ts tests/support/budget-fixtures.ts
git commit -m "feat(budgeting): check budget lines, the catch-all line and category mappings (Refs #49, Refs #50)"
```

---

### Task 3: Kernel and budgeting domain — allocations

Implements the AllocationCalculator of HU-E6-05 (issue #51). Pins Review Focus 2 (values of members who left drop out) and Review Focus 3 (remainders, sub-peso amounts, members without weight, zero capacity).

Decisions:
- `Money.allocate` also takes `bigint` weights: capacities are minor units (1,600,000 COP = 160,000,000) and may exceed `Number.MAX_SAFE_INTEGER`, so converting them to numbers could lose precision. Numbers keep working; the error details of `InvalidRatio` become strings so a bigint never reaches a log.
- `checkedAllocation` (write side) stores values in join order: PERCENT as basis points summing to 10,000, FIXED as minor units summing to the line's planned amount; each value is positive and names a current member (`NotASpaceMember`); duplicates, an empty member list and wrong sums are `InvalidAllocation` with a `reason`. PROPORTIONAL and NONE store no values (ruling P1: the rule lives on the line).
- `assignedAmounts` (read side) derives what each current member is assigned, never stored (HU-E6-05 note). PROPORTIONAL follows capacities; PERCENT and FIXED follow the stored values of current members only, so a line whose values no longer add up after a member left, or a PROPORTIONAL line without capacity, is `InvalidAllocation` until it is allocated again (HU-E6-06 shows the same flag after a copy; ruling P7). Only weighted members take part in `Money.allocate`, so a member without capacity or value is assigned 0 and never receives the sub-unit remainder that `Money.allocate` gives to its first part.

**Files:**
- Create: `src/modules/budgeting/domain/allocation.ts`
- Modify: `src/shared/kernel/money.ts`
- Test: `src/modules/budgeting/domain/allocation.test.ts`, `src/shared/kernel/money.test.ts`

**Interfaces:**
- Consumes: `AllocationRule`, `BudgetLine` (Task 2); `Money`, `flatMap`, `map` (kernel); `codeOf`, `money`, `unwrap` (`tests/support/fakes.ts`).
- Produces:
  - `Money.allocate(ratios: readonly (number | bigint)[]): Result<Money[]>`
  - `interface AllocationValue { memberId: string; value: bigint }`; `interface LineAllocation extends AllocationValue { lineId: string }`
  - `type AllocationInput = { rule: "PROPORTIONAL" } | { rule: "NONE" } | { rule: "PERCENT"; members: readonly { memberId: string; basisPoints: number }[] } | { rule: "FIXED"; members: readonly { memberId: string; amount: Money }[] }`
  - `checkedAllocation(input: AllocationInput, line: Pick<BudgetLine, "plannedAmount">, memberIds: readonly string[], currency: string): Result<{ rule: AllocationRule; values: AllocationValue[] }>` — `InvalidAllocation`, `NotASpaceMember`, `CurrencyMismatch`
  - `assignedAmounts(line: Pick<BudgetLine, "allocationRule" | "plannedAmount">, values: readonly AllocationValue[], members: readonly { memberId: string; capacity: bigint }[], currency: string): Result<{ memberId: string; amount: bigint }[] | null>` — `InvalidAllocation`

- [ ] **Step 1: Write the failing tests**

In `src/shared/kernel/money.test.ts`, insert before the line `  it("allocates negative amounts without losing units", () => {`:

```ts
  it("allocates by bigint weights, such as capacities in minor units (HU-E6-05)", () => {
    expect(majors(unwrap(cop("1470000").allocate([160_000_000n, 240_000_000n])))).toEqual([588000n, 882000n]);
    const beyondSafeIntegers = 9_007_199_254_740_993n;
    expect(
      majors(unwrap(cop("100000").allocate([beyondSafeIntegers, beyondSafeIntegers, beyondSafeIntegers]))),
    ).toEqual([33334n, 33333n, 33333n]);
    expect(isErr(cop("10").allocate([-1n, 2n]))).toBe(true);
    expect(isErr(cop("10").allocate([0n, 0n]))).toBe(true);
  });

```

`src/modules/budgeting/domain/allocation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { assignedAmounts, checkedAllocation, type AllocationInput } from "./allocation";
import type { BudgetLine } from "./budget-line";

const MEMBERS = ["member-ana", "member-juan", "member-pedro"];
const cop = (pesos: number) => money(BigInt(pesos) * 100n);
const planned = (pesos: number) => ({ plannedAmount: BigInt(pesos) * 100n });
const line = (rule: BudgetLine["allocationRule"], pesos: number) => ({ allocationRule: rule, ...planned(pesos) });
// HU-E6-05 Background: capacities Ana 1,600,000 COP and Juan 2,400,000 COP.
const GOLDEN = [
  { memberId: "member-ana", capacity: 160_000_000n },
  { memberId: "member-juan", capacity: 240_000_000n },
];

describe("checkedAllocation (HU-E6-05)", () => {
  it("stores no values for PROPORTIONAL and NONE", () => {
    expect(unwrap(checkedAllocation({ rule: "PROPORTIONAL" }, planned(1_470_000), MEMBERS, "COP"))).toEqual({
      rule: "PROPORTIONAL",
      values: [],
    });
    expect(unwrap(checkedAllocation({ rule: "NONE" }, planned(730_000), MEMBERS, "COP")).values).toEqual([]);
  });

  it("stores PERCENT 42 % / 58 % as basis points in join order, whatever the request order", () => {
    const free = checkedAllocation(
      {
        rule: "PERCENT",
        members: [
          { memberId: "member-juan", basisPoints: 5800 },
          { memberId: "member-ana", basisPoints: 4200 },
        ],
      },
      planned(730_000),
      MEMBERS,
      "COP",
    );
    expect(unwrap(free)).toEqual({
      rule: "PERCENT",
      values: [
        { memberId: "member-ana", value: 4200n },
        { memberId: "member-juan", value: 5800n },
      ],
    });
  });

  it("stores FIXED amounts that add up to the planned amount", () => {
    const savings = checkedAllocation(
      {
        rule: "FIXED",
        members: [
          { memberId: "member-ana", amount: cop(200_000) },
          { memberId: "member-juan", amount: cop(400_000) },
        ],
      },
      planned(600_000),
      MEMBERS,
      "COP",
    );
    expect(unwrap(savings).values).toEqual([
      { memberId: "member-ana", value: 20_000_000n },
      { memberId: "member-juan", value: 40_000_000n },
    ]);
  });

  it.each<[string, AllocationInput, number, string]>([
    [
      "Free PERCENT 42 % / 57 %",
      {
        rule: "PERCENT" as const,
        members: [
          { memberId: "member-ana", basisPoints: 4200 },
          { memberId: "member-juan", basisPoints: 5700 },
        ],
      },
      730_000,
      "percentNotHundred",
    ],
    [
      "Savings FIXED 200,000 / 350,000 COP",
      {
        rule: "FIXED" as const,
        members: [
          { memberId: "member-ana", amount: cop(200_000) },
          { memberId: "member-juan", amount: cop(350_000) },
        ],
      },
      600_000,
      "fixedNotPlanned",
    ],
  ])("refuses %s: the values must add up", (_line, input, pesos, reason) => {
    expect(checkedAllocation(input, planned(pesos), MEMBERS, "COP")).toEqual({
      ok: false,
      error: { code: "InvalidAllocation", details: { reason } },
    });
  });

  it("refuses non-members, members listed twice, zero values, no members and another currency", () => {
    const percent = (members: { memberId: string; basisPoints: number }[]) =>
      codeOf(checkedAllocation({ rule: "PERCENT", members }, planned(730_000), MEMBERS, "COP"));
    expect(percent([{ memberId: "member-marta", basisPoints: 10_000 }])).toBe("NotASpaceMember");
    expect(
      percent([
        { memberId: "member-ana", basisPoints: 5000 },
        { memberId: "member-ana", basisPoints: 5000 },
      ]),
    ).toBe("InvalidAllocation");
    expect(
      percent([
        { memberId: "member-ana", basisPoints: 10_000 },
        { memberId: "member-juan", basisPoints: 0 },
      ]),
    ).toBe("InvalidAllocation");
    expect(percent([])).toBe("InvalidAllocation");
    const dollars = checkedAllocation(
      { rule: "FIXED", members: [{ memberId: "member-ana", amount: money(60_000_000n, "USD") }] },
      planned(600_000),
      MEMBERS,
      "COP",
    );
    expect(codeOf(dollars)).toBe("CurrencyMismatch");
  });
});

describe("assignedAmounts (HU-E6-05, spec 5.3)", () => {
  it("assigns Home 588,000 / 882,000 COP in proportion to capacities, the default (golden)", () => {
    expect(unwrap(assignedAmounts(line("PROPORTIONAL", 1_470_000), [], GOLDEN, "COP"))).toEqual([
      { memberId: "member-ana", amount: 58_800_000n },
      { memberId: "member-juan", amount: 88_200_000n },
    ]);
  });

  it("assigns Free 306,600 / 423,400 COP at 42 % / 58 % (golden)", () => {
    const values = [
      { memberId: "member-ana", value: 4200n },
      { memberId: "member-juan", value: 5800n },
    ];
    expect(unwrap(assignedAmounts(line("PERCENT", 730_000), values, GOLDEN, "COP"))).toEqual([
      { memberId: "member-ana", amount: 30_660_000n },
      { memberId: "member-juan", amount: 42_340_000n },
    ]);
  });

  it("assigns FIXED values as they are, and 0 to a member without one", () => {
    const values = [
      { memberId: "member-ana", value: 20_000_000n },
      { memberId: "member-juan", value: 40_000_000n },
    ];
    const withPedro = [...GOLDEN, { memberId: "member-pedro", capacity: 0n }];
    expect(unwrap(assignedAmounts(line("FIXED", 600_000), values, withPedro, "COP"))).toEqual([
      { memberId: "member-ana", amount: 20_000_000n },
      { memberId: "member-juan", amount: 40_000_000n },
      { memberId: "member-pedro", amount: 0n },
    ]);
  });

  it("assigns nobody on a NONE line", () => {
    expect(unwrap(assignedAmounts(line("NONE", 730_000), [], GOLDEN, "COP"))).toBeNull();
  });

  it("flags a PROPORTIONAL line when every capacity is 0", () => {
    const zero = GOLDEN.map((m) => ({ ...m, capacity: 0n }));
    expect(assignedAmounts(line("PROPORTIONAL", 1_470_000), [], zero, "COP")).toEqual({
      ok: false,
      error: { code: "InvalidAllocation", details: { reason: "noCapacity" } },
    });
  });

  it("gives remainders to the earliest-joined members, and Σ assigned is the planned amount (Review Focus 3)", () => {
    const three = MEMBERS.map((memberId) => ({ memberId, capacity: 100_000_000n }));
    const parts = unwrap(assignedAmounts(line("PROPORTIONAL", 100_000), [], three, "COP"))!;
    expect(parts.map((p) => p.amount)).toEqual([3_333_400n, 3_333_300n, 3_333_300n]);
    const subPeso = unwrap(assignedAmounts({ allocationRule: "PROPORTIONAL", plannedAmount: 10_000_050n }, [], GOLDEN.map((m) => ({ ...m, capacity: 1n })), "COP"))!;
    expect(subPeso.map((p) => p.amount)).toEqual([5_000_050n, 5_000_000n]);
  });

  it("never gives a remainder to a member without weight, even the first one to join", () => {
    const pedroFirst = [{ memberId: "member-pedro", capacity: 0n }, ...GOLDEN.map((m) => ({ ...m, capacity: 1n }))];
    const parts = unwrap(
      assignedAmounts({ allocationRule: "PROPORTIONAL", plannedAmount: 10_000_050n }, [], pedroFirst, "COP"),
    )!;
    expect(parts).toEqual([
      { memberId: "member-pedro", amount: 0n },
      { memberId: "member-ana", amount: 5_000_050n },
      { memberId: "member-juan", amount: 5_000_000n },
    ]);
  });

  it("flags PERCENT and FIXED lines whose values no longer add up after a member left (Review Focus 2)", () => {
    const anaOnly = [{ memberId: "member-ana", capacity: 160_000_000n }];
    const percent = [
      { memberId: "member-ana", value: 4200n },
      { memberId: "member-juan", value: 5800n },
    ];
    expect(codeOf(assignedAmounts(line("PERCENT", 730_000), percent, anaOnly, "COP"))).toBe("InvalidAllocation");
    const fixed = [
      { memberId: "member-ana", value: 20_000_000n },
      { memberId: "member-juan", value: 40_000_000n },
    ];
    expect(codeOf(assignedAmounts(line("FIXED", 600_000), fixed, anaOnly, "COP"))).toBe("InvalidAllocation");
    expect(unwrap(assignedAmounts(line("PROPORTIONAL", 1_470_000), [], anaOnly, "COP"))).toEqual([
      { memberId: "member-ana", amount: 147_000_000n },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/shared/kernel/money.test.ts src/modules/budgeting/domain/allocation.test.ts`
Expected: FAIL — the bigint test fails with `InvalidRatio` (`Number.isInteger(160000000n)` is false), and `Failed to resolve import "./allocation"`.

- [ ] **Step 3: Implement**

In `src/shared/kernel/money.ts`:

1. Replace the line `   * allocating their absolute value and negating every part, so the total stays exact.` with:

```ts
   * allocating their absolute value and negating every part, so the total stays exact. Ratios are
   * non-negative integers, as numbers or bigints (HU-E6-05 weighs by capacities in minor units).
```

2. Replace the lines from `  allocate(ratios: readonly number[]): Result<Money[]> {` through `    if (totalWeight === 0n) return err(domainError("InvalidRatio", { ratios }));` with:

```ts
  allocate(ratios: readonly (number | bigint)[]): Result<Money[]> {
    const valid = (r: number | bigint) => (typeof r === "bigint" ? r >= 0n : Number.isInteger(r) && r >= 0);
    // Details stay strings: a bigint never reaches a log serializer.
    const invalid = () => err(domainError("InvalidRatio", { ratios: ratios.map(String) }));
    if (ratios.length === 0 || !ratios.every(valid)) return invalid();
    const weights = ratios.map((r) => BigInt(r));
    const totalWeight = weights.reduce((a, b) => a + b, 0n);
    if (totalWeight === 0n) return invalid();
```

`src/modules/budgeting/domain/allocation.ts`:

```ts
import { domainError, err, flatMap, map, Money, ok, type Result } from "@/shared/kernel";
import type { AllocationRule, BudgetLine } from "./budget-line";

/** A member's value on a PERCENT line (basis points, 42 % = 4200) or a FIXED line (minor units). */
export interface AllocationValue {
  readonly memberId: string;
  readonly value: bigint;
}

/** HU-E6-05: a current allocation value of one of the plan's lines. */
export interface LineAllocation extends AllocationValue {
  readonly lineId: string;
}

/** HU-E6-05: how a line is allocated among members. */
export type AllocationInput =
  | { readonly rule: "PROPORTIONAL" }
  | { readonly rule: "NONE" }
  | {
      readonly rule: "PERCENT";
      readonly members: readonly { readonly memberId: string; readonly basisPoints: number }[];
    }
  | { readonly rule: "FIXED"; readonly members: readonly { readonly memberId: string; readonly amount: Money }[] };

/** 100 % in basis points. */
const WHOLE = 10_000n;

const invalid = (reason: string): Result<never> => err(domainError("InvalidAllocation", { reason }));
const sum = (values: readonly bigint[]) => values.reduce((a, b) => a + b, 0n);

/**
 * HU-E6-05: the rule and the member values a line stores, in join order. PERCENT values sum to 100 % and FIXED
 * amounts to the planned amount, each positive, for current members (registered or guest, D15); PROPORTIONAL and
 * NONE store no values.
 */
export const checkedAllocation = (
  input: AllocationInput,
  line: Pick<BudgetLine, "plannedAmount">,
  memberIds: readonly string[],
  currency: string,
): Result<{ rule: AllocationRule; values: AllocationValue[] }> => {
  if (input.rule === "PROPORTIONAL" || input.rule === "NONE") return ok({ rule: input.rule, values: [] });
  const ids = input.members.map((m) => m.memberId);
  if (ids.length === 0) return invalid("membersRequired");
  if (new Set(ids).size !== ids.length) return invalid("duplicateMember");
  if (ids.some((id) => !memberIds.includes(id))) return err(domainError("NotASpaceMember"));
  let values: AllocationValue[];
  if (input.rule === "PERCENT") {
    if (input.members.some((m) => !Number.isInteger(m.basisPoints) || m.basisPoints <= 0)) {
      return invalid("percentNotPositive");
    }
    values = input.members.map((m) => ({ memberId: m.memberId, value: BigInt(m.basisPoints) }));
    if (sum(values.map((v) => v.value)) !== WHOLE) return invalid("percentNotHundred");
  } else {
    const foreign = input.members.find((m) => m.amount.currency.code !== currency);
    if (foreign !== undefined) {
      return err(domainError("CurrencyMismatch", { expected: currency, actual: foreign.amount.currency.code }));
    }
    if (input.members.some((m) => m.amount.minor <= 0n)) return invalid("amountNotPositive");
    values = input.members.map((m) => ({ memberId: m.memberId, value: m.amount.minor }));
    if (sum(values.map((v) => v.value)) !== line.plannedAmount) return invalid("fixedNotPlanned");
  }
  const inJoinOrder = [...values].sort((a, b) => memberIds.indexOf(a.memberId) - memberIds.indexOf(b.memberId));
  return ok({ rule: input.rule, values: inJoinOrder });
};

const allocated = (total: bigint, currency: string, weights: readonly bigint[]): Result<bigint[]> =>
  flatMap(Money.ofMinor(total, currency), (money) =>
    map(money.allocate(weights), (parts) => parts.map((part) => part.minor)),
  );

/**
 * HU-E6-05, spec 5.3: what each current member (join order) is assigned on a line, derived on read and never
 * stored; null for NONE. PROPORTIONAL follows capacities, PERCENT and FIXED the values of current members, so a
 * line whose values no longer add up after a member left, or with no capacity to follow, is InvalidAllocation.
 * Only weighted members share the planned amount, so the others get 0 and never a rounding remainder.
 */
export const assignedAmounts = (
  line: Pick<BudgetLine, "allocationRule" | "plannedAmount">,
  values: readonly AllocationValue[],
  members: readonly { readonly memberId: string; readonly capacity: bigint }[],
  currency: string,
): Result<{ memberId: string; amount: bigint }[] | null> => {
  const rule = line.allocationRule;
  if (rule === "NONE") return ok(null);
  const valueOf = (memberId: string) => values.find((v) => v.memberId === memberId)?.value ?? 0n;
  const weights = members.map((m) => ({
    memberId: m.memberId,
    weight: rule === "PROPORTIONAL" ? m.capacity : valueOf(m.memberId),
  }));
  const total = sum(weights.map((w) => w.weight));
  if (rule === "FIXED") {
    return total === line.plannedAmount
      ? ok(weights.map((w) => ({ memberId: w.memberId, amount: w.weight })))
      : invalid("fixedNotPlanned");
  }
  if (rule === "PERCENT" && total !== WHOLE) return invalid("percentNotHundred");
  const weighted = weights.filter((w) => w.weight > 0n);
  if (weighted.length === 0) return invalid("noCapacity");
  return map(
    allocated(
      line.plannedAmount,
      currency,
      weighted.map((w) => w.weight),
    ),
    (parts) =>
      weights.map((w) => {
        const index = weighted.indexOf(w);
        return { memberId: w.memberId, amount: index < 0 ? 0n : parts[index]! };
      }),
  );
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/shared/kernel src/modules/budgeting/domain src/modules/ledger/domain`
Expected: PASS, the ledger's split tests (number ratios) included. Mutation check: temporarily replace `const weighted = weights.filter((w) => w.weight > 0n);` with `const weighted = weights;` — "never gives a remainder to a member without weight" fails; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/kernel/money.ts src/shared/kernel/money.test.ts src/modules/budgeting/domain/allocation.ts src/modules/budgeting/domain/allocation.test.ts
git commit -m "feat(budgeting): allocate budget lines proportionally, by percentage or by fixed amount (Refs #51)"
```

---

### Task 4: Budgeting domain — plan figures of the reference plan

Implements the derived figures of HU-E6-02 … HU-E6-05 (issues #48–#51) and spec 5.4, with the reference plan of spec section 4 as a golden fixture. Pins Review Focus 2 and 3 (members who left, zero capacity, reduced capacity, guests).

Decisions:
- `planFigures` is the one place that derives a plan's figures, on every read and after every write (D7): capacities of every current member with their share, total capacity, Σ planned, unallocated capacity (may be negative, HU-E6-02), and per line its share of capacity, its allocation (rule, stored values of current members, assigned amounts or the `InvalidAllocation` flag), `spent` and `available`.
- Spending follows spec 5.4 and HU-E6-04: an expense category consumes its mapped line, else the catch-all line, else the implicit "Unbudgeted" line; SAVINGS lines spend the transfers into their accounts. `available = planned + carry-over − spent`, and the carry-over is 0 in M3-A because no line has an origin before HU-E6-06 (HU-E6-09 note; ruling P4). "Unbudgeted" exists only without a catch-all line and has no planned amount, so its availability is minus its spending (HU-E7-01 shows the same).
- A NONE line reports planned, spent and available but no member entries (HU-E6-05 note); PROPORTIONAL, PERCENT and FIXED lines list every current member in join order.

**Files:**
- Create: `src/modules/budgeting/domain/plan-figures.ts`
- Test: `src/modules/budgeting/domain/plan-figures.test.ts`

**Interfaces:**
- Consumes: `MemberCapacity`, `capacityOf`, `shareOfTotal`, `totalCapacity` (Task 1); `AllocationRule`, `BudgetLine`, `CategoryMapping` (Task 2); `LineAllocation`, `assignedAmounts` (Task 3); `aLine`, `referenceLines` (`tests/support/budget-fixtures.ts`).
- Produces:
  - `interface PlanParts { capacities: readonly MemberCapacity[]; lines: readonly BudgetLine[]; mappings: readonly CategoryMapping[]; allocations: readonly LineAllocation[] }`
  - `interface PeriodSpending { byCategory: readonly { categoryId: string; amount: bigint }[]; byAccount: readonly { accountId: string; amount: bigint }[] }`
  - `interface CapacityFigure { memberId: string; amount: bigint; shareBasisPoints: number | null }`; `interface AllocationFigure { rule: AllocationRule; members: readonly { memberId: string; value: bigint | null; assigned: bigint | null }[]; invalid: boolean }`; `interface LineFigure { line: BudgetLine; categoryIds: readonly string[]; capacityShareBasisPoints: number | null; allocation: AllocationFigure; spent: bigint; available: bigint }`; `interface PlanFigures { capacities: readonly CapacityFigure[]; totalCapacity: bigint; planned: bigint; unallocated: bigint; lines: readonly LineFigure[]; unbudgeted: { spent: bigint; available: bigint } | null }`
  - `lineForCategory(categoryId: string, parts: Pick<PlanParts, "lines" | "mappings">): string | null`
  - `planFigures(input: { currency: string; memberIds: readonly string[]; parts: PlanParts; spending: PeriodSpending }): PlanFigures`

- [ ] **Step 1: Write the failing test**

`src/modules/budgeting/domain/plan-figures.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { aLine, referenceLines } from "../../../../tests/support/budget-fixtures";
import { lineForCategory, planFigures, type PeriodSpending, type PlanFigures, type PlanParts } from "./plan-figures";

const ANA = "member-ana";
const JUAN = "member-juan";
const PEDRO = "member-pedro";

/** Spec section 4 with the E7 mappings: Rent → Rent; Groceries, Utilities → Home; Free 42 % / 58 %, catch-all. */
const reference = (overrides: Partial<PlanParts> = {}): PlanParts => ({
  capacities: [
    { memberId: ANA, amount: 160_000_000n },
    { memberId: JUAN, amount: 240_000_000n },
  ],
  lines: referenceLines().map((l) => (l.name === "Free" ? { ...l, allocationRule: "PERCENT" as const } : l)),
  mappings: [
    { lineId: "line-rent", categoryId: "cat-rent" },
    { lineId: "line-home", categoryId: "cat-groceries" },
    { lineId: "line-home", categoryId: "cat-utilities" },
  ],
  allocations: [
    { lineId: "line-free", memberId: ANA, value: 4200n },
    { lineId: "line-free", memberId: JUAN, value: 5800n },
  ],
  ...overrides,
});
// HU-E7-01 Background in 2026-11, plus a 200,000 COP transfer into the savings account.
const NOVEMBER: PeriodSpending = {
  byCategory: [
    { categoryId: "cat-rent", amount: 120_000_000n },
    { categoryId: "cat-groceries", amount: 90_000_000n },
    { categoryId: "cat-utilities", amount: 40_000_000n },
    { categoryId: "cat-entertainment", amount: 25_000_000n },
  ],
  byAccount: [{ accountId: "acc-savings", amount: 20_000_000n }],
};
const NOTHING: PeriodSpending = { byCategory: [], byAccount: [] };
const figures = (parts: PlanParts, memberIds = [ANA, JUAN], spending = NOVEMBER) =>
  planFigures({ currency: "COP", memberIds, parts, spending });
const line = (f: PlanFigures, name: string) => f.lines.find((l) => l.line.name === name)!;
const assigned = (f: PlanFigures, name: string) =>
  line(f, name).allocation.members.map((m) => [m.memberId, m.assigned]);

describe("the reference plan (spec section 4, golden)", () => {
  it("has 4,000,000 COP of capacity at 40 % / 60 %, all of it planned", () => {
    const f = figures(reference());
    expect(f.capacities).toEqual([
      { memberId: ANA, amount: 160_000_000n, shareBasisPoints: 4000 },
      { memberId: JUAN, amount: 240_000_000n, shareBasisPoints: 6000 },
    ]);
    expect([f.totalCapacity, f.planned, f.unallocated]).toEqual([400_000_000n, 400_000_000n, 0n]);
    expect(f.lines.map((l) => [l.line.name, l.capacityShareBasisPoints])).toEqual([
      ["Rent", 3000],
      ["Home", 3675],
      ["Savings", 1500],
      ["Free", 1825],
    ]);
  });

  it("assigns every line as the reference table does", () => {
    const f = figures(reference());
    expect(assigned(f, "Rent")).toEqual([
      [ANA, 48_000_000n],
      [JUAN, 72_000_000n],
    ]);
    expect(assigned(f, "Home")).toEqual([
      [ANA, 58_800_000n],
      [JUAN, 88_200_000n],
    ]);
    expect(assigned(f, "Savings")).toEqual([
      [ANA, 24_000_000n],
      [JUAN, 36_000_000n],
    ]);
    expect(assigned(f, "Free")).toEqual([
      [ANA, 30_660_000n],
      [JUAN, 42_340_000n],
    ]);
    expect(line(f, "Free").allocation.members.map((m) => m.value)).toEqual([4200n, 5800n]);
    expect(line(f, "Home").allocation).toMatchObject({ rule: "PROPORTIONAL", invalid: false });
  });

  it("spends mapped categories on their line, unmapped ones on the catch-all and transfers on Savings (HU-E6-04)", () => {
    const f = figures(reference());
    expect(f.lines.map((l) => [l.line.name, l.spent, l.available])).toEqual([
      ["Rent", 120_000_000n, 0n],
      ["Home", 130_000_000n, 17_000_000n],
      ["Savings", 20_000_000n, 40_000_000n],
      ["Free", 25_000_000n, 48_000_000n],
    ]);
    expect(line(f, "Home").categoryIds).toEqual(["cat-groceries", "cat-utilities"]);
    expect(f.unbudgeted).toBeNull();
  });
});

describe("plan figures beyond the reference plan", () => {
  it("puts unmapped spending in Unbudgeted when the plan has no catch-all line (HU-E6-04)", () => {
    const parts = reference({ lines: reference().lines.map((l) => ({ ...l, isCatchAll: false })) });
    const spending = { byCategory: [{ categoryId: "cat-restaurants", amount: 6_000_000n }], byAccount: [] };
    const f = figures(parts, [ANA, JUAN], spending);
    expect(f.unbudgeted).toEqual({ spent: 6_000_000n, available: -6_000_000n });
    expect(line(f, "Free").spent).toBe(0n);
    expect(lineForCategory("cat-restaurants", parts)).toBeNull();
    expect(lineForCategory("cat-restaurants", reference())).toBe("line-free");
    expect(lineForCategory("cat-groceries", reference())).toBe("line-home");
  });

  it("reports planned, spent and available but nobody's assignment on a NONE line (HU-E6-05)", () => {
    const parts = reference({
      lines: reference().lines.map((l) => (l.name === "Free" ? { ...l, allocationRule: "NONE" as const } : l)),
    });
    const free = line(figures(parts), "Free");
    expect(free.allocation).toEqual({ rule: "NONE", members: [], invalid: false });
    expect([free.line.plannedAmount, free.spent, free.available]).toEqual([73_000_000n, 25_000_000n, 48_000_000n]);
  });

  it("flags PROPORTIONAL lines and gives no shares while every capacity is 0 (HU-E6-05)", () => {
    const f = figures(reference({ capacities: [] }), [ANA, JUAN], NOTHING);
    expect(f.capacities.map((c) => c.shareBasisPoints)).toEqual([null, null]);
    expect(line(f, "Home").allocation.invalid).toBe(true);
    expect(assigned(f, "Home")).toEqual([
      [ANA, null],
      [JUAN, null],
    ]);
    expect(line(f, "Home").capacityShareBasisPoints).toBeNull();
    expect(line(f, "Free").allocation.invalid).toBe(false);
    expect(f.unallocated).toBe(-400_000_000n);
  });

  it("drops a member who left from every figure and flags the PERCENT line that named them (Review Focus 2)", () => {
    const f = figures(reference(), [ANA], NOTHING);
    expect([f.totalCapacity, f.unallocated]).toEqual([160_000_000n, -240_000_000n]);
    expect(assigned(f, "Home")).toEqual([[ANA, 147_000_000n]]);
    expect(line(f, "Free").allocation).toEqual({
      rule: "PERCENT",
      members: [{ memberId: ANA, value: 4200n, assigned: null }],
      invalid: true,
    });
  });

  it("reports capacity reduced below the lines as negative unallocated capacity (HU-E6-02)", () => {
    const reduced = reference({
      capacities: [
        { memberId: ANA, amount: 160_000_000n },
        { memberId: JUAN, amount: 200_000_000n },
      ],
    });
    const f = figures(reduced, [ANA, JUAN], NOTHING);
    expect([f.totalCapacity, f.unallocated]).toEqual([360_000_000n, -40_000_000n]);
  });

  it("counts a guest's capacity like anyone's (D15)", () => {
    const parts = reference({
      capacities: [...reference().capacities, { memberId: PEDRO, amount: 100_000_000n }],
      lines: [aLine("Home", 147_000_000n)],
      allocations: [],
    });
    expect(assigned(figures(parts, [ANA, JUAN, PEDRO], NOTHING), "Home")).toEqual([
      [ANA, 47_040_000n],
      [JUAN, 70_560_000n],
      [PEDRO, 29_400_000n],
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/domain/plan-figures.test.ts`
Expected: FAIL — `Failed to resolve import "./plan-figures"`.

- [ ] **Step 3: Implement**

`src/modules/budgeting/domain/plan-figures.ts`:

```ts
import { assignedAmounts, type LineAllocation } from "./allocation";
import type { AllocationRule, BudgetLine, CategoryMapping } from "./budget-line";
import { capacityOf, shareOfTotal, totalCapacity, type MemberCapacity } from "./capacity";

/** What a plan holds: its capacities, current lines, current category mappings and current allocation values. */
export interface PlanParts {
  readonly capacities: readonly MemberCapacity[];
  readonly lines: readonly BudgetLine[];
  readonly mappings: readonly CategoryMapping[];
  readonly allocations: readonly LineAllocation[];
}

/** Spec 5.4: what was spent in the plan's period, summed by the ledger on read (D7). */
export interface PeriodSpending {
  /** Σ live expenses of the plan's space per category. */
  readonly byCategory: readonly { readonly categoryId: string; readonly amount: bigint }[];
  /** Σ live transfers into each account that a SAVINGS line names. */
  readonly byAccount: readonly { readonly accountId: string; readonly amount: bigint }[];
}

export interface CapacityFigure {
  readonly memberId: string;
  readonly amount: bigint;
  /** Basis points of total capacity (40.00 % = 4000); null without capacity. */
  readonly shareBasisPoints: number | null;
}

export interface AllocationFigure {
  readonly rule: AllocationRule;
  /** Every current member in join order; none on a NONE line. */
  readonly members: readonly {
    readonly memberId: string;
    /** The stored PERCENT basis points or FIXED minor units; null for PROPORTIONAL and members without one. */
    readonly value: bigint | null;
    /** Null on an invalid allocation. */
    readonly assigned: bigint | null;
  }[];
  /** HU-E6-05: InvalidAllocation, until the line is allocated again. */
  readonly invalid: boolean;
}

export interface LineFigure {
  readonly line: BudgetLine;
  readonly categoryIds: readonly string[];
  readonly capacityShareBasisPoints: number | null;
  readonly allocation: AllocationFigure;
  readonly spent: bigint;
  readonly available: bigint;
}

export interface PlanFigures {
  readonly capacities: readonly CapacityFigure[];
  readonly totalCapacity: bigint;
  readonly planned: bigint;
  /** Total capacity − Σ planned; negative once capacities were reduced below the lines (HU-E6-02). */
  readonly unallocated: bigint;
  readonly lines: readonly LineFigure[];
  /** HU-E6-04: the implicit line of unmapped spending; null when the plan has a catch-all line. */
  readonly unbudgeted: { readonly spent: bigint; readonly available: bigint } | null;
}

/** HU-E6-04: the line a category consumes: its mapped line, else the catch-all line, else Unbudgeted (null). */
export const lineForCategory = (categoryId: string, parts: Pick<PlanParts, "lines" | "mappings">): string | null =>
  parts.mappings.find((m) => m.categoryId === categoryId)?.lineId ??
  parts.lines.find((l) => l.isCatchAll)?.id ??
  null;

const allocationFigure = (
  line: BudgetLine,
  allocations: readonly LineAllocation[],
  members: readonly { readonly memberId: string; readonly capacity: bigint }[],
  currency: string,
): AllocationFigure => {
  if (line.allocationRule === "NONE") return { rule: "NONE", members: [], invalid: false };
  const values = allocations.filter((a) => a.lineId === line.id);
  const assigned = assignedAmounts(line, values, members, currency);
  const amounts = assigned.ok ? assigned.value : null;
  return {
    rule: line.allocationRule,
    members: members.map((m) => ({
      memberId: m.memberId,
      value: values.find((v) => v.memberId === m.memberId)?.value ?? null,
      assigned: amounts?.find((a) => a.memberId === m.memberId)?.amount ?? null,
    })),
    invalid: !assigned.ok,
  };
};

/**
 * HU-E6-02 … HU-E6-05, spec 5.4: every figure of a plan for its current members (`memberIds`, join order),
 * derived on read (D7). available = planned + carry-over − spent, and the carry-over is 0 until lines have an
 * origin (HU-E6-06, HU-E6-09).
 */
export const planFigures = (input: {
  readonly currency: string;
  readonly memberIds: readonly string[];
  readonly parts: PlanParts;
  readonly spending: PeriodSpending;
}): PlanFigures => {
  const { currency, memberIds, parts, spending } = input;
  const total = totalCapacity(parts.capacities, memberIds);
  const members = memberIds.map((memberId) => ({ memberId, capacity: capacityOf(parts.capacities, memberId) }));
  const spentOn = new Map<string | null, bigint>();
  for (const { categoryId, amount } of spending.byCategory) {
    const lineId = lineForCategory(categoryId, parts);
    spentOn.set(lineId, (spentOn.get(lineId) ?? 0n) + amount);
  }
  const transfersInto = (accountIds: readonly string[]) =>
    spending.byAccount.filter((a) => accountIds.includes(a.accountId)).reduce((sum, a) => sum + a.amount, 0n);
  const lines = parts.lines.map((line): LineFigure => {
    const spent = line.funding === "SAVINGS" ? transfersInto(line.savingsAccountIds) : (spentOn.get(line.id) ?? 0n);
    return {
      line,
      categoryIds: parts.mappings.filter((m) => m.lineId === line.id).map((m) => m.categoryId),
      capacityShareBasisPoints: shareOfTotal(line.plannedAmount, total),
      allocation: allocationFigure(line, parts.allocations, members, currency),
      spent,
      available: line.plannedAmount - spent,
    };
  });
  const planned = parts.lines.reduce((sum, line) => sum + line.plannedAmount, 0n);
  const unbudgeted = spentOn.get(null) ?? 0n;
  return {
    capacities: members.map((m) => ({
      memberId: m.memberId,
      amount: m.capacity,
      shareBasisPoints: shareOfTotal(m.capacity, total),
    })),
    totalCapacity: total,
    planned,
    unallocated: total - planned,
    lines,
    unbudgeted: parts.lines.some((l) => l.isCatchAll) ? null : { spent: unbudgeted, available: -unbudgeted },
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/domain`
Expected: PASS. Mutation check: temporarily replace `line.funding === "SAVINGS" ? transfersInto(line.savingsAccountIds) : (spentOn.get(line.id) ?? 0n)` with `(spentOn.get(line.id) ?? 0n)` — the golden spending test fails on Savings (0 instead of 20,000,000); restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/domain/plan-figures.ts src/modules/budgeting/domain/plan-figures.test.ts
git commit -m "feat(budgeting): derive capacity, assignments and spending of a plan on read (Refs #48, Refs #49, Refs #50, Refs #51)"
```

---

### Task 5: Budgeting schema — plans, capacities, lines, mappings and allocations (migration 0010)

Implements the storage of HU-E6-01 … HU-E6-05 (issues #47–#51). Pins Review Focus 6 at the database level (partial unique indexes over current rows only; removed and replaced rows stay).

Decisions:
- One migration for the whole module, so every later task works against a stable schema and `pnpm db:check` keeps reporting no drift after this task. Values of the text enums mirror the domain tuples and are listed in the schema file, so drizzle-kit loads no domain code (the convention of `spaces.schema.ts`).
- `budget_plans`: the stored period (`label`, `start_date`, `end_date`, D10), unique per `(space_id, start_date)` (HU-E6-01 note), `version` (ETag), `created_from_plan_id` (HU-E6-06), audit columns. `created_by` is a plain text user id like `transactions.created_by`.
- `budget_member_capacities`: one row per `(plan_id, member_id)`, edited in place (an edit, not a delete), never negative.
- `budget_lines`: `savings_account_ids uuid[]` (accounts are never deleted, D8, so no foreign key is lost), `allocation_rule` on the line (ruling P1), `origin_line_id` (HU-E6-09), `deleted_at` (D8). Partial unique indexes keep names (ignoring case) and the catch-all line unique among lines that are not deleted; checks pin "SAVINGS lines, and only they, name savings accounts", "never a SAVINGS catch-all" and "planned > 0".
- `budget_line_categories`: mapping history; `plan_id` is copied from the line so one partial unique index keeps a category on one current line per plan (`unmapped_at IS NULL`). Its index on `category_id` serves the HU-E3-03 reference check (Task 16).
- `budget_allocations`: value history per `(line_id, member_id)`; one current row each (`superseded_at IS NULL`), positive values (basis points or minor units).
- Mapping and allocation rows are technical rows without a domain identity: their ids default to `gen_random_uuid()` (`defaultRandom`).

**Files:**
- Create: `src/modules/budgeting/infrastructure/budgeting.schema.ts`, `src/modules/budgeting/infrastructure/budgeting-schema.int.test.ts`
- Generated: `drizzle/0010_budgeting.sql`, `drizzle/meta/0010_snapshot.json`, `drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: `spaces`, `spaceMembers` (`spaces.schema.ts`), `categories` (`categories.schema.ts`); `categoryFixture`, `guestMemberFixture`, `sharedSpaceFixture`, `userFixture` (`tests/support/fixtures.ts`).
- Produces: the Drizzle tables `budgetPlans`, `budgetMemberCapacities`, `budgetLines`, `budgetLineCategories`, `budgetAllocations` with the column names used by Tasks 6, 10, 12a, 15 and 17.

- [ ] **Step 1: Write the failing test**

`src/modules/budgeting/infrastructure/budgeting-schema.int.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabase } from "../../../../tests/support/database";
import {
  categoryFixture,
  guestMemberFixture,
  sharedSpaceFixture,
  userFixture,
} from "../../../../tests/support/fixtures";

const { db, pool } = testDatabase();

afterAll(() => pool.end());

const plan = (spaceId: string, label: string, start: string, end: string, id: string = randomUUID()) =>
  pool.query(
    `INSERT INTO budget_plans (id, space_id, label, start_date, end_date, status, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'DRAFT', 'u-ana', now(), now())`,
    [id, spaceId, label, start, end],
  );

interface LineOptions {
  readonly funding?: string;
  readonly accounts?: string[];
  readonly catchAll?: boolean;
  readonly deleted?: boolean;
  readonly planned?: string;
}
const line = (planId: string, name: string, o: LineOptions = {}, id: string = randomUUID()) =>
  pool.query(
    `INSERT INTO budget_lines (id, plan_id, name, planned_amount, funding, savings_account_ids, rollover_mode,
       is_catch_all, allocation_rule, created_at, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6::uuid[], 'RESET', $7, 'PROPORTIONAL', now(), now(), $8)`,
    [
      id,
      planId,
      name,
      o.planned ?? "100",
      o.funding ?? "DIRECT",
      o.accounts ?? [],
      o.catchAll ?? false,
      o.deleted ? new Date() : null,
    ],
  );

/** Household with Ana as OWNER and a DRAFT plan for 2026-11. */
const world = async () => {
  const ana = await userFixture(pool, "Ana");
  const space = await sharedSpaceFixture(db, ana.id);
  const fixture = { userId: ana.id, spaceId: space.id, memberId: space.members[0]!.id };
  const planId = randomUUID();
  await plan(space.id, "2026-11", "2026-11-01", "2026-11-30", planId);
  return { space, fixture, planId };
};

describe("budget_plans (HU-E6-01, D10)", () => {
  it("keeps one plan per period start in a space, with ordered boundaries", async () => {
    const { space } = await world();
    await expect(plan(space.id, "2026-11", "2026-11-01", "2026-11-30")).rejects.toThrow(
      /budget_plans_space_start_uq/,
    );
    await expect(plan(space.id, "2026-12", "2026-12-31", "2026-12-01")).rejects.toThrow(/budget_plans_dates/);
    const other = await sharedSpaceFixture(db, (await userFixture(pool, "Juan")).id);
    await expect(plan(other.id, "2026-11", "2026-11-01", "2026-11-30")).resolves.toBeDefined();
  });
});

describe("budget_member_capacities (HU-E6-02, D15)", () => {
  it("holds one non-negative capacity per member of a plan, guests included", async () => {
    const { fixture, planId } = await world();
    const pedro = await guestMemberFixture(pool, fixture, "Pedro");
    const capacity = (memberId: string, amount: string) =>
      pool.query(
        "INSERT INTO budget_member_capacities (plan_id, member_id, amount, updated_at) VALUES ($1, $2, $3, now())",
        [planId, memberId, amount],
      );
    await expect(capacity(pedro, "30000000")).resolves.toBeDefined();
    await expect(capacity(fixture.memberId, "-1")).rejects.toThrow(/budget_member_capacities_amount/);
    await expect(capacity(pedro, "1")).rejects.toThrow(/duplicate key/);
  });
});

describe("budget_lines (HU-E6-03, HU-E6-04, D8)", () => {
  it("keeps names unique ignoring case among lines that are not deleted", async () => {
    const { planId } = await world();
    await line(planId, "Home", { deleted: true });
    await expect(line(planId, "home")).resolves.toBeDefined();
    await expect(line(planId, "HOME")).rejects.toThrow(/budget_lines_plan_name_uq/);
  });

  it("allows one catch-all line per plan among lines that are not deleted", async () => {
    const { planId } = await world();
    await line(planId, "Old free", { catchAll: true, deleted: true });
    await line(planId, "Free", { catchAll: true });
    await expect(line(planId, "Other", { catchAll: true })).rejects.toThrow(/budget_lines_catch_all_uq/);
  });

  it("names savings accounts on SAVINGS lines and on no other, never makes them catch-all, plans positive amounts", async () => {
    const { planId } = await world();
    await expect(line(planId, "Savings", { funding: "SAVINGS" })).rejects.toThrow(/budget_lines_savings_accounts/);
    await expect(line(planId, "Home", { accounts: [randomUUID()] })).rejects.toThrow(
      /budget_lines_savings_accounts/,
    );
    await expect(
      line(planId, "Savings", { funding: "SAVINGS", accounts: [randomUUID()], catchAll: true }),
    ).rejects.toThrow(/budget_lines_savings_catch_all/);
    await expect(line(planId, "Gifts", { planned: "0" })).rejects.toThrow(/budget_lines_planned_positive/);
    await expect(line(planId, "Savings", { funding: "SAVINGS", accounts: [randomUUID()] })).resolves.toBeDefined();
  });
});

describe("budget_line_categories (HU-E6-04, D8)", () => {
  it("maps a category to one current line per plan; ended mappings stay and free it", async () => {
    const { fixture, planId } = await world();
    const [home, free] = [randomUUID(), randomUUID()];
    await line(planId, "Home", {}, home);
    await line(planId, "Free", {}, free);
    const groceries = await categoryFixture(db, fixture);
    const map = (lineId: string, ended = false) =>
      pool.query(
        "INSERT INTO budget_line_categories (plan_id, line_id, category_id, mapped_at, unmapped_at) VALUES ($1, $2, $3, now(), $4)",
        [planId, lineId, groceries, ended ? new Date() : null],
      );
    await map(home, true);
    await map(free);
    await expect(map(home)).rejects.toThrow(/budget_line_categories_current_uq/);
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM budget_line_categories WHERE category_id = $1",
      [groceries],
    );
    expect(rows[0].n).toBe(2);
  });
});

describe("budget_allocations (HU-E6-05, D8)", () => {
  it("holds one current positive value per member of a line; superseded values stay", async () => {
    const { fixture, planId } = await world();
    const free = randomUUID();
    await line(planId, "Free", {}, free);
    const value = (amount: string, superseded = false) =>
      pool.query(
        "INSERT INTO budget_allocations (line_id, member_id, rule, value, set_at, superseded_at) VALUES ($1, $2, 'PERCENT', $3, now(), $4)",
        [free, fixture.memberId, amount, superseded ? new Date() : null],
      );
    await value("4200", true);
    await value("10000");
    await expect(value("5000")).rejects.toThrow(/budget_allocations_current_uq/);
    await expect(value("0", true)).rejects.toThrow(/budget_allocations_value_positive/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project integration src/modules/budgeting/infrastructure/budgeting-schema.int.test.ts`
Expected: FAIL — `relation "budget_plans" does not exist` (and the same for the other tables).

- [ ] **Step 3: Write the schema**

`src/modules/budgeting/infrastructure/budgeting.schema.ts`:

```ts
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { categories } from "@/modules/categories/infrastructure/categories.schema";
import { spaceMembers, spaces } from "@/modules/spaces/infrastructure/spaces.schema";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => bigint(name, { mode: "bigint" });

// Spec 5.2, HU-E6-01 … HU-E6-05. Values mirror the domain types; listed here so drizzle-kit loads no domain code.
export const budgetPlans = pgTable(
  "budget_plans",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    // D10: the period is stored when the plan is created, so a later policy change never moves it.
    label: text("label").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    status: text("status", { enum: ["DRAFT", "ACTIVE", "CLOSED"] }).notNull(),
    // HU-E6-06: the plan this one was copied from.
    createdFromPlanId: uuid("created_from_plan_id").references((): AnyPgColumn => budgetPlans.id),
    // The ETag; every write to the plan or its parts bumps it under a row lock (spec 7).
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: tz("created_at").notNull(),
    updatedAt: tz("updated_at").notNull(),
  },
  (t) => [
    // HU-E6-01: one plan per period; stored periods never overlap (D10).
    uniqueIndex("budget_plans_space_start_uq").on(t.spaceId, t.startDate),
    index("budget_plans_created_from_idx").on(t.createdFromPlanId),
    check("budget_plans_dates", sql`${t.startDate} <= ${t.endDate}`),
  ],
);

export const budgetMemberCapacities = pgTable(
  "budget_member_capacities",
  {
    planId: uuid("plan_id")
      .notNull()
      .references(() => budgetPlans.id, { onDelete: "cascade" }),
    // D15: capacities point to a SpaceMember, registered or guest; members are never deleted.
    memberId: uuid("member_id")
      .notNull()
      .references(() => spaceMembers.id),
    amount: money("amount").notNull(),
    updatedAt: tz("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.planId, t.memberId] }),
    index("budget_member_capacities_member_idx").on(t.memberId),
    check("budget_member_capacities_amount", sql`${t.amount} >= 0`),
  ],
);

export const budgetLines = pgTable(
  "budget_lines",
  {
    id: uuid("id").primaryKey(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => budgetPlans.id, { onDelete: "cascade" }),
    // HU-E6-06, HU-E6-09: the line this one was copied from, for rollover.
    originLineId: uuid("origin_line_id").references((): AnyPgColumn => budgetLines.id),
    name: text("name").notNull(),
    plannedAmount: money("planned_amount").notNull(),
    funding: text("funding", { enum: ["DIRECT", "SHARED_FUND", "SAVINGS"] }).notNull(),
    // Spec 5.4: a SAVINGS line spends the transfers into these accounts (accounts are never deleted, D8).
    savingsAccountIds: uuid("savings_account_ids").array().notNull(),
    rolloverMode: text("rollover_mode", { enum: ["RESET", "ROLLOVER", "ADJUSTED"] }).notNull(),
    isCatchAll: boolean("is_catch_all").notNull(),
    // HU-E6-05: one rule per line; PERCENT and FIXED keep their member values in budget_allocations.
    allocationRule: text("allocation_rule", { enum: ["PROPORTIONAL", "PERCENT", "FIXED", "NONE"] }).notNull(),
    createdAt: tz("created_at").notNull(),
    updatedAt: tz("updated_at").notNull(),
    // D8: removing a line is logical; the row stays and every read skips it.
    deletedAt: tz("deleted_at"),
  },
  (t) => [
    index("budget_lines_plan_idx").on(t.planId),
    index("budget_lines_origin_idx").on(t.originLineId),
    // HU-E6-03: names are unique per plan ignoring case, among lines that are not deleted.
    uniqueIndex("budget_lines_plan_name_uq")
      .on(t.planId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
    // HU-E6-04: at most one catch-all line per plan.
    uniqueIndex("budget_lines_catch_all_uq")
      .on(t.planId)
      .where(sql`${t.isCatchAll} AND ${t.deletedAt} IS NULL`),
    check("budget_lines_planned_positive", sql`${t.plannedAmount} > 0`),
    // HU-E6-03: SAVINGS lines, and only they, name savings accounts.
    check(
      "budget_lines_savings_accounts",
      sql`(${t.funding} = 'SAVINGS') = (cardinality(${t.savingsAccountIds}) > 0)`,
    ),
    // Spec 5.4: a SAVINGS line consumes transfers, never the unmapped categories.
    check("budget_lines_savings_catch_all", sql`NOT (${t.funding} = 'SAVINGS' AND ${t.isCatchAll})`),
  ],
);

export const budgetLineCategories = pgTable(
  "budget_line_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Copied from the line, so one partial index keeps a category on one current line per plan.
    planId: uuid("plan_id")
      .notNull()
      .references(() => budgetPlans.id, { onDelete: "cascade" }),
    lineId: uuid("line_id")
      .notNull()
      .references(() => budgetLines.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    mappedAt: tz("mapped_at").notNull(),
    // D8: replacing a line's categories or removing the line ends a mapping; the row stays.
    unmappedAt: tz("unmapped_at"),
  },
  (t) => [
    // HU-E6-04: a category maps to at most one current line per plan.
    uniqueIndex("budget_line_categories_current_uq")
      .on(t.planId, t.categoryId)
      .where(sql`${t.unmappedAt} IS NULL`),
    index("budget_line_categories_line_idx").on(t.lineId),
    // HU-E3-03: deleting a category checks whether any plan maps or mapped it.
    index("budget_line_categories_category_idx").on(t.categoryId),
  ],
);

export const budgetAllocations = pgTable(
  "budget_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lineId: uuid("line_id")
      .notNull()
      .references(() => budgetLines.id, { onDelete: "cascade" }),
    // D15: allocations point to a SpaceMember, registered or guest.
    memberId: uuid("member_id")
      .notNull()
      .references(() => spaceMembers.id),
    rule: text("rule", { enum: ["PERCENT", "FIXED"] }).notNull(),
    // PERCENT: basis points (42 % = 4200); FIXED: minor units of the space currency.
    value: money("value").notNull(),
    setAt: tz("set_at").notNull(),
    // D8: allocating the line again supersedes these values; the rows stay.
    supersededAt: tz("superseded_at"),
  },
  (t) => [
    uniqueIndex("budget_allocations_current_uq")
      .on(t.lineId, t.memberId)
      .where(sql`${t.supersededAt} IS NULL`),
    index("budget_allocations_member_idx").on(t.memberId),
    check("budget_allocations_value_positive", sql`${t.value} > 0`),
  ],
);
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate --name budgeting`
Expected: `drizzle/0010_budgeting.sql` that creates the five tables with their foreign keys (`budget_plans.space_id` and every `plan_id`/`line_id` with `ON DELETE cascade`; `member_id` and `category_id` with `no action`; the two self references), the composite primary key of `budget_member_capacities`, the indexes `budget_plans_space_start_uq`, `budget_plans_created_from_idx`, `budget_member_capacities_member_idx`, `budget_lines_plan_idx`, `budget_lines_origin_idx`, `budget_lines_plan_name_uq … WHERE "budget_lines"."deleted_at" IS NULL`, `budget_lines_catch_all_uq … WHERE "budget_lines"."is_catch_all" AND "budget_lines"."deleted_at" IS NULL`, `budget_line_categories_current_uq … WHERE "budget_line_categories"."unmapped_at" IS NULL`, `budget_line_categories_line_idx`, `budget_line_categories_category_idx`, `budget_allocations_current_uq … WHERE "budget_allocations"."superseded_at" IS NULL`, `budget_allocations_member_idx`, and the checks `budget_plans_dates`, `budget_member_capacities_amount`, `budget_lines_planned_positive`, `budget_lines_savings_accounts`, `budget_lines_savings_catch_all`, `budget_allocations_value_positive`; `drizzle/meta/0010_snapshot.json`; a `0010_budgeting` journal entry. Nothing is renamed, so drizzle-kit asks no questions; if it prompts, answer "create" for every new entity.

- [ ] **Step 5: Verify migrations, drift and the new test**

Run: `pnpm db:check && pnpm exec vitest run --project integration`
Expected: "No schema drift" and PASS for the whole integration project, including `budgeting-schema.int.test.ts` and `migrations.int.test.ts` (which counts the journal's eleven entries).

- [ ] **Step 6: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0 (`schemas-only-reference-schemas` holds: the schema imports only other `*.schema.ts` files).

- [ ] **Step 7: Commit**

```bash
git add src/modules/budgeting/infrastructure/budgeting.schema.ts src/modules/budgeting/infrastructure/budgeting-schema.int.test.ts drizzle/0010_budgeting.sql drizzle/meta/0010_snapshot.json drizzle/meta/_journal.json
git commit -m "feat(budgeting): store plans, capacities, lines, mappings and allocations with migration 0010 (Refs #47, Refs #48, Refs #49, Refs #50, Refs #51)"
```

---

### Task 6: Budgeting persistence — plans, their parts and the version lock

Implements the plan repository of HU-E6-01 (issue #47) and the version lock that every plan write uses (spec 7). Pins Review Focus 1 (a second plan for one start date stores nothing) and Review Focus 5 (malformed and foreign plan ids).

Decisions:
- `BudgetPlanRepository` reads and creates plans: `add` answers false when the space already has a plan starting that day (`ON CONFLICT (space_id, start_date) DO NOTHING`), so a concurrent creation becomes `PlanAlreadyExists` instead of a `500` (Task 8); `find` scopes by space and guards both ids with `isUuid`; `storedPeriods` lists the space's stored periods oldest first (D10); `hasPlans` serves the currency lock (Task 9b).
- `lockForWrite(planId, expectedVersion, at)` is `UPDATE … SET version = version + 1 … RETURNING version`, with `AND version = $expected` when `If-Match` was sent: the updated row stays locked until the transaction ends, so writes to one plan run one at a time, and each reads the plan's parts only after it holds the lock (Task 8). It answers null for a stale version.
- `contents(planId)` reads the plan's parts in a fixed order that the twin mirrors: capacities by member id; lines that are not deleted by `created_at`, then id; current mappings by line, then category; current allocation values of those lines by line, then member.
- The in-memory twin keeps every row with its history (`deletedAt`, `unmappedAt`, `supersededAt`) and has a `seed` for use-case tests; the integration test runs one sequence against both and compares the outcomes.

**Files:**
- Create: `src/modules/budgeting/application/ports.ts`, `src/modules/budgeting/application/index.ts`, `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.ts`, `tests/support/in-memory-budgeting.ts`
- Test: `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts`

**Interfaces:**
- Consumes: the tables of Task 5; `BudgetPlan`, `BudgetPlanId`, `PLAN_STATUSES` (Task 1); `MemberCapacity` (Task 1); `BudgetLine`, `BudgetLineId`, `CategoryMapping` and the tuples (Task 2); `AllocationInput`, `AllocationValue`, `LineAllocation` (Task 3); `PlanParts` and the figure types (Task 4); `DrizzleTransactionManager`; `categoryFixture`, `sharedSpaceFixture`, `userFixture`.
- Produces:
  - `type PlanContents = PlanParts`
  - `interface BudgetPlanRepository { add(plan: BudgetPlan): Promise<boolean>; find(spaceId: string, planId: string): Promise<BudgetPlan | null>; storedPeriods(spaceId: string): Promise<StoredPeriod[]>; hasPlans(spaceId: string): Promise<boolean>; lockForWrite(planId: BudgetPlanId, expectedVersion: number | null, at: Date): Promise<number | null>; contents(planId: BudgetPlanId): Promise<PlanContents> }`
  - `src/modules/budgeting/application/index.ts` re-exporting the domain tuples and types listed below, `BudgetPlanRepository` and `PlanContents`
  - `class DrizzleBudgetPlanRepository implements BudgetPlanRepository` (constructor `(tm: DrizzleTransactionManager)`)
  - `class InMemoryBudgetPlans implements BudgetPlanRepository` with public `plans`, `capacities: Map<string, MemberCapacity[]>`, `lines: { line; deletedAt }[]`, `mappings: { planId; mapping; mappedAt; unmappedAt }[]`, `allocations: { allocation; setAt; supersededAt }[]` and `seed(planId: string, parts: Partial<PlanContents>): void` — `tests/support/in-memory-budgeting.ts`

- [ ] **Step 1: Write the port, the public API, the twin and the failing test**

`src/modules/budgeting/application/ports.ts`:

```ts
import type { StoredPeriod } from "@/shared/kernel";
import type { BudgetPlan, BudgetPlanId } from "../domain/plan";
import type { PlanParts } from "../domain/plan-figures";

/** A plan's capacities, lines that are not deleted, current category mappings and current allocation values. */
export type PlanContents = PlanParts;

/** HU-E6-01: plans and the version lock every write to a plan takes (spec 7). */
export interface BudgetPlanRepository {
  /** Stores a new plan; false when the space already has a plan starting that day (a concurrent creation). */
  add(plan: BudgetPlan): Promise<boolean>;
  /** A plan of the space; null for unknown or malformed ids and for another space's plan. */
  find(spaceId: string, planId: string): Promise<BudgetPlan | null>;
  /** D10: the stored boundaries of the space's plans, oldest first; `[]` for malformed ids. */
  storedPeriods(spaceId: string): Promise<StoredPeriod[]>;
  /** D6, HU-E1-03: whether the space has a plan, whose amounts are in the space currency. */
  hasPlans(spaceId: string): Promise<boolean>;
  /**
   * Starts a write: bumps the version and keeps the plan row locked until the transaction ends, so writes to one
   * plan run one at a time on committed data. Null when `expectedVersion` is given and is not current (If-Match).
   */
  lockForWrite(planId: BudgetPlanId, expectedVersion: number | null, at: Date): Promise<number | null>;
  /** Capacities by member; lines that are not deleted in creation order; current mappings and values by line. */
  contents(planId: BudgetPlanId): Promise<PlanContents>;
}
```

`src/modules/budgeting/application/index.ts`:

```ts
export { PLAN_STATUSES, type BudgetPlan, type BudgetPlanId, type PlanStatus } from "../domain/plan";
export type { MemberCapacity } from "../domain/capacity";
export {
  ALLOCATION_RULES,
  FUNDINGS,
  ROLLOVER_MODES,
  type AllocationRule,
  type BudgetLine,
  type BudgetLineId,
  type CategoryMapping,
  type Funding,
  type RolloverMode,
} from "../domain/budget-line";
export type { AllocationInput, AllocationValue, LineAllocation } from "../domain/allocation";
export type {
  AllocationFigure,
  CapacityFigure,
  LineFigure,
  PeriodSpending,
  PlanFigures,
  PlanParts,
} from "../domain/plan-figures";
export type { BudgetPlanRepository, PlanContents } from "./ports";
```

`tests/support/in-memory-budgeting.ts`:

```ts
import type {
  BudgetLine,
  BudgetPlan,
  BudgetPlanRepository,
  CategoryMapping,
  LineAllocation,
  MemberCapacity,
  PlanContents,
} from "@/modules/budgeting/application";
import type { StoredPeriod } from "@/shared/kernel";

const SEEDED = new Date("2026-10-14T12:00:00Z");
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Plans and their parts with their whole history; mirrors DrizzleBudgetPlanRepository (pinned by its integration tests). */
export class InMemoryBudgetPlans implements BudgetPlanRepository {
  plans: BudgetPlan[] = [];
  /** Current capacities per plan id, edited in place like budget_member_capacities. */
  readonly capacities = new Map<string, MemberCapacity[]>();
  /** Every line ever added, with its deletion time (D8: rows stay). */
  lines: { line: BudgetLine; deletedAt: Date | null }[] = [];
  /** Every mapping ever made; current ones have unmappedAt null. */
  mappings: { planId: string; mapping: CategoryMapping; mappedAt: Date; unmappedAt: Date | null }[] = [];
  /** Every allocation value ever set; current ones have supersededAt null. */
  allocations: { allocation: LineAllocation; setAt: Date; supersededAt: Date | null }[] = [];

  async add(plan: BudgetPlan): Promise<boolean> {
    if (this.plans.some((p) => p.spaceId === plan.spaceId && p.period.start === plan.period.start)) return false;
    this.plans.push(plan);
    return true;
  }

  async find(spaceId: string, planId: string): Promise<BudgetPlan | null> {
    return this.plans.find((p) => p.spaceId === spaceId && p.id === planId) ?? null;
  }

  async storedPeriods(spaceId: string): Promise<StoredPeriod[]> {
    return this.plans
      .filter((p) => p.spaceId === spaceId)
      .map((p) => p.period)
      .sort((a, b) => compare(a.start, b.start));
  }

  async hasPlans(spaceId: string): Promise<boolean> {
    return this.plans.some((p) => p.spaceId === spaceId);
  }

  async lockForWrite(planId: string, expectedVersion: number | null): Promise<number | null> {
    const plan = this.plans.find((p) => p.id === planId);
    if (!plan || (expectedVersion !== null && plan.version !== expectedVersion)) return null;
    const version = plan.version + 1;
    this.plans = this.plans.map((p) => (p.id === planId ? { ...p, version } : p));
    return version;
  }

  async contents(planId: string): Promise<PlanContents> {
    const lines = this.lines
      .filter((r) => r.line.planId === planId && r.deletedAt === null)
      .map((r) => r.line)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || compare(a.id, b.id));
    const lineIds = new Set<string>(lines.map((l) => l.id));
    return {
      capacities: [...(this.capacities.get(planId) ?? [])].sort((a, b) => compare(a.memberId, b.memberId)),
      lines,
      mappings: this.mappings
        .filter((r) => r.planId === planId && r.unmappedAt === null)
        .map((r) => r.mapping)
        .sort((a, b) => compare(a.lineId, b.lineId) || compare(a.categoryId, b.categoryId)),
      allocations: this.allocations
        .filter((r) => lineIds.has(r.allocation.lineId) && r.supersededAt === null)
        .map((r) => r.allocation)
        .sort((a, b) => compare(a.lineId, b.lineId) || compare(a.memberId, b.memberId)),
    };
  }

  /** Test setup: parts of a plan as earlier writes would have left them. */
  seed(planId: string, parts: Partial<PlanContents>): void {
    this.mergeCapacities(planId, parts.capacities ?? []);
    for (const line of parts.lines ?? []) this.lines.push({ line: { ...line, planId }, deletedAt: null });
    for (const mapping of parts.mappings ?? []) this.mappings.push({ planId, mapping, mappedAt: SEEDED, unmappedAt: null });
    for (const allocation of parts.allocations ?? []) {
      this.allocations.push({ allocation, setAt: SEEDED, supersededAt: null });
    }
  }

  private mergeCapacities(planId: string, capacities: readonly MemberCapacity[]): void {
    const kept = (this.capacities.get(planId) ?? []).filter((c) => !capacities.some((n) => n.memberId === c.memberId));
    this.capacities.set(planId, [...kept, ...capacities]);
  }
}
```

`src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { categoryFixture, sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";
import { InMemoryBudgetPlans } from "../../../../tests/support/in-memory-budgeting";
import type { BudgetPlanRepository } from "../application/ports";
import type { BudgetPlan, BudgetPlanId } from "../domain/plan";
import { DrizzleBudgetPlanRepository } from "./drizzle-budget-plan-repository";

const { db, pool } = testDatabase();
const repo = new DrizzleBudgetPlanRepository(new DrizzleTransactionManager(db));
const at = new Date("2026-10-14T12:00:00Z");

afterAll(() => pool.end());

const household = async () => {
  const ana = await userFixture(pool, "Ana");
  const space = await sharedSpaceFixture(db, ana.id);
  return { space, fixture: { userId: ana.id, spaceId: space.id, memberId: space.members[0]!.id } };
};

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

describe("DrizzleBudgetPlanRepository plans (HU-E6-01, D10)", () => {
  it("adds, finds, lists stored periods and locks versions like its in-memory twin", async () => {
    const { space } = await household();
    const november = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    const october = aPlan(space.id, "2026-10", "2026-10-01", "2026-10-31");
    const sameStart = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    const run = async (plans: BudgetPlanRepository) => ({
      added: [await plans.add(november), await plans.add(october), await plans.add(sameStart)],
      found: await plans.find(space.id, november.id),
      foreign: await plans.find(randomUUID(), november.id),
      malformed: await plans.find(space.id, "not-a-uuid"),
      stored: await plans.storedPeriods(space.id),
      hasPlans: [await plans.hasPlans(space.id), await plans.hasPlans(randomUUID())],
      versions: [
        await plans.lockForWrite(november.id, null, at),
        await plans.lockForWrite(november.id, 2, at),
        await plans.lockForWrite(november.id, 2, at),
      ],
      after: (await plans.find(space.id, november.id))?.version,
      contents: await plans.contents(november.id),
    });
    const expected = {
      added: [true, true, false],
      found: november,
      foreign: null,
      malformed: null,
      stored: [october.period, november.period],
      hasPlans: [true, false],
      versions: [2, 3, null],
      after: 3,
      contents: { capacities: [], lines: [], mappings: [], allocations: [] },
    };
    expect(await run(new InMemoryBudgetPlans())).toEqual(expected);
    expect(await run(repo)).toEqual(expected);
    const { rows } = await pool.query("SELECT updated_at FROM budget_plans WHERE id = $1", [november.id]);
    expect(rows[0].updated_at).toEqual(at);
  });

  it("reads a plan's parts without deleted lines, ended mappings or superseded values", async () => {
    const { space, fixture } = await household();
    const november = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    await repo.add(november);
    const [home, savings, gone, account] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const later = new Date("2026-10-14T12:05:00Z");
    const groceries = await categoryFixture(db, fixture);
    await pool.query(
      "INSERT INTO budget_member_capacities (plan_id, member_id, amount, updated_at) VALUES ($1, $2, 160000000, now())",
      [november.id, fixture.memberId],
    );
    const line = (id: string, name: string, values: string, createdAt: Date, deletedAt: Date | null) =>
      pool.query(
        `INSERT INTO budget_lines (id, plan_id, name, planned_amount, funding, savings_account_ids, rollover_mode,
           is_catch_all, allocation_rule, created_at, updated_at, deleted_at)
         VALUES ($1, $2, $3, ${values}, $4, $4, $5)`,
        [id, november.id, name, createdAt, deletedAt],
      );
    await line(savings, "Savings", `60000000, 'SAVINGS', '{${account}}', 'RESET', false, 'PROPORTIONAL'`, later, null);
    await line(home, "Home", "147000000, 'DIRECT', '{}', 'ROLLOVER', true, 'FIXED'", at, null);
    await line(gone, "Gone", "100, 'DIRECT', '{}', 'RESET', false, 'PROPORTIONAL'", at, at);
    await pool.query(
      `INSERT INTO budget_line_categories (plan_id, line_id, category_id, mapped_at, unmapped_at)
       VALUES ($1, $2, $3, now(), now()), ($1, $4, $3, now(), NULL)`,
      [november.id, gone, groceries, home],
    );
    await pool.query(
      `INSERT INTO budget_allocations (line_id, member_id, rule, value, set_at, superseded_at)
       VALUES ($1, $2, 'FIXED', 1, now(), now()), ($1, $2, 'FIXED', 147000000, now(), NULL)`,
      [home, fixture.memberId],
    );
    expect(await repo.contents(november.id)).toEqual({
      capacities: [{ memberId: fixture.memberId, amount: 160_000_000n }],
      lines: [
        {
          id: home,
          planId: november.id,
          originLineId: null,
          name: "Home",
          plannedAmount: 147_000_000n,
          funding: "DIRECT",
          savingsAccountIds: [],
          rolloverMode: "ROLLOVER",
          isCatchAll: true,
          allocationRule: "FIXED",
          createdAt: at,
        },
        {
          id: savings,
          planId: november.id,
          originLineId: null,
          name: "Savings",
          plannedAmount: 60_000_000n,
          funding: "SAVINGS",
          savingsAccountIds: [account],
          rolloverMode: "RESET",
          isCatchAll: false,
          allocationRule: "PROPORTIONAL",
          createdAt: later,
        },
      ],
      mappings: [{ lineId: home, categoryId: groceries }],
      allocations: [{ lineId: home, memberId: fixture.memberId, value: 147_000_000n }],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project integration src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts`
Expected: FAIL — `Failed to resolve import "./drizzle-budget-plan-repository"`.

- [ ] **Step 3: Implement the PostgreSQL adapter**

`src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.ts`:

```ts
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid, type LocalDate, type StoredPeriod } from "@/shared/kernel";
import type { BudgetPlanRepository, PlanContents } from "../application/ports";
import type { BudgetLine, BudgetLineId } from "../domain/budget-line";
import type { BudgetPlan, BudgetPlanId } from "../domain/plan";
import {
  budgetAllocations,
  budgetLineCategories,
  budgetLines,
  budgetMemberCapacities,
  budgetPlans,
} from "./budgeting.schema";

const toPlan = (row: typeof budgetPlans.$inferSelect): BudgetPlan => ({
  id: row.id as BudgetPlanId,
  spaceId: row.spaceId,
  period: { label: row.label, start: row.startDate as LocalDate, end: row.endDate as LocalDate },
  status: row.status,
  createdFrom: row.createdFromPlanId as BudgetPlanId | null,
  version: row.version,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
});

const toLine = (row: typeof budgetLines.$inferSelect): BudgetLine => ({
  id: row.id as BudgetLineId,
  planId: row.planId,
  originLineId: row.originLineId,
  name: row.name,
  plannedAmount: row.plannedAmount,
  funding: row.funding,
  savingsAccountIds: row.savingsAccountIds,
  rolloverMode: row.rolloverMode,
  isCatchAll: row.isCatchAll,
  allocationRule: row.allocationRule,
  createdAt: row.createdAt,
});

/** Plans and their parts (D7: figures are derived on read; D8: nothing is deleted). */
export class DrizzleBudgetPlanRepository implements BudgetPlanRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async add(plan: BudgetPlan): Promise<boolean> {
    const inserted = await this.tm
      .executor()
      .insert(budgetPlans)
      .values({
        id: plan.id,
        spaceId: plan.spaceId,
        label: plan.period.label,
        startDate: plan.period.start,
        endDate: plan.period.end,
        status: plan.status,
        createdFromPlanId: plan.createdFrom,
        version: plan.version,
        createdBy: plan.createdBy,
        createdAt: plan.createdAt,
        updatedAt: plan.createdAt,
      })
      // HU-E6-01: a concurrent creation of the same period stores nothing; the caller answers PlanAlreadyExists.
      .onConflictDoNothing({ target: [budgetPlans.spaceId, budgetPlans.startDate] })
      .returning({ id: budgetPlans.id });
    return inserted.length > 0;
  }

  async find(spaceId: string, planId: string): Promise<BudgetPlan | null> {
    // Ids come from URLs; anything that is not a UUID would fail the uuid cast.
    if (!isUuid(spaceId) || !isUuid(planId)) return null;
    const [row] = await this.tm
      .executor()
      .select()
      .from(budgetPlans)
      .where(and(eq(budgetPlans.id, planId), eq(budgetPlans.spaceId, spaceId)))
      .limit(1);
    return row ? toPlan(row) : null;
  }

  async storedPeriods(spaceId: string): Promise<StoredPeriod[]> {
    if (!isUuid(spaceId)) return [];
    const rows = await this.tm
      .executor()
      .select({ label: budgetPlans.label, start: budgetPlans.startDate, end: budgetPlans.endDate })
      .from(budgetPlans)
      .where(eq(budgetPlans.spaceId, spaceId))
      .orderBy(asc(budgetPlans.startDate));
    return rows.map((r) => ({ label: r.label, start: r.start as LocalDate, end: r.end as LocalDate }));
  }

  async hasPlans(spaceId: string): Promise<boolean> {
    if (!isUuid(spaceId)) return false;
    const rows = await this.tm
      .executor()
      .select({ id: budgetPlans.id })
      .from(budgetPlans)
      .where(eq(budgetPlans.spaceId, spaceId))
      .limit(1);
    return rows.length > 0;
  }

  async lockForWrite(planId: BudgetPlanId, expectedVersion: number | null, at: Date): Promise<number | null> {
    // The UPDATE keeps the row locked until the transaction ends: concurrent writers of this plan wait here.
    const [row] = await this.tm
      .executor()
      .update(budgetPlans)
      .set({ version: sql`${budgetPlans.version} + 1`, updatedAt: at })
      .where(
        and(
          eq(budgetPlans.id, planId),
          expectedVersion === null ? undefined : eq(budgetPlans.version, expectedVersion),
        ),
      )
      .returning({ version: budgetPlans.version });
    return row?.version ?? null;
  }

  async contents(planId: BudgetPlanId): Promise<PlanContents> {
    const db = this.tm.executor();
    const capacities = await db
      .select({ memberId: budgetMemberCapacities.memberId, amount: budgetMemberCapacities.amount })
      .from(budgetMemberCapacities)
      .where(eq(budgetMemberCapacities.planId, planId))
      .orderBy(asc(budgetMemberCapacities.memberId));
    const lineRows = await db
      .select()
      .from(budgetLines)
      .where(and(eq(budgetLines.planId, planId), isNull(budgetLines.deletedAt)))
      .orderBy(asc(budgetLines.createdAt), asc(budgetLines.id));
    const mappings = await db
      .select({ lineId: budgetLineCategories.lineId, categoryId: budgetLineCategories.categoryId })
      .from(budgetLineCategories)
      .where(and(eq(budgetLineCategories.planId, planId), isNull(budgetLineCategories.unmappedAt)))
      .orderBy(asc(budgetLineCategories.lineId), asc(budgetLineCategories.categoryId));
    const lineIds = lineRows.map((row) => row.id);
    const allocations =
      lineIds.length === 0
        ? []
        : await db
            .select({
              lineId: budgetAllocations.lineId,
              memberId: budgetAllocations.memberId,
              value: budgetAllocations.value,
            })
            .from(budgetAllocations)
            .where(and(inArray(budgetAllocations.lineId, lineIds), isNull(budgetAllocations.supersededAt)))
            .orderBy(asc(budgetAllocations.lineId), asc(budgetAllocations.memberId));
    return { capacities, lines: lineRows.map(toLine), mappings, allocations };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project integration src/modules/budgeting/infrastructure`
Expected: PASS (both files). Mutation check: temporarily remove `.onConflictDoNothing({ target: [budgetPlans.spaceId, budgetPlans.startDate] })` — the first test fails with `budget_plans_space_start_uq` instead of answering false; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (the twin in `tests/support` is outside `src`, so the boundary rules do not apply to it).

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/application/ports.ts src/modules/budgeting/application/index.ts src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.ts src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts tests/support/in-memory-budgeting.ts
git commit -m "feat(budgeting): store plans and lock them for writes in PostgreSQL (Refs #47)"
```

---

### Task 7: Ledger — spending queries for plans

Implements the spending side of HU-E6-03 and HU-E6-04 (issues #49, #50; spec 5.4): what each line of a plan has consumed in the plan's period, computed on read (D7).

Decisions:
- The ledger owns the sums; budgeting reads them through its `PlanSpending` port (Task 8), which `DrizzleLedgerQueries` satisfies structurally, like `CategoryUsage` and `AccountMovements` before it. The ledger never learns about plans: budgeting maps categories and accounts to lines.
- `expensesByCategory(spaceId, from, to)`: Σ live `EXPENSE` amounts of the space dated within the range, grouped by category (every expense has one, `transactions_shape`), member-paid and fund-paid alike (SHARED_FUND lines consume fund-paid expenses, spec 5.3 table).
- `transfersIntoAccounts(accountIds, from, to)`: Σ live `TRANSFER` amounts into each listed account, whatever space recorded them (a savings account lives in its owner's personal space, while the SAVINGS line may be Household's). Fund contributions are transfers into SHARED_FUND accounts, which a SAVINGS line never names.
- Both guard ids with `isUuid` and return rows ordered by id, absent rows for nothing spent.

**Files:**
- Modify: `src/modules/ledger/infrastructure/drizzle-ledger-queries.ts`
- Test: `src/modules/ledger/infrastructure/drizzle-ledger-queries.int.test.ts`

**Interfaces:**
- Consumes: `transactions` (`ledger.schema.ts`); the test file's `world`, `expense`, `income`, `transfer`, `store`, `softDelete` helpers (M1).
- Produces: `DrizzleLedgerQueries.expensesByCategory(spaceId: string, from: LocalDate, to: LocalDate): Promise<{ categoryId: string; amount: bigint }[]>`; `DrizzleLedgerQueries.transfersIntoAccounts(accountIds: readonly string[], from: LocalDate, to: LocalDate): Promise<{ accountId: string; amount: bigint }[]>`.

- [ ] **Step 1: Write the failing test**

Append to `src/modules/ledger/infrastructure/drizzle-ledger-queries.int.test.ts`:

```ts

describe("spending of a plan's period (HU-E6-03, HU-E6-04, spec 5.4)", () => {
  const from = "2026-11-01" as LocalDate;
  const to = "2026-11-30" as LocalDate;

  it("sums the live expenses of one space per category within the dates", async () => {
    const w = await world();
    const elsewhere = await world();
    await store(
      expense(w, "2026-11-01", 8_500_000n),
      expense(w, "2026-11-30", 10_000_000n),
      expense(w, "2026-11-15", 6_000_000n, { categoryId: w.restaurants }),
      expense(w, "2026-10-31", 1_000_000n),
      expense(w, "2026-12-01", 2_000_000n),
      income(w, "2026-11-25", 320_000_000n),
      softDelete(expense(w, "2026-11-20", 4_000_000n), new Date()),
      expense(elsewhere, "2026-11-10", 7_000_000n),
    );
    const expected = [
      { categoryId: w.groceries, amount: 18_500_000n },
      { categoryId: w.restaurants, amount: 6_000_000n },
    ].sort((a, b) => (a.categoryId < b.categoryId ? -1 : 1));
    expect(await queries.expensesByCategory(w.space.spaceId, from, to)).toEqual(expected);
    expect(await queries.expensesByCategory("not-a-uuid", from, to)).toEqual([]);
  });

  it("sums the live transfers into each account within the dates, whatever space recorded them", async () => {
    const w = await world();
    await store(
      transfer(w, "2026-11-05", 20_000_000n),
      transfer(w, "2026-11-28", 5_000_000n),
      transfer(w, "2026-12-01", 9_000_000n),
      softDelete(transfer(w, "2026-11-06", 3_000_000n), new Date()),
      expense(w, "2026-11-07", 1_000_000n),
    );
    expect(await queries.transfersIntoAccounts([w.wallet, w.bank, "not-a-uuid"], from, to)).toEqual([
      { accountId: w.wallet, amount: 25_000_000n },
    ]);
    expect(await queries.transfersIntoAccounts([], from, to)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project integration src/modules/ledger/infrastructure/drizzle-ledger-queries.int.test.ts`
Expected: FAIL — `queries.expensesByCategory is not a function` and `queries.transfersIntoAccounts is not a function`.

- [ ] **Step 3: Implement**

In `src/modules/ledger/infrastructure/drizzle-ledger-queries.ts`:

1. Insert before the line `  between,` (the second line of the `drizzle-orm` import list):

```ts
  asc,
```

2. Insert before the line `  private matching(f: TransactionFilter) {`:

```ts
  /** Spec 5.4, HU-E6-04: Σ live expenses of the space per category within [from, to], for budget lines (D7). */
  async expensesByCategory(
    spaceId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<{ categoryId: string; amount: bigint }[]> {
    if (!isUuid(spaceId)) return [];
    const rows = await this.tm
      .executor()
      .select({ categoryId: transactions.categoryId, total: sumAsText(transactions.amount) })
      .from(transactions)
      .where(
        and(
          eq(transactions.spaceId, spaceId),
          eq(transactions.type, "EXPENSE"),
          isNull(transactions.deletedAt),
          between(transactions.date, from, to),
        ),
      )
      .groupBy(transactions.categoryId)
      .orderBy(asc(transactions.categoryId));
    return rows.flatMap((row) =>
      row.categoryId === null ? [] : [{ categoryId: row.categoryId, amount: BigInt(row.total) }],
    );
  }

  /**
   * Spec 5.4, HU-E6-03: Σ live transfers into each account within [from, to], for SAVINGS lines. Not scoped to a
   * space: a savings account lives in its owner's personal space while the line may belong to a shared space.
   */
  async transfersIntoAccounts(
    accountIds: readonly string[],
    from: LocalDate,
    to: LocalDate,
  ): Promise<{ accountId: string; amount: bigint }[]> {
    const ids = accountIds.filter(isUuid);
    if (ids.length === 0) return [];
    const rows = await this.tm
      .executor()
      .select({ accountId: transactions.destinationAccountId, total: sumAsText(transactions.amount) })
      .from(transactions)
      .where(
        and(
          eq(transactions.type, "TRANSFER"),
          isNull(transactions.deletedAt),
          between(transactions.date, from, to),
          inArray(transactions.destinationAccountId, ids),
        ),
      )
      .groupBy(transactions.destinationAccountId)
      .orderBy(asc(transactions.destinationAccountId));
    return rows.flatMap((row) =>
      row.accountId === null ? [] : [{ accountId: row.accountId, amount: BigInt(row.total) }],
    );
  }

```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project integration src/modules/ledger/infrastructure`
Expected: PASS, M1's list, totals and movements tests included.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/infrastructure/drizzle-ledger-queries.ts src/modules/ledger/infrastructure/drizzle-ledger-queries.int.test.ts
git commit -m "feat(ledger): sum a period's expenses per category and transfers per account for budget plans (Refs #49, Refs #50)"
```

---

### Task 8: Budgeting application — CreateBudgetPlan, GetBudgetPlan and the plan write helper

Implements HU-E6-01 (issue #47) at the use-case level and the authorization of every M3-A use case. Pins Review Focus 4 (a plan after a policy change starts after the stored one) and Review Focus 5 (another space's plan, archived spaces).

Decisions:
- Two matrix actions join `src/modules/spaces/domain/permissions.ts`: `plan.manage` (OWNER, ADMIN; HU-E6-01 "Member cannot create plans") and `capacity.setOwn` (OWNER, ADMIN, MEMBER; D17 "when a registered member sets their own capacity", ruling P2). VIEWER only reads.
- `CreateBudgetPlan` authorizes `plan.manage` (archived spaces refuse it, HU-E1-09), resolves the label with `periodByLabel` over the space's stored plan periods (a semi-monthly space names halves, "2026-11 H1"), opens the plan (Task 1) and stores it; a concurrent creation that loses the unique index answers `PlanAlreadyExists` too (Task 13).
- `GetBudgetPlan` authorizes `space.read` (any role, archived spaces included) and answers `BudgetPlanNotFound` for a plan that is not the space's.
- `loadPlanView` derives every figure (Task 4) from the plan's parts, the space's current members and the ledger's spending within the plan's stored dates; it asks for transfers only when a SAVINGS line names accounts.
- `planForWrite` is the one entry of every plan write (Tasks 10, 12a, 12b, 15, 17): membership without `readOnly` (so an archived space answers `SpaceArchived`), the matrix (`managePlan` unless a use case passes its own rule), the plan, then `lockForWrite` (`PreconditionFailed` on a stale `If-Match`), and only then the members and parts, so concurrent writes to one plan see each other's committed work (Task 13). An `Err` rolls the version bump back with the rest of the transaction.

**Files:**
- Create: `src/modules/budgeting/application/deps.ts`, `src/modules/budgeting/application/plan-view.ts`, `src/modules/budgeting/application/plan-access.ts`, `src/modules/budgeting/application/create-budget-plan.ts`, `src/modules/budgeting/application/get-budget-plan.ts`, `tests/support/budgeting-world.ts`
- Modify: `src/modules/spaces/domain/permissions.ts`, `src/modules/budgeting/application/ports.ts`, `src/modules/budgeting/application/index.ts`
- Test: `src/modules/budgeting/application/plans.test.ts`, `src/modules/spaces/domain/permissions.test.ts`

**Interfaces:**
- Consumes: `openPlan` (Task 1), `planFigures` (Task 4), `BudgetPlanRepository`, `PlanContents`, `InMemoryBudgetPlans` (Task 6); `authorizeSpaceAction`, `requirePermission`, `createSpaceAccess`, `SpaceAccess`, `SpaceMember`, `SpaceMemberRepository`, `SpaceMembership` (`@/modules/spaces/application`); `periodByLabel` (kernel); `InMemorySpaceStore`, `householdSpace`, `memberOf` (`tests/support/in-memory-spaces.ts`); `referenceLines` (Task 2).
- Produces:
  - matrix actions `"plan.manage"` and `"capacity.setOwn"`
  - `interface PlanSpending { expensesByCategory(spaceId: string, from: LocalDate, to: LocalDate): Promise<{ categoryId: string; amount: bigint }[]>; transfersIntoAccounts(accountIds: readonly string[], from: LocalDate, to: LocalDate): Promise<{ accountId: string; amount: bigint }[]> }`
  - `interface BudgetingDeps { access: SpaceAccess; members: Pick<SpaceMemberRepository, "listCurrent">; plans: BudgetPlanRepository; spending: PlanSpending; ids: IdGenerator; clock: Clock; tm: TransactionManager }`
  - `interface BudgetPlanView { plan: BudgetPlan; currency: string; figures: PlanFigures }`; `loadPlanView(deps, space: SpaceMembership, plan: BudgetPlan): Promise<BudgetPlanView>`
  - `readablePlan(deps, input: { spaceId; userId; planId }): Promise<Result<{ space: SpaceMembership; plan: BudgetPlan }>>`; `managePlan(membership: SpaceMembership): Result<SpaceMembership>`; `interface PlanWrite { space; plan; members: readonly SpaceMember[]; parts: PlanContents }`; `planForWrite(deps, input: { spaceId; userId; planId; expectedVersion: number | null }, authorize?: (m: SpaceMembership) => Result<SpaceMembership>): Promise<Result<PlanWrite>>` — `SpaceNotFound`, `SpaceArchived`, `InsufficientRole`, `BudgetPlanNotFound`, `PreconditionFailed`
  - `type CreateBudgetPlan = (input: { spaceId: string; userId: string; period: string }) => Promise<Result<BudgetPlanView>>`; `createCreateBudgetPlan(deps: BudgetingDeps)` — `SpaceNotFound`, `SpaceArchived`, `InsufficientRole`, `InvalidPeriodLabel`, `PlanAlreadyExists`
  - `type GetBudgetPlan = (input: { spaceId: string; userId: string; planId: string }) => Promise<Result<BudgetPlanView>>`; `createGetBudgetPlan(deps: BudgetingDeps)` — `SpaceNotFound`, `BudgetPlanNotFound`
  - `HOUSEHOLD = "space-household"`, `NOW`, `BUDGET_MEMBERS` (OWNER Ana, MEMBER Juan, VIEWER Sofi, guest Pedro), `class FixedSpending implements PlanSpending` (`byCategory`, `byAccount`, `asked`), `budgetingWorld(options?: { members?; periodPolicy? }): { spaces; plans; spending; deps: BudgetingDeps }` (also seeds the personal spaces `space-ana` with `member-ana-personal` and `space-marta` with `member-marta-personal`) — `tests/support/budgeting-world.ts`

- [ ] **Step 1: Write the test world and the failing tests**

In `src/modules/spaces/domain/permissions.test.ts`, insert after the line `    ["Sofi removes the guest Pedro", "VIEWER", "guest.remove", false],`:

```ts
    ["Ana creates a plan", "OWNER", "plan.manage", true],
    ["Juan edits a plan", "ADMIN", "plan.manage", true],
    ["Luis creates a plan", "MEMBER", "plan.manage", false],
    ["Luis sets his own capacity", "MEMBER", "capacity.setOwn", true],
    ["Sofi sets her own capacity", "VIEWER", "capacity.setOwn", false],
```

`tests/support/budgeting-world.ts`:

```ts
import type { BudgetingDeps, PlanSpending } from "@/modules/budgeting/application";
import { createSpaceAccess, type SpaceId, type SpaceMember, type SpaceMemberId } from "@/modules/spaces/application";
import { createPersonalSpace } from "@/modules/spaces/domain/space";
import { FixedClock, type LocalDate, type PeriodPolicy } from "@/shared/kernel";
import { memoryTm, sequentialIds } from "./fakes";
import { InMemoryBudgetPlans } from "./in-memory-budgeting";
import { householdSpace, InMemorySpaceStore, memberOf } from "./in-memory-spaces";

export const HOUSEHOLD = "space-household";
export const NOW = new Date("2026-10-14T12:00:00Z");

/** HU-E6 Background, in join order: OWNER Ana, MEMBER Juan, VIEWER Sofi and the guest Pedro. */
export const BUDGET_MEMBERS: readonly SpaceMember[] = [
  memberOf("Ana", "OWNER", 0),
  memberOf("Juan", "MEMBER", 1),
  memberOf("Sofi", "VIEWER", 2),
  memberOf("Pedro", null, 3),
];

/** PlanSpending over fixed sums, as the ledger would return them for the plan's period; records what was asked. */
export class FixedSpending implements PlanSpending {
  byCategory: { categoryId: string; amount: bigint }[] = [];
  byAccount: { accountId: string; amount: bigint }[] = [];
  readonly asked: { spaceId: string; from: LocalDate; to: LocalDate }[] = [];

  async expensesByCategory(spaceId: string, from: LocalDate, to: LocalDate) {
    this.asked.push({ spaceId, from, to });
    return [...this.byCategory];
  }

  async transfersIntoAccounts(accountIds: readonly string[]) {
    return this.byAccount.filter((a) => accountIds.includes(a.accountId));
  }
}

const personal = (name: string, key: string) =>
  createPersonalSpace({
    id: `space-${key}` as SpaceId,
    memberId: `member-${key}-personal` as SpaceMemberId,
    ownerUserId: `u-${key}`,
    ownerName: name,
    now: NOW,
  });

/**
 * Household (`space-household`, COP) with the HU-E6 Background members unless given, Ana's and Marta's personal
 * spaces, in-memory plans and fixed spending. Use-case tests add their own ports to `deps`.
 */
export const budgetingWorld = (
  options: { readonly members?: readonly SpaceMember[]; readonly periodPolicy?: PeriodPolicy } = {},
) => {
  const spaces = new InMemorySpaceStore();
  spaces.seed({
    ...householdSpace(options.members ?? BUDGET_MEMBERS),
    periodPolicy: options.periodPolicy ?? { kind: "MONTHLY", day: 1 },
  });
  spaces.seed(personal("Ana", "ana"));
  spaces.seed(personal("Marta", "marta"));
  const plans = new InMemoryBudgetPlans();
  const spending = new FixedSpending();
  const deps: BudgetingDeps = {
    access: createSpaceAccess(spaces),
    members: spaces,
    plans,
    spending,
    ids: sequentialIds("budget"),
    clock: new FixedClock(NOW),
    tm: memoryTm,
  };
  return { spaces, plans, spending, deps };
};
```

`src/modules/budgeting/application/plans.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SpaceId } from "@/modules/spaces/application";
import { referenceLines } from "../../../../tests/support/budget-fixtures";
import { budgetingWorld, HOUSEHOLD, NOW } from "../../../../tests/support/budgeting-world";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createGetBudgetPlan } from "./get-budget-plan";
import { planForWrite } from "./plan-access";

const as = (userId: string, period = "2026-11", spaceId = HOUSEHOLD) => ({ spaceId, userId, period });

describe("CreateBudgetPlan (HU-E6-01)", () => {
  it("creates a DRAFT plan for 2026-11 from 2026-11-01 to 2026-11-30, every current member at 0 COP", async () => {
    const { deps } = budgetingWorld();
    const view = unwrap(await createCreateBudgetPlan(deps)(as("u-ana")));
    expect(view.plan).toEqual({
      id: "budget-1",
      spaceId: HOUSEHOLD,
      period: { label: "2026-11", start: "2026-11-01", end: "2026-11-30" },
      status: "DRAFT",
      createdFrom: null,
      version: 1,
      createdBy: "u-ana",
      createdAt: NOW,
    });
    expect(view.figures.capacities.map((c) => [c.memberId, c.amount])).toEqual([
      ["member-ana", 0n],
      ["member-juan", 0n],
      ["member-sofi", 0n],
      ["member-pedro", 0n],
    ]);
    expect([view.currency, view.figures.lines, view.figures.unbudgeted]).toEqual([
      "COP",
      [],
      { spent: 0n, available: 0n },
    ]);
  });

  it("allows only one plan per period", async () => {
    const { deps } = budgetingWorld();
    const create = createCreateBudgetPlan(deps);
    unwrap(await create(as("u-ana")));
    expect(codeOf(await create(as("u-ana")))).toBe("PlanAlreadyExists");
  });

  it("lets the OWNER create plans, not Juan the MEMBER, and hides the space from Marta", async () => {
    const { deps } = budgetingWorld();
    const create = createCreateBudgetPlan(deps);
    expect(codeOf(await create(as("u-juan", "2026-12")))).toBe("InsufficientRole");
    expect(codeOf(await create(as("u-marta")))).toBe("SpaceNotFound");
  });

  it("gives Ana's personal space a plan with Ana as its only member", async () => {
    const { deps } = budgetingWorld();
    const view = unwrap(await createCreateBudgetPlan(deps)(as("u-ana", "2026-11", "space-ana")));
    expect(view.plan.status).toBe("DRAFT");
    expect(view.figures.capacities.map((c) => c.memberId)).toEqual(["member-ana-personal"]);
  });

  it("gives a semi-monthly space two plans per month, each with its own capacities", async () => {
    const { deps, plans } = budgetingWorld({ periodPolicy: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } });
    const create = createCreateBudgetPlan(deps);
    const h1 = unwrap(await create(as("u-ana", "2026-11 H1"))).plan;
    const h2 = unwrap(await create(as("u-ana", "2026-11 H2"))).plan;
    expect([h1.period, h2.period]).toEqual([
      { label: "2026-11 H1", start: "2026-11-01", end: "2026-11-15" },
      { label: "2026-11 H2", start: "2026-11-16", end: "2026-11-30" },
    ]);
    plans.seed(h1.id, { capacities: [{ memberId: "member-ana", amount: 80_000_000n }] });
    const read = createGetBudgetPlan(deps);
    const total = async (planId: string) =>
      unwrap(await read({ spaceId: HOUSEHOLD, userId: "u-ana", planId })).figures.totalCapacity;
    expect([await total(h1.id), await total(h2.id)]).toEqual([80_000_000n, 0n]);
  });

  it("starts a plan the day after a stored plan once the policy changed (D10, Review Focus 4)", async () => {
    const { deps, spaces } = budgetingWorld();
    const create = createCreateBudgetPlan(deps);
    unwrap(await create(as("u-ana", "2026-11")));
    await spaces.updateSettings(HOUSEHOLD as SpaceId, {
      name: "Household",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 25 },
    });
    const december = unwrap(await create(as("u-ana", "2026-12"))).plan;
    expect(december.period).toEqual({ label: "2026-12", start: "2026-12-01", end: "2026-12-24" });
    expect(codeOf(await create(as("u-ana", "2026-11")))).toBe("PlanAlreadyExists");
  });

  it("refuses labels that name no period of the policy", async () => {
    const { deps } = budgetingWorld();
    const create = createCreateBudgetPlan(deps);
    for (const period of ["2026-13", "November", "2026-11 H1"]) {
      expect(codeOf(await create(as("u-ana", period)))).toBe("InvalidPeriodLabel");
    }
  });

  it("refuses to create plans in an archived space (HU-E1-09)", async () => {
    const { deps, spaces } = budgetingWorld();
    spaces.archived.add(HOUSEHOLD);
    expect(codeOf(await createCreateBudgetPlan(deps)(as("u-ana")))).toBe("SpaceArchived");
  });
});

describe("GetBudgetPlan (HU-E6-01)", () => {
  it("shows any member, Sofi the VIEWER included, the figures of the plan's own period", async () => {
    const { deps, plans, spending } = budgetingWorld();
    const plan = unwrap(await createCreateBudgetPlan(deps)(as("u-ana"))).plan;
    plans.seed(plan.id, {
      capacities: [
        { memberId: "member-ana", amount: 160_000_000n },
        { memberId: "member-juan", amount: 240_000_000n },
      ],
      lines: referenceLines(),
    });
    spending.byCategory = [{ categoryId: "cat-entertainment", amount: 25_000_000n }];
    const view = unwrap(await createGetBudgetPlan(deps)({ spaceId: HOUSEHOLD, userId: "u-sofi", planId: plan.id }));
    expect([view.figures.totalCapacity, view.figures.unallocated]).toEqual([400_000_000n, 0n]);
    expect(view.figures.lines.find((l) => l.line.name === "Free")!.spent).toBe(25_000_000n);
    expect(spending.asked.at(-1)).toEqual({ spaceId: HOUSEHOLD, from: "2026-11-01", to: "2026-11-30" });
  });

  it("answers BudgetPlanNotFound for unknown ids and another space's plan, and SpaceNotFound to Marta", async () => {
    const { deps } = budgetingWorld();
    const personal = unwrap(await createCreateBudgetPlan(deps)(as("u-ana", "2026-11", "space-ana"))).plan;
    const read = createGetBudgetPlan(deps);
    expect(codeOf(await read({ spaceId: HOUSEHOLD, userId: "u-ana", planId: personal.id }))).toBe(
      "BudgetPlanNotFound",
    );
    expect(codeOf(await read({ spaceId: HOUSEHOLD, userId: "u-ana", planId: "budget-404" }))).toBe(
      "BudgetPlanNotFound",
    );
    expect(codeOf(await read({ spaceId: "space-ana", userId: "u-marta", planId: personal.id }))).toBe(
      "SpaceNotFound",
    );
  });

  it("reads the plans of an archived space (HU-E1-09)", async () => {
    const { deps, spaces } = budgetingWorld();
    const plan = unwrap(await createCreateBudgetPlan(deps)(as("u-ana"))).plan;
    spaces.archived.add(HOUSEHOLD);
    const read = await createGetBudgetPlan(deps)({ spaceId: HOUSEHOLD, userId: "u-juan", planId: plan.id });
    expect(codeOf(read)).toBe("ok");
  });
});

describe("planForWrite (spec 7, every plan write)", () => {
  const write = (userId: string, planId: string, expectedVersion: number | null = null) => ({
    spaceId: HOUSEHOLD,
    userId,
    planId,
    expectedVersion,
  });

  it("bumps the version, honouring If-Match, and returns the members and parts as committed", async () => {
    const { deps, plans } = budgetingWorld();
    const plan = unwrap(await createCreateBudgetPlan(deps)(as("u-ana"))).plan;
    plans.seed(plan.id, { lines: referenceLines() });
    const first = unwrap(await planForWrite(deps, write("u-ana", plan.id, 1)));
    expect([first.plan.version, first.members.length, first.parts.lines.length]).toEqual([2, 4, 4]);
    expect(unwrap(await planForWrite(deps, write("u-ana", plan.id))).plan.version).toBe(3);
  });

  it("refuses a stale If-Match, Juan the MEMBER, an unknown plan and an archived space", async () => {
    const { deps, spaces } = budgetingWorld();
    const plan = unwrap(await createCreateBudgetPlan(deps)(as("u-ana"))).plan;
    expect(codeOf(await planForWrite(deps, write("u-ana", plan.id, 7)))).toBe("PreconditionFailed");
    expect(codeOf(await planForWrite(deps, write("u-juan", plan.id)))).toBe("InsufficientRole");
    expect(codeOf(await planForWrite(deps, write("u-ana", "budget-404")))).toBe("BudgetPlanNotFound");
    spaces.archived.add(HOUSEHOLD);
    expect(codeOf(await planForWrite(deps, write("u-ana", plan.id)))).toBe("SpaceArchived");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/spaces/domain/permissions.test.ts src/modules/budgeting/application`
Expected: FAIL — the five new matrix rows throw `TypeError: Cannot read properties of undefined (reading 'includes')` (the actions are not in the matrix yet), and `Failed to resolve import "./create-budget-plan"`.

- [ ] **Step 3: Implement**

In `src/modules/spaces/domain/permissions.ts`, insert after the line `  "fund.manage": ["OWNER", "ADMIN"],`:

```ts
  /** HU-E6-01 … HU-E6-05: create plans and edit their capacities, lines, category mappings and allocations. */
  "plan.manage": ["OWNER", "ADMIN"],
  /** HU-E6-02, D17: a registered member records their own capacity; anyone else's is plan.manage. */
  "capacity.setOwn": ["OWNER", "ADMIN", "MEMBER"],
```

In `src/modules/budgeting/application/ports.ts`:

1. Replace the line `import type { StoredPeriod } from "@/shared/kernel";` with:

```ts
import type { LocalDate, StoredPeriod } from "@/shared/kernel";
```

2. Append to the end of the file:

```ts

/** Spec 5.4, D7: spending within dates, summed on read by the ledger and bound by the composition root. */
export interface PlanSpending {
  /** Σ live expenses of the space dated within [from, to] per category; categories without any are absent. */
  expensesByCategory(
    spaceId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<{ categoryId: string; amount: bigint }[]>;
  /** Σ live transfers dated within [from, to] into each of the accounts, whatever space recorded them. */
  transfersIntoAccounts(
    accountIds: readonly string[],
    from: LocalDate,
    to: LocalDate,
  ): Promise<{ accountId: string; amount: bigint }[]>;
}
```

`src/modules/budgeting/application/deps.ts`:

```ts
import type { SpaceAccess, SpaceMemberRepository } from "@/modules/spaces/application";
import type { Clock, IdGenerator, TransactionManager } from "@/shared/kernel";
import type { BudgetPlanRepository, PlanSpending } from "./ports";

/** What every budgeting use case needs; the composition root binds each port (budgeting imports only spaces). */
export interface BudgetingDeps {
  readonly access: SpaceAccess;
  /** Current members in join order, registered and guests (D15): capacities and allocations follow them. */
  readonly members: Pick<SpaceMemberRepository, "listCurrent">;
  readonly plans: BudgetPlanRepository;
  readonly spending: PlanSpending;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly tm: TransactionManager;
}
```

`src/modules/budgeting/application/plan-view.ts`:

```ts
import type { SpaceMembership } from "@/modules/spaces/application";
import type { BudgetPlan } from "../domain/plan";
import { planFigures, type PlanFigures } from "../domain/plan-figures";
import type { BudgetingDeps } from "./deps";

/** A plan with every figure derived on read (D7), its amounts in the space currency. */
export interface BudgetPlanView {
  readonly plan: BudgetPlan;
  readonly currency: string;
  readonly figures: PlanFigures;
}

/** The plan's parts, its space's current members and the spending within its stored dates, as figures. */
export const loadPlanView = async (
  deps: Pick<BudgetingDeps, "members" | "plans" | "spending">,
  space: SpaceMembership,
  plan: BudgetPlan,
): Promise<BudgetPlanView> => {
  const members = await deps.members.listCurrent(space.spaceId);
  const parts = await deps.plans.contents(plan.id);
  const { start, end } = plan.period;
  const accountIds = parts.lines.flatMap((line) => line.savingsAccountIds);
  const spending = {
    byCategory: await deps.spending.expensesByCategory(space.spaceId, start, end),
    byAccount: accountIds.length === 0 ? [] : await deps.spending.transfersIntoAccounts(accountIds, start, end),
  };
  return {
    plan,
    currency: space.currency,
    figures: planFigures({ currency: space.currency, memberIds: members.map((m) => m.id), parts, spending }),
  };
};
```

`src/modules/budgeting/application/plan-access.ts`:

```ts
import {
  authorizeSpaceAction,
  requirePermission,
  type SpaceMember,
  type SpaceMembership,
} from "@/modules/spaces/application";
import { domainError, err, ok, type Result } from "@/shared/kernel";
import type { BudgetPlan } from "../domain/plan";
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

/** HU-E6-01 … HU-E6-05: writing a plan is the matrix action plan.manage (OWNER, ADMIN). */
export const managePlan = (membership: SpaceMembership): Result<SpaceMembership> =>
  requirePermission(membership, "plan.manage");

/** What a write to a plan sees once it holds the plan's version lock. */
export interface PlanWrite {
  readonly space: SpaceMembership;
  /** The plan with the version this write gives it (its new ETag). */
  readonly plan: BudgetPlan;
  /** Current members in join order. */
  readonly members: readonly SpaceMember[];
  /** The plan's parts as committed before this write. */
  readonly parts: PlanContents;
}

/**
 * Every plan write starts here, inside its transaction: the membership (an archived space refuses, HU-E1-09),
 * the matrix (`authorize`), the plan, then the version lock (If-Match, spec 7), and only then the members and
 * parts, so writes to one plan run one at a time on committed data. HU-E6-07 adds its CLOSED check here.
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
): Promise<Result<PlanWrite>> => {
  const membership = await deps.access(input.spaceId, input.userId);
  if (!membership.ok) return membership;
  const allowed = authorize(membership.value);
  if (!allowed.ok) return allowed;
  const space = allowed.value;
  const plan = await deps.plans.find(space.spaceId, input.planId);
  if (plan === null) return err(domainError("BudgetPlanNotFound"));
  const version = await deps.plans.lockForWrite(plan.id, input.expectedVersion, deps.clock.now());
  if (version === null) return err(domainError("PreconditionFailed"));
  const members = await deps.members.listCurrent(space.spaceId);
  const parts = await deps.plans.contents(plan.id);
  return ok({ space, plan: { ...plan, version }, members, parts });
};
```

`src/modules/budgeting/application/create-budget-plan.ts`:

```ts
import { authorizeSpaceAction } from "@/modules/spaces/application";
import { domainError, err, ok, periodByLabel, type Result } from "@/shared/kernel";
import { openPlan } from "../domain/plan";
import type { BudgetingDeps } from "./deps";
import { loadPlanView, type BudgetPlanView } from "./plan-view";

export type CreateBudgetPlan = (input: {
  spaceId: string;
  userId: string;
  period: string;
}) => Promise<Result<BudgetPlanView>>;

/**
 * HU-E6-01: an OWNER or ADMIN creates a DRAFT plan for the period named `period` ("2026-11", "2026-11 H1"),
 * resolved with the space policy around the stored plans and stored as it is (D10); personal spaces too.
 */
export const createCreateBudgetPlan =
  (deps: BudgetingDeps): CreateBudgetPlan =>
  (input) =>
    deps.tm.run(async () => {
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
      if (!plan.ok) return plan;
      // budget_plans_space_start_uq decides a concurrent creation of the same period.
      if (!(await deps.plans.add(plan.value))) {
        return err(domainError("PlanAlreadyExists", { label: period.value.label }));
      }
      return ok(await loadPlanView(deps, space, plan.value));
    });
```

`src/modules/budgeting/application/get-budget-plan.ts`:

```ts
import { ok, type Result } from "@/shared/kernel";
import type { BudgetingDeps } from "./deps";
import { readablePlan } from "./plan-access";
import { loadPlanView, type BudgetPlanView } from "./plan-view";

export type GetBudgetPlan = (input: {
  spaceId: string;
  userId: string;
  planId: string;
}) => Promise<Result<BudgetPlanView>>;

/** HU-E6-01: any member reads a plan, archived spaces included, with every figure derived on read (D7). */
export const createGetBudgetPlan =
  (deps: BudgetingDeps): GetBudgetPlan =>
  async (input) => {
    const found = await readablePlan(deps, input);
    if (!found.ok) return found;
    return ok(await loadPlanView(deps, found.value.space, found.value.plan));
  };
```

Append to `src/modules/budgeting/application/index.ts`:

```ts
export type { PlanSpending } from "./ports";
export type { BudgetingDeps } from "./deps";
export type { BudgetPlanView } from "./plan-view";
export { createCreateBudgetPlan, type CreateBudgetPlan } from "./create-budget-plan";
export { createGetBudgetPlan, type GetBudgetPlan } from "./get-budget-plan";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/spaces src/modules/budgeting`
Expected: PASS, M2-A's matrix tests included ("lets owners do everything and viewers only read or leave" holds: OWNER has both new actions, VIEWER neither). Mutation check: temporarily move the line `    const parts = await deps.plans.contents(plan.id);` of `planForWrite` above the `lockForWrite` call — the unit tests still pass (the twin is synchronous), which is why Task 13 races two writers against PostgreSQL; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (`modules-only-through-public-application-api` holds: budgeting imports `@/modules/spaces/application` only).

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/domain/permissions.ts src/modules/spaces/domain/permissions.test.ts src/modules/budgeting/application/ports.ts src/modules/budgeting/application/deps.ts src/modules/budgeting/application/plan-view.ts src/modules/budgeting/application/plan-access.ts src/modules/budgeting/application/create-budget-plan.ts src/modules/budgeting/application/get-budget-plan.ts src/modules/budgeting/application/index.ts src/modules/budgeting/application/plans.test.ts tests/support/budgeting-world.ts
git commit -m "feat(budgeting): create and read period plans through the permission matrix (Refs #47)"
```

---

### Task 9a: Contracts — the BudgetPlan component and shared percentages

Implements the wire format of HU-E6-01 … HU-E6-05 (issues #47–#51): one `BudgetPlan` response component that every plan endpoint answers with. No operation yet.

Decisions:
- Percentages: requests take strings with at most two decimals (`PercentSchema`, HU-E4-08's format) and responses print exactly two (`percentOf`: 3675 → `"36.75"`, HU-E6-03 "Percent of total returned with two decimals"). The ledger's private `PercentSchema` and `basisPointsOf` move to `src/shared/http/contracts.ts` unchanged, so both modules share them; the OpenAPI document of the ledger does not change (pinned by the snapshot test).
- `BudgetPlan` carries the stored period, status, `createdFrom`, `version` (same value as the ETag), every current member's capacity with its share, total capacity, Σ planned, unallocated capacity, the lines and `unbudgeted` (null with a catch-all line). A line carries its fields, its categories, its share of capacity, its allocation (rule; for every current member the stored `percent` or `amount` and the derived `assigned`; `error: "InvalidAllocation"` or null; no members on NONE), `spent` and `available` (rulings P1, P4).
- `planSuccess(view, status)` answers the plan with `ETag`; `planCreated(view)` adds `Location` (HU-E6-01's 201).
- The component is registered now (responses only), so this commit's snapshot diff is the component alone.

**Files:**
- Create: `src/modules/budgeting/contracts/budgeting.contract.ts`
- Modify: `src/shared/http/contracts.ts`, `src/modules/ledger/contracts/ledger.contract.ts`, `src/composition/openapi.ts`, `openapi/openapi.snapshot.json`
- Test: `src/shared/http/contracts.test.ts`, `src/modules/budgeting/contracts/budgeting.contract.test.ts`

**Interfaces:**
- Consumes: `BudgetPlanView`, `LineFigure`, the tuples `ALLOCATION_RULES`, `FUNDINGS`, `PLAN_STATUSES`, `ROLLOVER_MODES` (`@/modules/budgeting/application`, Tasks 6 and 8); `planFigures` (Task 4); `referenceLines` (Task 2); `HttpSuccess` (`src/shared/http/define-route.ts`); `etagOf`.
- Produces:
  - `PercentSchema`, `basisPointsOf(percent: string): number`, `percentOf(basisPoints: number): string` (`src/shared/http/contracts.ts`)
  - `BudgetLineSchema`, `BudgetPlanSchema` (component `BudgetPlan`), `budgetPlanDto(view: BudgetPlanView)`, `planSuccess(view: BudgetPlanView, status?: number): HttpSuccess`, `planCreated(view: BudgetPlanView): HttpSuccess` (`budgeting.contract.ts`)

- [ ] **Step 1: Write the failing tests**

In `src/shared/http/contracts.test.ts`:

1. Insert after the line `import {` (the multi-line import of `./contracts`):

```ts
  basisPointsOf,
  percentOf,
  PercentSchema,
```

2. Append to the end of the file:

```ts

describe("percentages (HU-E4-08, HU-E6-03, HU-E6-05)", () => {
  it("parses percentages with at most two decimals into basis points", () => {
    expect(["40", "33.33", "0.5", "100"].map(basisPointsOf)).toEqual([4000, 3333, 50, 10_000]);
    expect(["40", "33.33", "100"].every((p) => PercentSchema.safeParse(p).success)).toBe(true);
    expect(["40.123", "-1", "4e1", ""].some((p) => PercentSchema.safeParse(p).success)).toBe(false);
  });

  it("prints basis points with exactly two decimals", () => {
    expect([4000, 3675, 1825, 5, 11_111].map(percentOf)).toEqual(["40.00", "36.75", "18.25", "0.05", "111.11"]);
  });
});
```

`src/modules/budgeting/contracts/budgeting.contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BudgetPlan, BudgetPlanId, BudgetPlanView } from "@/modules/budgeting/application";
import { planFigures } from "@/modules/budgeting/domain/plan-figures";
import type { LocalDate } from "@/shared/kernel";
import { referenceLines } from "../../../../tests/support/budget-fixtures";
import { budgetPlanDto, planCreated, planSuccess } from "./budgeting.contract";

const cop = (pesos: number) => ({ amount: String(pesos * 100), currency: "COP" });
const plan: BudgetPlan = {
  id: "plan-november" as BudgetPlanId,
  spaceId: "space-household",
  period: { label: "2026-11", start: "2026-11-01" as LocalDate, end: "2026-11-30" as LocalDate },
  status: "DRAFT",
  createdFrom: null,
  version: 4,
  createdBy: "u-ana",
  createdAt: new Date("2026-10-14T12:00:00Z"),
};
const view = (lines = referenceLines()): BudgetPlanView => ({
  plan,
  currency: "COP",
  figures: planFigures({
    currency: "COP",
    memberIds: ["member-ana", "member-juan"],
    parts: {
      capacities: [
        { memberId: "member-ana", amount: 160_000_000n },
        { memberId: "member-juan", amount: 240_000_000n },
      ],
      lines,
      mappings: [{ lineId: "line-home", categoryId: "cat-groceries" }],
      allocations: [
        { lineId: "line-free", memberId: "member-ana", value: 4200n },
        { lineId: "line-free", memberId: "member-juan", value: 5800n },
      ],
    },
    spending: { byCategory: [{ categoryId: "cat-groceries", amount: 90_000_000n }], byAccount: [] },
  }),
});

describe("BudgetPlan on the wire (HU-E6-01 … HU-E6-05)", () => {
  it("prints the reference plan with two-decimal percentages and money as minor-unit strings (golden)", () => {
    const lines = referenceLines().map((l) => (l.name === "Free" ? { ...l, allocationRule: "PERCENT" as const } : l));
    const dto = budgetPlanDto(view(lines));
    expect(dto).toMatchObject({
      id: "plan-november",
      spaceId: "space-household",
      period: { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" },
      status: "DRAFT",
      createdFrom: null,
      version: 4,
      capacities: [
        { memberId: "member-ana", amount: cop(1_600_000), share: "40.00" },
        { memberId: "member-juan", amount: cop(2_400_000), share: "60.00" },
      ],
      totalCapacity: cop(4_000_000),
      planned: cop(4_000_000),
      unallocated: cop(0),
      unbudgeted: null,
    });
    const home = dto.lines.find((l) => l.name === "Home")!;
    expect(home).toEqual({
      id: "line-home",
      name: "Home",
      plannedAmount: cop(1_470_000),
      funding: "DIRECT",
      rolloverMode: "RESET",
      isCatchAll: false,
      savingsAccountIds: [],
      categoryIds: ["cat-groceries"],
      capacityShare: "36.75",
      allocation: {
        rule: "PROPORTIONAL",
        members: [
          { memberId: "member-ana", percent: null, amount: null, assigned: cop(588_000) },
          { memberId: "member-juan", percent: null, amount: null, assigned: cop(882_000) },
        ],
        error: null,
      },
      spent: cop(900_000),
      available: cop(570_000),
    });
    expect(dto.lines.find((l) => l.name === "Free")!.allocation.members).toEqual([
      { memberId: "member-ana", percent: "42.00", amount: null, assigned: cop(306_600) },
      { memberId: "member-juan", percent: "58.00", amount: null, assigned: cop(423_400) },
    ]);
  });

  it("prints FIXED amounts, flags an invalid allocation and lists nobody on NONE", () => {
    const lines = referenceLines().map((l) =>
      l.name === "Free" ? { ...l, allocationRule: "FIXED" as const } : l.name === "Rent" ? { ...l, allocationRule: "NONE" as const } : l,
    );
    const dto = budgetPlanDto(view(lines));
    expect(dto.lines.find((l) => l.name === "Free")!.allocation).toEqual({
      rule: "FIXED",
      members: [
        { memberId: "member-ana", percent: null, amount: { amount: "4200", currency: "COP" }, assigned: null },
        { memberId: "member-juan", percent: null, amount: { amount: "5800", currency: "COP" }, assigned: null },
      ],
      error: "InvalidAllocation",
    });
    expect(dto.lines.find((l) => l.name === "Rent")!.allocation).toEqual({ rule: "NONE", members: [], error: null });
  });

  it("answers with the version as ETag, and the location on creation", () => {
    expect(planSuccess(view()).headers).toEqual([["etag", '"4"']]);
    expect(planSuccess(view(), 201).status).toBe(201);
    expect(planCreated(view())).toMatchObject({
      status: 201,
      headers: [
        ["etag", '"4"'],
        ["location", "/api/v1/spaces/space-household/plans/plan-november"],
      ],
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/shared/http/contracts.test.ts src/modules/budgeting/contracts`
Expected: FAIL — `basisPointsOf is not a function` (no such export yet) and `Failed to resolve import "./budgeting.contract"`.

- [ ] **Step 3: Move the percent helpers and write the contract**

Append to `src/shared/http/contracts.ts`:

```ts

/** "40", "33.33": a percentage with at most two decimals (HU-E4-08, HU-E6-05), never a float. */
export const PercentSchema = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, { error: "A percentage with at most two decimals, e.g. 40 or 33.33" });

/** "33.33" → 3333 basis points (the regex guarantees digits). */
export const basisPointsOf = (percent: string): number => {
  const [whole = "0", fraction = ""] = percent.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
};

/** 3675 basis points → "36.75": exactly two decimals, as HU-E6-02 and HU-E6-03 report shares. */
export const percentOf = (basisPoints: number): string =>
  `${Math.floor(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, "0")}`;
```

In `src/modules/ledger/contracts/ledger.contract.ts`:

1. Insert before the line `  jsonContent,` (the first name of the `@/shared/http/contracts` import):

```ts
  basisPointsOf,
```

2. Insert after the line `  optionalLocalDate,`:

```ts
  PercentSchema,
```

3. Delete the four lines from `/** "40", "33.33": a percentage with at most two decimals (HU-E4-08), never a float. */` through `  .regex(/^\d{1,3}(\.\d{1,2})?$/, { error: "A percentage with at most two decimals, e.g. 40 or 33.33" });` and the blank line after them.

4. Delete the five lines from `/** "33.33" → 3333 basis points (the regex guarantees digits). */` through the `};` that closes `basisPointsOf`, and the blank line after them.

`src/modules/budgeting/contracts/budgeting.contract.ts`:

```ts
import { z } from "zod";
import { MoneySchema, percentOf, PeriodSchema, periodDto, type MoneyDto } from "@/shared/http/contracts";
import type { HttpSuccess } from "@/shared/http/define-route";
import { etagOf } from "@/shared/http/etag";
import {
  ALLOCATION_RULES,
  FUNDINGS,
  PLAN_STATUSES,
  ROLLOVER_MODES,
  type BudgetPlanView,
  type LineFigure,
} from "../application";

const moneyOf = (minor: bigint, currency: string): MoneyDto => ({ amount: minor.toString(), currency });
const percentOrNull = (basisPoints: number | null): string | null =>
  basisPoints === null ? null : percentOf(basisPoints);

export const BudgetLineSchema = z.object({
  id: z.string(),
  name: z.string(),
  plannedAmount: MoneySchema,
  funding: z.enum(FUNDINGS),
  rolloverMode: z.enum(ROLLOVER_MODES),
  isCatchAll: z.boolean(),
  /** SAVINGS lines: the accounts whose incoming transfers are the line's spending (spec 5.4). */
  savingsAccountIds: z.array(z.string()),
  /** HU-E6-04: the categories mapped to the line; the catch-all line also consumes every unmapped one. */
  categoryIds: z.array(z.string()),
  /** HU-E6-03: the planned amount as a percentage of total capacity, two decimals ("36.75"); null without capacity. */
  capacityShare: z.string().nullable(),
  allocation: z.object({
    rule: z.enum(ALLOCATION_RULES),
    /** Every current member in join order; empty for NONE, group money without per-member responsibility. */
    members: z.array(
      z.object({
        memberId: z.string(),
        /** PERCENT lines: the member's percentage, two decimals. */
        percent: z.string().nullable(),
        /** FIXED lines: the member's fixed amount. */
        amount: MoneySchema.nullable(),
        /** Derived on read; null while the allocation is invalid. */
        assigned: MoneySchema.nullable(),
      }),
    ),
    /** HU-E6-05: InvalidAllocation while the values do not add up or there is no capacity to follow. */
    error: z.enum(["InvalidAllocation"]).nullable(),
  }),
  /** Spec 5.4: spent in the plan's period, computed on read (D7). */
  spent: MoneySchema,
  /** planned + carry-over − spent; the carry-over is 0 until lines are copied (HU-E6-06, HU-E6-09). */
  available: MoneySchema,
});

export const BudgetPlanSchema = z.object({
  id: z.string(),
  spaceId: z.string(),
  /**
   * The period stored when the plan was created (D10). A copy of PeriodSchema: zod-openapi renders a registered
   * component in both directions, so referencing the registered Period here would split it into Period/PeriodOutput.
   */
  period: PeriodSchema.extend({}),
  status: z.enum(PLAN_STATUSES),
  /** HU-E6-06: the plan this one was copied from. */
  createdFrom: z.string().nullable(),
  /** Same value as the ETag; send it back in If-Match. */
  version: z.number().int(),
  /** Every current member in join order, guests included (D15); 0 until set (HU-E6-02). */
  capacities: z.array(z.object({ memberId: z.string(), amount: MoneySchema, share: z.string().nullable() })),
  totalCapacity: MoneySchema,
  planned: MoneySchema,
  /** Total capacity − Σ planned; negative once capacities were reduced below the lines (HU-E6-02). */
  unallocated: MoneySchema,
  lines: z.array(BudgetLineSchema),
  /** HU-E6-04: unmapped spending when the plan has no catch-all line; null when it has one. */
  unbudgeted: z.object({ spent: MoneySchema, available: MoneySchema }).nullable(),
});

const lineDto = (figure: LineFigure, currency: string): z.infer<typeof BudgetLineSchema> => {
  const { line, allocation } = figure;
  return {
    id: line.id,
    name: line.name,
    plannedAmount: moneyOf(line.plannedAmount, currency),
    funding: line.funding,
    rolloverMode: line.rolloverMode,
    isCatchAll: line.isCatchAll,
    savingsAccountIds: [...line.savingsAccountIds],
    categoryIds: [...figure.categoryIds],
    capacityShare: percentOrNull(figure.capacityShareBasisPoints),
    allocation: {
      rule: allocation.rule,
      members: allocation.members.map((m) => ({
        memberId: m.memberId,
        percent: allocation.rule === "PERCENT" && m.value !== null ? percentOf(Number(m.value)) : null,
        amount: allocation.rule === "FIXED" && m.value !== null ? moneyOf(m.value, currency) : null,
        assigned: m.assigned === null ? null : moneyOf(m.assigned, currency),
      })),
      error: allocation.invalid ? "InvalidAllocation" : null,
    },
    spent: moneyOf(figure.spent, currency),
    available: moneyOf(figure.available, currency),
  };
};

export const budgetPlanDto = ({ plan, currency, figures }: BudgetPlanView): z.infer<typeof BudgetPlanSchema> => ({
  id: plan.id,
  spaceId: plan.spaceId,
  period: periodDto(plan.period),
  status: plan.status,
  createdFrom: plan.createdFrom,
  version: plan.version,
  capacities: figures.capacities.map((c) => ({
    memberId: c.memberId,
    amount: moneyOf(c.amount, currency),
    share: percentOrNull(c.shareBasisPoints),
  })),
  totalCapacity: moneyOf(figures.totalCapacity, currency),
  planned: moneyOf(figures.planned, currency),
  unallocated: moneyOf(figures.unallocated, currency),
  lines: figures.lines.map((figure) => lineDto(figure, currency)),
  unbudgeted:
    figures.unbudgeted === null
      ? null
      : {
          spent: moneyOf(figures.unbudgeted.spent, currency),
          available: moneyOf(figures.unbudgeted.available, currency),
        },
});

/** Every plan response carries the plan's version as its ETag (spec 7, HU-E0-10). */
export const planSuccess = (view: BudgetPlanView, status = 200): HttpSuccess => ({
  status,
  body: budgetPlanDto(view),
  headers: [["etag", etagOf(view.plan.version)]],
});

/** HU-E6-01: 201 with the new plan, its ETag and its location. */
export const planCreated = (view: BudgetPlanView): HttpSuccess => ({
  status: 201,
  body: budgetPlanDto(view),
  headers: [
    ["etag", etagOf(view.plan.version)],
    ["location", `/api/v1/spaces/${view.plan.spaceId}/plans/${view.plan.id}`],
  ],
});
```

In `src/composition/openapi.ts`:

1. Insert after the line `import { balancesPaths } from "@/modules/balances/contracts/balances.contract";`:

```ts
import { BudgetPlanSchema } from "@/modules/budgeting/contracts/budgeting.contract";
```

2. Insert after the line `        RecordedExpense: RecordedExpenseSchema,`:

```ts
        BudgetPlan: BudgetPlanSchema,
```

- [ ] **Step 4: Run the tests to verify they pass, then refresh the snapshot**

Run: `pnpm exec vitest run --project unit src/shared/http src/modules/budgeting/contracts src/modules/ledger/contracts`
Expected: PASS (the ledger's contract tests still parse `"33.33"` percentages through the moved helpers).
Run: `pnpm exec vitest run --project unit src/composition/openapi.test.ts`
Expected: FAIL only on `expect(doc.components).toEqual(committed.components)`: the diff is the new `BudgetPlan` component; `changedOperations` is `[]`, so no ledger operation changed.
Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: only `components.schemas.BudgetPlan` is added (about 280 lines; it references `MoneyOutput`, the period is inline); no `PeriodOutput` or `BudgetPlanOutput` appears.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/http/contracts.ts src/shared/http/contracts.test.ts src/modules/ledger/contracts/ledger.contract.ts src/modules/budgeting/contracts/budgeting.contract.ts src/modules/budgeting/contracts/budgeting.contract.test.ts src/composition/openapi.ts openapi/openapi.snapshot.json
git commit -m "feat(budgeting): describe budget plans on the wire with shared two-decimal percentages (Refs #47, Refs #48, Refs #49, Refs #50, Refs #51)"
```

---

### Task 9b: HTTP — create and read a plan

Implements HU-E6-01 (issue #47) over HTTP, binds the plans' stored periods (D10) and the currency lock (D6). Pins Review Focus 4 (policy and currency changes) and Review Focus 5 (malformed and foreign plan ids over HTTP).

Decisions:
- `POST /api/v1/spaces/{spaceId}/plans` (body `{ "period": "2026-11" }`) answers `201` with the plan, `ETag: "1"` and `Location`; `GET …/plans/{planId}` answers `200` with `ETag` (HU-E6-01 note). Plans create no transactions, so no `Idempotency-Key` (spec 7).
- The composition root replaces the M1 placeholder `storedPeriods` (always `[]`) with the plans' stored periods, so `GET …/periods`, the ledger's `?period=` labels and new plans all respect stored boundaries (D10). `hasMoneyRecords` also counts plans: a plan's amounts are in the space currency (D6), so changing it answers `SpaceCurrencyLocked`.
- `budgetingDeps` is one object literal without a type annotation; each later task adds its ports to it, and every factory call checks it structurally against its own deps type.

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/plans/route.ts`, `src/app/api/v1/spaces/[spaceId]/plans/[planId]/route.ts`, `tests/support/budgeting.ts`, `tests/acceptance/budget-plans.test.ts`
- Modify: `src/modules/budgeting/contracts/budgeting.contract.ts`, `src/composition/container.ts`, `src/composition/openapi.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E6-budgeting.md`

**Interfaces:**
- Consumes: `createCreateBudgetPlan`, `createGetBudgetPlan`, `CreateBudgetPlan`, `GetBudgetPlan` (Task 8); `DrizzleBudgetPlanRepository` (Task 6); `DrizzleLedgerQueries.expensesByCategory`, `.transfersIntoAccounts` (Task 7); `BudgetPlanSchema`, `planCreated`, `planSuccess` (Task 9a); `defineRoute`; `call`, `problemOf`, `registerUser`, `startTestApp` (`tests/support/app.ts`); `cop`, `household`, `MoneyDto` (`tests/support/ledger.ts`); `newSharedSpace` (`tests/support/spaces.ts`).
- Produces:
  - `CreatePlanBodySchema`, `budgetingPaths` (`budgeting.contract.ts`); `PlanPath` and `SpacePath` (module-private) for the later paths
  - `Container.budgeting: { createPlan: CreateBudgetPlan; getPlan: GetBudgetPlan }`; the container's `budgetPlans` repository and `budgetingDeps` object (later tasks add ports after the line `    plans: budgetPlans,`)
  - `PlanDto`, `LineDto`, `AllocationMemberDto`, `plansPath(spaceId: string, rest?: string): string`, `createPlan(user, spaceId, period): Promise<Response>`, `newPlan(user, spaceId, period): Promise<PlanDto>`, `getPlan(user, spaceId, planId): Promise<Response>`, `planOf(user, spaceId, planId): Promise<PlanDto>` (`tests/support/budgeting.ts`)

- [ ] **Step 1: Write the HTTP helpers and the failing acceptance test**

`tests/support/budgeting.ts`:

```ts
import { GET as getPlanRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/route";
import { POST as createPlanRoute } from "@/app/api/v1/spaces/[spaceId]/plans/route";
import { call, type TestUser } from "./app";
import type { MoneyDto } from "./ledger";

export interface AllocationMemberDto {
  memberId: string;
  percent: string | null;
  amount: MoneyDto | null;
  assigned: MoneyDto | null;
}
export interface LineDto {
  id: string;
  name: string;
  plannedAmount: MoneyDto;
  funding: string;
  rolloverMode: string;
  isCatchAll: boolean;
  savingsAccountIds: string[];
  categoryIds: string[];
  capacityShare: string | null;
  allocation: { rule: string; members: AllocationMemberDto[]; error: string | null };
  spent: MoneyDto;
  available: MoneyDto;
}
export interface PlanDto {
  id: string;
  spaceId: string;
  period: { label: string; startDate: string; endDate: string };
  status: string;
  createdFrom: string | null;
  version: number;
  capacities: { memberId: string; amount: MoneyDto; share: string | null }[];
  totalCapacity: MoneyDto;
  planned: MoneyDto;
  unallocated: MoneyDto;
  lines: LineDto[];
  unbudgeted: { spent: MoneyDto; available: MoneyDto } | null;
}

export const plansPath = (spaceId: string, rest = "") => `/api/v1/spaces/${spaceId}/plans${rest}`;

/** HU-E6-01: `user` asks for a plan for `period` ("2026-11", "2026-11 H1") in `spaceId`. */
export const createPlan = (user: TestUser, spaceId: string, period: string) =>
  call(createPlanRoute, "POST", plansPath(spaceId), { user, params: { spaceId }, body: { period } });

/** Creates the plan; throws unless it was created. */
export const newPlan = async (user: TestUser, spaceId: string, period: string): Promise<PlanDto> => {
  const response = await createPlan(user, spaceId, period);
  if (response.status !== 201) throw new Error(`plan creation failed with status ${response.status}`);
  return (await response.json()) as PlanDto;
};

export const getPlan = (user: TestUser, spaceId: string, planId: string) =>
  call(getPlanRoute, "GET", plansPath(spaceId, `/${planId}`), { user, params: { spaceId, planId } });

/** The plan as `user` reads it; throws unless 200. */
export const planOf = async (user: TestUser, spaceId: string, planId: string): Promise<PlanDto> => {
  const response = await getPlan(user, spaceId, planId);
  if (response.status !== 200) throw new Error(`plan read failed with status ${response.status}`);
  return (await response.json()) as PlanDto;
};
```

`tests/acceptance/budget-plans.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listPeriods } from "@/app/api/v1/spaces/[spaceId]/periods/route";
import { POST as createPlanRoute } from "@/app/api/v1/spaces/[spaceId]/plans/route";
import { PATCH as updateSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { createPlan, getPlan, newPlan, plansPath } from "../support/budgeting";
import { cop, household } from "../support/ledger";
import { newSharedSpace } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const patchSpace = (user: TestUser, spaceId: string, body: unknown) =>
  call(updateSpace, "PATCH", `/api/v1/spaces/${spaceId}`, { user, params: { spaceId }, body });
const periods = async (user: TestUser, spaceId: string, query: string) => {
  const response = await call(listPeriods, "GET", `/api/v1/spaces/${spaceId}/periods${query}`, {
    user,
    params: { spaceId },
  });
  return ((await response.json()) as { items: unknown[] }).items;
};

describe("create a plan for a period (HU-E6-01)", () => {
  it("creates a DRAFT plan for 2026-11 from 2026-11-01 to 2026-11-30 and reads it back with its ETag", async () => {
    const h = await household();
    const created = await createPlan(h.ana, h.spaceId, "2026-11");
    expect(created.status).toBe(201);
    expect(created.headers.get("etag")).toBe('"1"');
    const plan = await created.json();
    expect(created.headers.get("location")).toBe(plansPath(h.spaceId, `/${plan.id}`));
    expect(plan).toEqual({
      id: plan.id,
      spaceId: h.spaceId,
      period: { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" },
      status: "DRAFT",
      createdFrom: null,
      version: 1,
      capacities: [
        { memberId: h.ana.memberId, amount: cop(0), share: null },
        { memberId: h.juan.memberId, amount: cop(0), share: null },
      ],
      totalCapacity: cop(0),
      planned: cop(0),
      unallocated: cop(0),
      lines: [],
      unbudgeted: { spent: cop(0), available: cop(0) },
    });
    const read = await getPlan(h.juan, h.spaceId, plan.id);
    expect([read.status, read.headers.get("etag")]).toEqual([200, '"1"']);
    expect(await read.json()).toEqual(plan);
  });

  it("allows only one plan per period", async () => {
    const h = await household();
    await newPlan(h.ana, h.spaceId, "2026-11");
    expect(await problemOf(await createPlan(h.ana, h.spaceId, "2026-11"))).toEqual([409, "PlanAlreadyExists"]);
  });

  it("lets only owners and admins create plans, and hides plans from anyone else (Review Focus 5)", async () => {
    const h = await household();
    const marta = await registerUser("Marta");
    expect(await problemOf(await createPlan(h.juan, h.spaceId, "2026-12"))).toEqual([403, "InsufficientRole"]);
    expect(await problemOf(await createPlan(marta, h.spaceId, "2026-12"))).toEqual([404, "SpaceNotFound"]);
    const plan = await newPlan(h.ana, h.spaceId, "2026-11");
    expect(await problemOf(await getPlan(marta, h.spaceId, plan.id))).toEqual([404, "SpaceNotFound"]);
    expect(await problemOf(await getPlan(h.ana, h.spaceId, "not-a-uuid"))).toEqual([404, "BudgetPlanNotFound"]);
    const personal = await newPlan(h.ana.personal, h.ana.personal.spaceId, "2026-11");
    expect(await problemOf(await getPlan(h.ana, h.spaceId, personal.id))).toEqual([404, "BudgetPlanNotFound"]);
  });

  it("gives a personal space a plan with Ana as its only member", async () => {
    const ana = await registerUser("Ana");
    const plan = await newPlan(ana, ana.spaceId, "2026-11");
    expect([plan.status, plan.capacities.length]).toEqual(["DRAFT", 1]);
  });

  it("gives a semi-monthly space two plans per month", async () => {
    const ana = await registerUser("Ana");
    const semi = await patchSpace(ana, ana.spaceId, { periodPolicy: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } });
    expect(semi.status).toBe(200);
    const h1 = await newPlan(ana, ana.spaceId, "2026-11 H1");
    const h2 = await newPlan(ana, ana.spaceId, "2026-11 H2");
    expect([h1.period, h2.period]).toEqual([
      { label: "2026-11 H1", startDate: "2026-11-01", endDate: "2026-11-15" },
      { label: "2026-11 H2", startDate: "2026-11-16", endDate: "2026-11-30" },
    ]);
    expect(h1.id).not.toBe(h2.id);
  });

  it("refuses a label that names no period of the policy, and a malformed body", async () => {
    const ana = await registerUser("Ana");
    expect(await problemOf(await createPlan(ana, ana.spaceId, "2026-13"))).toEqual([422, "InvalidPeriodLabel"]);
    const malformed = await call(createPlanRoute, "POST", plansPath(ana.spaceId), {
      user: ana,
      params: { spaceId: ana.spaceId },
      body: { period: 202611 },
    });
    expect(await problemOf(malformed)).toEqual([422, "ValidationFailed"]);
  });
});

describe("plans keep their stored boundaries (D10, D6, Review Focus 4)", () => {
  it("keeps the 2026-11 plan's dates after the policy moves to the 25th, and starts the next plan after it", async () => {
    const ana = await registerUser("Ana");
    await newPlan(ana, ana.spaceId, "2026-11");
    expect((await patchSpace(ana, ana.spaceId, { periodPolicy: { kind: "MONTHLY", day: 25 } })).status).toBe(200);
    expect(await periods(ana, ana.spaceId, "?from=2026-11-10&count=2")).toEqual([
      { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" },
      { label: "2026-12", startDate: "2026-12-01", endDate: "2026-12-24" },
    ]);
    const december = await newPlan(ana, ana.spaceId, "2026-12");
    expect(december.period).toEqual({ label: "2026-12", startDate: "2026-12-01", endDate: "2026-12-24" });
  });

  it("locks the space currency once a plan exists", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana, "Trip");
    expect((await patchSpace(ana, spaceId, { currency: "USD" })).status).toBe(200);
    expect((await patchSpace(ana, spaceId, { currency: "COP" })).status).toBe(200);
    await newPlan(ana, spaceId, "2026-11");
    expect(await problemOf(await patchSpace(ana, spaceId, { currency: "USD" }))).toEqual([
      409,
      "SpaceCurrencyLocked",
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/budget-plans.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/plans/[planId]/route"`.

- [ ] **Step 3: Implement the routes, paths and wiring**

In `src/modules/budgeting/contracts/budgeting.contract.ts`:

1. Replace the line `import { MoneySchema, percentOf, PeriodSchema, periodDto, type MoneyDto } from "@/shared/http/contracts";` with:

```ts
import type { ZodOpenApiPathsObject } from "zod-openapi";
import {
  jsonContent,
  MoneySchema,
  percentOf,
  PeriodSchema,
  periodDto,
  problems,
  securedByUser,
  type MoneyDto,
} from "@/shared/http/contracts";
```

2. Insert before the line `const lineDto = (figure: LineFigure, currency: string): z.infer<typeof BudgetLineSchema> => {`:

```ts
/** HU-E6-01: the period's label in the space policy, e.g. "2026-11" (MONTHLY) or "2026-11 H1" (SEMI_MONTHLY). */
export const CreatePlanBodySchema = z.object({ period: z.string().max(20) });

```

3. Append to the end of the file:

```ts

const SpacePath = z.object({ spaceId: z.string() });
const PlanPath = SpacePath.extend({ planId: z.string() });
const planResponse = (description: string) => ({ description, content: jsonContent(BudgetPlanSchema) });

export const budgetingPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces/{spaceId}/plans": {
    post: {
      operationId: "createBudgetPlan",
      summary: "Create a DRAFT plan for a period of the space's policy; its boundaries are stored (D10)",
      ...securedByUser,
      requestParams: { path: SpacePath },
      requestBody: { content: jsonContent(CreatePlanBodySchema) },
      responses: {
        "201": planResponse("The new plan; ETag carries its version, Location its URL"),
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound",
          "409": "PlanAlreadyExists, SpaceArchived",
          "422": "ValidationFailed, InvalidPeriodLabel",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/plans/{planId}": {
    get: {
      operationId: "getBudgetPlan",
      summary: "A plan with its capacities, lines and every figure computed on read; ETag carries its version",
      ...securedByUser,
      requestParams: { path: PlanPath },
      responses: {
        "200": planResponse("The plan"),
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound, BudgetPlanNotFound" }),
      },
    },
  },
};
```

`src/app/api/v1/spaces/[spaceId]/plans/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { CreatePlanBodySchema, planCreated } from "@/modules/budgeting/contracts/budgeting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: CreatePlanBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().budgeting.createPlan({
      spaceId: params.spaceId!,
      userId: user!.id,
      period: body.period,
    });
    return result.ok ? ok(planCreated(result.value)) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/plans/[planId]/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { planSuccess } from "@/modules/budgeting/contracts/budgeting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().budgeting.getPlan({
      spaceId: params.spaceId!,
      userId: user!.id,
      planId: params.planId!,
    });
    return result.ok ? ok(planSuccess(result.value)) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert after the line `} from "@/modules/balances/application";`:

```ts
import {
  createCreateBudgetPlan,
  createGetBudgetPlan,
  type CreateBudgetPlan,
  type GetBudgetPlan,
} from "@/modules/budgeting/application";
import { DrizzleBudgetPlanRepository } from "@/modules/budgeting/infrastructure/drizzle-budget-plan-repository";
```

2. Insert before the line `  /** Brute-force guards for the unauthenticated identity routes; false means "reject with 429". */`:

```ts
  readonly budgeting: {
    readonly createPlan: CreateBudgetPlan;
    readonly getPlan: GetBudgetPlan;
  };
```

3. Replace the two lines `  // Budget plans (stored period boundaries, D10) arrive with HU-E6-01; until then periods come from the policy.` and `  const storedPeriods: StoredPeriodSource = async () => [];` with:

```ts
  // HU-E6-01, D10: plans store their period boundaries; periods without a plan follow the space policy.
  const budgetPlans = new DrizzleBudgetPlanRepository(tm);
  const storedPeriods: StoredPeriodSource = (spaceId) => budgetPlans.storedPeriods(spaceId);
```

4. Insert before the line `  const invitationRepository = new DrizzleInvitationRepository(tm);`:

```ts
  // HU-E6-01 … HU-E6-05: plans reach members, accounts, categories and the ledger's spending only through ports.
  const budgetingDeps = {
    access,
    members: spaceRepository,
    plans: budgetPlans,
    spending: ledgerQueries,
    ids,
    clock,
    tm,
  };
```

5. Replace the three lines from `          hasMoneyRecords: async (spaceId) =>` through `            (await ledgerQueries.hasTransactions(spaceId)),` with:

```ts
          // D6: a plan's capacities and lines are amounts in the space currency too (HU-E6-01).
          hasMoneyRecords: async (spaceId) =>
            (await accountsDeps.accounts.listBySpace(spaceId)).length > 0 ||
            (await ledgerQueries.hasTransactions(spaceId)) ||
            (await budgetPlans.hasPlans(spaceId)),
```

6. Insert before the line `    authThrottle: {`:

```ts
    budgeting: {
      createPlan: createCreateBudgetPlan(budgetingDeps),
      getPlan: createGetBudgetPlan(budgetingDeps),
    },
```

In `src/composition/openapi.ts`:

1. Replace the line `import { BudgetPlanSchema } from "@/modules/budgeting/contracts/budgeting.contract";` with:

```ts
import { BudgetPlanSchema, budgetingPaths } from "@/modules/budgeting/contracts/budgeting.contract";
```

2. Insert after the line `      ...balancesPaths,`:

```ts
      ...budgetingPaths,
```

In `docs/backlog/E6-budgeting.md`, insert after the line `- Invariant: unique (spaceId, startDate); the period is resolved with the space \`periodPolicy\`, and its label, startDate and endDate are stored on the plan at creation (spec 5.2, D10).`:

```md
- Authorization: the matrix action `plan.manage` (OWNER, ADMIN; in a personal space, its owner) creates and edits plans; reads are `space.read`, so an archived space still reads its plans (HU-E1-09). Errors: `PlanAlreadyExists` (409), `InvalidPeriodLabel` (422), `BudgetPlanNotFound` (404, also for malformed ids and other spaces' plans).
- Every plan response carries `ETag: "<version>"`; every write to a plan or its parts bumps the version and honours an optional `If-Match` (412 `PreconditionFailed`, spec 7). Plans' stored periods take precedence over the policy in `GET …/periods` and in the ledger's period labels (D10), and a space with a plan cannot change its currency (`SpaceCurrencyLocked`, D6).
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `POST /api/v1/spaces/{spaceId}/plans` and `GET /api/v1/spaces/{spaceId}/plans/{planId}` (about 130 lines, both referencing `BudgetPlan`); components are unchanged.
Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project acceptance tests/acceptance/budget-plans.test.ts tests/acceptance/space-settings.test.ts tests/acceptance/ledger.test.ts`
Expected: PASS, M1's period and currency scenarios included (spaces without plans behave as before). Mutation check: temporarily restore `const storedPeriods: StoredPeriodSource = async () => [];` — "keeps the 2026-11 plan's dates …" fails on the periods list; restore the binding.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/contracts/budgeting.contract.ts "src/app/api/v1/spaces/[spaceId]/plans/route.ts" "src/app/api/v1/spaces/[spaceId]/plans/[planId]/route.ts" src/composition/container.ts src/composition/openapi.ts openapi/openapi.snapshot.json docs/backlog/E6-budgeting.md tests/support/budgeting.ts tests/acceptance/budget-plans.test.ts
git commit -m "feat(budgeting): create and read plans over HTTP with stored period boundaries (Refs #47)"
```

---

### Task 10: Budgeting — SetMemberCapacities and SuggestCapacity

Implements HU-E6-02 (issue #48) at the use-case level, with its persistence. Pins Review Focus 1 (a stale `If-Match` changes nothing) and Review Focus 2 (guests, Marta, own-only capacities).

Decisions:
- `SetMemberCapacities` goes through `planForWrite` with its own rule: `capacity.setOwn` when every listed capacity is the caller's own member, otherwise `plan.manage` (ruling P2). The domain checks the entries (Task 1); the repository inserts or replaces each listed member's row, so members not listed keep theirs (ruling P5) and nothing is deleted.
- Lowering capacities below the planned lines is allowed and shows as negative unallocated capacity (HU-E6-02); proportional assignments change on the next read (HU-E6-02 note).
- `SuggestCapacity` reads through `space.read` and answers only for the caller's own member (D17): the income recorded in the caller's personal space during the period before the plan's, i.e. the policy period that contains the day before the plan starts, stored plans first (spec 5.3 "the previous period of the same policy"; a 2026-11 H2 plan looks at 2026-11 H1). It saves nothing and bumps no version. The `PreviousIncome` port is asked only for the caller's user; the composition root binds it (Task 11). If the personal space keeps another currency, there is no suggestion (D6: no conversion).

**Files:**
- Create: `src/modules/budgeting/application/set-member-capacities.ts`, `src/modules/budgeting/application/suggest-capacity.ts`
- Modify: `src/modules/budgeting/application/ports.ts`, `src/modules/budgeting/application/index.ts`, `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.ts`, `tests/support/in-memory-budgeting.ts`, `tests/support/budgeting-world.ts`
- Test: `src/modules/budgeting/application/capacities.test.ts`, `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts`

**Interfaces:**
- Consumes: `checkedCapacities`, `MemberCapacity` (Task 1); `planForWrite`, `readablePlan`, `loadPlanView`, `BudgetingDeps`, `createCreateBudgetPlan` (Task 8); `budgetingWorld`, `HOUSEHOLD` (Task 8); `aLine` (Task 2); `requirePermission` (spaces); `resolvePeriod`, `addDays` (kernel).
- Produces:
  - `interface CapacityRepository { setCapacities(planId: BudgetPlanId, capacities: readonly MemberCapacity[], at: Date): Promise<void> }`
  - `type PreviousIncome = (userId: string, from: LocalDate, to: LocalDate) => Promise<{ amount: bigint; currency: string } | null>`
  - `interface SetMemberCapacitiesInput { spaceId: string; userId: string; planId: string; expectedVersion: number | null; capacities: readonly { memberId: string; amount: Money }[] }`; `type SetMemberCapacities = (input) => Promise<Result<BudgetPlanView>>`; `type CapacityDeps = BudgetingDeps & { capacities: CapacityRepository }`; `createSetMemberCapacities(deps: CapacityDeps)` — `SpaceNotFound`, `SpaceArchived`, `InsufficientRole`, `BudgetPlanNotFound`, `PreconditionFailed`, `InvalidCapacity`, `NotASpaceMember`, `CurrencyMismatch`
  - `interface CapacitySuggestion { memberId: string; period: Period; suggested: bigint | null; currency: string }`; `type SuggestCapacity = (input: { spaceId; userId; planId }) => Promise<Result<CapacitySuggestion>>`; `createSuggestCapacity(deps: BudgetingDeps & { previousIncome: PreviousIncome })` — `SpaceNotFound`, `BudgetPlanNotFound`
  - `DrizzleBudgetPlanRepository.setCapacities`, `InMemoryBudgetPlans.setCapacities` (both satisfy `CapacityRepository` structurally; the integration test checks it); `fixedIncome(byUser: Record<string, bigint>, currency?: string): { previousIncome: PreviousIncome; asked: { userId; from; to }[] }` (`tests/support/budgeting-world.ts`)

- [ ] **Step 1: Write the port, the twin and the failing tests**

In `src/modules/budgeting/application/ports.ts`:

1. Insert after the line `import type { LocalDate, StoredPeriod } from "@/shared/kernel";`:

```ts
import type { MemberCapacity } from "../domain/capacity";
```

2. Append to the end of the file:

```ts

/** HU-E6-02: capacities are edited in place; a member without one counts as 0. */
export interface CapacityRepository {
  /** Inserts or replaces the capacity of each listed member; members not listed keep theirs. */
  setCapacities(planId: BudgetPlanId, capacities: readonly MemberCapacity[], at: Date): Promise<void>;
}

/**
 * D17: the income `userId` recorded in their personal space dated within [from, to], in its currency; null when
 * the user has no personal space. Bound to the spaces and ledger modules; only the caller's income is asked for.
 */
export type PreviousIncome = (
  userId: string,
  from: LocalDate,
  to: LocalDate,
) => Promise<{ readonly amount: bigint; readonly currency: string } | null>;
```

In `tests/support/in-memory-budgeting.ts`, insert before the line `  /** Test setup: parts of a plan as earlier writes would have left them. */`:

```ts
  /** CapacityRepository, like DrizzleBudgetPlanRepository.setCapacities. */
  async setCapacities(planId: string, capacities: readonly MemberCapacity[]): Promise<void> {
    this.mergeCapacities(planId, capacities);
  }

```

In `tests/support/budgeting-world.ts`:

1. Replace the line `import type { BudgetingDeps, PlanSpending } from "@/modules/budgeting/application";` with:

```ts
import type { BudgetingDeps, PlanSpending, PreviousIncome } from "@/modules/budgeting/application";
```

2. Append to the end of the file:

```ts

/** D17 PreviousIncome over fixed personal-space incomes per user (COP unless given); records who was asked. */
export const fixedIncome = (byUser: Readonly<Record<string, bigint>>, currency = "COP") => {
  const asked: { userId: string; from: LocalDate; to: LocalDate }[] = [];
  const previousIncome: PreviousIncome = async (userId, from, to) => {
    asked.push({ userId, from, to });
    return { amount: byUser[userId] ?? 0n, currency };
  };
  return { previousIncome, asked };
};
```

`src/modules/budgeting/application/capacities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { aLine } from "../../../../tests/support/budget-fixtures";
import { budgetingWorld, fixedIncome, HOUSEHOLD } from "../../../../tests/support/budgeting-world";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createSetMemberCapacities } from "./set-member-capacities";
import { createSuggestCapacity } from "./suggest-capacity";

const cop = (pesos: number) => money(BigInt(pesos) * 100n);

/** HU-E6-02 Background: a DRAFT plan for 2026-11 in Household. */
const world = async () => {
  const w = budgetingWorld();
  const create = createCreateBudgetPlan(w.deps);
  const plan = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" })).plan;
  const set = createSetMemberCapacities({ ...w.deps, capacities: w.plans });
  const as = (userId: string, capacities: [string, number][], expectedVersion: number | null = null) =>
    set({
      spaceId: HOUSEHOLD,
      userId,
      planId: plan.id,
      expectedVersion,
      capacities: capacities.map(([memberId, pesos]) => ({ memberId, amount: cop(pesos) })),
    });
  return { ...w, plan, as };
};

describe("SetMemberCapacities (HU-E6-02)", () => {
  it("sets capacities that define the proportional ratio 40.00 % / 60.00 % (golden)", async () => {
    const { as } = await world();
    const view = unwrap(
      await as("u-ana", [
        ["member-ana", 1_600_000],
        ["member-juan", 2_400_000],
      ]),
    );
    expect(view.figures.totalCapacity).toBe(400_000_000n);
    expect(view.figures.capacities.map((c) => [c.memberId, c.amount, c.shareBasisPoints])).toEqual([
      ["member-ana", 160_000_000n, 4000],
      ["member-juan", 240_000_000n, 6000],
      ["member-sofi", 0n, 0],
      ["member-pedro", 0n, 0],
    ]);
    expect(view.plan.version).toBe(2);
  });

  it("keeps the members it does not list, and gives the guest Pedro a capacity (D15)", async () => {
    const { as } = await world();
    unwrap(
      await as("u-ana", [
        ["member-ana", 1_600_000],
        ["member-juan", 2_400_000],
      ]),
    );
    const view = unwrap(
      await as("u-ana", [
        ["member-juan", 2_000_000],
        ["member-pedro", 300_000],
      ]),
    );
    expect(view.figures.capacities.map((c) => c.amount)).toEqual([160_000_000n, 200_000_000n, 0n, 30_000_000n]);
  });

  it("reports negative unallocated capacity once capacities fall below the planned lines", async () => {
    const { as, plans, plan } = await world();
    unwrap(
      await as("u-ana", [
        ["member-ana", 1_600_000],
        ["member-juan", 2_400_000],
      ]),
    );
    plans.seed(plan.id, { lines: [aLine("Home", 400_000_000n)] });
    const view = unwrap(await as("u-ana", [["member-juan", 2_000_000]]));
    expect([view.figures.totalCapacity, view.figures.unallocated]).toEqual([360_000_000n, -40_000_000n]);
  });

  it("rejects a negative capacity and a capacity for Marta, who is neither a member nor a guest", async () => {
    const { as } = await world();
    expect(codeOf(await as("u-ana", [["member-juan", -100_000]]))).toBe("InvalidCapacity");
    expect(codeOf(await as("u-ana", [["member-marta-personal", 100_000]]))).toBe("NotASpaceMember");
  });

  it("lets Juan the MEMBER set only his own capacity, and Sofi the VIEWER none (D17)", async () => {
    const { as } = await world();
    expect(codeOf(await as("u-juan", [["member-juan", 2_400_000]]))).toBe("ok");
    expect(codeOf(await as("u-juan", [["member-ana", 1]]))).toBe("InsufficientRole");
    expect(
      codeOf(
        await as("u-juan", [
          ["member-juan", 1],
          ["member-ana", 1],
        ]),
      ),
    ).toBe("InsufficientRole");
    expect(codeOf(await as("u-sofi", [["member-sofi", 1]]))).toBe("InsufficientRole");
  });

  it("refuses a stale If-Match and changes nothing (Review Focus 1)", async () => {
    const { as, plans, plan } = await world();
    expect(codeOf(await as("u-ana", [["member-ana", 1_600_000]], 7))).toBe("PreconditionFailed");
    expect(plans.capacities.get(plan.id)).toBeUndefined();
    expect(codeOf(await as("u-ana", [["member-ana", 1_600_000]], 1))).toBe("ok");
  });

  it("refuses changes in an archived space (HU-E1-09)", async () => {
    const { as, spaces } = await world();
    spaces.archived.add(HOUSEHOLD);
    expect(codeOf(await as("u-ana", [["member-ana", 1]]))).toBe("SpaceArchived");
  });
});

describe("SuggestCapacity (HU-E6-02, D17)", () => {
  it("suggests Ana her own 2026-10 income for the 2026-11 plan and saves nothing", async () => {
    const { deps, plan, plans } = await world();
    const income = fixedIncome({ "u-ana": 165_000_000n });
    const suggest = createSuggestCapacity({ ...deps, previousIncome: income.previousIncome });
    expect(unwrap(await suggest({ spaceId: HOUSEHOLD, userId: "u-ana", planId: plan.id }))).toEqual({
      memberId: "member-ana",
      period: { label: "2026-10", start: "2026-10-01", end: "2026-10-31" },
      suggested: 165_000_000n,
      currency: "COP",
    });
    expect(income.asked).toEqual([{ userId: "u-ana", from: "2026-10-01", to: "2026-10-31" }]);
    expect(plans.capacities.get(plan.id)).toBeUndefined();
    expect(plans.plans[0]!.version).toBe(1);
  });

  it("answers Juan with his own suggestion only, never asking for Ana's income", async () => {
    const { deps, plan } = await world();
    const income = fixedIncome({ "u-ana": 165_000_000n, "u-juan": 240_000_000n });
    const suggest = createSuggestCapacity({ ...deps, previousIncome: income.previousIncome });
    const juan = unwrap(await suggest({ spaceId: HOUSEHOLD, userId: "u-juan", planId: plan.id }));
    expect([juan.memberId, juan.suggested]).toEqual(["member-juan", 240_000_000n]);
    expect(income.asked.map((a) => a.userId)).toEqual(["u-juan"]);
  });

  it("suggests nothing when the personal space keeps another currency, and hides the plan from Marta", async () => {
    const { deps, plan } = await world();
    const dollars = createSuggestCapacity({
      ...deps,
      previousIncome: fixedIncome({ "u-ana": 500n }, "USD").previousIncome,
    });
    expect(unwrap(await dollars({ spaceId: HOUSEHOLD, userId: "u-ana", planId: plan.id })).suggested).toBeNull();
    expect(codeOf(await dollars({ spaceId: HOUSEHOLD, userId: "u-marta", planId: plan.id }))).toBe(
      "SpaceNotFound",
    );
  });

  it("looks at the previous period of the policy: 2026-11 H1 for a 2026-11 H2 plan", async () => {
    const w = budgetingWorld({ periodPolicy: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } });
    const create = createCreateBudgetPlan(w.deps);
    const h2 = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11 H2" })).plan;
    const income = fixedIncome({});
    const suggest = createSuggestCapacity({ ...w.deps, previousIncome: income.previousIncome });
    unwrap(await suggest({ spaceId: HOUSEHOLD, userId: "u-ana", planId: h2.id }));
    expect(income.asked).toEqual([{ userId: "u-ana", from: "2026-11-01", to: "2026-11-15" }]);
  });
});
```

In `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts`:

1. Replace the line `import { categoryFixture, sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";` with:

```ts
import {
  categoryFixture,
  guestMemberFixture,
  sharedSpaceFixture,
  userFixture,
} from "../../../../tests/support/fixtures";
```

2. Replace the line `import type { BudgetPlanRepository } from "../application/ports";` with:

```ts
import type { BudgetPlanRepository, CapacityRepository } from "../application/ports";
```

3. Append to the end of the file:

```ts

describe("DrizzleBudgetPlanRepository capacities (HU-E6-02)", () => {
  it("inserts and replaces capacities like its in-memory twin, keeping the members not listed", async () => {
    const { space, fixture } = await household();
    const pedro = await guestMemberFixture(pool, fixture, "Pedro");
    const november = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    const run = async (plans: BudgetPlanRepository & CapacityRepository) => {
      await plans.add(november);
      await plans.setCapacities(
        november.id,
        [
          { memberId: fixture.memberId, amount: 160_000_000n },
          { memberId: pedro, amount: 1n },
        ],
        at,
      );
      await plans.setCapacities(november.id, [{ memberId: pedro, amount: 30_000_000n }], at);
      await plans.setCapacities(november.id, [], at);
      return (await plans.contents(november.id)).capacities;
    };
    const expected = [
      { memberId: fixture.memberId, amount: 160_000_000n },
      { memberId: pedro, amount: 30_000_000n },
    ].sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
    expect(await run(new InMemoryBudgetPlans())).toEqual(expected);
    expect(await run(repo)).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/application/capacities.test.ts && pnpm exec vitest run --project integration src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts`
Expected: FAIL — `Failed to resolve import "./set-member-capacities"`, and `plans.setCapacities is not a function` for the PostgreSQL repository.

- [ ] **Step 3: Implement**

In `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.ts`:

1. Insert after the line `import type { BudgetLine, BudgetLineId } from "../domain/budget-line";`:

```ts
import type { MemberCapacity } from "../domain/capacity";
```

2. Insert before the last line of the file (`}`):

```ts

  async setCapacities(planId: BudgetPlanId, capacities: readonly MemberCapacity[], at: Date): Promise<void> {
    if (capacities.length === 0) return;
    await this.tm
      .executor()
      .insert(budgetMemberCapacities)
      .values(capacities.map((c) => ({ planId, memberId: c.memberId, amount: c.amount, updatedAt: at })))
      // HU-E6-02: an edit, not a delete: the member's row keeps its key and takes the new amount.
      .onConflictDoUpdate({
        target: [budgetMemberCapacities.planId, budgetMemberCapacities.memberId],
        set: { amount: sql`excluded.amount`, updatedAt: sql`excluded.updated_at` },
      });
  }
```

`src/modules/budgeting/application/set-member-capacities.ts`:

```ts
import { requirePermission, type SpaceMembership } from "@/modules/spaces/application";
import { ok, type Money, type Result } from "@/shared/kernel";
import { checkedCapacities } from "../domain/capacity";
import type { BudgetingDeps } from "./deps";
import { planForWrite } from "./plan-access";
import { loadPlanView, type BudgetPlanView } from "./plan-view";
import type { CapacityRepository } from "./ports";

export interface SetMemberCapacitiesInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly planId: string;
  /** If-Match: the plan version the caller last read; null skips the check. */
  readonly expectedVersion: number | null;
  readonly capacities: readonly { readonly memberId: string; readonly amount: Money }[];
}

export type SetMemberCapacities = (input: SetMemberCapacitiesInput) => Promise<Result<BudgetPlanView>>;

export type CapacityDeps = BudgetingDeps & { readonly capacities: CapacityRepository };

/**
 * HU-E6-02, D17: OWNER and ADMIN set anyone's capacity (plan.manage); a registered MEMBER sets only their own
 * (capacity.setOwn). Members not listed keep theirs; proportional assignments follow on the next read.
 */
export const createSetMemberCapacities =
  (deps: CapacityDeps): SetMemberCapacities =>
  (input) =>
    deps.tm.run(async () => {
      const onlyOwn = (m: SpaceMembership) => input.capacities.every((c) => c.memberId === m.memberId);
      const write = await planForWrite(deps, input, (m) =>
        requirePermission(m, onlyOwn(m) ? "capacity.setOwn" : "plan.manage"),
      );
      if (!write.ok) return write;
      const { space, plan, members } = write.value;
      const capacities = checkedCapacities(
        input.capacities,
        members.map((m) => m.id),
        space.currency,
      );
      if (!capacities.ok) return capacities;
      await deps.capacities.setCapacities(plan.id, capacities.value, deps.clock.now());
      return ok(await loadPlanView(deps, space, plan));
    });
```

`src/modules/budgeting/application/suggest-capacity.ts`:

```ts
import { addDays, ok, resolvePeriod, type Period, type Result } from "@/shared/kernel";
import type { BudgetingDeps } from "./deps";
import { readablePlan } from "./plan-access";
import type { PreviousIncome } from "./ports";

export interface CapacitySuggestion {
  /** The caller's own member in the plan's space. */
  readonly memberId: string;
  /** The period before the plan's, in the space policy around the stored plans (spec 5.3). */
  readonly period: Period;
  /** Minor units of the space currency; null when the caller's personal space keeps another currency (D6). */
  readonly suggested: bigint | null;
  readonly currency: string;
}

export type SuggestCapacity = (input: {
  spaceId: string;
  userId: string;
  planId: string;
}) => Promise<Result<CapacitySuggestion>>;

/**
 * HU-E6-02, D17: the income the caller recorded in their personal space during the period before the plan's, as
 * a suggestion for their own capacity. Nothing is saved, and nobody else's income is ever read.
 */
export const createSuggestCapacity =
  (deps: BudgetingDeps & { readonly previousIncome: PreviousIncome }): SuggestCapacity =>
  async (input) => {
    const found = await readablePlan(deps, input);
    if (!found.ok) return found;
    const { space, plan } = found.value;
    const stored = await deps.plans.storedPeriods(space.spaceId);
    const previous = resolvePeriod(space.periodPolicy, stored, addDays(plan.period.start, -1));
    const income = await deps.previousIncome(input.userId, previous.start, previous.end);
    return ok({
      memberId: space.memberId,
      period: previous,
      suggested: income !== null && income.currency === space.currency ? income.amount : null,
      currency: space.currency,
    });
  };
```

Append to `src/modules/budgeting/application/index.ts`:

```ts
export type { CapacityRepository, PreviousIncome } from "./ports";
export {
  createSetMemberCapacities,
  type CapacityDeps,
  type SetMemberCapacities,
  type SetMemberCapacitiesInput,
} from "./set-member-capacities";
export { createSuggestCapacity, type CapacitySuggestion, type SuggestCapacity } from "./suggest-capacity";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/budgeting && pnpm exec vitest run --project integration src/modules/budgeting`
Expected: PASS. Mutation check: temporarily replace `onlyOwn(m) ? "capacity.setOwn" : "plan.manage"` with `"capacity.setOwn"` — "lets Juan the MEMBER set only his own capacity" fails on Ana's capacity; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/application/ports.ts src/modules/budgeting/application/set-member-capacities.ts src/modules/budgeting/application/suggest-capacity.ts src/modules/budgeting/application/index.ts src/modules/budgeting/application/capacities.test.ts src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.ts src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts tests/support/in-memory-budgeting.ts tests/support/budgeting-world.ts
git commit -m "feat(budgeting): set member capacities and suggest one's own from last period's income (Refs #48)"
```

---

### Task 11: HTTP — capacities and the capacity suggestion

Implements HU-E6-02 (issue #48) over HTTP and binds the private income suggestion (D17). Pins Review Focus 1 (`412` over HTTP) and Review Focus 2 (Marta's member id, the guest Pedro, Juan's own capacity).

Decisions:
- `PUT …/plans/{planId}/capacities` takes `{ "capacities": [{ "memberId", "amount" }] }` (at least one entry) and an optional `If-Match`; it answers `200` with the plan and its new ETag. `GET …/plans/{planId}/capacity-suggestion` answers `{ memberId, period, suggested }` for the caller only.
- Every plan write shares one OpenAPI helper, `planWrite`: the path, the optional `If-Match` header, the body, and the plan as the answer (`200`, or `201` for `POST …/lines`).
- The composition root binds `PreviousIncome` to the caller's own personal space (`listForUser`, kind `PERSONAL`) and the ledger's `totals` there (`income` of live INCOME transactions within the dates); no other user's space is ever read.

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/plans/[planId]/capacities/route.ts`, `src/app/api/v1/spaces/[spaceId]/plans/[planId]/capacity-suggestion/route.ts`, `tests/acceptance/budget-capacities.test.ts`
- Modify: `src/modules/budgeting/contracts/budgeting.contract.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`, `tests/support/budgeting.ts`, `docs/backlog/E6-budgeting.md`

**Interfaces:**
- Consumes: `createSetMemberCapacities`, `createSuggestCapacity`, `SetMemberCapacities`, `SuggestCapacity`, `CapacitySuggestion`, `PreviousIncome` (Task 10); `planSuccess`, `budgetingPaths`, `PlanPath` (Tasks 9a, 9b); `ifMatchVersion` (`@/shared/http`); `DrizzleLedgerQueries.totals`, `DrizzleSpaceRepository.listForUser`; `addGuest`, `categoryWithKey`, `cop`, `household`, `memberIdOf`, `post` (`tests/support/ledger.ts`).
- Produces:
  - `SetCapacitiesBodySchema`, `capacitiesFromBody(body): Result<{ memberId: string; amount: Money }[]>`, `CapacitySuggestionSchema`, `capacitySuggestionDto(s: CapacitySuggestion)`, the module-private `Id`, `MAX_MEMBERS`, `IfMatchHeader` and `planWrite(operationId, summary, path, body, errors, status?)` (`budgeting.contract.ts`)
  - `Container.budgeting.setCapacities: SetMemberCapacities`, `Container.budgeting.suggestCapacity: SuggestCapacity`
  - `putCapacities(user, spaceId, planId, capacities: [memberId, pesos][], version?): Promise<Response>`, `setCapacities(...same): Promise<PlanDto>`, `getSuggestion(user, spaceId, planId): Promise<Response>` (`tests/support/budgeting.ts`)

- [ ] **Step 1: Write the HTTP helpers and the failing acceptance test**

In `tests/support/budgeting.ts`:

1. Insert after the line `import { POST as createPlanRoute } from "@/app/api/v1/spaces/[spaceId]/plans/route";`:

```ts
import { PUT as putCapacitiesRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/capacities/route";
import { GET as suggestionRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/capacity-suggestion/route";
```

2. Replace the line `import type { MoneyDto } from "./ledger";` with:

```ts
import { cop, type MoneyDto } from "./ledger";
```

3. Append to the end of the file:

```ts

/** `If-Match: "<version>"` when a version is given. */
export const ifMatch = (version?: number): Record<string, string> =>
  version === undefined ? {} : { "if-match": `"${version}"` };

/** HU-E6-02: `user` sets the capacities of `[memberId, pesos]` pairs. */
export const putCapacities = (
  user: TestUser,
  spaceId: string,
  planId: string,
  capacities: [string, number][],
  version?: number,
) =>
  call(putCapacitiesRoute, "PUT", plansPath(spaceId, `/${planId}/capacities`), {
    user,
    params: { spaceId, planId },
    body: { capacities: capacities.map(([memberId, pesos]) => ({ memberId, amount: cop(pesos) })) },
    headers: ifMatch(version),
  });

/** Sets the capacities and returns the plan; throws unless 200. */
export const setCapacities = async (...args: Parameters<typeof putCapacities>): Promise<PlanDto> => {
  const response = await putCapacities(...args);
  if (response.status !== 200) throw new Error(`capacities failed with status ${response.status}`);
  return (await response.json()) as PlanDto;
};

/** HU-E6-02, D17: the caller's own capacity suggestion. */
export const getSuggestion = (user: TestUser, spaceId: string, planId: string) =>
  call(suggestionRoute, "GET", plansPath(spaceId, `/${planId}/capacity-suggestion`), {
    user,
    params: { spaceId, planId },
  });
```

`tests/acceptance/budget-capacities.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { PATCH as updateSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp } from "../support/app";
import { getSuggestion, newPlan, planOf, putCapacities, setCapacities } from "../support/budgeting";
import { addGuest, categoryWithKey, cop, household, memberIdOf, post } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** HU-E6-02 Background: a DRAFT plan for 2026-11 in Household with Ana and Juan. */
const draft = async () => {
  const h = await household();
  const plan = await newPlan(h.ana, h.spaceId, "2026-11");
  return { h, planId: plan.id };
};
const OCTOBER = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };

describe("member capacities (HU-E6-02)", () => {
  it("sets capacities that define the proportional ratio Ana 40.00 % and Juan 60.00 % (golden)", async () => {
    const { h, planId } = await draft();
    const response = await putCapacities(h.ana, h.spaceId, planId, [
      [h.ana.memberId, 1_600_000],
      [h.juan.memberId, 2_400_000],
    ]);
    expect([response.status, response.headers.get("etag")]).toEqual([200, '"2"']);
    const plan = await response.json();
    expect(plan.totalCapacity).toEqual(cop(4_000_000));
    expect(plan.capacities).toEqual([
      { memberId: h.ana.memberId, amount: cop(1_600_000), share: "40.00" },
      { memberId: h.juan.memberId, amount: cop(2_400_000), share: "60.00" },
    ]);
  });

  it("rejects a negative capacity, a capacity for Marta, and an empty request", async () => {
    const { h, planId } = await draft();
    const negative = await putCapacities(h.ana, h.spaceId, planId, [[h.juan.memberId, -100_000]]);
    expect(await problemOf(negative)).toEqual([422, "InvalidCapacity"]);
    const marta = await registerUser("Marta");
    const martaMember = await memberIdOf(marta, marta.spaceId, "Marta");
    const foreign = await putCapacities(h.ana, h.spaceId, planId, [[martaMember, 100_000]]);
    expect(await problemOf(foreign)).toEqual([422, "NotASpaceMember"]);
    expect(await problemOf(await putCapacities(h.ana, h.spaceId, planId, []))).toEqual([422, "ValidationFailed"]);
  });

  it("lets the guest Pedro hold capacity, and Juan the MEMBER set only his own (D15, D17)", async () => {
    const { h, planId } = await draft();
    const pedro = await addGuest(h, "Pedro");
    await setCapacities(h.ana, h.spaceId, planId, [[pedro, 300_000]]);
    await setCapacities(h.juan, h.spaceId, planId, [[h.juan.memberId, 2_400_000]]);
    const anas = await putCapacities(h.juan, h.spaceId, planId, [[h.ana.memberId, 1]]);
    expect(await problemOf(anas)).toEqual([403, "InsufficientRole"]);
    const plan = await planOf(h.ana, h.spaceId, planId);
    expect(plan.capacities.map((c) => [c.memberId, c.amount])).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(2_400_000)],
      [pedro, cop(300_000)],
    ]);
  });

  it("refuses a stale If-Match with 412 and changes nothing (Review Focus 1)", async () => {
    const { h, planId } = await draft();
    await setCapacities(h.ana, h.spaceId, planId, [[h.ana.memberId, 1_600_000]], 1);
    const stale = await putCapacities(h.ana, h.spaceId, planId, [[h.ana.memberId, 1]], 1);
    expect(await problemOf(stale)).toEqual([412, "PreconditionFailed"]);
    const plan = await planOf(h.ana, h.spaceId, planId);
    expect([plan.version, plan.capacities[0]!.amount]).toEqual([2, cop(1_600_000)]);
  });

  it("gives each plan of a semi-monthly space its own capacities (HU-E6-01)", async () => {
    const ana = await registerUser("Ana");
    const semi = await call(updateSpace, "PATCH", `/api/v1/spaces/${ana.spaceId}`, {
      user: ana,
      params: { spaceId: ana.spaceId },
      body: { periodPolicy: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } },
    });
    expect(semi.status).toBe(200);
    const h1 = await newPlan(ana, ana.spaceId, "2026-11 H1");
    const h2 = await newPlan(ana, ana.spaceId, "2026-11 H2");
    const member = h1.capacities[0]!.memberId;
    await setCapacities(ana, ana.spaceId, h1.id, [[member, 800_000]]);
    expect((await planOf(ana, ana.spaceId, h1.id)).totalCapacity).toEqual(cop(800_000));
    expect((await planOf(ana, ana.spaceId, h2.id)).totalCapacity).toEqual(cop(0));
  });
});

describe("capacity suggestion (HU-E6-02, D17)", () => {
  it("suggests Ana her 2026-10 personal income, saves nothing, and never shows it to Juan", async () => {
    const { h, planId } = await draft();
    const salary = await categoryWithKey(h.ana.personal, "salary");
    const income = await post(recordIncome, h.ana.personal, "incomes", {
      description: "Salary",
      date: "2026-10-15",
      categoryId: salary,
      amount: cop(1_650_000),
      accountId: h.ana.account,
    });
    expect(income.status).toBe(201);
    const suggestion = await getSuggestion(h.ana, h.spaceId, planId);
    expect([suggestion.status, await suggestion.json()]).toEqual([
      200,
      { memberId: h.ana.memberId, period: OCTOBER, suggested: cop(1_650_000) },
    ]);
    expect((await planOf(h.ana, h.spaceId, planId)).capacities[0]!.amount).toEqual(cop(0));
    const juans = await (await getSuggestion(h.juan, h.spaceId, planId)).text();
    expect(JSON.parse(juans)).toEqual({ memberId: h.juan.memberId, period: OCTOBER, suggested: cop(0) });
    expect(juans).not.toContain("165000000");
    expect(JSON.stringify(await planOf(h.juan, h.spaceId, planId))).not.toContain("165000000");
    await setCapacities(h.ana, h.spaceId, planId, [[h.ana.memberId, 1_650_000]]);
    expect((await planOf(h.juan, h.spaceId, planId)).capacities[0]!.amount).toEqual(cop(1_650_000));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/budget-capacities.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/plans/[planId]/capacities/route"`.

- [ ] **Step 3: Implement the contract, routes and wiring**

In `src/modules/budgeting/contracts/budgeting.contract.ts`:

1. Insert after the line `  jsonContent,`:

```ts
  moneyFromDto,
```

2. Insert after the line `import { etagOf } from "@/shared/http/etag";`:

```ts
import { ok, type Money, type Result } from "@/shared/kernel";
```

3. Insert after the line `  type BudgetPlanView,`:

```ts
  type CapacitySuggestion,
```

4. Insert before the line `const lineDto = (figure: LineFigure, currency: string): z.infer<typeof BudgetLineSchema> => {`:

```ts
const Id = z.string().min(1).max(64);
/** Members per request: bounds the payload; membership is checked by the domain. */
const MAX_MEMBERS = 100;

/** HU-E6-02: the listed members' capacities; members not listed keep theirs. */
export const SetCapacitiesBodySchema = z.object({
  capacities: z
    .array(z.object({ memberId: Id, amount: MoneySchema }))
    .min(1)
    .max(MAX_MEMBERS),
});

/** HU-E6-02: the capacities as the use case takes them; fails only for currencies the kernel does not know. */
export const capacitiesFromBody = (
  body: z.infer<typeof SetCapacitiesBodySchema>,
): Result<{ memberId: string; amount: Money }[]> => {
  const capacities: { memberId: string; amount: Money }[] = [];
  for (const entry of body.capacities) {
    const amount = moneyFromDto(entry.amount);
    if (!amount.ok) return amount;
    capacities.push({ memberId: entry.memberId, amount: amount.value });
  }
  return ok(capacities);
};

/** HU-E6-02, D17: only ever the caller's own suggestion. */
export const CapacitySuggestionSchema = z.object({
  memberId: z.string(),
  /** The period whose income is suggested: the one before the plan's (spec 5.3). */
  period: PeriodSchema,
  /** Null when the caller's personal space keeps another currency (no conversion, D6). */
  suggested: MoneySchema.nullable(),
});

export const capacitySuggestionDto = (s: CapacitySuggestion): z.infer<typeof CapacitySuggestionSchema> => ({
  memberId: s.memberId,
  period: periodDto(s.period),
  suggested: s.suggested === null ? null : moneyOf(s.suggested, s.currency),
});

```

5. Insert before the line `export const budgetingPaths: ZodOpenApiPathsObject = {`:

```ts
const IfMatchHeader = z.object({ "if-match": z.string().optional() });

/** A write to a plan (HU-E6-02 … HU-E6-05): If-Match is optional, and the answer is the plan with its new ETag. */
const planWrite = <P extends z.ZodObject>(
  operationId: string,
  summary: string,
  path: P,
  body: z.ZodType | null,
  errors: Record<string, string>,
  status: "200" | "201" = "200",
) => ({
  operationId,
  summary,
  ...securedByUser,
  requestParams: { path, header: IfMatchHeader },
  ...(body === null ? {} : { requestBody: { content: jsonContent(body) } }),
  responses: {
    [status]: planResponse("The plan with its new ETag"),
    ...problems({ "401": "Unauthenticated", "403": "InsufficientRole", "412": "PreconditionFailed", ...errors }),
  },
});

```

6. Insert before the last line of the file (`};`, which closes `budgetingPaths`):

```ts
  "/api/v1/spaces/{spaceId}/plans/{planId}/capacities": {
    put: planWrite(
      "setMemberCapacities",
      "Set the listed members' capacities; the others keep theirs, and a MEMBER may set only their own (D17)",
      PlanPath,
      SetCapacitiesBodySchema,
      {
        "404": "SpaceNotFound, BudgetPlanNotFound",
        "409": "SpaceArchived",
        "422": "ValidationFailed, InvalidCapacity, NotASpaceMember, CurrencyMismatch, UnknownCurrency",
      },
    ),
  },
  "/api/v1/spaces/{spaceId}/plans/{planId}/capacity-suggestion": {
    get: {
      operationId: "suggestCapacity",
      summary: "The caller's own previous-period personal income as a capacity suggestion; saved nowhere (D17)",
      ...securedByUser,
      requestParams: { path: PlanPath },
      responses: {
        "200": { description: "The caller's suggestion", content: jsonContent(CapacitySuggestionSchema) },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound, BudgetPlanNotFound" }),
      },
    },
  },
```

`src/app/api/v1/spaces/[spaceId]/plans/[planId]/capacities/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  capacitiesFromBody,
  planSuccess,
  SetCapacitiesBodySchema,
} from "@/modules/budgeting/contracts/budgeting.contract";
import { ifMatchVersion } from "@/shared/http";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const PUT = defineRoute({
  auth: "required",
  body: SetCapacitiesBodySchema,
  handler: async ({ request, user, params, body }) => {
    // Spec 7: If-Match is checked when present; a stale version is 412.
    const expectedVersion = ifMatchVersion(request);
    if (!expectedVersion.ok) return expectedVersion;
    const capacities = capacitiesFromBody(body);
    if (!capacities.ok) return capacities;
    const result = await getContainer().budgeting.setCapacities({
      spaceId: params.spaceId!,
      userId: user!.id,
      planId: params.planId!,
      expectedVersion: expectedVersion.value,
      capacities: capacities.value,
    });
    return result.ok ? ok(planSuccess(result.value)) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/plans/[planId]/capacity-suggestion/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { capacitySuggestionDto } from "@/modules/budgeting/contracts/budgeting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().budgeting.suggestCapacity({
      spaceId: params.spaceId!,
      userId: user!.id,
      planId: params.planId!,
    });
    return result.ok ? ok({ status: 200, body: capacitySuggestionDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert after the line `  createGetBudgetPlan,`:

```ts
  createSetMemberCapacities,
  createSuggestCapacity,
```

2. Insert after the line `  type GetBudgetPlan,`:

```ts
  type PreviousIncome,
  type SetMemberCapacities,
  type SuggestCapacity,
```

3. Insert after the line `    readonly getPlan: GetBudgetPlan;`:

```ts
    readonly setCapacities: SetMemberCapacities;
    readonly suggestCapacity: SuggestCapacity;
```

4. Insert before the line `  // HU-E6-01 … HU-E6-05: plans reach members, accounts, categories and the ledger's spending only through ports.`:

```ts
  // D17: only the caller's own personal-space income is ever read for a capacity suggestion.
  const previousIncome: PreviousIncome = async (userId, from, to) => {
    const personal = (await spaceRepository.listForUser(userId)).find((s) => s.kind === "PERSONAL");
    if (!personal) return null;
    const { income } = await ledgerQueries.totals({ spaceId: personal.id, from, to });
    return { amount: income, currency: personal.currency };
  };
```

5. Insert after the line `    plans: budgetPlans,`:

```ts
    capacities: budgetPlans,
    previousIncome,
```

6. Insert after the line `      getPlan: createGetBudgetPlan(budgetingDeps),`:

```ts
      setCapacities: createSetMemberCapacities(budgetingDeps),
      suggestCapacity: createSuggestCapacity(budgetingDeps),
```

In `docs/backlog/E6-budgeting.md`, insert after the line `- Changing capacities re-derives every PROPORTIONAL assignment (computed on read).`:

```md
- `PUT …/capacities` sets the listed members' capacities and keeps the others' (an edit in place, never a delete). OWNER and ADMIN set anyone's (`plan.manage`); a registered MEMBER sets only their own (`capacity.setOwn`, D17); VIEWER none. Errors: `InvalidCapacity` (422: negative, or a member listed twice), `NotASpaceMember` (422), `CurrencyMismatch` (422). Only current members count toward total capacity: a member who left keeps their row but drops out.
- `GET …/capacity-suggestion` answers `{ memberId, period, suggested }` for the caller's own member: the income recorded in their personal space during the period before the plan's (the previous period of the policy, spec 5.3); `suggested` is null when that space keeps another currency.
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `PUT /api/v1/spaces/{spaceId}/plans/{planId}/capacities` (with the optional `if-match` header parameter) and `GET /api/v1/spaces/{spaceId}/plans/{planId}/capacity-suggestion` (about 180 lines); components are unchanged.
Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project acceptance tests/acceptance/budget-capacities.test.ts tests/acceptance/budget-plans.test.ts`
Expected: PASS. Mutation check: temporarily bind `previousIncome` to `async () => ({ amount: 165_000_000n, currency: "COP" })` — Juan's suggestion assertion fails; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/contracts/budgeting.contract.ts "src/app/api/v1/spaces/[spaceId]/plans/[planId]/capacities/route.ts" "src/app/api/v1/spaces/[spaceId]/plans/[planId]/capacity-suggestion/route.ts" src/composition/container.ts openapi/openapi.snapshot.json docs/backlog/E6-budgeting.md tests/support/budgeting.ts tests/acceptance/budget-capacities.test.ts
git commit -m "feat(budgeting): set capacities and read one's own capacity suggestion over HTTP (Refs #48)"
```

---

### Task 12a: Budgeting — budget lines in storage and AddBudgetLine

Implements HU-E6-03 (issue #49) at the use-case level, with the catch-all flag of HU-E6-04 (issue #50) on new lines. Pins Review Focus 5 (savings accounts of non-members, BANK accounts) and Review Focus 6 (a removed line's row stays; Task 12b removes).

Decisions:
- `BudgetLineRepository` adds lines, saves their fields in place (name, planned amount, funding, savings accounts, rollover mode, catch-all) and removes them logically: `deleteLine` sets `deleted_at` once and ends the line's current mappings, so the line leaves every read and its name and categories are free again (D8). `saveLine` never changes the allocation rule; only allocating the line does (Task 17).
- `AddBudgetLine` writes through `planForWrite` (plan.manage, version lock), takes the planned amount in the space currency (`CurrencyMismatch`), defaults the funding to DIRECT and the rollover mode to RESET when they are absent (HU-E6-03 scenarios add lines without naming them), validates the line against the other current lines and the total capacity of the current members (Task 2), then checks the savings accounts it names.
- Savings accounts (ruling P8, amended after the final review): SAVINGS accounts live in their owners' personal spaces, and a SAVINGS line newly names only SAVINGS accounts the CALLER owns (the ledger's `ownAccount` rule, D9). Every account the caller cannot attach (unknown, malformed, ownerless, another user's, whatever its type or state) answers the same `AccountNotFound` with identical details, so no other user's account is revealed. Of the caller's own accounts, a non-SAVINGS one answers `InvalidSavingsAccount`, an archived one `AccountArchived` and one in another currency than the space's `CurrencyMismatch` (D6). Only accounts the line did not name before are checked (Task 12b relies on it). The first reading, "accounts of any current registered member", is superseded; the Task 12a and Task 12b code below shows it.
- `lineOf` answers `BudgetLineNotFound` for any id that is not a current line of the plan (removed lines, other plans' lines and malformed ids alike); it searches the parts already loaded, so no request id reaches a query.

**Files:**
- Create: `src/modules/budgeting/application/line-checks.ts`, `src/modules/budgeting/application/add-budget-line.ts`
- Modify: `src/modules/budgeting/application/ports.ts`, `src/modules/budgeting/application/index.ts`, `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.ts`, `tests/support/in-memory-budgeting.ts`, `tests/support/budgeting-world.ts`
- Test: `src/modules/budgeting/application/lines.test.ts`, `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts`

**Interfaces:**
- Consumes: `newLine`, `BudgetLine`, `BudgetLineId`, `LineContext`, `Funding`, `RolloverMode` (Task 2); `totalCapacity` (Task 1); `planForWrite`, `loadPlanView` (Task 8); `createSetMemberCapacities` (Task 10); `aLine` (Task 2); `budgetingWorld`, `HOUSEHOLD` (Task 8).
- Produces:
  - `interface BudgetLineRepository { addLine(line: BudgetLine, at: Date): Promise<void>; saveLine(line: BudgetLine, at: Date): Promise<void>; deleteLine(planId: BudgetPlanId, lineId: BudgetLineId, at: Date): Promise<void> }`
  - `interface BudgetAccount { id: string; ownerUserId: string | null; isSavings: boolean; archived: boolean }`; `interface SavingsAccountReader { find(accountId: string): Promise<BudgetAccount | null> }`
  - `inSpaceCurrency(space: SpaceMembership, money: Money): Result<bigint>`; `lineOf(parts: PlanContents, lineId: string): Result<BudgetLine>`; `lineContext(parts: PlanContents, members: readonly SpaceMember[], lineId: string | null): LineContext`; `usableSavingsAccounts(accounts: SavingsAccountReader, members: readonly SpaceMember[], accountIds: readonly string[], already?: readonly string[]): Promise<Result<void>>` (`line-checks.ts`)
  - `interface LineInput { name: string; plannedAmount: Money; funding?: Funding; rolloverMode?: RolloverMode; savingsAccountIds?: readonly string[]; isCatchAll?: boolean }`; `type LineDeps = BudgetingDeps & { lines: BudgetLineRepository; savingsAccounts: SavingsAccountReader }`; `type AddBudgetLine = (input: { spaceId; userId; planId; expectedVersion: number | null; line: LineInput }) => Promise<Result<BudgetPlanView>>`; `createAddBudgetLine(deps: LineDeps)` — `SpaceNotFound`, `SpaceArchived`, `InsufficientRole`, `BudgetPlanNotFound`, `PreconditionFailed`, `CurrencyMismatch`, `InvalidBudgetLineName`, `InvalidPlannedAmount`, `SavingsAccountRequired`, `InvalidSavingsAccount`, `SavingsLineNotMappable`, `BudgetLineNameTaken`, `CatchAllLineAlreadySet`, `SavingsAccountAlreadyUsed`, `PlanExceedsCapacity`, `AccountNotFound`, `AccountArchived`
  - `DrizzleBudgetPlanRepository.addLine`, `.saveLine`, `.deleteLine`; the same on `InMemoryBudgetPlans`
  - `ACCOUNTS` (`acc-savings` and `acc-old-savings` (archived) of Ana, `acc-bank` (BANK) of Ana, `acc-juan-savings`, `acc-marta-savings`) and `savingsAccounts: SavingsAccountReader` (`tests/support/budgeting-world.ts`)

- [ ] **Step 1: Write the port, the twin, the test data and the failing tests**

In `src/modules/budgeting/application/ports.ts`:

1. Insert after the line `import type { MemberCapacity } from "../domain/capacity";`:

```ts
import type { BudgetLine, BudgetLineId } from "../domain/budget-line";
```

2. Append to the end of the file:

```ts

/** HU-E6-03: lines are edited in place and removed logically (D8). */
export interface BudgetLineRepository {
  addLine(line: BudgetLine, at: Date): Promise<void>;
  /** Persists the name, planned amount, funding, savings accounts, rollover mode and catch-all flag of a current line. */
  saveLine(line: BudgetLine, at: Date): Promise<void>;
  /** D8: sets deletedAt once and ends the line's current category mappings; its name and categories are free again. */
  deleteLine(planId: BudgetPlanId, lineId: BudgetLineId, at: Date): Promise<void>;
}

/** What budgeting needs to know about an account a SAVINGS line names; bound to the accounts module. */
export interface BudgetAccount {
  readonly id: string;
  readonly ownerUserId: string | null;
  readonly isSavings: boolean;
  readonly archived: boolean;
}

export interface SavingsAccountReader {
  /** Any account by id, whatever its space; null for unknown or malformed ids. */
  find(accountId: string): Promise<BudgetAccount | null>;
}
```

In `tests/support/in-memory-budgeting.ts`, insert before the line `  /** Test setup: parts of a plan as earlier writes would have left them. */`:

```ts
  /** BudgetLineRepository, like DrizzleBudgetPlanRepository.addLine. */
  async addLine(line: BudgetLine): Promise<void> {
    this.lines.push({ line, deletedAt: null });
  }

  /** BudgetLineRepository: every field but the allocation rule, which only setAllocation changes. */
  async saveLine(line: BudgetLine): Promise<void> {
    this.lines = this.lines.map((r) =>
      r.line.id === line.id && r.deletedAt === null
        ? { ...r, line: { ...line, allocationRule: r.line.allocationRule } }
        : r,
    );
  }

  /** BudgetLineRepository: the row stays with deletedAt, and the line's current mappings end. */
  async deleteLine(planId: string, lineId: string, at: Date): Promise<void> {
    this.lines = this.lines.map((r) =>
      r.line.id === lineId && r.line.planId === planId && r.deletedAt === null ? { ...r, deletedAt: at } : r,
    );
    this.mappings = this.mappings.map((r) =>
      r.mapping.lineId === lineId && r.unmappedAt === null ? { ...r, unmappedAt: at } : r,
    );
  }

```

In `tests/support/budgeting-world.ts`:

1. Replace the line `import type { BudgetingDeps, PlanSpending, PreviousIncome } from "@/modules/budgeting/application";` with:

```ts
import type {
  BudgetAccount,
  BudgetingDeps,
  PlanSpending,
  PreviousIncome,
  SavingsAccountReader,
} from "@/modules/budgeting/application";
```

2. Append to the end of the file:

```ts

/** HU-E6-03 accounts: Ana's savings account, her archived one and her BANK account; Juan's and Marta's savings. */
export const ACCOUNTS: readonly BudgetAccount[] = [
  { id: "acc-savings", ownerUserId: "u-ana", isSavings: true, archived: false },
  { id: "acc-old-savings", ownerUserId: "u-ana", isSavings: true, archived: true },
  { id: "acc-bank", ownerUserId: "u-ana", isSavings: false, archived: false },
  { id: "acc-juan-savings", ownerUserId: "u-juan", isSavings: true, archived: false },
  { id: "acc-marta-savings", ownerUserId: "u-marta", isSavings: true, archived: false },
];

export const savingsAccounts: SavingsAccountReader = {
  find: async (accountId) => ACCOUNTS.find((a) => a.id === accountId) ?? null,
};
```

`src/modules/budgeting/application/lines.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { budgetingWorld, HOUSEHOLD, savingsAccounts } from "../../../../tests/support/budgeting-world";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { createAddBudgetLine, type LineInput } from "./add-budget-line";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createSetMemberCapacities } from "./set-member-capacities";

const cop = (pesos: number) => money(BigInt(pesos) * 100n);
const RENT: LineInput = {
  name: "Rent",
  plannedAmount: cop(1_200_000),
  funding: "SHARED_FUND",
  rolloverMode: "RESET",
};
const HOME: LineInput = { name: "Home", plannedAmount: cop(1_470_000), funding: "DIRECT", rolloverMode: "RESET" };
const SAVINGS: LineInput = {
  name: "Savings",
  plannedAmount: cop(600_000),
  funding: "SAVINGS",
  savingsAccountIds: ["acc-savings"],
};
const FREE: LineInput = { name: "Free", plannedAmount: cop(730_000) };

/** HU-E6-03 Background: a DRAFT plan for 2026-11 with capacities Ana 1,600,000 COP and Juan 2,400,000 COP. */
const world = async () => {
  const w = budgetingWorld();
  const deps = { ...w.deps, capacities: w.plans, lines: w.plans, savingsAccounts };
  const create = createCreateBudgetPlan(deps);
  const plan = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" })).plan;
  const capacities = [
    { memberId: "member-ana", amount: cop(1_600_000) },
    { memberId: "member-juan", amount: cop(2_400_000) },
  ];
  const set = createSetMemberCapacities(deps);
  unwrap(await set({ spaceId: HOUSEHOLD, userId: "u-ana", planId: plan.id, expectedVersion: null, capacities }));
  const add = createAddBudgetLine(deps);
  const addLine = (line: LineInput, userId = "u-ana", expectedVersion: number | null = null) =>
    add({ spaceId: HOUSEHOLD, userId, planId: plan.id, expectedVersion, line });
  return { ...w, deps, plan, addLine };
};

describe("AddBudgetLine (HU-E6-03)", () => {
  it("reports 1,330,000 COP unallocated after Rent and Home, with Home at 36.75 % (golden)", async () => {
    const { addLine } = await world();
    unwrap(await addLine(RENT));
    const view = unwrap(await addLine(HOME));
    expect(view.figures.unallocated).toBe(133_000_000n);
    const home = view.figures.lines.find((l) => l.line.name === "Home")!;
    expect([home.capacityShareBasisPoints, home.line.funding, home.line.rolloverMode, home.allocation.rule]).toEqual([
      3675,
      "DIRECT",
      "RESET",
      "PROPORTIONAL",
    ]);
    expect(view.plan.version).toBe(4);
  });

  it("leaves nothing unallocated with the full reference plan, and refuses Travel past it (golden)", async () => {
    const { addLine } = await world();
    for (const line of [RENT, HOME, SAVINGS]) unwrap(await addLine(line));
    expect(unwrap(await addLine(FREE)).figures.unallocated).toBe(0n);
    expect(codeOf(await addLine({ name: "Travel", plannedAmount: cop(100_000) }))).toBe("PlanExceedsCapacity");
  });

  it("keeps names unique within the plan ignoring case, and planned amounts positive in the space currency", async () => {
    const { addLine } = await world();
    unwrap(await addLine(HOME));
    expect(codeOf(await addLine({ ...HOME, name: "home" }))).toBe("BudgetLineNameTaken");
    expect(codeOf(await addLine({ name: "Gifts", plannedAmount: cop(0) }))).toBe("InvalidPlannedAmount");
    expect(codeOf(await addLine({ name: "Gifts", plannedAmount: money(100n, "USD") }))).toBe("CurrencyMismatch");
  });

  it("requires a savings account of a current member on a SAVINGS line (Review Focus 5)", async () => {
    const { addLine } = await world();
    const savingsWith = (savingsAccountIds: string[]) => addLine({ ...SAVINGS, savingsAccountIds });
    expect(codeOf(await savingsWith([]))).toBe("SavingsAccountRequired");
    expect(codeOf(await savingsWith(["acc-bank"]))).toBe("InvalidSavingsAccount");
    expect(codeOf(await savingsWith(["acc-old-savings"]))).toBe("AccountArchived");
    expect(codeOf(await savingsWith(["acc-marta-savings"]))).toBe("AccountNotFound");
    expect(codeOf(await savingsWith(["acc-unknown"]))).toBe("AccountNotFound");
    const view = unwrap(await savingsWith(["acc-savings", "acc-juan-savings"]));
    expect(view.figures.lines[0]!.line.savingsAccountIds).toEqual(["acc-savings", "acc-juan-savings"]);
  });

  it("adds the catch-all line once (HU-E6-04)", async () => {
    const { addLine } = await world();
    unwrap(await addLine({ ...FREE, isCatchAll: true }));
    expect(codeOf(await addLine({ ...HOME, isCatchAll: true }))).toBe("CatchAllLineAlreadySet");
  });

  it("lets only owners and admins add lines, and refuses a stale If-Match", async () => {
    const { addLine } = await world();
    expect(codeOf(await addLine(HOME, "u-juan"))).toBe("InsufficientRole");
    expect(codeOf(await addLine(HOME, "u-ana", 1))).toBe("PreconditionFailed");
    expect(codeOf(await addLine(HOME, "u-ana", 2))).toBe("ok");
  });
});
```

In `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts`:

1. Insert after the line `import { testDatabase } from "../../../../tests/support/database";`:

```ts
import { aLine } from "../../../../tests/support/budget-fixtures";
```

2. Replace the line `import type { BudgetPlanRepository, CapacityRepository } from "../application/ports";` with:

```ts
import type { BudgetLineRepository, BudgetPlanRepository, CapacityRepository } from "../application/ports";
import type { BudgetLineId } from "../domain/budget-line";
```

3. Append to the end of the file:

```ts

describe("DrizzleBudgetPlanRepository lines (HU-E6-03, D8)", () => {
  it("adds, saves and removes lines like its in-memory twin, keeping the removed row", async () => {
    const { space } = await household();
    const november = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    const home = aLine("Home", 147_000_000n, { id: randomUUID() as BudgetLineId, planId: november.id, createdAt: at });
    const savings = aLine("Savings", 60_000_000n, {
      id: randomUUID() as BudgetLineId,
      planId: november.id,
      funding: "SAVINGS",
      savingsAccountIds: [randomUUID()],
      createdAt: new Date("2026-10-14T12:01:00Z"),
    });
    const house = { ...home, name: "House", plannedAmount: 150_000_000n, rolloverMode: "ROLLOVER" as const, isCatchAll: true };
    const run = async (plans: BudgetPlanRepository & BudgetLineRepository) => {
      await plans.add(november);
      await plans.addLine(home, at);
      await plans.addLine(savings, at);
      await plans.saveLine({ ...house, allocationRule: "NONE" }, at);
      await plans.deleteLine(november.id, savings.id, at);
      await plans.deleteLine(november.id, savings.id, new Date("2026-10-15T00:00:00Z"));
      return (await plans.contents(november.id)).lines;
    };
    expect(await run(new InMemoryBudgetPlans())).toEqual([house]);
    expect(await run(repo)).toEqual([house]);
    const { rows } = await pool.query(
      "SELECT name, allocation_rule, deleted_at FROM budget_lines WHERE plan_id = $1 ORDER BY name",
      [november.id],
    );
    expect(rows).toEqual([
      { name: "House", allocation_rule: "PROPORTIONAL", deleted_at: null },
      { name: "Savings", allocation_rule: "PROPORTIONAL", deleted_at: at },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/application/lines.test.ts && pnpm exec vitest run --project integration src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts`
Expected: FAIL — `Failed to resolve import "./add-budget-line"`, and `plans.addLine is not a function` for the PostgreSQL repository.

- [ ] **Step 3: Implement**

In `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.ts`:

1. Insert before the line `/** Plans and their parts (D7: figures are derived on read; D8: nothing is deleted). */`:

```ts
/** The columns a request may change on a line; the allocation rule changes only with its allocation. */
const lineColumns = (line: BudgetLine) => ({
  name: line.name,
  plannedAmount: line.plannedAmount,
  funding: line.funding,
  savingsAccountIds: [...line.savingsAccountIds],
  rolloverMode: line.rolloverMode,
  isCatchAll: line.isCatchAll,
});

```

2. Insert before the last line of the file (`}`):

```ts

  async addLine(line: BudgetLine, at: Date): Promise<void> {
    await this.tm
      .executor()
      .insert(budgetLines)
      .values({
        ...lineColumns(line),
        id: line.id,
        planId: line.planId,
        originLineId: line.originLineId,
        allocationRule: line.allocationRule,
        createdAt: line.createdAt,
        updatedAt: at,
      });
  }

  async saveLine(line: BudgetLine, at: Date): Promise<void> {
    await this.tm
      .executor()
      .update(budgetLines)
      .set({ ...lineColumns(line), updatedAt: at })
      .where(and(eq(budgetLines.id, line.id), isNull(budgetLines.deletedAt)));
  }

  async deleteLine(planId: BudgetPlanId, lineId: BudgetLineId, at: Date): Promise<void> {
    const db = this.tm.executor();
    // D8: the row stays; the partial unique indexes free its name, its catch-all flag and its categories.
    await db
      .update(budgetLines)
      .set({ deletedAt: at, updatedAt: at })
      .where(and(eq(budgetLines.id, lineId), eq(budgetLines.planId, planId), isNull(budgetLines.deletedAt)));
    await db
      .update(budgetLineCategories)
      .set({ unmappedAt: at })
      .where(and(eq(budgetLineCategories.lineId, lineId), isNull(budgetLineCategories.unmappedAt)));
  }
```

`src/modules/budgeting/application/line-checks.ts`:

```ts
import type { SpaceMember, SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, ok, type Money, type Result } from "@/shared/kernel";
import type { BudgetLine, LineContext } from "../domain/budget-line";
import { totalCapacity } from "../domain/capacity";
import type { PlanContents, SavingsAccountReader } from "./ports";

/** D6: amounts are in the space currency. */
export const inSpaceCurrency = (space: SpaceMembership, money: Money): Result<bigint> =>
  money.currency.code === space.currency
    ? ok(money.minor)
    : err(domainError("CurrencyMismatch", { expected: space.currency, actual: money.currency.code }));

/** A current line of the plan; a removed line, another plan's line or a malformed id is BudgetLineNotFound. */
export const lineOf = (parts: PlanContents, lineId: string): Result<BudgetLine> => {
  const line = parts.lines.find((l) => l.id === lineId);
  return line === undefined ? err(domainError("BudgetLineNotFound")) : ok(line);
};

/** What a line written into the plan sees: the other current lines, the current members' capacity, its categories. */
export const lineContext = (
  parts: PlanContents,
  members: readonly SpaceMember[],
  lineId: string | null,
): LineContext => ({
  siblings: parts.lines.filter((l) => l.id !== lineId),
  totalCapacity: totalCapacity(
    parts.capacities,
    members.map((m) => m.id),
  ),
  mappedCategories: parts.mappings.filter((m) => m.lineId === lineId).length,
});

/**
 * HU-E6-03: the accounts a SAVINGS line newly names are SAVINGS accounts, not archived, owned by a current
 * registered member of the space (they live in their owners' personal spaces, D9). Any other account answers
 * AccountNotFound, so no other user's account is revealed. Accounts the line already named are not checked again.
 */
export const usableSavingsAccounts = async (
  accounts: SavingsAccountReader,
  members: readonly SpaceMember[],
  accountIds: readonly string[],
  already: readonly string[] = [],
): Promise<Result<void>> => {
  const owners = new Set(members.flatMap((m) => (m.userId === null ? [] : [m.userId])));
  for (const accountId of accountIds.filter((id) => !already.includes(id))) {
    const account = await accounts.find(accountId);
    if (account === null || account.ownerUserId === null || !owners.has(account.ownerUserId)) {
      return err(domainError("AccountNotFound"));
    }
    if (!account.isSavings) return err(domainError("InvalidSavingsAccount", { reason: "notSavingsAccount" }));
    if (account.archived) return err(domainError("AccountArchived"));
  }
  return ok(undefined);
};
```

`src/modules/budgeting/application/add-budget-line.ts`:

```ts
import { ok, type Money, type Result } from "@/shared/kernel";
import { newLine, type Funding, type RolloverMode } from "../domain/budget-line";
import type { BudgetingDeps } from "./deps";
import { inSpaceCurrency, lineContext, usableSavingsAccounts } from "./line-checks";
import { planForWrite } from "./plan-access";
import { loadPlanView, type BudgetPlanView } from "./plan-view";
import type { BudgetLineRepository, SavingsAccountReader } from "./ports";

/** HU-E6-03: a new line; DIRECT and RESET unless given. */
export interface LineInput {
  readonly name: string;
  readonly plannedAmount: Money;
  readonly funding?: Funding;
  readonly rolloverMode?: RolloverMode;
  readonly savingsAccountIds?: readonly string[];
  readonly isCatchAll?: boolean;
}

export type AddBudgetLine = (input: {
  spaceId: string;
  userId: string;
  planId: string;
  expectedVersion: number | null;
  line: LineInput;
}) => Promise<Result<BudgetPlanView>>;

export type LineDeps = BudgetingDeps & {
  readonly lines: BudgetLineRepository;
  readonly savingsAccounts: SavingsAccountReader;
};

/**
 * HU-E6-03: an OWNER or ADMIN adds a line whose positive planned amount fits the capacity not yet planned
 * (zero-based budgeting), with a funding source and a rollover mode; it starts PROPORTIONAL (HU-E6-05).
 */
export const createAddBudgetLine =
  (deps: LineDeps): AddBudgetLine =>
  (input) =>
    deps.tm.run(async () => {
      const write = await planForWrite(deps, input);
      if (!write.ok) return write;
      const { space, plan, members, parts } = write.value;
      const planned = inSpaceCurrency(space, input.line.plannedAmount);
      if (!planned.ok) return planned;
      const line = newLine(
        {
          id: deps.ids.next<"BudgetLine">(),
          planId: plan.id,
          now: deps.clock.now(),
          fields: {
            name: input.line.name,
            plannedAmount: planned.value,
            funding: input.line.funding ?? "DIRECT",
            savingsAccountIds: input.line.savingsAccountIds ?? [],
            rolloverMode: input.line.rolloverMode ?? "RESET",
            isCatchAll: input.line.isCatchAll ?? false,
          },
        },
        lineContext(parts, members, null),
      );
      if (!line.ok) return line;
      const accounts = await usableSavingsAccounts(deps.savingsAccounts, members, line.value.savingsAccountIds);
      if (!accounts.ok) return accounts;
      await deps.lines.addLine(line.value, deps.clock.now());
      return ok(await loadPlanView(deps, space, plan));
    });
```

Append to `src/modules/budgeting/application/index.ts`:

```ts
export type { BudgetAccount, BudgetLineRepository, SavingsAccountReader } from "./ports";
export { createAddBudgetLine, type AddBudgetLine, type LineDeps, type LineInput } from "./add-budget-line";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/budgeting && pnpm exec vitest run --project integration src/modules/budgeting`
Expected: PASS. Mutation check: temporarily replace `!owners.has(account.ownerUserId)` with `false` — "requires a savings account of a current member" fails on Marta's account; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/application/ports.ts src/modules/budgeting/application/line-checks.ts src/modules/budgeting/application/add-budget-line.ts src/modules/budgeting/application/index.ts src/modules/budgeting/application/lines.test.ts src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.ts src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts tests/support/in-memory-budgeting.ts tests/support/budgeting-world.ts
git commit -m "feat(budgeting): add budget lines within the plan's capacity (Refs #49, Refs #50)"
```

---

### Task 12b: Budgeting — UpdateBudgetLine and RemoveBudgetLine

Implements the edits and removals of HU-E6-03 (issue #49) and `SetCatchAllLine` of HU-E6-04 (issue #50), which is `UpdateBudgetLine` with `isCatchAll` (the story's endpoint is the line's `PATCH`). Pins Review Focus 6 (a removed line's row stays and its name is free).

Decisions:
- `UpdateBudgetLine` revises the line (Task 2) against the other current lines; an increase past the total capacity is refused, while renaming or lowering a line of a plan that is over its capacity is allowed. It checks only savings accounts the line did not name before, so an account archived since keeps backing its line.
- `RemoveBudgetLine` removes the line logically (Task 12a) and answers the plan without it; removing never needs a capacity check. A second removal of the same line answers `BudgetLineNotFound`.

**Files:**
- Create: `src/modules/budgeting/application/update-budget-line.ts`, `src/modules/budgeting/application/remove-budget-line.ts`
- Modify: `src/modules/budgeting/application/index.ts`
- Test: `src/modules/budgeting/application/lines.test.ts`

**Interfaces:**
- Consumes: `reviseLine`, `Funding`, `RolloverMode` (Task 2); `LineDeps`, `inSpaceCurrency`, `lineContext`, `lineOf`, `usableSavingsAccounts`, `BudgetLineRepository` (Task 12a); `planForWrite`, `loadPlanView` (Task 8); `NOW`, `savingsAccounts` (`tests/support/budgeting-world.ts`).
- Produces:
  - `interface LineChanges { name?: string; plannedAmount?: Money; funding?: Funding; rolloverMode?: RolloverMode; savingsAccountIds?: readonly string[]; isCatchAll?: boolean }`; `type UpdateBudgetLine = (input: { spaceId; userId; planId; lineId: string; expectedVersion: number | null; changes: LineChanges }) => Promise<Result<BudgetPlanView>>`; `createUpdateBudgetLine(deps: LineDeps)` — the errors of `AddBudgetLine` plus `BudgetLineNotFound`
  - `type RemoveBudgetLine = (input: { spaceId; userId; planId; lineId: string; expectedVersion: number | null }) => Promise<Result<BudgetPlanView>>`; `createRemoveBudgetLine(deps: BudgetingDeps & { lines: BudgetLineRepository })` — `SpaceNotFound`, `SpaceArchived`, `InsufficientRole`, `BudgetPlanNotFound`, `PreconditionFailed`, `BudgetLineNotFound`

- [ ] **Step 1: Write the failing tests**

In `src/modules/budgeting/application/lines.test.ts`:

1. Replace the line `import { budgetingWorld, HOUSEHOLD, savingsAccounts } from "../../../../tests/support/budgeting-world";` with:

```ts
import { budgetingWorld, HOUSEHOLD, NOW, savingsAccounts } from "../../../../tests/support/budgeting-world";
```

2. Insert after the line `import { createCreateBudgetPlan } from "./create-budget-plan";`:

```ts
import { createRemoveBudgetLine } from "./remove-budget-line";
```

3. Insert after the line `import { createSetMemberCapacities } from "./set-member-capacities";`:

```ts
import { createUpdateBudgetLine } from "./update-budget-line";
```

4. Append to the end of the file:

```ts

describe("UpdateBudgetLine and RemoveBudgetLine (HU-E6-03, HU-E6-04)", () => {
  /** The reference plan's four lines, all DIRECT or as spec section 4 funds them. */
  const reference = async () => {
    const w = await world();
    let view = unwrap(await w.addLine(RENT));
    for (const line of [HOME, SAVINGS, FREE]) view = unwrap(await w.addLine(line));
    const lines = view.figures.lines;
    const id = (name: string) => lines.find((l) => l.line.name === name)!.line.id;
    const input = (lineId: string, expectedVersion: number | null = null) => ({
      spaceId: HOUSEHOLD,
      userId: "u-ana",
      planId: w.plan.id,
      lineId,
      expectedVersion,
    });
    return { ...w, id, input, update: createUpdateBudgetLine(w.deps), remove: createRemoveBudgetLine(w.deps) };
  };

  it("refuses an increase past the capacity, and lets a plan over its capacity lower a line", async () => {
    const { id, input, update, deps, plan } = await reference();
    const raise = await update({ ...input(id("Home")), changes: { plannedAmount: cop(1_500_000) } });
    expect(codeOf(raise)).toBe("PlanExceedsCapacity");
    const juan = [{ memberId: "member-juan", amount: cop(2_000_000) }];
    const set = createSetMemberCapacities(deps);
    unwrap(await set({ spaceId: HOUSEHOLD, userId: "u-ana", planId: plan.id, expectedVersion: null, capacities: juan }));
    const lowered = unwrap(await update({ ...input(id("Home")), changes: { plannedAmount: cop(1_400_000) } }));
    expect(lowered.figures.unallocated).toBe(-33_000_000n);
  });

  it("renames a line and changes its funding and rollover mode, keeping its allocation rule", async () => {
    const { id, input, update } = await reference();
    const changes = { name: "House", funding: "SHARED_FUND" as const, rolloverMode: "ROLLOVER" as const };
    const view = unwrap(await update({ ...input(id("Home")), changes }));
    const house = view.figures.lines.find((l) => l.line.name === "House")!.line;
    expect([house.funding, house.rolloverMode, house.allocationRule]).toEqual(["SHARED_FUND", "ROLLOVER", "PROPORTIONAL"]);
  });

  it("marks Free as the catch-all line, and refuses a second one (HU-E6-04)", async () => {
    const { id, input, update } = await reference();
    expect(unwrap(await update({ ...input(id("Free")), changes: { isCatchAll: true } })).figures.unbudgeted).toBeNull();
    const second = await update({ ...input(id("Home")), changes: { isCatchAll: true } });
    expect(codeOf(second)).toBe("CatchAllLineAlreadySet");
  });

  it("checks only the savings accounts a line newly names, so an account archived since stays", async () => {
    const { id, input, deps } = await reference();
    const archivedSince = createUpdateBudgetLine({
      ...deps,
      savingsAccounts: {
        find: async (accountId) => {
          const account = await savingsAccounts.find(accountId);
          return account && { ...account, archived: true };
        },
      },
    });
    expect(codeOf(await archivedSince({ ...input(id("Savings")), changes: { name: "Ahorro" } }))).toBe("ok");
    const more = { savingsAccountIds: ["acc-savings", "acc-juan-savings"] };
    expect(codeOf(await archivedSince({ ...input(id("Savings")), changes: more }))).toBe("AccountArchived");
    const onHome = await archivedSince({ ...input(id("Home")), changes: { savingsAccountIds: ["acc-savings"] } });
    expect(codeOf(onHome)).toBe("InvalidSavingsAccount");
  });

  it("removes a line logically: it leaves the figures, frees its name and keeps its row (D8, Review Focus 6)", async () => {
    const { id, input, remove, plans, addLine } = await reference();
    const homeId = id("Home");
    const view = unwrap(await remove(input(homeId)));
    expect(view.figures.lines.map((l) => l.line.name)).toEqual(["Rent", "Savings", "Free"]);
    expect(view.figures.unallocated).toBe(147_000_000n);
    expect(plans.lines.find((r) => r.line.id === homeId)!.deletedAt).toEqual(NOW);
    expect(codeOf(await addLine(HOME))).toBe("ok");
    expect(codeOf(await remove(input(homeId)))).toBe("BudgetLineNotFound");
  });

  it("answers BudgetLineNotFound for unknown lines, and refuses Juan and a stale If-Match", async () => {
    const { id, input, update, remove } = await reference();
    expect(codeOf(await update({ ...input("line-404"), changes: { name: "X" } }))).toBe("BudgetLineNotFound");
    expect(codeOf(await remove({ ...input(id("Home")), userId: "u-juan" }))).toBe("InsufficientRole");
    expect(codeOf(await remove(input(id("Home"), 1)))).toBe("PreconditionFailed");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/application/lines.test.ts`
Expected: FAIL — `Failed to resolve import "./remove-budget-line"`.

- [ ] **Step 3: Implement**

`src/modules/budgeting/application/update-budget-line.ts`:

```ts
import { ok, type Money, type Result } from "@/shared/kernel";
import { reviseLine, type Funding, type RolloverMode } from "../domain/budget-line";
import type { LineDeps } from "./add-budget-line";
import { inSpaceCurrency, lineContext, lineOf, usableSavingsAccounts } from "./line-checks";
import { planForWrite } from "./plan-access";
import { loadPlanView, type BudgetPlanView } from "./plan-view";

/** HU-E6-03, HU-E6-04: what a PATCH changes; absent fields stay. */
export interface LineChanges {
  readonly name?: string;
  readonly plannedAmount?: Money;
  readonly funding?: Funding;
  readonly rolloverMode?: RolloverMode;
  readonly savingsAccountIds?: readonly string[];
  readonly isCatchAll?: boolean;
}

export type UpdateBudgetLine = (input: {
  spaceId: string;
  userId: string;
  planId: string;
  lineId: string;
  expectedVersion: number | null;
  changes: LineChanges;
}) => Promise<Result<BudgetPlanView>>;

/**
 * HU-E6-03: edits a line; increasing it never pushes the plan above its capacity. HU-E6-04 SetCatchAllLine:
 * `isCatchAll` makes it the plan's one catch-all line. Its allocation rule stays (HU-E6-05).
 */
export const createUpdateBudgetLine =
  (deps: LineDeps): UpdateBudgetLine =>
  (input) =>
    deps.tm.run(async () => {
      const write = await planForWrite(deps, input);
      if (!write.ok) return write;
      const { space, plan, members, parts } = write.value;
      const line = lineOf(parts, input.lineId);
      if (!line.ok) return line;
      const { plannedAmount, ...rest } = input.changes;
      const planned = plannedAmount === undefined ? ok(undefined) : inSpaceCurrency(space, plannedAmount);
      if (!planned.ok) return planned;
      const revised = reviseLine(
        line.value,
        { ...rest, plannedAmount: planned.value },
        lineContext(parts, members, line.value.id),
      );
      if (!revised.ok) return revised;
      const accounts = await usableSavingsAccounts(
        deps.savingsAccounts,
        members,
        revised.value.savingsAccountIds,
        line.value.savingsAccountIds,
      );
      if (!accounts.ok) return accounts;
      await deps.lines.saveLine(revised.value, deps.clock.now());
      return ok(await loadPlanView(deps, space, plan));
    });
```

`src/modules/budgeting/application/remove-budget-line.ts`:

```ts
import { ok, type Result } from "@/shared/kernel";
import type { BudgetingDeps } from "./deps";
import { lineOf } from "./line-checks";
import { planForWrite } from "./plan-access";
import { loadPlanView, type BudgetPlanView } from "./plan-view";
import type { BudgetLineRepository } from "./ports";

export type RemoveBudgetLine = (input: {
  spaceId: string;
  userId: string;
  planId: string;
  lineId: string;
  expectedVersion: number | null;
}) => Promise<Result<BudgetPlanView>>;

/**
 * HU-E6-03, D8: removing a line is logical: its row stays with deletedAt, it leaves every figure, and its name and
 * categories are free again. Lowering what is planned never needs a capacity check.
 */
export const createRemoveBudgetLine =
  (deps: BudgetingDeps & { readonly lines: BudgetLineRepository }): RemoveBudgetLine =>
  (input) =>
    deps.tm.run(async () => {
      const write = await planForWrite(deps, input);
      if (!write.ok) return write;
      const line = lineOf(write.value.parts, input.lineId);
      if (!line.ok) return line;
      await deps.lines.deleteLine(write.value.plan.id, line.value.id, deps.clock.now());
      return ok(await loadPlanView(deps, write.value.space, write.value.plan));
    });
```

Append to `src/modules/budgeting/application/index.ts`:

```ts
export { createUpdateBudgetLine, type LineChanges, type UpdateBudgetLine } from "./update-budget-line";
export { createRemoveBudgetLine, type RemoveBudgetLine } from "./remove-budget-line";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/budgeting`
Expected: PASS. Mutation check: temporarily pass `[]` instead of `line.value.savingsAccountIds` to `usableSavingsAccounts` in `UpdateBudgetLine` — "an account archived since stays" fails on the rename; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/application/update-budget-line.ts src/modules/budgeting/application/remove-budget-line.ts src/modules/budgeting/application/index.ts src/modules/budgeting/application/lines.test.ts
git commit -m "feat(budgeting): edit, mark as catch-all and logically remove budget lines (Refs #49, Refs #50)"
```

---

### Task 13: Budgeting — concurrent writes to one plan in PostgreSQL

Pins Review Focus 1 (HU-E6-01, HU-E6-03; issues #47, #49): the capacity invariant and one-plan-per-period hold when two requests arrive at the same moment.

Decisions:
- Two `AddBudgetLine` calls that each fit the capacity but not together run concurrently against PostgreSQL through the real use case and repositories. `planForWrite` takes the version lock before reading the plan's parts, so the second writer waits for the first to commit and then sees its line. A rendezvous in the parts read makes the test fail when the lock is missing: the first reader waits until a second reader arrives or 2 s pass, so without the lock both writers read an empty plan and both lines land (inferred; with the lock the first writer waits the full 2 s, because the second is blocked on the plan row).
- Two simultaneous creations of one period need no lock: whichever reads the stored periods last either sees the first plan or loses `budget_plans_space_start_uq`; both paths answer `PlanAlreadyExists`.

**Files:**
- Test: `src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts`

**Interfaces:**
- Consumes: `createAddBudgetLine` (Task 12a), `createCreateBudgetPlan` (Task 8), `DrizzleBudgetPlanRepository` with `setCapacities` (Tasks 6, 10, 12a), `BudgetPlanRepository`, `PlanSpending`; `DrizzleSpaceRepository`, `createSpaceAccess`; `UuidV7IdGenerator`; `sharedSpaceFixture`, `userFixture`.
- Produces: nothing new (test only).

- [ ] **Step 1: Write the test**

`src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { createSpaceAccess } from "@/modules/spaces/application";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { FixedClock } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";
import { createAddBudgetLine } from "../application/add-budget-line";
import { createCreateBudgetPlan } from "../application/create-budget-plan";
import type { BudgetPlanRepository, PlanSpending } from "../application/ports";
import { DrizzleBudgetPlanRepository } from "./drizzle-budget-plan-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const plans = new DrizzleBudgetPlanRepository(tm);
const spaces = new DrizzleSpaceRepository(tm);
const at = new Date("2026-10-14T12:00:00Z");
const nothingSpent: PlanSpending = {
  expensesByCategory: async () => [],
  transfersIntoAccounts: async () => [],
};

afterAll(() => pool.end());

/** Household with Ana as OWNER and the deps of the real use cases over PostgreSQL. */
const household = async () => {
  const ana = await userFixture(pool, "Ana");
  const space = await sharedSpaceFixture(db, ana.id);
  const deps = {
    access: createSpaceAccess(spaces),
    members: spaces,
    plans,
    spending: nothingSpent,
    ids: new UuidV7IdGenerator(),
    clock: new FixedClock(at),
    tm,
  };
  return { ana, space, deps };
};

/**
 * The plan repository with a rendezvous in front of its parts: the first read waits until a second read arrives or
 * 2 s pass. With the version lock the second writer is still waiting for the plan row, so the first goes on alone.
 */
const racingPlans = (): BudgetPlanRepository => {
  let reads = 0;
  let release: (() => void) | null = null;
  return {
    add: (plan) => plans.add(plan),
    find: (spaceId, planId) => plans.find(spaceId, planId),
    storedPeriods: (spaceId) => plans.storedPeriods(spaceId),
    hasPlans: (spaceId) => plans.hasPlans(spaceId),
    lockForWrite: (planId, expectedVersion, lockedAt) => plans.lockForWrite(planId, expectedVersion, lockedAt),
    contents: async (planId) => {
      reads += 1;
      if (reads === 1) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2_000);
          release = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      } else {
        release?.();
      }
      return plans.contents(planId);
    },
  };
};

describe("concurrent writes to one plan (Review Focus 1)", () => {
  it("adds one of two lines that each fit the capacity but not together", async () => {
    const { ana, space, deps } = await household();
    const create = createCreateBudgetPlan(deps);
    const plan = unwrap(await create({ spaceId: space.id, userId: ana.id, period: "2026-11" })).plan;
    await plans.setCapacities(plan.id, [{ memberId: space.members[0]!.id, amount: 100_000_000n }], at);
    const add = createAddBudgetLine({
      ...deps,
      plans: racingPlans(),
      lines: plans,
      savingsAccounts: { find: async () => null },
    });
    const line = (name: string) =>
      add({
        spaceId: space.id,
        userId: ana.id,
        planId: plan.id,
        expectedVersion: null,
        line: { name, plannedAmount: money(60_000_000n) },
      });
    const outcomes = await Promise.all([line("Home"), line("Rent")]);
    expect(outcomes.map(codeOf).sort()).toEqual(["PlanExceedsCapacity", "ok"]);
    expect((await plans.contents(plan.id)).lines).toHaveLength(1);
  });

  it("creates one of two simultaneous plans for the same period", async () => {
    const { ana, space, deps } = await household();
    const create = createCreateBudgetPlan(deps);
    const input = { spaceId: space.id, userId: ana.id, period: "2026-11" };
    const outcomes = await Promise.all([create(input), create(input)]);
    expect(outcomes.map(codeOf).sort()).toEqual(["PlanAlreadyExists", "ok"]);
    expect(await plans.storedPeriods(space.id)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test and see it pass; then see it fail without the lock**

Run: `pnpm exec vitest run --project integration src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts`
Expected: PASS (the first test takes about 2 s).
Mutation check: temporarily replace the body of `DrizzleBudgetPlanRepository.lockForWrite` with `return expectedVersion ?? 1;` and run the same command — the first test fails with `["ok", "ok"]` and two lines; restore the body and run it again (PASS). This test is written after the code it pins (Tasks 6, 8, 12a), so the mutation check is its red step.

- [ ] **Step 3: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts
git commit -m "test(budgeting): pin concurrent line additions and plan creations against PostgreSQL (Refs #47, Refs #49)"
```

---

### Task 14a: HTTP — add budget lines

Implements HU-E6-03 (issue #49) over HTTP, with the reference plan of spec section 4 as an acceptance fixture. Pins Review Focus 3 (capacity reduced below the lines) and Review Focus 5 (Marta's and Juan's accounts on a SAVINGS line, malformed account ids).

Decisions:
- `POST …/plans/{planId}/lines` answers `201` with the whole plan and its new ETag (ruling P9): what a client needs next is the plan's unallocated capacity and shares, and the new line is the one with the requested name (names are unique per plan).
- The composition root wires all three line use cases now (Task 14b adds only their routes) and binds `SavingsAccountReader` to the accounts module (`findById`, type `SAVINGS`, owner, archived).
- `SavingsAccountRequired` joins the explicit 422 codes of `problem.ts`, like `AccountRequired`: it is a missing input, not a conflict. The other new codes follow the naming rules (`Invalid*` → 422, `*NotFound` → 404, else 409); `problem.test.ts` pins them all.
- `referencePlan()` (acceptance support) builds Household with the capacities and the four lines of spec section 4, Savings into a SAVINGS account in Ana's personal space; later tasks start from it.

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/route.ts`, `tests/acceptance/budget-lines.test.ts`
- Modify: `src/modules/budgeting/contracts/budgeting.contract.ts`, `src/shared/http/problem.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`, `tests/support/budgeting.ts`, `docs/backlog/E6-budgeting.md`
- Test: `src/shared/http/problem.test.ts`

**Interfaces:**
- Consumes: `createAddBudgetLine`, `AddBudgetLine`, `LineInput`, `SavingsAccountReader` (Task 12a); `createUpdateBudgetLine`, `UpdateBudgetLine`, `createRemoveBudgetLine`, `RemoveBudgetLine` (Task 12b); `planWrite`, `planSuccess`, `Id`, `PlanPath` (Tasks 9b, 11); `setCapacities`, `newPlan`, `ifMatch` (`tests/support/budgeting.ts`); `household`, `newAccount` (`tests/support/ledger.ts`).
- Produces:
  - `AddLineBodySchema`, `lineFromBody(body): Result<LineInput>`, the module-private `MAX_ACCOUNTS` (`budgeting.contract.ts`)
  - `Container.budgeting.addLine: AddBudgetLine`, `.updateLine: UpdateBudgetLine`, `.removeLine: RemoveBudgetLine`
  - `interface LineSpec { name: string; pesos: number; funding?: string; rolloverMode?: string; savingsAccountIds?: string[]; isCatchAll?: boolean }`, `postLine(user, spaceId, planId, line: LineSpec, version?): Promise<Response>`, `addLine(...same): Promise<PlanDto>`, `lineNamed(plan: PlanDto, name: string): LineDto`, `referencePlan(): Promise<{ h: Household; savings: string; planId: string; plan: PlanDto; lineId(name: string): string }>` (`tests/support/budgeting.ts`)

- [ ] **Step 1: Write the HTTP helpers and the failing tests**

In `src/shared/http/problem.test.ts`, insert after the line `    ["InvalidDirectCounterpart", 422],`:

```ts
    ["BudgetPlanNotFound", 404],
    ["BudgetLineNotFound", 404],
    ["PlanAlreadyExists", 409],
    ["InvalidCapacity", 422],
    ["PlanExceedsCapacity", 409],
    ["InvalidBudgetLineName", 422],
    ["InvalidPlannedAmount", 422],
    ["SavingsAccountRequired", 422],
    ["InvalidSavingsAccount", 422],
    ["SavingsAccountAlreadyUsed", 409],
    ["BudgetLineNameTaken", 409],
    ["CatchAllLineAlreadySet", 409],
    ["InvalidAllocation", 422],
```

In `tests/support/budgeting.ts`:

1. Insert before the line `import { call, type TestUser } from "./app";`:

```ts
import { POST as postLineRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/route";
```

2. Replace the line `import { cop, type MoneyDto } from "./ledger";` with:

```ts
import { cop, household, newAccount, type MoneyDto } from "./ledger";
```

3. Append to the end of the file:

```ts

/** A line as the tests write it: `pesos` becomes `plannedAmount` in COP. */
export interface LineSpec {
  name: string;
  pesos: number;
  funding?: string;
  rolloverMode?: string;
  savingsAccountIds?: string[];
  isCatchAll?: boolean;
}

/** HU-E6-03: `user` adds a line to the plan. */
export const postLine = (user: TestUser, spaceId: string, planId: string, line: LineSpec, version?: number) => {
  const { pesos, ...fields } = line;
  return call(postLineRoute, "POST", plansPath(spaceId, `/${planId}/lines`), {
    user,
    params: { spaceId, planId },
    body: { ...fields, plannedAmount: cop(pesos) },
    headers: ifMatch(version),
  });
};

/** Adds the line and returns the plan; throws unless 201. */
export const addLine = async (...args: Parameters<typeof postLine>): Promise<PlanDto> => {
  const response = await postLine(...args);
  if (response.status !== 201) throw new Error(`line failed with status ${response.status}`);
  return (await response.json()) as PlanDto;
};

/** The line of `plan` named `name`; throws when there is none. */
export const lineNamed = (plan: PlanDto, name: string): LineDto => {
  const line = plan.lines.find((l) => l.name === name);
  if (!line) throw new Error(`no line named ${name}`);
  return line;
};

/**
 * Spec section 4 in Household: capacities Ana 1,600,000 and Juan 2,400,000 COP and the lines Rent (SHARED_FUND),
 * Home, Savings (SAVINGS, into Ana's "Ahorros" account) and Free, all RESET and PROPORTIONAL; no catch-all yet.
 */
export const referencePlan = async () => {
  const h = await household();
  const savings = await newAccount(h.ana.personal, "Ahorros", 0, "SAVINGS");
  const { id: planId } = await newPlan(h.ana, h.spaceId, "2026-11");
  await setCapacities(h.ana, h.spaceId, planId, [
    [h.ana.memberId, 1_600_000],
    [h.juan.memberId, 2_400_000],
  ]);
  const add = (line: LineSpec) => addLine(h.ana, h.spaceId, planId, { rolloverMode: "RESET", ...line });
  await add({ name: "Rent", pesos: 1_200_000, funding: "SHARED_FUND" });
  await add({ name: "Home", pesos: 1_470_000, funding: "DIRECT" });
  await add({ name: "Savings", pesos: 600_000, funding: "SAVINGS", savingsAccountIds: [savings] });
  const plan = await add({ name: "Free", pesos: 730_000, funding: "DIRECT" });
  return { h, savings, planId, plan, lineId: (name: string) => lineNamed(plan, name).id };
};
```

`tests/acceptance/budget-lines.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setContainerForTests, type Container } from "@/composition/container";
import { problemOf, registerUser, startTestApp } from "../support/app";
import { addLine, lineNamed, newPlan, postLine, referencePlan, setCapacities } from "../support/budgeting";
import { cop, household, newAccount } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** HU-E6-03 Background: a DRAFT plan for 2026-11 with capacities Ana 1,600,000 COP and Juan 2,400,000 COP. */
const background = async () => {
  const h = await household();
  const { id: planId } = await newPlan(h.ana, h.spaceId, "2026-11");
  await setCapacities(h.ana, h.spaceId, planId, [
    [h.ana.memberId, 1_600_000],
    [h.juan.memberId, 2_400_000],
  ]);
  return { h, planId };
};

describe("budget lines and unallocated capacity (HU-E6-03)", () => {
  it("reports 1,330,000 COP unallocated after Rent and Home, with Home at 36.75 % (golden)", async () => {
    const { h, planId } = await background();
    await addLine(h.ana, h.spaceId, planId, {
      name: "Rent",
      pesos: 1_200_000,
      funding: "SHARED_FUND",
      rolloverMode: "RESET",
    });
    const response = await postLine(h.ana, h.spaceId, planId, {
      name: "Home",
      pesos: 1_470_000,
      funding: "DIRECT",
      rolloverMode: "RESET",
    });
    expect([response.status, response.headers.get("etag")]).toEqual([201, '"4"']);
    const plan = await response.json();
    expect(plan.unallocated).toEqual(cop(1_330_000));
    expect(lineNamed(plan, "Home")).toMatchObject({
      plannedAmount: cop(1_470_000),
      funding: "DIRECT",
      rolloverMode: "RESET",
      isCatchAll: false,
      capacityShare: "36.75",
      spent: cop(0),
      available: cop(1_470_000),
    });
  });

  it("leaves nothing unallocated with the full reference plan, and refuses Travel past it (golden)", async () => {
    const { h, planId, plan } = await referencePlan();
    expect(plan.unallocated).toEqual(cop(0));
    expect(plan.lines.map((l) => [l.name, l.capacityShare])).toEqual([
      ["Rent", "30.00"],
      ["Home", "36.75"],
      ["Savings", "15.00"],
      ["Free", "18.25"],
    ]);
    const travel = await postLine(h.ana, h.spaceId, planId, { name: "Travel", pesos: 100_000 });
    expect(await problemOf(travel)).toEqual([409, "PlanExceedsCapacity"]);
  });

  it("keeps line names unique within a plan ignoring case, and planned amounts positive", async () => {
    const { h, planId } = await background();
    await addLine(h.ana, h.spaceId, planId, { name: "Home", pesos: 1_470_000 });
    const home = await postLine(h.ana, h.spaceId, planId, { name: "home", pesos: 1 });
    expect(await problemOf(home)).toEqual([409, "BudgetLineNameTaken"]);
    const gifts = await postLine(h.ana, h.spaceId, planId, { name: "Gifts", pesos: 0 });
    expect(await problemOf(gifts)).toEqual([422, "InvalidPlannedAmount"]);
  });

  it("requires a SAVINGS account of a current member on a SAVINGS line (Review Focus 5)", async () => {
    const { h, planId } = await background();
    const savings = (savingsAccountIds?: string[]) =>
      postLine(h.ana, h.spaceId, planId, { name: "Savings", pesos: 600_000, funding: "SAVINGS", savingsAccountIds });
    expect(await problemOf(await savings())).toEqual([422, "SavingsAccountRequired"]);
    expect(await problemOf(await savings([h.juan.account]))).toEqual([422, "InvalidSavingsAccount"]);
    const marta = await registerUser("Marta");
    const martas = await newAccount(marta, "Ahorros", 0, "SAVINGS");
    expect(await problemOf(await savings([martas]))).toEqual([404, "AccountNotFound"]);
    expect(await problemOf(await savings(["not-a-uuid"]))).toEqual([404, "AccountNotFound"]);
    const juans = await newAccount(h.juan.personal, "Ahorros", 0, "SAVINGS");
    expect((await savings([juans])).status).toBe(201);
  });

  it("reports negative unallocated capacity once Juan's capacity drops to 2,000,000 COP (HU-E6-02, Review Focus 3)", async () => {
    const { h, planId } = await referencePlan();
    const plan = await setCapacities(h.ana, h.spaceId, planId, [[h.juan.memberId, 2_000_000]]);
    expect([plan.totalCapacity, plan.unallocated]).toEqual([cop(3_600_000), cop(-400_000)]);
  });

  it("refuses MEMBER Juan and a stale If-Match", async () => {
    const { h, planId } = await background();
    const juans = await postLine(h.juan, h.spaceId, planId, { name: "Home", pesos: 1 });
    expect(await problemOf(juans)).toEqual([403, "InsufficientRole"]);
    const stale = await postLine(h.ana, h.spaceId, planId, { name: "Home", pesos: 1 }, 1);
    expect(await problemOf(stale)).toEqual([412, "PreconditionFailed"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/shared/http/problem.test.ts && pnpm exec vitest run --project acceptance tests/acceptance/budget-lines.test.ts`
Expected: FAIL — `maps SavingsAccountRequired to 422` receives 409, and `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/route"`.

- [ ] **Step 3: Implement the contract, the route and the wiring**

In `src/shared/http/problem.ts`, insert after the line `  ["AccountNotInSpace", 422],`:

```ts
  ["SavingsAccountRequired", 422],
```

In `src/modules/budgeting/contracts/budgeting.contract.ts`:

1. Insert after the line `  type LineFigure,`:

```ts
  type LineInput,
```

2. Insert before the line `const lineDto = (figure: LineFigure, currency: string): z.infer<typeof BudgetLineSchema> => {`:

```ts
/** Savings accounts per line: bounds the payload; ownership is checked by the use case. */
const MAX_ACCOUNTS = 20;

/** HU-E6-03: a new line; DIRECT and RESET unless given, and not the catch-all unless asked (HU-E6-04). */
export const AddLineBodySchema = z.object({
  name: z.string().max(200),
  plannedAmount: MoneySchema,
  funding: z.enum(FUNDINGS).optional(),
  rolloverMode: z.enum(ROLLOVER_MODES).optional(),
  savingsAccountIds: z.array(Id).max(MAX_ACCOUNTS).optional(),
  isCatchAll: z.boolean().optional(),
});

/** HU-E6-03: the body as AddBudgetLine takes it; fails only for currencies the kernel does not know. */
export const lineFromBody = (body: z.infer<typeof AddLineBodySchema>): Result<LineInput> => {
  const plannedAmount = moneyFromDto(body.plannedAmount);
  return plannedAmount.ok ? ok({ ...body, plannedAmount: plannedAmount.value }) : plannedAmount;
};

```

3. Insert before the last line of the file (`};`):

```ts
  "/api/v1/spaces/{spaceId}/plans/{planId}/lines": {
    post: planWrite(
      "addBudgetLine",
      "Add a line with a planned amount, funding and rollover mode; Σ planned never exceeds total capacity",
      PlanPath,
      AddLineBodySchema,
      {
        "404": "SpaceNotFound, BudgetPlanNotFound, AccountNotFound",
        "409":
          "PlanExceedsCapacity, BudgetLineNameTaken, CatchAllLineAlreadySet, SavingsAccountAlreadyUsed, SavingsLineNotMappable, AccountArchived, SpaceArchived",
        "422":
          "ValidationFailed, InvalidBudgetLineName, InvalidPlannedAmount, SavingsAccountRequired, InvalidSavingsAccount, CurrencyMismatch, UnknownCurrency",
      },
      "201",
    ),
  },
```

`src/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { AddLineBodySchema, lineFromBody, planSuccess } from "@/modules/budgeting/contracts/budgeting.contract";
import { ifMatchVersion } from "@/shared/http";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: AddLineBodySchema,
  handler: async ({ request, user, params, body }) => {
    // Spec 7: If-Match is checked when present; a stale version is 412.
    const expectedVersion = ifMatchVersion(request);
    if (!expectedVersion.ok) return expectedVersion;
    const line = lineFromBody(body);
    if (!line.ok) return line;
    const result = await getContainer().budgeting.addLine({
      spaceId: params.spaceId!,
      userId: user!.id,
      planId: params.planId!,
      expectedVersion: expectedVersion.value,
      line: line.value,
    });
    return result.ok ? ok(planSuccess(result.value, 201)) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert after the line `  createSuggestCapacity,`:

```ts
  createAddBudgetLine,
  createRemoveBudgetLine,
  createUpdateBudgetLine,
```

2. Insert after the line `  type SuggestCapacity,`:

```ts
  type AddBudgetLine,
  type RemoveBudgetLine,
  type SavingsAccountReader,
  type UpdateBudgetLine,
```

3. Insert after the line `    readonly suggestCapacity: SuggestCapacity;`:

```ts
    readonly addLine: AddBudgetLine;
    readonly updateLine: UpdateBudgetLine;
    readonly removeLine: RemoveBudgetLine;
```

4. Insert before the line `  // HU-E6-01 … HU-E6-05: plans reach members, accounts, categories and the ledger's spending only through ports.`:

```ts
  // HU-E6-03: SAVINGS lines name members' savings accounts, which live in their personal spaces (D9).
  const savingsAccounts: SavingsAccountReader = {
    find: async (accountId) => {
      const account = await accountsDeps.accounts.findById(accountId);
      return account
        ? {
            id: account.id,
            ownerUserId: account.ownerUserId,
            isSavings: account.type === "SAVINGS",
            archived: account.archivedAt !== null,
          }
        : null;
    },
  };
```

5. Insert after the line `    plans: budgetPlans,`:

```ts
    lines: budgetPlans,
    savingsAccounts,
```

6. Insert after the line `      suggestCapacity: createSuggestCapacity(budgetingDeps),`:

```ts
      addLine: createAddBudgetLine(budgetingDeps),
      updateLine: createUpdateBudgetLine(budgetingDeps),
      removeLine: createRemoveBudgetLine(budgetingDeps),
```

In `docs/backlog/E6-budgeting.md`, insert after the line `- Percent of total returned with two decimals; unallocated = capacity − Σ planned.`:

```md
- Every line write answers the whole plan (`201` on `POST`, `200` on `PATCH` and `DELETE`); funding defaults to `DIRECT` and rollover to `RESET`. Errors: `InvalidBudgetLineName` (422, 1–60 characters), `InvalidPlannedAmount` (422), `SavingsAccountRequired` (422), `InvalidSavingsAccount` (422: a non-SAVINGS account, an account listed twice, or accounts on a line that is not SAVINGS), `AccountNotFound` (404: unknown, or not owned by a current registered member of the space), `AccountArchived` (409, for accounts a line newly names), `SavingsAccountAlreadyUsed` (409: an account backs one SAVINGS line per plan), `BudgetLineNameTaken` (409), `PlanExceedsCapacity` (409, only when a line is added or increased), `BudgetLineNotFound` (404).
- SAVINGS accounts live in their owners' personal spaces, so a shared space's SAVINGS line names its registered members' savings accounts (D9); its spending is the transfers into them during the plan's period, whatever space recorded them.
- `DELETE …/lines/{lineId}` is logical (D8): the line keeps its row with `deletedAt`, leaves every figure, ends its category mappings and frees its name.
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `POST /api/v1/spaces/{spaceId}/plans/{planId}/lines` with a `201` response (about 160 lines); components are unchanged.
Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project acceptance tests/acceptance/budget-lines.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/contracts/budgeting.contract.ts src/shared/http/problem.ts src/shared/http/problem.test.ts "src/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/route.ts" src/composition/container.ts openapi/openapi.snapshot.json docs/backlog/E6-budgeting.md tests/support/budgeting.ts tests/acceptance/budget-lines.test.ts
git commit -m "feat(budgeting): add budget lines over HTTP and show unallocated capacity (Refs #49)"
```

---

### Task 14b: HTTP — edit, mark as catch-all and remove budget lines

Implements the `PATCH` and `DELETE` of HU-E6-03 (issue #49) and the catch-all scenario of HU-E6-04 (issue #50). Pins Review Focus 6 (the removed row stays; its name is reused).

Decisions:
- `PATCH …/lines/{lineId}` takes any subset of the line's fields; `isCatchAll` is HU-E6-04's `SetCatchAllLine` (the story names this endpoint for it). `DELETE …/lines/{lineId}` answers `200` with the plan and its new ETag rather than `204`, so the next write can send `If-Match` without a read (ruling P9).
- Malformed line ids answer `404 BudgetLineNotFound`: the use case looks lines up among the parts it loaded, so no id reaches a query.

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/route.ts`
- Modify: `src/modules/budgeting/contracts/budgeting.contract.ts`, `openapi/openapi.snapshot.json`, `tests/support/budgeting.ts`, `tests/acceptance/budget-lines.test.ts`

**Interfaces:**
- Consumes: `Container.budgeting.updateLine`, `.removeLine` (Task 14a); `LineChanges` (Task 12b); `planWrite`, `PlanPath`, `MAX_ACCOUNTS`, `Id` (Tasks 9b, 11, 14a); `referencePlan`, `lineNamed`, `addLine`, `ifMatch`, `PlanDto`, `LineSpec` (`tests/support/budgeting.ts`).
- Produces: `UpdateLineBodySchema`, `lineChangesFromBody(body): Result<LineChanges>`, the module-private `LinePath` (`budgeting.contract.ts`); `patchLine(user, spaceId, planId, lineId, changes: Partial<LineSpec>, version?): Promise<Response>`, `deleteLine(user, spaceId, planId, lineId, version?): Promise<Response>` (`tests/support/budgeting.ts`).

- [ ] **Step 1: Write the HTTP helpers and the failing tests**

In `tests/support/budgeting.ts`:

1. Insert before the line `import { call, type TestUser } from "./app";`:

```ts
import {
  DELETE as deleteLineRoute,
  PATCH as patchLineRoute,
} from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/route";
```

2. Append to the end of the file:

```ts

/** HU-E6-03, HU-E6-04: `user` changes the line; `pesos` becomes `plannedAmount`. */
export const patchLine = (
  user: TestUser,
  spaceId: string,
  planId: string,
  lineId: string,
  changes: Partial<LineSpec>,
  version?: number,
) => {
  const { pesos, ...fields } = changes;
  return call(patchLineRoute, "PATCH", plansPath(spaceId, `/${planId}/lines/${lineId}`), {
    user,
    params: { spaceId, planId, lineId },
    body: pesos === undefined ? fields : { ...fields, plannedAmount: cop(pesos) },
    headers: ifMatch(version),
  });
};

/** HU-E6-03, D8: `user` removes the line (logically). */
export const deleteLine = (user: TestUser, spaceId: string, planId: string, lineId: string, version?: number) =>
  call(deleteLineRoute, "DELETE", plansPath(spaceId, `/${planId}/lines/${lineId}`), {
    user,
    params: { spaceId, planId, lineId },
    headers: ifMatch(version),
  });
```

In `tests/acceptance/budget-lines.test.ts`:

1. Replace the line `import { addLine, lineNamed, newPlan, postLine, referencePlan, setCapacities } from "../support/budgeting";` with:

```ts
import {
  addLine,
  deleteLine,
  lineNamed,
  newPlan,
  patchLine,
  postLine,
  referencePlan,
  setCapacities,
  type PlanDto,
} from "../support/budgeting";
```

2. Append to the end of the file:

```ts

describe("editing and removing lines (HU-E6-03, HU-E6-04)", () => {
  it("marks Free as the plan's catch-all line, and refuses a second one", async () => {
    const { h, planId, lineId } = await referencePlan();
    const free = await patchLine(h.ana, h.spaceId, planId, lineId("Free"), { isCatchAll: true });
    expect(free.status).toBe(200);
    const plan = (await free.json()) as PlanDto;
    expect([lineNamed(plan, "Free").isCatchAll, plan.unbudgeted]).toEqual([true, null]);
    const home = await patchLine(h.ana, h.spaceId, planId, lineId("Home"), { isCatchAll: true });
    expect(await problemOf(home)).toEqual([409, "CatchAllLineAlreadySet"]);
  });

  it("refuses an increase past the capacity, and renames and lowers a line", async () => {
    const { h, planId, lineId } = await referencePlan();
    const raise = await patchLine(h.ana, h.spaceId, planId, lineId("Home"), { pesos: 1_500_000 });
    expect(await problemOf(raise)).toEqual([409, "PlanExceedsCapacity"]);
    const changed = await patchLine(h.ana, h.spaceId, planId, lineId("Home"), { pesos: 1_400_000, name: "House" });
    const plan = (await changed.json()) as PlanDto;
    expect([lineNamed(plan, "House").plannedAmount, plan.unallocated]).toEqual([cop(1_400_000), cop(70_000)]);
  });

  it("removes a line logically: the plan drops it, its name is free again and its row stays (D8, Review Focus 6)", async () => {
    const { h, planId, lineId } = await referencePlan();
    const home = lineId("Home");
    const removed = await deleteLine(h.ana, h.spaceId, planId, home);
    expect(removed.status).toBe(200);
    const plan = (await removed.json()) as PlanDto;
    expect([plan.lines.map((l) => l.name), plan.unallocated]).toEqual([["Rent", "Savings", "Free"], cop(1_470_000)]);
    await addLine(h.ana, h.spaceId, planId, { name: "Home", pesos: 1_470_000 });
    const { rows } = await app.pool.query("SELECT deleted_at FROM budget_lines WHERE id = $1", [home]);
    expect(rows[0].deleted_at).not.toBeNull();
    expect(await problemOf(await deleteLine(h.ana, h.spaceId, planId, home))).toEqual([404, "BudgetLineNotFound"]);
    const malformed = await patchLine(h.ana, h.spaceId, planId, "not-a-uuid", { name: "X" });
    expect(await problemOf(malformed)).toEqual([404, "BudgetLineNotFound"]);
  });

  it("refuses MEMBER Juan and a stale If-Match on edits and removals", async () => {
    const { h, planId, lineId, plan } = await referencePlan();
    const juans = await patchLine(h.juan, h.spaceId, planId, lineId("Home"), { name: "X" });
    expect(await problemOf(juans)).toEqual([403, "InsufficientRole"]);
    const stale = await deleteLine(h.ana, h.spaceId, planId, lineId("Home"), plan.version - 1);
    expect(await problemOf(stale)).toEqual([412, "PreconditionFailed"]);
    expect((await deleteLine(h.ana, h.spaceId, planId, lineId("Home"), plan.version)).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/budget-lines.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/route"`.

- [ ] **Step 3: Implement the contract and the route**

In `src/modules/budgeting/contracts/budgeting.contract.ts`:

1. Insert after the line `  type LineInput,`:

```ts
  type LineChanges,
```

2. Insert before the line `const lineDto = (figure: LineFigure, currency: string): z.infer<typeof BudgetLineSchema> => {`:

```ts
/** HU-E6-03, HU-E6-04: what a PATCH changes; `isCatchAll` makes the line the plan's catch-all (SetCatchAllLine). */
export const UpdateLineBodySchema = z.object({
  name: z.string().max(200).optional(),
  plannedAmount: MoneySchema.optional(),
  funding: z.enum(FUNDINGS).optional(),
  rolloverMode: z.enum(ROLLOVER_MODES).optional(),
  savingsAccountIds: z.array(Id).max(MAX_ACCOUNTS).optional(),
  isCatchAll: z.boolean().optional(),
});

/** The body as UpdateBudgetLine takes it; fails only for currencies the kernel does not know. */
export const lineChangesFromBody = (body: z.infer<typeof UpdateLineBodySchema>): Result<LineChanges> => {
  if (body.plannedAmount === undefined) return ok({ ...body, plannedAmount: undefined });
  const plannedAmount = moneyFromDto(body.plannedAmount);
  return plannedAmount.ok ? ok({ ...body, plannedAmount: plannedAmount.value }) : plannedAmount;
};

```

3. Insert after the line `const PlanPath = SpacePath.extend({ planId: z.string() });`:

```ts
const LinePath = PlanPath.extend({ lineId: z.string() });
```

4. Insert before the last line of the file (`};`):

```ts
  "/api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}": {
    patch: planWrite(
      "updateBudgetLine",
      "Change a line's name, planned amount, funding, savings accounts, rollover mode or catch-all flag",
      LinePath,
      UpdateLineBodySchema,
      {
        "404": "SpaceNotFound, BudgetPlanNotFound, BudgetLineNotFound, AccountNotFound",
        "409":
          "PlanExceedsCapacity, BudgetLineNameTaken, CatchAllLineAlreadySet, SavingsAccountAlreadyUsed, SavingsLineNotMappable, AccountArchived, SpaceArchived",
        "422":
          "ValidationFailed, InvalidBudgetLineName, InvalidPlannedAmount, SavingsAccountRequired, InvalidSavingsAccount, CurrencyMismatch, UnknownCurrency",
      },
    ),
    delete: planWrite(
      "removeBudgetLine",
      "Remove a line logically: its row stays, it leaves every figure and frees its name and categories",
      LinePath,
      null,
      { "404": "SpaceNotFound, BudgetPlanNotFound, BudgetLineNotFound", "409": "SpaceArchived" },
    ),
  },
```

`src/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  lineChangesFromBody,
  planSuccess,
  UpdateLineBodySchema,
} from "@/modules/budgeting/contracts/budgeting.contract";
import { ifMatchVersion } from "@/shared/http";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const PATCH = defineRoute({
  auth: "required",
  body: UpdateLineBodySchema,
  handler: async ({ request, user, params, body }) => {
    // Spec 7: If-Match is checked when present; a stale version is 412.
    const expectedVersion = ifMatchVersion(request);
    if (!expectedVersion.ok) return expectedVersion;
    const changes = lineChangesFromBody(body);
    if (!changes.ok) return changes;
    const result = await getContainer().budgeting.updateLine({
      spaceId: params.spaceId!,
      userId: user!.id,
      planId: params.planId!,
      lineId: params.lineId!,
      expectedVersion: expectedVersion.value,
      changes: changes.value,
    });
    return result.ok ? ok(planSuccess(result.value)) : result;
  },
});

export const DELETE = defineRoute({
  auth: "required",
  handler: async ({ request, user, params }) => {
    const expectedVersion = ifMatchVersion(request);
    if (!expectedVersion.ok) return expectedVersion;
    const result = await getContainer().budgeting.removeLine({
      spaceId: params.spaceId!,
      userId: user!.id,
      planId: params.planId!,
      lineId: params.lineId!,
      expectedVersion: expectedVersion.value,
    });
    return result.ok ? ok(planSuccess(result.value)) : result;
  },
});
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `PATCH` and `DELETE /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}` (about 230 lines); components are unchanged.
Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project acceptance tests/acceptance/budget-lines.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/contracts/budgeting.contract.ts "src/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/route.ts" openapi/openapi.snapshot.json tests/support/budgeting.ts tests/acceptance/budget-lines.test.ts
git commit -m "feat(budgeting): edit, mark as catch-all and remove budget lines over HTTP (Refs #49, Refs #50)"
```

---

### Task 15: Budgeting — MapCategoriesToLine

Implements HU-E6-04 (issue #50) at the use-case level, with its persistence. Pins Review Focus 5 (another space's category) and Review Focus 6 (a moved category keeps its ended mapping; a removed line frees its categories).

Decisions:
- `MapCategoriesToLine` replaces the line's category set (HU-E6-04 `PUT …/categories`) through `planForWrite` and `checkedMapping` (Task 2). The categories come from the `BudgetCategories` port: the live categories of the plan's space, archived ones flagged; the composition root binds it to the categories module (Task 16).
- `CategoryMappingRepository.mapCategories` ends the mappings of categories left out (`unmapped_at`) and inserts the new ones; categories kept stay on their row. `isCategoryMapped` answers whether any plan maps or once mapped the category, ended mappings included, as the ledger counts soft-deleted transactions (HU-E3-03 "Reference check uses ports to `ledger` (transactions) and `budgeting` (line mappings)").

**Files:**
- Create: `src/modules/budgeting/application/map-categories-to-line.ts`
- Modify: `src/modules/budgeting/application/ports.ts`, `src/modules/budgeting/application/index.ts`, `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.ts`, `tests/support/in-memory-budgeting.ts`, `tests/support/budgeting-world.ts`
- Test: `src/modules/budgeting/application/mappings.test.ts`, `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts`

**Interfaces:**
- Consumes: `checkedMapping` (Task 2); `planForWrite`, `loadPlanView` (Task 8); `lineOf` (Task 12a); `createRemoveBudgetLine`, `createUpdateBudgetLine` (Task 12b); `referenceLines`, `aLine` (Task 2); `budgetingWorld`, `HOUSEHOLD`, `NOW`, `savingsAccounts`.
- Produces:
  - `interface CategoryMappingRepository { mapCategories(planId: BudgetPlanId, lineId: BudgetLineId, categoryIds: readonly string[], at: Date): Promise<void>; isCategoryMapped(categoryId: string): Promise<boolean> }`
  - `interface BudgetCategories { list(spaceId: string): Promise<{ id: string; archived: boolean }[]> }`
  - `type MapCategoriesToLine = (input: { spaceId; userId; planId; lineId: string; expectedVersion: number | null; categoryIds: readonly string[] }) => Promise<Result<BudgetPlanView>>`; `type MappingDeps = BudgetingDeps & { mappings: CategoryMappingRepository; categories: BudgetCategories }`; `createMapCategoriesToLine(deps: MappingDeps)` — `SpaceNotFound`, `SpaceArchived`, `InsufficientRole`, `BudgetPlanNotFound`, `PreconditionFailed`, `BudgetLineNotFound`, `SavingsLineNotMappable`, `CategoryNotInSpace`, `CategoryArchived`, `CategoryAlreadyMapped`
  - `DrizzleBudgetPlanRepository.mapCategories`, `.isCategoryMapped`; the same on `InMemoryBudgetPlans`
  - `householdCategories: BudgetCategories` (Household: `cat-groceries`, `cat-utilities`, `cat-outings`, `cat-restaurants`, archived `cat-old`; any other space: `cat-personal`) — `tests/support/budgeting-world.ts`

- [ ] **Step 1: Write the port, the twin, the test data and the failing tests**

Append to `src/modules/budgeting/application/ports.ts`:

```ts

/** HU-E6-04: a line's categories are replaced as a set; ended mappings keep their rows (D8). */
export interface CategoryMappingRepository {
  /** Makes `categoryIds` the line's current categories: ends the others' mappings and maps the new ones. */
  mapCategories(
    planId: BudgetPlanId,
    lineId: BudgetLineId,
    categoryIds: readonly string[],
    at: Date,
  ): Promise<void>;
  /** HU-E3-03: whether any plan maps or once mapped the category (ended mappings count, like deleted transactions). */
  isCategoryMapped(categoryId: string): Promise<boolean>;
}

/** The live categories of a space (deleted ones never appear, D8), archived ones flagged; bound to categories. */
export interface BudgetCategories {
  list(spaceId: string): Promise<{ readonly id: string; readonly archived: boolean }[]>;
}
```

In `tests/support/in-memory-budgeting.ts`, insert before the line `  /** Test setup: parts of a plan as earlier writes would have left them. */`:

```ts
  /** CategoryMappingRepository, like DrizzleBudgetPlanRepository.mapCategories. */
  async mapCategories(planId: string, lineId: string, categoryIds: readonly string[], at: Date): Promise<void> {
    const keep = new Set(categoryIds);
    this.mappings = this.mappings.map((r) =>
      r.mapping.lineId === lineId && r.unmappedAt === null && !keep.has(r.mapping.categoryId)
        ? { ...r, unmappedAt: at }
        : r,
    );
    const current = new Set(
      this.mappings.filter((r) => r.mapping.lineId === lineId && r.unmappedAt === null).map((r) => r.mapping.categoryId),
    );
    for (const categoryId of categoryIds.filter((id) => !current.has(id))) {
      this.mappings.push({ planId, mapping: { lineId, categoryId }, mappedAt: at, unmappedAt: null });
    }
  }

  /** CategoryMappingRepository: every mapping ever made counts. */
  async isCategoryMapped(categoryId: string): Promise<boolean> {
    return this.mappings.some((r) => r.mapping.categoryId === categoryId);
  }

```

In `tests/support/budgeting-world.ts`:

1. Insert after the line `  BudgetAccount,`:

```ts
  BudgetCategories,
```

2. Append to the end of the file:

```ts

/** HU-E6-04: Household's live categories (`cat-old` archived); every other space has only `cat-personal`. */
export const householdCategories: BudgetCategories = {
  list: async (spaceId) =>
    spaceId === HOUSEHOLD
      ? [
          { id: "cat-groceries", archived: false },
          { id: "cat-utilities", archived: false },
          { id: "cat-outings", archived: false },
          { id: "cat-restaurants", archived: false },
          { id: "cat-old", archived: true },
        ]
      : [{ id: "cat-personal", archived: false }],
};
```

`src/modules/budgeting/application/mappings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { referenceLines } from "../../../../tests/support/budget-fixtures";
import {
  budgetingWorld,
  HOUSEHOLD,
  householdCategories,
  NOW,
  savingsAccounts,
} from "../../../../tests/support/budgeting-world";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createMapCategoriesToLine } from "./map-categories-to-line";
import type { BudgetPlanView } from "./plan-view";
import { createRemoveBudgetLine } from "./remove-budget-line";
import { createUpdateBudgetLine } from "./update-budget-line";

/** HU-E6-04 Background: the reference plan for 2026-11 in Household, without a catch-all line. */
const world = async () => {
  const w = budgetingWorld();
  const deps = { ...w.deps, mappings: w.plans, categories: householdCategories, lines: w.plans, savingsAccounts };
  const create = createCreateBudgetPlan(deps);
  const plan = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" })).plan;
  w.plans.seed(plan.id, {
    capacities: [
      { memberId: "member-ana", amount: 160_000_000n },
      { memberId: "member-juan", amount: 240_000_000n },
    ],
    lines: referenceLines().map((l) => ({ ...l, isCatchAll: false })),
  });
  const map = createMapCategoriesToLine(deps);
  const mapTo = (line: string, categoryIds: string[], userId = "u-ana") =>
    map({ spaceId: HOUSEHOLD, userId, planId: plan.id, lineId: `line-${line}`, expectedVersion: null, categoryIds });
  const lineIn = (view: BudgetPlanView, name: string) => view.figures.lines.find((l) => l.line.name === name)!;
  return { ...w, deps, plan, mapTo, lineIn };
};

describe("MapCategoriesToLine (HU-E6-04)", () => {
  it("maps Groceries and Utilities to Home, so a Groceries expense counts as spent in Home", async () => {
    const { mapTo, spending, lineIn } = await world();
    spending.byCategory = [{ categoryId: "cat-groceries", amount: 8_500_000n }];
    const view = unwrap(await mapTo("home", ["cat-groceries", "cat-utilities"]));
    const home = lineIn(view, "Home");
    expect([home.categoryIds, home.spent]).toEqual([["cat-groceries", "cat-utilities"], 8_500_000n]);
    expect(view.figures.unbudgeted).toEqual({ spent: 0n, available: 0n });
  });

  it("maps a category to at most one line per plan", async () => {
    const { mapTo } = await world();
    unwrap(await mapTo("home", ["cat-groceries"]));
    expect(codeOf(await mapTo("free", ["cat-groceries"]))).toBe("CategoryAlreadyMapped");
  });

  it("moves a category once its line lets it go, keeping the ended mapping (D8, Review Focus 6)", async () => {
    const { mapTo, plans, lineIn } = await world();
    unwrap(await mapTo("home", ["cat-groceries", "cat-utilities"]));
    unwrap(await mapTo("home", ["cat-utilities"]));
    const view = unwrap(await mapTo("free", ["cat-groceries"]));
    expect(lineIn(view, "Free").categoryIds).toEqual(["cat-groceries"]);
    const history = plans.mappings.filter((r) => r.mapping.categoryId === "cat-groceries");
    expect(history.map((r) => [r.mapping.lineId, r.unmappedAt])).toEqual([
      ["line-home", NOW],
      ["line-free", null],
    ]);
  });

  it("frees the categories of a removed line (Review Focus 6)", async () => {
    const { mapTo, deps, plan } = await world();
    unwrap(await mapTo("home", ["cat-groceries"]));
    const remove = createRemoveBudgetLine(deps);
    unwrap(await remove({ spaceId: HOUSEHOLD, userId: "u-ana", planId: plan.id, lineId: "line-home", expectedVersion: null }));
    expect(codeOf(await mapTo("free", ["cat-groceries"]))).toBe("ok");
  });

  it("maps only live categories of the plan's space, and never newly an archived one (Review Focus 5)", async () => {
    const { mapTo } = await world();
    expect(codeOf(await mapTo("free", ["cat-personal"]))).toBe("CategoryNotInSpace");
    expect(codeOf(await mapTo("free", ["not-a-category"]))).toBe("CategoryNotInSpace");
    expect(codeOf(await mapTo("free", ["cat-old"]))).toBe("CategoryArchived");
  });

  it("maps nothing to a SAVINGS line, whose spending is its transfers (spec 5.4)", async () => {
    const { mapTo } = await world();
    expect(codeOf(await mapTo("savings", ["cat-groceries"]))).toBe("SavingsLineNotMappable");
  });

  it("puts unmapped spending in Unbudgeted without a catch-all line, and in the catch-all line with one", async () => {
    const { mapTo, spending, deps, plan, lineIn } = await world();
    spending.byCategory = [{ categoryId: "cat-restaurants", amount: 6_000_000n }];
    const without = unwrap(await mapTo("home", ["cat-groceries"]));
    expect(without.figures.unbudgeted).toEqual({ spent: 6_000_000n, available: -6_000_000n });
    const update = createUpdateBudgetLine(deps);
    const input = { spaceId: HOUSEHOLD, userId: "u-ana", planId: plan.id, lineId: "line-free", expectedVersion: null };
    const withFree = unwrap(await update({ ...input, changes: { isCatchAll: true } }));
    expect([withFree.figures.unbudgeted, lineIn(withFree, "Free").spent]).toEqual([null, 6_000_000n]);
  });

  it("lets only owners and admins map categories, and answers BudgetLineNotFound for unknown lines", async () => {
    const { mapTo } = await world();
    expect(codeOf(await mapTo("home", ["cat-groceries"], "u-juan"))).toBe("InsufficientRole");
    expect(codeOf(await mapTo("travel", ["cat-groceries"]))).toBe("BudgetLineNotFound");
  });
});
```

In `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts`:

1. Replace the line `import type { BudgetLineRepository, BudgetPlanRepository, CapacityRepository } from "../application/ports";` with:

```ts
import type {
  BudgetLineRepository,
  BudgetPlanRepository,
  CapacityRepository,
  CategoryMappingRepository,
} from "../application/ports";
```

2. Append to the end of the file:

```ts

describe("DrizzleBudgetPlanRepository category mappings (HU-E6-04, HU-E3-03, D8)", () => {
  it("replaces a line's categories and ends a removed line's mappings like its in-memory twin", async () => {
    const { space, fixture } = await household();
    const groceries = await categoryFixture(db, fixture, "Groceries");
    const utilities = await categoryFixture(db, fixture, "Utilities");
    const outings = await categoryFixture(db, fixture, "Outings");
    const november = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    const home = aLine("Home", 147_000_000n, { id: randomUUID() as BudgetLineId, planId: november.id, createdAt: at });
    const free = aLine("Free", 73_000_000n, {
      id: randomUUID() as BudgetLineId,
      planId: november.id,
      createdAt: new Date("2026-10-14T12:01:00Z"),
    });
    const run = async (plans: BudgetPlanRepository & BudgetLineRepository & CategoryMappingRepository) => {
      await plans.add(november);
      await plans.addLine(home, at);
      await plans.addLine(free, at);
      await plans.mapCategories(november.id, home.id, [groceries, utilities], at);
      await plans.mapCategories(november.id, home.id, [groceries], at);
      await plans.mapCategories(november.id, free.id, [utilities, outings], at);
      await plans.deleteLine(november.id, free.id, at);
      await plans.mapCategories(november.id, home.id, [groceries, outings], at);
      return {
        mappings: (await plans.contents(november.id)).mappings,
        mapped: [
          await plans.isCategoryMapped(utilities),
          await plans.isCategoryMapped(randomUUID()),
          await plans.isCategoryMapped("not-a-uuid"),
        ],
      };
    };
    const expected = {
      mappings: [
        { lineId: home.id, categoryId: groceries },
        { lineId: home.id, categoryId: outings },
      ].sort((a, b) => (a.categoryId < b.categoryId ? -1 : 1)),
      mapped: [true, false, false],
    };
    expect(await run(new InMemoryBudgetPlans())).toEqual(expected);
    expect(await run(repo)).toEqual(expected);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM budget_line_categories WHERE plan_id = $1", [
      november.id,
    ]);
    expect(rows[0].n).toBe(5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/application/mappings.test.ts && pnpm exec vitest run --project integration src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts`
Expected: FAIL — `Failed to resolve import "./map-categories-to-line"`, and `plans.mapCategories is not a function` for the PostgreSQL repository.

- [ ] **Step 3: Implement**

In `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.ts`, insert before the last line of the file (`}`):

```ts

  async mapCategories(
    planId: BudgetPlanId,
    lineId: BudgetLineId,
    categoryIds: readonly string[],
    at: Date,
  ): Promise<void> {
    const db = this.tm.executor();
    const current = await db
      .select({ categoryId: budgetLineCategories.categoryId })
      .from(budgetLineCategories)
      .where(and(eq(budgetLineCategories.lineId, lineId), isNull(budgetLineCategories.unmappedAt)));
    const mapped = new Set(current.map((row) => row.categoryId));
    const ended = [...mapped].filter((id) => !categoryIds.includes(id));
    if (ended.length > 0) {
      // D8: an ended mapping keeps its row; the partial unique index frees the category for other lines.
      await db
        .update(budgetLineCategories)
        .set({ unmappedAt: at })
        .where(
          and(
            eq(budgetLineCategories.lineId, lineId),
            isNull(budgetLineCategories.unmappedAt),
            inArray(budgetLineCategories.categoryId, ended),
          ),
        );
    }
    const added = categoryIds.filter((id) => !mapped.has(id));
    if (added.length > 0) {
      await db
        .insert(budgetLineCategories)
        .values(added.map((categoryId) => ({ planId, lineId, categoryId, mappedAt: at })));
    }
  }

  async isCategoryMapped(categoryId: string): Promise<boolean> {
    if (!isUuid(categoryId)) return false;
    const rows = await this.tm
      .executor()
      .select({ id: budgetLineCategories.id })
      .from(budgetLineCategories)
      .where(eq(budgetLineCategories.categoryId, categoryId))
      .limit(1);
    return rows.length > 0;
  }
```

`src/modules/budgeting/application/map-categories-to-line.ts`:

```ts
import { ok, type Result } from "@/shared/kernel";
import { checkedMapping } from "../domain/budget-line";
import type { BudgetingDeps } from "./deps";
import { lineOf } from "./line-checks";
import { planForWrite } from "./plan-access";
import { loadPlanView, type BudgetPlanView } from "./plan-view";
import type { BudgetCategories, CategoryMappingRepository } from "./ports";

export type MapCategoriesToLine = (input: {
  spaceId: string;
  userId: string;
  planId: string;
  lineId: string;
  expectedVersion: number | null;
  categoryIds: readonly string[];
}) => Promise<Result<BudgetPlanView>>;

export type MappingDeps = BudgetingDeps & {
  readonly mappings: CategoryMappingRepository;
  readonly categories: BudgetCategories;
};

/**
 * HU-E6-04: an OWNER or ADMIN replaces the categories a line consumes. A category maps to one line per plan, newly
 * mapped ones are live, unarchived categories of the plan's space, and those left out are unmapped, never deleted.
 */
export const createMapCategoriesToLine =
  (deps: MappingDeps): MapCategoriesToLine =>
  (input) =>
    deps.tm.run(async () => {
      const write = await planForWrite(deps, input);
      if (!write.ok) return write;
      const { space, plan, parts } = write.value;
      const line = lineOf(parts, input.lineId);
      if (!line.ok) return line;
      const categories = await deps.categories.list(space.spaceId);
      const categoryIds = checkedMapping(line.value, input.categoryIds, { categories, mappings: parts.mappings });
      if (!categoryIds.ok) return categoryIds;
      await deps.mappings.mapCategories(plan.id, line.value.id, categoryIds.value, deps.clock.now());
      return ok(await loadPlanView(deps, space, plan));
    });
```

Append to `src/modules/budgeting/application/index.ts`:

```ts
export type { BudgetCategories, CategoryMappingRepository } from "./ports";
export {
  createMapCategoriesToLine,
  type MapCategoriesToLine,
  type MappingDeps,
} from "./map-categories-to-line";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/budgeting && pnpm exec vitest run --project integration src/modules/budgeting`
Expected: PASS. Mutation check: temporarily delete the `if (ended.length > 0) { … }` block of `DrizzleBudgetPlanRepository.mapCategories` — the integration test fails (`budget_line_categories_current_uq` refuses the last mapping of Outings to Home, or the comparison differs); restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/application/ports.ts src/modules/budgeting/application/map-categories-to-line.ts src/modules/budgeting/application/index.ts src/modules/budgeting/application/mappings.test.ts src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.ts src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts tests/support/in-memory-budgeting.ts tests/support/budgeting-world.ts
git commit -m "feat(budgeting): map categories to budget lines, one line per category and plan (Refs #50)"
```

---

### Task 16: HTTP — category mappings and what each line has spent

Implements HU-E6-04 (issue #50) over HTTP against real expenses and transfers, and closes the HU-E3-03 note on budget-line references. Pins Review Focus 5 (Ana's personal category) and Review Focus 6 (deleting a category a plan once mapped).

Decisions:
- `PUT …/lines/{lineId}/categories` takes `{ "categoryIds": [...] }` (the whole set, at most 200) and answers the plan with its new ETag.
- The composition root binds `BudgetCategories` to the categories module's `listCategories` (live categories only, archived flagged) and extends `DeleteCategory`'s `CategoryUsage` with `isCategoryMapped`, so a category that any plan maps or once mapped answers `409 CategoryInUse` and can only be archived (HU-E3-03).
- `CategoryNotInSpace` joins the explicit 422 codes, like `AccountNotInSpace` (ruling P6).
- The acceptance tests record real expenses and transfers: `spent` counts live expenses of the plan's space dated within its stored dates (a soft-deleted one and those of 2026-10-31 and 2026-12-01 do not), and a SAVINGS line counts the transfers into its account recorded in Ana's personal space.

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/categories/route.ts`, `tests/acceptance/budget-mappings.test.ts`
- Modify: `src/modules/budgeting/contracts/budgeting.contract.ts`, `src/shared/http/problem.ts`, `src/composition/container.ts`, `src/modules/categories/application/delete-category.ts`, `openapi/openapi.snapshot.json`, `tests/support/budgeting.ts`, `docs/backlog/E6-budgeting.md`
- Test: `src/shared/http/problem.test.ts`

**Interfaces:**
- Consumes: `createMapCategoriesToLine`, `MapCategoriesToLine`, `BudgetCategories` (Task 15); `DrizzleBudgetPlanRepository.isCategoryMapped` (Task 15); `planWrite`, `LinePath`, `Id` (Tasks 11, 14b); `referencePlan`, `lineNamed`, `patchLine`, `planOf`, `ifMatch` (`tests/support/budgeting.ts`); `categoryWithKey`, `cop`, `post`, `HouseholdMember` (`tests/support/ledger.ts`).
- Produces: `MapCategoriesBodySchema` (`budgeting.contract.ts`); `Container.budgeting.mapCategories: MapCategoriesToLine`; `putCategories(user, spaceId, planId, lineId, categoryIds: string[], version?): Promise<Response>` (`tests/support/budgeting.ts`).

- [ ] **Step 1: Write the HTTP helper and the failing tests**

In `src/shared/http/problem.test.ts`, insert after the line `    ["InvalidAllocation", 422],`:

```ts
    ["CategoryNotInSpace", 422],
    ["CategoryAlreadyMapped", 409],
    ["SavingsLineNotMappable", 409],
```

In `tests/support/budgeting.ts`:

1. Insert before the line `import { call, type TestUser } from "./app";`:

```ts
import { PUT as putCategoriesRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/categories/route";
```

2. Append to the end of the file:

```ts

/** HU-E6-04: `user` replaces the categories of the line. */
export const putCategories = (
  user: TestUser,
  spaceId: string,
  planId: string,
  lineId: string,
  categoryIds: string[],
  version?: number,
) =>
  call(putCategoriesRoute, "PUT", plansPath(spaceId, `/${planId}/lines/${lineId}/categories`), {
    user,
    params: { spaceId, planId, lineId },
    body: { categoryIds },
    headers: ifMatch(version),
  });
```

`tests/acceptance/budget-mappings.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/archive/route";
import { DELETE as deleteCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { DELETE as deleteTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, startTestApp } from "../support/app";
import { lineNamed, patchLine, planOf, putCategories, referencePlan, type PlanDto } from "../support/budgeting";
import { categoryWithKey, cop, post, type HouseholdMember } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** `payer` pays `pesos` on `date` from their own account in `categoryId`; returns the expense id. */
const spends = async (payer: HouseholdMember, categoryId: string, pesos: number, date: string) => {
  const response = await post(recordExpense, payer, "expenses", {
    description: "Market",
    date,
    categoryId,
    amount: cop(pesos),
    accountId: payer.account,
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
};

/** The reference plan with Groceries and Utilities mapped to Home (HU-E6-04 Background and first scenario). */
const mapped = async () => {
  const ref = await referencePlan();
  const { h, planId, lineId } = ref;
  const key = (catalogKey: string) => categoryWithKey(h.ana, catalogKey);
  const categories = {
    groceries: await key("groceries"),
    utilities: await key("utilities"),
    entertainment: await key("entertainment"),
    restaurants: await key("restaurants"),
  };
  const response = await putCategories(h.ana, h.spaceId, planId, lineId("Home"), [
    categories.groceries,
    categories.utilities,
  ]);
  expect(response.status).toBe(200);
  return { ...ref, categories, plan: (await response.json()) as PlanDto };
};

describe("category to line mapping (HU-E6-04)", () => {
  it("maps Groceries and Utilities to Home, so a Groceries expense on 2026-11-10 counts as spent in Home", async () => {
    const { h, planId, categories, plan } = await mapped();
    expect([...lineNamed(plan, "Home").categoryIds].sort()).toEqual([categories.groceries, categories.utilities].sort());
    await spends(h.ana, categories.groceries, 85_000, "2026-11-10");
    const home = lineNamed(await planOf(h.juan, h.spaceId, planId), "Home");
    expect([home.spent, home.available]).toEqual([cop(85_000), cop(1_385_000)]);
  });

  it("maps a category to at most one line per plan", async () => {
    const { h, planId, lineId, categories } = await mapped();
    const free = await putCategories(h.ana, h.spaceId, planId, lineId("Free"), [categories.groceries]);
    expect(await problemOf(free)).toEqual([409, "CategoryAlreadyMapped"]);
  });

  it("lets the catch-all line Free consume a 50,000 COP outing recorded on 2026-11-12 (golden)", async () => {
    const { h, planId, lineId, categories } = await mapped();
    expect((await patchLine(h.ana, h.spaceId, planId, lineId("Free"), { isCatchAll: true })).status).toBe(200);
    await spends(h.ana, categories.entertainment, 50_000, "2026-11-12");
    const plan = await planOf(h.ana, h.spaceId, planId);
    expect([lineNamed(plan, "Free").spent, plan.unbudgeted]).toEqual([cop(50_000), null]);
  });

  it("puts a 60,000 COP restaurant expense in Unbudgeted when the plan has no catch-all line", async () => {
    const { h, planId, categories } = await mapped();
    await spends(h.ana, categories.restaurants, 60_000, "2026-11-12");
    expect((await planOf(h.ana, h.spaceId, planId)).unbudgeted).toEqual({
      spent: cop(60_000),
      available: cop(-60_000),
    });
  });

  it("counts live expenses dated within the plan's period, and the transfers into the savings account", async () => {
    const { h, planId, categories, savings } = await mapped();
    await spends(h.ana, categories.groceries, 10_000, "2026-10-31");
    await spends(h.ana, categories.groceries, 20_000, "2026-12-01");
    const deleted = await spends(h.ana, categories.groceries, 30_000, "2026-11-15");
    const removal = await call(deleteTransaction, "DELETE", `/api/v1/spaces/${h.spaceId}/transactions/${deleted}`, {
      user: h.ana,
      params: { spaceId: h.spaceId, transactionId: deleted },
    });
    expect(removal.status).toBe(204);
    const transfer = await post(recordTransfer, h.ana.personal, "transfers", {
      description: "Ahorro",
      date: "2026-11-05",
      amount: cop(200_000),
      sourceAccountId: h.ana.account,
      destinationAccountId: savings,
    });
    expect(transfer.status).toBe(201);
    const plan = await planOf(h.ana, h.spaceId, planId);
    const saved = lineNamed(plan, "Savings");
    expect([lineNamed(plan, "Home").spent, saved.spent, saved.available]).toEqual([
      cop(0),
      cop(200_000),
      cop(400_000),
    ]);
  });

  it("maps only live categories of the plan's space, never newly an archived one, and none to a SAVINGS line", async () => {
    const { h, planId, lineId, categories } = await mapped();
    const personal = await categoryWithKey(h.ana.personal, "groceries");
    const foreign = await putCategories(h.ana, h.spaceId, planId, lineId("Free"), [personal]);
    expect(await problemOf(foreign)).toEqual([422, "CategoryNotInSpace"]);
    const archived = await call(
      archiveCategory,
      "POST",
      `/api/v1/spaces/${h.spaceId}/categories/${categories.restaurants}/archive`,
      { user: h.ana, params: { spaceId: h.spaceId, categoryId: categories.restaurants } },
    );
    expect(archived.status).toBe(200);
    const old = await putCategories(h.ana, h.spaceId, planId, lineId("Free"), [categories.restaurants]);
    expect(await problemOf(old)).toEqual([409, "CategoryArchived"]);
    const savings = await putCategories(h.ana, h.spaceId, planId, lineId("Savings"), [categories.entertainment]);
    expect(await problemOf(savings)).toEqual([409, "SavingsLineNotMappable"]);
  });

  it("keeps a category that a plan maps or once mapped from being deleted (HU-E3-03, Review Focus 6)", async () => {
    const { h, planId, lineId, categories } = await mapped();
    const unmap = await putCategories(h.ana, h.spaceId, planId, lineId("Home"), [categories.groceries]);
    expect(lineNamed((await unmap.json()) as PlanDto, "Home").categoryIds).toEqual([categories.groceries]);
    const removal = await call(
      deleteCategory,
      "DELETE",
      `/api/v1/spaces/${h.spaceId}/categories/${categories.utilities}`,
      { user: h.ana, params: { spaceId: h.spaceId, categoryId: categories.utilities } },
    );
    expect(await problemOf(removal)).toEqual([409, "CategoryInUse"]);
    const { rows } = await app.pool.query("SELECT unmapped_at FROM budget_line_categories WHERE category_id = $1", [
      categories.utilities,
    ]);
    expect(rows.map((r: { unmapped_at: Date | null }) => r.unmapped_at !== null)).toEqual([true]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/shared/http/problem.test.ts && pnpm exec vitest run --project acceptance tests/acceptance/budget-mappings.test.ts`
Expected: FAIL — `maps CategoryNotInSpace to 422` receives 409, and `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/categories/route"`.

- [ ] **Step 3: Implement the contract, the route and the wiring**

In `src/shared/http/problem.ts`, insert after the line `  ["SavingsAccountRequired", 422],`:

```ts
  ["CategoryNotInSpace", 422],
```

In `src/modules/budgeting/contracts/budgeting.contract.ts`:

1. Insert before the line `const lineDto = (figure: LineFigure, currency: string): z.infer<typeof BudgetLineSchema> => {`:

```ts
/** Categories per line: bounds the payload; the use case checks that each is a category of the space. */
const MAX_CATEGORIES = 200;

/** HU-E6-04: the line's whole category set; categories left out are unmapped (the rows stay, D8). */
export const MapCategoriesBodySchema = z.object({ categoryIds: z.array(Id).max(MAX_CATEGORIES) });

```

2. Insert before the last line of the file (`};`):

```ts
  "/api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/categories": {
    put: planWrite(
      "mapCategoriesToLine",
      "Replace the categories a line consumes; a category maps to one line per plan, unmapped ones to the catch-all",
      LinePath,
      MapCategoriesBodySchema,
      {
        "404": "SpaceNotFound, BudgetPlanNotFound, BudgetLineNotFound",
        "409": "CategoryAlreadyMapped, CategoryArchived, SavingsLineNotMappable, SpaceArchived",
        "422": "ValidationFailed, CategoryNotInSpace",
      },
    ),
  },
```

`src/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/categories/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { MapCategoriesBodySchema, planSuccess } from "@/modules/budgeting/contracts/budgeting.contract";
import { ifMatchVersion } from "@/shared/http";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const PUT = defineRoute({
  auth: "required",
  body: MapCategoriesBodySchema,
  handler: async ({ request, user, params, body }) => {
    // Spec 7: If-Match is checked when present; a stale version is 412.
    const expectedVersion = ifMatchVersion(request);
    if (!expectedVersion.ok) return expectedVersion;
    const result = await getContainer().budgeting.mapCategories({
      spaceId: params.spaceId!,
      userId: user!.id,
      planId: params.planId!,
      lineId: params.lineId!,
      expectedVersion: expectedVersion.value,
      categoryIds: body.categoryIds,
    });
    return result.ok ? ok(planSuccess(result.value)) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert after the line `  createUpdateBudgetLine,`:

```ts
  createMapCategoriesToLine,
```

2. Insert after the line `  type UpdateBudgetLine,`:

```ts
  type BudgetCategories,
  type MapCategoriesToLine,
```

3. Insert after the line `    readonly removeLine: RemoveBudgetLine;`:

```ts
    readonly mapCategories: MapCategoriesToLine;
```

4. Insert before the line `  // HU-E6-01 … HU-E6-05: plans reach members, accounts, categories and the ledger's spending only through ports.`:

```ts
  // HU-E6-04: plans map the space's live categories; deleted ones never appear (D8).
  const budgetCategories: BudgetCategories = {
    list: async (spaceId) =>
      (await categoriesDeps.categories.listCategories(spaceId)).map((c) => ({
        id: c.id,
        archived: c.archivedAt !== null,
      })),
  };
```

5. Insert after the line `    plans: budgetPlans,`:

```ts
    mappings: budgetPlans,
    categories: budgetCategories,
```

6. Insert after the line `      removeLine: createRemoveBudgetLine(budgetingDeps),`:

```ts
      mapCategories: createMapCategoriesToLine(budgetingDeps),
```

7. Replace the two lines `      // HU-E3-03: soft-deleted transactions still count as references (D8).` and `      deleteCategory: createDeleteCategory({ ...categoriesDeps, usage: ledgerQueries }),` with:

```ts
      // HU-E3-03: soft-deleted transactions and every budget-line mapping, ended ones included, are references (D8).
      deleteCategory: createDeleteCategory({
        ...categoriesDeps,
        usage: {
          isCategoryReferenced: async (categoryId) =>
            (await ledgerQueries.isCategoryReferenced(categoryId)) || (await budgetPlans.isCategoryMapped(categoryId)),
        },
      }),
```

In `src/modules/categories/application/delete-category.ts`, replace the two lines ` * Whether anything references a category (HU-E3-03). Bound to the ledger, where soft-deleted` and ` * transactions still count (D8); budget-line mappings join with HU-E6-04.` with:

```ts
 * Whether anything references a category (HU-E3-03). Bound to the ledger, where soft-deleted transactions still
 * count, and to budgeting, where every budget-line mapping counts, ended ones included (D8, HU-E6-04).
```

In `docs/backlog/E6-budgeting.md`, insert after the line `- "Unbudgeted" is computed on read, never persisted, and only exists when the plan has no catch-all line.`:

```md
- `PUT …/lines/{lineId}/categories` takes the line's whole category set; categories left out are unmapped (the rows stay, D8), and removing a line ends its mappings. Errors: `CategoryNotInSpace` (422: any id that is not a live category of the plan's space, so other spaces' categories never leak), `CategoryArchived` (409, for categories newly mapped), `CategoryAlreadyMapped` (409), `SavingsLineNotMappable` (409: a SAVINGS line takes no categories and is never the catch-all line, spec 5.4), `CatchAllLineAlreadySet` (409).
- Each line reports `spent` and `available` (planned − spent; HU-E6-09's carry-over is 0 until lines are copied), and the plan reports `unbudgeted` (`spent`, `available`) only when it has no catch-all line. A category that any plan maps or once mapped can no longer be deleted (`CategoryInUse`, HU-E3-03); it can be archived.
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `PUT /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/categories` (about 110 lines); components are unchanged.
Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project acceptance tests/acceptance/budget-mappings.test.ts tests/acceptance/categories.test.ts`
Expected: PASS, M1's category deletion scenarios included (an unmapped category without transactions is still deleted). Mutation check: temporarily restore `usage: ledgerQueries` — "keeps a category that a plan maps or once mapped from being deleted" fails with `204`; restore the binding.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (categories stays independent of budgeting: the reference check is bound in the composition root).

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/contracts/budgeting.contract.ts src/shared/http/problem.ts src/shared/http/problem.test.ts "src/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/categories/route.ts" src/composition/container.ts src/modules/categories/application/delete-category.ts openapi/openapi.snapshot.json docs/backlog/E6-budgeting.md tests/support/budgeting.ts tests/acceptance/budget-mappings.test.ts
git commit -m "feat(budgeting): map categories to lines over HTTP and report what each line spent (Refs #50, Refs #29)"
```

---

### Task 17: Budgeting — AllocateBudgetLine

Implements HU-E6-05 (issue #51) at the use-case level, with its persistence. Pins Review Focus 2 (Juan leaves after Free was split 42 / 58; the guest Pedro; Marta) and Review Focus 6 (earlier values are superseded, never deleted).

Decisions:
- `AllocateBudgetLine` writes through `planForWrite` and `checkedAllocation` (Task 3) for the current members, then `setAllocation` stores the rule on the line and supersedes the line's current values (`superseded_at`) before inserting the new ones (PERCENT basis points or FIXED minor units). PROPORTIONAL and NONE store no values (ruling P1). The `rule` column of a value row records which rule it served.
- Nothing is assigned at write time: every read derives the assignments (Task 4), so a capacity change re-derives PROPORTIONAL lines and a member who leaves flags PERCENT and FIXED lines that named them (ruling P7). Allocating a line again for the current members clears the flag.

**Files:**
- Create: `src/modules/budgeting/application/allocate-budget-line.ts`
- Modify: `src/modules/budgeting/application/ports.ts`, `src/modules/budgeting/application/index.ts`, `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.ts`, `tests/support/in-memory-budgeting.ts`
- Test: `src/modules/budgeting/application/allocations.test.ts`, `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts`

**Interfaces:**
- Consumes: `checkedAllocation`, `AllocationInput`, `AllocationValue` (Task 3); `AllocationRule` (Task 2); `planForWrite`, `loadPlanView`, `createGetBudgetPlan` (Task 8); `lineOf` (Task 12a); `referenceLines`, `aLine` (Task 2); `budgetingWorld`, `BUDGET_MEMBERS`, `HOUSEHOLD`, `NOW`; `InMemorySpaceStore.markLeft` (M2-C).
- Produces:
  - `interface AllocationRepository { setAllocation(lineId: BudgetLineId, rule: AllocationRule, values: readonly AllocationValue[], at: Date): Promise<void> }`
  - `type AllocateBudgetLine = (input: { spaceId; userId; planId; lineId: string; expectedVersion: number | null; allocation: AllocationInput }) => Promise<Result<BudgetPlanView>>`; `type AllocationDeps = BudgetingDeps & { allocations: AllocationRepository }`; `createAllocateBudgetLine(deps: AllocationDeps)` — `SpaceNotFound`, `SpaceArchived`, `InsufficientRole`, `BudgetPlanNotFound`, `PreconditionFailed`, `BudgetLineNotFound`, `InvalidAllocation`, `NotASpaceMember`, `CurrencyMismatch`
  - `DrizzleBudgetPlanRepository.setAllocation`, `InMemoryBudgetPlans.setAllocation`

- [ ] **Step 1: Write the port, the twin and the failing tests**

In `src/modules/budgeting/application/ports.ts`:

1. Replace the line `import type { BudgetLine, BudgetLineId } from "../domain/budget-line";` with:

```ts
import type { AllocationValue } from "../domain/allocation";
import type { AllocationRule, BudgetLine, BudgetLineId } from "../domain/budget-line";
```

2. Append to the end of the file:

```ts

/** HU-E6-05: allocating a line sets its rule and supersedes its earlier member values; nothing is deleted (D8). */
export interface AllocationRepository {
  setAllocation(
    lineId: BudgetLineId,
    rule: AllocationRule,
    values: readonly AllocationValue[],
    at: Date,
  ): Promise<void>;
}
```

In `tests/support/in-memory-budgeting.ts`:

1. Insert before the line `  BudgetLine,`:

```ts
  AllocationRule,
  AllocationValue,
```

2. Insert before the line `  /** Test setup: parts of a plan as earlier writes would have left them. */`:

```ts
  /** AllocationRepository, like DrizzleBudgetPlanRepository.setAllocation. */
  async setAllocation(
    lineId: string,
    rule: AllocationRule,
    values: readonly AllocationValue[],
    at: Date,
  ): Promise<void> {
    this.lines = this.lines.map((r) =>
      r.line.id === lineId ? { ...r, line: { ...r.line, allocationRule: rule } } : r,
    );
    this.allocations = this.allocations.map((r) =>
      r.allocation.lineId === lineId && r.supersededAt === null ? { ...r, supersededAt: at } : r,
    );
    for (const value of values) this.allocations.push({ allocation: { lineId, ...value }, setAt: at, supersededAt: null });
  }

```

`src/modules/budgeting/application/allocations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SpaceMember } from "@/modules/spaces/application";
import { referenceLines } from "../../../../tests/support/budget-fixtures";
import { BUDGET_MEMBERS, budgetingWorld, HOUSEHOLD, NOW } from "../../../../tests/support/budgeting-world";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import type { AllocationInput } from "../domain/allocation";
import { createAllocateBudgetLine } from "./allocate-budget-line";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createGetBudgetPlan } from "./get-budget-plan";
import type { BudgetPlanView } from "./plan-view";

const cop = (pesos: number) => money(BigInt(pesos) * 100n);
const ANA_AND_JUAN = BUDGET_MEMBERS.filter((m) => m.displayName === "Ana" || m.displayName === "Juan");
const percent = (ana: number, juan: number): AllocationInput => ({
  rule: "PERCENT",
  members: [
    { memberId: "member-ana", basisPoints: ana },
    { memberId: "member-juan", basisPoints: juan },
  ],
});
const fixed = (ana: number, juan: number): AllocationInput => ({
  rule: "FIXED",
  members: [
    { memberId: "member-ana", amount: cop(ana) },
    { memberId: "member-juan", amount: cop(juan) },
  ],
});

/** HU-E6-05 Background: the reference plan for 2026-11 with capacities Ana 1,600,000 COP and Juan 2,400,000 COP. */
const world = async (members: readonly SpaceMember[] = ANA_AND_JUAN) => {
  const w = budgetingWorld({ members });
  const deps = { ...w.deps, allocations: w.plans };
  const create = createCreateBudgetPlan(deps);
  const plan = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" })).plan;
  w.plans.seed(plan.id, {
    capacities: [
      { memberId: "member-ana", amount: 160_000_000n },
      { memberId: "member-juan", amount: 240_000_000n },
    ],
    lines: referenceLines(),
  });
  const allocate = createAllocateBudgetLine(deps);
  const allocateLine = (line: string, allocation: AllocationInput, userId = "u-ana") =>
    allocate({ spaceId: HOUSEHOLD, userId, planId: plan.id, lineId: `line-${line}`, expectedVersion: null, allocation });
  return { ...w, deps, plan, allocateLine };
};
const line = (view: BudgetPlanView, name: string) => view.figures.lines.find((l) => l.line.name === name)!;
const assigned = (view: BudgetPlanView, name: string) =>
  line(view, name).allocation.members.map((m) => [m.memberId, m.assigned]);

describe("AllocateBudgetLine (HU-E6-05)", () => {
  it("allocates Home proportionally, the default: Ana 588,000 and Juan 882,000 COP (golden)", async () => {
    const { allocateLine } = await world();
    const view = unwrap(await allocateLine("home", { rule: "PROPORTIONAL" }));
    expect(assigned(view, "Home")).toEqual([
      ["member-ana", 58_800_000n],
      ["member-juan", 88_200_000n],
    ]);
  });

  it("allocates Free at 42 % / 58 %: Ana 306,600 and Juan 423,400 COP (golden)", async () => {
    const { allocateLine } = await world();
    const view = unwrap(await allocateLine("free", percent(4200, 5800)));
    expect([line(view, "Free").line.allocationRule, assigned(view, "Free")]).toEqual([
      "PERCENT",
      [
        ["member-ana", 30_660_000n],
        ["member-juan", 42_340_000n],
      ],
    ]);
  });

  it("allocates Savings by fixed amounts: Ana 200,000 and Juan 400,000 COP", async () => {
    const { allocateLine } = await world();
    const view = unwrap(await allocateLine("savings", fixed(200_000, 400_000)));
    expect(assigned(view, "Savings")).toEqual([
      ["member-ana", 20_000_000n],
      ["member-juan", 40_000_000n],
    ]);
  });

  it("refuses values that do not add up: Free at 42 % / 57 % and Savings at 200,000 / 350,000 COP", async () => {
    const { allocateLine } = await world();
    expect(codeOf(await allocateLine("free", percent(4200, 5700)))).toBe("InvalidAllocation");
    expect(codeOf(await allocateLine("savings", fixed(200_000, 350_000)))).toBe("InvalidAllocation");
  });

  it("leaves Free unassigned as group money with NONE, still reporting planned, spent and available", async () => {
    const { allocateLine, spending } = await world();
    spending.byCategory = [{ categoryId: "cat-entertainment", amount: 25_000_000n }];
    const free = line(unwrap(await allocateLine("free", { rule: "NONE" })), "Free");
    expect([free.allocation, free.spent, free.available]).toEqual([
      { rule: "NONE", members: [], invalid: false },
      25_000_000n,
      48_000_000n,
    ]);
  });

  it("flags a PROPORTIONAL line while every capacity is 0", async () => {
    const { allocateLine, plans, plan } = await world();
    plans.seed(plan.id, {
      capacities: [
        { memberId: "member-ana", amount: 0n },
        { memberId: "member-juan", amount: 0n },
      ],
    });
    expect(line(unwrap(await allocateLine("home", { rule: "PROPORTIONAL" })), "Home").allocation.invalid).toBe(true);
  });

  it("supersedes the earlier values when a line is allocated again (D8, Review Focus 6)", async () => {
    const { allocateLine, plans } = await world();
    unwrap(await allocateLine("free", percent(4200, 5800)));
    unwrap(await allocateLine("free", percent(5000, 5000)));
    unwrap(await allocateLine("free", { rule: "PROPORTIONAL" }));
    expect(plans.allocations.map((r) => [r.allocation.value, r.supersededAt])).toEqual([
      [4200n, NOW],
      [5800n, NOW],
      [5000n, NOW],
      [5000n, NOW],
    ]);
  });

  it("allocates to the guest Pedro like anyone, and refuses Marta (D15, Review Focus 2)", async () => {
    const { allocateLine } = await world(BUDGET_MEMBERS);
    const pedro: AllocationInput = { rule: "FIXED", members: [{ memberId: "member-pedro", amount: cop(600_000) }] };
    expect(assigned(unwrap(await allocateLine("savings", pedro)), "Savings")).toEqual([
      ["member-ana", 0n],
      ["member-juan", 0n],
      ["member-sofi", 0n],
      ["member-pedro", 60_000_000n],
    ]);
    const marta: AllocationInput = {
      rule: "PERCENT",
      members: [{ memberId: "member-marta-personal", basisPoints: 10_000 }],
    };
    expect(codeOf(await allocateLine("free", marta))).toBe("NotASpaceMember");
  });

  it("flags Free once Juan, allocated 58 %, has left, until it is allocated again (Review Focus 2)", async () => {
    const { allocateLine, spaces, plan, deps } = await world();
    unwrap(await allocateLine("free", percent(4200, 5800)));
    await spaces.markLeft(HOUSEHOLD, "member-juan", "USER", NOW);
    const read = createGetBudgetPlan(deps);
    const view = unwrap(await read({ spaceId: HOUSEHOLD, userId: "u-ana", planId: plan.id }));
    expect(line(view, "Free").allocation).toEqual({
      rule: "PERCENT",
      members: [{ memberId: "member-ana", value: 4200n, assigned: null }],
      invalid: true,
    });
    expect(codeOf(await allocateLine("free", percent(4200, 5800)))).toBe("NotASpaceMember");
    const anaAlone: AllocationInput = { rule: "PERCENT", members: [{ memberId: "member-ana", basisPoints: 10_000 }] };
    expect(line(unwrap(await allocateLine("free", anaAlone)), "Free").allocation.invalid).toBe(false);
  });

  it("lets only owners and admins allocate, and answers BudgetLineNotFound for unknown lines", async () => {
    const { allocateLine } = await world();
    expect(codeOf(await allocateLine("home", { rule: "NONE" }, "u-juan"))).toBe("InsufficientRole");
    expect(codeOf(await allocateLine("travel", { rule: "NONE" }))).toBe("BudgetLineNotFound");
  });
});
```

In `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts`:

1. Insert before the line `  BudgetLineRepository,`:

```ts
  AllocationRepository,
```

2. Append to the end of the file:

```ts

describe("DrizzleBudgetPlanRepository allocations (HU-E6-05, D8)", () => {
  it("sets a line's rule and supersedes its earlier values like its in-memory twin", async () => {
    const { space, fixture } = await household();
    const pedro = await guestMemberFixture(pool, fixture, "Pedro");
    const november = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    const free = aLine("Free", 73_000_000n, { id: randomUUID() as BudgetLineId, planId: november.id, createdAt: at });
    const run = async (plans: BudgetPlanRepository & BudgetLineRepository & AllocationRepository) => {
      await plans.add(november);
      await plans.addLine(free, at);
      const split = [
        { memberId: fixture.memberId, value: 4200n },
        { memberId: pedro, value: 5800n },
      ];
      await plans.setAllocation(free.id, "PERCENT", split, at);
      await plans.setAllocation(free.id, "FIXED", [{ memberId: pedro, value: 73_000_000n }], at);
      const fixedParts = await plans.contents(november.id);
      await plans.setAllocation(free.id, "NONE", [], at);
      const noneParts = await plans.contents(november.id);
      return {
        fixed: [fixedParts.lines[0]!.allocationRule, fixedParts.allocations],
        none: [noneParts.lines[0]!.allocationRule, noneParts.allocations],
      };
    };
    const expected = {
      fixed: ["FIXED", [{ lineId: free.id, memberId: pedro, value: 73_000_000n }]],
      none: ["NONE", []],
    };
    expect(await run(new InMemoryBudgetPlans())).toEqual(expected);
    expect(await run(repo)).toEqual(expected);
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM budget_allocations WHERE line_id = $1 AND superseded_at IS NOT NULL",
      [free.id],
    );
    expect(rows[0].n).toBe(3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/application/allocations.test.ts && pnpm exec vitest run --project integration src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts`
Expected: FAIL — `Failed to resolve import "./allocate-budget-line"`, and `plans.setAllocation is not a function` for the PostgreSQL repository.

- [ ] **Step 3: Implement**

In `src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.ts`:

1. Replace the line `import type { BudgetLine, BudgetLineId } from "../domain/budget-line";` with:

```ts
import type { AllocationValue } from "../domain/allocation";
import type { AllocationRule, BudgetLine, BudgetLineId } from "../domain/budget-line";
```

2. Insert before the last line of the file (`}`):

```ts

  async setAllocation(
    lineId: BudgetLineId,
    rule: AllocationRule,
    values: readonly AllocationValue[],
    at: Date,
  ): Promise<void> {
    const db = this.tm.executor();
    await db.update(budgetLines).set({ allocationRule: rule, updatedAt: at }).where(eq(budgetLines.id, lineId));
    // D8: the earlier values stay with supersededAt; the partial unique index admits the new current ones.
    await db
      .update(budgetAllocations)
      .set({ supersededAt: at })
      .where(and(eq(budgetAllocations.lineId, lineId), isNull(budgetAllocations.supersededAt)));
    const stored = rule === "PERCENT" || rule === "FIXED" ? rule : null;
    if (stored !== null && values.length > 0) {
      await db
        .insert(budgetAllocations)
        .values(values.map((v) => ({ lineId, memberId: v.memberId, rule: stored, value: v.value, setAt: at })));
    }
  }
```

`src/modules/budgeting/application/allocate-budget-line.ts`:

```ts
import { ok, type Result } from "@/shared/kernel";
import { checkedAllocation, type AllocationInput } from "../domain/allocation";
import type { BudgetingDeps } from "./deps";
import { lineOf } from "./line-checks";
import { planForWrite } from "./plan-access";
import { loadPlanView, type BudgetPlanView } from "./plan-view";
import type { AllocationRepository } from "./ports";

export type AllocateBudgetLine = (input: {
  spaceId: string;
  userId: string;
  planId: string;
  lineId: string;
  expectedVersion: number | null;
  allocation: AllocationInput;
}) => Promise<Result<BudgetPlanView>>;

export type AllocationDeps = BudgetingDeps & { readonly allocations: AllocationRepository };

/**
 * HU-E6-05: an OWNER or ADMIN allocates a line among the current members: proportionally to capacity (the
 * default), by percentage, by fixed amount, or not at all (NONE, group money). Assigned amounts are derived on read.
 */
export const createAllocateBudgetLine =
  (deps: AllocationDeps): AllocateBudgetLine =>
  (input) =>
    deps.tm.run(async () => {
      const write = await planForWrite(deps, input);
      if (!write.ok) return write;
      const { space, plan, members, parts } = write.value;
      const line = lineOf(parts, input.lineId);
      if (!line.ok) return line;
      const allocation = checkedAllocation(
        input.allocation,
        line.value,
        members.map((m) => m.id),
        space.currency,
      );
      if (!allocation.ok) return allocation;
      await deps.allocations.setAllocation(
        line.value.id,
        allocation.value.rule,
        allocation.value.values,
        deps.clock.now(),
      );
      return ok(await loadPlanView(deps, space, plan));
    });
```

Append to `src/modules/budgeting/application/index.ts`:

```ts
export type { AllocationRepository } from "./ports";
export {
  createAllocateBudgetLine,
  type AllocateBudgetLine,
  type AllocationDeps,
} from "./allocate-budget-line";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/budgeting && pnpm exec vitest run --project integration src/modules/budgeting`
Expected: PASS. Mutation check: temporarily delete the `budgetAllocations` supersede update of `DrizzleBudgetPlanRepository.setAllocation` — the integration test fails with `budget_allocations_current_uq`; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/application/ports.ts src/modules/budgeting/application/allocate-budget-line.ts src/modules/budgeting/application/index.ts src/modules/budgeting/application/allocations.test.ts src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.ts src/modules/budgeting/infrastructure/drizzle-budget-plan-repository.int.test.ts tests/support/in-memory-budgeting.ts
git commit -m "feat(budgeting): allocate budget lines among members and supersede earlier values (Refs #51)"
```

---

### Task 18: HTTP — line allocations

Implements HU-E6-05 (issue #51) over HTTP. Pins Review Focus 2 (Juan leaves the household over HTTP; the guest Pedro), Review Focus 3 (every capacity at 0) and Review Focus 6 (superseded rows stay, checked with SQL).

Decisions:
- `PUT …/lines/{lineId}/allocation` takes `{ "rule": "PROPORTIONAL" }`, `{ "rule": "NONE" }`, `{ "rule": "PERCENT", "members": [{ "memberId", "percent": "42" }] }` or `{ "rule": "FIXED", "members": [{ "memberId", "amount": Money }] }` (a discriminated union, so a FIXED body cannot carry percentages) and answers the plan with its new ETag. Percentages use HU-E4-08's string format and become basis points at the edge.
- A new line answers `rule: "PROPORTIONAL"` with its derived assignments before any allocation request (HU-E6-05 "Proportional allocation is the default").

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/allocation/route.ts`, `tests/acceptance/budget-allocations.test.ts`
- Modify: `src/modules/budgeting/contracts/budgeting.contract.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`, `tests/support/budgeting.ts`, `docs/backlog/E6-budgeting.md`

**Interfaces:**
- Consumes: `createAllocateBudgetLine`, `AllocateBudgetLine`, `AllocationInput` (Tasks 6, 17); `basisPointsOf`, `PercentSchema` (Task 9a); `planWrite`, `LinePath`, `Id`, `MAX_MEMBERS` (Tasks 11, 14b); `referencePlan`, `lineNamed`, `planOf`, `setCapacities`, `ifMatch`, `PlanDto` (`tests/support/budgeting.ts`); `addGuest`, `cop` (`tests/support/ledger.ts`); the M2-C leave route.
- Produces: `AllocationBodySchema`, `allocationFromBody(body): Result<AllocationInput>` (`budgeting.contract.ts`); `Container.budgeting.allocateLine: AllocateBudgetLine`; `putAllocation(user, spaceId, planId, lineId, allocation: unknown, version?): Promise<Response>` (`tests/support/budgeting.ts`).

- [ ] **Step 1: Write the HTTP helper and the failing acceptance test**

In `tests/support/budgeting.ts`:

1. Insert before the line `import { call, type TestUser } from "./app";`:

```ts
import { PUT as putAllocationRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/allocation/route";
```

2. Append to the end of the file:

```ts

/** HU-E6-05: `user` allocates the line; `allocation` is the request body. */
export const putAllocation = (
  user: TestUser,
  spaceId: string,
  planId: string,
  lineId: string,
  allocation: unknown,
  version?: number,
) =>
  call(putAllocationRoute, "PUT", plansPath(spaceId, `/${planId}/lines/${lineId}/allocation`), {
    user,
    params: { spaceId, planId, lineId },
    body: allocation,
    headers: ifMatch(version),
  });
```

`tests/acceptance/budget-allocations.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, startTestApp } from "../support/app";
import { lineNamed, planOf, putAllocation, referencePlan, setCapacities, type PlanDto } from "../support/budgeting";
import { addGuest, cop } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const assignedOn = (plan: PlanDto, name: string) =>
  lineNamed(plan, name).allocation.members.map((m) => [m.memberId, m.assigned]);
const allocated = async (...args: Parameters<typeof putAllocation>): Promise<PlanDto> => {
  const response = await putAllocation(...args);
  expect(response.status).toBe(200);
  return (await response.json()) as PlanDto;
};
const percents = (ana: string, juan: string, anaPercent: string, juanPercent: string) => ({
  rule: "PERCENT",
  members: [
    { memberId: ana, percent: anaPercent },
    { memberId: juan, percent: juanPercent },
  ],
});
const amounts = (ana: string, juan: string, anaPesos: number, juanPesos: number) => ({
  rule: "FIXED",
  members: [
    { memberId: ana, amount: cop(anaPesos) },
    { memberId: juan, amount: cop(juanPesos) },
  ],
});

describe("line allocation rules (HU-E6-05)", () => {
  it("allocates Home proportionally by default: Ana 588,000 and Juan 882,000 COP (golden)", async () => {
    const { h, plan } = await referencePlan();
    expect(lineNamed(plan, "Home").allocation.rule).toBe("PROPORTIONAL");
    expect(assignedOn(plan, "Home")).toEqual([
      [h.ana.memberId, cop(588_000)],
      [h.juan.memberId, cop(882_000)],
    ]);
  });

  it("allocates Free at 42 % / 58 %: Ana 306,600 and Juan 423,400 COP (golden)", async () => {
    const { h, planId, lineId } = await referencePlan();
    const body = percents(h.ana.memberId, h.juan.memberId, "42", "58");
    const plan = await allocated(h.ana, h.spaceId, planId, lineId("Free"), body);
    expect(lineNamed(plan, "Free").allocation.members).toEqual([
      { memberId: h.ana.memberId, percent: "42.00", amount: null, assigned: cop(306_600) },
      { memberId: h.juan.memberId, percent: "58.00", amount: null, assigned: cop(423_400) },
    ]);
  });

  it("allocates Savings by fixed amounts: Ana 200,000 and Juan 400,000 COP", async () => {
    const { h, planId, lineId } = await referencePlan();
    const body = amounts(h.ana.memberId, h.juan.memberId, 200_000, 400_000);
    const plan = await allocated(h.ana, h.spaceId, planId, lineId("Savings"), body);
    expect(lineNamed(plan, "Savings").allocation.members).toEqual([
      { memberId: h.ana.memberId, percent: null, amount: cop(200_000), assigned: cop(200_000) },
      { memberId: h.juan.memberId, percent: null, amount: cop(400_000), assigned: cop(400_000) },
    ]);
  });

  it("refuses values that do not add up: Free at 42 % / 57 % and Savings at 200,000 / 350,000 COP", async () => {
    const { h, planId, lineId } = await referencePlan();
    const free = percents(h.ana.memberId, h.juan.memberId, "42", "57");
    expect(await problemOf(await putAllocation(h.ana, h.spaceId, planId, lineId("Free"), free))).toEqual([
      422,
      "InvalidAllocation",
    ]);
    const savings = amounts(h.ana.memberId, h.juan.memberId, 200_000, 350_000);
    expect(await problemOf(await putAllocation(h.ana, h.spaceId, planId, lineId("Savings"), savings))).toEqual([
      422,
      "InvalidAllocation",
    ]);
  });

  it("leaves Free unassigned as group money with NONE, reporting only planned, spent and available", async () => {
    const { h, planId, lineId } = await referencePlan();
    const plan = await allocated(h.ana, h.spaceId, planId, lineId("Free"), { rule: "NONE" });
    expect(lineNamed(plan, "Free")).toMatchObject({
      plannedAmount: cop(730_000),
      spent: cop(0),
      available: cop(730_000),
      allocation: { rule: "NONE", members: [], error: null },
    });
  });

  it("flags Home with InvalidAllocation while every capacity is 0 (Review Focus 3)", async () => {
    const { h, planId } = await referencePlan();
    const plan = await setCapacities(h.ana, h.spaceId, planId, [
      [h.ana.memberId, 0],
      [h.juan.memberId, 0],
    ]);
    expect(lineNamed(plan, "Home").allocation).toMatchObject({ rule: "PROPORTIONAL", error: "InvalidAllocation" });
    expect(assignedOn(plan, "Home")).toEqual([
      [h.ana.memberId, null],
      [h.juan.memberId, null],
    ]);
  });

  it("allocates to the guest Pedro like anyone (D15)", async () => {
    const { h, planId, lineId } = await referencePlan();
    const pedro = await addGuest(h, "Pedro");
    const body = { rule: "FIXED", members: [{ memberId: pedro, amount: cop(600_000) }] };
    const plan = await allocated(h.ana, h.spaceId, planId, lineId("Savings"), body);
    expect(assignedOn(plan, "Savings")).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
      [pedro, cop(600_000)],
    ]);
  });

  it("flags Free once Juan, allocated 58 %, leaves the household (Review Focus 2)", async () => {
    const { h, planId, lineId } = await referencePlan();
    await allocated(h.ana, h.spaceId, planId, lineId("Free"), percents(h.ana.memberId, h.juan.memberId, "42", "58"));
    const left = await call(leaveSpace, "POST", `/api/v1/spaces/${h.spaceId}/leave`, {
      user: h.juan,
      params: { spaceId: h.spaceId },
    });
    expect(left.status).toBe(204);
    const plan = await planOf(h.ana, h.spaceId, planId);
    expect(lineNamed(plan, "Free").allocation).toEqual({
      rule: "PERCENT",
      members: [{ memberId: h.ana.memberId, percent: "42.00", amount: null, assigned: null }],
      error: "InvalidAllocation",
    });
    expect(assignedOn(plan, "Home")).toEqual([[h.ana.memberId, cop(1_470_000)]]);
    expect([plan.totalCapacity, plan.unallocated]).toEqual([cop(1_600_000), cop(-2_400_000)]);
  });

  it("supersedes the earlier values when a line is allocated again, keeping their rows (D8, Review Focus 6)", async () => {
    const { h, planId, lineId } = await referencePlan();
    const free = lineId("Free");
    await allocated(h.ana, h.spaceId, planId, free, percents(h.ana.memberId, h.juan.memberId, "42", "58"));
    await allocated(h.ana, h.spaceId, planId, free, { rule: "PROPORTIONAL" });
    const { rows } = await app.pool.query(
      "SELECT value::text AS value, superseded_at IS NOT NULL AS superseded FROM budget_allocations WHERE line_id = $1 ORDER BY value",
      [free],
    );
    expect(rows).toEqual([
      { value: "4200", superseded: true },
      { value: "5800", superseded: true },
    ]);
  });

  it("refuses MEMBER Juan, a stale If-Match, an id that is not a member and a malformed percentage", async () => {
    const { h, planId, lineId, plan } = await referencePlan();
    const home = lineId("Home");
    const juans = await putAllocation(h.juan, h.spaceId, planId, home, { rule: "NONE" });
    expect(await problemOf(juans)).toEqual([403, "InsufficientRole"]);
    const stale = await putAllocation(h.ana, h.spaceId, planId, home, { rule: "NONE" }, plan.version - 1);
    expect(await problemOf(stale)).toEqual([412, "PreconditionFailed"]);
    const stranger = { rule: "PERCENT", members: [{ memberId: "not-a-member", percent: "100" }] };
    expect(await problemOf(await putAllocation(h.ana, h.spaceId, planId, home, stranger))).toEqual([
      422,
      "NotASpaceMember",
    ]);
    const malformed = { rule: "PERCENT", members: [{ memberId: h.ana.memberId, percent: "4.123" }] };
    expect(await problemOf(await putAllocation(h.ana, h.spaceId, planId, home, malformed))).toEqual([
      422,
      "ValidationFailed",
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/budget-allocations.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/allocation/route"`.

- [ ] **Step 3: Implement the contract, the route and the wiring**

In `src/modules/budgeting/contracts/budgeting.contract.ts`:

1. Insert before the line `  jsonContent,`:

```ts
  basisPointsOf,
```

2. Insert after the line `  percentOf,`:

```ts
  PercentSchema,
```

3. Insert after the line `  ROLLOVER_MODES,`:

```ts
  type AllocationInput,
```

4. Insert before the line `const lineDto = (figure: LineFigure, currency: string): z.infer<typeof BudgetLineSchema> => {`:

```ts
/** HU-E6-05: one rule per line; PERCENT and FIXED name current members (guests too) with positive values. */
export const AllocationBodySchema = z.discriminatedUnion("rule", [
  z.object({ rule: z.literal("PROPORTIONAL") }),
  z.object({ rule: z.literal("NONE") }),
  z.object({
    rule: z.literal("PERCENT"),
    members: z.array(z.object({ memberId: Id, percent: PercentSchema })).max(MAX_MEMBERS),
  }),
  z.object({
    rule: z.literal("FIXED"),
    members: z.array(z.object({ memberId: Id, amount: MoneySchema })).max(MAX_MEMBERS),
  }),
]);

/** The body as AllocateBudgetLine takes it: percentages become basis points and FIXED amounts Money. */
export const allocationFromBody = (body: z.infer<typeof AllocationBodySchema>): Result<AllocationInput> => {
  switch (body.rule) {
    case "PROPORTIONAL":
      return ok({ rule: "PROPORTIONAL" as const });
    case "NONE":
      return ok({ rule: "NONE" as const });
    case "PERCENT":
      return ok({
        rule: "PERCENT" as const,
        members: body.members.map((m) => ({ memberId: m.memberId, basisPoints: basisPointsOf(m.percent) })),
      });
    case "FIXED": {
      const members: { memberId: string; amount: Money }[] = [];
      for (const m of body.members) {
        const amount = moneyFromDto(m.amount);
        if (!amount.ok) return amount;
        members.push({ memberId: m.memberId, amount: amount.value });
      }
      return ok({ rule: "FIXED" as const, members });
    }
  }
};

```

5. Insert before the last line of the file (`};`):

```ts
  "/api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/allocation": {
    put: planWrite(
      "allocateBudgetLine",
      "Allocate a line among members proportionally to capacity, by percentage, by fixed amount, or not at all",
      LinePath,
      AllocationBodySchema,
      {
        "404": "SpaceNotFound, BudgetPlanNotFound, BudgetLineNotFound",
        "409": "SpaceArchived",
        "422": "ValidationFailed, InvalidAllocation, NotASpaceMember, CurrencyMismatch, UnknownCurrency",
      },
    ),
  },
```

`src/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/allocation/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  AllocationBodySchema,
  allocationFromBody,
  planSuccess,
} from "@/modules/budgeting/contracts/budgeting.contract";
import { ifMatchVersion } from "@/shared/http";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const PUT = defineRoute({
  auth: "required",
  body: AllocationBodySchema,
  handler: async ({ request, user, params, body }) => {
    // Spec 7: If-Match is checked when present; a stale version is 412.
    const expectedVersion = ifMatchVersion(request);
    if (!expectedVersion.ok) return expectedVersion;
    const allocation = allocationFromBody(body);
    if (!allocation.ok) return allocation;
    const result = await getContainer().budgeting.allocateLine({
      spaceId: params.spaceId!,
      userId: user!.id,
      planId: params.planId!,
      lineId: params.lineId!,
      expectedVersion: expectedVersion.value,
      allocation: allocation.value,
    });
    return result.ok ? ok(planSuccess(result.value)) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert after the line `  createMapCategoriesToLine,`:

```ts
  createAllocateBudgetLine,
```

2. Insert after the line `  type MapCategoriesToLine,`:

```ts
  type AllocateBudgetLine,
```

3. Insert after the line `    readonly mapCategories: MapCategoriesToLine;`:

```ts
    readonly allocateLine: AllocateBudgetLine;
```

4. Insert after the line `    plans: budgetPlans,`:

```ts
    allocations: budgetPlans,
```

5. Insert after the line `      mapCategories: createMapCategoriesToLine(budgetingDeps),`:

```ts
      allocateLine: createAllocateBudgetLine(budgetingDeps),
```

In `docs/backlog/E6-budgeting.md`, insert after the line `- Percentages stored as basis points (42% = 4200).`:

```md
- `PUT …/lines/{lineId}/allocation` takes `{ "rule": "PROPORTIONAL" | "NONE" }`, `{ "rule": "PERCENT", "members": [{ "memberId", "percent": "42" }] }` or `{ "rule": "FIXED", "members": [{ "memberId", "amount" }] }`. The rule is stored on the line (PROPORTIONAL for a new line); PERCENT and FIXED values are member rows that a new allocation supersedes (`superseded_at`, D8). Errors: `InvalidAllocation` (422: values that do not sum to 100 % or to the planned amount, a value that is not positive, a member listed twice, or no members), `NotASpaceMember` (422), `CurrencyMismatch` (422).
- Assigned amounts are derived on read for the current members in join order (largest remainder in rounding units, spec 5.3). A line answers `allocation.error: "InvalidAllocation"` and no assigned amounts while a PROPORTIONAL line has no capacity to follow, or while PERCENT or FIXED values no longer add up (for instance after a member who held one left).
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `PUT /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/allocation` with a `oneOf` request body (about 200 lines); components are unchanged.
Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project acceptance tests/acceptance/budget-allocations.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/contracts/budgeting.contract.ts "src/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/allocation/route.ts" src/composition/container.ts openapi/openapi.snapshot.json docs/backlog/E6-budgeting.md tests/support/budgeting.ts tests/acceptance/budget-allocations.test.ts
git commit -m "feat(budgeting): allocate budget lines over HTTP with derived assignments (Refs #51)"
```

---

### Task 19: HTTP — plans of an archived space only read

Pins Review Focus 5 (HU-E1-09 for every M3-A endpoint; issues #47–#51): one guard (`SpaceAccess` without `readOnly`) refuses every plan write, and `space.read` keeps both plan reads open. Test only; no production change unless a row is red.

Decisions:
- One table per kind, like M2-C's `archived-space.test.ts`: both reads answer `200` for any member, and every M3-A write endpoint answers `409 SpaceArchived` with the plan left at its version. A write that escaped the guard would answer `200` or `201` and read as a failing row, not a crash.

**Files:**
- Test: `tests/acceptance/budget-archived.test.ts`

**Interfaces:**
- Consumes: the M2-C archive route; `referencePlan`, `createPlan`, `getPlan`, `getSuggestion`, `putCapacities`, `postLine`, `patchLine`, `deleteLine`, `putCategories`, `putAllocation`, `planOf`, `lineNamed` (`tests/support/budgeting.ts`); `categoryWithKey` (`tests/support/ledger.ts`).
- Produces: nothing new (test only).

- [ ] **Step 1: Write the test**

`tests/acceptance/budget-archived.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, startTestApp } from "../support/app";
import {
  createPlan,
  deleteLine,
  getPlan,
  getSuggestion,
  lineNamed,
  patchLine,
  planOf,
  postLine,
  putAllocation,
  putCapacities,
  putCategories,
  referencePlan,
} from "../support/budgeting";
import { categoryWithKey } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** HU-E1-09: the reference plan's Household, settled (nothing recorded) and then archived. */
const archivedPlan = async () => {
  const ref = await referencePlan();
  const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${ref.h.spaceId}/archive`, {
    user: ref.h.ana,
    params: { spaceId: ref.h.spaceId },
  });
  expect(archived.status).toBe(204);
  return ref;
};

describe("plans of an archived space only read (HU-E1-09, Review Focus 5)", () => {
  it("answers both plan reads with 200, for any member", async () => {
    const { h, planId } = await archivedPlan();
    const reads: [string, () => Promise<Response>][] = [
      ["the plan", () => getPlan(h.juan, h.spaceId, planId)],
      ["the capacity suggestion", () => getSuggestion(h.juan, h.spaceId, planId)],
    ];
    const answers: [string, number][] = [];
    for (const [what, read] of reads) answers.push([what, (await read()).status]);
    expect(answers).toEqual(reads.map(([what]) => [what, 200]));
  });

  it("answers every plan write endpoint of M3-A with 409 SpaceArchived and changes nothing", async () => {
    const { h, planId, lineId, plan } = await archivedPlan();
    const home = lineId("Home");
    const groceries = await categoryWithKey(h.ana, "groceries");
    const writes: [string, () => Promise<Response>][] = [
      ["create a plan", () => createPlan(h.ana, h.spaceId, "2026-12")],
      ["set capacities", () => putCapacities(h.ana, h.spaceId, planId, [[h.ana.memberId, 1]])],
      ["add a line", () => postLine(h.ana, h.spaceId, planId, { name: "Travel", pesos: 1 })],
      ["edit a line", () => patchLine(h.ana, h.spaceId, planId, home, { name: "House" })],
      ["remove a line", () => deleteLine(h.ana, h.spaceId, planId, home)],
      ["map categories", () => putCategories(h.ana, h.spaceId, planId, home, [groceries])],
      ["allocate a line", () => putAllocation(h.ana, h.spaceId, planId, home, { rule: "NONE" })],
    ];
    const answers: [string, number, string][] = [];
    for (const [what, write] of writes) answers.push([what, ...(await problemOf(await write()))]);
    expect(answers).toEqual(writes.map(([what]) => [what, 409, "SpaceArchived"]));
    const after = await planOf(h.ana, h.spaceId, planId);
    expect([after.version, lineNamed(after, "Home").name, after.lines.length]).toEqual([plan.version, "Home", 4]);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/budget-archived.test.ts`
Expected: PASS. Mutation check: temporarily replace `const membership = await deps.access(input.spaceId, input.userId);` in `planForWrite` with `const membership = await deps.access(input.spaceId, input.userId, { readOnly: true });` — every row but "create a plan" answers `200` or `201`; restore it. This test is written after the code it pins (Tasks 8–18), so the mutation check is its red step.

- [ ] **Step 3: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/acceptance/budget-archived.test.ts
git commit -m "test(budgeting): pin every plan read and write endpoint of an archived space over HTTP (Refs #47, Refs #48, Refs #49, Refs #50, Refs #51)"
```

---

## Self-Review

### Story coverage

| Story (issue) | Scenario or technical note | Domain / application test | PostgreSQL / HTTP test |
|---|---|---|---|
| HU-E6-01 (#47) | Create a draft plan (2026-11 runs 2026-11-01 … 2026-11-30) | Task 1 `openPlan`, Task 8 "creates a DRAFT plan …" | Task 9b "creates a DRAFT plan … and reads it back with its ETag" |
| | Only one plan per period (`PlanAlreadyExists`) | Tasks 1, 8 | Task 6 (`add` answers false), Task 9b, Task 13 (two at once) |
| | Member cannot create plans (`InsufficientRole`) | Task 8 | Task 9b |
| | Personal spaces can also have plans | Task 8 | Task 9b |
| | A semi-monthly space gets two plans per month, each with its own capacities | Tasks 1, 8 | Task 9b (periods), Task 11 (capacities per plan) |
| | Note: `POST …/plans`, `GET …/plans/{planId}` with `ETag` | — | Tasks 9a, 9b |
| | Note: unique (spaceId, startDate); label and dates stored at creation (D10) | Task 8 (policy change) | Task 5 (`budget_plans_space_start_uq`), Task 9b (periods list after a policy change) |
| HU-E6-02 (#48) | Capacities define the proportional ratio 40.00 % / 60.00 % (golden) | Tasks 1, 4, 10 | Tasks 9a (DTO), 11 |
| | Negative capacity (`InvalidCapacity`) | Tasks 1, 10 | Task 11 |
| | Capacity for a non-member (`NotASpaceMember`) | Tasks 1, 10 | Task 11 (Marta's member id) |
| | Reducing capacity below planned lines reports −400,000 COP unallocated | Tasks 4, 10 | Task 14a |
| | Capacity suggested privately from the member's own previous-period income | Task 10 | Task 11 (Juan never sees Ana's suggestion or income) |
| | Notes: `PUT …/capacities`, `GET …/capacity-suggestion`; 0 without a capacity; guests hold capacity; PROPORTIONAL re-derived on read | Tasks 1, 4, 10 | Tasks 5, 10 (PostgreSQL), 11 |
| HU-E6-03 (#49) | Lines and unallocated capacity: 1,330,000 COP, Home 36.75 % (golden) | Tasks 2, 4, 12a | Task 14a |
| | Full reference plan leaves nothing unallocated (golden) | Tasks 2, 4, 12a | Task 14a |
| | Lines cannot exceed total capacity (`PlanExceedsCapacity`) | Tasks 2, 12a, 12b | Tasks 13 (concurrent), 14a, 14b |
| | Line names are unique within a plan (`BudgetLineNameTaken`) | Tasks 2, 12a | Tasks 5, 14a |
| | Planned amount must be positive (`InvalidPlannedAmount`) | Tasks 2, 12a | Tasks 5, 14a |
| | Savings lines require at least one savings account (`SavingsAccountRequired`) | Tasks 2, 12a | Tasks 5, 14a |
| | Notes: `UpdateBudgetLine`, `RemoveBudgetLine`, `PATCH`/`DELETE`; SAVINGS spending is transfers into its accounts; percent with two decimals | Tasks 4, 12b | Tasks 7, 9a, 12a (PostgreSQL), 14b, 16 |
| HU-E6-04 (#50) | Map categories to a line; a Groceries expense counts as spent in Home | Tasks 2, 4, 15 | Tasks 7, 15 (PostgreSQL), 16 |
| | A category maps to at most one line per plan (`CategoryAlreadyMapped`) | Tasks 2, 15 | Tasks 5, 16 |
| | Unmapped categories fall into the catch-all line (golden) | Tasks 4, 15 | Task 16 |
| | Without a catch-all line, unmapped categories fall into Unbudgeted | Tasks 4, 15 | Task 16 |
| | A plan has at most one catch-all line (`CatchAllLineAlreadySet`) | Tasks 2, 12a, 12b | Tasks 5, 14b |
| | Only categories of the same space can be mapped (`CategoryNotInSpace`) | Tasks 2, 15 | Task 16 |
| | Notes: `PUT …/categories`, `PATCH … isCatchAll`; archived categories not newly mapped; Unbudgeted computed on read | Tasks 2, 4, 15 | Tasks 14b, 16 |
| HU-E6-05 (#51) | Proportional allocation is the default: 588,000 / 882,000 COP (golden) | Tasks 3, 4, 17 | Tasks 9a (DTO), 18 |
| | Custom percentage 42 % / 58 %: 306,600 / 423,400 COP (golden) | Tasks 3, 4, 17 | Tasks 9a, 18 |
| | Fixed amounts 200,000 / 400,000 COP | Tasks 3, 17 | Task 18 |
| | Allocation values must add up (outline: 42 / 57 %, 200,000 / 350,000 COP) | Tasks 3, 17 | Task 18 |
| | A line can stay unassigned as group money (`NONE`) | Tasks 4, 17 | Tasks 9a, 18 |
| | Proportional allocation requires positive total capacity (flagged) | Tasks 3, 4, 17 | Task 18 |
| | Notes: `PUT …/allocation`; derived assigned amounts; one rule per line; NONE stores no rows; basis points | Tasks 3, 4, 17 | Tasks 5, 17 (PostgreSQL), 18 |

No scenario of HU-E6-01 … HU-E6-05 is left without a test. M3-B and M3-C scenarios are not planned here (see Out of scope).

### Review Focus pins

| Review Focus | Pinned by |
|---|---|
| 1. Two writes to one plan at the same moment | Task 13 "adds one of two lines that each fit the capacity but not together" (rendezvous; red when `lockForWrite` stops locking) and "creates one of two simultaneous plans for the same period"; Task 6 (`added: [true, true, false]`); Task 8 `planForWrite` "refuses a stale If-Match"; Tasks 10, 11, 12a, 14a, 14b, 18 (`412`, nothing changes) |
| 2. Guests, former members and non-members | Task 1 "counts only current members", "lets a guest hold capacity"; Task 3 "flags PERCENT and FIXED lines whose values no longer add up after a member left"; Task 4 "drops a member who left from every figure …", "counts a guest's capacity"; Task 10 (Pedro, Marta, Juan's own capacity); Task 11 (HTTP); Task 17 "flags Free once Juan … has left", "allocates to the guest Pedro"; Task 18 (Juan leaves over HTTP, Pedro FIXED) |
| 3. Money that does not divide evenly or has nothing to follow | Task 3 "gives remainders to the earliest-joined members …", "never gives a remainder to a member without weight", "flags a PROPORTIONAL line when every capacity is 0", kernel "allocates by bigint weights"; Task 4 (zero capacity, reduced capacity); Task 14a (−400,000 COP); Task 18 (every capacity at 0) |
| 4. Policy or currency changing once a plan exists | Task 8 "starts a plan the day after a stored plan once the policy changed"; Task 9b "keeps the 2026-11 plan's dates …" and "locks the space currency once a plan exists" (with a mutation check on the `storedPeriods` binding) |
| 5. Identifiers from elsewhere, archived spaces | Task 6 (`foreign`, `malformed`); Task 8 (another space's plan, `budget-404`, archived reads and writes); Task 9b (malformed and foreign plan ids over HTTP); Task 12a and 14a (Marta's and Juan's accounts, `not-a-uuid`); Tasks 12b and 14b (unknown and malformed line ids); Tasks 15 and 16 (Ana's personal category, unknown ids); Task 19 (every read 200, every write 409) |
| 6. Removing or replacing parts of a plan | Task 5 (partial unique indexes over current rows); Task 12a (removed row kept, `deleted_at` once); Task 12b and 14b (name reused, row kept, second removal 404); Task 15 (ended mapping kept, a removed line frees its categories; PostgreSQL count of 5 rows); Task 16 (`CategoryInUse` for a category once mapped); Tasks 17 and 18 (superseded values kept, SQL check) |

### Spec contradictions found

1. **Spec 5.2 Allocation** ("lineId, memberId, rule, value … a line without allocation rows has rule `NONE`") **vs HU-E6-05** ("Proportional allocation is the default"; "Rule `NONE` stores no member rows"). If the rule lived only on member rows, a new line would be NONE, PROPORTIONAL would need rows that a new member never gets, and NONE and PROPORTIONAL could not both store nothing. The plan stores the rule on the line (`budget_lines.allocation_rule`, PROPORTIONAL for a new line) and member rows only for PERCENT and FIXED (Tasks 3, 5, 17). **Ruled by the controller (P1):** accepted (controller, 2026-10-14), and amend spec 5.2 to "Allocation — lineId, memberId, value; the line carries the rule (`PROPORTIONAL` by default, `PERCENT`, `FIXED`, `NONE`), and only PERCENT and FIXED lines have member rows".
2. **HU-E6-02's user story** ("As a household admin, I want to record each member's monthly capacity") **vs D17 / spec 5.2 MemberCapacity** ("When a registered member sets their own capacity, the app suggests …"). D17 presumes a member sets their own capacity, and the private suggestion is useless to a member who cannot. The plan adds `capacity.setOwn` (OWNER, ADMIN, MEMBER; own member only) beside `plan.manage` (Tasks 8, 10). **Ruled by the controller (P2):** accepted (controller, 2026-10-14), and list both actions in the HU-E1-05 matrix documentation; the alternative is `plan.manage` only, with the suggestion still available to every member.
3. **Spec 7** ("`ETag` / `If-Match` on updates of transactions and plans") **vs the story notes**, which name `ETag` only on `GET …/plans/{planId}` (HU-E6-01) and `If-Match` only on activate and close (HU-E6-07). The plan bumps the version on every write to a plan or its parts, under a row lock, and honours an optional `If-Match` on all of them (Tasks 6, 8): the same lock keeps the capacity invariant on committed data (Task 13). **Ruled by the controller (P3):** accepted (controller, 2026-10-14) as the reading of spec 7 for M3-A; HU-E6-07 keeps its own `If-Match` note.
4. **HU-E6-04's scenarios** ("… counts as spent in Home", "… in the implicit line Unbudgeted") **vs HU-E6-09's note** ("Exposed as `available` and `carryOver` on each line of `GET …/plans/{planId}`", M3-B) and HU-E7-01 (M4). HU-E6-04 cannot be tested without `spent`. The plan exposes `spent` and `available` on each line and `unbudgeted` on the plan now (Tasks 4, 7, 9a, 16), with the carry-over 0, which is exactly HU-E6-09's rule for lines without an origin; HU-E6-09 adds `carryOver` and the formula's carry term. **Ruled by the controller (P4):** accepted (controller, 2026-10-14); M3-B extends `planFigures` instead of introducing the fields.
5. **HU-E6-04** ("maps a category from her personal space … `CategoryNotInSpace`") **vs spec 8** ("existence is not leaked"; the ledger answers `AccountNotFound` for other spaces' funds). Answering `CategoryNotInSpace` only for categories that exist elsewhere would reveal them. The plan answers `422 CategoryNotInSpace` for every id that is not a live category of the plan's space, unknown ids included (Tasks 2, 15, 16). **Ruled by the controller (P6):** accepted (controller, 2026-10-14); nothing distinguishes an unknown id from a foreign one.

### Assumptions

1. **`PUT …/capacities` sets the listed members and keeps the others** (Tasks 1, 10, 11). HU-E6-02's "sets the capacity of Juan to 2,000,000 COP … total 3,600,000 COP" keeps Ana's 1,600,000, which a whole-set PUT would reset. Capacities are edited in place (an edit, not a delete). **Ruled by the controller (P5):** accepted (controller, 2026-10-14); the alternative is a whole-set PUT where clients always send every member.
2. **Figures follow the current members** (Tasks 1, 3, 4). The spec is silent on members who leave a space that has a DRAFT plan. A former member keeps their capacity and allocation rows (D8) but drops out of total capacity, shares and assignments; a PERCENT or FIXED line that named them is flagged `InvalidAllocation` until it is allocated again, as HU-E6-06 shows after a copy. **Ruled by the controller (P7):** accepted (controller, 2026-10-14); HU-E6-07 then refuses to activate a plan with a flagged line.
3. **SAVINGS lines** (Tasks 2, 12a, 14a). SAVINGS accounts are personal accounts (`PersonalAccountRequiresPersonalSpace`, HU-E2-01), so a shared space's SAVINGS line newly names only savings accounts its caller owns, as the ledger admits a personal account only for its owner (D9); every other account, unknown ones included, answers the same `AccountNotFound`, and accounts the line already names stay. An account backs one SAVINGS line per plan (`SavingsAccountAlreadyUsed`), so a transfer is never counted twice; a SAVINGS line takes no categories and is never the catch-all line (`SavingsLineNotMappable`), because spec 5.4 counts its spending as transfers. Its spending counts transfers into its accounts recorded in any space, while the account's owner is a current registered member of the plan's space, evaluated whenever the plan is read. Members see the account ids on the line, never the accounts' names or balances. **Ruled by the controller (P8, amended after the final review):** accepted (controller, 2026-10-14) the three new codes (`SavingsAccountAlreadyUsed`, `SavingsLineNotMappable`, `InvalidSavingsAccount`) and add them to the HU-E6-03 and HU-E6-04 notes (Tasks 14a, 16 do). The final review (I2) showed that naming any member's account let an OWNER or ADMIN publish a co-member's savings inflows to the group without that member's act, and kept doing so after the member left, while the error codes told whether an id was a SAVINGS or an archived account. Amended (controller, 2026-10-15): (a) a SAVINGS line newly names only SAVINGS accounts owned by the caller, mirroring the ledger's `ownAccount` rule (D9), and accounts the line already names stay and are not checked again; (b) every account the caller cannot attach answers the same `404 AccountNotFound` with identical details, and only the caller's own account can answer `InvalidSavingsAccount` or `AccountArchived`; (c) a line's spending counts transfers only into accounts whose owner is a current registered member of the plan's space, so an account whose owner left stops counting for every reader, and counts again if the owner rejoins (the filter runs at read time, over the whole period); (d) the cost is that a MEMBER's or VIEWER's savings cannot back a line, since only OWNER and ADMIN write lines (owner consent is a follow-up of HU-E9-08). The final review (I1) added that a newly named account must be in the plan space's currency (`CurrencyMismatch`), because the sum of transfers is in the account's currency: an attach-time check is enough, as an account's space currency locks once it holds money.
4. **Every plan write answers the whole plan with its new ETag** (Tasks 9a, 11, 14a, 14b, 16, 18): `201` for `POST …/plans` (with `Location`) and `POST …/lines`, `200` for the others, `DELETE …/lines/{lineId}` included (instead of `204`), so a client sees the recomputed unallocated capacity and can send the next `If-Match` without a read. **Ruled by the controller (P9):** accepted (controller, 2026-10-14).
5. `funding` defaults to `DIRECT` and `rolloverMode` to `RESET` when a new line omits them (HU-E6-03 scenarios add "Free" and "Travel" without naming them). Line names are 1–60 characters, like categories (`InvalidBudgetLineName`).
6. `SetCatchAllLine` of HU-E6-04 is `UpdateBudgetLine` with `isCatchAll` (its note names `PATCH …/lines/{lineId}` for it); `POST …/lines` also accepts `isCatchAll`.
7. The capacity suggestion reads the income of the caller's personal space only (HU-E6-02 "income … in her personal space"), dated within the period before the plan's in the plan space's policy (spec 5.3, stored plans first); `suggested` is null when the personal space keeps another currency (D6). Every member may ask for their own suggestion (`space.read`); VIEWERs just cannot save it.
8. The plan's `ETag` is its version; spending figures change with the ledger, not with the version (D7). `If-Match` guards plan edits, not figures.
9. A category mapped by any plan, ended mappings included, can no longer be deleted (HU-E3-03 note; Task 16), mirroring the ledger, where soft-deleted transactions still count. Deleting a category races a simultaneous mapping of it: the category could end up deleted (logically) and still mapped. Its row stays, so no foreign key breaks; the mapping consumes nothing (a deleted category has no expenses, `CategoryInUse` saw to that) and the line's next `PUT …/categories` without it ends the mapping (accepted for v1; follow-up 4).
10. Percentages on the wire follow HU-E4-08 (`"42"`, `"33.33"` in requests; `"42.00"` in responses), stored as basis points (HU-E6-05 note). The ledger's percent helpers move to `src/shared/http/contracts.ts` unchanged.
11. **No real dependency on M3-B.** M3-A plans stay DRAFT: nothing activates or closes them (HU-E6-07), so the ledger's `ClosedPeriodGuard` stays "never closed" and no split defaults change (HU-E6-08: DRAFT plans never drive splits). M3-B hooks: HU-E6-07 adds the CLOSED/`PeriodClosed` check in `planForWrite` (one place) — after the row lock: `planForWrite` reads the plan before `lockForWrite`, so M3-B must have `lockForWrite` return the locked row (version and status) or re-read the plan after the lock, or a concurrent close could slip through (preflight N4) and reads `planFigures` (`unallocated < 0`, `allocation.invalid`) for `PlanExceedsCapacity` and `InvalidAllocation` on activation; HU-E6-06 fills `createdFrom` and `originLineId` (both columns exist); HU-E6-09 adds `carryOver` to `planFigures`; HU-E6-08 reuses `lineForCategory` and `assignedAmounts`.

12. **A plan created while the period policy changes** (preflight N5): only `budget_plans_space_start_uq` guards creation, so a `CreateBudgetPlan` racing an `UpdateSpaceSettings` that changes the policy could store two plans whose periods overlap (D10). The window is one owner changing the policy at the instant someone creates a plan; accepted for v1 (controller ruling), follow-up 6 serializes it.

### Follow-ups

1. `GET /api/v1/spaces/{spaceId}/plans` (list a space's plans, e.g. for HU-E9-08); clients now keep the id from the creation response.
2. Amend spec 5.2 (Allocation) and the HU-E1-05 permission documentation as rulings P1 and P2 decide.
3. Move HU-E6-01 … HU-E6-05 to `Done` in `docs/backlog/README.md` when the pull request merges.
4. Serialize category deletion against concurrent mappings (assumption 9), if it ever matters: lock the category row in `DeleteCategory` and `MapCategoriesToLine`.
5. HU-E9-08 (planner screens) can show the D9 privacy of SAVINGS lines: members see "Savings into Ana's account", never its name or balance.
6. Serialize plan creation against period-policy changes (assumption 12): lock the space row (`SELECT … FROM spaces WHERE id = $1 FOR UPDATE`) in `CreateBudgetPlan` and `UpdateSpaceSettings`, or take a transaction advisory lock per space.

### Placeholder and consistency scan

- No "TBD", "TODO", "similar to Task N" or step without its code; every code step names its file and anchor, every test step its command and expected outcome.
- Names used across tasks match their definitions: `openPlan`, `checkedCapacities`, `capacityOf`, `totalCapacity`, `shareOfTotal` (Task 1); `newLine`, `reviseLine`, `checkedMapping`, `LineFields`, `LineContext`, `CategoryMapping` (Task 2); `checkedAllocation`, `assignedAmounts`, `AllocationInput`, `AllocationValue`, `LineAllocation` (Task 3); `planFigures`, `lineForCategory`, `PlanParts`, `PeriodSpending`, `PlanFigures`, `LineFigure` (Task 4); `BudgetPlanRepository`, `PlanContents` (Task 6), `PlanSpending`, `BudgetingDeps`, `BudgetPlanView`, `loadPlanView`, `readablePlan`, `managePlan`, `planForWrite`, `PlanWrite` (Task 8); `CapacityRepository`, `PreviousIncome`, `CapacityDeps`, `CapacitySuggestion` (Task 10); `BudgetLineRepository`, `SavingsAccountReader`, `BudgetAccount`, `LineDeps`, `LineInput`, `inSpaceCurrency`, `lineOf`, `lineContext`, `usableSavingsAccounts` (Task 12a); `LineChanges` (Task 12b); `CategoryMappingRepository`, `BudgetCategories`, `MappingDeps` (Task 15); `AllocationRepository`, `AllocationDeps` (Task 17).
- `Container.budgeting` keys: `createPlan`, `getPlan` (9b), `setCapacities`, `suggestCapacity` (11), `addLine`, `updateLine`, `removeLine` (14a), `mapCategories` (16), `allocateLine` (18); every route calls one of them.
- Test support: `aLine`, `referenceLines` (`budget-fixtures.ts`, Task 2); `InMemoryBudgetPlans` (Task 6; methods added in Tasks 10, 12a, 15, 17); `budgetingWorld`, `FixedSpending`, `BUDGET_MEMBERS`, `HOUSEHOLD`, `NOW` (Task 8), `fixedIncome` (10), `ACCOUNTS`, `savingsAccounts` (12a), `householdCategories` (15) in `budgeting-world.ts`; HTTP helpers in `budgeting.ts` (9b, 11, 14a, 14b, 16, 18).
- Error codes and statuses: `BudgetPlanNotFound`, `BudgetLineNotFound` (404 by suffix); `InvalidCapacity`, `InvalidBudgetLineName`, `InvalidPlannedAmount`, `InvalidSavingsAccount`, `InvalidAllocation` (422 by prefix); `SavingsAccountRequired`, `CategoryNotInSpace` (422, explicit); `PlanAlreadyExists`, `PlanExceedsCapacity`, `BudgetLineNameTaken`, `CatchAllLineAlreadySet`, `SavingsAccountAlreadyUsed`, `SavingsLineNotMappable`, `CategoryAlreadyMapped` (409); all pinned in `problem.test.ts` (Tasks 14a, 16) and listed in the OpenAPI problem descriptions and the E6 notes.
- Migrations: one, `0010_budgeting` (Task 5). OpenAPI component added: `BudgetPlan` (Task 9a, responses only).
