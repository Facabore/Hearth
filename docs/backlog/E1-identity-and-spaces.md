# E1 — Identity and spaces

**Goal:** users can authenticate, always own a personal space, and create shared and direct spaces whose members — registered users or guests — take part in every money flow, while roles govern every action.

**Modules involved:** `identity`, `spaces` (with read access to `balances` for leave, archive and guest-removal guards; delegates to `ledger` for one-to-one splits).

**Members (spec 5.2, D15):** every space has `SpaceMember` rows of kind `USER` (linked to a user, with a role) or `GUEST` (no user, no role, cannot sign in, no accounts, no personal space). Guests are current members of their space and exist only there.

---

## HU-E1-01 — Sign up, sign in and sign out

- **Milestone:** M0 · **Priority:** Must · **Size:** M · **Depends on:** HU-E0-05, HU-E0-09 · **Module(s):** `identity`

**User story:** As a visitor, I want to sign up with email and password, sign in and sign out, so that my financial data is private to my account.

```gherkin
Feature: Email and password authentication

  Scenario: Successful sign up
    Given no user exists with the email "ana@example.com"
    When a visitor signs up with name "Ana", email "ana@example.com" and a 12-character password
    Then a user "Ana" is created with locale "es" and timezone "America/Bogota"
    And the response sets a session cookie with which "GET /api/v1/me" returns "Ana"

  Scenario: Duplicate email is rejected
    Given a user exists with the email "ana@example.com"
    When a visitor signs up with the email "ANA@example.com"
    Then sign up fails with status 409 and the code "EmailTaken"
    And no second user is created

  Scenario: Password shorter than 8 characters is rejected
    When a visitor signs up with a 7-character password
    Then sign up fails with status 422 and the code "PasswordTooShort"

  Scenario: Wrong password returns a generic error
    Given a user exists with the email "ana@example.com"
    When a visitor signs in with that email and a wrong password
    Then sign in fails with status 401 and the code "InvalidCredentials"
    And the response does not reveal whether the email exists

  Scenario: Sign out invalidates the session
    Given "Ana" is signed in
    When "Ana" signs out
    Then her session is revoked
    And "GET /api/v1/me" with the revoked session returns status 401 with the code "Unauthenticated"
```

