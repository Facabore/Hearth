Feature: Budget planner

  Background:
    Given "Ana" is OWNER and "Juan" is MEMBER of "Household" with the period policy MONTHLY(1)

  @e2e @golden
  Scenario: Build the reference plan
    When "Ana" creates the 2026-11 plan and enters capacities "Ana" 1,600,000 COP and "Juan" 2,400,000 COP
    And adds "Rent" 1,200,000 COP funded by "SHARED_FUND", "Home" 1,470,000 COP "DIRECT", "Savings" 600,000 COP "SAVINGS" with a savings account and "Free" 730,000 COP "DIRECT" marked as catch-all, all with rollover "RESET"
    Then the planner shows total capacity 4,000,000 COP split 40.00% / 60.00%
    And it shows unallocated capacity 0 COP and "Home" at 36.75% of total capacity
