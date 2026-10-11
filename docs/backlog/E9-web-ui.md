# E9 — Web UI

**Goal:** a web interface over the Next.js BFF (spec D18) for every area delivered by the API epics E0–E8, in Spanish by default and in English, so the household can do in the browser everything the API already guarantees.

**Modules involved:** `app/(web)` (pages and server actions), each module's `ui/` folder (presentational components and containers), shared atomic components.

**How this epic works:**

- **Parallel track (milestone M6):** an area's UI story may start as soon as the API stories it depends on are `Done`; it never waits for the whole M0–M5 sequence.
- **Container-presentational:** containers load data and call server actions; presentational components receive DTOs and props only. Pages and server actions are thin wrappers over the same use cases as `/api/v1` (or call the API); no component touches the database.
- **Design first:** every screen is designed with `/design` and reviewed by the owner before its UI story moves to `Ready`.
- **Stack:** shadcn/ui + Tailwind CSS, atomic design for shared components, Recharts for charts, next-intl for `es` (default) and `en`.
- **Errors and copy:** the API returns stable codes, never translated text; the UI translates every error code (`errors.<Code>`), warning code and reason code through i18n keys.
- **Acceptance:** scenarios describe UI behaviour. `@e2e` scenarios run with Playwright + playwright-bdd against the running app and PostgreSQL; the others run as component or container tests. Amounts are written in backlog form (`1,200,000 COP`) and rendered per locale (HU-E9-02).

---

## HU-E9-01 — App shell, sign-in and sign-up screens

- **Milestone:** M6 · **Priority:** Must · **Size:** M · **Depends on:** HU-E1-01, HU-E1-02, HU-E9-02 · **Module(s):** `app/(web)`, `identity/ui`, `spaces/ui`

**User story:** As a visitor, I want sign-up and sign-in screens and a consistent app shell with a space switcher, so that I can enter the app and move between my spaces.

```gherkin
Feature: App shell and authentication screens

  @e2e
  Scenario: Sign up lands in the personal space
    Given a visitor on the sign-up screen
    When the visitor enters the name "Ana", the email "ana@example.com" and a 12-character password and submits
    Then the visitor lands on the home page of her personal space
    And the shell shows "Ana" in the user menu and the personal space in the space switcher

  Scenario: API error codes are shown as translated messages
    Given a user exists with the email "ana@example.com"
    When a visitor submits the sign-up screen with the email "ANA@example.com"
    Then the email field shows the message of the key "errors.EmailTaken"
    And the visitor stays on the sign-up screen

  @e2e
  Scenario: Sign out returns to the sign-in screen
    Given "Ana" is signed in
    When "Ana" chooses "Sign out" in the user menu
    Then the sign-in screen is shown
    And opening the home page again redirects to the sign-in screen

  Scenario: A protected page returns the visitor after sign-in
    Given a visitor without a session opens the transactions page of her personal space
    When the visitor is redirected to the sign-in screen and signs in as "ana@example.com"
    Then the transactions page of her personal space is shown

  Scenario: The space switcher lists every current space
    Given "Ana" is a member of her personal space and of "Household"
    When "Ana" opens the space switcher
    Then "Personal" and "Household" are listed
    And choosing "Household" makes it the active space in the shell
```

**Technical notes:**
- Containers `SignUpFormContainer`, `SignInFormContainer`, `AppShellContainer` over presentational `SignUpForm`, `SignInForm`, `AppShell`; built with shadcn/ui form components.
- Server actions call `SignUp`, `SignIn`, `SignOut` and the spaces list query (HU-E1-01, HU-E1-02); problem+json codes map to `errors.<Code>` keys.
- Middleware redirects unauthenticated requests to `/sign-in?next=<path>`; only same-origin `next` values are honoured.

---

## HU-E9-02 — Internationalization setup (es, en)

- **Milestone:** M6 · **Priority:** Must · **Size:** S · **Depends on:** HU-E0-01, HU-E1-01 · **Module(s):** `app/(web)`, `shared/infrastructure`

