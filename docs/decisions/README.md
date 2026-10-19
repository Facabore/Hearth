# Decisions index

Every decision Hearth has made, in one place. There are three kinds, and each lives where it was decided:

- **Design decisions (D1–D23)** are in the [design spec](../superpowers/specs/2026-10-11-hearth-design.md#6-key-decisions), section 6.
- **ADRs** record a technology choice: [`docs/adr/`](#adrs).
- **Rulings (P1–P106)** are execution rulings the controller made while a milestone plan was written or run. Each lives in its plan's Self-Review; this page indexes them.

## Design decisions D1–D23

Rationale and rejected alternatives are in [section 6 of the spec](../superpowers/specs/2026-10-11-hearth-design.md#6-key-decisions).

| ID | Decision |
|---|---|
| D1 | Hearth is an independent project that reuses concepts, not code, from Firefly III and split-pro. |
| D2 | A personal space is a shared space with one member, so one ledger model serves both. |
| D3 | The ledger is single-entry with explicit accounts, not strict double-entry. |
| D4 | A budget line's allocation is the default split for the expenses in that line. |
| D5 | Shared-fund lines track contributions at fund level, and fund-paid expenses create no inter-member debt. |
| D6 | Money is `bigint` minor units plus an ISO currency, one currency per space in v1. |
| D7 | Metrics are computed on read with SQL aggregates; materialized views only when measured slow. |
| D8 | Every delete is logical (physical only for expired idempotency keys and the sign-up compensation), and the audit keeps the full history of edited parts. |
| D9 | A transaction belongs to the space it affects, and its source accounts may be a paying member's personal accounts. |
| D10 | Plan boundaries are stored, not recomputed, so changing the period policy never moves closed history. |
| D11 | The unified view uses the personal period and a shared category catalog key. |
| D12 | Allocation rules (proportional, percent, fixed) are group-size agnostic, with one rule per line. |
| D13 | Allocation is optional per line, and a plan may designate one catch-all line. |
| D14 | The period policy is chosen per space: monthly with any cut-off day (1–31, clamped) or semi-monthly with two anchor days. |
| D15 | Guest members are scoped to one space, all money references point to `SpaceMember`, and guests can claim their place by registering. |
| D16 | Splitting with one person creates or reuses a two-member `DIRECT` space. |
| D17 | A member's capacity is suggested privately from their own previous-period income and is always editable. |
| D18 | Next.js is the BFF of a modular monolith; the versioned HTTP API is the primary contract and the backend is built first. |
| D19 | A transaction keeps its local date plus a UTC instant and the recorder's IANA zone; every transaction a person records has a time. |
| D20 | There is one optional subcategory level, and budgets, splits, filters and reports roll subcategories up into their category. |
| D21 | Each account has two switches, available and net worth, with defaults by type, and a card payment is a transfer, never spending. |
| D22 | Category groups and categories carry an icon (a fixed symbol or one emoji) and a color from sixteen palette keys, and subcategories derive their parent's. |
| D23 | Number, time and date formats and the first weekday are four profile preferences, null meaning "follow the installation rule", never derived from the language. |

## ADRs

| ADR | Decision | Status |
|---|---|---|
| [0001](../adr/0001-boundary-enforcement-with-dependency-cruiser.md) | Enforce architecture boundaries with dependency-cruiser. | Accepted (2026-10-11) |
| [0002](../adr/0002-openapi-generator-zod-openapi.md) | Generate OpenAPI 3.1 with zod-openapi. | Accepted (2026-10-12) |

## Rulings P1–P106

Rulings are numbered across milestones, not per plan, and not always in the order of the plans: M4's plan holds rulings that were made while M3-D was being planned. The tables are grouped by the plan that records them. In each, "Where" is the plan's Self-Review section and the item number in it. "Amended" marks a ruling the plan itself says was amended.

The ranges are: M3-A P1–P9, M3-B P10–P19, M3-C P20–P31, M3-D P40–P73, P78, P79 and P84–P94, and M4 P32–P39, P74–P77, P80–P83 and P95–P106. M3-D's P89–P94 were kept outside the repository until the merge and are recorded in the section "Execution rulings (recorded after the merge)" at the end of its plan.

### M3-A: budget plans (P1–P9)

Plan: [`2026-10-14-m3a-budget-plans.md`](../superpowers/plans/2026-10-14-m3a-budget-plans.md). P8 is amended.

| ID | Ruling | Where |
|---|---|---|
| P1 | The allocation rule lives on the line (`allocation_rule`); member rows exist only for PERCENT and FIXED. Spec 5.2 was amended. | Spec contradictions found, 1 |
| P2 | A new action `capacity.setOwn` lets a member set their own capacity, beside `plan.manage`. | Spec contradictions found, 2 |
| P3 | Every write to a plan or its parts bumps its version under a row lock and honours an optional `If-Match`. | Spec contradictions found, 3 |
| P4 | Lines expose `spent` and `available`, and the plan exposes `unbudgeted`, from M3-A on. | Spec contradictions found, 4 |
| P5 | `PUT …/capacities` sets the listed members and keeps the others. | Assumptions, 1 |
| P6 | Any id that is not a live category of the plan's space answers `CategoryNotInSpace`, so existence is not leaked. | Spec contradictions found, 5 |
| P7 | Figures follow the current members; a former member keeps their rows but drops out of the figures. | Assumptions, 2 |
| P8 | SAVINGS lines: three new codes, and (amended after the final review) a line newly names only the caller's own SAVINGS accounts, and spending counts only accounts of current registered members. | Assumptions, 3 (amended) |
| P9 | Every plan write answers the whole plan with its new ETag. | Assumptions, 4 |

### M3-B: plan lifecycle (P10–P19)

Plan: [`2026-10-15-m3b-plan-lifecycle.md`](../superpowers/plans/2026-10-15-m3b-plan-lifecycle.md). P17 is amended.

| ID | Ruling | Where |
|---|---|---|
| P10 | A copy keeps a source line's savings account only while it is still valid, and lists the others in `dropped`. | Spec contradictions found, 5 |
| P11 | A copy answers the plan plus an optional `dropped` member, and every line carries `originLineId`. | Spec contradictions found, 2 |
| P12 | `InvalidPlanTransition` is an explicit 409. | Spec contradictions found, 6 |
| P13 | Activation checks `PlanExceedsCapacity` before `InvalidAllocation`; an ACTIVE plan is not re-checked on later writes. | Assumptions, 1 |
| P14 | The closed-period guard and the copy read the covering plan `FOR SHARE`, so they serialize with its writes. | Assumptions, 2 |
| P15 | Carry-over is derived on read along the chain of origin lines, whatever the plan statuses. | Spec contradictions found, 4 |
| P16 | `BY_ALLOCATION` is only ever a default, reached by sending no `split`; `GET …/default-split` previews it. | Spec contradictions found, 3 |
| P17 | Several plans may be ACTIVE at once; amended after the final review: a plan closes only after its period has ended (`PeriodNotOver`). | Assumptions, 3 (amended) |
| P18 | No migration for the lifecycle: no status check and no audit columns. | Assumptions, 4 |
| P19 | Closing freezes the plan and the space's own transactions, not every input of its figures. | Spec contradictions found, 1 |

### M3-C: recurring transactions and balance history (P20–P31)

Plan: [`2026-10-16-m3c-recurring-and-history.md`](../superpowers/plans/2026-10-16-m3c-recurring-and-history.md). Spec 5.2 (Recurrence) was amended with P21–P24.

| ID | Ruling | Where |
|---|---|---|
| P20 | `MaterializeDueOccurrences` runs inside the app container, started by `src/instrumentation.ts` through the `Scheduler` port. | Spec contradictions found, 1 |
| P21 | An AUTO occurrence is recorded on behalf of the member who defined the recurrence, and a confirmation on behalf of the member who confirms. | Spec contradictions found, 4 |
| P22 | A recurrence's type, payer and accounts never change; other fields can be edited. | Assumptions, 4 |
| P23 | A recurrence without a split takes the default split of each occurrence; an explicit split is `EQUAL`, `PERCENT` or `SHARES`. | Spec contradictions found, 2 |
| P24 | A recurrence is due from its start date or its definition day, whichever is later; missed runs are caught up, and a pause is never back-filled. | Spec contradictions found, 3 |
| P25 | A date inside a CLOSED plan's period is stored `SKIPPED` with `PeriodClosed`, and the recurrence goes on. | Assumptions, 1 |
| P26 | Every run pauses a recurrence whose payer or creator is no longer a current member (`PayerLeft`, `CreatorLeft`). | Spec contradictions found, 5 |
| P27 | No `ETag` on recurrences; the new transition and not-found codes are explicit. | Spec contradictions found, 8 |
| P28 | The recurrence lists and the balance history are not paginated. | Spec contradictions found, 6 |
| P29 | Any member reads the balance history of any current member. | Assumptions, 3 |
| P30 | Defining, confirming and skipping need `money.record`; editing, pausing, resuming and ending follow `canModify`. | Assumptions, 2 |
| P31 | The link between a recurrence and a transaction lives in `recurrence_occurrences.transaction_id`. | Spec contradictions found, 7 |

### M3-D: ledger refinements for the UI (P40–P73, P78, P79, P84–P94)

Plan: [`2026-10-17-m3d-ledger-refinements.md`](../superpowers/plans/2026-10-17-m3d-ledger-refinements.md). P42, P44, P56, P60 and P67 are amended; M4 also amended P74. P62–P68 are recorded together in one point (23); the full text of P67 and P68 is in the plan's [Execution rulings](../superpowers/plans/2026-10-17-m3d-ledger-refinements.md#execution-rulings-recorded-after-the-merge) section.

Section "Spec contradictions found and controller proposals", item in the Where column:

| ID | Ruling | Where |
|---|---|---|
| P40 | `date` stays the local date; `occurred_at` and `time_zone` are nullable and set together; old rows are never back-filled. | 1 |
| P41 | A transaction's time zone is the recorder's, never the payer's or the space's. | 2 |
| P42 | No boundary reads `occurredAt`; occurrences and imports carry no time; a date-only edit keeps the wall-clock time. | 3 (amended by P66) |
| P43 | List order is `date`, time with untimed rows last, `created_at`, `id`, as one keyset over `transactions_space_order_idx`. | 4 |
| P44 | Answers use `toISOString()`; a sent `timeZone` is always validated. | 5 (amended: see P66, P69) |
| P45 | A kernel `UserTimeZones` port, implemented by identity, gives each user's zone; sign-up writes the browser's zone. | 6 |
| P46 | Three levels at most; `CategoryDepthExceeded` and the `groupId` / `parentCategoryId` rules for subcategories. | 7 |
| P47 | A subcategory carries its parent's group, moves and archives with it, and is restored only under a live parent. | 8 |
| P48 | Budgets roll a subcategory into its parent; only categories are mapped (`SubcategoryNotMappable`). | 9 |
| P49 | WALLET, INVESTMENT, LOAN and OTHER are personal account types; `accounts.type` stays a `text` column. | 10 |
| P50 | The common account attributes are nullable; a null icon means the type's default. | 11 |
| P51 | The availability switches are nullable (null is the type's default), and totals are computed by `ListAccounts`. | 12 |
| P52 | Type-specific terms are typed nullable columns with checks; rates are parts per million. | 13 |
| P53 | Liabilities' sign convention is accepted but not enforced. | 14 |
| P54 | A shared fund takes the common attributes and both switches, and no terms. | 15 |
| P55 | The next billing dates use the requesting user's local date, clamped to the month's last day. | 16 |
| P56 | Migration `0017_category_styles` with a hand-written back-fill; group columns are `NOT NULL` with the custom default. | 17 (amended by P74, P77) |
| P57 | A subcategory has no stored style; `shownStyle` derives its parent's on every read. | 18 |
| P58 | The domain decides when an icon or color is refused, on the result of the change. | 19 |
| P59 | "One emoji" means one grapheme by `Intl.Segmenter`, at most 32 UTF-16 code units. | 20 |
| P60 | The 58 symbol names and the palettes; `tag` in `GRAPHITE` for groups created without a style. | 21 (amended after the owner's UI review) |
| P61 | `PATCH …/category-groups/{groupId}` takes `name` optionally and also restyles. | 22 |
| P62 | The installation rules live in `identity`; there is no `installation` module. | 23 |
| P63 | HU-E8-18's administrator bootstrap is an operator script (M5). | 23 |
| P64 | Only the four formats are nullable; `timezone` and `locale` stay concrete and the theme stays a browser setting. | 23 |
| P65 | `PATCH /api/v1/me` also accepts `locale`, and `GET /api/v1/me` gains `preferences`. | 23 |
| P66 | Confirmed occurrences and imports stay untimed, and `occurredAt: null` answers `TimeRequired`. | 23 |
| P67 | The settings screen has no Save button (each choice is PATCHed as made), with "Default" and "Reset" labels. | 23; full text in Execution rulings, From the backlog (amended) |
| P68 | The COP symbol is `$` in both languages; the installation logo is a PNG, JPEG or WebP of at most 256 KB, no SVG. | 23; full text in Execution rulings, From the backlog |
| P69 | On a create, a valid sent `timeZone` applies even with a date alone. | 24 |
| P70 | Only `recordOccurrence` records a date without a time, through an internal `untimed` flag. | 25 |
| P71 | The preference fields are top-level in the `PATCH /api/v1/me` body and nested under `preferences` in the answers. | 26 |
| P72 | `UpdateProfile` checks every lock before any validation; clarified: this means the use case's own validation, and a malformed value is refused by the request schema first. | 27; clarification in Execution rulings, From a task review (clarified) |
| P73 | The preferences tasks run last and use migration `0018_user_preferences`. | 28 |
| P78 | The group-key back-fill's tie-breaks: most seeded categories held, then oldest, and the other claimants stay keyless. | 29 |
| P79 | A group answer returns its `key`, read-only. | 30 |

Section "Preflight rulings (P84–P88)", and, for P89–P94, section "Execution rulings (recorded after the merge)" (added to the plan after the merge, with the source of each):

| ID | Ruling | Where |
|---|---|---|
| P84 | Task 17a is four commits. | Preflight rulings |
| P85 | Hand-written SQL inside a generated migration counts toward the review size. | Preflight rulings |
| P86 | Task 17b is two commits. | Preflight rulings |
| P87 | Tasks 15b and 18b are two commits each. | Preflight rulings |
| P88 | The five mutation checks are the red evidence of the characterization tests. | Preflight rulings |
| P89 | The local date an instant gives in its zone must be a valid `LocalDate` (1900 to 9999), else `422 InvalidDate`. | Execution rulings, From the preflight (Task 7a review) |
| P90 | Every write to a space's category tree first takes a per-space advisory lock through `CategoryRepository.lockTree`. | Execution rulings, From the preflight (Task 9a review) |
| P91 | PostgreSQL itself refuses stored account terms a read would throw on: checks on billing days, rates and the other term ranges. | Execution rulings, From the preflight (Tasks 14 and 15a) |
| P92 | `AccountAttributeNotAllowed` answers a public detail `field` naming the refused body field. | Execution rulings, From the preflight (Task 15b-2) |
| P93 | Plan figures, closed plans and carry-over included, follow the current category tree and members. | Execution rulings, From the final review (M2) |
| P94 | The API keeps `timezone` on the user and `timeZone` on transactions. | Execution rulings, From the final review (M5) |

### M4: insight API (P32–P39, P74–P77, P80–P83, P95–P106)

Plan: [`2026-10-17-m4-insight-api.md`](../superpowers/plans/2026-10-17-m4-insight-api.md). P74 is amended. P83 is resolved by P95. P74–P77 and P80–P82 were ruled for HU-E7-06.

| ID | Ruling | Where |
|---|---|---|
| P32 | Reporting reuses budgeting's `loadPlanView` and `lineForCategory`; no table, no migration, no stored read model. | Assumptions, 1 |
| P33 | A report reads the plan covering the period's first day, whatever its status. | Assumptions, 2 |
| P34 | The line dashboard reports `unbudgeted` exactly when the plan has no catch-all line; pending occurrences never count as spent. | Spec contradictions found, 1 |
| P35 | The member matrix credits a transfer into a SAVINGS line's account to the account's owner; its status and reason codes are fixed. | Spec contradictions found, 2 |
| P36 | Fund tracking: expected sums the SHARED_FUND lines' assigned amounts; actual counts live fund contributions in the period. | Assumptions, 3 |
| P37 | The unified view is in the personal space's currency and lists other-currency spaces apart; it reads the caller's own member rows. | Spec contradictions found, 3 |
| P38 | The line trend follows the end plan's lines by origin link, then by name; `NEW` without a comparable previous figure; 1 to 24 periods, 6 by default. | Spec contradictions found, 4 |
| P39 | `period` and `endPeriod` are required, no pagination, no new error code, inline response schemas. | Assumptions, 4 |
| P74 | The seeded groups' catalog key ships in M3-D; HU-E7-06 only reads it. | Assumptions, 9 (amended) |
| P75 | The space breakdown takes `period=<label>`, shares are of the parent's total, rounded half up per level. | Assumptions, 10 |
| P76 | A merged personal row is named from the viewer's personal space, else the space with the most spending. | Assumptions, 11 |
| P77 | A group's key is found from the seeded categories it holds, then by its exact Spanish or English name, else none. | Assumptions, 12 |
| P80 | Both breakdowns reuse existing sums; the only new read is the category tree (`CategoryTrees`). | Assumptions, 13 |
| P81 | A merged row keeps the personal space's name even without spending there, and is archived only if archived everywhere. | Assumptions, 14 |
| P82 | One domain shape serves both breakdowns; the space response has no `space` field and a nullable `id`. | Assumptions, 15 |
| P83 | `ReportingDeps` and the unified view's categories port must not clash with M3-D's `categories` key. | Assumptions, 16 (resolved by P95) |
| P95 | Resolves P83: `ReportingDeps` carries budgeting's `categories`, and the unified view counts a subcategory under its parent and names every group. | Assumptions, 16 |
| P96 | The member matrix counts a subcategory's payments and shares on its parent's line, like the dashboard. | Assumptions, 17 |
| P97 | Cash out counts transfers into the caller's own SAVINGS accounts only; INVESTMENT transfers are not cash out in v1. | Assumptions, 18 |
| P98 | A period with no plan does not break a line's trace: the walk skips it and keeps looking for the line. | Assumptions, 19 |
| P99 | A name match never takes a line that another line of the later plan continues by origin. | Assumptions, 20 |
| P100 | `changePercent` is null beyond 2^53 basis points; the amount and status are still answered. | Assumptions, 21 |
| P101 | Only a top-level category lends its name to a row merged by catalog key; a keyed subcategory never names it. | Assumptions, 22 |
| P102 | In the personal breakdown only a merged row loses its `id` and `space`; inside a custom group row every category keeps them. | Assumptions, 23 |
| P103 | The category's own-spending entry always answers `archived: false`; the category row carries the flag. | Assumptions, 24 |
| P104 | The personal breakdown's own-spending entry always answers `space: null`; the category row carries the space. | Assumptions, 25 |
| P105 | One request computes each plan's figures once: the line trend shares a request-scoped cache by plan id, so its cost is O(window + chain). | Assumptions, 26 |
| P106 | The unified view and the personal spending by group break naming ties the same way: the space name in Spanish collation ignoring case, then the space id (P82, P95). | Assumptions, 27 |

### Preflight notes and findings

Preflight notes (N1–N6 and the like) and findings (B1–B12) are not rulings. They appear inside the plans where they were applied; M3-D's B3 is recorded in its Execution rulings section.

## Earlier plans (M0–M2c)

These plans predate the P numbering. Their decisions are numbered lists in the Self-Review of each plan, not rulings with an ID.

| Plan | What it records |
|---|---|
| [M0 walking skeleton](../superpowers/plans/2026-10-11-m0-walking-skeleton.md) | No numbered decisions. It carries the two ADRs above and the global constraints of the skeleton. |
| [M1 personal ledger](../superpowers/plans/2026-10-12-m1-personal-ledger.md) | "Spec open questions and assumptions": 15 gaps found while planning, each with the assumption its task makes. |
| [M2-A shared spaces](../superpowers/plans/2026-10-13-m2a-shared-spaces.md) | "Spec contradictions found" (5) and "Assumptions" (17). |
| [M2-B shared expenses](../superpowers/plans/2026-10-13-m2b-shared-expenses.md) | "Spec contradictions found" (10) and "Assumptions" (13). |
| [M2-C member lifecycle](../superpowers/plans/2026-10-14-m2c-member-lifecycle.md) | "Spec contradictions found" (14) and "Assumptions" (14); assumption 4 is the controller ruling O2, and assumption 13 amends D8 (owner directive of 2026-10-14). |

## How to add a decision

- **A design-level decision** (it changes how the product behaves or how the model works) goes into the spec's decisions table in section 6 as the next `D` number, with its rationale and the alternatives rejected. Add its row to the table above.
- **A technology choice** (a library, a tool, a generator) gets an ADR in `docs/adr/`, numbered in order, with Context, Decision and Consequences. Add it to the ADR table above.
- **An execution ruling** (how a plan resolves a gap, a contradiction or an assumption) goes into the milestone plan's Self-Review, as "Ruled by the controller (P<n>)" with the next free number. Then add its line to the group of that plan above, in the same pull request.
- A milestone's pull request updates this index with its new rulings.
