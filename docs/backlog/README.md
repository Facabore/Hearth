# Hearth — Product backlog

This folder is the source of truth for the **content** of Hearth's epics and user stories. **Status** lives in the [Hearth GitHub Project](https://github.com/users/Facabore/projects/4): one issue per story (titled with its story ID), labelled by epic, priority, size and type, assigned to its milestone, with `Blocked by` links. When a story's content changes here, its issue body is updated in the same change. It derives from the design spec: [`docs/superpowers/specs/2026-10-11-hearth-design.md`](../superpowers/specs/2026-10-11-hearth-design.md).

## Delivery: backend first (spec D18)

Next.js is the Backend For Frontend of a modular monolith, and the versioned HTTP API under `/api/v1` is the primary contract. Delivery follows that order:

- **Epics E0–E8 are backend epics.** A story is done at API level: use case + HTTP endpoint under `/api/v1` with a Zod contract that appears in the generated OpenAPI document + tests. Scenarios assert API-observable outcomes: status codes, response fields, `warnings[]`, and stable error codes.
- **Epic E9 is the web UI** (milestone M6). It is a parallel track: an area's UI story may start as soon as the API stories it depends on are `Done`.
- **The API returns stable error codes** as RFC 9457 `application/problem+json` (`code` = domain error name, plus `requestId`), never translated text. Internationalization is a UI concern (HU-E9-02).

## How to read a story

Each epic file (`E<n>-<name>.md`) starts with the epic goal and the modules involved, followed by its stories. Every story has the same shape:

1. **Header** — `## HU-E<epic>-<nn> — <title>`.
2. **Metadata line** — Milestone, Priority, Size, Depends on, Module(s), and an optional **Note** when the story is affected by an open question in spec section 11.
3. **User story** — "As a <role>, I want <capability>, so that <benefit>."
4. **Acceptance criteria** — a `gherkin` block with one Feature and 2–6 scenarios (happy path plus validation, authorization and boundary cases). Each scenario becomes at least one automated test.
5. **Technical notes** — use case names, endpoints, domain invariants and ports touched.

A retired story keeps its header with "(moved)" and a short stub pointing to where its scope went (see HU-E0-08 and HU-E8-03).

### Conventions

| Item | Convention |
|---|---|
| Story ID | `HU-<epic>-<nn>`, e.g. `HU-E3-02` (epic E3, story 02). IDs are never reused. |
| Epic ID | `E0` … `E9` (see the status board). E0–E8 are backend epics; E9 is the web UI. |
| Endpoints | Resource-oriented REST under `/api/v1` (spec section 7), e.g. `POST /api/v1/spaces/{spaceId}/expenses`. |
| Amounts | Written as `1,200,000 COP`; stored as `bigint` minor units (D6); serialized in the API as `{ "amount": "120000000", "currency": "COP" }`. |
| Reference data | Spec section 4: Ana 1,600,000 COP, Juan 2,400,000 COP; lines Rent, Home, Savings, Free. |
| Scenario tags | `@critical` — API acceptance: executed over HTTP against the running app with PostgreSQL in Testcontainers (spec section 9). `@golden` — part of the reference-example golden fixture. `@e2e` — E9 only: critical UI flows executed with Playwright + playwright-bdd. |
| Gherkin language | Keywords and steps in English. Backend scenarios name error codes (`InsufficientRole`), never message text; E9 scenarios reference UI copy by i18n message keys where relevant. |
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
- [ ] Affected modules, use cases, ports and endpoints are named.
- [ ] For E9 stories: the API stories it consumes are `Done` and UI text needs are known (i18n keys can be named).

## Definition of Done

### Backend stories (E0–E8)

A backend story is `Done` when:

