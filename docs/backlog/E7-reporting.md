# E7 — Reporting

**Goal:** answer the household's three questions — how each line did against the plan, how each member contributed versus what was assigned, and how much each person spent in total including shared expenses.

**Modules involved:** `reporting` (read models over `ledger`, `budgeting`, `balances`, `categories`, `spaces`).

All figures are computed on read (D7) and exclude soft-deleted transactions.

**Shared fixture for this epic:** shared space "Household", ACTIVE reference plan for 2026-11 (see E6), periodStartDay 1. Category mappings: "Rent" → Rent; "Groceries", "Utilities" → Home; "Entertainment" → Free; "Restaurants" unmapped.

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
    When "Ana" opens the dashboard for 2026-11
    Then the lines show:
      | line        | planned       | spent         | available   |
      | Rent        | 1,200,000 COP | 1,200,000 COP | 0 COP       |
      | Home        | 1,470,000 COP | 1,300,000 COP | 170,000 COP |
      | Savings     | 600,000 COP   | 0 COP         | 600,000 COP |
      | Free        | 730,000 COP   | 250,000 COP   | 480,000 COP |
      | Unbudgeted  | 0 COP         | 60,000 COP    | -60,000 COP |

  Scenario: Overspent line is highlighted
    Given an additional "Groceries" expense of 300,000 COP on 2026-11-20
    When "Ana" opens the dashboard for 2026-11
    Then "Home" shows spent 1,600,000 COP and available -130,000 COP
    And "Home" is marked as overspent

  Scenario: Available includes carry-over
    Given "Home" uses rollover "ROLLOVER" and had 200,000 COP available in 2026-10
    When "Ana" opens the dashboard for 2026-11
    Then "Home" shows available 370,000 COP

  Scenario: Month without a plan
    Given "Household" has no plan for 2027-01
    When "Ana" opens the dashboard for 2027-01
    Then all spending appears under "Unbudgeted"
    And "Ana" is offered to create or copy a plan
```

**Technical notes:**
- Query: `GetLineDashboard(spaceId, period)`; SQL aggregates grouped by line via the category mapping.
- Uses `RolloverCalculator` from `budgeting` for available amounts.
- Recharts bar per line; presentational component receives a DTO only.

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
    When "Ana" opens the member matrix for 2026-11
    Then the "Home" row shows:
      | member | assigned    | contributed | consumed    | gap          |
      | Ana    | 588,000 COP | 900,000 COP | 520,000 COP | 312,000 COP  |
      | Juan   | 882,000 COP | 400,000 COP | 780,000 COP | -482,000 COP |

  Scenario: Shared-fund lines defer contribution to the fund
    Given "Rent" is funded by "SHARED_FUND" and a 1,200,000 COP rent was paid from "Household Fund" split "BY_ALLOCATION"
    When "Ana" opens the member matrix for 2026-11
    Then the "Rent" row shows consumed 480,000 COP for "Ana" and 720,000 COP for "Juan"
    And contributed and gap for "Rent" read "tracked at fund level"

  Scenario: Positive gap means over-contribution
    When "Ana" opens the member matrix for 2026-11
    Then the gap of "Ana" on "Home" is labelled as over-contributed by 312,000 COP

  Scenario: Viewer can read the matrix
    Given "Sofi" is VIEWER of "Household"
    When "Sofi" opens the member matrix for 2026-11
    Then the matrix is displayed
```

**Technical notes:**
- Query: `GetMemberLineMatrix(spaceId, period)`.
- Metrics per spec 5.3: contributed = Σ payments by m on DIRECT lines; consumed = Σ shares of m; gap = contributed − assigned.
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
    When "Ana" opens fund tracking for 2026-11
    Then "Ana" shows expected 480,000 COP, actual 480,000 COP and difference 0 COP
    And "Juan" shows expected 720,000 COP, actual 500,000 COP and difference -220,000 COP

  Scenario: Contributions outside the period are excluded
    Given "Juan" contributed 720,000 COP on 2026-10-31
    When "Ana" opens fund tracking for 2026-11
    Then "Juan" shows actual 0 COP

  Scenario: Plan without shared-fund lines
    Given the 2026-12 plan has no "SHARED_FUND" lines
    When "Ana" opens fund tracking for 2026-12
    Then every member shows expected 0 COP
```

**Technical notes:**
- Query: `GetFundContributions(spaceId, period)`.
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

  @critical
  Scenario: Total consumption includes shares across spaces
    When "Ana" opens her unified view for 2026-11
    Then her total consumption is 1,575,000 COP
    And the view groups amounts by space and category

  @critical
  Scenario: Cash out versus consumption
    When "Ana" opens her unified view for 2026-11
    Then her cash out is 2,145,000 COP
    And her consumption is 1,575,000 COP

  Scenario: Other members' personal spaces are never included
    Given "Juan" recorded a personal expense of 90,000 COP
    When "Ana" opens her unified view for 2026-11
    Then the 90,000 COP expense of "Juan" is not included

  Scenario: Each space uses its own period start day
    Given "Household" has periodStartDay 25 and an expense with Ana's share 100,000 COP dated 2026-11-26
    When "Ana" opens her unified view for 2026-11
    Then the view states which period range was applied for each space
```

**Technical notes:**
- Query: `GetUnifiedPersonalView(userId, period)`; only spaces where u is or was a member.
- consumption = Σ shares of u; cash out = Σ payments by u (spec 5.3; fund contributions are not payments — see backlog report).
- Cross-space grouping by category is not defined by the spec (categories are per space); v1 groups by space and category.
- Shared transactions are placed by date into the viewer's personal-space period; grouping uses the category catalog key (spec D11).

---

## HU-E7-05 — Month-over-month trend

- **Milestone:** M4 · **Priority:** Should · **Size:** S · **Depends on:** HU-E7-01, HU-E7-04 · **Module(s):** `reporting`

**User story:** As a household member, I want to compare spending month over month per line and for my own consumption, so that I can spot trends early.

```gherkin
Feature: Month-over-month trend

  Scenario: Line change versus the previous month
    Given "Home" spent 1,350,000 COP in 2026-10 and 1,300,000 COP in 2026-11
    When "Ana" opens the trend for "Household" ending 2026-11
    Then "Home" shows a change of -50,000 COP (-3.70%)

  Scenario: Six-month personal consumption series
    Given "Ana" had consumption in each month from 2026-06 to 2026-11
    When "Ana" opens her personal trend ending 2026-11
    Then a series of 6 monthly consumption values from 2026-06 to 2026-11 is shown

  Scenario: Line without a previous month
    Given the line "Pets" exists only in the 2026-11 plan with spent 80,000 COP
    When "Ana" opens the trend ending 2026-11
    Then "Pets" shows "new" instead of a percentage change
```

**Technical notes:**
- Queries: `GetLineTrend(spaceId, endPeriod, months)`, `GetPersonalTrend(userId, endPeriod, months)`.
- Percent change with two decimals; division by zero rendered as "new".
- Recharts line chart; default window 6 months.