**User story:** As a user, I want the interface in Spanish by default and available in English, so that I can use the app in my language.

**Note:** moved from HU-E0-08 (retired) on 2026-10-11. The API returns stable error codes only (spec section 7, D18); all translation happens here.

```gherkin
Feature: Localized interface

  @e2e
  Scenario: Spanish is the default locale
    Given a visitor whose browser sends no supported language preference
    When the visitor opens the sign-in page
    Then the page is rendered in Spanish

  Scenario: Signed-in user preference wins
    Given a signed-in user whose locale is "en"
    When the user opens the home page
    Then the page is rendered in English

  Scenario Outline: Amounts and dates are formatted per locale
    Given a user whose locale is "<locale>"
    When the amount 1,600,000 COP and the date 2026-10-05 are displayed
    Then the amount reads "<amount>"
    And the date reads "<date>"

    Examples:
      | locale | amount        | date       |
      | es     | $ 1.600.000   | 5/10/2026  |
      | en     | COP 1,600,000 | 10/5/2026  |

  Scenario: API error codes are translated, with a fallback
    Given a user whose locale is "es"
    When an action fails with the problem+json code "InsufficientRole"
    Then the message of the key "errors.InsufficientRole" is shown in Spanish
    And a code without a key shows the message of "errors.Unknown" with the requestId

  Scenario: A missing key blocks the merge
    Given a pull request that adds the key "ledger.expense.title" to "es" messages only
    When the CI workflow runs "pnpm i18n:check" in the "lint" job
    Then the job fails naming the key missing in "en"
```

**Technical notes:**
- next-intl with `es` (default, es-CO formats) and `en`; the user's stored locale wins over `Accept-Language`.
- COP displayed with zero fraction digits when the fraction is zero; whitespace normalized in tests (Intl may emit non-breaking spaces).
- Dates rendered in `America/Bogota` unless the user timezone differs.
- `pnpm i18n:check` verifies both catalogs have the same keys and that every error code in the OpenAPI document has an `errors.<Code>` key.

---

## HU-E9-03 — Personal ledger screens

- **Milestone:** M6 · **Priority:** Must · **Size:** M · **Depends on:** HU-E2-01, HU-E2-03, HU-E2-04, HU-E4-01, HU-E4-02, HU-E4-03, HU-E4-05, HU-E9-01 · **Module(s):** `accounts/ui`, `ledger/ui`

**User story:** As a user, I want screens for my accounts, my transaction list and forms to record expenses, income and transfers, so that I manage my personal money without calling the API.

```gherkin
Feature: Personal ledger screens

  Background:
    Given "Ana" is signed in with the account "Bancolombia" with opening balance 2,000,000 COP and the category "Groceries" in her personal space

  @e2e
  Scenario: Record a personal expense from the form
    Given the Clock reads 2026-11-01T04:30:00Z
    When "Ana" opens the new expense form
    Then the date field defaults to 2026-10-31
    When "Ana" enters "Market", 85,000 COP, "Groceries" and "Bancolombia" and saves
    Then the transaction list shows "Market" with 85,000 COP
    And the accounts screen shows "Bancolombia" with a balance of 1,915,000 COP

  Scenario: Accounts screen shows computed balances
    Given an income of 3,000,000 COP into "Bancolombia", an expense of 85,000 COP from "Bancolombia" and a transfer of 500,000 COP from "Bancolombia" to "Nequi"
    When "Ana" opens the accounts screen
    Then "Bancolombia" shows a balance of 4,415,000 COP

  Scenario: Archived accounts are not offered in pickers
    Given "Ana" archived the account "Nequi"
    When "Ana" opens the new expense form
    Then "Nequi" is not offered in the account picker
    And the accounts screen lists "Nequi" under archived accounts

  Scenario: Transaction list totals, filters and more pages
    Given the October 2026 transactions Market 85,000 COP, Market 100,000 COP, Dinner 60,000 COP and Salary 3,200,000 COP
    When "Ana" opens the transaction list for 2026-10
    Then 4 transactions are shown with total expenses 245,000 COP and total income 3,200,000 COP
    And filtering by "Groceries" shows 2 transactions totalling 185,000 COP

  Scenario: Validation errors are shown next to the field
    When "Ana" saves an expense of 0 COP
    Then the amount field shows the message of the key "errors.InvalidAmount"
    And no transaction is created

  Scenario: Record a transfer between own accounts
    When "Ana" records a transfer of 500,000 COP from "Bancolombia" to "Nequi" on 2026-10-06
    Then the transaction list shows the transfer without a category
    And the period expense total does not change
```

