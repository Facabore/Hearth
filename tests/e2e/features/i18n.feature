Feature: Localized interface

  @e2e
  Scenario: Spanish is the default locale
    Given a visitor whose browser sends no supported language preference
    When the visitor opens the sign-in page
    Then the page is rendered in Spanish
