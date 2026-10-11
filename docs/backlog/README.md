# Hearth — Product backlog

This folder is the source of truth for Hearth's epics and user stories until it is mirrored to a GitHub Project. It derives from the design spec: [`docs/superpowers/specs/2026-10-11-hearth-design.md`](../superpowers/specs/2026-10-11-hearth-design.md).

## How to read a story

Each epic file (`E<n>-<name>.md`) starts with the epic goal and the modules involved, followed by its stories. Every story has the same shape:

1. **Header** — `## HU-E<epic>-<nn> — <title>`.
2. **Metadata line** — Milestone, Priority, Size, Depends on, Module(s), and an optional **Note** when the story is affected by an open question in spec section 11.
3. **User story** — "As a <role>, I want <capability>, so that <benefit>."
4. **Acceptance criteria** — a `gherkin` block with one Feature and 2–6 scenarios (happy path plus validation, authorization and boundary cases). Each scenario becomes at least one automated test.
5. **Technical notes** — use case names, domain invariants and ports touched.

### Conventions

| Item | Convention |
|---|---|
| Story ID | `HU-<epic>-<nn>`, e.g. `HU-E3-02` (epic E3, story 02). IDs are never reused. |
| Epic ID | `E0` … `E8` (see the status board). |
| Amounts | Written as `1,200,000 COP`; stored as `bigint` minor units (D6). |
| Reference data | Spec section 4: Ana 1,600,000 COP, Juan 2,400,000 COP; lines Rent, Home, Savings, Free. |
| Scenario tags | `@critical` — executed end-to-end with Playwright + playwright-bdd. `@golden` — part of the reference-example golden fixture (spec section 9). |
| Gherkin language | Keywords and steps in English; UI copy is referenced by i18n message keys where relevant. |
| Open questions | A metadata note "Blocked by open question #n" means the story cannot be fully closed until spec section 11 question n is answered; the note states which part is affected. |

### Status values

`Backlog` → `Ready` → `In Progress` → `In Review` → `Done`

### Priority (MoSCoW)

`Must` · `Should` · `Could` · `Won't-v1` (kept in the backlog so the design does not preclude it).

### Size

`S` (about a day) · `M` (two to four days) · `L` (too big; must be split before it can move to `Ready`).

## Definition of Ready

A story can move to `Ready` when:

- [ ] It follows the story template and its size is `S` or `M`.
- [ ] Acceptance criteria are concrete: real amounts, explicit expected outcomes, named error codes.
- [ ] All stories it depends on are `Done`, or the dependency is explicitly stubbed behind a port.
- [ ] No unresolved "Blocked by open question" note affects the scope being started, and no model gap listed in its technical notes remains open.
- [ ] Affected modules, use cases and ports are named.
- [ ] UI text needs are known (i18n keys can be named).

## Definition of Done

A story is `Done` when:

- [ ] Every Gherkin scenario is covered by automated tests that were written first and seen failing (Strict TDD).
- [ ] `@critical` scenarios run end-to-end with Playwright; the rest run as domain, use-case or integration tests.
- [ ] The domain layer has no framework, ORM or I/O imports.
- [ ] Boundary lint passes.
- [ ] Typecheck, lint and all tests are green in CI.
- [ ] A Drizzle migration is included if the schema changed, and `db:check` reports no drift.
- [ ] i18n keys exist in both `es` and `en` for all new UI text.
- [ ] Authorization is enforced in the use case (membership and role), not only in the UI.
- [ ] Documentation is updated (this backlog status, ADRs, operations runbooks or spec as applicable).
- [ ] The change was reviewed and merged to `main`.

## Status board

