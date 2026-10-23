Feature: Fix a mistake in a transaction

  Background:
    Given "Ana" is signed in with the timezone "America/Bogota", the account "Bancolombia" with opening balance 2,000,000 COP and the category "Groceries" in her personal space
    And the Clock reads 2026-11-01T04:30:00Z
    And "Ana" recorded "Market" for 85,000 COP in "Groceries" from "Bancolombia"

  @e2e
  Scenario: Edit an expense from its detail sheet
    When "Ana" opens "Market" from the transaction list
    Then the detail sheet shows "Gasto", 85,000 COP, "Groceries" and "Bancolombia"
    When "Ana" chooses "Editar", changes the amount to 95,000 COP and the description to "Supermarket" and saves
    Then the status message reads "Cambios guardados"
    And the transaction list shows "Supermarket" with 95,000 COP
    And the accounts screen shows "Bancolombia" with a balance of 1,905,000 COP

  @e2e
  Scenario: Delete an expense and undo it
    When "Ana" opens "Market" from the transaction list and chooses "Eliminar"
    Then the status message reads "Gasto eliminado" with the action "Deshacer"
    And "Market" is not in the transaction list
    When "Ana" chooses "Deshacer"
    Then the status message reads "Gasto restaurado"
    And the transaction list shows "Market" with 85,000 COP
    And the accounts screen shows "Bancolombia" with a balance of 1,915,000 COP

  @e2e
  Scenario: A version conflict asks to load the latest version
    Given "Ana" opened the edit form of "Market"
    And "Market" was renamed to "Market (Ana's phone)" somewhere else
    When "Ana" changes the amount to 90,000 COP and saves
    Then the form shows the message of the key "errors.PreconditionFailed"
    And the amount of "Market" is still 85,000 COP
    When "Ana" chooses "Cargar la última versión"
    Then the form shows the description "Market (Ana's phone)" and the amount 85,000 COP

  @e2e
  Scenario: Recording an expense says it was saved
    When "Ana" opens the new expense form
    And "Ana" enters "Bakery", 12,000 COP, "Groceries" and "Bancolombia" and saves
    Then the status message reads "Gasto guardado"
