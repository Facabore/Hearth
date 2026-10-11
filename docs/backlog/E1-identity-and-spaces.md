# E1 — Identity and spaces

**Goal:** users can authenticate, always own a personal space, and create shared spaces where membership and roles govern every action.

**Modules involved:** `identity`, `spaces` (with read access to `balances` for leave/archive guards).

---

## HU-E1-01 — Sign up, sign in and sign out

- **Milestone:** M0 · **Priority:** Must · **Size:** M · **Depends on:** HU-E0-05, HU-E0-08 · **Module(s):** `identity`

**User story:** As a visitor, I want to sign up with email and password, sign in and sign out, so that my financial data is private to my account.

```gherkin
Feature: Email and password authentication

  Scenario: Successful sign up
    Given no user exists with the email "ana@example.com"
    When a visitor signs up with name "Ana", email "ana@example.com" and a 12-character password
    Then a user "Ana" is created with locale "es" and timezone "America/Bogota"
    And the visitor is signed in

  Scenario: Duplicate email is rejected
    Given a user exists with the email "ana@example.com"
    When a visitor signs up with the email "ANA@example.com"
    Then sign up fails with the message key "auth.emailTaken"
    And no second user is created

  Scenario: Password shorter than 8 characters is rejected
    When a visitor signs up with a 7-character password
    Then sign up fails with the message key "auth.passwordTooShort"

  Scenario: Wrong password returns a generic error
    Given a user exists with the email "ana@example.com"
    When a visitor signs in with that email and a wrong password
    Then sign in fails with the message key "auth.invalidCredentials"
    And the response does not reveal whether the email exists

  Scenario: Sign out invalidates the session
    Given "Ana" is signed in
    When "Ana" signs out
    Then her session is revoked
    And requesting the dashboard redirects to the sign-in page
```

**Technical notes:**
- Use cases: `SignUp`, `SignIn`, `SignOut` delegating to Better Auth behind an `AuthProvider` port.
- Emails normalized to lowercase before uniqueness checks.
- Session cookie `HttpOnly`, `Secure`, `SameSite=Lax`.

---

## HU-E1-02 — Personal space created on sign up

- **Milestone:** M0 · **Priority:** Must · **Size:** S · **Depends on:** HU-E1-01 · **Module(s):** `spaces`, `identity`

**User story:** As a new user, I want a personal space created automatically when I sign up, so that I can start recording my own expenses immediately.

```gherkin
Feature: Personal space on sign up

  Scenario: Personal space is created atomically with the user
    When "Ana" signs up
    Then exactly one space of kind "PERSONAL" exists for "Ana"
    And its currency is "COP" and its period policy is MONTHLY(1)
    And "Ana" holds the role "OWNER" in it

  Scenario: Failure to create the space rolls back the user
    Given creating the personal space fails with a database error
    When "Ana" signs up
    Then no user "Ana" is persisted
    And the visitor sees a generic error with a request id

  Scenario: A second personal space cannot be created
    Given "Ana" already has a personal space
    When "Ana" attempts to create another space of kind "PERSONAL"
    Then the result is the error "PersonalSpaceAlreadyExists"

  Scenario: Personal spaces cannot receive members
    When "Ana" attempts to invite "juan@example.com" to her personal space
    Then the result is the error "PersonalSpaceNotShareable"
```

**Technical notes:**
- Use case: `CreatePersonalSpace`, triggered inside the same transaction as `SignUp` (or via a `UserSignedUp` domain event handled synchronously).
- Invariant: exactly one PERSONAL space per user; one member; role OWNER.
- New spaces get the default period policy `MONTHLY(1)` (spec D14); the owner can change it later (HU-E1-03).
- Triggers default category seeding (HU-E3-01).

---

## HU-E1-03 — Configure space settings and period policy

- **Milestone:** M1 · **Priority:** Must · **Size:** S · **Depends on:** HU-E1-02, HU-E0-04 · **Module(s):** `spaces`