| ID | Title | Epic | Milestone | Priority | Size | Status | Depends on |
|---|---|---|---|---|---|---|---|
| [HU-E0-01](E0-foundations.md) | Bootstrap the repository with pinned stable versions | E0 | M0 | Must | S | Backlog | — |
| [HU-E0-02](E0-foundations.md) | Hexagonal module skeleton with boundary lint | E0 | M0 | Must | M | Backlog | HU-E0-01 |
| [HU-E0-03](E0-foundations.md) | Money value object | E0 | M0 | Must | S | Backlog | HU-E0-02 |
| [HU-E0-04](E0-foundations.md) | Period, Result, Id and Clock kernel types | E0 | M0 | Must | M | Backlog | HU-E0-02 |
| [HU-E0-05](E0-foundations.md) | PostgreSQL access with Drizzle, migrations and Testcontainers | E0 | M0 | Must | M | Backlog | HU-E0-02 |
| [HU-E0-06](E0-foundations.md) | Continuous integration pipeline | E0 | M0 | Must | S | Backlog | HU-E0-02, HU-E0-05 |
| [HU-E0-07](E0-foundations.md) | Deploy to the VPS with Docker Compose and Caddy | E0 | M0 | Must | M | Backlog | HU-E0-06 |
| [HU-E0-08](E0-foundations.md) | Internationalization setup (es, en) | E0 | M0 | Must | S | Backlog | HU-E0-01 |
| [HU-E1-01](E1-identity-and-spaces.md) | Sign up, sign in and sign out | E1 | M0 | Must | M | Backlog | HU-E0-05, HU-E0-08 |
| [HU-E1-02](E1-identity-and-spaces.md) | Personal space created on sign up | E1 | M0 | Must | S | Backlog | HU-E1-01 |
| [HU-E1-03](E1-identity-and-spaces.md) | Configure space settings | E1 | M1 | Must | S | Backlog | HU-E1-02, HU-E0-04 |
| [HU-E1-04](E1-identity-and-spaces.md) | Create a shared space | E1 | M2 | Must | S | Backlog | HU-E1-02 |
| [HU-E1-05](E1-identity-and-spaces.md) | Enforce roles and permissions | E1 | M2 | Must | M | Backlog | HU-E1-04 |
| [HU-E1-06](E1-identity-and-spaces.md) | Invite a member by link or email | E1 | M2 | Must | M | Backlog | HU-E1-05 |
| [HU-E1-07](E1-identity-and-spaces.md) | Accept an invitation | E1 | M2 | Must | M | Backlog | HU-E1-06 |
| [HU-E1-08](E1-identity-and-spaces.md) | Leave a space | E1 | M2 | Must | S | Backlog | HU-E1-07, HU-E5-01 |
| [HU-E1-09](E1-identity-and-spaces.md) | Archive a space | E1 | M2 | Should | S | Backlog | HU-E1-05, HU-E5-01 |
| [HU-E2-01](E2-accounts.md) | Create a personal account with an opening balance | E2 | M1 | Must | S | Backlog | HU-E1-02 |
| [HU-E2-02](E2-accounts.md) | Create a shared fund account | E2 | M2 | Must | S | Backlog | HU-E1-05, HU-E2-01 |
| [HU-E2-03](E2-accounts.md) | Edit and archive an account | E2 | M1 | Must | S | Backlog | HU-E2-01 |
| [HU-E2-04](E2-accounts.md) | Show the computed account balance | E2 | M1 | Must | M | Backlog | HU-E2-01, HU-E4-01, HU-E4-02, HU-E4-03 |
| [HU-E3-01](E3-categories.md) | Seed default categories per space | E3 | M1 | Must | S | Backlog | HU-E1-02 |
| [HU-E3-02](E3-categories.md) | Manage category groups and categories | E3 | M1 | Must | M | Backlog | HU-E3-01 |
| [HU-E3-03](E3-categories.md) | Archive a referenced category | E3 | M1 | Must | S | Backlog | HU-E3-02, HU-E4-01 |
| [HU-E4-01](E4-ledger.md) | Record a personal expense | E4 | M1 | Must | M | Backlog | HU-E0-04, HU-E2-01, HU-E3-01 |
| [HU-E4-02](E4-ledger.md) | Record income | E4 | M1 | Must | S | Backlog | HU-E2-01, HU-E3-01 |
| [HU-E4-03](E4-ledger.md) | Transfer between own accounts | E4 | M1 | Must | S | Backlog | HU-E2-01 |
| [HU-E4-04](E4-ledger.md) | Assign transactions to periods by periodStartDay | E4 | M1 | Must | S | Backlog | HU-E1-03, HU-E4-01 |
| [HU-E4-05](E4-ledger.md) | List and filter transactions | E4 | M1 | Must | M | Backlog | HU-E4-01, HU-E4-02, HU-E4-03, HU-E4-04 |
| [HU-E4-06](E4-ledger.md) | Edit or delete a transaction with an audit trail | E4 | M1 | Must | M | Backlog | HU-E4-01 |
| [HU-E4-07](E4-ledger.md) | Record a shared expense split equally | E4 | M2 | Must | M | Backlog | HU-E1-07, HU-E4-01 |
| [HU-E4-08](E4-ledger.md) | Split by percentage, exact amounts or shares | E4 | M2 | Must | M | Backlog | HU-E4-07 |
| [HU-E4-09](E4-ledger.md) | Contribute to the shared fund | E4 | M2 | Must | S | Backlog | HU-E2-02, HU-E4-03 |
| [HU-E4-10](E4-ledger.md) | Record an expense paid from the shared fund | E4 | M2 | Must | S | Backlog | HU-E2-02, HU-E4-07, HU-E4-08 |
| [HU-E5-01](E5-balances-and-settlements.md) | Compute who owes whom | E5 | M2 | Must | M | Backlog | HU-E4-07, HU-E4-10 |
| [HU-E5-02](E5-balances-and-settlements.md) | Record a settlement | E5 | M2 | Must | M | Backlog | HU-E5-01 |
| [HU-E5-03](E5-balances-and-settlements.md) | Suggest simplified settlements | E5 | M2 | Should | M | Backlog | HU-E5-01 |
| [HU-E5-04](E5-balances-and-settlements.md) | Show balance history per member | E5 | M2 | Should | S | Backlog | HU-E5-02 |
| [HU-E6-01](E6-budgeting.md) | Create a monthly plan | E6 | M3 | Must | S | Backlog | HU-E1-05, HU-E0-04 |
| [HU-E6-02](E6-budgeting.md) | Set member capacities | E6 | M3 | Must | S | Backlog | HU-E6-01 |
| [HU-E6-03](E6-budgeting.md) | Add budget lines and show unallocated capacity | E6 | M3 | Must | M | Backlog | HU-E6-02 |
| [HU-E6-04](E6-budgeting.md) | Map categories to budget lines | E6 | M3 | Must | S | Backlog | HU-E6-03, HU-E3-02 |
| [HU-E6-05](E6-budgeting.md) | Allocate a budget line among members | E6 | M3 | Must | M | Backlog | HU-E6-03 |
| [HU-E6-06](E6-budgeting.md) | Copy a plan from the previous month | E6 | M3 | Must | M | Backlog | HU-E6-04, HU-E6-05 |
| [HU-E6-07](E6-budgeting.md) | Activate and close a plan | E6 | M3 | Must | M | Backlog | HU-E6-05 |
| [HU-E6-08](E6-budgeting.md) | Default split by allocation | E6 | M3 | Must | M | Backlog | HU-E6-04, HU-E6-05, HU-E6-07, HU-E4-07, HU-E5-01 |
| [HU-E6-09](E6-budgeting.md) | Apply rollover modes | E6 | M3 | Must | M | Backlog | HU-E6-04, HU-E6-07 |
| [HU-E7-01](E7-reporting.md) | Budget line dashboard | E7 | M4 | Must | M | Backlog | HU-E6-09 |
| [HU-E7-02](E7-reporting.md) | Member by line matrix | E7 | M4 | Must | M | Backlog | HU-E6-08, HU-E7-01 |
| [HU-E7-03](E7-reporting.md) | Shared fund contribution tracking | E7 | M4 | Must | S | Backlog | HU-E4-09, HU-E6-05 |
| [HU-E7-04](E7-reporting.md) | Unified personal view | E7 | M4 | Must | M | Backlog | HU-E4-07, HU-E4-10 |
| [HU-E7-05](E7-reporting.md) | Month-over-month trend | E7 | M4 | Should | S | Backlog | HU-E7-01, HU-E7-04 |
| [HU-E8-01](E8-hardening-and-later.md) | Nightly backups and restore drill | E8 | M5 | Must | M | Backlog | HU-E0-07 |
| [HU-E8-02](E8-hardening-and-later.md) | Structured logging and health check | E8 | M5 | Should | M | Backlog | HU-E0-07 |
| [HU-E8-03](E8-hardening-and-later.md) | Recurring transactions | E8 | M5 | Could | M | Backlog | HU-E4-07, HU-E6-07 |
| [HU-E8-04](E8-hardening-and-later.md) | Import transactions from CSV | E8 | M5 | Could | M | Backlog | HU-E4-01, HU-E4-02 |
| [HU-E8-05](E8-hardening-and-later.md) | Import from Splitwise | E8 | M5 | Could | M | Backlog | HU-E4-08, HU-E5-01 |
| [HU-E8-06](E8-hardening-and-later.md) | Multi-currency spaces | E8 | M5 | Won't-v1 | M | Backlog | HU-E0-03 |
| [HU-E8-07](E8-hardening-and-later.md) | Installable PWA with offline read | E8 | M5 | Won't-v1 | M | Backlog | HU-E7-04 |
| [HU-E8-08](E8-hardening-and-later.md) | Notifications | E8 | M5 | Won't-v1 | M | Backlog | HU-E1-07, HU-E5-02 |

