# E4 — Ledger

**Goal:** record every money movement — personal and shared expenses, income, transfers and fund contributions — on one ledger model where a personal expense is a shared expense with one participant (D2).

**Modules involved:** `ledger` (with read access to `accounts`, `categories`, `spaces`; `budgeting` for the closed-period guard once M3 lands).

**Shared invariant for all expenses:** Σ payments = Σ shares = amount (error `SharesDoNotMatchAmount`).

**Payers and participants:** every payment and share references a `SpaceMember` (`memberId`), registered or guest (spec 5.2, D15). Guests are current members of their space, can pay and take part like anyone else, and have no accounts.

---

## HU-E4-01 — Record a personal expense

- **Milestone:** M1 · **Priority:** Must · **Size:** M · **Depends on:** HU-E0-04, HU-E2-01, HU-E3-01 · **Module(s):** `ledger`

**User story:** As a user, I want to record an expense in my personal space, so that I know where my money goes.

```gherkin
Feature: Record a personal expense

  Background:
    Given "Ana" has the account "Bancolombia" in her personal space
    And her personal space has the category "Groceries"

  @critical
  Scenario: Record an expense
    When "Ana" records an expense "Market" of 85,000 COP on 2026-10-05 in "Groceries" paid from "Bancolombia"
    Then a transaction of type "EXPENSE" with amount 85,000 COP exists in her personal space
    And it has one payment of 85,000 COP by "Ana" from "Bancolombia"
    And it has one share of 85,000 COP for "Ana"

  Scenario: Date defaults to today in the space timezone
    Given the Clock reads 2026-11-01T04:30:00Z
    When "Ana" opens the new expense form
    Then the date field defaults to 2026-10-31

  Scenario Outline: Invalid amounts are rejected
    When "Ana" records an expense of <amount> COP
    Then the result is the error "InvalidAmount"

    Examples:
      | amount  |
      | 0       |
      | -10,000 |

  Scenario: Category is required for expenses
    When "Ana" records an expense of 85,000 COP without a category
    Then the result is the error "CategoryRequired"

  Scenario: Paying from another user's account is rejected
    Given "Juan" owns the account "Davivienda"
    When "Ana" records an expense of 85,000 COP paid from "Davivienda"
    Then the result is the error "AccountNotOwned"
```

**Technical notes:**
- Use case: `RecordExpense` (single use case for personal and shared expenses; personal = one participant).
- `Transaction` aggregate owns `Payment[]` and `Share[]`; invariant enforced in the entity.
- Ports: `TransactionRepository`, `AccountReader`, `CategoryReader`, `Clock`.
- Audit fields `createdBy`, `createdAt` on every write (D8).

---

## HU-E4-02 — Record income

- **Milestone:** M1 · **Priority:** Must · **Size:** S · **Depends on:** HU-E2-01, HU-E3-01 · **Module(s):** `ledger`

**User story:** As a user, I want to record income into one of my accounts, so that my balances and monthly view reflect what I earn.

```gherkin
Feature: Record income

  Scenario: Record a salary
    When "Ana" records an income "Salary October" of 3,200,000 COP on 2026-10-25 into "Bancolombia" in "Salary"
    Then a transaction of type "INCOME" with amount 3,200,000 COP exists
    And its destination account is "Bancolombia" and its receiving member is "Ana"

  Scenario: Income into an archived account is rejected
    Given "Nequi" is archived
    When "Ana" records an income of 100,000 COP into "Nequi"
    Then the result is the error "AccountArchived"

  Scenario: Income does not count as spending
    Given "Ana" recorded an income of 3,200,000 COP and an expense of 85,000 COP in October 2026
    When "Ana" views her October 2026 spending total
    Then the total is 85,000 COP
```

**Technical notes:**
- Use case: `RecordIncome`.
- Invariant: destination account in the same space as the transaction; receiving member is a current member.

---

## HU-E4-03 — Transfer between own accounts

- **Milestone:** M1 · **Priority:** Must · **Size:** S · **Depends on:** HU-E2-01 · **Module(s):** `ledger`

