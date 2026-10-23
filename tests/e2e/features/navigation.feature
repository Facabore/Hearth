Feature: Volver returns to where the person was, and a flow returns to where it started

  Background:
    Given the viewport is 390 by 844
    And "Ana" is signed in

  @e2e
  Scenario: Volver from Accounts returns to Movimientos, not to the home
    When "Ana" opens the Movimientos tab
    And "Ana" opens Accounts from the user menu
    Then the accounts screen is shown
    When "Ana" chooses Volver
    Then the transactions page is shown

  @e2e
  Scenario: A screen opened by its URL in a new tab has no history, so Volver goes to its parent
    When "Ana" opens the Movimientos tab
    And "Ana" opens the accounts screen by its URL in a new tab
    And "Ana" chooses Volver
    Then the home page of her personal space is shown

  @e2e
  Scenario: Moving between tabs does not build a history that Volver has to unwind
    When "Ana" opens the Movimientos tab
    And "Ana" opens the Inicio tab
    And "Ana" opens the Movimientos tab
    And "Ana" opens Accounts from the user menu
    And "Ana" chooses Volver
    Then the transactions page is shown
    When "Ana" opens the Inicio tab
    And "Ana" opens Accounts from the user menu
    And "Ana" chooses Volver
    Then the home page of her personal space is shown

  @e2e
  Scenario: Creating the first account from the home returns to the home
    Given "Ana" archived her starter accounts
    When "Ana" chooses "Ir a Cuentas" on the first-account card of the home page
    And "Ana" creates the CASH account "Wallet" from the accounts screen
    Then the home page of her personal space is shown
    And the home page lists the account "Wallet"

  @e2e
  Scenario: Creating an account from Accounts returns to Accounts, and Volver skips the form
    When "Ana" opens the Movimientos tab
    And "Ana" opens Accounts from the user menu
    And "Ana" creates the CASH account "Wallet" from the accounts screen
    Then the accounts screen is shown
    And the accounts screen lists "Wallet"
    When "Ana" chooses Volver
    Then the transactions page is shown

  @e2e
  Scenario: Volver from New space returns to Movimientos
    When "Ana" opens the Movimientos tab
    And "Ana" opens the create-space link of the space switcher
    And "Ana" chooses Volver
    Then the transactions page is shown

  @e2e
  Scenario: Creating a shared space from Movimientos lands in the new space
    When "Ana" opens the Movimientos tab
    And "Ana" opens the create-space link of the space switcher
    And "Ana" creates the shared space "Household"
    Then the members screen of the new space "Household" is shown

  @e2e
  Scenario: The form that created a space is not in the history Volver or Back returns to
    When "Ana" opens the Movimientos tab
    And "Ana" opens the create-space link of the space switcher
    And "Ana" creates the shared space "Household"
    Then the members screen of the new space "Household" is shown
    When "Ana" chooses Volver
    Then the transactions page is shown
    When "Ana" opens the create-space link of the space switcher
    And "Ana" creates the shared space "Club"
    And "Ana" goes back in the browser
    Then the transactions page is shown

  @e2e
  Scenario: Volver after signing in from a typed link does not leave the app
    Given "Ana" owns the shared space "Household"
    When "Ana" opens the members screen of "Household" by its URL while signed out
    And "Ana" signs in again
    Then the members screen of "Household" is shown
    When "Ana" chooses Volver
    Then the home page of "Household" is shown

  @e2e
  Scenario: Volver from a balance history returns to Saldos, not to the previous period
    Given "Ana" owns the shared space "Household"
    When "Ana" opens the home page of "Household" by its URL
    And "Ana" opens the Saldos tab
    And "Ana" opens her balance history from Saldos
    And "Ana" steps to the previous period 2 times
    And "Ana" chooses Volver
    Then the balances page of "Household" is shown