**Technical notes:**
- Use cases: `SignUp`, `SignIn`, `SignOut` delegating to Better Auth behind an `AuthProvider` port; Better Auth also supplies the `SessionResolver` adapter for the HU-E0-09 guard (cookie and Bearer).
- Endpoints: `POST /api/v1/auth/sign-up`, `POST /api/v1/auth/sign-in`, `POST /api/v1/auth/sign-out`, `GET /api/v1/me`. Errors are stable codes; the web screens that translate them are HU-E9-01.
- Emails normalized to lowercase before uniqueness checks.
- Session cookie `HttpOnly`, `Secure`, `SameSite=Lax`.
- Ruling P142: the sign-up body takes an optional `locale` (`es` or `en`, the values `PATCH /api/v1/me` accepts), stored before provisioning, so a visitor who switched the sign-up screen to English stays in English; a missing or unsupported value keeps `es` and never refuses the sign-up.
- Ruling P143: `HEARTH_SIGN_UP` (`open`, the default, or `closed`) closes sign-up on a public installation. While `closed`, `POST /api/v1/auth/sign-up` answers `403` `SignUpClosed` unless the body carries an `invitationToken` that names a usable invitation: an EMAIL invitation for that address, a LINK invitation or a CLAIM link. Every other token (missing, unknown, revoked, used, expired or for another address) gets the same `SignUpClosed`, before the user is created, and the sign-up does not accept the invitation (HU-E1-07 still applies). The public `GET /api/v1/auth/sign-up` answers `{ "signUp": "open" | "closed" }` for the sign-up and sign-in screens.
- Ruling P150 (owner, 2026-10-20): a session lasts 15 days from its last use (Better Auth `session.expiresIn`, renewed once a day while used through `updateAge`), for the cookie and for Bearer tokens alike; it was Better Auth's default of 7 days.

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
    And the response is a status 500 problem+json with the code "InternalError" and a requestId

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
- Endpoints: no endpoint creates a PERSONAL space directly (it comes with `POST /api/v1/auth/sign-up`); `POST /api/v1/spaces` with kind `PERSONAL` returns `PersonalSpaceAlreadyExists`; `GET /api/v1/spaces` lists the user's spaces.
- Invariant: exactly one PERSONAL space per user; one member; role OWNER. Creation triggers default category seeding (HU-E3-01).
- New spaces get the default period policy `MONTHLY(1)` (spec D14); the owner can change it later (HU-E1-03).
- Guests cannot be added to a personal space either (HU-E1-10); one-to-one splits use a DIRECT space (HU-E1-13).

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
- Use case: `UpdateSpaceSettings` (OWNER or ADMIN). Endpoints: `PATCH /api/v1/spaces/{spaceId}` (name, currency, periodPolicy); `GET /api/v1/spaces/{spaceId}/periods?from=<date>&count=<n>` lists derived periods with label, startDate and endDate.
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
- Use case: `CreateSharedSpace`. Endpoint: `POST /api/v1/spaces` with kind `SHARED`.
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
    And the guest "Pedro" is a member of "Household"

  Scenario Outline: Permissions per role
    When "<user>" attempts to "<action>"
    Then the outcome is "<outcome>"

    Examples:
      | user | action                          | outcome          |
      | Ana  | archive the space               | allowed          |
      | Juan | archive the space               | InsufficientRole |
      | Juan | invite a member                 | allowed          |
      | Luis | invite a member                 | InsufficientRole |
      | Luis | record an expense               | allowed          |
      | Sofi | record an expense               | InsufficientRole |
      | Luis | edit an expense created by Ana  | InsufficientRole |
      | Juan | edit an expense created by Ana  | allowed          |
      | Sofi | view balances                   | allowed          |
      | Luis | add a guest                     | allowed          |
      | Sofi | add a guest                     | InsufficientRole |
      | Luis | record an expense paid by Pedro | allowed          |
      | Sofi | record a settlement for Pedro   | InsufficientRole |

  Scenario: Non-members are rejected
    Given "Marta" is neither a registered member nor a guest of "Household"
    When "Marta" requests the transactions of "Household"
    Then the response is 404 with the code "SpaceNotFound", so the space existence is not leaked

  Scenario: Owner changes a member's role
    When "Ana" changes the role of "Luis" to "ADMIN"
    Then "Luis" holds the role "ADMIN"

  Scenario: The last owner cannot be demoted
    Given "Ana" is the only OWNER
    When "Ana" changes her own role to "ADMIN"
    Then the result is the error "LastOwnerRequired"