**Technical notes:**
- Containers per screen (`AccountsContainer`, `TransactionListContainer`, `ExpenseFormContainer`, `IncomeFormContainer`, `TransferFormContainer`); presentational components receive DTOs only.
- Forms validate with the same Zod contracts as `/api/v1` (`contracts/`), then call server actions wrapping `RecordExpense`, `RecordIncome`, `RecordTransfer`; each submit sends a fresh `Idempotency-Key` so double clicks never duplicate (HU-E0-10).
- The list uses cursor pagination with a "Load more" control (50 per page) and the period selector follows the space period policy (HU-E4-04).

---

## HU-E9-04 — Categories management screen

- **Milestone:** M6 · **Priority:** Should · **Size:** S · **Depends on:** HU-E3-01, HU-E3-02, HU-E3-03, HU-E9-01 · **Module(s):** `categories/ui`

**User story:** As a space admin, I want a screen to organize the two-level category tree, so that I can keep categories tidy without breaking history.

```gherkin
Feature: Categories screen

  Scenario: The seeded tree is shown
    Given "Ana" has locale "es" and a freshly seeded personal space
    When "Ana" opens the categories screen
    Then the group "Vivienda" lists "Arriendo", "Servicios" and "Mantenimiento"

  Scenario: Create a category in a group
    When "Ana" adds the category "Bakery" to the group "Food" in "Household"
    Then "Bakery" appears under "Food" without reloading the page

  @e2e
  Scenario: A referenced category is offered for archiving instead of deletion
    Given the category "Groceries" has 12 transactions
    When "Ana" deletes "Groceries"
    Then the message of the key "errors.CategoryInUse" is shown with the action "Archive instead"
    And after choosing it "Groceries" moves to the archived section and is no longer offered in the expense form

  Scenario: Restore an archived category
    Given "Groceries" is archived
    When "Ana" restores it from the archived section
    Then "Groceries" is offered again in the expense form

  Scenario: Viewers see the tree read-only
    Given "Sofi" is VIEWER of "Household"
    When "Sofi" opens the categories screen of "Household"
    Then no create, rename, move, archive or delete controls are shown
```

**Technical notes:**
- `CategoryTreeContainer` over a presentational `CategoryTree`; actions call `CreateCategory`, `RenameCategory`, `MoveCategory`, `ArchiveCategory`, `RestoreCategory`, `DeleteCategory`.
- Control visibility follows the role returned for the current member; the use cases still enforce authorization (HU-E1-05).
- Seeded names are user data and are shown as stored, never re-translated (HU-E3-01).

---

## HU-E9-05 — Shared spaces, members, guests and invitations screens

- **Milestone:** M6 · **Priority:** Must · **Size:** M · **Depends on:** HU-E1-04, HU-E1-05, HU-E1-06, HU-E1-07, HU-E1-10, HU-E1-11, HU-E1-12, HU-E9-01 · **Module(s):** `spaces/ui`

**User story:** As a household member, I want screens to create a shared space, invite people, add guests and manage members, so that the household can be set up in the browser.

