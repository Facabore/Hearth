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
- Reads each plan's figures, carry-over included, through budgeting's `loadPlanView` (M4 ruling P32), so the dashboard shows exactly what `GET …/plans/{planId}` derives. Charts and the "create or copy a plan" prompt are web UI (HU-E9-10).
- `GET …/reports/lines?period=<label>` is `space.read` (every role; archived spaces read, HU-E1-09). The period is the stored period with that label, else the policy's period (D10); the plan is the one whose stored period it is, whatever its status (M4 ruling P33). Each line carries `planned`, `spent`, `carryOver`, `available` and `overspent` (available < 0), exactly as `GET …/plans/{planId}` derives them; `unbudgeted` (`spent`, `available` = −spent, `overspent`) holds what no line consumes and is null when the plan has a catch-all line (ruling P34). `totals` answers Σ `planned` of the lines, and Σ `spent` and Σ `available` of the lines plus Unbudgeted (M6c ruling P201). `categoryLines` names, for every live category of the space, the line its expenses consume in the plan (its mapped line, its parent's line for a subcategory, else the catch-all line), or null for Unbudgeted (M6c ruling P234). Each line answers its `state` (OK, NEAR from 80 % used, HIGH above 90 %, OVER) against planned + carry-over, and an OVER line its `overBy` (M6c ruling P244). Without a plan, `plan` is null, `lines` is empty and every expense is under `unbudgeted`. Pending occurrences are not reported as "expected" (ruling P34). Errors: `SpaceNotFound` (404), `ValidationFailed` and `InvalidPeriodLabel` (422).

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
- `GET …/reports/member-matrix?period=<label>` is `space.read` and finds the period and its plan like HU-E7-01 (M4 ruling P33). Each line carries `funding`, `rule`, `reason` and every current member in join order, guests included (ruling P7), with `assigned`, `contributed`, `consumed`, `gap` and `status`. Expenses count on the line their category consumes (its mapping, else the catch-all line; unmapped ones without a catch-all are not in the matrix), a subcategory's on its parent category's line (HU-E3-04, M4 ruling P96). Reasons: `NOT_ALLOCATED` (rule NONE: only `consumed`), `TRACKED_AT_FUND_LEVEL` (SHARED_FUND: `contributed` and `gap` null, HU-E7-03 tracks them), `INVALID_ALLOCATION` (`assigned` and `gap` null). Statuses: `OVER_CONTRIBUTED` (gap > 0), `UNDER_CONTRIBUTED` (gap < 0), `ON_TARGET` (0). SAVINGS lines have no `consumed`; their `contributed` is what reached each account the line names, credited to the account's owner, only for accounts of current registered members (ruling P35, P8). Without a plan, `lines` is empty. Errors: `SpaceNotFound` (404), `ValidationFailed` and `InvalidPeriodLabel` (422).

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
- `GET …/reports/fund-contributions?period=<label>` is `space.read` and finds the period and its plan like HU-E7-01 (M4 ruling P33). It lists every current member in join order (ruling P7) with `expected` (Σ assigned over the plan's SHARED_FUND lines; a NONE line or an invalid allocation assigns nothing; 0 without a plan), `actual` (Σ the member's live fund contributions recorded in the space and dated in the period, from outside the app included) and `difference` = actual − expected (ruling P36). Errors: `SpaceNotFound` (404), `ValidationFailed` and `InvalidPeriodLabel` (422).
- `totals` answers Σ `expected`, `actual` and `difference` over the listed members (M6c ruling P201).

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
- A row merged by catalog key takes its name from the viewer's personal space, or from the space where the row has the most spending when the personal space has none. A subcategory never forms a group of its own: its consumption counts in its parent category first, even when it keeps a catalog key from the seed.
- `GET /api/v1/me/unified-view?period=<label>` reads only the caller's own member rows: every row linked to them, current or former, a claimed guest place's history included, archived spaces too (M4 ruling P37). The label names a period of the caller's personal space (its stored period first, D10). `consumption.total` sums the caller's shares of live expenses dated in it; `consumption.categories` groups them by catalog `key` (seeded categories of every space together) or, for custom categories, by `space` and `category`, the largest first; a subcategory's consumption counts in its parent category (HU-E3-04), and each group carries a `name`: a merged group's is the one the caller's personal space gives its key, else the one in the space with the most consumption in it, ties by space name (rulings P76, P95). `cashOut` = `payments` (of live expenses) + `fundContributions` + `savingsTransfers` (live transfers into the caller's own SAVINGS accounts; a transfer into an INVESTMENT account is not cash out, M4 ruling P97), with `outsideTheApp`, the part paid without an account; settlements are not cash out. Amounts are in the personal space's currency; spaces in another currency are left out and listed in `otherCurrencySpaces` (D6). Errors: `Unauthenticated` (401), `ValidationFailed` and `InvalidPeriodLabel` (422).

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
- `GET /api/v1/me/trend?endPeriod=<label>&periods=<n>` gives the caller's `consumption` per period of their personal space's policy, as HU-E7-04 totals it from their own member rows only, with the window, query and change fields of the line trend below; a period without consumption counts 0, so the next one is `NEW`. Amounts are in the personal space's currency; spaces in another currency are left out of every sum, as in the unified view (M4 ruling P37), but this response does not list them. Errors: `Unauthenticated` (401), `ValidationFailed` and `InvalidPeriodLabel` (422).
- `GET …/reports/trend?endPeriod=<label>&periods=<n>` is `space.read`; `periods` runs from 1 to 24, 6 by default (M4 ruling P38). `periods` lists the window oldest first, ending with `endPeriod`; each line of the end period's plan is followed back by its origin link, else its name (case ignored), and each of its points carries the period's label, `spent` (null where the line has no figure), `change`, `changePercent` (signed, two decimals, rounded half away from zero, "-3.70") and `changeStatus` (`NEW`, `INCREASED`, `DECREASED`, `UNCHANGED`; `NEW`, with change and percentage null, when the previous figure is missing or 0). The first period shown is compared with the one before it. Without a plan for `endPeriod`, `plan` is null and there are no lines; unbudgeted spending is not trended. Errors: `SpaceNotFound` (404), `ValidationFailed` and `InvalidPeriodLabel` (422).
- A window never lists two periods under one label (ruling of #132, both trends). A stored period that runs past its month (Oct 5 – Nov 4, labelled `2026-10`) leaves the days before it (Oct 1–4) as a derived stub that is also named `2026-10` (HU-E1-03). The stub stays in the window, because it is a real period with its own figures, and is not merged into the stored period, which would make "versus the previous period" compare unlike spans. The stored period keeps the label that names it in every other report (`period=2026-10` always resolves to it); each other period sharing it is written `<label> (<start>..<end>)`, e.g. `2026-10 (2026-10-01..2026-10-04)`, in `periods[].label` and in `points[].period` alike, so `points[].period` is unique and equal to `periods[i].label`. When no period of the label is stored, the earliest keeps it. Windows without a stub are unchanged, and no existing client breaks: the label only differs where it used to be ambiguous, and a client that navigated by that label reached the stored period, not the stub.

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
- `GET /api/v1/spaces/{spaceId}/reports/spending-by-group?period=<label>` is `space.read` (every role; archived spaces read, HU-E1-09). The period is the stored period with that label, else the policy's period (D10). It sums the amount of every live expense of the space dated in it, whoever paid and from whichever account, through the same ledger sum as the line dashboard (M4 ruling P80), and places it in `rollUp(categoryId)` under the group that category sits in now. The answer holds `spaceId`, `period`, `total` and `groups[]` → `categories[]` → `subcategories[]`; groups and categories carry `id`, `key`, `name`, `archived`, `total` and `share`, subcategory entries `subcategoryId`, `name`, `archived`, `total` and `share` (rulings P75, P82); the category's own-spending entry has `subcategoryId` and `name` null and `archived: false` (ruling P103), and `key` is null for custom groups and categories. Errors: `SpaceNotFound` (404), `ValidationFailed` and `InvalidPeriodLabel` (422).
- `GET /api/v1/me/reports/spending-by-group?period=<label>` groups the caller's consumption exactly as `GET /api/v1/me/unified-view` sums it: their own member rows only (another member's personal expense never reaches it), their personal period (its stored period first, D10) and the personal space's currency, spaces in another currency left out (D6, M4 ruling P82). Only live expenses count, so an income, a transfer, a settlement and a fund contribution fall in no group, and an expense paid from the shared fund counts once, as the caller's share. It answers `currency`, `period`, `total` and the tree of the space breakdown with `space` (`{ id, name }` or null) on every node. Rows, names and subcategories follow the personal rows above; under a merged category the entry without a subcategory sums every space's spending in the category itself (rulings P76, P81). A merged group row takes its name from the caller's personal space's group of that key even when the group holds no live category, because the `CategoryTrees` port lists groups as well as categories (#130). Only a merged row loses its `id` and `space`: inside a custom group row every category keeps its own, a seeded one moved there included (P102). Only a top-level category lends its name to a merged row, so a keyed subcategory never names one (P101), and the own-spending entry of a category (`subcategoryId` and `name` null) is never archived (P103) and always answers `space: null`, because it is no node of any tree and the category row above it carries the space (P104). Errors: `Unauthenticated` (401, no session), `ValidationFailed` (422, a missing `period`) and `InvalidPeriodLabel` (422). It needs no space action, so a VIEWER reads their own rows too.
- **Spec impact:** 5.4 (a new derived metric: spending by group, category and subcategory with shares; the unified-view grouping also groups by the group key that HU-E3-05 adds to 5.2), section 7 (the two `spending-by-group` endpoints; shares as decimal strings in percent), section 6 (a new decision recording that category groups feed analytics and that a moved category counts under its current group).