```

**Technical notes:**
- Use cases: `ChangeMemberRole`; shared `AuthorizeSpaceAction` application service used by every use case. Endpoints: `GET /api/v1/spaces/{spaceId}/members`, `PATCH /api/v1/spaces/{spaceId}/members/{memberId}` (role).
- Permission matrix lives in the `spaces` domain as a pure policy; it is pending owner confirmation (see docs/product/functional-overview.md).
- Budget plans (M3-A, ruling P2): `plan.manage` (OWNER, ADMIN) covers plans, capacities, lines, category mappings and allocations; `capacity.setOwn` (OWNER, ADMIN, MEMBER) lets a member set only their own capacity (D17).
- Authorization is checked in use cases, never only in UI (spec section 8).
- Guests have no role and cannot sign in, so they never act themselves; any member with role MEMBER or above can add a guest, record expenses and settlements on a guest's behalf, and remove a guest whose balance is zero (spec D15). `createdBy` is always the acting registered user.

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
- Use cases: `CreateInvitation`, `RevokeInvitation`, `ListInvitations`; requires OWNER or ADMIN. Endpoints: `POST /api/v1/spaces/{spaceId}/invitations` (email or link; the response carries the invitation URL), `POST /api/v1/spaces/{spaceId}/invitations/{invitationId}/revoke`, and (HU-E9-05, ruling P155) `GET /api/v1/spaces/{spaceId}/invitations`, which lists the pending email and link invitations that have not expired, newest first, without their URLs (only the token's hash is stored); claim links are not listed.
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
    Given a visitor without an account holds the invitation token
    When the visitor signs up as "juan@example.com" and then accepts the invitation with that token
    Then "Juan" is a member of "Household" with role "MEMBER"
    And the invitation status is "ACCEPTED"

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
- Use case: `AcceptInvitation`; uses `Clock` for expiry. Endpoint: `POST /api/v1/invitations/{token}/accept` (authenticated); the redirect back to the invitation after sign-up is web UI behaviour (HU-E9-05).
- Email invitations are single-use; link invitations remain valid until expiry or revocation.
- A former member (leftAt set) who accepts again gets a new `SpaceMember` row.

---

## HU-E1-08 — Leave a space

- **Milestone:** M2 · **Priority:** Must · **Size:** S · **Depends on:** HU-E1-07, HU-E5-01 · **Module(s):** `spaces`, `balances`

**User story:** As a member, I want to leave a shared space when I no longer participate, so that it stops appearing in my views without corrupting shared history.

```gherkin
Feature: Leave a space

  Scenario: Member with a zero balance leaves
    Given "Luis" is MEMBER of "Household" with a net balance of 0 COP
    When "Luis" leaves "Household"
    Then his SpaceMember row has leftAt set
    And past expenses are still returned with "Luis" as payer or participant

  Scenario: Member with a non-zero balance cannot leave
    Given "Juan" owes "Ana" 150,000 COP in "Household"
    When "Juan" leaves "Household"
    Then the result is the error "OutstandingBalance"
    And the error body includes the outstanding amount 150,000 COP

  Scenario: Money owed by a guest also blocks leaving
    Given the guest "Pedro" owes "Luis" 50,000 COP in "Household"
    When "Luis" leaves "Household"
    Then the result is the error "OutstandingBalance"
    And the error body includes the outstanding amount 50,000 COP

  Scenario: The last owner cannot leave
    Given "Ana" is the only OWNER of "Household"
    When "Ana" leaves "Household"
    Then the result is the error "LastOwnerRequired"

  Scenario: A personal space cannot be left
    When "Ana" leaves her personal space
    Then the result is the error "PersonalSpaceNotShareable"
```

**Technical notes:**
- Use case: `LeaveSpace`; reads net balance through the `balances` public query `GetMemberNetBalance`. Endpoint: `POST /api/v1/spaces/{spaceId}/leave`.
- Former members cannot be selected as payer or participant on new transactions.
- A direct space (D16) keeps its two members: leaving it, removing its guest or changing a role in it answers `DirectSpaceMembersFixed` (409); a direct space is retired by archiving it (HU-E1-09).
- The net balance includes debts with guests, who count like any other member; guests never leave themselves but are removed by a member (HU-E1-12).

---

## HU-E1-09 — Archive a space

- **Milestone:** M2 · **Priority:** Should · **Size:** S · **Depends on:** HU-E1-05, HU-E5-01 · **Module(s):** `spaces`

**User story:** As a space owner, I want to archive a shared space that is no longer used, so that it becomes read-only while keeping its history.

```gherkin
Feature: Archive a space

  Scenario: Owner archives a settled space
    Given every member of "Trip 2026", including the guest "Pedro", has a net balance of 0 COP
    When the OWNER archives "Trip 2026"
    Then the space has archivedAt set
    And it is returned when spaces are listed with the archived filter

  Scenario: Archived space rejects new transactions
    Given "Trip 2026" is archived
    When a member records an expense of 50,000 COP in it
    Then the result is the error "SpaceArchived"

  Scenario: Space with outstanding balances cannot be archived
    Given "Juan" owes "Ana" 150,000 COP in "Household"
    When "Ana" archives "Household"
    Then the result is the error "OutstandingBalance"

  Scenario: A guest's outstanding balance also blocks archiving
    Given the guest "Pedro" owes "Ana" 100,000 COP in "Trip 2026" and every other balance is settled
    When the OWNER archives "Trip 2026"
    Then the result is the error "OutstandingBalance"

  Scenario: A personal space cannot be archived
    When "Ana" archives her personal space
    Then the result is the error "PersonalSpaceNotArchivable"
