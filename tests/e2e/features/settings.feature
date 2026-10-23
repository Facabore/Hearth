Feature: Settings screen

  Background:
    Given "Ana" is signed in with the locale "es" and the timezone "America/Bogota"
    And the installation rules are numberFormat "DOT_COMMA", timeFormat "H24", dateFormat "DMY" and weekStart "MONDAY"

  @e2e
  Scenario: Change the formats and see them applied at once
    When "Ana" opens the Settings screen
    Then it shows the sections "Formats", "Region", "Appearance and language" and "Space"
    And the preview reads "1.234.567,89", "16/10/2026" and "14:30"
    When "Ana" chooses the number format "1,234,567.89", the date format "10/16/2026" and the time format "12-hour"
    Then each choice is stored as she makes it and the preview reads "1,234,567.89", "10/16/2026" and "2:30 PM"
    And the transaction list shows her amounts, dates and times in the new formats

  @e2e
  Scenario: Rename the personal space (#167)
    When "Ana" opens the Settings screen
    And she renames her space "Mis finanzas"
    Then it says "Guardado" and the space switcher and the Plan tab name her space "Mis finanzas"