- [ ] Every Gherkin scenario is covered by automated tests that were written first and seen failing (Strict TDD).
- [ ] `@critical` scenarios run over HTTP against the running app with PostgreSQL in Testcontainers; the rest run as domain, use-case or integration tests.
- [ ] The use case is exposed through its `/api/v1` endpoint with a Zod contract in the module's `contracts/`; the operation appears in the generated OpenAPI document and the contract snapshot is updated deliberately.
- [ ] Errors are returned as `application/problem+json` with a stable `code` and `requestId`; no translated text in API responses.
- [ ] Authorization is enforced in the use case (membership and role), never only in the handler.
- [ ] The domain layer has no framework, ORM or I/O imports.
- [ ] Boundary lint, typecheck, lint and all tests are green in CI.
- [ ] A Drizzle migration is included if the schema changed, and `db:check` reports no drift.
- [ ] POST endpoints that create money records honour the `Idempotency-Key` header (HU-E0-10).
- [ ] Documentation is updated (this backlog status, ADRs, operations runbooks or spec as applicable), and the change was reviewed and merged to `main`.

### UI stories (E9)

A UI story is `Done` when:

- [ ] `@e2e` scenarios run with Playwright + playwright-bdd against the running app; the rest run as component or container tests written first (Strict TDD).
- [ ] i18n keys exist in both `es` and `en` for all new UI text, and every displayed API error, warning or reason code has a key.
- [ ] Screens follow the container-presentational pattern: presentational components receive props and DTOs only.
- [ ] Accessibility basics hold: labelled form controls, full keyboard navigation, visible focus, and contrast meeting WCAG AA.
- [ ] The UI consumes only use cases through server actions or the `/api/v1` API; no direct database access.
- [ ] Typecheck, lint, boundary lint and all tests are green in CI; the change was reviewed and merged to `main`.

## Status board

