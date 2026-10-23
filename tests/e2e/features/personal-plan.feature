Feature: Personal plan

  @e2e
  Scenario: Plan the personal budget from the Plan tab of the personal space
    Given "Ana" is signed in
    When "Ana" opens the Plan tab of her personal space for 2026-11 and starts its plan
    And she enters her capacity 3,000,000 COP and adds "Groceries" 800,000 COP marked as catch-all
    And she activates the plan
    Then the Plan tab of her personal space shows the 2026-11 plan as active, with the link to edit it