**User story:** As a user, I want to move money between my own accounts, so that balances stay correct without the movement counting as spending.

```gherkin
Feature: Transfer between own accounts

  Scenario: Transfer from bank to wallet
    When "Ana" transfers 500,000 COP from "Bancolombia" to "Nequi" on 2026-10-06
    Then a transaction of type "TRANSFER" with amount 500,000 COP exists
    And it has no category
    And it is not included in spending totals

  Scenario: Source and destination must differ
    When "Ana" transfers 500,000 COP from "Bancolombia" to "Bancolombia"
    Then the result is the error "SameAccountTransfer"

  Scenario: Destination must be owned by the user
    When "Ana" transfers 500,000 COP from "Bancolombia" to "Davivienda" owned by "Juan"
    Then the result is the error "AccountNotOwned"
```

**Technical notes:**
- Use case: `RecordTransfer`.
- Transfers to a `SHARED_FUND` are fund contributions (HU-E4-09) and follow their own rules.

---

## HU-E4-04 — Assign transactions to periods by period policy

- **Milestone:** M1 · **Priority:** Must · **Size:** S · **Depends on:** HU-E1-03, HU-E4-01 · **Module(s):** `ledger`, `shared/kernel`

**User story:** As a user, I want each transaction counted in the period defined by my space's period policy, so that period totals match my pay cycle.

```gherkin
Feature: Period assignment

  Scenario: Calendar months with MONTHLY(1)
    Given the personal space of "Ana" has the period policy MONTHLY(1)
    And expenses of 85,000 COP on 2026-10-31 and 40,000 COP on 2026-11-01
    When "Ana" views the period "2026-10" from 2026-10-01 to 2026-10-31
    Then the period total is 85,000 COP

  Scenario: Payday cycle with MONTHLY(25)
    Given the space "Household" has the period policy MONTHLY(25)
    And expenses of 120,000 COP on 2026-10-24 and 60,000 COP on 2026-10-25
    When "Ana" views the period "2026-11" from 2026-10-25 to 2026-11-24
    Then the period total is 60,000 COP

  Scenario: Half-month periods with SEMI_MONTHLY(1, 16)
    Given the space "Household" has the period policy SEMI_MONTHLY(1, 16)
    And expenses of 70,000 COP on 2026-11-10 and 50,000 COP on 2026-11-20
    When "Ana" views the period "2026-11 H1" from 2026-11-01 to 2026-11-15
    Then the period total is 70,000 COP
    And the period "2026-11 H2" from 2026-11-16 to 2026-11-30 totals 50,000 COP

  Scenario: Editing the date moves the transaction to another period
    Given the personal space of "Ana" has the period policy MONTHLY(1)
    And an expense of 85,000 COP dated 2026-10-31
    When "Ana" changes its date to 2026-11-02
    Then the expense counts in the period 2026-11-01 to 2026-11-30
    And it no longer counts in the period 2026-10-01 to 2026-10-31
```

**Technical notes:**
- Period is derived on read (never stored on the transaction): from the stored plan boundaries when a plan covers the `date`, otherwise from `date` and `space.periodPolicy` (spec 5.2, D14).
- SQL helper mirrors the kernel `Period` logic; both are covered by the same table-driven test cases.

---

## HU-E4-05 — List and filter transactions

- **Milestone:** M1 · **Priority:** Must · **Size:** M · **Depends on:** HU-E4-01, HU-E4-02, HU-E4-03, HU-E4-04 · **Module(s):** `ledger`

**User story:** As a user, I want a monthly transaction list I can filter by period, category and member, so that I can review and find movements quickly.