```

**Technical notes:**
- Use case: `ArchiveSpace` (OWNER only). Endpoints: `POST /api/v1/spaces/{spaceId}/archive`; `GET /api/v1/spaces?archived=true`.
- Every write use case checks `space.archivedAt` via a shared guard.
- The zero-balance check covers every current member, registered or guest; it applies to SHARED and DIRECT spaces alike.

---

## HU-E1-10 — Add a guest member to a space

- **Milestone:** M2 · **Priority:** Must · **Size:** S · **Depends on:** HU-E1-05 · **Module(s):** `spaces`

**User story:** As a space member, I want to add someone who has no account as a guest, so that they can pay, owe and be budgeted in our space without signing up.

```gherkin
Feature: Guest members

  Background:
    Given the shared space "Household" with OWNER "Ana", MEMBER "Luis" and VIEWER "Sofi"

  Scenario: Member adds a guest with a name
    When "Luis" adds the guest "Pedro" with contact email "pedro@example.com" to "Household"
    Then "Household" has a member "Pedro" of kind "GUEST" with no user and no role
    And the member "Pedro" has joinedAt set

  Scenario: Guest is listed as a current member eligible as payer and participant
    Given the guest "Pedro" is a member of "Household"
    When "Ana" lists the current members of "Household"
    Then the response contains "Ana", "Luis" and "Pedro", with "Pedro" of kind "GUEST"
    And "Pedro" is accepted as payer and as participant of a new expense in "Household"

  Scenario: Viewer cannot add guests
    When "Sofi" adds the guest "Pedro" to "Household"
    Then the result is the error "InsufficientRole"

  Scenario: Display name must be unique among current members of the space
    Given the guest "Pedro" is a member of "Household"
    When "Luis" adds the guest "pedro" to "Household"
    Then the result is the error "MemberNameTaken"

  Scenario: A guest cannot sign in and has no personal space
    Given "Luis" added the guest "Pedro" with contact email "pedro@example.com"
    When a visitor signs in with the email "pedro@example.com" and any password
    Then sign in fails with status 401 and the code "InvalidCredentials"
    And no user and no personal space exist for "Pedro"

  Scenario: Guests cannot be added to a personal space
    When "Ana" adds the guest "Pedro" to her personal space
    Then the result is the error "PersonalSpaceNotShareable"
```

**Technical notes:**
- Use case: `AddGuestMember` (role MEMBER or above, spec D15). Endpoint: `POST /api/v1/spaces/{spaceId}/guests`; guests appear in `GET /api/v1/spaces/{spaceId}/members` with kind `GUEST`.
- `SpaceMember` invariants: kind `GUEST` ⇔ `userId` null ⇔ `role` null; `contactEmail` is optional and only allowed for guests; `displayName` is unique per space among current members of both kinds, compared case-insensitively.
- A guest is scoped to one space: the same name in another space is an unrelated `SpaceMember`.
- Guests have no accounts, so their payments carry `accountId` null (HU-E4-07); rounding ties use join order, guests included (spec 5.3).

---

## HU-E1-11 — Claim a guest place by registering

- **Milestone:** M2 · **Priority:** Must · **Size:** M · **Depends on:** HU-E1-07, HU-E1-10, HU-E5-01 · **Module(s):** `spaces`, `identity`

**User story:** As a person added as a guest, I want to claim my place in the space by signing up or signing in, so that I see my history and balances without anyone re-entering them.

```gherkin
Feature: Claim a guest place

  Background:
    Given the shared space "Household" with OWNER "Ana", MEMBER "Juan" and the guest "Pedro"
    And "Ana" recorded on 2026-10-08 a "Hotel" expense of 300,000 COP paid by "Pedro" split "EQUAL" among "Ana", "Juan" and "Pedro"
    And "Ana" created a claim link for "Pedro"

  @critical
  Scenario: New user registers through the claim link and keeps the history
    Given a visitor without an account holds the claim token
    When the visitor signs up as "pedro@example.com" and accepts the claim with that token
    Then the member "Pedro" keeps the same id, has kind "USER", role "MEMBER" and claimedAt set
    And the "Hotel" expense is still returned with "Pedro" as payer of 300,000 COP
    And "Ana" owes "Pedro" 100,000 COP and "Juan" owes "Pedro" 100,000 COP
    And the unified view of "Pedro" for 2026-10 includes his 100,000 COP "Hotel" share

  Scenario: An existing account claims the place
    Given "Pedro" is signed in as "pedro@example.com" and is not a member of "Household"
    When "Pedro" accepts the claim link
    Then the member "Pedro" of "Household" is linked to his user with role "MEMBER"
    And "Pedro" still has exactly one personal space

  Scenario: A user who is already a member cannot claim a guest
    Given "Juan" is signed in
    When "Juan" accepts the claim link for "Pedro"
    Then the result is the error "AlreadyMember"
    And "Pedro" remains a guest of "Household"

  Scenario Outline: Unusable claim links are rejected
    Given the claim link <state>
    When a signed-in user who is not a member of "Household" accepts it
    Then the result is the error "<error>"

    Examples:
      | state                  | error               |
      | was created 8 days ago | InvitationExpired   |
      | was already used       | GuestAlreadyClaimed |
      | was revoked            | InvitationRevoked   |

  Scenario: A claim affects only its own space
    Given the space "Trip 2026" also has a guest named "Pedro"
    When "Pedro" claims his place in "Household"
    Then the guest "Pedro" in "Trip 2026" still has no user
    And the unified view of "Pedro" includes no shares from "Trip 2026"
