Feature: Moving between screens: every address and every flow leads somewhere

  Background:
    Given the viewport is 390 by 844
    And "Ana" is signed in

  @e2e
  Scenario: An address that matches nothing shows the app's own page, with the way out
    When "Ana" opens the address "/nope"
    Then the not-found page is shown
    When "Ana" chooses the way out of the not-found page
    Then the home page of her personal space is shown

  @e2e
  Scenario: A space that does not exist shows the same page
    When "Ana" opens the address "/spaces/does-not-exist/accounts"
    Then the not-found page is shown

  @e2e
  Scenario: The not-found page wears the dark theme
    Given the browser prefers the dark color scheme
    When "Ana" opens the address "/spaces/does-not-exist/accounts"
    Then the not-found page is shown
    And the page background is the dark one

  @e2e
  Scenario: Settings opened from a shared space keeps that space's header and navigation
    Given "Ana" owns the shared space "Household"
    When "Ana" opens the home page of "Household" by its URL
    And "Ana" opens Ajustes from the user menu
    Then the shell of the screen is the one of "Household"
    When "Ana" taps Inicio in the navigation
    Then the home page of "Household" is shown

  @e2e
  Scenario: New space opened from a shared space keeps that space's header and navigation
    Given "Ana" owns the shared space "Household"
    When "Ana" opens the home page of "Household" by its URL
    And "Ana" opens the create-space link of the space switcher of "Household"
    Then the shell of the screen is the one of "Household"

  @e2e
  Scenario: A settings link that names a space that is not hers shows her personal shell
    When "Ana" opens the address "/settings?from=00000000-0000-0000-0000-000000000000"
    Then the shell of the screen is the one of "Personal"

  @e2e
  Scenario: A signed-in person who follows a sign-in link goes where next says
    Given "Ana" owns the shared space "Household"
    When "Ana" follows the sign-in link that leads to the members screen of "Household"
    Then the members screen of "Household" is shown

  @e2e
  Scenario: A sign-in link whose next is the API lands on the home, not on JSON
    When "Ana" opens the address "/sign-in?next=%2Fapi%2Fv1%2Fme"
    Then the home page of her personal space is shown

  @e2e
  Scenario: The record form's account picker creates an account and comes back to the form
    When "Ana" opens the new expense form
    And "Ana" opens the account picker of the form
    Then the picker explains that there are no accounts
    When "Ana" chooses "Nueva cuenta" in the picker
    And "Ana" saves the new CASH account "Wallet"
    Then the new expense form is shown with the account "Wallet"

  @e2e
  Scenario: Choosing a category filter on Movimientos replaces the entry, so Back leaves Movimientos
    Given "Ana" has the category "Tienda de barrio" in her personal space
    When "Ana" opens the Movimientos tab
    And "Ana" filters Movimientos by the category "Tienda de barrio"
    Then Movimientos shows the filter "Tienda de barrio"
    When "Ana" goes back in the browser
    Then the home page of her personal space is shown

  @e2e
  Scenario: Closing the settle-up sheet that a link opened takes ?settle= out of the address
    Given "Ana" owns the shared space "Household"
    When "Ana" opens the settle-up link of "Household"
    Then the settle-up sheet is open
    When "Ana" closes the settle-up sheet
    Then the address of the balances page of "Household" has no settle parameter
    And reloading the page leaves the settle-up sheet closed

  @e2e
  Scenario: Invitar on the home of a shared space opens the invite sheet of its members screen
    Given "Ana" owns the shared space "Household"
    When "Ana" opens the home page of "Household" by its URL
    And "Ana" chooses "Invitar" on the home page
    Then the invite sheet of "Household" is open on the members screen

  @e2e
  Scenario: Saldos of a shared space leads to its members
    Given "Ana" owns the shared space "Household"
    When "Ana" opens the home page of "Household" by its URL
    And "Ana" opens the Saldos tab
    And "Ana" chooses "Miembros" on the Saldos screen
    Then the members screen of "Household" is shown

  @e2e
  Scenario: Signing out keeps the language the person reads in, even in a browser that asks for English
    Given the browser asks for English
    When "Ana" chooses "Sign out" in the user menu
    Then the sign-in screen is shown

  @e2e
  Scenario: The amount groups its digits while it is typed
    When "Ana" opens the new expense form
    And "Ana" types the amount 6000
    Then the amount field reads "6.000"
