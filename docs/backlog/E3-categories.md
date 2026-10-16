# E3 — Categories

**Goal:** every space has a ready-to-use, customizable category tree — groups and categories, with optional subcategories that roll up into their category — that classifies transactions and feeds budget lines, without ever losing history.

**Modules involved:** `categories`.

---

## HU-E3-01 — Seed default categories per space

- **Milestone:** M1 · **Priority:** Must · **Size:** S · **Depends on:** HU-E1-02 · **Module(s):** `categories`

**User story:** As a new user, I want sensible default categories in every new space, so that I can classify expenses from the first minute.

```gherkin
Feature: Default category seed

  Scenario: Personal space receives the default tree in the creator's locale
    Given "Ana" has locale "es"
    When her personal space is created
    Then the space contains the group "Vivienda" with the categories "Arriendo", "Servicios" and "Mantenimiento"
    And the space contains the group "Ingresos" with the category "Salario"

  Scenario: English locale seeds English names
    Given "Juan" has locale "en"
    When "Juan" creates the shared space "Flat"
    Then the space contains the group "Housing" with the categories "Rent", "Utilities" and "Maintenance"

  Scenario: Seeding is idempotent
    Given the personal space of "Ana" was already seeded
    When the seeding runs again for that space
    Then no duplicate groups or categories are created

  Scenario: Seeded categories belong only to their space
    Given "Ana" renames "Arriendo" to "Alquiler" in her personal space
    Then the categories of "Household" are unchanged

  Scenario: Seeded categories keep a stable catalog key
    Given "Ana" renames "Mercado" to "Supermercado" in her personal space
    Then the category keeps the catalog key "groceries"
    And categories created by users have no catalog key
```

**Technical notes:**
- Use case: `SeedDefaultCategories`, handling `SpaceCreated` (no endpoint); the seeded tree is read through `GET /api/v1/spaces/{spaceId}/categories`, each category with its catalog `key` or null.
- Seed definition lives in the `categories` domain as data with es/en names: Housing (Rent, Utilities, Maintenance), Food (Groceries, Restaurants), Transport (Fuel, Public transport), Health (Medical, Pharmacy), Leisure (Entertainment, Travel), Income (Salary, Other income).
- Names are stored as user data after seeding (not translated on read).
- Each seeded category stores an immutable catalog `key` (e.g. `groceries`), used to group categories across spaces in the unified personal view (spec D11).

---

## HU-E3-02 — Manage category groups and categories

- **Milestone:** M1 · **Priority:** Must · **Size:** M · **Depends on:** HU-E3-01 · **Module(s):** `categories`

**User story:** As a space admin, I want to create, rename and move categories within the category tree, so that the classification fits how my household thinks about money.

```gherkin
Feature: Category tree

  Scenario: Create a category in an existing group
    Given the group "Food" exists in "Household"
    When "Ana" creates the category "Bakery" in "Food"
    Then "Food" contains "Bakery"

  Scenario: Rename a group
    When "Ana" renames the group "Leisure" to "Fun"
    Then the group is named "Fun" and keeps its categories

  Scenario: Move a category to another group
    When "Ana" moves "Pharmacy" from "Health" to "Food"
    Then "Pharmacy" belongs to "Food"
    And existing transactions in "Pharmacy" keep their category

  Scenario: Fourth level is not allowed
    Given the category "Groceries" has the subcategory "Vegetables" (HU-E3-04)
    When "Ana" creates a category under the subcategory "Vegetables"
    Then the result is the error "CategoryDepthExceeded"

  Scenario: Duplicate name in the same group is rejected
    When "Ana" creates the category "groceries" in "Food"
    Then the result is the error "CategoryNameTaken"

  Scenario: Viewer cannot change categories
    Given "Sofi" is VIEWER of "Household"
    When "Sofi" creates the category "Pets" in "Leisure"
    Then the result is the error "InsufficientRole"
```

**Technical notes:**
- Use cases: `CreateCategoryGroup`, `CreateCategory`, `RenameCategory`, `MoveCategory`, `RenameCategoryGroup`.
- Endpoints: `POST /api/v1/spaces/{spaceId}/category-groups`, `PATCH /api/v1/spaces/{spaceId}/category-groups/{groupId}`, `POST /api/v1/spaces/{spaceId}/categories`, `PATCH /api/v1/spaces/{spaceId}/categories/{categoryId}` (rename or move).
- Invariants: at most three levels (group → category → optional subcategory, HU-E3-04); category and group in the same space; names unique per parent (case-insensitive).
- Allowed roles: OWNER, ADMIN (personal space: its owner).
- Amended 2026-10-16 (M3-D): the invariant was "exactly two levels" and the depth scenario was "Third level is not allowed" (a category under "Groceries" answered `CategoryDepthExceeded`). As delivered in M1, the API refuses any category under a category; HU-E3-04 opens the optional third level, and from then on `CategoryDepthExceeded` refuses the fourth.