```

**Technical notes:**
- Use cases: `CreateGuestClaim` (OWNER or ADMIN, like HU-E1-06), `ClaimGuestPlace`; a claim is an `Invitation` bound to a `guestMemberId`, single use, valid 7 days, token hashed. Endpoints: `POST /api/v1/spaces/{spaceId}/guests/{memberId}/claim-links`, `POST /api/v1/claims/{token}/accept`.
- Claiming sets `userId`, `kind = USER`, `role = MEMBER` and `claimedAt` on the existing `SpaceMember`; no money row is rewritten, because every reference already points to that member id (spec D15).
- Sign-up through a claim link creates the personal space first (HU-E1-02), then applies the claim in the same flow. Claim links are bearer links, not bound to the guest's `contactEmail`.
- The unified-view assertions are pinned over HTTP by `tests/acceptance/unified-view.test.ts` since M4 (HU-E7-04).

---

## HU-E1-12 — Remove a guest

- **Milestone:** M2 · **Priority:** Must · **Size:** S · **Depends on:** HU-E1-10, HU-E5-01 · **Module(s):** `spaces`, `balances`

**User story:** As a space member, I want to remove a guest who no longer takes part, so that they stop appearing in new expenses without losing past records.

```gherkin
Feature: Remove a guest

  Background:
    Given the shared space "Household" with OWNER "Ana", MEMBER "Luis", VIEWER "Sofi" and the guest "Pedro"

  Scenario: Guest with a zero balance is removed
    Given "Pedro" has a net balance of 0 COP in "Household"
    When "Luis" removes the guest "Pedro"
    Then the member "Pedro" has leftAt set
    And "Pedro" is no longer returned among the current members of "Household"

  Scenario: Guest with a non-zero balance cannot be removed
    Given "Pedro" owes "Ana" 100,000 COP in "Household"
    When "Ana" removes the guest "Pedro"
    Then the result is the error "OutstandingBalance"
    And the error states the amount 100,000 COP

  Scenario: History keeps the guest's name
    Given "Pedro" took part in a "Hotel" expense of 300,000 COP with a share of 100,000 COP and later settled it
    When "Ana" removes the guest "Pedro"
    Then the "Hotel" expense is still returned with "Pedro" of kind "GUEST" and a share of 100,000 COP

  Scenario: Viewer cannot remove a guest
    When "Sofi" removes the guest "Pedro"
    Then the result is the error "InsufficientRole"

  Scenario: Registered members are not removed as guests
    When "Ana" removes "Luis" as a guest
    Then the result is the error "NotAGuest"
