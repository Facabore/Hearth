# E6 — Budgeting

**Goal:** a household defines a plan per period (one per month by default) — member capacities, budget lines, category mappings and allocation rules — that drives default expense splits and carries over according to each line's rollover mode.

**Modules involved:** `budgeting` (with read access to `spaces`, `categories`, `ledger`; provides split defaults to `ledger`).

**Reference example (golden fixture, spec section 4):** shared space "Household", members Ana and Juan, period 2026-11 (period policy MONTHLY(1)).

| Line | Planned | Funding | Allocation | Ana | Juan |
|---|---|---|---|---|---|
| Rent | 1,200,000 COP | SHARED_FUND | PROPORTIONAL | 480,000 | 720,000 |
| Home | 1,470,000 COP | DIRECT | PROPORTIONAL | 588,000 | 882,000 |
| Savings | 600,000 COP | SAVINGS | PROPORTIONAL | 240,000 | 360,000 |
| Free | 730,000 COP | DIRECT | PERCENT 42 / 58 | 306,600 | 423,400 |

Capacities: Ana 1,600,000 COP, Juan 2,400,000 COP, total 4,000,000 COP (40% / 60%).

---

## HU-E6-01 — Create a plan for a period

- **Milestone:** M3 · **Priority:** Must · **Size:** S · **Depends on:** HU-E1-05, HU-E0-04 · **Module(s):** `budgeting`

**User story:** As a household admin, I want to create a plan for a given period of my space's period policy, so that we can budget that period.

```gherkin
Feature: Create a period plan

  Background:
    Given "Ana" is OWNER and "Juan" is MEMBER of the shared space "Household"

  Scenario: Create a draft plan
    When "Ana" creates a plan for 2026-11 in "Household"
    Then a plan with status "DRAFT" exists for 2026-11
    And its period runs from 2026-11-01 to 2026-11-30

  Scenario: Only one plan per period
    Given a plan for 2026-11 exists in "Household"
    When "Ana" creates another plan for 2026-11
    Then the result is the error "PlanAlreadyExists"

  Scenario: Member cannot create plans
    When "Juan" creates a plan for 2026-12
    Then the result is the error "InsufficientRole"

  Scenario: Personal spaces can also have plans
    When "Ana" creates a plan for 2026-11 in her personal space
    Then a plan with status "DRAFT" exists with "Ana" as its only member

  Scenario: A semi-monthly space gets two plans per month
    Given "Household" has the period policy SEMI_MONTHLY(1, 16)
    When "Ana" creates plans for "2026-11 H1" and "2026-11 H2"
    Then the plan "2026-11 H1" runs from 2026-11-01 to 2026-11-15
    And the plan "2026-11 H2" runs from 2026-11-16 to 2026-11-30
    And each plan has its own member capacities
```