```gherkin
Feature: Monthly transaction list

  Background:
    Given the personal space of "Ana" with the period policy MONTHLY(1) and these October 2026 transactions:
      | date       | type    | description | category    | amount    |
      | 2026-10-05 | EXPENSE | Market      | Groceries   | 85,000    |
      | 2026-10-12 | EXPENSE | Market      | Groceries   | 100,000   |
      | 2026-10-15 | EXPENSE | Dinner      | Restaurants | 60,000    |
      | 2026-10-25 | INCOME  | Salary      | Salary      | 3,200,000 |

  Scenario: Default view shows the current period
    Given today is 2026-10-28
    When "Ana" opens the transaction list
    Then 4 transactions are listed, newest first
    And the period shows total expenses 245,000 COP and total income 3,200,000 COP

  Scenario: Filter by category
    When "Ana" filters by the category "Groceries"
    Then 2 transactions are listed with a total of 185,000 COP

  Scenario: Filter by member in a shared space
    Given in "Household" "Ana" paid an expense of 300,000 COP and "Juan" paid an expense of 100,000 COP, both split equally
    When "Ana" filters "Household" by the member "Juan" as payer
    Then only the 100,000 COP expense is listed

  Scenario: Deleted transactions are hidden
    Given the "Dinner" expense was soft-deleted
    When "Ana" opens the October 2026 list
    Then 3 transactions are listed

  Scenario: Results are paginated
    Given 120 transactions exist in October 2026
    When "Ana" opens the list
    Then the first page shows 50 transactions and indicates more pages
```

**Technical notes:**
- Query: `ListTransactions` with filters `period`, `categoryIds`, `payerMemberId`, `participantMemberId`, `type`; cursor pagination. Member filters take `SpaceMember` ids, so guests can be filtered too.
- Filter input validated with Zod at the edge; authorization by membership.
- This list is the M1 "monthly view".
- The member-filter scenario becomes testable in M2, once shared spaces exist (HU-E4-07).

---

## HU-E4-06 — Edit or delete a transaction with an audit trail

- **Milestone:** M1 · **Priority:** Must · **Size:** M · **Depends on:** HU-E4-01 · **Module(s):** `ledger`

**User story:** As a user, I want to correct or remove transactions while keeping a record of every change, so that shared money stays traceable.

```gherkin
Feature: Edit and soft delete with audit

  Scenario: Edit amount and keep the audit record
    Given "Ana" recorded an expense of 85,000 COP
    When "Ana" changes the amount to 95,000 COP
    Then the expense amount is 95,000 COP with one payment and one share of 95,000 COP
    And an audit entry records "Ana", the timestamp, and the change from 85,000 COP to 95,000 COP

  Scenario: Edit that breaks the shares invariant is rejected
    Given a shared expense of 300,000 COP with shares 150,000 COP for "Ana" and 150,000 COP for "Juan"
    When "Ana" changes the amount to 320,000 COP without updating the shares
    Then the result is the error "SharesDoNotMatchAmount"

  Scenario: Soft delete keeps the row
    When "Ana" deletes the expense "Market" of 85,000 COP
    Then the transaction has deletedAt set and is excluded from lists, balances and reports
    And an audit entry records the deletion by "Ana"

  Scenario: Member cannot edit another member's transaction
    Given "Luis" is MEMBER of "Household" and "Ana" created an expense there
    When "Luis" edits that expense
    Then the result is the error "InsufficientRole"

  Scenario: Transactions in a closed period cannot change
    Given the plan for the period 2026-10-01 to 2026-10-31 is CLOSED
    When "Ana" edits an expense dated 2026-10-05
    Then the result is the error "PeriodClosed"
```

**Technical notes:**
- Use cases: `EditTransaction`, `DeleteTransaction`; port `AuditLog`.
- The closed-period scenario becomes active with HU-E6-07; until then the `ClosedPeriodGuard` port has an always-open adapter.
- Moving a transaction into a closed period is also rejected.

---

## HU-E4-07 — Record a shared expense split equally

- **Milestone:** M2 · **Priority:** Must · **Size:** M · **Depends on:** HU-E1-07, HU-E1-10, HU-E4-01 · **Module(s):** `ledger`

**User story:** As a household member, I want to record an expense paid by me or by another member, including a guest, and split it equally among chosen members, so that the debt is computed without manual math.