```gherkin
Feature: Spaces and members screens

  Scenario: Create a shared space from the switcher
    Given "Ana" is signed in
    When "Ana" creates the shared space "Household" with currency "COP" from the space switcher
    Then "Household" becomes the active space
    And its members screen lists "Ana" as "Owner"

  @e2e
  Scenario: A visitor accepts a link invitation after signing up
    Given "Ana" created a link invitation for "Household" with role "MEMBER" and copied its URL
    When a visitor without an account opens the URL
    Then the invitation page shows the space "Household" and the role "MEMBER"
    When the visitor signs up as "juan@example.com"
    Then the visitor is returned to the invitation and accepts it
    And the members screen of "Household" lists "Juan" as "Member"

  Scenario: An added guest is offered as payer and participant
    When "Luis" adds the guest "Pedro" to "Household"
    Then the members screen lists "Pedro (guest)"
    And the new expense form offers "Pedro (guest)" as a payer and as a participant next to "Ana" and "Luis"

  Scenario: Create a claim link for a guest
    Given the guest "Pedro" is a member of "Household"
    When "Ana" creates a claim link for "Pedro"
    Then a copyable claim URL is shown with its expiry 7 days later

  Scenario: Removing a guest with a balance shows the outstanding amount
    Given the guest "Pedro" owes "Ana" 100,000 COP in "Household"
    When "Ana" removes "Pedro"
    Then the message of the key "errors.OutstandingBalance" is shown with the amount 100,000 COP
    And "Pedro (guest)" is still listed

  Scenario: Controls follow the member's role
    Given "Luis" is MEMBER and "Sofi" is VIEWER of "Household"
    When each of them opens the members screen
    Then "Luis" sees "Add guest" but not "Invite"
    And "Sofi" sees neither "Add guest" nor "Invite"
```

**Technical notes:**
- Containers `SpaceSwitcherContainer`, `MembersContainer`, `InvitationPageContainer`, `ClaimPageContainer`; actions call `CreateSharedSpace`, `CreateInvitation`, `RevokeInvitation`, `AcceptInvitation`, `AddGuestMember`, `CreateGuestClaim`, `ClaimGuestPlace`, `RemoveGuestMember`, `ChangeMemberRole`.
- The invitation and claim pages are reachable without a session; signing up from them returns to the same token page (the API part is HU-E1-07 and HU-E1-11).
- Guests are labelled with the i18n key `members.guestSuffix` ("(guest)" in English).

---

## HU-E9-06 — Record a shared expense with split options

- **Milestone:** M6 · **Priority:** Must · **Size:** M · **Depends on:** HU-E1-13, HU-E4-07, HU-E4-08, HU-E4-10, HU-E9-03, HU-E9-05 · **Module(s):** `ledger/ui`, `budgeting/ui`

**User story:** As a household member, I want an expense form with payer, participants and every split method plus a live preview of the shares, so that I record shared expenses correctly the first time.

```gherkin
Feature: Shared expense form

  Background:
    Given "Ana" is signed in and "Household" has the members "Ana" and "Juan"

  @e2e
  Scenario: Equal split among the selected participants
    When "Ana" enters "Groceries" for 300,000 COP paid from "Bancolombia" and selects "Ana" and "Juan" as participants
    Then the preview shows 150,000 COP for "Ana" and 150,000 COP for "Juan"
    And after saving, the expense appears in the "Household" transaction list

  Scenario Outline: The preview follows the chosen split method
    When "Ana" enters an expense of <amount> and chooses the split "<method>" with "Ana" <ana> and "Juan" <juan>
    Then the preview shows <anaShare> for "Ana" and <juanShare> for "Juan"

    Examples:
      | amount      | method  | ana         | juan        | anaShare    | juanShare   |
      | 300,000 COP | PERCENT | 40%         | 60%         | 120,000 COP | 180,000 COP |
      | 250,000 COP | EXACT   | 100,000 COP | 150,000 COP | 100,000 COP | 150,000 COP |
      | 90,000 COP  | SHARES  | 2 units     | 1 unit      | 60,000 COP  | 30,000 COP  |

  Scenario: An invalid split cannot be saved
    When "Ana" enters an expense of 300,000 COP split "PERCENT" with "Ana" 40% and "Juan" 50%
    Then the form shows that 10% remains unassigned
    And the save button is disabled

  @e2e
  Scenario: The default split by allocation is preselected and can be overridden
    Given the 2026-11 plan of "Household" is "ACTIVE" and "Groceries" maps to "Home" allocated "Ana" 40% and "Juan" 60%
    When "Ana" enters an expense of 2,000,000 COP in "Groceries" dated 2026-11-08
    Then the split "BY_ALLOCATION" is preselected with 800,000 COP for "Ana" and 1,200,000 COP for "Juan"
    And switching to "EQUAL" updates the preview to 1,000,000 COP each

  Scenario: Lines without allocation do not offer BY_ALLOCATION
    Given "Free" is the catch-all line with allocation rule "NONE" and "Outings" is not mapped
    When "Ana" enters an expense of 50,000 COP in "Outings"
    Then the split "EQUAL" is preselected with 25,000 COP each
    And "BY_ALLOCATION" is not offered

  Scenario: Paying beyond the fund balance shows a warning
    Given "Household Fund" has a balance of 1,500,000 COP
    When "Ana" saves an expense of 2,000,000 COP paid from "Household Fund"
    Then the expense is saved
    And a warning shows that "Household Fund" balance is -500,000 COP
```

