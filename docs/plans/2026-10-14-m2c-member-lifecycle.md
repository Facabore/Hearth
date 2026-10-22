# M2-C Member Lifecycle, Direct Spaces, Archiving and Settlement Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Hearth's shared-spaces API: members leave a shared space once settled; members remove a settled guest; owners and admins hand a guest's place to a person who signs up or signs in (same member, so all history stays); users split an expense with one person through a two-member `DIRECT` space that is created once and reused; owners archive a settled space, which then only reads; and every member sees the fewest payments that clear the balances. Before that, two M1 gaps close under the owner directive that every delete is logical (spec D8, amended): deleting a category keeps its row (Task 0a), and the audit keeps every payment and share that an edit or a deletion replaces (Task 0b).

**Architecture:** Members never disappear: leaving and removal set `space_members.left_at` (D15), and claiming a guest rewrites the same row into a registered member, so no money row changes. A former member's balance is frozen at the zero they settled: an amount edit or a deletion that would move it answers `422 NotASpaceMember` (Task 4b), because nobody can settle with a former member afterwards. The `spaces` module owns every lifecycle rule as pure domain functions (`domain/member.ts`, `domain/space.ts`, new `domain/direct-space.ts`) and reads net balances through a `MemberNetBalance` port that the composition root binds to the new `balances` public query `GetMemberNetBalance` (spaces cannot import balances: balances already imports spaces). Claim links are `space_invitations` rows of kind `CLAIM` bound to a guest (migration 0009, which also adds the `spaces.direct_pair_key` used to reuse one active direct space per pair of users). `SplitWithPerson` lives in `spaces`, resolves or creates the direct space and calls a recorder port that the composition root binds to the ledger's `RecordExpenseByCategoryKey`, all in one transaction; a claim that turns a guest's direct space into a two-user space gives it the pair key when the pair has no other active direct space, so later splits reuse it (D16, Task 14b). Archiving is enforced in one place: `SpaceAccess` answers `SpaceArchived` for an archived space unless the caller only reads, and only the matrix action `space.read` reads. Settlement suggestions are a pure greedy `simplifyDebts` over the existing `netBalances`. Nothing is deleted physically (spec D8, amended in Task 0a): deleting a category sets `categories.deleted_at` (migration 0008), and one adapter filter hides it from every read (Task 0a). An expense's payment and share rows keep holding its current version, while every edit and every deletion audits them in full (Task 0b).

**Tech Stack:** Node.js 24.21.0, pnpm 12.11.2, Next.js 16.4.0 (App Router route handlers), React 19.3.0, TypeScript 6.0.3 strict, Zod 4.6.5, zod-openapi 6.0.2, drizzle-orm 0.45.4 + drizzle-kit 0.31.11, pg 8.23.1, better-auth 1.7.7, Vitest 5.0.3, PostgreSQL 18.6 (Docker CLI in tests). No new dependencies.

**Spec:** `docs/specs/2026-10-11-hearth-design.md` (approved 2026-10-11; sections 5.2, 5.3, 7, 8 and decisions D2, D5, D6, D8 (amended in Task 0a), D9, D15, D16 bind this plan). Stories: `docs/backlog/E1-identity-and-spaces.md` (HU-E1-08, HU-E1-09, HU-E1-11, HU-E1-12, HU-E1-13), `docs/backlog/E5-balances-and-settlements.md` (HU-E5-03); Tasks 0a and 0b reference two closed M1 stories without closing them: `docs/backlog/E3-categories.md` (HU-E3-03, #29) and `docs/backlog/E4-ledger.md` (HU-E4-06, #35). Format template and precedent: `docs/plans/2026-10-13-m2b-shared-expenses.md`; spaces conventions: `docs/plans/2026-10-13-m2a-shared-spaces.md`. GitHub Project: https://github.com/users/Facabore/projects/4. Baseline: `development` at `c0e82f4` (same code tree as `1e0e98d`; PR #88 was merged into `main` with the merge commit `0b43a78`; the later `6e7aa84` changes only `.gitignore`).

**Out of scope (later plans):** balance history per member (HU-E5-04, #46; see Self-Review, "Stories moved to a later plan"); merging two direct spaces of the same pair after a claim (spec D16 defers it); listing former members with their display names (they stay in the database and in balances, but `GET …/members` lists current members only); exposing `claimedAt` and `archivedAt` in the member and space DTOs; the web screens (HU-E9-05 … HU-E9-07).

## Global Constraints

- Node.js `24.21.0`; pnpm `12.11.2`; Next.js `16.4.0`; React `19.3.0`; TypeScript `6.0.3` with `strict: true` and `noUncheckedIndexedAccess: true`; Zod `4.6.5`; zod-openapi `6.0.2`; drizzle-orm `0.45.4`; drizzle-kit `0.31.11`; pg `8.23.1`; better-auth `1.7.7`; Vitest `5.0.3`; PostgreSQL image `postgres:18.6-alpine`. No new dependencies; `pnpm check:pinned` must keep passing.
- Money is `bigint` minor units in code and `bigint` columns in PostgreSQL (D6); over HTTP it is `{ "amount": "<minor units as string>", "currency": "<ISO 4217>" }`. COP has exponent 2 and a rounding unit of 100 minor units (`src/shared/kernel/currency.ts`, spec 5.3): 150,000 COP is `"15000000"` on the wire. Every split in this plan's tests divides into whole pesos through `Money.allocate` (300,000 / 3 = 100,000; 120,000 / 2 = 60,000; 100,000 / 2 = 50,000; 90,000 / 2 = 45,000; 40,000 / 2 = 20,000), so no rounding remainder is asserted.
- Every money reference points to a `SpaceMember`, never to a user (D15). Leaving and removal set `left_at` and keep the row; claiming keeps the row's id and rewrites it into a registered member. Former members stay in the transactions and, when the totals mention them, in `GET …/balances` (`netBalances`, M2-B); they are never payers or participants of new movements (the ledger reads `listCurrent`, M2-B), and no amount edit or deletion moves their balance (`422 NotASpaceMember`, Task 4b).
- Every delete is logical; physical deletes only for documented technical data (spec D8, amended in Task 0a). Transactions set `deletedAt`, categories `deleted_at` (Task 0a), members `left_at`; accounts and spaces are archived; invitations, claim links included, are revoked. The audit keeps the full history of edited parts: an expense's payment and share rows hold its current version, every edit audits them before and after, and every deletion audits the whole last version (Task 0b). The only physical deletes are expired idempotency keys and the sign-up compensation that removes a half-created user. No task in this plan adds another one.
- A non-zero balance blocks leaving, guest removal and archiving with `409 OutstandingBalance` (spec 5.2 D15 "remove a guest whose balance is zero", spec 8, HU-E1-08/09/12): the user settles first through `POST …/settlements` (HU-E5-02). The problem body carries the amount as the RFC 9457 extension member `outstanding` (Money), the only public detail of any error code.
- Spec D16: a `DIRECT` space has exactly two members, both `OWNER` when registered (a guest who claims a direct-space place becomes OWNER too: D16 is specific to direct spaces and wins over the general claim rule of spec 5.2, controller ruling O3); it never gains a member (`409 DirectSpaceIsFull`) and never loses one or changes a role (`409 DirectSpaceMembersFixed`; it is retired only by archiving, ruling O7). One active direct space per pair of registered users is reused for every later split between them, including one that became a two-user space through a claim (Task 14b). A personal space refuses the same changes with `409 PersonalSpaceNotShareable` (HU-E1-02, HU-E1-08).
- New error codes join the backlog's catalogue (spec 8: "the backlog is the full catalogue") in the task that introduces them: `DirectSpaceMembersFixed` (Task 1, HU-E1-08 note) and `InvalidDirectCounterpart` (Task 13, HU-E1-13 note).
- A personal account is debited only by the user who owns it (`422 AccountNotOwned`, D9, M2-B), on records and on edits; leaving and claiming never change that rule.
- HTTP errors are RFC 9457 `application/problem+json` with a stable `code` (the domain error name) and `requestId`; the API never returns translated text. Status mapping lives only in `src/shared/http/problem.ts` (explicit map, then `*NotFound` → 404, `Invalid*` → 422, else 409). A requester who is not a member of a space gets `404 SpaceNotFound` (spec 8).
- Authorization is always enforced in use cases through the `spaces` permission matrix (`authorizeSpaceAction`, membership first, then role), never only in handlers and never with hardcoded role lists. New actions are added to `src/modules/spaces/domain/permissions.ts` and nowhere else.
- Every POST that creates a transaction honours `Idempotency-Key` (`withIdempotency`): here, `POST /api/v1/direct-splits`.
- Hexagonal boundaries (ADR 0001): domain imports only its own domain and `src/shared/kernel`; application never imports infrastructure, contracts, HTTP, frameworks or the ORM; other modules are reached only through `src/modules/<m>/application/index.ts`; `*.schema.ts` may import other modules' `*.schema.ts`; no import cycles (`no-circular` counts type-only imports, `tsPreCompilationDeps: true`). So `spaces` reaches `balances` and `ledger` only through ports bound in `src/composition/container.ts`, and `domain/space.ts` never imports `domain/member.ts` (which imports it).
- Repositories guard identifiers that come from requests with `isUuid` before querying `uuid` columns (malformed ids return `null`, `false` or `[]`, never a `500`).
- Strict TDD: every behaviour starts with a failing test that is run and seen failing. `@critical` scenarios run as acceptance tests (route handlers + real PostgreSQL); the rest as unit or integration tests.
- Code, identifiers, comments, docs and generated artifacts in English. Conventional commits referencing the story issue (`Refs #<n>`); no AI attribution or `Co-Authored-By` lines.
- Gates for every task: `pnpm exec vitest run --project unit`, `pnpm exec vitest run --project integration`, `pnpm exec vitest run --project acceptance`, `pnpm format`, `pnpm exec eslint .`, `pnpm exec tsc --noEmit`, `pnpm exec prettier --check .`, `pnpm lint:boundaries`, `pnpm db:check`.

## Review Focus

1. **Members leaving or being removed while money still ties them to others** (a debt only with a guest, money owed *to* the leaver, a former member named as payer, participant or settlement party afterwards, the OWNER editing an amount a former member paid from their own account, an edit or deletion that would move a former member's settled balance, a viewer who never recorded anything): `409 OutstandingBalance` with the positive amount still owed, `422 NotASpaceMember` for former members on new movements, amount edits and deletions, `422 AccountNotOwned` unchanged, and viewers may leave — pinned in Task 2 (use case), Task 4 (HTTP), Task 4b (edits and deletes), Task 8 and Task 11 (guests).
2. **Claim links used in the wrong place or twice** (an invitation token on the claim endpoint and a claim token on the invitation endpoint, a used, expired or revoked link, a second link of a guest who was already claimed, the link of a removed guest, a user who is already a member, a guest with the same name in another space): stable codes and no member row changes — pinned in Task 6, Task 7, Task 9 (PostgreSQL), Task 10 and Task 11 (HTTP).
3. **Direct-split counterparts that are not one other person you share a space with** (yourself, a guest of a shared space, someone from a space you are not in, unknown and malformed ids, a guest named like you, names longer than a space name allows) and **failed or retried splits**: `404 MemberNotFound`, `422 InvalidDirectCounterpart`, `409 MemberNameTaken`, a name cut to 80 characters; a split whose expense fails leaves no direct space behind, a replayed `Idempotency-Key` creates one space and one expense, and a direct space that became a two-user space through a claim is reused (D16) — pinned in Task 12, Task 13, Task 14b and Task 15.
4. **Writes reaching an archived space through any path** (every space-scoped write endpoint of M1–M2-C: settings, invitations and their acceptance, guests, claim links and their acceptance, roles, leaving, archiving again, categories and groups, accounts, every kind of transaction, edits, deletions and direct splits): `409 SpaceArchived`, while every read of the same space keeps answering `200` — pinned in Task 16 (one guard, every action) and Task 18 (HTTP tables of every read and every write endpoint).
5. **Simultaneous lifecycle changes** (two owners leaving at the same moment; two first splits with the same person at the same moment; two claims of one link): the space always keeps one OWNER, a pair of users always has one active direct space, and a link claims a guest once — pinned in Task 3 (a rendezvous that makes the test fail when the row lock is removed), Task 9 (two claims against PostgreSQL) and Task 14 (the partial unique index decides; both callers get the same space). Leaving, removal or archiving racing a money write is accepted for v1 and documented (Self-Review, assumption 4; follow-up Facabore/Hearth#89).
6. **Anything deleted or replaced physically** (a deleted category that is still listed, named by a new expense or a direct split, renamed, archived, restored or deleted again, or still holding its name; a transaction that loses its category; the split that an edit replaced; the version that a deletion retired): the row stays with `deleted_at`, every read skips it (`404 CategoryNotFound`), and `GET …/audit` returns every earlier payment and share — pinned in Task 0a (unit, an integration test that is red before migration 0008, and an acceptance test with SQL) and Task 0b (unit, a PostgreSQL round trip, acceptance).

## Execution Workflow

- Work on the long-lived branch `development`; every task is implemented there with Strict TDD. Implementers stage; the controller commits.
- **RDD before every commit** (receipt-driven development is on; check with `gentle-ai review mode status`). Each "Commit" step means:
  1. Run every source-mutating normalizer first (`pnpm format`, regenerated migrations or snapshots), then stage exactly the files of the task.
  2. Run `gentle-ai review status --cwd . --contract gentle-ai.review-integration/v2 --agent claude-code --next-transition` and follow only the returned `next_transition` (`execute` its operation, satisfy `collect` inputs, or stop on `stop` and report its reason code with its documented continuation). Medium/high-risk candidates may return a consent envelope; relay it to the owner and wait.
  3. Commit only after the provider-returned `review.validate` allows the `pre-commit` gate for that exact staged candidate; the commit must not change the reviewed bytes.
  4. If the owner disables RDD (`gentle-ai review mode disable --scope clone --cwd .`), commit under ordinary policy and report `disabled/unmanaged`.
- Code blocks in this plan are complete but not guaranteed to match Prettier's line wrapping: run `pnpm format` before the gates of every task (the gates then run `prettier --check`). Anchors in this plan name lines that Prettier leaves alone (short statements, JSDoc and `//` comments, existing lines already formatted, the last line of a file); when an anchor is a range, it is given by its first and last lines. Where a later task edits a line an earlier task wrote, the earlier task writes it in its final Prettier form (multi-line imports when they exceed 110 characters).
- Every code block the executor writes is introduced by a line naming its file path in backticks and ending with a colon. "Create" blocks are whole files; edits to existing files name a unique anchor line ("after the line …", "replace the line …", "insert before the line …", "append to the end of the file", "insert before the last line of the file").
- **Task labels:** Tasks 0a and 0b are whole tasks inserted before Task 1 (owner directive 2026-10-14: every delete is logical). Tasks 4b and 14b are whole tasks inserted after Tasks 4 and 14. Each is its own commit and RDD pass, executed in the order 0a, 0b, 1, 2, 3, 4, 4b, 5 … 14, 14b, 15 … 20. Split halves of a task carry a lower-case letter (7a, 10b, 13a, 15c, 18b), except Task 4, whose halves are **4.1** and **4.2** so they never read as Task 4b.
- **New repository ports are separate interfaces** (`MemberLifecycleRepository`, `GuestClaimRepository`, `ClaimLinkRepository`, `DirectSpaceRepository`, `SpaceArchiveRepository`), so an application task compiles before its PostgreSQL adapter exists. Class headers (`DrizzleSpaceRepository implements …`, `InMemorySpaceStore implements …`) are left as they are; each adapter is checked against its port by its integration test, which assigns the repository to the port type (`const lifecycle: MemberLifecycleRepository = repo;`), and again where the composition root binds it.
- Each task is one commit sized for review (target under ~400 changed lines, OpenAPI snapshot growth included; generated Drizzle files not counted). Measured on the current snapshot, a body-less operation is about 65–90 lines (`POST …/accounts/{id}/archive` 74, `DELETE …/transactions/{id}` 77, `POST …/invitations/{id}/revoke` 84) and an operation with a body about 130–310 (`POST …/settlements` 156, `POST …/expenses` 310). Tasks over or near the limit, with their split points (each part green, each with its own RDD pass):
  - **Task 4, ~410**: **4.1** (~130) public details in the problem body (`problem.ts`, `define-route.ts`, `contracts.ts`, their unit tests and the `Problem` snapshot change) | **4.2** (~290) the leave contract, route, container wiring, the `paysEqually`/`settles` helpers, the acceptance test and its snapshot.
  - **Task 7, ~400** (borderline): **7a** (~190) `GuestClaimRepository`, `ClaimsDeps`, the in-memory twin, `CreateGuestClaim` and a self-contained `claims.test.ts` with its first `describe` block | **7b** (~210) `ClaimGuestPlace`, the `AcceptInvitation` guard, the test's imports and `world()` extended, and the second `describe` block.
  - **Task 10, ~560**: **10a** (~260) the claim-link contract, route, container wiring for both claim use cases, the `claimLink` helper, the snapshot and the first `describe` block | **10b** (~300) the accept route, the snapshot and the second `describe` block (`@critical`).
  - **Task 13, ~430**: **13a** (~215) `DirectSpaceRepository`, the in-memory twin, `SplitWithPerson` and the tests of its first `describe` block (new guests), importing only what they use | **13b** (~215) the imports only 13b uses and the second `describe` block (registered counterparts, errors and the race); no production change unless one of its tests is red.
  - **Task 15, ~800**: **15a** (~180) the ledger contract helpers of the direct-split body and response, `RecordExpenseByCategoryKey` and their unit tests (no path yet, so no snapshot change) | **15b** (~390, of which ~200 are the generated OpenAPI operation) the path, route, container binding, snapshot and the `@critical` test | **15c** (~110) the other positive scenarios | **15d** (~150) the `problem.test.ts` rows, the splits that cannot happen and the reuse after a claim (Task 14b).
  - **Task 18, ~560**: **18a** (~260) the archive route, the archived filter, the contract, wiring, snapshot and `archive-space.test.ts` | **18b** (~300) a separate file, `archived-space.test.ts`: the table of every read, the table of every space-scoped write endpoint, invitation and claim acceptance into an archived space and a direct split into an archived direct space; no production change unless one of its tests is red.
  - Every other task is under ~400 lines (largest: Task 17 ~330, Task 2 ~230, Task 8 ~215, Task 0b ~210, Task 4b ~190, Task 14b ~150, Task 0a ~140 without its generated migration; Task 16 touches 19 files but only ~260 lines).
- The generated Drizzle snapshots are committed in their own schema tasks, each with the tests that are red before its migration: `drizzle/meta/0008_snapshot.json` in Task 0a (categories `deleted_at`) and `drizzle/meta/0009_snapshot.json` in Task 5 (claim links and direct pair keys). Tasks 0a and 0b change no contract, so they leave the OpenAPI snapshot alone. The OpenAPI snapshot changes in Task 4.1 (`Problem` gains `outstanding`), Task 4b (the `422` descriptions of editing and deleting a transaction), Task 5 (`Invitation.kind` gains `CLAIM`) and the HTTP tasks (4.2, 10, 11, 15b, 18a, 20).
- **Three concurrency tests are added.** Task 3: two owners leave at once; a rendezvous in the balance port holds the first transaction until the second has read the members or 2 s passed, so removing `{ lock: true }` from `LeaveSpace` makes the test fail whenever the second leaver reaches the port within 2 s, which an idle test database always does (inferred; the margin costs time only when the lock is present). Task 9: two users claim one link at once; exactly one becomes the member (the link lock and the conditional `UPDATE` both stand behind it). Task 14: two first splits of one pair at once; removing `.onConflictDoNothing()` from `addDirect` makes the second insert throw, and dropping `spaces_direct_pair_uq` leaves two rows. **No other lock is added (controller ruling O2):** a member leaving or being removed, or a space being archived, while someone else records money that names them or the space is accepted for v1 and documented in the Self-Review (assumption 4) and in the PR. The locking is the follow-up issue Facabore/Hearth#89, "Serialize leave, remove and archive against concurrent money writes" (member row `FOR UPDATE` on leave/remove, `FOR SHARE` on money writes; space row `FOR UPDATE` on archive).
- When a task starts, move its story issues to **In Progress** on Project #4. Tasks 0a and 0b are the exception: they reference closed M1 stories (#29, #35), which stay closed and whose cards stay **Done**. When all tasks are done, open one pull request from `development` into `main` (they share history since M2-B's #88 was merged with a merge commit). It closes #17, #18, #20, #21, #22 and #45, references #29 and #35 without closing them (Tasks 0a, 0b), and states that #46 (HU-E5-04) stays open for the next plan. Its description also lists, as PR notes: (1) accepting an invitation or a claim link of an archived space now answers `409 SpaceArchived` where M2-A answered `404 SpaceNotFound` (ruling O5); (2) amount edits and deletions that would move a former member's balance answer `422 NotASpaceMember` (Task 4b); (3) the races of assumption 4 are accepted for v1, and their locking is the follow-up Facabore/Hearth#89, "Serialize leave, remove and archive against concurrent money writes" (ruling O2); (4) every delete is logical (spec D8, amended): a deleted category keeps its row and answers `404 CategoryNotFound` everywhere, and `GET …/audit` entries now carry `payments` and `shares` (JSON arrays) when an edit changed them, while a deletion lists every value it retired with `to: null` (Tasks 0a, 0b); (5) the follow-ups in the Self-Review. The controller leaves a comment on #43 saying that the who-pays-whom list it deferred to #45 is now `GET …/balances/suggestions`.
- Task-to-issue map (issues are titled with their story ID): HU-E3-03 → #29 (Task 0a; `Refs` only, a closed M1 story), HU-E4-06 → #35 (Task 0b; `Refs` only, a closed M1 story), HU-E1-08 → #17 (Tasks 1, 2, 3, 4, 4b), HU-E1-09 → #18 (Tasks 16, 17, 18), HU-E1-11 → #20 (Tasks 5, 6, 7, 9, 10, 14b), HU-E1-12 → #21 (Tasks 1, 3, 4b, 8, 9, 11), HU-E1-13 → #22 (Tasks 5, 12, 13, 14, 14b, 15), HU-E5-03 → #45 (Tasks 19, 20).
- zod-openapi lesson from M1/M2-A/M2-B: a component registered in `components.schemas` that is used in **both** a request and a response is emitted twice (`<Name>` and `<Name>Output`). This plan registers no new component; it changes `Problem` (Task 4.1, responses only; it already renders in output mode and references `MoneyOutput`, like `Account`) and `Invitation` (Task 5, responses only) and references `RecordedExpense` from a new response (Task 15b). If a new `…Output` variant appears in a snapshot diff, a request schema is reusing a response component: fix the contract instead of accepting the snapshot.

## File Structure

```
.
├── docs/backlog/E1-identity-and-spaces.md                                 # error catalogue: DirectSpaceMembersFixed (Task 1), InvalidDirectCounterpart (Task 13)
├── docs/specs/2026-10-11-hearth-design.md                     # D8 amended, section 5.2 Category (Task 0a)
├── drizzle/
│   ├── 0008_category_soft_delete.sql (+ meta/0008_snapshot.json)          # Task 0a
│   └── 0009_member_lifecycle.sql (+ meta/0009_snapshot.json)              # Task 5
├── openapi/openapi.snapshot.json                                           # Tasks 4.1, 4.2, 4b, 5, 10, 11, 15b, 18a, 20
├── src/
│   ├── shared/http/
│   │   ├── problem.ts                                                      # publicDetailsOf, extension members (Task 4.1)
│   │   ├── define-route.ts                                                 # passes public details (Task 4.1)
│   │   └── contracts.ts                                                    # Problem.outstanding (Task 4.1)
│   ├── composition/container.ts                                            # Tasks 4.2, 10, 11, 15a, 15b, 18a, 20
│   ├── modules/
│   │   ├── spaces/
│   │   │   ├── domain/permissions.ts                                       # space.leave, guest.remove (Task 1), isReadOnly (Task 16)
│   │   │   ├── domain/member.ts                                            # leaving, guests, settled balances (Task 1), claimedGuest (Task 6)
│   │   │   ├── domain/space.ts                                             # ensureMembersCanChange (1), DIRECT_MEMBER_ROLE (6), DIRECT cap (12), ensureArchivable (17)
│   │   │   ├── domain/invitation.ts                                        # CLAIM kind (Task 5), issueClaim, isClaim, ensureClaimable (Task 6)
│   │   │   ├── domain/direct-space.ts                                      # createDirectSpace, pairKeyOf, directPairKey (Task 12)
│   │   │   ├── application/lifecycle-deps.ts                               # MemberNetBalance, LifecycleDeps (Task 2)
│   │   │   ├── application/leave-space.ts                                  # Task 2
│   │   │   ├── application/space-member-repository.ts                      # MemberLifecycleRepository (2), GuestClaimRepository (7, 14b)
│   │   │   ├── application/invitation-ports.ts                             # ClaimsDeps (Task 7)
│   │   │   ├── application/invitation-repository.ts                        # ClaimLinkRepository (Task 8)
│   │   │   ├── application/accept-invitation.ts                            # refuses claim tokens (Task 7)
│   │   │   ├── application/{create-guest-claim,claim-guest-place}.ts       # Task 7; the pair key on a claim (Task 14b)
│   │   │   ├── application/remove-guest-member.ts                          # Task 8
│   │   │   ├── application/change-member-role.ts                           # ensureMembersCanChange (Task 12)
│   │   │   ├── application/{direct-space-repository,split-with-person}.ts  # Task 13; archived spaces (Task 16)
│   │   │   ├── application/{space-settings-repository,space-access}.ts     # archived spaces only read (Task 16)
│   │   │   ├── application/{get-space,list-space-periods}.ts               # reads through space.read (Task 16)
│   │   │   ├── application/{space-repository,list-my-spaces}.ts            # SpaceArchiveRepository, includeArchived (Task 17)
│   │   │   ├── application/archive-space.ts                                # MemberNetBalances, ArchiveSpace (Task 17)
│   │   │   ├── infrastructure/spaces.schema.ts                             # guest_member_id, direct_pair_key (Task 5)
│   │   │   ├── infrastructure/drizzle-space-repository.ts                  # markLeft (3), claims (9), direct (14), adoptPairKey (14b), archived (16, 17)
│   │   │   ├── infrastructure/drizzle-invitation-repository.ts             # guestMemberId (5), revokePendingClaims (9)
│   │   │   ├── infrastructure/drizzle-direct-spaces.int.test.ts            # Task 14, 14b
│   │   │   └── contracts/spaces.contract.ts                                # Tasks 4.2, 5, 10, 11, 18a
│   │   ├── balances/
│   │   │   ├── domain/balances.ts                                          # simplifyDebts (Task 19)
│   │   │   ├── application/get-member-net-balance.ts                       # GetMemberNetBalance (Task 2), GetMemberNetBalances (Task 17)
│   │   │   ├── application/get-settlement-suggestions.ts                   # Task 19
│   │   │   └── contracts/balances.contract.ts                              # Task 20
│   │   ├── ledger/domain/transaction.ts                                    # changesBetween parts, deletionChanges (0b), balanceParties (4b)
│   │   ├── ledger/application/checks.ts                                    # ensureCurrentParties (Task 4b)
│   │   ├── ledger/application/delete-transaction.ts                        # audits the whole last version (0b)
│   │   ├── ledger/application/{edit-transaction,delete-transaction}.ts     # former members' balances stay frozen (Task 4b)
│   │   ├── ledger/infrastructure/drizzle-transaction-repository.ts         # parts rows hold the current version (comment, Task 0b)
│   │   ├── ledger/infrastructure/drizzle-transaction-repository.int.test.ts # earlier split recovered from the audit (Task 0b)
│   │   ├── ledger/application/ports.ts                                     # CategoryReader.findByKey (Task 15a)
│   │   ├── ledger/application/record-expense-by-category-key.ts            # Task 15a
│   │   ├── ledger/contracts/ledger.contract.ts                             # audit comment (0b), edit/delete 422 (4b), direct-split body and response (15a, 15b)
│   │   ├── ledger/application/{list-transactions,get-transaction,list-audit}.ts # reads through space.read (Task 16)
│   │   ├── accounts/application/list-accounts.ts                           # reads through space.read (Task 16)
│   │   └── categories/
│   │       ├── infrastructure/categories.schema.ts                         # deleted_at, partial categories_group_name_uq (Task 0a)
│   │       ├── infrastructure/drizzle-category-repository.ts               # logical deleteCategory; listCategories skips deleted rows (Task 0a)
│   │       ├── application/{category-repository,delete-category}.ts        # deleteCategory(…, deletedAt) (Task 0a)
│   │       └── application/list-categories.ts                              # reads through space.read (Task 16)
│   └── app/api/v1/
│       ├── spaces/route.ts                                                 # ?archived=true includes archived spaces (Task 18a)
│       ├── spaces/[spaceId]/leave/route.ts                                 # POST (Task 4.2)
│       ├── spaces/[spaceId]/archive/route.ts                               # POST (Task 18a)
│       ├── spaces/[spaceId]/guests/[memberId]/route.ts                     # DELETE (Task 11)
│       ├── spaces/[spaceId]/guests/[memberId]/claim-links/route.ts         # POST (Task 10a)
│       ├── spaces/[spaceId]/balances/suggestions/route.ts                  # GET (Task 20)
│       ├── claims/[token]/accept/route.ts                                  # POST (Task 10b)
│       └── direct-splits/route.ts                                          # POST (Task 15b)
└── tests/
    ├── support/
    │   ├── fakes.ts                  # membership().archived (Task 16)
    │   ├── in-memory-categories.ts   # deleted (Task 0a)
    │   ├── in-memory-spaces.ts       # markLeft (2), claims (7), revokePendingClaims (8), direct (13), adoptPairKey (14b), archived (16, 17)
    │   ├── in-memory-ledger.ts       # categories by key (Task 15a)
    │   ├── ledger.ts                 # paysEqually, settles (Task 4.2)
    │   └── spaces.ts                 # claimLink (Task 10a)
    └── acceptance/
        ├── categories.test.ts        # deleting is logical (Task 0a)
        ├── ledger.test.ts            # the audit keeps every payment and share (Task 0b)
        ├── leave-space.test.ts       # Task 4.2; edits and deletes after leaving (Task 4b)
        ├── guest-claims.test.ts      # Task 10
        ├── remove-guest.test.ts      # Task 11
        ├── direct-splits.test.ts     # Tasks 15b, 15c, 15d
        ├── archive-space.test.ts     # Task 18a
        ├── archived-space.test.ts    # Task 18b
        └── settlement-suggestions.test.ts # Task 20
```

Test layout follows M0–M2-B: unit tests next to the code as `*.test.ts` (no database), integration tests as `*.int.test.ts` (real PostgreSQL via `testDatabase()`), acceptance tests in `tests/acceptance/` calling the exported route handlers in-process. Shared test doubles live in `tests/support/` so production folders hold no test code. The in-memory twins (`InMemorySpaceStore`, `InMemoryInvitations`) mirror the PostgreSQL adapters; Tasks 3 and 9 run the same sequence against both and compare the outcomes, so a twin that drifts from its adapter fails a test.

Run a single file with `pnpm exec vitest run --project <unit|integration|acceptance> <path>`. Integration and acceptance projects start a disposable PostgreSQL container through the Docker CLI (`tests/support/postgres-global-setup.ts`) and apply every migration in `drizzle/`, so Docker must be running.

### How lifecycle actions are authorized

Two matrix actions are added in Task 1; everything else reuses the M2-A matrix.

| Use case | Matrix action | Roles | Other rules (where they live) |
|---|---|---|---|
| `LeaveSpace` | `space.leave` (new) | OWNER, ADMIN, MEMBER, VIEWER | shared spaces only (`ensureMembersCanChange`), never the last OWNER (`leavingMember`), settled (`ensureSettled`) |
| `RemoveGuestMember` | `guest.remove` (new) | OWNER, ADMIN, MEMBER | shared spaces only, a current guest (`currentGuest`), settled; revokes the guest's pending claim links |
| `CreateGuestClaim` | `member.invite` (its M2-A comment already names claim links) | OWNER, ADMIN | a current guest (`currentGuest`); allowed in direct spaces, because no member is added |
| `ClaimGuestPlace` | none: the acting user is not a member yet and the bearer token is the authorization, like `AcceptInvitation` | — | `ensureClaimable`, not already a member, `claimedGuest`; a direct space takes the pair key when the pair is free (Task 14b) |
| `SplitWithPerson` | `money.record` in the direct space, through `RecordExpense` | the requester is an OWNER of every direct space they are in | the counterpart is someone the requester shares a space with (archived spaces included), or a new guest |
| `EditTransaction`, `DeleteTransaction` (M1) | creator, or `money.editAny` | as M1 | an amount edit or a deletion never moves a former member's balance (`ensureCurrentParties`, Task 4b) |
| `ChangeMemberRole` (M2-A) | `member.changeRole` | OWNER | now also `ensureMembersCanChange` (Task 12) |
| `ArchiveSpace` | `space.archive` (M2-A) | OWNER | never personal (`ensureArchivable`), every current member settled |
| `GetSettlementSuggestions` | `space.read` | every role | — |

Archived spaces: `SpaceAccess` refuses every caller with `SpaceArchived` unless it passes `{ readOnly: true }`, and `authorizeSpaceAction` passes it only when `isReadOnly(action)`, which is true for `space.read` alone (Task 16). So a write path cannot forget the archive check: any use case that resolves access, through the matrix or directly, is refused by default.

### Every path that touches a lifecycle rule

| Rule | Paths | Where it is enforced |
|---|---|---|
| Settled before leaving, removal, archiving | `LeaveSpace`, `RemoveGuestMember`, `ArchiveSpace` | `ensureSettled(outstandingIn(…))` in each (Tasks 2, 8, 17); a money write racing the check is accepted for v1 (assumption 4, ruling O2) |
| A former member's balance stays at the zero they settled | `EditTransaction` (amount changes), `DeleteTransaction` | `ensureCurrentParties` over `balanceParties` (Task 4b): `422 NotASpaceMember`; descriptions, dates and categories stay editable |
| A pair of users has one active direct space, reused by every split | `SplitWithPerson` (pair key, direct-space members), `addDirect` (partial unique index), `ClaimGuestPlace` (adopts the key of a free pair) | Tasks 13, 14, 14b |
| A space keeps one OWNER | `ChangeMemberRole`, `LeaveSpace` | `isLastOwner` in `domain/member.ts`, shared by `changeMemberRole` and `leavingMember` (Task 1) |
| A direct space keeps exactly its two members, both OWNER | `AddGuestMember`, `CreateInvitation` (`ensureCanAddMember`, Task 12); `AcceptInvitation` (unreachable: `CreateInvitation` is the only producer of invitations and claim tokens are refused, Task 7); `LeaveSpace`, `RemoveGuestMember`, `ChangeMemberRole` (`ensureMembersCanChange`, Tasks 2, 8, 12); `ClaimGuestPlace` (keeps two members, makes the claimer OWNER, Tasks 6, 7); `SplitWithPerson` (creates exactly two, Tasks 12, 13); `CreateSpace` (M2-A, refuses `DIRECT`) |
| Archived spaces only read | every write use case: `RecordExpense`, `RecordIncome`, `RecordTransfer`, `RecordFundContribution`, `RecordSettlement`, `EditTransaction`, `DeleteTransaction`, `CreateAccount`, `UpdateAccount`, `ArchiveAccount`, every category write (`authorizeManager`), `UpdateSpaceSettings`, `AddGuestMember`, `ChangeMemberRole`, `CreateInvitation`, `RevokeInvitation`, `AcceptInvitation` and `ClaimGuestPlace` (their read-back, rolled back), `LeaveSpace`, `RemoveGuestMember`, `CreateGuestClaim`, `ArchiveSpace`, `SplitWithPerson` (an archived direct space's guest answers `SpaceArchived`; otherwise through `RecordExpense`) | `createSpaceAccess` (Task 16), pinned endpoint by endpoint in Task 18b; reads opt in through `space.read`: `GetSpace`, `ListMembers`, `ListSpacePeriods`, `ListAccounts`, `GetAccount`, `ListCategories`, `ListTransactions`, `GetTransaction`, `ListAudit`, `GetSpaceBalances`, `GetSettlementSuggestions` |
| Claim links are single-use and only claim | `ClaimGuestPlace` (`ensureClaimable`, `markAccepted`, conditional UPDATE), `AcceptInvitation` (refuses `CLAIM`), `RevokeInvitation` (revokes any kind), `RemoveGuestMember` (revokes pending claims) | Tasks 6, 7, 8, 9 (two simultaneous claims against PostgreSQL) |
| Former members never take part in new movements | `RecordExpense`, `RecordFundContribution`, `RecordSettlement` | `listCurrent` (M2-B, unchanged), pinned again in Task 4.2 (participant, settlement party) |
| A personal account is debited only by its owner | `RecordExpense`, `RecordFundContribution`, `RecordSettlement`, `EditTransaction` | M2-B (`partyAccount`, `ownedDebits`), pinned again after a member left in Task 4.2 (it is checked before Task 4b's rule, so that case still answers `AccountNotOwned`) |
| Nothing is deleted physically (D8, amended) | `DeleteCategory`, and every category read through `listCategories`: `ListCategories`, the lookups of `UpdateCategory`, `ArchiveCategory`, `RestoreCategory` and `DeleteCategory`, the name checks of `CreateCategory` and `UpdateCategory`, `ArchiveCategoryGroup`, the ledger's `CategoryReader.find` and Task 15's `findByKey`; `EditTransaction` and `DeleteTransaction` (their audit entries); `LeaveSpace`, `RemoveGuestMember`, `ArchiveSpace`, `RevokeInvitation` (set `left_at`, `archived_at`, `REVOKED`) | Task 0a (`deleted_at`, the adapter filter, the partial `categories_group_name_uq`), Task 0b (`changesBetween` parts, `deletionChanges`); Tasks 3, 9, 17 keep every member, claim link and space row |

---

### Task 0a: Categories — deleting a category is logical

Owner directive 2026-10-14: every delete is logical, everything stays stored (spec D8, amended in this task). M1's `DeleteCategory` (HU-E3-03, issue #29) removes the row of a category nothing references (`DrizzleCategoryRepository.deleteCategory` runs `.delete(categories)`). From now on it sets `categories.deleted_at` and the row stays. HU-E3-03 is a closed M1 story, so the commit says `Refs #29`, never `Closes`. Pins Review Focus 6 for categories.

Decisions:
- One filter, in the adapter: `listCategories` returns only categories that are not deleted (archived ones still included), and every category read goes through it: `ListCategories` (the tree, with or without `?archived=true`), the `categoryById` lookups of update, archive, restore and delete, the name checks of `newCategory` and `reviseCategory`, `archiveGroup`, the ledger's `CategoryReader.find` (`container.ts`) and Task 15's `findByKey`. So a deleted category is never listed, never named by a new expense, income, edit or direct split (`404 CategoryNotFound`, exactly like a missing one), and cannot be updated, archived, restored or deleted again (`404 CategoryNotFound`). The domain `Category` gains no field.
- Names are unique among categories that are not deleted: `categories_group_name_uq` becomes partial (`WHERE deleted_at IS NULL`), which matches the domain's `nameTakenIn` over the filtered list. Archived categories still keep their names taken (HU-E3-02). The catalog-key index `categories_space_key_uq` stays as it is: a deleted seeded category keeps its key, seeding runs once per space (`hasAny`), and a direct split naming that key answers `CategoryNotFound`, as it did after M1's hard delete.
- HU-E3-03's rule stays: a category that any transaction references (soft-deleted ones included, D8) answers `409 CategoryInUse` and is archived instead. The use case therefore never deletes a referenced category. The row staying is what keeps a reference valid when one appears anyway, for example a transaction recorded concurrently with the deletion, which M1's hard delete turned into a foreign-key error. The integration test pins this at the repository level: the transaction keeps its `category_id`.
- The deletion time comes from `deps.clock` (`deleteCategory(spaceId, categoryId, deletedAt)`). The contract, its `204` and the OpenAPI snapshot do not change.
- Migration numbering: this task's migration is `0008_category_soft_delete`, so Task 5's becomes `0009_member_lifecycle`.
- The spec edit (D8 and the Category entry of section 5.2) is a docs change that this task's commit carries. It was written with the plan, and it states the rule that this task and Task 0b implement.

**Files:**
- Modify (docs): `docs/specs/2026-10-11-hearth-design.md` (D8; section 5.2, Category)
- Modify: `src/modules/categories/infrastructure/categories.schema.ts`, `src/modules/categories/application/category-repository.ts`, `src/modules/categories/infrastructure/drizzle-category-repository.ts`, `src/modules/categories/application/delete-category.ts`, `tests/support/in-memory-categories.ts`
- Create (generated): `drizzle/0008_category_soft_delete.sql`, `drizzle/meta/0008_snapshot.json`; Modify (generated): `drizzle/meta/_journal.json`
- Test: `src/modules/categories/application/retire-categories.test.ts`, `src/modules/categories/infrastructure/drizzle-category-repository.int.test.ts`, `tests/acceptance/categories.test.ts`

**Interfaces:**
- Consumes: `categories` (M1 schema); `transactions.category_id` and its foreign key `transactions_category_id_categories_id_fk` (M1); `CategoriesDeps.clock`; `seeded()`, `repo`, `ids`, `db`, `pool` (`drizzle-category-repository.int.test.ts`); `setup()` (`retire-categories.test.ts`); `treeOf`, `groupsIn`, `onCategory`, `names`, `accountOf`, `spend`, `app` (`tests/acceptance/categories.test.ts`).
- Produces:
  - `categories.deleted_at` (`categories.deletedAt`); `categories_group_name_uq` partial, `WHERE deleted_at IS NULL`.
  - `CategoryRepository.deleteCategory(spaceId: string, categoryId: string, deletedAt: Date): Promise<void>` (logical); `CategoryRepository.listCategories` skips deleted categories.
  - `InMemoryCategories.deleted: Map<string, Date>`.

- [ ] **Step 1: Amend the spec (docs)**

The amendment was written into the working tree together with this plan and is committed by this task. Check that `docs/specs/2026-10-11-hearth-design.md` holds the two lines below (`git diff docs/specs/2026-10-11-hearth-design.md` shows exactly these two changed lines). If it does not, for example in a fresh clone, make the two replacements:

1. Replace the line `**CategoryGroup / Category** — two levels, per space, seeded from defaults, renamable and archivable (never hard-deleted while referenced).` with:

```md
**CategoryGroup / Category** — two levels, per space, seeded from defaults, renamable and archivable. A category nothing references can also be deleted, logically (`deleted_at`, D8): the row stays, it leaves every list and lookup, and its name is free again; a referenced one is archived instead. Groups are archived, never deleted.
```

2. Replace the line `| D8 | Soft delete for transactions; audit fields on every write | Shared money needs traceability | Hard delete |` with:

```md
| D8 | Every delete is logical: transactions set `deletedAt`, categories `deleted_at`, members `left_at`; accounts and spaces are archived; invitations are revoked. The audit keeps the full history of edited parts: an expense's payment and share rows hold its current version, every edit records the parts before and after, and a deletion records the whole last version. Audit fields on every write. Physical deletes only for technical data: expired idempotency keys, and the sign-up compensation that removes a half-created user who never finished provisioning | Shared money needs traceability; nothing a member recorded is ever lost | Hard delete; versioned payment and share rows (every balance and balance-sheet query would have to pick the current version) |
```

- [ ] **Step 2: Write the failing tests**

In `src/modules/categories/application/retire-categories.test.ts`:

1. Replace the line `    const { categories, create, remove } = await setup();` with:

```ts
    const { categories, create, remove, activeNames } = await setup();
```

2. Replace the line `    expect(categories.categories.map((c) => c.id)).not.toContain(bakery.id);` with:

```ts
    // D8 (Task 0a): the row stays, marked deleted, and every list, lookup and name check skips it.
    expect(categories.categories.map((c) => c.id)).toContain(bakery.id);
    expect(categories.deleted.get(bakery.id)).toEqual(new Date("2026-10-12T12:00:00Z"));
    expect(await activeNames()).not.toContain("Bakery");
    expect(codeOf(await remove({ ...asAna, categoryId: bakery.id }))).toBe("CategoryNotFound");
    expect(unwrap(await create({ ...asAna, groupId: food.id, name: "Bakery" })).id).not.toBe(bakery.id);
```

In `src/modules/categories/infrastructure/drizzle-category-repository.int.test.ts`:

1. Insert before the first line of the file:

```ts
import { randomUUID } from "node:crypto";
```

2. Replace the line `    await repo.deleteCategory(space.spaceId, rent.id);` with:

```ts
    await repo.deleteCategory(space.spaceId, rent.id, archivedAt);
```

3. Insert before the last line of the file:

```ts

  it("keeps a deleted category stored and referenced, out of lists and name checks (D8, Task 0a)", async () => {
    const { space, tree } = await seeded();
    const mercado = tree.categories.find((c) => c.key === "groceries")!;
    const transactionId = randomUUID();
    await pool.query(
      `INSERT INTO transactions (id, space_id, type, description, date, category_id, amount, currency, created_by, created_at, updated_at)
       VALUES ($1, $2, 'EXPENSE', 'Market', '2026-10-05', $3, 100, 'COP', $4, now(), now())`,
      [transactionId, space.spaceId, mercado.id, space.userId],
    );
    const deletedAt = new Date("2026-10-14T12:00:00Z");
    await repo.deleteCategory(space.spaceId, mercado.id, deletedAt);
    const { rows } = await pool.query(
      `SELECT c.deleted_at, t.category_id FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.id = $1`,
      [transactionId],
    );
    expect(rows).toEqual([{ deleted_at: deletedAt, category_id: mercado.id }]);
    expect((await repo.listCategories(space.spaceId)).map((c) => c.id)).not.toContain(mercado.id);
    // The name is free again among the categories that are not deleted (partial categories_group_name_uq).
    await expect(
      repo.addCategories([{ ...mercado, id: ids.next<"Category">(), name: "MERCADO", key: null }]),
    ).resolves.toBeUndefined();
  });
```

In `tests/acceptance/categories.test.ts`, insert before the line `  it("keeps referenced categories: no delete, archive hides them, new expenses refused, restore brings them back", async () => {`:

```ts
  it("deletes logically: the row stays, every listing and lookup skips it, and its name is free again (D8)", async () => {
    const ana = await registerUser("Ana");
    const accountId = await accountOf(ana);
    const food = (await groupsIn(await treeOf(ana, ana.spaceId))).find((g) => g.name === "Alimentación")!;
    const createBakery = () =>
      call(createCategory, "POST", `/api/v1/spaces/${ana.spaceId}/categories`, {
        user: ana,
        params: { spaceId: ana.spaceId },
        body: { groupId: food.id, name: "Panadería" },
      });
    const bakery = (await (await createBakery()).json()) as CategoryDto;
    expect((await onCategory(deleteCategory, "DELETE", ana, bakery.id)).status).toBe(204);

    expect(await names(ana)).not.toContain("Panadería");
    expect(await names(ana, "?archived=true")).not.toContain("Panadería");
    const { rows } = await app.pool.query("SELECT deleted_at FROM categories WHERE id = $1", [bakery.id]);
    expect(rows).toEqual([{ deleted_at: expect.any(Date) }]);
    const expense = await spend(ana, accountId, bakery.id);
    expect([expense.status, (await expense.json()).code]).toEqual([404, "CategoryNotFound"]);
    for (const [handler, method, suffix] of [
      [deleteCategory, "DELETE", ""],
      [archiveCategory, "POST", "/archive"],
      [restoreCategory, "POST", "/restore"],
    ] as const) {
      const again = await onCategory(handler, method, ana, bakery.id, suffix);
      expect([again.status, (await again.json()).code]).toEqual([404, "CategoryNotFound"]);
    }
    const recreated = await createBakery();
    expect([recreated.status, ((await recreated.json()) as CategoryDto).name]).toEqual([201, "Panadería"]);
  });

```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/categories && pnpm exec vitest run --project integration src/modules/categories && pnpm exec vitest run --project acceptance tests/acceptance/categories.test.ts`
Expected: FAIL. The unit test finds Bakery's row gone (`categories.deleted` is undefined). The new integration test fails on the hard delete with `transactions_category_id_categories_id_fk`. The acceptance test finds no row for the deleted Panadería. Every other test passes, including M1's acceptance test "deletes a category without transactions" (its unit namesake is the test changed above).

- [ ] **Step 4: Change the schema and generate the migration**

In `src/modules/categories/infrastructure/categories.schema.ts`:

1. Add after the two lines `    key: text("key"),` / `    archivedAt: tz("archived_at"),` (in `categories`; `category_groups` has its own `archivedAt` line):

```ts
    // D8 (Task 0a): deleting a category is logical; the row stays for the transactions that name it.
    deletedAt: tz("deleted_at"),
```

2. Replace the two lines `    // HU-E3-02: unique per parent ignoring case (archived rows included).` / ``     uniqueIndex("categories_group_name_uq").on(t.groupId, sql`lower(${t.name})`), `` with:

```ts
    // HU-E3-02: unique per parent ignoring case among rows not deleted (archived ones included; D8).
    uniqueIndex("categories_group_name_uq")
      .on(t.groupId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
```

Run: `pnpm db:generate --name category_soft_delete`
Expected: `drizzle/0008_category_soft_delete.sql`, which adds `categories.deleted_at timestamp with time zone`, drops `categories_group_name_uq` and creates it again as `… USING btree ("group_id",lower("name")) WHERE "categories"."deleted_at" IS NULL`; `drizzle/meta/0008_snapshot.json`; a `0008_category_soft_delete` journal entry. Nothing is renamed; if drizzle-kit prompts, answer "create" for the column.

Run: `pnpm exec vitest run --project integration src/modules/categories`
Expected: FAIL, still on the hard delete (`transactions_category_id_categories_id_fk`); the migration alone changes no behaviour.

- [ ] **Step 5: Implement the logical delete**

In `src/modules/categories/application/category-repository.ts`:

1. Replace the line `  /** Every category of the space, archived ones included. */` with:

```ts
  /** Every category of the space that is not deleted (D8, Task 0a), archived ones included. */
```

2. Replace the line `  deleteCategory(spaceId: string, categoryId: string): Promise<void>;` with:

```ts
  /** D8 (Task 0a): logical; the row and every reference to it stay, and `listCategories` skips it. */
  deleteCategory(spaceId: string, categoryId: string, deletedAt: Date): Promise<void>;
```

In `src/modules/categories/infrastructure/drizzle-category-repository.ts`:

1. Replace the line `import { and, eq } from "drizzle-orm";` with:

```ts
import { and, eq, isNull } from "drizzle-orm";
```

2. Replace the line `    const rows = await this.tm.executor().select().from(categories).where(eq(categories.spaceId, spaceId));` with:

```ts
    // D8 (Task 0a): deleted categories stay stored, but every read skips them, so they answer as missing.
    const rows = await this.tm
      .executor()
      .select({
        id: categories.id,
        spaceId: categories.spaceId,
        groupId: categories.groupId,
        name: categories.name,
        key: categories.key,
        archivedAt: categories.archivedAt,
        createdAt: categories.createdAt,
      })
      .from(categories)
      .where(and(eq(categories.spaceId, spaceId), isNull(categories.deletedAt)));
```

3. Replace the line `  async deleteCategory(spaceId: string, categoryId: string): Promise<void> {` with:

```ts
  async deleteCategory(spaceId: string, categoryId: string, deletedAt: Date): Promise<void> {
```

4. Replace the line `      .delete(categories)` with:

```ts
      .update(categories)
      .set({ deletedAt })
```

In `src/modules/categories/application/delete-category.ts`, replace the line `      await deps.categories.deleteCategory(manager.value.spaceId, category.value.id);` with:

```ts
      // D8 (Task 0a): logical; the row stays, and lists, lookups and name checks skip it.
      await deps.categories.deleteCategory(manager.value.spaceId, category.value.id, deps.clock.now());
```

In `tests/support/in-memory-categories.ts`:

1. Add after the line `  categories: Category[] = [];`:

```ts
  /** D8 (Task 0a): when each deleted category was deleted; the rows stay, and lists skip them. */
  readonly deleted = new Map<string, Date>();
```

2. Replace the line `    return this.categories.filter((c) => c.spaceId === spaceId);` with:

```ts
    return this.categories.filter((c) => c.spaceId === spaceId && !this.deleted.has(c.id));
```

3. Replace the two lines `  async deleteCategory(spaceId: string, categoryId: string) {` / `    this.categories = this.categories.filter((c) => !(c.spaceId === spaceId && c.id === categoryId));` with:

```ts
  async deleteCategory(spaceId: string, categoryId: string, deletedAt: Date) {
    if (this.categories.some((c) => c.spaceId === spaceId && c.id === categoryId)) {
      this.deleted.set(categoryId, deletedAt);
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm db:check && pnpm exec vitest run --project unit src/modules/categories && pnpm exec vitest run --project integration src/modules/categories && pnpm exec vitest run --project acceptance tests/acceptance/categories.test.ts`
Expected: "No schema drift" and PASS, M1's category tests included ("enforces unique names per group ignoring case" still refuses `MERCADO` next to the live Mercado). Mutation checks: temporarily remove `isNull(categories.deletedAt)` from `listCategories` (keep only the `eq`). The acceptance test fails because Panadería is listed again, and the integration test fails because Mercado is still listed. Restore it. Temporarily replace `.update(categories)` / `.set({ deletedAt })` with M1's `.delete(categories)`. The integration test fails with `transactions_category_id_categories_id_fk`, and the acceptance test finds no row. Restore it.

- [ ] **Step 7: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0. The OpenAPI snapshot test passes unchanged: no contract changes.

- [ ] **Step 8: Commit**

```bash
git add docs/specs/2026-10-11-hearth-design.md src/modules/categories/infrastructure/categories.schema.ts src/modules/categories/application/category-repository.ts src/modules/categories/infrastructure/drizzle-category-repository.ts src/modules/categories/application/delete-category.ts tests/support/in-memory-categories.ts src/modules/categories/application/retire-categories.test.ts src/modules/categories/infrastructure/drizzle-category-repository.int.test.ts tests/acceptance/categories.test.ts drizzle/0008_category_soft_delete.sql drizzle/meta/0008_snapshot.json drizzle/meta/_journal.json
git commit -m "feat(categories): delete categories logically, as amended spec D8 requires (Refs #29)"
```

---

### Task 0b: Ledger — the audit keeps every payment and share

Second half of the owner directive (spec D8 as amended in Task 0a). M1's `DrizzleTransactionRepository.save` replaces an expense's `payments` and `shares` rows on every save (`db.delete(payments)`, `db.delete(shares)`, then `insertParts`). `changesBetween` audits only `description`, `date`, `categoryId` and `amount` (`AUDITED`), so the split that an edit replaced is lost, and a deletion audits `changes: {}`. From now on the audit entry of every edit records the full payments and shares, before and after, whenever they changed, and a deletion records the whole last version. HU-E4-06 (issue #35) is a closed M1 story, so the commit says `Refs #35`, never `Closes`. Pins Review Focus 6 for the ledger.

Decisions:
- The rows keep holding the current version, so balances, the balance sheet and every ledger query read them unchanged; the audit holds the history. Versioned payment and share rows were the alternative. They were rejected because every balance and balance-sheet query would have to pick the current version (Self-Review, assumption 14).
- `changesBetween` gains two keys, `payments` and `shares`, recorded only when they differ. Each is a deterministic JSON string of the parts in position order (the array order `insertParts` stores and `loadTransactions` reads back): a payment as `{"memberId","accountId","amount"}`, a share as `{"memberId","amount","splitMethod"}`, amounts in minor units as strings. Equal splits therefore compare equal, and the values survive `jsonb` unchanged. The `ChangeSet` stays a `Record<string, { from, to }>` of strings, so `transaction_audit.changes`, `AuditEntry`, `AuditEntrySchema` and the OpenAPI snapshot do not change.
- Today an edit changes the parts only when a sole payment or share follows a new amount (`reviseTransaction`, HU-E4-06). The snapshot covers any later way of editing a split as well, so the pure and integration tests build the changed split directly.
- `deletionChanges(tx)` gives a deletion the whole last version: every audited field and, for an expense, both parts, each `{ from: <value>, to: null }`. Null values are left out (a transfer's category; the parts of other types). The other fields of incomes, transfers and settlements cannot be edited, and their row stays (D8), so nothing of them is lost.
- M1's expectations that pinned the old `ChangeSet` change in this task. The unit test and the acceptance test that audit an amount edit now also see the sole payment and the sole share follow the amount.
- Task 4b runs later and edits the same files. It anchors only on lines this task leaves alone (`/** D8: transactions are never hard-deleted. */`, `  canModify,`, `import { openPeriod } from "./checks";`, `      if (!open.ok) return open;`, `} from "../../../../tests/support/in-memory-ledger";`) and appends to the end of `transaction.test.ts` and `edit-and-delete.test.ts`, after this task's blocks. Its check `if (changes.amount)` reads a key this task keeps.

**Files:**
- Modify: `src/modules/ledger/domain/transaction.ts`, `src/modules/ledger/application/delete-transaction.ts`, `src/modules/ledger/infrastructure/drizzle-transaction-repository.ts` (a comment), `src/modules/ledger/contracts/ledger.contract.ts` (a comment)
- Test: `src/modules/ledger/domain/transaction.test.ts`, `src/modules/ledger/application/edit-and-delete.test.ts`, `src/modules/ledger/infrastructure/drizzle-transaction-repository.int.test.ts`, `tests/acceptance/ledger.test.ts`

**Interfaces:**
- Consumes: `Transaction`, `Expense`, `ChangeSet`, `reviseTransaction`, `recordExpense`, `recordSettlement` (ledger domain); `AuditLog.append`/`listFor`, `DrizzleAuditLog`, `DrizzleTransactionRepository`; `sharedLedgerFixture` (`tests/support/fixtures.ts`); `anExpense`, `CATEGORIES`, `ledgerFixture` (`tests/support/in-memory-ledger.ts`); `shared()`, `common`, `later` (`transaction.test.ts`); `ledgerUser`, `market`, `recorded`, `onTransaction`, `auditOf` (`tests/acceptance/ledger.test.ts`); `post`, `cop`, `TransactionDto` (`tests/support/ledger.ts`).
- Produces:
  - `changesBetween(before, after)` also returns `payments` and `shares` (`{ from: string; to: string }`, JSON arrays) when an expense's parts changed.
  - `deletionChanges(tx: Transaction): ChangeSet`.
  - `DeleteTransaction` audits `changes: deletionChanges(current)`.

- [ ] **Step 1: Write the failing tests**

In `src/modules/ledger/domain/transaction.test.ts`:

1. Add after the line `  changesBetween,` (in the import from `./transaction`):

```ts
  deletionChanges,
```

2. Replace the lines from `    expect(changesBetween(before, after)).toEqual({` to `    expect(changesBetween(before, before)).toEqual({});` with:

```ts
    // D8 (Task 0b): the sole payment and share followed the amount, so both versions are kept.
    expect(changesBetween(before, after)).toEqual({
      date: { from: "2026-10-05", to: "2026-11-02" },
      amount: { from: "8500000", to: "9500000" },
      payments: {
        from: '[{"memberId":"member-ana","accountId":"acc-bancolombia","amount":"8500000"}]',
        to: '[{"memberId":"member-ana","accountId":"acc-bancolombia","amount":"9500000"}]',
      },
      shares: {
        from: '[{"memberId":"member-ana","amount":"8500000","splitMethod":"EQUAL"}]',
        to: '[{"memberId":"member-ana","amount":"9500000","splitMethod":"EQUAL"}]',
      },
    });
    expect(changesBetween(before, before)).toEqual({});
```

3. Append to the end of the file:

```ts

describe("the audit keeps every payment and share (D8, Task 0b)", () => {
  it("keeps the whole earlier split, in position order, when an edit changes it", () => {
    const before = shared();
    const after: Expense = {
      ...before,
      shares: [
        { memberId: "member-juan", amount: 20_000_000n, splitMethod: "EXACT" },
        { memberId: "member-ana", amount: 10_000_000n, splitMethod: "EXACT" },
      ],
    };
    const changes = changesBetween(before, after);
    expect(Object.keys(changes)).toEqual(["shares"]);
    expect(JSON.parse(changes.shares!.from!)).toEqual([
      { memberId: "member-ana", amount: "15000000", splitMethod: "EQUAL" },
      { memberId: "member-juan", amount: "15000000", splitMethod: "EQUAL" },
    ]);
    expect(JSON.parse(changes.shares!.to!)).toEqual([
      { memberId: "member-juan", amount: "20000000", splitMethod: "EXACT" },
      { memberId: "member-ana", amount: "10000000", splitMethod: "EXACT" },
    ]);
  });

  it("snapshots the whole last version of a deleted expense", () => {
    expect(deletionChanges(shared())).toEqual({
      description: { from: "Market", to: null },
      date: { from: "2026-10-05", to: null },
      categoryId: { from: "cat-groceries", to: null },
      amount: { from: "30000000", to: null },
      payments: { from: '[{"memberId":"member-ana","accountId":"acc-bancolombia","amount":"30000000"}]', to: null },
      shares: {
        from: '[{"memberId":"member-ana","amount":"15000000","splitMethod":"EQUAL"},{"memberId":"member-juan","amount":"15000000","splitMethod":"EQUAL"}]',
        to: null,
      },
    });
  });

  it("records no parts for a settlement, on edits and on deletion", () => {
    const settlement = unwrap(
      recordSettlement({
        ...common,
        amount: 100n,
        payerMemberId: "member-juan",
        receivingMemberId: "member-ana",
        sourceAccountId: null,
        destinationAccountId: null,
      }),
    );
    const revised = unwrap(reviseTransaction(settlement, { amount: 200n }, later));
    expect(changesBetween(settlement, revised)).toEqual({ amount: { from: "100", to: "200" } });
    expect(deletionChanges(settlement)).toEqual({
      description: { from: "Market", to: null },
      date: { from: "2026-10-05", to: null },
      amount: { from: "100", to: null },
    });
  });
});
```

In `src/modules/ledger/application/edit-and-delete.test.ts`:

1. Replace the line `        changes: { amount: { from: "8500000", to: "9500000" } },` with:

```ts
        // D8 (Task 0b): the sole payment and share followed the amount; the audit keeps both versions.
        changes: {
          amount: { from: "8500000", to: "9500000" },
          payments: {
            from: '[{"memberId":"member-ana","accountId":"acc-bancolombia","amount":"8500000"}]',
            to: '[{"memberId":"member-ana","accountId":"acc-bancolombia","amount":"9500000"}]',
          },
          shares: {
            from: '[{"memberId":"member-ana","amount":"8500000","splitMethod":"EQUAL"}]',
            to: '[{"memberId":"member-ana","amount":"9500000","splitMethod":"EQUAL"}]',
          },
        },
```

2. Add after the line `    expect(entries.map((e) => [e.action, e.actorUserId])).toEqual([["DELETED", "u-ana"]]);`:

```ts
    // D8 (Task 0b): the deletion keeps the whole last version, payments and shares included.
    expect(entries[0]?.changes).toEqual({
      description: { from: "Market", to: null },
      date: { from: "2026-10-31", to: null },
      categoryId: { from: CATEGORIES.groceries.id, to: null },
      amount: { from: "8500000", to: null },
      payments: { from: '[{"memberId":"member-ana","accountId":"acc-bancolombia","amount":"8500000"}]', to: null },
      shares: { from: '[{"memberId":"member-ana","amount":"8500000","splitMethod":"EQUAL"}]', to: null },
    });
```

In `src/modules/ledger/infrastructure/drizzle-transaction-repository.int.test.ts`:

1. Insert before the line `  recordExpense,` (in the import from `../domain/transaction`):

```ts
  changesBetween,
```

2. Append to the end of the file:

```ts

describe("the audit keeps every split an edit replaces (D8, Task 0b)", () => {
  it("recovers the shares that save replaced from the audit read back from PostgreSQL", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const ana = w.household.memberId;
    const before = unwrap(
      recordExpense({
        ...common(10_000_000n),
        spaceId: w.household.spaceId,
        categoryId: w.groceries,
        payments: [{ memberId: ana, accountId: w.bank, amount: 10_000_000n }],
        shares: [
          { memberId: ana, amount: 5_000_000n, splitMethod: "EQUAL" },
          { memberId: w.pedro, amount: 5_000_000n, splitMethod: "EQUAL" },
        ],
      }),
    );
    await repo.add(before);
    const after: Expense = {
      ...before,
      shares: [
        { memberId: ana, amount: 2_000_000n, splitMethod: "EXACT" },
        { memberId: w.pedro, amount: 8_000_000n, splitMethod: "EXACT" },
      ],
    };
    expect(await repo.save(after, 1)).toBe(true);
    await auditLog.append({
      id: randomUUID(),
      transactionId: before.id,
      action: "UPDATED",
      actorUserId: w.household.userId,
      at: now,
      changes: changesBetween(before, after),
    });
    // The rows hold the current version only; the split they replaced lives in the audit.
    expect(await repo.findById(w.household.spaceId, before.id)).toEqual({ ...after, version: 2 });
    const [entry] = await auditLog.listFor(before.id);
    expect(Object.keys(entry!.changes)).toEqual(["shares"]);
    const earlier = JSON.parse(entry!.changes.shares!.from!) as { amount: string }[];
    expect(earlier.map((s) => ({ ...s, amount: BigInt(s.amount) }))).toEqual(before.shares);
  });
});
```

In `tests/acceptance/ledger.test.ts`:

1. Replace the line `        changes: { amount: { from: "8500000", to: "9500000" } },` with:

```ts
        // Task 0b: the parts that followed the amount are pinned in "the audit keeps every payment and share".
        changes: expect.objectContaining({ amount: { from: "8500000", to: "9500000" } }),
```

2. Append to the end of the file:

```ts

describe("the audit keeps every payment and share (D8, Task 0b)", () => {
  const partsOf = (tx: TransactionDto) => ({
    payments: JSON.stringify(
      tx.payments.map((p) => ({ memberId: p.memberId, accountId: p.accountId, amount: p.amount.amount })),
    ),
    shares: JSON.stringify(
      tx.shares.map((s) => ({ memberId: s.memberId, amount: s.amount.amount, splitMethod: s.splitMethod })),
    ),
  });

  it("returns the split an edit replaced and the whole version a deletion retired", async () => {
    const ana = await ledgerUser("Ana");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    const response = await onTransaction(editTransaction, "PATCH", ana, tx.id, { body: { amount: cop(95_000) } });
    const edited = (await response.json()) as TransactionDto;
    expect((await onTransaction(deleteTransaction, "DELETE", ana, tx.id)).status).toBe(204);
    const [before, after] = [partsOf(tx), partsOf(edited)];
    expect(JSON.parse(before.payments)).toEqual([
      { memberId: tx.payments[0]!.memberId, accountId: ana.bancolombia, amount: "8500000" },
    ]);
    expect((await auditOf(ana, tx.id)).map((e) => [e.action, e.changes])).toEqual([
      [
        "UPDATED",
        {
          amount: { from: "8500000", to: "9500000" },
          payments: { from: before.payments, to: after.payments },
          shares: { from: before.shares, to: after.shares },
        },
      ],
      [
        "DELETED",
        {
          description: { from: "Market", to: null },
          date: { from: "2026-10-05", to: null },
          categoryId: { from: ana.groceries, to: null },
          amount: { from: "9500000", to: null },
          payments: { from: after.payments, to: null },
          shares: { from: after.shares, to: null },
        },
      ],
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger && pnpm exec vitest run --project integration src/modules/ledger/infrastructure/drizzle-transaction-repository.int.test.ts && pnpm exec vitest run --project acceptance tests/acceptance/ledger.test.ts`
Expected: FAIL with `deletionChanges is not a function`. The audited changes lack `payments` and `shares` (in the unit, integration and acceptance expectations), and the DELETED entries carry `{}`. Every other test passes.

- [ ] **Step 3: Implement**

In `src/modules/ledger/domain/transaction.ts`:

1. Replace the line `/** Audited field changes; values are strings so bigints survive JSON. */` with:

```ts
/**
 * Audited changes; values are strings so bigints survive JSON. An expense's `payments` and `shares`
 * are JSON arrays in position order, and a deletion lists every value it retires with `to: null` (D8).
 */
```

2. Replace everything from the line `const AUDITED = ["description", "date", "categoryId", "amount"] as const;` up to, not including, the line `/** HU-E4-06: owners and admins change any transaction, members only their own, viewers none. */` with:

```ts
const AUDITED = ["description", "date", "categoryId", "amount"] as const;

/**
 * D8 (Task 0b): every audited value as a string — the fields and, for an expense, its payments and
 * shares as deterministic JSON in position order (amounts in minor units). Saving an edit replaces
 * their rows, so the audit is where every earlier split lives.
 */
const auditedValues = (tx: Transaction): ReadonlyMap<string, string | null> => {
  const values = new Map<string, string | null>(
    AUDITED.map((field): [string, string | null] => [field, tx[field] === null ? null : String(tx[field])]),
  );
  if (tx.type === "EXPENSE") {
    const payments = tx.payments.map((p) => ({
      memberId: p.memberId,
      accountId: p.accountId,
      amount: p.amount.toString(),
    }));
    const shares = tx.shares.map((s) => ({
      memberId: s.memberId,
      amount: s.amount.toString(),
      splitMethod: s.splitMethod,
    }));
    values.set("payments", JSON.stringify(payments));
    values.set("shares", JSON.stringify(shares));
  }
  return values;
};

export const changesBetween = (before: Transaction, after: Transaction): ChangeSet => {
  const revised = auditedValues(after);
  const changes: Record<string, { from: string | null; to: string | null }> = {};
  for (const [key, from] of auditedValues(before)) {
    const to = revised.get(key) ?? null;
    if (from !== to) changes[key] = { from, to };
  }
  return changes;
};

/** D8 (Task 0b): a deletion keeps the whole last version in the audit, every value with `to: null`. */
export const deletionChanges = (tx: Transaction): ChangeSet => {
  const changes: Record<string, { from: string; to: null }> = {};
  for (const [key, from] of auditedValues(tx)) if (from !== null) changes[key] = { from, to: null };
  return changes;
};

```

In `src/modules/ledger/application/delete-transaction.ts`:

1. Replace the line `import { canModify, softDelete } from "../domain/transaction";` with:

```ts
import { canModify, deletionChanges, softDelete } from "../domain/transaction";
```

2. Replace the line `        changes: {},` with:

```ts
        changes: deletionChanges(current),
```

In `src/modules/ledger/infrastructure/drizzle-transaction-repository.ts`, insert before the line `      await db.delete(payments).where(eq(payments.transactionId, transaction.id));`:

```ts
      // D8: these rows hold the current version only; the audit keeps every earlier split (Task 0b).
```

In `src/modules/ledger/contracts/ledger.contract.ts`, replace the line `  /** Changed fields with their previous and new values; amounts in minor units as strings. */` with:

```ts
  /**
   * Changed values as strings (amounts in minor units); an expense's `payments` and `shares` are JSON
   * arrays (D8, Task 0b), and a deletion lists every value it retires with `to: null`.
   */
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/ledger && pnpm exec vitest run --project integration src/modules/ledger && pnpm exec vitest run --project acceptance tests/acceptance/ledger.test.ts`
Expected: PASS, including M1's edit and delete tests with their new expectations ("writes nothing for an edit that changes nothing" still sees `{}`: unchanged parts compare equal). Mutation checks: temporarily delete the line `    values.set("shares", JSON.stringify(shares));`. The shares expectations of the unit, integration and acceptance tests fail. Restore it. Temporarily replace `deletionChanges(current)` with `{}` in `delete-transaction.ts`. The DELETED expectations of `edit-and-delete.test.ts` and `ledger.test.ts` fail. Restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0. The OpenAPI snapshot test passes unchanged: `AuditEntrySchema` keeps its shape, and only a code comment changed.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/domain/transaction.ts src/modules/ledger/domain/transaction.test.ts src/modules/ledger/application/delete-transaction.ts src/modules/ledger/application/edit-and-delete.test.ts src/modules/ledger/infrastructure/drizzle-transaction-repository.ts src/modules/ledger/infrastructure/drizzle-transaction-repository.int.test.ts src/modules/ledger/contracts/ledger.contract.ts tests/acceptance/ledger.test.ts
git commit -m "feat(ledger): keep every payment and share in the audit of edits and deletions (Refs #35)"
```

---

### Task 1: Spaces domain — leaving, guest removal and settled balances

Implements the pure rules of HU-E1-08 (issue #17) and HU-E1-12 (issue #21): who may leave, which member is a removable guest, when balances count as settled, and which spaces let members change at all. Adds the two matrix actions both stories authorize with. Pins Review Focus 1 at the domain level.

Decisions:
- `space.leave` is open to every role, VIEWER included (HU-E1-08 "As a member"; a viewer who only read still leaves); `guest.remove` follows spec D15 ("any member with role MEMBER or above … remove a guest whose balance is zero"). Both live in the matrix only.
- The "a space keeps one OWNER" rule moves into one private helper, `isLastOwner`, shared by `changeMemberRole` (M2-A, behaviour unchanged) and the new `leavingMember`.
- `outstandingIn(nets)` turns net balances into one positive amount: for one member it is `|net|` (a debtor owes it, a creditor is owed it — HU-E1-08's "money owed by a guest also blocks leaving"); for several members it is what the creditors are owed or what the debtors owe, whichever is larger, so a list that does not hold every member of the space still reports a non-zero amount when anyone is unsettled (archiving checks current members only, Task 17).
- `ensureSettled` is the one place that refuses with `OutstandingBalance`; its details carry `outstanding: { amount: "<minor units>", currency }`, the shape the problem body will expose (Task 4).
- `ensureMembersCanChange` answers `PersonalSpaceNotShareable` for personal spaces (HU-E1-08 scenario) and the new `DirectSpaceMembersFixed` for direct spaces (D16: exactly two members, both OWNER; a direct space is retired only by archiving, ruling O7). It lives in `space.ts`, because `member.ts` imports `space.ts` and the reverse would be an import cycle.
- `DirectSpaceMembersFixed` is a new error code, so it joins the backlog's catalogue here (spec 8: "the backlog is the full catalogue"; ruling O6), in HU-E1-08's technical notes.

**Files:**
- Modify: `src/modules/spaces/domain/permissions.ts`, `src/modules/spaces/domain/member.ts`, `src/modules/spaces/domain/space.ts`, `docs/backlog/E1-identity-and-spaces.md`
- Test: `src/modules/spaces/domain/permissions.test.ts`, `src/modules/spaces/domain/member.test.ts`, `src/modules/spaces/domain/space.test.ts`

**Interfaces:**
- Consumes: `SpaceMember`, `Space`, `SpaceRole` (`domain/space.ts`); `domainError`, `err`, `ok`, `Result` (kernel).
- Produces:
  - `SpaceAction` gains `"space.leave"` (OWNER, ADMIN, MEMBER, VIEWER) and `"guest.remove"` (OWNER, ADMIN, MEMBER).
  - `leavingMember(current: readonly SpaceMember[], memberId: string): Result<SpaceMember>` — `MemberNotFound`, `LastOwnerRequired`
  - `currentGuest(current: readonly SpaceMember[], memberId: string): Result<SpaceMember>` — `MemberNotFound`, `NotAGuest`
  - `outstandingIn(nets: readonly bigint[]): bigint` (never negative)
  - `ensureSettled(outstanding: bigint, currency: string): Result<void>` — `OutstandingBalance` with `details.outstanding = { amount: string, currency: string }`
  - `ensureMembersCanChange(space: Pick<Space, "kind">): Result<void>` — `PersonalSpaceNotShareable`, `DirectSpaceMembersFixed`

- [ ] **Step 1: Write the failing tests**

In `src/modules/spaces/domain/permissions.test.ts`:

1. Add after the line `    ["Sofi records a settlement for Pedro", "VIEWER", "money.record", false],`:

```ts
    ["Sofi leaves the space", "VIEWER", "space.leave", true],
    ["Luis removes the guest Pedro", "MEMBER", "guest.remove", true],
    ["Sofi removes the guest Pedro", "VIEWER", "guest.remove", false],
```

2. Replace the three lines from `  it("lets owners do everything and viewers only read", () => {` to `    expect(SPACE_ACTIONS.filter((action) => can("VIEWER", action))).toEqual(["space.read"]);` with:

```ts
  it("lets owners do everything and viewers only read or leave (HU-E1-08)", () => {
    for (const action of SPACE_ACTIONS) expect(can("OWNER", action)).toBe(true);
    expect(SPACE_ACTIONS.filter((action) => can("VIEWER", action))).toEqual(["space.read", "space.leave"]);
```

In `src/modules/spaces/domain/member.test.ts`:

1. Add after the line `  changeMemberRole,` (in the import from `./member`):

```ts
  currentGuest,
  ensureSettled,
  leavingMember,
  outstandingIn,
```

2. Append to the end of the file:

```ts

describe("leaving (HU-E1-08)", () => {
  it("lets a current member leave", () => {
    expect(leavingMember(current, "luis")).toEqual({ ok: true, value: luis });
  });

  it("keeps the only OWNER, but lets an owner leave once another OWNER exists", () => {
    expect(code(leavingMember(current, "ana"))).toBe("LastOwnerRequired");
    const twoOwners = [ana, { ...luis, role: "OWNER" as const }];
    expect(code(leavingMember(twoOwners, "ana"))).toBe("ok");
  });

  it("reports someone who is not a current member as MemberNotFound", () => {
    expect(code(leavingMember(current, "nobody"))).toBe("MemberNotFound");
  });
});

describe("removing guests (HU-E1-12)", () => {
  it("finds a current guest", () => {
    expect(currentGuest(current, "pedro")).toEqual({ ok: true, value: pedro });
  });

  it("never treats a registered member as a guest", () => {
    expect(code(currentGuest(current, "luis"))).toBe("NotAGuest");
  });

  it("reports unknown and malformed ids as MemberNotFound", () => {
    expect(code(currentGuest(current, "nobody"))).toBe("MemberNotFound");
    expect(code(currentGuest(current, "not-a-uuid"))).toBe("MemberNotFound");
  });
});

describe("settled balances (HU-E1-08, HU-E1-09, HU-E1-12)", () => {
  it("lets settled members go", () => {
    expect(ensureSettled(outstandingIn([0n, 0n]), "COP")).toEqual({ ok: true, value: undefined });
  });

  it("reports what one member owes or is owed as a positive outstanding amount (Review Focus 1)", () => {
    expect(outstandingIn([-15_000_000n])).toBe(15_000_000n);
    expect(outstandingIn([5_000_000n])).toBe(5_000_000n);
  });

  it("totals what is owed among several members, also when only debtors are listed", () => {
    expect(outstandingIn([15_000_000n, -10_000_000n, -5_000_000n])).toBe(15_000_000n);
    expect(outstandingIn([-5_000_000n, -2_000_000n])).toBe(7_000_000n);
  });

  it("refuses an outstanding amount with OutstandingBalance, carrying it in minor units", () => {
    expect(ensureSettled(15_000_000n, "COP")).toEqual({
      ok: false,
      error: { code: "OutstandingBalance", details: { outstanding: { amount: "15000000", currency: "COP" } } },
    });
  });
});
```

In `src/modules/spaces/domain/space.test.ts`:

1. Add after the line `  ensureCanAddMember,`:

```ts
  ensureMembersCanChange,
```

2. Append to the end of the file:

```ts

describe("membership changes (HU-E1-08, HU-E1-12, D16)", () => {
  it("happen in shared spaces only", () => {
    expect(ensureMembersCanChange({ kind: "SHARED" })).toEqual({ ok: true, value: undefined });
    const personal = ensureMembersCanChange({ kind: "PERSONAL" });
    expect(!personal.ok && personal.error.code).toBe("PersonalSpaceNotShareable");
    const direct = ensureMembersCanChange({ kind: "DIRECT" });
    expect(!direct.ok && direct.error.code).toBe("DirectSpaceMembersFixed");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/spaces/domain`
Expected: FAIL — the new permission rows throw `Cannot read properties of undefined (reading 'includes')` (the actions are not in the matrix) and the viewer test sees `["space.read"]`; the member and space tests fail because `leavingMember`, `currentGuest`, `outstandingIn`, `ensureSettled` and `ensureMembersCanChange` do not exist yet (`… is not a function`).

- [ ] **Step 3: Implement**

In `src/modules/spaces/domain/permissions.ts`:

1. Add after the line `  "space.archive": ["OWNER"],`:

```ts
  /** HU-E1-08: any current member leaves; the last OWNER and unsettled members cannot. */
  "space.leave": ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
```

2. Add after the line `  "guest.add": ["OWNER", "ADMIN", "MEMBER"],`:

```ts
  /** HU-E1-12, D15: remove a guest whose balance is zero. */
  "guest.remove": ["OWNER", "ADMIN", "MEMBER"],
```

In `src/modules/spaces/domain/member.ts`:

1. Insert before the line `/** HU-E1-05: a registered member's new role; guests have no role (D15) and a space keeps one OWNER. */`:

```ts
/** A space always keeps an OWNER (HU-E1-04): the only one can neither step down nor leave. */
const isLastOwner = (current: readonly SpaceMember[], member: SpaceMember): boolean =>
  member.role === "OWNER" && current.filter((m) => m.role === "OWNER").length === 1;

```

2. Replace the four lines from `  const owners = current.filter((m) => m.role === "OWNER").length;` to the first `  }` after it (the `if (target.role === "OWNER" && role !== "OWNER" && owners === 1) {` block) with:

```ts
  if (role !== "OWNER" && isLastOwner(current, target)) return err(domainError("LastOwnerRequired"));
```

3. Append to the end of the file:

```ts

/** HU-E1-08: the current member who leaves; the last OWNER stays (HU-E1-04). */
export const leavingMember = (current: readonly SpaceMember[], memberId: string): Result<SpaceMember> => {
  const leaver = current.find((m) => m.id === memberId);
  if (!leaver) return err(domainError("MemberNotFound"));
  return isLastOwner(current, leaver) ? err(domainError("LastOwnerRequired")) : ok(leaver);
};

/** HU-E1-11, HU-E1-12: a current guest of the space; registered members are never handled as guests. */
export const currentGuest = (current: readonly SpaceMember[], memberId: string): Result<SpaceMember> => {
  const member = current.find((m) => m.id === memberId);
  if (!member) return err(domainError("MemberNotFound"));
  return member.kind === "GUEST" ? ok(member) : err(domainError("NotAGuest"));
};

/**
 * What keeps the given net balances from being settled, as one positive amount: what the creditors among
 * them are owed or what the debtors owe, whichever is larger (both are equal when every member of a space
 * is listed). For a single member it is |net|.
 */
export const outstandingIn = (nets: readonly bigint[]): bigint => {
  let owed = 0n;
  let owing = 0n;
  for (const net of nets) {
    if (net > 0n) owed += net;
    else owing -= net;
  }
  return owed > owing ? owed : owing;
};

/**
 * HU-E1-08, HU-E1-09, HU-E1-12: money is settled first. The outstanding amount, in minor units of the
 * space currency, is the one public detail of an error code (the problem+json member `outstanding`).
 */
export const ensureSettled = (outstanding: bigint, currency: string): Result<void> =>
  outstanding === 0n
    ? ok(undefined)
    : err(domainError("OutstandingBalance", { outstanding: { amount: outstanding.toString(), currency } }));
```

In `src/modules/spaces/domain/space.ts`, insert before the line `const MAX_SPACE_NAME = 80;`:

```ts
/**
 * HU-E1-08, HU-E1-12, D16: members leave, are removed or change role only in shared spaces; a personal
 * space keeps its one owner and a direct space its two members, both OWNER when registered.
 */
export const ensureMembersCanChange = (space: Pick<Space, "kind">): Result<void> => {
  if (space.kind === "PERSONAL") return err(domainError("PersonalSpaceNotShareable"));
  return space.kind === "DIRECT" ? err(domainError("DirectSpaceMembersFixed")) : ok(undefined);
};

```

In `docs/backlog/E1-identity-and-spaces.md` (HU-E1-08 technical notes), add after the line `- Former members cannot be selected as payer or participant on new transactions.`:

```md
- A direct space (D16) keeps its two members: leaving it, removing its guest or changing a role in it answers `DirectSpaceMembersFixed` (409); a direct space is retired by archiving it (HU-E1-09).
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/spaces`
Expected: PASS, including M2-A's "keeps at least one OWNER" (now through `isLastOwner`). Mutation check: temporarily delete the line `    else owing -= net;` in `outstandingIn` — "totals what is owed … only debtors" fails with `0n`; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (`domain-must-be-pure` holds; `no-circular` holds: `space.ts` imports nothing from `member.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/domain/permissions.ts src/modules/spaces/domain/permissions.test.ts src/modules/spaces/domain/member.ts src/modules/spaces/domain/member.test.ts src/modules/spaces/domain/space.ts src/modules/spaces/domain/space.test.ts docs/backlog/E1-identity-and-spaces.md
git commit -m "feat(spaces): add the leave, guest removal and settled-balance rules (Refs #17, Refs #21)"
```

---

### Task 2: Spaces — LeaveSpace and the GetMemberNetBalance query

Implements HU-E1-08 (issue #17) as a use case, and the public balances query `GetMemberNetBalance` that HU-E1-08, HU-E1-09 and HU-E1-12 consume (HU-E5-01 technical note, deferred by M2-B). Pins Review Focus 1 at the use-case level.

Decisions:
- Spaces reads balances through `MemberNetBalance = (spaceId, memberId) => Promise<bigint>` in `lifecycle-deps.ts`; the composition root binds it to `createGetMemberNetBalance(ledgerQueries)` (Task 4). `balances` already imports `spaces`, so the reverse import would be a cycle.
- `GetMemberNetBalance` does not authorize: it is a module-to-module query whose callers (`LeaveSpace`, `RemoveGuestMember`, `ArchiveSpace`) authorize first. It reuses `BalanceSource.memberTotals` and `netOf` (M2-B), so the balance rule stays in one place.
- `LeaveSpace` reads the current members with `{ lock: true }`, like `ChangeMemberRole`, so two owners leaving at once run one at a time (pinned in Task 3); the last-owner check therefore runs on locked rows.
- Order of checks: membership and matrix (`space.leave`), kind of space, last OWNER, balance. A personal or direct space is refused before any balance is read.
- `markLeft` lives on a new port `MemberLifecycleRepository`; `LeaveSpace` passes kind `USER` (guests never act). Its boolean is not needed here: on the locked rows the leaver is current.

**Files:**
- Create: `src/modules/spaces/application/lifecycle-deps.ts`, `src/modules/spaces/application/leave-space.ts`, `src/modules/balances/application/get-member-net-balance.ts`
- Modify: `src/modules/spaces/application/space-member-repository.ts`, `src/modules/spaces/application/index.ts`, `src/modules/balances/application/index.ts`, `tests/support/in-memory-spaces.ts`
- Test: `src/modules/spaces/application/leave-space.test.ts`, `src/modules/balances/application/get-member-net-balance.test.ts`

**Interfaces:**
- Consumes: `leavingMember`, `ensureSettled`, `outstandingIn`, `ensureMembersCanChange`, `space.leave` (Task 1); `authorizeSpaceAction`, `createSpaceAccess`, `SpaceAccess`, `SpaceMemberRepository` (M2-A); `BalanceSource`, `netOf` (M2-B); `InMemorySpaceStore`, `householdSpace`, `HOUSEHOLD_MEMBERS`, `memberOf` (`tests/support/in-memory-spaces.ts`); `InMemoryTransactions`, `anExpense` (`tests/support/in-memory-ledger.ts`); `codeOf`, `memoryTm`, `unwrap` (`tests/support/fakes.ts`).
- Produces:
  - `interface MemberLifecycleRepository { markLeft(spaceId: SpaceId, memberId: SpaceMemberId, kind: SpaceMember["kind"], leftAt: Date): Promise<boolean> }`
  - `type MemberNetBalance = (spaceId: string, memberId: string) => Promise<bigint>`
  - `interface LifecycleDeps { access: SpaceAccess; members: Pick<SpaceMemberRepository, "listCurrent"> & MemberLifecycleRepository; netBalance: MemberNetBalance; clock: Clock; tm: TransactionManager }`
  - `type LeaveSpace = (input: { spaceId: string; userId: string }) => Promise<Result<void>>`; `createLeaveSpace(deps: LifecycleDeps): LeaveSpace` — errors `SpaceNotFound`, `PersonalSpaceNotShareable`, `DirectSpaceMembersFixed`, `LastOwnerRequired`, `OutstandingBalance`
  - `type GetMemberNetBalance = (spaceId: string, memberId: string) => Promise<bigint>`; `createGetMemberNetBalance(source: BalanceSource): GetMemberNetBalance`
  - `InMemorySpaceStore`: `left: { spaceId: string; memberId: string; leftAt: Date }[]`, `markLeft(…)` (same semantics as the port)
  - All of the above exported from `@/modules/spaces/application` and `@/modules/balances/application`.

- [ ] **Step 1: Write the in-memory twin and the failing tests**

In `tests/support/in-memory-spaces.ts`:

1. Add after the line `  spaces: Space[] = [];`:

```ts
  /** Members who left or were removed, in order (PostgreSQL keeps their rows, with left_at). */
  readonly left: { spaceId: string; memberId: string; leftAt: Date }[] = [];
```

2. Insert before the line `  /** Test setup: a space as earlier use cases would have left it. */`:

```ts
  /** MemberLifecycleRepository: like DrizzleSpaceRepository.markLeft, only a current member of that kind. */
  async markLeft(
    spaceId: string,
    memberId: string,
    kind: SpaceMember["kind"],
    leftAt: Date,
  ): Promise<boolean> {
    if (!this.members(spaceId).some((m) => m.id === memberId && m.kind === kind)) return false;
    this.update(spaceId, (s) => ({ ...s, members: s.members.filter((m) => m.id !== memberId) }));
    this.left.push({ spaceId, memberId, leftAt });
    return true;
  }

```

`src/modules/spaces/application/leave-space.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
import { codeOf, memoryTm, unwrap } from "../../../../tests/support/fakes";
import {
  HOUSEHOLD_MEMBERS,
  householdSpace,
  InMemorySpaceStore,
  memberOf,
} from "../../../../tests/support/in-memory-spaces";
import {
  createPersonalSpace,
  type Space,
  type SpaceId,
  type SpaceMember,
  type SpaceMemberId,
} from "../domain/space";
import { createLeaveSpace } from "./leave-space";
import type { LifecycleDeps } from "./lifecycle-deps";
import { createSpaceAccess } from "./space-access";

const now = new Date("2026-10-14T12:00:00Z");
const space = "space-household";
const as = (name: string) => ({ spaceId: space, userId: `u-${name}` });

/** Net balances of Household by member id (minor units); any other space answers 1, never settled. */
const nets =
  (byMember: Record<string, bigint> = {}): LifecycleDeps["netBalance"] =>
  async (spaceId, memberId) =>
    spaceId === space ? (byMember[memberId] ?? 0n) : 1n;

// HU-E1-05 Background members: OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi and the guest Pedro.
const setup = (seeded: Space = householdSpace(), byMember: Record<string, bigint> = {}) => {
  const store = new InMemorySpaceStore();
  store.seed(seeded);
  const deps: LifecycleDeps = {
    access: createSpaceAccess(store),
    members: store,
    netBalance: nets(byMember),
    clock: new FixedClock(now),
    tm: memoryTm,
  };
  return { store, leave: createLeaveSpace(deps) };
};
const idsOf = (members: readonly SpaceMember[]) => members.map((m) => m.id);

describe("LeaveSpace (HU-E1-08)", () => {
  it("lets Luis, whose balance is zero, leave: he is no longer a current member", async () => {
    const { store, leave } = setup();
    expect(unwrap(await leave(as("luis")))).toBeUndefined();
    expect(idsOf(store.members(space))).toEqual(["member-ana", "member-juan", "member-sofi", "member-pedro"]);
    expect(store.left).toEqual([{ spaceId: space, memberId: "member-luis", leftAt: now }]);
    expect(store.locked).toEqual([space]);
  });

  it("refuses Juan while he owes Ana 150,000 COP, with the outstanding amount (Review Focus 1)", async () => {
    const { store, leave } = setup(householdSpace(), {
      "member-ana": 15_000_000n,
      "member-juan": -15_000_000n,
    });
    expect(await leave(as("juan"))).toEqual({
      ok: false,
      error: { code: "OutstandingBalance", details: { outstanding: { amount: "15000000", currency: "COP" } } },
    });
    expect(store.left).toEqual([]);
  });

  it("refuses Luis while the guest Pedro owes him 50,000 COP (Review Focus 1)", async () => {
    const { leave } = setup(householdSpace(), { "member-luis": 5_000_000n, "member-pedro": -5_000_000n });
    expect(await leave(as("luis"))).toEqual({
      ok: false,
      error: { code: "OutstandingBalance", details: { outstanding: { amount: "5000000", currency: "COP" } } },
    });
  });

  it("keeps the only OWNER, and lets an owner leave once another OWNER exists", async () => {
    expect(codeOf(await setup().leave(as("ana")))).toBe("LastOwnerRequired");
    const twoOwners = HOUSEHOLD_MEMBERS.map((m): SpaceMember => (m.displayName === "Juan" ? { ...m, role: "OWNER" } : m));
    expect(codeOf(await setup(householdSpace(twoOwners)).leave(as("ana")))).toBe("ok");
  });

  it("lets a viewer leave (Review Focus 1)", async () => {
    const { store, leave } = setup();
    expect(codeOf(await leave(as("sofi")))).toBe("ok");
    expect(store.left.map((l) => l.memberId)).toEqual(["member-sofi"]);
  });

  it("refuses leaving a personal space or a direct space (D16)", async () => {
    const personal = createPersonalSpace({
      id: "space-ana" as SpaceId,
      memberId: "member-ana-personal" as SpaceMemberId,
      ownerUserId: "u-ana",
      ownerName: "Ana",
      now,
    });
    expect(codeOf(await setup(personal).leave({ spaceId: "space-ana", userId: "u-ana" }))).toBe(
      "PersonalSpaceNotShareable",
    );
    const direct: Space = {
      ...householdSpace([memberOf("Ana", "OWNER", 0), memberOf("Juan", "OWNER", 1)]),
      kind: "DIRECT",
      name: "Ana & Juan",
    };
    expect(codeOf(await setup(direct).leave(as("juan")))).toBe("DirectSpaceMembersFixed");
  });

  it("hides the space from non-members", async () => {
    expect(codeOf(await setup().leave(as("marta")))).toBe("SpaceNotFound");
  });
});
```

`src/modules/balances/application/get-member-net-balance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { anExpense, InMemoryTransactions } from "../../../../tests/support/in-memory-ledger";
import { createGetMemberNetBalance } from "./get-member-net-balance";

describe("GetMemberNetBalance (HU-E5-01, for HU-E1-08, HU-E1-09, HU-E1-12)", () => {
  it("returns one member's net in one space, and 0 for a member or a space nothing moved", async () => {
    const ledger = new InMemoryTransactions();
    // Ana pays 300,000 COP in Household, split equally with Juan: 150,000 COP each.
    await ledger.add(
      anExpense("2026-10-05", 30_000_000n, {
        spaceId: "space-household",
        payments: [{ memberId: "member-ana", accountId: null, amount: 30_000_000n }],
        shares: [
          { memberId: "member-ana", amount: 15_000_000n, splitMethod: "EQUAL" },
          { memberId: "member-juan", amount: 15_000_000n, splitMethod: "EQUAL" },
        ],
      }),
    );
    const netBalance = createGetMemberNetBalance(ledger);
    expect(await netBalance("space-household", "member-juan")).toBe(-15_000_000n);
    expect(await netBalance("space-household", "member-ana")).toBe(15_000_000n);
    expect(await netBalance("space-household", "member-luis")).toBe(0n);
    expect(await netBalance("space-trip", "member-juan")).toBe(0n);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/spaces/application/leave-space.test.ts src/modules/balances/application/get-member-net-balance.test.ts`
Expected: FAIL — `Failed to resolve import "./leave-space"` and `Failed to resolve import "./get-member-net-balance"`.

- [ ] **Step 3: Implement**

Append to `src/modules/spaces/application/space-member-repository.ts`:

```ts

/** HU-E1-08, HU-E1-12: members leave or are removed by setting leftAt; their rows stay for history (D15). */
export interface MemberLifecycleRepository {
  /**
   * Sets leftAt on the current member of that kind; false when none matched (left, removed or claimed
   * meanwhile, or a malformed id), so the database decides races.
   */
  markLeft(spaceId: SpaceId, memberId: SpaceMemberId, kind: SpaceMember["kind"], leftAt: Date): Promise<boolean>;
}
```

`src/modules/spaces/application/lifecycle-deps.ts`:

```ts
import type { Clock, TransactionManager } from "@/shared/kernel";
import type { SpaceAccess } from "./space-access";
import type { MemberLifecycleRepository, SpaceMemberRepository } from "./space-member-repository";

/**
 * HU-E5-01 GetMemberNetBalance as spaces sees it: net(m) in minor units, guests included, 0 when nothing
 * moved it. Bound to the balances module by the composition root (balances imports spaces, not the reverse).
 */
export type MemberNetBalance = (spaceId: string, memberId: string) => Promise<bigint>;

/** Leaving, removing guests and archiving (HU-E1-08, HU-E1-09, HU-E1-12) need members, balances and time. */
export interface LifecycleDeps {
  readonly access: SpaceAccess;
  readonly members: Pick<SpaceMemberRepository, "listCurrent"> & MemberLifecycleRepository;
  readonly netBalance: MemberNetBalance;
  readonly clock: Clock;
  readonly tm: TransactionManager;
}
```

`src/modules/spaces/application/leave-space.ts`:

```ts
import { ok, type Result } from "@/shared/kernel";
import { ensureSettled, leavingMember, outstandingIn } from "../domain/member";
import { ensureMembersCanChange } from "../domain/space";
import type { LifecycleDeps } from "./lifecycle-deps";
import { authorizeSpaceAction } from "./space-access";

export type LeaveSpace = (input: { spaceId: string; userId: string }) => Promise<Result<void>>;

/**
 * HU-E1-08: a current member leaves a shared space once their balance is zero (a debt with a guest counts
 * too); the last OWNER stays. leftAt is set and the row stays, so history keeps the member (D15).
 */
export const createLeaveSpace =
  (deps: LifecycleDeps): LeaveSpace =>
  (input) =>
    deps.tm.run(async () => {
      const member = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.leave");
      if (!member.ok) return member;
      const { spaceId, memberId, spaceKind, currency } = member.value;
      const changeable = ensureMembersCanChange({ kind: spaceKind });
      if (!changeable.ok) return changeable;
      // Locked like role changes, so two owners leaving at once never leave the space without an OWNER.
      const leaver = leavingMember(await deps.members.listCurrent(spaceId, { lock: true }), memberId);
      if (!leaver.ok) return leaver;
      const settled = ensureSettled(outstandingIn([await deps.netBalance(spaceId, memberId)]), currency);
      if (!settled.ok) return settled;
      // On the locked rows the leaver is a current registered member, so this always matches.
      await deps.members.markLeft(spaceId, leaver.value.id, "USER", deps.clock.now());
      return ok(undefined);
    });
```

`src/modules/balances/application/get-member-net-balance.ts`:

```ts
import { netOf } from "../domain/balances";
import type { BalanceSource } from "./get-space-balances";

/**
 * HU-E5-01 public query GetMemberNetBalance, consumed by spaces for HU-E1-08, HU-E1-09 and HU-E1-12:
 * net(m) of one member of one space, guests included, 0 when nothing moved it. It does not authorize;
 * its callers authorize before asking.
 */
export type GetMemberNetBalance = (spaceId: string, memberId: string) => Promise<bigint>;

export const createGetMemberNetBalance =
  (source: BalanceSource): GetMemberNetBalance =>
  async (spaceId, memberId) => {
    const totals = (await source.memberTotals(spaceId)).find((t) => t.memberId === memberId);
    return totals === undefined ? 0n : netOf(totals);
  };
```

Append to `src/modules/spaces/application/index.ts`:

```ts
export type { MemberLifecycleRepository } from "./space-member-repository";
export type { LifecycleDeps, MemberNetBalance } from "./lifecycle-deps";
export { createLeaveSpace, type LeaveSpace } from "./leave-space";
```

Append to `src/modules/balances/application/index.ts`:

```ts
export { createGetMemberNetBalance, type GetMemberNetBalance } from "./get-member-net-balance";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/spaces src/modules/balances`
Expected: PASS. Mutation check: temporarily replace `{ lock: true }` with `{}` in `leave-space.ts` — "lets Luis … leave" fails on `store.locked` (`[]`); restore it (Task 3 pins the same lock against PostgreSQL).

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (`no-circular` holds: spaces imports nothing from balances).

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/application/space-member-repository.ts src/modules/spaces/application/lifecycle-deps.ts src/modules/spaces/application/leave-space.ts src/modules/spaces/application/leave-space.test.ts src/modules/spaces/application/index.ts src/modules/balances/application/get-member-net-balance.ts src/modules/balances/application/get-member-net-balance.test.ts src/modules/balances/application/index.ts tests/support/in-memory-spaces.ts
git commit -m "feat(spaces): let a settled member leave a shared space (Refs #17)"
```

---

### Task 3: Spaces — marking members as left in PostgreSQL

Implements `MemberLifecycleRepository.markLeft` for HU-E1-08 (issue #17) and HU-E1-12 (issue #21), and pins `LeaveSpace`'s row lock against PostgreSQL with two owners leaving at once (Review Focus 5).

Decisions:
- `markLeft` is one conditional `UPDATE … WHERE space_id AND id AND kind AND left_at IS NULL RETURNING id`, so a member who left, was removed or was claimed meanwhile matches nothing (`false`); the guest removal of Task 8 relies on it.
- `space_members_current_user_uq` and `space_members_current_name_uq` (migration 0006) are partial on `left_at IS NULL`, so a member who left frees their name and may rejoin with a new row; M2-A pinned that with raw SQL, this task pins it through `markLeft`.
- The concurrency test holds the first leaver inside the balance port (a rendezvous) until the second leaver also reaches it or 2 s pass (a margin that an idle test database never needs, so the test catches a missing lock on every ordinary run; it costs those 2 s only while the lock is present). With the lock, the second leaver waits on the locked rows, re-reads them after the first commits (Ana's row no longer matches `left_at IS NULL`) and is the last OWNER. Without the lock, both reach the rendezvous together and both leave.
- The in-memory twin of Task 2 runs the same sequence as PostgreSQL in one test, so the use-case tests rely on the adapter's real outcomes.

**Files:**
- Modify: `src/modules/spaces/infrastructure/drizzle-space-repository.ts`
- Test: `src/modules/spaces/infrastructure/drizzle-space-members.int.test.ts`

**Interfaces:**
- Consumes: `MemberLifecycleRepository` (Task 2), `createLeaveSpace` (Task 2); `createSpaceAccess` (M2-A); `InMemorySpaceStore` (Task 2 twin); `sharedSpaceFixture`, `userFixture` (`tests/support/fixtures.ts`); `FixedClock`, `isUuid` (kernel).
- Produces: `DrizzleSpaceRepository.markLeft(spaceId: SpaceId, memberId: SpaceMemberId, kind: SpaceMember["kind"], leftAt: Date): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

In `src/modules/spaces/infrastructure/drizzle-space-members.int.test.ts`:

1. Replace the line `import { ok } from "@/shared/kernel";` with:

```ts
import { FixedClock, ok } from "@/shared/kernel";
```

2. Add after the line `import { sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";`:

```ts
import { InMemorySpaceStore } from "../../../../tests/support/in-memory-spaces";
```

3. Add after the line `import { createChangeMemberRole } from "../application/change-member-role";`:

```ts
import { createLeaveSpace } from "../application/leave-space";
```

4. Add after the line `import { createSpaceAccess } from "../application/space-access";`:

```ts
import type { MemberLifecycleRepository } from "../application/space-member-repository";
```

5. Append to the end of the file:

```ts

describe("leaving and removal (HU-E1-08, HU-E1-12)", () => {
  const lifecycle: MemberLifecycleRepository = repo;
  const at = new Date("2026-10-14T12:00:00Z");

  it("sets leftAt on a current member of the given kind only, and keeps the row", async () => {
    const juan = await newUser("Juan");
    const space = await household(await newUser("Ana"));
    const pedro = guest("Pedro");
    const juanMember = registered(juan, "Juan");
    await repo.addMember(space.id, pedro);
    await repo.addMember(space.id, juanMember);
    expect(await lifecycle.markLeft(space.id, pedro.id, "USER", at)).toBe(false);
    expect(await lifecycle.markLeft(space.id, juanMember.id, "GUEST", at)).toBe(false);
    expect(await lifecycle.markLeft(space.id, pedro.id, "GUEST", at)).toBe(true);
    expect(await lifecycle.markLeft(space.id, juanMember.id, "USER", at)).toBe(true);
    expect(await lifecycle.markLeft(space.id, juanMember.id, "USER", at)).toBe(false);
    expect(await repo.listCurrent(space.id)).toEqual(space.members);
    const { rows } = await pool.query(
      "SELECT id, left_at FROM space_members WHERE id = ANY($1) ORDER BY display_name",
      [[pedro.id, juanMember.id]],
    );
    expect(rows).toEqual([
      { id: juanMember.id, left_at: at },
      { id: pedro.id, left_at: at },
    ]);
  });

  it("finds no membership and lists no space for a member who left", async () => {
    const juan = await newUser("Juan");
    const space = await household(await newUser("Ana"));
    const member = registered(juan, "Juan");
    await repo.addMember(space.id, member);
    await lifecycle.markLeft(space.id, member.id, "USER", at);
    expect(await repo.findMembership(space.id, juan)).toBeNull();
    expect(await repo.listForUser(juan)).toEqual([]);
  });

  it("answers false for malformed ids and for members of another space", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana);
    const other = await household(ana);
    expect(await lifecycle.markLeft(space.id, "not-a-uuid" as SpaceMemberId, "USER", at)).toBe(false);
    expect(await lifecycle.markLeft(other.id, space.members[0]!.id, "USER", at)).toBe(false);
    expect(await repo.listCurrent(space.id)).toEqual(space.members);
  });

  it("gives the outcomes of the in-memory twin the use-case tests rely on", async () => {
    const space = await household(await newUser("Ana"));
    const pedro = guest("Pedro");
    await repo.addMember(space.id, pedro);
    const twin = new InMemorySpaceStore();
    twin.seed({ ...space, members: [...space.members, pedro] });
    const steps = async (store: MemberLifecycleRepository) => [
      await store.markLeft(space.id, pedro.id, "USER", at),
      await store.markLeft(space.id, pedro.id, "GUEST", at),
      await store.markLeft(space.id, pedro.id, "GUEST", at),
      await store.markLeft(space.id, space.members[0]!.id, "USER", at),
    ];
    const outcomes = await steps(lifecycle);
    expect(outcomes).toEqual([false, true, false, true]);
    expect(await steps(twin)).toEqual(outcomes);
  });
});

/**
 * A balance port that answers 0 once `parties` callers arrived or `ms` passed. Without the row lock both
 * leavers reach it together and both leave; with it, the second waits on the locked rows and never arrives.
 */
const rendezvous = (parties: number, ms: number) => {
  let arrived = 0;
  let release: () => void = () => undefined;
  const everyone = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async (): Promise<bigint> => {
    arrived += 1;
    if (arrived >= parties) release();
    await Promise.race([everyone, new Promise((resolve) => setTimeout(resolve, ms))]);
    return 0n;
  };
};

describe("concurrent leaving (Review Focus 5)", () => {
  it("keeps exactly one OWNER when two owners leave at the same time", async () => {
    const ana = await newUser("Ana");
    const juan = await newUser("Juan");
    const space = await household(ana);
    await repo.addMember(space.id, registered(juan, "Juan", "OWNER"));
    const leave = createLeaveSpace({
      access: createSpaceAccess(repo),
      members: repo,
      netBalance: rendezvous(2, 2_000),
      clock: new FixedClock(new Date("2026-10-14T12:00:00Z")),
      tm,
    });
    const results = await Promise.all([
      leave({ spaceId: space.id, userId: ana }),
      leave({ spaceId: space.id, userId: juan }),
    ]);
    // The second leaver reads the locked rows only after the first left, so it is the last OWNER.
    expect(results.map((r) => (r.ok ? "ok" : r.error.code)).sort()).toEqual(["LastOwnerRequired", "ok"]);
    const owners =
      "SELECT count(*)::int AS n FROM space_members WHERE space_id = $1 AND role = 'OWNER' AND left_at IS NULL";
    expect(await count(owners, [space.id])).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project integration src/modules/spaces/infrastructure/drizzle-space-members.int.test.ts`
Expected: FAIL — `lifecycle.markLeft is not a function` in the new `describe` blocks (and `members.markLeft is not a function` in the concurrency test); M2-A's tests in the file still pass.

- [ ] **Step 3: Implement**

In `src/modules/spaces/infrastructure/drizzle-space-repository.ts`, insert before the last line of the file (`}`):

```ts

  async markLeft(
    spaceId: SpaceId,
    memberId: SpaceMemberId,
    kind: SpaceMember["kind"],
    leftAt: Date,
  ): Promise<boolean> {
    // Ids come from URLs; anything that is not a UUID would fail the uuid cast.
    if (!isUuid(memberId)) return false;
    const left = await this.tm
      .executor()
      .update(spaceMembers)
      .set({ leftAt })
      .where(
        and(
          eq(spaceMembers.spaceId, spaceId),
          eq(spaceMembers.id, memberId),
          eq(spaceMembers.kind, kind),
          isNull(spaceMembers.leftAt),
        ),
      )
      .returning({ id: spaceMembers.id });
    return left.length > 0;
  }
```

- [ ] **Step 4: Run the tests to verify they pass, and check the lock**

Run: `pnpm exec vitest run --project integration src/modules/spaces/infrastructure`
Expected: PASS.

Mutation check (required, the lesson of M2-A/M2-B): temporarily replace `{ lock: true }` with `{}` in `src/modules/spaces/application/leave-space.ts` and run the file again — "keeps exactly one OWNER …" fails with `["ok", "ok"]` and `0` owners; restore the lock and run once more (PASS). Also remove `isNull(spaceMembers.leftAt),` from `markLeft` temporarily: "sets leftAt on a current member … only" fails on the repeated call (`true`); restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (`tsc` checks `DrizzleSpaceRepository` against `MemberLifecycleRepository` through the typed `lifecycle` constant and the `members: repo` binding).

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/infrastructure/drizzle-space-repository.ts src/modules/spaces/infrastructure/drizzle-space-members.int.test.ts
git commit -m "feat(spaces): mark members as left in PostgreSQL and serialize owners leaving (Refs #17, Refs #21)"
```

---

### Task 4: HTTP — leave a space, with the outstanding amount in the problem body

Exposes HU-E1-08 (issue #17): `POST /api/v1/spaces/{spaceId}/leave` → `204`. HU-E1-08 asks that "the error body includes the outstanding amount", so problem+json gains one RFC 9457 extension member, `outstanding` (Money), for `OutstandingBalance` only. Pins Review Focus 1 over HTTP (former members, guest debts, the D9 account rule after leaving). Size ~410 lines: commit it as **4.1** (Steps 1–4: public details in the problem body, with the `Problem` snapshot change) and **4.2** (Steps 5–10: the leave endpoint), each green and with its own RDD pass. The halves are numbered 4.1 and 4.2 so that they never read as Task 4b.

Decisions:
- `problem.ts` keeps a map of public details per code (`OutstandingBalance` → `["outstanding"]`). `define-route.ts` passes `publicDetailsOf(code, details)`; every other detail of every other code stays private, as before (the existing "no secret in the body" test keeps passing for `OutstandingBalance` with `{ secret: "x" }`, because only `outstanding` is picked). Extension members are spread before the standard members, so they can never replace `code`, `status` or `type`.
- `ProblemSchema` gains `outstanding: MoneySchema.optional()`; the OpenAPI `Problem` component changes with it.
- The route answers `204` with no body. A former member's space disappears from `GET /spaces` and from `GET …/members` (both list current members, M2-A); their movements and their balance stay (M2-B).
- The acceptance helpers `paysEqually` and `settles` move the common "X pays and splits equally" and "X settles with Y" steps into `tests/support/ledger.ts`; Tasks 4b, 11 and 18 reuse them.

**Files:**
- 4.1 — Modify: `src/shared/http/problem.ts`, `src/shared/http/problem.test.ts`, `src/shared/http/define-route.ts`, `src/shared/http/define-route.test.ts`, `src/shared/http/contracts.ts`, `openapi/openapi.snapshot.json`
- 4.2 — Create: `src/app/api/v1/spaces/[spaceId]/leave/route.ts`; Modify: `src/modules/spaces/contracts/spaces.contract.ts`, `src/composition/container.ts`, `tests/support/ledger.ts`, `openapi/openapi.snapshot.json`; Test: `tests/acceptance/leave-space.test.ts`

**Interfaces:**
- Consumes: `createLeaveSpace`, `LeaveSpace`, `LifecycleDeps` (Task 2); `createGetMemberNetBalance` (Task 2); `DrizzleSpaceRepository.markLeft` (Task 3); `household`, `joinHousehold`, `addGuest`, `memberIdOf`, `post`, `cop`, `balancesOf`, `TransactionDto`, `HouseholdMember` (`tests/support/ledger.ts`); `joinAs` (`tests/support/spaces.ts`); `call`, `problemOf`, `registerUser`, `startTestApp` (`tests/support/app.ts`).
- Produces:
  - `publicDetailsOf(code: string, details?: Readonly<Record<string, unknown>>): Record<string, unknown>`; `problemResponse(code, requestId, errors?, extensions?: Readonly<Record<string, unknown>>)`.
  - `ProblemSchema.outstanding`; `POST /api/v1/spaces/{spaceId}/leave`; `Container.spaces.leaveSpace`; the composition-root constant `lifecycleDeps: LifecycleDeps` (reused by Tasks 11 and 18).
  - `tests/support/ledger.ts`: `paysEqually(payer: HouseholdMember, pesos: number, participants: readonly string[], categoryId: string, description?: string): Promise<TransactionDto>` (dated 2026-10-05); `settles(recorder: TestUser, payerMemberId: string, receivingMemberId: string, pesos: number): Promise<TransactionDto>` (dated 2026-10-30, no accounts).

#### 4.1 — public details in the problem body

- [ ] **Step 1: Write the failing tests for public details**

In `src/shared/http/problem.test.ts`:

1. Replace the line `import { problemResponse, statusForCode } from "./problem";` with:

```ts
import { problemResponse, publicDetailsOf, statusForCode } from "./problem";
```

2. Append to the end of the file:

```ts

describe("public details (HU-E1-08)", () => {
  it("adds the outstanding amount of OutstandingBalance as an extension member, and no other detail", async () => {
    const details = publicDetailsOf("OutstandingBalance", {
      outstanding: { amount: "15000000", currency: "COP" },
      memberId: "m-1",
    });
    expect(details).toEqual({ outstanding: { amount: "15000000", currency: "COP" } });
    expect(await problemResponse("OutstandingBalance", "req-3", undefined, details).json()).toEqual({
      type: "urn:hearth:problem:OutstandingBalance",
      title: "Conflict",
      status: 409,
      code: "OutstandingBalance",
      requestId: "req-3",
      outstanding: { amount: "15000000", currency: "COP" },
    });
  });

  it("keeps the details of every other code private", () => {
    expect(publicDetailsOf("InvalidSplit", { reason: "duplicatePayer" })).toEqual({});
    expect(publicDetailsOf("OutstandingBalance")).toEqual({});
  });

  it("never lets an extension member replace a standard one", async () => {
    const response = problemResponse("SpaceNotFound", "req-4", undefined, { code: "Other", status: 200 });
    expect(await response.json()).toMatchObject({ code: "SpaceNotFound", status: 404 });
  });
});
```

In `src/shared/http/define-route.test.ts`, insert before the line `  it("rejects unauthenticated requests with 401 Unauthenticated before running the handler", async () => {`:

```ts
  it("shows the outstanding amount of OutstandingBalance, and only that detail (HU-E1-08)", async () => {
    const route = defineRoute({
      auth: "none",
      handler: async () =>
        err(
          domainError("OutstandingBalance", {
            outstanding: { amount: "15000000", currency: "COP" },
            memberId: "m-1",
          }),
        ),
    });
    const body = await (await call(route)).json();
    expect(body).toMatchObject({
      status: 409,
      code: "OutstandingBalance",
      outstanding: { amount: "15000000", currency: "COP" },
    });
    expect(body).not.toHaveProperty("memberId");
  });

```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/shared/http`
Expected: FAIL — `publicDetailsOf is not a function`, and the route test's body has no `outstanding` member.

- [ ] **Step 3: Implement public details**

In `src/shared/http/problem.ts`:

1. Insert before the line `/** Spec section 8: explicit codes first, then naming conventions, then 409 for invariant violations. */`:

```ts
// RFC 9457 extension members: the only details a client ever sees, per code; all others stay in the log.
const PUBLIC_DETAILS: ReadonlyMap<string, readonly string[]> = new Map([["OutstandingBalance", ["outstanding"]]]);

/** The details of `code` that are part of the API contract, e.g. the outstanding amount (HU-E1-08). */
export const publicDetailsOf = (
  code: string,
  details: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> =>
  Object.fromEntries((PUBLIC_DETAILS.get(code) ?? []).filter((key) => key in details).map((key) => [key, details[key]]));

```

2. Replace the lines from `/** RFC 9457 problem details. Carries only the stable code; clients translate it. */` to `    ...(errors ? { errors } : {}),` with:

```ts
/**
 * RFC 9457 problem details. Carries the stable code, which clients translate, and the extension members
 * the code makes public (publicDetailsOf); the standard members always win over an extension.
 */
export const problemResponse = (
  code: string,
  requestId: string,
  errors?: ProblemFieldError[],
  extensions: Readonly<Record<string, unknown>> = {},
): Response => {
  const status = statusForCode(code);
  const body = {
    ...extensions,
    type: `urn:hearth:problem:${code}`,
    title: TITLES.get(status) ?? "Error",
    status,
    code,
    requestId,
    ...(errors ? { errors } : {}),
```

In `src/shared/http/define-route.ts`:

1. Replace the line `import { problemResponse, statusForCode, type ProblemFieldError } from "./problem";` with:

```ts
import { problemResponse, publicDetailsOf, statusForCode, type ProblemFieldError } from "./problem";
```

2. Replace the line `        return problemResponse(result.error.code, requestId);` with:

```ts
        const { code, details } = result.error;
        return problemResponse(code, requestId, undefined, publicDetailsOf(code, details));
```

In `src/shared/http/contracts.ts`, add after the line `  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),`:

```ts
  /** OutstandingBalance only (HU-E1-08, HU-E1-09, HU-E1-12): what is still owed, a positive amount. */
  outstanding: MoneySchema.optional(),
```

Run: `pnpm exec vitest run --project unit src/shared/http`
Expected: PASS, including the M0 tests (`OutstandingBalance` with `{ secret: "x" }` still shows no secret). Mutation check: temporarily replace `publicDetailsOf(code, details)` with `{}` in `define-route.ts` — the route test of Step 1 fails on the missing `outstanding`; restore it.

- [ ] **Step 4: Refresh the snapshot, gates and commit 4.1**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: only the `Problem` component gains the optional `outstanding` member (a reference to `MoneyOutput`, as `Account` has); no operation changes and no `…Output` component appears.

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

```bash
git add src/shared/http/problem.ts src/shared/http/problem.test.ts src/shared/http/define-route.ts src/shared/http/define-route.test.ts src/shared/http/contracts.ts openapi/openapi.snapshot.json
git commit -m "feat(http): show the outstanding amount of OutstandingBalance in the problem body (Refs #17)"
```

#### 4.2 — the leave endpoint

- [ ] **Step 5: Write the failing acceptance test**

In `tests/support/ledger.ts`:

1. Add after the line `import { GET as getBalances } from "@/app/api/v1/spaces/[spaceId]/balances/route";`:

```ts
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
```

2. Append to the end of the file:

```ts

/** `payer` pays `pesos` on 2026-10-05 from their own account, split equally among `participants`. */
export const paysEqually = async (
  payer: HouseholdMember,
  pesos: number,
  participants: readonly string[],
  categoryId: string,
  description = "Groceries",
): Promise<TransactionDto> => {
  const response = await post(recordExpense, payer, "expenses", {
    description,
    date: "2026-10-05",
    categoryId,
    amount: cop(pesos),
    payments: [{ memberId: payer.memberId, accountId: payer.account, amount: cop(pesos) }],
    split: { method: "EQUAL", participants: participants.map((memberId) => ({ memberId })) },
  });
  if (response.status !== 201) throw new Error(`expense failed with status ${response.status}`);
  return (await response.json()) as TransactionDto;
};

/** `recorder` records on 2026-10-30 that `payerMemberId` paid `receivingMemberId` `pesos`, outside the app. */
export const settles = async (
  recorder: TestUser,
  payerMemberId: string,
  receivingMemberId: string,
  pesos: number,
): Promise<TransactionDto> => {
  const response = await post(recordSettlement, recorder, "settlements", {
    date: "2026-10-30",
    amount: cop(pesos),
    payerMemberId,
    receivingMemberId,
  });
  if (response.status !== 201) throw new Error(`settlement failed with status ${response.status}`);
  return (await response.json()) as TransactionDto;
};
```

`tests/acceptance/leave-space.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { PATCH as editTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import { GET as listSpaces } from "@/app/api/v1/spaces/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  addGuest,
  balancesOf,
  cop,
  household,
  joinHousehold,
  memberIdOf,
  paysEqually,
  post,
  settles,
  type TransactionDto,
} from "../support/ledger";
import { joinAs } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const leave = (user: TestUser, spaceId: string) =>
  call(leaveSpace, "POST", `/api/v1/spaces/${spaceId}/leave`, { user, params: { spaceId } });
const leftAtOf = async (memberId: string): Promise<Date | null> =>
  (await app.pool.query("SELECT left_at FROM space_members WHERE id = $1", [memberId])).rows[0].left_at;
const transactionsOf = async (user: TestUser, spaceId: string): Promise<TransactionDto[]> => {
  const path = `/api/v1/spaces/${spaceId}/transactions?period=2026-10`;
  const response = await call(listTransactions, "GET", path, { user, params: { spaceId } });
  return ((await response.json()) as { items: TransactionDto[] }).items;
};
const memberIdsOf = async (user: TestUser, spaceId: string): Promise<string[]> => {
  const response = await call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, {
    user,
    params: { spaceId },
  });
  return ((await response.json()) as { items: { id: string }[] }).items.map((m) => m.id);
};

describe("leave a space (HU-E1-08)", () => {
  it("lets Luis leave with a zero balance: leftAt is set and his past expense still names him", async () => {
    const h = await household();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    const groceries = await paysEqually(luis, 100_000, [h.ana.memberId, luis.memberId], h.groceries);
    await settles(h.ana, h.ana.memberId, luis.memberId, 50_000);
    expect((await leave(luis, h.spaceId)).status).toBe(204);
    expect(await leftAtOf(luis.memberId)).toBeInstanceOf(Date);
    expect((await transactionsOf(h.ana, h.spaceId)).find((t) => t.id === groceries.id)).toMatchObject({
      payments: [{ memberId: luis.memberId, accountId: luis.account, amount: cop(100_000) }],
      shares: [
        { memberId: h.ana.memberId, amount: cop(50_000) },
        { memberId: luis.memberId, amount: cop(50_000) },
      ],
    });
    // Former members stay in the balances while the totals mention them (M2-B), here settled at 0.
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
      [luis.memberId, cop(0)],
    ]);
  });

  it("drops the space from Luis's lists and lets him join again later as a new member", async () => {
    const h = await household();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    expect((await leave(luis, h.spaceId)).status).toBe(204);
    const listed = await call(listSpaces, "GET", "/api/v1/spaces", { user: luis.personal });
    const { items } = (await listed.json()) as { items: { id: string }[] };
    expect(items.map((s) => s.id)).not.toContain(h.spaceId);
    expect(await memberIdsOf(h.ana, h.spaceId)).not.toContain(luis.memberId);
    await joinAs(h.ana, h.spaceId, luis.personal, "MEMBER");
    expect(await memberIdOf(h.ana, h.spaceId, "Luis")).not.toBe(luis.memberId);
  });

  it("refuses Juan, who owes Ana 150,000 COP, and states the outstanding amount", async () => {
    const h = await household();
    await paysEqually(h.ana, 300_000, [h.ana.memberId, h.juan.memberId], h.groceries);
    const response = await leave(h.juan, h.spaceId);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "OutstandingBalance", outstanding: cop(150_000) });
    expect(await leftAtOf(h.juan.memberId)).toBeNull();
  });

  it("refuses Luis while the guest Pedro owes him 50,000 COP (Review Focus 1)", async () => {
    const h = await household();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    const pedro = await addGuest(h, "Pedro");
    await paysEqually(luis, 100_000, [luis.memberId, pedro], h.groceries);
    const response = await leave(luis, h.spaceId);
    expect(await response.json()).toMatchObject({
      status: 409,
      code: "OutstandingBalance",
      outstanding: cop(50_000),
    });
  });

  it("keeps the only OWNER and refuses leaving a personal space", async () => {
    const h = await household();
    expect(await problemOf(await leave(h.ana, h.spaceId))).toEqual([409, "LastOwnerRequired"]);
    expect(await problemOf(await leave(h.ana.personal, h.ana.personal.spaceId))).toEqual([
      409,
      "PersonalSpaceNotShareable",
    ]);
  });

  it("lets a viewer leave and never takes the former member as participant or settlement party again", async () => {
    const h = await household();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    expect((await leave(sofi, h.spaceId)).status).toBe(204);
    const response = await post(recordExpense, h.ana, "expenses", {
      description: "Groceries",
      date: "2026-10-05",
      categoryId: h.groceries,
      amount: cop(90_000),
      payments: [{ memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(90_000) }],
      split: { method: "EQUAL", participants: [{ memberId: h.ana.memberId }, { memberId: sofi.memberId }] },
    });
    expect(await problemOf(response)).toEqual([422, "NotASpaceMember"]);
    const settlement = await post(recordSettlement, h.ana, "settlements", {
      date: "2026-10-30",
      amount: cop(10_000),
      payerMemberId: sofi.memberId,
      receivingMemberId: h.ana.memberId,
    });
    expect(await problemOf(settlement)).toEqual([422, "NotASpaceMember"]);
  });

  it("still refuses the OWNER changing what Juan settled from his own account after he left (D9)", async () => {
    const h = await household();
    await paysEqually(h.ana, 100_000, [h.ana.memberId, h.juan.memberId], h.groceries);
    const settlement = await post(recordSettlement, h.juan, "settlements", {
      date: "2026-10-30",
      amount: cop(50_000),
      payerMemberId: h.juan.memberId,
      receivingMemberId: h.ana.memberId,
      sourceAccountId: h.juan.account,
    });
    expect(settlement.status).toBe(201);
    const { id } = (await settlement.json()) as TransactionDto;
    expect((await leave(h.juan, h.spaceId)).status).toBe(204);
    const raised = await call(editTransaction, "PATCH", `/api/v1/spaces/${h.spaceId}/transactions/${id}`, {
      user: h.ana,
      params: { spaceId: h.spaceId, transactionId: id },
      body: { amount: cop(60_000) },
    });
    expect(await problemOf(raised)).toEqual([422, "AccountNotOwned"]);
  });

  it("answers 404 SpaceNotFound to non-members and malformed ids", async () => {
    const h = await household();
    const marta = await registerUser("Marta");
    for (const spaceId of [h.spaceId, "not-a-uuid"]) {
      expect(await problemOf(await leave(marta, spaceId))).toEqual([404, "SpaceNotFound"]);
    }
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/leave-space.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/leave/route"`.

- [ ] **Step 7: Contract, route and wiring**

In `src/modules/spaces/contracts/spaces.contract.ts`, insert before the last line of the file (`};`):

```ts
  "/api/v1/spaces/{spaceId}/leave": {
    post: {
      operationId: "leaveSpace",
      summary: "Leave a shared space once your balance is zero; your past movements keep your name",
      ...securedByUser,
      requestParams: { path: SpacePath },
      responses: {
        "204": { description: "Left: the space no longer lists you as a current member" },
        ...problems({
          "401": "Unauthenticated",
          "404": "SpaceNotFound",
          "409":
            "OutstandingBalance (with the outstanding amount), LastOwnerRequired, PersonalSpaceNotShareable, DirectSpaceMembersFixed",
        }),
      },
    },
  },
```

`src/app/api/v1/spaces/[spaceId]/leave/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.leaveSpace({ spaceId: params.spaceId!, userId: user!.id });
    return result.ok ? ok({ status: 204 }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Replace the line `import { createGetSpaceBalances, type GetSpaceBalances } from "@/modules/balances/application";` with:

```ts
import {
  createGetMemberNetBalance,
  createGetSpaceBalances,
  type GetSpaceBalances,
} from "@/modules/balances/application";
```

2. Add after the line `  createUpdateSpaceSettings,` (in the `@/modules/spaces/application` import):

```ts
  createLeaveSpace,
```

3. Add after the line `  type UpdateSpaceSettings,`:

```ts
  type LeaveSpace,
  type LifecycleDeps,
```

4. Add after the line `    readonly changeMemberRole: ChangeMemberRole;`:

```ts
    readonly leaveSpace: LeaveSpace;
```

5. Add after the line `  const membersDeps: MembersDeps = { access, members: spaceRepository, ids, clock, tm };`:

```ts
  // HU-E5-01 GetMemberNetBalance: spaces reads balances through a port, since balances imports spaces.
  const lifecycleDeps: LifecycleDeps = {
    access,
    members: spaceRepository,
    netBalance: createGetMemberNetBalance(ledgerQueries),
    clock,
    tm,
  };
```

6. Add after the line `      changeMemberRole: createChangeMemberRole(membersDeps),`:

```ts
      leaveSpace: createLeaveSpace(lifecycleDeps),
```

- [ ] **Step 8: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/leave-space.test.ts`
Expected: PASS.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `POST /api/v1/spaces/{spaceId}/leave` (about 75 lines); components are unchanged (the `Problem` change was committed in 4.1).

- [ ] **Step 9: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0. Mutation check: temporarily replace `publicDetailsOf(code, details)` with `{}` in `define-route.ts` — the two `OutstandingBalance` acceptance tests fail on the missing `outstanding`; restore it.

- [ ] **Step 10: Commit 4.2**

```bash
git add src/modules/spaces/contracts/spaces.contract.ts "src/app/api/v1/spaces/[spaceId]/leave/route.ts" src/composition/container.ts tests/support/ledger.ts tests/acceptance/leave-space.test.ts openapi/openapi.snapshot.json
git commit -m "feat(spaces): expose leaving a space over HTTP (Refs #17)"
```

---

### Task 4b: Ledger — edits and deletes never move a former member's balance

Implements the rule HU-E1-08 (issue #17) and HU-E1-12 (issue #21) imply once members can leave: a member who left, or a guest who was removed, settled first, and nobody can settle with them afterwards (`RecordSettlement` refuses non-current parties, `422 NotASpaceMember`, M2-B). So no later change may move their balance: an amount edit or a deletion of a transaction that moves balances and names a former member answers `422 NotASpaceMember` (controller ruling O1, option A). Without this, deleting the settlement of Task 4's first test would leave Luis's old member row owed 50,000 COP forever, and Household could never be archived (Task 17 sums current members only). Pins Review Focus 1 on the edit and delete paths.

Decisions:
- `balanceParties(tx)` (pure, ledger domain) names the members whose net a transaction moves (E5 balance rule): the payers and participants of a member-paid expense, both parties of a settlement, and nobody for fund-paid expenses, transfers (fund contributions included) and incomes (D5).
- `ensureCurrentParties` (ledger `checks.ts`) refuses with `NotASpaceMember` when any of them is not a current member, the same code as naming a former member on a new movement (spec 8). `EditTransaction` runs it only when the amount changes; descriptions, dates and categories stay editable, since they move no balance. `DeleteTransaction` always runs it.
- `EditTransaction` checks it after `ownedDebits`, so the OWNER changing what a former member debited from their own account still answers `422 AccountNotOwned` (Task 4.2's D9 test, unchanged).
- Cost of the ruling: a transaction involving a departed member can no longer be corrected; rejoining does not restore it (a former member who rejoins gets a new member row, HU-E1-07), so it stays as recorded.

**Files:**
- Modify: `src/modules/ledger/domain/transaction.ts`, `src/modules/ledger/application/checks.ts`, `src/modules/ledger/application/edit-transaction.ts`, `src/modules/ledger/application/delete-transaction.ts`, `src/modules/ledger/contracts/ledger.contract.ts`, `openapi/openapi.snapshot.json`
- Test: `src/modules/ledger/domain/transaction.test.ts`, `src/modules/ledger/application/edit-and-delete.test.ts`, `tests/acceptance/leave-space.test.ts`

**Interfaces:**
- Consumes: `LedgerDeps.members.listCurrent` (M2-B); `SpaceMembership` (M2-A); `aSettlement`, `anExpense`, `CATEGORIES`, `ledgerFixture` (`tests/support/in-memory-ledger.ts`); `memberOf` (`tests/support/in-memory-spaces.ts`); `household`, `joinHousehold`, `paysEqually`, `settles`, `balancesOf`, `cop` (`tests/support/ledger.ts`, Task 4.2); the leave route (Task 4.2).
- Produces:
  - `balanceParties(tx: Transaction): string[]`
  - `ensureCurrentParties(deps: Pick<LedgerDeps, "members">, spaceId: SpaceMembership["spaceId"], tx: Transaction): Promise<Result<void>>` — `NotASpaceMember`
  - `EditTransaction` (amount changes) and `DeleteTransaction` also answer `422 NotASpaceMember`.

- [ ] **Step 1: Write the failing tests**

In `src/modules/ledger/domain/transaction.test.ts`:

1. Insert before the line `  canModify,` (in the import from `./transaction`):

```ts
  balanceParties,
```

2. Append to the end of the file:

```ts

describe("balance parties (E5 balance rule, Task 4b)", () => {
  it("names the payers and participants of a member-paid expense once each, and both sides of a settlement", () => {
    expect(balanceParties(shared())).toEqual(["member-ana", "member-juan"]);
    const settlement = unwrap(
      recordSettlement({
        ...common,
        amount: 100n,
        payerMemberId: "member-juan",
        receivingMemberId: "member-ana",
        sourceAccountId: null,
        destinationAccountId: null,
      }),
    );
    expect(balanceParties(settlement)).toEqual(["member-juan", "member-ana"]);
  });

  it("names nobody for a fund-paid expense or a fund contribution (D5)", () => {
    const fundPaid = unwrap(
      recordExpense({
        ...common,
        amount: 100n,
        categoryId: "cat-rent",
        payments: [{ memberId: null, accountId: "acc-fund", amount: 100n }],
        shares: [{ memberId: "member-ana", amount: 100n, splitMethod: "EQUAL" }],
      }),
    );
    const contribution = unwrap(
      recordFundContribution({
        ...common,
        amount: 100n,
        payerMemberId: "member-juan",
        sourceAccountId: "acc-davivienda",
        destinationAccountId: "acc-fund",
      }),
    );
    expect([balanceParties(fundPaid), balanceParties(contribution)]).toEqual([[], []]);
  });
});
```

In `src/modules/ledger/application/edit-and-delete.test.ts`:

1. Add after the line `} from "../../../../tests/support/in-memory-ledger";`:

```ts
import { memberOf } from "../../../../tests/support/in-memory-spaces";
```

2. Add after the line `const asAna = { spaceId: "space-ana", userId: "u-ana" };`:

```ts
/** Household's current members as the ledger reads them: Ana and Juan; Luis is not one of them (Task 4b). */
const currentHousehold = {
  listCurrent: async () => [memberOf("Ana", "OWNER", 0), memberOf("Juan", "MEMBER", 1)],
};
```

3. Replace the line `    const fixture = ledgerFixture({ access: fakeSpaceAccess(household, juan) });` with:

```ts
    // Task 4b: amount edits check that the parties are current members, so the ledger needs Household's.
    const fixture = ledgerFixture({ access: fakeSpaceAccess(household, juan), members: currentHousehold });
```

4. Append to the end of the file:

```ts

describe("edits and deletes never move a former member's balance (HU-E1-08, HU-E1-12, Task 4b)", () => {
  // Luis left Household after settling: Ana paid him back for an expense he paid outside the app.
  const settledWithLuis = aSettlement("2026-10-20", 5_000_000n, {
    payerMemberId: "member-ana",
    receivingMemberId: "member-luis",
  });
  const luisPaid = anExpense("2026-10-05", 5_000_000n, {
    spaceId: "space-household",
    categoryId: CATEGORIES.household.id,
    payments: [{ memberId: "member-luis", accountId: null, amount: 5_000_000n }],
    shares: [{ memberId: "member-ana", amount: 5_000_000n, splitMethod: "EQUAL" }],
  });
  const setupWithoutLuis = () => {
    const fixture = ledgerFixture({ access: fakeSpaceAccess(household), members: currentHousehold });
    fixture.store.rows.push(settledWithLuis, luisPaid);
    return {
      ...fixture,
      edit: createEditTransaction(fixture.deps),
      remove: createDeleteTransaction(fixture.deps),
    };
  };
  const onHousehold = (transactionId: string) => ({ spaceId: "space-household", userId: "u-ana", transactionId });

  it.each([
    ["the settlement Luis received", settledWithLuis],
    ["the expense Luis paid", luisPaid],
  ])("refuses a new amount for %s and changes nothing", async (_, tx) => {
    const { edit, store, audit } = setupWithoutLuis();
    const changes = { amount: money(6_000_000n) };
    expect(codeOf(await edit({ ...onHousehold(tx.id), expectedVersion: null, changes }))).toBe(
      "NotASpaceMember",
    );
    expect(store.rows.find((t) => t.id === tx.id)).toEqual(tx);
    expect(audit.entries).toEqual([]);
  });

  it("refuses deleting them", async () => {
    const { remove, store, audit } = setupWithoutLuis();
    for (const tx of [settledWithLuis, luisPaid]) {
      expect(codeOf(await remove(onHousehold(tx.id)))).toBe("NotASpaceMember");
    }
    expect(store.rows.map((t) => t.deletedAt)).toEqual([null, null]);
    expect(audit.entries).toEqual([]);
  });

  it("still lets the OWNER correct what moves no balance: description, date and category", async () => {
    const { edit } = setupWithoutLuis();
    const changes = { description: "Paid back Luis", date: "2026-10-21" as LocalDate };
    expect(unwrap(await edit({ ...onHousehold(settledWithLuis.id), expectedVersion: null, changes }))).toMatchObject(
      { ...changes, amount: 5_000_000n, version: 2 },
    );
  });
});
```

In `tests/acceptance/leave-space.test.ts`:

1. Replace the line `import { PATCH as editTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";` with:

```ts
import {
  DELETE as deleteTransaction,
  PATCH as editTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
```

2. Append to the end of the file:

```ts

describe("a former member's balance stays settled (HU-E1-08, Task 4b)", () => {
  it("refuses changing the amount of, or deleting, what Luis took part in after he left", async () => {
    const h = await household();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    const groceries = await paysEqually(luis, 100_000, [h.ana.memberId, luis.memberId], h.groceries);
    const payback = await settles(h.ana, h.ana.memberId, luis.memberId, 50_000);
    expect((await leave(luis, h.spaceId)).status).toBe(204);
    const onTransaction = (transactionId: string) => ({
      user: h.ana,
      params: { spaceId: h.spaceId, transactionId },
    });
    const path = (id: string) => `/api/v1/spaces/${h.spaceId}/transactions/${id}`;
    const raised = await call(editTransaction, "PATCH", path(payback.id), {
      ...onTransaction(payback.id),
      body: { amount: cop(60_000) },
    });
    expect(await problemOf(raised)).toEqual([422, "NotASpaceMember"]);
    for (const tx of [payback, groceries]) {
      const deleted = await call(deleteTransaction, "DELETE", path(tx.id), onTransaction(tx.id));
      expect(await problemOf(deleted)).toEqual([422, "NotASpaceMember"]);
    }
    const renamed = await call(editTransaction, "PATCH", path(payback.id), {
      ...onTransaction(payback.id),
      body: { description: "Paid back Luis" },
    });
    expect(renamed.status).toBe(200);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
      [luis.memberId, cop(0)],
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger && pnpm exec vitest run --project acceptance tests/acceptance/leave-space.test.ts`
Expected: FAIL — `balanceParties is not a function`; the amount edits and the deletions of Luis's transactions answer `ok` instead of `NotASpaceMember`; the acceptance test gets `200` and `204`. The D9 describe block and every other existing test pass.

- [ ] **Step 3: Implement**

In `src/modules/ledger/domain/transaction.ts`, insert before the line `/** D8: transactions are never hard-deleted. */`:

```ts
/**
 * E5 balance rule: the members whose net a transaction moves — the payers and participants of a
 * member-paid expense and both parties of a settlement; nobody for fund-paid expenses, transfers
 * (fund contributions included) and incomes (D5).
 */
export const balanceParties = (tx: Transaction): string[] => {
  if (tx.type === "SETTLEMENT") return [tx.payerMemberId, tx.receivingMemberId];
  if (tx.type !== "EXPENSE" || tx.payments.some((p) => p.memberId === null)) return [];
  const payers = tx.payments.flatMap((p) => (p.memberId === null ? [] : [p.memberId]));
  return [...new Set([...payers, ...tx.shares.map((s) => s.memberId)])];
};

```

In `src/modules/ledger/application/checks.ts`:

1. Add after the line `import { domainError, err, map, ok, type LocalDate, type Money, type Result } from "@/shared/kernel";`:

```ts
import { balanceParties, type Transaction } from "../domain/transaction";
```

2. Append to the end of the file:

```ts

/**
 * HU-E1-08, HU-E1-12: a member who left or was removed keeps the zero balance they settled with, and
 * nobody can settle with them any more (HU-E5-02), so no edit or deletion may move it (Task 4b).
 */
export const ensureCurrentParties = async (
  deps: Pick<LedgerDeps, "members">,
  spaceId: SpaceMembership["spaceId"],
  tx: Transaction,
): Promise<Result<void>> => {
  const parties = balanceParties(tx);
  if (parties.length === 0) return ok(undefined);
  const current = new Set((await deps.members.listCurrent(spaceId)).map((m) => m.id));
  return parties.every((id) => current.has(id)) ? ok(undefined) : err(domainError("NotASpaceMember"));
};
```

In `src/modules/ledger/application/edit-transaction.ts`:

1. Replace the line `import { openPeriod, usableCategory } from "./checks";` with:

```ts
import { ensureCurrentParties, openPeriod, usableCategory } from "./checks";
```

2. Add after the line `      if (!debits.ok) return debits;`:

```ts
      // HU-E1-08, HU-E1-12: a new amount must not move the balance of a member who left (Task 4b).
      if (changes.amount) {
        const parties = await ensureCurrentParties(deps, membership.value.spaceId, current);
        if (!parties.ok) return parties;
      }
```

In `src/modules/ledger/application/delete-transaction.ts`:

1. Replace the line `import { openPeriod } from "./checks";` with:

```ts
import { ensureCurrentParties, openPeriod } from "./checks";
```

2. Add after the line `      if (!open.ok) return open;`:

```ts
      // HU-E1-08, HU-E1-12: deleting must not move the balance of a member who left (Task 4b).
      const parties = await ensureCurrentParties(deps, membership.value.spaceId, current);
      if (!parties.ok) return parties;
```

In `src/modules/ledger/contracts/ledger.contract.ts`:

1. Replace the line `            "ValidationFailed, InvalidAmount, InvalidDate, InvalidDescription, CurrencyMismatch, UnknownCurrency, AccountNotOwned",` with:

```ts
            "ValidationFailed, InvalidAmount, InvalidDate, InvalidDescription, CurrencyMismatch, UnknownCurrency, AccountNotOwned, NotASpaceMember",
```

2. Add after the line `          "409": "PeriodClosed",` (in `deleteTransaction`):

```ts
          "422": "NotASpaceMember",
```

- [ ] **Step 4: Run the tests to verify they pass and refresh the snapshot**

Run: `pnpm exec vitest run --project unit src/modules/ledger && pnpm exec vitest run --project acceptance tests/acceptance/leave-space.test.ts`
Expected: PASS, including M1/M2-B's edit and delete tests and Task 4.2's "still refuses the OWNER changing what Juan settled from his own account after he left (D9)" (`AccountNotOwned` is checked first). Mutation checks: temporarily delete the `ensureCurrentParties` call of `edit-transaction.ts` — "refuses a new amount …" fails (the amount changes) and so does the acceptance test; restore it and delete the call of `delete-transaction.ts` — "refuses deleting them" fails; restore it.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: only `PATCH /api/v1/spaces/{spaceId}/transactions/{transactionId}` (its `422` description names `NotASpaceMember`) and `DELETE` of the same path (a new `422` response) change, about 12 lines; components are unchanged.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/domain/transaction.ts src/modules/ledger/domain/transaction.test.ts src/modules/ledger/application/checks.ts src/modules/ledger/application/edit-transaction.ts src/modules/ledger/application/delete-transaction.ts src/modules/ledger/application/edit-and-delete.test.ts src/modules/ledger/contracts/ledger.contract.ts tests/acceptance/leave-space.test.ts openapi/openapi.snapshot.json
git commit -m "feat(ledger): keep a former member's settled balance out of edits and deletes (Refs #17, Refs #21)"
```

---

### Task 5: Spaces — claim links and direct pair keys in the schema (migration 0009)

Schema task for HU-E1-11 (issue #20) and HU-E1-13 (issue #22), with the constraint tests written first so they are red before the migration. A claim link is a `space_invitations` row of kind `CLAIM` that names its guest (`guest_member_id`); a direct space between two registered users is stored under `spaces.direct_pair_key`, unique among active spaces.

Decisions:
- One migration for both stories (they are the only member-lifecycle schema changes of M2-C), so this task adds one file to `drizzle/`: `0009`, after Task 0a's `0008_category_soft_delete`.
- `space_invitations.guest_member_id uuid → space_members(id)` with `ON DELETE cascade` (a space deletion cascades to both tables anyway), indexed for the revocation of Task 9. `space_invitations_claim_guest`: `(kind = 'CLAIM') = (guest_member_id IS NOT NULL)`; `space_invitations_claim_role`: a claim is stored as `MEMBER` (the existing `space_invitations_role` check already forbids `OWNER`; claiming a direct space's guest still grants OWNER, decided in the domain, Task 6). The existing `space_invitations_email_kind` check keeps claims without an email.
- `spaces.direct_pair_key text`: `"<userA>:<userB>"` with the two user ids sorted, set only when a `DIRECT` space is created between two registered users (`spaces_direct_pair_kind`). `spaces_direct_pair_uq` is unique **where `archived_at IS NULL`**, so an archived direct space keeps its key and the pair can start a new one (Task 14); a guest's direct space and a claimed one keep a null key, which never conflicts (spec D16: "both are kept").
- The domain and the contract must accept the wider `kind` now, or the repository and DTO stop compiling: `InvitationKind` gains `"CLAIM"`, `Invitation` gains `guestMemberId: string | null` (null for email and link invitations), the repository writes it, and `InvitationSchema.kind` gains `"CLAIM"` (an OpenAPI component change). The claim behaviour itself is Task 6.

**Files:**
- Modify: `src/modules/spaces/infrastructure/spaces.schema.ts`, `src/modules/spaces/domain/invitation.ts`, `src/modules/spaces/domain/invitation.test.ts`, `src/modules/spaces/infrastructure/drizzle-invitation-repository.ts`, `src/modules/spaces/contracts/spaces.contract.ts`, `openapi/openapi.snapshot.json`
- Create (generated): `drizzle/0009_member_lifecycle.sql`, `drizzle/meta/0009_snapshot.json`; Modify (generated): `drizzle/meta/_journal.json`
- Test: `src/modules/spaces/infrastructure/spaces-schema.int.test.ts`

**Interfaces:**
- Consumes: `spaces`, `spaceMembers`, `spaceInvitations` (M2-A schema); `sharedSpaceFixture`, `userFixture`, `guestMemberFixture` (`tests/support/fixtures.ts`).
- Produces:
  - `space_invitations.guest_member_id` (`spaceInvitations.guestMemberId`), index `space_invitations_guest_member_id_idx`, checks `space_invitations_claim_guest`, `space_invitations_claim_role`; `kind` enum `["EMAIL", "LINK", "CLAIM"]`.
  - `spaces.direct_pair_key` (`spaces.directPairKey`), partial unique index `spaces_direct_pair_uq`, check `spaces_direct_pair_kind`.
  - `type InvitationKind = "EMAIL" | "LINK" | "CLAIM"`; `Invitation.guestMemberId: string | null`; `issueInvitation` sets it to `null`.

- [ ] **Step 1: Write the failing constraint tests**

In `src/modules/spaces/infrastructure/spaces-schema.int.test.ts`:

1. Replace the line `import { sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";` with:

```ts
import { guestMemberFixture, sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";
```

2. Append to the end of the file:

```ts

describe("space_invitations claim links (HU-E1-11)", () => {
  it("binds claim links, and only them, to one guest, and only as MEMBER", async () => {
    const ana = await userFixture(pool, "Ana");
    const space = await sharedSpaceFixture(db, ana.id);
    const pedro = await guestMemberFixture(
      pool,
      { userId: ana.id, spaceId: space.id, memberId: space.members[0]!.id },
      "Pedro",
    );
    const insert = (kind: string, role: string, guestMemberId: string | null) =>
      pool.query(
        `INSERT INTO space_invitations (id, space_id, kind, role, token_hash, status, created_by, created_at, expires_at, guest_member_id)
         VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, now(), now() + interval '7 days', $7)`,
        [randomUUID(), space.id, kind, role, randomUUID(), ana.id, guestMemberId],
      );
    await expect(insert("CLAIM", "MEMBER", null)).rejects.toThrow(/space_invitations_claim_guest/);
    await expect(insert("LINK", "MEMBER", pedro)).rejects.toThrow(/space_invitations_claim_guest/);
    await expect(insert("CLAIM", "ADMIN", pedro)).rejects.toThrow(/space_invitations_claim_role/);
    await expect(insert("CLAIM", "MEMBER", pedro)).resolves.toBeDefined();
  });
});

describe("spaces direct pair key (HU-E1-13, D16)", () => {
  const insert = (kind: string, pairKey: string | null, archivedAt: Date | null = null) =>
    pool.query(
      `INSERT INTO spaces (id, name, kind, currency, period_policy, direct_pair_key, archived_at, created_at)
       VALUES ($1, 'Ana & Juan', $2, 'COP', '{"kind":"MONTHLY","day":1}', $3, $4, now())`,
      [randomUUID(), kind, pairKey, archivedAt],
    );

  it("keeps one active direct space per pair; archived ones and spaces without a pair never conflict", async () => {
    const pair = `${randomUUID()}:${randomUUID()}`;
    await expect(insert("DIRECT", pair, new Date())).resolves.toBeDefined();
    await expect(insert("DIRECT", pair)).resolves.toBeDefined();
    await expect(insert("DIRECT", pair)).rejects.toThrow(/spaces_direct_pair_uq/);
    await expect(insert("DIRECT", null)).resolves.toBeDefined();
    await expect(insert("DIRECT", null)).resolves.toBeDefined();
  });

  it("stores a pair key on direct spaces only", async () => {
    await expect(insert("SHARED", `${randomUUID()}:${randomUUID()}`)).rejects.toThrow(/spaces_direct_pair_kind/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project integration src/modules/spaces/infrastructure/spaces-schema.int.test.ts`
Expected: FAIL — every new insert errors with `column "guest_member_id" of relation "space_invitations" does not exist` or `column "direct_pair_key" of relation "spaces" does not exist`, so the `resolves` cases fail and no error matches a constraint name; M2-A's test in the file passes.

- [ ] **Step 3: Write the schema and widen the domain**

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
    // HU-E1-13: "<userA>:<userB>" (sorted) for a DIRECT space created between two registered users.
    directPairKey: text("direct_pair_key"),
    archivedAt: tz("archived_at"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    check("spaces_personal_owner", sql`(${t.kind} = 'PERSONAL') = (${t.personalOwnerUserId} IS NOT NULL)`),
    // D16: one active direct space per pair of users; an archived one keeps its key and frees the pair.
    uniqueIndex("spaces_direct_pair_uq").on(t.directPairKey).where(sql`${t.archivedAt} IS NULL`),
    check("spaces_direct_pair_kind", sql`${t.directPairKey} IS NULL OR ${t.kind} = 'DIRECT'`),
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
    uniqueIndex("space_members_current_user_uq")
      .on(t.spaceId, t.userId)
      .where(sql`${t.leftAt} IS NULL`),
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

// HU-E1-06, HU-E1-07, HU-E1-11. Values mirror the domain types; listed here so drizzle-kit loads no domain code.
export const spaceInvitations = pgTable(
  "space_invitations",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["EMAIL", "LINK", "CLAIM"] }).notNull(),
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
    // HU-E1-11: the guest whose place a CLAIM link hands over.
    guestMemberId: uuid("guest_member_id").references(() => spaceMembers.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("space_invitations_space_id_idx").on(t.spaceId),
    // Foreign keys to user: deleting a user finds its invitations without a scan.
    index("space_invitations_created_by_idx").on(t.createdBy),
    index("space_invitations_accepted_by_user_id_idx").on(t.acceptedByUserId),
    // HU-E1-12: a guest's pending claim links are revoked when the guest is removed.
    index("space_invitations_guest_member_id_idx").on(t.guestMemberId),
    // Email invitations are bound to one address; link invitations to none.
    check("space_invitations_email_kind", sql`(${t.kind} = 'EMAIL') = (${t.email} IS NOT NULL)`),
    // An invitation never grants OWNER.
    check("space_invitations_role", sql`${t.role} IN ('ADMIN', 'MEMBER', 'VIEWER')`),
    // HU-E1-11: claim links, and only they, name a guest; they are stored as MEMBER.
    check("space_invitations_claim_guest", sql`(${t.kind} = 'CLAIM') = (${t.guestMemberId} IS NOT NULL)`),
    check("space_invitations_claim_role", sql`${t.kind} <> 'CLAIM' OR ${t.role} = 'MEMBER'`),
  ],
);
```

In `src/modules/spaces/domain/invitation.ts`:

1. Replace the line `export type InvitationKind = "EMAIL" | "LINK";` with:

```ts
/** EMAIL and LINK invitations add a member (HU-E1-06); CLAIM links hand over a guest's place (HU-E1-11). */
export type InvitationKind = "EMAIL" | "LINK" | "CLAIM";
```

2. Add after the line `  readonly email: string | null;`:

```ts
  /** HU-E1-11: set only for CLAIM links, the guest whose place they hand over. */
  readonly guestMemberId: string | null;
```

3. Add after the line `    email,` (in `issueInvitation`'s object):

```ts
    guestMemberId: null,
```

In `src/modules/spaces/domain/invitation.test.ts`, add after the line `      email: "juan@example.com",`:

```ts
      guestMemberId: null,
```

In `src/modules/spaces/infrastructure/drizzle-invitation-repository.ts`, add after the line `      email: invitation.email,`:

```ts
      guestMemberId: invitation.guestMemberId,
```

In `src/modules/spaces/contracts/spaces.contract.ts`, replace the line `  kind: z.enum(["EMAIL", "LINK"]),` with:

```ts
  kind: z.enum(["EMAIL", "LINK", "CLAIM"]),
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate --name member_lifecycle`
Expected: `drizzle/0009_member_lifecycle.sql` that adds `spaces.direct_pair_key text` and `space_invitations.guest_member_id uuid` with the foreign key `space_invitations_guest_member_id_space_members_id_fk` (`ON DELETE cascade`), creates `space_invitations_guest_member_id_idx` and the unique index `spaces_direct_pair_uq … WHERE "spaces"."archived_at" IS NULL`, and adds the checks `spaces_direct_pair_kind`, `space_invitations_claim_guest` and `space_invitations_claim_role`; `drizzle/meta/0009_snapshot.json`; a `0009_member_lifecycle` journal entry. Nothing is removed, so drizzle-kit asks no rename questions; if it prompts, answer "create" for every new entity.

- [ ] **Step 5: Verify migrations, drift, the new tests and the existing repositories**

Run: `pnpm db:check && pnpm exec vitest run --project integration`
Expected: "No schema drift" and PASS for the whole integration project, including `spaces-schema.int.test.ts` and M2-A's `drizzle-invitation-repository.int.test.ts` (an invitation read back now carries `guestMemberId: null`, like the one `issueInvitation` builds).

- [ ] **Step 6: Refresh the OpenAPI snapshot and run the unit tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: only the `Invitation` component's `kind` enum gains `"CLAIM"`; no operation changes.
Run: `pnpm exec vitest run --project unit`
Expected: PASS (`invitation.test.ts` expects `guestMemberId: null`).

- [ ] **Step 7: Gates**

Run: `pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/modules/spaces/infrastructure/spaces.schema.ts src/modules/spaces/infrastructure/spaces-schema.int.test.ts src/modules/spaces/domain/invitation.ts src/modules/spaces/domain/invitation.test.ts src/modules/spaces/infrastructure/drizzle-invitation-repository.ts src/modules/spaces/contracts/spaces.contract.ts openapi/openapi.snapshot.json drizzle/0009_member_lifecycle.sql drizzle/meta/0009_snapshot.json drizzle/meta/_journal.json
git commit -m "feat(spaces): store claim links and direct pair keys with migration 0009 (Refs #20, Refs #22)"
```

---

### Task 6: Spaces domain — claim links and claimed guests

Implements the pure rules of HU-E1-11 (issue #20): issuing a claim link, deciding whether it can still be used, using it up, and turning the guest's member row into the claiming user's. Pins Review Focus 2 at the domain level.

Decisions:
- `issueClaim` is separate from `issueInvitation`, so `CreateInvitation` (whose `InvitationTarget` stays email or link) can never issue a claim, and a claim never carries an email (spec 5.2: claim links are "not bound to `contactEmail`").
- `ensureClaimable` mirrors `ensureAcceptable`'s order (revocation and use before expiry), but answers `GuestAlreadyClaimed` for a used link (HU-E1-11 outline) where invitations answer `InvitationAlreadyUsed`.
- `markAccepted` now uses up every kind but `LINK`: email invitations (M2-A) and claim links (HU-E1-11) are single-use. The M2-A tests of `LINK` and `EMAIL` keep passing unchanged.
- `claimedGuest` keeps the guest's id, `displayName` and `joinedAt` (spec 5.2: "keeps the same SpaceMember id, so all history stays attached"), sets the user, clears `contactEmail` (`space_members_contact_email` allows it only on guests) and gives `MEMBER`, or `OWNER` in a direct space (D16: both members of a direct space are OWNER; controller ruling O3; Self-Review, contradiction 1).
- The direct-space role lives in one constant, `DIRECT_MEMBER_ROLE` in `space.ts`, which both `claimedGuest` and `createDirectSpace` (Task 12) read, so the D16 rule is written once.
- A guest who is no longer current answers `MemberNotFound`; one who is already registered (claimed through another link) answers `GuestAlreadyClaimed`.

**Files:**
- Modify: `src/modules/spaces/domain/invitation.ts`, `src/modules/spaces/domain/member.ts`, `src/modules/spaces/domain/space.ts`
- Test: `src/modules/spaces/domain/invitation.test.ts`, `src/modules/spaces/domain/member.test.ts`

**Interfaces:**
- Consumes: `Invitation`, `InvitationId`, `INVITATION_TTL_MS`, `effectiveStatus`, `markAccepted`, `revokeInvitation` (M2-A, widened in Task 5); `SpaceMember`, `SpaceKind`, `SpaceId` (`domain/space.ts`).
- Produces:
  - `isClaim(invitation: Invitation): boolean`
  - `issueClaim(input: { id: InvitationId; spaceId: SpaceId; guestMemberId: string; tokenHash: string; createdBy: string; now: Date }): Invitation` (kind `CLAIM`, role `MEMBER`, email `null`, `PENDING`, 7 days)
  - `ensureClaimable(claim: Invitation, now: Date): Result<void>` — `InvitationRevoked`, `GuestAlreadyClaimed`, `InvitationExpired`
  - `markAccepted` single-use for `EMAIL` and `CLAIM`
  - `claimedGuest(current: readonly SpaceMember[], guestId: string, claim: { userId: string; spaceKind: SpaceKind }): Result<SpaceMember>` — `MemberNotFound`, `GuestAlreadyClaimed`
  - `space.ts`: `export const DIRECT_MEMBER_ROLE: SpaceRole` (`"OWNER"`, D16)

- [ ] **Step 1: Write the failing tests**

In `src/modules/spaces/domain/invitation.test.ts`:

1. Add after the line `  ensureAcceptable,` (in the import from `./invitation`):

```ts
  ensureClaimable,
  isClaim,
  issueClaim,
```

2. Append to the end of the file:

```ts

describe("claim links (HU-E1-11)", () => {
  const claim = issueClaim({
    id: "inv-2" as InvitationId,
    spaceId: "space-household" as SpaceId,
    guestMemberId: "member-pedro",
    tokenHash: "hash(token-2)",
    createdBy: "u-ana",
    now: created,
  });

  it("binds a pending link to one guest, as MEMBER and without an address, valid 7 days", () => {
    expect(claim).toEqual({
      id: "inv-2",
      spaceId: "space-household",
      kind: "CLAIM",
      email: null,
      guestMemberId: "member-pedro",
      role: "MEMBER",
      tokenHash: "hash(token-2)",
      status: "PENDING",
      createdBy: "u-ana",
      createdAt: created,
      expiresAt: new Date("2026-10-19T12:00:00Z"),
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
    });
  });

  it("can be claimed until just before 7 days and not from exactly 7 days", () => {
    expect(code(ensureClaimable(claim, at(7 * DAY - 1)))).toBe("ok");
    expect(code(ensureClaimable(claim, at(7 * DAY)))).toBe("InvitationExpired");
  });

  it("is used up by its first claim, so a second answers GuestAlreadyClaimed (Review Focus 2)", () => {
    const used = markAccepted(claim, "u-pedro", at(DAY));
    expect(used).toMatchObject({ status: "ACCEPTED", acceptedAt: at(DAY), acceptedByUserId: "u-pedro" });
    expect(code(ensureClaimable(used, at(DAY)))).toBe("GuestAlreadyClaimed");
  });

  it("answers InvitationRevoked once revoked, also after it would have expired", () => {
    expect(code(ensureClaimable(revoked(claim), at(DAY)))).toBe("InvitationRevoked");
    expect(code(ensureClaimable(revoked(claim), at(8 * DAY)))).toBe("InvitationRevoked");
  });

  it("tells claim links from invitations", () => {
    expect([isClaim(claim), isClaim(link), isClaim(toJuan)]).toEqual([true, false, false]);
  });
});
```

In `src/modules/spaces/domain/member.test.ts`:

1. Add after the line `  changeMemberRole,` (in the import from `./member`):

```ts
  claimedGuest,
```

2. Append to the end of the file:

```ts

describe("claiming a guest's place (HU-E1-11)", () => {
  const pedroWithEmail: SpaceMember = { ...pedro, contactEmail: "pedro@example.com" };
  const withPedro = [ana, luis, pedroWithEmail];

  it("turns the guest into a registered MEMBER with the same id and name and no contact email", () => {
    expect(claimedGuest(withPedro, "pedro", { userId: "u-pedro", spaceKind: "SHARED" })).toEqual({
      ok: true,
      value: { ...pedro, kind: "USER", userId: "u-pedro", role: "MEMBER", contactEmail: null },
    });
  });

  it("makes the claimer of a direct space's guest an OWNER, like its other member (D16)", () => {
    const claimed = claimedGuest([ana, pedro], "pedro", { userId: "u-pedro", spaceKind: "DIRECT" });
    expect(claimed.ok && claimed.value.role).toBe("OWNER");
  });

  it("answers GuestAlreadyClaimed for a registered member and MemberNotFound for anyone not current", () => {
    const claim = { userId: "u-pedro", spaceKind: "SHARED" } as const;
    expect(code(claimedGuest(withPedro, "luis", claim))).toBe("GuestAlreadyClaimed");
    expect(code(claimedGuest(withPedro, "nobody", claim))).toBe("MemberNotFound");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/spaces/domain`
Expected: FAIL — `issueClaim is not a function` (the `describe` block cannot even build its claim) and `claimedGuest is not a function`.

- [ ] **Step 3: Implement**

In `src/modules/spaces/domain/invitation.ts`:

1. Replace the lines from `/** HU-E1-07: email invitations are single-use; link invitations stay valid until expiry or revocation. */` to `    : invitation;` with:

```ts
/**
 * HU-E1-07, HU-E1-11: email invitations and claim links are single-use; link invitations stay valid
 * until expiry or revocation.
 */
export const markAccepted = (invitation: Invitation, userId: string, now: Date): Invitation =>
  invitation.kind === "LINK"
    ? invitation
    : { ...invitation, status: "ACCEPTED", acceptedAt: now, acceptedByUserId: userId };
```

2. Append to the end of the file:

```ts

/** HU-E1-11: claim links hand over a guest's place; they never add a member. */
export const isClaim = (invitation: Invitation): boolean => invitation.kind === "CLAIM";

/**
 * HU-E1-11: a single-use bearer link for one guest, valid 7 days and not bound to the guest's contact
 * email. It is stored as MEMBER; claiming grants MEMBER, or OWNER in a direct space (claimedGuest, D16).
 */
export const issueClaim = (input: {
  id: InvitationId;
  spaceId: SpaceId;
  guestMemberId: string;
  tokenHash: string;
  createdBy: string;
  now: Date;
}): Invitation => ({
  id: input.id,
  spaceId: input.spaceId,
  kind: "CLAIM",
  email: null,
  guestMemberId: input.guestMemberId,
  role: "MEMBER",
  tokenHash: input.tokenHash,
  status: "PENDING",
  createdBy: input.createdBy,
  createdAt: input.now,
  expiresAt: new Date(input.now.getTime() + INVITATION_TTL_MS),
  acceptedAt: null,
  acceptedByUserId: null,
  revokedAt: null,
});

/** HU-E1-11: what keeps a claim link from being used; a used link answers GuestAlreadyClaimed. */
export const ensureClaimable = (claim: Invitation, now: Date): Result<void> => {
  if (claim.status === "REVOKED") return err(domainError("InvitationRevoked"));
  if (claim.status === "ACCEPTED") return err(domainError("GuestAlreadyClaimed"));
  return effectiveStatus(claim, now) === "EXPIRED" ? err(domainError("InvitationExpired")) : ok(undefined);
};
```

In `src/modules/spaces/domain/space.ts`, add after the line `export type SpaceRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";`:

```ts
/** D16: every registered member of a direct space is OWNER, its creator and its other person alike. */
export const DIRECT_MEMBER_ROLE: SpaceRole = "OWNER";
```

In `src/modules/spaces/domain/member.ts`:

1. Replace the line `import type { SpaceMember, SpaceMemberId, SpaceRole } from "./space";` with:

```ts
import {
  DIRECT_MEMBER_ROLE,
  type SpaceKind,
  type SpaceMember,
  type SpaceMemberId,
  type SpaceRole,
} from "./space";
```

2. Append to the end of the file:

```ts

/**
 * HU-E1-11, D15: the guest's member row as the claiming user's: same id, name and join date, so all
 * history stays attached; registered as MEMBER, or OWNER in a direct space, whose two members are both
 * OWNER (D16). Only guests carry a contact email, so it is cleared.
 */
export const claimedGuest = (
  current: readonly SpaceMember[],
  guestId: string,
  claim: { readonly userId: string; readonly spaceKind: SpaceKind },
): Result<SpaceMember> => {
  const guest = current.find((m) => m.id === guestId);
  if (!guest) return err(domainError("MemberNotFound"));
  if (guest.kind !== "GUEST") return err(domainError("GuestAlreadyClaimed"));
  const claimed: SpaceMember = {
    ...guest,
    kind: "USER",
    userId: claim.userId,
    role: claim.spaceKind === "DIRECT" ? DIRECT_MEMBER_ROLE : "MEMBER",
    contactEmail: null,
  };
  return ok(claimed);
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/spaces`
Expected: PASS, including M2-A's "keeps a link invitation usable by anyone until it expires" and "uses up an email invitation". Mutation check: temporarily restore `invitation.kind === "EMAIL" ? { …accepted } : invitation` in `markAccepted` — "is used up by its first claim" fails; restore the new version.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/domain/invitation.ts src/modules/spaces/domain/invitation.test.ts src/modules/spaces/domain/member.ts src/modules/spaces/domain/member.test.ts src/modules/spaces/domain/space.ts
git commit -m "feat(spaces): add single-use claim links and claimed guests to the domain (Refs #20)"
```

---

### Task 7: Spaces — CreateGuestClaim and ClaimGuestPlace

Implements HU-E1-11 (issue #20) as use cases: an OWNER or ADMIN creates a claim link for a current guest, and a signed-in user takes over that guest's place. `AcceptInvitation` refuses claim tokens. Pins Review Focus 2 at the use-case level. Borderline size (~400 lines): commit it as **7a** (Steps 1–4: the ports, the in-memory twin, `CreateGuestClaim` and a `claims.test.ts` that imports only what its first `describe` block uses) and **7b** (Steps 5–10: `ClaimGuestPlace`, the `AcceptInvitation` guard, and the test file's imports, `world()` and second `describe` block), each green and with its own RDD pass.

Decisions:
- `CreateGuestClaim` authorizes with `member.invite` (the M2-A matrix comment already names claim links), reuses the invitation token machinery (256-bit token, only its SHA-256 stored, `InvitationRepository.add`) and returns the `CreatedInvitation` shape (`invitation`, `url`, `emailSent: false`). It is allowed in a direct space, because no member is added.
- `ClaimGuestPlace` locks the link (`findByTokenHashForUpdate`, as acceptance does), refuses tokens that are not claims (`InvitationNotFound`), checks the link, refuses a user who is already a current member (`AlreadyMember`), decides the claimed row in the domain and lets the database decide races through `GuestClaimRepository.claimGuest` (`"notAGuest"` → `GuestAlreadyClaimed`, `"alreadyMember"` → `AlreadyMember`). The answer is the space as the new member sees it, read back through `SpaceAccess` like `AcceptInvitation`.
- The space kind (for the OWNER rule of D16) comes from `GuestClaimRepository.spaceKindOf`: the claimer is not a member yet, so `SpaceAccess` cannot give it.
- `AcceptInvitation` answers `InvitationNotFound` to a claim token: a claim link must never add a second member for the same person.
- Claim URLs are `<base>/claims/<token>` (`ClaimsDeps.claimUrl`); the page is web UI (HU-E9-05).

**Files:**
- 7a — Create: `src/modules/spaces/application/create-guest-claim.ts`; Modify: `src/modules/spaces/application/space-member-repository.ts`, `src/modules/spaces/application/invitation-ports.ts`, `src/modules/spaces/application/index.ts`, `tests/support/in-memory-spaces.ts`; Test: `src/modules/spaces/application/claims.test.ts` (created)
- 7b — Create: `src/modules/spaces/application/claim-guest-place.ts`; Modify: `src/modules/spaces/application/accept-invitation.ts`, `src/modules/spaces/application/index.ts`; Test: `src/modules/spaces/application/claims.test.ts` (extended)

**Interfaces:**
- Consumes: `issueClaim`, `isClaim`, `ensureClaimable`, `markAccepted`, `claimedGuest` (Task 6); `currentGuest` (Task 1); `authorizeSpaceAction`, `toSpaceSummary`, `toInvitationView`, `CreatedInvitation`, `InvitationRepository`, `InvitationTokens`, `createAcceptInvitation`, `createCreateInvitation`, `createRevokeInvitation` (M2-A); `invitationsWorld`, `householdSpace`, `memberOf`, `InMemorySpaceStore` (`tests/support/in-memory-spaces.ts`).
- Produces:
  - `type ClaimOutcome = "claimed" | "notAGuest" | "alreadyMember"`
  - `interface GuestClaimRepository { spaceKindOf(spaceId: SpaceId): Promise<SpaceKind>; claimGuest(spaceId: SpaceId, claimed: SpaceMember, claimedAt: Date): Promise<ClaimOutcome> }`
  - `interface ClaimsDeps { access; members: Pick<SpaceMemberRepository, "listCurrent">; claims: GuestClaimRepository; invitations: InvitationRepository; tokens: InvitationTokens; claimUrl: (token: string) => string; ids; clock; tm }`
  - `type CreateGuestClaim = (input: { spaceId: string; userId: string; memberId: string }) => Promise<Result<CreatedInvitation>>`; `createCreateGuestClaim(deps: ClaimsDeps)` — errors `SpaceNotFound`, `InsufficientRole`, `MemberNotFound`, `NotAGuest`
  - `type ClaimGuestPlace = (input: { token: string; userId: string }) => Promise<Result<SpaceSummary>>`; `createClaimGuestPlace(deps: ClaimsDeps)` — errors `InvitationNotFound`, `InvitationRevoked`, `GuestAlreadyClaimed`, `InvitationExpired`, `AlreadyMember`, `MemberNotFound`
  - `InMemorySpaceStore`: `claimed: { spaceId: string; memberId: string; claimedAt: Date }[]`, `spaceKindOf`, `claimGuest`; `invitationsWorld(...)` also returns `claims: ClaimsDeps` (same store, tokens, ids and clock; claim URLs `https://hearth.test/claims/<token>`).

#### 7a — claim links for guests

- [ ] **Step 1: Write the in-memory twin and the failing tests**

In `tests/support/in-memory-spaces.ts`:

1. Add after the line `  type AddMemberOutcome,` (in the `@/modules/spaces/application` import):

```ts
  type ClaimOutcome,
  type ClaimsDeps,
```

2. Add after the line `  type SpaceId,`:

```ts
  type SpaceKind,
```

3. Add after the line `  spaces: Space[] = [];`:

```ts
  /** Claims applied, in order (PostgreSQL stores claimedAt on the member row). */
  readonly claimed: { spaceId: string; memberId: string; claimedAt: Date }[] = [];
```

4. Insert before the line `  /** Test setup: a space as earlier use cases would have left it. */`:

```ts
  /** GuestClaimRepository, like DrizzleSpaceRepository.spaceKindOf. */
  async spaceKindOf(spaceId: string): Promise<SpaceKind> {
    const space = this.spaces.find((s) => s.id === spaceId);
    if (!space) throw new Error(`space ${spaceId} does not exist`);
    return space.kind;
  }

  /** GuestClaimRepository, like DrizzleSpaceRepository.claimGuest (pinned against it by its integration test). */
  async claimGuest(spaceId: string, claimed: SpaceMember, claimedAt: Date): Promise<ClaimOutcome> {
    const current = this.members(spaceId);
    if (current.some((m) => m.userId !== null && m.userId === claimed.userId)) return "alreadyMember";
    if (!current.some((m) => m.id === claimed.id && m.kind === "GUEST")) return "notAGuest";
    this.update(spaceId, (s) => ({ ...s, members: s.members.map((m) => (m.id === claimed.id ? claimed : m)) }));
    this.claimed.push({ spaceId, memberId: claimed.id, claimedAt });
    return "claimed";
  }

```

5. Replace the line `    tokens: fakeTokens(),` with:

```ts
    tokens,
```

6. Replace the line `    ids: sequentialIds("id"),` with:

```ts
    ids,
```

7. Insert before the line `  const deps: InvitationsDeps = {`:

```ts
  const tokens = fakeTokens();
  const ids = sequentialIds("id");
```

8. Replace the line `  return { store, invitations, emailSender, clock, deps };` with:

```ts
  // HU-E1-11: claim links share the store, tokens, ids and clock of the invitations above.
  const claims: ClaimsDeps = {
    access: deps.access,
    members: store,
    claims: store,
    invitations,
    tokens,
    claimUrl: (token) => `https://hearth.test/claims/${token}`,
    ids,
    clock,
    tm: memoryTm,
  };
  return { store, invitations, emailSender, clock, deps, claims };
```

`src/modules/spaces/application/claims.test.ts` (7a writes it with what its first `describe` block uses; 7b extends it in Step 6):

```ts
import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { invitationsWorld, memberOf } from "../../../../tests/support/in-memory-spaces";
import type { SpaceMember } from "../domain/space";
import { createCreateGuestClaim } from "./create-guest-claim";

const space = "space-household";
const DAY = 24 * 60 * 60 * 1000;
const created = new Date("2026-10-12T12:00:00Z");
// HU-E1-11 Background: OWNER Ana, MEMBER Juan and the guest Pedro, who left a contact email.
const ANA = memberOf("Ana", "OWNER", 0);
const JUAN = memberOf("Juan", "MEMBER", 1);
const PEDRO: SpaceMember = { ...memberOf("Pedro", null, 2), contactEmail: "pedro@example.com" };

const world = () => {
  const w = invitationsWorld({ members: [ANA, JUAN, PEDRO] });
  return { ...w, createClaim: createCreateGuestClaim(w.claims) };
};
type World = ReturnType<typeof world>;
/** Ana creates a claim link for `memberId` (Pedro unless given) in `spaceId` (Household unless given). */
const claimLinkFor = async (w: World, memberId = "member-pedro", spaceId = space) =>
  unwrap(await w.createClaim({ spaceId, userId: "u-ana", memberId }));

describe("CreateGuestClaim (HU-E1-11)", () => {
  it("creates a pending claim link for Pedro, valid 7 days, whose URL carries only its token", async () => {
    const w = world();
    expect(await claimLinkFor(w)).toEqual({
      invitation: {
        id: "id-1",
        spaceId: space,
        kind: "CLAIM",
        email: null,
        role: "MEMBER",
        status: "PENDING",
        createdAt: created,
        expiresAt: new Date(created.getTime() + 7 * DAY),
      },
      url: "https://hearth.test/claims/token-1",
      emailSent: false,
    });
    expect(w.invitations.rows).toEqual([
      expect.objectContaining({
        kind: "CLAIM",
        guestMemberId: "member-pedro",
        tokenHash: "hash(token-1)",
        createdBy: "u-ana",
      }),
    ]);
    expect(w.emailSender.sent).toEqual([]);
  });

  it("refuses Juan, a MEMBER, and hides the space from non-members", async () => {
    const w = world();
    expect(codeOf(await w.createClaim({ spaceId: space, userId: "u-juan", memberId: "member-pedro" }))).toBe(
      "InsufficientRole",
    );
    expect(codeOf(await w.createClaim({ spaceId: space, userId: "u-marta", memberId: "member-pedro" }))).toBe(
      "SpaceNotFound",
    );
    expect(w.invitations.rows).toEqual([]);
  });

  it("creates claim links only for current guests", async () => {
    const w = world();
    expect(codeOf(await w.createClaim({ spaceId: space, userId: "u-ana", memberId: "member-juan" }))).toBe(
      "NotAGuest",
    );
    for (const memberId of ["member-nobody", "not-a-uuid"]) {
      expect(codeOf(await w.createClaim({ spaceId: space, userId: "u-ana", memberId }))).toBe("MemberNotFound");
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/spaces/application/claims.test.ts`
Expected: FAIL — `Failed to resolve import "./create-guest-claim"`.

- [ ] **Step 3: Implement 7a**

In `src/modules/spaces/application/space-member-repository.ts`:

1. Replace the line `import type { SpaceId, SpaceMember, SpaceMemberId, SpaceRole } from "../domain/space";` with:

```ts
import type { SpaceId, SpaceKind, SpaceMember, SpaceMemberId, SpaceRole } from "../domain/space";
```

2. Append to the end of the file:

```ts

/** Outcome of claiming a guest's place; the database decides races with removals, claims and joins. */
export type ClaimOutcome = "claimed" | "notAGuest" | "alreadyMember";

/** HU-E1-11: claiming rewrites the guest's own member row, so no money row changes (D15). */
export interface GuestClaimRepository {
  /** The kind of a space that exists (claim links reference it). */
  spaceKindOf(spaceId: SpaceId): Promise<SpaceKind>;
  /**
   * Turns the current guest `claimed.id` into the registered member `claimed` and sets claimedAt;
   * "notAGuest" when it was removed or claimed meanwhile, "alreadyMember" when its user is a current
   * member of the space already.
   */
  claimGuest(spaceId: SpaceId, claimed: SpaceMember, claimedAt: Date): Promise<ClaimOutcome>;
}
```

In `src/modules/spaces/application/invitation-ports.ts`:

1. Replace the line `import type { SpaceMemberRepository } from "./space-member-repository";` with:

```ts
import type { GuestClaimRepository, SpaceMemberRepository } from "./space-member-repository";
```

2. Append to the end of the file:

```ts

/** HU-E1-11: claim links reuse the invitation store and tokens; claiming takes over the guest's row. */
export interface ClaimsDeps {
  readonly access: SpaceAccess;
  readonly members: Pick<SpaceMemberRepository, "listCurrent">;
  readonly claims: GuestClaimRepository;
  readonly invitations: InvitationRepository;
  readonly tokens: InvitationTokens;
  /** The web URL that carries only the token, e.g. https://hearth.example/claims/<token>. */
  readonly claimUrl: (token: string) => string;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly tm: TransactionManager;
}
```

`src/modules/spaces/application/create-guest-claim.ts`:

```ts
import { ok, type Result } from "@/shared/kernel";
import { issueClaim } from "../domain/invitation";
import { currentGuest } from "../domain/member";
import type { CreatedInvitation } from "./create-invitation";
import type { ClaimsDeps } from "./invitation-ports";
import { toInvitationView } from "./invitation-view";
import { authorizeSpaceAction } from "./space-access";

export type CreateGuestClaim = (input: {
  spaceId: string;
  userId: string;
  memberId: string;
}) => Promise<Result<CreatedInvitation>>;

/**
 * HU-E1-11: an OWNER or ADMIN creates a claim link for a current guest: a single-use bearer link, valid
 * 7 days and not bound to the guest's contact email, so no email is sent. Allowed in direct spaces too,
 * since claiming adds no member.
 */
export const createCreateGuestClaim =
  (deps: ClaimsDeps): CreateGuestClaim =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "member.invite");
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      const guest = currentGuest(await deps.members.listCurrent(spaceId), input.memberId);
      if (!guest.ok) return guest;
      const token = deps.tokens.issue();
      const now = deps.clock.now();
      const claim = issueClaim({
        id: deps.ids.next<"Invitation">(),
        spaceId,
        guestMemberId: guest.value.id,
        tokenHash: token.hash,
        createdBy: input.userId,
        now,
      });
      await deps.invitations.add(claim);
      return ok({ invitation: toInvitationView(claim, now), url: deps.claimUrl(token.token), emailSent: false });
    });
```

Append to `src/modules/spaces/application/index.ts`:

```ts
export type { ClaimOutcome, GuestClaimRepository } from "./space-member-repository";
export type { ClaimsDeps } from "./invitation-ports";
export { createCreateGuestClaim, type CreateGuestClaim } from "./create-guest-claim";
```

- [ ] **Step 4: Run the tests to verify they pass, gates and commit 7a**

Run: `pnpm exec vitest run --project unit src/modules/spaces`
Expected: PASS.

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (the twin's `claimGuest` and `spaceKindOf` compile against `GuestClaimRepository` through `invitationsWorld().claims`).

```bash
git add src/modules/spaces/application/space-member-repository.ts src/modules/spaces/application/invitation-ports.ts src/modules/spaces/application/create-guest-claim.ts src/modules/spaces/application/index.ts src/modules/spaces/application/claims.test.ts tests/support/in-memory-spaces.ts
git commit -m "feat(spaces): create claim links for current guests (Refs #20)"
```

#### 7b — claiming a guest's place

- [ ] **Step 5: Extend the tests**

In `src/modules/spaces/application/claims.test.ts`:

1. Replace the line `import { invitationsWorld, memberOf } from "../../../../tests/support/in-memory-spaces";` with:

```ts
import {
  householdSpace,
  InMemorySpaceStore,
  invitationsWorld,
  memberOf,
} from "../../../../tests/support/in-memory-spaces";
```

2. Replace the line `import type { SpaceMember } from "../domain/space";` with:

```ts
import type { Space, SpaceId, SpaceMember } from "../domain/space";
import { createAcceptInvitation } from "./accept-invitation";
import { createClaimGuestPlace } from "./claim-guest-place";
```

3. Add after the line `import { createCreateGuestClaim } from "./create-guest-claim";`:

```ts
import { createCreateInvitation } from "./create-invitation";
import { createRevokeInvitation } from "./revoke-invitation";
import type { ClaimOutcome } from "./space-member-repository";
```

4. Replace the four lines from `const world = () => {` to the first `};` after it with:

```ts
const world = (store?: InMemorySpaceStore) => {
  const w = invitationsWorld({ members: [ANA, JUAN, PEDRO], store });
  return {
    ...w,
    createClaim: createCreateGuestClaim(w.claims),
    claim: createClaimGuestPlace(w.claims),
    accept: createAcceptInvitation(w.deps),
    revoke: createRevokeInvitation(w.deps),
  };
};
```

5. Add after the line `  unwrap(await w.createClaim({ spaceId, userId: "u-ana", memberId }));`:

```ts
const pedroOf = (w: World) => w.store.members(space).find((m) => m.id === "member-pedro");
```

6. Append to the end of the file:

```ts

describe("ClaimGuestPlace (HU-E1-11)", () => {
  it("lets a newcomer take over Pedro's place: same id and name, a registered MEMBER, the link used up", async () => {
    const w = world();
    await claimLinkFor(w);
    const claimedAt = new Date("2026-10-13T09:00:00Z");
    w.clock.set(claimedAt);
    expect(unwrap(await w.claim({ token: "token-1", userId: "u-pedro" }))).toEqual({
      id: space,
      name: "Household",
      kind: "SHARED",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
      role: "MEMBER",
    });
    expect(pedroOf(w)).toEqual({ ...PEDRO, kind: "USER", userId: "u-pedro", role: "MEMBER", contactEmail: null });
    expect(w.store.claimed).toEqual([{ spaceId: space, memberId: "member-pedro", claimedAt }]);
    expect(w.invitations.rows[0]).toMatchObject({ status: "ACCEPTED", acceptedByUserId: "u-pedro" });
    expect(w.invitations.locked).toEqual(["id-1"]);
  });

  it("refuses Juan, who is already a member, and leaves Pedro a guest", async () => {
    const w = world();
    await claimLinkFor(w);
    expect(codeOf(await w.claim({ token: "token-1", userId: "u-juan" }))).toBe("AlreadyMember");
    expect(pedroOf(w)).toEqual(PEDRO);
    expect(w.invitations.rows[0]?.status).toBe("PENDING");
  });

  it("refuses links that expired, were used or were revoked (Review Focus 2)", async () => {
    const expired = world();
    await claimLinkFor(expired);
    expired.clock.set(new Date(created.getTime() + 8 * DAY));
    expect(codeOf(await expired.claim({ token: "token-1", userId: "u-pedro" }))).toBe("InvitationExpired");

    const used = world();
    await claimLinkFor(used);
    unwrap(await used.claim({ token: "token-1", userId: "u-pedro" }));
    expect(codeOf(await used.claim({ token: "token-1", userId: "u-marta" }))).toBe("GuestAlreadyClaimed");

    const revoked = world();
    await claimLinkFor(revoked);
    unwrap(await revoked.revoke({ spaceId: space, userId: "u-ana", invitationId: "id-1" }));
    expect(codeOf(await revoked.claim({ token: "token-1", userId: "u-pedro" }))).toBe("InvitationRevoked");
    expect(pedroOf(revoked)).toEqual(PEDRO);
  });

  it("answers GuestAlreadyClaimed when another link of the same guest was used first", async () => {
    const w = world();
    await claimLinkFor(w);
    await claimLinkFor(w);
    unwrap(await w.claim({ token: "token-1", userId: "u-pedro" }));
    expect(codeOf(await w.claim({ token: "token-2", userId: "u-marta" }))).toBe("GuestAlreadyClaimed");
    expect(pedroOf(w)?.userId).toBe("u-pedro");
  });

  it("keeps invitation and claim tokens apart (Review Focus 2)", async () => {
    const w = world();
    await claimLinkFor(w);
    unwrap(
      await createCreateInvitation(w.deps)({
        spaceId: space,
        userId: "u-ana",
        role: "MEMBER",
        target: { kind: "LINK" },
      }),
    );
    expect(codeOf(await w.claim({ token: "token-2", userId: "u-pedro" }))).toBe("InvitationNotFound");
    expect(codeOf(await w.claim({ token: "token-unknown", userId: "u-pedro" }))).toBe("InvitationNotFound");
    const luis = { userId: "u-luis", userEmail: "luis@example.com", userName: "Luis" };
    expect(codeOf(await w.accept({ token: "token-1", ...luis }))).toBe("InvitationNotFound");
    expect(w.store.members(space).map((m) => m.id)).toEqual(["member-ana", "member-juan", "member-pedro"]);
    expect(pedroOf(w)).toEqual(PEDRO);
  });

  it("makes the claimer of a direct space's guest an OWNER (D16)", async () => {
    const store = new InMemorySpaceStore();
    const direct: Space = {
      ...householdSpace([ANA, PEDRO]),
      id: "space-direct" as SpaceId,
      kind: "DIRECT",
      name: "Ana & Pedro",
    };
    store.seed(direct);
    const w = world(store);
    await claimLinkFor(w, "member-pedro", "space-direct");
    expect(unwrap(await w.claim({ token: "token-1", userId: "u-pedro" })).role).toBe("OWNER");
    expect(store.members("space-direct").map((m) => [m.userId, m.role])).toEqual([
      ["u-ana", "OWNER"],
      ["u-pedro", "OWNER"],
    ]);
  });

  it("maps a claim or a join that the database decided first", async () => {
    const racing = (outcome: ClaimOutcome) =>
      new (class extends InMemorySpaceStore {
        override async claimGuest(): Promise<ClaimOutcome> {
          return outcome;
        }
      })();
    const cases = [
      ["notAGuest", "GuestAlreadyClaimed"],
      ["alreadyMember", "AlreadyMember"],
    ] as const;
    for (const [outcome, code] of cases) {
      const w = world(racing(outcome));
      await claimLinkFor(w);
      expect(codeOf(await w.claim({ token: "token-1", userId: "u-pedro" }))).toBe(code);
      expect(w.invitations.rows[0]?.status).toBe("PENDING");
    }
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/spaces/application/claims.test.ts`
Expected: FAIL — `Failed to resolve import "./claim-guest-place"`.

- [ ] **Step 7: Implement 7b**

`src/modules/spaces/application/claim-guest-place.ts`:

```ts
import { domainError, err, map, type Result } from "@/shared/kernel";
import { ensureClaimable, isClaim, markAccepted } from "../domain/invitation";
import { claimedGuest } from "../domain/member";
import type { ClaimsDeps } from "./invitation-ports";
import { toSpaceSummary } from "./space-access";
import type { SpaceSummary } from "./space-repository";

export type ClaimGuestPlace = (input: { token: string; userId: string }) => Promise<Result<SpaceSummary>>;

/**
 * HU-E1-11, D15: the signed-in user takes over the claim link's guest. The member keeps its id, so every
 * payment, share and settlement stays attached; it becomes registered (MEMBER, or OWNER in a direct
 * space, D16) and the link is used up.
 */
export const createClaimGuestPlace =
  (deps: ClaimsDeps): ClaimGuestPlace =>
  (input) =>
    deps.tm.run(async () => {
      // Locked: two uses of one link run one at a time (claim links are single-use).
      const claim = await deps.invitations.findByTokenHashForUpdate(deps.tokens.hash(input.token));
      // An invitation token is not a claim link: it never hands over a guest's place.
      if (!claim || !isClaim(claim)) return err(domainError("InvitationNotFound"));
      const now = deps.clock.now();
      const claimable = ensureClaimable(claim, now);
      if (!claimable.ok) return claimable;
      const current = await deps.members.listCurrent(claim.spaceId);
      if (current.some((m) => m.userId === input.userId)) return err(domainError("AlreadyMember"));
      const spaceKind = await deps.claims.spaceKindOf(claim.spaceId);
      // space_invitations_claim_guest: a CLAIM link always names its guest.
      const claimed = claimedGuest(current, claim.guestMemberId!, { userId: input.userId, spaceKind });
      if (!claimed.ok) return claimed;
      const outcome = await deps.claims.claimGuest(claim.spaceId, claimed.value, now);
      if (outcome === "alreadyMember") return err(domainError("AlreadyMember"));
      if (outcome === "notAGuest") return err(domainError("GuestAlreadyClaimed"));
      await deps.invitations.save(markAccepted(claim, input.userId, now));
      return map(await deps.access(claim.spaceId, input.userId), toSpaceSummary);
    });
```

In `src/modules/spaces/application/accept-invitation.ts`:

1. Replace the line `import { ensureAcceptable, markAccepted } from "../domain/invitation";` with:

```ts
import { ensureAcceptable, isClaim, markAccepted } from "../domain/invitation";
```

2. Replace the line `      if (!invitation) return err(domainError("InvitationNotFound"));` with:

```ts
      // HU-E1-11: a claim link hands over a guest's place (ClaimGuestPlace); it never adds a member.
      if (!invitation || isClaim(invitation)) return err(domainError("InvitationNotFound"));
```

Append to `src/modules/spaces/application/index.ts`:

```ts
export { createClaimGuestPlace, type ClaimGuestPlace } from "./claim-guest-place";
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/spaces`
Expected: PASS, M2-A's invitation tests included. Mutation checks: temporarily remove `|| isClaim(invitation)` from `accept-invitation.ts` — "keeps invitation and claim tokens apart" fails (Luis is added as a member); temporarily remove `|| !isClaim(claim)` from `claim-guest-place.ts` — the same test fails with `MemberNotFound` for the link token; restore both.

- [ ] **Step 9: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 10: Commit 7b**

```bash
git add src/modules/spaces/application/claim-guest-place.ts src/modules/spaces/application/accept-invitation.ts src/modules/spaces/application/index.ts src/modules/spaces/application/claims.test.ts
git commit -m "feat(spaces): let a signed-in user take over a guest's place (Refs #20)"
```

---

### Task 8: Spaces — RemoveGuestMember

Implements HU-E1-12 (issue #21) as a use case: MEMBER or above removes a guest whose balance is zero; removal is soft and revokes the guest's pending claim links. Pins Review Focus 1 and 2 at the use-case level.

Decisions:
- Order: matrix (`guest.remove`), kind of space (`ensureMembersCanChange`: personal spaces have no guests and direct spaces keep their two members), `currentGuest` (`MemberNotFound`, `NotAGuest`), balance (`OutstandingBalance` with the amount), then the writes.
- The writes revoke the guest's pending claim links first and then mark the member row left. `ClaimGuestPlace` locks the link first and the member row second, so both use cases take the two rows in the same order and cannot deadlock; a claim that commits first leaves the conditional `markLeft` with nothing to match, which answers `NotAGuest` (the guest is now registered) and rolls the revocation back.
- No lock serializes removal with a concurrent expense that names the guest (Self-Review, assumption 4); the balance still shows such a former guest, so no money is lost.
- The display name becomes free for a new member once `left_at` is set (the partial unique index of migration 0006), pinned over HTTP in Task 11.

**Files:**
- Create: `src/modules/spaces/application/remove-guest-member.ts`
- Modify: `src/modules/spaces/application/invitation-repository.ts`, `src/modules/spaces/application/index.ts`, `tests/support/in-memory-spaces.ts`
- Test: `src/modules/spaces/application/remove-guest-member.test.ts`

**Interfaces:**
- Consumes: `currentGuest`, `ensureSettled`, `outstandingIn`, `ensureMembersCanChange`, `guest.remove` (Task 1); `LifecycleDeps`, `MemberLifecycleRepository` (Task 2); `issueClaim` (Task 6); `issueInvitation` (M2-A); `InMemorySpaceStore`, `InMemoryInvitations`, `householdSpace`, `memberOf` (`tests/support/in-memory-spaces.ts`).
- Produces:
  - `interface ClaimLinkRepository { revokePendingClaims(spaceId: SpaceId, guestMemberId: SpaceMemberId, revokedAt: Date): Promise<void> }`
  - `type RemoveGuestDeps = LifecycleDeps & { invitations: ClaimLinkRepository }`
  - `type RemoveGuestMember = (input: { spaceId: string; userId: string; memberId: string }) => Promise<Result<void>>`; `createRemoveGuestMember(deps: RemoveGuestDeps)` — errors `SpaceNotFound`, `InsufficientRole`, `PersonalSpaceNotShareable`, `DirectSpaceMembersFixed`, `MemberNotFound`, `NotAGuest`, `OutstandingBalance`
  - `InMemoryInvitations.revokePendingClaims(…)`.

- [ ] **Step 1: Write the in-memory twin and the failing test**

In `tests/support/in-memory-spaces.ts`, insert before the line `  private lock(found: Invitation | undefined): Invitation | null {`:

```ts
  /** ClaimLinkRepository, like DrizzleInvitationRepository.revokePendingClaims. */
  async revokePendingClaims(spaceId: string, guestMemberId: string, revokedAt: Date) {
    this.rows = this.rows.map(
      (i): Invitation =>
        i.spaceId === spaceId && i.guestMemberId === guestMemberId && i.status === "PENDING"
          ? { ...i, status: "REVOKED", revokedAt }
          : i,
    );
  }

```

`src/modules/spaces/application/remove-guest-member.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
import { codeOf, memoryTm, unwrap } from "../../../../tests/support/fakes";
import {
  householdSpace,
  InMemoryInvitations,
  InMemorySpaceStore,
  memberOf,
} from "../../../../tests/support/in-memory-spaces";
import { issueClaim, issueInvitation, type InvitationId } from "../domain/invitation";
import { createPersonalSpace, type Space, type SpaceId, type SpaceMemberId } from "../domain/space";
import { createRemoveGuestMember, type RemoveGuestDeps } from "./remove-guest-member";
import { createSpaceAccess } from "./space-access";

const now = new Date("2026-10-14T12:00:00Z");
const space = "space-household";
const as = (name: string) => ({ spaceId: space, userId: `u-${name}` });

/** Net balances of Household by member id (minor units); any other space answers 1, never settled. */
const nets =
  (byMember: Record<string, bigint> = {}): RemoveGuestDeps["netBalance"] =>
  async (spaceId, memberId) =>
    spaceId === space ? (byMember[memberId] ?? 0n) : 1n;
const claimFor = (id: string, guestMemberId: string) =>
  issueClaim({
    id: id as InvitationId,
    spaceId: space as SpaceId,
    guestMemberId,
    tokenHash: `hash(${id})`,
    createdBy: "u-ana",
    now,
  });

// HU-E1-12 Background (HU-E1-05 members): OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi and the guest Pedro.
const setup = (
  seeded: Space = householdSpace(),
  byMember: Record<string, bigint> = {},
  store = new InMemorySpaceStore(),
) => {
  store.seed(seeded);
  const invitations = new InMemoryInvitations();
  const deps: RemoveGuestDeps = {
    access: createSpaceAccess(store),
    members: store,
    invitations,
    netBalance: nets(byMember),
    clock: new FixedClock(now),
    tm: memoryTm,
  };
  return { store, invitations, remove: createRemoveGuestMember(deps) };
};

describe("RemoveGuestMember (HU-E1-12)", () => {
  it("lets Luis remove Pedro, whose balance is zero: Pedro is no longer a current member", async () => {
    const { store, remove } = setup();
    expect(unwrap(await remove({ ...as("luis"), memberId: "member-pedro" }))).toBeUndefined();
    expect(store.members(space).map((m) => m.id)).toEqual([
      "member-ana",
      "member-juan",
      "member-luis",
      "member-sofi",
    ]);
    expect(store.left).toEqual([{ spaceId: space, memberId: "member-pedro", leftAt: now }]);
  });

  it("refuses removing Pedro while he owes Ana 100,000 COP, stating the amount (Review Focus 1)", async () => {
    const { store, remove } = setup(householdSpace(), {
      "member-ana": 10_000_000n,
      "member-pedro": -10_000_000n,
    });
    expect(await remove({ ...as("ana"), memberId: "member-pedro" })).toEqual({
      ok: false,
      error: { code: "OutstandingBalance", details: { outstanding: { amount: "10000000", currency: "COP" } } },
    });
    expect(store.left).toEqual([]);
  });

  it("refuses a viewer and never removes a registered member as a guest", async () => {
    const { store, remove } = setup();
    expect(codeOf(await remove({ ...as("sofi"), memberId: "member-pedro" }))).toBe("InsufficientRole");
    expect(codeOf(await remove({ ...as("ana"), memberId: "member-luis" }))).toBe("NotAGuest");
    expect(store.left).toEqual([]);
  });

  it("reports unknown and malformed ids as MemberNotFound and hides the space from non-members", async () => {
    const { remove } = setup();
    for (const memberId of ["member-nobody", "not-a-uuid"]) {
      expect(codeOf(await remove({ ...as("ana"), memberId }))).toBe("MemberNotFound");
    }
    expect(codeOf(await remove({ ...as("marta"), memberId: "member-pedro" }))).toBe("SpaceNotFound");
  });

  it("revokes Pedro's pending claim links and nothing else (Review Focus 2)", async () => {
    const { invitations, remove } = setup();
    const link = unwrap(
      issueInvitation({
        id: "inv-link" as InvitationId,
        spaceId: space as SpaceId,
        target: { kind: "LINK" },
        role: "MEMBER",
        tokenHash: "hash(link)",
        createdBy: "u-ana",
        now,
      }),
    );
    invitations.rows = [
      claimFor("inv-pedro-1", "member-pedro"),
      claimFor("inv-pedro-2", "member-pedro"),
      claimFor("inv-other", "member-other"),
      link,
    ];
    unwrap(await remove({ ...as("luis"), memberId: "member-pedro" }));
    expect(invitations.rows.map((i) => [i.id, i.status, i.revokedAt])).toEqual([
      ["inv-pedro-1", "REVOKED", now],
      ["inv-pedro-2", "REVOKED", now],
      ["inv-other", "PENDING", null],
      ["inv-link", "PENDING", null],
    ]);
  });

  it("refuses removals in a personal space and in a direct space (D16)", async () => {
    const personal = createPersonalSpace({
      id: "space-ana" as SpaceId,
      memberId: "member-ana-personal" as SpaceMemberId,
      ownerUserId: "u-ana",
      ownerName: "Ana",
      now,
    });
    const inPersonal = { spaceId: "space-ana", userId: "u-ana", memberId: "member-pedro" };
    expect(codeOf(await setup(personal).remove(inPersonal))).toBe("PersonalSpaceNotShareable");
    const direct: Space = {
      ...householdSpace([memberOf("Ana", "OWNER", 0), memberOf("Pedro", null, 1)]),
      kind: "DIRECT",
      name: "Ana & Pedro",
    };
    expect(codeOf(await setup(direct).remove({ ...as("ana"), memberId: "member-pedro" }))).toBe(
      "DirectSpaceMembersFixed",
    );
  });

  it("answers NotAGuest when a concurrent claim made Pedro a registered member first", async () => {
    class RacingStore extends InMemorySpaceStore {
      override async markLeft(): Promise<boolean> {
        return false;
      }
    }
    const { remove } = setup(householdSpace(), {}, new RacingStore());
    expect(codeOf(await remove({ ...as("luis"), memberId: "member-pedro" }))).toBe("NotAGuest");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/spaces/application/remove-guest-member.test.ts`
Expected: FAIL — `Failed to resolve import "./remove-guest-member"`.

- [ ] **Step 3: Implement**

In `src/modules/spaces/application/invitation-repository.ts`:

1. Add after the line `import type { Invitation } from "../domain/invitation";`:

```ts
import type { SpaceId, SpaceMemberId } from "../domain/space";
```

2. Append to the end of the file:

```ts

/** HU-E1-12: a removed guest's claim links die with the guest's place. */
export interface ClaimLinkRepository {
  /** Revokes every pending claim link of the guest; used and revoked ones keep their status. */
  revokePendingClaims(spaceId: SpaceId, guestMemberId: SpaceMemberId, revokedAt: Date): Promise<void>;
}
```

`src/modules/spaces/application/remove-guest-member.ts`:

```ts
import { domainError, err, ok, type Result } from "@/shared/kernel";
import { currentGuest, ensureSettled, outstandingIn } from "../domain/member";
import { ensureMembersCanChange } from "../domain/space";
import type { ClaimLinkRepository } from "./invitation-repository";
import type { LifecycleDeps } from "./lifecycle-deps";
import { authorizeSpaceAction } from "./space-access";

export type RemoveGuestMember = (input: {
  spaceId: string;
  userId: string;
  memberId: string;
}) => Promise<Result<void>>;

export type RemoveGuestDeps = LifecycleDeps & { readonly invitations: ClaimLinkRepository };

/**
 * HU-E1-12, D15: MEMBER or above removes a guest whose balance is zero. Removal is soft (leftAt), so
 * history keeps the guest's name; the guest's pending claim links are revoked and the name is free again.
 */
export const createRemoveGuestMember =
  (deps: RemoveGuestDeps): RemoveGuestMember =>
  (input) =>
    deps.tm.run(async () => {
      const actor = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "guest.remove");
      if (!actor.ok) return actor;
      const { spaceId, spaceKind, currency } = actor.value;
      const changeable = ensureMembersCanChange({ kind: spaceKind });
      if (!changeable.ok) return changeable;
      const guest = currentGuest(await deps.members.listCurrent(spaceId), input.memberId);
      if (!guest.ok) return guest;
      const settled = ensureSettled(outstandingIn([await deps.netBalance(spaceId, guest.value.id)]), currency);
      if (!settled.ok) return settled;
      const now = deps.clock.now();
      // Claim links first, then the member row: ClaimGuestPlace takes them in the same order, so the two
      // never deadlock, and a claim that commits first leaves the conditional markLeft nothing to match.
      await deps.invitations.revokePendingClaims(spaceId, guest.value.id, now);
      if (!(await deps.members.markLeft(spaceId, guest.value.id, "GUEST", now))) {
        return err(domainError("NotAGuest"));
      }
      return ok(undefined);
    });
```

Append to `src/modules/spaces/application/index.ts`:

```ts
export type { ClaimLinkRepository } from "./invitation-repository";
export {
  createRemoveGuestMember,
  type RemoveGuestDeps,
  type RemoveGuestMember,
} from "./remove-guest-member";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/spaces`
Expected: PASS. Mutation check: temporarily delete the `revokePendingClaims` line — "revokes Pedro's pending claim links" fails; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/application/invitation-repository.ts src/modules/spaces/application/remove-guest-member.ts src/modules/spaces/application/remove-guest-member.test.ts src/modules/spaces/application/index.ts tests/support/in-memory-spaces.ts
git commit -m "feat(spaces): remove a settled guest and revoke their claim links (Refs #21)"
```

---

### Task 9: Spaces — claims and claim revocation in PostgreSQL

Implements `GuestClaimRepository` on `DrizzleSpaceRepository` and `ClaimLinkRepository` on `DrizzleInvitationRepository` for HU-E1-11 (issue #20) and HU-E1-12 (issue #21). Pins Review Focus 2 against PostgreSQL and pins the in-memory twin of Task 7 against the adapter.

Decisions:
- `claimGuest` is one conditional `UPDATE` of the guest's row: `kind = 'GUEST' AND left_at IS NULL` (still a current guest) and `NOT EXISTS` a current row of the same user in the space (`space_members_current_user_uq` would otherwise throw). When it matches nothing, one read tells `alreadyMember` from `notAGuest`. It sets `kind`, `user_id`, `role`, `claimed_at` and clears `contact_email` in the same statement, so the `space_members_guest_*` checks hold. A user who joins the same space through a link at the very same instant can still pass both checks; the unique index then refuses the second statement (a `500` for that request, never a double membership; Self-Review, assumption 5).
- The subquery is written in SQL with the alias `c`, so it never collides with the updated table.
- `revokePendingClaims` is one `UPDATE … WHERE space_id AND guest_member_id AND status = 'PENDING'`.
- `spaceKindOf` throws for a space that does not exist: claim links reference their space (`ON DELETE cascade`), so a missing one is a broken invariant, not a client error.
- Two users claiming one link at the same moment end with exactly one member (Review Focus 5), pinned against PostgreSQL with `ClaimGuestPlace` itself. Two mechanisms stand behind it, so the test pins the outcome rather than one of them: the link's `FOR UPDATE` serializes the two claims (the second sees an `ACCEPTED` link), and without it the conditional `UPDATE` still refuses the second (`notAGuest` → `GuestAlreadyClaimed`).

**Files:**
- Modify: `src/modules/spaces/infrastructure/drizzle-space-repository.ts`, `src/modules/spaces/infrastructure/drizzle-invitation-repository.ts`
- Test: `src/modules/spaces/infrastructure/drizzle-space-members.int.test.ts`, `src/modules/spaces/infrastructure/drizzle-invitation-repository.int.test.ts`

**Interfaces:**
- Consumes: `GuestClaimRepository`, `ClaimOutcome`, `createClaimGuestPlace` (Task 7); `ClaimLinkRepository` (Task 8); `MemberLifecycleRepository.markLeft` (Task 3); `issueClaim`, `markAccepted` (Task 6); `InMemorySpaceStore` twin (Task 7); `guestMemberFixture` (`tests/support/fixtures.ts`); `FixedClock` (kernel).
- Produces: `DrizzleSpaceRepository.spaceKindOf(spaceId: SpaceId): Promise<SpaceKind>`, `DrizzleSpaceRepository.claimGuest(spaceId: SpaceId, claimed: SpaceMember, claimedAt: Date): Promise<ClaimOutcome>`, `DrizzleInvitationRepository.revokePendingClaims(spaceId: SpaceId, guestMemberId: SpaceMemberId, revokedAt: Date): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

In `src/modules/spaces/infrastructure/drizzle-space-members.int.test.ts`:

1. Replace the line `import type { MemberLifecycleRepository } from "../application/space-member-repository";` with:

```ts
import type { GuestClaimRepository, MemberLifecycleRepository } from "../application/space-member-repository";
```

2. Append to the end of the file:

```ts

describe("claiming guest places (HU-E1-11, Review Focus 2)", () => {
  const claims: GuestClaimRepository = repo;
  const at = new Date("2026-10-14T12:00:00Z");
  const claimedBy = (pedro: SpaceMember, userId: string, role: SpaceRole = "MEMBER"): SpaceMember => ({
    ...pedro,
    kind: "USER",
    userId,
    role,
    contactEmail: null,
  });

  it("turns the current guest into the registered member, same id, and records claimedAt", async () => {
    const pedroUser = await newUser("Pedro");
    const space = await household(await newUser("Ana"));
    const pedro = guest("Pedro", "pedro@example.com");
    await repo.addMember(space.id, pedro);
    expect(await claims.claimGuest(space.id, claimedBy(pedro, pedroUser), at)).toBe("claimed");
    expect(await repo.listCurrent(space.id)).toEqual([...space.members, claimedBy(pedro, pedroUser)]);
    const { rows } = await pool.query("SELECT claimed_at FROM space_members WHERE id = $1", [pedro.id]);
    expect(rows[0].claimed_at).toEqual(at);
    expect(await claims.spaceKindOf(space.id)).toBe("SHARED");
  });

  it("answers notAGuest for removed, claimed or malformed guests and alreadyMember for a current user", async () => {
    const ana = await newUser("Ana");
    const juan = await newUser("Juan");
    const pedroUser = await newUser("Pedro");
    const space = await household(ana);
    const pedro = guest("Pedro");
    const removed = guest("Removed");
    await repo.addMember(space.id, pedro);
    await repo.addMember(space.id, removed);
    await repo.markLeft(space.id, removed.id, "GUEST", at);
    expect(await claims.claimGuest(space.id, claimedBy(removed, pedroUser), at)).toBe("notAGuest");
    expect(await claims.claimGuest(space.id, claimedBy(pedro, ana), at)).toBe("alreadyMember");
    expect(await claims.claimGuest(space.id, claimedBy(pedro, pedroUser), at)).toBe("claimed");
    expect(await claims.claimGuest(space.id, claimedBy(pedro, juan), at)).toBe("notAGuest");
    const malformed = { ...claimedBy(pedro, juan), id: "not-a-uuid" as SpaceMemberId };
    expect(await claims.claimGuest(space.id, malformed, at)).toBe("notAGuest");
    expect((await repo.listCurrent(space.id)).map((m) => [m.displayName, m.userId])).toEqual([
      ["Ana", ana],
      ["Pedro", pedroUser],
    ]);
  });

  it("gives the outcomes of the in-memory twin the use-case tests rely on", async () => {
    const ana = await newUser("Ana");
    const pedroUser = await newUser("Pedro");
    const space = await household(ana);
    const pedro = guest("Pedro");
    await repo.addMember(space.id, pedro);
    const twin = new InMemorySpaceStore();
    twin.seed({ ...space, members: [...space.members, pedro] });
    const steps = async (store: GuestClaimRepository) => [
      await store.claimGuest(space.id, claimedBy(pedro, ana), at),
      await store.claimGuest(space.id, claimedBy(pedro, pedroUser), at),
      await store.claimGuest(space.id, claimedBy(pedro, pedroUser), at),
    ];
    const outcomes = await steps(claims);
    expect(outcomes).toEqual(["alreadyMember", "claimed", "alreadyMember"]);
    expect(await steps(twin)).toEqual(outcomes);
  });
});
```

In `src/modules/spaces/infrastructure/drizzle-invitation-repository.int.test.ts`:

1. Replace the line `import { sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";` with:

```ts
import { guestMemberFixture, sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";
```

2. Add after the line `import { createAcceptInvitation } from "../application/accept-invitation";`:

```ts
import { createClaimGuestPlace } from "../application/claim-guest-place";
import type { ClaimLinkRepository } from "../application/invitation-repository";
```

3. Replace the line `import type { Result } from "@/shared/kernel";` with:

```ts
import { FixedClock, type Result } from "@/shared/kernel";
```

4. Replace the line `import { issueInvitation, type InvitationId, type InvitationTarget } from "../domain/invitation";` with:

```ts
import {
  issueClaim,
  issueInvitation,
  markAccepted,
  type InvitationId,
  type InvitationTarget,
} from "../domain/invitation";
```

5. Replace the line `import type { Space } from "../domain/space";` with:

```ts
import type { Space, SpaceMemberId } from "../domain/space";
```

6. Append to the end of the file:

```ts

describe("claim links in PostgreSQL (HU-E1-11, HU-E1-12)", () => {
  const links: ClaimLinkRepository = repo;
  const guestOf = (space: Space, ownerId: string, name: string) =>
    guestMemberFixture(pool, { userId: ownerId, spaceId: space.id, memberId: space.members[0]!.id }, name);
  const claimFor = async (space: Space, createdBy: string, guestMemberId: string) => {
    const { token, hash } = cryptoInvitationTokens.issue();
    const claim = issueClaim({
      id: randomUUID() as InvitationId,
      spaceId: space.id,
      guestMemberId,
      tokenHash: hash,
      createdBy,
      now: new Date("2026-10-14T12:00:00Z"),
    });
    await repo.add(claim);
    return { token, claim };
  };
  const statusOf = async (id: string) =>
    (await pool.query("SELECT status, revoked_at FROM space_invitations WHERE id = $1", [id])).rows[0];

  it("stores a claim link with its guest and finds it by its token hash", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana.id);
    const { token, claim } = await claimFor(space, ana.id, await guestOf(space, ana.id, "Pedro"));
    expect(await repo.findByTokenHashForUpdate(cryptoInvitationTokens.hash(token))).toEqual(claim);
  });

  it("revokes only the pending claim links of the guest", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana.id);
    const pedro = await guestOf(space, ana.id, "Pedro");
    const luis = await guestOf(space, ana.id, "Luis");
    const pending = await claimFor(space, ana.id, pedro);
    const used = await claimFor(space, ana.id, pedro);
    await repo.save(markAccepted(used.claim, ana.id, new Date()));
    const other = await claimFor(space, ana.id, luis);
    const { invitation: link } = await invite(space, ana.id, { kind: "LINK" });
    const at = new Date("2026-10-15T12:00:00Z");
    await links.revokePendingClaims(space.id, pedro as SpaceMemberId, at);
    expect(await statusOf(pending.claim.id)).toEqual({ status: "REVOKED", revoked_at: at });
    expect(await statusOf(used.claim.id)).toEqual({ status: "ACCEPTED", revoked_at: null });
    expect(await statusOf(other.claim.id)).toEqual({ status: "PENDING", revoked_at: null });
    expect(await statusOf(link.id)).toEqual({ status: "PENDING", revoked_at: null });
  });

  it("lets exactly one of two simultaneous claims of one link through (Review Focus 5)", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana.id);
    const pedro = await guestOf(space, ana.id, "Pedro");
    const { token } = await claimFor(space, ana.id, pedro);
    const claim = createClaimGuestPlace({
      access: createSpaceAccess(spaces),
      members: spaces,
      claims: spaces,
      invitations: repo,
      tokens: cryptoInvitationTokens,
      claimUrl: (t) => t,
      ids: new UuidV7IdGenerator(),
      // An hour after claimFor issued the link, so it is valid whatever day the suite runs.
      clock: new FixedClock(new Date("2026-10-14T13:00:00Z")),
      tm,
    });
    const first = await newUser("Pedro");
    const second = await newUser("Marta");
    const results = await Promise.all([claim({ token, userId: first.id }), claim({ token, userId: second.id })]);
    expect(results.map((r) => (r.ok ? "ok" : r.error.code)).sort()).toEqual(["GuestAlreadyClaimed", "ok"]);
    const { rows } = await pool.query("SELECT kind, user_id FROM space_members WHERE id = $1", [pedro]);
    expect(rows[0].kind).toBe("USER");
    expect([first.id, second.id]).toContain(rows[0].user_id);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project integration src/modules/spaces/infrastructure/drizzle-space-members.int.test.ts src/modules/spaces/infrastructure/drizzle-invitation-repository.int.test.ts`
Expected: FAIL — `claims.claimGuest is not a function` and `links.revokePendingClaims is not a function` (the simultaneous claims fail on `spaceKindOf`); "stores a claim link with its guest" already passes (Task 5 writes `guest_member_id`).

- [ ] **Step 3: Implement**

In `src/modules/spaces/infrastructure/drizzle-space-repository.ts`:

1. Replace the line `import { and, asc, eq, isNull } from "drizzle-orm";` with:

```ts
import { and, asc, eq, isNull, sql } from "drizzle-orm";
```

2. Replace the line `import type { AddMemberOutcome, SpaceMemberRepository } from "../application/space-member-repository";` with:

```ts
import type {
  AddMemberOutcome,
  ClaimOutcome,
  SpaceMemberRepository,
} from "../application/space-member-repository";
```

3. Replace the line `import type { Space, SpaceId, SpaceMember, SpaceMemberId, SpaceRole } from "../domain/space";` with:

```ts
import type { Space, SpaceId, SpaceKind, SpaceMember, SpaceMemberId, SpaceRole } from "../domain/space";
```

4. Insert before the last line of the file (`}`):

```ts

  async spaceKindOf(spaceId: SpaceId): Promise<SpaceKind> {
    const [row] = await this.tm
      .executor()
      .select({ kind: spaces.kind })
      .from(spaces)
      .where(eq(spaces.id, spaceId));
    // Claim links reference their space (ON DELETE cascade), so a missing one is a broken invariant.
    if (!row) throw new Error(`space ${spaceId} does not exist`);
    return row.kind;
  }

  async claimGuest(spaceId: SpaceId, claimed: SpaceMember, claimedAt: Date): Promise<ClaimOutcome> {
    if (!isUuid(claimed.id)) return "notAGuest";
    const rows = await this.tm
      .executor()
      .update(spaceMembers)
      .set({ kind: "USER", userId: claimed.userId, role: claimed.role, contactEmail: null, claimedAt })
      .where(
        and(
          eq(spaceMembers.spaceId, spaceId),
          eq(spaceMembers.id, claimed.id),
          // Still a current guest: not removed and not claimed meanwhile.
          eq(spaceMembers.kind, "GUEST"),
          isNull(spaceMembers.leftAt),
          // space_members_current_user_uq: the user is not a current member of the space yet.
          sql`NOT EXISTS (SELECT 1 FROM space_members c WHERE c.space_id = ${spaceId} AND c.user_id = ${claimed.userId} AND c.left_at IS NULL)`,
        ),
      )
      .returning({ id: spaceMembers.id });
    if (rows.length > 0) return "claimed";
    const current = await this.listCurrent(spaceId);
    return current.some((m) => m.userId === claimed.userId) ? "alreadyMember" : "notAGuest";
  }
```

In `src/modules/spaces/infrastructure/drizzle-invitation-repository.ts`:

1. Replace the line `import type { SpaceId } from "../domain/space";` with:

```ts
import type { SpaceId, SpaceMemberId } from "../domain/space";
```

2. Insert before the last line of the file (`}`):

```ts

  async revokePendingClaims(spaceId: SpaceId, guestMemberId: SpaceMemberId, revokedAt: Date): Promise<void> {
    await this.tm
      .executor()
      .update(spaceInvitations)
      .set({ status: "REVOKED", revokedAt })
      .where(
        and(
          eq(spaceInvitations.spaceId, spaceId),
          eq(spaceInvitations.guestMemberId, guestMemberId),
          eq(spaceInvitations.status, "PENDING"),
        ),
      );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project integration src/modules/spaces/infrastructure`
Expected: PASS. Mutation checks: temporarily delete `eq(spaceMembers.kind, "GUEST"),` — "answers notAGuest … claimed" fails (Juan takes over the claimed Pedro); temporarily delete the `NOT EXISTS` condition — the same test throws a unique violation on `space_members_current_user_uq` for Ana; restore both.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/infrastructure/drizzle-space-repository.ts src/modules/spaces/infrastructure/drizzle-invitation-repository.ts src/modules/spaces/infrastructure/drizzle-space-members.int.test.ts src/modules/spaces/infrastructure/drizzle-invitation-repository.int.test.ts
git commit -m "feat(spaces): claim guest places and revoke claim links in PostgreSQL (Refs #20, Refs #21)"
```

---

### Task 10: HTTP — claim links and claiming a guest place

Exposes HU-E1-11 (issue #20): `POST /api/v1/spaces/{spaceId}/guests/{memberId}/claim-links` → `201` with the `CreatedInvitation` shape, and `POST /api/v1/claims/{token}/accept` → `200 Space`. Pins Review Focus 2 over HTTP. Size ~560 lines: commit it as **10a** (the claim-link route, the container wiring of both use cases, the `claimLink` helper, the first `describe` block and its snapshot) and **10b** (the accept route, the second `describe` block, including the `@critical` scenario, and its snapshot), each green and with its own RDD pass.

Decisions:
- The claim-link response reuses the inline `CreatedInvitationSchema` (`invitation` with kind `CLAIM`, `url`, `emailSent: false`), so no new component appears. Revoking a claim link is M2-A's `POST …/invitations/{invitationId}/revoke`, unchanged (the HU-E1-06 permission covers both, M2-A matrix comment).
- The accept route mirrors `POST /api/v1/invitations/{token}/accept`: authenticated, the token in the path, the joined space in the body. Signing up through a claim link is two calls (sign-up, then accept), like invitations (HU-E1-07, M2-A); the redirect is web UI (HU-E9-05).
- The composition root builds one `DrizzleInvitationRepository` for invitations, claim links and (Task 11) claim revocation; `claimUrl` is `<BETTER_AUTH_URL>/claims/<token>`, like the invitation URL.
- HU-E1-11's "the unified view of Pedro includes his 100,000 COP Hotel share" becomes testable in M4 (HU-E7-04, backlog technical note); until then the `@critical` test reads Pedro's share through the ledger's participant filter. `claimedAt` is not part of the member DTO, so it is read with SQL.

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/guests/[memberId]/claim-links/route.ts` (10a), `src/app/api/v1/claims/[token]/accept/route.ts` (10b)
- Modify: `src/modules/spaces/contracts/spaces.contract.ts` (10a, 10b), `src/composition/container.ts` (10a), `src/shared/http/problem.test.ts` (10a), `tests/support/spaces.ts` (10a), `openapi/openapi.snapshot.json` (10a, 10b)
- Test: `tests/acceptance/guest-claims.test.ts` (10a creates it, 10b extends it)

**Interfaces:**
- Consumes: `createCreateGuestClaim`, `createClaimGuestPlace`, `CreateGuestClaim`, `ClaimGuestPlace`, `ClaimsDeps` (Task 7); `DrizzleSpaceRepository.claimGuest`, `spaceKindOf` (Task 9); `createdInvitationDto`, `CreatedInvitationSchema`, `SpaceSummarySchema`, `MemberPath` (M2-A contract); `tokenOf`, `inviteByLink`, `newSharedSpace` (`tests/support/spaces.ts`); `household`, `addGuest`, `post`, `cop`, `balancesOf`, `TransactionDto` (`tests/support/ledger.ts`).
- Produces: the two routes; `Container.spaces.createGuestClaim`, `Container.spaces.claimGuestPlace`; the composition-root constant `invitationRepository` (reused by Task 11); `tests/support/spaces.ts`: `claimLink(owner: TestUser, spaceId: string, guestId: string): Promise<{ id: string; token: string }>`.

#### 10a — claim links

- [ ] **Step 1: Write the failing acceptance test**

In `tests/support/spaces.ts`:

1. Add after the line `import { POST as createInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/route";`:

```ts
import { POST as createClaimLink } from "@/app/api/v1/spaces/[spaceId]/guests/[memberId]/claim-links/route";
```

2. Append to the end of the file:

```ts

/** HU-E1-11: `owner` creates a claim link for the guest `guestId` over HTTP; returns its id and token. */
export const claimLink = async (
  owner: TestUser,
  spaceId: string,
  guestId: string,
): Promise<{ id: string; token: string }> => {
  const response = await call(createClaimLink, "POST", `/api/v1/spaces/${spaceId}/guests/${guestId}/claim-links`, {
    user: owner,
    params: { spaceId, memberId: guestId },
  });
  if (response.status !== 201) throw new Error(`claim link failed with status ${response.status}`);
  const { invitation, url } = (await response.json()) as { invitation: { id: string }; url: string };
  return { id: invitation.id, token: tokenOf(url) };
};
```

`tests/acceptance/guest-claims.test.ts`:

```ts
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createClaimLink } from "@/app/api/v1/spaces/[spaceId]/guests/[memberId]/claim-links/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { addGuest, household } from "../support/ledger";
import { tokenOf } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const createLink = (user: TestUser, spaceId: string, memberId: string) =>
  call(createClaimLink, "POST", `/api/v1/spaces/${spaceId}/guests/${memberId}/claim-links`, {
    user,
    params: { spaceId, memberId },
  });

describe("claim links (HU-E1-11)", () => {
  it("creates a pending claim link for the guest Pedro whose URL carries only a token, stored hashed", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    const response = await createLink(h.ana, h.spaceId, pedro);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { invitation: { id: string }; url: string };
    expect(body).toEqual({
      invitation: {
        id: expect.any(String),
        spaceId: h.spaceId,
        kind: "CLAIM",
        email: null,
        role: "MEMBER",
        status: "PENDING",
        createdAt: expect.any(String),
        expiresAt: expect.any(String),
      },
      url: expect.stringMatching(/^http:\/\/localhost:3000\/claims\/[A-Za-z0-9_-]{43}$/),
      emailSent: false,
    });
    const { rows } = await app.pool.query(
      "SELECT token_hash, guest_member_id FROM space_invitations WHERE id = $1",
      [body.invitation.id],
    );
    expect(rows[0]).toEqual({
      token_hash: createHash("sha256").update(tokenOf(body.url)).digest("hex"),
      guest_member_id: pedro,
    });
  });

  it("refuses Juan, a MEMBER, and hides the space from non-members", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    expect(await problemOf(await createLink(h.juan, h.spaceId, pedro))).toEqual([403, "InsufficientRole"]);
    const marta = await registerUser("Marta");
    expect(await problemOf(await createLink(marta, h.spaceId, pedro))).toEqual([404, "SpaceNotFound"]);
  });

  it("creates claim links only for current guests", async () => {
    const h = await household();
    expect(await problemOf(await createLink(h.ana, h.spaceId, h.juan.memberId))).toEqual([409, "NotAGuest"]);
    for (const memberId of ["0190a0b0-0000-7000-8000-000000000000", "not-a-uuid"]) {
      expect(await problemOf(await createLink(h.ana, h.spaceId, memberId))).toEqual([404, "MemberNotFound"]);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/guest-claims.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/guests/[memberId]/claim-links/route"`.

- [ ] **Step 3: Contract, route and wiring**

In `src/modules/spaces/contracts/spaces.contract.ts`, insert before the last line of the file (`};`):

```ts
  "/api/v1/spaces/{spaceId}/guests/{memberId}/claim-links": {
    post: {
      operationId: "createGuestClaimLink",
      summary: "Create a single-use link with which someone takes over a guest's place by signing in",
      ...securedByUser,
      requestParams: { path: MemberPath },
      responses: {
        "201": {
          description: "The pending claim link and its URL, valid 7 days; no email is sent",
          content: jsonContent(CreatedInvitationSchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound, MemberNotFound",
          "409": "NotAGuest",
        }),
      },
    },
  },
```

`src/app/api/v1/spaces/[spaceId]/guests/[memberId]/claim-links/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { createdInvitationDto } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.createGuestClaim({
      spaceId: params.spaceId!,
      userId: user!.id,
      memberId: params.memberId!,
    });
    return result.ok ? ok({ status: 201, body: createdInvitationDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Add after the line `  createUpdateSpaceSettings,`:

```ts
  createClaimGuestPlace,
  createCreateGuestClaim,
```

2. Add after the line `  type UpdateSpaceSettings,`:

```ts
  type ClaimGuestPlace,
  type ClaimsDeps,
  type CreateGuestClaim,
```

3. Add after the line `    readonly changeMemberRole: ChangeMemberRole;`:

```ts
    readonly createGuestClaim: CreateGuestClaim;
    readonly claimGuestPlace: ClaimGuestPlace;
```

4. Insert before the line `  const invitationsDeps: InvitationsDeps = {`:

```ts
  const invitationRepository = new DrizzleInvitationRepository(tm);
```

5. Replace the line `    invitations: new DrizzleInvitationRepository(tm),` with:

```ts
    invitations: invitationRepository,
```

6. Insert before the line `  // HU-E1-02: every new user gets a personal space; sign-up compensates if this fails.`:

```ts
  // HU-E1-11: claim links share the invitation store and tokens; the URL carries only the token.
  const claimsDeps: ClaimsDeps = {
    access,
    members: spaceRepository,
    claims: spaceRepository,
    invitations: invitationRepository,
    tokens: cryptoInvitationTokens,
    claimUrl: (token) => new URL(`/claims/${token}`, env.BETTER_AUTH_URL).toString(),
    ids,
    clock,
    tm,
  };
```

7. Add after the line `      changeMemberRole: createChangeMemberRole(membersDeps),`:

```ts
      createGuestClaim: createCreateGuestClaim(claimsDeps),
      claimGuestPlace: createClaimGuestPlace(claimsDeps),
```

In `src/shared/http/problem.test.ts`, add after the line `    ["GuestHasNoRole", 409],`:

```ts
    ["NotAGuest", 409],
    ["GuestAlreadyClaimed", 409],
```

- [ ] **Step 4: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/guest-claims.test.ts && pnpm exec vitest run --project unit src/shared/http`
Expected: PASS.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `POST /api/v1/spaces/{spaceId}/guests/{memberId}/claim-links` (about 80 lines); components are unchanged.

- [ ] **Step 5: Gates and commit 10a**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (`tsc` checks `DrizzleSpaceRepository` against `GuestClaimRepository` where `claimsDeps` binds it).

```bash
git add "src/app/api/v1/spaces/[spaceId]/guests/[memberId]/claim-links/route.ts" src/modules/spaces/contracts/spaces.contract.ts src/composition/container.ts src/shared/http/problem.test.ts tests/support/spaces.ts tests/acceptance/guest-claims.test.ts openapi/openapi.snapshot.json
git commit -m "feat(spaces): expose claim links for guests over HTTP (Refs #20)"
```

#### 10b — claiming a guest place

- [ ] **Step 6: Extend the acceptance test**

In `tests/acceptance/guest-claims.test.ts`:

1. Add after the line `import { afterAll, beforeAll, describe, expect, it } from "vitest";`:

```ts
import { POST as acceptClaim } from "@/app/api/v1/claims/[token]/accept/route";
import { POST as acceptInvitation } from "@/app/api/v1/invitations/[token]/accept/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as addGuestMember } from "@/app/api/v1/spaces/[spaceId]/guests/route";
import { POST as revokeInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/[invitationId]/revoke/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import { GET as listSpaces } from "@/app/api/v1/spaces/route";
```

2. Replace the line `import { addGuest, household } from "../support/ledger";` with:

```ts
import { addGuest, balancesOf, cop, household, post, type TransactionDto } from "../support/ledger";
```

3. Replace the line `import { tokenOf } from "../support/spaces";` with:

```ts
import { claimLink, inviteByLink, newSharedSpace, tokenOf } from "../support/spaces";
```

4. Append to the end of the file:

```ts

interface MemberDto {
  id: string;
  kind: string;
  userId: string | null;
  displayName: string;
  role: string | null;
  contactEmail: string | null;
  joinedAt: string;
}
const claim = (user: TestUser, token: string) =>
  call(acceptClaim, "POST", `/api/v1/claims/${token}/accept`, { user, params: { token } });
const membersOf = async (user: TestUser, spaceId: string): Promise<MemberDto[]> => {
  const response = await call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, {
    user,
    params: { spaceId },
  });
  return ((await response.json()) as { items: MemberDto[] }).items;
};
const memberIn = async (user: TestUser, spaceId: string, memberId: string) =>
  (await membersOf(user, spaceId)).find((m) => m.id === memberId);

/**
 * HU-E1-11 Background: Household with OWNER Ana, MEMBER Juan and the guest Pedro; Ana recorded on
 * 2026-10-08 a 300,000 COP "Hotel" paid by Pedro, split EQUAL among the three, and a claim link for Pedro.
 */
const claimBackground = async () => {
  const h = await household();
  const pedro = await addGuest(h, "Pedro");
  const hotel = await post(recordExpense, h.ana, "expenses", {
    description: "Hotel",
    date: "2026-10-08",
    categoryId: h.groceries,
    amount: cop(300_000),
    payments: [{ memberId: pedro, accountId: null, amount: cop(300_000) }],
    split: {
      method: "EQUAL",
      participants: [h.ana.memberId, h.juan.memberId, pedro].map((memberId) => ({ memberId })),
    },
  });
  if (hotel.status !== 201) throw new Error(`hotel failed with status ${hotel.status}`);
  return { h, pedro, hotel: (await hotel.json()) as TransactionDto, link: await claimLink(h.ana, h.spaceId, pedro) };
};

describe("claim a guest place (HU-E1-11)", () => {
  it("lets a newcomer register and claim Pedro's place, keeping his history (@critical)", async () => {
    const { h, pedro, hotel, link } = await claimBackground();
    const pedroUser = await registerUser("Pedro");
    const response = await claim(pedroUser, link.token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: h.spaceId,
      name: "Household",
      kind: "SHARED",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
      role: "MEMBER",
    });
    expect(await memberIn(h.ana, h.spaceId, pedro)).toEqual({
      id: pedro,
      kind: "USER",
      userId: pedroUser.userId,
      displayName: "Pedro",
      role: "MEMBER",
      contactEmail: null,
      joinedAt: expect.any(String),
    });
    const { rows } = await app.pool.query("SELECT claimed_at FROM space_members WHERE id = $1", [pedro]);
    expect(rows[0].claimed_at).toBeInstanceOf(Date);
    // The unified view is HU-E7-04 (M4); until then Pedro's share is read through the ledger.
    const path = `/api/v1/spaces/${h.spaceId}/transactions?period=2026-10&participantMemberId=${pedro}`;
    const listed = await call(listTransactions, "GET", path, { user: pedroUser, params: { spaceId: h.spaceId } });
    const { items } = (await listed.json()) as { items: TransactionDto[] };
    expect(items.map((t) => t.id)).toEqual([hotel.id]);
    expect(items[0]).toMatchObject({
      payments: [{ memberId: pedro, accountId: null, amount: cop(300_000) }],
      shares: [
        { memberId: h.ana.memberId, amount: cop(100_000) },
        { memberId: h.juan.memberId, amount: cop(100_000) },
        { memberId: pedro, amount: cop(100_000) },
      ],
    });
    // Ana owes Pedro 100,000 COP and Juan owes Pedro 100,000 COP.
    expect(await balancesOf(pedroUser, h.spaceId)).toEqual([
      [h.ana.memberId, cop(-100_000)],
      [h.juan.memberId, cop(-100_000)],
      [pedro, cop(200_000)],
    ]);
  });

  it("links an account that already has spaces of its own, which keeps exactly one personal space", async () => {
    const { h, pedro, link } = await claimBackground();
    // Pedro signed up long before and already owns a shared space of his own.
    const pedroUser = await registerUser("Pedro");
    const pedrosTrip = await newSharedSpace(pedroUser, "Pedro's trip");
    expect((await claim(pedroUser, link.token)).status).toBe(200);
    expect((await memberIn(h.ana, h.spaceId, pedro))?.userId).toBe(pedroUser.userId);
    const listed = await call(listSpaces, "GET", "/api/v1/spaces", { user: pedroUser });
    const { items } = (await listed.json()) as { items: { id: string; kind: string }[] };
    expect(items.filter((s) => s.kind === "PERSONAL")).toHaveLength(1);
    expect(items.map((s) => s.id).sort()).toEqual([h.spaceId, pedroUser.spaceId, pedrosTrip].sort());
  });

  it("refuses Juan, who is already a member, and leaves Pedro a guest", async () => {
    const { h, pedro, link } = await claimBackground();
    expect(await problemOf(await claim(h.juan, link.token))).toEqual([409, "AlreadyMember"]);
    expect(await memberIn(h.ana, h.spaceId, pedro)).toMatchObject({ kind: "GUEST", userId: null, role: null });
  });

  it("refuses links that expired, were used or were revoked (Review Focus 2)", async () => {
    const expired = await claimBackground();
    await app.pool.query(
      "UPDATE space_invitations SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = $1",
      [expired.link.id],
    );
    expect(await problemOf(await claim(await registerUser("Pedro"), expired.link.token))).toEqual([
      409,
      "InvitationExpired",
    ]);

    const used = await claimBackground();
    expect((await claim(await registerUser("Pedro"), used.link.token)).status).toBe(200);
    expect(await problemOf(await claim(await registerUser("Marta"), used.link.token))).toEqual([
      409,
      "GuestAlreadyClaimed",
    ]);

    const revoked = await claimBackground();
    const { spaceId } = revoked.h;
    const revocation = await call(
      revokeInvitation,
      "POST",
      `/api/v1/spaces/${spaceId}/invitations/${revoked.link.id}/revoke`,
      { user: revoked.h.ana, params: { spaceId, invitationId: revoked.link.id } },
    );
    expect(revocation.status).toBe(200);
    expect(await problemOf(await claim(await registerUser("Pedro"), revoked.link.token))).toEqual([
      409,
      "InvitationRevoked",
    ]);
  });

  it("claims only in its own space: the guest Pedro of Trip 2026 stays a guest (Review Focus 2)", async () => {
    const { h, link } = await claimBackground();
    const trip = await newSharedSpace(h.ana, "Trip 2026");
    const added = await call(addGuestMember, "POST", `/api/v1/spaces/${trip}/guests`, {
      user: h.ana,
      params: { spaceId: trip },
      body: { displayName: "Pedro" },
    });
    const tripPedro = ((await added.json()) as { id: string }).id;
    const pedroUser = await registerUser("Pedro");
    expect((await claim(pedroUser, link.token)).status).toBe(200);
    expect(await memberIn(h.ana, trip, tripPedro)).toMatchObject({ kind: "GUEST", userId: null });
    const tripPath = `/api/v1/spaces/${trip}/transactions?period=2026-10`;
    const tripMoney = await call(listTransactions, "GET", tripPath, { user: pedroUser, params: { spaceId: trip } });
    expect(await problemOf(tripMoney)).toEqual([404, "SpaceNotFound"]);
  });

  it("keeps invitation and claim tokens apart and answers unknown tokens with 404 (Review Focus 2)", async () => {
    const { h, pedro, link } = await claimBackground();
    const luis = await registerUser("Luis");
    const asInvitation = await call(acceptInvitation, "POST", `/api/v1/invitations/${link.token}/accept`, {
      user: luis,
      params: { token: link.token },
    });
    expect(await problemOf(asInvitation)).toEqual([404, "InvitationNotFound"]);
    const invitationToken = await inviteByLink(h.ana, h.spaceId, "MEMBER");
    expect(await problemOf(await claim(luis, invitationToken))).toEqual([404, "InvitationNotFound"]);
    expect(await problemOf(await claim(luis, "no-such-token"))).toEqual([404, "InvitationNotFound"]);
    expect(await memberIn(h.ana, h.spaceId, pedro)).toMatchObject({ kind: "GUEST" });
    expect((await membersOf(h.ana, h.spaceId)).map((m) => m.displayName)).toEqual(["Ana", "Juan", "Pedro"]);
  });

  it("requires a signed-in user", async () => {
    const { link } = await claimBackground();
    const anonymous = await call(acceptClaim, "POST", `/api/v1/claims/${link.token}/accept`, {
      params: { token: link.token },
    });
    expect(await problemOf(anonymous)).toEqual([401, "Unauthenticated"]);
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/guest-claims.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/claims/[token]/accept/route"`.

- [ ] **Step 8: Contract and route**

In `src/modules/spaces/contracts/spaces.contract.ts`, insert before the last line of the file (`};`):

```ts
  "/api/v1/claims/{token}/accept": {
    post: {
      operationId: "claimGuestPlace",
      summary: "Take over the claim link's guest as the signed-in user: the same member, now registered",
      ...securedByUser,
      requestParams: { path: z.object({ token: z.string() }) },
      responses: {
        "200": {
          description: "The space, as the new registered member sees it",
          content: jsonContent(SpaceSummarySchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "404": "InvitationNotFound, MemberNotFound",
          "409": "InvitationExpired, InvitationRevoked, GuestAlreadyClaimed, AlreadyMember",
        }),
      },
    },
  },
```

`src/app/api/v1/claims/[token]/accept/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.claimGuestPlace({ token: params.token!, userId: user!.id });
    return result.ok ? ok({ status: 200, body: result.value }) : result;
  },
});
```

- [ ] **Step 9: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/guest-claims.test.ts`
Expected: PASS.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `POST /api/v1/claims/{token}/accept` (about 75 lines); components are unchanged.

- [ ] **Step 10: Gates and commit 10b**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

```bash
git add "src/app/api/v1/claims/[token]/accept/route.ts" src/modules/spaces/contracts/spaces.contract.ts tests/acceptance/guest-claims.test.ts openapi/openapi.snapshot.json
git commit -m "feat(spaces): let a signed-in user claim a guest place over HTTP (Refs #20)"
```

---

### Task 11: HTTP — remove a guest

Exposes HU-E1-12 (issue #21): `DELETE /api/v1/spaces/{spaceId}/guests/{memberId}` → `204` (soft removal). Pins Review Focus 1 and 2 over HTTP: the outstanding amount, history kept, the freed name, and the revoked claim links.

Decisions:
- `DELETE` on the guest resource, as the backlog's technical note names it; the answer has no body.
- HU-E1-12's "the Hotel expense is still returned with Pedro of kind GUEST and a share of 100,000 COP" is read in two parts: the transaction still lists Pedro's share by member id (over HTTP), and the member row is still a `GUEST` named Pedro, now with `left_at` (with SQL, because `GET …/members` lists current members only and no endpoint lists former ones; Self-Review, contradiction 2).

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/guests/[memberId]/route.ts`
- Modify: `src/modules/spaces/contracts/spaces.contract.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`
- Test: `tests/acceptance/remove-guest.test.ts`

**Interfaces:**
- Consumes: `createRemoveGuestMember`, `RemoveGuestMember` (Task 8); `DrizzleInvitationRepository.revokePendingClaims` (Task 9); `lifecycleDeps` (Task 4), `invitationRepository` (Task 10); `claimLink` (Task 10); `paysEqually`, `settles` (Task 4); `household`, `joinHousehold`, `addGuest`, `cop`, `post`, `TransactionDto` (`tests/support/ledger.ts`).
- Produces: `DELETE /api/v1/spaces/{spaceId}/guests/{memberId}`; `Container.spaces.removeGuest`.

- [ ] **Step 1: Write the failing acceptance test**

`tests/acceptance/remove-guest.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as acceptClaim } from "@/app/api/v1/claims/[token]/accept/route";
import { DELETE as removeGuestMember } from "@/app/api/v1/spaces/[spaceId]/guests/[memberId]/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { GET as getTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  addGuest,
  cop,
  household,
  joinHousehold,
  paysEqually,
  settles,
  type Household,
  type HouseholdMember,
  type TransactionDto,
} from "../support/ledger";
import { claimLink } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface Background {
  readonly h: Household;
  readonly luis: HouseholdMember;
  readonly sofi: HouseholdMember;
  readonly pedro: string;
}
/** HU-E1-12 Background: Household with OWNER Ana, MEMBER Luis, VIEWER Sofi and the guest Pedro (and MEMBER Juan). */
const background = async (): Promise<Background> => {
  const h = await household();
  const luis = await joinHousehold(h, "Luis", "MEMBER");
  const sofi = await joinHousehold(h, "Sofi", "VIEWER");
  return { h, luis, sofi, pedro: await addGuest(h, "Pedro") };
};
const remove = (user: TestUser, spaceId: string, memberId: string) =>
  call(removeGuestMember, "DELETE", `/api/v1/spaces/${spaceId}/guests/${memberId}`, {
    user,
    params: { spaceId, memberId },
  });
const memberRow = async (id: string) =>
  (await app.pool.query("SELECT kind, display_name, left_at FROM space_members WHERE id = $1", [id])).rows[0];
const currentIds = async (user: TestUser, spaceId: string): Promise<string[]> => {
  const response = await call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, {
    user,
    params: { spaceId },
  });
  return ((await response.json()) as { items: { id: string }[] }).items.map((m) => m.id);
};

describe("remove a guest (HU-E1-12)", () => {
  it("lets Luis remove Pedro, whose balance is zero, and frees the name for a new guest", async () => {
    const { h, luis, pedro } = await background();
    expect((await remove(luis, h.spaceId, pedro)).status).toBe(204);
    expect((await memberRow(pedro)).left_at).toBeInstanceOf(Date);
    expect(await currentIds(h.ana, h.spaceId)).not.toContain(pedro);
    expect(await addGuest(h, "Pedro")).not.toBe(pedro);
  });

  it("refuses removing Pedro while he owes Ana 100,000 COP, stating the amount (Review Focus 1)", async () => {
    const { h, pedro } = await background();
    await paysEqually(h.ana, 200_000, [h.ana.memberId, pedro], h.groceries);
    const response = await remove(h.ana, h.spaceId, pedro);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "OutstandingBalance", outstanding: cop(100_000) });
    expect((await memberRow(pedro)).left_at).toBeNull();
  });

  it("keeps Pedro's name, kind and Hotel share in the history after he settled and was removed", async () => {
    const { h, luis, pedro } = await background();
    const hotel = await paysEqually(h.ana, 300_000, [h.ana.memberId, luis.memberId, pedro], h.groceries, "Hotel");
    await settles(h.ana, pedro, h.ana.memberId, 100_000);
    expect((await remove(h.ana, h.spaceId, pedro)).status).toBe(204);
    const read = await call(getTransaction, "GET", `/api/v1/spaces/${h.spaceId}/transactions/${hotel.id}`, {
      user: h.ana,
      params: { spaceId: h.spaceId, transactionId: hotel.id },
    });
    expect(((await read.json()) as TransactionDto).shares).toContainEqual({
      memberId: pedro,
      amount: cop(100_000),
      splitMethod: "EQUAL",
    });
    expect(await memberRow(pedro)).toMatchObject({ kind: "GUEST", display_name: "Pedro" });
  });

  it("does not let a viewer remove a guest, and never removes a registered member as one", async () => {
    const { h, luis, sofi, pedro } = await background();
    expect(await problemOf(await remove(sofi, h.spaceId, pedro))).toEqual([403, "InsufficientRole"]);
    expect(await problemOf(await remove(h.ana, h.spaceId, luis.memberId))).toEqual([409, "NotAGuest"]);
  });

  it("revokes Pedro's pending claim links (Review Focus 2)", async () => {
    const { h, pedro } = await background();
    const link = await claimLink(h.ana, h.spaceId, pedro);
    expect((await remove(h.ana, h.spaceId, pedro)).status).toBe(204);
    const marta = await registerUser("Marta");
    const claimed = await call(acceptClaim, "POST", `/api/v1/claims/${link.token}/accept`, {
      user: marta,
      params: { token: link.token },
    });
    expect(await problemOf(claimed)).toEqual([409, "InvitationRevoked"]);
  });

  it("answers 404 for unknown and malformed members and for non-members", async () => {
    const { h, pedro } = await background();
    for (const memberId of ["0190a0b0-0000-7000-8000-000000000000", "not-a-uuid"]) {
      expect(await problemOf(await remove(h.ana, h.spaceId, memberId))).toEqual([404, "MemberNotFound"]);
    }
    expect(await problemOf(await remove(await registerUser("Marta"), h.spaceId, pedro))).toEqual([
      404,
      "SpaceNotFound",
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/remove-guest.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/guests/[memberId]/route"`.

- [ ] **Step 3: Contract, route and wiring**

In `src/modules/spaces/contracts/spaces.contract.ts`, insert before the last line of the file (`};`):

```ts
  "/api/v1/spaces/{spaceId}/guests/{memberId}": {
    delete: {
      operationId: "removeGuestMember",
      summary: "Remove a guest whose balance is zero; history keeps the guest and their claim links are revoked",
      ...securedByUser,
      requestParams: { path: MemberPath },
      responses: {
        "204": { description: "Removed: the guest is no longer a current member and the name is free" },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound, MemberNotFound",
          "409":
            "OutstandingBalance (with the outstanding amount), NotAGuest, PersonalSpaceNotShareable, DirectSpaceMembersFixed",
        }),
      },
    },
  },
```

`src/app/api/v1/spaces/[spaceId]/guests/[memberId]/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const DELETE = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.removeGuest({
      spaceId: params.spaceId!,
      userId: user!.id,
      memberId: params.memberId!,
    });
    return result.ok ? ok({ status: 204 }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Add after the line `  createUpdateSpaceSettings,`:

```ts
  createRemoveGuestMember,
```

2. Add after the line `  type UpdateSpaceSettings,`:

```ts
  type RemoveGuestMember,
```

3. Add after the line `    readonly changeMemberRole: ChangeMemberRole;`:

```ts
    readonly removeGuest: RemoveGuestMember;
```

4. Add after the line `      changeMemberRole: createChangeMemberRole(membersDeps),`:

```ts
      removeGuest: createRemoveGuestMember({ ...lifecycleDeps, invitations: invitationRepository }),
```

- [ ] **Step 4: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/remove-guest.test.ts`
Expected: PASS.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `DELETE /api/v1/spaces/{spaceId}/guests/{memberId}` (about 70 lines); components are unchanged.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (`tsc` checks `DrizzleInvitationRepository` against `ClaimLinkRepository` where it is bound).

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/v1/spaces/[spaceId]/guests/[memberId]/route.ts" src/modules/spaces/contracts/spaces.contract.ts src/composition/container.ts tests/acceptance/remove-guest.test.ts openapi/openapi.snapshot.json
git commit -m "feat(spaces): remove a settled guest over HTTP (Refs #21)"
```

---

### Task 12: Spaces domain — direct spaces and the two-member rule on every path

Implements the pure model of HU-E1-13 (issue #22): a `DIRECT` space between the creator and one other person, its name, and the key that makes one active direct space per pair of registered users. Closes M2-A's known gap (M2-A Self-Review, assumption 16): `ensureCanAddMember` now refuses a third member of a direct space, so `AddGuestMember` and `CreateInvitation` answer `DirectSpaceIsFull`, and `ChangeMemberRole` refuses role changes in a direct space (`DirectSpaceMembersFixed`, both members stay OWNER). Pins Review Focus 3 at the domain level.

Decisions:
- `createDirectSpace` lives in a new `domain/direct-space.ts`: it needs `guestMember` and `availableDisplayName` from `member.ts`, and `space.ts` cannot import `member.ts` (cycle). `space.ts` exports its `founder` helper and `MAX_SPACE_NAME` for it, so the founder shape and the name limit stay in one place.
- The name is "Creator & Other", cut to the 80 characters of a space name (`MAX_SPACE_NAME`), so long names never fail `InvalidSpaceName`. A registered counterpart whose name the creator already uses gets the first free numbered name ("Ana 2", M2-A's `availableDisplayName`); a new guest named like the creator is refused (`MemberNameTaken`), like `AddGuestMember`.
- Both members join at the same instant; the use case generates the creator's member id first, so listing by `(joinedAt, id)` puts the creator first and rounding ties go to them (spec 5.3).
- `pairKeyOf(a, b)` sorts the two user ids, so either person reaches the same key; `directPairKey(space)` is null unless the space is `DIRECT` with two registered members (a guest's direct space has no key, and keeps none after a claim; the key is stored at creation only, Task 14).
- `ChangeMemberRole` now calls `ensureMembersCanChange` after the matrix check. In a personal space its answer changes from `LastOwnerRequired` (demoting oneself) to `PersonalSpaceNotShareable` (Self-Review, contradiction 9).
- `AcceptInvitation` needs no change: `CreateInvitation` is the only producer of invitations and now refuses direct spaces, and claim tokens are refused since Task 7.

**Files:**
- Create: `src/modules/spaces/domain/direct-space.ts`
- Modify: `src/modules/spaces/domain/space.ts`, `src/modules/spaces/application/change-member-role.ts`
- Test: `src/modules/spaces/domain/direct-space.test.ts`, `src/modules/spaces/domain/space.test.ts`, `src/modules/spaces/application/members.test.ts`, `src/modules/spaces/application/invitations.test.ts`

**Interfaces:**
- Consumes: `guestMember`, `availableDisplayName` (M2-A `member.ts`); `ensureMembersCanChange` (Task 1); `DIRECT_MEMBER_ROLE` (Task 6); `currencyOf`, `DEFAULT_PERIOD_POLICY` (kernel); `householdSpace`, `HOUSEHOLD_MEMBERS`, `InMemorySpaceStore`, `invitationsWorld` (`tests/support/in-memory-spaces.ts`).
- Produces:
  - `type DirectCounterpart = { kind: "USER"; userId: string; displayName: string } | { kind: "GUEST"; displayName: string; contactEmail: string | null }`
  - `createDirectSpace(input: { id: SpaceId; creatorMemberId: SpaceMemberId; counterpartMemberId: SpaceMemberId; creatorUserId: string; creatorName: string; counterpart: DirectCounterpart; currency: string; now: Date }): Result<Space>` — `UnknownCurrency`, `InvalidMemberName`, `MemberNameTaken`
  - `pairKeyOf(userA: string, userB: string): string`; `directPairKey(space: Pick<Space, "kind" | "members">): string | null`
  - `space.ts`: `export const founder`, `export const MAX_SPACE_NAME`; `ensureCanAddMember` answers `DirectSpaceIsFull` for `DIRECT`.

- [ ] **Step 1: Write the failing tests**

`src/modules/spaces/domain/direct-space.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Id, Result } from "@/shared/kernel";
import { createDirectSpace, directPairKey, pairKeyOf, type DirectCounterpart } from "./direct-space";
import { createSharedSpace } from "./space";

const now = new Date("2026-10-14T12:00:00Z");
const code = (result: Result<unknown>) => (result.ok ? "ok" : result.error.code);
const direct = (counterpart: DirectCounterpart, creatorName = "Ana", currency = "COP") =>
  createDirectSpace({
    id: "s-direct" as Id<"Space">,
    creatorMemberId: "m-ana" as Id<"SpaceMember">,
    counterpartMemberId: "m-other" as Id<"SpaceMember">,
    creatorUserId: "u-ana",
    creatorName,
    counterpart,
    currency,
    now,
  });
const pedro: DirectCounterpart = { kind: "GUEST", displayName: "Pedro", contactEmail: null };
const juan: DirectCounterpart = { kind: "USER", userId: "u-juan", displayName: "Juan" };

describe("direct spaces (HU-E1-13, D16)", () => {
  it("are DIRECT, named after both, in MONTHLY(1), with the creator as OWNER and the guest", () => {
    expect(direct(pedro)).toEqual({
      ok: true,
      value: {
        id: "s-direct",
        name: "Ana & Pedro",
        kind: "DIRECT",
        currency: "COP",
        periodPolicy: { kind: "MONTHLY", day: 1 },
        personalOwnerUserId: null,
        members: [
          {
            id: "m-ana",
            kind: "USER",
            userId: "u-ana",
            displayName: "Ana",
            role: "OWNER",
            contactEmail: null,
            joinedAt: now,
          },
          {
            id: "m-other",
            kind: "GUEST",
            userId: null,
            displayName: "Pedro",
            role: null,
            contactEmail: null,
            joinedAt: now,
          },
        ],
        createdAt: now,
      },
    });
  });

  it("make a registered counterpart an OWNER too, numbering a name the creator already uses", () => {
    const result = direct({ kind: "USER", userId: "u-ana-2", displayName: "Ana" });
    expect(result.ok && result.value.name).toBe("Ana & Ana 2");
    expect(result.ok && result.value.members.map((m) => [m.userId, m.displayName, m.role])).toEqual([
      ["u-ana", "Ana", "OWNER"],
      ["u-ana-2", "Ana 2", "OWNER"],
    ]);
  });

  it("cut their name to the 80 characters of a space name (Review Focus 3)", () => {
    const result = direct({ kind: "GUEST", displayName: "P".repeat(100), contactEmail: null }, "A".repeat(60));
    expect(result.ok && result.value.name).toBe(`${"A".repeat(60)} & ${"P".repeat(17)}`);
  });

  it("refuse a guest named like the creator and a currency the kernel does not know (Review Focus 3)", () => {
    expect(code(direct({ kind: "GUEST", displayName: "ana", contactEmail: null }))).toBe("MemberNameTaken");
    expect(code(direct(pedro, "Ana", "XYZ"))).toBe("UnknownCurrency");
  });

  it("key a pair of registered users the same in either order, and no pair while one side is a guest", () => {
    expect(pairKeyOf("u-juan", "u-ana")).toBe("u-ana:u-juan");
    expect(pairKeyOf("u-ana", "u-juan")).toBe("u-ana:u-juan");
    const withJuan = direct(juan);
    const withPedro = direct(pedro);
    expect(withJuan.ok && directPairKey(withJuan.value)).toBe("u-ana:u-juan");
    expect(withPedro.ok && directPairKey(withPedro.value)).toBeNull();
  });

  it("key no shared space", () => {
    const shared = createSharedSpace({
      id: "s-shared" as Id<"Space">,
      memberId: "m-ana" as Id<"SpaceMember">,
      ownerUserId: "u-ana",
      ownerName: "Ana",
      name: "Household",
      currency: "COP",
      now,
    });
    expect(shared.ok && directPairKey(shared.value)).toBeNull();
  });
});
```

In `src/modules/spaces/domain/space.test.ts`, append to the end of the file:

```ts

describe("direct space (HU-E1-13, D16)", () => {
  it("cannot get a third member", () => {
    const result = ensureCanAddMember({ kind: "DIRECT" });
    expect(!result.ok && result.error.code).toBe("DirectSpaceIsFull");
  });
});
```

In `src/modules/spaces/application/members.test.ts`, append to the end of the file:

```ts

describe("direct spaces keep their two members (HU-E1-13, D16)", () => {
  const [ana, juan, , , pedro] = HOUSEHOLD_MEMBERS;
  const direct = (members: SpaceMember[], name: string): Space => ({
    ...householdSpace(members),
    kind: "DIRECT",
    name,
  });

  it("refuses a third member as a guest", async () => {
    const { addGuest, store } = setup(direct([ana!, pedro!], "Ana & Pedro"));
    expect(codeOf(await addGuest({ ...as("ana"), displayName: "Luis" }))).toBe("DirectSpaceIsFull");
    expect(store.members(space)).toHaveLength(2);
  });

  it("keeps both registered members OWNER", async () => {
    const { changeRole, store } = setup(direct([ana!, { ...juan!, role: "OWNER" }], "Ana & Juan"));
    expect(codeOf(await changeRole({ ...as("ana"), memberId: "member-juan", role: "MEMBER" }))).toBe(
      "DirectSpaceMembersFixed",
    );
    expect(roleOf(store, "Juan")).toBe("OWNER");
  });

  it("answers PersonalSpaceNotShareable to a role change in a personal space", async () => {
    const personal = createPersonalSpace({
      id: "space-ana" as SpaceId,
      memberId: "member-ana-personal" as SpaceMemberId,
      ownerUserId: "u-ana",
      ownerName: "Ana",
      now,
    });
    const { changeRole } = setup(personal);
    const demotion = { spaceId: "space-ana", userId: "u-ana", memberId: "member-ana-personal", role: "ADMIN" as const };
    expect(codeOf(await changeRole(demotion))).toBe("PersonalSpaceNotShareable");
  });
});
```

In `src/modules/spaces/application/invitations.test.ts`:

1. Replace the line `import { invitationsWorld, RecordingEmailSender } from "../../../../tests/support/in-memory-spaces";` with:

```ts
import {
  HOUSEHOLD_MEMBERS,
  householdSpace,
  InMemorySpaceStore,
  invitationsWorld,
  RecordingEmailSender,
} from "../../../../tests/support/in-memory-spaces";
import type { SpaceId } from "../domain/space";
```

2. Append to the end of the file:

```ts

describe("CreateInvitation in a direct space (HU-E1-13, D16)", () => {
  it("refuses a third member", async () => {
    const store = new InMemorySpaceStore();
    store.seed({
      ...householdSpace([HOUSEHOLD_MEMBERS[0]!, HOUSEHOLD_MEMBERS[4]!]),
      id: "space-direct" as SpaceId,
      kind: "DIRECT",
      name: "Ana & Pedro",
    });
    const { deps, invitations } = invitationsWorld({ store });
    const link = { spaceId: "space-direct", userId: "u-ana", role: "MEMBER" as const, target: { kind: "LINK" as const } };
    expect(codeOf(await createCreateInvitation(deps)(link))).toBe("DirectSpaceIsFull");
    expect(invitations.rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/spaces`
Expected: FAIL — `Failed to resolve import "./direct-space"`; `ensureCanAddMember({ kind: "DIRECT" })` answers ok, so the space, guest and invitation tests fail with `ok` instead of `DirectSpaceIsFull`; the role-change tests get `ok` and `LastOwnerRequired`.

- [ ] **Step 3: Implement**

In `src/modules/spaces/domain/space.ts`:

1. Replace the line `const founder = (input: {` with:

```ts
export const founder = (input: {
```

2. Replace the three lines from `/** Personal spaces have exactly one member (spec 5.2, HU-E1-02); guests never join them either (HU-E1-10). */` to `  space.kind === "PERSONAL" ? err(domainError("PersonalSpaceNotShareable")) : ok(undefined);` with:

```ts
/**
 * Spec 5.2, D16: a personal space has exactly one member and a direct space exactly two, so neither ever
 * gains one (HU-E1-02, HU-E1-10, HU-E1-13); guests never join personal spaces either.
 */
export const ensureCanAddMember = (space: Pick<Space, "kind">): Result<void> => {
  if (space.kind === "PERSONAL") return err(domainError("PersonalSpaceNotShareable"));
  return space.kind === "DIRECT" ? err(domainError("DirectSpaceIsFull")) : ok(undefined);
};
```

3. Replace the line `const MAX_SPACE_NAME = 80;` with:

```ts
export const MAX_SPACE_NAME = 80;
```

`src/modules/spaces/domain/direct-space.ts`:

```ts
import { currencyOf, DEFAULT_PERIOD_POLICY, ok, type Result } from "@/shared/kernel";
import { availableDisplayName, guestMember } from "./member";
import {
  DIRECT_MEMBER_ROLE,
  founder,
  MAX_SPACE_NAME,
  type Space,
  type SpaceId,
  type SpaceMember,
  type SpaceMemberId,
} from "./space";

/** HU-E1-13: whom a direct space is shared with: a registered user (an OWNER too, D16) or a new guest. */
export type DirectCounterpart =
  | { readonly kind: "USER"; readonly userId: string; readonly displayName: string }
  | { readonly kind: "GUEST"; readonly displayName: string; readonly contactEmail: string | null };

/** HU-E1-13: one active DIRECT space per unordered pair of registered users, keyed the same either way. */
export const pairKeyOf = (userA: string, userB: string): string => [userA, userB].sort().join(":");

/** The pair key a DIRECT space is stored under; null unless both of its members are registered users. */
export const directPairKey = (space: Pick<Space, "kind" | "members">): string | null => {
  if (space.kind !== "DIRECT" || space.members.length !== 2) return null;
  const [a, b] = space.members.map((m) => m.userId);
  return a && b ? pairKeyOf(a, b) : null;
};

/** "Ana & Pedro", cut to the length limit of space names. */
const directSpaceName = (a: string, b: string): string => `${a} & ${b}`.slice(0, MAX_SPACE_NAME).trimEnd();

const counterpartMember = (
  creator: SpaceMember,
  input: { counterpartMemberId: SpaceMemberId; counterpart: DirectCounterpart; now: Date },
): Result<SpaceMember> => {
  const { counterpart } = input;
  if (counterpart.kind === "GUEST") {
    return guestMember({
      id: input.counterpartMemberId,
      displayName: counterpart.displayName,
      contactEmail: counterpart.contactEmail,
      now: input.now,
      current: [creator],
    });
  }
  const member: SpaceMember = {
    id: input.counterpartMemberId,
    kind: "USER",
    userId: counterpart.userId,
    displayName: availableDisplayName([creator], counterpart.displayName),
    role: DIRECT_MEMBER_ROLE,
    contactEmail: null,
    joinedAt: input.now,
  };
  return ok(member);
};

/**
 * HU-E1-13, D16: a DIRECT space between its creator and one other person, named after both, with the
 * default period policy and no plan. Both registered members are OWNER; a guest has no role.
 */
export const createDirectSpace = (input: {
  id: SpaceId;
  creatorMemberId: SpaceMemberId;
  counterpartMemberId: SpaceMemberId;
  creatorUserId: string;
  creatorName: string;
  counterpart: DirectCounterpart;
  currency: string;
  now: Date;
}): Result<Space> => {
  const currency = currencyOf(input.currency);
  if (!currency.ok) return currency;
  const creator = founder({
    memberId: input.creatorMemberId,
    ownerUserId: input.creatorUserId,
    ownerName: input.creatorName,
    now: input.now,
  });
  const other = counterpartMember(creator, input);
  if (!other.ok) return other;
  const space: Space = {
    id: input.id,
    name: directSpaceName(creator.displayName, other.value.displayName),
    kind: "DIRECT",
    currency: currency.value.code,
    periodPolicy: DEFAULT_PERIOD_POLICY,
    personalOwnerUserId: null,
    members: [creator, other.value],
    createdAt: input.now,
  };
  return ok(space);
};
```

In `src/modules/spaces/application/change-member-role.ts`:

1. Replace the line `import type { SpaceMember, SpaceRole } from "../domain/space";` with:

```ts
import { ensureMembersCanChange, type SpaceMember, type SpaceRole } from "../domain/space";
```

2. Add after the line `      const { spaceId, memberId: actorId } = owner.value;`:

```ts
      // D16: both members of a direct space stay OWNER; a personal space keeps its one owner.
      const changeable = ensureMembersCanChange({ kind: owner.value.spaceKind });
      if (!changeable.ok) return changeable;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/spaces`
Expected: PASS, M2-A's guest, invitation and role tests included. Mutation check: temporarily delete the `DIRECT` branch of `ensureCanAddMember` (keep only the `PERSONAL` line and `return ok(undefined)`) — the space, guest and invitation tests of this task fail; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (`no-circular` holds: `direct-space.ts` imports `member.ts` and `space.ts`, neither imports it).

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/domain/direct-space.ts src/modules/spaces/domain/direct-space.test.ts src/modules/spaces/domain/space.ts src/modules/spaces/domain/space.test.ts src/modules/spaces/application/change-member-role.ts src/modules/spaces/application/members.test.ts src/modules/spaces/application/invitations.test.ts
git commit -m "feat(spaces): model direct spaces and keep them at exactly two members (Refs #22)"
```

---

### Task 13: Spaces — SplitWithPerson resolves or creates the direct space

Implements HU-E1-13 (issue #22) as a use case in `spaces`: find the counterpart's direct space or create it, then record the expense there through a recorder port, in one transaction. Pins Review Focus 3 at the use-case level. Size ~430 lines: commit it as **13a** (the port, the in-memory twin, the use case, the backlog note and the first `describe` block, whose file imports only what 13a's tests use) and **13b** (the imports only 13b uses and the second `describe` block; no production change unless one of its tests is red), each with its own RDD pass.

Decisions:
- The counterpart is either `{ memberId }` — a current member of any space the requester belongs to — or `{ guest: { displayName, contactEmail? } }`, a new guest. A member of a space the requester is not in answers `MemberNotFound` (spec 8: other spaces' members do not exist for them), and so do unknown and malformed ids (`findCurrentMember` guards with `isUuid`).
- A member picked inside a **direct** space the requester is in means that space: its guest (HU-E1-13 "choosing that guest reuses it") or its other registered member (also after a claim). A registered member picked in a **shared** space resolves to the pair's active direct space by `pairKeyOf`, or creates it. Splitting with oneself, or with a guest of a shared space (a guest exists only in its own space, D15), answers `422 InvalidDirectCounterpart`, a new error code that joins the backlog's catalogue in HU-E1-13's technical notes here (spec 8; ruling O6). A direct space that became a two-user space through a claim takes the pair key when the pair is free (Task 14b), so the pair-key lookup finds it too.
- A new direct space takes the creator's personal-space currency (backlog note), seeds the default categories through the same `SpaceCreatedListener` as `CreateSpace` (HU-E3-01), and is added through `DirectSpaceRepository.addDirect`, which returns the id of the space that holds the pair key: when a concurrent first split won, the expense goes to that space and nothing is seeded twice.
- `spaces` cannot import `ledger` (the ledger imports `spaces`), so the use case is generic in the expense it records: `createSplitWithPerson<E, T>` passes `E` to a `DirectExpenseRecorder<E, T>` and returns its `T`. The composition root binds the recorder to the ledger's `RecordExpenseByCategoryKey` (Task 15). Space and expense share one `tm.run` (nested runs join it, kernel `TransactionManager`), so a refused expense leaves no direct space behind (pinned over HTTP in Task 15).

**Files:**
- Create: `src/modules/spaces/application/direct-space-repository.ts`, `src/modules/spaces/application/split-with-person.ts`
- Modify: `src/modules/spaces/application/index.ts`, `tests/support/in-memory-spaces.ts`, `docs/backlog/E1-identity-and-spaces.md`
- Test: `src/modules/spaces/application/split-with-person.test.ts`

**Interfaces:**
- Consumes: `createDirectSpace`, `pairKeyOf`, `directPairKey`, `DirectCounterpart` (Task 12); `SpaceAccess`, `createSpaceAccess`, `SpaceRepository.listForUser`, `SpaceCreatedListener` (M2-A, M1); `createPersonalSpace`, `householdSpace`, `memberOf`, `InMemorySpaceStore` (`tests/support`).
- Produces:
  - `interface MemberInSpace { spaceId: SpaceId; spaceKind: SpaceKind; member: SpaceMember }`
  - `interface DirectSpaceRepository { findCurrentMember(memberId: string): Promise<MemberInSpace | null>; findByPairKey(pairKey: string): Promise<SpaceId | null>; addDirect(space: Space): Promise<SpaceId> }`
  - `type DirectSplitCounterpart = { memberId: string } | { guest: { displayName: string; contactEmail?: string } }`
  - `interface SplitWithPersonInput<E> { userId; userName; locale; counterpart: DirectSplitCounterpart; expense: E }`; `interface DirectSplit<T> { spaceId: SpaceId; created: boolean; recorded: T }`
  - `type DirectExpenseRecorder<E, T> = (input: { spaceId: string; userId: string; expense: E }) => Promise<Result<T>>`
  - `interface SplitWithPersonDeps<E, T> { access; spaces: Pick<SpaceRepository, "listForUser">; direct: DirectSpaceRepository; onCreated: SpaceCreatedListener; recordExpense: DirectExpenseRecorder<E, T>; ids; clock; tm }`
  - `type SplitWithPerson<E, T> = (input: SplitWithPersonInput<E>) => Promise<Result<DirectSplit<T>>>`; `createSplitWithPerson<E, T>(deps)` — errors `MemberNotFound`, `InvalidDirectCounterpart`, `MemberNameTaken`, `InvalidMemberName`, `UnknownCurrency`, `SpaceArchived` (a direct space archived after Task 16), plus whatever the recorder answers
  - `InMemorySpaceStore`: `findCurrentMember`, `findByPairKey`, `addDirect` (pair keys stored at creation, like the column).

#### 13a — new guests

- [ ] **Step 1: Write the in-memory twin and the failing tests**

In `tests/support/in-memory-spaces.ts`:

1. Add after the line `  type AddMemberOutcome,`:

```ts
  type MemberInSpace,
```

2. Add after the line `import { createPersonalSpace } from "@/modules/spaces/domain/space";`:

```ts
import { directPairKey } from "@/modules/spaces/domain/direct-space";
```

3. Add after the line `  spaces: Space[] = [];`:

```ts
  /** Pair keys stored when a direct space was added, like spaces.direct_pair_key; claims never change them. */
  private readonly pairKeys = new Map<string, string>();
```

4. Insert before the line `  /** Test setup: a space as earlier use cases would have left it. */`:

```ts
  /** DirectSpaceRepository, like DrizzleSpaceRepository.findCurrentMember. */
  async findCurrentMember(memberId: string): Promise<MemberInSpace | null> {
    for (const space of this.spaces) {
      const member = space.members.find((m) => m.id === memberId);
      if (member) return { spaceId: space.id, spaceKind: space.kind, member };
    }
    return null;
  }

  /** DirectSpaceRepository, like DrizzleSpaceRepository.findByPairKey. */
  async findByPairKey(pairKey: string): Promise<SpaceId | null> {
    const found = [...this.pairKeys].find(([, key]) => key === pairKey);
    return found ? (found[0] as SpaceId) : null;
  }

  /** DirectSpaceRepository, like DrizzleSpaceRepository.addDirect: the pair's active space wins. */
  async addDirect(space: Space): Promise<SpaceId> {
    const key = directPairKey(space);
    const holder = key === null ? null : await this.findByPairKey(key);
    if (holder !== null) return holder;
    this.spaces.push(space);
    if (key !== null) this.pairKeys.set(space.id, key);
    return space.id;
  }

```

`src/modules/spaces/application/split-with-person.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock, ok } from "@/shared/kernel";
import { codeOf, memoryTm, sequentialIds, unwrap } from "../../../../tests/support/fakes";
import { householdSpace, InMemorySpaceStore, memberOf } from "../../../../tests/support/in-memory-spaces";
import { createPersonalSpace, type Space, type SpaceId, type SpaceMemberId } from "../domain/space";
import { createSpaceAccess } from "./space-access";
import {
  createSplitWithPerson,
  type DirectExpenseRecorder,
  type DirectSplitCounterpart,
} from "./split-with-person";

const now = new Date("2026-10-14T12:00:00Z");
// Household: OWNER Ana, MEMBER Juan and the guest Pedro. "Trip" belongs to Marta; Ana is not in it.
const ANA = memberOf("Ana", "OWNER", 0);
const JUAN = memberOf("Juan", "MEMBER", 1);
const PEDRO = memberOf("Pedro", null, 2);
const personalOf = (name: string, currency = "COP"): Space => ({
  ...createPersonalSpace({
    id: `space-${name.toLowerCase()}` as SpaceId,
    memberId: `member-${name.toLowerCase()}-personal` as SpaceMemberId,
    ownerUserId: `u-${name.toLowerCase()}`,
    ownerName: name,
    now,
  }),
  currency,
});

const world = (
  options: {
    store?: InMemorySpaceStore;
    recordExpense?: DirectExpenseRecorder<string, string>;
    anaCurrency?: string;
  } = {},
) => {
  const store = options.store ?? new InMemorySpaceStore();
  store.seed(householdSpace([ANA, JUAN, PEDRO]));
  store.seed({ ...householdSpace([memberOf("Marta", "OWNER", 0)]), id: "space-trip" as SpaceId, name: "Trip" });
  store.seed(personalOf("Ana", options.anaCurrency));
  store.seed(personalOf("Juan"));
  const seeded: string[] = [];
  const recorded: { spaceId: string; userId: string; expense: string }[] = [];
  const split = createSplitWithPerson<string, string>({
    access: createSpaceAccess(store),
    spaces: store,
    direct: store,
    onCreated: async (space) => {
      seeded.push(space.id);
      return ok(undefined);
    },
    recordExpense:
      options.recordExpense ??
      (async (input) => {
        recorded.push(input);
        return ok(`expense in ${input.spaceId}`);
      }),
    ids: sequentialIds("id"),
    clock: new FixedClock(now),
    tm: memoryTm,
  });
  return { store, seeded, recorded, split };
};
const byAna = (counterpart: DirectSplitCounterpart) => ({
  userId: "u-ana",
  userName: "Ana",
  locale: "es",
  counterpart,
  expense: "Dinner 120,000",
});
const directSpaces = (store: InMemorySpaceStore) => store.spaces.filter((s) => s.kind === "DIRECT");

describe("SplitWithPerson with a new guest (HU-E1-13)", () => {
  it("creates 'Ana & Pedro' with Ana as OWNER and the new guest, seeds it and records the expense there", async () => {
    const w = world();
    expect(unwrap(await w.split(byAna({ guest: { displayName: "Pedro" } })))).toEqual({
      spaceId: "id-1",
      created: true,
      recorded: "expense in id-1",
    });
    const [space] = directSpaces(w.store);
    expect(space).toMatchObject({
      id: "id-1",
      name: "Ana & Pedro",
      kind: "DIRECT",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
    });
    expect(space?.members.map((m) => [m.id, m.displayName, m.kind, m.role])).toEqual([
      ["id-2", "Ana", "USER", "OWNER"],
      ["id-3", "Pedro", "GUEST", null],
    ]);
    expect(w.seeded).toEqual(["id-1"]);
    expect(w.recorded).toEqual([{ spaceId: "id-1", userId: "u-ana", expense: "Dinner 120,000" }]);
  });

  it("reuses 'Ana & Pedro' when Ana picks its guest again, creating and seeding nothing", async () => {
    const w = world();
    unwrap(await w.split(byAna({ guest: { displayName: "Pedro" } })));
    expect(unwrap(await w.split(byAna({ memberId: "id-3" })))).toEqual({
      spaceId: "id-1",
      created: false,
      recorded: "expense in id-1",
    });
    expect(directSpaces(w.store)).toHaveLength(1);
    expect(w.seeded).toEqual(["id-1"]);
  });

  it("takes the currency of Ana's personal space", async () => {
    const w = world({ anaCurrency: "USD" });
    unwrap(await w.split(byAna({ guest: { displayName: "Pedro" } })));
    expect(directSpaces(w.store).map((s) => s.currency)).toEqual(["USD"]);
  });

  it("refuses a new guest named like Ana and creates nothing (Review Focus 3)", async () => {
    const w = world();
    expect(codeOf(await w.split(byAna({ guest: { displayName: "ana" } })))).toBe("MemberNameTaken");
    expect(directSpaces(w.store)).toEqual([]);
    expect(w.recorded).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/spaces/application/split-with-person.test.ts`
Expected: FAIL — `Failed to resolve import "./split-with-person"`.

- [ ] **Step 3: Implement**

`src/modules/spaces/application/direct-space-repository.ts`:

```ts
import type { Space, SpaceId, SpaceKind, SpaceMember } from "../domain/space";

/** A current member of some space, with that space's kind (HU-E1-13 counterparts). */
export interface MemberInSpace {
  readonly spaceId: SpaceId;
  readonly spaceKind: SpaceKind;
  readonly member: SpaceMember;
}

/** HU-E1-13, D16: direct spaces, one active per pair of registered users. */
export interface DirectSpaceRepository {
  /** The current member with that id, in whatever space; null for unknown, former or malformed ids. */
  findCurrentMember(memberId: string): Promise<MemberInSpace | null>;
  /** The active (not archived) DIRECT space stored under the pair key, or null. */
  findByPairKey(pairKey: string): Promise<SpaceId | null>;
  /**
   * Adds the DIRECT space with its two members and its pair key; when an active space already holds the
   * key (a concurrent first split), adds nothing and returns that space's id. The database decides races.
   */
  addDirect(space: Space): Promise<SpaceId>;
}
```

`src/modules/spaces/application/split-with-person.ts`:

```ts
import {
  domainError,
  err,
  ok,
  type Clock,
  type IdGenerator,
  type Result,
  type TransactionManager,
} from "@/shared/kernel";
import { createDirectSpace, pairKeyOf, type DirectCounterpart } from "../domain/direct-space";
import type { SpaceId } from "../domain/space";
import type { SpaceCreatedListener } from "./create-personal-space";
import type { DirectSpaceRepository } from "./direct-space-repository";
import type { SpaceAccess } from "./space-access";
import type { SpaceRepository } from "./space-repository";

/** HU-E1-13: whom to split with: a member of a space the requester is in, or a new guest. */
export type DirectSplitCounterpart =
  | { readonly memberId: string }
  | { readonly guest: { readonly displayName: string; readonly contactEmail?: string } };

export interface SplitWithPersonInput<E> {
  readonly userId: string;
  readonly userName: string;
  /** A new direct space's default categories are seeded in this locale (HU-E3-01). */
  readonly locale: string;
  readonly counterpart: DirectSplitCounterpart;
  /** The expense to record, opaque to spaces; the recorder knows its shape. */
  readonly expense: E;
}

export interface DirectSplit<T> {
  readonly spaceId: SpaceId;
  /** True when this split created the direct space. */
  readonly created: boolean;
  readonly recorded: T;
}

/** Records the split's expense in its direct space; bound to the ledger's RecordExpense by the composition root. */
export type DirectExpenseRecorder<E, T> = (input: {
  readonly spaceId: string;
  readonly userId: string;
  readonly expense: E;
}) => Promise<Result<T>>;

interface DirectSpaceDeps {
  readonly access: SpaceAccess;
  readonly spaces: Pick<SpaceRepository, "listForUser">;
  readonly direct: DirectSpaceRepository;
  readonly onCreated: SpaceCreatedListener;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface SplitWithPersonDeps<E, T> extends DirectSpaceDeps {
  readonly recordExpense: DirectExpenseRecorder<E, T>;
  readonly tm: TransactionManager;
}

export type SplitWithPerson<E, T> = (input: SplitWithPersonInput<E>) => Promise<Result<DirectSplit<T>>>;

type Requester = Pick<SplitWithPersonInput<unknown>, "userId" | "userName" | "locale">;
type Resolved = { readonly spaceId: SpaceId; readonly created: boolean };

const newDirectSpace = async (
  deps: DirectSpaceDeps,
  requester: Requester,
  counterpart: DirectCounterpart,
): Promise<Result<Resolved>> => {
  const personal = (await deps.spaces.listForUser(requester.userId)).find((s) => s.kind === "PERSONAL");
  const space = createDirectSpace({
    id: deps.ids.next<"Space">(),
    // Generated in this order, so the creator sorts first among two members who join at the same instant.
    creatorMemberId: deps.ids.next<"SpaceMember">(),
    counterpartMemberId: deps.ids.next<"SpaceMember">(),
    creatorUserId: requester.userId,
    creatorName: requester.userName,
    counterpart,
    // HU-E1-13: the creator's personal-space currency; every user has one (HU-E1-02), COP by default (spec 3).
    currency: personal?.currency ?? "COP",
    now: deps.clock.now(),
  });
  if (!space.ok) return space;
  const spaceId = await deps.direct.addDirect(space.value);
  // A concurrent first split with the same person created the pair's space meanwhile: record there.
  if (spaceId !== space.value.id) return ok({ spaceId, created: false });
  const seeded = await deps.onCreated(space.value, { locale: requester.locale });
  if (!seeded.ok) return seeded;
  return ok({ spaceId, created: true });
};

/** HU-E1-13, D16: the direct space to record in, reused for the same person and created on first use. */
const directSpaceFor = async (
  deps: DirectSpaceDeps,
  requester: Requester,
  counterpart: DirectSplitCounterpart,
): Promise<Result<Resolved>> => {
  if ("guest" in counterpart) {
    const { displayName, contactEmail } = counterpart.guest;
    return newDirectSpace(deps, requester, { kind: "GUEST", displayName, contactEmail: contactEmail ?? null });
  }
  const found = await deps.direct.findCurrentMember(counterpart.memberId);
  if (found === null) return err(domainError("MemberNotFound"));
  // Only someone the requester shares a space with: other spaces' members do not exist for them (spec 8).
  const shared = await deps.access(found.spaceId, requester.userId);
  if (!shared.ok) return shared.error.code === "SpaceNotFound" ? err(domainError("MemberNotFound")) : shared;
  const { member } = found;
  if (member.userId === requester.userId) return err(domainError("InvalidDirectCounterpart"));
  // Someone picked in a direct space the requester is in: that space, also after its guest claimed it.
  if (found.spaceKind === "DIRECT") return ok({ spaceId: found.spaceId, created: false });
  // A guest exists only in its own space (D15): a one-to-one split with them starts from a new guest.
  if (member.userId === null) return err(domainError("InvalidDirectCounterpart"));
  const existing = await deps.direct.findByPairKey(pairKeyOf(requester.userId, member.userId));
  if (existing !== null) return ok({ spaceId: existing, created: false });
  return newDirectSpace(deps, requester, {
    kind: "USER",
    userId: member.userId,
    displayName: member.displayName,
  });
};

/**
 * HU-E1-13: splits an expense with one person through their two-member DIRECT space, created on the first
 * split and reused after it. Space and expense are recorded in one transaction, so a refused expense
 * leaves no direct space behind.
 */
export const createSplitWithPerson =
  <E, T>(deps: SplitWithPersonDeps<E, T>): SplitWithPerson<E, T> =>
  (input) =>
    deps.tm.run(async () => {
      const resolved = await directSpaceFor(deps, input, input.counterpart);
      if (!resolved.ok) return resolved;
      const { spaceId, created } = resolved.value;
      const recorded = await deps.recordExpense({ spaceId, userId: input.userId, expense: input.expense });
      if (!recorded.ok) return recorded;
      return ok({ spaceId, created, recorded: recorded.value });
    });
```

Append to `src/modules/spaces/application/index.ts`:

```ts
export type { DirectSpaceRepository, MemberInSpace } from "./direct-space-repository";
export {
  createSplitWithPerson,
  type DirectExpenseRecorder,
  type DirectSplit,
  type DirectSplitCounterpart,
  type SplitWithPerson,
  type SplitWithPersonDeps,
  type SplitWithPersonInput,
} from "./split-with-person";
```

In `docs/backlog/E1-identity-and-spaces.md` (HU-E1-13 technical notes), add after the line `- Currency comes from the creator's personal space; default categories are seeded (HU-E3-01).`:

```md
- A counterpart that is the requester, or a guest of a shared space (guests exist only in their space, D15), answers `InvalidDirectCounterpart` (422); someone the requester shares no space with, or an unknown member, answers `MemberNotFound` (404). A guest who claims a direct-space place becomes OWNER, and the claimed space becomes the pair's direct space when the pair has no other active one (D16).
```

- [ ] **Step 4: Run the tests to verify they pass, then gates and commit 13a**

Run: `pnpm exec vitest run --project unit src/modules/spaces`
Expected: PASS.

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (ESLint included: the test file imports only what 13a's tests use).

```bash
git add src/modules/spaces/application/direct-space-repository.ts src/modules/spaces/application/split-with-person.ts src/modules/spaces/application/split-with-person.test.ts src/modules/spaces/application/index.ts tests/support/in-memory-spaces.ts docs/backlog/E1-identity-and-spaces.md
git commit -m "feat(spaces): split with a new guest through a direct space (Refs #22)"
```

#### 13b — registered counterparts, invalid counterparts and races

- [ ] **Step 5: Add the second `describe` block**

In `src/modules/spaces/application/split-with-person.test.ts` (13a imports only what its own tests use, so each half passes ESLint's `no-unused-vars`):

1. Replace the line `import { FixedClock, ok } from "@/shared/kernel";` with:

```ts
import { domainError, err, FixedClock, ok } from "@/shared/kernel";
```

2. Add after the line `import { householdSpace, InMemorySpaceStore, memberOf } from "../../../../tests/support/in-memory-spaces";`:

```ts
import { createDirectSpace } from "../domain/direct-space";
```

3. Append to the end of the file:

```ts

describe("SplitWithPerson with registered people and invalid counterparts (HU-E1-13)", () => {
  it("creates 'Ana & Juan' with both as OWNER from Juan's place in Household, and Juan's split reuses it", async () => {
    const w = world();
    expect(unwrap(await w.split(byAna({ memberId: "member-juan" })))).toMatchObject({
      spaceId: "id-1",
      created: true,
    });
    expect(directSpaces(w.store).map((s) => [s.name, s.members.map((m) => [m.userId, m.role])])).toEqual([
      [
        "Ana & Juan",
        [
          ["u-ana", "OWNER"],
          ["u-juan", "OWNER"],
        ],
      ],
    ]);
    const byJuan = {
      userId: "u-juan",
      userName: "Juan",
      locale: "es",
      counterpart: { memberId: "member-ana" },
      expense: "Taxi",
    };
    expect(unwrap(await w.split(byJuan))).toEqual({ spaceId: "id-1", created: false, recorded: "expense in id-1" });
  });

  it("answers MemberNotFound for someone Ana shares no space with and for unknown or malformed ids (Review Focus 3)", async () => {
    const w = world();
    for (const memberId of ["member-marta", "member-nobody", "not-a-uuid"]) {
      expect(codeOf(await w.split(byAna({ memberId })))).toBe("MemberNotFound");
    }
    expect(directSpaces(w.store)).toEqual([]);
  });

  it("refuses splitting with herself or with a guest of a shared space (Review Focus 3)", async () => {
    const w = world();
    expect(codeOf(await w.split(byAna({ memberId: "member-ana" })))).toBe("InvalidDirectCounterpart");
    expect(codeOf(await w.split(byAna({ memberId: "member-pedro" })))).toBe("InvalidDirectCounterpart");
    expect(w.recorded).toEqual([]);
  });

  it("records in the direct space a concurrent first split created meanwhile (Review Focus 5)", async () => {
    const rival = unwrap(
      createDirectSpace({
        id: "space-rival" as SpaceId,
        creatorMemberId: "member-rival-juan" as SpaceMemberId,
        counterpartMemberId: "member-rival-ana" as SpaceMemberId,
        creatorUserId: "u-juan",
        creatorName: "Juan",
        counterpart: { kind: "USER", userId: "u-ana", displayName: "Ana" },
        currency: "COP",
        now,
      }),
    );
    class RacingStore extends InMemorySpaceStore {
      override async addDirect(space: Space): Promise<SpaceId> {
        await super.addDirect(rival);
        return super.addDirect(space);
      }
    }
    const w = world({ store: new RacingStore() });
    expect(unwrap(await w.split(byAna({ memberId: "member-juan" })))).toEqual({
      spaceId: "space-rival",
      created: false,
      recorded: "expense in space-rival",
    });
    expect(directSpaces(w.store).map((s) => s.id)).toEqual(["space-rival"]);
    expect(w.seeded).toEqual([]);
  });

  it("passes the recorder's error on", async () => {
    const w = world({ recordExpense: async () => err(domainError("CategoryNotFound")) });
    expect(codeOf(await w.split(byAna({ guest: { displayName: "Pedro" } })))).toBe("CategoryNotFound");
  });
});
```

- [ ] **Step 6: Run the tests**

Run: `pnpm exec vitest run --project unit src/modules/spaces/application/split-with-person.test.ts`
Expected: PASS with no production change (13a already implements these rules; a red test here is a bug in 13a, fixed in this commit). Mutation checks: temporarily delete the line `if (member.userId === requester.userId) return err(domainError("InvalidDirectCounterpart"));` — "refuses splitting with herself" fails; temporarily delete `if (spaceId !== space.value.id) return ok({ spaceId, created: false });` — the race test fails (`created: true`, seeded twice); restore both.

- [ ] **Step 7: Gates and commit 13b**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

```bash
git add src/modules/spaces/application/split-with-person.test.ts
git commit -m "test(spaces): pin direct splits with registered and invalid counterparts (Refs #22)"
```

---

### Task 14: Spaces — direct spaces in PostgreSQL

Implements `DirectSpaceRepository` on `DrizzleSpaceRepository` for HU-E1-13 (issue #22). Pins Review Focus 3 (malformed and foreign ids) and Review Focus 5 (two simultaneous first splits) against PostgreSQL.

Decisions:
- `addDirect` inserts the space with `ON CONFLICT DO NOTHING` and no conflict target, so the partial unique index `spaces_direct_pair_uq` counts (like M2-A's `addMember`). The losing insert waits for the winner's transaction and then inserts nothing; a fresh read (`READ COMMITTED`) finds the winner by its pair key, and its id is returned. Only a won insert adds the two member rows.
- A space row's columns are mapped in one helper, `spaceRow`, used by `add` (M1) and `addDirect`; it writes `direct_pair_key` from `directPairKey(space)`, which is null for personal and shared spaces, so `add` keeps M1's behaviour.
- `findByPairKey` ignores archived spaces, matching the partial index: an archived direct space frees its pair (Task 17 archives; this task archives with SQL).
- `findCurrentMember` guards with `isUuid` (the id comes from a request body) and ignores former members.
- If no active space holds the key after a conflict, the database broke its own invariant (for instance the winner was archived in between); `addDirect` throws rather than guessing, and the request answers `500`.

**Files:**
- Modify: `src/modules/spaces/infrastructure/drizzle-space-repository.ts`
- Test: `src/modules/spaces/infrastructure/drizzle-direct-spaces.int.test.ts`

**Interfaces:**
- Consumes: `DirectSpaceRepository`, `MemberInSpace` (Task 13); `createDirectSpace`, `directPairKey`, `pairKeyOf`, `DirectCounterpart` (Task 12); `sharedSpaceFixture`, `userFixture` (`tests/support/fixtures.ts`); `unwrap` (`tests/support/fakes.ts`).
- Produces: `DrizzleSpaceRepository.findCurrentMember(memberId: string): Promise<MemberInSpace | null>`, `findByPairKey(pairKey: string): Promise<SpaceId | null>`, `addDirect(space: Space): Promise<SpaceId>`.

- [ ] **Step 1: Write the failing tests**

`src/modules/spaces/infrastructure/drizzle-direct-spaces.int.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { ok, type Id } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { unwrap } from "../../../../tests/support/fakes";
import { sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";
import type { DirectSpaceRepository } from "../application/direct-space-repository";
import { createDirectSpace, pairKeyOf, type DirectCounterpart } from "../domain/direct-space";
import type { Space } from "../domain/space";
import { DrizzleSpaceRepository } from "./drizzle-space-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleSpaceRepository(tm);
const direct: DirectSpaceRepository = repo;

const directSpace = (creator: { id: string; name: string }, counterpart: DirectCounterpart): Space =>
  unwrap(
    createDirectSpace({
      id: randomUUID() as Id<"Space">,
      creatorMemberId: randomUUID() as Id<"SpaceMember">,
      counterpartMemberId: randomUUID() as Id<"SpaceMember">,
      creatorUserId: creator.id,
      creatorName: creator.name,
      counterpart,
      currency: "COP",
      now: new Date("2026-10-14T12:00:00Z"),
    }),
  );
const pair = async () => ({ ana: await userFixture(pool, "Ana"), juan: await userFixture(pool, "Juan") });
const withUser = (user: { id: string; name: string }): DirectCounterpart => ({
  kind: "USER",
  userId: user.id,
  displayName: user.name,
});
const count = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows[0].n as number;

afterAll(() => pool.end());

describe("DrizzleSpaceRepository direct spaces (HU-E1-13)", () => {
  it("stores a direct space between two users with both members, found by its pair in either order", async () => {
    const { ana, juan } = await pair();
    const space = directSpace(ana, withUser(juan));
    expect(await direct.addDirect(space)).toBe(space.id);
    expect(await direct.findByPairKey(pairKeyOf(juan.id, ana.id))).toBe(space.id);
    expect(await repo.listCurrent(space.id)).toEqual(space.members);
    expect(await repo.findMembership(space.id, juan.id)).toMatchObject({
      spaceKind: "DIRECT",
      name: "Ana & Juan",
      role: "OWNER",
    });
  });

  it("stores a guest's direct space under no pair and finds the guest as a current member of it", async () => {
    const { ana } = await pair();
    const space = directSpace(ana, { kind: "GUEST", displayName: "Pedro", contactEmail: null });
    expect(await direct.addDirect(space)).toBe(space.id);
    const { rows } = await pool.query("SELECT direct_pair_key FROM spaces WHERE id = $1", [space.id]);
    expect(rows[0].direct_pair_key).toBeNull();
    expect(await direct.findCurrentMember(space.members[1]!.id)).toEqual({
      spaceId: space.id,
      spaceKind: "DIRECT",
      member: space.members[1],
    });
  });

  it("answers a second space of the same pair with the first one's id and adds nothing", async () => {
    const { ana, juan } = await pair();
    const first = directSpace(ana, withUser(juan));
    const second = directSpace(juan, withUser(ana));
    await direct.addDirect(first);
    expect(await direct.addDirect(second)).toBe(first.id);
    expect(await count("SELECT count(*)::int AS n FROM spaces WHERE id = $1", [second.id])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM space_members WHERE space_id = $1", [second.id])).toBe(0);
  });

  it("lets an archived direct space go, so the pair can start a new one", async () => {
    const { ana, juan } = await pair();
    const old = directSpace(ana, withUser(juan));
    await direct.addDirect(old);
    await pool.query("UPDATE spaces SET archived_at = now() WHERE id = $1", [old.id]);
    expect(await direct.findByPairKey(pairKeyOf(ana.id, juan.id))).toBeNull();
    const fresh = directSpace(ana, withUser(juan));
    expect(await direct.addDirect(fresh)).toBe(fresh.id);
  });

  it("finds no member for malformed, unknown or former ids (Review Focus 3)", async () => {
    const space = await sharedSpaceFixture(db, (await userFixture(pool, "Ana")).id);
    const owner = space.members[0]!;
    expect(await direct.findCurrentMember(owner.id)).toEqual({ spaceId: space.id, spaceKind: "SHARED", member: owner });
    expect(await direct.findCurrentMember("not-a-uuid")).toBeNull();
    expect(await direct.findCurrentMember(randomUUID())).toBeNull();
    await pool.query("UPDATE space_members SET left_at = now() WHERE id = $1", [owner.id]);
    expect(await direct.findCurrentMember(owner.id)).toBeNull();
  });
});

describe("concurrent first splits (Review Focus 5)", () => {
  it("lets one of two simultaneous first splits of a pair create the space and gives both its id", async () => {
    const { ana, juan } = await pair();
    const byAna = directSpace(ana, withUser(juan));
    const byJuan = directSpace(juan, withUser(ana));
    const results = await Promise.all(
      [byAna, byJuan].map((space) => tm.run(async () => ok(await direct.addDirect(space)))),
    );
    const winners = results.map((r) => (r.ok ? r.value : null));
    expect(new Set(winners).size).toBe(1);
    expect([byAna.id, byJuan.id]).toContain(winners[0]);
    const active = "SELECT count(*)::int AS n FROM spaces WHERE direct_pair_key = $1";
    expect(await count(active, [pairKeyOf(ana.id, juan.id)])).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project integration src/modules/spaces/infrastructure/drizzle-direct-spaces.int.test.ts`
Expected: FAIL — `direct.addDirect is not a function` (and `findCurrentMember`, `findByPairKey`).

- [ ] **Step 3: Implement**

In `src/modules/spaces/infrastructure/drizzle-space-repository.ts`:

1. Add after the line `import { isUuid } from "@/shared/kernel";`:

```ts
import type { MemberInSpace } from "../application/direct-space-repository";
```

2. Add after the line `import type { Space, SpaceId, SpaceKind, SpaceMember, SpaceMemberId, SpaceRole } from "../domain/space";`:

```ts
import { directPairKey } from "../domain/direct-space";
```

3. Insert before the line `export class DrizzleSpaceRepository`:

```ts
/** One space row; the pair key is set only for a DIRECT space between two registered users (HU-E1-13). */
const spaceRow = (space: Space): typeof spaces.$inferInsert => ({
  id: space.id,
  name: space.name,
  kind: space.kind,
  currency: space.currency,
  periodPolicy: space.periodPolicy,
  personalOwnerUserId: space.personalOwnerUserId,
  directPairKey: directPairKey(space),
  createdAt: space.createdAt,
});

```

4. Replace the nine lines from `    await db.insert(spaces).values({` to the first `    });` after it (in `add`) with:

```ts
    await db.insert(spaces).values(spaceRow(space));
```

5. Insert before the last line of the file (`}`):

```ts

  async findCurrentMember(memberId: string): Promise<MemberInSpace | null> {
    // Ids come from request bodies; anything that is not a UUID would fail the uuid cast.
    if (!isUuid(memberId)) return null;
    const [row] = await this.tm
      .executor()
      .select({ spaceId: spaceMembers.spaceId, spaceKind: spaces.kind, ...memberColumns })
      .from(spaceMembers)
      .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
      .where(and(eq(spaceMembers.id, memberId), isNull(spaceMembers.leftAt)))
      .limit(1);
    if (!row) return null;
    const { spaceId, spaceKind, ...member } = row;
    return { spaceId: spaceId as SpaceId, spaceKind, member: { ...member, id: member.id as SpaceMemberId } };
  }

  async findByPairKey(pairKey: string): Promise<SpaceId | null> {
    const [row] = await this.tm
      .executor()
      .select({ id: spaces.id })
      .from(spaces)
      .where(and(eq(spaces.directPairKey, pairKey), isNull(spaces.archivedAt)))
      .limit(1);
    return row ? (row.id as SpaceId) : null;
  }

  async addDirect(space: Space): Promise<SpaceId> {
    const db = this.tm.executor();
    // No conflict target: spaces_direct_pair_uq counts, so the losing insert of two first splits waits
    // for the winner, then inserts nothing.
    const inserted = await db
      .insert(spaces)
      .values(spaceRow(space))
      .onConflictDoNothing()
      .returning({ id: spaces.id });
    if (inserted.length === 0) {
      const pairKey = directPairKey(space);
      const holder = pairKey === null ? null : await this.findByPairKey(pairKey);
      if (holder === null) throw new Error(`direct space ${space.id} conflicts with no active pair`);
      return holder;
    }
    await db.insert(spaceMembers).values(space.members.map((m) => memberRow(space.id, m)));
    return space.id;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project integration src/modules/spaces/infrastructure`
Expected: PASS, including M1/M2-A's `add` tests ("enforces one personal space per user in the database" still throws: `add` has no `onConflictDoNothing`). Mutation checks (required): temporarily delete `.onConflictDoNothing()` from `addDirect` — "concurrent first splits" and "answers a second space of the same pair" fail with a unique violation on `spaces_direct_pair_uq`; temporarily delete `isNull(spaces.archivedAt)` from `findByPairKey` — "lets an archived direct space go" fails; restore both.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/infrastructure/drizzle-space-repository.ts src/modules/spaces/infrastructure/drizzle-direct-spaces.int.test.ts
git commit -m "feat(spaces): store and reuse direct spaces in PostgreSQL (Refs #22)"
```

---

### Task 14b: Spaces — a claimed direct space becomes the pair's direct space

Implements the D16 rule that a direct space "is reused for later splits with that person" for the case HU-E1-11 (issue #20) and HU-E1-13 (issue #22) meet: a guest's direct space ("Ana & Pedro", no pair key, Task 14) whose guest claims their place now holds two registered users. When that pair has no other active direct space, the claimed space takes their pair key, so a later split between them picked from any shared space finds it. D16's "both are kept (merging is deferred)" applies only when the two users already had another direct space: that one keeps the key (controller ruling O8). Pinned over HTTP in Task 15d.

Decisions:
- `GuestClaimRepository` gains `adoptPairKey(spaceId, pairKey)`: one conditional `UPDATE spaces SET direct_pair_key … WHERE kind = 'DIRECT' AND direct_pair_key IS NULL AND NOT EXISTS (an active space holding the key)`, answering whether it took the key. It belongs to the claim port because the claim's transaction calls it; `ClaimsDeps` and the composition root stay as they are.
- `ClaimGuestPlace` calls it after a successful claim in a `DIRECT` space, with `pairKeyOf(other member's user, claimer)`; it ignores the answer, since "both are kept" is a valid outcome.
- If a first split of the same pair inserts the key between the `NOT EXISTS` check and the update, `spaces_direct_pair_uq` refuses the update and the claim answers `500` (rare; documented like Self-Review assumption 5).

**Files:**
- Modify: `src/modules/spaces/application/space-member-repository.ts`, `src/modules/spaces/application/claim-guest-place.ts`, `src/modules/spaces/infrastructure/drizzle-space-repository.ts`, `tests/support/in-memory-spaces.ts`
- Test: `src/modules/spaces/application/claims.test.ts`, `src/modules/spaces/infrastructure/drizzle-direct-spaces.int.test.ts`

**Interfaces:**
- Consumes: `GuestClaimRepository`, `createClaimGuestPlace`, the `claims.test.ts` helpers `world`, `claimLinkFor`, `ANA`, `PEDRO` (Task 7); `pairKeyOf` (Task 12); `DirectSpaceRepository.addDirect`, `findByPairKey`, the in-memory `pairKeys` (Tasks 13, 14); the `drizzle-direct-spaces.int.test.ts` helpers `directSpace`, `pair`, `withUser`, `direct` (Task 14).
- Produces: `GuestClaimRepository.adoptPairKey(spaceId: SpaceId, pairKey: string): Promise<boolean>` on `DrizzleSpaceRepository` and `InMemorySpaceStore`; `ClaimGuestPlace` keys a claimed direct space whose pair is free.

- [ ] **Step 1: Write the failing tests**

In `src/modules/spaces/application/claims.test.ts`:

1. Insert before the line `import type { Space, SpaceId, SpaceMember } from "../domain/space";`:

```ts
import { pairKeyOf } from "../domain/direct-space";
```

2. Append to the end of the file:

```ts

describe("ClaimGuestPlace in a direct space (HU-E1-13, D16, Task 14b)", () => {
  const addDirect = (store: InMemorySpaceStore, id: string, members: SpaceMember[]) =>
    store.addDirect({ ...householdSpace(members), id: id as SpaceId, kind: "DIRECT", name: "Ana & Pedro" });

  it("makes the claimed direct space the pair's direct space, so later splits reuse it", async () => {
    const store = new InMemorySpaceStore();
    await addDirect(store, "space-direct", [ANA, PEDRO]);
    const w = world(store);
    await claimLinkFor(w, "member-pedro", "space-direct");
    unwrap(await w.claim({ token: "token-1", userId: "u-pedro" }));
    expect(await store.findByPairKey(pairKeyOf("u-ana", "u-pedro"))).toBe("space-direct");
  });

  it("leaves the key with the pair's other active direct space: both are kept, merging is deferred", async () => {
    const store = new InMemorySpaceStore();
    await addDirect(store, "space-older", [ANA, memberOf("Pedro", "OWNER", 2)]);
    await addDirect(store, "space-direct", [ANA, PEDRO]);
    const w = world(store);
    await claimLinkFor(w, "member-pedro", "space-direct");
    unwrap(await w.claim({ token: "token-1", userId: "u-pedro" }));
    expect(await store.findByPairKey(pairKeyOf("u-ana", "u-pedro"))).toBe("space-older");
  });
});
```

In `src/modules/spaces/infrastructure/drizzle-direct-spaces.int.test.ts`:

1. Add after the line `import type { DirectSpaceRepository } from "../application/direct-space-repository";`:

```ts
import type { GuestClaimRepository } from "../application/space-member-repository";
```

2. Append to the end of the file:

```ts

describe("claimed direct spaces take a free pair key (HU-E1-13, D16, Task 14b)", () => {
  const claims: GuestClaimRepository = repo;
  const pedro: DirectCounterpart = { kind: "GUEST", displayName: "Pedro", contactEmail: null };

  // Juan stands for the user who claimed the guest's place in Ana's direct space.
  it("adopts the key of a pair with no active direct space, once", async () => {
    const { ana, juan } = await pair();
    const claimed = directSpace(ana, pedro);
    await direct.addDirect(claimed);
    const key = pairKeyOf(ana.id, juan.id);
    expect(await claims.adoptPairKey(claimed.id, key)).toBe(true);
    expect(await direct.findByPairKey(key)).toBe(claimed.id);
    expect(await claims.adoptPairKey(claimed.id, pairKeyOf(ana.id, randomUUID()))).toBe(false);
  });

  it("leaves the key with the pair's active direct space and never keys a shared space", async () => {
    const { ana, juan } = await pair();
    const older = directSpace(ana, withUser(juan));
    await direct.addDirect(older);
    const claimed = directSpace(ana, pedro);
    await direct.addDirect(claimed);
    const key = pairKeyOf(ana.id, juan.id);
    expect(await claims.adoptPairKey(claimed.id, key)).toBe(false);
    expect(await direct.findByPairKey(key)).toBe(older.id);
    const shared = await sharedSpaceFixture(db, ana.id);
    expect(await claims.adoptPairKey(shared.id, pairKeyOf(ana.id, randomUUID()))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/spaces/application/claims.test.ts && pnpm exec vitest run --project integration src/modules/spaces/infrastructure/drizzle-direct-spaces.int.test.ts`
Expected: FAIL — the first new unit test finds no space under the pair key (`null`), and `claims.adoptPairKey is not a function`; the second unit test already passes (nothing adopts a key yet).

- [ ] **Step 3: Implement**

In `src/modules/spaces/application/space-member-repository.ts`, add after the line `  claimGuest(spaceId: SpaceId, claimed: SpaceMember, claimedAt: Date): Promise<ClaimOutcome>;`:

```ts
  /**
   * HU-E1-13, D16: gives the DIRECT space `spaceId` the pair key when it has none and no active space
   * holds the key yet; false otherwise (the pair already had a direct space: both are kept).
   */
  adoptPairKey(spaceId: SpaceId, pairKey: string): Promise<boolean>;
```

In `src/modules/spaces/application/claim-guest-place.ts`:

1. Insert before the line `import { ensureClaimable, isClaim, markAccepted } from "../domain/invitation";`:

```ts
import { pairKeyOf } from "../domain/direct-space";
```

2. Add after the line `      if (outcome === "notAGuest") return err(domainError("GuestAlreadyClaimed"));`:

```ts
      // D16: a guest's direct space that now holds two users becomes their pair's direct space, unless the
      // pair already has an active one (then both are kept; merging is deferred).
      const other = current.find((m) => m.id !== claimed.value.id);
      if (spaceKind === "DIRECT" && other?.userId) {
        await deps.claims.adoptPairKey(claim.spaceId, pairKeyOf(other.userId, input.userId));
      }
```

In `tests/support/in-memory-spaces.ts`, insert before the line `  /** Test setup: a space as earlier use cases would have left it. */`:

```ts
  /** GuestClaimRepository, like DrizzleSpaceRepository.adoptPairKey. */
  async adoptPairKey(spaceId: string, pairKey: string): Promise<boolean> {
    const space = this.spaces.find((s) => s.id === spaceId);
    if (space?.kind !== "DIRECT" || this.pairKeys.has(spaceId)) return false;
    if ((await this.findByPairKey(pairKey)) !== null) return false;
    this.pairKeys.set(spaceId, pairKey);
    return true;
  }

```

In `src/modules/spaces/infrastructure/drizzle-space-repository.ts`, insert before the last line of the file (`}`):

```ts

  async adoptPairKey(spaceId: SpaceId, pairKey: string): Promise<boolean> {
    const adopted = await this.tm
      .executor()
      .update(spaces)
      .set({ directPairKey: pairKey })
      .where(
        and(
          eq(spaces.id, spaceId),
          eq(spaces.kind, "DIRECT"),
          isNull(spaces.directPairKey),
          // spaces_direct_pair_uq: no active space holds the key yet (D16: otherwise both are kept).
          sql`NOT EXISTS (SELECT 1 FROM spaces s WHERE s.direct_pair_key = ${pairKey} AND s.archived_at IS NULL)`,
        ),
      )
      .returning({ id: spaces.id });
    return adopted.length > 0;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/spaces && pnpm exec vitest run --project integration src/modules/spaces/infrastructure`
Expected: PASS, Task 7's claim tests and Task 9's twin comparison included. Mutation checks: temporarily delete the `adoptPairKey` call of `claim-guest-place.ts` — "makes the claimed direct space the pair's direct space" fails (`null`); temporarily delete the `NOT EXISTS` condition — "leaves the key with the pair's active direct space" fails with a unique violation on `spaces_direct_pair_uq`; restore both.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (`tsc` checks both adapters against the widened `GuestClaimRepository` through the typed `claims` constants and `invitationsWorld().claims`).

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/application/space-member-repository.ts src/modules/spaces/application/claim-guest-place.ts src/modules/spaces/application/claims.test.ts src/modules/spaces/infrastructure/drizzle-space-repository.ts src/modules/spaces/infrastructure/drizzle-direct-spaces.int.test.ts tests/support/in-memory-spaces.ts
git commit -m "feat(spaces): make a claimed direct space the pair's direct space (Refs #20, Refs #22)"
```

---

### Task 15: HTTP — direct splits

Exposes HU-E1-13 (issue #22): `POST /api/v1/direct-splits` → `201 { spaceId, created, expense: RecordedExpense }`, honouring `Idempotency-Key`. The composition root binds the `SplitWithPerson` recorder to the ledger's new `RecordExpenseByCategoryKey`, which resolves the category by catalog key and calls `RecordExpense`. Pins Review Focus 3 over HTTP. Size ~800 lines (about 200 of them the generated OpenAPI operation): commit it as **15a** (Steps 1–4: the ledger contract helpers of the body and response and `RecordExpenseByCategoryKey`, with their unit tests; no path yet, so no snapshot change), **15b** (Steps 5–8: the path, route, container binding, snapshot and the `@critical` test), **15c** (Steps 9–10: the other positive scenarios) and **15d** (Steps 11–13: the `problem.test.ts` rows, the splits that cannot happen, and the reuse of a claimed direct space from Task 14b), each green and with its own RDD pass.

Decisions:
- The body names the counterpart (`{ "kind": "MEMBER", "memberId" }` or `{ "kind": "GUEST", "displayName", "contactEmail"? }`) and the expense: `description`, `date`, `amount`, `accountId` (the requester's own account, required) and `categoryKey`. The requester pays the whole amount and it is shared EQUAL between both people (spec 5.3 default split): a client cannot name member ids or category ids of a space that does not exist yet, so other split methods and payers are recorded afterwards in the direct space (`POST /spaces/{id}/expenses`, M2-B; Self-Review, contradiction 6). The category is a catalog key of the default categories every direct space is seeded with (HU-E3-01, D11), e.g. `restaurants`; an unknown key answers `404 CategoryNotFound`, an archived one `409 CategoryArchived` (M1's `usableCategory`).
- The body and response live in the ledger contract (the endpoint records a transaction, and a `spaces` contract may not import the ledger's), with `DirectSplitExpense` as the type the composition root records. The response reuses the `RecordedExpense` component inside an inline object; the `location` and `etag` headers are the expense's (`transactionHeaders`).
- Resolving a catalog key is ledger logic, not wiring: `RecordExpenseByCategoryKey` (ledger application) authorizes the writer first (non-members still get `SpaceNotFound`), looks the key up through a `CategoryKeyReader` port and calls `RecordExpense` with the category id. The composition root only binds the port to the categories repository (like the existing `categories.find` adapter) and passes the same `recordExpense` instance the ledger exposes, inside `SplitWithPerson`'s transaction, so a refused expense rolls the new direct space back.
- `RecordExpense`'s rules apply unchanged inside the direct space: `money.record` (both registered members are OWNER), `AccountNotOwned` (D9) and the default EQUAL split among its two current members.

**Files:**
- 15a — Create: `src/modules/ledger/application/record-expense-by-category-key.ts`; Modify: `src/modules/ledger/application/index.ts`, `src/modules/ledger/contracts/ledger.contract.ts`; Test: `src/modules/ledger/application/record-expense-by-category-key.test.ts`, `src/modules/ledger/contracts/ledger.contract.test.ts`
- 15b — Create: `src/app/api/v1/direct-splits/route.ts`; Modify: `src/modules/ledger/contracts/ledger.contract.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`; Test: `tests/acceptance/direct-splits.test.ts` (created)
- 15c — Test: `tests/acceptance/direct-splits.test.ts` (extended)
- 15d — Modify: `src/shared/http/problem.test.ts`; Test: `tests/acceptance/direct-splits.test.ts` (extended)

**Interfaces:**
- Consumes: `createSplitWithPerson`, `SplitWithPerson`, `DirectSplit`, `DirectSplitCounterpart` (Task 13); `DrizzleSpaceRepository.findCurrentMember`, `findByPairKey`, `addDirect` (Task 14), `adoptPairKey` (Task 14b); `createRecordExpense`, `RecordExpense`, `RecordedExpense`, `RecordExpenseInput`, `authorizeWriter`, `LedgerCategory` (M1, M2-B); `RecordedExpenseSchema`, `recordedExpenseDto`, `transactionHeaders`, `IdempotencyHeader`, `invalidMoney` (ledger contract); `withIdempotency` (M0); `onSpaceCreated`, `categoriesDeps` (composition root); `ledgerFixture`, `ACCOUNTS`, `CATEGORIES` (`tests/support/in-memory-ledger.ts`); `claimLink`, `joinAs`, `newSharedSpace` (`tests/support/spaces.ts`); the claims accept route (Task 10b), the leave route (Task 4.2), the guest removal route (Task 11), the role route (M2-A).
- Produces:
  - `interface CategoryKeyReader { findByKey(spaceId: string, key: string): Promise<LedgerCategory | null> }`; `type RecordExpenseByCategoryKeyInput = Omit<RecordExpenseInput, "categoryId"> & { categoryKey: string }`; `type RecordExpenseByCategoryKey = (input: RecordExpenseByCategoryKeyInput) => Promise<Result<RecordedExpense>>`; `createRecordExpenseByCategoryKey(deps: Pick<LedgerDeps, "access"> & { categoryKeys: CategoryKeyReader }, recordExpense: RecordExpense)` — errors `SpaceNotFound`, `InsufficientRole`, `CategoryNotFound`, plus whatever `RecordExpense` answers
  - `DirectSplitBodySchema`, `DirectSplitSchema`, `type DirectSplitExpense = Pick<RecordExpenseInput, "description" | "date" | "amount" | "accountId"> & { categoryKey: string }`, `directSplitFromBody(body)`, `directSplitDto(split: DirectSplit<RecordedExpense>)`; `POST /api/v1/direct-splits`; `Container.spaces.splitWithPerson: SplitWithPerson<DirectSplitExpense, RecordedExpense>`.

#### 15a — the ledger side: catalog keys and the direct-split body

- [ ] **Step 1: Write the failing unit tests**

`src/modules/ledger/application/record-expense-by-category-key.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import { createRecordExpense } from "./record-expense";
import { createRecordExpenseByCategoryKey } from "./record-expense-by-category-key";

/** Ana's personal space, whose "groceries" category was seeded under that catalog key (D11). */
const setup = () => {
  const fixture = ledgerFixture();
  const record = createRecordExpenseByCategoryKey(
    {
      access: fixture.deps.access,
      categoryKeys: {
        findByKey: async (spaceId, key) =>
          spaceId === "space-ana" && key === "groceries" ? { id: CATEGORIES.groceries.id, archived: false } : null,
      },
    },
    createRecordExpense(fixture.deps),
  );
  return { ...fixture, record };
};
const market = {
  spaceId: "space-ana",
  userId: "u-ana",
  amount: money(5_000_000n),
  accountId: ACCOUNTS.bancolombia.id,
};

describe("RecordExpenseByCategoryKey (HU-E1-13, D11)", () => {
  it("records the expense in the category seeded with that key", async () => {
    const { record, store } = setup();
    const recorded = unwrap(await record({ ...market, categoryKey: "groceries" }));
    expect(recorded.expense).toMatchObject({ categoryId: CATEGORIES.groceries.id, amount: 5_000_000n });
    expect(store.rows).toHaveLength(1);
  });

  it("answers CategoryNotFound for an unknown key and records nothing", async () => {
    const { record, store } = setup();
    expect(codeOf(await record({ ...market, categoryKey: "no-such-key" }))).toBe("CategoryNotFound");
    expect(store.rows).toEqual([]);
  });

  it("hides another space from non-members before looking at its categories", async () => {
    const { record } = setup();
    const elsewhere = { ...market, spaceId: "space-juan", categoryKey: "no-such-key" };
    expect(codeOf(await record(elsewhere))).toBe("SpaceNotFound");
  });
});
```

`src/modules/ledger/contracts/ledger.contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { DirectSplitBodySchema, directSplitFromBody } from "./ledger.contract";

const body = (overrides: Record<string, unknown> = {}) =>
  DirectSplitBodySchema.parse({
    counterpart: { kind: "GUEST", displayName: "Pedro" },
    description: "Dinner",
    date: "2026-10-14",
    categoryKey: "restaurants",
    amount: { amount: "12000000", currency: "COP" },
    accountId: "acc-bancolombia",
    ...overrides,
  });

describe("direct-split bodies (HU-E1-13)", () => {
  it("names a new guest, or a member, and keeps the expense as RecordExpenseByCategoryKey takes it", () => {
    expect(unwrap(directSplitFromBody(body()))).toEqual({
      counterpart: { guest: { displayName: "Pedro", contactEmail: undefined } },
      expense: {
        description: "Dinner",
        date: "2026-10-14",
        amount: money(12_000_000n),
        accountId: "acc-bancolombia",
        categoryKey: "restaurants",
      },
    });
    const member = body({ counterpart: { kind: "MEMBER", memberId: "member-pedro" } });
    expect(unwrap(directSplitFromBody(member)).counterpart).toEqual({ memberId: "member-pedro" });
  });

  it("refuses currencies the kernel does not know", () => {
    const unknown = body({ amount: { amount: "100", currency: "XYZ" } });
    expect(codeOf(directSplitFromBody(unknown))).toBe("UnknownCurrency");
  });

  it("refuses a counterpart of another kind at the edge", () => {
    expect(DirectSplitBodySchema.safeParse({ ...body(), counterpart: { kind: "FRIEND" } }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/record-expense-by-category-key.test.ts src/modules/ledger/contracts/ledger.contract.test.ts`
Expected: FAIL — `Failed to resolve import "./record-expense-by-category-key"`, and `DirectSplitBodySchema` is undefined (`Cannot read properties of undefined (reading 'parse')`).

- [ ] **Step 3: Implement 15a**

`src/modules/ledger/application/record-expense-by-category-key.ts`:

```ts
import { domainError, err, type Result } from "@/shared/kernel";
import { authorizeWriter } from "./checks";
import type { LedgerDeps } from "./deps";
import type { LedgerCategory } from "./ports";
import type { RecordedExpense, RecordExpense, RecordExpenseInput } from "./record-expense";

/** Categories by their catalog key (D11); bound to the categories module by the composition root. */
export interface CategoryKeyReader {
  /** The category of the space seeded with `key`, archived ones included; null otherwise. */
  findByKey(spaceId: string, key: string): Promise<LedgerCategory | null>;
}

export type RecordExpenseByCategoryKeyInput = Omit<RecordExpenseInput, "categoryId"> & {
  readonly categoryKey: string;
};

export type RecordExpenseByCategoryKey = (
  input: RecordExpenseByCategoryKeyInput,
) => Promise<Result<RecordedExpense>>;

/**
 * HU-E1-13: records an expense whose category is named by its catalog key (D11), as a direct split does in
 * a direct space whose category ids the client cannot know yet. The writer is authorized before any
 * category is looked up, so non-members still get SpaceNotFound (spec 8).
 */
export const createRecordExpenseByCategoryKey =
  (
    deps: Pick<LedgerDeps, "access"> & { readonly categoryKeys: CategoryKeyReader },
    recordExpense: RecordExpense,
  ): RecordExpenseByCategoryKey =>
  async ({ categoryKey, ...input }) => {
    const writer = await authorizeWriter(deps, input.spaceId, input.userId);
    if (!writer.ok) return writer;
    const category = await deps.categoryKeys.findByKey(writer.value.spaceId, categoryKey);
    if (category === null) return err(domainError("CategoryNotFound"));
    return recordExpense({ ...input, categoryId: category.id });
  };
```

Append to `src/modules/ledger/application/index.ts`:

```ts
export {
  createRecordExpenseByCategoryKey,
  type CategoryKeyReader,
  type RecordExpenseByCategoryKey,
  type RecordExpenseByCategoryKeyInput,
} from "./record-expense-by-category-key";
```

In `src/modules/ledger/contracts/ledger.contract.ts`:

1. Add after the line `} from "../application";`:

```ts
import type { DirectSplit, DirectSplitCounterpart } from "@/modules/spaces/application";
```

2. Insert before the line `const SpacePath = z.object({ spaceId: z.string() });`:

```ts
/** HU-E1-13: whom the requester splits with: a member of a space they share, or a new guest. */
const DirectCounterpartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MEMBER"), memberId: Id }),
  z.object({
    kind: z.literal("GUEST"),
    displayName: z.string().max(200),
    contactEmail: z.email().max(254).optional(),
  }),
]);

/**
 * HU-E1-13: the requester pays the whole amount from one of their own accounts and it is shared EQUAL
 * with the other person (spec 5.3). The category is a catalog key of the default categories every direct
 * space is seeded with (HU-E3-01, D11), since a new space's category ids are not known yet.
 */
export const DirectSplitBodySchema = z.object({
  counterpart: DirectCounterpartSchema,
  description: Description,
  date: z.iso.date().optional(),
  categoryKey: z.string().min(1).max(64),
  amount: MoneySchema,
  accountId: Id,
});
type DirectSplitBody = z.infer<typeof DirectSplitBodySchema>;

/** A direct split's expense as the composition root hands it to RecordExpenseByCategoryKey. */
export type DirectSplitExpense = Pick<RecordExpenseInput, "description" | "date" | "amount" | "accountId"> & {
  readonly categoryKey: string;
};

export const directSplitFromBody = (
  body: DirectSplitBody,
): Result<{ counterpart: DirectSplitCounterpart; expense: DirectSplitExpense }> => {
  const amount = moneyFromDto(body.amount);
  if (!amount.ok) return amount;
  const date = optionalLocalDate(body.date);
  if (!date.ok) return date;
  const { counterpart } = body;
  return ok({
    counterpart:
      counterpart.kind === "MEMBER"
        ? { memberId: counterpart.memberId }
        : { guest: { displayName: counterpart.displayName, contactEmail: counterpart.contactEmail } },
    expense: {
      description: body.description,
      date: date.value,
      amount: amount.value,
      accountId: body.accountId,
      categoryKey: body.categoryKey,
    },
  });
};

/** The direct space the split was recorded in, whether this split created it, and the expense. */
export const DirectSplitSchema = z.object({
  spaceId: z.string(),
  created: z.boolean(),
  expense: RecordedExpenseSchema,
});

export const directSplitDto = (split: DirectSplit<RecordedExpense>): z.infer<typeof DirectSplitSchema> => ({
  spaceId: split.spaceId,
  created: split.created,
  expense: recordedExpenseDto(split.recorded),
});

```

- [ ] **Step 4: Run the tests to verify they pass, gates and commit 15a**

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: PASS. Mutation check: temporarily move the `authorizeWriter` call after `findByKey` in `record-expense-by-category-key.ts` — "hides another space from non-members" fails with `CategoryNotFound`; restore it.

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0; the OpenAPI snapshot test passes unchanged (no path uses the new schemas yet), and `modules-only-through-public-application-api` holds (the ledger contract imports `@/modules/spaces/application`).

```bash
git add src/modules/ledger/application/record-expense-by-category-key.ts src/modules/ledger/application/record-expense-by-category-key.test.ts src/modules/ledger/application/index.ts src/modules/ledger/contracts/ledger.contract.ts src/modules/ledger/contracts/ledger.contract.test.ts
git commit -m "feat(ledger): record an expense by category key and read direct-split bodies (Refs #22)"
```

#### 15b — the endpoint

- [ ] **Step 5: Write the failing acceptance test**

`tests/acceptance/direct-splits.test.ts` (15b writes it with what the `@critical` scenario uses; 15c and 15d extend it):

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as directSplit } from "@/app/api/v1/direct-splits/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { GET as getSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type TestUser } from "../support/app";
import { balancesOf, cop, newAccount, type TransactionDto } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface DirectSplitDto {
  spaceId: string;
  created: boolean;
  expense: TransactionDto & { warnings: unknown[] };
}
interface MemberDto {
  id: string;
  kind: string;
  userId: string | null;
  displayName: string;
  role: string | null;
}
type Counterpart =
  | { kind: "MEMBER"; memberId: string }
  | { kind: "GUEST"; displayName: string; contactEmail?: string };

/** A direct split paid in full from `accountId`, dated 2026-10-14, in the seeded category "restaurants". */
const splitBody = (
  accountId: string,
  counterpart: Counterpart,
  description: string,
  pesos: number,
  overrides: Record<string, unknown> = {},
) => ({
  counterpart,
  description,
  date: "2026-10-14",
  categoryKey: "restaurants",
  amount: cop(pesos),
  accountId,
  ...overrides,
});
const split = (user: TestUser, body: unknown, headers: Record<string, string> = {}) =>
  call(directSplit, "POST", "/api/v1/direct-splits", { user, body, headers });
const splitOk = async (response: Response): Promise<DirectSplitDto> => {
  expect(response.status).toBe(201);
  return (await response.json()) as DirectSplitDto;
};
const membersOf = async (user: TestUser, spaceId: string): Promise<MemberDto[]> => {
  const response = await call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, {
    user,
    params: { spaceId },
  });
  return ((await response.json()) as { items: MemberDto[] }).items;
};
/** HU-E1-13 Background: Ana is signed in with her account "Bancolombia". */
const anaWithBancolombia = async () => {
  const ana = await registerUser("Ana");
  return { ana, bancolombia: await newAccount(ana, "Bancolombia", 2_000_000) };
};
const pedroAsGuest: Counterpart = { kind: "GUEST", displayName: "Pedro" };

describe("split with one person through a direct space (HU-E1-13)", () => {
  it("creates 'Ana & Pedro' on the first split with the new guest Pedro, who owes Ana 60,000 COP (@critical)", async () => {
    const { ana, bancolombia } = await anaWithBancolombia();
    const dinner = await splitOk(await split(ana, splitBody(bancolombia, pedroAsGuest, "Dinner", 120_000)));
    expect(dinner.created).toBe(true);
    const space = await call(getSpace, "GET", `/api/v1/spaces/${dinner.spaceId}`, {
      user: ana,
      params: { spaceId: dinner.spaceId },
    });
    expect(await space.json()).toEqual({
      id: dinner.spaceId,
      name: "Ana & Pedro",
      kind: "DIRECT",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
      role: "OWNER",
    });
    const members = await membersOf(ana, dinner.spaceId);
    expect(members.map((m) => [m.displayName, m.kind, m.role])).toEqual([
      ["Ana", "USER", "OWNER"],
      ["Pedro", "GUEST", null],
    ]);
    const [anaId, pedroId] = members.map((m) => m.id) as [string, string];
    expect(dinner.expense).toMatchObject({
      description: "Dinner",
      amount: cop(120_000),
      payments: [{ memberId: anaId, accountId: bancolombia, amount: cop(120_000) }],
      shares: [
        { memberId: anaId, amount: cop(60_000), splitMethod: "EQUAL" },
        { memberId: pedroId, amount: cop(60_000), splitMethod: "EQUAL" },
      ],
      warnings: [],
    });
    expect(await balancesOf(ana, dinner.spaceId)).toEqual([
      [anaId, cop(60_000)],
      [pedroId, cop(-60_000)],
    ]);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/direct-splits.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/direct-splits/route"`.

- [ ] **Step 7: Path, route and wiring**

In `src/modules/ledger/contracts/ledger.contract.ts`, insert before the last line of the file (`};`):

```ts
  "/api/v1/direct-splits": {
    post: {
      operationId: "splitWithPerson",
      summary: "Split an expense with one person through your two-member direct space, created on first use",
      ...securedByUser,
      requestParams: { header: IdempotencyHeader },
      requestBody: { content: jsonContent(DirectSplitBodySchema) },
      responses: {
        "201": {
          description: "The direct space, whether this split created it, and the recorded expense",
          content: jsonContent(DirectSplitSchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "404": "MemberNotFound, CategoryNotFound, AccountNotFound",
          "409": "MemberNameTaken, AccountArchived, CategoryArchived, SpaceArchived, IdempotencyKeyConflict",
          "422": `${invalidMoney}, InvalidMemberName, InvalidDirectCounterpart, AccountNotOwned`,
        }),
      },
    },
  },
```

`src/app/api/v1/direct-splits/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  DirectSplitBodySchema,
  directSplitDto,
  directSplitFromBody,
  transactionHeaders,
} from "@/modules/ledger/contracts/ledger.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: DirectSplitBodySchema,
  before: withIdempotency,
  handler: async ({ user, body }) => {
    const fields = directSplitFromBody(body);
    if (!fields.ok) return fields;
    const result = await getContainer().spaces.splitWithPerson({
      userId: user!.id,
      userName: user!.name,
      locale: user!.locale,
      ...fields.value,
    });
    return result.ok
      ? ok({
          status: 201,
          body: directSplitDto(result.value),
          headers: transactionHeaders(result.value.recorded.expense),
        })
      : result;
  },
});
```

In `src/composition/container.ts`:

1. Add after the line `  createRecordExpense,` (in the `@/modules/ledger/application` import):

```ts
  createRecordExpenseByCategoryKey,
```

2. Add after the line `  type RecordExpense,`:

```ts
  type RecordedExpense,
```

3. Add after the line `import { DrizzleTransactionRepository } from "@/modules/ledger/infrastructure/drizzle-transaction-repository";`:

```ts
import type { DirectSplitExpense } from "@/modules/ledger/contracts/ledger.contract";
```

4. Add after the line `  createUpdateSpaceSettings,`:

```ts
  createSplitWithPerson,
```

5. Add after the line `  type UpdateSpaceSettings,`:

```ts
  type SplitWithPerson,
```

6. Add after the line `    readonly changeMemberRole: ChangeMemberRole;`:

```ts
    readonly splitWithPerson: SplitWithPerson<DirectSplitExpense, RecordedExpense>;
```

7. Insert before the line `  // HU-E3-01: default categories in the creator's locale, seeded in the same transaction as the space.`:

```ts
  const recordExpense = createRecordExpense(ledgerDeps);
  // HU-E1-13: a client cannot know a new direct space's category ids, so it names a catalog key (D11).
  const recordExpenseByCategoryKey = createRecordExpenseByCategoryKey(
    {
      access,
      categoryKeys: {
        findByKey: async (spaceId, key) => {
          const category = (await categoriesDeps.categories.listCategories(spaceId)).find((c) => c.key === key);
          return category ? { id: category.id, archived: category.archivedAt !== null } : null;
        },
      },
    },
    recordExpense,
  );
```

8. Replace the line `      recordExpense: createRecordExpense(ledgerDeps),` with:

```ts
      recordExpense,
```

9. Add after the line `      changeMemberRole: createChangeMemberRole(membersDeps),`:

```ts
      splitWithPerson: createSplitWithPerson<DirectSplitExpense, RecordedExpense>({
        access,
        spaces: spaceRepository,
        direct: spaceRepository,
        onCreated: onSpaceCreated,
        recordExpense: ({ spaceId, userId, expense }) => recordExpenseByCategoryKey({ spaceId, userId, ...expense }),
        ids,
        clock,
        tm,
      }),
```

- [ ] **Step 8: Run the tests, refresh the snapshot, gates and commit 15b**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/direct-splits.test.ts`
Expected: PASS.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `POST /api/v1/direct-splits` (about 200 lines, mostly the request body's two counterpart shapes); components are unchanged (the response references `RecordedExpense`; no `…Output` component appears).

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (`tsc` checks `DrizzleSpaceRepository` against `DirectSpaceRepository` where it is bound).

```bash
git add src/app/api/v1/direct-splits/route.ts src/modules/ledger/contracts/ledger.contract.ts src/composition/container.ts tests/acceptance/direct-splits.test.ts openapi/openapi.snapshot.json
git commit -m "feat(spaces): split with one person through a direct space over HTTP (Refs #22)"
```

#### 15c — direct spaces reused and kept at two members

- [ ] **Step 9: Extend the acceptance test**

In `tests/acceptance/direct-splits.test.ts`:

1. Add after the line `import { POST as directSplit } from "@/app/api/v1/direct-splits/route";`:

```ts
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as addGuestMember } from "@/app/api/v1/spaces/[spaceId]/guests/route";
import { POST as createInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/route";
```

2. Add after the line `import { GET as getSpace } from "@/app/api/v1/spaces/[spaceId]/route";`:

```ts
import { GET as listSpaces } from "@/app/api/v1/spaces/route";
```

3. Replace the line `import { call, registerUser, startTestApp, type TestUser } from "../support/app";` with:

```ts
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
```

4. Replace the line `import { balancesOf, cop, newAccount, type TransactionDto } from "../support/ledger";` with:

```ts
import {
  balancesOf,
  categoryWithKey,
  cop,
  household,
  newAccount,
  post,
  type TransactionDto,
} from "../support/ledger";
import { actingIn } from "../support/spaces";
```

5. Insert before the line `/** HU-E1-13 Background: Ana is signed in with her account "Bancolombia". */`:

```ts
const directSpacesOf = async (user: TestUser) => {
  const response = await call(listSpaces, "GET", "/api/v1/spaces", { user });
  const { items } = (await response.json()) as { items: { id: string; kind: string }[] };
  return items.filter((s) => s.kind === "DIRECT");
};
```

6. Append to the end of the file:

```ts

describe("direct spaces are reused and keep their two members (HU-E1-13, D16)", () => {
  it("reuses 'Ana & Pedro' for a later 40,000 COP split with Pedro, who then owes Ana 80,000 COP", async () => {
    const { ana, bancolombia } = await anaWithBancolombia();
    const dinner = await splitOk(await split(ana, splitBody(bancolombia, pedroAsGuest, "Dinner", 120_000)));
    const pedroId = (await membersOf(ana, dinner.spaceId))[1]!.id;
    const pickPedro: Counterpart = { kind: "MEMBER", memberId: pedroId };
    const taxi = await splitOk(await split(ana, splitBody(bancolombia, pickPedro, "Taxi", 40_000)));
    expect(taxi).toMatchObject({ spaceId: dinner.spaceId, created: false });
    expect(await directSpacesOf(ana)).toHaveLength(1);
    expect((await balancesOf(ana, dinner.spaceId)).map(([, net]) => net)).toEqual([cop(80_000), cop(-80_000)]);
  });

  it("creates 'Ana & Juan' with both registered as OWNER, and Juan's later split with Ana reuses it", async () => {
    const h = await household();
    const pickJuan: Counterpart = { kind: "MEMBER", memberId: h.juan.memberId };
    const lunch = await splitOk(await split(h.ana, splitBody(h.ana.account, pickJuan, "Lunch", 90_000)));
    expect(lunch.created).toBe(true);
    expect((await membersOf(h.ana, lunch.spaceId)).map((m) => [m.userId, m.kind, m.role])).toEqual([
      [h.ana.userId, "USER", "OWNER"],
      [h.juan.userId, "USER", "OWNER"],
    ]);
    const space = await call(getSpace, "GET", `/api/v1/spaces/${lunch.spaceId}`, {
      user: h.juan,
      params: { spaceId: lunch.spaceId },
    });
    expect(await space.json()).toMatchObject({ name: "Ana & Juan", kind: "DIRECT", role: "OWNER" });
    // Juan owes Ana 45,000 COP.
    expect((await balancesOf(h.juan, lunch.spaceId)).map(([, net]) => net)).toEqual([cop(45_000), cop(-45_000)]);
    const pickAna: Counterpart = { kind: "MEMBER", memberId: h.ana.memberId };
    const coffee = await splitOk(await split(h.juan, splitBody(h.juan.account, pickAna, "Coffee", 20_000)));
    expect(coffee).toMatchObject({ spaceId: lunch.spaceId, created: false });
  });

  it("splits a later expense recorded without a split method EQUAL between Ana and Pedro", async () => {
    const { ana, bancolombia } = await anaWithBancolombia();
    const dinner = await splitOk(await split(ana, splitBody(bancolombia, pedroAsGuest, "Dinner", 120_000)));
    const inDirect = actingIn(ana, dinner.spaceId);
    const later = await post(recordExpense, inDirect, "expenses", {
      description: "Snacks",
      date: "2026-10-15",
      categoryId: await categoryWithKey(inDirect, "restaurants"),
      amount: cop(30_000),
      accountId: bancolombia,
    });
    expect(later.status).toBe(201);
    const [anaId, pedroId] = (await membersOf(ana, dinner.spaceId)).map((m) => m.id);
    expect(((await later.json()) as TransactionDto).shares).toEqual([
      { memberId: anaId, amount: cop(15_000), splitMethod: "EQUAL" },
      { memberId: pedroId, amount: cop(15_000), splitMethod: "EQUAL" },
    ]);
  });

  it("never lets 'Ana & Pedro' get a third member, as a guest or by invitation (D16)", async () => {
    const { ana, bancolombia } = await anaWithBancolombia();
    const { spaceId } = await splitOk(await split(ana, splitBody(bancolombia, pedroAsGuest, "Dinner", 120_000)));
    const guest = await call(addGuestMember, "POST", `/api/v1/spaces/${spaceId}/guests`, {
      user: ana,
      params: { spaceId },
      body: { displayName: "Luis" },
    });
    expect(await problemOf(guest)).toEqual([409, "DirectSpaceIsFull"]);
    const invitation = await call(createInvitation, "POST", `/api/v1/spaces/${spaceId}/invitations`, {
      user: ana,
      params: { spaceId },
      body: { kind: "EMAIL", email: "juan@example.com", role: "MEMBER" },
    });
    expect(await problemOf(invitation)).toEqual([409, "DirectSpaceIsFull"]);
  });
});
```

- [ ] **Step 10: Run the tests, gates and commit 15c**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/direct-splits.test.ts`
Expected: PASS with no production change (a red test here is a bug in Tasks 12–15b, fixed in this commit).

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

```bash
git add tests/acceptance/direct-splits.test.ts
git commit -m "test(spaces): pin the reuse and the two members of direct spaces over HTTP (Refs #22)"
```

#### 15d — splits that cannot happen, and a claimed direct space reused

- [ ] **Step 11: Extend the tests**

In `src/shared/http/problem.test.ts`, add after the line `    ["PersonalSpaceNotShareable", 409],`:

```ts
    ["DirectSpaceIsFull", 409],
    ["DirectSpaceMembersFixed", 409],
    ["InvalidDirectCounterpart", 422],
```

In `tests/acceptance/direct-splits.test.ts`:

1. Insert before the line `import { POST as directSplit } from "@/app/api/v1/direct-splits/route";`:

```ts
import { POST as acceptClaim } from "@/app/api/v1/claims/[token]/accept/route";
```

2. Add after the line `import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";`:

```ts
import { DELETE as removeGuestMember } from "@/app/api/v1/spaces/[spaceId]/guests/[memberId]/route";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { PATCH as changeRole } from "@/app/api/v1/spaces/[spaceId]/members/[memberId]/route";
```

3. In the import from `../support/ledger`, insert before the line `  balancesOf,`:

```ts
  addGuest,
```

and add after the line `  household,`:

```ts
  memberIdOf,
```

4. Replace the line `import { actingIn } from "../support/spaces";` with:

```ts
import { actingIn, claimLink, joinAs, newSharedSpace } from "../support/spaces";
```

5. Append to the end of the file:

```ts

describe("direct splits that cannot happen (HU-E1-13, Review Focus 3)", () => {
  it("answers 404 MemberNotFound for someone Ana shares no space with and for unknown or malformed ids", async () => {
    const { ana, bancolombia } = await anaWithBancolombia();
    const marta = await registerUser("Marta");
    const martasSpace = await newSharedSpace(marta, "Marta's");
    const martaId = await memberIdOf(marta, martasSpace, "Marta");
    for (const memberId of [martaId, "0190a0b0-0000-7000-8000-000000000000", "not-a-uuid"]) {
      const response = await split(ana, splitBody(bancolombia, { kind: "MEMBER", memberId }, "Dinner", 120_000));
      expect(await problemOf(response)).toEqual([404, "MemberNotFound"]);
    }
    expect(await directSpacesOf(ana)).toEqual([]);
  });

  it("refuses splitting with herself or with a guest of a shared space (422 InvalidDirectCounterpart)", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    for (const memberId of [h.ana.memberId, pedro]) {
      const response = await split(h.ana, splitBody(h.ana.account, { kind: "MEMBER", memberId }, "Dinner", 120_000));
      expect(await problemOf(response)).toEqual([422, "InvalidDirectCounterpart"]);
    }
  });

  it("refuses a new guest named like Ana with 409 MemberNameTaken and creates no space", async () => {
    const { ana, bancolombia } = await anaWithBancolombia();
    const namesake: Counterpart = { kind: "GUEST", displayName: "ana" };
    expect(await problemOf(await split(ana, splitBody(bancolombia, namesake, "Dinner", 120_000)))).toEqual([
      409,
      "MemberNameTaken",
    ]);
    expect(await directSpacesOf(ana)).toEqual([]);
  });

  it("leaves no direct space behind when the expense is refused", async () => {
    const h = await household();
    const unknownCategory = splitBody(h.ana.account, pedroAsGuest, "Dinner", 120_000, { categoryKey: "no-such-key" });
    expect(await problemOf(await split(h.ana, unknownCategory))).toEqual([404, "CategoryNotFound"]);
    const juansAccount = splitBody(h.juan.account, pedroAsGuest, "Dinner", 120_000);
    expect(await problemOf(await split(h.ana, juansAccount))).toEqual([422, "AccountNotOwned"]);
    expect(await directSpacesOf(h.ana)).toEqual([]);
  });

  it("replays a retried split with the same Idempotency-Key, creating one space and one expense", async () => {
    const { ana, bancolombia } = await anaWithBancolombia();
    const body = splitBody(bancolombia, pedroAsGuest, "Dinner", 120_000);
    const headers = { "idempotency-key": "split-dinner-1" };
    const first = await splitOk(await split(ana, body, headers));
    expect(await splitOk(await split(ana, body, headers))).toEqual(first);
    expect(await directSpacesOf(ana)).toHaveLength(1);
    expect((await balancesOf(ana, first.spaceId)).map(([, net]) => net)).toEqual([cop(60_000), cop(-60_000)]);
    const conflicting = await split(ana, { ...body, description: "Lunch" }, headers);
    expect(await problemOf(conflicting)).toEqual([409, "IdempotencyKeyConflict"]);
  });

  it("keeps the two members fixed: leaving, removing the guest or changing a role is refused (D16)", async () => {
    const h = await household();
    const withPedro = await splitOk(await split(h.ana, splitBody(h.ana.account, pedroAsGuest, "Dinner", 120_000)));
    const pedroId = (await membersOf(h.ana, withPedro.spaceId))[1]!.id;
    const left = await call(leaveSpace, "POST", `/api/v1/spaces/${withPedro.spaceId}/leave`, {
      user: h.ana,
      params: { spaceId: withPedro.spaceId },
    });
    expect(await problemOf(left)).toEqual([409, "DirectSpaceMembersFixed"]);
    const removed = await call(removeGuestMember, "DELETE", `/api/v1/spaces/${withPedro.spaceId}/guests/${pedroId}`, {
      user: h.ana,
      params: { spaceId: withPedro.spaceId, memberId: pedroId },
    });
    expect(await problemOf(removed)).toEqual([409, "DirectSpaceMembersFixed"]);
    const pickJuan: Counterpart = { kind: "MEMBER", memberId: h.juan.memberId };
    const withJuan = await splitOk(await split(h.ana, splitBody(h.ana.account, pickJuan, "Lunch", 90_000)));
    const juanThere = (await membersOf(h.ana, withJuan.spaceId))[1]!.id;
    const demoted = await call(changeRole, "PATCH", `/api/v1/spaces/${withJuan.spaceId}/members/${juanThere}`, {
      user: h.ana,
      params: { spaceId: withJuan.spaceId, memberId: juanThere },
      body: { role: "MEMBER" },
    });
    expect(await problemOf(demoted)).toEqual([409, "DirectSpaceMembersFixed"]);
  });
});

describe("a claimed direct space is the pair's direct space (HU-E1-11, HU-E1-13, D16, Task 14b)", () => {
  it("reuses 'Ana & Pedro' after Pedro claims it, also when Ana picks him in another space they share", async () => {
    const { ana, bancolombia } = await anaWithBancolombia();
    const dinner = await splitOk(await split(ana, splitBody(bancolombia, pedroAsGuest, "Dinner", 120_000)));
    const guestId = (await membersOf(ana, dinner.spaceId))[1]!.id;
    const pedro = await registerUser("Pedro");
    const link = await claimLink(ana, dinner.spaceId, guestId);
    const claimed = await call(acceptClaim, "POST", `/api/v1/claims/${link.token}/accept`, {
      user: pedro,
      params: { token: link.token },
    });
    expect(await claimed.json()).toMatchObject({ id: dinner.spaceId, role: "OWNER" });
    // Ana and Pedro also share "Trip"; picking Pedro there finds their direct space through its pair key.
    const trip = await newSharedSpace(ana, "Trip");
    await joinAs(ana, trip, pedro, "MEMBER");
    const pickPedro: Counterpart = { kind: "MEMBER", memberId: await memberIdOf(ana, trip, "Pedro") };
    const taxi = await splitOk(await split(ana, splitBody(bancolombia, pickPedro, "Taxi", 40_000)));
    expect(taxi).toMatchObject({ spaceId: dinner.spaceId, created: false });
    expect(await directSpacesOf(ana)).toHaveLength(1);
  });
});
```

- [ ] **Step 12: Run the tests**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/direct-splits.test.ts && pnpm exec vitest run --project unit src/shared/http/problem.test.ts`
Expected: PASS with no production change (a red test here is a bug in Tasks 12–15c or 14b, fixed in this commit). Mutation checks: temporarily run the callback of `createSplitWithPerson` without `deps.tm.run(…)` around it — "leaves no direct space behind" fails on `directSpacesOf`, because the direct space is then committed before the expense is refused (the request carries no `Idempotency-Key`, so `withIdempotency` opens no transaction of its own); temporarily delete the `adoptPairKey` call of `claim-guest-place.ts` — "reuses 'Ana & Pedro' after Pedro claims it" fails (`created: true`, two direct spaces); restore both.

- [ ] **Step 13: Gates and commit 15d**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

```bash
git add src/shared/http/problem.test.ts tests/acceptance/direct-splits.test.ts
git commit -m "test(spaces): pin refused, replayed and claimed direct splits over HTTP (Refs #22)"
```

---

### Task 16: Spaces — archived spaces only read, on every path

Implements the read-only rule of HU-E1-09 (issue #18) before the archive action exists: "every write use case checks `space.archivedAt` via a shared guard" (backlog note). Pins Review Focus 4 at the guard.

Decisions:
- The guard lives in one place, `createSpaceAccess`: an archived space answers `SpaceArchived` unless the caller passes `{ readOnly: true }`. Every write path resolves access already (through `authorizeSpaceAction` or directly, e.g. `EditTransaction`, `CreateAccount`, category writes), so all of them refuse an archived space without one edit each, and a future write path is refused by default.
- `authorizeSpaceAction` passes `readOnly` only for `isReadOnly(action)`, a new matrix-level function true for `space.read` alone. The read use cases that called `deps.access` directly (`GetSpace`, `ListSpacePeriods`, `ListAccounts`, `GetAccount`, `ListCategories`, `ListTransactions`, `GetTransaction`, `ListAudit`) now authorize `space.read` through `authorizeSpaceAction`, which every role passes (same answers as before for active spaces). `ListMembers` and `GetSpaceBalances` already did.
- `findMembership` finds archived spaces and flags them (`SpaceMembership.archived`); non-members still get `SpaceNotFound` first. Leaving an archived space is a write, so it answers `SpaceArchived` (Self-Review, assumption 6).
- `AcceptInvitation` and `ClaimGuestPlace` read the space back through `SpaceAccess` after joining, so accepting an invitation or a claim link of an archived space now answers `409 SpaceArchived` and rolls back, where M2-A answered `404 SpaceNotFound` (controller ruling O5; Self-Review, contradiction 8; pinned over HTTP in Task 18b).
- `SplitWithPerson` checks that the requester shares the counterpart's space as a read (`{ readOnly: true }`): someone picked in an archived shared space is still a person the requester shares a space with, and the expense goes to their direct space, not the archived one. A direct space found that way is reused only while active; once archived, its registered member leads to the pair's active direct space or a new one (the pair key is free again, Task 14), and its guest answers `409 SpaceArchived` (a guest exists only in that space, D15). The in-memory `findByPairKey` skips archived spaces from here on, like PostgreSQL's (Task 14).
- The bare `rejects.toThrow()` of M1's "enforces one personal space per user" test, in a file this task edits, now names its constraint. Drizzle wraps PostgreSQL errors (`DrizzleQueryError`, message "Failed query…"), so the test reads `cause.constraint`.

**Files:**
- Modify: `src/modules/spaces/domain/permissions.ts`, `src/modules/spaces/application/space-settings-repository.ts`, `src/modules/spaces/application/space-access.ts`, `src/modules/spaces/application/get-space.ts`, `src/modules/spaces/application/list-space-periods.ts`, `src/modules/spaces/application/split-with-person.ts`, `src/modules/spaces/infrastructure/drizzle-space-repository.ts`, `src/modules/accounts/application/list-accounts.ts`, `src/modules/categories/application/list-categories.ts`, `src/modules/ledger/application/list-transactions.ts`, `src/modules/ledger/application/get-transaction.ts`, `src/modules/ledger/application/list-audit.ts`, `tests/support/fakes.ts`, `tests/support/in-memory-spaces.ts`
- Test: `src/modules/spaces/application/space-access.test.ts`, `src/modules/spaces/application/split-with-person.test.ts`, `src/modules/spaces/domain/permissions.test.ts`, `src/modules/spaces/infrastructure/drizzle-space-repository.int.test.ts`

**Interfaces:**
- Consumes: `SPACE_ACTIONS`, `requirePermission`, `authorizeSpaceAction` (M2-A); `InMemorySpaceStore`, `householdSpace` (`tests/support/in-memory-spaces.ts`); `split-with-person.ts`, the in-memory `findByPairKey` and the `split-with-person.test.ts` helpers `world`, `byAna` (Task 13).
- Produces:
  - `isReadOnly(action: SpaceAction): boolean` (true only for `"space.read"`)
  - `SpaceMembership.archived: boolean`
  - `type SpaceAccess = (spaceId: string, userId: string, options?: { readonly readOnly?: boolean }) => Promise<Result<SpaceMembership>>` — new error `SpaceArchived`
  - `InMemorySpaceStore.archived: Set<string>` (space ids); `membership()` (fakes) defaults `archived: false`.

- [ ] **Step 1: Write the test doubles and the failing tests**

In `tests/support/fakes.ts`, add after the line `    role: "OWNER",`:

```ts
    archived: false,
```

In `tests/support/in-memory-spaces.ts`:

1. Add after the line `  spaces: Space[] = [];`:

```ts
  /** Ids of archived spaces (HU-E1-09); PostgreSQL stores archived_at on the space. */
  readonly archived = new Set<string>();
```

2. Add after the line `      userId,` (in `findMembership`):

```ts
      archived: this.archived.has(space.id),
```

3. Replace the line `    const found = [...this.pairKeys].find(([, key]) => key === pairKey);` (Task 13's `findByPairKey`) with:

```ts
    const found = [...this.pairKeys].find(([id, key]) => key === pairKey && !this.archived.has(id));
```

In `src/modules/spaces/application/space-access.test.ts`:

1. Add after the line `import { codeOf, fakeSpaceAccess, membership, unwrap } from "../../../../tests/support/fakes";`:

```ts
import { householdSpace, InMemorySpaceStore } from "../../../../tests/support/in-memory-spaces";
import { SPACE_ACTIONS } from "../domain/permissions";
```

2. Replace the line `import { authorizeSpaceAction, MANAGERS, requirePermission, WRITERS } from "./space-access";` with:

```ts
import { authorizeSpaceAction, createSpaceAccess, MANAGERS, requirePermission, WRITERS } from "./space-access";
```

3. Append to the end of the file:

```ts

describe("archived spaces only read (HU-E1-09, Review Focus 4)", () => {
  const archivedHousehold = () => {
    const store = new InMemorySpaceStore();
    store.seed(householdSpace());
    store.archived.add("space-household");
    return createSpaceAccess(store);
  };

  it("refuses every action but reading with SpaceArchived, whatever the role", async () => {
    const access = archivedHousehold();
    for (const action of SPACE_ACTIONS.filter((a) => a !== "space.read")) {
      expect([action, codeOf(await authorizeSpaceAction(access, "space-household", "u-ana", action))]).toEqual([
        action,
        "SpaceArchived",
      ]);
    }
    const read = await authorizeSpaceAction(access, "space-household", "u-sofi", "space.read");
    expect(unwrap(read).archived).toBe(true);
  });

  it("refuses direct access, which write paths use too, unless the caller only reads", async () => {
    const access = archivedHousehold();
    expect(codeOf(await access("space-household", "u-ana"))).toBe("SpaceArchived");
    expect(codeOf(await access("space-household", "u-ana", { readOnly: true }))).toBe("ok");
  });

  it("answers SpaceNotFound to a non-member of an archived space, for writes and reads alike", async () => {
    const access = archivedHousehold();
    expect(codeOf(await access("space-household", "u-marta"))).toBe("SpaceNotFound");
    expect(codeOf(await access("space-household", "u-marta", { readOnly: true }))).toBe("SpaceNotFound");
  });
});
```

In `src/modules/spaces/application/split-with-person.test.ts`, append to the end of the file:

```ts

describe("SplitWithPerson and archived spaces (HU-E1-09, HU-E1-13, Task 16)", () => {
  it("still finds a counterpart through an archived shared space, since only their direct space is written", async () => {
    const w = world();
    w.store.archived.add("space-household");
    expect(unwrap(await w.split(byAna({ memberId: "member-juan" })))).toMatchObject({
      spaceId: "id-1",
      created: true,
    });
  });

  it("refuses the guest of an archived direct space and starts a new one for its registered member", async () => {
    const w = world();
    // "Ana & Pedro" is id-1 (members id-2, id-3); "Ana & Juan" is id-4 (members id-5, id-6).
    unwrap(await w.split(byAna({ guest: { displayName: "Pedro" } })));
    unwrap(await w.split(byAna({ memberId: "member-juan" })));
    w.store.archived.add("id-1");
    w.store.archived.add("id-4");
    expect(codeOf(await w.split(byAna({ memberId: "id-3" })))).toBe("SpaceArchived");
    expect(unwrap(await w.split(byAna({ memberId: "id-6" })))).toMatchObject({ spaceId: "id-7", created: true });
  });
});
```

In `src/modules/spaces/domain/permissions.test.ts`:

1. Replace the line `import { can, rolesFor, SPACE_ACTIONS, type SpaceAction } from "./permissions";` with:

```ts
import { can, isReadOnly, rolesFor, SPACE_ACTIONS, type SpaceAction } from "./permissions";
```

2. Insert before the line `  it("keeps shared fund management with owners and admins (HU-E2-02)", () => {`:

```ts
  it("reads only with space.read, the one action an archived space still allows (HU-E1-09)", () => {
    expect(SPACE_ACTIONS.filter(isReadOnly)).toEqual(["space.read"]);
  });

```

In `src/modules/spaces/infrastructure/drizzle-space-repository.int.test.ts`:

1. Replace the two lines `      userId,` and `      role: "OWNER",` (in "finds the owner's membership with the space settings") with:

```ts
      userId,
      role: "OWNER",
      archived: false,
```

2. Replace the test from the line `  it("finds nothing for another user, a malformed id or an archived space", async () => {` to the line `    expect(await repo.findMembership(space.id, userId)).toBeNull();` and the `  });` after it with:

```ts
  it("finds nothing for another user or a malformed id", async () => {
    const userId = await newUser();
    const other = await newUser();
    const space = personal(userId);
    await repo.add(space);
    expect(await repo.findMembership(space.id, other)).toBeNull();
    expect(await repo.findMembership("not-a-uuid", userId)).toBeNull();
  });

  it("finds the membership of an archived space, flagged, so reads still reach it (HU-E1-09)", async () => {
    const userId = await newUser();
    const space = personal(userId);
    await repo.add(space);
    await pool.query("UPDATE spaces SET archived_at = now() WHERE id = $1", [space.id]);
    expect(await repo.findMembership(space.id, userId)).toMatchObject({ spaceId: space.id, archived: true });
  });
```

3. Replace the line `    await expect(repo.add(personal(userId))).rejects.toThrow();` with:

```ts
    // Drizzle wraps the PostgreSQL error ("Failed query: …"), so the constraint is read from its cause.
    const failure: unknown = await repo.add(personal(userId)).catch((error: unknown) => error);
    expect((failure as { cause?: { constraint?: string } }).cause?.constraint).toBe(
      "spaces_personal_owner_user_id_unique",
    );
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/spaces && pnpm exec vitest run --project integration src/modules/spaces/infrastructure/drizzle-space-repository.int.test.ts`
Expected: FAIL — `isReadOnly is not a function`; the archived household answers `ok` instead of `SpaceArchived`; the split picking the guest of the archived "Ana & Pedro" reuses it (`ok`, not `SpaceArchived`) and the one picking Juan of the archived "Ana & Juan" reuses it too (`created: false`); PostgreSQL returns no membership for the archived space and no `archived` field for the active one. Two new tests already pass and guard Step 3's change instead: the split through the archived Household (nothing refuses archived spaces yet; it fails if `split-with-person.ts` keeps write-mode access once the guard exists) and the tightened constraint test.

- [ ] **Step 3: Implement the guard**

Append to `src/modules/spaces/domain/permissions.ts`:

```ts

/** HU-E1-09: actions that only read, the only ones an archived space still allows. */
export const isReadOnly = (action: SpaceAction): boolean => action === "space.read";
```

In `src/modules/spaces/application/space-settings-repository.ts`:

1. Add after the line `  readonly role: SpaceRole | null;`:

```ts
  /** HU-E1-09: an archived space only reads; SpaceAccess refuses everything else. */
  readonly archived: boolean;
```

2. Replace the line `  /** Null when the id is malformed, the space is unknown or archived, or the user is not a current member. */` with:

```ts
  /** Null for malformed ids, unknown spaces and non-members; archived spaces are found and flagged. */
```

In `src/modules/spaces/application/space-access.ts`:

1. Replace the line `import { can, rolesFor, type SpaceAction } from "../domain/permissions";` with:

```ts
import { can, isReadOnly, rolesFor, type SpaceAction } from "../domain/permissions";
```

2. Replace the lines from `/** Resolves the acting user's membership; non-members get SpaceNotFound so existence never leaks (spec 8). */` to `    return membership ? ok(membership) : err(domainError("SpaceNotFound"));` and the `  };` after it with:

```ts
/**
 * Resolves the acting user's membership; non-members get SpaceNotFound so existence never leaks (spec 8).
 * An archived space answers SpaceArchived unless the caller only reads (HU-E1-09), so every write path
 * that resolves access refuses it by default.
 */
export type SpaceAccess = (
  spaceId: string,
  userId: string,
  options?: { readonly readOnly?: boolean },
) => Promise<Result<SpaceMembership>>;

export const createSpaceAccess =
  (spaces: Pick<SpaceSettingsRepository, "findMembership">): SpaceAccess =>
  async (spaceId, userId, options = {}) => {
    const membership = await spaces.findMembership(spaceId, userId);
    if (!membership) return err(domainError("SpaceNotFound"));
    if (membership.archived && options.readOnly !== true) return err(domainError("SpaceArchived"));
    return ok(membership);
  };
```

3. Replace the line ` * SpaceNotFound whatever the action (spec 8), then the role.` with:

```ts
 * SpaceNotFound whatever the action (spec 8), then the role; only reads reach an archived space (HU-E1-09).
```

4. Replace the line `  flatMap(await access(spaceId, userId), (m) => requirePermission(m, action));` with:

```ts
  flatMap(await access(spaceId, userId, { readOnly: isReadOnly(action) }), (m) => requirePermission(m, action));
```

In `src/modules/spaces/infrastructure/drizzle-space-repository.ts`, replace the `findMembership` method (from the line `  async findMembership(spaceId: string, userId: string): Promise<SpaceMembership | null> {` to the line `      : null;` and the `  }` after it) with:

```ts
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
        archivedAt: spaces.archivedAt,
      })
      .from(spaces)
      .innerJoin(spaceMembers, eq(spaceMembers.spaceId, spaces.id))
      // HU-E1-09: archived spaces are found and flagged; SpaceAccess lets only reads through.
      .where(and(eq(spaces.id, spaceId), eq(spaceMembers.userId, userId), isNull(spaceMembers.leftAt)))
      .limit(1);
    if (!row) return null;
    const { archivedAt, ...membership } = row;
    return {
      ...membership,
      spaceId: row.spaceId as SpaceId,
      memberId: row.memberId as SpaceMemberId,
      userId,
      archived: archivedAt !== null,
    };
  }
```

- [ ] **Step 4: Route every direct read through `space.read`**

`src/modules/spaces/application/get-space.ts` (replace the whole file):

```ts
import { map, type Result } from "@/shared/kernel";
import { authorizeSpaceAction, toSpaceSummary, type SpaceAccess } from "./space-access";
import type { SpaceSummary } from "./space-repository";

export type GetSpace = (input: { spaceId: string; userId: string }) => Promise<Result<SpaceSummary>>;

/** Any current member reads the space, also once it is archived (HU-E1-09). */
export const createGetSpace =
  (access: SpaceAccess): GetSpace =>
  async ({ spaceId, userId }) =>
    map(await authorizeSpaceAction(access, spaceId, userId, "space.read"), toSpaceSummary);
```

In `src/modules/spaces/application/list-space-periods.ts`:

1. Replace the line `import type { SpaceAccess } from "./space-access";` with:

```ts
import { authorizeSpaceAction, type SpaceAccess } from "./space-access";
```

2. Replace the line `    const membership = await deps.access(input.spaceId, input.userId);` with:

```ts
    const membership = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
```

In each of `src/modules/accounts/application/list-accounts.ts`, `src/modules/categories/application/list-categories.ts`, `src/modules/ledger/application/list-transactions.ts`, `src/modules/ledger/application/get-transaction.ts` and `src/modules/ledger/application/list-audit.ts` (and only these; `EditTransaction`, `DeleteTransaction`, `CreateAccount` and the other writes keep `deps.access` and are refused by the guard):

1. Insert before the first line of the file:

```ts
import { authorizeSpaceAction } from "@/modules/spaces/application";
```

2. Replace every line `    const membership = await deps.access(input.spaceId, input.userId);` (two in `list-accounts.ts`, one in each other file) with:

```ts
    const membership = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
```

In `src/modules/spaces/application/split-with-person.ts` (Task 13):

1. Replace the line `  const shared = await deps.access(found.spaceId, requester.userId);` with:

```ts
  // A read: someone in an archived space is still someone the requester shares a space with (HU-E1-09).
  const shared = await deps.access(found.spaceId, requester.userId, { readOnly: true });
```

2. Replace the two lines from `  // Someone picked in a direct space the requester is in: that space, also after its guest claimed it.` to `  if (found.spaceKind === "DIRECT") return ok({ spaceId: found.spaceId, created: false });` with:

```ts
  // Someone picked in an active direct space the requester is in: that space, also after its guest claimed it.
  if (found.spaceKind === "DIRECT" && !shared.value.archived) return ok({ spaceId: found.spaceId, created: false });
  // HU-E1-09: an archived direct space takes no new expense, and its guest exists only there (D15).
  if (found.spaceKind === "DIRECT" && member.userId === null) return err(domainError("SpaceArchived"));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration`
Expected: PASS, the existing read and write tests of every module included (active spaces answer as before). Mutation checks: temporarily delete the line `    if (membership.archived && options.readOnly !== true) return err(domainError("SpaceArchived"));` — the first two new space-access tests fail (an archived space answers `ok` to writes); the third keeps passing, because it pins that non-members are refused first, not the archive check; restore the line. Temporarily remove `{ readOnly: true }` from `split-with-person.ts` — "still finds a counterpart through an archived shared space" fails with `SpaceArchived`; restore it. Task 18b pins every read and write endpoint over HTTP.

- [ ] **Step 6: Gates**

Run: `pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (`tsc` requires `archived` from every `SpaceMembership` producer: `DrizzleSpaceRepository`, `InMemorySpaceStore`, `membership()`).

- [ ] **Step 7: Commit**

```bash
git add src/modules/spaces/domain/permissions.ts src/modules/spaces/domain/permissions.test.ts src/modules/spaces/application/space-settings-repository.ts src/modules/spaces/application/space-access.ts src/modules/spaces/application/space-access.test.ts src/modules/spaces/application/get-space.ts src/modules/spaces/application/list-space-periods.ts src/modules/spaces/application/split-with-person.ts src/modules/spaces/application/split-with-person.test.ts src/modules/spaces/infrastructure/drizzle-space-repository.ts src/modules/spaces/infrastructure/drizzle-space-repository.int.test.ts src/modules/accounts/application/list-accounts.ts src/modules/categories/application/list-categories.ts src/modules/ledger/application/list-transactions.ts src/modules/ledger/application/get-transaction.ts src/modules/ledger/application/list-audit.ts tests/support/fakes.ts tests/support/in-memory-spaces.ts
git commit -m "feat(spaces): make archived spaces read-only on every write path (Refs #18)"
```

---

### Task 17: Spaces — ArchiveSpace and the archived filter

Implements HU-E1-09 (issue #18): the OWNER archives a settled shared or direct space; the user's spaces are listed active by default, and archived ones are included on request. Pins Review Focus 1 (a guest's debt blocks archiving).

Decisions:
- Order: matrix (`space.archive`, OWNER only), `ensureArchivable` (personal spaces never: `PersonalSpaceNotArchivable`), every current member's net (registered or guest, backlog note), then the write. A space archived already answers `SpaceArchived` from the guard (Task 16).
- The outstanding amount of a space is `outstandingIn` over its current members' nets (Task 1): what the creditors are owed, or what the debtors owe if that is larger; for HU-E1-09's "Juan owes Ana 150,000" it is 150,000.
- The nets of every current member come from one aggregate, so they come from one snapshot: a new port, `MemberNetBalances = (spaceId, memberIds) => Promise<bigint[]>`, which the composition root binds (Task 18a) to the balances module's new `GetMemberNetBalances` (one `memberTotals` read, M2-B). `ArchiveSpaceDeps` takes it in place of `LifecycleDeps.netBalance`.
- `SpaceArchiveRepository.archive` sets `archived_at` once (`WHERE archived_at IS NULL`). `listForUser` gains `{ includeArchived?: boolean }`, following the M1 convention of `GET …/accounts?archived=true` (controller ruling O4): active spaces without it; with `includeArchived: true`, the archived ones too, beside the active ones; spaces the user left appear in neither.

**Files:**
- Create: `src/modules/spaces/application/archive-space.ts`
- Modify: `src/modules/spaces/domain/space.ts`, `src/modules/spaces/application/space-repository.ts`, `src/modules/spaces/application/list-my-spaces.ts`, `src/modules/spaces/application/index.ts`, `src/modules/spaces/infrastructure/drizzle-space-repository.ts`, `src/modules/balances/application/get-member-net-balance.ts`, `src/modules/balances/application/index.ts`, `tests/support/in-memory-spaces.ts`
- Test: `src/modules/spaces/application/archive-space.test.ts`, `src/modules/spaces/domain/space.test.ts`, `src/modules/spaces/infrastructure/drizzle-space-repository.int.test.ts`, `src/modules/balances/application/get-member-net-balance.test.ts`

**Interfaces:**
- Consumes: `ensureSettled`, `outstandingIn` (Task 1); `LifecycleDeps` (Task 2); `BalanceSource`, `netOf` (M2-B); the archived guard and `InMemorySpaceStore.archived` (Task 16); `authorizeSpaceAction`, `createListMySpaces` (M2-A); `sharedSpaceFixture` (`tests/support/fixtures.ts`); `InMemoryTransactions`, `anExpense` (`tests/support/in-memory-ledger.ts`).
- Produces:
  - `ensureArchivable(space: Pick<Space, "kind">): Result<void>` — `PersonalSpaceNotArchivable`
  - `interface SpaceArchiveRepository { archive(spaceId: SpaceId, archivedAt: Date): Promise<void> }`
  - `SpaceRepository.listForUser(userId: string, options?: { readonly includeArchived?: boolean }): Promise<SpaceSummary[]>`; `type ListMySpaces = (userId: string, options?: { readonly includeArchived?: boolean }) => Promise<Result<SpaceSummary[]>>`
  - `type MemberNetBalances = (spaceId: string, memberIds: readonly string[]) => Promise<bigint[]>`; `type ArchiveSpaceDeps = Omit<LifecycleDeps, "netBalance"> & { spaces: SpaceArchiveRepository; netBalances: MemberNetBalances }`; `type ArchiveSpace = (input: { spaceId: string; userId: string }) => Promise<Result<void>>`; `createArchiveSpace(deps)` — errors `SpaceNotFound`, `InsufficientRole`, `SpaceArchived`, `PersonalSpaceNotArchivable`, `OutstandingBalance`
  - `type GetMemberNetBalances = (spaceId: string, memberIds: readonly string[]) => Promise<bigint[]>`; `createGetMemberNetBalances(source: BalanceSource): GetMemberNetBalances` (balances)
  - `DrizzleSpaceRepository.archive(…)`, `listForUser(…, options)`; `InMemorySpaceStore.archive(…)`, `listForUser(…, options)`.

- [ ] **Step 1: Write the in-memory twin and the failing tests**

In `tests/support/in-memory-spaces.ts`:

1. Replace the `listForUser` method (from the line `  async listForUser(userId: string): Promise<SpaceSummary[]> {` to the line before `  async findMembership(spaceId: string, userId: string): Promise<SpaceMembership | null> {`) with:

```ts
  async listForUser(
    userId: string,
    options: { readonly includeArchived?: boolean } = {},
  ): Promise<SpaceSummary[]> {
    return this.spaces.flatMap((s) => {
      const me = s.members.find((m) => m.userId === userId);
      if (!me || (this.archived.has(s.id) && options.includeArchived !== true)) return [];
      const summary: SpaceSummary = {
        id: s.id,
        name: s.name,
        kind: s.kind,
        currency: s.currency,
        periodPolicy: s.periodPolicy,
        role: me.role,
      };
      return [summary];
    });
  }

```

2. Insert before the line `  /** Test setup: a space as earlier use cases would have left it. */`:

```ts
  /** SpaceArchiveRepository, like DrizzleSpaceRepository.archive. */
  async archive(spaceId: string): Promise<void> {
    this.archived.add(spaceId);
  }

```

`src/modules/spaces/application/archive-space.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
import { codeOf, memoryTm, unwrap } from "../../../../tests/support/fakes";
import { householdSpace, InMemorySpaceStore, memberOf } from "../../../../tests/support/in-memory-spaces";
import { createPersonalSpace, type Space, type SpaceId, type SpaceMemberId } from "../domain/space";
import { createArchiveSpace } from "./archive-space";
import { createListMySpaces } from "./list-my-spaces";
import { createSpaceAccess } from "./space-access";

const now = new Date("2026-10-14T12:00:00Z");
const space = "space-household";
const as = (name: string) => ({ spaceId: space, userId: `u-${name}` });

// HU-E1-05 Background members: OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi and the guest Pedro.
const setup = (seeded: Space = householdSpace(), byMember: Record<string, bigint> = {}) => {
  const store = new InMemorySpaceStore();
  store.seed(seeded);
  const archive = createArchiveSpace({
    access: createSpaceAccess(store),
    members: store,
    spaces: store,
    // Nets of Household by member id; any other space answers 1 for everyone, never settled.
    netBalances: async (spaceId, memberIds) =>
      memberIds.map((id) => (spaceId === space ? (byMember[id] ?? 0n) : 1n)),
    clock: new FixedClock(now),
    tm: memoryTm,
  });
  return { store, archive, listMine: createListMySpaces(store) };
};

describe("ArchiveSpace (HU-E1-09)", () => {
  it("archives a space whose members, the guest Pedro included, are settled, and lists it only on request", async () => {
    const { store, archive, listMine } = setup();
    expect(unwrap(await archive(as("ana")))).toBeUndefined();
    expect(store.archived.has(space)).toBe(true);
    expect(unwrap(await listMine("u-ana")).map((s) => s.id)).toEqual([]);
    expect(unwrap(await listMine("u-ana", { includeArchived: true })).map((s) => s.id)).toEqual([space]);
  });

  it("refuses while Juan owes Ana 150,000 COP, with the outstanding amount", async () => {
    const { store, archive } = setup(householdSpace(), {
      "member-ana": 15_000_000n,
      "member-juan": -15_000_000n,
    });
    expect(await archive(as("ana"))).toEqual({
      ok: false,
      error: { code: "OutstandingBalance", details: { outstanding: { amount: "15000000", currency: "COP" } } },
    });
    expect(store.archived.size).toBe(0);
  });

  it("refuses while only the guest Pedro owes Ana 100,000 COP (Review Focus 1)", async () => {
    const { archive } = setup(householdSpace(), { "member-ana": 10_000_000n, "member-pedro": -10_000_000n });
    expect(codeOf(await archive(as("ana")))).toBe("OutstandingBalance");
  });

  it("lets only the OWNER archive and hides the space from non-members", async () => {
    const { archive } = setup();
    expect(codeOf(await archive(as("juan")))).toBe("InsufficientRole");
    expect(codeOf(await archive(as("marta")))).toBe("SpaceNotFound");
  });

  it("never archives a personal space, and archives a settled direct space", async () => {
    const personal = createPersonalSpace({
      id: "space-ana" as SpaceId,
      memberId: "member-ana-personal" as SpaceMemberId,
      ownerUserId: "u-ana",
      ownerName: "Ana",
      now,
    });
    expect(codeOf(await setup(personal).archive({ spaceId: "space-ana", userId: "u-ana" }))).toBe(
      "PersonalSpaceNotArchivable",
    );
    const direct: Space = {
      ...householdSpace([memberOf("Ana", "OWNER", 0), memberOf("Pedro", null, 1)]),
      kind: "DIRECT",
      name: "Ana & Pedro",
    };
    expect(codeOf(await setup(direct).archive(as("ana")))).toBe("ok");
  });

  it("answers SpaceArchived when the space is archived already", async () => {
    const { archive } = setup();
    unwrap(await archive(as("ana")));
    expect(codeOf(await archive(as("ana")))).toBe("SpaceArchived");
  });
});
```

In `src/modules/spaces/domain/space.test.ts`:

1. Insert before the line `  ensureCanAddMember,`:

```ts
  ensureArchivable,
```

2. Append to the end of the file:

```ts

describe("archiving (HU-E1-09)", () => {
  it("is for shared and direct spaces, never personal ones", () => {
    expect(ensureArchivable({ kind: "SHARED" })).toEqual({ ok: true, value: undefined });
    expect(ensureArchivable({ kind: "DIRECT" })).toEqual({ ok: true, value: undefined });
    const personal = ensureArchivable({ kind: "PERSONAL" });
    expect(!personal.ok && personal.error.code).toBe("PersonalSpaceNotArchivable");
  });
});
```

In `src/modules/spaces/infrastructure/drizzle-space-repository.int.test.ts`:

1. Add after the line `import { testDatabase } from "../../../../tests/support/database";`:

```ts
import { sharedSpaceFixture } from "../../../../tests/support/fixtures";
import type { SpaceArchiveRepository } from "../application/space-repository";
```

2. Append to the end of the file:

```ts

describe("DrizzleSpaceRepository archiving (HU-E1-09)", () => {
  const archiving: SpaceArchiveRepository = repo;

  it("sets archivedAt once and lists the space only when archived spaces are included", async () => {
    const userId = await newUser();
    const space = await sharedSpaceFixture(db, userId);
    const at = new Date("2026-10-14T12:00:00Z");
    await archiving.archive(space.id, at);
    await archiving.archive(space.id, new Date("2026-10-15T12:00:00Z"));
    const { rows } = await pool.query("SELECT archived_at FROM spaces WHERE id = $1", [space.id]);
    expect(rows[0].archived_at).toEqual(at);
    expect(await repo.listForUser(userId)).toEqual([]);
    expect((await repo.listForUser(userId, { includeArchived: true })).map((s) => s.id)).toEqual([space.id]);
  });

  it("lists active spaces by default, archived ones beside them on request, never a space the user left", async () => {
    const userId = await newUser();
    const active = await sharedSpaceFixture(db, userId, new Date("2026-10-01T12:00:00Z"));
    const archived = await sharedSpaceFixture(db, userId, new Date("2026-10-02T12:00:00Z"));
    const left = await sharedSpaceFixture(db, userId, new Date("2026-10-03T12:00:00Z"));
    await pool.query("UPDATE spaces SET archived_at = now() WHERE id = ANY($1)", [[archived.id, left.id]]);
    await pool.query("UPDATE space_members SET left_at = now() WHERE id = $1", [left.members[0]!.id]);
    expect((await repo.listForUser(userId)).map((s) => s.id)).toEqual([active.id]);
    expect((await repo.listForUser(userId, { includeArchived: true })).map((s) => s.id)).toEqual([
      active.id,
      archived.id,
    ]);
  });
});
```

In `src/modules/balances/application/get-member-net-balance.test.ts`:

1. Replace the line `import { createGetMemberNetBalance } from "./get-member-net-balance";` with:

```ts
import { createGetMemberNetBalance, createGetMemberNetBalances } from "./get-member-net-balance";
```

2. Append to the end of the file:

```ts

describe("GetMemberNetBalances (HU-E5-01, for HU-E1-09)", () => {
  it("returns the nets of the given members in their order from one aggregate, 0 for those nothing moved", async () => {
    const ledger = new InMemoryTransactions();
    // Ana pays 300,000 COP in Household, split equally with Juan: 150,000 COP each.
    await ledger.add(
      anExpense("2026-10-05", 30_000_000n, {
        spaceId: "space-household",
        payments: [{ memberId: "member-ana", accountId: null, amount: 30_000_000n }],
        shares: [
          { memberId: "member-ana", amount: 15_000_000n, splitMethod: "EQUAL" },
          { memberId: "member-juan", amount: 15_000_000n, splitMethod: "EQUAL" },
        ],
      }),
    );
    let reads = 0;
    const netBalances = createGetMemberNetBalances({
      memberTotals: async (spaceId) => {
        reads += 1;
        return ledger.memberTotals(spaceId);
      },
    });
    expect(await netBalances("space-household", ["member-juan", "member-luis", "member-ana"])).toEqual([
      -15_000_000n,
      0n,
      15_000_000n,
    ]);
    expect(reads).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/spaces src/modules/balances && pnpm exec vitest run --project integration src/modules/spaces/infrastructure/drizzle-space-repository.int.test.ts`
Expected: FAIL — `Failed to resolve import "./archive-space"`, `ensureArchivable is not a function`, `createGetMemberNetBalances is not a function`, `archiving.archive is not a function`, and PostgreSQL's `listForUser` ignores `includeArchived`.

- [ ] **Step 3: Implement**

In `src/modules/spaces/domain/space.ts`, insert before the line `export const MAX_SPACE_NAME = 80;`:

```ts
/** HU-E1-09: personal spaces are never archived; shared and direct spaces are, once settled. */
export const ensureArchivable = (space: Pick<Space, "kind">): Result<void> =>
  space.kind === "PERSONAL" ? err(domainError("PersonalSpaceNotArchivable")) : ok(undefined);

```

`src/modules/spaces/application/space-repository.ts` (replace the whole file):

```ts
import type { PeriodPolicy } from "@/shared/kernel";
import type { Space, SpaceId, SpaceKind, SpaceRole } from "../domain/space";

export interface SpaceSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: SpaceKind;
  readonly currency: string;
  readonly periodPolicy: PeriodPolicy;
  readonly role: SpaceRole | null;
}

export interface SpaceRepository {
  add(space: Space): Promise<void>;
  hasPersonalSpace(userId: string): Promise<boolean>;
  /** The spaces the user currently belongs to: the active ones, and the archived ones too with `includeArchived`. */
  listForUser(userId: string, options?: { readonly includeArchived?: boolean }): Promise<SpaceSummary[]>;
}

/** HU-E1-09: archiving keeps the space and its history; only archivedAt changes, once. */
export interface SpaceArchiveRepository {
  archive(spaceId: SpaceId, archivedAt: Date): Promise<void>;
}
```

`src/modules/spaces/application/list-my-spaces.ts` (replace the whole file):

```ts
import { ok, type Result } from "@/shared/kernel";
import type { SpaceRepository, SpaceSummary } from "./space-repository";

/** HU-E1-02, HU-E1-09: the user's spaces; archived ones too when asked for (the M1 `archived=true` convention). */
export type ListMySpaces = (
  userId: string,
  options?: { readonly includeArchived?: boolean },
) => Promise<Result<SpaceSummary[]>>;

export const createListMySpaces =
  (spaces: SpaceRepository): ListMySpaces =>
  async (userId, options = {}) =>
    ok(await spaces.listForUser(userId, options));
```

`src/modules/spaces/application/archive-space.ts`:

```ts
import { ok, type Result } from "@/shared/kernel";
import { ensureSettled, outstandingIn } from "../domain/member";
import { ensureArchivable } from "../domain/space";
import type { LifecycleDeps } from "./lifecycle-deps";
import { authorizeSpaceAction } from "./space-access";
import type { SpaceArchiveRepository } from "./space-repository";

/**
 * HU-E5-01 net(m) of the given members of one space, in that order, read from one aggregate so that they
 * come from one snapshot; bound to the balances module by the composition root (balances imports spaces).
 */
export type MemberNetBalances = (spaceId: string, memberIds: readonly string[]) => Promise<bigint[]>;

export type ArchiveSpace = (input: { spaceId: string; userId: string }) => Promise<Result<void>>;

export type ArchiveSpaceDeps = Omit<LifecycleDeps, "netBalance"> & {
  readonly spaces: SpaceArchiveRepository;
  readonly netBalances: MemberNetBalances;
};

/**
 * HU-E1-09: the OWNER archives a shared or direct space once every current member, registered or guest,
 * is settled; the space then only reads (SpaceAccess). Personal spaces are never archived.
 */
export const createArchiveSpace =
  (deps: ArchiveSpaceDeps): ArchiveSpace =>
  (input) =>
    deps.tm.run(async () => {
      const owner = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.archive");
      if (!owner.ok) return owner;
      const { spaceId, spaceKind, currency } = owner.value;
      const archivable = ensureArchivable({ kind: spaceKind });
      if (!archivable.ok) return archivable;
      const current = await deps.members.listCurrent(spaceId);
      const nets = await deps.netBalances(spaceId, current.map((m) => m.id));
      const settled = ensureSettled(outstandingIn(nets), currency);
      if (!settled.ok) return settled;
      await deps.spaces.archive(spaceId, deps.clock.now());
      return ok(undefined);
    });
```

Append to `src/modules/spaces/application/index.ts`:

```ts
export type { SpaceArchiveRepository } from "./space-repository";
export {
  createArchiveSpace,
  type ArchiveSpace,
  type ArchiveSpaceDeps,
  type MemberNetBalances,
} from "./archive-space";
```

Append to `src/modules/balances/application/get-member-net-balance.ts`:

```ts

/** The nets of several members of one space, in the given order, from one aggregate (HU-E1-09). */
export type GetMemberNetBalances = (spaceId: string, memberIds: readonly string[]) => Promise<bigint[]>;

export const createGetMemberNetBalances =
  (source: BalanceSource): GetMemberNetBalances =>
  async (spaceId, memberIds) => {
    const byMember = new Map((await source.memberTotals(spaceId)).map((t) => [t.memberId, netOf(t)]));
    return memberIds.map((id) => byMember.get(id) ?? 0n);
  };
```

In `src/modules/balances/application/index.ts`, replace the line `export { createGetMemberNetBalance, type GetMemberNetBalance } from "./get-member-net-balance";` (Task 2) with:

```ts
export {
  createGetMemberNetBalance,
  createGetMemberNetBalances,
  type GetMemberNetBalance,
  type GetMemberNetBalances,
} from "./get-member-net-balance";
```

In `src/modules/spaces/infrastructure/drizzle-space-repository.ts`:

1. Replace the `listForUser` method (from the line `  async listForUser(userId: string): Promise<SpaceSummary[]> {` to the line `      .orderBy(asc(spaces.createdAt));` and the `  }` after it) with:

```ts
  async listForUser(
    userId: string,
    options: { readonly includeArchived?: boolean } = {},
  ): Promise<SpaceSummary[]> {
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
      .where(
        and(
          eq(spaceMembers.userId, userId),
          isNull(spaceMembers.leftAt),
          // HU-E1-09, the M1 archived=true convention: archived spaces only when asked for, beside the active ones.
          options.includeArchived === true ? undefined : isNull(spaces.archivedAt),
        ),
      )
      .orderBy(asc(spaces.createdAt));
  }
```

2. Insert before the last line of the file (`}`):

```ts

  async archive(spaceId: SpaceId, archivedAt: Date): Promise<void> {
    await this.tm
      .executor()
      .update(spaces)
      .set({ archivedAt })
      .where(and(eq(spaces.id, spaceId), isNull(spaces.archivedAt)));
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/spaces src/modules/balances && pnpm exec vitest run --project integration src/modules/spaces/infrastructure`
Expected: PASS, M2-A's `listForUser` tests included. Mutation checks: temporarily pass `[]` instead of `current.map((m) => m.id)` to `deps.netBalances` — both outstanding tests fail; temporarily replace `undefined` with `isNull(spaces.archivedAt)` in the PostgreSQL `listForUser` — both archiving integration tests fail on the included archived space; restore both.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (`no-circular` holds: spaces names the balances port only as a type of its own).

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/domain/space.ts src/modules/spaces/domain/space.test.ts src/modules/spaces/application/space-repository.ts src/modules/spaces/application/list-my-spaces.ts src/modules/spaces/application/archive-space.ts src/modules/spaces/application/archive-space.test.ts src/modules/spaces/application/index.ts src/modules/spaces/infrastructure/drizzle-space-repository.ts src/modules/spaces/infrastructure/drizzle-space-repository.int.test.ts src/modules/balances/application/get-member-net-balance.ts src/modules/balances/application/get-member-net-balance.test.ts src/modules/balances/application/index.ts tests/support/in-memory-spaces.ts
git commit -m "feat(spaces): archive a settled space and include archived spaces on request (Refs #18)"
```

---

### Task 18: HTTP — archive a space and list archived spaces

Exposes HU-E1-09 (issue #18): `POST /api/v1/spaces/{spaceId}/archive` → `204`, and `GET /api/v1/spaces?archived=true`, which includes the archived spaces beside the active ones. Pins Review Focus 4 over HTTP with one table of every read (`200`) and one of every space-scoped write endpoint of M1–M2-C (`409 SpaceArchived`) on an archived space. Size ~560 lines: commit it as **18a** (Steps 1–5: routes, contract, wiring, snapshot and `archive-space.test.ts`) and **18b** (Steps 6–8: a separate file, `archived-space.test.ts`, with the read and write tables, invitation and claim acceptance into an archived space and a direct split into an archived direct space; no production change unless one of its tests is red), each green and with its own RDD pass. The separate file keeps each half's imports to what it uses.

Decisions:
- `?archived=true` follows the M1 convention of `GET …/accounts?archived=true` and `GET …/categories?archived=true` (`z.enum(["true", "false"]).optional()`): with it, archived spaces are listed **beside** the active ones; without it, the list is unchanged (controller ruling O4). The `Space` component gains no `archivedAt` yet, so a client tells the archived ones apart by comparing with the default list until that field is exposed (Self-Review, follow-ups).
- The archive route answers `204`. Archiving twice answers `409 SpaceArchived` (the guard), and so does every write endpoint of the table, through whichever path it takes (matrix action or direct access).
- Accepting an invitation or a claim link of an archived space answers `409 SpaceArchived` and adds nobody (the read-back of Task 16 rolls the join back; controller ruling O5, a PR note).
- The composition root binds `ArchiveSpace`'s `netBalances` to the balances module's `createGetMemberNetBalances(ledgerQueries)` (Task 17).

**Files:**
- 18a — Create: `src/app/api/v1/spaces/[spaceId]/archive/route.ts`; Modify: `src/app/api/v1/spaces/route.ts`, `src/modules/spaces/contracts/spaces.contract.ts`, `src/composition/container.ts`, `src/shared/http/problem.test.ts`, `openapi/openapi.snapshot.json`; Test: `tests/acceptance/archive-space.test.ts`
- 18b — Test: `tests/acceptance/archived-space.test.ts`

**Interfaces:**
- Consumes: `createArchiveSpace`, `ArchiveSpace`, `createGetMemberNetBalances` (Task 17); `ListMySpaces` with `includeArchived` (Task 17); the guard (Task 16); `lifecycleDeps` (Task 4.2); `paysEqually`, `settles` (Task 4.2); `claimLink` (Task 10a); every M1–M2-C route named in the tables, including the direct-split route (Task 15b).
- Produces: `POST /api/v1/spaces/{spaceId}/archive`; `ListSpacesQuerySchema`; `GET /api/v1/spaces?archived=true`; `Container.spaces.archiveSpace`.

#### 18a — the archive endpoint and the archived filter

- [ ] **Step 1: Write the failing acceptance test**

`tests/acceptance/archive-space.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { GET as listSpaces } from "@/app/api/v1/spaces/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { addGuest, cop, household, paysEqually, post, settles } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const archive = (user: TestUser, spaceId: string) =>
  call(archiveSpace, "POST", `/api/v1/spaces/${spaceId}/archive`, { user, params: { spaceId } });
const spaceIdsOf = async (user: TestUser, query = ""): Promise<string[]> => {
  const response = await call(listSpaces, "GET", `/api/v1/spaces${query}`, { user });
  return ((await response.json()) as { items: { id: string }[] }).items.map((s) => s.id);
};

describe("archive a space (HU-E1-09)", () => {
  it("archives a space whose members, the guest Pedro included, are settled, and lists it only on request", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    await paysEqually(h.ana, 100_000, [h.ana.memberId, pedro], h.groceries);
    await settles(h.ana, pedro, h.ana.memberId, 50_000);
    expect((await archive(h.ana, h.spaceId)).status).toBe(204);
    const { rows } = await app.pool.query("SELECT archived_at FROM spaces WHERE id = $1", [h.spaceId]);
    expect(rows[0].archived_at).toBeInstanceOf(Date);
    expect(await spaceIdsOf(h.ana)).toEqual([h.ana.personal.spaceId]);
    // The M1 convention: archived=true includes the archived spaces beside the active ones.
    expect((await spaceIdsOf(h.ana, "?archived=true")).sort()).toEqual([h.ana.personal.spaceId, h.spaceId].sort());
  });

  it("refuses an expense of 50,000 COP in the archived space with SpaceArchived", async () => {
    const h = await household();
    expect((await archive(h.ana, h.spaceId)).status).toBe(204);
    const response = await post(recordExpense, h.ana, "expenses", {
      description: "Snacks",
      date: "2026-10-05",
      categoryId: h.groceries,
      amount: cop(50_000),
      payments: [{ memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(50_000) }],
    });
    expect(await problemOf(response)).toEqual([409, "SpaceArchived"]);
  });

  it("refuses archiving while Juan owes Ana 150,000 COP, stating the amount", async () => {
    const h = await household();
    await paysEqually(h.ana, 300_000, [h.ana.memberId, h.juan.memberId], h.groceries);
    const response = await archive(h.ana, h.spaceId);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "OutstandingBalance", outstanding: cop(150_000) });
  });

  it("refuses archiving while only the guest Pedro owes Ana 100,000 COP (Review Focus 1)", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    await paysEqually(h.ana, 200_000, [h.ana.memberId, pedro], h.groceries);
    expect(await problemOf(await archive(h.ana, h.spaceId))).toEqual([409, "OutstandingBalance"]);
  });

  it("never archives a personal space, lets only the OWNER archive and hides the space from others", async () => {
    const h = await household();
    expect(await problemOf(await archive(h.ana.personal, h.ana.personal.spaceId))).toEqual([
      409,
      "PersonalSpaceNotArchivable",
    ]);
    expect(await problemOf(await archive(h.juan, h.spaceId))).toEqual([403, "InsufficientRole"]);
    expect(await problemOf(await archive(await registerUser("Marta"), h.spaceId))).toEqual([404, "SpaceNotFound"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/archive-space.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/archive/route"`.

- [ ] **Step 3: Contract, routes and wiring**

In `src/modules/spaces/contracts/spaces.contract.ts`:

1. Insert before the line `export const ListSpacesResponseSchema = z.object({ items: z.array(SpaceSummarySchema) });`:

```ts
/** HU-E1-09, the M1 convention: `?archived=true` lists the archived spaces too, beside the active ones. */
export const ListSpacesQuerySchema = z.object({ archived: z.enum(["true", "false"]).optional() });

```

2. Replace the line `      summary: "Spaces the authenticated user belongs to",` with:

```ts
      summary: "Spaces the authenticated user belongs to: the active ones, and the archived ones too with archived=true",
```

3. Add after the line `      security: [{ cookieAuth: [] }, { bearerAuth: [] }],`:

```ts
      requestParams: { query: ListSpacesQuerySchema },
```

4. Insert before the last line of the file (`};`):

```ts
  "/api/v1/spaces/{spaceId}/archive": {
    post: {
      operationId: "archiveSpace",
      summary: "Archive a settled shared or direct space (OWNER only); it then only reads",
      ...securedByUser,
      requestParams: { path: SpacePath },
      responses: {
        "204": { description: "Archived: listed with ?archived=true; every write answers SpaceArchived" },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound",
          "409": "OutstandingBalance (with the outstanding amount), PersonalSpaceNotArchivable, SpaceArchived",
        }),
      },
    },
  },
```

In `src/app/api/v1/spaces/route.ts`:

1. Replace the line `import { CreateSpaceBodySchema } from "@/modules/spaces/contracts/spaces.contract";` with:

```ts
import { CreateSpaceBodySchema, ListSpacesQuerySchema } from "@/modules/spaces/contracts/spaces.contract";
```

2. Replace the lines from `export const GET = defineRoute({` to the first `});` after it with:

```ts
export const GET = defineRoute({
  auth: "required",
  query: ListSpacesQuerySchema,
  handler: async ({ user, query }) => {
    const includeArchived = query.archived === "true";
    const result = await getContainer().spaces.listMySpaces(user!.id, { includeArchived });
    return result.ok ? ok({ status: 200, body: { items: result.value } }) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/archive/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.archiveSpace({ spaceId: params.spaceId!, userId: user!.id });
    return result.ok ? ok({ status: 204 }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Add after the line `  createGetMemberNetBalance,` (in the `@/modules/balances/application` import):

```ts
  createGetMemberNetBalances,
```

2. Add after the line `  createUpdateSpaceSettings,`:

```ts
  createArchiveSpace,
```

3. Add after the line `  type UpdateSpaceSettings,`:

```ts
  type ArchiveSpace,
```

4. Add after the line `    readonly changeMemberRole: ChangeMemberRole;`:

```ts
    readonly archiveSpace: ArchiveSpace;
```

5. Add after the line `      changeMemberRole: createChangeMemberRole(membersDeps),`:

```ts
      // HU-E1-09: every current member's net from one aggregate (balances' GetMemberNetBalances).
      archiveSpace: createArchiveSpace({
        ...lifecycleDeps,
        spaces: spaceRepository,
        netBalances: createGetMemberNetBalances(ledgerQueries),
      }),
```

In `src/shared/http/problem.test.ts`, add after the line `    ["PersonalSpaceNotShareable", 409],`:

```ts
    ["SpaceArchived", 409],
    ["PersonalSpaceNotArchivable", 409],
```

- [ ] **Step 4: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/archive-space.test.ts && pnpm exec vitest run --project unit src/shared/http/problem.test.ts`
Expected: PASS.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds `POST /api/v1/spaces/{spaceId}/archive` (about 75 lines) and changes `GET /api/v1/spaces` (the `archived` query parameter and the summary, about 20 lines); components are unchanged.

- [ ] **Step 5: Gates and commit 18a**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (`tests/support/app.ts`'s `registerUser` still finds the personal space first in the default list).

```bash
git add "src/app/api/v1/spaces/[spaceId]/archive/route.ts" src/app/api/v1/spaces/route.ts src/modules/spaces/contracts/spaces.contract.ts src/composition/container.ts src/shared/http/problem.test.ts tests/acceptance/archive-space.test.ts openapi/openapi.snapshot.json
git commit -m "feat(spaces): archive a space and include archived spaces in the list over HTTP (Refs #18)"
```

#### 18b — an archived space only reads, endpoint by endpoint

- [ ] **Step 6: Write the tables**

`tests/acceptance/archived-space.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as acceptClaim } from "@/app/api/v1/claims/[token]/accept/route";
import { POST as directSplit } from "@/app/api/v1/direct-splits/route";
import { POST as acceptInvitation } from "@/app/api/v1/invitations/[token]/accept/route";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import {
  GET as getAccount,
  PATCH as updateAccount,
} from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route";
import { GET as listAccounts, POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { GET as getBalances } from "@/app/api/v1/spaces/[spaceId]/balances/route";
import { POST as archiveCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/archive/route";
import { POST as restoreCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/restore/route";
import {
  DELETE as deleteCategory,
  PATCH as updateCategory,
} from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route";
import { GET as listCategories, POST as createCategory } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { POST as archiveCategoryGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/archive/route";
import { PATCH as renameCategoryGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/route";
import { POST as createCategoryGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordFundContribution } from "@/app/api/v1/spaces/[spaceId]/fund-contributions/route";
import { POST as createClaimLink } from "@/app/api/v1/spaces/[spaceId]/guests/[memberId]/claim-links/route";
import { DELETE as removeGuestMember } from "@/app/api/v1/spaces/[spaceId]/guests/[memberId]/route";
import { POST as addGuestMember } from "@/app/api/v1/spaces/[spaceId]/guests/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { POST as revokeInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/[invitationId]/revoke/route";
import { POST as createInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/route";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { PATCH as changeRole } from "@/app/api/v1/spaces/[spaceId]/members/[memberId]/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { GET as listPeriods } from "@/app/api/v1/spaces/[spaceId]/periods/route";
import { GET as getSpace, PATCH as updateSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { GET as listAudit } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/audit/route";
import {
  DELETE as deleteTransaction,
  GET as getTransaction,
  PATCH as editTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type RouteHandler, type TestUser } from "../support/app";
import { addGuest, cop, household, memberIdOf, newAccount, paysEqually, settles } from "../support/ledger";
import { actingIn, claimLink, tokenOf } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface Extra {
  readonly params?: Record<string, string>;
  readonly body?: unknown;
}

/**
 * HU-E1-09: Household with OWNER Ana, MEMBER Juan and the guest Pedro, settled and then archived, with one
 * of everything a write could target: a transaction, a shared fund, a category and its group, a pending
 * invitation link and a claim link for Pedro.
 */
const archivedHousehold = async () => {
  const h = await household();
  const pedro = await addGuest(h, "Pedro");
  const groceries = await paysEqually(h.ana, 100_000, [h.ana.memberId, h.juan.memberId], h.groceries);
  await settles(h.juan, h.juan.memberId, h.ana.memberId, 50_000);
  const fund = await newAccount(h.ana, "Fund", 0, "SHARED_FUND");
  const invited = await call(createInvitation, "POST", `/api/v1/spaces/${h.spaceId}/invitations`, {
    user: h.ana,
    params: { spaceId: h.spaceId },
    body: { kind: "LINK", role: "MEMBER" },
  });
  const invitation = (await invited.json()) as { invitation: { id: string }; url: string };
  const claim = await claimLink(h.ana, h.spaceId, pedro);
  const tree = await call(listCategories, "GET", `/api/v1/spaces/${h.spaceId}/categories`, {
    user: h.ana,
    params: { spaceId: h.spaceId },
  });
  const groupId = ((await tree.json()) as { items: { id: string }[] }).items[0]!.id;
  const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
    user: h.ana,
    params: { spaceId: h.spaceId },
  });
  expect(archived.status).toBe(204);
  /** `user` calls `handler` on `resource` of Household. */
  const as =
    (user: TestUser) =>
    (handler: RouteHandler, method: string, resource: string, extra: Extra = {}) =>
      call(handler, method, `/api/v1/spaces/${h.spaceId}${resource}`, {
        user,
        params: { spaceId: h.spaceId, ...extra.params },
        body: extra.body,
      });
  return {
    h,
    pedro,
    tx: groceries.id,
    fund,
    groupId,
    invitationId: invitation.invitation.id,
    invitationToken: tokenOf(invitation.url),
    claim,
    ana: as(h.ana),
    juan: as(h.juan),
  };
};

describe("an archived space only reads (HU-E1-09, Review Focus 4)", () => {
  it("answers every read with 200, for any member", async () => {
    const { tx, fund, juan } = await archivedHousehold();
    const transaction = { params: { transactionId: tx } };
    const reads: [string, () => Promise<Response>][] = [
      ["the space", () => juan(getSpace, "GET", "")],
      ["its members", () => juan(listMembers, "GET", "/members")],
      ["its periods", () => juan(listPeriods, "GET", "/periods")],
      ["its transactions", () => juan(listTransactions, "GET", "/transactions?period=2026-10")],
      ["one transaction", () => juan(getTransaction, "GET", `/transactions/${tx}`, transaction)],
      ["its audit", () => juan(listAudit, "GET", `/transactions/${tx}/audit`, transaction)],
      ["its balances", () => juan(getBalances, "GET", "/balances")],
      ["its accounts", () => juan(listAccounts, "GET", "/accounts")],
      ["one account", () => juan(getAccount, "GET", `/accounts/${fund}`, { params: { accountId: fund } })],
      ["its categories", () => juan(listCategories, "GET", "/categories")],
    ];
    for (const [what, read] of reads) expect([what, (await read()).status]).toEqual([what, 200]);
  });

  it("answers every space-scoped write endpoint of M1–M2-C with 409 SpaceArchived", async () => {
    const { h, pedro, tx, fund, groupId, invitationId, ana, juan } = await archivedHousehold();
    const category = h.groceries;
    const onCategory = { params: { categoryId: category } };
    const onGroup = { params: { groupId } };
    const onFund = { params: { accountId: fund } };
    const onTransaction = { params: { transactionId: tx } };
    const onPedro = { params: { memberId: pedro } };
    const writes: [string, () => Promise<Response>][] = [
      ["rename the space", () => ana(updateSpace, "PATCH", "", { body: { name: "Old house" } })],
      ["archive it again", () => ana(archiveSpace, "POST", "/archive")],
      ["leave it", () => juan(leaveSpace, "POST", "/leave")],
      [
        "create an invitation",
        () => ana(createInvitation, "POST", "/invitations", { body: { kind: "LINK", role: "MEMBER" } }),
      ],
      [
        "revoke an invitation",
        () => ana(revokeInvitation, "POST", `/invitations/${invitationId}/revoke`, { params: { invitationId } }),
      ],
      ["add a guest", () => ana(addGuestMember, "POST", "/guests", { body: { displayName: "Luis" } })],
      ["remove a guest", () => ana(removeGuestMember, "DELETE", `/guests/${pedro}`, onPedro)],
      ["create a claim link", () => ana(createClaimLink, "POST", `/guests/${pedro}/claim-links`, onPedro)],
      [
        "change a role",
        () =>
          ana(changeRole, "PATCH", `/members/${h.juan.memberId}`, {
            params: { memberId: h.juan.memberId },
            body: { role: "ADMIN" },
          }),
      ],
      ["create a category group", () => ana(createCategoryGroup, "POST", "/category-groups", { body: { name: "Trips" } })],
      [
        "rename a category group",
        () => ana(renameCategoryGroup, "PATCH", `/category-groups/${groupId}`, { ...onGroup, body: { name: "Food" } }),
      ],
      ["archive a category group", () => ana(archiveCategoryGroup, "POST", `/category-groups/${groupId}/archive`, onGroup)],
      ["create a category", () => ana(createCategory, "POST", "/categories", { body: { groupId, name: "Snacks" } })],
      [
        "update a category",
        () => ana(updateCategory, "PATCH", `/categories/${category}`, { ...onCategory, body: { name: "Market" } }),
      ],
      ["archive a category", () => ana(archiveCategory, "POST", `/categories/${category}/archive`, onCategory)],
      ["restore a category", () => ana(restoreCategory, "POST", `/categories/${category}/restore`, onCategory)],
      ["delete a category", () => ana(deleteCategory, "DELETE", `/categories/${category}`, onCategory)],
      [
        "create an account",
        () =>
          ana(createAccount, "POST", "/accounts", {
            body: { name: "Pot", type: "SHARED_FUND", openingBalance: cop(0) },
          }),
      ],
      ["update an account", () => ana(updateAccount, "PATCH", `/accounts/${fund}`, { ...onFund, body: { name: "Pot" } })],
      ["archive an account", () => ana(archiveAccount, "POST", `/accounts/${fund}/archive`, onFund)],
      [
        "record an expense",
        () =>
          ana(recordExpense, "POST", "/expenses", {
            body: { categoryId: category, amount: cop(50_000), accountId: h.ana.account },
          }),
      ],
      [
        "record an income",
        () => ana(recordIncome, "POST", "/incomes", { body: { categoryId: category, amount: cop(10_000), accountId: fund } }),
      ],
      [
        "record a transfer",
        () =>
          ana(recordTransfer, "POST", "/transfers", {
            body: { amount: cop(10_000), sourceAccountId: h.ana.account, destinationAccountId: fund },
          }),
      ],
      [
        "record a fund contribution",
        () =>
          ana(recordFundContribution, "POST", "/fund-contributions", {
            body: { amount: cop(10_000), fundAccountId: fund, sourceAccountId: h.ana.account },
          }),
      ],
      [
        "record a settlement",
        () =>
          ana(recordSettlement, "POST", "/settlements", {
            body: { amount: cop(10_000), payerMemberId: h.juan.memberId, receivingMemberId: h.ana.memberId },
          }),
      ],
      [
        "edit a transaction",
        () => ana(editTransaction, "PATCH", `/transactions/${tx}`, { ...onTransaction, body: { description: "Old" } }),
      ],
      ["delete a transaction", () => ana(deleteTransaction, "DELETE", `/transactions/${tx}`, onTransaction)],
    ];
    for (const [what, write] of writes) {
      expect([what, await problemOf(await write())]).toEqual([what, [409, "SpaceArchived"]]);
    }
  });

  it("refuses joining through an invitation or a claim link of an archived space, adding nobody (ruling O5)", async () => {
    const { h, invitationToken, claim } = await archivedHousehold();
    const joined = await call(acceptInvitation, "POST", `/api/v1/invitations/${invitationToken}/accept`, {
      user: await registerUser("Luis"),
      params: { token: invitationToken },
    });
    expect(await problemOf(joined)).toEqual([409, "SpaceArchived"]);
    const claimed = await call(acceptClaim, "POST", `/api/v1/claims/${claim.token}/accept`, {
      user: await registerUser("Marta"),
      params: { token: claim.token },
    });
    expect(await problemOf(claimed)).toEqual([409, "SpaceArchived"]);
    const { rows } = await app.pool.query(
      "SELECT display_name, kind FROM space_members WHERE space_id = $1 ORDER BY joined_at, id",
      [h.spaceId],
    );
    expect(rows.map((r: { display_name: string; kind: string }) => [r.display_name, r.kind])).toEqual([
      ["Ana", "USER"],
      ["Juan", "USER"],
      ["Pedro", "GUEST"],
    ]);
  });

  it("refuses a direct split with the guest of an archived direct space", async () => {
    const ana = await registerUser("Ana");
    const bancolombia = await newAccount(ana, "Bancolombia", 2_000_000);
    const dinner = {
      counterpart: { kind: "GUEST", displayName: "Pedro" },
      description: "Dinner",
      date: "2026-10-14",
      categoryKey: "restaurants",
      amount: cop(120_000),
      accountId: bancolombia,
    };
    const first = await call(directSplit, "POST", "/api/v1/direct-splits", { user: ana, body: dinner });
    const { spaceId } = (await first.json()) as { spaceId: string };
    const pedroId = await memberIdOf(ana, spaceId, "Pedro");
    await settles(actingIn(ana, spaceId), pedroId, await memberIdOf(ana, spaceId, "Ana"), 60_000);
    const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${spaceId}/archive`, {
      user: ana,
      params: { spaceId },
    });
    expect(archived.status).toBe(204);
    const again = { ...dinner, counterpart: { kind: "MEMBER", memberId: pedroId } };
    expect(await problemOf(await call(directSplit, "POST", "/api/v1/direct-splits", { user: ana, body: again }))).toEqual([
      409,
      "SpaceArchived",
    ]);
  });
});
```

- [ ] **Step 7: Run the tests**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/archived-space.test.ts`
Expected: PASS with no production change (a red row names the write path that escapes the guard of Task 16, fixed in this commit). Mutation check: temporarily delete the line `    if (membership.archived && options.readOnly !== true) return err(domainError("SpaceArchived"));` from `space-access.ts` — every write row, both joins and the direct split fail; restore it.

- [ ] **Step 8: Gates and commit 18b**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

```bash
git add tests/acceptance/archived-space.test.ts
git commit -m "test(spaces): pin every read and write endpoint of an archived space over HTTP (Refs #18)"
```

---

### Task 19: Balances — settlement suggestions

Implements HU-E5-03 (issue #45) in the `balances` module: a pure `simplifyDebts` (the backlog's `DebtSimplifier`) and the query `GetSettlementSuggestions`, computed on read from `GetSpaceBalances` and never stored.

Decisions:
- The backlog's greedy rule: while someone is owed money, the member who owes the most pays the member owed the most as much as one of them still needs. Every payment settles at least one of the two, so `n` members need at most `n − 1` payments, and each member's payments minus receipts equal exactly what they owe (all in minor units, no rounding). Greedy gives few payments, not always the fewest possible (that problem is NP-hard; Self-Review, contradiction 5).
- Ties (equal amounts) go to the member listed first in the balances, which list current members in join order (M2-B), so the same balances always give the same suggestions in the same order.
- `GetSettlementSuggestions` reuses `createGetSpaceBalances`, so authorization (`space.read`, archived spaces included, Task 16) and the member list stay in one place. Former members still owed or owing (only possible through the race of assumption 4) are part of the balances and therefore of the suggestions.

**Files:**
- Create: `src/modules/balances/application/get-settlement-suggestions.ts`
- Modify: `src/modules/balances/domain/balances.ts`, `src/modules/balances/application/index.ts`
- Test: `src/modules/balances/domain/balances.test.ts`, `src/modules/balances/application/get-settlement-suggestions.test.ts`

**Interfaces:**
- Consumes: `MemberBalance`, `netBalances` (M2-B); `createGetSpaceBalances`, `BalancesDeps` (M2-B); `InMemoryTransactions`, `anExpense` (`tests/support/in-memory-ledger.ts`); `InMemorySpaceStore`, `householdSpace`, `memberOf` (`tests/support/in-memory-spaces.ts`).
- Produces:
  - `interface SettlementSuggestion { payerMemberId: string; receivingMemberId: string; amount: bigint }`
  - `simplifyDebts(balances: readonly MemberBalance[]): SettlementSuggestion[]`
  - `interface SettlementSuggestions { spaceId: string; currency: string; suggestions: readonly SettlementSuggestion[] }`
  - `type GetSettlementSuggestions = (input: { spaceId: string; userId: string }) => Promise<Result<SettlementSuggestions>>`; `createGetSettlementSuggestions(deps: BalancesDeps)` — errors `SpaceNotFound`

- [ ] **Step 1: Write the failing tests**

In `src/modules/balances/domain/balances.test.ts`:

1. Replace the line `import { netBalances, netOf, type MemberTotals } from "./balances";` with:

```ts
import {
  netBalances,
  netOf,
  simplifyDebts,
  type MemberBalance,
  type MemberTotals,
  type SettlementSuggestion,
} from "./balances";
```

2. Append to the end of the file:

```ts

describe("settlement suggestions (HU-E5-03)", () => {
  const nets = (...entries: [string, bigint][]): MemberBalance[] =>
    entries.map(([memberId, net]) => ({ memberId, net }));
  const pays = (payerMemberId: string, receivingMemberId: string, amount: bigint): SettlementSuggestion => ({
    payerMemberId,
    receivingMemberId,
    amount,
  });
  /** What each member pays minus what they receive through the suggestions: −net when they settle everything. */
  const flowOf = (suggestions: readonly SettlementSuggestion[], balances: readonly MemberBalance[]) =>
    balances.map(({ memberId }) => [
      memberId,
      suggestions.reduce(
        (sum, s) =>
          sum + (s.payerMemberId === memberId ? s.amount : 0n) - (s.receivingMemberId === memberId ? s.amount : 0n),
        0n,
      ),
    ]);

  it("lets several debtors pay the one creditor: Juan pays Ana 100,000 COP and Luis pays Ana 50,000 COP", () => {
    const balances = nets(["ana", 15_000_000n], ["juan", -10_000_000n], ["luis", -5_000_000n]);
    expect(simplifyDebts(balances)).toEqual([pays("juan", "ana", 10_000_000n), pays("luis", "ana", 5_000_000n)]);
  });

  it("collapses Ana owing Juan and Juan owing Luis into one payment from Ana to Luis", () => {
    // Ana owes Juan 100,000 and Juan owes Luis 100,000, so Juan's net is 0.
    expect(simplifyDebts(nets(["ana", -10_000_000n], ["juan", 0n], ["luis", 10_000_000n]))).toEqual([
      pays("ana", "luis", 10_000_000n),
    ]);
  });

  it("suggests nothing for a settled group", () => {
    expect(simplifyDebts(nets(["ana", 0n], ["juan", 0n], ["luis", 0n]))).toEqual([]);
  });

  it("breaks ties by join order, so the same balances always give the same suggestions", () => {
    const balances = nets(["ana", 100n], ["juan", 100n], ["luis", -100n], ["sofi", -100n]);
    expect(simplifyDebts(balances)).toEqual([pays("luis", "ana", 100n), pays("sofi", "juan", 100n)]);
  });

  it("settles every net exactly with at most n − 1 positive payments", () => {
    const balances = nets(["ana", 700n], ["juan", 500n], ["luis", -600n], ["sofi", -400n], ["pedro", -200n]);
    const suggestions = simplifyDebts(balances);
    expect(suggestions).toEqual([
      pays("luis", "ana", 600n),
      pays("sofi", "juan", 400n),
      pays("pedro", "ana", 100n),
      pays("pedro", "juan", 100n),
    ]);
    expect(suggestions.length).toBeLessThanOrEqual(balances.length - 1);
    expect(suggestions.every((s) => s.amount > 0n)).toBe(true);
    expect(flowOf(suggestions, balances)).toEqual(balances.map(({ memberId, net }) => [memberId, -net]));
  });

  it("leaves the balances it was given unchanged", () => {
    const balances = nets(["ana", 100n], ["juan", -100n]);
    simplifyDebts(balances);
    expect(balances).toEqual(nets(["ana", 100n], ["juan", -100n]));
  });
});
```

`src/modules/balances/application/get-settlement-suggestions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSpaceAccess } from "@/modules/spaces/application";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { anExpense, InMemoryTransactions } from "../../../../tests/support/in-memory-ledger";
import { householdSpace, InMemorySpaceStore, memberOf } from "../../../../tests/support/in-memory-spaces";
import { createGetSettlementSuggestions } from "./get-settlement-suggestions";

const pesos = (n: bigint) => n * 100n;
// HU-E5-03 Background: "Trip 2026" with Ana, Juan and Luis (the Household fixture of the in-memory store).
const world = () => {
  const spaces = new InMemorySpaceStore();
  spaces.seed(householdSpace([memberOf("Ana", "OWNER", 0), memberOf("Juan", "MEMBER", 1), memberOf("Luis", "MEMBER", 2)]));
  const ledger = new InMemoryTransactions();
  const suggest = createGetSettlementSuggestions({
    access: createSpaceAccess(spaces),
    members: spaces,
    source: ledger,
  });
  return { ledger, suggest };
};

describe("GetSettlementSuggestions (HU-E5-03)", () => {
  it("turns Ana +150,000, Juan −100,000 and Luis −50,000 COP into two payments to Ana, in the space currency", async () => {
    const { ledger, suggest } = world();
    // Ana pays 150,000 COP for Juan (100,000) and Luis (50,000).
    await ledger.add(
      anExpense("2026-10-05", pesos(150_000n), {
        spaceId: "space-household",
        payments: [{ memberId: "member-ana", accountId: null, amount: pesos(150_000n) }],
        shares: [
          { memberId: "member-juan", amount: pesos(100_000n), splitMethod: "EXACT" },
          { memberId: "member-luis", amount: pesos(50_000n), splitMethod: "EXACT" },
        ],
      }),
    );
    expect(unwrap(await suggest({ spaceId: "space-household", userId: "u-luis" }))).toEqual({
      spaceId: "space-household",
      currency: "COP",
      suggestions: [
        { payerMemberId: "member-juan", receivingMemberId: "member-ana", amount: pesos(100_000n) },
        { payerMemberId: "member-luis", receivingMemberId: "member-ana", amount: pesos(50_000n) },
      ],
    });
  });

  it("hides the space from non-members", async () => {
    const { suggest } = world();
    expect(codeOf(await suggest({ spaceId: "space-household", userId: "u-marta" }))).toBe("SpaceNotFound");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/balances`
Expected: FAIL — `simplifyDebts is not a function` and `Failed to resolve import "./get-settlement-suggestions"`.

- [ ] **Step 3: Implement**

Append to `src/modules/balances/domain/balances.ts`:

```ts

/** HU-E5-03: one suggested payment; accepting it is a regular settlement (HU-E5-02). */
export interface SettlementSuggestion {
  readonly payerMemberId: string;
  readonly receivingMemberId: string;
  /** Minor units, always positive. */
  readonly amount: bigint;
}

/**
 * HU-E5-03 DebtSimplifier: while someone is owed money, the member who owes the most pays the member owed
 * the most as much as one of them still needs. Each payment settles at least one of the two, so n members
 * need at most n − 1 payments, and each member pays or receives exactly their net. Ties go to the member
 * listed first (join order), so the same balances always give the same suggestions. Greedy: few payments,
 * not always the fewest possible.
 */
export const simplifyDebts = (balances: readonly MemberBalance[]): SettlementSuggestion[] => {
  const open = balances.map((b, order) => ({ memberId: b.memberId, net: b.net, order }));
  /** The open member furthest from zero on the side `sign` (1n: owed money, -1n: owes money). */
  const largest = (sign: bigint) =>
    open
      .filter((m) => m.net * sign > 0n)
      .sort((a, b) => {
        const difference = b.net * sign - a.net * sign;
        return difference === 0n ? a.order - b.order : difference > 0n ? 1 : -1;
      })[0];
  const suggestions: SettlementSuggestion[] = [];
  for (;;) {
    const creditor = largest(1n);
    const debtor = largest(-1n);
    if (!creditor || !debtor) return suggestions;
    const amount = creditor.net < -debtor.net ? creditor.net : -debtor.net;
    suggestions.push({ payerMemberId: debtor.memberId, receivingMemberId: creditor.memberId, amount });
    creditor.net -= amount;
    debtor.net += amount;
  }
};
```

`src/modules/balances/application/get-settlement-suggestions.ts`:

```ts
import { map, type Result } from "@/shared/kernel";
import { simplifyDebts, type SettlementSuggestion } from "../domain/balances";
import { createGetSpaceBalances, type BalancesDeps } from "./get-space-balances";

export interface SettlementSuggestions {
  readonly spaceId: string;
  readonly currency: string;
  readonly suggestions: readonly SettlementSuggestion[];
}

export type GetSettlementSuggestions = (input: {
  spaceId: string;
  userId: string;
}) => Promise<Result<SettlementSuggestions>>;

/** HU-E5-03: suggestions computed on read from the balances (D7), never stored; any member may read them. */
export const createGetSettlementSuggestions = (deps: BalancesDeps): GetSettlementSuggestions => {
  const getBalances = createGetSpaceBalances(deps);
  return async (input) =>
    map(await getBalances(input), (balances) => ({
      spaceId: balances.spaceId,
      currency: balances.currency,
      suggestions: simplifyDebts(balances.members),
    }));
};
```

In `src/modules/balances/application/index.ts`:

1. Replace the line `export type { MemberBalance, MemberTotals } from "../domain/balances";` with:

```ts
export type { MemberBalance, MemberTotals, SettlementSuggestion } from "../domain/balances";
```

2. Append to the end of the file:

```ts
export {
  createGetSettlementSuggestions,
  type GetSettlementSuggestions,
  type SettlementSuggestions,
} from "./get-settlement-suggestions";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/balances`
Expected: PASS. Mutation check: temporarily replace `a.order - b.order` with `b.order - a.order` — "breaks ties by join order" fails; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/balances/domain/balances.ts src/modules/balances/domain/balances.test.ts src/modules/balances/application/get-settlement-suggestions.ts src/modules/balances/application/get-settlement-suggestions.test.ts src/modules/balances/application/index.ts
git commit -m "feat(balances): suggest the settlements that clear a space's balances (Refs #45)"
```

---

### Task 20: HTTP — settlement suggestions

Exposes HU-E5-03 (issue #45): `GET /api/v1/spaces/{spaceId}/balances/suggestions` → `200 { "suggestions": [{ "payerMemberId", "receivingMemberId", "amount": Money }] }`. A suggestion's fields are the settlement body's fields, so accepting one is a regular `POST …/settlements` (HU-E5-02).

Decisions:
- The response schema is inline (no new component), so the OpenAPI growth is one operation.
- The acceptance tests produce the story's nets with EXACT splits (M2-B): "Ana +150,000, Juan −100,000, Luis −50,000" is Ana paying 150,000 for Juan (100,000) and Luis (50,000); the chain is Juan paying 100,000 for Ana and Luis paying 100,000 for Juan.

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/balances/suggestions/route.ts`
- Modify: `src/modules/balances/contracts/balances.contract.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`
- Test: `tests/acceptance/settlement-suggestions.test.ts`

**Interfaces:**
- Consumes: `createGetSettlementSuggestions`, `GetSettlementSuggestions`, `SettlementSuggestions` (Task 19); `DrizzleLedgerQueries.memberTotals` (M2-B); the archive route (Task 18a); `household`, `joinHousehold`, `post`, `cop`, `balancesOf`, `MoneyDto`, `HouseholdMember` (`tests/support/ledger.ts`).
- Produces: `SettlementSuggestionsSchema`, `settlementSuggestionsDto(s: SettlementSuggestions)`; `GET /api/v1/spaces/{spaceId}/balances/suggestions`; `Container.balances.getSettlementSuggestions`.

- [ ] **Step 1: Write the failing acceptance test**

`tests/acceptance/settlement-suggestions.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { GET as getSuggestions } from "@/app/api/v1/spaces/[spaceId]/balances/suggestions/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  balancesOf,
  cop,
  household,
  joinHousehold,
  post,
  type HouseholdMember,
  type MoneyDto,
} from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface SuggestionDto {
  payerMemberId: string;
  receivingMemberId: string;
  amount: MoneyDto;
}
const suggestionsPath = (spaceId: string) => `/api/v1/spaces/${spaceId}/balances/suggestions`;
const suggestionsOf = async (user: TestUser, spaceId: string): Promise<SuggestionDto[]> => {
  const response = await call(getSuggestions, "GET", suggestionsPath(spaceId), { user, params: { spaceId } });
  expect(response.status).toBe(200);
  return ((await response.json()) as { suggestions: SuggestionDto[] }).suggestions;
};
const pays = (payerMemberId: string, receivingMemberId: string, pesos: number): SuggestionDto => ({
  payerMemberId,
  receivingMemberId,
  amount: cop(pesos),
});
/** `payer` pays from their own account what each listed member owes, split EXACT; the payer takes no share. */
const paysFor = async (payer: HouseholdMember, categoryId: string, owed: [string, number][]) => {
  const pesos = owed.reduce((sum, [, part]) => sum + part, 0);
  const response = await post(recordExpense, payer, "expenses", {
    description: "Trip",
    date: "2026-10-05",
    categoryId,
    amount: cop(pesos),
    payments: [{ memberId: payer.memberId, accountId: payer.account, amount: cop(pesos) }],
    split: { method: "EXACT", participants: owed.map(([memberId, part]) => ({ memberId, amount: cop(part) })) },
  });
  expect(response.status).toBe(201);
};
/** HU-E5-03 Background: "Trip 2026" with Ana, Juan and Luis (the household helper with Luis joined). */
const trip = async () => {
  const h = await household();
  return { h, luis: await joinHousehold(h, "Luis", "MEMBER") };
};

describe("settlement suggestions (HU-E5-03)", () => {
  it("suggests that Juan pays Ana 100,000 COP and Luis pays Ana 50,000 COP", async () => {
    const { h, luis } = await trip();
    await paysFor(h.ana, h.groceries, [
      [h.juan.memberId, 100_000],
      [luis.memberId, 50_000],
    ]);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(150_000)],
      [h.juan.memberId, cop(-100_000)],
      [luis.memberId, cop(-50_000)],
    ]);
    expect(await suggestionsOf(h.ana, h.spaceId)).toEqual([
      pays(h.juan.memberId, h.ana.memberId, 100_000),
      pays(luis.memberId, h.ana.memberId, 50_000),
    ]);
  });

  it("collapses Ana owing Juan and Juan owing Luis into one payment from Ana to Luis", async () => {
    const { h, luis } = await trip();
    await paysFor(h.juan, h.groceries, [[h.ana.memberId, 100_000]]);
    await paysFor(luis, h.groceries, [[h.juan.memberId, 100_000]]);
    expect(await suggestionsOf(h.ana, h.spaceId)).toEqual([pays(h.ana.memberId, luis.memberId, 100_000)]);
  });

  it("returns no suggestions for a settled group", async () => {
    const { h } = await trip();
    expect(await suggestionsOf(h.ana, h.spaceId)).toEqual([]);
  });

  it("records an accepted suggestion as a regular settlement, which clears Juan's part", async () => {
    const { h, luis } = await trip();
    await paysFor(h.ana, h.groceries, [
      [h.juan.memberId, 100_000],
      [luis.memberId, 50_000],
    ]);
    const [juanPaysAna] = await suggestionsOf(h.juan, h.spaceId);
    const settled = await post(recordSettlement, h.juan, "settlements", { date: "2026-10-30", ...juanPaysAna });
    expect(settled.status).toBe(201);
    expect(await settled.json()).toMatchObject({
      type: "SETTLEMENT",
      payerMemberId: h.juan.memberId,
      receivingMemberId: h.ana.memberId,
      amount: cop(100_000),
    });
    expect(await suggestionsOf(h.ana, h.spaceId)).toEqual([pays(luis.memberId, h.ana.memberId, 50_000)]);
  });

  it("lets a viewer read the suggestions and hides them from everyone else", async () => {
    const { h } = await trip();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    expect(await suggestionsOf(sofi, h.spaceId)).toEqual([]);
    const marta = await registerUser("Marta");
    for (const spaceId of [h.spaceId, "not-a-uuid"]) {
      const response = await call(getSuggestions, "GET", suggestionsPath(spaceId), { user: marta, params: { spaceId } });
      expect(await problemOf(response)).toEqual([404, "SpaceNotFound"]);
    }
  });

  it("still answers for an archived space, which only reads (HU-E1-09, the read table of Task 18b)", async () => {
    const { h } = await trip();
    const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    expect(archived.status).toBe(204);
    expect(await suggestionsOf(h.juan, h.spaceId)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/settlement-suggestions.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/balances/suggestions/route"`.

- [ ] **Step 3: Contract, route and wiring**

In `src/modules/balances/contracts/balances.contract.ts`:

1. Replace the line `import type { SpaceBalances } from "../application";` with:

```ts
import type { SettlementSuggestions, SpaceBalances } from "../application";
```

2. Insert before the line `const SpacePath = z.object({ spaceId: z.string() });`:

```ts
/** HU-E5-03: each suggestion has the fields of a settlement (HU-E5-02); POST it to accept it. */
export const SettlementSuggestionsSchema = z.object({
  suggestions: z.array(
    z.object({ payerMemberId: z.string(), receivingMemberId: z.string(), amount: MoneySchema }),
  ),
});

export const settlementSuggestionsDto = (
  s: SettlementSuggestions,
): z.infer<typeof SettlementSuggestionsSchema> => ({
  suggestions: s.suggestions.map((suggestion) => ({
    payerMemberId: suggestion.payerMemberId,
    receivingMemberId: suggestion.receivingMemberId,
    amount: { amount: suggestion.amount.toString(), currency: s.currency },
  })),
});

```

3. Insert before the last line of the file (`};`):

```ts
  "/api/v1/spaces/{spaceId}/balances/suggestions": {
    get: {
      operationId: "getSettlementSuggestions",
      summary: "Payments that clear every balance, at most one fewer than the members; computed on read",
      ...securedByUser,
      requestParams: { path: SpacePath },
      responses: {
        "200": {
          description: "Suggested settlements, the largest debts first",
          content: jsonContent(SettlementSuggestionsSchema),
        },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound" }),
      },
    },
  },
```

`src/app/api/v1/spaces/[spaceId]/balances/suggestions/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { settlementSuggestionsDto } from "@/modules/balances/contracts/balances.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().balances.getSettlementSuggestions({
      spaceId: params.spaceId!,
      userId: user!.id,
    });
    return result.ok ? ok({ status: 200, body: settlementSuggestionsDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Add after the line `  createGetMemberNetBalance,` (in the `@/modules/balances/application` import):

```ts
  createGetSettlementSuggestions,
```

2. Add after the line `  type GetSpaceBalances,`:

```ts
  type GetSettlementSuggestions,
```

3. Replace the line `  readonly balances: { readonly getSpaceBalances: GetSpaceBalances };` with:

```ts
  readonly balances: {
    readonly getSpaceBalances: GetSpaceBalances;
    readonly getSettlementSuggestions: GetSettlementSuggestions;
  };
```

4. Add after the line `      getSpaceBalances: createGetSpaceBalances({ access, members: spaceRepository, source: ledgerQueries }),`:

```ts
      // HU-E5-03: suggestions are computed on read from the same balances (D7).
      getSettlementSuggestions: createGetSettlementSuggestions({
        access,
        members: spaceRepository,
        source: ledgerQueries,
      }),
```

- [ ] **Step 4: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/settlement-suggestions.test.ts`
Expected: PASS.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `GET /api/v1/spaces/{spaceId}/balances/suggestions` (about 90 lines); components are unchanged.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/v1/spaces/[spaceId]/balances/suggestions/route.ts" src/modules/balances/contracts/balances.contract.ts src/composition/container.ts tests/acceptance/settlement-suggestions.test.ts openapi/openapi.snapshot.json
git commit -m "feat(balances): expose settlement suggestions over HTTP (Refs #45)"
```

---

## Self-Review

### Story coverage

| Story | Scenario → where it is tested |
|---|---|
| HU-E1-08 (#17) | Member with a zero balance leaves (leftAt set; past expenses still name him) → Tasks 2, 3, 4.2 · Non-zero balance → `OutstandingBalance` with 150,000 COP in the body → Tasks 1, 2, 4.1, 4.2 · Money owed by a guest also blocks leaving (50,000 COP) → Tasks 2, 4.2 · The last owner cannot leave → Tasks 1, 2, 3 (concurrent), 4.2 · A personal space cannot be left → Tasks 1, 2, 4.2 · Technical notes: `GetMemberNetBalance` → Task 2; `POST /api/v1/spaces/{spaceId}/leave` → Task 4.2; former members are never payer, participant or settlement party again → Task 4.2, and no edit or deletion moves their balance → Task 4b; the net includes debts with guests → Tasks 2, 4.2; `DirectSpaceMembersFixed` in the backlog's catalogue → Task 1 |
| HU-E1-09 (#18) | Owner archives a settled space, guest included, listed with the archived filter (beside the active ones, the M1 convention) → Tasks 17, 18a · Archived space rejects new transactions (`SpaceArchived`) → Tasks 16, 18a, 18b · Outstanding balances block archiving → Tasks 17, 18a · A guest's outstanding balance blocks archiving → Tasks 17, 18a · A personal space cannot be archived (`PersonalSpaceNotArchivable`) → Tasks 17, 18a · Technical notes: OWNER only → Tasks 17, 18a; `POST …/archive` and `GET /spaces?archived=true` → Task 18a; every write use case checks archivedAt through a shared guard → Tasks 16 (the guard), 18b (every space-scoped write endpoint over HTTP, invitation and claim acceptance included); the zero-balance check covers every current member, SHARED and DIRECT alike → Task 17 |
| HU-E1-11 (#20) | New user registers through the claim link and keeps the history (@critical) → Tasks 6, 7, 9, 10 · An existing account claims; still one personal space → Tasks 7, 10 · A user who is already a member cannot claim (`AlreadyMember`, Pedro stays a guest) → Tasks 7, 9, 10 · Unusable links: 8 days old (`InvitationExpired`), used (`GuestAlreadyClaimed`, also when two claim at once), revoked (`InvitationRevoked`) → Tasks 6, 7, 9, 10 · A claim affects only its own space → Task 10 · Technical notes: `CreateGuestClaim` OWNER or ADMIN → Tasks 7, 10; a claim is an invitation bound to the guest, single use, 7 days, token hashed → Tasks 5, 6, 7, 9, 10; endpoints → Task 10; same member id, `kind = USER`, `role = MEMBER` (OWNER in a direct space, ruling O3), `claimedAt`, no money row rewritten → Tasks 6, 9, 10; sign-up first, then the claim → Task 10; bearer links not bound to the contact email → Tasks 6, 10; a claimed direct space becomes the pair's direct space → Tasks 14b, 15d; unified view → M4 (contradiction 4) |
| HU-E1-12 (#21) | Guest with a zero balance is removed (leftAt; no longer a current member) → Tasks 3, 8, 11 · Non-zero balance → `OutstandingBalance` with 100,000 COP → Tasks 8, 11 · History keeps the guest's name (and kind, share) → Task 11 (contradiction 2) · A viewer cannot remove a guest → Tasks 1, 8, 11 · Registered members are not removed as guests (`NotAGuest`) → Tasks 1, 8, 11 · Technical notes: soft removal → Tasks 3, 8; pending claim links revoked → Tasks 8, 9, 11; the display name becomes free → Task 11; a removed guest's balance stays settled → Task 4b |
| HU-E1-13 (#22) | First split with a guest creates a direct space (@critical) → Tasks 12, 13, 14, 15b · Later splits reuse the direct space → Tasks 13, 15c · A direct space cannot get a third member (guest, invitation) → Tasks 12, 15c · Direct space with a registered user; Juan's later split reuses it → Tasks 13, 14, 15c · Default period policy, EQUAL by default → Tasks 12, 15b, 15c ("no budget plan": budgeting is M3, contradiction 7) · Technical notes: one transaction → Tasks 13, 15d (mutation check); `Idempotency-Key` → Task 15d; exactly two current members on every path → Tasks 2, 8, 12, 15d; both registered members OWNER → Tasks 6, 12, 15c; one direct space per pair (unique index), also after a claim → Tasks 5, 14, 14b, 15d; choosing the guest reuses its space → Tasks 13, 15c; registered counterparts only among people the user shares a space with → Tasks 13, 15d; currency from the creator's personal space, default categories seeded → Tasks 13, 15; `InvalidDirectCounterpart` in the backlog's catalogue → Task 13 |
| HU-E5-03 (#45) | Several debtors pay one creditor → Tasks 19, 20 · Chained debts collapse into one payment → Tasks 19, 20 · Settled group has no suggestions → Tasks 19, 20 · Accepting a suggestion records a settlement → Task 20 · Technical notes: greedy, at most n − 1 → Task 19; computed on read, the endpoint (also for an archived space) → Tasks 19, 20 |
| HU-E1-05 (#14, M2-A policy rows) | "Ana archives the space" / "Juan archives the space" now through `ArchiveSpace` → Tasks 17, 18a |
| M2-A assumption 16 | `ensureCanAddMember` refuses a third member of a direct space → Task 12 |
| HU-E3-03 (#29, closed M1 story; `Refs` only) | Delete a category without transactions → now logical: the row stays with `deleted_at`, the tree skips it with and without `?archived=true`, and its name is free again → Task 0a (unit, integration, acceptance) · A deleted category answers `CategoryNotFound` to a new expense and to update, archive, restore and a second delete → Task 0a (unit, acceptance) · A referenced category still answers `CategoryInUse` → M1, unchanged · A transaction keeps its reference to a deleted category → Task 0a (integration, red before the change) |
| HU-E4-06 (#35, closed M1 story; `Refs` only) | The audit of an edit keeps the payments and shares before and after, in position order → Task 0b (unit, PostgreSQL round trip, `GET …/audit`) · A deletion keeps the whole last version → Task 0b (unit, `GET …/audit`) · An edit that changes nothing still writes no entry → M1, unchanged |

Spec checks: D8 as amended in Task 0a (every delete logical; physical deletes only for expired idempotency keys and the sign-up compensation; the audit keeps every edited part) → Tasks 0a, 0b, and Tasks 3, 9, 17 for members, claim links and spaces; §5.2 Category (deleted logically, name freed, groups never deleted) → Task 0a; §5.2 SpaceMember (`leftAt`, `claimedAt`, guests kind/user/role) and D15 → Tasks 1–11, 4b; §5.2 Space (`DIRECT`, exactly two members, both OWNER, named after both, reused, `archivedAt`) and D16 → Tasks 5, 12–18, 14b; §5.2 claim (shareable, not bound to `contactEmail`, same member id, a member cannot claim another guest, per space) → Tasks 5–10; §5.3 (default EQUAL split; ties by join order) → Tasks 12, 15; D2 (one ledger for every space kind) → Task 15; D7 (computed on read) → Tasks 2, 17, 19, 20; D9 (account rule unchanged after leaving) → Tasks 4.2, 4b; D11 (catalog keys) → Task 15a; §7 (Idempotency-Key on the direct split, problem+json, OpenAPI snapshot) → Tasks 4.1, 4.2, 4b, 10, 11, 15b, 18a, 20; §8 (`404 SpaceNotFound`, `403`, `409` invariants, `OutstandingBalance`, `DirectSpaceIsFull`, `GuestAlreadyClaimed`, `422 NotASpaceMember`; the backlog as the error catalogue) → Tasks 1, 4.2, 4b, 10, 11, 13, 15d, 18.

### Review Focus pins

1. Members leaving or being removed while money ties them → Task 1 (`outstandingIn` both directions), Task 2 (debtor, creditor of a guest, viewer), Task 4.2 (HTTP: amount in the body, guest debt, viewer, former member refused as participant and as settlement party, `AccountNotOwned` after leaving), Task 4b (an amount edit or a deletion that would move a former member's balance answers `NotASpaceMember`, unit and HTTP), Task 8 and Task 11 (guests).
2. Claim links in the wrong place or twice → Task 6 (used, revoked, expired), Task 7 (cross-use of tokens both ways, second link of a claimed guest, a race decided by the database), Task 9 (conditional UPDATE against removed, claimed and malformed guests; two simultaneous claims of one link against PostgreSQL), Task 10 (HTTP), Task 11 (a removed guest's link is revoked), Task 18b (a claim of an archived space).
3. Invalid direct-split counterparts and failed or retried splits → Task 12 (names, namesakes, currency), Task 13 (self, shared guest, foreign and malformed ids), Task 14b (a claimed direct space keeps being the pair's), Task 15 (HTTP: 404/422/409, no space left behind with a mutation check on the transaction, Idempotency-Key replay and conflict, reuse after a claim), Task 16 (archived spaces on the way).
4. Writes to an archived space → Task 16 (every action but `space.read` through the guard, direct access refused, the direct split's counterpart check as a read), Task 18b (HTTP tables: 10 reads answer 200; all 27 space-scoped write endpoints, invitation and claim acceptance and a direct split answer 409), Task 20 (suggestions still read).
5. Simultaneous lifecycle changes → Task 3 (two owners leave; rendezvous; lock-removal check), Task 9 (two claims of one link), Task 14 (two first splits; `onConflictDoNothing` and the index; removal checks), Task 13 (the use case records in the winner's space). Leaving, removal or archiving racing a money write is accepted for v1 (assumption 4, ruling O2); its locking is the follow-up Facabore/Hearth#89.
6. Anything deleted or replaced physically → Task 0a (the deleted category's row stays and keeps a transaction's reference, an integration test red before the change; the tree with and without `?archived=true` skips it; a new expense, update, archive, restore and a second delete answer `CategoryNotFound`; the name is free again in the domain and under the partial index; mutation checks on the filter and on the delete), Task 0b (`changesBetween` keeps the parts in position order, `deletionChanges` keeps the whole last version, the earlier split recovered from `jsonb`, `GET …/audit` after an edit and a deletion; mutation checks on the shares key and on the deletion snapshot).

### Spec contradictions found

1. **Role of a claimed guest in a direct space.** Spec 5.2 says claiming switches the guest "to `USER` with role `MEMBER`"; D16 and HU-E1-13 say both registered members of a direct space are OWNER. The plan gives `MEMBER` in shared spaces and `OWNER` in direct spaces (`claimedGuest` with `DIRECT_MEMBER_ROLE`, Task 6); the claim link itself is stored as `MEMBER`, since `space_invitations_role` never holds `OWNER`. **Ruled by the controller (O3):** D16 is specific to direct spaces and wins over the general claim rule.
2. **"Pedro of kind GUEST" after removal (HU-E1-12).** No endpoint lists former members (`GET …/members` lists current ones, M2-A). The plan checks the transaction's share over HTTP and the member row's kind and name with SQL (Task 11); listing former members is a follow-up for the screens.
3. **`claimedAt` (HU-E1-11).** The member DTO has no `claimedAt`; the plan stores it and checks it with SQL (Tasks 9, 10).
4. **Unified view (HU-E1-11).** Testable only with HU-E7-04 (M4), as the backlog notes; the `@critical` test reads Pedro's share through the ledger's participant filter (Task 10).
5. **"Fewest payments" (HU-E5-03).** The story asks for the fewest payments; its technical note specifies the greedy `DebtSimplifier` with at most n − 1 payments. Minimal transfer count in general is NP-hard; the plan implements the greedy rule and documents that it is not always the global minimum (Task 19).
6. **Direct-split body.** HU-E1-13's scenarios only use the requester paying and EQUAL splits; a client cannot name member or category ids of a space that does not exist yet. The endpoint accepts the requester's account, the amount and a category **key** (D11, resolved by the ledger's `RecordExpenseByCategoryKey`), and splits EQUAL; other methods and payers go through `POST …/expenses` in the direct space (Task 15).
7. **"It has no budget plan" (HU-E1-13).** Budgeting is M3; no space has a plan yet, so there is nothing to assert (Task 15).
8. **Accepting an invitation to an archived space.** M2-A (assumption 12) answered `404 SpaceNotFound` because `findMembership` hid archived spaces; HU-E1-09 needs archived spaces to stay readable, so the join is now refused with `409 SpaceArchived` and rolled back (Task 16). Claims behave the same way. **Ruled by the controller (O5):** kept, pinned for both invitations and claims in Task 18b, and named in a PR note (clients relying on 404 there must read 409).
9. **Role changes in personal and direct spaces.** No story covers them. `ChangeMemberRole` now answers `PersonalSpaceNotShareable` in a personal space (it answered `LastOwnerRequired` when the owner demoted themself) and `DirectSpaceMembersFixed` in a direct space (D16: both OWNER) (Task 12).
10. **Leaving or removing in a direct space.** No story covers it; D16 says a direct space has exactly two members, so the plan refuses both with `DirectSpaceMembersFixed` (Tasks 1, 2, 8, 15d). The way to retire a direct space is archiving it (HU-E1-09 includes DIRECT spaces), which frees the pair for a new direct space (Tasks 5, 14). **Ruled by the controller (O7):** kept.
11. **The outstanding amount when archiving.** HU-E1-09 does not ask for it in the body; the plan reports, with the same `outstanding` member, what the current members' creditors are owed (or what the debtors owe, whichever is larger), so the problem body has one shape for one code (Tasks 1, 17).
12. **A claimed direct space and D16's "both are kept".** D16 keeps both direct spaces only when "the two users already had another direct space"; otherwise a direct space "is reused for later splits with that person". So a guest's direct space whose guest claims it takes the pair key when the pair has no other active direct space (Task 14b), and keeps none when it has. **Ruled by the controller (O8).**
13. **Edits and deletions after someone left.** No story covers them, but HU-E1-08 and HU-E1-12 settle a member before they go, and HU-E5-02 refuses settlements with former members, so a later edit or deletion that moved their balance could never be settled and would block archiving forever. An amount edit or a deletion that would move a former member's balance answers `422 NotASpaceMember` (Task 4b). **Ruled by the controller (O1, option A):** cost, a transaction involving a departed member can no longer be corrected (its description, date and category still can).
14. **Hard deletes in M1 against "everything stays stored".** Spec 5.2 said categories are "never hard-deleted while referenced", and M1 hard-deleted the unreferenced ones (`.delete(categories)`). M1's audit also kept only the top-level fields while `save` replaced an expense's payment and share rows, so an earlier split was lost. **Ruled by the owner (directive 2026-10-14):** every delete is logical. D8 and the Category entry of 5.2 are amended in Task 0a; categories get `deleted_at` (Task 0a), and the audit keeps every payment and share (Task 0b). HU-E3-03's `CategoryInUse` stays: a referenced category is still archived rather than deleted.

### Assumptions

1. **Authorization** — leaving is `space.leave` (every role, viewers included); removing a guest is `guest.remove` (MEMBER or above, D15); claim links are `member.invite` (OWNER, ADMIN, as M2-A's matrix comment says); claiming needs no matrix action (the bearer token authorizes, like accepting an invitation); archiving is `space.archive` (OWNER). Tasks 1, 7, 17.
2. **Settled first, never settled for you** — a non-zero net refuses leaving, removal and archiving with `409 OutstandingBalance`; the API never settles automatically. One member's outstanding amount is `|net|`; a space's is the larger of what its current members are owed and what they owe. Once settled, a former member's balance stays settled (Task 4b). Tasks 1, 2, 4b, 8, 17.
3. **Direct spaces** — created on the first split, named "Creator & Other" (cut to 80 characters; a registered namesake becomes "Ana 2", a guest namesake is refused); exactly two members, never more and never fewer; both registered members OWNER (also after a claim); one active direct space per pair of registered users, keyed at creation, or when a claim turns a guest's direct space into a two-user space whose pair has no other active one (Task 14b); a pair has two only when the guest's space is claimed while the pair already had one (spec D16: "both are kept"; merging is deferred); picking someone inside an active direct space reuses that space; picking a registered member of a shared space reuses the pair's space or creates it; the currency is the creator's personal-space currency (COP if, against HU-E1-02, none is found). Tasks 12–15, 14b.
4. **No lock against concurrent money movements (controller ruling O2)** — a member who leaves, or a guest who is removed, while someone else records an expense or settlement that names them, or a space archived while money is recorded in it, is not serialized: the check and the change can interleave. The consequence is not a lost movement (the balances still list former members with history, M2-B) but a debt nobody can settle: a former member who keeps a non-zero balance cannot take part in a settlement (HU-E5-02), and an archived space takes no new movement at all, so such a space can no longer be archived, or stays archived with a debt. The probability is low in a household app. The plan accepts it for v1, the PR names it, and the locking is the follow-up Facabore/Hearth#89, "Serialize leave, remove and archive against concurrent money writes" (member row `FOR UPDATE` on leave and removal, `FOR SHARE` on money writes; the space row `FOR UPDATE` on archive). The plan pins the races it does close (two owners leaving, two claims of one link, two first splits). Execution Workflow.
5. **Claim and join at the same instant** — if a user accepts a link invitation to a space at the very moment they claim a guest of that space, both statements can pass their checks; `space_members_current_user_uq` refuses the second (`500` for that request, never a double membership). A first split of a pair inserting the pair key at the very moment a claim adopts it ends the same way (`spaces_direct_pair_uq`, Task 14b). Tasks 9, 14b.
6. **Archived spaces** — every write is refused (`409 SpaceArchived`), leaving and joining included; every read keeps working for current members; the space leaves the default `GET /spaces` and appears, beside the active ones, with `?archived=true` (the M1 convention, ruling O4); the `Space` DTO has no `archivedAt` yet. Tasks 16–18.
7. **Claiming keeps the guest's display name** (not the account's name), clears the contact email, and keeps `joinedAt`; the claim link is a bearer link usable by any signed-in user who is not a member yet. Tasks 6, 7.
8. **Tokens** — claim links reuse the invitation machinery: 256 random bits, base64url (43 characters), only the SHA-256 stored, URL `<BETTER_AUTH_URL>/claims/<token>`, locked with `FOR UPDATE` when used. Tasks 7, 10.
9. **Suggestions** — computed on read from `GetSpaceBalances`; amounts in minor units, exact (no rounding); order is the greedy's (largest debts first, ties by join order). Tasks 19, 20.
10. **`GetMemberNetBalance` and `GetMemberNetBalances` do not authorize**; leaving and removal read one member's net, and archiving reads every current member's net from one aggregate (`GetMemberNetBalances`, one snapshot). Tasks 2, 17.
11. **Malformed or foreign member ids** in paths or bodies answer `404 MemberNotFound` (claim links, guest removal, direct splits), never `500`. Tasks 7, 8, 11, 13, 14, 15.
12. **Deferred** — HU-E5-04 (see below); merging direct spaces after a claim (D16); former-member listing and the `archivedAt`/`claimedAt` DTO fields; other split methods in a direct split.
13. **Logical deletes (owner directive 2026-10-14, D8 amended in Task 0a)** — a deleted category keeps its row and its `deleted_at`. It answers exactly like a missing one (`404 CategoryNotFound`) to every read, write and ledger lookup, because they all go through `listCategories`. Its name is free again, and its catalog key stays taken (seeding never runs twice, so a deleted seeded category is never re-seeded). HU-E3-03's `CategoryInUse` is unchanged. There is no undelete: `RestoreCategory` restores archived categories only, and a deleted one answers `CategoryNotFound`. The row is kept for traceability and for any reference that appears anyway. The only physical deletes left in Hearth's code are the two technical ones D8 names: expired idempotency keys (`DrizzleIdempotencyStore.claim`) and the sign-up compensation (`createSignUp` → `BetterAuthProvider.deleteUser`). Sessions are managed by better-auth itself; they are authentication state, not data a member recorded. Tasks 0a, 0b.
14. **Audit snapshots, not versioned rows (Task 0b)** — an expense's `payments` and `shares` rows keep holding only its current version (`save` still replaces them), and every edit that changes them audits both versions as deterministic JSON in position order; a deletion audits the whole last version (`to: null`). The alternative, versioned payment and share rows, was rejected: every balance query (`memberTotals`, `netBalances`), the account balance sheet and every ledger read would have to pick the current version. Today an edit changes the parts only when a sole payment or share follows a new amount (HU-E4-06), and the snapshot already covers any later split editor. Tasks 0b, 4b.

### Follow-ups (not delivered; listed in the PR description)

- **Locking leave, removal and archiving against concurrent money writes** (assumption 4, ruling O2): opened as Facabore/Hearth#89, "Serialize leave, remove and archive against concurrent money writes" (Backlog; member row `FOR UPDATE` on leave/remove, `FOR SHARE` on money writes; space row `FOR UPDATE` on archive), linked from the PR.
- **SpaceArchived in older operations' docs.** Every write operation of M1–M2-B can now answer `409 SpaceArchived`, but their OpenAPI `409` descriptions do not name it yet; one documentation-only commit adds it (snapshot change of about one line per operation).
- **DTO fields and former members.** Expose `archivedAt` on `Space` (so a client tells archived spaces apart in `?archived=true` without comparing lists) and `claimedAt` on `SpaceMember`, and let `GET …/members?former=true` list former members, so the screens (HU-E9-05, HU-E9-07) can name them in history (contradictions 2, 3).
- **A defensive two-member check in `AcceptInvitation`.** Unreachable today (no invitation can exist for a direct space, Task 12), so not added; it would need the space kind of a space the acceptor is not in yet.
- **Merging direct spaces** of the same pair after a claim (spec D16 defers it).
- **Direct splits with other split methods or payers** (contradiction 6).
- **#43 comment.** The controller comments on #43 that the who-pays-whom list it deferred is `GET …/balances/suggestions` (#45).

### Stories moved to a later plan

- **HU-E5-04 (#46, Should) — Show balance history per member.** It needs a window-function query over balance-affecting rows in the ledger's infrastructure, its in-memory twin pinned against it on the same fixtures (as M2-B did for `memberTotals`), the use case with the period's opening balance, and its endpoint: about three tasks, which would take this plan to 27 tasks (about 35 commits). The Must stories, the Shoulds HU-E1-09 and HU-E5-03, and the owner's logical-delete directive (Tasks 0a, 0b) fill the 24 tasks (32 commits with the split parts); #46 stays open for the next plan, which can build directly on `memberTotals` (M2-B), `MemberNetBalance` (Task 2) and `GetMemberNetBalances` (Task 17).

### Placeholder and consistency scan

- No "TBD", "similar to Task N" or prose-only code steps: every code step is a whole file or an anchored edit with its exact text; tests that close a split (13b, 15c, 15d, 18b) say what to do when one is red, and every split half imports only what its own code and tests use.
- Names used across tasks were checked against their producers: `CategoryRepository.deleteCategory(…, deletedAt)`, `InMemoryCategories.deleted` (Task 0a; `listCategories` keeps its signature, so Task 15b's `findByKey` and the container's `CategoryReader.find` skip deleted categories unchanged); `deletionChanges` and the `payments`/`shares` keys of `changesBetween` (Task 0b) → Task 4b (which reads `changes.amount`, a key Task 0b keeps); `leavingMember`, `currentGuest`, `outstandingIn`, `ensureSettled`, `ensureMembersCanChange` (Task 1) → Tasks 2, 7, 8, 12, 17; `MemberLifecycleRepository`, `LifecycleDeps`, `MemberNetBalance`, `createLeaveSpace`, `createGetMemberNetBalance` (Task 2) → Tasks 3, 4.2, 8, 11, 17, 18a; `publicDetailsOf` (Task 4.1); `paysEqually`, `settles`, `lifecycleDeps` (Task 4.2) → Tasks 4b, 11, 18a, 18b; `balanceParties`, `ensureCurrentParties` (Task 4b); `guestMemberId`, `InvitationKind` (Task 5) → Tasks 6–9; `issueClaim`, `isClaim`, `ensureClaimable`, `claimedGuest`, `DIRECT_MEMBER_ROLE` (Task 6) → Tasks 7–9, 12; `GuestClaimRepository`, `ClaimOutcome`, `ClaimsDeps`, `createCreateGuestClaim` (Task 7a), `createClaimGuestPlace` (Task 7b) → Tasks 9, 10, 14b; `ClaimLinkRepository`, `createRemoveGuestMember`, `RemoveGuestDeps` (Task 8) → Tasks 9, 11; `claimLink`, `invitationRepository` (Task 10) → Tasks 11, 15d, 18b; `createDirectSpace`, `pairKeyOf`, `directPairKey`, `DirectCounterpart`, `founder`, `MAX_SPACE_NAME` (Task 12) → Tasks 13, 14, 14b, 17; `DirectSpaceRepository`, `MemberInSpace`, `createSplitWithPerson`, `DirectSplit`, `DirectSplitCounterpart`, `DirectExpenseRecorder` (Task 13) → Tasks 14, 15, 16; `GuestClaimRepository.adoptPairKey` (Task 14b) → Task 15d; `CategoryKeyReader`, `createRecordExpenseByCategoryKey`, `DirectSplitExpense`, `directSplitFromBody`, `directSplitDto` (Task 15a) → Task 15b; `isReadOnly`, `SpaceMembership.archived`, `InMemorySpaceStore.archived` (Task 16) → Tasks 17, 18; `ensureArchivable`, `SpaceArchiveRepository`, `MemberNetBalances`, `createArchiveSpace`, `createGetMemberNetBalances`, `listForUser` `includeArchived` (Task 17) → Task 18a; `simplifyDebts`, `SettlementSuggestion`, `createGetSettlementSuggestions` (Task 19) → Task 20.
- Every file the plan edits exists on `development` at `c0e82f4` (or is created by an earlier task), and every anchor line was matched against it, using two-line anchors where a line also occurs with more indentation or elsewhere in the file (`      userId,` / `      role: "OWNER",`; `    key: text("key"),` / `    archivedAt: tz("archived_at"),`): `docs/specs/2026-10-11-hearth-design.md` (the Category entry and the D8 row); `categories.schema.ts`, `category-repository.ts`, `drizzle-category-repository.ts`, `delete-category.ts`, `retire-categories.test.ts`, `drizzle-category-repository.int.test.ts`, `tests/support/in-memory-categories.ts`, `tests/acceptance/categories.test.ts` (Task 0a); `drizzle-transaction-repository.ts`, `drizzle-transaction-repository.int.test.ts`, `tests/acceptance/ledger.test.ts` (Task 0b, beside the ledger files below); `permissions.ts`, `member.ts`, `space.ts`, `invitation.ts`, their three tests and `invitation.test.ts`; `space-member-repository.ts`, `space-settings-repository.ts`, `space-access.ts`, `space-repository.ts`, `invitation-ports.ts`, `invitation-repository.ts`, `accept-invitation.ts`, `change-member-role.ts`, `get-space.ts`, `list-my-spaces.ts`, `list-space-periods.ts`, `index.ts`, `members.test.ts`, `invitations.test.ts`, `space-access.test.ts`; `spaces.schema.ts`, `drizzle-space-repository.ts`, `drizzle-invitation-repository.ts`, `spaces-schema.int.test.ts`, `drizzle-space-members.int.test.ts`, `drizzle-space-repository.int.test.ts`, `drizzle-invitation-repository.int.test.ts`; `spaces.contract.ts`, `ledger.contract.ts`, `balances.contract.ts`; `balances.ts`, `balances.test.ts`, balances `index.ts`; ledger `transaction.ts`, `transaction.test.ts`, `checks.ts`, `edit-transaction.ts`, `delete-transaction.ts`, `edit-and-delete.test.ts`, ledger `index.ts`; `list-accounts.ts`, `list-categories.ts`, `list-transactions.ts`, `get-transaction.ts`, `list-audit.ts`; `problem.ts`, `problem.test.ts`, `define-route.ts`, `define-route.test.ts`, `contracts.ts`; `container.ts`; `src/app/api/v1/spaces/route.ts`; `tests/support/{fakes,in-memory-spaces,ledger,spaces}.ts`; `docs/backlog/E1-identity-and-spaces.md` (HU-E1-08 and HU-E1-13 technical notes). Lines that a task writes and a later task anchors on are written in their final Prettier form (at most 110 characters, or multi-line imports when the collapsed form exceeds it); lines that Prettier will rewrap are never used as anchors. Imported symbols exist with the signatures used (`authorizeSpaceAction`, `authorizeWriter`, `requirePermission`, `SPACE_ACTIONS`, `SpaceMemberRepository.listCurrent(spaceId, { lock })`, `addMember`, `createSpaceAccess`, `InMemorySpaceStore`, `InMemoryInvitations`, `householdSpace`, `HOUSEHOLD_MEMBERS`, `memberOf`, `invitationsWorld`, `fakeTokens`, `SettableClock`, `createPersonalSpace`, `createSharedSpace`, `guestMember`, `availableDisplayName`, `effectiveStatus`, `INVITATION_TTL_MS`, `toInvitationView`, `CreatedInvitation`, `createdInvitationDto`, `CreatedInvitationSchema`, `SpaceSummarySchema`, `MemberPath`, `BalanceSource`, `BalancesDeps`, `netOf`, `createGetSpaceBalances`, `InMemoryTransactions`, `anExpense`, `aSettlement`, `ledgerFixture`, `ACCOUNTS`, `CATEGORIES`, `LedgerCategory`, `RecordedExpenseSchema`, `recordedExpenseDto`, `transactionHeaders`, `IdempotencyHeader`, `invalidMoney`, `RecordExpenseInput`, `createRecordExpense`, `withIdempotency`, `cryptoInvitationTokens`, `guestMemberFixture`, `sharedSpaceFixture`, `userFixture`, `testDatabase`, `FixedClock`, `isUuid`, `currencyOf`, `DEFAULT_PERIOD_POLICY`, `call`, `problemOf`, `registerUser`, `startTestApp`, `RouteHandler`, `household`, `joinHousehold`, `addGuest`, `memberIdOf`, `balancesOf`, `categoryWithKey`, `newAccount`, `post`, `cop`, `actingIn`, `joinAs`, `inviteByLink`, `newSharedSpace`, `tokenOf`; and, for Tasks 0a and 0b, `seedTree`, `personalSpaceFixture`, `sharedLedgerFixture`, `DrizzleAuditLog`, `sequentialIds`, `ledgerUser`, `market`, `recorded`, `onTransaction`, `auditOf`, `onCategory`, `names`, `accountOf`, `spend`, `treeOf`, `groupsIn`).
- Money in the tests comes from `Money.allocate` on whole-peso amounts that divide exactly (Global Constraints); suggestion amounts are differences of nets, never rounded. Tasks 0a and 0b compute no split: their tests write parts directly, in whole pesos (Task 0a's raw SQL row is 100 minor units and only carries a category).
- Task numbers agree everywhere: the headings, the task labels, the size list, the task-to-issue map, the File Structure and this review name 0a, 0b, 1, 2, 3, 4 (4.1, 4.2), 4b, 5–14 (7a/7b, 10a/10b, 13a/13b), 14b, 15 (15a–15d), 16, 17, 18 (18a/18b), 19 and 20. That makes 24 tasks and 32 commits. The migrations are 0008 (Task 0a) and 0009 (Task 5) everywhere.
- Follow-up Facabore/Hearth#89 is named in Review Focus 5, the Execution Workflow (the concurrency bullet and PR note 3), assumption 4, the Review Focus pins and the follow-ups.
- No task adds a physical delete. The only `.delete(` calls left in the code are the two technical ones of amended D8 and the replacement of an expense's parts in `save`, which Task 0b keeps on purpose (assumption 14).