```

**Technical notes:**
- Use case: `RemoveGuestMember` (role MEMBER or above, spec D15); reads the net balance through `GetMemberNetBalance` (HU-E5-01). Endpoint: `DELETE /api/v1/spaces/{spaceId}/guests/{memberId}` (soft removal).
- Removal is soft: `leftAt` is set and the row is kept, so payments, shares and settlements still resolve the guest's `displayName`.
- Pending claim links for the removed guest are revoked; the display name becomes free for a new member of the space.

---

## HU-E1-13 — Split with one person through a direct space

- **Milestone:** M2 · **Priority:** Must · **Size:** M · **Depends on:** HU-E1-10, HU-E3-01, HU-E4-07 · **Module(s):** `spaces`, `ledger`

**User story:** As a user, I want to split an expense with one specific person without setting up a group, so that one-to-one debts follow the same rules as any shared space.

```gherkin
Feature: Direct spaces

  Background:
    Given "Ana" is signed in with the account "Bancolombia"

  @critical
  Scenario: First split with a guest creates a direct space
    Given "Ana" has no direct space with "Pedro"
    When "Ana" records a "Dinner" expense of 120,000 COP paid from "Bancolombia" split "EQUAL" with the new guest "Pedro"
    Then a space of kind "DIRECT" named "Ana & Pedro" exists with exactly 2 members, "Ana" and the guest "Pedro"
    And the expense belongs to "Ana & Pedro" with shares of 60,000 COP for "Ana" and 60,000 COP for "Pedro"
    And "Pedro" owes "Ana" 60,000 COP

  Scenario: Later splits with the same person reuse the direct space
    Given the direct space "Ana & Pedro" where "Pedro" owes "Ana" 60,000 COP
    When "Ana" records a "Taxi" expense of 40,000 COP split "EQUAL" with "Pedro"
    Then no new space is created
    And "Pedro" owes "Ana" 80,000 COP in "Ana & Pedro"

  Scenario Outline: A direct space cannot get a third member
    Given the direct space "Ana & Pedro"
    When "Ana" <action> in "Ana & Pedro"
    Then the result is the error "DirectSpaceIsFull"

    Examples:
      | action                     |
      | adds the guest "Luis"      |
      | invites "juan@example.com" |

  Scenario: Direct space with a registered user
    Given "Ana" and "Juan" are both members of "Household" and have no direct space together
    When "Ana" records a "Lunch" expense of 90,000 COP paid from "Bancolombia" split "EQUAL" with "Juan"
    Then a space of kind "DIRECT" named "Ana & Juan" exists with the registered members "Ana" and "Juan"
    And "Juan" owes "Ana" 45,000 COP in "Ana & Juan"
    And a later split recorded by "Juan" with "Ana" reuses "Ana & Juan"

  Scenario: Direct spaces use the default period policy and need no budget plan
    Given the direct space "Ana & Pedro" was just created
    When "Ana" requests the space "Ana & Pedro"
    Then its period policy is MONTHLY(1) and it has no budget plan
    And an expense recorded in "Ana & Pedro" without a split method is split "EQUAL" between "Ana" and "Pedro"
```

**Technical notes:**
- Use case: `SplitWithPerson` resolves or creates the DIRECT space (`spaces`) and delegates to `RecordExpense` (`ledger`) in one database transaction; placed in E1 because space creation, reuse and the two-member invariant belong to `spaces`. Endpoint: `POST /api/v1/direct-splits` (honours `Idempotency-Key`, HU-E0-10).
- Invariant: a DIRECT space has exactly two current members; `AddGuestMember` and `CreateInvitation` reject a third with `DirectSpaceIsFull`. Both registered members hold the role OWNER; a guest has no role.
- Reuse key: one DIRECT space per unordered pair of registered users (unique index); with a guest counterpart, the person is identified by the existing direct space's guest, so choosing that guest reuses it. A registered counterpart is picked among people the user already shares a space with, so no user lookup by email is exposed.
- Currency comes from the creator's personal space; default categories are seeded (HU-E3-01).
- A counterpart that is the requester, or a guest of a shared space (guests exist only in their space, D15), answers `InvalidDirectCounterpart` (422); someone the requester shares no space with, or an unknown member, answers `MemberNotFound` (404). A guest who claims a direct-space place becomes OWNER, and the claimed space becomes the pair's direct space when the pair has no other active one (D16).

---

## HU-E1-14 — Set my time zone

- **Milestone:** M3-D · **Priority:** Must · **Size:** S · **Depends on:** HU-E1-01 · **Module(s):** `identity`

**User story:** As a user, I want my own time zone stored on my profile, so that "today" and the time of what I record follow where I live, not where the server runs.

```gherkin
Feature: User time zone

  Scenario: Sign up takes the browser's time zone
    When a visitor signs up as "Juan" with the timezone "Europe/Madrid"
    Then the user "Juan" has the timezone "Europe/Madrid"
    And "GET /api/v1/me" returns "timezone": "Europe/Madrid"

  Scenario: Without a usable browser time zone the deployment default applies
    Given APP_TIMEZONE is "America/Bogota"
    When a visitor signs up as "Ana" without a timezone
    And another visitor signs up as "Luis" with the timezone "Mars/Olympus"
    Then both users have the timezone "America/Bogota"

  Scenario: Change my time zone
    Given "Ana" has the timezone "America/Bogota"
    When "Ana" sets her timezone to "America/New_York"
    Then "GET /api/v1/me" returns "timezone": "America/New_York"

  Scenario: An unknown time zone is rejected when set explicitly
    When "Ana" sets her timezone to "Bogota"
    Then the result is the error "InvalidTimeZone"
    And her timezone is still "America/Bogota"

  Scenario: Changing the time zone never moves recorded transactions
    Given "Ana" recorded an expense at 2026-10-16T21:30:00-05:00 dated 2026-10-16 with the time zone "America/Bogota"
    When "Ana" sets her timezone to "Europe/Madrid"
    Then the expense is still dated 2026-10-16 with the time zone "America/Bogota"
