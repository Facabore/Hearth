# Hearth — Design Spec

- **Status:** Approved 2026-10-11 (living document: refined as delivery progresses)
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

- A household can define a monthly plan like the reference example (section 4) in under 5 minutes, reusing the previous period's plan.
- Recording a shared expense charges the right budget line and produces the correct inter-member balance without manual calculation.
- Each member sees, per category and per month: assigned, contributed, consumed, and the gap.
- Each member sees one unified personal view: personal expenses plus their share of every shared expense.

### Non-goals (v1)

- Bank synchronization, OCR receipts, investment market data and brokerage sync (an `INVESTMENT` account's ledger balance is in scope, HU-E2-05), multi-currency conversion, native mobile apps.
- Strict double-entry accounting (see decision D3).

## 3. Users and context

- Self-hosted on a VPS by the owner. Small number of users (a household, a few friends' groups).
- Primary locale es-CO, currency COP. es-CO's formats (`1.234.567,89`, a 24-hour clock, day-month-year dates, weeks from Monday) are the built-in defaults of the installation rules, which each user may override; the interface language never sets them (HU-E1-15, D23). Each user has their own time zone; America/Bogota is the deployment default (`APP_TIMEZONE`), which also drives the space-level clocks (the recurrence scheduler, closing a plan). Code, identifiers and docs in English; UI i18n-ready (es, en).

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
| Period | Which month does it count in? | `Period` (derived from the transaction's local date + space period settings; its time of day never moves it) |

### 5.1 Bounded contexts (modules)

| Module | Responsibility | Key entities |
|---|---|---|
| `identity` | Users, authentication, sessions | User |
| `spaces` | Personal, shared and direct spaces; members (registered or guest), roles, invitations, guest claims | Space, SpaceMember, Invitation |
| `accounts` | Where money lives | Account |
| `ledger` | Expenses, incomes, transfers, settlements | Transaction, Payment, Share |
| `categories` | Customizable hierarchical categories per space | CategoryGroup, Category |
| `budgeting` | Monthly plans, lines, allocations, rollover | BudgetPlan, MemberCapacity, BudgetLine, Allocation |
| `balances` | Who owes whom inside a shared space | (read model) Balance, SettlementSuggestion |
| `reporting` | Dashboards and unified personal view | (read models) |

### 5.2 Entities

**User** — id, name, email, locale, timezone, numberFormat, timeFormat, dateFormat, weekStart. `timezone` is an IANA zone, taken from the browser at sign-up (`APP_TIMEZONE` when it is missing or unknown) and changed with `PATCH /api/v1/me`. It decides "today" and the time of what the user records; changing it never moves recorded transactions. `locale` (`es` | `en`) is the interface language, also changed with `PATCH /api/v1/me`.
- **Formats (HU-E1-15, D23):** `numberFormat` (`DOT_COMMA` `1.234.567,89` | `COMMA_DOT` `1,234,567.89` | `SPACE_COMMA` `1 234 567,89`), `timeFormat` (`H24` | `H12`), `dateFormat` (`DMY` | `MDY` | `YMD`) and `weekStart` (`MONDAY` | `SUNDAY`), each nullable: null follows the installation rule. The effective value is the rule when the installation locks the field, otherwise the stored value, otherwise the rule; a lock never deletes a stored value, and a locked field refuses every change (`PreferenceLocked`). Until stored rules exist (HU-E8-18), the rules are built in: es-CO's formats and no lock. Formats never derive from `locale`, and the API's wire forms (minor-unit amounts, `YYYY-MM-DD` dates, RFC 3339 instants) never depend on them.

**Space** — id, name, kind (`PERSONAL` | `SHARED` | `DIRECT`), currency, periodPolicy, archivedAt. Every user gets exactly one personal space on sign-up. A `DIRECT` space (D16) has exactly two members, is created implicitly the first time a user splits with one specific person, is named after both ("Ana & Pedro"), and is reused for later splits with that person. The other person is either a registered user the creator already shares a space with, or a new guest (who can later claim). Both members of a direct space are OWNER. If a guest in a direct space claims and the two users already had another direct space, both are kept (merging is deferred).

**PeriodPolicy** (value object, D14) — cadence + anchor days, chosen per space:
- `MONTHLY(day)`: one period per month starting on `day` (1–31), like a statement cut-off date. If a month is shorter, the period starts on its last day (day 31 → 28/29 Feb, 30 Apr).
- `SEMI_MONTHLY(day1, day2)`: two periods per month starting on `day1` and `day2` (1 ≤ day1 < day2 ≤ 31, same clamping). Default anchors 1 and 16; any pair is allowed (e.g. 5 and 20).
- Default: `MONTHLY(1)`. `WEEKLY` and `BIWEEKLY` are deferred (Won't-v1) but the value object is open to them.

**SpaceMember** (D15) — id, spaceId, kind (`USER` | `GUEST`), userId (null for guests), displayName, contactEmail (optional, guests only), role (`OWNER` | `ADMIN` | `MEMBER` | `VIEWER`; guests have no role and cannot sign in), joinedAt, leftAt, claimedAt.
- Every money reference (payments, shares, capacities, allocations, settlements, balances) points to a **SpaceMember**, never directly to a User. Guests therefore take part in every flow exactly like registered members.
- A guest exists only inside its space: "Pedro" in Household and "Pedro" in a trip space are two unrelated guests.
- Any member with role `MEMBER` or above can add a guest, record expenses and settlements on a guest's behalf, and remove a guest whose balance is zero.
- Guests never join `PERSONAL` spaces.
- Guests have no accounts, so their money movements have no account: a guest payment, settlement or fund contribution is recorded with `accountId = null` ("outside the app"). Guests have no income or personal finances; their capacity is entered manually like anyone's.
- **Claim:** an OWNER or ADMIN can create a claim link for a guest (shareable, not bound to `contactEmail`). Accepting it while signed in (new or existing account) sets `userId`, switches `kind` to `USER` with role `MEMBER`, and keeps the same SpaceMember id, so all history stays attached. A user who is already a member of that space cannot claim another guest in it. Claims are per space.

**Account** — id, spaceId, name, type (`CASH` | `BANK` | `WALLET` | `CREDIT_CARD` | `SAVINGS` | `INVESTMENT` | `LOAN` | `OTHER` | `SHARED_FUND`), ownerUserId (null for shared accounts), openingBalance, archivedAt. A personal account belongs to the user's personal space; a `SHARED_FUND` account belongs to a shared space. The type never changes.
- Common optional attributes on every type: institution, lastFour (exactly four digits; a full card or account number is never stored), color (a palette key) and icon (an allow-listed name; null means the type's default).
- Type-specific terms, optional, refused on any other type (`AccountAttributeNotAllowed`): `CREDIT_CARD` creditLimit, cutOffDay and paymentDay (1–31, clamped to the month's last day like `PeriodPolicy`) and monthlyRate; `SAVINGS` annualRate and, for a term deposit (CDT), termDays and maturityDate together; `LOAN` principal, annualRate and termMonths. Derived on read: available credit (limit + balance), the next cut-off and payment dates on or after the requesting user's today, the equivalent rates (`EA = (1 + i_m)^12 − 1`) and a term deposit's start date.
- Switches `includeInAvailable` and `includeInNetWorth` (D21), null meaning the type's default: CASH, BANK, WALLET and SHARED_FUND count in both; SAVINGS, INVESTMENT, CREDIT_CARD, LOAN and OTHER in net worth only.
- Liabilities (`CREDIT_CARD`, `LOAN`) carry negative balances for the money owed, so a signed sum is assets minus debts.

**Transaction** — id, spaceId, type, description, date, occurredAt, timeZone, categoryId (nullable for transfers and settlements), amount (minor units), currency, createdBy, deletedAt.
- **Time (D19):** `date` is the local calendar date the transaction counts in (periods, plans, balances `asOf`, budgets, reports). `occurredAt` is the UTC instant it happened; `timeZone` is the IANA zone of the user who recorded it (`createdBy`, never the payer or the space), set exactly when `occurredAt` is. With `occurredAt`, `date` is its local date in `timeZone`. Every transaction a person records has a time: a date alone takes the current time of day in the zone, and `occurredAt: null` answers `TimeRequired`. Only recurring occurrences (automatic or confirmed), imports and rows older than M3-D have no time, until someone edits one in; a time is then replaced, never removed. `occurredAt` only orders and displays; no boundary ever reads it.
- **Space ownership rule (D9):** a transaction belongs to the space whose budget and balances it affects. Its source accounts may live in a member's personal space, provided the account owner is a member of the transaction's space and is the paying member. A fund contribution belongs to the shared space (its destination). Other members see the paying member's name, never the details of their personal account.
- `EXPENSE`: one or more `Payment` rows (the v1 API accepts several payers; the v1 web UI offers one) and one or more `Share` rows. Σ payments = Σ shares = amount.
- `INCOME`: destination account + receiving member.
- `TRANSFER`: source account → destination account. A transfer from a personal account to a `SHARED_FUND` account is a **fund contribution**.
- Paying a credit card is a `TRANSFER` from the paying account to the card: no category, never spending, never split (D21). The purchase is the expense, on its date and with its category; interest and fees are new expenses when they are charged.
- `SETTLEMENT`: member A pays member B to clear balance; optional accounts.

**Payment** — transactionId, memberId (nullable), accountId (nullable), amount. `memberId` is null if and only if the payment comes from a `SHARED_FUND` account. `accountId` is null if and only if the payer is a guest (guests have no accounts; the money left their pocket outside the app). For registered payers, the account must be owned by that member's user.

**Share** — transactionId, memberId, amount, splitMethod snapshot (`EQUAL` | `PERCENT` | `EXACT` | `SHARES` | `BY_ALLOCATION`).

**Recurrence** — id, spaceId, template (transaction type, amount or estimated amount, category, payer SpaceMember or fund, account, and a split by ratios, `EQUAL`, `PERCENT` or `SHARES`, or none, which takes the default split of each occurrence), schedule (same anchor rules as `PeriodPolicy`: MONTHLY(day) or SEMI_MONTHLY(day1, day2), clamped), mode (`AUTO` records the transaction on its date; `CONFIRM` creates a pending occurrence that a member confirms with the real amount or skips), startDate, endDate, pausedAt. Occurrences are idempotent per (recurrenceId, date); missed runs are caught up, from the day the recurrence was defined and never across a pause; occurrences in a CLOSED period are skipped. `BY_ALLOCATION` is resolved with the plan of each occurrence's period. Every AUTO occurrence is recorded on behalf of the member who defined the recurrence, and a pending one on behalf of the member who confirms it, through the same use cases a member calls. An edit applies to every occurrence not recorded yet, an overdue date no run has considered included; recorded occurrences keep their snapshot. A schedule change never creates a date before the day it is made, nor a second occurrence in the slot of the last one (a calendar month for MONTHLY, a half of one split at the second anchor for SEMI_MONTHLY): the new schedule is due from the later of that day and the start of the next slot. The type, payer and accounts never change. (Amended 2026-10-16, M3-C rulings P21–P24 and the final review's I1 ruling.) Occurrences are recorded with their date and no time (D19).

**CategoryGroup / Category** — per space, seeded from defaults, renamable and archivable, at most three levels: group → category → optional subcategory (D20). A subcategory (`parentCategoryId`) is always in its parent's group and moves with it; a subcategory never has subcategories, and a category with subcategories never becomes one (`CategoryDepthExceeded`). Names are unique among siblings (the same parent, or the same group for categories). Subcategories have no catalog key and are never seeded. A seeded group has an immutable catalog `key` too, stable across spaces and renames like a category's (`housing`, `food`, `transport`, `health`, `leisure`, `income`); groups users create have none, no rename, move or archive changes a key, and at most one group per space holds a given key. Archiving a group archives its categories, and archiving a category archives its subcategories; a subcategory is restored only while its parent is not archived (`ParentCategoryArchived`). A category nothing references can also be deleted, logically (`deleted_at`, D8): the row stays, it leaves every list and lookup, and its name is free again; a referenced one, or one with live subcategories, is archived instead (`CategoryInUse`). Groups are archived, never deleted. Every group and category has an icon, one of a fixed set of 58 symbols or exactly one emoji (one grapheme: a ZWJ sequence or a skin tone counts as one), and a color, one of sixteen palette keys (D22); a category created without them copies its group's at creation, and a group created without them takes `tag` in `GRAPHITE`. A subcategory has no style of its own: it always shows its parent's, and keeps a copy of it when it becomes a category. Seeded groups and categories take their default style by catalog key (HU-E3-01, HU-E3-05); a seeded category takes its group's color:

| Seeded group | Key | Icon | Color | Its categories' icons, by catalog key |
|---|---|---|---|---|
| Housing | `housing` | `home` | `INDIGO` | `rent` → `key`, `utilities` → `bulb`, `maintenance` → `wrench` |
| Food | `food` | `apple` | `SAND` | `groceries` → `cart`, `restaurants` → `fork` |
| Transport | `transport` | `car` | `STEEL` | `fuel` → `fuel`, `public_transport` → `bus` |
| Health | `health` | `heart` | `ROSE` | `medical` → `cross`, `pharmacy` → `pill` |
| Leisure | `leisure` | `ticket` | `PLUM` | `entertainment` → `tv`, `travel` → `plane` |
| Income | `income` | `coins` | `PINE` | `salary` → `briefcase`, `other_income` → `gift` |

**BudgetPlan** — spaceId, label, startDate, endDate, status (`DRAFT` | `ACTIVE` | `CLOSED`), createdFrom (previous plan or template). One plan per period, so a semi-monthly space has two plans per month and capacities are per period. Boundaries are stored when the plan is created, so changing the period policy only affects periods without a plan yet; history never moves (D10). If a policy change would make a new period overlap an existing plan, the new period starts the day after that plan ends.

**MemberCapacity** — planId, memberId, amount. When a registered member sets their own capacity, the app suggests the sum of income they recorded in the previous period (D17); the suggestion is computed only for that member and never shown to others, and only the saved amount is shared. Sum = total capacity.

**BudgetLine** — planId, originLineId (the line it was copied from, for rollover), name, plannedAmount, funding (`DIRECT` | `SHARED_FUND` | `SAVINGS`), savingsAccountIds[] (only for `SAVINGS`), rolloverMode (`RESET` | `ROLLOVER` | `ADJUSTED`), isCatchAll, categoryIds[]. Only categories are mapped, never subcategories (`SubcategoryNotMappable`); a category maps to at most one line per plan, and its subcategories' expenses count where it is mapped (D20). At most one line per plan is the catch-all; unmapped categories consume it. Without a catch-all line, unmapped categories fall into an implicit "Unbudgeted" line. Adding or editing a line that would push Σ plannedAmount above total capacity is rejected; a plan whose capacity was later reduced below Σ plannedAmount cannot be activated.

**Allocation** — lineId, memberId, value. The line carries the rule (`PROPORTIONAL` by default, `PERCENT`, `FIXED` or `NONE`); only `PERCENT` and `FIXED` lines have member rows, so a new member of the space is covered by a proportional line without new rows. Assigned amount per member is derived. (Amended 2026-10-14, M3-A ruling P1.)

### 5.3 Periods, money and rounding

- **Period label:**
  - `MONTHLY`: named after the month that contains most of its days. With an anchor day ≤ 15 that is the start month; otherwise it is the following month (25 Sep – 24 Oct is "2026-10").
  - `SEMI_MONTHLY`: named after the start date's month plus the half: "2026-11 H1" (starts on day1) and "2026-11 H2" (starts on day2).
- **Comparisons and trends** compare a period with the previous period of the same policy, not with the calendar month.
- **Money:** stored in ISO 4217 minor units. Each currency also has a *rounding unit* for splits and allocations (COP: 1 peso = 100 minor units), so amounts never show cents.
- **Rounding:** splits and allocations use largest-remainder rounding in rounding units; ties go to members in membership join order. Σ parts always equals the total exactly.
- **Default split:** expenses that resolve (through their category, or a subcategory's parent, by mapping or catch-all) to an allocated line of an `ACTIVE` plan default to `BY_ALLOCATION`; all other expenses, including those in `NONE` lines, default to `EQUAL` among active members. `DRAFT` plans never drive splits. The member can always override the split.

### 5.4 Derived metrics (computed on read, never stored)

For a line L, member m, period P:

- `assigned(m)` = from Allocation rule.
- `spent(L)` = Σ amount of EXPENSE transactions in P whose category, or whose subcategory's parent, maps to L. For `SAVINGS` lines: Σ transfers in P into the line's savings accounts.
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

Accounts, per space, at a date (HU-E2-07, D21): `available` = Σ balance(a) over the space's active accounts with `includeInAvailable`; `netWorth` = Σ balance(a) over those with `includeInNetWorth`. Balances are the computed, signed ones (opening balance + movements up to the date). A personal space totals its owner's accounts and a shared space its shared funds; spaces never mix.

Unified personal view for user u (D11). It works through every SpaceMember row linked to u, including history recorded while u was a guest before claiming:

- **Period:** u's personal-space period; shared transactions are placed by date into it.
- **Grouping:** by category catalog key. Categories seeded from the default catalog carry a stable `key` shared across spaces; custom categories group under "space / category". A subcategory groups under its parent category.
- **Consumption:** personal-space expenses + u's shares in every shared space.
- **Cash out:** Σ payments by u + Σ fund contributions by u + Σ savings transfers by u. Movements without an account (recorded while u was a guest) are included and labelled "outside the app".

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
| D8 | Every delete is logical: transactions set `deletedAt`, categories `deleted_at`, members `left_at`; accounts and spaces are archived; invitations are revoked. The audit keeps the full history of edited parts: an expense's payment and share rows hold its current version, every edit records the parts before and after, and a deletion records the whole last version. Audit fields on every write. Physical deletes only for technical data: expired idempotency keys, and the sign-up compensation that removes a half-created user who never finished provisioning | Shared money needs traceability; nothing a member recorded is ever lost | Hard delete; versioned payment and share rows (every balance and balance-sheet query would have to pick the current version) |
| D9 | A transaction belongs to the space it affects; source accounts may be a paying member's personal accounts | Paying a shared expense from my own bank is the common case | Forcing shared accounts for every shared expense |
| D10 | Plan boundaries are stored, not recomputed | Changing the period start day must never move closed history | Derive every period on read |
| D11 | Unified view uses the personal period and a shared category catalog key | Spaces can differ in period and categories; the user needs one consistent picture | Per-space views only |
| D12 | Allocation rules are group-size agnostic (proportional, percent, fixed) and one rule per line | Works for couples, roommates or larger groups without special cases | Rules tied to a fixed number of members |
| D13 | Allocation is optional per line, and a plan may designate one catch-all line | Some group money (e.g. Free) is shared without per-person responsibility and absorbs whatever does not fit elsewhere | Mandatory allocation; implicit Unbudgeted bucket only |
| D14 | Period policy is selectable per space: monthly with any cut-off day (1–31, clamped) or semi-monthly with two anchor days | Households budget around paydays (cut-off date, quincena), not only calendar months | Fixed calendar months; start day limited to 1–28 |
| D15 | Guest members scoped to one space; all money references point to SpaceMember; guests can claim their place by registering | Not everyone will sign up; guests must still pay, owe and be budgeted like anyone else, and history must survive registration | Requiring registration; global contacts shared across spaces |
| D16 | Splitting with one person creates or reuses a two-member `DIRECT` space | Keeps one ledger model (D2) while supporting quick one-to-one splits | A separate "friend balance" model outside spaces |
| D17 | Capacity is suggested from the member's own previous-period income, privately, and is always editable | Saves typing without leaking personal income to the group | Auto-filling capacity visible to all members |
| D18 | Next.js is the BFF of a modular monolith; the versioned HTTP API is the primary contract and the backend is built first | One deployable on a VPS, API ready for future clients, modules extractable later; UI can follow per area once its API is done | Separate backend service with Next.js as a pure proxy (extra deployable, network hop, auth propagation) |
| D19 | A transaction keeps its local date, plus a UTC instant and the recorder's IANA zone; every transaction a person records has a time (a date alone takes the current time of day), and only recurring occurrences, imports and rows older than M3-D have none | Periods and reports keep the date they count in, lists show what happened when, nothing moves when someone travels or changes zone, and no one's own record sorts as untimed | One timestamp per transaction with the date derived on read (history moves with a zone change); midnight back-filled for old rows (fake times); a "no time" choice when recording (each day would mix untimed records with timed ones) |
| D20 | One optional subcategory level; budgets, splits, filters and reports roll subcategories up into their category | Detail when a member wants it, while plans keep mapping a handful of categories | Unlimited depth; tags or split lines instead of a third level |
| D21 | Each account has two switches, available and net worth, with defaults by type; a card payment is a transfer, never spending | Members choose what "Disponible" means without new account kinds, and nothing counts twice | Fixed rules per type; recording a card payment as an expense |
| D22 | Category groups and categories carry an icon (a fixed symbol or one emoji) and a color that is one of sixteen palette keys, never a hex value; subcategories derive their parent's icon and color | Light and dark themes map each key to their own tokens, and a subcategory always looks like the category it rolls up into | Free hex colors or uploaded images; a copied style per subcategory that drifts from its parent |
| D23 | Number, time and date formats and the first weekday are four profile preferences, null meaning "follow the installation rule", and never derive from the language | A person can read Spanish with `1,234.56` or a 12-hour clock if that is what they are used to; the rules and locks of a white-label installation (HU-E8-18) plug in behind one port without touching the profile | Formats taken from the locale (`es` → `1.234,56`); concrete values copied onto each profile at sign-up (a later change of the default would never reach anyone) |

## 7. Architecture

Modular monolith, hexagonal (ports and adapters) with screaming, module-first structure. SOLID throughout. The domain does not import Next.js, the ORM, or any I/O library.

**Next.js is the Backend For Frontend (D18).** A single deployable hosts the versioned HTTP API, the server actions and the web UI. The HTTP API is the primary contract; server actions and future clients (mobile, scripts) are thin callers of the same use cases. Each module can later be extracted into its own service because it only talks to others through application ports.

```
src/
  app/
    api/v1/                    # route handlers: parse with contract -> call use case -> map Result to HTTP
    (web)/                     # pages and server actions (thin wrappers over the same use cases)
  modules/
    <module>/
      domain/                  # entities, value objects, domain services, domain errors (pure TS)
      application/             # use cases (one class/function per use case), ports (interfaces), DTOs
      contracts/               # Zod request/response schemas; source of the OpenAPI document
      infrastructure/          # driven adapters: repositories (Drizzle), mappers, external services
      ui/                      # module-specific React components (presentational + containers)
  shared/
    kernel/                    # Money, PeriodPolicy, Result, Id, DomainEvent, Clock port
    http/                      # auth guard, DomainError -> problem+json mapping, pagination, idempotency
    infrastructure/            # db client, transaction manager, logger
  composition/                 # composition root: wires ports to adapters per request
```

Dependency rule: `app → application → domain`; `infrastructure → application/domain`. Enforced by lint rules (dependency-cruiser or eslint-plugin-boundaries) in CI.

Use cases return `Result<T, DomainError>`; route handlers map results to HTTP responses and server actions map them to UI state. Validation at the edge with Zod; invariants inside entities.

### HTTP API conventions

| Concern | Convention |
|---|---|
| Base path and versioning | `/api/v1`; breaking changes require `/api/v2` |
| Style | Resource-oriented REST, JSON, money as `{ "amount": "160000000", "currency": "COP" }` (minor units as string to keep `bigint` precision) |
| Contracts | Zod schemas per module in `contracts/`; the OpenAPI 3.1 document is generated from them and served at `/api/v1/openapi.json` |
| Authentication | Session cookie for the web; Bearer token for other clients (Better Auth); both resolve the same user |
| Authorization | Always in use cases (SpaceMember + role), never only in handlers |
| Errors | RFC 9457 `application/problem+json` with a stable `code` and `requestId`. The code is the domain error name, or one of the edge codes `ValidationFailed` (422), `Unauthenticated` (401), `InvalidCredentials` (401), `EmailTaken` (409), `PasswordTooShort` (422), `PreconditionFailed` (412), `InternalError` (500); the UI translates codes, the API never returns translated text |
| Idempotency | `Idempotency-Key` header accepted on every POST that creates a transaction (expense, income, transfer, fund contribution, settlement, direct split) or a recurrence; a replay returns the original response, the same key with a different payload returns 409 |
| Pagination | Cursor-based (`?cursor=&limit=`), default 50, max 200 |
| Dates, times and rates | Local dates as `YYYY-MM-DD`; instants as RFC 3339, accepted with any offset and returned in UTC (`Z`); time zones as IANA names; rates as percent decimal strings with at most four decimals (`"2.0"`, `"28.59"`), returned with exactly four (`"2.0000"`) |
| Transaction lists | Newest day first, then newest time, untimed items last in their day, then newest recorded, then id; the cursor carries that position |
| Profile | `GET /api/v1/me` returns the user with their `timezone`, `locale` and `preferences` (`stored`, `effective` and `defaults`, each with the four formats, and the names of the `locked` fields); `PATCH /api/v1/me` changes `timezone` (`InvalidTimeZone`, 422), `locale` and the four formats: an omitted field is unchanged and `null` returns a format to the rule; a locked field answers `PreferenceLocked` (409) |
| Concurrency | `ETag` / `If-Match` on updates of transactions and plans; mismatch returns `412` |
| Observability | `X-Request-Id` propagated to logs |

### Stack

| Concern | Choice |
|---|---|
| Framework | Next.js (latest stable, App Router, React Server Components, Server Actions), TypeScript strict |
| Database | PostgreSQL |
| Data access | Drizzle ORM + drizzle-kit migrations (SQL-first control for reporting aggregates) |
| Auth | Better Auth (email + password, Bearer plugin), self-hosted, behind the `AuthProvider` and `SessionResolver` ports; Keycloak as an external OIDC provider is deferred (HU-E8-10) |
| Validation | Zod |
| API contract | OpenAPI 3.1 generated from Zod contracts (generator chosen at bootstrap, e.g. zod-openapi) |
| UI | Tailwind CSS + shadcn/ui; container-presentational pattern; atomic design for shared components |
| Charts | Recharts |
| i18n | next-intl (es default, en) |
| Unit / integration tests | Vitest; a disposable PostgreSQL container started through the Docker CLI |
| API acceptance | HTTP-level tests against the running app with PostgreSQL in a disposable container |
| E2E (web UI) | Playwright (+ playwright-bdd for UI Gherkin scenarios) |
| Quality | ESLint, Prettier, boundary lint, typecheck in CI, Strict TDD |
| Package manager | pnpm |
| CI | GitHub Actions: lint, typecheck, test, build Docker image |
| Local development | Fully containerized: `compose.dev.yaml` runs PostgreSQL, a one-shot migration service and the app in dev mode with the source bind-mounted; host Node.js is optional |
| Deploy | Docker Compose on VPS: app + PostgreSQL + Caddy (automatic TLS); nightly `pg_dump` backups |

Exact versions are pinned at bootstrap (story E0) to the latest stable releases.

## 8. Error handling

- Domain errors are typed (`InvalidAllocation`, `SharesDoNotMatchAmount`, `NotASpaceMember`, `PeriodClosed`, `InsufficientRole`, `OutstandingBalance`, `AlreadyMember`, `MemberNameTaken`, `DirectSpaceIsFull`, `GuestAlreadyClaimed`, ...; the backlog is the full catalogue) and returned via `Result`, never thrown across layers.
- Authorization is checked in application use cases (membership + role), not only in UI.
- Domain errors map to HTTP statuses in one place (`shared/http`): unauthenticated 401, validation 422, not found 404, insufficient role 403, conflicts and invariant violations 409, closed period 409, precondition failed 412, an instant and a date that disagree 422 (`DateTimeMismatch`), a transaction time sent as null 422 (`TimeRequired`), a preference the installation locks 409 (`PreferenceLocked`).
- A requester who is not a member of a space gets `404 SpaceNotFound` (existence is not leaked). Referencing a non-member as payer or participant returns `422 NotASpaceMember`.
- Unexpected errors are logged with request id and surfaced as a generic `problem+json` (500).

## 9. Testing strategy

- **Domain:** exhaustive unit tests, TDD-first (allocation math, split methods, rollover, balance algorithm, period boundaries).
- **Application:** use-case tests with in-memory adapters.
- **Infrastructure:** repository tests against real PostgreSQL in a disposable Docker container.
- **Acceptance (API):** each backend story's Gherkin scenarios map to tests; `@critical` scenarios run over HTTP against the real app and database.
- **Contract:** the generated OpenAPI document is snapshot-tested so contract changes are deliberate.
- **E2E (UI):** web UI stories (epic E9) run their scenarios with Playwright.
- The reference example (section 4) is a golden test fixture.

## 10. Delivery

Work is tracked in `docs/backlog/` (epics and user stories with Gherkin acceptance criteria). Delivery is backend first (D18): stories in E0–E8 are done at API level and the web UI lives in epic E9. The backlog is mirrored to a GitHub Project. Milestones:

| Milestone | Outcome |
|---|---|
| M0 Walking skeleton | Repo, architecture skeleton, API foundation (contracts, OpenAPI, problem+json, auth, idempotency, pagination, optimistic concurrency), CI, personal space, deployed to VPS |
| M1 Personal ledger API | Accounts, categories, personal expenses and income, period queries |
| M2 Shared spaces API | Invitations, guests, direct spaces, shared expenses with split methods, balances, settlements |
| M3 Allocated budgets API | Plans, capacity, lines, allocations, default split by allocation, rollover, recurring transactions |
| M3-D Ledger refinements for the UI | Each user's time zone and formatting preferences, the time of every transaction, optional subcategories, category icons and colors, more account types with their attributes, available money and net worth |
| M4 Insight API | Member/category dashboards, shared fund tracking, unified personal view |
| M5 Hardening | Backups, observability, import from Splitwise/CSV |
| M6 Web UI | Screens for every area (epic E9); an area's UI may start as soon as its API milestone is done |

## 11. Open questions

1. ~~Where is "Free" money spent?~~ — **Resolved 2026-10-11:** Free is a shared-space catch-all line with optional allocation (section 4, D13). Personal views pick up members' shares automatically; personal-only expenses never affect the group.
2. ~~Period start day~~ — **Resolved 2026-10-11:** selectable per space via `PeriodPolicy` (monthly with cut-off day, or semi-monthly); default `MONTHLY(1)` (D14).
3. ~~Reference example percentages~~ — **Resolved 2026-10-11:** 42/58 is a custom percentage allocation for the Free line (see section 4 and D12).

Roles (guests have no role), invitation and claim rules, and the default category seed are specified in the backlog (HU-E1-05, HU-E1-06, HU-E1-10..13, HU-E3-01) and are pending owner confirmation.