**Technical notes:**
- `ExpenseFormContainer` loads members, accounts and the resolved default split (`ResolveDefaultSplit`, HU-E6-08); the presentational `SplitEditor` computes the preview with the same `SplitCalculator` rules and the server result is authoritative. The default-split scenarios become active once HU-E6-08 is `Done` (M3); until then the form defaults to `EQUAL`.
- v1 offers one payer per expense (spec 5.2); guests are payers without an account picker, and a fund payment hides the payer member.
- Warning codes in the response (`FundBalanceNegative`, HU-E4-10) are rendered through `warnings.<Code>` keys.
- "Split with someone" reuses the same form to call `SplitWithPerson` (HU-E1-13), offering existing co-members or a new guest.

---

## HU-E9-07 — Balances and settle-up screen

- **Milestone:** M6 · **Priority:** Must · **Size:** M · **Depends on:** HU-E5-01, HU-E5-02, HU-E5-03, HU-E5-04, HU-E9-05 · **Module(s):** `balances/ui`, `ledger/ui`

**User story:** As a household member, I want a balances screen with settle-up actions, so that we see who owes whom and clear debts in a few clicks.

```gherkin
Feature: Balances and settle-up screen

  Scenario: Balances show who owes whom
    Given "Ana" paid an expense of 300,000 COP split "EQUAL" between "Ana" and "Juan" in "Household"
    When "Juan" opens the balances screen of "Household"
    Then it shows "Juan owes Ana 150,000 COP"

  @e2e
  Scenario: Settle up from a suggestion
    Given in "Trip 2026" the net balances are "Ana" +150,000 COP, "Juan" -100,000 COP and "Luis" -50,000 COP
    When "Juan" opens the balances screen and chooses "Settle" on the suggestion "Juan pays Ana 100,000 COP"
    And confirms the prefilled settlement form
    Then a settlement of 100,000 COP from "Juan" to "Ana" is listed
    And "Juan" shows a net balance of 0 COP

  Scenario: Record a partial settlement
    Given "Juan" owes "Ana" 1,200,000 COP in "Household"
    When "Juan" records a settlement of 500,000 COP to "Ana" from the settle-up form
    Then the balances screen shows "Juan owes Ana 700,000 COP"

  Scenario: Settlement paid by a guest has no account field
    Given the guest "Pedro" owes "Ana" 100,000 COP in "Household"
    When "Ana" opens the settle-up form and chooses "Pedro (guest)" as payer
    Then the source account field is hidden
    And saving 100,000 COP to "Ana" shows "Pedro" with a net balance of 0 COP

  Scenario: Balance history per member
    Given in "Household" "Ana" paid 300,000 COP split "EQUAL" on 2026-10-03, "Juan" paid 100,000 COP split "EQUAL" on 2026-10-10 and "Juan" settled 100,000 COP to "Ana" on 2026-10-30
    When "Juan" opens his balance history
    Then the entries show running balances of -150,000 COP, -100,000 COP and 0 COP
```