**Totals:** 60 stories — E0: 8 · E1: 9 · E2: 4 · E3: 3 · E4: 10 · E5: 4 · E6: 9 · E7: 5 · E8: 8.

## Milestone map

| Milestone | Outcome (spec section 10) | Stories |
|---|---|---|
| **M0** Walking skeleton | Repo, architecture skeleton, CI, auth, personal space, deployed to VPS | HU-E0-01 … HU-E0-08, HU-E1-01, HU-E1-02 |
| **M1** Personal ledger | Accounts, categories, personal expenses and income, monthly view | HU-E1-03, HU-E2-01, HU-E2-03, HU-E2-04, HU-E3-01 … HU-E3-03, HU-E4-01 … HU-E4-06 |
| **M2** Shared spaces | Invitations, shared expenses with split methods, balances, settlements | HU-E1-04 … HU-E1-09, HU-E2-02, HU-E4-07 … HU-E4-10, HU-E5-01 … HU-E5-04 |
| **M3** Allocated budgets | Plans, capacity, lines, allocations, default split by allocation, rollover | HU-E6-01 … HU-E6-09 |
| **M4** Insight | Member/category dashboard, shared fund tracking, unified personal view | HU-E7-01 … HU-E7-05 |
| **M5** Hardening | Backups, observability, import from Splitwise/CSV, recurring transactions | HU-E8-01 … HU-E8-08 (HU-E8-06 … HU-E8-08 are Won't-v1 placeholders) |

Notes on placement:

- HU-E2-02 (shared fund account) belongs to epic E2 but ships in M2, because shared spaces first exist in M2.
- The closed-period scenario of HU-E4-06 (M1) activates once HU-E6-07 (M3) provides the `PeriodPolicy` adapter.

## Open questions affecting the backlog

From spec section 11:

| # | Question | Affected stories |
|---|---|---|
| 1 | ~~Is "Free" money spent from the shared space or from personal spaces?~~ **Resolved 2026-10-11:** Free is a shared-space catch-all line with optional allocation; personal views pick up members' shares automatically. | — |
| 2 | Should a period start on a payday (e.g. the 25th) instead of the 1st? Confirm the default. | HU-E0-04, HU-E1-02, HU-E1-03, HU-E4-04 (default value only) |
| 3 | ~~Is Free's 42/58 split a custom allocation or a typo?~~ **Resolved 2026-10-11:** custom percentage allocation. | — |
