# M2-B Shared Expenses, Shared Fund, Balances and Settlements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the money half of Hearth's shared-spaces API: members record shared expenses paid by one or more members (registered or guest) and split them equally, by percentage, by exact amounts or by share units; members contribute to the shared fund and pay expenses from it (with a non-blocking warning when the fund goes negative); every member sees the net balance of every member; and members record settlements that clear those balances.

**Architecture:** The M1 `ledger` module is extended, not duplicated: `RecordExpense` keeps its single use case and gains `payments[]` and a `split` resolved by a pure `splitShares` domain service (`ledger/domain/split.ts`) over `Money.allocate`; the `Transaction` aggregate gains a `SETTLEMENT` type and a `payerMemberId` on transfers (fund contributions) and settlements; migration 0007 adds the `transactions.payer_member_id` column and widens the `transactions_shape` check. A new `balances` read-model module computes `net(m) = paid − consumed + settled out − settled in` from per-member totals that the ledger aggregates in SQL (`DrizzleLedgerQueries.memberTotals`) and that an in-memory twin reproduces for unit tests; the two adapters are pinned against each other on the same fixtures. Every use case authorizes through the `spaces` permission matrix (`authorizeSpaceAction`), and the composition root binds the ledger's new ports (current members, account balances) to the spaces and accounts modules.

**Tech Stack:** Node.js 24.21.0, pnpm 12.11.2, Next.js 16.4.0 (App Router route handlers), React 19.3.0, TypeScript 6.0.3 strict, Zod 4.6.5, zod-openapi 6.0.2, drizzle-orm 0.45.4 + drizzle-kit 0.31.11, pg 8.23.1, better-auth 1.7.7, Vitest 5.0.3, PostgreSQL 18.6 (Docker CLI in tests). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-hearth-design.md` (approved 2026-10-11; sections 4, 5.2, 5.3, 7, 8 and decisions D2, D5, D6, D9, D15 bind this plan). Stories: `docs/backlog/E4-ledger.md` (HU-E4-07, HU-E4-08, HU-E4-09, HU-E4-10), `docs/backlog/E5-balances-and-settlements.md` (HU-E5-01, HU-E5-02). Format template: `docs/superpowers/plans/2026-10-13-m2a-shared-spaces.md`; ledger conventions: `docs/superpowers/plans/2026-10-12-m1-personal-ledger.md`. GitHub Project: https://github.com/users/Facabore/projects/4.

**Out of scope (later plans):** settlement suggestions (HU-E5-03, #45) and balance history (HU-E5-04, #46) move to a later plan (see Self-Review); member lifecycle — leaving a space, archiving it, guest claim links, guest removal and direct spaces (HU-E1-08, HU-E1-09, HU-E1-11, HU-E1-12, HU-E1-13) — is M2-C, together with the public `GetMemberNetBalance` query those stories consume; `BY_ALLOCATION` default splits (HU-E6-08, M3); editing the payers or the split of a recorded expense (HU-E4-06 edits keep M1's rule: a sole payment or share follows a new amount, otherwise the parts must still add up).

## Global Constraints

- Node.js `24.21.0`; pnpm `12.11.2`; Next.js `16.4.0`; React `19.3.0`; TypeScript `6.0.3` with `strict: true` and `noUncheckedIndexedAccess: true`; Zod `4.6.5`; zod-openapi `6.0.2`; drizzle-orm `0.45.4`; drizzle-kit `0.31.11`; pg `8.23.1`; better-auth `1.7.7`; Vitest `5.0.3`; PostgreSQL image `postgres:18.6-alpine`. No new dependencies; `pnpm check:pinned` must keep passing.
- Money is `bigint` minor units in code and `bigint` columns in PostgreSQL (D6); over HTTP it is `{ "amount": "<minor units as string>", "currency": "<ISO 4217>" }`. One currency per space (D6). COP has exponent 2 and a rounding unit of 100 minor units (`src/shared/kernel/currency.ts`, spec 5.3): 300,000 COP is `"30000000"` on the wire, and splits round to whole pesos.
- Splits use largest-remainder rounding in rounding units (`Money.allocate`); ties and leftover units go to members in membership join order; Σ shares = Σ payments = amount exactly (spec 5.3, E4 shared invariant).
- Every money reference points to a `SpaceMember`, never to a user (D15). Guests can pay, take part and settle; they have no accounts, so their movements carry `accountId = null`. A payment's `memberId` is null if and only if it comes from a `SHARED_FUND` account (spec 5.2). Fund accounts are recognised by `type === "SHARED_FUND"`, never by a missing owner.
- A personal account is **debited** (an expense payment, a fund contribution's source, a settlement's source) only when the requester's own user owns it, otherwise `422 AccountNotOwned` (D9): nobody spends from another member's account, so a registered member records their own payment. **Crediting** another member's account (a settlement's destination) stays allowed (HU-E5-02).
- HTTP errors are RFC 9457 `application/problem+json` with a stable `code` (the domain error name) and `requestId`; the API never returns translated text. Status mapping lives only in `src/shared/http/problem.ts` (explicit map, then `*NotFound` → 404, `Invalid*` → 422, else 409). A requester who is not a member of a space gets `404 SpaceNotFound`; referencing a non-member as payer or participant returns `422 NotASpaceMember` (spec 8).
- Authorization is always enforced in use cases through the `spaces` permission matrix (`authorizeSpaceAction`, membership first, then role), never only in handlers and never with hardcoded role lists.
- Every POST that creates a transaction honours `Idempotency-Key` (`withIdempotency`): expenses, fund contributions and settlements.
- Hexagonal boundaries (ADR 0001): domain imports only its own domain and `src/shared/kernel`; application never imports infrastructure, contracts, HTTP, frameworks or the ORM; other modules are reached only through `src/modules/<m>/application/index.ts`; `*.schema.ts` may import other modules' `*.schema.ts` for foreign keys; repositories never import another module's schema. The balances SQL aggregate therefore lives in the ledger's infrastructure and is bound to the `balances` port in the composition root.
- Repositories guard identifiers from URLs with `isUuid` before querying `uuid` columns (malformed ids return `null` or `[]`, never a `500`).
- Strict TDD: every behaviour starts with a failing test that is run and seen failing. `@critical` scenarios run as acceptance tests (route handlers + real PostgreSQL); the rest as unit or integration tests.
- Code, identifiers, comments, docs and generated artifacts in English. Conventional commits referencing the story issue (`Refs #<n>`); no AI attribution or `Co-Authored-By` lines.
- Gates for every task: `pnpm exec vitest run --project unit`, `pnpm exec vitest run --project integration`, `pnpm exec vitest run --project acceptance`, `pnpm format`, `pnpm exec eslint .`, `pnpm exec tsc --noEmit`, `pnpm exec prettier --check .`, `pnpm lint:boundaries`, `pnpm db:check`.

## Review Focus

