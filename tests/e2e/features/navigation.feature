Feature: Volver returns to where the person was, and a flow returns to where it started

  Background:
    Given the viewport is 390 by 844
    And "Ana" is signed in

  @e2e
  Scenario: Volver from Accounts returns to Movimientos, not to the home
    When "Ana" opens the Movimientos tab
    And "Ana" opens Accounts from her space's settings
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
    And "Ana" opens Accounts from her space's settings
    And "Ana" chooses Volver
    Then the transactions page is shown
    When "Ana" opens the Inicio tab
    And "Ana" opens Accounts from her space's settings
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
    And "Ana" opens Accounts from her space's settings
    And "Ana" creates the CASH account "Wallet" from the accounts screen
    Then the accounts screen is shown
    And the accounts screen lists "Wallet"
    When "Ana" chooses Volver
    Then the transactions page is shown

  @e2e
  Scenario: Crear un espacio compartido opens over Movimientos and its way back is the spaces
    When "Ana" opens the Movimientos tab
    And "Ana" opens Crear un espacio compartido from the space switcher
    Then the Crear espacio sheet is open over the transactions page
    When "Ana" goes back to the spaces in the sheet
    Then the space switcher lists her spaces

  @e2e
  Scenario: Creating a shared space from Movimientos lands in the new space
    When "Ana" opens the Movimientos tab
    And "Ana" opens Crear un espacio compartido from the space switcher
    And "Ana" creates the shared space "Household"
    Then the members screen of the new space "Household" is shown

  @e2e
  Scenario: Volver or Back from the new space returns to the screen the sheet opened over
    When "Ana" opens the Movimientos tab
    And "Ana" opens Crear un espacio compartido from the space switcher
    And "Ana" creates the shared space "Household"
    Then the members screen of the new space "Household" is shown
    When "Ana" chooses Volver
    Then the transactions page is shown
    When "Ana" opens Crear un espacio compartido from the space switcher
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

  # Ruling P303 (#240): the planner's sheet and forms leave without adding a history entry, so neither Volver nor the
  # browser's Back ever reopens them, and the planner keeps the main bar, the way out that always works.
  @e2e
  Scenario Outline: <leave> from the planner returns to Plan after she <action>
    When "Ana" opens the Plan tab of her personal space for 2026-11 and starts its plan
    And she <action>
    Then the planner is shown
    And the planner shows the main navigation
    When "Ana" <leave>
    Then the Plan tab of her personal space is shown

    Examples:
      | action                                   | leave                   |
      | saves her capacity 1,000,000 COP         | chooses Volver          |
      | saves her capacity 1,000,000 COP         | goes back in the browser |
      | closes the contributions sheet           | chooses Volver          |
      | closes the contributions sheet           | goes back in the browser |

  @e2e
  Scenario Outline: <leave> from the planner returns to Plan after adding a line, not to the line's form
    When "Ana" opens the Plan tab of her personal space for 2026-11 and starts its plan
    And she saves her capacity 1,000,000 COP
    And she adds the line "Mercado" with 200,000 COP
    Then the planner is shown
    When "Ana" <leave>
    Then the Plan tab of her personal space is shown

    Examples:
      | leave                    |
      | chooses Volver           |
      | goes back in the browser |

  # Ruling P302 (#240): the personal space has Saldos too, so its bar has the board's five slots.
  @e2e
  Scenario: Saldos in the personal space opens and says she is al día
    When "Ana" opens the Movimientos tab
    And "Ana" opens the Saldos tab
    Then the balances page of her personal space is shown
