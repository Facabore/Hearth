# E7 — Reporting

**Goal:** answer the household's three questions — how each line did against the plan, how each member contributed versus what was assigned, and how much each person spent in total including shared expenses.

**Modules involved:** `reporting` (read models over `ledger`, `budgeting`, `balances`, `categories`, `spaces`).

All figures are computed on read (D7) and exclude soft-deleted transactions.

**Shared fixture for this epic:** shared space "Household", ACTIVE reference plan for 2026-11 (see E6), period policy MONTHLY(1). Category mappings: "Rent" → Rent; "Groceries", "Utilities" → Home; "Entertainment" → Free; "Restaurants" unmapped.

---

## HU-E7-01 — Budget line dashboard

- **Milestone:** M4 · **Priority:** Must · **Size:** M · **Depends on:** HU-E6-09 · **Module(s):** `reporting`

**User story:** As a household member, I want to see planned, spent and available per budget line for a month, so that I know which envelopes still have money.

```gherkin
Feature: Line dashboard

  Background:
    Given these November 2026 expenses in "Household":
      | category    | amount        | paid from        |
      | Rent        | 1,200,000 COP | Household Fund   |
      | Groceries   | 900,000 COP   | Ana's account    |
      | Utilities   | 400,000 COP   | Juan's account   |
      | Entertainment | 250,000 COP | Juan's account   |
      | Restaurants | 60,000 COP    | Ana's account    |

  @critical @golden
  Scenario: Planned, spent and available per line
    When "Ana" requests the line dashboard for 2026-11
    Then the response lines are:
      | line        | planned       | spent         | available   |
      | Rent        | 1,200,000 COP | 1,200,000 COP | 0 COP       |
      | Home        | 1,470,000 COP | 1,300,000 COP | 170,000 COP |
      | Savings     | 600,000 COP   | 0 COP         | 600,000 COP |
      | Free        | 730,000 COP   | 250,000 COP   | 480,000 COP |
      | Unbudgeted  | 0 COP         | 60,000 COP    | -60,000 COP |

  Scenario: Overspent line is flagged
    Given an additional "Groceries" expense of 300,000 COP on 2026-11-20
    When "Ana" requests the line dashboard for 2026-11
    Then "Home" has spent 1,600,000 COP and available -130,000 COP
    And "Home" is flagged as overspent

  Scenario: Available includes carry-over
    Given "Home" uses rollover "ROLLOVER" and had 200,000 COP available in 2026-10
    When "Ana" requests the line dashboard for 2026-11
    Then "Home" has available 370,000 COP

  Scenario: Month without a plan
    Given "Household" has no plan for 2027-01
    When "Ana" requests the line dashboard for 2027-01
    Then all spending is reported under "Unbudgeted"
    And the response reports that no plan exists for 2027-01
```

**Technical notes:**
- Query: `GetLineDashboard(spaceId, period)`; SQL aggregates grouped by line via the category mapping.
- Endpoint: `GET /api/v1/spaces/{spaceId}/reports/lines?period=<label>`; each line carries `planned`, `spent`, `available` and `overspent`, and the response carries `plan: null` when the period has no plan.
- Uses `RolloverCalculator` from `budgeting` for available amounts. Charts and the "create or copy a plan" prompt are web UI (HU-E9-10).
- `GET …/reports/lines?period=<label>` is `space.read` (every role; archived spaces read, HU-E1-09). The period is the stored period with that label, else the policy's period (D10); the plan is the one whose stored period it is, whatever its status (M4 ruling P33). Each line carries `planned`, `spent`, `carryOver`, `available` and `overspent` (available < 0), exactly as `GET …/plans/{planId}` derives them; `unbudgeted` (`spent`, `available` = −spent, `overspent`) holds what no line consumes and is null when the plan has a catch-all line (ruling P34). Without a plan, `plan` is null, `lines` is empty and every expense is under `unbudgeted`. Pending occurrences are not reported as "expected" (ruling P34). Errors: `SpaceNotFound` (404), `ValidationFailed` and `InvalidPeriodLabel` (422).

---

## HU-E7-02 — Member by line matrix