```gherkin
Feature: Shared expense with equal split

  Background:
    Given the shared space "Household" with members "Ana" and "Juan"

  @critical
  Scenario: Ana pays and splits equally
    When "Ana" records an expense "Groceries" of 300,000 COP paid from her account "Bancolombia" split "EQUAL" between "Ana" and "Juan"
    Then the payment is 300,000 COP by "Ana"
    And the shares are 150,000 COP for "Ana" and 150,000 COP for "Juan" with splitMethod "EQUAL"

  Scenario: Equal split with a remainder
    Given "Luis" is also a member of "Household"
    When "Ana" records an expense of 100,000 COP split "EQUAL" among "Ana", "Juan" and "Luis"
    Then one share is 33,334 COP and two shares are 33,333 COP
    And the shares sum to exactly 100,000 COP

  Scenario: Payer need not participate
    When "Ana" records an expense of 80,000 COP paid by "Ana" split "EQUAL" with only "Juan" as participant
    Then "Juan" has a share of 80,000 COP and "Ana" has no share

  Scenario: A guest pays without an account
    Given the guest "Pedro" is a member of "Household"
    When "Ana" records a "Taxi" expense of 90,000 COP paid by "Pedro" split "EQUAL" among "Ana", "Juan" and "Pedro"
    Then the payment is 90,000 COP by "Pedro" with no account
    And the shares are 30,000 COP each for "Ana", "Juan" and "Pedro"
    And the transaction's createdBy is "Ana"

  Scenario: Participant must be a current member of the space
    Given "Marta" is neither a registered member nor a guest of "Household"
    When "Ana" records an expense split with "Marta"
    Then the result is the error "NotASpaceMember"

  Scenario: At least one participant is required
    When "Ana" records an expense of 80,000 COP with no participants
    Then the result is the error "ParticipantsRequired"
```

**Technical notes:**
- Use case: `RecordExpense` with a `SplitCalculator` domain service (strategy per split method).
- v1 UI supports one payer; the domain accepts several payments.
- `BY_ALLOCATION` is delivered in HU-E6-08.
- A registered payer pays from their own personal account; allowed by the space ownership rule (spec D9).
- Payment nullability (spec 5.2): `accountId` is null if and only if the payer is a guest. A registered payer without an account is rejected with `AccountRequired`; a guest payment with an account is rejected with `GuestHasNoAccounts`. Any MEMBER or above may record an expense paid by a guest (spec D15).

---

## HU-E4-08 — Split by percentage, exact amounts or shares

- **Milestone:** M2 · **Priority:** Must · **Size:** M · **Depends on:** HU-E4-07 · **Module(s):** `ledger`

**User story:** As a household member, I want to split an expense by percentage, exact amounts or share units, so that uneven arrangements are recorded correctly.

```gherkin
Feature: Non-equal split methods

  Background:
    Given the shared space "Household" with members "Ana" and "Juan"

  Scenario: Percentage split
    When "Ana" records an expense of 300,000 COP split "PERCENT" with "Ana" 40% and "Juan" 60%
    Then the shares are 120,000 COP for "Ana" and 180,000 COP for "Juan"

  Scenario: Percentages must sum to 100
    When "Ana" records an expense of 300,000 COP split "PERCENT" with "Ana" 40% and "Juan" 50%
    Then the result is the error "InvalidSplit"

  Scenario: Exact split
    When "Ana" records an expense of 250,000 COP split "EXACT" with "Ana" 100,000 COP and "Juan" 150,000 COP
    Then the shares are 100,000 COP for "Ana" and 150,000 COP for "Juan"

  Scenario: Exact amounts must sum to the expense amount
    When "Ana" records an expense of 250,000 COP split "EXACT" with "Ana" 100,000 COP and "Juan" 120,000 COP
    Then the result is the error "SharesDoNotMatchAmount"

  Scenario: Share units
    When "Ana" records an expense of 90,000 COP split "SHARES" with "Ana" 2 units and "Juan" 1 unit
    Then the shares are 60,000 COP for "Ana" and 30,000 COP for "Juan"

  Scenario: Share units must be positive integers
    When "Ana" records an expense of 90,000 COP split "SHARES" with "Ana" 0 units and "Juan" 0 units
    Then the result is the error "InvalidSplit"
```