| ID | Title | Epic | Milestone | Priority | Size | Status | Depends on |
|---|---|---|---|---|---|---|---|
| [HU-E0-01](E0-foundations.md) | Bootstrap the repository with pinned stable versions | E0 | M0 | Must | S | Backlog | — |
| [HU-E0-02](E0-foundations.md) | Hexagonal module skeleton with boundary lint | E0 | M0 | Must | M | Backlog | HU-E0-01 |
| [HU-E0-03](E0-foundations.md) | Money value object | E0 | M0 | Must | S | Backlog | HU-E0-02 |
| [HU-E0-04](E0-foundations.md) | PeriodPolicy, Result, Id and Clock kernel types | E0 | M0 | Must | M | Backlog | HU-E0-02 |
| [HU-E0-05](E0-foundations.md) | PostgreSQL access with Drizzle, migrations and Testcontainers | E0 | M0 | Must | M | Backlog | HU-E0-02 |
| [HU-E0-06](E0-foundations.md) | Continuous integration pipeline | E0 | M0 | Must | S | Backlog | HU-E0-02, HU-E0-05, HU-E0-09 |
| [HU-E0-07](E0-foundations.md) | Deploy to the VPS with Docker Compose and Caddy | E0 | M0 | Must | M | Backlog | HU-E0-06, HU-E0-09 |
| [HU-E0-09](E0-foundations.md) | API foundation: contracts, OpenAPI, problem+json and auth guard | E0 | M0 | Must | M | Backlog | HU-E0-02, HU-E0-03, HU-E0-04 |
| [HU-E0-10](E0-foundations.md) | Idempotency, pagination and optimistic concurrency | E0 | M0 | Must | M | Backlog | HU-E0-05, HU-E0-09 |
| [HU-E1-01](E1-identity-and-spaces.md) | Sign up, sign in and sign out | E1 | M0 | Must | M | Backlog | HU-E0-05, HU-E0-09 |
| [HU-E1-02](E1-identity-and-spaces.md) | Personal space created on sign up | E1 | M0 | Must | S | Backlog | HU-E1-01 |
| [HU-E1-03](E1-identity-and-spaces.md) | Configure space settings and period policy | E1 | M1 | Must | S | Backlog | HU-E1-02, HU-E0-04 |
| [HU-E1-04](E1-identity-and-spaces.md) | Create a shared space | E1 | M2 | Must | S | Backlog | HU-E1-02 |
| [HU-E1-05](E1-identity-and-spaces.md) | Enforce roles and permissions | E1 | M2 | Must | M | Backlog | HU-E1-04 |
| [HU-E1-06](E1-identity-and-spaces.md) | Invite a member by link or email | E1 | M2 | Must | M | Backlog | HU-E1-05 |
| [HU-E1-07](E1-identity-and-spaces.md) | Accept an invitation | E1 | M2 | Must | M | Backlog | HU-E1-06 |
| [HU-E1-08](E1-identity-and-spaces.md) | Leave a space | E1 | M2 | Must | S | Backlog | HU-E1-07, HU-E5-01 |
| [HU-E1-09](E1-identity-and-spaces.md) | Archive a space | E1 | M2 | Should | S | Backlog | HU-E1-05, HU-E5-01 |
| [HU-E1-10](E1-identity-and-spaces.md) | Add a guest member to a space | E1 | M2 | Must | S | Backlog | HU-E1-05 |
| [HU-E1-11](E1-identity-and-spaces.md) | Claim a guest place by registering | E1 | M2 | Must | M | Backlog | HU-E1-07, HU-E1-10, HU-E5-01 |
| [HU-E1-12](E1-identity-and-spaces.md) | Remove a guest | E1 | M2 | Must | S | Backlog | HU-E1-10, HU-E5-01 |
| [HU-E1-13](E1-identity-and-spaces.md) | Split with one person through a direct space | E1 | M2 | Must | M | Backlog | HU-E1-10, HU-E3-01, HU-E4-07 |
| [HU-E2-01](E2-accounts.md) | Create a personal account with an opening balance | E2 | M1 | Must | S | Backlog | HU-E1-02 |
| [HU-E2-02](E2-accounts.md) | Create a shared fund account | E2 | M2 | Must | S | Backlog | HU-E1-05, HU-E2-01 |
| [HU-E2-03](E2-accounts.md) | Edit and archive an account | E2 | M1 | Must | S | Backlog | HU-E2-01 |
| [HU-E2-04](E2-accounts.md) | Show the computed account balance | E2 | M1 | Must | M | Backlog | HU-E2-01, HU-E4-01, HU-E4-02, HU-E4-03 |
| [HU-E3-01](E3-categories.md) | Seed default categories per space | E3 | M1 | Must | S | Backlog | HU-E1-02 |
| [HU-E3-02](E3-categories.md) | Manage category groups and categories | E3 | M1 | Must | M | Backlog | HU-E3-01 |
| [HU-E3-03](E3-categories.md) | Archive a referenced category | E3 | M1 | Must | S | Backlog | HU-E3-02, HU-E4-01 |
| [HU-E4-01](E4-ledger.md) | Record a personal expense | E4 | M1 | Must | M | Backlog | HU-E0-04, HU-E0-10, HU-E2-01, HU-E3-01 |
| [HU-E4-02](E4-ledger.md) | Record income | E4 | M1 | Must | S | Backlog | HU-E2-01, HU-E3-01 |
| [HU-E4-03](E4-ledger.md) | Transfer between own accounts | E4 | M1 | Must | S | Backlog | HU-E2-01 |
| [HU-E4-04](E4-ledger.md) | Assign transactions to periods by period policy | E4 | M1 | Must | S | Backlog | HU-E1-03, HU-E4-01 |
| [HU-E4-05](E4-ledger.md) | List and filter transactions | E4 | M1 | Must | M | Backlog | HU-E0-10, HU-E4-01, HU-E4-02, HU-E4-03, HU-E4-04 |
| [HU-E4-06](E4-ledger.md) | Edit or delete a transaction with an audit trail | E4 | M1 | Must | M | Backlog | HU-E0-10, HU-E4-01 |
| [HU-E4-07](E4-ledger.md) | Record a shared expense split equally | E4 | M2 | Must | M | Backlog | HU-E1-07, HU-E1-10, HU-E4-01 |
| [HU-E4-08](E4-ledger.md) | Split by percentage, exact amounts or shares | E4 | M2 | Must | M | Backlog | HU-E4-07 |
| [HU-E4-09](E4-ledger.md) | Contribute to the shared fund | E4 | M2 | Must | S | Backlog | HU-E2-02, HU-E4-03 |
| [HU-E4-10](E4-ledger.md) | Record an expense paid from the shared fund | E4 | M2 | Must | S | Backlog | HU-E2-02, HU-E4-07, HU-E4-08 |
| [HU-E5-01](E5-balances-and-settlements.md) | Compute who owes whom | E5 | M2 | Must | M | Backlog | HU-E4-07, HU-E4-10 |
| [HU-E5-02](E5-balances-and-settlements.md) | Record a settlement | E5 | M2 | Must | M | Backlog | HU-E5-01, HU-E1-10 |
| [HU-E5-03](E5-balances-and-settlements.md) | Suggest simplified settlements | E5 | M2 | Should | M | Backlog | HU-E5-01 |
| [HU-E5-04](E5-balances-and-settlements.md) | Show balance history per member | E5 | M2 | Should | S | Backlog | HU-E5-02 |
| [HU-E6-01](E6-budgeting.md) | Create a plan for a period | E6 | M3 | Must | S | Backlog | HU-E1-05, HU-E0-04 |
| [HU-E6-02](E6-budgeting.md) | Set member capacities | E6 | M3 | Must | S | Backlog | HU-E6-01 |
| [HU-E6-03](E6-budgeting.md) | Add budget lines and show unallocated capacity | E6 | M3 | Must | M | Backlog | HU-E6-02 |
| [HU-E6-04](E6-budgeting.md) | Map categories to budget lines | E6 | M3 | Must | S | Backlog | HU-E6-03, HU-E3-02 |
| [HU-E6-05](E6-budgeting.md) | Allocate a budget line among members | E6 | M3 | Must | M | Backlog | HU-E6-03 |
| [HU-E6-06](E6-budgeting.md) | Copy a plan from the previous period | E6 | M3 | Must | M | Backlog | HU-E6-04, HU-E6-05 |
| [HU-E6-07](E6-budgeting.md) | Activate and close a plan | E6 | M3 | Must | M | Backlog | HU-E6-05 |
| [HU-E6-08](E6-budgeting.md) | Default split by allocation | E6 | M3 | Must | M | Backlog | HU-E6-04, HU-E6-05, HU-E6-07, HU-E4-07, HU-E5-01 |
| [HU-E6-09](E6-budgeting.md) | Apply rollover modes | E6 | M3 | Must | M | Backlog | HU-E6-04, HU-E6-07 |
| [HU-E4-11](E4-ledger.md) | Define and manage recurring transactions | E4 | M3 | Must | M | Backlog | HU-E4-07, HU-E0-04, HU-E1-10 |
| [HU-E4-12](E4-ledger.md) | Record due occurrences automatically | E4 | M3 | Must | M | Backlog | HU-E4-11, HU-E6-07, HU-E6-08 |
| [HU-E4-13](E4-ledger.md) | Confirm variable-amount occurrences | E4 | M3 | Must | S | Backlog | HU-E4-12 |
| [HU-E7-01](E7-reporting.md) | Budget line dashboard | E7 | M4 | Must | M | Backlog | HU-E6-09 |
| [HU-E7-02](E7-reporting.md) | Member by line matrix | E7 | M4 | Must | M | Backlog | HU-E6-08, HU-E7-01 |
| [HU-E7-03](E7-reporting.md) | Shared fund contribution tracking | E7 | M4 | Must | S | Backlog | HU-E4-09, HU-E6-05 |
| [HU-E7-04](E7-reporting.md) | Unified personal view | E7 | M4 | Must | M | Backlog | HU-E4-07, HU-E4-10 |
| [HU-E7-05](E7-reporting.md) | Period-over-period trend | E7 | M4 | Should | S | Backlog | HU-E7-01, HU-E7-04 |
| [HU-E8-01](E8-hardening-and-later.md) | Nightly backups and restore drill | E8 | M5 | Must | M | Backlog | HU-E0-07 |
| [HU-E8-02](E8-hardening-and-later.md) | Structured logging and health check | E8 | M5 | Should | M | Backlog | HU-E0-07 |
| [HU-E8-04](E8-hardening-and-later.md) | Import transactions from CSV | E8 | M5 | Could | M | Backlog | HU-E4-01, HU-E4-02 |
| [HU-E8-05](E8-hardening-and-later.md) | Import from Splitwise | E8 | M5 | Could | M | Backlog | HU-E4-08, HU-E5-01, HU-E1-10 |
| [HU-E8-06](E8-hardening-and-later.md) | Multi-currency spaces | E8 | M5 | Won't-v1 | M | Backlog | HU-E0-03 |
| [HU-E8-07](E8-hardening-and-later.md) | Installable PWA with offline read | E8 | M5 | Won't-v1 | M | Backlog | HU-E7-04, HU-E9-01, HU-E9-11 |
| [HU-E8-08](E8-hardening-and-later.md) | Notifications | E8 | M5 | Won't-v1 | M | Backlog | HU-E1-07, HU-E5-02 |
| [HU-E8-09](E8-hardening-and-later.md) | Weekly and biweekly period policies | E8 | M5 | Won't-v1 | S | Backlog | HU-E0-04, HU-E1-03 |
| [HU-E9-01](E9-web-ui.md) | App shell, sign-in and sign-up screens | E9 | M6 | Must | M | Backlog | HU-E1-01, HU-E1-02, HU-E9-02 |
| [HU-E9-02](E9-web-ui.md) | Internationalization setup (es, en) | E9 | M6 | Must | S | Backlog | HU-E0-01, HU-E1-01 |
| [HU-E9-03](E9-web-ui.md) | Personal ledger screens | E9 | M6 | Must | M | Backlog | HU-E2-01, HU-E2-03, HU-E2-04, HU-E4-01, HU-E4-02, HU-E4-03, HU-E4-05, HU-E9-01 |
| [HU-E9-04](E9-web-ui.md) | Categories management screen | E9 | M6 | Should | S | Backlog | HU-E3-01, HU-E3-02, HU-E3-03, HU-E9-01 |
| [HU-E9-05](E9-web-ui.md) | Shared spaces, members, guests and invitations screens | E9 | M6 | Must | M | Backlog | HU-E1-04, HU-E1-05, HU-E1-06, HU-E1-07, HU-E1-10, HU-E1-11, HU-E1-12, HU-E9-01 |
| [HU-E9-06](E9-web-ui.md) | Record a shared expense with split options | E9 | M6 | Must | M | Backlog | HU-E1-13, HU-E4-07, HU-E4-08, HU-E4-10, HU-E9-03, HU-E9-05 |
| [HU-E9-07](E9-web-ui.md) | Balances and settle-up screen | E9 | M6 | Must | M | Backlog | HU-E5-01, HU-E5-02, HU-E5-03, HU-E5-04, HU-E9-05 |
| [HU-E9-08](E9-web-ui.md) | Budget planner screens | E9 | M6 | Must | M | Backlog | HU-E6-01, HU-E6-02, HU-E6-03, HU-E6-04, HU-E6-05, HU-E6-06, HU-E6-07, HU-E6-09, HU-E9-05 |
| [HU-E9-09](E9-web-ui.md) | Recurring transactions and pending confirmations screens | E9 | M6 | Should | M | Backlog | HU-E4-11, HU-E4-12, HU-E4-13, HU-E9-06 |
| [HU-E9-10](E9-web-ui.md) | Space dashboards: lines, member matrix and fund tracking | E9 | M6 | Must | M | Backlog | HU-E7-01, HU-E7-02, HU-E7-03, HU-E9-08 |
| [HU-E9-11](E9-web-ui.md) | Personal dashboards: unified view and trends | E9 | M6 | Must | M | Backlog | HU-E7-04, HU-E7-05, HU-E9-01 |