- **Milestone:** M4 · **Priority:** Must · **Size:** M · **Depends on:** HU-E6-08, HU-E7-01 · **Module(s):** `reporting`

**User story:** As a household member, I want a matrix of assigned, contributed, consumed and gap per member and line, so that we can see who is carrying which part of the plan.

```gherkin
Feature: Member by line matrix

  Background:
    Given "Home" has "PROPORTIONAL" allocation with "Ana" assigned 588,000 COP and "Juan" assigned 882,000 COP
    And in November 2026 "Ana" paid 900,000 COP in "Groceries" split "BY_ALLOCATION"
    And in November 2026 "Juan" paid 400,000 COP in "Utilities" split "BY_ALLOCATION"

  @critical @golden
  Scenario: Matrix values for a DIRECT line
    When "Ana" requests the member matrix for 2026-11
    Then the "Home" row contains:
      | member | assigned    | contributed | consumed    | gap          |
      | Ana    | 588,000 COP | 900,000 COP | 520,000 COP | 312,000 COP  |
      | Juan   | 882,000 COP | 400,000 COP | 780,000 COP | -482,000 COP |

  Scenario: Shared-fund lines defer contribution to the fund
    Given "Rent" is funded by "SHARED_FUND" and a 1,200,000 COP rent was paid from "Household Fund" split "BY_ALLOCATION"
    When "Ana" requests the member matrix for 2026-11
    Then the "Rent" row contains consumed 480,000 COP for "Ana" and 720,000 COP for "Juan"
    And contributed and gap for "Rent" are null with the reason "TRACKED_AT_FUND_LEVEL"

  Scenario: Positive gap means over-contribution
    When "Ana" requests the member matrix for 2026-11
    Then the gap of "Ana" on "Home" is 312,000 COP with the status "OVER_CONTRIBUTED"

  Scenario: Lines without allocation show only consumption
    Given "Free" has allocation rule "NONE" and "Ana" paid 50,000 COP in "Outings" split "EQUAL"
    When "Ana" requests the member matrix for 2026-11
    Then the "Free" row contains consumed 25,000 COP for "Ana" and 25,000 COP for "Juan"
    And assigned, contributed and gap for "Free" are null with the reason "NOT_ALLOCATED"

  Scenario: Viewer can read the matrix
    Given "Sofi" is VIEWER of "Household"
    When "Sofi" requests the member matrix for 2026-11
    Then the response status is 200 and it contains the matrix
```

**Technical notes:**
- Query: `GetMemberLineMatrix(spaceId, period)`. Endpoint: `GET /api/v1/spaces/{spaceId}/reports/member-matrix?period=<label>`; reasons and statuses are codes that the web UI translates (HU-E9-10).
- Metrics per spec 5.4 (lines with rule `NONE` report consumption only): contributed = Σ payments by m on DIRECT lines; consumed = Σ shares of m; gap = contributed − assigned.
- Golden test: the reference example fixture produces exactly these values.

---

## HU-E7-03 — Shared fund contribution tracking

- **Milestone:** M4 · **Priority:** Must · **Size:** S · **Depends on:** HU-E4-09, HU-E6-05 · **Module(s):** `reporting`

**User story:** As a household member, I want to compare each member's expected and actual contributions to the shared fund, so that we know who still has to pay in this month.

```gherkin
Feature: Fund contribution tracking

  Background:
    Given "Rent" is the only "SHARED_FUND" line in the 2026-11 plan with "Ana" assigned 480,000 COP and "Juan" assigned 720,000 COP

  @golden
  Scenario: Expected versus actual
    Given "Ana" contributed 480,000 COP on 2026-11-02
    And "Juan" contributed 500,000 COP on 2026-11-03
    When "Ana" requests fund tracking for 2026-11
    Then "Ana" has expected 480,000 COP, actual 480,000 COP and difference 0 COP
    And "Juan" has expected 720,000 COP, actual 500,000 COP and difference -220,000 COP

  Scenario: Contributions outside the period are excluded
    Given "Juan" contributed 720,000 COP on 2026-10-31
    When "Ana" requests fund tracking for 2026-11
    Then "Juan" has actual 0 COP

  Scenario: Plan without shared-fund lines
    Given the 2026-12 plan has no "SHARED_FUND" lines
    When "Ana" requests fund tracking for 2026-12
    Then every member has expected 0 COP
```