**User story:** As a space owner, I want to rename my space and choose its period policy (a monthly cut-off day or two semi-monthly anchor days), so that period figures align with how my household is paid.

```gherkin
Feature: Space settings

  Scenario: Owner switches to a monthly cut-off on the 25th
    Given "Ana" is OWNER of the space "Household" with the period policy MONTHLY(1) and no plans
    When "Ana" sets the period policy to MONTHLY(25)
    Then the space period policy is MONTHLY(25)
    And an expense dated 2026-10-24 belongs to the period "2026-10" from 2026-09-25 to 2026-10-24

  Scenario: Owner switches to semi-monthly periods on the 5th and 20th
    Given "Ana" is OWNER of the space "Household" with the period policy MONTHLY(1) and no plans
    When "Ana" sets the period policy to SEMI_MONTHLY(5, 20)
    Then an expense dated 2026-11-03 belongs to the period "2026-10 H2" from 2026-10-20 to 2026-11-04
    And an expense dated 2026-11-25 belongs to the period "2026-11 H2" from 2026-11-20 to 2026-12-04

  Scenario Outline: Invalid period policy is rejected
    When "Ana" sets the period policy to <policy>
    Then the result is the error "InvalidPeriodPolicy"

    Examples:
      | policy              |
      | MONTHLY(0)          |
      | MONTHLY(32)         |
      | SEMI_MONTHLY(20, 5) |

  Scenario: Changing the policy does not move a period that already has a plan
    Given "Household" has the period policy MONTHLY(1) and a plan "2026-11" from 2026-11-01 to 2026-11-30
    When "Ana" sets the period policy to MONTHLY(25)
    Then the plan "2026-11" still runs from 2026-11-01 to 2026-11-30
    And the next period "2026-12" runs from 2026-12-01 to 2026-12-24
    And the period after it "2027-01" runs from 2026-12-25 to 2027-01-24

  Scenario: Member without admin rights cannot change settings
    Given "Juan" is MEMBER of "Household"
    When "Juan" renames the space to "Casa"
    Then the result is the error "InsufficientRole"

  Scenario: Currency is immutable once transactions exist
    Given "Household" has at least one transaction
    When "Ana" changes the currency from "COP" to "USD"
    Then the result is the error "SpaceCurrencyLocked"
```

**Technical notes:**
- Use case: `UpdateSpaceSettings` (OWNER or ADMIN).
- Changing the `periodPolicy` only affects periods without a plan; plan boundaries are stored, so history never moves (spec D10, D14).
- Overlap rule: if a period derived with the new policy overlaps an existing plan, it starts the day after that plan ends and keeps its natural end (the day before the next anchor date) and label; later periods follow the new policy unchanged.
- One currency per space (D6).

---

## HU-E1-04 — Create a shared space

- **Milestone:** M2 · **Priority:** Must · **Size:** S · **Depends on:** HU-E1-02 · **Module(s):** `spaces`

**User story:** As a user, I want to create a shared space for my household, so that we can record and split common expenses.

```gherkin
Feature: Create a shared space

  Scenario: User creates a household space
    Given "Ana" is signed in
    When "Ana" creates a shared space named "Household" with currency "COP"
    Then a space of kind "SHARED" named "Household" exists
    And "Ana" holds the role "OWNER" in it
    And default categories are seeded for "Household"

  Scenario: Name is required
    When "Ana" creates a shared space with an empty name
    Then the result is the error "InvalidSpaceName"

  Scenario: Unsupported currency is rejected
    When "Ana" creates a shared space with currency "XYZ"
    Then the result is the error "UnsupportedCurrency"
```

**Technical notes:**
- Use case: `CreateSharedSpace`.
- Invariant: a shared space always has at least one OWNER.
- Currency validated against ISO 4217 list in the kernel.

---

## HU-E1-05 — Enforce roles and permissions

- **Milestone:** M2 · **Priority:** Must · **Size:** M · **Depends on:** HU-E1-04 · **Module(s):** `spaces`, all application layers

