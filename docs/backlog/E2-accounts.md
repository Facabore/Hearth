# E2 — Accounts

**Goal:** users model where their money lives — personal cash, bank, credit card and savings accounts, plus a shared fund per shared space — and see each account's balance computed from the ledger.

**Modules involved:** `accounts` (with read access to `ledger` for balances).

---

## HU-E2-01 — Create a personal account with an opening balance

- **Milestone:** M1 · **Priority:** Must · **Size:** S · **Depends on:** HU-E1-02 · **Module(s):** `accounts`

**User story:** As a user, I want to create my accounts with an opening balance, so that recorded transactions start from my real money position.

```gherkin
Feature: Create personal accounts

  Scenario: Create a bank account
    Given "Ana" is signed in
    When "Ana" creates the account "Bancolombia" of type "BANK" with opening balance 2,000,000 COP in her personal space
    Then the account belongs to her personal space
    And its ownerUserId is "Ana"

  Scenario: Credit card may start with a negative balance
    When "Ana" creates the account "Visa" of type "CREDIT_CARD" with opening balance -350,000 COP
    Then the account is created with opening balance -350,000 COP

  Scenario: Duplicate name in the same space is rejected
    Given "Ana" has an account named "Bancolombia"
    When "Ana" creates another account named "bancolombia"
    Then the result is the error "AccountNameTaken"

  Scenario: SHARED_FUND is not allowed in a personal space
    When "Ana" creates an account of type "SHARED_FUND" in her personal space
    Then the result is the error "SharedFundRequiresSharedSpace"
```

**Technical notes:**
- Use case: `CreateAccount`; port `AccountRepository`.
- Invariants: personal accounts live in the owner's PERSONAL space; name unique per space (case-insensitive); currency equals space currency.

---

## HU-E2-02 — Create a shared fund account

- **Milestone:** M2 · **Priority:** Must · **Size:** S · **Depends on:** HU-E1-05, HU-E2-01 · **Module(s):** `accounts`

**User story:** As a household admin, I want a shared fund account in our shared space, so that we can pool contributions and pay common expenses from it.

```gherkin
Feature: Shared fund account

  Background:
    Given "Ana" is OWNER and "Juan" is MEMBER of the shared space "Household"

  Scenario: Admin creates the household fund
    When "Ana" creates the account "Household Fund" of type "SHARED_FUND" with opening balance 0 COP in "Household"
    Then the account belongs to "Household"
    And its ownerUserId is empty

  Scenario: Member cannot create a shared fund
    When "Juan" creates an account of type "SHARED_FUND" in "Household"
    Then the result is the error "InsufficientRole"

  Scenario: Personal account types are not allowed in a shared space
    When "Ana" creates an account of type "BANK" in "Household"
    Then the result is the error "PersonalAccountRequiresPersonalSpace"
```

**Technical notes:**
- Use case: `CreateAccount` (same use case, type-dependent rules in the `Account` entity).
- Invariant: `SHARED_FUND` ⇔ space kind `SHARED` and `ownerUserId = null`.
- Milestone moved to M2 because shared spaces first exist in M2.

---

## HU-E2-03 — Edit and archive an account

- **Milestone:** M1 · **Priority:** Must · **Size:** S · **Depends on:** HU-E2-01 · **Module(s):** `accounts`

**User story:** As a user, I want to rename, correct the opening balance of, or archive an account, so that my account list stays accurate without losing history.

```gherkin
Feature: Edit and archive accounts

  Scenario: Correct the opening balance
    Given the account "Bancolombia" with opening balance 2,000,000 COP and no other changes
    When "Ana" changes the opening balance to 2,100,000 COP
    Then the account balance is recomputed as 2,100,000 COP

  Scenario: Account type cannot change
    When "Ana" changes the type of "Bancolombia" from "BANK" to "SAVINGS"
    Then the result is the error "AccountTypeImmutable"

  Scenario: Archived account keeps history but is not selectable
    Given "Nequi" has 3 transactions
    When "Ana" archives "Nequi"
    Then "Nequi" has archivedAt set
    And its 3 transactions remain listed
    And "Nequi" is not offered when recording a new transaction

  Scenario: Recording on an archived account is rejected
    Given "Nequi" is archived
    When "Ana" records an expense of 20,000 COP paid from "Nequi"
    Then the result is the error "AccountArchived"
```

**Technical notes:**
- Use cases: `UpdateAccount`, `ArchiveAccount`.
- Accounts are never hard-deleted once referenced (D8 spirit).

---

## HU-E2-04 — Show the computed account balance

- **Milestone:** M1 · **Priority:** Must · **Size:** M · **Depends on:** HU-E2-01, HU-E4-01, HU-E4-02, HU-E4-03 · **Module(s):** `accounts`, `ledger`

**User story:** As a user, I want each account's current balance computed from its transactions, so that I can trust the figure without maintaining it manually.

```gherkin
Feature: Computed account balance

  Scenario: Balance reflects all transaction types
    Given the account "Bancolombia" with opening balance 2,000,000 COP
    And an income of 3,000,000 COP into "Bancolombia"
    And an expense of 85,000 COP paid from "Bancolombia"
    And a transfer of 500,000 COP from "Bancolombia" to "Nequi"
    When "Ana" views her accounts
    Then "Bancolombia" shows a balance of 4,415,000 COP
    And "Nequi" shows a balance increased by 500,000 COP

  Scenario: Shared expense reduces the payer account by the full payment
    Given "Ana" paid a 300,000 COP shared expense from "Bancolombia" split equally with "Juan"
    When "Ana" views "Bancolombia"
    Then its balance decreased by 300,000 COP, not by her 150,000 COP share

  Scenario: Deleted transactions are excluded
    Given an expense of 85,000 COP from "Bancolombia" that was soft-deleted
    When "Ana" views "Bancolombia"
    Then the deleted expense does not affect the balance

  Scenario: Balance as of a date
    Given transactions on "Bancolombia" dated 2026-10-05 and 2026-11-03
    When "Ana" requests the balance as of 2026-10-31
    Then only the transaction dated 2026-10-05 is included
```

**Technical notes:**
- Query: `GetAccountBalances` computed on read with SQL aggregates (D7); no stored running totals.
- Balance = openingBalance + incomes in + transfers in − transfers out − payments out ± settlements with account set.
- Port: `LedgerReadModel` exposed by `ledger` application layer.
