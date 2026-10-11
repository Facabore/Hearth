# E3 — Categories

**Goal:** every space has a ready-to-use, customizable two-level category tree that classifies transactions and feeds budget lines, without ever losing history.

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
```

**Technical notes:**
- Use case: `SeedDefaultCategories`, handling `SpaceCreated`.
- Seed definition lives in the `categories` domain as data with es/en names: Housing (Rent, Utilities, Maintenance), Food (Groceries, Restaurants), Transport (Fuel, Public transport), Health (Medical, Pharmacy), Leisure (Entertainment, Travel), Income (Salary, Other income).
- Names are stored as user data after seeding (not translated on read).

---

## HU-E3-02 — Manage category groups and categories

- **Milestone:** M1 · **Priority:** Must · **Size:** M · **Depends on:** HU-E3-01 · **Module(s):** `categories`

**User story:** As a space admin, I want to create, rename and move categories within a two-level tree, so that the classification fits how my household thinks about money.

```gherkin
Feature: Two-level category tree

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

  Scenario: Third level is not allowed
    When "Ana" creates a category under the category "Groceries"
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
- Invariants: exactly two levels; category and group in the same space; names unique per parent (case-insensitive).
- Allowed roles: OWNER, ADMIN (personal space: its owner).

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
    And "Ana" is offered to archive it instead

  Scenario: Archived category stays in history but not in pickers
    Given "Ana" archived "Groceries"
    Then its 12 transactions still show the category "Groceries"
    And "Groceries" is not offered when recording a new expense

  Scenario: Recording with an archived category is rejected
    Given "Groceries" is archived
    When "Ana" records an expense of 40,000 COP in "Groceries"
    Then the result is the error "CategoryArchived"

  Scenario: Restore an archived category
    Given "Groceries" is archived
    When "Ana" restores it
    Then "Groceries" is offered again when recording expenses
```

**Technical notes:**
- Use cases: `DeleteCategory`, `ArchiveCategory`, `RestoreCategory`.
- Reference check uses ports to `ledger` (transactions) and `budgeting` (line mappings); soft-deleted transactions still count as references (audit).
- Archiving a group archives all its categories.
