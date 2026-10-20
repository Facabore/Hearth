Feature: App shell and authentication screens

  @e2e
  Scenario: Sign up lands in the personal space
    Given a visitor on the sign-up screen
    When the visitor enters the name "Ana", the email "ana@example.com" and a 12-character password and submits
    Then the visitor lands on the home page of her personal space
    And the shell shows "Ana" in the user menu and the personal space in the space switcher

  @e2e
  Scenario: Sign out returns to the sign-in screen
    Given "Ana" is signed in
    When "Ana" chooses "Sign out" in the user menu
    Then the sign-in screen is shown
    And opening the home page again redirects to the sign-in screen