**Technical notes:**
- Strategies `PercentSplit`, `ExactSplit`, `SharesSplit` behind `SplitCalculator`; all round via `Money.allocate`.
- Percentages stored with two decimals (basis points) in the split snapshot.

---

## HU-E4-09 — Contribute to the shared fund

- **Milestone:** M2 · **Priority:** Must · **Size:** S · **Depends on:** HU-E2-02, HU-E4-03 · **Module(s):** `ledger`

**User story:** As a household member, I want to record my transfer into the shared fund, so that my contribution is tracked against what I was expected to put in.

```gherkin
Feature: Fund contribution

  Background:
    Given the shared space "Household" with the account "Household Fund" of type "SHARED_FUND"

  Scenario: Ana contributes from her personal account
    When "Ana" transfers 480,000 COP from her account "Bancolombia" to "Household Fund" on 2026-10-02
    Then a transaction of type "TRANSFER" flagged as fund contribution by "Ana" exists in "Household"
    And "Household Fund" balance increases by 480,000 COP
    And "Bancolombia" balance decreases by 480,000 COP

  Scenario: Contribution must come from the contributor's own account
    When "Ana" transfers 480,000 COP from "Davivienda" owned by "Juan" to "Household Fund"
    Then the result is the error "AccountNotOwned"

  Scenario: Viewer cannot contribute
    Given "Sofi" is VIEWER of "Household"
    When "Sofi" transfers 100,000 COP to "Household Fund"
    Then the result is the error "InsufficientRole"

  Scenario: Contribution creates no inter-member debt
    When "Ana" contributes 480,000 COP to "Household Fund"
    Then the net balance between "Ana" and "Juan" is unchanged
```

**Technical notes:**
- Use case: `RecordFundContribution` (a `TRANSFER` whose destination is `SHARED_FUND`).
- Cross-space transfer: source account in the personal space, destination in the shared space; the transaction belongs to the shared space (spec D9).
- Feeds `actualFundContribution(m)` (HU-E7-03).

---

## HU-E4-10 — Record an expense paid from the shared fund

- **Milestone:** M2 · **Priority:** Must · **Size:** S · **Depends on:** HU-E2-02, HU-E4-07, HU-E4-08 · **Module(s):** `ledger`

**User story:** As a household member, I want to record expenses paid directly from the shared fund, so that common costs are tracked without creating debts between us.

```gherkin
Feature: Expense paid from the shared fund

  Background:
    Given the shared space "Household" with members "Ana" and "Juan"
    And the account "Household Fund" of type "SHARED_FUND" with balance 1,500,000 COP

  @critical
  Scenario: Rent paid from the fund
    When "Ana" records an expense "Rent October" of 1,200,000 COP in "Rent" paid from "Household Fund" split "PERCENT" with "Ana" 40% and "Juan" 60%
    Then the payment of 1,200,000 COP is from "Household Fund"
    And the shares are 480,000 COP for "Ana" and 720,000 COP for "Juan"
    And "Household Fund" balance is 300,000 COP

  Scenario: Fund-paid expense creates no debt
    Given "Ana" and "Juan" have a net balance of 0 COP
    When the 1,200,000 COP rent is paid from "Household Fund"
    Then "Ana" and "Juan" still have a net balance of 0 COP

  Scenario: Fund may go negative only with an explicit warning
    When "Ana" records an expense of 2,000,000 COP paid from "Household Fund"
    Then the expense is recorded
    And the UI warns that "Household Fund" balance is -500,000 COP
```

**Technical notes:**
- Use case: `RecordExpense` with a fund payment source.
- Fund payments store `memberId = null` and the fund's `accountId`. Per spec 5.2, `memberId` is null if and only if the account is a `SHARED_FUND`, and `accountId` is null if and only if the payer is a guest, so every payment has at least one of the two.
- Shares still drive consumption in reporting (HU-E7-04).