**Technical notes:**
- Query: `GetFundContributions(spaceId, period)`. Endpoint: `GET /api/v1/spaces/{spaceId}/reports/fund-contributions?period=<label>`.
- expectedFundContribution(m) = Σ assigned(m) over SHARED_FUND lines; actualFundContribution(m) = Σ fund-contribution transfers by m in the period.

---

## HU-E7-04 — Unified personal view

- **Milestone:** M4 · **Priority:** Must · **Size:** M · **Depends on:** HU-E4-07, HU-E4-10 · **Module(s):** `reporting`

**User story:** As a user, I want one view of everything I spent in a month — my personal expenses plus my share of every shared expense — so that I know my real total consumption and cash out.

```gherkin
Feature: Unified personal view

  Background:
    Given in November 2026 "Ana" has these movements:
      | space    | description        | category    | amount        | paid by        | Ana's share |
      | Personal | Market             | Groceries   | 85,000 COP    | Ana            | 85,000 COP  |
      | Personal | Dinner             | Restaurants | 60,000 COP    | Ana            | 60,000 COP  |
      | Household| Home purchase      | Groceries   | 2,000,000 COP | Ana            | 800,000 COP |
      | Household| Rent November      | Rent        | 1,200,000 COP | Household Fund | 480,000 COP |
      | Household| Weekly market      | Groceries   | 300,000 COP   | Juan           | 150,000 COP |
    And on 2026-11-01 "Ana" transferred 480,000 COP from "Bancolombia" to "Household Fund" as a fund contribution

  @critical
  Scenario: Total consumption includes shares across spaces
    When "Ana" requests her unified view for 2026-11
    Then her total consumption is 1,575,000 COP
    And "Groceries" from both spaces is grouped together under the catalog key "groceries" with 1,035,000 COP

  @critical
  Scenario: Cash out versus consumption
    When "Ana" requests her unified view for 2026-11
    Then her cash out is 2,625,000 COP, including the 480,000 COP fund contribution
    And her consumption is 1,575,000 COP

  Scenario: Other members' personal spaces are never included
    Given "Juan" recorded a personal expense of 90,000 COP
    When "Ana" requests her unified view for 2026-11
    Then the 90,000 COP expense of "Juan" is not included

  Scenario: Shared expenses are placed in the viewer's personal period
    Given "Ana"'s personal space has the period policy MONTHLY(1) and "Household" has MONTHLY(25)
    And a "Household" expense with Ana's share 100,000 COP is dated 2026-11-26
    When "Ana" requests her unified view for 2026-11
    Then the 100,000 COP share is included, because 2026-11-26 falls in her personal period 2026-11-01 to 2026-11-30, even though "Household" counts it in its period "2026-12" from 2026-11-25 to 2026-12-24
```

**Technical notes:**
- Query: `GetUnifiedPersonalView(userId, period)` behind `GET /api/v1/me/unified-view?period=<label>`; only spaces where u is or was a member, through the `SpaceMember` rows linked to u. A claimed guest place (HU-E1-11) contributes its full history, including shares recorded before the claim.
- consumption = Σ shares of u; cash out = Σ payments by u + Σ fund contributions by u + Σ savings transfers by u (spec 5.4).
- Seeded categories share a catalog key across spaces; custom categories group under "space / category".
- Shared transactions are placed by date into the viewer's personal-space period; grouping uses the category catalog key (spec D11).
- A subcategory (HU-E3-04, M3-D) groups under its parent category: under the parent's catalog key, or as "space / category" when the parent is custom.
- A row merged by catalog key takes its name from the viewer's personal space, or from the space where the row has the most spending when the personal space has none. Subcategories are never merged across spaces, because they carry no catalog key.

---

## HU-E7-05 — Period-over-period trend

- **Milestone:** M4 · **Priority:** Should · **Size:** S · **Depends on:** HU-E7-01, HU-E7-04 · **Module(s):** `reporting`

**User story:** As a household member, I want to compare spending period over period per line and for my own consumption, so that I can spot trends early.

