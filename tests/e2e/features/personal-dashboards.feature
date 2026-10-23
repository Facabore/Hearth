Feature: Personal dashboards

  @e2e
  Scenario: Unified view totals across spaces
    Given "Ana" has the November 2026 movements of the HU-E7-04 fixture
    When "Ana" opens her unified view for 2026-11
    Then it shows consumption 1,575,000 COP and cash out 2,625,000 COP
    And "Groceries" from her personal space and "Household" is one row of 1,035,000 COP