---

## HU-E3-03 — Archive a referenced category

- **Milestone:** M1 · **Priority:** Must · **Size:** S · **Depends on:** HU-E3-02, HU-E4-01 · **Module(s):** `categories`

**User story:** As a space admin, I want to retire categories without breaking history, so that old transactions and reports stay correct.

```gherkin
Feature: Archive instead of hard delete

  Scenario: Unreferenced category can be deleted
    Given the category "Bakery" has no transactions and no budget line mapping
    When "Ana" deletes "Bakery"
    Then "Bakery" no longer exists

  Scenario: Referenced category cannot be deleted
    Given the category "Groceries" has 12 transactions
    When "Ana" deletes "Groceries"
    Then the result is the error "CategoryInUse"
    And "Groceries" still exists and can be archived instead

  Scenario: Archived category stays in history but not in the active list
    Given "Ana" archived "Groceries"
    Then its 12 transactions are still returned with the category "Groceries"
    And "Groceries" is not returned when active categories are listed

  Scenario: Recording with an archived category is rejected
    Given "Groceries" is archived
    When "Ana" records an expense of 40,000 COP in "Groceries"
    Then the result is the error "CategoryArchived"

  Scenario: Restore an archived category
    Given "Groceries" is archived
    When "Ana" restores it
    Then "Groceries" is returned again when active categories are listed
```

**Technical notes:**
- Use cases: `DeleteCategory`, `ArchiveCategory`, `RestoreCategory`. Endpoints: `DELETE /api/v1/spaces/{spaceId}/categories/{categoryId}`, `POST .../categories/{categoryId}/archive`, `POST .../categories/{categoryId}/restore`; `GET /api/v1/spaces/{spaceId}/categories` excludes archived ones unless `?archived=true`. Offering "archive instead" is web UI behaviour (HU-E9-04).
- Reference check uses ports to `ledger` (transactions) and `budgeting` (line mappings); soft-deleted transactions still count as references (audit).
- Archiving a group archives all its categories.

---

## HU-E3-04 — Optional subcategories

- **Milestone:** M3-D · **Priority:** Must · **Size:** M · **Depends on:** HU-E3-02, HU-E3-03, HU-E4-05, HU-E6-04 · **Module(s):** `categories`, `ledger`, `budgeting`

**User story:** As a space admin, I want optional subcategories under a category, such as Mercado → Verduras and Carnes, so that members can record detail when they want it while budgets and reports keep counting the category.

```gherkin
Feature: Optional subcategories

  Scenario: Create subcategories under a category
    Given the personal space of "Ana" has the category "Mercado"
    When "Ana" creates the subcategories "Verduras" and "Carnes" under "Mercado"
    Then "Mercado" lists the subcategories "Verduras" and "Carnes"
    And both belong to the group of "Mercado" and have no catalog key

  Scenario: Choosing a subcategory is never required
    Given "Groceries" in "Household" has the subcategories "Vegetables" and "Meat"
    When "Ana" records an expense of 85,000 COP in "Groceries" and another of 40,000 COP in "Vegetables"
    Then the first expense has the category "Groceries"
    And the second has the category "Vegetables", whose parent is "Groceries"

  Scenario: Budget lines count subcategories in their category's line
    Given "Groceries" is mapped to the line "Home" in the 2026-11 plan of "Household"
    And expenses of 40,000 COP in "Vegetables", 60,000 COP in "Meat" and 85,000 COP in "Groceries" dated 2026-11-10
    When "Ana" requests the spent amount of "Home" for 2026-11
    Then the three expenses count as 185,000 COP spent in "Home"
    And an expense in "Meat" recorded without a split method is split "BY_ALLOCATION" like "Home"
    When "Ana" maps "Vegetables" to the line "Free"
    Then the result is the error "SubcategoryNotMappable"

  Scenario: Lists and reports roll subcategories up into their category
    Given the October 2026 expenses in "Household" of 85,000 COP in "Groceries", 40,000 COP in "Vegetables" and 60,000 COP in "Restaurants"
    When "Ana" filters the transactions of 2026-10 by the category "Groceries"
    Then 2 transactions are listed with a total of 125,000 COP
    And filtering by "Vegetables" lists only the 40,000 COP expense
    And her unified personal view counts her shares of both under the catalog key "groceries"

  Scenario: A fourth level is not allowed
    Given "Groceries" has the subcategory "Vegetables"
    When "Ana" creates a category under "Vegetables"
    Then the result is the error "CategoryDepthExceeded"
    When "Ana" moves "Groceries" under the category "Restaurants"
    Then the result is the error "CategoryDepthExceeded"

  Scenario: Archiving a category archives its subcategories
    Given "Groceries" has the subcategories "Vegetables" and "Meat"
    When "Ana" archives "Groceries"
    Then "Vegetables" and "Meat" are archived too
    And recording an expense in "Vegetables" returns the error "CategoryArchived"
    And restoring "Vegetables" alone returns the error "ParentCategoryArchived"
```