```gherkin
Feature: Period-over-period trend

  Scenario: Line change versus the previous period
    Given "Home" spent 1,350,000 COP in the period 2026-10 and 1,300,000 COP in the period 2026-11
    When "Ana" requests the trend for "Household" ending 2026-11
    Then "Home" has a change of -50,000 COP (-3.70%)

  Scenario: Semi-monthly periods compare with the previous half-month
    Given the space "Casa" has the period policy SEMI_MONTHLY(1, 16)
    And "Home" spent 400,000 COP in "2026-10 H2", 500,000 COP in "2026-11 H1" and 450,000 COP in "2026-11 H2"
    When "Ana" requests the trend for "Casa" ending "2026-11 H2"
    Then "2026-11 H2" has a change of -50,000 COP (-10.00%) versus "2026-11 H1"
    And "2026-11 H1" has a change of 100,000 COP (25.00%) versus "2026-10 H2"

  Scenario: Six-period personal consumption series
    Given "Ana"'s personal space has the period policy MONTHLY(1) and she had consumption in each period from 2026-06 to 2026-11
    When "Ana" requests her personal trend ending 2026-11
    Then a series of 6 consumption values from 2026-06 to 2026-11 is returned

  Scenario: Line without a previous period
    Given the line "Pets" exists only in the 2026-11 plan with spent 80,000 COP
    When "Ana" requests the trend ending 2026-11
    Then "Pets" has the change status "NEW" and no percentage change
```

**Technical notes:**
- Queries: `GetLineTrend(spaceId, endPeriod, periods)`, `GetPersonalTrend(userId, endPeriod, periods)`. Endpoints: `GET /api/v1/spaces/{spaceId}/reports/trend?endPeriod=<label>&periods=<n>`, `GET /api/v1/me/trend?endPeriod=<label>&periods=<n>`.
- Each period is compared with the previous period of the same policy, not the calendar month (spec 5.3): for `SEMI_MONTHLY`, H2 compares with H1 of the same month and H1 with the previous month's H2.
- Percent change with two decimals; division by zero returned as the status `NEW` with a null percentage; default window 6 periods. Charts are web UI (HU-E9-11).

---

## HU-E7-06 — Spending by category group with drill-down

- **Milestone:** M4 · **Priority:** Must · **Size:** M · **Depends on:** HU-E3-02, HU-E3-04, HU-E3-05, HU-E7-04 · **Module(s):** `reporting`, `categories`

**User story:** As a household member (for my space) and as a user (across all my spaces), I want the spending of a period broken down by category group, then by category, then by subcategory, so that I can see where the money went at the level of detail I choose.

