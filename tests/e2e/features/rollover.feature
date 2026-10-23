@e2e
Feature: A plan line's leftover rolls into the next period (#143)

  Background:
    Given "Ana" has the household "Household" with "Juan" as "MEMBER"

  Scenario: A copy of a closed plan shows what its ROLLOVER line carried in, and from where
    Given the CLOSED plan for 2026-09 has the line "Home" with rollover "ROLLOVER", planned 1,470,000 COP and 1,300,000 COP spent in "Groceries"
    When "Ana" copies the plan into 2026-10 and opens the line dashboard for 2026-10
    Then "Home" shows "+$ 170.000 de septiembre 2026" and available "$ 1.640.000"

  Scenario: A copy of a plan that is not closed carries nothing yet
    Given the ACTIVE plan for 2026-10 has the line "Home" with rollover "ROLLOVER", planned 1,470,000 COP and 1,300,000 COP spent in "Groceries"
    When "Ana" copies the plan into 2026-11 and opens the line dashboard for 2026-11
    Then "Home" shows "Se arrastra de octubre 2026 cuando ese plan se cierre." and available "$ 1.470.000"