**Technical notes:**
- Model: `Category` gains `parentCategoryId` (nullable; null means a category directly in its group). A subcategory always has its parent's `groupId`, so moving a category to another group moves its subcategories with it. Depth is at most three levels (group → category → subcategory). `CategoryDepthExceeded` refuses a category under a subcategory, and moving a category that has subcategories under another category. HU-E3-02's invariant and depth scenario are amended accordingly.
- Names are unique per parent (case-insensitive): siblings are the categories with the same group and the same parent. A subcategory may share its name with a category elsewhere.
- Endpoints: `POST /api/v1/spaces/{spaceId}/categories` takes either `groupId` or `parentCategoryId` (exactly one, `ValidationFailed` otherwise); `PATCH .../categories/{categoryId}` accepts `parentCategoryId` (`null` with a `groupId` makes a subcategory a category of that group). `GET /api/v1/spaces/{spaceId}/categories` returns group → categories → `subcategories`, each item with its `parentCategoryId`.
- Seeds (HU-E3-01) are unchanged: no seeded subcategories, and subcategories carry no catalog `key`.
- The roll-up rule is `rollUp(categoryId) = parentCategoryId ?? categoryId`. It applies to:
  - budget mappings (HU-E6-04): only categories are mapped; mapping a subcategory answers `SubcategoryNotMappable`, and `spent(L)` counts the expenses whose category or parent category maps to L. The catch-all line and "Unbudgeted" work the same way;
  - the default split (HU-E6-08): an expense in a subcategory resolves to its parent's line;
  - the transaction filter (HU-E4-05): `categoryIds` includes the subcategories of every listed category;
  - reports: the line dashboard (HU-E7-01) through the mappings, and the unified personal view (HU-E7-04), which groups a subcategory under its parent's catalog key (D11).