**Technical notes:**
- Containers `BalancesContainer`, `SettleUpFormContainer`, `BalanceHistoryContainer`; actions call `GetSpaceBalances`, `GetSettlementSuggestions`, `RecordSettlement`, `GetMemberBalanceHistory`.
- Accepting a suggestion only prefills the form; the settlement is recorded through the regular `RecordSettlement` path with an `Idempotency-Key` (HU-E0-10).
- Signed amounts are rendered as sentences through i18n keys (`balances.owes`), never by concatenating strings.

---

## HU-E9-08 — Budget planner screens

- **Milestone:** M6 · **Priority:** Must · **Size:** M · **Depends on:** HU-E6-01, HU-E6-02, HU-E6-03, HU-E6-04, HU-E6-05, HU-E6-06, HU-E6-07, HU-E6-09, HU-E9-05 · **Module(s):** `budgeting/ui`

**User story:** As a household admin, I want a planner screen for capacities, lines, mappings, allocation rules and the plan lifecycle, so that we can set up the reference plan in under 5 minutes.

```gherkin
Feature: Budget planner

  Background:
    Given "Ana" is OWNER and "Juan" is MEMBER of "Household" with the period policy MONTHLY(1)

  @e2e @golden
  Scenario: Build the reference plan
    When "Ana" creates the 2026-11 plan and enters capacities "Ana" 1,600,000 COP and "Juan" 2,400,000 COP
    And adds "Rent" 1,200,000 COP funded by "SHARED_FUND", "Home" 1,470,000 COP "DIRECT", "Savings" 600,000 COP "SAVINGS" with a savings account and "Free" 730,000 COP "DIRECT" marked as catch-all, all with rollover "RESET"
    Then the planner shows total capacity 4,000,000 COP split 40.00% / 60.00%
    And it shows unallocated capacity 0 COP and "Home" at 36.75% of total capacity

  Scenario: The capacity suggestion is private
    Given "Ana" recorded income of 1,650,000 COP in her personal space during 2026-10
    When "Ana" opens her capacity field in the 2026-11 plan
    Then she sees the suggestion 1,650,000 COP with the action "Use suggestion"
    And "Juan" never sees that suggestion on his planner screen

  Scenario: The allocation editor previews assigned amounts and rejects bad sums
    When "Ana" sets "Free" to "PERCENT" with "Ana" 42% and "Juan" 58%
    Then the preview shows 306,600 COP for "Ana" and 423,400 COP for "Juan"
    And changing "Juan" to 57% shows the message of the key "errors.InvalidAllocation" with the sum 99%

  Scenario: A line can be left unallocated
    When "Ana" sets the allocation of "Free" to "Not allocated"
    Then "Free" shows planned, spent and available without per-member amounts

  Scenario: Copy the previous plan
    Given the reference 2026-11 plan exists and "Utilities" was archived afterwards
    When "Ana" chooses "Copy previous plan" for 2026-12
    Then a draft 2026-12 plan with the lines "Rent", "Home", "Savings" and "Free" is shown
    And a notice lists "Utilities" as dropped from the mappings

  Scenario: Activate and close from the planner
    Given the 2026-11 draft plan has "Free" allocated "PERCENT" summing to 99%
    When "Ana" chooses "Activate"
    Then the message of the key "errors.InvalidAllocation" names the line "Free"
    And after fixing it to 100% "Activate" sets the status badge to "Active", and "Close" later sets it to "Closed" and disables editing
```

**Technical notes:**
- Containers `PlannerContainer`, `CapacityContainer`, `LineEditorContainer`, `AllocationEditorContainer`; presentational components receive the plan DTO with derived `assigned`, `available` and unallocated capacity.
- The capacity suggestion is fetched only for the signed-in member (`SuggestCapacity`, spec D17) and is never part of the shared plan DTO.
- Plan updates send `If-Match` with the plan ETag; a 412 shows `errors.PreconditionFailed` and reloads the plan (HU-E0-10).
- Category mapping uses a multi-select limited to active categories of the same space (HU-E6-04).

