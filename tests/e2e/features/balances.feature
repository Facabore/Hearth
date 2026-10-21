Feature: Balances and settle-up screen

  @e2e
  Scenario: Settle up from a suggestion
    Given in "Trip 2026" the net balances are "Ana" +150,000 COP, "Juan" -100,000 COP and "Luis" -50,000 COP
    When "Juan" opens the balances screen and chooses "Settle" on the suggestion "Juan pays Ana 100,000 COP"
    And confirms the prefilled settlement form
    Then a settlement of 100,000 COP from "Juan" to "Ana" is listed
    And "Juan" shows a net balance of 0 COP