**Technical notes:**
- Use case: `CreateBudgetPlan`; port `BudgetPlanRepository`. Endpoints: `POST /api/v1/spaces/{spaceId}/plans` (body: period label), `GET /api/v1/spaces/{spaceId}/plans/{planId}` (with `ETag`, HU-E0-10).
- Invariant: unique (spaceId, startDate); the period is resolved with the space `periodPolicy`, and its label, startDate and endDate are stored on the plan at creation (spec 5.2, D10).
- Authorization: the matrix action `plan.manage` (OWNER, ADMIN; in a personal space, its owner) creates and edits plans, and an archived space refuses it (`SpaceArchived`, HU-E1-09); reads are `space.read`, so an archived space still reads its plans (HU-E1-09). Errors: `PlanAlreadyExists` (409), `InvalidPeriodLabel` (422), `BudgetPlanNotFound` (404, also for malformed ids and other spaces' plans).
- Every plan response carries `ETag: "<version>"`; every write to a plan or its parts bumps the version and honours an optional `If-Match` (412 `PreconditionFailed`, spec 7). Plans' stored periods take precedence over the policy in `GET …/periods` and in the ledger's period labels (D10), and a space with a plan cannot change its currency (`SpaceCurrencyLocked`, D6).

---

## HU-E6-02 — Set member capacities

- **Milestone:** M3 · **Priority:** Must · **Size:** S · **Depends on:** HU-E6-01 · **Module(s):** `budgeting`

**User story:** As a household admin, I want to record each member's monthly capacity, so that proportional allocations follow what each person can contribute.

```gherkin
Feature: Member capacities

  Background:
    Given a DRAFT plan for 2026-11 in "Household" with members "Ana" and "Juan"

  @golden
  Scenario: Capacities define the proportional ratio
    When "Ana" sets capacities "Ana" 1,600,000 COP and "Juan" 2,400,000 COP
    Then the total capacity is 4,000,000 COP
    And the proportional ratio is "Ana" 40.00% and "Juan" 60.00%

  Scenario: Negative capacity is rejected
    When "Ana" sets the capacity of "Juan" to -100,000 COP
    Then the result is the error "InvalidCapacity"

  Scenario: Capacity for a non-member is rejected
    When "Ana" sets a capacity for "Marta" who is neither a registered member nor a guest of "Household"
    Then the result is the error "NotASpaceMember"

  Scenario: Reducing capacity below planned lines reports negative unallocated capacity
    Given the plan has lines totalling 4,000,000 COP
    When "Ana" sets the capacity of "Juan" to 2,000,000 COP
    Then the total capacity is 3,600,000 COP
    And the plan reports unallocated capacity of -400,000 COP

  Scenario: Capacity is suggested privately from the member's own previous-period income
    Given "Ana" recorded income of 1,650,000 COP in her personal space during 2026-10
    When "Ana" requests her capacity suggestion for the 2026-11 plan of "Household"
    Then the suggested capacity is 1,650,000 COP and nothing is saved until "Ana" sets her capacity
    And no response to "Juan" contains Ana's suggestion or her income, only the capacity she saves
```

**Technical notes:**
- Use cases: `SetMemberCapacities`, `SuggestCapacity` (query, runs only for the requesting user's own SpaceMember; guests get no suggestion). Endpoints: `PUT /api/v1/spaces/{spaceId}/plans/{planId}/capacities`, `GET .../plans/{planId}/capacity-suggestion` (answers only for the caller's own member).
- A member without an explicit capacity counts as 0 COP.
- Capacities and allocations reference `memberId` (SpaceMember), so guests can hold capacity and be assigned budget lines like registered members (spec D15).
- Changing capacities re-derives every PROPORTIONAL assignment (computed on read).
- `PUT …/capacities` sets the listed members' capacities and keeps the others' (an edit in place, never a delete). OWNER and ADMIN set anyone's (`plan.manage`); a registered MEMBER sets only their own (`capacity.setOwn`, D17); VIEWER none. Errors: `InvalidCapacity` (422: negative, or a member listed twice), `NotASpaceMember` (422), `CurrencyMismatch` (422). Only current members count toward total capacity: a member who left keeps their row but drops out.
- `GET …/capacity-suggestion` answers `{ memberId, period, suggested }` for the caller's own member: the income recorded in their personal space during the period before the plan's (the previous period of the policy, spec 5.3); `suggested` is null when that space keeps another currency.

---

## HU-E6-03 — Add budget lines and show unallocated capacity

- **Milestone:** M3 · **Priority:** Must · **Size:** M · **Depends on:** HU-E6-02 · **Module(s):** `budgeting`

**User story:** As a household admin, I want to add budget lines with a planned amount, funding source and rollover mode, so that every peso of capacity has a job (zero-based budgeting).

```gherkin
Feature: Budget lines

  Background:
    Given a DRAFT plan for 2026-11 with capacities "Ana" 1,600,000 COP and "Juan" 2,400,000 COP

  @golden
  Scenario: Lines and unallocated capacity
    When "Ana" adds the line "Rent" with planned 1,200,000 COP, funding "SHARED_FUND" and rollover "RESET"
    And "Ana" adds the line "Home" with planned 1,470,000 COP, funding "DIRECT" and rollover "RESET"
    Then the plan reports unallocated capacity of 1,330,000 COP
    And "Home" reports 36.75% of total capacity

  @golden
  Scenario: Full reference plan leaves nothing unallocated
    Given the lines "Rent" 1,200,000 COP, "Home" 1,470,000 COP and "Savings" 600,000 COP
    When "Ana" adds the line "Free" with planned 730,000 COP
    Then the plan reports unallocated capacity of 0 COP

  Scenario: Lines cannot exceed total capacity
    Given the four reference lines totalling 4,000,000 COP
    When "Ana" adds the line "Travel" with planned 100,000 COP
    Then the result is the error "PlanExceedsCapacity"

  Scenario: Line names are unique within a plan
    Given the line "Home" exists
    When "Ana" adds another line named "home"
    Then the result is the error "BudgetLineNameTaken"

  Scenario: Planned amount must be positive
    When "Ana" adds the line "Gifts" with planned 0 COP
    Then the result is the error "InvalidPlannedAmount"

  Scenario: Savings lines require at least one savings account
    When "Ana" adds the line "Savings" with planned 600,000 COP, funding "SAVINGS" and no savings account
    Then the result is the error "SavingsAccountRequired"
```

**Technical notes:**
- Use cases: `AddBudgetLine`, `UpdateBudgetLine`, `RemoveBudgetLine`. Endpoints: `POST /api/v1/spaces/{spaceId}/plans/{planId}/lines`, `PATCH .../plans/{planId}/lines/{lineId}`, `DELETE .../plans/{planId}/lines/{lineId}`.
- `SAVINGS` lines reference one or more `SAVINGS` accounts; their spending is the transfers into those accounts (spec 5.4).
- Invariant: Σ plannedAmount ≤ total capacity when adding or increasing a line.
- Percent of total returned with two decimals; unallocated = capacity − Σ planned.
- Every line write answers the whole plan (`201` on `POST`, `200` on `PATCH` and `DELETE`); funding defaults to `DIRECT` and rollover to `RESET`. Errors: `InvalidBudgetLineName` (422, 1–60 characters), `InvalidPlannedAmount` (422), `SavingsAccountRequired` (422), `InvalidSavingsAccount` (422: one of the caller's own accounts that is not SAVINGS, an account listed twice, or accounts on a line that is not SAVINGS), `CurrencyMismatch` (422: a planned amount, or an account a line newly names, in another currency than the space's, D6), `AccountNotFound` (404: every account the caller does not own, unknown or malformed ids included, always with the same answer), `AccountArchived` (409, for the caller's own accounts a line newly names), `SavingsAccountAlreadyUsed` (409: an account backs one SAVINGS line per plan), `BudgetLineNameTaken` (409), `PlanExceedsCapacity` (409, only when a line is added or increased), `CatchAllLineAlreadySet` (409: one catch-all line per plan, also on `POST` with `isCatchAll`), `SavingsLineNotMappable` (409: a SAVINGS line is never the catch-all and maps no categories), `BudgetLineNotFound` (404).
- SAVINGS accounts live in their owners' personal spaces (D9). A line newly names only SAVINGS accounts the caller owns, as the ledger admits a personal account only for its owner (`ownAccount`), so a member's savings reach the group only by their own act. Whatever the caller cannot attach, another member's account included, answers the same `404 AccountNotFound` with identical details: the answer never tells whether an id is a SAVINGS account, an archived one or someone else's. Of the caller's own accounts the answers are `InvalidSavingsAccount`, `AccountArchived` and `CurrencyMismatch`: the account must live in a space with the plan space's currency (one currency per space, D6), because its transfers are summed as the plan's money. The check is made when an account is newly named; accounts a line already names stay and are not checked again on unrelated edits. Consequence: only OWNER and ADMIN, who write lines, can back one with their savings; a MEMBER's or VIEWER's savings never do. A line's spending is the transfers into its accounts during the plan's period, whatever space recorded them, counted only for accounts whose owner is a current registered member of the space, and that filter is applied each time the plan is read, to the whole period: an account whose owner left stays on the line but stops counting, for every reader, and an owner who rejoins makes the period's transfers count again. Owner consent for sharing a personal account with a plan is a follow-up of HU-E9-08.
- `PATCH …/lines/{lineId}` takes at least one field: an empty body (or one with only unknown fields) answers `422 ValidationFailed` with the problem's field errors. Like every plan write it bumps the plan's version and answers the new `ETag`, even when the change repeats what the line already holds.
- `DELETE …/lines/{lineId}` is logical (D8): the line keeps its row with `deletedAt`, leaves every figure, ends its category mappings and frees its name.

---

## HU-E6-04 — Map categories to budget lines

- **Milestone:** M3 · **Priority:** Must · **Size:** S · **Depends on:** HU-E6-03, HU-E3-02 · **Module(s):** `budgeting`, `categories`

**User story:** As a household admin, I want to map categories to budget lines, so that each expense consumes the right envelope automatically.

```gherkin
Feature: Category to line mapping

  Background:
    Given the reference plan for 2026-11 in "Household"

  Scenario: Map categories to a line
    When "Ana" maps the categories "Groceries" and "Utilities" to the line "Home"
    Then an expense in "Groceries" dated 2026-11-10 counts as spent in "Home"

  Scenario: A category maps to at most one line per plan
    Given "Groceries" is mapped to "Home"
    When "Ana" maps "Groceries" to "Free"
    Then the result is the error "CategoryAlreadyMapped"

  @golden
  Scenario: Unmapped categories fall into the catch-all line
    Given "Free" is the plan's catch-all line
    And "Outings" is not mapped to any line
    When an expense of 50,000 COP in "Outings" is recorded on 2026-11-12
    Then it counts as spent in "Free"

  Scenario: Without a catch-all line, unmapped categories fall into Unbudgeted
    Given the plan has no catch-all line
    And "Restaurants" is not mapped to any line
    When an expense of 60,000 COP in "Restaurants" is recorded on 2026-11-12
    Then it counts as spent in the implicit line "Unbudgeted"

  Scenario: A plan has at most one catch-all line
    Given "Free" is the plan's catch-all line
    When "Ana" marks "Home" as catch-all
    Then the result is the error "CatchAllLineAlreadySet"

  Scenario: Only categories of the same space can be mapped
    When "Ana" maps a category from her personal space to the line "Free"
    Then the result is the error "CategoryNotInSpace"
```

**Technical notes:**
- Use cases: `MapCategoriesToLine`, `SetCatchAllLine`. Endpoints: `PUT /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/categories`, `PATCH .../plans/{planId}/lines/{lineId}` with `isCatchAll`.
- Subcategories (HU-E3-04, M3-D) are never mapped (`SubcategoryNotMappable`): their expenses count where their parent category is mapped, the catch-all line and "Unbudgeted" included.
- Errors (catalogue, spec 8): `SubcategoryNotMappable` (409) from `PUT …/lines/{lineId}/categories`; a mapping of a category that later became a subcategory stops counting and copies drop it into `dropped.mappings` (M3-D Task 10).
- Invariants: (planId, categoryId) unique; archived categories cannot be newly mapped; at most one `isCatchAll` line per plan (`CatchAllLineAlreadySet`, 409, answered by `PATCH …/lines/{lineId}` with `isCatchAll`, and by `POST …/lines` with it).
- "Unbudgeted" is computed on read, never persisted, and only exists when the plan has no catch-all line.
- `PUT …/lines/{lineId}/categories` takes the line's whole category set; categories left out are unmapped (the rows stay, D8), and removing a line ends its mappings. Errors: `CategoryNotInSpace` (422: any id that is not a live category of the plan's space, so other spaces' categories never leak), `CategoryArchived` (409, for categories newly mapped), `CategoryAlreadyMapped` (409), `SavingsLineNotMappable` (409: a SAVINGS line takes no categories and is never the catch-all line, spec 5.4).
- Each line reports `spent` and `available` (planned + carry-over − spent; the carry-over of HU-E6-09), and the plan reports `unbudgeted` (`spent`, `available`) only when it has no catch-all line. A category that any plan maps or once mapped can no longer be deleted (`CategoryInUse`, HU-E3-03); it can be archived.

---

## HU-E6-05 — Allocate a budget line among members

- **Milestone:** M3 · **Priority:** Must · **Size:** M · **Depends on:** HU-E6-03 · **Module(s):** `budgeting`

**User story:** As a household admin, I want to assign each line to members proportionally, by percentage or by fixed amount, or leave it unassigned as shared group money, so that everyone knows what they are responsible for.

```gherkin
Feature: Line allocation rules

  Background:
    Given the reference plan for 2026-11 with capacities "Ana" 1,600,000 COP and "Juan" 2,400,000 COP

  @golden
  Scenario: Proportional allocation is the default
    When "Ana" requests the line "Home" with planned 1,470,000 COP
    Then the rule is "PROPORTIONAL"
    And "Ana" is assigned 588,000 COP and "Juan" is assigned 882,000 COP

  @golden
  Scenario: Custom percentage allocation
    When "Ana" allocates the line "Free" with planned 730,000 COP as "PERCENT" "Ana" 42% and "Juan" 58%
    Then "Ana" is assigned 306,600 COP and "Juan" is assigned 423,400 COP

  Scenario: Fixed amounts
    When "Ana" allocates the line "Savings" with planned 600,000 COP as "FIXED" "Ana" 200,000 COP and "Juan" 400,000 COP
    Then "Ana" is assigned 200,000 COP and "Juan" is assigned 400,000 COP

  Scenario Outline: Allocation values must add up
    When "Ana" allocates the line "<line>" as "<rule>" "Ana" <ana> and "Juan" <juan>
    Then the result is the error "InvalidAllocation"

    Examples:
      | line    | rule    | ana         | juan        |
      | Free    | PERCENT | 42%         | 57%         |
      | Savings | FIXED   | 200,000 COP | 350,000 COP |

  Scenario: A line can stay unassigned as group money
    When "Ana" sets the line "Free" to "NONE"
    Then no member is assigned an amount on "Free"
    And "Free" reports planned, spent and available but no per-member gap

  Scenario: Proportional allocation requires positive total capacity
    Given every member capacity is 0 COP
    When "Ana" requests the line "Home"
    Then the line is flagged with the error "InvalidAllocation"
```

**Technical notes:**
- Use case: `AllocateBudgetLine`; domain service `AllocationCalculator` using `Money.allocate`. Endpoint: `PUT /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/allocation` (rule and member values); lines are returned with derived `assigned` per member.
- One rule per line (all member rows share the rule); assigned amounts are derived, never stored.
- Rule `NONE` stores no member rows; `assigned`, `contributed` and `gap` are not reported for that line.
- Percentages stored as basis points (42% = 4200).
- `PUT …/lines/{lineId}/allocation` takes `{ "rule": "PROPORTIONAL" | "NONE" }`, `{ "rule": "PERCENT", "members": [{ "memberId", "percent": "42" }] }` or `{ "rule": "FIXED", "members": [{ "memberId", "amount" }] }`. The rule is stored on the line (PROPORTIONAL for a new line); PERCENT and FIXED values are member rows that a new allocation supersedes (`superseded_at`, D8). Errors: `InvalidAllocation` (422: values that do not sum to 100 % or to the planned amount, a value that is not positive, a member listed twice, or no members), `NotASpaceMember` (422), `CurrencyMismatch` (422).
- Assigned amounts are derived on read for the current members in join order (largest remainder in rounding units, spec 5.3). A line answers `allocation.error: "InvalidAllocation"` and no assigned amounts while a PROPORTIONAL line has no capacity to follow, or while PERCENT or FIXED values no longer add up (for instance after a member who held one left).

---

## HU-E6-06 — Copy a plan from the previous period

- **Milestone:** M3 · **Priority:** Must · **Size:** M · **Depends on:** HU-E6-04, HU-E6-05 · **Module(s):** `budgeting`

**User story:** As a household admin, I want to start a period by copying the previous period's plan, so that budgeting each period takes minutes instead of starting from scratch.

```gherkin
Feature: Copy previous plan

  Background:
    Given the reference plan for 2026-11 in "Household" with its capacities, lines, mappings and allocations

  @critical
  Scenario: Copy into the next period
    When "Ana" creates the plan for 2026-12 by copying the previous plan
    Then the 2026-12 plan has status "DRAFT" and createdFrom set to the 2026-11 plan
    And it has capacities "Ana" 1,600,000 COP and "Juan" 2,400,000 COP
    And it has the lines "Rent", "Home", "Savings" and "Free" with the same planned amounts, funding, rollover modes, mappings and allocation rules

  Scenario: No previous plan to copy
    Given "Household" has no plan for 2026-11
    When "Ana" creates the plan for 2026-12 by copying the previous plan
    Then the result is the error "NoPreviousPlan"

  Scenario: Archived categories are dropped from mappings
    Given "Utilities" was archived after the 2026-11 plan was created
    When "Ana" copies the plan into 2026-12
    Then "Utilities" is not mapped in the 2026-12 plan
    And the copy result lists "Utilities" as dropped

  Scenario: A member who left invalidates percentage allocations
    Given "Luis" was allocated 10% of "Free" in 2026-11 and has since left "Household"
    When "Ana" copies the plan into 2026-12
    Then "Free" is flagged with "InvalidAllocation" until its percentages sum to 100
```

**Technical notes:**
- Use case: `CopyBudgetPlan` (endpoint `POST /api/v1/spaces/{spaceId}/plans` with `copyFrom: "previous"`; the response lists dropped mappings); the source is the plan of the previous period of the same policy (for `SEMI_MONTHLY`, "2026-11 H2" copies from "2026-11 H1" and "2026-12 H1" from "2026-11 H2"), never simply the previous calendar month.
- Copy is a deep clone with new ids; former members and archived categories excluded.
- Supports success criterion "plan in under 5 minutes".
- The copy answers `201` like a creation (`ETag`, `Location`), and only that answer carries `dropped`: `mappings` (to categories archived since, by the copied line), `savingsAccounts` (accounts that no longer qualify, by the copied line) and `lines` (SAVINGS lines left without accounts, by the source line). Each copied line keeps its name, planned amount, funding, rollover mode, catch-all flag and allocation rule, links to its source through `originLineId` and is listed in the source's order; capacities and PERCENT/FIXED values of former members are left out, so a line that named one is flagged `InvalidAllocation` until it is allocated again. A savings account is kept while it is a SAVINGS account, not archived, in the plan's currency and owned by a current registered member of the space; the copy names no account anew, so it does not depend on who copies. Nothing is checked against capacity: activation does (HU-E6-07). Errors: `NoPreviousPlan` (409), `PlanAlreadyExists` (409), `InvalidPeriodLabel` (422), `SpaceArchived` (409).

---

## HU-E6-07 — Activate and close a plan

- **Milestone:** M3 · **Priority:** Must · **Size:** M · **Depends on:** HU-E6-05 · **Module(s):** `budgeting`, `ledger`

**User story:** As a household admin, I want to activate a plan when it is valid and close it when the month is over, so that budgets apply during the month and figures freeze afterwards.

```gherkin
Feature: Plan lifecycle

  Background:
    Given the reference plan for 2026-11 in "Household" with status "DRAFT"

  Scenario: Activate a valid plan
    When "Ana" activates the plan
    Then the plan status is "ACTIVE"

  Scenario: Plan with an invalid allocation cannot be activated
    Given the line "Free" has "PERCENT" allocations summing to 99%
    When "Ana" activates the plan
    Then the result is the error "InvalidAllocation" naming the line "Free"

  Scenario: Plan exceeding capacity cannot be activated
    Given the capacity of "Juan" was reduced to 2,000,000 COP
    When "Ana" activates the plan
    Then the result is the error "PlanExceedsCapacity"

  @critical
  Scenario: Closed period rejects ledger changes
    Given the plan is "ACTIVE" and today is 2026-12-01
    When "Ana" closes the plan
    Then the plan status is "CLOSED"
    And recording an expense dated 2026-11-15 fails with the error "PeriodClosed"
    And editing an expense dated 2026-11-03 fails with the error "PeriodClosed"

  Scenario: Closed plan rejects plan edits
    Given the plan is "CLOSED"
    When "Ana" changes the planned amount of "Home" to 1,500,000 COP
    Then the result is the error "PeriodClosed"

  Scenario: Only an active plan can be closed
    When "Ana" closes the plan while it is "DRAFT"
    Then the result is the error "InvalidPlanTransition"

  Scenario: A plan cannot be closed before its period has ended
    Given the plan is "ACTIVE" and today is 2026-11-30
    When "Ana" closes the plan
    Then the result is the error "PeriodNotOver"
    And the plan status is "ACTIVE"
```

**Technical notes:**
- Use cases: `ActivateBudgetPlan`, `CloseBudgetPlan`. Endpoints: `POST /api/v1/spaces/{spaceId}/plans/{planId}/activate`, `POST .../plans/{planId}/close` (both honour `If-Match`, HU-E0-10).
- State machine: DRAFT → ACTIVE → CLOSED; no reopening in v1.
- Provides the `ClosedPeriodGuard` adapter used by `ledger` (HU-E4-06).
- `POST …/plans/{planId}/activate` has no body, honours an optional `If-Match` and answers the whole plan with its new `ETag` (like every plan write). Activation checks, in this order, that Σ planned does not exceed the current members' capacity (`PlanExceedsCapacity`, 409) and that every allocation holds (`InvalidAllocation`, 422, whose problem lists the flagged lines in `lineIds`). An ACTIVE plan stays editable and is not checked again. After those checks, activation is refused with 409 `CopyAlreadyClosed` (`copyPeriod`: the closed copy's period label, e.g. "2026-12") while a plan copied from this one is already CLOSED and carries over from it (ruling P250, the mirror of P248). Other errors: `InvalidPlanTransition` (409: any move other than DRAFT → ACTIVE → CLOSED), `BudgetPlanNotFound` (404, malformed ids included), `SpaceArchived` (409).
- **`CopyAlreadyClosed` (issue #158, ruling P250):** P248 lets a copy of a DRAFT source close carrying 0, because a DRAFT source "never closes". It can, though, be activated and then closed, and the copy reads its figures only once the source is CLOSED (P243), so that frozen 0 would jump. Activating a DRAFT plan is therefore refused while a CLOSED plan copied from it carries over from it (ROLLOVER or ADJUSTED, with an origin line), naming the closed copy's period. A CLOSED copy that carries nothing (all RESET, or no origin line) does not block, and a copy that is not CLOSED yet does not either. This is the symmetric guard to P248: between a source and its carrying copy, the two can close in order, and the later one closes last. The two guards serialize (issue #183, ruling P251): activation locks every copy of the plan FOR SHARE after its own version lock, so it waits for a close of a copy in progress and then sees it CLOSED, and a close that starts meanwhile waits at the copy's version lock and then sees the source ACTIVE. A close reads its source without a lock, so the two never wait on each other in opposite order and cannot deadlock.
- `POST …/plans/{planId}/close` mirrors activation and checks two things, in this order: the transition (ACTIVE → CLOSED, else `InvalidPlanTransition`) and that the plan's period has ended, which means that today in the deployment time zone (`APP_TIMEZONE`, the zone the ledger dates undated records in) is after the plan's stored last day, else `PeriodNotOver` (409) and nothing changes. A close at 2026-11-30 22:00 in Bogota, already 2026-12-01 in UTC, is refused. v1 has no reopening, so an early close would refuse every ledger write of the space dated in the rest of the period (ruling P17, amended after the final review); activation stays free, before or after the period. Once CLOSED, every edit of the plan or its parts answers `PeriodClosed` (409), and so does every write of the space's ledger dated within the plan's stored dates (record, edit on either date, delete; HU-E4-06). The guard reads the plan covering the date `FOR SHARE`, so a ledger write and a close of its period run one after the other. Figures stay derived on read: a transfer recorded in a personal space into a SAVINGS line's account, or a member leaving, still changes a closed plan's figures.
- **`SourcePlanOpen` (M6c ruling P248):** after those two checks, closing is refused with 409 `SourcePlanOpen` (`sourcePeriod`: the source's period label, e.g. "2026-11") while the plan it was copied from is ACTIVE and at least one of its lines carries over from it (ROLLOVER or ADJUSTED, with an origin line). A carry reads its source only once that source is CLOSED (HU-E6-09, ruling P243), so closing the copy first would let its frozen figures jump when the source closes later; closing in order keeps a CLOSED plan's figures frozen. The rule is "the source is ACTIVE", not "not CLOSED": a DRAFT source is not closed, so its copies carry 0 while it stays a draft, which does not block closing them; activating that DRAFT source is refused instead (ruling P250, issue #158), so the copy's frozen 0 is never let to jump. A plan whose lines all RESET, or that has no source, closes as before.

---

## HU-E6-08 — Default split by allocation

- **Milestone:** M3 · **Priority:** Must · **Size:** M · **Depends on:** HU-E6-04, HU-E6-05, HU-E6-07, HU-E4-07, HU-E5-01 · **Module(s):** `budgeting`, `ledger`, `balances`

**User story:** As a household member, I want expenses in a budgeted category to be split by that line's allocation by default, so that balances follow our plan without manual calculation (D4).

```gherkin
Feature: BY_ALLOCATION default split

  Background:
    Given the reference plan for 2026-11 in "Household" is "ACTIVE"
    And "Groceries" is mapped to the line "Home" with "PROPORTIONAL" allocation "Ana" 40% and "Juan" 60%
    And "Ana" and "Juan" have a net balance of 0 COP

  @critical @golden
  Scenario: Ana pays a Home expense alone
    When "Ana" records an expense of 2,000,000 COP in "Groceries" on 2026-11-08 paid from "Bancolombia"
    Then the split method defaults to "BY_ALLOCATION"
    And the shares are 800,000 COP for "Ana" and 1,200,000 COP for "Juan"
    And "Juan" owes "Ana" 1,200,000 COP

  Scenario: Member overrides the default split
    When "Ana" records an expense of 2,000,000 COP in "Groceries" and chooses "EQUAL"
    Then the shares are 1,000,000 COP each with splitMethod "EQUAL"

  Scenario: Fixed allocation splits proportionally to fixed amounts
    Given the line "Home" is allocated "FIXED" "Ana" 490,000 COP and "Juan" 980,000 COP
    When "Juan" records an expense of 300,000 COP in "Groceries"
    Then the shares are 100,000 COP for "Ana" and 200,000 COP for "Juan"

  Scenario: Shares are a snapshot
    Given "Ana" recorded a 2,000,000 COP "Groceries" expense split "BY_ALLOCATION"
    When the allocation of "Home" changes to "PERCENT" "Ana" 50% and "Juan" 50%
    Then the recorded shares remain 800,000 COP and 1,200,000 COP

  Scenario: Lines without allocation default to EQUAL
    Given "Free" is the catch-all line with allocation rule "NONE"
    When "Ana" records an expense of 50,000 COP in "Outings", which is not mapped
    Then it counts as spent in "Free"
    And the split method defaults to "EQUAL" with 25,000 COP each
    And the resolved default split for "Outings" does not list "BY_ALLOCATION" among the available methods

  Scenario: Draft plans do not drive splits
    Given the plan for 2026-12 is "DRAFT"
    When "Ana" records an expense in "Groceries" dated 2026-12-05
    Then the split method defaults to "EQUAL"
```

**Technical notes:**
- Use case: `ResolveDefaultSplit` (budgeting, public query) consumed by `RecordExpense`. Endpoint: `GET /api/v1/spaces/{spaceId}/default-split?categoryId=<id>&date=<date>&amount=<minor>` returns the method, the available methods and the share preview.
- BY_ALLOCATION ratios = assigned amounts of the line for the expense's period; computed via `Money.allocate`.
- Share rows store `splitMethod = BY_ALLOCATION` as a snapshot (spec 5.2).
- EQUAL is the default when the resolved line has rule `NONE`, when there is no line, or when the plan is not `ACTIVE` (spec 5.3).
- `GET …/default-split` is `space.read` (any member; archived spaces answer too) and takes `categoryId` and `date` (required) and `amount` (optional, positive minor units of the space currency, digits only, at most 18). It answers `{ method, availableMethods, lineId, shares }`: `shares` is null without an amount; `availableMethods` lists `BY_ALLOCATION` only when it is the default, because a client gets it by sending no split (it is never requested explicitly). The weights are the line's assigned amounts for the current members, positive ones only (a member without capacity or without a FIXED amount takes no share); EQUAL weighs every current member alike, and so does an allocation that does not hold. Errors: `ValidationFailed` (422: also an empty `categoryId` or one longer than 64 characters), `CategoryNotInSpace` (422: every other id that is not a live category of the space; archived categories still resolve), `InvalidDate` (422), `SpaceNotFound` (404).
- `RecordExpense` asks for the default only when the request has no `split`, after checking the closed period (HU-E4-06 first); its shares store `splitMethod = BY_ALLOCATION` and are never recomputed when the plan changes. `BY_ALLOCATION` cannot be requested explicitly: the split methods a client sends stay `EQUAL`, `PERCENT`, `EXACT` and `SHARES`. The ledger passes budgeting the current member ids it already read for the expense, so the weights can only name members the split is shared among. In a personal or DIRECT space with an ACTIVE plan, an expense without a split whose category resolves to an allocated line records `BY_ALLOCATION` shares like any other space (personal: one share, for the owner).

---

## HU-E6-09 — Apply rollover modes

- **Milestone:** M3 · **Priority:** Must · **Size:** M · **Depends on:** HU-E6-04, HU-E6-07 · **Module(s):** `budgeting`

**User story:** As a household admin, I want each line to reset, roll over savings, or carry overspending into next month, so that envelopes behave the way we manage money.

```gherkin
Feature: Rollover modes

  Scenario Outline: Carry-over from 2026-11 into 2026-12 for the line "Home"
    Given the line "Home" has planned 1,470,000 COP in both 2026-11 and 2026-12 with rollover "<mode>"
    And spending in "Home" during 2026-11 was <spent>
    And the plan for 2026-11 is CLOSED before 2026-12 is read
    When "Ana" requests the line "Home" for 2026-12 before any December spending
    Then the November available amount is <novAvailable>
    And the December available amount is <decAvailable>

    Examples:
      | mode     | spent         | novAvailable  | decAvailable  |
      | RESET    | 1,270,000 COP | 200,000 COP   | 1,470,000 COP |
      | RESET    | 1,600,000 COP | -130,000 COP  | 1,470,000 COP |
      | ROLLOVER | 1,270,000 COP | 200,000 COP   | 1,670,000 COP |
      | ROLLOVER | 1,600,000 COP | -130,000 COP  | 1,470,000 COP |
      | ADJUSTED | 1,270,000 COP | 200,000 COP   | 1,470,000 COP |
      | ADJUSTED | 1,600,000 COP | -130,000 COP  | 1,340,000 COP |

  Scenario: Nothing carries from a plan that is not closed
    Given the line "Home" has planned 1,470,000 COP in both 2026-11 and 2026-12 with rollover "ROLLOVER"
    And spending in "Home" during 2026-11 was 1,270,000 COP
    And the plan for 2026-11 is ACTIVE
    When "Ana" requests the line "Home" for 2026-12
    Then the December carry-over is 0 COP and the December available amount is 1,470,000 COP
    And the line says its carry-over comes from 2026-11, which is not closed

  Scenario: No previous plan means no carry-over
    Given "Household" has no plan for 2026-10
    And the line "Home" in 2026-11 has rollover "ROLLOVER" and planned 1,470,000 COP
    When "Ana" requests the line "Home" for 2026-11 before any spending
    Then the available amount is 1,470,000 COP

  Scenario: Carry-over follows the copied line, not its name
    Given the 2026-12 plan was copied from the CLOSED 2026-11 plan and "Home" had 200,000 COP available with rollover "ROLLOVER"
    When "Ana" renames "Home" to "House" in the 2026-12 plan
    Then "House" still receives the 200,000 COP carry-over through its origin line link
```

**Technical notes:**
- Domain service `RolloverCalculator`: available(L) = planned + carry − spent(L); RESET carry 0; ROLLOVER max(prevAvailable, 0); ADJUSTED min(prevAvailable, 0).
- Previous line resolved via the copied line's origin link (not by name); lines without an origin get carry 0.
- Computed on read (D7); recursion bounded by the plan chain. Exposed as `available` and `carryOver` on each line of `GET /api/v1/spaces/{spaceId}/plans/{planId}`.
- The mode that decides is the receiving line's own `rolloverMode`; the previous available is the origin line's `available` in the plan the line was copied from (itself with its own carry-over). An origin removed from its plan after the copy carries 0. Every write's answer carries the same figures.
- **Contract change (M6c, ruling P243, amending P15; #143):** a line carries only from the CLOSED plan it was copied from, and only from its origin line there. Until that plan closes, `carryOver` is 0 and the line says which plan it waits for. This changes what `carryOver` answers for a copy of a plan that is DRAFT or ACTIVE: before M6c it carried the source's available amount, whatever the source's status, and a copy of an unused plan credited its whole planned amount. A chain of copies walks on only through CLOSED plans. Turning ROLLOVER or ADJUSTED on for a line whose origin plan is not closed, or for a line with no origin, carries nothing. The carry never counts against capacity: "Σ planned ≤ total capacity" counts planned amounts only (HU-E6-02, ruling P229), and the carry is derived on read and never stored (D7, ruling P230), so no migration is needed.
- Closing a plan is refused with `SourcePlanOpen` while its source is ACTIVE and a line carries over from it (ruling P248, see HU-E6-07), so a CLOSED plan's carry-over never changes after it closes.
- `carryOverFrom: { planId, period, closed } | null` on each line of the plan and of the line dashboard (`GET /api/v1/spaces/{spaceId}/reports/lines`) names the plan the carry-over comes from, or waits for (`closed: false`). It is null for RESET, for a line without an origin in the source (a line added by hand, or one the source no longer holds) and for a plan that was not copied.
