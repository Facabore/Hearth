# E2 — Accounts

**Goal:** users model where their money lives and what they owe — personal cash, bank, wallet, credit card, savings, investment, loan and other accounts, plus a shared fund per shared space — and see each account's balance computed from the ledger, with their available money and net worth.

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
- Endpoint: `POST /api/v1/spaces/{spaceId}/accounts`; opening balance as Money (minor-units string, HU-E0-09).
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
- Use case: `CreateAccount` (same use case and endpoint `POST /api/v1/spaces/{spaceId}/accounts`, type-dependent rules in the `Account` entity).
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
    And "Nequi" is not returned when active accounts are listed

  Scenario: Recording on an archived account is rejected
    Given "Nequi" is archived
    When "Ana" records an expense of 20,000 COP paid from "Nequi"
    Then the result is the error "AccountArchived"
```

**Technical notes:**
- Use cases: `UpdateAccount`, `ArchiveAccount`. Endpoints: `PATCH /api/v1/spaces/{spaceId}/accounts/{accountId}`, `POST /api/v1/spaces/{spaceId}/accounts/{accountId}/archive`; `GET /api/v1/spaces/{spaceId}/accounts` excludes archived accounts unless `?archived=true`.
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
    When "Ana" requests her accounts
    Then "Bancolombia" is returned with a balance of 4,415,000 COP
    And "Nequi" is returned with a balance increased by 500,000 COP

  Scenario: Shared expense reduces the payer account by the full payment
    Given "Ana" paid a 300,000 COP shared expense from "Bancolombia" split equally with "Juan"
    When "Ana" requests "Bancolombia"
    Then its balance decreased by 300,000 COP, not by her 150,000 COP share

  Scenario: Deleted transactions are excluded
    Given an expense of 85,000 COP from "Bancolombia" that was soft-deleted
    When "Ana" requests "Bancolombia"
    Then the deleted expense does not affect the balance

  Scenario: Balance as of a date
    Given transactions on "Bancolombia" dated 2026-10-05 and 2026-11-03
    When "Ana" requests the balance as of 2026-10-31
    Then only the transaction dated 2026-10-05 is included
```

**Technical notes:**
- Query: `GetAccountBalances` computed on read with SQL aggregates (D7); no stored running totals. Endpoints: `GET /api/v1/spaces/{spaceId}/accounts?asOf=<date>` and `GET /api/v1/spaces/{spaceId}/accounts/{accountId}`, each account with its computed `balance`.
- Balance = openingBalance + incomes in + transfers in − transfers out − payments out ± settlements with account set.
- Port: `LedgerReadModel` exposed by `ledger` application layer.

---

## HU-E2-05 — More account types with common attributes

- **Milestone:** M3-D · **Priority:** Must · **Size:** S · **Depends on:** HU-E2-01, HU-E2-03 · **Module(s):** `accounts`

**User story:** As a user, I want to register wallets, investments, loans and other accounts, each with its institution, last four digits, color and icon, so that my account list matches my real money and I can tell accounts apart at a glance.

```gherkin
Feature: Account types and common attributes

  Scenario: Create a wallet with its common attributes
    When "Ana" creates the account "Nequi" of type "WALLET" with opening balance 300,000 COP, institution "Nequi", last four digits "4821", color "PINE" and icon "wallet"
    Then the account is returned with those attributes in her personal space

  Scenario: Attributes left out get the type defaults
    When "Ana" creates the account "Efectivo" of type "CASH" without institution, last four digits, color or icon
    Then its icon is "cash"
    And its institution, last four digits and color are empty

  Scenario Outline: The new types are personal account types
    When "Ana" creates an account of type "<type>" in the shared space "Household"
    Then the result is the error "PersonalAccountRequiresPersonalSpace"

    Examples:
      | type       |
      | WALLET     |
      | INVESTMENT |
      | LOAN       |
      | OTHER      |

  Scenario: Only the last four digits of a card are accepted
    When "Ana" sets the last four digits of "Visa" to "4111111111111111"
    Then the result is the error "ValidationFailed"
    And no card number is stored

  Scenario: Common attributes can change, the type cannot
    When "Ana" changes the color of "Nequi" to "EMBER"
    Then "Nequi" is returned with the color "EMBER"
    When "Ana" changes the type of "Nequi" from "WALLET" to "BANK"
    Then the result is the error "AccountTypeImmutable"
```