```gherkin
Feature: Spending by category group

  @critical
  Scenario: Group totals for a space in a period
    Given these November 2026 expenses in "Household", whose categories sit in the seeded groups of an English space:
      | category      | group   | amount        |
      | Rent          | Housing | 1,200,000 COP |
      | Groceries     | Food    | 900,000 COP   |
      | Utilities     | Housing | 400,000 COP   |
      | Entertainment | Leisure | 250,000 COP   |
      | Restaurants   | Food    | 60,000 COP    |
    When "Ana" requests the spending by group of "Household" for 2026-11
    Then the total spending is 2,810,000 COP
    And the groups are, in this order:
      | group   | total         | share  |
      | Housing | 1,600,000 COP | 56.94% |
      | Food    | 960,000 COP   | 34.16% |
      | Leisure | 250,000 COP   | 8.90%  |
    And groups without spending, such as "Transport", are not listed
    And "Sofi", who is VIEWER of "Household", gets the same figures

  Scenario: Drill down from a group to its categories and from a category to its subcategories
    Given the E7 shared fixture expenses of November 2026 in "Household" (HU-E7-01)
    And "Groceries" has the subcategories "Vegetables" and "Meat"
    And its 900,000 COP is recorded as 450,000 COP in "Groceries", 270,000 COP in "Vegetables" and 180,000 COP in "Meat"
    When "Ana" requests the spending by group of "Household" for 2026-11
    Then the group "Food" lists these categories:
      | category    | total       | share  |
      | Groceries   | 900,000 COP | 93.75% |
      | Restaurants | 60,000 COP  | 6.25%  |
    And the category "Groceries" lists these subcategories:
      | subcategory    | total       | share  |
      | no subcategory | 450,000 COP | 50.00% |
      | Vegetables     | 270,000 COP | 30.00% |
      | Meat           | 180,000 COP | 20.00% |

  Scenario: An expense in a subcategory counts in its category and in its group
    Given "Groceries" has the subcategory "Vegetables"
    And the October 2026 expenses in "Household" are 85,000 COP in "Groceries", 40,000 COP in "Vegetables" and 60,000 COP in "Restaurants"
    When "Ana" requests the spending by group of "Household" for 2026-10
    Then "Food" has the total 185,000 COP
    And "Groceries" has the total 125,000 COP, of which 40,000 COP is in "Vegetables"
    And the total spending is 185,000 COP, so the expense in "Vegetables" is counted once

  @critical
  Scenario: The personal breakdown merges seeded groups across spaces and keeps custom groups apart
    Given the November 2026 movements of the HU-E7-04 fixture
    And "Ana" spent 40,000 COP in the category "Vet" of the custom group "Pets" of her personal space "Personal"
    And "Household" has the custom group "Pets" with the category "Vet", where a 50,000 COP expense split "EQUAL" between "Ana" and "Juan" gives "Ana" the share 25,000 COP
    When "Ana" requests her spending by group for 2026-11
    Then her total spending is 1,640,000 COP
    And the groups are, in this order:
      | group   | key     | space     | total         | share  |
      | Food    | food    | null      | 1,095,000 COP | 66.77% |
      | Housing | housing | null      | 480,000 COP   | 29.27% |
      | Pets    | null    | Personal  | 40,000 COP    | 2.44%  |
      | Pets    | null    | Household | 25,000 COP    | 1.52%  |
    And inside "Food" the category "Groceries" is one row under the catalog key "groceries" with 1,035,000 COP from both spaces

  Scenario: Incomes, transfers, settlements and fund contributions are not spending
    Given the November 2026 movements of the HU-E7-04 fixture
    And on 2026-11-05 "Ana" recorded an income of 3,000,000 COP in "Salary" into "Bancolombia" and transferred 200,000 COP from "Bancolombia" to "Nequi"
    And on 2026-11-30 "Juan" settled 100,000 COP to "Ana" in "Household"
    When "Ana" requests her spending by group for 2026-11
    Then her total spending is 1,575,000 COP, equal to her consumption
    And no group "Income" is listed, and her 480,000 COP fund contribution of 2026-11-01 is in no group
    When "Ana" requests the spending by group of "Household" for 2026-11
    Then the total spending is 3,500,000 COP, with "Food" 2,300,000 COP (65.71%) and "Housing" 1,200,000 COP (34.29%)
    And the 1,200,000 COP rent paid from "Household Fund" counts once, while the settlement and the fund contributions count nowhere

  Scenario: A moved category counts under its current group
    Given the E7 shared fixture expenses of November 2026 in "Household" (HU-E7-01)
    And "Restaurants" had a 30,000 COP expense on 2026-10-08, recorded while it was in "Food"
    When "Ana" moves "Restaurants" from "Food" to "Leisure"
    And requests the spending by group of "Household" for 2026-11
    Then the groups are, in this order:
      | group   | total         | share  |
      | Housing | 1,600,000 COP | 56.94% |
      | Food    | 900,000 COP   | 32.03% |
      | Leisure | 310,000 COP   | 11.03% |
    When "Ana" requests the spending by group of "Household" for 2026-10
    Then "Leisure" has the 30,000 COP of "Restaurants", because the report reads the current tree
```

