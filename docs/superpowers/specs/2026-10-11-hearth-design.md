# Hearth — Design Spec

- **Status:** Draft for review
- **Date:** 2026-10-11
- **Working name:** Hearth (rename freely)

## 1. Problem

Personal spending lives in one app (e.g. MoneyManager) and shared household spending lives in another (e.g. Splitwise / split-pro). Neither answers the questions a household actually has:

- How much did each category consume this month versus its budget?
- How much did each member contribute to each category versus what they were assigned?
- How much did *I* spend in total this month, including my share of shared expenses, and on what?

Splitwise-style tools only answer "who owes whom". Firefly III answers "where did my money go" for one person but cannot divide an expense between people.

## 2. Goal

A self-hosted, multi-user web application that unifies:

1. **Personal finance** (Firefly III concepts): accounts, income, expenses, categories, budgets per period.
2. **Group expense splitting** (split-pro concepts): shared spaces, participants, shares, balances, settlements.
3. **Allocated budgets** (new): a monthly plan per space where each budget line is assigned to members by fixed amount or percentage, and actual spending and contributions are compared against it.

### Success criteria

- A household can define a monthly plan like the reference example (section 4) in under 5 minutes, reusing last month's plan.
- Recording a shared expense charges the right budget line and produces the correct inter-member balance without manual calculation.
- Each member sees, per category and per month: assigned, contributed, consumed, and the gap.
- Each member sees one unified personal view: personal expenses plus their share of every shared expense.

### Non-goals (v1)

- Bank synchronization, OCR receipts, investments, multi-currency conversion, native mobile apps.
- Strict double-entry accounting (see decision D3).

## 3. Users and context