- Archive and delete (HU-E3-03): archiving a category archives its subcategories, as archiving a group archives its categories. Restoring a subcategory whose parent is archived answers `ParentCategoryArchived`. A category with subcategories that are not deleted counts as referenced (`CategoryInUse`). Copying a plan (HU-E6-06) is unchanged, because only categories are mapped.
- The unified-view assertion becomes testable once HU-E7-04 (M4) lands.
- Not in scope: tags and splitting one transaction into lines, which the research proposed as an alternative to a third level.
- **Spec impact:** 5.2 **CategoryGroup / Category** ("two levels" becomes group, category and optional subcategory; archive cascade), 5.2 **BudgetLine** ("a category maps to at most one line per plan": only categories are mapped and subcategories follow their parent), 5.3 default split (resolved through the parent), 5.4 `spent(L)` (category or parent category maps to L) and the unified view grouping (a subcategory groups under its parent's key), section 6 (a new decision recording the optional third level and the roll-up).

---

## HU-E3-05 — Category icon and color

- **Milestone:** M3-D · **Priority:** Must · **Size:** S · **Depends on:** HU-E3-01, HU-E3-02, HU-E3-04 · **Module(s):** `categories`

**User story:** As a space admin, I want each category group and category to have an icon (from a fixed icon set, or one emoji) and a color from a fixed palette, so that members recognize categories at a glance when they record and read transactions.

```gherkin
Feature: Category icon and color

  Scenario: Seeded and new categories start with a default icon and color
    Given "Ana" has locale "en"
    When "Ana" creates the shared space "Household"
    Then the group "Food" has the color "SAND"
    And "Groceries" has the symbol icon "cart" and the color "SAND"
    And every seeded category has the color of its group
    When "Ana" creates the category "Bakery" in "Food" without an icon or a color
    Then "Bakery" has the icon and the color of "Food", copied at creation

  Scenario: Change the icon and color of a category
    Given "Groceries" in "Household" has the symbol icon "cart" and the color "SAND"
    When "Ana" sets the symbol icon "bread" and the color "ROSE" on "Groceries"
    Then "Groceries" is returned with the symbol icon "bread" and the color "ROSE"
    And the group "Food" keeps its own icon and color
    When "Sofi", who is VIEWER of "Household", sets the color "PINE" on "Groceries"
    Then the result is the error "InsufficientRole"

  Scenario: Choose an emoji as the icon
    Given "Groceries" has the symbol icon "cart" and the color "SAND"
    When "Ana" sets the emoji icon "🛒" on "Groceries"
    Then "Groceries" is returned with the emoji icon "🛒" and the color "SAND"
    And setting the symbol icon "cart" again replaces the emoji

  Scenario: Invalid icons, emojis and colors are rejected
    Given "Groceries" has the symbol icon "cart" and the color "SAND"
    When "Ana" sets the symbol icon "unicorn" on "Groceries"
    Then the result is the error "InvalidCategoryIcon"
    When "Ana" sets the emoji icon "🛒🍞" on "Groceries"
    Then the result is the error "InvalidCategoryIcon"
    When "Ana" sets the emoji icon "a" on "Groceries"
    Then the result is the error "InvalidCategoryIcon"
    When "Ana" sets the color "#C0FFEE" on "Groceries"
    Then the result is the error "ValidationFailed"
    And "Groceries" keeps the symbol icon "cart" and the color "SAND"

  Scenario: Subcategories show their parent's icon and color
    Given "Groceries" in "Household" has the subcategories "Vegetables" and "Meat"
    When "Ana" sets the emoji icon "🛒" and the color "PLUM" on "Groceries"
    Then the categories list returns "Vegetables" and "Meat" with the emoji icon "🛒" and the color "PLUM"
    When "Ana" sets the color "ROSE" on the subcategory "Vegetables"
    Then the result is the error "ValidationFailed"
    And "Vegetables" still shows the color "PLUM"

  Scenario: A subcategory that becomes a category keeps a copy of its parent's style
    Given "Groceries" has the emoji icon "🛒" and the color "PLUM"
    And "Groceries" has the subcategory "Vegetables"
    When "Ana" makes "Vegetables" a category of the group "Food"
    Then "Vegetables" is a category of "Food" with the emoji icon "🛒" and the color "PLUM"
    When "Ana" sets the color "SAGE" on "Groceries"
    Then "Vegetables" keeps the color "PLUM"
```

**Technical notes:**
- Model: `CategoryGroup` and `Category` gain `icon` and `color`. `icon` is `{ kind: "SYMBOL", name }`, where `name` is one of the 58 names of the fixed set below, kept in the `categories` domain, or `{ kind: "EMOJI", value }`, where `value` is exactly one emoji grapheme. `color` is one of 16 palette keys: `PINE`, `SAGE`, `OLIVE`, `SAND`, `MUSTARD`, `AMBER`, `EMBER`, `CORAL`, `ROSE`, `PLUM`, `LAVENDER`, `INDIGO`, `SKY`, `TEAL`, `STEEL` and `GRAPHITE`. The UI maps each key to light and dark theme tokens; no hex value is ever stored.
- Symbol set: 58 names in nine sections, the order and labels of the icon library of the UI (HU-E9-04). The plan fixes the exact spelling; every name is lower case.
  - Food: cart, bread, cup, fork, apple, wine, pizza, basket
  - Home: home, bulb, droplet, flame, wifi, wrench, key, sofa
  - Transport: bus, car, fuel, bike, plane, train, parking
  - Health and care: heart, pill, cross, tooth, gym, scissors, leaf
  - Leisure: ticket, music, game, tv, book, gift, globe
  - Shopping: shirt, bag, tag, phone, laptop
  - Money: card, bank, piggy, coins, chart, receipt, percent
  - People and work: users, paw, graduation, briefcase
  - Other: star, umbrella, shield, calendar, dots
- A section is UI metadata only: the domain, the API and the database know the flat names, never the section, and regrouping the library changes no stored value. The emoji tab of the library is sectioned the same way and is equally UI-only: the API accepts any single emoji, listed or not.
- Seeds (HU-E3-01): every seeded group and category gets a default icon and color by its catalog `key`, and a seeded category takes its group's color; every default icon is a name of the set above. A category created without an `icon` or a `color` takes its group's icon and color, copied at creation.
- Subcategories (HU-E3-04) have no style of their own: they always show their parent's icon and color. The style is derived, not copied, so they follow when the parent changes. Sending `icon` or `color` for a subcategory (`POST` with `parentCategoryId`, or `PATCH` of a subcategory) answers `ValidationFailed`. When a subcategory becomes a category (`PATCH` `parentCategoryId: null` with a `groupId`), it keeps a copy of its former parent's current style.
- Errors: an unknown symbol name, or an emoji `value` that is not exactly one emoji, answers `InvalidCategoryIcon`; a color outside the palette answers `ValidationFailed`.
- Endpoints: `POST` and `PATCH` of groups and categories (HU-E3-02) accept optional `icon` and `color`. `GET /api/v1/spaces/{spaceId}/categories` returns them on every group, category and subcategory; a subcategory returns its parent's values.
- Allowed roles: the same as for the category tree (HU-E3-02): OWNER, ADMIN (personal space: its owner). A VIEWER or MEMBER gets `InsufficientRole`.
- Not in scope: uploaded images, arbitrary hex colors and per-member styles.
- **Spec impact:** 5.2 **CategoryGroup / Category** (gain `icon` and `color`), the seed tables (a default style per catalog key), section 6 (a new decision recording that colors are palette keys and never hex values).
