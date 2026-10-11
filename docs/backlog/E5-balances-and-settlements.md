# E5 — Balances and settlements

**Goal:** every shared space shows who owes whom, members can settle up, and the app can suggest the fewest payments to clear all debts.

**Modules involved:** `balances` (read model), `ledger` (settlement transactions).

**Balance rule:** for each member m in a shared space, `net(m)` = Σ payments by m − Σ shares of m over non-deleted, member-paid expenses, plus settlements paid by m, minus settlements received by m. Positive means m is owed money. Fund-paid expenses and fund contributions create no debt (D5).

---

## HU-E5-01 — Compute who owes whom

- **Milestone:** M2 · **Priority:** Must · **Size:** M · **Depends on:** HU-E4-07, HU-E4-10 · **Module(s):** `balances`

**User story:** As a household member, I want to see the current balance between members, so that I know who owes whom without spreadsheets.

```gherkin
Feature: Balances in a shared space

  Background:
    Given the shared space "Household" with members "Ana" and "Juan"

  @critical
  Scenario: One equal split creates a debt
    Given "Ana" paid an expense of 300,000 COP split "EQUAL" between "Ana" and "Juan"
    When "Juan" views the balances of "Household"
    Then "Juan" owes "Ana" 150,000 COP

  Scenario: Debts net out across expenses
    Given "Ana" paid an expense of 300,000 COP split "EQUAL" between "Ana" and "Juan"
    And "Juan" paid an expense of 100,000 COP split "EQUAL" between "Ana" and "Juan"
    When "Ana" views the balances of "Household"
    Then "Juan" owes "Ana" 100,000 COP

  Scenario: Fund-paid expenses create no debt
    Given "Ana" paid an expense of 300,000 COP split "EQUAL" between "Ana" and "Juan"
    And an expense of 1,200,000 COP was paid from "Household Fund" split 40% / 60%
    When "Ana" views the balances of "Household"
    Then "Juan" owes "Ana" 150,000 COP

  Scenario: Deleted expenses are excluded
    Given "Ana" paid an expense of 300,000 COP split "EQUAL" that was soft-deleted
    When "Ana" views the balances of "Household"
    Then all net balances are 0 COP

  Scenario: Non-members cannot view balances
    Given "Pedro" is not a member of "Household"
    When "Pedro" requests the balances of "Household"
    Then the result is the error "NotASpaceMember"
```

**Technical notes:**
- Query: `GetSpaceBalances` returning `net(m)` per member and pairwise debts (for two members, pairwise equals net).
- Pure domain service `BalanceCalculator`; SQL aggregate adapter verified against the in-memory one with the same fixtures.
- Invariant: Σ net(m) over all members = 0.
- Public query `GetMemberNetBalance` consumed by `spaces` (HU-E1-08, HU-E1-09).

---

## HU-E5-02 — Record a settlement

- **Milestone:** M2 · **Priority:** Must · **Size:** M · **Depends on:** HU-E5-01 · **Module(s):** `ledger`, `balances`

**User story:** As a member who owes money, I want to record a payment to another member, so that our balance reflects that we settled up.

```gherkin
Feature: Settlements

  Background:
    Given the shared space "Household" where "Juan" owes "Ana" 1,200,000 COP

  @critical
  Scenario: Full settlement clears the balance
    When "Juan" records a settlement of 1,200,000 COP paid to "Ana" on 2026-10-30
    Then a transaction of type "SETTLEMENT" from "Juan" to "Ana" exists without a category
    And the net balance between "Juan" and "Ana" is 0 COP

  Scenario: Partial settlement reduces the debt
    When "Juan" records a settlement of 500,000 COP paid to "Ana"
    Then "Juan" owes "Ana" 700,000 COP

  Scenario: Over-settlement reverses the direction
    When "Juan" records a settlement of 1,300,000 COP paid to "Ana"
    Then "Ana" owes "Juan" 100,000 COP

  Scenario: Settlement with optional accounts updates account balances
    When "Juan" records a settlement of 1,200,000 COP from his account "Davivienda" to "Ana"'s account "Bancolombia"
    Then "Davivienda" decreases by 1,200,000 COP and "Bancolombia" increases by 1,200,000 COP

  Scenario: A member cannot settle with themselves
    When "Juan" records a settlement of 100,000 COP paid to "Juan"
    Then the result is the error "InvalidSettlementParties"
```

**Technical notes:**
- Use case: `RecordSettlement` (ledger); balances read it.
- Invariants: amount > 0; both parties current members; payer ≠ payee; accounts optional and, when set, owned by the respective party.

---

## HU-E5-03 — Suggest simplified settlements

- **Milestone:** M2 · **Priority:** Should · **Size:** M · **Depends on:** HU-E5-01 · **Module(s):** `balances`

**User story:** As a member of a group with several people, I want the app to suggest the fewest payments that clear all debts, so that settling up is quick.

```gherkin
Feature: Settlement suggestions

  Background:
    Given the shared space "Trip 2026" with members "Ana", "Juan" and "Luis"

  Scenario: Several debtors pay one creditor
    Given the net balances are "Ana" +150,000 COP, "Juan" -100,000 COP and "Luis" -50,000 COP
    When "Ana" requests settlement suggestions
    Then the suggestions are "Juan" pays "Ana" 100,000 COP and "Luis" pays "Ana" 50,000 COP

  Scenario: Chained debts collapse into one payment
    Given "Ana" owes "Juan" 100,000 COP and "Juan" owes "Luis" 100,000 COP
    When "Ana" requests settlement suggestions
    Then the only suggestion is "Ana" pays "Luis" 100,000 COP

  Scenario: Settled group has no suggestions
    Given every net balance is 0 COP
    When "Ana" requests settlement suggestions
    Then no suggestions are returned

  Scenario: Accepting a suggestion records a settlement
    Given the suggestion "Juan" pays "Ana" 100,000 COP
    When "Juan" accepts it
    Then a settlement of 100,000 COP from "Juan" to "Ana" is recorded
```

**Technical notes:**
- Domain service `DebtSimplifier`: greedy match of largest creditor with largest debtor; at most n − 1 suggestions for n members.
- Suggestions are computed on read and never stored.

---

## HU-E5-04 — Show balance history per member

- **Milestone:** M2 · **Priority:** Should · **Size:** S · **Depends on:** HU-E5-02 · **Module(s):** `balances`

**User story:** As a member, I want to see how my balance in a space evolved, so that I understand which expenses and settlements produced it.

```gherkin
Feature: Balance history

  Background:
    Given the shared space "Household" with members "Ana" and "Juan"
    And these movements:
      | date       | movement                                          |
      | 2026-10-03 | Ana pays 300,000 COP split EQUAL                  |
      | 2026-10-10 | Juan pays 100,000 COP split EQUAL                 |
      | 2026-10-30 | Juan settles 100,000 COP to Ana                   |

  Scenario: Running balance per movement
    When "Juan" views his balance history in "Household"
    Then the entries show his running net balance as -150,000 COP, -100,000 COP and 0 COP

  Scenario: History is limited to a period
    When "Juan" views his balance history for the period 2026-10-01 to 2026-10-15
    Then 2 entries are shown and the closing net balance is -100,000 COP

  Scenario: Deleted movements are not shown
    Given the 2026-10-10 expense was soft-deleted
    When "Juan" views his balance history
    Then the entries show -150,000 COP and -50,000 COP
```

**Technical notes:**
- Query: `GetMemberBalanceHistory` using a window function over balance-affecting rows ordered by date then createdAt.
- The opening balance for a period equals the net balance as of the day before the period start.