**Technical notes:**
- `ACCOUNT_TYPES` (`src/modules/accounts/domain/account.ts`) gains `WALLET` (Nequi, Daviplata), `INVESTMENT` (FIC, shares), `LOAN` (bank loans and other debts) and `OTHER`. All four are personal types, like CASH, BANK, CREDIT_CARD and SAVINGS (`PersonalAccountRequiresPersonalSpace`, HU-E2-02); the SHARED_FUND rules are unchanged. `AccountTypeImmutable` still applies (HU-E2-03).
- Liabilities (`CREDIT_CARD`, `LOAN`) carry negative balances for the money owed, as the credit card of HU-E2-01 already does; the net worth of HU-E2-07 relies on that sign.
- Common optional attributes on every type, SHARED_FUND included:
  - `institution`: 1–60 characters, stored as user data. The UI may suggest a Colombian catalog (Bancolombia, Davivienda, BBVA, Banco de Bogotá, Nu, Nequi, Daviplata, Lulo, other).
  - `lastFour`: exactly 4 digits. A full card or account number and the CVV are never accepted or stored. The account form offers it, marked optional and limited to four digits, for BANK, CREDIT_CARD and SAVINGS; not for WALLET, which is known by its phone number (#164). The API still accepts it on every type.
  - `color`: one key of the app's palette (`PINE`, `SAGE`, `OLIVE`, `SAND`, `MUSTARD`, `AMBER`, `EMBER`, `CORAL`, `ROSE`, `PLUM`, `LAVENDER`, `INDIGO`, `SKY`, `TEAL`, `STEEL`, `GRAPHITE`), the same sixteen as categories (D22; #125, ruling P122 of the M6a plan).
  - `icon`: an allow-listed Hearth symbol name: `cash`, `bank`, `wallet`, `card`, `piggy`, `trend`, `coins`, `dots`, `users`, `briefcase`, `car`, `star`, `gift`, `home`, `plane`, `phone`. Defaults by type: CASH `cash`, BANK `bank`, WALLET `wallet`, CREDIT_CARD `card`, SAVINGS `piggy`, INVESTMENT `trend`, LOAN `coins`, OTHER `dots`, SHARED_FUND `users`. Migration `0019_account_style_vocabulary` mapped the earlier lower-case keys and Lucide names.
- The Zod contract rejects pattern and enum failures (`ValidationFailed`); `PATCH` accepts `null` to clear an attribute. Endpoints are unchanged (`POST /api/v1/spaces/{spaceId}/accounts`, `PATCH .../accounts/{accountId}`); the account DTO gains the fields.
- An INVESTMENT account's balance comes from the ledger only: contributions are transfers into it. Manual market values are HU-E8-17; market data and brokerage sync stay out of scope.
- Migration: nullable columns; existing accounts get their type's default icon.
- Currency stays the space currency (HU-E2-01); a currency per account is future work (HU-E8-06).
- Errors (catalogue, spec 8): `ValidationFailed` (422) for an unknown type, color or icon, a `lastFour` that is not four digits, or an `institution` outside 1–60 characters; `PersonalAccountRequiresPersonalSpace` (409) for the new types in a shared space; `AccountTypeImmutable` (409) (M3-D Task 13).
- **Spec impact:** 5.2 **Account** (new types, common attributes, sign of liabilities); section 2 Non-goals ("investments": an investment account's ledger balance is in scope; market data and sync are not).

---

## HU-E2-06 — Type-specific account attributes

- **Milestone:** M3-D · **Priority:** Must · **Size:** M · **Depends on:** HU-E2-05 · **Module(s):** `accounts`

**User story:** As a user, I want to record my credit card's limit, cut-off day, payment day and rate, my savings' and CDTs' rate, term and maturity date, and my loans' principal, rate and term, so that Hearth can later remind me, project yields and plan payments from the real terms.

```gherkin
Feature: Type-specific account attributes

  Scenario: Credit card terms
    When "Ana" creates the account "Visa" of type "CREDIT_CARD" with opening balance -350,000 COP, credit limit 5,000,000 COP, cut-off day 20, payment day 5 and monthly rate "2.0" % M.V.
    Then "Visa" is returned with those terms and an available credit of 4,650,000 COP
    And its equivalent effective annual rate is "26.8242" % E.A.

  Scenario: A CDT is a savings account with a term
    When "Ana" creates the account "CDT Davivienda" of type "SAVINGS" with opening balance 10,000,000 COP, rate "9.5" % E.A., term 180 days and maturity date 2027-04-14
    Then "CDT Davivienda" is returned with those terms and the start date 2026-10-16

  Scenario: Loan terms
    When "Ana" creates the account "Crédito libre inversión" of type "LOAN" with opening balance -20,000,000 COP, principal 20,000,000 COP, rate "18" % E.A. and term 36 months
    Then the loan is returned with those terms and an equivalent monthly rate of "1.3888" % M.V.

  Scenario: Attributes of another type are rejected
    When "Ana" sets a credit limit of 1,000,000 COP on the account "Bancolombia" of type "BANK"
    Then the result is the error "AccountAttributeNotAllowed"

  Scenario Outline: Invalid terms are rejected
    When "Ana" saves the <type> account "<account>" with <terms>
    Then the result is the error "<error>"

    Examples:
      | type        | account                 | terms                              | error              |
      | CREDIT_CARD | Visa                    | cut-off day 32                     | InvalidBillingDay  |
      | CREDIT_CARD | Visa                    | credit limit 0 COP                 | InvalidCreditLimit |
      | CREDIT_CARD | Visa                    | monthly rate "-1"                  | InvalidRate        |
      | SAVINGS     | CDT Davivienda          | term 180 days and no maturity date | InvalidTermDeposit |
      | LOAN        | Crédito libre inversión | term 0 months                      | InvalidTerm        |

  Scenario: Billing days clamp to short months
    Given "Visa" has cut-off day 31 and payment day 15
    And today is 2026-11-16 in the time zone of "Ana"
    When "Ana" requests "Visa"
    Then its next cut-off date is 2026-11-30
    And its next payment date is 2026-12-15
```

**Technical notes:**
- Attributes by type. All are optional unless noted; any other type that receives them answers `AccountAttributeNotAllowed`.
  - `CREDIT_CARD`: `creditLimit` (Money > 0, `InvalidCreditLimit`), `cutOffDay` and `paymentDay` (1–31, `InvalidBillingDay`), `monthlyRate` (% M.V.). Derived in the DTO: `availableCredit = creditLimit + balance`, `nextCutOffDate` and `nextPaymentDate` (the next cut-off day and payment day on or after today) and `effectiveAnnualRate`. Days clamp to the month's last day, like `PeriodPolicy` (spec 5.2). A statement is due on the first payment day after its cut-off.
  - `SAVINGS`: `annualRate` (% E.A.), `termDays` (1–3,660) and `maturityDate`. A CDT (term deposit) is a SAVINGS account with a term: `termDays` and `maturityDate` are set together or not at all (`InvalidTermDeposit`), and its start date is derived as `maturityDate − termDays`. A savings account or pocket without a term may still carry a rate.
  - `LOAN`: `principal` (Money > 0), `annualRate` (% E.A.), `termMonths` (1–480, `InvalidTerm`). The outstanding debt is the account balance; its opening balance is negative.
- Rates are exchanged as decimal strings in percent with at most 4 fractional digits (`"2.0"`, `"28.59"`), that is 6 decimal places as a fraction. They are stored exactly (no floats in the domain) and range from 0 to 100 %, else `InvalidRate`. Equivalent rates in the DTO use `i_m = (1 + EA)^(1/12) − 1` and `EA = (1 + i_m)^12 − 1`, rounded to 4 fractional digits of a percent; the nominal rate is `N.M.V. = 12 · i_m` when shown.
- The warning against the certified usury cap belongs to card installments (HU-E8-11); this story stores rates without judging them.
- "Today" for the next dates is the requesting user's local date (HU-E1-14).
- Consumers: card installments (HU-E8-11), CDT projection (HU-E8-12), loan schedule (HU-E8-13) and reminders (HU-E8-16). This story only stores and validates the terms.
- Errors (catalogue, spec 8): `AccountAttributeNotAllowed` (409; its `field` names the refused term as the key inside the body's `terms`, e.g. `monthlyRate`); `InvalidCreditLimit`, `InvalidBillingDay`, `InvalidRate`, `InvalidTermDeposit`, `InvalidTerm` (422); a loan principal that is not positive is `InvalidAmount` (422); a money term in another currency is `CurrencyMismatch` (422); a rate that is not a string and a money term beyond the PostgreSQL `bigint` range are `ValidationFailed` (422) (M3-D Task 15b).
- **Spec impact:** 5.2 **Account** (attributes per type, derived fields, clamping of billing days); 7 HTTP conventions (rates as decimal strings, like money amounts).

---

## HU-E2-07 — Available money and net worth

- **Milestone:** M3-D · **Priority:** Must · **Size:** M · **Depends on:** HU-E2-04, HU-E2-05 · **Module(s):** `accounts`, `ledger`

**User story:** As a user, I want to choose which accounts count in my available money ("Disponible") and in my net worth ("Patrimonio neto"), and see both totals, so that I know what I can spend now and what I own minus what I owe.

```gherkin
Feature: Available and net worth totals

  Background:
    Given the personal space of "Ana" has these active accounts with their default switches:
      | account                 | type        | balance    |
      | Bancolombia             | BANK        | 2,000,000  |
      | Nequi                   | WALLET      | 300,000    |
      | Visa                    | CREDIT_CARD | -350,000   |
      | CDT Davivienda          | SAVINGS     | 10,000,000 |
      | Crédito libre inversión | LOAN        | -8,000,000 |

  @critical
  Scenario: Totals with the default switches
    When "Ana" requests her accounts
    Then the totals are available 2,300,000 COP and net worth 3,950,000 COP
    And "Bancolombia" and "Nequi" count in both totals
    And "Visa", "CDT Davivienda" and "Crédito libre inversión" count in net worth only

  Scenario: Switching accounts changes the totals
    When "Ana" includes "CDT Davivienda" in available
    And "Ana" excludes "Nequi" from net worth
    Then the totals are available 12,300,000 COP and net worth 3,650,000 COP

  Scenario: Paying the card is a transfer, so nothing counts twice
    Given "Ana" recorded an expense of 200,000 COP in "Groceries" paid from "Visa" on 2026-10-10
    And the totals are available 2,300,000 COP and net worth 3,750,000 COP
    When "Ana" transfers 200,000 COP from "Bancolombia" to "Visa" on 2026-10-25
    Then the transfer has no category and the period expense total is 200,000 COP
    And "Visa" has a balance of -350,000 COP
    And the totals are available 2,100,000 COP and net worth 3,750,000 COP

  Scenario: Archived accounts are left out
    When "Ana" archives "Nequi"
    Then the totals are available 2,000,000 COP and net worth 3,650,000 COP

  Scenario: A shared space totals its shared fund only
    Given the shared space "Household" has the account "Household Fund" with a balance of 1,500,000 COP
    When "Ana" requests the accounts of "Household"
    Then the totals are available 1,500,000 COP and net worth 1,500,000 COP
    And the totals of her personal space are unchanged
```

**Technical notes:**
- `Account` gains `includeInAvailable` and `includeInNetWorth`, editable with `PATCH /api/v1/spaces/{spaceId}/accounts/{accountId}`. Defaults by type: CASH, BANK, WALLET and SHARED_FUND count in both; SAVINGS, INVESTMENT, CREDIT_CARD, LOAN and OTHER count in net worth only. Either switch may be turned on or off for any type, for example to count a card in available and see money net of the card. The migration adds two nullable columns and back-fills nothing: a null switch means the type's default, so existing accounts show those defaults, and `PATCH` with `null` returns a switch to its default.
- Formulas, over the space's active (not archived) accounts and their computed balances (HU-E2-04):
  - `available = Σ balance(a)` over the accounts with `includeInAvailable`;
  - `netWorth = Σ balance(a)` over the accounts with `includeInNetWorth`.

  Balances are signed (liabilities are negative), so `netWorth` is assets minus debts.
- Computed on read (D7) by `GetAccountBalances`. `GET /api/v1/spaces/{spaceId}/accounts?asOf=<date>` returns `totals: { available, netWorth }` next to `items`, at the same `asOf` as the balances.
- Totals are per space and never mix spaces: a personal space totals its owner's accounts and a shared space totals its SHARED_FUND accounts (D5). A cross-space "all my money" figure is not part of this story.
- A card payment is a `TRANSFER` from the paying account to the card (HU-E4-03): no category, never spending. The purchase is the expense, on its date and with its category. In a shared space the split applies to the purchase, never to the payment. Interest and fees become new expenses when they are charged (HU-E8-11 estimates them).
- Delivered (M3-D Task 16): `GET …/accounts` answers `totals: { available, netWorth }` over the active accounts at `asOf`, whatever `archived` lists; `PATCH` with `null` returns a switch to its type's default. No new error code.
- **Spec impact:** 5.2 **Account** (the two switches and their defaults), 5.2 **Transaction** (`TRANSFER`: a card payment is a transfer), 5.4 (new derived metrics `available` and `netWorth` per space), section 6 (a new decision recording the switches and the card-payment rule).
