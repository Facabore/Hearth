Feature: Personal ledger screens

  Background:
    Given "Ana" is signed in with the timezone "America/Bogota", the account "Bancolombia" with opening balance 2,000,000 COP and the category "Groceries" in her personal space

  @e2e
  Scenario: Record a personal expense from the form
    Given the Clock reads 2026-11-01T04:30:00Z
    When "Ana" opens the new expense form
    Then the date and time chip reads "Today · 23:30"
    When "Ana" enters "Market", 85,000 COP, "Groceries" and "Bancolombia" and saves
    Then the transaction has date 2026-10-31, occurredAt "2026-11-01T04:30:00Z" and timeZone "America/Bogota"
    And the transaction list shows "Market" with 85,000 COP at 23:30 under the day heading of the key "ledger.day.today"
    And the accounts screen shows "Bancolombia" with a balance of 1,915,000 COP

  @e2e
  Scenario: Accounts screen shows types, balances and totals
    Given an income of 3,000,000 COP into "Bancolombia", an expense of 85,000 COP from "Bancolombia" and a transfer of 500,000 COP from "Bancolombia" to the WALLET "Nequi" opened with 0 COP
    And the CREDIT_CARD "Visa" with balance -350,000 COP, credit limit 5,000,000 COP and payment day 15
    And "Ana" archived the account "Old wallet"
    When "Ana" opens the accounts screen
    Then "Bancolombia" shows a balance of 4,415,000 COP with its type icon, color, institution and last four digits
    And "Visa" shows -350,000 COP with an available credit of 4,650,000 COP and its next payment date
    And the header shows "Available" 4,915,000 COP and "Net worth" 4,565,000 COP
    And "Old wallet" is listed under archived accounts and is not offered in the account picker of the new expense form

  @e2e
  Scenario Outline: Pick yesterday at 19:00 in two steps
    Given the Clock reads 2026-10-17T03:30:00Z
    And "Ana" has the timeFormat "<timeFormat>" and the weekStart "MONDAY"
    When "Ana" opens the date and time sheet of the new expense form
    Then the quick-day buttons "Today", "Yesterday" and "The day before yesterday" are shown above a month calendar whose week starts on Monday
    When "Ana" chooses "Yesterday"
    And sets the time to 19:00
    Then the sheet clock shows "<clock>"
    And the chip reads "<chip>"
    When "Ana" enters "Market", 85,000 COP, "Groceries" and "Bancolombia" and saves
    Then the transaction has date 2026-10-15, occurredAt "2026-10-16T00:00:00Z" and timeZone "America/Bogota"

    Examples:
      | timeFormat | clock                   | chip                |
      | H24        | 19 : 00                 | Yesterday · 19:00   |
      | H12        | 7 : 00 with PM selected | Yesterday · 7:00 PM |