---

## HU-E4-11 — Define and manage recurring transactions

- **Milestone:** M3 · **Priority:** Must · **Size:** M · **Depends on:** HU-E4-07, HU-E0-04, HU-E1-10 · **Module(s):** `ledger`

**User story:** As a household member, I want to define recurring transactions such as rent, utilities or cleaning, so that repeating money movements follow our periods without retyping them.

```gherkin
Feature: Recurring transaction definitions

  Background:
    Given the shared space "Household" with members "Ana" and "Juan" and the account "Household Fund"

  Scenario: Define the monthly rent paid from the shared fund
    When "Ana" defines a recurring expense "Rent" of 1,200,000 COP in "Rent" paid from "Household Fund" with schedule MONTHLY(1), mode "AUTO", starting 2026-12-01
    Then the recurrence is active
    And its next occurrence is 2026-12-01

  Scenario: Monthly schedules clamp to short months
    When "Ana" defines a recurring expense with schedule MONTHLY(31) starting 2027-01-01
    Then its next three occurrences are 2027-01-31, 2027-02-28 and 2027-03-31

  Scenario: Semi-monthly schedule
    When "Ana" defines a recurring expense "Cleaning" of 80,000 COP with schedule SEMI_MONTHLY(1, 16) starting 2026-12-01
    Then its occurrences in December 2026 are 2026-12-01 and 2026-12-16

  Scenario: Editing applies to future occurrences only
    Given the 2026-12-01 "Rent" occurrence was recorded for 1,200,000 COP
    When "Ana" changes the "Rent" amount to 1,300,000 COP on 2026-12-15
    Then the 2026-12-01 expense still has 1,200,000 COP
    And the 2027-01-01 occurrence will use 1,300,000 COP

  Scenario: Pausing skips the paused span without back-filling
    Given "Ana" paused "Cleaning" on 2026-12-20
    When "Ana" resumes it on 2027-02-10
    Then no occurrence exists between 2026-12-20 and 2027-02-10
    And its next occurrence is 2027-02-16

  Scenario: Viewers cannot define recurrences
    Given "Sofi" is VIEWER of "Household"
    When "Sofi" defines a recurring expense
    Then the result is the error "InsufficientRole"
```

**Technical notes:**
- Use cases: `DefineRecurrence`, `UpdateRecurrence`, `PauseRecurrence`, `ResumeRecurrence`, `EndRecurrence`.
- The schedule reuses the `PeriodPolicy` anchor rules (MONTHLY(day) or SEMI_MONTHLY(day1, day2), 1–31, clamped); WEEKLY/BIWEEKLY follow HU-E8-09.
- The template stores type (EXPENSE, INCOME, TRANSFER, fund contribution), amount, category, payer SpaceMember (or the fund), account (null for guests), split method and values; payment nullability rules from spec 5.2 apply.
- If the paying member leaves the space, the recurrence is paused with reason `PayerLeft`.

---

## HU-E4-12 — Record due occurrences automatically

- **Milestone:** M3 · **Priority:** Must · **Size:** M · **Depends on:** HU-E4-11, HU-E6-07, HU-E6-08 · **Module(s):** `ledger`, `budgeting`

**User story:** As a household member, I want AUTO recurrences to be recorded on their date, so that the plan reflects fixed costs without anyone remembering to enter them.

