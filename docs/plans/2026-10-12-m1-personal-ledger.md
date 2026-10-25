# M1 Personal Ledger API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Hearth's personal ledger API: space settings with period policies, default and custom categories, accounts with computed balances, and personal expenses, incomes and transfers that can be listed by period, filtered, edited and soft-deleted with an audit trail.

**Architecture:** Three new hexagonal modules (`categories`, `accounts`, `ledger`) plus extensions to `spaces` and the shared kernel. Every use case authorizes through the `spaces` module's public `SpaceAccess` port; cross-module data needs (account and category lookups for the ledger, ledger movements for balances, ledger references for category deletion, money records for the currency lock, category seeding on space creation) are ports owned by the consuming module and bound in the composition root, so no two modules import each other. Periods are resolved in the kernel (policy + stored plan boundaries) and the ledger filters by the resolved date range in SQL.

**Tech Stack:** Node.js 24.21.0, pnpm 12.11.2, Next.js 16.4.0 (App Router route handlers), React 19.3.0, TypeScript 6.0.3 strict, Zod 4.6.5, zod-openapi 6.0.2, drizzle-orm 0.45.4 + drizzle-kit 0.31.11, pg 8.23.1, better-auth 1.7.7, Vitest 5.0.3, PostgreSQL 18.6 (Docker CLI in tests). No new dependencies.

**Spec:** `docs/specs/2026-10-11-hearth-design.md` (approved 2026-10-11). Stories: `docs/backlog/E1-identity-and-spaces.md` (HU-E1-03), `docs/backlog/E2-accounts.md` (HU-E2-01, HU-E2-03, HU-E2-04), `docs/backlog/E3-categories.md` (HU-E3-01 … HU-E3-03), `docs/backlog/E4-ledger.md` (HU-E4-01 … HU-E4-06). Format template: `docs/plans/2026-10-11-m0-walking-skeleton.md`. GitHub Project: https://github.com/users/Facabore/projects/4.

## Global Constraints

- Node.js `24.21.0`; pnpm `12.11.2`; Next.js `16.4.0`; React `19.3.0`; TypeScript `6.0.3` with `strict: true` and `noUncheckedIndexedAccess: true`; Zod `4.6.5`; zod-openapi `6.0.2`; drizzle-orm `0.45.4`; drizzle-kit `0.31.11`; pg `8.23.1`; better-auth `1.7.7`; Vitest `5.0.3`; PostgreSQL image `postgres:18.6-alpine`. No new dependencies; `pnpm check:pinned` must keep passing.
- Money is `bigint` minor units in code and `bigint` columns in PostgreSQL (D6); over HTTP it is `{ "amount": "<minor units as string>", "currency": "<ISO 4217>" }`, e.g. `{ "amount": "120000000", "currency": "COP" }`. Aggregates are read from PostgreSQL as text and summed as `bigint`; never `Number`.
- One currency per space in v1 (D6); accounts use their space's currency.
- Metrics (balances, totals) are computed on read with SQL aggregates, never stored (D7).
- Transactions are soft-deleted; audit fields on every write (D8): `createdBy`/`createdAt` on the row, an audit entry for every edit and delete.
- Periods are derived on read from the stored plan boundaries when a plan covers the date, otherwise from `date` and the space `periodPolicy` (D10, D14). Default policy `MONTHLY(1)`, default currency `COP`, default timezone `America/Bogota`.
- HTTP errors are RFC 9457 `application/problem+json` with a stable `code` (the domain error name) and `requestId`; the API never returns translated text. Status mapping lives only in `src/shared/http/problem.ts` (explicit map, then `*NotFound` → 404, `Invalid*` → 422, else 409). A requester who is not a member of a space gets `404 SpaceNotFound`.
- Authorization is always enforced in use cases (membership + role), never only in handlers.
- `Idempotency-Key` is honoured on every POST that creates a transaction (expenses, incomes, transfers); `If-Match`/`ETag` on transaction updates (stale → `412 PreconditionFailed`); cursor pagination `?cursor=&limit=`, default 50, max 200.
- Hexagonal boundaries (ADR 0001): domain imports only its own domain and `src/shared/kernel`; application never imports infrastructure, contracts, HTTP, frameworks or the ORM; other modules are reached only through `src/modules/<m>/application/index.ts`; `*.schema.ts` may import other modules' `*.schema.ts` for foreign keys.
- Strict TDD: every behaviour starts with a failing test that is run and seen failing. `@critical` scenarios run as acceptance tests (route handlers + real PostgreSQL); the rest as unit or integration tests.
- Code, identifiers, comments, docs and generated artifacts in English. Conventional commits referencing the story issue (`Refs #<n>`); no AI attribution or `Co-Authored-By` lines.
- Gates for every task: `pnpm exec vitest run --project unit`, `pnpm exec vitest run --project integration`, `pnpm exec vitest run --project acceptance`, `pnpm exec eslint .`, `pnpm exec tsc --noEmit`, `pnpm exec prettier --check .`, `pnpm lint:boundaries`, `pnpm db:check`.

## Review Focus

1. **Two edits of the same transaction from stale state** (two tabs, or a retry after a slow response): the second `PATCH` carrying the old `If-Match` must get `412 PreconditionFailed`, change nothing and write no audit entry — pinned in Task 18 (use case), Task 20 (repository compare-and-set) and Task 28 (HTTP).
2. **Many transactions on the same date** (a busy shopping day, an import): following `nextCursor` must visit every transaction exactly once, newest first, with no duplicates or gaps — pinned in Task 21 (120 transactions on one date, keyset on `(date, id)`).
3. **Period boundaries at month end and just after UTC midnight**: `MONTHLY(31)` clamps to February and is labelled by the following month (`2027-03` runs 2027-02-28 … 2027-03-30); a semi-monthly half that collapses in February is an unknown label (`422`, not `500`); "today" is taken in `America/Bogota`, so 2026-11-01T04:30Z is still 2026-10-31 — pinned in Task 1 (kernel), Task 2 (period listing default date) and Task 17 (listing by a clamped label).
4. **Malformed or foreign identifiers** in paths, bodies and cursors (`/spaces/not-a-uuid/...`, another user's space, a cursor with a non-UUID id): must answer `404 SpaceNotFound`/`TransactionNotFound`/`AccountNotFound` or `422`, never a `500` from a failed `uuid` cast and never leak another user's data — pinned in Task 3, Task 13 and Task 20 (repositories return null), Task 27 (`InvalidCursor`) and Task 26 (another user's space over HTTP).
5. **Money sums beyond the `bigint` range** (two incomes of 6,000,000,000,000,000,000 minor units into one account): balances and totals must stay exact and must not fail, because `SUM(bigint)` is `numeric` in PostgreSQL and is read as text into `bigint` — pinned in Task 21.

## Execution Workflow

- Work on the long-lived branch `development`; every task is implemented there with Strict TDD.
- **RDD before every commit** (receipt-driven development is on; check with `gentle-ai review mode status`). Each "Commit" step means:
  1. Run every source-mutating normalizer first (`pnpm format`, regenerated migrations or snapshots), then stage exactly the files of the task.
  2. Run `gentle-ai review status --cwd . --contract gentle-ai.review-integration/v2 --agent claude-code --next-transition` and follow only the returned `next_transition` (`execute` its operation, satisfy `collect` inputs, or stop on `stop` and report its reason code with its documented continuation). Medium/high-risk candidates may return a consent envelope; relay it to the owner and wait.
  3. Commit only after the provider-returned `review.validate` allows the `pre-commit` gate for that exact staged candidate; the commit must not change the reviewed bytes.
  4. If the owner disables RDD (`gentle-ai review mode disable --scope clone --cwd .`), commit under ordinary policy and report `disabled/unmanaged`.
- Code blocks in this plan are complete but not guaranteed to match Prettier's line wrapping: run `pnpm format` before the gates of every task (the gates then run `prettier --check`).
- Each task is one commit sized for review (target under ~400 changed lines). If a staged task grows past that, split it into two consecutive commits along its own boundaries, each green and each with its own RDD pass. The tasks closest to the limit and their split points: Task 10 (domain + domain test | application + doubles + use-case test), Task 15 (ports, deps, checks and the in-memory ledger with `index.ts` exporting types only | `record-expense.ts`, its test and its export), Task 22 (listener + shared OpenAPI helpers | contract, route, wiring, acceptance), Task 24 (shared HTTP additions | accounts contract, routes, wiring, acceptance), Task 26 (status map + `withIdempotency` | ledger contract, routes, wiring, acceptance). Generated Drizzle snapshots (`drizzle/meta/*_snapshot.json`) are committed in their own schema-only tasks (Tasks 8, 12, 19); the OpenAPI snapshot changes only in the HTTP tasks (22–29).
- When a task starts, move its story issues to **In Progress** on Project #4; when all tasks are done, open one pull request that closes #12, #23, #25, #26, #27, #28, #29, #30, #31, #32, #33, #34, #35.
- Task-to-issue map (issues are titled with their story ID): HU-E1-03 → #12, HU-E2-01 → #23, HU-E2-03 → #25, HU-E2-04 → #26, HU-E3-01 → #27, HU-E3-02 → #28, HU-E3-03 → #29, HU-E4-01 → #30, HU-E4-02 → #31, HU-E4-03 → #32, HU-E4-04 → #33, HU-E4-05 → #34, HU-E4-06 → #35.

## File Structure

```
.
├── drizzle/
│   ├── 0003_categories.sql (+ meta/0003_snapshot.json)   # Task 8
│   ├── 0004_accounts.sql   (+ meta/0004_snapshot.json)   # Task 12
│   └── 0005_ledger.sql     (+ meta/0005_snapshot.json)   # Task 19
├── openapi/openapi.snapshot.json                          # Tasks 22–29
├── src/
│   ├── shared/
│   │   ├── kernel/
│   │   │   ├── id.ts                    # + isUuid (Task 1)
│   │   │   └── period-resolution.ts     # resolvePeriod, listPeriods, periodByLabel (Task 1)
│   │   └── http/
│   │       ├── contracts.ts             # + optionalLocalDate (Task 24), PeriodSchema/periodDto (Task 25)
│   │       └── problem.ts               # + explicit statuses for M1 codes (Tasks 24, 26)
│   ├── composition/
│   │   ├── container.ts                 # wiring of every new use case (Tasks 22–29)
│   │   ├── openapi.ts                   # new paths and component schemas (Tasks 22–29)
│   │   └── route.ts                     # + withIdempotency (Task 26)
│   ├── modules/
│   │   ├── spaces/
│   │   │   ├── domain/space.ts                              # + spaceName, checkedPeriodPolicy (Task 2)
│   │   │   ├── application/space-settings-repository.ts     # SpaceMembership, SpaceSettings port (Task 2)
│   │   │   ├── application/space-access.ts                  # SpaceAccess, requireRole, MANAGERS, WRITERS (Task 2)
│   │   │   ├── application/{get-space,update-space-settings,list-space-periods}.ts  (Task 2)
│   │   │   ├── application/create-personal-space.ts         # + onCreated listener, locale (Task 22)
│   │   │   ├── infrastructure/drizzle-space-repository.ts   # + findMembership, updateSettings (Task 3)
│   │   │   └── contracts/spaces.contract.ts                 # + space, settings and periods operations (Task 25)
│   │   ├── categories/
│   │   │   ├── domain/{category,default-catalog}.ts         # Task 4
│   │   │   ├── application/*.ts                             # Tasks 5–7
│   │   │   ├── infrastructure/categories.schema.ts          # Task 8
│   │   │   ├── infrastructure/drizzle-category-repository.ts  # Task 9
│   │   │   └── contracts/categories.contract.ts             # Tasks 22, 23, 29
│   │   ├── accounts/
│   │   │   ├── domain/account.ts                            # Task 10
│   │   │   ├── application/*.ts                             # Tasks 10–11
│   │   │   ├── infrastructure/accounts.schema.ts            # Task 12
│   │   │   ├── infrastructure/drizzle-account-repository.ts # Task 13
│   │   │   └── contracts/accounts.contract.ts               # Task 24
│   │   └── ledger/
│   │       ├── domain/transaction.ts                        # Task 14
│   │       ├── application/*.ts                             # Tasks 15–18
│   │       ├── infrastructure/ledger.schema.ts              # Task 19
│   │       ├── infrastructure/{transaction-rows,drizzle-transaction-repository,drizzle-audit-log}.ts  # Task 20
│   │       ├── infrastructure/drizzle-ledger-queries.ts     # Task 21
│   │       └── contracts/ledger.contract.ts                 # Tasks 26–28
│   └── app/api/v1/spaces/[spaceId]/
│       ├── route.ts                                         # GET, PATCH (Task 25)
│       ├── periods/route.ts                                 # GET (Task 25)
│       ├── categories/route.ts, categories/[categoryId]/{route,archive/route,restore/route}.ts      # Tasks 22, 23, 29
│       ├── category-groups/route.ts, category-groups/[groupId]/{route,archive/route}.ts             # Tasks 23, 29
│       ├── accounts/route.ts, accounts/[accountId]/{route,archive/route}.ts                         # Task 24
│       ├── expenses/route.ts, incomes/route.ts, transfers/route.ts                                  # Task 26
│       └── transactions/route.ts, transactions/[transactionId]/{route,audit/route}.ts               # Tasks 27, 28
└── tests/
    ├── support/
    │   ├── fakes.ts                     # memoryTm, sequentialIds, unwrap, codeOf, money, membership, fakeSpaceAccess (Task 2)
    │   ├── in-memory-categories.ts      # Task 5
    │   ├── in-memory-accounts.ts        # Task 10 (+ FixedMovements, Task 11)
    │   ├── in-memory-ledger.ts          # Task 15 (+ builders, Task 17)
    │   ├── fixtures.ts                  # real-repository fixtures for integration tests (Tasks 9, 20)
    │   └── app.ts                       # + registerUser, routeParams (Task 22)
    └── acceptance/
        ├── categories.test.ts           # Tasks 22, 23, 29
        ├── accounts.test.ts             # Task 24
        ├── space-settings.test.ts       # Task 25
        └── ledger.test.ts               # Tasks 26–28
```

Test layout follows M0: unit tests next to the code as `*.test.ts` (no database), integration tests as `*.int.test.ts` (real PostgreSQL via `testDatabase()`), acceptance tests in `tests/acceptance/` calling the exported route handlers in-process. Shared test doubles live in `tests/support/` so production folders hold no test code.

Run a single file with `pnpm exec vitest run --project <unit|integration|acceptance> <path>`. Integration and acceptance projects start a disposable PostgreSQL container through the Docker CLI (`tests/support/postgres-global-setup.ts`) and apply every migration in `drizzle/`, so Docker must be running.

---

### Task 1: Kernel — resolve periods against stored boundaries and labels

Implements the period logic of HU-E1-03 (issue #12) and HU-E4-04 (issue #33): stored plan boundaries win, a derived period that overlaps one is clipped around it (backlog overlap rule), and a label such as `2026-11 H1` resolves to its dates. Plans arrive with HU-E6-01 (M3); until then the stored list is empty, but the rule is implemented and pinned now so periods never move when plans appear. Also adds `isUuid`, used by repositories before querying `uuid` columns with identifiers from URLs.

Decision: no SQL mirror of the period logic in M1. The ledger resolves the period in TypeScript and filters `date BETWEEN start AND end`; a SQL helper is only needed when M4 groups aggregates by period, and it will reuse these test tables.

**Files:**
- Create: `src/shared/kernel/period-resolution.ts`
- Modify: `src/shared/kernel/id.ts`, `src/shared/kernel/index.ts`
- Test: `src/shared/kernel/period-resolution.test.ts`, `src/shared/kernel/id.test.ts`

**Interfaces:**
- Consumes: `periodFor(policy, date): Period`, `Period { start; end; label }`, `PeriodPolicy`, `monthly`, `semiMonthly`, `LocalDate`, `localDate`, `addDays`, `addMonths`, `daysInMonth`, `fromParts`, `domainError`, `ok`, `err`, `Result` (existing kernel).
- Produces:
  - `type StoredPeriod = Period`
  - `resolvePeriod(policy: PeriodPolicy, stored: readonly StoredPeriod[], date: LocalDate): Period`
  - `listPeriods(policy: PeriodPolicy, stored: readonly StoredPeriod[], from: LocalDate, count: number): Period[]`
  - `periodByLabel(policy: PeriodPolicy, stored: readonly StoredPeriod[], label: string): Result<Period>` (`InvalidPeriodLabel`)
  - `isUuid(value: string): boolean`

- [ ] **Step 1: Write the failing tests**

`src/shared/kernel/period-resolution.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { localDate, type LocalDate } from "./local-date";
import { monthly, periodFor, semiMonthly, type PeriodPolicy } from "./period-policy";
import { listPeriods, periodByLabel, resolvePeriod, type StoredPeriod } from "./period-resolution";
import type { Result } from "./result";

const unwrap = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};
const d = (iso: string): LocalDate => unwrap(localDate(iso));
const M1 = unwrap(monthly(1));
const M25 = unwrap(monthly(25));
const M31 = unwrap(monthly(31));
const S1_16 = unwrap(semiMonthly(1, 16));
const S5_20 = unwrap(semiMonthly(5, 20));
const plan: StoredPeriod = { start: d("2026-11-01"), end: d("2026-11-30"), label: "2026-11" };

describe("resolvePeriod", () => {
  it("derives the period from the policy when nothing is stored", () => {
    expect(resolvePeriod(M25, [], d("2026-10-24"))).toEqual(periodFor(M25, d("2026-10-24")));
  });

  it("returns the stored period that covers the date", () => {
    expect(resolvePeriod(M25, [plan], d("2026-11-10"))).toEqual(plan);
  });

  it("starts an overlapping derived period the day after the stored one ends (HU-E1-03)", () => {
    expect(resolvePeriod(M25, [plan], d("2026-12-10"))).toEqual({
      start: "2026-12-01",
      end: "2026-12-24",
      label: "2026-12",
    });
  });

  it("ends an overlapping derived period the day before the stored one starts", () => {
    expect(resolvePeriod(M25, [plan], d("2026-10-28"))).toEqual({
      start: "2026-10-25",
      end: "2026-10-31",
      label: "2026-11",
    });
  });
});

describe("listPeriods", () => {
  it("keeps a planned period and follows the new policy after it (HU-E1-03)", () => {
    expect(listPeriods(M25, [plan], d("2026-11-01"), 3)).toEqual([
      plan,
      { start: "2026-12-01", end: "2026-12-24", label: "2026-12" },
      { start: "2026-12-25", end: "2027-01-24", label: "2027-01" },
    ]);
  });

  it("tiles SEMI_MONTHLY(5, 20) periods (HU-E1-03)", () => {
    expect(listPeriods(S5_20, [], d("2026-11-03"), 3)).toEqual([
      { start: "2026-10-20", end: "2026-11-04", label: "2026-10 H2" },
      { start: "2026-11-05", end: "2026-11-19", label: "2026-11 H1" },
      { start: "2026-11-20", end: "2026-12-04", label: "2026-11 H2" },
    ]);
  });
});

describe("periodByLabel", () => {
  it.each<[string, PeriodPolicy, string, string, string]>([
    ["MONTHLY(1)", M1, "2026-10", "2026-10-01", "2026-10-31"],
    ["MONTHLY(25)", M25, "2026-11", "2026-10-25", "2026-11-24"],
    ["SEMI_MONTHLY(1, 16)", S1_16, "2026-11 H1", "2026-11-01", "2026-11-15"],
    ["SEMI_MONTHLY(1, 16)", S1_16, "2026-11 H2", "2026-11-16", "2026-11-30"],
    ["MONTHLY(31)", M31, "2027-03", "2027-02-28", "2027-03-30"],
    ["MONTHLY(31)", M31, "2027-02", "2027-01-31", "2027-02-27"],
  ])("%s resolves %s to %s..%s", (_name, policy, label, start, end) => {
    expect(unwrap(periodByLabel(policy, [], label))).toEqual({ start, end, label });
  });

  it.each<[string, PeriodPolicy, string]>([
    ["a malformed label", M1, "October"],
    ["month 13", M1, "2026-13"],
    ["month 00", M1, "2026-00"],
    ["a half label for a monthly policy", M1, "2026-11 H1"],
    ["a monthly label for a semi-monthly policy", S1_16, "2026-11"],
    ["a half that collapses in February", unwrap(semiMonthly(29, 31)), "2027-02 H2"],
  ])("rejects %s with InvalidPeriodLabel", (_name, policy, label) => {
    const result = periodByLabel(policy, [], label);
    expect(!result.ok && result.error.code).toBe("InvalidPeriodLabel");
  });

  it("prefers a stored period with that label and clips derived periods around stored ones", () => {
    expect(unwrap(periodByLabel(M25, [plan], "2026-11"))).toEqual(plan);
    expect(unwrap(periodByLabel(M25, [plan], "2026-12"))).toEqual({
      start: "2026-12-01",
      end: "2026-12-24",
      label: "2026-12",
    });
  });

  it("rejects a derived label whose days are all inside stored periods", () => {
    const quarter: StoredPeriod = { start: d("2026-10-01"), end: d("2026-12-31"), label: "2026-Q4" };
    const result = periodByLabel(M1, [quarter], "2026-11");
    expect(!result.ok && result.error.code).toBe("InvalidPeriodLabel");
  });
});
```

`src/shared/kernel/id.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isUuid } from "./id";

describe("isUuid", () => {
  it("accepts canonical UUIDs in either case", () => {
    expect(isUuid("0199d3a4-8c1e-7b2a-9f3e-1a2b3c4d5e6f")).toBe(true);
    expect(isUuid("3F2504E0-4F89-11D3-9A0C-0305E82C3301")).toBe(true);
  });

  it.each([
    "",
    "not-a-uuid",
    "0199d3a4-8c1e-7b2a-9f3e-1a2b3c4d5e6",
    "0199d3a4-8c1e-7b2a-9f3e-1a2b3c4d5e6fa",
    "'; DROP TABLE spaces; --",
  ])("rejects %j", (value) => {
    expect(isUuid(value)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/shared/kernel/period-resolution.test.ts src/shared/kernel/id.test.ts`
Expected: FAIL — `Failed to resolve import "./period-resolution"` and `isUuid is not a function` (or "does not provide an export named 'isUuid'").

- [ ] **Step 3: Implement**

`src/shared/kernel/period-resolution.ts`:

```ts
import { domainError } from "./domain-error";
import { addDays, addMonths, daysInMonth, fromParts, type LocalDate } from "./local-date";
import { periodFor, type Period, type PeriodPolicy } from "./period-policy";
import { err, ok, type Result } from "./result";

/** A period whose boundaries were stored when its plan was created (spec D10). Stored periods never overlap. */
export type StoredPeriod = Period;

const covers = (period: Period, date: LocalDate): boolean => period.start <= date && date <= period.end;
const overlaps = (a: Period, b: Period): boolean => a.start <= b.end && b.start <= a.end;

/**
 * HU-E1-03 overlap rule: a derived period that overlaps stored periods shrinks to the gap around
 * `date` (it starts the day after an earlier stored period ends, or ends the day before a later
 * one starts) and keeps its natural label.
 */
const clip = (natural: Period, stored: readonly StoredPeriod[], date: LocalDate): Period => {
  let { start, end } = natural;
  for (const s of stored.filter((p) => overlaps(p, natural))) {
    if (s.end < date && addDays(s.end, 1) > start) start = addDays(s.end, 1);
    if (s.start > date && addDays(s.start, -1) < end) end = addDays(s.start, -1);
  }
  return { start, end, label: natural.label };
};

/** HU-E4-04: the stored period covering `date`, otherwise the policy period clipped around stored ones. */
export const resolvePeriod = (policy: PeriodPolicy, stored: readonly StoredPeriod[], date: LocalDate): Period =>
  stored.find((s) => covers(s, date)) ?? clip(periodFor(policy, date), stored, date);

/** `count` consecutive periods, starting with the one that contains `from`. */
export const listPeriods = (
  policy: PeriodPolicy,
  stored: readonly StoredPeriod[],
  from: LocalDate,
  count: number,
): Period[] => {
  const periods: Period[] = [];
  let date = from;
  while (periods.length < count) {
    const period = resolvePeriod(policy, stored, date);
    periods.push(period);
    date = addDays(period.end, 1);
  }
  return periods;
};

const LABEL = /^(\d{4})-(\d{2})(?: (H1|H2))?$/;
const invalidLabel = (label: string) => err(domainError("InvalidPeriodLabel", { label }));

/** The date on which the period named `label` would start under `policy` (spec 5.3 naming rules). */
const startOf = (policy: PeriodPolicy, year: number, month: number, half: string | undefined): LocalDate => {
  // MONTHLY with an anchor after the 15th is named after the following month, so it starts a month earlier.
  const at = policy.kind === "MONTHLY" && policy.day > 15 ? addMonths(year, month, -1) : { year, month };
  const day = policy.kind === "MONTHLY" ? policy.day : half === "H1" ? policy.day1 : policy.day2;
  return fromParts(at.year, at.month, Math.min(day, daysInMonth(at.year, at.month)));
};

/** HU-E4-04: resolves `2026-10` (monthly) or `2026-11 H1` (semi-monthly) to its dates. */
export const periodByLabel = (
  policy: PeriodPolicy,
  stored: readonly StoredPeriod[],
  label: string,
): Result<Period> => {
  const storedPeriod = stored.find((s) => s.label === label);
  if (storedPeriod) return ok(storedPeriod);
  const match = label.match(LABEL);
  if (!match) return invalidLabel(label);
  const [, year, month, half] = match;
  const monthNumber = Number(month);
  if (monthNumber < 1 || monthNumber > 12) return invalidLabel(label);
  if ((policy.kind === "SEMI_MONTHLY") !== (half !== undefined)) return invalidLabel(label);
  const natural = periodFor(policy, startOf(policy, Number(year), monthNumber, half));
  // Clamped anchors can collapse (SEMI_MONTHLY(29, 31) has no February H2): the label must round-trip.
  if (natural.label !== label) return invalidLabel(label);
  for (let date = natural.start; date <= natural.end; date = addDays(date, 1)) {
    if (!stored.some((s) => covers(s, date))) return ok(clip(natural, stored, date));
  }
  return invalidLabel(label);
};
```

Append to `src/shared/kernel/id.ts`:

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Canonical textual UUID; repositories check identifiers from URLs before querying `uuid` columns. */
export const isUuid = (value: string): boolean => UUID.test(value);
```

In `src/shared/kernel/index.ts`, add after `export * from "./period-policy";`:

```ts
export * from "./period-resolution";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/shared/kernel`
Expected: PASS (all kernel files, including the existing `period-policy.test.ts`).

- [ ] **Step 5: Gates**

Run: `pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0 (`kernel-must-be-pure` holds: the new file imports only kernel files).

- [ ] **Step 6: Commit**

```bash
git add src/shared/kernel/period-resolution.ts src/shared/kernel/period-resolution.test.ts src/shared/kernel/id.ts src/shared/kernel/id.test.ts src/shared/kernel/index.ts
git commit -m "feat(kernel): resolve periods by label and around stored plan boundaries (Refs #12, Refs #33)"
```

---

### Task 2: Spaces — membership access, settings and period listing use cases

Implements the application layer of HU-E1-03 (issue #12) and the `SpaceAccess` port every later module uses for authorization (spec 8: non-members get `SpaceNotFound`).

Decisions:
- `SpaceAccess` is a function exported by `spaces/application/index.ts`; other modules' application layers may import it (ADR 0001), and `spaces` imports none of them, so there is no cycle.
- The currency lock (`SpaceCurrencyLocked`) applies once the space holds **any account or transaction**: accounts carry no currency of their own (they use the space currency, D6), so switching currency under existing opening balances would silently reinterpret them. This is a superset of the story's "once transactions exist".
- The wire format of `periodPolicy` accepts any integer days so `MONTHLY(0)` reaches the domain and fails with `InvalidPeriodPolicy` (the story's code), not `ValidationFailed`; `checkedPeriodPolicy` re-validates.
- `StoredPeriodSource` is the port to stored plan boundaries; the composition root binds it to an empty list until budgeting plans exist (HU-E6-01).
- The new repository methods live in a separate port (`SpaceSettingsRepository`) so `DrizzleSpaceRepository` keeps compiling until Task 3 implements them.

**Files:**
- Modify: `src/modules/spaces/domain/space.ts`, `src/modules/spaces/domain/space.test.ts`, `src/modules/spaces/application/index.ts`
- Create: `src/modules/spaces/application/space-settings-repository.ts`, `space-access.ts`, `get-space.ts`, `update-space-settings.ts`, `list-space-periods.ts` (all in `src/modules/spaces/application/`)
- Create: `tests/support/fakes.ts`
- Test: `src/modules/spaces/application/space-settings.test.ts`

**Interfaces:**
- Consumes: `Space`, `SpaceId`, `SpaceKind`, `SpaceMemberId`, `SpaceRole`, `SpaceSummary` (M0 spaces); `listPeriods`, `StoredPeriod`, `Period`, `monthly`, `semiMonthly`, `currencyOf`, `todayIn`, `Clock`, `FixedClock`, `TransactionManager`, `Money` (kernel).
- Produces:
  - `spaceName(raw: string): Result<string>` (`InvalidSpaceName`), `checkedPeriodPolicy(policy: PeriodPolicy): Result<PeriodPolicy>` (`InvalidPeriodPolicy`)
  - `interface SpaceMembership { spaceId: SpaceId; name: string; spaceKind: SpaceKind; currency: string; periodPolicy: PeriodPolicy; memberId: SpaceMemberId; userId: string; role: SpaceRole | null }`
  - `interface SpaceSettings { name: string; currency: string; periodPolicy: PeriodPolicy }`
  - `interface SpaceSettingsRepository { findMembership(spaceId: string, userId: string): Promise<SpaceMembership | null>; updateSettings(spaceId: SpaceId, settings: SpaceSettings): Promise<void> }`
  - `type SpaceAccess = (spaceId: string, userId: string) => Promise<Result<SpaceMembership>>` (`SpaceNotFound`); `createSpaceAccess(spaces: Pick<SpaceSettingsRepository, "findMembership">): SpaceAccess`
  - `requireRole(membership: SpaceMembership, roles: readonly SpaceRole[]): Result<SpaceMembership>` (`InsufficientRole`); `MANAGERS = ["OWNER", "ADMIN"]`; `WRITERS = ["OWNER", "ADMIN", "MEMBER"]`; `toSpaceSummary(m: SpaceMembership): SpaceSummary`
  - `createGetSpace(access)` → `GetSpace = (input: { spaceId: string; userId: string }) => Promise<Result<SpaceSummary>>`
  - `interface SpaceUsage { hasMoneyRecords(spaceId: string): Promise<boolean> }`; `createUpdateSpaceSettings(deps: { spaces: SpaceSettingsRepository; access: SpaceAccess; usage: SpaceUsage; tm: TransactionManager })` → `UpdateSpaceSettings = (input: { spaceId: string; userId: string; changes: { name?: string; currency?: string; periodPolicy?: PeriodPolicy } }) => Promise<Result<SpaceSummary>>` (`InsufficientRole`, `InvalidSpaceName`, `InvalidPeriodPolicy`, `UnknownCurrency`, `SpaceCurrencyLocked`)
  - `type StoredPeriodSource = (spaceId: string) => Promise<readonly StoredPeriod[]>`; `createListSpacePeriods(deps: { access; storedPeriods; clock; timeZone: string })` → `ListSpacePeriods = (input: { spaceId: string; userId: string; from?: LocalDate; count: number }) => Promise<Result<Period[]>>`
  - `tests/support/fakes.ts`: `memoryTm`, `sequentialIds(prefix?)`, `unwrap(result)`, `codeOf(result)`, `money(minor, currency?)`, `membership(overrides?)`, `fakeSpaceAccess(...memberships)`, `noStoredPeriods`

- [ ] **Step 1: Write the shared test doubles**

`tests/support/fakes.ts`:

```ts
import type { SpaceAccess, SpaceMembership, StoredPeriodSource } from "@/modules/spaces/application";
import {
  domainError,
  err,
  Money,
  ok,
  type Id,
  type IdGenerator,
  type Result,
  type TransactionManager,
} from "@/shared/kernel";

/** Runs work directly: in-memory adapters have nothing to roll back. */
export const memoryTm: TransactionManager = { run: (work) => work() };

/** Deterministic ids: `${prefix}-1`, `${prefix}-2`, … */
export const sequentialIds = (prefix = "id"): IdGenerator => {
  let n = 0;
  return { next: <B extends string>() => `${prefix}-${++n}` as Id<B> };
};

export const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
  return result.value;
};

/** "ok" or the error code, so assertions read `expect(codeOf(result)).toBe("InvalidAmount")`. */
export const codeOf = (result: Result<unknown>): string => (result.ok ? "ok" : result.error.code);

export const money = (minor: bigint, currency = "COP"): Money => unwrap(Money.ofMinor(minor, currency));

type MembershipOverrides = Omit<Partial<SpaceMembership>, "spaceId" | "memberId"> & {
  spaceId?: string;
  memberId?: string;
};

/** Ana as OWNER of her personal space unless overridden. */
export const membership = (overrides: MembershipOverrides = {}): SpaceMembership => {
  const { spaceId = "space-ana", memberId = "member-ana", ...rest } = overrides;
  return {
    name: "Personal",
    spaceKind: "PERSONAL",
    currency: "COP",
    periodPolicy: { kind: "MONTHLY", day: 1 },
    userId: "u-ana",
    role: "OWNER",
    ...rest,
    spaceId: spaceId as SpaceMembership["spaceId"],
    memberId: memberId as SpaceMembership["memberId"],
  };
};

/** SpaceAccess over a fixed list of memberships; anything else is SpaceNotFound. */
export const fakeSpaceAccess =
  (...memberships: SpaceMembership[]): SpaceAccess =>
  async (spaceId, userId) => {
    const found = memberships.find((m) => m.spaceId === spaceId && m.userId === userId);
    return found ? ok(found) : err(domainError("SpaceNotFound"));
  };

export const noStoredPeriods: StoredPeriodSource = async () => [];
```

- [ ] **Step 2: Write the failing domain and use-case tests**

In `src/modules/spaces/domain/space.test.ts`, change the import of `./space` to:

```ts
import { checkedPeriodPolicy, createPersonalSpace, ensureCanAddMember, spaceName } from "./space";
```

and append:

```ts
describe("space settings rules (HU-E1-03)", () => {
  it("trims names and rejects blank or overlong ones", () => {
    expect(spaceName("  Casa  ")).toEqual({ ok: true, value: "Casa" });
    for (const bad of ["   ", "x".repeat(81)]) {
      const result = spaceName(bad);
      expect(!result.ok && result.error.code).toBe("InvalidSpaceName");
    }
  });

  it.each([
    { kind: "MONTHLY", day: 0 },
    { kind: "MONTHLY", day: 32 },
    { kind: "SEMI_MONTHLY", day1: 20, day2: 5 },
  ] as const)("rejects the period policy %o", (policy) => {
    const result = checkedPeriodPolicy(policy);
    expect(!result.ok && result.error.code).toBe("InvalidPeriodPolicy");
  });

  it("accepts valid policies unchanged", () => {
    expect(checkedPeriodPolicy({ kind: "SEMI_MONTHLY", day1: 5, day2: 20 })).toEqual({
      ok: true,
      value: { kind: "SEMI_MONTHLY", day1: 5, day2: 20 },
    });
  });
});
```

`src/modules/spaces/application/space-settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock, type LocalDate, type PeriodPolicy, type StoredPeriod } from "@/shared/kernel";
import { codeOf, memoryTm, membership, noStoredPeriods, unwrap } from "../../../../tests/support/fakes";
import type { SpaceId } from "../domain/space";
import { createGetSpace } from "./get-space";
import { createListSpacePeriods, type StoredPeriodSource } from "./list-space-periods";
import { createSpaceAccess } from "./space-access";
import type { SpaceMembership, SpaceSettings, SpaceSettingsRepository } from "./space-settings-repository";
import { createUpdateSpaceSettings } from "./update-space-settings";

class InMemorySettings implements SpaceSettingsRepository {
  constructor(public rows: SpaceMembership[]) {}
  async findMembership(spaceId: string, userId: string) {
    return this.rows.find((m) => m.spaceId === spaceId && m.userId === userId) ?? null;
  }
  async updateSettings(spaceId: SpaceId, settings: SpaceSettings) {
    this.rows = this.rows.map((m) => (m.spaceId === spaceId ? { ...m, ...settings } : m));
  }
}

const ana = membership({ spaceId: "space-household", name: "Household", spaceKind: "SHARED" });
const juan = membership({ ...ana, memberId: "member-juan", userId: "u-juan", role: "MEMBER" });
const asAna = { spaceId: "space-household", userId: "u-ana" };
const d = (iso: string) => iso as LocalDate;

const setup = (options: { hasMoneyRecords?: boolean; storedPeriods?: StoredPeriodSource; now?: string } = {}) => {
  const spaces = new InMemorySettings([ana, juan]);
  const access = createSpaceAccess(spaces);
  return {
    spaces,
    get: createGetSpace(access),
    update: createUpdateSpaceSettings({
      spaces,
      access,
      usage: { hasMoneyRecords: async () => options.hasMoneyRecords ?? false },
      tm: memoryTm,
    }),
    periods: createListSpacePeriods({
      access,
      storedPeriods: options.storedPeriods ?? noStoredPeriods,
      clock: new FixedClock(new Date(options.now ?? "2026-10-28T15:00:00Z")),
      timeZone: "America/Bogota",
    }),
  };
};

describe("UpdateSpaceSettings (HU-E1-03)", () => {
  it("switches to a monthly cut-off on the 25th", async () => {
    const { update, periods } = setup();
    const updated = unwrap(await update({ ...asAna, changes: { periodPolicy: { kind: "MONTHLY", day: 25 } } }));
    expect(updated.periodPolicy).toEqual({ kind: "MONTHLY", day: 25 });
    expect(unwrap(await periods({ ...asAna, from: d("2026-10-24"), count: 1 }))).toEqual([
      { start: "2026-09-25", end: "2026-10-24", label: "2026-10" },
    ]);
  });

  it("switches to semi-monthly periods on the 5th and 20th", async () => {
    const { update, periods } = setup();
    unwrap(await update({ ...asAna, changes: { periodPolicy: { kind: "SEMI_MONTHLY", day1: 5, day2: 20 } } }));
    expect(unwrap(await periods({ ...asAna, from: d("2026-11-03"), count: 1 }))).toEqual([
      { start: "2026-10-20", end: "2026-11-04", label: "2026-10 H2" },
    ]);
    expect(unwrap(await periods({ ...asAna, from: d("2026-11-25"), count: 1 }))).toEqual([
      { start: "2026-11-20", end: "2026-12-04", label: "2026-11 H2" },
    ]);
  });

  it.each<PeriodPolicy>([
    { kind: "MONTHLY", day: 0 },
    { kind: "MONTHLY", day: 32 },
    { kind: "SEMI_MONTHLY", day1: 20, day2: 5 },
  ])("rejects %o with InvalidPeriodPolicy and keeps MONTHLY(1)", async (periodPolicy) => {
    const { update, spaces } = setup();
    expect(codeOf(await update({ ...asAna, changes: { periodPolicy } }))).toBe("InvalidPeriodPolicy");
    expect(spaces.rows[0]?.periodPolicy).toEqual({ kind: "MONTHLY", day: 1 });
  });

  it("does not move a period that already has a plan", async () => {
    const plan: StoredPeriod = { start: d("2026-11-01"), end: d("2026-11-30"), label: "2026-11" };
    const { update, periods } = setup({ storedPeriods: async () => [plan] });
    unwrap(await update({ ...asAna, changes: { periodPolicy: { kind: "MONTHLY", day: 25 } } }));
    expect(unwrap(await periods({ ...asAna, from: d("2026-11-01"), count: 3 }))).toEqual([
      plan,
      { start: "2026-12-01", end: "2026-12-24", label: "2026-12" },
      { start: "2026-12-25", end: "2027-01-24", label: "2027-01" },
    ]);
  });

  it("forbids members without admin rights", async () => {
    const { update } = setup();
    const result = await update({ spaceId: "space-household", userId: "u-juan", changes: { name: "Casa" } });
    expect(codeOf(result)).toBe("InsufficientRole");
  });

  it("locks the currency once the space holds money records", async () => {
    const { update } = setup({ hasMoneyRecords: true });
    expect(codeOf(await update({ ...asAna, changes: { currency: "USD" } }))).toBe("SpaceCurrencyLocked");
    expect(codeOf(await update({ ...asAna, changes: { currency: "COP", name: "Casa" } }))).toBe("ok");
  });

  it("changes name and currency of a space without money records", async () => {
    const { update, get } = setup();
    unwrap(await update({ ...asAna, changes: { name: "  Casa ", currency: "USD" } }));
    expect(unwrap(await get(asAna))).toEqual({
      id: "space-household",
      name: "Casa",
      kind: "SHARED",
      currency: "USD",
      periodPolicy: { kind: "MONTHLY", day: 1 },
      role: "OWNER",
    });
  });

  it("rejects blank names and unknown currencies", async () => {
    const { update } = setup();
    expect(codeOf(await update({ ...asAna, changes: { name: "   " } }))).toBe("InvalidSpaceName");
    expect(codeOf(await update({ ...asAna, changes: { currency: "XYZ" } }))).toBe("UnknownCurrency");
  });

  it("hides spaces the user does not belong to", async () => {
    const { update, get } = setup();
    const asLuis = { spaceId: "space-household", userId: "u-luis" };
    expect(codeOf(await update({ ...asLuis, changes: { name: "Casa" } }))).toBe("SpaceNotFound");
    expect(codeOf(await get(asLuis))).toBe("SpaceNotFound");
  });
});

describe("ListSpacePeriods", () => {
  it("starts from today in the space time zone, even just after UTC midnight", async () => {
    const { periods } = setup({ now: "2026-11-01T04:30:00Z" });
    expect(unwrap(await periods({ ...asAna, count: 2 }))).toEqual([
      { start: "2026-10-01", end: "2026-10-31", label: "2026-10" },
      { start: "2026-11-01", end: "2026-11-30", label: "2026-11" },
    ]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/spaces`
Expected: FAIL — `spaceName is not a function` / `checkedPeriodPolicy is not a function` in `space.test.ts`, and `Failed to resolve import "./get-space"` in `space-settings.test.ts`.

- [ ] **Step 4: Implement the domain rules**

In `src/modules/spaces/domain/space.ts`, replace the kernel import with:

```ts
import {
  DEFAULT_PERIOD_POLICY,
  domainError,
  err,
  monthly,
  ok,
  semiMonthly,
  type Id,
  type PeriodPolicy,
  type Result,
} from "@/shared/kernel";
```

and append:

```ts
const MAX_SPACE_NAME = 80;

/** HU-E1-03: space names are trimmed and 1–80 characters long. */
export const spaceName = (raw: string): Result<string> => {
  const name = raw.trim();
  return name.length >= 1 && name.length <= MAX_SPACE_NAME
    ? ok(name)
    : err(domainError("InvalidSpaceName", { length: name.length }));
};

/** Re-checks a policy that arrived from outside: the wire format accepts any integer days. */
export const checkedPeriodPolicy = (policy: PeriodPolicy): Result<PeriodPolicy> =>
  policy.kind === "MONTHLY" ? monthly(policy.day) : semiMonthly(policy.day1, policy.day2);
```

- [ ] **Step 5: Implement the application layer**

`src/modules/spaces/application/space-settings-repository.ts`:

```ts
import type { PeriodPolicy } from "@/shared/kernel";
import type { SpaceId, SpaceKind, SpaceMemberId, SpaceRole } from "../domain/space";

/** The acting user's view of one space they currently belong to; other modules authorize with it. */
export interface SpaceMembership {
  readonly spaceId: SpaceId;
  readonly name: string;
  readonly spaceKind: SpaceKind;
  readonly currency: string;
  readonly periodPolicy: PeriodPolicy;
  readonly memberId: SpaceMemberId;
  readonly userId: string;
  readonly role: SpaceRole | null;
}

export interface SpaceSettings {
  readonly name: string;
  readonly currency: string;
  readonly periodPolicy: PeriodPolicy;
}

export interface SpaceSettingsRepository {
  /** Null when the id is malformed, the space is unknown or archived, or the user is not a current member. */
  findMembership(spaceId: string, userId: string): Promise<SpaceMembership | null>;
  updateSettings(spaceId: SpaceId, settings: SpaceSettings): Promise<void>;
}
```

`src/modules/spaces/application/space-access.ts`:

```ts
import { domainError, err, ok, type Result } from "@/shared/kernel";
import type { SpaceRole } from "../domain/space";
import type { SpaceSummary } from "./space-repository";
import type { SpaceMembership, SpaceSettingsRepository } from "./space-settings-repository";

/** Resolves the acting user's membership; non-members get SpaceNotFound so existence never leaks (spec 8). */
export type SpaceAccess = (spaceId: string, userId: string) => Promise<Result<SpaceMembership>>;

export const createSpaceAccess =
  (spaces: Pick<SpaceSettingsRepository, "findMembership">): SpaceAccess =>
  async (spaceId, userId) => {
    const membership = await spaces.findMembership(spaceId, userId);
    return membership ? ok(membership) : err(domainError("SpaceNotFound"));
  };

/** Roles that manage a space's settings and catalog (HU-E1-03, HU-E3-02). */
export const MANAGERS: readonly SpaceRole[] = ["OWNER", "ADMIN"];
/** Roles that record money movements; VIEWER only reads. */
export const WRITERS: readonly SpaceRole[] = ["OWNER", "ADMIN", "MEMBER"];

export const requireRole = (
  membership: SpaceMembership,
  roles: readonly SpaceRole[],
): Result<SpaceMembership> =>
  membership.role !== null && roles.includes(membership.role)
    ? ok(membership)
    : err(domainError("InsufficientRole"));

export const toSpaceSummary = (m: SpaceMembership): SpaceSummary => ({
  id: m.spaceId,
  name: m.name,
  kind: m.spaceKind,
  currency: m.currency,
  periodPolicy: m.periodPolicy,
  role: m.role,
});
```

`src/modules/spaces/application/get-space.ts`:

```ts
import { map, type Result } from "@/shared/kernel";
import { toSpaceSummary, type SpaceAccess } from "./space-access";
import type { SpaceSummary } from "./space-repository";

export type GetSpace = (input: { spaceId: string; userId: string }) => Promise<Result<SpaceSummary>>;

export const createGetSpace =
  (access: SpaceAccess): GetSpace =>
  async ({ spaceId, userId }) =>
    map(await access(spaceId, userId), toSpaceSummary);
```

`src/modules/spaces/application/update-space-settings.ts`:

```ts
import {
  currencyOf,
  domainError,
  err,
  ok,
  type PeriodPolicy,
  type Result,
  type TransactionManager,
} from "@/shared/kernel";
import { checkedPeriodPolicy, spaceName } from "../domain/space";
import { MANAGERS, requireRole, toSpaceSummary, type SpaceAccess } from "./space-access";
import type { SpaceSummary } from "./space-repository";
import type { SpaceSettingsRepository } from "./space-settings-repository";

/** Whether a space already holds accounts or transactions; bound by the composition root. */
export interface SpaceUsage {
  hasMoneyRecords(spaceId: string): Promise<boolean>;
}

export interface UpdateSpaceSettingsDeps {
  readonly spaces: SpaceSettingsRepository;
  readonly access: SpaceAccess;
  readonly usage: SpaceUsage;
  readonly tm: TransactionManager;
}

export interface SpaceSettingsChanges {
  readonly name?: string;
  readonly currency?: string;
  readonly periodPolicy?: PeriodPolicy;
}

export type UpdateSpaceSettings = (input: {
  spaceId: string;
  userId: string;
  changes: SpaceSettingsChanges;
}) => Promise<Result<SpaceSummary>>;

export const createUpdateSpaceSettings =
  (deps: UpdateSpaceSettingsDeps): UpdateSpaceSettings =>
  (input) =>
    deps.tm.run(async () => {
      const membership = await deps.access(input.spaceId, input.userId);
      if (!membership.ok) return membership;
      const allowed = requireRole(membership.value, MANAGERS);
      if (!allowed.ok) return allowed;
      const current = allowed.value;
      const { changes } = input;
      const name = changes.name === undefined ? ok(current.name) : spaceName(changes.name);
      if (!name.ok) return name;
      const periodPolicy =
        changes.periodPolicy === undefined ? ok(current.periodPolicy) : checkedPeriodPolicy(changes.periodPolicy);
      if (!periodPolicy.ok) return periodPolicy;
      const currency = currencyOf(changes.currency ?? current.currency);
      if (!currency.ok) return currency;
      // D6, HU-E1-03: one currency per space, fixed once money has been recorded in it.
      if (currency.value.code !== current.currency && (await deps.usage.hasMoneyRecords(current.spaceId))) {
        return err(domainError("SpaceCurrencyLocked"));
      }
      const settings = { name: name.value, currency: currency.value.code, periodPolicy: periodPolicy.value };
      // D10: plan boundaries are stored, so a new policy only affects periods without a plan.
      await deps.spaces.updateSettings(current.spaceId, settings);
      return ok(toSpaceSummary({ ...current, ...settings }));
    });
```

`src/modules/spaces/application/list-space-periods.ts`:

```ts
import {
  listPeriods,
  ok,
  todayIn,
  type Clock,
  type LocalDate,
  type Period,
  type Result,
  type StoredPeriod,
} from "@/shared/kernel";
import type { SpaceAccess } from "./space-access";

/** Stored plan boundaries of a space (budgeting, HU-E6-01); empty until plans exist. */
export type StoredPeriodSource = (spaceId: string) => Promise<readonly StoredPeriod[]>;

export interface ListSpacePeriodsDeps {
  readonly access: SpaceAccess;
  readonly storedPeriods: StoredPeriodSource;
  readonly clock: Clock;
  /** The space timezone; v1 uses the deployment timezone (APP_TIMEZONE). */
  readonly timeZone: string;
}

export type ListSpacePeriods = (input: {
  spaceId: string;
  userId: string;
  from?: LocalDate;
  count: number;
}) => Promise<Result<Period[]>>;

export const createListSpacePeriods =
  (deps: ListSpacePeriodsDeps): ListSpacePeriods =>
  async (input) => {
    const membership = await deps.access(input.spaceId, input.userId);
    if (!membership.ok) return membership;
    const from = input.from ?? todayIn(deps.clock, deps.timeZone);
    const stored = await deps.storedPeriods(membership.value.spaceId);
    return ok(listPeriods(membership.value.periodPolicy, stored, from, input.count));
  };
```

Replace `src/modules/spaces/application/index.ts` with:

```ts
export type { Space, SpaceId, SpaceKind, SpaceMemberId, SpaceRole } from "../domain/space";
export { ensureCanAddMember } from "../domain/space";
export { createCreatePersonalSpace, type CreatePersonalSpace } from "./create-personal-space";
export { createGetSpace, type GetSpace } from "./get-space";
export { createListMySpaces, type ListMySpaces } from "./list-my-spaces";
export {
  createListSpacePeriods,
  type ListSpacePeriods,
  type StoredPeriodSource,
} from "./list-space-periods";
export {
  createSpaceAccess,
  MANAGERS,
  requireRole,
  toSpaceSummary,
  WRITERS,
  type SpaceAccess,
} from "./space-access";
export type { SpaceRepository, SpaceSummary } from "./space-repository";
export type { SpaceMembership, SpaceSettings, SpaceSettingsRepository } from "./space-settings-repository";
export {
  createUpdateSpaceSettings,
  type SpaceSettingsChanges,
  type SpaceUsage,
  type UpdateSpaceSettings,
} from "./update-space-settings";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/spaces`
Expected: PASS (`space.test.ts`, `create-personal-space.test.ts`, `space-settings.test.ts`).

- [ ] **Step 7: Gates**

Run: `pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/modules/spaces/domain src/modules/spaces/application tests/support/fakes.ts
git commit -m "feat(spaces): add membership access, space settings and period listing use cases (Refs #12)"
```

---

### Task 3: Spaces — persist memberships and settings

Implements the `SpaceSettingsRepository` port of Task 2 in the existing Drizzle repository (HU-E1-03, issue #12). No schema change: `spaces` already stores name, currency and period policy. Pins Review Focus 4 at the repository: a malformed space id returns null instead of failing the `uuid` cast.

**Files:**
- Modify: `src/modules/spaces/infrastructure/drizzle-space-repository.ts`
- Test: `src/modules/spaces/infrastructure/drizzle-space-repository.int.test.ts`

**Interfaces:**
- Consumes: `SpaceSettingsRepository`, `SpaceMembership`, `SpaceSettings` (Task 2); `isUuid` (Task 1); `spaces`, `spaceMembers` tables (M0).
- Produces: `DrizzleSpaceRepository implements SpaceRepository, SpaceSettingsRepository` with `findMembership(spaceId, userId)` and `updateSettings(spaceId, settings)`.

- [ ] **Step 1: Write the failing integration tests**

Append to `src/modules/spaces/infrastructure/drizzle-space-repository.int.test.ts`:

```ts
describe("DrizzleSpaceRepository memberships and settings (HU-E1-03)", () => {
  it("finds the owner's membership with the space settings", async () => {
    const userId = await newUser();
    const space = personal(userId);
    await repo.add(space);
    expect(await repo.findMembership(space.id, userId)).toEqual({
      spaceId: space.id,
      name: "Personal",
      spaceKind: "PERSONAL",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
      memberId: space.members[0]!.id,
      userId,
      role: "OWNER",
    });
  });

  it("finds nothing for another user, a malformed id or an archived space", async () => {
    const userId = await newUser();
    const other = await newUser();
    const space = personal(userId);
    await repo.add(space);
    expect(await repo.findMembership(space.id, other)).toBeNull();
    expect(await repo.findMembership("not-a-uuid", userId)).toBeNull();
    await pool.query("UPDATE spaces SET archived_at = now() WHERE id = $1", [space.id]);
    expect(await repo.findMembership(space.id, userId)).toBeNull();
  });

  it("updates name, currency and period policy", async () => {
    const userId = await newUser();
    const space = personal(userId);
    await repo.add(space);
    await repo.updateSettings(space.id, {
      name: "Casa",
      currency: "USD",
      periodPolicy: { kind: "SEMI_MONTHLY", day1: 5, day2: 20 },
    });
    expect(await repo.findMembership(space.id, userId)).toMatchObject({
      name: "Casa",
      currency: "USD",
      periodPolicy: { kind: "SEMI_MONTHLY", day1: 5, day2: 20 },
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project integration src/modules/spaces`
Expected: FAIL — `repo.findMembership is not a function`.

- [ ] **Step 3: Implement**

In `src/modules/spaces/infrastructure/drizzle-space-repository.ts`, replace the imports and class header with:

```ts
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid } from "@/shared/kernel";
import type { SpaceRepository, SpaceSummary } from "../application/space-repository";
import type {
  SpaceMembership,
  SpaceSettings,
  SpaceSettingsRepository,
} from "../application/space-settings-repository";
import type { Space, SpaceId, SpaceMemberId } from "../domain/space";
import { spaceMembers, spaces } from "./spaces.schema";

export class DrizzleSpaceRepository implements SpaceRepository, SpaceSettingsRepository {
```

and add these methods inside the class, after `listForUser`:

```ts
  async findMembership(spaceId: string, userId: string): Promise<SpaceMembership | null> {
    // Ids come from URLs; anything that is not a UUID would fail the uuid cast.
    if (!isUuid(spaceId)) return null;
    const [row] = await this.tm
      .executor()
      .select({
        spaceId: spaces.id,
        name: spaces.name,
        spaceKind: spaces.kind,
        currency: spaces.currency,
        periodPolicy: spaces.periodPolicy,
        memberId: spaceMembers.id,
        role: spaceMembers.role,
      })
      .from(spaces)
      .innerJoin(spaceMembers, eq(spaceMembers.spaceId, spaces.id))
      .where(
        and(
          eq(spaces.id, spaceId),
          eq(spaceMembers.userId, userId),
          isNull(spaceMembers.leftAt),
          isNull(spaces.archivedAt),
        ),
      )
      .limit(1);
    return row
      ? { ...row, spaceId: row.spaceId as SpaceId, memberId: row.memberId as SpaceMemberId, userId }
      : null;
  }

  async updateSettings(spaceId: SpaceId, settings: SpaceSettings): Promise<void> {
    await this.tm
      .executor()
      .update(spaces)
      .set({ name: settings.name, currency: settings.currency, periodPolicy: settings.periodPolicy })
      .where(eq(spaces.id, spaceId));
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project integration src/modules/spaces`
Expected: PASS (7 tests).

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0; `db:check` prints "No schema drift".

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/infrastructure
git commit -m "feat(spaces): persist memberships lookups and space settings (Refs #12)"
```

---

### Task 4: Categories — domain model and default catalog

Implements the domain of HU-E3-01 (issue #27) and the tree invariants of HU-E3-02 (issue #28): two levels, names unique per parent ignoring case, seeded categories carrying an immutable catalog `key` (spec D11).

Decisions:
- The backlog fixes the Spanish names "Vivienda" (Arriendo, Servicios, Mantenimiento), "Ingresos" (Salario) and "Mercado"; the remaining Spanish names are chosen here (Alimentación, Restaurantes, Transporte, Combustible, Transporte público, Salud, Médico, Farmacia, Ocio, Entretenimiento, Viajes, Otros ingresos). Keys are snake_case English (`groceries`, `public_transport`, `other_income`).
- Locales starting with `en` seed English; every other locale seeds Spanish (primary locale es-CO, spec section 3).
- Only categories carry a catalog key; groups do not (the unified view groups by category key, D11).
- Archived names stay taken, so restoring never collides.

**Files:**
- Create: `src/modules/categories/domain/category.ts`, `src/modules/categories/domain/default-catalog.ts`
- Test: `src/modules/categories/domain/category.test.ts`, `src/modules/categories/domain/default-catalog.test.ts`

**Interfaces:**
- Consumes: `Id`, `IdGenerator`, `Result`, `domainError`, `ok`, `err` (kernel); `sequentialIds`, `codeOf`, `unwrap` (Task 2, tests only).
- Produces:
  - `type CategoryGroupId = Id<"CategoryGroup">`, `type CategoryId = Id<"Category">`
  - `interface CategoryGroup { id: CategoryGroupId; spaceId: string; name: string; archivedAt: Date | null; createdAt: Date }`
  - `interface Category { id: CategoryId; spaceId: string; groupId: CategoryGroupId; name: string; key: string | null; archivedAt: Date | null; createdAt: Date }`
  - `newGroup(input: { id; spaceId; name; now; groups: readonly CategoryGroup[] }): Result<CategoryGroup>` (`InvalidCategoryName`, `CategoryGroupNameTaken`)
  - `renameGroup(group, name: string, groups): Result<CategoryGroup>`
  - `newCategory(input: { id; group: CategoryGroup; name; now; categories: readonly Category[] }): Result<Category>` (`CategoryGroupArchived`, `InvalidCategoryName`, `CategoryNameTaken`)
  - `reviseCategory(category, change: { name?: string; group?: CategoryGroup }, categories): Result<Category>`
  - `archiveCategory(category, now): Category`, `restoreCategory(category, group): Result<Category>` (`CategoryGroupArchived`), `archiveGroup(group, categories, now): { group: CategoryGroup; categories: Category[] }`
  - `DEFAULT_CATALOG`, `catalogLanguage(locale: string): "es" | "en"`, `seedTree(input: { spaceId: string; locale: string; now: Date; ids: IdGenerator }): { groups: CategoryGroup[]; categories: Category[] }`

- [ ] **Step 1: Write the failing tests**

`src/modules/categories/domain/default-catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sequentialIds } from "../../../../tests/support/fakes";
import { catalogLanguage, DEFAULT_CATALOG, seedTree } from "./default-catalog";

const tree = (locale: string) =>
  seedTree({ spaceId: "space-ana", locale, now: new Date("2026-10-12T12:00:00Z"), ids: sequentialIds() });
const namesIn = (t: ReturnType<typeof tree>, groupName: string) => {
  const group = t.groups.find((g) => g.name === groupName);
  return t.categories.filter((c) => c.groupId === group?.id).map((c) => c.name);
};

describe("default category catalog (HU-E3-01)", () => {
  it("seeds the Spanish tree for locale es", () => {
    const t = tree("es");
    expect(namesIn(t, "Vivienda")).toEqual(["Arriendo", "Servicios", "Mantenimiento"]);
    expect(namesIn(t, "Ingresos")).toEqual(["Salario", "Otros ingresos"]);
  });

  it("seeds English names for English locales", () => {
    expect(namesIn(tree("en-US"), "Housing")).toEqual(["Rent", "Utilities", "Maintenance"]);
  });

  it("falls back to Spanish for other locales", () => {
    expect(catalogLanguage("fr")).toBe("es");
    expect(catalogLanguage("EN")).toBe("en");
  });

  it("gives every seeded category a unique, stable catalog key", () => {
    const t = tree("es");
    const keys = t.categories.map((c) => c.key);
    expect(t.groups).toHaveLength(DEFAULT_CATALOG.length);
    expect(t.categories).toHaveLength(13);
    expect(new Set(keys).size).toBe(keys.length);
    expect(t.categories.find((c) => c.key === "groceries")?.name).toBe("Mercado");
    expect(tree("en").categories.find((c) => c.key === "groceries")?.name).toBe("Groceries");
  });

  it("puts every seeded row in the given space, unarchived", () => {
    const t = tree("es");
    expect([...t.groups, ...t.categories].every((row) => row.spaceId === "space-ana")).toBe(true);
    expect([...t.groups, ...t.categories].every((row) => row.archivedAt === null)).toBe(true);
  });
});
```

`src/modules/categories/domain/category.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { codeOf, sequentialIds, unwrap } from "../../../../tests/support/fakes";
import {
  archiveGroup,
  newCategory,
  newGroup,
  renameGroup,
  restoreCategory,
  reviseCategory,
  type Category,
  type CategoryGroup,
} from "./category";

const now = new Date("2026-10-12T12:00:00Z");
const ids = sequentialIds("c");
const group = (id: string, name: string, archivedAt: Date | null = null): CategoryGroup => ({
  id: id as CategoryGroup["id"],
  spaceId: "space-ana",
  name,
  archivedAt,
  createdAt: now,
});
const category = (id: string, groupId: string, name: string, key: string | null = null): Category => ({
  id: id as Category["id"],
  spaceId: "space-ana",
  groupId: groupId as CategoryGroup["id"],
  name,
  key,
  archivedAt: null,
  createdAt: now,
});

const food = group("g-food", "Food");
const health = group("g-health", "Health");
const groceries = category("c-groceries", "g-food", "Groceries", "groceries");
const pharmacy = category("c-pharmacy", "g-health", "Pharmacy", "pharmacy");
const all = [groceries, pharmacy];

describe("category tree rules (HU-E3-02)", () => {
  it("creates a user category in a group, trimmed and without catalog key", () => {
    const bakery = newCategory({ id: ids.next<"Category">(), group: food, name: " Bakery ", now, categories: all });
    expect(unwrap(bakery)).toMatchObject({ name: "Bakery", groupId: "g-food", key: null, archivedAt: null });
  });

  it("rejects a duplicate name in the same group ignoring case", () => {
    const result = newCategory({ id: ids.next<"Category">(), group: food, name: "groceries", now, categories: all });
    expect(codeOf(result)).toBe("CategoryNameTaken");
  });

  it.each(["   ", "x".repeat(61)])("rejects the name %j", (name) => {
    expect(codeOf(newCategory({ id: ids.next<"Category">(), group: food, name, now, categories: all }))).toBe(
      "InvalidCategoryName",
    );
  });

  it("refuses new categories in an archived group", () => {
    const archived = group("g-old", "Old", now);
    const result = newCategory({ id: ids.next<"Category">(), group: archived, name: "Pets", now, categories: all });
    expect(codeOf(result)).toBe("CategoryGroupArchived");
  });

  it("renames a seeded category without changing its key", () => {
    expect(unwrap(reviseCategory(groceries, { name: "Supermarket" }, all))).toMatchObject({
      name: "Supermarket",
      key: "groceries",
    });
  });

  it("moves a category to another group", () => {
    expect(unwrap(reviseCategory(pharmacy, { group: food }, all))).toMatchObject({
      id: "c-pharmacy",
      groupId: "g-food",
    });
  });

  it("rejects a move onto a name already used in the target group", () => {
    const otherPharmacy = category("c-other", "g-food", "Pharmacy");
    expect(codeOf(reviseCategory(pharmacy, { group: food }, [...all, otherPharmacy]))).toBe("CategoryNameTaken");
  });

  it("keeps group names unique ignoring case", () => {
    expect(codeOf(newGroup({ id: ids.next<"CategoryGroup">(), spaceId: "space-ana", name: "FOOD", now, groups: [food] }))).toBe(
      "CategoryGroupNameTaken",
    );
    expect(codeOf(renameGroup(health, "food", [food, health]))).toBe("CategoryGroupNameTaken");
    expect(unwrap(renameGroup(health, "Fun", [food, health])).name).toBe("Fun");
  });
});

describe("archiving (HU-E3-03)", () => {
  it("archives a group with all its categories, which stay archived while the group is", () => {
    const archived = archiveGroup(food, all, now);
    expect(archived.group.archivedAt).toEqual(now);
    expect(archived.categories).toEqual([{ ...groceries, archivedAt: now }]);
    expect(codeOf(restoreCategory(archived.categories[0]!, archived.group))).toBe("CategoryGroupArchived");
  });

  it("restores a category of an active group", () => {
    expect(unwrap(restoreCategory({ ...groceries, archivedAt: now }, food)).archivedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/categories`
Expected: FAIL — `Failed to resolve import "./default-catalog"` and `"./category"`.

- [ ] **Step 3: Implement**

`src/modules/categories/domain/category.ts`:

```ts
import { domainError, err, ok, type Id, type Result } from "@/shared/kernel";

export type CategoryGroupId = Id<"CategoryGroup">;
export type CategoryId = Id<"Category">;

export interface CategoryGroup {
  readonly id: CategoryGroupId;
  readonly spaceId: string;
  readonly name: string;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
}

export interface Category {
  readonly id: CategoryId;
  readonly spaceId: string;
  readonly groupId: CategoryGroupId;
  readonly name: string;
  /** Stable catalog key of seeded categories (spec D11); null for categories users create. */
  readonly key: string | null;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
}

const MAX_NAME = 60;

const nameOf = (raw: string): Result<string> => {
  const name = raw.trim();
  return name.length >= 1 && name.length <= MAX_NAME
    ? ok(name)
    : err(domainError("InvalidCategoryName", { length: name.length }));
};

/** HU-E3-02: names are unique per parent ignoring case; archived rows keep their names taken. */
const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

const nameTakenIn = (categories: readonly Category[], groupId: string, name: string, exceptId?: string) =>
  categories.some((c) => c.groupId === groupId && c.id !== exceptId && sameName(c.name, name));

export const newGroup = (input: {
  id: CategoryGroupId;
  spaceId: string;
  name: string;
  now: Date;
  groups: readonly CategoryGroup[];
}): Result<CategoryGroup> => {
  const name = nameOf(input.name);
  if (!name.ok) return name;
  if (input.groups.some((g) => sameName(g.name, name.value))) return err(domainError("CategoryGroupNameTaken"));
  return ok({ id: input.id, spaceId: input.spaceId, name: name.value, archivedAt: null, createdAt: input.now });
};

export const renameGroup = (
  group: CategoryGroup,
  rawName: string,
  groups: readonly CategoryGroup[],
): Result<CategoryGroup> => {
  const name = nameOf(rawName);
  if (!name.ok) return name;
  if (groups.some((g) => g.id !== group.id && sameName(g.name, name.value))) {
    return err(domainError("CategoryGroupNameTaken"));
  }
  return ok({ ...group, name: name.value });
};

export const newCategory = (input: {
  id: CategoryId;
  group: CategoryGroup;
  name: string;
  now: Date;
  categories: readonly Category[];
}): Result<Category> => {
  if (input.group.archivedAt !== null) return err(domainError("CategoryGroupArchived"));
  const name = nameOf(input.name);
  if (!name.ok) return name;
  if (nameTakenIn(input.categories, input.group.id, name.value)) return err(domainError("CategoryNameTaken"));
  return ok({
    id: input.id,
    spaceId: input.group.spaceId,
    groupId: input.group.id,
    name: name.value,
    key: null,
    archivedAt: null,
    createdAt: input.now,
  });
};

/** Rename and/or move in one step: the final name must be free in the final group; the key never changes. */
export const reviseCategory = (
  category: Category,
  change: { readonly name?: string; readonly group?: CategoryGroup },
  categories: readonly Category[],
): Result<Category> => {
  const name = change.name === undefined ? ok(category.name) : nameOf(change.name);
  if (!name.ok) return name;
  const target = change.group;
  if (target && target.id !== category.groupId && target.archivedAt !== null) {
    return err(domainError("CategoryGroupArchived"));
  }
  const groupId = target?.id ?? category.groupId;
  if (nameTakenIn(categories, groupId, name.value, category.id)) return err(domainError("CategoryNameTaken"));
  return ok({ ...category, name: name.value, groupId });
};

export const archiveCategory = (category: Category, now: Date): Category =>
  category.archivedAt === null ? { ...category, archivedAt: now } : category;

export const restoreCategory = (category: Category, group: CategoryGroup): Result<Category> =>
  group.archivedAt !== null ? err(domainError("CategoryGroupArchived")) : ok({ ...category, archivedAt: null });

/** HU-E3-03: archiving a group archives all its categories. */
export const archiveGroup = (
  group: CategoryGroup,
  categories: readonly Category[],
  now: Date,
): { group: CategoryGroup; categories: Category[] } => ({
  group: group.archivedAt === null ? { ...group, archivedAt: now } : group,
  categories: categories.filter((c) => c.groupId === group.id).map((c) => archiveCategory(c, now)),
});
```

`src/modules/categories/domain/default-catalog.ts`:

```ts
import type { IdGenerator } from "@/shared/kernel";
import type { Category, CategoryGroup } from "./category";

interface Names {
  readonly es: string;
  readonly en: string;
}

interface CatalogGroup {
  readonly names: Names;
  readonly categories: readonly { readonly key: string; readonly names: Names }[];
}

/** HU-E3-01 default tree. Keys are stable across spaces and renames (spec D11); names become user data. */
export const DEFAULT_CATALOG: readonly CatalogGroup[] = [
  {
    names: { es: "Vivienda", en: "Housing" },
    categories: [
      { key: "rent", names: { es: "Arriendo", en: "Rent" } },
      { key: "utilities", names: { es: "Servicios", en: "Utilities" } },
      { key: "maintenance", names: { es: "Mantenimiento", en: "Maintenance" } },
    ],
  },
  {
    names: { es: "Alimentación", en: "Food" },
    categories: [
      { key: "groceries", names: { es: "Mercado", en: "Groceries" } },
      { key: "restaurants", names: { es: "Restaurantes", en: "Restaurants" } },
    ],
  },
  {
    names: { es: "Transporte", en: "Transport" },
    categories: [
      { key: "fuel", names: { es: "Combustible", en: "Fuel" } },
      { key: "public_transport", names: { es: "Transporte público", en: "Public transport" } },
    ],
  },
  {
    names: { es: "Salud", en: "Health" },
    categories: [
      { key: "medical", names: { es: "Médico", en: "Medical" } },
      { key: "pharmacy", names: { es: "Farmacia", en: "Pharmacy" } },
    ],
  },
  {
    names: { es: "Ocio", en: "Leisure" },
    categories: [
      { key: "entertainment", names: { es: "Entretenimiento", en: "Entertainment" } },
      { key: "travel", names: { es: "Viajes", en: "Travel" } },
    ],
  },
  {
    names: { es: "Ingresos", en: "Income" },
    categories: [
      { key: "salary", names: { es: "Salario", en: "Salary" } },
      { key: "other_income", names: { es: "Otros ingresos", en: "Other income" } },
    ],
  },
];

/** English for "en…" locales; Spanish otherwise (primary locale es-CO). */
export const catalogLanguage = (locale: string): keyof Names =>
  locale.toLowerCase().startsWith("en") ? "en" : "es";

/** The default tree for one space, named in the creator's language. */
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
      archivedAt: null,
      createdAt: input.now,
    };
    groups.push(group);
    for (const item of entry.categories) {
      categories.push({
        id: input.ids.next<"Category">(),
        spaceId: input.spaceId,
        groupId: group.id,
        name: item.names[language],
        key: item.key,
        archivedAt: null,
        createdAt: input.now,
      });
    }
  }
  return { groups, categories };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/categories`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0 (`domain-must-be-pure`: only kernel imports).

- [ ] **Step 6: Commit**

```bash
git add src/modules/categories/domain
git commit -m "feat(categories): add the two-level category model and default catalog (Refs #27, Refs #28)"
```

---

### Task 5: Categories — seed defaults and list the tree

Implements the use cases of HU-E3-01 (issue #27): `SeedDefaultCategories` (no endpoint; Task 22 runs it inside the space-creation transaction) and `ListCategories` (any member may read; archived rows only on request).

**Files:**
- Create: `src/modules/categories/application/category-repository.ts`, `deps.ts`, `seed-default-categories.ts`, `list-categories.ts`, `index.ts` (all in `src/modules/categories/application/`)
- Create: `tests/support/in-memory-categories.ts`
- Test: `src/modules/categories/application/seed-and-list.test.ts`

**Interfaces:**
- Consumes: `seedTree`, `Category`, `CategoryGroup` (Task 4); `SpaceAccess` (Task 2); `Clock`, `IdGenerator`, `TransactionManager` (kernel).
- Produces:
  - `interface CategoryRepository { hasAny(spaceId): Promise<boolean>; addGroups(groups: readonly CategoryGroup[]): Promise<void>; addCategories(categories: readonly Category[]): Promise<void>; listGroups(spaceId): Promise<CategoryGroup[]>; listCategories(spaceId): Promise<Category[]>; saveGroup(group): Promise<void>; saveCategories(categories: readonly Category[]): Promise<void>; deleteCategory(spaceId: string, categoryId: string): Promise<void> }` (lists include archived rows)
  - `interface CategoriesDeps { categories: CategoryRepository; access: SpaceAccess; ids: IdGenerator; clock: Clock; tm: TransactionManager }`
  - `createSeedDefaultCategories(deps)` → `SeedDefaultCategories = (input: { spaceId: string; locale: string }) => Promise<Result<void>>`
  - `interface CategoryGroupView extends CategoryGroup { categories: readonly Category[] }`; `createListCategories(deps)` → `ListCategories = (input: { spaceId: string; userId: string; includeArchived: boolean }) => Promise<Result<CategoryGroupView[]>>` (groups and categories sorted by name)
  - `tests/support/in-memory-categories.ts`: `class InMemoryCategories implements CategoryRepository` with public `groups` and `categories` arrays

- [ ] **Step 1: Write the in-memory repository and the failing tests**

`tests/support/in-memory-categories.ts`:

```ts
import type { Category, CategoryGroup, CategoryRepository } from "@/modules/categories/application";

export class InMemoryCategories implements CategoryRepository {
  groups: CategoryGroup[] = [];
  categories: Category[] = [];

  async hasAny(spaceId: string) {
    return this.groups.some((g) => g.spaceId === spaceId);
  }
  async addGroups(groups: readonly CategoryGroup[]) {
    this.groups.push(...groups);
  }
  async addCategories(categories: readonly Category[]) {
    this.categories.push(...categories);
  }
  async listGroups(spaceId: string) {
    return this.groups.filter((g) => g.spaceId === spaceId);
  }
  async listCategories(spaceId: string) {
    return this.categories.filter((c) => c.spaceId === spaceId);
  }
  async saveGroup(group: CategoryGroup) {
    this.groups = this.groups.map((g) => (g.id === group.id ? group : g));
  }
  async saveCategories(changed: readonly Category[]) {
    this.categories = this.categories.map((c) => changed.find((x) => x.id === c.id) ?? c);
  }
  async deleteCategory(spaceId: string, categoryId: string) {
    this.categories = this.categories.filter((c) => !(c.spaceId === spaceId && c.id === categoryId));
  }
}
```

`src/modules/categories/application/seed-and-list.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
import {
  codeOf,
  fakeSpaceAccess,
  memoryTm,
  membership,
  sequentialIds,
  unwrap,
} from "../../../../tests/support/fakes";
import { InMemoryCategories } from "../../../../tests/support/in-memory-categories";
import type { CategoriesDeps } from "./deps";
import { createListCategories } from "./list-categories";
import { createSeedDefaultCategories } from "./seed-default-categories";

const asAna = { spaceId: "space-ana", userId: "u-ana" };

const setup = () => {
  const categories = new InMemoryCategories();
  const deps: CategoriesDeps = {
    categories,
    access: fakeSpaceAccess(membership()),
    ids: sequentialIds("cat"),
    clock: new FixedClock(new Date("2026-10-12T12:00:00Z")),
    tm: memoryTm,
  };
  return { categories, seed: createSeedDefaultCategories(deps), list: createListCategories(deps) };
};

describe("SeedDefaultCategories (HU-E3-01)", () => {
  it("seeds the default tree into a space", async () => {
    const { categories, seed } = setup();
    unwrap(await seed({ spaceId: "space-ana", locale: "es" }));
    expect(categories.groups.map((g) => g.name)).toContain("Vivienda");
    expect(categories.categories).toHaveLength(13);
  });

  it("is idempotent", async () => {
    const { categories, seed } = setup();
    unwrap(await seed({ spaceId: "space-ana", locale: "es" }));
    unwrap(await seed({ spaceId: "space-ana", locale: "es" }));
    expect(categories.groups).toHaveLength(6);
    expect(categories.categories).toHaveLength(13);
  });

  it("seeds English names for an English locale", async () => {
    const { categories, seed } = setup();
    unwrap(await seed({ spaceId: "space-flat", locale: "en" }));
    expect(categories.groups.map((g) => g.name)).toContain("Housing");
  });

  it("gives each space its own rows", async () => {
    const { categories, seed } = setup();
    unwrap(await seed({ spaceId: "space-ana", locale: "es" }));
    unwrap(await seed({ spaceId: "space-household", locale: "en" }));
    const idsOf = (spaceId: string) => categories.categories.filter((c) => c.spaceId === spaceId).map((c) => c.id);
    expect(idsOf("space-ana")).toHaveLength(13);
    expect(idsOf("space-ana").filter((id) => idsOf("space-household").includes(id))).toEqual([]);
  });
});

describe("ListCategories", () => {
  it("returns the active tree sorted by name, with catalog keys", async () => {
    const { seed, list } = setup();
    unwrap(await seed({ spaceId: "space-ana", locale: "es" }));
    const tree = unwrap(await list({ ...asAna, includeArchived: false }));
    expect(tree.map((g) => g.name)).toEqual(["Alimentación", "Ingresos", "Ocio", "Salud", "Transporte", "Vivienda"]);
    expect(tree[0]?.categories.map((c) => [c.name, c.key])).toEqual([
      ["Mercado", "groceries"],
      ["Restaurantes", "restaurants"],
    ]);
  });

  it("hides archived groups and categories unless asked", async () => {
    const { categories, seed, list } = setup();
    unwrap(await seed({ spaceId: "space-ana", locale: "es" }));
    const mercado = categories.categories.find((c) => c.key === "groceries")!;
    const leisure = categories.groups.find((g) => g.name === "Ocio")!;
    await categories.saveCategories([{ ...mercado, archivedAt: new Date() }]);
    await categories.saveGroup({ ...leisure, archivedAt: new Date() });

    const active = unwrap(await list({ ...asAna, includeArchived: false }));
    expect(active.map((g) => g.name)).not.toContain("Ocio");
    expect(active.flatMap((g) => g.categories).map((c) => c.name)).not.toContain("Mercado");

    const everything = unwrap(await list({ ...asAna, includeArchived: true }));
    expect(everything.map((g) => g.name)).toContain("Ocio");
    expect(everything.flatMap((g) => g.categories).map((c) => c.name)).toContain("Mercado");
  });

  it("hides spaces the user does not belong to", async () => {
    const { list } = setup();
    expect(codeOf(await list({ spaceId: "space-ana", userId: "u-luis", includeArchived: false }))).toBe(
      "SpaceNotFound",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/categories/application`
Expected: FAIL — `Failed to resolve import "@/modules/categories/application"` (from the in-memory repository) and `"./list-categories"`.

- [ ] **Step 3: Implement**

`src/modules/categories/application/category-repository.ts`:

```ts
import type { Category, CategoryGroup } from "../domain/category";

export interface CategoryRepository {
  hasAny(spaceId: string): Promise<boolean>;
  addGroups(groups: readonly CategoryGroup[]): Promise<void>;
  addCategories(categories: readonly Category[]): Promise<void>;
  /** Every group of the space, archived ones included. */
  listGroups(spaceId: string): Promise<CategoryGroup[]>;
  /** Every category of the space, archived ones included. */
  listCategories(spaceId: string): Promise<Category[]>;
  /** Persists name and archive state. */
  saveGroup(group: CategoryGroup): Promise<void>;
  /** Persists name, group and archive state of each category. */
  saveCategories(categories: readonly Category[]): Promise<void>;
  deleteCategory(spaceId: string, categoryId: string): Promise<void>;
}
```

`src/modules/categories/application/deps.ts`:

```ts
import type { SpaceAccess } from "@/modules/spaces/application";
import type { Clock, IdGenerator, TransactionManager } from "@/shared/kernel";
import type { CategoryRepository } from "./category-repository";

export interface CategoriesDeps {
  readonly categories: CategoryRepository;
  readonly access: SpaceAccess;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly tm: TransactionManager;
}
```

`src/modules/categories/application/seed-default-categories.ts`:

```ts
import { ok, type Result } from "@/shared/kernel";
import { seedTree } from "../domain/default-catalog";
import type { CategoriesDeps } from "./deps";

export type SeedDefaultCategories = (input: { spaceId: string; locale: string }) => Promise<Result<void>>;

/** HU-E3-01: reacts to a new space (no endpoint); seeding a space that has categories does nothing. */
export const createSeedDefaultCategories =
  (deps: Pick<CategoriesDeps, "categories" | "ids" | "clock" | "tm">): SeedDefaultCategories =>
  (input) =>
    deps.tm.run(async () => {
      if (await deps.categories.hasAny(input.spaceId)) return ok(undefined);
      const tree = seedTree({ spaceId: input.spaceId, locale: input.locale, now: deps.clock.now(), ids: deps.ids });
      await deps.categories.addGroups(tree.groups);
      await deps.categories.addCategories(tree.categories);
      return ok(undefined);
    });
```

`src/modules/categories/application/list-categories.ts`:

```ts
import { ok, type Result } from "@/shared/kernel";
import type { Category, CategoryGroup } from "../domain/category";
import type { CategoriesDeps } from "./deps";

export interface CategoryGroupView extends CategoryGroup {
  readonly categories: readonly Category[];
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
    const membership = await deps.access(input.spaceId, input.userId);
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
          categories: visible(categories.filter((c) => c.groupId === group.id)).sort(byName),
        })),
    );
  };
```

`src/modules/categories/application/index.ts`:

```ts
export type { Category, CategoryGroup, CategoryGroupId, CategoryId } from "../domain/category";
export type { CategoryRepository } from "./category-repository";
export type { CategoriesDeps } from "./deps";
export { createListCategories, type CategoryGroupView, type ListCategories } from "./list-categories";
export { createSeedDefaultCategories, type SeedDefaultCategories } from "./seed-default-categories";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/categories`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/categories/application tests/support/in-memory-categories.ts
git commit -m "feat(categories): seed default categories per space and list the tree (Refs #27)"
```

---

### Task 6: Categories — manage groups and categories

Implements HU-E3-02 (issue #28): create and rename groups, create, rename and move categories. Allowed roles OWNER and ADMIN (`MANAGERS`; in a personal space, its owner).

Decision: the API names the parent with `groupId`. When `groupId` is the id of a *category* of the space, the use case answers `CategoryDepthExceeded` (the story's third-level scenario); any other unknown id is `CategoryGroupNotFound`.

**Files:**
- Create: `src/modules/categories/application/authorize.ts`, `lookups.ts`, `create-category-group.ts`, `rename-category-group.ts`, `create-category.ts`, `update-category.ts` (all in `src/modules/categories/application/`)
- Modify: `src/modules/categories/application/index.ts`
- Test: `src/modules/categories/application/manage-categories.test.ts`

**Interfaces:**
- Consumes: `newGroup`, `renameGroup`, `newCategory`, `reviseCategory` (Task 4); `CategoriesDeps`, `createSeedDefaultCategories` (Task 5); `MANAGERS`, `requireRole`, `SpaceAccess`, `SpaceMembership` (Task 2); `InMemoryCategories` (Task 5).
- Produces:
  - `authorizeManager(access: SpaceAccess, spaceId: string, userId: string): Promise<Result<SpaceMembership>>`
  - `groupById(groups, categories, groupId: string): Result<CategoryGroup>` (`CategoryDepthExceeded`, `CategoryGroupNotFound`); `categoryById(categories, categoryId: string): Result<Category>` (`CategoryNotFound`)
  - `createCreateCategoryGroup(deps)` → `CreateCategoryGroup = (input: { spaceId; userId; name: string }) => Promise<Result<CategoryGroup>>`
  - `createRenameCategoryGroup(deps)` → `RenameCategoryGroup = (input: { spaceId; userId; groupId: string; name: string }) => Promise<Result<CategoryGroup>>`
  - `createCreateCategory(deps)` → `CreateCategory = (input: { spaceId; userId; groupId: string; name: string }) => Promise<Result<Category>>`
  - `createUpdateCategory(deps)` → `UpdateCategory = (input: { spaceId; userId; categoryId: string; name?: string; groupId?: string }) => Promise<Result<Category>>`

- [ ] **Step 1: Write the failing tests**

`src/modules/categories/application/manage-categories.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
import {
  codeOf,
  fakeSpaceAccess,
  memoryTm,
  membership,
  sequentialIds,
  unwrap,
} from "../../../../tests/support/fakes";
import { InMemoryCategories } from "../../../../tests/support/in-memory-categories";
import { createCreateCategory } from "./create-category";
import { createCreateCategoryGroup } from "./create-category-group";
import type { CategoriesDeps } from "./deps";
import { createRenameCategoryGroup } from "./rename-category-group";
import { createSeedDefaultCategories } from "./seed-default-categories";
import { createUpdateCategory } from "./update-category";

const household = membership({ spaceId: "space-household", name: "Household", spaceKind: "SHARED" });
const sofi = membership({ ...household, memberId: "member-sofi", userId: "u-sofi", role: "VIEWER" });
const asAna = { spaceId: "space-household", userId: "u-ana" };

const setup = async () => {
  const categories = new InMemoryCategories();
  const deps: CategoriesDeps = {
    categories,
    access: fakeSpaceAccess(household, sofi, membership()),
    ids: sequentialIds("cat"),
    clock: new FixedClock(new Date("2026-10-12T12:00:00Z")),
    tm: memoryTm,
  };
  const seed = createSeedDefaultCategories(deps);
  unwrap(await seed({ spaceId: "space-household", locale: "en" }));
  unwrap(await seed({ spaceId: "space-ana", locale: "es" }));
  return {
    categories,
    group: (spaceId: string, name: string) => categories.groups.find((g) => g.spaceId === spaceId && g.name === name)!,
    category: (spaceId: string, name: string) =>
      categories.categories.find((c) => c.spaceId === spaceId && c.name === name)!,
    createGroup: createCreateCategoryGroup(deps),
    renameGroup: createRenameCategoryGroup(deps),
    create: createCreateCategory(deps),
    update: createUpdateCategory(deps),
  };
};

describe("category tree management (HU-E3-02)", () => {
  it("creates a category in an existing group", async () => {
    const { categories, group, create } = await setup();
    const food = group("space-household", "Food");
    expect(unwrap(await create({ ...asAna, groupId: food.id, name: "Bakery" }))).toMatchObject({
      groupId: food.id,
      name: "Bakery",
      key: null,
    });
    expect(categories.categories.filter((c) => c.groupId === food.id).map((c) => c.name)).toContain("Bakery");
  });

  it("renames a group and keeps its categories", async () => {
    const { categories, group, renameGroup } = await setup();
    const leisure = group("space-household", "Leisure");
    expect(unwrap(await renameGroup({ ...asAna, groupId: leisure.id, name: "Fun" })).name).toBe("Fun");
    expect(categories.categories.filter((c) => c.groupId === leisure.id).map((c) => c.name)).toEqual([
      "Entertainment",
      "Travel",
    ]);
  });

  it("moves a category to another group and keeps its id, so transactions keep their category", async () => {
    const { group, category, update } = await setup();
    const pharmacy = category("space-household", "Pharmacy");
    const food = group("space-household", "Food");
    expect(unwrap(await update({ ...asAna, categoryId: pharmacy.id, groupId: food.id }))).toMatchObject({
      id: pharmacy.id,
      groupId: food.id,
      key: "pharmacy",
    });
  });

  it("rejects a third level", async () => {
    const { category, create } = await setup();
    const groceries = category("space-household", "Groceries");
    expect(codeOf(await create({ ...asAna, groupId: groceries.id, name: "Organic" }))).toBe(
      "CategoryDepthExceeded",
    );
  });

  it("rejects a duplicate name in the same group ignoring case", async () => {
    const { group, create } = await setup();
    const food = group("space-household", "Food");
    expect(codeOf(await create({ ...asAna, groupId: food.id, name: "groceries" }))).toBe("CategoryNameTaken");
  });

  it("forbids viewers", async () => {
    const { group, create } = await setup();
    const leisure = group("space-household", "Leisure");
    const result = await create({ spaceId: "space-household", userId: "u-sofi", groupId: leisure.id, name: "Pets" });
    expect(codeOf(result)).toBe("InsufficientRole");
  });

  it("keeps each space's seeded categories independent (HU-E3-01)", async () => {
    const { categories, category, update } = await setup();
    const before = categories.categories.filter((c) => c.spaceId === "space-household");
    const arriendo = category("space-ana", "Arriendo");
    unwrap(await update({ spaceId: "space-ana", userId: "u-ana", categoryId: arriendo.id, name: "Alquiler" }));
    expect(categories.categories.filter((c) => c.spaceId === "space-household")).toEqual(before);
  });

  it("keeps the catalog key on rename; categories users create have none (HU-E3-01)", async () => {
    const { group, category, create, update } = await setup();
    const asAnaPersonal = { spaceId: "space-ana", userId: "u-ana" };
    const mercado = category("space-ana", "Mercado");
    expect(unwrap(await update({ ...asAnaPersonal, categoryId: mercado.id, name: "Supermercado" })).key).toBe(
      "groceries",
    );
    const food = group("space-ana", "Alimentación");
    expect(unwrap(await create({ ...asAnaPersonal, groupId: food.id, name: "Panadería" })).key).toBeNull();
  });

  it("reports unknown groups and categories, and duplicate group names", async () => {
    const { createGroup, create, update } = await setup();
    expect(codeOf(await create({ ...asAna, groupId: "nope", name: "Pets" }))).toBe("CategoryGroupNotFound");
    expect(codeOf(await update({ ...asAna, categoryId: "nope", name: "Pets" }))).toBe("CategoryNotFound");
    expect(codeOf(await createGroup({ ...asAna, name: "food" }))).toBe("CategoryGroupNameTaken");
    expect(unwrap(await createGroup({ ...asAna, name: "Pets" })).name).toBe("Pets");
  });

  it("never uses a group of another space", async () => {
    const { group, create } = await setup();
    const householdFood = group("space-household", "Food");
    const result = await create({ spaceId: "space-ana", userId: "u-ana", groupId: householdFood.id, name: "Pan" });
    expect(codeOf(result)).toBe("CategoryGroupNotFound");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/categories/application/manage-categories.test.ts`
Expected: FAIL — `Failed to resolve import "./create-category"`.

- [ ] **Step 3: Implement**

`src/modules/categories/application/authorize.ts`:

```ts
import { MANAGERS, requireRole, type SpaceAccess, type SpaceMembership } from "@/modules/spaces/application";
import { flatMap, type Result } from "@/shared/kernel";

/** HU-E3-02: OWNER and ADMIN (in a personal space, its owner) manage the category tree. */
export const authorizeManager = async (
  access: SpaceAccess,
  spaceId: string,
  userId: string,
): Promise<Result<SpaceMembership>> => flatMap(await access(spaceId, userId), (m) => requireRole(m, MANAGERS));
```

`src/modules/categories/application/lookups.ts`:

```ts
import { domainError, err, ok, type Result } from "@/shared/kernel";
import type { Category, CategoryGroup } from "../domain/category";

/** The parent group; naming a category as the parent would create a third level (HU-E3-02). */
export const groupById = (
  groups: readonly CategoryGroup[],
  categories: readonly Category[],
  groupId: string,
): Result<CategoryGroup> => {
  const group = groups.find((g) => g.id === groupId);
  if (group) return ok(group);
  return err(domainError(categories.some((c) => c.id === groupId) ? "CategoryDepthExceeded" : "CategoryGroupNotFound"));
};

export const categoryById = (categories: readonly Category[], categoryId: string): Result<Category> => {
  const category = categories.find((c) => c.id === categoryId);
  return category ? ok(category) : err(domainError("CategoryNotFound"));
};
```

`src/modules/categories/application/create-category-group.ts`:

```ts
import type { Result } from "@/shared/kernel";
import { newGroup, type CategoryGroup } from "../domain/category";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";

export type CreateCategoryGroup = (input: {
  spaceId: string;
  userId: string;
  name: string;
}) => Promise<Result<CategoryGroup>>;

export const createCreateCategoryGroup =
  (deps: CategoriesDeps): CreateCategoryGroup =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      const group = newGroup({
        id: deps.ids.next<"CategoryGroup">(),
        spaceId,
        name: input.name,
        now: deps.clock.now(),
        groups: await deps.categories.listGroups(spaceId),
      });
      if (!group.ok) return group;
      await deps.categories.addGroups([group.value]);
      return group;
    });
```

`src/modules/categories/application/rename-category-group.ts`:

```ts
import { domainError, err, type Result } from "@/shared/kernel";
import { renameGroup, type CategoryGroup } from "../domain/category";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";

export type RenameCategoryGroup = (input: {
  spaceId: string;
  userId: string;
  groupId: string;
  name: string;
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
      const renamed = renameGroup(group, input.name, groups);
      if (!renamed.ok) return renamed;
      await deps.categories.saveGroup(renamed.value);
      return renamed;
    });
```

`src/modules/categories/application/create-category.ts`:

```ts
import type { Result } from "@/shared/kernel";
import { newCategory, type Category } from "../domain/category";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";
import { groupById } from "./lookups";

export type CreateCategory = (input: {
  spaceId: string;
  userId: string;
  groupId: string;
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
      const group = groupById(await deps.categories.listGroups(spaceId), categories, input.groupId);
      if (!group.ok) return group;
      const category = newCategory({
        id: deps.ids.next<"Category">(),
        group: group.value,
        name: input.name,
        now: deps.clock.now(),
        categories,
      });
      if (!category.ok) return category;
      await deps.categories.addCategories([category.value]);
      return category;
    });
```

`src/modules/categories/application/update-category.ts`:

```ts
import { ok, type Result } from "@/shared/kernel";
import { reviseCategory, type Category } from "../domain/category";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";
import { categoryById, groupById } from "./lookups";

export type UpdateCategory = (input: {
  spaceId: string;
  userId: string;
  categoryId: string;
  name?: string;
  groupId?: string;
}) => Promise<Result<Category>>;

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
      const revised = reviseCategory(category.value, { name: input.name, group: target.value }, categories);
      if (!revised.ok) return revised;
      await deps.categories.saveCategories([revised.value]);
      return revised;
    });
```

In `src/modules/categories/application/index.ts`, add:

```ts
export { createCreateCategory, type CreateCategory } from "./create-category";
export { createCreateCategoryGroup, type CreateCategoryGroup } from "./create-category-group";
export { createRenameCategoryGroup, type RenameCategoryGroup } from "./rename-category-group";
export { createUpdateCategory, type UpdateCategory } from "./update-category";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/categories`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/categories/application
git commit -m "feat(categories): create, rename and move category groups and categories (Refs #28)"
```

---

### Task 7: Categories — delete, archive and restore

Implements HU-E3-03 (issue #29): unreferenced categories can be deleted; referenced ones answer `CategoryInUse` and can be archived; archived categories stay in history but leave the active list; restore; archiving a group archives its categories.

Decisions: the reference check is the `CategoryUsage` port, bound to the ledger in Task 29 (soft-deleted transactions count, D8). Budget-line mappings join the check when budgeting lands (HU-E6-04, M3). The technical note "archiving a group archives all its categories" gets its own endpoint (`POST .../category-groups/{groupId}/archive`, Task 29). Recording with an archived category (`CategoryArchived`) is the ledger's rule (Task 15).

**Files:**
- Create: `src/modules/categories/application/delete-category.ts`, `archive-category.ts`, `restore-category.ts`, `archive-category-group.ts` (all in `src/modules/categories/application/`)
- Modify: `src/modules/categories/application/index.ts`
- Test: `src/modules/categories/application/retire-categories.test.ts`

**Interfaces:**
- Consumes: `archiveCategory`, `restoreCategory`, `archiveGroup` (Task 4); `CategoriesDeps`, `createListCategories`, `createSeedDefaultCategories` (Task 5); `authorizeManager`, `categoryById`, `createCreateCategory` (Task 6).
- Produces:
  - `interface CategoryUsage { isCategoryReferenced(categoryId: string): Promise<boolean> }`
  - `createDeleteCategory(deps: CategoriesDeps & { usage: CategoryUsage })` → `DeleteCategory = (input: { spaceId; userId; categoryId: string }) => Promise<Result<void>>` (`CategoryInUse`, `CategoryNotFound`)
  - `createArchiveCategory(deps)` → `ArchiveCategory = (input: { spaceId; userId; categoryId }) => Promise<Result<Category>>`
  - `createRestoreCategory(deps)` → `RestoreCategory = (input: { spaceId; userId; categoryId }) => Promise<Result<Category>>` (`CategoryGroupArchived`)
  - `createArchiveCategoryGroup(deps)` → `ArchiveCategoryGroup = (input: { spaceId; userId; groupId: string }) => Promise<Result<CategoryGroup>>` (`CategoryGroupNotFound`)

- [ ] **Step 1: Write the failing tests**

`src/modules/categories/application/retire-categories.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
import {
  codeOf,
  fakeSpaceAccess,
  memoryTm,
  membership,
  sequentialIds,
  unwrap,
} from "../../../../tests/support/fakes";
import { InMemoryCategories } from "../../../../tests/support/in-memory-categories";
import { createArchiveCategory } from "./archive-category";
import { createArchiveCategoryGroup } from "./archive-category-group";
import { createCreateCategory } from "./create-category";
import { createDeleteCategory } from "./delete-category";
import type { CategoriesDeps } from "./deps";
import { createListCategories } from "./list-categories";
import { createRestoreCategory } from "./restore-category";
import { createSeedDefaultCategories } from "./seed-default-categories";

const household = membership({ spaceId: "space-household", name: "Household", spaceKind: "SHARED" });
const sofi = membership({ ...household, memberId: "member-sofi", userId: "u-sofi", role: "VIEWER" });
const asAna = { spaceId: "space-household", userId: "u-ana" };

const setup = async () => {
  const categories = new InMemoryCategories();
  const referenced = new Set<string>();
  const deps: CategoriesDeps = {
    categories,
    access: fakeSpaceAccess(household, sofi),
    ids: sequentialIds("cat"),
    clock: new FixedClock(new Date("2026-10-12T12:00:00Z")),
    tm: memoryTm,
  };
  unwrap(await createSeedDefaultCategories(deps)({ spaceId: "space-household", locale: "en" }));
  const named = (name: string) => categories.categories.find((c) => c.name === name)!;
  const activeNames = async () =>
    unwrap(await createListCategories(deps)({ ...asAna, includeArchived: false }))
      .flatMap((g) => g.categories)
      .map((c) => c.name);
  return {
    categories,
    referenced,
    named,
    activeNames,
    create: createCreateCategory(deps),
    remove: createDeleteCategory({ ...deps, usage: { isCategoryReferenced: async (id) => referenced.has(id) } }),
    archive: createArchiveCategory(deps),
    restore: createRestoreCategory(deps),
    archiveGroup: createArchiveCategoryGroup(deps),
    list: createListCategories(deps),
  };
};

describe("retiring categories (HU-E3-03)", () => {
  it("deletes a category without transactions", async () => {
    const { categories, create, remove } = await setup();
    const food = categories.groups.find((g) => g.name === "Food")!;
    const bakery = unwrap(await create({ ...asAna, groupId: food.id, name: "Bakery" }));
    unwrap(await remove({ ...asAna, categoryId: bakery.id }));
    expect(categories.categories.map((c) => c.id)).not.toContain(bakery.id);
  });

  it("refuses to delete a referenced category, which can still be archived", async () => {
    const { categories, referenced, named, remove, archive } = await setup();
    const groceries = named("Groceries");
    referenced.add(groceries.id);
    expect(codeOf(await remove({ ...asAna, categoryId: groceries.id }))).toBe("CategoryInUse");
    expect(categories.categories.map((c) => c.id)).toContain(groceries.id);
    expect(unwrap(await archive({ ...asAna, categoryId: groceries.id })).archivedAt).not.toBeNull();
  });

  it("keeps archived categories out of the active list but available on request", async () => {
    const { named, archive, activeNames, list } = await setup();
    unwrap(await archive({ ...asAna, categoryId: named("Groceries").id }));
    expect(await activeNames()).not.toContain("Groceries");
    const everything = unwrap(await list({ ...asAna, includeArchived: true }));
    expect(everything.flatMap((g) => g.categories).map((c) => c.name)).toContain("Groceries");
  });

  it("restores an archived category", async () => {
    const { named, archive, restore, activeNames } = await setup();
    const groceries = named("Groceries");
    unwrap(await archive({ ...asAna, categoryId: groceries.id }));
    expect(unwrap(await restore({ ...asAna, categoryId: groceries.id })).archivedAt).toBeNull();
    expect(await activeNames()).toContain("Groceries");
  });

  it("archives a group with all its categories", async () => {
    const { categories, named, archiveGroup, restore } = await setup();
    const leisure = categories.groups.find((g) => g.name === "Leisure")!;
    expect(unwrap(await archiveGroup({ ...asAna, groupId: leisure.id })).archivedAt).not.toBeNull();
    expect(categories.categories.filter((c) => c.groupId === leisure.id).every((c) => c.archivedAt !== null)).toBe(
      true,
    );
    expect(codeOf(await restore({ ...asAna, categoryId: named("Travel").id }))).toBe("CategoryGroupArchived");
  });

  it("forbids viewers and reports unknown ids", async () => {
    const { named, remove, archiveGroup } = await setup();
    const asSofi = { spaceId: "space-household", userId: "u-sofi" };
    expect(codeOf(await remove({ ...asSofi, categoryId: named("Groceries").id }))).toBe("InsufficientRole");
    expect(codeOf(await remove({ ...asAna, categoryId: "nope" }))).toBe("CategoryNotFound");
    expect(codeOf(await archiveGroup({ ...asAna, groupId: "nope" }))).toBe("CategoryGroupNotFound");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/categories/application/retire-categories.test.ts`
Expected: FAIL — `Failed to resolve import "./archive-category"`.

- [ ] **Step 3: Implement**

`src/modules/categories/application/delete-category.ts`:

```ts
import { domainError, err, ok, type Result } from "@/shared/kernel";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";
import { categoryById } from "./lookups";

/**
 * Whether anything references a category (HU-E3-03). Bound to the ledger, where soft-deleted
 * transactions still count (D8); budget-line mappings join with HU-E6-04.
 */
export interface CategoryUsage {
  isCategoryReferenced(categoryId: string): Promise<boolean>;
}

export type DeleteCategory = (input: { spaceId: string; userId: string; categoryId: string }) => Promise<Result<void>>;

export const createDeleteCategory =
  (deps: CategoriesDeps & { readonly usage: CategoryUsage }): DeleteCategory =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const category = categoryById(await deps.categories.listCategories(manager.value.spaceId), input.categoryId);
      if (!category.ok) return category;
      if (await deps.usage.isCategoryReferenced(category.value.id)) return err(domainError("CategoryInUse"));
      await deps.categories.deleteCategory(manager.value.spaceId, category.value.id);
      return ok(undefined);
    });
```

`src/modules/categories/application/archive-category.ts`:

```ts
import { ok, type Result } from "@/shared/kernel";
import { archiveCategory, type Category } from "../domain/category";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";
import { categoryById } from "./lookups";

export type ArchiveCategory = (input: { spaceId: string; userId: string; categoryId: string }) => Promise<Result<Category>>;

export const createArchiveCategory =
  (deps: CategoriesDeps): ArchiveCategory =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const category = categoryById(await deps.categories.listCategories(manager.value.spaceId), input.categoryId);
      if (!category.ok) return category;
      const archived = archiveCategory(category.value, deps.clock.now());
      await deps.categories.saveCategories([archived]);
      return ok(archived);
    });
```

`src/modules/categories/application/restore-category.ts`:

```ts
import { domainError, err, type Result } from "@/shared/kernel";
import { restoreCategory, type Category } from "../domain/category";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";
import { categoryById } from "./lookups";

export type RestoreCategory = (input: { spaceId: string; userId: string; categoryId: string }) => Promise<Result<Category>>;

export const createRestoreCategory =
  (deps: CategoriesDeps): RestoreCategory =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      const category = categoryById(await deps.categories.listCategories(spaceId), input.categoryId);
      if (!category.ok) return category;
      const group = (await deps.categories.listGroups(spaceId)).find((g) => g.id === category.value.groupId);
      if (!group) return err(domainError("CategoryGroupNotFound"));
      const restored = restoreCategory(category.value, group);
      if (!restored.ok) return restored;
      await deps.categories.saveCategories([restored.value]);
      return restored;
    });
```

`src/modules/categories/application/archive-category-group.ts`:

```ts
import { domainError, err, ok, type Result } from "@/shared/kernel";
import { archiveGroup, type CategoryGroup } from "../domain/category";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";

export type ArchiveCategoryGroup = (input: {
  spaceId: string;
  userId: string;
  groupId: string;
}) => Promise<Result<CategoryGroup>>;

export const createArchiveCategoryGroup =
  (deps: CategoriesDeps): ArchiveCategoryGroup =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      const group = (await deps.categories.listGroups(spaceId)).find((g) => g.id === input.groupId);
      if (!group) return err(domainError("CategoryGroupNotFound"));
      const archived = archiveGroup(group, await deps.categories.listCategories(spaceId), deps.clock.now());
      await deps.categories.saveGroup(archived.group);
      await deps.categories.saveCategories(archived.categories);
      return ok(archived.group);
    });
```

In `src/modules/categories/application/index.ts`, add:

```ts
export { createArchiveCategory, type ArchiveCategory } from "./archive-category";
export { createArchiveCategoryGroup, type ArchiveCategoryGroup } from "./archive-category-group";
export { createDeleteCategory, type CategoryUsage, type DeleteCategory } from "./delete-category";
export { createRestoreCategory, type RestoreCategory } from "./restore-category";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/categories`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/categories/application
git commit -m "feat(categories): delete unreferenced categories and archive or restore the rest (Refs #29)"
```

---

### Task 8: Categories — tables and migration 0003

Schema-only task (HU-E3-01 … HU-E3-03) so the generated snapshot is reviewed on its own.

**Files:**
- Create: `src/modules/categories/infrastructure/categories.schema.ts`
- Create (generated): `drizzle/0003_categories.sql`, `drizzle/meta/0003_snapshot.json`; Modify (generated): `drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: `spaces` table (M0).
- Produces: tables `category_groups` (`categoryGroups`) and `categories` (`categories`) with unique indexes `category_groups_space_name_uq (space_id, lower(name))`, `categories_group_name_uq (group_id, lower(name))`, `categories_space_key_uq (space_id, key)` and `categories_space_idx (space_id)`.

- [ ] **Step 1: Write the schema**

`src/modules/categories/infrastructure/categories.schema.ts`:

```ts
import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { spaces } from "@/modules/spaces/infrastructure/spaces.schema";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const categoryGroups = pgTable(
  "category_groups",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    archivedAt: tz("archived_at"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [uniqueIndex("category_groups_space_name_uq").on(t.spaceId, sql`lower(${t.name})`)],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    // Groups are never hard-deleted, so no cascade here.
    groupId: uuid("group_id")
      .notNull()
      .references(() => categoryGroups.id),
    name: text("name").notNull(),
    key: text("key"),
    archivedAt: tz("archived_at"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    // HU-E3-02: unique per parent ignoring case (archived rows included).
    uniqueIndex("categories_group_name_uq").on(t.groupId, sql`lower(${t.name})`),
    // HU-E3-01: seeding twice can never duplicate a catalog key; NULL keys (user categories) never collide.
    uniqueIndex("categories_space_key_uq").on(t.spaceId, t.key),
    index("categories_space_idx").on(t.spaceId),
  ],
);
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate --name categories`
Expected: `drizzle/0003_categories.sql` creating `category_groups` and `categories`, the foreign keys `category_groups.space_id → spaces.id` (cascade), `categories.space_id → spaces.id` (cascade) and `categories.group_id → category_groups.id`, and the four indexes listed above; `drizzle/meta/0003_snapshot.json` and a fourth `_journal.json` entry with tag `0003_categories`.

- [ ] **Step 3: Verify migrations and drift**

Run: `pnpm db:check && pnpm exec vitest run --project integration src/shared/infrastructure/db/migrations.int.test.ts`
Expected: "No schema drift: migrations match the Drizzle schema." and PASS (the test counts four applied migrations from the journal).

- [ ] **Step 4: Gates**

Run: `pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0 (`schemas-only-reference-schemas`: the schema imports only `spaces.schema`).

- [ ] **Step 5: Commit**

```bash
git add src/modules/categories/infrastructure/categories.schema.ts drizzle/0003_categories.sql drizzle/meta/0003_snapshot.json drizzle/meta/_journal.json
git commit -m "feat(categories): add category group and category tables with migration (Refs #27)"
```

---

### Task 9: Categories — Drizzle repository

Implements `CategoryRepository` (HU-E3-01 … HU-E3-03) and the first integration fixture shared by later repository tests.

**Files:**
- Create: `src/modules/categories/infrastructure/drizzle-category-repository.ts`
- Create: `tests/support/fixtures.ts`
- Test: `src/modules/categories/infrastructure/drizzle-category-repository.int.test.ts`

**Interfaces:**
- Consumes: `CategoryRepository` (Task 5); `Category`, `CategoryGroup`, `seedTree` (Task 4); tables (Task 8); `createPersonalSpace`, `DrizzleSpaceRepository` (M0); `DrizzleTransactionManager`, `UuidV7IdGenerator`, `testDatabase` (M0).
- Produces:
  - `class DrizzleCategoryRepository implements CategoryRepository` (constructor `(tm: DrizzleTransactionManager)`)
  - `tests/support/fixtures.ts`: `interface SpaceFixture { userId: string; spaceId: string; memberId: string }`, `personalSpaceFixture(db: Database, pool: Pool, name?: string): Promise<SpaceFixture>`

- [ ] **Step 1: Write the fixture and the failing integration test**

`tests/support/fixtures.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { createPersonalSpace } from "@/modules/spaces/domain/space";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import type { Database } from "@/shared/infrastructure/db/client";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { Id } from "@/shared/kernel";

export interface SpaceFixture {
  readonly userId: string;
  readonly spaceId: string;
  readonly memberId: string;
}

/** A registered user with their personal space, written through the real spaces repository. */
export const personalSpaceFixture = async (db: Database, pool: Pool, name = "Ana"): Promise<SpaceFixture> => {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [
    userId,
    name,
    `${userId}@example.com`,
  ]);
  const space = createPersonalSpace({
    id: randomUUID() as Id<"Space">,
    memberId: randomUUID() as Id<"SpaceMember">,
    ownerUserId: userId,
    ownerName: name,
    now: new Date(),
  });
  await new DrizzleSpaceRepository(new DrizzleTransactionManager(db)).add(space);
  return { userId, spaceId: space.id, memberId: space.members[0]!.id };
};
```

`src/modules/categories/infrastructure/drizzle-category-repository.int.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { testDatabase } from "../../../../tests/support/database";
import { personalSpaceFixture } from "../../../../tests/support/fixtures";
import { seedTree } from "../domain/default-catalog";
import { DrizzleCategoryRepository } from "./drizzle-category-repository";

const { db, pool } = testDatabase();
const repo = new DrizzleCategoryRepository(new DrizzleTransactionManager(db));
const ids = new UuidV7IdGenerator();

const seeded = async () => {
  const space = await personalSpaceFixture(db, pool);
  const tree = seedTree({ spaceId: space.spaceId, locale: "es", now: new Date("2026-10-12T12:00:00Z"), ids });
  await repo.addGroups(tree.groups);
  await repo.addCategories(tree.categories);
  return { space, tree };
};

afterAll(() => pool.end());

describe("DrizzleCategoryRepository", () => {
  it("stores and lists the seeded tree with catalog keys", async () => {
    const { space, tree } = await seeded();
    expect(await repo.hasAny(space.spaceId)).toBe(true);
    expect(await repo.listGroups(space.spaceId)).toEqual(expect.arrayContaining(tree.groups));
    const categories = await repo.listCategories(space.spaceId);
    expect(categories).toHaveLength(13);
    expect(categories).toContainEqual(expect.objectContaining({ name: "Mercado", key: "groceries", archivedAt: null }));
  });

  it("reports a space without categories", async () => {
    const space = await personalSpaceFixture(db, pool);
    expect(await repo.hasAny(space.spaceId)).toBe(false);
    expect(await repo.listCategories(space.spaceId)).toEqual([]);
  });

  it("saves renames, moves and archive state, and deletes", async () => {
    const { space, tree } = await seeded();
    const housing = tree.groups[0]!;
    const food = tree.groups[1]!;
    const rent = tree.categories[0]!;
    const archivedAt = new Date("2026-10-13T00:00:00Z");
    await repo.saveCategories([{ ...rent, name: "Alquiler", groupId: food.id, archivedAt }]);
    await repo.saveGroup({ ...housing, name: "Hogar", archivedAt });
    expect((await repo.listCategories(space.spaceId)).find((c) => c.id === rent.id)).toEqual({
      ...rent,
      name: "Alquiler",
      groupId: food.id,
      archivedAt,
    });
    expect((await repo.listGroups(space.spaceId)).find((g) => g.id === housing.id)).toEqual({
      ...housing,
      name: "Hogar",
      archivedAt,
    });
    await repo.deleteCategory(space.spaceId, rent.id);
    expect((await repo.listCategories(space.spaceId)).map((c) => c.id)).not.toContain(rent.id);
  });

  it("enforces unique names per group ignoring case", async () => {
    const { tree } = await seeded();
    const mercado = tree.categories.find((c) => c.key === "groceries")!;
    await expect(
      repo.addCategories([{ ...mercado, id: ids.next<"Category">(), name: "MERCADO", key: null }]),
    ).rejects.toThrow();
  });

  it("enforces one category per catalog key and space", async () => {
    const { tree } = await seeded();
    const mercado = tree.categories.find((c) => c.key === "groceries")!;
    await expect(
      repo.addCategories([{ ...mercado, id: ids.next<"Category">(), name: "Otro mercado" }]),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project integration src/modules/categories`
Expected: FAIL — `Failed to resolve import "./drizzle-category-repository"`.

- [ ] **Step 3: Implement**

`src/modules/categories/infrastructure/drizzle-category-repository.ts`:

```ts
import { and, eq } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { CategoryRepository } from "../application/category-repository";
import type { Category, CategoryGroup, CategoryGroupId, CategoryId } from "../domain/category";
import { categories, categoryGroups } from "./categories.schema";

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
          name: c.name,
          key: c.key,
          archivedAt: c.archivedAt,
          createdAt: c.createdAt,
        })),
      );
  }

  async listGroups(spaceId: string): Promise<CategoryGroup[]> {
    const rows = await this.tm.executor().select().from(categoryGroups).where(eq(categoryGroups.spaceId, spaceId));
    return rows.map((row) => ({ ...row, id: row.id as CategoryGroupId }));
  }

  async listCategories(spaceId: string): Promise<Category[]> {
    const rows = await this.tm.executor().select().from(categories).where(eq(categories.spaceId, spaceId));
    return rows.map((row) => ({ ...row, id: row.id as CategoryId, groupId: row.groupId as CategoryGroupId }));
  }

  async saveGroup(group: CategoryGroup): Promise<void> {
    await this.tm
      .executor()
      .update(categoryGroups)
      .set({ name: group.name, archivedAt: group.archivedAt })
      .where(eq(categoryGroups.id, group.id));
  }

  async saveCategories(rows: readonly Category[]): Promise<void> {
    const db = this.tm.executor();
    for (const c of rows) {
      await db
        .update(categories)
        .set({ name: c.name, groupId: c.groupId, archivedAt: c.archivedAt })
        .where(eq(categories.id, c.id));
    }
  }

  async deleteCategory(spaceId: string, categoryId: string): Promise<void> {
    await this.tm
      .executor()
      .delete(categories)
      .where(and(eq(categories.spaceId, spaceId), eq(categories.id, categoryId)));
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project integration src/modules/categories`
Expected: PASS (5 tests).

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/categories/infrastructure/drizzle-category-repository.ts src/modules/categories/infrastructure/drizzle-category-repository.int.test.ts tests/support/fixtures.ts
git commit -m "feat(categories): persist category trees with a Drizzle repository (Refs #27, Refs #28, Refs #29)"
```

---

### Task 10: Accounts — domain model and CreateAccount

Implements HU-E2-01 (issue #23): personal accounts with an opening balance (negative allowed), unique names per space ignoring case, `SHARED_FUND` only in shared spaces. The type rules for shared spaces (`PersonalAccountRequiresPersonalSpace`) are pure domain rules and are pinned now; creating a shared fund end to end (role checks, HU-E2-02) is M2.

Decisions: accounts store no currency; they use the space currency, and an opening balance in another currency is `CurrencyMismatch`. Archived names stay taken.

**Files:**
- Create: `src/modules/accounts/domain/account.ts`
- Create: `src/modules/accounts/application/account-repository.ts`, `account-movements.ts`, `account-view.ts`, `currency.ts`, `deps.ts`, `create-account.ts`, `index.ts` (all in `src/modules/accounts/application/`)
- Create: `tests/support/in-memory-accounts.ts`
- Test: `src/modules/accounts/domain/account.test.ts`, `src/modules/accounts/application/create-account.test.ts`

**Interfaces:**
- Consumes: `SpaceAccess`, `requireRole`, `WRITERS` (Task 2); `Money`, `LocalDate`, `Id`, `Clock`, `IdGenerator`, `TransactionManager` (kernel); fakes (Task 2).
- Produces:
  - `type AccountId = Id<"Account">`; `ACCOUNT_TYPES = ["CASH", "BANK", "CREDIT_CARD", "SAVINGS", "SHARED_FUND"] as const`; `type AccountType`
  - `interface Account { id: AccountId; spaceId: string; name: string; type: AccountType; ownerUserId: string | null; openingBalance: bigint; archivedAt: Date | null; createdAt: Date }`
  - `openAccount(input: { id; spaceId; spaceKind: "PERSONAL" | "SHARED" | "DIRECT"; ownerUserId: string; name; type; openingBalance: bigint; now: Date; siblings: readonly Account[] }): Result<Account>` (`InvalidAccountName`, `SharedFundRequiresSharedSpace`, `PersonalAccountRequiresPersonalSpace`, `AccountNameTaken`)
  - `reviseAccount(account, change: { name?: string; type?: AccountType; openingBalance?: bigint }, siblings): Result<Account>` (`AccountTypeImmutable`, `AccountNameTaken`, `InvalidAccountName`); `archiveAccount(account, now): Account`
  - `interface AccountRepository { add(account): Promise<void>; listBySpace(spaceId): Promise<Account[]>; findById(accountId: string): Promise<Account | null>; save(account): Promise<void> }`
  - `interface AccountMovements { netMovements(accountIds: readonly string[], asOf: LocalDate | null): Promise<ReadonlyMap<string, bigint>> }`
  - `interface AccountView extends Account { currency: string; balance: bigint }`; `toView(account, currency, net?): AccountView`; `withBalances(movements, accounts, currency, asOf): Promise<AccountView[]>`
  - `minorIn(spaceCurrency: string, money: Money): Result<bigint>` (`CurrencyMismatch`)
  - `interface AccountsDeps { accounts: AccountRepository; access: SpaceAccess; movements: AccountMovements; ids: IdGenerator; clock: Clock; tm: TransactionManager }`
  - `createCreateAccount(deps)` → `CreateAccount = (input: { spaceId; userId; name: string; type: AccountType; openingBalance: Money }) => Promise<Result<AccountView>>`
  - `tests/support/in-memory-accounts.ts`: `InMemoryAccounts implements AccountRepository` (public `rows`), `FixedMovements implements AccountMovements` (constructor `(net?: Record<string, bigint>)`, public `asked: (LocalDate | null)[]`)

- [ ] **Step 1: Write the test doubles and the failing tests**

`tests/support/in-memory-accounts.ts`:

```ts
import type { Account, AccountMovements, AccountRepository } from "@/modules/accounts/application";
import type { LocalDate } from "@/shared/kernel";

export class InMemoryAccounts implements AccountRepository {
  rows: Account[] = [];
  async add(account: Account) {
    this.rows.push(account);
  }
  async listBySpace(spaceId: string) {
    return this.rows.filter((a) => a.spaceId === spaceId);
  }
  async findById(accountId: string) {
    return this.rows.find((a) => a.id === accountId) ?? null;
  }
  async save(account: Account) {
    this.rows = this.rows.map((a) => (a.id === account.id ? account : a));
  }
}

/** Fixed net movements per account id; records every `asOf` it was asked for. */
export class FixedMovements implements AccountMovements {
  readonly asked: (LocalDate | null)[] = [];
  constructor(private readonly net: Record<string, bigint> = {}) {}
  async netMovements(accountIds: readonly string[], asOf: LocalDate | null) {
    this.asked.push(asOf);
    return new Map<string, bigint>(accountIds.map((id) => [id, this.net[id] ?? 0n]));
  }
}
```

`src/modules/accounts/domain/account.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { archiveAccount, openAccount, reviseAccount, type Account, type AccountId } from "./account";

const now = new Date("2026-10-12T12:00:00Z");
const open = (overrides: Partial<Parameters<typeof openAccount>[0]> = {}) =>
  openAccount({
    id: "acc-1" as AccountId,
    spaceId: "space-ana",
    spaceKind: "PERSONAL",
    ownerUserId: "u-ana",
    name: "Bancolombia",
    type: "BANK",
    openingBalance: 200_000_000n,
    now,
    siblings: [],
    ...overrides,
  });
const bancolombia: Account = unwrap(open());
const nequi: Account = unwrap(open({ id: "acc-2" as AccountId, name: "Nequi", type: "CASH" }));

describe("opening accounts (HU-E2-01)", () => {
  it("opens a personal account owned by the requester", () => {
    expect(bancolombia).toEqual({
      id: "acc-1",
      spaceId: "space-ana",
      name: "Bancolombia",
      type: "BANK",
      ownerUserId: "u-ana",
      openingBalance: 200_000_000n,
      archivedAt: null,
      createdAt: now,
    });
  });

  it("allows a credit card to start negative", () => {
    expect(unwrap(open({ name: "Visa", type: "CREDIT_CARD", openingBalance: -35_000_000n })).openingBalance).toBe(
      -35_000_000n,
    );
  });

  it("rejects a duplicate name in the space ignoring case", () => {
    expect(codeOf(open({ name: "  bancolombia ", siblings: [bancolombia] }))).toBe("AccountNameTaken");
  });

  it("keeps shared funds in shared spaces and personal types in personal spaces", () => {
    expect(codeOf(open({ type: "SHARED_FUND" }))).toBe("SharedFundRequiresSharedSpace");
    expect(codeOf(open({ spaceKind: "SHARED" }))).toBe("PersonalAccountRequiresPersonalSpace");
    expect(unwrap(open({ spaceKind: "SHARED", type: "SHARED_FUND" })).ownerUserId).toBeNull();
  });

  it.each(["   ", "x".repeat(61)])("rejects the name %j", (name) => {
    expect(codeOf(open({ name }))).toBe("InvalidAccountName");
  });
});

describe("revising and archiving accounts (HU-E2-03)", () => {
  it("corrects the opening balance and renames", () => {
    expect(unwrap(reviseAccount(bancolombia, { openingBalance: 210_000_000n, name: "Bancolombia Ahorros" }, [bancolombia, nequi]))).toMatchObject({
      name: "Bancolombia Ahorros",
      openingBalance: 210_000_000n,
    });
  });

  it("never changes the type", () => {
    expect(codeOf(reviseAccount(bancolombia, { type: "SAVINGS" }, [bancolombia]))).toBe("AccountTypeImmutable");
    expect(codeOf(reviseAccount(bancolombia, { type: "BANK" }, [bancolombia]))).toBe("ok");
  });

  it("rejects renaming onto another account's name", () => {
    expect(codeOf(reviseAccount(bancolombia, { name: "NEQUI" }, [bancolombia, nequi]))).toBe("AccountNameTaken");
  });

  it("archives once and keeps the first archive time", () => {
    const archived = archiveAccount(bancolombia, now);
    expect(archiveAccount(archived, new Date("2027-01-01T00:00:00Z")).archivedAt).toEqual(now);
  });
});
```

`src/modules/accounts/application/create-account.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
import {
  codeOf,
  fakeSpaceAccess,
  memoryTm,
  membership,
  money,
  sequentialIds,
  unwrap,
} from "../../../../tests/support/fakes";
import { FixedMovements, InMemoryAccounts } from "../../../../tests/support/in-memory-accounts";
import { createCreateAccount } from "./create-account";
import type { AccountsDeps } from "./deps";

const asAna = { spaceId: "space-ana", userId: "u-ana" };
const household = membership({ spaceId: "space-household", spaceKind: "SHARED", name: "Household" });
const sofi = membership({ ...household, memberId: "member-sofi", userId: "u-sofi", role: "VIEWER" });

const setup = () => {
  const accounts = new InMemoryAccounts();
  const deps: AccountsDeps = {
    accounts,
    access: fakeSpaceAccess(membership(), household, sofi),
    movements: new FixedMovements(),
    ids: sequentialIds("acc"),
    clock: new FixedClock(new Date("2026-10-12T12:00:00Z")),
    tm: memoryTm,
  };
  return { accounts, create: createCreateAccount(deps) };
};

describe("CreateAccount (HU-E2-01)", () => {
  it("creates a bank account in her personal space, owned by her", async () => {
    const { accounts, create } = setup();
    const view = unwrap(
      await create({ ...asAna, name: "Bancolombia", type: "BANK", openingBalance: money(200_000_000n) }),
    );
    expect(view).toMatchObject({
      spaceId: "space-ana",
      ownerUserId: "u-ana",
      type: "BANK",
      openingBalance: 200_000_000n,
      balance: 200_000_000n,
      currency: "COP",
    });
    expect(accounts.rows).toHaveLength(1);
  });

  it("creates a credit card with a negative opening balance", async () => {
    const { create } = setup();
    const view = unwrap(
      await create({ ...asAna, name: "Visa", type: "CREDIT_CARD", openingBalance: money(-35_000_000n) }),
    );
    expect(view.openingBalance).toBe(-35_000_000n);
  });

  it("rejects a duplicate name in the same space ignoring case", async () => {
    const { create } = setup();
    unwrap(await create({ ...asAna, name: "Bancolombia", type: "BANK", openingBalance: money(0n) }));
    const again = await create({ ...asAna, name: "bancolombia", type: "SAVINGS", openingBalance: money(0n) });
    expect(codeOf(again)).toBe("AccountNameTaken");
  });

  it("rejects a shared fund in a personal space", async () => {
    const { create } = setup();
    const result = await create({ ...asAna, name: "Fund", type: "SHARED_FUND", openingBalance: money(0n) });
    expect(codeOf(result)).toBe("SharedFundRequiresSharedSpace");
  });

  it("rejects personal account types in a shared space", async () => {
    const { create } = setup();
    const result = await create({
      spaceId: "space-household",
      userId: "u-ana",
      name: "Bancolombia",
      type: "BANK",
      openingBalance: money(0n),
    });
    expect(codeOf(result)).toBe("PersonalAccountRequiresPersonalSpace");
  });

  it("rejects an opening balance in another currency", async () => {
    const { create } = setup();
    const result = await create({ ...asAna, name: "Chase", type: "BANK", openingBalance: money(10_000n, "USD") });
    expect(codeOf(result)).toBe("CurrencyMismatch");
  });

  it("forbids viewers and hides other spaces", async () => {
    const { create } = setup();
    const input = { name: "Fund", type: "SHARED_FUND" as const, openingBalance: money(0n) };
    expect(codeOf(await create({ ...input, spaceId: "space-household", userId: "u-sofi" }))).toBe("InsufficientRole");
    expect(codeOf(await create({ ...input, spaceId: "space-ana", userId: "u-luis" }))).toBe("SpaceNotFound");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/accounts`
Expected: FAIL — `Failed to resolve import "./account"` and `"@/modules/accounts/application"`.

- [ ] **Step 3: Implement the domain**

`src/modules/accounts/domain/account.ts`:

```ts
import { domainError, err, ok, type Id, type Result } from "@/shared/kernel";

export type AccountId = Id<"Account">;
export const ACCOUNT_TYPES = ["CASH", "BANK", "CREDIT_CARD", "SAVINGS", "SHARED_FUND"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
type HostSpaceKind = "PERSONAL" | "SHARED" | "DIRECT";

export interface Account {
  readonly id: AccountId;
  readonly spaceId: string;
  readonly name: string;
  readonly type: AccountType;
  /** Null only for SHARED_FUND accounts (HU-E2-02). */
  readonly ownerUserId: string | null;
  /** Minor units of the space currency; may be negative (credit cards). */
  readonly openingBalance: bigint;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
}

const MAX_NAME = 60;

const nameOf = (raw: string): Result<string> => {
  const name = raw.trim();
  return name.length >= 1 && name.length <= MAX_NAME
    ? ok(name)
    : err(domainError("InvalidAccountName", { length: name.length }));
};

/** HU-E2-01: unique per space ignoring case; archived accounts keep their names. */
const nameTaken = (siblings: readonly Account[], name: string, exceptId?: string): boolean =>
  siblings.some((a) => a.id !== exceptId && a.name.toLowerCase() === name.toLowerCase());

export const openAccount = (input: {
  id: AccountId;
  spaceId: string;
  spaceKind: HostSpaceKind;
  ownerUserId: string;
  name: string;
  type: AccountType;
  openingBalance: bigint;
  now: Date;
  siblings: readonly Account[];
}): Result<Account> => {
  const name = nameOf(input.name);
  if (!name.ok) return name;
  // Spec 5.2 and HU-E2-02: SHARED_FUND <=> shared space and no owner; every other type is personal.
  if (input.type === "SHARED_FUND" && input.spaceKind !== "SHARED") {
    return err(domainError("SharedFundRequiresSharedSpace"));
  }
  if (input.type !== "SHARED_FUND" && input.spaceKind !== "PERSONAL") {
    return err(domainError("PersonalAccountRequiresPersonalSpace"));
  }
  if (nameTaken(input.siblings, name.value)) return err(domainError("AccountNameTaken"));
  return ok({
    id: input.id,
    spaceId: input.spaceId,
    name: name.value,
    type: input.type,
    ownerUserId: input.type === "SHARED_FUND" ? null : input.ownerUserId,
    openingBalance: input.openingBalance,
    archivedAt: null,
    createdAt: input.now,
  });
};

/** HU-E2-03: rename or correct the opening balance; the type never changes. */
export const reviseAccount = (
  account: Account,
  change: { readonly name?: string; readonly type?: AccountType; readonly openingBalance?: bigint },
  siblings: readonly Account[],
): Result<Account> => {
  if (change.type !== undefined && change.type !== account.type) return err(domainError("AccountTypeImmutable"));
  const name = change.name === undefined ? ok(account.name) : nameOf(change.name);
  if (!name.ok) return name;
  if (nameTaken(siblings, name.value, account.id)) return err(domainError("AccountNameTaken"));
  return ok({ ...account, name: name.value, openingBalance: change.openingBalance ?? account.openingBalance });
};

/** HU-E2-03: archived accounts keep their history but take no new movements. */
export const archiveAccount = (account: Account, now: Date): Account =>
  account.archivedAt === null ? { ...account, archivedAt: now } : account;
```

- [ ] **Step 4: Implement the application layer**

`src/modules/accounts/application/account-repository.ts`:

```ts
import type { Account } from "../domain/account";

export interface AccountRepository {
  add(account: Account): Promise<void>;
  /** Every account of the space, archived ones included. */
  listBySpace(spaceId: string): Promise<Account[]>;
  /** Any account by id, whatever its space; null for unknown or malformed ids. */
  findById(accountId: string): Promise<Account | null>;
  /** Persists name, opening balance and archive state. */
  save(account: Account): Promise<void>;
}
```

`src/modules/accounts/application/account-movements.ts`:

```ts
import type { LocalDate } from "@/shared/kernel";

/**
 * Net ledger movements per account (HU-E2-04): incomes and transfers in, minus transfers out and
 * payments out; soft-deleted transactions excluded; `asOf` keeps transactions dated on or before it.
 * Bound to the ledger by the composition root.
 */
export interface AccountMovements {
  netMovements(accountIds: readonly string[], asOf: LocalDate | null): Promise<ReadonlyMap<string, bigint>>;
}
```

`src/modules/accounts/application/account-view.ts`:

```ts
import type { LocalDate } from "@/shared/kernel";
import type { Account } from "../domain/account";
import type { AccountMovements } from "./account-movements";

/** An account with its balance computed on read (D7): opening balance plus net movements. */
export interface AccountView extends Account {
  readonly currency: string;
  readonly balance: bigint;
}

export const toView = (account: Account, currency: string, net = 0n): AccountView => ({
  ...account,
  currency,
  balance: account.openingBalance + net,
});

export const withBalances = async (
  movements: AccountMovements,
  accounts: readonly Account[],
  currency: string,
  asOf: LocalDate | null,
): Promise<AccountView[]> => {
  if (accounts.length === 0) return [];
  const net = await movements.netMovements(
    accounts.map((a) => a.id),
    asOf,
  );
  return accounts.map((a) => toView(a, currency, net.get(a.id) ?? 0n));
};
```

`src/modules/accounts/application/currency.ts`:

```ts
import { domainError, err, ok, type Money, type Result } from "@/shared/kernel";

/** D6: one currency per space; amounts in any other currency are rejected. */
export const minorIn = (spaceCurrency: string, money: Money): Result<bigint> =>
  money.currency.code === spaceCurrency
    ? ok(money.minor)
    : err(domainError("CurrencyMismatch", { expected: spaceCurrency, actual: money.currency.code }));
```

`src/modules/accounts/application/deps.ts`:

```ts
import type { SpaceAccess } from "@/modules/spaces/application";
import type { Clock, IdGenerator, TransactionManager } from "@/shared/kernel";
import type { AccountMovements } from "./account-movements";
import type { AccountRepository } from "./account-repository";

export interface AccountsDeps {
  readonly accounts: AccountRepository;
  readonly access: SpaceAccess;
  readonly movements: AccountMovements;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly tm: TransactionManager;
}
```

`src/modules/accounts/application/create-account.ts`:

```ts
import { requireRole, WRITERS } from "@/modules/spaces/application";
import { ok, type Money, type Result } from "@/shared/kernel";
import { openAccount, type AccountType } from "../domain/account";
import { toView, type AccountView } from "./account-view";
import { minorIn } from "./currency";
import type { AccountsDeps } from "./deps";

export interface CreateAccountInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly name: string;
  readonly type: AccountType;
  readonly openingBalance: Money;
}

export type CreateAccount = (input: CreateAccountInput) => Promise<Result<AccountView>>;

export const createCreateAccount =
  (deps: AccountsDeps): CreateAccount =>
  (input) =>
    deps.tm.run(async () => {
      const membership = await deps.access(input.spaceId, input.userId);
      if (!membership.ok) return membership;
      const writer = requireRole(membership.value, WRITERS);
      if (!writer.ok) return writer;
      const space = writer.value;
      const openingBalance = minorIn(space.currency, input.openingBalance);
      if (!openingBalance.ok) return openingBalance;
      const account = openAccount({
        id: deps.ids.next<"Account">(),
        spaceId: space.spaceId,
        spaceKind: space.spaceKind,
        ownerUserId: input.userId,
        name: input.name,
        type: input.type,
        openingBalance: openingBalance.value,
        now: deps.clock.now(),
        siblings: await deps.accounts.listBySpace(space.spaceId),
      });
      if (!account.ok) return account;
      await deps.accounts.add(account.value);
      // A new account has no movements yet.
      return ok(toView(account.value, space.currency));
    });
```

`src/modules/accounts/application/index.ts`:

```ts
export type { Account, AccountId, AccountType } from "../domain/account";
export { ACCOUNT_TYPES } from "../domain/account";
export type { AccountMovements } from "./account-movements";
export type { AccountRepository } from "./account-repository";
export type { AccountView } from "./account-view";
export { createCreateAccount, type CreateAccount, type CreateAccountInput } from "./create-account";
export type { AccountsDeps } from "./deps";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/accounts`
Expected: PASS.

- [ ] **Step 6: Gates**

Run: `pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/modules/accounts tests/support/in-memory-accounts.ts
git commit -m "feat(accounts): open personal accounts with an opening balance (Refs #23)"
```

---

### Task 11: Accounts — edit, archive and list with computed balances

Implements the use cases of HU-E2-03 (issue #25) and HU-E2-04 (issue #26): rename or correct the opening balance (type immutable), archive (kept in history, hidden from active lists), list and get accounts with `balance = openingBalance + net movements`, optionally as of a date. The SQL that computes movements is the ledger's (Task 21); here it is the `AccountMovements` port.

Decision: personal accounts change only by their owner (`InsufficientRole` otherwise); any member may read the account list of their space.

**Files:**
- Create: `src/modules/accounts/application/account-for-change.ts`, `update-account.ts`, `archive-account.ts`, `list-accounts.ts` (all in `src/modules/accounts/application/`)
- Modify: `src/modules/accounts/application/index.ts`
- Test: `src/modules/accounts/application/manage-accounts.test.ts`

**Interfaces:**
- Consumes: `reviseAccount`, `archiveAccount`, `Account` (Task 10); `AccountsDeps`, `withBalances`, `minorIn` (Task 10); `requireRole`, `WRITERS`, `SpaceMembership` (Task 2).
- Produces:
  - `accountForChange(deps, input: { spaceId; userId; accountId }): Promise<Result<{ space: SpaceMembership; account: Account; siblings: Account[] }>>` (`AccountNotFound`, `InsufficientRole`)
  - `createUpdateAccount(deps)` → `UpdateAccount = (input: { spaceId; userId; accountId: string; changes: { name?: string; type?: AccountType; openingBalance?: Money } }) => Promise<Result<AccountView>>`
  - `createArchiveAccount(deps)` → `ArchiveAccount = (input: { spaceId; userId; accountId: string }) => Promise<Result<AccountView>>`
  - `createListAccounts(deps)` → `ListAccounts = (input: { spaceId; userId; includeArchived: boolean; asOf?: LocalDate }) => Promise<Result<AccountView[]>>` (sorted by name)
  - `createGetAccount(deps)` → `GetAccount = (input: { spaceId; userId; accountId: string; asOf?: LocalDate }) => Promise<Result<AccountView>>` (`AccountNotFound`)

- [ ] **Step 1: Write the failing tests**

`src/modules/accounts/application/manage-accounts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock, type LocalDate } from "@/shared/kernel";
import {
  codeOf,
  fakeSpaceAccess,
  memoryTm,
  membership,
  money,
  sequentialIds,
  unwrap,
} from "../../../../tests/support/fakes";
import { FixedMovements, InMemoryAccounts } from "../../../../tests/support/in-memory-accounts";
import type { Account, AccountId } from "../domain/account";
import { createArchiveAccount } from "./archive-account";
import type { AccountsDeps } from "./deps";
import { createGetAccount, createListAccounts } from "./list-accounts";
import { createUpdateAccount } from "./update-account";

const now = new Date("2026-10-12T12:00:00Z");
const asAna = { spaceId: "space-ana", userId: "u-ana" };
const account = (id: string, name: string, overrides: Partial<Account> = {}): Account => ({
  id: id as AccountId,
  spaceId: "space-ana",
  name,
  type: "BANK",
  ownerUserId: "u-ana",
  openingBalance: 200_000_000n,
  archivedAt: null,
  createdAt: now,
  ...overrides,
});

const setup = (net: Record<string, bigint> = {}) => {
  const accounts = new InMemoryAccounts();
  accounts.rows.push(
    account("acc-bancolombia", "Bancolombia"),
    account("acc-nequi", "Nequi", { type: "CASH", openingBalance: 0n }),
    account("acc-davivienda", "Davivienda", { spaceId: "space-juan", ownerUserId: "u-juan" }),
  );
  const movements = new FixedMovements(net);
  const deps: AccountsDeps = {
    accounts,
    access: fakeSpaceAccess(membership()),
    movements,
    ids: sequentialIds("acc"),
    clock: new FixedClock(now),
    tm: memoryTm,
  };
  return {
    accounts,
    movements,
    update: createUpdateAccount(deps),
    archive: createArchiveAccount(deps),
    list: createListAccounts(deps),
    get: createGetAccount(deps),
  };
};

describe("editing and archiving accounts (HU-E2-03)", () => {
  it("corrects the opening balance and recomputes the balance", async () => {
    const { update } = setup();
    const view = unwrap(
      await update({ ...asAna, accountId: "acc-bancolombia", changes: { openingBalance: money(210_000_000n) } }),
    );
    expect(view).toMatchObject({ openingBalance: 210_000_000n, balance: 210_000_000n });
  });

  it("never changes the account type", async () => {
    const { update } = setup();
    const result = await update({ ...asAna, accountId: "acc-bancolombia", changes: { type: "SAVINGS" } });
    expect(codeOf(result)).toBe("AccountTypeImmutable");
  });

  it("rejects renaming onto another account's name and foreign currencies", async () => {
    const { update } = setup();
    expect(codeOf(await update({ ...asAna, accountId: "acc-bancolombia", changes: { name: "nequi" } }))).toBe(
      "AccountNameTaken",
    );
    const usd = await update({ ...asAna, accountId: "acc-bancolombia", changes: { openingBalance: money(1n, "USD") } });
    expect(codeOf(usd)).toBe("CurrencyMismatch");
  });

  it("archives an account, which leaves the active list but stays available", async () => {
    const { archive, list } = setup();
    expect(unwrap(await archive({ ...asAna, accountId: "acc-nequi" })).archivedAt).toEqual(now);
    const active = unwrap(await list({ ...asAna, includeArchived: false }));
    expect(active.map((a) => a.name)).toEqual(["Bancolombia"]);
    const all = unwrap(await list({ ...asAna, includeArchived: true }));
    expect(all.map((a) => a.name)).toEqual(["Bancolombia", "Nequi"]);
  });
});

describe("computed balances (HU-E2-04)", () => {
  it("adds net ledger movements to the opening balance", async () => {
    // income 3,000,000 - expense 85,000 - transfer 500,000 = +2,415,000 on Bancolombia; +500,000 on Nequi
    const { list } = setup({ "acc-bancolombia": 241_500_000n, "acc-nequi": 50_000_000n });
    const views = unwrap(await list({ ...asAna, includeArchived: false }));
    expect(views.map((v) => [v.name, v.balance])).toEqual([
      ["Bancolombia", 441_500_000n],
      ["Nequi", 50_000_000n],
    ]);
  });

  it("passes the as-of date to the ledger", async () => {
    const { get, movements } = setup();
    unwrap(await get({ ...asAna, accountId: "acc-bancolombia", asOf: "2026-10-31" as LocalDate }));
    expect(movements.asked).toEqual(["2026-10-31"]);
  });

  it("reports accounts outside the space as AccountNotFound", async () => {
    const { get, update } = setup();
    expect(codeOf(await get({ ...asAna, accountId: "acc-davivienda" }))).toBe("AccountNotFound");
    expect(codeOf(await update({ ...asAna, accountId: "acc-unknown", changes: { name: "X" } }))).toBe(
      "AccountNotFound",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/accounts/application/manage-accounts.test.ts`
Expected: FAIL — `Failed to resolve import "./archive-account"`.

- [ ] **Step 3: Implement**

`src/modules/accounts/application/account-for-change.ts`:

```ts
import { requireRole, WRITERS, type SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, ok, type Result } from "@/shared/kernel";
import type { Account } from "../domain/account";
import type { AccountsDeps } from "./deps";

/** The account to change, authorized: writers of its space, and only its owner for personal accounts. */
export const accountForChange = async (
  deps: Pick<AccountsDeps, "access" | "accounts">,
  input: { readonly spaceId: string; readonly userId: string; readonly accountId: string },
): Promise<Result<{ space: SpaceMembership; account: Account; siblings: Account[] }>> => {
  const membership = await deps.access(input.spaceId, input.userId);
  if (!membership.ok) return membership;
  const writer = requireRole(membership.value, WRITERS);
  if (!writer.ok) return writer;
  const siblings = await deps.accounts.listBySpace(writer.value.spaceId);
  const account = siblings.find((a) => a.id === input.accountId);
  if (!account) return err(domainError("AccountNotFound"));
  if (account.ownerUserId !== null && account.ownerUserId !== input.userId) {
    return err(domainError("InsufficientRole"));
  }
  return ok({ space: writer.value, account, siblings });
};
```

`src/modules/accounts/application/update-account.ts`:

```ts
import { ok, type Money, type Result } from "@/shared/kernel";
import { reviseAccount, type AccountType } from "../domain/account";
import { accountForChange } from "./account-for-change";
import { withBalances, type AccountView } from "./account-view";
import { minorIn } from "./currency";
import type { AccountsDeps } from "./deps";

export interface AccountChanges {
  readonly name?: string;
  readonly type?: AccountType;
  readonly openingBalance?: Money;
}

export type UpdateAccount = (input: {
  spaceId: string;
  userId: string;
  accountId: string;
  changes: AccountChanges;
}) => Promise<Result<AccountView>>;

export const createUpdateAccount =
  (deps: AccountsDeps): UpdateAccount =>
  (input) =>
    deps.tm.run(async () => {
      const target = await accountForChange(deps, input);
      if (!target.ok) return target;
      const { space, account, siblings } = target.value;
      const { changes } = input;
      const openingBalance =
        changes.openingBalance === undefined ? ok(undefined) : minorIn(space.currency, changes.openingBalance);
      if (!openingBalance.ok) return openingBalance;
      const revised = reviseAccount(
        account,
        { name: changes.name, type: changes.type, openingBalance: openingBalance.value },
        siblings,
      );
      if (!revised.ok) return revised;
      await deps.accounts.save(revised.value);
      const [view] = await withBalances(deps.movements, [revised.value], space.currency, null);
      return ok(view!);
    });
```

`src/modules/accounts/application/archive-account.ts`:

```ts
import { ok, type Result } from "@/shared/kernel";
import { archiveAccount } from "../domain/account";
import { accountForChange } from "./account-for-change";
import { withBalances, type AccountView } from "./account-view";
import type { AccountsDeps } from "./deps";

export type ArchiveAccount = (input: { spaceId: string; userId: string; accountId: string }) => Promise<Result<AccountView>>;

export const createArchiveAccount =
  (deps: AccountsDeps): ArchiveAccount =>
  (input) =>
    deps.tm.run(async () => {
      const target = await accountForChange(deps, input);
      if (!target.ok) return target;
      const archived = archiveAccount(target.value.account, deps.clock.now());
      await deps.accounts.save(archived);
      const [view] = await withBalances(deps.movements, [archived], target.value.space.currency, null);
      return ok(view!);
    });
```

`src/modules/accounts/application/list-accounts.ts`:

```ts
import { domainError, err, ok, type LocalDate, type Result } from "@/shared/kernel";
import { withBalances, type AccountView } from "./account-view";
import type { AccountsDeps } from "./deps";

export type ListAccounts = (input: {
  spaceId: string;
  userId: string;
  includeArchived: boolean;
  asOf?: LocalDate;
}) => Promise<Result<AccountView[]>>;

export type GetAccount = (input: {
  spaceId: string;
  userId: string;
  accountId: string;
  asOf?: LocalDate;
}) => Promise<Result<AccountView>>;

/** HU-E2-03/04: archived accounts only on request; balances computed on read (D7). */
export const createListAccounts =
  (deps: AccountsDeps): ListAccounts =>
  async (input) => {
    const membership = await deps.access(input.spaceId, input.userId);
    if (!membership.ok) return membership;
    const accounts = (await deps.accounts.listBySpace(membership.value.spaceId))
      .filter((a) => input.includeArchived || a.archivedAt === null)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    return ok(await withBalances(deps.movements, accounts, membership.value.currency, input.asOf ?? null));
  };

export const createGetAccount =
  (deps: AccountsDeps): GetAccount =>
  async (input) => {
    const membership = await deps.access(input.spaceId, input.userId);
    if (!membership.ok) return membership;
    const account = (await deps.accounts.listBySpace(membership.value.spaceId)).find((a) => a.id === input.accountId);
    if (!account) return err(domainError("AccountNotFound"));
    const [view] = await withBalances(deps.movements, [account], membership.value.currency, input.asOf ?? null);
    return ok(view!);
  };
```

In `src/modules/accounts/application/index.ts`, add:

```ts
export { createArchiveAccount, type ArchiveAccount } from "./archive-account";
export { createGetAccount, createListAccounts, type GetAccount, type ListAccounts } from "./list-accounts";
export { createUpdateAccount, type AccountChanges, type UpdateAccount } from "./update-account";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/accounts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/accounts/application
git commit -m "feat(accounts): edit, archive and list accounts with computed balances (Refs #25, Refs #26)"
```

---

### Task 12: Accounts — table and migration 0004

Schema-only task (HU-E2-01, HU-E2-03).

**Files:**
- Create: `src/modules/accounts/infrastructure/accounts.schema.ts`
- Create (generated): `drizzle/0004_accounts.sql`, `drizzle/meta/0004_snapshot.json`; Modify (generated): `drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: `spaces` (M0 spaces schema), `user` (M0 auth schema).
- Produces: table `accounts` (`accounts`) with unique index `accounts_space_name_uq (space_id, lower(name))` and check `accounts_shared_fund_owner` (`(type = 'SHARED_FUND') = (owner_user_id IS NULL)`). Not to be confused with Better Auth's `account` table (credentials), which is singular.

- [ ] **Step 1: Write the schema**

`src/modules/accounts/infrastructure/accounts.schema.ts`:

```ts
import { sql } from "drizzle-orm";
import { bigint, check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "@/modules/identity/infrastructure/auth.schema";
import { spaces } from "@/modules/spaces/infrastructure/spaces.schema";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// Money accounts of a space (spec 5.2). Better Auth's credential table is the singular "account".
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Same values as ACCOUNT_TYPES in the domain; listed here so drizzle-kit loads no domain code.
    type: text("type", { enum: ["CASH", "BANK", "CREDIT_CARD", "SAVINGS", "SHARED_FUND"] }).notNull(),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "cascade" }),
    openingBalance: bigint("opening_balance", { mode: "bigint" }).notNull(),
    archivedAt: tz("archived_at"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("accounts_space_name_uq").on(t.spaceId, sql`lower(${t.name})`),
    check("accounts_shared_fund_owner", sql`(${t.type} = 'SHARED_FUND') = (${t.ownerUserId} IS NULL)`),
  ],
);
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate --name accounts`
Expected: `drizzle/0004_accounts.sql` creating `accounts` with the check constraint, foreign keys to `spaces` (cascade) and `user` (cascade) and the unique index; `drizzle/meta/0004_snapshot.json`; a `0004_accounts` journal entry.

- [ ] **Step 3: Verify migrations and drift**

Run: `pnpm db:check && pnpm exec vitest run --project integration src/shared/infrastructure/db/migrations.int.test.ts`
Expected: "No schema drift" and PASS.

- [ ] **Step 4: Gates**

Run: `pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/modules/accounts/infrastructure/accounts.schema.ts drizzle/0004_accounts.sql drizzle/meta/0004_snapshot.json drizzle/meta/_journal.json
git commit -m "feat(accounts): add the accounts table with migration (Refs #23)"
```

---

### Task 13: Accounts — Drizzle repository

Implements `AccountRepository` (HU-E2-01, HU-E2-03). Pins Review Focus 4 (malformed ids return null) and exact `bigint` round-trips at the extremes.

**Files:**
- Create: `src/modules/accounts/infrastructure/drizzle-account-repository.ts`
- Test: `src/modules/accounts/infrastructure/drizzle-account-repository.int.test.ts`

**Interfaces:**
- Consumes: `AccountRepository`, `Account`, `AccountId` (Task 10); `accounts` table (Task 12); `personalSpaceFixture`, `SpaceFixture` (Task 9); `isUuid` (Task 1).
- Produces: `class DrizzleAccountRepository implements AccountRepository` (constructor `(tm: DrizzleTransactionManager)`).

- [ ] **Step 1: Write the failing integration test**

`src/modules/accounts/infrastructure/drizzle-account-repository.int.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { testDatabase } from "../../../../tests/support/database";
import { personalSpaceFixture, type SpaceFixture } from "../../../../tests/support/fixtures";
import type { Account, AccountId } from "../domain/account";
import { DrizzleAccountRepository } from "./drizzle-account-repository";

const { db, pool } = testDatabase();
const repo = new DrizzleAccountRepository(new DrizzleTransactionManager(db));
const account = (space: SpaceFixture, overrides: Partial<Account> = {}): Account => ({
  id: randomUUID() as AccountId,
  spaceId: space.spaceId,
  name: "Bancolombia",
  type: "BANK",
  ownerUserId: space.userId,
  openingBalance: 200_000_000n,
  archivedAt: null,
  createdAt: new Date("2026-10-12T12:00:00Z"),
  ...overrides,
});

afterAll(() => pool.end());

describe("DrizzleAccountRepository", () => {
  it("stores, finds and lists accounts with exact bigint opening balances", async () => {
    const space = await personalSpaceFixture(db, pool);
    const bank = account(space);
    const card = account(space, { name: "Visa", type: "CREDIT_CARD", openingBalance: -35_000_000n });
    const huge = account(space, { name: "Huge", type: "SAVINGS", openingBalance: 9_223_372_036_854_775_807n });
    for (const a of [bank, card, huge]) await repo.add(a);
    expect(await repo.findById(bank.id)).toEqual(bank);
    expect(await repo.findById(huge.id)).toEqual(huge);
    expect(await repo.listBySpace(space.spaceId)).toEqual(expect.arrayContaining([bank, card, huge]));
  });

  it("returns null for unknown and malformed ids", async () => {
    expect(await repo.findById(randomUUID())).toBeNull();
    expect(await repo.findById("not-a-uuid")).toBeNull();
  });

  it("saves name, opening balance and archive state", async () => {
    const space = await personalSpaceFixture(db, pool);
    const bank = account(space);
    await repo.add(bank);
    const archivedAt = new Date("2026-10-20T00:00:00Z");
    await repo.save({ ...bank, name: "Bancolombia Ahorros", openingBalance: 210_000_000n, archivedAt });
    expect(await repo.findById(bank.id)).toEqual({
      ...bank,
      name: "Bancolombia Ahorros",
      openingBalance: 210_000_000n,
      archivedAt,
    });
  });

  it("enforces unique names per space ignoring case, but not across spaces", async () => {
    const ana = await personalSpaceFixture(db, pool);
    const juan = await personalSpaceFixture(db, pool, "Juan");
    await repo.add(account(ana));
    await expect(repo.add(account(ana, { name: "BANCOLOMBIA" }))).rejects.toThrow();
    await expect(repo.add(account(juan))).resolves.toBeUndefined();
  });

  it("requires an owner for every account type except SHARED_FUND", async () => {
    const space = await personalSpaceFixture(db, pool);
    await expect(repo.add(account(space, { ownerUserId: null }))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project integration src/modules/accounts`
Expected: FAIL — `Failed to resolve import "./drizzle-account-repository"`.

- [ ] **Step 3: Implement**

`src/modules/accounts/infrastructure/drizzle-account-repository.ts`:

```ts
import { eq } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid } from "@/shared/kernel";
import type { AccountRepository } from "../application/account-repository";
import type { Account, AccountId } from "../domain/account";
import { accounts } from "./accounts.schema";

const toAccount = (row: typeof accounts.$inferSelect): Account => ({ ...row, id: row.id as AccountId });

export class DrizzleAccountRepository implements AccountRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async add(account: Account): Promise<void> {
    await this.tm.executor().insert(accounts).values({
      id: account.id,
      spaceId: account.spaceId,
      name: account.name,
      type: account.type,
      ownerUserId: account.ownerUserId,
      openingBalance: account.openingBalance,
      archivedAt: account.archivedAt,
      createdAt: account.createdAt,
    });
  }

  async listBySpace(spaceId: string): Promise<Account[]> {
    const rows = await this.tm.executor().select().from(accounts).where(eq(accounts.spaceId, spaceId));
    return rows.map(toAccount);
  }

  async findById(accountId: string): Promise<Account | null> {
    // Ids come from request bodies and URLs; anything that is not a UUID would fail the uuid cast.
    if (!isUuid(accountId)) return null;
    const [row] = await this.tm.executor().select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
    return row ? toAccount(row) : null;
  }

  async save(account: Account): Promise<void> {
    await this.tm
      .executor()
      .update(accounts)
      .set({ name: account.name, openingBalance: account.openingBalance, archivedAt: account.archivedAt })
      .where(eq(accounts.id, account.id));
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project integration src/modules/accounts`
Expected: PASS (5 tests).

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/accounts/infrastructure/drizzle-account-repository.ts src/modules/accounts/infrastructure/drizzle-account-repository.int.test.ts
git commit -m "feat(accounts): persist accounts with a Drizzle repository (Refs #23, Refs #25)"
```

---

### Task 14: Ledger — Transaction aggregate

Implements the domain of HU-E4-01 … HU-E4-03 and HU-E4-06 (issues #30, #31, #32, #35): the `Transaction` aggregate owns its payments and shares and enforces Σ payments = Σ shares = amount (`SharesDoNotMatchAmount`); a personal expense is a shared expense with one participant (D2).

Decisions:
- `description` is optional (empty string when absent), at most 200 characters (`InvalidDescription`).
- Income requires a category: spec 5.2 makes `categoryId` nullable only for transfers and settlements.
- Editable fields in M1 are description, date, category and amount. When the amount changes, a *sole* payment or share follows it; with several shares the parts must still add up (story scenario 2). Editing payers, participants or accounts arrives with M2 split editing.
- Audit entries are written for edits and deletes; creation is recorded by `createdBy`/`createdAt` on the row (D8). Changed values are stored as strings so `bigint`s survive JSON.
- Who may change a transaction: OWNER and ADMIN any; MEMBER only their own; VIEWER none (HU-E4-06 scenario 4).

**Files:**
- Create: `src/modules/ledger/domain/transaction.ts`
- Test: `src/modules/ledger/domain/transaction.test.ts`

**Interfaces:**
- Consumes: `Id`, `LocalDate`, `Result`, `domainError`, `ok`, `err` (kernel); `codeOf`, `unwrap` (Task 2, tests).
- Produces:
  - `type TransactionId = Id<"Transaction">`; `type TransactionType = "EXPENSE" | "INCOME" | "TRANSFER"`; `type SplitMethod = "EQUAL" | "PERCENT" | "EXACT" | "SHARES" | "BY_ALLOCATION"`
  - `interface Payment { memberId: string | null; accountId: string | null; amount: bigint }`; `interface Share { memberId: string; amount: bigint; splitMethod: SplitMethod }`
  - `Expense` (`type: "EXPENSE"`, `categoryId: string`, `payments`, `shares`), `Income` (`categoryId: string`, `destinationAccountId`, `receivingMemberId`), `Transfer` (`categoryId: null`, `sourceAccountId`, `destinationAccountId`), all with `id, spaceId, description, date: LocalDate, amount: bigint, currency, createdBy, createdAt, updatedAt, deletedAt: Date | null, version: number`; `type Transaction = Expense | Income | Transfer`
  - `positiveAmount(amount: bigint): Result<bigint>` (`InvalidAmount`)
  - `recordExpense(input)`, `recordIncome(input)`, `recordTransfer(input)` → `Result<Expense | Income | Transfer>` (`InvalidAmount`, `InvalidDescription`, `ParticipantsRequired`, `PaymentsRequired`, `SharesDoNotMatchAmount`, `SameAccountTransfer`)
  - `interface TransactionChanges { description?: string; date?: LocalDate; categoryId?: string; amount?: bigint }`; `reviseTransaction(tx, changes, now): Result<Transaction>` (`TransferHasNoCategory`); `softDelete(tx, now): Transaction`
  - `type ChangeSet = Readonly<Record<string, { from: string | null; to: string | null }>>`; `changesBetween(before, after): ChangeSet`
  - `canModify(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" | null, createdBy: string, userId: string): boolean`

- [ ] **Step 1: Write the failing tests**

`src/modules/ledger/domain/transaction.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import {
  canModify,
  changesBetween,
  recordExpense,
  recordIncome,
  recordTransfer,
  reviseTransaction,
  softDelete,
  type Expense,
  type TransactionId,
} from "./transaction";

const now = new Date("2026-10-05T15:00:00Z");
const later = new Date("2026-10-06T09:00:00Z");
const common = {
  id: "tx-1" as TransactionId,
  spaceId: "space-ana",
  description: "Market",
  date: "2026-10-05" as LocalDate,
  currency: "COP",
  createdBy: "u-ana",
  now,
};
const personal = (amount: bigint) =>
  recordExpense({
    ...common,
    amount,
    categoryId: "cat-groceries",
    payments: [{ memberId: "member-ana", accountId: "acc-bancolombia", amount }],
    shares: [{ memberId: "member-ana", amount, splitMethod: "EQUAL" }],
  });
const shared = () =>
  unwrap(
    recordExpense({
      ...common,
      amount: 30_000_000n,
      categoryId: "cat-groceries",
      payments: [{ memberId: "member-ana", accountId: "acc-bancolombia", amount: 30_000_000n }],
      shares: [
        { memberId: "member-ana", amount: 15_000_000n, splitMethod: "EQUAL" },
        { memberId: "member-juan", amount: 15_000_000n, splitMethod: "EQUAL" },
      ],
    }),
  );

describe("recording transactions", () => {
  it("records a personal expense with one payment and one share for the whole amount (HU-E4-01)", () => {
    expect(unwrap(personal(8_500_000n))).toEqual({
      id: "tx-1",
      spaceId: "space-ana",
      type: "EXPENSE",
      description: "Market",
      date: "2026-10-05",
      amount: 8_500_000n,
      currency: "COP",
      categoryId: "cat-groceries",
      payments: [{ memberId: "member-ana", accountId: "acc-bancolombia", amount: 8_500_000n }],
      shares: [{ memberId: "member-ana", amount: 8_500_000n, splitMethod: "EQUAL" }],
      createdBy: "u-ana",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1,
    });
  });

  it.each([0n, -1_000_000n])("rejects the amount %s", (amount) => {
    expect(codeOf(personal(amount))).toBe("InvalidAmount");
  });

  it("records the largest bigint amount exactly", () => {
    expect(unwrap(personal(9_223_372_036_854_775_807n)).amount).toBe(9_223_372_036_854_775_807n);
  });

  it("keeps payments, shares and amount equal", () => {
    const result = recordExpense({
      ...common,
      amount: 8_500_000n,
      categoryId: "cat-groceries",
      payments: [{ memberId: "member-ana", accountId: "acc-bancolombia", amount: 8_500_000n }],
      shares: [{ memberId: "member-ana", amount: 8_000_000n, splitMethod: "EQUAL" }],
    });
    expect(codeOf(result)).toBe("SharesDoNotMatchAmount");
  });

  it("requires at least one participant", () => {
    const result = recordExpense({
      ...common,
      amount: 100n,
      categoryId: "cat-groceries",
      payments: [{ memberId: "member-ana", accountId: "acc-bancolombia", amount: 100n }],
      shares: [],
    });
    expect(codeOf(result)).toBe("ParticipantsRequired");
  });

  it("rejects descriptions longer than 200 characters", () => {
    expect(codeOf(recordTransfer({ ...common, description: "x".repeat(201), amount: 1n, sourceAccountId: "a", destinationAccountId: "b" }))).toBe(
      "InvalidDescription",
    );
  });

  it("records income into an account for the receiving member (HU-E4-02)", () => {
    const income = unwrap(
      recordIncome({ ...common, amount: 320_000_000n, categoryId: "cat-salary", destinationAccountId: "acc-bancolombia", receivingMemberId: "member-ana" }),
    );
    expect(income).toMatchObject({ type: "INCOME", destinationAccountId: "acc-bancolombia", receivingMemberId: "member-ana" });
  });

  it("records transfers without category and never to the same account (HU-E4-03)", () => {
    const transfer = unwrap(recordTransfer({ ...common, amount: 50_000_000n, sourceAccountId: "acc-bancolombia", destinationAccountId: "acc-nequi" }));
    expect(transfer).toMatchObject({ type: "TRANSFER", categoryId: null });
    expect(codeOf(recordTransfer({ ...common, amount: 50_000_000n, sourceAccountId: "acc-bancolombia", destinationAccountId: "acc-bancolombia" }))).toBe(
      "SameAccountTransfer",
    );
  });
});

describe("editing and deleting (HU-E4-06)", () => {
  it("lets a sole payment and share follow a new amount", () => {
    const edited = unwrap(reviseTransaction(unwrap(personal(8_500_000n)), { amount: 9_500_000n }, later)) as Expense;
    expect(edited).toMatchObject({ amount: 9_500_000n, updatedAt: later, version: 1 });
    expect(edited.payments.map((p) => p.amount)).toEqual([9_500_000n]);
    expect(edited.shares.map((s) => s.amount)).toEqual([9_500_000n]);
  });

  it("rejects an amount that no longer matches several shares", () => {
    expect(codeOf(reviseTransaction(shared(), { amount: 32_000_000n }, later))).toBe("SharesDoNotMatchAmount");
  });

  it("never gives a transfer a category", () => {
    const transfer = unwrap(recordTransfer({ ...common, amount: 1n, sourceAccountId: "a", destinationAccountId: "b" }));
    expect(codeOf(reviseTransaction(transfer, { categoryId: "cat-groceries" }, later))).toBe("TransferHasNoCategory");
  });

  it("describes audited changes as strings", () => {
    const before = unwrap(personal(8_500_000n));
    const after = unwrap(reviseTransaction(before, { amount: 9_500_000n, date: "2026-11-02" as LocalDate }, later));
    expect(changesBetween(before, after)).toEqual({
      date: { from: "2026-10-05", to: "2026-11-02" },
      amount: { from: "8500000", to: "9500000" },
    });
    expect(changesBetween(before, before)).toEqual({});
  });

  it("soft-deletes by setting deletedAt", () => {
    expect(softDelete(unwrap(personal(100n)), later)).toMatchObject({ deletedAt: later, updatedAt: later });
  });

  it.each([
    ["u-ana", "OWNER", true],
    ["u-luis", "ADMIN", true],
    ["u-ana", "MEMBER", true],
    ["u-luis", "MEMBER", false],
    ["u-ana", "VIEWER", false],
    ["u-luis", null, false],
  ] as const)("lets %s with role %s change a transaction created by u-ana: %s", (userId, role, allowed) => {
    expect(canModify(role, "u-ana", userId)).toBe(allowed);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: FAIL — `Failed to resolve import "./transaction"`.

- [ ] **Step 3: Implement**

`src/modules/ledger/domain/transaction.ts`:

```ts
import { domainError, err, ok, type Id, type LocalDate, type Result } from "@/shared/kernel";

export type TransactionId = Id<"Transaction">;
export type TransactionType = "EXPENSE" | "INCOME" | "TRANSFER";
export type SplitMethod = "EQUAL" | "PERCENT" | "EXACT" | "SHARES" | "BY_ALLOCATION";
type MemberRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

/** Spec 5.2: memberId is null only for SHARED_FUND payments; accountId only for guest payers (M2). */
export interface Payment {
  readonly memberId: string | null;
  readonly accountId: string | null;
  readonly amount: bigint;
}

export interface Share {
  readonly memberId: string;
  readonly amount: bigint;
  readonly splitMethod: SplitMethod;
}

interface TransactionBase {
  readonly id: TransactionId;
  readonly spaceId: string;
  readonly description: string;
  /** Calendar date in the space timezone; its period is derived on read (HU-E4-04). */
  readonly date: LocalDate;
  readonly amount: bigint;
  readonly currency: string;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
  /** Optimistic-concurrency version, exposed as the ETag. */
  readonly version: number;
}

export interface Expense extends TransactionBase {
  readonly type: "EXPENSE";
  readonly categoryId: string;
  readonly payments: readonly Payment[];
  readonly shares: readonly Share[];
}

export interface Income extends TransactionBase {
  readonly type: "INCOME";
  readonly categoryId: string;
  readonly destinationAccountId: string;
  readonly receivingMemberId: string;
}

export interface Transfer extends TransactionBase {
  readonly type: "TRANSFER";
  readonly categoryId: null;
  readonly sourceAccountId: string;
  readonly destinationAccountId: string;
}

export type Transaction = Expense | Income | Transfer;

export interface TransactionChanges {
  readonly description?: string;
  readonly date?: LocalDate;
  readonly categoryId?: string;
  readonly amount?: bigint;
}

/** Audited field changes; values are strings so bigints survive JSON. */
export type ChangeSet = Readonly<Record<string, { readonly from: string | null; readonly to: string | null }>>;

const MAX_DESCRIPTION = 200;

export const positiveAmount = (amount: bigint): Result<bigint> =>
  amount > 0n ? ok(amount) : err(domainError("InvalidAmount", { amount: amount.toString() }));

const descriptionOf = (raw: string | undefined): Result<string> => {
  const text = (raw ?? "").trim();
  return text.length <= MAX_DESCRIPTION
    ? ok(text)
    : err(domainError("InvalidDescription", { length: text.length }));
};

const sum = (amounts: readonly bigint[]): bigint => amounts.reduce((a, b) => a + b, 0n);

/** Spec 5.2 shared invariant: Σ payments = Σ shares = amount, every part positive. */
const checkParts = (amount: bigint, payments: readonly Payment[], shares: readonly Share[]): Result<void> => {
  if (shares.length === 0) return err(domainError("ParticipantsRequired"));
  if (payments.length === 0) return err(domainError("PaymentsRequired"));
  if ([...payments, ...shares].some((part) => part.amount <= 0n)) return err(domainError("InvalidAmount"));
  if (sum(payments.map((p) => p.amount)) !== amount || sum(shares.map((s) => s.amount)) !== amount) {
    return err(domainError("SharesDoNotMatchAmount"));
  }
  return ok(undefined);
};

interface NewTransaction {
  readonly id: TransactionId;
  readonly spaceId: string;
  readonly description?: string;
  readonly date: LocalDate;
  readonly amount: bigint;
  readonly currency: string;
  readonly createdBy: string;
  readonly now: Date;
}

const baseOf = (input: NewTransaction): Result<TransactionBase> => {
  const amount = positiveAmount(input.amount);
  if (!amount.ok) return amount;
  const description = descriptionOf(input.description);
  if (!description.ok) return description;
  return ok({
    id: input.id,
    spaceId: input.spaceId,
    description: description.value,
    date: input.date,
    amount: amount.value,
    currency: input.currency,
    createdBy: input.createdBy,
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
    version: 1,
  });
};

export const recordExpense = (
  input: NewTransaction & {
    readonly categoryId: string;
    readonly payments: readonly Payment[];
    readonly shares: readonly Share[];
  },
): Result<Expense> => {
  const base = baseOf(input);
  if (!base.ok) return base;
  const parts = checkParts(base.value.amount, input.payments, input.shares);
  if (!parts.ok) return parts;
  return ok({
    ...base.value,
    type: "EXPENSE" as const,
    categoryId: input.categoryId,
    payments: input.payments,
    shares: input.shares,
  });
};

export const recordIncome = (
  input: NewTransaction & {
    readonly categoryId: string;
    readonly destinationAccountId: string;
    readonly receivingMemberId: string;
  },
): Result<Income> => {
  const base = baseOf(input);
  if (!base.ok) return base;
  return ok({
    ...base.value,
    type: "INCOME" as const,
    categoryId: input.categoryId,
    destinationAccountId: input.destinationAccountId,
    receivingMemberId: input.receivingMemberId,
  });
};

export const recordTransfer = (
  input: NewTransaction & { readonly sourceAccountId: string; readonly destinationAccountId: string },
): Result<Transfer> => {
  const base = baseOf(input);
  if (!base.ok) return base;
  if (input.sourceAccountId === input.destinationAccountId) return err(domainError("SameAccountTransfer"));
  return ok({
    ...base.value,
    type: "TRANSFER" as const,
    categoryId: null,
    sourceAccountId: input.sourceAccountId,
    destinationAccountId: input.destinationAccountId,
  });
};

/** HU-E4-06: a sole payment or share follows a new amount; otherwise the parts must still add up. */
export const reviseTransaction = (tx: Transaction, changes: TransactionChanges, now: Date): Result<Transaction> => {
  const description = changes.description === undefined ? ok(tx.description) : descriptionOf(changes.description);
  if (!description.ok) return description;
  const amount = changes.amount === undefined ? ok(tx.amount) : positiveAmount(changes.amount);
  if (!amount.ok) return amount;
  const common = { description: description.value, date: changes.date ?? tx.date, amount: amount.value, updatedAt: now };
  switch (tx.type) {
    case "EXPENSE": {
      const payments = tx.payments.length === 1 ? [{ ...tx.payments[0]!, amount: amount.value }] : tx.payments;
      const shares = tx.shares.length === 1 ? [{ ...tx.shares[0]!, amount: amount.value }] : tx.shares;
      const parts = checkParts(amount.value, payments, shares);
      if (!parts.ok) return parts;
      return ok({ ...tx, ...common, categoryId: changes.categoryId ?? tx.categoryId, payments, shares });
    }
    case "INCOME":
      return ok({ ...tx, ...common, categoryId: changes.categoryId ?? tx.categoryId });
    case "TRANSFER":
      return changes.categoryId === undefined ? ok({ ...tx, ...common }) : err(domainError("TransferHasNoCategory"));
  }
};

/** D8: transactions are never hard-deleted. */
export const softDelete = (tx: Transaction, now: Date): Transaction => ({ ...tx, deletedAt: now, updatedAt: now });

const AUDITED = ["description", "date", "categoryId", "amount"] as const;

export const changesBetween = (before: Transaction, after: Transaction): ChangeSet => {
  const changes: Record<string, { from: string | null; to: string | null }> = {};
  for (const field of AUDITED) {
    const from = before[field] === null ? null : String(before[field]);
    const to = after[field] === null ? null : String(after[field]);
    if (from !== to) changes[field] = { from, to };
  }
  return changes;
};

/** HU-E4-06: owners and admins change any transaction, members only their own, viewers none. */
export const canModify = (role: MemberRole | null, createdBy: string, userId: string): boolean =>
  role === "OWNER" || role === "ADMIN" || (role === "MEMBER" && createdBy === userId);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/domain
git commit -m "feat(ledger): add the transaction aggregate with payments, shares and audited edits (Refs #30, Refs #35)"
```

---

### Task 15: Ledger — ports and RecordExpense

Implements HU-E4-01 (issue #30) at use-case level, plus the archived-account rule of HU-E2-03 and the archived-category rule of HU-E3-03 as they apply to new expenses. Defines every ledger port up front so `LedgerDeps` stays stable for Tasks 16–18.

Decisions:
- M1 request shape: `accountId` (the requester's own account) instead of `payments[]`/`split`; the use case builds one payment by the requester and one `EQUAL` share for them. M2 (HU-E4-07) adds the general shape to the same endpoint.
- `date` defaults to today in the space timezone. Spaces have no timezone field in the spec; v1 uses the deployment timezone `APP_TIMEZONE` (default `America/Bogota`).
- The paying account must be owned by the requester (`AccountNotOwned`, D9), whichever space it lives in; this is what makes HU-E4-07's "pay a shared expense from my personal account" work later.
- `ClosedPeriodGuard` is checked on record too; it is always open until HU-E6-07 (M3).
- Check order: membership → role → amount → currency → category → account → closed period, so each story scenario gets its own code.

**Files:**
- Create: `src/modules/ledger/application/ports.ts`, `deps.ts`, `checks.ts`, `record-expense.ts`, `index.ts` (all in `src/modules/ledger/application/`)
- Create: `tests/support/in-memory-ledger.ts`
- Test: `src/modules/ledger/application/record-expense.test.ts`

**Interfaces:**
- Consumes: `recordExpense`, `positiveAmount`, `Transaction`, `ChangeSet`, `TransactionType` (Task 14); `SpaceAccess`, `SpaceMembership`, `StoredPeriodSource`, `requireRole`, `WRITERS` (Task 2); `todayIn`, `Money`, `LocalDate`, `Clock`, `IdGenerator`, `TransactionManager` (kernel).
- Produces:
  - `interface LedgerAccount { id; spaceId; ownerUserId: string | null; archived: boolean }`; `interface AccountReader { find(accountId: string): Promise<LedgerAccount | null> }`
  - `interface LedgerCategory { id; archived: boolean }`; `interface CategoryReader { find(spaceId: string, categoryId: string): Promise<LedgerCategory | null> }`
  - `interface ClosedPeriodGuard { isClosed(spaceId: string, date: LocalDate): Promise<boolean> }`
  - `interface TransactionRepository { add(tx): Promise<void>; findById(spaceId: string, transactionId: string, includeDeleted?: boolean): Promise<Transaction | null>; save(tx, expectedVersion: number): Promise<boolean> }`
  - `interface AuditEntry { id: string; transactionId: string; action: "UPDATED" | "DELETED"; actorUserId: string; at: Date; changes: ChangeSet }`; `interface AuditLog { append(entry): Promise<void>; listFor(transactionId: string): Promise<AuditEntry[]> }`
  - `interface TransactionFilter { spaceId; from: LocalDate; to: LocalDate; categoryIds?: readonly string[]; payerMemberId?: string; participantMemberId?: string; type?: TransactionType }`; `interface TransactionPosition { date: LocalDate; id: string }`; `interface TransactionQuery { list(filter, after: TransactionPosition | null, limit: number): Promise<Transaction[]>; totals(filter): Promise<{ expenses: bigint; income: bigint }> }`
  - `interface LedgerDeps { access; transactions; query; audit; accounts; categories; closedPeriods; storedPeriods; ids; clock; timeZone: string; tm }`
  - `authorizeWriter`, `inSpaceCurrency`, `usableCategory`, `ownAccount`, `accountInSpace`, `openPeriod` (checks.ts)
  - `createRecordExpense(deps)` → `RecordExpense = (input: { spaceId; userId; description?: string; date?: LocalDate; categoryId?: string; amount: Money; accountId: string }) => Promise<Result<Expense>>` (`SpaceNotFound`, `InsufficientRole`, `InvalidAmount`, `CurrencyMismatch`, `CategoryRequired`, `CategoryNotFound`, `CategoryArchived`, `AccountNotFound`, `AccountNotOwned`, `AccountArchived`, `PeriodClosed`)
  - `tests/support/in-memory-ledger.ts`: `ACCOUNTS`, `CATEGORIES`, `InMemoryTransactions` (public `rows`), `InMemoryAudit` (public `entries`), `ledgerFixture(overrides?: Partial<LedgerDeps>) → { deps, store, audit }`

- [ ] **Step 1: Write the ports (types only) so the test doubles compile**

`src/modules/ledger/application/ports.ts`:

```ts
import type { LocalDate } from "@/shared/kernel";
import type { ChangeSet, Transaction, TransactionType } from "../domain/transaction";

/** What the ledger needs to know about an account; bound to the accounts module. */
export interface LedgerAccount {
  readonly id: string;
  readonly spaceId: string;
  readonly ownerUserId: string | null;
  readonly archived: boolean;
}

export interface AccountReader {
  /** Any account by id, whatever its space; null for unknown or malformed ids. */
  find(accountId: string): Promise<LedgerAccount | null>;
}

export interface LedgerCategory {
  readonly id: string;
  readonly archived: boolean;
}

export interface CategoryReader {
  /** A category of the given space, archived ones included; null otherwise. */
  find(spaceId: string, categoryId: string): Promise<LedgerCategory | null>;
}

/** HU-E4-06: transactions in a CLOSED plan period never change. Always open until HU-E6-07. */
export interface ClosedPeriodGuard {
  isClosed(spaceId: string, date: LocalDate): Promise<boolean>;
}

export interface TransactionRepository {
  add(transaction: Transaction): Promise<void>;
  /** A transaction of the space; soft-deleted ones only when asked; null for unknown or malformed ids. */
  findById(spaceId: string, transactionId: string, includeDeleted?: boolean): Promise<Transaction | null>;
  /** Writes `transaction` as version `expectedVersion + 1` only if the stored version is `expectedVersion`. */
  save(transaction: Transaction, expectedVersion: number): Promise<boolean>;
}

export interface AuditEntry {
  readonly id: string;
  readonly transactionId: string;
  readonly action: "UPDATED" | "DELETED";
  readonly actorUserId: string;
  readonly at: Date;
  readonly changes: ChangeSet;
}

export interface AuditLog {
  append(entry: AuditEntry): Promise<void>;
  /** Oldest first. */
  listFor(transactionId: string): Promise<AuditEntry[]>;
}

export interface TransactionFilter {
  readonly spaceId: string;
  readonly from: LocalDate;
  readonly to: LocalDate;
  readonly categoryIds?: readonly string[];
  readonly payerMemberId?: string;
  readonly participantMemberId?: string;
  readonly type?: TransactionType;
}

/** Keyset position in the newest-first order (date desc, id desc). */
export interface TransactionPosition {
  readonly date: LocalDate;
  readonly id: string;
}

export interface TransactionQuery {
  /** Live matching transactions, newest first, strictly after `after`, at most `limit`. */
  list(filter: TransactionFilter, after: TransactionPosition | null, limit: number): Promise<Transaction[]>;
  /** Σ EXPENSE and Σ INCOME amounts of every live matching transaction; transfers are not spending. */
  totals(filter: TransactionFilter): Promise<{ expenses: bigint; income: bigint }>;
}
```

`src/modules/ledger/application/deps.ts`:

```ts
import type { SpaceAccess, StoredPeriodSource } from "@/modules/spaces/application";
import type { Clock, IdGenerator, TransactionManager } from "@/shared/kernel";
import type {
  AccountReader,
  AuditLog,
  CategoryReader,
  ClosedPeriodGuard,
  TransactionQuery,
  TransactionRepository,
} from "./ports";

export interface LedgerDeps {
  readonly access: SpaceAccess;
  readonly transactions: TransactionRepository;
  readonly query: TransactionQuery;
  readonly audit: AuditLog;
  readonly accounts: AccountReader;
  readonly categories: CategoryReader;
  readonly closedPeriods: ClosedPeriodGuard;
  readonly storedPeriods: StoredPeriodSource;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** The space timezone; v1 uses the deployment timezone (APP_TIMEZONE). */
  readonly timeZone: string;
  readonly tm: TransactionManager;
}
```

`src/modules/ledger/application/index.ts`:

```ts
export type {
  ChangeSet,
  Expense,
  Income,
  Payment,
  Share,
  SplitMethod,
  Transaction,
  TransactionId,
  TransactionType,
  Transfer,
} from "../domain/transaction";
export type { LedgerDeps } from "./deps";
export type {
  AccountReader,
  AuditEntry,
  AuditLog,
  CategoryReader,
  ClosedPeriodGuard,
  LedgerAccount,
  LedgerCategory,
  TransactionFilter,
  TransactionPosition,
  TransactionQuery,
  TransactionRepository,
} from "./ports";
export { createRecordExpense, type RecordExpense, type RecordExpenseInput } from "./record-expense";
```

- [ ] **Step 2: Write the in-memory ledger and the failing tests**

`tests/support/in-memory-ledger.ts`:

```ts
import type {
  AccountReader,
  AuditEntry,
  AuditLog,
  CategoryReader,
  LedgerAccount,
  LedgerDeps,
  Transaction,
  TransactionFilter,
  TransactionPosition,
  TransactionQuery,
  TransactionRepository,
} from "@/modules/ledger/application";
import { FixedClock } from "@/shared/kernel";
import { fakeSpaceAccess, memoryTm, membership, noStoredPeriods, sequentialIds } from "./fakes";

export const ACCOUNTS = {
  bancolombia: { id: "acc-bancolombia", spaceId: "space-ana", ownerUserId: "u-ana", archived: false },
  nequi: { id: "acc-nequi", spaceId: "space-ana", ownerUserId: "u-ana", archived: false },
  oldNequi: { id: "acc-old-nequi", spaceId: "space-ana", ownerUserId: "u-ana", archived: true },
  davivienda: { id: "acc-davivienda", spaceId: "space-juan", ownerUserId: "u-juan", archived: false },
} satisfies Record<string, LedgerAccount>;

interface CategoryRow {
  readonly id: string;
  readonly spaceId: string;
  readonly archived: boolean;
}

export const CATEGORIES = {
  groceries: { id: "cat-groceries", spaceId: "space-ana", archived: false },
  restaurants: { id: "cat-restaurants", spaceId: "space-ana", archived: false },
  salary: { id: "cat-salary", spaceId: "space-ana", archived: false },
  archived: { id: "cat-archived", spaceId: "space-ana", archived: true },
  juanFood: { id: "cat-juan-food", spaceId: "space-juan", archived: false },
} satisfies Record<string, CategoryRow>;

const accountReader = (accounts: readonly LedgerAccount[]): AccountReader => ({
  find: async (id) => accounts.find((a) => a.id === id) ?? null,
});

const categoryReader = (rows: readonly CategoryRow[]): CategoryReader => ({
  find: async (spaceId, id) => {
    const row = rows.find((r) => r.spaceId === spaceId && r.id === id);
    return row ? { id: row.id, archived: row.archived } : null;
  },
});

/** Repository and query side over one array; mirrors the SQL semantics pinned in Tasks 20–21. */
export class InMemoryTransactions implements TransactionRepository, TransactionQuery {
  rows: Transaction[] = [];

  async add(transaction: Transaction) {
    this.rows.push(transaction);
  }

  async findById(spaceId: string, transactionId: string, includeDeleted = false) {
    return (
      this.rows.find(
        (t) => t.id === transactionId && t.spaceId === spaceId && (includeDeleted || t.deletedAt === null),
      ) ?? null
    );
  }

  async save(transaction: Transaction, expectedVersion: number) {
    const index = this.rows.findIndex((t) => t.id === transaction.id);
    if (index < 0 || this.rows[index]!.version !== expectedVersion) return false;
    this.rows[index] = { ...transaction, version: expectedVersion + 1 };
    return true;
  }

  async list(filter: TransactionFilter, after: TransactionPosition | null, limit: number) {
    return this.matching(filter)
      .filter((t) => after === null || t.date < after.date || (t.date === after.date && t.id < after.id))
      .slice(0, limit);
  }

  async totals(filter: TransactionFilter) {
    const rows = this.matching(filter);
    const total = (type: Transaction["type"]) =>
      rows.filter((t) => t.type === type).reduce((sum, t) => sum + t.amount, 0n);
    return { expenses: total("EXPENSE"), income: total("INCOME") };
  }

  private matching(f: TransactionFilter): Transaction[] {
    return this.rows
      .filter((t) => t.spaceId === f.spaceId && t.deletedAt === null && t.date >= f.from && t.date <= f.to)
      .filter((t) => f.type === undefined || t.type === f.type)
      .filter((t) => !f.categoryIds?.length || (t.categoryId !== null && f.categoryIds.includes(t.categoryId)))
      .filter(
        (t) =>
          f.payerMemberId === undefined ||
          (t.type === "EXPENSE" && t.payments.some((p) => p.memberId === f.payerMemberId)),
      )
      .filter(
        (t) =>
          f.participantMemberId === undefined ||
          (t.type === "EXPENSE" && t.shares.some((s) => s.memberId === f.participantMemberId)),
      )
      .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
  }
}

export class InMemoryAudit implements AuditLog {
  readonly entries: AuditEntry[] = [];
  async append(entry: AuditEntry) {
    this.entries.push(entry);
  }
  async listFor(transactionId: string) {
    return this.entries.filter((e) => e.transactionId === transactionId);
  }
}

/** Ana (OWNER) in her personal space: COP, MONTHLY(1), today 2026-10-28 in Bogotá. */
export const ledgerFixture = (overrides: Partial<LedgerDeps> = {}) => {
  const store = new InMemoryTransactions();
  const audit = new InMemoryAudit();
  const deps: LedgerDeps = {
    access: fakeSpaceAccess(membership()),
    transactions: store,
    query: store,
    audit,
    accounts: accountReader(Object.values(ACCOUNTS)),
    categories: categoryReader(Object.values(CATEGORIES)),
    closedPeriods: { isClosed: async () => false },
    storedPeriods: noStoredPeriods,
    ids: sequentialIds("tx"),
    clock: new FixedClock(new Date("2026-10-28T15:00:00Z")),
    timeZone: "America/Bogota",
    tm: memoryTm,
    ...overrides,
  };
  return { deps, store, audit };
};
```

`src/modules/ledger/application/record-expense.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock, type LocalDate } from "@/shared/kernel";
import { codeOf, fakeSpaceAccess, membership, money } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import { createRecordExpense, type RecordExpenseInput } from "./record-expense";

const market: RecordExpenseInput = {
  spaceId: "space-ana",
  userId: "u-ana",
  description: "Market",
  date: "2026-10-05" as LocalDate,
  categoryId: CATEGORIES.groceries.id,
  amount: money(8_500_000n),
  accountId: ACCOUNTS.bancolombia.id,
};

describe("RecordExpense (HU-E4-01)", () => {
  it("records an expense with one payment and one share for the payer", async () => {
    const { deps, store } = ledgerFixture();
    expect(codeOf(await createRecordExpense(deps)(market))).toBe("ok");
    expect(store.rows).toEqual([
      expect.objectContaining({
        type: "EXPENSE",
        spaceId: "space-ana",
        amount: 8_500_000n,
        currency: "COP",
        date: "2026-10-05",
        description: "Market",
        categoryId: "cat-groceries",
        createdBy: "u-ana",
        version: 1,
        payments: [{ memberId: "member-ana", accountId: "acc-bancolombia", amount: 8_500_000n }],
        shares: [{ memberId: "member-ana", amount: 8_500_000n, splitMethod: "EQUAL" }],
      }),
    ]);
  });

  it("defaults the date to today in the space timezone", async () => {
    const { deps, store } = ledgerFixture({ clock: new FixedClock(new Date("2026-11-01T04:30:00Z")) });
    await createRecordExpense(deps)({ ...market, date: undefined });
    expect(store.rows[0]?.date).toBe("2026-10-31");
  });

  it.each([0n, -1_000_000n])("rejects the amount %s with InvalidAmount", async (minor) => {
    const { deps, store } = ledgerFixture();
    expect(codeOf(await createRecordExpense(deps)({ ...market, amount: money(minor) }))).toBe("InvalidAmount");
    expect(store.rows).toEqual([]);
  });

  it("requires a category", async () => {
    const { deps } = ledgerFixture();
    expect(codeOf(await createRecordExpense(deps)({ ...market, categoryId: undefined }))).toBe("CategoryRequired");
  });

  it("rejects paying from another user's account", async () => {
    const { deps } = ledgerFixture();
    expect(codeOf(await createRecordExpense(deps)({ ...market, accountId: ACCOUNTS.davivienda.id }))).toBe(
      "AccountNotOwned",
    );
  });

  it("rejects an archived account (HU-E2-03)", async () => {
    const { deps } = ledgerFixture();
    expect(codeOf(await createRecordExpense(deps)({ ...market, accountId: ACCOUNTS.oldNequi.id }))).toBe(
      "AccountArchived",
    );
  });

  it("rejects an archived category (HU-E3-03)", async () => {
    const { deps } = ledgerFixture();
    expect(codeOf(await createRecordExpense(deps)({ ...market, categoryId: CATEGORIES.archived.id }))).toBe(
      "CategoryArchived",
    );
  });

  it("rejects categories of other spaces and unknown accounts", async () => {
    const { deps } = ledgerFixture();
    const record = createRecordExpense(deps);
    expect(codeOf(await record({ ...market, categoryId: CATEGORIES.juanFood.id }))).toBe("CategoryNotFound");
    expect(codeOf(await record({ ...market, accountId: "acc-unknown" }))).toBe("AccountNotFound");
  });

  it("rejects a currency other than the space currency", async () => {
    const { deps } = ledgerFixture();
    expect(codeOf(await createRecordExpense(deps)({ ...market, amount: money(100n, "USD") }))).toBe(
      "CurrencyMismatch",
    );
  });

  it("forbids viewers and hides other spaces", async () => {
    const viewer = ledgerFixture({ access: fakeSpaceAccess(membership({ role: "VIEWER" })) });
    expect(codeOf(await createRecordExpense(viewer.deps)(market))).toBe("InsufficientRole");
    const { deps } = ledgerFixture();
    expect(codeOf(await createRecordExpense(deps)({ ...market, userId: "u-luis" }))).toBe("SpaceNotFound");
  });

  it("rejects a date in a closed period", async () => {
    const { deps } = ledgerFixture({ closedPeriods: { isClosed: async () => true } });
    expect(codeOf(await createRecordExpense(deps)(market))).toBe("PeriodClosed");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/application`
Expected: FAIL — `Failed to resolve import "./record-expense"`.

- [ ] **Step 4: Implement the checks and the use case**

`src/modules/ledger/application/checks.ts`:

```ts
import { requireRole, WRITERS, type SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, flatMap, ok, type LocalDate, type Money, type Result } from "@/shared/kernel";
import type { LedgerDeps } from "./deps";
import type { LedgerAccount } from "./ports";

/** Members with role MEMBER or above record money movements. */
export const authorizeWriter = async (
  deps: Pick<LedgerDeps, "access">,
  spaceId: string,
  userId: string,
): Promise<Result<SpaceMembership>> => flatMap(await deps.access(spaceId, userId), (m) => requireRole(m, WRITERS));

/** D6: amounts are in the space currency. */
export const inSpaceCurrency = (space: SpaceMembership, money: Money): Result<Money> =>
  money.currency.code === space.currency
    ? ok(money)
    : err(domainError("CurrencyMismatch", { expected: space.currency, actual: money.currency.code }));

/** HU-E4-01 / HU-E3-03: a category of the space that is not archived. */
export const usableCategory = async (
  deps: Pick<LedgerDeps, "categories">,
  spaceId: string,
  categoryId: string | null | undefined,
): Promise<Result<string>> => {
  if (categoryId === undefined || categoryId === null) return err(domainError("CategoryRequired"));
  const category = await deps.categories.find(spaceId, categoryId);
  if (category === null) return err(domainError("CategoryNotFound"));
  return category.archived ? err(domainError("CategoryArchived")) : ok(category.id);
};

/** D9: registered members move money only through accounts they own; archived accounts take no new movements. */
export const ownAccount = async (
  deps: Pick<LedgerDeps, "accounts">,
  accountId: string,
  userId: string,
): Promise<Result<LedgerAccount>> => {
  const account = await deps.accounts.find(accountId);
  if (account === null) return err(domainError("AccountNotFound"));
  if (account.ownerUserId !== userId) return err(domainError("AccountNotOwned"));
  return account.archived ? err(domainError("AccountArchived")) : ok(account);
};

/** HU-E4-02/03: income and own transfers stay inside the transaction's space. */
export const accountInSpace = (account: LedgerAccount, spaceId: string): Result<LedgerAccount> =>
  account.spaceId === spaceId ? ok(account) : err(domainError("AccountNotInSpace"));

export const openPeriod = async (
  deps: Pick<LedgerDeps, "closedPeriods">,
  spaceId: string,
  date: LocalDate,
): Promise<Result<void>> =>
  (await deps.closedPeriods.isClosed(spaceId, date)) ? err(domainError("PeriodClosed")) : ok(undefined);
```

`src/modules/ledger/application/record-expense.ts`:

```ts
import { todayIn, type LocalDate, type Money, type Result } from "@/shared/kernel";
import { positiveAmount, recordExpense, type Expense } from "../domain/transaction";
import { authorizeWriter, inSpaceCurrency, openPeriod, ownAccount, usableCategory } from "./checks";
import type { LedgerDeps } from "./deps";

export interface RecordExpenseInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly date?: LocalDate;
  readonly categoryId?: string;
  readonly amount: Money;
  /** The requester's own account the money left from. */
  readonly accountId: string;
}

export type RecordExpense = (input: RecordExpenseInput) => Promise<Result<Expense>>;

/**
 * HU-E4-01: a personal expense is a shared expense with one participant (D2): one payment by the
 * requester from their own account and one EQUAL share for them. HU-E4-07 adds payments[] and splits.
 */
export const createRecordExpense =
  (deps: LedgerDeps): RecordExpense =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeWriter(deps, input.spaceId, input.userId);
      if (!writer.ok) return writer;
      const space = writer.value;
      const amount = positiveAmount(input.amount.minor);
      if (!amount.ok) return amount;
      const currency = inSpaceCurrency(space, input.amount);
      if (!currency.ok) return currency;
      const category = await usableCategory(deps, space.spaceId, input.categoryId);
      if (!category.ok) return category;
      const account = await ownAccount(deps, input.accountId, input.userId);
      if (!account.ok) return account;
      const date = input.date ?? todayIn(deps.clock, deps.timeZone);
      const open = await openPeriod(deps, space.spaceId, date);
      if (!open.ok) return open;
      const expense = recordExpense({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: amount.value,
        currency: space.currency,
        createdBy: input.userId,
        now: deps.clock.now(),
        categoryId: category.value,
        payments: [{ memberId: space.memberId, accountId: account.value.id, amount: amount.value }],
        shares: [{ memberId: space.memberId, amount: amount.value, splitMethod: "EQUAL" }],
      });
      if (!expense.ok) return expense;
      await deps.transactions.add(expense.value);
      return expense;
    });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: PASS.

- [ ] **Step 6: Gates**

Run: `pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/modules/ledger/application tests/support/in-memory-ledger.ts
git commit -m "feat(ledger): record personal expenses through the ledger ports (Refs #30)"
```

---

### Task 16: Ledger — RecordIncome and RecordTransfer

Implements HU-E4-02 (issue #31) and HU-E4-03 (issue #32) at use-case level. Transfers to a `SHARED_FUND` are fund contributions (HU-E4-09, M2); in M1 such a destination fails ownership (`AccountNotOwned`) because shared funds have no owner.

**Files:**
- Create: `src/modules/ledger/application/record-income.ts`, `src/modules/ledger/application/record-transfer.ts`
- Modify: `src/modules/ledger/application/index.ts`
- Test: `src/modules/ledger/application/record-income-and-transfer.test.ts`

**Interfaces:**
- Consumes: `recordIncome`, `recordTransfer`, `positiveAmount` (Task 14); `LedgerDeps`, checks (Task 15); `ledgerFixture`, `ACCOUNTS`, `CATEGORIES` (Task 15).
- Produces:
  - `createRecordIncome(deps)` → `RecordIncome = (input: { spaceId; userId; description?; date?: LocalDate; categoryId?: string; amount: Money; accountId: string }) => Promise<Result<Income>>` (adds `AccountNotInSpace`)
  - `createRecordTransfer(deps)` → `RecordTransfer = (input: { spaceId; userId; description?; date?: LocalDate; amount: Money; sourceAccountId: string; destinationAccountId: string }) => Promise<Result<Transfer>>` (adds `SameAccountTransfer`)

- [ ] **Step 1: Write the failing tests**

`src/modules/ledger/application/record-income-and-transfer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, fakeSpaceAccess, membership, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import { createRecordIncome, type RecordIncomeInput } from "./record-income";
import { createRecordTransfer, type RecordTransferInput } from "./record-transfer";

const salary: RecordIncomeInput = {
  spaceId: "space-ana",
  userId: "u-ana",
  description: "Salary October",
  date: "2026-10-25" as LocalDate,
  categoryId: CATEGORIES.salary.id,
  amount: money(320_000_000n),
  accountId: ACCOUNTS.bancolombia.id,
};

const toWallet: RecordTransferInput = {
  spaceId: "space-ana",
  userId: "u-ana",
  date: "2026-10-06" as LocalDate,
  amount: money(50_000_000n),
  sourceAccountId: ACCOUNTS.bancolombia.id,
  destinationAccountId: ACCOUNTS.nequi.id,
};

describe("RecordIncome (HU-E4-02)", () => {
  it("records a salary into her account with her as receiving member", async () => {
    const { deps } = ledgerFixture();
    expect(unwrap(await createRecordIncome(deps)(salary))).toMatchObject({
      type: "INCOME",
      amount: 320_000_000n,
      destinationAccountId: "acc-bancolombia",
      receivingMemberId: "member-ana",
      categoryId: "cat-salary",
    });
  });

  it("rejects an archived account", async () => {
    const { deps } = ledgerFixture();
    expect(codeOf(await createRecordIncome(deps)({ ...salary, accountId: ACCOUNTS.oldNequi.id }))).toBe(
      "AccountArchived",
    );
  });

  it("rejects an account outside the transaction's space", async () => {
    const household = membership({ spaceId: "space-household", spaceKind: "SHARED", name: "Household" });
    const { deps } = ledgerFixture({
      access: fakeSpaceAccess(household),
      categories: { find: async (spaceId, id) => (spaceId === "space-household" ? { id, archived: false } : null) },
    });
    expect(codeOf(await createRecordIncome(deps)({ ...salary, spaceId: "space-household" }))).toBe(
      "AccountNotInSpace",
    );
  });

  it("requires a category and a positive amount", async () => {
    const { deps } = ledgerFixture();
    const record = createRecordIncome(deps);
    expect(codeOf(await record({ ...salary, categoryId: undefined }))).toBe("CategoryRequired");
    expect(codeOf(await record({ ...salary, amount: money(0n) }))).toBe("InvalidAmount");
  });
});

describe("RecordTransfer (HU-E4-03)", () => {
  it("moves money between her accounts without a category", async () => {
    const { deps } = ledgerFixture();
    expect(unwrap(await createRecordTransfer(deps)(toWallet))).toMatchObject({
      type: "TRANSFER",
      amount: 50_000_000n,
      categoryId: null,
      sourceAccountId: "acc-bancolombia",
      destinationAccountId: "acc-nequi",
    });
  });

  it("rejects the same account as source and destination", async () => {
    const { deps } = ledgerFixture();
    const result = await createRecordTransfer(deps)({ ...toWallet, destinationAccountId: ACCOUNTS.bancolombia.id });
    expect(codeOf(result)).toBe("SameAccountTransfer");
  });

  it("rejects a destination owned by another user", async () => {
    const { deps } = ledgerFixture();
    const result = await createRecordTransfer(deps)({ ...toWallet, destinationAccountId: ACCOUNTS.davivienda.id });
    expect(codeOf(result)).toBe("AccountNotOwned");
  });

  it("rejects archived accounts on either side", async () => {
    const { deps } = ledgerFixture();
    const transfer = createRecordTransfer(deps);
    expect(codeOf(await transfer({ ...toWallet, destinationAccountId: ACCOUNTS.oldNequi.id }))).toBe("AccountArchived");
    expect(codeOf(await transfer({ ...toWallet, sourceAccountId: ACCOUNTS.oldNequi.id }))).toBe("AccountArchived");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/record-income-and-transfer.test.ts`
Expected: FAIL — `Failed to resolve import "./record-income"`.

- [ ] **Step 3: Implement**

`src/modules/ledger/application/record-income.ts`:

```ts
import { flatMap, todayIn, type LocalDate, type Money, type Result } from "@/shared/kernel";
import { positiveAmount, recordIncome, type Income } from "../domain/transaction";
import { accountInSpace, authorizeWriter, inSpaceCurrency, openPeriod, ownAccount, usableCategory } from "./checks";
import type { LedgerDeps } from "./deps";

export interface RecordIncomeInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly date?: LocalDate;
  readonly categoryId?: string;
  readonly amount: Money;
  /** The requester's own account in this space that receives the money. */
  readonly accountId: string;
}

export type RecordIncome = (input: RecordIncomeInput) => Promise<Result<Income>>;

export const createRecordIncome =
  (deps: LedgerDeps): RecordIncome =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeWriter(deps, input.spaceId, input.userId);
      if (!writer.ok) return writer;
      const space = writer.value;
      const amount = positiveAmount(input.amount.minor);
      if (!amount.ok) return amount;
      const currency = inSpaceCurrency(space, input.amount);
      if (!currency.ok) return currency;
      const category = await usableCategory(deps, space.spaceId, input.categoryId);
      if (!category.ok) return category;
      const account = flatMap(await ownAccount(deps, input.accountId, input.userId), (a) =>
        accountInSpace(a, space.spaceId),
      );
      if (!account.ok) return account;
      const date = input.date ?? todayIn(deps.clock, deps.timeZone);
      const open = await openPeriod(deps, space.spaceId, date);
      if (!open.ok) return open;
      const income = recordIncome({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: amount.value,
        currency: space.currency,
        createdBy: input.userId,
        now: deps.clock.now(),
        categoryId: category.value,
        destinationAccountId: account.value.id,
        receivingMemberId: space.memberId,
      });
      if (!income.ok) return income;
      await deps.transactions.add(income.value);
      return income;
    });
```

`src/modules/ledger/application/record-transfer.ts`:

```ts
import { domainError, err, flatMap, todayIn, type LocalDate, type Money, type Result } from "@/shared/kernel";
import { positiveAmount, recordTransfer, type Transfer } from "../domain/transaction";
import { accountInSpace, authorizeWriter, inSpaceCurrency, openPeriod, ownAccount } from "./checks";
import type { LedgerDeps } from "./deps";

export interface RecordTransferInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly date?: LocalDate;
  readonly amount: Money;
  readonly sourceAccountId: string;
  readonly destinationAccountId: string;
}

export type RecordTransfer = (input: RecordTransferInput) => Promise<Result<Transfer>>;

/** HU-E4-03: moves money between the requester's own accounts; never spending. */
export const createRecordTransfer =
  (deps: LedgerDeps): RecordTransfer =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeWriter(deps, input.spaceId, input.userId);
      if (!writer.ok) return writer;
      const space = writer.value;
      const amount = positiveAmount(input.amount.minor);
      if (!amount.ok) return amount;
      const currency = inSpaceCurrency(space, input.amount);
      if (!currency.ok) return currency;
      if (input.sourceAccountId === input.destinationAccountId) return err(domainError("SameAccountTransfer"));
      const usable = async (accountId: string) =>
        flatMap(await ownAccount(deps, accountId, input.userId), (a) => accountInSpace(a, space.spaceId));
      const source = await usable(input.sourceAccountId);
      if (!source.ok) return source;
      const destination = await usable(input.destinationAccountId);
      if (!destination.ok) return destination;
      const date = input.date ?? todayIn(deps.clock, deps.timeZone);
      const open = await openPeriod(deps, space.spaceId, date);
      if (!open.ok) return open;
      const transfer = recordTransfer({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: amount.value,
        currency: space.currency,
        createdBy: input.userId,
        now: deps.clock.now(),
        sourceAccountId: source.value.id,
        destinationAccountId: destination.value.id,
      });
      if (!transfer.ok) return transfer;
      await deps.transactions.add(transfer.value);
      return transfer;
    });
```

In `src/modules/ledger/application/index.ts`, add:

```ts
export { createRecordIncome, type RecordIncome, type RecordIncomeInput } from "./record-income";
export { createRecordTransfer, type RecordTransfer, type RecordTransferInput } from "./record-transfer";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/application
git commit -m "feat(ledger): record income and transfers between own accounts (Refs #31, Refs #32)"
```

---

### Task 17: Ledger — list transactions by period and get one

Implements HU-E4-04 (issue #33) and HU-E4-05 (issue #34) at use-case level: the monthly view resolves the requested period label (default: the current period in the space timezone) against the space policy and stored plan boundaries, applies filters, pages newest first and returns expense and income totals over the whole filtered period. Also covers the "income/transfer do not count as spending" scenarios of HU-E4-02 and HU-E4-03.

Decision: totals respect the filters (story: "2 transactions are listed with a total of 185,000 COP"). The member filters take `SpaceMember` ids; the story's member-filter scenario becomes reachable over HTTP in M2 but the filter works now (pinned here and in SQL in Task 21).

**Files:**
- Create: `src/modules/ledger/application/list-transactions.ts`, `src/modules/ledger/application/get-transaction.ts`
- Modify: `src/modules/ledger/application/index.ts`, `tests/support/in-memory-ledger.ts` (builders)
- Test: `src/modules/ledger/application/list-transactions.test.ts`

**Interfaces:**
- Consumes: `resolvePeriod`, `periodByLabel`, `todayIn`, `Period` (Task 1, kernel); `LedgerDeps`, `TransactionFilter`, `TransactionPosition` (Task 15).
- Produces:
  - `interface ListTransactionsInput { spaceId; userId; period?: string; categoryIds?: readonly string[]; payerMemberId?: string; participantMemberId?: string; type?: TransactionType; after: TransactionPosition | null; limit: number }`
  - `interface TransactionPage { period: Period; currency: string; totals: { expenses: bigint; income: bigint }; items: readonly Transaction[]; nextPosition: TransactionPosition | null }`
  - `createListTransactions(deps)` → `ListTransactions = (input: ListTransactionsInput) => Promise<Result<TransactionPage>>` (`SpaceNotFound`, `InvalidPeriodLabel`)
  - `createGetTransaction(deps)` → `GetTransaction = (input: { spaceId; userId; transactionId: string }) => Promise<Result<Transaction>>` (`TransactionNotFound`)
  - `tests/support/in-memory-ledger.ts`: `anExpense(date, amount, overrides?)`, `anIncome(date, amount, overrides?)`, `aTransfer(date, amount, overrides?)` (ids `seed-00001`, … increasing)

- [ ] **Step 1: Add the transaction builders**

In `tests/support/in-memory-ledger.ts`, extend the type import from `@/modules/ledger/application` with `Expense`, `Income`, `TransactionId`, `Transfer`, change the kernel import to `import { FixedClock, type LocalDate } from "@/shared/kernel";`, and append:

```ts
let seeded = 0;

/** Increasing ids, so for equal dates "newest first" means the highest id, like UUIDv7 in production. */
const baseOf = (date: string, amount: bigint) => ({
  id: `seed-${String(++seeded).padStart(5, "0")}` as TransactionId,
  spaceId: "space-ana",
  description: "",
  date: date as LocalDate,
  amount,
  currency: "COP",
  createdBy: "u-ana",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  deletedAt: null,
  version: 1,
});

export const anExpense = (date: string, amount: bigint, overrides: Partial<Expense> = {}): Expense => ({
  ...baseOf(date, amount),
  type: "EXPENSE",
  categoryId: CATEGORIES.groceries.id,
  payments: [{ memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount }],
  shares: [{ memberId: "member-ana", amount, splitMethod: "EQUAL" }],
  ...overrides,
});

export const anIncome = (date: string, amount: bigint, overrides: Partial<Income> = {}): Income => ({
  ...baseOf(date, amount),
  type: "INCOME",
  categoryId: CATEGORIES.salary.id,
  destinationAccountId: ACCOUNTS.bancolombia.id,
  receivingMemberId: "member-ana",
  ...overrides,
});

export const aTransfer = (date: string, amount: bigint, overrides: Partial<Transfer> = {}): Transfer => ({
  ...baseOf(date, amount),
  type: "TRANSFER",
  categoryId: null,
  sourceAccountId: ACCOUNTS.bancolombia.id,
  destinationAccountId: ACCOUNTS.nequi.id,
  ...overrides,
});
```

- [ ] **Step 2: Write the failing tests**

`src/modules/ledger/application/list-transactions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PeriodPolicy } from "@/shared/kernel";
import { codeOf, fakeSpaceAccess, membership, unwrap } from "../../../../tests/support/fakes";
import {
  aTransfer,
  anExpense,
  anIncome,
  CATEGORIES,
  ledgerFixture,
} from "../../../../tests/support/in-memory-ledger";
import type { LedgerDeps } from "./deps";
import { createGetTransaction } from "./get-transaction";
import { createListTransactions, type ListTransactionsInput } from "./list-transactions";
import type { TransactionPosition } from "./ports";

const list = (deps: LedgerDeps, extra: Partial<ListTransactionsInput> = {}) =>
  createListTransactions(deps)({ spaceId: "space-ana", userId: "u-ana", after: null, limit: 50, ...extra });
const withPolicy = (periodPolicy: PeriodPolicy) =>
  ledgerFixture({ access: fakeSpaceAccess(membership({ periodPolicy })) });
const october = () => [
  anExpense("2026-10-05", 8_500_000n, { description: "Market" }),
  anExpense("2026-10-12", 10_000_000n, { description: "Market" }),
  anExpense("2026-10-15", 6_000_000n, { description: "Dinner", categoryId: CATEGORIES.restaurants.id }),
  anIncome("2026-10-25", 320_000_000n, { description: "Salary" }),
];

describe("ListTransactions (HU-E4-05)", () => {
  it("returns the current period newest first with expense and income totals", async () => {
    const { deps, store } = ledgerFixture(); // today is 2026-10-28 in Bogotá
    store.rows.push(...october());
    const page = unwrap(await list(deps));
    expect(page.period).toEqual({ start: "2026-10-01", end: "2026-10-31", label: "2026-10" });
    expect(page.items.map((t) => t.date)).toEqual(["2026-10-25", "2026-10-15", "2026-10-12", "2026-10-05"]);
    expect(page.totals).toEqual({ expenses: 24_500_000n, income: 320_000_000n });
    expect(page.currency).toBe("COP");
  });

  it("filters by category, totals included", async () => {
    const { deps, store } = ledgerFixture();
    store.rows.push(...october());
    const page = unwrap(await list(deps, { period: "2026-10", categoryIds: [CATEGORIES.groceries.id] }));
    expect(page.items).toHaveLength(2);
    expect(page.totals.expenses).toBe(18_500_000n);
  });

  it("hides soft-deleted transactions", async () => {
    const { deps, store } = ledgerFixture();
    const rows = october();
    rows[2] = { ...rows[2]!, deletedAt: new Date() };
    store.rows.push(...rows);
    expect(unwrap(await list(deps, { period: "2026-10" })).items).toHaveLength(3);
  });

  it("pages through 120 transactions 50 at a time", async () => {
    const { deps, store } = ledgerFixture();
    for (let n = 0; n < 120; n++) {
      store.rows.push(anExpense(`2026-10-${String((n % 28) + 1).padStart(2, "0")}`, 100n));
    }
    const sizes: number[] = [];
    const seen = new Set<string>();
    let after: TransactionPosition | null = null;
    do {
      const page = unwrap(await list(deps, { period: "2026-10", after }));
      sizes.push(page.items.length);
      page.items.forEach((t) => seen.add(t.id));
      after = page.nextPosition;
    } while (after);
    expect(sizes).toEqual([50, 50, 20]);
    expect(seen.size).toBe(120);
  });

  it("filters by payer and participant member", async () => {
    const { deps, store } = ledgerFixture();
    const juanPays = anExpense("2026-10-10", 10_000_000n, {
      payments: [{ memberId: "member-juan", accountId: null, amount: 10_000_000n }],
      shares: [
        { memberId: "member-ana", amount: 5_000_000n, splitMethod: "EQUAL" },
        { memberId: "member-juan", amount: 5_000_000n, splitMethod: "EQUAL" },
      ],
    });
    store.rows.push(anExpense("2026-10-09", 30_000_000n), juanPays);
    const ids = async (extra: Partial<ListTransactionsInput>) =>
      unwrap(await list(deps, { period: "2026-10", ...extra })).items.map((t) => t.id);
    expect(await ids({ payerMemberId: "member-juan" })).toEqual([juanPays.id]);
    expect(await ids({ participantMemberId: "member-juan" })).toEqual([juanPays.id]);
  });

  it("never counts income or transfers as spending (HU-E4-02, HU-E4-03)", async () => {
    const { deps, store } = ledgerFixture();
    store.rows.push(
      anIncome("2026-10-25", 320_000_000n),
      anExpense("2026-10-05", 8_500_000n),
      aTransfer("2026-10-06", 50_000_000n),
    );
    const page = unwrap(await list(deps, { period: "2026-10" }));
    expect(page.totals.expenses).toBe(8_500_000n);
    expect(page.items).toHaveLength(3);
    expect(page.items.find((t) => t.type === "TRANSFER")?.categoryId).toBeNull();
  });

  it("rejects an unknown period label and hides other spaces", async () => {
    const { deps } = ledgerFixture();
    expect(codeOf(await list(deps, { period: "2026-13" }))).toBe("InvalidPeriodLabel");
    expect(codeOf(await list(deps, { userId: "u-luis" }))).toBe("SpaceNotFound");
  });
});

describe("period assignment (HU-E4-04)", () => {
  it("MONTHLY(1): 2026-10 holds October 31 but not November 1", async () => {
    const { deps, store } = withPolicy({ kind: "MONTHLY", day: 1 });
    store.rows.push(anExpense("2026-10-31", 8_500_000n), anExpense("2026-11-01", 4_000_000n));
    const page = unwrap(await list(deps, { period: "2026-10" }));
    expect(page.period).toEqual({ start: "2026-10-01", end: "2026-10-31", label: "2026-10" });
    expect(page.totals.expenses).toBe(8_500_000n);
  });

  it("MONTHLY(25): 2026-11 runs from October 25 to November 24", async () => {
    const { deps, store } = withPolicy({ kind: "MONTHLY", day: 25 });
    store.rows.push(anExpense("2026-10-24", 12_000_000n), anExpense("2026-10-25", 6_000_000n));
    const page = unwrap(await list(deps, { period: "2026-11" }));
    expect(page.period).toEqual({ start: "2026-10-25", end: "2026-11-24", label: "2026-11" });
    expect(page.totals.expenses).toBe(6_000_000n);
  });

  it("SEMI_MONTHLY(1, 16): each half of November has its own total", async () => {
    const { deps, store } = withPolicy({ kind: "SEMI_MONTHLY", day1: 1, day2: 16 });
    store.rows.push(anExpense("2026-11-10", 7_000_000n), anExpense("2026-11-20", 5_000_000n));
    const first = unwrap(await list(deps, { period: "2026-11 H1" }));
    const second = unwrap(await list(deps, { period: "2026-11 H2" }));
    expect([first.period.start, first.period.end, first.totals.expenses]).toEqual(["2026-11-01", "2026-11-15", 7_000_000n]);
    expect([second.period.start, second.period.end, second.totals.expenses]).toEqual(["2026-11-16", "2026-11-30", 5_000_000n]);
  });

  it("MONTHLY(31): 2027-03 starts on the clamped February 28 (Review Focus 3)", async () => {
    const { deps, store } = withPolicy({ kind: "MONTHLY", day: 31 });
    store.rows.push(anExpense("2027-02-27", 1_000n), anExpense("2027-02-28", 2_000n));
    const page = unwrap(await list(deps, { period: "2027-03" }));
    expect(page.period).toEqual({ start: "2027-02-28", end: "2027-03-30", label: "2027-03" });
    expect(page.totals.expenses).toBe(2_000n);
  });
});

describe("GetTransaction", () => {
  it("returns a live transaction of the space and hides deleted or foreign ones", async () => {
    const { deps, store } = ledgerFixture();
    const live = anExpense("2026-10-05", 100n);
    const deleted = anExpense("2026-10-06", 100n, { deletedAt: new Date() });
    const foreign = anExpense("2026-10-07", 100n, { spaceId: "space-juan" });
    store.rows.push(live, deleted, foreign);
    const get = createGetTransaction(deps);
    expect(unwrap(await get({ spaceId: "space-ana", userId: "u-ana", transactionId: live.id }))).toEqual(live);
    for (const tx of [deleted, foreign]) {
      expect(codeOf(await get({ spaceId: "space-ana", userId: "u-ana", transactionId: tx.id }))).toBe(
        "TransactionNotFound",
      );
    }
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/list-transactions.test.ts`
Expected: FAIL — `Failed to resolve import "./get-transaction"`.

- [ ] **Step 4: Implement**

`src/modules/ledger/application/list-transactions.ts`:

```ts
import { ok, periodByLabel, resolvePeriod, todayIn, type Period, type Result } from "@/shared/kernel";
import type { Transaction, TransactionType } from "../domain/transaction";
import type { LedgerDeps } from "./deps";
import type { TransactionFilter, TransactionPosition } from "./ports";

export interface ListTransactionsInput {
  readonly spaceId: string;
  readonly userId: string;
  /** A period label such as "2026-10" or "2026-11 H1"; the current period when absent. */
  readonly period?: string;
  readonly categoryIds?: readonly string[];
  readonly payerMemberId?: string;
  readonly participantMemberId?: string;
  readonly type?: TransactionType;
  readonly after: TransactionPosition | null;
  readonly limit: number;
}

export interface TransactionPage {
  readonly period: Period;
  readonly currency: string;
  readonly totals: { readonly expenses: bigint; readonly income: bigint };
  readonly items: readonly Transaction[];
  readonly nextPosition: TransactionPosition | null;
}

export type ListTransactions = (input: ListTransactionsInput) => Promise<Result<TransactionPage>>;

/** HU-E4-04/05, the M1 monthly view: one period, filtered, newest first, with period totals. */
export const createListTransactions =
  (deps: LedgerDeps): ListTransactions =>
  async (input) => {
    const membership = await deps.access(input.spaceId, input.userId);
    if (!membership.ok) return membership;
    const space = membership.value;
    const stored = await deps.storedPeriods(space.spaceId);
    const period =
      input.period === undefined
        ? ok(resolvePeriod(space.periodPolicy, stored, todayIn(deps.clock, deps.timeZone)))
        : periodByLabel(space.periodPolicy, stored, input.period);
    if (!period.ok) return period;
    const filter: TransactionFilter = {
      spaceId: space.spaceId,
      from: period.value.start,
      to: period.value.end,
      categoryIds: input.categoryIds,
      payerMemberId: input.payerMemberId,
      participantMemberId: input.participantMemberId,
      type: input.type,
    };
    // One extra row tells whether another page exists.
    const rows = await deps.query.list(filter, input.after, input.limit + 1);
    const items = rows.slice(0, input.limit);
    const last = items.at(-1);
    return ok({
      period: period.value,
      currency: space.currency,
      totals: await deps.query.totals(filter),
      items,
      nextPosition: rows.length > input.limit && last ? { date: last.date, id: last.id } : null,
    });
  };
```

`src/modules/ledger/application/get-transaction.ts`:

```ts
import { domainError, err, ok, type Result } from "@/shared/kernel";
import type { Transaction } from "../domain/transaction";
import type { LedgerDeps } from "./deps";

export type GetTransaction = (input: {
  spaceId: string;
  userId: string;
  transactionId: string;
}) => Promise<Result<Transaction>>;

export const createGetTransaction =
  (deps: LedgerDeps): GetTransaction =>
  async (input) => {
    const membership = await deps.access(input.spaceId, input.userId);
    if (!membership.ok) return membership;
    const transaction = await deps.transactions.findById(membership.value.spaceId, input.transactionId);
    return transaction ? ok(transaction) : err(domainError("TransactionNotFound"));
  };
```

In `src/modules/ledger/application/index.ts`, add:

```ts
export { createGetTransaction, type GetTransaction } from "./get-transaction";
export {
  createListTransactions,
  type ListTransactions,
  type ListTransactionsInput,
  type TransactionPage,
} from "./list-transactions";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: PASS.

- [ ] **Step 6: Gates**

Run: `pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/modules/ledger/application tests/support/in-memory-ledger.ts
git commit -m "feat(ledger): list transactions by period with filters and totals (Refs #33, Refs #34)"
```

---

### Task 18: Ledger — edit, delete and audit trail

Implements HU-E4-06 (issue #35) at use-case level, plus HU-E4-04's "editing the date moves the transaction to another period". Pins Review Focus 1 at the use case (a stale `expectedVersion` changes nothing).

Decisions: `If-Match` is optional (absent → `expectedVersion: null`, no check), as built in M0; when present it must match. Deleting needs no `If-Match`. An edit that changes nothing returns the transaction unchanged and writes no audit entry. Any member may read a transaction's audit trail, including after deletion.

**Files:**
- Create: `src/modules/ledger/application/edit-transaction.ts`, `delete-transaction.ts`, `list-audit.ts` (all in `src/modules/ledger/application/`)
- Modify: `src/modules/ledger/application/index.ts`
- Test: `src/modules/ledger/application/edit-and-delete.test.ts`

**Interfaces:**
- Consumes: `reviseTransaction`, `changesBetween`, `canModify`, `softDelete` (Task 14); `LedgerDeps`, `openPeriod`, `usableCategory` (Task 15); `createListTransactions` (Task 17); builders (Task 17).
- Produces:
  - `interface EditChanges { description?: string; date?: LocalDate; categoryId?: string; amount?: Money }`
  - `createEditTransaction(deps)` → `EditTransaction = (input: { spaceId; userId; transactionId: string; expectedVersion: number | null; changes: EditChanges }) => Promise<Result<Transaction>>` (`TransactionNotFound`, `InsufficientRole`, `PreconditionFailed`, `CurrencyMismatch`, `PeriodClosed`, `CategoryArchived`, `SharesDoNotMatchAmount`, …); the result carries the new `version`
  - `createDeleteTransaction(deps)` → `DeleteTransaction = (input: { spaceId; userId; transactionId: string }) => Promise<Result<void>>`
  - `createListAudit(deps)` → `ListAudit = (input: { spaceId; userId; transactionId: string }) => Promise<Result<AuditEntry[]>>`

- [ ] **Step 1: Write the failing tests**

`src/modules/ledger/application/edit-and-delete.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, fakeSpaceAccess, membership, money, unwrap } from "../../../../tests/support/fakes";
import { anExpense, CATEGORIES, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import type { Expense } from "../domain/transaction";
import { createDeleteTransaction } from "./delete-transaction";
import { createEditTransaction } from "./edit-transaction";
import { createListAudit } from "./list-audit";
import { createListTransactions } from "./list-transactions";

const household = membership({ spaceId: "space-household", name: "Household", spaceKind: "SHARED" });
const luis = membership({ ...household, memberId: "member-luis", userId: "u-luis", role: "MEMBER" });
const asAna = { spaceId: "space-ana", userId: "u-ana" };

const setup = (closed: (date: LocalDate) => boolean = () => false) => {
  const fixture = ledgerFixture({
    access: fakeSpaceAccess(membership(), household, luis),
    closedPeriods: { isClosed: async (_spaceId, date) => closed(date) },
  });
  const market = anExpense("2026-10-31", 8_500_000n, { description: "Market" });
  fixture.store.rows.push(market);
  const list = createListTransactions(fixture.deps);
  return {
    ...fixture,
    market,
    edit: createEditTransaction(fixture.deps),
    remove: createDeleteTransaction(fixture.deps),
    history: createListAudit(fixture.deps),
    idsIn: async (period: string) =>
      unwrap(await list({ ...asAna, period, after: null, limit: 50 })).items.map((t) => t.id),
  };
};

describe("EditTransaction (HU-E4-06)", () => {
  it("changes the amount with one payment and one share and audits who changed what", async () => {
    const { edit, history, market, deps } = setup();
    const edited = unwrap(
      await edit({ ...asAna, transactionId: market.id, expectedVersion: 1, changes: { amount: money(9_500_000n) } }),
    ) as Expense;
    expect(edited).toMatchObject({ amount: 9_500_000n, version: 2 });
    expect(edited.payments.map((p) => p.amount)).toEqual([9_500_000n]);
    expect(edited.shares.map((s) => s.amount)).toEqual([9_500_000n]);
    expect(unwrap(await history({ ...asAna, transactionId: market.id }))).toEqual([
      {
        id: expect.any(String),
        transactionId: market.id,
        action: "UPDATED",
        actorUserId: "u-ana",
        at: deps.clock.now(),
        changes: { amount: { from: "8500000", to: "9500000" } },
      },
    ]);
  });

  it("rejects an amount that breaks the shares of a shared expense", async () => {
    const { store, edit } = setup();
    const shared = anExpense("2026-10-20", 30_000_000n, {
      spaceId: "space-household",
      shares: [
        { memberId: "member-ana", amount: 15_000_000n, splitMethod: "EQUAL" },
        { memberId: "member-juan", amount: 15_000_000n, splitMethod: "EQUAL" },
      ],
    });
    store.rows.push(shared);
    const result = await edit({
      spaceId: "space-household",
      userId: "u-ana",
      transactionId: shared.id,
      expectedVersion: null,
      changes: { amount: money(32_000_000n) },
    });
    expect(codeOf(result)).toBe("SharesDoNotMatchAmount");
  });

  it("forbids members from editing another member's transaction", async () => {
    const { store, edit } = setup();
    const anas = anExpense("2026-10-20", 5_000_000n, { spaceId: "space-household" });
    store.rows.push(anas);
    const result = await edit({
      spaceId: "space-household",
      userId: "u-luis",
      transactionId: anas.id,
      expectedVersion: null,
      changes: { description: "Mine" },
    });
    expect(codeOf(result)).toBe("InsufficientRole");
  });

  it("rejects changes inside a closed period and moves into one", async () => {
    const novemberClosed = setup((date) => date.startsWith("2026-11"));
    const move = await novemberClosed.edit({
      ...asAna,
      transactionId: novemberClosed.market.id,
      expectedVersion: null,
      changes: { date: "2026-11-02" as LocalDate },
    });
    expect(codeOf(move)).toBe("PeriodClosed");
    const octoberClosed = setup((date) => date.startsWith("2026-10"));
    const touch = await octoberClosed.edit({
      ...asAna,
      transactionId: octoberClosed.market.id,
      expectedVersion: null,
      changes: { description: "Groceries" },
    });
    expect(codeOf(touch)).toBe("PeriodClosed");
  });

  it("rejects a stale version and changes nothing (Review Focus 1)", async () => {
    const { edit, market, store, audit } = setup();
    unwrap(await edit({ ...asAna, transactionId: market.id, expectedVersion: 1, changes: { description: "Groceries" } }));
    const stale = await edit({ ...asAna, transactionId: market.id, expectedVersion: 1, changes: { amount: money(1_000n) } });
    expect(codeOf(stale)).toBe("PreconditionFailed");
    expect(store.rows[0]).toMatchObject({ amount: 8_500_000n, description: "Groceries", version: 2 });
    expect(audit.entries).toHaveLength(1);
  });

  it("moves the transaction to another period when its date changes (HU-E4-04)", async () => {
    const { edit, market, idsIn } = setup();
    unwrap(
      await edit({ ...asAna, transactionId: market.id, expectedVersion: null, changes: { date: "2026-11-02" as LocalDate } }),
    );
    expect(await idsIn("2026-11")).toEqual([market.id]);
    expect(await idsIn("2026-10")).toEqual([]);
  });

  it("rejects archived categories and other currencies", async () => {
    const { edit, market } = setup();
    const base = { ...asAna, transactionId: market.id, expectedVersion: null };
    expect(codeOf(await edit({ ...base, changes: { categoryId: CATEGORIES.archived.id } }))).toBe("CategoryArchived");
    expect(codeOf(await edit({ ...base, changes: { amount: money(100n, "USD") } }))).toBe("CurrencyMismatch");
  });

  it("writes nothing for an edit that changes nothing", async () => {
    const { edit, market, audit } = setup();
    const same = unwrap(
      await edit({ ...asAna, transactionId: market.id, expectedVersion: 1, changes: { description: "Market" } }),
    );
    expect(same.version).toBe(1);
    expect(audit.entries).toEqual([]);
  });
});

describe("DeleteTransaction (HU-E4-06)", () => {
  it("soft-deletes, hides the transaction and audits the deletion", async () => {
    const { remove, history, market, store, idsIn } = setup();
    unwrap(await remove({ ...asAna, transactionId: market.id }));
    expect(store.rows[0]?.deletedAt).not.toBeNull();
    expect(await idsIn("2026-10")).toEqual([]);
    const entries = unwrap(await history({ ...asAna, transactionId: market.id }));
    expect(entries.map((e) => [e.action, e.actorUserId])).toEqual([["DELETED", "u-ana"]]);
    expect(codeOf(await remove({ ...asAna, transactionId: market.id }))).toBe("TransactionNotFound");
  });

  it("forbids members from deleting another member's transaction", async () => {
    const { store, remove } = setup();
    const anas = anExpense("2026-10-20", 5_000_000n, { spaceId: "space-household" });
    store.rows.push(anas);
    expect(codeOf(await remove({ spaceId: "space-household", userId: "u-luis", transactionId: anas.id }))).toBe(
      "InsufficientRole",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/edit-and-delete.test.ts`
Expected: FAIL — `Failed to resolve import "./delete-transaction"`.

- [ ] **Step 3: Implement**

`src/modules/ledger/application/edit-transaction.ts`:

```ts
import { domainError, err, ok, type LocalDate, type Money, type Result } from "@/shared/kernel";
import { canModify, changesBetween, reviseTransaction, type Transaction } from "../domain/transaction";
import { openPeriod, usableCategory } from "./checks";
import type { LedgerDeps } from "./deps";

export interface EditChanges {
  readonly description?: string;
  readonly date?: LocalDate;
  readonly categoryId?: string;
  readonly amount?: Money;
}

export interface EditTransactionInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly transactionId: string;
  /** The If-Match version; null skips the check. */
  readonly expectedVersion: number | null;
  readonly changes: EditChanges;
}

export type EditTransaction = (input: EditTransactionInput) => Promise<Result<Transaction>>;

export const createEditTransaction =
  (deps: LedgerDeps): EditTransaction =>
  (input) =>
    deps.tm.run(async () => {
      const membership = await deps.access(input.spaceId, input.userId);
      if (!membership.ok) return membership;
      const current = await deps.transactions.findById(membership.value.spaceId, input.transactionId);
      if (!current) return err(domainError("TransactionNotFound"));
      if (!canModify(membership.value.role, current.createdBy, input.userId)) {
        return err(domainError("InsufficientRole"));
      }
      if (input.expectedVersion !== null && input.expectedVersion !== current.version) {
        return err(domainError("PreconditionFailed"));
      }
      const { amount, ...rest } = input.changes;
      if (amount && amount.currency.code !== current.currency) {
        return err(domainError("CurrencyMismatch", { expected: current.currency, actual: amount.currency.code }));
      }
      const open = await openPeriod(deps, current.spaceId, current.date);
      if (!open.ok) return open;
      const now = deps.clock.now();
      const revised = reviseTransaction(current, { ...rest, amount: amount?.minor }, now);
      if (!revised.ok) return revised;
      const changes = changesBetween(current, revised.value);
      if (Object.keys(changes).length === 0) return ok(current);
      if (changes.date) {
        // HU-E4-06: moving a transaction into a closed period is rejected too.
        const target = await openPeriod(deps, current.spaceId, revised.value.date);
        if (!target.ok) return target;
      }
      if (changes.categoryId) {
        const category = await usableCategory(deps, current.spaceId, revised.value.categoryId);
        if (!category.ok) return category;
      }
      // The repository compares versions again, so a concurrent edit between read and write still loses.
      if (!(await deps.transactions.save(revised.value, current.version))) {
        return err(domainError("PreconditionFailed"));
      }
      await deps.audit.append({
        id: deps.ids.next<"AuditEntry">(),
        transactionId: current.id,
        action: "UPDATED",
        actorUserId: input.userId,
        at: now,
        changes,
      });
      return ok({ ...revised.value, version: current.version + 1 });
    });
```

`src/modules/ledger/application/delete-transaction.ts`:

```ts
import { domainError, err, ok, type Result } from "@/shared/kernel";
import { canModify, softDelete } from "../domain/transaction";
import { openPeriod } from "./checks";
import type { LedgerDeps } from "./deps";

export type DeleteTransaction = (input: {
  spaceId: string;
  userId: string;
  transactionId: string;
}) => Promise<Result<void>>;

/** HU-E4-06 / D8: soft delete; the row stays for the audit trail and leaves lists, balances and totals. */
export const createDeleteTransaction =
  (deps: LedgerDeps): DeleteTransaction =>
  (input) =>
    deps.tm.run(async () => {
      const membership = await deps.access(input.spaceId, input.userId);
      if (!membership.ok) return membership;
      const current = await deps.transactions.findById(membership.value.spaceId, input.transactionId);
      if (!current) return err(domainError("TransactionNotFound"));
      if (!canModify(membership.value.role, current.createdBy, input.userId)) {
        return err(domainError("InsufficientRole"));
      }
      const open = await openPeriod(deps, current.spaceId, current.date);
      if (!open.ok) return open;
      const now = deps.clock.now();
      if (!(await deps.transactions.save(softDelete(current, now), current.version))) {
        return err(domainError("PreconditionFailed"));
      }
      await deps.audit.append({
        id: deps.ids.next<"AuditEntry">(),
        transactionId: current.id,
        action: "DELETED",
        actorUserId: input.userId,
        at: now,
        changes: {},
      });
      return ok(undefined);
    });
```

`src/modules/ledger/application/list-audit.ts`:

```ts
import { domainError, err, ok, type Result } from "@/shared/kernel";
import type { LedgerDeps } from "./deps";
import type { AuditEntry } from "./ports";

export type ListAudit = (input: { spaceId: string; userId: string; transactionId: string }) => Promise<Result<AuditEntry[]>>;

/** Audit trail of one transaction, also after it was deleted. */
export const createListAudit =
  (deps: LedgerDeps): ListAudit =>
  async (input) => {
    const membership = await deps.access(input.spaceId, input.userId);
    if (!membership.ok) return membership;
    const transaction = await deps.transactions.findById(membership.value.spaceId, input.transactionId, true);
    if (!transaction) return err(domainError("TransactionNotFound"));
    return ok(await deps.audit.listFor(transaction.id));
  };
```

In `src/modules/ledger/application/index.ts`, add:

```ts
export { createDeleteTransaction, type DeleteTransaction } from "./delete-transaction";
export {
  createEditTransaction,
  type EditChanges,
  type EditTransaction,
  type EditTransactionInput,
} from "./edit-transaction";
export { createListAudit, type ListAudit } from "./list-audit";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/application
git commit -m "feat(ledger): edit and soft-delete transactions with an audit trail (Refs #35, Refs #33)"
```

---

### Task 19: Ledger — tables and migration 0005

Schema-only task (HU-E4-01 … HU-E4-06). One `transactions` table for every type, with per-type columns guarded by a check constraint; payments and shares keyed by `(transaction_id, position)` so their order is stable; an append-only `transaction_audit` table.

Decisions: `created_by` and `actor_user_id` are plain text (no foreign key) so audit history survives user removal. No `updated_by`/`deleted_by` columns: the audit table records who changed or deleted what.

**Files:**
- Create: `src/modules/ledger/infrastructure/ledger.schema.ts`
- Create (generated): `drizzle/0005_ledger.sql`, `drizzle/meta/0005_snapshot.json`; Modify (generated): `drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: `spaces`, `spaceMembers` (M0), `accounts` (Task 12), `categories` (Task 8), `ChangeSet` (Task 14, type only).
- Produces: tables `transactions`, `payments`, `shares`, `transaction_audit` (Drizzle exports `transactions`, `payments`, `shares`, `transactionAudit`).

- [ ] **Step 1: Write the schema**

`src/modules/ledger/infrastructure/ledger.schema.ts`:

```ts
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "@/modules/accounts/infrastructure/accounts.schema";
import { categories } from "@/modules/categories/infrastructure/categories.schema";
import { spaceMembers, spaces } from "@/modules/spaces/infrastructure/spaces.schema";
import type { ChangeSet } from "../domain/transaction";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => bigint(name, { mode: "bigint" });

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["EXPENSE", "INCOME", "TRANSFER"] }).notNull(),
    description: text("description").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    categoryId: uuid("category_id").references(() => categories.id),
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    sourceAccountId: uuid("source_account_id").references(() => accounts.id),
    destinationAccountId: uuid("destination_account_id").references(() => accounts.id),
    receivingMemberId: uuid("receiving_member_id").references(() => spaceMembers.id),
    createdBy: text("created_by").notNull(),
    createdAt: tz("created_at").notNull(),
    updatedAt: tz("updated_at").notNull(),
    deletedAt: tz("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    // The monthly view: one space, a date range, newest first (keyset on date, id).
    index("transactions_space_date_idx").on(t.spaceId, t.date, t.id),
    index("transactions_category_idx").on(t.categoryId),
    index("transactions_source_account_idx").on(t.sourceAccountId),
    index("transactions_destination_account_idx").on(t.destinationAccountId),
    check("transactions_amount_positive", sql`${t.amount} > 0`),
    check(
      "transactions_shape",
      sql`(${t.type} = 'EXPENSE' AND ${t.categoryId} IS NOT NULL AND ${t.sourceAccountId} IS NULL AND ${t.destinationAccountId} IS NULL AND ${t.receivingMemberId} IS NULL)
        OR (${t.type} = 'INCOME' AND ${t.categoryId} IS NOT NULL AND ${t.sourceAccountId} IS NULL AND ${t.destinationAccountId} IS NOT NULL AND ${t.receivingMemberId} IS NOT NULL)
        OR (${t.type} = 'TRANSFER' AND ${t.categoryId} IS NULL AND ${t.sourceAccountId} IS NOT NULL AND ${t.destinationAccountId} IS NOT NULL AND ${t.receivingMemberId} IS NULL)`,
    ),
  ],
);

export const payments = pgTable(
  "payments",
  {
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    memberId: uuid("member_id").references(() => spaceMembers.id),
    accountId: uuid("account_id").references(() => accounts.id),
    amount: money("amount").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.transactionId, t.position] }),
    index("payments_account_idx").on(t.accountId),
    index("payments_member_idx").on(t.memberId),
    check("payments_amount_positive", sql`${t.amount} > 0`),
    // Spec 5.2: memberId is null only for fund payments, accountId only for guests, never both.
    check("payments_has_payer", sql`${t.memberId} IS NOT NULL OR ${t.accountId} IS NOT NULL`),
  ],
);

export const shares = pgTable(
  "shares",
  {
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => spaceMembers.id),
    amount: money("amount").notNull(),
    splitMethod: text("split_method", { enum: ["EQUAL", "PERCENT", "EXACT", "SHARES", "BY_ALLOCATION"] }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.transactionId, t.position] }),
    index("shares_member_idx").on(t.memberId),
    check("shares_amount_positive", sql`${t.amount} > 0`),
  ],
);

export const transactionAudit = pgTable(
  "transaction_audit",
  {
    id: uuid("id").primaryKey(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    action: text("action", { enum: ["UPDATED", "DELETED"] }).notNull(),
    actorUserId: text("actor_user_id").notNull(),
    at: tz("at").notNull(),
    changes: jsonb("changes").$type<ChangeSet>().notNull(),
  },
  (t) => [index("transaction_audit_transaction_idx").on(t.transactionId, t.at)],
);
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate --name ledger`
Expected: `drizzle/0005_ledger.sql` creating `transactions`, `payments`, `shares` and `transaction_audit` with their foreign keys (to `spaces` with cascade; to `categories`, `accounts` and `space_members` without), the composite primary keys, the check constraints `transactions_amount_positive`, `transactions_shape`, `payments_amount_positive`, `payments_has_payer`, `shares_amount_positive`, and the indexes; `drizzle/meta/0005_snapshot.json`; a `0005_ledger` journal entry.

- [ ] **Step 3: Verify migrations and drift**

Run: `pnpm db:check && pnpm exec vitest run --project integration`
Expected: "No schema drift" and PASS (all existing integration tests, including the cascade test that deletes a user with a personal space).

- [ ] **Step 4: Gates**

Run: `pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0 (`schemas-only-reference-schemas` holds; the `ChangeSet` import is the module's own domain).

- [ ] **Step 5: Commit**

```bash
git add src/modules/ledger/infrastructure/ledger.schema.ts drizzle/0005_ledger.sql drizzle/meta/0005_snapshot.json drizzle/meta/_journal.json
git commit -m "feat(ledger): add transactions, payments, shares and audit tables with migration (Refs #30)"
```

---

### Task 20: Ledger — transaction repository and audit log

Implements `TransactionRepository` and `AuditLog` (HU-E4-01 … HU-E4-03, HU-E4-06). Pins Review Focus 1 at the database (compare-and-set on `version`; under READ COMMITTED a concurrent second update re-checks the predicate after the first commits and updates nothing) and Review Focus 4 (malformed ids return null).

**Files:**
- Create: `src/modules/ledger/infrastructure/transaction-rows.ts`, `drizzle-transaction-repository.ts`, `drizzle-audit-log.ts` (all in `src/modules/ledger/infrastructure/`)
- Modify: `tests/support/fixtures.ts`
- Test: `src/modules/ledger/infrastructure/drizzle-transaction-repository.int.test.ts`

**Interfaces:**
- Consumes: `TransactionRepository`, `AuditLog`, `AuditEntry` (Task 15); domain constructors (Task 14); tables (Task 19); `DrizzleAccountRepository` (Task 13), `DrizzleCategoryRepository` (Task 9); `Executor` (M0 db client); `isUuid` (Task 1).
- Produces:
  - `transactionRow(tx)`, `paymentRows(tx)`, `shareRows(tx)`, `loadTransactions(db: Executor, rows): Promise<Transaction[]>` (transaction-rows.ts; reused by Task 21)
  - `class DrizzleTransactionRepository implements TransactionRepository`, `class DrizzleAuditLog implements AuditLog` (constructors `(tm: DrizzleTransactionManager)`)
  - `tests/support/fixtures.ts`: `accountFixture(db, space, name, openingBalance?): Promise<string>`, `categoryFixture(db, space, name?): Promise<string>`, `guestMemberFixture(pool, space, name?): Promise<string>`

- [ ] **Step 1: Extend the fixtures and write the failing integration test**

In `tests/support/fixtures.ts`, add the imports:

```ts
import { DrizzleAccountRepository } from "@/modules/accounts/infrastructure/drizzle-account-repository";
import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";
```

and append:

```ts
/** A BANK account owned by the space owner. */
export const accountFixture = async (
  db: Database,
  space: SpaceFixture,
  name: string,
  openingBalance = 0n,
): Promise<string> => {
  const id = randomUUID();
  await new DrizzleAccountRepository(new DrizzleTransactionManager(db)).add({
    id: id as Id<"Account">,
    spaceId: space.spaceId,
    name,
    type: "BANK",
    ownerUserId: space.userId,
    openingBalance,
    archivedAt: null,
    createdAt: new Date(),
  });
  return id;
};

/** A category in a fresh group of the space; returns the category id. */
export const categoryFixture = async (db: Database, space: SpaceFixture, name = "Groceries"): Promise<string> => {
  const repo = new DrizzleCategoryRepository(new DrizzleTransactionManager(db));
  const groupId = randomUUID() as Id<"CategoryGroup">;
  const id = randomUUID();
  await repo.addGroups([{ id: groupId, spaceId: space.spaceId, name: `Group ${groupId}`, archivedAt: null, createdAt: new Date() }]);
  await repo.addCategories([
    { id: id as Id<"Category">, spaceId: space.spaceId, groupId, name, key: null, archivedAt: null, createdAt: new Date() },
  ]);
  return id;
};

/** A second (guest) member row, only to exercise member filters before M2 brings real shared spaces. */
export const guestMemberFixture = async (pool: Pool, space: SpaceFixture, name = "Juan"): Promise<string> => {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO space_members (id, space_id, kind, display_name, joined_at) VALUES ($1, $2, 'GUEST', $3, now())",
    [id, space.spaceId, name],
  );
  return id;
};
```

`src/modules/ledger/infrastructure/drizzle-transaction-repository.int.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { unwrap } from "../../../../tests/support/fakes";
import {
  accountFixture,
  categoryFixture,
  personalSpaceFixture,
  type SpaceFixture,
} from "../../../../tests/support/fixtures";
import type { AuditEntry } from "../application/ports";
import {
  recordExpense,
  recordIncome,
  recordTransfer,
  softDelete,
  type Expense,
  type TransactionId,
} from "../domain/transaction";
import { DrizzleAuditLog } from "./drizzle-audit-log";
import { DrizzleTransactionRepository } from "./drizzle-transaction-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleTransactionRepository(tm);
const auditLog = new DrizzleAuditLog(tm);
const now = new Date("2026-10-05T15:00:00Z");

let space: SpaceFixture;
let bank: string;
let wallet: string;
let groceries: string;

beforeAll(async () => {
  space = await personalSpaceFixture(db, pool);
  bank = await accountFixture(db, space, "Bancolombia");
  wallet = await accountFixture(db, space, "Nequi");
  groceries = await categoryFixture(db, space);
});
afterAll(() => pool.end());

const common = (amount: bigint) => ({
  id: randomUUID() as TransactionId,
  spaceId: space.spaceId,
  description: "Market",
  date: "2026-10-05" as LocalDate,
  amount,
  currency: "COP",
  createdBy: space.userId,
  now,
});
const expense = (amount = 8_500_000n): Expense =>
  unwrap(
    recordExpense({
      ...common(amount),
      categoryId: groceries,
      payments: [{ memberId: space.memberId, accountId: bank, amount }],
      shares: [{ memberId: space.memberId, amount, splitMethod: "EQUAL" }],
    }),
  );

describe("DrizzleTransactionRepository", () => {
  it("round-trips an expense with its payments and shares", async () => {
    const market = expense();
    await repo.add(market);
    expect(await repo.findById(space.spaceId, market.id)).toEqual(market);
  });

  it("round-trips income and transfers", async () => {
    const salary = unwrap(
      recordIncome({ ...common(320_000_000n), categoryId: groceries, destinationAccountId: bank, receivingMemberId: space.memberId }),
    );
    const move = unwrap(recordTransfer({ ...common(50_000_000n), sourceAccountId: bank, destinationAccountId: wallet }));
    await repo.add(salary);
    await repo.add(move);
    expect(await repo.findById(space.spaceId, salary.id)).toEqual(salary);
    expect(await repo.findById(space.spaceId, move.id)).toEqual(move);
  });

  it("hides other spaces, malformed ids and soft-deleted rows unless asked", async () => {
    const market = expense();
    await repo.add(market);
    const other = await personalSpaceFixture(db, pool, "Juan");
    expect(await repo.findById(other.spaceId, market.id)).toBeNull();
    expect(await repo.findById(space.spaceId, "not-a-uuid")).toBeNull();
    expect(await repo.save(softDelete(market, now), 1)).toBe(true);
    expect(await repo.findById(space.spaceId, market.id)).toBeNull();
    expect(await repo.findById(space.spaceId, market.id, true)).toMatchObject({ id: market.id, version: 2, deletedAt: now });
  });

  it("saves only from the expected version and replaces payments and shares (Review Focus 1)", async () => {
    const market = expense();
    await repo.add(market);
    const edited: Expense = {
      ...market,
      amount: 9_500_000n,
      payments: [{ ...market.payments[0]!, amount: 9_500_000n }],
      shares: [{ ...market.shares[0]!, amount: 9_500_000n }],
    };
    expect(await repo.save(edited, 1)).toBe(true);
    expect(await repo.save({ ...market, description: "stale" }, 1)).toBe(false);
    expect(await repo.findById(space.spaceId, market.id)).toEqual({ ...edited, version: 2 });
  });
});

describe("DrizzleAuditLog", () => {
  it("appends entries and lists them oldest first", async () => {
    const market = expense();
    await repo.add(market);
    const entry = (action: AuditEntry["action"], at: Date, changes: AuditEntry["changes"]): AuditEntry => ({
      id: randomUUID(),
      transactionId: market.id,
      action,
      actorUserId: space.userId,
      at,
      changes,
    });
    const deletion = entry("DELETED", new Date("2026-10-06T00:00:00Z"), {});
    const update = entry("UPDATED", new Date("2026-10-05T16:00:00Z"), { amount: { from: "8500000", to: "9500000" } });
    await auditLog.append(deletion);
    await auditLog.append(update);
    expect(await auditLog.listFor(market.id)).toEqual([update, deletion]);
    expect(await auditLog.listFor("not-a-uuid")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project integration src/modules/ledger`
Expected: FAIL — `Failed to resolve import "./drizzle-audit-log"`.

- [ ] **Step 3: Implement**

`src/modules/ledger/infrastructure/transaction-rows.ts`:

```ts
import { asc, inArray } from "drizzle-orm";
import type { Executor } from "@/shared/infrastructure/db/client";
import type { LocalDate } from "@/shared/kernel";
import type { Payment, Share, Transaction, TransactionId } from "../domain/transaction";
import { payments, shares, transactions } from "./ledger.schema";

type TransactionRow = typeof transactions.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;
type ShareRow = typeof shares.$inferSelect;

export const transactionRow = (tx: Transaction): typeof transactions.$inferInsert => ({
  id: tx.id,
  spaceId: tx.spaceId,
  type: tx.type,
  description: tx.description,
  date: tx.date,
  categoryId: tx.categoryId,
  amount: tx.amount,
  currency: tx.currency,
  sourceAccountId: tx.type === "TRANSFER" ? tx.sourceAccountId : null,
  destinationAccountId: tx.type === "EXPENSE" ? null : tx.destinationAccountId,
  receivingMemberId: tx.type === "INCOME" ? tx.receivingMemberId : null,
  createdBy: tx.createdBy,
  createdAt: tx.createdAt,
  updatedAt: tx.updatedAt,
  deletedAt: tx.deletedAt,
  version: tx.version,
});

export const paymentRows = (tx: Transaction): (typeof payments.$inferInsert)[] =>
  tx.type === "EXPENSE"
    ? tx.payments.map((p, position) => ({
        transactionId: tx.id,
        position,
        memberId: p.memberId,
        accountId: p.accountId,
        amount: p.amount,
      }))
    : [];

export const shareRows = (tx: Transaction): (typeof shares.$inferInsert)[] =>
  tx.type === "EXPENSE"
    ? tx.shares.map((s, position) => ({
        transactionId: tx.id,
        position,
        memberId: s.memberId,
        amount: s.amount,
        splitMethod: s.splitMethod,
      }))
    : [];

const toPayment = (row: PaymentRow): Payment => ({ memberId: row.memberId, accountId: row.accountId, amount: row.amount });
const toShare = (row: ShareRow): Share => ({ memberId: row.memberId, amount: row.amount, splitMethod: row.splitMethod });

/** Rebuilds the aggregate; the transactions_shape check guarantees the per-type columns are set. */
const toTransaction = (
  row: TransactionRow,
  rowPayments: readonly PaymentRow[],
  rowShares: readonly ShareRow[],
): Transaction => {
  const base = {
    id: row.id as TransactionId,
    spaceId: row.spaceId,
    description: row.description,
    date: row.date as LocalDate,
    amount: row.amount,
    currency: row.currency,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    version: row.version,
  };
  switch (row.type) {
    case "EXPENSE":
      return {
        ...base,
        type: "EXPENSE",
        categoryId: row.categoryId!,
        payments: rowPayments.map(toPayment),
        shares: rowShares.map(toShare),
      };
    case "INCOME":
      return {
        ...base,
        type: "INCOME",
        categoryId: row.categoryId!,
        destinationAccountId: row.destinationAccountId!,
        receivingMemberId: row.receivingMemberId!,
      };
    case "TRANSFER":
      return {
        ...base,
        type: "TRANSFER",
        categoryId: null,
        sourceAccountId: row.sourceAccountId!,
        destinationAccountId: row.destinationAccountId!,
      };
  }
};

/** Loads the payments and shares of `rows` with two queries and keeps the rows' order. */
export const loadTransactions = async (db: Executor, rows: readonly TransactionRow[]): Promise<Transaction[]> => {
  const expenseIds = rows.filter((r) => r.type === "EXPENSE").map((r) => r.id);
  const allPayments: PaymentRow[] =
    expenseIds.length === 0
      ? []
      : await db.select().from(payments).where(inArray(payments.transactionId, expenseIds)).orderBy(asc(payments.position));
  const allShares: ShareRow[] =
    expenseIds.length === 0
      ? []
      : await db.select().from(shares).where(inArray(shares.transactionId, expenseIds)).orderBy(asc(shares.position));
  return rows.map((row) =>
    toTransaction(
      row,
      allPayments.filter((p) => p.transactionId === row.id),
      allShares.filter((s) => s.transactionId === row.id),
    ),
  );
};
```

`src/modules/ledger/infrastructure/drizzle-transaction-repository.ts`:

```ts
import { and, eq, isNull } from "drizzle-orm";
import type { Executor } from "@/shared/infrastructure/db/client";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid } from "@/shared/kernel";
import type { TransactionRepository } from "../application/ports";
import type { Transaction } from "../domain/transaction";
import { payments, shares, transactions } from "./ledger.schema";
import { loadTransactions, paymentRows, shareRows, transactionRow } from "./transaction-rows";

export class DrizzleTransactionRepository implements TransactionRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async add(transaction: Transaction): Promise<void> {
    const db = this.tm.executor();
    await db.insert(transactions).values(transactionRow(transaction));
    await this.insertParts(db, transaction);
  }

  async findById(spaceId: string, transactionId: string, includeDeleted = false): Promise<Transaction | null> {
    // Ids come from URLs; anything that is not a UUID would fail the uuid cast.
    if (!isUuid(transactionId)) return null;
    const db = this.tm.executor();
    const rows = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.spaceId, spaceId),
          includeDeleted ? undefined : isNull(transactions.deletedAt),
        ),
      );
    const [found] = await loadTransactions(db, rows);
    return found ?? null;
  }

  /** Compare-and-set on version: a concurrent writer that read the same version updates nothing. */
  async save(transaction: Transaction, expectedVersion: number): Promise<boolean> {
    const db = this.tm.executor();
    const updated = await db
      .update(transactions)
      .set({
        description: transaction.description,
        date: transaction.date,
        categoryId: transaction.categoryId,
        amount: transaction.amount,
        updatedAt: transaction.updatedAt,
        deletedAt: transaction.deletedAt,
        version: expectedVersion + 1,
      })
      .where(and(eq(transactions.id, transaction.id), eq(transactions.version, expectedVersion)))
      .returning({ id: transactions.id });
    if (updated.length === 0) return false;
    if (transaction.type === "EXPENSE") {
      await db.delete(payments).where(eq(payments.transactionId, transaction.id));
      await db.delete(shares).where(eq(shares.transactionId, transaction.id));
      await this.insertParts(db, transaction);
    }
    return true;
  }

  private async insertParts(db: Executor, transaction: Transaction): Promise<void> {
    const paymentValues = paymentRows(transaction);
    if (paymentValues.length > 0) await db.insert(payments).values(paymentValues);
    const shareValues = shareRows(transaction);
    if (shareValues.length > 0) await db.insert(shares).values(shareValues);
  }
}
```

`src/modules/ledger/infrastructure/drizzle-audit-log.ts`:

```ts
import { asc, eq } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid } from "@/shared/kernel";
import type { AuditEntry, AuditLog } from "../application/ports";
import { transactionAudit } from "./ledger.schema";

export class DrizzleAuditLog implements AuditLog {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async append(entry: AuditEntry): Promise<void> {
    await this.tm.executor().insert(transactionAudit).values({
      id: entry.id,
      transactionId: entry.transactionId,
      action: entry.action,
      actorUserId: entry.actorUserId,
      at: entry.at,
      changes: entry.changes,
    });
  }

  async listFor(transactionId: string): Promise<AuditEntry[]> {
    if (!isUuid(transactionId)) return [];
    return this.tm
      .executor()
      .select()
      .from(transactionAudit)
      .where(eq(transactionAudit.transactionId, transactionId))
      .orderBy(asc(transactionAudit.at), asc(transactionAudit.id));
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project integration src/modules/ledger`
Expected: PASS (5 tests).

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/infrastructure tests/support/fixtures.ts
git commit -m "feat(ledger): persist transactions with versioned saves and an audit log (Refs #30, Refs #35)"
```

---

### Task 21: Ledger — queries for lists, totals, balances and references

Implements `TransactionQuery` plus the read ports other modules need (HU-E4-05 issue #34, HU-E2-04 issue #26, HU-E3-03 issue #29, HU-E1-03 currency lock): `list`, `totals`, `netMovements`, `isCategoryReferenced`, `hasTransactions`. Covers the HU-E2-04 scenarios (all transaction types, shared expense reduces the payer account by the full payment, deleted excluded, balance as of a date) and the HU-E4-05 member filter at SQL level. Pins Review Focus 2 (120 transactions on one date) and Review Focus 5 (sums beyond `bigint`).

**Files:**
- Create: `src/modules/ledger/infrastructure/drizzle-ledger-queries.ts`
- Test: `src/modules/ledger/infrastructure/drizzle-ledger-queries.int.test.ts`

**Interfaces:**
- Consumes: `TransactionQuery`, `TransactionFilter`, `TransactionPosition` (Task 15); `loadTransactions` (Task 20); `DrizzleTransactionRepository` (Task 20, test setup); fixtures (Tasks 9, 20).
- Produces: `class DrizzleLedgerQueries implements TransactionQuery` with additionally
  - `netMovements(accountIds: readonly string[], asOf: LocalDate | null): Promise<ReadonlyMap<string, bigint>>` (structurally satisfies `AccountMovements`, Task 10)
  - `isCategoryReferenced(categoryId: string): Promise<boolean>` (satisfies `CategoryUsage`, Task 7)
  - `hasTransactions(spaceId: string): Promise<boolean>` (used for `SpaceUsage`, Task 2)

- [ ] **Step 1: Write the failing integration test**

`src/modules/ledger/infrastructure/drizzle-ledger-queries.int.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { unwrap } from "../../../../tests/support/fakes";
import {
  accountFixture,
  categoryFixture,
  guestMemberFixture,
  personalSpaceFixture,
} from "../../../../tests/support/fixtures";
import type { TransactionFilter, TransactionPosition } from "../application/ports";
import {
  recordExpense,
  recordIncome,
  recordTransfer,
  softDelete,
  type Share,
  type Transaction,
  type TransactionId,
} from "../domain/transaction";
import { DrizzleLedgerQueries } from "./drizzle-ledger-queries";
import { DrizzleTransactionRepository } from "./drizzle-transaction-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleTransactionRepository(tm);
const queries = new DrizzleLedgerQueries(tm);

const world = async () => {
  const space = await personalSpaceFixture(db, pool);
  return {
    space,
    bank: await accountFixture(db, space, "Bancolombia"),
    wallet: await accountFixture(db, space, "Nequi"),
    groceries: await categoryFixture(db, space, "Groceries"),
    restaurants: await categoryFixture(db, space, "Restaurants"),
    salary: await categoryFixture(db, space, "Salary"),
  };
};
type World = Awaited<ReturnType<typeof world>>;

const common = (w: World, date: string, amount: bigint) => ({
  id: randomUUID() as TransactionId,
  spaceId: w.space.spaceId,
  date: date as LocalDate,
  amount,
  currency: "COP",
  createdBy: w.space.userId,
  now: new Date(),
});
const expense = (
  w: World,
  date: string,
  amount: bigint,
  options: { categoryId?: string; payerMemberId?: string; shares?: Share[] } = {},
) =>
  unwrap(
    recordExpense({
      ...common(w, date, amount),
      categoryId: options.categoryId ?? w.groceries,
      // A guest payer pays outside the app (no account), like HU-E4-07's guest scenario.
      payments: [
        options.payerMemberId
          ? { memberId: options.payerMemberId, accountId: null, amount }
          : { memberId: w.space.memberId, accountId: w.bank, amount },
      ],
      shares: options.shares ?? [{ memberId: w.space.memberId, amount, splitMethod: "EQUAL" }],
    }),
  );
const income = (w: World, date: string, amount: bigint) =>
  unwrap(
    recordIncome({ ...common(w, date, amount), categoryId: w.salary, destinationAccountId: w.bank, receivingMemberId: w.space.memberId }),
  );
const transfer = (w: World, date: string, amount: bigint) =>
  unwrap(recordTransfer({ ...common(w, date, amount), sourceAccountId: w.bank, destinationAccountId: w.wallet }));
const store = async (...txs: Transaction[]) => {
  for (const tx of txs) await repo.add(tx);
};
const october = (w: World, extra: Partial<TransactionFilter> = {}): TransactionFilter => ({
  spaceId: w.space.spaceId,
  from: "2026-10-01" as LocalDate,
  to: "2026-10-31" as LocalDate,
  ...extra,
});

afterAll(() => pool.end());

describe("list and totals (HU-E4-05)", () => {
  it("lists live transactions of the period newest first, with totals", async () => {
    const w = await world();
    const first = expense(w, "2026-10-05", 8_500_000n);
    const second = expense(w, "2026-10-12", 10_000_000n);
    const dinner = expense(w, "2026-10-15", 6_000_000n, { categoryId: w.restaurants });
    const salary = income(w, "2026-10-25", 320_000_000n);
    await store(first, second, dinner, salary, expense(w, "2026-11-01", 4_000_000n));
    await store(softDelete(expense(w, "2026-10-20", 1_000_000n), new Date()));
    const rows = await queries.list(october(w), null, 50);
    expect(rows.map((t) => t.id)).toEqual([salary.id, dinner.id, second.id, first.id]);
    expect(rows[2]).toEqual(second);
    expect(await queries.totals(october(w))).toEqual({ expenses: 24_500_000n, income: 320_000_000n });
  });

  it("filters by category, type, payer and participant", async () => {
    const w = await world();
    const juan = await guestMemberFixture(pool, w.space);
    const market = expense(w, "2026-10-05", 8_500_000n);
    const dinner = expense(w, "2026-10-15", 6_000_000n, { categoryId: w.restaurants });
    const juanPays = expense(w, "2026-10-16", 10_000_000n, {
      payerMemberId: juan,
      shares: [
        { memberId: w.space.memberId, amount: 5_000_000n, splitMethod: "EQUAL" },
        { memberId: juan, amount: 5_000_000n, splitMethod: "EQUAL" },
      ],
    });
    const salary = income(w, "2026-10-25", 320_000_000n);
    await store(market, dinner, juanPays, salary);
    const ids = async (extra: Partial<TransactionFilter>) =>
      (await queries.list(october(w, extra), null, 50)).map((t) => t.id);
    expect(await ids({ categoryIds: [w.groceries] })).toEqual([juanPays.id, market.id]);
    expect(await queries.totals(october(w, { categoryIds: [w.groceries] }))).toEqual({ expenses: 18_500_000n, income: 0n });
    expect(await ids({ type: "INCOME" })).toEqual([salary.id]);
    expect(await ids({ payerMemberId: juan })).toEqual([juanPays.id]);
    expect(await ids({ participantMemberId: juan })).toEqual([juanPays.id]);
  });

  it("visits 120 transactions on the same date exactly once, newest first (Review Focus 2)", async () => {
    const w = await world();
    await store(...Array.from({ length: 120 }, () => expense(w, "2026-10-15", 100n)));
    const seen: string[] = [];
    const sizes: number[] = [];
    let after: TransactionPosition | null = null;
    do {
      const rows = await queries.list(october(w), after, 51);
      const items = rows.slice(0, 50);
      sizes.push(items.length);
      seen.push(...items.map((t) => t.id));
      const last = items.at(-1);
      after = rows.length > 50 && last ? { date: last.date, id: last.id } : null;
    } while (after);
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
    expect(seen).toEqual([...seen].sort().reverse());
  });
});

describe("net account movements (HU-E2-04)", () => {
  it("adds incomes and transfers in, subtracts transfers out and payments", async () => {
    const w = await world();
    await store(income(w, "2026-10-01", 300_000_000n), expense(w, "2026-10-05", 8_500_000n), transfer(w, "2026-10-06", 50_000_000n));
    const net = await queries.netMovements([w.bank, w.wallet], null);
    expect(net.get(w.bank)).toBe(241_500_000n);
    expect(net.get(w.wallet)).toBe(50_000_000n);
  });

  it("reduces the payer account by the full payment of a shared expense", async () => {
    const w = await world();
    const juan = await guestMemberFixture(pool, w.space);
    await store(
      expense(w, "2026-10-05", 30_000_000n, {
        shares: [
          { memberId: w.space.memberId, amount: 15_000_000n, splitMethod: "EQUAL" },
          { memberId: juan, amount: 15_000_000n, splitMethod: "EQUAL" },
        ],
      }),
    );
    expect((await queries.netMovements([w.bank], null)).get(w.bank)).toBe(-30_000_000n);
  });

  it("ignores soft-deleted transactions", async () => {
    const w = await world();
    await store(softDelete(expense(w, "2026-10-05", 8_500_000n), new Date()));
    expect((await queries.netMovements([w.bank], null)).get(w.bank) ?? 0n).toBe(0n);
  });

  it("counts only transactions dated on or before asOf", async () => {
    const w = await world();
    await store(expense(w, "2026-10-05", 1_000n), expense(w, "2026-11-03", 2_000n));
    expect((await queries.netMovements([w.bank], "2026-10-31" as LocalDate)).get(w.bank)).toBe(-1_000n);
    expect((await queries.netMovements([w.bank], null)).get(w.bank)).toBe(-3_000n);
  });

  it("stays exact beyond the bigint range (Review Focus 5)", async () => {
    const w = await world();
    await store(income(w, "2026-10-01", 6_000_000_000_000_000_000n), income(w, "2026-10-02", 6_000_000_000_000_000_000n));
    expect((await queries.netMovements([w.bank], null)).get(w.bank)).toBe(12_000_000_000_000_000_000n);
    expect(await queries.totals(october(w))).toEqual({ expenses: 0n, income: 12_000_000_000_000_000_000n });
  });

  it("returns nothing for no ids or malformed ids", async () => {
    expect((await queries.netMovements([], null)).size).toBe(0);
    expect((await queries.netMovements(["not-a-uuid"], null)).size).toBe(0);
  });
});

describe("references", () => {
  it("reports categories referenced by live or deleted transactions, and spaces with transactions", async () => {
    const w = await world();
    expect(await queries.hasTransactions(w.space.spaceId)).toBe(false);
    expect(await queries.isCategoryReferenced(w.groceries)).toBe(false);
    await store(softDelete(expense(w, "2026-10-05", 100n), new Date()));
    expect(await queries.isCategoryReferenced(w.groceries)).toBe(true);
    expect(await queries.isCategoryReferenced(w.restaurants)).toBe(false);
    expect(await queries.hasTransactions(w.space.spaceId)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project integration src/modules/ledger/infrastructure/drizzle-ledger-queries.int.test.ts`
Expected: FAIL — `Failed to resolve import "./drizzle-ledger-queries"`.

- [ ] **Step 3: Implement**

`src/modules/ledger/infrastructure/drizzle-ledger-queries.ts`:

```ts
import { and, between, desc, eq, exists, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid, type LocalDate } from "@/shared/kernel";
import type { TransactionFilter, TransactionPosition, TransactionQuery } from "../application/ports";
import type { Transaction } from "../domain/transaction";
import { payments, shares, transactions } from "./ledger.schema";
import { loadTransactions } from "./transaction-rows";

// SUM(bigint) is numeric in PostgreSQL: read it as text and parse it as bigint, so sums never overflow or round.
const sumAsText = (column: typeof transactions.amount | typeof payments.amount) => sql<string>`sum(${column})::text`;

/** Read side of the ledger, computed on read (D7): the monthly list, totals, account movements and references. */
export class DrizzleLedgerQueries implements TransactionQuery {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async list(filter: TransactionFilter, after: TransactionPosition | null, limit: number): Promise<Transaction[]> {
    const db = this.tm.executor();
    const rows = await db
      .select()
      .from(transactions)
      .where(
        and(
          this.matching(filter),
          after === null
            ? undefined
            : or(
                lt(transactions.date, after.date),
                and(eq(transactions.date, after.date), lt(transactions.id, after.id)),
              ),
        ),
      )
      .orderBy(desc(transactions.date), desc(transactions.id))
      .limit(limit);
    return loadTransactions(db, rows);
  }

  async totals(filter: TransactionFilter): Promise<{ expenses: bigint; income: bigint }> {
    const [row] = await this.tm
      .executor()
      .select({
        expenses: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'EXPENSE'), 0)::text`,
        income: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'INCOME'), 0)::text`,
      })
      .from(transactions)
      .where(this.matching(filter));
    return { expenses: BigInt(row?.expenses ?? "0"), income: BigInt(row?.income ?? "0") };
  }

  /** HU-E2-04: incomes and transfers in, minus transfers out and payments out, per account. */
  async netMovements(accountIds: readonly string[], asOf: LocalDate | null): Promise<ReadonlyMap<string, bigint>> {
    const ids = accountIds.filter(isUuid);
    const net = new Map<string, bigint>();
    if (ids.length === 0) return net;
    const db = this.tm.executor();
    const live = and(isNull(transactions.deletedAt), asOf === null ? undefined : lte(transactions.date, asOf));
    const incoming = await db
      .select({ accountId: transactions.destinationAccountId, total: sumAsText(transactions.amount) })
      .from(transactions)
      .where(and(live, inArray(transactions.destinationAccountId, ids)))
      .groupBy(transactions.destinationAccountId);
    const outgoing = await db
      .select({ accountId: transactions.sourceAccountId, total: sumAsText(transactions.amount) })
      .from(transactions)
      .where(and(live, inArray(transactions.sourceAccountId, ids)))
      .groupBy(transactions.sourceAccountId);
    const paid = await db
      .select({ accountId: payments.accountId, total: sumAsText(payments.amount) })
      .from(payments)
      .innerJoin(transactions, eq(transactions.id, payments.transactionId))
      .where(and(live, inArray(payments.accountId, ids)))
      .groupBy(payments.accountId);
    const add = (accountId: string | null, delta: bigint) => {
      if (accountId !== null) net.set(accountId, (net.get(accountId) ?? 0n) + delta);
    };
    for (const row of incoming) add(row.accountId, BigInt(row.total));
    for (const row of outgoing) add(row.accountId, -BigInt(row.total));
    for (const row of paid) add(row.accountId, -BigInt(row.total));
    return net;
  }

  /** HU-E3-03: soft-deleted transactions still reference their category (D8). */
  async isCategoryReferenced(categoryId: string): Promise<boolean> {
    if (!isUuid(categoryId)) return false;
    const rows = await this.tm
      .executor()
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.categoryId, categoryId))
      .limit(1);
    return rows.length > 0;
  }

  async hasTransactions(spaceId: string): Promise<boolean> {
    if (!isUuid(spaceId)) return false;
    const rows = await this.tm
      .executor()
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.spaceId, spaceId))
      .limit(1);
    return rows.length > 0;
  }

  private matching(f: TransactionFilter) {
    const db = this.tm.executor();
    return and(
      eq(transactions.spaceId, f.spaceId),
      isNull(transactions.deletedAt),
      between(transactions.date, f.from, f.to),
      f.type === undefined ? undefined : eq(transactions.type, f.type),
      f.categoryIds === undefined || f.categoryIds.length === 0
        ? undefined
        : inArray(transactions.categoryId, [...f.categoryIds]),
      f.payerMemberId === undefined
        ? undefined
        : exists(
            db
              .select({ one: sql`1` })
              .from(payments)
              .where(and(eq(payments.transactionId, transactions.id), eq(payments.memberId, f.payerMemberId))),
          ),
      f.participantMemberId === undefined
        ? undefined
        : exists(
            db
              .select({ one: sql`1` })
              .from(shares)
              .where(and(eq(shares.transactionId, transactions.id), eq(shares.memberId, f.participantMemberId))),
          ),
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project integration src/modules/ledger`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/infrastructure/drizzle-ledger-queries.ts src/modules/ledger/infrastructure/drizzle-ledger-queries.int.test.ts
git commit -m "feat(ledger): query transactions by period, totals, account movements and references (Refs #34, Refs #26)"
```

---

### Task 22: HTTP — seed categories on space creation and read the tree

Completes HU-E3-01 (issue #27) end to end: `CreatePersonalSpace` notifies a `SpaceCreatedListener` inside its transaction, the composition root binds it to `SeedDefaultCategories` with the user's locale, and `GET /api/v1/spaces/{spaceId}/categories` returns the tree. If seeding fails, the space transaction rolls back and sign-up compensates by deleting the user (M0 behaviour), so no user is left without categories.

Also adds the shared OpenAPI helpers and the acceptance helpers every later HTTP task uses, and checks once that `next build` accepts dynamic route handlers built with `defineRoute`.

Decision (open question in the summary): personal spaces created during M0 have no categories; no backfill is planned because M0 only ran with test users. If real users exist, run `SeedDefaultCategories` for their spaces once (it is idempotent).

**Files:**
- Modify: `src/modules/spaces/application/create-personal-space.ts`, `src/modules/spaces/application/create-personal-space.test.ts`, `src/modules/spaces/application/index.ts`
- Modify: `src/shared/http/contracts.ts`, `src/shared/http/contracts.test.ts`
- Create: `src/modules/categories/contracts/categories.contract.ts`
- Create: `src/app/api/v1/spaces/[spaceId]/categories/route.ts`
- Modify: `src/composition/container.ts`, `src/composition/openapi.ts`, `openapi/openapi.snapshot.json`
- Modify: `tests/support/app.ts`
- Test: `tests/acceptance/categories.test.ts`

**Interfaces:**
- Consumes: `createSeedDefaultCategories`, `createListCategories`, `CategoriesDeps`, `CategoryGroupView` (Task 5); `DrizzleCategoryRepository` (Task 9); `createSpaceAccess` (Task 2); `DrizzleSpaceRepository` (Task 3); `problemContent` (M0).
- Produces:
  - `type SpaceCreatedListener = (space: Space, context: { locale: string }) => Promise<Result<void>>`; `CreatePersonalSpaceDeps.onCreated`; `CreatePersonalSpace = (owner: { userId: string; name: string; locale: string }) => Promise<Result<Space>>`
  - `jsonContent(schema)`, `problems(descriptions: Record<string, string>)`, `securedByUser` (shared/http/contracts.ts)
  - `CategorySchema`, `CategoryGroupSummarySchema`, `CategoryGroupSchema`, `ListCategoriesQuerySchema`, `categoryDto`, `categoryGroupDto`, `categoryTreeDto`, `categoriesPaths`
  - `GET /api/v1/spaces/{spaceId}/categories?archived=true|false` → `200 { items: CategoryGroup[] }`
  - `Container.categories.listCategories`
  - `tests/support/app.ts`: `interface TestUser { cookie: string; userId: string; spaceId: string }`, `registerUser(name?): Promise<TestUser>`, `routeParams(params)`, `type RouteHandler`, `call(handler, method, path, options?: { user?; params?; body?; headers? }): Promise<Response>`

- [ ] **Step 1: Write the failing unit tests**

Replace `src/modules/spaces/application/create-personal-space.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  domainError,
  err,
  FixedClock,
  ok,
  type Id,
  type IdGenerator,
  type TransactionManager,
} from "@/shared/kernel";
import type { Space } from "../domain/space";
import { createCreatePersonalSpace, type SpaceCreatedListener } from "./create-personal-space";
import type { SpaceRepository, SpaceSummary } from "./space-repository";

class InMemorySpaces implements SpaceRepository {
  readonly saved: Space[] = [];
  async add(space: Space) {
    this.saved.push(space);
  }
  async hasPersonalSpace(userId: string) {
    return this.saved.some((s) => s.kind === "PERSONAL" && s.personalOwnerUserId === userId);
  }
  async listForUser(): Promise<SpaceSummary[]> {
    return [];
  }
}

const ids = (): IdGenerator => {
  let n = 0;
  return { next: <B extends string>() => `id-${++n}` as Id<B> };
};
const tm: TransactionManager = { run: (work) => work() };
const clock = new FixedClock(new Date("2026-10-11T00:00:00Z"));
const noop: SpaceCreatedListener = async () => ok(undefined);
const ana = { userId: "u-ana", name: "Ana", locale: "es" };

describe("CreatePersonalSpace", () => {
  it("creates exactly one personal space for the owner", async () => {
    const spaces = new InMemorySpaces();
    const create = createCreatePersonalSpace({ spaces, ids: ids(), clock, tm, onCreated: noop });
    const result = await create(ana);
    expect(result.ok).toBe(true);
    expect(spaces.saved).toHaveLength(1);
    expect(spaces.saved[0]).toMatchObject({ id: "id-1", kind: "PERSONAL", personalOwnerUserId: "u-ana" });
  });

  it("refuses a second personal space", async () => {
    const spaces = new InMemorySpaces();
    const create = createCreatePersonalSpace({ spaces, ids: ids(), clock, tm, onCreated: noop });
    await create(ana);
    const second = await create(ana);
    expect(!second.ok && second.error.code).toBe("PersonalSpaceAlreadyExists");
    expect(spaces.saved).toHaveLength(1);
  });

  it("lets listeners react to the new space with the owner's locale (HU-E3-01)", async () => {
    const seen: [string, string][] = [];
    const create = createCreatePersonalSpace({
      spaces: new InMemorySpaces(),
      ids: ids(),
      clock,
      tm,
      onCreated: async (space, { locale }) => {
        seen.push([space.id, locale]);
        return ok(undefined);
      },
    });
    await create({ ...ana, locale: "en" });
    expect(seen).toEqual([["id-1", "en"]]);
  });

  it("fails when a listener fails, so the surrounding transaction rolls back", async () => {
    const create = createCreatePersonalSpace({
      spaces: new InMemorySpaces(),
      ids: ids(),
      clock,
      tm,
      onCreated: async () => err(domainError("SeedFailed")),
    });
    const result = await create(ana);
    expect(!result.ok && result.error.code).toBe("SeedFailed");
  });
});
```

Append to `src/shared/http/contracts.test.ts` (and add `problems` to its import from `./contracts`):

```ts
describe("problems", () => {
  it("builds problem+json responses keyed by status", () => {
    expect(problems({ "404": "SpaceNotFound" })).toEqual({
      "404": { description: "SpaceNotFound", content: { "application/problem+json": { schema: ProblemSchema } } },
    });
  });
});
```

(add `ProblemSchema` to the same import if it is not imported yet).

Run: `pnpm exec vitest run --project unit src/modules/spaces src/shared/http/contracts.test.ts`
Expected: FAIL — TypeScript/Vitest reports `onCreated` unknown and the listener test fails (no call recorded); `problems is not a function`.

- [ ] **Step 2: Implement the listener and the shared OpenAPI helpers**

Replace `src/modules/spaces/application/create-personal-space.ts` with:

```ts
import {
  domainError,
  err,
  ok,
  type Clock,
  type IdGenerator,
  type Result,
  type TransactionManager,
} from "@/shared/kernel";
import { createPersonalSpace, type Space } from "../domain/space";
import type { SpaceRepository } from "./space-repository";

/** Reacts to a new space inside its transaction, e.g. seeding default categories (HU-E3-01). */
export type SpaceCreatedListener = (space: Space, context: { readonly locale: string }) => Promise<Result<void>>;

export interface CreatePersonalSpaceDeps {
  readonly spaces: SpaceRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly tm: TransactionManager;
  readonly onCreated: SpaceCreatedListener;
}

export type CreatePersonalSpace = (owner: { userId: string; name: string; locale: string }) => Promise<Result<Space>>;

export const createCreatePersonalSpace =
  (deps: CreatePersonalSpaceDeps): CreatePersonalSpace =>
  (owner) =>
    deps.tm.run(async () => {
      if (await deps.spaces.hasPersonalSpace(owner.userId))
        return err(domainError("PersonalSpaceAlreadyExists"));
      const space = createPersonalSpace({
        id: deps.ids.next<"Space">(),
        memberId: deps.ids.next<"SpaceMember">(),
        ownerUserId: owner.userId,
        ownerName: owner.name,
        now: deps.clock.now(),
      });
      await deps.spaces.add(space);
      const reacted = await deps.onCreated(space, { locale: owner.locale });
      if (!reacted.ok) return reacted;
      return ok(space);
    });
```

In `src/modules/spaces/application/index.ts`, replace the `create-personal-space` export with:

```ts
export {
  createCreatePersonalSpace,
  type CreatePersonalSpace,
  type SpaceCreatedListener,
} from "./create-personal-space";
```

Append to `src/shared/http/contracts.ts`:

```ts
/** `content` of a JSON request or response. */
export const jsonContent = (schema: z.ZodType) => ({ "application/json": { schema } });

/** Problem responses keyed by status, e.g. `problems({ "404": "SpaceNotFound" })`. */
export const problems = (descriptions: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(descriptions).map(([status, description]) => [status, { description, content: problemContent }]),
  );

/** Operations that need a signed-in user accept the session cookie or a Bearer token. */
export const securedByUser = { security: [{ cookieAuth: [] }, { bearerAuth: [] }] };
```

Run: `pnpm exec vitest run --project unit src/modules/spaces src/shared/http/contracts.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the acceptance helpers and the failing acceptance test**

Append to `tests/support/app.ts` (and add the imports at the top):

```ts
import { POST as signUp } from "@/app/api/v1/auth/sign-up/route";
import { GET as listSpaces } from "@/app/api/v1/spaces/route";
```

```ts
export interface TestUser {
  readonly cookie: string;
  readonly userId: string;
  readonly spaceId: string;
}

/** Signs a fresh user up over HTTP; returns their session cookie and personal space id. */
export const registerUser = async (name = "Ana"): Promise<TestUser> => {
  const created = await signUp(
    apiRequest("POST", "/api/v1/auth/sign-up", {
      body: { name, email: uniqueEmail(name.toLowerCase()), password: "123456789012" },
    }),
  );
  if (created.status !== 201) throw new Error(`sign-up failed with status ${created.status}`);
  const cookie = cookieHeader(created);
  const { user } = (await created.json()) as { user: { id: string } };
  const spaces = await listSpaces(apiRequest("GET", "/api/v1/spaces", { headers: { cookie } }));
  const { items } = (await spaces.json()) as { items: { id: string }[] };
  return { cookie, userId: user.id, spaceId: items[0]!.id };
};

export const routeParams = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

export type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

/** Calls a route handler in-process as `user`, with path params, JSON body and extra headers. */
export const call = (
  handler: RouteHandler,
  method: string,
  path: string,
  options: { user?: TestUser; params?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> =>
  handler(
    apiRequest(method, path, {
      body: options.body,
      headers: { ...(options.user ? { cookie: options.user.cookie } : {}), ...options.headers },
    }),
    routeParams(options.params ?? {}),
  );
```

`tests/acceptance/categories.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listCategories } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type TestUser } from "../support/app";

interface CategoryDto {
  id: string;
  groupId: string;
  name: string;
  key: string | null;
  archivedAt: string | null;
}
interface GroupDto {
  id: string;
  name: string;
  archivedAt: string | null;
  categories: CategoryDto[];
}

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const treeOf = (user: TestUser | undefined, spaceId: string, query = "") =>
  call(listCategories, "GET", `/api/v1/spaces/${spaceId}/categories${query}`, { user, params: { spaceId } });
const groupsIn = async (response: Response) => ((await response.json()) as { items: GroupDto[] }).items;

describe("default categories (HU-E3-01)", () => {
  it("seeds the Spanish tree into the personal space at sign-up", async () => {
    const ana = await registerUser("Ana");
    const response = await treeOf(ana, ana.spaceId);
    expect(response.status).toBe(200);
    const groups = await groupsIn(response);
    const names = (group: string) => groups.find((g) => g.name === group)?.categories.map((c) => c.name);
    expect(names("Vivienda")).toEqual(["Arriendo", "Mantenimiento", "Servicios"]);
    expect(names("Ingresos")).toEqual(["Otros ingresos", "Salario"]);
    expect(groups.flatMap((g) => g.categories)).toContainEqual(
      expect.objectContaining({ name: "Mercado", key: "groceries", archivedAt: null }),
    );
  });

  it("hides another user's space and malformed ids as SpaceNotFound (Review Focus 4)", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    for (const spaceId of [ana.spaceId, "not-a-uuid"]) {
      const response = await treeOf(juan, spaceId);
      expect(response.status).toBe(404);
      expect((await response.json()).code).toBe("SpaceNotFound");
    }
  });

  it("requires authentication", async () => {
    const ana = await registerUser("Ana");
    expect((await treeOf(undefined, ana.spaceId)).status).toBe(401);
  });
});
```

Run: `pnpm exec vitest run --project acceptance tests/acceptance/categories.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/categories/route"`.

- [ ] **Step 4: Contract, route and wiring**

`src/modules/categories/contracts/categories.contract.ts`:

```ts
import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, problems, securedByUser } from "@/shared/http/contracts";
import type { Category, CategoryGroup, CategoryGroupView } from "../application";

export const CategorySchema = z.object({
  id: z.string(),
  groupId: z.string(),
  name: z.string(),
  /** Stable catalog key of seeded categories; null for user-created ones. */
  key: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
});
export const CategoryGroupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  archivedAt: z.iso.datetime().nullable(),
});
export const CategoryGroupSchema = CategoryGroupSummarySchema.extend({ categories: z.array(CategorySchema) });

export const ListCategoriesQuerySchema = z.object({ archived: z.enum(["true", "false"]).optional() });
export const ListCategoriesResponseSchema = z.object({ items: z.array(CategoryGroupSchema) });

const isoOrNull = (date: Date | null) => date?.toISOString() ?? null;

export const categoryDto = (c: Category): z.infer<typeof CategorySchema> => ({
  id: c.id,
  groupId: c.groupId,
  name: c.name,
  key: c.key,
  archivedAt: isoOrNull(c.archivedAt),
});

export const categoryGroupDto = (g: CategoryGroup): z.infer<typeof CategoryGroupSummarySchema> => ({
  id: g.id,
  name: g.name,
  archivedAt: isoOrNull(g.archivedAt),
});

export const categoryTreeDto = (g: CategoryGroupView): z.infer<typeof CategoryGroupSchema> => ({
  ...categoryGroupDto(g),
  categories: g.categories.map(categoryDto),
});

const SpacePath = z.object({ spaceId: z.string() });

export const categoriesPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces/{spaceId}/categories": {
    get: {
      operationId: "listCategories",
      summary: "Category tree of a space; archived groups and categories only with archived=true",
      ...securedByUser,
      requestParams: { path: SpacePath, query: ListCategoriesQuerySchema },
      responses: {
        "200": { description: "Groups with their categories, sorted by name", content: jsonContent(ListCategoriesResponseSchema) },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound", "422": "ValidationFailed" }),
      },
    },
  },
};
```

`src/app/api/v1/spaces/[spaceId]/categories/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { categoryTreeDto, ListCategoriesQuerySchema } from "@/modules/categories/contracts/categories.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: ListCategoriesQuerySchema,
  handler: async ({ user, params, query }) => {
    const result = await getContainer().categories.listCategories({
      spaceId: params.spaceId!,
      userId: user!.id,
      includeArchived: query.archived === "true",
    });
    return result.ok ? ok({ status: 200, body: { items: result.value.map(categoryTreeDto) } }) : result;
  },
});
```

Replace `src/composition/container.ts` with:

```ts
import type { Pool } from "pg";
import {
  createListCategories,
  createSeedDefaultCategories,
  type CategoriesDeps,
  type ListCategories,
} from "@/modules/categories/application";
import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";
import {
  createSignIn,
  createSignOut,
  createSignUp,
  type SignIn,
  type SignOut,
  type SignUp,
} from "@/modules/identity/application";
import { createAuth } from "@/modules/identity/infrastructure/better-auth";
import { BetterAuthProvider } from "@/modules/identity/infrastructure/better-auth-provider";
import {
  createCreatePersonalSpace,
  createListMySpaces,
  createSpaceAccess,
  type CreatePersonalSpace,
  type ListMySpaces,
} from "@/modules/spaces/application";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { createFixedWindowLimiter, jsonLogger, type IdempotencyDeps, type RouteDeps } from "@/shared/http";
import { createDatabase, type Database } from "@/shared/infrastructure/db/client";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { DrizzleIdempotencyStore } from "@/shared/infrastructure/drizzle-idempotency-store";
import { loadEnv, type Env } from "@/shared/infrastructure/env";
import { SystemClock } from "@/shared/infrastructure/system-clock";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { map, type AuthUser, type Result } from "@/shared/kernel";

/** Process-wide dependencies, built once from the environment. */
export interface Container extends RouteDeps {
  readonly db: Database;
  readonly pool: Pool;
  readonly tm: DrizzleTransactionManager;
  readonly idempotency: IdempotencyDeps;
  readonly identity: { readonly signUp: SignUp; readonly signIn: SignIn; readonly signOut: SignOut };
  readonly spaces: { readonly createPersonalSpace: CreatePersonalSpace; readonly listMySpaces: ListMySpaces };
  readonly categories: { readonly listCategories: ListCategories };
  /** Brute-force guards for the unauthenticated identity routes; false means "reject with 429". */
  readonly authThrottle: {
    readonly signIn: (ip: string, email: string) => boolean;
    readonly signUp: (ip: string) => boolean;
  };
}

export interface AuthLimits {
  /** Sign-in attempts per email per 15 minutes. */
  readonly signInPerEmail: number;
  /** Sign-in attempts per client address per 15 minutes. */
  readonly signInPerIp: number;
  /** Sign-ups per client address per hour. */
  readonly signUpPerIp: number;
}

const DEFAULT_AUTH_LIMITS: AuthLimits = { signInPerEmail: 10, signInPerIp: 30, signUpPerIp: 10 };
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

export interface ContainerOptions {
  /** Test seam: replaces the post-sign-up provisioning step. */
  readonly provisionUser?: (user: AuthUser) => Promise<Result<void>>;
  readonly authLimits?: AuthLimits;
}

export const buildContainer = (env: Env, options: ContainerOptions = {}): Container => {
  const { db, pool } = createDatabase(env.DATABASE_URL);
  const tm = new DrizzleTransactionManager(db);
  const ids = new UuidV7IdGenerator();
  const clock = new SystemClock();
  const provider = new BetterAuthProvider(
    createAuth({ db, secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL }),
    db,
  );
  const spaceRepository = new DrizzleSpaceRepository(tm);
  const access = createSpaceAccess(spaceRepository);
  const categoriesDeps: CategoriesDeps = { categories: new DrizzleCategoryRepository(tm), access, ids, clock, tm };
  const seedDefaultCategories = createSeedDefaultCategories(categoriesDeps);
  const createPersonalSpace = createCreatePersonalSpace({
    spaces: spaceRepository,
    ids,
    clock,
    tm,
    // HU-E3-01: default categories are seeded in the same transaction as the space.
    onCreated: (space, { locale }) => seedDefaultCategories({ spaceId: space.id, locale }),
  });
  // HU-E1-02: every new user gets a personal space; sign-up compensates if this fails.
  const provisionUser =
    options.provisionUser ??
    (async (u: AuthUser) =>
      map(await createPersonalSpace({ userId: u.id, name: u.name, locale: u.locale }), () => undefined));
  const limits = options.authLimits ?? DEFAULT_AUTH_LIMITS;
  const signInByEmail = createFixedWindowLimiter({ limit: limits.signInPerEmail, windowMs: FIFTEEN_MINUTES });
  const signInByIp = createFixedWindowLimiter({ limit: limits.signInPerIp, windowMs: FIFTEEN_MINUTES });
  const signUpByIp = createFixedWindowLimiter({ limit: limits.signUpPerIp, windowMs: ONE_HOUR });
  return {
    db,
    pool,
    tm,
    logger: jsonLogger,
    sessionResolver: provider,
    idempotency: { tm, store: new DrizzleIdempotencyStore(tm) },
    identity: {
      signUp: createSignUp({ auth: provider, provisionUser }),
      signIn: createSignIn(provider),
      signOut: createSignOut(provider),
    },
    spaces: { createPersonalSpace, listMySpaces: createListMySpaces(spaceRepository) },
    categories: { listCategories: createListCategories(categoriesDeps) },
    authThrottle: {
      // Both counters advance on every attempt, so neither can be probed independently.
      signIn: (ip, email) => [signInByIp.hit(ip), signInByEmail.hit(email)].every(Boolean),
      signUp: (ip) => signUpByIp.hit(ip),
    },
  };
};

let container: Container | undefined;

export const getContainer = (): Container => (container ??= buildContainer(loadEnv()));

export const setContainerForTests = (next: Container | undefined): void => {
  container = next;
};
```

In `src/composition/openapi.ts`, add the import

```ts
import {
  categoriesPaths,
  CategoryGroupSchema,
  CategoryGroupSummarySchema,
  CategorySchema,
} from "@/modules/categories/contracts/categories.contract";
```

add `...categoriesPaths` at the end of `paths`, and add to `components.schemas`:

```ts
        Category: CategorySchema,
        CategoryGroup: CategoryGroupSchema,
        CategoryGroupSummary: CategoryGroupSummarySchema,
```

- [ ] **Step 5: Run the acceptance test and refresh the contract snapshot**

Run: `pnpm exec vitest run --project acceptance`
Expected: PASS (auth, personal-space and categories files).

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts`, then `git diff --stat openapi/openapi.snapshot.json` and inspect: it must only add `GET /api/v1/spaces/{spaceId}/categories` and the three category component schemas.
Expected: snapshot rewritten; the diff matches.

- [ ] **Step 6: Check that Next.js accepts the dynamic route handlers**

Run: `pnpm build`
Expected: "Compiled successfully" and the route list contains `ƒ /api/v1/spaces/[spaceId]/categories`. (Next.js type-checks route handler signatures; `defineRoute`'s optional `context?: { params?: Promise<P> }` is compatible with the generated `{ params: Promise<{ spaceId: string }> }`. If the build reports a route-signature error, stop and report it instead of changing `define-route.ts` inside this task.)

- [ ] **Step 7: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/modules/spaces/application src/shared/http/contracts.ts src/shared/http/contracts.test.ts src/modules/categories/contracts "src/app/api/v1/spaces/[spaceId]/categories/route.ts" src/composition openapi/openapi.snapshot.json tests/support/app.ts tests/acceptance/categories.test.ts
git commit -m "feat(categories): seed default categories with each new space and serve the category tree (Refs #27)"
```

---

### Task 23: HTTP — manage groups and categories

Exposes HU-E3-02 (issue #28): `POST /category-groups`, `PATCH /category-groups/{groupId}`, `POST /categories`, `PATCH /categories/{categoryId}` (rename and/or move). The viewer scenario stays a unit test (Task 6): roles other than OWNER exist only with shared spaces (M2).

**Files:**
- Modify: `src/modules/categories/contracts/categories.contract.ts`, `src/app/api/v1/spaces/[spaceId]/categories/route.ts`
- Create: `src/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route.ts`, `src/app/api/v1/spaces/[spaceId]/category-groups/route.ts`, `src/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/route.ts`
- Modify: `src/composition/container.ts`, `openapi/openapi.snapshot.json`
- Test: `tests/acceptance/categories.test.ts`

**Interfaces:**
- Consumes: `createCreateCategoryGroup`, `createRenameCategoryGroup`, `createCreateCategory`, `createUpdateCategory` (Task 6); contract and helpers (Task 22).
- Produces:
  - `CategoryGroupBodySchema { name }`, `CreateCategoryBodySchema { groupId, name }`, `UpdateCategoryBodySchema { name?, groupId? }`
  - `POST /api/v1/spaces/{spaceId}/category-groups` → `201 CategoryGroupSummary`; `PATCH /api/v1/spaces/{spaceId}/category-groups/{groupId}` → `200 CategoryGroupSummary`
  - `POST /api/v1/spaces/{spaceId}/categories` → `201 Category`; `PATCH /api/v1/spaces/{spaceId}/categories/{categoryId}` → `200 Category`
  - `Container.categories.{createCategoryGroup, renameCategoryGroup, createCategory, updateCategory}`

- [ ] **Step 1: Write the failing acceptance test**

In `tests/acceptance/categories.test.ts`, replace the categories route import with the following imports:

```ts
import { GET as listCategories, POST as createCategory } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { PATCH as updateCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route";
import { POST as createGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/route";
import { PATCH as renameGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/route";
```

and append:

```ts
describe("managing the category tree (HU-E3-02)", () => {
  const helpers = (user: TestUser) => {
    const base = `/api/v1/spaces/${user.spaceId}`;
    const groups = async () => groupsIn(await treeOf(user, user.spaceId));
    return {
      base,
      group: async (name: string) => (await groups()).find((g) => g.name === name)!,
      category: async (name: string) => (await groups()).flatMap((g) => g.categories).find((c) => c.name === name)!,
    };
  };

  it("creates groups and categories, renames and moves them", async () => {
    const ana = await registerUser("Ana");
    const { base, group, category } = helpers(ana);
    const params = { spaceId: ana.spaceId };

    const pets = await call(createGroup, "POST", `${base}/category-groups`, { user: ana, params, body: { name: "Mascotas" } });
    expect(pets.status).toBe(201);
    expect(await pets.json()).toMatchObject({ name: "Mascotas", archivedAt: null });

    const food = await group("Alimentación");
    const bakery = await call(createCategory, "POST", `${base}/categories`, {
      user: ana,
      params,
      body: { groupId: food.id, name: "Panadería" },
    });
    expect(bakery.status).toBe(201);
    expect(await bakery.json()).toMatchObject({ groupId: food.id, name: "Panadería", key: null });

    const leisure = await group("Ocio");
    const renamed = await call(renameGroup, "PATCH", `${base}/category-groups/${leisure.id}`, {
      user: ana,
      params: { ...params, groupId: leisure.id },
      body: { name: "Diversión" },
    });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).name).toBe("Diversión");

    const pharmacy = await category("Farmacia");
    const moved = await call(updateCategory, "PATCH", `${base}/categories/${pharmacy.id}`, {
      user: ana,
      params: { ...params, categoryId: pharmacy.id },
      body: { groupId: food.id },
    });
    expect(await moved.json()).toMatchObject({ id: pharmacy.id, groupId: food.id, key: "pharmacy" });
  });

  it("answers tree violations with stable codes", async () => {
    const ana = await registerUser("Ana");
    const { base, group, category } = helpers(ana);
    const params = { spaceId: ana.spaceId };
    const food = await group("Alimentación");
    const mercado = await category("Mercado");
    const create = (body: unknown) => call(createCategory, "POST", `${base}/categories`, { user: ana, params, body });

    const third = await create({ groupId: mercado.id, name: "Orgánico" });
    expect([third.status, (await third.json()).code]).toEqual([409, "CategoryDepthExceeded"]);
    const duplicate = await create({ groupId: food.id, name: "mercado" });
    expect([duplicate.status, (await duplicate.json()).code]).toEqual([409, "CategoryNameTaken"]);
    const blank = await create({ groupId: food.id, name: "   " });
    expect([blank.status, (await blank.json()).code]).toEqual([422, "InvalidCategoryName"]);
    const unknown = await create({ groupId: "nope", name: "Pan" });
    expect([unknown.status, (await unknown.json()).code]).toEqual([404, "CategoryGroupNotFound"]);
  });

  it("hides another user's space", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const response = await call(createGroup, "POST", `/api/v1/spaces/${ana.spaceId}/category-groups`, {
      user: juan,
      params: { spaceId: ana.spaceId },
      body: { name: "Mascotas" },
    });
    expect([response.status, (await response.json()).code]).toEqual([404, "SpaceNotFound"]);
  });
});
```

Run: `pnpm exec vitest run --project acceptance tests/acceptance/categories.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route"`.

- [ ] **Step 2: Extend the contract**

In `src/modules/categories/contracts/categories.contract.ts`, add after `ListCategoriesResponseSchema`:

```ts
// Length rules live in the domain (InvalidCategoryName); the cap only bounds payload size.
const Name = z.string().max(200);
const ParentId = z.string().min(1).max(64);
export const CategoryGroupBodySchema = z.object({ name: Name });
export const CreateCategoryBodySchema = z.object({ groupId: ParentId, name: Name });
export const UpdateCategoryBodySchema = z.object({ name: Name.optional(), groupId: ParentId.optional() });
```

and replace `categoriesPaths` with:

```ts
const CategoryPath = SpacePath.extend({ categoryId: z.string() });
const GroupPath = SpacePath.extend({ groupId: z.string() });
const managed = { "401": "Unauthenticated", "403": "InsufficientRole" };

export const categoriesPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces/{spaceId}/categories": {
    get: {
      operationId: "listCategories",
      summary: "Category tree of a space; archived groups and categories only with archived=true",
      ...securedByUser,
      requestParams: { path: SpacePath, query: ListCategoriesQuerySchema },
      responses: {
        "200": { description: "Groups with their categories, sorted by name", content: jsonContent(ListCategoriesResponseSchema) },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound", "422": "ValidationFailed" }),
      },
    },
    post: {
      operationId: "createCategory",
      summary: "Create a category in a group (two levels only)",
      ...securedByUser,
      requestParams: { path: SpacePath },
      requestBody: { content: jsonContent(CreateCategoryBodySchema) },
      responses: {
        "201": { description: "The new category", content: jsonContent(CategorySchema) },
        ...problems({
          ...managed,
          "404": "SpaceNotFound, CategoryGroupNotFound",
          "409": "CategoryNameTaken, CategoryDepthExceeded, CategoryGroupArchived",
          "422": "ValidationFailed, InvalidCategoryName",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/categories/{categoryId}": {
    patch: {
      operationId: "updateCategory",
      summary: "Rename a category and/or move it to another group",
      ...securedByUser,
      requestParams: { path: CategoryPath },
      requestBody: { content: jsonContent(UpdateCategoryBodySchema) },
      responses: {
        "200": { description: "The updated category", content: jsonContent(CategorySchema) },
        ...problems({
          ...managed,
          "404": "SpaceNotFound, CategoryNotFound, CategoryGroupNotFound",
          "409": "CategoryNameTaken, CategoryDepthExceeded, CategoryGroupArchived",
          "422": "ValidationFailed, InvalidCategoryName",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/category-groups": {
    post: {
      operationId: "createCategoryGroup",
      summary: "Create a category group",
      ...securedByUser,
      requestParams: { path: SpacePath },
      requestBody: { content: jsonContent(CategoryGroupBodySchema) },
      responses: {
        "201": { description: "The new group", content: jsonContent(CategoryGroupSummarySchema) },
        ...problems({ ...managed, "404": "SpaceNotFound", "409": "CategoryGroupNameTaken", "422": "ValidationFailed, InvalidCategoryName" }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/category-groups/{groupId}": {
    patch: {
      operationId: "renameCategoryGroup",
      summary: "Rename a category group",
      ...securedByUser,
      requestParams: { path: GroupPath },
      requestBody: { content: jsonContent(CategoryGroupBodySchema) },
      responses: {
        "200": { description: "The renamed group", content: jsonContent(CategoryGroupSummarySchema) },
        ...problems({
          ...managed,
          "404": "SpaceNotFound, CategoryGroupNotFound",
          "409": "CategoryGroupNameTaken",
          "422": "ValidationFailed, InvalidCategoryName",
        }),
      },
    },
  },
};
```

- [ ] **Step 3: Routes and wiring**

In `src/app/api/v1/spaces/[spaceId]/categories/route.ts`, change the contract import to

```ts
import {
  categoryDto,
  categoryTreeDto,
  CreateCategoryBodySchema,
  ListCategoriesQuerySchema,
} from "@/modules/categories/contracts/categories.contract";
```

and append:

```ts
export const POST = defineRoute({
  auth: "required",
  body: CreateCategoryBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().categories.createCategory({
      spaceId: params.spaceId!,
      userId: user!.id,
      groupId: body.groupId,
      name: body.name,
    });
    return result.ok ? ok({ status: 201, body: categoryDto(result.value) }) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { categoryDto, UpdateCategoryBodySchema } from "@/modules/categories/contracts/categories.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const PATCH = defineRoute({
  auth: "required",
  body: UpdateCategoryBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().categories.updateCategory({
      spaceId: params.spaceId!,
      userId: user!.id,
      categoryId: params.categoryId!,
      name: body.name,
      groupId: body.groupId,
    });
    return result.ok ? ok({ status: 200, body: categoryDto(result.value) }) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/category-groups/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { CategoryGroupBodySchema, categoryGroupDto } from "@/modules/categories/contracts/categories.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: CategoryGroupBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().categories.createCategoryGroup({
      spaceId: params.spaceId!,
      userId: user!.id,
      name: body.name,
    });
    return result.ok ? ok({ status: 201, body: categoryGroupDto(result.value) }) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { CategoryGroupBodySchema, categoryGroupDto } from "@/modules/categories/contracts/categories.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const PATCH = defineRoute({
  auth: "required",
  body: CategoryGroupBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().categories.renameCategoryGroup({
      spaceId: params.spaceId!,
      userId: user!.id,
      groupId: params.groupId!,
      name: body.name,
    });
    return result.ok ? ok({ status: 200, body: categoryGroupDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Extend the categories application import with `createCreateCategory`, `createCreateCategoryGroup`, `createRenameCategoryGroup`, `createUpdateCategory`, `type CreateCategory`, `type CreateCategoryGroup`, `type RenameCategoryGroup`, `type UpdateCategory`.
2. Replace the `categories` member of `Container` with:

```ts
  readonly categories: {
    readonly listCategories: ListCategories;
    readonly createCategoryGroup: CreateCategoryGroup;
    readonly renameCategoryGroup: RenameCategoryGroup;
    readonly createCategory: CreateCategory;
    readonly updateCategory: UpdateCategory;
  };
```

3. Replace the `categories:` entry of the returned object with:

```ts
    categories: {
      listCategories: createListCategories(categoriesDeps),
      createCategoryGroup: createCreateCategoryGroup(categoriesDeps),
      renameCategoryGroup: createRenameCategoryGroup(categoriesDeps),
      createCategory: createCreateCategory(categoriesDeps),
      updateCategory: createUpdateCategory(categoriesDeps),
    },
```

- [ ] **Step 4: Run the acceptance tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance`
Expected: PASS.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect the snapshot diff: it adds `POST /api/v1/spaces/{spaceId}/categories`, `PATCH /api/v1/spaces/{spaceId}/categories/{categoryId}`, `POST /api/v1/spaces/{spaceId}/category-groups`, `PATCH /api/v1/spaces/{spaceId}/category-groups/{groupId}` and nothing else.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/categories/contracts "src/app/api/v1/spaces/[spaceId]/categories" "src/app/api/v1/spaces/[spaceId]/category-groups" src/composition/container.ts openapi/openapi.snapshot.json tests/acceptance/categories.test.ts
git commit -m "feat(categories): expose category group and category management endpoints (Refs #28)"
```

---

### Task 24: HTTP — accounts with computed balances

Exposes HU-E2-01 (issue #23), HU-E2-03 (issue #25) and HU-E2-04 (issue #26): `POST/GET /accounts`, `GET/PATCH /accounts/{accountId}`, `POST /accounts/{accountId}/archive`, each account with its computed `balance` (`?asOf=` supported). Balances are bound to the ledger's `DrizzleLedgerQueries.netMovements` (Task 21); the balance scenarios with real transactions run over HTTP in Task 26.

Decisions: `UnknownCurrency` and `CurrencyMismatch` are request errors and map to 422 (they would otherwise fall to 409). Dates on the wire use `z.iso.date()`, whose pattern is calendar-aware (2026-02-30 fails as `422 ValidationFailed`); `optionalLocalDate` then turns the string into a kernel `LocalDate` and keeps `InvalidDate` as a second line of defence. Account creation is not a transaction, so it does not use `Idempotency-Key`.

**Files:**
- Modify: `src/shared/http/problem.ts`, `src/shared/http/problem.test.ts`, `src/shared/http/contracts.ts`, `src/shared/http/contracts.test.ts`
- Create: `src/modules/accounts/contracts/accounts.contract.ts`
- Create: `src/app/api/v1/spaces/[spaceId]/accounts/route.ts`, `src/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route.ts`, `src/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route.ts`
- Modify: `src/composition/container.ts`, `src/composition/openapi.ts`, `openapi/openapi.snapshot.json`
- Test: `tests/acceptance/accounts.test.ts`

**Interfaces:**
- Consumes: accounts use cases and `AccountsDeps`, `AccountView` (Tasks 10–11); `DrizzleAccountRepository` (Task 13); `DrizzleLedgerQueries` (Task 21); `moneyFromDto`, `MoneySchema`, `jsonContent`, `problems`, `securedByUser` (M0, Task 22); `localDate` (kernel).
- Produces:
  - `optionalLocalDate(iso: string | undefined): Result<LocalDate | undefined>` (`InvalidDate`)
  - `AccountSchema`, `CreateAccountBodySchema`, `UpdateAccountBodySchema`, `ListAccountsQuerySchema`, `GetAccountQuerySchema`, `accountDto(view)`, `accountsPaths`
  - `POST /api/v1/spaces/{spaceId}/accounts` → `201 Account`; `GET /api/v1/spaces/{spaceId}/accounts?archived=&asOf=` → `200 { items: Account[] }`; `GET /api/v1/spaces/{spaceId}/accounts/{accountId}?asOf=` → `200 Account`; `PATCH …/{accountId}` → `200 Account`; `POST …/{accountId}/archive` → `200 Account`
  - `Container.accounts.{createAccount, updateAccount, archiveAccount, listAccounts, getAccount}`; container locals `ledgerQueries`, `accountsDeps` (used by Tasks 25–29)

- [ ] **Step 1: Write the failing unit and acceptance tests**

In `src/shared/http/problem.test.ts`, add these rows to the `statusForCode` table:

```ts
    ["UnknownCurrency", 422],
    ["CurrencyMismatch", 422],
```

Append to `src/shared/http/contracts.test.ts` (add `optionalLocalDate` to the import):

```ts
describe("optionalLocalDate", () => {
  it("keeps an absent date absent and validates present ones", () => {
    expect(optionalLocalDate(undefined)).toEqual({ ok: true, value: undefined });
    expect(optionalLocalDate("2026-10-31")).toEqual({ ok: true, value: "2026-10-31" });
    const impossible = optionalLocalDate("2026-02-30");
    expect(!impossible.ok && impossible.error.code).toBe("InvalidDate");
  });
});
```

`tests/acceptance/accounts.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listAccounts, POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { GET as getAccount, PATCH as updateAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type TestUser } from "../support/app";

interface AccountDto {
  id: string;
  name: string;
  type: string;
  ownerUserId: string | null;
  openingBalance: { amount: string; currency: string };
  balance: { amount: string; currency: string };
  archivedAt: string | null;
}

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const cop = (pesos: number) => ({ amount: String(pesos * 100), currency: "COP" });
const create = (user: TestUser, body: unknown) =>
  call(createAccount, "POST", `/api/v1/spaces/${user.spaceId}/accounts`, { user, params: { spaceId: user.spaceId }, body });
const list = async (user: TestUser, query = "") => {
  const response = await call(listAccounts, "GET", `/api/v1/spaces/${user.spaceId}/accounts${query}`, {
    user,
    params: { spaceId: user.spaceId },
  });
  return { status: response.status, body: await response.json() };
};
const accountCall = (handler: typeof getAccount, method: string, user: TestUser, account: AccountDto, body?: unknown, suffix = "") =>
  call(handler, method, `/api/v1/spaces/${user.spaceId}/accounts/${account.id}${suffix}`, {
    user,
    params: { spaceId: user.spaceId, accountId: account.id },
    body,
  });

describe("personal accounts (HU-E2-01)", () => {
  it("creates a bank account owned by Ana with its opening balance as balance", async () => {
    const ana = await registerUser("Ana");
    const response = await create(ana, { name: "Bancolombia", type: "BANK", openingBalance: cop(2_000_000) });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      name: "Bancolombia",
      type: "BANK",
      ownerUserId: ana.userId,
      openingBalance: cop(2_000_000),
      balance: cop(2_000_000),
      archivedAt: null,
    });
  });

  it("allows a credit card to start negative and answers rule violations with stable codes", async () => {
    const ana = await registerUser("Ana");
    const visa = await create(ana, { name: "Visa", type: "CREDIT_CARD", openingBalance: cop(-350_000) });
    expect((await visa.json()).openingBalance).toEqual(cop(-350_000));
    await create(ana, { name: "Bancolombia", type: "BANK", openingBalance: cop(0) });
    const cases: [unknown, number, string][] = [
      [{ name: "bancolombia", type: "SAVINGS", openingBalance: cop(0) }, 409, "AccountNameTaken"],
      [{ name: "Fund", type: "SHARED_FUND", openingBalance: cop(0) }, 409, "SharedFundRequiresSharedSpace"],
      [{ name: "Chase", type: "BANK", openingBalance: { amount: "100", currency: "USD" } }, 422, "CurrencyMismatch"],
      [{ name: "Odd", type: "BANK", openingBalance: { amount: "100", currency: "XXX" } }, 422, "UnknownCurrency"],
    ];
    for (const [body, status, code] of cases) {
      const response = await create(ana, body);
      expect([response.status, (await response.json()).code]).toEqual([status, code]);
    }
  });
});

describe("editing and archiving accounts (HU-E2-03)", () => {
  it("corrects the opening balance, keeps the type, archives and filters archived accounts", async () => {
    const ana = await registerUser("Ana");
    const bank = (await (await create(ana, { name: "Bancolombia", type: "BANK", openingBalance: cop(2_000_000) })).json()) as AccountDto;
    const nequi = (await (await create(ana, { name: "Nequi", type: "CASH", openingBalance: cop(0) })).json()) as AccountDto;

    const corrected = await accountCall(updateAccount, "PATCH", ana, bank, { openingBalance: cop(2_100_000) });
    expect((await corrected.json()).balance).toEqual(cop(2_100_000));
    const retyped = await accountCall(updateAccount, "PATCH", ana, bank, { type: "SAVINGS" });
    expect([retyped.status, (await retyped.json()).code]).toEqual([409, "AccountTypeImmutable"]);

    const archived = await accountCall(archiveAccount, "POST", ana, nequi, undefined, "/archive");
    expect((await archived.json()).archivedAt).toEqual(expect.any(String));
    expect((await list(ana)).body.items.map((a: AccountDto) => a.name)).toEqual(["Bancolombia"]);
    expect((await list(ana, "?archived=true")).body.items.map((a: AccountDto) => a.name)).toEqual(["Bancolombia", "Nequi"]);
    expect((await accountCall(getAccount, "GET", ana, nequi)).status).toBe(200);
  });

  it("validates asOf and hides other users' spaces", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    // Zod's ISO date is calendar-aware, so impossible dates fail at the contract.
    expect(await list(ana, "?asOf=2026-02-30")).toMatchObject({ status: 422, body: { code: "ValidationFailed" } });
    expect(await list(ana, "?asOf=yesterday")).toMatchObject({ status: 422, body: { code: "ValidationFailed" } });
    expect((await list(ana, "?asOf=2026-10-31")).status).toBe(200);
    const foreign = await call(listAccounts, "GET", `/api/v1/spaces/${ana.spaceId}/accounts`, {
      user: juan,
      params: { spaceId: ana.spaceId },
    });
    expect(foreign.status).toBe(404);
  });
});
```

Run: `pnpm exec vitest run --project unit src/shared/http && pnpm exec vitest run --project acceptance tests/acceptance/accounts.test.ts`
Expected: FAIL — `statusForCode("UnknownCurrency")` is 409, `optionalLocalDate is not a function`, and `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/accounts/route"`.

- [ ] **Step 2: Shared HTTP additions**

In `src/shared/http/problem.ts`, add to the `EXPLICIT` map after `["NotASpaceMember", 422],`:

```ts
  ["UnknownCurrency", 422],
  ["CurrencyMismatch", 422],
```

In `src/shared/http/contracts.ts`, change the kernel import to `import { localDate, Money, ok, type LocalDate, type Result } from "@/shared/kernel";` and append:

```ts
/** Validates an optional ISO date from a request: absent stays undefined, impossible dates are InvalidDate. */
export const optionalLocalDate = (iso: string | undefined): Result<LocalDate | undefined> =>
  iso === undefined ? ok(undefined) : localDate(iso);
```

- [ ] **Step 3: Contract, routes and wiring**

`src/modules/accounts/contracts/accounts.contract.ts`:

```ts
import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, MoneySchema, problems, securedByUser } from "@/shared/http/contracts";
import { ACCOUNT_TYPES, type AccountView } from "../application";

const AccountTypeSchema = z.enum(ACCOUNT_TYPES);

export const AccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: AccountTypeSchema,
  ownerUserId: z.string().nullable(),
  openingBalance: MoneySchema,
  /** Opening balance plus ledger movements, computed on read (HU-E2-04). */
  balance: MoneySchema,
  archivedAt: z.iso.datetime().nullable(),
});

export const CreateAccountBodySchema = z.object({
  name: z.string().max(200),
  type: AccountTypeSchema,
  openingBalance: MoneySchema,
});
export const UpdateAccountBodySchema = z.object({
  name: z.string().max(200).optional(),
  type: AccountTypeSchema.optional(),
  openingBalance: MoneySchema.optional(),
});
export const GetAccountQuerySchema = z.object({ asOf: z.iso.date().optional() });
export const ListAccountsQuerySchema = GetAccountQuerySchema.extend({ archived: z.enum(["true", "false"]).optional() });
export const ListAccountsResponseSchema = z.object({ items: z.array(AccountSchema) });

export const accountDto = (view: AccountView): z.infer<typeof AccountSchema> => ({
  id: view.id,
  name: view.name,
  type: view.type,
  ownerUserId: view.ownerUserId,
  openingBalance: { amount: view.openingBalance.toString(), currency: view.currency },
  balance: { amount: view.balance.toString(), currency: view.currency },
  archivedAt: view.archivedAt?.toISOString() ?? null,
});

const SpacePath = z.object({ spaceId: z.string() });
const AccountPath = SpacePath.extend({ accountId: z.string() });
const one = (description: string) => ({ description, content: jsonContent(AccountSchema) });

export const accountsPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces/{spaceId}/accounts": {
    get: {
      operationId: "listAccounts",
      summary: "Accounts of a space with computed balances; archived ones only with archived=true",
      ...securedByUser,
      requestParams: { path: SpacePath, query: ListAccountsQuerySchema },
      responses: {
        "200": { description: "Accounts sorted by name", content: jsonContent(ListAccountsResponseSchema) },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound", "422": "ValidationFailed, InvalidDate" }),
      },
    },
    post: {
      operationId: "createAccount",
      summary: "Create an account with an opening balance",
      ...securedByUser,
      requestParams: { path: SpacePath },
      requestBody: { content: jsonContent(CreateAccountBodySchema) },
      responses: {
        "201": one("The new account"),
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound",
          "409": "AccountNameTaken, SharedFundRequiresSharedSpace, PersonalAccountRequiresPersonalSpace",
          "422": "ValidationFailed, InvalidAccountName, UnknownCurrency, CurrencyMismatch",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/accounts/{accountId}": {
    get: {
      operationId: "getAccount",
      summary: "One account with its computed balance",
      ...securedByUser,
      requestParams: { path: AccountPath, query: GetAccountQuerySchema },
      responses: {
        "200": one("The account"),
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound, AccountNotFound", "422": "ValidationFailed, InvalidDate" }),
      },
    },
    patch: {
      operationId: "updateAccount",
      summary: "Rename an account or correct its opening balance (the type never changes)",
      ...securedByUser,
      requestParams: { path: AccountPath },
      requestBody: { content: jsonContent(UpdateAccountBodySchema) },
      responses: {
        "200": one("The updated account"),
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound, AccountNotFound",
          "409": "AccountNameTaken, AccountTypeImmutable",
          "422": "ValidationFailed, InvalidAccountName, UnknownCurrency, CurrencyMismatch",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/accounts/{accountId}/archive": {
    post: {
      operationId: "archiveAccount",
      summary: "Archive an account; its history stays, it takes no new movements",
      ...securedByUser,
      requestParams: { path: AccountPath },
      responses: {
        "200": one("The archived account"),
        ...problems({ "401": "Unauthenticated", "403": "InsufficientRole", "404": "SpaceNotFound, AccountNotFound" }),
      },
    },
  },
};
```

`src/app/api/v1/spaces/[spaceId]/accounts/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  accountDto,
  CreateAccountBodySchema,
  ListAccountsQuerySchema,
} from "@/modules/accounts/contracts/accounts.contract";
import { moneyFromDto, optionalLocalDate } from "@/shared/http/contracts";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: ListAccountsQuerySchema,
  handler: async ({ user, params, query }) => {
    const asOf = optionalLocalDate(query.asOf);
    if (!asOf.ok) return asOf;
    const result = await getContainer().accounts.listAccounts({
      spaceId: params.spaceId!,
      userId: user!.id,
      includeArchived: query.archived === "true",
      asOf: asOf.value,
    });
    return result.ok ? ok({ status: 200, body: { items: result.value.map(accountDto) } }) : result;
  },
});

export const POST = defineRoute({
  auth: "required",
  body: CreateAccountBodySchema,
  handler: async ({ user, params, body }) => {
    const openingBalance = moneyFromDto(body.openingBalance);
    if (!openingBalance.ok) return openingBalance;
    const result = await getContainer().accounts.createAccount({
      spaceId: params.spaceId!,
      userId: user!.id,
      name: body.name,
      type: body.type,
      openingBalance: openingBalance.value,
    });
    return result.ok ? ok({ status: 201, body: accountDto(result.value) }) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  accountDto,
  GetAccountQuerySchema,
  UpdateAccountBodySchema,
} from "@/modules/accounts/contracts/accounts.contract";
import { moneyFromDto, optionalLocalDate } from "@/shared/http/contracts";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: GetAccountQuerySchema,
  handler: async ({ user, params, query }) => {
    const asOf = optionalLocalDate(query.asOf);
    if (!asOf.ok) return asOf;
    const result = await getContainer().accounts.getAccount({
      spaceId: params.spaceId!,
      userId: user!.id,
      accountId: params.accountId!,
      asOf: asOf.value,
    });
    return result.ok ? ok({ status: 200, body: accountDto(result.value) }) : result;
  },
});

export const PATCH = defineRoute({
  auth: "required",
  body: UpdateAccountBodySchema,
  handler: async ({ user, params, body }) => {
    const openingBalance = body.openingBalance === undefined ? ok(undefined) : moneyFromDto(body.openingBalance);
    if (!openingBalance.ok) return openingBalance;
    const result = await getContainer().accounts.updateAccount({
      spaceId: params.spaceId!,
      userId: user!.id,
      accountId: params.accountId!,
      changes: { name: body.name, type: body.type, openingBalance: openingBalance.value },
    });
    return result.ok ? ok({ status: 200, body: accountDto(result.value) }) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { accountDto } from "@/modules/accounts/contracts/accounts.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().accounts.archiveAccount({
      spaceId: params.spaceId!,
      userId: user!.id,
      accountId: params.accountId!,
    });
    return result.ok ? ok({ status: 200, body: accountDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Add imports:

```ts
import {
  createArchiveAccount,
  createCreateAccount,
  createGetAccount,
  createListAccounts,
  createUpdateAccount,
  type AccountsDeps,
  type ArchiveAccount,
  type CreateAccount,
  type GetAccount,
  type ListAccounts,
  type UpdateAccount,
} from "@/modules/accounts/application";
import { DrizzleAccountRepository } from "@/modules/accounts/infrastructure/drizzle-account-repository";
import { DrizzleLedgerQueries } from "@/modules/ledger/infrastructure/drizzle-ledger-queries";
```

2. Add to `interface Container` (after `categories`):

```ts
  readonly accounts: {
    readonly createAccount: CreateAccount;
    readonly updateAccount: UpdateAccount;
    readonly archiveAccount: ArchiveAccount;
    readonly listAccounts: ListAccounts;
    readonly getAccount: GetAccount;
  };
```

3. In `buildContainer`, after `const seedDefaultCategories = …;`, add:

```ts
  const ledgerQueries = new DrizzleLedgerQueries(tm);
  // HU-E2-04: balance = opening balance + ledger movements, computed on read (D7).
  const accountsDeps: AccountsDeps = {
    accounts: new DrizzleAccountRepository(tm),
    access,
    movements: ledgerQueries,
    ids,
    clock,
    tm,
  };
```

4. Add to the returned object (after `categories`):

```ts
    accounts: {
      createAccount: createCreateAccount(accountsDeps),
      updateAccount: createUpdateAccount(accountsDeps),
      archiveAccount: createArchiveAccount(accountsDeps),
      listAccounts: createListAccounts(accountsDeps),
      getAccount: createGetAccount(accountsDeps),
    },
```

In `src/composition/openapi.ts`, import `{ AccountSchema, accountsPaths }` from `@/modules/accounts/contracts/accounts.contract`, add `...accountsPaths` to `paths` and `Account: AccountSchema` to `components.schemas`.

- [ ] **Step 4: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project unit src/shared/http && pnpm exec vitest run --project acceptance`
Expected: PASS.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect: the diff adds the five account operations and the `Account` component (zod-openapi may also add an output variant of `Money`, because `MoneySchema` is now used in both requests and responses); nothing else changes.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/http src/modules/accounts/contracts "src/app/api/v1/spaces/[spaceId]/accounts" src/composition openapi/openapi.snapshot.json tests/acceptance/accounts.test.ts
git commit -m "feat(accounts): expose account endpoints with computed balances (Refs #23, Refs #25, Refs #26)"
```

---

### Task 25: HTTP — space settings and period listing

Exposes HU-E1-03 (issue #12): `GET /api/v1/spaces/{spaceId}`, `PATCH /api/v1/spaces/{spaceId}` (name, currency, periodPolicy) and `GET /api/v1/spaces/{spaceId}/periods?from=&count=`. Wires the currency lock to accounts and ledger, and the stored-period source to an empty list until budgeting plans exist.

Decisions: `from` defaults to today in the space timezone; `count` defaults to 6, maximum 24. The request schema for `periodPolicy` accepts any integer days so the domain answers `InvalidPeriodPolicy`. The "Member without admin rights" and "plan does not move" scenarios stay unit tests (Task 2): other roles and plans arrive in M2/M3.

**Files:**
- Modify: `src/shared/http/contracts.ts`, `src/shared/http/contracts.test.ts`
- Modify: `src/modules/spaces/contracts/spaces.contract.ts`
- Create: `src/app/api/v1/spaces/[spaceId]/route.ts`, `src/app/api/v1/spaces/[spaceId]/periods/route.ts`
- Modify: `src/composition/container.ts`, `src/composition/openapi.ts`, `openapi/openapi.snapshot.json`
- Test: `tests/acceptance/space-settings.test.ts`

**Interfaces:**
- Consumes: `createGetSpace`, `createUpdateSpaceSettings`, `createListSpacePeriods`, `StoredPeriodSource` (Task 2); container locals `access`, `accountsDeps`, `ledgerQueries` (Tasks 22, 24); `optionalLocalDate` (Task 24).
- Produces:
  - `PeriodSchema` (`{ label, startDate, endDate }`) and `periodDto(period: Period)` in shared/http/contracts.ts (reused by Task 27)
  - `PeriodPolicyInputSchema`, `UpdateSpaceBodySchema`, `ListPeriodsQuerySchema`, `ListPeriodsResponseSchema`; `spacesPaths` gains the three operations
  - `GET /api/v1/spaces/{spaceId}` → `200 Space`; `PATCH /api/v1/spaces/{spaceId}` → `200 Space`; `GET /api/v1/spaces/{spaceId}/periods` → `200 { items: Period[] }`
  - `Container.spaces.{getSpace, updateSettings, listPeriods}`; container local `storedPeriods` (used by Task 26)

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/http/contracts.test.ts` (add `periodDto` to the import; add `import type { LocalDate } from "@/shared/kernel";`):

```ts
describe("periodDto", () => {
  it("serializes a period with explicit start and end dates", () => {
    expect(
      periodDto({ start: "2026-10-25" as LocalDate, end: "2026-11-24" as LocalDate, label: "2026-11" }),
    ).toEqual({ label: "2026-11", startDate: "2026-10-25", endDate: "2026-11-24" });
  });
});
```

`tests/acceptance/space-settings.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { GET as listPeriods } from "@/app/api/v1/spaces/[spaceId]/periods/route";
import { GET as getSpace, PATCH as updateSpace } from "@/app/api/v1/spaces/[spaceId]/route";
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

const patch = (user: TestUser, body: unknown, spaceId = user.spaceId) =>
  call(updateSpace, "PATCH", `/api/v1/spaces/${spaceId}`, { user, params: { spaceId }, body });
const periods = async (user: TestUser, query: string) => {
  const response = await call(listPeriods, "GET", `/api/v1/spaces/${user.spaceId}/periods${query}`, {
    user,
    params: { spaceId: user.spaceId },
  });
  return ((await response.json()) as { items: unknown[] }).items;
};

describe("space settings (HU-E1-03)", () => {
  it("returns and renames the space", async () => {
    const ana = await registerUser("Ana");
    const current = await call(getSpace, "GET", `/api/v1/spaces/${ana.spaceId}`, { user: ana, params: { spaceId: ana.spaceId } });
    expect(await current.json()).toMatchObject({ id: ana.spaceId, name: "Personal", role: "OWNER" });
    const renamed = await patch(ana, { name: "Casa" });
    expect([renamed.status, (await renamed.json()).name]).toEqual([200, "Casa"]);
  });

  it("switches to a cut-off on the 25th", async () => {
    const ana = await registerUser("Ana");
    expect((await patch(ana, { periodPolicy: { kind: "MONTHLY", day: 25 } })).status).toBe(200);
    expect(await periods(ana, "?from=2026-10-24&count=1")).toEqual([
      { label: "2026-10", startDate: "2026-09-25", endDate: "2026-10-24" },
    ]);
  });

  it("switches to semi-monthly periods on the 5th and 20th", async () => {
    const ana = await registerUser("Ana");
    await patch(ana, { periodPolicy: { kind: "SEMI_MONTHLY", day1: 5, day2: 20 } });
    expect(await periods(ana, "?from=2026-11-03&count=3")).toEqual([
      { label: "2026-10 H2", startDate: "2026-10-20", endDate: "2026-11-04" },
      { label: "2026-11 H1", startDate: "2026-11-05", endDate: "2026-11-19" },
      { label: "2026-11 H2", startDate: "2026-11-20", endDate: "2026-12-04" },
    ]);
  });

  it.each([
    { kind: "MONTHLY", day: 0 },
    { kind: "MONTHLY", day: 32 },
    { kind: "SEMI_MONTHLY", day1: 20, day2: 5 },
  ])("rejects %o with 422 InvalidPeriodPolicy", async (periodPolicy) => {
    const ana = await registerUser("Ana");
    const response = await patch(ana, { periodPolicy });
    expect([response.status, (await response.json()).code]).toEqual([422, "InvalidPeriodPolicy"]);
  });

  it("locks the currency once the space holds money records", async () => {
    const ana = await registerUser("Ana");
    await call(createAccount, "POST", `/api/v1/spaces/${ana.spaceId}/accounts`, {
      user: ana,
      params: { spaceId: ana.spaceId },
      body: { name: "Bancolombia", type: "BANK", openingBalance: { amount: "0", currency: "COP" } },
    });
    const locked = await patch(ana, { currency: "USD" });
    expect([locked.status, (await locked.json()).code]).toEqual([409, "SpaceCurrencyLocked"]);
    const fresh = await registerUser("Luis");
    expect((await (await patch(fresh, { currency: "USD" })).json()).currency).toBe("USD");
    const unknown = await patch(fresh, { currency: "XYZ" });
    expect([unknown.status, (await unknown.json()).code]).toEqual([422, "UnknownCurrency"]);
  });

  it("hides another user's space", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const response = await patch(juan, { name: "Mine" }, ana.spaceId);
    expect([response.status, (await response.json()).code]).toEqual([404, "SpaceNotFound"]);
  });
});
```

Run: `pnpm exec vitest run --project unit src/shared/http && pnpm exec vitest run --project acceptance tests/acceptance/space-settings.test.ts`
Expected: FAIL — `periodDto is not a function` and `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/periods/route"`.

- [ ] **Step 2: Shared period DTO**

In `src/shared/http/contracts.ts`, add `type Period` to the kernel import and append:

```ts
/** A period on the wire (HU-E1-03, HU-E4-04). */
export const PeriodSchema = z.object({ label: z.string(), startDate: z.iso.date(), endDate: z.iso.date() });

export const periodDto = (period: Period): z.infer<typeof PeriodSchema> => ({
  label: period.label,
  startDate: period.start,
  endDate: period.end,
});
```

- [ ] **Step 3: Contract, routes and wiring**

In `src/modules/spaces/contracts/spaces.contract.ts`, change the shared import to

```ts
import { jsonContent, PeriodSchema, problemContent, problems, securedByUser } from "@/shared/http/contracts";
```

add after `ListSpacesResponseSchema`:

```ts
/** Request shape: any integer days, so the domain answers InvalidPeriodPolicy (HU-E1-03) instead of ValidationFailed. */
export const PeriodPolicyInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MONTHLY"), day: z.number().int() }),
  z.object({ kind: z.literal("SEMI_MONTHLY"), day1: z.number().int(), day2: z.number().int() }),
]);

export const UpdateSpaceBodySchema = z.object({
  name: z.string().max(200).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/, { error: "Currency must be an ISO 4217 code" }).optional(),
  periodPolicy: PeriodPolicyInputSchema.optional(),
});

export const ListPeriodsQuerySchema = z.object({
  from: z.iso.date().optional(),
  count: z.coerce.number().int().min(1).max(24).default(6),
});
export const ListPeriodsResponseSchema = z.object({ items: z.array(PeriodSchema) });

const SpacePath = z.object({ spaceId: z.string() });
```

and add these entries to `spacesPaths` (after `"/api/v1/spaces"`):

```ts
  "/api/v1/spaces/{spaceId}": {
    get: {
      operationId: "getSpace",
      summary: "One space the user belongs to",
      ...securedByUser,
      requestParams: { path: SpacePath },
      responses: {
        "200": { description: "The space", content: jsonContent(SpaceSummarySchema) },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound" }),
      },
    },
    patch: {
      operationId: "updateSpaceSettings",
      summary: "Rename the space, change its currency (until money is recorded) or its period policy",
      ...securedByUser,
      requestParams: { path: SpacePath },
      requestBody: { content: jsonContent(UpdateSpaceBodySchema) },
      responses: {
        "200": { description: "The updated space", content: jsonContent(SpaceSummarySchema) },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound",
          "409": "SpaceCurrencyLocked",
          "422": "ValidationFailed, InvalidSpaceName, InvalidPeriodPolicy, UnknownCurrency",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/periods": {
    get: {
      operationId: "listSpacePeriods",
      summary: "Consecutive periods from a date (default today), with stored plan boundaries taking precedence",
      ...securedByUser,
      requestParams: { path: SpacePath, query: ListPeriodsQuerySchema },
      responses: {
        "200": { description: "Periods in order", content: jsonContent(ListPeriodsResponseSchema) },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound", "422": "ValidationFailed, InvalidDate" }),
      },
    },
  },
```

(The existing `"/api/v1/spaces"` entry keeps using `problemContent`.)

`src/app/api/v1/spaces/[spaceId]/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { UpdateSpaceBodySchema } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.getSpace({ spaceId: params.spaceId!, userId: user!.id });
    return result.ok ? ok({ status: 200, body: result.value }) : result;
  },
});

export const PATCH = defineRoute({
  auth: "required",
  body: UpdateSpaceBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().spaces.updateSettings({
      spaceId: params.spaceId!,
      userId: user!.id,
      changes: body,
    });
    return result.ok ? ok({ status: 200, body: result.value }) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/periods/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ListPeriodsQuerySchema } from "@/modules/spaces/contracts/spaces.contract";
import { optionalLocalDate, periodDto } from "@/shared/http/contracts";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: ListPeriodsQuerySchema,
  handler: async ({ user, params, query }) => {
    const from = optionalLocalDate(query.from);
    if (!from.ok) return from;
    const result = await getContainer().spaces.listPeriods({
      spaceId: params.spaceId!,
      userId: user!.id,
      from: from.value,
      count: query.count,
    });
    return result.ok ? ok({ status: 200, body: { items: result.value.map(periodDto) } }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Extend the spaces application import with `createGetSpace`, `createListSpacePeriods`, `createUpdateSpaceSettings`, `type GetSpace`, `type ListSpacePeriods`, `type StoredPeriodSource`, `type UpdateSpaceSettings`.
2. Replace the `spaces` member of `Container` with:

```ts
  readonly spaces: {
    readonly createPersonalSpace: CreatePersonalSpace;
    readonly listMySpaces: ListMySpaces;
    readonly getSpace: GetSpace;
    readonly updateSettings: UpdateSpaceSettings;
    readonly listPeriods: ListSpacePeriods;
  };
```

3. In `buildContainer`, after `accountsDeps`, add:

```ts
  // Budget plans (stored period boundaries, D10) arrive with HU-E6-01; until then periods come from the policy.
  const storedPeriods: StoredPeriodSource = async () => [];
```

4. Replace the `spaces:` entry of the returned object with:

```ts
    spaces: {
      createPersonalSpace,
      listMySpaces: createListMySpaces(spaceRepository),
      getSpace: createGetSpace(access),
      updateSettings: createUpdateSpaceSettings({
        spaces: spaceRepository,
        access,
        tm,
        usage: {
          hasMoneyRecords: async (spaceId) =>
            (await accountsDeps.accounts.listBySpace(spaceId)).length > 0 || (await ledgerQueries.hasTransactions(spaceId)),
        },
      }),
      listPeriods: createListSpacePeriods({ access, storedPeriods, clock, timeZone: env.APP_TIMEZONE }),
    },
```

In `src/composition/openapi.ts`, import `SpaceSummarySchema` from `@/modules/spaces/contracts/spaces.contract` and `PeriodSchema` from `@/shared/http/contracts`, and add `Space: SpaceSummarySchema, Period: PeriodSchema` to `components.schemas`.

- [ ] **Step 4: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project unit src/shared/http && pnpm exec vitest run --project acceptance`
Expected: PASS.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect: the diff adds `GET` and `PATCH /api/v1/spaces/{spaceId}`, `GET /api/v1/spaces/{spaceId}/periods`, the `Space` and `Period` components, and changes `GET /api/v1/spaces` only by referencing the new `Space` component (deliberate).

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/http src/modules/spaces/contracts "src/app/api/v1/spaces/[spaceId]/route.ts" "src/app/api/v1/spaces/[spaceId]/periods" src/composition openapi/openapi.snapshot.json tests/acceptance/space-settings.test.ts
git commit -m "feat(spaces): expose space settings and period listing endpoints (Refs #12)"
```

---

### Task 26: HTTP — record expenses, incomes and transfers

Exposes HU-E4-01 (issue #30, the `@critical` scenario), HU-E4-02 (issue #31) and HU-E4-03 (issue #32): `POST /expenses`, `POST /incomes`, `POST /transfers`, each honouring `Idempotency-Key` and answering `201` with the transaction, its `ETag` and `Location`. Runs the HU-E2-04 balance scenario over HTTP (opening 2,000,000 + income 3,000,000 − expense 85,000 − transfer 500,000 = 4,415,000) and pins Review Focus 4 (another user's space is `404 SpaceNotFound`).

Decisions: `CategoryRequired`, `AccountNotOwned` and `AccountNotInSpace` are request errors and map to 422 (like `NotASpaceMember`, spec 8); `SameAccountTransfer`, `AccountArchived` and `CategoryArchived` stay 409 (state conflicts). The ledger's account and category readers are adapters in the composition root over the accounts and categories repositories, so the ledger imports neither module.

**Files:**
- Modify: `src/shared/http/problem.ts`, `src/shared/http/problem.test.ts`, `src/composition/route.ts`
- Create: `src/modules/ledger/contracts/ledger.contract.ts`
- Create: `src/app/api/v1/spaces/[spaceId]/expenses/route.ts`, `src/app/api/v1/spaces/[spaceId]/incomes/route.ts`, `src/app/api/v1/spaces/[spaceId]/transfers/route.ts`
- Modify: `src/composition/container.ts`, `src/composition/openapi.ts`, `openapi/openapi.snapshot.json`
- Test: `tests/acceptance/ledger.test.ts`

**Interfaces:**
- Consumes: `createRecordExpense`, `createRecordIncome`, `createRecordTransfer`, `LedgerDeps` (Tasks 15–16); `DrizzleTransactionRepository`, `DrizzleAuditLog` (Task 20); container locals `access`, `categoriesDeps`, `accountsDeps`, `ledgerQueries`, `storedPeriods`, `ids`, `clock` (Tasks 22–25); `idempotent` (M0); `etagOf` (M0); `moneyFromDto`, `optionalLocalDate` (M0, Task 24).
- Produces:
  - `withIdempotency(ctx, next)` (composition/route.ts) — `before` hook resolving the container lazily
  - `TransactionSchema`, `PaymentSchema`, `ShareSchema`, `RecordExpenseBodySchema`, `RecordIncomeBodySchema`, `RecordTransferBodySchema`, `transactionDto(tx)`, `transactionHeaders(tx)`, `ledgerPaths`
  - `POST /api/v1/spaces/{spaceId}/expenses` `{ description?, date?, categoryId?, amount, accountId }` → `201 Transaction`
  - `POST /api/v1/spaces/{spaceId}/incomes` `{ description?, date?, categoryId?, amount, accountId }` → `201 Transaction`
  - `POST /api/v1/spaces/{spaceId}/transfers` `{ description?, date?, amount, sourceAccountId, destinationAccountId }` → `201 Transaction`
  - `Container.ledger.{recordExpense, recordIncome, recordTransfer}`; container local `ledgerDeps` (used by Tasks 27–28)
  - `tests/acceptance/ledger.test.ts` helpers: `cop`, `inSpace`, `newAccount`, `categoryWithKey`, `ledgerUser`, `post`, `balanceOf`, `market`, `recorded`

- [ ] **Step 1: Write the failing tests**

In `src/shared/http/problem.test.ts`, add these rows to the `statusForCode` table:

```ts
    ["CategoryRequired", 422],
    ["AccountNotOwned", 422],
    ["AccountNotInSpace", 422],
    ["SameAccountTransfer", 409],
    ["AccountArchived", 409],
```

`tests/acceptance/ledger.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { GET as getAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route";
import { GET as listCategories } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type RouteHandler, type TestUser } from "../support/app";

interface MoneyDto {
  amount: string;
  currency: string;
}
interface TransactionDto {
  id: string;
  type: string;
  description: string;
  date: string;
  amount: MoneyDto;
  categoryId: string | null;
  payments: { memberId: string | null; accountId: string | null; amount: MoneyDto }[];
  shares: { memberId: string; amount: MoneyDto; splitMethod: string }[];
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  receivingMemberId: string | null;
  createdBy: string;
  version: number;
}
interface LedgerUser extends TestUser {
  bancolombia: string;
  nequi: string;
  groceries: string;
  salary: string;
}

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const cop = (pesos: number): MoneyDto => ({ amount: String(pesos * 100), currency: "COP" });
const inSpace = (user: TestUser, resource: string) => `/api/v1/spaces/${user.spaceId}/${resource}`;

const newAccount = async (user: TestUser, name: string, pesos: number) => {
  const response = await call(createAccount, "POST", inSpace(user, "accounts"), {
    user,
    params: { spaceId: user.spaceId },
    body: { name, type: "BANK", openingBalance: cop(pesos) },
  });
  return ((await response.json()) as { id: string }).id;
};

const categoryWithKey = async (user: TestUser, key: string) => {
  const response = await call(listCategories, "GET", inSpace(user, "categories"), {
    user,
    params: { spaceId: user.spaceId },
  });
  const { items } = (await response.json()) as { items: { categories: { id: string; key: string | null }[] }[] };
  return items.flatMap((g) => g.categories).find((c) => c.key === key)!.id;
};

/** A signed-up user with Bancolombia (2,000,000 COP), Nequi (0 COP) and the seeded categories. */
const ledgerUser = async (name: string): Promise<LedgerUser> => {
  const user = await registerUser(name);
  return {
    ...user,
    bancolombia: await newAccount(user, "Bancolombia", 2_000_000),
    nequi: await newAccount(user, "Nequi", 0),
    groceries: await categoryWithKey(user, "groceries"),
    salary: await categoryWithKey(user, "salary"),
  };
};

const post = (
  handler: RouteHandler,
  user: TestUser,
  resource: string,
  body: unknown,
  headers: Record<string, string> = {},
  spaceOf: TestUser = user,
) => call(handler, "POST", inSpace(spaceOf, resource), { user, params: { spaceId: spaceOf.spaceId }, body, headers });

const balanceOf = async (user: TestUser, accountId: string) => {
  const response = await call(getAccount, "GET", inSpace(user, `accounts/${accountId}`), {
    user,
    params: { spaceId: user.spaceId, accountId },
  });
  return ((await response.json()) as { balance: MoneyDto }).balance;
};

const market = (user: LedgerUser, pesos = 85_000, date = "2026-10-05") => ({
  description: "Market",
  amount: cop(pesos),
  date,
  categoryId: user.groceries,
  accountId: user.bancolombia,
});

const recorded = async (response: Promise<Response>) => (await (await response).json()) as TransactionDto;

describe("record a personal expense (HU-E4-01, @critical)", () => {
  it("records an expense with one payment and one share for Ana", async () => {
    const ana = await ledgerUser("Ana");
    const response = await post(recordExpense, ana, "expenses", market(ana));
    expect(response.status).toBe(201);
    expect(response.headers.get("etag")).toBe('"1"');
    const body = (await response.json()) as TransactionDto;
    expect(response.headers.get("location")).toBe(`/api/v1/spaces/${ana.spaceId}/transactions/${body.id}`);
    expect(body).toMatchObject({
      type: "EXPENSE",
      description: "Market",
      date: "2026-10-05",
      amount: cop(85_000),
      categoryId: ana.groceries,
      createdBy: ana.userId,
      version: 1,
    });
    expect(body.payments).toEqual([{ memberId: expect.any(String), accountId: ana.bancolombia, amount: cop(85_000) }]);
    expect(body.shares).toEqual([{ memberId: body.payments[0]!.memberId, amount: cop(85_000), splitMethod: "EQUAL" }]);
  });

  it("replays a repeated Idempotency-Key and records the expense once", async () => {
    const ana = await ledgerUser("Ana");
    const key = { "idempotency-key": "market-2026-10-05" };
    const first = await post(recordExpense, ana, "expenses", market(ana), key);
    const second = await post(recordExpense, ana, "expenses", market(ana), key);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(await second.json()).toEqual(await first.json());
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(1_915_000));
  });

  it("answers invalid input with stable codes", async () => {
    const ana = await ledgerUser("Ana");
    const juan = await ledgerUser("Juan");
    const cases: [unknown, number, string][] = [
      [{ ...market(ana), amount: cop(0) }, 422, "InvalidAmount"],
      [{ ...market(ana), amount: cop(-10_000) }, 422, "InvalidAmount"],
      [{ ...market(ana), categoryId: undefined }, 422, "CategoryRequired"],
      [{ ...market(ana), accountId: juan.bancolombia }, 422, "AccountNotOwned"],
      [{ ...market(ana), date: "2026-02-30" }, 422, "ValidationFailed"],
      [{ ...market(ana), accountId: "not-a-uuid" }, 404, "AccountNotFound"],
    ];
    for (const [body, status, code] of cases) {
      const response = await post(recordExpense, ana, "expenses", body);
      expect([response.status, (await response.json()).code]).toEqual([status, code]);
    }
  });

  it("hides Ana's space from Juan (Review Focus 4)", async () => {
    const ana = await ledgerUser("Ana");
    const juan = await ledgerUser("Juan");
    const response = await post(recordExpense, juan, "expenses", market(juan), {}, ana);
    expect([response.status, (await response.json()).code]).toEqual([404, "SpaceNotFound"]);
  });
});

describe("income, transfers and computed balances (HU-E4-02, HU-E4-03, HU-E2-04)", () => {
  it("records income, an expense and a transfer and computes both balances", async () => {
    const ana = await ledgerUser("Ana");
    const salary = await recorded(
      post(recordIncome, ana, "incomes", {
        description: "Salary October",
        amount: cop(3_000_000),
        date: "2026-10-25",
        categoryId: ana.salary,
        accountId: ana.bancolombia,
      }),
    );
    expect(salary).toMatchObject({ type: "INCOME", destinationAccountId: ana.bancolombia, receivingMemberId: expect.any(String) });
    await post(recordExpense, ana, "expenses", market(ana));
    const transfer = await recorded(
      post(recordTransfer, ana, "transfers", {
        amount: cop(500_000),
        date: "2026-10-06",
        sourceAccountId: ana.bancolombia,
        destinationAccountId: ana.nequi,
      }),
    );
    expect(transfer).toMatchObject({ type: "TRANSFER", categoryId: null });
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(4_415_000));
    expect(await balanceOf(ana, ana.nequi)).toEqual(cop(500_000));
  });

  it("rejects a transfer to the same account", async () => {
    const ana = await ledgerUser("Ana");
    const response = await post(recordTransfer, ana, "transfers", {
      amount: cop(500_000),
      sourceAccountId: ana.bancolombia,
      destinationAccountId: ana.bancolombia,
    });
    expect([response.status, (await response.json()).code]).toEqual([409, "SameAccountTransfer"]);
  });
});
```

Run: `pnpm exec vitest run --project unit src/shared/http/problem.test.ts && pnpm exec vitest run --project acceptance tests/acceptance/ledger.test.ts`
Expected: FAIL — `CategoryRequired` maps to 409 instead of 422, and `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/expenses/route"`.

- [ ] **Step 2: Status mapping and the idempotency hook**

In `src/shared/http/problem.ts`, add to the `EXPLICIT` map after `["CurrencyMismatch", 422],`:

```ts
  ["CategoryRequired", 422],
  ["AccountNotOwned", 422],
  ["AccountNotInSpace", 422],
```

Replace `src/composition/route.ts` with:

```ts
import { createRouteFactory, idempotent, type HttpSuccess, type RouteContext } from "@/shared/http";
import type { Result } from "@/shared/kernel";
import { getContainer } from "./container";

/** Route handlers bound to the process container. */
export const defineRoute = createRouteFactory(getContainer);

/**
 * `before` hook for POSTs that create transactions (spec section 7). The container is resolved per
 * request, so tests can install theirs after the route module was imported.
 */
export const withIdempotency = <B, Q, P>(
  ctx: RouteContext<B, Q, P>,
  next: () => Promise<Result<HttpSuccess>>,
): Promise<Result<HttpSuccess>> => idempotent(getContainer().idempotency)(ctx, next);
```

- [ ] **Step 3: Contract, routes and wiring**

`src/modules/ledger/contracts/ledger.contract.ts`:

```ts
import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, MoneySchema, problems, securedByUser } from "@/shared/http/contracts";
import { etagOf } from "@/shared/http/etag";
import type { Transaction } from "../application";

const Id = z.string().min(1).max(64);
// Length rules live in the domain (InvalidDescription, 200 characters); the cap only bounds payload size.
const Description = z.string().max(1000).optional();

export const PaymentSchema = z.object({
  memberId: z.string().nullable(),
  accountId: z.string().nullable(),
  amount: MoneySchema,
});
export const ShareSchema = z.object({
  memberId: z.string(),
  amount: MoneySchema,
  splitMethod: z.enum(["EQUAL", "PERCENT", "EXACT", "SHARES", "BY_ALLOCATION"]),
});
export const TransactionSchema = z.object({
  id: z.string(),
  type: z.enum(["EXPENSE", "INCOME", "TRANSFER"]),
  description: z.string(),
  date: z.iso.date(),
  amount: MoneySchema,
  categoryId: z.string().nullable(),
  payments: z.array(PaymentSchema),
  shares: z.array(ShareSchema),
  sourceAccountId: z.string().nullable(),
  destinationAccountId: z.string().nullable(),
  receivingMemberId: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Same value as the ETag; send it back in If-Match. */
  version: z.number().int(),
});

/** M1 shape (HU-E4-01): one payment by the requester from `accountId`. HU-E4-07 adds payments[] and split. */
export const RecordExpenseBodySchema = z.object({
  description: Description,
  date: z.iso.date().optional(),
  categoryId: Id.optional(),
  amount: MoneySchema,
  accountId: Id,
});
/** `accountId` is the requester's account in this space that receives the money (HU-E4-02). */
export const RecordIncomeBodySchema = z.object({
  description: Description,
  date: z.iso.date().optional(),
  categoryId: Id.optional(),
  amount: MoneySchema,
  accountId: Id,
});
export const RecordTransferBodySchema = z.object({
  description: Description,
  date: z.iso.date().optional(),
  amount: MoneySchema,
  sourceAccountId: Id,
  destinationAccountId: Id,
});

export const transactionDto = (tx: Transaction): z.infer<typeof TransactionSchema> => {
  const money = (minor: bigint) => ({ amount: minor.toString(), currency: tx.currency });
  return {
    id: tx.id,
    type: tx.type,
    description: tx.description,
    date: tx.date,
    amount: money(tx.amount),
    categoryId: tx.categoryId,
    payments:
      tx.type === "EXPENSE"
        ? tx.payments.map((p) => ({ memberId: p.memberId, accountId: p.accountId, amount: money(p.amount) }))
        : [],
    shares:
      tx.type === "EXPENSE"
        ? tx.shares.map((s) => ({ memberId: s.memberId, amount: money(s.amount), splitMethod: s.splitMethod }))
        : [],
    sourceAccountId: tx.type === "TRANSFER" ? tx.sourceAccountId : null,
    destinationAccountId: tx.type === "EXPENSE" ? null : tx.destinationAccountId,
    receivingMemberId: tx.type === "INCOME" ? tx.receivingMemberId : null,
    createdBy: tx.createdBy,
    createdAt: tx.createdAt.toISOString(),
    updatedAt: tx.updatedAt.toISOString(),
    version: tx.version,
  };
};

export const transactionHeaders = (tx: Transaction): [string, string][] => [
  ["etag", etagOf(tx.version)],
  ["location", `/api/v1/spaces/${tx.spaceId}/transactions/${tx.id}`],
];

const SpacePath = z.object({ spaceId: z.string() });
const IdempotencyHeader = z.object({ "idempotency-key": z.string().max(255).optional() });

const recording = (operationId: string, summary: string, body: z.ZodType, errors: Record<string, string>) => ({
  post: {
    operationId,
    summary,
    ...securedByUser,
    requestParams: { path: SpacePath, header: IdempotencyHeader },
    requestBody: { content: jsonContent(body) },
    responses: {
      "201": { description: "The recorded transaction; ETag carries its version", content: jsonContent(TransactionSchema) },
      ...problems({ "401": "Unauthenticated", "403": "InsufficientRole", ...errors }),
    },
  },
});

const invalidMoney = "ValidationFailed, InvalidAmount, InvalidDate, InvalidDescription, CurrencyMismatch, UnknownCurrency, InvalidIdempotencyKey";

export const ledgerPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces/{spaceId}/expenses": recording(
    "recordExpense",
    "Record an expense paid from one of the requester's accounts",
    RecordExpenseBodySchema,
    {
      "404": "SpaceNotFound, CategoryNotFound, AccountNotFound",
      "409": "AccountArchived, CategoryArchived, PeriodClosed, IdempotencyKeyConflict",
      "422": `${invalidMoney}, CategoryRequired, AccountNotOwned`,
    },
  ),
  "/api/v1/spaces/{spaceId}/incomes": recording(
    "recordIncome",
    "Record income into one of the requester's accounts in this space",
    RecordIncomeBodySchema,
    {
      "404": "SpaceNotFound, CategoryNotFound, AccountNotFound",
      "409": "AccountArchived, CategoryArchived, PeriodClosed, IdempotencyKeyConflict",
      "422": `${invalidMoney}, CategoryRequired, AccountNotOwned, AccountNotInSpace`,
    },
  ),
  "/api/v1/spaces/{spaceId}/transfers": recording(
    "recordTransfer",
    "Move money between two of the requester's accounts in this space",
    RecordTransferBodySchema,
    {
      "404": "SpaceNotFound, AccountNotFound",
      "409": "SameAccountTransfer, AccountArchived, PeriodClosed, IdempotencyKeyConflict",
      "422": `${invalidMoney}, AccountNotOwned, AccountNotInSpace`,
    },
  ),
};
```

`src/app/api/v1/spaces/[spaceId]/expenses/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  RecordExpenseBodySchema,
  transactionDto,
  transactionHeaders,
} from "@/modules/ledger/contracts/ledger.contract";
import { moneyFromDto, optionalLocalDate } from "@/shared/http/contracts";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: RecordExpenseBodySchema,
  before: withIdempotency,
  handler: async ({ user, params, body }) => {
    const amount = moneyFromDto(body.amount);
    if (!amount.ok) return amount;
    const date = optionalLocalDate(body.date);
    if (!date.ok) return date;
    const result = await getContainer().ledger.recordExpense({
      spaceId: params.spaceId!,
      userId: user!.id,
      description: body.description,
      date: date.value,
      categoryId: body.categoryId,
      amount: amount.value,
      accountId: body.accountId,
    });
    return result.ok
      ? ok({ status: 201, body: transactionDto(result.value), headers: transactionHeaders(result.value) })
      : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/incomes/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  RecordIncomeBodySchema,
  transactionDto,
  transactionHeaders,
} from "@/modules/ledger/contracts/ledger.contract";
import { moneyFromDto, optionalLocalDate } from "@/shared/http/contracts";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: RecordIncomeBodySchema,
  before: withIdempotency,
  handler: async ({ user, params, body }) => {
    const amount = moneyFromDto(body.amount);
    if (!amount.ok) return amount;
    const date = optionalLocalDate(body.date);
    if (!date.ok) return date;
    const result = await getContainer().ledger.recordIncome({
      spaceId: params.spaceId!,
      userId: user!.id,
      description: body.description,
      date: date.value,
      categoryId: body.categoryId,
      amount: amount.value,
      accountId: body.accountId,
    });
    return result.ok
      ? ok({ status: 201, body: transactionDto(result.value), headers: transactionHeaders(result.value) })
      : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/transfers/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  RecordTransferBodySchema,
  transactionDto,
  transactionHeaders,
} from "@/modules/ledger/contracts/ledger.contract";
import { moneyFromDto, optionalLocalDate } from "@/shared/http/contracts";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: RecordTransferBodySchema,
  before: withIdempotency,
  handler: async ({ user, params, body }) => {
    const amount = moneyFromDto(body.amount);
    if (!amount.ok) return amount;
    const date = optionalLocalDate(body.date);
    if (!date.ok) return date;
    const result = await getContainer().ledger.recordTransfer({
      spaceId: params.spaceId!,
      userId: user!.id,
      description: body.description,
      date: date.value,
      amount: amount.value,
      sourceAccountId: body.sourceAccountId,
      destinationAccountId: body.destinationAccountId,
    });
    return result.ok
      ? ok({ status: 201, body: transactionDto(result.value), headers: transactionHeaders(result.value) })
      : result;
  },
});
```

In `src/composition/container.ts`:

1. Add imports:

```ts
import {
  createRecordExpense,
  createRecordIncome,
  createRecordTransfer,
  type LedgerDeps,
  type RecordExpense,
  type RecordIncome,
  type RecordTransfer,
} from "@/modules/ledger/application";
import { DrizzleAuditLog } from "@/modules/ledger/infrastructure/drizzle-audit-log";
import { DrizzleTransactionRepository } from "@/modules/ledger/infrastructure/drizzle-transaction-repository";
```

2. Add to `interface Container` (after `accounts`):

```ts
  readonly ledger: {
    readonly recordExpense: RecordExpense;
    readonly recordIncome: RecordIncome;
    readonly recordTransfer: RecordTransfer;
  };
```

3. In `buildContainer`, after `storedPeriods`, add:

```ts
  const ledgerDeps: LedgerDeps = {
    access,
    transactions: new DrizzleTransactionRepository(tm),
    query: ledgerQueries,
    audit: new DrizzleAuditLog(tm),
    // Adapters keep the ledger independent of the accounts and categories modules.
    accounts: {
      find: async (accountId) => {
        const account = await accountsDeps.accounts.findById(accountId);
        return account
          ? { id: account.id, spaceId: account.spaceId, ownerUserId: account.ownerUserId, archived: account.archivedAt !== null }
          : null;
      },
    },
    categories: {
      find: async (spaceId, categoryId) => {
        const category = (await categoriesDeps.categories.listCategories(spaceId)).find((c) => c.id === categoryId);
        return category ? { id: category.id, archived: category.archivedAt !== null } : null;
      },
    },
    // Closing plans arrives with HU-E6-07; until then no period is closed.
    closedPeriods: { isClosed: async () => false },
    storedPeriods,
    ids,
    clock,
    timeZone: env.APP_TIMEZONE,
    tm,
  };
```

4. Add to the returned object (after `accounts`):

```ts
    ledger: {
      recordExpense: createRecordExpense(ledgerDeps),
      recordIncome: createRecordIncome(ledgerDeps),
      recordTransfer: createRecordTransfer(ledgerDeps),
    },
```

In `src/composition/openapi.ts`, import `{ ledgerPaths, TransactionSchema }` from `@/modules/ledger/contracts/ledger.contract`, add `...ledgerPaths` to `paths` and `Transaction: TransactionSchema` to `components.schemas`.

- [ ] **Step 4: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project unit src/shared/http && pnpm exec vitest run --project acceptance`
Expected: PASS.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect: the diff adds the three POST operations and the `Transaction` component only.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/http/problem.ts src/shared/http/problem.test.ts src/composition src/modules/ledger/contracts "src/app/api/v1/spaces/[spaceId]/expenses" "src/app/api/v1/spaces/[spaceId]/incomes" "src/app/api/v1/spaces/[spaceId]/transfers" openapi/openapi.snapshot.json tests/acceptance/ledger.test.ts
git commit -m "feat(ledger): expose idempotent expense, income and transfer endpoints (Refs #30, Refs #31, Refs #32)"
```

---

### Task 27: HTTP — list transactions by period and get one

Exposes HU-E4-04 (issue #33) and HU-E4-05 (issue #34): `GET /transactions?period=&categoryIds=&payerMemberId=&participantMemberId=&type=&cursor=&limit=` returning the resolved `period`, period `totals` and a cursor page; `GET /transactions/{transactionId}` with its `ETag`. Pins Review Focus 4 for cursors (a cursor whose id is not a UUID is `InvalidCursor`, never a failed cast).

Decision: `categoryIds` is comma-separated (`?categoryIds=a,b`) because `defineRoute` reads the query with `Object.fromEntries`, which keeps only the last value of a repeated key. Semi-monthly labels are sent URL-encoded (`2026-11%20H1`), as the backlog states.

**Files:**
- Modify: `src/modules/ledger/contracts/ledger.contract.ts`
- Create: `src/app/api/v1/spaces/[spaceId]/transactions/route.ts`, `src/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route.ts`
- Modify: `src/composition/container.ts`, `openapi/openapi.snapshot.json`
- Test: `tests/acceptance/ledger.test.ts`

**Interfaces:**
- Consumes: `createListTransactions`, `createGetTransaction`, `TransactionPage`, `TransactionPosition` (Task 17); `PaginationQuerySchema`, `encodeCursor`, `decodeCursor`, `etagOf` (M0); `PeriodSchema`, `periodDto` (Task 25); container local `ledgerDeps` (Task 26).
- Produces:
  - `ListTransactionsQuerySchema`, `ListTransactionsResponseSchema`, `transactionPageDto(page)`, `positionFromCursor(raw: string): Result<TransactionPosition>` (`InvalidCursor`)
  - `GET /api/v1/spaces/{spaceId}/transactions` → `200 { period: { label, startDate, endDate }, totals: { expenses: Money, income: Money }, items: Transaction[], nextCursor: string | null }`
  - `GET /api/v1/spaces/{spaceId}/transactions/{transactionId}` → `200 Transaction` with `ETag`
  - `Container.ledger.{listTransactions, getTransaction}`

- [ ] **Step 1: Write the failing acceptance tests**

In `tests/acceptance/ledger.test.ts`, add the imports

```ts
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import { PATCH as updateSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import { GET as getTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
```

and append:

```ts
interface PageDto {
  period: { label: string; startDate: string; endDate: string };
  totals: { expenses: MoneyDto; income: MoneyDto };
  items: TransactionDto[];
  nextCursor: string | null;
  code?: string;
}

const listOf = async (user: TestUser, query: string) => {
  const response = await call(listTransactions, "GET", inSpace(user, `transactions${query}`), {
    user,
    params: { spaceId: user.spaceId },
  });
  return { status: response.status, body: (await response.json()) as PageDto };
};

describe("monthly transaction list (HU-E4-04, HU-E4-05)", () => {
  it("lists a period newest first with totals, filters by category and pages with a cursor", async () => {
    const ana = await ledgerUser("Ana");
    const restaurants = await categoryWithKey(ana, "restaurants");
    await post(recordExpense, ana, "expenses", market(ana, 85_000, "2026-10-05"));
    await post(recordExpense, ana, "expenses", market(ana, 100_000, "2026-10-12"));
    await post(recordExpense, ana, "expenses", { ...market(ana, 60_000, "2026-10-15"), description: "Dinner", categoryId: restaurants });
    await post(recordIncome, ana, "incomes", {
      description: "Salary",
      amount: cop(3_200_000),
      date: "2026-10-25",
      categoryId: ana.salary,
      accountId: ana.bancolombia,
    });

    const { body: page } = await listOf(ana, "?period=2026-10");
    expect(page.period).toEqual({ label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(page.items.map((t) => t.date)).toEqual(["2026-10-25", "2026-10-15", "2026-10-12", "2026-10-05"]);
    expect(page.totals).toEqual({ expenses: cop(245_000), income: cop(3_200_000) });

    const { body: groceries } = await listOf(ana, `?period=2026-10&categoryIds=${ana.groceries}`);
    expect(groceries.items).toHaveLength(2);
    expect(groceries.totals.expenses).toEqual(cop(185_000));

    const { body: first } = await listOf(ana, "?period=2026-10&limit=3");
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    const { body: rest } = await listOf(ana, `?period=2026-10&limit=3&cursor=${first.nextCursor}`);
    expect(rest.items.map((t) => t.date)).toEqual(["2026-10-05"]);
    expect(rest.nextCursor).toBeNull();
  });

  it("resolves URL-encoded semi-monthly labels", async () => {
    const ana = await ledgerUser("Ana");
    await call(updateSpace, "PATCH", `/api/v1/spaces/${ana.spaceId}`, {
      user: ana,
      params: { spaceId: ana.spaceId },
      body: { periodPolicy: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } },
    });
    await post(recordExpense, ana, "expenses", market(ana, 70_000, "2026-11-10"));
    await post(recordExpense, ana, "expenses", market(ana, 50_000, "2026-11-20"));
    const { body: firstHalf } = await listOf(ana, "?period=2026-11%20H1");
    expect(firstHalf.period).toEqual({ label: "2026-11 H1", startDate: "2026-11-01", endDate: "2026-11-15" });
    expect(firstHalf.totals.expenses).toEqual(cop(70_000));
    const { body: secondHalf } = await listOf(ana, "?period=2026-11%20H2");
    expect(secondHalf.totals.expenses).toEqual(cop(50_000));
  });

  it("keeps listing the transactions of an archived account (HU-E2-03)", async () => {
    const ana = await ledgerUser("Ana");
    const tx = await recorded(post(recordExpense, ana, "expenses", { ...market(ana), accountId: ana.nequi }));
    await call(archiveAccount, "POST", inSpace(ana, `accounts/${ana.nequi}/archive`), {
      user: ana,
      params: { spaceId: ana.spaceId, accountId: ana.nequi },
    });
    expect((await listOf(ana, "?period=2026-10")).body.items.map((t) => t.id)).toEqual([tx.id]);
  });

  it("rejects malformed cursors, labels and filters with 422 (Review Focus 4)", async () => {
    const ana = await ledgerUser("Ana");
    const nonUuidCursor = Buffer.from(JSON.stringify(["2026-10-05", "not-a-uuid"]), "utf8").toString("base64url");
    const cases: [string, string][] = [
      ["?cursor=garbage!!", "InvalidCursor"],
      [`?cursor=${nonUuidCursor}`, "InvalidCursor"],
      ["?period=2026-13", "InvalidPeriodLabel"],
      ["?categoryIds=nope", "ValidationFailed"],
      ["?limit=201", "ValidationFailed"],
    ];
    for (const [query, code] of cases) {
      expect(await listOf(ana, query)).toMatchObject({ status: 422, body: { code } });
    }
  });

  it("returns one transaction with its ETag and hides foreign and malformed ids", async () => {
    const ana = await ledgerUser("Ana");
    const juan = await ledgerUser("Juan");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    const get = (user: TestUser, spaceOf: TestUser, id: string) =>
      call(getTransaction, "GET", inSpace(spaceOf, `transactions/${id}`), {
        user,
        params: { spaceId: spaceOf.spaceId, transactionId: id },
      });
    const own = await get(ana, ana, tx.id);
    expect([own.status, own.headers.get("etag")]).toEqual([200, '"1"']);
    expect((await (await get(juan, ana, tx.id)).json()).code).toBe("SpaceNotFound");
    expect((await (await get(juan, juan, tx.id)).json()).code).toBe("TransactionNotFound");
    expect((await (await get(ana, ana, "not-a-uuid")).json()).code).toBe("TransactionNotFound");
  });
});
```

Run: `pnpm exec vitest run --project acceptance tests/acceptance/ledger.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/transactions/route"`.

- [ ] **Step 2: Extend the contract**

In `src/modules/ledger/contracts/ledger.contract.ts`, replace the imports with

```ts
import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, MoneySchema, PeriodSchema, periodDto, problems, securedByUser } from "@/shared/http/contracts";
import { etagOf } from "@/shared/http/etag";
import { decodeCursor, encodeCursor, PaginationQuerySchema } from "@/shared/http/pagination";
import { domainError, err, isUuid, localDate, ok, type Result } from "@/shared/kernel";
import type { Transaction, TransactionPage, TransactionPosition } from "../application";
```

add after `transactionHeaders`:

```ts
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

export const ListTransactionsQuerySchema = PaginationQuerySchema.extend({
  /** "2026-10" (monthly) or "2026-11 H1" (semi-monthly, URL-encoded); the current period when absent. */
  period: z.string().max(20).optional(),
  /** Comma-separated category ids. */
  categoryIds: z
    .string()
    .regex(new RegExp(`^${UUID}(,${UUID}){0,49}$`), { error: "Comma-separated category ids" })
    .optional(),
  payerMemberId: z.uuid().optional(),
  participantMemberId: z.uuid().optional(),
  type: z.enum(["EXPENSE", "INCOME", "TRANSFER"]).optional(),
});

export const ListTransactionsResponseSchema = z.object({
  period: PeriodSchema,
  totals: z.object({ expenses: MoneySchema, income: MoneySchema }),
  items: z.array(TransactionSchema),
  nextCursor: z.string().nullable(),
});

export const transactionPageDto = (page: TransactionPage): z.infer<typeof ListTransactionsResponseSchema> => ({
  period: periodDto(page.period),
  totals: {
    expenses: { amount: page.totals.expenses.toString(), currency: page.currency },
    income: { amount: page.totals.income.toString(), currency: page.currency },
  },
  items: page.items.map(transactionDto),
  nextCursor: page.nextPosition ? encodeCursor({ sortKey: page.nextPosition.date, id: page.nextPosition.id }) : null,
});

/** A cursor must hold a real date and a UUID, or the keyset query would fail its casts. */
export const positionFromCursor = (raw: string): Result<TransactionPosition> => {
  const cursor = decodeCursor(raw);
  if (!cursor.ok) return cursor;
  const date = localDate(cursor.value.sortKey);
  return date.ok && isUuid(cursor.value.id)
    ? ok({ date: date.value, id: cursor.value.id })
    : err(domainError("InvalidCursor"));
};
```

and add these entries to `ledgerPaths`:

```ts
  "/api/v1/spaces/{spaceId}/transactions": {
    get: {
      operationId: "listTransactions",
      summary: "Transactions of one period, newest first, with period totals (the monthly view)",
      ...securedByUser,
      requestParams: { path: SpacePath, query: ListTransactionsQuerySchema },
      responses: {
        "200": { description: "One page of the period", content: jsonContent(ListTransactionsResponseSchema) },
        ...problems({
          "401": "Unauthenticated",
          "404": "SpaceNotFound",
          "422": "ValidationFailed, InvalidCursor, InvalidPeriodLabel",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/transactions/{transactionId}": {
    get: {
      operationId: "getTransaction",
      summary: "One transaction; ETag carries its version",
      ...securedByUser,
      requestParams: { path: SpacePath.extend({ transactionId: z.string() }) },
      responses: {
        "200": { description: "The transaction", content: jsonContent(TransactionSchema) },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound, TransactionNotFound" }),
      },
    },
  },
```

- [ ] **Step 3: Routes and wiring**

`src/app/api/v1/spaces/[spaceId]/transactions/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  ListTransactionsQuerySchema,
  positionFromCursor,
  transactionPageDto,
} from "@/modules/ledger/contracts/ledger.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: ListTransactionsQuerySchema,
  handler: async ({ user, params, query }) => {
    const after = query.cursor === undefined ? ok(null) : positionFromCursor(query.cursor);
    if (!after.ok) return after;
    const result = await getContainer().ledger.listTransactions({
      spaceId: params.spaceId!,
      userId: user!.id,
      period: query.period,
      categoryIds: query.categoryIds?.split(","),
      payerMemberId: query.payerMemberId,
      participantMemberId: query.participantMemberId,
      type: query.type,
      after: after.value,
      limit: query.limit,
    });
    return result.ok ? ok({ status: 200, body: transactionPageDto(result.value) }) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { transactionDto } from "@/modules/ledger/contracts/ledger.contract";
import { etagOf } from "@/shared/http";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().ledger.getTransaction({
      spaceId: params.spaceId!,
      userId: user!.id,
      transactionId: params.transactionId!,
    });
    return result.ok
      ? ok({ status: 200, body: transactionDto(result.value), headers: [["etag", etagOf(result.value.version)] as const] })
      : result;
  },
});
```

In `src/composition/container.ts`, extend the ledger application import with `createGetTransaction`, `createListTransactions`, `type GetTransaction`, `type ListTransactions`; add `readonly listTransactions: ListTransactions; readonly getTransaction: GetTransaction;` to the `ledger` member of `Container`; and add to the returned `ledger` object:

```ts
      listTransactions: createListTransactions(ledgerDeps),
      getTransaction: createGetTransaction(ledgerDeps),
```

- [ ] **Step 4: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance`
Expected: PASS.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect: the diff adds `GET /api/v1/spaces/{spaceId}/transactions` and `GET /api/v1/spaces/{spaceId}/transactions/{transactionId}` only.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/contracts "src/app/api/v1/spaces/[spaceId]/transactions" src/composition/container.ts openapi/openapi.snapshot.json tests/acceptance/ledger.test.ts
git commit -m "feat(ledger): expose the monthly transaction list and single transaction endpoints (Refs #33, Refs #34)"
```

---

### Task 28: HTTP — edit and delete transactions with the audit trail

Exposes HU-E4-06 (issue #35): `PATCH /transactions/{transactionId}` (honours `If-Match`, stale → `412 PreconditionFailed`, returns the next `ETag`), `DELETE /transactions/{transactionId}` (soft delete, `204`), `GET /transactions/{transactionId}/audit`. Runs HU-E2-04's "deleted transactions are excluded" and HU-E4-04's "editing the date moves the transaction" over HTTP, and pins Review Focus 1 end to end.

**Files:**
- Modify: `src/modules/ledger/contracts/ledger.contract.ts`, `src/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route.ts`
- Create: `src/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/audit/route.ts`
- Modify: `src/composition/container.ts`, `openapi/openapi.snapshot.json`
- Test: `tests/acceptance/ledger.test.ts`

**Interfaces:**
- Consumes: `createEditTransaction`, `createDeleteTransaction`, `createListAudit`, `AuditEntry` (Tasks 15, 18); `ifMatchVersion`, `etagOf` (M0); helpers of Tasks 26–27.
- Produces:
  - `EditTransactionBodySchema { description?, date?, categoryId?, amount? }`, `AuditEntrySchema`, `ListAuditResponseSchema`, `auditEntryDto(entry)`
  - `PATCH /api/v1/spaces/{spaceId}/transactions/{transactionId}` → `200 Transaction` with the new `ETag`
  - `DELETE /api/v1/spaces/{spaceId}/transactions/{transactionId}` → `204`
  - `GET /api/v1/spaces/{spaceId}/transactions/{transactionId}/audit` → `200 { items: AuditEntry[] }`
  - `Container.ledger.{editTransaction, deleteTransaction, listAudit}`

- [ ] **Step 1: Write the failing acceptance tests**

In `tests/acceptance/ledger.test.ts`, change the single-transaction import to

```ts
import {
  DELETE as deleteTransaction,
  GET as getTransaction,
  PATCH as editTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { GET as transactionAudit } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/audit/route";
```

and append:

```ts
interface AuditDto {
  action: string;
  actorUserId: string;
  at: string;
  changes: Record<string, { from: string | null; to: string | null }>;
}

const onTransaction = (handler: RouteHandler, method: string, user: TestUser, id: string, options: { body?: unknown; ifMatch?: string; suffix?: string } = {}) =>
  call(handler, method, inSpace(user, `transactions/${id}${options.suffix ?? ""}`), {
    user,
    params: { spaceId: user.spaceId, transactionId: id },
    body: options.body,
    headers: options.ifMatch === undefined ? {} : { "if-match": options.ifMatch },
  });
const auditOf = async (user: TestUser, id: string) =>
  ((await (await onTransaction(transactionAudit, "GET", user, id, { suffix: "/audit" })).json()) as { items: AuditDto[] }).items;

describe("edit and delete with an audit trail (HU-E4-06)", () => {
  it("edits the amount with If-Match, returns the next ETag and audits the change", async () => {
    const ana = await ledgerUser("Ana");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    const response = await onTransaction(editTransaction, "PATCH", ana, tx.id, { body: { amount: cop(95_000) }, ifMatch: '"1"' });
    expect([response.status, response.headers.get("etag")]).toEqual([200, '"2"']);
    const edited = (await response.json()) as TransactionDto;
    expect(edited.amount).toEqual(cop(95_000));
    expect(edited.payments.map((p) => p.amount)).toEqual([cop(95_000)]);
    expect(edited.shares.map((s) => s.amount)).toEqual([cop(95_000)]);
    expect(await auditOf(ana, tx.id)).toEqual([
      expect.objectContaining({
        action: "UPDATED",
        actorUserId: ana.userId,
        at: expect.any(String),
        changes: { amount: { from: "8500000", to: "9500000" } },
      }),
    ]);
  });

  it("rejects a stale or malformed If-Match with 412 and changes nothing (Review Focus 1)", async () => {
    const ana = await ledgerUser("Ana");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    expect((await onTransaction(editTransaction, "PATCH", ana, tx.id, { body: { description: "Groceries" }, ifMatch: '"1"' })).status).toBe(200);
    for (const ifMatch of ['"1"', "abc"]) {
      const stale = await onTransaction(editTransaction, "PATCH", ana, tx.id, { body: { amount: cop(1_000) }, ifMatch });
      expect([stale.status, (await stale.json()).code]).toEqual([412, "PreconditionFailed"]);
    }
    const current = (await (await onTransaction(getTransaction, "GET", ana, tx.id)).json()) as TransactionDto;
    expect([current.amount, current.description, current.version]).toEqual([cop(85_000), "Groceries", 2]);
    expect(await auditOf(ana, tx.id)).toHaveLength(1);
  });

  it("soft-deletes: gone from lists and balances, still audited (HU-E2-04)", async () => {
    const ana = await ledgerUser("Ana");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(1_915_000));
    expect((await onTransaction(deleteTransaction, "DELETE", ana, tx.id)).status).toBe(204);
    expect((await (await onTransaction(getTransaction, "GET", ana, tx.id)).json()).code).toBe("TransactionNotFound");
    expect((await listOf(ana, "?period=2026-10")).body.items).toEqual([]);
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(2_000_000));
    expect((await auditOf(ana, tx.id)).map((e) => [e.action, e.actorUserId])).toEqual([["DELETED", ana.userId]]);
  });

  it("moves a transaction to another period when its date changes (HU-E4-04)", async () => {
    const ana = await ledgerUser("Ana");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana, 85_000, "2026-10-31")));
    await onTransaction(editTransaction, "PATCH", ana, tx.id, { body: { date: "2026-11-02" } });
    expect((await listOf(ana, "?period=2026-11")).body.items.map((t) => t.id)).toEqual([tx.id]);
    expect((await listOf(ana, "?period=2026-10")).body.items).toEqual([]);
  });

  it("hides other users' transactions", async () => {
    const ana = await ledgerUser("Ana");
    const juan = await ledgerUser("Juan");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    const response = await call(editTransaction, "PATCH", inSpace(ana, `transactions/${tx.id}`), {
      user: juan,
      params: { spaceId: ana.spaceId, transactionId: tx.id },
      body: { description: "Mine" },
    });
    expect([response.status, (await response.json()).code]).toEqual([404, "SpaceNotFound"]);
  });
});
```

Run: `pnpm exec vitest run --project acceptance tests/acceptance/ledger.test.ts`
Expected: FAIL — `Failed to resolve import ".../transactions/[transactionId]/audit/route"` (and no `PATCH`/`DELETE` export yet).

- [ ] **Step 2: Extend the contract**

In `src/modules/ledger/contracts/ledger.contract.ts`, extend the application type import with `AuditEntry` and add after `positionFromCursor`:

```ts
export const EditTransactionBodySchema = z.object({
  description: Description,
  date: z.iso.date().optional(),
  categoryId: Id.optional(),
  amount: MoneySchema.optional(),
});

export const AuditEntrySchema = z.object({
  id: z.string(),
  action: z.enum(["UPDATED", "DELETED"]),
  actorUserId: z.string(),
  at: z.iso.datetime(),
  /** Changed fields with their previous and new values; amounts in minor units as strings. */
  changes: z.record(z.string(), z.object({ from: z.string().nullable(), to: z.string().nullable() })),
});
export const ListAuditResponseSchema = z.object({ items: z.array(AuditEntrySchema) });

export const auditEntryDto = (entry: AuditEntry): z.infer<typeof AuditEntrySchema> => ({
  id: entry.id,
  action: entry.action,
  actorUserId: entry.actorUserId,
  at: entry.at.toISOString(),
  changes: entry.changes,
});
```

add right after the `IdempotencyHeader` declaration (it must follow `SpacePath`, which is declared further down the file than the schemas above):

```ts
const TransactionPath = SpacePath.extend({ transactionId: z.string() });
const IfMatchHeader = z.object({ "if-match": z.string().optional() });
```

and replace the `"/api/v1/spaces/{spaceId}/transactions/{transactionId}"` entry of `ledgerPaths` with these two entries:

```ts
  "/api/v1/spaces/{spaceId}/transactions/{transactionId}": {
    get: {
      operationId: "getTransaction",
      summary: "One transaction; ETag carries its version",
      ...securedByUser,
      requestParams: { path: TransactionPath },
      responses: {
        "200": { description: "The transaction", content: jsonContent(TransactionSchema) },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound, TransactionNotFound" }),
      },
    },
    patch: {
      operationId: "editTransaction",
      summary: "Change description, date, category or amount; send If-Match with the current ETag",
      ...securedByUser,
      requestParams: { path: TransactionPath, header: IfMatchHeader },
      requestBody: { content: jsonContent(EditTransactionBodySchema) },
      responses: {
        "200": { description: "The edited transaction with its new ETag", content: jsonContent(TransactionSchema) },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound, TransactionNotFound, CategoryNotFound",
          "409": "SharesDoNotMatchAmount, CategoryArchived, PeriodClosed, TransferHasNoCategory",
          "412": "PreconditionFailed",
          "422": "ValidationFailed, InvalidAmount, InvalidDate, InvalidDescription, CurrencyMismatch, UnknownCurrency",
        }),
      },
    },
    delete: {
      operationId: "deleteTransaction",
      summary: "Soft-delete a transaction; it leaves lists, balances and totals but keeps its audit trail",
      ...securedByUser,
      requestParams: { path: TransactionPath },
      responses: {
        "204": { description: "Deleted" },
        ...problems({ "401": "Unauthenticated", "403": "InsufficientRole", "404": "SpaceNotFound, TransactionNotFound", "409": "PeriodClosed" }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/transactions/{transactionId}/audit": {
    get: {
      operationId: "listTransactionAudit",
      summary: "Who changed or deleted a transaction, oldest first",
      ...securedByUser,
      requestParams: { path: TransactionPath },
      responses: {
        "200": { description: "Audit entries", content: jsonContent(ListAuditResponseSchema) },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound, TransactionNotFound" }),
      },
    },
  },
```

- [ ] **Step 3: Routes and wiring**

In `src/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route.ts`, replace the imports with

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { EditTransactionBodySchema, transactionDto } from "@/modules/ledger/contracts/ledger.contract";
import { etagOf, ifMatchVersion } from "@/shared/http";
import { moneyFromDto, optionalLocalDate } from "@/shared/http/contracts";
import { ok } from "@/shared/kernel";
```

and append:

```ts
export const PATCH = defineRoute({
  auth: "required",
  body: EditTransactionBodySchema,
  handler: async ({ request, user, params, body }) => {
    // Spec section 7: If-Match is checked when present; a stale version is 412.
    const expectedVersion = ifMatchVersion(request);
    if (!expectedVersion.ok) return expectedVersion;
    const amount = body.amount === undefined ? ok(undefined) : moneyFromDto(body.amount);
    if (!amount.ok) return amount;
    const date = optionalLocalDate(body.date);
    if (!date.ok) return date;
    const result = await getContainer().ledger.editTransaction({
      spaceId: params.spaceId!,
      userId: user!.id,
      transactionId: params.transactionId!,
      expectedVersion: expectedVersion.value,
      changes: { description: body.description, date: date.value, categoryId: body.categoryId, amount: amount.value },
    });
    return result.ok
      ? ok({ status: 200, body: transactionDto(result.value), headers: [["etag", etagOf(result.value.version)] as const] })
      : result;
  },
});

export const DELETE = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().ledger.deleteTransaction({
      spaceId: params.spaceId!,
      userId: user!.id,
      transactionId: params.transactionId!,
    });
    return result.ok ? ok({ status: 204 }) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/audit/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { auditEntryDto } from "@/modules/ledger/contracts/ledger.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().ledger.listAudit({
      spaceId: params.spaceId!,
      userId: user!.id,
      transactionId: params.transactionId!,
    });
    return result.ok ? ok({ status: 200, body: { items: result.value.map(auditEntryDto) } }) : result;
  },
});
```

In `src/composition/container.ts`, extend the ledger application import with `createDeleteTransaction`, `createEditTransaction`, `createListAudit`, `type DeleteTransaction`, `type EditTransaction`, `type ListAudit`; add `readonly editTransaction: EditTransaction; readonly deleteTransaction: DeleteTransaction; readonly listAudit: ListAudit;` to the `ledger` member of `Container`; and add to the returned `ledger` object:

```ts
      editTransaction: createEditTransaction(ledgerDeps),
      deleteTransaction: createDeleteTransaction(ledgerDeps),
      listAudit: createListAudit(ledgerDeps),
```

- [ ] **Step 4: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance`
Expected: PASS.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect: the diff adds `PATCH` and `DELETE /api/v1/spaces/{spaceId}/transactions/{transactionId}` and `GET …/audit`; `GET …/{transactionId}` is unchanged.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/contracts "src/app/api/v1/spaces/[spaceId]/transactions" src/composition/container.ts openapi/openapi.snapshot.json tests/acceptance/ledger.test.ts
git commit -m "feat(ledger): expose transaction edit, soft delete and audit endpoints (Refs #35)"
```

---

### Task 29: HTTP — delete, archive and restore categories

Exposes HU-E3-03 (issue #29): `DELETE /categories/{categoryId}` (`409 CategoryInUse` when any transaction, deleted ones included, references it), `POST /categories/{categoryId}/archive`, `POST /categories/{categoryId}/restore`, `POST /category-groups/{groupId}/archive`. The reference check is bound to `DrizzleLedgerQueries.isCategoryReferenced`. Runs "recording with an archived category is rejected" over HTTP.

**Files:**
- Modify: `src/modules/categories/contracts/categories.contract.ts`, `src/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route.ts`
- Create: `src/app/api/v1/spaces/[spaceId]/categories/[categoryId]/archive/route.ts`, `src/app/api/v1/spaces/[spaceId]/categories/[categoryId]/restore/route.ts`, `src/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/archive/route.ts`
- Modify: `src/composition/container.ts`, `openapi/openapi.snapshot.json`
- Test: `tests/acceptance/categories.test.ts`

**Interfaces:**
- Consumes: `createDeleteCategory`, `createArchiveCategory`, `createRestoreCategory`, `createArchiveCategoryGroup` (Task 7); container locals `categoriesDeps`, `ledgerQueries` (Tasks 22, 24); expense and account routes (Tasks 24, 26).
- Produces:
  - `DELETE /api/v1/spaces/{spaceId}/categories/{categoryId}` → `204`
  - `POST /api/v1/spaces/{spaceId}/categories/{categoryId}/archive` → `200 Category`; `POST …/restore` → `200 Category`
  - `POST /api/v1/spaces/{spaceId}/category-groups/{groupId}/archive` → `200 CategoryGroupSummary`
  - `Container.categories.{deleteCategory, archiveCategory, restoreCategory, archiveCategoryGroup}`

- [ ] **Step 1: Write the failing acceptance tests**

In `tests/acceptance/categories.test.ts`, change the `[categoryId]` route import to

```ts
import {
  DELETE as deleteCategory,
  PATCH as updateCategory,
} from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route";
```

add the imports

```ts
import { POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { POST as archiveCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/archive/route";
import { POST as restoreCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/restore/route";
import { POST as archiveGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/archive/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { GET as getTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
```

extend the support import with `type RouteHandler`, and append:

```ts
describe("retiring categories (HU-E3-03)", () => {
  const onCategory = (handler: RouteHandler, method: string, user: TestUser, categoryId: string, suffix = "") =>
    call(handler, method, `/api/v1/spaces/${user.spaceId}/categories/${categoryId}${suffix}`, {
      user,
      params: { spaceId: user.spaceId, categoryId },
    });
  const names = async (user: TestUser, query = "") =>
    (await groupsIn(await treeOf(user, user.spaceId, query))).flatMap((g) => g.categories).map((c) => c.name);
  const accountOf = async (user: TestUser) => {
    const response = await call(createAccount, "POST", `/api/v1/spaces/${user.spaceId}/accounts`, {
      user,
      params: { spaceId: user.spaceId },
      body: { name: "Bancolombia", type: "BANK", openingBalance: { amount: "0", currency: "COP" } },
    });
    return ((await response.json()) as { id: string }).id;
  };
  const spend = (user: TestUser, accountId: string, categoryId: string) =>
    call(recordExpense, "POST", `/api/v1/spaces/${user.spaceId}/expenses`, {
      user,
      params: { spaceId: user.spaceId },
      body: { amount: { amount: "4000000", currency: "COP" }, date: "2026-10-05", categoryId, accountId },
    });

  it("deletes a category without transactions", async () => {
    const ana = await registerUser("Ana");
    const food = (await groupsIn(await treeOf(ana, ana.spaceId))).find((g) => g.name === "Alimentación")!;
    const created = await call(createCategory, "POST", `/api/v1/spaces/${ana.spaceId}/categories`, {
      user: ana,
      params: { spaceId: ana.spaceId },
      body: { groupId: food.id, name: "Panadería" },
    });
    const bakery = (await created.json()) as CategoryDto;
    expect((await onCategory(deleteCategory, "DELETE", ana, bakery.id)).status).toBe(204);
    expect(await names(ana, "?archived=true")).not.toContain("Panadería");
  });

  it("keeps referenced categories: no delete, archive hides them, new expenses refused, restore brings them back", async () => {
    const ana = await registerUser("Ana");
    const accountId = await accountOf(ana);
    const mercado = (await groupsIn(await treeOf(ana, ana.spaceId))).flatMap((g) => g.categories).find((c) => c.key === "groceries")!;
    const expense = (await (await spend(ana, accountId, mercado.id)).json()) as { id: string };

    const refused = await onCategory(deleteCategory, "DELETE", ana, mercado.id);
    expect([refused.status, (await refused.json()).code]).toEqual([409, "CategoryInUse"]);

    const archived = await onCategory(archiveCategory, "POST", ana, mercado.id, "/archive");
    expect((await archived.json()).archivedAt).toEqual(expect.any(String));
    expect(await names(ana)).not.toContain("Mercado");
    expect(await names(ana, "?archived=true")).toContain("Mercado");
    const history = await call(getTransaction, "GET", `/api/v1/spaces/${ana.spaceId}/transactions/${expense.id}`, {
      user: ana,
      params: { spaceId: ana.spaceId, transactionId: expense.id },
    });
    expect((await history.json()).categoryId).toBe(mercado.id);
    const blocked = await spend(ana, accountId, mercado.id);
    expect([blocked.status, (await blocked.json()).code]).toEqual([409, "CategoryArchived"]);

    const restored = await onCategory(restoreCategory, "POST", ana, mercado.id, "/restore");
    expect((await restored.json()).archivedAt).toBeNull();
    expect(await names(ana)).toContain("Mercado");
  });

  it("archives a group with all its categories", async () => {
    const ana = await registerUser("Ana");
    const leisure = (await groupsIn(await treeOf(ana, ana.spaceId))).find((g) => g.name === "Ocio")!;
    const response = await call(archiveGroup, "POST", `/api/v1/spaces/${ana.spaceId}/category-groups/${leisure.id}/archive`, {
      user: ana,
      params: { spaceId: ana.spaceId, groupId: leisure.id },
    });
    expect((await response.json()).archivedAt).toEqual(expect.any(String));
    const archivedLeisure = (await groupsIn(await treeOf(ana, ana.spaceId, "?archived=true"))).find((g) => g.id === leisure.id)!;
    expect(archivedLeisure.categories.every((c) => c.archivedAt !== null)).toBe(true);
    const travel = archivedLeisure.categories.find((c) => c.name === "Viajes")!;
    const restore = await onCategory(restoreCategory, "POST", ana, travel.id, "/restore");
    expect([restore.status, (await restore.json()).code]).toEqual([409, "CategoryGroupArchived"]);
  });
});
```

Run: `pnpm exec vitest run --project acceptance tests/acceptance/categories.test.ts`
Expected: FAIL — `Failed to resolve import ".../categories/[categoryId]/archive/route"`.

- [ ] **Step 2: Extend the contract**

In `src/modules/categories/contracts/categories.contract.ts`, add a `delete` operation next to `patch` in the `"/api/v1/spaces/{spaceId}/categories/{categoryId}"` entry:

```ts
    delete: {
      operationId: "deleteCategory",
      summary: "Delete a category that no transaction references (archive it otherwise)",
      ...securedByUser,
      requestParams: { path: CategoryPath },
      responses: {
        "204": { description: "Deleted" },
        ...problems({ ...managed, "404": "SpaceNotFound, CategoryNotFound", "409": "CategoryInUse" }),
      },
    },
```

and add these entries to `categoriesPaths`:

```ts
  "/api/v1/spaces/{spaceId}/categories/{categoryId}/archive": {
    post: {
      operationId: "archiveCategory",
      summary: "Archive a category: it stays in history but cannot be used for new transactions",
      ...securedByUser,
      requestParams: { path: CategoryPath },
      responses: {
        "200": { description: "The archived category", content: jsonContent(CategorySchema) },
        ...problems({ ...managed, "404": "SpaceNotFound, CategoryNotFound" }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/categories/{categoryId}/restore": {
    post: {
      operationId: "restoreCategory",
      summary: "Restore an archived category",
      ...securedByUser,
      requestParams: { path: CategoryPath },
      responses: {
        "200": { description: "The restored category", content: jsonContent(CategorySchema) },
        ...problems({ ...managed, "404": "SpaceNotFound, CategoryNotFound", "409": "CategoryGroupArchived" }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/category-groups/{groupId}/archive": {
    post: {
      operationId: "archiveCategoryGroup",
      summary: "Archive a group together with all its categories",
      ...securedByUser,
      requestParams: { path: GroupPath },
      responses: {
        "200": { description: "The archived group", content: jsonContent(CategoryGroupSummarySchema) },
        ...problems({ ...managed, "404": "SpaceNotFound, CategoryGroupNotFound" }),
      },
    },
  },
```

- [ ] **Step 3: Routes and wiring**

Append to `src/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route.ts`:

```ts
export const DELETE = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().categories.deleteCategory({
      spaceId: params.spaceId!,
      userId: user!.id,
      categoryId: params.categoryId!,
    });
    return result.ok ? ok({ status: 204 }) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/categories/[categoryId]/archive/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { categoryDto } from "@/modules/categories/contracts/categories.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().categories.archiveCategory({
      spaceId: params.spaceId!,
      userId: user!.id,
      categoryId: params.categoryId!,
    });
    return result.ok ? ok({ status: 200, body: categoryDto(result.value) }) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/categories/[categoryId]/restore/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { categoryDto } from "@/modules/categories/contracts/categories.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().categories.restoreCategory({
      spaceId: params.spaceId!,
      userId: user!.id,
      categoryId: params.categoryId!,
    });
    return result.ok ? ok({ status: 200, body: categoryDto(result.value) }) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/archive/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { categoryGroupDto } from "@/modules/categories/contracts/categories.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().categories.archiveCategoryGroup({
      spaceId: params.spaceId!,
      userId: user!.id,
      groupId: params.groupId!,
    });
    return result.ok ? ok({ status: 200, body: categoryGroupDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Extend the categories application import with `createArchiveCategory`, `createArchiveCategoryGroup`, `createDeleteCategory`, `createRestoreCategory`, `type ArchiveCategory`, `type ArchiveCategoryGroup`, `type DeleteCategory`, `type RestoreCategory`.
2. Add to the `categories` member of `Container`:

```ts
    readonly deleteCategory: DeleteCategory;
    readonly archiveCategory: ArchiveCategory;
    readonly restoreCategory: RestoreCategory;
    readonly archiveCategoryGroup: ArchiveCategoryGroup;
```

3. Add to the returned `categories` object:

```ts
      // HU-E3-03: soft-deleted transactions still count as references (D8).
      deleteCategory: createDeleteCategory({ ...categoriesDeps, usage: ledgerQueries }),
      archiveCategory: createArchiveCategory(categoriesDeps),
      restoreCategory: createRestoreCategory(categoriesDeps),
      archiveCategoryGroup: createArchiveCategoryGroup(categoriesDeps),
```

- [ ] **Step 4: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance`
Expected: PASS (all acceptance files).

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect: the diff adds `DELETE /api/v1/spaces/{spaceId}/categories/{categoryId}`, `POST …/archive`, `POST …/restore` and `POST /api/v1/spaces/{spaceId}/category-groups/{groupId}/archive` only.

- [ ] **Step 5: Full gates and build**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check && pnpm build`
Expected: all exit 0; the build route list contains every new `/api/v1/spaces/[spaceId]/…` handler.

- [ ] **Step 6: Commit**

```bash
git add src/modules/categories/contracts "src/app/api/v1/spaces/[spaceId]/categories" "src/app/api/v1/spaces/[spaceId]/category-groups" src/composition/container.ts openapi/openapi.snapshot.json tests/acceptance/categories.test.ts
git commit -m "feat(categories): expose category delete, archive and restore endpoints (Refs #29)"
```

---

## Self-Review

### Story coverage

| Story | Scenario → where it is tested |
|---|---|
| HU-E1-03 (#12) | Monthly 25 → Tasks 2, 25 · Semi-monthly 5/20 → Tasks 1, 2, 25 · Invalid policy (0, 32, 20/5) → Tasks 2, 25 · Plan does not move → Tasks 1, 2 (unit; plans exist from M3, port bound to an empty list) · Member without admin rights → Task 2 (unit; roles other than OWNER arrive in M2) · Currency locked → Tasks 2, 25 |
| HU-E2-01 (#23) | Bank account → Tasks 10, 24 · Negative credit card → Tasks 10, 24 · Duplicate name (case-insensitive) → Tasks 10, 13, 24 · SHARED_FUND in personal space → Tasks 10, 24 |
| HU-E2-03 (#25) | Correct opening balance → Tasks 11, 24 · Type immutable → Tasks 10, 11, 24 · Archived keeps history, hidden from active list → Tasks 11, 24, 27 · Recording on archived account → Tasks 15, 16 |
| HU-E2-04 (#26) | All transaction types → Tasks 11, 21, 26 · Shared expense reduces payer account by full payment → Task 21 (SQL; shared expenses reach HTTP in M2) · Deleted excluded → Tasks 21, 28 · Balance as of a date → Tasks 11, 21 |
| HU-E3-01 (#27) | Spanish tree on personal space → Tasks 4, 5, 22 · English names → Tasks 4, 5 (unit; shared spaces in M2) · Idempotent → Tasks 5, 9 (unique key index) · Belongs only to its space → Tasks 5, 6 · Stable catalog key; user categories have none → Tasks 4, 6, 22 |
| HU-E3-02 (#28) | Create in group → Tasks 6, 23 · Rename group → Tasks 6, 23 · Move category (transactions keep it) → Tasks 6, 23 · Third level → Tasks 6, 23 · Duplicate name → Tasks 4, 6, 9, 23 · Viewer → Task 6 (unit) |
| HU-E3-03 (#29) | Delete unreferenced → Tasks 7, 29 · Referenced → CategoryInUse → Tasks 7, 21, 29 · Archived stays in history, hidden from active list → Tasks 7, 29 · Recording with archived category → Tasks 15, 29 · Restore → Tasks 7, 29 |
| HU-E4-01 (#30) | Record (`@critical`) → Tasks 15, 26 (acceptance) · Date defaults to today in space timezone → Task 15 · Invalid amounts → Tasks 14, 15, 26 · Category required → Tasks 15, 26 · Another user's account → Tasks 15, 26 |
| HU-E4-02 (#31) | Salary → Tasks 16, 26 · Archived account → Task 16 · Income is not spending → Tasks 17, 21 |
| HU-E4-03 (#32) | Bank to wallet, no category, not spending → Tasks 16, 17, 26 · Same account → Tasks 14, 16, 26 · Destination owned by another user → Task 16 |
| HU-E4-04 (#33) | MONTHLY(1) → Tasks 1, 17 · MONTHLY(25) → Tasks 1, 17 · SEMI_MONTHLY(1, 16) → Tasks 1, 17, 27 · Editing the date moves the period → Tasks 18, 28 |
| HU-E4-05 (#34) | Current period default, newest first, totals → Tasks 17, 21 · Category filter → Tasks 17, 21, 27 · Member filter → Tasks 17, 21 (reachable over HTTP in M2) · Deleted hidden → Tasks 17, 21, 28 · Pagination 50 + nextCursor → Tasks 17, 21, 27 |
| HU-E4-06 (#35) | Edit amount with audit → Tasks 14, 18, 28 · Shared shares invariant → Tasks 14, 18 · Soft delete with audit → Tasks 18, 20, 28 · Member edits another's → Tasks 14, 18 · Closed period → Task 18 (guard port; always open until HU-E6-07) |

Spec checks: D6 (bigint, one currency) → Tasks 10, 13, 21; D7 (computed on read) → Tasks 11, 21; D8 (soft delete, audit) → Tasks 14, 18–20; D9 (pay from own account) → Task 15; D10 (stored boundaries win) → Tasks 1–2; D11 (catalog key) → Task 4; section 7 (idempotency, ETag/If-Match, cursor pagination, problem+json) → Tasks 26–28; section 8 (non-members get SpaceNotFound, status mapping) → Tasks 2, 22–29.

### Review Focus pins

1. Stale `If-Match` → Task 18 (use case), Task 20 (compare-and-set), Task 28 (HTTP).
2. Many transactions on one date → Task 21 (120 rows, keyset on `(date, id)`); Task 17 (use-case paging).
3. Month-end clamping and UTC midnight → Task 1 (`MONTHLY(31)` labels, collapsed half), Task 2 (default `from`), Task 15 (default date), Task 17 (listing `2027-03`).
4. Malformed or foreign ids → Tasks 3, 13, 20 (repositories), Task 21 (`netMovements`), Task 22 and 26 (another user's space), Task 27 (`InvalidCursor`, transaction ids).
5. Sums beyond `bigint` → Task 21 (balances and totals at 12,000,000,000,000,000,000 minor units).

### Spec open questions and assumptions

Spec section 11 has no open question left (all three are resolved). Two items are still "pending owner confirmation": the default category seed (HU-E3-01) and the role rules (HU-E1-05). This plan implements the seed exactly as the backlog lists it and uses OWNER/ADMIN for management, MEMBER and above for recording, owner/admin-or-creator for edits.

Gaps found while planning, with the assumption each task makes:

1. **Space timezone** — spaces have no timezone field; "today in the space timezone" uses the deployment `APP_TIMEZONE` (default `America/Bogota`). Tasks 2, 15, 17.
2. **Plans and closed periods do not exist until M3** — `StoredPeriodSource` returns an empty list and `ClosedPeriodGuard` is always open; the overlap rule and the guard calls are implemented and unit-tested now. Tasks 1, 2, 15, 18.
3. **Currency lock** — extended from "transactions exist" to "accounts or transactions exist", because accounts carry no currency of their own. Task 2.
4. **M1 expense body** — `accountId` shorthand (one payment and one EQUAL share for the requester); `payments[]`/`split` arrive with HU-E4-07 on the same endpoint. Task 15.
5. **Income category** — required (`CategoryRequired`), following spec 5.2. Task 16.
6. **Editable fields** — description, date, category, amount; a sole payment/share follows the amount. Task 14.
7. **Audit scope** — entries for edits and deletes; creation is the row's `createdBy`/`createdAt`. Task 14.
8. **Category deletion** — checks only ledger references until budget-line mappings exist (HU-E6-04). Task 7.
9. **Group archive endpoint** — added from the HU-E3-03 technical note. Tasks 7, 29.
10. **No SQL period helper** — periods are resolved in TypeScript and the ledger filters by date range; a SQL mirror is deferred to M4 aggregates. Task 1.
11. **`categoryIds` filter** — comma-separated, because repeated query keys collapse in `defineRoute`. Task 27.
12. **Status codes** — `UnknownCurrency`, `CurrencyMismatch`, `CategoryRequired`, `AccountNotOwned`, `AccountNotInSpace` map to 422. Tasks 24, 26.
13. **Personal spaces created in M0** — no category backfill; assumed to be test data only. Task 22.
14. **Existence of other users' accounts** — `AccountNotOwned` (required by HU-E4-01) reveals that an account id exists; ids are UUIDv7 and not guessable. Task 15.
15. **Settlements in balances** — HU-E2-04's "± settlements with account set" waits for HU-E5-02 (M2).