- Self-hosted on a VPS by the owner. Small number of users (a household, a few friends' groups).
- Primary locale es-CO, currency COP, timezone America/Bogota. Code, identifiers and docs in English; UI i18n-ready (es, en).

## 4. Reference example (acceptance anchor)

Household space with members Ana and Juan. Monthly capacity: Ana 1,600,000; Juan 2,400,000; total 4,000,000.

| Budget line | Planned | % of total | Funding | Allocation rule |
|---|---|---|---|---|
| Rent | 1,200,000 | 30.00% | Shared fund | Proportional to capacity (Ana 40% / Juan 60%) |
| Home | 1,470,000 | 36.75% | Direct | Proportional to capacity |
| Savings | 600,000 | 15.00% | Savings (transfer to savings account) | Proportional to capacity |
| Free | 730,000 | 18.25% | Direct, catch-all | Optional; here custom percentage Ana 42% / Juan 58% |

Rules derived from this example:

- Lines sum to at most the total capacity. Unallocated capacity is shown explicitly (zero-based budgeting).
- Allocation is **group-size agnostic**: it works for any number of members. Each line uses one rule: **proportional to capacity** (default), **custom percentage** (any split summing to 100%, e.g. 42/58 or 20/30/50), or **fixed amount** per member (e.g. one member puts 1,000,000 and another 2,000,000). Fixed amounts must sum to the line's planned amount.
- Capacity itself is a fixed amount per member and does not depend on group size.
- Allocation is **optional**. A line with no allocation (rule `NONE`) is simply group money: it tracks planned, spent and available, but no per-member responsibility.
- **Free is the catch-all line**: any shared expense whose category is not mapped to another line consumes it. A 50,000 outing recorded once in the shared space consumes Free and shows in the payer's personal view through their share (D2). An expense recorded only in a personal space never touches the group.
- The line allocation becomes the **default split** for expenses charged to that line. If Ana pays a 2,000,000 Home expense alone with a 40/60 allocation, Juan owes Ana 1,200,000 automatically.

## 5. Domain model

The core insight: **a personal expense is a shared expense with one participant.** Every expense answers four independent questions:

| Concept | Question | Entity |
|---|---|---|
| Payment | Which pocket did the money leave? | `Payment` (payer member + source account) |
| Share | How much of it is whose? | `Share` (participant + amount) |
| Category / budget line | What is it for, and which envelope does it consume? | `Category` → `BudgetLine` |
| Period | Which month does it count in? | `Period` (derived from date + space period settings) |

### 5.1 Bounded contexts (modules)

| Module | Responsibility | Key entities |
|---|---|---|
| `identity` | Users, authentication, sessions | User |
| `spaces` | Personal and shared spaces, membership, roles, invitations | Space, Membership, Invitation |
| `accounts` | Where money lives | Account |
| `ledger` | Expenses, incomes, transfers, settlements | Transaction, Payment, Share |
| `categories` | Customizable hierarchical categories per space | CategoryGroup, Category |
| `budgeting` | Monthly plans, lines, allocations, rollover | BudgetPlan, MemberCapacity, BudgetLine, Allocation |
| `balances` | Who owes whom inside a shared space | (read model) Balance, SettlementSuggestion |
| `reporting` | Dashboards and unified personal view | (read models) |

### 5.2 Entities

**User** — id, name, email, locale, timezone.

**Space** — id, name, kind (`PERSONAL` | `SHARED`), currency, periodStartDay (1–28, default 1), archivedAt. Every user gets exactly one personal space on sign-up.

**Membership** — spaceId, userId, role (`OWNER` | `ADMIN` | `MEMBER` | `VIEWER`), joinedAt, leftAt.

**Account** — id, spaceId, name, type (`CASH` | `BANK` | `CREDIT_CARD` | `SAVINGS` | `SHARED_FUND`), ownerUserId (null for shared accounts), openingBalance, archivedAt. A personal account belongs to the user's personal space; a `SHARED_FUND` account belongs to a shared space.

**Transaction** — id, spaceId, type, description, date, categoryId (nullable for transfers and settlements), amount (minor units), currency, createdBy, deletedAt.
- **Space ownership rule (D9):** a transaction belongs to the space whose budget and balances it affects. Its source accounts may live in a member's personal space, provided the account owner is a member of the transaction's space and is the paying member. A fund contribution belongs to the shared space (its destination). Other members see the paying member's name, never the details of their personal account.
- `EXPENSE`: one or more `Payment` rows (v1 UI supports one payer) and one or more `Share` rows. Σ payments = Σ shares = amount.
- `INCOME`: destination account + receiving member.
- `TRANSFER`: source account → destination account. A transfer from a personal account to a `SHARED_FUND` account is a **fund contribution**.
- `SETTLEMENT`: member A pays member B to clear balance; optional accounts.

**Payment** — transactionId, accountId, memberUserId (nullable), amount. `memberUserId` is null if and only if the account is a `SHARED_FUND`; otherwise it equals the account owner.

**Share** — transactionId, memberUserId, amount, splitMethod snapshot (`EQUAL` | `PERCENT` | `EXACT` | `SHARES` | `BY_ALLOCATION`).

**CategoryGroup / Category** — two levels, per space, seeded from defaults, renamable and archivable (never hard-deleted while referenced).

**BudgetPlan** — spaceId, label (year-month), startDate, endDate, status (`DRAFT` | `ACTIVE` | `CLOSED`), createdFrom (previous plan or template). Boundaries are stored when the plan is created, so changing `periodStartDay` only affects periods without a plan yet; history never moves (D10).

**MemberCapacity** — planId, memberUserId, amount. Sum = total capacity.

**BudgetLine** — planId, originLineId (the line it was copied from, for rollover), name, plannedAmount, funding (`DIRECT` | `SHARED_FUND` | `SAVINGS`), savingsAccountIds[] (only for `SAVINGS`), rolloverMode (`RESET` | `ROLLOVER` | `ADJUSTED`), isCatchAll, categoryIds[]. A category maps to at most one line per plan. At most one line per plan is the catch-all; unmapped categories consume it. Without a catch-all line, unmapped categories fall into an implicit "Unbudgeted" line. Adding or editing a line that would push Σ plannedAmount above total capacity is rejected; a plan whose capacity was later reduced below Σ plannedAmount cannot be activated.

**Allocation** — lineId, memberUserId, rule (`PROPORTIONAL` | `PERCENT` | `FIXED`), value. One rule per line, or none: a line without allocation rows has rule `NONE`. Assigned amount per member is derived.

### 5.3 Periods, money and rounding

- **Period label:** a period is named after the month that contains most of its days. With `periodStartDay` ≤ 15 that is the start month; otherwise it is the following month (25 Sep – 24 Oct is "October").
- **Money:** stored in ISO 4217 minor units. Each currency also has a *rounding unit* for splits and allocations (COP: 1 peso = 100 minor units), so amounts never show cents.
- **Rounding:** splits and allocations use largest-remainder rounding in rounding units; ties go to members in membership join order. Σ parts always equals the total exactly.
- **Default split:** expenses that resolve (by mapping or catch-all) to an allocated line of an `ACTIVE` plan default to `BY_ALLOCATION`; all other expenses, including those in `NONE` lines, default to `EQUAL` among active members. `DRAFT` plans never drive splits. The member can always override the split.

### 5.4 Derived metrics (computed on read, never stored)

For a line L, member m, period P:

- `assigned(m)` = from Allocation rule.
- `spent(L)` = Σ amount of EXPENSE transactions in P whose category maps to L. For `SAVINGS` lines: Σ transfers in P into the line's savings accounts.
- `available(L)` = plannedAmount + carry-over from rolloverMode − spent(L).
  - RESET: carry-over 0.
  - ROLLOVER: previous available, floored at 0 if negative (Firefly semantics).
  - ADJUSTED: previous available only if negative (overspend reduces next month).
- `contributed(m)`:
  - DIRECT lines: Σ payments by m on expenses in L.
  - SHARED_FUND lines: tracked at fund level, not per line (decision D5).
  - SAVINGS lines: Σ transfers by m into the line's savings accounts.
- `consumed(m)` = Σ shares of m on expenses in L (not applicable to SAVINGS lines).
- `gap(m)` = contributed(m) − assigned(m). Positive means m over-contributed.
- Lines with rule `NONE` report only planned, spent and available; `assigned`, `contributed` and `gap` are not defined for them.

Fund level, per period: `expectedFundContribution(m)` = Σ assigned(m) over SHARED_FUND lines; `actualFundContribution(m)` = Σ fund-contribution transfers by m.

Unified personal view for user u (D11):

- **Period:** u's personal-space period; shared transactions are placed by date into it.
- **Grouping:** by category catalog key. Categories seeded from the default catalog carry a stable `key` shared across spaces; custom categories group under "space / category".
- **Consumption:** personal-space expenses + u's shares in every shared space.
- **Cash out:** Σ payments by u + Σ fund contributions by u + Σ savings transfers by u.

## 6. Key decisions

| ID | Decision | Rationale | Alternatives rejected |
|---|---|---|---|
| D1 | Independent project, reusing concepts (not code) from Firefly III and split-pro | Clean architecture from day one; no upstream merge burden | Fork split-pro (fast start, coupled to its model); fork Firefly (PHP, no splitting model) |
| D2 | Personal space = shared space with one member | One ledger model for both worlds; unified view is a query, not a sync | Separate personal and group models (duplication, reconciliation bugs) |
| D3 | Single-entry ledger with explicit accounts, not strict double-entry | Household needs "which pocket" and "which envelope", not GAAP; much simpler UX | Firefly-style double-entry (expense/revenue accounts per merchant) |
| D4 | Line allocation is the default split for expenses in that line | Balances follow the plan automatically, reusing the standard balance algorithm | Separate "budget debt" ledger |
| D5 | Shared-fund lines track contributions at fund level; fund-paid expenses create no inter-member debt | Matches how a common pot works; avoids double-counting | Treat the fund as a pseudo-participant in balances |
| D6 | Money as integer minor units (`bigint`) + ISO currency; one currency per space in v1 | No float errors; multi-currency deferred | Decimal floats |
| D7 | Metrics computed on read via SQL aggregates; add materialized views only when measured slow | Correctness first; Firefly does the same | Stored running totals |
| D8 | Soft delete for transactions; audit fields on every write | Shared money needs traceability | Hard delete |
| D9 | A transaction belongs to the space it affects; source accounts may be a paying member's personal accounts | Paying a shared expense from my own bank is the common case | Forcing shared accounts for every shared expense |
| D10 | Plan boundaries are stored, not recomputed | Changing the period start day must never move closed history | Derive every period on read |
| D11 | Unified view uses the personal period and a shared category catalog key | Spaces can differ in period and categories; the user needs one consistent picture | Per-space views only |
| D12 | Allocation rules are group-size agnostic (proportional, percent, fixed) and one rule per line | Works for couples, roommates or larger groups without special cases | Rules tied to a fixed number of members |
| D13 | Allocation is optional per line, and a plan may designate one catch-all line | Some group money (e.g. Free) is shared without per-person responsibility and absorbs whatever does not fit elsewhere | Mandatory allocation; implicit Unbudgeted bucket only |

## 7. Architecture

Hexagonal (ports and adapters) with screaming, module-first structure. SOLID throughout. The domain does not import Next.js, the ORM, or any I/O library.

```
src/
  app/                         # Next.js App Router: driving adapters only (pages, server actions, route handlers)
  modules/
    <module>/
      domain/                  # entities, value objects, domain services, domain errors (pure TS)
      application/             # use cases (one class/function per use case), ports (interfaces), DTOs
      infrastructure/          # driven adapters: repositories (Drizzle), mappers, external services
      ui/                      # module-specific React components (presentational + containers)
  shared/
    kernel/                    # Money, Period, Result, Id, DomainEvent, Clock port
    infrastructure/            # db client, transaction manager, logger
  composition/                 # composition root: wires ports to adapters per request
```

Dependency rule: `app → application → domain`; `infrastructure → application/domain`. Enforced by lint rules (dependency-cruiser or eslint-plugin-boundaries) in CI.

Use cases return `Result<T, DomainError>`; server actions map results to UI state. Validation at the edge with Zod; invariants inside entities.

### Stack

| Concern | Choice |
|---|---|
| Framework | Next.js (latest stable, App Router, React Server Components, Server Actions), TypeScript strict |
| Database | PostgreSQL |
| Data access | Drizzle ORM + drizzle-kit migrations (SQL-first control for reporting aggregates) |
| Auth | Better Auth (email + password, optional OAuth), self-hosted |
| Validation | Zod |
| UI | Tailwind CSS + shadcn/ui; container-presentational pattern; atomic design for shared components |
| Charts | Recharts |
| i18n | next-intl (es default, en) |
| Unit / integration tests | Vitest; Testcontainers for PostgreSQL |
| E2E / acceptance | Playwright (+ playwright-bdd to execute critical Gherkin scenarios) |
| Quality | ESLint, Prettier, boundary lint, typecheck in CI, Strict TDD |
| Package manager | pnpm |
| CI | GitHub Actions: lint, typecheck, test, build Docker image |
| Deploy | Docker Compose on VPS: app + PostgreSQL + Caddy (automatic TLS); nightly `pg_dump` backups |

Exact versions are pinned at bootstrap (story E0) to the latest stable releases.

## 8. Error handling

- Domain errors are typed (`InvalidAllocation`, `SharesDoNotMatchAmount`, `NotASpaceMember`, `PeriodClosed`, ...) and returned via `Result`, never thrown across layers.
- Authorization is checked in application use cases (membership + role), not only in UI.
- Unexpected errors are logged with request id and surfaced as a generic message.

## 9. Testing strategy

- **Domain:** exhaustive unit tests, TDD-first (allocation math, split methods, rollover, balance algorithm, period boundaries).
- **Application:** use-case tests with in-memory adapters.
- **Infrastructure:** repository tests against real PostgreSQL via Testcontainers.
- **Acceptance:** each user story's Gherkin scenarios map to tests; the critical ones run end-to-end with Playwright.
- The reference example (section 4) is a golden test fixture.

## 10. Delivery

Work is tracked in `docs/backlog/` (epics and user stories with Gherkin acceptance criteria) and mirrored to a GitHub Project once the repository is published. Milestones:

| Milestone | Outcome |
|---|---|
| M0 Walking skeleton | Repo, architecture skeleton, CI, auth, personal space, deployed to VPS |
| M1 Personal ledger | Accounts, categories, personal expenses and income, monthly view |
| M2 Shared spaces | Invitations, shared expenses with split methods, balances, settlements |
| M3 Allocated budgets | Plans, capacity, lines, allocations, default split by allocation, rollover |
| M4 Insight | Member/category dashboard, shared fund tracking, unified personal view |
| M5 Hardening | Backups, observability, import from Splitwise/CSV, recurring transactions |

## 11. Open questions

1. ~~Where is "Free" money spent?~~ — **Resolved 2026-10-11:** Free is a shared-space catch-all line with optional allocation (section 4, D13). Personal views pick up members' shares automatically; personal-only expenses never affect the group.
2. Should a period start on a payday (e.g. the 25th) instead of the 1st? The model supports `periodStartDay`; confirm the default.
3. ~~Reference example percentages~~ — **Resolved 2026-10-11:** 42/58 is a custom percentage allocation for the Free line (see section 4 and D12).

Roles, invitation rules and the default category seed are specified in the backlog (HU-E1-05, HU-E1-06, HU-E3-01) and are pending owner confirmation.