---

## HU-E9-09 — Recurring transactions and pending confirmations screens

- **Milestone:** M6 · **Priority:** Should · **Size:** M · **Depends on:** HU-E4-11, HU-E4-12, HU-E4-13, HU-E9-06 · **Module(s):** `ledger/ui`

**User story:** As a household member, I want to manage recurring transactions and confirm variable bills from one screen, so that fixed costs keep flowing into the plan without retyping.

```gherkin
Feature: Recurring transactions screens

  Background:
    Given "Ana" is signed in and "Household" has the members "Ana" and "Juan" and the account "Household Fund"

  Scenario: Define a recurring expense
    When "Ana" defines "Rent" for 1,200,000 COP in "Rent" paid from "Household Fund" with schedule MONTHLY(1), mode "AUTO", starting 2026-12-01
    Then the recurring list shows "Rent" with next occurrence 2026-12-01

  Scenario: The schedule preview clamps short months
    When "Ana" chooses the schedule MONTHLY(31) starting 2027-01-01
    Then the preview lists 2027-01-31, 2027-02-28 and 2027-03-31

  @e2e
  Scenario: Confirm a pending occurrence with the real amount
    Given "Home" is allocated 40/60 in the ACTIVE 2026-12 plan
    And the pending occurrence "Electricity" dated 2026-12-10 suggests 180,000 COP
    When "Ana" opens pending confirmations, enters 205,300 COP and confirms
    Then the expense "Electricity" of 205,300 COP appears in the transaction list
    And its shares show 82,120 COP for "Ana" and 123,180 COP for "Juan"

  Scenario: Skip a pending occurrence
    Given the pending occurrence "Electricity" dated 2026-12-10
    When "Ana" skips it
    Then it leaves the pending list and the recurring list shows the next occurrence 2027-01-10

  Scenario: Viewers cannot act on pending occurrences
    Given "Sofi" is VIEWER of "Household"
    When "Sofi" opens the recurring screen
    Then no define, pause, confirm or skip controls are shown
```

**Technical notes:**
- Containers `RecurrenceListContainer`, `RecurrenceFormContainer`, `PendingOccurrencesContainer`; the recurrence form reuses the split editor of HU-E9-06.
- The schedule preview comes from the upcoming-occurrences query of HU-E4-11, never from client-side date math.
- A badge in the shell shows the number of pending occurrences for members with role MEMBER or above.

---

## HU-E9-10 — Space dashboards: lines, member matrix and fund tracking

- **Milestone:** M6 · **Priority:** Must · **Size:** M · **Depends on:** HU-E7-01, HU-E7-02, HU-E7-03, HU-E9-08 · **Module(s):** `reporting/ui`

**User story:** As a household member, I want dashboards for budget lines, the member matrix and fund contributions, so that we see at a glance how the month is going against the plan.

