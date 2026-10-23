Feature: Space dashboards

  Background:
    Given the ACTIVE reference plan for 2026-11 in "Household" and the E7 shared fixture expenses

  @e2e @golden
  Scenario: Line dashboard shows planned, spent and available
    When "Ana" opens the dashboard of "Household" for 2026-11
    Then the bars and table show:
      | line       | planned       | spent         | available   |
      | Rent       | 1,200,000 COP | 1,200,000 COP | 0 COP       |
      | Home       | 1,470,000 COP | 1,300,000 COP | 170,000 COP |
      | Savings    | 600,000 COP   | 0 COP         | 600,000 COP |
      | Free       | 730,000 COP   | 250,000 COP   | 480,000 COP |
      | Unbudgeted | 0 COP         | 60,000 COP    | -60,000 COP |
