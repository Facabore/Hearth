@e2e
Feature: A cash-flow calendar of the next 30 and 60 days (#150)

  Scenario: The calendar projects Ana's own account
    Given "Ana" has only the BANK account "Bancolombia" with 900,000 COP
    And she recorded a one-off expense of 400,000 COP from "Bancolombia" today, which is not repeated
    And her "Salario" of 3,000,000 COP comes into "Bancolombia" every month on day 30 from 2026-11-01
    And her "Internet" of 120,000 COP is paid from "Bancolombia" every month on day 5 from 2026-11-05
    When she opens "Próximos" with 60 days
    Then the days read
      | date       | movement | amount        | balance after |
      | 5/11/2026  | Internet | −$ 120.000    | $ 380.000     |
      | 30/11/2026 | Salario  | +$ 3.000.000  | $ 3.380.000   |
      | 5/12/2026  | Internet | −$ 120.000    | $ 3.260.000   |
    And the summary reads "Lo más bajo: $ 380.000 el 5/11/2026"
