Feature: Shared expense form

  Background:
    Given "Ana" is signed in and "Household" has the members "Ana" and "Juan"

  @e2e
  Scenario: Equal split among the selected participants
    When "Ana" enters "Groceries" for 300,000 COP paid from "Bancolombia" and selects "Ana" and "Juan" as participants
    Then the preview shows 150,000 COP for "Ana" and 150,000 COP for "Juan"
    And after saving, the expense appears in the "Household" transaction list

  @e2e
  Scenario: The default split by allocation is preselected and can be overridden
    Given the 2026-11 plan of "Household" is "ACTIVE" and "Groceries" maps to "Home" allocated "Ana" 40% and "Juan" 60%
    When "Ana" enters an expense of 2,000,000 COP in "Groceries" dated 2026-11-08
    Then the split "BY_ALLOCATION" is preselected with 800,000 COP for "Ana" and 1,200,000 COP for "Juan"
    And switching to "EQUAL" updates the preview to 1,000,000 COP each

  @e2e
  Scenario: Correct the amount of a shared expense split equally
    Given "Ana" recorded "Groceries" in "Household" for 300,000 COP paid from "Bancolombia", split equally between "Ana" and "Juan"
    When "Ana" opens "Groceries" from the "Household" transaction list
    Then the detail sheet lists 150,000 COP for "Ana" and 150,000 COP for "Juan"
    When "Ana" chooses "Editar", changes the amount to 400,000 COP and saves
    Then the status message reads "Cambios guardados"
    And "Groceries" in "Household" has shares of 200,000 COP for "Ana" and 200,000 COP for "Juan"
