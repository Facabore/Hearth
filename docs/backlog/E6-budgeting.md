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
- Invariants: (planId, categoryId) unique; archived categories cannot be newly mapped; at most one `isCatchAll` line per plan.
- "Unbudgeted" is computed on read, never persisted, and only exists when the plan has no catch-all line.

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
    Given the plan is "ACTIVE"
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
```

**Technical notes:**
- Use cases: `ActivateBudgetPlan`, `CloseBudgetPlan`. Endpoints: `POST /api/v1/spaces/{spaceId}/plans/{planId}/activate`, `POST .../plans/{planId}/close` (both honour `If-Match`, HU-E0-10).
- State machine: DRAFT → ACTIVE → CLOSED; no reopening in v1.
- Provides the `ClosedPeriodGuard` adapter used by `ledger` (HU-E4-06).

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

---

## HU-E6-09 — Apply rollover modes

- **Milestone:** M3 · **Priority:** Must · **Size:** M · **Depends on:** HU-E6-04, HU-E6-07 · **Module(s):** `budgeting`

**User story:** As a household admin, I want each line to reset, roll over savings, or carry overspending into next month, so that envelopes behave the way we manage money.

```gherkin
Feature: Rollover modes

  Scenario Outline: Carry-over from 2026-11 into 2026-12 for the line "Home"
    Given the line "Home" has planned 1,470,000 COP in both 2026-11 and 2026-12 with rollover "<mode>"
    And spending in "Home" during 2026-11 was <spent>
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

  Scenario: No previous plan means no carry-over
    Given "Household" has no plan for 2026-10
    And the line "Home" in 2026-11 has rollover "ROLLOVER" and planned 1,470,000 COP
    When "Ana" requests the line "Home" for 2026-11 before any spending
    Then the available amount is 1,470,000 COP

  Scenario: Carry-over follows the copied line, not its name
    Given the 2026-12 plan was copied from 2026-11 and "Home" had 200,000 COP available with rollover "ROLLOVER"
    When "Ana" renames "Home" to "House" in the 2026-12 plan
    Then "House" still receives the 200,000 COP carry-over through its origin line link
```

**Technical notes:**
- Domain service `RolloverCalculator`: available(L) = planned + carry − spent(L); RESET carry 0; ROLLOVER max(prevAvailable, 0); ADJUSTED min(prevAvailable, 0).
- Previous line resolved via the copied line's origin link (not by name); lines without an origin get carry 0.
- Computed on read (D7); recursion bounded by the plan chain. Exposed as `available` and `carryOver` on each line of `GET /api/v1/spaces/{spaceId}/plans/{planId}`.