```gherkin
Feature: Automatic occurrences

  Background:
    Given an AUTO recurrence "Rent" of 1,200,000 COP paid from "Household Fund" with schedule MONTHLY(1) from 2026-12-01 to 2027-01-31

  @critical
  Scenario: Occurrence is recorded on schedule
    When the scheduler runs on 2026-12-01
    Then an expense "Rent" of 1,200,000 COP dated 2026-12-01 is recorded and linked to the recurrence

  Scenario: Running twice does not duplicate
    Given the scheduler already recorded the 2026-12-01 occurrence
    When the scheduler runs again on 2026-12-01
    Then exactly one "Rent" expense exists for 2026-12-01

  Scenario: Missed runs are caught up
    Given the scheduler did not run between 2026-12-01 and 2026-12-03
    When the scheduler runs on 2026-12-04
    Then the "Rent" expense dated 2026-12-01 is recorded

  @golden
  Scenario: BY_ALLOCATION is resolved with the plan of each occurrence's period
    Given an AUTO recurrence "Internet" of 120,000 COP in "Utilities" paid by "Juan" from "Davivienda" split "BY_ALLOCATION" with schedule MONTHLY(5)
    And "Home" is allocated 40/60 in the 2026-12 plan and 50/50 in the 2027-01 plan
    When the scheduler records the occurrences of 2026-12-05 and 2027-01-05
    Then the 2026-12-05 shares are 48,000 COP for "Ana" and 72,000 COP for "Juan"
    And the 2027-01-05 shares are 60,000 COP for "Ana" and 60,000 COP for "Juan"

  Scenario: Closed period skips the occurrence
    Given the plan for 2026-12 is CLOSED before the scheduler runs on 2026-12-01
    When the scheduler runs
    Then no expense is created and the skip is logged with reason "PeriodClosed"

  Scenario: Recurrence stops after its end date
    When the scheduler runs on 2027-02-01
    Then no "Rent" expense is created for 2027-02-01
```

**Technical notes:**
- Use case: `MaterializeDueOccurrences`; idempotency key = (recurrenceId, occurrenceDate).
- Recorded through `RecordExpense` (or the matching use case per type), so all ledger invariants and default-split rules apply; shares are snapshots.
- Runs behind a `Scheduler` port (adapter: in-container cron job) and uses `Clock`; catch-up processes every due date not yet materialized.

---

## HU-E4-13 — Confirm variable-amount occurrences

- **Milestone:** M3 · **Priority:** Must · **Size:** S · **Depends on:** HU-E4-12 · **Module(s):** `ledger`

**User story:** As a household member, I want recurrences with variable amounts (utilities) to wait for my confirmation, so that the real bill amount is recorded instead of an estimate.

```gherkin
Feature: Occurrences pending confirmation

  Background:
    Given a CONFIRM recurrence "Electricity" with estimated amount 180,000 COP in "Utilities" paid by "Ana" from "Bancolombia" split "BY_ALLOCATION" with schedule MONTHLY(10)
    And "Home" is allocated 40/60 in the ACTIVE 2026-12 plan

  Scenario: A pending occurrence is created instead of an expense
    When the scheduler runs on 2026-12-10
    Then a pending occurrence "Electricity" dated 2026-12-10 with suggested amount 180,000 COP exists
    And no expense is recorded
    And "Home" spent is unchanged

  @critical
  Scenario: Confirming records the actual amount
    Given the pending occurrence "Electricity" dated 2026-12-10
    When "Ana" confirms it with the amount 205,300 COP
    Then an expense "Electricity" of 205,300 COP dated 2026-12-10 is recorded
    And the shares are 82,120 COP for "Ana" and 123,180 COP for "Juan"

  Scenario: Skipping an occurrence
    Given the pending occurrence "Electricity" dated 2026-12-10
    When "Ana" skips it
    Then the occurrence is marked skipped and no expense is recorded
    And the next occurrence is 2027-01-10

  Scenario: Viewers cannot confirm
    Given "Sofi" is VIEWER of "Household"
    When "Sofi" confirms the pending occurrence "Electricity"
    Then the result is the error "InsufficientRole"

  Scenario: Confirming into a closed period is rejected
    Given the 2026-12 plan was CLOSED while "Electricity" dated 2026-12-10 was still pending
    When "Ana" confirms it with the amount 205,300 COP
    Then the result is the error "PeriodClosed"
```

**Technical notes:**
- Use cases: `ConfirmOccurrence`, `SkipOccurrence`; pending occurrences are not transactions and never count as spent.
- Pending occurrences are listed for members with role MEMBER or above and may be shown on the line dashboard as "expected" (HU-E7-01).
- Confirming reuses the recurrence template; only the amount (and optionally the date within the same period) can change.