**User story:** As a space owner, I want each member's role to limit what they can do, so that shared money is protected from unintended changes.

```gherkin
Feature: Role-based authorization in use cases

  Background:
    Given the shared space "Household" with OWNER "Ana", ADMIN "Juan", MEMBER "Luis" and VIEWER "Sofi"

  Scenario Outline: Permissions per role
    When "<user>" attempts to "<action>"
    Then the outcome is "<outcome>"

    Examples:
      | user | action                         | outcome          |
      | Ana  | archive the space              | allowed          |
      | Juan | archive the space              | InsufficientRole |
      | Juan | invite a member                | allowed          |
      | Luis | invite a member                | InsufficientRole |
      | Luis | record an expense              | allowed          |
      | Sofi | record an expense              | InsufficientRole |
      | Luis | edit an expense created by Ana | InsufficientRole |
      | Juan | edit an expense created by Ana | allowed          |
      | Sofi | view balances                  | allowed          |

  Scenario: Non-members are rejected
    Given "Pedro" is not a member of "Household"
    When "Pedro" requests the transactions of "Household"
    Then the result is the error "NotASpaceMember"

  Scenario: Owner changes a member's role
    When "Ana" changes the role of "Luis" to "ADMIN"
    Then "Luis" holds the role "ADMIN"

  Scenario: The last owner cannot be demoted
    Given "Ana" is the only OWNER
    When "Ana" changes her own role to "ADMIN"
    Then the result is the error "LastOwnerRequired"
```

**Technical notes:**
- Use cases: `ChangeMemberRole`; shared `AuthorizeSpaceAction` application service used by every use case.
- Permission matrix lives in the `spaces` domain as a pure policy; it is pending owner confirmation (see docs/product/functional-overview.md).
- Authorization is checked in use cases, never only in UI (spec section 8).

---

## HU-E1-06 — Invite a member by link or email

- **Milestone:** M2 · **Priority:** Must · **Size:** M · **Depends on:** HU-E1-05 · **Module(s):** `spaces`

**User story:** As a space admin, I want to invite people by shareable link or by email, so that my household can join the shared space.

```gherkin
Feature: Invitations

  Background:
    Given "Ana" is OWNER of the shared space "Household"

  Scenario: Create an email invitation
    When "Ana" invites "juan@example.com" with role "MEMBER"
    Then a pending invitation bound to "juan@example.com" exists
    And it expires 7 days after creation
    And an invitation email is sent to "juan@example.com"

  Scenario: Create a shareable link invitation
    When "Ana" creates a link invitation with role "MEMBER"
    Then a pending invitation with a unique unguessable token exists
    And the invitation URL contains only the token

  Scenario: Invitations cannot grant the OWNER role
    When "Ana" invites "juan@example.com" with role "OWNER"
    Then the result is the error "InvalidInvitationRole"

  Scenario: Inviting an existing member is rejected
    Given "juan@example.com" belongs to a member of "Household"
    When "Ana" invites "juan@example.com"
    Then the result is the error "AlreadyMember"

  Scenario: Revoke a pending invitation
    Given a pending invitation for "juan@example.com"
    When "Ana" revokes it
    Then the invitation status is "REVOKED"
```

**Technical notes:**
- Use cases: `CreateInvitation`, `RevokeInvitation`; requires OWNER or ADMIN.
- Ports: `InvitationRepository`, `EmailSender` (SMTP adapter; when SMTP is not configured, the email path is disabled and only links are offered).
- Token: at least 128 bits of randomness, stored hashed.

---

## HU-E1-07 — Accept an invitation

- **Milestone:** M2 · **Priority:** Must · **Size:** M · **Depends on:** HU-E1-06 · **Module(s):** `spaces`, `identity`

**User story:** As an invited person, I want to accept an invitation, so that I become a member of the shared space.

