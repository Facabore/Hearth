# M2-A Shared Spaces and Members Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first half of Hearth's shared-spaces API: users create shared spaces, invite people by email or shareable link, invitees accept with a single-use (email) or multi-use (link) token, members add guests who have no account, owners change roles under a pure permission matrix that every use case consults, and owners or admins create the shared fund account of a shared space.

**Architecture:** All new behaviour lives in the existing `spaces` module (plus one rule change in `accounts` and one read method on the identity adapter). The `spaces` domain gains a pure permission policy (`permissions.ts`), member rules (`member.ts`) and an `Invitation` aggregate (`invitation.ts`); the application layer gains `AuthorizeSpaceAction` (`authorizeSpaceAction` / `requirePermission`) and seven use cases behind new ports (`SpaceMemberRepository`, `InvitationRepository`, `InvitationTokens`, `EmailSender`, `RegisteredUsers`). Concurrency is decided by PostgreSQL: partial unique indexes on current members make concurrent joins and duplicate names lose cleanly (`ON CONFLICT DO NOTHING`), and `SELECT … FOR UPDATE` serializes acceptances of one invitation and role changes of one space. Cross-module needs stay ports bound in the composition root (user lookup by email comes from the identity adapter), so no module imports another's internals.

**Tech Stack:** Node.js 24.21.0, pnpm 12.11.2, Next.js 16.4.0 (App Router route handlers), React 19.3.0, TypeScript 6.0.3 strict, Zod 4.6.5, zod-openapi 6.0.2, drizzle-orm 0.45.4 + drizzle-kit 0.31.11, pg 8.23.1, better-auth 1.7.7, Vitest 5.0.3, PostgreSQL 18.6 (Docker CLI in tests). No new dependencies (tokens use `node:crypto`).

**Spec:** `docs/superpowers/specs/2026-10-11-hearth-design.md` (approved 2026-10-11). Stories: `docs/backlog/E1-identity-and-spaces.md` (HU-E1-04, HU-E1-05, HU-E1-06, HU-E1-07, HU-E1-10), `docs/backlog/E2-accounts.md` (HU-E2-02). Format template: `docs/superpowers/plans/2026-10-12-m1-personal-ledger.md`. GitHub Project: https://github.com/users/Facabore/projects/4.

**Out of scope (later M2 plans):** shared expenses and split methods (HU-E4-07 … HU-E4-10), balances and settlements (HU-E5-*), leave, archive, claim, guest removal and direct spaces (HU-E1-08, HU-E1-09, HU-E1-11, HU-E1-12, HU-E1-13). Where a scenario of this plan's stories depends on them, the plan pins the rule at the level it can reach now and records the assumption in the Self-Review.

## Global Constraints

- Node.js `24.21.0`; pnpm `12.11.2`; Next.js `16.4.0`; React `19.3.0`; TypeScript `6.0.3` with `strict: true` and `noUncheckedIndexedAccess: true`; Zod `4.6.5`; zod-openapi `6.0.2`; drizzle-orm `0.45.4`; drizzle-kit `0.31.11`; pg `8.23.1`; better-auth `1.7.7`; Vitest `5.0.3`; PostgreSQL image `postgres:18.6-alpine`. No new dependencies; `pnpm check:pinned` must keep passing.
- Money is `bigint` minor units in code and `bigint` columns in PostgreSQL (D6); over HTTP it is `{ "amount": "<minor units as string>", "currency": "<ISO 4217>" }`. One currency per space (D6); a new shared space defaults to `COP` and `MONTHLY(1)` (D14).
- Every money reference points to a `SpaceMember`, never to a user (D15). A `GUEST` member has no user, no role, no accounts and cannot sign in; only guests carry a `contactEmail`. Display names are unique among the current members of a space, ignoring case.
- HTTP errors are RFC 9457 `application/problem+json` with a stable `code` (the domain error name) and `requestId`; the API never returns translated text. Status mapping lives only in `src/shared/http/problem.ts` (explicit map, then `*NotFound` → 404, `Invalid*` → 422, else 409). A requester who is not a member of a space gets `404 SpaceNotFound`.
- Authorization is always enforced in use cases through the `spaces` permission matrix (membership first, then role), never only in handlers.
- Invitation tokens carry at least 128 bits of randomness (256 here), travel only in the URL path and the accept request, and are stored only as a SHA-256 hash.
- Hexagonal boundaries (ADR 0001): domain imports only its own domain and `src/shared/kernel`; application never imports infrastructure, contracts, HTTP, frameworks or the ORM; other modules are reached only through `src/modules/<m>/application/index.ts`; `*.schema.ts` may import other modules' `*.schema.ts` for foreign keys. Repositories never import another module's schema; the user lookup by email is an identity adapter method bound in the composition root.
- Repositories guard identifiers from URLs with `isUuid` before querying `uuid` columns (malformed ids return `null` or `[]`, never a `500`).
- Strict TDD: every behaviour starts with a failing test that is run and seen failing. `@critical`-style end-to-end scenarios run as acceptance tests (route handlers + real PostgreSQL); the rest as unit or integration tests.
- Code, identifiers, comments, docs and generated artifacts in English. Conventional commits referencing the story issue (`Refs #<n>`); no AI attribution or `Co-Authored-By` lines.
- Gates for every task: `pnpm exec vitest run --project unit`, `pnpm exec vitest run --project integration`, `pnpm exec vitest run --project acceptance` (from Task 9 on, where behaviour reachable over HTTP changes), `pnpm format`, `pnpm exec eslint .`, `pnpm exec tsc --noEmit`, `pnpm exec prettier --check .`, `pnpm lint:boundaries`, `pnpm db:check`.

## Review Focus