```

**Technical notes:**
- Use case: `UpdateProfile` (identity). Endpoints: `PATCH /api/v1/me` with `timezone` (the profile endpoint that HU-E8-08 also uses for notification preferences); `GET /api/v1/me` already returns `timezone`; `POST /api/v1/auth/sign-up` accepts an optional `timezone`.
- The `timezone` column exists (`src/modules/identity/infrastructure/auth.schema.ts`), but Better Auth declares it `input: false` with the literal default `"America/Bogota"` (`better-auth.ts`, `better-auth-provider.ts`). This story makes it a sign-up input and replaces the literal with `APP_TIMEZONE`.
- Validation: a zone is valid when `new Intl.DateTimeFormat("en", { timeZone })` accepts it; the canonical name from `resolvedOptions().timeZone` is stored. At sign-up an invalid or missing zone falls back to `APP_TIMEZONE`, so an unusual browser never blocks registration; `PATCH /api/v1/me` rejects it with `InvalidTimeZone` (422).
- The web sign-up form sends `Intl.DateTimeFormat().resolvedOptions().timeZone`, the browser's zone (HU-E9-01).
- Consumers: the default date and time of new transactions and the current period of `ListTransactions` (HU-E4-14), and the local hour of reminders (HU-E8-16). Space-level clocks (the recurrence scheduler's "today", closing a plan) keep `APP_TIMEZONE`; this story adds no per-space time zone.
- The last scenario becomes testable with HU-E4-14.
- Errors (catalogue, spec 8): `InvalidTimeZone` (422) from `PATCH /api/v1/me`; sign-up never refuses a zone (M3-D Task 3).
- **Spec impact:** section 3 (America/Bogota becomes the deployment default; each user has a zone), 5.2 **User** (`timezone`: an IANA zone, taken from the browser at sign-up, `APP_TIMEZONE` as the fallback), 7 HTTP conventions (`PATCH /api/v1/me`; time zones are IANA names).

---

## HU-E1-15 — Formatting preferences

- **Milestone:** M3-D · **Priority:** Must · **Size:** S · **Depends on:** HU-E1-01, HU-E1-14 · **Module(s):** `identity`

**User story:** As a user, I want to choose how numbers, dates and times are written and which day my week starts on, independently of the language of the interface, so that the app reads the way I am used to.

```gherkin
Feature: Formatting preferences

  Background:
    Given the installation rules are numberFormat "DOT_COMMA", timeFormat "H24", dateFormat "DMY" and weekStart "MONDAY"
    And "Ana" is signed in with the locale "es"

  Scenario: Without an override the installation rules apply
    Given "Ana" has set no formatting preference
    When "Ana" requests "GET /api/v1/me"
    Then every stored preference is null
    And the effective preferences are numberFormat "DOT_COMMA", timeFormat "H24", dateFormat "DMY" and weekStart "MONDAY"
    And no preference is locked

  Scenario: A person overrides the time format
    Given "Juan" has set no formatting preference
    When "Ana" sets her timeFormat to "H12"
    Then "GET /api/v1/me" returns the stored timeFormat "H12" and the effective timeFormat "H12"
    And her numberFormat, dateFormat and weekStart are still null and follow the installation rules
    And "Juan" still has the effective timeFormat "H24"

  Scenario: The language does not change the formats
    When "Ana" sets her numberFormat to "COMMA_DOT" and her timeFormat to "H12"
    Then "GET /api/v1/me" returns the locale "es", the effective numberFormat "COMMA_DOT" and the effective timeFormat "H12"
    When "Ana" sets her locale to "en"
    Then her effective numberFormat is still "COMMA_DOT" and her effective timeFormat is still "H12"
    And her dateFormat and weekStart still follow the installation rules

  Scenario: Reset a preference to the default
    Given "Ana" has stored the timeFormat "H12"
    When "Ana" sets her timeFormat to null
    Then her stored timeFormat is null
    And her effective timeFormat is "H24", the installation rule

  Scenario: A locked preference is refused
    Given the installation rules lock the dateFormat
    When "Ana" sets her dateFormat to "MDY"
    Then the request fails with status 409 and the code "PreferenceLocked"
    And "GET /api/v1/me" lists "dateFormat" among the locked preferences and returns the effective dateFormat "DMY"

  Scenario: An unknown value is rejected
    When "Ana" sets her numberFormat to "DOT_DOT"
    Then the request fails with status 422 and the code "ValidationFailed"
    And her stored numberFormat is unchanged