1. **Amounts that do not divide into whole pesos** (1 peso among three people, 100.50 COP between two, 100,000 COP among three listed in any order, 33.33 % three ways): no share is ever zero or negative (`422 InvalidSplit`), the shares always sum to the amount exactly, the extra peso goes to the earliest-joined participant whatever order the request used, and a sub-peso remainder stays on the first share — pinned in Task 1 (domain), Task 5 (two-decimal percentages) and Task 11 (HTTP).
2. **Member ids that are not current members of this space** in payments, splits, contributions and settlements (another space's member, a malformed id, a participant or a payer listed twice, the same member on both sides of a settlement): `422 NotASpaceMember`, `422 InvalidSplit` or `422 InvalidSettlementParties`, never a `500` and never recorded — pinned in Task 1, Task 4, Task 7, Task 8, Task 11 and Task 16.
3. **Accounts that are not the party's, or not the requester's to debit** (Juan paying from Ana's account; Ana recording a payment, contribution or settlement that debits Juan's own account; a member "paying" from the fund in their own name; another household's fund; an archived fund; a personal account sent as the fund — `404 AccountNotFound` in a shared space, `422 InvalidFundAccount` only for a non-fund account of the same space; a fund used as a settlement account; a malformed account id): `422 AccountNotOwned`, `404 AccountNotFound`, `409 AccountArchived` or `422 InvalidFundAccount`; nothing is recorded and no other space's account is revealed — pinned in Task 4, Task 6, Task 7, Task 8, Task 11, Task 13, Task 15 and Task 16.
4. **Double-submitted money movements** (a double click on "settle up", a retried fund contribution after a timeout): the same `Idempotency-Key` replays the first response and the movement counts once in balances and account balances; the same key with another body answers `409 IdempotencyKeyConflict` — pinned in Task 15 and Task 16.
5. **Balances after corrections and fund movements** (a soft-deleted expense or settlement, a fund-paid rent, a fund contribution, a guest payer): deleted movements leave the balances, fund-paid expenses and contributions never create debt (D5), and Σ net over all members, guests included, is always 0 — pinned in Task 9 (domain and use case), Task 10 (SQL against the in-memory twin on the same fixtures), Task 14 and Task 16 (HTTP, deletion).

## Execution Workflow

- Work on the long-lived branch `development`; every task is implemented there with Strict TDD. Implementers stage; the controller commits.
- **RDD before every commit** (receipt-driven development is on; check with `gentle-ai review mode status`). Each "Commit" step means:
  1. Run every source-mutating normalizer first (`pnpm format`, regenerated migrations or snapshots), then stage exactly the files of the task.
  2. Run `gentle-ai review status --cwd . --contract gentle-ai.review-integration/v2 --agent claude-code --next-transition` and follow only the returned `next_transition` (`execute` its operation, satisfy `collect` inputs, or stop on `stop` and report its reason code with its documented continuation). Medium/high-risk candidates may return a consent envelope; relay it to the owner and wait.
  3. Commit only after the provider-returned `review.validate` allows the `pre-commit` gate for that exact staged candidate; the commit must not change the reviewed bytes.
  4. If the owner disables RDD (`gentle-ai review mode disable --scope clone --cwd .`), commit under ordinary policy and report `disabled/unmanaged`.
- Code blocks in this plan are complete but not guaranteed to match Prettier's line wrapping: run `pnpm format` before the gates of every task (the gates then run `prettier --check`). Anchors in this plan name lines that Prettier leaves alone (short statements, JSDoc and `//` comments, existing lines already formatted); when an anchor is a range, it is given by its first and last lines.
- Every code block the executor writes is introduced by a line naming its file path in backticks and ending with a colon. "Create" blocks are whole files; edits to existing files name a unique anchor line ("after the line …", "replace the line …", "insert before the line …").
- Each task is one commit sized for review (target under ~400 changed lines, OpenAPI snapshot growth of about 100 lines per new or reshaped operation included). The only task over the limit is **Task 11, ~650 lines** (the M1 acceptance helpers move into `tests/support/ledger.ts`). Split it into three consecutive commits, each green and each with its own RDD pass: **11-0** (~240) — `tests/support/ledger.ts` and the `ledger.test.ts` header, a pure test refactor (green: M1's acceptance tests pass unchanged) | **11a** (~300) — the contract, the route, the snapshot and the first `describe` block of `shared-expenses.test.ts` (red: the endpoint rejects `payments`) | **11b** (~110) — the explicit `422` codes in `problem.ts` with their `problem.test.ts` rows and the second `describe` block (red: `AccountRequired`, `PaymentsRequired` and `ParticipantsRequired` still map to `409`), extending the test file's imports with what that block uses. Every other task is under or near ~400 lines (largest: Task 16 ~420, accepted as borderline; Task 13 ~250–390 depending on how the snapshot renders `RecordedExpense`, checked in its Step 4; Task 4 ~330; Task 9 ~320).
- The generated Drizzle snapshot (`drizzle/meta/0007_snapshot.json`) is committed in its own schema task (Task 2, with the constraint test that is red before the migration); the OpenAPI snapshot changes in Task 3 (the `Transaction` component gains `SETTLEMENT` and `payerMemberId`) and in the HTTP tasks (11–16).
- **No locks and no concurrency tests are added.** Money movements are independent inserts; a double submission is the idempotency layer's job (Review Focus 4, pinned by sequential replays). If an implementer adds a concurrency test anyway, they must show it depends on the lock it targets by removing that lock temporarily and watching the test fail.
- When a task starts, move its story issues to **In Progress** on Project #4; when all tasks are done, open one pull request from `development` into `main` (they share history since M2-A's #87 was merged with a merge commit) that closes #36, #37, #38, #39, #43, #44 and states that #45 (HU-E5-03) and #46 (HU-E5-04) stay open for the next plan. Its description also lists, as PR notes, the technical notes of closed stories that this plan does not deliver (Self-Review, "Follow-ups"), and the controller leaves a comment linking each follow-up on #43 and #37.
- Task-to-issue map (issues are titled with their story ID): HU-E4-07 → #36 (Tasks 1, 4, 11), HU-E4-08 → #37 (Tasks 5, 12), HU-E4-09 → #38 (Tasks 2, 3, 7, 15), HU-E4-10 → #39 (Tasks 6, 13), HU-E5-01 → #43 (Tasks 9, 10, 14), HU-E5-02 → #44 (Tasks 2, 3, 8, 16).
- zod-openapi lesson from M1/M2-A: a component registered in `components.schemas` that is used in **both** a request and a response is emitted twice (`<Name>` and `<Name>Output`). `MoneyOutput` and `CategoryOutput` already exist from M1 and stay. The component this plan adds (`RecordedExpense`, Task 13) and the one it changes (`Transaction`, Task 3) are used only in responses, so no new `…Output` variant may appear; if one does, a request schema is reusing the component — fix the contract instead of accepting the snapshot.

## File Structure

```
.
├── drizzle/
│   └── 0007_shared_money.sql (+ meta/0007_snapshot.json)            # Task 2
├── openapi/openapi.snapshot.json                                      # Tasks 3, 11–16
├── src/
│   ├── shared/http/problem.ts                                         # + AccountRequired, PaymentsRequired, ParticipantsRequired → 422 (Task 11)
│   ├── composition/
│   │   ├── container.ts                                               # members port (Task 4), account types and balances (Task 6), wiring (Tasks 14–16)
│   │   └── openapi.ts                                                 # RecordedExpense (Task 13), balancesPaths (Task 14)
│   ├── modules/
│   │   ├── ledger/
│   │   │   ├── domain/split.ts                                        # splitShares: EQUAL (Task 1), PERCENT/EXACT/SHARES (Task 5)
│   │   │   ├── domain/transaction.ts                                  # SETTLEMENT, payerMemberId (Task 3), MixedFundPayment (Task 6)
│   │   │   ├── application/checks.ts                                  # authorizeWriter via the matrix, partyAccount (Task 4), fundAccount (Task 6)
│   │   │   ├── application/{ports,deps}.ts                            # members (Task 4), account type and balances (Task 6), member totals (Task 9)
│   │   │   ├── application/record-expense.ts                          # payments[] and split (Task 4), fund payments and warnings (Task 6)
│   │   │   ├── application/record-fund-contribution.ts                # Task 7
│   │   │   ├── application/record-settlement.ts                       # Task 8
│   │   │   ├── infrastructure/ledger.schema.ts                        # payer_member_id, shape checks (Task 2), SETTLEMENT (Task 3)
│   │   │   ├── infrastructure/transaction-rows.ts                     # Task 3
│   │   │   ├── infrastructure/drizzle-ledger-queries.ts               # memberTotals (Task 10)
│   │   │   └── contracts/ledger.contract.ts                           # Tasks 3, 11, 12, 13, 15, 16
│   │   ├── balances/
│   │   │   ├── domain/balances.ts                                     # netOf, netBalances (Task 9)
│   │   │   ├── application/{get-space-balances,index}.ts              # Task 9
│   │   │   └── contracts/balances.contract.ts                         # Task 14
│   │   └── accounts, spaces                                           # unchanged
│   └── app/api/v1/spaces/[spaceId]/
│       ├── expenses/route.ts                                          # Tasks 6, 11, 13
│       ├── balances/route.ts                                          # GET (Task 14)
│       ├── fund-contributions/route.ts                                # POST (Task 15)
│       └── settlements/route.ts                                       # POST (Task 16)
└── tests/
    ├── support/
    │   ├── fixtures.ts               # + fundAccountFixture, sharedLedgerFixture (Task 2)
    │   ├── in-memory-ledger.ts       # aTransfer payerMemberId (Task 3), members, householdLedger (Task 4), funds and balances (Task 6), memberTotals, aSettlement (Task 9)
    │   └── ledger.ts                 # HTTP money helpers moved from ledger.test.ts + household builders (Task 11, commit 11-0), balancesOf (Task 14)
    └── acceptance/
        ├── ledger.test.ts            # header only: helpers now imported (Task 11, commit 11-0)
        ├── shared-expenses.test.ts   # Tasks 11, 12
        ├── fund-expenses.test.ts     # Task 13
        ├── balances.test.ts          # Task 14
        ├── fund-contributions.test.ts # Task 15
        └── settlements.test.ts       # Task 16
```

Test layout follows M0–M2-A: unit tests next to the code as `*.test.ts` (no database), integration tests as `*.int.test.ts` (real PostgreSQL via `testDatabase()`), acceptance tests in `tests/acceptance/` calling the exported route handlers in-process. Shared test doubles live in `tests/support/` so production folders hold no test code.

Run a single file with `pnpm exec vitest run --project <unit|integration|acceptance> <path>`. Integration and acceptance projects start a disposable PostgreSQL container through the Docker CLI (`tests/support/postgres-global-setup.ts`) and apply every migration in `drizzle/`, so Docker must be running.

### How money movements are authorized

No new matrix action is needed: the M2-A matrix already lists settlements and guest payers under `money.record` and balances under `space.read` (`src/modules/spaces/domain/permissions.ts`). Task 4 rewires the ledger's `authorizeWriter` from `requireRole(WRITERS)` to `authorizeSpaceAction(…, "money.record")`, so every ledger write reads the matrix directly (same roles; M1 assertions unchanged).

| Use case | Matrix action | Roles |
|---|---|---|
| `RecordExpense` (member, guest or fund payers) | `money.record` | OWNER, ADMIN, MEMBER |
| `RecordFundContribution` | `money.record` | OWNER, ADMIN, MEMBER |
| `RecordSettlement` (also on a guest's behalf) | `money.record` | OWNER, ADMIN, MEMBER |
| `GetSpaceBalances` | `space.read` | OWNER, ADMIN, MEMBER, VIEWER |
| Create, rename, archive a `SHARED_FUND` account (M2-A, unchanged) | `fund.manage` | OWNER, ADMIN |
| Edit or delete someone else's transaction (M1, unchanged) | `money.editAny` (mirrored by `canModify`, pinned in M2-A) | OWNER, ADMIN |

Which accounts a requester may name is a separate rule, enforced by `partyAccount` (Task 4): a personal account is debited only when the requester's user owns it (`AccountNotOwned` otherwise, D9), while a settlement may credit the receiving member's own account.

---

### Task 1: Ledger — equal split in the domain

Implements the split rule of HU-E4-07 (issue #36) as a pure domain service: `splitShares` turns an amount and a list of participants into `Share[]` with `Money.allocate`, so remainders follow spec 5.3. Pins Review Focus 1 and 2 at the domain level.

Decisions:
- Participants must be current members of the space, passed as their ids in join order (`NotASpaceMember` otherwise). A participant listed twice is `InvalidSplit` (reason `duplicateParticipant`); an empty list is the existing M1 code `ParticipantsRequired`.
- `Money.allocate` gives ties to the earlier ratio, while spec 5.3 gives them to the earliest-joined member: `splitShares` sorts the participants by join order before allocating and returns the shares in join order, whatever order the request used.
- A computed share of zero (1 peso among three) is rejected with `InvalidSplit` (reason `shareNotPositive`) rather than silently dropping a participant; the `shares_amount_positive` check would reject it anyway.
- `SplitInput` has only the `EQUAL` variant here; Task 5 adds `PERCENT`, `EXACT` and `SHARES`.

**Files:**
- Create: `src/modules/ledger/domain/split.ts`
- Modify: `src/modules/ledger/application/index.ts`
- Test: `src/modules/ledger/domain/split.test.ts`

**Interfaces:**
- Consumes: `Money`, `domainError`, `err`, `map`, `ok`, `Result` (kernel); `Share` (`src/modules/ledger/domain/transaction.ts`); test helpers `codeOf`, `money`, `unwrap` (`tests/support/fakes.ts`).
- Produces:
  - `type SplitInput = { readonly method: "EQUAL"; readonly participants: readonly { readonly memberId: string }[] }` (widened in Task 5)
  - `splitShares(amount: Money, split: SplitInput, memberIds: readonly string[]): Result<Share[]>` — errors `ParticipantsRequired`, `NotASpaceMember`, `InvalidSplit`
  - `SplitInput` exported from `@/modules/ledger/application`.

- [ ] **Step 1: Write the failing test**

`src/modules/ledger/domain/split.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Money } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { splitShares, type SplitInput } from "./split";

// Current members of Household in join order.
const MEMBERS = ["member-ana", "member-juan", "member-luis"];
const pesos = (n: bigint) => money(n * 100n);
const equal = (...memberIds: string[]): SplitInput => ({
  method: "EQUAL",
  participants: memberIds.map((memberId) => ({ memberId })),
});
const amounts = (amount: Money, split: SplitInput) =>
  unwrap(splitShares(amount, split, MEMBERS)).map((share) => [share.memberId, share.amount] as const);

describe("equal split (HU-E4-07)", () => {
  it("splits 300,000 COP equally between Ana and Juan", () => {
    expect(unwrap(splitShares(pesos(300_000n), equal("member-ana", "member-juan"), MEMBERS))).toEqual([
      { memberId: "member-ana", amount: 15_000_000n, splitMethod: "EQUAL" },
      { memberId: "member-juan", amount: 15_000_000n, splitMethod: "EQUAL" },
    ]);
  });

  it("gives the remainder peso to the earliest-joined participant, whatever the request order (Review Focus 1)", () => {
    const shares = amounts(pesos(100_000n), equal("member-luis", "member-juan", "member-ana"));
    expect(shares).toEqual([
      ["member-ana", 3_333_400n],
      ["member-juan", 3_333_300n],
      ["member-luis", 3_333_300n],
    ]);
    expect(shares.reduce((sum, [, amount]) => sum + amount, 0n)).toBe(10_000_000n);
  });

  it("keeps a sub-peso remainder on the first share so the total stays exact", () => {
    expect(amounts(money(10_050n), equal("member-ana", "member-juan"))).toEqual([
      ["member-ana", 5_050n],
      ["member-juan", 5_000n],
    ]);
  });

  it("requires at least one participant", () => {
    expect(codeOf(splitShares(pesos(80_000n), equal(), MEMBERS))).toBe("ParticipantsRequired");
  });

  it("rejects participants who are not current members, malformed ids included (Review Focus 2)", () => {
    expect(codeOf(splitShares(pesos(80_000n), equal("member-ana", "member-marta"), MEMBERS))).toBe(
      "NotASpaceMember",
    );
    expect(codeOf(splitShares(pesos(80_000n), equal("not-a-uuid"), MEMBERS))).toBe("NotASpaceMember");
  });

  it("rejects a participant listed twice (Review Focus 2)", () => {
    expect(codeOf(splitShares(pesos(80_000n), equal("member-ana", "member-ana"), MEMBERS))).toBe(
      "InvalidSplit",
    );
  });

  it("rejects an amount too small to give every participant a positive share (Review Focus 1)", () => {
    const tooSmall = splitShares(pesos(1n), equal("member-ana", "member-juan", "member-luis"), MEMBERS);
    expect(tooSmall).toEqual({
      ok: false,
      error: { code: "InvalidSplit", details: { reason: "shareNotPositive" } },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/ledger/domain/split.test.ts`
Expected: FAIL — `Failed to resolve import "./split"`.

- [ ] **Step 3: Implement**

`src/modules/ledger/domain/split.ts`:

```ts
import { domainError, err, map, ok, type Money, type Result } from "@/shared/kernel";
import type { Share } from "./transaction";

/** HU-E4-07: how an expense is shared among chosen members. HU-E4-08 adds PERCENT, EXACT and SHARES. */
export type SplitInput = {
  readonly method: "EQUAL";
  readonly participants: readonly { readonly memberId: string }[];
};

const invalid = (reason: string): Result<never> => err(domainError("InvalidSplit", { reason }));

const allocated = (amount: Money, weights: readonly number[]): Result<bigint[]> =>
  map(amount.allocate(weights), (parts) => parts.map((part) => part.minor));

/** Amounts per participant; `order` lists the participants' request indexes in join order. */
const amountsOf = (amount: Money, split: SplitInput, order: readonly number[]): Result<bigint[]> => {
  switch (split.method) {
    case "EQUAL":
      return allocated(
        amount,
        order.map(() => 1),
      );
  }
};

/**
 * HU-E4-07, spec 5.3: the shares of `amount` among the split's participants, who must be current
 * members (`memberIds`, in join order). Shares come back in join order, so the largest-remainder
 * rounding of Money.allocate gives leftover rounding units to the earliest-joined participants
 * whatever order the request used, and the shares always sum to `amount` exactly.
 */
export const splitShares = (
  amount: Money,
  split: SplitInput,
  memberIds: readonly string[],
): Result<Share[]> => {
  const ids = split.participants.map((participant) => participant.memberId);
  if (ids.length === 0) return err(domainError("ParticipantsRequired"));
  if (new Set(ids).size !== ids.length) return invalid("duplicateParticipant");
  if (ids.some((id) => !memberIds.includes(id))) return err(domainError("NotASpaceMember"));
  const order = ids
    .map((_, index) => index)
    .sort((a, b) => memberIds.indexOf(ids[a]!) - memberIds.indexOf(ids[b]!));
  const amounts = amountsOf(amount, split, order);
  if (!amounts.ok) return amounts;
  // shares_amount_positive: an amount too small to give everyone a positive share is rejected.
  if (amounts.value.some((part) => part <= 0n)) return invalid("shareNotPositive");
  return ok(
    order.map((index, position) => ({
      memberId: ids[index]!,
      amount: amounts.value[position]!,
      splitMethod: split.method,
    })),
  );
};
```

In `src/modules/ledger/application/index.ts`, add after the line `} from "../domain/transaction";`:

```ts
export type { SplitInput } from "../domain/split";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: PASS (the new file and every existing ledger unit test).

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (`domain-must-be-pure` holds: `split.ts` imports only `./transaction` and the kernel).

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/domain/split.ts src/modules/ledger/domain/split.test.ts src/modules/ledger/application/index.ts
git commit -m "feat(ledger): add the equal split domain service (Refs #36)"
```

---

### Task 2: Ledger — settlement and contribution columns with migration 0007

Schema task (HU-E4-09, HU-E5-02), with the constraint test written first so it is red before the migration. Adds `transactions.payer_member_id` (the fund contributor of a `TRANSFER` into the shared fund, or the payer of a `SETTLEMENT`) and widens the `transactions_shape` check with a `SETTLEMENT` branch and a contribution form of `TRANSFER`; adds `transactions_settlement_parties` so nobody settles with themselves.

Decisions:
- One nullable column instead of a parallel table: settlements reuse `receiving_member_id` (the payee, like an income's receiving member) and the optional `source_account_id` / `destination_account_id`, so M1's `netMovements` already moves the parties' account balances and the fund balance without any change (pinned in Task 3).
- A `TRANSFER` keeps M1's shape (`source_account_id` set, `payer_member_id` null) for transfers between own accounts; a fund contribution sets `payer_member_id`, and its `source_account_id` may be null only because a guest contributes from outside the app (spec 5.2).
- `payer_member_id` references `space_members`, with its own index (`transactions_payer_member_idx`), like the account foreign keys of M1.
- The domain still knows only `EXPENSE`, `INCOME` and `TRANSFER` after this task: the TypeScript `type` enum of the Drizzle table gains `SETTLEMENT` in Task 3, together with the aggregate (a text enum is not part of the Drizzle snapshot, so it needs no migration). The SQL check already accepts `SETTLEMENT` rows here.
- Existing rows already satisfy the new checks (M1 transfers have a source and no payer).
- The integration fixtures `fundAccountFixture` and `sharedLedgerFixture` are introduced here, their first use; Tasks 3 and 10 reuse them.

**Files:**
- Modify: `src/modules/ledger/infrastructure/ledger.schema.ts`, `tests/support/fixtures.ts`
- Create (generated): `drizzle/0007_shared_money.sql`, `drizzle/meta/0007_snapshot.json`; Modify (generated): `drizzle/meta/_journal.json`
- Test: `src/modules/ledger/infrastructure/ledger-schema.int.test.ts`

**Interfaces:**
- Consumes: `transactions`, `payments`, `shares`, `transactionAudit` (M1 schema); `spaceMembers`, `spaces` (spaces schema); `accounts` (accounts schema); `categories` (categories schema); `personalSpaceFixture`, `accountFixture`, `categoryFixture`, `guestMemberFixture`, `sharedSpaceFixture`, `SpaceFixture` (`tests/support/fixtures.ts`); `DrizzleAccountRepository` (M1); `testDatabase` (`tests/support/database.ts`).
- Produces:
  - `transactions.payer_member_id uuid → space_members(id)` (`transactions.payerMemberId`), index `transactions_payer_member_idx`; checks `transactions_shape` (widened) and `transactions_settlement_parties`.
  - `tests/support/fixtures.ts`: `fundAccountFixture(db: Database, spaceId: string, name?: string, openingBalance?: bigint): Promise<string>`; `interface SharedLedgerFixture { personal: SpaceFixture; household: SpaceFixture; bank: string; fund: string; pedro: string; groceries: string }`; `sharedLedgerFixture(db: Database, pool: Pool): Promise<SharedLedgerFixture>`.

- [ ] **Step 1: Write the failing test**

In `tests/support/fixtures.ts`, append:

```ts

/** A SHARED_FUND account (no owner) in the shared space `spaceId`. */
export const fundAccountFixture = async (
  db: Database,
  spaceId: string,
  name = "Household Fund",
  openingBalance = 0n,
): Promise<string> => {
  const id = randomUUID();
  await new DrizzleAccountRepository(new DrizzleTransactionManager(db)).add({
    id: id as Id<"Account">,
    spaceId,
    name,
    type: "SHARED_FUND",
    ownerUserId: null,
    openingBalance,
    archivedAt: null,
    createdAt: new Date(),
  });
  return id;
};

export interface SharedLedgerFixture {
  /** Ana's personal space, where her account lives. */
  readonly personal: SpaceFixture;
  /** "Household", with Ana as its OWNER (`household.memberId`). */
  readonly household: SpaceFixture;
  /** Ana's BANK account "Bancolombia" in her personal space. */
  readonly bank: string;
  /** Household's SHARED_FUND account. */
  readonly fund: string;
  /** The guest "Pedro" of Household. */
  readonly pedro: string;
  /** A category of Household. */
  readonly groceries: string;
}

/** Ana with Bancolombia in her personal space, and "Household" with the guest Pedro, its fund and a category. */
export const sharedLedgerFixture = async (db: Database, pool: Pool): Promise<SharedLedgerFixture> => {
  const personal = await personalSpaceFixture(db, pool, "Ana");
  const space = await sharedSpaceFixture(db, personal.userId);
  const household: SpaceFixture = {
    userId: personal.userId,
    spaceId: space.id,
    memberId: space.members[0]!.id,
  };
  return {
    personal,
    household,
    bank: await accountFixture(db, personal, "Bancolombia"),
    fund: await fundAccountFixture(db, household.spaceId),
    pedro: await guestMemberFixture(pool, household, "Pedro"),
    groceries: await categoryFixture(db, household),
  };
};
```

`src/modules/ledger/infrastructure/ledger-schema.int.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabase } from "../../../../tests/support/database";
import { sharedLedgerFixture, type SharedLedgerFixture } from "../../../../tests/support/fixtures";

const { db, pool } = testDatabase();
let w: SharedLedgerFixture;

beforeAll(async () => {
  w = await sharedLedgerFixture(db, pool);
});
afterAll(() => pool.end());

interface Row {
  readonly type: string;
  readonly categoryId?: string;
  readonly sourceAccountId?: string;
  readonly destinationAccountId?: string;
  readonly receivingMemberId?: string;
  readonly payerMemberId?: string;
}

const insert = (row: Row) =>
  pool.query(
    `INSERT INTO transactions (id, space_id, type, description, date, category_id, amount, currency,
       source_account_id, destination_account_id, receiving_member_id, payer_member_id, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, '', '2026-10-05', $4, 100, 'COP', $5, $6, $7, $8, $9, now(), now())`,
    [
      randomUUID(),
      w.household.spaceId,
      row.type,
      row.categoryId ?? null,
      row.sourceAccountId ?? null,
      row.destinationAccountId ?? null,
      row.receivingMemberId ?? null,
      row.payerMemberId ?? null,
      w.household.userId,
    ],
  );

describe("transactions shape for settlements (HU-E5-02)", () => {
  it("accepts a settlement between two members, with or without accounts", async () => {
    const ana = w.household.memberId;
    await expect(insert({ type: "SETTLEMENT", payerMemberId: w.pedro, receivingMemberId: ana })).resolves.toBeDefined();
    await expect(
      insert({ type: "SETTLEMENT", payerMemberId: ana, receivingMemberId: w.pedro, sourceAccountId: w.bank }),
    ).resolves.toBeDefined();
  });

  it("rejects a settlement without both parties or with a category", async () => {
    const ana = w.household.memberId;
    await expect(insert({ type: "SETTLEMENT", receivingMemberId: ana })).rejects.toThrow(/transactions_shape/);
    await expect(insert({ type: "SETTLEMENT", payerMemberId: w.pedro })).rejects.toThrow(/transactions_shape/);
    await expect(
      insert({ type: "SETTLEMENT", payerMemberId: w.pedro, receivingMemberId: ana, categoryId: w.groceries }),
    ).rejects.toThrow(/transactions_shape/);
  });

  it("rejects a member settling with themselves", async () => {
    await expect(insert({ type: "SETTLEMENT", payerMemberId: w.pedro, receivingMemberId: w.pedro })).rejects.toThrow(
      /transactions_settlement_parties/,
    );
  });
});

describe("transactions shape for fund contributions (HU-E4-09)", () => {
  it("accepts contributions from an account and, for a guest, from outside the app", async () => {
    await expect(
      insert({
        type: "TRANSFER",
        payerMemberId: w.household.memberId,
        sourceAccountId: w.bank,
        destinationAccountId: w.fund,
      }),
    ).resolves.toBeDefined();
    await expect(
      insert({ type: "TRANSFER", payerMemberId: w.pedro, destinationAccountId: w.fund }),
    ).resolves.toBeDefined();
  });

  it("still requires a source for transfers between own accounts and no payer on expenses or incomes", async () => {
    const ana = w.household.memberId;
    await expect(insert({ type: "TRANSFER", destinationAccountId: w.fund })).rejects.toThrow(/transactions_shape/);
    await expect(insert({ type: "EXPENSE", categoryId: w.groceries, payerMemberId: ana })).rejects.toThrow(
      /transactions_shape/,
    );
    await expect(
      insert({
        type: "INCOME",
        categoryId: w.groceries,
        destinationAccountId: w.bank,
        receivingMemberId: ana,
        payerMemberId: ana,
      }),
    ).rejects.toThrow(/transactions_shape/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project integration src/modules/ledger/infrastructure/ledger-schema.int.test.ts`
Expected: FAIL — every insert errors with `column "payer_member_id" of relation "transactions" does not exist`, so the `resolves` cases fail and the error matches none of the constraint names.

- [ ] **Step 3: Write the schema**

`src/modules/ledger/infrastructure/ledger.schema.ts` (replace the whole file):

```ts
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "@/modules/accounts/infrastructure/accounts.schema";
import { categories } from "@/modules/categories/infrastructure/categories.schema";
import { spaceMembers, spaces } from "@/modules/spaces/infrastructure/spaces.schema";
import type { ChangeSet } from "../domain/transaction";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => bigint(name, { mode: "bigint" });

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["EXPENSE", "INCOME", "TRANSFER"] }).notNull(),
    description: text("description").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    categoryId: uuid("category_id").references(() => categories.id),
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    sourceAccountId: uuid("source_account_id").references(() => accounts.id),
    destinationAccountId: uuid("destination_account_id").references(() => accounts.id),
    receivingMemberId: uuid("receiving_member_id").references(() => spaceMembers.id),
    // HU-E4-09: the contributor of a TRANSFER into the shared fund; HU-E5-02: the payer of a SETTLEMENT.
    payerMemberId: uuid("payer_member_id").references(() => spaceMembers.id),
    createdBy: text("created_by").notNull(),
    createdAt: tz("created_at").notNull(),
    updatedAt: tz("updated_at").notNull(),
    deletedAt: tz("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    // The monthly view: one space, a date range, newest first (keyset on date, id).
    index("transactions_space_date_idx").on(t.spaceId, t.date, t.id),
    index("transactions_category_idx").on(t.categoryId),
    index("transactions_source_account_idx").on(t.sourceAccountId),
    index("transactions_destination_account_idx").on(t.destinationAccountId),
    index("transactions_payer_member_idx").on(t.payerMemberId),
    check("transactions_amount_positive", sql`${t.amount} > 0`),
    // A TRANSFER without a payer is between own accounts; with a payer it is a fund contribution, whose
    // source is null only for a guest (spec 5.2). A SETTLEMENT has both parties and optional accounts.
    check(
      "transactions_shape",
      sql`(${t.type} = 'EXPENSE' AND ${t.categoryId} IS NOT NULL AND ${t.sourceAccountId} IS NULL AND ${t.destinationAccountId} IS NULL AND ${t.receivingMemberId} IS NULL AND ${t.payerMemberId} IS NULL)
        OR (${t.type} = 'INCOME' AND ${t.categoryId} IS NOT NULL AND ${t.sourceAccountId} IS NULL AND ${t.destinationAccountId} IS NOT NULL AND ${t.receivingMemberId} IS NOT NULL AND ${t.payerMemberId} IS NULL)
        OR (${t.type} = 'TRANSFER' AND ${t.categoryId} IS NULL AND ${t.destinationAccountId} IS NOT NULL AND ${t.receivingMemberId} IS NULL AND (${t.sourceAccountId} IS NOT NULL OR ${t.payerMemberId} IS NOT NULL))
        OR (${t.type} = 'SETTLEMENT' AND ${t.categoryId} IS NULL AND ${t.payerMemberId} IS NOT NULL AND ${t.receivingMemberId} IS NOT NULL)`,
    ),
    // HU-E5-02: nobody settles with themselves.
    check(
      "transactions_settlement_parties",
      sql`${t.type} <> 'SETTLEMENT' OR ${t.payerMemberId} <> ${t.receivingMemberId}`,
    ),
  ],
);

export const payments = pgTable(
  "payments",
  {
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    memberId: uuid("member_id").references(() => spaceMembers.id),
    accountId: uuid("account_id").references(() => accounts.id),
    amount: money("amount").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.transactionId, t.position] }),
    index("payments_account_idx").on(t.accountId),
    index("payments_member_idx").on(t.memberId),
    check("payments_amount_positive", sql`${t.amount} > 0`),
    // Spec 5.2: memberId is null only for fund payments, accountId only for guests, never both.
    check("payments_has_payer", sql`${t.memberId} IS NOT NULL OR ${t.accountId} IS NOT NULL`),
  ],
);

export const shares = pgTable(
  "shares",
  {
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => spaceMembers.id),
    amount: money("amount").notNull(),
    splitMethod: text("split_method", {
      enum: ["EQUAL", "PERCENT", "EXACT", "SHARES", "BY_ALLOCATION"],
    }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.transactionId, t.position] }),
    index("shares_member_idx").on(t.memberId),
    check("shares_amount_positive", sql`${t.amount} > 0`),
  ],
);

export const transactionAudit = pgTable(
  "transaction_audit",
  {
    id: uuid("id").primaryKey(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    action: text("action", { enum: ["UPDATED", "DELETED"] }).notNull(),
    actorUserId: text("actor_user_id").notNull(),
    at: tz("at").notNull(),
    changes: jsonb("changes").$type<ChangeSet>().notNull(),
  },
  (t) => [index("transaction_audit_transaction_idx").on(t.transactionId, t.at)],
);
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate --name shared_money`
Expected: `drizzle/0007_shared_money.sql` that adds `transactions.payer_member_id uuid` with the foreign key `transactions_payer_member_id_space_members_id_fk` (no action), creates the index `transactions_payer_member_idx`, drops and re-adds the `transactions_shape` check with the new text, and adds the `transactions_settlement_parties` check; `drizzle/meta/0007_snapshot.json`; a `0007_shared_money` journal entry. drizzle-kit asks no rename questions (nothing is removed). If it does prompt, answer "create" for every new entity.

- [ ] **Step 5: Verify migrations, drift, the new test and existing repositories**

Run: `pnpm db:check && pnpm exec vitest run --project integration`
Expected: "No schema drift" and PASS for the whole integration project, including `ledger-schema.int.test.ts` (the migrations test applies `0007` twice to an empty database; M1's repository and query tests still pass under the widened check).

- [ ] **Step 6: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries`
Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/modules/ledger/infrastructure/ledger.schema.ts src/modules/ledger/infrastructure/ledger-schema.int.test.ts tests/support/fixtures.ts drizzle/0007_shared_money.sql drizzle/meta/0007_snapshot.json drizzle/meta/_journal.json
git commit -m "feat(ledger): add settlement and fund contribution columns with migration (Refs #38, Refs #44)"
```

---

### Task 3: Ledger — settlements and fund contributions in the Transaction model

Implements the aggregate side of HU-E4-09 (issue #38) and HU-E5-02 (issue #44): a fund contribution is a `TRANSFER` with `payerMemberId` (its source may be null for a guest) and a settlement is a new `SETTLEMENT` type from `payerMemberId` to `receivingMemberId` with optional accounts. Persists both through the existing repository and pins that M1's `netMovements` already moves the parties' and the fund's balances.

Decisions:
- `recordFundContribution` and `recordSettlement` reuse `baseOf` (positive amount, description) like every M1 constructor. A contribution whose source equals the fund is `SameAccountTransfer`; a settlement with the same member on both sides is `InvalidSettlementParties` (422 by the `Invalid*` convention).
- Editing a settlement follows M1's edit rules for its description, date and amount; a settlement never gets a category (`SettlementHasNoCategory`, 409 like `TransferHasNoCategory`).
- The wire `Transaction` gains `type: "SETTLEMENT"` and `payerMemberId` (null for expenses, incomes and transfers between own accounts); a settlement's payee travels in the existing `receivingMemberId`, and its accounts in `sourceAccountId` / `destinationAccountId`. The OpenAPI `Transaction` component changes accordingly; no operation changes.
- `Transfer.sourceAccountId` becomes `string | null`; M1 transfers still always set it (`recordTransfer` is unchanged apart from `payerMemberId: null`).

**Files:**
- Modify: `src/modules/ledger/domain/transaction.ts`, `src/modules/ledger/application/index.ts`, `src/modules/ledger/infrastructure/ledger.schema.ts`, `src/modules/ledger/infrastructure/transaction-rows.ts`, `src/modules/ledger/contracts/ledger.contract.ts`, `tests/support/in-memory-ledger.ts`, `openapi/openapi.snapshot.json`
- Test: `src/modules/ledger/domain/transaction.test.ts`, `src/modules/ledger/infrastructure/drizzle-transaction-repository.int.test.ts`, `src/modules/ledger/infrastructure/drizzle-ledger-queries.int.test.ts` (all modified)

**Interfaces:**
- Consumes: `transactions.payerMemberId` and the widened checks (Task 2); `sharedLedgerFixture` (Task 2); M1 `baseOf`, `NewTransaction`, `reviseTransaction`, `loadTransactions`, `DrizzleTransactionRepository`, `DrizzleLedgerQueries.netMovements`.
- Produces:
  - `type TransactionType = "EXPENSE" | "INCOME" | "TRANSFER" | "SETTLEMENT"`
  - `interface Transfer { …; sourceAccountId: string | null; destinationAccountId: string; payerMemberId: string | null }`
  - `interface Settlement extends TransactionBase { type: "SETTLEMENT"; categoryId: null; payerMemberId: string; receivingMemberId: string; sourceAccountId: string | null; destinationAccountId: string | null }`
  - `type Transaction = Expense | Income | Transfer | Settlement`
  - `recordFundContribution(input: NewTransaction & { payerMemberId: string; sourceAccountId: string | null; destinationAccountId: string }): Result<Transfer>`
  - `recordSettlement(input: NewTransaction & { payerMemberId: string; receivingMemberId: string; sourceAccountId: string | null; destinationAccountId: string | null }): Result<Settlement>`
  - `Settlement` exported from `@/modules/ledger/application`; `TransactionSchema` with `SETTLEMENT` and `payerMemberId: string | null`.

- [ ] **Step 1: Write the failing tests**

In `src/modules/ledger/domain/transaction.test.ts`, replace the line `  recordIncome,` (in the import list from `./transaction`) with:

```ts
  recordFundContribution,
  recordIncome,
  recordSettlement,
```

and append to the end of the file:

```ts

describe("fund contributions and settlements (HU-E4-09, HU-E5-02)", () => {
  const contribution = (overrides: { payerMemberId?: string; sourceAccountId?: string | null } = {}) =>
    recordFundContribution({
      ...common,
      amount: 48_000_000n,
      payerMemberId: "member-ana",
      sourceAccountId: "acc-bancolombia",
      destinationAccountId: "acc-household-fund",
      ...overrides,
    });
  const settlement = (overrides: { receivingMemberId?: string; amount?: bigint } = {}) =>
    recordSettlement({
      ...common,
      amount: 120_000_000n,
      payerMemberId: "member-juan",
      receivingMemberId: "member-ana",
      sourceAccountId: null,
      destinationAccountId: null,
      ...overrides,
    });

  it("records a contribution as a TRANSFER into the fund by the contributing member", () => {
    expect(unwrap(contribution())).toMatchObject({
      type: "TRANSFER",
      categoryId: null,
      amount: 48_000_000n,
      sourceAccountId: "acc-bancolombia",
      destinationAccountId: "acc-household-fund",
      payerMemberId: "member-ana",
    });
  });

  it("lets a guest contribute from outside the app, without a source account", () => {
    expect(unwrap(contribution({ payerMemberId: "member-pedro", sourceAccountId: null }))).toMatchObject({
      sourceAccountId: null,
      payerMemberId: "member-pedro",
    });
  });

  it("never contributes the fund to itself", () => {
    expect(codeOf(contribution({ sourceAccountId: "acc-household-fund" }))).toBe("SameAccountTransfer");
  });

  it("records transfers between own accounts without a payer", () => {
    const own = unwrap(recordTransfer({ ...common, amount: 1n, sourceAccountId: "a", destinationAccountId: "b" }));
    expect(own.payerMemberId).toBeNull();
  });

  it("records a settlement from the payer to the receiving member without a category", () => {
    expect(unwrap(settlement())).toEqual({
      id: "tx-1",
      spaceId: "space-ana",
      type: "SETTLEMENT",
      description: "Market",
      date: "2026-10-05",
      amount: 120_000_000n,
      currency: "COP",
      categoryId: null,
      payerMemberId: "member-juan",
      receivingMemberId: "member-ana",
      sourceAccountId: null,
      destinationAccountId: null,
      createdBy: "u-ana",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1,
    });
  });

  it("rejects a member settling with themselves and non-positive amounts", () => {
    expect(codeOf(settlement({ receivingMemberId: "member-juan" }))).toBe("InvalidSettlementParties");
    expect(codeOf(settlement({ amount: 0n }))).toBe("InvalidAmount");
  });

  it("edits a settlement's amount but never gives it a category", () => {
    const recorded = unwrap(settlement());
    expect(unwrap(reviseTransaction(recorded, { amount: 50_000_000n }, later))).toMatchObject({
      type: "SETTLEMENT",
      amount: 50_000_000n,
    });
    expect(codeOf(reviseTransaction(recorded, { categoryId: "cat-groceries" }, later))).toBe(
      "SettlementHasNoCategory",
    );
  });
});
```

In `src/modules/ledger/infrastructure/drizzle-transaction-repository.int.test.ts`:

1. Replace the block

```ts
import {
  accountFixture,
  categoryFixture,
  personalSpaceFixture,
  type SpaceFixture,
} from "../../../../tests/support/fixtures";
```

with:

```ts
import {
  accountFixture,
  categoryFixture,
  personalSpaceFixture,
  sharedLedgerFixture,
  type SpaceFixture,
} from "../../../../tests/support/fixtures";
```

2. Replace the line `  recordIncome,` (in the import list from `../domain/transaction`) with:

```ts
  recordFundContribution,
  recordIncome,
  recordSettlement,
```

3. Append to the end of the file:

```ts

describe("fund contributions and settlements (HU-E4-09, HU-E5-02)", () => {
  it("round-trips contributions from an account and from outside the app, and settlements", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const inHousehold = (amount: bigint) => ({ ...common(amount), spaceId: w.household.spaceId });
    const fromBank = unwrap(
      recordFundContribution({
        ...inHousehold(48_000_000n),
        payerMemberId: w.household.memberId,
        sourceAccountId: w.bank,
        destinationAccountId: w.fund,
      }),
    );
    const fromPedro = unwrap(
      recordFundContribution({
        ...inHousehold(10_000_000n),
        payerMemberId: w.pedro,
        sourceAccountId: null,
        destinationAccountId: w.fund,
      }),
    );
    const settleUp = unwrap(
      recordSettlement({
        ...inHousehold(5_000_000n),
        payerMemberId: w.pedro,
        receivingMemberId: w.household.memberId,
        sourceAccountId: null,
        destinationAccountId: w.bank,
      }),
    );
    for (const tx of [fromBank, fromPedro, settleUp]) {
      await repo.add(tx);
      expect(await repo.findById(w.household.spaceId, tx.id)).toEqual(tx);
    }
  });
});
```

In `src/modules/ledger/infrastructure/drizzle-ledger-queries.int.test.ts`:

1. Replace the block

```ts
import {
  accountFixture,
  categoryFixture,
  guestMemberFixture,
  personalSpaceFixture,
} from "../../../../tests/support/fixtures";
```

with:

```ts
import {
  accountFixture,
  categoryFixture,
  guestMemberFixture,
  personalSpaceFixture,
  sharedLedgerFixture,
} from "../../../../tests/support/fixtures";
```

2. Replace the line `  recordIncome,` (in the import list from `../domain/transaction`) with:

```ts
  recordFundContribution,
  recordIncome,
  recordSettlement,
```

3. Append to the end of the file:

```ts

describe("net movements of contributions and settlements (HU-E4-09, HU-E5-02)", () => {
  it("takes money out of the source and into the fund or the receiving account", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const inHousehold = (amount: bigint) => ({
      id: randomUUID() as TransactionId,
      spaceId: w.household.spaceId,
      date: "2026-10-02" as LocalDate,
      amount,
      currency: "COP",
      createdBy: w.household.userId,
      now: new Date(),
    });
    await store(
      unwrap(
        recordFundContribution({
          ...inHousehold(48_000_000n),
          payerMemberId: w.household.memberId,
          sourceAccountId: w.bank,
          destinationAccountId: w.fund,
        }),
      ),
      unwrap(
        recordFundContribution({
          ...inHousehold(10_000_000n),
          payerMemberId: w.pedro,
          sourceAccountId: null,
          destinationAccountId: w.fund,
        }),
      ),
      unwrap(
        recordSettlement({
          ...inHousehold(5_000_000n),
          payerMemberId: w.pedro,
          receivingMemberId: w.household.memberId,
          sourceAccountId: null,
          destinationAccountId: w.bank,
        }),
      ),
    );
    const net = await queries.netMovements([w.bank, w.fund], null);
    expect(net.get(w.bank)).toBe(-43_000_000n);
    expect(net.get(w.fund)).toBe(58_000_000n);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/domain/transaction.test.ts && pnpm exec vitest run --project integration src/modules/ledger/infrastructure`
Expected: FAIL — `recordFundContribution is not a function` and `recordSettlement is not a function` in all three files (the existing tests in them still pass).

- [ ] **Step 3: Implement**

`src/modules/ledger/domain/transaction.ts` (replace the whole file):

```ts
import { domainError, err, ok, type Id, type LocalDate, type Result } from "@/shared/kernel";

export type TransactionId = Id<"Transaction">;
export type TransactionType = "EXPENSE" | "INCOME" | "TRANSFER" | "SETTLEMENT";
export type SplitMethod = "EQUAL" | "PERCENT" | "EXACT" | "SHARES" | "BY_ALLOCATION";
type MemberRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

/** Spec 5.2: memberId is null only for SHARED_FUND payments; accountId only for guest payers (M2). */
export interface Payment {
  readonly memberId: string | null;
  readonly accountId: string | null;
  readonly amount: bigint;
}

export interface Share {
  readonly memberId: string;
  readonly amount: bigint;
  readonly splitMethod: SplitMethod;
}

interface TransactionBase {
  readonly id: TransactionId;
  readonly spaceId: string;
  readonly description: string;
  /** Calendar date in the space timezone; its period is derived on read (HU-E4-04). */
  readonly date: LocalDate;
  readonly amount: bigint;
  readonly currency: string;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
  /** Optimistic-concurrency version, exposed as the ETag. */
  readonly version: number;
}

export interface Expense extends TransactionBase {
  readonly type: "EXPENSE";
  readonly categoryId: string;
  readonly payments: readonly Payment[];
  readonly shares: readonly Share[];
}

export interface Income extends TransactionBase {
  readonly type: "INCOME";
  readonly categoryId: string;
  readonly destinationAccountId: string;
  readonly receivingMemberId: string;
}

/**
 * HU-E4-03: money between the requester's own accounts (`payerMemberId` null). HU-E4-09: a fund
 * contribution into a SHARED_FUND account by `payerMemberId`, from their own account or, for a
 * guest, from outside the app (`sourceAccountId` null, spec 5.2).
 */
export interface Transfer extends TransactionBase {
  readonly type: "TRANSFER";
  readonly categoryId: null;
  readonly sourceAccountId: string | null;
  readonly destinationAccountId: string;
  readonly payerMemberId: string | null;
}

/**
 * HU-E5-02: `payerMemberId` pays `receivingMemberId` to clear a balance. Both accounts are
 * optional and, when set, belong to the respective party; guests never have one.
 */
export interface Settlement extends TransactionBase {
  readonly type: "SETTLEMENT";
  readonly categoryId: null;
  readonly payerMemberId: string;
  readonly receivingMemberId: string;
  readonly sourceAccountId: string | null;
  readonly destinationAccountId: string | null;
}

export type Transaction = Expense | Income | Transfer | Settlement;

export interface TransactionChanges {
  readonly description?: string;
  readonly date?: LocalDate;
  readonly categoryId?: string;
  readonly amount?: bigint;
}

/** Audited field changes; values are strings so bigints survive JSON. */
export type ChangeSet = Readonly<
  Record<string, { readonly from: string | null; readonly to: string | null }>
>;

const MAX_DESCRIPTION = 200;

export const positiveAmount = (amount: bigint): Result<bigint> =>
  amount > 0n ? ok(amount) : err(domainError("InvalidAmount", { amount: amount.toString() }));

const descriptionOf = (raw: string | undefined): Result<string> => {
  const text = (raw ?? "").trim();
  return text.length <= MAX_DESCRIPTION
    ? ok(text)
    : err(domainError("InvalidDescription", { length: text.length }));
};

const sum = (amounts: readonly bigint[]): bigint => amounts.reduce((a, b) => a + b, 0n);

/** Spec 5.2 shared invariant: Σ payments = Σ shares = amount, every part positive. */
const checkParts = (amount: bigint, payments: readonly Payment[], shares: readonly Share[]): Result<void> => {
  if (shares.length === 0) return err(domainError("ParticipantsRequired"));
  if (payments.length === 0) return err(domainError("PaymentsRequired"));
  if ([...payments, ...shares].some((part) => part.amount <= 0n)) return err(domainError("InvalidAmount"));
  if (sum(payments.map((p) => p.amount)) !== amount || sum(shares.map((s) => s.amount)) !== amount) {
    return err(domainError("SharesDoNotMatchAmount"));
  }
  return ok(undefined);
};

interface NewTransaction {
  readonly id: TransactionId;
  readonly spaceId: string;
  readonly description?: string;
  readonly date: LocalDate;
  readonly amount: bigint;
  readonly currency: string;
  readonly createdBy: string;
  readonly now: Date;
}

const baseOf = (input: NewTransaction): Result<TransactionBase> => {
  const amount = positiveAmount(input.amount);
  if (!amount.ok) return amount;
  const description = descriptionOf(input.description);
  if (!description.ok) return description;
  return ok({
    id: input.id,
    spaceId: input.spaceId,
    description: description.value,
    date: input.date,
    amount: amount.value,
    currency: input.currency,
    createdBy: input.createdBy,
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
    version: 1,
  });
};

export const recordExpense = (
  input: NewTransaction & {
    readonly categoryId: string;
    readonly payments: readonly Payment[];
    readonly shares: readonly Share[];
  },
): Result<Expense> => {
  const base = baseOf(input);
  if (!base.ok) return base;
  const parts = checkParts(base.value.amount, input.payments, input.shares);
  if (!parts.ok) return parts;
  return ok({
    ...base.value,
    type: "EXPENSE" as const,
    categoryId: input.categoryId,
    payments: input.payments,
    shares: input.shares,
  });
};

export const recordIncome = (
  input: NewTransaction & {
    readonly categoryId: string;
    readonly destinationAccountId: string;
    readonly receivingMemberId: string;
  },
): Result<Income> => {
  const base = baseOf(input);
  if (!base.ok) return base;
  return ok({
    ...base.value,
    type: "INCOME" as const,
    categoryId: input.categoryId,
    destinationAccountId: input.destinationAccountId,
    receivingMemberId: input.receivingMemberId,
  });
};

export const recordTransfer = (
  input: NewTransaction & { readonly sourceAccountId: string; readonly destinationAccountId: string },
): Result<Transfer> => {
  const base = baseOf(input);
  if (!base.ok) return base;
  if (input.sourceAccountId === input.destinationAccountId) return err(domainError("SameAccountTransfer"));
  return ok({
    ...base.value,
    type: "TRANSFER" as const,
    categoryId: null,
    sourceAccountId: input.sourceAccountId,
    destinationAccountId: input.destinationAccountId,
    payerMemberId: null,
  });
};

/** HU-E4-09: a TRANSFER into the shared fund by a member; it belongs to the fund's space (D9). */
export const recordFundContribution = (
  input: NewTransaction & {
    readonly payerMemberId: string;
    readonly sourceAccountId: string | null;
    readonly destinationAccountId: string;
  },
): Result<Transfer> => {
  const base = baseOf(input);
  if (!base.ok) return base;
  if (input.sourceAccountId === input.destinationAccountId) return err(domainError("SameAccountTransfer"));
  return ok({
    ...base.value,
    type: "TRANSFER" as const,
    categoryId: null,
    sourceAccountId: input.sourceAccountId,
    destinationAccountId: input.destinationAccountId,
    payerMemberId: input.payerMemberId,
  });
};

/** HU-E5-02: a settlement between two different members of the space. */
export const recordSettlement = (
  input: NewTransaction & {
    readonly payerMemberId: string;
    readonly receivingMemberId: string;
    readonly sourceAccountId: string | null;
    readonly destinationAccountId: string | null;
  },
): Result<Settlement> => {
  const base = baseOf(input);
  if (!base.ok) return base;
  if (input.payerMemberId === input.receivingMemberId) return err(domainError("InvalidSettlementParties"));
  return ok({
    ...base.value,
    type: "SETTLEMENT" as const,
    categoryId: null,
    payerMemberId: input.payerMemberId,
    receivingMemberId: input.receivingMemberId,
    sourceAccountId: input.sourceAccountId,
    destinationAccountId: input.destinationAccountId,
  });
};

/** HU-E4-06: a sole payment or share follows a new amount; otherwise the parts must still add up. */
export const reviseTransaction = (
  tx: Transaction,
  changes: TransactionChanges,
  now: Date,
): Result<Transaction> => {
  const description =
    changes.description === undefined ? ok(tx.description) : descriptionOf(changes.description);
  if (!description.ok) return description;
  const amount = changes.amount === undefined ? ok(tx.amount) : positiveAmount(changes.amount);
  if (!amount.ok) return amount;
  const common = {
    description: description.value,
    date: changes.date ?? tx.date,
    amount: amount.value,
    updatedAt: now,
  };
  switch (tx.type) {
    case "EXPENSE": {
      const payments =
        tx.payments.length === 1 ? [{ ...tx.payments[0]!, amount: amount.value }] : tx.payments;
      const shares = tx.shares.length === 1 ? [{ ...tx.shares[0]!, amount: amount.value }] : tx.shares;
      const parts = checkParts(amount.value, payments, shares);
      if (!parts.ok) return parts;
      return ok({ ...tx, ...common, categoryId: changes.categoryId ?? tx.categoryId, payments, shares });
    }
    case "INCOME":
      return ok({ ...tx, ...common, categoryId: changes.categoryId ?? tx.categoryId });
    case "TRANSFER":
      return changes.categoryId === undefined
        ? ok({ ...tx, ...common })
        : err(domainError("TransferHasNoCategory"));
    case "SETTLEMENT":
      return changes.categoryId === undefined
        ? ok({ ...tx, ...common })
        : err(domainError("SettlementHasNoCategory"));
  }
};

/** D8: transactions are never hard-deleted. */
export const softDelete = (tx: Transaction, now: Date): Transaction => ({
  ...tx,
  deletedAt: now,
  updatedAt: now,
});

const AUDITED = ["description", "date", "categoryId", "amount"] as const;

export const changesBetween = (before: Transaction, after: Transaction): ChangeSet => {
  const changes: Record<string, { from: string | null; to: string | null }> = {};
  for (const field of AUDITED) {
    const from = before[field] === null ? null : String(before[field]);
    const to = after[field] === null ? null : String(after[field]);
    if (from !== to) changes[field] = { from, to };
  }
  return changes;
};

/** HU-E4-06: owners and admins change any transaction, members only their own, viewers none. */
export const canModify = (role: MemberRole | null, createdBy: string, userId: string): boolean =>
  role === "OWNER" || role === "ADMIN" || (role === "MEMBER" && createdBy === userId);
```

In `src/modules/ledger/application/index.ts`, replace the line `  Share,` with:

```ts
  Settlement,
  Share,
```

In `src/modules/ledger/infrastructure/ledger.schema.ts`, replace the line `    type: text("type", { enum: ["EXPENSE", "INCOME", "TRANSFER"] }).notNull(),` with:

```ts
    type: text("type", { enum: ["EXPENSE", "INCOME", "TRANSFER", "SETTLEMENT"] }).notNull(),
```

`src/modules/ledger/infrastructure/transaction-rows.ts` (replace the whole file):

```ts
import { asc, inArray } from "drizzle-orm";
import type { Executor } from "@/shared/infrastructure/db/client";
import type { LocalDate } from "@/shared/kernel";
import type { Payment, Share, Transaction, TransactionId } from "../domain/transaction";
import { payments, shares, transactions } from "./ledger.schema";

type TransactionRow = typeof transactions.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;
type ShareRow = typeof shares.$inferSelect;

/** Per-type columns; the transactions_shape check pins which ones each type sets. */
export const transactionRow = (tx: Transaction): typeof transactions.$inferInsert => ({
  id: tx.id,
  spaceId: tx.spaceId,
  type: tx.type,
  description: tx.description,
  date: tx.date,
  categoryId: tx.categoryId,
  amount: tx.amount,
  currency: tx.currency,
  sourceAccountId: tx.type === "TRANSFER" || tx.type === "SETTLEMENT" ? tx.sourceAccountId : null,
  destinationAccountId: tx.type === "EXPENSE" ? null : tx.destinationAccountId,
  receivingMemberId: tx.type === "INCOME" || tx.type === "SETTLEMENT" ? tx.receivingMemberId : null,
  payerMemberId: tx.type === "TRANSFER" || tx.type === "SETTLEMENT" ? tx.payerMemberId : null,
  createdBy: tx.createdBy,
  createdAt: tx.createdAt,
  updatedAt: tx.updatedAt,
  deletedAt: tx.deletedAt,
  version: tx.version,
});

export const paymentRows = (tx: Transaction): (typeof payments.$inferInsert)[] =>
  tx.type === "EXPENSE"
    ? tx.payments.map((p, position) => ({
        transactionId: tx.id,
        position,
        memberId: p.memberId,
        accountId: p.accountId,
        amount: p.amount,
      }))
    : [];

export const shareRows = (tx: Transaction): (typeof shares.$inferInsert)[] =>
  tx.type === "EXPENSE"
    ? tx.shares.map((s, position) => ({
        transactionId: tx.id,
        position,
        memberId: s.memberId,
        amount: s.amount,
        splitMethod: s.splitMethod,
      }))
    : [];

const toPayment = (row: PaymentRow): Payment => ({
  memberId: row.memberId,
  accountId: row.accountId,
  amount: row.amount,
});
const toShare = (row: ShareRow): Share => ({
  memberId: row.memberId,
  amount: row.amount,
  splitMethod: row.splitMethod,
});

/** Rebuilds the aggregate; the transactions_shape check guarantees the per-type columns are set. */
const toTransaction = (
  row: TransactionRow,
  rowPayments: readonly PaymentRow[],
  rowShares: readonly ShareRow[],
): Transaction => {
  const base = {
    id: row.id as TransactionId,
    spaceId: row.spaceId,
    description: row.description,
    date: row.date as LocalDate,
    amount: row.amount,
    currency: row.currency,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    version: row.version,
  };
  switch (row.type) {
    case "EXPENSE":
      return {
        ...base,
        type: "EXPENSE",
        categoryId: row.categoryId!,
        payments: rowPayments.map(toPayment),
        shares: rowShares.map(toShare),
      };
    case "INCOME":
      return {
        ...base,
        type: "INCOME",
        categoryId: row.categoryId!,
        destinationAccountId: row.destinationAccountId!,
        receivingMemberId: row.receivingMemberId!,
      };
    case "TRANSFER":
      return {
        ...base,
        type: "TRANSFER",
        categoryId: null,
        sourceAccountId: row.sourceAccountId,
        destinationAccountId: row.destinationAccountId!,
        payerMemberId: row.payerMemberId,
      };
    case "SETTLEMENT":
      return {
        ...base,
        type: "SETTLEMENT",
        categoryId: null,
        payerMemberId: row.payerMemberId!,
        receivingMemberId: row.receivingMemberId!,
        sourceAccountId: row.sourceAccountId,
        destinationAccountId: row.destinationAccountId,
      };
  }
};

/** Loads the payments and shares of `rows` with two queries and keeps the rows' order. */
export const loadTransactions = async (
  db: Executor,
  rows: readonly TransactionRow[],
): Promise<Transaction[]> => {
  const expenseIds = rows.filter((r) => r.type === "EXPENSE").map((r) => r.id);
  const allPayments: PaymentRow[] =
    expenseIds.length === 0
      ? []
      : await db
          .select()
          .from(payments)
          .where(inArray(payments.transactionId, expenseIds))
          .orderBy(asc(payments.position));
  const allShares: ShareRow[] =
    expenseIds.length === 0
      ? []
      : await db
          .select()
          .from(shares)
          .where(inArray(shares.transactionId, expenseIds))
          .orderBy(asc(shares.position));
  return rows.map((row) =>
    toTransaction(
      row,
      allPayments.filter((p) => p.transactionId === row.id),
      allShares.filter((s) => s.transactionId === row.id),
    ),
  );
};
```

In `src/modules/ledger/contracts/ledger.contract.ts`:

1. Replace the line `  type: z.enum(["EXPENSE", "INCOME", "TRANSFER"]),` with:

```ts
  type: z.enum(["EXPENSE", "INCOME", "TRANSFER", "SETTLEMENT"]),
```

2. Replace the line `  receivingMemberId: z.string().nullable(),` with:

```ts
  /** The receiving member of an INCOME, or the member a SETTLEMENT is paid to. */
  receivingMemberId: z.string().nullable(),
  /** The contributor of a TRANSFER into the shared fund (HU-E4-09) or the payer of a SETTLEMENT (HU-E5-02). */
  payerMemberId: z.string().nullable(),
```

3. Replace the three lines

```ts
    sourceAccountId: tx.type === "TRANSFER" ? tx.sourceAccountId : null,
    destinationAccountId: tx.type === "EXPENSE" ? null : tx.destinationAccountId,
    receivingMemberId: tx.type === "INCOME" ? tx.receivingMemberId : null,
```

with:

```ts
    sourceAccountId: tx.type === "TRANSFER" || tx.type === "SETTLEMENT" ? tx.sourceAccountId : null,
    destinationAccountId: tx.type === "EXPENSE" ? null : tx.destinationAccountId,
    receivingMemberId: tx.type === "INCOME" || tx.type === "SETTLEMENT" ? tx.receivingMemberId : null,
    payerMemberId: tx.type === "TRANSFER" || tx.type === "SETTLEMENT" ? tx.payerMemberId : null,
```

In `tests/support/in-memory-ledger.ts`, add after the line `  destinationAccountId: ACCOUNTS.nequi.id,`:

```ts
  payerMemberId: null,
```

- [ ] **Step 4: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project unit src/modules/ledger && pnpm exec vitest run --project integration src/modules/ledger`
Expected: PASS (the new domain tests, the round-trip of contributions and settlements, and `netMovements` moving Ana's bank by −43,000,000 minor units and the fund by +58,000,000).

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: only `components.schemas.Transaction` changes (`SETTLEMENT` in the `type` enum, a required nullable `payerMemberId`); no operation changes and no new `…Output` component.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (M1 acceptance responses gain `"payerMemberId": null`; its assertions use `toMatchObject` or compare a replay with the first response, so they still pass).

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/domain/transaction.ts src/modules/ledger/domain/transaction.test.ts src/modules/ledger/application/index.ts src/modules/ledger/infrastructure/ledger.schema.ts src/modules/ledger/infrastructure/transaction-rows.ts src/modules/ledger/infrastructure/drizzle-transaction-repository.int.test.ts src/modules/ledger/infrastructure/drizzle-ledger-queries.int.test.ts src/modules/ledger/contracts/ledger.contract.ts tests/support/in-memory-ledger.ts openapi/openapi.snapshot.json
git commit -m "feat(ledger): model settlements and fund contributions in the transaction aggregate (Refs #38, Refs #44)"
```

---

### Task 4: Ledger — shared expenses with member and guest payers

Implements HU-E4-07 (issue #36) in the use case: `RecordExpense` accepts `payments[]` by current members (registered from an account their user owns, guests outside the app) and a `split`, and defaults to `EQUAL` among every current member (spec 5.3). The M1 personal shape (`accountId` only) keeps working unchanged: in a personal space the only current member is the requester. Pins Review Focus 2 at the use-case level.

Decisions:
- One check per rule, in `checks.ts`: `partyAccount` resolves the account a member moves money through (`NotASpaceMember`, `GuestHasNoAccounts`, `AccountRequired`, then M1's `ownAccount` with the **member's** user). A debit (`debitedBy`, the requester's user id) must also come from the requester's own account (D9): Ana records her own payment or a guest's, but a payment from Juan's account is `AccountNotOwned` unless Juan records it himself. Tasks 7 and 8 reuse it for contributions (debit) and settlements (debit from the payer's account, credit to the receiver's).
- A member listed twice among the payers is `InvalidSplit` (reason `duplicatePayer`), like a participant listed twice; the fund (`memberId` null, Task 6) is not a member and is covered by `MixedFundPayment`.
- `authorizeWriter` now delegates to `authorizeSpaceAction(…, "money.record")`, so every ledger write reads the permission matrix (same roles as M1's `WRITERS`, which was already derived from that row).
- A new `members` port (`Pick<SpaceMemberRepository, "listCurrent">`) is bound to `DrizzleSpaceRepository` in the composition root; the in-memory fixture binds the `InMemorySpaceStore`.
- With `payments`, the M1 `accountId` is ignored (the contract of Task 11 rejects sending both); without either, the requester pays with no account and gets `AccountRequired`.
- The use-case tests read what was stored (`store.rows`), so Task 6 can widen the return type without touching them.

**Files:**
- Modify: `src/modules/ledger/application/checks.ts`, `src/modules/ledger/application/deps.ts`, `src/modules/ledger/application/record-expense.ts`, `src/modules/ledger/application/index.ts`, `src/composition/container.ts`, `tests/support/in-memory-ledger.ts`
- Test: `src/modules/ledger/application/shared-expense.test.ts`

**Interfaces:**
- Consumes: `splitShares`, `SplitInput` (Task 1); `authorizeSpaceAction`, `SpaceMember`, `SpaceMembership`, `SpaceMemberRepository`, `createSpaceAccess` (`@/modules/spaces/application`); `InMemorySpaceStore`, `householdSpace`, `HOUSEHOLD_MEMBERS`, `memberOf` (`tests/support/in-memory-spaces.ts`); M1 `ownAccount`, `inSpaceCurrency`, `usableCategory`, `openPeriod`, `recordExpense`, `ledgerFixture`, `ACCOUNTS`, `CATEGORIES`.
- Produces:
  - `LedgerDeps.members: Pick<SpaceMemberRepository, "listCurrent">`
  - `partyAccount(deps: Pick<LedgerDeps, "accounts">, members: readonly SpaceMember[], memberId: string, accountId: string | null, options: { readonly required: boolean; readonly debitedBy?: string }): Promise<Result<string | null>>` (`debitedBy`: the requester's user id on debits; the account must be theirs, else `AccountNotOwned`)
  - `authorizeWriter(deps: Pick<LedgerDeps, "access">, spaceId: string, userId: string): Promise<Result<SpaceMembership>>` (now via the matrix)
  - `interface PaymentInput { memberId: string; accountId: string | null; amount: Money }` (Task 6 makes `memberId` nullable)
  - `RecordExpenseInput` gains `accountId?: string`, `payments?: readonly PaymentInput[]`, `split?: SplitInput`; `RecordExpense` still returns `Result<Expense>` (Task 6 widens it).
  - `tests/support/in-memory-ledger.ts`: `CATEGORIES.household` (`cat-household` in `space-household`); `ledgerFixture` default `members` (Ana alone in `space-ana`); `householdLedger(members?: readonly SpaceMember[], overrides?: Partial<LedgerDeps>)` → `{ deps, store, audit }` over "Household" (`space-household`, HU-E1-05 Background members by default: `member-ana` OWNER `u-ana`, `member-juan` ADMIN `u-juan`, `member-luis` MEMBER `u-luis`, `member-sofi` VIEWER `u-sofi`, guest `member-pedro`).

- [ ] **Step 1: Write the failing test and its in-memory household**

In `tests/support/in-memory-ledger.ts`:

1. Replace the line `import { FixedClock, type LocalDate } from "@/shared/kernel";` with:

```ts
import { createSpaceAccess, type SpaceMember } from "@/modules/spaces/application";
import { FixedClock, type LocalDate } from "@/shared/kernel";
```

2. Add after the line `import { fakeSpaceAccess, memoryTm, membership, noStoredPeriods, sequentialIds } from "./fakes";`:

```ts
import { HOUSEHOLD_MEMBERS, householdSpace, InMemorySpaceStore, memberOf } from "./in-memory-spaces";
```

3. Add after the line `  juanFood: { id: "cat-juan-food", spaceId: "space-juan", archived: false },`:

```ts
  household: { id: "cat-household", spaceId: "space-household", archived: false },
```

4. Add after the line `    storedPeriods: noStoredPeriods,`:

```ts
    // Ana alone in her personal space; householdLedger binds a real member list.
    members: { listCurrent: async (spaceId) => (spaceId === "space-ana" ? [memberOf("Ana", "OWNER", 0)] : []) },
```

5. Insert before the line `let seeded = 0;`:

```ts
/**
 * "Household" (`space-household`, COP, MONTHLY(1)) as the ledger sees it: memberships and the current
 * member list come from one in-memory spaces store (HU-E1-05 Background members unless given).
 */
export const householdLedger = (
  members: readonly SpaceMember[] = HOUSEHOLD_MEMBERS,
  overrides: Partial<LedgerDeps> = {},
) => {
  const spaces = new InMemorySpaceStore();
  spaces.seed(householdSpace(members));
  return ledgerFixture({ access: createSpaceAccess(spaces), members: spaces, ...overrides });
};

```

`src/modules/ledger/application/shared-expense.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, money } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES, householdLedger } from "../../../../tests/support/in-memory-ledger";
import { memberOf } from "../../../../tests/support/in-memory-spaces";
import type { Expense, Transaction } from "../domain/transaction";
import { createRecordExpense, type RecordExpenseInput } from "./record-expense";

const cop = (pesos: bigint) => money(pesos * 100n);
const equal = (...memberIds: string[]) => ({
  method: "EQUAL" as const,
  participants: memberIds.map((memberId) => ({ memberId })),
});
/** In Household, Ana pays `pesos` from Bancolombia and splits them equally with Juan. */
const groceries = (pesos: bigint, overrides: Partial<RecordExpenseInput> = {}): RecordExpenseInput => ({
  spaceId: "space-household",
  userId: "u-ana",
  description: "Groceries",
  date: "2026-10-05" as LocalDate,
  categoryId: CATEGORIES.household.id,
  amount: cop(pesos),
  payments: [{ memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: cop(pesos) }],
  split: equal("member-ana", "member-juan"),
  ...overrides,
});
/** The expense the use case stored last. */
const lastExpense = (rows: readonly Transaction[]): Expense => {
  const tx = rows.at(-1);
  if (tx?.type !== "EXPENSE") throw new Error("no expense was recorded");
  return tx;
};
const sharesOf = (tx: Expense) => tx.shares.map((share) => [share.memberId, share.amount]);

describe("RecordExpense with members' payments and an equal split (HU-E4-07)", () => {
  it("records Ana's payment and equal shares for Ana and Juan", async () => {
    const { deps, store } = householdLedger();
    expect(codeOf(await createRecordExpense(deps)(groceries(300_000n)))).toBe("ok");
    const tx = lastExpense(store.rows);
    expect(tx).toMatchObject({ spaceId: "space-household", amount: 30_000_000n, createdBy: "u-ana" });
    expect(tx.payments).toEqual([{ memberId: "member-ana", accountId: "acc-bancolombia", amount: 30_000_000n }]);
    expect(tx.shares).toEqual([
      { memberId: "member-ana", amount: 15_000_000n, splitMethod: "EQUAL" },
      { memberId: "member-juan", amount: 15_000_000n, splitMethod: "EQUAL" },
    ]);
  });

  it("gives the remainder peso to the earliest-joined participant", async () => {
    const { deps, store } = householdLedger();
    const split = equal("member-luis", "member-juan", "member-ana");
    expect(codeOf(await createRecordExpense(deps)(groceries(100_000n, { split })))).toBe("ok");
    expect(sharesOf(lastExpense(store.rows))).toEqual([
      ["member-ana", 3_333_400n],
      ["member-juan", 3_333_300n],
      ["member-luis", 3_333_300n],
    ]);
  });

  it("lets the payer stay out of the split", async () => {
    const { deps, store } = householdLedger();
    expect(codeOf(await createRecordExpense(deps)(groceries(80_000n, { split: equal("member-juan") })))).toBe(
      "ok",
    );
    expect(sharesOf(lastExpense(store.rows))).toEqual([["member-juan", 8_000_000n]]);
  });

  it("records a taxi paid by the guest Pedro outside the app", async () => {
    const { deps, store } = householdLedger();
    const taxi = groceries(90_000n, {
      description: "Taxi",
      payments: [{ memberId: "member-pedro", accountId: null, amount: cop(90_000n) }],
      split: equal("member-ana", "member-juan", "member-pedro"),
    });
    expect(codeOf(await createRecordExpense(deps)(taxi))).toBe("ok");
    const tx = lastExpense(store.rows);
    expect(tx.payments).toEqual([{ memberId: "member-pedro", accountId: null, amount: 9_000_000n }]);
    expect(sharesOf(tx)).toEqual([
      ["member-ana", 3_000_000n],
      ["member-juan", 3_000_000n],
      ["member-pedro", 3_000_000n],
    ]);
    expect(tx.createdBy).toBe("u-ana");
  });

  it("lets only the account's owner record a payment from it (D9)", async () => {
    const { deps, store } = householdLedger();
    const record = createRecordExpense(deps);
    const payments = [{ memberId: "member-juan", accountId: ACCOUNTS.davivienda.id, amount: cop(300_000n) }];
    // Ana cannot spend from Juan's account, even naming Juan as the payer.
    expect(codeOf(await record(groceries(300_000n, { payments })))).toBe("AccountNotOwned");
    expect(store.rows).toEqual([]);
    // Juan records his own payment from his own account.
    expect(codeOf(await record(groceries(300_000n, { userId: "u-juan", payments })))).toBe("ok");
    expect(lastExpense(store.rows)).toMatchObject({
      createdBy: "u-juan",
      payments: [{ memberId: "member-juan", accountId: "acc-davivienda", amount: 30_000_000n }],
    });
  });

  it("shares equally among every current member when no split is given (spec 5.3)", async () => {
    const { deps, store } = householdLedger([memberOf("Ana", "OWNER", 0), memberOf("Juan", "MEMBER", 1)]);
    expect(codeOf(await createRecordExpense(deps)(groceries(300_000n, { split: undefined })))).toBe("ok");
    expect(sharesOf(lastExpense(store.rows))).toEqual([
      ["member-ana", 15_000_000n],
      ["member-juan", 15_000_000n],
    ]);
  });
});

describe("payers and participants of a shared expense (HU-E4-07, Review Focus 2)", () => {
  const paidBy = (memberId: string, accountId: string | null, pesos = 300_000n) => ({
    payments: [{ memberId, accountId, amount: cop(pesos) }],
  });

  it.each<[string, Partial<RecordExpenseInput>, string]>([
    ["a participant who is not a member", { split: equal("member-ana", "member-marta") }, "NotASpaceMember"],
    ["a payer who is not a member", paidBy("member-marta", null), "NotASpaceMember"],
    ["no participants", { split: equal() }, "ParticipantsRequired"],
    ["no payments", { payments: [] }, "PaymentsRequired"],
    ["a registered payer without an account", paidBy("member-juan", null), "AccountRequired"],
    ["a guest payer with an account", paidBy("member-pedro", ACCOUNTS.bancolombia.id), "GuestHasNoAccounts"],
    ["Juan paying from Ana's account", paidBy("member-juan", ACCOUNTS.bancolombia.id), "AccountNotOwned"],
    [
      "a payer listed twice",
      {
        payments: [
          { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: cop(150_000n) },
          { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: cop(150_000n) },
        ],
      },
      "InvalidSplit",
    ],
    ["payments that do not add up", paidBy("member-ana", ACCOUNTS.bancolombia.id, 200_000n), "SharesDoNotMatchAmount"],
    [
      "a payment in another currency",
      { payments: [{ memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: money(100n, "USD") }] },
      "CurrencyMismatch",
    ],
  ])("rejects %s and records nothing", async (_case, overrides, code) => {
    const { deps, store } = householdLedger();
    expect(codeOf(await createRecordExpense(deps)(groceries(300_000n, overrides)))).toBe(code);
    expect(store.rows).toEqual([]);
  });

  it("lets members record for guests, but not viewers, and hides the space from non-members", async () => {
    const { deps } = householdLedger();
    const record = createRecordExpense(deps);
    const byPedro = groceries(90_000n, {
      ...paidBy("member-pedro", null, 90_000n),
      split: equal("member-luis", "member-pedro"),
    });
    expect(codeOf(await record({ ...byPedro, userId: "u-luis" }))).toBe("ok");
    expect(codeOf(await record({ ...byPedro, userId: "u-sofi" }))).toBe("InsufficientRole");
    expect(codeOf(await record({ ...byPedro, userId: "u-marta" }))).toBe("SpaceNotFound");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/shared-expense.test.ts`
Expected: FAIL — the M1 use case ignores `payments` and `split`, so most cases answer `AccountNotFound` (it looks up the missing `accountId`) instead of `ok` or the expected code.

- [ ] **Step 3: Implement**

`src/modules/ledger/application/checks.ts` (replace the whole file):

```ts
import { authorizeSpaceAction, type SpaceMember, type SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, map, ok, type LocalDate, type Money, type Result } from "@/shared/kernel";
import type { LedgerDeps } from "./deps";
import type { LedgerAccount } from "./ports";

/** HU-E1-05: recording money movements is the matrix action money.record (MEMBER or above). */
export const authorizeWriter = (
  deps: Pick<LedgerDeps, "access">,
  spaceId: string,
  userId: string,
): Promise<Result<SpaceMembership>> => authorizeSpaceAction(deps.access, spaceId, userId, "money.record");

/** D6: amounts are in the space currency. */
export const inSpaceCurrency = (space: SpaceMembership, money: Money): Result<Money> =>
  money.currency.code === space.currency
    ? ok(money)
    : err(domainError("CurrencyMismatch", { expected: space.currency, actual: money.currency.code }));

/** HU-E4-01 / HU-E3-03: a category of the space that is not archived. */
export const usableCategory = async (
  deps: Pick<LedgerDeps, "categories">,
  spaceId: string,
  categoryId: string | null | undefined,
): Promise<Result<string>> => {
  if (categoryId === undefined || categoryId === null) return err(domainError("CategoryRequired"));
  const category = await deps.categories.find(spaceId, categoryId);
  if (category === null) return err(domainError("CategoryNotFound"));
  return category.archived ? err(domainError("CategoryArchived")) : ok(category.id);
};

/** D9: registered members move money only through accounts they own; archived accounts take no new movements. */
export const ownAccount = async (
  deps: Pick<LedgerDeps, "accounts">,
  accountId: string,
  userId: string,
): Promise<Result<LedgerAccount>> => {
  const account = await deps.accounts.find(accountId);
  if (account === null) return err(domainError("AccountNotFound"));
  if (account.ownerUserId !== userId) return err(domainError("AccountNotOwned"));
  return account.archived ? err(domainError("AccountArchived")) : ok(account);
};

/** HU-E4-02/03: income and own transfers stay inside the transaction's space. */
export const accountInSpace = (account: LedgerAccount, spaceId: string): Result<LedgerAccount> =>
  account.spaceId === spaceId ? ok(account) : err(domainError("AccountNotInSpace"));

export const openPeriod = async (
  deps: Pick<LedgerDeps, "closedPeriods">,
  spaceId: string,
  date: LocalDate,
): Promise<Result<void>> =>
  (await deps.closedPeriods.isClosed(spaceId, date)) ? err(domainError("PeriodClosed")) : ok(undefined);

/**
 * Spec 5.2, D9, D15: the account a current member moves money through. A guest has none
 * (GuestHasNoAccounts); a registered member uses an account their own user owns, which may live in
 * their personal space. `required` is false only where accounts are optional (settlements).
 * `debitedBy` is the requester on debits: nobody spends from another member's account (D9).
 */
export const partyAccount = async (
  deps: Pick<LedgerDeps, "accounts">,
  members: readonly SpaceMember[],
  memberId: string,
  accountId: string | null,
  options: { readonly required: boolean; readonly debitedBy?: string },
): Promise<Result<string | null>> => {
  const member = members.find((m) => m.id === memberId);
  if (member === undefined) return err(domainError("NotASpaceMember"));
  // D15: a member without a user is a guest.
  if (member.userId === null) return accountId === null ? ok(null) : err(domainError("GuestHasNoAccounts"));
  if (accountId === null) return options.required ? err(domainError("AccountRequired")) : ok(null);
  // D9: only the account's owner records a debit from it; crediting another member's account is allowed.
  if (options.debitedBy !== undefined && options.debitedBy !== member.userId) {
    return err(domainError("AccountNotOwned"));
  }
  return map(await ownAccount(deps, accountId, member.userId), (account) => account.id);
};
```

`src/modules/ledger/application/deps.ts` (replace the whole file):

```ts
import type { SpaceAccess, SpaceMemberRepository, StoredPeriodSource } from "@/modules/spaces/application";
import type { Clock, IdGenerator, TransactionManager } from "@/shared/kernel";
import type {
  AccountReader,
  AuditLog,
  CategoryReader,
  ClosedPeriodGuard,
  TransactionQuery,
  TransactionRepository,
} from "./ports";

export interface LedgerDeps {
  readonly access: SpaceAccess;
  /** HU-E4-07: the current members in join order; payers and participants must be among them. */
  readonly members: Pick<SpaceMemberRepository, "listCurrent">;
  readonly transactions: TransactionRepository;
  readonly query: TransactionQuery;
  readonly audit: AuditLog;
  readonly accounts: AccountReader;
  readonly categories: CategoryReader;
  readonly closedPeriods: ClosedPeriodGuard;
  readonly storedPeriods: StoredPeriodSource;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** The space timezone; v1 uses the deployment timezone (APP_TIMEZONE). */
  readonly timeZone: string;
  readonly tm: TransactionManager;
}
```

`src/modules/ledger/application/record-expense.ts` (replace the whole file):

```ts
import type { SpaceMember, SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, map, todayIn, type LocalDate, type Money, type Result } from "@/shared/kernel";
import { splitShares, type SplitInput } from "../domain/split";
import { positiveAmount, recordExpense, type Expense, type Payment } from "../domain/transaction";
import { authorizeWriter, inSpaceCurrency, openPeriod, partyAccount, usableCategory } from "./checks";
import type { LedgerDeps } from "./deps";

/** One requested payment (spec 5.2). */
export interface PaymentInput {
  /** The paying member, registered or guest. */
  readonly memberId: string;
  /** The payer's own account; null for a guest, who pays outside the app. */
  readonly accountId: string | null;
  readonly amount: Money;
}

export interface RecordExpenseInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly date?: LocalDate;
  readonly categoryId?: string;
  readonly amount: Money;
  /** HU-E4-01 shorthand: the requester pays the whole amount from this account of theirs. Ignored with `payments`. */
  readonly accountId?: string;
  /** HU-E4-07: who paid, registered members or guests; the domain accepts several (the v1 UI offers one). */
  readonly payments?: readonly PaymentInput[];
  /** HU-E4-07/08: how the amount is shared; EQUAL among every current member when absent (spec 5.3). */
  readonly split?: SplitInput;
}

export type RecordExpense = (input: RecordExpenseInput) => Promise<Result<Expense>>;

/**
 * A current member pays: registered members from an account their user owns (and only the requester
 * may debit their own account, D9), guests outside the app.
 */
const paymentOf = async (
  deps: Pick<LedgerDeps, "accounts">,
  space: SpaceMembership,
  members: readonly SpaceMember[],
  requested: PaymentInput,
): Promise<Result<Payment>> => {
  const currency = inSpaceCurrency(space, requested.amount);
  if (!currency.ok) return currency;
  const { memberId, accountId } = requested;
  const amount = requested.amount.minor;
  const debit = { required: true, debitedBy: space.userId };
  return map(await partyAccount(deps, members, memberId, accountId, debit), (account) => ({
    memberId,
    accountId: account,
    amount,
  }));
};

/**
 * HU-E4-01, HU-E4-07: one use case for personal and shared expenses (D2). A personal expense is a
 * shared expense with one participant: the requester pays from `accountId` and, being the only current
 * member of their personal space, takes the whole EQUAL share.
 */
export const createRecordExpense =
  (deps: LedgerDeps): RecordExpense =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeWriter(deps, input.spaceId, input.userId);
      if (!writer.ok) return writer;
      const space = writer.value;
      const amount = positiveAmount(input.amount.minor);
      if (!amount.ok) return amount;
      const currency = inSpaceCurrency(space, input.amount);
      if (!currency.ok) return currency;
      const category = await usableCategory(deps, space.spaceId, input.categoryId);
      if (!category.ok) return category;
      const members = await deps.members.listCurrent(space.spaceId);
      const requested: readonly PaymentInput[] = input.payments ?? [
        { memberId: space.memberId, accountId: input.accountId ?? null, amount: input.amount },
      ];
      // Each member pays at most once per expense, like each participant takes one share.
      const payers = requested.map((payment) => payment.memberId);
      if (new Set(payers).size !== payers.length) {
        return err(domainError("InvalidSplit", { reason: "duplicatePayer" }));
      }
      const payments: Payment[] = [];
      for (const payment of requested) {
        const resolved = await paymentOf(deps, space, members, payment);
        if (!resolved.ok) return resolved;
        payments.push(resolved.value);
      }
      const split: SplitInput = input.split ?? {
        method: "EQUAL",
        participants: members.map((m) => ({ memberId: m.id })),
      };
      const shares = splitShares(
        input.amount,
        split,
        members.map((m) => m.id),
      );
      if (!shares.ok) return shares;
      const date = input.date ?? todayIn(deps.clock, deps.timeZone);
      const open = await openPeriod(deps, space.spaceId, date);
      if (!open.ok) return open;
      const expense = recordExpense({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: amount.value,
        currency: space.currency,
        createdBy: input.userId,
        now: deps.clock.now(),
        categoryId: category.value,
        payments,
        shares: shares.value,
      });
      if (!expense.ok) return expense;
      await deps.transactions.add(expense.value);
      return expense;
    });
```

In `src/modules/ledger/application/index.ts`, replace the line `export { createRecordExpense, type RecordExpense, type RecordExpenseInput } from "./record-expense";` with:

```ts
export {
  createRecordExpense,
  type PaymentInput,
  type RecordExpense,
  type RecordExpenseInput,
} from "./record-expense";
```

In `src/composition/container.ts`, add after the line `    transactions: new DrizzleTransactionRepository(tm),`:

```ts
    // HU-E4-07: payers and participants are current members of the space, in join order.
    members: spaceRepository,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: PASS (the new file, M1's `record-expense.test.ts` unchanged — a personal expense still records one payment from the account and one EQUAL share for Ana — and every other ledger test).

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (M1's personal expense acceptance tests still pass through the composition root's `members: spaceRepository`).

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/application/checks.ts src/modules/ledger/application/deps.ts src/modules/ledger/application/record-expense.ts src/modules/ledger/application/index.ts src/modules/ledger/application/shared-expense.test.ts src/composition/container.ts tests/support/in-memory-ledger.ts
git commit -m "feat(ledger): record shared expenses paid by members and guests (Refs #36)"
```

---

### Task 5: Ledger — percentage, exact and share-unit splits

Implements HU-E4-08 (issue #37): `SplitInput` gains `PERCENT` (basis points, so two decimals), `EXACT` (Money per participant) and `SHARES` (positive integer units). All of them go through the same participant checks and join-order rounding as `EQUAL`.

Decisions:
- Percentages travel as basis points (`4000` = 40 %); they must be positive integers summing to `10000` (`InvalidSplit`, reasons `percentNotPositive`, `percentNotHundred`). Task 12 parses `"40"` / `"33.33"` from the wire.
- Exact amounts must be in the expense currency (`CurrencyMismatch`), positive (`InvalidSplit`) and sum to the amount (`SharesDoNotMatchAmount`, as HU-E4-08 says).
- Share units must be positive safe integers (`InvalidSplit`, reason `unitsNotPositive`).
- Only the resulting share amounts and the method are stored (spec 5.2's `splitMethod` snapshot); the per-member inputs are not persisted (see Self-Review, contradiction 4).

**Files:**
- Modify: `src/modules/ledger/domain/split.ts`
- Test: `src/modules/ledger/domain/split.test.ts`, `src/modules/ledger/application/shared-expense.test.ts` (both modified)

**Interfaces:**
- Consumes: `splitShares`, `SplitInput` (Task 1); `householdLedger`, `createRecordExpense` and the test helpers of `shared-expense.test.ts` (Task 4).
- Produces: `SplitInput` with the variants `{ method: "PERCENT"; participants: { memberId: string; basisPoints: number }[] }`, `{ method: "EXACT"; participants: { memberId: string; amount: Money }[] }` and `{ method: "SHARES"; participants: { memberId: string; units: number }[] }`; `splitShares` unchanged in signature.

- [ ] **Step 1: Write the failing tests**

Append to `src/modules/ledger/domain/split.test.ts`:

```ts

describe("non-equal splits (HU-E4-08)", () => {
  const percent = (...points: [string, number][]): SplitInput => ({
    method: "PERCENT",
    participants: points.map(([memberId, basisPoints]) => ({ memberId, basisPoints })),
  });
  const exact = (...parts: [string, Money][]): SplitInput => ({
    method: "EXACT",
    participants: parts.map(([memberId, amount]) => ({ memberId, amount })),
  });
  const units = (...parts: [string, number][]): SplitInput => ({
    method: "SHARES",
    participants: parts.map(([memberId, count]) => ({ memberId, units: count })),
  });

  it("splits 300,000 COP 40% / 60%", () => {
    const split = percent(["member-ana", 4_000], ["member-juan", 6_000]);
    expect(unwrap(splitShares(pesos(300_000n), split, MEMBERS))).toEqual([
      { memberId: "member-ana", amount: 12_000_000n, splitMethod: "PERCENT" },
      { memberId: "member-juan", amount: 18_000_000n, splitMethod: "PERCENT" },
    ]);
  });

  it("accepts percentages with two decimals and still sums exactly (Review Focus 1)", () => {
    const split = percent(["member-ana", 3_333], ["member-juan", 3_333], ["member-luis", 3_334]);
    expect(amounts(pesos(100_000n), split)).toEqual([
      ["member-ana", 3_333_000n],
      ["member-juan", 3_333_000n],
      ["member-luis", 3_334_000n],
    ]);
  });

  it("rejects percentages that do not sum to 100 or are not positive", () => {
    expect(codeOf(splitShares(pesos(300_000n), percent(["member-ana", 4_000], ["member-juan", 5_000]), MEMBERS))).toBe(
      "InvalidSplit",
    );
    expect(codeOf(splitShares(pesos(300_000n), percent(["member-ana", 0], ["member-juan", 10_000]), MEMBERS))).toBe(
      "InvalidSplit",
    );
  });

  it("records exact amounts that add up to the expense", () => {
    const split = exact(["member-ana", pesos(100_000n)], ["member-juan", pesos(150_000n)]);
    expect(amounts(pesos(250_000n), split)).toEqual([
      ["member-ana", 10_000_000n],
      ["member-juan", 15_000_000n],
    ]);
  });

  it("rejects exact amounts that do not add up, are not positive or use another currency", () => {
    const short = exact(["member-ana", pesos(100_000n)], ["member-juan", pesos(120_000n)]);
    expect(codeOf(splitShares(pesos(250_000n), short, MEMBERS))).toBe("SharesDoNotMatchAmount");
    const negative = exact(["member-ana", pesos(260_000n)], ["member-juan", money(-1_000_000n)]);
    expect(codeOf(splitShares(pesos(250_000n), negative, MEMBERS))).toBe("InvalidSplit");
    const dollars = exact(["member-ana", pesos(100_000n)], ["member-juan", money(15_000_000n, "USD")]);
    expect(codeOf(splitShares(pesos(250_000n), dollars, MEMBERS))).toBe("CurrencyMismatch");
  });

  it("splits 90,000 COP by share units 2:1", () => {
    expect(amounts(pesos(90_000n), units(["member-ana", 2], ["member-juan", 1]))).toEqual([
      ["member-ana", 6_000_000n],
      ["member-juan", 3_000_000n],
    ]);
  });

  it("rejects share units that are not positive integers", () => {
    expect(codeOf(splitShares(pesos(90_000n), units(["member-ana", 0], ["member-juan", 0]), MEMBERS))).toBe(
      "InvalidSplit",
    );
    expect(codeOf(splitShares(pesos(90_000n), units(["member-ana", 1.5], ["member-juan", 1]), MEMBERS))).toBe(
      "InvalidSplit",
    );
  });

  it("orders non-equal shares by join order too", () => {
    const split = percent(["member-juan", 6_000], ["member-ana", 4_000]);
    expect(amounts(pesos(300_000n), split)).toEqual([
      ["member-ana", 12_000_000n],
      ["member-juan", 18_000_000n],
    ]);
  });
});
```

Append to `src/modules/ledger/application/shared-expense.test.ts`:

```ts

describe("RecordExpense with non-equal splits (HU-E4-08)", () => {
  const fortySixty = {
    method: "PERCENT" as const,
    participants: [
      { memberId: "member-ana", basisPoints: 4_000 },
      { memberId: "member-juan", basisPoints: 6_000 },
    ],
  };

  it("stores percentage, exact and share-unit splits with their method", async () => {
    const { deps, store } = householdLedger();
    const record = createRecordExpense(deps);
    const exact = {
      method: "EXACT" as const,
      participants: [
        { memberId: "member-ana", amount: cop(100_000n) },
        { memberId: "member-juan", amount: cop(150_000n) },
      ],
    };
    const units = {
      method: "SHARES" as const,
      participants: [
        { memberId: "member-ana", units: 2 },
        { memberId: "member-juan", units: 1 },
      ],
    };
    expect(codeOf(await record(groceries(300_000n, { split: fortySixty })))).toBe("ok");
    expect(codeOf(await record(groceries(250_000n, { split: exact })))).toBe("ok");
    expect(codeOf(await record(groceries(90_000n, { split: units })))).toBe("ok");
    expect(
      store.rows.map((tx) =>
        tx.type === "EXPENSE" ? tx.shares.map((s) => [s.memberId, s.amount, s.splitMethod]) : [],
      ),
    ).toEqual([
      [
        ["member-ana", 12_000_000n, "PERCENT"],
        ["member-juan", 18_000_000n, "PERCENT"],
      ],
      [
        ["member-ana", 10_000_000n, "EXACT"],
        ["member-juan", 15_000_000n, "EXACT"],
      ],
      [
        ["member-ana", 6_000_000n, "SHARES"],
        ["member-juan", 3_000_000n, "SHARES"],
      ],
    ]);
  });

  it("rejects non-equal splits that do not add up and records nothing", async () => {
    const { deps, store } = householdLedger();
    const record = createRecordExpense(deps);
    const fortyFifty = {
      method: "PERCENT" as const,
      participants: [
        { memberId: "member-ana", basisPoints: 4_000 },
        { memberId: "member-juan", basisPoints: 5_000 },
      ],
    };
    const shortExact = {
      method: "EXACT" as const,
      participants: [
        { memberId: "member-ana", amount: cop(100_000n) },
        { memberId: "member-juan", amount: cop(120_000n) },
      ],
    };
    const noUnits = {
      method: "SHARES" as const,
      participants: [
        { memberId: "member-ana", units: 0 },
        { memberId: "member-juan", units: 0 },
      ],
    };
    expect(codeOf(await record(groceries(300_000n, { split: fortyFifty })))).toBe("InvalidSplit");
    expect(codeOf(await record(groceries(250_000n, { split: shortExact })))).toBe("SharesDoNotMatchAmount");
    expect(codeOf(await record(groceries(90_000n, { split: noUnits })))).toBe("InvalidSplit");
    expect(store.rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/domain/split.test.ts src/modules/ledger/application/shared-expense.test.ts`
Expected: FAIL — the new cases throw `TypeError: Cannot read properties of undefined (reading 'ok')` (Task 1's `amountsOf` has no branch for `PERCENT`, `EXACT` or `SHARES`); the equal-split tests still pass.

- [ ] **Step 3: Implement**

`src/modules/ledger/domain/split.ts` (replace the whole file):

```ts
import { domainError, err, map, ok, type Money, type Result } from "@/shared/kernel";
import type { Share } from "./transaction";

/**
 * HU-E4-07: EQUAL among chosen members. HU-E4-08: PERCENT in basis points (two decimals, summing to
 * 10000), EXACT amounts per member, or SHARES as positive integer units.
 */
export type SplitInput =
  | { readonly method: "EQUAL"; readonly participants: readonly { readonly memberId: string }[] }
  | {
      readonly method: "PERCENT";
      readonly participants: readonly { readonly memberId: string; readonly basisPoints: number }[];
    }
  | {
      readonly method: "EXACT";
      readonly participants: readonly { readonly memberId: string; readonly amount: Money }[];
    }
  | {
      readonly method: "SHARES";
      readonly participants: readonly { readonly memberId: string; readonly units: number }[];
    };

/** 100 % in basis points. */
const WHOLE = 10_000;

const invalid = (reason: string): Result<never> => err(domainError("InvalidSplit", { reason }));

const allocated = (amount: Money, weights: readonly number[]): Result<bigint[]> =>
  map(amount.allocate(weights), (parts) => parts.map((part) => part.minor));

/** Amounts per participant; `order` lists the participants' request indexes in join order. */
const amountsOf = (amount: Money, split: SplitInput, order: readonly number[]): Result<bigint[]> => {
  switch (split.method) {
    case "EQUAL":
      return allocated(
        amount,
        order.map(() => 1),
      );
    case "PERCENT": {
      const points = order.map((index) => split.participants[index]!.basisPoints);
      if (points.some((p) => !Number.isInteger(p) || p <= 0)) return invalid("percentNotPositive");
      if (points.reduce((a, b) => a + b, 0) !== WHOLE) return invalid("percentNotHundred");
      return allocated(amount, points);
    }
    case "SHARES": {
      const units = order.map((index) => split.participants[index]!.units);
      if (units.some((u) => !Number.isSafeInteger(u) || u <= 0)) return invalid("unitsNotPositive");
      return allocated(amount, units);
    }
    case "EXACT": {
      const parts = order.map((index) => split.participants[index]!.amount);
      const foreign = parts.find((part) => part.currency.code !== amount.currency.code);
      if (foreign !== undefined) {
        return err(
          domainError("CurrencyMismatch", { expected: amount.currency.code, actual: foreign.currency.code }),
        );
      }
      const minors = parts.map((part) => part.minor);
      if (minors.some((minor) => minor <= 0n)) return invalid("shareNotPositive");
      return minors.reduce((a, b) => a + b, 0n) === amount.minor
        ? ok(minors)
        : err(domainError("SharesDoNotMatchAmount"));
    }
  }
};

/**
 * HU-E4-07/08, spec 5.3: the shares of `amount` among the split's participants, who must be current
 * members (`memberIds`, in join order). Shares come back in join order, so the largest-remainder
 * rounding of Money.allocate gives leftover rounding units to the earliest-joined participants
 * whatever order the request used, and the shares always sum to `amount` exactly.
 */
export const splitShares = (
  amount: Money,
  split: SplitInput,
  memberIds: readonly string[],
): Result<Share[]> => {
  const ids = split.participants.map((participant) => participant.memberId);
  if (ids.length === 0) return err(domainError("ParticipantsRequired"));
  if (new Set(ids).size !== ids.length) return invalid("duplicateParticipant");
  if (ids.some((id) => !memberIds.includes(id))) return err(domainError("NotASpaceMember"));
  const order = ids
    .map((_, index) => index)
    .sort((a, b) => memberIds.indexOf(ids[a]!) - memberIds.indexOf(ids[b]!));
  const amounts = amountsOf(amount, split, order);
  if (!amounts.ok) return amounts;
  // shares_amount_positive: an amount too small to give everyone a positive share is rejected.
  if (amounts.value.some((part) => part <= 0n)) return invalid("shareNotPositive");
  return ok(
    order.map((index, position) => ({
      memberId: ids[index]!,
      amount: amounts.value[position]!,
      splitMethod: split.method,
    })),
  );
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/domain/split.ts src/modules/ledger/domain/split.test.ts src/modules/ledger/application/shared-expense.test.ts
git commit -m "feat(ledger): split expenses by percentage, exact amounts or share units (Refs #37)"
```

---

### Task 6: Ledger — expenses paid from the shared fund

Implements HU-E4-10 (issue #39) in the domain and the use case: a payment with `memberId: null` comes from the space's `SHARED_FUND` account, recognised by its type; the fund is the only payer of such an expense (D5); after recording, a fund below zero yields a `FundBalanceNegative` warning carrying the new balance, and the expense is still recorded. Pins Review Focus 3 for fund accounts.

Decisions:
- `fundAccount` (in `checks.ts`, reused by Task 7) answers `AccountNotFound` for an unknown id **or any account of another space** (no existence leak; a personal account sent as the fund of a shared space is therefore `404`), `InvalidFundAccount` (422) for an account of this space that is not a `SHARED_FUND` (in production only possible in a personal space, since shared spaces hold only funds), and `AccountArchived` for an archived fund. A member "paying from the fund" in their own name fails `ownAccount` (`AccountNotOwned`): the fund is nobody's account.
- `MixedFundPayment` (409) is a domain invariant in `checkParts`: an expense with a fund payment has no other payment, so "fund-paid" is a property of the whole expense and balances can exclude it cleanly (D5). Mixed payment is not in the spec; see Self-Review, contradiction 6.
- Spending from the fund is `money.record` (MEMBER or above), like any expense: HU-E4-10's user story is "as a household member". `fund.manage` keeps meaning account management (M2-A).
- The new `accountBalances` port is bound to the accounts module's `GetAccount` in the composition root, so the balance formula (opening balance + movements, HU-E2-04) stays in one place. It runs inside the expense's transaction, so the new payment counts.
- `RecordExpense` now returns `RecordedExpense { expense, warnings }`; the M1 route keeps its response by reading `.expense` (Task 13 adds `warnings` to the wire).
- `LedgerAccount` gains `isSharedFund: boolean`, which the composition root maps from the accounts module's `type === "SHARED_FUND"`, so the ledger keeps no dependency on the accounts module (`container.ts`: "Adapters keep the ledger independent of the accounts and categories modules").
- The fund-balance warning is advisory: two concurrent fund-paid expenses (READ COMMITTED) may each miss the other's payment and skip a warning. No lock is added (Assumption 7).

**Files:**
- Modify: `src/modules/ledger/domain/transaction.ts`, `src/modules/ledger/application/ports.ts`, `src/modules/ledger/application/deps.ts`, `src/modules/ledger/application/checks.ts`, `src/modules/ledger/application/record-expense.ts`, `src/modules/ledger/application/index.ts`, `src/app/api/v1/spaces/[spaceId]/expenses/route.ts`, `src/composition/container.ts`, `tests/support/in-memory-ledger.ts`
- Test: `src/modules/ledger/application/fund-expense.test.ts`, `src/modules/ledger/domain/transaction.test.ts` (modified)

**Interfaces:**
- Consumes: `partyAccount`, `PaymentInput`, `householdLedger` (Task 4); `splitShares` with `PERCENT` (Task 5); `createGetAccount` (M1 accounts).
- Produces:
  - `LedgerAccount.isSharedFund: boolean`
  - `interface AccountBalances { balanceOf(spaceId: string, userId: string, accountId: string): Promise<bigint> }`; `LedgerDeps.accountBalances: AccountBalances`
  - `fundAccount(deps: Pick<LedgerDeps, "accounts">, accountId: string, spaceId: string): Promise<Result<LedgerAccount>>`
  - `PaymentInput.memberId: string | null`
  - `interface LedgerWarning { code: "FundBalanceNegative"; accountId: string; balance: bigint }`; `interface RecordedExpense { expense: Expense; warnings: readonly LedgerWarning[] }`; `RecordExpense = (input: RecordExpenseInput) => Promise<Result<RecordedExpense>>`
  - domain error `MixedFundPayment`
  - `tests/support/in-memory-ledger.ts`: `ACCOUNTS.householdFund` (`acc-household-fund`, opening balance 1,500,000 COP), `ACCOUNTS.oldFund` (archived), `ACCOUNTS.tripFund` (`space-trip`), `ACCOUNTS.ownerlessCash` (a non-fund account of Household with no owner, test double only); every account with `isSharedFund`; `InMemoryTransactions.netOf(accountId: string): bigint`; `ledgerFixture` default `accountBalances` (opening balance + `netOf`).

- [ ] **Step 1: Write the failing tests and the in-memory fund**

In `tests/support/in-memory-ledger.ts`:

1. Replace the block

```ts
export const ACCOUNTS = {
  bancolombia: { id: "acc-bancolombia", spaceId: "space-ana", ownerUserId: "u-ana", archived: false },
  nequi: { id: "acc-nequi", spaceId: "space-ana", ownerUserId: "u-ana", archived: false },
  oldNequi: { id: "acc-old-nequi", spaceId: "space-ana", ownerUserId: "u-ana", archived: true },
  davivienda: { id: "acc-davivienda", spaceId: "space-juan", ownerUserId: "u-juan", archived: false },
} satisfies Record<string, LedgerAccount>;
```

with:

```ts
const personalAccount = (id: string, spaceId: string, ownerUserId: string, archived = false) => ({
  id,
  spaceId,
  ownerUserId,
  isSharedFund: false,
  archived,
});
const sharedFund = (id: string, spaceId: string, archived = false) => ({
  id,
  spaceId,
  ownerUserId: null,
  isSharedFund: true,
  archived,
});

export const ACCOUNTS = {
  bancolombia: personalAccount("acc-bancolombia", "space-ana", "u-ana"),
  nequi: personalAccount("acc-nequi", "space-ana", "u-ana"),
  oldNequi: personalAccount("acc-old-nequi", "space-ana", "u-ana", true),
  davivienda: personalAccount("acc-davivienda", "space-juan", "u-juan"),
  // HU-E4-09/10: shared funds are recognised by their type; their missing owner is incidental.
  householdFund: sharedFund("acc-household-fund", "space-household"),
  oldFund: sharedFund("acc-old-fund", "space-household", true),
  tripFund: sharedFund("acc-trip-fund", "space-trip"),
  // Test double only (accounts_shared_fund_owner forbids it in PostgreSQL): proves funds are found by type.
  ownerlessCash: { id: "acc-ownerless-cash", spaceId: "space-household", ownerUserId: null, isSharedFund: false, archived: false },
} satisfies Record<string, LedgerAccount>;
```

2. Insert before the line `interface CategoryRow {`:

```ts
/** HU-E4-10 Background: Household Fund opens with 1,500,000 COP; every other account opens at 0. */
const OPENING_BALANCES: Readonly<Record<string, bigint>> = { [ACCOUNTS.householdFund.id]: 150_000_000n };

```

3. Insert before the line `  private matching(f: TransactionFilter): Transaction[] {`:

```ts
  /** Net movements of one account over live transactions, like DrizzleLedgerQueries.netMovements. */
  netOf(accountId: string): bigint {
    let net = 0n;
    for (const t of this.rows) {
      if (t.deletedAt !== null) continue;
      if (t.type !== "EXPENSE" && t.destinationAccountId === accountId) net += t.amount;
      if ((t.type === "TRANSFER" || t.type === "SETTLEMENT") && t.sourceAccountId === accountId) net -= t.amount;
      if (t.type === "EXPENSE") {
        for (const payment of t.payments) if (payment.accountId === accountId) net -= payment.amount;
      }
    }
    return net;
  }

```

4. Add after the line `    closedPeriods: { isClosed: async () => false },`:

```ts
    // HU-E2-04 as the accounts module computes it: opening balance plus movements.
    accountBalances: {
      balanceOf: async (_spaceId, _userId, accountId) => (OPENING_BALANCES[accountId] ?? 0n) + store.netOf(accountId),
    },
```

`src/modules/ledger/application/fund-expense.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES, householdLedger } from "../../../../tests/support/in-memory-ledger";
import { createRecordExpense, type RecordExpenseInput } from "./record-expense";

const cop = (pesos: bigint) => money(pesos * 100n);
const fromFund = (accountId: string | null, pesos: bigint) => ({
  payments: [{ memberId: null, accountId, amount: cop(pesos) }],
});
/** HU-E4-10: Ana records rent paid from Household Fund (1,500,000 COP), split 40% / 60%. */
const rent = (pesos: bigint, overrides: Partial<RecordExpenseInput> = {}): RecordExpenseInput => ({
  spaceId: "space-household",
  userId: "u-ana",
  description: "Rent October",
  date: "2026-10-01" as LocalDate,
  categoryId: CATEGORIES.household.id,
  amount: cop(pesos),
  ...fromFund(ACCOUNTS.householdFund.id, pesos),
  split: {
    method: "PERCENT",
    participants: [
      { memberId: "member-ana", basisPoints: 4_000 },
      { memberId: "member-juan", basisPoints: 6_000 },
    ],
  },
  ...overrides,
});

describe("expenses paid from the shared fund (HU-E4-10)", () => {
  it("records rent paid from the fund, split 40/60, without warnings while the fund stays positive", async () => {
    const { deps } = householdLedger();
    const recorded = unwrap(await createRecordExpense(deps)(rent(1_200_000n)));
    expect(recorded.expense.payments).toEqual([
      { memberId: null, accountId: "acc-household-fund", amount: 120_000_000n },
    ]);
    expect(recorded.expense.shares.map((s) => [s.memberId, s.amount])).toEqual([
      ["member-ana", 48_000_000n],
      ["member-juan", 72_000_000n],
    ]);
    expect(recorded.warnings).toEqual([]);
    expect(await deps.accountBalances.balanceOf("space-household", "u-ana", ACCOUNTS.householdFund.id)).toBe(
      30_000_000n,
    );
  });

  it("records an expense that takes the fund below zero and warns with the new balance", async () => {
    const { deps, store } = householdLedger();
    const recorded = unwrap(await createRecordExpense(deps)(rent(2_000_000n)));
    expect(store.rows.map((tx) => tx.id)).toEqual([recorded.expense.id]);
    expect(recorded.warnings).toEqual([
      { code: "FundBalanceNegative", accountId: "acc-household-fund", balance: -50_000_000n },
    ]);
  });

  it("never mixes the fund with member payments (D5)", async () => {
    const { deps, store } = householdLedger();
    const mixed = rent(1_200_000n, {
      payments: [
        { memberId: null, accountId: ACCOUNTS.householdFund.id, amount: cop(1_000_000n) },
        { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: cop(200_000n) },
      ],
    });
    expect(codeOf(await createRecordExpense(deps)(mixed))).toBe("MixedFundPayment");
    expect(store.rows).toEqual([]);
  });

  it("accepts only this space's own shared fund (Review Focus 3)", async () => {
    const { deps, store } = householdLedger();
    const record = createRecordExpense(deps);
    expect(codeOf(await record(rent(100_000n, fromFund(ACCOUNTS.tripFund.id, 100_000n))))).toBe("AccountNotFound");
    expect(codeOf(await record(rent(100_000n, fromFund("not-a-uuid", 100_000n))))).toBe("AccountNotFound");
    expect(codeOf(await record(rent(100_000n, fromFund(ACCOUNTS.oldFund.id, 100_000n))))).toBe("AccountArchived");
    expect(codeOf(await record(rent(100_000n, fromFund(null, 100_000n))))).toBe("AccountRequired");
    // The fund is nobody's account, so a member cannot pay from it in their own name.
    const inAnasName = {
      payments: [{ memberId: "member-ana", accountId: ACCOUNTS.householdFund.id, amount: cop(100_000n) }],
    };
    expect(codeOf(await record(rent(100_000n, inAnasName)))).toBe("AccountNotOwned");
    expect(store.rows).toEqual([]);
  });

  it("recognises a fund by its type, not by its missing owner", async () => {
    const { deps, store } = householdLedger();
    // An ownerless account of Household that is not a SHARED_FUND is still not a fund.
    const ownerless = rent(100_000n, fromFund(ACCOUNTS.ownerlessCash.id, 100_000n));
    expect(codeOf(await createRecordExpense(deps)(ownerless))).toBe("InvalidFundAccount");
    expect(store.rows).toEqual([]);
  });
});
```

Append to `src/modules/ledger/domain/transaction.test.ts`:

```ts

describe("fund-paid expenses (HU-E4-10, D5)", () => {
  const rentOf = (payments: Payment[]) =>
    recordExpense({
      ...common,
      amount: 100n,
      categoryId: "cat-rent",
      payments,
      shares: [{ memberId: "member-ana", amount: 100n, splitMethod: "EQUAL" }],
    });

  it("records an expense paid by the fund alone", () => {
    expect(codeOf(rentOf([{ memberId: null, accountId: "acc-fund", amount: 100n }]))).toBe("ok");
  });

  it("keeps the fund as the only payer of an expense", () => {
    const mixed = rentOf([
      { memberId: null, accountId: "acc-fund", amount: 60n },
      { memberId: "member-ana", accountId: "acc-bancolombia", amount: 40n },
    ]);
    expect(codeOf(mixed)).toBe("MixedFundPayment");
  });
});
```

and in the same file replace the line `  type Expense,` (in the import list from `./transaction`) with:

```ts
  type Expense,
  type Payment,
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/fund-expense.test.ts src/modules/ledger/domain/transaction.test.ts`
Expected: FAIL — every fund payment answers `NotASpaceMember` (a null member id is no member), so `unwrap` throws "expected ok, got NotASpaceMember" and the code assertions see `NotASpaceMember`; the domain mixed-payment test returns `ok` instead of `MixedFundPayment`.

- [ ] **Step 3: Implement**

In `src/modules/ledger/domain/transaction.ts`, add after the line `  if (payments.length === 0) return err(domainError("PaymentsRequired"));`:

```ts
  // D5: a fund-paid expense has the fund as its only payer, so it never mixes with member payments.
  if (payments.length > 1 && payments.some((p) => p.memberId === null)) {
    return err(domainError("MixedFundPayment"));
  }
```

In `src/modules/ledger/application/ports.ts`:

1. Add after the line `  readonly ownerUserId: string | null;`:

```ts
  /** A SHARED_FUND account, recognised by its type (HU-E4-09/10), never by a missing owner. */
  readonly isSharedFund: boolean;
```

2. Insert before the line `export interface LedgerCategory {`:

```ts
/** HU-E4-10: an account's balance (opening balance plus movements) as the requester sees it; bound to the accounts module. */
export interface AccountBalances {
  balanceOf(spaceId: string, userId: string, accountId: string): Promise<bigint>;
}

```

In `src/modules/ledger/application/deps.ts`:

1. Replace the line `  AccountReader,` with:

```ts
  AccountBalances,
  AccountReader,
```

2. Add after the line `  readonly accounts: AccountReader;`:

```ts
  /** HU-E4-10: the fund balance after a fund-paid expense. */
  readonly accountBalances: AccountBalances;
```

Append to `src/modules/ledger/application/checks.ts`:

```ts

/**
 * HU-E4-09/10: the shared fund of the transaction's space, recognised by its type (never by a missing
 * owner). A fund of another space is AccountNotFound, so other spaces' accounts never leak.
 */
export const fundAccount = async (
  deps: Pick<LedgerDeps, "accounts">,
  accountId: string,
  spaceId: string,
): Promise<Result<LedgerAccount>> => {
  const account = await deps.accounts.find(accountId);
  if (account === null || account.spaceId !== spaceId) return err(domainError("AccountNotFound"));
  if (!account.isSharedFund) return err(domainError("InvalidFundAccount"));
  return account.archived ? err(domainError("AccountArchived")) : ok(account);
};
```

`src/modules/ledger/application/record-expense.ts` (replace the whole file):

```ts
import type { SpaceMember, SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, map, ok, todayIn, type LocalDate, type Money, type Result } from "@/shared/kernel";
import { splitShares, type SplitInput } from "../domain/split";
import { positiveAmount, recordExpense, type Expense, type Payment } from "../domain/transaction";
import {
  authorizeWriter,
  fundAccount,
  inSpaceCurrency,
  openPeriod,
  partyAccount,
  usableCategory,
} from "./checks";
import type { LedgerDeps } from "./deps";

/** One requested payment (spec 5.2). */
export interface PaymentInput {
  /** The paying member, registered or guest; null for a payment from the shared fund (HU-E4-10). */
  readonly memberId: string | null;
  /** The payer's own account, the shared fund when `memberId` is null, or null for a guest. */
  readonly accountId: string | null;
  readonly amount: Money;
}

export interface RecordExpenseInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly date?: LocalDate;
  readonly categoryId?: string;
  readonly amount: Money;
  /** HU-E4-01 shorthand: the requester pays the whole amount from this account of theirs. Ignored with `payments`. */
  readonly accountId?: string;
  /** HU-E4-07: who paid, registered members, guests or the shared fund; the v1 UI offers one payer. */
  readonly payments?: readonly PaymentInput[];
  /** HU-E4-07/08: how the amount is shared; EQUAL among every current member when absent (spec 5.3). */
  readonly split?: SplitInput;
}

/** A non-blocking condition of a recorded expense, reported as a code (HU-E4-10). */
export interface LedgerWarning {
  readonly code: "FundBalanceNegative";
  readonly accountId: string;
  /** The account balance after the expense, in minor units. */
  readonly balance: bigint;
}

export interface RecordedExpense {
  readonly expense: Expense;
  readonly warnings: readonly LedgerWarning[];
}

export type RecordExpense = (input: RecordExpenseInput) => Promise<Result<RecordedExpense>>;

/**
 * Spec 5.2: memberId is null only for the shared fund; accountId is null only for a guest. A
 * personal account is debited only by its owner (D9); any member who records money may spend the fund.
 */
const paymentOf = async (
  deps: Pick<LedgerDeps, "accounts">,
  space: SpaceMembership,
  members: readonly SpaceMember[],
  requested: PaymentInput,
): Promise<Result<Payment>> => {
  const currency = inSpaceCurrency(space, requested.amount);
  if (!currency.ok) return currency;
  const { memberId, accountId } = requested;
  const amount = requested.amount.minor;
  if (memberId === null) {
    if (accountId === null) return err(domainError("AccountRequired"));
    return map(await fundAccount(deps, accountId, space.spaceId), (fund) => ({
      memberId: null,
      accountId: fund.id,
      amount,
    }));
  }
  const debit = { required: true, debitedBy: space.userId };
  return map(await partyAccount(deps, members, memberId, accountId, debit), (account) => ({
    memberId,
    accountId: account,
    amount,
  }));
};

/** HU-E4-10: the fund may go negative; the expense is recorded and the response warns. */
const fundWarnings = async (
  deps: Pick<LedgerDeps, "accountBalances">,
  space: SpaceMembership,
  userId: string,
  payments: readonly Payment[],
): Promise<LedgerWarning[]> => {
  const warnings: LedgerWarning[] = [];
  for (const payment of payments) {
    if (payment.memberId !== null || payment.accountId === null) continue;
    const balance = await deps.accountBalances.balanceOf(space.spaceId, userId, payment.accountId);
    if (balance < 0n) warnings.push({ code: "FundBalanceNegative", accountId: payment.accountId, balance });
  }
  return warnings;
};

/**
 * HU-E4-01, HU-E4-07, HU-E4-10: one use case for personal and shared expenses (D2). A personal expense
 * is a shared expense with one participant: the requester pays from `accountId` and, being the only
 * current member of their personal space, takes the whole EQUAL share.
 */
export const createRecordExpense =
  (deps: LedgerDeps): RecordExpense =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeWriter(deps, input.spaceId, input.userId);
      if (!writer.ok) return writer;
      const space = writer.value;
      const amount = positiveAmount(input.amount.minor);
      if (!amount.ok) return amount;
      const currency = inSpaceCurrency(space, input.amount);
      if (!currency.ok) return currency;
      const category = await usableCategory(deps, space.spaceId, input.categoryId);
      if (!category.ok) return category;
      const members = await deps.members.listCurrent(space.spaceId);
      const requested: readonly PaymentInput[] = input.payments ?? [
        { memberId: space.memberId, accountId: input.accountId ?? null, amount: input.amount },
      ];
      // Each member pays at most once per expense; fund payments (no member) are MixedFundPayment's job.
      const payers = requested.flatMap((payment) => (payment.memberId === null ? [] : [payment.memberId]));
      if (new Set(payers).size !== payers.length) {
        return err(domainError("InvalidSplit", { reason: "duplicatePayer" }));
      }
      const payments: Payment[] = [];
      for (const payment of requested) {
        const resolved = await paymentOf(deps, space, members, payment);
        if (!resolved.ok) return resolved;
        payments.push(resolved.value);
      }
      const split: SplitInput = input.split ?? {
        method: "EQUAL",
        participants: members.map((m) => ({ memberId: m.id })),
      };
      const shares = splitShares(
        input.amount,
        split,
        members.map((m) => m.id),
      );
      if (!shares.ok) return shares;
      const date = input.date ?? todayIn(deps.clock, deps.timeZone);
      const open = await openPeriod(deps, space.spaceId, date);
      if (!open.ok) return open;
      const expense = recordExpense({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: amount.value,
        currency: space.currency,
        createdBy: input.userId,
        now: deps.clock.now(),
        categoryId: category.value,
        payments,
        shares: shares.value,
      });
      if (!expense.ok) return expense;
      await deps.transactions.add(expense.value);
      return ok({
        expense: expense.value,
        warnings: await fundWarnings(deps, space, input.userId, expense.value.payments),
      });
    });
```

In `src/modules/ledger/application/index.ts`:

1. Replace the line `  AccountReader,` with:

```ts
  AccountBalances,
  AccountReader,
```

2. Replace the line `  type PaymentInput,` with:

```ts
  type LedgerWarning,
  type PaymentInput,
```

3. Add after the line `  type RecordExpense,`:

```ts
  type RecordedExpense,
```

In `src/app/api/v1/spaces/[spaceId]/expenses/route.ts`, replace the block

```ts
    return result.ok
      ? ok({ status: 201, body: transactionDto(result.value), headers: transactionHeaders(result.value) })
      : result;
```

with:

```ts
    return result.ok
      ? ok({
          status: 201,
          body: transactionDto(result.value.expense),
          headers: transactionHeaders(result.value.expense),
        })
      : result;
```

In `src/composition/container.ts`:

1. Add after the line `              ownerUserId: account.ownerUserId,`:

```ts
              isSharedFund: account.type === "SHARED_FUND",
```

2. Add after the line `  const storedPeriods: StoredPeriodSource = async () => [];`:

```ts
  const getAccount = createGetAccount(accountsDeps);
```

3. Add after the line `    storedPeriods,` (inside `ledgerDeps`):

```ts
    // HU-E4-10: the accounts module owns the balance formula (opening balance + movements, HU-E2-04).
    accountBalances: {
      balanceOf: async (spaceId, userId, accountId) => {
        const account = await getAccount({ spaceId, userId, accountId });
        // The fund was found in this space within the same transaction, so this read succeeds.
        return account.ok ? account.value.balance : 0n;
      },
    },
```

4. Replace the line `      getAccount: createGetAccount(accountsDeps),` with:

```ts
      getAccount,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: PASS (M1 and Task 4/5 tests unchanged: they read `codeOf` and `store.rows`, not the return value).

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (the M1 expense response is unchanged on the wire; the ledger still imports nothing from the accounts module).

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/domain/transaction.ts src/modules/ledger/domain/transaction.test.ts src/modules/ledger/application/ports.ts src/modules/ledger/application/deps.ts src/modules/ledger/application/checks.ts src/modules/ledger/application/record-expense.ts src/modules/ledger/application/index.ts src/modules/ledger/application/fund-expense.test.ts "src/app/api/v1/spaces/[spaceId]/expenses/route.ts" src/composition/container.ts tests/support/in-memory-ledger.ts
git commit -m "feat(ledger): pay expenses from the shared fund with a negative-balance warning (Refs #39)"
```

---

### Task 7: Ledger — RecordFundContribution

Implements HU-E4-09 (issue #38) in the use case: a member (registered from an account their user owns, or a guest from outside the app) contributes to the space's shared fund; the `TRANSFER` belongs to the shared space even though the money leaves a personal account (D9). Pins Review Focus 2 and 3 for contributions.

Decisions:
- The contributor is `memberId`, defaulting to the requester's member, so a member can record a guest's contribution (D15). A registered contributor needs a source account (`AccountRequired`), like a registered payer; a guest never has one (`GuestHasNoAccounts`). The source is a debit, so only its owner records it (D9): Ana recording Juan's contribution from Juan's account is `AccountNotOwned`, and Juan records it himself.
- The destination is checked by `fundAccount` (Task 6): unknown funds and any account of another space (a personal account included) are `AccountNotFound`, a non-fund account of this space is `InvalidFundAccount`, an archived fund is `AccountArchived`.
- `money.record` authorizes it (HU-E4-09: "Viewer cannot contribute" → `InsufficientRole`).
- A contribution creates no debt between members (D5); Task 9 pins that in the balance rule.

**Files:**
- Create: `src/modules/ledger/application/record-fund-contribution.ts`
- Modify: `src/modules/ledger/application/index.ts`
- Test: `src/modules/ledger/application/fund-contribution.test.ts`

**Interfaces:**
- Consumes: `authorizeWriter`, `inSpaceCurrency`, `openPeriod`, `partyAccount` (Task 4); `fundAccount`, `InMemoryTransactions.netOf`, `ACCOUNTS.householdFund`, `ACCOUNTS.oldFund`, `ACCOUNTS.tripFund` (Task 6); `recordFundContribution`, `Transfer` (Task 3); `householdLedger` (Task 4); `ledgerFixture` (M1).
- Produces:
  - `interface RecordFundContributionInput { spaceId: string; userId: string; description?: string; date?: LocalDate; amount: Money; fundAccountId: string; memberId?: string; sourceAccountId?: string | null }`
  - `type RecordFundContribution = (input: RecordFundContributionInput) => Promise<Result<Transfer>>`; `createRecordFundContribution(deps: LedgerDeps): RecordFundContribution` (exported from `@/modules/ledger/application`).

- [ ] **Step 1: Write the failing test**

`src/modules/ledger/application/fund-contribution.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, householdLedger, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import { createRecordFundContribution, type RecordFundContributionInput } from "./record-fund-contribution";

/** HU-E4-09: Ana transfers 480,000 COP from Bancolombia to Household Fund on 2026-10-02. */
const contribution = (overrides: Partial<RecordFundContributionInput> = {}): RecordFundContributionInput => ({
  spaceId: "space-household",
  userId: "u-ana",
  description: "October",
  date: "2026-10-02" as LocalDate,
  amount: money(48_000_000n),
  fundAccountId: ACCOUNTS.householdFund.id,
  sourceAccountId: ACCOUNTS.bancolombia.id,
  ...overrides,
});

describe("RecordFundContribution (HU-E4-09)", () => {
  it("records Ana's contribution from her own account as a TRANSFER into the fund of Household", async () => {
    const { deps, store } = householdLedger();
    expect(unwrap(await createRecordFundContribution(deps)(contribution()))).toMatchObject({
      type: "TRANSFER",
      spaceId: "space-household",
      categoryId: null,
      amount: 48_000_000n,
      sourceAccountId: "acc-bancolombia",
      destinationAccountId: "acc-household-fund",
      payerMemberId: "member-ana",
      createdBy: "u-ana",
    });
    expect(store.netOf(ACCOUNTS.householdFund.id)).toBe(48_000_000n);
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(-48_000_000n);
  });

  it("requires the contributor's own account, debited only by its owner (D9)", async () => {
    const { deps, store } = householdLedger();
    const contribute = createRecordFundContribution(deps);
    expect(codeOf(await contribute(contribution({ sourceAccountId: ACCOUNTS.davivienda.id })))).toBe(
      "AccountNotOwned",
    );
    expect(codeOf(await contribute(contribution({ sourceAccountId: null })))).toBe("AccountRequired");
    // Ana cannot record a contribution that debits Juan's account; Juan records it himself.
    const juans = { memberId: "member-juan", sourceAccountId: ACCOUNTS.davivienda.id };
    expect(codeOf(await contribute(contribution(juans)))).toBe("AccountNotOwned");
    expect(store.rows).toEqual([]);
    expect(codeOf(await contribute(contribution({ ...juans, userId: "u-juan" })))).toBe("ok");
    expect(store.rows).toMatchObject([{ payerMemberId: "member-juan", createdBy: "u-juan" }]);
  });

  it("does not let a viewer contribute", async () => {
    const { deps } = householdLedger();
    expect(codeOf(await createRecordFundContribution(deps)(contribution({ userId: "u-sofi" })))).toBe(
      "InsufficientRole",
    );
  });

  it("records a guest's contribution from outside the app", async () => {
    const { deps } = householdLedger();
    const contribute = createRecordFundContribution(deps);
    const byPedro = contribution({ memberId: "member-pedro", sourceAccountId: null });
    expect(unwrap(await contribute(byPedro))).toMatchObject({
      payerMemberId: "member-pedro",
      sourceAccountId: null,
      createdBy: "u-ana",
    });
    expect(codeOf(await contribute({ ...byPedro, sourceAccountId: ACCOUNTS.bancolombia.id }))).toBe(
      "GuestHasNoAccounts",
    );
  });

  it("accepts only this space's own shared fund (Review Focus 3)", async () => {
    const { deps, store } = householdLedger();
    const contribute = createRecordFundContribution(deps);
    expect(codeOf(await contribute(contribution({ fundAccountId: ACCOUNTS.tripFund.id })))).toBe("AccountNotFound");
    expect(codeOf(await contribute(contribution({ fundAccountId: "not-a-uuid" })))).toBe("AccountNotFound");
    expect(codeOf(await contribute(contribution({ fundAccountId: ACCOUNTS.oldFund.id })))).toBe("AccountArchived");
    expect(store.rows).toEqual([]);
    const personal = ledgerFixture();
    const intoOwnBank = contribution({
      spaceId: "space-ana",
      fundAccountId: ACCOUNTS.bancolombia.id,
      sourceAccountId: ACCOUNTS.nequi.id,
    });
    expect(codeOf(await createRecordFundContribution(personal.deps)(intoOwnBank))).toBe("InvalidFundAccount");
  });

  it("rejects contributors who are not members and non-positive amounts (Review Focus 2)", async () => {
    const { deps } = householdLedger();
    const contribute = createRecordFundContribution(deps);
    expect(codeOf(await contribute(contribution({ memberId: "member-marta" })))).toBe("NotASpaceMember");
    expect(codeOf(await contribute(contribution({ amount: money(0n) })))).toBe("InvalidAmount");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/fund-contribution.test.ts`
Expected: FAIL — `Failed to resolve import "./record-fund-contribution"`.

- [ ] **Step 3: Implement**

`src/modules/ledger/application/record-fund-contribution.ts`:

```ts
import { todayIn, type LocalDate, type Money, type Result } from "@/shared/kernel";
import { positiveAmount, recordFundContribution, type Transfer } from "../domain/transaction";
import { authorizeWriter, fundAccount, inSpaceCurrency, openPeriod, partyAccount } from "./checks";
import type { LedgerDeps } from "./deps";

export interface RecordFundContributionInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly date?: LocalDate;
  readonly amount: Money;
  /** The SHARED_FUND account of this space that receives the money. */
  readonly fundAccountId: string;
  /** The contributing member, registered or guest; the requester when absent. */
  readonly memberId?: string;
  /** The contributor's own account; null or absent only for a guest, who contributes outside the app. */
  readonly sourceAccountId?: string | null;
}

export type RecordFundContribution = (input: RecordFundContributionInput) => Promise<Result<Transfer>>;

/**
 * HU-E4-09: a TRANSFER into the shared fund. It belongs to the fund's shared space even when the money
 * leaves a personal account (D9), and it creates no debt between members (D5).
 */
export const createRecordFundContribution =
  (deps: LedgerDeps): RecordFundContribution =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeWriter(deps, input.spaceId, input.userId);
      if (!writer.ok) return writer;
      const space = writer.value;
      const amount = positiveAmount(input.amount.minor);
      if (!amount.ok) return amount;
      const currency = inSpaceCurrency(space, input.amount);
      if (!currency.ok) return currency;
      const fund = await fundAccount(deps, input.fundAccountId, space.spaceId);
      if (!fund.ok) return fund;
      const contributor = input.memberId ?? space.memberId;
      const members = await deps.members.listCurrent(space.spaceId);
      // D9: the source is a debit, so only its owner records it.
      const source = await partyAccount(deps, members, contributor, input.sourceAccountId ?? null, {
        required: true,
        debitedBy: input.userId,
      });
      if (!source.ok) return source;
      const date = input.date ?? todayIn(deps.clock, deps.timeZone);
      const open = await openPeriod(deps, space.spaceId, date);
      if (!open.ok) return open;
      const contribution = recordFundContribution({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: amount.value,
        currency: space.currency,
        createdBy: input.userId,
        now: deps.clock.now(),
        payerMemberId: contributor,
        sourceAccountId: source.value,
        destinationAccountId: fund.value.id,
      });
      if (!contribution.ok) return contribution;
      await deps.transactions.add(contribution.value);
      return contribution;
    });
```

In `src/modules/ledger/application/index.ts`, add after the line `export { createRecordTransfer, type RecordTransfer, type RecordTransferInput } from "./record-transfer";`:

```ts
export {
  createRecordFundContribution,
  type RecordFundContribution,
  type RecordFundContributionInput,
} from "./record-fund-contribution";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/application/record-fund-contribution.ts src/modules/ledger/application/fund-contribution.test.ts src/modules/ledger/application/index.ts
git commit -m "feat(ledger): record contributions to the shared fund (Refs #38)"
```

---

### Task 8: Ledger — RecordSettlement

Implements HU-E5-02 (issue #44) in the use case: any member with `money.record` records that one current member paid another to clear a balance, optionally between their own accounts; a guest party never has an account. Pins Review Focus 2 and 3 for settlements.

Decisions:
- Both parties go through `partyAccount` with `required: false` (HU-E5-02: "accounts optional and, when set, owned by the respective party; a guest party never has an account"). The source is a debit, so only its owner records it (`debitedBy`, D9: Ana cannot settle Juan's debt from Juan's account); the destination is a credit, so Juan may name Ana's Bancolombia (HU-E5-02 scenario).
- `InvalidSettlementParties` comes from the domain (Task 3), after both parties were found among the current members.
- The settlement has no category and never counts as spending (M1 totals sum only `EXPENSE` and `INCOME`); balances read it in Task 9.

**Files:**
- Create: `src/modules/ledger/application/record-settlement.ts`
- Modify: `src/modules/ledger/application/index.ts`
- Test: `src/modules/ledger/application/record-settlement.test.ts`

**Interfaces:**
- Consumes: `authorizeWriter`, `inSpaceCurrency`, `openPeriod`, `partyAccount` (Task 4); `recordSettlement`, `Settlement` (Task 3); `householdLedger` (Task 4); `InMemoryTransactions.netOf`, `ACCOUNTS.householdFund` (Task 6).
- Produces:
  - `interface RecordSettlementInput { spaceId: string; userId: string; description?: string; date?: LocalDate; amount: Money; payerMemberId: string; receivingMemberId: string; sourceAccountId?: string | null; destinationAccountId?: string | null }`
  - `type RecordSettlement = (input: RecordSettlementInput) => Promise<Result<Settlement>>`; `createRecordSettlement(deps: LedgerDeps): RecordSettlement` (exported from `@/modules/ledger/application`).

- [ ] **Step 1: Write the failing test**

`src/modules/ledger/application/record-settlement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, householdLedger } from "../../../../tests/support/in-memory-ledger";
import { createRecordSettlement, type RecordSettlementInput } from "./record-settlement";

/** HU-E5-02: Juan records a settlement of 1,200,000 COP paid to Ana on 2026-10-30. */
const settle = (overrides: Partial<RecordSettlementInput> = {}): RecordSettlementInput => ({
  spaceId: "space-household",
  userId: "u-juan",
  date: "2026-10-30" as LocalDate,
  amount: money(120_000_000n),
  payerMemberId: "member-juan",
  receivingMemberId: "member-ana",
  ...overrides,
});

describe("RecordSettlement (HU-E5-02)", () => {
  it("records Juan's settlement to Ana as a SETTLEMENT without a category", async () => {
    const { deps, store } = householdLedger();
    const recorded = unwrap(await createRecordSettlement(deps)(settle()));
    expect(recorded).toMatchObject({
      type: "SETTLEMENT",
      spaceId: "space-household",
      date: "2026-10-30",
      amount: 120_000_000n,
      categoryId: null,
      payerMemberId: "member-juan",
      receivingMemberId: "member-ana",
      sourceAccountId: null,
      destinationAccountId: null,
      createdBy: "u-juan",
    });
    expect(store.rows.map((tx) => tx.id)).toEqual([recorded.id]);
  });

  it("moves money from Juan's own account into Ana's when Juan records it (D9)", async () => {
    const { deps, store } = householdLedger();
    const withAccounts = settle({
      sourceAccountId: ACCOUNTS.davivienda.id,
      destinationAccountId: ACCOUNTS.bancolombia.id,
    });
    expect(codeOf(await createRecordSettlement(deps)(withAccounts))).toBe("ok");
    expect([store.netOf(ACCOUNTS.davivienda.id), store.netOf(ACCOUNTS.bancolombia.id)]).toEqual([
      -120_000_000n,
      120_000_000n,
    ]);
  });

  it("rejects a member settling with themselves (Review Focus 2)", async () => {
    const { deps, store } = householdLedger();
    expect(codeOf(await createRecordSettlement(deps)(settle({ receivingMemberId: "member-juan" })))).toBe(
      "InvalidSettlementParties",
    );
    expect(store.rows).toEqual([]);
  });

  it("lets a member record a settlement paid by a guest, who has no account", async () => {
    const { deps } = householdLedger();
    const record = createRecordSettlement(deps);
    const byPedro = settle({ userId: "u-ana", payerMemberId: "member-pedro", amount: money(10_000_000n) });
    expect(unwrap(await record(byPedro))).toMatchObject({
      payerMemberId: "member-pedro",
      receivingMemberId: "member-ana",
      sourceAccountId: null,
      createdBy: "u-ana",
    });
    expect(codeOf(await record({ ...byPedro, sourceAccountId: ACCOUNTS.bancolombia.id }))).toBe(
      "GuestHasNoAccounts",
    );
  });

  it("accepts only accounts owned by the respective party (Review Focus 3)", async () => {
    const { deps, store } = householdLedger();
    const record = createRecordSettlement(deps);
    expect(codeOf(await record(settle({ sourceAccountId: ACCOUNTS.bancolombia.id })))).toBe("AccountNotOwned");
    expect(codeOf(await record(settle({ destinationAccountId: ACCOUNTS.davivienda.id })))).toBe("AccountNotOwned");
    expect(codeOf(await record(settle({ destinationAccountId: ACCOUNTS.householdFund.id })))).toBe(
      "AccountNotOwned",
    );
    expect(codeOf(await record(settle({ sourceAccountId: "not-a-uuid" })))).toBe("AccountNotFound");
    // D9: Ana cannot record a settlement that debits Juan's account (crediting Ana's own is allowed above).
    const fromJuans = settle({ userId: "u-ana", sourceAccountId: ACCOUNTS.davivienda.id });
    expect(codeOf(await record(fromJuans))).toBe("AccountNotOwned");
    expect(store.rows).toEqual([]);
  });

  it("requires current members, a positive amount and a role that records money", async () => {
    const { deps } = householdLedger();
    const record = createRecordSettlement(deps);
    expect(codeOf(await record(settle({ payerMemberId: "member-marta" })))).toBe("NotASpaceMember");
    expect(codeOf(await record(settle({ receivingMemberId: "not-a-uuid" })))).toBe("NotASpaceMember");
    expect(codeOf(await record(settle({ amount: money(0n) })))).toBe("InvalidAmount");
    expect(codeOf(await record(settle({ userId: "u-sofi" })))).toBe("InsufficientRole");
    expect(codeOf(await record(settle({ userId: "u-marta" })))).toBe("SpaceNotFound");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/record-settlement.test.ts`
Expected: FAIL — `Failed to resolve import "./record-settlement"`.

- [ ] **Step 3: Implement**

`src/modules/ledger/application/record-settlement.ts`:

```ts
import { todayIn, type LocalDate, type Money, type Result } from "@/shared/kernel";
import { positiveAmount, recordSettlement, type Settlement } from "../domain/transaction";
import { authorizeWriter, inSpaceCurrency, openPeriod, partyAccount } from "./checks";
import type { LedgerDeps } from "./deps";

export interface RecordSettlementInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly date?: LocalDate;
  readonly amount: Money;
  /** The member who paid, registered or guest. */
  readonly payerMemberId: string;
  /** The member who received the money. */
  readonly receivingMemberId: string;
  /** Optional: the payer's own account; never for a guest. */
  readonly sourceAccountId?: string | null;
  /** Optional: the receiving member's own account; never for a guest. */
  readonly destinationAccountId?: string | null;
}

export type RecordSettlement = (input: RecordSettlementInput) => Promise<Result<Settlement>>;

/** HU-E5-02: any member who records money may record a settlement, also on a guest's behalf (D15). */
export const createRecordSettlement =
  (deps: LedgerDeps): RecordSettlement =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeWriter(deps, input.spaceId, input.userId);
      if (!writer.ok) return writer;
      const space = writer.value;
      const amount = positiveAmount(input.amount.minor);
      if (!amount.ok) return amount;
      const currency = inSpaceCurrency(space, input.amount);
      if (!currency.ok) return currency;
      const members = await deps.members.listCurrent(space.spaceId);
      // D9: the payer's account is debited, so only its owner records it; the receiver's is credited.
      const source = await partyAccount(
        deps,
        members,
        input.payerMemberId,
        input.sourceAccountId ?? null,
        { required: false, debitedBy: input.userId },
      );
      if (!source.ok) return source;
      const destination = await partyAccount(
        deps,
        members,
        input.receivingMemberId,
        input.destinationAccountId ?? null,
        { required: false },
      );
      if (!destination.ok) return destination;
      const date = input.date ?? todayIn(deps.clock, deps.timeZone);
      const open = await openPeriod(deps, space.spaceId, date);
      if (!open.ok) return open;
      const settlement = recordSettlement({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: amount.value,
        currency: space.currency,
        createdBy: input.userId,
        now: deps.clock.now(),
        payerMemberId: input.payerMemberId,
        receivingMemberId: input.receivingMemberId,
        sourceAccountId: source.value,
        destinationAccountId: destination.value,
      });
      if (!settlement.ok) return settlement;
      await deps.transactions.add(settlement.value);
      return settlement;
    });
```

In `src/modules/ledger/application/index.ts`, add after the line `} from "./record-fund-contribution";`:

```ts
export {
  createRecordSettlement,
  type RecordSettlement,
  type RecordSettlementInput,
} from "./record-settlement";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/application/record-settlement.ts src/modules/ledger/application/record-settlement.test.ts src/modules/ledger/application/index.ts
git commit -m "feat(ledger): record settlements between members, guests included (Refs #44)"
```

---

### Task 9: Balances — the balance rule and GetSpaceBalances

Implements HU-E5-01 (issue #43) as a new `balances` read-model module (spec 5.1): a pure domain service applies the E5 balance rule `net(m) = paid − consumed + settled out − settled in` to per-member totals, and `GetSpaceBalances` returns one net balance per current member in join order. The totals come through a `BalanceSource` port; here its in-memory twin (on `InMemoryTransactions`) carries the rule's filters, and Task 10 adds the SQL adapter verified against it. Pins Review Focus 5 at the domain and use-case level.

Decisions:
- The rule's filters live in the source (live rows of the space; expenses only when every payment has a member, D5; settlements by payer and payee; transfers, contributions included, never count); the arithmetic and the member list live in the domain, so a member with no movements shows 0 and Σ net is 0 by construction.
- The response lists **net per member** only. "Who owes whom" for two members is the pair of nets (Juan −150,000, Ana +150,000); pairwise debts for larger groups and the fewest payments to clear them are HU-E5-03's `DebtSimplifier`, moved to a later plan (see Self-Review).
- Members the totals mention who are no longer current are appended (sorted by id) so the balances still sum to zero once HU-E1-08 lets members leave; no such member exists yet.
- `space.read` authorizes it: every role, viewers included (HU-E1-05 "Sofi views balances").
- The ledger publishes the totals shape as `MemberMoneyTotals` (its own port type); the balances module declares the structurally identical `MemberTotals` it consumes; the composition root binds one to the other (Task 14), so neither module imports the other.

**Files:**
- Create: `src/modules/balances/domain/balances.ts`, `src/modules/balances/application/get-space-balances.ts`, `src/modules/balances/application/index.ts`
- Modify: `src/modules/ledger/application/ports.ts`, `src/modules/ledger/application/index.ts`, `tests/support/in-memory-ledger.ts`
- Test: `src/modules/balances/domain/balances.test.ts`, `src/modules/balances/application/get-space-balances.test.ts`

**Interfaces:**
- Consumes: `authorizeSpaceAction`, `SpaceAccess`, `SpaceMemberRepository`, `createSpaceAccess` (`@/modules/spaces/application`); `InMemoryTransactions`, `anExpense`, `aTransfer`, `ACCOUNTS.householdFund` (Tasks 3, 6); `Settlement` (Task 3); `householdSpace`, `InMemorySpaceStore`, `memberOf` (`tests/support/in-memory-spaces.ts`).
- Produces:
  - `interface MemberTotals { memberId: string; paid: bigint; consumed: bigint; settledOut: bigint; settledIn: bigint }`, `interface MemberBalance { memberId: string; net: bigint }`, `netOf(t: MemberTotals): bigint`, `netBalances(memberIds: readonly string[], totals: readonly MemberTotals[]): MemberBalance[]`
  - `interface BalanceSource { memberTotals(spaceId: string): Promise<readonly MemberTotals[]> }`, `interface BalancesDeps { access: SpaceAccess; members: Pick<SpaceMemberRepository, "listCurrent">; source: BalanceSource }`, `interface SpaceBalances { spaceId: string; currency: string; members: readonly MemberBalance[] }`, `type GetSpaceBalances = (input: { spaceId: string; userId: string }) => Promise<Result<SpaceBalances>>`, `createGetSpaceBalances(deps: BalancesDeps): GetSpaceBalances` (all from `@/modules/balances/application`)
  - ledger: `interface MemberMoneyTotals` (same fields as `MemberTotals`), exported from `@/modules/ledger/application`
  - `tests/support/in-memory-ledger.ts`: `InMemoryTransactions.memberTotals(spaceId: string): Promise<MemberMoneyTotals[]>` (sorted by member id); `aSettlement(date: string, amount: bigint, overrides?: Partial<Settlement>): Settlement` (Household, Juan → Ana, no accounts).

- [ ] **Step 1: Write the failing tests and the in-memory twin's test helpers**

In `tests/support/in-memory-ledger.ts`:

1. Replace the line `  LedgerDeps,` (in the type import list from `@/modules/ledger/application`) with:

```ts
  LedgerDeps,
  MemberMoneyTotals,
  Settlement,
```

2. Append to the end of the file:

```ts

export const aSettlement = (date: string, amount: bigint, overrides: Partial<Settlement> = {}): Settlement => ({
  ...baseOf(date, amount),
  spaceId: "space-household",
  type: "SETTLEMENT",
  categoryId: null,
  payerMemberId: "member-juan",
  receivingMemberId: "member-ana",
  sourceAccountId: null,
  destinationAccountId: null,
  ...overrides,
});
```

`src/modules/balances/domain/balances.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { netBalances, netOf, type MemberTotals } from "./balances";

const totals = (memberId: string, paid: bigint, consumed: bigint, settledOut = 0n, settledIn = 0n): MemberTotals => ({
  memberId,
  paid,
  consumed,
  settledOut,
  settledIn,
});

describe("balance rule (E5)", () => {
  it("nets payments and settlements paid against shares consumed and settlements received", () => {
    expect(netOf(totals("member-ana", 300n, 150n, 20n, 50n))).toBe(120n);
  });

  it("lists every current member in join order, with 0 when nothing moved their balance", () => {
    const balances = netBalances(
      ["member-ana", "member-juan", "member-pedro"],
      [totals("member-juan", 0n, 150n), totals("member-ana", 300n, 150n)],
    );
    expect(balances).toEqual([
      { memberId: "member-ana", net: 150n },
      { memberId: "member-juan", net: -150n },
      { memberId: "member-pedro", net: 0n },
    ]);
  });

  it("keeps members the totals mention who are no longer current, so the balances still sum to zero", () => {
    const balances = netBalances(["member-ana"], [totals("member-ana", 300n, 150n), totals("member-zed", 0n, 150n)]);
    expect(balances).toEqual([
      { memberId: "member-ana", net: 150n },
      { memberId: "member-zed", net: -150n },
    ]);
    expect(balances.reduce((sum, b) => sum + b.net, 0n)).toBe(0n);
  });
});
```

`src/modules/balances/application/get-space-balances.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Expense } from "@/modules/ledger/application";
import { createSpaceAccess } from "@/modules/spaces/application";
import { Money } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import {
  ACCOUNTS,
  anExpense,
  aSettlement,
  aTransfer,
  InMemoryTransactions,
} from "../../../../tests/support/in-memory-ledger";
import { householdSpace, InMemorySpaceStore, memberOf } from "../../../../tests/support/in-memory-spaces";
import { createGetSpaceBalances, type GetSpaceBalances } from "./get-space-balances";

const ANA = memberOf("Ana", "OWNER", 0);
const JUAN = memberOf("Juan", "MEMBER", 1);
const pesos = (n: bigint) => n * 100n;

/** An expense of Household paid in full by `payer` (null: the shared fund), split equally among `participants`. */
const paid = (
  payer: string | null,
  amount: bigint,
  participants: readonly string[],
  overrides: Partial<Expense> = {},
): Expense => {
  const parts = unwrap(unwrap(Money.ofMinor(amount, "COP")).allocate(participants.map(() => 1)));
  return anExpense("2026-10-05", amount, {
    spaceId: "space-household",
    payments: [{ memberId: payer, accountId: payer === null ? ACCOUNTS.householdFund.id : null, amount }],
    shares: participants.map((memberId, index) => ({
      memberId,
      amount: parts[index]!.minor,
      splitMethod: "EQUAL" as const,
    })),
    ...overrides,
  });
};

/** HU-E5-01 Background: "Household" with Ana and Juan unless other members are given. */
const world = (members = [ANA, JUAN]) => {
  const spaces = new InMemorySpaceStore();
  spaces.seed(householdSpace(members));
  const ledger = new InMemoryTransactions();
  const getBalances = createGetSpaceBalances({ access: createSpaceAccess(spaces), members: spaces, source: ledger });
  return { ledger, getBalances };
};

const netsOf = async (getBalances: GetSpaceBalances, userId = "u-ana") =>
  unwrap(await getBalances({ spaceId: "space-household", userId })).members.map(
    (balance) => [balance.memberId, balance.net] as const,
  );

describe("GetSpaceBalances (HU-E5-01)", () => {
  it("turns one equal split into a debt from Juan to Ana, in the space currency", async () => {
    const { ledger, getBalances } = world();
    await ledger.add(paid("member-ana", pesos(300_000n), ["member-ana", "member-juan"]));
    expect(unwrap(await getBalances({ spaceId: "space-household", userId: "u-juan" }))).toEqual({
      spaceId: "space-household",
      currency: "COP",
      members: [
        { memberId: "member-ana", net: pesos(150_000n) },
        { memberId: "member-juan", net: -pesos(150_000n) },
      ],
    });
  });

  it("nets debts out across expenses", async () => {
    const { ledger, getBalances } = world();
    await ledger.add(paid("member-ana", pesos(300_000n), ["member-ana", "member-juan"]));
    await ledger.add(paid("member-juan", pesos(100_000n), ["member-ana", "member-juan"]));
    expect(await netsOf(getBalances)).toEqual([
      ["member-ana", pesos(100_000n)],
      ["member-juan", -pesos(100_000n)],
    ]);
  });

  it("ignores fund-paid expenses and fund contributions (D5, Review Focus 5)", async () => {
    const { ledger, getBalances } = world();
    await ledger.add(paid("member-ana", pesos(300_000n), ["member-ana", "member-juan"]));
    await ledger.add(paid(null, pesos(1_200_000n), ["member-ana", "member-juan"]));
    await ledger.add(
      aTransfer("2026-10-02", pesos(480_000n), {
        spaceId: "space-household",
        destinationAccountId: ACCOUNTS.householdFund.id,
        payerMemberId: "member-ana",
      }),
    );
    expect(await netsOf(getBalances)).toEqual([
      ["member-ana", pesos(150_000n)],
      ["member-juan", -pesos(150_000n)],
    ]);
  });

  it("excludes soft-deleted expenses and settlements (Review Focus 5)", async () => {
    const { ledger, getBalances } = world();
    const deletedAt = new Date("2026-10-06T00:00:00Z");
    await ledger.add(paid("member-ana", pesos(300_000n), ["member-ana", "member-juan"], { deletedAt }));
    await ledger.add(aSettlement("2026-10-30", pesos(150_000n), { deletedAt }));
    expect(await netsOf(getBalances)).toEqual([
      ["member-ana", 0n],
      ["member-juan", 0n],
    ]);
  });

  it("raises the payer's balance and lowers the receiver's with each settlement", async () => {
    const { ledger, getBalances } = world();
    await ledger.add(paid("member-ana", pesos(2_400_000n), ["member-ana", "member-juan"]));
    await ledger.add(aSettlement("2026-10-30", pesos(500_000n)));
    expect(await netsOf(getBalances)).toEqual([
      ["member-ana", pesos(700_000n)],
      ["member-juan", -pesos(700_000n)],
    ]);
    await ledger.add(aSettlement("2026-10-31", pesos(800_000n)));
    expect(await netsOf(getBalances)).toEqual([
      ["member-ana", -pesos(100_000n)],
      ["member-juan", pesos(100_000n)],
    ]);
  });

  it("includes guests and always sums to zero (Review Focus 5)", async () => {
    const { ledger, getBalances } = world([ANA, JUAN, memberOf("Pedro", null, 2)]);
    const everyone = ["member-ana", "member-juan", "member-pedro"];
    await ledger.add(paid("member-pedro", pesos(90_000n), everyone));
    // 100,000 among three: Ana 33,334, Juan 33,333, Pedro 33,333.
    await ledger.add(paid("member-ana", pesos(100_000n), everyone));
    const nets = await netsOf(getBalances);
    expect(nets).toEqual([
      ["member-ana", pesos(36_666n)],
      ["member-juan", -pesos(63_333n)],
      ["member-pedro", pesos(26_667n)],
    ]);
    expect(nets.reduce((sum, [, net]) => sum + net, 0n)).toBe(0n);
  });

  it("lets every member read, viewers included, and hides the space from non-members", async () => {
    const { getBalances } = world([ANA, JUAN, memberOf("Sofi", "VIEWER", 2)]);
    expect(codeOf(await getBalances({ spaceId: "space-household", userId: "u-sofi" }))).toBe("ok");
    expect(codeOf(await getBalances({ spaceId: "space-household", userId: "u-marta" }))).toBe("SpaceNotFound");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/balances`
Expected: FAIL — `Failed to resolve import "./balances"` and `Failed to resolve import "./get-space-balances"`.

- [ ] **Step 3: Implement**

`src/modules/balances/domain/balances.ts`:

```ts
/** Per-member sums over the live transactions of one space that move balances (E5 balance rule). */
export interface MemberTotals {
  readonly memberId: string;
  /** Σ payments by the member on member-paid expenses. */
  readonly paid: bigint;
  /** Σ shares of the member on member-paid expenses. */
  readonly consumed: bigint;
  /** Σ settlements the member paid. */
  readonly settledOut: bigint;
  /** Σ settlements the member received. */
  readonly settledIn: bigint;
}

export interface MemberBalance {
  readonly memberId: string;
  /** Positive: the member is owed money; negative: the member owes. */
  readonly net: bigint;
}

/** E5 balance rule: net(m) = Σ payments − Σ shares + settlements paid − settlements received. */
export const netOf = (totals: MemberTotals): bigint =>
  totals.paid - totals.consumed + totals.settledOut - totals.settledIn;

/**
 * HU-E5-01: one balance per current member in join order (0 when nothing moved it), then anyone else
 * the totals mention, by id, so the balances of a space always sum to zero.
 */
export const netBalances = (
  memberIds: readonly string[],
  totals: readonly MemberTotals[],
): MemberBalance[] => {
  const byMember = new Map(totals.map((t) => [t.memberId, netOf(t)]));
  const others = [...byMember.keys()].filter((id) => !memberIds.includes(id)).sort();
  return [...memberIds, ...others].map((memberId) => ({ memberId, net: byMember.get(memberId) ?? 0n }));
};
```

`src/modules/balances/application/get-space-balances.ts`:

```ts
import { authorizeSpaceAction, type SpaceAccess, type SpaceMemberRepository } from "@/modules/spaces/application";
import { ok, type Result } from "@/shared/kernel";
import { netBalances, type MemberBalance, type MemberTotals } from "../domain/balances";

/** Per-member totals of one space's live ledger (E5 balance rule); bound to the ledger by the composition root. */
export interface BalanceSource {
  memberTotals(spaceId: string): Promise<readonly MemberTotals[]>;
}

export interface BalancesDeps {
  readonly access: SpaceAccess;
  readonly members: Pick<SpaceMemberRepository, "listCurrent">;
  readonly source: BalanceSource;
}

export interface SpaceBalances {
  readonly spaceId: string;
  readonly currency: string;
  /** Current members in join order, guests included; the nets sum to zero. */
  readonly members: readonly MemberBalance[];
}

export type GetSpaceBalances = (input: { spaceId: string; userId: string }) => Promise<Result<SpaceBalances>>;

/** HU-E5-01: who owes whom, computed on read (D7); any member may read, non-members get SpaceNotFound. */
export const createGetSpaceBalances =
  (deps: BalancesDeps): GetSpaceBalances =>
  async ({ spaceId, userId }) => {
    const reader = await authorizeSpaceAction(deps.access, spaceId, userId, "space.read");
    if (!reader.ok) return reader;
    const space = reader.value;
    const members = await deps.members.listCurrent(space.spaceId);
    const totals = await deps.source.memberTotals(space.spaceId);
    return ok({
      spaceId: space.spaceId,
      currency: space.currency,
      members: netBalances(
        members.map((m) => m.id),
        totals,
      ),
    });
  };
```

`src/modules/balances/application/index.ts`:

```ts
export type { MemberBalance, MemberTotals } from "../domain/balances";
export {
  createGetSpaceBalances,
  type BalancesDeps,
  type BalanceSource,
  type GetSpaceBalances,
  type SpaceBalances,
} from "./get-space-balances";
```

Append to `src/modules/ledger/application/ports.ts`:

```ts

/**
 * HU-E5-01 (E5 balance rule): per-member sums of one space's live, member-paid expenses and its
 * settlements. Fund-paid expenses and every transfer, fund contributions included, create no debt (D5).
 */
export interface MemberMoneyTotals {
  readonly memberId: string;
  readonly paid: bigint;
  readonly consumed: bigint;
  readonly settledOut: bigint;
  readonly settledIn: bigint;
}
```

In `src/modules/ledger/application/index.ts`, replace the line `  LedgerCategory,` with:

```ts
  LedgerCategory,
  MemberMoneyTotals,
```

In `tests/support/in-memory-ledger.ts`, insert before the line `  private matching(f: TransactionFilter): Transaction[] {`:

```ts
  /** The in-memory twin of DrizzleLedgerQueries.memberTotals (E5 balance rule); Task 10 pins them together. */
  async memberTotals(spaceId: string): Promise<MemberMoneyTotals[]> {
    type Field = "paid" | "consumed" | "settledOut" | "settledIn";
    const totals = new Map<string, Record<Field, bigint>>();
    const add = (memberId: string, field: Field, amount: bigint) => {
      const sums = totals.get(memberId) ?? { paid: 0n, consumed: 0n, settledOut: 0n, settledIn: 0n };
      sums[field] += amount;
      totals.set(memberId, sums);
    };
    for (const t of this.rows) {
      if (t.spaceId !== spaceId || t.deletedAt !== null) continue;
      // D5: an expense paid from the shared fund creates no debt.
      if (t.type === "EXPENSE" && t.payments.every((p) => p.memberId !== null)) {
        for (const p of t.payments) if (p.memberId !== null) add(p.memberId, "paid", p.amount);
        for (const s of t.shares) add(s.memberId, "consumed", s.amount);
      }
      if (t.type === "SETTLEMENT") {
        add(t.payerMemberId, "settledOut", t.amount);
        add(t.receivingMemberId, "settledIn", t.amount);
      }
    }
    return [...totals.entries()]
      .map(([memberId, sums]) => ({ memberId, ...sums }))
      .sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0));
  }

```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/balances src/modules/ledger`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (`domain-must-be-pure` holds: `balances.ts` imports nothing; `modules-only-through-public-application-api` holds: balances imports only `@/modules/spaces/application`).

- [ ] **Step 6: Commit**

```bash
git add src/modules/balances src/modules/ledger/application/ports.ts src/modules/ledger/application/index.ts tests/support/in-memory-ledger.ts
git commit -m "feat(balances): compute net balances per member from the ledger (Refs #43)"
```

---

### Task 10: Ledger — SQL member totals verified against the in-memory twin

Implements the SQL aggregate of HU-E5-01 (issue #43): `DrizzleLedgerQueries.memberTotals` sums payments and shares of the live, member-paid expenses and the live settlements of one space in PostgreSQL (D7). Its test stores the **same** fixture transactions in PostgreSQL and in `InMemoryTransactions` and requires both adapters to return the same, explicitly expected totals (HU-E5-01's technical note). Pins Review Focus 5 and the malformed-id guard.

Decisions:
- "Member-paid" is `NOT EXISTS` a payment of that expense with `member_id IS NULL` (the fund), which matches the in-memory `payments.every(p => p.memberId !== null)` because Task 6 forbids mixing the fund with other payers.
- Sums are read as text and parsed as `bigint` (M1's `sumAsText`, widened to any column), so totals never overflow or round.
- The four sums run as **one statement** (`unionAll` of four grouped selects, each tagged with its field), so they come from one snapshot even under READ COMMITTED: an expense committed between two separate queries could otherwise be counted as paid but not as consumed, and Σ net would leave 0.
- The result is sorted by member id in TypeScript, like the twin, so the comparison is order-exact.
- The same fixture also pins the twin's `netOf` (Task 6, used by the use-case tests for account balances) to M1's SQL `netMovements`, so both in-memory read models are checked against PostgreSQL.

**Files:**
- Modify: `src/modules/ledger/infrastructure/drizzle-ledger-queries.ts`
- Test: `src/modules/ledger/infrastructure/drizzle-member-totals.int.test.ts`

**Interfaces:**
- Consumes: `MemberMoneyTotals` (Task 9); `InMemoryTransactions.memberTotals` (Task 9); `InMemoryTransactions.netOf` (Task 6); `DrizzleLedgerQueries.netMovements` (M1); `sharedLedgerFixture` (Task 2); `recordExpense`, `recordFundContribution`, `recordSettlement`, `softDelete` (Tasks 3, M1); `DrizzleTransactionRepository` (M1).
- Produces: `DrizzleLedgerQueries.memberTotals(spaceId: string): Promise<MemberMoneyTotals[]>` (one statement, sorted by member id; `[]` for malformed ids). The class satisfies `BalanceSource` structurally (Task 14 binds it).

- [ ] **Step 1: Write the failing integration test**

`src/modules/ledger/infrastructure/drizzle-member-totals.int.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { Money, type LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { unwrap } from "../../../../tests/support/fakes";
import { sharedLedgerFixture, type SharedLedgerFixture } from "../../../../tests/support/fixtures";
import { InMemoryTransactions } from "../../../../tests/support/in-memory-ledger";
import {
  recordExpense,
  recordFundContribution,
  recordSettlement,
  softDelete,
  type Transaction,
  type TransactionId,
} from "../domain/transaction";
import { DrizzleLedgerQueries } from "./drizzle-ledger-queries";
import { DrizzleTransactionRepository } from "./drizzle-transaction-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleTransactionRepository(tm);
const queries = new DrizzleLedgerQueries(tm);

afterAll(() => pool.end());

const pesos = (n: bigint) => n * 100n;
const base = (w: SharedLedgerFixture, amount: bigint) => ({
  id: randomUUID() as TransactionId,
  spaceId: w.household.spaceId,
  date: "2026-10-05" as LocalDate,
  amount,
  currency: "COP",
  createdBy: w.household.userId,
  now: new Date(),
});
/** An expense of the fixture's Household paid in full by one payer, split equally among `participants`. */
const expense = (
  w: SharedLedgerFixture,
  amount: bigint,
  payer: { memberId: string | null; accountId: string | null },
  participants: readonly string[],
) => {
  const parts = unwrap(unwrap(Money.ofMinor(amount, "COP")).allocate(participants.map(() => 1)));
  return unwrap(
    recordExpense({
      ...base(w, amount),
      categoryId: w.groceries,
      payments: [{ ...payer, amount }],
      shares: participants.map((memberId, index) => ({
        memberId,
        amount: parts[index]!.minor,
        splitMethod: "EQUAL" as const,
      })),
    }),
  );
};
/** Stores the same transactions in PostgreSQL and in the in-memory twin. */
const storeInBoth = async (memory: InMemoryTransactions, ...txs: Transaction[]) => {
  for (const tx of txs) {
    await repo.add(tx);
    await memory.add(tx);
  }
};

describe("member totals for balances (HU-E5-01)", () => {
  it("match the in-memory adapter on the same fixtures, member totals and account movements alike (Review Focus 5)", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const ana = w.household.memberId;
    const pedro = w.pedro;
    const memory = new InMemoryTransactions();
    await storeInBoth(
      memory,
      expense(w, pesos(300_000n), { memberId: ana, accountId: w.bank }, [ana, pedro]),
      expense(w, pesos(100_000n), { memberId: pedro, accountId: null }, [ana, pedro]),
      // D5: a fund-paid expense and a fund contribution create no debt.
      expense(w, pesos(1_200_000n), { memberId: null, accountId: w.fund }, [ana, pedro]),
      unwrap(
        recordFundContribution({
          ...base(w, pesos(480_000n)),
          payerMemberId: ana,
          sourceAccountId: w.bank,
          destinationAccountId: w.fund,
        }),
      ),
      unwrap(
        recordSettlement({
          ...base(w, pesos(50_000n)),
          payerMemberId: pedro,
          receivingMemberId: ana,
          sourceAccountId: null,
          destinationAccountId: null,
        }),
      ),
      softDelete(expense(w, pesos(999n), { memberId: ana, accountId: w.bank }, [ana, pedro]), new Date()),
    );
    const expected = [
      { memberId: ana, paid: pesos(300_000n), consumed: pesos(200_000n), settledOut: 0n, settledIn: pesos(50_000n) },
      { memberId: pedro, paid: pesos(100_000n), consumed: pesos(200_000n), settledOut: pesos(50_000n), settledIn: 0n },
    ].sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
    expect(await queries.memberTotals(w.household.spaceId)).toEqual(expected);
    expect(await memory.memberTotals(w.household.spaceId)).toEqual(expected);
    // Bank: −300,000 expense − 480,000 contribution; fund: −1,200,000 rent + 480,000 contribution.
    const movements = [pesos(-780_000n), pesos(-720_000n)];
    const net = await queries.netMovements([w.bank, w.fund], null);
    expect([net.get(w.bank), net.get(w.fund)]).toEqual(movements);
    expect([memory.netOf(w.bank), memory.netOf(w.fund)]).toEqual(movements);
  });

  it("ignores other spaces and returns nothing for malformed ids", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const other = await sharedLedgerFixture(db, pool);
    await repo.add(
      expense(other, pesos(10_000n), { memberId: other.household.memberId, accountId: other.bank }, [
        other.household.memberId,
        other.pedro,
      ]),
    );
    expect(await queries.memberTotals(w.household.spaceId)).toEqual([]);
    expect(await queries.memberTotals("not-a-uuid")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project integration src/modules/ledger/infrastructure/drizzle-member-totals.int.test.ts`
Expected: FAIL — `queries.memberTotals is not a function`.

- [ ] **Step 3: Implement**

In `src/modules/ledger/infrastructure/drizzle-ledger-queries.ts`:

1. Replace the line `import { and, between, desc, eq, exists, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";` with:

```ts
import {
  and,
  between,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  or,
  sql,
  type AnyColumn,
} from "drizzle-orm";
import { alias, unionAll } from "drizzle-orm/pg-core";
```

2. Replace the line `import type { TransactionFilter, TransactionPosition, TransactionQuery } from "../application/ports";` with:

```ts
import type {
  MemberMoneyTotals,
  TransactionFilter,
  TransactionPosition,
  TransactionQuery,
} from "../application/ports";
```

3. Replace the two lines

```ts
const sumAsText = (column: typeof transactions.amount | typeof payments.amount) =>
  sql<string>`sum(${column})::text`;
```

with:

```ts
const sumAsText = (column: AnyColumn) => sql<string>`sum(${column})::text`;
```

4. Insert before the line `  private matching(f: TransactionFilter) {`:

```ts
  /**
   * HU-E5-01, E5 balance rule: per-member sums over the live transactions of one space. Expenses count
   * only when members paid them (a fund-paid expense creates no debt, D5); transfers, fund contributions
   * included, never count. One statement, so every sum comes from the same snapshot and Σ net stays 0
   * under concurrent writes. Sorted by member id; `[]` for malformed ids.
   */
  async memberTotals(spaceId: string): Promise<MemberMoneyTotals[]> {
    if (!isUuid(spaceId)) return [];
    const db = this.tm.executor();
    type Field = "paid" | "consumed" | "settledOut" | "settledIn";
    // Same selection shape in every branch of the UNION ALL: member, field label, sum as text.
    const memberOf = (column: AnyColumn) => sql<string | null>`${column}`;
    const fundPayments = alias(payments, "fund_payments");
    const live = and(eq(transactions.spaceId, spaceId), isNull(transactions.deletedAt));
    const memberPaid = and(
      live,
      eq(transactions.type, "EXPENSE"),
      notExists(
        db
          .select({ one: sql`1` })
          .from(fundPayments)
          .where(and(eq(fundPayments.transactionId, transactions.id), isNull(fundPayments.memberId))),
      ),
    );
    const settlements = and(live, eq(transactions.type, "SETTLEMENT"));
    const rows = await unionAll(
      db
        .select({
          memberId: memberOf(payments.memberId),
          field: sql<Field>`'paid'::text`,
          total: sumAsText(payments.amount),
        })
        .from(payments)
        .innerJoin(transactions, eq(transactions.id, payments.transactionId))
        .where(memberPaid)
        .groupBy(payments.memberId),
      db
        .select({
          memberId: memberOf(shares.memberId),
          field: sql<Field>`'consumed'::text`,
          total: sumAsText(shares.amount),
        })
        .from(shares)
        .innerJoin(transactions, eq(transactions.id, shares.transactionId))
        .where(memberPaid)
        .groupBy(shares.memberId),
      db
        .select({
          memberId: memberOf(transactions.payerMemberId),
          field: sql<Field>`'settledOut'::text`,
          total: sumAsText(transactions.amount),
        })
        .from(transactions)
        .where(settlements)
        .groupBy(transactions.payerMemberId),
      db
        .select({
          memberId: memberOf(transactions.receivingMemberId),
          field: sql<Field>`'settledIn'::text`,
          total: sumAsText(transactions.amount),
        })
        .from(transactions)
        .where(settlements)
        .groupBy(transactions.receivingMemberId),
    );
    const totals = new Map<string, Record<Field, bigint>>();
    for (const row of rows) {
      if (row.memberId === null) continue;
      const sums = totals.get(row.memberId) ?? { paid: 0n, consumed: 0n, settledOut: 0n, settledIn: 0n };
      sums[row.field] += BigInt(row.total);
      totals.set(row.memberId, sums);
    }
    return [...totals.entries()]
      .map(([memberId, sums]) => ({ memberId, ...sums }))
      .sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0));
  }

```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project integration src/modules/ledger`
Expected: PASS (the new file and the unchanged M1 query tests, which still use `sumAsText` for incoming, outgoing and paid amounts). If `tsc` rejects the `unionAll` branches as differently shaped, the cause is a selection field that is not wrapped in `sql<…>`: every branch must select exactly `{ memberId: SQL<string | null>, field: SQL<Field>, total: SQL<string> }`.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/infrastructure/drizzle-ledger-queries.ts src/modules/ledger/infrastructure/drizzle-member-totals.int.test.ts
git commit -m "feat(ledger): aggregate member totals for balances in SQL (Refs #43)"
```

---

### Task 11: HTTP — shared expenses with payers, guests and equal splits

Exposes HU-E4-07 (issue #36) on the existing `POST /api/v1/spaces/{spaceId}/expenses`: the body accepts `payments[]` and an `EQUAL` `split` besides M1's `accountId` shorthand. Makes HU-E4-05's "Filter by member in a shared space" scenario testable (deferred by M1 until shared spaces existed). Pins Review Focus 1 and 2 over HTTP.

Decisions:
- Non-breaking body change: `accountId` becomes optional and `payments` / `split` are added; a body with both `accountId` and `payments` is `422 ValidationFailed`. A personal-space client that sends M1's body gets the same response as before.
- A payment is `{ "memberId": "<member id>", "accountId": "<the payer's own account>" | null, "amount": Money }`; a guest omits `accountId` or sends `null`. A split is `{ "method": "EQUAL", "participants": [{ "memberId": "…" }] }` (Task 12 adds the other methods); omitting `split` shares the amount equally among every current member (spec 5.3).
- Member ids in bodies are matched against the current members in memory, so a malformed or foreign id is `422 NotASpaceMember` (spec 8), never a `500`.
- Codes ending in `Required` are validation failures like M1's `CategoryRequired`: `AccountRequired`, `PaymentsRequired` and `ParticipantsRequired` map to `422` explicitly in `problem.ts`. `SharesDoNotMatchAmount` (M1) and `GuestHasNoAccounts` (like M2-A's `GuestHasNoRole`) stay `409` by the convention; `InvalidSplit` is `422` by its prefix.
- The M1 acceptance helpers (`cop`, `inSpace`, `newAccount`, `categoryWithKey`, `post`, `balanceOf`, `MoneyDto`, `TransactionDto`) move verbatim from `tests/acceptance/ledger.test.ts` to `tests/support/ledger.ts`, joined by the household builders this and the next tasks reuse, instead of copying them into every new file.
- Size: ~650 lines in three commits (see Execution Workflow): commit **11-0** = Steps 1–4 (pure test refactor), commit **11a** = Steps 5–10, commit **11b** = Steps 11–15.
- Body parsing lives in the contract: `expenseFromBody` here, `fundContributionFromBody` (Task 15) and `settlementFromBody` (Task 16) follow the same convention, so every money route is "validate body → `…FromBody` → use case".

**Files:**
- Create: `tests/support/ledger.ts`, `tests/acceptance/shared-expenses.test.ts`
- Modify: `tests/acceptance/ledger.test.ts`, `src/modules/ledger/contracts/ledger.contract.ts`, `src/app/api/v1/spaces/[spaceId]/expenses/route.ts`, `src/shared/http/problem.ts`, `src/shared/http/problem.test.ts`, `openapi/openapi.snapshot.json`

**Interfaces:**
- Consumes: `RecordExpenseInput`, `PaymentInput`, `RecordedExpense` (Tasks 4, 6); `SplitInput` (Task 5); `moneyFromDto`, `optionalLocalDate` (`src/shared/http/contracts.ts`); `call`, `problemOf`, `registerUser`, `startTestApp`, `RouteHandler`, `TestUser` (`tests/support/app.ts`); `actingIn`, `joinAs`, `newSharedSpace` (`tests/support/spaces.ts`); the accounts, categories, guests, members and transactions routes (M1, M2-A).
- Produces:
  - `PaymentBodySchema`, `SplitBodySchema` (EQUAL only until Task 12), `RecordExpenseBodySchema` (with `accountId?`, `payments?`, `split?`), `expenseFromBody(body): Result<Omit<RecordExpenseInput, "spaceId" | "userId">>`
  - `problem.ts`: `AccountRequired`, `PaymentsRequired`, `ParticipantsRequired` → 422
  - `tests/support/ledger.ts`: `MoneyDto`, `TransactionDto` (with `payerMemberId`), `cop(pesos: number): MoneyDto`, `inSpace(user, resource)`, `newAccount(user, name, pesos, type?): Promise<string>`, `categoryWithKey(user, key): Promise<string>`, `post(handler, user, resource, body, headers?, spaceOf?)`, `balanceOf(user, accountId): Promise<MoneyDto>`, `memberIdOf(viewer, spaceId, displayName): Promise<string>`, `interface HouseholdMember extends TestUser { memberId; personal: TestUser; account }`, `interface Household { spaceId; groceries; ana: HouseholdMember; juan: HouseholdMember }`, `household(): Promise<Household>`, `joinHousehold(h, name, role): Promise<HouseholdMember>`, `addGuest(h, name): Promise<string>`.

- [ ] **Step 1: Move the money helpers (11-0)**

`tests/support/ledger.ts`:

```ts
import { POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { GET as getAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route";
import { GET as listCategories } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { POST as addGuestMember } from "@/app/api/v1/spaces/[spaceId]/guests/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { call, registerUser, type RouteHandler, type TestUser } from "./app";
import { actingIn, joinAs, newSharedSpace } from "./spaces";

export interface MoneyDto {
  amount: string;
  currency: string;
}
export interface TransactionDto {
  id: string;
  type: string;
  description: string;
  date: string;
  amount: MoneyDto;
  categoryId: string | null;
  payments: { memberId: string | null; accountId: string | null; amount: MoneyDto }[];
  shares: { memberId: string; amount: MoneyDto; splitMethod: string }[];
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  receivingMemberId: string | null;
  payerMemberId: string | null;
  createdBy: string;
  version: number;
}

/** Whole pesos on the wire: COP has two minor digits. */
export const cop = (pesos: number): MoneyDto => ({ amount: String(pesos * 100), currency: "COP" });
export const inSpace = (user: TestUser, resource: string) => `/api/v1/spaces/${user.spaceId}/${resource}`;

/** Creates an account in `user.spaceId` (a BANK account unless `type` says otherwise); returns its id. */
export const newAccount = async (user: TestUser, name: string, pesos: number, type = "BANK"): Promise<string> => {
  const response = await call(createAccount, "POST", inSpace(user, "accounts"), {
    user,
    params: { spaceId: user.spaceId },
    body: { name, type, openingBalance: cop(pesos) },
  });
  if (response.status !== 201) throw new Error(`account creation failed with status ${response.status}`);
  return ((await response.json()) as { id: string }).id;
};

/** The seeded category of `user.spaceId` with the catalog `key`. */
export const categoryWithKey = async (user: TestUser, key: string): Promise<string> => {
  const response = await call(listCategories, "GET", inSpace(user, "categories"), {
    user,
    params: { spaceId: user.spaceId },
  });
  const { items } = (await response.json()) as {
    items: { categories: { id: string; key: string | null }[] }[];
  };
  return items.flatMap((g) => g.categories).find((c) => c.key === key)!.id;
};

/** POSTs `body` to `resource` of `spaceOf`'s space as `user`. */
export const post = (
  handler: RouteHandler,
  user: TestUser,
  resource: string,
  body: unknown,
  headers: Record<string, string> = {},
  spaceOf: TestUser = user,
) =>
  call(handler, "POST", inSpace(spaceOf, resource), {
    user,
    params: { spaceId: spaceOf.spaceId },
    body,
    headers,
  });

/** The computed balance of an account of `user.spaceId`. */
export const balanceOf = async (user: TestUser, accountId: string): Promise<MoneyDto> => {
  const response = await call(getAccount, "GET", inSpace(user, `accounts/${accountId}`), {
    user,
    params: { spaceId: user.spaceId, accountId },
  });
  return ((await response.json()) as { balance: MoneyDto }).balance;
};

/** The member id of `displayName` in `spaceId`, as `viewer` sees the member list. */
export const memberIdOf = async (viewer: TestUser, spaceId: string, displayName: string): Promise<string> => {
  const response = await call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, {
    user: viewer,
    params: { spaceId },
  });
  const { items } = (await response.json()) as { items: { id: string; displayName: string }[] };
  const member = items.find((m) => m.displayName === displayName);
  if (!member) throw new Error(`no member named ${displayName}`);
  return member.id;
};

/** A registered household member: acting in the household, with their personal space and account. */
export interface HouseholdMember extends TestUser {
  readonly memberId: string;
  /** The same user acting in their personal space. */
  readonly personal: TestUser;
  /** Their personal BANK account, opened with 2,000,000 COP. */
  readonly account: string;
}

export interface Household {
  readonly spaceId: string;
  /** The seeded "groceries" category of the household. */
  readonly groceries: string;
  /** OWNER, with "Bancolombia". */
  readonly ana: HouseholdMember;
  /** MEMBER, with "Davivienda". */
  readonly juan: HouseholdMember;
}

const memberIn = async (
  user: TestUser,
  spaceId: string,
  name: string,
  accountName: string,
): Promise<HouseholdMember> => ({
  ...actingIn(user, spaceId),
  personal: user,
  memberId: await memberIdOf(user, spaceId, name),
  account: await newAccount(user, accountName, 2_000_000),
});

/** HU-E4-07 Background: "Household" with OWNER Ana (Bancolombia) and MEMBER Juan (Davivienda), 2,000,000 COP each. */
export const household = async (): Promise<Household> => {
  const ana = await registerUser("Ana");
  const juan = await registerUser("Juan");
  const spaceId = await newSharedSpace(ana);
  await joinAs(ana, spaceId, juan, "MEMBER");
  return {
    spaceId,
    groceries: await categoryWithKey(actingIn(ana, spaceId), "groceries"),
    ana: await memberIn(ana, spaceId, "Ana", "Bancolombia"),
    juan: await memberIn(juan, spaceId, "Juan", "Davivienda"),
  };
};

/** Another registered member (Luis, Sofi, …) joins the household with `role` and a 2,000,000 COP account. */
export const joinHousehold = async (
  h: Household,
  name: string,
  role: "ADMIN" | "MEMBER" | "VIEWER",
): Promise<HouseholdMember> => {
  const user = await registerUser(name);
  await joinAs(h.ana, h.spaceId, user, role);
  return memberIn(user, h.spaceId, name, `${name} bank`);
};

/** Ana adds the guest `name` to the household; returns the guest's member id. */
export const addGuest = async (h: Household, name: string): Promise<string> => {
  const response = await call(addGuestMember, "POST", `/api/v1/spaces/${h.spaceId}/guests`, {
    user: h.ana,
    params: { spaceId: h.spaceId },
    body: { displayName: name },
  });
  if (response.status !== 201) throw new Error(`guest creation failed with status ${response.status}`);
  return ((await response.json()) as { id: string }).id;
};
```

In `tests/acceptance/ledger.test.ts`, replace everything from the first line of the file through the line `const recorded = async (response: Promise<Response>) => (await (await response).json()) as TransactionDto;` with:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import { PATCH as updateSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import {
  DELETE as deleteTransaction,
  GET as getTransaction,
  PATCH as editTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { GET as transactionAudit } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/audit/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type RouteHandler, type TestUser } from "../support/app";
import {
  balanceOf,
  categoryWithKey,
  cop,
  inSpace,
  newAccount,
  post,
  type MoneyDto,
  type TransactionDto,
} from "../support/ledger";

interface LedgerUser extends TestUser {
  bancolombia: string;
  nequi: string;
  groceries: string;
  salary: string;
}

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** A signed-up user with Bancolombia (2,000,000 COP), Nequi (0 COP) and the seeded categories. */
const ledgerUser = async (name: string): Promise<LedgerUser> => {
  const user = await registerUser(name);
  return {
    ...user,
    bancolombia: await newAccount(user, "Bancolombia", 2_000_000),
    nequi: await newAccount(user, "Nequi", 0),
    groceries: await categoryWithKey(user, "groceries"),
    salary: await categoryWithKey(user, "salary"),
  };
};

const market = (user: LedgerUser, pesos = 85_000, date = "2026-10-05") => ({
  description: "Market",
  amount: cop(pesos),
  date,
  categoryId: user.groceries,
  accountId: user.bancolombia,
});

const recorded = async (response: Promise<Response>) => (await (await response).json()) as TransactionDto;
```

- [ ] **Step 2: Run the moved tests (11-0)**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/ledger.test.ts`
Expected: PASS — the helpers only moved (the household builders are exported but not used yet; this is a refactor with no new behaviour, so there is no red step).

- [ ] **Step 3: Gates (11-0)**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0; the OpenAPI snapshot is unchanged.

- [ ] **Step 4: Commit (11-0)**

```bash
git add tests/support/ledger.ts tests/acceptance/ledger.test.ts
git commit -m "test(ledger): share the acceptance money helpers and household builders (Refs #36)"
```

- [ ] **Step 5: Write the failing acceptance test (11a)**

`tests/acceptance/shared-expenses.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { startTestApp, type TestUser } from "../support/app";
import {
  addGuest,
  balanceOf,
  cop,
  household,
  joinHousehold,
  post,
  type Household,
  type HouseholdMember,
  type TransactionDto,
} from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const equal = (...memberIds: string[]) => ({
  method: "EQUAL",
  participants: memberIds.map((memberId) => ({ memberId })),
});
/** An expense of `pesos` in Household paid in full by `payer` from their own account. */
const paidBy = (h: Household, payer: HouseholdMember, pesos: number, extra: Record<string, unknown> = {}) => ({
  description: "Groceries",
  date: "2026-10-05",
  categoryId: h.groceries,
  amount: cop(pesos),
  payments: [{ memberId: payer.memberId, accountId: payer.account, amount: cop(pesos) }],
  ...extra,
});
const sharesOf = (tx: TransactionDto) => tx.shares.map((s) => [s.memberId, s.amount, s.splitMethod]);
const recordedBy = async (user: TestUser, body: unknown): Promise<TransactionDto> => {
  const response = await post(recordExpense, user, "expenses", body);
  expect(response.status).toBe(201);
  return (await response.json()) as TransactionDto;
};

describe("shared expense split equally (HU-E4-07)", () => {
  it("records Ana's payment and equal shares for Ana and Juan (@critical)", async () => {
    const h = await household();
    const tx = await recordedBy(h.ana, paidBy(h, h.ana, 300_000, { split: equal(h.ana.memberId, h.juan.memberId) }));
    expect(tx.payments).toEqual([{ memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(300_000) }]);
    expect(sharesOf(tx)).toEqual([
      [h.ana.memberId, cop(150_000), "EQUAL"],
      [h.juan.memberId, cop(150_000), "EQUAL"],
    ]);
    // D9: the shared expense leaves Ana's personal account.
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(cop(1_700_000));
  });

  it("gives the remainder peso to the earliest-joined member, whatever the request order (Review Focus 1)", async () => {
    const h = await household();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    const split = equal(luis.memberId, h.juan.memberId, h.ana.memberId);
    const tx = await recordedBy(h.ana, paidBy(h, h.ana, 100_000, { split }));
    expect(sharesOf(tx)).toEqual([
      [h.ana.memberId, cop(33_334), "EQUAL"],
      [h.juan.memberId, cop(33_333), "EQUAL"],
      [luis.memberId, cop(33_333), "EQUAL"],
    ]);
  });

  it("lets the payer stay out of the split", async () => {
    const h = await household();
    const tx = await recordedBy(h.ana, paidBy(h, h.ana, 80_000, { split: equal(h.juan.memberId) }));
    expect(sharesOf(tx)).toEqual([[h.juan.memberId, cop(80_000), "EQUAL"]]);
  });

  it("records a taxi paid by the guest Pedro outside the app", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    const tx = await recordedBy(h.ana, {
      description: "Taxi",
      date: "2026-10-05",
      categoryId: h.groceries,
      amount: cop(90_000),
      payments: [{ memberId: pedro, accountId: null, amount: cop(90_000) }],
      split: equal(h.ana.memberId, h.juan.memberId, pedro),
    });
    expect(tx.payments).toEqual([{ memberId: pedro, accountId: null, amount: cop(90_000) }]);
    expect(sharesOf(tx)).toEqual([
      [h.ana.memberId, cop(30_000), "EQUAL"],
      [h.juan.memberId, cop(30_000), "EQUAL"],
      [pedro, cop(30_000), "EQUAL"],
    ]);
    expect(tx.createdBy).toBe(h.ana.userId);
  });

  it("shares equally among every current member when the split is omitted (spec 5.3)", async () => {
    const h = await household();
    const tx = await recordedBy(h.ana, paidBy(h, h.ana, 300_000));
    expect(sharesOf(tx)).toEqual([
      [h.ana.memberId, cop(150_000), "EQUAL"],
      [h.juan.memberId, cop(150_000), "EQUAL"],
    ]);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/shared-expenses.test.ts`
Expected: FAIL — every expense answers `422` instead of `201` (M1's body requires `accountId`, so `payments` is a `ValidationFailed`).

- [ ] **Step 7: Contract and route**

In `src/modules/ledger/contracts/ledger.contract.ts`:

1. Replace the line `  MoneySchema,` (in the import list from `@/shared/http/contracts`) with:

```ts
  moneyFromDto,
  MoneySchema,
  optionalLocalDate,
```

2. Replace the line `import type { AuditEntry, Transaction, TransactionPage, TransactionPosition } from "../application";` with:

```ts
import type {
  AuditEntry,
  PaymentInput,
  RecordExpenseInput,
  SplitInput,
  Transaction,
  TransactionPage,
  TransactionPosition,
} from "../application";
```

3. Replace the block

```ts
/** M1 shape (HU-E4-01): one payment by the requester from `accountId`. HU-E4-07 adds payments[] and split. */
export const RecordExpenseBodySchema = z.object({
  description: Description,
  date: z.iso.date().optional(),
  categoryId: Id.optional(),
  amount: MoneySchema,
  accountId: Id,
});
```

with:

```ts
/** Payers and participants per expense: bounds the payload; membership is checked by the domain. */
const MAX_PARTS = 100;

/**
 * HU-E4-07: one payment by a member of the space (registered or guest). `accountId` is that member's
 * own account, or null (or absent) for a guest, who pays outside the app (spec 5.2).
 */
export const PaymentBodySchema = z.object({
  memberId: Id,
  accountId: Id.nullable().optional(),
  amount: MoneySchema,
});

/** HU-E4-07: EQUAL among the chosen members. */
export const SplitBodySchema = z.object({
  method: z.literal("EQUAL"),
  participants: z.array(z.object({ memberId: Id })).max(MAX_PARTS),
});

/**
 * HU-E4-01 sends `accountId` (the requester pays everything from that account of theirs); HU-E4-07
 * sends `payments` instead. Without `split` the amount is shared EQUAL among every current member
 * (spec 5.3), which in a personal space is the requester alone.
 */
export const RecordExpenseBodySchema = z
  .object({
    description: Description,
    date: z.iso.date().optional(),
    categoryId: Id.optional(),
    amount: MoneySchema,
    accountId: Id.optional(),
    payments: z.array(PaymentBodySchema).max(MAX_PARTS).optional(),
    split: SplitBodySchema.optional(),
  })
  .refine((body) => body.accountId === undefined || body.payments === undefined, {
    error: "Send accountId or payments, not both",
    path: ["payments"],
  });
type RecordExpenseBody = z.infer<typeof RecordExpenseBodySchema>;

/** The split as the use case takes it. */
const splitFromBody = (split: RecordExpenseBody["split"]): Result<SplitInput | undefined> =>
  ok(
    split === undefined
      ? undefined
      : { method: "EQUAL" as const, participants: split.participants.map((p) => ({ memberId: p.memberId })) },
  );

/** A validated body as RecordExpense input; fails only for impossible dates and currencies the kernel does not know. */
export const expenseFromBody = (
  body: RecordExpenseBody,
): Result<Omit<RecordExpenseInput, "spaceId" | "userId">> => {
  const amount = moneyFromDto(body.amount);
  if (!amount.ok) return amount;
  const date = optionalLocalDate(body.date);
  if (!date.ok) return date;
  let payments: PaymentInput[] | undefined;
  if (body.payments !== undefined) {
    payments = [];
    for (const payment of body.payments) {
      const paid = moneyFromDto(payment.amount);
      if (!paid.ok) return paid;
      payments.push({ memberId: payment.memberId, accountId: payment.accountId ?? null, amount: paid.value });
    }
  }
  const split = splitFromBody(body.split);
  if (!split.ok) return split;
  return ok({
    description: body.description,
    date: date.value,
    categoryId: body.categoryId,
    amount: amount.value,
    accountId: body.accountId,
    payments,
    split: split.value,
  });
};
```

4. Replace everything from the line `  "/api/v1/spaces/{spaceId}/expenses": recording(` up to, but not including, the line `  "/api/v1/spaces/{spaceId}/incomes": recording(` with:

```ts
  "/api/v1/spaces/{spaceId}/expenses": recording(
    "recordExpense",
    "Record an expense paid by members (registered or guest) and shared among members",
    RecordExpenseBodySchema,
    {
      "404": "SpaceNotFound, CategoryNotFound, AccountNotFound",
      "409":
        "AccountArchived, CategoryArchived, PeriodClosed, IdempotencyKeyConflict, SharesDoNotMatchAmount, GuestHasNoAccounts",
      "422": `${invalidMoney}, CategoryRequired, AccountNotOwned, AccountRequired, PaymentsRequired, ParticipantsRequired, NotASpaceMember, InvalidSplit`,
    },
  ),
```

`src/app/api/v1/spaces/[spaceId]/expenses/route.ts` (replace the whole file):

```ts
import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  expenseFromBody,
  RecordExpenseBodySchema,
  transactionDto,
  transactionHeaders,
} from "@/modules/ledger/contracts/ledger.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: RecordExpenseBodySchema,
  before: withIdempotency,
  handler: async ({ user, params, body }) => {
    const fields = expenseFromBody(body);
    if (!fields.ok) return fields;
    const result = await getContainer().ledger.recordExpense({
      spaceId: params.spaceId!,
      userId: user!.id,
      ...fields.value,
    });
    return result.ok
      ? ok({
          status: 201,
          body: transactionDto(result.value.expense),
          headers: transactionHeaders(result.value.expense),
        })
      : result;
  },
});
```

- [ ] **Step 8: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance`
Expected: PASS (every acceptance file, M1's personal expenses included).

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: only `POST /api/v1/spaces/{spaceId}/expenses` changes (optional `accountId`, `payments`, `split`, new summary and error lists); components are unchanged.

- [ ] **Step 9: Gates (11a)**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 10: Commit (11a)**

```bash
git add tests/acceptance/shared-expenses.test.ts src/modules/ledger/contracts/ledger.contract.ts "src/app/api/v1/spaces/[spaceId]/expenses/route.ts" openapi/openapi.snapshot.json
git commit -m "feat(ledger): accept payers and equal splits on the expenses endpoint (Refs #36)"
```

- [ ] **Step 11: Write the failing rule tests (11b)**

In `src/shared/http/problem.test.ts`, add after the line `    ["CategoryRequired", 422],`:

```ts
    ["AccountRequired", 422],
    ["PaymentsRequired", 422],
    ["ParticipantsRequired", 422],
    ["InvalidSplit", 422],
    ["SharesDoNotMatchAmount", 409],
    ["GuestHasNoAccounts", 409],
```

In `tests/acceptance/shared-expenses.test.ts`:

1. Add after the line `import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";`:

```ts
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
```

2. Replace the line `import { startTestApp, type TestUser } from "../support/app";` with:

```ts
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { actingIn } from "../support/spaces";
```

3. Replace the line `  joinHousehold,` (in the import list from `../support/ledger`) with:

```ts
  joinHousehold,
  memberIdOf,
```

4. Append to the end of the file:

```ts

describe("shared expense rules (HU-E4-07, Review Focus 2)", () => {
  it("answers invalid payers and participants with stable codes and leaves Ana's account untouched", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    const marta = await registerUser("Marta");
    const martasMember = await memberIdOf(marta, marta.spaceId, "Marta");
    const both = equal(h.ana.memberId, h.juan.memberId);
    const juanPays = (accountId: string | undefined, pesos = 80_000) => [
      { memberId: h.juan.memberId, accountId, amount: cop(pesos) },
    ];
    const cases: [unknown, number, string][] = [
      [paidBy(h, h.ana, 80_000, { split: equal(h.ana.memberId, martasMember) }), 422, "NotASpaceMember"],
      [paidBy(h, h.ana, 80_000, { split: equal("not-a-uuid") }), 422, "NotASpaceMember"],
      [paidBy(h, h.ana, 80_000, { split: equal() }), 422, "ParticipantsRequired"],
      [paidBy(h, h.ana, 80_000, { split: equal(h.ana.memberId, h.ana.memberId) }), 422, "InvalidSplit"],
      [paidBy(h, h.ana, 80_000, { split: both, payments: [] }), 422, "PaymentsRequired"],
      [paidBy(h, h.ana, 80_000, { split: both, payments: juanPays(h.ana.account) }), 422, "AccountNotOwned"],
      // D9: Ana cannot spend from Juan's own account either; Juan records his own payment (last test).
      [paidBy(h, h.ana, 80_000, { split: both, payments: juanPays(h.juan.account) }), 422, "AccountNotOwned"],
      [paidBy(h, h.ana, 80_000, { split: both, payments: juanPays(undefined) }), 422, "AccountRequired"],
      [
        paidBy(h, h.ana, 80_000, {
          split: both,
          payments: [
            { memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(40_000) },
            { memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(40_000) },
          ],
        }),
        422,
        "InvalidSplit",
      ],
      [
        paidBy(h, h.ana, 80_000, {
          split: both,
          payments: [{ memberId: pedro, accountId: h.ana.account, amount: cop(80_000) }],
        }),
        409,
        "GuestHasNoAccounts",
      ],
      [
        paidBy(h, h.ana, 80_000, {
          split: both,
          payments: [{ memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(70_000) }],
        }),
        409,
        "SharesDoNotMatchAmount",
      ],
      [paidBy(h, h.ana, 80_000, { split: both, accountId: h.ana.account }), 422, "ValidationFailed"],
    ];
    for (const [body, status, code] of cases) {
      expect(await problemOf(await post(recordExpense, h.ana, "expenses", body))).toEqual([status, code]);
    }
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(cop(2_000_000));
  });

  it("lets members record for guests, but not viewers, and hides the space from non-members", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    const marta = await registerUser("Marta");
    const byPedro = {
      description: "Taxi",
      date: "2026-10-05",
      categoryId: h.groceries,
      amount: cop(90_000),
      payments: [{ memberId: pedro, accountId: null, amount: cop(90_000) }],
      split: equal(luis.memberId, pedro),
    };
    expect((await post(recordExpense, luis, "expenses", byPedro)).status).toBe(201);
    expect(await problemOf(await post(recordExpense, sofi, "expenses", byPedro))).toEqual([403, "InsufficientRole"]);
    expect(await problemOf(await post(recordExpense, actingIn(marta, h.spaceId), "expenses", byPedro))).toEqual([
      404,
      "SpaceNotFound",
    ]);
  });

  it("lets Juan record his own payment and filters the household's transactions by payer (HU-E4-05)", async () => {
    const h = await household();
    const split = equal(h.ana.memberId, h.juan.memberId);
    await recordedBy(h.ana, paidBy(h, h.ana, 300_000, { split }));
    const juans = await recordedBy(h.juan, paidBy(h, h.juan, 100_000, { split }));
    const path = `/api/v1/spaces/${h.spaceId}/transactions?period=2026-10&payerMemberId=${h.juan.memberId}`;
    const response = await call(listTransactions, "GET", path, { user: h.ana, params: { spaceId: h.spaceId } });
    const { items } = (await response.json()) as { items: TransactionDto[] };
    expect(items.map((t) => t.id)).toEqual([juans.id]);
  });
});
```

- [ ] **Step 12: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/shared/http/problem.test.ts && pnpm exec vitest run --project acceptance tests/acceptance/shared-expenses.test.ts`
Expected: FAIL — `statusForCode` maps `AccountRequired`, `PaymentsRequired` and `ParticipantsRequired` to `409`, so those three `problem.test.ts` rows fail and the acceptance table stops at its first `409` (`ParticipantsRequired`); every other new row and case (the `AccountNotOwned` and duplicate-payer cases included, Tasks 4 and 6) already passes.

- [ ] **Step 13: Map the codes**

In `src/shared/http/problem.ts`, add after the line `  ["CategoryRequired", 422],`:

```ts
  ["AccountRequired", 422],
  ["PaymentsRequired", 422],
  ["ParticipantsRequired", 422],
```

- [ ] **Step 14: Run the tests and the gates (11b)**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (the OpenAPI snapshot is unchanged: status descriptions already list the codes under `422`).

- [ ] **Step 15: Commit (11b)**

```bash
git add src/shared/http/problem.ts src/shared/http/problem.test.ts tests/acceptance/shared-expenses.test.ts
git commit -m "feat(ledger): answer invalid payers and participants with stable codes over HTTP (Refs #36)"
```

---

### Task 12: HTTP — percentage, exact and share-unit splits

Exposes HU-E4-08 (issue #37): `split.method` accepts `PERCENT` (`"percent": "40"` or `"33.33"`), `EXACT` (`"amount": Money`) and `SHARES` (`"units": 2`). Pins Review Focus 1 for two-decimal percentages over HTTP.

Decisions:
- Percentages travel as decimal strings with at most two decimals (no floats on the wire, like money) and become basis points in the contract (`basisPointsOf`); a malformed percentage is `422 ValidationFailed`, a sum other than 100 is `422 InvalidSplit` from the domain.
- `units` must be a JSON integer (`ValidationFailed` otherwise); positivity is the domain's `InvalidSplit`.
- The split is a discriminated union on `method`, so the OpenAPI document shows each method's participant shape.

**Files:**
- Modify: `src/modules/ledger/contracts/ledger.contract.ts`, `openapi/openapi.snapshot.json`
- Test: `tests/acceptance/shared-expenses.test.ts` (modified)

**Interfaces:**
- Consumes: `SplitInput` with every method (Task 5); `SplitBodySchema`, `splitFromBody`, `MAX_PARTS`, `Id` (Task 11); `household`, `joinHousehold`, `paidBy`, `recordedBy`, `sharesOf` (Task 11).
- Produces: `SplitBodySchema` as `z.discriminatedUnion("method", [EQUAL, PERCENT, EXACT, SHARES])`; `basisPointsOf(percent: string): number`.

- [ ] **Step 1: Write the failing acceptance test**

Append to `tests/acceptance/shared-expenses.test.ts`:

```ts

describe("non-equal splits (HU-E4-08)", () => {
  const byAna = (h: Household, pesos: number, split: unknown) => paidBy(h, h.ana, pesos, { split });

  it("splits by percentage, exact amounts and share units", async () => {
    const h = await household();
    const [ana, juan] = [h.ana.memberId, h.juan.memberId];
    const percent = await recordedBy(
      h.ana,
      byAna(h, 300_000, {
        method: "PERCENT",
        participants: [
          { memberId: ana, percent: "40" },
          { memberId: juan, percent: "60" },
        ],
      }),
    );
    expect(sharesOf(percent)).toEqual([
      [ana, cop(120_000), "PERCENT"],
      [juan, cop(180_000), "PERCENT"],
    ]);
    const exact = await recordedBy(
      h.ana,
      byAna(h, 250_000, {
        method: "EXACT",
        participants: [
          { memberId: ana, amount: cop(100_000) },
          { memberId: juan, amount: cop(150_000) },
        ],
      }),
    );
    expect(sharesOf(exact)).toEqual([
      [ana, cop(100_000), "EXACT"],
      [juan, cop(150_000), "EXACT"],
    ]);
    const units = await recordedBy(
      h.ana,
      byAna(h, 90_000, {
        method: "SHARES",
        participants: [
          { memberId: ana, units: 2 },
          { memberId: juan, units: 1 },
        ],
      }),
    );
    expect(sharesOf(units)).toEqual([
      [ana, cop(60_000), "SHARES"],
      [juan, cop(30_000), "SHARES"],
    ]);
  });

  it("accepts percentages with two decimals and still sums exactly (Review Focus 1)", async () => {
    const h = await household();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    const tx = await recordedBy(
      h.ana,
      byAna(h, 100_000, {
        method: "PERCENT",
        participants: [
          { memberId: h.ana.memberId, percent: "33.33" },
          { memberId: h.juan.memberId, percent: "33.33" },
          { memberId: luis.memberId, percent: "33.34" },
        ],
      }),
    );
    expect(sharesOf(tx)).toEqual([
      [h.ana.memberId, cop(33_330), "PERCENT"],
      [h.juan.memberId, cop(33_330), "PERCENT"],
      [luis.memberId, cop(33_340), "PERCENT"],
    ]);
  });

  it("rejects splits that do not add up or are malformed", async () => {
    const h = await household();
    const [ana, juan] = [h.ana.memberId, h.juan.memberId];
    const cases: [unknown, number, string][] = [
      [
        byAna(h, 300_000, {
          method: "PERCENT",
          participants: [
            { memberId: ana, percent: "40" },
            { memberId: juan, percent: "50" },
          ],
        }),
        422,
        "InvalidSplit",
      ],
      [
        byAna(h, 250_000, {
          method: "EXACT",
          participants: [
            { memberId: ana, amount: cop(100_000) },
            { memberId: juan, amount: cop(120_000) },
          ],
        }),
        409,
        "SharesDoNotMatchAmount",
      ],
      [
        byAna(h, 90_000, {
          method: "SHARES",
          participants: [
            { memberId: ana, units: 0 },
            { memberId: juan, units: 0 },
          ],
        }),
        422,
        "InvalidSplit",
      ],
      [
        byAna(h, 300_000, {
          method: "PERCENT",
          participants: [
            { memberId: ana, percent: "40%" },
            { memberId: juan, percent: "60" },
          ],
        }),
        422,
        "ValidationFailed",
      ],
      [
        byAna(h, 90_000, {
          method: "SHARES",
          participants: [
            { memberId: ana, units: 1.5 },
            { memberId: juan, units: 1 },
          ],
        }),
        422,
        "ValidationFailed",
      ],
      [
        byAna(h, 250_000, {
          method: "EXACT",
          participants: [
            { memberId: ana, amount: cop(100_000) },
            { memberId: juan, amount: { amount: "15000000", currency: "USD" } },
          ],
        }),
        422,
        "CurrencyMismatch",
      ],
    ];
    for (const [body, status, code] of cases) {
      expect(await problemOf(await post(recordExpense, h.ana, "expenses", body))).toEqual([status, code]);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/shared-expenses.test.ts`
Expected: FAIL — every non-equal split answers `422 ValidationFailed` (the contract accepts only `EQUAL`), so `recordedBy` sees `422` instead of `201` and the `InvalidSplit` / `SharesDoNotMatchAmount` / `CurrencyMismatch` cases get `ValidationFailed`.

- [ ] **Step 3: Implement**

In `src/modules/ledger/contracts/ledger.contract.ts`:

1. Replace the line `import { domainError, err, isUuid, localDate, ok, type Result } from "@/shared/kernel";` with:

```ts
import { domainError, err, isUuid, localDate, ok, type Money, type Result } from "@/shared/kernel";
```

2. Replace the declaration that starts at the line `/** HU-E4-07: EQUAL among the chosen members. */` and ends at the `});` that closes `SplitBodySchema` with:

```ts
/** "40", "33.33": a percentage with at most two decimals (HU-E4-08), never a float. */
const PercentSchema = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, { error: "A percentage with at most two decimals, e.g. 40 or 33.33" });

/** HU-E4-07/08: EQUAL among the chosen members, or by percentage, exact amount or share units per member. */
export const SplitBodySchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("EQUAL"), participants: z.array(z.object({ memberId: Id })).max(MAX_PARTS) }),
  z.object({
    method: z.literal("PERCENT"),
    participants: z.array(z.object({ memberId: Id, percent: PercentSchema })).max(MAX_PARTS),
  }),
  z.object({
    method: z.literal("EXACT"),
    participants: z.array(z.object({ memberId: Id, amount: MoneySchema })).max(MAX_PARTS),
  }),
  z.object({
    method: z.literal("SHARES"),
    participants: z.array(z.object({ memberId: Id, units: z.number().int() })).max(MAX_PARTS),
  }),
]);

/** "33.33" → 3333 basis points (the regex guarantees digits). */
export const basisPointsOf = (percent: string): number => {
  const [whole = "0", fraction = ""] = percent.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
};
```

3. Replace the declaration that starts at the line `/** The split as the use case takes it. */` and ends at the `);` that closes `splitFromBody` with:

```ts
/** The split as the use case takes it; EXACT amounts become Money (UnknownCurrency otherwise). */
const splitFromBody = (split: RecordExpenseBody["split"]): Result<SplitInput | undefined> => {
  if (split === undefined) return ok(undefined);
  switch (split.method) {
    case "EQUAL":
      return ok({ method: "EQUAL" as const, participants: split.participants.map((p) => ({ memberId: p.memberId })) });
    case "PERCENT":
      return ok({
        method: "PERCENT" as const,
        participants: split.participants.map((p) => ({ memberId: p.memberId, basisPoints: basisPointsOf(p.percent) })),
      });
    case "SHARES":
      return ok({
        method: "SHARES" as const,
        participants: split.participants.map((p) => ({ memberId: p.memberId, units: p.units })),
      });
    case "EXACT": {
      const participants: { memberId: string; amount: Money }[] = [];
      for (const p of split.participants) {
        const amount = moneyFromDto(p.amount);
        if (!amount.ok) return amount;
        participants.push({ memberId: p.memberId, amount: amount.value });
      }
      return ok({ method: "EXACT" as const, participants });
    }
  }
};
```

- [ ] **Step 4: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/shared-expenses.test.ts`
Expected: PASS.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: only the `split` property of `POST /api/v1/spaces/{spaceId}/expenses` changes (a `oneOf` with a `method` discriminator); components are unchanged.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/contracts/ledger.contract.ts openapi/openapi.snapshot.json tests/acceptance/shared-expenses.test.ts
git commit -m "feat(ledger): accept percentage, exact and share-unit splits over HTTP (Refs #37)"
```

---

### Task 13: HTTP — expenses paid from the shared fund, with warnings

Exposes HU-E4-10 (issue #39): a payment may be `{ "memberId": null, "accountId": "<the space's fund>" }`, and every expense response carries `warnings[]` (empty unless the fund went negative). Pins Review Focus 3 for fund accounts over HTTP.

Decisions:
- The expense response becomes the new response-only component `RecordedExpense` = `Transaction` + `warnings: [{ code, accountId, balance: Money }]`. `warnings` is always present (empty array), so clients never branch on its absence; the M1 personal response gains `"warnings": []`. Idempotent replays return the stored response, warnings included.
- `memberId: null` is the only way to name the fund as payer (spec 5.2); the contract stays agnostic of account types, the use case decides (`InvalidFundAccount`, `AccountNotFound`, `MixedFundPayment`).
- "Fund-paid expense creates no debt" is asserted over HTTP with the balances endpoint in Task 14.

**Files:**
- Modify: `src/modules/ledger/contracts/ledger.contract.ts`, `src/app/api/v1/spaces/[spaceId]/expenses/route.ts`, `src/composition/openapi.ts`, `src/shared/http/problem.test.ts`, `openapi/openapi.snapshot.json`
- Test: `tests/acceptance/fund-expenses.test.ts`

**Interfaces:**
- Consumes: `RecordedExpense`, `LedgerWarning` (Task 6); `PaymentBodySchema`, `expenseFromBody` (Task 11); `household`, `newAccount`, `categoryWithKey`, `balanceOf`, `post`, `cop` (Task 11).
- Produces: `WarningSchema`, `RecordedExpenseSchema` (component `RecordedExpense`), `recordedExpenseDto(recorded: RecordedExpense)`; `recording(operationId, summary, body, errors, response = TransactionSchema)`; `PaymentBodySchema.memberId: string | null`.

- [ ] **Step 1: Write the failing acceptance test**

`tests/acceptance/fund-expenses.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { problemOf, startTestApp } from "../support/app";
import {
  balanceOf,
  categoryWithKey,
  cop,
  household,
  newAccount,
  post,
  type Household,
  type MoneyDto,
  type TransactionDto,
} from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface RecordedDto extends TransactionDto {
  warnings: { code: string; accountId: string; balance: MoneyDto }[];
}
interface FundHousehold extends Household {
  readonly fund: string;
  readonly rent: string;
}

/** HU-E4-10 Background: Household with Ana and Juan and the account "Household Fund" holding 1,500,000 COP. */
const withFund = async (): Promise<FundHousehold> => {
  const h = await household();
  return {
    ...h,
    fund: await newAccount(h.ana, "Household Fund", 1_500_000, "SHARED_FUND"),
    rent: await categoryWithKey(h.ana, "rent"),
  };
};
/** Rent of `pesos` paid from `fund`, split 40% / 60% between Ana and Juan unless `extra` says otherwise. */
const rentFrom = (h: FundHousehold, fund: string, pesos: number, extra: Record<string, unknown> = {}) => ({
  description: "Rent October",
  date: "2026-10-01",
  categoryId: h.rent,
  amount: cop(pesos),
  payments: [{ memberId: null, accountId: fund, amount: cop(pesos) }],
  split: {
    method: "PERCENT",
    participants: [
      { memberId: h.ana.memberId, percent: "40" },
      { memberId: h.juan.memberId, percent: "60" },
    ],
  },
  ...extra,
});
const recorded = async (response: Response): Promise<RecordedDto> => {
  expect(response.status).toBe(201);
  return (await response.json()) as RecordedDto;
};

describe("expenses paid from the shared fund (HU-E4-10)", () => {
  it("pays rent from the fund, split 40% / 60%, and lowers the fund balance (@critical)", async () => {
    const h = await withFund();
    const rent = await recorded(await post(recordExpense, h.ana, "expenses", rentFrom(h, h.fund, 1_200_000)));
    expect(rent.payments).toEqual([{ memberId: null, accountId: h.fund, amount: cop(1_200_000) }]);
    expect(rent.shares.map((s) => [s.memberId, s.amount, s.splitMethod])).toEqual([
      [h.ana.memberId, cop(480_000), "PERCENT"],
      [h.juan.memberId, cop(720_000), "PERCENT"],
    ]);
    expect(rent.warnings).toEqual([]);
    expect(await balanceOf(h.ana, h.fund)).toEqual(cop(300_000));
  });

  it("records an expense that takes the fund below zero and warns with its balance", async () => {
    const h = await withFund();
    const big = await recorded(await post(recordExpense, h.ana, "expenses", rentFrom(h, h.fund, 2_000_000)));
    expect(big.warnings).toEqual([{ code: "FundBalanceNegative", accountId: h.fund, balance: cop(-500_000) }]);
    expect(await balanceOf(h.ana, h.fund)).toEqual(cop(-500_000));
  });

  it("answers member-paid expenses with an empty warnings list", async () => {
    const h = await withFund();
    const groceries = await recorded(
      await post(recordExpense, h.ana, "expenses", {
        description: "Groceries",
        date: "2026-10-05",
        categoryId: h.groceries,
        amount: cop(100_000),
        payments: [{ memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(100_000) }],
      }),
    );
    expect(groceries.warnings).toEqual([]);
  });

  it("accepts only this household's own fund, as the only payer (Review Focus 3)", async () => {
    const h = await withFund();
    const other = await withFund();
    const cases: [unknown, number, string][] = [
      [rentFrom(h, other.fund, 100_000), 404, "AccountNotFound"],
      [rentFrom(h, "not-a-uuid", 100_000), 404, "AccountNotFound"],
      [rentFrom(h, h.ana.account, 100_000), 404, "AccountNotFound"],
      [rentFrom(h, h.fund, 100_000, { payments: [{ memberId: null, amount: cop(100_000) }] }), 422, "AccountRequired"],
      [
        rentFrom(h, h.fund, 100_000, {
          payments: [{ memberId: h.ana.memberId, accountId: h.fund, amount: cop(100_000) }],
        }),
        422,
        "AccountNotOwned",
      ],
      [
        rentFrom(h, h.fund, 1_200_000, {
          payments: [
            { memberId: null, accountId: h.fund, amount: cop(1_000_000) },
            { memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(200_000) },
          ],
        }),
        409,
        "MixedFundPayment",
      ],
    ];
    for (const [body, status, code] of cases) {
      expect(await problemOf(await post(recordExpense, h.ana, "expenses", body))).toEqual([status, code]);
    }
    expect(await balanceOf(h.ana, h.fund)).toEqual(cop(1_500_000));
  });
});
```

In `src/shared/http/problem.test.ts`, add after the line `    ["CategoryRequired", 422],`:

```ts
    ["InvalidFundAccount", 422],
    ["MixedFundPayment", 409],
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/fund-expenses.test.ts`
Expected: FAIL — fund payments answer `422 ValidationFailed` (`memberId` may not be null yet) and member-paid responses have no `warnings` (`undefined` instead of `[]`).

- [ ] **Step 3: Implement**

In `src/modules/ledger/contracts/ledger.contract.ts`:

1. Replace the line `  PaymentInput,` (in the type import list from `../application`) with:

```ts
  PaymentInput,
  RecordedExpense,
```

2. Replace the `PaymentBodySchema` declaration together with its doc comment (Task 11 wrote it: from the `/**` line directly above the comment line that begins ` * HU-E4-07: one payment by a member of the space` through the `});` that closes `PaymentBodySchema`) with:

```ts
/**
 * HU-E4-07/10: one payment. `memberId` is a member of the space (registered or guest) and `accountId`
 * that member's own account, or null (or absent) for a guest, who pays outside the app; a null
 * `memberId` names the space's shared fund as payer, and `accountId` is then the fund (spec 5.2).
 */
export const PaymentBodySchema = z.object({
  memberId: Id.nullable(),
  accountId: Id.nullable().optional(),
  amount: MoneySchema,
});
```

3. Insert before the line that starts with `const UUID = "[0-9a-fA-F]{8}`:

```ts
/** HU-E4-10: non-blocking conditions of a recorded expense, as codes; the expense was recorded. */
export const WarningSchema = z.object({
  code: z.enum(["FundBalanceNegative"]),
  accountId: z.string(),
  /** The account balance after the expense. */
  balance: MoneySchema,
});
/** The expense response: the transaction plus its warnings (always present, usually empty). */
export const RecordedExpenseSchema = TransactionSchema.extend({ warnings: z.array(WarningSchema) });

export const recordedExpenseDto = (recorded: RecordedExpense): z.infer<typeof RecordedExpenseSchema> => ({
  ...transactionDto(recorded.expense),
  warnings: recorded.warnings.map((warning) => ({
    code: warning.code,
    accountId: warning.accountId,
    balance: { amount: warning.balance.toString(), currency: recorded.expense.currency },
  })),
});

```

4. Replace the block

```ts
const recording = (
  operationId: string,
  summary: string,
  body: z.ZodType,
  errors: Record<string, string>,
) => ({
  post: {
    operationId,
    summary,
    ...securedByUser,
    requestParams: { path: SpacePath, header: IdempotencyHeader },
    requestBody: { content: jsonContent(body) },
    responses: {
      "201": {
        description: "The recorded transaction; ETag carries its version",
        content: jsonContent(TransactionSchema),
      },
      ...problems({ "401": "Unauthenticated", "403": "InsufficientRole", ...errors }),
    },
  },
});
```

with:

```ts
const recording = (
  operationId: string,
  summary: string,
  body: z.ZodType,
  errors: Record<string, string>,
  response: z.ZodType = TransactionSchema,
) => ({
  post: {
    operationId,
    summary,
    ...securedByUser,
    requestParams: { path: SpacePath, header: IdempotencyHeader },
    requestBody: { content: jsonContent(body) },
    responses: {
      "201": {
        description: "The recorded transaction; ETag carries its version",
        content: jsonContent(response),
      },
      ...problems({ "401": "Unauthenticated", "403": "InsufficientRole", ...errors }),
    },
  },
});
```

5. Replace everything from the line `  "/api/v1/spaces/{spaceId}/expenses": recording(` up to, but not including, the line `  "/api/v1/spaces/{spaceId}/incomes": recording(` with:

```ts
  "/api/v1/spaces/{spaceId}/expenses": recording(
    "recordExpense",
    "Record an expense paid by members (registered or guest) or by the shared fund, shared among members",
    RecordExpenseBodySchema,
    {
      "404": "SpaceNotFound, CategoryNotFound, AccountNotFound",
      "409":
        "AccountArchived, CategoryArchived, PeriodClosed, IdempotencyKeyConflict, SharesDoNotMatchAmount, GuestHasNoAccounts, MixedFundPayment",
      "422": `${invalidMoney}, CategoryRequired, AccountNotOwned, AccountRequired, PaymentsRequired, ParticipantsRequired, NotASpaceMember, InvalidSplit, InvalidFundAccount`,
    },
    RecordedExpenseSchema,
  ),
```

`src/app/api/v1/spaces/[spaceId]/expenses/route.ts` (replace the whole file):

```ts
import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  expenseFromBody,
  RecordExpenseBodySchema,
  recordedExpenseDto,
  transactionHeaders,
} from "@/modules/ledger/contracts/ledger.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: RecordExpenseBodySchema,
  before: withIdempotency,
  handler: async ({ user, params, body }) => {
    const fields = expenseFromBody(body);
    if (!fields.ok) return fields;
    const result = await getContainer().ledger.recordExpense({
      spaceId: params.spaceId!,
      userId: user!.id,
      ...fields.value,
    });
    return result.ok
      ? ok({
          status: 201,
          body: recordedExpenseDto(result.value),
          headers: transactionHeaders(result.value.expense),
        })
      : result;
  },
});
```

In `src/composition/openapi.ts`:

1. Replace the line `import { ledgerPaths, TransactionSchema } from "@/modules/ledger/contracts/ledger.contract";` with:

```ts
import { ledgerPaths, RecordedExpenseSchema, TransactionSchema } from "@/modules/ledger/contracts/ledger.contract";
```

2. Add after the line `        Transaction: TransactionSchema,`:

```ts
        RecordedExpense: RecordedExpenseSchema,
```

- [ ] **Step 4: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance && pnpm exec vitest run --project unit src/shared/http/problem.test.ts`
Expected: PASS (M1's personal expense tests use `toMatchObject` and replay comparisons, so `"warnings": []` does not disturb them).

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: `POST /api/v1/spaces/{spaceId}/expenses` changes (nullable `memberId`, response `$ref` to `RecordedExpense`, error lists) and `components.schemas.RecordedExpense` is added; there is no `RecordedExpenseOutput` and no other component changes. Then check the size with `git diff --stat`: if zod-openapi inlined `RecordedExpense` (instead of `allOf` with a `$ref` to `Transaction`) and the task passes ~400 changed lines, move the two `problem.test.ts` rows and the "answers member-paid expenses with an empty warnings list" test into a follow-up commit `test(ledger): pin fund codes and empty warnings (Refs #39)`.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/contracts/ledger.contract.ts "src/app/api/v1/spaces/[spaceId]/expenses/route.ts" src/composition/openapi.ts src/shared/http/problem.test.ts openapi/openapi.snapshot.json tests/acceptance/fund-expenses.test.ts
git commit -m "feat(ledger): pay expenses from the shared fund over HTTP with warnings (Refs #39)"
```

---

### Task 14: HTTP — balances

Exposes HU-E5-01 (issue #43): `GET /api/v1/spaces/{spaceId}/balances` → `200 { "members": [{ "memberId", "net": Money }] }`, one entry per current member in join order, guests included. Also proves HU-E4-10's "Fund-paid expense creates no debt" end to end. Pins Review Focus 2 (malformed and foreign space ids) and 5 (deletion, guests, Σ = 0) over HTTP.

Decisions:
- The response schema is inline (no new component), so the OpenAPI growth is one operation.
- The composition root binds `BalanceSource` to `DrizzleLedgerQueries` (its `memberTotals` from Task 10) and the members port to `DrizzleSpaceRepository`; neither module imports the other.
- A malformed space id answers `404 SpaceNotFound` through `findMembership`'s `isUuid` guard (M1), like every space path.

**Files:**
- Create: `src/modules/balances/contracts/balances.contract.ts`, `src/app/api/v1/spaces/[spaceId]/balances/route.ts`
- Modify: `src/composition/container.ts`, `src/composition/openapi.ts`, `tests/support/ledger.ts`, `openapi/openapi.snapshot.json`
- Test: `tests/acceptance/balances.test.ts`

**Interfaces:**
- Consumes: `createGetSpaceBalances`, `GetSpaceBalances`, `SpaceBalances` (Task 9); `DrizzleLedgerQueries.memberTotals` (Task 10); `household`, `joinHousehold`, `addGuest`, `newAccount`, `post`, `cop` (Task 11); fund payments over HTTP (Task 13); `DELETE …/transactions/{transactionId}` (M1).
- Produces: `SpaceBalancesSchema`, `spaceBalancesDto(balances: SpaceBalances)`, `balancesPaths`; `GET /api/v1/spaces/{spaceId}/balances`; `Container.balances.getSpaceBalances`; `tests/support/ledger.ts`: `balancesOf(user: TestUser, spaceId: string): Promise<[string, MoneyDto][]>`.

- [ ] **Step 1: Write the failing acceptance test**

In `tests/support/ledger.ts`:

1. Add after the line `import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";`:

```ts
import { GET as getBalances } from "@/app/api/v1/spaces/[spaceId]/balances/route";
```

2. Append to the end of the file:

```ts

/** HU-E5-01: the household's balances as `user` reads them, as `[memberId, net]` pairs in join order. */
export const balancesOf = async (user: TestUser, spaceId: string): Promise<[string, MoneyDto][]> => {
  const response = await call(getBalances, "GET", `/api/v1/spaces/${spaceId}/balances`, {
    user,
    params: { spaceId },
  });
  if (response.status !== 200) throw new Error(`balances failed with status ${response.status}`);
  const { members } = (await response.json()) as { members: { memberId: string; net: MoneyDto }[] };
  return members.map((m): [string, MoneyDto] => [m.memberId, m.net]);
};
```

`tests/acceptance/balances.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getBalances } from "@/app/api/v1/spaces/[spaceId]/balances/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { DELETE as deleteTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp } from "../support/app";
import {
  addGuest,
  balancesOf,
  cop,
  household,
  joinHousehold,
  newAccount,
  post,
  type Household,
  type HouseholdMember,
  type TransactionDto,
} from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const equal = (...memberIds: string[]) => ({
  method: "EQUAL",
  participants: memberIds.map((memberId) => ({ memberId })),
});
/** `payer` pays `pesos` from their own account, split equally among `participants`. */
const pay = async (h: Household, payer: HouseholdMember, pesos: number, participants: string[]) => {
  const response = await post(recordExpense, payer, "expenses", {
    description: "Groceries",
    date: "2026-10-05",
    categoryId: h.groceries,
    amount: cop(pesos),
    payments: [{ memberId: payer.memberId, accountId: payer.account, amount: cop(pesos) }],
    split: equal(...participants),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as TransactionDto;
};

describe("balances in a shared space (HU-E5-01)", () => {
  it("turns one equal split into a debt: Juan owes Ana 150,000 COP (@critical)", async () => {
    const h = await household();
    await pay(h, h.ana, 300_000, [h.ana.memberId, h.juan.memberId]);
    expect(await balancesOf(h.juan, h.spaceId)).toEqual([
      [h.ana.memberId, cop(150_000)],
      [h.juan.memberId, cop(-150_000)],
    ]);
  });

  it("nets debts out across expenses", async () => {
    const h = await household();
    const both = [h.ana.memberId, h.juan.memberId];
    await pay(h, h.ana, 300_000, both);
    await pay(h, h.juan, 100_000, both);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(100_000)],
      [h.juan.memberId, cop(-100_000)],
    ]);
  });

  it("ignores expenses paid from the shared fund (HU-E4-10, D5)", async () => {
    const h = await household();
    const fund = await newAccount(h.ana, "Household Fund", 1_500_000, "SHARED_FUND");
    await pay(h, h.ana, 300_000, [h.ana.memberId, h.juan.memberId]);
    const rent = await post(recordExpense, h.ana, "expenses", {
      description: "Rent October",
      date: "2026-10-01",
      categoryId: h.groceries,
      amount: cop(1_200_000),
      payments: [{ memberId: null, accountId: fund, amount: cop(1_200_000) }],
      split: {
        method: "PERCENT",
        participants: [
          { memberId: h.ana.memberId, percent: "40" },
          { memberId: h.juan.memberId, percent: "60" },
        ],
      },
    });
    expect(rent.status).toBe(201);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(150_000)],
      [h.juan.memberId, cop(-150_000)],
    ]);
  });

  it("excludes soft-deleted expenses (Review Focus 5)", async () => {
    const h = await household();
    const tx = await pay(h, h.ana, 300_000, [h.ana.memberId, h.juan.memberId]);
    const deleted = await call(deleteTransaction, "DELETE", `/api/v1/spaces/${h.spaceId}/transactions/${tx.id}`, {
      user: h.ana,
      params: { spaceId: h.spaceId, transactionId: tx.id },
    });
    expect(deleted.status).toBe(204);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
    ]);
  });

  it("includes guests, and the balances sum to zero (Review Focus 5)", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    const taxi = await post(recordExpense, h.ana, "expenses", {
      description: "Taxi",
      date: "2026-10-05",
      categoryId: h.groceries,
      amount: cop(90_000),
      payments: [{ memberId: pedro, accountId: null, amount: cop(90_000) }],
      split: equal(h.ana.memberId, h.juan.memberId, pedro),
    });
    expect(taxi.status).toBe(201);
    const nets = await balancesOf(h.ana, h.spaceId);
    expect(nets).toEqual([
      [h.ana.memberId, cop(-30_000)],
      [h.juan.memberId, cop(-30_000)],
      [pedro, cop(60_000)],
    ]);
    expect(nets.reduce((sum, [, net]) => sum + BigInt(net.amount), 0n)).toBe(0n);
  });

  it("lets a viewer read and hides the balances from everyone else (Review Focus 2)", async () => {
    const h = await household();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    expect(await balancesOf(sofi, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
      [sofi.memberId, cop(0)],
    ]);
    const marta = await registerUser("Marta");
    for (const spaceId of [h.spaceId, "not-a-uuid"]) {
      const response = await call(getBalances, "GET", `/api/v1/spaces/${spaceId}/balances`, {
        user: marta,
        params: { spaceId },
      });
      expect(await problemOf(response)).toEqual([404, "SpaceNotFound"]);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/balances.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/balances/route"`.

- [ ] **Step 3: Contract, route and wiring**

`src/modules/balances/contracts/balances.contract.ts`:

```ts
import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, MoneySchema, problems, securedByUser } from "@/shared/http/contracts";
import type { SpaceBalances } from "../application";

/** HU-E5-01: one entry per current member in join order, guests included; positive net means owed money. */
export const SpaceBalancesSchema = z.object({
  members: z.array(z.object({ memberId: z.string(), net: MoneySchema })),
});

export const spaceBalancesDto = (balances: SpaceBalances): z.infer<typeof SpaceBalancesSchema> => ({
  members: balances.members.map((m) => ({
    memberId: m.memberId,
    net: { amount: m.net.toString(), currency: balances.currency },
  })),
});

const SpacePath = z.object({ spaceId: z.string() });

export const balancesPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces/{spaceId}/balances": {
    get: {
      operationId: "getSpaceBalances",
      summary: "Net balance of every member; fund-paid expenses and fund contributions create no debt",
      ...securedByUser,
      requestParams: { path: SpacePath },
      responses: {
        "200": {
          description: "Balances in join order; they always sum to zero",
          content: jsonContent(SpaceBalancesSchema),
        },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound" }),
      },
    },
  },
};
```

`src/app/api/v1/spaces/[spaceId]/balances/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { spaceBalancesDto } from "@/modules/balances/contracts/balances.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().balances.getSpaceBalances({
      spaceId: params.spaceId!,
      userId: user!.id,
    });
    return result.ok ? ok({ status: 200, body: spaceBalancesDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Add after the line `import { DrizzleAccountRepository } from "@/modules/accounts/infrastructure/drizzle-account-repository";`:

```ts
import { createGetSpaceBalances, type GetSpaceBalances } from "@/modules/balances/application";
```

2. Insert before the line `  /** Brute-force guards for the unauthenticated identity routes; false means "reject with 429". */`:

```ts
  readonly balances: { readonly getSpaceBalances: GetSpaceBalances };
```

3. Insert before the line `    authThrottle: {`:

```ts
    balances: {
      // HU-E5-01: the ledger aggregates per-member totals in SQL (D7); the balances module nets them.
      getSpaceBalances: createGetSpaceBalances({ access, members: spaceRepository, source: ledgerQueries }),
    },
```

In `src/composition/openapi.ts`:

1. Add after the line `import { AccountSchema, accountsPaths } from "@/modules/accounts/contracts/accounts.contract";`:

```ts
import { balancesPaths } from "@/modules/balances/contracts/balances.contract";
```

2. Add after the line `      ...ledgerPaths,`:

```ts
      ...balancesPaths,
```

- [ ] **Step 4: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/balances.test.ts`
Expected: PASS.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `GET /api/v1/spaces/{spaceId}/balances`; components are unchanged.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (`schemas-only-reference-schemas` and `modules-only-through-public-application-api` hold: the balances contract imports only its own application and the shared HTTP contracts).

- [ ] **Step 6: Commit**

```bash
git add src/modules/balances/contracts/balances.contract.ts "src/app/api/v1/spaces/[spaceId]/balances/route.ts" src/composition/container.ts src/composition/openapi.ts tests/support/ledger.ts openapi/openapi.snapshot.json tests/acceptance/balances.test.ts
git commit -m "feat(balances): expose who owes whom in a shared space (Refs #43)"
```

---

### Task 15: HTTP — fund contributions

Exposes HU-E4-09 (issue #38): `POST /api/v1/spaces/{spaceId}/fund-contributions` (`201 Transaction`, honours `Idempotency-Key`). Pins Review Focus 3 (foreign funds) and 4 (replayed contributions) over HTTP.

Decisions:
- Body `{ "amount", "date"?, "description"?, "fundAccountId", "memberId"?, "sourceAccountId"? }`: `memberId` defaults to the requester; `sourceAccountId` is omitted (or `null`) only for a guest.
- The response is the plain `Transaction`: a contribution is a `TRANSFER` whose `payerMemberId` is the contributor (the "fund contribution" flag of HU-E4-09) and whose `destinationAccountId` is the fund.

**Files:**
- Modify: `src/modules/ledger/contracts/ledger.contract.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`
- Create: `src/app/api/v1/spaces/[spaceId]/fund-contributions/route.ts`
- Test: `tests/acceptance/fund-contributions.test.ts`

**Interfaces:**
- Consumes: `createRecordFundContribution`, `RecordFundContribution`, `RecordFundContributionInput` (Task 7); `recording`, `invalidMoney`, `transactionDto`, `transactionHeaders` (M1, Task 13); `moneyFromDto`, `optionalLocalDate` (imported into the contract by Task 11); `household`, `joinHousehold`, `addGuest`, `newAccount`, `balanceOf`, `balancesOf`, `post`, `cop` (Tasks 11, 14).
- Produces: `RecordFundContributionBodySchema`, `fundContributionFromBody(body): Result<Omit<RecordFundContributionInput, "spaceId" | "userId">>` (same convention as Task 11's `expenseFromBody`); `POST /api/v1/spaces/{spaceId}/fund-contributions`; `Container.ledger.recordFundContribution`.

- [ ] **Step 1: Write the failing acceptance test**

`tests/acceptance/fund-contributions.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordContribution } from "@/app/api/v1/spaces/[spaceId]/fund-contributions/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { problemOf, startTestApp, type TestUser } from "../support/app";
import {
  addGuest,
  balanceOf,
  balancesOf,
  cop,
  household,
  joinHousehold,
  newAccount,
  post,
  type Household,
  type TransactionDto,
} from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface FundHousehold extends Household {
  readonly fund: string;
}

/** HU-E4-09 Background: Household with Ana and Juan and the empty SHARED_FUND account "Household Fund". */
const withFund = async (): Promise<FundHousehold> => {
  const h = await household();
  return { ...h, fund: await newAccount(h.ana, "Household Fund", 0, "SHARED_FUND") };
};
/** `pesos` into the fund on 2026-10-02, from Ana's Bancolombia unless `extra` says otherwise. */
const contribution = (h: FundHousehold, pesos: number, extra: Record<string, unknown> = {}) => ({
  date: "2026-10-02",
  amount: cop(pesos),
  fundAccountId: h.fund,
  sourceAccountId: h.ana.account,
  ...extra,
});
const contribute = (user: TestUser, body: unknown, headers: Record<string, string> = {}) =>
  post(recordContribution, user, "fund-contributions", body, headers);

describe("fund contributions (HU-E4-09)", () => {
  it("records Ana's transfer from her personal account into Household Fund", async () => {
    const h = await withFund();
    const response = await contribute(h.ana, contribution(h, 480_000));
    expect(response.status).toBe(201);
    expect((await response.json()) as TransactionDto).toMatchObject({
      type: "TRANSFER",
      categoryId: null,
      amount: cop(480_000),
      payerMemberId: h.ana.memberId,
      sourceAccountId: h.ana.account,
      destinationAccountId: h.fund,
      createdBy: h.ana.userId,
    });
    expect(await balanceOf(h.ana, h.fund)).toEqual(cop(480_000));
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(cop(1_520_000));
  });

  it("requires the contributor's own account, debited only by its owner (D9)", async () => {
    const h = await withFund();
    const fromJuans = contribution(h, 480_000, { sourceAccountId: h.juan.account });
    expect(await problemOf(await contribute(h.ana, fromJuans))).toEqual([422, "AccountNotOwned"]);
    // Ana cannot record Juan's contribution from Juan's account; Juan records it himself.
    const juans = { ...fromJuans, memberId: h.juan.memberId };
    expect(await problemOf(await contribute(h.ana, juans))).toEqual([422, "AccountNotOwned"]);
    expect((await contribute(h.juan, juans)).status).toBe(201);
    expect(await balanceOf(h.ana, h.fund)).toEqual(cop(480_000));
  });

  it("does not let a viewer contribute", async () => {
    const h = await withFund();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    const fromSofi = contribution(h, 100_000, { sourceAccountId: sofi.account });
    expect(await problemOf(await contribute(sofi, fromSofi))).toEqual([403, "InsufficientRole"]);
  });

  it("creates no debt between members (D5)", async () => {
    const h = await withFund();
    expect((await contribute(h.ana, contribution(h, 480_000))).status).toBe(201);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
    ]);
  });

  it("records a guest's contribution from outside the app", async () => {
    const h = await withFund();
    const pedro = await addGuest(h, "Pedro");
    const response = await contribute(h.ana, contribution(h, 100_000, { memberId: pedro, sourceAccountId: null }));
    expect(response.status).toBe(201);
    expect((await response.json()) as TransactionDto).toMatchObject({ payerMemberId: pedro, sourceAccountId: null });
    expect(await problemOf(await contribute(h.ana, contribution(h, 100_000, { memberId: pedro })))).toEqual([
      409,
      "GuestHasNoAccounts",
    ]);
    expect(await balanceOf(h.ana, h.fund)).toEqual(cop(100_000));
  });

  it("replays a repeated Idempotency-Key and moves the fund once (Review Focus 4)", async () => {
    const h = await withFund();
    const key = { "idempotency-key": "fund-2026-10" };
    const first = await contribute(h.ana, contribution(h, 480_000), key);
    const second = await contribute(h.ana, contribution(h, 480_000), key);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(await second.json()).toEqual(await first.json());
    expect(await balanceOf(h.ana, h.fund)).toEqual(cop(480_000));
    expect(await problemOf(await contribute(h.ana, contribution(h, 500_000), key))).toEqual([
      409,
      "IdempotencyKeyConflict",
    ]);
  });

  it("accepts only this household's fund (Review Focus 3)", async () => {
    const h = await withFund();
    const other = await withFund();
    for (const fundAccountId of [other.fund, "not-a-uuid", h.ana.account]) {
      expect(await problemOf(await contribute(h.ana, contribution(h, 100_000, { fundAccountId })))).toEqual([
        404,
        "AccountNotFound",
      ]);
    }
    expect(await balanceOf(h.ana, h.fund)).toEqual(cop(0));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/fund-contributions.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/fund-contributions/route"`.

- [ ] **Step 3: Contract, route and wiring**

In `src/modules/ledger/contracts/ledger.contract.ts`:

1. Insert before the line `export const transactionDto = (tx: Transaction): z.infer<typeof TransactionSchema> => {`:

```ts
/**
 * HU-E4-09: `memberId` defaults to the requester; `sourceAccountId` is the contributor's own account,
 * omitted (or null) only for a guest, who contributes outside the app.
 */
export const RecordFundContributionBodySchema = z.object({
  description: Description,
  date: z.iso.date().optional(),
  amount: MoneySchema,
  fundAccountId: Id,
  memberId: Id.optional(),
  sourceAccountId: Id.nullable().optional(),
});

/** A validated body as RecordFundContribution input; fails only for impossible dates and unknown currencies. */
export const fundContributionFromBody = (
  body: z.infer<typeof RecordFundContributionBodySchema>,
): Result<Omit<RecordFundContributionInput, "spaceId" | "userId">> => {
  const amount = moneyFromDto(body.amount);
  if (!amount.ok) return amount;
  const date = optionalLocalDate(body.date);
  if (!date.ok) return date;
  return ok({
    description: body.description,
    date: date.value,
    amount: amount.value,
    fundAccountId: body.fundAccountId,
    memberId: body.memberId,
    sourceAccountId: body.sourceAccountId ?? null,
  });
};

```

2. Replace the line `  RecordExpenseInput,` (in the type import list from `../application`) with:

```ts
  RecordExpenseInput,
  RecordFundContributionInput,
```

3. Insert before the line `  "/api/v1/spaces/{spaceId}/transactions": {`:

```ts
  "/api/v1/spaces/{spaceId}/fund-contributions": recording(
    "recordFundContribution",
    "Contribute to the space's shared fund from a member's own account (a guest from outside the app)",
    RecordFundContributionBodySchema,
    {
      "404": "SpaceNotFound, AccountNotFound",
      "409": "AccountArchived, PeriodClosed, IdempotencyKeyConflict, SameAccountTransfer, GuestHasNoAccounts",
      "422": `${invalidMoney}, AccountNotOwned, AccountRequired, InvalidFundAccount, NotASpaceMember`,
    },
  ),
```

`src/app/api/v1/spaces/[spaceId]/fund-contributions/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  fundContributionFromBody,
  RecordFundContributionBodySchema,
  transactionDto,
  transactionHeaders,
} from "@/modules/ledger/contracts/ledger.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: RecordFundContributionBodySchema,
  before: withIdempotency,
  handler: async ({ user, params, body }) => {
    const fields = fundContributionFromBody(body);
    if (!fields.ok) return fields;
    const result = await getContainer().ledger.recordFundContribution({
      spaceId: params.spaceId!,
      userId: user!.id,
      ...fields.value,
    });
    return result.ok
      ? ok({ status: 201, body: transactionDto(result.value), headers: transactionHeaders(result.value) })
      : result;
  },
});
```

In `src/composition/container.ts`:

1. Replace the line `  createRecordExpense,` (in the import list from `@/modules/ledger/application`) with:

```ts
  createRecordExpense,
  createRecordFundContribution,
```

2. Replace the line `  type RecordExpense,` with:

```ts
  type RecordExpense,
  type RecordFundContribution,
```

3. Add after the line `    readonly recordTransfer: RecordTransfer;`:

```ts
    readonly recordFundContribution: RecordFundContribution;
```

4. Add after the line `      recordTransfer: createRecordTransfer(ledgerDeps),`:

```ts
      recordFundContribution: createRecordFundContribution(ledgerDeps),
```

- [ ] **Step 4: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/fund-contributions.test.ts`
Expected: PASS.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds exactly `POST /api/v1/spaces/{spaceId}/fund-contributions`; components are unchanged.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/contracts/ledger.contract.ts "src/app/api/v1/spaces/[spaceId]/fund-contributions/route.ts" src/composition/container.ts openapi/openapi.snapshot.json tests/acceptance/fund-contributions.test.ts
git commit -m "feat(ledger): expose fund contributions over HTTP (Refs #38)"
```

---

### Task 16: HTTP — settlements

Exposes HU-E5-02 (issue #44): `POST /api/v1/spaces/{spaceId}/settlements` (`201 Transaction` of type `SETTLEMENT`, honours `Idempotency-Key`); the transaction list accepts `type=SETTLEMENT`; editing a settlement's category is documented as `409 SettlementHasNoCategory`. Pins Review Focus 2, 3, 4 and 5 for settlements over HTTP.

Decisions:
- Body `{ "amount", "date"?, "description"?, "payerMemberId", "receivingMemberId", "sourceAccountId"?, "destinationAccountId"? }` — the request uses the same `payerMemberId` / `receivingMemberId` names as the response.
- Settlements are ordinary transactions for HU-E4-06: their creator (or an OWNER/ADMIN) can edit the amount, date or description and soft-delete them, and a deleted settlement leaves the balances.
- `InvalidSettlementParties` is `422` and `SettlementHasNoCategory` `409` by the naming convention; both get `problem.test.ts` rows.

**Files:**
- Modify: `src/modules/ledger/contracts/ledger.contract.ts`, `src/composition/container.ts`, `src/shared/http/problem.test.ts`, `openapi/openapi.snapshot.json`
- Create: `src/app/api/v1/spaces/[spaceId]/settlements/route.ts`
- Test: `tests/acceptance/settlements.test.ts`

**Interfaces:**
- Consumes: `createRecordSettlement`, `RecordSettlement`, `RecordSettlementInput` (Task 8); `recording`, `invalidMoney`, `transactionDto`, `transactionHeaders`; `moneyFromDto`, `optionalLocalDate` (in the contract since Task 11); `household`, `joinHousehold`, `addGuest`, `memberIdOf`, `balanceOf`, `balancesOf`, `post`, `cop` (Tasks 11, 14); `PATCH`/`DELETE …/transactions/{transactionId}` and `GET …/transactions` (M1).
- Produces: `RecordSettlementBodySchema`, `settlementFromBody(body): Result<Omit<RecordSettlementInput, "spaceId" | "userId">>` (Task 11's convention); `POST /api/v1/spaces/{spaceId}/settlements`; `ListTransactionsQuerySchema.type` with `SETTLEMENT`; `Container.ledger.recordSettlement`.

- [ ] **Step 1: Write the failing acceptance test**

In `src/shared/http/problem.test.ts`, add after the line `    ["CategoryRequired", 422],`:

```ts
    ["InvalidSettlementParties", 422],
    ["SettlementHasNoCategory", 409],
```

`tests/acceptance/settlements.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import {
  DELETE as deleteTransaction,
  PATCH as editTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  addGuest,
  balanceOf,
  balancesOf,
  cop,
  household,
  joinHousehold,
  memberIdOf,
  post,
  type Household,
  type TransactionDto,
} from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** Ana pays `pesos` from Bancolombia, split equally among `participants`. */
const anaPays = async (h: Household, pesos: number, participants: string[]) => {
  const response = await post(recordExpense, h.ana, "expenses", {
    description: "Rent",
    date: "2026-10-01",
    categoryId: h.groceries,
    amount: cop(pesos),
    payments: [{ memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(pesos) }],
    split: { method: "EQUAL", participants: participants.map((memberId) => ({ memberId })) },
  });
  expect(response.status).toBe(201);
};
/** HU-E5-02 Background: Household where Juan owes Ana 1,200,000 COP. */
const juanOwesAna = async (): Promise<Household> => {
  const h = await household();
  await anaPays(h, 2_400_000, [h.ana.memberId, h.juan.memberId]);
  return h;
};
const settle = (user: TestUser, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  post(recordSettlement, user, "settlements", { date: "2026-10-30", ...body }, headers);
const juanToAna = (h: Household, pesos: number, extra: Record<string, unknown> = {}) => ({
  amount: cop(pesos),
  payerMemberId: h.juan.memberId,
  receivingMemberId: h.ana.memberId,
  ...extra,
});
const settled = async (response: Response): Promise<TransactionDto> => {
  expect(response.status).toBe(201);
  return (await response.json()) as TransactionDto;
};

describe("settlements (HU-E5-02)", () => {
  it("clears the balance with a full settlement (@critical)", async () => {
    const h = await juanOwesAna();
    const tx = await settled(await settle(h.juan, juanToAna(h, 1_200_000)));
    expect(tx).toMatchObject({
      type: "SETTLEMENT",
      categoryId: null,
      date: "2026-10-30",
      amount: cop(1_200_000),
      payerMemberId: h.juan.memberId,
      receivingMemberId: h.ana.memberId,
      payments: [],
      shares: [],
      createdBy: h.juan.userId,
    });
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
    ]);
  });

  it("reduces the debt with a partial settlement and reverses it when Juan pays too much", async () => {
    const h = await juanOwesAna();
    await settled(await settle(h.juan, juanToAna(h, 500_000)));
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(700_000)],
      [h.juan.memberId, cop(-700_000)],
    ]);
    await settled(await settle(h.juan, juanToAna(h, 800_000)));
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(-100_000)],
      [h.juan.memberId, cop(100_000)],
    ]);
  });

  it("moves money from Juan's Davivienda to Ana's Bancolombia when Juan records it (D9: a credit to Ana)", async () => {
    const h = await juanOwesAna();
    const withAccounts = juanToAna(h, 1_200_000, {
      sourceAccountId: h.juan.account,
      destinationAccountId: h.ana.account,
    });
    await settled(await settle(h.juan, withAccounts));
    expect(await balanceOf(h.juan.personal, h.juan.account)).toEqual(cop(800_000));
    // Bancolombia: 2,000,000 − 2,400,000 rent + 1,200,000 settlement.
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(cop(800_000));
  });

  it("lets Ana record a settlement paid by the guest Pedro, who has no account", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    await anaPays(h, 200_000, [h.ana.memberId, pedro]);
    const tx = await settled(
      await settle(h.ana, { amount: cop(100_000), payerMemberId: pedro, receivingMemberId: h.ana.memberId }),
    );
    expect(tx).toMatchObject({ payerMemberId: pedro, sourceAccountId: null, createdBy: h.ana.userId });
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
      [pedro, cop(0)],
    ]);
  });

  it("answers invalid settlements with stable codes and settles nothing (Review Focus 2)", async () => {
    const h = await juanOwesAna();
    const pedro = await addGuest(h, "Pedro");
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    const marta = await registerUser("Marta");
    const martasMember = await memberIdOf(marta, marta.spaceId, "Marta");
    const cases: [TestUser, unknown, number, string][] = [
      [h.juan, juanToAna(h, 100_000, { receivingMemberId: h.juan.memberId }), 422, "InvalidSettlementParties"],
      [h.juan, juanToAna(h, 100_000, { receivingMemberId: martasMember }), 422, "NotASpaceMember"],
      [h.juan, juanToAna(h, 100_000, { payerMemberId: "not-a-uuid" }), 422, "NotASpaceMember"],
      [h.juan, juanToAna(h, 100_000, { sourceAccountId: h.ana.account }), 422, "AccountNotOwned"],
      // D9: Ana cannot settle Juan's debt from Juan's account (Juan crediting Ana's account is allowed).
      [h.ana, juanToAna(h, 100_000, { sourceAccountId: h.juan.account }), 422, "AccountNotOwned"],
      [h.ana, juanToAna(h, 100_000, { payerMemberId: pedro, sourceAccountId: h.ana.account }), 409, "GuestHasNoAccounts"],
      [h.juan, juanToAna(h, 0), 422, "InvalidAmount"],
      [sofi, juanToAna(h, 100_000), 403, "InsufficientRole"],
    ];
    for (const [user, body, status, code] of cases) {
      expect(await problemOf(await settle(user, body as Record<string, unknown>))).toEqual([status, code]);
    }
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(1_200_000)],
      [h.juan.memberId, cop(-1_200_000)],
      [pedro, cop(0)],
      [sofi.memberId, cop(0)],
    ]);
  });

  it("replays a repeated Idempotency-Key and settles once (Review Focus 4)", async () => {
    const h = await juanOwesAna();
    const key = { "idempotency-key": "settle-up-2026-10" };
    const first = await settle(h.juan, juanToAna(h, 1_200_000), key);
    const second = await settle(h.juan, juanToAna(h, 1_200_000), key);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(await second.json()).toEqual(await first.json());
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
    ]);
    expect(await problemOf(await settle(h.juan, juanToAna(h, 1_000_000), key))).toEqual([
      409,
      "IdempotencyKeyConflict",
    ]);
  });

  it("restores the debt when the settlement is deleted, and never takes a category (Review Focus 5)", async () => {
    const h = await juanOwesAna();
    const tx = await settled(await settle(h.juan, juanToAna(h, 1_200_000)));
    const path = `/api/v1/spaces/${h.spaceId}/transactions/${tx.id}`;
    const params = { spaceId: h.spaceId, transactionId: tx.id };
    const withCategory = await call(editTransaction, "PATCH", path, {
      user: h.juan,
      params,
      body: { categoryId: h.groceries },
    });
    expect(await problemOf(withCategory)).toEqual([409, "SettlementHasNoCategory"]);
    expect((await call(deleteTransaction, "DELETE", path, { user: h.juan, params })).status).toBe(204);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(1_200_000)],
      [h.juan.memberId, cop(-1_200_000)],
    ]);
  });

  it("lists settlements by type without counting them as spending", async () => {
    const h = await juanOwesAna();
    const tx = await settled(await settle(h.juan, juanToAna(h, 1_200_000)));
    const query = async (filter: string) => {
      const response = await call(listTransactions, "GET", `/api/v1/spaces/${h.spaceId}/transactions?period=2026-10${filter}`, {
        user: h.ana,
        params: { spaceId: h.spaceId },
      });
      return (await response.json()) as { items: TransactionDto[]; totals: { expenses: { amount: string } } };
    };
    expect((await query("&type=SETTLEMENT")).items.map((t) => t.id)).toEqual([tx.id]);
    expect((await query("")).totals.expenses).toEqual(cop(2_400_000));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/settlements.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/settlements/route"` (the two new `problem.test.ts` rows already pass: both codes follow the naming convention).

- [ ] **Step 3: Contract, route and wiring**

In `src/modules/ledger/contracts/ledger.contract.ts`:

1. Insert before the line `export const transactionDto = (tx: Transaction): z.infer<typeof TransactionSchema> => {`:

```ts
/** HU-E5-02: `payerMemberId` paid `receivingMemberId`; both accounts are optional and never sent for a guest. */
export const RecordSettlementBodySchema = z.object({
  description: Description,
  date: z.iso.date().optional(),
  amount: MoneySchema,
  payerMemberId: Id,
  receivingMemberId: Id,
  sourceAccountId: Id.nullable().optional(),
  destinationAccountId: Id.nullable().optional(),
});

/** A validated body as RecordSettlement input; fails only for impossible dates and unknown currencies. */
export const settlementFromBody = (
  body: z.infer<typeof RecordSettlementBodySchema>,
): Result<Omit<RecordSettlementInput, "spaceId" | "userId">> => {
  const amount = moneyFromDto(body.amount);
  if (!amount.ok) return amount;
  const date = optionalLocalDate(body.date);
  if (!date.ok) return date;
  return ok({
    description: body.description,
    date: date.value,
    amount: amount.value,
    payerMemberId: body.payerMemberId,
    receivingMemberId: body.receivingMemberId,
    sourceAccountId: body.sourceAccountId ?? null,
    destinationAccountId: body.destinationAccountId ?? null,
  });
};

```

2. Replace the line `  RecordFundContributionInput,` (in the type import list from `../application`) with:

```ts
  RecordFundContributionInput,
  RecordSettlementInput,
```

3. Replace the line `  type: z.enum(["EXPENSE", "INCOME", "TRANSFER"]).optional(),` with:

```ts
  type: z.enum(["EXPENSE", "INCOME", "TRANSFER", "SETTLEMENT"]).optional(),
```

4. Insert before the line `  "/api/v1/spaces/{spaceId}/transactions": {`:

```ts
  "/api/v1/spaces/{spaceId}/settlements": recording(
    "recordSettlement",
    "Record that one member paid another to settle up; accounts are optional",
    RecordSettlementBodySchema,
    {
      "404": "SpaceNotFound, AccountNotFound",
      "409": "AccountArchived, PeriodClosed, IdempotencyKeyConflict, GuestHasNoAccounts",
      "422": `${invalidMoney}, AccountNotOwned, NotASpaceMember, InvalidSettlementParties`,
    },
  ),
```

5. Replace the line `          "409": "SharesDoNotMatchAmount, CategoryArchived, PeriodClosed, TransferHasNoCategory",` with:

```ts
          "409":
            "SharesDoNotMatchAmount, CategoryArchived, PeriodClosed, TransferHasNoCategory, SettlementHasNoCategory",
```

`src/app/api/v1/spaces/[spaceId]/settlements/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  RecordSettlementBodySchema,
  settlementFromBody,
  transactionDto,
  transactionHeaders,
} from "@/modules/ledger/contracts/ledger.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: RecordSettlementBodySchema,
  before: withIdempotency,
  handler: async ({ user, params, body }) => {
    const fields = settlementFromBody(body);
    if (!fields.ok) return fields;
    const result = await getContainer().ledger.recordSettlement({
      spaceId: params.spaceId!,
      userId: user!.id,
      ...fields.value,
    });
    return result.ok
      ? ok({ status: 201, body: transactionDto(result.value), headers: transactionHeaders(result.value) })
      : result;
  },
});
```

In `src/composition/container.ts`:

1. Replace the line `  createRecordIncome,` (in the import list from `@/modules/ledger/application`) with:

```ts
  createRecordIncome,
  createRecordSettlement,
```

2. Replace the line `  type RecordIncome,` with:

```ts
  type RecordIncome,
  type RecordSettlement,
```

3. Add after the line `    readonly recordFundContribution: RecordFundContribution;`:

```ts
    readonly recordSettlement: RecordSettlement;
```

4. Add after the line `      recordFundContribution: createRecordFundContribution(ledgerDeps),`:

```ts
      recordSettlement: createRecordSettlement(ledgerDeps),
```

- [ ] **Step 4: Run the tests and refresh the snapshot**

Run: `pnpm exec vitest run --project acceptance && pnpm exec vitest run --project unit src/shared/http/problem.test.ts`
Expected: PASS (all acceptance files).

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds `POST /api/v1/spaces/{spaceId}/settlements` and changes `GET /api/v1/spaces/{spaceId}/transactions` (`type` accepts `SETTLEMENT`) and `PATCH /api/v1/spaces/{spaceId}/transactions/{transactionId}` (409 description); components are unchanged.

- [ ] **Step 5: Full gates and build**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check && pnpm check:pinned && pnpm build`
Expected: all exit 0; the build route list contains `/api/v1/spaces/[spaceId]/balances`, `/api/v1/spaces/[spaceId]/fund-contributions` and `/api/v1/spaces/[spaceId]/settlements`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/contracts/ledger.contract.ts "src/app/api/v1/spaces/[spaceId]/settlements/route.ts" src/composition/container.ts src/shared/http/problem.test.ts openapi/openapi.snapshot.json tests/acceptance/settlements.test.ts
git commit -m "feat(ledger): expose settlements over HTTP (Refs #44)"
```

---

## Self-Review

### Story coverage

| Story | Scenario → where it is tested |
|---|---|
| HU-E4-07 (#36) | Ana pays and splits equally (@critical) → Tasks 1, 4, 11 · Equal split with a remainder (33,334 / 33,333 / 33,333) → Tasks 1, 4, 11 (request order shuffled) · Payer need not participate → Tasks 4, 11 · A guest pays without an account (createdBy Ana) → Tasks 4, 11 · Participant must be a current member (`NotASpaceMember`) → Tasks 1, 4, 11 · At least one participant (`ParticipantsRequired`) → Tasks 1, 4, 11 · Technical notes: `AccountRequired` / `GuestHasNoAccounts` → Tasks 4, 11; registered payer pays from their own personal account (D9), and only that payer records the debit (pre-flight ruling N1) → Tasks 4, 11; any MEMBER+ records for a guest → Tasks 4, 11 |
| HU-E4-08 (#37) | Percentage split → Tasks 5, 12 · Percentages must sum to 100 (`InvalidSplit`) → Tasks 5, 12 · Exact split → Tasks 5, 12 · Exact amounts must sum (`SharesDoNotMatchAmount`) → Tasks 5, 12 · Share units → Tasks 5, 12 · Share units must be positive integers (`InvalidSplit`) → Tasks 5, 12 · Two-decimal percentages → Tasks 5, 12 |
| HU-E4-09 (#38) | Ana contributes from her personal account (TRANSFER flagged by `payerMemberId`, fund +480,000, Bancolombia −480,000) → Tasks 3, 7, 15 · Contribution must come from the contributor's own account (`AccountNotOwned`) → Tasks 7, 15 · Viewer cannot contribute (`InsufficientRole`) → Tasks 7, 15 · Contribution creates no inter-member debt → Tasks 9, 10, 15 · Cross-space transfer belongs to the shared space (D9) → Tasks 7, 15 · Guest contribution with no account (spec 5.2) → Tasks 2, 3, 7, 15 |
| HU-E4-10 (#39) | Rent paid from the fund, 40/60, fund 300,000 (@critical) → Tasks 6, 13 · Fund-paid expense creates no debt → Tasks 9, 10, 14 · Fund may go negative only with an explicit warning (`FundBalanceNegative`, −500,000) → Tasks 6, 13 · Fund payments store `memberId = null` and the fund's `accountId` → Tasks 6, 13 |
| HU-E5-01 (#43) | One equal split creates a debt (@critical) → Tasks 9, 14 · Debts net out across expenses → Tasks 9, 14 · Fund-paid expenses create no debt → Tasks 9, 10, 14 · Deleted expenses are excluded → Tasks 9, 10, 14 · Non-members cannot view balances (`404 SpaceNotFound`) → Tasks 9, 14 · Technical notes: pure domain service + SQL aggregate verified against the in-memory one on the same fixtures → Tasks 9, 10; Σ net = 0 with guests → Tasks 9, 10, 14; keyed on member ids → every balance test. `GetMemberNetBalance` → M2-C (assumption 9) |
| HU-E5-02 (#44) | Full settlement clears the balance (@critical) → Tasks 3, 8, 16 · Partial settlement → Tasks 9, 16 · Over-settlement reverses the direction → Tasks 9, 16 · Settlement with optional accounts updates account balances → Tasks 3 (`netMovements`), 8, 16 · A member cannot settle with themselves (`InvalidSettlementParties`) → Tasks 2 (check), 3, 8, 16 · A member records a settlement paid by a guest → Tasks 8, 16 · Idempotency-Key → Task 16 |
| HU-E4-05 (M1, deferred scenario) | Filter by member in a shared space → Task 11 |
| HU-E1-05 (M2-A, policy-only rows) | "View balances" → Tasks 9, 14 (Sofi reads) · "Luis records an expense paid by Pedro" → Tasks 4, 11 · "Sofi records a settlement for Pedro" (`money.record` denied) → Tasks 8, 16 |

Spec checks: §4 reference example (Rent from the fund, 40/60) → Tasks 6, 13; §5.2 Payment nullability (`memberId` null ⇔ fund, `accountId` null ⇔ guest) → Tasks 4, 6, 11, 13; §5.2 Transaction (EXPENSE Σ payments = Σ shares = amount, TRANSFER into a fund = contribution, SETTLEMENT with optional accounts) → Tasks 2, 3, 6–8; §5.3 rounding (largest remainder in rounding units, ties by join order, exact sums) → Tasks 1, 5; §5.3 default split (EQUAL among active members; BY_ALLOCATION is M3) → Tasks 4, 11; D2 (personal = shared with one participant) → Task 4 (M1 tests unchanged); D5 → Tasks 6, 9, 10, 14, 15; D6 → Tasks 4, 5, 12; D7 → Task 10; D8 (soft delete leaves balances) → Tasks 9, 10, 14, 16; D9 → Tasks 4, 7, 11, 15; D15 → Tasks 4, 7, 8, 11, 15, 16; §7 (Idempotency-Key on every transaction-creating POST, problem+json, OpenAPI snapshot) → Tasks 11–16; §8 (404 SpaceNotFound, 422 NotASpaceMember, 403, 409) → Tasks 11–16.

### Review Focus pins

1. Amounts that do not divide into whole pesos → Task 1 (shuffled order, sub-peso remainder, 1 peso among three), Task 5 (33.33 / 33.33 / 33.34), Task 11 (HTTP remainder with a shuffled request), Task 12 (HTTP two decimals).
2. Member ids that are not current members → Task 1 (foreign, malformed, duplicate participant), Task 4 (payer and participant, duplicate payer), Task 7 (contributor), Task 8 (payer, payee, malformed, same member), Task 11 (another space's member, `not-a-uuid`, duplicate payer), Task 14 (malformed space id), Task 16 (HTTP table).
3. Accounts that are not the party's, or not the requester's to debit → Task 4 (Ana paying from Juan's account; Juan records his own payment), Task 6 (another space's fund, archived fund, malformed id, fund in a member's name, an ownerless non-fund account), Task 7 (foreign and archived funds, `InvalidFundAccount` in a personal space, Ana debiting Juan's account for his contribution), Task 8 (each party's account, fund as destination, Ana debiting Juan's account in a settlement), Task 11, Task 13, Task 15 and Task 16 (HTTP: `404` for a personal account sent as the fund, `422 AccountNotOwned` for debits of another member's account; fund balance unchanged afterwards).
4. Double-submitted money movements → Task 15 (contribution replay; fund moves once; conflicting body `409`), Task 16 (settlement replay; balances move once; conflicting body `409`).
5. Balances after corrections and fund movements → Task 9 (deleted expense and settlement, fund-paid expense, contribution, guests, Σ = 0), Task 10 (SQL and in-memory agree on one fixture with all of them, member totals and account movements alike; one SQL statement keeps Σ = 0 under concurrent writes), Task 14 (HTTP deletion, guests, Σ = 0), Task 16 (deleting a settlement restores the debt).

### Spec contradictions found

1. **COP minor units.** The owner's brief for this plan says COP has 0 minor units; the code (`src/shared/kernel/currency.ts`: exponent 2, rounding unit 100) and spec 5.3 ("COP: 1 peso = 100 minor units") disagree with it. The plan follows the code and the spec: 300,000 COP is `"30000000"` on the wire, splits round to whole pesos, and a sub-peso remainder (only possible when a client sends cents) stays on the first share.
2. **Tie-breaking.** Spec 5.3 gives rounding ties to members in join order; `Money.allocate` gives them to the earlier ratio. `splitShares` sorts participants by join order before allocating, so both hold (Task 1).
3. **"Pairwise debts" in HU-E5-01.** The technical note asks for net per member and pairwise debts; with HU-E5-03 (`DebtSimplifier`) moved out, the endpoint returns net per member only. For two members the pair of nets is the pairwise debt (every HU-E5-01 and HU-E5-02 scenario has two members, plus a guest); who-pays-whom lists for larger groups arrive with HU-E5-03.
4. **Split snapshot.** HU-E4-08 says percentages are stored with two decimals (basis points) in the split snapshot; spec 5.2's `Share` holds only the amount and the `splitMethod` snapshot. The plan accepts two-decimal percentages, converts them to basis points and stores the resulting share amounts and the method; the per-member percentages, units and exact inputs are not persisted. Storing them would need a `shares.split_value` column (a later migration) if edits or recurrences must re-split.
5. **Fund contributions as transfers.** Spec 5.2 defines a TRANSFER as "source account → destination account", but also says a guest's fund contribution has no account. The plan keeps TRANSFER for contributions (HU-E4-09) and allows a null source only when `payer_member_id` is set; `payerMemberId` is the "flagged as fund contribution" marker of HU-E4-09 (no separate flag column).
6. **Mixed fund and member payments.** Neither the spec nor HU-E4-10 says what happens when an expense is paid partly from the fund and partly by a member. The plan rejects it (`409 MixedFundPayment`), so "fund-paid" is a property of the whole expense and D5 stays exact.
7. **Status codes.** Spec 8 says validation → 422 and invariant violations → 409 without classifying the new codes. The plan maps `*Required` codes to 422 explicitly (M1's `CategoryRequired` precedent: `AccountRequired`, `PaymentsRequired`, `ParticipantsRequired`), keeps `SharesDoNotMatchAmount` at 409 (M1) and `GuestHasNoAccounts` at 409 (like M2-A's `GuestHasNoRole`), and lets `InvalidSplit`, `InvalidSettlementParties` and `InvalidFundAccount` take 422 by prefix.
8. **"Only with an explicit warning".** HU-E4-10's scenario title could suggest a confirmation step; its technical note says warnings are non-blocking codes in `warnings[]`. The plan always records the expense and warns.
9. **Account visibility and use (D9).** D9 says other members never see the details of a payer's personal account, and lets a transaction's source account be "the paying member's" without saying who may name it. The transaction DTO keeps M1's shape and shows the payer's `accountId` to every member of the shared space, so the id is known to them; read access is still closed (the account can only be read inside its owner's personal space, `404` elsewhere), but on its own that would not stop another member from *writing* a movement that debits it. Controller ruling (pre-flight N1): a personal account is debited (expense payment, fund contribution source, settlement source) only by a requester whose user owns it, else `422 AccountNotOwned` (`partyAccount`'s `debitedBy`, Tasks 4, 7, 8; HTTP in Tasks 11, 15, 16). Crediting another member's account (a settlement's destination) stays allowed, as HU-E5-02's "to Ana's account Bancolombia" requires. Cost: Ana cannot record that Juan paid from his account; Juan records it himself. Hiding the id from other members would be a DTO change per viewer and is not needed for safety any more.
10. **M1 body of `POST /expenses`.** `accountId` was required; it is now optional (with `payments` as the alternative). A body with neither now answers `422 AccountRequired` instead of `422 ValidationFailed` — same status, different code.

### Assumptions

1. **Authorization** — recording expenses (member, guest or fund payers), fund contributions and settlements is `money.record` (OWNER, ADMIN, MEMBER); reading balances is `space.read`; no new matrix action; `fund.manage` stays account management. Tasks 4, 7, 8, 9.
2. **Default split** — without `split`, EQUAL among **every** current member, viewers and guests included (spec 5.3 "active members"). Tasks 4, 11.
3. **Paying on someone's behalf** — a member records a payment, contribution or settlement for a guest only without an account (D15). A registered payer, contributor or settlement payer must name an account their own user owns (spec 5.2), and only that user may record the debit (contradiction 9, `AccountNotOwned` otherwise); a settlement may credit the receiving member's own account whoever records it. Tasks 4, 7, 8, 11, 15, 16.
4. **Accounts per movement** — expense payers and fund contributors who are registered must name an account (`AccountRequired`); settlement accounts are optional for everyone. Tasks 4, 7, 8.
5. **Zero shares and repeated members** — a split that would give any participant 0 is rejected (`InvalidSplit`), never dropped; a participant or a payer listed twice is `InvalidSplit` (`duplicateParticipant`, `duplicatePayer`). Tasks 1, 4, 11.
6. **Fund recognition** — by `type === "SHARED_FUND"`, mapped to the ledger's `LedgerAccount.isSharedFund` in the composition root; any account of another space (a personal account included) is `AccountNotFound` (no existence leak); a member never pays from the fund in their own name. Tasks 6, 7.
7. **Warnings** — only `FundBalanceNegative`, computed after the insert over all movements (not "as of" the expense date), in the same transaction. It is advisory: under READ COMMITTED two concurrent fund-paid expenses may each miss the other's payment and skip a warning; no lock is added for it. Task 6.
8. **Balances list** — current members in join order, guests included, zeros shown; members no longer current are appended when the totals mention them (none until M2-C). Task 9.
9. **Deferred** — `GetMemberNetBalance` for HU-E1-08/09 (M2-C, built on `GetSpaceBalances`); HU-E5-03 and HU-E5-04 (later plan); editing payers or splits (HU-E4-06 keeps M1's rule); BY_ALLOCATION (M3).
10. **Malformed member ids in bodies** — `422 NotASpaceMember`, because they are matched in memory against the current members, never cast to `uuid`. Tasks 1, 4, 11, 16.
11. **No locks** — money movements need no row locks; double submission is covered by `Idempotency-Key`. Reads that must agree with each other (the balance totals) run as one SQL statement instead (Task 10). Execution Workflow.
12. **Settlement edits** — settlements follow HU-E4-06: creator or OWNER/ADMIN may change amount, date and description, and delete; never a category. Tasks 3, 16.
13. **EXACT inputs** — exact split amounts are taken literally: they must be positive, in the space currency and sum to the amount, but are not forced to whole rounding units (an expense amount itself may carry cents, M1). Rounding to whole pesos applies to the allocated methods (EQUAL, PERCENT, SHARES). Task 5.

### Follow-ups (technical notes not delivered; listed in the PR description)

- **HU-E5-01 (#43) — pairwise debts.** The endpoint returns net per member (contradiction 3); who-pays-whom for more than two members arrives with HU-E5-03 (#45). The controller comments on #43 linking #45.
- **HU-E5-01 (#43) — public `GetMemberNetBalance`.** Built on `GetSpaceBalances` in M2-C, together with its consumers HU-E1-08 and HU-E1-09.
- **HU-E4-08 (#37) — basis points in the split snapshot.** Only share amounts and the method are stored (contradiction 4); a `shares.split_value` column is a later migration, needed only when edits or recurrences must re-split. The controller comments on #37 with this note.

### Stories moved to a later plan

- **HU-E5-03 (#45, Should) — Suggest simplified settlements** and **HU-E5-04 (#46, Should) — Show balance history per member.** Together they add about five tasks (the `DebtSimplifier` domain service and its endpoint; the window-function history query, its in-memory twin and endpoint), which would take this plan past ~20 tasks. They build directly on Task 9 (`netBalances`) and Task 10 (`memberTotals`), and #45 / #46 stay open for the next plan.

### Placeholder and consistency scan

- No "TBD", "similar to Task N" or prose-only code steps: every code step is a whole file or an anchored edit with its exact text.
- Names used across tasks were checked against their producers: `splitShares` / `SplitInput` (Tasks 1, 5) → Tasks 4–6, 11, 12; `partyAccount` (Task 4) → Tasks 6–8; `fundAccount` (Task 6) → Tasks 6, 7; `PaymentInput`, `RecordedExpense`, `LedgerWarning` (Tasks 4, 6) → Tasks 11, 13; `recordFundContribution`, `recordSettlement`, `Settlement` (Task 3) → Tasks 7–10; `MemberMoneyTotals` (Task 9) → Task 10; `BalanceSource`, `createGetSpaceBalances` (Task 9) → Task 14; `householdLedger`, `netOf`, `memberTotals`, `aSettlement` (Tasks 4, 6, 9) → later unit tests (`netOf` and `memberTotals` pinned to SQL in Task 10); `expenseFromBody`, `fundContributionFromBody`, `settlementFromBody` (Tasks 11, 15, 16) → one body-parsing convention for every money route; `household`, `joinHousehold`, `addGuest`, `memberIdOf`, `balancesOf` (Tasks 11, 14) → Tasks 12–16; `sharedLedgerFixture`, `fundAccountFixture` (Task 2) → Tasks 3, 10.
- Every file the plan edits exists on `development` at `16f54e0` (same tree as `9cc22de`; or is created by an earlier task), and every anchor line was matched against it: `checks.ts`, `deps.ts`, `ports.ts`, `record-expense.ts`, `index.ts`, `transaction.ts`, `transaction-rows.ts`, `ledger.schema.ts`, `ledger.contract.ts`, `drizzle-ledger-queries.ts`, both ledger integration tests, `transaction.test.ts`, `container.ts`, `openapi.ts`, `problem.ts`, `problem.test.ts`, `expenses/route.ts`, `tests/support/{fixtures,in-memory-ledger}.ts`, `tests/acceptance/ledger.test.ts`. Imported symbols exist with the signatures used (`authorizeSpaceAction`, `SpaceMemberRepository.listCurrent`, `createSpaceAccess`, `InMemorySpaceStore`, `householdSpace`, `HOUSEHOLD_MEMBERS`, `memberOf`, `Money.allocate`, `moneyFromDto`, `optionalLocalDate`, `createGetAccount`, `notExists`, `alias`, `unionAll`, `AnyColumn`, `problemOf`, `call`, `registerUser`, `actingIn`, `joinAs`, `newSharedSpace`).