```gherkin
Feature: Accept invitation

  Background:
    Given "Ana" invited "juan@example.com" to "Household" with role "MEMBER"

  Scenario: Signed-in invitee accepts
    Given "Juan" is signed in as "juan@example.com"
    When "Juan" accepts the invitation
    Then "Juan" is a member of "Household" with role "MEMBER" and joinedAt set
    And the invitation status is "ACCEPTED"

  Scenario: Visitor without an account signs up first
    Given a visitor opens the invitation URL without an account
    When the visitor signs up as "juan@example.com"
    Then the visitor is returned to the invitation and can accept it

  Scenario: Expired invitation is rejected
    Given the invitation was created 8 days ago
    When "Juan" accepts the invitation
    Then the result is the error "InvitationExpired"

  Scenario: Email-bound invitation accepted by another account
    Given "Luis" is signed in as "luis@example.com"
    When "Luis" accepts the invitation for "juan@example.com"
    Then the result is the error "InvitationEmailMismatch"

  Scenario: Revoked invitation is rejected
    Given the invitation was revoked
    When "Juan" accepts the invitation
    Then the result is the error "InvitationRevoked"
```

**Technical notes:**
- Use case: `AcceptInvitation`; uses `Clock` for expiry.
- Email invitations are single-use; link invitations remain valid until expiry or revocation.
- A former member (leftAt set) who accepts again gets a new membership row.

---

## HU-E1-08 — Leave a space

- **Milestone:** M2 · **Priority:** Must · **Size:** S · **Depends on:** HU-E1-07, HU-E5-01 · **Module(s):** `spaces`, `balances`

**User story:** As a member, I want to leave a shared space when I no longer participate, so that it stops appearing in my views without corrupting shared history.

```gherkin
Feature: Leave a space

  Scenario: Member with a zero balance leaves
    Given "Luis" is MEMBER of "Household" with a net balance of 0 COP
    When "Luis" leaves "Household"
    Then his membership has leftAt set
    And past expenses still show "Luis" as payer or participant

  Scenario: Member with a non-zero balance cannot leave
    Given "Juan" owes "Ana" 150,000 COP in "Household"
    When "Juan" leaves "Household"
    Then the result is the error "OutstandingBalance"
    And the error states the amount 150,000 COP

  Scenario: The last owner cannot leave
    Given "Ana" is the only OWNER of "Household"
    When "Ana" leaves "Household"
    Then the result is the error "LastOwnerRequired"

  Scenario: A personal space cannot be left
    When "Ana" leaves her personal space
    Then the result is the error "PersonalSpaceNotShareable"
```

**Technical notes:**
- Use case: `LeaveSpace`; reads net balance through the `balances` public query `GetMemberNetBalance`.
- Former members cannot be selected as payer or participant on new transactions.

---

## HU-E1-09 — Archive a space

- **Milestone:** M2 · **Priority:** Should · **Size:** S · **Depends on:** HU-E1-05, HU-E5-01 · **Module(s):** `spaces`

**User story:** As a space owner, I want to archive a shared space that is no longer used, so that it becomes read-only while keeping its history.

```gherkin
Feature: Archive a space

  Scenario: Owner archives a settled space
    Given every member of "Trip 2026" has a net balance of 0 COP
    When the OWNER archives "Trip 2026"
    Then the space has archivedAt set
    And it is listed under archived spaces

  Scenario: Archived space rejects new transactions
    Given "Trip 2026" is archived
    When a member records an expense of 50,000 COP in it
    Then the result is the error "SpaceArchived"

  Scenario: Space with outstanding balances cannot be archived
    Given "Juan" owes "Ana" 150,000 COP in "Household"
    When "Ana" archives "Household"
    Then the result is the error "OutstandingBalance"

  Scenario: A personal space cannot be archived
    When "Ana" archives her personal space
    Then the result is the error "PersonalSpaceNotArchivable"
```

**Technical notes:**
- Use case: `ArchiveSpace` (OWNER only).
- Every write use case checks `space.archivedAt` via a shared guard.