```gherkin
Feature: Space dashboards

  Background:
    Given the ACTIVE reference plan for 2026-11 in "Household" and the E7 shared fixture expenses

  @e2e @golden
  Scenario: Line dashboard shows planned, spent and available
    When "Ana" opens the dashboard of "Household" for 2026-11
    Then the bars and table show:
      | line       | planned       | spent         | available   |
      | Rent       | 1,200,000 COP | 1,200,000 COP | 0 COP       |
      | Home       | 1,470,000 COP | 1,300,000 COP | 170,000 COP |
      | Savings    | 600,000 COP   | 0 COP         | 600,000 COP |
      | Free       | 730,000 COP   | 250,000 COP   | 480,000 COP |
      | Unbudgeted | 0 COP         | 60,000 COP    | -60,000 COP |

  Scenario: Overspent lines are highlighted
    Given an additional "Groceries" expense of 300,000 COP on 2026-11-20
    When "Ana" opens the dashboard for 2026-11
    Then "Home" shows available -130,000 COP with the "Overspent" badge

  Scenario: A period without a plan offers to create or copy one
    Given "Household" has no plan for 2027-01
    When "Ana" opens the dashboard for 2027-01
    Then all spending is shown under "Unbudgeted"
    And the actions "Create plan" and "Copy previous plan" are offered

  Scenario: Member matrix translates reason codes
    When "Ana" opens the member matrix for 2026-11
    Then the "Home" row shows "Ana" assigned 588,000 COP, contributed 900,000 COP, consumed 520,000 COP and gap 312,000 COP labelled "over-contributed"
    And the "Rent" contributed and gap cells read the message of the key "reports.reason.TRACKED_AT_FUND_LEVEL"

  Scenario: Fund tracking compares expected and actual
    Given "Ana" contributed 480,000 COP on 2026-11-02 and "Juan" contributed 500,000 COP on 2026-11-03
    When "Ana" opens fund tracking for 2026-11
    Then "Juan" shows expected 720,000 COP, actual 500,000 COP and difference -220,000 COP
```

**Technical notes:**
- Containers `LineDashboardContainer`, `MemberMatrixContainer`, `FundTrackingContainer`; presentational chart components (Recharts bar per line) receive DTOs only (moved from HU-E7-01).
- Reason and status codes (`TRACKED_AT_FUND_LEVEL`, `NOT_ALLOCATED`, `OVER_CONTRIBUTED`) map to `reports.reason.<Code>` and `reports.status.<Code>` keys.
- Viewers see every dashboard; period navigation follows the space period policy.

---

## HU-E9-11 — Personal dashboards: unified view and trends

- **Milestone:** M6 · **Priority:** Must · **Size:** M · **Depends on:** HU-E7-04, HU-E7-05, HU-E9-01 · **Module(s):** `reporting/ui`

**User story:** As a user, I want my unified personal view and trend charts on screen, so that I know my real consumption and cash out across all my spaces and how they evolve.

```gherkin
Feature: Personal dashboards

  @e2e
  Scenario: Unified view totals across spaces
    Given "Ana" has the November 2026 movements of the HU-E7-04 fixture
    When "Ana" opens her unified view for 2026-11
    Then it shows consumption 1,575,000 COP and cash out 2,625,000 COP
    And "Groceries" from her personal space and "Household" is one row of 1,035,000 COP

  Scenario: Movements recorded as a guest are labelled outside the app
    Given "Pedro" claimed his guest place in "Household" after paying the 300,000 COP "Hotel" expense as a guest on 2026-10-08
    When "Pedro" opens his unified view for 2026-10
    Then the 300,000 COP payment is listed in cash out with the label of the key "reports.outsideTheApp"
    And his consumption includes the 100,000 COP "Hotel" share

  Scenario: Line trend versus the previous period
    Given "Home" spent 1,350,000 COP in 2026-10 and 1,300,000 COP in 2026-11
    When "Ana" opens the trend of "Household" ending 2026-11
    Then "Home" shows -50,000 COP (-3.70%)

  Scenario: A new line shows a badge instead of a percentage
    Given the line "Pets" exists only in the 2026-11 plan with spent 80,000 COP
    When "Ana" opens the trend ending 2026-11
    Then "Pets" shows the "New" badge

  Scenario: Six-period personal consumption chart
    Given "Ana" had consumption in each period from 2026-06 to 2026-11
    When "Ana" opens her personal trend ending 2026-11
    Then a line chart with 6 points from 2026-06 to 2026-11 is shown
```

**Technical notes:**
- Containers `UnifiedViewContainer`, `LineTrendContainer`, `PersonalTrendContainer`; Recharts line charts with a default window of 6 periods (moved from HU-E7-05).
- The unified view uses the viewer's personal period and catalog-key grouping from the API (spec D11); custom categories show as "space / category".
- The change status `NEW` renders the `reports.trend.new` badge; percentages use the locale's number format with two decimals.