**Technical notes:**
- Decided 2026-10-16: category groups feed analytics. Until now no report used groups: lines map categories (HU-E6-04), the unified view groups by catalog key (HU-E7-04) and trends go by line (HU-E7-05). Those three are unchanged; this story adds one breakdown beside them.
- Queries: `GetSpendingByGroup(spaceId, period)` and `GetPersonalSpendingByGroup(userId, period)`. Endpoints: `GET /api/v1/spaces/{spaceId}/reports/spending-by-group?period=<label>` and `GET /api/v1/me/reports/spending-by-group?period=<label>`. The space breakdown is `space.read`: a VIEWER reads it, an archived space still reads it (HU-E1-09), and a non-member gets `SpaceNotFound` (404). `period` is required (`ValidationFailed` when missing) and a label the period policy does not produce answers `InvalidPeriodLabel` (422). The personal breakdown uses the viewer's personal-space period (HU-E7-04).
- What counts, in both queries: `EXPENSE` transactions that are not soft-deleted and fall in the period. The space breakdown sums the amount of each expense, whoever paid and from whichever account; an expense paid from the shared fund counts once, as an expense. The personal breakdown sums the viewer's consumption exactly as the unified view does (HU-E7-04, spec D11): the viewer's shares, placed by date into the personal period, in every space where the viewer is or was a member, with the history of a claimed guest place. It reuses the consumption rows of `GetUnifiedPersonalView` and only changes the grouping. Incomes, transfers (fund contributions and savings transfers among them) and settlements never count.
- The tree is the current one. An expense counts in `rollUp(categoryId)` (HU-E3-04: a subcategory counts in its category), and a category counts under the group it belongs to when the query runs. Nothing records when a category moved (HU-E3-02), so after a move the whole history of that category, in every period, counts under its new group; this is intended, and reorganizing the tree changes past totals by group. Archived groups, categories and subcategories (HU-E3-03) still appear when they have spending in the period, flagged `archived`; nodes without spending are not listed, and an empty period answers `total` 0 and `groups: []`.
- Response (codes and numbers only, never formatted text): `total` and `groups[]`, each group with `categories[]`, each category with `subcategories[]`. Every node has its `name`, `archived`, a `total` (`{ "amount": "…", "currency": "COP" }` in minor units) and a `share`: a decimal string in percent with two decimals, such as `"56.94"`, rounded half up. Groups and categories also carry `key` (the catalog key, or null).
- A `share` is relative to the parent: a group's is of the period total, a category's of its group, a subcategory entry's of its category. Each level is rounded on its own, so siblings may add up to 99.99 or 100.01.
- Spending recorded in a category itself, with no subcategory, is listed beside its subcategories as one extra entry whose `subcategoryId` is null (the web UI names it, HU-E9-10). A category without spending in subcategories has `subcategories: []`.
- Ordering at every level: `total` descending, ties by name ascending ignoring case. The entry without a subcategory goes last among equal totals, and in the personal breakdown equal names are ordered by space name.
- Personal rows: a seeded group merges across the viewer's spaces by its catalog `key`, and a seeded category by its `key` inside its group row. Such a row carries the `key` and no `id`, and the `name` it has in the viewer's personal space, or in the space where it has the most spending when the personal space has none (the rule of HU-E7-04). A custom group or category (no key) never merges: it carries its `id` and its `space` (`{ "id", "name" }`), and the web UI writes "space / group" or "space / category" (HU-E9-11). Subcategories have no key (HU-E3-04), so they are listed per space under their category. A category sits in the group of its own space, so one seeded category may appear under two group rows when a space moved it to another group.
- Group key: the immutable catalog `key` of seeded category groups (`housing`, `food`, `transport`, `health`, `leisure` and `income`) comes from HU-E3-05 (M3-D), which adds it and back-fills the groups of existing spaces; this story only reads it. Groups that users create (HU-E3-02) have none, and `GET /api/v1/spaces/{spaceId}/categories` returns the group `key` or null. A group that the back-fill left without a key shows as "space / group" in the personal breakdown.
- Not in scope: trends by group (HU-E7-05 stays by line), budget lines by group (HU-E6-04 maps categories) and filtering transactions by group. Charts, the drill-down navigation and the labels are web UI (HU-E9-10, HU-E9-11).
- **Spec impact:** 5.4 (a new derived metric: spending by group, category and subcategory with shares; the unified-view grouping also groups by the group key that HU-E3-05 adds to 5.2), section 7 (the two `spending-by-group` endpoints; shares as decimal strings in percent), section 6 (a new decision recording that category groups feed analytics and that a moved category counts under its current group).
