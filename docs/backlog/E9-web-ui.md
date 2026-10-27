# E9 — Web UI

**Goal:** a web interface over the Next.js BFF (spec D18) for every area delivered by the API epics E0–E8, in Spanish by default and in English, so the household can do in the browser everything the API already guarantees.

**Modules involved:** `app/(web)` (pages), each module's `ui/` folder (presentational components and containers), shared atomic components; pages and containers call `/api/v1` through the generated client, with no server actions (P117).

**How this epic works:**

- **Parallel track (milestone M6):** an area's UI story may start as soon as the API stories it depends on are `Done`; it never waits for the whole M0–M5 sequence.
- **Container-presentational:** containers load data and call `/api/v1` through the generated client (P117); presentational components receive DTOs and props only; no component touches the database.
- **Design first:** every screen is designed with `/design` and reviewed by the owner before its UI story moves to `Ready`.
- **Stack:** shadcn/ui + Tailwind CSS, atomic design for shared components, Recharts for charts, next-intl for `es` (default) and `en` (UI texts only: formats come from the user's preferences, HU-E1-15).
- **Errors and copy:** the API returns stable codes, never translated text; the UI translates every error code (`errors.<Code>`), warning code and reason code through i18n keys.
- **Acceptance:** scenarios describe UI behaviour. `@e2e` scenarios run with Playwright + playwright-bdd against the running app and PostgreSQL; the others run as component or container tests. Amounts are written in backlog form (`1,200,000 COP`) and rendered from the user's formatting preferences, never from the locale (HU-E1-15, HU-E9-02).

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

  @e2e
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
- The containers call `POST /api/v1/auth/sign-up`, `sign-in` and `sign-out` and `GET /api/v1/spaces` through the generated client; problem+json codes map to `errors.<Code>` keys.
- Middleware redirects unauthenticated requests to `/sign-in?next=<path>`; only same-origin `next` values are honoured.

---

## HU-E9-02 — Internationalization setup (es, en)

- **Milestone:** M6 · **Priority:** Must · **Size:** S · **Depends on:** HU-E0-01, HU-E1-01, HU-E1-15 · **Module(s):** `app/(web)`, `shared/infrastructure`

**User story:** As a user, I want the interface in Spanish by default and available in English, and numbers, dates and times written the way I chose, so that I can use the app in my language and my formats.

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

  Scenario Outline: Numbers, dates and times follow the user's preferences, not the language
    Given a user whose locale is "<locale>" and whose effective preferences are numberFormat "<numberFormat>", dateFormat "<dateFormat>" and timeFormat "<timeFormat>"
    When the amount 1,600,000 COP, the date 2026-10-05 and the time 14:30 are displayed
    Then the amount reads "<amount>"
    And the date reads "<date>"
    And the time reads "<time>"

    Examples:
      | locale | numberFormat | dateFormat | timeFormat | amount      | date      | time    |
      | es     | DOT_COMMA    | DMY        | H24        | $ 1.600.000 | 5/10/2026 | 14:30   |
      | es     | COMMA_DOT    | MDY        | H12        | $ 1,600,000 | 10/5/2026 | 2:30 PM |
      | en     | DOT_COMMA    | DMY        | H24        | $ 1.600.000 | 5/10/2026 | 14:30   |

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
- next-intl with `es` (default) and `en` picks the UI texts only; the user's stored locale wins over `Accept-Language`. The language is changed on the settings screen (HU-E9-13).
- Numbers, dates, times and the first day of the week come from the user's effective preferences (`GET /api/v1/me`, HU-E1-15: `numberFormat`, `dateFormat`, `timeFormat`, `weekStart`), never from the locale (decided 2026-10-16). A shared `formatters` module takes the preferences as arguments and does not read the locale; a test fails on any component that formats with the locale's defaults.
- Patterns:
  - `numberFormat`: `DOT_COMMA` `1.234.567,89`, `COMMA_DOT` `1,234,567.89`, `SPACE_COMMA` `1 234 567,89`;
  - `dateFormat`: numeric dates with `/` and no leading zeros, ordered `DMY` (`5/10/2026`), `MDY` (`10/5/2026`) or `YMD` (`2026/10/5`);
  - `timeFormat`: `H24` `14:30`, `H12` `2:30 PM`.

  Until HU-E1-15 is `Done`, the formatters use the built-in es-CO defaults (`DOT_COMMA`, `DMY`, `H24`, `MONDAY`), the same ones the installation rules start with, and switch to the preferences of `GET /api/v1/me` when it lands.
- COP displayed with zero fraction digits when the fraction is zero; the currency symbol belongs to the currency (COP is `$`), not to the language; whitespace normalized in tests (Intl may emit non-breaking spaces).
- Instants render in the user's time zone (HU-E1-14), `America/Bogota` unless it differs; a transaction shows the time of its own zone (HU-E9-03).
- `pnpm i18n:check` verifies both catalogs have the same keys and that every error code in the OpenAPI document has an `errors.<Code>` key.

---

## HU-E9-03 — Personal ledger screens

- **Milestone:** M6 · **Priority:** Must · **Size:** M · **Depends on:** HU-E1-14, HU-E1-15, HU-E2-01, HU-E2-03, HU-E2-04, HU-E2-05, HU-E2-06, HU-E2-07, HU-E3-04, HU-E3-05, HU-E4-01, HU-E4-02, HU-E4-03, HU-E4-05, HU-E4-14, HU-E9-01 · **Module(s):** `accounts/ui`, `ledger/ui`

**User story:** As a user, I want screens for my accounts, my transaction list and forms to record expenses, income and transfers, so that I manage my personal money without calling the API.

```gherkin
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

  Scenario: Pick an optional subcategory
    Given "Groceries" has the subcategories "Vegetables" and "Meat"
    When "Ana" chooses "Groceries" in the new expense form
    Then "Vegetables" and "Meat" are offered as optional chips in the same sheet
    And saving without choosing one records the expense in "Groceries"
    And choosing "Vegetables" records it in "Vegetables", shown as "Groceries › Vegetables" in the list

  Scenario: Transaction list by day and time, with totals and filters
    Given the October 2026 transactions Market 85,000 COP on 2026-10-05 at 08:10, Market 100,000 COP in "Vegetables" on 2026-10-12 at 18:02, Dinner 60,000 COP on 2026-10-12 at 20:45 and Salary 3,200,000 COP on 2026-10-25 recorded by a recurrence without a time
    When "Ana" opens the transaction list for 2026-10
    Then the transactions are grouped by day, newest day first, with "Dinner" before "Market" on 2026-10-12
    And "Dinner" shows "20:45" while "Salary" shows no time
    And 4 transactions are shown with total expenses 245,000 COP and total income 3,200,000 COP
    And filtering by "Groceries" shows 2 transactions totalling 185,000 COP, including the one in "Vegetables"

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

  Scenario: Pay the credit card with a transfer
    Given an expense of 200,000 COP in "Groceries" paid from the CREDIT_CARD "Visa"
    When "Ana" records a transfer of 200,000 COP from "Bancolombia" to "Visa" on 2026-10-25
    Then the transaction list shows the transfer without a category
    And the period expense total still counts the 200,000 COP once
    And "Available" decreases by 200,000 COP while "Net worth" does not change
```

**Technical notes:**
- Containers per screen (`AccountsContainer`, `TransactionListContainer`, `ExpenseFormContainer`, `IncomeFormContainer`, `TransferFormContainer`); presentational components receive DTOs only.
- Forms check only what they need to build a request (an amount they can read, an account) and call `POST …/expenses`, `/incomes` and `/transfers`; the API's codes are shown next to their fields (P118).
- The list uses cursor pagination with a "Load more" control (50 per page) and the period selector follows the space period policy (HU-E4-04).
- Time (HU-E4-14, HU-E1-14): every transaction a person records has a time. The forms default to now in the user's time zone and always send `occurredAt` with the browser's zone; the form never sends a date alone and offers no way to clear the time. A row that has no time (a scheduler occurrence or a migrated row) gets its first time by editing. The list groups by day under headings with i18n keys (`ledger.day.today`, `ledger.day.yesterday`, then the date in the user's date format) and orders each day by time, untimed rows last. A row shows the wall-clock time in the record's zone, in the user's time format (HU-E1-15), plus the zone's name when it differs from the viewer's; recurring and imported rows show no time.
- Date and time sheet: the chip in the form opens it. The chip reads the day, a middle dot and the time in the user's time format, such as "Today · 23:30", "Yesterday · 19:00" or "Yesterday · 7:00 PM"; an older day shows its date in the user's date format. The day names are the keys `ledger.day.today`, `ledger.day.yesterday` and `ledger.day.dayBeforeYesterday`. The sheet holds, from top to bottom:
  - three quick-day buttons: Today, Yesterday and The day before yesterday;
  - a month calendar whose week starts on the user's `weekStart` (HU-E1-15);
  - an hour stepper and a minute stepper; the minute moves in 5-minute steps and snaps to the nearest multiple of 5, so a carried-over :32 becomes :30;
  - minute shortcuts `:00`, `:15`, `:30` and `:45`, and a "Now" button;
  - a clock that follows `timeFormat`: hours 00–23 for `H24`, or hours 1–12 with an AM/PM toggle for `H12`.
- Validation errors from the API, such as `errors.InvalidAmount` for 0 COP, are shown next to their field and nothing is created (the pattern of HU-E9-01).
- Category picker (HU-E3-04, HU-E3-05): parent categories first, each with its icon and color; choosing one shows its subcategories as optional chips in the same sheet; a subcategory is never required. Creating or editing a category from the form is HU-E9-12.
- Accounts screen (HU-E2-05 … HU-E2-07): type icon and color, institution and last four digits per account; card limit, available credit and next cut-off and payment dates; the "Available" and "Net worth" totals of the space. The account form shows only the attributes of the chosen type and the two switches; the type cannot change after creation.

---

## HU-E9-04 — Categories management screen

- **Milestone:** M6 · **Priority:** Should · **Size:** S · **Depends on:** HU-E3-01, HU-E3-02, HU-E3-03, HU-E3-04, HU-E3-05, HU-E9-01 · **Module(s):** `categories/ui`

**User story:** As a space admin, I want a screen to organize the category tree and its optional subcategories, so that I can keep categories tidy without breaking history.

```gherkin
Feature: Categories screen

  Scenario: The seeded tree is shown
    Given "Ana" has locale "es" and a freshly seeded personal space
    When "Ana" opens the categories screen
    Then the group "Vivienda" lists "Arriendo", "Servicios" and "Mantenimiento"

  Scenario: Create a group, a category and a subcategory, and no deeper level is offered
    When "Ana" taps "New group" on the screen and creates "Pets" with the symbol "paw" and the color "OLIVE"
    Then "Pets" appears as a group without reloading the page
    When "Ana" adds the category "Bakery" to the group "Food" in "Household"
    Then "Bakery" appears under "Food" without reloading the page
    When "Ana" adds the subcategory "Vegetables" to the category "Groceries"
    Then "Vegetables" appears nested under "Groceries"
    And "Vegetables" offers no control to add a subcategory under it

  Scenario: Change a category's icon, color and group
    Given "Groceries" shows the symbol "cart" in "SAND" and has the subcategories "Vegetables" and "Meat"
    When "Ana" opens "Groceries" from the categories screen
    Then the icon picker shows 11 quick choices and a "see all" tile
    And the color row shows all 16 colors
    When "Ana" taps "see all", opens the Emoji tab of the library, finds "🛒" by searching for its name and chooses it
    And chooses the color "PLUM"
    And taps "New group" in the group choice of the category form and creates "Pantry"
    And saves
    Then the tree and the expense form show "Groceries" with "🛒" in "PLUM" under the group "Pantry"
    And its subcategories "Vegetables" and "Meat" move with it and show the same icon and color

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
    Then no create, edit, move, archive or delete controls are shown, "New group" among them
```

**Technical notes:**
- `CategoryTreeContainer` over a presentational `CategoryTree`; actions call `CreateCategory`, `CreateCategoryGroup`, `RenameCategory`, `MoveCategory`, `ArchiveCategory`, `RestoreCategory`, `DeleteCategory`.
- Control visibility follows the role returned for the current member; the use cases still enforce authorization (HU-E1-05).
- Seeded names are user data and are shown as stored, never re-translated (HU-E3-01).
- Subcategories (HU-E3-04) are nested and collapsible under their category; moving a category moves its subcategories, and archiving a category says that its subcategories are archived too. A `CategoryDepthExceeded` or `ParentCategoryArchived` from the API is shown through its `errors.<Code>` key.
- Edit sheet (HU-E3-05): tapping a row opens it, with the name, the group choice, an icon picker, the color row, the list of subcategories, and archive or delete. Choosing another group moves the category with its subcategories. A subcategory row hides the icon and color pickers, because it shows its parent's style. Entry points: Avatar › Categories, and "Manage" in the category picker of the expense form.
- Icon picker: an "Icons" and an "Emoji" tab, each with 11 quick choices and a "see all" tile. The quick symbols are cart, bread, cup, fork, bus, home, bulb, heart, gift, book and gym; the quick emoji are the first 11 of the emoji library. A current choice outside the quick set takes the first slot, so it is always visible and selected. The edit sheet, the new-group sheet and the sheets of HU-E9-12 share this picker.
- An emoji icon is one grapheme of at most 32 UTF-16 units (P59); the icon slot clips anything wider than one glyph, since invisible suffixes and ZWJ chains are accepted.
- Icon library: "see all" opens a sheet over the current one, which keeps its draft. It has the same "Icons" and "Emoji" tabs, a search field and the choices in sections (the nine of HU-E3-05 for symbols, its own for emoji). The search ignores case and matches a choice's label or its section's name; with no match it says so. Choosing applies the choice and closes the library; back closes it unchanged. Labels and section names come from the message catalogs (HU-E9-02); sections are UI-only, so the API still receives one symbol name or one emoji.
- Color row: all 16 palette keys of HU-E3-05 as swatches, each named by its localized label for assistive technology; each key takes its light or dark tokens from the theme.
- Groups: "New group" is a "+" on the screen's header and the last choice of the group choice in the category form. Both open one sheet (name, icon picker, color row, "Create group", calling `CreateCategoryGroup`); from the category form, creating selects the new group there and the form keeps its draft, and back leaves without creating. Like every create control, both show only to roles that manage the tree.

**As built (issue #72, ruling P254):**

- **Route and entry.** `/spaces/{spaceId}/categories`, with `ScreenHeader` back to the space's home. The entry is Avatar › Categorías, in every kind of space. The "Manage" entry in the expense form's category picker is left to HU-E9-12: leaving the form for this screen would drop the expense draft, which HU-E9-12 exists to keep.
- **Who manages.** OWNER and ADMIN (a personal space's owner is its OWNER). Every other role sees the tree read-only, with a note that says who changes it: no "+", no "Agregar categoría", no edit, restore, archive or delete control. Opening and closing subcategories stays.
- **Tabs.** "Gastos" and "Ingresos" split the groups as the pickers do (`groupsForKind`, issue #173). A group created here has no catalog key, so it shows on both tabs.
- **Live updates.** `CategoryTreeContainer` reads the whole tree once (`?archived=true`). Each create, update, archive, restore and delete updates the shown tree from what the API answered (`withGroup`, `withCategory`, `withoutCategory` in `category-tree.ts`), so nothing reloads and the screen makes no read of its own (P127). A category keeps its place when it stays in its group and goes last into another one. Its subcategories follow its group, its style (HU-E3-05 derives theirs) and its archiving. An answer that names a group or parent the screen does not hold makes it read the tree again (`router.refresh()`) instead of dropping the category.
- **Rows.** A category row shows its icon, name and subcategory count, and opens the edit sheet. A chevron opens or closes its subcategories, which show their parent's icon. A subcategory row opens the subcategory's sheet.
- **Edit sheet.** A category's sheet has the name, the group choice (chips, then "Nuevo grupo"), the icon picker, the color row, its subcategories with "Nueva subcategoría" and "Agregar subcategoría", and Archivar and Eliminar. "Guardar cambios" sends one `PATCH` with only what changed. A subcategory's sheet has the name, a note that it shows its parent's style, and Archivar and Eliminar. It offers no picker, no group choice and no subcategory of its own, and moving a subcategory to another parent is not offered (no scenario asks for it).
- **Archive and delete.** Both ask first, in the sheet. Archiving a category with live subcategories says they are archived too. A delete refused with `CategoryInUse` shows its `errors.CategoryInUse` message and "Archivar en su lugar", which archives the category and closes the sheet.
- **Archived section.** "Archivadas" lists the archived categories and subcategories of the tab's live groups, a subcategory by its path ("Groceries › Vegetables"), each with "Restaurar" for who manages. A refusal such as `ParentCategoryArchived` shows its `errors.<Code>` message above the list. Archived groups are not shown: archiving and restoring groups is not part of this story.
- **New group.** The sheet preselects the default style of a group created without one (`tag` in `GRAPHITE`), and sends an icon or a color only once the person changed it, so the stored default stays the API's.
- **Icon picker.** The quick symbols are the story's list (cart, bread, cup, fork, bus, home, bulb, heart, gift, book and gym), where the artboard showed car, ticket and plane. The story wins (M6a Self-Review, "Design deviations"). The "see all" tile is the twelfth cell of the 6 × 2 grid, so 11 tiles and it fit 44 px each at 320 px. `ChoiceGroup` gains two layouts for this: `tiles` and `swatches`.
- **Emoji library.** 64 emoji in eight sections: food, home, transport, health, leisure, shopping, money, and people and work. Each emoji has a label in both catalogs (`categories.emoji.<id>`), so search finds 🛒 by "carrito" or "shopping cart". The quick emoji are the first 11. The 58 symbol labels, the nine symbol section names and the 16 color names live in `categories.symbol`, `categories.symbolSection` and `categories.color`. HU-E9-12 reuses `IconPicker`, `ColorRow` and `GroupSheet` from `categories/ui`.
- **Performance.** The category and group sheets, with the pickers and the library, load on the first tap (`next/dynamic`). Measured with Lighthouse mobile, the route loads 165 KiB of script with an LCP of 1862 ms (167 KiB and 2360 ms before the sheets were split out). Its budget is 168 KiB.

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
- Containers `MembersContainer`, `InvitationContainer` (invitations and claims) and the switcher's `/spaces/new` form call `/api/v1` through the generated client (P117): `POST /api/v1/spaces`, `GET …/members`, `GET` and `POST …/invitations`, `POST …/invitations/{id}/revoke`, `GET` and `POST /api/v1/invitations/{token}[/accept]`, `POST …/guests`, `POST …/guests/{id}/claim-links`, `DELETE …/guests/{id}`, `GET` and `POST /api/v1/claims/{token}[/accept]` and `PATCH …/members/{id}`; controls follow a UI copy of the permission matrix pinned to the domain (P158).
- The invitation and claim pages are reachable without a session; signing up from them returns to the same token page (the API part is HU-E1-07 and HU-E1-11). The previews `GET /api/v1/invitations/{token}` and `GET /api/v1/claims/{token}` answer without a session and never carry an email (P156); the pages live in the route group `(open)` (P157). Accepting opens the space's home with a one-time "Te uniste a «Nombre»" notice (`?joined=1`).
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
- `RecordFormContainer` loads the members, the space's accounts and the recorder's personal accounts; `useDefaultSplit` reads `GET …/default-split` as the form changes (P167); the presentational `SplitSheet` previews the shares with `previewSplit`, pinned to the domain's `splitShares` (P166), and the server result is authoritative. BY_ALLOCATION is requested by sending no `split`. The form's split row summarizes who is included ("Con Ana y Luis · mitad y mitad").
- v1 offers one payer per expense (spec 5.2); guests are payers without an account picker, and a fund payment hides the payer member; another registered member is never the payer, since only an account's owner records its debit (D9, P168).
- Warning codes in the response (`FundBalanceNegative`, HU-E4-10) are rendered through `warnings.<Code>` keys; the list shows it from `?notice=FundBalanceNegative&account=<id>` (P170).
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
- Containers `BalancesContainer` (with the settle-up sheet) and `HistoryContainer`; actions call `GetSpaceBalances`, `GetSettlementSuggestions`, `RecordSettlement`, `GetMemberBalanceHistory`.
- Accepting a suggestion only prefills the form (the sheet records now in the browser's zone, with one `Idempotency-Key` per draft, P174); the settlement is recorded through the regular `RecordSettlement` path with an `Idempotency-Key` (HU-E0-10).
- Signed amounts are rendered as sentences through i18n keys (`balances.owes`), never by concatenating strings. The history covers a period of the space, `?from=<date>` for another (P176).

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
- Containers `PlannerContainer`, `CapacityContainer`, `LineEditorContainer`, `AllocationEditorContainer` (the allocation editor is part of the line editor and saves with it, M6c ruling P210); presentational components receive the plan DTO with derived `assigned`, `available` and unallocated capacity.
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

- **Milestone:** M6 · **Priority:** Must · **Size:** M · **Depends on:** HU-E7-01, HU-E7-02, HU-E7-03, HU-E7-06, HU-E9-08 · **Module(s):** `reporting/ui`

**User story:** As a household member, I want dashboards for budget lines, the member matrix, fund contributions and spending by category group, so that we see at a glance how the month is going against the plan and where the money went.

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

  Scenario: Spending by group drills down to categories and subcategories
    Given "Groceries" has the subcategories "Vegetables" and "Meat"
    And its 900,000 COP of the E7 shared fixture is recorded as 450,000 COP in "Groceries", 270,000 COP in "Vegetables" and 180,000 COP in "Meat"
    When "Ana" opens the dashboard of "Household" for 2026-11 and chooses the view "By group"
    Then the chart shows "Housing" 1,600,000 COP (56.94%), "Food" 960,000 COP (34.16%) and "Leisure" 250,000 COP (8.90%)
    When "Ana" taps "Food"
    Then the chart shows "Groceries" 900,000 COP (93.75%) and "Restaurants" 60,000 COP (6.25%) under the breadcrumb "Food"
    When "Ana" taps "Groceries"
    Then the chart shows the slice of the key "reports.byGroup.noSubcategory" with 450,000 COP (50.00%), "Vegetables" 270,000 COP (30.00%) and "Meat" 180,000 COP (20.00%) under the breadcrumb "Food › Groceries"
    When "Ana" taps "Food" in the breadcrumb
    Then the categories of "Food" are shown again
```

**Technical notes:**
- Containers `LineDashboardContainer`, `MemberMatrixContainer`, `FundTrackingContainer`; presentational components with HTML bars beside the same figures (M6c ruling P202) receive DTOs only (moved from HU-E7-01).
- Reason and status codes (`TRACKED_AT_FUND_LEVEL`, `NOT_ALLOCATED`, `OVER_CONTRIBUTED`) map to `reports.reason.<Code>` and `reports.status.<Code>` keys.
- Viewers see every dashboard; period navigation follows the space period policy.
- Spending by group (HU-E7-06): `SpendingByGroupContainer` loads `GET /api/v1/spaces/{spaceId}/reports/spending-by-group` once and passes the tree to a presentational `SpendingChart` (rows of the groups with HTML bars, which are the table of the same figures, M6c ruling P202) and a `DrillBreadcrumb`. Tapping a slice or row goes one level down, from group to category to subcategory, and the breadcrumb (`Food › Groceries`) goes back up; drilling is done on the client over the one response and makes no further request. The entry without a subcategory (`subcategoryId` null) reads the key `reports.byGroup.noSubcategory`, and an `archived` node carries the badge of the key `reports.byGroup.archived`. Amounts and shares come from the API and are rendered with the user's number format (HU-E1-15); the UI never recomputes them.

---

## HU-E9-11 — Personal dashboards: unified view and trends

- **Milestone:** M6 · **Priority:** Must · **Size:** M · **Depends on:** HU-E7-04, HU-E7-05, HU-E7-06, HU-E9-01 · **Module(s):** `reporting/ui`

**User story:** As a user, I want my unified personal view, my spending by category group and trend charts on screen, so that I know my real consumption and cash out across all my spaces, where the money went and how it evolves.

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

  Scenario: Spending by group merges seeded groups and labels custom ones by space
    Given "Ana" has the November 2026 movements of the HU-E7-04 fixture
    And "Household" has the custom group "Pets" with the category "Vet", where "Ana"'s share of a 50,000 COP expense is 25,000 COP
    When "Ana" opens her unified view for 2026-11 and chooses the view "By group"
    Then the chart shows "Food" 1,095,000 COP (68.44%), "Housing" 480,000 COP (30.00%) and "Household / Pets" 25,000 COP (1.56%)
    When "Ana" taps "Food"
    Then the chart shows "Groceries" from her personal space and "Household" as one slice of 1,035,000 COP (94.52%) and "Restaurants" 60,000 COP (5.48%) under the breadcrumb "Food"
```

**Technical notes:**
- Containers `UnifiedViewContainer`, `LineTrendContainer`, `PersonalTrendContainer`; Recharts line charts (lazy-loaded, M6c ruling P202) with a default window of 6 periods (moved from HU-E7-05).
- The unified view uses the viewer's personal period and catalog-key grouping from the API (spec D11); custom categories show as "space / category".
- The change status `NEW` renders the `reports.trend.new` badge; percentages use the user's number format (HU-E1-15) with two decimals.
- Spending by group (HU-E7-06): `PersonalSpendingByGroupContainer` loads `GET /api/v1/me/reports/spending-by-group` once and uses the same presentational `SpendingChart` and `DrillBreadcrumb` as HU-E9-10 (shared in `reporting/ui`; whichever story lands first builds them), with the same drill-down on the client and the same keys. Seeded rows arrive merged by catalog key. A custom group or category shows as "space / group" or "space / category", written from the row's `space.name` and `name` through one i18n pattern, never by joining strings, and a subcategory shows as "space / subcategory" because subcategories carry no key.

---

## HU-E9-12 — Manage categories without leaving the expense form

- **Milestone:** M6 · **Priority:** Should · **Size:** S · **Depends on:** HU-E3-02, HU-E3-04, HU-E3-05, HU-E9-03, HU-E9-04 · **Module(s):** `ledger/ui`, `categories/ui`

**User story:** As a member who manages the category tree, I want to create or edit a category from the expense form without losing what I typed, so that recording an expense never stops for housekeeping.

```gherkin
Feature: Manage categories without leaving the expense form

  Background:
    Given "Ana" is signed in, and her personal space has the category "Groceries" with the subcategories "Vegetables" and "Meat" in the group "Food"

  Scenario: Create a category without leaving the expense form
    Given "Ana" entered 45,000 COP and "Bread" in the new expense form
    When "Ana" opens the category picker, chooses "New category" and creates "Bakery" in the group "Food"
    Then the form still shows 45,000 COP and "Bread", now with "Bakery" selected
    And saving records the expense in "Bakery"
    And creating "Bakery" as a subcategory of "Groceries" instead returns with "Groceries › Bakery" selected

  Scenario: Create a group from the new-category sheet
    Given "Ana" entered 45,000 COP and "Bread" in the new expense form
    When "Ana" opens the category picker, chooses "New category" and types "Bakery"
    And taps "New group" in the sheet and creates "Treats" with the emoji "🍰" and the color "ROSE"
    Then the new-category sheet is back with "Bakery" typed and "Treats" selected as its group
    When "Ana" saves the category
    Then "Bakery" is created in "Treats" and selected
    And the form still shows 45,000 COP and "Bread"

  Scenario: Edit the chosen category from the expense form
    Given "Ana" entered 45,000 COP and "Bread" in the new expense form and selected "Groceries"
    When "Ana" chooses the edit control of "Groceries" in the form, opens the icon library with "see all", picks the emoji "🛒" there and picks the color "PLUM"
    And saves the category
    Then the form keeps 45,000 COP, "Bread" and "Groceries"
    And "Groceries" is now shown with "🛒" in "PLUM"

  Scenario: Members who cannot manage categories see no create or edit control in the form
    Given "Sofi" is MEMBER of "Household", a role that may record expenses there but not manage its categories
    When "Sofi" opens the new expense form and its category picker
    Then the picker offers no "New category"
    And no edit controls are shown
```

**Technical notes:**
- The category picker offers "New category" and an edit control per row. The subcategory chips row offers an "Edit" control for the chosen category. All of these appear only when the member's role manages the category tree.
- Each opens a sheet stacked over the form. The form state lives in `ExpenseFormContainer`, and the sheets never reset it.
- Creating returns with the new category or subcategory selected. A toast offers undo: a logical delete of the still-unreferenced category, or patching back the previous values.
- The new-category sheet suggests the group of the current category and lets the member place the new one as a category of that group or as a subcategory of the current category. A subcategory takes its parent's style, so its sheet hides the icon and color pickers.
- Its group choice ends with "New group", which stacks the new-group sheet of HU-E9-04 over it (name, icon, color, `CreateCategoryGroup`). "Create group" records the group at once and returns to the sheet with the new group selected, so the category being created is placed in it; the typed name and the choices made so far are kept, and back leaves without creating the group. Undo (above) covers the category only: a group is archived, never deleted (spec 5.2), so the new group stays until it is archived from the categories screen.
- The icon and color choices of these sheets are those of HU-E9-04: 11 quick choices and a "see all" tile that opens the icon library (sections, search, an "Icons" and an "Emoji" tab). The library is one more sheet stacked over the sheet that asked for it, so neither the expense form nor the draft category is reset.
- Archive and delete stay on the categories screen (HU-E9-04).

---

## HU-E9-13 — Settings screen

- **Milestone:** M6 · **Priority:** Must · **Size:** S · **Depends on:** HU-E1-14, HU-E1-15, HU-E9-01 · **Module(s):** `identity/ui`

**User story:** As a user, I want one Settings screen where I choose my formats, region, appearance and language and see the result at once, so that the app reads the way I am used to.

```gherkin
Feature: Settings screen

  Background:
    Given "Ana" is signed in with the locale "es" and the timezone "America/Bogota"
    And the installation rules are numberFormat "DOT_COMMA", timeFormat "H24", dateFormat "DMY" and weekStart "MONDAY"

  @e2e
  Scenario: Change the formats and see them applied at once
    When "Ana" opens the Settings screen
    Then it shows the sections "Formats", "Region" and "Appearance and language"
    And the preview reads "1.234.567,89", "16/10/2026" and "14:30"
    When "Ana" chooses the number format "1,234,567.89", the date format "10/16/2026" and the time format "12-hour"
    Then each choice is stored as she makes it and the preview reads "1,234,567.89", "10/16/2026" and "2:30 PM"
    And the transaction list shows her amounts, dates and times in the new formats

  Scenario: The language changes only the texts
    Given "Ana" saved the number format "1,234,567.89" and the time format "12-hour"
    When "Ana" chooses the language "English"
    Then the screen is shown in English
    And the preview still reads "1,234,567.89" and "2:30 PM"

  Scenario: A field following the rule says "Default", and Reset returns a changed field to the rule
    Given "Ana" never changed the date format
    Then the date format shows "16/10/2026" with the label of the key "settings.default"
    Given "Ana" saved the time format "12-hour"
    Then the time format offers "Reset" instead of the default label
    When "Ana" chooses "Reset" on the time format
    Then the preview reads "14:30" and the time format shows the label of the key "settings.default"
    And "GET /api/v1/me" returns the stored timeFormat null

  Scenario: A field locked by the installation rules shows a lock badge
    Given the installation rules lock the dateFormat
    And "Ana" had stored the dateFormat "MDY" before the lock
    When "Ana" opens the Settings screen
    Then the date format shows "DMY" with the badge of the key "settings.locked"
    And its selector and "Reset" are disabled
    And the other fields stay editable
```

**Technical notes:**
- Container `SettingsContainer` over presentational `SettingsForm`, `FormatPreview` and `LockBadge`. It loads `GET /api/v1/me` (`preferences.stored`, `effective`, `defaults`, `locked`) and saves with `PATCH /api/v1/me` (HU-E1-14, HU-E1-15); a problem+json code such as `InvalidTimeZone` maps to its `errors.<Code>` key and shows next to the field.
- Sections:
  - Formats: number format, date format, time format and the first day of the week;
  - Region: the time zone, from a searchable list of IANA zones;
  - Appearance and language: the theme (system, light or dark) and the language (`es` or `en`).
- There is no "Save" button: each choice is sent with `PATCH /api/v1/me` as it is made (optimistic, rolled back with its error next to the field on failure). The live preview renders fixed sample values (1,234,567.89, 2026-10-16 and 14:30) with the same `formatters` as the rest of the app (HU-E9-02).
- A field that follows the installation rule shows the label `settings.default`. A field the person changed shows "Reset", which returns it to the rule: for the four formats it clears the stored value (`null`); for the time zone and the language it stores the installation's value.
- A field named in `preferences.locked` is shown read-only with a lock badge (`settings.locked`) and its effective value. Until HU-E8-18 is `Done` (M5) no field is ever locked, so the badge scenario runs as a component test with a stubbed `locked` list.
- The theme is a device setting kept in the browser, outside the profile and the installation rules. Choosing the language reloads the screen with the new texts; the formats never change with it.

---

## HU-E9-14 — Installation rules screen

- **Milestone:** M6 · **Priority:** Should · **Size:** S · **Depends on:** HU-E8-18, HU-E9-01 · **Module(s):** `identity/ui`

**User story:** As the installation administrator, I want a screen for the brand and the defaults, with a switch per field to let people change it or not, and a live preview, so that I can brand my installation and set its rules without calling the API.

```gherkin
Feature: Installation rules screen

  Background:
    Given "Ana" is an installation administrator and "Juan" is an ordinary user

  @e2e
  Scenario: Brand the installation and see it at once
    When "Ana" opens the Installation rules screen
    And enters the brand name "Casa Gómez", chooses the accent "PLUM" and uploads a logo
    Then the preview shows the app header with "Casa Gómez", the logo and the "PLUM" accent
    When "Ana" saves
    Then the sign-in screen of a visitor shows "Casa Gómez", the logo and the "PLUM" accent
    And "Juan" sees the same brand in the app shell

  Scenario: Set a default and stop people from changing it
    When "Ana" sets the default time format "12-hour" and turns off "People may change it" for it
    Then the preview of a sample person's Settings screen shows the time format "12-hour" with a lock badge
    And after saving, "Juan" sees the time format "12-hour" with the badge of the key "settings.locked" on his Settings screen

  Scenario: Ordinary users do not see the screen
    When "Juan" opens the user menu
    Then it offers no "Installation rules" entry
    When "Juan" opens the Installation rules page directly
    Then the message of the key "errors.InstallationAdminRequired" is shown and nothing can be saved
```

**Technical notes:**
- Container `InstallationRulesContainer` over presentational `InstallationRulesForm` and `BrandPreview`; it calls `GET` and `PATCH /api/v1/installation` (with `If-Match`; a 412 shows `errors.PreconditionFailed` and reloads, HU-E0-10), and the logo endpoints (HU-E8-18).
- Sections: Brand (name, logo, accent from the HU-E3-05 palette) and Defaults (the four formats, time zone, language and the currency of new spaces). Each default has a "People may change it" switch; turning it off adds the field to `lockedFields`.
- The preview shows the app header with the brand and a sample of the formats; nothing is stored before "Save".
- The entry appears in the user menu only when `GET /api/v1/me` returns `installationAdmin`; the use cases still enforce it. The role is granted outside the app (HU-E8-18).
- From this story on the app shell and the sign-in and sign-up screens (HU-E9-01) take the brand from the public `GET /api/v1/installation`; until HU-E8-18 is `Done` they show the built-in Hearth brand and the default accent.

---

## Follow-ups after M6a

Left open on purpose by [the M6a plan](../plans/2026-10-20-m6a-web-shell-and-ledger.md) (its Self-Review has the reasons):

1. The account edit form, with #120 (answer stored and effective icon and switches). Done with issue 169 ([E2-accounts.md](E2-accounts.md), ruling P253).
2. Editing, deleting and restoring transactions from the Activity screen (M6b, ruling P140), with the `If-Match` flow and a restore endpoint for transactions; an untimed row gets its first time by editing. Done in the M6b addendum ([plan](../plans/2026-10-21-m6b-addendum-edit-delete-feedback.md)).
3. A text search, and account and type filters, in the transaction list (an API story first).
4. Dependency bumps once each release is two weeks old: `@playwright/test` 1.64.x, `jsdom` 30.1.3, `@axe-core/playwright` and `axe-core` 4.14.0, `@testing-library/user-event` 14.6.8 and `radix-ui` 1.8.1.
5. The controls ruling P126 leaves out, with their stories (HU-E9-04, HU-E9-05, HU-E9-06, HU-E9-07, HU-E9-08, HU-E9-12, HU-E9-14), the recent-category chips and the hide-balances toggle.
6. A designer's review of the derived dark palette.
7. Refuse cookie-authenticated writes whose `content-type` is not `application/json`, or whose `Origin` is foreign, in `defineRoute`.
8. A Content-Security-Policy with a hash for the theme script.
9. Raise `engines.node` to `>=24.15.0 <25` for jsdom 30.
10. Move HU-E9-01, HU-E9-02, HU-E9-03 and HU-E9-13 to `Done` in the [backlog overview](README.md) and update their issue bodies when the M6a pull request merges.
11. Issue #128 (report latency before the dashboards) is carried to the dashboards of M6.

## Follow-ups after M6b

Left open on purpose by [the M6b plan](../plans/2026-10-21-m6b-shared-spaces-split-balances.md) (its Self-Review has the reasons), and by the navigation and UX work built beside it:

1. Space settings screen: rename, currency (until money is recorded) and period policy (the NewSpace artboard's period controls).
2. Leave and archive a space from the members screen (`POST …/leave`, `POST …/archive`).
3. Editing, deleting and restoring transactions from Activity (P140, P179): the [M6b addendum plan](../plans/2026-10-21-m6b-addendum-edit-delete-feedback.md) takes it up.
4. A date control in the settle-up sheet.
5. The default split's line name in `GET …/default-split` (for "Según el plan (Casa)"), and the payer and amount in history entries (for "Ana pagó $ 300.000").
6. The Balances artboard's cross-space hint ("En Hogar: debes …").
7. Sending invitation emails once Hearth can send mail (P144), then hide the URL for email invitations.
8. Lower the new budgets after measuring them (P154's follow-up carried); if the median of five Lighthouse runs still fails on CI's LCP margins (the record route ranged 2260–2646 ms), cut the record route's JavaScript instead of raising its budget.
9. Move HU-E9-05, HU-E9-06 and HU-E9-07 to `Done` in the [backlog overview](README.md) and update their issue bodies when the pull request merges.
10. The `?joined=1` notice shows again on a reload before it is dismissed; a server-side one-time flag would need an API.
11. The `expired=1` redirect after a 401 writes no `hearth.locale` cookie, so a browser asking for English sees English there.
12. The error screens (`ErrorScreen`) cannot be reached in e2e, so they have component tests and jsdom axe scans but no real-browser contrast or reflow check.
13. A pasted amount that carries a group separator before one or two digits ("12.50" where "." is the group) is left as typed and answered by the unreadable-amount message.
