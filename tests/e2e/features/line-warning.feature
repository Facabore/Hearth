@e2e
Feature: Warn about an expense that takes a plan line past 80 %, and ask only over the plan (#142, #211)

  Background:
    Given "Ana" has the household "Household" with "Juan" as "MEMBER"
    And the ACTIVE plan for 2026-10 has the line "Home" with planned 1,470,000 COP and 1,300,000 COP spent in "Groceries"

  Scenario: An expense over its line asks first and still saves
    When "Ana" records an expense of 212,300 COP in "Groceries" in "Household" and taps "Guardar gasto"
    Then the form asks "¿Guardar de todos modos?" and says "Con este gasto te pasarías por $ 42.300 en Home."
    And nothing was saved
    When she taps "Guardar de todos modos"
    Then the expense is saved
    And the line dashboard for 2026-10 shows "Home" with available "−$ 42.300" and the badge "Excedida"

  Scenario: An expense that leaves its line above 90 % saves at once and says so
    When "Ana" records an expense of 85,000 COP in "Groceries" in "Household"
    Then the form notes "Con este gasto, Home quedaría en 94 % de lo planeado y le quedarían $ 85.000."
    And tapping "Guardar gasto" saves it without asking
    And the status message reads "Gasto guardado. Home quedó en 94 % de lo planeado y le quedan $ 85.000."

  Scenario: An expense that leaves its line at 80 % saves at once
    When "Ana" records an expense of 20,000 COP in "Groceries" in "Household"
    Then the form notes "Con este gasto, Home quedaría en 89 % de lo planeado."
    And tapping "Guardar gasto" saves it without asking