```

**Technical notes:**
- Use case: `UpdateProfile` (identity, HU-E1-14) accepts the four preferences and `locale`; the profile query behind `GET /api/v1/me` resolves the effective values. Endpoints: `PATCH /api/v1/me` (partial: an omitted field is unchanged, a value sets it, `null` clears it) and `GET /api/v1/me`.
- Model: the user profile gains four nullable columns, stored as constrained text and validated by the Zod contract:
  - `numberFormat`: `DOT_COMMA` (`1.234.567,89`), `COMMA_DOT` (`1,234,567.89`) or `SPACE_COMMA` (`1 234 567,89`);
  - `timeFormat`: `H24` or `H12`;
  - `dateFormat`: `DMY`, `MDY` or `YMD`;
  - `weekStart`: `MONDAY` or `SUNDAY`.

  `null` means "follow the installation rule", so clearing a field is how a person goes back to the default. Nothing here derives from the language (decided 2026-10-16).
- Resolution: the effective value of a field is the installation rule when the field is locked, otherwise the stored value, otherwise the rule. The rules come through a port `InstallationRulesReader`. Its built-in adapter returns the es-CO defaults (`DOT_COMMA`, `H24`, `DMY`, `MONDAY`) and no locks, so this story works before HU-E8-18, which replaces it with the stored rules. A lock never deletes a stored value: when the lock is lifted, the person's choice applies again.
- `GET /api/v1/me` gains `preferences` (additive; `locale` and `timezone` stay where they are): `stored`, `effective` and `defaults` carry the four fields, and `locked` lists the names of the locked fields. The settings screen (HU-E9-13) needs the default to label "Default (24-hour)" and the list to show the lock badge.
- `locale` (`es` or `en`) joins `timezone` (HU-E1-14) on `PATCH /api/v1/me`, because no earlier story lets a user change the interface language; HU-E1-01 still creates users with `es`. Neither is nullable. The lock list can also name `timezone` and `locale` (HU-E8-18), and both honour it.
- A locked field answers `PreferenceLocked` (409), even to clear it or to set the value it already has. The check lives in the use case, never only in the handler, and the code is mapped in `src/shared/http/problem.ts`. The locked scenario runs against a fake `InstallationRulesReader` until HU-E8-18 supplies stored locks.
- Formatting is a client concern: the API keeps returning amounts as minor-unit strings, dates as `YYYY-MM-DD` and instants in RFC 3339 (HU-E0-09), whatever the preferences; the preferences only travel with the profile. Consumers: HU-E9-02 (formatters), HU-E9-03 (the date and time sheet reads `timeFormat` and `weekStart`), HU-E9-13 (settings screen) and HU-E8-18 (rules and locks).
- Errors (catalogue, spec 8): `PreferenceLocked` (409, explicit) from `PATCH /api/v1/me`; an unknown format or language is `ValidationFailed` (422) (M3-D Task 18b).
- **Spec impact:** section 3 (the primary locale es-CO becomes the built-in default of the installation rules, no longer a rule of the language), 5.2 **User** (four nullable preferences), 7 HTTP conventions (`GET` and `PATCH /api/v1/me` with `preferences` and the enum values), section 6 (a new decision: formats never derive from the language).
