# M3-C Recurring Transactions and Balance History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Hearth's allocated-budgets API (milestone M3) with recurring transactions and the balance history: a member defines a recurring expense, income, transfer or fund contribution on a MONTHLY or SEMI_MONTHLY schedule, edits it for the occurrences not recorded yet, pauses, resumes and ends it; an in-container job records every due AUTO occurrence through the ledger's own use cases exactly once per recurrence and date, catching up missed runs, splitting each occurrence by the ACTIVE plan of its period and skipping CLOSED periods; a CONFIRM recurrence leaves a pending occurrence that a member confirms with the real amount or skips; and every member reads the running net balance of any current member of a space, movement by movement, over an optional date range.

**Architecture:** Recurrences live in the `ledger` module (backlog: Module `ledger`). The domain gains pure rules: the schedule dates (`scheduleDates`, Task 1, `domain/recurrence-schedule.ts`, the anchor rules of the kernel's `PeriodPolicy`), the recurrence and its lifecycle (`defineRecurrence`, `statusOf`, `upcomingDates`, `revisedRecurrence`, `pausedRecurrence`, `resumedRecurrence`, `endedRecurrence`, `blockerOf`, Tasks 2a, 2b, `domain/recurrence.ts`) and the occurrence (`domain/occurrence.ts`, Task 2b). One migration, `0011_recurrences`, adds `recurrences` (the template in transaction-shaped columns, a `due_from` cursor) and `recurrence_occurrences` (unique per recurrence and date); one `DrizzleRecurrenceRepository` implements `RecurrenceRepository` and `OccurrenceRepository` with an in-memory twin pinned against it (Tasks 3a–3c). Every occurrence is recorded by the use case a member would call (`RecordExpense`, `RecordIncome`, `RecordTransfer`, `RecordFundContribution`, through `recordOccurrence`, Task 8a), so the permission matrix, archived spaces, D9, M3-B's `ClosedPeriodGuard` and M3-B's `DefaultSplitSource` (`BY_ALLOCATION` with the ACTIVE plan of each occurrence's date) apply unchanged and the ledger still never imports budgeting. `MaterializeDueOccurrences` (Tasks 8b, 8c) runs behind a kernel `Scheduler` port whose adapter, `TimerScheduler`, is started by `src/instrumentation.ts` inside the app container (Task 9a); no endpoint triggers it (ruling P20). The balance history (HU-E5-04) is a `balances` query over one SQL window function in `DrizzleLedgerQueries.memberHistory`, computed on read (D7, Tasks 13a, 13b).

**Tech Stack:** Node.js 24.21.0, pnpm 12.11.2, Next.js 16.4.0 (App Router route handlers, `instrumentation.ts`), React 19.3.0, TypeScript 6.0.3 strict, Zod 4.6.5, zod-openapi 6.0.2, drizzle-orm 0.45.4 + drizzle-kit 0.31.11, pg 8.23.1, better-auth 1.7.7, Vitest 5.0.3 (fake timers in Task 9a), PostgreSQL 18.6 (Docker CLI in tests). No new dependencies.

**Spec:** `docs/specs/2026-10-11-hearth-design.md` (approved 2026-10-11; sections 4, 5.2 (Recurrence, Transaction, Payment, Share, SpaceMember, BudgetPlan), 5.3 (default split, rounding, periods), 5.4, 7 (HTTP conventions, idempotency on POSTs that create a transaction or a recurrence), 8 and decisions D2, D5, D6, D7, D8, D9, D10, D12, D13, D15, D17, D18 bind this plan). Stories: `docs/backlog/E4-ledger.md` (HU-E4-11 … HU-E4-13, from line 437), `docs/backlog/E5-balances-and-settlements.md` (HU-E5-04, from line 147) and the dependency rows of `docs/backlog/README.md` (HU-E4-11 ← HU-E4-07, HU-E0-04, HU-E1-10; HU-E4-12 ← HU-E4-11, HU-E6-07, HU-E6-08; HU-E4-13 ← HU-E4-12; HU-E5-04 ← HU-E5-02). Format template and precedent: `docs/plans/2026-10-15-m3b-plan-lifecycle.md`, whose rulings P10–P19 stay in force with M3-A's P1–P9 (P8 as amended) and preflight notes N1–N6. GitHub Project: https://github.com/users/Facabore/projects/4.

**Baseline: `development` at `0dc49ce` (M3-B merged in PR #93; the preflight dry-ran this plan at `05bc6c5`, the same code).** This plan executes, and its preflight dry run runs, only after `docs/plans/2026-10-15-m3b-plan-lifecycle.md` is merged (its Tasks 1–6 are committed as of `d7ae3e2`; Tasks 7–15b deliver exactly what that plan's code blocks show). It relies on M3-B's names as final: `ClosedPeriodGuard` (ledger port, bound to budgeting's `createClosedPeriodGuard` in `src/composition/container.ts` by M3-B Task 5b; it reads the covering plan `FOR SHARE`), `DefaultSplitSource` and `DefaultSplitQuery` (`src/modules/ledger/application/ports.ts`, M3-B Task 13), `LedgerDeps.defaultSplits` (M3-B Task 13, bound to `defaultSplitOf` by M3-B Task 15b), `RecordExpense` checking the closed period before it reads the default split (M3-B Task 13, ruling P14), the `defaultSplits` line of `ledgerFixture` in `tests/support/in-memory-ledger.ts` (M3-B Task 13), and `activatePlan`, `closePlan` in `tests/support/budgeting.ts` (M3-B Tasks 5a, 5b). Every anchor below names a line that M3-B leaves as it is today or writes in the form its code blocks show; where M3-B changes a file this plan also edits (`src/composition/container.ts`, `src/modules/ledger/application/index.ts`, `tests/support/in-memory-ledger.ts`), this plan anchors on lines M3-B does not touch or appends to the end of the file.

**Out of scope (later plans):** M4 reporting, epic E7 (HU-E7-01 … HU-E7-05; the line dashboard's "expected" pending occurrences of HU-E4-13's note belong to HU-E7-01); the web UI, epic E9 (HU-E9-09 recurring transactions and pending confirmations screens, including the schedule preview of a recurrence not yet defined; HU-E9-07's history view). Also out: WEEKLY and BIWEEKLY schedules (HU-E8-09), notifications of pending occurrences (HU-E8-08), recurring settlements (the backlog lists expense, income, transfer and fund contribution only), `EXACT` recurrence splits (ruling P23), pagination of the new lists (ruling P28), the balance history of former members (ruling P29), and a recurrence id on transactions (ruling P31).

## Global Constraints

- Node.js `24.21.0`; pnpm `12.11.2`; Next.js `16.4.0`; React `19.3.0`; TypeScript `6.0.3` with `strict: true` and `noUncheckedIndexedAccess: true`; Zod `4.6.5`; zod-openapi `6.0.2`; drizzle-orm `0.45.4`; drizzle-kit `0.31.11`; pg `8.23.1`; better-auth `1.7.7`; Vitest `5.0.3`; PostgreSQL image `postgres:18.6-alpine`. No new dependencies; `pnpm check:pinned` must keep passing.
- Money is `bigint` minor units in code and `bigint` columns in PostgreSQL (D6); over HTTP it is `{ "amount": "<minor units as string>", "currency": "<ISO 4217>" }`. COP has exponent 2 and a rounding unit of 100 minor units (`src/shared/kernel/currency.ts`, spec 5.3): 1,200,000 COP is `"120000000"` on the wire. Shares come only from the ledger's `splitShares` (`Money.allocate`: largest remainder in rounding units, ties to members in join order, Σ shares = amount exactly); a recurrence stores ratios, never amounts (ruling P23). Running balances may be negative and are bigint too.
- Every money reference points to a `SpaceMember`, never to a user (D15). Splits and default splits follow the **current** members at the moment an occurrence is recorded (`listCurrent`, join order, rulings P7 and P23); a recurrence whose payer or creator left pauses (ruling P26).
- **Every delete is logical (owner directive, spec D8):** M3-C removes nothing. A recurrence is ended (`ended_at`) or paused (`paused_at`), never removed; a skipped occurrence is a row with status `SKIPPED`; a confirmed occurrence keeps its row and points to its transaction. No task in this plan adds a physical delete.
- **Authorization only through the permission matrix** (`src/modules/spaces/domain/permissions.ts`, unchanged; membership first): `DefineRecurrence`, `ConfirmOccurrence`, `SkipOccurrence` and `ListPendingOccurrences` are `money.record` (OWNER, ADMIN, MEMBER); updating, pausing, resuming and ending follow the ledger's `canModify` (its creator, or OWNER and ADMIN, the `money.editAny` roles; ruling P30); the reads and `GetMemberBalanceHistory` are `space.read`; each AUTO occurrence is recorded by `RecordExpense` (or the matching use case) as the recurrence's creator, so `money.record` applies to that user on every run (ruling P21). M3-C adds no matrix action and no hardcoded role list.
- **Archived spaces only read (HU-E1-09):** `SpaceAccess` answers `409 SpaceArchived` to every recurrence write, confirmation and skip (they reach the space without `readOnly`), while `GET …/recurrences`, `GET …/recurrences/{id}`, `GET …/occurrences`, `GET …/pending-occurrences` and `GET …/balance-history` keep answering `200`. An AUTO occurrence of an archived space is refused by `RecordExpense` (`SpaceArchived`) and pauses its recurrence (ruling P26, pinned in Task 8c).
- **Recurrence writes serialize on the recurrence row:** every write (`UpdateRecurrence`, `PauseRecurrence`, `ResumeRecurrence`, `EndRecurrence`) and every scheduler run takes `lockForWrite` (`FOR NO KEY UPDATE`) and decides only on the row it read under that lock (preflight N4 applied to recurrences); confirm and skip lock the occurrence row the same way. No `ETag`/`If-Match` on recurrences (spec 7 names transactions and plans; ruling P27).
- **Idempotency (spec 7):** `POST …/recurrences` and `POST …/pending-occurrences/{occurrenceId}/confirm` honour `Idempotency-Key` (`withIdempotency`); the scheduler is idempotent by construction: the `due_from` cursor under the row lock, and the unique key `recurrence_occurrences_date_uq (recurrence_id, occurrence_date)` (spec 5.2, ruling P20).
- Repositories guard identifiers that come from requests with `isUuid` before querying `uuid` columns (malformed ids return `null`, `[]`, an empty map or an empty history, never a `500`). Member ids from requests (`memberId` of the balance history, split participants, payers) are checked against lists already loaded from the space.
- HTTP errors are RFC 9457 `application/problem+json` with a stable `code` (the domain error name) and `requestId`; the API never returns translated text. Status mapping lives only in `src/shared/http/problem.ts` (explicit map, then `*NotFound` → 404, `Invalid*` → 422, else 409). New codes: `InvalidRecurrenceTransition` (explicit 409, ruling P27), `RecurrenceNotFound` and `OccurrenceNotFound` (404 by default), `RecurrenceEnded` and `OccurrenceNotPending` (409 by default), `InvalidRecurrence` and `InvalidOccurrenceDate` (422 by default); pause and skip reasons `PayerLeft` and `CreatorLeft` are reason codes, never errors. Each joins the backlog's catalogue (spec 8) in the task that exposes it over HTTP, as a note of its story.
- Hexagonal boundaries (ADR 0001): domain imports only its own domain and `src/shared/kernel`; application never imports infrastructure, contracts, HTTP, frameworks or the ORM; other modules are reached only through `src/modules/<m>/application/index.ts`; `*.schema.ts` may import other modules' `*.schema.ts`; no import cycles (`no-circular` counts type-only imports, `tsPreCompilationDeps: true`). The ledger still never imports budgeting; the kernel's new `Scheduler` is an interface only; `src/composition/recurrence-job.ts` and `src/instrumentation.ts` are the only places that start the job.
- **One schema change:** migration `0011_recurrences` (Task 3a) creates `recurrences` and `recurrence_occurrences`; it is generated with `pnpm db:generate --name recurrences` and committed with `drizzle/meta/0011_snapshot.json` and the journal entry. No later task edits a `*.schema.ts`, so `pnpm db:check` keeps reporting no drift.
- Strict TDD: every behaviour starts with a failing test that is run and seen failing. Scenarios run as domain or use-case unit tests first; `@critical` and `@golden` scenarios also run in-process against the route handlers with real PostgreSQL (`tests/acceptance/`); the scheduler's job is driven there through `Container.ledger.materializeDueOccurrences({ today })`, which is what the in-container timer calls (no endpoint exists, ruling P20).
- Code, identifiers, comments, docs and generated artifacts in English. Conventional commits referencing the story issue (`Refs #<n>`); no AI attribution or `Co-Authored-By` lines.
- Gates for every task: `pnpm exec vitest run --project unit`, `pnpm exec vitest run --project integration`, `pnpm exec vitest run --project acceptance`, `pnpm format`, `pnpm exec eslint .`, `pnpm exec tsc --noEmit`, `pnpm exec prettier --check .`, `pnpm lint:boundaries`, `pnpm db:check`.
- OpenAPI: no new `…Output` component. Three new components: the request-only `RecurrenceDefinition` (Task 6e2, with its first operation) and the response-only `Recurrence` (Task 6d) and `Occurrence` (Task 11a, with its first operations; `Recurrence.lastOccurrence` inline so that no `OccurrenceOutput` appears); every new operation references them or the existing `RecordedExpense`, `Money` and `Problem`; no response schema is registered from a request schema or the other way round.

## Review Focus

1. **Two scheduler runs, or a run and a member, at the same time** (two app containers, the timer firing while a run is still recording, a pause committed while a run waits for the recurrence, a confirm and a skip of one pending occurrence at once): exactly one occurrence and one transaction per recurrence and date, no failure reported; a run that waited sees the committed pause and records nothing; one of confirm and skip wins and the other answers `OccurrenceNotPending` — pinned in Task 12 (three rendezvous tests, each red without the lock it pins), Task 3c (the unique key refuses a second row for a date), Task 9a (the timer never overlaps two runs) and Task 8b (a second run on the same day records nothing).
2. **Dates on the schedule's and the period's edges** (MONTHLY(31) through February and a leap year, SEMI_MONTHLY(30, 31) collapsing to one February date, a start date before the definition day, an end date that is a schedule date, a resume on a schedule date, an occurrence on the first or last day of a CLOSED plan, a confirmed date in the next period): clamped dates exactly once, nothing back-filled before the definition or within a pause, the end date inclusive, `PeriodClosed` exactly inside the stored dates, `InvalidOccurrenceDate` outside the occurrence's period — pinned in Tasks 1, 2a, 2b, 8b, 9b, 10 and 11b.
3. **Members who leave and roles that change** (Juan pays Internet and leaves, Ana's fund-paid Rent after Ana leaves, the guest Pedro removed while paying, a split participant leaving, the creator demoted to VIEWER, Sofi the VIEWER confirming, Juan changing an amount debited from Ana's account): `PayerLeft`, `CreatorLeft` or the refusing code pauses the recurrence and its date is `SKIPPED` with that reason; resuming checks the template again (`NotASpaceMember`); `InsufficientRole`; `AccountNotOwned` — pinned in Tasks 2b, 4, 5, 6e, 7a, 7b, 8a, 8c, 10 and 11b.
4. **Money split per period and rounded** (Internet 120,000 COP `BY_ALLOCATION` 40/60 in 2026-12 and 50/50 in 2027-01, Electricity estimated 180,000 and confirmed at 205,300 COP, Rent 1,200,000 then 1,300,000 COP, a running balance through a soft-deleted expense): shares by each occurrence's ACTIVE plan, snapshots once recorded, 82,120 / 123,180 COP, the history -150,000 then -50,000 COP — pinned in Tasks 8a, 8b, 9b, 10, 11b, 13a, 13b and 14.
5. **Identifiers from elsewhere and archived spaces** (a recurrence or pending occurrence of another space, malformed ids, another space's fund as payer, a member of another space in the balance-history path, any recurrence write in an archived space while its reads answer `200`, an AUTO occurrence there): `404 RecurrenceNotFound`, `OccurrenceNotFound`, `AccountNotFound` or `MemberNotFound` (never `500`), `409 SpaceArchived`, a recurrence paused with `SpaceArchived` — pinned in Tasks 3b, 3c, 4, 5, 6e, 6f, 7a, 7b, 8c, 11a, 13a, 13b and 14.

## Execution Workflow

- Work on the long-lived branch `development` after the M3-B merge; every task is implemented there with Strict TDD. Implementers stage; the controller commits.
- **RDD before every commit** (receipt-driven development is on; check with `gentle-ai review mode status`). Each "Commit" step means:
  1. Run every source-mutating normalizer first (`pnpm format`, regenerated migrations or snapshots), then stage exactly the files of the task.
  2. Run `gentle-ai review status --cwd . --contract gentle-ai.review-integration/v2 --agent claude-code --next-transition` and follow only the returned `next_transition` (`execute` its operation, satisfy `collect` inputs, or stop on `stop` and report its reason code with its documented continuation). Medium/high-risk candidates may return a consent envelope; relay it to the owner and wait.
  3. Commit only after the provider-returned `review.validate` allows the `pre-commit` gate for that exact staged candidate; the commit must not change the reviewed bytes.
  4. If the owner disables RDD (`gentle-ai review mode disable --scope clone --cwd .`), commit under ordinary policy and report `disabled/unmanaged`.
- Code blocks in this plan are complete but not guaranteed to match Prettier's line wrapping: run `pnpm format` before the gates of every task (the gates then run `prettier --check`). Anchors in this plan name lines that Prettier leaves alone (short statements, JSDoc and `//` comments, existing lines already formatted, the last line of a file); when an anchor is a range, it is given by its first and last lines. Where a later task edits a line an earlier task wrote, the earlier task writes it in its final Prettier form (multi-line imports when they exceed 110 characters).
- Every code block the executor writes is introduced by a line naming its file path in backticks and ending with a colon. "Create" blocks are whole files; "Replace the contents" blocks are whole files too; edits to existing files name a unique anchor line ("after the line …", "replace the line …", "insert before the line …", "append to the end of the file", "insert before the last line of the file").
- **Task labels:** the parts of a task carry a lower-case letter (2a, 2b, 3a–3c, 6a, 6c–6f, 6e2, 7a, 7b, 8a–8c, 9a, 9b, 11a, 11b, 13a, 13b); each is its own commit and RDD pass, executed in the order 1, 2a, 2b, 3a, 3b, 3c, 4, 5, 6a, 6c, 6d, 6e, 6e2, 6f, 7a, 7b, 8a, 8b, 8c, 9a, 9b, 10, 11a, 11b, 12, 13a, 13b, 14 (28 commits). There is no Task 6b: preflight B6 deleted it, because a request component is registered in the commit of its first operation (Task 6e2).
- **Repository ports are separate interfaces**, as in M3-A and M3-B: `RecurrenceRepository` (Task 3b) and `OccurrenceRepository` (Task 3c) in `src/modules/ledger/application/recurrence-ports.ts`, implemented by one `DrizzleRecurrenceRepository` and one in-memory twin, `InMemoryRecurrences` (`tests/support/in-memory-recurrences.ts`); `src/modules/ledger/infrastructure/recurrences.int.test.ts` runs the same sequence against both and compares the outcomes, so a twin that drifts from its adapter fails a test. The balance history's SQL (`DrizzleLedgerQueries.memberHistory`) is pinned the same way against `InMemoryTransactions.memberHistory` (Task 13a).
- **Measured sizes (preflight N1, carried from M3-A and M3-B):** each task is one commit sized for review, target under ~400 changed lines (OpenAPI snapshot growth included), and **a task over ~500 changed lines is split into two commits, each green on its own**. M3-A's commits measured 1.4–1.9 × their raw estimates; M3-B applied that ratio, and its committed tasks then measured 0.5–1.0 × their estimates (`git show --numstat`, generated files excluded: Task 1 135 of ~260, Task 2 227 of ~330, Task 3 198 of ~380, Task 4 305 of ~420, Task 5a 334 of ~460 with 117 snapshot lines, Task 5b 489 of ~480 with 113, Task 6 310 of ~380). The sizes below were **measured in the preflight dry run** with every preflight fix applied (one throwaway commit per task on `05bc6c5`, `git show --numstat`, generated `drizzle/` files excluded, OpenAPI snapshot lines included and given in parentheses where the preflight reported them; N2–N4 add about 5–20 lines each to Tasks 13a, 9a and 8c): Task 1 99, 2a 346, 2b 380, 3a 175 (+3,164 generated), 3b 414, 3c 306, **4 479** (split point if a candidate measures over ~500: `checkTemplate`, the view, `DefineRecurrence`, the support world and the first four scenarios | the template matrix and the personal-space scenarios), **5 451** (split point: the four writes and their scenarios | the three reads and theirs), 6a 224, 6c 334, 6d 356, 6e 287, **6e2 611 by `--minimal`** (snapshot 555; 927 and 871 by default Myers), **6f 467** (228; split point: list and read | the preview), **7a 466** (294; split point: the contract, route and container with the first two scenarios | the remaining scenarios), **7b 462** (262; split point: pause and resume | end, the problem rows and the backlog note), 8a 238, 8b 405, 8c 116, 9a 298, 9b 240, 10 323, 11a 471 (232), 11b 323 (124), 12 298, 13a 297, 13b 214, 14 431 (177). The snapshot growth of each OpenAPI change was measured first by rendering this plan's Zod schemas with the repository's zod-openapi 6.0.2 in a scratch document (the M3-B calibration: `POST …/expenses` 308 lines, `POST …/plans/{planId}/close` 99, the `BudgetPlan` component 354): `RecurrenceDefinition` 336, `Recurrence` 347, `Occurrence` 70, `POST …/recurrences` 105 (its body a `$ref`; 438 inline), the three reads 232, `PATCH` 298, the three moves 264, the pending list and skip 164, confirm 126, the balance history 179. Generated files (`drizzle/0011_recurrences.sql`, `drizzle/meta/*`) are excluded from the count. The controller measures each staged candidate (`git diff --cached --numstat`, generated files excluded) before RDD and splits at the named point when it is over ~500. **One accepted exception (controller ruling on preflight B6):** Task 6e2 is the single documented oversized commit, because a request component plus its first operation is about 441 generated snapshot lines that cannot be split, and it is measured with `git diff --cached --numstat --minimal` (611 lines).
- The OpenAPI snapshot changes in Tasks 6d (component `Recurrence`, after every existing component; no operation), 6e2 (component `RecurrenceDefinition` and `POST …/recurrences`; `Recurrence` moves to its final place, +497/−58), 6f (`GET …/recurrences`, `GET …/recurrences/{recurrenceId}`, `GET …/recurrences/{recurrenceId}/occurrences`), 7a (`PATCH …/recurrences/{recurrenceId}`), 7b (`POST …/pause`, `…/resume`, `…/end`), 11a (component `Occurrence`, inserted at its final place, with `GET …/pending-occurrences` and `POST …/pending-occurrences/{occurrenceId}/skip`; +232/−0), 11b (`POST …/pending-occurrences/{occurrenceId}/confirm`) and 14 (`GET …/members/{memberId}/balance-history`). Task 6e adds `POST …/recurrences` to the API and changes no OpenAPI file, so nothing moves there. zod-openapi 6.0.2 emits a manually registered component that no operation references last, in the output context (preflight B6), so a request component is registered only in the commit of its first operation. If a `RecurrenceOutput`, `OccurrenceOutput` or any other new `…Output` variant appears in a snapshot diff, a request schema is reusing a response schema: fix the contract instead of accepting the snapshot.
- **One concurrency task (Task 12)** adds three rendezvous tests in `src/modules/ledger/infrastructure/concurrent-occurrences.int.test.ts` with lock helpers in `tests/support/locks.ts`; each is red when the lock it pins is removed (named per test).
- **Characterization tests (Strict TDD, preflight N6):** Tasks 9b and 12 add tests that pass on their first run, because they pin behaviour that Tasks 8a–8c, 9a and 10 already implement; their red evidence is the task's mutation checks, each run and seen red before it is restored (the M3-B precedent).
- When a task starts, move its story issues to **In Progress** on Project #4. When all tasks are done, open one pull request from `development` into `main`. It closes #40, #41, #42 and #46 and completes milestone M3. Its description also lists, as PR notes: (1) the in-container job (`RECURRENCE_JOB_INTERVAL_SECONDS`, default 300, `0` turns it off) and that it runs in every app container, safely; (2) every AUTO occurrence is recorded on behalf of its recurrence's creator and every confirmation on behalf of the confirming member, by the ordinary ledger use cases (P21); (3) the new `RecurrenceDefinition`, `Recurrence` and `Occurrence` components and the new error codes; (4) the controller rulings P20–P31 of the Self-Review, as ruled; (5) the follow-ups in the Self-Review.
- Task-to-issue map (issues are titled with their story ID): HU-E4-11 → #40 (Tasks 1, 2a, 2b, 3a, 3b, 4, 5, 6a, 6c, 6d, 6e, 6e2, 6f, 7a, 7b, 8c), HU-E4-12 → #41 (Tasks 2b, 3a, 3b, 3c, 8a, 8b, 8c, 9a, 9b, 12), HU-E4-13 → #42 (Tasks 2b, 3a, 3c, 6c, 8b, 10, 11a, 11b, 12), HU-E5-04 → #46 (Tasks 13a, 13b, 14). HU-E5-04 is an M2 story (Should) delivered here; its milestone row stays M2.

## File Structure

```
.
├── compose.yaml                                                     # RECURRENCE_JOB_INTERVAL_SECONDS (Task 9a)
├── docs/
│   ├── backlog/E4-ledger.md                                         # notes of HU-E4-11 … HU-E4-13 (Tasks 6e, 6f, 7b, 9b, 11b)
│   ├── backlog/E5-balances-and-settlements.md                       # HU-E5-04 note (Task 14)
│   ├── operations/deploy.md                                         # the recurring-transactions job (Task 9a)
│   └── specs/2026-10-11-hearth-design.md                # 5.2 Recurrence amended (Task 9b, rulings P21–P24)
├── drizzle/0011_recurrences.sql (+ meta/0011_snapshot.json, _journal.json)   # Task 3a, generated
├── openapi/openapi.snapshot.json                                    # Tasks 6d, 6e2, 6f, 7a, 7b, 11a, 11b, 14
├── src/
│   ├── instrumentation.ts                                           # starts the job (Task 9a)
│   ├── shared/kernel/{scheduler,index}.ts                           # Scheduler port (Task 9a)
│   ├── shared/infrastructure/{timer-scheduler,env}.ts               # TimerScheduler, the interval (Task 9a)
│   ├── shared/http/problem.ts                                       # InvalidRecurrenceTransition 409 (Task 7b)
│   ├── composition/
│   │   ├── container.ts                                             # Tasks 6e, 6f, 7a, 7b, 9a, 11a, 11b, 14
│   │   ├── recurrence-job.ts                                        # startRecurrenceJob (Task 9a)
│   │   └── openapi.ts                                               # components (6d, 6e2, 11a), paths (6e2) (+ openapi.test.ts, 6d, 6e2, 11a)
│   ├── modules/
│   │   ├── ledger/
│   │   │   ├── domain/recurrence-schedule.ts                        # Schedule, scheduleDates (Task 1)
│   │   │   ├── domain/recurrence.ts                                 # Recurrence and its lifecycle (Tasks 2a, 2b)
│   │   │   ├── domain/occurrence.ts                                 # Occurrence (Task 2b)
│   │   │   ├── application/recurrence-ports.ts                      # repositories, RecurrenceDeps (Tasks 3b, 3c)
│   │   │   ├── application/recurrence-template.ts                   # checkTemplate (Task 4)
│   │   │   ├── application/recurrence-view.ts                       # RecurrenceView (Task 4)
│   │   │   ├── application/define-recurrence.ts                     # DefineRecurrence (Task 4)
│   │   │   ├── application/manage-recurrence.ts                     # Update/Pause/Resume/End (Task 5)
│   │   │   ├── application/recurrence-queries.ts                    # List/Get/Upcoming (Task 5)
│   │   │   ├── application/record-occurrence.ts                     # recordOccurrence (Task 8a)
│   │   │   ├── application/materialize-recurrence.ts                # one recurrence's run (Tasks 8b, 8c)
│   │   │   ├── application/materialize-occurrences.ts               # MaterializeDueOccurrences (Task 8b)
│   │   │   ├── application/pending-occurrences.ts                   # List/Confirm/Skip (Task 10)
│   │   │   ├── application/{ports,index}.ts                         # history types (Task 13a), exports (every task)
│   │   │   ├── infrastructure/recurrences.schema.ts                 # two tables (Task 3a)
│   │   │   ├── infrastructure/drizzle-recurrence-repository.ts      # Tasks 3b, 3c
│   │   │   ├── infrastructure/drizzle-ledger-queries.ts             # memberHistory (Task 13a)
│   │   │   ├── infrastructure/recurrences.int.test.ts               # Tasks 3a, 3b, 3c
│   │   │   ├── infrastructure/concurrent-occurrences.int.test.ts    # Task 12
│   │   │   ├── infrastructure/drizzle-balance-history.int.test.ts   # Task 13a
│   │   │   └── contracts/recurrences.contract.ts                    # Tasks 6a, 6c, 6e, 6e2, 6f, 7a, 7b, 11a, 11b (+ .test.ts, 6a, 6c)
│   │   └── balances/
│   │       ├── application/get-member-balance-history.ts            # Task 13b
│   │       └── contracts/balances.contract.ts                       # Task 14
│   └── app/api/v1/spaces/[spaceId]/
│       ├── recurrences/route.ts                                     # POST (6e), GET (6f)
│       ├── recurrences/[recurrenceId]/route.ts                      # GET (6f), PATCH (7a)
│       ├── recurrences/[recurrenceId]/occurrences/route.ts          # GET (6f)
│       ├── recurrences/[recurrenceId]/{pause,resume,end}/route.ts   # POST (7b)
│       ├── pending-occurrences/route.ts                             # GET (11a)
│       ├── pending-occurrences/[occurrenceId]/skip/route.ts         # POST (11a)
│       ├── pending-occurrences/[occurrenceId]/confirm/route.ts      # POST (11b)
│       └── members/[memberId]/balance-history/route.ts              # GET (14)
└── tests/
    ├── support/
    │   ├── in-memory-recurrences.ts   # InMemoryRecurrences (3b, 3c), recurrenceWorld, rentDefinition (4), materializerWorld (8b)
    │   ├── in-memory-ledger.ts        # memberHistory twin (Task 13a)
    │   ├── recurrences.ts             # HTTP helpers and DTO types (6e, 6f, 7a, 7b, 9b, 11a, 11b)
    │   ├── locks.ts                   # until, someoneWaitsFor, holder, outcomesOf (Task 12)
    │   └── app.ts                     # RECURRENCE_JOB_INTERVAL_SECONDS: 0 (Task 9a)
    └── acceptance/
        ├── recurrences.test.ts            # Tasks 6e, 6f, 7a, 7b
        ├── recurring-occurrences.test.ts  # Task 9b
        ├── pending-occurrences.test.ts    # Tasks 11a, 11b
        └── balance-history.test.ts        # Task 14
```

Test layout follows M0–M3-B: unit tests next to the code as `*.test.ts` (no database), integration tests as `*.int.test.ts` (real PostgreSQL via `testDatabase()`), acceptance tests in `tests/acceptance/` calling the exported route handlers in-process. Shared test doubles live in `tests/support/`. Run a single file with `pnpm exec vitest run --project <unit|integration|acceptance> <path>`. Integration and acceptance projects start a disposable PostgreSQL container through the Docker CLI (`tests/support/postgres-global-setup.ts`) and apply every migration in `drizzle/`, so Docker must be running. Integration files run in parallel on one database, so a test that runs the scheduler against PostgreSQL restricts `listActive` to its own recurrences (Task 12); acceptance files run one at a time (`fileParallelism: false`) and assert only on their own fresh household.

### How recurrence actions are authorized

No matrix action is added; M3-C reuses `money.record`, `money.editAny` (through `canModify`) and `space.read`.

| Use case | Matrix action | Roles | Other rules (where they live) |
|---|---|---|---|
| `DefineRecurrence` | `money.record` | OWNER, ADMIN, MEMBER | `checkTemplate` for the definer as requester (P21; D9: only the payer defines a recurrence that debits their own account) |
| `UpdateRecurrence`, `PauseRecurrence`, `ResumeRecurrence`, `EndRecurrence` | membership, then `canModify` | its creator (OWNER, ADMIN, MEMBER), or OWNER and ADMIN for anyone's | under the recurrence's row lock; an amount debited from a personal account is its creator's only (`AccountNotOwned`, P22); resume checks the template again (P26) |
| `ListRecurrences`, `GetRecurrence`, `ListUpcomingOccurrences` | `space.read` | every role | archived spaces read |
| `MaterializeDueOccurrences` | none itself (the system job, P20) | — | each AUTO occurrence is recorded by `RecordExpense` (or the matching use case) as the creator: `money.record`, archived spaces, D9, `ClosedPeriodGuard`, `DefaultSplitSource` |
| `ListPendingOccurrences` | `money.record`, read-only access | OWNER, ADMIN, MEMBER | archived spaces read (HU-E4-13 note: "listed for members with role MEMBER or above") |
| `ConfirmOccurrence` | `money.record` | OWNER, ADMIN, MEMBER | recorded with the confirmer as requester (D9); `PeriodClosed`; the date stays within the occurrence's period (`InvalidOccurrenceDate`) |
| `SkipOccurrence` | `money.record` | OWNER, ADMIN, MEMBER | only a PENDING occurrence (`OccurrenceNotPending`) |
| `GetMemberBalanceHistory` | `space.read` | every role | a current member of the space only (`MemberNotFound`, P29) |

### Every path that touches a recurrence rule

| Rule | Paths | Where it is enforced |
|---|---|---|
| Schedule dates follow the PeriodPolicy anchors, clamped (spec 5.2, HU-E4-11) | definition, preview, every run | `scheduleOf`, `scheduleDates` (Task 1) |
| A recurrence is due from its start or its definition day, whichever is later; a pause skips without back-filling (P24) | `DefineRecurrence`, `ResumeRecurrence`, every run | `defineRecurrence` (Task 2a), `resumedRecurrence` (Task 2b); the `due_from` cursor (Tasks 3a, 8b) |
| One occurrence per recurrence and date, whatever races (spec 5.2, P20) | every run | `lockForWrite` re-read (Tasks 3b, 8b), `recurrence_occurrences_date_uq` (Tasks 3a, 3c), raced in Task 12 |
| An occurrence is recorded by the use case a member would call (P21) | AUTO runs, confirmations | `recordOccurrence` (Task 8a): the matrix, D9, closed periods, default splits |
| Occurrences of a CLOSED period are skipped; a pending one is refused there (spec 5.2, HU-E4-12, HU-E4-13, P25) | AUTO and CONFIRM runs, `ConfirmOccurrence` | `RecordExpense`'s `openPeriod` (M1, bound by M3-B 5b); `openPeriod` for CONFIRM runs (Task 8b) |
| `BY_ALLOCATION` with the plan of each occurrence's period (spec 5.2, HU-E4-12) | AUTO runs, confirmations of a recurrence without a split | M3-B's `DefaultSplitSource` → `defaultSplitOf`, reached through `RecordExpense` |
| A payer or creator who left, or any other refusal, pauses the recurrence (HU-E4-11, P26) | every run; resume | `blockerOf` (Task 2b), `materializeRecurrence` (Task 8c); `rechecked` on resume (Task 5) |
| Edits apply to occurrences not recorded yet; recorded ones are snapshots (spec 5.2, HU-E4-11) | `UpdateRecurrence` | the run reads the template under the lock (Task 8b); stored transactions never change |
| Balance history = running net per movement, computed on read (HU-E5-04, D7) | `GET …/balance-history` | `DrizzleLedgerQueries.memberHistory` (window function, Task 13a) |

---

### Task 1: Ledger domain — recurrence schedules

Implements HU-E4-11's schedule rules (issue #40). Pins Review Focus 2 (clamped dates, collapsing anchors, an inclusive end).

Decisions:
- A schedule **is** a `PeriodPolicy` (spec 5.2: "same anchor rules as `PeriodPolicy`"): its dates are the days its periods would start on, so `scheduleDates` walks `periodFor` from the kernel and adds no calendar code. `scheduleOf` validates anchors with the kernel's `monthly` and `semiMonthly`, so a bad anchor answers `InvalidPeriodPolicy` exactly as a space's period policy does (HU-E1-03).
- `scheduleDates` always takes a limit: an open-ended recurrence (no end date) has endless dates, and every caller asks for a bounded number (a preview, one run's catch-up).

**Files:**
- Create: `src/modules/ledger/domain/recurrence-schedule.ts`
- Test: create `src/modules/ledger/domain/recurrence-schedule.test.ts`

**Interfaces:**
- Consumes: `periodFor`, `addDays`, `monthly`, `semiMonthly`, `PeriodPolicy`, `LocalDate`, `Result` (`src/shared/kernel`).
- Produces: `type Schedule = PeriodPolicy`; `scheduleOf(input: PeriodPolicy): Result<Schedule>` — `InvalidPeriodPolicy`; `firstDateFrom(schedule: Schedule, from: LocalDate): LocalDate`; `scheduleDates(schedule: Schedule, window: { from: LocalDate; through: LocalDate | null }, limit: number): LocalDate[]`.

- [ ] **Step 1: Write the failing test**

`src/modules/ledger/domain/recurrence-schedule.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate, PeriodPolicy } from "@/shared/kernel";
import { firstDateFrom, scheduleDates, scheduleOf } from "./recurrence-schedule";

const day = (iso: string) => iso as LocalDate;
const monthlyOn = (anchor: number): PeriodPolicy => ({ kind: "MONTHLY", day: anchor });
const twiceMonthly = (day1: number, day2: number): PeriodPolicy => ({ kind: "SEMI_MONTHLY", day1, day2 });
const dates = (schedule: PeriodPolicy, from: string, through: string | null, limit = 12) =>
  scheduleDates(schedule, { from: day(from), through: through === null ? null : day(through) }, limit);

describe("recurrence schedules (HU-E4-11, spec 5.2)", () => {
  it("lists MONTHLY(1) dates from the start date", () => {
    expect(dates(monthlyOn(1), "2026-12-01", null, 3)).toEqual(["2026-12-01", "2027-01-01", "2027-02-01"]);
  });

  it("clamps MONTHLY(31) to short months: 2027-01-31, 2027-02-28 and 2027-03-31", () => {
    expect(dates(monthlyOn(31), "2027-01-01", null, 3)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });

  it("falls on 29 February in a leap year", () => {
    expect(dates(monthlyOn(30), "2028-01-31", "2028-03-31")).toEqual(["2028-02-29", "2028-03-30"]);
  });

  it("lists SEMI_MONTHLY(1, 16) in December 2026 as 2026-12-01 and 2026-12-16", () => {
    expect(dates(twiceMonthly(1, 16), "2026-12-01", "2026-12-31")).toEqual(["2026-12-01", "2026-12-16"]);
  });

  it("collapses SEMI_MONTHLY(30, 31) to one date in February", () => {
    expect(dates(twiceMonthly(30, 31), "2027-02-01", "2027-03-31")).toEqual([
      "2027-02-28",
      "2027-03-30",
      "2027-03-31",
    ]);
  });

  it("starts at the first schedule date on or after the given day", () => {
    expect([firstDateFrom(monthlyOn(5), day("2026-12-05")), firstDateFrom(monthlyOn(5), day("2026-12-06"))]).toEqual([
      "2026-12-05",
      "2027-01-05",
    ]);
  });

  it("includes an end date that is a schedule date, and stops at the limit", () => {
    expect(dates(monthlyOn(1), "2026-12-01", "2027-01-01")).toEqual(["2026-12-01", "2027-01-01"]);
    expect(dates(monthlyOn(1), "2026-12-02", "2027-01-31")).toEqual(["2027-01-01"]);
    expect(dates(monthlyOn(1), "2026-12-01", "2026-11-30")).toEqual([]);
    expect(dates(twiceMonthly(1, 16), "2026-12-01", null, 1)).toEqual(["2026-12-01"]);
  });

  it("validates anchors as a period policy does: InvalidPeriodPolicy (HU-E1-03)", () => {
    expect(scheduleOf(monthlyOn(31))).toEqual({ ok: true, value: monthlyOn(31) });
    expect(scheduleOf(monthlyOn(0))).toMatchObject({ ok: false, error: { code: "InvalidPeriodPolicy" } });
    expect(scheduleOf(twiceMonthly(16, 1))).toMatchObject({ ok: false, error: { code: "InvalidPeriodPolicy" } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/ledger/domain/recurrence-schedule.test.ts`
Expected: FAIL — `Failed to resolve import "./recurrence-schedule"`.

- [ ] **Step 3: Implement**

`src/modules/ledger/domain/recurrence-schedule.ts`:

```ts
import {
  addDays,
  monthly,
  periodFor,
  semiMonthly,
  type LocalDate,
  type PeriodPolicy,
  type Result,
} from "@/shared/kernel";

/**
 * Spec 5.2 Recurrence: a schedule follows the anchor rules of PeriodPolicy, MONTHLY(day) or SEMI_MONTHLY(day1, day2),
 * clamped to short months, and its dates are the days its periods would start on. WEEKLY and BIWEEKLY follow
 * HU-E8-09.
 */
export type Schedule = PeriodPolicy;

/** The schedule a request names; invalid anchors answer InvalidPeriodPolicy, as for a space's policy (HU-E1-03). */
export const scheduleOf = (input: PeriodPolicy): Result<Schedule> =>
  input.kind === "MONTHLY" ? monthly(input.day) : semiMonthly(input.day1, input.day2);

/** The first schedule date on or after `from`. */
export const firstDateFrom = (schedule: Schedule, from: LocalDate): LocalDate => {
  const period = periodFor(schedule, from);
  return period.start === from ? from : addDays(period.end, 1);
};

/** The schedule dates from `from` through `through` (inclusive; open-ended when null), in order, at most `limit`. */
export const scheduleDates = (
  schedule: Schedule,
  window: { readonly from: LocalDate; readonly through: LocalDate | null },
  limit: number,
): LocalDate[] => {
  const dates: LocalDate[] = [];
  let date = firstDateFrom(schedule, window.from);
  while (dates.length < limit && (window.through === null || date <= window.through)) {
    dates.push(date);
    date = addDays(periodFor(schedule, date).end, 1);
  }
  return dates;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project unit src/modules/ledger/domain/recurrence-schedule.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/domain/recurrence-schedule.ts src/modules/ledger/domain/recurrence-schedule.test.ts
git commit -m "feat(ledger): list the dates of monthly and semi-monthly recurrence schedules (Refs #40)"
```

---

### Task 2a: Ledger domain — recurrences, their status and their edits

Implements HU-E4-11's rules (issue #40): a recurrence's definition, derived status, upcoming dates and edits. Pins Review Focus 2 (a start before the definition day, an end date on a schedule date).

Decisions:
- `dueFrom` is the first date the scheduler has not considered yet. A new recurrence is due from its start date or from the definition day, whichever is later: it never back-fills days before it existed (ruling P24). A run moves `dueFrom` past the dates it handled (Task 8b); resuming moves it to the resume day (Task 2b).
- `statusOf` is derived: ENDED once ended or once no schedule date is left up to the end date, PAUSED while paused, ACTIVE otherwise. `upcomingDates` lists nothing while paused or ended.
- The template keeps its type, payer and accounts once defined; an edit changes the description, amount, category (expenses and incomes), split (expenses), schedule, mode and end date (ruling P22), and applies to every occurrence not recorded yet (ruling P24). An ended recurrence takes no edit (`RecurrenceEnded`).
- A description is required (1–200 characters): recurrences are listed by name.

**Files:**
- Create: `src/modules/ledger/domain/recurrence.ts`
- Test: create `src/modules/ledger/domain/recurrence.test.ts`

**Interfaces:**
- Consumes: `scheduleDates`, `Schedule` (Task 1); `SplitInput` (M2-B `src/modules/ledger/domain/split.ts`); `codeOf`, `unwrap` (`tests/support/fakes.ts`).
- Produces:
  - `type RecurrenceId = Id<"Recurrence">`; `type RecurrenceMode = "AUTO" | "CONFIRM"`; `type RecurrenceType = "EXPENSE" | "INCOME" | "TRANSFER" | "FUND_CONTRIBUTION"`; `type RecurrenceStatus = "ACTIVE" | "PAUSED" | "ENDED"`; `type RecurrenceSplit = Exclude<SplitInput, { readonly method: "EXACT" }>`
  - `type RecurrenceTemplate` (EXPENSE `{ categoryId, payer: { memberId: string | null; accountId: string | null }, split: RecurrenceSplit | null }`, INCOME `{ categoryId, accountId }`, TRANSFER `{ sourceAccountId, destinationAccountId }`, FUND_CONTRIBUTION `{ fundAccountId, memberId, sourceAccountId: string | null }`)
  - `interface Recurrence { id; spaceId; description; amount: bigint; currency; template; schedule; mode; startDate; endDate: LocalDate | null; dueFrom; pausedAt: Date | null; pauseReason: string | null; endedAt: Date | null; createdBy; createdAt; updatedAt }`
  - `MAX_UPCOMING = 24`; `interface NewRecurrence`; `defineRecurrence(input: NewRecurrence): Result<Recurrence>` — `InvalidAmount`, `InvalidDescription`, `InvalidRecurrence`
  - `upcomingDates(recurrence, count): LocalDate[]`; `statusOf(recurrence): RecurrenceStatus`
  - `interface RecurrenceChanges { description?; amount?: bigint; categoryId?; split?: RecurrenceSplit | null; schedule?: Schedule; mode?; endDate?: LocalDate | null }`; `revisedRecurrence(current, changes, now): Result<Recurrence>` — `RecurrenceEnded`, `InvalidRecurrence`, `InvalidAmount`, `InvalidDescription`

- [ ] **Step 1: Write the failing test**

`src/modules/ledger/domain/recurrence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import {
  defineRecurrence,
  revisedRecurrence,
  statusOf,
  upcomingDates,
  type NewRecurrence,
  type Recurrence,
  type RecurrenceId,
  type RecurrenceSplit,
  type RecurrenceTemplate,
} from "./recurrence";

const day = (iso: string) => iso as LocalDate;
/** Noon of `iso` in Bogotá. */
const at = (iso: string) => new Date(`${iso}T17:00:00Z`);
const RENT: RecurrenceTemplate = {
  type: "EXPENSE",
  categoryId: "cat-rent",
  payer: { memberId: null, accountId: "acc-household-fund" },
  split: null,
};
/** HU-E4-11: "Rent", 1,200,000 COP from the Household Fund, MONTHLY(1), AUTO, from 2026-12-01, defined on 2026-10-28. */
const definition = (overrides: Partial<NewRecurrence> = {}): NewRecurrence => ({
  id: "rec-rent" as RecurrenceId,
  spaceId: "space-household",
  description: "Rent",
  amount: 120_000_000n,
  currency: "COP",
  template: RENT,
  schedule: { kind: "MONTHLY", day: 1 },
  mode: "AUTO",
  startDate: day("2026-12-01"),
  endDate: null,
  createdBy: "u-ana",
  now: at("2026-10-28"),
  today: day("2026-10-28"),
  ...overrides,
});
const rent = (overrides: Partial<NewRecurrence> = {}): Recurrence => unwrap(defineRecurrence(definition(overrides)));

describe("defining a recurrence (HU-E4-11)", () => {
  it("is ACTIVE and next occurs on its start date, 2026-12-01", () => {
    const r = rent();
    expect([statusOf(r), upcomingDates(r, 1), r.dueFrom, r.pausedAt, r.endedAt]).toEqual([
      "ACTIVE",
      ["2026-12-01"],
      "2026-12-01",
      null,
      null,
    ]);
  });

  it("never back-fills days before it was defined: a past start is due from the definition day (P24)", () => {
    const r = rent({ startDate: day("2026-10-01") });
    expect([r.dueFrom, upcomingDates(r, 2)]).toEqual(["2026-10-28", ["2026-11-01", "2026-12-01"]]);
  });

  it("refuses a non-positive amount, an empty or long description and an end before its start", () => {
    const define = (overrides: Partial<NewRecurrence>) => codeOf(defineRecurrence(definition(overrides)));
    expect([
      define({ amount: 0n }),
      define({ description: "   " }),
      define({ description: "x".repeat(201) }),
      define({ endDate: day("2026-11-30") }),
      define({ endDate: day("2026-12-01") }),
    ]).toEqual(["InvalidAmount", "InvalidDescription", "InvalidDescription", "InvalidRecurrence", "ok"]);
  });

  it("ends once no schedule date is left up to its end date, the end date included", () => {
    const r = rent({ endDate: day("2027-01-01") });
    expect([statusOf(r), upcomingDates(r, 5)]).toEqual(["ACTIVE", ["2026-12-01", "2027-01-01"]]);
    expect(statusOf({ ...r, dueFrom: day("2027-01-02") })).toBe("ENDED");
  });

  it("lists no date while paused or ended", () => {
    const r = rent();
    expect([
      [statusOf({ ...r, pausedAt: at("2026-11-01") }), upcomingDates({ ...r, pausedAt: at("2026-11-01") }, 1)],
      [statusOf({ ...r, endedAt: at("2026-11-01") }), upcomingDates({ ...r, endedAt: at("2026-11-01") }, 1)],
    ]).toEqual([
      ["PAUSED", []],
      ["ENDED", []],
    ]);
  });
});

describe("editing a recurrence (HU-E4-11, P22)", () => {
  const half: RecurrenceSplit = {
    method: "PERCENT",
    participants: [
      { memberId: "member-ana", basisPoints: 5000 },
      { memberId: "member-juan", basisPoints: 5000 },
    ],
  };

  it("changes what the next occurrences record: Rent at 1,300,000 COP", () => {
    const edited = unwrap(revisedRecurrence(rent(), { amount: 130_000_000n, description: "Rent 2027" }, at("2026-12-15")));
    expect([edited.amount, edited.description, edited.updatedAt, edited.dueFrom]).toEqual([
      130_000_000n,
      "Rent 2027",
      at("2026-12-15"),
      "2026-12-01",
    ]);
  });

  it("changes the category of expenses and incomes only, and the split of expenses only", () => {
    const transfer = rent({
      template: { type: "TRANSFER", sourceAccountId: "acc-bancolombia", destinationAccountId: "acc-nequi" },
    });
    const salary = rent({ template: { type: "INCOME", categoryId: "cat-salary", accountId: "acc-bancolombia" } });
    expect([
      codeOf(revisedRecurrence(transfer, { categoryId: "cat-other" }, at("2026-11-01"))),
      codeOf(revisedRecurrence(salary, { split: half }, at("2026-11-01"))),
      codeOf(revisedRecurrence(salary, { categoryId: "cat-bonus" }, at("2026-11-01"))),
    ]).toEqual(["InvalidRecurrence", "InvalidRecurrence", "ok"]);
    const split = unwrap(revisedRecurrence(rent(), { split: half }, at("2026-11-01")));
    expect(split.template).toEqual({ ...RENT, split: half });
    expect(unwrap(revisedRecurrence(split, { split: null }, at("2026-11-02"))).template).toEqual(RENT);
  });

  it("refuses edits of an ended recurrence, end dates before the start and non-positive amounts", () => {
    const ended = { ...rent(), endedAt: at("2026-11-01") };
    expect([
      codeOf(revisedRecurrence(ended, { amount: 1n }, at("2026-11-02"))),
      codeOf(revisedRecurrence(rent(), { endDate: day("2026-11-01") }, at("2026-11-02"))),
      codeOf(revisedRecurrence(rent(), { amount: -1n }, at("2026-11-02"))),
    ]).toEqual(["RecurrenceEnded", "InvalidRecurrence", "InvalidAmount"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/ledger/domain/recurrence.test.ts`
Expected: FAIL — `Failed to resolve import "./recurrence"`.

- [ ] **Step 3: Implement**

`src/modules/ledger/domain/recurrence.ts`:

```ts
import { domainError, err, ok, type Id, type LocalDate, type Result } from "@/shared/kernel";
import { scheduleDates, type Schedule } from "./recurrence-schedule";
import type { SplitInput } from "./split";

export type RecurrenceId = Id<"Recurrence">;
export type RecurrenceMode = "AUTO" | "CONFIRM";
export type RecurrenceType = "EXPENSE" | "INCOME" | "TRANSFER" | "FUND_CONTRIBUTION";
export type RecurrenceStatus = "ACTIVE" | "PAUSED" | "ENDED";

/** Ruling P23: a recurrence shares by ratios only; EXACT amounts could not follow an estimate or a later amount. */
export type RecurrenceSplit = Exclude<SplitInput, { readonly method: "EXACT" }>;

/**
 * Spec 5.2: what every occurrence records besides its date and amount. Its type, payer and accounts stay as defined
 * (ruling P22); an expense's category and split, and an income's category, may change.
 */
export type RecurrenceTemplate =
  | {
      readonly type: "EXPENSE";
      readonly categoryId: string;
      /** A member (registered, or a guest with no account) and their account, or the fund (memberId null). */
      readonly payer: { readonly memberId: string | null; readonly accountId: string | null };
      /** Null: the default split of each occurrence (spec 5.3, ruling P23). */
      readonly split: RecurrenceSplit | null;
    }
  | { readonly type: "INCOME"; readonly categoryId: string; readonly accountId: string }
  | { readonly type: "TRANSFER"; readonly sourceAccountId: string; readonly destinationAccountId: string }
  | {
      readonly type: "FUND_CONTRIBUTION";
      readonly fundAccountId: string;
      readonly memberId: string;
      /** Null for a guest, who contributes from outside the app (HU-E4-09). */
      readonly sourceAccountId: string | null;
    };

export interface Recurrence {
  readonly id: RecurrenceId;
  readonly spaceId: string;
  readonly description: string;
  /** AUTO: what each occurrence records; CONFIRM: the estimate a pending occurrence suggests. Minor units. */
  readonly amount: bigint;
  readonly currency: string;
  readonly template: RecurrenceTemplate;
  readonly schedule: Schedule;
  readonly mode: RecurrenceMode;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate | null;
  /** The first date the scheduler has not considered yet: catch-up starts here (spec 5.2, ruling P24). */
  readonly dueFrom: LocalDate;
  readonly pausedAt: Date | null;
  /** Null when a member paused it; PayerLeft, CreatorLeft or the code that refused an occurrence otherwise (P26). */
  readonly pauseReason: string | null;
  readonly endedAt: Date | null;
  /** The user who defined it: every AUTO occurrence is recorded on their behalf (ruling P21). */
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const MAX_DESCRIPTION = 200;
/** HU-E4-11: GET …/occurrences lists at most this many upcoming dates. */
export const MAX_UPCOMING = 24;

const describedAs = (raw: string): Result<string> => {
  const text = raw.trim();
  return text.length > 0 && text.length <= MAX_DESCRIPTION
    ? ok(text)
    : err(domainError("InvalidDescription", { length: text.length }));
};

const positive = (amount: bigint): Result<bigint> =>
  amount > 0n ? ok(amount) : err(domainError("InvalidAmount", { amount: amount.toString() }));

const endsOnOrAfter = (startDate: LocalDate, endDate: LocalDate | null): Result<void> =>
  endDate === null || endDate >= startDate
    ? ok(undefined)
    : err(domainError("InvalidRecurrence", { reason: "endsBeforeStart" }));

export interface NewRecurrence {
  readonly id: RecurrenceId;
  readonly spaceId: string;
  readonly description: string;
  readonly amount: bigint;
  readonly currency: string;
  readonly template: RecurrenceTemplate;
  readonly schedule: Schedule;
  readonly mode: RecurrenceMode;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate | null;
  readonly createdBy: string;
  readonly now: Date;
  /** The definition day in the space timezone. */
  readonly today: LocalDate;
}

/**
 * HU-E4-11: a new recurrence is ACTIVE. It is due from its start date, or from the definition day when it starts
 * earlier: a recurrence never back-fills days before it existed (ruling P24).
 */
export const defineRecurrence = (input: NewRecurrence): Result<Recurrence> => {
  const amount = positive(input.amount);
  if (!amount.ok) return amount;
  const description = describedAs(input.description);
  if (!description.ok) return description;
  const dates = endsOnOrAfter(input.startDate, input.endDate);
  if (!dates.ok) return dates;
  return ok({
    id: input.id,
    spaceId: input.spaceId,
    description: description.value,
    amount: amount.value,
    currency: input.currency,
    template: input.template,
    schedule: input.schedule,
    mode: input.mode,
    startDate: input.startDate,
    endDate: input.endDate,
    dueFrom: input.startDate > input.today ? input.startDate : input.today,
    pausedAt: null,
    pauseReason: null,
    endedAt: null,
    createdBy: input.createdBy,
    createdAt: input.now,
    updatedAt: input.now,
  });
};

/** HU-E4-11: the next `count` dates it will record, from the first not considered yet; none while paused or ended. */
export const upcomingDates = (recurrence: Recurrence, count: number): LocalDate[] =>
  recurrence.pausedAt !== null || recurrence.endedAt !== null
    ? []
    : scheduleDates(recurrence.schedule, { from: recurrence.dueFrom, through: recurrence.endDate }, count);

/** ENDED once ended or once no schedule date is left up to its end date, PAUSED while paused, ACTIVE otherwise. */
export const statusOf = (recurrence: Recurrence): RecurrenceStatus => {
  if (recurrence.endedAt !== null) return "ENDED";
  const left = scheduleDates(recurrence.schedule, { from: recurrence.dueFrom, through: recurrence.endDate }, 1);
  if (left.length === 0) return "ENDED";
  return recurrence.pausedAt === null ? "ACTIVE" : "PAUSED";
};

/** HU-E4-11: what an edit may change (ruling P22); the type, payer and accounts stay as defined. */
export interface RecurrenceChanges {
  readonly description?: string;
  readonly amount?: bigint;
  readonly categoryId?: string;
  /** Null returns to the default split of each occurrence (ruling P23). */
  readonly split?: RecurrenceSplit | null;
  readonly schedule?: Schedule;
  readonly mode?: RecurrenceMode;
  readonly endDate?: LocalDate | null;
}

const revisedTemplate = (
  template: RecurrenceTemplate,
  changes: RecurrenceChanges,
): Result<RecurrenceTemplate> => {
  let revised = template;
  if (changes.categoryId !== undefined) {
    if (revised.type !== "EXPENSE" && revised.type !== "INCOME") {
      return err(domainError("InvalidRecurrence", { reason: "noCategory" }));
    }
    revised = { ...revised, categoryId: changes.categoryId };
  }
  if (changes.split !== undefined) {
    if (revised.type !== "EXPENSE") return err(domainError("InvalidRecurrence", { reason: "noSplit" }));
    revised = { ...revised, split: changes.split };
  }
  return ok(revised);
};

/**
 * HU-E4-11: an edit applies to every occurrence not recorded yet; recorded ones are snapshots (ruling P24). An ended
 * recurrence takes no edit.
 */
export const revisedRecurrence = (
  current: Recurrence,
  changes: RecurrenceChanges,
  now: Date,
): Result<Recurrence> => {
  if (current.endedAt !== null) return err(domainError("RecurrenceEnded"));
  const description = changes.description === undefined ? ok(current.description) : describedAs(changes.description);
  if (!description.ok) return description;
  const amount = changes.amount === undefined ? ok(current.amount) : positive(changes.amount);
  if (!amount.ok) return amount;
  const template = revisedTemplate(current.template, changes);
  if (!template.ok) return template;
  const endDate = changes.endDate === undefined ? current.endDate : changes.endDate;
  const dates = endsOnOrAfter(current.startDate, endDate);
  if (!dates.ok) return dates;
  return ok({
    ...current,
    description: description.value,
    amount: amount.value,
    template: template.value,
    schedule: changes.schedule ?? current.schedule,
    mode: changes.mode ?? current.mode,
    endDate,
    updatedAt: now,
  });
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project unit src/modules/ledger/domain`
Expected: PASS. Mutation check: in `defineRecurrence`, temporarily set `dueFrom: input.startDate` — "never back-fills days before it was defined" fails with `2026-10-01`; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/domain/recurrence.ts src/modules/ledger/domain/recurrence.test.ts
git commit -m "feat(ledger): define recurrences and derive their status, next dates and edits (Refs #40)"
```

---

### Task 2b: Ledger domain — pausing, resuming and ending, who a recurrence depends on, and occurrences

Implements HU-E4-11's pause, resume and end (issue #40), the domain side of HU-E4-12's pauses (issue #41) and the occurrence of HU-E4-12 and HU-E4-13 (issues #41, #42). Pins Review Focus 2 (a resume before or after a paused span) and Review Focus 3 (`blockerOf`).

Decisions:
- Pausing an ACTIVE recurrence, resuming a PAUSED one and ending one that is not ENDED are the only moves; any other answers `InvalidRecurrenceTransition` (ruling P27). A pause carries a reason: null when a member pauses, else `PayerLeft`, `CreatorLeft` or a refusing code (ruling P26). Resuming moves `dueFrom` to the resume day at the earliest, so the paused days are never back-filled (HU-E4-11; ruling P24).
- `debitsPersonalAccount` (D9, ruling P22) and `blockerOf` (ruling P26: the paying member first, then the creator) are pure, for the use cases of Tasks 5 and 8c.
- An occurrence is one schedule date of a recurrence: RECORDED points to its transaction, PENDING waits for a member (HU-E4-13: "pending occurrences are not transactions and never count as spent"), SKIPPED keeps the refusing code (`PeriodClosed`, `PayerLeft`, …; ruling P25) or null when a member skipped it. Only a PENDING one is confirmed or skipped (`OccurrenceNotPending`).

**Files:**
- Create: `src/modules/ledger/domain/occurrence.ts`
- Modify: `src/modules/ledger/domain/recurrence.ts`
- Test: `src/modules/ledger/domain/recurrence.test.ts`; create `src/modules/ledger/domain/occurrence.test.ts`

**Interfaces:**
- Consumes: `Recurrence`, `RecurrenceStatus`, `RecurrenceTemplate`, `statusOf`, `defineRecurrence` (Task 2a).
- Produces:
  - `pausedRecurrence(recurrence, now, reason?: string | null): Result<Recurrence>`; `resumedRecurrence(recurrence, now, today): Result<Recurrence>`; `endedRecurrence(recurrence, now): Result<Recurrence>` — `InvalidRecurrenceTransition`
  - `debitsPersonalAccount(template): boolean`; `payerOf(template): string | null`; `blockerOf(recurrence, current: readonly { id: string; userId: string | null }[]): "PayerLeft" | "CreatorLeft" | null`
  - `type OccurrenceId = Id<"Occurrence">`; `type OccurrenceStatus = "RECORDED" | "PENDING" | "SKIPPED"`; `interface Occurrence { id; recurrenceId; spaceId; date; status; amount: bigint; transactionId: string | null; reason: string | null; resolvedBy: string | null; createdAt; resolvedAt: Date | null }`
  - `recordedOccurrence(id, recurrence, date, transactionId, now)`, `pendingOccurrence(id, recurrence, date, now)`, `skippedOccurrence(id, recurrence, date, reason, now)`: `Occurrence`; `confirmedOccurrence(occurrence, { transactionId, amount, userId, now }): Result<Occurrence>`, `skippedByMember(occurrence, userId, now): Result<Occurrence>` — `OccurrenceNotPending`

- [ ] **Step 1: Write the failing tests**

In `src/modules/ledger/domain/recurrence.test.ts`:

1. Replace the block from the line `import {` (the `./recurrence` import) through the line `} from "./recurrence";` with:

```ts
import {
  blockerOf,
  debitsPersonalAccount,
  defineRecurrence,
  endedRecurrence,
  pausedRecurrence,
  resumedRecurrence,
  revisedRecurrence,
  statusOf,
  upcomingDates,
  type NewRecurrence,
  type Recurrence,
  type RecurrenceId,
  type RecurrenceSplit,
  type RecurrenceTemplate,
} from "./recurrence";
```

2. Append to the end of the file:

```ts

describe("pausing, resuming and ending (HU-E4-11)", () => {
  it("skips the paused span without back-filling: paused on 2026-12-20, resumed on 2027-02-10, next on 2027-02-16", () => {
    const cleaning = rent({ description: "Cleaning", schedule: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } });
    // A run already considered 2026-12-01 and 2026-12-16 (Task 8b moves dueFrom past them).
    const scheduled = { ...cleaning, dueFrom: day("2026-12-17") };
    const paused = unwrap(pausedRecurrence(scheduled, at("2026-12-20")));
    expect([statusOf(paused), upcomingDates(paused, 1), paused.pauseReason]).toEqual(["PAUSED", [], null]);
    const resumed = unwrap(resumedRecurrence(paused, at("2027-02-10"), day("2027-02-10")));
    expect([statusOf(resumed), upcomingDates(resumed, 2), resumed.pausedAt]).toEqual([
      "ACTIVE",
      ["2027-02-16", "2027-03-01"],
      null,
    ]);
  });

  it("keeps its first date when it resumes before that date is due, and records why it paused", () => {
    const paused = unwrap(pausedRecurrence(rent(), at("2026-10-29"), "PayerLeft"));
    expect(paused.pauseReason).toBe("PayerLeft");
    expect(upcomingDates(unwrap(resumedRecurrence(paused, at("2026-11-02"), day("2026-11-02"))), 1)).toEqual([
      "2026-12-01",
    ]);
  });

  it("refuses moves from the wrong status with InvalidRecurrenceTransition", () => {
    const active = rent();
    const paused = unwrap(pausedRecurrence(active, at("2026-11-01")));
    const ended = unwrap(endedRecurrence(active, at("2026-11-01")));
    expect([
      codeOf(pausedRecurrence(paused, at("2026-11-02"))),
      codeOf(resumedRecurrence(active, at("2026-11-02"), day("2026-11-02"))),
      codeOf(endedRecurrence(ended, at("2026-11-02"))),
      codeOf(pausedRecurrence(ended, at("2026-11-02"))),
      codeOf(endedRecurrence(paused, at("2026-11-02"))),
    ]).toEqual([
      "InvalidRecurrenceTransition",
      "InvalidRecurrenceTransition",
      "InvalidRecurrenceTransition",
      "InvalidRecurrenceTransition",
      "ok",
    ]);
    expect([statusOf(ended), upcomingDates(ended, 1)]).toEqual(["ENDED", []]);
    expect(codeOf(revisedRecurrence(ended, { amount: 1n }, at("2026-11-02")))).toBe("RecurrenceEnded");
  });
});

describe("who a recurrence depends on (D9, P22, P26)", () => {
  const internet: RecurrenceTemplate = {
    type: "EXPENSE",
    categoryId: "cat-utilities",
    payer: { memberId: "member-juan", accountId: "acc-davivienda" },
    split: null,
  };
  const guestPays: RecurrenceTemplate = {
    type: "EXPENSE",
    categoryId: "cat-utilities",
    payer: { memberId: "member-pedro", accountId: null },
    split: null,
  };
  const contribution: RecurrenceTemplate = {
    type: "FUND_CONTRIBUTION",
    fundAccountId: "acc-household-fund",
    memberId: "member-ana",
    sourceAccountId: "acc-bancolombia",
  };
  const guestContributes: RecurrenceTemplate = {
    type: "FUND_CONTRIBUTION",
    fundAccountId: "acc-household-fund",
    memberId: "member-pedro",
    sourceAccountId: null,
  };
  const income: RecurrenceTemplate = { type: "INCOME", categoryId: "cat-salary", accountId: "acc-bancolombia" };
  const transfer: RecurrenceTemplate = {
    type: "TRANSFER",
    sourceAccountId: "acc-bancolombia",
    destinationAccountId: "acc-nequi",
  };

  it("debits a member's own account for member-paid expenses, contributions from an account and transfers", () => {
    expect([RENT, internet, guestPays, contribution, guestContributes, income, transfer].map(debitsPersonalAccount)).toEqual([
      false,
      true,
      false,
      true,
      false,
      false,
      true,
    ]);
  });

  it("waits on its paying member first, then on its creator", () => {
    const ana = { id: "member-ana", userId: "u-ana" };
    const juan = { id: "member-juan", userId: "u-juan" };
    expect([
      blockerOf(rent({ template: internet }), [ana, juan]),
      blockerOf(rent({ template: internet }), [ana]),
      blockerOf(rent({ template: internet, createdBy: "u-juan" }), [ana]),
      blockerOf(rent(), [juan]),
      blockerOf(rent(), [ana]),
      blockerOf(rent({ template: guestContributes }), [ana]),
    ]).toEqual([null, "PayerLeft", "PayerLeft", "CreatorLeft", null, "PayerLeft"]);
  });
});
```

`src/modules/ledger/domain/occurrence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import {
  confirmedOccurrence,
  pendingOccurrence,
  recordedOccurrence,
  skippedByMember,
  skippedOccurrence,
  type OccurrenceId,
} from "./occurrence";
import { defineRecurrence, type RecurrenceId } from "./recurrence";

const at = new Date("2026-12-10T17:00:00Z");
const day = (iso: string) => iso as LocalDate;
/** HU-E4-13 Background: CONFIRM "Electricity", estimated at 180,000 COP, paid by Ana from Bancolombia, MONTHLY(10). */
const electricity = unwrap(
  defineRecurrence({
    id: "rec-electricity" as RecurrenceId,
    spaceId: "space-household",
    description: "Electricity",
    amount: 18_000_000n,
    currency: "COP",
    template: {
      type: "EXPENSE",
      categoryId: "cat-utilities",
      payer: { memberId: "member-ana", accountId: "acc-bancolombia" },
      split: null,
    },
    schedule: { kind: "MONTHLY", day: 10 },
    mode: "CONFIRM",
    startDate: day("2026-12-10"),
    endDate: null,
    createdBy: "u-ana",
    now: at,
    today: day("2026-10-28"),
  }),
);
const pending = pendingOccurrence("occ-1" as OccurrenceId, electricity, day("2026-12-10"), at);

describe("occurrences (HU-E4-12, HU-E4-13)", () => {
  it("starts PENDING with the estimate, RECORDED with its transaction, or SKIPPED with the refusing code", () => {
    expect(pending).toEqual({
      id: "occ-1",
      recurrenceId: "rec-electricity",
      spaceId: "space-household",
      date: "2026-12-10",
      status: "PENDING",
      amount: 18_000_000n,
      transactionId: null,
      reason: null,
      resolvedBy: null,
      createdAt: at,
      resolvedAt: null,
    });
    const recorded = recordedOccurrence("occ-2" as OccurrenceId, electricity, day("2027-01-10"), "tx-7", at);
    const skipped = skippedOccurrence("occ-3" as OccurrenceId, electricity, day("2027-02-10"), "PeriodClosed", at);
    expect([recorded.status, recorded.transactionId, skipped.status, skipped.reason]).toEqual([
      "RECORDED",
      "tx-7",
      "SKIPPED",
      "PeriodClosed",
    ]);
  });

  it("confirms a pending occurrence once, with the real amount", () => {
    const confirmation = { transactionId: "tx-1", amount: 20_530_000n, userId: "u-ana", now: at };
    const confirmed = unwrap(confirmedOccurrence(pending, confirmation));
    expect(confirmed).toMatchObject({
      status: "RECORDED",
      amount: 20_530_000n,
      transactionId: "tx-1",
      resolvedBy: "u-ana",
      resolvedAt: at,
    });
    expect([
      codeOf(confirmedOccurrence(confirmed, confirmation)),
      codeOf(skippedByMember(confirmed, "u-ana", at)),
    ]).toEqual(["OccurrenceNotPending", "OccurrenceNotPending"]);
  });

  it("skips a pending occurrence for a member, with no reason and no transaction", () => {
    expect(unwrap(skippedByMember(pending, "u-juan", at))).toMatchObject({
      status: "SKIPPED",
      reason: null,
      resolvedBy: "u-juan",
      transactionId: null,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/domain`
Expected: FAIL — `pausedRecurrence` and its siblings are not exported by `./recurrence`, and `Failed to resolve import "./occurrence"`.

- [ ] **Step 3: Implement**

Append to `src/modules/ledger/domain/recurrence.ts`:

```ts

const refused = (from: RecurrenceStatus, to: RecurrenceStatus): Result<never> =>
  err(domainError("InvalidRecurrenceTransition", { from, to }));

/** HU-E4-11: only an ACTIVE recurrence pauses; `reason` is null when a member pauses it (ruling P26). */
export const pausedRecurrence = (
  recurrence: Recurrence,
  now: Date,
  reason: string | null = null,
): Result<Recurrence> => {
  const status = statusOf(recurrence);
  return status === "ACTIVE"
    ? ok({ ...recurrence, pausedAt: now, pauseReason: reason, updatedAt: now })
    : refused(status, "PAUSED");
};

/** HU-E4-11: a PAUSED recurrence resumes from `today`; the days it was paused are never back-filled (ruling P24). */
export const resumedRecurrence = (recurrence: Recurrence, now: Date, today: LocalDate): Result<Recurrence> => {
  const status = statusOf(recurrence);
  if (status !== "PAUSED") return refused(status, "ACTIVE");
  return ok({
    ...recurrence,
    pausedAt: null,
    pauseReason: null,
    dueFrom: recurrence.dueFrom > today ? recurrence.dueFrom : today,
    updatedAt: now,
  });
};

/** HU-E4-11, D8: ending is logical; the recurrence and its occurrences stay, and nothing else is ever recorded. */
export const endedRecurrence = (recurrence: Recurrence, now: Date): Result<Recurrence> => {
  const status = statusOf(recurrence);
  return status === "ENDED" ? refused(status, "ENDED") : ok({ ...recurrence, endedAt: now, updatedAt: now });
};

/** D9 (ruling P22): whether its occurrences debit a member's own account, so only that member changes how much. */
export const debitsPersonalAccount = (template: RecurrenceTemplate): boolean => {
  switch (template.type) {
    case "EXPENSE":
      return template.payer.memberId !== null && template.payer.accountId !== null;
    case "FUND_CONTRIBUTION":
      return template.sourceAccountId !== null;
    case "TRANSFER":
      return true;
    case "INCOME":
      return false;
  }
};

/** The member its occurrences take money from: an expense's paying member or a contribution's; null for the fund. */
export const payerOf = (template: RecurrenceTemplate): string | null =>
  template.type === "EXPENSE"
    ? template.payer.memberId
    : template.type === "FUND_CONTRIBUTION"
      ? template.memberId
      : null;

/**
 * Ruling P26: why a recurrence can record nothing more because someone left the space: its paying member first
 * (PayerLeft, HU-E4-11), then the user who defined it, on whose behalf it records (CreatorLeft).
 */
export const blockerOf = (
  recurrence: Recurrence,
  current: readonly { readonly id: string; readonly userId: string | null }[],
): "PayerLeft" | "CreatorLeft" | null => {
  const payer = payerOf(recurrence.template);
  if (payer !== null && !current.some((member) => member.id === payer)) return "PayerLeft";
  return current.some((member) => member.userId === recurrence.createdBy) ? null : "CreatorLeft";
};
```

`src/modules/ledger/domain/occurrence.ts`:

```ts
import { domainError, err, map, ok, type Id, type LocalDate, type Result } from "@/shared/kernel";
import type { Recurrence, RecurrenceId } from "./recurrence";

export type OccurrenceId = Id<"Occurrence">;
export type OccurrenceStatus = "RECORDED" | "PENDING" | "SKIPPED";

/** One schedule date of a recurrence, stored once (unique per recurrence and date, spec 5.2) and never removed (D8). */
export interface Occurrence {
  readonly id: OccurrenceId;
  readonly recurrenceId: RecurrenceId;
  readonly spaceId: string;
  readonly date: LocalDate;
  readonly status: OccurrenceStatus;
  /** RECORDED: the amount recorded; PENDING: the suggested estimate; SKIPPED: what it would have recorded. */
  readonly amount: bigint;
  /** The transaction recorded for it; null unless RECORDED. */
  readonly transactionId: string | null;
  /** SKIPPED: PeriodClosed, PayerLeft, CreatorLeft or the refusing code (P25, P26); null when a member skipped it. */
  readonly reason: string | null;
  /** The user who confirmed or skipped it; null when the scheduler decided. */
  readonly resolvedBy: string | null;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
}

const occurrenceOf = (
  id: OccurrenceId,
  recurrence: Recurrence,
  date: LocalDate,
  now: Date,
  outcome: Pick<Occurrence, "status" | "transactionId" | "reason">,
): Occurrence => ({
  id,
  recurrenceId: recurrence.id,
  spaceId: recurrence.spaceId,
  date,
  amount: recurrence.amount,
  resolvedBy: null,
  createdAt: now,
  resolvedAt: null,
  ...outcome,
});

/** HU-E4-12: an AUTO occurrence recorded as `transactionId`. */
export const recordedOccurrence = (
  id: OccurrenceId,
  recurrence: Recurrence,
  date: LocalDate,
  transactionId: string,
  now: Date,
): Occurrence => occurrenceOf(id, recurrence, date, now, { status: "RECORDED", transactionId, reason: null });

/** HU-E4-13: a CONFIRM occurrence waiting for a member; it is not a transaction and never counts as spent. */
export const pendingOccurrence = (
  id: OccurrenceId,
  recurrence: Recurrence,
  date: LocalDate,
  now: Date,
): Occurrence => occurrenceOf(id, recurrence, date, now, { status: "PENDING", transactionId: null, reason: null });

/** HU-E4-12, rulings P25 and P26: an occurrence the scheduler could not record, with the code that refused it. */
export const skippedOccurrence = (
  id: OccurrenceId,
  recurrence: Recurrence,
  date: LocalDate,
  reason: string,
  now: Date,
): Occurrence => occurrenceOf(id, recurrence, date, now, { status: "SKIPPED", transactionId: null, reason });

const pendingOnly = (occurrence: Occurrence): Result<Occurrence> =>
  occurrence.status === "PENDING"
    ? ok(occurrence)
    : err(domainError("OccurrenceNotPending", { status: occurrence.status }));

/** HU-E4-13: a member confirmed a pending occurrence with the real amount, recorded as `transactionId`. */
export const confirmedOccurrence = (
  occurrence: Occurrence,
  confirmation: { readonly transactionId: string; readonly amount: bigint; readonly userId: string; readonly now: Date },
): Result<Occurrence> =>
  map(
    pendingOnly(occurrence),
    (pending): Occurrence => ({
      ...pending,
      status: "RECORDED",
      amount: confirmation.amount,
      transactionId: confirmation.transactionId,
      resolvedBy: confirmation.userId,
      resolvedAt: confirmation.now,
    }),
  );

/** HU-E4-13: a member skipped a pending occurrence; nothing is recorded and the recurrence goes on. */
export const skippedByMember = (occurrence: Occurrence, userId: string, now: Date): Result<Occurrence> =>
  map(
    pendingOnly(occurrence),
    (pending): Occurrence => ({ ...pending, status: "SKIPPED", reason: null, resolvedBy: userId, resolvedAt: now }),
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/ledger/domain`
Expected: PASS. Mutation check: in `resumedRecurrence`, temporarily keep `dueFrom: recurrence.dueFrom` — "skips the paused span" fails with `["2027-01-01", "2027-01-16"]` (the paused span back-filled); restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/domain/recurrence.ts src/modules/ledger/domain/recurrence.test.ts src/modules/ledger/domain/occurrence.ts src/modules/ledger/domain/occurrence.test.ts
git commit -m "feat(ledger): pause, resume and end recurrences and record their occurrences in the domain (Refs #40, Refs #41, Refs #42)"
```

---

### Task 3a: Ledger persistence — the recurrence tables

Implements the storage of HU-E4-11 … HU-E4-13 (issues #40, #41, #42): migration `0011_recurrences`. Pins the template shapes in PostgreSQL.

Decisions:
- One migration creates both tables. `recurrences` stores the template in the transaction-shaped columns of `transactions` (`category_id`, `payer_member_id`, `source_account_id`, `destination_account_id`, foreign keys included) plus `split` as `jsonb` (ratios only, ruling P23) and `schedule` as `jsonb` like `spaces.period_policy`; the check `recurrences_shape` mirrors `transactions_shape`, so each type stores exactly its references, and `recurrences_dates` keeps the end on or after the start. `due_from` is the first date the scheduler has not considered (ruling P24); the partial index `recurrences_active_idx` serves the scheduler's question (ruling P20).
- `recurrence_occurrences` holds one row per recurrence and date: its unique index `recurrence_occurrences_date_uq (recurrence_id, occurrence_date)` is HU-E4-12's idempotency key; `recurrence_occurrences_recorded` ties RECORDED to a transaction, and `recurrence_occurrences_transaction_uq` keeps one occurrence per transaction. Spaces are archived, never deleted, so the foreign keys are `no action`, as in `0010_budgeting`.

**Files:**
- Create: `src/modules/ledger/infrastructure/recurrences.schema.ts`
- Generated: `drizzle/0011_recurrences.sql`, `drizzle/meta/0011_snapshot.json`, `drizzle/meta/_journal.json`
- Test: create `src/modules/ledger/infrastructure/recurrences.int.test.ts`

**Interfaces:**
- Consumes: `RecurrenceSplit` (Task 2a); `transactions` (`ledger.schema.ts`), `accounts`, `categories`, `spaces`, `spaceMembers` (other modules' `*.schema.ts`); `sharedLedgerFixture`, `accountFixture`, `categoryFixture` (`tests/support/fixtures.ts`).
- Produces: tables `recurrences`, `recurrence_occurrences` (Drizzle `recurrences`, `recurrenceOccurrences`); in the integration test: `fixture()` (a fresh Ana with her bank, savings account and salary category, and Household with its fund, the guest Pedro and groceries).

- [ ] **Step 1: Write the failing test**

`src/modules/ledger/infrastructure/recurrences.int.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabase } from "../../../../tests/support/database";
import { accountFixture, categoryFixture, sharedLedgerFixture } from "../../../../tests/support/fixtures";

const { db, pool } = testDatabase();

afterAll(() => pool.end());

/** A fresh Ana with her bank, savings account and salary category, and Household with its fund, Pedro and groceries. */
const fixture = async () => {
  const w = await sharedLedgerFixture(db, pool);
  return {
    ...w,
    savings: await accountFixture(db, w.personal, "Ahorros"),
    salary: await categoryFixture(db, w.personal, "Salary"),
  };
};

describe("the recurrence tables (HU-E4-11, HU-E4-12)", () => {
  it("refuses templates of the wrong shape (recurrences_shape) and an end before the start (recurrences_dates)", async () => {
    const f = await fixture();
    // Every row is inserted already ended, so no scheduler test ever sees it.
    const insert = (
      type: string,
      columns: { categoryId?: string; payerMemberId?: string; sourceAccountId?: string; destinationAccountId?: string },
      endDate: string | null = null,
    ) =>
      pool.query(
        `INSERT INTO recurrences (id, space_id, type, description, amount, currency, category_id, payer_member_id,
           source_account_id, destination_account_id, schedule, mode, start_date, end_date, due_from, ended_at,
           created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 'Rent', 100, 'COP', $4, $5, $6, $7, '{"kind":"MONTHLY","day":1}', 'AUTO', '2026-12-01',
           $8, '2026-12-01', now(), $9, now(), now())`,
        [
          randomUUID(),
          f.household.spaceId,
          type,
          columns.categoryId ?? null,
          columns.payerMemberId ?? null,
          columns.sourceAccountId ?? null,
          columns.destinationAccountId ?? null,
          endDate,
          f.household.userId,
        ],
      );
    await expect(insert("EXPENSE", { categoryId: f.groceries })).rejects.toThrow(/recurrences_shape/);
    await expect(insert("INCOME", { categoryId: f.salary })).rejects.toThrow(/recurrences_shape/);
    await expect(insert("TRANSFER", { sourceAccountId: f.bank })).rejects.toThrow(/recurrences_shape/);
    await expect(insert("FUND_CONTRIBUTION", { destinationAccountId: f.fund })).rejects.toThrow(/recurrences_shape/);
    await expect(insert("EXPENSE", { categoryId: f.groceries, sourceAccountId: f.fund }, "2026-11-30")).rejects.toThrow(
      /recurrences_dates/,
    );
    await expect(insert("EXPENSE", { categoryId: f.groceries, sourceAccountId: f.fund })).resolves.toBeDefined();
    await expect(insert("TRANSFER", { sourceAccountId: f.bank, destinationAccountId: f.savings })).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project integration src/modules/ledger/infrastructure/recurrences.int.test.ts`
Expected: FAIL — `relation "recurrences" does not exist`.

- [ ] **Step 3: Implement the schema and generate the migration**

`src/modules/ledger/infrastructure/recurrences.schema.ts`:

```ts
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "@/modules/accounts/infrastructure/accounts.schema";
import { categories } from "@/modules/categories/infrastructure/categories.schema";
import { spaceMembers, spaces } from "@/modules/spaces/infrastructure/spaces.schema";
import type { PeriodPolicy } from "@/shared/kernel";
import type { RecurrenceSplit } from "../domain/recurrence";
import { transactions } from "./ledger.schema";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => bigint(name, { mode: "bigint" });

export const recurrences = pgTable(
  "recurrences",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id),
    type: text("type", { enum: ["EXPENSE", "INCOME", "TRANSFER", "FUND_CONTRIBUTION"] }).notNull(),
    description: text("description").notNull(),
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    // The template's references, as on transactions (spec 5.2; ruling P22).
    categoryId: uuid("category_id").references(() => categories.id),
    payerMemberId: uuid("payer_member_id").references(() => spaceMembers.id),
    sourceAccountId: uuid("source_account_id").references(() => accounts.id),
    destinationAccountId: uuid("destination_account_id").references(() => accounts.id),
    // Ratios only (ruling P23); null: the default split of each occurrence.
    split: jsonb("split").$type<RecurrenceSplit>(),
    schedule: jsonb("schedule").$type<PeriodPolicy>().notNull(),
    mode: text("mode", { enum: ["AUTO", "CONFIRM"] }).notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    // The first date the scheduler has not considered yet (ruling P24).
    dueFrom: date("due_from", { mode: "string" }).notNull(),
    pausedAt: tz("paused_at"),
    pauseReason: text("pause_reason"),
    endedAt: tz("ended_at"),
    createdBy: text("created_by").notNull(),
    createdAt: tz("created_at").notNull(),
    updatedAt: tz("updated_at").notNull(),
  },
  (t) => [
    index("recurrences_space_idx").on(t.spaceId, t.createdAt),
    // The scheduler's question (ruling P20): which recurrences still run.
    index("recurrences_active_idx").on(t.dueFrom).where(sql`${t.pausedAt} IS NULL AND ${t.endedAt} IS NULL`),
    check("recurrences_amount_positive", sql`${t.amount} > 0`),
    check("recurrences_dates", sql`${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`),
    // As transactions_shape: an expense is paid by a member (with an account unless a guest) or by the fund; an
    // income lands in an account; a transfer moves between two; a contribution goes from a member into the fund.
    check(
      "recurrences_shape",
      sql`(${t.type} = 'EXPENSE' AND ${t.categoryId} IS NOT NULL AND ${t.destinationAccountId} IS NULL AND (${t.payerMemberId} IS NOT NULL OR ${t.sourceAccountId} IS NOT NULL))
        OR (${t.type} = 'INCOME' AND ${t.categoryId} IS NOT NULL AND ${t.payerMemberId} IS NULL AND ${t.sourceAccountId} IS NULL AND ${t.destinationAccountId} IS NOT NULL AND ${t.split} IS NULL)
        OR (${t.type} = 'TRANSFER' AND ${t.categoryId} IS NULL AND ${t.payerMemberId} IS NULL AND ${t.sourceAccountId} IS NOT NULL AND ${t.destinationAccountId} IS NOT NULL AND ${t.split} IS NULL)
        OR (${t.type} = 'FUND_CONTRIBUTION' AND ${t.categoryId} IS NULL AND ${t.payerMemberId} IS NOT NULL AND ${t.destinationAccountId} IS NOT NULL AND ${t.split} IS NULL)`,
    ),
  ],
);

export const recurrenceOccurrences = pgTable(
  "recurrence_occurrences",
  {
    id: uuid("id").primaryKey(),
    recurrenceId: uuid("recurrence_id")
      .notNull()
      .references(() => recurrences.id),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id),
    occurrenceDate: date("occurrence_date", { mode: "string" }).notNull(),
    status: text("status", { enum: ["RECORDED", "PENDING", "SKIPPED"] }).notNull(),
    amount: money("amount").notNull(),
    transactionId: uuid("transaction_id").references(() => transactions.id),
    reason: text("reason"),
    resolvedBy: text("resolved_by"),
    createdAt: tz("created_at").notNull(),
    resolvedAt: tz("resolved_at"),
  },
  (t) => [
    // Spec 5.2, HU-E4-12: one occurrence per recurrence and date, whatever races (ruling P20).
    uniqueIndex("recurrence_occurrences_date_uq").on(t.recurrenceId, t.occurrenceDate),
    uniqueIndex("recurrence_occurrences_transaction_uq").on(t.transactionId),
    index("recurrence_occurrences_pending_idx")
      .on(t.spaceId, t.occurrenceDate)
      .where(sql`${t.status} = 'PENDING'`),
    check("recurrence_occurrences_amount_positive", sql`${t.amount} > 0`),
    check("recurrence_occurrences_recorded", sql`(${t.status} = 'RECORDED') = (${t.transactionId} IS NOT NULL)`),
  ],
);
```

Run: `pnpm db:generate --name recurrences`
Expected: `drizzle/0011_recurrences.sql` that creates both tables with their foreign keys (`space_id`, `category_id`, `payer_member_id`, both account columns, `recurrence_id` and `transaction_id`, all `ON DELETE no action`), the indexes `recurrences_space_idx`, `recurrences_active_idx … WHERE "recurrences"."paused_at" IS NULL AND "recurrences"."ended_at" IS NULL`, `recurrence_occurrences_date_uq`, `recurrence_occurrences_transaction_uq`, `recurrence_occurrences_pending_idx … WHERE "recurrence_occurrences"."status" = 'PENDING'`, and the checks `recurrences_amount_positive`, `recurrences_dates`, `recurrences_shape`, `recurrence_occurrences_amount_positive`, `recurrence_occurrences_recorded`; `drizzle/meta/0011_snapshot.json`; a `0011_recurrences` journal entry. Nothing is renamed, so drizzle-kit asks no questions; if it prompts, answer "create" for every new entity.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project integration src/modules/ledger/infrastructure/recurrences.int.test.ts src/shared/infrastructure/db/migrations.int.test.ts && pnpm db:check`
Expected: PASS; `db:check` reports no drift.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/infrastructure/recurrences.schema.ts src/modules/ledger/infrastructure/recurrences.int.test.ts drizzle/0011_recurrences.sql drizzle/meta/0011_snapshot.json drizzle/meta/_journal.json
git commit -m "feat(ledger): add the recurrence and occurrence tables (Refs #40, Refs #41, Refs #42)"
```

---

### Task 3b: Ledger persistence — the recurrence repository

Implements HU-E4-11's storage (issue #40) and the scheduler's question of HU-E4-12 (issue #41). Pins Review Focus 5 (malformed and foreign ids answer `null` or `[]`).

Decisions:
- `lockForWrite` is one `SELECT … FOR NO KEY UPDATE`: under READ COMMITTED a locking read that waited returns the row as its holder committed it, so it is preflight N4's "read again after the lock" in one statement. `NO KEY UPDATE` does not conflict with the `KEY SHARE` lock that inserting an occurrence takes on its recurrence.
- `listActive` reads every space (the scheduler's question, ruling P20): not paused, not ended and `due_from ≤ end_date` when there is one.
- Nothing is deleted (D8): `save` writes only the columns a recurrence may change after it was defined.
- An in-memory twin, `InMemoryRecurrences`, is pinned against the adapter by running the same sequence on both.

**Files:**
- Create: `src/modules/ledger/application/recurrence-ports.ts`, `src/modules/ledger/infrastructure/drizzle-recurrence-repository.ts`, `tests/support/in-memory-recurrences.ts`
- Modify: `src/modules/ledger/application/index.ts`
- Test: `src/modules/ledger/infrastructure/recurrences.int.test.ts`

**Interfaces:**
- Consumes: `Recurrence`, `RecurrenceId`, `RecurrenceTemplate` (Task 2a); `recurrences` (Task 3a); `fixture()` (Task 3a's test).
- Produces:
  - `interface ActiveRecurrence { id: RecurrenceId; spaceId: string }`; `interface RecurrenceRepository { add(r); find(spaceId, recurrenceId): Promise<Recurrence | null>; list(spaceId): Promise<Recurrence[]>; lockForWrite(spaceId, recurrenceId): Promise<Recurrence | null>; save(r): Promise<void>; listActive(): Promise<ActiveRecurrence[]> }`
  - `class DrizzleRecurrenceRepository implements RecurrenceRepository` (constructor `(tm: DrizzleTransactionManager)`)
  - `class InMemoryRecurrences implements RecurrenceRepository` with `rows: Recurrence[]` and `locked: string[]` (`tests/support/in-memory-recurrences.ts`)
  - in the integration test: `recurrence(f, spaceId, template, overrides?)`, `everyShape(f)`, `storeInBoth(memory, rows)`, `tm`, `repo`

- [ ] **Step 1: Write the failing tests**

In `src/modules/ledger/infrastructure/recurrences.int.test.ts`:

1. Replace the line `import { afterAll, describe, expect, it } from "vitest";` with:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { ok, type LocalDate } from "@/shared/kernel";
```

2. Replace the line `import { accountFixture, categoryFixture, sharedLedgerFixture } from "../../../../tests/support/fixtures";` with:

```ts
import { accountFixture, categoryFixture, sharedLedgerFixture } from "../../../../tests/support/fixtures";
import { InMemoryRecurrences } from "../../../../tests/support/in-memory-recurrences";
import type { Recurrence, RecurrenceId, RecurrenceTemplate } from "../domain/recurrence";
import { DrizzleRecurrenceRepository } from "./drizzle-recurrence-repository";
```

3. Replace the line `const { db, pool } = testDatabase();` with:

```ts
const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleRecurrenceRepository(tm);
```

4. Insert before the line `describe("the recurrence tables (HU-E4-11, HU-E4-12)", () => {`:

```ts
type Fixture = Awaited<ReturnType<typeof fixture>>;
const day = (iso: string) => iso as LocalDate;

let created = 0;
/** A recurrence with `template`, MONTHLY(1), AUTO, due from 2026-12-01; each created one millisecond after the last. */
const recurrence = (
  f: Fixture,
  spaceId: string,
  template: RecurrenceTemplate,
  overrides: Partial<Recurrence> = {},
): Recurrence => {
  const at = new Date(Date.UTC(2026, 9, 28, 17, 0, 0, ++created));
  return {
    id: randomUUID() as RecurrenceId,
    spaceId,
    description: "Rent",
    amount: 120_000_000n,
    currency: "COP",
    template,
    schedule: { kind: "MONTHLY", day: 1 },
    mode: "AUTO",
    startDate: day("2026-12-01"),
    endDate: null,
    dueFrom: day("2026-12-01"),
    pausedAt: null,
    pauseReason: null,
    endedAt: null,
    createdBy: f.household.userId,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
};

/** One recurrence of every template shape: the fund pays 40 / 60 %, Pedro pays alone, Ana's salary, saving, contribution. */
const everyShape = (f: Fixture): Recurrence[] => [
  recurrence(f, f.household.spaceId, {
    type: "EXPENSE",
    categoryId: f.groceries,
    payer: { memberId: null, accountId: f.fund },
    split: {
      method: "PERCENT",
      participants: [
        { memberId: f.household.memberId, basisPoints: 4000 },
        { memberId: f.pedro, basisPoints: 6000 },
      ],
    },
  }),
  recurrence(
    f,
    f.household.spaceId,
    { type: "EXPENSE", categoryId: f.groceries, payer: { memberId: f.pedro, accountId: null }, split: null },
    { mode: "CONFIRM", schedule: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 }, endDate: day("2027-06-30") },
  ),
  recurrence(f, f.personal.spaceId, { type: "INCOME", categoryId: f.salary, accountId: f.bank }),
  recurrence(f, f.personal.spaceId, { type: "TRANSFER", sourceAccountId: f.bank, destinationAccountId: f.savings }),
  recurrence(f, f.household.spaceId, {
    type: "FUND_CONTRIBUTION",
    fundAccountId: f.fund,
    memberId: f.household.memberId,
    sourceAccountId: f.bank,
  }),
];

/** Stores the same recurrences in PostgreSQL and in the in-memory twin. */
const storeInBoth = async (memory: InMemoryRecurrences, rows: readonly Recurrence[]) => {
  for (const row of rows) {
    await repo.add(row);
    await memory.add(row);
  }
};

```

5. Append to the end of the file:

```ts

describe("DrizzleRecurrenceRepository: recurrences (HU-E4-11)", () => {
  it("stores every template shape and reads it back like the in-memory twin", async () => {
    const f = await fixture();
    const memory = new InMemoryRecurrences();
    const rows = everyShape(f);
    await storeInBoth(memory, rows);
    for (const row of rows) expect(await repo.find(row.spaceId, row.id)).toEqual(row);
    for (const spaceId of [f.household.spaceId, f.personal.spaceId]) {
      expect(await repo.list(spaceId)).toEqual(await memory.list(spaceId));
    }
  });

  it("saves what may change, and lists as active only recurrences neither paused, ended nor past their end", async () => {
    const f = await fixture();
    const memory = new InMemoryRecurrences();
    const rows = everyShape(f);
    const [rent, pedros, salary, saving, contribution] = rows as [
      Recurrence,
      Recurrence,
      Recurrence,
      Recurrence,
      Recurrence,
    ];
    await storeInBoth(memory, rows);
    const later = new Date("2026-12-20T17:00:00Z");
    const changed: Recurrence[] = [
      {
        ...rent,
        description: "Rent 2027",
        amount: 130_000_000n,
        schedule: { kind: "MONTHLY", day: 5 },
        dueFrom: day("2027-01-01"),
        updatedAt: later,
      },
      { ...pedros, pausedAt: later, pauseReason: "PayerLeft", updatedAt: later },
      { ...salary, endedAt: later, updatedAt: later },
      { ...saving, endDate: day("2026-12-31"), dueFrom: day("2027-01-01"), updatedAt: later },
    ];
    for (const row of changed) {
      await repo.save(row);
      await memory.save(row);
    }
    const ids: string[] = rows.map((r) => r.id);
    // Other files share the database: only this test's recurrences are compared.
    const active = async (source: { listActive(): Promise<{ id: string }[]> }) =>
      (await source.listActive()).map((a) => a.id).filter((id) => ids.includes(id));
    expect(await active(repo)).toEqual([rent.id, contribution.id]);
    expect(await active(memory)).toEqual(await active(repo));
    expect([await repo.find(rent.spaceId, rent.id), await repo.find(pedros.spaceId, pedros.id)]).toEqual([
      changed[0],
      changed[1],
    ]);
  });

  it("reads a recurrence under its row lock, and answers null or [] for malformed and foreign ids (Review Focus 5)", async () => {
    const f = await fixture();
    const [rent] = everyShape(f) as [Recurrence];
    await repo.add(rent);
    expect(await tm.run(async () => ok(await repo.lockForWrite(f.household.spaceId, rent.id)))).toEqual(ok(rent));
    expect([
      await repo.find(f.household.spaceId, "not-a-uuid"),
      await repo.find(f.personal.spaceId, rent.id),
      await repo.lockForWrite("not-a-uuid", rent.id),
      await repo.list("not-a-uuid"),
    ]).toEqual([null, null, null, []]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project integration src/modules/ledger/infrastructure/recurrences.int.test.ts`
Expected: FAIL — `Failed to resolve import "./drizzle-recurrence-repository"`.

- [ ] **Step 3: Implement**

`src/modules/ledger/application/recurrence-ports.ts`:

```ts
import type { Recurrence, RecurrenceId } from "../domain/recurrence";

/** A recurrence the scheduler still drives (ruling P20). */
export interface ActiveRecurrence {
  readonly id: RecurrenceId;
  readonly spaceId: string;
}

export interface RecurrenceRepository {
  add(recurrence: Recurrence): Promise<void>;
  /** A recurrence of the space; null for unknown or malformed ids. */
  find(spaceId: string, recurrenceId: string): Promise<Recurrence | null>;
  /** The space's recurrences in the order they were defined. */
  list(spaceId: string): Promise<Recurrence[]>;
  /**
   * Locks the recurrence until the surrounding transaction ends and reads it under that lock (preflight N4), so the
   * writes and scheduler runs of one recurrence take turns on committed data; null for unknown or malformed ids.
   */
  lockForWrite(spaceId: string, recurrenceId: string): Promise<Recurrence | null>;
  /** Writes every field a recurrence may change after it was defined. */
  save(recurrence: Recurrence): Promise<void>;
  /** Every space's recurrences that are neither paused nor ended and have dates left before their end date. */
  listActive(): Promise<ActiveRecurrence[]>;
}
```

`src/modules/ledger/infrastructure/drizzle-recurrence-repository.ts`:

```ts
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid, type LocalDate } from "@/shared/kernel";
import type { ActiveRecurrence, RecurrenceRepository } from "../application/recurrence-ports";
import type { Recurrence, RecurrenceId, RecurrenceTemplate } from "../domain/recurrence";
import { recurrences } from "./recurrences.schema";

type RecurrenceRow = typeof recurrences.$inferSelect;

/** The template's references in the transaction-shaped columns each type uses (ruling P22), null otherwise. */
const templateColumns = (template: RecurrenceTemplate) => {
  switch (template.type) {
    case "EXPENSE":
      return {
        categoryId: template.categoryId,
        payerMemberId: template.payer.memberId,
        sourceAccountId: template.payer.accountId,
        destinationAccountId: null,
        split: template.split,
      };
    case "INCOME":
      return {
        categoryId: template.categoryId,
        payerMemberId: null,
        sourceAccountId: null,
        destinationAccountId: template.accountId,
        split: null,
      };
    case "TRANSFER":
      return {
        categoryId: null,
        payerMemberId: null,
        sourceAccountId: template.sourceAccountId,
        destinationAccountId: template.destinationAccountId,
        split: null,
      };
    case "FUND_CONTRIBUTION":
      return {
        categoryId: null,
        payerMemberId: template.memberId,
        sourceAccountId: template.sourceAccountId,
        destinationAccountId: template.fundAccountId,
        split: null,
      };
  }
};

/** recurrences_shape guarantees the references each type reads here. */
const templateOf = (row: RecurrenceRow): RecurrenceTemplate => {
  switch (row.type) {
    case "EXPENSE":
      return {
        type: "EXPENSE",
        categoryId: row.categoryId!,
        payer: { memberId: row.payerMemberId, accountId: row.sourceAccountId },
        split: row.split,
      };
    case "INCOME":
      return { type: "INCOME", categoryId: row.categoryId!, accountId: row.destinationAccountId! };
    case "TRANSFER":
      return {
        type: "TRANSFER",
        sourceAccountId: row.sourceAccountId!,
        destinationAccountId: row.destinationAccountId!,
      };
    case "FUND_CONTRIBUTION":
      return {
        type: "FUND_CONTRIBUTION",
        fundAccountId: row.destinationAccountId!,
        memberId: row.payerMemberId!,
        sourceAccountId: row.sourceAccountId,
      };
  }
};

const toRecurrence = (row: RecurrenceRow): Recurrence => ({
  id: row.id as RecurrenceId,
  spaceId: row.spaceId,
  description: row.description,
  amount: row.amount,
  currency: row.currency,
  template: templateOf(row),
  schedule: row.schedule,
  mode: row.mode,
  startDate: row.startDate as LocalDate,
  endDate: row.endDate as LocalDate | null,
  dueFrom: row.dueFrom as LocalDate,
  pausedAt: row.pausedAt,
  pauseReason: row.pauseReason,
  endedAt: row.endedAt,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** Every column a recurrence may change after it was defined (D8: nothing is deleted). */
const changeable = (recurrence: Recurrence) => ({
  description: recurrence.description,
  amount: recurrence.amount,
  ...templateColumns(recurrence.template),
  schedule: recurrence.schedule,
  mode: recurrence.mode,
  endDate: recurrence.endDate,
  dueFrom: recurrence.dueFrom,
  pausedAt: recurrence.pausedAt,
  pauseReason: recurrence.pauseReason,
  endedAt: recurrence.endedAt,
  updatedAt: recurrence.updatedAt,
});

export class DrizzleRecurrenceRepository implements RecurrenceRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async add(recurrence: Recurrence): Promise<void> {
    await this.tm
      .executor()
      .insert(recurrences)
      .values({
        id: recurrence.id,
        spaceId: recurrence.spaceId,
        type: recurrence.template.type,
        currency: recurrence.currency,
        startDate: recurrence.startDate,
        createdBy: recurrence.createdBy,
        createdAt: recurrence.createdAt,
        ...changeable(recurrence),
      });
  }

  async find(spaceId: string, recurrenceId: string): Promise<Recurrence | null> {
    // Ids come from URLs; anything that is not a UUID would fail the uuid cast.
    if (!isUuid(spaceId) || !isUuid(recurrenceId)) return null;
    const [row] = await this.tm
      .executor()
      .select()
      .from(recurrences)
      .where(and(eq(recurrences.id, recurrenceId), eq(recurrences.spaceId, spaceId)));
    return row ? toRecurrence(row) : null;
  }

  async list(spaceId: string): Promise<Recurrence[]> {
    if (!isUuid(spaceId)) return [];
    const rows = await this.tm
      .executor()
      .select()
      .from(recurrences)
      .where(eq(recurrences.spaceId, spaceId))
      .orderBy(asc(recurrences.createdAt), asc(recurrences.id));
    return rows.map(toRecurrence);
  }

  async lockForWrite(spaceId: string, recurrenceId: string): Promise<Recurrence | null> {
    if (!isUuid(spaceId) || !isUuid(recurrenceId)) return null;
    // Held until the caller's transaction ends; a locking read that waited returns the row its holder committed.
    // NO KEY UPDATE conflicts with other writers, not with the KEY SHARE an inserted occurrence takes (Task 3c).
    const [row] = await this.tm
      .executor()
      .select()
      .from(recurrences)
      .where(and(eq(recurrences.id, recurrenceId), eq(recurrences.spaceId, spaceId)))
      .for("no key update");
    return row ? toRecurrence(row) : null;
  }

  async save(recurrence: Recurrence): Promise<void> {
    await this.tm.executor().update(recurrences).set(changeable(recurrence)).where(eq(recurrences.id, recurrence.id));
  }

  async listActive(): Promise<ActiveRecurrence[]> {
    const rows = await this.tm
      .executor()
      .select({ id: recurrences.id, spaceId: recurrences.spaceId })
      .from(recurrences)
      .where(
        and(
          isNull(recurrences.pausedAt),
          isNull(recurrences.endedAt),
          or(isNull(recurrences.endDate), lte(recurrences.dueFrom, recurrences.endDate)),
        ),
      )
      .orderBy(asc(recurrences.createdAt), asc(recurrences.id));
    return rows.map((row) => ({ id: row.id as RecurrenceId, spaceId: row.spaceId }));
  }
}
```

`tests/support/in-memory-recurrences.ts`:

```ts
import type { ActiveRecurrence, Recurrence, RecurrenceRepository } from "@/modules/ledger/application";

/** Recurrences over arrays; recurrences.int.test.ts runs the same sequences against DrizzleRecurrenceRepository. */
export class InMemoryRecurrences implements RecurrenceRepository {
  rows: Recurrence[] = [];
  /** Ids read with lockForWrite, in order. */
  readonly locked: string[] = [];

  async add(recurrence: Recurrence) {
    this.rows.push(recurrence);
  }

  async find(spaceId: string, recurrenceId: string) {
    return this.rows.find((r) => r.id === recurrenceId && r.spaceId === spaceId) ?? null;
  }

  async list(spaceId: string) {
    return this.rows.filter((r) => r.spaceId === spaceId);
  }

  async lockForWrite(spaceId: string, recurrenceId: string) {
    this.locked.push(recurrenceId);
    return this.find(spaceId, recurrenceId);
  }

  async save(recurrence: Recurrence) {
    this.rows = this.rows.map((r) => (r.id === recurrence.id ? recurrence : r));
  }

  async listActive(): Promise<ActiveRecurrence[]> {
    return this.rows
      .filter((r) => r.pausedAt === null && r.endedAt === null && (r.endDate === null || r.dueFrom <= r.endDate))
      .map((r) => ({ id: r.id, spaceId: r.spaceId }));
  }
}
```

Append to `src/modules/ledger/application/index.ts`:

```ts
export type {
  Recurrence,
  RecurrenceChanges,
  RecurrenceId,
  RecurrenceMode,
  RecurrenceSplit,
  RecurrenceStatus,
  RecurrenceTemplate,
  RecurrenceType,
} from "../domain/recurrence";
export type { Schedule } from "../domain/recurrence-schedule";
export type { ActiveRecurrence, RecurrenceRepository } from "./recurrence-ports";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project integration src/modules/ledger/infrastructure/recurrences.int.test.ts`
Expected: PASS. Mutation check: in `listActive`, temporarily drop the `or(…)` condition — "lists as active only …" fails with the saving recurrence listed; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/application/recurrence-ports.ts src/modules/ledger/infrastructure/drizzle-recurrence-repository.ts src/modules/ledger/application/index.ts tests/support/in-memory-recurrences.ts src/modules/ledger/infrastructure/recurrences.int.test.ts
git commit -m "feat(ledger): store and lock recurrences in PostgreSQL (Refs #40, Refs #41)"
```

---

### Task 3c: Ledger persistence — occurrences, one per recurrence and date

Implements HU-E4-12's idempotency key and HU-E4-13's pending occurrences in storage (issues #41, #42). Pins Review Focus 1 (the unique key refuses a second occurrence of a date) and Review Focus 5.

Decisions:
- `addOccurrence` is a plain insert: the unique key `recurrence_occurrences_date_uq` makes a second occurrence of the same date fail the statement, so its whole transaction (and any transaction it recorded) rolls back. The in-memory twin throws the same way.
- `findOccurrence(…, { lock: true })` reads the row `FOR NO KEY UPDATE`, so a confirm and a skip of one occurrence take turns and the second sees the first's status (raced in Task 12).
- `latestOccurrences` answers the latest occurrence of each recurrence (`DISTINCT ON`), the link a recurrence's reads show (ruling P31).
- `RecurrenceDeps` (the ledger's deps plus both repositories) is declared here, with its two ports.

**Files:**
- Modify: `src/modules/ledger/application/recurrence-ports.ts`, `src/modules/ledger/infrastructure/drizzle-recurrence-repository.ts`, `tests/support/in-memory-recurrences.ts`, `src/modules/ledger/application/index.ts`
- Test: `src/modules/ledger/infrastructure/recurrences.int.test.ts`

**Interfaces:**
- Consumes: `Occurrence`, `OccurrenceId`, `pendingOccurrence`, `recordedOccurrence`, `skippedOccurrence`, `skippedByMember` (Task 2b); `recurrenceOccurrences` (Task 3a); `DrizzleRecurrenceRepository`, `InMemoryRecurrences`, `fixture`, `everyShape`, `storeInBoth`, `tm`, `repo` (Tasks 3a, 3b); `recordExpense` (M1 domain); `DrizzleTransactionRepository`; `LedgerDeps`.
- Produces:
  - `interface OccurrenceRepository { addOccurrence(o); saveOccurrence(o); findOccurrence(spaceId, occurrenceId, options?: { lock?: boolean }): Promise<Occurrence | null>; pendingOccurrences(spaceId): Promise<Occurrence[]>; latestOccurrences(spaceId, recurrenceIds: readonly string[]): Promise<ReadonlyMap<string, Occurrence>> }`
  - `interface RecurrenceDeps extends LedgerDeps { recurrences: RecurrenceRepository; occurrences: OccurrenceRepository }`
  - `DrizzleRecurrenceRepository` and `InMemoryRecurrences` also implement `OccurrenceRepository`; the twin keeps `occurrenceRows: Occurrence[]`

- [ ] **Step 1: Write the failing tests**

In `src/modules/ledger/infrastructure/recurrences.int.test.ts`:

1. Replace the line `import type { Recurrence, RecurrenceId, RecurrenceTemplate } from "../domain/recurrence";` with:

```ts
import { unwrap } from "../../../../tests/support/fakes";
import type { OccurrenceRepository } from "../application/recurrence-ports";
import {
  pendingOccurrence,
  recordedOccurrence,
  skippedByMember,
  skippedOccurrence,
  type OccurrenceId,
} from "../domain/occurrence";
import type { Recurrence, RecurrenceId, RecurrenceTemplate } from "../domain/recurrence";
import { recordExpense, type TransactionId } from "../domain/transaction";
import { DrizzleTransactionRepository } from "./drizzle-transaction-repository";
```

2. Append to the end of the file:

```ts

describe("DrizzleRecurrenceRepository: occurrences (HU-E4-12, HU-E4-13)", () => {
  const at = new Date("2026-12-01T17:00:00Z");
  const occurrenceId = () => randomUUID() as OccurrenceId;

  /** A fresh Household's fund-paid recurrence, stored in both, and a recorded 2026-12-01 expense to link it to. */
  const withRent = async () => {
    const f = await fixture();
    const memory = new InMemoryRecurrences();
    const [rent] = everyShape(f) as [Recurrence];
    await storeInBoth(memory, [rent]);
    const expense = unwrap(
      recordExpense({
        id: randomUUID() as TransactionId,
        spaceId: f.household.spaceId,
        date: day("2026-12-01"),
        amount: 120_000_000n,
        currency: "COP",
        createdBy: f.household.userId,
        now: at,
        categoryId: f.groceries,
        payments: [{ memberId: null, accountId: f.fund, amount: 120_000_000n }],
        shares: [{ memberId: f.household.memberId, amount: 120_000_000n, splitMethod: "EQUAL" }],
      }),
    );
    await new DrizzleTransactionRepository(tm).add(expense);
    return { f, memory, rent, expense };
  };
  /** What a recurrence's reads ask of the repository. */
  const reads = async (source: OccurrenceRepository, spaceId: string, recurrenceId: string, occurrenceId: string) => [
    await source.findOccurrence(spaceId, occurrenceId),
    await source.pendingOccurrences(spaceId),
    [...(await source.latestOccurrences(spaceId, [recurrenceId]))],
  ];

  it("stores, resolves and reads occurrences like the in-memory twin", async () => {
    const { f, memory, rent, expense } = await withRent();
    const recorded = recordedOccurrence(occurrenceId(), rent, day("2026-12-01"), expense.id, at);
    const skipped = skippedOccurrence(occurrenceId(), rent, day("2027-01-01"), "PeriodClosed", at);
    const pending = pendingOccurrence(occurrenceId(), rent, day("2027-02-01"), at);
    for (const occurrence of [recorded, skipped, pending]) {
      await repo.addOccurrence(occurrence);
      await memory.addOccurrence(occurrence);
    }
    const space = f.household.spaceId;
    expect(await reads(repo, space, rent.id, pending.id)).toEqual([pending, [pending], [[rent.id, pending]]]);
    expect(await reads(memory, space, rent.id, pending.id)).toEqual(await reads(repo, space, rent.id, pending.id));
    const resolved = unwrap(skippedByMember(pending, f.household.userId, at));
    await repo.saveOccurrence(resolved);
    await memory.saveOccurrence(resolved);
    expect(await reads(repo, space, rent.id, pending.id)).toEqual([resolved, [], [[rent.id, resolved]]]);
    expect(await reads(memory, space, rent.id, pending.id)).toEqual(await reads(repo, space, rent.id, pending.id));
    expect(await repo.findOccurrence(space, recorded.id, { lock: true })).toEqual(recorded);
  });

  it("keeps one occurrence per recurrence and date, and a RECORDED one only with its transaction (Review Focus 1)", async () => {
    const { rent } = await withRent();
    await repo.addOccurrence(pendingOccurrence(occurrenceId(), rent, day("2026-12-01"), at));
    await expect(
      repo.addOccurrence(skippedOccurrence(occurrenceId(), rent, day("2026-12-01"), "PeriodClosed", at)),
    ).rejects.toMatchObject({ cause: { constraint: "recurrence_occurrences_date_uq" } });
    await expect(
      repo.addOccurrence({ ...pendingOccurrence(occurrenceId(), rent, day("2027-01-01"), at), status: "RECORDED" }),
    ).rejects.toMatchObject({ cause: { constraint: "recurrence_occurrences_recorded" } });
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM recurrence_occurrences WHERE recurrence_id = $1", [
      rent.id,
    ]);
    expect(rows[0].n).toBe(1);
    const memory = new InMemoryRecurrences();
    await memory.addOccurrence(pendingOccurrence(occurrenceId(), rent, day("2026-12-01"), at));
    await expect(
      memory.addOccurrence(pendingOccurrence(occurrenceId(), rent, day("2026-12-01"), at)),
    ).rejects.toThrow(/duplicate occurrence/);
  });

  it("answers null, [] or an empty map for malformed and foreign ids (Review Focus 5)", async () => {
    const { f, rent } = await withRent();
    const pending = pendingOccurrence(occurrenceId(), rent, day("2026-12-01"), at);
    await repo.addOccurrence(pending);
    expect([
      await repo.findOccurrence(f.household.spaceId, "not-a-uuid"),
      await repo.findOccurrence(f.personal.spaceId, pending.id),
      await repo.pendingOccurrences("not-a-uuid"),
      [...(await repo.latestOccurrences(f.household.spaceId, ["not-a-uuid"]))],
      [...(await repo.latestOccurrences(f.personal.spaceId, [rent.id]))],
    ]).toEqual([null, null, [], [], []]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project integration src/modules/ledger/infrastructure/recurrences.int.test.ts`
Expected: FAIL — `repo.addOccurrence is not a function` (and the twin has no `addOccurrence`).

- [ ] **Step 3: Implement**

In `src/modules/ledger/application/recurrence-ports.ts`:

1. Replace the line `import type { Recurrence, RecurrenceId } from "../domain/recurrence";` with:

```ts
import type { Occurrence } from "../domain/occurrence";
import type { Recurrence, RecurrenceId } from "../domain/recurrence";
import type { LedgerDeps } from "./deps";
```

2. Append to the end of the file:

```ts

/** HU-E4-12, HU-E4-13: occurrences, one per recurrence and date (recurrence_occurrences_date_uq, spec 5.2). */
export interface OccurrenceRepository {
  /** Inserts it; fails when its recurrence already has an occurrence on that date, so its transaction rolls back. */
  addOccurrence(occurrence: Occurrence): Promise<void>;
  /** Writes its status, amount, transaction, reason and resolution. */
  saveOccurrence(occurrence: Occurrence): Promise<void>;
  /**
   * An occurrence of the space; with `lock`, locked until the transaction ends and read under that lock, so a confirm
   * and a skip of one occurrence take turns. Null for unknown or malformed ids.
   */
  findOccurrence(
    spaceId: string,
    occurrenceId: string,
    options?: { readonly lock?: boolean },
  ): Promise<Occurrence | null>;
  /** The space's PENDING occurrences, earliest date first. */
  pendingOccurrences(spaceId: string): Promise<Occurrence[]>;
  /** The latest occurrence (by date) of each of these recurrences of the space. */
  latestOccurrences(spaceId: string, recurrenceIds: readonly string[]): Promise<ReadonlyMap<string, Occurrence>>;
}

/** HU-E4-11 … HU-E4-13: the ledger, plus its recurrences and their occurrences. */
export interface RecurrenceDeps extends LedgerDeps {
  readonly recurrences: RecurrenceRepository;
  readonly occurrences: OccurrenceRepository;
}
```

In `src/modules/ledger/infrastructure/drizzle-recurrence-repository.ts`:

1. Replace the line `import { and, asc, eq, isNull, lte, or } from "drizzle-orm";` with:

```ts
import { and, asc, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
```

2. Replace the line `import type { ActiveRecurrence, RecurrenceRepository } from "../application/recurrence-ports";` with:

```ts
import type {
  ActiveRecurrence,
  OccurrenceRepository,
  RecurrenceRepository,
} from "../application/recurrence-ports";
import type { Occurrence, OccurrenceId } from "../domain/occurrence";
```

3. Replace the line `import { recurrences } from "./recurrences.schema";` with:

```ts
import { recurrenceOccurrences, recurrences } from "./recurrences.schema";
```

4. Replace the line `export class DrizzleRecurrenceRepository implements RecurrenceRepository {` with:

```ts
type OccurrenceRow = typeof recurrenceOccurrences.$inferSelect;

const toOccurrence = (row: OccurrenceRow): Occurrence => ({
  id: row.id as OccurrenceId,
  recurrenceId: row.recurrenceId as RecurrenceId,
  spaceId: row.spaceId,
  date: row.occurrenceDate as LocalDate,
  status: row.status,
  amount: row.amount,
  transactionId: row.transactionId,
  reason: row.reason,
  resolvedBy: row.resolvedBy,
  createdAt: row.createdAt,
  resolvedAt: row.resolvedAt,
});

export class DrizzleRecurrenceRepository implements RecurrenceRepository, OccurrenceRepository {
```

5. Insert before the last line of the file (`}`):

```ts

  async addOccurrence(occurrence: Occurrence): Promise<void> {
    // A second occurrence of the same date fails recurrence_occurrences_date_uq, rolling its transaction back.
    await this.tm.executor().insert(recurrenceOccurrences).values({
      id: occurrence.id,
      recurrenceId: occurrence.recurrenceId,
      spaceId: occurrence.spaceId,
      occurrenceDate: occurrence.date,
      status: occurrence.status,
      amount: occurrence.amount,
      transactionId: occurrence.transactionId,
      reason: occurrence.reason,
      resolvedBy: occurrence.resolvedBy,
      createdAt: occurrence.createdAt,
      resolvedAt: occurrence.resolvedAt,
    });
  }

  async saveOccurrence(occurrence: Occurrence): Promise<void> {
    await this.tm
      .executor()
      .update(recurrenceOccurrences)
      .set({
        status: occurrence.status,
        amount: occurrence.amount,
        transactionId: occurrence.transactionId,
        reason: occurrence.reason,
        resolvedBy: occurrence.resolvedBy,
        resolvedAt: occurrence.resolvedAt,
      })
      .where(eq(recurrenceOccurrences.id, occurrence.id));
  }

  async findOccurrence(
    spaceId: string,
    occurrenceId: string,
    options: { readonly lock?: boolean } = {},
  ): Promise<Occurrence | null> {
    if (!isUuid(spaceId) || !isUuid(occurrenceId)) return null;
    const query = this.tm
      .executor()
      .select()
      .from(recurrenceOccurrences)
      .where(and(eq(recurrenceOccurrences.id, occurrenceId), eq(recurrenceOccurrences.spaceId, spaceId)));
    // HU-E4-13: a confirm and a skip of one occurrence take turns, and the second reads what the first committed.
    const [row] = options.lock === true ? await query.for("no key update") : await query;
    return row ? toOccurrence(row) : null;
  }

  async pendingOccurrences(spaceId: string): Promise<Occurrence[]> {
    if (!isUuid(spaceId)) return [];
    const rows = await this.tm
      .executor()
      .select()
      .from(recurrenceOccurrences)
      .where(and(eq(recurrenceOccurrences.spaceId, spaceId), eq(recurrenceOccurrences.status, "PENDING")))
      .orderBy(asc(recurrenceOccurrences.occurrenceDate), asc(recurrenceOccurrences.id));
    return rows.map(toOccurrence);
  }

  async latestOccurrences(
    spaceId: string,
    recurrenceIds: readonly string[],
  ): Promise<ReadonlyMap<string, Occurrence>> {
    const ids = recurrenceIds.filter(isUuid);
    if (!isUuid(spaceId) || ids.length === 0) return new Map();
    const rows = await this.tm
      .executor()
      .selectDistinctOn([recurrenceOccurrences.recurrenceId])
      .from(recurrenceOccurrences)
      .where(and(eq(recurrenceOccurrences.spaceId, spaceId), inArray(recurrenceOccurrences.recurrenceId, ids)))
      .orderBy(recurrenceOccurrences.recurrenceId, desc(recurrenceOccurrences.occurrenceDate));
    return new Map(rows.map((row) => [row.recurrenceId, toOccurrence(row)]));
  }
```

In `tests/support/in-memory-recurrences.ts`:

1. Replace the line `import type { ActiveRecurrence, Recurrence, RecurrenceRepository } from "@/modules/ledger/application";` with:

```ts
import type {
  ActiveRecurrence,
  Occurrence,
  OccurrenceRepository,
  Recurrence,
  RecurrenceRepository,
} from "@/modules/ledger/application";
```

2. Replace the two lines `/** Recurrences over arrays; recurrences.int.test.ts runs the same sequences against DrizzleRecurrenceRepository. */` and `export class InMemoryRecurrences implements RecurrenceRepository {` with:

```ts
/** Recurrences and occurrences over arrays; recurrences.int.test.ts runs the same sequences against PostgreSQL. */
export class InMemoryRecurrences implements RecurrenceRepository, OccurrenceRepository {
  occurrenceRows: Occurrence[] = [];
```

3. Insert before the last line of the file (`}`):

```ts

  async addOccurrence(occurrence: Occurrence) {
    // recurrence_occurrences_date_uq
    if (this.occurrenceRows.some((o) => o.recurrenceId === occurrence.recurrenceId && o.date === occurrence.date)) {
      throw new Error(`duplicate occurrence of ${occurrence.recurrenceId} on ${occurrence.date}`);
    }
    this.occurrenceRows.push(occurrence);
  }

  async saveOccurrence(occurrence: Occurrence) {
    this.occurrenceRows = this.occurrenceRows.map((o) => (o.id === occurrence.id ? occurrence : o));
  }

  async findOccurrence(spaceId: string, occurrenceId: string) {
    return this.occurrenceRows.find((o) => o.id === occurrenceId && o.spaceId === spaceId) ?? null;
  }

  async pendingOccurrences(spaceId: string) {
    return this.occurrenceRows
      .filter((o) => o.spaceId === spaceId && o.status === "PENDING")
      .sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1));
  }

  async latestOccurrences(spaceId: string, recurrenceIds: readonly string[]) {
    const latest = new Map<string, Occurrence>();
    for (const o of this.occurrenceRows) {
      if (o.spaceId !== spaceId || !recurrenceIds.includes(o.recurrenceId)) continue;
      const seen = latest.get(o.recurrenceId);
      if (seen === undefined || o.date > seen.date) latest.set(o.recurrenceId, o);
    }
    return latest;
  }
```

In `src/modules/ledger/application/index.ts`, replace the line `export type { ActiveRecurrence, RecurrenceRepository } from "./recurrence-ports";` with:

```ts
export type { Occurrence, OccurrenceId, OccurrenceStatus } from "../domain/occurrence";
export type {
  ActiveRecurrence,
  OccurrenceRepository,
  RecurrenceDeps,
  RecurrenceRepository,
} from "./recurrence-ports";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project integration src/modules/ledger/infrastructure/recurrences.int.test.ts`
Expected: PASS. Mutation check: in `latestOccurrences`, temporarily order by `asc(recurrenceOccurrences.occurrenceDate)` — "stores, resolves and reads …" fails with the 2026-12-01 occurrence as the latest; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/application/recurrence-ports.ts src/modules/ledger/infrastructure/drizzle-recurrence-repository.ts src/modules/ledger/application/index.ts tests/support/in-memory-recurrences.ts src/modules/ledger/infrastructure/recurrences.int.test.ts
git commit -m "feat(ledger): keep one occurrence per recurrence and date, pending, recorded or skipped (Refs #41, Refs #42)"
```

---

### Task 4: Ledger — DefineRecurrence and the template rules

Implements HU-E4-11's definition (issue #40) at the use-case level: scenarios "Define the monthly rent paid from the shared fund", "Viewers cannot define recurrences", and the technical notes on the template and the payment nullability rules. Pins Review Focus 3 (D9: Ana cannot define Juan's account as payer) and Review Focus 5 (another space's fund, a category of another space).

Decisions:
- `checkTemplate` checks a template exactly as recording one of its occurrences would, with the record use cases' own helpers (`usableCategory`, `fundAccount`, `partyAccount`, `ownAccount`, `accountInSpace`, `splitShares`), for the recurrence's creator as the requester (ruling P21). So D9 holds for every future occurrence: a recurrence that debits a member's own account can only be defined by that member; any member who records money may make the fund pay or pay for a guest (D15). Incomes and transfers use accounts of the space they belong to (HU-E4-02, HU-E4-03), so they are recurrences of a personal space.
- A contribution's member defaults to the requester, as `RecordFundContribution` does (HU-E4-09).
- No split means the default split of each occurrence (spec 5.3: `BY_ALLOCATION` with the ACTIVE plan of its period, else `EQUAL`; ruling P23); an explicit split is checked now against the current members and the defined amount.
- The answer is a `RecurrenceView`: the recurrence with its derived status, its next date and its latest occurrence (none yet).

**Files:**
- Create: `src/modules/ledger/application/recurrence-template.ts`, `src/modules/ledger/application/recurrence-view.ts`, `src/modules/ledger/application/define-recurrence.ts`
- Modify: `src/modules/ledger/application/index.ts`, `tests/support/in-memory-recurrences.ts`
- Test: create `src/modules/ledger/application/recurrences.test.ts`

**Interfaces:**
- Consumes: `defineRecurrence`, `statusOf`, `upcomingDates`, `RecurrenceTemplate`, `RecurrenceMode`, `RecurrenceSplit` (Task 2a); `scheduleOf` (Task 1); `Occurrence` (Task 2b); `RecurrenceDeps`, `OccurrenceRepository`, `InMemoryRecurrences` (Tasks 3b, 3c); `authorizeWriter`, `inSpaceCurrency`, `usableCategory`, `fundAccount`, `partyAccount`, `ownAccount`, `accountInSpace` (`checks.ts`); `positiveAmount` (M1 domain); `ledgerFixture`, `ACCOUNTS`, `CATEGORIES` (`tests/support/in-memory-ledger.ts`); `householdSpace`, `HOUSEHOLD_MEMBERS`, `InMemorySpaceStore`, `memberOf` (`tests/support/in-memory-spaces.ts`).
- Produces:
  - `type TemplateInput` (a template whose contribution `memberId` is optional); `withContributor(template: TemplateInput, requesterMemberId: string): RecurrenceTemplate`; `interface TemplateOwner { spaceId: string; creatorUserId: string }`; `checkTemplate(deps: Pick<LedgerDeps, "accounts" | "categories">, owner: TemplateOwner, members: readonly SpaceMember[], template: RecurrenceTemplate, amount: Money): Promise<Result<RecurrenceTemplate>>`
  - `interface RecurrenceView { recurrence: Recurrence; status: RecurrenceStatus; nextOccurrence: LocalDate | null; lastOccurrence: Occurrence | null }`; `recurrenceView(recurrence, lastOccurrence): RecurrenceView`; `viewsOf(occurrences: Pick<OccurrenceRepository, "latestOccurrences">, spaceId, recurrences): Promise<RecurrenceView[]>`
  - `interface DefineRecurrenceInput { spaceId; userId; description: string; amount: Money; template: TemplateInput; schedule: PeriodPolicy; mode: RecurrenceMode; startDate: LocalDate; endDate: LocalDate | null }`; `type DefineRecurrence = (input) => Promise<Result<RecurrenceView>>`; `createDefineRecurrence(deps: RecurrenceDeps): DefineRecurrence`
  - `tests/support/in-memory-recurrences.ts`: `class MovableClock` (`set(day: string)`), `recurrenceWorld(): { deps: RecurrenceDeps; spaces: InMemorySpaceStore; clock: MovableClock; recurrences: InMemoryRecurrences; store: InMemoryTransactions }`, `rentDefinition(overrides?: Partial<DefineRecurrenceInput>): DefineRecurrenceInput`

- [ ] **Step 1: Write the failing test**

In `tests/support/in-memory-recurrences.ts`:

1. Replace the block from the line `import type {` through the line `} from "@/modules/ledger/application";` with:

```ts
import type {
  ActiveRecurrence,
  DefineRecurrenceInput,
  Occurrence,
  OccurrenceRepository,
  Recurrence,
  RecurrenceDeps,
  RecurrenceRepository,
} from "@/modules/ledger/application";
import { createSpaceAccess, type Space, type SpaceId } from "@/modules/spaces/application";
import { Money, type Clock, type LocalDate } from "@/shared/kernel";
import { unwrap } from "./fakes";
import { ACCOUNTS, CATEGORIES, ledgerFixture } from "./in-memory-ledger";
import { HOUSEHOLD_MEMBERS, householdSpace, InMemorySpaceStore, memberOf } from "./in-memory-spaces";
```

2. Append to the end of the file:

```ts

/** A clock the test moves: `clock.set("2026-12-20")` makes it noon of that day in Bogotá. */
export class MovableClock implements Clock {
  private instant: Date;

  constructor(day: string) {
    this.instant = MovableClock.noonOf(day);
  }

  set(day: string): void {
    this.instant = MovableClock.noonOf(day);
  }

  now(): Date {
    return new Date(this.instant);
  }

  private static noonOf(day: string): Date {
    return new Date(`${day}T17:00:00Z`);
  }
}

/** Ana's personal space (`space-ana`, COP, MONTHLY(1)), where her accounts and her salary category live. */
const anasPersonalSpace = (): Space => ({
  id: "space-ana" as SpaceId,
  name: "Personal",
  kind: "PERSONAL",
  currency: "COP",
  periodPolicy: { kind: "MONTHLY", day: 1 },
  personalOwnerUserId: "u-ana",
  members: [memberOf("Ana", "OWNER", 0)],
  createdAt: new Date("2026-10-01T12:00:00Z"),
});

/**
 * Household (HU-E1-05 Background: OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi, the guest Pedro) and Ana's
 * personal space as the recurrence use cases see them, on 2026-10-28 in Bogotá until the test moves `clock`.
 */
export const recurrenceWorld = () => {
  const spaces = new InMemorySpaceStore();
  spaces.seed(householdSpace(HOUSEHOLD_MEMBERS));
  spaces.seed(anasPersonalSpace());
  const clock = new MovableClock("2026-10-28");
  const recurrences = new InMemoryRecurrences();
  const { deps: ledger, store } = ledgerFixture({ access: createSpaceAccess(spaces), members: spaces, clock });
  const deps: RecurrenceDeps = { ...ledger, recurrences, occurrences: recurrences };
  return { deps, spaces, clock, recurrences, store };
};

/** HU-E4-11: Ana defines "Rent", 1,200,000 COP of Household paid from the Household Fund, MONTHLY(1), AUTO, from 2026-12-01. */
export const rentDefinition = (overrides: Partial<DefineRecurrenceInput> = {}): DefineRecurrenceInput => ({
  spaceId: "space-household",
  userId: "u-ana",
  description: "Rent",
  amount: unwrap(Money.ofMinor(120_000_000n, "COP")),
  template: {
    type: "EXPENSE",
    categoryId: CATEGORIES.household.id,
    payer: { memberId: null, accountId: ACCOUNTS.householdFund.id },
    split: null,
  },
  schedule: { kind: "MONTHLY", day: 1 },
  mode: "AUTO",
  startDate: "2026-12-01" as LocalDate,
  endDate: null,
  ...overrides,
});
```

`src/modules/ledger/application/recurrences.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES } from "../../../../tests/support/in-memory-ledger";
import { recurrenceWorld, rentDefinition } from "../../../../tests/support/in-memory-recurrences";
import type { RecurrenceSplit } from "../domain/recurrence";
import { createDefineRecurrence, type DefineRecurrenceInput } from "./define-recurrence";

const cop = (pesos: bigint) => money(pesos * 100n);
const day = (iso: string) => iso as LocalDate;

describe("DefineRecurrence (HU-E4-11)", () => {
  it("defines the monthly Rent paid from the shared fund: ACTIVE, next on 2026-12-01", async () => {
    const { deps, recurrences } = recurrenceWorld();
    const view = unwrap(await createDefineRecurrence(deps)(rentDefinition()));
    expect([view.status, view.nextOccurrence, view.lastOccurrence]).toEqual(["ACTIVE", "2026-12-01", null]);
    expect(view.recurrence).toMatchObject({
      spaceId: "space-household",
      description: "Rent",
      amount: 120_000_000n,
      currency: "COP",
      mode: "AUTO",
      dueFrom: "2026-12-01",
      createdBy: "u-ana",
      template: { type: "EXPENSE", payer: { memberId: null, accountId: ACCOUNTS.householdFund.id }, split: null },
    });
    expect(recurrences.rows).toEqual([view.recurrence]);
  });

  it("is due from the definition day when it starts earlier: next on 2026-11-01 (P24)", async () => {
    const view = unwrap(await createDefineRecurrence(recurrenceWorld().deps)(rentDefinition({ startDate: day("2026-10-01") })));
    expect([view.recurrence.dueFrom, view.nextOccurrence]).toEqual(["2026-10-28", "2026-11-01"]);
  });

  it("refuses VIEWERs, non-members and archived spaces", async () => {
    const { deps, spaces } = recurrenceWorld();
    const define = createDefineRecurrence(deps);
    expect(codeOf(await define(rentDefinition({ userId: "u-sofi" })))).toBe("InsufficientRole");
    expect(codeOf(await define(rentDefinition({ userId: "u-marta" })))).toBe("SpaceNotFound");
    await spaces.archive("space-household");
    expect(codeOf(await define(rentDefinition()))).toBe("SpaceArchived");
  });

  it("lets only Juan define Internet paid from his Davivienda account (D9, P21)", async () => {
    const define = createDefineRecurrence(recurrenceWorld().deps);
    const internet = rentDefinition({
      description: "Internet",
      amount: cop(120_000n),
      template: {
        type: "EXPENSE",
        categoryId: CATEGORIES.household.id,
        payer: { memberId: "member-juan", accountId: ACCOUNTS.davivienda.id },
        split: null,
      },
      schedule: { kind: "MONTHLY", day: 5 },
    });
    expect(codeOf(await define(internet))).toBe("AccountNotOwned");
    expect(codeOf(await define({ ...internet, userId: "u-juan" }))).toBe("ok");
  });

  it("checks the template as recording would: guests, other spaces' funds, categories, splits, amounts and anchors", async () => {
    const define = createDefineRecurrence(recurrenceWorld().deps);
    const paidBy = (memberId: string | null, accountId: string | null) =>
      rentDefinition({
        template: { type: "EXPENSE", categoryId: CATEGORIES.household.id, payer: { memberId, accountId }, split: null },
      });
    const splitAs = (split: RecurrenceSplit) =>
      rentDefinition({
        template: {
          type: "EXPENSE",
          categoryId: CATEGORIES.household.id,
          payer: { memberId: null, accountId: ACCOUNTS.householdFund.id },
          split,
        },
      });
    const inputs: DefineRecurrenceInput[] = [
      paidBy("member-pedro", null),
      paidBy("member-pedro", ACCOUNTS.bancolombia.id),
      paidBy(null, ACCOUNTS.tripFund.id),
      paidBy(null, null),
      rentDefinition({
        template: {
          type: "EXPENSE",
          categoryId: CATEGORIES.groceries.id,
          payer: { memberId: null, accountId: ACCOUNTS.householdFund.id },
          split: null,
        },
      }),
      splitAs({ method: "EQUAL", participants: [{ memberId: "member-marta" }] }),
      splitAs({
        method: "PERCENT",
        participants: [
          { memberId: "member-ana", basisPoints: 4000 },
          { memberId: "member-juan", basisPoints: 5000 },
        ],
      }),
      rentDefinition({ amount: cop(0n) }),
      rentDefinition({ amount: money(100n, "USD") }),
      rentDefinition({ schedule: { kind: "SEMI_MONTHLY", day1: 16, day2: 1 } }),
      rentDefinition({ endDate: day("2026-11-30") }),
      rentDefinition({ description: "" }),
    ];
    const codes: string[] = [];
    for (const input of inputs) codes.push(codeOf(await define(input)));
    expect(codes).toEqual([
      "ok",
      "GuestHasNoAccounts",
      "AccountNotFound",
      "AccountRequired",
      "CategoryNotFound",
      "NotASpaceMember",
      "InvalidSplit",
      "InvalidAmount",
      "CurrencyMismatch",
      "InvalidPeriodPolicy",
      "InvalidRecurrence",
      "InvalidDescription",
    ]);
  });

  it("defines incomes and transfers of Ana's personal space and her contribution to the fund", async () => {
    const define = createDefineRecurrence(recurrenceWorld().deps);
    const personal = { spaceId: "space-ana" };
    const salary = unwrap(
      await define(
        rentDefinition({
          ...personal,
          description: "Salary",
          template: { type: "INCOME", categoryId: CATEGORIES.salary.id, accountId: ACCOUNTS.bancolombia.id },
        }),
      ),
    );
    const saving = unwrap(
      await define(
        rentDefinition({
          ...personal,
          description: "Saving",
          template: { type: "TRANSFER", sourceAccountId: ACCOUNTS.bancolombia.id, destinationAccountId: ACCOUNTS.nequi.id },
        }),
      ),
    );
    const contribution = unwrap(
      await define(
        rentDefinition({
          description: "Fund",
          template: {
            type: "FUND_CONTRIBUTION",
            fundAccountId: ACCOUNTS.householdFund.id,
            sourceAccountId: ACCOUNTS.bancolombia.id,
          },
        }),
      ),
    );
    expect([salary.status, saving.status, contribution.recurrence.template]).toEqual([
      "ACTIVE",
      "ACTIVE",
      {
        type: "FUND_CONTRIBUTION",
        fundAccountId: ACCOUNTS.householdFund.id,
        memberId: "member-ana",
        sourceAccountId: ACCOUNTS.bancolombia.id,
      },
    ]);
    const income = { type: "INCOME" as const, categoryId: CATEGORIES.household.id, accountId: ACCOUNTS.bancolombia.id };
    const sameAccount = {
      type: "TRANSFER" as const,
      sourceAccountId: ACCOUNTS.bancolombia.id,
      destinationAccountId: ACCOUNTS.bancolombia.id,
    };
    expect([
      codeOf(await define(rentDefinition({ template: income }))),
      codeOf(await define(rentDefinition({ ...personal, template: sameAccount }))),
    ]).toEqual(["AccountNotInSpace", "SameAccountTransfer"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/recurrences.test.ts`
Expected: FAIL — `Failed to resolve import "./define-recurrence"`.

- [ ] **Step 3: Implement**

`src/modules/ledger/application/recurrence-template.ts`:

```ts
import type { SpaceMember } from "@/modules/spaces/application";
import { domainError, err, flatMap, ok, type Money, type Result } from "@/shared/kernel";
import type { RecurrenceTemplate } from "../domain/recurrence";
import { splitShares } from "../domain/split";
import { accountInSpace, fundAccount, ownAccount, partyAccount, usableCategory } from "./checks";
import type { LedgerDeps } from "./deps";

/** A template as a definition names it: a contribution's member defaults to the requester (HU-E4-09). */
export type TemplateInput =
  | Exclude<RecurrenceTemplate, { readonly type: "FUND_CONTRIBUTION" }>
  | {
      readonly type: "FUND_CONTRIBUTION";
      readonly fundAccountId: string;
      readonly memberId?: string;
      readonly sourceAccountId: string | null;
    };

export const withContributor = (template: TemplateInput, requesterMemberId: string): RecurrenceTemplate =>
  template.type === "FUND_CONTRIBUTION"
    ? { ...template, memberId: template.memberId ?? requesterMemberId }
    : template;

/** Where a template records, and on whose behalf: the user who defined the recurrence (ruling P21). */
export interface TemplateOwner {
  readonly spaceId: string;
  readonly creatorUserId: string;
}

/**
 * Ruling P21: a template is checked exactly as recording one of its occurrences would check it, for its creator as
 * the requester and with the record use cases' own helpers: a usable category, the fund of this space or a current
 * member's own account (D9: only its owner debits it; any writer may spend the fund or pay for a guest, D15),
 * accounts of this space for incomes and transfers, and a split of current members that holds for `amount`.
 */
export const checkTemplate = async (
  deps: Pick<LedgerDeps, "accounts" | "categories">,
  owner: TemplateOwner,
  members: readonly SpaceMember[],
  template: RecurrenceTemplate,
  amount: Money,
): Promise<Result<RecurrenceTemplate>> => {
  const debit = { required: true, debitedBy: owner.creatorUserId };
  const ownInSpace = async (accountId: string) =>
    flatMap(await ownAccount(deps, accountId, owner.creatorUserId), (account) =>
      accountInSpace(account, owner.spaceId),
    );
  switch (template.type) {
    case "EXPENSE": {
      const category = await usableCategory(deps, owner.spaceId, template.categoryId);
      if (!category.ok) return category;
      const { memberId, accountId } = template.payer;
      if (memberId === null) {
        if (accountId === null) return err(domainError("AccountRequired"));
        const fund = await fundAccount(deps, accountId, owner.spaceId);
        if (!fund.ok) return fund;
      } else {
        const paying = await partyAccount(deps, members, memberId, accountId, debit);
        if (!paying.ok) return paying;
      }
      if (template.split !== null) {
        const shares = splitShares(
          amount,
          template.split,
          members.map((m) => m.id),
        );
        if (!shares.ok) return shares;
      }
      return ok(template);
    }
    case "INCOME": {
      const category = await usableCategory(deps, owner.spaceId, template.categoryId);
      if (!category.ok) return category;
      const account = await ownInSpace(template.accountId);
      return account.ok ? ok(template) : account;
    }
    case "TRANSFER": {
      if (template.sourceAccountId === template.destinationAccountId) {
        return err(domainError("SameAccountTransfer"));
      }
      const source = await ownInSpace(template.sourceAccountId);
      if (!source.ok) return source;
      const destination = await ownInSpace(template.destinationAccountId);
      return destination.ok ? ok(template) : destination;
    }
    case "FUND_CONTRIBUTION": {
      const fund = await fundAccount(deps, template.fundAccountId, owner.spaceId);
      if (!fund.ok) return fund;
      const source = await partyAccount(deps, members, template.memberId, template.sourceAccountId, debit);
      return source.ok ? ok(template) : source;
    }
  }
};
```

`src/modules/ledger/application/recurrence-view.ts`:

```ts
import type { LocalDate } from "@/shared/kernel";
import type { Occurrence } from "../domain/occurrence";
import { statusOf, upcomingDates, type Recurrence, type RecurrenceStatus } from "../domain/recurrence";
import type { OccurrenceRepository } from "./recurrence-ports";

/** A recurrence as members read it: its status, its next date and its latest occurrence (ruling P31). */
export interface RecurrenceView {
  readonly recurrence: Recurrence;
  readonly status: RecurrenceStatus;
  /** The next date it will record; null while paused or once ended. */
  readonly nextOccurrence: LocalDate | null;
  /** The latest date it considered: the transaction recorded for it, or why it was skipped. */
  readonly lastOccurrence: Occurrence | null;
}

export const recurrenceView = (recurrence: Recurrence, lastOccurrence: Occurrence | null): RecurrenceView => ({
  recurrence,
  status: statusOf(recurrence),
  nextOccurrence: upcomingDates(recurrence, 1)[0] ?? null,
  lastOccurrence,
});

/** The views of recurrences of one space, each with its latest occurrence, from one read. */
export const viewsOf = async (
  occurrences: Pick<OccurrenceRepository, "latestOccurrences">,
  spaceId: string,
  recurrences: readonly Recurrence[],
): Promise<RecurrenceView[]> => {
  const latest = await occurrences.latestOccurrences(
    spaceId,
    recurrences.map((r) => r.id),
  );
  return recurrences.map((r) => recurrenceView(r, latest.get(r.id) ?? null));
};
```

`src/modules/ledger/application/define-recurrence.ts`:

```ts
import { ok, todayIn, type LocalDate, type Money, type PeriodPolicy, type Result } from "@/shared/kernel";
import { defineRecurrence, type RecurrenceMode } from "../domain/recurrence";
import { scheduleOf } from "../domain/recurrence-schedule";
import { positiveAmount } from "../domain/transaction";
import { authorizeWriter, inSpaceCurrency } from "./checks";
import type { RecurrenceDeps } from "./recurrence-ports";
import { checkTemplate, withContributor, type TemplateInput } from "./recurrence-template";
import { recurrenceView, type RecurrenceView } from "./recurrence-view";

export interface DefineRecurrenceInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly description: string;
  /** AUTO: what every occurrence records; CONFIRM: the estimate each pending occurrence suggests. */
  readonly amount: Money;
  readonly template: TemplateInput;
  /** Anchor days as requested: InvalidPeriodPolicy unless they make a MONTHLY or SEMI_MONTHLY policy. */
  readonly schedule: PeriodPolicy;
  readonly mode: RecurrenceMode;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate | null;
}

export type DefineRecurrence = (input: DefineRecurrenceInput) => Promise<Result<RecurrenceView>>;

/**
 * HU-E4-11 DefineRecurrence: a member who records money (money.record) defines a recurring expense, income, transfer
 * or fund contribution of the space. The template is checked as recording an occurrence would check it, for the
 * definer, on whose behalf every AUTO occurrence is recorded (ruling P21).
 */
export const createDefineRecurrence =
  (deps: RecurrenceDeps): DefineRecurrence =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeWriter(deps, input.spaceId, input.userId);
      if (!writer.ok) return writer;
      const space = writer.value;
      const amount = positiveAmount(input.amount.minor);
      if (!amount.ok) return amount;
      const currency = inSpaceCurrency(space, input.amount);
      if (!currency.ok) return currency;
      const schedule = scheduleOf(input.schedule);
      if (!schedule.ok) return schedule;
      const members = await deps.members.listCurrent(space.spaceId);
      const template = await checkTemplate(
        deps,
        { spaceId: space.spaceId, creatorUserId: input.userId },
        members,
        withContributor(input.template, space.memberId),
        input.amount,
      );
      if (!template.ok) return template;
      const recurrence = defineRecurrence({
        id: deps.ids.next<"Recurrence">(),
        spaceId: space.spaceId,
        description: input.description,
        amount: amount.value,
        currency: space.currency,
        template: template.value,
        schedule: schedule.value,
        mode: input.mode,
        startDate: input.startDate,
        endDate: input.endDate,
        createdBy: input.userId,
        now: deps.clock.now(),
        today: todayIn(deps.clock, deps.timeZone),
      });
      if (!recurrence.ok) return recurrence;
      await deps.recurrences.add(recurrence.value);
      return ok(recurrenceView(recurrence.value, null));
    });
```

Append to `src/modules/ledger/application/index.ts`:

```ts
export {
  createDefineRecurrence,
  type DefineRecurrence,
  type DefineRecurrenceInput,
} from "./define-recurrence";
export { checkTemplate, type TemplateInput, type TemplateOwner } from "./recurrence-template";
export { recurrenceView, viewsOf, type RecurrenceView } from "./recurrence-view";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: PASS. Mutation check: in `checkTemplate`, temporarily pass `debitedBy: null` — "lets only Juan define Internet …" fails with `ok` for Ana; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/application/recurrence-template.ts src/modules/ledger/application/recurrence-view.ts src/modules/ledger/application/define-recurrence.ts src/modules/ledger/application/index.ts src/modules/ledger/application/recurrences.test.ts tests/support/in-memory-recurrences.ts
git commit -m "feat(ledger): define recurring transactions checked as recording them would check them (Refs #40)"
```

---

### Task 5: Ledger — update, pause, resume, end and read recurrences

Implements HU-E4-11's management (issue #40) at the use-case level: scenarios "Monthly schedules clamp to short months", "Semi-monthly schedule", "Editing applies to future occurrences only" (the edit; Task 8b records around it), "Pausing skips the paused span without back-filling", and the notes on `UpdateRecurrence`, `PauseRecurrence`, `ResumeRecurrence`, `EndRecurrence` and `GET …/occurrences?count`. Pins Review Focus 3 (`canModify`, D9 on amounts, resuming after the payer left) and Review Focus 5 (other spaces' and malformed ids, archived spaces).

Decisions:
- Every write runs inside one transaction: the membership (archived spaces refuse, HU-E1-09), the recurrence under its row lock (`lockForWrite`), then the role (ruling P30): its creator changes it, OWNER and ADMIN change anyone's (`canModify`, as `EditTransaction` does for transactions, HU-E4-06). A VIEWER or another MEMBER answers `InsufficientRole`.
- An amount debited from a member's own account is changed by that member, its creator, only (`AccountNotOwned`, D9, ruling P22), mirroring `EditTransaction`'s rule for amounts.
- A new category, split or amount is checked again with `checkTemplate` for the creator (P21); resuming checks the whole template again and requires the creator to be a current member (`NotASpaceMember`), so a recurrence paused because its payer or creator left cannot resume (ruling P26).
- Reads are `space.read`, archived spaces included. The preview lists at most 24 dates (`MAX_UPCOMING`).

**Files:**
- Create: `src/modules/ledger/application/manage-recurrence.ts`, `src/modules/ledger/application/recurrence-queries.ts`
- Modify: `src/modules/ledger/application/index.ts`
- Test: create `src/modules/ledger/application/manage-recurrences.test.ts`

**Interfaces:**
- Consumes: `revisedRecurrence`, `pausedRecurrence`, `resumedRecurrence`, `endedRecurrence`, `debitsPersonalAccount`, `upcomingDates`, `MAX_UPCOMING` (Tasks 2a, 2b); `scheduleOf` (Task 1); `checkTemplate`, `viewsOf`, `createDefineRecurrence` (Task 4); `canModify` (M1 domain); `recurrenceWorld`, `rentDefinition`, `MovableClock` (Task 4).
- Produces:
  - `interface RecurrenceWriteInput { spaceId; userId; recurrenceId }`; `interface RecurrenceEdit { description?; amount?: Money; categoryId?; split?: RecurrenceSplit | null; schedule?: PeriodPolicy; mode?; endDate?: LocalDate | null }`
  - `type UpdateRecurrence = (input: RecurrenceWriteInput & { changes: RecurrenceEdit }) => Promise<Result<RecurrenceView>>`; `type PauseRecurrence`, `ResumeRecurrence`, `EndRecurrence = (input: RecurrenceWriteInput) => Promise<Result<RecurrenceView>>`; `createUpdateRecurrence`, `createPauseRecurrence`, `createResumeRecurrence`, `createEndRecurrence` (each `(deps: RecurrenceDeps)`) — `SpaceNotFound`, `SpaceArchived`, `RecurrenceNotFound`, `InsufficientRole`, `RecurrenceEnded`, `InvalidRecurrenceTransition`, `AccountNotOwned`, the template's codes
  - `type ListRecurrences = (input: { spaceId; userId }) => Promise<Result<RecurrenceView[]>>`; `type GetRecurrence = (input: { spaceId; userId; recurrenceId }) => Promise<Result<RecurrenceView>>`; `type ListUpcomingOccurrences = (input: { spaceId; userId; recurrenceId; count: number }) => Promise<Result<LocalDate[]>>`; `createListRecurrences`, `createGetRecurrence`, `createListUpcomingOccurrences` (each `(deps: Pick<RecurrenceDeps, "access" | "recurrences" | "occurrences">)`)

- [ ] **Step 1: Write the failing test**

`src/modules/ledger/application/manage-recurrences.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES } from "../../../../tests/support/in-memory-ledger";
import { recurrenceWorld, rentDefinition } from "../../../../tests/support/in-memory-recurrences";
import { createDefineRecurrence, type DefineRecurrenceInput } from "./define-recurrence";
import {
  createEndRecurrence,
  createPauseRecurrence,
  createResumeRecurrence,
  createUpdateRecurrence,
} from "./manage-recurrence";
import { createGetRecurrence, createListRecurrences, createListUpcomingOccurrences } from "./recurrence-queries";

const cop = (pesos: bigint) => money(pesos * 100n);
const day = (iso: string) => iso as LocalDate;

/** The recurrence world with `definition` (Ana's Rent unless given) defined, and every use case over it. */
const world = async (definition: DefineRecurrenceInput = rentDefinition()) => {
  const w = recurrenceWorld();
  const defined = unwrap(await createDefineRecurrence(w.deps)(definition)).recurrence;
  const ref = (userId = "u-ana") => ({ spaceId: "space-household", userId, recurrenceId: defined.id });
  return {
    ...w,
    defined,
    ref,
    update: createUpdateRecurrence(w.deps),
    pause: createPauseRecurrence(w.deps),
    resume: createResumeRecurrence(w.deps),
    end: createEndRecurrence(w.deps),
    list: createListRecurrences(w.deps),
    get: createGetRecurrence(w.deps),
    upcoming: createListUpcomingOccurrences(w.deps),
  };
};
const internet = rentDefinition({
  userId: "u-juan",
  description: "Internet",
  amount: cop(120_000n),
  template: {
    type: "EXPENSE",
    categoryId: CATEGORIES.household.id,
    payer: { memberId: "member-juan", accountId: ACCOUNTS.davivienda.id },
    split: null,
  },
  schedule: { kind: "MONTHLY", day: 5 },
});

describe("managing a recurrence (HU-E4-11)", () => {
  it("changes the Rent to 1,300,000 COP for the occurrences not recorded yet", async () => {
    const { update, ref, recurrences } = await world();
    const view = unwrap(
      await update({ ...ref(), changes: { amount: cop(1_300_000n), endDate: day("2027-06-30") } }),
    );
    expect([view.recurrence.amount, view.recurrence.endDate, recurrences.rows[0]!.amount]).toEqual([
      130_000_000n,
      "2027-06-30",
      130_000_000n,
    ]);
  });

  it("pauses Cleaning on 2026-12-20 and resumes it on 2027-02-10: next on 2027-02-16", async () => {
    const cleaning = rentDefinition({
      description: "Cleaning",
      amount: cop(80_000n),
      schedule: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 },
    });
    const { pause, resume, ref, clock } = await world(cleaning);
    clock.set("2026-12-20");
    const paused = unwrap(await pause(ref()));
    expect([paused.status, paused.nextOccurrence]).toEqual(["PAUSED", null]);
    clock.set("2027-02-10");
    const resumed = unwrap(await resume(ref()));
    expect([resumed.status, resumed.nextOccurrence]).toEqual(["ACTIVE", "2027-02-16"]);
  });

  it("ends a recurrence logically: ENDED and kept, refusing edits and further moves", async () => {
    const { end, update, pause, ref, recurrences } = await world();
    const ended = unwrap(await end(ref()));
    expect([ended.status, ended.nextOccurrence, recurrences.rows.length]).toEqual(["ENDED", null, 1]);
    expect([
      codeOf(await update({ ...ref(), changes: { description: "Rent" } })),
      codeOf(await pause(ref())),
      codeOf(await end(ref())),
    ]).toEqual(["RecurrenceEnded", "InvalidRecurrenceTransition", "InvalidRecurrenceTransition"]);
  });

  it("lets its creator, OWNERs and ADMINs manage it, never other MEMBERs or VIEWERs (P30)", async () => {
    const { pause, resume, ref } = await world();
    expect([
      codeOf(await pause(ref("u-luis"))),
      codeOf(await pause(ref("u-sofi"))),
      codeOf(await pause(ref("u-juan"))),
      codeOf(await resume(ref("u-ana"))),
    ]).toEqual(["InsufficientRole", "InsufficientRole", "ok", "ok"]);
    const luis = await world(rentDefinition({ userId: "u-luis", description: "Luis's rent" }));
    expect(codeOf(await luis.pause(luis.ref("u-luis")))).toBe("ok");
  });

  it("changes an amount debited from Ana's account only for Ana (D9, P22)", async () => {
    const gym = rentDefinition({
      description: "Gym",
      amount: cop(90_000n),
      template: {
        type: "EXPENSE",
        categoryId: CATEGORIES.household.id,
        payer: { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id },
        split: null,
      },
    });
    const { update, ref } = await world(gym);
    expect([
      codeOf(await update({ ...ref("u-juan"), changes: { amount: cop(95_000n) } })),
      codeOf(await update({ ...ref("u-juan"), changes: { description: "Gym, renewed" } })),
      codeOf(await update({ ...ref("u-ana"), changes: { amount: cop(95_000n) } })),
    ]).toEqual(["AccountNotOwned", "ok", "ok"]);
    const rent = await world();
    expect(codeOf(await rent.update({ ...rent.ref("u-juan"), changes: { amount: cop(1_300_000n) } }))).toBe("ok");
  });

  it("checks a new category, split or schedule as defining would", async () => {
    const { update, ref } = await world();
    expect([
      codeOf(await update({ ...ref(), changes: { categoryId: CATEGORIES.groceries.id } })),
      codeOf(
        await update({ ...ref(), changes: { split: { method: "EQUAL", participants: [{ memberId: "member-marta" }] } } }),
      ),
      codeOf(await update({ ...ref(), changes: { schedule: { kind: "MONTHLY", day: 32 } } })),
      codeOf(
        await update({
          ...ref(),
          changes: {
            split: {
              method: "SHARES",
              participants: [
                { memberId: "member-ana", units: 1 },
                { memberId: "member-juan", units: 2 },
              ],
            },
          },
        }),
      ),
    ]).toEqual(["CategoryNotFound", "NotASpaceMember", "InvalidPeriodPolicy", "ok"]);
  });

  it("resumes only while its template still holds: once Juan left, Internet answers NotASpaceMember (P26)", async () => {
    const { pause, resume, ref, spaces } = await world(internet);
    unwrap(await pause(ref("u-ana")));
    await spaces.markLeft("space-household", "member-juan", "USER", new Date("2026-11-01T12:00:00Z"));
    expect(codeOf(await resume(ref("u-ana")))).toBe("NotASpaceMember");
  });

  it("answers RecurrenceNotFound for another space's or a malformed id, and SpaceArchived to writes of an archived space", async () => {
    const { pause, get, ref, spaces } = await world();
    expect([
      codeOf(await pause({ ...ref(), recurrenceId: "not-a-recurrence" })),
      codeOf(await pause({ ...ref(), spaceId: "space-ana" })),
      codeOf(await get({ ...ref(), spaceId: "space-ana" })),
    ]).toEqual(["RecurrenceNotFound", "RecurrenceNotFound", "RecurrenceNotFound"]);
    await spaces.archive("space-household");
    expect([codeOf(await pause(ref())), codeOf(await get(ref()))]).toEqual(["SpaceArchived", "ok"]);
  });
});

describe("reading recurrences (HU-E4-11)", () => {
  it("lists the space's recurrences in the order they were defined, for every member", async () => {
    const { list, deps } = await world();
    unwrap(await createDefineRecurrence(deps)(rentDefinition({ description: "Cleaning" })));
    const views = unwrap(await list({ spaceId: "space-household", userId: "u-sofi" }));
    expect(views.map((v) => [v.recurrence.description, v.status, v.nextOccurrence])).toEqual([
      ["Rent", "ACTIVE", "2026-12-01"],
      ["Cleaning", "ACTIVE", "2026-12-01"],
    ]);
    expect(codeOf(await list({ spaceId: "space-household", userId: "u-marta" }))).toBe("SpaceNotFound");
  });

  it("previews MONTHLY(31) from 2027-01-01 as 2027-01-31, 2027-02-28, 2027-03-31, and SEMI_MONTHLY(1, 16) in December", async () => {
    const clamped = await world(rentDefinition({ schedule: { kind: "MONTHLY", day: 31 }, startDate: day("2027-01-01") }));
    expect(unwrap(await clamped.upcoming({ ...clamped.ref("u-sofi"), count: 3 }))).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
    ]);
    const cleaning = await world(rentDefinition({ schedule: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } }));
    expect(unwrap(await cleaning.upcoming({ ...cleaning.ref(), count: 2 }))).toEqual(["2026-12-01", "2026-12-16"]);
  });

  it("previews at most 24 dates", async () => {
    const { upcoming, ref } = await world();
    expect(unwrap(await upcoming({ ...ref(), count: 100 }))).toHaveLength(24);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/manage-recurrences.test.ts`
Expected: FAIL — `Failed to resolve import "./manage-recurrence"`.

- [ ] **Step 3: Implement**

`src/modules/ledger/application/manage-recurrence.ts`:

```ts
import type { SpaceId, SpaceMembership } from "@/modules/spaces/application";
import {
  domainError,
  err,
  Money,
  ok,
  todayIn,
  type LocalDate,
  type PeriodPolicy,
  type Result,
} from "@/shared/kernel";
import {
  debitsPersonalAccount,
  endedRecurrence,
  pausedRecurrence,
  resumedRecurrence,
  revisedRecurrence,
  type Recurrence,
  type RecurrenceMode,
  type RecurrenceSplit,
} from "../domain/recurrence";
import { scheduleOf } from "../domain/recurrence-schedule";
import { canModify } from "../domain/transaction";
import { inSpaceCurrency } from "./checks";
import type { RecurrenceDeps } from "./recurrence-ports";
import { checkTemplate } from "./recurrence-template";
import { viewsOf, type RecurrenceView } from "./recurrence-view";

export interface RecurrenceWriteInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly recurrenceId: string;
}

/** HU-E4-11: what an edit may change (ruling P22); the type, payer and accounts stay as defined. */
export interface RecurrenceEdit {
  readonly description?: string;
  readonly amount?: Money;
  readonly categoryId?: string;
  /** Null returns to the default split of each occurrence (ruling P23). */
  readonly split?: RecurrenceSplit | null;
  /** Anchor days as requested: InvalidPeriodPolicy unless valid. */
  readonly schedule?: PeriodPolicy;
  readonly mode?: RecurrenceMode;
  readonly endDate?: LocalDate | null;
}

export type UpdateRecurrence = (
  input: RecurrenceWriteInput & { readonly changes: RecurrenceEdit },
) => Promise<Result<RecurrenceView>>;
export type PauseRecurrence = (input: RecurrenceWriteInput) => Promise<Result<RecurrenceView>>;
export type ResumeRecurrence = (input: RecurrenceWriteInput) => Promise<Result<RecurrenceView>>;
export type EndRecurrence = (input: RecurrenceWriteInput) => Promise<Result<RecurrenceView>>;

/**
 * Every recurrence write starts here, inside its transaction: the membership (an archived space refuses, HU-E1-09),
 * the recurrence under its row lock (read under the lock, preflight N4), then the role (ruling P30): its creator
 * changes it, OWNER and ADMIN change anyone's (canModify, as for transactions, HU-E4-06).
 */
const recurrenceForWrite = async (
  deps: Pick<RecurrenceDeps, "access" | "recurrences">,
  input: RecurrenceWriteInput,
): Promise<Result<{ space: SpaceMembership; recurrence: Recurrence }>> => {
  const membership = await deps.access(input.spaceId, input.userId);
  if (!membership.ok) return membership;
  const space = membership.value;
  const recurrence = await deps.recurrences.lockForWrite(space.spaceId, input.recurrenceId);
  if (recurrence === null) return err(domainError("RecurrenceNotFound"));
  return canModify(space.role, recurrence.createdBy, input.userId)
    ? ok({ space, recurrence })
    : err(domainError("InsufficientRole"));
};

/** Rulings P21 and P26: its template is checked again as recording would check it, for its creator. */
const rechecked = async (deps: RecurrenceDeps, recurrence: Recurrence): Promise<Result<Recurrence>> => {
  const members = await deps.members.listCurrent(recurrence.spaceId as SpaceId);
  // A recurrence whose creator left records on nobody's behalf.
  if (!members.some((m) => m.userId === recurrence.createdBy)) return err(domainError("NotASpaceMember"));
  const amount = Money.ofMinor(recurrence.amount, recurrence.currency);
  if (!amount.ok) return amount;
  const checked = await checkTemplate(
    deps,
    { spaceId: recurrence.spaceId, creatorUserId: recurrence.createdBy },
    members,
    recurrence.template,
    amount.value,
  );
  return checked.ok ? ok(recurrence) : checked;
};

const saved = async (deps: RecurrenceDeps, recurrence: Recurrence): Promise<Result<RecurrenceView>> => {
  await deps.recurrences.save(recurrence);
  const [view] = await viewsOf(deps.occurrences, recurrence.spaceId, [recurrence]);
  return ok(view!);
};

/**
 * HU-E4-11 UpdateRecurrence: description, amount, category, split, schedule, mode and end date change for every
 * occurrence not recorded yet (ruling P24). D9 (ruling P22): an amount debited from a member's own account is
 * changed by that member, its creator, only.
 */
export const createUpdateRecurrence =
  (deps: RecurrenceDeps): UpdateRecurrence =>
  (input) =>
    deps.tm.run(async () => {
      const found = await recurrenceForWrite(deps, input);
      if (!found.ok) return found;
      const { space, recurrence } = found.value;
      const { amount, schedule, ...rest } = input.changes;
      const nextSchedule = schedule === undefined ? ok(undefined) : scheduleOf(schedule);
      if (!nextSchedule.ok) return nextSchedule;
      const revised = revisedRecurrence(
        recurrence,
        { ...rest, amount: amount?.minor, schedule: nextSchedule.value },
        deps.clock.now(),
      );
      if (!revised.ok) return revised;
      if (amount !== undefined) {
        const currency = inSpaceCurrency(space, amount);
        if (!currency.ok) return currency;
        if (input.userId !== recurrence.createdBy && debitsPersonalAccount(recurrence.template)) {
          return err(domainError("AccountNotOwned"));
        }
      }
      // A new category, split or amount is what recording an occurrence checks (P21).
      if (rest.categoryId !== undefined || rest.split !== undefined || amount !== undefined) {
        const checked = await rechecked(deps, revised.value);
        if (!checked.ok) return checked;
      }
      return saved(deps, revised.value);
    });

/** HU-E4-11 PauseRecurrence: nothing is recorded until it resumes. */
export const createPauseRecurrence =
  (deps: RecurrenceDeps): PauseRecurrence =>
  (input) =>
    deps.tm.run(async () => {
      const found = await recurrenceForWrite(deps, input);
      if (!found.ok) return found;
      const paused = pausedRecurrence(found.value.recurrence, deps.clock.now());
      return paused.ok ? saved(deps, paused.value) : paused;
    });

/** HU-E4-11 ResumeRecurrence: from today on, never back-filling the paused days (P24), if its template still holds (P26). */
export const createResumeRecurrence =
  (deps: RecurrenceDeps): ResumeRecurrence =>
  (input) =>
    deps.tm.run(async () => {
      const found = await recurrenceForWrite(deps, input);
      if (!found.ok) return found;
      const resumed = resumedRecurrence(found.value.recurrence, deps.clock.now(), todayIn(deps.clock, deps.timeZone));
      if (!resumed.ok) return resumed;
      const checked = await rechecked(deps, resumed.value);
      return checked.ok ? saved(deps, checked.value) : checked;
    });

/** HU-E4-11 EndRecurrence, D8: logical; the recurrence and its occurrences stay, and nothing else is recorded. */
export const createEndRecurrence =
  (deps: RecurrenceDeps): EndRecurrence =>
  (input) =>
    deps.tm.run(async () => {
      const found = await recurrenceForWrite(deps, input);
      if (!found.ok) return found;
      const ended = endedRecurrence(found.value.recurrence, deps.clock.now());
      return ended.ok ? saved(deps, ended.value) : ended;
    });
```

`src/modules/ledger/application/recurrence-queries.ts`:

```ts
import { authorizeSpaceAction } from "@/modules/spaces/application";
import { domainError, err, ok, type LocalDate, type Result } from "@/shared/kernel";
import { MAX_UPCOMING, upcomingDates } from "../domain/recurrence";
import type { RecurrenceDeps } from "./recurrence-ports";
import { viewsOf, type RecurrenceView } from "./recurrence-view";

export type ListRecurrences = (input: {
  spaceId: string;
  userId: string;
}) => Promise<Result<RecurrenceView[]>>;
export type GetRecurrence = (input: {
  spaceId: string;
  userId: string;
  recurrenceId: string;
}) => Promise<Result<RecurrenceView>>;
export type ListUpcomingOccurrences = (input: {
  spaceId: string;
  userId: string;
  recurrenceId: string;
  count: number;
}) => Promise<Result<LocalDate[]>>;

type ReadDeps = Pick<RecurrenceDeps, "access" | "recurrences" | "occurrences">;

/** HU-E4-11: any member reads the space's recurrences (space.read), archived spaces included (HU-E1-09). */
export const createListRecurrences =
  (deps: ReadDeps): ListRecurrences =>
  async (input) => {
    const reader = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!reader.ok) return reader;
    const spaceId = reader.value.spaceId;
    return ok(await viewsOf(deps.occurrences, spaceId, await deps.recurrences.list(spaceId)));
  };

export const createGetRecurrence =
  (deps: ReadDeps): GetRecurrence =>
  async (input) => {
    const reader = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!reader.ok) return reader;
    const recurrence = await deps.recurrences.find(reader.value.spaceId, input.recurrenceId);
    if (recurrence === null) return err(domainError("RecurrenceNotFound"));
    const [view] = await viewsOf(deps.occurrences, reader.value.spaceId, [recurrence]);
    return ok(view!);
  };

/** HU-E4-11 `GET …/occurrences?count`: the next dates it will record, at most 24; none while paused or ended. */
export const createListUpcomingOccurrences =
  (deps: ReadDeps): ListUpcomingOccurrences =>
  async (input) => {
    const reader = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!reader.ok) return reader;
    const recurrence = await deps.recurrences.find(reader.value.spaceId, input.recurrenceId);
    if (recurrence === null) return err(domainError("RecurrenceNotFound"));
    return ok(upcomingDates(recurrence, Math.min(Math.max(input.count, 1), MAX_UPCOMING)));
  };
```

Append to `src/modules/ledger/application/index.ts`:

```ts
export {
  createEndRecurrence,
  createPauseRecurrence,
  createResumeRecurrence,
  createUpdateRecurrence,
  type EndRecurrence,
  type PauseRecurrence,
  type RecurrenceEdit,
  type RecurrenceWriteInput,
  type ResumeRecurrence,
  type UpdateRecurrence,
} from "./manage-recurrence";
export {
  createGetRecurrence,
  createListRecurrences,
  createListUpcomingOccurrences,
  type GetRecurrence,
  type ListRecurrences,
  type ListUpcomingOccurrences,
} from "./recurrence-queries";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: PASS. Mutation check: in `createUpdateRecurrence`, temporarily drop the `debitsPersonalAccount` condition — "changes an amount debited from Ana's account only for Ana" fails with `ok` for Juan; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/application/manage-recurrence.ts src/modules/ledger/application/recurrence-queries.ts src/modules/ledger/application/index.ts src/modules/ledger/application/manage-recurrences.test.ts
git commit -m "feat(ledger): edit, pause, resume, end and preview recurrences (Refs #40)"
```

---

### Task 6a: Contracts — the definition request

Implements the request side of HU-E4-11's `POST …/recurrences` (issue #40); no route and no OpenAPI change yet.

Decisions:
- The request nests the template under `template`, a union on `type`, so each type names exactly its references and the base fields appear once: an expense names `categoryId`, `payer` (`memberId` null for the fund, `accountId` null or absent for a guest) and an optional `split`; an income `categoryId` and `accountId`; a transfer its two accounts; a contribution `fundAccountId`, an optional `memberId` (the requester) and `sourceAccountId` (absent for a guest).
- The split offers `EQUAL`, `PERCENT` and `SHARES` only (ruling P23; an `EXACT` split is a `422 ValidationFailed`), with percentages as strings like the ledger's (`PercentSchema`); no split means the default split of each occurrence.
- A schedule request takes any integer days, so out-of-range anchors answer the domain's `InvalidPeriodPolicy`, as the space settings do (HU-E1-03). The schemas are this module's own (another module's contract cannot be imported).

**Files:**
- Create: `src/modules/ledger/contracts/recurrences.contract.ts`
- Test: create `src/modules/ledger/contracts/recurrences.contract.test.ts`

**Interfaces:**
- Consumes: `DefineRecurrenceInput`, `TemplateInput` (Task 4); `RecurrenceSplit` (Task 2a); `MoneySchema`, `moneyFromDto`, `PercentSchema`, `basisPointsOf` (`src/shared/http/contracts.ts`).
- Produces: `ScheduleInputSchema`, `RecurrenceSplitSchema`, `splitOf(dto): RecurrenceSplit`, `DefineRecurrenceBodySchema`, `recurrenceFromBody(body): Result<Omit<DefineRecurrenceInput, "spaceId" | "userId">>`.

- [ ] **Step 1: Write the failing test**

`src/modules/ledger/contracts/recurrences.contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { money, unwrap } from "../../../../tests/support/fakes";
import { DefineRecurrenceBodySchema, recurrenceFromBody } from "./recurrences.contract";

const rentBody = {
  description: "Rent",
  amount: { amount: "120000000", currency: "COP" },
  template: { type: "EXPENSE", categoryId: "cat-rent", payer: { memberId: null, accountId: "acc-fund" } },
  schedule: { kind: "MONTHLY", day: 1 },
  mode: "AUTO",
  startDate: "2026-12-01",
};
const parsed = (body: unknown) => DefineRecurrenceBodySchema.parse(body);

describe("the recurrence definition on the wire (HU-E4-11)", () => {
  it("reads the Rent body as DefineRecurrence input: the fund pays, no split, no end", () => {
    expect(unwrap(recurrenceFromBody(parsed(rentBody)))).toEqual({
      description: "Rent",
      amount: money(120_000_000n),
      template: { type: "EXPENSE", categoryId: "cat-rent", payer: { memberId: null, accountId: "acc-fund" }, split: null },
      schedule: { kind: "MONTHLY", day: 1 },
      mode: "AUTO",
      startDate: "2026-12-01",
      endDate: null,
    });
  });

  it("turns percentages into basis points and leaves a contribution's missing source null", () => {
    const split = {
      method: "PERCENT",
      participants: [
        { memberId: "member-ana", percent: "40" },
        { memberId: "member-juan", percent: "60" },
      ],
    };
    const expense = unwrap(recurrenceFromBody(parsed({ ...rentBody, template: { ...rentBody.template, split } })));
    expect(expense.template).toMatchObject({
      split: {
        method: "PERCENT",
        participants: [
          { memberId: "member-ana", basisPoints: 4000 },
          { memberId: "member-juan", basisPoints: 6000 },
        ],
      },
    });
    const contribution = unwrap(
      recurrenceFromBody(
        parsed({ ...rentBody, template: { type: "FUND_CONTRIBUTION", fundAccountId: "acc-fund", memberId: "member-pedro" } }),
      ),
    );
    expect(contribution.template).toEqual({
      type: "FUND_CONTRIBUTION",
      fundAccountId: "acc-fund",
      memberId: "member-pedro",
      sourceAccountId: null,
    });
  });

  it("refuses an EXACT split, an unknown type and fractional anchors, and leaves anchor ranges to the domain", () => {
    const accepts = (body: unknown) => DefineRecurrenceBodySchema.safeParse(body).success;
    expect([
      accepts({ ...rentBody, template: { ...rentBody.template, split: { method: "EXACT", participants: [] } } }),
      accepts({ ...rentBody, template: { type: "SETTLEMENT" } }),
      accepts({ ...rentBody, schedule: { kind: "MONTHLY", day: 1.5 } }),
      accepts({ ...rentBody, schedule: { kind: "MONTHLY", day: 0 } }),
      accepts({ ...rentBody, endDate: null }),
    ]).toEqual([false, false, false, true, true]);
  });

  it("answers InvalidDate for a date the kernel refuses", () => {
    expect(recurrenceFromBody(parsed({ ...rentBody, startDate: "1899-12-31" }))).toMatchObject({
      ok: false,
      error: { code: "InvalidDate" },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/ledger/contracts/recurrences.contract.test.ts`
Expected: FAIL — `Failed to resolve import "./recurrences.contract"`.

- [ ] **Step 3: Implement**

`src/modules/ledger/contracts/recurrences.contract.ts`:

```ts
import { z } from "zod";
import { basisPointsOf, moneyFromDto, MoneySchema, PercentSchema } from "@/shared/http/contracts";
import { localDate, ok, type Result } from "@/shared/kernel";
import type { DefineRecurrenceInput, RecurrenceSplit, TemplateInput } from "../application";

const Id = z.string().min(1).max(64);
/** Participants per split: bounds the payload; membership is checked by the domain. */
const MAX_PARTS = 100;
const MODES = ["AUTO", "CONFIRM"] as const;

/** Request shape: any integer days, so the domain answers InvalidPeriodPolicy instead of ValidationFailed (HU-E1-03). */
export const ScheduleInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MONTHLY"), day: z.number().int() }),
  z.object({ kind: z.literal("SEMI_MONTHLY"), day1: z.number().int(), day2: z.number().int() }),
]);

/**
 * Ruling P23: EQUAL among the chosen members, or by percentage or share units; EXACT is not offered. Without a split,
 * each occurrence takes its default split (spec 5.3: BY_ALLOCATION with the ACTIVE plan of its period, else EQUAL).
 */
export const RecurrenceSplitSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("EQUAL"), participants: z.array(z.object({ memberId: Id })).max(MAX_PARTS) }),
  z.object({
    method: z.literal("PERCENT"),
    participants: z.array(z.object({ memberId: Id, percent: PercentSchema })).max(MAX_PARTS),
  }),
  z.object({
    method: z.literal("SHARES"),
    participants: z.array(z.object({ memberId: Id, units: z.number().int() })).max(MAX_PARTS),
  }),
]);
type RecurrenceSplitDto = z.infer<typeof RecurrenceSplitSchema>;

export const splitOf = (split: RecurrenceSplitDto): RecurrenceSplit => {
  switch (split.method) {
    case "EQUAL":
      return { method: "EQUAL", participants: split.participants.map((p) => ({ memberId: p.memberId })) };
    case "PERCENT":
      return {
        method: "PERCENT",
        participants: split.participants.map((p) => ({ memberId: p.memberId, basisPoints: basisPointsOf(p.percent) })),
      };
    case "SHARES":
      return {
        method: "SHARES",
        participants: split.participants.map((p) => ({ memberId: p.memberId, units: p.units })),
      };
  }
};

/**
 * HU-E4-11, spec 5.2: what every occurrence records besides its date and amount, fixed once defined (ruling P22). An
 * expense is paid by a member (a guest sends no `accountId`) or by the fund (`memberId` null, `accountId` the fund);
 * a contribution's member defaults to the requester and a guest sends no `sourceAccountId`.
 */
const TemplateBodySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("EXPENSE"),
    categoryId: Id,
    payer: z.object({ memberId: Id.nullable(), accountId: Id.nullable().optional() }),
    split: RecurrenceSplitSchema.optional(),
  }),
  z.object({ type: z.literal("INCOME"), categoryId: Id, accountId: Id }),
  z.object({ type: z.literal("TRANSFER"), sourceAccountId: Id, destinationAccountId: Id }),
  z.object({
    type: z.literal("FUND_CONTRIBUTION"),
    fundAccountId: Id,
    memberId: Id.optional(),
    sourceAccountId: Id.nullable().optional(),
  }),
]);

/** HU-E4-11: `amount` is what AUTO records each time and what CONFIRM suggests; without `endDate` it never ends. */
export const DefineRecurrenceBodySchema = z.object({
  // Length rules live in the domain (InvalidDescription, 1–200 characters); the cap only bounds payload size.
  description: z.string().max(1000),
  amount: MoneySchema,
  template: TemplateBodySchema,
  schedule: ScheduleInputSchema,
  mode: z.enum(MODES),
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable().optional(),
});
type DefineRecurrenceBody = z.infer<typeof DefineRecurrenceBodySchema>;

const templateOf = (body: DefineRecurrenceBody["template"]): TemplateInput => {
  switch (body.type) {
    case "EXPENSE":
      return {
        type: "EXPENSE",
        categoryId: body.categoryId,
        payer: { memberId: body.payer.memberId, accountId: body.payer.accountId ?? null },
        split: body.split === undefined ? null : splitOf(body.split),
      };
    case "INCOME":
      return { type: "INCOME", categoryId: body.categoryId, accountId: body.accountId };
    case "TRANSFER":
      return { type: "TRANSFER", sourceAccountId: body.sourceAccountId, destinationAccountId: body.destinationAccountId };
    case "FUND_CONTRIBUTION":
      return {
        type: "FUND_CONTRIBUTION",
        fundAccountId: body.fundAccountId,
        memberId: body.memberId,
        sourceAccountId: body.sourceAccountId ?? null,
      };
  }
};

/** A validated body as DefineRecurrence input; fails only for impossible dates and currencies the kernel does not know. */
export const recurrenceFromBody = (
  body: DefineRecurrenceBody,
): Result<Omit<DefineRecurrenceInput, "spaceId" | "userId">> => {
  const amount = moneyFromDto(body.amount);
  if (!amount.ok) return amount;
  const startDate = localDate(body.startDate);
  if (!startDate.ok) return startDate;
  const endDate = body.endDate === undefined || body.endDate === null ? ok(null) : localDate(body.endDate);
  if (!endDate.ok) return endDate;
  return ok({
    description: body.description,
    amount: amount.value,
    template: templateOf(body.template),
    schedule: body.schedule,
    mode: body.mode,
    startDate: startDate.value,
    endDate: endDate.value,
  });
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project unit src/modules/ledger/contracts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (the OpenAPI snapshot is unchanged: nothing is registered yet).

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/contracts/recurrences.contract.ts src/modules/ledger/contracts/recurrences.contract.test.ts
git commit -m "feat(ledger): read a recurrence definition from the wire (Refs #40)"
```

---

### Task 6c: Contracts — recurrences and occurrences in answers

Implements the answer side of HU-E4-11 … HU-E4-13 (issues #40, #42); no route and no OpenAPI change yet.

Decisions:
- The answer flattens the template into the `Transaction` fields a client already knows: `categoryId`, `payerMemberId` (an expense's paying member, null for the fund; a contribution's member), `sourceAccountId` (an expense's paying account or the fund; a transfer's or contribution's source) and `destinationAccountId` (an income's account, a transfer's destination, the contribution's fund).
- A recurrence carries its derived `status`, `pauseReason`, `nextOccurrence` and `lastOccurrence` (ruling P31): the latest date considered with its `status`, `amount`, `transactionId` and skip `reason`, inline (an `Occurrence` component nested in `Recurrence` would make zod-openapi emit an `OccurrenceOutput`, measured; the list of pending occurrences answers the full `Occurrence`).
- The answer's schedule is bounded 1–31 and its split shows percentages with two decimals (`percentOf`).

**Files:**
- Modify: `src/modules/ledger/contracts/recurrences.contract.ts`
- Test: `src/modules/ledger/contracts/recurrences.contract.test.ts`

**Interfaces:**
- Consumes: `Recurrence`, `RecurrenceSplit`, `RecurrenceTemplate` (Task 2a); `Occurrence` (Task 2b); `RecurrenceView`, `recurrenceView` (Task 4); `percentOf` (`src/shared/http/contracts.ts`).
- Produces: `ScheduleSchema`, `OccurrenceSchema`, `occurrenceDto(occurrence, recurrence)`, `RecurrenceSchema`, `recurrenceDto(view: RecurrenceView)`.

- [ ] **Step 1: Write the failing tests**

In `src/modules/ledger/contracts/recurrences.contract.test.ts`:

1. Replace the line `import { DefineRecurrenceBodySchema, recurrenceFromBody } from "./recurrences.contract";` with:

```ts
import type { LocalDate } from "@/shared/kernel";
import { recurrenceView, type Occurrence, type OccurrenceId, type Recurrence, type RecurrenceId } from "../application";
import {
  DefineRecurrenceBodySchema,
  occurrenceDto,
  recurrenceDto,
  recurrenceFromBody,
} from "./recurrences.contract";
```

2. Append to the end of the file:

```ts

describe("recurrences and occurrences in answers (HU-E4-11, HU-E4-13)", () => {
  const at = new Date("2026-12-01T17:00:00Z");
  const rent = (overrides: Partial<Recurrence> = {}): Recurrence => ({
    id: "rec-1" as RecurrenceId,
    spaceId: "space-household",
    description: "Rent",
    amount: 120_000_000n,
    currency: "COP",
    template: { type: "EXPENSE", categoryId: "cat-rent", payer: { memberId: null, accountId: "acc-fund" }, split: null },
    schedule: { kind: "MONTHLY", day: 1 },
    mode: "AUTO",
    startDate: "2026-12-01" as LocalDate,
    endDate: null,
    dueFrom: "2027-01-01" as LocalDate,
    pausedAt: null,
    pauseReason: null,
    endedAt: null,
    createdBy: "u-ana",
    createdAt: at,
    updatedAt: at,
    ...overrides,
  });
  const skipped: Occurrence = {
    id: "occ-1" as OccurrenceId,
    recurrenceId: "rec-1" as RecurrenceId,
    spaceId: "space-household",
    date: "2026-12-01" as LocalDate,
    status: "SKIPPED",
    amount: 120_000_000n,
    transactionId: null,
    reason: "PeriodClosed",
    resolvedBy: null,
    createdAt: at,
    resolvedAt: null,
  };

  it("writes a recurrence with its references, its split as percentages and its last occurrence", () => {
    const split = {
      method: "PERCENT" as const,
      participants: [
        { memberId: "member-ana", basisPoints: 4000 },
        { memberId: "member-juan", basisPoints: 6000 },
      ],
    };
    const recurrence = rent({
      template: { type: "EXPENSE", categoryId: "cat-rent", payer: { memberId: null, accountId: "acc-fund" }, split },
    });
    expect(recurrenceDto(recurrenceView(recurrence, skipped))).toEqual({
      id: "rec-1",
      type: "EXPENSE",
      description: "Rent",
      amount: { amount: "120000000", currency: "COP" },
      mode: "AUTO",
      schedule: { kind: "MONTHLY", day: 1 },
      startDate: "2026-12-01",
      endDate: null,
      status: "ACTIVE",
      pauseReason: null,
      nextOccurrence: "2027-01-01",
      categoryId: "cat-rent",
      payerMemberId: null,
      sourceAccountId: "acc-fund",
      destinationAccountId: null,
      split: {
        method: "PERCENT",
        participants: [
          { memberId: "member-ana", percent: "40.00" },
          { memberId: "member-juan", percent: "60.00" },
        ],
      },
      lastOccurrence: {
        id: "occ-1",
        date: "2026-12-01",
        status: "SKIPPED",
        amount: { amount: "120000000", currency: "COP" },
        transactionId: null,
        reason: "PeriodClosed",
      },
      createdBy: "u-ana",
      createdAt: "2026-12-01T17:00:00.000Z",
    });
  });

  it("writes a contribution's member as its payer and its fund as its destination", () => {
    const contribution = rent({
      template: { type: "FUND_CONTRIBUTION", fundAccountId: "acc-fund", memberId: "member-ana", sourceAccountId: "acc-bank" },
      pausedAt: at,
      pauseReason: "PayerLeft",
    });
    expect(recurrenceDto(recurrenceView(contribution, null))).toMatchObject({
      type: "FUND_CONTRIBUTION",
      status: "PAUSED",
      pauseReason: "PayerLeft",
      nextOccurrence: null,
      categoryId: null,
      payerMemberId: "member-ana",
      sourceAccountId: "acc-bank",
      destinationAccountId: "acc-fund",
      split: null,
      lastOccurrence: null,
    });
  });

  it("writes an occurrence with its recurrence's description, type and category", () => {
    expect(occurrenceDto(skipped, rent())).toEqual({
      id: "occ-1",
      recurrenceId: "rec-1",
      type: "EXPENSE",
      description: "Rent",
      date: "2026-12-01",
      status: "SKIPPED",
      amount: { amount: "120000000", currency: "COP" },
      categoryId: "cat-rent",
      transactionId: null,
      reason: "PeriodClosed",
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/contracts/recurrences.contract.test.ts`
Expected: FAIL — `recurrenceDto` and `occurrenceDto` are not exported by `./recurrences.contract`.

- [ ] **Step 3: Implement**

In `src/modules/ledger/contracts/recurrences.contract.ts`:

1. Replace the line `import { basisPointsOf, moneyFromDto, MoneySchema, PercentSchema } from "@/shared/http/contracts";` with:

```ts
import { basisPointsOf, moneyFromDto, MoneySchema, PercentSchema, percentOf } from "@/shared/http/contracts";
```

2. Replace the line `import type { DefineRecurrenceInput, RecurrenceSplit, TemplateInput } from "../application";` with:

```ts
import type {
  DefineRecurrenceInput,
  Occurrence,
  Recurrence,
  RecurrenceSplit,
  RecurrenceTemplate,
  RecurrenceView,
  TemplateInput,
} from "../application";
```

3. Append to the end of the file:

```ts

const TYPES = ["EXPENSE", "INCOME", "TRANSFER", "FUND_CONTRIBUTION"] as const;
const OCCURRENCE_STATUSES = ["RECORDED", "PENDING", "SKIPPED"] as const;

/** Spec 5.2: a recurrence's schedule follows the PeriodPolicy anchor rules (HU-E1-03). */
export const ScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MONTHLY"), day: z.number().int().min(1).max(31) }),
  z.object({
    kind: z.literal("SEMI_MONTHLY"),
    day1: z.number().int().min(1).max(31),
    day2: z.number().int().min(1).max(31),
  }),
]);

const splitDto = (split: RecurrenceSplit): RecurrenceSplitDto => {
  switch (split.method) {
    case "EQUAL":
      return { method: "EQUAL", participants: split.participants.map((p) => ({ memberId: p.memberId })) };
    case "PERCENT":
      return {
        method: "PERCENT",
        participants: split.participants.map((p) => ({ memberId: p.memberId, percent: percentOf(p.basisPoints) })),
      };
    case "SHARES":
      return {
        method: "SHARES",
        participants: split.participants.map((p) => ({ memberId: p.memberId, units: p.units })),
      };
  }
};

/** HU-E4-12, HU-E4-13: one date of a recurrence and what became of it (ruling P31). */
export const OccurrenceSchema = z.object({
  id: z.string(),
  recurrenceId: z.string(),
  type: z.enum(TYPES),
  description: z.string(),
  date: z.iso.date(),
  status: z.enum(OCCURRENCE_STATUSES),
  /** RECORDED: the amount recorded; PENDING: the suggested estimate; SKIPPED: what it would have recorded. */
  amount: MoneySchema,
  categoryId: z.string().nullable(),
  /** The transaction recorded for it; null unless RECORDED. */
  transactionId: z.string().nullable(),
  /** SKIPPED only: PeriodClosed, PayerLeft, CreatorLeft or the refusing code; null when a member skipped it. */
  reason: z.string().nullable(),
});

/**
 * HU-E4-11: a recurrence. Its template's references follow the Transaction fields: an expense's paying member (null:
 * the fund) and paying account, an income's account, a transfer's two accounts, a contribution's member, source and fund.
 */
export const RecurrenceSchema = z.object({
  id: z.string(),
  type: z.enum(TYPES),
  description: z.string(),
  amount: MoneySchema,
  mode: z.enum(MODES),
  schedule: ScheduleSchema,
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable(),
  status: z.enum(["ACTIVE", "PAUSED", "ENDED"]),
  /** PAUSED only: null when a member paused it, else PayerLeft, CreatorLeft or the code that refused an occurrence. */
  pauseReason: z.string().nullable(),
  /** The next date it will record; null while paused or once ended. */
  nextOccurrence: z.iso.date().nullable(),
  categoryId: z.string().nullable(),
  payerMemberId: z.string().nullable(),
  sourceAccountId: z.string().nullable(),
  destinationAccountId: z.string().nullable(),
  /** An expense's split; null is the default split of each occurrence (ruling P23). */
  split: RecurrenceSplitSchema.nullable(),
  /** The latest date it considered: the transaction recorded for it, or why it was skipped (ruling P31). */
  lastOccurrence: z
    .object({
      id: z.string(),
      date: z.iso.date(),
      status: z.enum(OCCURRENCE_STATUSES),
      amount: MoneySchema,
      transactionId: z.string().nullable(),
      reason: z.string().nullable(),
    })
    .nullable(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
});

const references = (template: RecurrenceTemplate) => {
  switch (template.type) {
    case "EXPENSE":
      return {
        categoryId: template.categoryId,
        payerMemberId: template.payer.memberId,
        sourceAccountId: template.payer.accountId,
        destinationAccountId: null,
        split: template.split === null ? null : splitDto(template.split),
      };
    case "INCOME":
      return {
        categoryId: template.categoryId,
        payerMemberId: null,
        sourceAccountId: null,
        destinationAccountId: template.accountId,
        split: null,
      };
    case "TRANSFER":
      return {
        categoryId: null,
        payerMemberId: null,
        sourceAccountId: template.sourceAccountId,
        destinationAccountId: template.destinationAccountId,
        split: null,
      };
    case "FUND_CONTRIBUTION":
      return {
        categoryId: null,
        payerMemberId: template.memberId,
        sourceAccountId: template.sourceAccountId,
        destinationAccountId: template.fundAccountId,
        split: null,
      };
  }
};

export const occurrenceDto = (occurrence: Occurrence, recurrence: Recurrence): z.infer<typeof OccurrenceSchema> => ({
  id: occurrence.id,
  recurrenceId: occurrence.recurrenceId,
  type: recurrence.template.type,
  description: recurrence.description,
  date: occurrence.date,
  status: occurrence.status,
  amount: { amount: occurrence.amount.toString(), currency: recurrence.currency },
  categoryId: references(recurrence.template).categoryId,
  transactionId: occurrence.transactionId,
  reason: occurrence.reason,
});

export const recurrenceDto = (view: RecurrenceView): z.infer<typeof RecurrenceSchema> => {
  const { recurrence, lastOccurrence: last } = view;
  return {
    id: recurrence.id,
    type: recurrence.template.type,
    description: recurrence.description,
    amount: { amount: recurrence.amount.toString(), currency: recurrence.currency },
    mode: recurrence.mode,
    schedule: recurrence.schedule,
    startDate: recurrence.startDate,
    endDate: recurrence.endDate,
    status: view.status,
    pauseReason: recurrence.pauseReason,
    nextOccurrence: view.nextOccurrence,
    ...references(recurrence.template),
    lastOccurrence:
      last === null
        ? null
        : {
            id: last.id,
            date: last.date,
            status: last.status,
            amount: { amount: last.amount.toString(), currency: recurrence.currency },
            transactionId: last.transactionId,
            reason: last.reason,
          },
    createdBy: recurrence.createdBy,
    createdAt: recurrence.createdAt.toISOString(),
  };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/ledger/contracts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0 (the snapshot is unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/contracts/recurrences.contract.ts src/modules/ledger/contracts/recurrences.contract.test.ts
git commit -m "feat(ledger): write recurrences and occurrences in answers (Refs #40, Refs #42)"
```

---

### Task 6d: OpenAPI — the `Recurrence` component

Registers the answer schema of Task 6c as a response-only component (issue #40). Measured on a scratch document with zod-openapi 6.0.2: `Recurrence` renders about 347 lines and creates no `…Output` variant once `Recurrence.lastOccurrence` is inline (Task 6c); registering it on its own keeps the later operations small, since each answers with a `$ref`.

Decisions:
- zod-openapi 6.0.2 emits a manually registered component that no operation references yet at the end of `components.schemas`, rendered in the output context (preflight B6). That is how a response renders anyway, so `Recurrence` is registered before its first operation and Task 6e2's POST only moves it to its final place. A request component is registered in the commit of its first operation instead (`RecurrenceDefinition`, Task 6e2), and `Occurrence` with its first operations (Task 11a), at its final place, so it never moves (preflight N1).

**Files:**
- Modify: `src/composition/openapi.ts`, `src/composition/openapi.test.ts`, `openapi/openapi.snapshot.json`

**Interfaces:**
- Consumes: `RecurrenceSchema` (Task 6c).
- Produces: component `Recurrence`.

- [ ] **Step 1: Write the failing test**

In `src/composition/openapi.test.ts`, insert before the line `  it("names the operations that were added, removed or changed", () => {`:

```ts
  it("registers the recurrence components of M3-C, and no Output variant of them", () => {
    const names = Object.keys(doc.components.schemas);
    expect(names).toEqual(expect.arrayContaining(["Recurrence"]));
    expect(names.filter((name) => /^(Recurrence|Occurrence|RecurrenceDefinition)Output$/.test(name))).toEqual([]);
  });

```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/composition/openapi.test.ts`
Expected: FAIL — `Recurrence` is not among the component names.

- [ ] **Step 3: Implement**

In `src/composition/openapi.ts`:

1. Insert after the line `} from "@/modules/ledger/contracts/ledger.contract";`:

```ts
import { RecurrenceSchema } from "@/modules/ledger/contracts/recurrences.contract";
```

2. Insert after the line `        BudgetPlan: BudgetPlanSchema,` (the last registered component):

```ts
        Recurrence: RecurrenceSchema,
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds only `components.schemas.Recurrence` (about 347 lines, after every existing component); no operation changes and no `…Output` component appears.
Then run: `pnpm exec vitest run --project unit src/composition`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/composition/openapi.ts src/composition/openapi.test.ts openapi/openapi.snapshot.json
git commit -m "feat(ledger): register recurrences in the OpenAPI document (Refs #40)"
```

---

### Task 6e: HTTP — define a recurrence

Implements HU-E4-11's definition over HTTP (issue #40): `POST /api/v1/spaces/{spaceId}/recurrences`; its OpenAPI operation and request component follow in Task 6e2 (preflight B6), so this task changes no OpenAPI file. Pins Review Focus 3 (D9 for Juan's account), Review Focus 5 (another household's fund, an archived space) and spec 7's idempotency for a POST that creates a recurrence.

Decisions:
- `201` with the recurrence and `Location: /api/v1/spaces/{spaceId}/recurrences/{id}`; `Idempotency-Key` replays the first answer and the same key with another body answers `409 IdempotencyKeyConflict` (spec 7).
- The composition root builds `RecurrenceDeps` from the ledger's own deps and one `DrizzleRecurrenceRepository` for both ports.
- A recurrence is due from its definition day at the earliest (ruling P24), so a test that defines one must not depend on the day the suite runs. M3-B's `ContainerOptions.clock` (the system clock otherwise) lets every acceptance file of M3-C start its app on a fixed clock, 2026-10-28 at noon in Bogotá: Rent from 2026-12-01 is then due from 2026-12-01 whenever the suite runs. Tasks 9b and 11a start theirs on a `MovableClock` set to that day, which a test moves past a period before it closes that period's plan (M3-B's P17 as amended).

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/recurrences/route.ts`, `tests/support/recurrences.ts`, `tests/acceptance/recurrences.test.ts`
- Modify: `src/modules/ledger/contracts/recurrences.contract.ts`, `src/composition/container.ts`, `docs/backlog/E4-ledger.md`

**Interfaces:**
- Consumes: `createDefineRecurrence`, `DefineRecurrence`, `RecurrenceDeps` (Tasks 3c, 4); `DefineRecurrenceBodySchema`, `recurrenceFromBody`, `recurrenceDto` (Tasks 6a, 6c); `DrizzleRecurrenceRepository` (Tasks 3b, 3c); M3-B's `ContainerOptions.clock`; `household`, `newAccount`, `categoryWithKey`, `joinHousehold`, `cop`, `MoneyDto` (`tests/support/ledger.ts`); `call`, `problemOf`, `startTestApp` (`tests/support/app.ts`).
- Produces: `recurrenceHeaders(view)`; `Container.ledger.defineRecurrence: DefineRecurrence`; in `tests/support/recurrences.ts`: `DEFINITION_DAY_CLOCK` (a `FixedClock` at 2026-10-28T17:00:00Z), `interface OccurrenceDto`, `interface RecurrenceDto`, `interface HouseholdWithFund extends Household { fund; rent; utilities }`, `householdWithFund()`, `recurrencesPath(spaceId, rest?)`, `rentBody(h, overrides?)`, `postRecurrence(user, spaceId, body, headers?)`, `defined(...)`, `archiveHousehold(h)`.

- [ ] **Step 1: Write the failing tests**

`tests/support/recurrences.ts`:

```ts
import { POST as archiveSpaceRoute } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { POST as defineRecurrenceRoute } from "@/app/api/v1/spaces/[spaceId]/recurrences/route";
import { FixedClock } from "@/shared/kernel";
import { call, type TestUser } from "./app";
import { categoryWithKey, cop, household, newAccount, type Household, type MoneyDto } from "./ledger";

/**
 * The clock of the M3-C acceptance files that close no plan: recurrences are defined on 2026-10-28 in Bogotá
 * whatever day the suite runs, so their first dates never move (ruling P24).
 */
export const DEFINITION_DAY_CLOCK = new FixedClock(new Date("2026-10-28T17:00:00Z"));

export interface OccurrenceDto {
  id: string;
  recurrenceId: string;
  type: string;
  description: string;
  date: string;
  status: string;
  amount: MoneyDto;
  categoryId: string | null;
  transactionId: string | null;
  reason: string | null;
}
export interface RecurrenceDto {
  id: string;
  type: string;
  description: string;
  amount: MoneyDto;
  mode: string;
  schedule: Record<string, unknown>;
  startDate: string;
  endDate: string | null;
  status: string;
  pauseReason: string | null;
  nextOccurrence: string | null;
  categoryId: string | null;
  payerMemberId: string | null;
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  split: unknown;
  lastOccurrence: {
    id: string;
    date: string;
    status: string;
    amount: MoneyDto;
    transactionId: string | null;
    reason: string | null;
  } | null;
  createdBy: string;
  createdAt: string;
}

export const recurrencesPath = (spaceId: string, rest = "") => `/api/v1/spaces/${spaceId}/recurrences${rest}`;

/** HU-E4-11 Background: Household with its "Household Fund" and its seeded Rent and Utilities categories. */
export interface HouseholdWithFund extends Household {
  readonly fund: string;
  readonly rent: string;
  readonly utilities: string;
}

export const householdWithFund = async (): Promise<HouseholdWithFund> => {
  const h = await household();
  return {
    ...h,
    fund: await newAccount(h.ana, "Household Fund", 0, "SHARED_FUND"),
    rent: await categoryWithKey(h.ana, "rent"),
    utilities: await categoryWithKey(h.ana, "utilities"),
  };
};

/** HU-E4-11: "Rent", 1,200,000 COP in Rent paid from the Household Fund, MONTHLY(1), AUTO, from 2026-12-01. */
export const rentBody = (h: HouseholdWithFund, overrides: Record<string, unknown> = {}) => ({
  description: "Rent",
  amount: cop(1_200_000),
  template: { type: "EXPENSE", categoryId: h.rent, payer: { memberId: null, accountId: h.fund } },
  schedule: { kind: "MONTHLY", day: 1 },
  mode: "AUTO",
  startDate: "2026-12-01",
  ...overrides,
});

/** HU-E4-11: `user` defines a recurrence of `spaceId`. */
export const postRecurrence = (
  user: TestUser,
  spaceId: string,
  body: unknown,
  headers: Record<string, string> = {},
) => call(defineRecurrenceRoute, "POST", recurrencesPath(spaceId), { user, params: { spaceId }, body, headers });

/** Defines the recurrence; throws unless 201. */
export const defined = async (...args: Parameters<typeof postRecurrence>): Promise<RecurrenceDto> => {
  const response = await postRecurrence(...args);
  if (response.status !== 201) throw new Error(`recurrence definition failed with status ${response.status}`);
  return (await response.json()) as RecurrenceDto;
};

/** HU-E1-09: Ana archives the household. */
export const archiveHousehold = async (h: Household): Promise<void> => {
  const response = await call(archiveSpaceRoute, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
    user: h.ana,
    params: { spaceId: h.spaceId },
  });
  if (response.status !== 204) throw new Error(`archiving failed with status ${response.status}`);
};
```

`tests/acceptance/recurrences.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setContainerForTests, type Container } from "@/composition/container";
import { problemOf, startTestApp } from "../support/app";
import { cop, joinHousehold } from "../support/ledger";
import {
  archiveHousehold,
  DEFINITION_DAY_CLOCK,
  defined,
  householdWithFund,
  postRecurrence,
  rentBody,
  type RecurrenceDto,
} from "../support/recurrences";

let app: Container;
beforeAll(() => {
  app = startTestApp({ clock: DEFINITION_DAY_CLOCK });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

describe("defining a recurrence (HU-E4-11)", () => {
  it("defines the monthly Rent paid from the shared fund: 201, ACTIVE, next on 2026-12-01", async () => {
    const h = await householdWithFund();
    const response = await postRecurrence(h.ana, h.spaceId, rentBody(h));
    expect(response.status).toBe(201);
    const rent = (await response.json()) as RecurrenceDto;
    expect(response.headers.get("location")).toBe(`/api/v1/spaces/${h.spaceId}/recurrences/${rent.id}`);
    expect(rent).toMatchObject({
      type: "EXPENSE",
      description: "Rent",
      amount: cop(1_200_000),
      mode: "AUTO",
      schedule: { kind: "MONTHLY", day: 1 },
      startDate: "2026-12-01",
      endDate: null,
      status: "ACTIVE",
      pauseReason: null,
      nextOccurrence: "2026-12-01",
      categoryId: h.rent,
      payerMemberId: null,
      sourceAccountId: h.fund,
      destinationAccountId: null,
      split: null,
      lastOccurrence: null,
      createdBy: h.ana.userId,
    });
  });

  it("refuses VIEWERs: Sofi answers 403 InsufficientRole", async () => {
    const h = await householdWithFund();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    expect(await problemOf(await postRecurrence(sofi, h.spaceId, rentBody(h)))).toEqual([403, "InsufficientRole"]);
  });

  it("lets only Juan define Internet paid from his Davivienda account: Ana answers 422 AccountNotOwned (D9)", async () => {
    const h = await householdWithFund();
    const internet = {
      description: "Internet",
      amount: cop(120_000),
      template: {
        type: "EXPENSE",
        categoryId: h.utilities,
        payer: { memberId: h.juan.memberId, accountId: h.juan.account },
      },
      schedule: { kind: "MONTHLY", day: 5 },
      mode: "AUTO",
      startDate: "2026-12-05",
    };
    expect(await problemOf(await postRecurrence(h.ana, h.spaceId, internet))).toEqual([422, "AccountNotOwned"]);
    expect((await postRecurrence(h.juan, h.spaceId, internet)).status).toBe(201);
  });

  it("replays an Idempotency-Key with the first answer (spec 7)", async () => {
    const h = await householdWithFund();
    const key = { "idempotency-key": "rent-from-december" };
    const first = await defined(h.ana, h.spaceId, rentBody(h), key);
    const replay = await postRecurrence(h.ana, h.spaceId, rentBody(h), key);
    expect([replay.status, ((await replay.json()) as RecurrenceDto).id]).toEqual([201, first.id]);
    expect(
      await problemOf(await postRecurrence(h.ana, h.spaceId, rentBody(h, { description: "Other" }), key)),
    ).toEqual([409, "IdempotencyKeyConflict"]);
  });

  it("answers 404 for another household's fund, 422 for an EXACT split and 422 InvalidPeriodPolicy for SEMI_MONTHLY(16, 1)", async () => {
    const h = await householdWithFund();
    const other = await householdWithFund();
    const paidFrom = (accountId: string, split?: unknown) =>
      rentBody(h, {
        template: {
          type: "EXPENSE",
          categoryId: h.rent,
          payer: { memberId: null, accountId },
          ...(split === undefined ? {} : { split }),
        },
      });
    expect([
      await problemOf(await postRecurrence(h.ana, h.spaceId, paidFrom(other.fund))),
      await problemOf(await postRecurrence(h.ana, h.spaceId, paidFrom(h.fund, { method: "EXACT", participants: [] }))),
      await problemOf(
        await postRecurrence(h.ana, h.spaceId, rentBody(h, { schedule: { kind: "SEMI_MONTHLY", day1: 16, day2: 1 } })),
      ),
    ]).toEqual([
      [404, "AccountNotFound"],
      [422, "ValidationFailed"],
      [422, "InvalidPeriodPolicy"],
    ]);
  });

  it("refuses definitions in an archived space with 409 SpaceArchived (HU-E1-09)", async () => {
    const h = await householdWithFund();
    await archiveHousehold(h);
    expect(await problemOf(await postRecurrence(h.ana, h.spaceId, rentBody(h)))).toEqual([409, "SpaceArchived"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/recurrences.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/recurrences/route"`.

- [ ] **Step 3: Implement**

In `src/modules/ledger/contracts/recurrences.contract.ts`, append to the end of the file:

```ts

/** The Location header of a new recurrence (HU-E4-11). */
export const recurrenceHeaders = (view: RecurrenceView): [string, string][] => [
  ["location", `/api/v1/spaces/${view.recurrence.spaceId}/recurrences/${view.recurrence.id}`],
];
```

`src/app/api/v1/spaces/[spaceId]/recurrences/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  DefineRecurrenceBodySchema,
  recurrenceDto,
  recurrenceFromBody,
  recurrenceHeaders,
} from "@/modules/ledger/contracts/recurrences.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: DefineRecurrenceBodySchema,
  before: withIdempotency,
  handler: async ({ user, params, body }) => {
    const fields = recurrenceFromBody(body);
    if (!fields.ok) return fields;
    const result = await getContainer().ledger.defineRecurrence({
      spaceId: params.spaceId!,
      userId: user!.id,
      ...fields.value,
    });
    return result.ok
      ? ok({ status: 201, body: recurrenceDto(result.value), headers: recurrenceHeaders(result.value) })
      : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert after the line `import { DrizzleTransactionRepository } from "@/modules/ledger/infrastructure/drizzle-transaction-repository";`:

```ts
import { DrizzleRecurrenceRepository } from "@/modules/ledger/infrastructure/drizzle-recurrence-repository";
```

2. Insert before the line `  type DeleteTransaction,`:

```ts
  createDefineRecurrence,
  type DefineRecurrence,
  type RecurrenceDeps,
```

3. Insert after the line `    readonly listAudit: ListAudit;`:

```ts
    readonly defineRecurrence: DefineRecurrence;
```

4. Insert after the line `  const recordExpense = createRecordExpense(ledgerDeps);`:

```ts
  // HU-E4-11 … HU-E4-13: recurrences live in the ledger and record through its own use cases (ruling P21).
  const recurrenceRepository = new DrizzleRecurrenceRepository(tm);
  const recurrenceDeps: RecurrenceDeps = {
    ...ledgerDeps,
    recurrences: recurrenceRepository,
    occurrences: recurrenceRepository,
  };
```

5. Insert after the line `      listAudit: createListAudit(ledgerDeps),`:

```ts
      defineRecurrence: createDefineRecurrence(recurrenceDeps),
```

In `docs/backlog/E4-ledger.md`, insert after the line ``- If the paying member leaves the space, the recurrence is paused with reason `PayerLeft`.``:

```markdown
- `POST …/recurrences` honours `Idempotency-Key` and takes `description`, `amount` (what an AUTO recurrence records each time, what a CONFIRM one suggests), `template` (its `type` and references: an expense's `categoryId`, `payer` and optional `split`; an income's `categoryId` and `accountId`; a transfer's two accounts; a contribution's `fundAccountId`, optional `memberId` and `sourceAccountId`), `schedule`, `mode`, `startDate` and an optional `endDate`. The template is checked as recording an occurrence would check it, for the definer, on whose behalf every AUTO occurrence is recorded (M3-C ruling P21): only the payer defines a recurrence paid from their own account (D9), and incomes and transfers use accounts of the space, so they recur in a personal space. No `split` means the default split of each occurrence (spec 5.3: `BY_ALLOCATION` with the ACTIVE plan of its period, else `EQUAL`); `EXACT` is not offered (ruling P23). A recurrence that starts before the day it is defined is due from that day on (ruling P24). New code: `InvalidRecurrence` (422: an end date before the start, a category or split its type does not have).
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/recurrences.test.ts && pnpm exec vitest run --project unit src/composition/openapi.test.ts`
Expected: PASS; `openapi/openapi.snapshot.json` is unchanged (Task 6e2 documents the POST).

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/v1/spaces/[spaceId]/recurrences/route.ts" src/modules/ledger/contracts/recurrences.contract.ts src/composition/container.ts docs/backlog/E4-ledger.md tests/support/recurrences.ts tests/acceptance/recurrences.test.ts
git commit -m "feat(ledger): define a recurring transaction over HTTP (Refs #40)"
```

---

### Task 6e2: OpenAPI — the definition request and `POST …/recurrences`

Documents Task 6e's `POST /api/v1/spaces/{spaceId}/recurrences` (issue #40) and registers its body as the request-only `RecurrenceDefinition` component in the same commit, the commit of its first operation (preflight B6). Measured on a scratch document with zod-openapi 6.0.2: the body renders 336 lines, and the operation about 105 with its body a `$ref` (438 inline).

Decisions:
- A request component is registered in the commit of its first operation: zod-openapi 6.0.2 emits a manually registered component that no operation references last, in the output context, so `RecurrenceDefinition` registered on its own would render as a response (`$ref` to `MoneyOutput`, `additionalProperties: false`) and be re-rendered as a request by its first operation. Here it renders once, as a request (`$ref` to `Money`, no `additionalProperties`), and creates no `…Output` variant; `openapi.test.ts` pins that.
- The POST is the first operation that references `Recurrence`, so it moves that component from the end of `components.schemas` (Task 6d) to its final place, across `MoneyOutput` and `CategoryOutput`.
- **The one accepted oversized commit (controller ruling on preflight B6):** a request component plus its first operation is about 441 generated snapshot lines, so this commit cannot be split. Measured with `git diff --cached --numstat --minimal` it is 611 changed lines (snapshot +497/−58); default Myers counts 927, because it misaligns the repeated JSON lines. Sorting the snapshot's component keys would remove this class of move (Self-Review follow-up 14).

**Files:**
- Modify: `src/modules/ledger/contracts/recurrences.contract.ts`, `src/composition/openapi.ts`, `src/composition/openapi.test.ts`, `openapi/openapi.snapshot.json`

**Interfaces:**
- Consumes: `DefineRecurrenceBodySchema` (Task 6a); `RecurrenceSchema` (Task 6c), registered as `Recurrence` in Task 6d; `jsonContent`, `problems`, `securedByUser` (`src/shared/http/contracts.ts`); the route of Task 6e.
- Produces: `recurrencesPaths`, `recurrenceResponse`, `TEMPLATE_404`, `TEMPLATE_409`, `TEMPLATE_422`, `SpacePath`, `IdempotencyHeader` (module constants of `recurrences.contract.ts`, `recurrencesPaths` exported); component `RecurrenceDefinition`; operation `defineRecurrence`.

- [ ] **Step 1: Write the failing test**

In `src/composition/openapi.test.ts`, replace the line `    expect(names).toEqual(expect.arrayContaining(["Recurrence"]));` with:

```ts
    expect(names).toEqual(expect.arrayContaining(["RecurrenceDefinition", "Recurrence"]));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/composition/openapi.test.ts`
Expected: FAIL — `RecurrenceDefinition` is not among the component names.

- [ ] **Step 3: Implement**

In `src/modules/ledger/contracts/recurrences.contract.ts`:

1. Replace the line `import { z } from "zod";` with:

```ts
import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
```

2. Replace the line `import { basisPointsOf, moneyFromDto, MoneySchema, PercentSchema, percentOf } from "@/shared/http/contracts";` with:

```ts
import {
  basisPointsOf,
  jsonContent,
  moneyFromDto,
  MoneySchema,
  PercentSchema,
  percentOf,
  problems,
  securedByUser,
} from "@/shared/http/contracts";
```

3. Append to the end of the file (after Task 6e's `recurrenceHeaders`):

```ts

const SpacePath = z.object({ spaceId: z.string() });
const IdempotencyHeader = z.object({ "idempotency-key": z.string().max(255).optional() });

const recurrenceResponse = (description: string) => ({ description, content: jsonContent(RecurrenceSchema) });
/** What checking a template answers (ruling P21): the codes of the record use cases. */
const TEMPLATE_404 = "CategoryNotFound, AccountNotFound";
const TEMPLATE_409 = "AccountArchived, CategoryArchived, GuestHasNoAccounts, SameAccountTransfer";
const TEMPLATE_422 =
  "AccountNotOwned, AccountNotInSpace, AccountRequired, InvalidFundAccount, NotASpaceMember, InvalidSplit, ParticipantsRequired";

export const recurrencesPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces/{spaceId}/recurrences": {
    post: {
      operationId: "defineRecurrence",
      summary: "Define a recurring expense, income, transfer or fund contribution on a MONTHLY or SEMI_MONTHLY schedule",
      ...securedByUser,
      requestParams: { path: SpacePath, header: IdempotencyHeader },
      requestBody: { content: jsonContent(DefineRecurrenceBodySchema) },
      responses: {
        "201": recurrenceResponse("The recurrence; Location names it"),
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": `SpaceNotFound, ${TEMPLATE_404}`,
          "409": `${TEMPLATE_409}, SpaceArchived, IdempotencyKeyConflict`,
          "422": `ValidationFailed, InvalidAmount, InvalidDate, InvalidDescription, InvalidPeriodPolicy, InvalidRecurrence, CurrencyMismatch, UnknownCurrency, InvalidIdempotencyKey, ${TEMPLATE_422}`,
        }),
      },
    },
  },
};
```

In `src/composition/openapi.ts`:

1. Replace the line `import { RecurrenceSchema } from "@/modules/ledger/contracts/recurrences.contract";` (Task 6d) with:

```ts
import {
  DefineRecurrenceBodySchema,
  RecurrenceSchema,
  recurrencesPaths,
} from "@/modules/ledger/contracts/recurrences.contract";
```

2. Insert after the line `        RecordedExpense: RecordedExpenseSchema,`:

```ts
        RecurrenceDefinition: DefineRecurrenceBodySchema,
```

3. Insert after the line `      ...ledgerPaths,`:

```ts
      ...recurrencesPaths,
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff --minimal openapi/openapi.snapshot.json`: it adds `components.schemas.RecurrenceDefinition` (about 336 lines, rendered as a request: `$ref` to `Money`, no `additionalProperties`; the base fields, `template` as a `oneOf` of four and the split as a `oneOf` of three) and `POST /api/v1/spaces/{spaceId}/recurrences` (about 105 lines: its body a `$ref` to `RecurrenceDefinition`, its `201` a `$ref` to `Recurrence`), and moves `components.schemas.Recurrence` to its final place (+497/−58 in all); no other component or operation changes and no `…Output` component appears.
Then run: `pnpm exec vitest run --project unit src/composition && pnpm exec vitest run --project acceptance tests/acceptance/recurrences.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

The controller measures this staged candidate with `git diff --cached --numstat --minimal` (about 611 lines: the accepted exception above).

```bash
git add src/modules/ledger/contracts/recurrences.contract.ts src/composition/openapi.ts src/composition/openapi.test.ts openapi/openapi.snapshot.json
git commit -m "feat(ledger): document defining a recurrence in the OpenAPI document (Refs #40)"
```

---

### Task 6f: HTTP — list, read and preview recurrences

Implements HU-E4-11's reads (issue #40): `GET …/recurrences`, `GET …/recurrences/{recurrenceId}` and `GET …/recurrences/{recurrenceId}/occurrences?count=<n>`, with the scenarios "Monthly schedules clamp to short months" and "Semi-monthly schedule" over HTTP. Pins Review Focus 5 (another space's and malformed ids, an archived space's reads).

Decisions:
- The three reads are `space.read`, so a VIEWER and an archived space read them (HU-E1-09); the list is the HU-E9-09 "recurring list" and is not paginated (ruling P28).
- `count` is 1–24, 3 by default; anything else is `422 ValidationFailed` (as `limit` of `PaginationQuerySchema`).

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/route.ts`, `src/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/occurrences/route.ts`
- Modify: `src/app/api/v1/spaces/[spaceId]/recurrences/route.ts`, `src/modules/ledger/contracts/recurrences.contract.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E4-ledger.md`, `tests/support/recurrences.ts`
- Test: `tests/acceptance/recurrences.test.ts`

**Interfaces:**
- Consumes: `createListRecurrences`, `createGetRecurrence`, `createListUpcomingOccurrences` and their types (Task 5); `recurrenceDto`, `RecurrenceSchema`, `recurrencesPaths` (Tasks 6c, 6e2); `recurrenceDeps` (container, Task 6e); the Task 6e helpers.
- Produces: `RecurrenceListSchema`, `UpcomingOccurrencesQuerySchema`, `UpcomingOccurrencesSchema`; `Container.ledger.listRecurrences`, `.getRecurrence`, `.listUpcomingOccurrences`; in `tests/support/recurrences.ts`: `listRecurrences(user, spaceId)`, `getRecurrence(user, spaceId, recurrenceId)`, `recurrenceOf(...)`, `upcoming(user, spaceId, recurrenceId, count?)`.

- [ ] **Step 1: Write the failing tests**

In `tests/support/recurrences.ts`:

1. Replace the line `import { POST as defineRecurrenceRoute } from "@/app/api/v1/spaces/[spaceId]/recurrences/route";` with:

```ts
import {
  POST as defineRecurrenceRoute,
  GET as listRecurrencesRoute,
} from "@/app/api/v1/spaces/[spaceId]/recurrences/route";
import { GET as getRecurrenceRoute } from "@/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/route";
import { GET as upcomingRoute } from "@/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/occurrences/route";
```

2. Append to the end of the file:

```ts

/** HU-E4-11: the space's recurrences as `user` reads them. */
export const listRecurrences = (user: TestUser, spaceId: string) =>
  call(listRecurrencesRoute, "GET", recurrencesPath(spaceId), { user, params: { spaceId } });

export const getRecurrence = (user: TestUser, spaceId: string, recurrenceId: string) =>
  call(getRecurrenceRoute, "GET", recurrencesPath(spaceId, `/${recurrenceId}`), {
    user,
    params: { spaceId, recurrenceId },
  });

/** The recurrence as `user` reads it; throws unless 200. */
export const recurrenceOf = async (user: TestUser, spaceId: string, recurrenceId: string): Promise<RecurrenceDto> => {
  const response = await getRecurrence(user, spaceId, recurrenceId);
  if (response.status !== 200) throw new Error(`recurrence read failed with status ${response.status}`);
  return (await response.json()) as RecurrenceDto;
};

/** HU-E4-11: its next `count` dates (`GET …/occurrences?count=<count>`; the default when absent). */
export const upcoming = (user: TestUser, spaceId: string, recurrenceId: string, count?: string) =>
  call(
    upcomingRoute,
    "GET",
    recurrencesPath(spaceId, `/${recurrenceId}/occurrences${count === undefined ? "" : `?count=${count}`}`),
    { user, params: { spaceId, recurrenceId } },
  );
```

In `tests/acceptance/recurrences.test.ts`:

1. Replace the block from the line `import {` that starts the `../support/recurrences` import through the line `} from "../support/recurrences";` with:

```ts
import {
  archiveHousehold,
  DEFINITION_DAY_CLOCK,
  defined,
  getRecurrence,
  householdWithFund,
  listRecurrences,
  postRecurrence,
  recurrenceOf,
  rentBody,
  upcoming,
  type RecurrenceDto,
} from "../support/recurrences";
```

2. Append to the end of the file:

```ts

describe("reading recurrences (HU-E4-11)", () => {
  it("previews MONTHLY(31) from 2027-01-01 as 2027-01-31, 2027-02-28 and 2027-03-31", async () => {
    const h = await householdWithFund();
    const clamped = await defined(
      h.ana,
      h.spaceId,
      rentBody(h, { schedule: { kind: "MONTHLY", day: 31 }, startDate: "2027-01-01" }),
    );
    const response = await upcoming(h.ana, h.spaceId, clamped.id, "3");
    expect([response.status, await response.json()]).toEqual([
      200,
      { dates: ["2027-01-31", "2027-02-28", "2027-03-31"] },
    ]);
  });

  it("lists Cleaning's December 2026 occurrences as 2026-12-01 and 2026-12-16 (SEMI_MONTHLY(1, 16))", async () => {
    const h = await householdWithFund();
    const cleaning = await defined(
      h.ana,
      h.spaceId,
      rentBody(h, { description: "Cleaning", amount: cop(80_000), schedule: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } }),
    );
    expect(await (await upcoming(h.ana, h.spaceId, cleaning.id, "2")).json()).toEqual({
      dates: ["2026-12-01", "2026-12-16"],
    });
    expect(((await (await upcoming(h.ana, h.spaceId, cleaning.id)).json()) as { dates: string[] }).dates).toHaveLength(3);
  });

  it("lists and reads the space's recurrences for every member, Sofi the VIEWER included", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const cleaning = await defined(h.ana, h.spaceId, rentBody(h, { description: "Cleaning", amount: cop(80_000) }));
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    const list = await listRecurrences(sofi, h.spaceId);
    expect([list.status, ((await list.json()) as { items: RecurrenceDto[] }).items.map((r) => r.id)]).toEqual([
      200,
      [rent.id, cleaning.id],
    ]);
    expect(await recurrenceOf(sofi, h.spaceId, rent.id)).toEqual(rent);
  });

  it("answers 404 RecurrenceNotFound for another space's or a malformed id, and 422 for a count out of range", async () => {
    const h = await householdWithFund();
    const other = await householdWithFund();
    const theirs = await defined(other.ana, other.spaceId, rentBody(other));
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    expect([
      await problemOf(await getRecurrence(h.ana, h.spaceId, theirs.id)),
      await problemOf(await getRecurrence(h.ana, h.spaceId, "not-a-uuid")),
      await problemOf(await upcoming(h.ana, h.spaceId, "not-a-uuid")),
      await problemOf(await upcoming(h.ana, h.spaceId, rent.id, "0")),
      await problemOf(await upcoming(h.ana, h.spaceId, rent.id, "25")),
    ]).toEqual([
      [404, "RecurrenceNotFound"],
      [404, "RecurrenceNotFound"],
      [404, "RecurrenceNotFound"],
      [422, "ValidationFailed"],
      [422, "ValidationFailed"],
    ]);
  });

  it("still reads the recurrences of an archived space (HU-E1-09)", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    await archiveHousehold(h);
    expect([
      (await listRecurrences(h.ana, h.spaceId)).status,
      (await getRecurrence(h.ana, h.spaceId, rent.id)).status,
      (await upcoming(h.ana, h.spaceId, rent.id)).status,
    ]).toEqual([200, 200, 200]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/recurrences.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/route"`.

- [ ] **Step 3: Implement**

In `src/modules/ledger/contracts/recurrences.contract.ts`:

1. Insert before the line `/** The Location header of a new recurrence (HU-E4-11). */`:

```ts
/** HU-E4-11: the space's recurrences in the order they were defined (not paginated, ruling P28). */
export const RecurrenceListSchema = z.object({ items: z.array(RecurrenceSchema) });

/** HU-E4-11: how many upcoming dates to list, 1–24 (3 by default). */
export const UpcomingOccurrencesQuerySchema = z.object({
  count: z.coerce.number().int().min(1).max(24).default(3),
});
export const UpcomingOccurrencesSchema = z.object({ dates: z.array(z.iso.date()) });

```

2. Insert after the line `const IdempotencyHeader = z.object({ "idempotency-key": z.string().max(255).optional() });`:

```ts
const RecurrencePath = SpacePath.extend({ recurrenceId: z.string() });
```

3. Replace the line `  "/api/v1/spaces/{spaceId}/recurrences": {` with:

```ts
  "/api/v1/spaces/{spaceId}/recurrences": {
    get: {
      operationId: "listRecurrences",
      summary: "The space's recurrences in the order they were defined, with their status and next and last occurrences",
      ...securedByUser,
      requestParams: { path: SpacePath },
      responses: {
        "200": { description: "Recurrences", content: jsonContent(RecurrenceListSchema) },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound" }),
      },
    },
```

4. Insert before the last line of the file (`};`):

```ts
  "/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}": {
    get: {
      operationId: "getRecurrence",
      summary: "One recurrence with its status and its next and last occurrences",
      ...securedByUser,
      requestParams: { path: RecurrencePath },
      responses: {
        "200": recurrenceResponse("The recurrence"),
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound, RecurrenceNotFound" }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}/occurrences": {
    get: {
      operationId: "listUpcomingOccurrences",
      summary: "The next dates a recurrence will record (none while paused or ended)",
      ...securedByUser,
      requestParams: { path: RecurrencePath, query: UpcomingOccurrencesQuerySchema },
      responses: {
        "200": { description: "Upcoming dates, earliest first", content: jsonContent(UpcomingOccurrencesSchema) },
        ...problems({
          "401": "Unauthenticated",
          "404": "SpaceNotFound, RecurrenceNotFound",
          "422": "ValidationFailed",
        }),
      },
    },
  },
```

Append to `src/app/api/v1/spaces/[spaceId]/recurrences/route.ts`:

```ts

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().ledger.listRecurrences({ spaceId: params.spaceId!, userId: user!.id });
    return result.ok ? ok({ status: 200, body: { items: result.value.map((view) => recurrenceDto(view)) } }) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { recurrenceDto } from "@/modules/ledger/contracts/recurrences.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().ledger.getRecurrence({
      spaceId: params.spaceId!,
      userId: user!.id,
      recurrenceId: params.recurrenceId!,
    });
    return result.ok ? ok({ status: 200, body: recurrenceDto(result.value) }) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/occurrences/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { UpcomingOccurrencesQuerySchema } from "@/modules/ledger/contracts/recurrences.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: UpcomingOccurrencesQuerySchema,
  handler: async ({ user, params, query }) => {
    const result = await getContainer().ledger.listUpcomingOccurrences({
      spaceId: params.spaceId!,
      userId: user!.id,
      recurrenceId: params.recurrenceId!,
      count: query.count,
    });
    return result.ok ? ok({ status: 200, body: { dates: result.value } }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert before the line `  type DeleteTransaction,`:

```ts
  createGetRecurrence,
  createListRecurrences,
  createListUpcomingOccurrences,
  type GetRecurrence,
  type ListRecurrences,
  type ListUpcomingOccurrences,
```

2. Insert after the line `    readonly defineRecurrence: DefineRecurrence;`:

```ts
    readonly listRecurrences: ListRecurrences;
    readonly getRecurrence: GetRecurrence;
    readonly listUpcomingOccurrences: ListUpcomingOccurrences;
```

3. Insert after the line `      defineRecurrence: createDefineRecurrence(recurrenceDeps),`:

```ts
      listRecurrences: createListRecurrences(recurrenceDeps),
      getRecurrence: createGetRecurrence(recurrenceDeps),
      listUpcomingOccurrences: createListUpcomingOccurrences(recurrenceDeps),
```

In `docs/backlog/E4-ledger.md`, insert after the line that starts with ``- `POST …/recurrences` honours `Idempotency-Key` `` (added in Task 6e):

```markdown
- Reads are `space.read`, archived spaces included: `GET …/recurrences` (in the order they were defined), `GET …/recurrences/{recurrenceId}` and `GET …/recurrences/{recurrenceId}/occurrences?count=<1–24, default 3>` (no dates while paused or ended). A recurrence shows its derived `status` (`ACTIVE`, `PAUSED`, or `ENDED` once ended or past its last date), its `nextOccurrence` and its `lastOccurrence` (the latest date it considered, with the recorded `transactionId` or the skip `reason`, ruling P31). None of these lists is paginated (ruling P28). New code: `RecurrenceNotFound` (404).
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds `GET /api/v1/spaces/{spaceId}/recurrences`, `GET …/recurrences/{recurrenceId}` and `GET …/recurrences/{recurrenceId}/occurrences` (about 230 lines together), references `Recurrence`, and changes no component and no other operation.
Then run: `pnpm exec vitest run --project acceptance tests/acceptance/recurrences.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/v1/spaces/[spaceId]/recurrences/route.ts" "src/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/route.ts" "src/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/occurrences/route.ts" src/modules/ledger/contracts/recurrences.contract.ts src/composition/container.ts openapi/openapi.snapshot.json docs/backlog/E4-ledger.md tests/support/recurrences.ts tests/acceptance/recurrences.test.ts
git commit -m "feat(ledger): list, read and preview recurrences over HTTP (Refs #40)"
```

---

### Task 7a: HTTP — edit a recurrence

Implements HU-E4-11's `PATCH …/recurrences/{recurrenceId}` (issue #40) with the scenario "Editing applies to future occurrences only" (the edit itself; the occurrences around it are recorded in Tasks 8b and 9b). Pins Review Focus 3 (an ADMIN changing an amount debited from Ana's account; a MEMBER editing someone else's recurrence) and Review Focus 5.

Decisions:
- The body names only what changes; `split: null` returns to the default split of each occurrence, `endDate: null` removes the end. No `If-Match` (ruling P27): the write serializes on the recurrence's row lock.
- The answer is `200` with the recurrence as changed; an `EXACT` split is a `422 ValidationFailed`, as on definition.

**Files:**
- Modify: `src/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/route.ts`, `src/modules/ledger/contracts/recurrences.contract.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`, `tests/support/recurrences.ts`
- Test: `tests/acceptance/recurrences.test.ts`

**Interfaces:**
- Consumes: `createUpdateRecurrence`, `UpdateRecurrence`, `RecurrenceEdit` (Task 5); `RecurrenceSplitSchema`, `ScheduleInputSchema`, `splitOf`, `recurrenceDto`, `recurrenceResponse`, `RecurrencePath`, `TEMPLATE_404`, `TEMPLATE_409`, `TEMPLATE_422` (Tasks 6a–6f); `joinHousehold` (`tests/support/ledger.ts`).
- Produces: `UpdateRecurrenceBodySchema`, `recurrenceEditFromBody(body): Result<RecurrenceEdit>`; `Container.ledger.updateRecurrence: UpdateRecurrence`; `patchRecurrence(user, spaceId, recurrenceId, body)` in `tests/support/recurrences.ts`.

- [ ] **Step 1: Write the failing tests**

In `tests/support/recurrences.ts`:

1. Replace the line `import { GET as getRecurrenceRoute } from "@/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/route";` with:

```ts
import {
  GET as getRecurrenceRoute,
  PATCH as patchRecurrenceRoute,
} from "@/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/route";
```

2. Append to the end of the file:

```ts

/** HU-E4-11: `user` changes the recurrence; `body` names only what changes. */
export const patchRecurrence = (user: TestUser, spaceId: string, recurrenceId: string, body: unknown) =>
  call(patchRecurrenceRoute, "PATCH", recurrencesPath(spaceId, `/${recurrenceId}`), {
    user,
    params: { spaceId, recurrenceId },
    body,
  });
```

In `tests/acceptance/recurrences.test.ts`:

1. Replace the line `  listRecurrences,` (inside the `../support/recurrences` import) with:

```ts
  listRecurrences,
  patchRecurrence,
```

2. Append to the end of the file:

```ts

describe("editing a recurrence (HU-E4-11)", () => {
  it("changes the Rent to 1,300,000 COP and gives it an end, for the occurrences not recorded yet", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const response = await patchRecurrence(h.ana, h.spaceId, rent.id, {
      amount: cop(1_300_000),
      endDate: "2027-06-30",
    });
    expect(response.status).toBe(200);
    expect(await recurrenceOf(h.ana, h.spaceId, rent.id)).toMatchObject({
      amount: cop(1_300_000),
      endDate: "2027-06-30",
      status: "ACTIVE",
      nextOccurrence: "2026-12-01",
    });
  });

  it("splits by share units, then returns to the default split with split null (P23)", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const shares = {
      method: "SHARES",
      participants: [
        { memberId: h.ana.memberId, units: 1 },
        { memberId: h.juan.memberId, units: 2 },
      ],
    };
    const split = (await (await patchRecurrence(h.ana, h.spaceId, rent.id, { split: shares })).json()) as RecurrenceDto;
    expect(split.split).toEqual(shares);
    const reset = (await (await patchRecurrence(h.ana, h.spaceId, rent.id, { split: null })).json()) as RecurrenceDto;
    expect(reset.split).toBeNull();
  });

  it("lets an ADMIN change the description of Ana's Gym but not the amount debited from her account (D9)", async () => {
    const h = await householdWithFund();
    const luis = await joinHousehold(h, "Luis", "ADMIN");
    const gym = await defined(h.ana, h.spaceId, {
      description: "Gym",
      amount: cop(90_000),
      template: { type: "EXPENSE", categoryId: h.utilities, payer: { memberId: h.ana.memberId, accountId: h.ana.account } },
      schedule: { kind: "MONTHLY", day: 3 },
      mode: "AUTO",
      startDate: "2026-12-03",
    });
    expect([
      await problemOf(await patchRecurrence(luis, h.spaceId, gym.id, { amount: cop(95_000) })),
      (await patchRecurrence(luis, h.spaceId, gym.id, { description: "Gym, renewed" })).status,
      (await patchRecurrence(h.ana, h.spaceId, gym.id, { amount: cop(95_000) })).status,
    ]).toEqual([[422, "AccountNotOwned"], 200, 200]);
  });

  it("refuses a MEMBER who did not define it (403), an end before the start (422) and another space's recurrence (404)", async () => {
    const h = await householdWithFund();
    const other = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const theirs = await defined(other.ana, other.spaceId, rentBody(other));
    expect([
      await problemOf(await patchRecurrence(h.juan, h.spaceId, rent.id, { description: "Juan's rent" })),
      await problemOf(await patchRecurrence(h.ana, h.spaceId, rent.id, { endDate: "2026-11-30" })),
      await problemOf(await patchRecurrence(h.ana, h.spaceId, theirs.id, { description: "Theirs" })),
      await problemOf(
        await patchRecurrence(h.ana, h.spaceId, rent.id, { split: { method: "EXACT", participants: [] } }),
      ),
    ]).toEqual([
      [403, "InsufficientRole"],
      [422, "InvalidRecurrence"],
      [404, "RecurrenceNotFound"],
      [422, "ValidationFailed"],
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/recurrences.test.ts`
Expected: FAIL — `PATCH` is not exported by `@/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/route` (`patchRecurrenceRoute is not a function`).

- [ ] **Step 3: Implement**

In `src/modules/ledger/contracts/recurrences.contract.ts`:

1. Insert after the line `  DefineRecurrenceInput,` (inside the `../application` type import):

```ts
  RecurrenceEdit,
```

2. Insert before the line `/** The Location header of a new recurrence (HU-E4-11). */`:

```ts
/** HU-E4-11: what a PATCH may change (ruling P22); the type, payer and accounts stay as defined. */
export const UpdateRecurrenceBodySchema = z.object({
  description: z.string().max(1000).optional(),
  amount: MoneySchema.optional(),
  categoryId: Id.optional(),
  /** Null returns to the default split of each occurrence (ruling P23). */
  split: RecurrenceSplitSchema.nullable().optional(),
  schedule: ScheduleInputSchema.optional(),
  mode: z.enum(MODES).optional(),
  /** Null removes the end date. */
  endDate: z.iso.date().nullable().optional(),
});

/** A validated PATCH body as UpdateRecurrence changes; fails only for impossible dates and unknown currencies. */
export const recurrenceEditFromBody = (
  body: z.infer<typeof UpdateRecurrenceBodySchema>,
): Result<RecurrenceEdit> => {
  const amount = body.amount === undefined ? ok(undefined) : moneyFromDto(body.amount);
  if (!amount.ok) return amount;
  const endDate = body.endDate === undefined || body.endDate === null ? ok(body.endDate) : localDate(body.endDate);
  if (!endDate.ok) return endDate;
  return ok({
    description: body.description,
    amount: amount.value,
    categoryId: body.categoryId,
    split: body.split === undefined ? undefined : body.split === null ? null : splitOf(body.split),
    schedule: body.schedule,
    mode: body.mode,
    endDate: endDate.value,
  });
};

```

3. Replace the line `  "/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}": {` with:

```ts
  "/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}": {
    patch: {
      operationId: "updateRecurrence",
      summary:
        "Change a recurrence's description, amount, category, split, schedule, mode or end date for its occurrences not recorded yet",
      ...securedByUser,
      requestParams: { path: RecurrencePath },
      requestBody: { content: jsonContent(UpdateRecurrenceBodySchema) },
      responses: {
        "200": recurrenceResponse("The recurrence as changed"),
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": `SpaceNotFound, RecurrenceNotFound, ${TEMPLATE_404}`,
          "409": `RecurrenceEnded, ${TEMPLATE_409}, SpaceArchived`,
          "422": `ValidationFailed, InvalidAmount, InvalidDate, InvalidDescription, InvalidPeriodPolicy, InvalidRecurrence, CurrencyMismatch, UnknownCurrency, ${TEMPLATE_422}`,
        }),
      },
    },
```

In `src/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/route.ts`:

1. Replace the line `import { recurrenceDto } from "@/modules/ledger/contracts/recurrences.contract";` with:

```ts
import {
  recurrenceDto,
  recurrenceEditFromBody,
  UpdateRecurrenceBodySchema,
} from "@/modules/ledger/contracts/recurrences.contract";
```

2. Append to the end of the file:

```ts

export const PATCH = defineRoute({
  auth: "required",
  body: UpdateRecurrenceBodySchema,
  handler: async ({ user, params, body }) => {
    const changes = recurrenceEditFromBody(body);
    if (!changes.ok) return changes;
    const result = await getContainer().ledger.updateRecurrence({
      spaceId: params.spaceId!,
      userId: user!.id,
      recurrenceId: params.recurrenceId!,
      changes: changes.value,
    });
    return result.ok ? ok({ status: 200, body: recurrenceDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert before the line `  type DeleteTransaction,`:

```ts
  createUpdateRecurrence,
  type UpdateRecurrence,
```

2. Insert after the line `    readonly listUpcomingOccurrences: ListUpcomingOccurrences;`:

```ts
    readonly updateRecurrence: UpdateRecurrence;
```

3. Insert after the line `      listUpcomingOccurrences: createListUpcomingOccurrences(recurrenceDeps),`:

```ts
      updateRecurrence: createUpdateRecurrence(recurrenceDeps),
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds `PATCH /api/v1/spaces/{spaceId}/recurrences/{recurrenceId}` (about 300 lines: its body inline, with the split and schedule unions) and changes no component and no other operation.
Then run: `pnpm exec vitest run --project acceptance tests/acceptance/recurrences.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/route.ts" src/modules/ledger/contracts/recurrences.contract.ts src/composition/container.ts openapi/openapi.snapshot.json tests/support/recurrences.ts tests/acceptance/recurrences.test.ts
git commit -m "feat(ledger): edit a recurrence over HTTP for its occurrences not recorded yet (Refs #40)"
```

---

### Task 7b: HTTP — pause, resume and end a recurrence

Implements HU-E4-11's `POST …/recurrences/{recurrenceId}/pause`, `/resume` and `/end` (issue #40). Pins Review Focus 3 (a MEMBER managing someone else's recurrence) and Review Focus 5 (an archived space refuses every move).

Decisions:
- The three moves have no body and answer `200` with the recurrence after the move; a move from the wrong status answers `409 InvalidRecurrenceTransition`, explicit in `problem.ts` like `InvalidPlanTransition` (the recurrence's state, not the request, refuses it; ruling P27). A PATCH of an ended recurrence answers `409 RecurrenceEnded`.
- `problem.test.ts` pins the statuses of every new recurrence code.

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/pause/route.ts`, `…/resume/route.ts`, `…/end/route.ts`
- Modify: `src/modules/ledger/contracts/recurrences.contract.ts`, `src/composition/container.ts`, `src/shared/http/problem.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E4-ledger.md`, `tests/support/recurrences.ts`
- Test: `tests/acceptance/recurrences.test.ts`, `src/shared/http/problem.test.ts`

**Interfaces:**
- Consumes: `createPauseRecurrence`, `createResumeRecurrence`, `createEndRecurrence` and their types (Task 5); `recurrenceDto`, `recurrenceResponse`, `RecurrencePath`, `TEMPLATE_404`, `TEMPLATE_409`, `TEMPLATE_422` (Tasks 6a–6f); the Task 6e–7a helpers.
- Produces: `Container.ledger.pauseRecurrence`, `.resumeRecurrence`, `.endRecurrence`; `pauseRecurrence(user, spaceId, recurrenceId)`, `resumeRecurrence(…)`, `endRecurrence(…)` in `tests/support/recurrences.ts`; `InvalidRecurrenceTransition` → 409.

- [ ] **Step 1: Write the failing tests**

In `src/shared/http/problem.test.ts`, insert after the line `    ["InvalidPlanTransition", 409],`:

```ts
    ["InvalidRecurrenceTransition", 409],
    ["RecurrenceNotFound", 404],
    ["RecurrenceEnded", 409],
    ["InvalidRecurrence", 422],
```

In `tests/support/recurrences.ts`:

1. Insert after the line `import { GET as upcomingRoute } from "@/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/occurrences/route";`:

```ts
import { POST as endRoute } from "@/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/end/route";
import { POST as pauseRoute } from "@/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/pause/route";
import { POST as resumeRoute } from "@/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/resume/route";
```

2. Append to the end of the file:

```ts

const move = (route: typeof pauseRoute, name: string) => (user: TestUser, spaceId: string, recurrenceId: string) =>
  call(route, "POST", recurrencesPath(spaceId, `/${recurrenceId}/${name}`), { user, params: { spaceId, recurrenceId } });

/** HU-E4-11: `user` pauses, resumes or ends the recurrence. */
export const pauseRecurrence = move(pauseRoute, "pause");
export const resumeRecurrence = move(resumeRoute, "resume");
export const endRecurrence = move(endRoute, "end");
```

In `tests/acceptance/recurrences.test.ts`:

1. Replace the line `  defined,` (inside the `../support/recurrences` import) with:

```ts
  defined,
  endRecurrence,
```

2. Replace the line `  patchRecurrence,` (inside the same import) with:

```ts
  patchRecurrence,
  pauseRecurrence,
```

3. Replace the line `  rentBody,` (inside the same import) with:

```ts
  rentBody,
  resumeRecurrence,
```

4. Append to the end of the file:

```ts

describe("pausing, resuming and ending a recurrence (HU-E4-11)", () => {
  const read = async (response: Response) => [response.status, ((await response.json()) as RecurrenceDto).status];

  it("pauses Rent with no next occurrence, then resumes it: next on 2026-12-01", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    expect(await read(await pauseRecurrence(h.ana, h.spaceId, rent.id))).toEqual([200, "PAUSED"]);
    expect(await recurrenceOf(h.ana, h.spaceId, rent.id)).toMatchObject({ pauseReason: null, nextOccurrence: null });
    expect(await read(await resumeRecurrence(h.ana, h.spaceId, rent.id))).toEqual([200, "ACTIVE"]);
    expect((await recurrenceOf(h.ana, h.spaceId, rent.id)).nextOccurrence).toBe("2026-12-01");
  });

  it("answers 409 InvalidRecurrenceTransition to pausing a paused recurrence or resuming an active one", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    expect(await problemOf(await resumeRecurrence(h.ana, h.spaceId, rent.id))).toEqual([
      409,
      "InvalidRecurrenceTransition",
    ]);
    await pauseRecurrence(h.ana, h.spaceId, rent.id);
    expect(await problemOf(await pauseRecurrence(h.ana, h.spaceId, rent.id))).toEqual([
      409,
      "InvalidRecurrenceTransition",
    ]);
  });

  it("ends Rent logically: ENDED and still read, refusing edits (409 RecurrenceEnded) and further moves", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    expect(await read(await endRecurrence(h.ana, h.spaceId, rent.id))).toEqual([200, "ENDED"]);
    expect([
      (await recurrenceOf(h.ana, h.spaceId, rent.id)).nextOccurrence,
      await problemOf(await patchRecurrence(h.ana, h.spaceId, rent.id, { description: "Rent" })),
      await problemOf(await endRecurrence(h.ana, h.spaceId, rent.id)),
    ]).toEqual([null, [409, "RecurrenceEnded"], [409, "InvalidRecurrenceTransition"]]);
  });

  it("lets Juan, a MEMBER, manage only the recurrences he defined (P30)", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const his = await defined(h.juan, h.spaceId, rentBody(h, { description: "Juan's share of rent" }));
    expect([
      await problemOf(await pauseRecurrence(h.juan, h.spaceId, rent.id)),
      (await pauseRecurrence(h.juan, h.spaceId, his.id)).status,
      (await endRecurrence(h.ana, h.spaceId, his.id)).status,
    ]).toEqual([[403, "InsufficientRole"], 200, 200]);
  });

  it("refuses every move in an archived space with 409 SpaceArchived (HU-E1-09)", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    await archiveHousehold(h);
    expect([
      await problemOf(await pauseRecurrence(h.ana, h.spaceId, rent.id)),
      await problemOf(await resumeRecurrence(h.ana, h.spaceId, rent.id)),
      await problemOf(await endRecurrence(h.ana, h.spaceId, rent.id)),
      await problemOf(await patchRecurrence(h.ana, h.spaceId, rent.id, { description: "Rent" })),
    ]).toEqual([
      [409, "SpaceArchived"],
      [409, "SpaceArchived"],
      [409, "SpaceArchived"],
      [409, "SpaceArchived"],
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/shared/http/problem.test.ts && pnpm exec vitest run --project acceptance tests/acceptance/recurrences.test.ts`
Expected: FAIL — `InvalidRecurrenceTransition` maps to 422 (it starts with `Invalid`), and `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/end/route"`.

- [ ] **Step 3: Implement**

In `src/shared/http/problem.ts`, insert after the line `  ["InvalidPlanTransition", 409],`:

```ts
  // HU-E4-11: the recurrence's state, not the request, refuses the move (ruling P27).
  ["InvalidRecurrenceTransition", 409],
```

In `src/modules/ledger/contracts/recurrences.contract.ts`:

1. Insert before the line `export const recurrencesPaths: ZodOpenApiPathsObject = {`:

```ts
/** HU-E4-11: a move of a recurrence; no body, and the answer is the recurrence after it. */
const recurrenceMove = (operationId: string, summary: string, errors: Record<string, string> = {}) => ({
  post: {
    operationId,
    summary,
    ...securedByUser,
    requestParams: { path: RecurrencePath },
    responses: {
      "200": recurrenceResponse("The recurrence after the move"),
      ...problems({
        "401": "Unauthenticated",
        "403": "InsufficientRole",
        "404": "SpaceNotFound, RecurrenceNotFound",
        "409": "InvalidRecurrenceTransition, SpaceArchived",
        ...errors,
      }),
    },
  },
});

```

2. Insert before the last line of the file (`};`):

```ts
  "/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}/pause": recurrenceMove(
    "pauseRecurrence",
    "Pause an ACTIVE recurrence: nothing is recorded until it resumes",
  ),
  "/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}/resume": recurrenceMove(
    "resumeRecurrence",
    "Resume a PAUSED recurrence from today, never back-filling the days it was paused",
    {
      "404": `SpaceNotFound, RecurrenceNotFound, ${TEMPLATE_404}`,
      "409": `InvalidRecurrenceTransition, ${TEMPLATE_409}, SpaceArchived`,
      "422": TEMPLATE_422,
    },
  ),
  "/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}/end": recurrenceMove(
    "endRecurrence",
    "End a recurrence: it and its occurrences stay, and nothing more is recorded",
  ),
```

`src/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/pause/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { recurrenceDto } from "@/modules/ledger/contracts/recurrences.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().ledger.pauseRecurrence({
      spaceId: params.spaceId!,
      userId: user!.id,
      recurrenceId: params.recurrenceId!,
    });
    return result.ok ? ok({ status: 200, body: recurrenceDto(result.value) }) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/resume/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { recurrenceDto } from "@/modules/ledger/contracts/recurrences.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().ledger.resumeRecurrence({
      spaceId: params.spaceId!,
      userId: user!.id,
      recurrenceId: params.recurrenceId!,
    });
    return result.ok ? ok({ status: 200, body: recurrenceDto(result.value) }) : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/end/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { recurrenceDto } from "@/modules/ledger/contracts/recurrences.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().ledger.endRecurrence({
      spaceId: params.spaceId!,
      userId: user!.id,
      recurrenceId: params.recurrenceId!,
    });
    return result.ok ? ok({ status: 200, body: recurrenceDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert before the line `  type DeleteTransaction,`:

```ts
  createEndRecurrence,
  createPauseRecurrence,
  createResumeRecurrence,
  type EndRecurrence,
  type PauseRecurrence,
  type ResumeRecurrence,
```

2. Insert after the line `    readonly updateRecurrence: UpdateRecurrence;`:

```ts
    readonly pauseRecurrence: PauseRecurrence;
    readonly resumeRecurrence: ResumeRecurrence;
    readonly endRecurrence: EndRecurrence;
```

3. Insert after the line `      updateRecurrence: createUpdateRecurrence(recurrenceDeps),`:

```ts
      pauseRecurrence: createPauseRecurrence(recurrenceDeps),
      resumeRecurrence: createResumeRecurrence(recurrenceDeps),
      endRecurrence: createEndRecurrence(recurrenceDeps),
```

In `docs/backlog/E4-ledger.md`, insert after the line that starts with ``- Reads are `space.read`, archived spaces included: `GET …/recurrences` `` (added in Task 6f):

```markdown
- `PATCH …/recurrences/{recurrenceId}` changes `description`, `amount`, `categoryId` (expenses and incomes), `split` (expenses; `null` returns to the default split), `schedule`, `mode` and `endDate` (`null` removes it) for every occurrence not recorded yet; recorded ones never change. The type, payer and accounts stay as defined (ruling P22): end the recurrence and define another. Its creator, or an OWNER or ADMIN, manages it (`canModify`, as for transactions, ruling P30), and an amount debited from a member's own account is changed by that member only (`AccountNotOwned`, D9). `POST …/pause`, `…/resume` and `…/end` have no body and answer the recurrence; resuming moves its next date to today at the earliest, never back-filling the paused days, and checks its template again (a payer or creator who left answers `NotASpaceMember`, ruling P26). Ending is logical (D8). No `If-Match`: writes of one recurrence take turns on its row lock (ruling P27). New codes: `InvalidRecurrenceTransition` (409, explicit) and `RecurrenceEnded` (409).
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds `POST …/recurrences/{recurrenceId}/pause`, `…/resume` and `…/end` (about 90 lines each) and changes no component and no other operation.
Then run: `pnpm exec vitest run --project unit src/shared/http && pnpm exec vitest run --project acceptance tests/acceptance/recurrences.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/pause/route.ts" "src/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/resume/route.ts" "src/app/api/v1/spaces/[spaceId]/recurrences/[recurrenceId]/end/route.ts" src/modules/ledger/contracts/recurrences.contract.ts src/composition/container.ts src/shared/http/problem.ts src/shared/http/problem.test.ts openapi/openapi.snapshot.json docs/backlog/E4-ledger.md tests/support/recurrences.ts tests/acceptance/recurrences.test.ts
git commit -m "feat(ledger): pause, resume and end recurrences over HTTP (Refs #40)"
```

---

### Task 8a: Ledger — record an occurrence through the ledger's own use cases

Implements the "Recorded through `RecordExpense` (or the matching use case per type), so all ledger invariants and default-split rules apply; shares are snapshots" note of HU-E4-12 (issue #41), shared by the scheduler (Task 8b) and confirmations (Task 10). Pins Review Focus 3 (D9 for someone else's account) and Review Focus 4 (the default split, an explicit split, the fund's warning).

Decisions:
- **Who records (ruling P21):** `recordOccurrence` calls the use case a member would call (`RecordExpense`, `RecordIncome`, `RecordTransfer`, `RecordFundContribution`) as the given user, so the matrix (`money.record`), archived spaces, D9, the closed-period guard (bound by M3-B Task 5b) and the default split of the occurrence's date (`BY_ALLOCATION` with the ACTIVE plan of its period, bound by M3-B Task 15b) apply exactly as for a member's own record, and its answer is the ledger's. An expense has the template's one payer paying the whole amount and the template's split, or none (the default split, ruling P23).
- `occurrenceRecorders(deps)` builds the four use cases from the ledger's deps, for the composition root and the tests alike.

**Files:**
- Create: `src/modules/ledger/application/record-occurrence.ts`
- Modify: `src/modules/ledger/application/index.ts`
- Test: create `src/modules/ledger/application/record-occurrence.test.ts`

**Interfaces:**
- Consumes: `Recurrence`, `RecurrenceTemplate`, `defineRecurrence` (Task 2a); `createRecordExpense`, `createRecordIncome`, `createRecordTransfer`, `createRecordFundContribution` and their types, `LedgerWarning` (M1–M2); `recurrenceWorld` (Task 4); `ACCOUNTS`, `CATEGORIES` (`tests/support/in-memory-ledger.ts`).
- Produces: `interface OccurrenceRecorders { expense: RecordExpense; income: RecordIncome; transfer: RecordTransfer; fundContribution: RecordFundContribution }`; `occurrenceRecorders(deps: LedgerDeps): OccurrenceRecorders`; `interface RecordedOccurrence { transaction: Transaction; warnings: readonly LedgerWarning[] }`; `recordOccurrence(recorders, recurrence, occurrence: { userId; date; amount: Money }): Promise<Result<RecordedOccurrence>>`.

- [ ] **Step 1: Write the failing test**

`src/modules/ledger/application/record-occurrence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES } from "../../../../tests/support/in-memory-ledger";
import { recurrenceWorld } from "../../../../tests/support/in-memory-recurrences";
import { defineRecurrence, type Recurrence, type RecurrenceId, type RecurrenceTemplate } from "../domain/recurrence";
import type { Expense, Transaction } from "../domain/transaction";
import { occurrenceRecorders, recordOccurrence } from "./record-occurrence";

const cop = (pesos: bigint) => money(pesos * 100n);
const day = (iso: string) => iso as LocalDate;
/** A recurrence of `spaceId` with `template`, defined by Ana; here only its space, description and template matter. */
const recurrenceOf = (template: RecurrenceTemplate, spaceId = "space-household"): Recurrence =>
  unwrap(
    defineRecurrence({
      id: "rec-1" as RecurrenceId,
      spaceId,
      description: "Monthly",
      amount: 100n,
      currency: "COP",
      template,
      schedule: { kind: "MONTHLY", day: 1 },
      mode: "AUTO",
      startDate: day("2026-12-01"),
      endDate: null,
      createdBy: "u-ana",
      now: new Date("2026-10-28T17:00:00Z"),
      today: day("2026-10-28"),
    }),
  );
const fromTheFund: RecurrenceTemplate = {
  type: "EXPENSE",
  categoryId: CATEGORIES.household.id,
  payer: { memberId: null, accountId: ACCOUNTS.householdFund.id },
  split: null,
};
const sharesOf = (tx: Transaction) => (tx as Expense).shares.map((s) => [s.memberId, s.amount, s.splitMethod]);
const on = (userId: string, pesos: bigint) => ({ userId, date: day("2026-12-01"), amount: cop(pesos) });

describe("recordOccurrence (HU-E4-12, P21)", () => {
  it("records an expense with the template's one payer paying the whole amount, split by default when it has no split", async () => {
    const { deps, store } = recurrenceWorld();
    const recorded = unwrap(
      await recordOccurrence(occurrenceRecorders(deps), recurrenceOf(fromTheFund), on("u-ana", 1_200_000n)),
    );
    expect(store.rows).toEqual([recorded.transaction]);
    expect(recorded.transaction).toMatchObject({
      type: "EXPENSE",
      spaceId: "space-household",
      description: "Monthly",
      date: "2026-12-01",
      amount: 120_000_000n,
      createdBy: "u-ana",
      payments: [{ memberId: null, accountId: ACCOUNTS.householdFund.id, amount: 120_000_000n }],
    });
    expect([sharesOf(recorded.transaction).map((share) => share[2]), recorded.warnings]).toEqual([
      ["EQUAL", "EQUAL", "EQUAL", "EQUAL", "EQUAL"],
      [],
    ]);
  });

  it("shares by the template's split, and carries the fund's negative balance as a warning (HU-E4-10)", async () => {
    const { deps } = recurrenceWorld();
    const shared = recurrenceOf({
      ...fromTheFund,
      split: {
        method: "SHARES",
        participants: [
          { memberId: "member-ana", units: 1 },
          { memberId: "member-juan", units: 3 },
        ],
      },
    });
    const recorded = unwrap(await recordOccurrence(occurrenceRecorders(deps), shared, on("u-ana", 2_000_000n)));
    expect(sharesOf(recorded.transaction)).toEqual([
      ["member-ana", 50_000_000n, "SHARES"],
      ["member-juan", 150_000_000n, "SHARES"],
    ]);
    expect(recorded.warnings).toEqual([
      { code: "FundBalanceNegative", accountId: ACCOUNTS.householdFund.id, balance: -50_000_000n },
    ]);
  });

  it("records an income and a transfer of Ana's personal space and her contribution to the fund through their own use cases", async () => {
    const { deps, store } = recurrenceWorld();
    const recorders = occurrenceRecorders(deps);
    const salary = recurrenceOf(
      { type: "INCOME", categoryId: CATEGORIES.salary.id, accountId: ACCOUNTS.bancolombia.id },
      "space-ana",
    );
    const saving = recurrenceOf(
      { type: "TRANSFER", sourceAccountId: ACCOUNTS.bancolombia.id, destinationAccountId: ACCOUNTS.nequi.id },
      "space-ana",
    );
    const contribution = recurrenceOf({
      type: "FUND_CONTRIBUTION",
      fundAccountId: ACCOUNTS.householdFund.id,
      memberId: "member-ana",
      sourceAccountId: ACCOUNTS.bancolombia.id,
    });
    for (const recurrence of [salary, saving, contribution]) {
      unwrap(await recordOccurrence(recorders, recurrence, on("u-ana", 500_000n)));
    }
    expect(store.rows.map((t) => [t.type, t.spaceId, t.amount])).toEqual([
      ["INCOME", "space-ana", 50_000_000n],
      ["TRANSFER", "space-ana", 50_000_000n],
      ["TRANSFER", "space-household", 50_000_000n],
    ]);
    expect(store.rows[2]).toMatchObject({ payerMemberId: "member-ana", destinationAccountId: ACCOUNTS.householdFund.id });
  });

  it("answers what the ledger answers: PeriodClosed in a closed period, AccountNotOwned for someone else's account (D9)", async () => {
    const { deps, store } = recurrenceWorld();
    const closed = occurrenceRecorders({ ...deps, closedPeriods: { isClosed: async () => true } });
    expect(codeOf(await recordOccurrence(closed, recurrenceOf(fromTheFund), on("u-ana", 1_200_000n)))).toBe(
      "PeriodClosed",
    );
    const anas = recurrenceOf({
      type: "EXPENSE",
      categoryId: CATEGORIES.household.id,
      payer: { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id },
      split: null,
    });
    expect(codeOf(await recordOccurrence(occurrenceRecorders(deps), anas, on("u-juan", 205_300n)))).toBe(
      "AccountNotOwned",
    );
    expect(store.rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/record-occurrence.test.ts`
Expected: FAIL — `Failed to resolve import "./record-occurrence"`.

- [ ] **Step 3: Implement**

`src/modules/ledger/application/record-occurrence.ts`:

```ts
import { map, type LocalDate, type Money, type Result } from "@/shared/kernel";
import type { Recurrence } from "../domain/recurrence";
import type { Transaction } from "../domain/transaction";
import type { LedgerDeps } from "./deps";
import { createRecordExpense, type LedgerWarning, type RecordExpense } from "./record-expense";
import { createRecordFundContribution, type RecordFundContribution } from "./record-fund-contribution";
import { createRecordIncome, type RecordIncome } from "./record-income";
import { createRecordTransfer, type RecordTransfer } from "./record-transfer";

/** The ledger's record use cases, through which every occurrence is recorded (ruling P21). */
export interface OccurrenceRecorders {
  readonly expense: RecordExpense;
  readonly income: RecordIncome;
  readonly transfer: RecordTransfer;
  readonly fundContribution: RecordFundContribution;
}

export const occurrenceRecorders = (deps: LedgerDeps): OccurrenceRecorders => ({
  expense: createRecordExpense(deps),
  income: createRecordIncome(deps),
  transfer: createRecordTransfer(deps),
  fundContribution: createRecordFundContribution(deps),
});

/** A recorded occurrence: its transaction and, for an expense paid from the fund, FundBalanceNegative (HU-E4-10). */
export interface RecordedOccurrence {
  readonly transaction: Transaction;
  readonly warnings: readonly LedgerWarning[];
}

/**
 * Ruling P21: an occurrence is recorded by the use case a member would call, as `userId`, so every ledger rule
 * applies: the matrix, archived spaces, D9, closed periods and the default split of its date. An expense has the
 * template's one payer paying the whole amount, and the template's split, or none (the default split, ruling P23).
 */
export const recordOccurrence = async (
  recorders: OccurrenceRecorders,
  recurrence: Recurrence,
  occurrence: { readonly userId: string; readonly date: LocalDate; readonly amount: Money },
): Promise<Result<RecordedOccurrence>> => {
  const base = {
    spaceId: recurrence.spaceId,
    userId: occurrence.userId,
    description: recurrence.description,
    date: occurrence.date,
    amount: occurrence.amount,
  };
  const alone = (transaction: Transaction): RecordedOccurrence => ({ transaction, warnings: [] });
  const template = recurrence.template;
  switch (template.type) {
    case "EXPENSE":
      return map(
        await recorders.expense({
          ...base,
          categoryId: template.categoryId,
          payments: [
            { memberId: template.payer.memberId, accountId: template.payer.accountId, amount: occurrence.amount },
          ],
          split: template.split ?? undefined,
        }),
        (recorded): RecordedOccurrence => ({ transaction: recorded.expense, warnings: recorded.warnings }),
      );
    case "INCOME":
      return map(
        await recorders.income({ ...base, categoryId: template.categoryId, accountId: template.accountId }),
        alone,
      );
    case "TRANSFER":
      return map(
        await recorders.transfer({
          ...base,
          sourceAccountId: template.sourceAccountId,
          destinationAccountId: template.destinationAccountId,
        }),
        alone,
      );
    case "FUND_CONTRIBUTION":
      return map(
        await recorders.fundContribution({
          ...base,
          fundAccountId: template.fundAccountId,
          memberId: template.memberId,
          sourceAccountId: template.sourceAccountId,
        }),
        alone,
      );
  }
};
```

Append to `src/modules/ledger/application/index.ts`:

```ts
export {
  occurrenceRecorders,
  recordOccurrence,
  type OccurrenceRecorders,
  type RecordedOccurrence,
} from "./record-occurrence";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: PASS. Mutation check: temporarily send `split: undefined` whatever the template says — "shares by the template's split" fails with `EQUAL` shares; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/application/record-occurrence.ts src/modules/ledger/application/record-occurrence.test.ts src/modules/ledger/application/index.ts
git commit -m "feat(ledger): record an occurrence through the ledger's own use cases on someone's behalf (Refs #41)"
```

---

### Task 8b: Ledger — MaterializeDueOccurrences records the due occurrences

Implements HU-E4-12 (issue #41) at the use-case level and the scheduler side of HU-E4-13 (issue #42): scenarios "Occurrence is recorded on schedule" (@critical), "Running twice does not duplicate", "Missed runs are caught up", "BY_ALLOCATION is resolved with the plan of each occurrence's period" (@golden), "Closed period skips the occurrence", "Recurrence stops after its end date", HU-E4-13's "A pending occurrence is created instead of an expense", and HU-E4-11's "Editing applies to future occurrences only" and "Pausing skips the paused span without back-filling" with runs around them. Pins Review Focus 1 (a second run records nothing), Review Focus 2 (the end date, the closed period's dates) and Review Focus 4 (`BY_ALLOCATION` per period, an edited amount).

Decisions:
- **How "automatically" runs (ruling P20):** `MaterializeDueOccurrences({ today? })` is the job a scheduler calls (Task 9a); it never runs on a read or a write. It lists every active recurrence of every space and handles each in its own transaction, so one that fails never stops the others and is retried by the next run: `lockForWrite` (read under the lock), the schedule dates from `dueFrom` through `today` (and the end date), at most `CATCH_UP_LIMIT` (24) per run, then `dueFrom` moves past the last date handled. A second run on the same day finds nothing due; a run that waited for another sees the `dueFrom` it committed; and `recurrence_occurrences_date_uq` refuses a second occurrence of a date whatever happens, rolling back its transaction (Task 3c). Nothing is written when no date is due.
- **Who records (ruling P21):** each AUTO occurrence is recorded through `recordOccurrence` (Task 8a) with the recurrence's creator as requester. So the matrix (`money.record`), archived spaces, D9, the closed-period guard (P25, bound by M3-B Task 5b) and the default split of the occurrence's own date (`BY_ALLOCATION` with the ACTIVE plan of its period, bound by M3-B Task 15b) apply exactly as for a member's expense, and shares are snapshots.
- **Refusals:** a refused AUTO date is stored `SKIPPED` with the refusing code; `PeriodClosed` is reported and the recurrence goes on (HU-E4-12 "Closed period skips the occurrence"; Task 9a logs it). Pausing on other refusals arrives in Task 8c.
- **CONFIRM:** a due date becomes a `PENDING` occurrence with the estimate, unless its period is CLOSED (`SKIPPED`, `PeriodClosed`); nothing is recorded and nothing counts as spent (HU-E4-13).
- Edits apply to every occurrence not recorded yet (ruling P24): the run reads the template under the lock, so an edit committed before the run is what the run records.

**Files:**
- Create: `src/modules/ledger/application/materialize-recurrence.ts`, `src/modules/ledger/application/materialize-occurrences.ts`
- Modify: `src/modules/ledger/application/index.ts`, `tests/support/in-memory-recurrences.ts`
- Test: create `src/modules/ledger/application/materialize-occurrences.test.ts`

**Interfaces:**
- Consumes: `scheduleDates` (Task 1); `statusOf` (Task 2a); `pendingOccurrence`, `recordedOccurrence`, `skippedOccurrence` (Task 2b); `RecurrenceDeps`, `ActiveRecurrence` (Tasks 3b, 3c); `occurrenceRecorders`, `recordOccurrence`, `OccurrenceRecorders` (Task 8a); `openPeriod` (`checks.ts`); `LedgerDeps.closedPeriods`, `LedgerDeps.defaultSplits` (M1, M3-B Task 13); `createUpdateRecurrence`, `createPauseRecurrence`, `createResumeRecurrence` (Task 5); `recurrenceWorld`, `rentDefinition` (Task 4).
- Produces:
  - `CATCH_UP_LIMIT = 24`; `interface MaterializeDeps extends RecurrenceDeps { recorders: OccurrenceRecorders }`; `interface RecurrenceRun { occurrences: readonly Occurrence[]; pausedFor: string | null }`; `materializeRecurrence(deps, active, today): Promise<Result<RecurrenceRun>>`
  - `interface MaterializationReport { occurrences; paused: { recurrenceId; spaceId; reason }[]; failures: { recurrenceId; spaceId; error }[] }`; `type MaterializeDueOccurrences = (input: { today?: LocalDate }) => Promise<MaterializationReport>`; `createMaterializeDueOccurrences(deps: MaterializeDeps)`
  - `tests/support/in-memory-recurrences.ts`: `interface BudgetingStandIn { closed?; weights? }`, `materializerWorld(budgeting?)` (`recurrenceWorld()` plus `deps: MaterializeDeps`, `define(definition): Promise<Recurrence>`, `run(today: string): Promise<MaterializationReport>`)

- [ ] **Step 1: Write the failing test**

In `tests/support/in-memory-recurrences.ts`:

1. Replace the block from the line `import type {` through the line `} from "@/modules/ledger/application";` with:

```ts
import {
  createDefineRecurrence,
  createMaterializeDueOccurrences,
  occurrenceRecorders,
  type ActiveRecurrence,
  type DefineRecurrenceInput,
  type MaterializeDeps,
  type Occurrence,
  type OccurrenceRepository,
  type Recurrence,
  type RecurrenceDeps,
  type RecurrenceRepository,
} from "@/modules/ledger/application";
```

2. Append to the end of the file:

```ts

/** What budgeting answers for a due date, as M3-B binds it: whether its period is CLOSED, and its default split. */
export interface BudgetingStandIn {
  readonly closed?: (date: LocalDate) => boolean;
  readonly weights?: (date: LocalDate) => readonly { readonly memberId: string; readonly weight: bigint }[] | null;
}

/**
 * The recurrence world with the ledger's own record use cases as recorders (ruling P21); `closed` and `weights` stand
 * in for budgeting's ClosedPeriodGuard and DefaultSplitSource, per date.
 */
export const materializerWorld = (budgeting: BudgetingStandIn = {}) => {
  const w = recurrenceWorld();
  const ledger: RecurrenceDeps = {
    ...w.deps,
    closedPeriods: { isClosed: async (_spaceId, date) => budgeting.closed?.(date) ?? false },
    defaultSplits: { allocationWeights: async (expense) => budgeting.weights?.(expense.date) ?? null },
  };
  const deps: MaterializeDeps = { ...ledger, recorders: occurrenceRecorders(ledger) };
  const define = async (definition: DefineRecurrenceInput): Promise<Recurrence> =>
    unwrap(await createDefineRecurrence(deps)(definition)).recurrence;
  const run = (today: string) => createMaterializeDueOccurrences(deps)({ today: today as LocalDate });
  return { ...w, deps, define, run };
};
```

`src/modules/ledger/application/materialize-occurrences.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES } from "../../../../tests/support/in-memory-ledger";
import { materializerWorld, rentDefinition } from "../../../../tests/support/in-memory-recurrences";
import { statusOf } from "../domain/recurrence";
import type { Expense, Transaction } from "../domain/transaction";
import { createPauseRecurrence, createResumeRecurrence, createUpdateRecurrence } from "./manage-recurrence";
import { createMaterializeDueOccurrences } from "./materialize-occurrences";
import type { MaterializeDeps } from "./materialize-recurrence";

const cop = (pesos: bigint) => money(pesos * 100n);
const day = (iso: string) => iso as LocalDate;
const sharesOf = (tx: Transaction) => (tx as Expense).shares.map((s) => [s.memberId, s.amount, s.splitMethod]);

/** HU-E4-12 Background: AUTO "Rent", 1,200,000 COP from the Household Fund, MONTHLY(1), 2026-12-01 to 2027-01-31. */
const rentToJanuary = rentDefinition({ endDate: day("2027-01-31") });
/** HU-E4-12: Juan's AUTO "Internet", 120,000 COP from Davivienda in Household's category, MONTHLY(5), no split. */
const internet = rentDefinition({
  userId: "u-juan",
  description: "Internet",
  amount: cop(120_000n),
  template: {
    type: "EXPENSE",
    categoryId: CATEGORIES.household.id,
    payer: { memberId: "member-juan", accountId: ACCOUNTS.davivienda.id },
    split: null,
  },
  schedule: { kind: "MONTHLY", day: 5 },
});

describe("MaterializeDueOccurrences (HU-E4-12)", () => {
  it("records the Rent on 2026-12-01 from the fund, on behalf of Ana, linked to its recurrence (@critical)", async () => {
    const { define, run, store, recurrences } = materializerWorld();
    const rent = await define(rentToJanuary);
    const report = await run("2026-12-01");
    const [tx] = store.rows as Expense[];
    expect([tx?.description, tx?.date, tx?.amount, tx?.createdBy, tx?.payments]).toEqual([
      "Rent",
      "2026-12-01",
      120_000_000n,
      "u-ana",
      [{ memberId: null, accountId: ACCOUNTS.householdFund.id, amount: 120_000_000n }],
    ]);
    expect(report.occurrences.map((o) => [o.recurrenceId, o.date, o.status, o.transactionId])).toEqual([
      [rent.id, "2026-12-01", "RECORDED", tx!.id],
    ]);
    expect([recurrences.rows[0]!.dueFrom, report.paused, report.failures]).toEqual(["2026-12-02", [], []]);
  });

  it("records nothing twice when it runs again on 2026-12-01", async () => {
    const { define, run, store } = materializerWorld();
    await define(rentToJanuary);
    await run("2026-12-01");
    const again = await run("2026-12-01");
    expect([store.rows.length, again.occurrences]).toEqual([1, []]);
  });

  it("catches up missed runs: the 2026-12-01 Rent on 2026-12-04, then every missed date in order", async () => {
    const { define, run, store } = materializerWorld();
    await define(rentDefinition());
    await run("2026-12-04");
    expect(store.rows.map((t) => [t.description, t.date])).toEqual([["Rent", "2026-12-01"]]);
    await run("2027-03-15");
    expect(store.rows.map((t) => t.date)).toEqual(["2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01"]);
  });

  it("stops after its end date: nothing for 2027-02-01, and the Rent is ENDED", async () => {
    const { define, run, store, recurrences } = materializerWorld();
    await define(rentToJanuary);
    await run("2027-02-01");
    expect([store.rows.map((t) => t.date), statusOf(recurrences.rows[0]!)]).toEqual([
      ["2026-12-01", "2027-01-01"],
      "ENDED",
    ]);
  });

  it("splits Internet BY_ALLOCATION with each occurrence's period: 48,000 / 72,000 then 60,000 / 60,000 COP (golden)", async () => {
    const december = [
      { memberId: "member-ana", weight: 58_800_000n },
      { memberId: "member-juan", weight: 88_200_000n },
    ];
    const january = [
      { memberId: "member-ana", weight: 73_500_000n },
      { memberId: "member-juan", weight: 73_500_000n },
    ];
    const { define, run, store } = materializerWorld({ weights: (date) => (date < "2027-01-01" ? december : january) });
    await define(internet);
    await run("2027-01-05");
    expect(store.rows.map((t) => [t.date, sharesOf(t)])).toEqual([
      [
        "2026-12-05",
        [
          ["member-ana", 4_800_000n, "BY_ALLOCATION"],
          ["member-juan", 7_200_000n, "BY_ALLOCATION"],
        ],
      ],
      [
        "2027-01-05",
        [
          ["member-ana", 6_000_000n, "BY_ALLOCATION"],
          ["member-juan", 6_000_000n, "BY_ALLOCATION"],
        ],
      ],
    ]);
  });

  it("skips the occurrence of a CLOSED period with reason PeriodClosed and records the next one (P25)", async () => {
    const { define, run, store, recurrences } = materializerWorld({
      closed: (date) => date >= "2026-12-01" && date <= "2026-12-31",
    });
    await define(rentDefinition());
    const report = await run("2027-01-01");
    expect(report.occurrences.map((o) => [o.date, o.status, o.reason])).toEqual([
      ["2026-12-01", "SKIPPED", "PeriodClosed"],
      ["2027-01-01", "RECORDED", null],
    ]);
    expect([store.rows.map((t) => t.date), statusOf(recurrences.rows[0]!), report.paused]).toEqual([
      ["2027-01-01"],
      "ACTIVE",
      [],
    ]);
  });

  it("leaves a CONFIRM occurrence PENDING with its estimate, records nothing, and skips it in a CLOSED period (HU-E4-13)", async () => {
    const { define, run, store } = materializerWorld({ closed: (date) => date >= "2027-01-01" && date <= "2027-01-31" });
    await define(
      rentDefinition({
        description: "Electricity",
        amount: cop(180_000n),
        mode: "CONFIRM",
        schedule: { kind: "MONTHLY", day: 10 },
        template: {
          type: "EXPENSE",
          categoryId: CATEGORIES.household.id,
          payer: { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id },
          split: null,
        },
      }),
    );
    const report = await run("2027-01-10");
    expect(report.occurrences.map((o) => [o.date, o.status, o.amount, o.reason])).toEqual([
      ["2026-12-10", "PENDING", 18_000_000n, null],
      ["2027-01-10", "SKIPPED", 18_000_000n, "PeriodClosed"],
    ]);
    expect(store.rows).toEqual([]);
  });

  it("applies an edit to future occurrences only: 1,200,000 COP on 2026-12-01, 1,300,000 COP on 2027-01-01", async () => {
    const { define, run, store, deps, clock } = materializerWorld();
    const rent = await define(rentToJanuary);
    await run("2026-12-01");
    clock.set("2026-12-15");
    unwrap(
      await createUpdateRecurrence(deps)({
        spaceId: "space-household",
        userId: "u-ana",
        recurrenceId: rent.id,
        changes: { amount: cop(1_300_000n) },
      }),
    );
    await run("2027-01-01");
    expect(store.rows.map((t) => [t.date, t.amount])).toEqual([
      ["2026-12-01", 120_000_000n],
      ["2027-01-01", 130_000_000n],
    ]);
  });

  it("skips the paused span without back-filling: Cleaning paused on 2026-12-20, resumed on 2027-02-10, records 2027-02-16", async () => {
    const { define, run, store, deps, clock } = materializerWorld();
    const cleaning = await define(
      rentDefinition({ description: "Cleaning", amount: cop(80_000n), schedule: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } }),
    );
    const ref = { spaceId: "space-household", userId: "u-ana", recurrenceId: cleaning.id };
    await run("2026-12-16");
    clock.set("2026-12-20");
    unwrap(await createPauseRecurrence(deps)(ref));
    await run("2027-01-20");
    clock.set("2027-02-10");
    unwrap(await createResumeRecurrence(deps)(ref));
    await run("2027-02-20");
    expect(store.rows.map((t) => t.date)).toEqual(["2026-12-01", "2026-12-16", "2027-02-16"]);
  });

  it("reports a recurrence whose run throws, and goes on with the others", async () => {
    const w = materializerWorld();
    const rent = await w.define(rentDefinition());
    const broken = await w.define(rentDefinition({ description: "Broken" }));
    const deps: MaterializeDeps = {
      ...w.deps,
      recorders: {
        ...w.deps.recorders,
        expense: async (input) => {
          if (input.description === "Broken") throw new Error("boom");
          return w.deps.recorders.expense(input);
        },
      },
    };
    const report = await createMaterializeDueOccurrences(deps)({ today: day("2026-12-01") });
    expect([report.failures, report.occurrences.map((o) => o.recurrenceId)]).toEqual([
      [{ recurrenceId: broken.id, spaceId: "space-household", error: "Error" }],
      [rent.id],
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/materialize-occurrences.test.ts`
Expected: FAIL — `Failed to resolve import "./materialize-occurrences"`.

- [ ] **Step 3: Implement**

`src/modules/ledger/application/materialize-recurrence.ts`:

```ts
import { addDays, Money, ok, type LocalDate, type Result } from "@/shared/kernel";
import { pendingOccurrence, recordedOccurrence, skippedOccurrence, type Occurrence } from "../domain/occurrence";
import { statusOf, type Recurrence } from "../domain/recurrence";
import { scheduleDates } from "../domain/recurrence-schedule";
import { openPeriod } from "./checks";
import { recordOccurrence, type OccurrenceRecorders } from "./record-occurrence";
import type { ActiveRecurrence, RecurrenceDeps } from "./recurrence-ports";

/** Schedule dates one run considers per recurrence at most; a longer backlog goes on in the next run. */
export const CATCH_UP_LIMIT = 24;

export interface MaterializeDeps extends RecurrenceDeps {
  /** The ledger's record use cases (ruling P21). */
  readonly recorders: OccurrenceRecorders;
}

/** What one run did to one recurrence. */
export interface RecurrenceRun {
  readonly occurrences: readonly Occurrence[];
  /** The reason this run paused it (ruling P26); null when it did not. */
  readonly pausedFor: string | null;
}

/**
 * One date of a recurrence (HU-E4-12, HU-E4-13): AUTO records it through the ledger's own use case on behalf of its
 * creator (ruling P21), CONFIRM leaves it pending unless its period is CLOSED (ruling P25); a refused date is
 * SKIPPED with the refusing code.
 */
const occurrenceOn = async (
  deps: MaterializeDeps,
  recurrence: Recurrence,
  date: LocalDate,
  now: Date,
): Promise<Occurrence> => {
  const id = deps.ids.next<"Occurrence">();
  if (recurrence.mode === "CONFIRM") {
    const open = await openPeriod(deps, recurrence.spaceId, date);
    return open.ok
      ? pendingOccurrence(id, recurrence, date, now)
      : skippedOccurrence(id, recurrence, date, open.error.code, now);
  }
  const amount = Money.ofMinor(recurrence.amount, recurrence.currency);
  if (!amount.ok) return skippedOccurrence(id, recurrence, date, amount.error.code, now);
  const recorded = await recordOccurrence(deps.recorders, recurrence, {
    userId: recurrence.createdBy,
    date,
    amount: amount.value,
  });
  return recorded.ok
    ? recordedOccurrence(id, recurrence, date, recorded.value.transaction.id, now)
    : skippedOccurrence(id, recurrence, date, recorded.error.code, now);
};

/**
 * HU-E4-12: every date from the first not considered yet through `today` (and its end date) becomes one occurrence
 * (spec 5.2), in one transaction under the recurrence's row lock, read under that lock (ruling P20): runs and writes
 * of one recurrence take turns, so a date is considered once and an edit or pause committed first is what counts.
 */
export const materializeRecurrence = (
  deps: MaterializeDeps,
  active: ActiveRecurrence,
  today: LocalDate,
): Promise<Result<RecurrenceRun>> =>
  deps.tm.run(async () => {
    const recurrence = await deps.recurrences.lockForWrite(active.spaceId, active.id);
    // Paused, ended or gone while this run waited for the lock: nothing is due.
    if (recurrence === null || statusOf(recurrence) !== "ACTIVE") return ok({ occurrences: [], pausedFor: null });
    const through = recurrence.endDate !== null && recurrence.endDate < today ? recurrence.endDate : today;
    const dates =
      recurrence.dueFrom > through
        ? []
        : scheduleDates(recurrence.schedule, { from: recurrence.dueFrom, through }, CATCH_UP_LIMIT);
    if (dates.length === 0) return ok({ occurrences: [], pausedFor: null });
    const now = deps.clock.now();
    const occurrences: Occurrence[] = [];
    for (const date of dates) {
      const occurrence = await occurrenceOn(deps, recurrence, date, now);
      await deps.occurrences.addOccurrence(occurrence);
      occurrences.push(occurrence);
    }
    await deps.recurrences.save({ ...recurrence, dueFrom: addDays(dates.at(-1)!, 1), updatedAt: now });
    return ok({ occurrences, pausedFor: null });
  });
```

`src/modules/ledger/application/materialize-occurrences.ts`:

```ts
import { domainError, err, todayIn, type LocalDate } from "@/shared/kernel";
import type { Occurrence } from "../domain/occurrence";
import { materializeRecurrence, type MaterializeDeps } from "./materialize-recurrence";

export interface MaterializationReport {
  readonly occurrences: readonly Occurrence[];
  readonly paused: readonly { readonly recurrenceId: string; readonly spaceId: string; readonly reason: string }[];
  /** Recurrences whose run threw: their transaction rolled back and the next run retries them. */
  readonly failures: readonly { readonly recurrenceId: string; readonly spaceId: string; readonly error: string }[];
}

export type MaterializeDueOccurrences = (input: { readonly today?: LocalDate }) => Promise<MaterializationReport>;

/**
 * HU-E4-12 MaterializeDueOccurrences, the scheduler's job (ruling P20): every active recurrence of every space, one
 * transaction each, so one that fails never stops the others. Idempotent: a second run on the same day finds
 * nothing due, and the unique key (recurrence, date) refuses a second occurrence of a date whatever happens.
 */
export const createMaterializeDueOccurrences =
  (deps: MaterializeDeps): MaterializeDueOccurrences =>
  async (input) => {
    const today = input.today ?? todayIn(deps.clock, deps.timeZone);
    const occurrences: Occurrence[] = [];
    const paused: { recurrenceId: string; spaceId: string; reason: string }[] = [];
    const failures: { recurrenceId: string; spaceId: string; error: string }[] = [];
    for (const active of await deps.recurrences.listActive()) {
      const run = await materializeRecurrence(deps, active, today).catch((error: unknown) =>
        err(domainError(error instanceof Error ? error.name : "NonErrorThrown")),
      );
      if (!run.ok) {
        failures.push({ recurrenceId: active.id, spaceId: active.spaceId, error: run.error.code });
        continue;
      }
      occurrences.push(...run.value.occurrences);
      if (run.value.pausedFor !== null) {
        paused.push({ recurrenceId: active.id, spaceId: active.spaceId, reason: run.value.pausedFor });
      }
    }
    return { occurrences, paused, failures };
  };
```

Append to `src/modules/ledger/application/index.ts`:

```ts
export { CATCH_UP_LIMIT, type MaterializeDeps, type RecurrenceRun } from "./materialize-recurrence";
export {
  createMaterializeDueOccurrences,
  type MaterializationReport,
  type MaterializeDueOccurrences,
} from "./materialize-occurrences";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: PASS. Mutation check: in `materializeRecurrence`, save the recurrence without moving `dueFrom` — "records nothing twice" fails with 2 expenses; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/application/materialize-recurrence.ts src/modules/ledger/application/materialize-occurrences.ts src/modules/ledger/application/index.ts src/modules/ledger/application/materialize-occurrences.test.ts tests/support/in-memory-recurrences.ts
git commit -m "feat(ledger): record due occurrences once per recurrence and date, catching up missed runs (Refs #41, Refs #42)"
```

---

### Task 8c: Ledger — runs pause recurrences that can record no more

Implements HU-E4-11's note "If the paying member leaves the space, the recurrence is paused with reason `PayerLeft`" (issue #40) and the pause on refusal of ruling P26 (issue #41). Pins Review Focus 3 (Juan leaves, Pedro is removed, Ana leaves, Luis leaves a split, Juan becomes a VIEWER) and Review Focus 5 (an archived space pauses its recurrence with `SpaceArchived`, preflight N4).

Decisions:
- **Former members (ruling P26):** every run checks each active recurrence first: if its paying member (an expense's payer, a contribution's member; guests included) is no longer a current member it pauses with reason `PayerLeft`; otherwise, if the user who defined it, on whose behalf it records, is no longer a current member, with `CreatorLeft`. The check runs even when no date is due, so the pause shows within one run of the departure; when a date is due, that date is stored `SKIPPED` with the reason. `spaces` never calls the ledger (the ledger imports `spaces`, not the reverse), so a departure is seen by the next run, not by `LeaveSpace`.
- **Other refusals:** an AUTO date refused for any other reason (an archived account or category, a split participant who left, a creator who became a VIEWER, an archived space) would refuse every later date too, so the recurrence pauses with that code at the first one; `PeriodClosed` alone never pauses (ruling P25). Resuming checks the template again (Task 5), so a member fixes the cause or ends it.
- Only `materialize-recurrence.ts` changes; its contents are replaced.

**Files:**
- Modify: `src/modules/ledger/application/materialize-recurrence.ts`
- Test: `src/modules/ledger/application/materialize-occurrences.test.ts`

**Interfaces:**
- Consumes: `blockerOf`, `pausedRecurrence` (Task 2b); `materializerWorld`, `rentDefinition` (Tasks 4, 8b); `InMemorySpaceStore.markLeft`, `.updateRole`, `.archive` (`tests/support/in-memory-spaces.ts`).
- Produces: `RecurrenceRun.pausedFor` and `MaterializationReport.paused` now report `PayerLeft`, `CreatorLeft` and refusing codes.

- [ ] **Step 1: Write the failing tests**

In `src/modules/ledger/application/materialize-occurrences.test.ts`:

1. Replace the line `import type { LocalDate } from "@/shared/kernel";` with:

```ts
import type { SpaceMemberId } from "@/modules/spaces/application";
import type { LocalDate } from "@/shared/kernel";
```

2. Replace the line `import { materializerWorld, rentDefinition } from "../../../../tests/support/in-memory-recurrences";` with:

```ts
import { materializerWorld, rentDefinition } from "../../../../tests/support/in-memory-recurrences";
import type { InMemorySpaceStore } from "../../../../tests/support/in-memory-spaces";
```

3. Append to the end of the file:

```ts

describe("pausing recurrences that can record no more (HU-E4-11, P26)", () => {
  const leaves = (spaces: InMemorySpaceStore, name: string, kind: "USER" | "GUEST" = "USER") =>
    spaces.markLeft("space-household", `member-${name}`, kind, new Date("2026-11-20T12:00:00Z"));

  it("pauses Internet with reason PayerLeft once Juan left, skipping its due date and recording nothing", async () => {
    const { define, run, store, recurrences, spaces } = materializerWorld();
    const recurrence = await define(internet);
    await leaves(spaces, "juan");
    const report = await run("2026-12-05");
    expect([report.occurrences.map((o) => [o.date, o.status, o.reason]), report.paused, store.rows]).toEqual([
      [["2026-12-05", "SKIPPED", "PayerLeft"]],
      [{ recurrenceId: recurrence.id, spaceId: "space-household", reason: "PayerLeft" }],
      [],
    ]);
    const paused = recurrences.rows[0]!;
    expect([statusOf(paused), paused.pauseReason, paused.dueFrom]).toEqual(["PAUSED", "PayerLeft", "2026-12-06"]);
    expect((await run("2027-01-05")).occurrences).toEqual([]);
  });

  it("pauses as soon as a run sees the payer gone, before any date is due", async () => {
    const { define, run, recurrences, spaces } = materializerWorld();
    await define(internet);
    await leaves(spaces, "juan");
    const report = await run("2026-11-21");
    expect([report.occurrences, recurrences.rows[0]!.pauseReason]).toEqual([[], "PayerLeft"]);
  });

  it("pauses the removed guest Pedro's expense with PayerLeft and Ana's fund-paid Rent with CreatorLeft once she left", async () => {
    const { define, run, recurrences, spaces } = materializerWorld();
    await define(
      rentDefinition({
        description: "Pedro's lunch",
        amount: cop(30_000n),
        template: {
          type: "EXPENSE",
          categoryId: CATEGORIES.household.id,
          payer: { memberId: "member-pedro", accountId: null },
          split: null,
        },
      }),
    );
    await define(rentDefinition({ userId: "u-juan", description: "Juan's rent" }));
    await define(rentDefinition());
    await leaves(spaces, "pedro", "GUEST");
    await leaves(spaces, "ana");
    await run("2026-12-01");
    expect(recurrences.rows.map((r) => [r.description, r.pauseReason])).toEqual([
      ["Pedro's lunch", "PayerLeft"],
      ["Juan's rent", null],
      ["Rent", "CreatorLeft"],
    ]);
  });

  it("pauses on any other refusal with its code, at the first refused date: a split member who left, a creator now VIEWER", async () => {
    const { define, run, recurrences, spaces } = materializerWorld();
    await define(
      rentDefinition({
        description: "Shared",
        template: {
          type: "EXPENSE",
          categoryId: CATEGORIES.household.id,
          payer: { memberId: null, accountId: ACCOUNTS.householdFund.id },
          split: { method: "EQUAL", participants: [{ memberId: "member-ana" }, { memberId: "member-luis" }] },
        },
      }),
    );
    await define(rentDefinition({ userId: "u-juan", description: "Juan's rent" }));
    await leaves(spaces, "luis");
    await spaces.updateRole("space-household", "member-juan" as SpaceMemberId, "VIEWER");
    const report = await run("2027-01-01");
    expect(report.occurrences.map((o) => [o.date, o.status, o.reason])).toEqual([
      ["2026-12-01", "SKIPPED", "NotASpaceMember"],
      ["2026-12-01", "SKIPPED", "InsufficientRole"],
    ]);
    expect(recurrences.rows.map((r) => [r.pauseReason, r.dueFrom])).toEqual([
      ["NotASpaceMember", "2026-12-02"],
      ["InsufficientRole", "2026-12-02"],
    ]);
  });

  it("pauses the Rent of an archived space with reason SpaceArchived, recording nothing (HU-E1-09, P26)", async () => {
    const { define, run, store, recurrences, spaces } = materializerWorld();
    await define(rentDefinition());
    await spaces.archive("space-household");
    const report = await run("2026-12-01");
    expect([report.occurrences.map((o) => [o.date, o.status, o.reason]), store.rows]).toEqual([
      [["2026-12-01", "SKIPPED", "SpaceArchived"]],
      [],
    ]);
    const paused = recurrences.rows[0]!;
    expect([statusOf(paused), paused.pauseReason]).toEqual(["PAUSED", "SpaceArchived"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/materialize-occurrences.test.ts`
Expected: FAIL — the new scenarios report `paused: []`, store Internet's date as `SKIPPED` with `NotASpaceMember` instead of `PayerLeft`, and skip every later date instead of pausing.

- [ ] **Step 3: Implement**

Replace the contents of `src/modules/ledger/application/materialize-recurrence.ts` with:

```ts
import type { SpaceId } from "@/modules/spaces/application";
import { addDays, Money, ok, type LocalDate, type Result } from "@/shared/kernel";
import { pendingOccurrence, recordedOccurrence, skippedOccurrence, type Occurrence } from "../domain/occurrence";
import { blockerOf, pausedRecurrence, statusOf, type Recurrence } from "../domain/recurrence";
import { scheduleDates } from "../domain/recurrence-schedule";
import { openPeriod } from "./checks";
import { recordOccurrence, type OccurrenceRecorders } from "./record-occurrence";
import type { ActiveRecurrence, RecurrenceDeps } from "./recurrence-ports";

/** Schedule dates one run considers per recurrence at most; a longer backlog goes on in the next run. */
export const CATCH_UP_LIMIT = 24;

export interface MaterializeDeps extends RecurrenceDeps {
  /** The ledger's record use cases (ruling P21). */
  readonly recorders: OccurrenceRecorders;
}

/** What one run did to one recurrence. */
export interface RecurrenceRun {
  readonly occurrences: readonly Occurrence[];
  /** The reason this run paused it (ruling P26); null when it did not. */
  readonly pausedFor: string | null;
}

/**
 * One date of a recurrence (HU-E4-12, HU-E4-13): AUTO records it through the ledger's own use case on behalf of its
 * creator (ruling P21), CONFIRM leaves it pending unless its period is CLOSED (ruling P25); a refused date is
 * SKIPPED with the refusing code.
 */
const occurrenceOn = async (
  deps: MaterializeDeps,
  recurrence: Recurrence,
  date: LocalDate,
  now: Date,
): Promise<Occurrence> => {
  const id = deps.ids.next<"Occurrence">();
  if (recurrence.mode === "CONFIRM") {
    const open = await openPeriod(deps, recurrence.spaceId, date);
    return open.ok
      ? pendingOccurrence(id, recurrence, date, now)
      : skippedOccurrence(id, recurrence, date, open.error.code, now);
  }
  const amount = Money.ofMinor(recurrence.amount, recurrence.currency);
  if (!amount.ok) return skippedOccurrence(id, recurrence, date, amount.error.code, now);
  const recorded = await recordOccurrence(deps.recorders, recurrence, {
    userId: recurrence.createdBy,
    date,
    amount: amount.value,
  });
  return recorded.ok
    ? recordedOccurrence(id, recurrence, date, recorded.value.transaction.id, now)
    : skippedOccurrence(id, recurrence, date, recorded.error.code, now);
};

/**
 * HU-E4-12: every date from the first not considered yet through `today` (and its end date) becomes one occurrence
 * (spec 5.2), in one transaction under the recurrence's row lock, read under that lock (ruling P20): runs and writes
 * of one recurrence take turns, so a date is considered once and an edit or pause committed first is what counts.
 * Ruling P26: a recurrence whose payer or creator left pauses, even with nothing due; one refused for any other
 * reason than a closed period pauses at the first refused date, which would refuse every later date too.
 */
export const materializeRecurrence = (
  deps: MaterializeDeps,
  active: ActiveRecurrence,
  today: LocalDate,
): Promise<Result<RecurrenceRun>> =>
  deps.tm.run(async () => {
    const recurrence = await deps.recurrences.lockForWrite(active.spaceId, active.id);
    // Paused, ended or gone while this run waited for the lock: nothing is due.
    if (recurrence === null || statusOf(recurrence) !== "ACTIVE") return ok({ occurrences: [], pausedFor: null });
    const now = deps.clock.now();
    const blocker = blockerOf(recurrence, await deps.members.listCurrent(recurrence.spaceId as SpaceId));
    const through = recurrence.endDate !== null && recurrence.endDate < today ? recurrence.endDate : today;
    const dates =
      recurrence.dueFrom > through
        ? []
        : scheduleDates(recurrence.schedule, { from: recurrence.dueFrom, through }, CATCH_UP_LIMIT);
    const occurrences: Occurrence[] = [];
    let pausedFor: string | null = blocker;
    for (const date of dates) {
      const occurrence =
        blocker === null
          ? await occurrenceOn(deps, recurrence, date, now)
          : skippedOccurrence(deps.ids.next<"Occurrence">(), recurrence, date, blocker, now);
      await deps.occurrences.addOccurrence(occurrence);
      occurrences.push(occurrence);
      if (occurrence.status === "SKIPPED" && occurrence.reason !== "PeriodClosed") {
        pausedFor = occurrence.reason;
        break;
      }
    }
    if (occurrences.length === 0 && pausedFor === null) return ok({ occurrences, pausedFor });
    const last = occurrences.at(-1);
    const advanced = last === undefined ? recurrence : { ...recurrence, dueFrom: addDays(last.date, 1), updatedAt: now };
    // A recurrence whose last date was just considered is ENDED and stays so.
    const paused = pausedFor === null ? ok(advanced) : pausedRecurrence(advanced, now, pausedFor);
    await deps.recurrences.save(paused.ok ? paused.value : advanced);
    return ok({ occurrences, pausedFor: paused.ok ? pausedFor : null });
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: PASS (every Task 8b scenario still passes). Mutation check: temporarily drop the `break` — "pauses on any other refusal …" fails with a second `SKIPPED` date for each recurrence; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/application/materialize-recurrence.ts src/modules/ledger/application/materialize-occurrences.test.ts
git commit -m "feat(ledger): pause recurrences whose payer or creator left or whose occurrence is refused (Refs #40, Refs #41)"
```

---

### Task 9a: Scheduler — the in-container job

Implements HU-E4-12's technical note "Runs behind a `Scheduler` port (adapter: in-container cron job) and uses `Clock`; … No public endpoint triggers it" (issue #41). Pins Review Focus 1 (the timer never overlaps two runs).

Decisions:
- **Ruling P20:** the job runs inside the app container. `src/instrumentation.ts` (Next.js's startup hook, already the place that validates the environment) starts it once the environment is valid: a `TimerScheduler` (adapter of the kernel's `Scheduler` port) runs it at once, so a restart catches up the days it missed, and then `RECURRENCE_JOB_INTERVAL_SECONDS` after each run ends (default 300; `0` turns it off), so two runs of one container never overlap. Two containers running it are still safe: runs of one recurrence take turns on its row lock and the unique key refuses a second occurrence of a date (Task 12 races it). Alternatives rejected: an endpoint a cron container calls (the backlog forbids a public trigger, and it adds a service and a secret), and catching up on reads or writes (reads that write, slower requests, and nothing recorded in a space nobody opens).
- The job's day is the space timezone's today (`todayIn(clock, APP_TIMEZONE)`, the use case's default). Every `SKIPPED` occurrence is logged as `recurrence_occurrence_skipped` with its reason (HU-E4-12 "the skip is logged with reason `PeriodClosed`"), every pause as `recurrence_paused`, every failed recurrence as `recurrence_materialization_failed`; a job that throws is logged as `recurrence_job_failed` and runs again on the next tick.
- Only `register()` starts the job; `buildContainer` never does. No test calls `register()` except `src/instrumentation.test.ts`, which mocks the job, and the tests drive the use case directly; `RECURRENCE_JOB_INTERVAL_SECONDS: 0` in `startTestApp` only fills the new required `Env` field (preflight N3). Next.js 16.4.0 skips `register()` during `next build` (`NEXT_PHASE === "phase-production-build"`), and `register()` checks that phase itself as well, so a build never starts the job; `next dev` starts it every 300 s unless `RECURRENCE_JOB_INTERVAL_SECONDS=0` (documented in `docs/operations/deploy.md`).

**Files:**
- Create: `src/shared/kernel/scheduler.ts`, `src/shared/infrastructure/timer-scheduler.ts`, `src/composition/recurrence-job.ts`
- Modify: `src/shared/kernel/index.ts`, `src/shared/infrastructure/env.ts`, `src/instrumentation.ts`, `src/composition/container.ts`, `tests/support/app.ts`, `compose.yaml`, `docs/operations/deploy.md`
- Test: create `src/shared/infrastructure/timer-scheduler.test.ts`, `src/composition/recurrence-job.test.ts`; modify `src/shared/infrastructure/env.test.ts`, `src/instrumentation.test.ts`

**Interfaces:**
- Consumes: `occurrenceRecorders` (Task 8a); `createMaterializeDueOccurrences`, `MaterializeDueOccurrences`, `MaterializationReport`, `MaterializeDeps` (Task 8b); `recurrenceDeps`, `ledgerDeps` (container, Task 6e); `Logger` (`src/shared/http/logger.ts`).
- Produces: `interface Scheduler { every(intervalMs: number, job: () => Promise<void>): () => void }` (kernel); `class TimerScheduler implements Scheduler` (constructor `(onError: (error: unknown) => void)`); `interface RecurrenceJobDeps { materialize; scheduler; logger }`, `startRecurrenceJob(deps, intervalMs): () => void`; `Env.RECURRENCE_JOB_INTERVAL_SECONDS: number`; `Container.ledger.materializeDueOccurrences: MaterializeDueOccurrences`.

- [ ] **Step 1: Write the failing tests**

`src/shared/infrastructure/timer-scheduler.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimerScheduler } from "./timer-scheduler";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("TimerScheduler (HU-E4-12, P20)", () => {
  it("runs the job at once, then every interval after each run ends", async () => {
    let runs = 0;
    const stop = new TimerScheduler(() => undefined).every(1000, async () => {
      runs += 1;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(2500);
    stop();
    expect(runs).toBe(3);
  });

  it("never starts a run while the previous one is still going", async () => {
    let running = 0;
    let most = 0;
    let finish: () => void = () => undefined;
    const stop = new TimerScheduler(() => undefined).every(10, async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      running -= 1;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect([running, most]).toEqual([1, 1]);
    finish();
    await vi.advanceTimersByTimeAsync(10);
    stop();
    expect(most).toBe(1);
  });

  it("reports a job that throws and runs it again on the next tick", async () => {
    const errors: unknown[] = [];
    let runs = 0;
    const stop = new TimerScheduler((error) => errors.push(error)).every(1000, async () => {
      runs += 1;
      throw new Error("boom");
    });
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    expect([runs, errors.length]).toEqual([2, 2]);
  });

  it("runs nothing after stop()", async () => {
    let runs = 0;
    const stop = new TimerScheduler(() => undefined).every(1000, async () => {
      runs += 1;
    });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runs).toBe(1);
  });
});
```

`src/composition/recurrence-job.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type {
  MaterializationReport,
  Occurrence,
  OccurrenceId,
  OccurrenceStatus,
  RecurrenceId,
} from "@/modules/ledger/application";
import type { Logger } from "@/shared/http";
import type { LocalDate, Scheduler } from "@/shared/kernel";
import { startRecurrenceJob } from "./recurrence-job";

const occurrence = (status: OccurrenceStatus, reason: string | null): Occurrence => ({
  id: "occ-1" as OccurrenceId,
  recurrenceId: "rec-1" as RecurrenceId,
  spaceId: "space-1",
  date: "2026-12-01" as LocalDate,
  status,
  amount: 100n,
  transactionId: status === "RECORDED" ? "tx-1" : null,
  reason,
  resolvedBy: null,
  createdAt: new Date("2026-12-01T05:00:00Z"),
  resolvedAt: null,
});

describe("the recurring-transactions job (HU-E4-12, P20)", () => {
  it("materializes on every tick of its scheduler and logs every skip, pause and failure", async () => {
    const ticks: { intervalMs: number; job: () => Promise<void> }[] = [];
    const scheduler: Scheduler = {
      every: (intervalMs, job) => {
        ticks.push({ intervalMs, job });
        return () => undefined;
      },
    };
    const logged: [string, string, Record<string, unknown> | undefined][] = [];
    const logger: Logger = {
      info: (event, data) => logged.push(["info", event, data]),
      error: (event, data) => logged.push(["error", event, data]),
    };
    const report: MaterializationReport = {
      occurrences: [occurrence("SKIPPED", "PeriodClosed"), occurrence("RECORDED", null)],
      paused: [{ recurrenceId: "rec-2", spaceId: "space-1", reason: "PayerLeft" }],
      failures: [{ recurrenceId: "rec-3", spaceId: "space-2", error: "Error" }],
    };
    const asked: unknown[] = [];
    startRecurrenceJob(
      {
        materialize: async (input) => {
          asked.push(input);
          return report;
        },
        scheduler,
        logger,
      },
      300_000,
    );
    expect(ticks.map((t) => t.intervalMs)).toEqual([300_000]);
    await ticks[0]!.job();
    expect(asked).toEqual([{}]);
    expect(logged).toEqual([
      [
        "info",
        "recurrence_occurrence_skipped",
        { recurrenceId: "rec-1", spaceId: "space-1", date: "2026-12-01", reason: "PeriodClosed" },
      ],
      ["info", "recurrence_paused", { recurrenceId: "rec-2", spaceId: "space-1", reason: "PayerLeft" }],
      ["error", "recurrence_materialization_failed", { recurrenceId: "rec-3", spaceId: "space-2", error: "Error" }],
    ]);
  });
});
```

In `src/shared/infrastructure/env.test.ts`:

1. Replace the line `    expect(loadEnv(valid)).toEqual({ ...valid, APP_TIMEZONE: "America/Bogota", LOG_LEVEL: "info" });` with:

```ts
    expect(loadEnv(valid)).toEqual({
      ...valid,
      APP_TIMEZONE: "America/Bogota",
      LOG_LEVEL: "info",
      RECURRENCE_JOB_INTERVAL_SECONDS: 300,
    });
```

2. Insert before the last line of the file (`});`):

```ts

  it("reads the recurring-transactions interval in seconds, 0 turning the job off (HU-E4-12)", () => {
    expect(loadEnv({ ...valid, RECURRENCE_JOB_INTERVAL_SECONDS: "0" }).RECURRENCE_JOB_INTERVAL_SECONDS).toBe(0);
    expect(loadEnv({ ...valid, RECURRENCE_JOB_INTERVAL_SECONDS: "60" }).RECURRENCE_JOB_INTERVAL_SECONDS).toBe(60);
    expect(() => loadEnv({ ...valid, RECURRENCE_JOB_INTERVAL_SECONDS: "-1" })).toThrow(/RECURRENCE_JOB_INTERVAL_SECONDS/);
    expect(() => loadEnv({ ...valid, RECURRENCE_JOB_INTERVAL_SECONDS: "1.5" })).toThrow(/RECURRENCE_JOB_INTERVAL_SECONDS/);
  });
```

In `src/instrumentation.test.ts`:

1. Replace the line `import { register } from "./instrumentation";` with:

```ts
import { startRecurrenceJob } from "@/composition/recurrence-job";
import { register } from "./instrumentation";

// The job's wiring is pinned without a database: the container and the job are stand-ins.
vi.mock("@/composition/recurrence-job", () => ({ startRecurrenceJob: vi.fn() }));
vi.mock("@/composition/container", () => ({
  getContainer: () => ({
    ledger: { materializeDueOccurrences: "materialize" },
    logger: { info: () => undefined, error: () => undefined },
  }),
}));
```

2. Insert before the last line of the file (`});`):

```ts

  it("starts the recurring-transactions job every RECURRENCE_JOB_INTERVAL_SECONDS, and not at all with 0 (HU-E4-12)", async () => {
    vi.mocked(startRecurrenceJob).mockClear();
    stubEnv({ ...VALID, NEXT_RUNTIME: "nodejs", RECURRENCE_JOB_INTERVAL_SECONDS: "120" });
    await register();
    expect(vi.mocked(startRecurrenceJob)).toHaveBeenCalledWith(
      expect.objectContaining({ materialize: "materialize" }),
      120_000,
    );
    vi.mocked(startRecurrenceJob).mockClear();
    stubEnv({ RECURRENCE_JOB_INTERVAL_SECONDS: "0" });
    await register();
    expect(vi.mocked(startRecurrenceJob)).not.toHaveBeenCalled();
  });

  it("never starts the job during `next build` (NEXT_PHASE phase-production-build)", async () => {
    vi.mocked(startRecurrenceJob).mockClear();
    stubEnv({
      ...VALID,
      NEXT_RUNTIME: "nodejs",
      NEXT_PHASE: "phase-production-build",
      RECURRENCE_JOB_INTERVAL_SECONDS: "120",
    });
    await register();
    expect(vi.mocked(startRecurrenceJob)).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit src/shared/infrastructure src/composition/recurrence-job.test.ts src/instrumentation.test.ts`
Expected: FAIL — `Failed to resolve import "./timer-scheduler"` and `"./recurrence-job"`; `loadEnv(valid)` lacks `RECURRENCE_JOB_INTERVAL_SECONDS`.

- [ ] **Step 3: Implement**

`src/shared/kernel/scheduler.ts`:

```ts
/** HU-E4-12: runs a job again and again; the adapter decides how (an in-container timer in v1, ruling P20). */
export interface Scheduler {
  /** Runs `job` now, then `intervalMs` after each run ends; the returned function stops it. */
  every(intervalMs: number, job: () => Promise<void>): () => void;
}
```

In `src/shared/kernel/index.ts`, insert after the line `export * from "./clock";`:

```ts
export * from "./scheduler";
```

`src/shared/infrastructure/timer-scheduler.ts`:

```ts
import type { Scheduler } from "@/shared/kernel";

/**
 * HU-E4-12 (ruling P20): the in-container scheduler. A job runs at once, so a restart catches up what it missed, and
 * then `intervalMs` after each run ends, so two runs of one job never overlap. A job that throws is reported to
 * `onError` and runs again on the next tick.
 */
export class TimerScheduler implements Scheduler {
  constructor(private readonly onError: (error: unknown) => void) {}

  every(intervalMs: number, job: () => Promise<void>): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        await job();
      } catch (error) {
        this.onError(error);
      }
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }
}
```

`src/composition/recurrence-job.ts`:

```ts
import type { MaterializeDueOccurrences } from "@/modules/ledger/application";
import type { Logger } from "@/shared/http";
import type { Scheduler } from "@/shared/kernel";

export interface RecurrenceJobDeps {
  readonly materialize: MaterializeDueOccurrences;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
}

/**
 * HU-E4-12 (ruling P20): the in-container job that records due occurrences; no endpoint triggers it. Every skipped
 * occurrence is logged with its reason (PeriodClosed, ruling P25), and so is every pause and every failed recurrence.
 */
export const startRecurrenceJob = (deps: RecurrenceJobDeps, intervalMs: number): (() => void) =>
  deps.scheduler.every(intervalMs, async () => {
    const report = await deps.materialize({});
    for (const occurrence of report.occurrences) {
      if (occurrence.status !== "SKIPPED") continue;
      deps.logger.info("recurrence_occurrence_skipped", {
        recurrenceId: occurrence.recurrenceId,
        spaceId: occurrence.spaceId,
        date: occurrence.date,
        reason: occurrence.reason,
      });
    }
    for (const paused of report.paused) deps.logger.info("recurrence_paused", { ...paused });
    for (const failure of report.failures) deps.logger.error("recurrence_materialization_failed", { ...failure });
  });
```

In `src/shared/infrastructure/env.ts`, insert after the line `  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),`:

```ts
  /** HU-E4-12: seconds between runs of the recurring-transactions job; 0 turns it off. */
  RECURRENCE_JOB_INTERVAL_SECONDS: z.coerce.number().int().min(0).max(86_400).default(300),
```

Replace the contents of `src/instrumentation.ts` with:

```ts
import type { Env } from "@/shared/infrastructure/env";

/**
 * Next.js startup hook: refuse to serve with a missing or invalid environment (HU-E0-07), then start the
 * in-container job that records due recurring transactions (HU-E4-12, ruling P20) unless its interval is 0 or the
 * app is being built.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadEnv } = await import("@/shared/infrastructure/env");
  let env: Env;
  try {
    env = loadEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
    return;
  }
  // `next build` never starts the job: Next.js skips register() then, and this keeps the gate explicit.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (env.RECURRENCE_JOB_INTERVAL_SECONDS === 0) return;
  const [{ getContainer }, { startRecurrenceJob }, { TimerScheduler }] = await Promise.all([
    import("@/composition/container"),
    import("@/composition/recurrence-job"),
    import("@/shared/infrastructure/timer-scheduler"),
  ]);
  const container = getContainer();
  const onError = (error: unknown) =>
    container.logger.error("recurrence_job_failed", { name: error instanceof Error ? error.name : "NonErrorThrown" });
  startRecurrenceJob(
    {
      materialize: container.ledger.materializeDueOccurrences,
      scheduler: new TimerScheduler(onError),
      logger: container.logger,
    },
    env.RECURRENCE_JOB_INTERVAL_SECONDS * 1000,
  );
}
```

In `src/composition/container.ts`:

1. Insert before the line `  type DeleteTransaction,`:

```ts
  createMaterializeDueOccurrences,
  occurrenceRecorders,
  type MaterializeDeps,
  type MaterializeDueOccurrences,
```

2. Insert after the line `    readonly endRecurrence: EndRecurrence;`:

```ts
    readonly materializeDueOccurrences: MaterializeDueOccurrences;
```

3. Replace the two lines `    occurrences: recurrenceRepository,` and `  };` that follows it (the end of `recurrenceDeps`, Task 6e) with:

```ts
    occurrences: recurrenceRepository,
  };
  // HU-E4-12, HU-E4-13: the scheduler's job and confirmations record through the ledger's own use cases (P21).
  const materializeDeps: MaterializeDeps = { ...recurrenceDeps, recorders: occurrenceRecorders(ledgerDeps) };
```

4. Insert after the line `      endRecurrence: createEndRecurrence(recurrenceDeps),`:

```ts
      materializeDueOccurrences: createMaterializeDueOccurrences(materializeDeps),
```

In `tests/support/app.ts`, insert after the line `      LOG_LEVEL: "error",`:

```ts
      // Only fills the required Env field: buildContainer never starts the job (register() does).
      RECURRENCE_JOB_INTERVAL_SECONDS: 0,
```

In `compose.yaml`, insert after the line `      APP_TIMEZONE: ${APP_TIMEZONE:-America/Bogota}`:

```yaml
      RECURRENCE_JOB_INTERVAL_SECONDS: ${RECURRENCE_JOB_INTERVAL_SECONDS:-300}
```

In `docs/operations/deploy.md`, insert before the line `## Reverse proxy and client addresses`:

```markdown
## Recurring transactions job

The `app` container records due recurring transactions itself (HU-E4-12): a timer runs the job when the server starts, so a restart catches up the days it missed, and then every `RECURRENCE_JOB_INTERVAL_SECONDS` (default 300; `0` turns it off). No endpoint triggers it. Running it in two containers is safe: runs of one recurrence take turns on its row and a date is never recorded twice. Each run logs JSON lines `recurrence_occurrence_skipped` (with its reason, e.g. `PeriodClosed` for a closed plan's period), `recurrence_paused` (`PayerLeft`, `CreatorLeft` or the refusing code) and `recurrence_materialization_failed`; a failed recurrence is retried by the next run.

`next build` never starts the job. `next dev` does, every 300 s by default like the server: set `RECURRENCE_JOB_INTERVAL_SECONDS=0` in your local environment to keep it off while you develop.

```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit src/shared src/composition src/instrumentation.test.ts`
Expected: PASS. Mutation check: in `TimerScheduler.every`, temporarily schedule the next tick before awaiting the job (`timer = setTimeout(tick, intervalMs); await job();`) — "never starts a run while the previous one is still going" fails with `most` above 1; restore it. Then delete the `NEXT_PHASE` line of `register()` — "never starts the job during `next build`" fails with `startRecurrenceJob` called; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0; `pnpm lint:boundaries` confirms the kernel imports nothing and `src/shared` imports no module.

- [ ] **Step 6: Commit**

```bash
git add src/shared/kernel/scheduler.ts src/shared/kernel/index.ts src/shared/infrastructure/timer-scheduler.ts src/shared/infrastructure/timer-scheduler.test.ts src/shared/infrastructure/env.ts src/shared/infrastructure/env.test.ts src/composition/recurrence-job.ts src/composition/recurrence-job.test.ts src/composition/container.ts src/instrumentation.ts src/instrumentation.test.ts tests/support/app.ts compose.yaml docs/operations/deploy.md
git commit -m "feat(ledger): run the recurring-transactions job inside the app container (Refs #41)"
```

---

### Task 9b: HTTP acceptance — automatic occurrences end to end

Implements HU-E4-12's scenarios against the real app and PostgreSQL (issue #41), including the @critical and @golden ones, and HU-E4-11's "Editing applies to future occurrences only" end to end. Pins Review Focus 2 (a catch-up run over a plan CLOSED after its period, the end date) and Review Focus 4 (`BY_ALLOCATION` per period with the real budgeting binding of M3-B).

Decisions:
- The tests drive `Container.ledger.materializeDueOccurrences({ today })`, which is exactly what the in-container timer calls (no endpoint, ruling P20), and read the results through `GET …/transactions` (HU-E4-12's note) and the recurrence's `lastOccurrence`.
- The job processes every active recurrence of the test database, those of earlier tests included; each test asserts only on its own fresh household and filters the report by its recurrence.
- Spec 5.2's Recurrence entry is amended with the rulings this plan implements (P21–P24).
- The container runs on a `MovableClock` at the definition day (2026-10-28), reset after each test. Since M3-B's P17 as amended, a plan closes only once its period has ended, so HU-E4-12's "CLOSED before the scheduler runs on 2026-12-01" can no longer happen; its scenario is restated as a catch-up run (preflight B4): the scheduler misses December, the 2026-12 plan is closed on 2027-01-02, and that day's run skips 2026-12-01 with `PeriodClosed` and records 2027-01-01.

**Files:**
- Create: `tests/acceptance/recurring-occurrences.test.ts`
- Modify: `tests/support/recurrences.ts`, `docs/backlog/E4-ledger.md`, `docs/specs/2026-10-11-hearth-design.md`

**Interfaces:**
- Consumes: `Container.ledger.materializeDueOccurrences` (Task 9a); `defined`, `rentBody`, `householdWithFund`, `recurrenceOf`, `patchRecurrence` (Tasks 6e–7a); `MovableClock` (Task 4); `newPlan`, `setCapacities`, `addLine`, `lineNamed`, `putCategories`, `putAllocation`, `activatePlan`, `closePlan` (`tests/support/budgeting.ts`, M3-A and M3-B Tasks 5a, 5b); `cop`, `TransactionDto` (`tests/support/ledger.ts`); the transactions route.
- Produces: `transactionsIn(user, spaceId, period): Promise<TransactionDto[]>`, `homePlan(h, period, percent?): Promise<string>` in `tests/support/recurrences.ts`.

- [ ] **Step 1: Write the tests**

In `tests/support/recurrences.ts`:

1. Insert after the line `import { POST as archiveSpaceRoute } from "@/app/api/v1/spaces/[spaceId]/archive/route";`:

```ts
import { GET as listTransactionsRoute } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
```

2. Replace the line `import { categoryWithKey, cop, household, newAccount, type Household, type MoneyDto } from "./ledger";` with:

```ts
import { activatePlan, addLine, lineNamed, newPlan, putAllocation, putCategories, setCapacities } from "./budgeting";
import {
  categoryWithKey,
  cop,
  household,
  newAccount,
  type Household,
  type MoneyDto,
  type TransactionDto,
} from "./ledger";
```

3. Append to the end of the file:

```ts

/** HU-E4-05: the space's transactions of `period` ("2026-12") as `user` lists them, newest first. */
export const transactionsIn = async (user: TestUser, spaceId: string, period: string): Promise<TransactionDto[]> => {
  const response = await call(
    listTransactionsRoute,
    "GET",
    `/api/v1/spaces/${spaceId}/transactions?period=${encodeURIComponent(period)}`,
    { user, params: { spaceId } },
  );
  if (response.status !== 200) throw new Error(`listing failed with status ${response.status}`);
  return ((await response.json()) as { items: TransactionDto[] }).items;
};

/**
 * Household's ACTIVE plan for `period`: capacities Ana 1,600,000 and Juan 2,400,000 COP and the line Home (1,470,000
 * COP, PROPORTIONAL, so 40 % / 60 %, unless `percent` allocates it) consuming Utilities. Returns the plan id.
 */
export const homePlan = async (
  h: HouseholdWithFund,
  period: string,
  percent?: readonly [string, string],
): Promise<string> => {
  const succeeded = async (response: Promise<Response>) => {
    const answer = await response;
    if (answer.status !== 200) throw new Error(`plan setup failed with status ${answer.status}`);
  };
  const { id } = await newPlan(h.ana, h.spaceId, period);
  await setCapacities(h.ana, h.spaceId, id, [
    [h.ana.memberId, 1_600_000],
    [h.juan.memberId, 2_400_000],
  ]);
  const plan = await addLine(h.ana, h.spaceId, id, {
    name: "Home",
    pesos: 1_470_000,
    funding: "DIRECT",
    rolloverMode: "RESET",
  });
  const home = lineNamed(plan, "Home").id;
  await succeeded(putCategories(h.ana, h.spaceId, id, home, [h.utilities]));
  if (percent !== undefined) {
    const members = [
      { memberId: h.ana.memberId, percent: percent[0] },
      { memberId: h.juan.memberId, percent: percent[1] },
    ];
    await succeeded(putAllocation(h.ana, h.spaceId, id, home, { rule: "PERCENT", members }));
  }
  await succeeded(activatePlan(h.ana, h.spaceId, id));
  return id;
};
```

`tests/acceptance/recurring-occurrences.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setContainerForTests, type Container } from "@/composition/container";
import type { LocalDate } from "@/shared/kernel";
import { startTestApp } from "../support/app";
import { activatePlan, closePlan, newPlan } from "../support/budgeting";
import { MovableClock } from "../support/in-memory-recurrences";
import { cop, type TransactionDto } from "../support/ledger";
import {
  defined,
  homePlan,
  householdWithFund,
  patchRecurrence,
  recurrenceOf,
  rentBody,
  transactionsIn,
  type HouseholdWithFund,
} from "../support/recurrences";

let app: Container;
/** The definition day, 2026-10-28 at noon in Bogota; a test that closes a plan moves it past the period (P17 amended). */
const clock = new MovableClock("2026-10-28");
beforeAll(() => {
  app = startTestApp({ clock });
});
afterEach(() => clock.set("2026-10-28"));
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** The job the in-container timer runs, on `today`; no endpoint triggers it (ruling P20). */
const schedulerRunsOn = (today: string) => app.ledger.materializeDueOccurrences({ today: today as LocalDate });
const expensesIn = async (h: HouseholdWithFund, period: string) =>
  (await transactionsIn(h.ana, h.spaceId, period)).filter((t) => t.type === "EXPENSE");
const sharesOf = (tx: TransactionDto) => tx.shares.map((s) => [s.memberId, s.amount, s.splitMethod]);

describe("recording due occurrences (HU-E4-12)", () => {
  it("records the 2026-12-01 Rent from the fund on schedule, linked to its recurrence (@critical)", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h, { endDate: "2027-01-31" }));
    await schedulerRunsOn("2026-12-01");
    const expenses = await expensesIn(h, "2026-12");
    expect(expenses.map((t) => [t.description, t.date, t.amount, t.payments, t.createdBy])).toEqual([
      ["Rent", "2026-12-01", cop(1_200_000), [{ memberId: null, accountId: h.fund, amount: cop(1_200_000) }], h.ana.userId],
    ]);
    expect((await recurrenceOf(h.ana, h.spaceId, rent.id)).lastOccurrence).toMatchObject({
      date: "2026-12-01",
      status: "RECORDED",
      transactionId: expenses[0]!.id,
    });
  });

  it("records exactly one Rent for 2026-12-01 when the scheduler runs twice that day", async () => {
    const h = await householdWithFund();
    await defined(h.ana, h.spaceId, rentBody(h, { endDate: "2027-01-31" }));
    await schedulerRunsOn("2026-12-01");
    await schedulerRunsOn("2026-12-01");
    expect((await expensesIn(h, "2026-12")).map((t) => t.date)).toEqual(["2026-12-01"]);
  });

  it("catches up the 2026-12-01 Rent when the scheduler first runs on 2026-12-04", async () => {
    const h = await householdWithFund();
    await defined(h.ana, h.spaceId, rentBody(h, { endDate: "2027-01-31" }));
    await schedulerRunsOn("2026-12-04");
    expect((await expensesIn(h, "2026-12")).map((t) => [t.description, t.date])).toEqual([["Rent", "2026-12-01"]]);
  });

  it("splits Internet BY_ALLOCATION with the plan of each occurrence's period: 48,000 / 72,000 then 60,000 / 60,000 COP (@golden)", async () => {
    const h = await householdWithFund();
    await homePlan(h, "2026-12");
    await homePlan(h, "2027-01", ["50", "50"]);
    await defined(h.juan, h.spaceId, {
      description: "Internet",
      amount: cop(120_000),
      template: {
        type: "EXPENSE",
        categoryId: h.utilities,
        payer: { memberId: h.juan.memberId, accountId: h.juan.account },
      },
      schedule: { kind: "MONTHLY", day: 5 },
      mode: "AUTO",
      startDate: "2026-12-01",
    });
    await schedulerRunsOn("2027-01-05");
    const expenses = [...(await expensesIn(h, "2026-12")), ...(await expensesIn(h, "2027-01"))];
    expect(expenses.map((t) => [t.date, sharesOf(t)])).toEqual([
      [
        "2026-12-05",
        [
          [h.ana.memberId, cop(48_000), "BY_ALLOCATION"],
          [h.juan.memberId, cop(72_000), "BY_ALLOCATION"],
        ],
      ],
      [
        "2027-01-05",
        [
          [h.ana.memberId, cop(60_000), "BY_ALLOCATION"],
          [h.juan.memberId, cop(60_000), "BY_ALLOCATION"],
        ],
      ],
    ]);
  });

  it("skips, on a catch-up run, the occurrence of a period whose plan was CLOSED after it ended: PeriodClosed (P25)", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    const { id: december } = await newPlan(h.ana, h.spaceId, "2026-12");
    expect((await activatePlan(h.ana, h.spaceId, december)).status).toBe(200);
    // The job was down through December, and the plan closes only once its period has ended (P17 amended).
    clock.set("2027-01-02");
    expect((await closePlan(h.ana, h.spaceId, december)).status).toBe(200);
    const report = await schedulerRunsOn("2027-01-02");
    expect(await expensesIn(h, "2026-12")).toEqual([]);
    expect(
      report.occurrences.filter((o) => o.recurrenceId === rent.id).map((o) => [o.date, o.status, o.reason]),
    ).toEqual([
      ["2026-12-01", "SKIPPED", "PeriodClosed"],
      ["2027-01-01", "RECORDED", null],
    ]);
    const read = await recurrenceOf(h.ana, h.spaceId, rent.id);
    expect([read.status, read.nextOccurrence]).toEqual(["ACTIVE", "2027-02-01"]);
  });

  it("records nothing for 2027-02-01, after the Rent's end date, and the Rent is ENDED", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h, { endDate: "2027-01-31" }));
    await schedulerRunsOn("2027-02-01");
    expect([
      (await expensesIn(h, "2027-01")).map((t) => t.date),
      await expensesIn(h, "2027-02"),
      (await recurrenceOf(h.ana, h.spaceId, rent.id)).status,
    ]).toEqual([["2027-01-01"], [], "ENDED"]);
  });

  it("applies an edit to future occurrences only: 2026-12-01 keeps 1,200,000 COP, 2027-01-01 records 1,300,000 COP", async () => {
    const h = await householdWithFund();
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    await schedulerRunsOn("2026-12-01");
    expect((await patchRecurrence(h.ana, h.spaceId, rent.id, { amount: cop(1_300_000) })).status).toBe(200);
    await schedulerRunsOn("2027-01-01");
    const expenses = [...(await expensesIn(h, "2026-12")), ...(await expensesIn(h, "2027-01"))];
    expect(expenses.map((t) => [t.date, t.amount])).toEqual([
      ["2026-12-01", cop(1_200_000)],
      ["2027-01-01", cop(1_300_000)],
    ]);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/recurring-occurrences.test.ts`
Expected: PASS — Tasks 8a–8c and 9a implement every scenario; this task proves them against PostgreSQL and M3-B's real budgeting binding. Mutation checks, one at a time, each restored before the next: (a) in `src/composition/container.ts`, bind `defaultSplits` to `{ allocationWeights: async () => null }` — the @golden scenario fails with `EQUAL` shares; (b) bind `closedPeriods` to `{ isClosed: async () => false }` — the CLOSED scenario fails with a recorded expense.

- [ ] **Step 3: Write the documentation**

In `docs/backlog/E4-ledger.md`, insert after the line that starts with ``- Runs behind a `Scheduler` port (adapter: in-container cron job)``:

```markdown
- `MaterializeDueOccurrences` runs in the app container (M3-C ruling P20): `src/instrumentation.ts` starts a timer that runs it when the server starts and then every `RECURRENCE_JOB_INTERVAL_SECONDS` (default 300; `0` turns it off). Each active recurrence is handled in its own transaction under its row lock: every schedule date from the first not considered yet through today (and its end date) becomes one occurrence, at most 24 per run, and the unique key (`recurrence_id`, `occurrence_date`) refuses a second occurrence of a date. Each AUTO occurrence is recorded by `RecordExpense` (or the matching use case) on behalf of the member who defined the recurrence (ruling P21), so the matrix, D9, the closed-period guard and the default split of its own date apply. A date in a CLOSED plan's period is stored `SKIPPED` with reason `PeriodClosed` and logged (`recurrence_occurrence_skipped`), and the recurrence goes on (ruling P25). A recurrence whose payer left pauses with `PayerLeft`, one whose creator left with `CreatorLeft`, and one refused for any other reason with that code, at the first refused date (ruling P26). A recurrence's `lastOccurrence` links it to the transaction it recorded (ruling P31).
```

In `docs/backlog/E4-ledger.md`, replace the four lines from `  Scenario: Closed period skips the occurrence` through `    Then no expense is created and the skip is logged with reason "PeriodClosed"` with (M3-B's P17 as amended: a plan closes only once its period has ended, preflight B4):

```gherkin
  Scenario: Closed period skips the occurrence
    Given the scheduler did not run between 2026-12-01 and 2027-01-01
    And the plan for 2026-12 was CLOSED once its period had ended
    When the scheduler runs on 2027-01-02
    Then no expense is created for 2026-12-01 and the skip is logged with reason "PeriodClosed"
    And the "Rent" expense dated 2027-01-01 is recorded
```

In `docs/specs/2026-10-11-hearth-design.md`, replace the line that starts with `**Recurrence** — id, spaceId, template` with:

```markdown
**Recurrence** — id, spaceId, template (transaction type, amount or estimated amount, category, payer SpaceMember or fund, account, and a split by ratios, `EQUAL`, `PERCENT` or `SHARES`, or none, which takes the default split of each occurrence), schedule (same anchor rules as `PeriodPolicy`: MONTHLY(day) or SEMI_MONTHLY(day1, day2), clamped), mode (`AUTO` records the transaction on its date; `CONFIRM` creates a pending occurrence that a member confirms with the real amount or skips), startDate, endDate, pausedAt. Occurrences are idempotent per (recurrenceId, date); missed runs are caught up, from the day the recurrence was defined and never across a pause; occurrences in a CLOSED period are skipped. `BY_ALLOCATION` is resolved with the plan of each occurrence's period. Every AUTO occurrence is recorded on behalf of the member who defined the recurrence, and a pending one on behalf of the member who confirms it, through the same use cases a member calls. Edits apply to future occurrences only; the type, payer and accounts never change. (Amended 2026-10-16, M3-C rulings P21–P24.)
```

- [ ] **Step 4: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add tests/acceptance/recurring-occurrences.test.ts tests/support/recurrences.ts docs/backlog/E4-ledger.md docs/specs/2026-10-11-hearth-design.md
git commit -m "test(ledger): record due occurrences end to end with each period's plan and closed periods (Refs #41)"
```

---

### Task 10: Ledger — confirm and skip pending occurrences

Implements HU-E4-13 (issue #42) at the use-case level: scenarios "A pending occurrence is created instead of an expense", "Confirming records the actual amount" (@critical), "Skipping an occurrence", "Viewers cannot confirm", "Confirming into a closed period is rejected", and the notes on `ConfirmOccurrence`, `SkipOccurrence`, the listing for MEMBER or above and "only the amount (and optionally the date within the same period) can change". Pins Review Focus 2 (a date in the next period), Review Focus 3 (Sofi, D9 for Juan) and Review Focus 4 (82,120 / 123,180 COP).

Decisions:
- **Variable-amount flow (ruling P21):** confirming records the occurrence through the same `recordOccurrence` the scheduler uses, from the recurrence's current template, with the real amount and **the confirming member as requester**: D9 means only the owner of the paying account confirms a debit from it (Juan cannot confirm Ana's Bancolombia electricity: `AccountNotOwned`), while anyone who records money may confirm a fund-paid or guest-paid one (D15). The default split of the occurrence's date applies (`BY_ALLOCATION` with the ACTIVE plan of its period), and a CLOSED period answers `PeriodClosed` (HU-E4-13; ruling P25). The occurrence then becomes RECORDED with the amount and transaction; the transaction is a snapshot like any other.
- The date may move only within the occurrence's period as the space resolves it (`resolvePeriod` with the stored plan periods, D10), else `InvalidOccurrenceDate`; the occurrence keeps its scheduled date as its identity.
- Confirm and skip lock the occurrence row and read it under the lock; only a PENDING occurrence is confirmed or skipped (`OccurrenceNotPending`), so they take turns (raced in Task 12). Skipping records nothing; the recurrence goes on (its next date is already the following one).
- Listing reads with `readOnly` access (archived spaces list them, HU-E1-09) and requires `money.record` (HU-E4-13 note: listed for MEMBER or above); confirming and skipping are `money.record` writes. Pending occurrences of an ended or paused recurrence can still be confirmed or skipped: they were due before it stopped.

**Files:**
- Create: `src/modules/ledger/application/pending-occurrences.ts`
- Modify: `src/modules/ledger/application/index.ts`
- Test: create `src/modules/ledger/application/pending-occurrences.test.ts`

**Interfaces:**
- Consumes: `confirmedOccurrence`, `skippedByMember`, `Occurrence` (Task 2b); `recordOccurrence`, `RecordedOccurrence` (Task 8a); `MaterializeDeps` (Task 8b); `authorizeWriter` (`checks.ts`); `requirePermission` (`spaces`); `resolvePeriod` (kernel); `createGetRecurrence` (Task 5); `materializerWorld`, `rentDefinition` (Tasks 4, 8b).
- Produces:
  - `interface PendingOccurrenceView { occurrence: Occurrence; recurrence: Recurrence }`; `type ListPendingOccurrences = (input: { spaceId; userId }) => Promise<Result<PendingOccurrenceView[]>>`; `createListPendingOccurrences(deps: Pick<RecurrenceDeps, "access" | "recurrences" | "occurrences">)`
  - `interface ConfirmOccurrenceInput { spaceId; userId; occurrenceId; amount: Money; date?: LocalDate }`; `interface ConfirmedOccurrence extends RecordedOccurrence { occurrence: Occurrence }`; `type ConfirmOccurrence = (input) => Promise<Result<ConfirmedOccurrence>>`; `createConfirmOccurrence(deps: MaterializeDeps)` — `OccurrenceNotFound`, `OccurrenceNotPending`, `InvalidOccurrenceDate`, the ledger's codes
  - `type SkipOccurrence = (input: { spaceId; userId; occurrenceId }) => Promise<Result<PendingOccurrenceView>>`; `createSkipOccurrence(deps: RecurrenceDeps)`

- [ ] **Step 1: Write the failing test**

`src/modules/ledger/application/pending-occurrences.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES } from "../../../../tests/support/in-memory-ledger";
import { materializerWorld, rentDefinition, type BudgetingStandIn } from "../../../../tests/support/in-memory-recurrences";
import type { Expense } from "../domain/transaction";
import { createConfirmOccurrence, createListPendingOccurrences, createSkipOccurrence } from "./pending-occurrences";
import { createGetRecurrence } from "./recurrence-queries";

const cop = (pesos: bigint) => money(pesos * 100n);
const day = (iso: string) => iso as LocalDate;
/** Home in the ACTIVE 2026-12 plan: Ana 588,000 and Juan 882,000 COP assigned (40 % / 60 %). */
const home = () => [
  { memberId: "member-ana", weight: 58_800_000n },
  { memberId: "member-juan", weight: 88_200_000n },
];

/**
 * HU-E4-13 Background: CONFIRM "Electricity", estimated at 180,000 COP, paid by Ana from Bancolombia, MONTHLY(10),
 * no split (BY_ALLOCATION by Home); the scheduler ran on 2026-12-10.
 */
const pendingElectricity = async (budgeting: BudgetingStandIn = {}) => {
  const w = materializerWorld({ weights: home, ...budgeting });
  const recurrence = await w.define(
    rentDefinition({
      description: "Electricity",
      amount: cop(180_000n),
      mode: "CONFIRM",
      schedule: { kind: "MONTHLY", day: 10 },
      template: {
        type: "EXPENSE",
        categoryId: CATEGORIES.household.id,
        payer: { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id },
        split: null,
      },
    }),
  );
  await w.run("2026-12-10");
  const occurrence = w.recurrences.occurrenceRows[0]!;
  const ref = (userId = "u-ana") => ({ spaceId: "space-household", userId, occurrenceId: occurrence.id });
  return {
    ...w,
    recurrence,
    occurrence,
    ref,
    list: createListPendingOccurrences(w.deps),
    confirm: createConfirmOccurrence(w.deps),
    skip: createSkipOccurrence(w.deps),
  };
};

describe("pending occurrences (HU-E4-13)", () => {
  it("lists the pending Electricity of 2026-12-10 suggesting 180,000 COP, with no expense recorded", async () => {
    const { list, store, recurrence } = await pendingElectricity();
    const pending = unwrap(await list({ spaceId: "space-household", userId: "u-luis" }));
    expect(pending.map((p) => [p.occurrence.date, p.occurrence.status, p.occurrence.amount, p.recurrence.id])).toEqual([
      ["2026-12-10", "PENDING", 18_000_000n, recurrence.id],
    ]);
    expect(store.rows).toEqual([]);
  });

  it("records the confirmed 205,300 COP split 82,120 / 123,180 COP by Home's allocation (@critical)", async () => {
    const { confirm, ref, store, recurrences } = await pendingElectricity();
    const confirmed = unwrap(await confirm({ ...ref(), amount: cop(205_300n) }));
    const tx = store.rows[0] as Expense;
    expect([tx.description, tx.date, tx.amount, tx.createdBy, tx.shares.map((s) => [s.memberId, s.amount, s.splitMethod])]).toEqual([
      "Electricity",
      "2026-12-10",
      20_530_000n,
      "u-ana",
      [
        ["member-ana", 8_212_000n, "BY_ALLOCATION"],
        ["member-juan", 12_318_000n, "BY_ALLOCATION"],
      ],
    ]);
    expect([confirmed.transaction.id, confirmed.occurrence.status, confirmed.occurrence.amount]).toEqual([
      tx.id,
      "RECORDED",
      20_530_000n,
    ]);
    expect(recurrences.occurrenceRows[0]).toMatchObject({ status: "RECORDED", transactionId: tx.id, resolvedBy: "u-ana" });
  });

  it("skips it: nothing is recorded, and the next occurrence is 2027-01-10", async () => {
    const { skip, ref, store, deps, recurrence } = await pendingElectricity();
    const skipped = unwrap(await skip(ref()));
    expect([skipped.occurrence.status, skipped.occurrence.reason, skipped.occurrence.resolvedBy, store.rows]).toEqual([
      "SKIPPED",
      null,
      "u-ana",
      [],
    ]);
    const read = unwrap(
      await createGetRecurrence(deps)({ spaceId: "space-household", userId: "u-ana", recurrenceId: recurrence.id }),
    );
    expect([read.nextOccurrence, read.lastOccurrence?.status]).toEqual(["2027-01-10", "SKIPPED"]);
  });

  it("refuses VIEWERs: Sofi can neither confirm, skip nor list", async () => {
    const { confirm, skip, list, ref } = await pendingElectricity();
    expect([
      codeOf(await confirm({ ...ref("u-sofi"), amount: cop(205_300n) })),
      codeOf(await skip(ref("u-sofi"))),
      codeOf(await list({ spaceId: "space-household", userId: "u-sofi" })),
    ]).toEqual(["InsufficientRole", "InsufficientRole", "InsufficientRole"]);
  });

  it("refuses to confirm into a period that was CLOSED while the occurrence waited: PeriodClosed (P25)", async () => {
    let closed = false;
    const { confirm, ref, store, recurrences } = await pendingElectricity({ closed: () => closed });
    closed = true;
    expect(codeOf(await confirm({ ...ref(), amount: cop(205_300n) }))).toBe("PeriodClosed");
    expect([store.rows, recurrences.occurrenceRows[0]!.status]).toEqual([[], "PENDING"]);
  });

  it("moves the date only within the occurrence's period: 2027-01-02 is InvalidOccurrenceDate, 2026-12-28 is recorded", async () => {
    const { confirm, ref, store, recurrences } = await pendingElectricity();
    expect(codeOf(await confirm({ ...ref(), amount: cop(205_300n), date: day("2027-01-02") }))).toBe(
      "InvalidOccurrenceDate",
    );
    unwrap(await confirm({ ...ref(), amount: cop(205_300n), date: day("2026-12-28") }));
    expect([store.rows[0]!.date, recurrences.occurrenceRows[0]!.date]).toEqual(["2026-12-28", "2026-12-10"]);
  });

  it("confirms once: a second confirm or a skip answers OccurrenceNotPending", async () => {
    const { confirm, skip, ref, store } = await pendingElectricity();
    unwrap(await confirm({ ...ref(), amount: cop(205_300n) }));
    expect([codeOf(await confirm({ ...ref(), amount: cop(1n) })), codeOf(await skip(ref())), store.rows.length]).toEqual([
      "OccurrenceNotPending",
      "OccurrenceNotPending",
      1,
    ]);
  });

  it("lets only Ana confirm a debit from her Bancolombia account: Juan answers AccountNotOwned (D9)", async () => {
    const { confirm, ref, store } = await pendingElectricity();
    expect([codeOf(await confirm({ ...ref("u-juan"), amount: cop(205_300n) })), store.rows]).toEqual([
      "AccountNotOwned",
      [],
    ]);
  });

  it("answers OccurrenceNotFound for another space's or a malformed occurrence", async () => {
    const { confirm, skip, ref } = await pendingElectricity();
    expect([
      codeOf(await skip({ ...ref(), spaceId: "space-ana" })),
      codeOf(await confirm({ ...ref(), occurrenceId: "not-an-occurrence", amount: cop(1n) })),
    ]).toEqual(["OccurrenceNotFound", "OccurrenceNotFound"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/ledger/application/pending-occurrences.test.ts`
Expected: FAIL — `Failed to resolve import "./pending-occurrences"`.

- [ ] **Step 3: Implement**

`src/modules/ledger/application/pending-occurrences.ts`:

```ts
import { requirePermission, type SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, ok, resolvePeriod, type LocalDate, type Money, type Result } from "@/shared/kernel";
import { confirmedOccurrence, skippedByMember, type Occurrence } from "../domain/occurrence";
import type { Recurrence } from "../domain/recurrence";
import { authorizeWriter } from "./checks";
import type { MaterializeDeps } from "./materialize-recurrence";
import { recordOccurrence, type RecordedOccurrence } from "./record-occurrence";
import type { RecurrenceDeps } from "./recurrence-ports";

/** A pending occurrence with the recurrence it belongs to (its description, type and category). */
export interface PendingOccurrenceView {
  readonly occurrence: Occurrence;
  readonly recurrence: Recurrence;
}

export type ListPendingOccurrences = (input: {
  spaceId: string;
  userId: string;
}) => Promise<Result<PendingOccurrenceView[]>>;

export interface ConfirmOccurrenceInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly occurrenceId: string;
  /** The real amount, in the space currency. */
  readonly amount: Money;
  /** HU-E4-13: another day of the occurrence's period; the occurrence's own date when absent. */
  readonly date?: LocalDate;
}

/** The confirmed occurrence and what recording it gave: the transaction and its warnings. */
export interface ConfirmedOccurrence extends RecordedOccurrence {
  readonly occurrence: Occurrence;
}

export type ConfirmOccurrence = (input: ConfirmOccurrenceInput) => Promise<Result<ConfirmedOccurrence>>;
export type SkipOccurrence = (input: {
  spaceId: string;
  userId: string;
  occurrenceId: string;
}) => Promise<Result<PendingOccurrenceView>>;

/**
 * HU-E4-13: pending occurrences are listed for members who record money (MEMBER or above); an archived space still
 * lists them (HU-E1-09). They are not transactions and never count as spent.
 */
export const createListPendingOccurrences =
  (deps: Pick<RecurrenceDeps, "access" | "recurrences" | "occurrences">): ListPendingOccurrences =>
  async (input) => {
    const membership = await deps.access(input.spaceId, input.userId, { readOnly: true });
    if (!membership.ok) return membership;
    const reader = requirePermission(membership.value, "money.record");
    if (!reader.ok) return reader;
    const spaceId = reader.value.spaceId;
    const recurrences = new Map((await deps.recurrences.list(spaceId)).map((r) => [r.id as string, r]));
    const pending = await deps.occurrences.pendingOccurrences(spaceId);
    return ok(
      pending.flatMap((occurrence) => {
        const recurrence = recurrences.get(occurrence.recurrenceId);
        return recurrence === undefined ? [] : [{ occurrence, recurrence }];
      }),
    );
  };

/** A PENDING occurrence of the space, locked for this transaction and read under the lock, with its recurrence. */
const pendingForWrite = async (
  deps: Pick<RecurrenceDeps, "recurrences" | "occurrences">,
  space: SpaceMembership,
  occurrenceId: string,
): Promise<Result<PendingOccurrenceView>> => {
  const occurrence = await deps.occurrences.findOccurrence(space.spaceId, occurrenceId, { lock: true });
  const recurrence = occurrence === null ? null : await deps.recurrences.find(space.spaceId, occurrence.recurrenceId);
  if (occurrence === null || recurrence === null) return err(domainError("OccurrenceNotFound"));
  return occurrence.status === "PENDING"
    ? ok({ occurrence, recurrence })
    : err(domainError("OccurrenceNotPending", { status: occurrence.status }));
};

/**
 * HU-E4-13 ConfirmOccurrence: records the occurrence with the real amount, and optionally another day of its period,
 * through the use case a member would call, with the confirming member as requester (ruling P21; D9: only the owner
 * of the paying account confirms a debit from it). A CLOSED period answers PeriodClosed (ruling P25).
 */
export const createConfirmOccurrence =
  (deps: MaterializeDeps): ConfirmOccurrence =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeWriter(deps, input.spaceId, input.userId);
      if (!writer.ok) return writer;
      const space = writer.value;
      const pending = await pendingForWrite(deps, space, input.occurrenceId);
      if (!pending.ok) return pending;
      const { occurrence, recurrence } = pending.value;
      const date = input.date ?? occurrence.date;
      const period = resolvePeriod(space.periodPolicy, await deps.storedPeriods(space.spaceId), occurrence.date);
      if (date < period.start || date > period.end) return err(domainError("InvalidOccurrenceDate"));
      const recorded = await recordOccurrence(deps.recorders, recurrence, {
        userId: input.userId,
        date,
        amount: input.amount,
      });
      if (!recorded.ok) return recorded;
      const confirmed = confirmedOccurrence(occurrence, {
        transactionId: recorded.value.transaction.id,
        amount: input.amount.minor,
        userId: input.userId,
        now: deps.clock.now(),
      });
      if (!confirmed.ok) return confirmed;
      await deps.occurrences.saveOccurrence(confirmed.value);
      return ok({ ...recorded.value, occurrence: confirmed.value });
    });

/** HU-E4-13 SkipOccurrence: the occurrence is marked skipped, nothing is recorded, and the recurrence goes on. */
export const createSkipOccurrence =
  (deps: RecurrenceDeps): SkipOccurrence =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeWriter(deps, input.spaceId, input.userId);
      if (!writer.ok) return writer;
      const pending = await pendingForWrite(deps, writer.value, input.occurrenceId);
      if (!pending.ok) return pending;
      const skipped = skippedByMember(pending.value.occurrence, input.userId, deps.clock.now());
      if (!skipped.ok) return skipped;
      await deps.occurrences.saveOccurrence(skipped.value);
      return ok({ occurrence: skipped.value, recurrence: pending.value.recurrence });
    });
```

Append to `src/modules/ledger/application/index.ts`:

```ts
export {
  createConfirmOccurrence,
  createListPendingOccurrences,
  createSkipOccurrence,
  type ConfirmedOccurrence,
  type ConfirmOccurrence,
  type ConfirmOccurrenceInput,
  type ListPendingOccurrences,
  type PendingOccurrenceView,
  type SkipOccurrence,
} from "./pending-occurrences";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project unit src/modules/ledger`
Expected: PASS. Mutation check: in `createConfirmOccurrence`, temporarily pass `userId: recurrence.createdBy` to `recordOccurrence` — "lets only Ana confirm a debit from her Bancolombia account" fails with `ok` for Juan; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/application/pending-occurrences.ts src/modules/ledger/application/pending-occurrences.test.ts src/modules/ledger/application/index.ts
git commit -m "feat(ledger): confirm pending occurrences with the real amount or skip them (Refs #42)"
```

---

### Task 11a: HTTP — list and skip pending occurrences

Implements HU-E4-13's `GET /api/v1/spaces/{spaceId}/pending-occurrences` and `POST …/pending-occurrences/{occurrenceId}/skip` (issue #42) with the scenarios "A pending occurrence is created instead of an expense" (Home's spent unchanged, over HTTP), "Skipping an occurrence" and the VIEWER refusal. Pins Review Focus 5 (another space's and malformed occurrences, an archived space).

Decisions:
- The list answers `{ items: Occurrence[] }`, earliest date first, not paginated (ruling P28); a skip answers `200` with the occurrence, now `SKIPPED` with no reason.
- An archived space lists its pending occurrences and refuses a skip (`409 SpaceArchived`).
- The container runs on a `MovableClock` at the definition day (2026-10-28), reset after each test, so Task 11b's closed-period test can move it past 2026-12 before it closes that plan (M3-B's P17 as amended, preflight B5).

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/pending-occurrences/route.ts`, `src/app/api/v1/spaces/[spaceId]/pending-occurrences/[occurrenceId]/skip/route.ts`, `tests/acceptance/pending-occurrences.test.ts`
- Modify: `src/modules/ledger/contracts/recurrences.contract.ts`, `src/composition/container.ts`, `src/composition/openapi.ts`, `openapi/openapi.snapshot.json`, `tests/support/recurrences.ts`
- Test: `src/shared/http/problem.test.ts`, `src/composition/openapi.test.ts`

**Interfaces:**
- Consumes: `createListPendingOccurrences`, `createSkipOccurrence` and their types (Task 10); `OccurrenceSchema`, `occurrenceDto` (Task 6c), registered here as the `Occurrence` component (preflight N1); `MovableClock` (Task 4); `homePlan`, `transactionsIn` (Task 9b); `planOf`, `lineNamed` (`tests/support/budgeting.ts`); `materializeDueOccurrences` (Task 9a).
- Produces: `PendingOccurrenceListSchema`; component `Occurrence`; `Container.ledger.listPendingOccurrences`, `.skipOccurrence`; `pendingIn(user, spaceId)`, `pendingOf(user, spaceId): Promise<OccurrenceDto[]>`, `skipOccurrence(user, spaceId, occurrenceId)` in `tests/support/recurrences.ts`.

- [ ] **Step 1: Write the failing tests**

In `src/shared/http/problem.test.ts`, insert after the line `    ["InvalidRecurrence", 422],` (added in Task 7b):

```ts
    ["OccurrenceNotFound", 404],
    ["OccurrenceNotPending", 409],
    ["InvalidOccurrenceDate", 422],
```

In `src/composition/openapi.test.ts`, replace the line `    expect(names).toEqual(expect.arrayContaining(["RecurrenceDefinition", "Recurrence"]));` with:

```ts
    expect(names).toEqual(expect.arrayContaining(["RecurrenceDefinition", "Recurrence", "Occurrence"]));
```

In `tests/support/recurrences.ts`:

1. Insert after the line `import { POST as archiveSpaceRoute } from "@/app/api/v1/spaces/[spaceId]/archive/route";`:

```ts
import { GET as pendingRoute } from "@/app/api/v1/spaces/[spaceId]/pending-occurrences/route";
import { POST as skipRoute } from "@/app/api/v1/spaces/[spaceId]/pending-occurrences/[occurrenceId]/skip/route";
```

2. Append to the end of the file:

```ts

const pendingPath = (spaceId: string, rest = "") => `/api/v1/spaces/${spaceId}/pending-occurrences${rest}`;

/** HU-E4-13: the space's pending occurrences as `user` lists them. */
export const pendingIn = (user: TestUser, spaceId: string) =>
  call(pendingRoute, "GET", pendingPath(spaceId), { user, params: { spaceId } });

export const pendingOf = async (user: TestUser, spaceId: string): Promise<OccurrenceDto[]> => {
  const response = await pendingIn(user, spaceId);
  if (response.status !== 200) throw new Error(`pending list failed with status ${response.status}`);
  return ((await response.json()) as { items: OccurrenceDto[] }).items;
};

/** HU-E4-13: `user` skips the pending occurrence. */
export const skipOccurrence = (user: TestUser, spaceId: string, occurrenceId: string) =>
  call(skipRoute, "POST", pendingPath(spaceId, `/${occurrenceId}/skip`), { user, params: { spaceId, occurrenceId } });
```

`tests/acceptance/pending-occurrences.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setContainerForTests, type Container } from "@/composition/container";
import type { LocalDate } from "@/shared/kernel";
import { problemOf, startTestApp } from "../support/app";
import { lineNamed, planOf } from "../support/budgeting";
import { MovableClock } from "../support/in-memory-recurrences";
import { cop, joinHousehold } from "../support/ledger";
import {
  archiveHousehold,
  defined,
  homePlan,
  householdWithFund,
  pendingIn,
  pendingOf,
  recurrenceOf,
  skipOccurrence,
  transactionsIn,
  type OccurrenceDto,
} from "../support/recurrences";

let app: Container;
/** The definition day, 2026-10-28 at noon in Bogota; a test that closes a plan moves it past the period (P17 amended). */
const clock = new MovableClock("2026-10-28");
beforeAll(() => {
  app = startTestApp({ clock });
});
afterEach(() => clock.set("2026-10-28"));
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/**
 * HU-E4-13 Background: CONFIRM "Electricity", estimated at 180,000 COP in Utilities, paid by Ana from Bancolombia,
 * MONTHLY(10), no split; Home (Utilities) 40 % / 60 % in the ACTIVE 2026-12 plan; the scheduler ran on 2026-12-10.
 */
const pendingElectricity = async () => {
  const h = await householdWithFund();
  const planId = await homePlan(h, "2026-12");
  const electricity = await defined(h.ana, h.spaceId, {
    description: "Electricity",
    amount: cop(180_000),
    template: { type: "EXPENSE", categoryId: h.utilities, payer: { memberId: h.ana.memberId, accountId: h.ana.account } },
    schedule: { kind: "MONTHLY", day: 10 },
    mode: "CONFIRM",
    startDate: "2026-12-01",
  });
  await app.ledger.materializeDueOccurrences({ today: "2026-12-10" as LocalDate });
  const [pending] = await pendingOf(h.ana, h.spaceId);
  return { h, planId, electricity, pending: pending! };
};
const expensesIn = async (h: Awaited<ReturnType<typeof pendingElectricity>>["h"], period: string) =>
  (await transactionsIn(h.ana, h.spaceId, period)).filter((t) => t.type === "EXPENSE");

describe("pending occurrences (HU-E4-13)", () => {
  it("creates a pending occurrence instead of an expense: Electricity of 2026-12-10 suggests 180,000 COP", async () => {
    const { h, planId, electricity, pending } = await pendingElectricity();
    expect(pending).toMatchObject({
      recurrenceId: electricity.id,
      type: "EXPENSE",
      description: "Electricity",
      date: "2026-12-10",
      status: "PENDING",
      amount: cop(180_000),
      categoryId: h.utilities,
      transactionId: null,
      reason: null,
    });
    expect(await expensesIn(h, "2026-12")).toEqual([]);
    expect(lineNamed(await planOf(h.ana, h.spaceId, planId), "Home").spent).toEqual(cop(0));
  });

  it("skips it: marked skipped, nothing recorded, and the next occurrence is 2027-01-10", async () => {
    const { h, electricity, pending } = await pendingElectricity();
    const response = await skipOccurrence(h.ana, h.spaceId, pending.id);
    expect(response.status).toBe(200);
    expect((await response.json()) as OccurrenceDto).toMatchObject({ id: pending.id, status: "SKIPPED", reason: null });
    expect([await pendingOf(h.ana, h.spaceId), await expensesIn(h, "2026-12")]).toEqual([[], []]);
    expect((await recurrenceOf(h.ana, h.spaceId, electricity.id)).nextOccurrence).toBe("2027-01-10");
  });

  it("refuses VIEWERs: Sofi gets 403 InsufficientRole on the list and on a skip", async () => {
    const { h, pending } = await pendingElectricity();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    expect([
      await problemOf(await pendingIn(sofi, h.spaceId)),
      await problemOf(await skipOccurrence(sofi, h.spaceId, pending.id)),
    ]).toEqual([
      [403, "InsufficientRole"],
      [403, "InsufficientRole"],
    ]);
  });

  it("answers 404 OccurrenceNotFound for another space's or a malformed occurrence, and 409 to a second skip", async () => {
    const { h, pending } = await pendingElectricity();
    const other = await householdWithFund();
    expect(await problemOf(await skipOccurrence(other.ana, other.spaceId, pending.id))).toEqual([
      404,
      "OccurrenceNotFound",
    ]);
    expect(await problemOf(await skipOccurrence(h.ana, h.spaceId, "not-a-uuid"))).toEqual([404, "OccurrenceNotFound"]);
    expect((await skipOccurrence(h.ana, h.spaceId, pending.id)).status).toBe(200);
    expect(await problemOf(await skipOccurrence(h.ana, h.spaceId, pending.id))).toEqual([409, "OccurrenceNotPending"]);
  });

  it("still lists the pending occurrences of an archived space, and refuses to skip them there (HU-E1-09)", async () => {
    const { h, pending } = await pendingElectricity();
    await archiveHousehold(h);
    expect((await pendingOf(h.ana, h.spaceId)).map((o) => o.id)).toEqual([pending.id]);
    expect(await problemOf(await skipOccurrence(h.ana, h.spaceId, pending.id))).toEqual([409, "SpaceArchived"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/pending-occurrences.test.ts`, then `pnpm exec vitest run --project unit src/composition/openapi.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/pending-occurrences/route"`; `Occurrence` is not among the component names.

- [ ] **Step 3: Implement**

In `src/modules/ledger/contracts/recurrences.contract.ts`:

1. Insert before the line `/** The Location header of a new recurrence (HU-E4-11). */`:

```ts
/** HU-E4-13: the space's pending occurrences, earliest date first (not paginated, ruling P28). */
export const PendingOccurrenceListSchema = z.object({ items: z.array(OccurrenceSchema) });

```

2. Insert after the line `const RecurrencePath = SpacePath.extend({ recurrenceId: z.string() });`:

```ts
const OccurrencePath = SpacePath.extend({ occurrenceId: z.string() });
```

3. Insert before the last line of the file (`};`):

```ts
  "/api/v1/spaces/{spaceId}/pending-occurrences": {
    get: {
      operationId: "listPendingOccurrences",
      summary: "Occurrences of CONFIRM recurrences waiting for the real amount; listed for members who record money",
      ...securedByUser,
      requestParams: { path: SpacePath },
      responses: {
        "200": { description: "Pending occurrences, earliest first", content: jsonContent(PendingOccurrenceListSchema) },
        ...problems({ "401": "Unauthenticated", "403": "InsufficientRole", "404": "SpaceNotFound" }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/pending-occurrences/{occurrenceId}/skip": {
    post: {
      operationId: "skipOccurrence",
      summary: "Skip a pending occurrence: nothing is recorded and the recurrence goes on",
      ...securedByUser,
      requestParams: { path: OccurrencePath },
      responses: {
        "200": { description: "The occurrence, now SKIPPED", content: jsonContent(OccurrenceSchema) },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound, OccurrenceNotFound",
          "409": "OccurrenceNotPending, SpaceArchived",
        }),
      },
    },
  },
```

`src/app/api/v1/spaces/[spaceId]/pending-occurrences/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { occurrenceDto } from "@/modules/ledger/contracts/recurrences.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().ledger.listPendingOccurrences({ spaceId: params.spaceId!, userId: user!.id });
    return result.ok
      ? ok({
          status: 200,
          body: { items: result.value.map((view) => occurrenceDto(view.occurrence, view.recurrence)) },
        })
      : result;
  },
});
```

`src/app/api/v1/spaces/[spaceId]/pending-occurrences/[occurrenceId]/skip/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { occurrenceDto } from "@/modules/ledger/contracts/recurrences.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().ledger.skipOccurrence({
      spaceId: params.spaceId!,
      userId: user!.id,
      occurrenceId: params.occurrenceId!,
    });
    return result.ok
      ? ok({ status: 200, body: occurrenceDto(result.value.occurrence, result.value.recurrence) })
      : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert before the line `  type DeleteTransaction,`:

```ts
  createListPendingOccurrences,
  createSkipOccurrence,
  type ListPendingOccurrences,
  type SkipOccurrence,
```

2. Insert after the line `    readonly materializeDueOccurrences: MaterializeDueOccurrences;`:

```ts
    readonly listPendingOccurrences: ListPendingOccurrences;
    readonly skipOccurrence: SkipOccurrence;
```

3. Insert after the line `      materializeDueOccurrences: createMaterializeDueOccurrences(materializeDeps),`:

```ts
      listPendingOccurrences: createListPendingOccurrences(recurrenceDeps),
      skipOccurrence: createSkipOccurrence(recurrenceDeps),
```

In `src/composition/openapi.ts` (preflight N1: `Occurrence` is registered with its first operations, at its final place):

1. Insert before the line `  RecurrenceSchema,` (inside the `recurrences.contract` import, Task 6e2):

```ts
  OccurrenceSchema,
```

2. Insert after the line `        Recurrence: RecurrenceSchema,`:

```ts
        Occurrence: OccurrenceSchema,
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds `components.schemas.Occurrence` (about 70 lines) at its final place, and `GET /api/v1/spaces/{spaceId}/pending-occurrences` and `POST …/pending-occurrences/{occurrenceId}/skip` (about 160 lines together), both referencing `Occurrence` (+232/−0 in all, measured); it moves no component and changes no other operation.
Then run: `pnpm exec vitest run --project unit src/shared/http && pnpm exec vitest run --project acceptance tests/acceptance/pending-occurrences.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/v1/spaces/[spaceId]/pending-occurrences/route.ts" "src/app/api/v1/spaces/[spaceId]/pending-occurrences/[occurrenceId]/skip/route.ts" src/modules/ledger/contracts/recurrences.contract.ts src/composition/container.ts src/composition/openapi.ts src/composition/openapi.test.ts openapi/openapi.snapshot.json src/shared/http/problem.test.ts tests/support/recurrences.ts tests/acceptance/pending-occurrences.test.ts
git commit -m "feat(ledger): list and skip pending occurrences over HTTP (Refs #42)"
```

---

### Task 11b: HTTP — confirm a pending occurrence

Implements HU-E4-13's `POST /api/v1/spaces/{spaceId}/pending-occurrences/{occurrenceId}/confirm` (issue #42) with "Confirming records the actual amount" (@critical) and "Confirming into a closed period is rejected" over HTTP. Pins Review Focus 2 (a date in the next period), Review Focus 3 (D9 for Juan) and Review Focus 4 (82,120 / 123,180 COP).

Decisions:
- The body is `{ amount, date? }`. The answer is `201` with the recorded transaction and its warnings, the `RecordedExpense` shape for every type (`warnings` is empty unless an expense paid from the fund leaves it negative, HU-E4-10), with the transaction's `ETag` and `Location`.
- It honours `Idempotency-Key` (spec 7: a POST that creates a transaction).

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/pending-occurrences/[occurrenceId]/confirm/route.ts`
- Modify: `src/modules/ledger/contracts/recurrences.contract.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E4-ledger.md`, `tests/support/recurrences.ts`
- Test: `tests/acceptance/pending-occurrences.test.ts`

**Interfaces:**
- Consumes: `createConfirmOccurrence`, `ConfirmOccurrence`, `ConfirmedOccurrence` (Task 10); `materializeDeps` (container, Task 9a); `RecordedExpenseSchema`, `transactionDto`, `transactionHeaders` (`ledger.contract.ts`); `closePlan` (`tests/support/budgeting.ts`, M3-B Task 5b).
- Produces: `ConfirmOccurrenceBodySchema`, `confirmationFromBody(body)`, `recordedOccurrenceDto(confirmed)`; `Container.ledger.confirmOccurrence: ConfirmOccurrence`; `confirmOccurrence(user, spaceId, occurrenceId, body, headers?)` in `tests/support/recurrences.ts`.

- [ ] **Step 1: Write the failing tests**

In `tests/support/recurrences.ts`:

1. Insert after the line `import { POST as skipRoute } from "@/app/api/v1/spaces/[spaceId]/pending-occurrences/[occurrenceId]/skip/route";`:

```ts
import { POST as confirmRoute } from "@/app/api/v1/spaces/[spaceId]/pending-occurrences/[occurrenceId]/confirm/route";
```

2. Append to the end of the file:

```ts

/** HU-E4-13: `user` confirms the pending occurrence with `body` (`{ amount, date? }`). */
export const confirmOccurrence = (
  user: TestUser,
  spaceId: string,
  occurrenceId: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  call(confirmRoute, "POST", pendingPath(spaceId, `/${occurrenceId}/confirm`), {
    user,
    params: { spaceId, occurrenceId },
    body,
    headers,
  });
```

In `tests/acceptance/pending-occurrences.test.ts`:

1. Replace the two lines `import { lineNamed, planOf } from "../support/budgeting";` and `import { MovableClock } from "../support/in-memory-recurrences";` that follows it (Task 11a) with:

```ts
import { closePlan, lineNamed, planOf } from "../support/budgeting";
import { MovableClock } from "../support/in-memory-recurrences";
import type { TransactionDto } from "../support/ledger";
```

2. Replace the line `  archiveHousehold,` (inside the `../support/recurrences` import) with:

```ts
  archiveHousehold,
  confirmOccurrence,
```

3. Append to the end of the file:

```ts

describe("confirming a pending occurrence (HU-E4-13)", () => {
  const sharesOf = (tx: TransactionDto) => tx.shares.map((s) => [s.memberId, s.amount, s.splitMethod]);

  it("records the actual 205,300 COP split 82,120 / 123,180 COP by Home's allocation (@critical)", async () => {
    const { h, pending } = await pendingElectricity();
    const response = await confirmOccurrence(h.ana, h.spaceId, pending.id, { amount: cop(205_300) });
    expect(response.status).toBe(201);
    const tx = (await response.json()) as TransactionDto & { warnings: unknown[] };
    expect([tx.description, tx.date, tx.amount, sharesOf(tx), tx.warnings]).toEqual([
      "Electricity",
      "2026-12-10",
      cop(205_300),
      [
        [h.ana.memberId, cop(82_120), "BY_ALLOCATION"],
        [h.juan.memberId, cop(123_180), "BY_ALLOCATION"],
      ],
      [],
    ]);
    expect(response.headers.get("location")).toBe(`/api/v1/spaces/${h.spaceId}/transactions/${tx.id}`);
    expect([await pendingOf(h.ana, h.spaceId), (await expensesIn(h, "2026-12")).map((t) => t.id)]).toEqual([[], [tx.id]]);
  });

  it("refuses to confirm into the 2026-12 plan once it was CLOSED while the occurrence waited: 409 PeriodClosed", async () => {
    const { h, planId, pending } = await pendingElectricity();
    // The plan closes only once its period has ended (P17 amended); the occurrence is still pending then.
    clock.set("2027-01-02");
    expect((await closePlan(h.ana, h.spaceId, planId)).status).toBe(200);
    expect(await problemOf(await confirmOccurrence(h.ana, h.spaceId, pending.id, { amount: cop(205_300) }))).toEqual([
      409,
      "PeriodClosed",
    ]);
    expect((await pendingOf(h.ana, h.spaceId)).map((o) => o.status)).toEqual(["PENDING"]);
  });

  it("refuses Sofi the VIEWER (403) and Juan, for a debit from Ana's account (422 AccountNotOwned, D9)", async () => {
    const { h, pending } = await pendingElectricity();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    expect([
      await problemOf(await confirmOccurrence(sofi, h.spaceId, pending.id, { amount: cop(205_300) })),
      await problemOf(await confirmOccurrence(h.juan, h.spaceId, pending.id, { amount: cop(205_300) })),
    ]).toEqual([
      [403, "InsufficientRole"],
      [422, "AccountNotOwned"],
    ]);
  });

  it("moves the date only within the occurrence's period: 2027-01-02 is 422 InvalidOccurrenceDate, 2026-12-28 is recorded", async () => {
    const { h, pending } = await pendingElectricity();
    expect(
      await problemOf(await confirmOccurrence(h.ana, h.spaceId, pending.id, { amount: cop(205_300), date: "2027-01-02" })),
    ).toEqual([422, "InvalidOccurrenceDate"]);
    const response = await confirmOccurrence(h.ana, h.spaceId, pending.id, { amount: cop(205_300), date: "2026-12-28" });
    expect([response.status, ((await response.json()) as TransactionDto).date]).toEqual([201, "2026-12-28"]);
  });

  it("replays an Idempotency-Key with the first answer, recording one expense (spec 7)", async () => {
    const { h, pending } = await pendingElectricity();
    const key = { "idempotency-key": "electricity-2026-12" };
    const first = await confirmOccurrence(h.ana, h.spaceId, pending.id, { amount: cop(205_300) }, key);
    const replay = await confirmOccurrence(h.ana, h.spaceId, pending.id, { amount: cop(205_300) }, key);
    expect([first.status, replay.status, ((await replay.json()) as TransactionDto).id]).toEqual([
      201,
      201,
      ((await first.json()) as TransactionDto).id,
    ]);
    expect(await expensesIn(h, "2026-12")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/pending-occurrences.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/pending-occurrences/[occurrenceId]/confirm/route"`.

- [ ] **Step 3: Implement**

In `src/modules/ledger/contracts/recurrences.contract.ts`:

1. Replace the line `import { localDate, ok, type Result } from "@/shared/kernel";` with:

```ts
import { localDate, ok, type LocalDate, type Money, type Result } from "@/shared/kernel";
```

2. Insert after the line `  DefineRecurrenceInput,` (inside the `../application` type import):

```ts
  ConfirmedOccurrence,
```

3. Insert after the block that ends with the line `} from "../application";`:

```ts
import { RecordedExpenseSchema, transactionDto } from "./ledger.contract";
```

4. Insert before the line `/** The Location header of a new recurrence (HU-E4-11). */`:

```ts
/** HU-E4-13: the real amount, and optionally another day of the occurrence's period. */
export const ConfirmOccurrenceBodySchema = z.object({
  amount: MoneySchema,
  date: z.iso.date().optional(),
});

/** A validated confirmation; fails only for impossible dates and currencies the kernel does not know. */
export const confirmationFromBody = (
  body: z.infer<typeof ConfirmOccurrenceBodySchema>,
): Result<{ amount: Money; date?: LocalDate }> => {
  const amount = moneyFromDto(body.amount);
  if (!amount.ok) return amount;
  if (body.date === undefined) return ok({ amount: amount.value });
  const date = localDate(body.date);
  return date.ok ? ok({ amount: amount.value, date: date.value }) : date;
};

/** The confirmation's answer: the recorded transaction and its warnings, as a recorded expense answers (HU-E4-10). */
export const recordedOccurrenceDto = (
  confirmed: ConfirmedOccurrence,
): z.infer<typeof RecordedExpenseSchema> => ({
  ...transactionDto(confirmed.transaction),
  warnings: confirmed.warnings.map((warning) => ({
    code: warning.code,
    accountId: warning.accountId,
    balance: { amount: warning.balance.toString(), currency: confirmed.transaction.currency },
  })),
});

```

5. Insert before the last line of the file (`};`):

```ts
  "/api/v1/spaces/{spaceId}/pending-occurrences/{occurrenceId}/confirm": {
    post: {
      operationId: "confirmOccurrence",
      summary: "Record a pending occurrence with the real amount, and optionally another day of its period",
      ...securedByUser,
      requestParams: { path: OccurrencePath, header: IdempotencyHeader },
      requestBody: { content: jsonContent(ConfirmOccurrenceBodySchema) },
      responses: {
        "201": {
          description: "The recorded transaction and its warnings; ETag carries its version",
          content: jsonContent(RecordedExpenseSchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": `SpaceNotFound, OccurrenceNotFound, ${TEMPLATE_404}`,
          "409": `OccurrenceNotPending, PeriodClosed, ${TEMPLATE_409}, SpaceArchived, IdempotencyKeyConflict`,
          "422": `ValidationFailed, InvalidAmount, InvalidDate, InvalidOccurrenceDate, CurrencyMismatch, UnknownCurrency, InvalidIdempotencyKey, ${TEMPLATE_422}`,
        }),
      },
    },
  },
```

`src/app/api/v1/spaces/[spaceId]/pending-occurrences/[occurrenceId]/confirm/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import { transactionHeaders } from "@/modules/ledger/contracts/ledger.contract";
import {
  ConfirmOccurrenceBodySchema,
  confirmationFromBody,
  recordedOccurrenceDto,
} from "@/modules/ledger/contracts/recurrences.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: ConfirmOccurrenceBodySchema,
  before: withIdempotency,
  handler: async ({ user, params, body }) => {
    const confirmation = confirmationFromBody(body);
    if (!confirmation.ok) return confirmation;
    const result = await getContainer().ledger.confirmOccurrence({
      spaceId: params.spaceId!,
      userId: user!.id,
      occurrenceId: params.occurrenceId!,
      ...confirmation.value,
    });
    return result.ok
      ? ok({
          status: 201,
          body: recordedOccurrenceDto(result.value),
          headers: transactionHeaders(result.value.transaction),
        })
      : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert before the line `  type DeleteTransaction,`:

```ts
  createConfirmOccurrence,
  type ConfirmOccurrence,
```

2. Insert after the line `    readonly skipOccurrence: SkipOccurrence;`:

```ts
    readonly confirmOccurrence: ConfirmOccurrence;
```

3. Insert after the line `      skipOccurrence: createSkipOccurrence(recurrenceDeps),`:

```ts
      confirmOccurrence: createConfirmOccurrence(materializeDeps),
```

In `docs/backlog/E4-ledger.md`, insert after the line ``- Confirming reuses the recurrence template; only the amount (and optionally the date within the same period) can change.``:

```markdown
- `GET …/pending-occurrences` lists the space's PENDING occurrences, earliest first, for members with `money.record` (archived spaces included). `POST …/confirm` (honours `Idempotency-Key`) takes `{ amount, date? }`, records the occurrence through the use case a member would call, with the confirming member as requester (M3-C ruling P21: D9 means only the owner of the paying account confirms a debit from it), the recurrence's current template and the default split of its date, and answers `201` with the transaction and its `warnings`; the date may move only within the occurrence's period (`InvalidOccurrenceDate`, 422), and a CLOSED period answers `PeriodClosed` (409, ruling P25). `POST …/skip` marks it `SKIPPED` with no reason and records nothing. Only a PENDING occurrence is confirmed or skipped (`OccurrenceNotPending`, 409); a confirm and a skip of one occurrence take turns on its row. New codes: `OccurrenceNotFound` (404), `OccurrenceNotPending` (409), `InvalidOccurrenceDate` (422).
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds `POST …/pending-occurrences/{occurrenceId}/confirm` (about 130 lines, its 201 a `$ref` to `RecordedExpense`) and changes no component and no other operation.
Then run: `pnpm exec vitest run --project acceptance tests/acceptance/pending-occurrences.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/v1/spaces/[spaceId]/pending-occurrences/[occurrenceId]/confirm/route.ts" src/modules/ledger/contracts/recurrences.contract.ts src/composition/container.ts openapi/openapi.snapshot.json docs/backlog/E4-ledger.md tests/support/recurrences.ts tests/acceptance/pending-occurrences.test.ts
git commit -m "feat(ledger): confirm a pending occurrence with the real amount over HTTP (Refs #42)"
```

---

### Task 12: Ledger — recurrence races against PostgreSQL

Pins Review Focus 1 for HU-E4-12 and HU-E4-13 (issues #41, #42) with three rendezvous tests; each is red when the lock it pins is removed (inferred from PostgreSQL's row-lock conflict table: `FOR NO KEY UPDATE` conflicts with itself and with the lock an `UPDATE` takes; the `KEY SHARE` an inserted occurrence takes on its recurrence conflicts with neither).

Decisions:
- `tests/support/locks.ts` holds the rendezvous helpers (`until`, `someoneWaitsFor`, `holder`, `outcomesOf`), the same as M3-B Task 8's in `concurrent-plan-writes.int.test.ts`, parameterized by the transaction manager and pool; moving the budgeting file onto them is a follow-up, not part of this task.
- The three races: (1) two runs of the job at once record the Rent once and report no failure — the second waits for the first's row lock and then sees the `dueFrom` it committed (red when `lockForWrite` drops `FOR NO KEY UPDATE`: the second run no longer waits and commits first, so the held first run collides on `recurrence_occurrences_date_uq` and reports a failure); (2) a run queued behind a pause in progress sees the committed pause and records nothing (red without the lock: the run records the Rent and its save overwrites the pause); (3) a confirm and a skip of one pending occurrence take turns, the second answering `OccurrenceNotPending` (red when `findOccurrence` ignores `lock`: both answer `ok` and the skip overwrites the confirmed occurrence).
- Integration files share one database and run in parallel, so each test's scheduler sees only its own recurrence (`listActive` filtered).

**Files:**
- Create: `tests/support/locks.ts`, `src/modules/ledger/infrastructure/concurrent-occurrences.int.test.ts`

**Interfaces:**
- Consumes: `DrizzleRecurrenceRepository` (Tasks 3b, 3c); `createDefineRecurrence` (Task 4); `createPauseRecurrence` (Task 5); `occurrenceRecorders`, `OccurrenceRecorders` (Task 8a); `createMaterializeDueOccurrences`, `MaterializeDeps` (Task 8b); `createConfirmOccurrence`, `createSkipOccurrence` (Task 10); `sharedLedgerFixture` (`tests/support/fixtures.ts`); the ledger's Drizzle adapters.
- Produces: `until(what, condition)`, `someoneWaitsFor(pool, pid)`, `holder(tm, pool): { held; hold(); release() }`, `outcomesOf(...writers): Promise<string[]>` in `tests/support/locks.ts`.

- [ ] **Step 1: Write the tests**

`tests/support/locks.ts`:

```ts
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { Result } from "@/shared/kernel";
import { codeOf } from "./fakes";

/**
 * Polls `condition` every 20 ms and throws "gave up waiting for <what>" after 500 polls (about 10 s plus the time the
 * checks take): a bound for a hung test, never a delay a passing test waits for.
 */
export const until = async (what: string, condition: () => Promise<boolean> | boolean): Promise<void> => {
  for (let tries = 0; tries < 500; tries++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`gave up waiting for ${what}`);
};

/** Whether some backend is waiting for a lock that backend `pid` holds. */
export const someoneWaitsFor = async (pool: Pool, pid: number): Promise<boolean> => {
  const { rows } = await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [pid]);
  return rows.length > 0;
};

/**
 * A transaction that stops in `hold()` until another backend queues behind a lock it holds, or until `release()` says
 * the other side finished without queueing; `held` resolves once it stopped there. Both ends are observed events.
 */
export const holder = (tm: DrizzleTransactionManager, pool: Pool) => {
  let released = false;
  let stopped: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    stopped = resolve;
  });
  const hold = async () => {
    const { rows } = await tm.executor().execute(sql`SELECT pg_backend_pid() AS pid`);
    const pid = Number(rows[0]?.pid);
    stopped();
    await until(
      `another backend to queue behind backend ${pid}, or the other side to finish`,
      async () => released || (await someoneWaitsFor(pool, pid)),
    );
  };
  const release = () => {
    released = true;
  };
  return { held, hold, release };
};

/** What a writer that failed reports: the database's own message when there is one, so it reads in the diff. */
const failure = (reason: unknown) => {
  const cause = reason instanceof Error && reason.cause instanceof Error ? reason.cause : reason;
  return `rejected: ${cause instanceof Error ? cause.message : String(cause)}`;
};

/** Lets every writer run to the end; the sorted outcomes are error codes, "ok", or "rejected: <message>". */
export const outcomesOf = async (...writers: Promise<Result<unknown>>[]): Promise<string[]> =>
  (await Promise.allSettled(writers))
    .map((writer) => (writer.status === "fulfilled" ? codeOf(writer.value) : failure(writer.reason)))
    .sort();
```

`src/modules/ledger/infrastructure/concurrent-occurrences.int.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleAccountRepository } from "@/modules/accounts/infrastructure/drizzle-account-repository";
import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";
import { createSpaceAccess } from "@/modules/spaces/application";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { FixedClock, Money, type LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { sharedLedgerFixture, type SharedLedgerFixture } from "../../../../tests/support/fixtures";
import { holder, outcomesOf } from "../../../../tests/support/locks";
import { createDefineRecurrence, type DefineRecurrenceInput } from "../application/define-recurrence";
import type { LedgerDeps } from "../application/deps";
import { createPauseRecurrence } from "../application/manage-recurrence";
import { createMaterializeDueOccurrences } from "../application/materialize-occurrences";
import type { MaterializeDeps } from "../application/materialize-recurrence";
import { createConfirmOccurrence, createSkipOccurrence } from "../application/pending-occurrences";
import { occurrenceRecorders, type OccurrenceRecorders } from "../application/record-occurrence";
import type { OccurrenceRepository, RecurrenceRepository } from "../application/recurrence-ports";
import { DrizzleAuditLog } from "./drizzle-audit-log";
import { DrizzleLedgerQueries } from "./drizzle-ledger-queries";
import { DrizzleRecurrenceRepository } from "./drizzle-recurrence-repository";
import { DrizzleTransactionRepository } from "./drizzle-transaction-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleRecurrenceRepository(tm);
const spaces = new DrizzleSpaceRepository(tm);
const accounts = new DrizzleAccountRepository(tm);
const categories = new DrizzleCategoryRepository(tm);

afterAll(() => pool.end());

const day = (iso: string) => iso as LocalDate;

/** The ledger's deps over PostgreSQL as the composition root builds them, with no plan: every period open, EQUAL. */
const ledgerDeps = (): LedgerDeps => ({
  access: createSpaceAccess(spaces),
  members: spaces,
  transactions: new DrizzleTransactionRepository(tm),
  query: new DrizzleLedgerQueries(tm),
  audit: new DrizzleAuditLog(tm),
  accounts: {
    find: async (accountId) => {
      const account = await accounts.findById(accountId);
      return account
        ? {
            id: account.id,
            spaceId: account.spaceId,
            ownerUserId: account.ownerUserId,
            isSharedFund: account.type === "SHARED_FUND",
            archived: account.archivedAt !== null,
          }
        : null;
    },
  },
  accountBalances: { balanceOf: async () => 0n },
  categories: {
    find: async (spaceId, categoryId) => {
      const category = (await categories.listCategories(spaceId)).find((c) => c.id === categoryId);
      return category ? { id: category.id, archived: category.archivedAt !== null } : null;
    },
  },
  closedPeriods: { isClosed: async () => false },
  defaultSplits: { allocationWeights: async () => null },
  storedPeriods: async () => [],
  ids: new UuidV7IdGenerator(),
  clock: new FixedClock(new Date("2026-10-28T17:00:00Z")),
  timeZone: "America/Bogota",
  tm,
});

/**
 * The deps of the recurrence use cases over PostgreSQL. The scheduler sees only `recurrenceId` (other files share the
 * database); `recurrences`, `occurrences` and `recorders` replace what a test intercepts.
 */
const deps = (
  scope: {
    readonly recurrenceId?: string;
    readonly recurrences?: Partial<RecurrenceRepository>;
    readonly occurrences?: Partial<OccurrenceRepository>;
    readonly recorders?: (recorders: OccurrenceRecorders) => OccurrenceRecorders;
  } = {},
): MaterializeDeps => {
  const ledger = ledgerDeps();
  const recurrences: RecurrenceRepository = {
    add: (r) => repo.add(r),
    find: (spaceId, id) => repo.find(spaceId, id),
    list: (spaceId) => repo.list(spaceId),
    lockForWrite: (spaceId, id) => repo.lockForWrite(spaceId, id),
    save: (r) => repo.save(r),
    listActive: async () => (await repo.listActive()).filter((a) => a.id === scope.recurrenceId),
    ...scope.recurrences,
  };
  const occurrences: OccurrenceRepository = {
    addOccurrence: (o) => repo.addOccurrence(o),
    saveOccurrence: (o) => repo.saveOccurrence(o),
    findOccurrence: (spaceId, id, options) => repo.findOccurrence(spaceId, id, options),
    pendingOccurrences: (spaceId) => repo.pendingOccurrences(spaceId),
    latestOccurrences: (spaceId, ids) => repo.latestOccurrences(spaceId, ids),
    ...scope.occurrences,
  };
  const recorders = occurrenceRecorders(ledger);
  return { ...ledger, recurrences, occurrences, recorders: scope.recorders?.(recorders) ?? recorders };
};

/** Household's "Rent", 1,200,000 COP from its fund, MONTHLY(1), AUTO, from 2026-12-01, defined by Ana. */
const rentOf = (w: SharedLedgerFixture, overrides: Partial<DefineRecurrenceInput> = {}): DefineRecurrenceInput => ({
  spaceId: w.household.spaceId,
  userId: w.household.userId,
  description: "Rent",
  amount: unwrap(Money.ofMinor(120_000_000n, "COP")),
  template: { type: "EXPENSE", categoryId: w.groceries, payer: { memberId: null, accountId: w.fund }, split: null },
  schedule: { kind: "MONTHLY", day: 1 },
  mode: "AUTO",
  startDate: day("2026-12-01"),
  endDate: null,
  ...overrides,
});
const expensesOf = async (w: SharedLedgerFixture) => {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM transactions WHERE space_id = $1 AND type = 'EXPENSE'",
    [w.household.spaceId],
  );
  return rows[0].n as number;
};

describe("recurrence races (HU-E4-12, HU-E4-13, Review Focus 1)", () => {
  it("records the 2026-12-01 Rent once when two runs meet: the second waits for the first's lock and sees its dueFrom", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const rent = unwrap(await createDefineRecurrence(deps())(rentOf(w))).recurrence;
    const h = holder(tm, pool);
    // The first run stops inside its transaction once it recorded the Rent, holding the recurrence's row lock.
    const first = createMaterializeDueOccurrences(
      deps({
        recurrenceId: rent.id,
        recorders: (r) => ({
          ...r,
          expense: async (input) => {
            const recorded = await r.expense(input);
            await h.hold();
            return recorded;
          },
        }),
      }),
    )({ today: day("2026-12-01") });
    await h.held;
    const second = createMaterializeDueOccurrences(deps({ recurrenceId: rent.id }))({ today: day("2026-12-01") }).finally(
      h.release,
    );
    const [a, b] = await Promise.all([first, second]);
    expect([a.occurrences.length, b.occurrences.length, a.failures, b.failures]).toEqual([1, 0, [], []]);
    expect(await expensesOf(w)).toBe(1);
  });

  it("makes a run wait for a pause in progress, which it then sees: nothing is recorded (N4)", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const rent = unwrap(await createDefineRecurrence(deps())(rentOf(w))).recurrence;
    const h = holder(tm, pool);
    // The pause stops inside its transaction once it saved the paused recurrence, holding its row lock.
    const pausing = createPauseRecurrence(
      deps({
        recurrences: {
          save: async (r) => {
            await repo.save(r);
            await h.hold();
          },
        },
      }),
    )({ spaceId: w.household.spaceId, userId: w.household.userId, recurrenceId: rent.id });
    await h.held;
    const running = createMaterializeDueOccurrences(deps({ recurrenceId: rent.id }))({ today: day("2026-12-01") }).finally(
      h.release,
    );
    const [paused, report] = await Promise.all([pausing, running]);
    expect([codeOf(paused), report.occurrences, report.failures, await expensesOf(w)]).toEqual(["ok", [], [], 0]);
    expect((await repo.find(w.household.spaceId, rent.id))?.pausedAt).not.toBeNull();
  });

  it("lets a confirm and a skip of one pending occurrence take turns: the second answers OccurrenceNotPending", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const electricity = unwrap(
      await createDefineRecurrence(deps())(
        rentOf(w, {
          description: "Electricity",
          mode: "CONFIRM",
          schedule: { kind: "MONTHLY", day: 10 },
          template: {
            type: "EXPENSE",
            categoryId: w.groceries,
            payer: { memberId: w.household.memberId, accountId: w.bank },
            split: null,
          },
        }),
      ),
    ).recurrence;
    await createMaterializeDueOccurrences(deps({ recurrenceId: electricity.id }))({ today: day("2026-12-10") });
    const [pending] = await repo.pendingOccurrences(w.household.spaceId);
    const ref = { spaceId: w.household.spaceId, userId: w.household.userId, occurrenceId: pending!.id };
    const h = holder(tm, pool);
    // The confirmation stops inside its transaction once it saved the RECORDED occurrence, holding its row lock.
    const confirming = createConfirmOccurrence(
      deps({
        occurrences: {
          saveOccurrence: async (o) => {
            await repo.saveOccurrence(o);
            await h.hold();
          },
        },
      }),
    )({ ...ref, amount: unwrap(Money.ofMinor(20_530_000n, "COP")) });
    await h.held;
    const skipping = createSkipOccurrence(deps())(ref).finally(h.release);
    expect(await outcomesOf(confirming, skipping)).toEqual(["OccurrenceNotPending", "ok"]);
    expect([(await repo.findOccurrence(w.household.spaceId, pending!.id))?.status, await expensesOf(w)]).toEqual([
      "RECORDED",
      1,
    ]);
  });
});
```

- [ ] **Step 2: Run the tests and the mutation checks**

Run: `pnpm exec vitest run --project integration src/modules/ledger/infrastructure/concurrent-occurrences.int.test.ts`
Expected: PASS.
Mutation checks, one at a time, each restored before the next: (a) in `DrizzleRecurrenceRepository.lockForWrite`, drop `.for("no key update")` — the first test fails because the second run commits first and the held first run then collides on `recurrence_occurrences_date_uq` and reports the failure, and the second fails with one expense and the pause overwritten; (b) in `findOccurrence`, ignore `options.lock` — the third fails with `["ok", "ok"]` and a `SKIPPED` occurrence.

- [ ] **Step 3: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/support/locks.ts src/modules/ledger/infrastructure/concurrent-occurrences.int.test.ts
git commit -m "test(ledger): pin scheduler runs, pauses, confirmations and skips against each other (Refs #41, Refs #42)"
```

---

### Task 13a: Ledger — a member's balance movements in one SQL window function

Implements the SQL of HU-E5-04 (issue #46): the technical notes "window function over balance-affecting rows ordered by date then createdAt" and "the opening balance for a period equals the net balance as of the day before the period start". Pins Review Focus 4 (a running balance through a fund-paid and a soft-deleted expense, two movements on one day) and Review Focus 5 (malformed ids).

Decisions:
- **Derived on read (D7):** one SQL statement in `DrizzleLedgerQueries.memberHistory`: the member's movements under the E5 balance rule (live member-paid expenses they paid for or share, `change = paid − share`; settlements they paid, `+amount`, or received, `−amount`; fund-paid expenses create no debt, D5), the zero ones left out, and `sum(change) OVER (ORDER BY date, created_at, id)` as the running balance over every earlier movement. The statement keeps the last movement before `from` only to give the opening balance, so the opening and the entries read one snapshot.
- An in-memory twin on `InMemoryTransactions` computes the same, and an integration test compares them on the same fixtures for every member and range, as M2 did for `memberTotals`.
- The ledger declares the history types with its own names (as `MemberMoneyTotals`); `balances` reaches them through its own port (Task 13b).

**Files:**
- Modify: `src/modules/ledger/application/ports.ts`, `src/modules/ledger/application/index.ts`, `src/modules/ledger/infrastructure/drizzle-ledger-queries.ts`, `tests/support/in-memory-ledger.ts`
- Test: create `src/modules/ledger/infrastructure/drizzle-balance-history.int.test.ts`

**Interfaces:**
- Consumes: `InMemoryTransactions` (`tests/support/in-memory-ledger.ts`); `recordExpense`, `recordSettlement`, `softDelete` (M1–M2 domain); `sharedLedgerFixture`.
- Produces: `interface HistoryRange { from: LocalDate | null; to: LocalDate | null }`; `interface BalanceMovement { transactionId; type: "EXPENSE" | "SETTLEMENT"; date; description; change: bigint; balance: bigint }`; `interface MemberBalanceHistory { opening: bigint; entries: readonly BalanceMovement[] }`; `DrizzleLedgerQueries.memberHistory(spaceId, memberId, range): Promise<MemberBalanceHistory>`; `InMemoryTransactions.memberHistory(spaceId, memberId, range)`.

- [ ] **Step 1: Write the failing test**

`src/modules/ledger/infrastructure/drizzle-balance-history.int.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { Money, type LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { unwrap } from "../../../../tests/support/fakes";
import { sharedLedgerFixture, type SharedLedgerFixture } from "../../../../tests/support/fixtures";
import { InMemoryTransactions } from "../../../../tests/support/in-memory-ledger";
import type { HistoryRange } from "../application/ports";
import {
  recordExpense,
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
const day = (iso: string) => iso as LocalDate;
/**
 * A transaction of Household on `date`, created `minute` minutes after 2026-10-01 12:00Z; `idPrefix` (8 hex digits)
 * fixes where its id sorts.
 */
const base = (w: SharedLedgerFixture, date: string, minute: number, amount: bigint, idPrefix?: string) => ({
  id: (idPrefix === undefined ? randomUUID() : `${idPrefix}-${randomUUID().slice(9)}`) as TransactionId,
  spaceId: w.household.spaceId,
  date: day(date),
  amount,
  currency: "COP",
  createdBy: w.household.userId,
  now: new Date(Date.UTC(2026, 9, 1, 12, minute)),
});
/** An expense of `amount` paid in full by `payer`, split equally among `participants`. */
const expense = (
  w: SharedLedgerFixture,
  date: string,
  minute: number,
  amount: bigint,
  payer: { memberId: string | null; accountId: string | null },
  participants: readonly string[],
  idPrefix?: string,
) => {
  const parts = unwrap(unwrap(Money.ofMinor(amount, "COP")).allocate(participants.map(() => 1)));
  return unwrap(
    recordExpense({
      ...base(w, date, minute, amount, idPrefix),
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
const settlement = (
  w: SharedLedgerFixture,
  date: string,
  minute: number,
  amount: bigint,
  payerMemberId: string,
  receivingMemberId: string,
  idPrefix?: string,
) =>
  unwrap(
    recordSettlement({
      ...base(w, date, minute, amount, idPrefix),
      payerMemberId,
      receivingMemberId,
      sourceAccountId: null,
      destinationAccountId: null,
    }),
  );
/** Stores the same transactions in PostgreSQL and in the in-memory twin. */
const storeInBoth = async (memory: InMemoryTransactions, ...txs: Transaction[]) => {
  for (const tx of txs) {
    await repo.add(tx);
    await memory.add(tx);
  }
};

describe("a member's balance history in SQL (HU-E5-04)", () => {
  /**
   * Household with Ana and the guest Pedro: Ana pays 300,000 EQUAL (10-03); on 10-05 Ana settles 10,000 to Pedro
   * (created first) and Pedro pays Ana's 40,000 lunch; Pedro pays 100,000 EQUAL (10-10); the fund pays 80,000 of
   * Pedro's (10-12, no debt); Ana's 60,000 of 10-20 is soft-deleted; Pedro settles 100,000 to Ana (10-30).
   */
  const fixture = async () => {
    const w = await sharedLedgerFixture(db, pool);
    const ana = w.household.memberId;
    const memory = new InMemoryTransactions();
    await storeInBoth(
      memory,
      expense(w, "2026-10-03", 0, pesos(300_000n), { memberId: ana, accountId: w.bank }, [ana, w.pedro]),
      // Ids that sort against creation order: a window ordered by date and id alone would swap these two.
      expense(w, "2026-10-05", 2, pesos(40_000n), { memberId: w.pedro, accountId: null }, [ana], "00000000"),
      settlement(w, "2026-10-05", 1, pesos(10_000n), ana, w.pedro, "ffffffff"),
      expense(w, "2026-10-10", 3, pesos(100_000n), { memberId: w.pedro, accountId: null }, [ana, w.pedro]),
      expense(w, "2026-10-12", 4, pesos(80_000n), { memberId: null, accountId: w.fund }, [w.pedro]),
      softDelete(
        expense(w, "2026-10-20", 5, pesos(60_000n), { memberId: ana, accountId: w.bank }, [ana, w.pedro]),
        new Date(),
      ),
      settlement(w, "2026-10-30", 6, pesos(100_000n), w.pedro, ana),
    );
    return { w, ana, memory };
  };

  it("matches the in-memory twin for every member and range (Review Focus 4)", async () => {
    const { w, ana, memory } = await fixture();
    const ranges: HistoryRange[] = [
      { from: null, to: null },
      { from: day("2026-10-01"), to: day("2026-10-15") },
      { from: day("2026-10-06"), to: null },
      { from: null, to: day("2026-10-05") },
      { from: day("2026-10-13"), to: day("2026-10-25") },
    ];
    for (const memberId of [ana, w.pedro]) {
      for (const range of ranges) {
        expect(await queries.memberHistory(w.household.spaceId, memberId, range)).toEqual(
          await memory.memberHistory(w.household.spaceId, memberId, range),
        );
      }
    }
  });

  it("runs Pedro's net through every movement by date, then creation time, without the fund's or the deleted expense", async () => {
    const { w } = await fixture();
    const history = await queries.memberHistory(w.household.spaceId, w.pedro, { from: null, to: null });
    expect(history.entries.map((e) => [e.date, e.type, e.change, e.balance])).toEqual([
      ["2026-10-03", "EXPENSE", pesos(-150_000n), pesos(-150_000n)],
      ["2026-10-05", "SETTLEMENT", pesos(-10_000n), pesos(-160_000n)],
      ["2026-10-05", "EXPENSE", pesos(40_000n), pesos(-120_000n)],
      ["2026-10-10", "EXPENSE", pesos(50_000n), pesos(-70_000n)],
      ["2026-10-30", "SETTLEMENT", pesos(100_000n), pesos(30_000n)],
    ]);
    const later = await queries.memberHistory(w.household.spaceId, w.pedro, { from: day("2026-10-13"), to: day("2026-10-25") });
    expect(later).toEqual({ opening: pesos(-70_000n), entries: [] });
  });

  it("answers an empty history for malformed ids (Review Focus 5)", async () => {
    const { w } = await fixture();
    const empty = { opening: 0n, entries: [] };
    expect([
      await queries.memberHistory("not-a-uuid", w.pedro, { from: null, to: null }),
      await queries.memberHistory(w.household.spaceId, "not-a-uuid", { from: null, to: null }),
    ]).toEqual([empty, empty]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project integration src/modules/ledger/infrastructure/drizzle-balance-history.int.test.ts`
Expected: FAIL — `queries.memberHistory is not a function`.

- [ ] **Step 3: Implement**

Append to `src/modules/ledger/application/ports.ts`:

```ts

/** HU-E5-04: a span of dates, open on either side when null. */
export interface HistoryRange {
  readonly from: LocalDate | null;
  readonly to: LocalDate | null;
}

/** HU-E5-04: one movement of a member's net balance (E5 balance rule) and their running net after it. */
export interface BalanceMovement {
  readonly transactionId: string;
  readonly type: "EXPENSE" | "SETTLEMENT";
  readonly date: LocalDate;
  readonly description: string;
  /** What it did to the member's net: paid − share of a member-paid expense, + paid or − received of a settlement. */
  readonly change: bigint;
  /** The member's net after it, over every earlier movement of the space. */
  readonly balance: bigint;
}

/** HU-E5-04: the member's net before `from` and their movements within the range, by date, creation and id. */
export interface MemberBalanceHistory {
  readonly opening: bigint;
  readonly entries: readonly BalanceMovement[];
}
```

Append to `src/modules/ledger/application/index.ts`:

```ts
export type { BalanceMovement, HistoryRange, MemberBalanceHistory } from "./ports";
```

In `src/modules/ledger/infrastructure/drizzle-ledger-queries.ts`:

1. Insert before the line `  MemberMoneyTotals,`:

```ts
  HistoryRange,
  MemberBalanceHistory,
```

2. Insert before the line `  private matching(f: TransactionFilter) {`:

```ts
  /**
   * HU-E5-04 (E5 balance rule, D7): one member's balance-affecting movements in one space with a window function's
   * running balance over every earlier movement: live member-paid expenses they paid for or share (paid − share;
   * fund-paid expenses create no debt, D5) and settlements they paid (+) or received (−), in date, creation and id
   * order, through `to`. The last movement before `from` is kept only to give the opening balance, so the opening and
   * the entries come from one statement and one snapshot. Malformed ids answer an empty history.
   */
  async memberHistory(spaceId: string, memberId: string, range: HistoryRange): Promise<MemberBalanceHistory> {
    if (!isUuid(spaceId) || !isUuid(memberId)) return { opening: 0n, entries: [] };
    interface HistoryRow {
      readonly id: string;
      readonly date: string;
      readonly type: "EXPENSE" | "SETTLEMENT";
      readonly description: string;
      readonly change: string;
      readonly balance: string;
    }
    const { rows } = await this.tm.executor().execute(sql`
      WITH movements AS (
        SELECT t.id, t.date, t.created_at, t.type, t.description,
          coalesce((SELECT sum(p.amount) FROM ${payments} p WHERE p.transaction_id = t.id AND p.member_id = ${memberId}), 0)
            - coalesce((SELECT sum(s.amount) FROM ${shares} s WHERE s.transaction_id = t.id AND s.member_id = ${memberId}), 0)
            AS change
        FROM ${transactions} t
        WHERE t.space_id = ${spaceId} AND t.deleted_at IS NULL AND t.type = 'EXPENSE'
          AND NOT EXISTS (SELECT 1 FROM ${payments} f WHERE f.transaction_id = t.id AND f.member_id IS NULL)
        UNION ALL
        SELECT t.id, t.date, t.created_at, t.type, t.description,
          CASE WHEN t.payer_member_id = ${memberId} THEN t.amount ELSE -t.amount END
        FROM ${transactions} t
        WHERE t.space_id = ${spaceId} AND t.deleted_at IS NULL AND t.type = 'SETTLEMENT'
          AND ${memberId} IN (t.payer_member_id, t.receiving_member_id)
      ), running AS (
        SELECT id, date, created_at, type, description, change,
          sum(change) OVER (ORDER BY date, created_at, id) AS balance,
          lead(date) OVER (ORDER BY date, created_at, id) AS next_date
        FROM movements
        WHERE change <> 0 AND (${range.to}::date IS NULL OR date <= ${range.to}::date)
      )
      SELECT id, date::text AS date, type, description, change::text AS change, balance::text AS balance
      FROM running
      WHERE ${range.from}::date IS NULL OR date >= ${range.from}::date
        OR next_date IS NULL OR next_date >= ${range.from}::date
      ORDER BY date, created_at, id`);
    const movements = (rows as unknown as HistoryRow[]).map((row) => ({
      transactionId: row.id,
      type: row.type,
      date: row.date as LocalDate,
      description: row.description,
      change: BigInt(row.change),
      balance: BigInt(row.balance),
    }));
    const from = range.from;
    if (from === null) return { opening: 0n, entries: movements };
    return {
      opening: movements.filter((m) => m.date < from).at(-1)?.balance ?? 0n,
      entries: movements.filter((m) => m.date >= from),
    };
  }

```

In `tests/support/in-memory-ledger.ts`:

1. Insert after the line `  AuditLog,` (inside the `@/modules/ledger/application` type import):

```ts
  BalanceMovement,
  HistoryRange,
  MemberBalanceHistory,
```

2. Insert before the line `  private matching(f: TransactionFilter): Transaction[] {`:

```ts
  /** The in-memory twin of DrizzleLedgerQueries.memberHistory (HU-E5-04); drizzle-balance-history.int.test.ts pins them. */
  async memberHistory(spaceId: string, memberId: string, range: HistoryRange): Promise<MemberBalanceHistory> {
    const changeOf = (t: Transaction): bigint => {
      if (t.type === "SETTLEMENT") {
        return t.payerMemberId === memberId ? t.amount : t.receivingMemberId === memberId ? -t.amount : 0n;
      }
      // D5: a fund-paid expense creates no debt.
      if (t.type !== "EXPENSE" || t.payments.some((p) => p.memberId === null)) return 0n;
      const paid = t.payments.filter((p) => p.memberId === memberId).reduce((sum, p) => sum + p.amount, 0n);
      const share = t.shares.filter((s) => s.memberId === memberId).reduce((sum, s) => sum + s.amount, 0n);
      return paid - share;
    };
    const byDateThenCreation = (a: Transaction, b: Transaction) =>
      a.date !== b.date
        ? a.date < b.date
          ? -1
          : 1
        : a.createdAt.getTime() !== b.createdAt.getTime()
          ? a.createdAt.getTime() - b.createdAt.getTime()
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0;
    const live = this.rows
      .filter((t) => t.spaceId === spaceId && t.deletedAt === null && (range.to === null || t.date <= range.to))
      .sort(byDateThenCreation);
    let balance = 0n;
    let opening = 0n;
    const entries: BalanceMovement[] = [];
    for (const t of live) {
      const change = changeOf(t);
      if (change === 0n) continue;
      balance += change;
      if (range.from !== null && t.date < range.from) opening = balance;
      else {
        entries.push({
          transactionId: t.id,
          type: t.type === "SETTLEMENT" ? "SETTLEMENT" : "EXPENSE",
          date: t.date,
          description: t.description,
          change,
          balance,
        });
      }
    }
    return { opening, entries };
  }

```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project integration src/modules/ledger/infrastructure/drizzle-balance-history.int.test.ts src/modules/ledger/infrastructure/drizzle-member-totals.int.test.ts`
Expected: PASS. Mutation check: in `memberHistory`, temporarily order the window by `date, id` only — "runs Pedro's net through every movement by date, then creation time" fails with the 2026-10-05 movements swapped on every run, since the fixture gives the later-created expense an id that sorts first (`00000000-…`) and the settlement one that sorts last (`ffffffff-…`); restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/application/ports.ts src/modules/ledger/application/index.ts src/modules/ledger/infrastructure/drizzle-ledger-queries.ts src/modules/ledger/infrastructure/drizzle-balance-history.int.test.ts tests/support/in-memory-ledger.ts
git commit -m "feat(ledger): compute a member's running balance with one window function (Refs #46)"
```

---

### Task 13b: Balances — GetMemberBalanceHistory

Implements HU-E5-04 (issue #46) at the use-case level: scenarios "Running balance per movement", "History is limited to a period" and "Deleted movements are not returned". Pins Review Focus 4 and Review Focus 5 (a member of another space, a non-member).

Decisions:
- **Scope (ruling P29):** any member reads the history of any current member of the space (`space.read`, as the balances of HU-E5-01 are visible to every member), guests included; an id that is not a current member answers `MemberNotFound` (former members included: they can no longer read the space, and their rows stay in the transaction list). `closing` is the balance after the last entry, or the opening balance without entries. Not paginated (ruling P28): `from` and `to` bound it.
- `balances` reaches the ledger's history through its `BalanceHistorySource` port, which the composition root binds to `DrizzleLedgerQueries` (Task 14); `balances` never imports the ledger.

**Files:**
- Create: `src/modules/balances/application/get-member-balance-history.ts`
- Modify: `src/modules/balances/application/index.ts`
- Test: create `src/modules/balances/application/get-member-balance-history.test.ts`

**Interfaces:**
- Consumes: `InMemoryTransactions.memberHistory` (Task 13a); `anExpense`, `aSettlement` (`tests/support/in-memory-ledger.ts`); `householdSpace`, `InMemorySpaceStore`, `memberOf` (`tests/support/in-memory-spaces.ts`); `authorizeSpaceAction`, `SpaceAccess`, `SpaceMemberRepository` (`spaces`).
- Produces: `interface BalanceEntry`, `interface BalanceHistorySource { memberHistory(spaceId, memberId, range) }`, `interface BalanceHistoryDeps { access; members; history }`, `interface MemberBalanceHistoryView { spaceId; memberId; currency; from; to; opening; closing; entries }`, `type GetMemberBalanceHistory = (input: { spaceId; userId; memberId; from: LocalDate | null; to: LocalDate | null }) => Promise<Result<MemberBalanceHistoryView>>`, `createGetMemberBalanceHistory(deps)` — `SpaceNotFound`, `MemberNotFound`.

- [ ] **Step 1: Write the failing test**

`src/modules/balances/application/get-member-balance-history.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSpaceAccess } from "@/modules/spaces/application";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { anExpense, aSettlement, InMemoryTransactions } from "../../../../tests/support/in-memory-ledger";
import { householdSpace, InMemorySpaceStore, memberOf } from "../../../../tests/support/in-memory-spaces";
import { createGetMemberBalanceHistory, type MemberBalanceHistoryView } from "./get-member-balance-history";

const pesos = (n: bigint) => n * 100n;
const day = (iso: string) => iso as LocalDate;
/** `payer` pays `amount` pesos in Household on `date`, split equally between Ana and Juan. */
const paysEqually = (date: string, payer: string, amount: bigint) =>
  anExpense(date, pesos(amount), {
    spaceId: "space-household",
    payments: [{ memberId: payer, accountId: null, amount: pesos(amount) }],
    shares: [
      { memberId: "member-ana", amount: pesos(amount) / 2n, splitMethod: "EQUAL" },
      { memberId: "member-juan", amount: pesos(amount) / 2n, splitMethod: "EQUAL" },
    ],
  });

/**
 * HU-E5-04 Background in Household (Ana, Juan and the VIEWER Sofi): Ana pays 300,000 COP split EQUAL on 2026-10-03,
 * Juan pays 100,000 COP split EQUAL on 2026-10-10 (soft-deleted when `deleted`), Juan settles 100,000 COP to Ana on
 * 2026-10-30; neither a fund-paid expense (D5) nor Ana's own lunch moves Juan's or Ana's net.
 */
const world = async (options: { readonly deleted?: boolean } = {}) => {
  const spaces = new InMemorySpaceStore();
  spaces.seed(householdSpace([memberOf("Ana", "OWNER", 0), memberOf("Juan", "MEMBER", 1), memberOf("Sofi", "VIEWER", 2)]));
  const ledger = new InMemoryTransactions();
  const juans = paysEqually("2026-10-10", "member-juan", 100_000n);
  await ledger.add(paysEqually("2026-10-03", "member-ana", 300_000n));
  await ledger.add(options.deleted ? { ...juans, deletedAt: new Date("2026-10-11T12:00:00Z") } : juans);
  await ledger.add(aSettlement("2026-10-30", pesos(100_000n)));
  await ledger.add(
    anExpense("2026-10-12", pesos(80_000n), {
      spaceId: "space-household",
      payments: [{ memberId: null, accountId: "acc-household-fund", amount: pesos(80_000n) }],
      shares: [{ memberId: "member-juan", amount: pesos(80_000n), splitMethod: "EXACT" }],
    }),
  );
  await ledger.add(
    anExpense("2026-10-14", pesos(20_000n), {
      spaceId: "space-household",
      payments: [{ memberId: "member-ana", accountId: null, amount: pesos(20_000n) }],
      shares: [{ memberId: "member-ana", amount: pesos(20_000n), splitMethod: "EQUAL" }],
    }),
  );
  const history = createGetMemberBalanceHistory({ access: createSpaceAccess(spaces), members: spaces, history: ledger });
  return (
    ask: { readonly userId?: string; readonly memberId?: string; readonly from?: string; readonly to?: string } = {},
  ) =>
    history({
      spaceId: "space-household",
      userId: ask.userId ?? "u-juan",
      memberId: ask.memberId ?? "member-juan",
      from: ask.from === undefined ? null : day(ask.from),
      to: ask.to === undefined ? null : day(ask.to),
    });
};
const balances = (view: MemberBalanceHistoryView) => view.entries.map((e) => e.balance);

describe("GetMemberBalanceHistory (HU-E5-04)", () => {
  it("returns Juan's running net per movement: -150,000, -100,000 and 0 COP", async () => {
    const view = unwrap(await (await world())());
    expect(view.entries.map((e) => [e.type, e.date, e.change, e.balance])).toEqual([
      ["EXPENSE", "2026-10-03", pesos(-150_000n), pesos(-150_000n)],
      ["EXPENSE", "2026-10-10", pesos(50_000n), pesos(-100_000n)],
      ["SETTLEMENT", "2026-10-30", pesos(100_000n), 0n],
    ]);
    expect([view.opening, view.closing, view.currency]).toEqual([0n, 0n, "COP"]);
  });

  it("limits the history to 2026-10-01 … 2026-10-15: 2 entries and a closing net of -100,000 COP", async () => {
    const view = unwrap(await (await world())({ from: "2026-10-01", to: "2026-10-15" }));
    expect([balances(view), view.opening, view.closing]).toEqual([
      [pesos(-150_000n), pesos(-100_000n)],
      0n,
      pesos(-100_000n),
    ]);
  });

  it("opens a period with the net as of the day before it, with or without movements in it", async () => {
    const ask = await world();
    const later = unwrap(await ask({ from: "2026-10-11" }));
    expect([later.opening, balances(later), later.closing]).toEqual([pesos(-100_000n), [0n], 0n]);
    const quiet = unwrap(await ask({ from: "2026-10-15", to: "2026-10-20" }));
    expect([quiet.opening, quiet.entries, quiet.closing]).toEqual([pesos(-100_000n), [], pesos(-100_000n)]);
  });

  it("leaves out the soft-deleted 2026-10-10 expense: -150,000 then -50,000 COP", async () => {
    expect(balances(unwrap(await (await world({ deleted: true }))()))).toEqual([pesos(-150_000n), pesos(-50_000n)]);
  });

  it("returns Ana's history to any member, Sofi the VIEWER included, without her own lunch or the fund's expense", async () => {
    const view = unwrap(await (await world())({ userId: "u-sofi", memberId: "member-ana" }));
    expect(balances(view)).toEqual([pesos(150_000n), pesos(100_000n), 0n]);
  });

  it("answers MemberNotFound for someone who is not a current member, and SpaceNotFound to a non-member", async () => {
    const ask = await world();
    expect([
      codeOf(await ask({ memberId: "member-pedro" })),
      codeOf(await ask({ memberId: "not-a-member" })),
      codeOf(await ask({ userId: "u-marta" })),
    ]).toEqual(["MemberNotFound", "MemberNotFound", "SpaceNotFound"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --project unit src/modules/balances/application/get-member-balance-history.test.ts`
Expected: FAIL — `Failed to resolve import "./get-member-balance-history"`.

- [ ] **Step 3: Implement**

`src/modules/balances/application/get-member-balance-history.ts`:

```ts
import { authorizeSpaceAction, type SpaceAccess, type SpaceMemberRepository } from "@/modules/spaces/application";
import { domainError, err, ok, type LocalDate, type Result } from "@/shared/kernel";

/** HU-E5-04: one movement of a member's net balance and the running balance after it. */
export interface BalanceEntry {
  readonly transactionId: string;
  readonly type: "EXPENSE" | "SETTLEMENT";
  readonly date: LocalDate;
  readonly description: string;
  readonly change: bigint;
  readonly balance: bigint;
}

/** The ledger's history of one member's net (one SQL window function, D7); bound by the composition root. */
export interface BalanceHistorySource {
  memberHistory(
    spaceId: string,
    memberId: string,
    range: { readonly from: LocalDate | null; readonly to: LocalDate | null },
  ): Promise<{ readonly opening: bigint; readonly entries: readonly BalanceEntry[] }>;
}

export interface BalanceHistoryDeps {
  readonly access: SpaceAccess;
  readonly members: Pick<SpaceMemberRepository, "listCurrent">;
  readonly history: BalanceHistorySource;
}

export interface MemberBalanceHistoryView {
  readonly spaceId: string;
  readonly memberId: string;
  readonly currency: string;
  readonly from: LocalDate | null;
  readonly to: LocalDate | null;
  /** The net as of the day before `from` (0 without `from`). */
  readonly opening: bigint;
  /** The net after the last entry, or the opening balance without entries. */
  readonly closing: bigint;
  readonly entries: readonly BalanceEntry[];
}

export type GetMemberBalanceHistory = (input: {
  spaceId: string;
  userId: string;
  memberId: string;
  from: LocalDate | null;
  to: LocalDate | null;
}) => Promise<Result<MemberBalanceHistoryView>>;

/**
 * HU-E5-04 GetMemberBalanceHistory: any member reads how the net of a current member of the space (guests included)
 * evolved, computed on read (D7); an id that is not a current member answers MemberNotFound (ruling P29).
 */
export const createGetMemberBalanceHistory =
  (deps: BalanceHistoryDeps): GetMemberBalanceHistory =>
  async (input) => {
    const reader = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!reader.ok) return reader;
    const space = reader.value;
    const members = await deps.members.listCurrent(space.spaceId);
    if (!members.some((m) => m.id === input.memberId)) return err(domainError("MemberNotFound"));
    const history = await deps.history.memberHistory(space.spaceId, input.memberId, {
      from: input.from,
      to: input.to,
    });
    return ok({
      spaceId: space.spaceId,
      memberId: input.memberId,
      currency: space.currency,
      from: input.from,
      to: input.to,
      opening: history.opening,
      closing: history.entries.at(-1)?.balance ?? history.opening,
      entries: history.entries,
    });
  };
```

Append to `src/modules/balances/application/index.ts`:

```ts
export {
  createGetMemberBalanceHistory,
  type BalanceEntry,
  type BalanceHistoryDeps,
  type BalanceHistorySource,
  type GetMemberBalanceHistory,
  type MemberBalanceHistoryView,
} from "./get-member-balance-history";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --project unit src/modules/balances`
Expected: PASS. Mutation check: temporarily drop the `MemberNotFound` check — "answers MemberNotFound …" fails with `ok` for Pedro; restore it.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/balances/application/get-member-balance-history.ts src/modules/balances/application/get-member-balance-history.test.ts src/modules/balances/application/index.ts
git commit -m "feat(balances): read a member's balance history, movement by movement (Refs #46)"
```

---

### Task 14: HTTP — balance history

Implements HU-E5-04's endpoint (issue #46): `GET /api/v1/spaces/{spaceId}/members/{memberId}/balance-history?from=<date>&to=<date>`, with its three scenarios over HTTP. Pins Review Focus 4 (a soft-deleted expense through `DELETE …/transactions/{id}`) and Review Focus 5 (a member of another space, a malformed id, a non-member).

Decisions:
- `from` and `to` are optional ISO dates; `from` after `to` is `422 ValidationFailed`, an impossible date `422 InvalidDate`. The answer is inline in the operation (no component): `{ memberId, from, to, opening, closing, entries: [{ transactionId, type, date, description, change, balance }] }`, amounts as `Money`.
- The composition root binds `balances`' `BalanceHistorySource` to `DrizzleLedgerQueries` (balances never imports the ledger).

**Files:**
- Create: `src/app/api/v1/spaces/[spaceId]/members/[memberId]/balance-history/route.ts`, `tests/acceptance/balance-history.test.ts`
- Modify: `src/modules/balances/contracts/balances.contract.ts`, `src/composition/container.ts`, `openapi/openapi.snapshot.json`, `docs/backlog/E5-balances-and-settlements.md`

**Interfaces:**
- Consumes: `createGetMemberBalanceHistory`, `GetMemberBalanceHistory`, `MemberBalanceHistoryView` (Task 13b); `DrizzleLedgerQueries.memberHistory` (Task 13a); `household`, `joinHousehold`, `post`, `settles`, `cop`, `HouseholdMember`, `TransactionDto`, `MoneyDto` (`tests/support/ledger.ts`); `call`, `problemOf`, `registerUser`, `startTestApp` (`tests/support/app.ts`).
- Produces: `BalanceHistoryQuerySchema`, `BalanceHistorySchema`, `balanceHistoryDto(view)`; `Container.balances.getMemberBalanceHistory: GetMemberBalanceHistory`.

- [ ] **Step 1: Write the failing tests**

`tests/acceptance/balance-history.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { GET as historyRoute } from "@/app/api/v1/spaces/[spaceId]/members/[memberId]/balance-history/route";
import { DELETE as deleteTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  cop,
  household,
  joinHousehold,
  post,
  settles,
  type HouseholdMember,
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

interface HistoryDto {
  memberId: string;
  from: string | null;
  to: string | null;
  opening: MoneyDto;
  closing: MoneyDto;
  entries: { transactionId: string; type: string; date: string; description: string; change: MoneyDto; balance: MoneyDto }[];
}

/**
 * HU-E5-04 Background: Ana pays 300,000 COP split EQUAL on 2026-10-03, Juan pays 100,000 COP split EQUAL on
 * 2026-10-10, and Juan settles 100,000 COP to Ana on 2026-10-30.
 */
const movements = async () => {
  const h = await household();
  const pays = async (payer: HouseholdMember, pesos: number, date: string) => {
    const response = await post(recordExpense, payer, "expenses", {
      description: "Groceries",
      date,
      categoryId: h.groceries,
      amount: cop(pesos),
      payments: [{ memberId: payer.memberId, accountId: payer.account, amount: cop(pesos) }],
      split: { method: "EQUAL", participants: [{ memberId: h.ana.memberId }, { memberId: h.juan.memberId }] },
    });
    expect(response.status).toBe(201);
    return (await response.json()) as TransactionDto;
  };
  const anas = await pays(h.ana, 300_000, "2026-10-03");
  const juans = await pays(h.juan, 100_000, "2026-10-10");
  const settlement = await settles(h.juan, h.juan.memberId, h.ana.memberId, 100_000);
  return { h, anas, juans, settlement };
};
const historyOf = (user: TestUser, spaceId: string, memberId: string, query = "") =>
  call(historyRoute, "GET", `/api/v1/spaces/${spaceId}/members/${memberId}/balance-history${query}`, {
    user,
    params: { spaceId, memberId },
  });
const read = async (response: Response) => {
  expect(response.status).toBe(200);
  return (await response.json()) as HistoryDto;
};

describe("balance history (HU-E5-04)", () => {
  it("returns Juan's running net per movement: -150,000, -100,000 and 0 COP", async () => {
    const { h, anas, juans, settlement } = await movements();
    const history = await read(await historyOf(h.juan, h.spaceId, h.juan.memberId));
    expect(history.entries.map((e) => [e.transactionId, e.type, e.date, e.change, e.balance])).toEqual([
      [anas.id, "EXPENSE", "2026-10-03", cop(-150_000), cop(-150_000)],
      [juans.id, "EXPENSE", "2026-10-10", cop(50_000), cop(-100_000)],
      [settlement.id, "SETTLEMENT", "2026-10-30", cop(100_000), cop(0)],
    ]);
    expect([history.opening, history.closing, history.from, history.to]).toEqual([cop(0), cop(0), null, null]);
  });

  it("limits the history to 2026-10-01 … 2026-10-15: 2 entries and a closing net of -100,000 COP", async () => {
    const { h } = await movements();
    const history = await read(await historyOf(h.juan, h.spaceId, h.juan.memberId, "?from=2026-10-01&to=2026-10-15"));
    expect([history.entries.length, history.opening, history.closing]).toEqual([2, cop(0), cop(-100_000)]);
    const later = await read(await historyOf(h.juan, h.spaceId, h.juan.memberId, "?from=2026-10-11"));
    expect([later.opening, later.entries.map((e) => e.balance), later.closing]).toEqual([
      cop(-100_000),
      [cop(0)],
      cop(0),
    ]);
  });

  it("leaves out the soft-deleted 2026-10-10 expense: -150,000 then -50,000 COP", async () => {
    const { h, juans } = await movements();
    const deleted = await call(deleteTransaction, "DELETE", `/api/v1/spaces/${h.spaceId}/transactions/${juans.id}`, {
      user: h.juan,
      params: { spaceId: h.spaceId, transactionId: juans.id },
    });
    expect(deleted.status).toBe(204);
    const history = await read(await historyOf(h.juan, h.spaceId, h.juan.memberId));
    expect(history.entries.map((e) => e.balance)).toEqual([cop(-150_000), cop(-50_000)]);
  });

  it("answers any member, Sofi the VIEWER included, and refuses other members, malformed ids, non-members and inverted ranges", async () => {
    const { h } = await movements();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    const other = await household();
    const marta = await registerUser("Marta");
    expect((await read(await historyOf(sofi, h.spaceId, h.ana.memberId))).closing).toEqual(cop(0));
    expect([
      await problemOf(await historyOf(h.ana, h.spaceId, other.juan.memberId)),
      await problemOf(await historyOf(h.ana, h.spaceId, "not-a-uuid")),
      await problemOf(await historyOf(marta, h.spaceId, h.ana.memberId)),
      await problemOf(await historyOf(h.ana, h.spaceId, h.ana.memberId, "?from=2026-10-15&to=2026-10-01")),
      await problemOf(await historyOf(h.ana, h.spaceId, h.ana.memberId, "?from=1899-12-31")),
    ]).toEqual([
      [404, "MemberNotFound"],
      [404, "MemberNotFound"],
      [404, "SpaceNotFound"],
      [422, "ValidationFailed"],
      [422, "InvalidDate"],
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project acceptance tests/acceptance/balance-history.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/spaces/[spaceId]/members/[memberId]/balance-history/route"`.

- [ ] **Step 3: Implement**

In `src/modules/balances/contracts/balances.contract.ts`:

1. Replace the line `import type { SettlementSuggestions, SpaceBalances } from "../application";` with:

```ts
import type { MemberBalanceHistoryView, SettlementSuggestions, SpaceBalances } from "../application";
```

2. Insert before the line `const SpacePath = z.object({ spaceId: z.string() });`:

```ts
/** HU-E5-04: an optional span of dates; `from` must not be after `to`. */
export const BalanceHistoryQuerySchema = z
  .object({ from: z.iso.date().optional(), to: z.iso.date().optional() })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    error: "from must not be after to",
    path: ["to"],
  });

/** HU-E5-04: a member's running net balance, movement by movement (ruling P29). */
export const BalanceHistorySchema = z.object({
  memberId: z.string(),
  from: z.iso.date().nullable(),
  to: z.iso.date().nullable(),
  /** The net as of the day before `from` (0 without `from`). */
  opening: MoneySchema,
  /** The net after the last entry, or the opening balance without entries. */
  closing: MoneySchema,
  entries: z.array(
    z.object({
      transactionId: z.string(),
      type: z.enum(["EXPENSE", "SETTLEMENT"]),
      date: z.iso.date(),
      description: z.string(),
      /** What the movement did to the member's net. */
      change: MoneySchema,
      /** The member's net after it. */
      balance: MoneySchema,
    }),
  ),
});

export const balanceHistoryDto = (history: MemberBalanceHistoryView): z.infer<typeof BalanceHistorySchema> => {
  const money = (minor: bigint) => ({ amount: minor.toString(), currency: history.currency });
  return {
    memberId: history.memberId,
    from: history.from,
    to: history.to,
    opening: money(history.opening),
    closing: money(history.closing),
    entries: history.entries.map((entry) => ({
      transactionId: entry.transactionId,
      type: entry.type,
      date: entry.date,
      description: entry.description,
      change: money(entry.change),
      balance: money(entry.balance),
    })),
  };
};

```

3. Insert after the line `const SpacePath = z.object({ spaceId: z.string() });`:

```ts
const MemberPath = SpacePath.extend({ memberId: z.string() });
```

4. Insert before the last line of the file (`};`):

```ts
  "/api/v1/spaces/{spaceId}/members/{memberId}/balance-history": {
    get: {
      operationId: "getMemberBalanceHistory",
      summary: "How a member's net balance evolved: each expense and settlement that moved it, with the running balance",
      ...securedByUser,
      requestParams: { path: MemberPath, query: BalanceHistoryQuerySchema },
      responses: {
        "200": {
          description: "The opening balance, the movements by date and the closing balance",
          content: jsonContent(BalanceHistorySchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "404": "SpaceNotFound, MemberNotFound",
          "422": "ValidationFailed, InvalidDate",
        }),
      },
    },
  },
```

`src/app/api/v1/spaces/[spaceId]/members/[memberId]/balance-history/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { balanceHistoryDto, BalanceHistoryQuerySchema } from "@/modules/balances/contracts/balances.contract";
import { optionalLocalDate } from "@/shared/http/contracts";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: BalanceHistoryQuerySchema,
  handler: async ({ user, params, query }) => {
    const from = optionalLocalDate(query.from);
    if (!from.ok) return from;
    const to = optionalLocalDate(query.to);
    if (!to.ok) return to;
    const result = await getContainer().balances.getMemberBalanceHistory({
      spaceId: params.spaceId!,
      userId: user!.id,
      memberId: params.memberId!,
      from: from.value ?? null,
      to: to.value ?? null,
    });
    return result.ok ? ok({ status: 200, body: balanceHistoryDto(result.value) }) : result;
  },
});
```

In `src/composition/container.ts`:

1. Insert before the line `  type GetSettlementSuggestions,`:

```ts
  createGetMemberBalanceHistory,
  type GetMemberBalanceHistory,
```

2. Insert after the line `    readonly getSettlementSuggestions: GetSettlementSuggestions;`:

```ts
    readonly getMemberBalanceHistory: GetMemberBalanceHistory;
```

3. Insert before the line `      // HU-E5-03: suggestions are computed on read from the same balances (D7).`:

```ts
      // HU-E5-04: a member's running net, movement by movement, from one SQL window function (D7).
      getMemberBalanceHistory: createGetMemberBalanceHistory({
        access,
        members: spaceRepository,
        history: ledgerQueries,
      }),
```

In `docs/backlog/E5-balances-and-settlements.md`, insert after the line `- The opening balance for a period equals the net balance as of the day before the period start.`:

```markdown
- `GET …/members/{memberId}/balance-history?from=&to=` (both optional; `from` after `to` is `ValidationFailed`) is `space.read`: any member reads the history of any current member of the space, guests included, and any other id answers `MemberNotFound` (404; M3-C ruling P29). Entries are the member's non-zero movements, live member-paid expenses they paid for or share and settlements they paid or received, in date, creation and id order, each with its `change` and running `balance`; `opening` is the net as of the day before `from` and `closing` the net after the last entry. One SQL window function computes it on read (D7); it is not paginated (ruling P28).
```

- [ ] **Step 4: Refresh the snapshot and run the tests**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` and inspect `git diff openapi/openapi.snapshot.json`: it adds `GET /api/v1/spaces/{spaceId}/members/{memberId}/balance-history` (about 180 lines) and changes no component and no other operation.
Then run: `pnpm exec vitest run --project acceptance tests/acceptance/balance-history.test.ts tests/acceptance/balances.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `pnpm exec vitest run --project unit && pnpm exec vitest run --project integration && pnpm exec vitest run --project acceptance && pnpm format && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm exec prettier --check . && pnpm lint:boundaries && pnpm db:check`
Expected: all exit 0; `pnpm lint:boundaries` confirms `balances` still imports nothing from the ledger.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/v1/spaces/[spaceId]/members/[memberId]/balance-history/route.ts" src/modules/balances/contracts/balances.contract.ts src/composition/container.ts openapi/openapi.snapshot.json docs/backlog/E5-balances-and-settlements.md tests/acceptance/balance-history.test.ts
git commit -m "feat(balances): show a member's balance history over HTTP (Refs #46)"
```

---

## Self-Review

### Story coverage

| Story (issue) | Scenario or technical note | Domain / application test | PostgreSQL / HTTP test |
|---|---|---|---|
| HU-E4-11 (#40) | Define the monthly rent paid from the shared fund: ACTIVE, next occurrence 2026-12-01 | Task 2a "is ACTIVE and next occurs on its start date"; Task 4 "defines the monthly Rent …" | Task 3b (stored and read back), Task 6e "defines the monthly Rent …: 201, ACTIVE" |
| | Monthly schedules clamp to short months (2027-01-31, 02-28, 03-31) | Task 1 (MONTHLY(31), leap year, SEMI_MONTHLY(30, 31)); Task 5 "previews MONTHLY(31) …" | Task 6f "previews MONTHLY(31) …" |
| | Semi-monthly schedule (2026-12-01 and 2026-12-16) | Task 1; Task 5 | Task 6f "lists Cleaning's December 2026 occurrences …" |
| | Editing applies to future occurrences only (1,200,000 then 1,300,000 COP) | Task 2a (the edit); Task 5 (the use case); Task 8b "applies an edit to future occurrences only" | Task 7a (PATCH), Task 9b "applies an edit to future occurrences only" |
| | Pausing skips the paused span without back-filling (paused 12-20, resumed 02-10, next 02-16) | Task 2b; Task 5; Task 8b "skips the paused span without back-filling" (with runs) | Task 7b (pause and resume over HTTP) |
| | Viewers cannot define recurrences (`InsufficientRole`) | Task 4 | Task 6e |
| | Notes: the five use cases and their endpoints, `GET …/occurrences?count`; PeriodPolicy anchor rules; the template (four types, payer or fund, account null for guests); `PayerLeft` | Tasks 2a, 2b, 4, 5, 8c (`PayerLeft`, `CreatorLeft`) | Tasks 3a, 3b, 6e, 6e2, 6f, 7a, 7b |
| HU-E4-12 (#41) | Occurrence is recorded on schedule and linked to the recurrence (@critical) | Task 8b "records the Rent on 2026-12-01 …" | Task 9b (@critical, `lastOccurrence.transactionId`) |
| | Running twice does not duplicate | Task 8b "records nothing twice"; Task 3c (the unique key) | Task 9b; Task 12 (two runs at once) |
| | Missed runs are caught up (runs on 2026-12-04, records 2026-12-01) | Task 8b "catches up missed runs" | Task 9b |
| | BY_ALLOCATION is resolved with the plan of each occurrence's period (@golden: 48,000 / 72,000 then 60,000 / 60,000 COP) | Task 8b (budgeting stand-in per date) | Task 9b (@golden, M3-B's real binding) |
| | Closed period skips the occurrence and logs the skip with reason `PeriodClosed` | Task 8b; Task 9a (the log line) | Task 9b (a catch-up run after the 2026-12 plan closed) |
| | Recurrence stops after its end date (nothing on 2027-02-01) | Task 2a (ENDED once no date is left); Task 8b | Task 9b |
| | Notes: `MaterializeDueOccurrences`, idempotency key (recurrenceId, occurrenceDate), recorded through `RecordExpense` (or the matching use case) with snapshots, `Scheduler` port with an in-container adapter and `Clock`, no public endpoint | Tasks 8a, 8b, 9a (`TimerScheduler`, `startRecurrenceJob`, `instrumentation.ts`) | Tasks 3c, 9b, 12 |
| HU-E4-13 (#42) | A pending occurrence is created instead of an expense; "Home" spent unchanged | Task 8b (CONFIRM runs); Task 10 "lists the pending Electricity …" | Task 11a (Home's `spent` over HTTP) |
| | Confirming records the actual amount: 205,300 COP as 82,120 / 123,180 COP (@critical) | Task 10 | Task 11b (@critical) |
| | Skipping an occurrence; next occurrence 2027-01-10 | Task 2b (`skippedByMember`); Task 10 | Task 11a |
| | Viewers cannot confirm (`InsufficientRole`) | Task 10 | Tasks 11a, 11b |
| | Confirming into a closed period is rejected (`PeriodClosed`) | Task 10 | Task 11b (the 2026-12 plan closed once its period ended, the occurrence still pending) |
| | Notes: `ConfirmOccurrence`, `SkipOccurrence`; not transactions, never spent; the three endpoints; listed for MEMBER or above; only the amount and a date within the period change | Tasks 2b, 10 (`InvalidOccurrenceDate`, D9 for Juan, one confirmation) | Tasks 3c, 11a, 11b (idempotent confirm), 12 (confirm against skip) |
| HU-E5-04 (#46) | Running balance per movement (-150,000, -100,000, 0 COP) | Task 13a (the twin), Task 13b (the use case) | Task 13a (SQL against the twin), Task 14 |
| | History is limited to a period (2 entries, closing -100,000 COP) | Task 13b | Task 14 |
| | Deleted movements are not returned (-150,000, -50,000 COP) | Task 13b | Task 13a (a soft-deleted row in SQL), Task 14 (`DELETE …/transactions/{id}`) |
| | Notes: `GetMemberBalanceHistory` with a window function ordered by date then createdAt; the endpoint with `from`/`to`; the opening balance is the net as of the day before the period | Task 13b (opening of a later and of a quiet period) | Tasks 13a, 14 |

No scenario of HU-E4-11 … HU-E4-13 or HU-E5-04 is left without a test. M4 (E7) and the web UI (E9) are not planned here (see Out of scope).

### Review Focus pins

| Review Focus | Pinned by |
|---|---|
| 1. Two scheduler runs, or a run and a member, at the same time | Task 12 "records the 2026-12-01 Rent once when two runs meet" (red without `FOR NO KEY UPDATE` in `lockForWrite`), "makes a run wait for a pause in progress" (red without it), "lets a confirm and a skip … take turns" (red when `findOccurrence` ignores `lock`); Task 3c "keeps one occurrence per recurrence and date" (the unique key); Task 9a "never starts a run while the previous one is still going"; Task 8b "records nothing twice" |
| 2. Dates on the schedule's and the period's edges | Task 1 (MONTHLY(31), 29 February, SEMI_MONTHLY(30, 31), an inclusive end); Task 2a (a start before the definition day, an end on a schedule date); Task 2b (resume before the first date); Task 8b (end date, a CLOSED period's dates, the paused span); Task 9b (a catch-up run over a plan CLOSED after its period, the end date); Task 10 (2026-12-28 recorded, 2027-01-02 `InvalidOccurrenceDate`); Task 11b (a date in the next period over HTTP) |
| 3. Members who leave and roles that change | Task 2b (`blockerOf`); Task 4 (Ana cannot define Juan's account as payer); Task 5 (`canModify`, D9 on amounts, resuming after Juan left); Task 6e (D9 for Juan's account over HTTP); Task 7a (an ADMIN changing Ana's amount); Task 7b (a MEMBER managing someone else's recurrence); Task 8a (D9 for someone else's account); Task 8c (Juan leaves, Pedro is removed, Ana leaves, Luis leaves a split, Juan becomes a VIEWER); Task 10 and Task 11b (Sofi, Juan confirming Ana's debit) |
| 4. Money split per period and rounded | Task 8a (the default split, an explicit split, the fund's warning); Task 8b and Task 9b (40/60 then 50/50, the edited Rent); Task 10 and Task 11b (205,300 → 82,120 / 123,180 COP); Tasks 13a, 13b and 14 (running balances, the soft-deleted expense) |
| 5. Identifiers from elsewhere and archived spaces | Task 3b and Task 3c (malformed and foreign ids answer `null`, `[]`, an empty map); Task 4 (another space's fund, another space's category); Task 5 and Task 6f (`RecurrenceNotFound`; Task 6f also reads an archived space's recurrences); Task 6e (another household's fund, an archived space); Task 7a (another space); Task 7b (every move in an archived space); Task 8c (an AUTO occurrence of an archived space pauses its recurrence with `SpaceArchived`); Task 11a (`OccurrenceNotFound`, an archived space lists but refuses a skip); Task 13a (an empty history for malformed ids); Task 13b (a member of another space, a non-member); Task 14 (`MemberNotFound`, `SpaceNotFound`) |

### Spec contradictions found

1. **HU-E4-12's note** ("Runs behind a `Scheduler` port (adapter: in-container cron job) … No public endpoint triggers it") **vs D18** (one Next.js deployable; no worker process or cron service exists) and the brief's alternatives (a job in the BFF, catch-up on reads or writes, an endpoint a cron calls). **Ruled by the controller (P20):** accepted that `MaterializeDueOccurrences` runs in the app container, started by `src/instrumentation.ts` after the environment check, through the kernel's `Scheduler` port and a `TimerScheduler` that runs it at once (catch-up after a restart) and then every `RECURRENCE_JOB_INTERVAL_SECONDS` (default 300, `0` off) after each run ends; each recurrence is handled in its own transaction under its row lock (`FOR NO KEY UPDATE`, read under the lock), its `due_from` cursor moves past the dates handled (at most 24 a run), and `recurrence_occurrences_date_uq (recurrence_id, occurrence_date)` refuses a second occurrence of a date, so the job is idempotent and safe in two containers at once. Alternatives rejected: an endpoint a cron container calls (forbidden by the note; one more service and a secret), and catching up on reads or writes (reads that write, slower requests, nothing recorded in a space nobody opens).
2. **Spec 5.2 Recurrence** ("split method and values", so any of `EQUAL`, `PERCENT`, `EXACT`, `SHARES`, `BY_ALLOCATION`) **vs ruling P16** (a client never requests `BY_ALLOCATION`; it gets it by sending no split) and HU-E4-13 (a CONFIRM recurrence's amount is an estimate; PATCH changes the amount). **Ruled by the controller (P23):** accepted that a recurrence without a split takes the default split of each occurrence (spec 5.3: `BY_ALLOCATION` with the ACTIVE plan of its period, else `EQUAL` among the current members), which is how HU-E4-12's "split `BY_ALLOCATION`" is defined; that an explicit split is `EQUAL`, `PERCENT` or `SHARES` (ratios that follow any amount); and that `EXACT` is not offered (`422 ValidationFailed`), since fixed amounts would refuse every confirmed or edited amount; and amend spec 5.2 (Task 9b).
3. **Spec 5.2** ("missed runs are caught up") **vs HU-E4-11** ("Pausing skips the paused span without back-filling") and a start date before the definition day. **Ruled by the controller (P24):** accepted that a recurrence is due from its start date or its definition day, whichever is later (it never back-fills days before it existed; past movements are recorded as transactions); that missed runs are caught up from `due_from`, the first date not considered yet; that pausing stops at once, so every date not recorded yet is skipped until it resumes, and resuming continues from the resume day; and that an edit applies to every occurrence not recorded yet (a recorded one is a snapshot); and amend spec 5.2 (Task 9b).
4. **HU-E4-13's note** ("Confirming reuses the recurrence template") **vs D9** (only an account's owner records a debit from it) and the matrix (who records an AUTO occurrence, which has no requester). **Ruled by the controller (P21):** accepted that every AUTO occurrence is recorded by `RecordExpense` (or `RecordIncome`, `RecordTransfer`, `RecordFundContribution`) on behalf of the member who defined the recurrence, and every confirmation on behalf of the confirming member, so the matrix, archived spaces, D9, closed periods and default splits apply unchanged; that a definition is checked as recording would check it, for the definer (only the payer defines a recurrence paid from their own account; anyone who records money may make the fund pay or pay for a guest); and that Juan cannot confirm Ana's Bancolombia electricity (`AccountNotOwned`); and amend spec 5.2 (Task 9b). The alternative is a system actor that bypasses the ledger's checks.
5. **HU-E4-11's note** ("If the paying member leaves the space, the recurrence is paused with reason `PayerLeft`") **vs the module boundaries** (`spaces`' `LeaveSpace` and `RemoveGuestMember` cannot call the ledger, which imports `spaces`) and the brief's "former members" question. **Ruled by the controller (P26):** accepted that every scheduler run pauses an active recurrence whose paying member (an expense's payer or a contribution's member, guests included) is no longer a current member (`PayerLeft`), or whose creator is not (`CreatorLeft`), even with nothing due, storing its due date `SKIPPED` with that reason; that an AUTO date refused for any other reason (an archived account, category or space, a split participant who left, a creator who became a VIEWER) pauses the recurrence with that code at the first refused date; that resuming checks the template again (`NotASpaceMember` while the payer or creator is gone); and that default splits follow the current members when each occurrence is recorded. Cost: a pause shows within one run (5 minutes by default) of the departure, not at once. The alternative is a `MemberLeftListener` port on the two `spaces` use cases (follow-up 11).
6. **Spec 7** ("Pagination: cursor-based") **vs the new lists** (`GET …/recurrences`, `GET …/pending-occurrences`, the balance history). **Ruled by the controller (P28):** accepted no pagination: a space has a handful of recurrences, pending occurrences last until confirmed, and the history is bounded by `from` and `to`; the alternative is the cursor convention on all three (follow-up 2).
7. **HU-E4-12** ("an expense … is recorded and linked to the recurrence"; "recorded occurrences are read through `GET …/transactions`") **vs the `Transaction` component** (no recurrence field) and spec D8's audit model. **Ruled by the controller (P31):** accepted that the link lives in `recurrence_occurrences.transaction_id` and every recurrence read shows its `lastOccurrence` (date, status, `transactionId` or skip `reason`), while the transaction itself is read unchanged through `GET …/transactions`; the alternative is a `recurrence_id` column on `transactions` and a new `Transaction` field (follow-up 1).
8. **Spec 7** ("`ETag` / `If-Match` on updates of transactions and plans") **vs recurrences** (not named) and the status convention (`Invalid*` → 422) for a refused move. **Ruled by the controller (P27):** accepted no `ETag`/`If-Match` on recurrences (their writes take turns on the row lock), `InvalidRecurrenceTransition` as an explicit 409 like `InvalidPlanTransition` (P12), `RecurrenceEnded` (409) for an edit of an ended recurrence, `OccurrenceNotPending` (409), `RecurrenceNotFound` and `OccurrenceNotFound` (404), `InvalidRecurrence` and `InvalidOccurrenceDate` (422); pause and skip reasons are codes, never errors.

### Assumptions

1. **Closed periods** (Tasks 8b, 9b, 10, 11b). An AUTO or CONFIRM date inside a CLOSED plan's stored period is stored `SKIPPED` with reason `PeriodClosed`, reported and logged, and the recurrence goes on; a pending occurrence whose period closed later cannot be confirmed (`PeriodClosed`) but can be skipped (skipping records nothing); dates in DRAFT or ACTIVE plans, or with no plan, are recorded. **Ruled by the controller (P25):** accepted; the alternative (pausing on a closed period) would stop a monthly rent for good after one late close.
2. **Who manages a recurrence** (Tasks 4, 5, 10). Defining, confirming and skipping are `money.record`; editing, pausing, resuming and ending follow `canModify` (its creator, or OWNER and ADMIN); reads are `space.read`; the pending list needs `money.record` but reads with `readOnly` access (archived spaces list it). **Ruled by the controller (P30):** accepted; it reuses the transaction rules (HU-E4-06) and adds no matrix action.
3. **Balance history scope** (Tasks 13a, 13b, 14). Any member reads the history of any current member, guests included (balances are visible to every member, HU-E5-01); entries are the member's non-zero movements, in date, creation and id order; `opening` is the net as of the day before `from`, `closing` the last balance; former members answer `MemberNotFound`. **Ruled by the controller (P29):** accepted; the alternatives are own-history only (the backlog's "As a member, I want to see how my balance … evolved") and former members' history (follow-up 3).
4. **The template's identity** (Tasks 2a, 2b, 5, 7a). The type, payer and accounts never change; PATCH changes description, amount, category (expenses, incomes), split (expenses), schedule, mode and end date; an amount debited from a member's own account is changed by its creator only (`AccountNotOwned`). **Ruled by the controller (P22):** accepted; changing a payer is ending one recurrence and defining another, which keeps D9's consent with the account's owner.
5. Every M3-C acceptance file runs its container on the definition day, 2026-10-28 noon in Bogotá (M3-B's `ContainerOptions.clock` test seam): a fixed clock, or in Tasks 9b and 11a a `MovableClock` that the tests closing a plan move past its period first (M3-B's P17 as amended), because P24 makes a recurrence's first date depend on its definition day; the scheduler's day is passed explicitly (`materializeDueOccurrences({ today })`).
6. The in-memory transaction manager rolls nothing back; every refusal in this plan happens before the use case writes, so unit tests see the same state as PostgreSQL, whose refusals roll back.
7. One run handles every active recurrence of every space in sequence, one transaction each; at household scale (tens of recurrences) a run takes well under a second. A recurrence whose end date passed with no date left stays in `listActive` (its status is derived ENDED) and costs one locked read per run, for good: its `due_from` never passes `end_date` (preflight N8, follow-up 13).
8. `APP_TIMEZONE` is every space's timezone in v1 (as in M1): the job's day and every definition, pause and resume day are read in it.
9. A recurrence's description is required (1–200 characters), unlike a transaction's, because recurrences are listed by name.
10. A category deleted logically or archived after a recurrence names it makes the next AUTO occurrence refused (`CategoryNotFound`, `CategoryArchived`) and pauses the recurrence (P26); deleting a category does not count recurrences as references (follow-up 5).
11. HU-E5-04 is an M2 story (Should) delivered here, as briefed; its milestone row stays M2.

### Follow-ups

1. A `recurrenceId` on transactions (a column and a `Transaction` field) if the transaction list must filter by recurrence (P31).
2. Cursor pagination of recurrences, pending occurrences and the balance history (P28).
3. The balance history of former members (P29).
4. A preview of a schedule not yet defined for HU-E9-09's "The schedule preview clamps short months" (`GET …/schedule-preview` or client-side `scheduleDates`).
5. Count recurrence templates as category references in HU-E3-03's delete (assumption 10).
6. Notify members of pending occurrences and of paused recurrences (HU-E8-08).
7. Show pending occurrences as "expected" in the line dashboard (HU-E7-01, HU-E4-13's note).
8. Move `src/modules/budgeting/infrastructure/concurrent-plan-writes.int.test.ts` onto `tests/support/locks.ts`.
9. WEEKLY and BIWEEKLY schedules (HU-E8-09).
10. Mark HU-E4-11 … HU-E4-13 and HU-E5-04 `Done` in `docs/backlog/README.md` when the pull request merges.
11. Pause recurrences at once when their payer or creator leaves, through a `MemberLeftListener` port on `LeaveSpace` and `RemoveGuestMember` (P26).
12. Recurring settlements, if a household asks for them.
13. Set `ended_at` when a recurrence's last date is considered, so `listActive` stops returning it and its locked read per run ends (assumption 7, preflight N8).
14. Sort `components.schemas` keys in the snapshot writer of `src/composition/openapi.test.ts` (one reorder-only chore commit), so a component's first use never moves it; evaluate before M4 adds components (controller ruling on preflight B6).

### Placeholder and consistency scan

- No "TBD", "TODO", "similar to Task N" or step without its code; every code step names its file and anchor, every test step its command and expected outcome.
- Names used across tasks match their definitions: `Schedule`, `scheduleOf`, `firstDateFrom`, `scheduleDates` (Task 1); `RecurrenceId`, `RecurrenceMode`, `RecurrenceType`, `RecurrenceStatus`, `RecurrenceSplit`, `RecurrenceTemplate`, `Recurrence`, `NewRecurrence`, `MAX_UPCOMING`, `defineRecurrence`, `upcomingDates`, `statusOf`, `RecurrenceChanges`, `revisedRecurrence` (Task 2a); `pausedRecurrence`, `resumedRecurrence`, `endedRecurrence`, `debitsPersonalAccount`, `payerOf`, `blockerOf`, `OccurrenceId`, `OccurrenceStatus`, `Occurrence`, `recordedOccurrence`, `pendingOccurrence`, `skippedOccurrence`, `confirmedOccurrence`, `skippedByMember` (Task 2b); `recurrences`, `recurrenceOccurrences`, the integration test's `fixture` (Task 3a); `ActiveRecurrence`, `RecurrenceRepository`, `DrizzleRecurrenceRepository`, `InMemoryRecurrences`, the integration test's `recurrence`, `everyShape`, `storeInBoth`, `tm`, `repo` (Task 3b); `OccurrenceRepository`, `RecurrenceDeps` (Task 3c); `TemplateInput`, `withContributor`, `TemplateOwner`, `checkTemplate`, `RecurrenceView`, `recurrenceView`, `viewsOf`, `DefineRecurrenceInput`, `DefineRecurrence`, `createDefineRecurrence`, `MovableClock`, `recurrenceWorld`, `rentDefinition` (Task 4); `RecurrenceWriteInput`, `RecurrenceEdit`, `UpdateRecurrence`, `PauseRecurrence`, `ResumeRecurrence`, `EndRecurrence`, their `create…` factories, `ListRecurrences`, `GetRecurrence`, `ListUpcomingOccurrences` and theirs (Task 5); `ScheduleInputSchema`, `RecurrenceSplitSchema`, `splitOf`, `DefineRecurrenceBodySchema`, `recurrenceFromBody` (Task 6a); `ScheduleSchema`, `OccurrenceSchema`, `occurrenceDto`, `RecurrenceSchema`, `recurrenceDto` (Task 6c); the `Recurrence` component (Task 6d); `recurrenceHeaders`, `DEFINITION_DAY_CLOCK` (Task 6e); `recurrencesPaths`, `recurrenceResponse`, `TEMPLATE_404`, `TEMPLATE_409`, `TEMPLATE_422`, the `RecurrenceDefinition` component (Task 6e2); `RecurrencePath`, `RecurrenceListSchema`, `UpcomingOccurrencesQuerySchema`, `UpcomingOccurrencesSchema` (Task 6f); `UpdateRecurrenceBodySchema`, `recurrenceEditFromBody` (Task 7a); `OccurrenceRecorders`, `occurrenceRecorders`, `RecordedOccurrence`, `recordOccurrence` (Task 8a); `CATCH_UP_LIMIT`, `MaterializeDeps`, `RecurrenceRun`, `materializeRecurrence`, `MaterializationReport`, `MaterializeDueOccurrences`, `createMaterializeDueOccurrences`, `BudgetingStandIn`, `materializerWorld` (Task 8b); `RecurrenceRun.pausedFor` and `MaterializationReport.paused` carrying `PayerLeft`, `CreatorLeft` and refusing codes (Task 8c); `Scheduler`, `TimerScheduler`, `RecurrenceJobDeps`, `startRecurrenceJob`, `RECURRENCE_JOB_INTERVAL_SECONDS` (Task 9a); `transactionsIn`, `homePlan` (Task 9b); `PendingOccurrenceView`, `ListPendingOccurrences`, `ConfirmOccurrenceInput`, `ConfirmedOccurrence`, `ConfirmOccurrence`, `SkipOccurrence` and their factories (Task 10); `PendingOccurrenceListSchema`, the `Occurrence` component (Task 11a); `ConfirmOccurrenceBodySchema`, `confirmationFromBody`, `recordedOccurrenceDto` (Task 11b); `until`, `someoneWaitsFor`, `holder`, `outcomesOf` (Task 12); `HistoryRange`, `BalanceMovement`, `MemberBalanceHistory`, `memberHistory` (Task 13a); `BalanceEntry`, `BalanceHistorySource`, `BalanceHistoryDeps`, `MemberBalanceHistoryView`, `GetMemberBalanceHistory`, `createGetMemberBalanceHistory` (Task 13b); `BalanceHistoryQuerySchema`, `BalanceHistorySchema`, `balanceHistoryDto` (Task 14).
- `Container.ledger` keys: `defineRecurrence` (6e), `listRecurrences`, `getRecurrence`, `listUpcomingOccurrences` (6f), `updateRecurrence` (7a), `pauseRecurrence`, `resumeRecurrence`, `endRecurrence` (7b), `materializeDueOccurrences` (9a), `listPendingOccurrences`, `skipOccurrence` (11a), `confirmOccurrence` (11b); `Container.balances.getMemberBalanceHistory` (14). Container locals: `recurrenceRepository`, `recurrenceDeps` (6e), `materializeDeps` (9a). Every route calls one of them; no route triggers the job.
- Test support: `InMemoryRecurrences` (3b, 3c), `MovableClock`, `recurrenceWorld`, `rentDefinition` (4), `BudgetingStandIn`, `materializerWorld` (8b) in `tests/support/in-memory-recurrences.ts`; `OccurrenceDto`, `RecurrenceDto`, `DEFINITION_DAY_CLOCK`, `HouseholdWithFund`, `householdWithFund`, `recurrencesPath`, `rentBody`, `postRecurrence`, `defined`, `archiveHousehold` (6e), `listRecurrences`, `getRecurrence`, `recurrenceOf`, `upcoming` (6f), `patchRecurrence` (7a), `pauseRecurrence`, `resumeRecurrence`, `endRecurrence` (7b), `transactionsIn`, `homePlan` (9b), `pendingIn`, `pendingOf`, `skipOccurrence` (11a), `confirmOccurrence` (11b) in `tests/support/recurrences.ts`; `memberHistory` on `InMemoryTransactions` (13a); `tests/support/locks.ts` (12); `RECURRENCE_JOB_INTERVAL_SECONDS: 0` in `tests/support/app.ts` (9a). The containers of `recurring-occurrences.test.ts` (9b) and `pending-occurrences.test.ts` (11a) run on Task 4's `MovableClock`.
- Error codes and statuses: `InvalidRecurrenceTransition` (409, explicit, Task 7b), `RecurrenceNotFound` (404), `RecurrenceEnded` (409), `InvalidRecurrence` (422), `OccurrenceNotFound` (404), `OccurrenceNotPending` (409), `InvalidOccurrenceDate` (422), all pinned in `problem.test.ts` (Tasks 7b, 11a) and listed in the OpenAPI problem descriptions and the backlog notes; `MemberNotFound` (404, existing) for the balance history. Reason codes `PayerLeft`, `CreatorLeft` and `PeriodClosed` appear only as `pauseReason` and `reason`.
- Migrations: one, `0011_recurrences` (Task 3a). OpenAPI components added: `RecurrenceDefinition` (Task 6e2, request only, with its first operation), `Recurrence` (Task 6d) and `Occurrence` (Task 11a, with its first operations), responses only; no `…Output` variant.
- Tasks and commits: 28 tasks, one commit each (no 6b; 6e2 added by preflight B6), in the order 1, 2a, 2b, 3a, 3b, 3c, 4, 5, 6a, 6c, 6d, 6e, 6e2, 6f, 7a, 7b, 8a, 8b, 8c, 9a, 9b, 10, 11a, 11b, 12, 13a, 13b, 14; each commit message references the issues of the task-to-issue map.
- Open controller proposals: P20 – P31 (none blocks execution; each task states the behaviour it implements).
