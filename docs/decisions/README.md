# Decisions index

Every decision Hearth has made, in one place. There are three kinds, and each lives where it was decided:

- **Design decisions (D1–D24)** are in the [design spec](../specs/2026-10-11-hearth-design.md#6-key-decisions), section 6.
- **ADRs** record a technology choice: [`docs/adr/`](#adrs).
- **Rulings (P1–P255)** are execution rulings the controller made while a milestone plan was written or run. Each lives in its plan's Self-Review; this page indexes them.

## Design decisions D1–D24

Rationale and rejected alternatives are in [section 6 of the spec](../specs/2026-10-11-hearth-design.md#6-key-decisions).

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
| D24 | A language may have regional variants (`es-CO`, `es-MX`, `es-AR`) that replace only vocabulary from a closed glossary over the neutral base; they never change formats or grammar, and Spanish always uses "tú". Proposed 2026-10-23, delivered by HU-E8-19. |

## ADRs

| ADR | Decision | Status |
|---|---|---|
| [0001](../adr/0001-boundary-enforcement-with-dependency-cruiser.md) | Enforce architecture boundaries with dependency-cruiser. | Accepted (2026-10-11) |
| [0002](../adr/0002-openapi-generator-zod-openapi.md) | Generate OpenAPI 3.1 with zod-openapi. | Accepted (2026-10-12) |
| [0003](../adr/0003-web-ui-talks-to-the-api-through-a-generated-client.md) | The web UI talks to `/api/v1` only, through a client generated from the snapshot. | Accepted (2026-10-20) |
| [0004](../adr/0004-web-ui-testing-and-performance-gates.md) | Test the web UI with Vitest, Playwright and axe, and gate it on Core Web Vitals. | Accepted (2026-10-20) |

## Rulings P1–P255

Rulings are numbered across milestones, not per plan, and not always in the order of the plans: M4's plan holds rulings that were made while M3-D was being planned. The tables are grouped by the plan that records them. In each, "Where" is the plan's Self-Review section and the item number in it. "Amended" marks a ruling the plan itself says was amended.

The ranges are: M3-A P1–P9, M3-B P10–P19, M3-C P20–P31, M3-D P40–P73, P78, P79 and P84–P94, M4 P32–P39, P74–P77, P80–P83 and P95–P106, M5 P107–P116, M6a P117–P154, M6b P155–P183, the M6b addendum P184–P199, and M6c P200–P248, with the post-milestone follow-ups P249–P255. M3-D's P89–P94 were kept outside the repository until the merge and are recorded in the section "Execution rulings (recorded after the merge)" at the end of its plan.

### M3-A: budget plans (P1–P9)

Plan: [`2026-10-14-m3a-budget-plans.md`](../plans/2026-10-14-m3a-budget-plans.md). P8 is amended.

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

Plan: [`2026-10-15-m3b-plan-lifecycle.md`](../plans/2026-10-15-m3b-plan-lifecycle.md). P17 is amended.

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

Plan: [`2026-10-16-m3c-recurring-and-history.md`](../plans/2026-10-16-m3c-recurring-and-history.md). Spec 5.2 (Recurrence) was amended with P21–P24.

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

Plan: [`2026-10-17-m3d-ledger-refinements.md`](../plans/2026-10-17-m3d-ledger-refinements.md). P42, P44, P56, P60 and P67 are amended; M4 also amended P74. P62–P68 are recorded together in one point (23); the full text of P67 and P68 is in the plan's [Execution rulings](../plans/2026-10-17-m3d-ledger-refinements.md#execution-rulings-recorded-after-the-merge) section.

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

Plan: [`2026-10-17-m4-insight-api.md`](../plans/2026-10-17-m4-insight-api.md). P74 is amended. P83 is resolved by P95. P74–P77 and P80–P82 were ruled for HU-E7-06.

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

### M5: nightly backups (P107–P116)

Plan: [`2026-10-19-m5-nightly-backups.md`](../plans/2026-10-19-m5-nightly-backups.md). P107 and P112 are amended. P115 and P116 were ruled during execution, from the reviews of Tasks 2 and 3.

| ID | Ruling | Where |
|---|---|---|
| P107 | A `backup` sidecar from the `db` image runs busybox `crond` at 02:00 in `APP_TIMEZONE`; its crontab is written at start because `crond` ignores crontabs root does not own; scripts are mounted read-only (P116). | Rulings, 1 (amended by P116) |
| P108 | One gzip plain-SQL `pg_dump --no-owner --no-privileges` per day, `hearth-YYYY-MM-DD.sql.gz`, written as a per-run `.hearth-YYYY-MM-DD.sql.gz.<pid>.partial`, verified, then renamed; its first line records the transaction count of the dump's own exported snapshot. | Rulings, 2 |
| P109 | `BACKUP_RETENTION_DAYS` counts files: the newest N by name are kept, only after a good dump, and nothing but backup files is deleted. | Rulings, 3 |
| P110 | Backup scripts log JSON lines like the app, with `job` and stable PascalCase `reason` codes; the tools' own stderr is kept. | Rulings, 4 |
| P111 | The drill runs in the `backup` container, restores into `hearth_restore_drill` on the same server, compares every row of `transactions` with the header and drops the scratch database on every path. | Rulings, 5 |
| P112 | The off-site copy is an optional `backup-offsite` service (profile `offsite`, `rclone/rclone:1.75.1`, bumped to 1.75.2 on 2026-10-25 once two weeks old, issue #135) configured only by `.env.offsite`; it runs `rclone copy`, never `sync`, at 03:00. | Rulings, 6 (amended) |
| P113 | Script tests live in a new Vitest project `operations` that drives labelled disposable containers through the Docker CLI; `compose.dev.yaml`'s `test` service skips it. | Rulings, 7 |
| P114 | Agents cannot read or edit `.env.production.example` (the owner's deny rule on `.env.*`, kept on purpose): every new variable gets a default in `compose.yaml` and is documented in `docs/operations/backups.md`, and the example file's lines go in the pull request for the owner to paste. | Rulings, 8 |
| P115 | `BACKUP_RETENTION_DAYS` is a whole number from 1 to 9999 (one to four digits, no leading zero), so shell arithmetic cannot wrap; any other value refuses before the dump. | Rulings, 9 (narrows P109) |
| P116 | The `backup` and `backup-offsite` services mount the whole `./scripts` directory read-only at `/hearth`, so a missing `scripts/` fails loudly; `cron-entrypoint.sh` checks each `/hearth/…` script its command names and exits 66 when it is not a file. | Rulings, 10 |

### M6a: web shell and ledger (P117–P153)

Plan: [`2026-10-20-m6a-web-shell-and-ledger.md`](../plans/2026-10-20-m6a-web-shell-and-ledger.md). P140 and P141 are the owner's answers to the planner's two questions. P142–P152 come from the owner's flow review of sign-up and sign-in (the plan's section "Owner flow review"); P142–P144 and P150 are backend changes already shipped. P153 was ruled during execution.

| ID | Ruling | Where |
|---|---|---|
| P117 | The UI's only way to the backend is `/api/v1`, through one client generated from `openapi/openapi.snapshot.json` (`openapi-typescript` types, `openapi-fetch` at run time): Server Components read over loopback with the request's cookie, every write runs in the browser, and there are no server actions. | Rulings, 1 |
| P118 | Forms do not import `src/modules/*/contracts`: they check only what they need to build a request, and the API is the validator, shown next to each field. | Rulings, 2 |
| P119 | Dependency-cruiser's `ui-talks-only-to-the-api` keeps every UI folder, the proxy and `src/i18n` away from a module's `domain`, `application`, `infrastructure` and `contracts`, the composition root, server-only packages and all of the kernel except `time-zone.ts`, `local-date.ts` and `style.ts`. | Rulings, 3 |
| P120 | No locale in the URL: the signed-in user's stored locale wins, then the visitor's `hearth.locale` cookie, then `Accept-Language`, then Spanish; messages are typed and a missing key fails `tsc`. | Rulings, 4 |
| P121 | Only `src/shared/ui/format/` formats numbers, dates and times, from the person's effective preferences as arguments; an architecture test fails on any other `Intl` or `toLocale*` use. | Rulings, 5 |
| P122 | One style vocabulary: the kernel's sixteen-key `PALETTE` and 61-name `SYMBOLS` serve categories and accounts, and migration `0019_account_style_vocabulary` maps the stored account values. | Rulings, 6 |
| P123 | `POST /api/v1/spaces/{spaceId}/accounts/{accountId}/restore` (`RestoreAccount`) restores an archived account with the archive's authorization; restoring an active account answers it unchanged. | Rulings, 7 |
| P124 | `preferences.defaults` of `GET` and `PATCH /api/v1/me` gains the installation's `timezone` and `locale`, so Settings shows "Default" and sends the installation's value on Reset. | Rulings, 8 |
| P125 | The routes are `/sign-in`, `/sign-up`, `/`, `/spaces/{spaceId}` with `…/transactions`, `…/accounts`, `…/accounts/new` and `…/new?type=`, and `/settings`; `src/proxy.ts` sends a request without a session to `/sign-in?next=` and `next` is honoured only as a same-origin path. | Rulings, 9 |
| P126 | M6a leaves out of the approved design the Plan and Saldos tabs, plan and balance figures, the hide-balances eye, recent-category chips, the Categories, Members and Installation rules entries, create-or-join in the space sheet, category create and edit, split and space chips, transaction search and filters, the currency settings row, and transaction and account editing. | Rulings, 10 |
| P127 | Container-presentational in the App Router: a server container is a pure `load*` function over the `Api` plus an async component, presentational components take DTOs and serializable `formats`, a 401 redirects to sign-in and a 404 renders `notFound()`. | Rulings, 11 |
| P128 | One idempotency key per draft: a fresh UUID when the body changes and after a save, reused by a double click or a retry of an unchanged draft. | Rulings, 12 |
| P129 | The record form's time zone is the browser's, falling back to the profile's during the server render; minute steppers move to the next multiple of five within the chosen day, days after today are disabled, and there is no "no time" control. | Rulings, 13 |
| P130 | The transaction list groups by day under `ledger.day.today`, `ledger.day.yesterday` or the date in the person's format, has no per-day totals, navigates periods with `GET …/periods` and filters by `categoryIds`. | Rulings, 14 |
| P131 | The accounts screen has the sections Banks, wallets and cash, Credit cards, Savings and investments, Debts, Other, Shared funds and Archived, without per-section totals; the create form asks only the type's attributes and sends a switch only when touched. | Rulings, 15 |
| P132 | The testing stack: a Vitest `ui` project on jsdom with Testing Library and axe-core, and Playwright with playwright-bdd and `@axe-core/playwright` against the standalone build; jsdom over happy-dom. | Rulings, 16 |
| P133 | `HEARTH_E2E_FIXED_NOW` fixes the container's `Clock` and the UI's `serverNow()` for the e2e server, each scenario sets the browser's clock, and each test sends its own `x-forwarded-for`; never set in production. | Rulings, 17 |
| P134 | The performance gates: Lighthouse 13.5.0 mobile medians of five runs per route (three until M6b Task 21) (LCP ≤ 2500 ms, CLS ≤ 0.1, TBT ≤ 200 ms, script transfer within `tests/performance/budgets.json`) and INP ≤ 200 ms with `web-vitals` over the record flow; a route without a budget fails and a missed budget is the owner's decision, never a silent raise. | Rulings, 18 |
| P135 | The theme (system, light, dark) is a device setting in `localStorage` (`hearth.theme`) applied before paint by an inline script; dark tints and inks are mixed from the light ones and checked by the dark axe scans. | Rulings, 19 |
| P136 | No `eslint-config-next` (its plugin tree targets ESLint 9 and older): `eslint-plugin-react-hooks` 7.1.1 on `src/**/*.{ts,tsx}`, and accessibility checked by axe at run time. | Rulings, 20 |
| P137 | Settings: each choice is PATCHed at once, applied optimistically and rolled back with its error next to the field; the installation's own value is stored as `null`, and a locked field is read-only. | Rulings, 21 |
| P138 | Amounts are typed or tapped in the person's number format, turned into minor units with `BigInt`-safe strings, and refused before the request when they carry more decimals than the currency's exponent. | Rulings, 22 |
| P139 | `src/shared/ui/api/schema.d.ts` is committed, generated only from the reviewed snapshot, excluded from Prettier, ESLint and the review-size count, and checked by `pnpm api:check` in the lint job. | Rulings, 23 |
| P140 | Transactions are read-only in M6a: the Activity rows open nothing, and editing and deleting (with the `If-Match` flow) is an M6b follow-up. Agreed by the owner on 2026-10-20. | Rulings, 24 |
| P141 | The Plan and Saldos tabs are hidden, not shown disabled, until HU-E9-08 and HU-E9-07 build their screens, so the bottom bar has three slots. Agreed by the owner on 2026-10-20. | Rulings, 25 |
| P142 | `POST /api/v1/auth/sign-up` takes an optional `locale` (`es`, `en`), and the sign-up container sends the screen's current locale. Backend shipped; the container is Task 8b. | Owner flow review, P142 |
| P143 | `HEARTH_SIGN_UP=open|closed`: while `closed`, sign-up needs an `invitationToken` that names a usable invitation or answers 403 `SignUpClosed`, and the public `GET /api/v1/auth/sign-up` answers the mode. Backend shipped. | Owner flow review, P143 |
| P144 | A forgotten password is reset by the operator with `scripts/reset-password.mjs` in the migrator image; there is no email reset until Hearth can send mail. Backend shipped. | Owner flow review, P144 |
| P145 | A signed-in person who opens `/sign-in` or `/sign-up` goes to `/`; the page calls `getMe()` and redirects, and the proxy lets public paths through whatever the cookie says, so a stale cookie never loops. | Owner flow review, P145 |
| P146 | The sign-in screen has a "Forgot your password?" note that points to whoever runs Hearth, hides "Create an account" while sign-up is closed, and after a problem keeps the email, clears the password and focuses it. | Owner flow review, P146 |
| P147 | The sign-up screen has a confirm-password field checked in the browser and never sent, sends `locale` and the `invitation` token from the URL, shows a notice instead of the form while sign-up is closed, and links to sign in. | Owner flow review, P147 |
| P148 | The home of a space with no account shows an "Add your first account" card in place of the period summary. | Owner flow review, P148 |
| P149 | Sign-out writes the signed-in user's stored locale to the `hearth.locale` cookie before it calls `POST /api/v1/auth/sign-out`, so the sign-in screen keeps their language. | Owner flow review, P149 |
| P150 | A session lasts 15 days from its last use (Better Auth's `session.expiresIn`, renewed once a day while in use). Backend shipped. | Owner flow review, P150 |
| P151 | An expired session: a page load goes to `/sign-in?next=`, a 401 in the browser (outside `/api/v1/auth/*`) assigns the sign-in URL with `expired=1`, and the sign-in screen says the session expired. | Owner flow review, P151 |
| P152 | The public screens' language toggle changes only the visitor cookie, never the stored locale; after sign-in the stored locale wins and changes only in Settings. | Owner flow review, P152 |
| P153 | A module's server containers are exported from `ui/server.ts` and client code imports `ui/index.ts`; dependency-cruiser allows `ui/(index|server).ts`, and a rule fails an `index.ts` that reaches the server-only API reader. Ruled during execution. | Execution, Task 19 |
| P154 | The first measured script budgets per route (Task 19): Next.js 16.4 and React 19.3 alone ship 129 KiB gzip and next-intl's client formatter 12 KiB, so 150 KiB for the sign-in screens could not hold any application code. The controller, with the owner's standing delegation, set each route's budget a little above its measurement (sign-in and sign-up 180, home and accounts 185, settings 200, transactions and record 205 KiB) and kept LCP, CLS, TBT and INP unchanged; measured medians were LCP 1.8–2.0 s, CLS 0, TBT 25–51 ms and INP 80 ms. Lowering the budgets is a follow-up. | Execution (Task 19) |

### M6b: shared spaces, split expenses and balances (P155–P183)

Plan: [`2026-10-21-m6b-shared-spaces-split-balances.md`](../plans/2026-10-21-m6b-shared-spaces-split-balances.md). Ruled by the planner under the owner's standing delegation of 2026-10-20 (L1); every design deviation is listed in the plan's Self-Review for the owner's end review.

| ID | Ruling | Where |
|---|---|---|
| P155 | `GET /api/v1/spaces/{spaceId}/invitations` lists the pending email and link invitations that have not expired, newest first, to OWNER and ADMIN; claim links are left out and the answer never carries a URL, because only the token's hash is stored. | Rulings, 1 |
| P156 | `GET /api/v1/invitations/{token}` and `GET /api/v1/claims/{token}` need no session and answer only the space's name, the inviter's display name, the role or the guest's name, the status and the expiry (never an email); an unknown or wrong-kind token is 404 `InvitationNotFound`, with no throttle. | Rulings, 2 |
| P157 | `/invitations/{token}` and `/claims/{token}` live in the route group `(open)`, whose layout never redirects; the proxy lets them through by `OPEN_PREFIXES`, `safeNext` honours them and the sign-up screen takes `next` and returns there. | Rulings, 3 |
| P158 | `SPACE_CONTROLS` is the UI's copy of HU-E1-05's permission matrix, pinned to the domain's `can()` by a `.test.ts`; a control the viewer may not use is hidden, not disabled, a direct space offers no invitation, guest or role control, and the API stays the authority. | Rulings, 4 |
| P159 | The routes are `/spaces/new`, `/spaces/{spaceId}/members`, `/spaces/{spaceId}/balances`, `/spaces/{spaceId}/members/{memberId}/history?from=`, `/invitations/{token}` and `/claims/{token}`; a personal space has no members or balances screen. | Rulings, 5 |
| P160 | The bottom bar reads Inicio, Movimientos, Registrar, Saldos (M6c inserts Plan before Saldos); Saldos shows only in shared and direct spaces, the profile sheet's "Miembros e invitaciones" only outside the personal space, and the space sheet ends with "Crear espacio compartido". | Rulings, 6 (amends P141) |
| P161 | A new shared space takes a name and one of COP, USD or EUR; the period stays MONTHLY day 1 and the artboard's period controls are not built; afterwards the new space's members screen opens. | Rulings, 7 |
| P162 | An invitation is created only when the person presses Crear enlace or Enviar invitación, never by opening the sheet; its URL is shown once in a `CopyField` (also for an email invitation while `emailSent` is false); roles are ADMIN, MEMBER and VIEWER, default MEMBER. | Rulings, 8 |
| P163 | A guest is a name and an optional email; the guest sheet holds the claim link (OWNER, ADMIN) and the removal (OWNER, ADMIN, MEMBER) behind a confirmation, and an `OutstandingBalance` refusal shows the problem's public `outstanding` amount and links to the settle-up sheet prefilled for that guest. | Rulings, 9 |
| P164 | Only an OWNER sees role controls, never on their own row; a sheet lists the four roles with a one-line meaning and `LastOwnerRequired` stays in the sheet. | Rulings, 10 |
| P165 | The invitation page has the states visitor, signed in, other account, expired, revoked, used and missing; after accepting it opens the space's home, dates follow the person's formats (the built-in ones and the installation's zone for a visitor) and an email invitation's address is never shown. | Rulings, 11 |
| P166 | `previewSplit` mirrors the domain's `splitShares` over `Money.allocate` (join order, largest remainder, the rounding unit, the sub-unit to the first participant) and is pinned by a parity table; the request carries percents, amounts or units, never the preview, and the server's answer is authoritative. | Rulings, 12 |
| P167 | `GET …/default-split` is read 250 ms after the category, the date and a positive amount settle and only the latest request may answer; its method is preselected until the person changes the method, a participant or a value, BY_ALLOCATION is sent by omitting `split`, and a failed read offers EQUAL. | Rulings, 13 |
| P168 | The payer is the recorder (from the active accounts they own), a guest (no account) or an active fund (no payer member); another registered member is never offered, because only an account's owner records its debit (D9), which deviates from the Split artboard. | Rulings, 14 |
| P169 | A split is valid when percents with at most two decimals add to 100, exact amounts add to the total, units are positive whole numbers, at least one person takes part and every share is positive; the status line names what is missing and Listo and Save stay disabled while invalid. | Rulings, 15 |
| P170 | After a 201 with `FundBalanceNegative` the form opens the list with `?notice=FundBalanceNegative&account=<id>`; the list reads that fund's balance from the accounts it already loads, no amount travels in the URL, and `pnpm i18n:check` requires `warnings.<Code>` for every warning code of the snapshot. | Rulings, 16 |
| P171 | In shared and direct spaces an expense row names its payer ("pagó Juan", or the fund's name) and a settlement row reads "{payer} → {receiver}"; a personal space's rows are unchanged. | Rulings, 17 |
| P172 | "Split with someone" is offered only from the personal space's expense form, to each registered co-member once or to the guests of the person's direct spaces or a new guest by name; the category travels by its catalog key, the split is always halves and the direct space's list opens afterwards. | Rulings, 18 |
| P173 | A net is "debe", "le deben" or "a paz y salvo" with the absolute amount, from `memberSentence`; suggestion and member sentences use names, never "you", so "Juan owes Ana" reads the same from every seat. | Rulings, 19 |
| P174 | Settle-up is a sheet on the balances screen: payer and receiver are different current members, the source account only when the viewer pays and the destination only when the viewer receives (both optional, none for a guest), it records now in the browser's zone with one `Idempotency-Key` per draft, and a VIEWER sees no settle-up controls. | Rulings, 20 |
| P175 | Liquidar prefills a suggestion's payer, receiver and amount, Registrar pago makes the viewer the receiver, and `?settle=<memberId>` opens the sheet with that member as payer and their suggestion's amount. | Rulings, 21 |
| P176 | The balance history covers a period of the space, the current one by default and `?from=<date>` for another, with previous and next links from `GET …/periods`; entries show the date, the description (or the type), the change and the running balance as a sentence. | Rulings, 22 |
| P177 | The budgets of the new routes, set from P154's measured siblings: `/spaces/new` 190, members 200, balances 200, history 190, the shared expense form 215 and the invitation and claim pages 185 KiB; LCP, CLS, TBT and INP are unchanged, a missed budget is fixed by lazy loading or reported, never raised, and a budget may be lowered to its measurement plus 5 KiB. | Rulings, 23 (under P154) |
| P178 | Other people in an e2e scenario sign up in their own Playwright request contexts and are disposed at its end, and each scenario that records money fixes the browser's clock inside the server's fixed period (2026-10-31 12:00 Bogotá, or 2026-11-08 14:32 for the plan scenario). | Rulings, 24 |
| P179 | Editing, deleting and restoring transactions (M6a's follow-up 2, P140) is not part of M6b's first plan, whose scope is HU-E9-05, HU-E9-06 and HU-E9-07; the M6b addendum plan takes it up. | Rulings, 25 |
| P180 | The members screen shows "Se unió el {date}" from `joinedAt` in the viewer's zone for every registered member (the API has no creator flag), a count heading with a plural and the subtitle "{space} · {currency} · {policy}". | Rulings, 26 |
| P181 | Copying uses `navigator.clipboard.writeText` and announces the result in a status region; when the browser refuses, the read-only field's text is selected and the person is asked to copy it. | Rulings, 27 |
| P182 | `serverZone()` reads `APP_TIMEZONE` (default `America/Bogota`) for dates shown to someone without a profile, so the pages a visitor opens need no new variable. | Rulings, 28 |
| P183 | `currencyOf` carries each currency's rounding unit (COP whole pesos), pinned to the kernel's by a `.test.ts`. | Rulings, 29 |

**M6b amendments and execution notes.** These came up while M6b was built. They take no P number: each amends a ruling above or records a behaviour that shipped beyond the plan (the navigation and UX batches the owner asked for after reviewing the first screens). The [addendum plan](../plans/2026-10-21-m6b-addendum-edit-delete-feedback.md) numbers its own rulings from P184.

| Amends | Note | Where |
|---|---|---|
| P134 | The Lighthouse median is taken over five runs per route, not three: simulated LCP is bimodal on this app and a median of three failed about one CI run in twenty with no code change. No budget changed. Also in [ADR 0004](../adr/0004-web-ui-testing-and-performance-gates.md). | Task 21 (`97f4697`) |
| P154, P177 | `/spaces/new`'s script budget is 192 KiB, not 190: the navigation tracker (about 0.7 KiB gzip on every route) and `ScreenHeader` as a client component took the route to 191 KiB. Every other budget is unchanged. | Task nav1 |
| P154 | **Amended in M6b (#141).** next-intl now precompiles the message catalogs at build time and `cn` no longer uses tailwind-merge, which cut about 17 KiB of script on every route (the record routes went from 202 to 184 KiB). Every route's script budget was lowered to about 3 KiB above its new median; none was raised. | #141 |
| P132, P133 | The e2e server, its database container's label and every spec read `E2E_PORT` (default 3100), so two worktrees can run e2e at once; the teardown removes only its own port's containers and a server already on the port is reused only with `E2E_REUSE=1` (#140). The Vitest `ui` project gives `findBy*` and `waitFor` 5 s (`asyncUtilTimeout`) instead of 1 s, because a lazy sheet or a failed request can take longer on a loaded machine. The port is also in ADR 0004. | E2E isolation; `31b6085` |
| P125 | **Navigation trail.** `NavigationTracker` (mounted once in the web layout) mirrors this tab's history in `sessionStorage` (`hearth:navigation`) by wrapping `history.pushState` and `replaceState`. `ScreenHeader`'s Volver stays a real link to the logical parent; on a plain click it goes back (`history.go(-n)`) to the nearest earlier entry on another screen, and follows the link when there is none (a typed address, a stale trail, or an earlier screen that is sign-in, sign-up or an invitation or claim page). Inicio, Movimientos and Saldos restart the trail, so switching tabs never builds a chain. | Task nav1 |
| P125 | **Return after a flow.** `returnTo` is validated like `safeNext` (`safeReturnTo`; `safeNext` is `safeReturnTo(x) ?? "/"`) and carried by the new-account and new-space links; saving goes to it. Every successful create, save and accept (new space, new account, both record saves, accepting an invitation) uses `router.replace`, so neither Volver nor the browser's Back returns to the used form. `safeNext` refuses `/api` paths, also after dot segments and percent escapes. | Tasks nav1 and nav2 |
| P125 | **Query-only state replaces history.** Closing the settle-up sheet removes `?settle=`; dismissing the saved notice and choosing or removing a list filter replace the entry. The balance-history period arrows stay pushes, because each period is a place, and Volver skips them. | Task nav2 |
| P125, P127 | **Screens that leave the happy path.** The root layout moved to `src/app/layout.tsx`, so an app-level `not-found.tsx` ("Ir al inicio") renders inside it in the person's language and theme, and the space's not-found uses the same screen. `(app)/error.tsx` keeps Reintentar and adds "Ir al inicio"; `(public)` and `(open)` get an error boundary; an API outage on sign-in shows "No pudimos conectar con Hearth" with Reintentar instead of Next's bare error. | Task nav2 |
| P125, P137 | **The active space survives Settings and New space.** A validated `?from=` (one of the person's own space ids) renders them in that space's shell (header, switcher and bottom bar); their pages wrap themselves in the shell because a layout cannot read the query. A signed-in person who opens `/sign-in?next=…` goes to `safeNext(next)`; sign-up's "sign in" links keep `next` and the invitation; a wrong-account invitation offers "Ahora no"; the record form's account picker ends with "Nueva cuenta" (with `returnTo`); the home of a shared or direct space shows "Miembros" and, to who may invite, "Invitar" (`members?invite=1`). | Task nav2 |
| P135 | `ThemeSync` (client, in the root layout) applies the stored theme on mount, which fixes not-found pages that stayed light in dark mode (a `notFound()` thrown by a layout renders on the client, where the inline head script never runs), and follows `prefers-color-scheme` live while Tema is "Sistema". | Task nav2 |
| P126, P130, P137 | **UX batch 2.** A shared space's home and Accounts say "Cada persona paga desde sus cuentas personales; aquí solo viven los fondos del espacio." instead of asking for a first account, with the funds section or "Crear un fondo" for who may manage funds (the `manageFunds` control, pinned to `fund.manage`); the split row reads "Con Ana y Luis · mitad y mitad" or "Con 3 personas · por porcentaje"; the amount groups digits while typing (6000 shows `6.000` for COP, the caret stays put and the parsed value is unchanged); Cuentas with no accounts has an empty state and a labelled "Nueva cuenta" pill; every saved preference in Settings shows "Guardado" (`role=status`, 2 s) in a fixed-size slot, so Restablecer does not move; accepting an invitation or claim opens `/spaces/<id>?joined=1` with a one-time "Te uniste a «Nombre»" notice; Movimientos of a shared or direct space names the space under its title. | Task nav2 (part 2) |
| P168, P169, P171 | **Fixes from the screenshot review.** The payer's name wraps instead of being cut off; a split row nobody has typed in yet is not an error (a neutral hint, with Listo disabled) and a field's error clears as the person edits it; the bottom bar and the page padding add `env(safe-area-inset-bottom)` so the last button is never under the bar; an empty "Recientes" says so; `icon.svg` and `apple-icon.png` are served without a session. | Task ux1 |

### M6b addendum: edit, delete and save feedback (P184–P199)

Plan: [`2026-10-21-m6b-addendum-edit-delete-feedback.md`](../plans/2026-10-21-m6b-addendum-edit-delete-feedback.md). Ruled by the planner under the owner's standing delegation of 2026-10-20.

| ID | Ruling | Where |
|---|---|---|
| P184 | Editing, deleting and restoring transactions join M6b inside the same pull request (amends P179); settlements and fund contributions are deleted and recorded again, never edited in place. | Rulings, 1 |
| P185 | `POST /api/v1/spaces/{spaceId}/transactions/{transactionId}/restore` runs `DELETE`'s guards, clears `deletedAt` with a compare-and-set on the version, audits `RESTORED` and answers 200 with the ETag; a transaction that is not deleted is answered unchanged, so a repeated Deshacer is harmless. | Rulings, 2 |
| P186 | `PATCH` also takes `accountId`, `payments`, `split`, `sourceAccountId` and `destinationAccountId`, under D9's ownership rules; a changed amount with several shares and no `split` still answers `SharesDoNotMatchAmount`. | Rulings, 3 |
| P187 | The audit's `action` gains `RESTORED` (a `text` column, so no migration), and incomes, transfers and settlements now audit their accounts. | Rulings, 4 |
| P188 | `FieldNotEditable` (409, detail `field`) answers a part a type does not have, any account of a settlement or a fund contribution, `accountId` on a transfer, and `payments` or `split` on anything but an expense. | Rulings, 5 |
| P189 | A row links to its page with `?tx=<id>`; the detail sheet loads with `next/dynamic` only then, closing replaces the address with the origin, Back closes it, and a missing transaction shows `TransactionNotFound` inside the sheet. | Rulings, 6 |
| P190 | The sheet lists the transaction's definitions and its split, names an account the viewer cannot read "Cuenta de {name}", and hides every action the viewer may not use (as in P158). | Rulings, 7 |
| P191 | The edit route is `/spaces/{spaceId}/transactions/{transactionId}/edit?from=<origin>`, where the origin is a same-space path checked by `safeNext`; Volver opens the sheet again, saving returns to the origin, and the edit modules load only on that route. | Rulings, 8 |
| P192 | The form prefills in the person's format; only changed keys travel, the time travels whole, and an untimed row gets a time only when the person changes its date or time. | Rulings, 9 |
| P193 | `If-Match` is the DTO's version; a 412 shows `PreconditionFailed` with "Cargar la última versión", and the form, keyed by the version, remounts with the newest values. | Rulings, 10 |
| P194 | Deleting runs at once with no confirmation dialog, closes the sheet to the origin, and shows a status toast with Deshacer for 8 s; Deshacer restores once and says so. | Rulings, 11 |
| P195 | One `ToastProvider` and `useToast` in `src/shared/ui`, with two live regions that exist before any message, one toast at a time, 5 s plain or 8 s with an action, paused on hover and focus, and F8 to reach it; Radix Toast and toast libraries were rejected. | Rulings, 12 |
| P196 | Every save says so in a status toast ("Gasto guardado", "Ingreso guardado", "Transferencia guardada", "Cambios guardados", "Pago registrado", and the deleted and restored messages), except when the saved-with-warning notice speaks or an edit changed nothing. | Rulings, 13 |
| P197 | Recurrence-generated transactions get no special rule: an edit changes that transaction only, a deletion leaves its occurrence `RECORDED`, and a restore brings the same row back. | Rulings, 14 |
| P198 | The open sheet and the edit route get their own script budgets, set from measurements under the plan's caps; the record route's budget does not move, and the toast card loads lazily to keep it. | Rulings, 15 |
| P199 | Five `@e2e` scenarios cover edit, delete with undo, a version conflict, save feedback and a shared expense's corrected amount; the sheet, the edit route and the toast join the layout spec, and `a11y-edit.spec.ts` scans them in both themes. | Rulings, 16 |

### M6c: budget planner and dashboards (P200–P248)

Plan: [`2026-10-21-m6c-planner-and-dashboards.md`](../plans/2026-10-21-m6c-planner-and-dashboards.md). Ruled by the planner under the owner's standing delegation of 2026-10-20 (Log L1). P227–P247 come from the three issues the owner moved into M6c (#142, #143 and #150, Log L2) and P243–P247 from the coordinator's hands-on test of a competitor (Log L3). P248 was ruled during execution. Every design deviation is listed in the plan's Self-Review for the owner's review of Batch 2.

| ID | Ruling | Where |
|---|---|---|
| P200 | The bottom bar gains Plan (amends P141), a link to `/spaces/{spaceId}/plan` that is current under `…/plan` and `…/plans`; a shared or direct space shows Lines, Members, Fund, By group and Trend, the personal space My spending, By group, Trend and Lines, and a dashboard reaches the planner through the `plan` its report answers. | Rulings, 1 |
| P201 | Figures are the API's: the UI never sums, subtracts or recomputes an amount or a share it shows, so the line dashboard and fund tracking answer `totals`; bar widths are presentation, and the allocation preview is a labelled exception the server overrides. | Rulings, 2 |
| P202 | Bars are HTML widths inside the rows that carry their figures; Recharts draws only the personal and line trends, fetched after mount by `LazyTrendChart`, and dependency-cruiser's `recharts-only-in-charts` and `charts-load-lazily` enforce both halves (deviates from HU-E9-10's notes). | Rulings, 3 |
| P203 | The chart dependencies are `recharts` 3.10.1 and its peer `react-is` 19.3.0, pinned exactly; Recharts 2.15.x, Victory and Chart.js were rejected. | Rulings, 4 |
| P204 | `formatPercent` keeps the API's two decimals ("40,00 %") in the person's number format, with a non-breaking space before "%" and U+2212 for negatives; `formatSignedMoney` writes "+$ 50.000", "−$ 50.000" and "$ 0". | Rulings, 5 |
| P205 | A dashboard's period is `?period=<label>`, else the space's period that holds today in the viewer's zone; its neighbours come from the day before its start and the day after its end, and the personal views use the personal space's periods. | Rulings, 6 |
| P206 | Every plan write sends `If-Match: "<version>"` of the last answer and keeps the plan it answers; a 412 shows `errors.PreconditionFailed` and re-reads the plan, and the lifecycle buttons are disabled while a call is pending. | Rulings, 7 |
| P207 | OWNER and ADMIN edit plans, a MEMBER changes only their own capacity, a VIEWER reads and a CLOSED plan is read-only for everyone; the dashboard's link reads "Editar plan" or "Ver plan", and only managers are offered Create and Copy plan. | Rulings, 8 |
| P208 | Only the capacities container reads the private capacity suggestion, on the server with the request's cookie; it shows only on the viewer's own row, a failed read is `null`, and the total and the shares stay the stored ones until the save answers. | Rulings, 9 |
| P209 | A copy's `dropped` reaches the planner once through `sessionStorage` (`hearth.planCopy.<planId>`) and is shown as a notice; a reload or another tab loses it. | Rulings, 10 |
| P210 | `saveLine` adds or patches the line, then puts its categories, then its allocation, each with the version the step before answered; the first failure stops, keeps what was saved and points at its section, so the allocation editor is part of the line editor (amends HU-E9-08's note). | Rulings, 11 |
| P211 | `allocate` mirrors the kernel's `Money.allocate` and is pinned to it; PERCENT must sum to exactly 100 % and FIXED to the planned amount, else `errors.InvalidAllocation` and the sum block the save, and the server's answer has the last word. | Rulings, 12 |
| P212 | Categories are mapped in a sheet of checkboxes over the space's live parent categories; a category mapped to another line is disabled and names it, and a savings line maps none. | Rulings, 13 |
| P213 | The line editor offers the caller's own active SAVINGS accounts of their personal space in the plan's currency; ids the caller cannot see read "Cuenta de ahorro de otro miembro" and are kept unless unchecked. | Rulings, 14 |
| P214 | Activate is offered for a DRAFT and its `InvalidAllocation` names the lines of `lineIds`; Close is offered for an ACTIVE plan from the day after the period's last day in the viewer's zone; a CLOSED plan hides every edit control. | Rulings, 15 |
| P215 | By group loads once and drills on the client; a category drills only when it holds a named subcategory, the breadcrumb starts at "Todos los grupos" with the current crumb `aria-current="location"`, and the bar width is the answered share. | Rulings, 16 |
| P216 | From 1024 px a shared space's `…/plan` adds the By group, Fund, Against the previous period and Members by line panels, read in parallel; a failed read leaves its panel out. | Rulings, 17 |
| P217 | The member matrix shows "—" for a null cell and reads its reason to assistive technology and once under the table, explains a SAVINGS line, and links a fund-level line to the Fund view. | Rulings, 18 |
| P218 | The unified view has consumption and cash-out cards, "Pagado fuera de la app" only when it is not zero, categories in the API's order and named as the API names them ("space / category" for a custom one), and one notice per space in another currency. | Rulings, 19 |
| P219 | Trends take windows of 6 (default) or 12 periods; `ChangeText` writes "−$ 50.000 (−3,70 %)" with a Down, Up or Same badge, and NEW shows "Nueva" with no percentage. | Rulings, 20 |
| P220 | Every chart sits in a `figure` with a visible `figcaption`, its SVG is `aria-hidden` with no legend, and the table beside it carries the same series as the accessible source. | Rulings, 21 |
| P221 | Every new route gets its script budget in `tests/performance/budgets.json` under caps derived from P154's measurements (190 KiB for the server-rendered dashboards, 195 with the drill-down, 200 for the planner and capacities, 215 for the line editor, 300 for the trends); LCP, CLS and TBT are unchanged, and INP covers the drill-down and the allocation editor. | Rulings, 22 |
| P222 | M6c's e2e scenarios seed households through `tests/e2e/support/plan-seed.ts`: the second member signs up in a request context of their own, plan writes carry `If-Match`, splits are EXACT, and the household is kept in a `WeakMap` keyed by the World. | Rulings, 23 |
| P223 | Dependency-cruiser excludes every test file (`.test.ts`, `.test.tsx` and `.test.mjs`), so a chart's test may import the chart file directly. | Rulings, 24 |
| P224 | `periodName` moves to `src/shared/ui/time/period-name.ts`, and `usePeriodText` and `PeriodSwitcher` join `src/shared/ui`, because three modules name periods. | Rulings, 25 |
| P225 | The interface icons gain `chart` (the Plan tab), `pencil`, `arrowUp` and `arrowDown`, with the Batch 2 artboards' paths. | Rulings, 26 |
| P226 | Unbudgeted on the line dashboard plans `$ 0` and carries no "Overspent" badge; its negative available amount is shown in the owe color. | Rulings, 27 |
| P227 | #142, #143 and #150 join M6c as nine lettered tasks: the backend first, right after Task 1 (1b–1e), and each UI task after the tasks it depends on. | Rulings, 28 |
| P228 | Rollover is HU-E6-09's, unchanged: RESET carries nothing, ROLLOVER the previous available amount floored at 0, ADJUSTED only an overspend; M6c adds no mode. | Rulings, 29 |
| P229 | `carryOver` is never part of `planned`, so "Σ planned ≤ total capacity" counts the planned amounts only and a carry cannot break it. | Rulings, 30 |
| P230 | A copy links each line to its source by `originLineId`, and the carried amount is derived on read from the origin line, never stored; only a CLOSED source carries. | Rulings, 31 |
| P231 | The line dashboard, the planner and the line editor show a carry with its source through one `CarryText` ("+$ 170.000 de septiembre 2026", or the plan it waits for), and `available` is rendered as answered. | Rulings, 32 |
| P232 | A sinking fund is a ROLLOVER line whose planned amount is the monthly saving toward a yearly bill; M6c adds no target amount, due date or "on track" figure. | Rulings, 33 |
| P233 | #142's check runs in the browser over the line dashboard that the record form's container reads on the server, so Save still sends its one request; a preview endpoint and a debounced preview call were rejected. | Rulings, 34 |
| P234 | `GET …/reports/lines` answers `categoryLines` for every live category, computed by budgeting's own `lineForCategory` and `rolledUpCategory`; a SAVINGS line is never checked. | Rulings, 35 |
| P235 | The warning's budget is planned + carry-over and its level is the kernel's `lineStateOf` over what would be left: OVER asks and states the overage ("te pasarías por $ 42.300") with no percentage, HIGH (above 90 %) asks, NEAR (80 % through 90 %) is a neutral note, and below 80 % nothing shows. | Rulings, 36 |
| P236 | The check applies only to an EXPENSE in the form's own space (not a split or an edit), dated inside the loaded period, whose plan is ACTIVE and whose category feeds a non-SAVINGS line, with an amount above 0; a failed read means no check. | Rulings, 37 |
| P237 | The warning is part of the form: a note that Save names with `aria-describedby` and a confirmation panel whose heading takes focus, with "Guardar de todos modos" and "Revisar el monto"; a change of amount, category or date asks again. | Rulings, 38 |
| P238 | `GET /api/v1/me/cash-flow` (`days` 30 or 60) projects each ACTIVE recurrence's dates and every PENDING occurrence through the ledger's `listScheduledMovements` port, across the caller's current spaces, from today in their zone; nothing new is stored. | Rulings, 39 |
| P239 | A movement is the caller's when it debits or credits an account they own; a fund-paid bill, a guest's payment from outside the app, another member's bill and the plan's undated expected contributions are left out. | Rulings, 40 |
| P240 | The projection opens at today's available money of the personal space, moves only by counted accounts, places a movement due before today on today, answers each date's balance, the totals and the lowest balance, flags CONFIRM amounts as estimates and leaves other currencies out. | Rulings, 41 |
| P241 | The calendar is the personal Plan tab's Próximos view at `…/plan/calendar` (`?days=60` for the longer window), with numeric dates, PENDING and estimate badges and an empty state; it is a Server Component with no client island, and a shared space has none. | Rulings, 42 |
| P242 | P221's routes gain `/spaces/:id/plan/calendar` at 190 KiB; the record routes keep their budgets with the line warning, and every new screen and state joins the layout spec and the light and dark axe scans (amends P221). | Rulings, 43 |
| P243 | A line carries only from the CLOSED plan it was copied from, and only from its origin line there; before the source closes it carries 0 and names the plan it waits for, and both line DTOs answer `carryOverFrom` (amends P15). | Rulings, 44 |
| P244 | The line dashboard answers each line's `state` (OK, NEAR from 80 %, HIGH above 90 %, OVER with `overBy`) from the kernel's `lineStateOf` over planned + carry-over, which the record form's preview also applies; no M6c screen writes a share above 100 %. | Rulings, 45 |
| P245 | The calendar projects only known future items: a one-off expense moves today's opening and adds no date, and there is no pace-based estimate. | Rulings, 46 |
| P246 | Every calendar date is a `LocalDate`, today is the caller's local date, and the UI formats `YYYY-MM-DD` without a `Date`, so "2027-03-15" reads 15/3/2027. | Rulings, 47 |
| P247 | No M6c flow records money in bulk: the calendar has no action, and any later bulk flow first shows a summary of what it will record and asks for confirmation. | Rulings, 48 |
| P248 | Closing a plan is refused with 409 `SourcePlanOpen` (`sourcePeriod`) while the plan it was copied from is ACTIVE and one of its lines carries over from it (ROLLOVER or ADJUSTED, with an origin line), so a CLOSED plan's figures never move when its source closes later; a DRAFT source does not block, and the planner shows the refusal. Ruled during execution. | Execution, Tasks 1e (`8b0634b`) and 4 |

**M6c amendments and execution notes.** These came up while M6c was built. They take no P number: each amends a ruling above or records what shipped beyond the plan.

| Amends | Note | Where |
|---|---|---|
| P221, P242 | **Budgets from measurements.** Since #141 cut about 17 KiB from every route, P221's caps sit far above what the Plan routes weigh, so each budget is its Lighthouse median of five runs plus 3 KiB, never above its cap, measured on 2026-10-22 with the perf household's six-plan chain (2026-05 to 2026-10, October ACTIVE): the shared `/plan` 157 KiB (budget 160), members and fund 156 (159), by group 158 (161), trend 257 (260), the planner and capacities 164 (167), and the line editor, new and existing, 179 (182); the personal `/plan` 157 (160), lines 157 (160), by group 158 (161), trend 257 (260) and the calendar 156 (159). Recharts' chunk measures about 100 KiB (the trend routes over their siblings), under the 130 KiB that would have put hand-drawn SVG to the owner. The two `/plan` routes, budgeted at their caps (190 and 195) by Task 3b, were lowered the same way; the personal Lines view (`/spaces/:id/plan/lines`, P200) is budgeted too, so fourteen Plan routes are measured. The record routes stay within their budgets with the line warning (`/spaces/:id/new` and `/spaces/:shared/new` 186 of 187 KiB). LCP, CLS and TBT are unchanged (Plan routes' LCP 1.8–2.4 s). No budget was raised. | Task 18 |
| — | Next.js 16.4.0 was upgraded to 16.4.2 (2026-10-22), which fixes GHSA-2464-fhr4-w9xw (critical, the Image Optimization API with SVG) and GHSA-p3m5-59mp-jv5r (high, a Server Actions denial of service), both affecting 16.0.0 to 16.4.0. See [stack versions](../stack-versions.md). | #160 |
| P119, P244 | `ui-talks-only-to-the-api` in `.dependency-cruiser.cjs` allows a fourth kernel file to UI code, `src/shared/kernel/line-state.ts`, so the record form applies the API's own `lineStateOf` instead of a copy of it. | Task 3c |
| P200 | The Plan tabs row (`reporting/ui/plan-tabs.tsx`) has `scroll-px-4`, so a tab scrolled into view stays clear of the screen edge whether or not its offset is a whole pixel. | Task 15 |
| P202, P223 | The two rules as built: `recharts-only-in-charts` lets only `src/modules/reporting/ui/charts/*-chart.tsx` import `recharts`, the `lazy-*-chart.tsx` wrappers excepted, and `charts-load-lazily` fails any static import of those chart files, so the lazy wrapper is the one chart-named file a page imports. | Task 14a |

### Post-milestone follow-up rulings (P249–P255)

Execution rulings made while closing follow-up issues after their milestone shipped. Each lives in the Self-Review of the plan whose follow-up it resolves, or in the note of the backlog story it amends.

| P# | Ruling | Where |
|---|---|---|
| P249 | Report latency (M4 follow-up 2, issue #128) is bounded and pinned by read-count tests, not a wall-clock figure: the line trend at `periods=24` over a 30-plan ROLLOVER chain reads each plan once (O(window + chain), no duplicate computation under the `Promise.all` fan-out), and the unified view and spending by group read each space once. No report figures are cached (D7 stands). Its wall-clock addendum, `pnpm perf:reports` (a manual probe outside `pnpm test`), measured a worst p95 of about 0.25 s (line trend and line dashboard at the end of a 24-plan ROLLOVER chain, 300 expenses per period). | M4 plan Self-Review, Follow-up 2 (`3378a93`) |
| P250 | Activating a DRAFT plan is refused with 409 `CopyAlreadyClosed` (`copyPeriod`) while a plan copied from it is already CLOSED and carries over from it (the mirror of P248), so a CLOSED copy's frozen 0 carry never jumps when its DRAFT source is later activated and closed; an all-RESET or not-yet-closed copy does not block. | E6-budgeting.md HU-E6-07, issue #158 |
| P251 | Activating a plan and closing its copy serialize (issue #183): activation locks every copy of the plan FOR SHARE (`lockCopiesOf`, any status, oldest first) after its own version lock, so it waits for a close of a copy in progress and then refuses with `CopyAlreadyClosed`, and a close that starts meanwhile waits at the copy's version lock and then refuses with `SourcePlanOpen`. A close still reads its source without a lock, so the two never wait on each other's plan in opposite order. | E6-budgeting.md HU-E6-07, issue #183 |
| P252 | Observability as built (issue #62): one access log line per answer, with `route` written as its template so path ids and tokens never reach the log; unhandled errors log their stack frames, never the message's parameters; `GET /api/v1/health` answers 503 `db: unreachable` when `SELECT 1` fails; `LOG_LEVEL` is honoured; and the JSON console adapter stays, with no pino. | E8-hardening-and-later.md HU-E8-02, issue #62 |
| P253 | An account answer keeps `icon`, `includeInAvailable` and `includeInNetWorth` as the effective values and adds `stored` (the same three as stored, `null` meaning the type's default) and `defaults` (the type's), as HU-E1-15's preferences do; the account form shows "Predeterminado" while a value is stored as `null` and offers "Restablecer" (`PATCH … null`) otherwise. The change is additive: no existing field changes meaning. Rejected: the UI deriving the defaults from the type (a second copy of P50's and P51's tables, which the UI may not import from the domain). | E2-accounts.md issue 169, issue #120 |
| P254 | The categories screen as built (issue #72): `/spaces/{spaceId}/categories` from Avatar › Categorías, read-only for every role but OWNER and ADMIN; the "Manage" entry of the expense form's picker is left to HU-E9-12; Gastos and Ingresos tabs as the pickers split groups; every change shows from the API's answer with no client read (P127), and the sheets load on the first tap (budget 168 KiB); delete and archive ask first and `CategoryInUse` offers "Archivar en su lugar"; the archived section lists archived categories and subcategories of live groups, never archived groups; the story's quick symbols win over the artboard's; the emoji library has 64 labelled emoji in eight UI-only sections; `ChoiceGroup` gains the `tiles` and `swatches` layouts. | E9-web-ui.md HU-E9-04, issue #72 |
| P255 | Shared money is never framed as a debt in the base Spanish (issue #157, amends P173's words). A net reads "te toca poner" or "te toca recibir", or "le toca poner" or "le toca recibir" for a member. A suggestion reads "{payer} le paga {amount} a {receiver}", and settled reads "al día" ("Todos están al día"). `OutstandingBalance` explains the zero-balance rule for leaving, removing someone and archiving. "paz y salvo" stays until HU-E8-19 (#180) moves it to `es-CO`. "Debes hoy" for a credit card is a real debt and stays. English is unchanged. | Issue #157 |

### Preflight notes and findings

Preflight notes (N1–N6 and the like) and findings (B1–B12) are not rulings. They appear inside the plans where they were applied; M3-D's B3 is recorded in its Execution rulings section.

## Earlier plans (M0–M2c)

These plans predate the P numbering. Their decisions are numbered lists in the Self-Review of each plan, not rulings with an ID.

| Plan | What it records |
|---|---|
| [M0 walking skeleton](../plans/2026-10-11-m0-walking-skeleton.md) | No numbered decisions. It carries the two ADRs above and the global constraints of the skeleton. |
| [M1 personal ledger](../plans/2026-10-12-m1-personal-ledger.md) | "Spec open questions and assumptions": 15 gaps found while planning, each with the assumption its task makes. |
| [M2-A shared spaces](../plans/2026-10-13-m2a-shared-spaces.md) | "Spec contradictions found" (5) and "Assumptions" (17). |
| [M2-B shared expenses](../plans/2026-10-13-m2b-shared-expenses.md) | "Spec contradictions found" (10) and "Assumptions" (13). |
| [M2-C member lifecycle](../plans/2026-10-14-m2c-member-lifecycle.md) | "Spec contradictions found" (14) and "Assumptions" (14); assumption 4 is the controller ruling O2, and assumption 13 amends D8 (owner directive of 2026-10-14). |

### Amendments to M2-C rulings

Two follow-up issues changed what M2-C accepted or ruled. They carry no P number: they amend rulings that have none.

| Amends | Change | Where |
|---|---|---|
| O2 (no lock against concurrent money writes, assumption 4) | Issue #89 adds the lock. Leaving, removing a guest and archiving lock the space row `FOR NO KEY UPDATE` right after authorization, and every money write locks it `FOR SHARE` before it reads the membership (the order is always space row first, then member rows), so each race ends as one of its two serial orders. The space row, not the member rows, because `FOR UPDATE` on member rows conflicts with the `FOR KEY SHARE` locks the foreign keys of every insert take. | [HU-E1-08](../backlog/E1-identity-and-spaces.md), `src/modules/spaces/application/space-locks.ts` |
| O1 (a former member stays settled, Task 4b) | Issue #90 keeps the rule and lifts its dead end: a user who joins again takes back their own member row (`leftAt` cleared, new role, name and `joinedAt`), so what names that member id names a current member and can be corrected. A former member who has not joined again stays settled. | [HU-E1-07](../backlog/E1-identity-and-spaces.md) |

## UI design decisions U1–U12

UX decisions on screens, made from the Penpot design reviews. Each row's rationale and the before/after boards are in [batch2-ux-decisions.md](../design/batch2-ux-decisions.md).

| ID | Decision |
|---|---|
| U1 | Household vocabulary in the UI (Rubro, Cuánto aporta cada uno, Cada uno paga…); code and API keep the model terms. |
| U2 | One verb, "Saldar", for every settle action, and amounts never break across lines. |
| U3 | View chips are 44 px, wrap instead of scrolling, and keep one order in every space. |
| U4 | Inicio shows a one-line "Tu mes" shortcut to the unified view (1 tap). |
| U5 | The line editor collapses rollover and allocation into "Más opciones", whose summary shows the real value. |
| U6 | "Crear plan" opens a suggested plan prefilled from contributions. |
| U7 | The split editor shows every payer and method without horizontal scroll. |
| U8 | Ajustes fits one view with three summary rows. |
| U9 | The space sheet offers "Invitar" on each shared space. |
| U10 | The unified view has one hero figure. |
| U11 | The personal record form offers "Dividir con alguien". |
| U12 | Every save confirms with a toast and shows the changed state. |

## How to add a decision

- **A design-level decision** (it changes how the product behaves or how the model works) goes into the spec's decisions table in section 6 as the next `D` number, with its rationale and the alternatives rejected. Add its row to the table above.
- **A technology choice** (a library, a tool, a generator) gets an ADR in `docs/adr/`, numbered in order, with Context, Decision and Consequences. Add it to the ADR table above.
- **An execution ruling** (how a plan resolves a gap, a contradiction or an assumption) goes into the milestone plan's Self-Review, as "Ruled by the controller (P<n>)" with the next free number. Then add its line to the group of that plan above, in the same pull request.
- A milestone's pull request updates this index with its new rulings.
- **A UI design decision** (a screen's copy, layout or navigation, decided in a design review) goes into the batch's decisions file in `docs/design/` as the next `U` number. Add its row to the table above.
