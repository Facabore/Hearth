@e2e
Feature: Warn before saving an expense that takes a plan line past 90% or over (#142)

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

  Scenario: An expense that leaves its line at 80 % saves at once
    When "Ana" records an expense of 20,000 COP in "Groceries" in "Household"
    Then the form notes "Con este gasto, Home quedaría en 89,79 % de lo planeado."
    And tapping "Guardar gasto" saves it without asking