**Totals:** 79 active stories — E0: 9 · E1: 13 · E2: 4 · E3: 3 · E4: 13 · E5: 4 · E6: 9 · E7: 5 · E8: 8 · E9: 11. Retired IDs: HU-E0-08 (moved to HU-E9-02) and HU-E8-03 (moved to HU-E4-11 … HU-E4-13).

## Milestone map

| Milestone | Outcome (spec section 10) | Stories |
|---|---|---|
| **M0** Walking skeleton | Repo, architecture skeleton, API foundation (contracts, OpenAPI, problem+json, auth), CI, personal space, deployed to VPS | HU-E0-01 … HU-E0-07, HU-E0-09, HU-E0-10, HU-E1-01, HU-E1-02 |
| **M1** Personal ledger API | Accounts, categories, personal expenses and income, period queries | HU-E1-03, HU-E2-01, HU-E2-03, HU-E2-04, HU-E3-01 … HU-E3-03, HU-E4-01 … HU-E4-06 |
| **M2** Shared spaces API | Invitations, guests, direct spaces, shared expenses with split methods, balances, settlements | HU-E1-04 … HU-E1-13, HU-E2-02, HU-E4-07 … HU-E4-10, HU-E5-01 … HU-E5-04 |
| **M3** Allocated budgets API | Plans, capacity, lines, allocations, default split by allocation, rollover, recurring transactions | HU-E6-01 … HU-E6-09, HU-E4-11 … HU-E4-13 |
| **M4** Insight API | Member/category dashboards, shared fund tracking, unified personal view | HU-E7-01 … HU-E7-05 |
| **M5** Hardening | Backups, observability, import from Splitwise/CSV | HU-E8-01, HU-E8-02, HU-E8-04 … HU-E8-09 (HU-E8-06 … HU-E8-09 are Won't-v1 placeholders) |
| **M6** Web UI | Screens for every area (epic E9); an area's UI may start as soon as its API milestone is done | HU-E9-01 … HU-E9-11 |

Notes on placement:

- HU-E0-10 (idempotency, pagination, concurrency) ships in M0 rather than M1: the first money endpoints of M1 need all three on day one (HU-E4-01, HU-E4-05, HU-E4-06), and spec section 7 places them in `shared/http`, so they are built once and verified against a test-only route.
- HU-E0-09's cookie/Bearer scenario runs against a test `SessionResolver` until HU-E1-01 supplies the Better Auth adapter, both within M0.
- HU-E2-02 (shared fund account) belongs to epic E2 but ships in M2, because shared spaces first exist in M2.
- HU-E1-13 (direct spaces) lives in E1 because creating and reusing the space belongs to `spaces`; it reuses the shared-expense flow of HU-E4-07.
- The unified-view assertions of HU-E1-11 (M2) become testable once HU-E7-04 (M4) lands.
- The closed-period scenario of HU-E4-06 (M1) activates once HU-E6-07 (M3) provides the `ClosedPeriodGuard` adapter.
- E9 parallel track: HU-E9-01 and HU-E9-02 can start after M0; HU-E9-03 and HU-E9-04 after M1; HU-E9-05 … HU-E9-07 after M2; HU-E9-08 and HU-E9-09 after M3; HU-E9-10 and HU-E9-11 after M4. The default-split scenarios of HU-E9-06 activate once HU-E6-08 (M3) is `Done`.
- HU-E8-07 (PWA) is a web UI story kept in E8 as a Won't-v1 placeholder; it depends on HU-E9-01 and HU-E9-11 and follows the UI Definition of Done.

## Open questions affecting the backlog

From spec section 11:

| # | Question | Affected stories |
|---|---|---|
| 1 | ~~Is "Free" money spent from the shared space or from personal spaces?~~ **Resolved 2026-10-11:** Free is a shared-space catch-all line with optional allocation; personal views pick up members' shares automatically. | — |
| 2 | ~~Should a period start on a payday (e.g. the 25th) instead of the 1st? Confirm the default.~~ **Resolved 2026-10-11:** selectable per space via `PeriodPolicy` (`MONTHLY(day)` with a cut-off day 1–31, or `SEMI_MONTHLY(day1, day2)`); default `MONTHLY(1)` (spec D14). | — |
| 3 | ~~Is Free's 42/58 split a custom allocation or a typo?~~ **Resolved 2026-10-11:** custom percentage allocation. | — |