## Addition taken into M6c: the cash-flow calendar (#150)

Issue #150 asks for the money that will come in and go out over the next 30 and 60 days, by day, with the balance projected after each. M6c takes it in as an addition to this epic (rulings P238–P240 and P245–P246 of the M6c plan).

- `GET /api/v1/me/cash-flow?days=30|60` answers it for the signed-in person: 30 days unless 60 is asked for, and any other value is `ValidationFailed` (422). The window runs from today in the caller's zone through today + days − 1.
- It lists the scheduled movements of every space the caller is a current member of (archived spaces left out) that debit or credit an account the caller owns: the schedule dates of active recurrences and every pending occurrence, fund contributions that recur included. A bill the fund pays and another member's bill are left out. Nothing new is stored (D7).
- It starts from today's "Disponible" of the personal space (HU-E2-07) as `opening`. A movement's `effect` is the signed change of that money: + into a counted account, − out of one, and 0 between two counted accounts or two uncounted ones. Each date answers its `balanceAfter`; the answer also holds `totals` (`incoming`, `outgoing`, `closing`) and the `lowest` balance with its first date. A movement due before today (a pending occurrence) is listed on today, with its `dueDate`, and a day's pending ones come first. A CONFIRM recurrence's amount is flagged `estimated`.
- It projects only known future items: a one-off expense moves today's opening and adds no future date, and no pace is estimated from past spending (P245). Dates are local dates; "today" is the caller's own (P246). A movement in another currency is left out and its space named once in `otherCurrencySpaces`.
