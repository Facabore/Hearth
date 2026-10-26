Feature: Categories screen

  Background:
    Given "Ana" is signed in with the timezone "America/Bogota", the account "Bancolombia" with opening balance 2,000,000 COP and the category "Groceries" in her personal space

  @e2e
  Scenario: A referenced category is offered for archiving instead of deletion
    Given the category "Groceries" has 12 transactions
    When "Ana" opens the categories screen from her profile and deletes "Groceries"
    Then the message of the key "errors.CategoryInUse" is shown with the action "Archive instead"
    When "Ana" chooses "Archive instead"
    Then "Groceries" moves to the archived section and is no longer offered in the expense form