1. **Replayed, expired, revoked or garbage invitation tokens** (a forwarded email clicked twice, an old link, a link after the admin revoked it, a token someone typed): a used email invitation answers `409 InvitationAlreadyUsed`, an invitation is expired from exactly 7 days after creation (`409 InvitationExpired`), revocation wins over expiry (`409 InvitationRevoked`), an unknown token is `404 InvitationNotFound`, and none of them adds a member — pinned in Task 6 (domain boundaries), Task 8 (use case) and Task 15 (HTTP, including an 8-day-old invitation).
2. **Concurrent acceptance of the same invitation** (a double-click, the same email opened on two devices): exactly one membership row is created; the email invitation's second acceptance gets `InvitationAlreadyUsed`, a link accepted twice by the same user gets `AlreadyMember` — pinned in Task 12 (two parallel transactions against PostgreSQL, invitation row locked `FOR UPDATE`, partial unique index on current members) and Task 15 (parallel HTTP requests).
3. **Role escalation and owner lockout** (an ADMIN promoting themselves to OWNER, a MEMBER changing roles, an invitation granting OWNER, the last OWNER demoting themselves, two owners demoting each other at the same instant): `403 InsufficientRole`, `422 InvalidInvitationRole`, `409 LastOwnerRequired`, and the space always keeps exactly one OWNER — pinned in Task 1 (only OWNER may change roles), Task 4 (use case, actor re-checked on locked rows), Task 7 (invitation role), Task 11 (two concurrent demotions against PostgreSQL) and Task 17 (HTTP).
4. **A guest given a role, a user, an account or a sign-in** (changing Pedro's role, a raw row with a user id, a contact email that looks like a login): `409 GuestHasNoRole`; database checks reject `GUEST` rows with a user or a role and contact emails on registered members; a guest's contact email creates no user, so signing in with it answers `401 InvalidCredentials` — pinned in Task 2 (domain), Task 4 (use case), Task 10 (check constraints, test red before the migration) and Task 16 (HTTP sign-in).
5. **Malformed or foreign identifiers on every new path** (`/spaces/not-a-uuid/members`, an invitation id of another space, a member id that is not a UUID, a space the caller does not belong to): `404 SpaceNotFound` / `InvitationNotFound` / `MemberNotFound`, never a `500` from a failed `uuid` cast and never another space's data — pinned in Task 11 and Task 12 (repositories return `[]`/`null`), Task 13, Task 14 and Task 17 (HTTP).

## Execution Workflow

- Work on the long-lived branch `development`; every task is implemented there with Strict TDD.
- **RDD before every commit** (receipt-driven development is on; check with `gentle-ai review mode status`). Each "Commit" step means:
  1. Run every source-mutating normalizer first (`pnpm format`, regenerated migrations or snapshots), then stage exactly the files of the task.
  2. Run `gentle-ai review status --cwd . --contract gentle-ai.review-integration/v2 --agent claude-code --next-transition` and follow only the returned `next_transition` (`execute` its operation, satisfy `collect` inputs, or stop on `stop` and report its reason code with its documented continuation). Medium/high-risk candidates may return a consent envelope; relay it to the owner and wait.
  3. Commit only after the provider-returned `review.validate` allows the `pre-commit` gate for that exact staged candidate; the commit must not change the reviewed bytes.
  4. If the owner disables RDD (`gentle-ai review mode disable --scope clone --cwd .`), commit under ordinary policy and report `disabled/unmanaged`.
- Code blocks in this plan are complete but not guaranteed to match Prettier's line wrapping: run `pnpm format` before the gates of every task (the gates then run `prettier --check`).
- Every code block the executor writes is introduced by a line naming its file path in backticks and ending with a colon. "Create" blocks are whole files; edits to existing files name a unique anchor line ("after the line …", "replace the line …").
- Each task is one commit sized for review (target under ~400 changed lines). If a staged task grows past that, split it into two consecutive commits along its own boundaries, each green and each with its own RDD pass. The tasks at or over the limit (OpenAPI snapshot growth of about 100 lines per operation included) and their split points, each half keeping its own red-then-green tests: Task 7, ~510 lines (ports, view, in-memory doubles and `CreateInvitation` with its `describe` block | `RevokeInvitation` with its `describe` block and export); Task 13, ~480 lines (`POST /api/v1/spaces`: body schema, operation, route, `createSpace` wiring, `problemOf`, `newSharedSpace`/`actingIn`, its snapshot and the create scenarios | `GET …/members`: member schema and `memberDto`, operation, route, `membersDeps`/`listMembers` wiring, the `SpaceMember` component, its snapshot, the members assertion of the first scenario and the hidden-members scenario); Task 14, ~580 lines (create invitation: body and response schemas, operation, route, wiring with the `EmailSender` seam, the `Invitation` component, `tokenOf`/`inviteByLink`, its snapshot and the create scenarios | revoke: `InvitationPath`, operation, route, wiring, its snapshot and the two revoke scenarios); Task 17, ~370 lines (route, contract and wiring + role-change scenarios | permission-matrix and shared-fund scenarios). The generated Drizzle snapshot (`drizzle/meta/0006_snapshot.json`) is committed in its own schema task (Task 10, with the constraint test that is red before the migration); the OpenAPI snapshot changes only in the HTTP tasks (13–17).
- When a task starts, move its story issues to **In Progress** on Project #4; when all tasks are done, open one pull request that closes #13, #14, #15, #16, #19, #24. Before opening it, open a follow-up issue for the SMTP adapter of the `EmailSender` port; the pull request description links it and states that HU-E1-06's "an invitation email is sent" step is satisfied at port level only (the port is tested with a recording sender; production binds a disabled sender).
- Task-to-issue map (issues are titled with their story ID): HU-E1-04 → #13, HU-E1-05 → #14, HU-E1-06 → #15, HU-E1-07 → #16, HU-E1-10 → #19, HU-E2-02 → #24.
- zod-openapi lesson from M1: a component registered in `components.schemas` that is used in **both** a request and a response is emitted twice (`<Name>` for input and `<Name>Output`). The components this plan adds (`SpaceMember`, `Invitation`) are used only in responses, so no `…Output` variant may appear; if one does, a request schema is reusing the component — fix the contract instead of accepting the snapshot.

## File Structure

```
.
├── drizzle/
│   └── 0006_shared_spaces.sql (+ meta/0006_snapshot.json)          # Task 10
├── openapi/openapi.snapshot.json                                    # Tasks 13–17
├── src/
│   ├── shared/http/problem.ts                                       # + InvitationEmailMismatch → 403 (Task 15)
│   ├── composition/
│   │   ├── container.ts                                             # wiring of every new use case (Tasks 13–17)
│   │   └── openapi.ts                                               # SpaceMember (Task 13), Invitation (Task 14)
│   ├── modules/
│   │   ├── spaces/
│   │   │   ├── domain/permissions.ts                                # SpaceAction matrix, can, rolesFor (Task 1)
│   │   │   ├── domain/space.ts                                      # + contactEmail, createSharedSpace (Task 2)
│   │   │   ├── domain/member.ts                                     # guests, joining users, role changes (Task 2)
│   │   │   ├── domain/invitation.ts                                 # Invitation aggregate (Task 6)
│   │   │   ├── application/space-access.ts                          # + requirePermission, authorizeSpaceAction (Task 1)
│   │   │   ├── application/space-member-repository.ts               # SpaceMemberRepository port (Task 3)
│   │   │   ├── application/create-space.ts                          # CreateSpace (Task 3)
│   │   │   ├── application/{members-deps,list-members,change-member-role}.ts   # Task 4
│   │   │   ├── application/add-guest-member.ts                      # Task 5
│   │   │   ├── application/{invitation-repository,invitation-ports,invitation-view}.ts  # Task 7
│   │   │   ├── application/{create-invitation,revoke-invitation}.ts # Task 7
│   │   │   ├── application/accept-invitation.ts                     # Task 8
│   │   │   ├── infrastructure/spaces.schema.ts                      # member checks/indexes, space_invitations (Task 10)
│   │   │   ├── infrastructure/drizzle-space-repository.ts           # + SpaceMemberRepository (Task 11)
│   │   │   ├── infrastructure/drizzle-invitation-repository.ts      # Task 12
│   │   │   ├── infrastructure/crypto-invitation-tokens.ts           # Task 12
│   │   │   └── contracts/spaces.contract.ts                         # Tasks 13–17
│   │   ├── accounts/application/{create-account,account-for-change}.ts  # shared fund needs a manager (Task 9)
│   │   └── identity/infrastructure/better-auth-provider.ts          # + findUserIdByEmail (Task 12)
│   └── app/api/v1/
│       ├── spaces/route.ts                                          # + POST (Task 13)
│       ├── spaces/[spaceId]/members/route.ts                        # GET (Task 13)
│       ├── spaces/[spaceId]/members/[memberId]/route.ts             # PATCH (Task 17)
│       ├── spaces/[spaceId]/guests/route.ts                         # POST (Task 16)
│       ├── spaces/[spaceId]/invitations/route.ts                    # POST (Task 14)
│       ├── spaces/[spaceId]/invitations/[invitationId]/revoke/route.ts  # POST (Task 14)
│       └── invitations/[token]/accept/route.ts                      # POST (Task 15)
└── tests/
    ├── support/
    │   ├── in-memory-spaces.ts       # InMemorySpaceStore, household builders (Task 3); invitation doubles, RecordingEmailSender (Task 7)
    │   ├── fixtures.ts               # + userFixture, sharedSpaceFixture (Task 10)
    │   ├── spaces.ts                 # HTTP helpers: newSharedSpace, actingIn (Task 13), tokenOf, inviteByLink (Task 14), joinAs (Task 15)
    │   └── app.ts                    # + problemOf (Task 13); TestUser.email, registerUser(name, email) (Task 15)
    └── acceptance/
        ├── shared-spaces.test.ts     # Task 13
        ├── invitations.test.ts       # Tasks 14, 15
        ├── guests.test.ts            # Task 16
        ├── roles.test.ts             # Task 17
        └── accounts.test.ts          # + shared fund (Task 17)
```

Test layout follows M0/M1: unit tests next to the code as `*.test.ts` (no database), integration tests as `*.int.test.ts` (real PostgreSQL via `testDatabase()`), acceptance tests in `tests/acceptance/` calling the exported route handlers in-process. Shared test doubles live in `tests/support/` so production folders hold no test code.

Run a single file with `pnpm exec vitest run --project <unit|integration|acceptance> <path>`. Integration and acceptance projects start a disposable PostgreSQL container through the Docker CLI (`tests/support/postgres-global-setup.ts`) and apply every migration in `drizzle/`, so Docker must be running.

### How roles gate the M1 endpoints

M1 already authorizes every use case: settings and the category tree require OWNER or ADMIN (`MANAGERS`), accounts and ledger writes require MEMBER or above (`WRITERS`), editing or deleting another member's transaction requires OWNER or ADMIN (`canModify`), and every read accepts any current member. Task 1 re-derives `MANAGERS` and `WRITERS` from the new permission matrix (same values, pinned by a test), so **no existing M1 assertion changes**. The only M1 behaviour that changes is Task 9: creating, renaming or archiving a `SHARED_FUND` account now requires OWNER or ADMIN.

| Endpoint (M1) | Matrix action | Roles |
|---|---|---|
| `GET` space, periods, categories, accounts, transactions, audit | `space.read` | OWNER, ADMIN, MEMBER, VIEWER |
| `PATCH /spaces/{id}`, category and group management | `space.manage` (`MANAGERS`) | OWNER, ADMIN |
| `POST` accounts (personal types), expenses, incomes, transfers | `money.record` (`WRITERS`) | OWNER, ADMIN, MEMBER |
| `PATCH`/`DELETE` a transaction created by someone else | `money.editAny` (mirrored by ledger `canModify`, pinned in Task 1) | OWNER, ADMIN |
| `POST`/`PATCH`/archive a `SHARED_FUND` account | `fund.manage` (Task 9) | OWNER, ADMIN |

---

### Task 1: Spaces — permission matrix and AuthorizeSpaceAction

Implements the pure permission policy of HU-E1-05 (issue #14): every row of the "Permissions per role" outline maps to one `SpaceAction`, guests (no role) are allowed nothing, and only OWNER may change roles so nobody can raise their own role. `AuthorizeSpaceAction` (`authorizeSpaceAction`) resolves the membership first, so non-members get `SpaceNotFound` whatever the action (spec 8).

Decision: keep `requireRole`, `MANAGERS` and `WRITERS` as the existing low-level API (M1 consumers keep compiling unchanged) but derive the two role sets from the matrix; new use cases use `authorizeSpaceAction` / `requirePermission`. The matrix is pending owner confirmation (`docs/product/functional-overview.md`); this plan implements it exactly as the HU-E1-05 outline and spec D15 state.

Decision: actions whose use cases arrive later (`space.archive` for HU-E1-09, settlements and guest payers for HU-E4-07/HU-E5-02, balances for HU-E5-01) are part of the matrix now and pinned by the policy test, so those stories only call `authorizeSpaceAction`.

Decision: the ledger's M1 rule for changing another member's transaction (`canModify` in the ledger domain, which cannot import the spaces module) stays where it is, but a ledger test pins it to the matrix row `money.editAny` for every role, so the matrix remains the single source of truth and the two cannot drift.

**Files:**
- Create: `src/modules/spaces/domain/permissions.ts`
- Modify: `src/modules/spaces/application/space-access.ts`, `src/modules/spaces/application/index.ts`
- Test: `src/modules/spaces/domain/permissions.test.ts`, `src/modules/spaces/application/space-access.test.ts`, `src/modules/ledger/domain/transaction.test.ts` (modified)

**Interfaces:**
- Consumes: `SpaceRole` (`src/modules/spaces/domain/space.ts`); `SpaceMembership`, `SpaceSettingsRepository` (`space-settings-repository.ts`); `domainError`, `err`, `flatMap`, `ok`, `Result` (kernel); `canModify` (`src/modules/ledger/domain/transaction.ts`, test only); test helpers `codeOf`, `fakeSpaceAccess`, `membership`, `unwrap` (`tests/support/fakes.ts`).
- Produces:
  - `type SpaceAction = "space.read" | "space.manage" | "space.archive" | "member.invite" | "member.changeRole" | "guest.add" | "money.record" | "money.editAny" | "fund.manage"`
  - `SPACE_ACTIONS: SpaceAction[]`, `rolesFor(action: SpaceAction): readonly SpaceRole[]`, `can(role: SpaceRole | null, action: SpaceAction): boolean`
  - `requirePermission(membership: SpaceMembership, action: SpaceAction): Result<SpaceMembership>` (`InsufficientRole`)
  - `authorizeSpaceAction(access: SpaceAccess, spaceId: string, userId: string, action: SpaceAction): Promise<Result<SpaceMembership>>` (`SpaceNotFound`, `InsufficientRole`)
  - `MANAGERS`, `WRITERS` unchanged in value, now derived from the matrix.

- [ ] **Step 1: Write the failing tests**

`src/modules/spaces/domain/permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { can, rolesFor, SPACE_ACTIONS, type SpaceAction } from "./permissions";
import type { SpaceRole } from "./space";

describe("permission matrix (HU-E1-05)", () => {
  // Background: OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi; the guest Pedro has no role.
  it.each<[string, SpaceRole, SpaceAction, boolean]>([
    ["Ana archives the space", "OWNER", "space.archive", true],
    ["Juan archives the space", "ADMIN", "space.archive", false],
    ["Juan invites a member", "ADMIN", "member.invite", true],
    ["Luis invites a member", "MEMBER", "member.invite", false],
    ["Luis records an expense", "MEMBER", "money.record", true],
    ["Sofi records an expense", "VIEWER", "money.record", false],
    ["Luis edits an expense created by Ana", "MEMBER", "money.editAny", false],
    ["Juan edits an expense created by Ana", "ADMIN", "money.editAny", true],
    ["Sofi views balances", "VIEWER", "space.read", true],
    ["Luis adds a guest", "MEMBER", "guest.add", true],
    ["Sofi adds a guest", "VIEWER", "guest.add", false],
    ["Luis records an expense paid by Pedro", "MEMBER", "money.record", true],
    ["Sofi records a settlement for Pedro", "VIEWER", "money.record", false],
  ])("%s", (_scenario, role, action, allowed) => {
    expect(can(role, action)).toBe(allowed);
  });

  it("lets only owners change roles, so nobody raises their own role", () => {
    expect(rolesFor("member.changeRole")).toEqual(["OWNER"]);
  });

  it("allows a guest, who has no role, nothing", () => {
    for (const action of SPACE_ACTIONS) expect(can(null, action)).toBe(false);
  });

  it("lets owners do everything and viewers only read", () => {
    for (const action of SPACE_ACTIONS) expect(can("OWNER", action)).toBe(true);
    expect(SPACE_ACTIONS.filter((action) => can("VIEWER", action))).toEqual(["space.read"]);
  });

  it("keeps shared fund management with owners and admins (HU-E2-02)", () => {
    expect(rolesFor("fund.manage")).toEqual(["OWNER", "ADMIN"]);
  });
});
```

`src/modules/spaces/application/space-access.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { codeOf, fakeSpaceAccess, membership, unwrap } from "../../../../tests/support/fakes";
import { authorizeSpaceAction, MANAGERS, requirePermission, WRITERS } from "./space-access";

const household = membership({ spaceId: "space-household", spaceKind: "SHARED", name: "Household" });
const luis = membership({ ...household, memberId: "member-luis", userId: "u-luis", role: "MEMBER" });
const sofi = membership({ ...household, memberId: "member-sofi", userId: "u-sofi", role: "VIEWER" });
const access = fakeSpaceAccess(household, luis, sofi);

describe("role sets derived from the permission matrix", () => {
  it("keeps the managers and writers M1 authorizes with", () => {
    expect(MANAGERS).toEqual(["OWNER", "ADMIN"]);
    expect(WRITERS).toEqual(["OWNER", "ADMIN", "MEMBER"]);
  });
});

describe("AuthorizeSpaceAction (HU-E1-05)", () => {
  it("returns the membership when the role allows the action", async () => {
    expect(unwrap(await authorizeSpaceAction(access, "space-household", "u-luis", "guest.add"))).toBe(luis);
  });

  it("answers InsufficientRole when it does not", async () => {
    expect(codeOf(await authorizeSpaceAction(access, "space-household", "u-sofi", "guest.add"))).toBe(
      "InsufficientRole",
    );
    expect(codeOf(requirePermission(luis, "member.invite"))).toBe("InsufficientRole");
  });

  it("answers SpaceNotFound to non-members before looking at roles", async () => {
    expect(codeOf(await authorizeSpaceAction(access, "space-household", "u-marta", "space.read"))).toBe(
      "SpaceNotFound",
    );
  });
});
```

In `src/modules/ledger/domain/transaction.test.ts`, add after the line `import { describe, expect, it } from "vitest";`:

```ts
import { can } from "@/modules/spaces/application";
```

and insert just before the last line of the file (the `});` that closes the outer `describe`):

```ts

  // HU-E1-05: changing someone else's transaction mirrors the spaces matrix (money.editAny), so the two never drift.
  it.each(["OWNER", "ADMIN", "MEMBER", "VIEWER", null] as const)(
    "lets role %s change a transaction created by someone else exactly when the matrix allows money.editAny",
    (role) => {
      expect(canModify(role, "u-ana", "u-luis")).toBe(can(role, "money.editAny"));
    },
  );
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/spaces/domain/permissions.test.ts src/modules/spaces/application/space-access.test.ts src/modules/ledger/domain/transaction.test.ts`
Expected: FAIL — `Failed to resolve import "./permissions"`, `authorizeSpaceAction is not a function` (no such export in `./space-access`) and, in the ledger file, `can is not a function` (no such export in `@/modules/spaces/application` yet; the existing ledger tests still pass).

- [ ] **Step 3: Implement**

`src/modules/spaces/domain/permissions.ts`:

```ts
import type { SpaceRole } from "./space";

/**
 * HU-E1-05 permission matrix, a pure policy (pending owner confirmation, docs/product/functional-overview.md).
 * Guests have no role (spec D15): they never act themselves, so no action lists them.
 */
const MATRIX = {
  /** View the space, its members and transactions, and (HU-E5-01) its balances. */
  "space.read": ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
  /** Rename, currency and period policy (HU-E1-03); the category tree (HU-E3-02). */
  "space.manage": ["OWNER", "ADMIN"],
  /** HU-E1-09. */
  "space.archive": ["OWNER"],
  /** Create and revoke invitations (HU-E1-06) and guest claim links (HU-E1-11). */
  "member.invite": ["OWNER", "ADMIN"],
  /** Only owners change roles, so nobody can raise their own role (HU-E1-05). */
  "member.changeRole": ["OWNER"],
  /** HU-E1-10, D15. */
  "guest.add": ["OWNER", "ADMIN", "MEMBER"],
  /** Expenses, incomes, transfers and settlements, also on a guest's behalf (D15, HU-E4-01). */
  "money.record": ["OWNER", "ADMIN", "MEMBER"],
  /** Change or delete a transaction someone else created (HU-E4-06); creators change their own. */
  "money.editAny": ["OWNER", "ADMIN"],
  /** Create, edit and archive shared fund accounts (HU-E2-02). */
  "fund.manage": ["OWNER", "ADMIN"],
} as const satisfies Record<string, readonly SpaceRole[]>;

export type SpaceAction = keyof typeof MATRIX;

export const SPACE_ACTIONS = Object.keys(MATRIX) as SpaceAction[];

export const rolesFor = (action: SpaceAction): readonly SpaceRole[] => MATRIX[action];

export const can = (role: SpaceRole | null, action: SpaceAction): boolean =>
  role !== null && rolesFor(action).includes(role);
```

`src/modules/spaces/application/space-access.ts` (replace the whole file):

```ts
import { domainError, err, flatMap, ok, type Result } from "@/shared/kernel";
import { can, rolesFor, type SpaceAction } from "../domain/permissions";
import type { SpaceRole } from "../domain/space";
import type { SpaceSummary } from "./space-repository";
import type { SpaceMembership, SpaceSettingsRepository } from "./space-settings-repository";

/** Resolves the acting user's membership; non-members get SpaceNotFound so existence never leaks (spec 8). */
export type SpaceAccess = (spaceId: string, userId: string) => Promise<Result<SpaceMembership>>;

export const createSpaceAccess =
  (spaces: Pick<SpaceSettingsRepository, "findMembership">): SpaceAccess =>
  async (spaceId, userId) => {
    const membership = await spaces.findMembership(spaceId, userId);
    return membership ? ok(membership) : err(domainError("SpaceNotFound"));
  };

/** Roles that manage a space's settings and catalog (HU-E1-03, HU-E3-02). */
export const MANAGERS: readonly SpaceRole[] = rolesFor("space.manage");
/** Roles that record money movements; VIEWER only reads. */
export const WRITERS: readonly SpaceRole[] = rolesFor("money.record");

export const requireRole = (
  membership: SpaceMembership,
  roles: readonly SpaceRole[],
): Result<SpaceMembership> =>
  membership.role !== null && roles.includes(membership.role)
    ? ok(membership)
    : err(domainError("InsufficientRole"));

/** HU-E1-05: the membership when the permission matrix lets its role perform `action`. */
export const requirePermission = (membership: SpaceMembership, action: SpaceAction): Result<SpaceMembership> =>
  can(membership.role, action) ? ok(membership) : err(domainError("InsufficientRole"));

/**
 * AuthorizeSpaceAction (HU-E1-05), used by every use case: membership first, so non-members get
 * SpaceNotFound whatever the action (spec 8), then the role.
 */
export const authorizeSpaceAction = async (
  access: SpaceAccess,
  spaceId: string,
  userId: string,
  action: SpaceAction,
): Promise<Result<SpaceMembership>> => flatMap(await access(spaceId, userId), (m) => requirePermission(m, action));

export const toSpaceSummary = (m: SpaceMembership): SpaceSummary => ({
  id: m.spaceId,
  name: m.name,
  kind: m.spaceKind,
  currency: m.currency,
  periodPolicy: m.periodPolicy,
  role: m.role,
});
```

In `src/modules/spaces/application/index.ts`, add after the line `export { ensureCanAddMember } from "../domain/space";`:

```ts
export { can, rolesFor, SPACE_ACTIONS, type SpaceAction } from "../domain/permissions";
```

and replace the block

```ts
export {
  createSpaceAccess,
  MANAGERS,
  requireRole,
  toSpaceSummary,
  WRITERS,
  type SpaceAccess,
} from "./space-access";
```

with:

```ts
export {
  authorizeSpaceAction,
  createSpaceAccess,
  MANAGERS,
  requirePermission,
  requireRole,
  toSpaceSummary,
  WRITERS,
  type SpaceAccess,
} from "./space-access";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules`
Expected: PASS (every unit test of every module, including the new ledger pin; M1's role tests are unchanged because `MANAGERS`/`WRITERS` keep their values).

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (`domain-must-be-pure` holds: `permissions.ts` imports only `./space`).

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/domain/permissions.ts src/modules/spaces/domain/permissions.test.ts src/modules/spaces/application/space-access.ts src/modules/spaces/application/space-access.test.ts src/modules/spaces/application/index.ts src/modules/ledger/domain/transaction.test.ts
git commit -m "feat(spaces): add the role permission matrix and AuthorizeSpaceAction (Refs #14)"
```

---

### Task 2: Spaces — shared spaces, guests and role changes in the domain

Implements the domain rules of HU-E1-04 (issue #13), HU-E1-05 (issue #14) and HU-E1-10 (issue #19): a shared space starts with its creator as the only OWNER, `MONTHLY(1)` and a supported currency; a guest has no user and no role; display names are unique among current members ignoring case; a role change never touches a guest and never removes the last OWNER.

Decisions:
- `SpaceMember` gains `contactEmail: string | null` (spec 5.2, only guests carry one, stored lower-cased).
- Display names (guests and joining users) are trimmed and 1–100 characters, the same bound as a user's name at sign-up (`InvalidMemberName`).
- A registered user who joins keeps their account name; when a current member already uses it, the first free numbered name (`"Ana 2"`, `"Ana 3"`, …) is taken, so joining never fails on a name the invitee cannot change. The numbered name stays within 100 characters including the suffix (the base is shortened when needed), and names the database already refused can be passed in so they are never tried again (Task 8). Guests are named by the member adding them, so a taken guest name is rejected (`MemberNameTaken`).
- Emails are trimmed and lower-cased by one exported domain helper, `normalizedEmail` (`member.ts`), reused by guest contact emails here and by invitations (Task 6). Identity keeps its own `normalizeEmail` (module boundary).
- `ensureCanAddMember` now takes `Pick<Space, "kind">`, so use cases call it with the membership's space kind; existing callers passing a `Space` keep compiling.
- The space's founding member is built inline in `space.ts`; `member.ts` imports `space.ts`, never the reverse, so `no-circular` holds.

**Files:**
- Modify: `src/modules/spaces/domain/space.ts`, `src/modules/spaces/domain/space.test.ts`, `src/modules/spaces/application/index.ts`
- Create: `src/modules/spaces/domain/member.ts`
- Test: `src/modules/spaces/domain/member.test.ts`

**Interfaces:**
- Consumes: `currencyOf`, `DEFAULT_PERIOD_POLICY`, `domainError`, `err`, `monthly`, `ok`, `semiMonthly`, `Id`, `PeriodPolicy`, `Result` (kernel).
- Produces:
  - `interface SpaceMember { id; kind: "USER" | "GUEST"; userId: string | null; displayName: string; role: SpaceRole | null; contactEmail: string | null; joinedAt: Date }`
  - `createSharedSpace(input: { id: SpaceId; memberId: SpaceMemberId; ownerUserId: string; ownerName: string; name: string; currency: string; now: Date }): Result<Space>` (`InvalidSpaceName`, `UnknownCurrency`)
  - `ensureCanAddMember(space: Pick<Space, "kind">): Result<void>` (`PersonalSpaceNotShareable`)
  - `normalizedEmail(raw: string): string` (trimmed, lower-cased)
  - `memberName(raw: string): Result<string>` (`InvalidMemberName`)
  - `ensureNameAvailable(current: readonly SpaceMember[], name: string): Result<void>` (`MemberNameTaken`)
  - `guestMember(input: { id: SpaceMemberId; displayName: string; contactEmail: string | null; now: Date; current: readonly SpaceMember[] }): Result<SpaceMember>`
  - `availableDisplayName(current: readonly SpaceMember[], userName: string, alsoTaken?: readonly string[]): string` (at most 100 characters)
  - `userMember(input: { id: SpaceMemberId; userId: string; userName: string; role: SpaceRole; now: Date; current: readonly SpaceMember[]; alsoTaken?: readonly string[] }): SpaceMember`
  - `changeMemberRole(current: readonly SpaceMember[], memberId: string, role: SpaceRole): Result<SpaceMember>` (`MemberNotFound`, `GuestHasNoRole`, `LastOwnerRequired`)
  - `SpaceMember` exported from `src/modules/spaces/application/index.ts`.

- [ ] **Step 1: Write the failing tests**

In `src/modules/spaces/domain/space.test.ts`, replace the line

```ts
import { checkedPeriodPolicy, createPersonalSpace, ensureCanAddMember, spaceName } from "./space";
```

with:

```ts
import {
  checkedPeriodPolicy,
  createPersonalSpace,
  createSharedSpace,
  ensureCanAddMember,
  spaceName,
} from "./space";
```

and append:

```ts
describe("shared space (HU-E1-04)", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const shared = (name: string, currency = "COP") =>
    createSharedSpace({
      id: "s-2" as Id<"Space">,
      memberId: "m-2" as Id<"SpaceMember">,
      ownerUserId: "u-ana",
      ownerName: "Ana",
      name,
      currency,
      now,
    });

  it("is SHARED, trimmed, in MONTHLY(1), with its creator as the only OWNER", () => {
    const result = shared("  Household ");
    expect(result.ok && result.value).toMatchObject({
      kind: "SHARED",
      name: "Household",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
      personalOwnerUserId: null,
    });
    expect(result.ok && result.value.members).toEqual([
      {
        id: "m-2",
        kind: "USER",
        userId: "u-ana",
        displayName: "Ana",
        role: "OWNER",
        contactEmail: null,
        joinedAt: now,
      },
    ]);
  });

  it("requires a name", () => {
    const result = shared("   ");
    expect(!result.ok && result.error.code).toBe("InvalidSpaceName");
  });

  it("rejects currencies the kernel does not support", () => {
    const result = shared("Household", "XYZ");
    expect(!result.ok && result.error.code).toBe("UnknownCurrency");
  });

  it("can receive members", () => {
    expect(ensureCanAddMember({ kind: "SHARED" })).toEqual({ ok: true, value: undefined });
  });
});
```

`src/modules/spaces/domain/member.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Id, Result } from "@/shared/kernel";
import {
  availableDisplayName,
  changeMemberRole,
  ensureNameAvailable,
  guestMember,
  memberName,
  userMember,
} from "./member";
import type { SpaceMember, SpaceRole } from "./space";

const now = new Date("2026-10-13T12:00:00Z");
const code = (result: Result<unknown>) => (result.ok ? "ok" : result.error.code);
const member = (id: string, displayName: string, role: SpaceRole | null): SpaceMember => ({
  id: id as Id<"SpaceMember">,
  kind: role === null ? "GUEST" : "USER",
  userId: role === null ? null : `u-${id}`,
  displayName,
  role,
  contactEmail: null,
  joinedAt: now,
});
const ana = member("ana", "Ana", "OWNER");
const luis = member("luis", "Luis", "MEMBER");
const pedro = member("pedro", "Pedro", null);
const current = [ana, luis, pedro];

describe("guest members (HU-E1-10)", () => {
  it("have no user and no role, a trimmed name and a lower-cased contact email", () => {
    const guest = guestMember({
      id: "g-1" as Id<"SpaceMember">,
      displayName: " Marta ",
      contactEmail: " Marta@Example.com ",
      now,
      current,
    });
    expect(guest).toEqual({
      ok: true,
      value: {
        id: "g-1",
        kind: "GUEST",
        userId: null,
        displayName: "Marta",
        role: null,
        contactEmail: "marta@example.com",
        joinedAt: now,
      },
    });
  });

  it("may have no contact email", () => {
    const guest = guestMember({ id: "g-1" as Id<"SpaceMember">, displayName: "Marta", contactEmail: null, now, current });
    expect(guest.ok && guest.value.contactEmail).toBeNull();
  });

  it("need a name unique among current members of both kinds, ignoring case", () => {
    for (const taken of ["pedro", "ANA"]) {
      const guest = guestMember({ id: "g-1" as Id<"SpaceMember">, displayName: taken, contactEmail: null, now, current });
      expect(code(guest)).toBe("MemberNameTaken");
    }
    expect(code(ensureNameAvailable(current, "LUIS"))).toBe("MemberNameTaken");
    expect(code(ensureNameAvailable(current, "Sofi"))).toBe("ok");
  });

  it("need a name of 1 to 100 characters", () => {
    expect(code(memberName("   "))).toBe("InvalidMemberName");
    expect(code(memberName("x".repeat(101)))).toBe("InvalidMemberName");
    expect(memberName(`  ${"x".repeat(100)}  `)).toEqual({ ok: true, value: "x".repeat(100) });
  });
});

describe("registered members joining (HU-E1-07)", () => {
  it("take their account name and the invited role", () => {
    expect(
      userMember({ id: "m-9" as Id<"SpaceMember">, userId: "u-juan", userName: "Juan", role: "MEMBER", now, current }),
    ).toEqual({
      id: "m-9",
      kind: "USER",
      userId: "u-juan",
      displayName: "Juan",
      role: "MEMBER",
      contactEmail: null,
      joinedAt: now,
    });
  });

  it("get the first free numbered name when theirs is taken", () => {
    expect(availableDisplayName(current, "Juan")).toBe("Juan");
    expect(availableDisplayName(current, "ana")).toBe("ana 2");
    expect(availableDisplayName([...current, member("ana2", "Ana 2", "MEMBER")], "Ana")).toBe("Ana 3");
  });

  it("keep numbered names within 100 characters, suffix included", () => {
    const long = "x".repeat(100);
    const name = availableDisplayName([...current, member("long", long, "MEMBER")], long);
    expect(name).toBe(`${"x".repeat(98)} 2`);
    expect(name).toHaveLength(100);
  });

  it("skip names the database already refused, ignoring case", () => {
    expect(availableDisplayName(current, "Juan", ["juan"])).toBe("Juan 2");
    expect(
      userMember({ id: "m-9" as Id<"SpaceMember">, userId: "u-juan", userName: "Juan", role: "MEMBER", now, current, alsoTaken: ["Juan", "Juan 2"] })
        .displayName,
    ).toBe("Juan 3");
  });
});

describe("changing roles (HU-E1-05)", () => {
  it("gives a registered member a new role", () => {
    expect(changeMemberRole(current, "luis", "ADMIN")).toEqual({ ok: true, value: { ...luis, role: "ADMIN" } });
  });

  it("keeps at least one OWNER", () => {
    expect(code(changeMemberRole(current, "ana", "ADMIN"))).toBe("LastOwnerRequired");
    const twoOwners = [ana, { ...luis, role: "OWNER" as const }];
    expect(code(changeMemberRole(twoOwners, "ana", "ADMIN"))).toBe("ok");
  });

  it("never gives a guest a role", () => {
    expect(code(changeMemberRole(current, "pedro", "MEMBER"))).toBe("GuestHasNoRole");
  });

  it("reports unknown or malformed member ids as MemberNotFound", () => {
    expect(code(changeMemberRole(current, "nobody", "ADMIN"))).toBe("MemberNotFound");
    expect(code(changeMemberRole(current, "not-a-uuid", "ADMIN"))).toBe("MemberNotFound");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/spaces/domain`
Expected: FAIL — `createSharedSpace is not a function` (no such export in `./space`) and `Failed to resolve import "./member"`.

- [ ] **Step 3: Implement**

`src/modules/spaces/domain/space.ts` (replace the whole file):

```ts
import {
  currencyOf,
  DEFAULT_PERIOD_POLICY,
  domainError,
  err,
  monthly,
  ok,
  semiMonthly,
  type Id,
  type PeriodPolicy,
  type Result,
} from "@/shared/kernel";

export type SpaceId = Id<"Space">;
export type SpaceMemberId = Id<"SpaceMember">;
export type SpaceKind = "PERSONAL" | "SHARED" | "DIRECT";
export type SpaceRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

/** Spec 5.2, D15: kind GUEST <=> no user <=> no role; only guests carry a contact email. */
export interface SpaceMember {
  readonly id: SpaceMemberId;
  readonly kind: "USER" | "GUEST";
  readonly userId: string | null;
  readonly displayName: string;
  readonly role: SpaceRole | null;
  readonly contactEmail: string | null;
  readonly joinedAt: Date;
}

export interface Space {
  readonly id: SpaceId;
  readonly name: string;
  readonly kind: SpaceKind;
  readonly currency: string;
  readonly periodPolicy: PeriodPolicy;
  readonly personalOwnerUserId: string | null;
  readonly members: readonly SpaceMember[];
  readonly createdAt: Date;
}

/** The creator of a space joins it as its OWNER. */
const founder = (input: {
  memberId: SpaceMemberId;
  ownerUserId: string;
  ownerName: string;
  now: Date;
}): SpaceMember => ({
  id: input.memberId,
  kind: "USER",
  userId: input.ownerUserId,
  displayName: input.ownerName,
  role: "OWNER",
  contactEmail: null,
  joinedAt: input.now,
});

/** Spec 5.2: every user gets one personal space in COP with the default period policy. */
export const createPersonalSpace = (input: {
  id: SpaceId;
  memberId: SpaceMemberId;
  ownerUserId: string;
  ownerName: string;
  now: Date;
}): Space => ({
  id: input.id,
  name: "Personal",
  kind: "PERSONAL",
  currency: "COP",
  periodPolicy: DEFAULT_PERIOD_POLICY,
  personalOwnerUserId: input.ownerUserId,
  members: [founder(input)],
  createdAt: input.now,
});

/** HU-E1-04: a shared space starts with its creator as the only OWNER, MONTHLY(1) and a supported currency. */
export const createSharedSpace = (input: {
  id: SpaceId;
  memberId: SpaceMemberId;
  ownerUserId: string;
  ownerName: string;
  name: string;
  currency: string;
  now: Date;
}): Result<Space> => {
  const name = spaceName(input.name);
  if (!name.ok) return name;
  const currency = currencyOf(input.currency);
  if (!currency.ok) return currency;
  const space: Space = {
    id: input.id,
    name: name.value,
    kind: "SHARED",
    currency: currency.value.code,
    periodPolicy: DEFAULT_PERIOD_POLICY,
    personalOwnerUserId: null,
    members: [founder(input)],
    createdAt: input.now,
  };
  return ok(space);
};

/** Personal spaces have exactly one member (spec 5.2, HU-E1-02); guests never join them either (HU-E1-10). */
export const ensureCanAddMember = (space: Pick<Space, "kind">): Result<void> =>
  space.kind === "PERSONAL" ? err(domainError("PersonalSpaceNotShareable")) : ok(undefined);

const MAX_SPACE_NAME = 80;

/** HU-E1-03: space names are trimmed and 1–80 characters long. */
export const spaceName = (raw: string): Result<string> => {
  const name = raw.trim();
  return name.length >= 1 && name.length <= MAX_SPACE_NAME
    ? ok(name)
    : err(domainError("InvalidSpaceName", { length: name.length }));
};

/** Re-checks a policy that arrived from outside: the wire format accepts any integer days. */
export const checkedPeriodPolicy = (policy: PeriodPolicy): Result<PeriodPolicy> =>
  policy.kind === "MONTHLY" ? monthly(policy.day) : semiMonthly(policy.day1, policy.day2);
```

`src/modules/spaces/domain/member.ts`:

```ts
import { domainError, err, ok, type Result } from "@/shared/kernel";
import type { SpaceMember, SpaceMemberId, SpaceRole } from "./space";

/** Same bound as a user's name at sign-up. */
const MAX_MEMBER_NAME = 100;

/** Emails are trimmed and lower-cased (as HU-E1-01 does for users), so binding and matching ignore case. */
export const normalizedEmail = (raw: string): string => raw.trim().toLowerCase();

/** HU-E1-10: display names are trimmed and 1–100 characters long. */
export const memberName = (raw: string): Result<string> => {
  const name = raw.trim();
  return name.length >= 1 && name.length <= MAX_MEMBER_NAME
    ? ok(name)
    : err(domainError("InvalidMemberName", { length: name.length }));
};

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** HU-E1-10: a display name is unique among the current members of both kinds, ignoring case. */
export const ensureNameAvailable = (current: readonly SpaceMember[], name: string): Result<void> =>
  current.some((m) => sameName(m.displayName, name)) ? err(domainError("MemberNameTaken")) : ok(undefined);

/** Spec 5.2, D15: a guest has no user and no role; only guests carry a (lower-cased) contact email. */
export const guestMember = (input: {
  id: SpaceMemberId;
  displayName: string;
  contactEmail: string | null;
  now: Date;
  current: readonly SpaceMember[];
}): Result<SpaceMember> => {
  const name = memberName(input.displayName);
  if (!name.ok) return name;
  const available = ensureNameAvailable(input.current, name.value);
  if (!available.ok) return available;
  const contactEmail = input.contactEmail === null ? "" : normalizedEmail(input.contactEmail);
  const guest: SpaceMember = {
    id: input.id,
    kind: "GUEST",
    userId: null,
    displayName: name.value,
    role: null,
    contactEmail: contactEmail === "" ? null : contactEmail,
    joinedAt: input.now,
  };
  return ok(guest);
};

/**
 * The user's account name, or the first free "Name 2", "Name 3", … when a current member (or a name in
 * `alsoTaken`, e.g. one the database refused) uses it; never longer than 100 characters, suffix included.
 */
export const availableDisplayName = (
  current: readonly SpaceMember[],
  userName: string,
  alsoTaken: readonly string[] = [],
): string => {
  const trimmed = userName.trim();
  const base = trimmed === "" ? "Member" : trimmed.slice(0, MAX_MEMBER_NAME);
  const taken = (name: string) =>
    current.some((m) => sameName(m.displayName, name)) || alsoTaken.some((t) => sameName(t, name));
  if (!taken(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const tail = ` ${suffix}`;
    const candidate = `${base.slice(0, MAX_MEMBER_NAME - tail.length)}${tail}`;
    if (!taken(candidate)) return candidate;
  }
};

/** HU-E1-07: a registered user joining through an invitation, with the invited role. */
export const userMember = (input: {
  id: SpaceMemberId;
  userId: string;
  userName: string;
  role: SpaceRole;
  now: Date;
  current: readonly SpaceMember[];
  /** Names to avoid besides the current members' (names a concurrent join took, Task 8). */
  alsoTaken?: readonly string[];
}): SpaceMember => ({
  id: input.id,
  kind: "USER",
  userId: input.userId,
  displayName: availableDisplayName(input.current, input.userName, input.alsoTaken),
  role: input.role,
  contactEmail: null,
  joinedAt: input.now,
});

/** HU-E1-05: a registered member's new role; guests have no role (D15) and a space keeps one OWNER. */
export const changeMemberRole = (
  current: readonly SpaceMember[],
  memberId: string,
  role: SpaceRole,
): Result<SpaceMember> => {
  const target = current.find((m) => m.id === memberId);
  if (!target) return err(domainError("MemberNotFound"));
  if (target.kind === "GUEST") return err(domainError("GuestHasNoRole"));
  const owners = current.filter((m) => m.role === "OWNER").length;
  if (target.role === "OWNER" && role !== "OWNER" && owners === 1) {
    return err(domainError("LastOwnerRequired"));
  }
  return ok({ ...target, role });
};
```

In `src/modules/spaces/application/index.ts`, replace the line

```ts
export type { Space, SpaceId, SpaceKind, SpaceMemberId, SpaceRole } from "../domain/space";
```

with:

```ts
export type { Space, SpaceId, SpaceKind, SpaceMember, SpaceMemberId, SpaceRole } from "../domain/space";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/spaces`
Expected: PASS (including the unchanged personal-space and settings tests).

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0. The Drizzle repository still writes members without `contactEmail` (the column arrives in Task 10, the mapping in Task 11), so the integration project is unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/domain/space.ts src/modules/spaces/domain/space.test.ts src/modules/spaces/domain/member.ts src/modules/spaces/domain/member.test.ts src/modules/spaces/application/index.ts
git commit -m "feat(spaces): model shared spaces, guest members and role changes in the domain (Refs #13, Refs #14, Refs #19)"
```

---

### Task 3: Spaces — CreateSpace and the in-memory store

Implements the use case of HU-E1-04 (issue #13): `CreateSpace` creates a `SHARED` space with the requester as its only OWNER and seeds the default categories in the creator's locale in the same transaction (HU-E3-01's "English locale seeds English names" scenario, which names a shared space). For `kind: "PERSONAL"` it delegates to the existing `CreatePersonalSpace`, which answers `PersonalSpaceAlreadyExists` (HU-E1-02 technical note: `POST /api/v1/spaces` with kind `PERSONAL`). Introduces the `SpaceMemberRepository` port and `tests/support/in-memory-spaces.ts`, an in-memory store that implements every spaces port, so later use-case tests authorize through the real `createSpaceAccess`.

Decisions:
- Shared spaces default to `MONTHLY(1)` (D14) and take the currency from the request (`COP` when the HTTP body omits it, Task 13); an unsupported code answers `UnknownCurrency` (see Self-Review assumption 3 on the backlog's `UnsupportedCurrency`).
- The category language is the creator's locale (`AuthUser.locale`), like the personal space.
- `DIRECT` spaces are never created through this use case (D16, HU-E1-13).

**Files:**
- Create: `src/modules/spaces/application/space-member-repository.ts`, `src/modules/spaces/application/create-space.ts`, `tests/support/in-memory-spaces.ts`
- Modify: `src/modules/spaces/application/index.ts`
- Test: `src/modules/spaces/application/create-space.test.ts`

**Interfaces:**
- Consumes: `createSharedSpace`, `Space`, `SpaceMember`, `SpaceRole`, `SpaceId`, `SpaceMemberId` (Task 2); `CreatePersonalSpace`, `SpaceCreatedListener` (`create-personal-space.ts`); `SpaceRepository`, `SpaceSummary` (`space-repository.ts`); `SpaceMembership`, `SpaceSettings`, `SpaceSettingsRepository`; `createSeedDefaultCategories` (categories application); `InMemoryCategories` (`tests/support/in-memory-categories.ts`); `codeOf`, `memoryTm`, `sequentialIds`, `unwrap` (`tests/support/fakes.ts`).
- Produces:
  - `type AddMemberOutcome = "added" | "alreadyMember" | "nameTaken"`
  - `interface SpaceMemberRepository { listCurrent(spaceId: SpaceId, options?: { readonly lock?: boolean }): Promise<SpaceMember[]>; addMember(spaceId: SpaceId, member: SpaceMember): Promise<AddMemberOutcome>; updateRole(spaceId: SpaceId, memberId: SpaceMemberId, role: SpaceRole): Promise<void> }`
  - `type CreateSpaceInput = { kind: "PERSONAL"; userId; userName; locale } | { kind: "SHARED"; userId; userName; locale; name; currency }`
  - `type CreateSpace = (input: CreateSpaceInput) => Promise<Result<SpaceSummary>>`, `createCreateSpace(deps: CreateSpaceDeps): CreateSpace` with `CreateSpaceDeps { spaces: SpaceRepository; createPersonalSpace: CreatePersonalSpace; onCreated: SpaceCreatedListener; ids; clock; tm }`
  - `tests/support/in-memory-spaces.ts`: `class InMemorySpaceStore implements SpaceRepository, SpaceSettingsRepository, SpaceMemberRepository` (plus `seed(space)`, `members(spaceId)`, `locked: string[]`), `memberOf(name, role, minutes)`, `HOUSEHOLD_MEMBERS`, `householdSpace(members?)`.

- [ ] **Step 1: Write the port and the in-memory store**

`src/modules/spaces/application/space-member-repository.ts`:

```ts
import type { SpaceId, SpaceMember, SpaceMemberId, SpaceRole } from "../domain/space";

/** Outcome of adding a member; the database decides races between concurrent additions. */
export type AddMemberOutcome = "added" | "alreadyMember" | "nameTaken";

export interface SpaceMemberRepository {
  /**
   * Current members (not left) in join order (joinedAt, then id); `[]` for malformed ids. With `lock`,
   * their rows stay locked until the surrounding transaction ends, so role changes run one at a time.
   */
  listCurrent(spaceId: SpaceId, options?: { readonly lock?: boolean }): Promise<SpaceMember[]>;
  /** Adds the member unless its user is already a current member or a current member has its name (any case). */
  addMember(spaceId: SpaceId, member: SpaceMember): Promise<AddMemberOutcome>;
  updateRole(spaceId: SpaceId, memberId: SpaceMemberId, role: SpaceRole): Promise<void>;
}
```

In `src/modules/spaces/application/index.ts`, append:

```ts
export type { AddMemberOutcome, SpaceMemberRepository } from "./space-member-repository";
```

`tests/support/in-memory-spaces.ts`:

```ts
import type {
  AddMemberOutcome,
  Space,
  SpaceId,
  SpaceMember,
  SpaceMemberId,
  SpaceMemberRepository,
  SpaceMembership,
  SpaceRepository,
  SpaceRole,
  SpaceSettings,
  SpaceSettingsRepository,
  SpaceSummary,
} from "@/modules/spaces/application";

/** Spaces with their current members; implements every spaces port the use cases need. */
export class InMemorySpaceStore implements SpaceRepository, SpaceSettingsRepository, SpaceMemberRepository {
  spaces: Space[] = [];
  /** Space ids whose members were read with `lock: true`, in order. */
  readonly locked: string[] = [];

  async add(space: Space) {
    this.spaces.push(space);
  }

  async hasPersonalSpace(userId: string) {
    return this.spaces.some((s) => s.kind === "PERSONAL" && s.personalOwnerUserId === userId);
  }

  async listForUser(userId: string): Promise<SpaceSummary[]> {
    return this.spaces.flatMap((s) => {
      const me = s.members.find((m) => m.userId === userId);
      return me
        ? [{ id: s.id, name: s.name, kind: s.kind, currency: s.currency, periodPolicy: s.periodPolicy, role: me.role }]
        : [];
    });
  }

  async findMembership(spaceId: string, userId: string): Promise<SpaceMembership | null> {
    const space = this.spaces.find((s) => s.id === spaceId);
    const me = space?.members.find((m) => m.userId === userId);
    if (!space || !me) return null;
    return {
      spaceId: space.id,
      name: space.name,
      spaceKind: space.kind,
      currency: space.currency,
      periodPolicy: space.periodPolicy,
      memberId: me.id,
      userId,
      role: me.role,
    };
  }

  async updateSettings(spaceId: SpaceId, settings: SpaceSettings) {
    this.update(spaceId, (s) => ({ ...s, ...settings }));
  }

  async listCurrent(spaceId: string, options: { readonly lock?: boolean } = {}): Promise<SpaceMember[]> {
    if (options.lock) this.locked.push(spaceId);
    return this.members(spaceId);
  }

  async addMember(spaceId: string, member: SpaceMember): Promise<AddMemberOutcome> {
    const current = this.members(spaceId);
    if (member.userId !== null && current.some((m) => m.userId === member.userId)) return "alreadyMember";
    if (current.some((m) => m.displayName.toLowerCase() === member.displayName.toLowerCase())) return "nameTaken";
    this.update(spaceId, (s) => ({ ...s, members: [...s.members, member] }));
    return "added";
  }

  async updateRole(spaceId: string, memberId: SpaceMemberId, role: SpaceRole) {
    this.update(spaceId, (s) => ({
      ...s,
      members: s.members.map((m) => (m.id === memberId ? { ...m, role } : m)),
    }));
  }

  /** Test setup: a space as earlier use cases would have left it. */
  seed(space: Space): Space {
    this.spaces.push(space);
    return space;
  }

  members(spaceId: string): SpaceMember[] {
    return [...(this.spaces.find((s) => s.id === spaceId)?.members ?? [])];
  }

  private update(spaceId: string, change: (space: Space) => Space) {
    this.spaces = this.spaces.map((s) => (s.id === spaceId ? change(s) : s));
  }
}

/** `member-<name>`; a USER `u-<name>` with `role`, or a GUEST when `role` is null; joined `minutes` after 2026-10-01 12:00Z. */
export const memberOf = (name: string, role: SpaceRole | null, minutes: number): SpaceMember => ({
  id: `member-${name.toLowerCase()}` as SpaceMemberId,
  kind: role === null ? "GUEST" : "USER",
  userId: role === null ? null : `u-${name.toLowerCase()}`,
  displayName: name,
  role,
  contactEmail: null,
  joinedAt: new Date(Date.UTC(2026, 9, 1, 12, minutes)),
});

/** HU-E1-05 Background, in join order: OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi and the guest Pedro. */
export const HOUSEHOLD_MEMBERS: readonly SpaceMember[] = [
  memberOf("Ana", "OWNER", 0),
  memberOf("Juan", "ADMIN", 1),
  memberOf("Luis", "MEMBER", 2),
  memberOf("Sofi", "VIEWER", 3),
  memberOf("Pedro", null, 4),
];

/** The shared space "Household" (`space-household`, COP, MONTHLY(1)) with the given current members. */
export const householdSpace = (members: readonly SpaceMember[] = HOUSEHOLD_MEMBERS): Space => ({
  id: "space-household" as SpaceId,
  name: "Household",
  kind: "SHARED",
  currency: "COP",
  periodPolicy: { kind: "MONTHLY", day: 1 },
  personalOwnerUserId: null,
  members: [...members],
  createdAt: new Date("2026-10-01T12:00:00Z"),
});
```

- [ ] **Step 2: Write the failing test**

`src/modules/spaces/application/create-space.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSeedDefaultCategories } from "@/modules/categories/application";
import { domainError, err, FixedClock } from "@/shared/kernel";
import { codeOf, memoryTm, sequentialIds, unwrap } from "../../../../tests/support/fakes";
import { InMemoryCategories } from "../../../../tests/support/in-memory-categories";
import { InMemorySpaceStore } from "../../../../tests/support/in-memory-spaces";
import { createCreatePersonalSpace, type SpaceCreatedListener } from "./create-personal-space";
import { createCreateSpace } from "./create-space";

const clock = new FixedClock(new Date("2026-10-13T12:00:00Z"));
const ana = { userId: "u-ana", userName: "Ana", locale: "es" };

const setup = (onCreated?: SpaceCreatedListener) => {
  const spaces = new InMemorySpaceStore();
  const categories = new InMemoryCategories();
  const ids = sequentialIds("id");
  const seed = createSeedDefaultCategories({ categories, ids, clock, tm: memoryTm });
  const listener: SpaceCreatedListener = onCreated ?? ((space, { locale }) => seed({ spaceId: space.id, locale }));
  const createPersonalSpace = createCreatePersonalSpace({ spaces, ids, clock, tm: memoryTm, onCreated: listener });
  return {
    spaces,
    categories,
    createPersonalSpace,
    create: createCreateSpace({ spaces, createPersonalSpace, onCreated: listener, ids, clock, tm: memoryTm }),
  };
};

/** Category names of the group called `group` in the space, in seed order. */
const groupNamed = (categories: InMemoryCategories, spaceId: string, group: string) => {
  const found = categories.groups.find((g) => g.spaceId === spaceId && g.name === group);
  return found ? categories.categories.filter((c) => c.groupId === found.id).map((c) => c.name) : undefined;
};

describe("CreateSpace (HU-E1-04)", () => {
  it("creates Household as a SHARED space with Ana as its only OWNER and seeds default categories", async () => {
    const { create, spaces, categories } = setup();
    const summary = unwrap(await create({ ...ana, kind: "SHARED", name: "Household", currency: "COP" }));
    expect(summary).toEqual({
      id: "id-1",
      name: "Household",
      kind: "SHARED",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
      role: "OWNER",
    });
    expect(spaces.members("id-1")).toEqual([
      expect.objectContaining({ id: "id-2", kind: "USER", userId: "u-ana", displayName: "Ana", role: "OWNER" }),
    ]);
    expect(groupNamed(categories, "id-1", "Vivienda")).toEqual(["Arriendo", "Servicios", "Mantenimiento"]);
    expect(await spaces.listForUser("u-ana")).toEqual([summary]);
  });

  it("seeds English names for a creator whose locale is en (HU-E3-01)", async () => {
    const { create, categories } = setup();
    const flat = unwrap(
      await create({ userId: "u-juan", userName: "Juan", locale: "en", kind: "SHARED", name: "Flat", currency: "COP" }),
    );
    expect(groupNamed(categories, flat.id, "Housing")).toEqual(["Rent", "Utilities", "Maintenance"]);
  });

  it("requires a name", async () => {
    const { create, spaces } = setup();
    expect(codeOf(await create({ ...ana, kind: "SHARED", name: "  ", currency: "COP" }))).toBe("InvalidSpaceName");
    expect(spaces.spaces).toEqual([]);
  });

  it("rejects an unsupported currency", async () => {
    const { create, spaces } = setup();
    expect(codeOf(await create({ ...ana, kind: "SHARED", name: "Household", currency: "XYZ" }))).toBe(
      "UnknownCurrency",
    );
    expect(spaces.spaces).toEqual([]);
  });

  it("refuses another personal space (HU-E1-02)", async () => {
    const { create, createPersonalSpace } = setup();
    unwrap(await createPersonalSpace({ userId: "u-ana", name: "Ana", locale: "es" }));
    expect(codeOf(await create({ ...ana, kind: "PERSONAL" }))).toBe("PersonalSpaceAlreadyExists");
  });

  it("returns the seeding error, so the caller's transaction rolls back", async () => {
    const { create } = setup(async () => err(domainError("SeedFailed")));
    expect(codeOf(await create({ ...ana, kind: "SHARED", name: "Household", currency: "COP" }))).toBe("SeedFailed");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/spaces/application/create-space.test.ts`
Expected: FAIL — `Failed to resolve import "./create-space"`.

- [ ] **Step 4: Implement**

`src/modules/spaces/application/create-space.ts`:

```ts
import { map, ok, type Clock, type IdGenerator, type Result, type TransactionManager } from "@/shared/kernel";
import { createSharedSpace, type Space } from "../domain/space";
import type { CreatePersonalSpace, SpaceCreatedListener } from "./create-personal-space";
import type { SpaceRepository, SpaceSummary } from "./space-repository";

export interface CreateSpaceDeps {
  readonly spaces: SpaceRepository;
  readonly createPersonalSpace: CreatePersonalSpace;
  readonly onCreated: SpaceCreatedListener;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly tm: TransactionManager;
}

interface Creator {
  readonly userId: string;
  readonly userName: string;
  readonly locale: string;
}

export type CreateSpaceInput =
  | (Creator & { readonly kind: "PERSONAL" })
  | (Creator & { readonly kind: "SHARED"; readonly name: string; readonly currency: string });

export type CreateSpace = (input: CreateSpaceInput) => Promise<Result<SpaceSummary>>;

/** The creator always holds OWNER in a space they just created. */
const ownedSummary = (space: Space): SpaceSummary => ({
  id: space.id,
  name: space.name,
  kind: space.kind,
  currency: space.currency,
  periodPolicy: space.periodPolicy,
  role: "OWNER",
});

export const createCreateSpace =
  (deps: CreateSpaceDeps): CreateSpace =>
  async (input) => {
    // HU-E1-02: personal spaces come with sign-up; asking for another one answers PersonalSpaceAlreadyExists.
    if (input.kind === "PERSONAL") {
      return map(
        await deps.createPersonalSpace({ userId: input.userId, name: input.userName, locale: input.locale }),
        ownedSummary,
      );
    }
    return deps.tm.run(async () => {
      const space = createSharedSpace({
        id: deps.ids.next<"Space">(),
        memberId: deps.ids.next<"SpaceMember">(),
        ownerUserId: input.userId,
        ownerName: input.userName,
        name: input.name,
        currency: input.currency,
        now: deps.clock.now(),
      });
      if (!space.ok) return space;
      await deps.spaces.add(space.value);
      // HU-E3-01: default categories in the creator's locale, in the same transaction as the space.
      const reacted = await deps.onCreated(space.value, { locale: input.locale });
      if (!reacted.ok) return reacted;
      return ok(ownedSummary(space.value));
    });
  };
```

In `src/modules/spaces/application/index.ts`, append:

```ts
export { createCreateSpace, type CreateSpace, type CreateSpaceDeps, type CreateSpaceInput } from "./create-space";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/spaces`
Expected: PASS.

- [ ] **Step 6: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (`tests/support` is outside `src/`, so importing the categories application from a spaces test does not touch the boundary rules).

- [ ] **Step 7: Commit**

```bash
git add src/modules/spaces/application/space-member-repository.ts src/modules/spaces/application/create-space.ts src/modules/spaces/application/create-space.test.ts src/modules/spaces/application/index.ts tests/support/in-memory-spaces.ts
git commit -m "feat(spaces): create shared spaces with seeded categories (Refs #13)"
```

---

### Task 4: Spaces — list members and change roles

Implements `ListMembers` and `ChangeMemberRole` of HU-E1-05 (issue #14): any current member lists the current members (guests included, HU-E1-10); only an OWNER changes roles; a guest never gets a role; the last OWNER cannot be demoted. Pins Review Focus 3 at the use-case level.

Decisions:
- Role changes read the space's current members with `lock: true` and re-check the actor's own role on those locked rows, so a role read before a concurrent change committed cannot be used (two owners demoting each other at once leave exactly one OWNER; Task 11 proves it against PostgreSQL).
- An OWNER may grant OWNER (a space may have several owners); an OWNER may demote themselves while another OWNER remains.
- Unknown, malformed or other-space member ids are `MemberNotFound` (the target is looked up among the space's current members, never by a `uuid` query).

**Files:**
- Create: `src/modules/spaces/application/members-deps.ts`, `src/modules/spaces/application/list-members.ts`, `src/modules/spaces/application/change-member-role.ts`
- Modify: `src/modules/spaces/application/index.ts`
- Test: `src/modules/spaces/application/members.test.ts`

**Interfaces:**
- Consumes: `authorizeSpaceAction`, `SpaceAccess`, `createSpaceAccess`, `can` (Task 1); `changeMemberRole`, `SpaceMember`, `SpaceRole`, `Space` (Task 2); `SpaceMemberRepository`, `InMemorySpaceStore`, `HOUSEHOLD_MEMBERS`, `householdSpace` (Task 3); `codeOf`, `fakeSpaceAccess`, `memoryTm`, `membership`, `sequentialIds`, `unwrap` (fakes).
- Produces:
  - `interface MembersDeps { access: SpaceAccess; members: SpaceMemberRepository; ids: IdGenerator; clock: Clock; tm: TransactionManager }`
  - `type ListMembers = (input: { spaceId: string; userId: string }) => Promise<Result<SpaceMember[]>>`; `createListMembers(deps: Pick<MembersDeps, "access" | "members">): ListMembers`
  - `type ChangeMemberRole = (input: { spaceId: string; userId: string; memberId: string; role: SpaceRole }) => Promise<Result<SpaceMember>>`; `createChangeMemberRole(deps: Pick<MembersDeps, "access" | "members" | "tm">): ChangeMemberRole` (`SpaceNotFound`, `InsufficientRole`, `MemberNotFound`, `GuestHasNoRole`, `LastOwnerRequired`)

- [ ] **Step 1: Write the failing test**

`src/modules/spaces/application/members.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
import { codeOf, fakeSpaceAccess, memoryTm, membership, sequentialIds, unwrap } from "../../../../tests/support/fakes";
import { HOUSEHOLD_MEMBERS, householdSpace, InMemorySpaceStore } from "../../../../tests/support/in-memory-spaces";
import type { Space, SpaceMember } from "../domain/space";
import { createChangeMemberRole } from "./change-member-role";
import { createListMembers } from "./list-members";
import type { MembersDeps } from "./members-deps";
import { createSpaceAccess } from "./space-access";

const now = new Date("2026-10-13T12:00:00Z");
const space = "space-household";
const as = (name: string) => ({ spaceId: space, userId: `u-${name}` });

const setup = (seeded: Space = householdSpace()) => {
  const store = new InMemorySpaceStore();
  store.seed(seeded);
  const deps: MembersDeps = {
    access: createSpaceAccess(store),
    members: store,
    ids: sequentialIds("member-new"),
    clock: new FixedClock(now),
    tm: memoryTm,
  };
  return { store, deps, list: createListMembers(deps), changeRole: createChangeMemberRole(deps) };
};
const roleOf = (store: InMemorySpaceStore, name: string) =>
  store.members(space).find((m) => m.displayName === name)?.role;

describe("ListMembers (HU-E1-05, HU-E1-10)", () => {
  it("lists the current members in join order, guests included, to any role", async () => {
    const { list } = setup();
    const members = unwrap(await list(as("sofi")));
    expect(members.map((m) => [m.displayName, m.kind, m.role])).toEqual([
      ["Ana", "USER", "OWNER"],
      ["Juan", "USER", "ADMIN"],
      ["Luis", "USER", "MEMBER"],
      ["Sofi", "USER", "VIEWER"],
      ["Pedro", "GUEST", null],
    ]);
  });

  it("hides the space from non-members", async () => {
    const { list } = setup();
    expect(codeOf(await list(as("marta")))).toBe("SpaceNotFound");
  });
});

describe("ChangeMemberRole (HU-E1-05)", () => {
  it("lets the owner make Luis an ADMIN", async () => {
    const { changeRole, store } = setup();
    const changed = unwrap(await changeRole({ ...as("ana"), memberId: "member-luis", role: "ADMIN" }));
    expect(changed).toMatchObject({ id: "member-luis", displayName: "Luis", role: "ADMIN" });
    expect(roleOf(store, "Luis")).toBe("ADMIN");
    expect(store.locked).toEqual([space]);
  });

  it("refuses to demote the only OWNER", async () => {
    const { changeRole, store } = setup();
    expect(codeOf(await changeRole({ ...as("ana"), memberId: "member-ana", role: "ADMIN" }))).toBe(
      "LastOwnerRequired",
    );
    expect(roleOf(store, "Ana")).toBe("OWNER");
  });

  it("lets an owner step down once another OWNER exists", async () => {
    const { changeRole, store } = setup();
    unwrap(await changeRole({ ...as("ana"), memberId: "member-juan", role: "OWNER" }));
    unwrap(await changeRole({ ...as("ana"), memberId: "member-ana", role: "ADMIN" }));
    expect([roleOf(store, "Ana"), roleOf(store, "Juan")]).toEqual(["ADMIN", "OWNER"]);
  });

  it.each([
    ["Juan (ADMIN) promoting himself to OWNER", "juan", "member-juan", "OWNER"],
    ["Luis (MEMBER) changing Sofi", "luis", "member-sofi", "MEMBER"],
    ["Sofi (VIEWER) promoting herself", "sofi", "member-sofi", "ADMIN"],
  ] as const)("refuses %s with InsufficientRole", async (_case, actor, memberId, role) => {
    const { changeRole, store } = setup();
    expect(codeOf(await changeRole({ ...as(actor), memberId, role }))).toBe("InsufficientRole");
    expect(store.members(space)).toEqual(HOUSEHOLD_MEMBERS);
  });

  it("never gives the guest a role", async () => {
    const { changeRole, store } = setup();
    expect(codeOf(await changeRole({ ...as("ana"), memberId: "member-pedro", role: "MEMBER" }))).toBe(
      "GuestHasNoRole",
    );
    expect(roleOf(store, "Pedro")).toBeNull();
  });

  it("reports unknown and malformed member ids as MemberNotFound", async () => {
    const { changeRole } = setup();
    for (const memberId of ["member-nobody", "not-a-uuid"]) {
      expect(codeOf(await changeRole({ ...as("ana"), memberId, role: "ADMIN" }))).toBe("MemberNotFound");
    }
  });

  it("hides the space from non-members", async () => {
    const { changeRole } = setup();
    expect(codeOf(await changeRole({ ...as("marta"), memberId: "member-luis", role: "ADMIN" }))).toBe(
      "SpaceNotFound",
    );
  });

  it("checks the actor again on the locked rows", async () => {
    // Ana's OWNER role was read before a concurrent change that made her ADMIN committed.
    const demoted = HOUSEHOLD_MEMBERS.map(
      (m): SpaceMember =>
        m.displayName === "Ana" ? { ...m, role: "ADMIN" } : m.displayName === "Juan" ? { ...m, role: "OWNER" } : m,
    );
    const { deps, store } = setup(householdSpace(demoted));
    const stale = createChangeMemberRole({
      ...deps,
      access: fakeSpaceAccess(
        membership({ spaceId: space, memberId: "member-ana", spaceKind: "SHARED", name: "Household" }),
      ),
    });
    expect(codeOf(await stale({ ...as("ana"), memberId: "member-luis", role: "ADMIN" }))).toBe("InsufficientRole");
    expect(roleOf(store, "Luis")).toBe("MEMBER");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/spaces/application/members.test.ts`
Expected: FAIL — `Failed to resolve import "./change-member-role"`.

- [ ] **Step 3: Implement**

`src/modules/spaces/application/members-deps.ts`:

```ts
import type { Clock, IdGenerator, TransactionManager } from "@/shared/kernel";
import type { SpaceAccess } from "./space-access";
import type { SpaceMemberRepository } from "./space-member-repository";

export interface MembersDeps {
  readonly access: SpaceAccess;
  readonly members: SpaceMemberRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly tm: TransactionManager;
}
```

`src/modules/spaces/application/list-members.ts`:

```ts
import { ok, type Result } from "@/shared/kernel";
import type { SpaceMember } from "../domain/space";
import type { MembersDeps } from "./members-deps";
import { authorizeSpaceAction } from "./space-access";

export type ListMembers = (input: { spaceId: string; userId: string }) => Promise<Result<SpaceMember[]>>;

/** HU-E1-05, HU-E1-10: every current member, guests included, in join order; any role may read. */
export const createListMembers =
  (deps: Pick<MembersDeps, "access" | "members">): ListMembers =>
  async ({ spaceId, userId }) => {
    const reader = await authorizeSpaceAction(deps.access, spaceId, userId, "space.read");
    if (!reader.ok) return reader;
    return ok(await deps.members.listCurrent(reader.value.spaceId));
  };
```

`src/modules/spaces/application/change-member-role.ts`:

```ts
import { domainError, err, type Result } from "@/shared/kernel";
import { changeMemberRole } from "../domain/member";
import { can } from "../domain/permissions";
import type { SpaceMember, SpaceRole } from "../domain/space";
import type { MembersDeps } from "./members-deps";
import { authorizeSpaceAction } from "./space-access";

export type ChangeMemberRole = (input: {
  spaceId: string;
  userId: string;
  memberId: string;
  role: SpaceRole;
}) => Promise<Result<SpaceMember>>;

/** HU-E1-05: only owners change roles; guests have no role; a space keeps at least one OWNER. */
export const createChangeMemberRole =
  (deps: Pick<MembersDeps, "access" | "members" | "tm">): ChangeMemberRole =>
  (input) =>
    deps.tm.run(async () => {
      const owner = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "member.changeRole");
      if (!owner.ok) return owner;
      const { spaceId, memberId: actorId } = owner.value;
      // Locked: role changes of one space run one at a time, so two owners demoting each other cannot
      // leave it without an OWNER; the actor's own role is checked again on the locked rows.
      const current = await deps.members.listCurrent(spaceId, { lock: true });
      const actor = current.find((m) => m.id === actorId);
      if (!can(actor?.role ?? null, "member.changeRole")) return err(domainError("InsufficientRole"));
      const changed = changeMemberRole(current, input.memberId, input.role);
      if (!changed.ok) return changed;
      await deps.members.updateRole(spaceId, changed.value.id, input.role);
      return changed;
    });
```

In `src/modules/spaces/application/index.ts`, append:

```ts
export { createChangeMemberRole, type ChangeMemberRole } from "./change-member-role";
export { createListMembers, type ListMembers } from "./list-members";
export type { MembersDeps } from "./members-deps";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/spaces`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/application/members-deps.ts src/modules/spaces/application/list-members.ts src/modules/spaces/application/change-member-role.ts src/modules/spaces/application/members.test.ts src/modules/spaces/application/index.ts
git commit -m "feat(spaces): list members and change roles keeping one owner (Refs #14)"
```

---

### Task 5: Spaces — add guest members

Implements `AddGuestMember` of HU-E1-10 (issue #19): any member with role MEMBER or above adds a guest with a display name and an optional contact email; the guest has no user and no role; the name is unique among current members ignoring case; personal spaces never take guests.

Decision: the contact email is informational only (spec 5.2): it is never matched against users, so it neither creates an account nor lets anyone sign in (Task 16 proves the sign-in side over HTTP). If the database reports the name taken by a concurrent addition (Task 11), the use case answers `MemberNameTaken` like the up-front check.

**Files:**
- Create: `src/modules/spaces/application/add-guest-member.ts`
- Modify: `src/modules/spaces/application/members.test.ts`, `src/modules/spaces/application/index.ts`

**Interfaces:**
- Consumes: `authorizeSpaceAction` (Task 1); `ensureCanAddMember`, `guestMember`, `SpaceMember`, `createPersonalSpace`, `SpaceId`, `SpaceMemberId` (Task 2); `AddMemberOutcome` (Task 3); `MembersDeps` (Task 4).
- Produces: `type AddGuestMember = (input: { spaceId: string; userId: string; displayName: string; contactEmail?: string }) => Promise<Result<SpaceMember>>`; `createAddGuestMember(deps: MembersDeps): AddGuestMember` (`SpaceNotFound`, `InsufficientRole`, `PersonalSpaceNotShareable`, `InvalidMemberName`, `MemberNameTaken`).

- [ ] **Step 1: Write the failing tests**

In `src/modules/spaces/application/members.test.ts`:

1. Replace the line `import type { Space, SpaceMember } from "../domain/space";` with:

```ts
import { createPersonalSpace, type Space, type SpaceId, type SpaceMember, type SpaceMemberId } from "../domain/space";
import { createAddGuestMember } from "./add-guest-member";
import type { AddMemberOutcome } from "./space-member-repository";
```

2. Replace the line

```ts
  return { store, deps, list: createListMembers(deps), changeRole: createChangeMemberRole(deps) };
```

with:

```ts
  return {
    store,
    deps,
    list: createListMembers(deps),
    changeRole: createChangeMemberRole(deps),
    addGuest: createAddGuestMember(deps),
  };
```

3. Append:

```ts
describe("AddGuestMember (HU-E1-10)", () => {
  // Background: OWNER Ana, MEMBER Luis and VIEWER Sofi (Pedro is not a member yet).
  const withoutPedro = () => householdSpace(HOUSEHOLD_MEMBERS.filter((m) => m.displayName !== "Pedro"));

  it("lets a member add a guest with no user and no role", async () => {
    const { addGuest, store } = setup(withoutPedro());
    const pedro = unwrap(await addGuest({ ...as("luis"), displayName: "Pedro", contactEmail: "Pedro@Example.com" }));
    expect(pedro).toEqual({
      id: "member-new-1",
      kind: "GUEST",
      userId: null,
      displayName: "Pedro",
      role: null,
      contactEmail: "pedro@example.com",
      joinedAt: now,
    });
    expect(store.members(space).at(-1)).toEqual(pedro);
  });

  it("lists the guest among the current members", async () => {
    const { addGuest, list } = setup(withoutPedro());
    unwrap(await addGuest({ ...as("luis"), displayName: "Pedro" }));
    const members = unwrap(await list(as("ana")));
    expect(members.map((m) => [m.displayName, m.kind])).toEqual([
      ["Ana", "USER"],
      ["Juan", "USER"],
      ["Luis", "USER"],
      ["Sofi", "USER"],
      ["Pedro", "GUEST"],
    ]);
  });

  it("does not let a viewer add guests", async () => {
    const { addGuest } = setup(withoutPedro());
    expect(codeOf(await addGuest({ ...as("sofi"), displayName: "Pedro" }))).toBe("InsufficientRole");
  });

  it("requires a name unique among current members, ignoring case", async () => {
    const { addGuest } = setup();
    expect(codeOf(await addGuest({ ...as("luis"), displayName: "pedro" }))).toBe("MemberNameTaken");
    expect(codeOf(await addGuest({ ...as("luis"), displayName: "   " }))).toBe("InvalidMemberName");
  });

  it("refuses guests in a personal space", async () => {
    const { addGuest, store } = setup();
    store.seed(
      createPersonalSpace({
        id: "space-ana" as SpaceId,
        memberId: "member-ana-personal" as SpaceMemberId,
        ownerUserId: "u-ana",
        ownerName: "Ana",
        now,
      }),
    );
    expect(codeOf(await addGuest({ spaceId: "space-ana", userId: "u-ana", displayName: "Pedro" }))).toBe(
      "PersonalSpaceNotShareable",
    );
  });

  it("answers MemberNameTaken when a concurrent addition takes the name first", async () => {
    class RacingStore extends InMemorySpaceStore {
      override async addMember(): Promise<AddMemberOutcome> {
        return "nameTaken";
      }
    }
    const store = new RacingStore();
    store.seed(withoutPedro());
    const addGuest = createAddGuestMember({
      access: createSpaceAccess(store),
      members: store,
      ids: sequentialIds("member-new"),
      clock: new FixedClock(now),
      tm: memoryTm,
    });
    expect(codeOf(await addGuest({ ...as("luis"), displayName: "Pedro" }))).toBe("MemberNameTaken");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/spaces/application/members.test.ts`
Expected: FAIL — `Failed to resolve import "./add-guest-member"`.

- [ ] **Step 3: Implement**

`src/modules/spaces/application/add-guest-member.ts`:

```ts
import { domainError, err, type Result } from "@/shared/kernel";
import { guestMember } from "../domain/member";
import { ensureCanAddMember, type SpaceMember } from "../domain/space";
import type { MembersDeps } from "./members-deps";
import { authorizeSpaceAction } from "./space-access";

export type AddGuestMember = (input: {
  spaceId: string;
  userId: string;
  displayName: string;
  contactEmail?: string;
}) => Promise<Result<SpaceMember>>;

/** HU-E1-10, D15: MEMBER or above adds someone without an account; the guest exists only in this space. */
export const createAddGuestMember =
  (deps: MembersDeps): AddGuestMember =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "guest.add");
      if (!writer.ok) return writer;
      const space = writer.value;
      const shareable = ensureCanAddMember({ kind: space.spaceKind });
      if (!shareable.ok) return shareable;
      const guest = guestMember({
        id: deps.ids.next<"SpaceMember">(),
        displayName: input.displayName,
        contactEmail: input.contactEmail ?? null,
        now: deps.clock.now(),
        current: await deps.members.listCurrent(space.spaceId),
      });
      if (!guest.ok) return guest;
      // The database has the last word: a concurrent addition may have taken the name meanwhile.
      const outcome = await deps.members.addMember(space.spaceId, guest.value);
      return outcome === "added" ? guest : err(domainError("MemberNameTaken"));
    });
```

In `src/modules/spaces/application/index.ts`, append:

```ts
export { createAddGuestMember, type AddGuestMember } from "./add-guest-member";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/spaces`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/application/add-guest-member.ts src/modules/spaces/application/members.test.ts src/modules/spaces/application/index.ts
git commit -m "feat(spaces): add guest members (Refs #19)"
```

---

### Task 6: Spaces — the Invitation aggregate

Implements the domain of HU-E1-06 (issue #15) and HU-E1-07 (issue #16): an invitation is bound to one email address (`EMAIL`) or to whoever holds its link (`LINK`), never grants OWNER, expires 7 days after creation, can be revoked while pending, and is accepted under explicit rules. Pins Review Focus 1 at the domain level.

Decisions:
- **Single use:** email invitations are single-use (`ACCEPTED` after the first acceptance); link invitations stay `PENDING` and accept anyone until expiry or revocation (backlog HU-E1-07 technical note; see Self-Review assumption 1).
- **Expiry:** both kinds expire 7 days after creation; an invitation is expired from exactly `createdAt + 7 days` (`now >= expiresAt`). `EXPIRED` is derived on read (`effectiveStatus`), never stored.
- **Order of rejections:** `InvitationRevoked`, then `InvitationAlreadyUsed` (a used email invitation; a new code, 409), then `InvitationExpired`, then `InvitationEmailMismatch` — so a revoked link that is also old says "revoked", and a replay says "already used" even after expiry.
- **Revocation:** pending and expired-but-pending invitations can be revoked; revoking a revoked invitation changes nothing (idempotent); a used email invitation cannot be revoked (`InvitationAlreadyUsed`).
- Emails are trimmed and lower-cased with the domain's `normalizedEmail` (Task 2; HU-E1-01 normalizes users' emails the same way), so binding and matching ignore case.

**Files:**
- Create: `src/modules/spaces/domain/invitation.ts`
- Modify: `src/modules/spaces/application/index.ts`
- Test: `src/modules/spaces/domain/invitation.test.ts`

**Interfaces:**
- Consumes: `SpaceId`, `SpaceRole`, `normalizedEmail` (Task 2); `domainError`, `err`, `ok`, `Id`, `Result` (kernel).
- Produces:
  - `type InvitationId = Id<"Invitation">`, `type InvitationKind = "EMAIL" | "LINK"`, `type InvitationState = "PENDING" | "ACCEPTED" | "REVOKED"`, `type InvitationStatus = InvitationState | "EXPIRED"`, `type InvitableRole = Exclude<SpaceRole, "OWNER">`, `type InvitationTarget = { kind: "EMAIL"; email: string } | { kind: "LINK" }`, `INVITATION_TTL_MS`
  - `interface Invitation { id; spaceId: SpaceId; kind; email: string | null; role: InvitableRole; tokenHash: string; status: InvitationState; createdBy: string; createdAt: Date; expiresAt: Date; acceptedAt: Date | null; acceptedByUserId: string | null; revokedAt: Date | null }`
  - `issueInvitation(input: { id: InvitationId; spaceId: SpaceId; target: InvitationTarget; role: SpaceRole; tokenHash: string; createdBy: string; now: Date }): Result<Invitation>` (`InvalidInvitationRole`, `InvalidEmail`)
  - `effectiveStatus(invitation: Invitation, now: Date): InvitationStatus`
  - `ensureAcceptable(invitation: Invitation, acceptor: { email: string; now: Date }): Result<void>` (`InvitationRevoked`, `InvitationAlreadyUsed`, `InvitationExpired`, `InvitationEmailMismatch`)
  - `markAccepted(invitation: Invitation, userId: string, now: Date): Invitation` (returns the same object for links)
  - `revokeInvitation(invitation: Invitation, now: Date): Result<Invitation>` (`InvitationAlreadyUsed`; the same object when already revoked)

- [ ] **Step 1: Write the failing test**

`src/modules/spaces/domain/invitation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Result } from "@/shared/kernel";
import {
  effectiveStatus,
  ensureAcceptable,
  issueInvitation,
  markAccepted,
  revokeInvitation,
  type Invitation,
  type InvitationId,
  type InvitationTarget,
} from "./invitation";
import type { SpaceId, SpaceRole } from "./space";

const created = new Date("2026-10-12T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (ms: number) => new Date(created.getTime() + ms);
const code = (result: Result<unknown>) => (result.ok ? "ok" : result.error.code);
const issue = (target: InvitationTarget, role: SpaceRole = "MEMBER"): Result<Invitation> =>
  issueInvitation({
    id: "inv-1" as InvitationId,
    spaceId: "space-household" as SpaceId,
    target,
    role,
    tokenHash: "hash(token-1)",
    createdBy: "u-ana",
    now: created,
  });
const valid = (target: InvitationTarget): Invitation => {
  const result = issue(target);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
};
const toJuan = valid({ kind: "EMAIL", email: " Juan@Example.com " });
const link = valid({ kind: "LINK" });
const revoked = (invitation: Invitation): Invitation => {
  const result = revokeInvitation(invitation, at(DAY));
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
};

describe("issuing invitations (HU-E1-06)", () => {
  it("binds an email invitation to the lower-cased address and lets it expire 7 days later", () => {
    expect(toJuan).toEqual({
      id: "inv-1",
      spaceId: "space-household",
      kind: "EMAIL",
      email: "juan@example.com",
      role: "MEMBER",
      tokenHash: "hash(token-1)",
      status: "PENDING",
      createdBy: "u-ana",
      createdAt: created,
      expiresAt: new Date("2026-10-19T12:00:00Z"),
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
    });
  });

  it("binds a link invitation to no address", () => {
    expect(link).toMatchObject({ kind: "LINK", email: null, status: "PENDING" });
  });

  it("never grants OWNER", () => {
    expect(code(issue({ kind: "LINK" }, "OWNER"))).toBe("InvalidInvitationRole");
    expect(code(issue({ kind: "EMAIL", email: "juan@example.com" }, "OWNER"))).toBe("InvalidInvitationRole");
  });

  it("needs an address for an email invitation", () => {
    expect(code(issue({ kind: "EMAIL", email: "   " }))).toBe("InvalidEmail");
  });
});

describe("expiry (Review Focus 1)", () => {
  it("is pending until just before 7 days and expired from exactly 7 days", () => {
    expect(effectiveStatus(toJuan, at(7 * DAY - 1))).toBe("PENDING");
    expect(effectiveStatus(toJuan, at(7 * DAY))).toBe("EXPIRED");
  });

  it("never reports accepted or revoked invitations as expired", () => {
    expect(effectiveStatus(markAccepted(toJuan, "u-juan", at(DAY)), at(30 * DAY))).toBe("ACCEPTED");
    expect(effectiveStatus(revoked(toJuan), at(30 * DAY))).toBe("REVOKED");
  });
});

describe("accepting (HU-E1-07)", () => {
  it("lets the invited address accept, ignoring case", () => {
    expect(code(ensureAcceptable(toJuan, { email: "JUAN@example.com", now: at(DAY) }))).toBe("ok");
  });

  it("rejects an invitation created 8 days ago", () => {
    expect(code(ensureAcceptable(toJuan, { email: "juan@example.com", now: at(8 * DAY) }))).toBe(
      "InvitationExpired",
    );
  });

  it("rejects another address for an email-bound invitation", () => {
    expect(code(ensureAcceptable(toJuan, { email: "luis@example.com", now: at(DAY) }))).toBe(
      "InvitationEmailMismatch",
    );
  });

  it("rejects a revoked invitation, also once it would have expired", () => {
    expect(code(ensureAcceptable(revoked(toJuan), { email: "juan@example.com", now: at(DAY) }))).toBe(
      "InvitationRevoked",
    );
    expect(code(ensureAcceptable(revoked(link), { email: "x@example.com", now: at(8 * DAY) }))).toBe(
      "InvitationRevoked",
    );
  });

  it("uses up an email invitation, so a replay is rejected", () => {
    const accepted = markAccepted(toJuan, "u-juan", at(DAY));
    expect(accepted).toMatchObject({ status: "ACCEPTED", acceptedAt: at(DAY), acceptedByUserId: "u-juan" });
    expect(code(ensureAcceptable(accepted, { email: "juan@example.com", now: at(DAY) }))).toBe(
      "InvitationAlreadyUsed",
    );
  });

  it("keeps a link invitation usable by anyone until it expires", () => {
    expect(markAccepted(link, "u-juan", at(DAY))).toBe(link);
    expect(code(ensureAcceptable(link, { email: "anyone@example.com", now: at(DAY) }))).toBe("ok");
    expect(code(ensureAcceptable(link, { email: "anyone@example.com", now: at(7 * DAY) }))).toBe(
      "InvitationExpired",
    );
  });
});

describe("revoking (HU-E1-06)", () => {
  it("revokes a pending invitation", () => {
    expect(revoked(toJuan)).toMatchObject({ status: "REVOKED", revokedAt: at(DAY) });
  });

  it("changes nothing when revoked twice", () => {
    const once = revoked(toJuan);
    expect(revokeInvitation(once, at(2 * DAY))).toEqual({ ok: true, value: once });
  });

  it("cannot revoke a used email invitation", () => {
    expect(code(revokeInvitation(markAccepted(toJuan, "u-juan", at(DAY)), at(2 * DAY)))).toBe(
      "InvitationAlreadyUsed",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/spaces/domain/invitation.test.ts`
Expected: FAIL — `Failed to resolve import "./invitation"`.

- [ ] **Step 3: Implement**

`src/modules/spaces/domain/invitation.ts`:

```ts
import { domainError, err, ok, type Id, type Result } from "@/shared/kernel";
import { normalizedEmail } from "./member";
import type { SpaceId, SpaceRole } from "./space";

export type InvitationId = Id<"Invitation">;
export type InvitationKind = "EMAIL" | "LINK";
/** Stored lifecycle; EXPIRED is derived from expiresAt on read (effectiveStatus). */
export type InvitationState = "PENDING" | "ACCEPTED" | "REVOKED";
export type InvitationStatus = InvitationState | "EXPIRED";
/** HU-E1-06: invitations never grant OWNER. */
export type InvitableRole = Exclude<SpaceRole, "OWNER">;
/** Who may accept: one email address, or anyone holding the link. */
export type InvitationTarget = { readonly kind: "EMAIL"; readonly email: string } | { readonly kind: "LINK" };

/** HU-E1-06: invitations expire 7 days after creation. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface Invitation {
  readonly id: InvitationId;
  readonly spaceId: SpaceId;
  readonly kind: InvitationKind;
  /** Trimmed and lower-cased; set only for EMAIL invitations, which only that address can accept. */
  readonly email: string | null;
  readonly role: InvitableRole;
  /** SHA-256 of the bearer token; the token itself is never stored (HU-E1-06). */
  readonly tokenHash: string;
  readonly status: InvitationState;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly acceptedByUserId: string | null;
  readonly revokedAt: Date | null;
}

/** HU-E1-06: a pending invitation for one address or for a shareable link, valid 7 days. */
export const issueInvitation = (input: {
  id: InvitationId;
  spaceId: SpaceId;
  target: InvitationTarget;
  role: SpaceRole;
  tokenHash: string;
  createdBy: string;
  now: Date;
}): Result<Invitation> => {
  const { role, target } = input;
  if (role === "OWNER") return err(domainError("InvalidInvitationRole"));
  let email: string | null = null;
  if (target.kind === "EMAIL") {
    email = normalizedEmail(target.email);
    if (email === "") return err(domainError("InvalidEmail"));
  }
  const invitation: Invitation = {
    id: input.id,
    spaceId: input.spaceId,
    kind: target.kind,
    email,
    role,
    tokenHash: input.tokenHash,
    status: "PENDING",
    createdBy: input.createdBy,
    createdAt: input.now,
    expiresAt: new Date(input.now.getTime() + INVITATION_TTL_MS),
    acceptedAt: null,
    acceptedByUserId: null,
    revokedAt: null,
  };
  return ok(invitation);
};

/** A pending invitation is EXPIRED from exactly its expiry instant on. */
export const effectiveStatus = (invitation: Invitation, now: Date): InvitationStatus =>
  invitation.status === "PENDING" && now.getTime() >= invitation.expiresAt.getTime()
    ? "EXPIRED"
    : invitation.status;

/** HU-E1-07: what keeps `acceptor` from accepting; revocation and use are reported before expiry. */
export const ensureAcceptable = (
  invitation: Invitation,
  acceptor: { readonly email: string; readonly now: Date },
): Result<void> => {
  if (invitation.status === "REVOKED") return err(domainError("InvitationRevoked"));
  if (invitation.status === "ACCEPTED") return err(domainError("InvitationAlreadyUsed"));
  if (effectiveStatus(invitation, acceptor.now) === "EXPIRED") return err(domainError("InvitationExpired"));
  if (invitation.email !== null && invitation.email !== normalizedEmail(acceptor.email)) {
    return err(domainError("InvitationEmailMismatch"));
  }
  return ok(undefined);
};

/** HU-E1-07: email invitations are single-use; link invitations stay valid until expiry or revocation. */
export const markAccepted = (invitation: Invitation, userId: string, now: Date): Invitation =>
  invitation.kind === "EMAIL"
    ? { ...invitation, status: "ACCEPTED", acceptedAt: now, acceptedByUserId: userId }
    : invitation;

/** HU-E1-06: revoke a pending (or expired) invitation; revoking twice changes nothing. */
export const revokeInvitation = (invitation: Invitation, now: Date): Result<Invitation> => {
  if (invitation.status === "REVOKED") return ok(invitation);
  if (invitation.status === "ACCEPTED") return err(domainError("InvitationAlreadyUsed"));
  const revoked: Invitation = { ...invitation, status: "REVOKED", revokedAt: now };
  return ok(revoked);
};
```

In `src/modules/spaces/application/index.ts`, append:

```ts
export type {
  InvitableRole,
  Invitation,
  InvitationId,
  InvitationKind,
  InvitationState,
  InvitationStatus,
  InvitationTarget,
} from "../domain/invitation";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project unit src/modules/spaces/domain`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/domain/invitation.ts src/modules/spaces/domain/invitation.test.ts src/modules/spaces/application/index.ts
git commit -m "feat(spaces): add the invitation aggregate with expiry, binding and revocation (Refs #15, Refs #16)"
```

---

### Task 7: Spaces — CreateInvitation and RevokeInvitation

Implements the use cases of HU-E1-06 (issue #15): OWNER or ADMIN creates an email invitation (bound to the address, emailed when delivery is available) or a link invitation (its URL carries only the token), never for OWNER, never for an address that already belongs to a current member, never in a personal space; OWNER or ADMIN revokes a pending invitation.

Decisions:
- **Tokens:** the `InvitationTokens` port issues a URL-safe token and its hash; only the hash is stored (the adapter in Task 12 uses 256 random bits and SHA-256). The response carries the invitation URL built by the composition root from the token (`<BETTER_AUTH_URL>/invitations/<token>`, the web page of HU-E9-05), so the URL contains only the token.
- **Email delivery:** the `EmailSender` port sends after the database transaction commits, so a slow or failing mail server never holds or undoes the invitation; the response says whether it was sent (`emailSent`). v1 ships no SMTP adapter (no new dependencies), so the composition root binds a disabled sender (`emailSent: false`) and the inviter shares the returned URL; the email binding (only that address can accept) applies either way. See Self-Review assumption 2.
- **AlreadyMember:** the invitee's address is resolved to a registered user through the `RegisteredUsers` port (bound to the identity adapter in Task 14); if that user is a current member, the invitation is refused. Link invitations name nobody, so they are never refused this way (accepting one as a member answers `AlreadyMember`, Task 8).
- Several pending invitations for the same address are allowed (resending is creating a new one); there is no listing endpoint in this plan (the web screens of HU-E9-05 add it).
- Revoking reads the invitation `FOR UPDATE` (Task 12), so it serializes with a concurrent acceptance.

**Files:**
- Create: `src/modules/spaces/application/invitation-repository.ts`, `src/modules/spaces/application/invitation-ports.ts`, `src/modules/spaces/application/invitation-view.ts`, `src/modules/spaces/application/create-invitation.ts`, `src/modules/spaces/application/revoke-invitation.ts`
- Modify: `src/modules/spaces/application/index.ts`, `tests/support/in-memory-spaces.ts`
- Test: `src/modules/spaces/application/invitations.test.ts`

**Interfaces:**
- Consumes: `authorizeSpaceAction`, `SpaceAccess`, `createSpaceAccess` (Task 1); `ensureCanAddMember`, `createPersonalSpace` (Task 2); `SpaceMemberRepository`, `InMemorySpaceStore`, `householdSpace` (Task 3); `issueInvitation`, `revokeInvitation`, `effectiveStatus`, `Invitation`, `InvitationTarget`, `InvitationKind`, `InvitationStatus`, `InvitableRole` (Task 6); `memoryTm`, `sequentialIds`, `codeOf`, `unwrap` (fakes).
- Produces:
  - `interface InvitationRepository { add(invitation): Promise<void>; findForUpdate(spaceId: string, invitationId: string): Promise<Invitation | null>; findByTokenHashForUpdate(tokenHash: string): Promise<Invitation | null>; save(invitation): Promise<void> }`
  - `interface IssuedToken { token; hash }`, `interface InvitationTokens { issue(): IssuedToken; hash(token: string): string }`, `interface InvitationEmail { to; spaceName; url }`, `interface EmailSender { send(email: InvitationEmail): Promise<boolean> }`, `interface RegisteredUsers { idByEmail(email: string): Promise<string | null> }`
  - `interface InvitationsDeps { access; members: SpaceMemberRepository; invitations: InvitationRepository; tokens: InvitationTokens; emailSender: EmailSender; users: RegisteredUsers; invitationUrl: (token: string) => string; ids; clock; tm }`
  - `interface InvitationView { id; spaceId; kind; email; role; status: InvitationStatus; createdAt; expiresAt }`, `toInvitationView(invitation: Invitation, now: Date): InvitationView`
  - `type CreateInvitationInput = { spaceId; userId; role: SpaceRole; target: InvitationTarget }`, `interface CreatedInvitation { invitation: InvitationView; url: string; emailSent: boolean }`, `type CreateInvitation = (input) => Promise<Result<CreatedInvitation>>`, `createCreateInvitation(deps: InvitationsDeps)` (`SpaceNotFound`, `InsufficientRole`, `PersonalSpaceNotShareable`, `InvalidInvitationRole`, `InvalidEmail`, `AlreadyMember`)
  - `type RevokeInvitation = (input: { spaceId; userId; invitationId: string }) => Promise<Result<InvitationView>>`, `createRevokeInvitation(deps: Pick<InvitationsDeps, "access" | "invitations" | "clock" | "tm">)` (`SpaceNotFound`, `InsufficientRole`, `InvitationNotFound`, `InvitationAlreadyUsed`)
  - `tests/support/in-memory-spaces.ts`: `InMemoryInvitations` (with `locked: string[]`), `fakeTokens()` (`token-<n>` / `hash(token-<n>)`), `RecordingEmailSender` (`"sent" | "disabled" | "throws"`), `registeredUsers(byEmail)`, `SettableClock`, `invitationsWorld(options)`.

- [ ] **Step 1: Write the ports and the view**

`src/modules/spaces/application/invitation-repository.ts`:

```ts
import type { Invitation } from "../domain/invitation";

export interface InvitationRepository {
  add(invitation: Invitation): Promise<void>;
  /** The invitation of that space, locked until the transaction ends; null for unknown, foreign or malformed ids. */
  findForUpdate(spaceId: string, invitationId: string): Promise<Invitation | null>;
  /** The invitation whose token hashes to `tokenHash`, locked until the transaction ends; null when there is none. */
  findByTokenHashForUpdate(tokenHash: string): Promise<Invitation | null>;
  /** Persists status, acceptedAt, acceptedByUserId and revokedAt. */
  save(invitation: Invitation): Promise<void>;
}
```

`src/modules/spaces/application/invitation-ports.ts`:

```ts
import type { Clock, IdGenerator, TransactionManager } from "@/shared/kernel";
import type { InvitationRepository } from "./invitation-repository";
import type { SpaceAccess } from "./space-access";
import type { SpaceMemberRepository } from "./space-member-repository";

/** A bearer token and the hash that is stored instead of it (HU-E1-06). */
export interface IssuedToken {
  readonly token: string;
  readonly hash: string;
}

export interface InvitationTokens {
  /** A URL-safe token with at least 128 bits of randomness, and its hash. */
  issue(): IssuedToken;
  hash(token: string): string;
}

export interface InvitationEmail {
  readonly to: string;
  readonly spaceName: string;
  readonly url: string;
}

/** HU-E1-06 `EmailSender`: sends invitation emails; resolves false when delivery is disabled or failed. */
export interface EmailSender {
  send(email: InvitationEmail): Promise<boolean>;
}

/** Registered users by email; bound to the identity module by the composition root. */
export interface RegisteredUsers {
  idByEmail(email: string): Promise<string | null>;
}

export interface InvitationsDeps {
  readonly access: SpaceAccess;
  readonly members: SpaceMemberRepository;
  readonly invitations: InvitationRepository;
  readonly tokens: InvitationTokens;
  readonly emailSender: EmailSender;
  readonly users: RegisteredUsers;
  /** The web URL that carries only the token (HU-E1-06), e.g. https://hearth.example/invitations/<token>. */
  readonly invitationUrl: (token: string) => string;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly tm: TransactionManager;
}
```

`src/modules/spaces/application/invitation-view.ts`:

```ts
import {
  effectiveStatus,
  type InvitableRole,
  type Invitation,
  type InvitationKind,
  type InvitationStatus,
} from "../domain/invitation";
import type { SpaceId } from "../domain/space";

/** What clients see of an invitation: never its token hash, with EXPIRED derived at `now`. */
export interface InvitationView {
  readonly id: string;
  readonly spaceId: SpaceId;
  readonly kind: InvitationKind;
  readonly email: string | null;
  readonly role: InvitableRole;
  readonly status: InvitationStatus;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export const toInvitationView = (invitation: Invitation, now: Date): InvitationView => ({
  id: invitation.id,
  spaceId: invitation.spaceId,
  kind: invitation.kind,
  email: invitation.email,
  role: invitation.role,
  status: effectiveStatus(invitation, now),
  createdAt: invitation.createdAt,
  expiresAt: invitation.expiresAt,
});
```

In `src/modules/spaces/application/index.ts`, append:

```ts
export type { InvitationRepository } from "./invitation-repository";
export type {
  EmailSender,
  InvitationEmail,
  InvitationsDeps,
  InvitationTokens,
  IssuedToken,
  RegisteredUsers,
} from "./invitation-ports";
export { toInvitationView, type InvitationView } from "./invitation-view";
```

- [ ] **Step 2: Extend the in-memory doubles**

In `tests/support/in-memory-spaces.ts`, replace the whole import block at the top of the file (from the first line `import type {` to the line `} from "@/modules/spaces/application";`) with:

```ts
import {
  createSpaceAccess,
  type AddMemberOutcome,
  type EmailSender,
  type Invitation,
  type InvitationEmail,
  type InvitationRepository,
  type InvitationsDeps,
  type InvitationTokens,
  type RegisteredUsers,
  type Space,
  type SpaceId,
  type SpaceMember,
  type SpaceMemberId,
  type SpaceMemberRepository,
  type SpaceMembership,
  type SpaceRepository,
  type SpaceRole,
  type SpaceSettings,
  type SpaceSettingsRepository,
  type SpaceSummary,
} from "@/modules/spaces/application";
import { createPersonalSpace } from "@/modules/spaces/domain/space";
import type { Clock } from "@/shared/kernel";
import { memoryTm, sequentialIds } from "./fakes";
```

and append to the same file:

```ts
export class InMemoryInvitations implements InvitationRepository {
  rows: Invitation[] = [];
  /** Ids of the invitations read for update, in order. */
  readonly locked: string[] = [];

  async add(invitation: Invitation) {
    this.rows.push(invitation);
  }

  async findForUpdate(spaceId: string, invitationId: string) {
    return this.lock(this.rows.find((i) => i.spaceId === spaceId && i.id === invitationId));
  }

  async findByTokenHashForUpdate(tokenHash: string) {
    return this.lock(this.rows.find((i) => i.tokenHash === tokenHash));
  }

  async save(invitation: Invitation) {
    this.rows = this.rows.map((i) => (i.id === invitation.id ? invitation : i));
  }

  private lock(found: Invitation | undefined): Invitation | null {
    if (!found) return null;
    this.locked.push(found.id);
    return found;
  }
}

/** Deterministic tokens `token-1`, `token-2`, …; the hash of a token is `hash(<token>)`. */
export const fakeTokens = (): InvitationTokens => {
  let n = 0;
  return {
    issue: () => {
      const token = `token-${++n}`;
      return { token, hash: `hash(${token})` };
    },
    hash: (token) => `hash(${token})`,
  };
};

/** Records every email; "disabled" resolves false like the v1 composition, "throws" fails like a dead SMTP server. */
export class RecordingEmailSender implements EmailSender {
  readonly sent: InvitationEmail[] = [];
  constructor(private readonly outcome: "sent" | "disabled" | "throws" = "sent") {}

  async send(email: InvitationEmail): Promise<boolean> {
    if (this.outcome === "throws") throw new Error("mail server unavailable");
    this.sent.push(email);
    return this.outcome === "sent";
  }
}

export const registeredUsers = (byEmail: Record<string, string>): RegisteredUsers => {
  const users = new Map(Object.entries(byEmail));
  return { idByEmail: async (email) => users.get(email) ?? null };
};

export class SettableClock implements Clock {
  constructor(private instant: Date) {}

  now(): Date {
    return new Date(this.instant);
  }

  set(instant: Date): void {
    this.instant = instant;
  }
}

/**
 * "Household" (`space-household`, members as given, HU-E1-05 Background by default) plus Ana's personal
 * space (`space-ana`), with in-memory invitation adapters; the clock starts at 2026-10-12T12:00:00Z and
 * invitation URLs are `https://hearth.test/invitations/<token>`.
 */
export const invitationsWorld = (
  options: {
    members?: readonly SpaceMember[];
    store?: InMemorySpaceStore;
    emailSender?: RecordingEmailSender;
    users?: Record<string, string>;
  } = {},
) => {
  const store = options.store ?? new InMemorySpaceStore();
  store.seed(householdSpace(options.members));
  store.seed(
    createPersonalSpace({
      id: "space-ana" as SpaceId,
      memberId: "member-ana-personal" as SpaceMemberId,
      ownerUserId: "u-ana",
      ownerName: "Ana",
      now: new Date("2026-10-01T12:00:00Z"),
    }),
  );
  const invitations = new InMemoryInvitations();
  const emailSender = options.emailSender ?? new RecordingEmailSender();
  const clock = new SettableClock(new Date("2026-10-12T12:00:00Z"));
  const deps: InvitationsDeps = {
    access: createSpaceAccess(store),
    members: store,
    invitations,
    tokens: fakeTokens(),
    emailSender,
    users: registeredUsers(options.users ?? {}),
    invitationUrl: (token) => `https://hearth.test/invitations/${token}`,
    ids: sequentialIds("id"),
    clock,
    tm: memoryTm,
  };
  return { store, invitations, emailSender, clock, deps };
};
```

- [ ] **Step 3: Write the failing test**

`src/modules/spaces/application/invitations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { invitationsWorld, RecordingEmailSender } from "../../../../tests/support/in-memory-spaces";
import { createCreateInvitation } from "./create-invitation";
import { createRevokeInvitation } from "./revoke-invitation";

const space = "space-household";
const as = (name: string) => ({ spaceId: space, userId: `u-${name}` });
const toJuan = { kind: "EMAIL" as const, email: "juan@example.com" };

describe("CreateInvitation (HU-E1-06)", () => {
  it("creates a pending email invitation bound to the address, valid 7 days, and emails its link", async () => {
    const { deps, invitations, emailSender } = invitationsWorld();
    const created = unwrap(
      await createCreateInvitation(deps)({
        ...as("ana"),
        role: "MEMBER",
        target: { kind: "EMAIL", email: "Juan@Example.com" },
      }),
    );
    expect(created).toEqual({
      invitation: {
        id: "id-1",
        spaceId: space,
        kind: "EMAIL",
        email: "juan@example.com",
        role: "MEMBER",
        status: "PENDING",
        createdAt: new Date("2026-10-12T12:00:00Z"),
        expiresAt: new Date("2026-10-19T12:00:00Z"),
      },
      url: "https://hearth.test/invitations/token-1",
      emailSent: true,
    });
    expect(invitations.rows).toEqual([
      expect.objectContaining({ id: "id-1", tokenHash: "hash(token-1)", createdBy: "u-ana" }),
    ]);
    expect(emailSender.sent).toEqual([
      { to: "juan@example.com", spaceName: "Household", url: "https://hearth.test/invitations/token-1" },
    ]);
  });

  it("creates link invitations whose URLs carry only distinct tokens and sends no email", async () => {
    const { deps, invitations, emailSender } = invitationsWorld();
    const create = createCreateInvitation(deps);
    const first = unwrap(await create({ ...as("ana"), role: "MEMBER", target: { kind: "LINK" } }));
    const second = unwrap(await create({ ...as("ana"), role: "VIEWER", target: { kind: "LINK" } }));
    expect(first).toMatchObject({
      invitation: { kind: "LINK", email: null, role: "MEMBER", status: "PENDING" },
      url: "https://hearth.test/invitations/token-1",
      emailSent: false,
    });
    expect(second.url).toBe("https://hearth.test/invitations/token-2");
    expect(invitations.rows.map((i) => i.tokenHash)).toEqual(["hash(token-1)", "hash(token-2)"]);
    expect(emailSender.sent).toEqual([]);
  });

  it("never grants OWNER", async () => {
    const { deps, invitations } = invitationsWorld();
    expect(codeOf(await createCreateInvitation(deps)({ ...as("ana"), role: "OWNER", target: toJuan }))).toBe(
      "InvalidInvitationRole",
    );
    expect(invitations.rows).toEqual([]);
  });

  it("rejects the address of a current member", async () => {
    const { deps, invitations } = invitationsWorld({ users: { "juan@example.com": "u-juan" } });
    expect(codeOf(await createCreateInvitation(deps)({ ...as("ana"), role: "MEMBER", target: toJuan }))).toBe(
      "AlreadyMember",
    );
    expect(invitations.rows).toEqual([]);
  });

  it("invites a registered user who is not a member", async () => {
    const { deps } = invitationsWorld({ users: { "marta@example.com": "u-marta" } });
    const result = await createCreateInvitation(deps)({
      ...as("ana"),
      role: "VIEWER",
      target: { kind: "EMAIL", email: "marta@example.com" },
    });
    expect(codeOf(result)).toBe("ok");
  });

  it("lets admins invite but not members (HU-E1-05)", async () => {
    const { deps } = invitationsWorld();
    const create = createCreateInvitation(deps);
    expect(codeOf(await create({ ...as("juan"), role: "MEMBER", target: { kind: "LINK" } }))).toBe("ok");
    expect(codeOf(await create({ ...as("luis"), role: "MEMBER", target: { kind: "LINK" } }))).toBe(
      "InsufficientRole",
    );
  });

  it("refuses personal spaces (HU-E1-02)", async () => {
    const { deps } = invitationsWorld();
    const result = await createCreateInvitation(deps)({
      spaceId: "space-ana",
      userId: "u-ana",
      role: "MEMBER",
      target: toJuan,
    });
    expect(codeOf(result)).toBe("PersonalSpaceNotShareable");
  });

  it("keeps the invitation when the email cannot be sent", async () => {
    const { deps, invitations } = invitationsWorld({ emailSender: new RecordingEmailSender("throws") });
    const created = unwrap(await createCreateInvitation(deps)({ ...as("ana"), role: "MEMBER", target: toJuan }));
    expect(created.emailSent).toBe(false);
    expect(invitations.rows).toHaveLength(1);
  });

  it("reports emailSent false when delivery is disabled", async () => {
    const { deps } = invitationsWorld({ emailSender: new RecordingEmailSender("disabled") });
    const created = unwrap(await createCreateInvitation(deps)({ ...as("ana"), role: "MEMBER", target: toJuan }));
    expect(created).toMatchObject({ url: "https://hearth.test/invitations/token-1", emailSent: false });
  });

  it("hides the space from non-members", async () => {
    const { deps } = invitationsWorld();
    expect(codeOf(await createCreateInvitation(deps)({ ...as("marta"), role: "MEMBER", target: toJuan }))).toBe(
      "SpaceNotFound",
    );
  });
});

describe("RevokeInvitation (HU-E1-06)", () => {
  const pending = async () => {
    const world = invitationsWorld();
    const created = unwrap(await createCreateInvitation(world.deps)({ ...as("ana"), role: "MEMBER", target: toJuan }));
    return { ...world, id: created.invitation.id, revoke: createRevokeInvitation(world.deps) };
  };

  it("revokes a pending invitation", async () => {
    const { revoke, id, invitations, clock } = await pending();
    clock.set(new Date("2026-10-13T08:00:00Z"));
    expect(unwrap(await revoke({ ...as("ana"), invitationId: id })).status).toBe("REVOKED");
    expect(invitations.rows[0]).toMatchObject({ status: "REVOKED", revokedAt: new Date("2026-10-13T08:00:00Z") });
    expect(invitations.locked).toEqual([id]);
  });

  it("changes nothing when revoked twice", async () => {
    const { revoke, id, invitations } = await pending();
    unwrap(await revoke({ ...as("ana"), invitationId: id }));
    const before = invitations.rows[0];
    expect(unwrap(await revoke({ ...as("juan"), invitationId: id })).status).toBe("REVOKED");
    expect(invitations.rows[0]).toBe(before);
  });

  it("cannot revoke a used email invitation", async () => {
    const { revoke, id, invitations } = await pending();
    invitations.rows = invitations.rows.map((i) => ({
      ...i,
      status: "ACCEPTED" as const,
      acceptedAt: new Date("2026-10-12T13:00:00Z"),
      acceptedByUserId: "u-juan",
    }));
    expect(codeOf(await revoke({ ...as("ana"), invitationId: id }))).toBe("InvitationAlreadyUsed");
  });

  it("reports unknown ids and invitations of other spaces as InvitationNotFound", async () => {
    const { revoke, id } = await pending();
    expect(codeOf(await revoke({ ...as("ana"), invitationId: "id-999" }))).toBe("InvitationNotFound");
    expect(codeOf(await revoke({ spaceId: "space-ana", userId: "u-ana", invitationId: id }))).toBe(
      "InvitationNotFound",
    );
  });

  it("lets only owners and admins revoke", async () => {
    const { revoke, id } = await pending();
    expect(codeOf(await revoke({ ...as("luis"), invitationId: id }))).toBe("InsufficientRole");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/spaces/application/invitations.test.ts`
Expected: FAIL — `Failed to resolve import "./create-invitation"`.

- [ ] **Step 5: Implement**

`src/modules/spaces/application/create-invitation.ts`:

```ts
import { domainError, err, ok, type Result } from "@/shared/kernel";
import { issueInvitation, type InvitationTarget } from "../domain/invitation";
import { ensureCanAddMember, type SpaceRole } from "../domain/space";
import type { InvitationsDeps } from "./invitation-ports";
import { toInvitationView, type InvitationView } from "./invitation-view";
import { authorizeSpaceAction } from "./space-access";

export interface CreateInvitationInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly role: SpaceRole;
  readonly target: InvitationTarget;
}

export interface CreatedInvitation {
  readonly invitation: InvitationView;
  /** Carries only the token; shown once, since only its hash is stored. */
  readonly url: string;
  readonly emailSent: boolean;
}

export type CreateInvitation = (input: CreateInvitationInput) => Promise<Result<CreatedInvitation>>;

/** HU-E1-06: OWNER or ADMIN invites by email (bound to that address) or by shareable link. */
export const createCreateInvitation =
  (deps: InvitationsDeps): CreateInvitation =>
  async (input) => {
    const created = await deps.tm.run(async () => {
      const manager = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "member.invite");
      if (!manager.ok) return manager;
      const space = manager.value;
      const shareable = ensureCanAddMember({ kind: space.spaceKind });
      if (!shareable.ok) return shareable;
      const token = deps.tokens.issue();
      const invitation = issueInvitation({
        id: deps.ids.next<"Invitation">(),
        spaceId: space.spaceId,
        target: input.target,
        role: input.role,
        tokenHash: token.hash,
        createdBy: input.userId,
        now: deps.clock.now(),
      });
      if (!invitation.ok) return invitation;
      const { email } = invitation.value;
      if (email !== null) {
        const invitee = await deps.users.idByEmail(email);
        const current = await deps.members.listCurrent(space.spaceId);
        if (invitee !== null && current.some((m) => m.userId === invitee)) return err(domainError("AlreadyMember"));
      }
      await deps.invitations.add(invitation.value);
      return ok({ invitation: invitation.value, token: token.token, spaceName: space.name });
    });
    if (!created.ok) return created;
    const { invitation, token, spaceName } = created.value;
    const url = deps.invitationUrl(token);
    // Sent after the commit, so a slow or failing mail server never holds or undoes the invitation.
    const emailSent =
      invitation.email === null
        ? false
        : await deps.emailSender.send({ to: invitation.email, spaceName, url }).catch(() => false);
    return ok({ invitation: toInvitationView(invitation, deps.clock.now()), url, emailSent });
  };
```

`src/modules/spaces/application/revoke-invitation.ts`:

```ts
import { domainError, err, ok, type Result } from "@/shared/kernel";
import { revokeInvitation } from "../domain/invitation";
import type { InvitationsDeps } from "./invitation-ports";
import { toInvitationView, type InvitationView } from "./invitation-view";
import { authorizeSpaceAction } from "./space-access";

export type RevokeInvitation = (input: {
  spaceId: string;
  userId: string;
  invitationId: string;
}) => Promise<Result<InvitationView>>;

/** HU-E1-06: OWNER or ADMIN revokes a pending invitation; revoking twice changes nothing. */
export const createRevokeInvitation =
  (deps: Pick<InvitationsDeps, "access" | "invitations" | "clock" | "tm">): RevokeInvitation =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "member.invite");
      if (!manager.ok) return manager;
      // Locked, so a revocation and a concurrent acceptance of the same invitation run one at a time.
      const invitation = await deps.invitations.findForUpdate(manager.value.spaceId, input.invitationId);
      if (!invitation) return err(domainError("InvitationNotFound"));
      const now = deps.clock.now();
      const revoked = revokeInvitation(invitation, now);
      if (!revoked.ok) return revoked;
      if (revoked.value !== invitation) await deps.invitations.save(revoked.value);
      return ok(toInvitationView(revoked.value, now));
    });
```

In `src/modules/spaces/application/index.ts`, append:

```ts
export {
  createCreateInvitation,
  type CreatedInvitation,
  type CreateInvitation,
  type CreateInvitationInput,
} from "./create-invitation";
export { createRevokeInvitation, type RevokeInvitation } from "./revoke-invitation";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/spaces`
Expected: PASS.

- [ ] **Step 7: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/modules/spaces/application/invitation-repository.ts src/modules/spaces/application/invitation-ports.ts src/modules/spaces/application/invitation-view.ts src/modules/spaces/application/create-invitation.ts src/modules/spaces/application/revoke-invitation.ts src/modules/spaces/application/invitations.test.ts src/modules/spaces/application/index.ts tests/support/in-memory-spaces.ts
git commit -m "feat(spaces): create and revoke invitations with hashed tokens (Refs #15)"
```

---

### Task 8: Spaces — AcceptInvitation

Implements `AcceptInvitation` of HU-E1-07 (issue #16): a signed-in user presents the token; the invitation is found by its hash and locked; revoked, used, expired and email-mismatched invitations are rejected; a current member gets `AlreadyMember`; otherwise the user joins with the invited role and `joinedAt` set, and an email invitation becomes `ACCEPTED`. Pins Review Focus 1 and 2 at the use-case level.

Decisions:
- The token is hashed with the same `InvitationTokens.hash` used at creation; an unknown token is `InvitationNotFound` (404), so a garbage token never reaches a `uuid` query.
- The invitation row is read `FOR UPDATE`, so concurrent acceptances of one invitation run one at a time: the second one sees `ACCEPTED` (email) or the first member (link). The partial unique index on current members (Task 10) is the backstop when two different links race for the same user.
- The new member's display name is the user's account name, numbered when taken (Task 2). When the database reports the name taken by a concurrent join, the use case re-reads the members and retries with that refused name added to the taken set (PostgreSQL's `lower()` may fold some letters differently from JavaScript, so the re-read members alone could yield the same name again), at most three attempts, then answers `MemberNameTaken`.
- The response is the joined space as the acceptor sees it (`SpaceSummary` with the invited role), read back through `SpaceAccess`; an archived space (HU-E1-09) therefore answers `SpaceNotFound` and rolls the join back.
- Signing up through an invitation is two calls: sign-up, then accept with the token (the redirect is web UI behaviour, HU-E9-05). The visitor scenario is therefore an acceptance test (Task 15).

**Files:**
- Create: `src/modules/spaces/application/accept-invitation.ts`
- Modify: `src/modules/spaces/application/index.ts`
- Test: `src/modules/spaces/application/accept-invitation.test.ts`

**Interfaces:**
- Consumes: `toSpaceSummary`, `SpaceSummary` (M1/Task 1); `userMember`, `SpaceMember` (Task 2); `AddMemberOutcome` (Task 3); `ensureAcceptable`, `markAccepted` (Task 6); `InvitationsDeps`, `createCreateInvitation`, `createRevokeInvitation`, `invitationsWorld`, `InMemorySpaceStore`, `HOUSEHOLD_MEMBERS` (Tasks 3, 7).
- Produces: `interface AcceptInvitationInput { token: string; userId: string; userEmail: string; userName: string }`; `type AcceptInvitation = (input: AcceptInvitationInput) => Promise<Result<SpaceSummary>>`; `createAcceptInvitation(deps: Pick<InvitationsDeps, "access" | "members" | "invitations" | "tokens" | "ids" | "clock" | "tm">): AcceptInvitation` (`InvitationNotFound`, `InvitationRevoked`, `InvitationAlreadyUsed`, `InvitationExpired`, `InvitationEmailMismatch`, `AlreadyMember`, `MemberNameTaken`, `SpaceNotFound`).

- [ ] **Step 1: Write the failing test**

`src/modules/spaces/application/accept-invitation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { HOUSEHOLD_MEMBERS, InMemorySpaceStore, invitationsWorld } from "../../../../tests/support/in-memory-spaces";
import type { InvitationTarget } from "../domain/invitation";
import type { SpaceMember } from "../domain/space";
import { createAcceptInvitation } from "./accept-invitation";
import { createCreateInvitation } from "./create-invitation";
import { createRevokeInvitation } from "./revoke-invitation";
import type { AddMemberOutcome } from "./space-member-repository";

const space = "space-household";
const created = new Date("2026-10-12T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const juan = { userId: "u-juan", userEmail: "juan@example.com", userName: "Juan" };
const luis = { userId: "u-luis", userEmail: "luis@example.com", userName: "Luis" };
const toJuan: InvitationTarget = { kind: "EMAIL", email: "juan@example.com" };

/** HU-E1-07 Background: "Ana" (only member of Household) invited the target with the given role. */
const invited = async (
  target: InvitationTarget = toJuan,
  role: "ADMIN" | "MEMBER" | "VIEWER" = "MEMBER",
  store?: InMemorySpaceStore,
) => {
  const world = invitationsWorld({ members: [HOUSEHOLD_MEMBERS[0]!], store });
  unwrap(await createCreateInvitation(world.deps)({ spaceId: space, userId: "u-ana", role, target }));
  return { ...world, accept: createAcceptInvitation(world.deps), later: (ms: number) => world.clock.set(new Date(created.getTime() + ms)) };
};
const juanRows = (members: SpaceMember[]) => members.filter((m) => m.userId === "u-juan");

describe("AcceptInvitation (HU-E1-07)", () => {
  it("makes the signed-in invitee a MEMBER with joinedAt set and uses up the email invitation", async () => {
    const w = await invited();
    w.clock.set(new Date("2026-10-13T09:00:00Z"));
    expect(unwrap(await w.accept({ token: "token-1", ...juan }))).toEqual({
      id: space,
      name: "Household",
      kind: "SHARED",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
      role: "MEMBER",
    });
    expect(juanRows(w.store.members(space))).toEqual([
      {
        id: "id-2",
        kind: "USER",
        userId: "u-juan",
        displayName: "Juan",
        role: "MEMBER",
        contactEmail: null,
        joinedAt: new Date("2026-10-13T09:00:00Z"),
      },
    ]);
    expect(w.invitations.rows[0]).toMatchObject({
      status: "ACCEPTED",
      acceptedByUserId: "u-juan",
      acceptedAt: new Date("2026-10-13T09:00:00Z"),
    });
    expect(w.invitations.locked).toEqual(["id-1"]);
  });

  it("matches the invited address ignoring case", async () => {
    const w = await invited();
    expect(codeOf(await w.accept({ token: "token-1", ...juan, userEmail: "JUAN@Example.com" }))).toBe("ok");
  });

  it("rejects an invitation created 8 days ago", async () => {
    const w = await invited();
    w.later(8 * DAY);
    expect(codeOf(await w.accept({ token: "token-1", ...juan }))).toBe("InvitationExpired");
    expect(juanRows(w.store.members(space))).toEqual([]);
  });

  it("accepts until just before 7 days and rejects from exactly 7 days", async () => {
    const early = await invited();
    early.later(7 * DAY - 60_000);
    expect(codeOf(await early.accept({ token: "token-1", ...juan }))).toBe("ok");
    const late = await invited();
    late.later(7 * DAY);
    expect(codeOf(await late.accept({ token: "token-1", ...juan }))).toBe("InvitationExpired");
  });

  it("rejects another account for an email-bound invitation", async () => {
    const w = await invited();
    expect(codeOf(await w.accept({ token: "token-1", ...luis }))).toBe("InvitationEmailMismatch");
    expect(w.store.members(space).map((m) => m.displayName)).toEqual(["Ana"]);
  });

  it("rejects a revoked invitation", async () => {
    const w = await invited();
    unwrap(await createRevokeInvitation(w.deps)({ spaceId: space, userId: "u-ana", invitationId: "id-1" }));
    expect(codeOf(await w.accept({ token: "token-1", ...juan }))).toBe("InvitationRevoked");
  });

  it("cannot be replayed once used", async () => {
    const w = await invited();
    unwrap(await w.accept({ token: "token-1", ...juan }));
    expect(codeOf(await w.accept({ token: "token-1", ...juan }))).toBe("InvitationAlreadyUsed");
    expect(juanRows(w.store.members(space))).toHaveLength(1);
  });

  it("reports an unknown token as InvitationNotFound", async () => {
    const w = await invited();
    expect(codeOf(await w.accept({ token: "not-a-token", ...juan }))).toBe("InvitationNotFound");
  });

  it("keeps a link invitation valid for several people and rejects current members", async () => {
    const w = await invited({ kind: "LINK" }, "VIEWER");
    unwrap(await w.accept({ token: "token-1", ...juan }));
    unwrap(await w.accept({ token: "token-1", ...luis }));
    expect(w.store.members(space).map((m) => [m.displayName, m.role])).toEqual([
      ["Ana", "OWNER"],
      ["Juan", "VIEWER"],
      ["Luis", "VIEWER"],
    ]);
    expect(w.invitations.rows[0]?.status).toBe("PENDING");
    expect(codeOf(await w.accept({ token: "token-1", ...juan }))).toBe("AlreadyMember");
    expect(codeOf(await w.accept({ token: "token-1", userId: "u-ana", userEmail: "ana@example.com", userName: "Ana" }))).toBe(
      "AlreadyMember",
    );
  });

  it("numbers the display name of a newcomer whose name is taken", async () => {
    const w = await invited({ kind: "LINK" });
    unwrap(await w.accept({ token: "token-1", userId: "u-ana-2", userEmail: "ana2@example.com", userName: "Ana" }));
    expect(w.store.members(space).map((m) => m.displayName)).toEqual(["Ana", "Ana 2"]);
  });

  it("retries with a name not yet refused when concurrent joins take it, and gives up after three attempts", async () => {
    class NameRaceStore extends InMemorySpaceStore {
      /** Display names offered to addMember, in order. */
      readonly tried: string[] = [];
      constructor(private readonly failures: number) {
        super();
      }
      override async addMember(spaceId: string, member: SpaceMember): Promise<AddMemberOutcome> {
        this.tried.push(member.displayName);
        return this.tried.length <= this.failures ? "nameTaken" : super.addMember(spaceId, member);
      }
    }
    const recovering = new NameRaceStore(2);
    const recoveringWorld = await invited({ kind: "LINK" }, "MEMBER", recovering);
    expect(codeOf(await recoveringWorld.accept({ token: "token-1", ...juan }))).toBe("ok");
    // The re-read members never show the refused names here, so only the taken set moves the suffix on.
    expect(recovering.tried).toEqual(["Juan", "Juan 2", "Juan 3"]);
    expect(juanRows(recovering.members(space)).map((m) => m.displayName)).toEqual(["Juan 3"]);
    const failing = await invited({ kind: "LINK" }, "MEMBER", new NameRaceStore(3));
    expect(codeOf(await failing.accept({ token: "token-1", ...juan }))).toBe("MemberNameTaken");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/spaces/application/accept-invitation.test.ts`
Expected: FAIL — `Failed to resolve import "./accept-invitation"`.

- [ ] **Step 3: Implement**

`src/modules/spaces/application/accept-invitation.ts`:

```ts
import { domainError, err, map, type Result } from "@/shared/kernel";
import { ensureAcceptable, markAccepted } from "../domain/invitation";
import { userMember } from "../domain/member";
import type { SpaceMember } from "../domain/space";
import type { InvitationsDeps } from "./invitation-ports";
import { toSpaceSummary } from "./space-access";
import type { AddMemberOutcome } from "./space-member-repository";
import type { SpaceSummary } from "./space-repository";

export interface AcceptInvitationInput {
  readonly token: string;
  readonly userId: string;
  /** The signed-in user's email, compared with an email-bound invitation. */
  readonly userEmail: string;
  /** The signed-in user's name, used as display name in the space. */
  readonly userName: string;
}

export type AcceptInvitation = (input: AcceptInvitationInput) => Promise<Result<SpaceSummary>>;

/** Concurrent joins may take the computed display name; re-read and retry this many times in total. */
const MAX_JOIN_ATTEMPTS = 3;

/** HU-E1-07: a signed-in user joins the invitation's space with the invited role. */
export const createAcceptInvitation =
  (deps: Pick<InvitationsDeps, "access" | "members" | "invitations" | "tokens" | "ids" | "clock" | "tm">): AcceptInvitation =>
  (input) =>
    deps.tm.run(async () => {
      // Locked: concurrent acceptances of one invitation run one at a time (single-use email invitations).
      const invitation = await deps.invitations.findByTokenHashForUpdate(deps.tokens.hash(input.token));
      if (!invitation) return err(domainError("InvitationNotFound"));
      const now = deps.clock.now();
      const acceptable = ensureAcceptable(invitation, { email: input.userEmail, now });
      if (!acceptable.ok) return acceptable;
      const id = deps.ids.next<"SpaceMember">();
      // Names the database refused; lower() may fold letters differently from JavaScript, so never retry one.
      const refused: string[] = [];
      let outcome: AddMemberOutcome = "nameTaken";
      for (let attempt = 0; attempt < MAX_JOIN_ATTEMPTS && outcome === "nameTaken"; attempt += 1) {
        const current: SpaceMember[] = await deps.members.listCurrent(invitation.spaceId);
        if (current.some((m) => m.userId === input.userId)) return err(domainError("AlreadyMember"));
        const member: SpaceMember = userMember({
          id,
          userId: input.userId,
          userName: input.userName,
          role: invitation.role,
          now,
          current,
          alsoTaken: refused,
        });
        outcome = await deps.members.addMember(invitation.spaceId, member);
        if (outcome === "nameTaken") refused.push(member.displayName);
      }
      if (outcome === "alreadyMember") return err(domainError("AlreadyMember"));
      if (outcome === "nameTaken") return err(domainError("MemberNameTaken"));
      const accepted = markAccepted(invitation, input.userId, now);
      if (accepted !== invitation) await deps.invitations.save(accepted);
      return map(await deps.access(invitation.spaceId, input.userId), toSpaceSummary);
    });
```

In `src/modules/spaces/application/index.ts`, append:

```ts
export { createAcceptInvitation, type AcceptInvitation, type AcceptInvitationInput } from "./accept-invitation";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/spaces`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0. If `tsc` reports TS7022 on a loop variable, keep the explicit annotations shown (`let outcome: AddMemberOutcome`, `const current: SpaceMember[]`, `const member: SpaceMember`).

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/application/accept-invitation.ts src/modules/spaces/application/accept-invitation.test.ts src/modules/spaces/application/index.ts
git commit -m "feat(spaces): accept invitations by token (Refs #16)"
```

---

### Task 9: Accounts — shared fund accounts need an owner or admin

Implements HU-E2-02 (issue #24) in the `accounts` module: `CreateAccount` already places `SHARED_FUND` only in shared spaces with no owner user (`openAccount`, M1), and personal types only in personal spaces (`PersonalAccountRequiresPersonalSpace`); this task adds the role rule: only OWNER or ADMIN (`fund.manage`) create, rename, correct or archive a shared fund.

Decisions:
- The rule is checked in the use cases through `requirePermission(membership, "fund.manage")` after the existing writer check, so a VIEWER still gets `InsufficientRole` first and a MEMBER creating a `BANK` account in a shared space still gets `PersonalAccountRequiresPersonalSpace` (the type rule is the more specific answer).
- In a personal space the owner is OWNER, so `SHARED_FUND` there still answers `SharedFundRequiresSharedSpace` (M1 behaviour unchanged).
- Who may move money from or into the fund is decided by HU-E4-10 (M2-B); until then M1's ledger check `ownAccount` rejects a fund as a source for everyone, because the fund has no owner user.

**Files:**
- Modify: `src/modules/accounts/application/create-account.ts`, `src/modules/accounts/application/account-for-change.ts`
- Test: `src/modules/accounts/application/shared-fund.test.ts`

**Interfaces:**
- Consumes: `requirePermission` (Task 1, via `@/modules/spaces/application`); `requireRole`, `WRITERS`, `SpaceMembership`; `openAccount`, `AccountsDeps`, `createCreateAccount`, `createUpdateAccount`, `createArchiveAccount` (M1); `InMemoryAccounts`, `FixedMovements` (`tests/support/in-memory-accounts.ts`); `codeOf`, `fakeSpaceAccess`, `memoryTm`, `membership`, `money`, `sequentialIds`, `unwrap` (fakes).
- Produces: no new exports; `createAccount` and `accountForChange` answer `InsufficientRole` to members for `SHARED_FUND` accounts.

- [ ] **Step 1: Write the failing test**

`src/modules/accounts/application/shared-fund.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
import {
  codeOf,
  fakeSpaceAccess,
  memoryTm,
  membership,
  money,
  sequentialIds,
  unwrap,
} from "../../../../tests/support/fakes";
import { FixedMovements, InMemoryAccounts } from "../../../../tests/support/in-memory-accounts";
import { createArchiveAccount } from "./archive-account";
import { createCreateAccount } from "./create-account";
import type { AccountsDeps } from "./deps";
import { createUpdateAccount } from "./update-account";

// Background: "Ana" is OWNER and "Juan" is MEMBER of the shared space "Household"; "Lina" is its ADMIN.
const household = membership({ spaceId: "space-household", spaceKind: "SHARED", name: "Household" });
const juan = membership({ ...household, memberId: "member-juan", userId: "u-juan", role: "MEMBER" });
const lina = membership({ ...household, memberId: "member-lina", userId: "u-lina", role: "ADMIN" });
const asAna = { spaceId: "space-household", userId: "u-ana" };
const asJuan = { spaceId: "space-household", userId: "u-juan" };
const asLina = { spaceId: "space-household", userId: "u-lina" };
const fund = { name: "Household Fund", type: "SHARED_FUND" as const, openingBalance: money(0n) };

const setup = () => {
  const accounts = new InMemoryAccounts();
  const deps: AccountsDeps = {
    accounts,
    access: fakeSpaceAccess(household, juan, lina),
    movements: new FixedMovements(),
    ids: sequentialIds("acc"),
    clock: new FixedClock(new Date("2026-10-13T12:00:00Z")),
    tm: memoryTm,
  };
  return {
    accounts,
    create: createCreateAccount(deps),
    update: createUpdateAccount(deps),
    archive: createArchiveAccount(deps),
  };
};

describe("shared fund account (HU-E2-02)", () => {
  it("lets the owner create the household fund in the shared space with no owner user", async () => {
    const { create } = setup();
    expect(unwrap(await create({ ...asAna, ...fund }))).toMatchObject({
      spaceId: "space-household",
      name: "Household Fund",
      type: "SHARED_FUND",
      ownerUserId: null,
      openingBalance: 0n,
      balance: 0n,
    });
  });

  it("lets an admin create and rename a shared fund", async () => {
    const { create, update } = setup();
    const created = unwrap(await create({ ...asLina, ...fund }));
    expect(created).toMatchObject({ type: "SHARED_FUND", ownerUserId: null });
    expect(unwrap(await update({ ...asLina, accountId: created.id, changes: { name: "Pot" } })).name).toBe("Pot");
  });

  it("does not let a member create a shared fund", async () => {
    const { create, accounts } = setup();
    expect(codeOf(await create({ ...asJuan, ...fund }))).toBe("InsufficientRole");
    expect(accounts.rows).toEqual([]);
  });

  it("keeps personal account types out of the shared space for owners and members", async () => {
    const { create } = setup();
    for (const actor of [asAna, asJuan]) {
      const result = await create({ ...actor, name: "Bancolombia", type: "BANK", openingBalance: money(0n) });
      expect(codeOf(result)).toBe("PersonalAccountRequiresPersonalSpace");
    }
  });

  it("lets only owners and admins rename or archive the fund", async () => {
    const { create, update, archive } = setup();
    const created = unwrap(await create({ ...asAna, ...fund }));
    expect(codeOf(await update({ ...asJuan, accountId: created.id, changes: { name: "Pot" } }))).toBe(
      "InsufficientRole",
    );
    expect(codeOf(await archive({ ...asJuan, accountId: created.id }))).toBe("InsufficientRole");
    expect(unwrap(await update({ ...asAna, accountId: created.id, changes: { name: "Pot" } })).name).toBe("Pot");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/accounts/application/shared-fund.test.ts`
Expected: FAIL — "does not let a member create a shared fund": `expected 'ok' to be 'InsufficientRole'`, and the rename/archive assertions likewise (members pass the M1 writer check). The owner and admin scenarios already pass (M1 lets every writer manage a fund); they pin that the new rule keeps both roles allowed.

- [ ] **Step 3: Implement**

In `src/modules/accounts/application/create-account.ts`:

1. Replace the line `import { requireRole, WRITERS } from "@/modules/spaces/application";` with:

```ts
import { requirePermission, requireRole, WRITERS } from "@/modules/spaces/application";
```

2. Replace the lines

```ts
      const writer = requireRole(membership.value, WRITERS);
      if (!writer.ok) return writer;
      const space = writer.value;
```

with:

```ts
      const writer = requireRole(membership.value, WRITERS);
      if (!writer.ok) return writer;
      // HU-E2-02: only OWNER and ADMIN manage shared funds.
      const allowed = input.type === "SHARED_FUND" ? requirePermission(writer.value, "fund.manage") : writer;
      if (!allowed.ok) return allowed;
      const space = allowed.value;
```

In `src/modules/accounts/application/account-for-change.ts`:

1. Replace the line `import { requireRole, WRITERS, type SpaceMembership } from "@/modules/spaces/application";` with:

```ts
import { requirePermission, requireRole, WRITERS, type SpaceMembership } from "@/modules/spaces/application";
```

2. Replace the lines

```ts
  if (account.ownerUserId !== null && account.ownerUserId !== input.userId) {
    return err(domainError("InsufficientRole"));
  }
```

with:

```ts
  if (account.ownerUserId === null) {
    // HU-E2-02: shared fund accounts are managed by OWNER and ADMIN only.
    const manager = requirePermission(writer.value, "fund.manage");
    if (!manager.ok) return manager;
  } else if (account.ownerUserId !== input.userId) {
    return err(domainError("InsufficientRole"));
  }
```

3. Update the doc comment line `/** The account to change, authorized: writers of its space, and only its owner for personal accounts. */` to:

```ts
/** The account to change, authorized: its owner for personal accounts, OWNER or ADMIN for shared funds. */
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/accounts`
Expected: PASS (the new file and the unchanged M1 `create-account.test.ts` and `manage-accounts.test.ts`).

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (M1's accounts acceptance tests act as OWNER of personal spaces, so they are unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/modules/accounts/application/create-account.ts src/modules/accounts/application/account-for-change.ts src/modules/accounts/application/shared-fund.test.ts
git commit -m "feat(accounts): restrict shared fund accounts to owners and admins (Refs #24)"
```

---

### Task 10: Spaces — member constraints, invitations table and migration 0006

Schema task (HU-E1-06, HU-E1-07, HU-E1-10), with the D15 constraint test written first so it is red before the migration (Review Focus 4). Adds `space_members.contact_email`, the D15 shape checks, and two partial unique indexes over **current** members (`left_at IS NULL`): one user per space (replacing M0's `space_members_space_user`, which would forbid HU-E1-07's "a former member who accepts again gets a new SpaceMember row") and one display name per space ignoring case (HU-E1-10). Adds the `space_invitations` table.

Decisions:
- The partial unique indexes are the concurrency backstop: `INSERT … ON CONFLICT DO NOTHING` in Task 11 turns a lost race into `alreadyMember`/`nameTaken` instead of a `500` (the M1 follow-up issue #84 lists such races as a known gap for names).
- `space_invitations.token_hash` is unique (SHA-256 hex of a 256-bit token); `email` is set exactly for `EMAIL` invitations; `role` never holds `OWNER` (check constraint, besides the domain rule). Deleting the space or the inviting user deletes the invitation; deleting the accepting user only clears `accepted_by_user_id`.
- Existing rows already satisfy the new checks (personal-space owners are `USER` rows with a user and a role and no contact email).
- `space_invitations.created_by` and `accepted_by_user_id` reference `user`, so both get an index (like `space_members_user_id_idx`): deleting a user then finds its invitations without a scan.
- The shared integration fixtures `userFixture` and `sharedSpaceFixture` are introduced here, their first use; Tasks 11 and 12 reuse them instead of copying user and space setup.

**Files:**
- Modify: `src/modules/spaces/infrastructure/spaces.schema.ts`, `tests/support/fixtures.ts`
- Create (generated): `drizzle/0006_shared_spaces.sql`, `drizzle/meta/0006_snapshot.json`; Modify (generated): `drizzle/meta/_journal.json`
- Test: `src/modules/spaces/infrastructure/spaces-schema.int.test.ts`

**Interfaces:**
- Consumes: `user` (M0 auth schema), `spaces`, `spaceMembers` (M0 spaces schema); `createSharedSpace`, `Space` (Task 2); `DrizzleSpaceRepository` (M0); `testDatabase` (`tests/support/database.ts`).
- Produces:
  - `space_members.contact_email text` (`spaceMembers.contactEmail`); unique indexes `space_members_current_user_uq (space_id, user_id) WHERE left_at IS NULL` and `space_members_current_name_uq (space_id, lower(display_name)) WHERE left_at IS NULL`; checks `space_members_guest_user`, `space_members_guest_role`, `space_members_contact_email`; constraint `space_members_space_user` dropped.
  - table `space_invitations` (`spaceInvitations`): `id uuid pk`, `space_id → spaces (cascade)`, `kind`, `email`, `role`, `token_hash unique`, `status`, `created_by → user (cascade)`, `created_at`, `expires_at`, `accepted_at`, `accepted_by_user_id → user (set null)`, `revoked_at`; indexes `space_invitations_space_id_idx`, `space_invitations_created_by_idx`, `space_invitations_accepted_by_user_id_idx`; checks `space_invitations_email_kind`, `space_invitations_role`.
  - `tests/support/fixtures.ts`: `userFixture(pool: Pool, name?: string): Promise<{ id: string; name: string; email: string }>`, `sharedSpaceFixture(db: Database, ownerId: string, now?: Date): Promise<Space>` ("Household", COP, the owner named "Ana").

- [ ] **Step 1: Write the failing test**

In `tests/support/fixtures.ts`, replace the line `import { createPersonalSpace } from "@/modules/spaces/domain/space";` with:

```ts
import { createPersonalSpace, createSharedSpace, type Space } from "@/modules/spaces/domain/space";
```

and append:

```ts

/** A registered user row (no personal space); `<name>-<id>@example.com` as email. */
export const userFixture = async (
  pool: Pool,
  name = "Ana",
): Promise<{ id: string; name: string; email: string }> => {
  const id = randomUUID();
  const email = `${name.toLowerCase()}-${id}@example.com`;
  await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [id, name, email]);
  return { id, name, email };
};

/** The shared space "Household" (COP) with `ownerId` as its only OWNER "Ana", written through the real spaces repository. */
export const sharedSpaceFixture = async (db: Database, ownerId: string, now = new Date()): Promise<Space> => {
  const space = createSharedSpace({
    id: randomUUID() as Id<"Space">,
    memberId: randomUUID() as Id<"SpaceMember">,
    ownerUserId: ownerId,
    ownerName: "Ana",
    name: "Household",
    currency: "COP",
    now,
  });
  if (!space.ok) throw new Error(space.error.code);
  await new DrizzleSpaceRepository(new DrizzleTransactionManager(db)).add(space.value);
  return space.value;
};
```

`src/modules/spaces/infrastructure/spaces-schema.int.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabase } from "../../../../tests/support/database";
import { sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";

const { db, pool } = testDatabase();

afterAll(() => pool.end());

describe("space_members shape checks (spec 5.2, D15, Review Focus 4)", () => {
  it("rejects guests with a user or a role and contact emails on registered members", async () => {
    const juan = await userFixture(pool, "Juan");
    const space = await sharedSpaceFixture(db, (await userFixture(pool, "Ana")).id);
    const insert = (kind: string, userId: string | null, role: string | null, contactEmail: string | null) =>
      pool.query(
        "INSERT INTO space_members (id, space_id, kind, user_id, display_name, role, contact_email, joined_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())",
        [randomUUID(), space.id, kind, userId, `Name ${randomUUID()}`, role, contactEmail],
      );
    await expect(insert("GUEST", null, "MEMBER", null)).rejects.toThrow(/space_members_guest_role/);
    await expect(insert("GUEST", juan.id, null, null)).rejects.toThrow(/space_members_guest_user/);
    await expect(insert("USER", juan.id, null, null)).rejects.toThrow(/space_members_guest_role/);
    await expect(insert("USER", juan.id, "MEMBER", "juan@example.com")).rejects.toThrow(
      /space_members_contact_email/,
    );
    await expect(insert("GUEST", null, null, "pedro@example.com")).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project integration src/modules/spaces/infrastructure/spaces-schema.int.test.ts`
Expected: FAIL — every insert errors with `column "contact_email" of relation "space_members" does not exist`, which matches none of the constraint names.

- [ ] **Step 3: Write the schema**

`src/modules/spaces/infrastructure/spaces.schema.ts` (replace the whole file):

```ts
import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "@/modules/identity/infrastructure/auth.schema";
import type { PeriodPolicy } from "@/shared/kernel";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const spaces = pgTable(
  "spaces",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["PERSONAL", "SHARED", "DIRECT"] }).notNull(),
    currency: text("currency").notNull(),
    periodPolicy: jsonb("period_policy").$type<PeriodPolicy>().notNull(),
    personalOwnerUserId: text("personal_owner_user_id")
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    archivedAt: tz("archived_at"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    check("spaces_personal_owner", sql`(${t.kind} = 'PERSONAL') = (${t.personalOwnerUserId} IS NOT NULL)`),
  ],
);

export const spaceMembers = pgTable(
  "space_members",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["USER", "GUEST"] }).notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["OWNER", "ADMIN", "MEMBER", "VIEWER"] }),
    contactEmail: text("contact_email"),
    joinedAt: tz("joined_at").notNull(),
    leftAt: tz("left_at"),
    claimedAt: tz("claimed_at"),
  },
  (t) => [
    // HU-E1-07: one row per user among current members; a former member who joins again gets a new row.
    uniqueIndex("space_members_current_user_uq").on(t.spaceId, t.userId).where(sql`${t.leftAt} IS NULL`),
    // HU-E1-10: display names are unique among current members of both kinds, ignoring case.
    uniqueIndex("space_members_current_name_uq")
      .on(t.spaceId, sql`lower(${t.displayName})`)
      .where(sql`${t.leftAt} IS NULL`),
    index("space_members_user_id_idx").on(t.userId),
    // Spec 5.2, D15: GUEST <=> no user <=> no role; only guests carry a contact email.
    check("space_members_guest_user", sql`(${t.kind} = 'GUEST') = (${t.userId} IS NULL)`),
    check("space_members_guest_role", sql`(${t.kind} = 'GUEST') = (${t.role} IS NULL)`),
    check("space_members_contact_email", sql`${t.contactEmail} IS NULL OR ${t.kind} = 'GUEST'`),
  ],
);

// HU-E1-06, HU-E1-07. Values mirror the domain types; listed here so drizzle-kit loads no domain code.
export const spaceInvitations = pgTable(
  "space_invitations",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["EMAIL", "LINK"] }).notNull(),
    email: text("email"),
    role: text("role", { enum: ["ADMIN", "MEMBER", "VIEWER"] }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status", { enum: ["PENDING", "ACCEPTED", "REVOKED"] }).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: tz("created_at").notNull(),
    expiresAt: tz("expires_at").notNull(),
    acceptedAt: tz("accepted_at"),
    acceptedByUserId: text("accepted_by_user_id").references(() => user.id, { onDelete: "set null" }),
    revokedAt: tz("revoked_at"),
  },
  (t) => [
    index("space_invitations_space_id_idx").on(t.spaceId),
    // Foreign keys to user: deleting a user finds its invitations without a scan.
    index("space_invitations_created_by_idx").on(t.createdBy),
    index("space_invitations_accepted_by_user_id_idx").on(t.acceptedByUserId),
    // Email invitations are bound to one address; link invitations to none.
    check("space_invitations_email_kind", sql`(${t.kind} = 'EMAIL') = (${t.email} IS NOT NULL)`),
    // An invitation never grants OWNER.
    check("space_invitations_role", sql`${t.role} IN ('ADMIN', 'MEMBER', 'VIEWER')`),
  ],
);
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate --name shared_spaces`
Expected: `drizzle/0006_shared_spaces.sql` that creates `space_invitations` (with its two checks, the `token_hash` unique constraint, foreign keys to `spaces` (cascade) and `user` (cascade, set null) and the indexes `space_invitations_space_id_idx`, `space_invitations_created_by_idx` and `space_invitations_accepted_by_user_id_idx`), drops the constraint `space_members_space_user`, adds `space_members.contact_email`, creates the unique indexes `space_members_current_user_uq` and `space_members_current_name_uq` with `WHERE … "left_at" IS NULL`, and adds the three `space_members_*` checks; `drizzle/meta/0006_snapshot.json`; a `0006_shared_spaces` journal entry. drizzle-kit asks no rename questions (no table or column is removed). If it does prompt, answer "create" for every new entity.

- [ ] **Step 5: Verify migrations, drift, the new test and existing repositories**

Run: `pnpm db:check && pnpm exec vitest run --project integration`
Expected: "No schema drift" and PASS for the whole integration project, including `spaces-schema.int.test.ts` (the migrations test applies `0006` twice to an empty database; M1's repositories, including the ledger tests that insert a guest member with `guestMemberFixture`, still pass under the new checks and indexes).

- [ ] **Step 6: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/modules/spaces/infrastructure/spaces.schema.ts src/modules/spaces/infrastructure/spaces-schema.int.test.ts tests/support/fixtures.ts drizzle/0006_shared_spaces.sql drizzle/meta/0006_snapshot.json drizzle/meta/_journal.json
git commit -m "feat(spaces): add member constraints and the invitations table with migration (Refs #15, Refs #16, Refs #19)"
```

---

### Task 11: Spaces — Drizzle members repository

Implements `SpaceMemberRepository` on `DrizzleSpaceRepository` (HU-E1-04, HU-E1-05, HU-E1-07, HU-E1-10) and makes `add` persist contact emails. Pins Review Focus 3 (two owners demoting each other at the same time keep exactly one OWNER) and Review Focus 5 (malformed space ids return `[]`); the database checks on guest rows (Review Focus 4) are pinned in Task 10.

Decisions:
- `addMember` inserts with `ON CONFLICT DO NOTHING` (no conflict target, so both partial unique indexes count) and reads back whether the user is already a current member to tell `alreadyMember` from `nameTaken`. Under READ COMMITTED a concurrent uncommitted insert of the same key makes the second insert wait for the first transaction and then do nothing, so a lost race is a clean outcome, not a `500`.
- `listCurrent(…, { lock: true })` uses `SELECT … FOR UPDATE` ordered by `(joined_at, id)`, so every role change of a space locks the same rows in the same order (no deadlock between two changes).

**Files:**
- Modify: `src/modules/spaces/infrastructure/drizzle-space-repository.ts`
- Test: `src/modules/spaces/infrastructure/drizzle-space-members.int.test.ts`

**Interfaces:**
- Consumes: `SpaceMemberRepository`, `AddMemberOutcome` (Task 3); `SpaceMember`, `SpaceRole` (Task 2); `createChangeMemberRole` (Task 4); `createSpaceAccess` (Task 1); `spaceMembers.contactEmail` (Task 10); `userFixture`, `sharedSpaceFixture` (Task 10); `isUuid`, `ok` (kernel); `testDatabase` (`tests/support/database.ts`).
- Produces: `class DrizzleSpaceRepository implements SpaceRepository, SpaceSettingsRepository, SpaceMemberRepository` (constructor unchanged: `(tm: DrizzleTransactionManager)`).

- [ ] **Step 1: Write the failing integration test**

`src/modules/spaces/infrastructure/drizzle-space-members.int.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { ok } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";
import { createChangeMemberRole } from "../application/change-member-role";
import { createSpaceAccess } from "../application/space-access";
import type { SpaceId, SpaceMember, SpaceMemberId, SpaceRole } from "../domain/space";
import { DrizzleSpaceRepository } from "./drizzle-space-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleSpaceRepository(tm);

const newUser = async (name: string): Promise<string> => (await userFixture(pool, name)).id;
/** "Household" created at 12:00Z through `DrizzleSpaceRepository.add`, so guests (13:00Z) and users (14:00Z) join after Ana. */
const household = (ownerId: string) => sharedSpaceFixture(db, ownerId, new Date("2026-10-13T12:00:00Z"));
const guest = (displayName: string, contactEmail: string | null = null): SpaceMember => ({
  id: randomUUID() as SpaceMemberId,
  kind: "GUEST",
  userId: null,
  displayName,
  role: null,
  contactEmail,
  joinedAt: new Date("2026-10-13T13:00:00Z"),
});
const registered = (userId: string, displayName: string, role: SpaceRole = "MEMBER"): SpaceMember => ({
  id: randomUUID() as SpaceMemberId,
  kind: "USER",
  userId,
  displayName,
  role,
  contactEmail: null,
  joinedAt: new Date("2026-10-13T14:00:00Z"),
});
const leave = (memberId: string) => pool.query("UPDATE space_members SET left_at = now() WHERE id = $1", [memberId]);
const count = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows[0].n as number;

afterAll(() => pool.end());

describe("DrizzleSpaceRepository members (HU-E1-04, HU-E1-10)", () => {
  it("persists a shared space with its creator as the only OWNER", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana);
    expect(await repo.listForUser(ana)).toEqual([
      {
        id: space.id,
        name: "Household",
        kind: "SHARED",
        currency: "COP",
        periodPolicy: { kind: "MONTHLY", day: 1 },
        role: "OWNER",
      },
    ]);
    expect(await repo.listCurrent(space.id)).toEqual(space.members);
  });

  it("adds a guest with a contact email and lists current members in join order", async () => {
    const space = await household(await newUser("Ana"));
    const pedro = guest("Pedro", "pedro@example.com");
    expect(await repo.addMember(space.id, pedro)).toBe("added");
    expect(await repo.listCurrent(space.id)).toEqual([...space.members, pedro]);
  });

  it("reports a name taken in any case and a user who is already a current member", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana);
    await repo.addMember(space.id, guest("Pedro"));
    expect(await repo.addMember(space.id, guest("PEDRO"))).toBe("nameTaken");
    expect(await repo.addMember(space.id, registered(ana, "Ana Again"))).toBe("alreadyMember");
    expect(await repo.listCurrent(space.id)).toHaveLength(2);
  });

  it("frees the name and lets a former member join again with a new row (HU-E1-07)", async () => {
    const ana = await newUser("Ana");
    const juan = await newUser("Juan");
    const space = await household(ana);
    const pedro = guest("Pedro");
    const juanBefore = registered(juan, "Juan");
    await repo.addMember(space.id, pedro);
    await repo.addMember(space.id, juanBefore);
    await leave(pedro.id);
    await leave(juanBefore.id);
    expect(await repo.addMember(space.id, guest("Pedro"))).toBe("added");
    expect(await repo.addMember(space.id, registered(juan, "Juan"))).toBe("added");
    const rows = "SELECT count(*)::int AS n FROM space_members WHERE space_id = $1 AND user_id = $2";
    expect(await count(rows, [space.id, juan])).toBe(2);
  });

  it("changes a member's role", async () => {
    const juan = await newUser("Juan");
    const space = await household(await newUser("Ana"));
    const member = registered(juan, "Juan");
    await repo.addMember(space.id, member);
    await repo.updateRole(space.id, member.id, "ADMIN");
    expect((await repo.findMembership(space.id, juan))?.role).toBe("ADMIN");
  });

  it("returns no members for a malformed space id and locks rows inside a transaction", async () => {
    const space = await household(await newUser("Ana"));
    expect(await repo.listCurrent("not-a-uuid" as SpaceId)).toEqual([]);
    expect(await tm.run(async () => ok(await repo.listCurrent(space.id, { lock: true })))).toEqual({
      ok: true,
      value: space.members,
    });
  });
});

describe("concurrent member changes (Review Focus 3)", () => {
  it("lets exactly one of two concurrent guests with the same name in", async () => {
    const space = await household(await newUser("Ana"));
    const add = (name: string) => tm.run(async () => ok(await repo.addMember(space.id, guest(name))));
    const outcomes = await Promise.all([add("Pedro"), add("pedro")]);
    expect(outcomes.map((o) => (o.ok ? o.value : o.error.code)).sort()).toEqual(["added", "nameTaken"]);
  });

  it("keeps exactly one OWNER when two owners demote each other at the same time", async () => {
    const ana = await newUser("Ana");
    const juan = await newUser("Juan");
    const space = await household(ana);
    const juanOwner = registered(juan, "Juan", "OWNER");
    await repo.addMember(space.id, juanOwner);
    const changeRole = createChangeMemberRole({ access: createSpaceAccess(repo), members: repo, tm });
    const results = await Promise.all([
      changeRole({ spaceId: space.id, userId: ana, memberId: juanOwner.id, role: "ADMIN" }),
      changeRole({ spaceId: space.id, userId: juan, memberId: space.members[0]!.id, role: "ADMIN" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const owners = "SELECT count(*)::int AS n FROM space_members WHERE space_id = $1 AND role = 'OWNER'";
    expect(await count(owners, [space.id])).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project integration src/modules/spaces/infrastructure/drizzle-space-members.int.test.ts`
Expected: FAIL — `repo.listCurrent is not a function` (and `tsc` would report that `DrizzleSpaceRepository` does not implement `SpaceMemberRepository`).

- [ ] **Step 3: Implement**

`src/modules/spaces/infrastructure/drizzle-space-repository.ts` (replace the whole file):

```ts
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid } from "@/shared/kernel";
import type { AddMemberOutcome, SpaceMemberRepository } from "../application/space-member-repository";
import type { SpaceRepository, SpaceSummary } from "../application/space-repository";
import type {
  SpaceMembership,
  SpaceSettings,
  SpaceSettingsRepository,
} from "../application/space-settings-repository";
import type { Space, SpaceId, SpaceMember, SpaceMemberId, SpaceRole } from "../domain/space";
import { spaceMembers, spaces } from "./spaces.schema";

const memberRow = (spaceId: string, m: SpaceMember): typeof spaceMembers.$inferInsert => ({
  id: m.id,
  spaceId,
  kind: m.kind,
  userId: m.userId,
  displayName: m.displayName,
  role: m.role,
  contactEmail: m.contactEmail,
  joinedAt: m.joinedAt,
});

const memberColumns = {
  id: spaceMembers.id,
  kind: spaceMembers.kind,
  userId: spaceMembers.userId,
  displayName: spaceMembers.displayName,
  role: spaceMembers.role,
  contactEmail: spaceMembers.contactEmail,
  joinedAt: spaceMembers.joinedAt,
};

export class DrizzleSpaceRepository implements SpaceRepository, SpaceSettingsRepository, SpaceMemberRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async add(space: Space): Promise<void> {
    const db = this.tm.executor();
    await db.insert(spaces).values({
      id: space.id,
      name: space.name,
      kind: space.kind,
      currency: space.currency,
      periodPolicy: space.periodPolicy,
      personalOwnerUserId: space.personalOwnerUserId,
      createdAt: space.createdAt,
    });
    await db.insert(spaceMembers).values(space.members.map((m) => memberRow(space.id, m)));
  }

  async hasPersonalSpace(userId: string): Promise<boolean> {
    const rows = await this.tm
      .executor()
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.personalOwnerUserId, userId))
      .limit(1);
    return rows.length > 0;
  }

  async listForUser(userId: string): Promise<SpaceSummary[]> {
    return this.tm
      .executor()
      .select({
        id: spaces.id,
        name: spaces.name,
        kind: spaces.kind,
        currency: spaces.currency,
        periodPolicy: spaces.periodPolicy,
        role: spaceMembers.role,
      })
      .from(spaces)
      .innerJoin(spaceMembers, eq(spaceMembers.spaceId, spaces.id))
      .where(and(eq(spaceMembers.userId, userId), isNull(spaceMembers.leftAt), isNull(spaces.archivedAt)))
      .orderBy(asc(spaces.createdAt));
  }

  async findMembership(spaceId: string, userId: string): Promise<SpaceMembership | null> {
    // Ids come from URLs; anything that is not a UUID would fail the uuid cast.
    if (!isUuid(spaceId)) return null;
    const [row] = await this.tm
      .executor()
      .select({
        spaceId: spaces.id,
        name: spaces.name,
        spaceKind: spaces.kind,
        currency: spaces.currency,
        periodPolicy: spaces.periodPolicy,
        memberId: spaceMembers.id,
        role: spaceMembers.role,
      })
      .from(spaces)
      .innerJoin(spaceMembers, eq(spaceMembers.spaceId, spaces.id))
      .where(
        and(
          eq(spaces.id, spaceId),
          eq(spaceMembers.userId, userId),
          isNull(spaceMembers.leftAt),
          isNull(spaces.archivedAt),
        ),
      )
      .limit(1);
    return row
      ? { ...row, spaceId: row.spaceId as SpaceId, memberId: row.memberId as SpaceMemberId, userId }
      : null;
  }

  async updateSettings(spaceId: SpaceId, settings: SpaceSettings): Promise<void> {
    await this.tm
      .executor()
      .update(spaces)
      .set({ name: settings.name, currency: settings.currency, periodPolicy: settings.periodPolicy })
      .where(eq(spaces.id, spaceId));
  }

  async listCurrent(spaceId: SpaceId, options: { readonly lock?: boolean } = {}): Promise<SpaceMember[]> {
    if (!isUuid(spaceId)) return [];
    const query = this.tm
      .executor()
      .select(memberColumns)
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), isNull(spaceMembers.leftAt)))
      .orderBy(asc(spaceMembers.joinedAt), asc(spaceMembers.id));
    // Same rows in the same order for every locking reader of a space, so two role changes never deadlock.
    const rows = options.lock ? await query.for("update") : await query;
    return rows.map((row) => ({ ...row, id: row.id as SpaceMemberId }));
  }

  async addMember(spaceId: SpaceId, member: SpaceMember): Promise<AddMemberOutcome> {
    // No conflict target: both partial unique indexes (current user, current name) count, concurrent inserts included.
    const inserted = await this.tm
      .executor()
      .insert(spaceMembers)
      .values(memberRow(spaceId, member))
      .onConflictDoNothing()
      .returning({ id: spaceMembers.id });
    if (inserted.length > 0) return "added";
    if (member.userId === null) return "nameTaken";
    const current = await this.listCurrent(spaceId);
    return current.some((m) => m.userId === member.userId) ? "alreadyMember" : "nameTaken";
  }

  async updateRole(spaceId: SpaceId, memberId: SpaceMemberId, role: SpaceRole): Promise<void> {
    await this.tm
      .executor()
      .update(spaceMembers)
      .set({ role })
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.id, memberId)));
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project integration src/modules/spaces`
Expected: PASS (the new file and the unchanged `drizzle-space-repository.int.test.ts`).

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/infrastructure/drizzle-space-repository.ts src/modules/spaces/infrastructure/drizzle-space-members.int.test.ts
git commit -m "feat(spaces): persist members, guests and role changes with a Drizzle repository (Refs #14, Refs #19)"
```

---

### Task 12: Spaces — invitations repository, token adapter and user lookup

Implements `InvitationRepository` with Drizzle, the `InvitationTokens` adapter (256 random bits, base64url, SHA-256 hex hash) and the identity adapter method that resolves a registered user by email (HU-E1-06, HU-E1-07). Pins Review Focus 2 (two concurrent acceptances of the same invitation against PostgreSQL create exactly one membership) and Review Focus 5 (malformed invitation ids return `null`).

Decisions:
- Both reads lock the invitation row (`SELECT … FOR UPDATE`), so acceptances and revocations of one invitation serialize; the second transaction re-reads the committed state.
- The user lookup lives on `BetterAuthProvider` (identity infrastructure), not on the `AuthProvider` port, so identity's use-case doubles stay unchanged; the composition root binds it to the `RegisteredUsers` port (Task 14). The spaces repository never reads identity's `user` table.

**Files:**
- Create: `src/modules/spaces/infrastructure/drizzle-invitation-repository.ts`, `src/modules/spaces/infrastructure/crypto-invitation-tokens.ts`
- Modify: `src/modules/identity/infrastructure/better-auth-provider.ts`
- Test: `src/modules/spaces/infrastructure/drizzle-invitation-repository.int.test.ts`, `src/modules/spaces/infrastructure/crypto-invitation-tokens.test.ts`, `src/modules/identity/infrastructure/better-auth-provider.int.test.ts` (all user and space setup through `userFixture`/`sharedSpaceFixture`, Task 10)

**Interfaces:**
- Consumes: `InvitationRepository`, `InvitationTokens`, `IssuedToken` (Task 7); `Invitation`, `InvitationId`, `InvitationTarget`, `issueInvitation` (Task 6); `Space`, `SpaceId` (Task 2); `userFixture`, `sharedSpaceFixture` (Task 10); `createAcceptInvitation` (Task 8); `createSpaceAccess` (Task 1); `DrizzleSpaceRepository` (Task 11); `spaceInvitations` (Task 10); `normalizeEmail` (`src/modules/identity/application/sign-up.ts`); `createAuth` (`better-auth.ts`); `SystemClock`, `UuidV7IdGenerator` (shared infrastructure); `isUuid` (kernel).
- Produces:
  - `class DrizzleInvitationRepository implements InvitationRepository` (constructor `(tm: DrizzleTransactionManager)`)
  - `cryptoInvitationTokens: InvitationTokens`
  - `BetterAuthProvider.findUserIdByEmail(email: string): Promise<string | null>`

- [ ] **Step 1: Write the failing tests**

`src/modules/spaces/infrastructure/crypto-invitation-tokens.test.ts`:

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cryptoInvitationTokens } from "./crypto-invitation-tokens";

describe("cryptoInvitationTokens (HU-E1-06)", () => {
  it("issues URL-safe tokens with 256 random bits together with their SHA-256 hash", () => {
    const { token, hash } = cryptoInvitationTokens.issue();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("never repeats a token", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => cryptoInvitationTokens.issue().token));
    expect(tokens.size).toBe(1000);
  });

  it("hashes a presented token the same way as at issue time", () => {
    const { token, hash } = cryptoInvitationTokens.issue();
    expect(cryptoInvitationTokens.hash(token)).toBe(hash);
    expect(cryptoInvitationTokens.hash("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

`src/modules/identity/infrastructure/better-auth-provider.int.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabase } from "../../../../tests/support/database";
import { userFixture } from "../../../../tests/support/fixtures";
import { createAuth } from "./better-auth";
import { BetterAuthProvider } from "./better-auth-provider";

const { db, pool } = testDatabase();
const provider = new BetterAuthProvider(
  createAuth({ db, secret: "test-secret-0123456789abcdef0123456789", baseURL: "http://localhost:3000" }),
  db,
);

afterAll(() => pool.end());

describe("BetterAuthProvider.findUserIdByEmail (HU-E1-06)", () => {
  it("finds a registered user by email, ignoring case and surrounding spaces", async () => {
    const juan = await userFixture(pool, "Juan");
    expect(await provider.findUserIdByEmail(`  ${juan.email.toUpperCase()} `)).toBe(juan.id);
  });

  it("finds nobody for an unknown email", async () => {
    expect(await provider.findUserIdByEmail(`nobody-${randomUUID()}@example.com`)).toBeNull();
  });
});
```

`src/modules/spaces/infrastructure/drizzle-invitation-repository.int.test.ts`:

```ts
import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { SystemClock } from "@/shared/infrastructure/system-clock";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import type { Result } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";
import { createAcceptInvitation } from "../application/accept-invitation";
import { createSpaceAccess } from "../application/space-access";
import { issueInvitation, type InvitationId, type InvitationTarget } from "../domain/invitation";
import type { Space } from "../domain/space";
import { cryptoInvitationTokens } from "./crypto-invitation-tokens";
import { DrizzleInvitationRepository } from "./drizzle-invitation-repository";
import { DrizzleSpaceRepository } from "./drizzle-space-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const spaces = new DrizzleSpaceRepository(tm);
const repo = new DrizzleInvitationRepository(tm);

const newUser = (name: string) => userFixture(pool, name);
const household = (ownerId: string) => sharedSpaceFixture(db, ownerId);
const invite = async (space: Space, createdBy: string, target: InvitationTarget, now = new Date()) => {
  const { token, hash } = cryptoInvitationTokens.issue();
  const invitation = issueInvitation({
    id: randomUUID() as InvitationId,
    spaceId: space.id,
    target,
    role: "MEMBER",
    tokenHash: hash,
    createdBy,
    now,
  });
  if (!invitation.ok) throw new Error(invitation.error.code);
  await repo.add(invitation.value);
  return { token, invitation: invitation.value };
};

afterAll(() => pool.end());

describe("DrizzleInvitationRepository (HU-E1-06, HU-E1-07)", () => {
  it("stores an invitation and finds it by space and id or by token hash", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana.id);
    const { token, invitation } = await invite(
      space,
      ana.id,
      { kind: "EMAIL", email: "juan@example.com" },
      new Date("2026-10-12T12:00:00Z"),
    );
    expect(await repo.findForUpdate(space.id, invitation.id)).toEqual(invitation);
    expect(await repo.findByTokenHashForUpdate(cryptoInvitationTokens.hash(token))).toEqual(invitation);
  });

  it("stores only the SHA-256 hash of the token", async () => {
    const ana = await newUser("Ana");
    const { token, invitation } = await invite(await household(ana.id), ana.id, { kind: "LINK" });
    const { rows } = await pool.query("SELECT token_hash FROM space_invitations WHERE id = $1", [invitation.id]);
    expect(rows[0].token_hash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("finds nothing for malformed ids, another space or an unknown hash", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana.id);
    const other = await household(ana.id);
    const { invitation } = await invite(space, ana.id, { kind: "LINK" });
    expect(await repo.findForUpdate("not-a-uuid", invitation.id)).toBeNull();
    expect(await repo.findForUpdate(space.id, "not-a-uuid")).toBeNull();
    expect(await repo.findForUpdate(other.id, invitation.id)).toBeNull();
    expect(await repo.findByTokenHashForUpdate("0".repeat(64))).toBeNull();
  });

  it("saves acceptance and revocation fields", async () => {
    const ana = await newUser("Ana");
    const juan = await newUser("Juan");
    const space = await household(ana.id);
    const { invitation } = await invite(space, ana.id, { kind: "EMAIL", email: juan.email });
    const accepted = {
      ...invitation,
      status: "ACCEPTED" as const,
      acceptedAt: new Date("2026-10-13T09:00:00Z"),
      acceptedByUserId: juan.id,
    };
    await repo.save(accepted);
    expect(await repo.findForUpdate(space.id, invitation.id)).toEqual(accepted);
  });

  it("rejects email invitations without an address and invitations granting OWNER", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana.id);
    const insert = (kind: string, email: string | null, role: string) =>
      pool.query(
        "INSERT INTO space_invitations (id, space_id, kind, email, role, token_hash, status, created_by, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, now(), now() + interval '7 days')",
        [randomUUID(), space.id, kind, email, role, randomUUID(), ana.id],
      );
    await expect(insert("EMAIL", null, "MEMBER")).rejects.toThrow(/space_invitations_email_kind/);
    await expect(insert("LINK", "juan@example.com", "MEMBER")).rejects.toThrow(/space_invitations_email_kind/);
    await expect(insert("LINK", null, "OWNER")).rejects.toThrow(/space_invitations_role/);
  });
});

describe("AcceptInvitation against PostgreSQL (Review Focus 2)", () => {
  const accept = createAcceptInvitation({
    access: createSpaceAccess(spaces),
    members: spaces,
    invitations: repo,
    tokens: cryptoInvitationTokens,
    ids: new UuidV7IdGenerator(),
    clock: new SystemClock(),
    tm,
  });
  const membershipRows = async (spaceId: string, userId: string) =>
    (
      await pool.query("SELECT count(*)::int AS n FROM space_members WHERE space_id = $1 AND user_id = $2", [
        spaceId,
        userId,
      ])
    ).rows[0].n;
  const codes = (results: Result<unknown>[]) => results.map((r) => (r.ok ? "ok" : r.error.code)).sort();

  it("lets exactly one of two concurrent acceptances of an email invitation through", async () => {
    const ana = await newUser("Ana");
    const juan = await newUser("Juan");
    const space = await household(ana.id);
    const { token, invitation } = await invite(space, ana.id, { kind: "EMAIL", email: juan.email });
    const input = { token, userId: juan.id, userEmail: juan.email, userName: juan.name };
    expect(codes(await Promise.all([accept(input), accept(input)]))).toEqual(["InvitationAlreadyUsed", "ok"]);
    expect(await membershipRows(space.id, juan.id)).toBe(1);
    expect(await repo.findForUpdate(space.id, invitation.id)).toMatchObject({
      status: "ACCEPTED",
      acceptedByUserId: juan.id,
    });
  });

  it("adds a user once when they accept the same link twice at the same time", async () => {
    const ana = await newUser("Ana");
    const juan = await newUser("Juan");
    const space = await household(ana.id);
    const { token } = await invite(space, ana.id, { kind: "LINK" });
    const input = { token, userId: juan.id, userEmail: juan.email, userName: juan.name };
    expect(codes(await Promise.all([accept(input), accept(input)]))).toEqual(["AlreadyMember", "ok"]);
    expect(await membershipRows(space.id, juan.id)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/spaces/infrastructure && pnpm exec vitest run --project integration src/modules/spaces/infrastructure/drizzle-invitation-repository.int.test.ts src/modules/identity`
Expected: FAIL — `Failed to resolve import "./crypto-invitation-tokens"`, `Failed to resolve import "./drizzle-invitation-repository"` and `provider.findUserIdByEmail is not a function`.

- [ ] **Step 3: Implement**

`src/modules/spaces/infrastructure/crypto-invitation-tokens.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";
import type { InvitationTokens, IssuedToken } from "../application/invitation-ports";

const sha256 = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

/** HU-E1-06: 256 random bits as base64url (43 characters); only the SHA-256 hex digest is stored. */
export const cryptoInvitationTokens: InvitationTokens = {
  issue: (): IssuedToken => {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: sha256(token) };
  },
  hash: sha256,
};
```

`src/modules/spaces/infrastructure/drizzle-invitation-repository.ts`:

```ts
import { and, eq } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid } from "@/shared/kernel";
import type { InvitationRepository } from "../application/invitation-repository";
import type { Invitation, InvitationId } from "../domain/invitation";
import type { SpaceId } from "../domain/space";
import { spaceInvitations } from "./spaces.schema";

const toInvitation = (row: typeof spaceInvitations.$inferSelect): Invitation => ({
  ...row,
  id: row.id as InvitationId,
  spaceId: row.spaceId as SpaceId,
});

export class DrizzleInvitationRepository implements InvitationRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async add(invitation: Invitation): Promise<void> {
    await this.tm.executor().insert(spaceInvitations).values({
      id: invitation.id,
      spaceId: invitation.spaceId,
      kind: invitation.kind,
      email: invitation.email,
      role: invitation.role,
      tokenHash: invitation.tokenHash,
      status: invitation.status,
      createdBy: invitation.createdBy,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      acceptedByUserId: invitation.acceptedByUserId,
      revokedAt: invitation.revokedAt,
    });
  }

  async findForUpdate(spaceId: string, invitationId: string): Promise<Invitation | null> {
    // Ids come from URLs; anything that is not a UUID would fail the uuid cast.
    if (!isUuid(spaceId) || !isUuid(invitationId)) return null;
    const [row] = await this.tm
      .executor()
      .select()
      .from(spaceInvitations)
      .where(and(eq(spaceInvitations.spaceId, spaceId), eq(spaceInvitations.id, invitationId)))
      .for("update");
    return row ? toInvitation(row) : null;
  }

  async findByTokenHashForUpdate(tokenHash: string): Promise<Invitation | null> {
    const [row] = await this.tm
      .executor()
      .select()
      .from(spaceInvitations)
      .where(eq(spaceInvitations.tokenHash, tokenHash))
      .for("update");
    return row ? toInvitation(row) : null;
  }

  async save(invitation: Invitation): Promise<void> {
    await this.tm
      .executor()
      .update(spaceInvitations)
      .set({
        status: invitation.status,
        acceptedAt: invitation.acceptedAt,
        acceptedByUserId: invitation.acceptedByUserId,
        revokedAt: invitation.revokedAt,
      })
      .where(eq(spaceInvitations.id, invitation.id));
  }
}
```

In `src/modules/identity/infrastructure/better-auth-provider.ts`:

1. Add after the line `import type { AuthProvider, AuthSession } from "../application/auth-provider";`:

```ts
import { normalizeEmail } from "../application/sign-up";
```

2. Add after the method

```ts
  async deleteUser(userId: string): Promise<void> {
    await this.db.delete(user).where(eq(user.id, userId));
  }
```

the method:

```ts

  /** The user registered with `email` (stored lower-cased, HU-E1-01); the spaces module refuses to invite members with it (HU-E1-06). */
  async findUserIdByEmail(email: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, normalizeEmail(email)))
      .limit(1);
    return row?.id ?? null;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/spaces/infrastructure && pnpm exec vitest run --project integration src/modules/spaces src/modules/identity`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (`modules-only-through-public-application-api` holds: the spaces infrastructure imports only spaces files and shared code; identity's infrastructure imports its own application).

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/infrastructure/drizzle-invitation-repository.ts src/modules/spaces/infrastructure/drizzle-invitation-repository.int.test.ts src/modules/spaces/infrastructure/crypto-invitation-tokens.ts src/modules/spaces/infrastructure/crypto-invitation-tokens.test.ts src/modules/identity/infrastructure/better-auth-provider.ts src/modules/identity/infrastructure/better-auth-provider.int.test.ts
git commit -m "feat(spaces): persist invitations, issue hashed tokens and look up users by email (Refs #15, Refs #16)"
```

---

### Task 13: HTTP — create a shared space and list its members

Exposes HU-E1-04 (issue #13): `POST /api/v1/spaces` (kind `SHARED`; kind `PERSONAL` answers `409 PersonalSpaceAlreadyExists`, HU-E1-02) and `GET /api/v1/spaces/{spaceId}/members`. Wires `CreateSpace` with the same category-seeding listener as the personal space, and `ListMembers`. Pins Review Focus 5 for the members path.

Decisions:
- Body: `{ "kind": "SHARED", "name": "…", "currency": "COP" }`; `currency` defaults to `COP` when omitted; it must look like an ISO 4217 code (`ValidationFailed`) and be supported by the kernel (`422 UnknownCurrency`). `DIRECT` is not an accepted kind (`422 ValidationFailed`; D16 creates direct spaces implicitly). The response is the `Space` component (`201`).
- The category language is the session user's `locale`; the acceptance test switches a user to `en` with SQL because sign-up has no locale input yet.
- `GET …/members` returns `{ items: SpaceMember[] }` in join order; each member carries `kind`, `userId` (null for guests), `displayName`, `role` (null for guests), `contactEmail` (guests only) and `joinedAt`.

**Files:**
- Modify: `src/modules/spaces/contracts/spaces.contract.ts`, `src/app/api/v1/spaces/route.ts`, `src/composition/container.ts`, `src/composition/openapi.ts`, `openapi/openapi.snapshot.json`, `tests/support/app.ts`
- Create: `src/app/api/v1/spaces/[spaceId]/members/route.ts`, `tests/support/spaces.ts`
- Test: `tests/acceptance/shared-spaces.test.ts`

**Interfaces:**
- Consumes: `createCreateSpace`, `CreateSpace` (Task 3); `createListMembers`, `ListMembers`, `MembersDeps` (Task 4); `SpaceCreatedListener`, `createCreatePersonalSpace` (M0); container locals `spaceRepository`, `access`, `seedDefaultCategories`, `ids`, `clock`, `tm` (M1); `call`, `registerUser`, `startTestApp`, `TestUser` (`tests/support/app.ts`).
- Produces:
  - `CreateSpaceBodySchema`, `SpaceMemberSchema`, `ListMembersResponseSchema`, `memberDto(member: SpaceMember)` in `spaces.contract.ts`; `spacesPaths` gains `POST /api/v1/spaces` and `GET /api/v1/spaces/{spaceId}/members`
  - `Container.spaces.{createSpace, listMembers}`; container locals `onSpaceCreated: SpaceCreatedListener` and `membersDeps: MembersDeps` (reused by Tasks 16, 17)
  - `tests/support/spaces.ts`: `newSharedSpace(owner: TestUser, name?: string): Promise<string>`, `actingIn(user: TestUser, spaceId: string): TestUser`
  - `tests/support/app.ts`: `problemOf(response: Response): Promise<[number, string]>` (status and problem code; every acceptance file of this plan uses it instead of a local copy)
  - component `SpaceMember`

- [ ] **Step 1: Write the failing acceptance test**

In `tests/support/app.ts`, append:

```ts

/** Status and problem code of an error response: `expect(await problemOf(response)).toEqual([404, "SpaceNotFound"])`. */
export const problemOf = async (response: Response): Promise<[number, string]> => [
  response.status,
  ((await response.json()) as { code: string }).code,
];
```

`tests/support/spaces.ts`:

```ts
import { POST as createSpace } from "@/app/api/v1/spaces/route";
import { call, type TestUser } from "./app";

/** Creates a shared space over HTTP with `owner` as its OWNER; returns its id. */
export const newSharedSpace = async (owner: TestUser, name = "Household"): Promise<string> => {
  const response = await call(createSpace, "POST", "/api/v1/spaces", {
    user: owner,
    body: { kind: "SHARED", name, currency: "COP" },
  });
  if (response.status !== 201) throw new Error(`space creation failed with status ${response.status}`);
  return ((await response.json()) as { id: string }).id;
};

/** The same user acting in another space, for helpers that address `user.spaceId`. */
export const actingIn = (user: TestUser, spaceId: string): TestUser => ({ ...user, spaceId });
```

`tests/acceptance/shared-spaces.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listCategories } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { GET as listSpaces, POST as createSpace } from "@/app/api/v1/spaces/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const create = (user: TestUser | undefined, body: unknown) => call(createSpace, "POST", "/api/v1/spaces", { user, body });
const members = (user: TestUser, spaceId: string) =>
  call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, { user, params: { spaceId } });
/** Category names per group name. */
const tree = async (user: TestUser, spaceId: string) => {
  const response = await call(listCategories, "GET", `/api/v1/spaces/${spaceId}/categories`, {
    user,
    params: { spaceId },
  });
  const { items } = (await response.json()) as { items: { name: string; categories: { name: string }[] }[] };
  return new Map(items.map((g) => [g.name, g.categories.map((c) => c.name)]));
};

describe("create a shared space (HU-E1-04)", () => {
  it("creates Household as SHARED with Ana as OWNER and seeds the default categories", async () => {
    const ana = await registerUser("Ana");
    const response = await create(ana, { kind: "SHARED", name: "Household", currency: "COP" });
    expect(response.status).toBe(201);
    const space = await response.json();
    expect(space).toEqual({
      id: expect.any(String),
      name: "Household",
      kind: "SHARED",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
      role: "OWNER",
    });
    const listed = await (await call(listSpaces, "GET", "/api/v1/spaces", { user: ana })).json();
    expect(listed.items.map((s: { kind: string }) => s.kind)).toEqual(["PERSONAL", "SHARED"]);
    expect((await (await members(ana, space.id)).json()).items).toEqual([
      {
        id: expect.any(String),
        kind: "USER",
        userId: ana.userId,
        displayName: "Ana",
        role: "OWNER",
        contactEmail: null,
        joinedAt: expect.any(String),
      },
    ]);
    expect((await tree(ana, space.id)).get("Vivienda")).toEqual(["Arriendo", "Servicios", "Mantenimiento"]);
  });

  it("seeds English names when the creator's locale is en, and defaults the currency to COP (HU-E3-01)", async () => {
    const juan = await registerUser("Juan");
    await app.pool.query(`UPDATE "user" SET locale = 'en' WHERE id = $1`, [juan.userId]);
    const flat = await (await create(juan, { kind: "SHARED", name: "Flat" })).json();
    expect(flat.currency).toBe("COP");
    expect((await tree(juan, flat.id)).get("Housing")).toEqual(["Rent", "Utilities", "Maintenance"]);
  });

  it.each([
    [{ kind: "SHARED", name: "", currency: "COP" }, 422, "InvalidSpaceName"],
    [{ kind: "SHARED", name: "Household", currency: "XYZ" }, 422, "UnknownCurrency"],
    [{ kind: "SHARED", name: "Household", currency: "cop" }, 422, "ValidationFailed"],
    [{ kind: "DIRECT", name: "Ana & Pedro" }, 422, "ValidationFailed"],
    [{ kind: "PERSONAL" }, 409, "PersonalSpaceAlreadyExists"],
  ])("answers %o with %i %s", async (body, status, code) => {
    const ana = await registerUser("Ana");
    expect(await problemOf(await create(ana, body))).toEqual([status, code]);
  });

  it("requires authentication", async () => {
    expect(await problemOf(await create(undefined, { kind: "SHARED", name: "Household" }))).toEqual([
      401,
      "Unauthenticated",
    ]);
  });

  it("hides the members of a space the user does not belong to, also for malformed ids", async () => {
    const ana = await registerUser("Ana");
    const marta = await registerUser("Marta");
    const space = await (await create(ana, { kind: "SHARED", name: "Household" })).json();
    for (const spaceId of [space.id, "not-a-uuid"]) {
      expect(await problemOf(await members(marta, spaceId))).toEqual([404, "SpaceNotFound"]);
    }
  });
});
```

Run: `pnpm exec vitest run --project acceptance tests/acceptance/shared-spaces.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/members/route"` (and no `POST` export in `@/app/api/v1/spaces/route`).

- [ ] **Step 2: Contract**

In `src/modules/spaces/contracts/spaces.contract.ts`:

1. Add after the line `import { jsonContent, PeriodSchema, problemContent, problems, securedByUser } from "@/shared/http/contracts";`:

```ts
import type { SpaceMember } from "../application";
```

2. Add after the line `export const ListSpacesResponseSchema = z.object({ items: z.array(SpaceSummarySchema) });`:

```ts
/** HU-E1-04: shared spaces are created here; PERSONAL answers PersonalSpaceAlreadyExists (HU-E1-02); DIRECT never (D16). */
export const CreateSpaceBodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PERSONAL") }),
  z.object({
    kind: z.literal("SHARED"),
    name: z.string().max(200),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, { error: "Currency must be an ISO 4217 code" })
      .default("COP"),
  }),
]);

const RoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);

/** A current member (HU-E1-05, HU-E1-10): guests have kind GUEST, no user and no role. */
export const SpaceMemberSchema = z.object({
  id: z.string(),
  kind: z.enum(["USER", "GUEST"]),
  userId: z.string().nullable(),
  displayName: z.string(),
  role: RoleSchema.nullable(),
  contactEmail: z.string().nullable(),
  joinedAt: z.iso.datetime(),
});
export const ListMembersResponseSchema = z.object({ items: z.array(SpaceMemberSchema) });

export const memberDto = (member: SpaceMember): z.infer<typeof SpaceMemberSchema> => ({
  id: member.id,
  kind: member.kind,
  userId: member.userId,
  displayName: member.displayName,
  role: member.role,
  contactEmail: member.contactEmail,
  joinedAt: member.joinedAt.toISOString(),
});
```

3. Replace these five lines (the end of the `listMySpaces` operation and the start of the next path):

```ts
        "401": { description: "Unauthenticated", content: problemContent },
      },
    },
  },
  "/api/v1/spaces/{spaceId}": {
```

with:

```ts
        "401": { description: "Unauthenticated", content: problemContent },
      },
    },
    post: {
      operationId: "createSpace",
      summary: "Create a shared space with the requester as its only OWNER (personal spaces come with sign-up)",
      ...securedByUser,
      requestBody: { content: jsonContent(CreateSpaceBodySchema) },
      responses: {
        "201": { description: "The new space", content: jsonContent(SpaceSummarySchema) },
        ...problems({
          "401": "Unauthenticated",
          "409": "PersonalSpaceAlreadyExists",
          "422": "ValidationFailed, InvalidSpaceName, UnknownCurrency",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}": {
```

4. Insert just before the last line of the file (the `};` that closes `spacesPaths`):

```ts
  "/api/v1/spaces/{spaceId}/members": {
    get: {
      operationId: "listMembers",
      summary: "Current members of the space in join order, guests included",
      ...securedByUser,
      requestParams: { path: SpacePath },
      responses: {
        "200": { description: "The current members", content: jsonContent(ListMembersResponseSchema) },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound" }),
      },
    },
  },
```

- [ ] **Step 3: Routes and wiring**

`src/app/api/v1/spaces/route.ts` (replace the whole file):

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { CreateSpaceBodySchema } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user }) => {
    const result = await getContainer().spaces.listMySpaces(user!.id);
    return result.ok ? ok({ status: 200, body: { items: result.value } }) : result;
  },
});

export const POST = defineRoute({
  auth: "required",
  body: CreateSpaceBodySchema,
  handler: async ({ user, body }) => {
    const creator = { userId: user!.id, userName: user!.name, locale: user!.locale };
    const result = await getContainer().spaces.createSpace(
      body.kind === "SHARED"
        ? { ...creator, kind: "SHARED", name: body.name, currency: body.currency }
        : { ...creator, kind: "PERSONAL" },
    );
    return result.ok ? ok({ status: 201, body: result.value }) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/members/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { memberDto } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.listMembers({ spaceId: params.spaceId!, userId: user!.id });
    return result.ok ? ok({ status: 200, body: { items: result.value.map(memberDto) } }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Extend the import from `@/modules/spaces/application` with `createCreateSpace`, `createListMembers`, `type CreateSpace`, `type ListMembers`, `type MembersDeps`, `type SpaceCreatedListener`.
2. In the `Container` interface, add after the line `    readonly listPeriods: ListSpacePeriods;`:

```ts
    readonly createSpace: CreateSpace;
    readonly listMembers: ListMembers;
```

3. In `buildContainer`, replace the block

```ts
  const createPersonalSpace = createCreatePersonalSpace({
    spaces: spaceRepository,
    ids,
    clock,
    tm,
    // HU-E3-01: default categories are seeded in the same transaction as the space.
    onCreated: (space, { locale }) => seedDefaultCategories({ spaceId: space.id, locale }),
  });
```

with:

```ts
  // HU-E3-01: default categories in the creator's locale, seeded in the same transaction as the space.
  const onSpaceCreated: SpaceCreatedListener = (space, { locale }) =>
    seedDefaultCategories({ spaceId: space.id, locale });
  const createPersonalSpace = createCreatePersonalSpace({
    spaces: spaceRepository,
    ids,
    clock,
    tm,
    onCreated: onSpaceCreated,
  });
  const membersDeps: MembersDeps = { access, members: spaceRepository, ids, clock, tm };
```

4. In the returned `spaces` object, add after the line `      listPeriods: createListSpacePeriods({ access, storedPeriods, clock, timeZone: env.APP_TIMEZONE }),`:

```ts
      createSpace: createCreateSpace({
        spaces: spaceRepository,
        createPersonalSpace,
        onCreated: onSpaceCreated,
        ids,
        clock,
        tm,
      }),
      listMembers: createListMembers(membersDeps),
```

In `src/composition/openapi.ts`, replace the line `import { SpaceSummarySchema, spacesPaths } from "@/modules/spaces/contracts/spaces.contract";` with (already wrapped: on one line it would be 112 characters, past Prettier's `printWidth` of 110):

```ts
import {
  SpaceMemberSchema,
  SpaceSummarySchema,
  spacesPaths,
} from "@/modules/spaces/contracts/spaces.contract";
```

and add after the line `        Space: SpaceSummarySchema,`:

```ts
        SpaceMember: SpaceMemberSchema,
```

- [ ] **Step 4: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance`
Expected: PASS (all acceptance files).

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `POST /api/v1/spaces`, `GET /api/v1/spaces/{spaceId}/members` and the component `SpaceMember` (no `SpaceMemberOutput`, because the component is used only in responses); `GET /api/v1/spaces` is unchanged.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/contracts/spaces.contract.ts src/app/api/v1/spaces/route.ts "src/app/api/v1/spaces/[spaceId]/members/route.ts" src/composition/container.ts src/composition/openapi.ts openapi/openapi.snapshot.json tests/support/app.ts tests/support/spaces.ts tests/acceptance/shared-spaces.test.ts
git commit -m "feat(spaces): expose shared space creation and member listing endpoints (Refs #13)"
```

---

### Task 14: HTTP — create and revoke invitations

Exposes HU-E1-06 (issue #15): `POST /api/v1/spaces/{spaceId}/invitations` (email or link; the response carries the invitation URL and `emailSent`) and `POST /api/v1/spaces/{spaceId}/invitations/{invitationId}/revoke`. Wires the Drizzle invitation repository, the crypto token adapter, the identity user lookup, the invitation URL and the email sender seam. Also reaches HU-E1-02's "Personal spaces cannot receive members" scenario over HTTP.

Decisions:
- Body: `{ "kind": "EMAIL", "email": "…", "role": "MEMBER" }` or `{ "kind": "LINK", "role": "MEMBER" }`. `role` accepts the four role names so `OWNER` reaches the domain and answers `422 InvalidInvitationRole`. Response `201 { invitation: Invitation, url, emailSent }`; the `Invitation` component never contains the token or its hash, and its `status` is `PENDING`, `ACCEPTED`, `REVOKED` or `EXPIRED` (derived).
- URL: `new URL("/invitations/<token>", BETTER_AUTH_URL)` — the public base URL the deployment already configures (the web page arrives with HU-E9-05); in tests `http://localhost:3000/invitations/<token>`.
- Email sender: `ContainerOptions.emailSender` is a test seam; production binds a disabled sender (`emailSent: false`) until an SMTP adapter exists (Self-Review assumption 2).

**Files:**
- Modify: `src/modules/spaces/contracts/spaces.contract.ts`, `src/composition/container.ts`, `src/composition/openapi.ts`, `openapi/openapi.snapshot.json`, `tests/support/spaces.ts`
- Create: `src/app/api/v1/spaces/[spaceId]/invitations/route.ts`, `src/app/api/v1/spaces/[spaceId]/invitations/[invitationId]/revoke/route.ts`
- Test: `tests/acceptance/invitations.test.ts`

**Interfaces:**
- Consumes: `createCreateInvitation`, `createRevokeInvitation`, `CreateInvitation`, `RevokeInvitation`, `CreatedInvitation`, `InvitationView`, `EmailSender`, `InvitationEmail`, `InvitationsDeps` (Task 7); `DrizzleInvitationRepository`, `cryptoInvitationTokens`, `BetterAuthProvider.findUserIdByEmail` (Task 12); `RoleSchema`, `SpacePath` (Task 13 / M1 contract); `problemOf` (Task 13); container locals `provider`, `spaceRepository`, `access`, `ids`, `clock`, `tm`, `env`, `options`.
- Produces:
  - `CreateInvitationBodySchema`, `InvitationSchema`, `CreatedInvitationSchema`, `invitationDto(view: InvitationView)`, `createdInvitationDto(created: CreatedInvitation)`; `spacesPaths` gains the two operations
  - `ContainerOptions.emailSender?: EmailSender`; `Container.spaces.{createInvitation, revokeInvitation}`; container local `invitationsDeps: InvitationsDeps` (reused by Task 15)
  - `tests/support/spaces.ts`: `tokenOf(url: string): string`, `inviteByLink(owner: TestUser, spaceId: string, role: "ADMIN" | "MEMBER" | "VIEWER"): Promise<string>` (the token)
  - component `Invitation`

- [ ] **Step 1: Write the failing acceptance test**

In `tests/support/spaces.ts`, add before the line `import { POST as createSpace } from "@/app/api/v1/spaces/route";`:

```ts
import { POST as createInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/route";
```

and append:

```ts
/** The token at the end of an invitation URL (`…/invitations/<token>`). */
export const tokenOf = (url: string): string => new URL(url).pathname.split("/").at(-1)!;

/** Creates a link invitation over HTTP as `owner`; returns its token. */
export const inviteByLink = async (
  owner: TestUser,
  spaceId: string,
  role: "ADMIN" | "MEMBER" | "VIEWER",
): Promise<string> => {
  const response = await call(createInvitation, "POST", `/api/v1/spaces/${spaceId}/invitations`, {
    user: owner,
    params: { spaceId },
    body: { kind: "LINK", role },
  });
  if (response.status !== 201) throw new Error(`invitation failed with status ${response.status}`);
  return tokenOf(((await response.json()) as { url: string }).url);
};
```

`tests/acceptance/invitations.test.ts`:

```ts
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as revokeInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/[invitationId]/revoke/route";
import { POST as createInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/route";
import { setContainerForTests, type Container } from "@/composition/container";
import type { EmailSender, InvitationEmail } from "@/modules/spaces/application";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { newSharedSpace, tokenOf } from "../support/spaces";

const mails: InvitationEmail[] = [];
const emailSender: EmailSender = {
  send: async (email) => {
    mails.push(email);
    return true;
  },
};
const DAY_MS = 24 * 60 * 60 * 1000;

let app: Container;
beforeAll(() => {
  app = startTestApp({ emailSender });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const invite = (user: TestUser, spaceId: string, body: unknown) =>
  call(createInvitation, "POST", `/api/v1/spaces/${spaceId}/invitations`, { user, params: { spaceId }, body });
const revoke = (user: TestUser, spaceId: string, invitationId: string) =>
  call(revokeInvitation, "POST", `/api/v1/spaces/${spaceId}/invitations/${invitationId}/revoke`, {
    user,
    params: { spaceId, invitationId },
  });

describe("invitations (HU-E1-06)", () => {
  it("creates a pending email invitation that expires after 7 days and emails its link", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    const response = await invite(ana, spaceId, { kind: "EMAIL", email: "Juan@Example.com", role: "MEMBER" });
    expect(response.status).toBe(201);
    const { invitation, url, emailSent } = await response.json();
    expect(invitation).toMatchObject({
      spaceId,
      kind: "EMAIL",
      email: "juan@example.com",
      role: "MEMBER",
      status: "PENDING",
    });
    expect(Date.parse(invitation.expiresAt) - Date.parse(invitation.createdAt)).toBe(7 * DAY_MS);
    expect(emailSent).toBe(true);
    expect(mails.at(-1)).toEqual({ to: "juan@example.com", spaceName: "Household", url });
  });

  it("creates a link invitation whose URL carries only an unguessable token, stored hashed", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    const first = await (await invite(ana, spaceId, { kind: "LINK", role: "MEMBER" })).json();
    const second = await (await invite(ana, spaceId, { kind: "LINK", role: "MEMBER" })).json();
    expect(first.invitation).toMatchObject({ kind: "LINK", email: null, status: "PENDING" });
    expect(first.emailSent).toBe(false);
    const url = new URL(first.url);
    expect([url.origin, url.search, url.hash]).toEqual(["http://localhost:3000", "", ""]);
    expect(url.pathname).toMatch(/^\/invitations\/[A-Za-z0-9_-]{43}$/);
    expect(second.url).not.toBe(first.url);
    const { rows } = await app.pool.query("SELECT token_hash FROM space_invitations WHERE id = $1", [
      first.invitation.id,
    ]);
    expect(rows[0].token_hash).toBe(createHash("sha256").update(tokenOf(first.url)).digest("hex"));
  });

  it("never grants OWNER", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    expect(await problemOf(await invite(ana, spaceId, { kind: "LINK", role: "OWNER" }))).toEqual([
      422,
      "InvalidInvitationRole",
    ]);
  });

  it("revokes a pending invitation, and a second revocation changes nothing", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    const { invitation } = await (
      await invite(ana, spaceId, { kind: "EMAIL", email: "juan@example.com", role: "MEMBER" })
    ).json();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await revoke(ana, spaceId, invitation.id);
      expect([response.status, (await response.json()).status]).toEqual([200, "REVOKED"]);
    }
  });

  it("answers unknown and malformed invitation ids with 404", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    for (const invitationId of [randomUUID(), "not-a-uuid"]) {
      expect(await problemOf(await revoke(ana, spaceId, invitationId))).toEqual([404, "InvitationNotFound"]);
    }
  });

  it("refuses invitations to a personal space (HU-E1-02)", async () => {
    const ana = await registerUser("Ana");
    expect(await problemOf(await invite(ana, ana.spaceId, { kind: "LINK", role: "MEMBER" }))).toEqual([
      409,
      "PersonalSpaceNotShareable",
    ]);
  });

  it("hides the space from non-members", async () => {
    const ana = await registerUser("Ana");
    const marta = await registerUser("Marta");
    const spaceId = await newSharedSpace(ana);
    expect(await problemOf(await invite(marta, spaceId, { kind: "LINK", role: "MEMBER" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
  });
});
```

Run: `pnpm exec vitest run --project acceptance tests/acceptance/invitations.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/invitations/[invitationId]/revoke/route"`.

- [ ] **Step 2: Contract**

In `src/modules/spaces/contracts/spaces.contract.ts`:

1. Replace the line `import type { SpaceMember } from "../application";` with:

```ts
import type { CreatedInvitation, InvitationView, SpaceMember } from "../application";
```

2. Add before the line `const SpacePath = z.object({ spaceId: z.string() });`:

```ts
/** `role` accepts OWNER so the domain answers InvalidInvitationRole (HU-E1-06) instead of ValidationFailed. */
export const CreateInvitationBodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("EMAIL"), email: z.email().max(254), role: RoleSchema }),
  z.object({ kind: z.literal("LINK"), role: RoleSchema }),
]);

/** Never carries the token or its hash; EXPIRED is derived from expiresAt. */
export const InvitationSchema = z.object({
  id: z.string(),
  spaceId: z.string(),
  kind: z.enum(["EMAIL", "LINK"]),
  email: z.string().nullable(),
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
  status: z.enum(["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"]),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export const CreatedInvitationSchema = z.object({
  invitation: InvitationSchema,
  /** The web URL carrying only the token; shown once, since only the token's hash is stored. */
  url: z.string(),
  emailSent: z.boolean(),
});

export const invitationDto = (view: InvitationView): z.infer<typeof InvitationSchema> => ({
  id: view.id,
  spaceId: view.spaceId,
  kind: view.kind,
  email: view.email,
  role: view.role,
  status: view.status,
  createdAt: view.createdAt.toISOString(),
  expiresAt: view.expiresAt.toISOString(),
});

export const createdInvitationDto = (created: CreatedInvitation): z.infer<typeof CreatedInvitationSchema> => ({
  invitation: invitationDto(created.invitation),
  url: created.url,
  emailSent: created.emailSent,
});
```

3. Add after the line `const SpacePath = z.object({ spaceId: z.string() });`:

```ts
const InvitationPath = SpacePath.extend({ invitationId: z.string() });
```

4. Insert just before the last line of the file (the `};` that closes `spacesPaths`):

```ts
  "/api/v1/spaces/{spaceId}/invitations": {
    post: {
      operationId: "createInvitation",
      summary: "Invite by email (bound to that address) or by shareable link; the response carries the URL",
      ...securedByUser,
      requestParams: { path: SpacePath },
      requestBody: { content: jsonContent(CreateInvitationBodySchema) },
      responses: {
        "201": {
          description: "The pending invitation, its URL and whether an email was sent",
          content: jsonContent(CreatedInvitationSchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound",
          "409": "AlreadyMember, PersonalSpaceNotShareable",
          "422": "ValidationFailed, InvalidInvitationRole, InvalidEmail",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/invitations/{invitationId}/revoke": {
    post: {
      operationId: "revokeInvitation",
      summary: "Revoke a pending invitation; revoking twice changes nothing",
      ...securedByUser,
      requestParams: { path: InvitationPath },
      responses: {
        "200": { description: "The revoked invitation", content: jsonContent(InvitationSchema) },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound, InvitationNotFound",
          "409": "InvitationAlreadyUsed",
        }),
      },
    },
  },
```

- [ ] **Step 3: Routes and wiring**

`src/app/api/v1/spaces/[spaceId]/invitations/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { CreateInvitationBodySchema, createdInvitationDto } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: CreateInvitationBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().spaces.createInvitation({
      spaceId: params.spaceId!,
      userId: user!.id,
      role: body.role,
      target: body.kind === "EMAIL" ? { kind: "EMAIL", email: body.email } : { kind: "LINK" },
    });
    return result.ok ? ok({ status: 201, body: createdInvitationDto(result.value) }) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/invitations/[invitationId]/revoke/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { invitationDto } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.revokeInvitation({
      spaceId: params.spaceId!,
      userId: user!.id,
      invitationId: params.invitationId!,
    });
    return result.ok ? ok({ status: 200, body: invitationDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Extend the import from `@/modules/spaces/application` with `createCreateInvitation`, `createRevokeInvitation`, `type CreateInvitation`, `type EmailSender`, `type InvitationsDeps`, `type RevokeInvitation`.
2. Add after the line `import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";`:

```ts
import { cryptoInvitationTokens } from "@/modules/spaces/infrastructure/crypto-invitation-tokens";
import { DrizzleInvitationRepository } from "@/modules/spaces/infrastructure/drizzle-invitation-repository";
```

3. In the `Container` interface, add after the line `    readonly listMembers: ListMembers;`:

```ts
    readonly createInvitation: CreateInvitation;
    readonly revokeInvitation: RevokeInvitation;
```

4. In `ContainerOptions`, add after the line `  readonly authLimits?: AuthLimits;`:

```ts
  /** Delivers invitation emails; v1 has no SMTP adapter, so delivery is disabled unless a test passes one. */
  readonly emailSender?: EmailSender;
```

5. In `buildContainer`, add after the line `  const membersDeps: MembersDeps = { access, members: spaceRepository, ids, clock, tm };`:

```ts
  const invitationsDeps: InvitationsDeps = {
    access,
    members: spaceRepository,
    invitations: new DrizzleInvitationRepository(tm),
    tokens: cryptoInvitationTokens,
    // No SMTP adapter in v1 (no new dependencies): the response carries the URL and emailSent is false.
    emailSender: options.emailSender ?? { send: async () => false },
    // HU-E1-06: refusing to invite current members needs the identity module's users.
    users: { idByEmail: (email) => provider.findUserIdByEmail(email) },
    // The web page that accepts an invitation (HU-E9-05); the URL carries only the token.
    invitationUrl: (token) => new URL(`/invitations/${token}`, env.BETTER_AUTH_URL).toString(),
    ids,
    clock,
    tm,
  };
```

6. In the returned `spaces` object, add after the line `      listMembers: createListMembers(membersDeps),`:

```ts
      createInvitation: createCreateInvitation(invitationsDeps),
      revokeInvitation: createRevokeInvitation(invitationsDeps),
```

In `src/composition/openapi.ts`, in the spaces contract import (wrapped by Task 13), add before the line `  SpaceMemberSchema,`:

```ts
  InvitationSchema,
```

and add after the line `        SpaceMember: SpaceMemberSchema,`:

```ts
        Invitation: InvitationSchema,
```

- [ ] **Step 4: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance`
Expected: PASS.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `POST /api/v1/spaces/{spaceId}/invitations`, `POST /api/v1/spaces/{spaceId}/invitations/{invitationId}/revoke` and the component `Invitation` (no `InvitationOutput`).

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/contracts/spaces.contract.ts "src/app/api/v1/spaces/[spaceId]/invitations" src/composition/container.ts src/composition/openapi.ts openapi/openapi.snapshot.json tests/support/spaces.ts tests/acceptance/invitations.test.ts
git commit -m "feat(spaces): expose invitation create and revoke endpoints (Refs #15)"
```

---

### Task 15: HTTP — accept invitations

Exposes HU-E1-07 (issue #16): `POST /api/v1/invitations/{token}/accept` (authenticated; `200` with the joined `Space`). Adds `InvitationEmailMismatch → 403` to the status map, and the HU-E1-06 "Inviting an existing member is rejected" scenario over HTTP (it needs a member who joined). Pins Review Focus 1 and 2 over HTTP.

Decisions:
- `InvitationEmailMismatch` is `403` (the caller is authenticated but this invitation is not theirs to use); every other new code follows the naming convention (`InvitationNotFound`/`MemberNotFound` → 404, `Invalid*` → 422, the rest → 409). Task 15 adds one `problem.test.ts` row per new M2-A code so the map is pinned in one place.
- The visitor scenario is sign-up followed by accept with the token; the redirect back to the invitation is web UI behaviour (HU-E9-05).
- `tests/support/app.ts` gains `TestUser.email` and an optional `email` argument for `registerUser`, so email-bound invitations can name a real account.

**Files:**
- Modify: `src/modules/spaces/contracts/spaces.contract.ts`, `src/shared/http/problem.ts`, `src/shared/http/problem.test.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`, `tests/support/app.ts`, `tests/support/spaces.ts`, `tests/acceptance/invitations.test.ts`
- Create: `src/app/api/v1/invitations/[token]/accept/route.ts`

**Interfaces:**
- Consumes: `createAcceptInvitation`, `AcceptInvitation` (Task 8); container local `invitationsDeps` (Task 14); `SpaceSummarySchema`; `inviteByLink`, `tokenOf`, `newSharedSpace` (Tasks 13, 14).
- Produces:
  - `POST /api/v1/invitations/{token}/accept` → `200 Space`; `Container.spaces.acceptInvitation`
  - `statusForCode("InvitationEmailMismatch") === 403`
  - `TestUser.email: string`; `registerUser(name?: string, email?: string): Promise<TestUser>`
  - `tests/support/spaces.ts`: `joinAs(owner: TestUser, spaceId: string, member: TestUser, role: "ADMIN" | "MEMBER" | "VIEWER"): Promise<void>`

- [ ] **Step 1: Write the failing tests**

In `src/shared/http/problem.test.ts`, add after the line `    ["AccountNotInSpace", 422],`:

```ts
    ["InvitationEmailMismatch", 403],
    ["InvitationNotFound", 404],
    ["MemberNotFound", 404],
    ["InvalidInvitationRole", 422],
    ["InvalidMemberName", 422],
    ["InvalidSpaceName", 422],
    ["AlreadyMember", 409],
    ["InvitationExpired", 409],
    ["InvitationRevoked", 409],
    ["InvitationAlreadyUsed", 409],
    ["LastOwnerRequired", 409],
    ["GuestHasNoRole", 409],
    ["MemberNameTaken", 409],
    ["PersonalSpaceAlreadyExists", 409],
    ["PersonalSpaceNotShareable", 409],
```

In `tests/support/app.ts`:

1. Replace the block

```ts
export interface TestUser {
  readonly cookie: string;
  readonly userId: string;
  readonly spaceId: string;
}
```

with:

```ts
export interface TestUser {
  readonly cookie: string;
  readonly userId: string;
  readonly spaceId: string;
  readonly email: string;
}
```

2. Replace the whole `registerUser` function (from the line `/** Signs a fresh user up over HTTP; returns their session cookie and personal space id. */` to its closing `};`) with:

```ts
/** Signs a user up over HTTP (a fresh email unless given); returns their session cookie, personal space id and email. */
export const registerUser = async (
  name = "Ana",
  email = uniqueEmail(name.toLowerCase()),
): Promise<TestUser> => {
  const created = await signUp(
    apiRequest("POST", "/api/v1/auth/sign-up", { body: { name, email, password: "123456789012" } }),
  );
  if (created.status !== 201) throw new Error(`sign-up failed with status ${created.status}`);
  const cookie = cookieHeader(created);
  const { user } = (await created.json()) as { user: { id: string } };
  const spaces = await listSpaces(apiRequest("GET", "/api/v1/spaces", { headers: { cookie } }));
  const { items } = (await spaces.json()) as { items: { id: string }[] };
  return { cookie, userId: user.id, spaceId: items[0]!.id, email };
};
```

In `tests/support/spaces.ts`, add before the line `import { POST as createInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/route";`:

```ts
import { POST as acceptInvitation } from "@/app/api/v1/invitations/[token]/accept/route";
```

and append:

```ts
/** `member` joins the space through a link invitation created by `owner` with `role`. */
export const joinAs = async (
  owner: TestUser,
  spaceId: string,
  member: TestUser,
  role: "ADMIN" | "MEMBER" | "VIEWER",
): Promise<void> => {
  const token = await inviteByLink(owner, spaceId, role);
  const response = await call(acceptInvitation, "POST", `/api/v1/invitations/${token}/accept`, {
    user: member,
    params: { token },
  });
  if (response.status !== 200) throw new Error(`joining failed with status ${response.status}`);
};
```

In `tests/acceptance/invitations.test.ts`:

1. Add after the line `import { POST as createInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/route";`:

```ts
import { POST as acceptInvitation } from "@/app/api/v1/invitations/[token]/accept/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
```

2. Replace the line `import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";` with:

```ts
import { call, problemOf, registerUser, startTestApp, uniqueEmail, type TestUser } from "../support/app";
```

3. Replace the line `import { newSharedSpace, tokenOf } from "../support/spaces";` with:

```ts
import { inviteByLink, joinAs, newSharedSpace, tokenOf } from "../support/spaces";
```

4. Append:

```ts
const accept = (user: TestUser | undefined, token: string) =>
  call(acceptInvitation, "POST", `/api/v1/invitations/${token}/accept`, { user, params: { token } });
const emailInvitation = async (owner: TestUser, spaceId: string, email: string) => {
  const body = await (await invite(owner, spaceId, { kind: "EMAIL", email, role: "MEMBER" })).json();
  return { id: body.invitation.id as string, token: tokenOf(body.url) };
};
const statusOf = async (invitationId: string) =>
  (await app.pool.query("SELECT status FROM space_invitations WHERE id = $1", [invitationId])).rows[0].status;
const membersOf = async (user: TestUser, spaceId: string) => {
  const response = await call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, { user, params: { spaceId } });
  return ((await response.json()) as { items: { userId: string | null; displayName: string; role: string | null }[] })
    .items;
};

describe("accept an invitation (HU-E1-07)", () => {
  it("makes the signed-in invitee a MEMBER with joinedAt set and marks the invitation ACCEPTED", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const spaceId = await newSharedSpace(ana);
    const { id, token } = await emailInvitation(ana, spaceId, juan.email);
    const response = await accept(juan, token);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: spaceId, name: "Household", kind: "SHARED", role: "MEMBER" });
    expect(await membersOf(ana, spaceId)).toContainEqual(
      expect.objectContaining({ userId: juan.userId, displayName: "Juan", role: "MEMBER", joinedAt: expect.any(String) }),
    );
    expect(await statusOf(id)).toBe("ACCEPTED");
  });

  it("lets a visitor sign up first and then accept with the token", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    const email = uniqueEmail("juan");
    const { id, token } = await emailInvitation(ana, spaceId, email);
    const juan = await registerUser("Juan", email);
    expect((await accept(juan, token)).status).toBe(200);
    expect(await membersOf(ana, spaceId)).toContainEqual(
      expect.objectContaining({ userId: juan.userId, role: "MEMBER" }),
    );
    expect(await statusOf(id)).toBe("ACCEPTED");
  });

  it("rejects an invitation created 8 days ago", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const spaceId = await newSharedSpace(ana);
    const { id, token } = await emailInvitation(ana, spaceId, juan.email);
    await app.pool.query(
      "UPDATE space_invitations SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = $1",
      [id],
    );
    expect(await problemOf(await accept(juan, token))).toEqual([409, "InvitationExpired"]);
  });

  it("rejects another account for an email-bound invitation", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const luis = await registerUser("Luis");
    const spaceId = await newSharedSpace(ana);
    const { token } = await emailInvitation(ana, spaceId, juan.email);
    expect(await problemOf(await accept(luis, token))).toEqual([403, "InvitationEmailMismatch"]);
  });

  it("rejects a revoked invitation", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const spaceId = await newSharedSpace(ana);
    const { id, token } = await emailInvitation(ana, spaceId, juan.email);
    expect((await revoke(ana, spaceId, id)).status).toBe(200);
    expect(await problemOf(await accept(juan, token))).toEqual([409, "InvitationRevoked"]);
  });

  it("cannot be replayed, not even by two concurrent requests (Review Focus 2)", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const spaceId = await newSharedSpace(ana);
    const { token } = await emailInvitation(ana, spaceId, juan.email);
    const [first, second] = await Promise.all([accept(juan, token), accept(juan, token)]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(await problemOf(await accept(juan, token))).toEqual([409, "InvitationAlreadyUsed"]);
    const { rows } = await app.pool.query(
      "SELECT count(*)::int AS n FROM space_members WHERE space_id = $1 AND user_id = $2",
      [spaceId, juan.userId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("answers an unknown token with 404 and an anonymous caller with 401", async () => {
    const juan = await registerUser("Juan");
    expect(await problemOf(await accept(juan, "not-a-token"))).toEqual([404, "InvitationNotFound"]);
    expect(await problemOf(await accept(undefined, "not-a-token"))).toEqual([401, "Unauthenticated"]);
  });

  it("keeps a link invitation valid for several people and rejects a second join", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const luis = await registerUser("Luis");
    const spaceId = await newSharedSpace(ana);
    const token = await inviteByLink(ana, spaceId, "VIEWER");
    expect((await accept(juan, token)).status).toBe(200);
    expect((await accept(luis, token)).status).toBe(200);
    expect(await problemOf(await accept(juan, token))).toEqual([409, "AlreadyMember"]);
  });
});

describe("inviting an existing member (HU-E1-06)", () => {
  it("rejects the email of a current member", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const spaceId = await newSharedSpace(ana);
    await joinAs(ana, spaceId, juan, "MEMBER");
    expect(await problemOf(await invite(ana, spaceId, { kind: "EMAIL", email: juan.email, role: "MEMBER" }))).toEqual([
      409,
      "AlreadyMember",
    ]);
  });
});
```

Run: `pnpm exec vitest run --project unit src/shared/http/problem.test.ts && pnpm exec vitest run --project acceptance tests/acceptance/invitations.test.ts`
Expected: FAIL — `maps InvitationEmailMismatch to 403` (got 409) and `Failed to resolve import "@/app/api/v1/invitations/[token]/accept/route"`.

- [ ] **Step 2: Status map, contract, route and wiring**

In `src/shared/http/problem.ts`, add after the line `  ["AccountNotInSpace", 422],`:

```ts
  ["InvitationEmailMismatch", 403],
```

In `src/modules/spaces/contracts/spaces.contract.ts`, insert just before the last line of the file (the `};` that closes `spacesPaths`):

```ts
  "/api/v1/invitations/{token}/accept": {
    post: {
      operationId: "acceptInvitation",
      summary: "Join the invitation's space as the signed-in user, with the invited role",
      ...securedByUser,
      requestParams: { path: z.object({ token: z.string() }) },
      responses: {
        "200": { description: "The joined space", content: jsonContent(SpaceSummarySchema) },
        ...problems({
          "401": "Unauthenticated",
          "403": "InvitationEmailMismatch",
          "404": "InvitationNotFound, SpaceNotFound",
          "409": "InvitationExpired, InvitationRevoked, InvitationAlreadyUsed, AlreadyMember, MemberNameTaken",
        }),
      },
    },
  },
```

`src/app/api/v1/invitations/[token]/accept/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.acceptInvitation({
      token: params.token!,
      userId: user!.id,
      userEmail: user!.email,
      userName: user!.name,
    });
    return result.ok ? ok({ status: 200, body: result.value }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Extend the import from `@/modules/spaces/application` with `createAcceptInvitation`, `type AcceptInvitation`.
2. In the `Container` interface, add after the line `    readonly revokeInvitation: RevokeInvitation;`:

```ts
    readonly acceptInvitation: AcceptInvitation;
```

3. In the returned `spaces` object, add after the line `      revokeInvitation: createRevokeInvitation(invitationsDeps),`:

```ts
      acceptInvitation: createAcceptInvitation(invitationsDeps),
```

- [ ] **Step 3: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project unit src/shared/http && pnpm exec vitest run --project acceptance`
Expected: PASS (all acceptance files; M1 files still call `registerUser(name)` and ignore `email`).

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `POST /api/v1/invitations/{token}/accept`; components are unchanged.

- [ ] **Step 4: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/modules/spaces/contracts/spaces.contract.ts src/shared/http/problem.ts src/shared/http/problem.test.ts "src/app/api/v1/invitations" src/composition/container.ts openapi/openapi.snapshot.json tests/support/app.ts tests/support/spaces.ts tests/acceptance/invitations.test.ts
git commit -m "feat(spaces): expose the invitation accept endpoint (Refs #16, Refs #15)"
```

---

### Task 16: HTTP — guest members

Exposes HU-E1-10 (issue #19): `POST /api/v1/spaces/{spaceId}/guests` (`201 SpaceMember` of kind `GUEST`); guests appear in `GET /api/v1/spaces/{spaceId}/members`. Pins Review Focus 4 over HTTP: a guest's contact email creates no user, so signing in with it fails.

Decision: body `{ "displayName": "Pedro", "contactEmail": "pedro@example.com" }`; `contactEmail` is optional and validated as an email by the contract (`ValidationFailed`); length and uniqueness rules stay in the domain (`InvalidMemberName`, `MemberNameTaken`).

**Files:**
- Modify: `src/modules/spaces/contracts/spaces.contract.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`
- Create: `src/app/api/v1/spaces/[spaceId]/guests/route.ts`
- Test: `tests/acceptance/guests.test.ts`

**Interfaces:**
- Consumes: `createAddGuestMember`, `AddGuestMember` (Task 5); container local `membersDeps` (Task 13); `memberDto`, `SpaceMemberSchema`, `SpacePath` (Task 13); `joinAs`, `newSharedSpace` (Tasks 13, 15); `uniqueEmail`, `registerUser`, `call`, `startTestApp` (`tests/support/app.ts`), `problemOf` (Task 13); sign-in route (M0).
- Produces: `AddGuestBodySchema`; `POST /api/v1/spaces/{spaceId}/guests` → `201 SpaceMember`; `Container.spaces.addGuest`.

- [ ] **Step 1: Write the failing acceptance test**

`tests/acceptance/guests.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as signIn } from "@/app/api/v1/auth/sign-in/route";
import { POST as addGuest } from "@/app/api/v1/spaces/[spaceId]/guests/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, uniqueEmail, type TestUser } from "../support/app";
import { joinAs, newSharedSpace } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface Household {
  readonly spaceId: string;
  readonly ana: TestUser;
  readonly luis: TestUser;
  readonly sofi: TestUser;
}

/** HU-E1-10 Background: "Household" with OWNER Ana, MEMBER Luis and VIEWER Sofi. */
const household = async (): Promise<Household> => {
  const ana = await registerUser("Ana");
  const luis = await registerUser("Luis");
  const sofi = await registerUser("Sofi");
  const spaceId = await newSharedSpace(ana);
  await joinAs(ana, spaceId, luis, "MEMBER");
  await joinAs(ana, spaceId, sofi, "VIEWER");
  return { spaceId, ana, luis, sofi };
};
const add = (user: TestUser, spaceId: string, body: unknown) =>
  call(addGuest, "POST", `/api/v1/spaces/${spaceId}/guests`, { user, params: { spaceId }, body });

describe("guest members (HU-E1-10)", () => {
  it("lets a member add a guest with a contact email, with no user and no role", async () => {
    const h = await household();
    const email = uniqueEmail("pedro");
    const response = await add(h.luis, h.spaceId, { displayName: "Pedro", contactEmail: email });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: expect.any(String),
      kind: "GUEST",
      userId: null,
      displayName: "Pedro",
      role: null,
      contactEmail: email,
      joinedAt: expect.any(String),
    });
  });

  it("lists the guest among the current members", async () => {
    const h = await household();
    await add(h.luis, h.spaceId, { displayName: "Pedro" });
    const response = await call(listMembers, "GET", `/api/v1/spaces/${h.spaceId}/members`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    const { items } = (await response.json()) as { items: { displayName: string; kind: string }[] };
    expect(items.map((m) => [m.displayName, m.kind])).toEqual([
      ["Ana", "USER"],
      ["Luis", "USER"],
      ["Sofi", "USER"],
      ["Pedro", "GUEST"],
    ]);
  });

  it("does not let a viewer add guests", async () => {
    const h = await household();
    expect(await problemOf(await add(h.sofi, h.spaceId, { displayName: "Pedro" }))).toEqual([403, "InsufficientRole"]);
  });

  it("requires a display name unique among current members, ignoring case", async () => {
    const h = await household();
    expect((await add(h.luis, h.spaceId, { displayName: "Pedro" })).status).toBe(201);
    expect(await problemOf(await add(h.luis, h.spaceId, { displayName: "pedro" }))).toEqual([409, "MemberNameTaken"]);
    expect(await problemOf(await add(h.luis, h.spaceId, { displayName: "ANA" }))).toEqual([409, "MemberNameTaken"]);
    expect(await problemOf(await add(h.luis, h.spaceId, { displayName: "   " }))).toEqual([422, "InvalidMemberName"]);
    expect(await problemOf(await add(h.luis, h.spaceId, { displayName: "Lina", contactEmail: "nope" }))).toEqual([
      422,
      "ValidationFailed",
    ]);
  });

  it("gives the guest no sign-in, no user and therefore no personal space (Review Focus 4)", async () => {
    const h = await household();
    const email = uniqueEmail("pedro");
    await add(h.luis, h.spaceId, { displayName: "Pedro", contactEmail: email });
    const response = await call(signIn, "POST", "/api/v1/auth/sign-in", {
      body: { email, password: "any-password-123" },
    });
    expect(await problemOf(response)).toEqual([401, "InvalidCredentials"]);
    const users = await app.pool.query('SELECT count(*)::int AS n FROM "user" WHERE email = $1', [email]);
    expect(users.rows[0].n).toBe(0);
    const rows = await app.pool.query("SELECT user_id, role FROM space_members WHERE contact_email = $1", [email]);
    expect(rows.rows).toEqual([{ user_id: null, role: null }]);
  });

  it("refuses guests in a personal space", async () => {
    const ana = await registerUser("Ana");
    expect(await problemOf(await add(ana, ana.spaceId, { displayName: "Pedro" }))).toEqual([
      409,
      "PersonalSpaceNotShareable",
    ]);
  });
});
```

Run: `pnpm exec vitest run --project acceptance tests/acceptance/guests.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/guests/route"`.

- [ ] **Step 2: Contract, route and wiring**

In `src/modules/spaces/contracts/spaces.contract.ts`:

1. Add after the line `export const ListMembersResponseSchema = z.object({ items: z.array(SpaceMemberSchema) });`:

```ts
/** HU-E1-10: name rules (length, uniqueness ignoring case) live in the domain; the cap only bounds the payload. */
export const AddGuestBodySchema = z.object({
  displayName: z.string().max(200),
  contactEmail: z.email().max(254).optional(),
});
```

2. Insert just before the last line of the file (the `};` that closes `spacesPaths`):

```ts
  "/api/v1/spaces/{spaceId}/guests": {
    post: {
      operationId: "addGuestMember",
      summary: "Add someone without an account as a guest member (no user, no role, cannot sign in)",
      ...securedByUser,
      requestParams: { path: SpacePath },
      requestBody: { content: jsonContent(AddGuestBodySchema) },
      responses: {
        "201": { description: "The new guest member", content: jsonContent(SpaceMemberSchema) },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound",
          "409": "MemberNameTaken, PersonalSpaceNotShareable",
          "422": "ValidationFailed, InvalidMemberName",
        }),
      },
    },
  },
```

`src/app/api/v1/spaces/[spaceId]/guests/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { AddGuestBodySchema, memberDto } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: AddGuestBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().spaces.addGuest({
      spaceId: params.spaceId!,
      userId: user!.id,
      displayName: body.displayName,
      contactEmail: body.contactEmail,
    });
    return result.ok ? ok({ status: 201, body: memberDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Extend the import from `@/modules/spaces/application` with `createAddGuestMember`, `type AddGuestMember`.
2. In the `Container` interface, add after the line `    readonly acceptInvitation: AcceptInvitation;`:

```ts
    readonly addGuest: AddGuestMember;
```

3. In the returned `spaces` object, add after the line `      acceptInvitation: createAcceptInvitation(invitationsDeps),`:

```ts
      addGuest: createAddGuestMember(membersDeps),
```

- [ ] **Step 3: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance`
Expected: PASS.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `POST /api/v1/spaces/{spaceId}/guests`; components are unchanged (`SpaceMember` stays response-only, so no `SpaceMemberOutput`).

- [ ] **Step 4: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/modules/spaces/contracts/spaces.contract.ts "src/app/api/v1/spaces/[spaceId]/guests/route.ts" src/composition/container.ts openapi/openapi.snapshot.json tests/acceptance/guests.test.ts
git commit -m "feat(spaces): expose the guest member endpoint (Refs #19)"
```

---

### Task 17: HTTP — change roles, the permission matrix over HTTP, and the shared fund

Exposes `PATCH /api/v1/spaces/{spaceId}/members/{memberId}` (HU-E1-05, issue #14) and proves the permission matrix end to end for every row whose action exists over HTTP, plus HU-E2-02 (issue #24) through the existing accounts endpoint. Pins Review Focus 3 and 5 over HTTP.

Decisions:
- Body `{ "role": "ADMIN" }` (one of the four role names, otherwise `ValidationFailed`); response `200 SpaceMember`.
- Rows of the HU-E1-05 outline whose actions arrive later are pinned by the policy test (Task 1) only: "archive the space" (HU-E1-09), "view balances" (HU-E5-01; reading the space's transactions stands in here), "record an expense paid by Pedro" (HU-E4-07) and "record a settlement for Pedro" (HU-E5-02). Those stories call `authorizeSpaceAction` with the actions already in the matrix.
- Members record shared-space expenses from their own personal accounts (D9, M1 `ownAccount`), which is how the matrix test exercises `money.record` before HU-E4-07.

**Files:**
- Modify: `src/modules/spaces/contracts/spaces.contract.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`, `tests/acceptance/accounts.test.ts`
- Create: `src/app/api/v1/spaces/[spaceId]/members/[memberId]/route.ts`
- Test: `tests/acceptance/roles.test.ts`

**Interfaces:**
- Consumes: `createChangeMemberRole`, `ChangeMemberRole` (Task 4); container local `membersDeps` (Task 13); `memberDto`, `SpaceMemberSchema`, `RoleSchema`, `SpacePath` (Task 13); `newSharedSpace`, `actingIn`, `joinAs` (Tasks 13, 15); `problemOf` (Task 13); M1 routes for accounts, categories, expenses, transactions and the space; Task 9 (shared fund rule).
- Produces: `ChangeMemberRoleBodySchema`; `PATCH /api/v1/spaces/{spaceId}/members/{memberId}` → `200 SpaceMember`; `Container.spaces.changeMemberRole`.

- [ ] **Step 1: Write the failing acceptance tests**

`tests/acceptance/roles.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { GET as listCategories } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as addGuest } from "@/app/api/v1/spaces/[spaceId]/guests/route";
import { POST as createInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/route";
import { PATCH as changeRole } from "@/app/api/v1/spaces/[spaceId]/members/[memberId]/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { GET as getSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { PATCH as editTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { joinAs, newSharedSpace } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** HU-E1-05 Background: "Household" with OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi and the guest Pedro. */
interface Team {
  readonly spaceId: string;
  readonly ana: TestUser;
  readonly juan: TestUser;
  readonly luis: TestUser;
  readonly sofi: TestUser;
  readonly pedroId: string;
  readonly groceries: string;
  /** Personal BANK account per user id (D9: members pay shared expenses from their own accounts). */
  readonly accounts: ReadonlyMap<string, string>;
}

const cop = (pesos: number) => ({ amount: String(pesos * 100), currency: "COP" });
/** `[status, null]` for a success, `[status, code]` for a problem. */
const outcome = async (pending: Promise<Response>): Promise<[number, string | null]> => {
  const response = await pending;
  if (response.status >= 400) return problemOf(response);
  return [response.status, null];
};
const personalAccount = async (user: TestUser) => {
  const response = await call(createAccount, "POST", `/api/v1/spaces/${user.spaceId}/accounts`, {
    user,
    params: { spaceId: user.spaceId },
    body: { name: "Bancolombia", type: "BANK", openingBalance: cop(2_000_000) },
  });
  return ((await response.json()) as { id: string }).id;
};
const groceriesOf = async (user: TestUser, spaceId: string) => {
  const response = await call(listCategories, "GET", `/api/v1/spaces/${spaceId}/categories`, {
    user,
    params: { spaceId },
  });
  const { items } = (await response.json()) as { items: { categories: { id: string; key: string | null }[] }[] };
  return items.flatMap((g) => g.categories).find((c) => c.key === "groceries")!.id;
};
const team = async (): Promise<Team> => {
  const ana = await registerUser("Ana");
  const juan = await registerUser("Juan");
  const luis = await registerUser("Luis");
  const sofi = await registerUser("Sofi");
  const spaceId = await newSharedSpace(ana);
  await joinAs(ana, spaceId, juan, "ADMIN");
  await joinAs(ana, spaceId, luis, "MEMBER");
  await joinAs(ana, spaceId, sofi, "VIEWER");
  const pedro = await call(addGuest, "POST", `/api/v1/spaces/${spaceId}/guests`, {
    user: luis,
    params: { spaceId },
    body: { displayName: "Pedro" },
  });
  const accounts = new Map<string, string>();
  for (const user of [ana, luis, sofi]) accounts.set(user.userId, await personalAccount(user));
  return {
    spaceId,
    ana,
    juan,
    luis,
    sofi,
    pedroId: ((await pedro.json()) as { id: string }).id,
    groceries: await groceriesOf(ana, spaceId),
    accounts,
  };
};
const path = (t: Team, resource: string) => `/api/v1/spaces/${t.spaceId}/${resource}`;
const invite = (t: Team, user: TestUser) =>
  call(createInvitation, "POST", path(t, "invitations"), {
    user,
    params: { spaceId: t.spaceId },
    body: { kind: "LINK", role: "MEMBER" },
  });
const expense = (t: Team, user: TestUser) =>
  call(recordExpense, "POST", path(t, "expenses"), {
    user,
    params: { spaceId: t.spaceId },
    body: { description: "Market", amount: cop(85_000), categoryId: t.groceries, accountId: t.accounts.get(user.userId)! },
  });
const edit = (t: Team, user: TestUser, transactionId: string) =>
  call(editTransaction, "PATCH", path(t, `transactions/${transactionId}`), {
    user,
    params: { spaceId: t.spaceId, transactionId },
    body: { description: "Market (edited)" },
  });
const transactions = (t: Team, user: TestUser) =>
  call(listTransactions, "GET", path(t, "transactions"), { user, params: { spaceId: t.spaceId } });
const guest = (t: Team, user: TestUser, displayName: string) =>
  call(addGuest, "POST", path(t, "guests"), { user, params: { spaceId: t.spaceId }, body: { displayName } });
const memberIdOf = async (t: Team, name: string) => {
  const response = await call(listMembers, "GET", path(t, "members"), { user: t.ana, params: { spaceId: t.spaceId } });
  const { items } = (await response.json()) as { items: { id: string; displayName: string }[] };
  return items.find((m) => m.displayName === name)!.id;
};
const setRole = (t: Team, user: TestUser, memberId: string, role: string) =>
  call(changeRole, "PATCH", path(t, `members/${memberId}`), {
    user,
    params: { spaceId: t.spaceId, memberId },
    body: { role },
  });

describe("permissions per role (HU-E1-05)", () => {
  let t: Team;
  beforeAll(async () => {
    t = await team();
  });

  it("lets Juan (ADMIN) invite a member but not Luis (MEMBER)", async () => {
    expect(await outcome(invite(t, t.juan))).toEqual([201, null]);
    expect(await outcome(invite(t, t.luis))).toEqual([403, "InsufficientRole"]);
  });

  it("lets Luis (MEMBER) record an expense but not Sofi (VIEWER)", async () => {
    expect(await outcome(expense(t, t.luis))).toEqual([201, null]);
    expect(await outcome(expense(t, t.sofi))).toEqual([403, "InsufficientRole"]);
  });

  it("lets Juan (ADMIN) edit an expense created by Ana but not Luis (MEMBER)", async () => {
    const created = (await (await expense(t, t.ana)).json()) as { id: string };
    expect(await outcome(edit(t, t.luis, created.id))).toEqual([403, "InsufficientRole"]);
    expect(await outcome(edit(t, t.juan, created.id))).toEqual([200, null]);
  });

  it("lets Sofi (VIEWER) read the space's money records", async () => {
    // "view balances" arrives with HU-E5-01; reading the transactions exercises the same space.read action.
    expect(await outcome(transactions(t, t.sofi))).toEqual([200, null]);
  });

  it("lets Luis (MEMBER) add a guest but not Sofi (VIEWER)", async () => {
    expect(await outcome(guest(t, t.luis, "Marta"))).toEqual([201, null]);
    expect(await outcome(guest(t, t.sofi, "Lina"))).toEqual([403, "InsufficientRole"]);
  });

  it("answers 404 SpaceNotFound to Marta, who is neither a member nor a guest", async () => {
    const marta = await registerUser("Marta");
    expect(await outcome(transactions(t, marta))).toEqual([404, "SpaceNotFound"]);
  });

  it("refuses role escalation, guest roles, unknown members and unknown roles (Review Focus 3, 5)", async () => {
    expect(await outcome(setRole(t, t.juan, await memberIdOf(t, "Juan"), "OWNER"))).toEqual([403, "InsufficientRole"]);
    expect(await outcome(setRole(t, t.luis, await memberIdOf(t, "Sofi"), "ADMIN"))).toEqual([403, "InsufficientRole"]);
    expect(await outcome(setRole(t, t.ana, t.pedroId, "MEMBER"))).toEqual([409, "GuestHasNoRole"]);
    expect(await outcome(setRole(t, t.ana, "not-a-uuid", "ADMIN"))).toEqual([404, "MemberNotFound"]);
    expect(await outcome(setRole(t, t.ana, await memberIdOf(t, "Luis"), "SUPERUSER"))).toEqual([
      422,
      "ValidationFailed",
    ]);
  });

  it("refuses to demote the only OWNER", async () => {
    expect(await outcome(setRole(t, t.ana, await memberIdOf(t, "Ana"), "ADMIN"))).toEqual([409, "LastOwnerRequired"]);
  });
});

describe("owner changes a member's role (HU-E1-05)", () => {
  it("makes Luis an ADMIN, which Luis then sees in the space", async () => {
    const t = await team();
    const response = await setRole(t, t.ana, await memberIdOf(t, "Luis"), "ADMIN");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ displayName: "Luis", kind: "USER", role: "ADMIN" });
    const seen = await call(getSpace, "GET", `/api/v1/spaces/${t.spaceId}`, {
      user: t.luis,
      params: { spaceId: t.spaceId },
    });
    expect((await seen.json()).role).toBe("ADMIN");
  });
});
```

In `tests/acceptance/accounts.test.ts`:

1. Add after the line `import { call, registerUser, startTestApp, type TestUser } from "../support/app";`:

```ts
import { actingIn, joinAs, newSharedSpace } from "../support/spaces";
```

2. Append:

```ts
describe("shared fund account (HU-E2-02)", () => {
  it("lets the owner create the household fund, keeps members out and personal types away", async () => {
    // Background: "Ana" is OWNER and "Juan" is MEMBER of the shared space "Household".
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const spaceId = await newSharedSpace(ana);
    await joinAs(ana, spaceId, juan, "MEMBER");
    const asAna = actingIn(ana, spaceId);
    const fund = await create(asAna, { name: "Household Fund", type: "SHARED_FUND", openingBalance: cop(0) });
    expect(fund.status).toBe(201);
    const created = await fund.json();
    expect(created).toMatchObject({
      name: "Household Fund",
      type: "SHARED_FUND",
      ownerUserId: null,
      openingBalance: cop(0),
      balance: cop(0),
    });
    expect((await list(asAna)).body.items.map((a: AccountDto) => a.id)).toEqual([created.id]);
    const byJuan = await create(actingIn(juan, spaceId), {
      name: "Juan Fund",
      type: "SHARED_FUND",
      openingBalance: cop(0),
    });
    expect([byJuan.status, (await byJuan.json()).code]).toEqual([403, "InsufficientRole"]);
    const bank = await create(asAna, { name: "Bancolombia", type: "BANK", openingBalance: cop(0) });
    expect([bank.status, (await bank.json()).code]).toEqual([409, "PersonalAccountRequiresPersonalSpace"]);
  });
});
```

Run: `pnpm exec vitest run --project acceptance tests/acceptance/roles.test.ts tests/acceptance/accounts.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/members/[memberId]/route"` (the shared-fund scenario passes already, because Task 9 changed the use case).

- [ ] **Step 2: Contract, route and wiring**

In `src/modules/spaces/contracts/spaces.contract.ts`:

1. Add after the line `export const ListMembersResponseSchema = z.object({ items: z.array(SpaceMemberSchema) });`:

```ts
export const ChangeMemberRoleBodySchema = z.object({ role: RoleSchema });
```

2. Add after the line `const InvitationPath = SpacePath.extend({ invitationId: z.string() });`:

```ts
const MemberPath = SpacePath.extend({ memberId: z.string() });
```

3. Insert just before the last line of the file (the `};` that closes `spacesPaths`):

```ts
  "/api/v1/spaces/{spaceId}/members/{memberId}": {
    patch: {
      operationId: "changeMemberRole",
      summary: "Change a registered member's role (OWNER only); a space keeps at least one OWNER",
      ...securedByUser,
      requestParams: { path: MemberPath },
      requestBody: { content: jsonContent(ChangeMemberRoleBodySchema) },
      responses: {
        "200": { description: "The member with the new role", content: jsonContent(SpaceMemberSchema) },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound, MemberNotFound",
          "409": "LastOwnerRequired, GuestHasNoRole",
          "422": "ValidationFailed",
        }),
      },
    },
  },
```

`src/app/api/v1/spaces/[spaceId]/members/[memberId]/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ChangeMemberRoleBodySchema, memberDto } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const PATCH = defineRoute({
  auth: "required",
  body: ChangeMemberRoleBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().spaces.changeMemberRole({
      spaceId: params.spaceId!,
      userId: user!.id,
      memberId: params.memberId!,
      role: body.role,
    });
    return result.ok ? ok({ status: 200, body: memberDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Extend the import from `@/modules/spaces/application` with `createChangeMemberRole`, `type ChangeMemberRole`.
2. In the `Container` interface, add after the line `    readonly addGuest: AddGuestMember;`:

```ts
    readonly changeMemberRole: ChangeMemberRole;
```

3. In the returned `spaces` object, add after the line `      addGuest: createAddGuestMember(membersDeps),`:

```ts
      changeMemberRole: createChangeMemberRole(membersDeps),
```

- [ ] **Step 3: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance`
Expected: PASS (all acceptance files).

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `PATCH /api/v1/spaces/{spaceId}/members/{memberId}`; components are unchanged.

- [ ] **Step 4: Full gates and build**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check && pnpm check:pinned && pnpm build`
Expected: all exit 0; the build route list contains `/api/v1/invitations/[token]/accept`, `/api/v1/spaces/[spaceId]/members`, `/api/v1/spaces/[spaceId]/members/[memberId]`, `/api/v1/spaces/[spaceId]/guests`, `/api/v1/spaces/[spaceId]/invitations` and `/api/v1/spaces/[spaceId]/invitations/[invitationId]/revoke`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/spaces/contracts/spaces.contract.ts "src/app/api/v1/spaces/[spaceId]/members/[memberId]/route.ts" src/composition/container.ts openapi/openapi.snapshot.json tests/acceptance/roles.test.ts tests/acceptance/accounts.test.ts
git commit -m "feat(spaces): expose role changes and enforce the permission matrix over HTTP (Refs #14, Refs #24)"
```

---

## Self-Review

### Story coverage

| Story | Scenario → where it is tested |
|---|---|
| HU-E1-04 (#13) | User creates a household space (SHARED, Ana OWNER, categories seeded) → Tasks 2, 3, 11, 13 · Name is required → Tasks 2, 3, 13 · Unsupported currency → Tasks 2, 3, 13 (code `UnknownCurrency`, assumption 3) |
| HU-E1-05 (#14) | Outline rows: Ana/Juan archive the space → Task 1 (policy; `ArchiveSpace` is HU-E1-09) · Juan/Luis invite a member → Tasks 1, 7, 17 · Luis/Sofi record an expense → Tasks 1, 17 · Luis/Juan edit an expense created by Ana → Tasks 1, 17 (M1 `canModify`) · Sofi views balances → Task 1 (policy; balances are HU-E5-01), Task 17 (reads transactions) · Luis/Sofi add a guest → Tasks 1, 5, 16, 17 · Luis records an expense paid by Pedro → Task 1 (policy; guest payers are HU-E4-07) · Sofi records a settlement for Pedro → Task 1 (policy; settlements are HU-E5-02) · Non-members are rejected → Tasks 1, 4, 13, 17 · Owner changes a member's role → Tasks 2, 4, 11, 17 · The last owner cannot be demoted → Tasks 2, 4, 11 (concurrent), 17 |
| HU-E1-06 (#15) | Create an email invitation (pending, bound, 7 days, email sent) → Tasks 6, 7, 12, 14 (sent through `EmailSender`; v1 binds a disabled sender, assumption 2) · Create a shareable link invitation (unique unguessable token, URL carries only the token) → Tasks 6, 7, 12, 14 · Invitations cannot grant OWNER → Tasks 6, 7, 10 (check), 14 · Inviting an existing member is rejected → Tasks 7, 15 · Revoke a pending invitation → Tasks 6, 7, 12, 14 |
| HU-E1-07 (#16) | Signed-in invitee accepts (MEMBER, joinedAt, ACCEPTED) → Tasks 8, 12, 15 · Visitor without an account signs up first → Task 15 · Expired invitation (8 days) → Tasks 6, 8, 15 · Email-bound invitation accepted by another account → Tasks 6, 8, 15 · Revoked invitation → Tasks 6, 8, 15 |
| HU-E1-10 (#19) | Member adds a guest with a name (GUEST, no user, no role, joinedAt) → Tasks 2, 5, 11, 16 · Guest listed as current member → Tasks 4, 5, 16; "accepted as payer and participant of a new expense" → deferred to HU-E4-07 (M2-B; assumption 13) · Viewer cannot add guests → Tasks 1, 5, 16 · Display name unique among current members (case-insensitive) → Tasks 2, 5, 10, 11 (concurrent), 16 · A guest cannot sign in and has no personal space → Task 16 · Guests cannot be added to a personal space → Tasks 2, 5, 16 |
| HU-E2-02 (#24) | Admin creates the household fund (belongs to Household, ownerUserId empty) → Tasks 9 (OWNER and ADMIN), 17 · Member cannot create a shared fund → Tasks 9, 17 · Personal account types are not allowed in a shared space → Tasks 9, 17 (M1 `openAccount`) |
| HU-E1-02 (#11, regression) | "A second personal space cannot be created" now reachable over HTTP → Tasks 3, 13 · "Personal spaces cannot receive members" over HTTP → Tasks 7, 14 |

Spec checks: §5.2 Space (`SHARED`, currency, `MONTHLY(1)`) → Tasks 2, 3, 13; §5.2 SpaceMember (kind, `userId`/`role` null for guests, `contactEmail` guests only, `joinedAt`) and D15 → Tasks 2, 5, 10, 11, 16; §5.2 Account (`SHARED_FUND` ⇔ shared space and `ownerUserId` null) → Tasks 9, 17; D6 (one currency per space) → Tasks 2, 13; D14 (default `MONTHLY(1)`) → Tasks 2, 13; D16 (no direct `DIRECT` creation) → Task 13; §7 (authorization in use cases, problem+json, versioned paths, OpenAPI snapshot) → Tasks 1, 4–9, 13–17; §8 (non-members `404 SpaceNotFound`, `403 InsufficientRole`, `404 *NotFound`, `422 Invalid*`, `409` conflicts) → Tasks 13–17 and the `problem.test.ts` rows of Task 15; §9 (domain unit, use cases with in-memory adapters, repositories on PostgreSQL, acceptance over route handlers, OpenAPI snapshot) → every task.

### Review Focus pins

1. Replayed, expired, revoked or garbage tokens → Task 6 (exact 7-day boundary, rejection order), Task 8 (use case, replay, unknown token), Task 15 (HTTP, 8-day-old invitation, unknown token).
2. Concurrent acceptance → Task 12 (two transactions on PostgreSQL: email → one `InvitationAlreadyUsed`, link → one `AlreadyMember`, one membership row), Task 15 (parallel HTTP requests).
3. Role escalation and owner lockout → Task 1 (only OWNER changes roles), Task 4 (escalation attempts, actor re-check on locked rows), Task 7 (`InvalidInvitationRole`), Task 10 (role check on invitations), Task 11 (two owners demoting each other at once), Task 17 (HTTP).
4. Guests given a role, a user, an account or a sign-in → Task 2 (`GuestHasNoRole`), Task 4, Task 10 (check constraints matched by name, red before the migration), Task 16 (sign-in with the contact email answers `401`, no user row).
5. Malformed or foreign identifiers → Task 11 (`listCurrent` on a malformed id), Task 12 (`findForUpdate` on malformed and foreign ids), Task 4 (`MemberNotFound`), Tasks 13, 14, 15, 17 (HTTP 404s).

### Spec contradictions found

1. **`UnsupportedCurrency` vs `UnknownCurrency`.** HU-E1-04 expects `UnsupportedCurrency` for `XYZ`; the kernel (`currencyOf`, M0) and every M1 endpoint (HU-E1-03 PATCH, money parsing) answer `UnknownCurrency` for the same condition. This plan keeps one code per condition (`UnknownCurrency`, 422). If the owner prefers the backlog's name, rename the kernel code in one follow-up commit (kernel, `problem.ts`, M1 tests, contracts).
2. **Link invitations: single-use or multi-use.** HU-E1-07's technical note says link invitations stay valid until expiry or revocation (multi-use) and only email invitations are single-use; the plan follows the backlog (Task 6). Claim links (HU-E1-11) are single-use by their own rule.
3. **"An invitation email is sent" vs no SMTP in v1.** HU-E1-06 expects an email; its technical note says the email path is disabled when SMTP is not configured, and the global constraint forbids new dependencies (an SMTP client). The plan adds the `EmailSender` port (tested with a recording sender) and binds a disabled sender in production; email invitations stay bound to their address (HU-E1-07's mismatch scenario needs them, so they are kept rather than offering only links) and the response carries the URL. The port is named `EmailSender` as in the backlog. A follow-up issue for the SMTP adapter is opened, and the pull request states that #15's "an invitation email is sent" step is satisfied at port level only.
4. **Former members rejoining vs the M0 unique constraint.** HU-E1-07 says a former member who accepts again gets a new `SpaceMember` row, which M0's `unique (space_id, user_id)` forbids; migration 0006 replaces it with a partial unique index over current members (Task 10).
5. **Scenarios that depend on later stories.** HU-E1-10 "accepted as payer and participant" needs HU-E4-07; HU-E1-05 rows "archive", "view balances", "expense paid by Pedro" and "settlement for Pedro" need HU-E1-09, HU-E5-01, HU-E4-07 and HU-E5-02. They are pinned at the policy level here.

### Assumptions

1. **Invitation lifecycle** — email invitations single-use, link invitations multi-use until expiry or revocation; both expire exactly 7 days after creation; revocation wins over use and expiry in error order; revoking twice is a no-op; a used email invitation cannot be revoked (`InvitationAlreadyUsed`, new code, 409). Task 6.
2. **Email delivery** — `EmailSender` port, sent after commit, `emailSent` in the response; production binds a disabled sender until the SMTP adapter of the follow-up issue exists; the pull request states that #15's email step is satisfied at port level only. Tasks 7, 14.
3. **Currency code** — `UnknownCurrency` (see contradiction 1); `currency` defaults to `COP` when the body omits it. Tasks 3, 13.
4. **Tokens** — 256 random bits, base64url (43 characters), SHA-256 hex stored, unique; URL `<BETTER_AUTH_URL>/invitations/<token>` (BETTER_AUTH_URL is the deployment's public base URL; the page is HU-E9-05); accept is `POST /api/v1/invitations/{token}/accept`. Tasks 7, 12, 14, 15.
5. **Roles** — only OWNER changes roles (no self-escalation path for ADMIN); an OWNER may grant OWNER and step down while another OWNER remains; invitations grant ADMIN, MEMBER or VIEWER. Tasks 1, 4.
6. **Shared fund** — create, rename, correct and archive require OWNER or ADMIN (`fund.manage`); paying from the fund is decided by HU-E4-10. Task 9.
7. **Shared space defaults** — `MONTHLY(1)`, categories in the creator's locale, creator as the only OWNER; `DIRECT` cannot be requested. Tasks 2, 3, 13.
8. **Display names** — trimmed, 1–100 characters, unique among current members ignoring case; a guest with a taken name is rejected, a joining user gets the first free numbered name ("Ana 2"), kept within 100 characters including the suffix, and never a name the database already refused (Task 8). Task 2.
9. **Former members** — rows with `left_at` are ignored by membership, uniqueness and listing; rejoining creates a new row. Tasks 10, 11.
10. **Status codes** — `InvitationEmailMismatch` → 403 (explicit); all other new codes follow the naming convention. Task 15.
11. **User lookup** — `BetterAuthProvider.findUserIdByEmail`, bound to the spaces `RegisteredUsers` port in the composition root; the spaces repository never reads identity's tables. Tasks 12, 14.
12. **Archived spaces** — accepting an invitation to an archived space answers `SpaceNotFound` (the membership read-back filters archived spaces) until HU-E1-09 decides otherwise. Task 8.
13. **Deferred** — guest payers/participants (HU-E4-07), invitation listing and resending (HU-E9-05), guest claim links (HU-E1-11), leaving, archiving and guest removal (HU-E1-08, HU-E1-09, HU-E1-12), direct spaces (HU-E1-13).
14. **M1 role gates unchanged** — `MANAGERS`/`WRITERS` keep their values (derived from the matrix); no existing M1 assertion changes; only shared-fund changes gain a role rule. Tasks 1, 9.
15. **Personal spaces of M0/M1 users** — unaffected by migration 0006 (their member rows satisfy every new check).
16. **Direct spaces** — `ensureCanAddMember` rejects only `PERSONAL`, so it would let invitations and guests into a `DIRECT` space, which D16 caps at exactly two members. No direct spaces exist in this plan; HU-E1-13 must add that cap (`DirectSpaceIsFull`, spec 8) to `ensureCanAddMember` or beside it, for `CreateInvitation`, `AcceptInvitation` and `AddGuestMember`.
17. **Ledger edit rule** — `canModify` (ledger domain, M1) stays in the ledger, pinned to the matrix row `money.editAny` for every role by a ledger test (Task 1), so the matrix remains the single source of truth.
