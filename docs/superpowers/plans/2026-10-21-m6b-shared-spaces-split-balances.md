# M6b Shared Spaces, Split Expenses and Balances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the household half of Hearth's web UI (milestone M6b): a person creates a shared space from the space switcher, invites people by link or email, adds guests, hands a guest a claim link and removes a settled guest, with every control following their role, and a visitor opens a public invitation or claim page, signs up and comes back to accept it (HU-E9-05, #73); a member records a shared expense with a payer, participants and every split method with a live preview, the plan's default split preselected, a saved-with-warning state when the shared fund goes negative, and a split with one person from the personal space (HU-E9-06, #74); and a member reads who owes whom, settles from a suggestion through a prefilled form, records a guest's payment without an account, and reads a member's balance history (HU-E9-07, #75).

**Architecture:** Everything M6a built stays the frame: the UI talks only to `/api/v1` through the generated client (ruling P117), Server Components read over loopback and every write runs in the browser, with no server actions. Containers are a pure `load*` function over the `Api` plus an async component (P127), exported from each module's `ui/server.ts` (P153). New UI lives in `src/modules/spaces/ui` (members, invitations, the new-space form, the invitation and claim pages), `src/modules/ledger/ui` (the split editor, the shared expense, the split with one person, the saved-with-warning notice) and a new `src/modules/balances/ui` (balances, settle-up, history). Two small API changes come first, each with TDD: a pending-invitations list for the members screen (Task 1) and public previews of an invitation and of a claim link for the pages a visitor opens without a session (Task 2, rulings P155 and P156). The split preview runs in the browser with the same rounding as the server's `splitShares` (largest remainder, whole pesos for COP, join order), pinned by a parity test against the domain, while the server's result stays authoritative (P166). New routes get script budgets that fail CI like M6a's (P134, P154, P177).

**Tech Stack:** unchanged from M6a: Node.js 24.21.0, pnpm 12.11.2, Next.js 16.4.0, React 19.3.0, TypeScript 6.0.3 strict, Zod 4.6.5 (server only), next-intl 4.14.9, Tailwind CSS 4.3.3, `radix-ui` 1.7.0, `openapi-typescript` 7.13.0 + `openapi-fetch` 0.17.0, Vitest 5.0.3 with jsdom 30.1.2 and Testing Library, axe-core 4.13.0, Playwright 1.63.0 with `playwright-bdd` 9.2.1 and `@axe-core/playwright` 4.13.0, Lighthouse 13.5.0 and `web-vitals` 6.2.3, PostgreSQL 18.6. **No new dependency.**

**Spec:** `docs/superpowers/specs/2026-10-11-hearth-design.md` (D2 a personal space is a shared space with one member; D4 a line's allocation is the default split; D5 fund-paid expenses create no debt; D9 a member moves money only through accounts they own; D15 guests; D16 direct spaces; spec 5.2 payments and shares, 5.3 the split rules). Stories: `docs/backlog/E9-web-ui.md` (the epic's rules, HU-E9-05, HU-E9-06, HU-E9-07; every dependency is `Done`). **Reference design:** the canvas "Hearth Web UI — Batch 2" (https://claude.ai/artifact/9hMXNC2hevXLDhBw3H8h78), files in `.superpowers/sdd/design-batch2/` (`canvas.json` and one `*.dc.html` per artboard). M6b uses the artboards Main (the members screen), Invite, AddGuest, GuestSheet, NewSpace, InvitePage, SharedExpense, Split, SplitWithPerson, FundWarning, Balances, SettleUp and BalanceHistory. The owner has not reviewed Batch 2 formally; their standing instruction (Log L1, below) makes the canvas the reference design, the story wins where they disagree, and every deviation is listed in the Self-Review for the owner's end review. Format template and precedent: `docs/superpowers/plans/2026-10-20-m6a-web-shell-and-ledger.md`. Rulings in force: P1–P154 (P117–P154 are M6a's, indexed in `docs/decisions/README.md`); this plan rules **P155–P183**. M6c (HU-E9-08, HU-E9-10, HU-E9-11) is planned in parallel from P200. GitHub Project: https://github.com/users/Facabore/projects/4.

**Baseline: `development` after M6a's Task 19 commit** (`origin/development` at `aed175b` plus Task 19's commit `ci(web): fail the build on Core Web Vitals and script budgets, and document M6a`). The local checkout `C:/Things/hearth` was at `fcc4ff8` (M6a Task 9) while planning: the controller fast-forwards it first (`git pull --ff-only`) and starts from the commit that holds Task 19. Verified on that state while planning (worktree `hearth-worktrees/ship`):

- the snapshot has 84 operations and its descriptions name 121 error codes counting `Unknown` and `InternalError` (`errorCodesOf`); the latest migration is `0019_account_style_vocabulary`; `RecordedExpense.warnings[].code` is the only warning enum (`FundBalanceNegative`);
- there is no endpoint that lists a space's invitations and none that reads an invitation or a claim link without accepting it; `InvitationRepository` has `add`, `findForUpdate`, `findByTokenHashForUpdate` and `save`; `GuestClaimRepository` has `spaceKindOf`, `claimGuest` and `adoptPairKey`; invitation and claim URLs are `<BETTER_AUTH_URL>/invitations/<token>` and `/claims/<token>` (`container.ts` lines 620 and 632), and only the token's SHA-256 is stored, so a URL can be shown only once;
- `POST …/expenses` takes `payments` and `split` (EQUAL, PERCENT with `percent` strings, EXACT with `amount`, SHARES with `units`) and applies the default split (BY_ALLOCATION or EQUAL among every current member) when `split` is absent; a registered payer pays from an account they own and only its owner records the debit (`partyAccount`, D9), a guest pays with `accountId: null`, the fund pays with `memberId: null`; its 201 answer carries `warnings`;
- `GET …/default-split?categoryId&date&amount` answers `method`, `availableMethods` (BY_ALLOCATION only when it is the default), `lineId` and `shares` (null without `amount`);
- `POST /api/v1/direct-splits` takes `counterpart` (`MEMBER` with `memberId`, or `GUEST` with `displayName`), `categoryKey`, `amount`, `accountId` and the time fields, and no split (always EQUAL between the two); a direct space is named `"<creator> & <other>"`;
- `POST …/settlements` takes `payerMemberId`, `receivingMemberId`, optional `sourceAccountId` (only the payer's own, never a guest's) and `destinationAccountId`; `GET …/balances` answers `members[{ memberId, net }]`, `GET …/balances/suggestions` answers `suggestions[{ payerMemberId, receivingMemberId, amount }]`, `GET …/members/{memberId}/balance-history?from&to` answers `opening`, `closing` and `entries[{ transactionId, type, date, description, change, balance }]`;
- `OutstandingBalance` problems carry `outstanding: Money` as a public extension member (`publicDetailsOf`); the permission matrix (`src/modules/spaces/domain/permissions.ts`) gives `member.invite` to OWNER and ADMIN, `guest.add` and `guest.remove` to OWNER, ADMIN and MEMBER, `member.changeRole` to OWNER;
- in the UI: `auth-redirect.ts` treats only `/sign-in` and `/sign-up` as public; `SignUpFormContainer` always lands on `/`; `NavLinks` renders Inicio, Registrar and Movimientos; `ProfileSheet` links Settings and Accounts; `SpaceSwitcher` lists spaces only; `Problem` has `code`, `status`, `requestId`, `errors` and `field`; `tests/performance/budgets.json` lists seven routes (P154's values); `.dependency-cruiser.cjs` excludes `\.test\.(ts|mjs)$` but not `.test.tsx`, so a test that imports a module's domain to pin a UI copy is a `.test.ts` file (M6a's precedent: `account-fields.test.ts`).

**Out of scope (later plans or follow-ups):** HU-E9-08, HU-E9-10 and HU-E9-11 (M6c: the Plan tab, the planner and the dashboards); HU-E9-04, HU-E9-09, HU-E9-12 and HU-E9-14; editing, deleting and restoring transactions (M6a's follow-up 2 stays a follow-up, ruling P179); space settings (rename, currency, period policy), leaving and archiving a space; more than one payer per expense (spec 5.2: v1 offers one); a date picker in the settle-up form (P174); the Balances artboard's cross-space hint ("En Hogar: debes …"); sending invitation emails (P144: Hearth sends no mail yet). Of ruling P126's deferred controls, the ones these three stories need are built here (the Members entry, create in the space sheet, the split and the Saldos tab); the rest stay deferred.

### Log

- **L1**, the owner, 2026-10-20: "Tu enfoque es terminar lo que tenemos en las HUS siempre con TDD y RDD, tienes granted para todo, resolvé con lo que tengas, luego al final organizamos las ideas de cosas pendientes"
- **L2**, the controller, 2026-10-21: the M6b plan covers HU-E9-05, HU-E9-06 and HU-E9-07; the canvas is the reference design, the story wins, every deviation goes to the Self-Review; no question to the owner unless it blocks. The other Batch 2 stories are M6c's.

## Global Constraints

- Versions: exactly M6a's (`docs/stack-versions.md`). **No new dependency** of any kind; `pnpm check:pinned` passes and `pnpm-lock.yaml` is unchanged by every task. The clipboard is `navigator.clipboard`, the debounce a `setTimeout`, the sheets M6a's lazy `Sheet`.
- **The UI talks only to `/api/v1` through the generated client** (P117): no server action, no route handler written for the UI, no import of `src/composition`, of a module's `domain`, `application`, `infrastructure` or `contracts`, of `src/shared/http` or `src/shared/infrastructure` from any UI folder (P119, `pnpm lint:boundaries`). A module's ui reaches another's only through `ui/index.ts` (client-safe) or `ui/server.ts` (containers, P153). A test that pins a UI copy of a domain rule is a `.test.ts` file.
- **Every UI string is translatable** (es default, en): visible text, `aria-label`s, placeholders and `<title>`s come from `src/i18n/messages/{es,en}.json`; `pnpm i18n:check` fails on a key in one catalog only, on an error code without `errors.<Code>` and, from Task 4, on a warning code without `warnings.<Code>` (P170). User data (space, member, account and category names, the seeded "Personal") is shown as stored. **Spanish copy is neutral Latin American Spanish with tú** ("Inicia sesión", "Elige", "Pídele"), never voseo.
- **Formats come from the effective preferences** (P121): amounts, dates and times only through `src/shared/ui/format/`; amounts on the wire stay `{ amount: "<minor units>", currency }` and are parsed with `BigInt`, never `Number`. A visitor without a session reads `BUILT_IN_FORMATS` and the installation's zone (`serverZone()`, P182).
- **Signed amounts are sentences** (HU-E9-07): "debe", "le deben", "a paz y salvo" and every balance or suggestion text come from i18n keys with the amount as a placeholder, never by concatenating a sign and a string (P173).
- **The server is authoritative** for money: the split preview mirrors `splitShares` (P166) but the request carries the person's choices, never the previewed shares; an API problem is shown next to its field (P118), never a raw code.
- **Accessibility:** every control has a label, every screen works with the keyboard alone, focus is visible, touch targets are at least 44 px, contrast meets WCAG AA in light and dark themes. Component tests run `axeViolations`; the e2e run scans every new screen and sheet in light and dark (Task 21).
- **Performance budgets fail CI** (P134, P154): every new route has a script budget in `tests/performance/budgets.json` (Task 21, P177); a route without one fails. Server Components by default; the split editor and the split-with-person sheet load behind `next/dynamic`, so the personal record form keeps its M6a budget.
- Hexagonal boundaries (ADR 0001) stay as they are for the backend; Tasks 1–2 follow the conventions of M6a's Tasks 1–3 (the use case authorizes, `problem+json` with stable codes, `openapi/openapi.snapshot.json` regenerated, never edited by hand, and `src/shared/ui/api/schema.d.ts` regenerated with `pnpm api:types` in the same commit, P139).
- Strict TDD: every behaviour starts with a failing test that is run and seen failing. Pure UI logic in `*.test.ts` (Vitest `unit`), components and containers in `*.test.tsx` (Vitest `ui`), `@e2e` scenarios in Playwright + playwright-bdd against the standalone build and a disposable PostgreSQL.
- Code, identifiers, comments, docs and generated artifacts in English; UI copy in the catalogs. Conventional commits referencing the story issue (`Refs #<n>`); no AI attribution and no `Co-Authored-By` lines (the owner's global rule).
- Agents never read or edit `.env`, `.env.*` or `.env.production.example` (P114). M6b adds no environment variable; `serverZone()` reads the existing `APP_TIMEZONE`.
- Gates for every task: `pnpm exec vitest run --project unit`, `--project ui`, `--project integration`, `--project acceptance`, `pnpm format`, `pnpm exec eslint .`, `pnpm exec tsc --noEmit`, `pnpm exec prettier --check .`, `pnpm lint:boundaries`, `pnpm db:check`, `pnpm check:pinned`, `pnpm api:check`, `pnpm i18n:check`; from Task 5 on also `pnpm build && pnpm test:e2e` (Docker running); Task 21 adds `pnpm perf`. The `operations` project is unchanged and still runs in CI.

## Review Focus

1. **Money splitting and rounding.** 300,000 COP EQUAL among three people, 100,000.01 COP among two, PERCENT 33.33 / 33.33 / 33.34, SHARES 2/1/1 of 90,000, an EXACT split one peso short, participants chosen in an order other than the join order, and an amount too small to give everyone a positive whole-peso share. Expected: the browser's preview equals the domain's `splitShares` share for share (whole pesos for COP, the leftover to the largest remainders, the sub-peso units to the first participant in join order), an invalid split cannot be saved and says what is missing ("Falta asignar 10 %"), and the body carries percents, amounts or units, never the preview — pinned in Task 11 (the parity table against `@/modules/ledger/domain/split`), Task 12 (the sheet's status line and Listo) and Task 13 (the save button and the body).
2. **Public pages and tokens.** `GET /api/v1/invitations/{token}` and `/claims/{token}` without a session, a claim token at the invitation endpoint and the reverse, an unknown token, a revoked, used or expired invitation, an email invitation (its address must never be in the preview), `next=/invitations/<token>` after sign-up and sign-in, `/invitations/x` without a cookie, a signed-in person on an invitation page. Expected: the previews answer only the space's name, the inviter's display name, the role (or the guest's name), the status and the expiry; a wrong-kind or unknown token answers 404 `InvitationNotFound`; the open pages render with and without a session and never loop; `safeNext` keeps refusing everything but same-origin paths — pinned in Task 2 (unit, integration and acceptance tests), Task 3 (`redirectFor`, `safeNext`, sign-up `next`) and Task 9 (the page states).
3. **Who may pay with what (D9).** A registered member other than the recorder as payer, a guest with an account, the fund as payer with a payer member, another member's account, an archived account. Expected: the form offers only the recorder (with accounts they own: their personal space's and their own accounts in this space), the space's guests (no account) and the space's active shared funds (no payer member); the API's `AccountNotOwned`, `GuestHasNoAccounts` or `InvalidFundAccount` would show next to the payer if they ever came back — pinned in Task 11 (`sharedPartsOf`), Task 13 (the payer list) and Task 18 (the settle-up accounts).
4. **Role-gated controls.** OWNER, ADMIN, MEMBER and VIEWER on the members screen of a shared space, anyone in a direct space, an owner on their own row. Expected: exactly the controls the permission matrix allows (MEMBER: Add guest, no Invite; VIEWER: none; role changes only for OWNER and never on their own row; no invite or guest controls in a direct space), hidden rather than disabled, the UI copy of the matrix equal to the domain's — pinned in Task 6 (the `SPACE_CONTROLS` parity test and the screen tests).
5. **Double submits and stale answers.** A double click on Create link, Add guest, Save expense, Save and split, Save payment; a default split answered for an amount the person already changed; a retry after a network failure. Expected: one invitation, one guest, one expense, one direct split, one settlement (the money writes keep one `Idempotency-Key` per draft, P128; the others disable their button while pending); a stale default split never replaces a newer one — pinned in Tasks 7, 8, 12, 13, 15 and 18.
6. **Signs and sentences.** A member who owes, one who is owed, one settled, a negative fund, a balance history whose running balance crosses zero, in Spanish and English. Expected: "debe $ 100.000" / "owes $ 100,000", "le deben" / "is owed", "a paz y salvo" / "settled up", "−$ 500.000" in the fund warning, and `+$ 50.000` / `−$ 150.000` changes, all from keys and the formatters — pinned in Task 14 (the notice), Task 17 (`netState` and the screen in both languages) and Task 19 (the history rows).

## Execution Workflow

- Work on the long-lived branch `development` from the baseline above; every task is implemented there with Strict TDD. Implementers stage; the controller commits.
- **This plan is committed before Task 1** (`docs(plans): add the M6b shared spaces, split and balances plan (Refs #73, Refs #74, Refs #75)`), because Task 22 adds it to the `mkdocs.yml` nav and links it from `docs/decisions/README.md`, and `mkdocs build --strict` fails on a page missing from the repository.
- **Issue numbers.** The plan assumes HU-E9-05 is #73, HU-E9-06 #74 and HU-E9-07 #75 (the E9 stories were opened in order after HU-E9-01 … HU-E9-03, which are #69–#71; HU-E9-04 would be #72). The controller confirms the three numbers on Project #4 before Task 1 and replaces them in every commit message if they differ.
- **RDD for every commit** (receipt-driven development is on; `gentle-ai review mode status` reads it). The owner's standing answer to a review consent envelope is `granted`. Each "Commit" step means:
  1. Run every source-mutating normalizer first (`pnpm format`; `pnpm api:types` when the snapshot changed), then stage exactly the task's files.
  2. Commit with the task's message.
  3. Run `gentle-ai review assess --cwd . --agent claude-code --base-ref <last reviewed boundary> --committed-only --json`. When `review_due` is true, or the task's Risk line names a high-risk item (add `--escalate-item <n> --escalate-reason "<the Risk line>"`), execute the returned `next_transition.command` with `--lenses` and `--lenses-reason` and follow only the transitions it returns until the exact acknowledgement. Record per commit the tier and outcome in `.superpowers/sdd/2026-10-21-m6b-shared-spaces-split-balances/progress.md`.
  4. If the owner disables RDD (`gentle-ai review mode disable --scope clone --cwd .`), commit under ordinary policy and report `disabled/unmanaged`.
- **Risk lines and verifiers.** Task 2 (`Risk: item 2`, two endpoints reachable without a session) and Task 3 (`Risk: item 2`, the proxy's session guard and the redirect after sign-up) each get their own commit and one independent verifier after their own checks. Every other task closes with `Risk: none`, its focused test and the suite run inline.
- Code blocks are complete where they decide something (configuration, scripts, pure functions the tests do not determine, exact copy, test files) and are not guaranteed to match Prettier's wrapping: run `pnpm format` before the gates. Every code block is introduced by a line naming its file in backticks; "Create" blocks are whole files; edits name a unique anchor ("after the line …", "replace the line …"). For React components the plan fixes the file, the exported name, the props, the roles and labels the tests query, the catalog keys with both translations, and the tests; the markup follows the named artboard and M6a's components.
- **Task labels and order:** 1 → 22 in order (22 commits; Tasks 6 and 9 have named split points). Tasks 1–2 are backend and land first; Task 3 before Task 9; Task 4 before every other UI task; Task 10's World helpers before Tasks 16 and 20.
- **Sizes (estimates, authored changed lines, excluding `schema.d.ts` and snapshot regenerations of more than 30 lines):** 1 ~260, 2 ~380, 3 ~220, 4 ~380, 5 ~380, **6 ~440** (split point in the task), 7 ~360, 8 ~390, **9 ~440** (split point in the task), 10 ~260, 11 ~380, 12 ~420, 13 ~400, 14 ~330, 15 ~420, 16 ~300, 17 ~380, 18 ~400, 19 ~320, 20 ~200, 21 ~380, 22 ~260. The controller measures each staged candidate (`git diff --cached --numstat`) before committing and splits at the named point when it is over ~500.
- The OpenAPI snapshot changes in Task 1 (`GET …/invitations`) and Task 2 (`GET /api/v1/invitations/{token}`, `GET /api/v1/claims/{token}`, components `InvitationPreview` and `ClaimPreview`); each regenerates `schema.d.ts` in the same commit.
- When a task starts, move its story issue to **In Progress** on Project #4. When all tasks are done, open one pull request from `development` into `main` that closes #73, #74 and #75 and completes the M6b part of milestone M6. Its description lists, as PR notes: (1) the two API changes and their public-endpoint review; (2) the new routes and their budgets; (3) the rulings P155–P183; (4) every design deviation of the Self-Review, for the owner's end review (L1); (5) the follow-ups.
- Task-to-issue map: HU-E9-05 (#73) → Tasks 1, 2, 3, 5, 6, 7, 8, 9, 10; HU-E9-06 (#74) → Tasks 4, 11, 12, 13, 14, 15, 16; HU-E9-07 (#75) → Tasks 17, 18, 19, 20; Tasks 21 and 22 reference all three.

## File Structure

```
.
├── openapi/openapi.snapshot.json                       # GET …/invitations (1); invitation and claim previews (2)
├── scripts/i18n-check.mjs (+ .test.mjs)                # warnings.<Code> required (4)
├── playwright.config.ts                                # the a11y project matches a11y*.spec.ts (21)
├── src/
│   ├── i18n/messages/{es,en}.json                      # every UI task adds keys: members, spaces, invitation, balances, warnings
│   ├── modules/spaces/{application,contracts,infrastructure}/…   # listPending, findByTokenHash, spaceNameOf, previews (1, 2)
│   ├── app/api/v1/
│   │   ├── spaces/[spaceId]/invitations/route.ts       # + GET (1)
│   │   ├── invitations/[token]/route.ts                # new: GET preview (2)
│   │   └── claims/[token]/route.ts                     # new: GET preview (2)
│   ├── composition/{container.ts, openapi.ts}          # listInvitations, previewInvitation, previewClaim (1, 2)
│   ├── shared/ui/
│   │   ├── api/{dto.ts, problem.ts}                    # new DTO aliases, Problem.outstanding (4)
│   │   ├── format/currencies.ts                        # roundingUnit (4)
│   │   ├── icons/ui-icons.ts                           # link, userPlus, userMinus, copy, swap, warning (4)
│   │   ├── molecules/{copy-field.tsx, problem-notice.tsx}   # CopyField, ProblemNotice detail (4)
│   │   ├── navigation/auth-redirect.ts                 # OPEN_PREFIXES (3)
│   │   └── time/server-now.ts                          # serverZone (9)
│   ├── modules/identity/ui/{sign-up-form-container.tsx, sign-up-form.tsx, profile-sheet.tsx}   # next (3), Members entry (5)
│   ├── modules/spaces/ui/
│   │   ├── {nav-links.tsx, app-shell.tsx, space-switcher.tsx, new-space-form.tsx}   # (5)
│   │   ├── members/{space-controls.ts, member-label.ts, members-screen.tsx, member-row.tsx, role-sheet.tsx,
│   │   │            members-container.tsx, invite-sheet.tsx, pending-invitations.tsx,
│   │   │            add-guest-sheet.tsx, guest-sheet.tsx}                     # (6, 7, 8)
│   │   └── invitations/{invitation-state.ts, invitation-card.tsx, invitation-container.tsx}   # (9)
│   ├── modules/ledger/ui/
│   │   ├── split/{split-math.ts, split-request.ts, use-default-split.ts, split-sheet.tsx,
│   │   │          shared-fields.tsx, shared-context.ts}                       # (11, 12, 13)
│   │   ├── direct/{counterparts.ts, direct-request.ts, split-with-person-sheet.tsx}   # (15)
│   │   ├── {saved-notice.tsx, transaction-row.tsx, transaction-list.tsx, transaction-list-container.tsx}   # (14)
│   │   └── record/{record-request.ts, record-form.tsx, record-form-container.tsx}   # (13, 14, 15)
│   ├── modules/balances/ui/{net-state.ts, balances-screen.tsx, balances-container.tsx, settlement-request.ts,
│   │                        settle-up-sheet.tsx, balance-history.tsx, history-container.tsx, index.ts, server.ts}   # (17, 18, 19)
│   └── app/(web)/
│       ├── (public)/sign-up/page.tsx                   # reads next (3)
│       ├── (open)/{layout.tsx, invitations/[token]/page.tsx, claims/[token]/page.tsx}   # (3, 9)
│       └── (app)/spaces/{new/{layout.tsx, page.tsx}, [spaceId]/members/page.tsx,
│                         [spaceId]/members/[memberId]/history/page.tsx, [spaceId]/balances/page.tsx}   # (5, 6, 17, 19)
├── tests/
│   ├── support/{in-memory-spaces.ts, ui/dto.ts}        # listPending, findByTokenHash, spaceNameOf (1, 2); member builders (4)
│   ├── acceptance/{invitations.test.ts, guest-claims.test.ts}   # (1, 2)
│   ├── e2e/features/{spaces.feature, shared-expense.feature, balances.feature}   # (10, 16, 20)
│   ├── e2e/steps/{spaces.steps.ts, shared.steps.ts, balances.steps.ts}          # (10, 16, 20)
│   ├── e2e/support/{world.ts, people.ts, fixtures.ts}  # other people with their own sessions (10)
│   ├── e2e/{a11y-shared.spec.ts, perf/inp-split.spec.ts}   # (21)
│   └── performance/{budgets.json, lighthouse.mjs, budgets.test.mjs}   # the new routes (21)
└── docs/ (decisions, backlog E9, architecture, README) and mkdocs.yml   # (22)
```

Test layout as in M6a: pure UI logic (`*.test.ts`) in the `unit` project (Node), components and containers (`*.test.tsx`) in the `ui` project (jsdom) next to their code; run one file with `pnpm exec vitest run --project ui <path>`.

### How the UI reads and writes

| Need | Where it runs | Through |
|---|---|---|
| Members, balances, suggestions, history, pending invitations, periods, the accounts of the space and of the personal space | Server Component container (`load*`) | `serverApi()` (loopback with the request's cookie, P117) |
| An invitation's or a claim link's preview | Server Component of the open page | `serverApi()`; the preview endpoints need no session (P156) |
| Create a space, invite, revoke, add a guest, create a claim link, remove a guest, change a role, accept an invitation, claim a place | Client container in the browser | `browserApi()`; then `router.refresh()` (or `router.push` to the new place) |
| Record a shared expense, a direct split, a settlement | Client form | `browserApi()` with one `Idempotency-Key` per draft (`useIdempotencyKey`, P128) |
| The default split while the form changes | Client hook (`useDefaultSplit`) | `browserApi()` `GET …/default-split`, debounced 250 ms (P167) |
| The saved-with-warning state | Server Component of the transaction list | `?notice=FundBalanceNegative&account=<id>`; the balance comes from the accounts the list already loads (P170) |

### Helpers every task reuses (never re-implement them)

- API: `browserApi`, `serverApi`, `loaded`, `outcomeOf`, `getMe`, `getSpaces`, `redirectToSignIn` (`src/shared/ui/api/{client,server}.ts`); `problemFrom`, `fieldOf` (`problem.ts`); `useProblemMessage`, `ProblemNotice`.
- Formats and time: `formatMoney`, `formatDate`, `formatNumber`, `decimalOf`, `MINUS`, `BUILT_IN_FORMATS` (`format/formatters.ts`); `currencyOf` (`format/currencies.ts`); `parseDecimal`, `minorOf` (`format/amount-input.ts`); `nowIn`, `occurredAtOf` (`time/when.ts`); `serverNow` (`time/server-now.ts`); `browserTimeZone` (`format/zones.ts`); the kernel's `localDateIn` (`@/shared/kernel/time-zone`).
- Components: `Sheet`, `Button`, `TextField`, `ChoiceGroup`, `Badge`, `Avatar`, `Icon`, `VisuallyHidden`, `paletteVars` (`@/shared/ui`); `AccountPicker` (`@/modules/accounts/ui`); `CategoryPicker`, `findCategory`, `categoryPath`, `activeTree` (`@/modules/categories/ui`); `SpaceSwitcher`, `personalSpaceOf` (`@/modules/spaces/ui`); `ProfileSheet` (`@/modules/identity/ui`); `RecordForm`, `requestOf`, `recordFieldOf`, `useIdempotencyKey`, `AmountField`, `TransactionRow`, `RowContext` (`src/modules/ledger/ui/...`).
- Navigation: `safeNext`, `redirectFor`, `invitationOf` (`src/shared/ui/navigation/`).
- Tests: `fakeApi`, `jsonResponse`, `problemResponse` (`tests/support/ui/fake-api.ts`); `renderWithIntl` (`render.tsx`); `axeViolations` (`axe.ts`); `meDto`, `spaceDto`, `accountDto`, `categoryDto`, `groupDto`, `transactionDto`, `cop`, `normalized`, `rowContext` (`dto.ts`, plus Task 4's `memberDto`, `guestDto`, `invitationDto`, `householdSpace`); the e2e `World`, `Given`/`When`/`Then`, `minor`, `shown`; the backend's `startTestApp`, `call`, `problemOf`, `registerUser`, `newSharedSpace`, `inviteByLink`, `joinAs`, `claimLink`, `household`, `addGuest`, `invitationsWorld`, `InMemoryInvitations`.

---
### Task 1: List a space's pending invitations

The Main artboard lists "Invitaciones pendientes" with Revocar, and the API cannot list them: `RevokeInvitation` needs an id the members screen has no way to read. Adds `ListInvitations` and `GET /api/v1/spaces/{spaceId}/invitations` (ruling P155): the PENDING email and link invitations of the space that have not expired, newest first, for OWNER and ADMIN (`member.invite`, the same right that creates and revokes them). Claim links are not listed: they belong to their guest's sheet. The URL is not part of the answer, because only the token's hash is stored.

**Files:**
- Create: `src/modules/spaces/application/list-invitations.ts`, `src/modules/spaces/application/list-invitations.test.ts`
- Modify: `src/modules/spaces/application/invitation-repository.ts`, `src/modules/spaces/application/index.ts`, `src/modules/spaces/infrastructure/drizzle-invitation-repository.ts`, `src/modules/spaces/infrastructure/drizzle-invitation-repository.int.test.ts`, `src/modules/spaces/contracts/spaces.contract.ts`, `src/app/api/v1/spaces/[spaceId]/invitations/route.ts`, `src/composition/container.ts`, `tests/support/in-memory-spaces.ts`, `tests/acceptance/invitations.test.ts`, `openapi/openapi.snapshot.json` (regenerated), `src/shared/ui/api/schema.d.ts` (regenerated)

**Interfaces:**
- Consumes: `authorizeSpaceAction` (`member.invite`), `toInvitationView`, `InvitationsDeps`.
- Produces: `InvitationRepository.listPending(spaceId: string, now: Date): Promise<Invitation[]>` (EMAIL and LINK, `status = PENDING`, `expiresAt > now`, newest `createdAt` first then id descending; `[]` for a malformed id); `type ListInvitations = (input: { spaceId: string; userId: string }) => Promise<Result<InvitationView[]>>` and `createListInvitations(deps: Pick<InvitationsDeps, "access" | "invitations" | "clock">): ListInvitations`; `Container.spaces.listInvitations`; operation `listInvitations` answering `200 { items: Invitation[] }`, `401 Unauthenticated`, `403 InsufficientRole`, `404 SpaceNotFound`, `409 SpaceArchived`; `ListInvitationsResponseSchema`. Task 7 reads it.

- [ ] **Step 1: Write the failing tests**

`src/modules/spaces/application/list-invitations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { invitationsWorld } from "../../../../tests/support/in-memory-spaces";
import { createCreateGuestClaim } from "./create-guest-claim";
import { createCreateInvitation } from "./create-invitation";
import { createListInvitations } from "./list-invitations";
import { createRevokeInvitation } from "./revoke-invitation";

const space = "space-household";
const DAY = 24 * 60 * 60 * 1000;

describe("ListInvitations (HU-E9-05, ruling P155)", () => {
  it("lists the pending email and link invitations, newest first, without claim links or used ones", async () => {
    const w = invitationsWorld();
    const create = createCreateInvitation(w.deps);
    const asAna = { spaceId: space, userId: "u-ana" };
    const marta = unwrap(await create({ ...asAna, role: "MEMBER", target: { kind: "EMAIL", email: "marta@example.com" } }));
    w.clock.set(new Date("2026-10-12T13:00:00Z"));
    const link = unwrap(await create({ ...asAna, role: "VIEWER", target: { kind: "LINK" } }));
    const revoked = unwrap(await create({ ...asAna, role: "MEMBER", target: { kind: "LINK" } }));
    unwrap(await createRevokeInvitation(w.deps)({ ...asAna, invitationId: revoked.invitation.id }));
    unwrap(await createCreateGuestClaim(w.claims)({ ...asAna, memberId: "member-pedro" }));
    const listed = unwrap(await createListInvitations(w.deps)(asAna));
    expect(listed.map((i) => [i.id, i.kind, i.role, i.status])).toEqual([
      [link.invitation.id, "LINK", "VIEWER", "PENDING"],
      [marta.invitation.id, "EMAIL", "MEMBER", "PENDING"],
    ]);
    expect(listed[1]!.email).toBe("marta@example.com");
  });

  it("leaves out an invitation from the instant it expires", async () => {
    const w = invitationsWorld();
    unwrap(
      await createCreateInvitation(w.deps)({ spaceId: space, userId: "u-ana", role: "MEMBER", target: { kind: "LINK" } }),
    );
    w.clock.set(new Date(new Date("2026-10-12T12:00:00Z").getTime() + 7 * DAY));
    expect(unwrap(await createListInvitations(w.deps)({ spaceId: space, userId: "u-ana" }))).toEqual([]);
  });

  it("answers InsufficientRole to a MEMBER and SpaceNotFound to someone outside the space", async () => {
    const w = invitationsWorld();
    const list = createListInvitations(w.deps);
    expect(codeOf(await list({ spaceId: space, userId: "u-luis" }))).toBe("InsufficientRole");
    expect(unwrap(await list({ spaceId: space, userId: "u-juan" }))).toEqual([]);
    expect(codeOf(await list({ spaceId: space, userId: "u-stranger" }))).toBe("SpaceNotFound");
  });
});
```

(`invitationsWorld()` seeds HU-E1-05's Household: OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi and the guest Pedro; its clock starts at 2026-10-12T12:00:00Z.)

`src/modules/spaces/infrastructure/drizzle-invitation-repository.int.test.ts`, inside `describe("DrizzleInvitationRepository …")`, after "saves acceptance and revocation fields":

```ts
  it("lists a space's pending email and link invitations, newest first, and nothing for a malformed id (P155)", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana.id);
    const other = await household(ana.id);
    const first = await invite(space, ana.id, { kind: "EMAIL", email: "marta@example.com" }, new Date("2026-10-12T12:00:00Z"));
    const second = await invite(space, ana.id, { kind: "LINK" }, new Date("2026-10-12T13:00:00Z"));
    const used = await invite(space, ana.id, { kind: "LINK" }, new Date("2026-10-12T14:00:00Z"));
    await repo.save({ ...used.invitation, status: "REVOKED", revokedAt: new Date("2026-10-12T15:00:00Z") });
    await invite(other, ana.id, { kind: "LINK" }, new Date("2026-10-12T16:00:00Z"));
    const now = new Date("2026-10-13T00:00:00Z");
    expect((await repo.listPending(space.id, now)).map((i) => i.id)).toEqual([second.invitation.id, first.invitation.id]);
    expect(await repo.listPending(space.id, new Date("2026-10-19T12:00:00Z"))).toEqual([second.invitation]);
    expect(await repo.listPending("not-a-uuid", now)).toEqual([]);
  });
```

(The second assertion is the expiry boundary: on 2026-10-19T12:00Z the first invitation has expired at that very instant and the second has an hour left.)

`tests/acceptance/invitations.test.ts`: import `GET as listInvitations` from `@/app/api/v1/spaces/[spaceId]/invitations/route` beside its `POST`, and add after the last test of `describe("invitations (HU-E1-06)")`:

```ts
  it("lists the pending invitations to an OWNER and refuses a MEMBER (HU-E9-05, ruling P155)", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    await invite(ana, spaceId, { kind: "EMAIL", email: "marta@example.com", role: "MEMBER" });
    await invite(ana, spaceId, { kind: "LINK", role: "VIEWER" });
    const listed = await call(listInvitations, "GET", `/api/v1/spaces/${spaceId}/invitations`, {
      user: ana,
      params: { spaceId },
    });
    expect(listed.status).toBe(200);
    const { items } = (await listed.json()) as { items: { kind: string; role: string; email: string | null }[] };
    expect(items.map((i) => [i.kind, i.role, i.email])).toEqual([
      ["LINK", "VIEWER", null],
      ["EMAIL", "MEMBER", "marta@example.com"],
    ]);
    expect(JSON.stringify(items)).not.toMatch(/token|url/i);
    const luis = await registerUser("Luis");
    await joinAs(ana, spaceId, luis, "MEMBER");
    const refused = await call(listInvitations, "GET", `/api/v1/spaces/${spaceId}/invitations`, {
      user: luis,
      params: { spaceId },
    });
    expect(await problemOf(refused)).toEqual([403, "InsufficientRole"]);
  });
```

(`joinAs` comes from `../support/spaces` beside `inviteByLink`; the link `joinAs` creates is accepted by Luis and stays pending, which is why the test reads the list before Luis joins.)

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/spaces/application/list-invitations.test.ts`, `pnpm exec vitest run --project integration src/modules/spaces/infrastructure/drizzle-invitation-repository.int.test.ts`, `pnpm exec vitest run --project acceptance tests/acceptance/invitations.test.ts`
Expected: FAIL — `Cannot find module './list-invitations'`; `repo.listPending is not a function`; `GET` is not exported by the route.

- [ ] **Step 3: Implement**

`src/modules/spaces/application/invitation-repository.ts`, inside `InvitationRepository` after `findByTokenHashForUpdate`:

```ts
  /**
   * HU-E9-05, ruling P155: the space's PENDING email and link invitations that have not expired at `now`, newest
   * first (created at, then id, descending); claim links are not listed; `[]` for a malformed id.
   */
  listPending(spaceId: string, now: Date): Promise<Invitation[]>;
```

`src/modules/spaces/application/list-invitations.ts`:

```ts
import { ok, type Result } from "@/shared/kernel";
import type { InvitationsDeps } from "./invitation-ports";
import { toInvitationView, type InvitationView } from "./invitation-view";
import { authorizeSpaceAction } from "./space-access";

export type ListInvitations = (input: { spaceId: string; userId: string }) => Promise<Result<InvitationView[]>>;

/** HU-E9-05, ruling P155: whoever may create and revoke invitations (OWNER, ADMIN) reads the pending ones. */
export const createListInvitations =
  (deps: Pick<InvitationsDeps, "access" | "invitations" | "clock">): ListInvitations =>
  async (input) => {
    const manager = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "member.invite");
    if (!manager.ok) return manager;
    const now = deps.clock.now();
    const pending = await deps.invitations.listPending(manager.value.spaceId, now);
    return ok(pending.map((invitation) => toInvitationView(invitation, now)));
  };
```

`src/modules/spaces/application/index.ts`: export `createListInvitations` and `type ListInvitations` beside `createRevokeInvitation` (from `./list-invitations`).

`src/modules/spaces/infrastructure/drizzle-invitation-repository.ts`: replace the first import line with `import { and, desc, eq, gt, inArray } from "drizzle-orm";` and add after `findByTokenHashForUpdate`:

```ts
  async listPending(spaceId: string, now: Date): Promise<Invitation[]> {
    if (!isUuid(spaceId)) return [];
    const rows = await this.tm
      .executor()
      .select()
      .from(spaceInvitations)
      .where(
        and(
          eq(spaceInvitations.spaceId, spaceId),
          eq(spaceInvitations.status, "PENDING"),
          inArray(spaceInvitations.kind, ["EMAIL", "LINK"]),
          gt(spaceInvitations.expiresAt, now),
        ),
      )
      .orderBy(desc(spaceInvitations.createdAt), desc(spaceInvitations.id));
    return rows.map(toInvitation);
  }
```

`tests/support/in-memory-spaces.ts`, in `InMemoryInvitations` after `findByTokenHashForUpdate`:

```ts
  /** Like DrizzleInvitationRepository.listPending (pinned against it by its integration test). */
  async listPending(spaceId: string, now: Date) {
    return this.rows
      .filter(
        (i) =>
          i.spaceId === spaceId &&
          i.status === "PENDING" &&
          i.kind !== "CLAIM" &&
          i.expiresAt.getTime() > now.getTime(),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
  }
```

`src/modules/spaces/contracts/spaces.contract.ts`: after `CreatedInvitationSchema` add `export const ListInvitationsResponseSchema = z.object({ items: z.array(InvitationSchema) });`; in `spacesPaths["/api/v1/spaces/{spaceId}/invitations"]`, before `post:`, add:

```ts
    get: {
      operationId: "listInvitations",
      summary: "The space's pending email and link invitations, newest first (OWNER and ADMIN); never their URLs",
      ...securedByUser,
      requestParams: { path: SpacePath },
      responses: {
        "200": { description: "The pending invitations", content: jsonContent(ListInvitationsResponseSchema) },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound",
          "409": "SpaceArchived",
        }),
      },
    },
```

`src/app/api/v1/spaces/[spaceId]/invitations/route.ts`: import `invitationDto` beside `createdInvitationDto` and add:

```ts
export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.listInvitations({ spaceId: params.spaceId!, userId: user!.id });
    return result.ok ? ok({ status: 200, body: { items: result.value.map(invitationDto) } }) : result;
  },
});
```

`src/composition/container.ts`: import `createListInvitations` and `type ListInvitations` beside the revoke ones; add `readonly listInvitations: ListInvitations;` after `readonly revokeInvitation: RevokeInvitation;` and `listInvitations: createListInvitations(invitationsDeps),` after `revokeInvitation: createRevokeInvitation(invitationsDeps),`.

- [ ] **Step 4: Run the tests, regenerate the snapshot and the client types, run the gates**

Run: Step 2's commands, `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` (the diff is one new operation, `GET /api/v1/spaces/{spaceId}/invitations`, and no new component), `pnpm api:types`, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/spaces "src/app/api/v1/spaces/[spaceId]/invitations/route.ts" src/composition/container.ts \
  tests/support/in-memory-spaces.ts tests/acceptance/invitations.test.ts openapi/openapi.snapshot.json \
  src/shared/ui/api/schema.d.ts
git commit -m "feat(spaces): list a space's pending invitations for its owners and admins (Refs #73)"
```

Risk: none (a new read under the existing `member.invite` permission; nothing existing changes).

---

### Task 2: Public previews of an invitation and of a claim link

HU-E9-05's invitation page "shows the space Household and the role MEMBER" to "a visitor without an account", and the claim page names the guest whose place the visitor takes; today the only way to learn anything about a token is to accept it, which needs a session. Adds `PreviewInvitation`, `PreviewClaim`, `GET /api/v1/invitations/{token}` and `GET /api/v1/claims/{token}`, reachable without a session (ruling P156). A preview answers the space's name, the inviter's display name, the role (an invitation) or the guest's name (a claim), the effective status and the expiry, and nothing else: never the email of an email invitation, the space id, any member list or the creator's user id. An unknown token, or a token of the other kind, answers 404 `InvitationNotFound`, as acceptance does. There is no throttle: a token carries 256 random bits (`cryptoInvitationTokens`), so the endpoints cannot be used to guess one, and a preview changes nothing.

**Files:**
- Create: `src/modules/spaces/application/preview-invitation.ts`, `src/modules/spaces/application/preview-invitation.test.ts`, `src/app/api/v1/invitations/[token]/route.ts`, `src/app/api/v1/claims/[token]/route.ts`
- Modify: `src/modules/spaces/application/invitation-repository.ts`, `src/modules/spaces/application/space-member-repository.ts`, `src/modules/spaces/application/invitation-ports.ts`, `src/modules/spaces/application/index.ts`, `src/modules/spaces/infrastructure/drizzle-invitation-repository.ts`, `src/modules/spaces/infrastructure/drizzle-space-repository.ts`, `src/modules/spaces/infrastructure/drizzle-invitation-repository.int.test.ts`, `src/modules/spaces/contracts/spaces.contract.ts`, `src/composition/container.ts`, `src/composition/openapi.ts`, `tests/support/in-memory-spaces.ts`, `tests/acceptance/invitations.test.ts`, `tests/acceptance/guest-claims.test.ts`, `openapi/openapi.snapshot.json`, `src/shared/ui/api/schema.d.ts`

**Interfaces:**
- Consumes: `effectiveStatus`, `isClaim` (domain), `InvitationsDeps`.
- Produces:
  - `InvitationRepository.findByTokenHash(tokenHash: string): Promise<Invitation | null>` (no lock); `GuestClaimRepository.spaceNameOf(spaceId: SpaceId): Promise<string>`; `InvitationsDeps.spaces: Pick<GuestClaimRepository, "spaceKindOf" | "spaceNameOf">`.
  - `interface InvitationPreview { kind: "EMAIL" | "LINK"; spaceName: string; role: InvitableRole; status: InvitationStatus; expiresAt: Date; invitedBy: string | null }`; `interface ClaimPreview { spaceName: string; guestName: string | null; status: InvitationStatus; expiresAt: Date; invitedBy: string | null }`; `type PreviewInvitation = (input: { token: string }) => Promise<Result<InvitationPreview>>`, `createPreviewInvitation(deps: PreviewDeps)`; `type PreviewClaim`, `createPreviewClaim(deps: PreviewDeps)`; `type PreviewDeps = Pick<InvitationsDeps, "invitations" | "tokens" | "members" | "spaces" | "clock">`.
  - `Container.spaces.previewInvitation`, `Container.spaces.previewClaim`; operations `previewInvitation` and `previewClaim` (no `security`), `200` with components `InvitationPreview` and `ClaimPreview`, `404 InvitationNotFound`. Task 9 reads them.

- [ ] **Step 1: Write the failing tests**

`src/modules/spaces/application/preview-invitation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { invitationsWorld } from "../../../../tests/support/in-memory-spaces";
import { createAcceptInvitation } from "./accept-invitation";
import { createCreateGuestClaim } from "./create-guest-claim";
import { createCreateInvitation } from "./create-invitation";
import { createPreviewClaim, createPreviewInvitation } from "./preview-invitation";
import { createRevokeInvitation } from "./revoke-invitation";

const space = "space-household";
const asAna = { spaceId: space, userId: "u-ana" };
const DAY = 24 * 60 * 60 * 1000;

const world = () => {
  const w = invitationsWorld();
  return {
    ...w,
    invite: createCreateInvitation(w.deps),
    preview: createPreviewInvitation(w.deps),
    previewClaim: createPreviewClaim(w.deps),
  };
};

describe("PreviewInvitation (HU-E9-05, ruling P156)", () => {
  it("answers the space, the inviter, the role, the status and the expiry of a link, and nothing else", async () => {
    const w = world();
    unwrap(await w.invite({ ...asAna, role: "MEMBER", target: { kind: "LINK" } }));
    expect(unwrap(await w.preview({ token: "token-1" }))).toEqual({
      kind: "LINK",
      spaceName: "Household",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: new Date("2026-10-19T12:00:00Z"),
      invitedBy: "Ana",
    });
  });

  it("never carries the address of an email invitation", async () => {
    const w = world();
    unwrap(await w.invite({ ...asAna, role: "VIEWER", target: { kind: "EMAIL", email: "juan@example.com" } }));
    const preview = unwrap(await w.preview({ token: "token-1" }));
    expect(preview).toMatchObject({ kind: "EMAIL", role: "VIEWER" });
    expect(JSON.stringify(preview)).not.toContain("juan@example.com");
  });

  it("reports revoked, used and expired invitations by their status", async () => {
    const w = world();
    const revoked = unwrap(await w.invite({ ...asAna, role: "MEMBER", target: { kind: "LINK" } }));
    unwrap(await createRevokeInvitation(w.deps)({ ...asAna, invitationId: revoked.invitation.id }));
    unwrap(await w.invite({ ...asAna, role: "MEMBER", target: { kind: "EMAIL", email: "marta@example.com" } }));
    unwrap(
      await createAcceptInvitation(w.deps)({
        token: "token-2",
        userId: "u-marta",
        userEmail: "marta@example.com",
        userName: "Marta",
      }),
    );
    unwrap(await w.invite({ ...asAna, role: "MEMBER", target: { kind: "LINK" } }));
    w.clock.set(new Date(new Date("2026-10-12T12:00:00Z").getTime() + 7 * DAY));
    expect(unwrap(await w.preview({ token: "token-1" })).status).toBe("REVOKED");
    expect(unwrap(await w.preview({ token: "token-2" })).status).toBe("ACCEPTED");
    expect(unwrap(await w.preview({ token: "token-3" })).status).toBe("EXPIRED");
  });

  it("answers InvitationNotFound for an unknown token and for a claim link", async () => {
    const w = world();
    unwrap(await createCreateGuestClaim(w.claims)({ ...asAna, memberId: "member-pedro" }));
    expect(codeOf(await w.preview({ token: "token-1" }))).toBe("InvitationNotFound");
    expect(codeOf(await w.preview({ token: "nope" }))).toBe("InvitationNotFound");
  });

  it("names nobody when the inviter has left the space", async () => {
    const w = world();
    unwrap(await w.invite({ spaceId: space, userId: "u-juan", role: "MEMBER", target: { kind: "LINK" } }));
    await w.store.markLeft(space as never, "member-juan" as never, "USER", new Date("2026-10-12T13:00:00Z"));
    expect(unwrap(await w.preview({ token: "token-1" })).invitedBy).toBeNull();
  });
});

describe("PreviewClaim (HU-E9-05, ruling P156)", () => {
  it("answers the space, the guest, the status, the expiry and who sent it", async () => {
    const w = world();
    unwrap(await createCreateGuestClaim(w.claims)({ ...asAna, memberId: "member-pedro" }));
    expect(unwrap(await w.previewClaim({ token: "token-1" }))).toEqual({
      spaceName: "Household",
      guestName: "Pedro",
      status: "PENDING",
      expiresAt: new Date("2026-10-19T12:00:00Z"),
      invitedBy: "Ana",
    });
  });

  it("answers InvitationNotFound for an invitation token", async () => {
    const w = world();
    unwrap(await w.invite({ ...asAna, role: "MEMBER", target: { kind: "LINK" } }));
    expect(codeOf(await w.previewClaim({ token: "token-1" }))).toBe("InvitationNotFound");
  });
});
```

(`markLeft` is the in-memory store's `MemberLifecycleRepository` method; the casts only satisfy its branded id types.)

`src/modules/spaces/infrastructure/drizzle-invitation-repository.int.test.ts`, after Task 1's test:

```ts
  it("finds an invitation by token hash without locking it, and names its space (P156)", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana.id);
    const { token, invitation } = await invite(space, ana.id, { kind: "LINK" });
    expect(await repo.findByTokenHash(cryptoInvitationTokens.hash(token))).toEqual(invitation);
    expect(await repo.findByTokenHash("0".repeat(64))).toBeNull();
    expect(await spaces.spaceNameOf(space.id)).toBe("Household");
  });
```

`tests/acceptance/invitations.test.ts`: import `GET as previewInvitation` from `@/app/api/v1/invitations/[token]/route`, and add:

```ts
  it("previews an invitation without a session and never shows its email (HU-E9-05, ruling P156)", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    const { token } = await emailInvitation(ana, spaceId, "juan@example.com");
    const response = await call(previewInvitation, "GET", `/api/v1/invitations/${token}`, { params: { token } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ kind: "EMAIL", spaceName: "Household", role: "MEMBER", status: "PENDING", invitedBy: "Ana" });
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "invitedBy", "kind", "role", "spaceName", "status"]);
    expect(JSON.stringify(body)).not.toContain("juan@example.com");
    const unknown = await call(previewInvitation, "GET", "/api/v1/invitations/nope", { params: { token: "nope" } });
    expect(await problemOf(unknown)).toEqual([404, "InvitationNotFound"]);
  });
```

`tests/acceptance/guest-claims.test.ts`: import `GET as previewClaim` from `@/app/api/v1/claims/[token]/route` and `GET as previewInvitation` from `@/app/api/v1/invitations/[token]/route`, and add inside `describe("claim links (HU-E1-11)")`:

```ts
  it("previews a claim link without a session, and keeps claim and invitation tokens apart (ruling P156)", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    const { token } = await claimLink(h.ana, h.spaceId, pedro);
    const response = await call(previewClaim, "GET", `/api/v1/claims/${token}`, { params: { token } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ spaceName: "Household", guestName: "Pedro", status: "PENDING", invitedBy: "Ana" });
    const asInvitation = await call(previewInvitation, "GET", `/api/v1/invitations/${token}`, { params: { token } });
    expect(await problemOf(asInvitation)).toEqual([404, "InvitationNotFound"]);
    const link = await inviteByLink(h.ana, h.spaceId, "MEMBER");
    const asClaim = await call(previewClaim, "GET", `/api/v1/claims/${link}`, { params: { token: link } });
    expect(await problemOf(asClaim)).toEqual([404, "InvitationNotFound"]);
  });
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/spaces/application/preview-invitation.test.ts`, `pnpm exec vitest run --project integration src/modules/spaces/infrastructure/drizzle-invitation-repository.int.test.ts`, `pnpm exec vitest run --project acceptance tests/acceptance/invitations.test.ts tests/acceptance/guest-claims.test.ts`
Expected: FAIL — `Cannot find module './preview-invitation'`; `repo.findByTokenHash is not a function`; `Cannot find module '@/app/api/v1/invitations/[token]/route'`.

- [ ] **Step 3: Implement the ports**

`src/modules/spaces/application/invitation-repository.ts`, after `findByTokenHashForUpdate`:

```ts
  /** Ruling P156: the same invitation, read without a lock, for a preview that changes nothing. */
  findByTokenHash(tokenHash: string): Promise<Invitation | null>;
```

`src/modules/spaces/application/space-member-repository.ts`, in `GuestClaimRepository` after `spaceKindOf`:

```ts
  /** Ruling P156: the name of a space that exists (an invitation's preview shows it). */
  spaceNameOf(spaceId: SpaceId): Promise<string>;
```

`src/modules/spaces/application/invitation-ports.ts`: in `InvitationsDeps` replace `readonly spaces: Pick<GuestClaimRepository, "spaceKindOf">;` with `readonly spaces: Pick<GuestClaimRepository, "spaceKindOf" | "spaceNameOf">;` and its comment with `/** AcceptInvitation refuses spaces that cannot gain members (their kind); previews show their name (P156). */`.

`drizzle-invitation-repository.ts`, after `findByTokenHashForUpdate`:

```ts
  async findByTokenHash(tokenHash: string): Promise<Invitation | null> {
    const [row] = await this.tm
      .executor()
      .select()
      .from(spaceInvitations)
      .where(eq(spaceInvitations.tokenHash, tokenHash));
    return row ? toInvitation(row) : null;
  }
```

`drizzle-space-repository.ts`, after `spaceKindOf`:

```ts
  async spaceNameOf(spaceId: SpaceId): Promise<string> {
    const [row] = await this.tm
      .executor()
      .select({ name: spaces.name })
      .from(spaces)
      .where(eq(spaces.id, spaceId));
    // Invitations reference their space (ON DELETE cascade), so a missing one is a broken invariant.
    if (!row) throw new Error(`space ${spaceId} does not exist`);
    return row.name;
  }
```

`tests/support/in-memory-spaces.ts`: in `InMemorySpaceStore` after `spaceKindOf`:

```ts
  /** GuestClaimRepository, like DrizzleSpaceRepository.spaceNameOf. */
  async spaceNameOf(spaceId: string): Promise<string> {
    const space = this.spaces.find((s) => s.id === spaceId);
    if (!space) throw new Error(`space ${spaceId} does not exist`);
    return space.name;
  }
```

and in `InMemoryInvitations` after `listPending`:

```ts
  /** Like findByTokenHashForUpdate, without recording a lock. */
  async findByTokenHash(tokenHash: string) {
    return this.rows.find((i) => i.tokenHash === tokenHash) ?? null;
  }
```

- [ ] **Step 4: Implement the use cases, the contract and the routes**

`src/modules/spaces/application/preview-invitation.ts`:

```ts
import { domainError, err, ok, type Result } from "@/shared/kernel";
import {
  effectiveStatus,
  isClaim,
  type InvitableRole,
  type Invitation,
  type InvitationStatus,
} from "../domain/invitation";
import type { SpaceMember } from "../domain/space";
import type { InvitationsDeps } from "./invitation-ports";

/** Ruling P156: what a visitor may read of an invitation they hold the token of; never its email or ids. */
export interface InvitationPreview {
  readonly kind: "EMAIL" | "LINK";
  readonly spaceName: string;
  readonly role: InvitableRole;
  readonly status: InvitationStatus;
  readonly expiresAt: Date;
  /** The inviter's display name in the space; null once they left it. */
  readonly invitedBy: string | null;
}

/** Ruling P156: what a visitor may read of a claim link: whose place it hands over. */
export interface ClaimPreview {
  readonly spaceName: string;
  /** Null once the guest was removed (their links are revoked then, HU-E1-12). */
  readonly guestName: string | null;
  readonly status: InvitationStatus;
  readonly expiresAt: Date;
  readonly invitedBy: string | null;
}

export type PreviewDeps = Pick<InvitationsDeps, "invitations" | "tokens" | "members" | "spaces" | "clock">;
export type PreviewInvitation = (input: { token: string }) => Promise<Result<InvitationPreview>>;
export type PreviewClaim = (input: { token: string }) => Promise<Result<ClaimPreview>>;

const nameOf = (members: readonly SpaceMember[], find: (m: SpaceMember) => boolean): string | null =>
  members.find(find)?.displayName ?? null;

/** The invitation of `token` when it is of the wanted kind; both kinds share one store, so the kind keeps them apart. */
const found = async (
  deps: PreviewDeps,
  token: string,
  claim: boolean,
): Promise<Result<{ invitation: Invitation; members: SpaceMember[]; spaceName: string }>> => {
  const invitation = await deps.invitations.findByTokenHash(deps.tokens.hash(token));
  if (!invitation || isClaim(invitation) !== claim) return err(domainError("InvitationNotFound"));
  const [members, spaceName] = await Promise.all([
    deps.members.listCurrent(invitation.spaceId),
    deps.spaces.spaceNameOf(invitation.spaceId),
  ]);
  return ok({ invitation, members, spaceName });
};

/** HU-E9-05, ruling P156: GET /api/v1/invitations/{token}, public: the token is the authorization (HU-E1-06). */
export const createPreviewInvitation =
  (deps: PreviewDeps): PreviewInvitation =>
  async ({ token }) => {
    const result = await found(deps, token, false);
    if (!result.ok) return result;
    const { invitation, members, spaceName } = result.value;
    return ok({
      kind: invitation.kind === "EMAIL" ? "EMAIL" : "LINK",
      spaceName,
      role: invitation.role,
      status: effectiveStatus(invitation, deps.clock.now()),
      expiresAt: invitation.expiresAt,
      invitedBy: nameOf(members, (m) => m.userId === invitation.createdBy),
    });
  };

/** HU-E9-05, ruling P156: GET /api/v1/claims/{token}, public like the invitation's preview. */
export const createPreviewClaim =
  (deps: PreviewDeps): PreviewClaim =>
  async ({ token }) => {
    const result = await found(deps, token, true);
    if (!result.ok) return result;
    const { invitation, members, spaceName } = result.value;
    return ok({
      spaceName,
      guestName: nameOf(members, (m) => m.id === invitation.guestMemberId && m.kind === "GUEST"),
      status: effectiveStatus(invitation, deps.clock.now()),
      expiresAt: invitation.expiresAt,
      invitedBy: nameOf(members, (m) => m.userId === invitation.createdBy),
    });
  };
```

`application/index.ts`: export `createPreviewClaim`, `createPreviewInvitation` and the types `ClaimPreview`, `InvitationPreview`, `PreviewClaim`, `PreviewInvitation` from `./preview-invitation`.

`spaces.contract.ts`: import `ClaimPreview` and `InvitationPreview` beside `InvitationView` and, after `createdInvitationDto`, add:

```ts
const InvitationStatusSchema = z.enum(["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"]);

/** Ruling P156: a public preview; never the email, the space id or any member list. */
export const InvitationPreviewSchema = z.object({
  kind: z.enum(["EMAIL", "LINK"]),
  spaceName: z.string(),
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
  status: InvitationStatusSchema,
  expiresAt: z.iso.datetime(),
  invitedBy: z.string().nullable(),
});
export const ClaimPreviewSchema = z.object({
  spaceName: z.string(),
  guestName: z.string().nullable(),
  status: InvitationStatusSchema,
  expiresAt: z.iso.datetime(),
  invitedBy: z.string().nullable(),
});

export const invitationPreviewDto = (p: InvitationPreview): z.infer<typeof InvitationPreviewSchema> => ({
  kind: p.kind,
  spaceName: p.spaceName,
  role: p.role,
  status: p.status,
  expiresAt: p.expiresAt.toISOString(),
  invitedBy: p.invitedBy,
});
export const claimPreviewDto = (p: ClaimPreview): z.infer<typeof ClaimPreviewSchema> => ({
  spaceName: p.spaceName,
  guestName: p.guestName,
  status: p.status,
  expiresAt: p.expiresAt.toISOString(),
  invitedBy: p.invitedBy,
});
const TokenPath = z.object({ token: z.string() });
```

and in `spacesPaths`, before `"/api/v1/invitations/{token}/accept"`:

```ts
  "/api/v1/invitations/{token}": {
    get: {
      operationId: "previewInvitation",
      summary: "What a visitor holding the token may read of an invitation: space, inviter, role, status, expiry",
      requestParams: { path: TokenPath },
      responses: {
        "200": { description: "The invitation's preview", content: jsonContent(InvitationPreviewSchema) },
        ...problems({ "404": "InvitationNotFound" }),
      },
    },
  },
```

and before `"/api/v1/claims/{token}/accept"` the same entry for `"/api/v1/claims/{token}"` with `operationId: "previewClaim"`, `summary: "What a visitor holding the token may read of a claim link: space, guest, status, expiry"`, `"200": { description: "The claim link's preview", content: jsonContent(ClaimPreviewSchema) }`. (No `security` key: like `getSignUpMode`, the endpoints are public.)

`src/composition/openapi.ts`: import `ClaimPreviewSchema` and `InvitationPreviewSchema` beside `InvitationSchema` and register them after `Invitation: InvitationSchema,` as `InvitationPreview: InvitationPreviewSchema,` and `ClaimPreview: ClaimPreviewSchema,`.

`src/app/api/v1/invitations/[token]/route.ts`:

```ts
import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { invitationPreviewDto } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** HU-E9-05, ruling P156: public; the 256-bit token is the authorization, and a preview changes nothing. */
export const GET = defineRoute({
  auth: "none",
  handler: async ({ params }) => {
    const result = await getContainer().spaces.previewInvitation({ token: params.token! });
    return result.ok ? ok({ status: 200, body: invitationPreviewDto(result.value) }) : result;
  },
});
```

`src/app/api/v1/claims/[token]/route.ts` is the same with `previewClaim` and `claimPreviewDto`.

`container.ts`: import `createPreviewClaim`, `createPreviewInvitation`, `type PreviewClaim`, `type PreviewInvitation`; add `readonly previewInvitation: PreviewInvitation;` and `readonly previewClaim: PreviewClaim;` after `readonly acceptInvitation: AcceptInvitation;`, and after `acceptInvitation: createAcceptInvitation(invitationsDeps),` add:

```ts
      previewInvitation: createPreviewInvitation(invitationsDeps),
      previewClaim: createPreviewClaim(invitationsDeps),
```

(`invitationsDeps.spaces` is already the space repository, which now implements `spaceNameOf`.)

- [ ] **Step 5: Run the tests, regenerate, run the gates**

Run: Step 2's commands, `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts` (two new operations and the two new components), `pnpm api:types`, then every gate.
Expected: PASS. The snapshot's two new operations have no `security` and only a `404` problem.

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces "src/app/api/v1/invitations/[token]/route.ts" "src/app/api/v1/claims/[token]/route.ts" \
  src/composition tests/support/in-memory-spaces.ts tests/acceptance/invitations.test.ts \
  tests/acceptance/guest-claims.test.ts openapi/openapi.snapshot.json src/shared/ui/api/schema.d.ts
git commit -m "feat(spaces): preview an invitation or a claim link without a session (Refs #73)"
```

Risk: item 2 (two endpoints reachable without a session; their answer is the whole disclosure). Independent verifier after the checks: probe both endpoints with an unknown token, a token of the other kind, an email invitation and a revoked one, and confirm the body never holds an email, an id or a member list.

---

### Task 3: Open pages, and coming back to them after sign-up

A visitor opens `/invitations/<token>` or `/claims/<token>` without a session, signs up or signs in from there and comes back to the same page (HU-E9-05 technical note; ruling P157). Today the proxy sends every path but `/sign-in` and `/sign-up` to the sign-in screen, and sign-up always lands on `/`. This task adds the open paths, a route group `(open)` whose layout never redirects (a signed-in person may open an invitation too, unlike `(public)`, P145), and the `next` of the sign-up screen. Task 9 fills the pages.

**Files:**
- Create: `src/app/(web)/(open)/layout.tsx`, `src/app/(web)/(open)/layout.test.tsx`
- Modify: `src/shared/ui/navigation/auth-redirect.ts`, `src/shared/ui/navigation/auth-redirect.test.ts`, `src/modules/identity/ui/sign-up-form-container.tsx`, `src/modules/identity/ui/sign-up-form.tsx`, `src/modules/identity/ui/sign-up.test.tsx`, `src/app/(web)/(public)/sign-up/page.tsx`, `src/app/(web)/(public)/sign-up/page.test.tsx`

**Interfaces:**
- Consumes: `safeNext`, `invitationOf`, `LanguageToggle`, `Logo`.
- Produces: `OPEN_PREFIXES = ["/invitations/", "/claims/"] as const` and `isOpenPath(pathname: string): boolean` (`auth-redirect.ts`); `redirectFor` returns `null` for an open path with or without a session; `SignUpFormContainer({ next = "/", invitation, api })` replaces the route with `next` after a sign-up; `SignUpForm({ …, signInHref = "/sign-in" })`; the sign-up page passes `safeNext(next)`; `OpenLayout` (logo and language toggle, no session check). Task 9's pages live under `(open)`.

- [ ] **Step 1: Write the failing tests**

`src/shared/ui/navigation/auth-redirect.test.ts`: add rows to `safeNext`'s table, after `["/settings", "/settings"],`:

```ts
    ["/invitations/AbC_123-x", "/invitations/AbC_123-x"],
    ["/claims/AbC_123-x", "/claims/AbC_123-x"],
```

and inside `describe("redirectFor")`:

```ts
  it("lets the invitation and claim pages through with or without a session (ruling P157)", () => {
    for (const hasSession of [false, true]) {
      expect(redirectFor({ pathname: "/invitations/tok", search: "", hasSession })).toBeNull();
      expect(redirectFor({ pathname: "/claims/tok", search: "", hasSession })).toBeNull();
    }
    expect(redirectFor({ pathname: "/invitations", search: "", hasSession: false })).toBe(
      "/sign-in?next=%2Finvitations",
    );
    expect(redirectFor({ pathname: "/invitationsx/tok", search: "", hasSession: false })).toBe(
      "/sign-in?next=%2Finvitationsx%2Ftok",
    );
  });
```

`src/modules/identity/ui/sign-up.test.tsx`, inside `describe("sign-up screen (HU-E9-01)")`:

```tsx
  it("returns to the invitation after signing up, and keeps it in the link to sign in (ruling P157)", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/auth/sign-up": () => jsonResponse({ user: meDto() }, 201),
    });
    renderWithIntl(<SignUpFormContainer next="/invitations/tok-1" invitation="tok-1" api={api} />);
    expect(screen.getByRole("link", { name: "Inicia sesión" })).toHaveAttribute(
      "href",
      "/sign-in?next=%2Finvitations%2Ftok-1&invitation=tok-1",
    );
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await requests[0]!.json()).toMatchObject({ invitationToken: "tok-1" });
    expect(router.replace).toHaveBeenCalledWith("/invitations/tok-1");
  });
```

`src/app/(web)/(public)/sign-up/page.test.tsx`: widen its `open` helper's parameter to `{ invitation?: string | string[]; next?: string }` and add, inside its `describe`:

```tsx
  it("passes a safe next to the form and drops a foreign one (ruling P157)", async () => {
    mocks.mode.mockResolvedValue("open");
    const { unmount } = await open({ next: "/claims/tok-9", invitation: "tok-9" });
    expect(screen.getByRole("link", { name: "Inicia sesión" })).toHaveAttribute(
      "href",
      "/sign-in?next=%2Fclaims%2Ftok-9&invitation=tok-9",
    );
    unmount();
    await open({ next: "//evil.example" });
    expect(screen.getByRole("link", { name: "Inicia sesión" })).toHaveAttribute("href", "/sign-in");
  });
```

`src/app/(web)/(open)/layout.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "../../../../tests/support/ui/render";

const mocks = vi.hoisted(() => ({ redirect: vi.fn(), getMe: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "es" }));
vi.mock("@/shared/ui/api/server", () => ({ getMe: mocks.getMe }));

const { default: OpenLayout } = await import("./layout");

describe("open layout (HU-E9-05, ruling P157)", () => {
  it("shows the page to anyone, never redirects and asks the API nothing", async () => {
    renderWithIntl(await OpenLayout({ children: <p>invitation</p> }));
    expect(screen.getByText("invitation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cambiar idioma/ })).toBeInTheDocument();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.getMe).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/shared/ui/navigation` and `pnpm exec vitest run --project ui src/modules/identity/ui/sign-up.test.tsx "src/app/(web)/(public)/sign-up" "src/app/(web)/(open)"`
Expected: FAIL — `/invitations/tok` redirects to the sign-in screen; the sign-up screen replaces the route with `/`; the link to sign in has no `next`; `Cannot find module './layout'`.

- [ ] **Step 3: Implement**

`src/shared/ui/navigation/auth-redirect.ts`, after `isPublic`:

```ts
/**
 * Ruling P157: pages a visitor opens with or without a session (an invitation, a claim link). The proxy lets them
 * through; unlike the public screens they are valid `next` targets, and a signed-in person stays on them.
 */
export const OPEN_PREFIXES = ["/invitations/", "/claims/"] as const;

export const isOpenPath = (pathname: string): boolean =>
  OPEN_PREFIXES.some((prefix) => pathname.startsWith(prefix) && pathname.length > prefix.length);
```

and in `redirectFor` replace `if (input.hasSession || isPublic(input.pathname)) return null;` with `if (input.hasSession || isPublic(input.pathname) || isOpenPath(input.pathname)) return null;`. `safeNext` is unchanged: an open path is neither public nor foreign, so it is already honoured (the new table rows pin it).

`src/modules/identity/ui/sign-up-form.tsx`: add `readonly signInHref?: string;` to `SignUpFormProps`, destructure it with the default `"/sign-in"`, and use it in place of the literal `href="/sign-in"` of the footer link.

`src/modules/identity/ui/sign-up-form-container.tsx`: the props become `{ next = "/", invitation, api }` with `readonly next?: string;` (documented "already made safe by the page, ruling P157"); replace `router.replace("/");` with `router.replace(next);`; and pass to `SignUpForm`:

```tsx
      signInHref={signInHrefOf(next, invitation)}
```

with, above the component:

```ts
/** Ruling P157: the way back to sign in keeps where the visitor was going and the invitation they hold. */
const signInHrefOf = (next: string, invitation: string | undefined): string => {
  const query = [
    next === "/" ? null : `next=${encodeURIComponent(next)}`,
    invitation === undefined ? null : `invitation=${encodeURIComponent(invitation)}`,
  ].filter((part): part is string => part !== null);
  return query.length === 0 ? "/sign-in" : `/sign-in?${query.join("&")}`;
};
```

`src/app/(web)/(public)/sign-up/page.tsx`: `searchParams` becomes `Promise<{ invitation?: string | string[]; next?: string }>`; read `next` beside `invitation` and render `<SignUpFormContainer next={safeNext(next)} invitation={token} />` (import `safeNext`).

`src/app/(web)/(open)/layout.tsx`:

```tsx
import { getLocale } from "next-intl/server";
import type { ReactNode } from "react";
import type { Locale } from "@/i18n/locale";
import { LanguageToggle } from "@/modules/identity/ui";
import { Logo } from "@/shared/ui";

/**
 * Ruling P157: the invitation and claim pages. Anyone may open them, signed in or not, so unlike the public layout
 * this one checks no session and never redirects; each page reads the session it needs.
 */
export default async function OpenLayout({ children }: { readonly children: ReactNode }) {
  const locale = (await getLocale()) as Locale;
  return (
    <main className="mx-auto max-w-[420px] px-4 pt-4 pb-6">
      <div className="mb-8 flex items-center justify-between">
        <Logo />
        <LanguageToggle locale={locale} />
      </div>
      {children}
    </main>
  );
}
```

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, `pnpm build`, `pnpm test:e2e` (the M6a scenarios still pass: the sign-up scenario lands on `/`), then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ui/navigation src/modules/identity/ui "src/app/(web)/(public)/sign-up" "src/app/(web)/(open)"
git commit -m "feat(web): open the invitation and claim pages without a session and return to them after sign-up (Refs #73)"
```

Risk: item 2 (the proxy's session guard gains two open prefixes, and sign-up now follows `next`). Independent verifier: probe `redirectFor` and `safeNext` with `/invitations`, `/invitations/`, `/invitationsx/a`, `/claims/a/../../settings`, `//evil.example`, a tab and a backslash, and confirm the open prefixes never expose a protected page (the `(app)` layouts still redirect a visitor; an open page renders only its token's preview).

---
### Task 4: UI support for the household screens

What every later task shares, built once so no writer re-implements it: the DTO aliases of the household endpoints, the test builders of members and invitations, the public `outstanding` amount of a problem (P163), a detail line in `ProblemNotice`, each currency's rounding unit for the split preview (P183), six interface icons from the Batch 2 canvas, a `CopyField` for invitation and claim URLs (P181), and the catalog check's `warnings.<Code>` rule (P170).

**Files:**
- Create: `src/shared/ui/format/currencies.test.ts`, `src/shared/ui/molecules/copy-field.tsx`, `src/shared/ui/molecules/copy-field.test.tsx`
- Modify: `src/shared/ui/api/dto.ts`, `src/shared/ui/api/problem.ts`, `src/shared/ui/api/problem.test.ts`, `src/shared/ui/atoms/text-field.tsx`, `src/shared/ui/molecules/problem-notice.tsx`, `src/shared/ui/molecules/molecules.test.tsx`, `src/shared/ui/format/currencies.ts`, `src/shared/ui/icons/ui-icons.ts`, `src/shared/ui/index.ts`, `scripts/i18n-check.mjs`, `scripts/i18n-check.test.mjs`, `tests/support/ui/dto.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Produces:
  - `dto.ts`: `MemberDto = components["schemas"]["SpaceMember"]`; `InvitationDto = components["schemas"]["Invitation"]`; `CreatedInvitationDto` (201 of `POST /api/v1/spaces/{spaceId}/invitations`); `InvitationPreviewDto = components["schemas"]["InvitationPreview"]`; `ClaimPreviewDto = components["schemas"]["ClaimPreview"]`; `BalancesDto` (200 of `GET …/balances`); `SuggestionDto` (an item of `GET …/balances/suggestions`); `BalanceHistoryDto` (200 of `GET …/members/{memberId}/balance-history`); `DefaultSplitDto` (200 of `GET …/default-split`); `RecordedExpenseDto = components["schemas"]["RecordedExpense"]`; `DirectSplitDto` (201 of `POST /api/v1/direct-splits`).
  - `Problem.outstanding?: MoneyDto` (present only when the body carries a valid one, so every M6a `toEqual` stays green).
  - `ProblemNotice({ problem, detail? }: { problem: Problem; detail?: ReactNode })`.
  - `currencyOf(code): { symbol: string; exponent: number; roundingUnit: bigint }` (COP 100n, USD and EUR 1n, unknown 1n).
  - `UI_ICONS.link`, `.userPlus`, `.userMinus`, `.copy`, `.swap`, `.warning`.
  - `CopyField({ id, label, value, note? })` (client): a read-only text field holding the URL and a `common.copy` button; `common.copied` in a `status` region after a copy, `common.copyFailed` when the clipboard refuses (the field's text is selected then).
  - `scripts/i18n-check.mjs`: `warningCodesOf(openapi: object): string[]`; `checkCatalogs` reports `Missing in <es|en>: warnings.<Code>`.
  - `tests/support/ui/dto.ts`: `memberDto(overrides?)` (Ana, `m-ana`, USER `u-ana`, OWNER, joined 2026-10-01T12:00Z), `guestDto(overrides?)` (Pedro, `m-pedro`, GUEST, no user and no role), `invitationDto(overrides?)` (a pending LINK invitation `inv-1` of `sp-household` as MEMBER, created 2026-10-12T12:00Z, expiring 2026-10-19T12:00Z), `householdSpace(overrides?)` (`spaceDto` with `id "sp-household"`, `name "Household"`, `kind "SHARED"`, `role "OWNER"`).

- [ ] **Step 1: Write the failing tests**

`src/shared/ui/api/problem.test.ts`, inside `describe("problemFrom (HU-E9-02)")`:

```ts
  it("keeps the public outstanding amount of OutstandingBalance and nothing malformed (ruling P163)", () => {
    const body = { code: "OutstandingBalance", status: 409, requestId: "r", outstanding: { amount: "10000000", currency: "COP" } };
    expect(problemFrom(body, response(409)).outstanding).toEqual({ amount: "10000000", currency: "COP" });
    expect(problemFrom({ ...body, outstanding: { amount: 5 } }, response(409))).not.toHaveProperty("outstanding");
    expect(problemFrom({ code: "SpaceArchived" }, response(409))).not.toHaveProperty("outstanding");
  });
```

`src/shared/ui/molecules/molecules.test.tsx`, after the ProblemNotice test:

```tsx
  it("adds a detail line under a known problem's message (ruling P163)", () => {
    renderWithIntl(
      <ProblemNotice
        problem={{ code: "OutstandingBalance", status: 409, requestId: "r", errors: [], field: null }}
        detail="Saldo pendiente: $ 100.000"
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Quedan saldos pendientes. Sáldalos antes de continuar.");
    expect(alert).toHaveTextContent("Saldo pendiente: $ 100.000");
  });
```

`src/shared/ui/format/currencies.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { currencyOf as kernelCurrency } from "@/shared/kernel/currency";
import { currencyOf } from "./currencies";

describe("currencies (ruling P183)", () => {
  it("rounds splits by the same unit as the server: whole pesos for COP, cents for USD and EUR", () => {
    for (const code of ["COP", "USD", "EUR"]) {
      const server = kernelCurrency(code);
      if (!server.ok) throw new Error(code);
      expect([currencyOf(code).exponent, currencyOf(code).roundingUnit]).toEqual([
        server.value.exponent,
        server.value.roundingUnit,
      ]);
    }
    expect(currencyOf("XYZ").roundingUnit).toBe(1n);
  });
});
```

(A `.test.ts` file: dependency-cruiser excludes it, so it may read the kernel's `currency.ts`, which UI code may not.)

`src/shared/ui/molecules/copy-field.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { CopyField } from "./copy-field";

const URL_ = "https://hearth.example/invitations/AbC";
afterEach(() => vi.unstubAllGlobals());

describe("CopyField (ruling P181)", () => {
  it("copies the URL and says so", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { container } = renderWithIntl(<CopyField id="link" label="Enlace de invitación" value={URL_} />);
    expect(screen.getByLabelText("Enlace de invitación")).toHaveValue(URL_);
    expect(screen.getByLabelText("Enlace de invitación")).toHaveAttribute("readonly");
    await userEvent.click(screen.getByRole("button", { name: "Copiar" }));
    expect(writeText).toHaveBeenCalledWith(URL_);
    expect(screen.getByRole("status")).toHaveTextContent("Copiado");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("selects the URL and asks to copy it by hand when the clipboard refuses", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) } });
    renderWithIntl(<CopyField id="link" label="Enlace de invitación" value={URL_} />);
    await userEvent.click(screen.getByRole("button", { name: "Copiar" }));
    expect(screen.getByRole("status")).toHaveTextContent("No se pudo copiar: selecciona el enlace y cópialo.");
    const field = screen.getByLabelText<HTMLInputElement>("Enlace de invitación");
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, URL_.length]);
  });
});
```

`scripts/i18n-check.test.mjs`: give the fixture `openapi` a component with a warning, and add a test:

```js
const withWarnings = {
  ...openapi,
  components: {
    schemas: {
      RecordedExpense: {
        type: "object",
        properties: {
          warnings: {
            type: "array",
            items: { type: "object", properties: { code: { type: "string", enum: ["FundBalanceNegative"] } } },
          },
        },
      },
    },
  },
};

  it("reads every warning code and fails naming one without a message (ruling P170)", () => {
    expect(warningCodesOf(withWarnings)).toEqual(["FundBalanceNegative"]);
    const both = { errors: errors(errorCodesOf(withWarnings)) };
    expect(checkCatalogs({ es: both, en: both, openapi: withWarnings })).toEqual([
      "Missing in en: warnings.FundBalanceNegative",
      "Missing in es: warnings.FundBalanceNegative",
    ]);
    const done = { ...both, warnings: { FundBalanceNegative: "x" } };
    expect(checkCatalogs({ es: done, en: done, openapi: withWarnings })).toEqual([]);
  });
```

(import `warningCodesOf` beside the other two; the `withWarnings` constant goes after `errors`, the test inside the `describe`.)

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/shared/ui scripts/i18n-check.test.mjs` and `pnpm exec vitest run --project ui src/shared/ui/molecules`
Expected: FAIL — `outstanding` is undefined; the detail is not rendered; `roundingUnit` is undefined; `Cannot find module './copy-field'`; `warningCodesOf` is not exported.

- [ ] **Step 3: Implement**

`src/shared/ui/api/dto.ts`, after `ProblemDto`:

```ts
export type MemberDto = components["schemas"]["SpaceMember"];
export type InvitationDto = components["schemas"]["Invitation"];
export type CreatedInvitationDto = Json<paths["/api/v1/spaces/{spaceId}/invitations"]["post"]["responses"][201]>;
export type InvitationPreviewDto = components["schemas"]["InvitationPreview"];
export type ClaimPreviewDto = components["schemas"]["ClaimPreview"];
export type BalancesDto = Json<paths["/api/v1/spaces/{spaceId}/balances"]["get"]["responses"][200]>;
export type SuggestionDto = Json<
  paths["/api/v1/spaces/{spaceId}/balances/suggestions"]["get"]["responses"][200]
>["suggestions"][number];
export type BalanceHistoryDto = Json<
  paths["/api/v1/spaces/{spaceId}/members/{memberId}/balance-history"]["get"]["responses"][200]
>;
export type DefaultSplitDto = Json<paths["/api/v1/spaces/{spaceId}/default-split"]["get"]["responses"][200]>;
export type RecordedExpenseDto = components["schemas"]["RecordedExpense"];
export type DirectSplitDto = Json<paths["/api/v1/direct-splits"]["post"]["responses"][201]>;
```

`src/shared/ui/api/problem.ts`: import `type MoneyDto` from `./dto`; add to `Problem`:

```ts
  /** Ruling P163: the public `outstanding` member of OutstandingBalance; absent for every other problem. */
  readonly outstanding?: MoneyDto;
```

and in `problemFrom`'s problem branch build the object first, then add it when valid:

```ts
    const outstanding = error.outstanding;
    const money =
      isRecord(outstanding) && typeof outstanding.amount === "string" && typeof outstanding.currency === "string"
        ? { outstanding: { amount: outstanding.amount, currency: outstanding.currency } }
        : {};
    return { code: error.code, status: …, requestId: …, errors: …, field: …, ...money };
```

(The four existing members keep their M6a expressions.)

`src/shared/ui/molecules/problem-notice.tsx`: the props become `{ problem, detail }` with `readonly detail?: ReactNode;`; render `{detail ? <p>{detail}</p> : null}` after the message and before the reference.

`src/shared/ui/format/currencies.ts`:

```ts
/**
 * HU-E9-02: the symbol a currency shows, never the language's (P68); amounts on the wire are minor units. Ruling
 * P183: `roundingUnit` is the server's (`src/shared/kernel/currency.ts`), so the split preview rounds like
 * `Money.allocate`: COP shares are whole pesos.
 */
const CURRENCIES: Readonly<
  Record<string, { readonly symbol: string; readonly exponent: number; readonly roundingUnit: bigint }>
> = {
  COP: { symbol: "$", exponent: 2, roundingUnit: 100n },
  USD: { symbol: "US$", exponent: 2, roundingUnit: 1n },
  EUR: { symbol: "€", exponent: 2, roundingUnit: 1n },
};

/** A known currency's symbol, exponent and rounding unit; an unknown code shows itself, exponent 2, unit 1. */
export const currencyOf = (code: string): { symbol: string; exponent: number; roundingUnit: bigint } =>
  CURRENCIES[code] ?? { symbol: code, exponent: 2, roundingUnit: 1n };
```

`src/shared/ui/icons/ui-icons.ts`, before `} as const;`:

```ts
  link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  userPlus: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0M18 8v6M15 11h6",
  userMinus: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0M16 11h6",
  copy: "M10.5 8h7A2.5 2.5 0 0 1 20 10.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 8 17.5v-7A2.5 2.5 0 0 1 10.5 8ZM16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8",
  swap: "M7 7h11l-3-3M17 17H6l3 3",
  warning: "M12 4 2.5 20h19L12 4Zm0 6v4.5m0 2.7h.01",
```

(`link`, `userPlus` and `copy` are the Main artboard's paths, the copy icon's rounded square written as one path; `userMinus` and `warning` the GuestSheet's; `swap` the Balances artboard's Saldos tab.)

`src/shared/ui/molecules/copy-field.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "../atoms/button";
import { Icon } from "../atoms/icon";
import { TextField } from "../atoms/text-field";

/**
 * Ruling P181: a URL shown once (only its token's hash is stored), read-only so it can still be selected by hand, and a
 * Copy button. The outcome is announced; when the clipboard refuses, the text is selected and the person copies it.
 */
export function CopyField({
  id,
  label,
  value,
  note,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly note?: string;
}) {
  const t = useTranslations("common");
  const field = useRef<HTMLInputElement>(null);
  const [outcome, setOutcome] = useState<"copied" | "copyFailed" | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setOutcome("copied");
    } catch {
      field.current?.select();
      setOutcome("copyFailed");
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <TextField
        ref={field}
        id={id}
        label={label}
        value={value}
        readOnly
        hint={note}
        onFocus={(event) => event.currentTarget.select()}
        trailing={
          <Button size="icon" variant="ghost" aria-label={t("copy")} onClick={() => void copy()}>
            <Icon name="copy" />
          </Button>
        }
      />
      <p role="status" className="text-sm text-muted">
        {outcome ? t(outcome) : null}
      </p>
    </div>
  );
}
```

`TextField` forwards `ref` to its `<input>` (React 19 passes `ref` as a prop): add `ref` to its destructured props (`ref?: Ref<HTMLInputElement>`, from `react`) and pass `ref={ref}` to the input. Export `CopyField` from `src/shared/ui/index.ts` after `ChoiceGroup`.

`scripts/i18n-check.mjs`, after `errorCodesOf`:

```js
/**
 * Ruling P170: the warning codes a response can carry: every `warnings` array property whose items have a `code` enum,
 * anywhere in the document (RecordedExpense's FundBalanceNegative today).
 */
export const warningCodesOf = (openapi) => {
  const codes = new Set();
  const visit = (node) => {
    if (node === null || typeof node !== "object") return;
    const warnings = node.properties?.warnings?.items?.properties?.code?.enum;
    if (Array.isArray(warnings)) for (const code of warnings) codes.add(code);
    for (const value of Object.values(node)) visit(value);
  };
  visit(openapi);
  return [...codes].sort();
};
```

and in `checkCatalogs` add `...warningCodesOf(openapi).map((c) => `warnings.${c}`),` to the `keys` set after the error codes. Its comment line becomes "Every problem with the two catalogs: a key missing in one, a leaf that is not a string, an error or warning code without a message."

`tests/support/ui/dto.ts`: import `InvitationDto` and `MemberDto` with the other DTOs and add:

```ts
/** Ana as a member: the OWNER who created the space. */
export const memberDto = (overrides: Partial<MemberDto> = {}): MemberDto => ({
  id: "m-ana",
  kind: "USER",
  userId: "u-ana",
  displayName: "Ana",
  role: "OWNER",
  contactEmail: null,
  joinedAt: "2026-10-01T12:00:00.000Z",
  ...overrides,
});

/** Pedro, a guest: no user, no role, cannot sign in (D15). */
export const guestDto = (overrides: Partial<MemberDto> = {}): MemberDto =>
  memberDto({ id: "m-pedro", kind: "GUEST", userId: null, displayName: "Pedro", role: null, joinedAt: "2026-10-05T12:00:00.000Z", ...overrides });

/** A pending LINK invitation to Household as MEMBER, valid 7 days. */
export const invitationDto = (overrides: Partial<InvitationDto> = {}): InvitationDto => ({
  id: "inv-1",
  spaceId: "sp-household",
  kind: "LINK",
  email: null,
  role: "MEMBER",
  status: "PENDING",
  createdAt: "2026-10-12T12:00:00.000Z",
  expiresAt: "2026-10-19T12:00:00.000Z",
  ...overrides,
});

/** The shared space "Household" as its OWNER reads it. */
export const householdSpace = (overrides: Partial<SpaceDto> = {}): SpaceDto =>
  spaceDto({ id: "sp-household", name: "Household", kind: "SHARED", role: "OWNER", ...overrides });
```

Catalog keys, es / en: `common.copy` Copiar / Copy; `common.copied` Copiado / Copied; `common.copyFailed` No se pudo copiar: selecciona el enlace y cópialo. / Could not copy: select the link and copy it.; `common.notNow` Ahora no / Not now; `common.goHome` Ir a Hearth / Go to Hearth; a new top-level namespace `warnings` with `FundBalanceNegative` El saldo de {account} quedó en {balance}. Pueden hacer un aporte al fondo para cubrirlo. / The balance of {account} is now {balance}. A contribution to the fund can cover it.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, `pnpm i18n:check` (now also requires `warnings.FundBalanceNegative`, which this task adds), then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ui scripts/i18n-check.mjs scripts/i18n-check.test.mjs tests/support/ui/dto.ts src/i18n/messages
git commit -m "feat(web): add the household DTOs, copyable links, rounding units and translated warnings (Refs #74)"
```

Risk: none.

---

### Task 5: The shell: the Saldos tab, the Members entry and a new shared space

The shell changes the household screens need (ruling P160): the bottom bar gains **Saldos** now that HU-E9-07 builds its screen (P141 kept it hidden until then), in the Batch 2 artboards' order (Inicio, Movimientos, Registrar, then Saldos; M6c inserts Plan before Saldos), shown only in shared and direct spaces because a personal space has no balances; the profile sheet gains the **Miembros e invitaciones** entry P126 deferred to HU-E9-05, also only outside the personal space; the space sheet gains **Crear espacio compartido**; and the NewSpace artboard becomes `/spaces/new` (scenario "Create a shared space from the switcher", ruling P161): a name and a currency, then the new space's members screen.

**Files:**
- Create: `src/modules/spaces/ui/new-space-form.tsx`, `src/modules/spaces/ui/new-space-form.test.tsx`, `src/app/(web)/(app)/spaces/new/layout.tsx`, `src/app/(web)/(app)/spaces/new/page.tsx`
- Modify: `src/shared/ui/molecules/choice-group.tsx`, `src/modules/spaces/ui/nav-links.tsx`, `src/modules/spaces/ui/app-shell.tsx`, `src/modules/spaces/ui/space-switcher.tsx`, `src/modules/spaces/ui/shell.test.tsx`, `src/modules/spaces/ui/index.ts`, `src/modules/identity/ui/profile-sheet.tsx`, `src/modules/identity/ui/profile-sheet.test.tsx`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `SpaceSummary`, `Sheet`, `TextField`, `ChoiceGroup`, `Button`, `ProblemNotice`, `browserApi`, `problemFrom`, `fieldOf`, `useProblemMessage`.
- Produces: `NavLinks({ spaceId, spaceKind }: { spaceId: string; spaceKind: SpaceDto["kind"] })`; `ProfileSheet({ me, spaceId, spaceKind, api? })`; `SpaceSwitcher` ends its list with a link to `/spaces/new`; `SPACE_CURRENCIES = ["COP", "USD", "EUR"] as const`; `NewSpaceForm({ api? })` (client: `POST /api/v1/spaces` `{ kind: "SHARED", name, currency }`, then `router.push("/spaces/<id>/members")` and `router.refresh()`); the page `/spaces/new` inside the shell of the personal space. Task 6 builds the members screen it lands on.

- [ ] **Step 1: Write the failing tests**

`src/modules/spaces/ui/shell.test.tsx`: the existing renders pass `me`, `spaces` and `activeSpace` only, so they keep working (`AppShell` reads the kind from `activeSpace`); add:

```tsx
  it("shows Saldos in a shared space, after Movimientos and Registrar, and not in the personal one (ruling P160)", () => {
    const { unmount } = renderWithIntl(
      <AppShell me={{ name: "Ana", email: "ana@example.com", locale: "es" }} spaces={spaces} activeSpace={spaces[1]}>
        <h1>Inicio</h1>
      </AppShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(within(nav).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual([
      "/spaces/sp-household",
      "/spaces/sp-household/transactions",
      "/spaces/sp-household/new",
      "/spaces/sp-household/balances",
    ]);
    expect(within(nav).getByRole("link", { name: "Saldos" })).toBeInTheDocument();
    unmount();
    renderWithIntl(
      <AppShell me={{ name: "Ana", email: "ana@example.com", locale: "es" }} spaces={spaces} activeSpace={spaces[0]}>
        <h1>Inicio</h1>
      </AppShell>,
    );
    expect(screen.queryByRole("link", { name: "Saldos" })).not.toBeInTheDocument();
  });

  it("offers to create a shared space at the end of the space sheet (HU-E9-05)", async () => {
    renderWithIntl(
      <AppShell me={{ name: "Ana", email: "ana@example.com", locale: "es" }} spaces={spaces} activeSpace={spaces[0]}>
        <h1>Inicio</h1>
      </AppShell>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Espacio actual: Personal. Cambiar de espacio" }));
    const sheet = screen.getByRole("dialog", { name: "Espacios" });
    expect(within(sheet).getAllByRole("link").at(-1)).toHaveAccessibleName("Crear espacio compartido");
    expect(within(sheet).getByRole("link", { name: "Crear espacio compartido" })).toHaveAttribute("href", "/spaces/new");
  });
```

`src/modules/identity/ui/profile-sheet.test.tsx`: in every existing render add `spaceKind="PERSONAL"`, add `expect(within(sheet).queryByRole("link", { name: /Miembros/ })).not.toBeInTheDocument();` to the first test, and add:

```tsx
  it("links to the members of a shared space (ruling P160)", async () => {
    const { api } = fakeApi({});
    renderWithIntl(
      <ProfileSheet me={{ name: "Ana", email: "ana@example.com", locale: "es" }} spaceId="sp-household" spaceKind="SHARED" api={api} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Perfil de Ana" }));
    const sheet = screen.getByRole("dialog", { name: "Ana" });
    expect(within(sheet).getByRole("link", { name: /Miembros e invitaciones/ })).toHaveAttribute(
      "href",
      "/spaces/sp-household/members",
    );
  });
```

`src/modules/spaces/ui/new-space-form.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { householdSpace } from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { NewSpaceForm } from "./new-space-form";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

describe("new shared space (HU-E9-05, ruling P161)", () => {
  it("creates Household in COP and opens its members screen", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces": () => jsonResponse(householdSpace(), 201) });
    const { container } = renderWithIntl(<NewSpaceForm api={api} />);
    expect(screen.getByRole("radio", { name: "COP · Peso colombiano" })).toBeChecked();
    await userEvent.type(screen.getByLabelText("Nombre"), " Household ");
    await userEvent.click(screen.getByRole("button", { name: "Crear espacio" }));
    expect(await requests[0]!.json()).toEqual({ kind: "SHARED", name: "Household", currency: "COP" });
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-household/members");
    expect(router.refresh).toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("puts InvalidSpaceName under the name and creates nothing else", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces": () => problemResponse(422, "InvalidSpaceName") });
    renderWithIntl(<NewSpaceForm api={api} />);
    await userEvent.click(screen.getByRole("radio", { name: "USD · Dólar estadounidense" }));
    await userEvent.click(screen.getByRole("button", { name: "Crear espacio" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Nombre")).toHaveAccessibleDescription(
        "El nombre del espacio debe tener entre 1 y 80 caracteres.",
      ),
    );
    expect(screen.getByRole("radiogroup", { name: "Moneda" })).toHaveAccessibleDescription(
      "Una sola moneda por espacio. Deja de poder cambiarse cuando el espacio tiene movimientos.",
    );
    expect(await requests[0]!.json()).toMatchObject({ currency: "USD" });
    expect(router.push).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project ui src/modules/spaces/ui src/modules/identity/ui/profile-sheet.test.tsx`
Expected: FAIL — no Saldos link; the sheet's last link is Household; `spaceKind` is ignored and no Members link exists; `Cannot find module './new-space-form'`.

- [ ] **Step 3: Implement**

`nav-links.tsx`: props `{ spaceId, spaceKind }`; the doc comment becomes "One landmark for both layouts … Ruling P160: the Batch 2 order, Inicio, Movimientos, Registrar, Saldos; Saldos only where balances exist (shared and direct spaces); Plan joins with HU-E9-08 (M6c)."; render, in this order: the Inicio link, the Movimientos link, the Registrar link (unchanged classes and `lg:-order-1`), then, when `spaceKind !== "PERSONAL"`, `<Link href={`${home}/balances`} aria-current={current(balances)} className={item}><Icon name="swap" />{t("balances")}</Link>` with `const balances = `${home}/balances`;`. `app-shell.tsx` passes `spaceKind={activeSpace.kind}` to `NavLinks` and to `ProfileSheet`.

`profile-sheet.tsx`: props gain `readonly spaceKind: SpaceDto["kind"];` (import `type SpaceDto` from `@/shared/ui/api/dto`); between the Settings and Accounts links render, when `spaceKind !== "PERSONAL"`:

```tsx
          <Link href={`/spaces/${spaceId}/members`} className={row} onClick={() => setOpen(false)}>
            <Icon name="userPlus" />
            <span className="flex flex-col">
              <span>{t("members")}</span>
              <span className="text-sm text-muted">{t("membersHint")}</span>
            </span>
          </Link>
```

The doc comment loses "Members" from its list of deferred entries.

`space-switcher.tsx`: after the `</ul>`, inside the sheet:

```tsx
        <Link
          href="/spaces/new"
          onClick={() => setOpen(false)}
          className="mt-2 flex min-h-14 items-center gap-3 rounded-xl px-2 font-medium text-accent"
        >
          <Icon name="plus" />
          {t("space.create")}
        </Link>
```

and its doc comment becomes "HU-E9-01, the SpaceSheet artboard: every current space as a link, then create a shared space (HU-E9-05, P160)."

`new-space-form.tsx` (`"use client"`, the NewSpace artboard without its period controls, P161): `export const SPACE_CURRENCIES = ["COP", "USD", "EUR"] as const;`; state `name`, `currency` (`"COP"`), `pending`, `problem`; a `<form noValidate>` with `TextField` `id="space-name"` labelled `spaces.new.name` (`autoComplete="off"`, its error from the problem when `fieldOf(problem, { InvalidSpaceName: "name", UnknownCurrency: "currency" }, ["name", "currency"])` is `"name"`), a `ChoiceGroup` `layout="chips"` labelled `spaces.new.currency` with options `spaces.currency.<CODE>` for each of `SPACE_CURRENCIES` and `describedBy="space-currency-hint"`, its hint `spaces.new.currencyHint` in a `<p id="space-currency-hint">` (`ChoiceGroupProps` gains `readonly describedBy?: string`, passed as `aria-describedby` on `RadioGroup.Root`; nothing else in `ChoiceGroup` changes), the note `spaces.new.note`, a `ProblemNotice` for a form-level problem and the `lg` submit `spaces.new.create`, disabled while pending. Submit: `api.POST("/api/v1/spaces", { body: { kind: "SHARED", name: name.trim(), currency } })` inside `try`; on 201 `router.push(`/spaces/${data.id}/members`)` and `router.refresh()`; else `setProblem(problemFrom(error, response))`. Export it from `spaces/ui/index.ts`.

`src/app/(web)/(app)/spaces/new/layout.tsx` is `settings/layout.tsx` (the shell of the personal space, `spaceId={null}`); `page.tsx` titles itself `spaces.new.title` (`generateMetadata` like the record page) and renders `<div className="mx-auto max-w-[560px]"><h1 className="pt-4 text-2xl font-semibold text-ink">{t("title")}</h1><NewSpaceForm /></div>`. The static segment `new` is matched before the dynamic `[spaceId]`, so `/spaces/new` never reaches the space layout.

Catalog keys, es / en:
- `shell.nav.balances` Saldos / Balances; `shell.profile.members` Miembros e invitaciones / Members and invitations; `shell.profile.membersHint` Invita personas, agrega invitados y cambia roles / Invite people, add guests and change roles; `shell.space.create` Crear espacio compartido / Create a shared space.
- `spaces.new.title` Crear un espacio compartido / Create a shared space; `spaces.new.name` Nombre / Name; `spaces.new.currency` Moneda / Currency; `spaces.new.currencyHint` Una sola moneda por espacio. Deja de poder cambiarse cuando el espacio tiene movimientos. / One currency per space. It can no longer change once the space has transactions.; `spaces.new.note` Quedarás como Propietario y el espacio pasará a ser tu espacio activo. Después invitas a los demás desde Miembros. / You will be its Owner and it becomes your active space. Then invite the others from Members.; `spaces.new.create` Crear espacio / Create space; `spaces.currency.COP` COP · Peso colombiano / COP · Colombian peso; `spaces.currency.USD` USD · Dólar estadounidense / USD · US dollar; `spaces.currency.EUR` EUR · Euro / EUR · Euro.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's command, `pnpm build`, `pnpm test:e2e` (M6a's scenarios: a fresh person's personal space still shows three navigation links), then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/spaces/ui src/modules/identity/ui src/shared/ui/molecules/choice-group.tsx \
  "src/app/(web)/(app)/spaces/new" src/i18n/messages
git commit -m "feat(spaces): add the Saldos tab, the members entry and a shared space created from the switcher (Refs #73)"
```

Risk: none.

---
### Task 6: The members screen, role-gated controls and role changes

The Main artboard as `/spaces/{spaceId}/members` (ruling P159): the space's name, currency and period policy, every current member with their role, the guests with `members.guestSuffix` (the story's key), the viewer's own row marked "(tú)", and for an OWNER a role control on everyone else's row (`ChangeMemberRole`, ruling P164). Which controls exist is decided by `SPACE_CONTROLS`, the UI's copy of HU-E1-05's matrix for these screens, pinned by a test to the domain's `can()` (ruling P158): a control the person may not use is not rendered, and the API stays the authority (an `InsufficientRole` would show as any problem). Tasks 7 and 8 add the Invite and Add guest actions to this screen; the scenario "Controls follow the member's role" closes in Task 8.

**Files:**
- Create: `src/modules/spaces/ui/members/{space-controls.ts, space-controls.test.ts, member-label.ts, member-label.test.ts, member-row.tsx, role-sheet.tsx, members-screen.tsx, members.test.tsx, members-container.tsx, members-container.test.tsx}`, `src/app/(web)/(app)/spaces/[spaceId]/members/page.tsx`
- Modify: `src/modules/spaces/ui/index.ts`, `src/modules/spaces/ui/server.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `MemberDto`, `SpaceDto`, `memberDto`, `guestDto`, `householdSpace` (Task 4); `Sheet`, `ChoiceGroup`, `Button`, `Badge`, `Avatar`, `Icon`, `ProblemNotice`, `formatDate`, `localDateIn`, `loaded`, `serverApi`, `getMe`, `getSpaces`.
- Produces:
  - `type SpaceRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER"`; `interface MemberControls { invite; addGuest; changeRoles; claimLinks; removeGuests; recordMoney }` (booleans); `SPACE_CONTROLS: Record<keyof MemberControls, readonly SpaceRole[]>`; `controlsFor(role: SpaceRole | null, kind: SpaceDto["kind"]): MemberControls` (invite, guests and roles only in a SHARED space; claim links in SHARED and DIRECT spaces).
  - `memberLabel(member: Pick<MemberDto, "displayName" | "kind" | "userId">, meUserId: string, t: MemberLabelT): string` with `type MemberLabelT = (key: "you" | "guestSuffix", values?: { name: string }) => string` — "Ana (tú)", "Pedro (invitado)", "Juan"; exported from `spaces/ui/index.ts` with `controlsFor` (the split editor and the balances screen reuse both).
  - `MembersScreen({ space, members, meUserId, formats, viewerZone, api? })` (client); `MemberRow`; `RoleSheet({ open, onOpenChange, spaceId, member, api? })` (`PATCH …/members/{memberId}` `{ role }`, then `router.refresh()`).
  - `loadMembers(api: Api, input: { spaceId: string }): Promise<Loaded<{ members: MemberDto[] }>>`; `MembersContainer({ spaceId })` (server; a personal space is `notFound()`, it has no members screen); page `/spaces/{spaceId}/members`. Tasks 7 and 8 widen `loadMembers` and `MembersScreen`.

- [ ] **Step 1: Write the failing tests**

`src/modules/spaces/ui/members/space-controls.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { can } from "@/modules/spaces/domain/permissions";
import { controlsFor, SPACE_CONTROLS, type MemberControls } from "./space-controls";

const ACTIONS = {
  invite: "member.invite",
  addGuest: "guest.add",
  changeRoles: "member.changeRole",
  claimLinks: "member.invite",
  removeGuests: "guest.remove",
  recordMoney: "money.record",
} as const satisfies Record<keyof MemberControls, string>;
const ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

describe("space controls (HU-E9-05, ruling P158)", () => {
  it("gives each control exactly the roles the domain's permission matrix gives its action", () => {
    for (const [control, action] of Object.entries(ACTIONS))
      for (const role of ROLES)
        expect([control, role, (SPACE_CONTROLS[control as keyof MemberControls] as readonly string[]).includes(role)]).toEqual([
          control,
          role,
          can(role, action),
        ]);
  });

  it("shows Luis, a MEMBER, Add guest but not Invite, and Sofi, a VIEWER, neither", () => {
    expect(controlsFor("MEMBER", "SHARED")).toMatchObject({ invite: false, addGuest: true, changeRoles: false });
    expect(Object.values(controlsFor("VIEWER", "SHARED")).some(Boolean)).toBe(false);
    expect(Object.values(controlsFor(null, "SHARED")).some(Boolean)).toBe(false);
  });

  it("offers no invitation, guest or role control in a direct space, only its guest's claim link", () => {
    expect(controlsFor("OWNER", "DIRECT")).toEqual({
      invite: false,
      addGuest: false,
      changeRoles: false,
      claimLinks: true,
      removeGuests: false,
      recordMoney: true,
    });
  });
});
```

(A `.test.ts` file, so dependency-cruiser lets it read the spaces domain, as M6a's `account-fields.test.ts` reads the accounts domain.)

`src/modules/spaces/ui/members/member-label.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { guestDto, memberDto } from "../../../../../tests/support/ui/dto";
import { memberLabel } from "./member-label";

const t = (key: "you" | "guestSuffix", values?: { name: string }) =>
  key === "you" ? `${values!.name} (tú)` : "(invitado)";

describe("memberLabel (HU-E9-05)", () => {
  it("marks the viewer and the guests, and leaves the others as they are", () => {
    expect(memberLabel(memberDto(), "u-ana", t)).toBe("Ana (tú)");
    expect(memberLabel(guestDto(), "u-ana", t)).toBe("Pedro (invitado)");
    expect(memberLabel(memberDto({ userId: "u-juan", displayName: "Juan" }), "u-ana", t)).toBe("Juan");
  });
});
```

`src/modules/spaces/ui/members/members.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { guestDto, householdSpace, memberDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { MembersScreen } from "./members-screen";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

// HU-E1-05's Household: OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi and the guest Pedro.
const MEMBERS = [
  memberDto(),
  memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "ADMIN", joinedAt: "2026-10-03T15:00:00.000Z" }),
  memberDto({ id: "m-luis", userId: "u-luis", displayName: "Luis", role: "MEMBER", joinedAt: "2026-10-05T15:00:00.000Z" }),
  memberDto({ id: "m-sofi", userId: "u-sofi", displayName: "Sofi", role: "VIEWER", joinedAt: "2026-10-05T16:00:00.000Z" }),
  guestDto(),
];
const screenAs = (meUserId: string, role: SpaceDto["role"], api: Api = fakeApi({}).api, space = householdSpace({ role })) =>
  renderWithIntl(
    <MembersScreen space={space} members={MEMBERS} meUserId={meUserId} formats={BUILT_IN_FORMATS} viewerZone="America/Bogota" api={api} />,
  );
const rowOf = (name: string) => screen.getByRole("listitem", { name });

describe("members screen (HU-E9-05)", () => {
  it("lists every member with their role, the viewer and the guest marked", async () => {
    const { container } = screenAs("u-ana", "OWNER");
    expect(screen.getByRole("heading", { level: 1, name: "Miembros" })).toBeInTheDocument();
    expect(screen.getByText("Household · COP · mensual, corte el 1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "5 miembros" })).toBeInTheDocument();
    expect(within(rowOf("Ana (tú)")).getByText("Propietario")).toBeInTheDocument();
    expect(within(rowOf("Juan")).getByText("Se unió el 3/10/2026")).toBeInTheDocument();
    expect(within(rowOf("Pedro (invitado)")).getByText("Sin cuenta · no inicia sesión")).toBeInTheDocument();
    expect(within(rowOf("Pedro (invitado)")).getByText("Sin rol")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("lets the OWNER change Juan's role, and never her own", async () => {
    const { api, requests } = fakeApi({
      "PATCH /api/v1/spaces/{spaceId}/members/{memberId}": () => jsonResponse({ ...MEMBERS[1], role: "MEMBER" }),
    });
    screenAs("u-ana", "OWNER", api);
    expect(within(rowOf("Ana (tú)")).queryByRole("button")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rol de Juan: Administrador. Cambiar" }));
    const sheet = screen.getByRole("dialog", { name: "Rol de Juan" });
    expect(within(sheet).getByRole("radio", { name: /Administrador/ })).toBeChecked();
    await userEvent.click(within(sheet).getByRole("radio", { name: /Miembro/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Guardar rol" }));
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-household/members/m-juan");
    expect(await requests[0]!.json()).toEqual({ role: "MEMBER" });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the sheet open with LastOwnerRequired when the last owner is demoted", async () => {
    const { api } = fakeApi({
      "PATCH /api/v1/spaces/{spaceId}/members/{memberId}": () => problemResponse(409, "LastOwnerRequired"),
    });
    const owners = householdSpace({ role: "OWNER" });
    renderWithIntl(
      <MembersScreen space={owners} members={[memberDto(), memberDto({ id: "m-bea", userId: "u-bea", displayName: "Bea", role: "OWNER" })]}
        meUserId="u-bea" formats={BUILT_IN_FORMATS} viewerZone="America/Bogota" api={api} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Rol de Ana: Propietario. Cambiar" }));
    await userEvent.click(screen.getByRole("radio", { name: /Lector/ }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar rol" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El espacio necesita al menos un propietario. Nombra otro primero.",
    );
    expect(screen.getByRole("dialog", { name: "Rol de Ana" })).toBeInTheDocument();
  });

  it("shows roles without controls to a MEMBER, and the read-only note to a VIEWER", () => {
    const { unmount } = screenAs("u-luis", "MEMBER");
    expect(screen.queryByRole("button", { name: /^Rol de/ })).not.toBeInTheDocument();
    unmount();
    screenAs("u-sofi", "VIEWER");
    expect(
      screen.getByText("Tu rol en Household es Lector: puedes ver miembros y saldos, pero no invitar ni agregar invitados."),
    ).toBeInTheDocument();
  });

  it("says a direct space takes nobody else", () => {
    screenAs("u-ana", "OWNER", fakeApi({}).api, householdSpace({ kind: "DIRECT", name: "Ana & Juan" }));
    expect(screen.getByText("Ana & Juan es un espacio solo para dos: no admite más miembros.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Rol de/ })).not.toBeInTheDocument();
  });
});
```

(Note the "LastOwnerRequired" render: Bea is the viewer and an OWNER, so Ana's row has a role control; the API refuses because the test says so.)

`src/modules/spaces/ui/members/members-container.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { memberDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";

vi.mock("@/shared/ui/api/server", async () => ({
  loaded: async (call: Promise<{ data?: unknown; response: Response }>) => {
    const { data } = await call;
    return { ok: true, data };
  },
}));
const { loadMembers } = await import("./members-container");

describe("loadMembers (HU-E9-05)", () => {
  it("reads the current members of the space", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [memberDto()] }),
    });
    expect(await loadMembers(api, { spaceId: "sp-household" })).toEqual({ ok: true, data: { members: [memberDto()] } });
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual(["/api/v1/spaces/sp-household/members"]);
  });
});
```

(`loaded` is mocked to a pass-through so the loader runs in jsdom without `next/headers`; M6a's container tests do the same.)

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/spaces/ui/members` and `pnpm exec vitest run --project ui src/modules/spaces/ui/members`
Expected: FAIL — `Cannot find module './space-controls'` and the other new modules.

- [ ] **Step 3: Implement**

`src/modules/spaces/ui/members/space-controls.ts`:

```ts
import type { SpaceDto } from "@/shared/ui/api/dto";

export type SpaceRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

/** What the household screens may offer the viewer; each maps to one action of HU-E1-05's matrix. */
export interface MemberControls {
  readonly invite: boolean;
  readonly addGuest: boolean;
  readonly changeRoles: boolean;
  readonly claimLinks: boolean;
  readonly removeGuests: boolean;
  readonly recordMoney: boolean;
}

/**
 * Ruling P158: the UI's copy of the matrix (`src/modules/spaces/domain/permissions.ts`) for these screens, pinned to it
 * by `space-controls.test.ts`. The UI may not import the domain (P119); the API stays the authority.
 */
export const SPACE_CONTROLS = {
  invite: ["OWNER", "ADMIN"],
  addGuest: ["OWNER", "ADMIN", "MEMBER"],
  changeRoles: ["OWNER"],
  claimLinks: ["OWNER", "ADMIN"],
  removeGuests: ["OWNER", "ADMIN", "MEMBER"],
  recordMoney: ["OWNER", "ADMIN", "MEMBER"],
} as const satisfies Record<keyof MemberControls, readonly SpaceRole[]>;

/**
 * The controls a role gets in a space. D16: a direct space keeps its two members (no invitations, guests or role
 * changes), but its guest can still be handed a claim link (HU-E1-11); a personal space has none of these screens.
 */
export const controlsFor = (role: SpaceRole | null, kind: SpaceDto["kind"]): MemberControls => {
  const has = (control: keyof MemberControls) =>
    role !== null && (SPACE_CONTROLS[control] as readonly SpaceRole[]).includes(role);
  const shared = kind === "SHARED";
  return {
    invite: shared && has("invite"),
    addGuest: shared && has("addGuest"),
    changeRoles: shared && has("changeRoles"),
    claimLinks: kind !== "PERSONAL" && has("claimLinks"),
    removeGuests: shared && has("removeGuests"),
    recordMoney: has("recordMoney"),
  };
};
```

`src/modules/spaces/ui/members/member-label.ts`:

```ts
import type { MemberDto } from "@/shared/ui/api/dto";

export type MemberLabelT = (key: "you" | "guestSuffix", values?: { name: string }) => string;

/**
 * HU-E9-05: a member as every household screen names them: the viewer as "Ana (tú)", a guest with the story's
 * `members.guestSuffix` ("Pedro (invitado)"), anyone else by their stored name.
 */
export const memberLabel = (
  member: Pick<MemberDto, "displayName" | "kind" | "userId">,
  meUserId: string,
  t: MemberLabelT,
): string => {
  if (member.userId !== null && member.userId === meUserId) return t("you", { name: member.displayName });
  return member.kind === "GUEST" ? `${member.displayName} ${t("guestSuffix")}` : member.displayName;
};
```

`member-row.tsx` (presentational, no `"use client"`): `MemberRow({ member, label, detail, roleText, onRole? })` renders an `<li aria-labelledby={`member-${member.id}`}>` with an `Avatar`, the label in `<span id={`member-${member.id}`}>`, the detail under it, and on the right either a button (when `onRole` is set: `aria-label` = `members.role` with `name` and `role`, visible text `roleText` and a `chevronDown`) or the role as a `Badge`; Task 8 adds an options slot. `detail` is `members.joined` with `formatDate(localDateIn(new Date(member.joinedAt), viewerZone), formats)` for a registered member and `members.guestDetail` for a guest; `roleText` is `shell.role.<ROLE>` or `members.noRole`.

`role-sheet.tsx` (`"use client"`): a `Sheet` titled `members.roleSheet.title` (`name`) holding a `ChoiceGroup` `layout="grid"`-free list (use `layout="chips"`) labelled `members.roleSheet.label` whose options are the four roles, each label `shell.role.<ROLE>` with `members.roleDetail.<ROLE>` under it; a `ProblemNotice` for a problem; an `lg` button `members.roleSheet.save`, disabled while pending or when the choice equals the current role. Save: `api.PATCH("/api/v1/spaces/{spaceId}/members/{memberId}", { params: { path: { spaceId, memberId } }, body: { role } })` in `try`; on 200 `onOpenChange(false)` and `router.refresh()`; else the problem stays in the sheet.

`members-screen.tsx` (`"use client"`): an `h1` `members.title`; under it `members.subtitle` with `space`, `currency` and `policy` = `members.policy.MONTHLY` (`day`) or `members.policy.SEMI_MONTHLY` (`day1`, `day2`) from `space.periodPolicy`; `const controls = controlsFor(space.role, space.kind)`; when the space is DIRECT, `members.directNote` (`space`); otherwise, when `!controls.invite && !controls.addGuest`, `members.readOnlyNote` (`space`, `role` = `shell.role.<role>`); a `section` with the `h2` `members.count` and an `<ul>` of `MemberRow`s in the API's (join) order; `onRole` is set for a registered member who is not the viewer when `controls.changeRoles`; one `RoleSheet` for the member being edited. `memberLabel` is called with `useTranslations("members")`'s `t`.

`members-container.tsx` (server):

```tsx
import { notFound } from "next/navigation";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { MemberDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { MembersScreen } from "./members-screen";

/** HU-E9-05: the current members of a space, in join order. */
export const loadMembers = async (
  api: Api,
  input: { spaceId: string },
): Promise<Loaded<{ members: MemberDto[] }>> => {
  const members = await loaded(
    api.GET("/api/v1/spaces/{spaceId}/members", { params: { path: { spaceId: input.spaceId } } }),
  );
  return members.ok ? { ok: true, data: { members: members.data.items } } : members;
};

/** Server: the members screen of a shared or direct space; a personal space has none (ruling P159). */
export async function MembersContainer({ spaceId }: { readonly spaceId: string }) {
  const [me, spaces] = await Promise.all([getMe(), getSpaces()]);
  const space = spaces.find((s) => s.id === spaceId);
  if (!space || space.kind === "PERSONAL") notFound();
  const result = await loadMembers(await serverApi(), { spaceId });
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  return (
    <MembersScreen
      space={space}
      members={result.data.members}
      meUserId={me!.id}
      formats={me!.preferences.effective}
      viewerZone={me!.timezone}
    />
  );
}
```

Export `MembersContainer` from `spaces/ui/server.ts`, and `controlsFor`, `type MemberControls`, `memberLabel` and `type MemberLabelT` from `spaces/ui/index.ts`. The page `src/app/(web)/(app)/spaces/[spaceId]/members/page.tsx` titles itself `members.title` (`generateMetadata`) and renders `<div className="mx-auto max-w-[720px] py-4"><MembersContainer spaceId={(await params).spaceId} /></div>`.

Catalog keys (`members`), es / en: `title` Miembros / Members; `subtitle` {space} · {currency} · {policy} / {space} · {currency} · {policy}; `policy.MONTHLY` mensual, corte el {day} / monthly, cut-off on day {day}; `policy.SEMI_MONTHLY` quincenal, días {day1} y {day2} / twice a month, days {day1} and {day2}; `count` {count, plural, one {# miembro} other {# miembros}} / {count, plural, one {# member} other {# members}}; `you` {name} (tú) / {name} (you); `guestSuffix` (invitado) / (guest); `joined` Se unió el {date} / Joined on {date}; `guestDetail` Sin cuenta · no inicia sesión / No account · cannot sign in; `noRole` Sin rol / No role; `role` Rol de {name}: {role}. Cambiar / {name}'s role: {role}. Change; `readOnlyNote` Tu rol en {space} es {role}: puedes ver miembros y saldos, pero no invitar ni agregar invitados. / Your role in {space} is {role}: you can see members and balances, but not invite or add guests.; `directNote` {space} es un espacio solo para dos: no admite más miembros. / {space} is a space for two: it takes no other members.; `roleSheet.title` Rol de {name} / {name}'s role; `roleSheet.label` Rol / Role; `roleSheet.save` Guardar rol / Save role; `roleDetail.OWNER` Todo, incluido cambiar roles y archivar el espacio / Everything, including changing roles and archiving the space; `roleDetail.ADMIN` Invita, maneja el plan y edita lo de todos / Invites, runs the plan and edits everyone's entries; `roleDetail.MEMBER` Registra gastos y pagos, agrega invitados / Records expenses and payments, adds guests; `roleDetail.VIEWER` Solo ve movimientos, saldos y tableros / Only sees transactions, balances and dashboards.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, `pnpm build`, `pnpm test:e2e`, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/spaces/ui "src/app/(web)/(app)/spaces/[spaceId]/members" src/i18n/messages
git commit -m "feat(spaces): add the members screen with role-gated controls and role changes (Refs #73)"
```

**Split point** (if the staged candidate is over ~500 lines): first `space-controls.ts`, `member-label.ts` and their tests (about 150 lines, `feat(spaces): mirror the permission matrix for the household screens (Refs #73)`); then the rest (`feat(spaces): add the members screen with role changes (Refs #73)`), each green on its own.

Risk: none.

---

### Task 7: Invite by link or email, and the pending invitations

The Invite artboard as a sheet of the members screen, for OWNER and ADMIN (`controls.invite`), and the Main artboard's "Invitaciones pendientes" with Revocar (rulings P155 and P162). The sheet chooses link or email and the role (ADMIN, MEMBER or VIEWER; nobody joins as OWNER), and creates the invitation **only when the person presses the button** (opening the sheet creates nothing); the URL comes back once and is shown in a `CopyField`. An email invitation also shows its URL when the API answers `emailSent: false`, because Hearth does not send mail yet (P144). A pending invitation's URL cannot be shown again (only its hash is stored), so the pending list offers Revocar, never Copy.

**Files:**
- Create: `src/modules/spaces/ui/members/{invite-sheet.tsx, pending-invitations.tsx, members-invite.test.tsx}`
- Modify: `src/modules/spaces/ui/members/{members-screen.tsx, members-container.tsx, members-container.test.tsx}`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `CopyField`, `invitationDto`, `CreatedInvitationDto`, `InvitationDto`, `controlsFor`, `fieldOf`, `useProblemMessage`, `formatDate`, `localDateIn`.
- Produces: `InviteSheet({ open, onOpenChange, space, formats, viewerZone, api? })`; `PendingInvitations({ spaceId, invitations, formats, viewerZone, api? })`; `MembersScreen` gains `invitations?: readonly InvitationDto[] | null` (default `null`: the viewer may not invite, so Task 6's tests keep rendering unchanged) and the `members.invite` button; `loadMembers(api, { spaceId, canInvite: boolean })` reads `GET …/invitations` only when `canInvite`.

- [ ] **Step 1: Write the failing tests**

`src/modules/spaces/ui/members/members-invite.test.tsx` (the same `router` mock, `MEMBERS` and imports as `members.test.tsx`; `screenAs` passes `invitations`):

```tsx
const PENDING = [
  invitationDto({ id: "inv-2", kind: "EMAIL", email: "marta@example.com", role: "MEMBER", expiresAt: "2026-10-26T14:00:00.000Z" }),
  invitationDto({ id: "inv-1", kind: "LINK", role: "VIEWER", expiresAt: "2026-10-24T14:00:00.000Z" }),
];
const created = (body: Partial<{ kind: "LINK" | "EMAIL"; email: string | null; role: string }>, emailSent = false) =>
  jsonResponse(
    { invitation: invitationDto({ id: "inv-9", ...body } as never), url: "https://hearth.example/invitations/AbC", emailSent },
    201,
  );
const screenAs = (meUserId: string, role: SpaceDto["role"], api: Api, invitations: InvitationDto[] | null = []) =>
  renderWithIntl(
    <MembersScreen space={householdSpace({ role })} members={MEMBERS} meUserId={meUserId} invitations={invitations}
      formats={BUILT_IN_FORMATS} viewerZone="America/Bogota" api={api} />,
  );
const openInvite = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Invitar" }));
  return screen.getByRole("dialog", { name: "Invitar a Household" });
};

describe("inviting people (HU-E9-05, ruling P162)", () => {
  it("shows Invite to the OWNER and not to a MEMBER", () => {
    const { unmount } = screenAs("u-ana", "OWNER", fakeApi({}).api);
    expect(screen.getByRole("button", { name: "Invitar" })).toBeInTheDocument();
    unmount();
    screenAs("u-luis", "MEMBER", fakeApi({}).api, null);
    expect(screen.queryByRole("button", { name: "Invitar" })).not.toBeInTheDocument();
  });

  it("creates a link as VIEWER only when asked, and shows its URL once with Copy", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/invitations": () => created({ kind: "LINK", role: "VIEWER" }) });
    screenAs("u-ana", "OWNER", api);
    const sheet = await openInvite();
    expect(requests).toHaveLength(0);
    expect(within(sheet).getByRole("radio", { name: /Miembro/ })).toBeChecked();
    expect(within(sheet).queryByRole("radio", { name: /Propietario/ })).not.toBeInTheDocument();
    expect(within(sheet).getByText("Nadie se une como Propietario: ese rol se cambia desde Miembros.")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("radio", { name: /Lector/ }));
    await userEvent.dblClick(within(sheet).getByRole("button", { name: "Crear enlace" }));
    expect(await within(sheet).findByLabelText("Enlace de invitación")).toHaveValue("https://hearth.example/invitations/AbC");
    expect(requests).toHaveLength(1);
    expect(await requests[0]!.json()).toEqual({ kind: "LINK", role: "VIEWER" });
    expect(within(sheet).getByText(/Rol Lector · vence el 19\/10\/2026\. Sirve para varias personas/)).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("puts InvalidEmail under the email, then shows the URL when Hearth could not send the email", async () => {
    let calls = 0;
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/invitations": () =>
        (calls += 1) === 1 ? problemResponse(422, "InvalidEmail") : created({ kind: "EMAIL", email: "marta@example.com" }, false),
    });
    screenAs("u-ana", "OWNER", api);
    const sheet = await openInvite();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Correo" }));
    await userEvent.type(within(sheet).getByLabelText("Correo de la persona"), "marta@");
    await userEvent.click(within(sheet).getByRole("button", { name: "Enviar invitación" }));
    await waitFor(() =>
      expect(within(sheet).getByLabelText("Correo de la persona")).toHaveAccessibleDescription(
        "Solo esa cuenta podrá aceptarla, una vez, durante 7 días. Escribe un correo válido.",
      ),
    );
    await userEvent.type(within(sheet).getByLabelText("Correo de la persona"), "example.com");
    await userEvent.click(within(sheet).getByRole("button", { name: "Enviar invitación" }));
    expect(await within(sheet).findByText("Hearth todavía no envía correos: copia el enlace y compártelo con marta@example.com.")).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Enlace de invitación")).toHaveValue("https://hearth.example/invitations/AbC");
    expect(await requests[1]!.json()).toEqual({ kind: "EMAIL", email: "marta@example.com", role: "MEMBER" });
  });

  it("lists the pending invitations with their role and expiry, and revokes one", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/invitations/{invitationId}/revoke": () => jsonResponse({ ...PENDING[0], status: "REVOKED" }),
    });
    screenAs("u-ana", "OWNER", api, PENDING);
    const pending = screen.getByRole("region", { name: "Invitaciones pendientes" });
    expect(normalized(pending.textContent)).toContain("marta@example.comCorreo · Miembro · vence el 26/10/2026");
    expect(normalized(pending.textContent)).toContain("Enlace de invitaciónLector · varias personas · vence el 24/10/2026");
    expect(within(pending).queryByRole("button", { name: /Copiar/ })).not.toBeInTheDocument();
    await userEvent.click(within(pending).getByRole("button", { name: "Revocar la invitación de marta@example.com" }));
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-household/invitations/inv-2/revoke");
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });
});
```

(`invitationDto`, `normalized` and `InvitationDto` are imported beside the other builders and types.)

`members-container.test.tsx`, add:

```tsx
  it("reads the pending invitations only for someone who may invite (ruling P155)", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [memberDto()] }),
      "GET /api/v1/spaces/{spaceId}/invitations": () => jsonResponse({ items: [invitationDto()] }),
    });
    expect(await loadMembers(api, { spaceId: "sp-household", canInvite: true })).toMatchObject({
      ok: true,
      data: { invitations: [invitationDto()] },
    });
    expect(await loadMembers(api, { spaceId: "sp-household", canInvite: false })).toMatchObject({
      ok: true,
      data: { invitations: null },
    });
    expect(requests.filter((r) => r.url.endsWith("/invitations"))).toHaveLength(1);
  });
```

and pass `canInvite: false` in the first test.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project ui src/modules/spaces/ui/members`
Expected: FAIL — no "Invitar" button; `loadMembers` answers no `invitations`.

- [ ] **Step 3: Implement**

`members-container.tsx`: the input gains `readonly canInvite: boolean`; read members and, when `canInvite`, `GET /api/v1/spaces/{spaceId}/invitations`, in parallel through `loaded`; answer `{ members, invitations: canInvite ? items : null }`. `MembersContainer` passes `canInvite: controlsFor(space.role, space.kind).invite` and `invitations` to the screen.

`invite-sheet.tsx` (`"use client"`): a `Sheet` titled `members.inviteSheet.title` (`space`); a segmented `ChoiceGroup` `members.inviteSheet.how` with `link` and `email`; a `ChoiceGroup` `members.inviteSheet.role` (`layout="chips"`) of ADMIN, MEMBER, VIEWER (default MEMBER), each label `shell.role.<ROLE>` with `members.roleDetail.<ROLE>`; the note `members.inviteSheet.ownerNote`; for email a `TextField` `id="invite-email"` `type="email"` labelled `members.inviteSheet.email` with the hint `members.inviteSheet.emailHint`; the button `members.inviteSheet.createLink` or `members.inviteSheet.send`, disabled while pending. Submit: `api.POST("/api/v1/spaces/{spaceId}/invitations", { params: { path: { spaceId } }, body })` with `{ kind: "LINK", role }` or `{ kind: "EMAIL", email: email.trim(), role }`; on 201 keep the `CreatedInvitationDto`, `router.refresh()`; the result block shows `members.inviteSheet.linkReady`, then for email `members.inviteSheet.sent` (`email`) when `emailSent` and `members.inviteSheet.notSent` (`email`) otherwise, then a `CopyField` `id="invite-url"` labelled `members.inviteSheet.linkLabel` with the note `members.inviteSheet.linkNote` (`role` = `shell.role.<role>`, `date` = the expiry's local date in `viewerZone`, formatted). Changing the tab, the role or the email clears the result. Problems: `fieldOf(problem, { InvalidEmail: "email" }, ["email"])` puts the message under the email; any other problem is a `ProblemNotice` (an `AlreadyMember` or `InsufficientRole` included).

`pending-invitations.tsx` (`"use client"`): nothing when the list is empty; else a `section` labelled by its `h2` `members.pending`, an `<ul>` whose items show, for EMAIL, the address over `members.pendingEmail` (`role`, `date`) and, for LINK, `members.pendingLinkTitle` over `members.pendingLink` (`role`, `date`), and a ghost danger button with visible text `members.revoke` and the accessible name `members.revokeEmail` (`email`) or `members.revokeLink` (`role`). Revoke: `api.POST("/api/v1/spaces/{spaceId}/invitations/{invitationId}/revoke", …)`, the button disabled while pending; on 200 `router.refresh()`; a problem is a `ProblemNotice` above the list.

`members-screen.tsx`: under the subtitle, when `controls.invite`, a primary `Button` with the `link` icon and `members.invite` that opens `InviteSheet`; at the end, `PendingInvitations` when `invitations` is not null.

Catalog keys (`members`), es / en: `invite` Invitar / Invite; `inviteSheet.title` Invitar a {space} / Invite to {space}; `inviteSheet.how` Cómo invitar / How to invite; `inviteSheet.link` Enlace / Link; `inviteSheet.email` Correo de la persona / Their email; `inviteSheet.emailTab` Correo / Email; `inviteSheet.role` Rol al unirse / Role when they join; `inviteSheet.ownerNote` Nadie se une como Propietario: ese rol se cambia desde Miembros. / Nobody joins as Owner: that role is changed from Members.; `inviteSheet.createLink` Crear enlace / Create link; `inviteSheet.send` Enviar invitación / Send invitation; `inviteSheet.emailHint` Solo esa cuenta podrá aceptarla, una vez, durante 7 días. / Only that account can accept it, once, within 7 days.; `inviteSheet.linkReady` Enlace listo para compartir / Link ready to share; `inviteSheet.linkLabel` Enlace de invitación / Invitation link; `inviteSheet.linkNote` Rol {role} · vence el {date}. Sirve para varias personas hasta que venza o lo revoques. / Role {role} · expires on {date}. Several people can use it until it expires or you revoke it.; `inviteSheet.sent` Le enviamos la invitación a {email}. / We sent the invitation to {email}.; `inviteSheet.notSent` Hearth todavía no envía correos: copia el enlace y compártelo con {email}. / Hearth does not send email yet: copy the link and share it with {email}.; `pending` Invitaciones pendientes / Pending invitations; `pendingEmail` Correo · {role} · vence el {date} / Email · {role} · expires on {date}; `pendingLinkTitle` Enlace de invitación / Invitation link; `pendingLink` {role} · varias personas · vence el {date} / {role} · several people · expires on {date}; `revoke` Revocar / Revoke; `revokeEmail` Revocar la invitación de {email} / Revoke the invitation for {email}; `revokeLink` Revocar el enlace de invitación como {role} / Revoke the invitation link as {role}. (The tab labels are `inviteSheet.link` and `inviteSheet.emailTab`.)

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's command, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/spaces/ui/members src/i18n/messages
git commit -m "feat(spaces): invite people by link or email and revoke pending invitations (Refs #73)"
```

Risk: none.

---

### Task 8: Guests: add one, hand over a claim link, remove a settled one

The AddGuest and GuestSheet artboards (scenarios "An added guest is offered as payer and participant" — its members-screen half; "Create a claim link for a guest"; "Removing a guest with a balance shows the outstanding amount"; and "Controls follow the member's role", completed here; ruling P163). Add guest is offered to OWNER, ADMIN and MEMBER in a shared space; a guest's row has an options button when the viewer may create claim links or remove guests; the guest sheet shows the guest's balance sentence, creates a single-use claim link valid 7 days and shows it in a `CopyField`, and removes the guest after a confirmation. A removal refused with `OutstandingBalance` shows `errors.OutstandingBalance` with the problem's `outstanding` amount under it, and the guest stays listed. (The sheet's "Registrar pago" link joins in Task 19, when the settle-up form exists.)

**Files:**
- Create: `src/modules/spaces/ui/members/{add-guest-sheet.tsx, guest-sheet.tsx, members-guests.test.tsx}`, `src/modules/balances/ui/{net-state.ts, net-state.test.ts, index.ts}`
- Modify: `src/modules/spaces/ui/members/{members-screen.tsx, member-row.tsx, members-container.tsx, members-container.test.tsx}`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `CopyField`, `ProblemNotice` with `detail`, `Problem.outstanding`, `BalancesDto`, `formatMoney`, `controlsFor`, `memberLabel`.
- Produces: the new module `src/modules/balances/ui` starts here with `net-state.ts`: `type NetState = "owes" | "owed" | "settled"`, `netState(net: MoneyDto): NetState`, `absolute(money: MoneyDto): MoneyDto`, `type SentenceT = (key: "member.owes" | "member.owed" | "member.settled", values: { amount: string }) => string` and `memberSentence(net: MoneyDto, formats: Formats, t: SentenceT): string` ("debe $ 100.000", "le deben $ 150.000", "a paz y salvo"), exported from `balances/ui/index.ts` (Task 17 reuses them; nobody re-implements the sign rule); `AddGuestSheet({ open, onOpenChange, space, api? })` (`POST …/guests` `{ displayName, contactEmail? }`); `GuestSheet({ open, onOpenChange, space, guest, label, net, controls, formats, viewerZone, api? })` (`POST …/guests/{memberId}/claim-links`, `DELETE …/guests/{memberId}`); `MemberRow` gains `onOptions?: () => void` (`members.guestOptions`); `MembersScreen` gains `balances?: Readonly<Record<string, MoneyDto>>` (net by member id, default `{}`); `loadMembers` also reads `GET …/balances` and answers `balances`.

- [ ] **Step 1: Write the failing tests**

`src/modules/balances/ui/net-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cop } from "../../../../tests/support/ui/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { absolute, memberSentence, netState } from "./net-state";

const t = (key: string, values: { amount: string }) =>
  ({ "member.owes": `debe ${values.amount}`, "member.owed": `le deben ${values.amount}`, "member.settled": "a paz y salvo" })[key]!;
const norm = (text: string) => text.replace(/\s/g, " ");

describe("net balances as sentences (HU-E9-07, ruling P173)", () => {
  it("reads a negative net as owing, a positive one as owed and zero as settled, never by its sign", () => {
    expect([netState(cop(-100_000)), netState(cop(150_000)), netState(cop(0))]).toEqual(["owes", "owed", "settled"]);
    expect(absolute(cop(-100_000))).toEqual(cop(100_000));
    expect(norm(memberSentence(cop(-100_000), BUILT_IN_FORMATS, t))).toBe("debe $ 100.000");
    expect(norm(memberSentence(cop(150_000), BUILT_IN_FORMATS, t))).toBe("le deben $ 150.000");
    expect(memberSentence(cop(0), BUILT_IN_FORMATS, t)).toBe("a paz y salvo");
  });
});
```

`src/modules/spaces/ui/members/members-guests.test.tsx` (same mocks and `MEMBERS` as `members.test.tsx`; `screenAs(meUserId, role, api, balances = {})` also passes `invitations={null}` and `balances`):

```tsx
describe("guests (HU-E9-05, ruling P163)", () => {
  it("shows Luis, a MEMBER, Add guest but not Invite, and Sofi, a VIEWER, neither", () => {
    const { unmount } = screenAs("u-luis", "MEMBER", fakeApi({}).api);
    expect(screen.getByRole("button", { name: "Agregar invitado" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invitar" })).not.toBeInTheDocument();
    unmount();
    screenAs("u-sofi", "VIEWER", fakeApi({}).api);
    expect(screen.queryByRole("button", { name: "Agregar invitado" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invitar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Opciones de Pedro (invitado)" })).not.toBeInTheDocument();
  });

  it("adds the guest Pedro with an optional email", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/guests": () => jsonResponse(guestDto(), 201) });
    screenAs("u-luis", "MEMBER", api);
    await userEvent.click(screen.getByRole("button", { name: "Agregar invitado" }));
    const sheet = screen.getByRole("dialog", { name: "Agregar invitado a Household" });
    await userEvent.type(within(sheet).getByLabelText("Nombre"), " Pedro ");
    await userEvent.dblClick(within(sheet).getByRole("button", { name: "Agregar invitado" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(requests).toHaveLength(1);
    expect(await requests[0]!.json()).toEqual({ displayName: "Pedro" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("puts MemberNameTaken under the name", async () => {
    const { api } = fakeApi({ "POST /api/v1/spaces/{spaceId}/guests": () => problemResponse(409, "MemberNameTaken") });
    screenAs("u-ana", "OWNER", api);
    await userEvent.click(screen.getByRole("button", { name: "Agregar invitado" }));
    const sheet = screen.getByRole("dialog", { name: "Agregar invitado a Household" });
    await userEvent.type(within(sheet).getByLabelText("Nombre"), "Juan");
    await userEvent.type(within(sheet).getByLabelText("Correo (opcional)"), "juan@example.com");
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar invitado" }));
    await waitFor(() =>
      expect(within(sheet).getByLabelText("Nombre")).toHaveAccessibleDescription(
        "Se verá con «(invitado)» al lado. No puede repetir el nombre de otro miembro. Ya hay un miembro con ese nombre en este espacio.",
      ),
    );
  });

  it("creates a claim link for Pedro, single use, expiring 7 days later", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/guests/{memberId}/claim-links": () =>
        jsonResponse({ invitation: invitationDto({ kind: "CLAIM" }), url: "https://hearth.example/claims/XyZ", emailSent: false }, 201),
    });
    screenAs("u-ana", "OWNER", api);
    await userEvent.click(screen.getByRole("button", { name: "Opciones de Pedro (invitado)" }));
    const sheet = screen.getByRole("dialog", { name: "Pedro (invitado)" });
    expect(within(sheet).getByText("En Household · a paz y salvo")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Crear enlace para reclamar" }));
    expect(await within(sheet).findByLabelText("Enlace para reclamar")).toHaveValue("https://hearth.example/claims/XyZ");
    expect(within(sheet).getByText("Un solo uso · vence el 19/10/2026")).toBeInTheDocument();
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-household/guests/m-pedro/claim-links");
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("refuses to remove Pedro while he owes 100,000 COP, showing the amount, and keeps him listed", async () => {
    const { api } = fakeApi({
      "DELETE /api/v1/spaces/{spaceId}/guests/{memberId}": () =>
        problemResponse(409, "OutstandingBalance", { outstanding: { amount: "10000000", currency: "COP" } }),
    });
    screenAs("u-ana", "OWNER", api, { "m-pedro": cop(-100_000) });
    await userEvent.click(screen.getByRole("button", { name: "Opciones de Pedro (invitado)" }));
    const sheet = screen.getByRole("dialog", { name: "Pedro (invitado)" });
    expect(normalized(within(sheet).getByText(/En Household/).textContent)).toBe("En Household · debe $ 100.000");
    await userEvent.click(within(sheet).getByRole("button", { name: "Quitar de Household" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Sí, quitar" }));
    const alert = await within(sheet).findByRole("alert");
    expect(alert).toHaveTextContent("Quedan saldos pendientes. Sáldalos antes de continuar.");
    expect(normalized(alert.textContent)).toContain("Saldo pendiente: $ 100.000");
    expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("listitem", { name: "Pedro (invitado)" })).toBeInTheDocument();
  });

  it("removes a settled guest after the confirmation", async () => {
    const { api, requests } = fakeApi({
      "DELETE /api/v1/spaces/{spaceId}/guests/{memberId}": () => new Response(null, { status: 204 }),
    });
    screenAs("u-ana", "OWNER", api);
    await userEvent.click(screen.getByRole("button", { name: "Opciones de Pedro (invitado)" }));
    const sheet = screen.getByRole("dialog", { name: "Pedro (invitado)" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Quitar de Household" }));
    expect(within(sheet).getByText("¿Quitar a Pedro de Household? Su historial se conserva.")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Sí, quitar" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(requests[0]!.method).toBe("DELETE");
  });

  it("gives a MEMBER removal but not claim links", async () => {
    screenAs("u-luis", "MEMBER", fakeApi({}).api);
    await userEvent.click(screen.getByRole("button", { name: "Opciones de Pedro (invitado)" }));
    const sheet = screen.getByRole("dialog", { name: "Pedro (invitado)" });
    expect(within(sheet).queryByRole("button", { name: "Crear enlace para reclamar" })).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Quitar de Household" })).toBeInTheDocument();
  });
});
```

(`cop`, `normalized` and `invitationDto` come from `tests/support/ui/dto`.)

`members-container.test.tsx`: both earlier tests also route `"GET /api/v1/spaces/{spaceId}/balances"` to `jsonResponse({ members: [{ memberId: "m-ana", net: cop(0) }] })`, and the first expects `balances: { "m-ana": cop(0) }`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/balances/ui` and `pnpm exec vitest run --project ui src/modules/spaces/ui/members`
Expected: FAIL — `Cannot find module './net-state'`; no "Agregar invitado" button and no options on Pedro's row.

- [ ] **Step 3: Implement**

`src/modules/balances/ui/net-state.ts`:

```ts
import type { MoneyDto } from "@/shared/ui/api/dto";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";

export type NetState = "owes" | "owed" | "settled";
export type SentenceT = (key: "member.owes" | "member.owed" | "member.settled", values: { amount: string }) => string;

/** HU-E5-01: a negative net owes the space, a positive one is owed, zero is settled up. */
export const netState = (net: MoneyDto): NetState => {
  const value = BigInt(net.amount);
  return value < 0n ? "owes" : value > 0n ? "owed" : "settled";
};

export const absolute = (money: MoneyDto): MoneyDto => ({ ...money, amount: money.amount.replace(/^-/, "") });

/** Ruling P173: a member's net as a sentence of the `balances` catalog, never a sign glued to an amount. */
export const memberSentence = (net: MoneyDto, formats: Formats, t: SentenceT): string =>
  t(`member.${netState(net)}`, { amount: formatMoney(absolute(net), formats) });
```

`src/modules/balances/ui/index.ts`: `export { absolute, memberSentence, netState, type NetState, type SentenceT } from "./net-state";`.

`members-container.tsx`: also read `GET /api/v1/spaces/{spaceId}/balances` in the same `Promise.all`; answer `balances: Object.fromEntries(items.map((m) => [m.memberId, m.net]))`; `MembersContainer` passes it on.

`add-guest-sheet.tsx` (`"use client"`): a `Sheet` titled `members.guestSheet.addTitle` (`space`) with the intro `members.guestSheet.intro` (`space`), a `TextField` `id="guest-name"` labelled `members.guestSheet.name` with the hint `members.guestSheet.nameHint`, a `TextField` `id="guest-email"` `type="email"` labelled `members.guestSheet.email` with the hint `members.guestSheet.emailHint`, and the `lg` button `members.addGuest`, disabled while pending. Body: `{ displayName: name.trim() }` plus `contactEmail: email.trim()` when not empty. Problems: `fieldOf(problem, { MemberNameTaken: "displayName", InvalidMemberName: "displayName", InvalidEmail: "contactEmail" }, ["displayName", "contactEmail"])` (the fields are named as the body's keys, so a `ValidationFailed` path lands on its field too); else a `ProblemNotice`. On 201: `onOpenChange(false)`, `router.refresh()`.

`guest-sheet.tsx` (`"use client"`): a `Sheet` titled with the guest's `label` ("Pedro (invitado)"); the line `members.guest.balance` (`space`, `sentence` = `memberSentence(net, formats, useTranslations("balances"))`); when `controls.claimLinks`, the section `members.guest.claimTitle` (`name` = the guest's stored name) with `members.guest.claimBody` (`space`) and the button `members.guest.createClaim` (disabled while pending), which posts to `…/guests/{memberId}/claim-links` and then shows a `CopyField` `id="claim-url"` labelled `members.guest.claimLabel` with the note `members.guest.claimNote` (`date` of the expiry in `viewerZone`); when `controls.removeGuests`, a danger `Button` `members.guest.remove` (`space`) that turns into the confirmation `members.guest.confirmRemove` (`name`, `space`) with the danger button `members.guest.confirmRemoveAction` and `common.cancel`. Remove: `api.DELETE("/api/v1/spaces/{spaceId}/guests/{memberId}", …)`; on 204 `onOpenChange(false)` and `router.refresh()`; a problem renders `<ProblemNotice problem={p} detail={p.outstanding ? t("guest.outstanding", { amount: formatMoney(p.outstanding, formats) }) : undefined} />`.

`member-row.tsx`: an optional `onOptions` renders, after the role, a 44 px ghost icon button with the `chevronRight` icon and `aria-label` = `members.guestOptions` (`name` = the row's label). `members-screen.tsx`: when `controls.addGuest`, a secondary `Button` with the `userPlus` icon and `members.addGuest` beside Invitar, opening `AddGuestSheet`; a guest's row gets `onOptions` when `controls.claimLinks || controls.removeGuests`, opening one `GuestSheet` with `net = balances[guest.id] ?? { amount: "0", currency: space.currency }`.

Catalog keys (`members`), es / en: `addGuest` Agregar invitado / Add guest; `guestOptions` Opciones de {name} / Options for {name}; `guestSheet.addTitle` Agregar invitado a {space} / Add a guest to {space}; `guestSheet.intro` Para alguien que no usa Hearth. Puede pagar, deber, tener capacidad en el plan y recibir pagos, solo en {space}. No inicia sesión. / For someone who does not use Hearth. They can pay, owe, have capacity in the plan and receive payments, only in {space}. They cannot sign in.; `guestSheet.name` Nombre / Name; `guestSheet.nameHint` Se verá con «(invitado)» al lado. No puede repetir el nombre de otro miembro. / It shows with "(guest)" next to it. It cannot repeat another member's name.; `guestSheet.email` Correo (opcional) / Email (optional); `guestSheet.emailHint` Si se registra después, le envías un enlace para reclamar este lugar y se lleva todo su historial. / If they sign up later, you send them a link to claim this place and they keep all its history.; `guest.balance` En {space} · {sentence} / In {space} · {sentence}; `guest.claimTitle` Enlace para que {name} reclame su lugar / A link for {name} to claim their place; `guest.claimBody` Al registrarse o iniciar sesión con este enlace, su lugar de invitado pasa a su cuenta con todo su historial en {space}, como Miembro. / Signing up or signing in with this link moves their guest place, with all its history in {space}, to their account, as a Member.; `guest.createClaim` Crear enlace para reclamar / Create a claim link; `guest.claimLabel` Enlace para reclamar / Claim link; `guest.claimNote` Un solo uso · vence el {date} / Single use · expires on {date}; `guest.remove` Quitar de {space} / Remove from {space}; `guest.confirmRemove` ¿Quitar a {name} de {space}? Su historial se conserva. / Remove {name} from {space}? Their history is kept.; `guest.confirmRemoveAction` Sí, quitar / Yes, remove; `guest.outstanding` Saldo pendiente: {amount} / Outstanding balance: {amount}. And (`balances`, used here first and reused by Task 17): `member.owes` debe {amount} / owes {amount}; `member.owed` le deben {amount} / is owed {amount}; `member.settled` a paz y salvo / settled up.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's command, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/spaces/ui/members src/modules/balances/ui src/i18n/messages
git commit -m "feat(spaces): add guests, hand them a claim link and remove them once settled (Refs #73)"
```

Risk: none.

---

### Task 9: The invitation and claim pages

The InvitePage artboard at `/invitations/{token}` and `/claims/{token}` (scenario "A visitor accepts a link invitation after signing up", the component half; rulings P157 and P165). The page reads the token's preview (Task 2) and the session, if any, and shows one of these states:

| State | When | Shows |
|---|---|---|
| visitor | preview `PENDING`, no session | "Ana te invita a" / "Household", the role and the expiry, the space's one-line description, **Crear cuenta y unirme** (`/sign-up?invitation=<t>&next=/invitations/<t>`), **Ya tengo cuenta: iniciar sesión** (`/sign-in?next=…&invitation=<t>`) and "Después de crear la cuenta vuelves aquí para aceptar." |
| signed in | preview `PENDING`, a session | "Entraste como <email>. Al aceptar, Household aparece en tu selector de espacios.", **Aceptar y entrar a Household** (`POST …/accept`, then the space's home) and **Ahora no** (`/`) |
| other account | the accept answered `InvitationEmailMismatch` | "Esta invitación es para otra cuenta y entraste como <email>.", "Inicia sesión con la cuenta a la que llegó la invitación." and **Cerrar sesión y cambiar de cuenta** (sign out, then the sign-in screen with `next` back here) |
| expired / revoked / used | preview `EXPIRED`, `REVOKED`, `ACCEPTED` | the state's message (naming the inviter when known) and **Ir a Hearth** |
| missing | 404 | `errors.InvitationNotFound` and **Ir a Hearth** |

A claim page says "Ana te envió tu lugar en" / "Household, como Pedro", explains that the guest's history moves to the account, and its actions say **Crear cuenta y reclamar** and **Reclamar mi lugar en Household**. Dates are the person's formats and zone when signed in, else `BUILT_IN_FORMATS` and the installation's zone (`serverZone()`, P182). The email of an email invitation is never shown (the preview has none, P156).

**Files:**
- Create: `src/modules/spaces/ui/invitations/{invitation-state.ts, invitation-state.test.ts, invitation-card.tsx, invitation-card.test.tsx, invitation-container.tsx, invitation-container.test.tsx}`, `src/app/(web)/(open)/invitations/[token]/page.tsx`, `src/app/(web)/(open)/claims/[token]/page.tsx`
- Modify: `src/shared/ui/time/server-now.ts`, `src/shared/ui/time/server-now.test.ts`, `src/modules/spaces/ui/server.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `InvitationPreviewDto`, `ClaimPreviewDto` (Task 4), `outcomeOf`, `serverApi`, `getMe`, `browserApi`, `problemFrom`, `ProblemNotice`, `formatDate`, `localDateIn`, `BUILT_IN_FORMATS`.
- Produces: `serverZone(env?): string` (`APP_TIMEZONE`, else `"America/Bogota"`); `type PageState = "visitor" | "signedIn" | "expired" | "revoked" | "used" | "missing"`; `pageStateOf(status: InvitationPreviewDto["status"] | null, signedIn: boolean): PageState`; `type PreviewOf<K> = K extends "invitation" ? InvitationPreviewDto : ClaimPreviewDto`; `loadPreview(api, input: { kind: "invitation" | "claim"; token: string }): Promise<{ kind: "found"; preview } | { kind: "missing" } | { kind: "problem"; problem: Problem }>`; `InvitationCard({ kind, token, preview, viewer, formats, zone, api? })` with `viewer: { email: string } | null`; `InvitationContainer({ kind, token })` (server, exported from `spaces/ui/server.ts`); the two pages.

- [ ] **Step 1: Write the failing tests**

`src/shared/ui/time/server-now.test.ts`, inside its `describe` (import `serverZone` beside `serverNow`):

```ts
  it("reads the installation's zone for screens without a person (ruling P182)", () => {
    expect(serverZone({ APP_TIMEZONE: "Europe/Madrid" })).toBe("Europe/Madrid");
    expect(serverZone({})).toBe("America/Bogota");
  });
```

`src/modules/spaces/ui/invitations/invitation-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pageStateOf } from "./invitation-state";

describe("pageStateOf (HU-E9-05, ruling P165)", () => {
  it.each([
    ["PENDING", false, "visitor"],
    ["PENDING", true, "signedIn"],
    ["EXPIRED", true, "expired"],
    ["REVOKED", false, "revoked"],
    ["ACCEPTED", true, "used"],
    [null, true, "missing"],
  ] as const)("%s, signed in %s → %s", (status, signedIn, state) => {
    expect(pageStateOf(status, signedIn)).toBe(state);
  });
});
```

`src/modules/spaces/ui/invitations/invitation-card.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { householdSpace } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { ClaimPreviewDto, InvitationPreviewDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { InvitationCard } from "./invitation-card";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

const LINK: InvitationPreviewDto = {
  kind: "LINK", spaceName: "Household", role: "MEMBER", status: "PENDING",
  expiresAt: "2026-10-19T12:00:00.000Z", invitedBy: "Ana",
};
const CLAIM: ClaimPreviewDto = {
  spaceName: "Household", guestName: "Pedro", status: "PENDING", expiresAt: "2026-10-19T12:00:00.000Z", invitedBy: "Ana",
};
const card = (props: Partial<Parameters<typeof InvitationCard>[0]> & { api?: Api } = {}, locale: "es" | "en" = "es") =>
  renderWithIntl(
    <InvitationCard kind="invitation" token="tok-1" preview={LINK} viewer={null} formats={BUILT_IN_FORMATS}
      zone="America/Bogota" {...(props as object)} />,
    { locale },
  );

describe("invitation page (HU-E9-05, ruling P165)", () => {
  it("shows a visitor the space, the role and the expiry, and the way to sign up and come back", async () => {
    const { container } = card();
    expect(screen.getByText("Ana te invita a")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Household" })).toBeInTheDocument();
    expect(screen.getByText("Entras como").nextSibling).toHaveTextContent("Miembro");
    expect(screen.getByText("Vence").nextSibling).toHaveTextContent("19/10/2026");
    expect(screen.getByRole("link", { name: "Crear cuenta y unirme" })).toHaveAttribute(
      "href",
      "/sign-up?invitation=tok-1&next=%2Finvitations%2Ftok-1",
    );
    expect(screen.getByRole("link", { name: "Ya tengo cuenta: iniciar sesión" })).toHaveAttribute(
      "href",
      "/sign-in?next=%2Finvitations%2Ftok-1&invitation=tok-1",
    );
    expect(screen.getByText("Después de crear la cuenta vuelves aquí para aceptar.")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("lets a signed-in person accept and enter the space", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/invitations/{token}/accept": () => jsonResponse(householdSpace({ role: "MEMBER" })) });
    card({ viewer: { email: "juan@example.com" }, api });
    expect(screen.getByText("Entraste como juan@example.com. Al aceptar, Household aparece en tu selector de espacios.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ahora no" })).toHaveAttribute("href", "/");
    await userEvent.dblClick(screen.getByRole("button", { name: "Aceptar y entrar a Household" }));
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/invitations/tok-1/accept");
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-household");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("explains an invitation for another account and offers to switch", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/invitations/{token}/accept": () => problemResponse(403, "InvitationEmailMismatch"),
      "POST /api/v1/auth/sign-out": () => new Response(null, { status: 204 }),
    });
    card({ viewer: { email: "luis@example.com" }, api });
    await userEvent.click(screen.getByRole("button", { name: "Aceptar y entrar a Household" }));
    expect(await screen.findByText("Esta invitación es para otra cuenta y entraste como luis@example.com.")).toBeInTheDocument();
    expect(screen.getByText("Inicia sesión con la cuenta a la que llegó la invitación.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión y cambiar de cuenta" }));
    expect(new URL(requests[1]!.url).pathname).toBe("/api/v1/auth/sign-out");
    expect(router.replace).toHaveBeenCalledWith("/sign-in?next=%2Finvitations%2Ftok-1&invitation=tok-1");
  });

  it.each([
    ["EXPIRED", "Esta invitación venció. Pídele a Ana un enlace nuevo.", "Las invitaciones duran 7 días."],
    ["REVOKED", "Esta invitación ya no es válida: la revocaron.", "Si todavía quieres unirte, pídele a Ana una invitación nueva."],
    ["ACCEPTED", "Esta invitación ya se usó.", "Si todavía quieres unirte, pídele a Ana una invitación nueva."],
  ] as const)("says why a %s invitation cannot be used", (status, message, body) => {
    card({ preview: { ...LINK, status } });
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a Hearth" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says when there is no such invitation", () => {
    card({ preview: null });
    expect(screen.getByText("No encontramos esta invitación.")).toBeInTheDocument();
  });

  it("offers a visitor to claim Pedro's place, and a signed-in person to take it", async () => {
    const { unmount } = card({ kind: "claim", preview: CLAIM });
    expect(screen.getByText("Ana te envió tu lugar en")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Household, como Pedro" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crear cuenta y reclamar" })).toHaveAttribute(
      "href",
      "/sign-up?invitation=tok-1&next=%2Fclaims%2Ftok-1",
    );
    unmount();
    const { api, requests } = fakeApi({ "POST /api/v1/claims/{token}/accept": () => jsonResponse(householdSpace({ role: "MEMBER" })) });
    card({ kind: "claim", preview: CLAIM, viewer: { email: "pedro@example.com" }, api });
    await userEvent.click(screen.getByRole("button", { name: "Reclamar mi lugar en Household" }));
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/claims/tok-1/accept");
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-household");
  });

  it("speaks English to an English visitor", () => {
    card({}, "en");
    expect(screen.getByText("Ana invites you to")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create an account and join" })).toBeInTheDocument();
  });
});
```

(The claim's sign-in link is `/sign-in?next=%2Fclaims%2Ftok-1&invitation=tok-1`: sign-up is admitted by a claim token too, `InvitationAdmitsSignUp`.)

`src/modules/spaces/ui/invitations/invitation-container.test.tsx` (mocks `next/headers` and `next/navigation` to empty modules at the top, as `src/shared/ui/api/server.test.ts` does, then imports `loadPreview` with `await import("./invitation-container")`; `LINK` and `CLAIM` as in the card test):

```tsx
describe("loadPreview (ruling P156)", () => {
  it("answers the preview, or missing for a 404, through the public endpoints", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/invitations/{token}": (_, { token }) =>
        token === "tok-1" ? jsonResponse(LINK) : problemResponse(404, "InvitationNotFound"),
      "GET /api/v1/claims/{token}": () => jsonResponse(CLAIM),
    });
    expect(await loadPreview(api, { kind: "invitation", token: "tok-1" })).toEqual({ kind: "found", preview: LINK });
    expect(await loadPreview(api, { kind: "invitation", token: "nope" })).toEqual({ kind: "missing" });
    expect(await loadPreview(api, { kind: "claim", token: "c-1" })).toEqual({ kind: "found", preview: CLAIM });
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
      "/api/v1/invitations/tok-1",
      "/api/v1/invitations/nope",
      "/api/v1/claims/c-1",
    ]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/shared/ui/time src/modules/spaces/ui/invitations` and `pnpm exec vitest run --project ui src/modules/spaces/ui/invitations`
Expected: FAIL — `serverZone` is not exported; the new modules do not exist.

- [ ] **Step 3: Implement**

`src/shared/ui/time/server-now.ts`, after `serverNow`:

```ts
/** Ruling P182: the installation's zone (`APP_TIMEZONE`), for dates shown to someone without a profile. */
export const serverZone = (env: Record<string, string | undefined> = process.env): string =>
  env.APP_TIMEZONE ?? "America/Bogota";
```

`invitation-state.ts`:

```ts
import type { InvitationPreviewDto } from "@/shared/ui/api/dto";

export type PageState = "visitor" | "signedIn" | "expired" | "revoked" | "used" | "missing";

/** Ruling P165: what an invitation or claim page shows, from the preview's status and whether someone is signed in. */
export const pageStateOf = (status: InvitationPreviewDto["status"] | null, signedIn: boolean): PageState => {
  if (status === null) return "missing";
  if (status === "EXPIRED") return "expired";
  if (status === "REVOKED") return "revoked";
  if (status === "ACCEPTED") return "used";
  return signedIn ? "signedIn" : "visitor";
};
```

`invitation-container.tsx` (server): `loadPreview(api, { kind, token })` calls `api.GET("/api/v1/invitations/{token}", …)` or `"/api/v1/claims/{token}"` inside `try` (a rejection is `{ kind: "problem", problem: problemFrom(error, undefined) }`) and maps `outcomeOf`: `ok` → `found`, `missing` → `missing`, anything else → `problem`. `InvitationContainer({ kind, token })`: `const [api, me] = await Promise.all([serverApi(), getMe()])`, `loadPreview`; a `problem` renders a `ProblemNotice`; otherwise `<InvitationCard kind={kind} token={token} preview={found ? preview : null} viewer={me ? { email: me.email } : null} formats={me?.preferences.effective ?? BUILT_IN_FORMATS} zone={me?.timezone ?? serverZone()} />`. Export it from `spaces/ui/server.ts`.

`invitation-card.tsx` (`"use client"`): `const state = mismatch ? "otherAccount" : pageStateOf(preview?.status ?? null, viewer !== null)`; `const back = `/${kind === "claim" ? "claims" : "invitations"}/${token}``; a 64 px rounded tile with the space's initial (`Avatar` at 64), then:
- `visitor` and `signedIn`: a kicker `p` (`invitation.kicker` or `invitation.claim.kicker`, with `name` = `invitedBy`; `invitation.kickerAnonymous` / `invitation.claim.kickerAnonymous` when it is null), the `h1` (the space's name, or `invitation.claim.title` with `space` and `guest`), a `dl` of facts — for an invitation `invitation.role` / `shell.role.<role>`, then `invitation.expires` / the expiry date (`formatDate(localDateIn(new Date(expiresAt), zone), formats)`), for a claim only the expiry — and the body (`invitation.body` or `invitation.claim.body` for a visitor, `invitation.signedInBody` with `email` and `space` for a signed-in person, `invitation.claim.signedInBody` for a claim). A visitor gets two `Link`s styled as the primary and secondary buttons: `invitation.signUp` / `invitation.claim.signUp` to `/sign-up?invitation=<token>&next=<encoded back>`, and `invitation.signIn` to `/sign-in?next=<encoded back>&invitation=<token>`, then the note `invitation.note` / `invitation.claim.note`. A signed-in person gets the primary button `invitation.accept` / `invitation.claim.accept` (`space`), disabled while pending, and the secondary link `common.notNow` to `/`. Accept: `api.POST("/api/v1/invitations/{token}/accept" | "/api/v1/claims/{token}/accept", { params: { path: { token } } })` inside `try`; on 200 `router.push(`/spaces/${data.id}`)` and `router.refresh()`; `InvitationEmailMismatch` sets `mismatch`; any other problem shows a `ProblemNotice` (an `AlreadyMember` included) under the buttons.
- `otherAccount`: an alert box with `invitation.otherAccount` (`email` = the viewer's), the body `invitation.otherAccountBody` and the button `invitation.switchAccount`: `document.cookie` is left alone (the person's stored locale already wins), `await api.POST("/api/v1/auth/sign-out")` in `try … finally`, then `router.replace(`/sign-in?next=${encodeURIComponent(back)}&invitation=${encodeURIComponent(token)}`)` and `router.refresh()`.
- `expired`, `revoked`, `used`, `missing`: the `h1` is the space's name (or `invitation.missingTitle` when missing), a danger-bordered `p` with `invitation.expired` (`name`), `invitation.revoked`, `errors.InvitationAlreadyUsed` / `errors.GuestAlreadyClaimed` for a claim, or `errors.InvitationNotFound`; the body `invitation.expiredBody`, `invitation.revokedBody` (`name`; also for `used`) or nothing; and the primary link `common.goHome` to `/`. `name` falls back to `invitation.someone` when `invitedBy` is null.

The pages: `src/app/(web)/(open)/invitations/[token]/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { InvitationContainer } from "@/modules/spaces/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("invitation"))("pageTitle") };
}

/** HU-E9-05, ruling P157: open to anyone holding the token, signed in or not. */
export default async function InvitationPage({ params }: { readonly params: Promise<{ token: string }> }) {
  return <InvitationContainer kind="invitation" token={(await params).token} />;
}
```

and `claims/[token]/page.tsx` the same with `kind="claim"` and the title `invitation.claim.pageTitle`.

Catalog keys (`invitation`), es / en: `pageTitle` Invitación / Invitation; `kicker` {name} te invita a / {name} invites you to; `kickerAnonymous` Te invitan a / You are invited to; `role` Entras como / You join as; `expires` Vence / Expires; `body` {space} es un espacio compartido para registrar gastos, dividirlos y ver quién le debe a quién. / {space} is a shared space to record expenses, split them and see who owes whom.; `signUp` Crear cuenta y unirme / Create an account and join; `signIn` Ya tengo cuenta: iniciar sesión / I have an account: sign in; `note` Después de crear la cuenta vuelves aquí para aceptar. / After creating the account you come back here to accept.; `signedInBody` Entraste como {email}. Al aceptar, {space} aparece en tu selector de espacios. / You are signed in as {email}. Once you accept, {space} shows in your space switcher.; `accept` Aceptar y entrar a {space} / Accept and enter {space}; `otherAccount` Esta invitación es para otra cuenta y entraste como {email}. / This invitation is for another account and you are signed in as {email}.; `otherAccountBody` Inicia sesión con la cuenta a la que llegó la invitación. / Sign in with the account the invitation was sent to.; `switchAccount` Cerrar sesión y cambiar de cuenta / Sign out and switch accounts; `expired` Esta invitación venció. Pídele a {name} un enlace nuevo. / This invitation has expired. Ask {name} for a new link.; `expiredBody` Las invitaciones duran 7 días. / Invitations last 7 days.; `revoked` Esta invitación ya no es válida: la revocaron. / This invitation is no longer valid: it was revoked.; `revokedBody` Si todavía quieres unirte, pídele a {name} una invitación nueva. / If you still want to join, ask {name} for a new invitation.; `someone` quien te invitó / whoever invited you; `missingTitle` Invitación / Invitation; `claim.pageTitle` Reclamar tu lugar / Claim your place; `claim.kicker` {name} te envió tu lugar en / {name} sent you your place in; `claim.kickerAnonymous` Te enviaron tu lugar en / You were sent your place in; `claim.title` {space}, como {guest} / {space}, as {guest}; `claim.body` En {space} ya figuras como {guest} (invitado). Al reclamar el lugar, lo que pagaste, tus partes y los pagos que recibiste pasan a tu cuenta, sin cambiar nada. / In {space} you already appear as {guest} (guest). Claiming the place moves what you paid, your shares and the payments you received to your account, unchanged.; `claim.signedInBody` Al reclamar, tu lugar de invitado en {space} pasa a esta cuenta con todo su historial. / Claiming moves your guest place in {space}, with all its history, to this account.; `claim.signUp` Crear cuenta y reclamar / Create an account and claim; `claim.note` Un solo uso. Después de crear la cuenta vuelves aquí. / Single use. After creating the account you come back here.; `claim.accept` Reclamar mi lugar en {space} / Claim my place in {space}.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, `pnpm build`, `pnpm test:e2e`, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ui/time src/modules/spaces/ui "src/app/(web)/(open)" src/i18n/messages
git commit -m "feat(spaces): add the invitation and claim pages for visitors and signed-in people (Refs #73)"
```

**Split point** (over ~500 lines): first `server-now.ts`, `invitation-state.ts`, `invitation-container.tsx` with their tests and the two pages rendering only the missing and closed states (about 200 lines, `feat(spaces): read invitation and claim previews on their open pages (Refs #73)`); then the card's visitor, signed-in and other-account states and their copy (`feat(spaces): accept an invitation or claim a place from its page (Refs #73)`).

Risk: none (the pages only read their token's preview; the guards are Task 3's).

---

### Task 10: The @e2e scenario of an invitation accepted after signing up

HU-E9-05's `@e2e` scenario, verbatim, against the standalone build: Ana creates a link invitation through the API, a visitor opens its URL in the browser, signs up through the screens, comes back, accepts, and the members screen lists Juan as a Member. Scenarios with more than one person need **other people with their own sessions** (ruling P178): `World.person(name)` signs someone up in a separate Playwright request context with the test's client address, so the page's cookies stay the page user's; every such context is disposed when the test ends.

**Files:**
- Create: `tests/e2e/support/people.ts`, `tests/e2e/features/spaces.feature`, `tests/e2e/steps/spaces.steps.ts`
- Modify: `tests/e2e/support/world.ts`, `tests/e2e/support/fixtures.ts`

**Interfaces:**
- Consumes: Task 3's open pages and `next`, Task 9's card, Task 6's members screen; M6a's `World`, `SeedApi`.
- Produces (used by Tasks 16, 20 and 21): `class Person { name; email; api: SeedApi; personalSpaceId; userId }`; `World.person(name: string): Promise<Person>` (memoized by name); `World.people: Map<string, Person>`; `World.spaces: Map<string, string>` (space name → id); `World.sharedSpace(owner: Person, name: string, currency?: string): Promise<string>`; `World.join(owner: Person, spaceName: string, who: Person | "me", role: "ADMIN" | "MEMBER" | "VIEWER"): Promise<void>` (a link invitation accepted by `who`; `"me"` is the page user, through `world.api`); `World.memberId(spaceName: string, name: string): Promise<string>`; `World.dispose(): Promise<void>`; the fixture creates the World with `playwright.request` and disposes it after the test.

- [ ] **Step 1: Write the feature**

`tests/e2e/features/spaces.feature`:

```gherkin
Feature: Spaces and members screens

  @e2e
  Scenario: A visitor accepts a link invitation after signing up
    Given "Ana" created a link invitation for "Household" with role "MEMBER" and copied its URL
    When a visitor without an account opens the URL
    Then the invitation page shows the space "Household" and the role "MEMBER"
    When the visitor signs up as "juan@example.com"
    Then the visitor is returned to the invitation and accepts it
    And the members screen of "Household" lists "Juan" as "Member"
```

- [ ] **Step 2: Write the people support**

`tests/e2e/support/people.ts`:

```ts
import type { APIRequest, APIRequestContext } from "@playwright/test";
import { SeedApi } from "./api";

const BASE_URL = "http://127.0.0.1:3100";

/** Ruling P178: someone else in a scenario, with their own session in their own request context. */
export class Person {
  constructor(
    readonly name: string,
    readonly email: string,
    readonly userId: string,
    readonly personalSpaceId: string,
    readonly api: SeedApi,
    private readonly context: APIRequestContext,
  ) {}

  static async signUp(requests: APIRequest, name: string, email: string, headers: Record<string, string>): Promise<Person> {
    const context = await requests.newContext({ baseURL: BASE_URL, extraHTTPHeaders: headers });
    const api = new SeedApi(context, () => headers);
    const { user } = (await api.post("/api/v1/auth/sign-up", {
      name,
      email,
      password: "123456789012",
      timezone: "America/Bogota",
    })) as { user: { id: string } };
    const { items } = (await api.get("/api/v1/spaces")) as { items: { id: string; kind: string }[] };
    return new Person(name, email, user.id, items.find((s) => s.kind === "PERSONAL")!.id, api, context);
  }

  dispose(): Promise<void> {
    return this.context.dispose();
  }
}
```

`tests/e2e/support/world.ts`: the constructor gains `private readonly requests: APIRequest` (after `ip`); add the fields `readonly people = new Map<string, Person>();` and `readonly spaces = new Map<string, string>();` and the methods:

```ts
  /** Someone else, signed up once per test with their own session (ruling P178). */
  async person(name: string): Promise<Person> {
    const known = this.people.get(name);
    if (known) return known;
    const person = await Person.signUp(this.requests, name, this.email(`${name.toLowerCase()}@example.com`), this.headers());
    this.people.set(name, person);
    return person;
  }

  /** `owner` creates the shared space `name`; its id is kept under its name. */
  async sharedSpace(owner: Person, name: string, currency = "COP"): Promise<string> {
    const { id } = (await owner.api.post("/api/v1/spaces", { kind: "SHARED", name, currency })) as { id: string };
    this.spaces.set(name, id);
    return id;
  }

  /** `who` joins `spaceName` through a link invitation `owner` creates with `role`; "me" is the page's person. */
  async join(owner: Person, spaceName: string, who: Person | "me", role: "ADMIN" | "MEMBER" | "VIEWER"): Promise<void> {
    const spaceId = this.spaces.get(spaceName)!;
    const { url } = (await owner.api.post(`/api/v1/spaces/${spaceId}/invitations`, { kind: "LINK", role })) as { url: string };
    const token = new URL(url).pathname.split("/").at(-1)!;
    await (who === "me" ? this.api : who.api).post(`/api/v1/invitations/${token}/accept`, {});
  }

  /** The member id of `name` in `spaceName`, as the space lists its current members. */
  async memberId(spaceName: string, name: string): Promise<string> {
    const { items } = (await this.api.get(`/api/v1/spaces/${this.spaces.get(spaceName)!}/members`)) as {
      items: { id: string; displayName: string }[];
    };
    return items.find((m) => m.displayName === name)!.id;
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.people.values()].map((p) => p.dispose()));
  }
```

(`memberId` reads through the page user's session, so the page user must be a member of the space by then.)

`tests/e2e/support/fixtures.ts`: the fixture becomes `world: async ({ page, playwright }, use, testInfo) => { … const world = new World(page, testInfo.testId, ip, playwright.request); … await use(world); await world.dispose(); }`.

- [ ] **Step 3: Write the steps**

`tests/e2e/steps/spaces.steps.ts`:

```ts
import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures";

const ROLE_KEYS: Record<string, string> = {
  OWNER: "shell.role.OWNER",
  ADMIN: "shell.role.ADMIN",
  MEMBER: "shell.role.MEMBER",
  VIEWER: "shell.role.VIEWER",
  Owner: "shell.role.OWNER",
  Member: "shell.role.MEMBER",
};
let invitation = "";

Given(
  "{string} created a link invitation for {string} with role {string} and copied its URL",
  async ({ world }, name: string, space: string, role: string) => {
    const owner = await world.person(name);
    const spaceId = await world.sharedSpace(owner, space);
    const { url } = (await owner.api.post(`/api/v1/spaces/${spaceId}/invitations`, { kind: "LINK", role })) as { url: string };
    invitation = new URL(url).pathname;
  },
);

When("a visitor without an account opens the URL", async ({ page }) => {
  await page.goto(invitation);
});

Then(
  "the invitation page shows the space {string} and the role {string}",
  async ({ page, world }, space: string, role: string) => {
    await expect(page.getByRole("heading", { level: 1, name: space })).toBeVisible();
    await expect(page.getByText(world.t("invitation.role"))).toBeVisible();
    await expect(page.getByText(world.t(ROLE_KEYS[role]!), { exact: true })).toBeVisible();
  },
);

When("the visitor signs up as {string}", async ({ page, world }, email: string) => {
  await page.getByRole("link", { name: world.t("invitation.signUp") }).click();
  const name = email.split("@")[0]!.replace(/^./, (c) => c.toUpperCase());
  await page.getByLabel(world.t("auth.signUp.name")).fill(name);
  await page.getByLabel(world.t("auth.email")).fill(world.email(email));
  await page.getByLabel(world.t("auth.password"), { exact: true }).fill("123456789012");
  await page.getByLabel(world.t("auth.signUp.confirmPassword")).fill("123456789012");
  await page.getByRole("button", { name: world.t("auth.signUp.submit") }).click();
});

Then("the visitor is returned to the invitation and accepts it", async ({ page, world }) => {
  await expect(page).toHaveURL(invitation);
  const space = [...world.spaces.keys()][0]!;
  await page.getByRole("button", { name: world.t("invitation.accept", { space }) }).click();
  await expect(page).toHaveURL(`/spaces/${world.spaces.get(space)}`);
});

Then(
  "the members screen of {string} lists {string} as {string}",
  async ({ page, world }, space: string, name: string, role: string) => {
    await page.goto(`/spaces/${world.spaces.get(space)}/members`);
    const row = page.getByRole("listitem", { name: new RegExp(`^${name}`) });
    await expect(row).toContainText(world.t(ROLE_KEYS[role]!));
  },
);
```

(`world.t` fills `{space}`; the password label is matched exactly because "Confirmar contraseña" contains it.)

- [ ] **Step 4: Run it and see it bite**

Run: `pnpm build && pnpm test:e2e`.
Expected: PASS, and `docker ps -a --filter label=hearth.test=e2e` lists nothing afterwards. To see it bite, replace `router.replace(next)` with `router.replace("/")` in `sign-up-form-container.tsx` locally, rebuild and run: the step "the visitor is returned to the invitation" fails on the URL; revert and rebuild.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e
git commit -m "test(web): accept a link invitation after signing up, end to end (Refs #73)"
```

Risk: none.

---
### Task 11: The split preview and the request parts

The pure core of HU-E9-06's split editor (rulings P166, P168 and P169). `previewSplit` computes each participant's share of an amount for EQUAL, PERCENT, EXACT and SHARES with **the server's own rounding** (`splitShares` over `Money.allocate`: participants in join order, whole rounding units — whole pesos for COP — handed out by largest remainder with ties to the earlier participant, the units below the rounding unit to the first participant), and says what is wrong with an invalid split ("10 % unassigned", an EXACT split short or over, an unreadable value, no participant, a share that would be zero). A parity test runs a table through both this function and the domain's `splitShares` and requires the same shares. `sharedPartsOf` turns the editor's draft into the request's `payments` and `split`: one payer (the recorder from an account they own, a guest without account, or a shared fund with no payer member, D9), and no `split` at all for BY_ALLOCATION, which the server applies when `split` is absent (HU-E6-08). The body carries the person's percents, amounts or units, never the previewed shares.

**Files:**
- Create: `src/modules/ledger/ui/split/{split-math.ts, split-math.test.ts, split-request.ts, split-request.test.ts}`

**Interfaces:**
- Consumes: `currencyOf` (with Task 4's `roundingUnit`), `parseDecimal`, `minorOf`, `decimalOf`, `NumberFormat`.
- Produces:
  - `split-math.ts`: `type ShareMethod = "EQUAL" | "PERCENT" | "EXACT" | "SHARES"`; `type SplitMethod = "BY_ALLOCATION" | ShareMethod`; `SPLIT_METHODS: readonly SplitMethod[]` (`BY_ALLOCATION`, `EQUAL`, `PERCENT`, `EXACT`, `SHARES`, the artboard's order); `interface ParticipantValue { memberId: string; value: string }`; `type SplitCheck = { ok: true; shares: readonly { memberId: string; amount: string }[] } | { ok: false; reason: "noParticipants" | "tooSmall" } | { ok: false; reason: "unreadable"; memberId: string } | { ok: false; reason: "percentShort" | "percentOver"; percent: string } | { ok: false; reason: "exactShort" | "exactOver"; amount: string }` (`percent` a decimal string such as `"10.00"`, `amount` minor units); `allocateMinor(minor: bigint, weights: readonly bigint[], roundingUnit: bigint): bigint[]`; `previewSplit(input: { method: ShareMethod; amount: string; currency: string; numberFormat: NumberFormat; participants: readonly ParticipantValue[] }): SplitCheck` (participants in join order).
  - `split-request.ts`: `type Payer = { kind: "ME"; memberId: string; accountId: string | null } | { kind: "GUEST"; memberId: string } | { kind: "FUND"; accountId: string }`; `interface SplitDraft { payer: Payer; method: SplitMethod; selected: readonly string[]; values: Readonly<Record<string, string>>; chosen: boolean }` (`chosen`: the person picked the method, so the default split no longer replaces it); `participantsOf(draft, memberIds: readonly string[]): ParticipantValue[]` (the selected members in join order with their typed values); `splitCheckOf(draft, input: { amount: string | null; currency; numberFormat; memberIds; allocation: readonly { memberId: string; amount: string }[] | null }): SplitCheck | null` (null while there is no amount, or while BY_ALLOCATION waits for the API's shares); `sharedPartsOf(draft, input: { amount: string; currency; numberFormat; memberIds }): { ok: true; payments: readonly Record<string, unknown>[]; split: Record<string, unknown> | null } | { ok: false; field: "payer" | "split" }`.

- [ ] **Step 1: Write the failing tests**

`src/modules/ledger/ui/split/split-math.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { splitShares, type SplitInput } from "@/modules/ledger/domain/split";
import { Money } from "@/shared/kernel";
import { allocateMinor, previewSplit, type ParticipantValue, type ShareMethod } from "./split-math";

const JOIN_ORDER = ["m-ana", "m-juan", "m-luis"];
const preview = (method: ShareMethod, amount: string, participants: ParticipantValue[]) =>
  previewSplit({ method, amount, currency: "COP", numberFormat: "DOT_COMMA", participants });

/** The domain's split of the same request, as { memberId: minor units }. */
const server = (amount: string, split: SplitInput) => {
  const money = Money.ofMinor(BigInt(amount), "COP");
  if (!money.ok) throw new Error("bad amount");
  const shares = splitShares(money.value, split, JOIN_ORDER);
  return shares.ok ? Object.fromEntries(shares.value.map((s) => [s.memberId, String(s.amount)])) : shares.error.code;
};
const ours = (check: ReturnType<typeof preview>) =>
  check.ok ? Object.fromEntries(check.shares.map((s) => [s.memberId, s.amount])) : check.reason;
const inJoinOrder = (ids: string[]) => JOIN_ORDER.filter((id) => ids.includes(id));

describe("previewSplit equals the server's splitShares (HU-E9-06, ruling P166)", () => {
  it.each([
    ["EQUAL 300,000 among three", "30000000", "EQUAL", [["m-ana", ""], ["m-juan", ""], ["m-luis", ""]]],
    ["EQUAL 100,000.01 between two: the cent stays with the first", "10000001", "EQUAL", [["m-ana", ""], ["m-juan", ""]]],
    ["EQUAL 100,000 among three: the leftover peso to the first", "10000000", "EQUAL", [["m-ana", ""], ["m-juan", ""], ["m-luis", ""]]],
    ["PERCENT 33.33 / 33.33 / 33.34", "10000000", "PERCENT", [["m-ana", "33,33"], ["m-juan", "33,33"], ["m-luis", "33,34"]]],
    ["PERCENT 40 / 60 chosen in reverse order", "30000000", "PERCENT", [["m-juan", "60"], ["m-ana", "40"]]],
    ["SHARES 2 / 1 / 1 of 90,000", "9000000", "SHARES", [["m-ana", "2"], ["m-juan", "1"], ["m-luis", "1"]]],
    ["EXACT 100,000 / 150,000 of 250,000", "25000000", "EXACT", [["m-ana", "100.000"], ["m-juan", "150.000"]]],
  ] as const)("%s", (_, amount, method, rows) => {
    const participants = rows.map(([memberId, value]) => ({ memberId, value }));
    const ordered = inJoinOrder(participants.map((p) => p.memberId)).map((id) => participants.find((p) => p.memberId === id)!);
    const split: SplitInput =
      method === "EQUAL"
        ? { method, participants: ordered.map(({ memberId }) => ({ memberId })) }
        : method === "PERCENT"
          ? { method, participants: ordered.map(({ memberId, value }) => ({ memberId, basisPoints: Math.round(Number(value.replace(",", ".")) * 100) })) }
          : method === "SHARES"
            ? { method, participants: ordered.map(({ memberId, value }) => ({ memberId, units: Number(value) })) }
            : {
                method,
                participants: ordered.map(({ memberId, value }) => {
                  const money = Money.ofMinor(BigInt(value.replaceAll(".", "")) * 100n, "COP");
                  if (!money.ok) throw new Error("bad");
                  return { memberId, amount: money.value };
                }),
              };
    expect(ours(preview(method, amount, ordered))).toEqual(server(amount, split));
  });

  it("refuses, like the server, an amount too small to give everyone a whole peso", () => {
    expect(ours(preview("EQUAL", "100", [{ memberId: "m-ana", value: "" }, { memberId: "m-juan", value: "" }]))).toBe("tooSmall");
    expect(server("100", { method: "EQUAL", participants: [{ memberId: "m-ana" }, { memberId: "m-juan" }] })).toBe("InvalidSplit");
  });
});

describe("previewSplit says what an invalid split is missing (ruling P169)", () => {
  it("counts the percent left or over", () => {
    expect(preview("PERCENT", "30000000", [{ memberId: "m-ana", value: "40" }, { memberId: "m-juan", value: "50" }])).toEqual({
      ok: false,
      reason: "percentShort",
      percent: "10.00",
    });
    expect(preview("PERCENT", "30000000", [{ memberId: "m-ana", value: "40" }, { memberId: "m-juan", value: "62,5" }])).toEqual({
      ok: false,
      reason: "percentOver",
      percent: "2.50",
    });
  });

  it("counts the amount left or over of an EXACT split", () => {
    expect(preview("EXACT", "25000000", [{ memberId: "m-ana", value: "100.000" }, { memberId: "m-juan", value: "149.999" }])).toEqual({
      ok: false,
      reason: "exactShort",
      amount: "100",
    });
    expect(preview("EXACT", "25000000", [{ memberId: "m-ana", value: "100.000" }, { memberId: "m-juan", value: "160.000" }])).toEqual({
      ok: false,
      reason: "exactOver",
      amount: "1000000",
    });
  });

  it("names the participant whose value cannot be read, and asks for someone", () => {
    expect(preview("SHARES", "9000000", [{ memberId: "m-ana", value: "2" }, { memberId: "m-juan", value: "0" }])).toEqual({
      ok: false,
      reason: "unreadable",
      memberId: "m-juan",
    });
    expect(preview("PERCENT", "9000000", [{ memberId: "m-ana", value: "33,333" }])).toMatchObject({ reason: "unreadable" });
    expect(preview("EQUAL", "9000000", [])).toEqual({ ok: false, reason: "noParticipants" });
  });

  it("allocates like Money.allocate for a negative amount too", () => {
    expect(allocateMinor(-10000001n, [1n, 1n], 100n)).toEqual([-5000001n, -5000000n]);
  });
});
```

(A `.test.ts` file: it reads the ledger's domain and the kernel's `Money`, which dependency-cruiser excludes for tests.)

`src/modules/ledger/ui/split/split-request.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sharedPartsOf, splitCheckOf, type SplitDraft } from "./split-request";

const MEMBERS = ["m-ana", "m-juan", "m-pedro"];
const draft = (overrides: Partial<SplitDraft> = {}): SplitDraft => ({
  payer: { kind: "ME", memberId: "m-ana", accountId: "a-bank" },
  method: "EQUAL",
  selected: ["m-juan", "m-ana"],
  values: {},
  chosen: false,
  ...overrides,
});
const input = { amount: "30000000", currency: "COP", numberFormat: "DOT_COMMA" as const, memberIds: MEMBERS };
const cop = (amount: string) => ({ amount, currency: "COP" });

describe("sharedPartsOf (HU-E9-06, rulings P168 and P169)", () => {
  it("pays from the recorder's account and splits equally among the chosen members, in join order", () => {
    expect(sharedPartsOf(draft(), input)).toEqual({
      ok: true,
      payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop("30000000") }],
      split: { method: "EQUAL", participants: [{ memberId: "m-ana" }, { memberId: "m-juan" }] },
    });
  });

  it("sends percents, amounts and units as typed, never the previewed shares", () => {
    const values = { "m-ana": "40", "m-juan": "60" };
    expect(sharedPartsOf(draft({ method: "PERCENT", values }), input).ok && sharedPartsOf(draft({ method: "PERCENT", values }), input)).toMatchObject({
      split: { method: "PERCENT", participants: [{ memberId: "m-ana", percent: "40" }, { memberId: "m-juan", percent: "60" }] },
    });
    const exact = sharedPartsOf(draft({ method: "EXACT", values: { "m-ana": "100.000", "m-juan": "200.000" } }), input);
    expect(exact).toMatchObject({
      split: { method: "EXACT", participants: [{ memberId: "m-ana", amount: cop("10000000") }, { memberId: "m-juan", amount: cop("20000000") }] },
    });
    const shares = sharedPartsOf(draft({ method: "SHARES", values: { "m-ana": "2", "m-juan": "1" } }), input);
    expect(shares).toMatchObject({ split: { method: "SHARES", participants: [{ memberId: "m-ana", units: 2 }, { memberId: "m-juan", units: 1 }] } });
  });

  it("leaves the split to the server for BY_ALLOCATION, and pays for a guest or from the fund", () => {
    expect(sharedPartsOf(draft({ method: "BY_ALLOCATION" }), input)).toMatchObject({ ok: true, split: null });
    expect(sharedPartsOf(draft({ payer: { kind: "GUEST", memberId: "m-pedro" } }), input)).toMatchObject({
      payments: [{ memberId: "m-pedro", accountId: null, amount: cop("30000000") }],
    });
    expect(sharedPartsOf(draft({ payer: { kind: "FUND", accountId: "a-fund" } }), input)).toMatchObject({
      payments: [{ memberId: null, accountId: "a-fund", amount: cop("30000000") }],
    });
  });

  it("refuses a recorder without an account and an invalid split", () => {
    expect(sharedPartsOf(draft({ payer: { kind: "ME", memberId: "m-ana", accountId: null } }), input)).toEqual({ ok: false, field: "payer" });
    expect(sharedPartsOf(draft({ method: "PERCENT", values: { "m-ana": "40", "m-juan": "50" } }), input)).toEqual({ ok: false, field: "split" });
    expect(sharedPartsOf(draft({ selected: [] }), input)).toEqual({ ok: false, field: "split" });
  });
});

describe("splitCheckOf", () => {
  it("waits for an amount, and for the API's shares when the split follows the plan", () => {
    expect(splitCheckOf(draft(), { ...input, amount: null, allocation: null })).toBeNull();
    expect(splitCheckOf(draft({ method: "BY_ALLOCATION" }), { ...input, allocation: null })).toBeNull();
    expect(
      splitCheckOf(draft({ method: "BY_ALLOCATION" }), {
        ...input,
        allocation: [{ memberId: "m-ana", amount: "12000000" }, { memberId: "m-juan", amount: "18000000" }],
      }),
    ).toEqual({ ok: true, shares: [{ memberId: "m-ana", amount: "12000000" }, { memberId: "m-juan", amount: "18000000" }] });
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/ui/split`
Expected: FAIL — `Cannot find module './split-math'`.

- [ ] **Step 3: Implement**

`src/modules/ledger/ui/split/split-math.ts`:

```ts
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import { decimalOf, type NumberFormat } from "@/shared/ui/format/formatters";

export type ShareMethod = "EQUAL" | "PERCENT" | "EXACT" | "SHARES";
export type SplitMethod = "BY_ALLOCATION" | ShareMethod;
/** The Split artboard's order: the plan's split first, the others as a member picks them (spec 5.2). */
export const SPLIT_METHODS: readonly SplitMethod[] = ["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"];

export interface ParticipantValue {
  readonly memberId: string;
  /** What the person typed for this member: a percent, an amount or units; unused for EQUAL. */
  readonly value: string;
}

export type SplitCheck =
  | { readonly ok: true; readonly shares: readonly { readonly memberId: string; readonly amount: string }[] }
  | { readonly ok: false; readonly reason: "noParticipants" | "tooSmall" }
  | { readonly ok: false; readonly reason: "unreadable"; readonly memberId: string }
  | { readonly ok: false; readonly reason: "percentShort" | "percentOver"; readonly percent: string }
  | { readonly ok: false; readonly reason: "exactShort" | "exactOver"; readonly amount: string };

/** 100 % in basis points, as the server counts percents (two decimals). */
const WHOLE = 10_000n;

/**
 * Ruling P166: `Money.allocate` for the browser. Whole rounding units by largest remainder, ties to the earlier
 * participant; the units below the rounding unit stay with the first participant; a negative amount mirrors.
 */
export const allocateMinor = (minor: bigint, weights: readonly bigint[], roundingUnit: bigint): bigint[] => {
  if (minor < 0n) return allocateMinor(-minor, weights, roundingUnit).map((part) => -part);
  const total = weights.reduce((a, b) => a + b, 0n);
  const units = minor / roundingUnit;
  const subUnit = minor % roundingUnit;
  const shares = weights.map((w, index) => ({ index, base: (units * w) / total, rem: (units * w) % total }));
  let leftover = units - shares.reduce((sum, s) => sum + s.base, 0n);
  const order = [...shares].sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
  for (const share of order) {
    if (leftover <= 0n) break;
    share.base += 1n;
    leftover -= 1n;
  }
  return shares.map((s) => s.base * roundingUnit + (s.index === 0 ? subUnit : 0n));
};

const positive = (value: bigint | null): value is bigint => value !== null && value > 0n;

/** A typed decimal in minor units of `exponent` decimals, or null (unreadable or too many decimals). */
const minorFrom = (text: string, numberFormat: NumberFormat, exponent: number): bigint | null => {
  const decimal = parseDecimal(text, numberFormat);
  const minor = decimal === null ? null : minorOf(decimal, exponent);
  return minor === null ? null : BigInt(minor);
};

/**
 * HU-E9-06, ruling P166: each participant's share of `amount` (minor units), exactly as `splitShares` computes it, or
 * why the split cannot be saved. `participants` come in the space's join order (the server sorts them so too).
 */
export const previewSplit = (input: {
  readonly method: ShareMethod;
  readonly amount: string;
  readonly currency: string;
  readonly numberFormat: NumberFormat;
  readonly participants: readonly ParticipantValue[];
}): SplitCheck => {
  const { participants, numberFormat } = input;
  if (participants.length === 0) return { ok: false, reason: "noParticipants" };
  const total = BigInt(input.amount);
  const { exponent, roundingUnit } = currencyOf(input.currency);
  const unreadable = (index: number): SplitCheck => ({
    ok: false,
    reason: "unreadable",
    memberId: participants[index]!.memberId,
  });
  let parts: bigint[];
  switch (input.method) {
    case "EQUAL":
      parts = allocateMinor(total, participants.map(() => 1n), roundingUnit);
      break;
    case "SHARES": {
      const units = participants.map((p) => (/^\d+$/.test(p.value.trim()) ? BigInt(p.value.trim()) : null));
      const bad = units.findIndex((u) => !positive(u));
      if (bad >= 0) return unreadable(bad);
      parts = allocateMinor(total, units as bigint[], roundingUnit);
      break;
    }
    case "PERCENT": {
      const points = participants.map((p) => minorFrom(p.value, numberFormat, 2));
      const bad = points.findIndex((p) => !positive(p));
      if (bad >= 0) return unreadable(bad);
      const sum = (points as bigint[]).reduce((a, b) => a + b, 0n);
      if (sum !== WHOLE) {
        const gap = sum < WHOLE ? WHOLE - sum : sum - WHOLE;
        return { ok: false, reason: sum < WHOLE ? "percentShort" : "percentOver", percent: decimalOf(String(gap), 2) };
      }
      parts = allocateMinor(total, points as bigint[], roundingUnit);
      break;
    }
    case "EXACT": {
      const amounts = participants.map((p) => minorFrom(p.value, numberFormat, exponent));
      const bad = amounts.findIndex((a) => !positive(a));
      if (bad >= 0) return unreadable(bad);
      const sum = (amounts as bigint[]).reduce((a, b) => a + b, 0n);
      if (sum !== total)
        return { ok: false, reason: sum < total ? "exactShort" : "exactOver", amount: String(sum < total ? total - sum : sum - total) };
      parts = amounts as bigint[];
      break;
    }
  }
  if (parts.some((part) => part <= 0n)) return { ok: false, reason: "tooSmall" };
  return { ok: true, shares: participants.map((p, i) => ({ memberId: p.memberId, amount: String(parts[i]) })) };
};
```

`src/modules/ledger/ui/split/split-request.ts`:

```ts
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import type { NumberFormat } from "@/shared/ui/format/formatters";
import { previewSplit, type ParticipantValue, type SplitCheck, type SplitMethod } from "./split-math";

/**
 * Ruling P168 (D9): who paid. The recorder pays from an account they own; a guest pays outside the app (no account);
 * a shared fund pays with no payer member (HU-E4-10). Another registered member cannot be the payer: only an
 * account's owner may record its debit.
 */
export type Payer =
  | { readonly kind: "ME"; readonly memberId: string; readonly accountId: string | null }
  | { readonly kind: "GUEST"; readonly memberId: string }
  | { readonly kind: "FUND"; readonly accountId: string };

export interface SplitDraft {
  readonly payer: Payer;
  readonly method: SplitMethod;
  readonly selected: readonly string[];
  readonly values: Readonly<Record<string, string>>;
  /** The person picked the method; until then the default split (HU-E6-08) may set it (ruling P167). */
  readonly chosen: boolean;
}

/** The selected members in the space's join order, with what was typed for each. */
export const participantsOf = (draft: SplitDraft, memberIds: readonly string[]): ParticipantValue[] =>
  memberIds
    .filter((id) => draft.selected.includes(id))
    .map((memberId) => ({ memberId, value: draft.values[memberId] ?? "" }));

/** The preview to show: null while there is no amount, or while the plan's split waits for the API's shares. */
export const splitCheckOf = (
  draft: SplitDraft,
  input: {
    readonly amount: string | null;
    readonly currency: string;
    readonly numberFormat: NumberFormat;
    readonly memberIds: readonly string[];
    readonly allocation: readonly { readonly memberId: string; readonly amount: string }[] | null;
  },
): SplitCheck | null => {
  if (input.amount === null) return null;
  if (draft.method === "BY_ALLOCATION") return input.allocation === null ? null : { ok: true, shares: input.allocation };
  return previewSplit({ ...input, amount: input.amount, method: draft.method, participants: participantsOf(draft, input.memberIds) });
};

/** HU-E9-06: the `payments` and `split` of a shared expense; no `split` for BY_ALLOCATION (the server applies it). */
export const sharedPartsOf = (
  draft: SplitDraft,
  input: { readonly amount: string; readonly currency: string; readonly numberFormat: NumberFormat; readonly memberIds: readonly string[] },
):
  | { ok: true; payments: readonly Record<string, unknown>[]; split: Record<string, unknown> | null }
  | { ok: false; field: "payer" | "split" } => {
  const amount = { amount: input.amount, currency: input.currency };
  const { payer } = draft;
  if (payer.kind === "ME" && !payer.accountId) return { ok: false, field: "payer" };
  const payments = [
    payer.kind === "FUND"
      ? { memberId: null, accountId: payer.accountId, amount }
      : payer.kind === "GUEST"
        ? { memberId: payer.memberId, accountId: null, amount }
        : { memberId: payer.memberId, accountId: payer.accountId, amount },
  ];
  if (draft.method === "BY_ALLOCATION") return { ok: true, payments, split: null };
  const participants = participantsOf(draft, input.memberIds);
  const check = previewSplit({ ...input, method: draft.method, participants });
  if (!check.ok) return { ok: false, field: "split" };
  const { exponent } = currencyOf(input.currency);
  const typed = (value: string) => parseDecimal(value, input.numberFormat)!;
  const method = draft.method;
  return {
    ok: true,
    payments,
    split: {
      method,
      participants: participants.map(({ memberId, value }) =>
        method === "EQUAL"
          ? { memberId }
          : method === "PERCENT"
            ? { memberId, percent: typed(value) }
            : method === "EXACT"
              ? { memberId, amount: { amount: minorOf(typed(value), exponent)!, currency: input.currency } }
              : { memberId, units: Number(value.trim()) },
      ),
    },
  };
};
```

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's command, then every gate.
Expected: PASS. To see the parity bite, change `ties to the earlier participant` (`a.index - b.index`) to `b.index - a.index` locally: the "100,000 among three" row fails against the domain; revert.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ledger/ui/split
git commit -m "feat(ledger): preview a split with the server's rounding and build its payments and shares (Refs #74)"
```

Risk: none (pure functions; the server stays the validator).

---

### Task 12: The default split and the split sheet

The Split artboard as a sheet (`ledger.split.title` "Quién pagó y para quién"; ruling P167): who paid (the recorder and the account it came from, a guest, or a fund, with the artboard's notes), how it is split (the methods the default split allows), for whom (one checkbox per current member in join order, a value field for PERCENT, EXACT and SHARES, each member's share), a status line that says the sum matches or what is missing, and **Listo**, disabled while the split is invalid. `useDefaultSplit` reads `GET …/default-split` for the category, date and amount, 250 ms after they stop changing; a response for an older request never replaces a newer one. Task 13 places the sheet in the record form and applies the default.

**Files:**
- Create: `src/modules/ledger/ui/split/{use-default-split.ts, use-default-split.test.tsx, split-sheet.tsx, split-sheet.test.tsx}`
- Modify: `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: Task 11's `SplitDraft`, `Payer`, `splitCheckOf`, `SPLIT_METHODS`; `memberLabel` (Task 6); `MemberDto`, `AccountDto`, `DefaultSplitDto`; `Sheet`, `ChoiceGroup`, `Button`, `formatMoney`, `formatNumber`.
- Produces:
  - `type DefaultSplitState = { status: "none" } | { status: "ready"; key: string; method: "BY_ALLOCATION" | "EQUAL"; availableMethods: readonly SplitMethod[]; shares: readonly { memberId: string; amount: string }[] | null }`; `useDefaultSplit(input: { api: Api; spaceId: string; categoryId: string | null; date: string; amount: string | null; enabled: boolean }): DefaultSplitState`; `DEFAULT_SPLIT_DELAY_MS = 250`.
  - `SplitSheet({ open, onOpenChange, title, members, meUserId, myAccounts, funds, draft, onChange, amount, currency, formats, defaultSplit })` (client; `amount` in minor units or null).
  - `payerLabel(payer, ctx): string` is internal; the record form's summary row (Task 13) uses `ledger.split.summary`.

- [ ] **Step 1: Write the failing tests**

`src/modules/ledger/ui/split/use-default-split.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { cop } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { useDefaultSplit } from "./use-default-split";

const answer = (amount: string) =>
  jsonResponse({
    method: "BY_ALLOCATION",
    availableMethods: ["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"],
    lineId: "l-home",
    shares: [{ memberId: "m-ana", amount: { amount: String(BigInt(amount) * 2n / 5n), currency: "COP" } }, { memberId: "m-juan", amount: { amount: String(BigInt(amount) * 3n / 5n), currency: "COP" } }],
  });

describe("useDefaultSplit (HU-E6-08, ruling P167)", () => {
  it("asks once the inputs settle, with the category, the date and the amount", async () => {
    const { api, requests } = fakeApi({ "GET /api/v1/spaces/{spaceId}/default-split": (r) => answer(new URL(r.url).searchParams.get("amount")!) });
    const { result, rerender } = renderHook((props: { amount: string }) =>
      useDefaultSplit({ api, spaceId: "sp-household", categoryId: "c-groceries", date: "2026-11-08", amount: props.amount, enabled: true }),
      { initialProps: { amount: "100000000" } },
    );
    rerender({ amount: "200000000" });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(requests).toHaveLength(1);
    expect(Object.fromEntries(new URL(requests[0]!.url).searchParams)).toEqual({ categoryId: "c-groceries", date: "2026-11-08", amount: "200000000" });
    expect(result.current).toMatchObject({ method: "BY_ALLOCATION", shares: [{ memberId: "m-ana", amount: cop(800_000).amount }, { memberId: "m-juan", amount: cop(1_200_000).amount }] });
  });

  it("never lets an older answer replace a newer one", async () => {
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => (release = resolve));
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": async (r) => {
        const amount = new URL(r.url).searchParams.get("amount")!;
        if (amount === "100000000") await slow;
        return answer(amount);
      },
    });
    const { result, rerender } = renderHook((props: { amount: string }) =>
      useDefaultSplit({ api, spaceId: "sp-household", categoryId: "c-groceries", date: "2026-11-08", amount: props.amount, enabled: true }),
      { initialProps: { amount: "100000000" } },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    rerender({ amount: "200000000" });
    await waitFor(() => expect(result.current).toMatchObject({ key: "c-groceries|2026-11-08|200000000" }));
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current).toMatchObject({ key: "c-groceries|2026-11-08|200000000" });
  });

  it("asks nothing without a category or when disabled, and answers none", async () => {
    const { api, requests } = fakeApi({});
    const { result } = renderHook(() =>
      useDefaultSplit({ api, spaceId: "sp-household", categoryId: null, date: "2026-11-08", amount: "100", enabled: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect([result.current.status, requests.length]).toEqual(["none", 0]);
  });
});
```

`src/modules/ledger/ui/split/split-sheet.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { accountDto, guestDto, memberDto, normalized } from "../../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { SplitSheet } from "./split-sheet";
import type { SplitDraft } from "./split-request";
import type { DefaultSplitState } from "./use-default-split";

const MEMBERS = [memberDto(), memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" }), guestDto()];
const BANK = accountDto({ id: "a-bank", name: "Bancolombia" });
const FUND = accountDto({ id: "a-fund", name: "Fondo Hogar", type: "SHARED_FUND", ownerUserId: null, icon: "users" });
const EQUAL_DEFAULT: DefaultSplitState = { status: "ready", key: "k", method: "EQUAL", availableMethods: ["EQUAL", "PERCENT", "EXACT", "SHARES"], shares: null };
const start: SplitDraft = { payer: { kind: "ME", memberId: "m-ana", accountId: "a-bank" }, method: "EQUAL", selected: ["m-ana", "m-juan"], values: {}, chosen: false };

function Harness({ amount, defaultSplit = EQUAL_DEFAULT, initial = start }: { amount: string; defaultSplit?: DefaultSplitState; initial?: SplitDraft }) {
  const [draft, setDraft] = useState(initial);
  return (
    <SplitSheet open onOpenChange={() => undefined} title="Mercado · $ 300.000 · Household" members={MEMBERS} meUserId="u-ana"
      myAccounts={[BANK]} funds={[FUND]} draft={draft} onChange={setDraft} amount={amount} currency="COP"
      formats={BUILT_IN_FORMATS} defaultSplit={defaultSplit} />
  );
}
const sheet = () => screen.getByRole("dialog", { name: "Quién pagó y para quién" });
const shareOf = (name: string) => normalized(within(sheet()).getByRole("listitem", { name }).textContent);
const valueOf = (name: string) => within(sheet()).getByLabelText(`Valor de ${name}`);

describe("split sheet (HU-E9-06)", () => {
  it("splits 300,000 COP equally between Ana and Juan and says the sum matches", async () => {
    renderWithIntl(<Harness amount="30000000" />);
    expect(shareOf("Ana (tú)")).toContain("$ 150.000");
    expect(shareOf("Juan")).toContain("$ 150.000");
    expect(shareOf("Pedro (invitado)")).toContain("—");
    expect(within(sheet()).getByRole("status")).toHaveTextContent("Suma $ 300.000: cuadra con el gasto");
    expect(within(sheet()).getByRole("button", { name: "Listo" })).toBeEnabled();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it.each([
    ["30000000", "Porcentaje", ["40", "60"], ["$ 120.000", "$ 180.000"]],
    ["25000000", "Montos", ["100.000", "150.000"], ["$ 100.000", "$ 150.000"]],
    ["9000000", "Partes", ["2", "1"], ["$ 60.000", "$ 30.000"]],
  ] as const)("previews %s split by %s", async (amount, method, [ana, juan], [anaShare, juanShare]) => {
    renderWithIntl(<Harness amount={amount} />);
    await userEvent.click(within(sheet()).getByRole("radio", { name: method }));
    await userEvent.type(valueOf("Ana (tú)"), ana);
    await userEvent.type(valueOf("Juan"), juan);
    expect(shareOf("Ana (tú)")).toContain(anaShare);
    expect(shareOf("Juan")).toContain(juanShare);
  });

  it("says that 10 % remains unassigned and keeps Listo disabled", async () => {
    renderWithIntl(<Harness amount="30000000" />);
    await userEvent.click(within(sheet()).getByRole("radio", { name: "Porcentaje" }));
    await userEvent.type(valueOf("Ana (tú)"), "40");
    await userEvent.type(valueOf("Juan"), "50");
    expect(within(sheet()).getByRole("status")).toHaveTextContent("Falta asignar 10 %");
    expect(within(sheet()).getByRole("button", { name: "Listo" })).toBeDisabled();
  });

  it("follows the plan with its shares and locked participants, and switches to equal parts", async () => {
    const planned: DefaultSplitState = {
      status: "ready", key: "k", method: "BY_ALLOCATION", availableMethods: ["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"],
      shares: [{ memberId: "m-ana", amount: "80000000" }, { memberId: "m-juan", amount: "120000000" }],
    };
    renderWithIntl(<Harness amount="200000000" defaultSplit={planned} initial={{ ...start, method: "BY_ALLOCATION" }} />);
    expect(within(sheet()).getByRole("radio", { name: "Según el plan" })).toBeChecked();
    expect(within(sheet()).getByRole("checkbox", { name: "Juan" })).toBeDisabled();
    expect(shareOf("Ana (tú)")).toContain("$ 800.000");
    expect(shareOf("Juan")).toContain("$ 1.200.000");
    await userEvent.click(within(sheet()).getByRole("radio", { name: "Iguales" }));
    expect(shareOf("Ana (tú)")).toContain("$ 1.000.000");
    expect(shareOf("Juan")).toContain("$ 1.000.000");
  });

  it("does not offer the plan's split when the default leaves it out", () => {
    renderWithIntl(<Harness amount="5000000" />);
    expect(within(sheet()).queryByRole("radio", { name: "Según el plan" })).not.toBeInTheDocument();
  });

  it("offers the recorder, the guest and the fund as payers, and explains the guest and the fund", async () => {
    renderWithIntl(<Harness amount="30000000" />);
    const payers = within(sheet()).getByRole("radiogroup", { name: "Pagó" });
    expect(within(payers).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Ana (tú)", "Pedro (invitado)", "Fondo Hogar"]);
    expect(within(sheet()).getByRole("radiogroup", { name: "Desde" })).toBeInTheDocument();
    await userEvent.click(within(payers).getByRole("radio", { name: "Pedro (invitado)" }));
    expect(within(sheet()).getByText("Pedro es invitado: pagó fuera de la app, así que no hay cuenta que elegir.")).toBeInTheDocument();
    expect(within(sheet()).queryByRole("radiogroup", { name: "Desde" })).not.toBeInTheDocument();
    await userEvent.click(within(payers).getByRole("radio", { name: "Fondo Hogar" }));
    expect(within(sheet()).getByText("Sale de la cuenta Fondo Hogar. Nadie queda debiendo por este gasto.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project ui src/modules/ledger/ui/split`
Expected: FAIL — `Cannot find module './use-default-split'` and `'./split-sheet'`.

- [ ] **Step 3: Implement**

`src/modules/ledger/ui/split/use-default-split.ts`:

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import type { Api } from "@/shared/ui/api/client";
import type { SplitMethod } from "./split-math";

export const DEFAULT_SPLIT_DELAY_MS = 250;

export type DefaultSplitState =
  | { readonly status: "none" }
  | {
      readonly status: "ready";
      /** `<category>|<date>|<amount>` of the request this answers. */
      readonly key: string;
      readonly method: "BY_ALLOCATION" | "EQUAL";
      readonly availableMethods: readonly SplitMethod[];
      readonly shares: readonly { readonly memberId: string; readonly amount: string }[] | null;
    };

/**
 * HU-E6-08, ruling P167: the default split of the expense being typed, asked 250 ms after the category, the date or
 * the amount last changed. Only the latest request may answer; a failure answers none (the form then offers EQUAL).
 */
export const useDefaultSplit = (input: {
  readonly api: Api;
  readonly spaceId: string;
  readonly categoryId: string | null;
  readonly date: string;
  readonly amount: string | null;
  readonly enabled: boolean;
}): DefaultSplitState => {
  const { api, spaceId, categoryId, date, amount, enabled } = input;
  const [state, setState] = useState<DefaultSplitState>({ status: "none" });
  const latest = useRef("");
  useEffect(() => {
    if (!enabled || categoryId === null) return;
    const key = `${categoryId}|${date}|${amount ?? ""}`;
    latest.current = key;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { data } = await api.GET("/api/v1/spaces/{spaceId}/default-split", {
            params: { path: { spaceId }, query: { categoryId, date, ...(amount === null ? {} : { amount }) } },
          });
          if (latest.current !== key) return;
          setState(
            data
              ? {
                  status: "ready",
                  key,
                  method: data.method,
                  availableMethods: data.availableMethods,
                  shares: data.shares?.map((s) => ({ memberId: s.memberId, amount: s.amount.amount })) ?? null,
                }
              : { status: "none" },
          );
        } catch {
          if (latest.current === key) setState({ status: "none" });
        }
      })();
    }, DEFAULT_SPLIT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [api, spaceId, categoryId, date, amount, enabled]);
  return enabled && categoryId !== null ? state : { status: "none" };
};
```

(`amount` is sent only when it is a positive amount; the record form passes null otherwise, since the API's pattern refuses 0.)

`src/modules/ledger/ui/split/split-sheet.tsx` (`"use client"`): a `Sheet` titled `ledger.split.title` with `description={title}` (the "Mercado · $ 300.000 · Household" line). Sections:
1. **Pagó**: a `ChoiceGroup` `layout="chips"` labelled `ledger.split.payer` whose options are, in order, the recorder (`memberLabel(me, meUserId, t)`, value `me:<memberId>`), every guest of `members` (`guest:<memberId>`) and every fund (`fund:<accountId>`, its name). Choosing the recorder keeps `payer.accountId` (or the first of `myAccounts`); a guest sets `{ kind: "GUEST", memberId }`; a fund `{ kind: "FUND", accountId }`. For the recorder, a second `ChoiceGroup` `layout="chips"` labelled `ledger.split.from` of `myAccounts` (their names); for a guest the note `ledger.split.guestPays` (`name` = the guest's stored name); for a fund `ledger.split.fundPays` (`fund`).
2. **Cómo se divide**: a `ChoiceGroup` `layout="chips"` labelled `ledger.split.method` with `SPLIT_METHODS` filtered by `defaultSplit.availableMethods` when ready (else every method but BY_ALLOCATION), labels `ledger.split.methods.<METHOD>`; picking one calls `onChange({ ...draft, method, chosen: true, selected: method === "BY_ALLOCATION" ? <members with a positive share in defaultSplit.shares> : draft.selected })`. Under it `ledger.split.note.<METHOD>`.
Every change made in sections 2 and 3 (a method, a checkbox, a value) also sets `chosen: true`, so a later default split never undoes the person's work; a payer change does not.

3. **Para quién**: an `<ul aria-label={t("split.forWhom")}>` with one `<li aria-labelledby="split-name-<id>">` per member in `members` order: a native `<input type="checkbox">` with a `<label>` holding `<span id="split-name-<id>">{label}</span>` (checked = selected; disabled for BY_ALLOCATION), for PERCENT, EXACT and SHARES a 44 px-high `<input inputMode="decimal">` with `aria-label={t("split.valueOf", { name: label })}` shown while selected, its suffix (`%`, nothing, `ledger.split.units`), and on the right the share: `formatMoney({ amount, currency }, formats)` from `splitCheckOf` when it is ok, else `—`.
4. A `<p role="status">`: `ledger.split.sum` (`amount` = the total) when the check is ok; else `ledger.split.invalid.<reason>` with `percent` (`formatNumber(check.percent, formats)`), `amount` (`formatMoney`) or `name`; nothing while `splitCheckOf` is null.
5. The `lg` button `ledger.split.done`, disabled when the check is not ok, closing the sheet.

`splitCheckOf` gets `memberIds = members.map((m) => m.id)` and `allocation = defaultSplit.status === "ready" ? defaultSplit.shares : null`.

Catalog keys (`ledger.split`), es / en: `title` Quién pagó y para quién / Who paid and for whom; `payer` Pagó / Paid by; `from` Desde / From; `guestPays` {name} es invitado: pagó fuera de la app, así que no hay cuenta que elegir. / {name} is a guest: they paid outside the app, so there is no account to choose.; `fundPays` Sale de la cuenta {fund}. Nadie queda debiendo por este gasto. / It comes out of {fund}. Nobody owes anything for this expense.; `method` Cómo se divide / How it is split; `methods.BY_ALLOCATION` Según el plan / As in the plan; `methods.EQUAL` Iguales / Equal; `methods.PERCENT` Porcentaje / Percent; `methods.EXACT` Montos / Amounts; `methods.SHARES` Partes / Shares; `note.BY_ALLOCATION` Preseleccionado: la categoría alimenta una línea asignada en el plan activo. / Preselected: the category feeds an allocated line of the active plan.; `note.EQUAL` Partes iguales entre las personas marcadas, en pesos enteros. / Equal parts among the people checked, in whole units.; `note.PERCENT` Porcentajes que suman 100 %. / Percentages that add up to 100 %.; `note.EXACT` Montos exactos que suman el total del gasto. / Exact amounts that add up to the expense's total.; `note.SHARES` Partes por persona, por ejemplo 2 y 1. / Shares per person, for example 2 and 1.; `forWhom` Para quién / For whom; `valueOf` Valor de {name} / Value for {name}; `units` partes / shares; `sum` Suma {amount}: cuadra con el gasto / Adds up to {amount}: matches the expense; `invalid.percentShort` Falta asignar {percent} % / {percent} % is still unassigned; `invalid.percentOver` Sobra {percent} %: deben sumar 100 % / {percent} % too much: they must add up to 100 %; `invalid.exactShort` Falta asignar {amount} / {amount} is still unassigned; `invalid.exactOver` Sobran {amount} / {amount} too much; `invalid.unreadable` Revisa el valor de {name} / Check the value for {name}; `invalid.noParticipants` Elige al menos una persona / Choose at least one person; `invalid.tooSmall` El monto es muy pequeño para dividirlo así / The amount is too small to split this way; `done` Listo / Done; `summary` {method} · {shares} / {method} · {shares}; `paidBy` Pagó {payer} / Paid by {payer}; `paidFrom` Pagó {payer} desde {account} / Paid by {payer} from {account}; `split` División / Split.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's command, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ledger/ui/split src/i18n/messages
git commit -m "feat(ledger): edit who paid and how an expense is split, with the plan's default split (Refs #74)"
```

Risk: none.

---

### Task 13: A shared expense in the record form

The SharedExpense artboard: in a shared or direct space, the record form's expense replaces the single account picker with two rows, **Pagó Ana desde Bancolombia** and **División Iguales · Ana $ 150.000 · Juan $ 150.000**, both opening Task 12's sheet; the default split preselects its method until the person picks one (P167); the save button is disabled while the split is invalid (scenario "An invalid split cannot be saved"); and the request carries `payments` and `split` (or no `split` for BY_ALLOCATION) instead of `accountId`. The container reads the space's members, the space's accounts and the recorder's personal accounts (scenarios "Equal split among the selected participants", "The preview follows the chosen split method", "The default split by allocation is preselected and can be overridden", "Lines without allocation do not offer BY_ALLOCATION", and HU-E9-05's "the new expense form offers Pedro (guest) as a payer and as a participant next to Ana and Luis"). Incomes and transfers in a shared space keep M6a's behaviour; a personal space's form is unchanged (P168).

**Files:**
- Create: `src/modules/ledger/ui/split/{shared-context.ts, shared-context.test.ts, shared-fields.tsx}`, `src/modules/ledger/ui/record/record-form-shared.test.tsx`
- Modify: `src/modules/ledger/ui/record/{record-request.ts, record-request.test.ts, record-form.tsx, record-form-container.tsx}`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: Tasks 11–12; `personalSpaceOf`, `memberLabel` (`@/modules/spaces/ui`); `RecordForm`, `requestOf`, `recordFieldOf`, `useIdempotencyKey`.
- Produces:
  - `interface SharedExpenseContext { members: readonly MemberDto[]; meMemberId: string; myAccounts: readonly AccountDto[]; funds: readonly AccountDto[] }`; `sharedContextOf(input: { meUserId: string; members: readonly MemberDto[]; spaceAccounts: readonly AccountDto[]; personalAccounts: readonly AccountDto[] }): SharedExpenseContext | null` (null when the person is not a current member); `initialSplitDraft(context: SharedExpenseContext): SplitDraft` (the recorder pays from their first account, EQUAL among every current member, `chosen: false`).
  - `requestOf(draft, currency, numberFormat, shared?: { split: SplitDraft; memberIds: readonly string[] })`: for an EXPENSE with `shared`, the body has `payments` and `split` (when not null) and no `accountId`; it answers `{ ok: false, field: "payer" | "split" }` for an unpayable or invalid split; `RecordField` gains `"payer" | "split"`; `recordFieldOf` maps `GuestHasNoAccounts`, `InvalidFundAccount`, `MixedFundPayment`, `PaymentsRequired` to `payer` and `InvalidSplit`, `SharesDoNotMatchAmount`, `ParticipantsRequired`, `NotASpaceMember` to `split`, and `ValidationFailed` paths `payments` and `split` likewise.
  - `RecordForm` gains `shared?: SharedExpenseContext`; `SharedFields({ context, draft, onChange, amount, currency, formats, title, spaceId, categoryId, date, api, error? })` (client; loads `SplitSheet` with `next/dynamic`).

- [ ] **Step 1: Write the failing tests**

`src/modules/ledger/ui/split/shared-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { accountDto, guestDto, memberDto } from "../../../../../tests/support/ui/dto";
import { initialSplitDraft, sharedContextOf } from "./shared-context";

const MEMBERS = [memberDto(), memberDto({ id: "m-luis", userId: "u-luis", displayName: "Luis", role: "MEMBER" }), guestDto()];

describe("sharedContextOf (HU-E9-06, ruling P168)", () => {
  it("pays from the person's own accounts (personal space first) and offers the space's active funds", () => {
    const context = sharedContextOf({
      meUserId: "u-ana",
      members: MEMBERS,
      personalAccounts: [accountDto({ id: "a-bank", name: "Bancolombia" }), accountDto({ id: "a-old", archivedAt: "2026-10-01T00:00:00.000Z" })],
      spaceAccounts: [
        accountDto({ id: "a-fund", name: "Fondo Hogar", type: "SHARED_FUND", ownerUserId: null }),
        accountDto({ id: "a-cash", name: "Caja de Ana", ownerUserId: "u-ana" }),
        accountDto({ id: "a-luis", name: "Caja de Luis", ownerUserId: "u-luis" }),
      ],
    });
    expect(context?.meMemberId).toBe("m-ana");
    expect(context?.myAccounts.map((a) => a.id)).toEqual(["a-bank", "a-cash"]);
    expect(context?.funds.map((a) => a.id)).toEqual(["a-fund"]);
    expect(initialSplitDraft(context!)).toEqual({
      payer: { kind: "ME", memberId: "m-ana", accountId: "a-bank" },
      method: "EQUAL",
      selected: ["m-ana", "m-luis", "m-pedro"],
      values: {},
      chosen: false,
    });
  });

  it("answers null for someone who is not a current member", () => {
    expect(sharedContextOf({ meUserId: "u-x", members: MEMBERS, personalAccounts: [], spaceAccounts: [] })).toBeNull();
  });
});
```

`src/modules/ledger/ui/record/record-request.test.ts`, inside `describe("requestOf (HU-E9-03, ruling P118)")`:

```ts
  it("pays a shared expense with payments and a split instead of an account (HU-E9-06)", () => {
    const split = { payer: { kind: "ME" as const, memberId: "m-ana", accountId: "a-bank" }, method: "EQUAL" as const, selected: ["m-ana", "m-juan"], values: {}, chosen: false };
    const shared = requestOf(draft({ accountId: null, amount: "300000" }), "COP", "DOT_COMMA", { split, memberIds: ["m-ana", "m-juan"] });
    expect(shared.ok && shared.body).toMatchObject({
      payments: [{ memberId: "m-ana", accountId: "a-bank", amount: { amount: "30000000", currency: "COP" } }],
      split: { method: "EQUAL", participants: [{ memberId: "m-ana" }, { memberId: "m-juan" }] },
    });
    expect(shared.ok && shared.body).not.toHaveProperty("accountId");
    const planned = requestOf(draft(), "COP", "DOT_COMMA", { split: { ...split, method: "BY_ALLOCATION" }, memberIds: ["m-ana", "m-juan"] });
    expect(planned.ok && planned.body).not.toHaveProperty("split");
    expect(requestOf(draft(), "COP", "DOT_COMMA", { split: { ...split, selected: [] }, memberIds: ["m-ana"] })).toEqual({ ok: false, field: "split" });
  });

  it("puts the payment and split codes next to the split rows", () => {
    const p = (code: string, errors: { path: string; message: string }[] = []) => ({ code, status: 422, requestId: "r", errors, field: null });
    expect(recordFieldOf(p("GuestHasNoAccounts"))).toBe("payer");
    expect(recordFieldOf(p("SharesDoNotMatchAmount"))).toBe("split");
    expect(recordFieldOf(p("ValidationFailed", [{ path: "split.participants.0.percent", message: "x" }]))).toBe("split");
  });
```

`src/modules/ledger/ui/record/record-form-shared.test.tsx` (the M6a record-form test's mocks, fake timers for `Date` only and `groups`; real timers for the 250 ms debounce are kept because `toFake: ["Date"]` fakes nothing else):

```tsx
const HOUSEHOLD = householdSpace();
const MEMBERS = [memberDto(), memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" })];
const BANK = accountDto({ id: "a-bank", name: "Bancolombia" });
const context = (members = MEMBERS, funds: AccountDto[] = []) => ({ members, meMemberId: "m-ana", myAccounts: [BANK], funds });
const equal = (amount: string, members = MEMBERS) =>
  jsonResponse({ method: "EQUAL", availableMethods: ["EQUAL", "PERCENT", "EXACT", "SHARES"], lineId: null,
    shares: members.map((m) => ({ memberId: m.id, amount: { amount: String(BigInt(amount) / BigInt(members.length)), currency: "COP" } })) });
const form = (api: Api, shared = context()) =>
  renderWithIntl(
    <RecordForm space={HOUSEHOLD} accounts={[]} groups={groups} formats={BUILT_IN_FORMATS} initialKind="EXPENSE"
      initialNow="2026-11-01T04:30:00.000Z" timeZone="America/Bogota" shared={shared} api={api} />,
  );
const enter = async (pesos: string) => {
  await userEvent.type(screen.getByLabelText("Monto"), pesos);
  await userEvent.click(screen.getByRole("button", { name: /Categoría/ }));
  await userEvent.click(screen.getByRole("radio", { name: "Groceries" }));
  await userEvent.click(screen.getByRole("button", { name: "Usar Groceries" }));
};

describe("shared expense (HU-E9-06)", () => {
  it("splits 300,000 COP equally between Ana and Juan, paid from Bancolombia, and records it once", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(new URL(r.url).searchParams.get("amount")!),
      "POST /api/v1/spaces/{spaceId}/expenses": () => jsonResponse({ ...transactionDto({ id: "t-new" }), warnings: [] }, 201),
    });
    const { container } = form(api);
    expect(screen.queryByRole("button", { name: /^Cuenta/ })).not.toBeInTheDocument();
    await enter("300000");
    expect(screen.getByRole("button", { name: /Pagó/ })).toHaveTextContent("Pagó Ana (tú) desde Bancolombia");
    await waitFor(() => expect(normalized(screen.getByRole("button", { name: /División/ }).textContent)).toContain("Iguales · Ana (tú) $ 150.000 · Juan $ 150.000"));
    await userEvent.dblClick(screen.getByRole("button", { name: "Guardar gasto" }));
    const posted = requests.filter((r) => r.method === "POST");
    expect(posted).toHaveLength(1);
    const body = await posted[0]!.json();
    expect(body).toMatchObject({
      categoryId: "c-groceries",
      amount: { amount: "30000000", currency: "COP" },
      payments: [{ memberId: "m-ana", accountId: "a-bank", amount: { amount: "30000000", currency: "COP" } }],
      split: { method: "EQUAL", participants: [{ memberId: "m-ana" }, { memberId: "m-juan" }] },
    });
    expect(body).not.toHaveProperty("accountId");
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-household/transactions");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("offers the guest Pedro as a payer and as a participant next to Ana and Luis, and no other member as payer", async () => {
    const members = [memberDto(), memberDto({ id: "m-luis", userId: "u-luis", displayName: "Luis", role: "MEMBER" }), guestDto()];
    const { api } = fakeApi({ "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(new URL(r.url).searchParams.get("amount")!, members) });
    form(api, context(members));
    await enter("90000");
    await userEvent.click(screen.getByRole("button", { name: /Pagó/ }));
    const sheet = screen.getByRole("dialog", { name: "Quién pagó y para quién" });
    expect(within(within(sheet).getByRole("radiogroup", { name: "Pagó" })).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Ana (tú)", "Pedro (invitado)"]);
    expect(within(sheet).getAllByRole("checkbox").map((c) => c.closest("li")!.getAttribute("aria-labelledby"))).toEqual([
      "split-name-m-ana", "split-name-m-luis", "split-name-m-pedro",
    ]);
  });

  it("keeps the save button disabled while 10 % of the split is unassigned", async () => {
    const { api } = fakeApi({ "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(new URL(r.url).searchParams.get("amount")!) });
    form(api);
    await enter("300000");
    await userEvent.click(screen.getByRole("button", { name: /División/ }));
    const sheet = screen.getByRole("dialog", { name: "Quién pagó y para quién" });
    await userEvent.click(within(sheet).getByRole("radio", { name: "Porcentaje" }));
    await userEvent.type(within(sheet).getByLabelText("Valor de Ana (tú)"), "40");
    await userEvent.type(within(sheet).getByLabelText("Valor de Juan"), "50");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Guardar gasto" })).toBeDisabled();
    expect(normalized(screen.getByRole("button", { name: /División/ }).textContent)).toContain("Falta asignar 10 %");
  });

  it("preselects the plan's split, sends no split for it, and lets the person switch to equal parts", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": () =>
        jsonResponse({ method: "BY_ALLOCATION", availableMethods: ["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"], lineId: "l-home",
          shares: [{ memberId: "m-ana", amount: { amount: "80000000", currency: "COP" } }, { memberId: "m-juan", amount: { amount: "120000000", currency: "COP" } }] }),
      "POST /api/v1/spaces/{spaceId}/expenses": () => jsonResponse({ ...transactionDto({ id: "t-new" }), warnings: [] }, 201),
    });
    form(api);
    await enter("2000000");
    await waitFor(() => expect(normalized(screen.getByRole("button", { name: /División/ }).textContent)).toContain("Según el plan · Ana (tú) $ 800.000 · Juan $ 1.200.000"));
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    const body = await requests.find((r) => r.method === "POST")!.json();
    expect(body).not.toHaveProperty("split");
    expect(body.payments).toHaveLength(1);
  });

  it("records a fund payment with no payer member", async () => {
    const fund = accountDto({ id: "a-fund", name: "Fondo Hogar", type: "SHARED_FUND", ownerUserId: null });
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(new URL(r.url).searchParams.get("amount")!),
      "POST /api/v1/spaces/{spaceId}/expenses": () => jsonResponse({ ...transactionDto({ id: "t-new" }), warnings: [] }, 201),
    });
    form(api, context(MEMBERS, [fund]));
    await enter("300000");
    await userEvent.click(screen.getByRole("button", { name: /Pagó/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Fondo Hogar" }));
    await userEvent.click(screen.getByRole("button", { name: "Listo" }));
    expect(screen.getByRole("button", { name: /Pagó/ })).toHaveTextContent("Pagó Fondo Hogar");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect((await requests.find((r) => r.method === "POST")!.json()).payments).toEqual([
      { memberId: null, accountId: "a-fund", amount: { amount: "30000000", currency: "COP" } },
    ]);
  });
});
```

(Imports as in `record-form.test.tsx`, plus `householdSpace`, `memberDto`, `guestDto`, `normalized`, `within`, `waitFor` and `type AccountDto`. The personal-space tests of `record-form.test.tsx` stay as they are and still pin `accountId` in the body.)

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/ui/split/shared-context.test.ts src/modules/ledger/ui/record/record-request.test.ts` and `pnpm exec vitest run --project ui src/modules/ledger/ui/record/record-form-shared.test.tsx`
Expected: FAIL — `Cannot find module './shared-context'`; `requestOf` ignores its fourth argument; the form shows the account picker.

- [ ] **Step 3: Implement**

`src/modules/ledger/ui/split/shared-context.ts`:

```ts
import type { AccountDto, MemberDto } from "@/shared/ui/api/dto";
import type { SplitDraft } from "./split-request";

/** HU-E9-06, ruling P168: what a shared expense's payer and split are chosen from. */
export interface SharedExpenseContext {
  /** Current members in join order: the participants. */
  readonly members: readonly MemberDto[];
  readonly meMemberId: string;
  /** Active accounts the recorder owns: their personal space's, then their own in this space (D9). */
  readonly myAccounts: readonly AccountDto[];
  /** The space's active shared funds, which pay with no payer member (HU-E4-10). */
  readonly funds: readonly AccountDto[];
}

const active = (a: AccountDto) => a.archivedAt === null;

export const sharedContextOf = (input: {
  readonly meUserId: string;
  readonly members: readonly MemberDto[];
  readonly spaceAccounts: readonly AccountDto[];
  readonly personalAccounts: readonly AccountDto[];
}): SharedExpenseContext | null => {
  const me = input.members.find((m) => m.userId === input.meUserId);
  if (!me) return null;
  return {
    members: input.members,
    meMemberId: me.id,
    myAccounts: [
      ...input.personalAccounts.filter(active),
      ...input.spaceAccounts.filter((a) => active(a) && a.type !== "SHARED_FUND" && a.ownerUserId === input.meUserId),
    ],
    funds: input.spaceAccounts.filter((a) => active(a) && a.type === "SHARED_FUND"),
  };
};

/** The recorder pays from their first account, equally among every current member, until a default or a choice. */
export const initialSplitDraft = (context: SharedExpenseContext): SplitDraft => ({
  payer: { kind: "ME", memberId: context.meMemberId, accountId: context.myAccounts[0]?.id ?? null },
  method: "EQUAL",
  selected: context.members.map((m) => m.id),
  values: {},
  chosen: false,
});
```

`record-request.ts`: import `sharedPartsOf` and `type SplitDraft` from `../split/split-request`; `RecordField` becomes `"amount" | "description" | "category" | "account" | "toAccount" | "when" | "payer" | "split"`; `requestOf` takes `shared?: { readonly split: SplitDraft; readonly memberIds: readonly string[] }` and its failure type adds `"payer" | "split"`; replace the line `if (!draft.accountId) return { ok: false, field: "account" };` with:

```ts
  const sharedExpense = draft.kind === "EXPENSE" && shared !== undefined;
  if (!sharedExpense && !draft.accountId) return { ok: false, field: "account" };
```

and replace the closing `} else body.accountId = draft.accountId;` with:

```ts
  } else if (sharedExpense) {
    const parts = sharedPartsOf(shared.split, { amount: minor, currency, numberFormat, memberIds: shared.memberIds });
    if (!parts.ok) return { ok: false, field: parts.field };
    body.payments = parts.payments;
    if (parts.split) body.split = parts.split;
  } else body.accountId = draft.accountId;
```

`BY_CODE` gains `GuestHasNoAccounts: "payer"`, `InvalidFundAccount: "payer"`, `MixedFundPayment: "payer"`, `PaymentsRequired: "payer"`, `InvalidSplit: "split"`, `SharesDoNotMatchAmount: "split"`, `ParticipantsRequired: "split"`, `NotASpaceMember: "split"`; `BY_PATH` gains `payments: "payer"` and `split: "split"`.

`shared-fields.tsx` (`"use client"`): `const SplitSheet = dynamic(() => import("./split-sheet").then((m) => m.SplitSheet), { ssr: false });` (the editor's code loads only when a shared expense is opened, P177). It calls `useDefaultSplit({ api, spaceId, categoryId, date, amount, enabled: true })` and, in an effect, applies a ready default while `!draft.chosen`: `onChange({ ...draft, method: d.method, selected: d.method === "BY_ALLOCATION" ? d.shares?.filter((s) => BigInt(s.amount) > 0n).map((s) => s.memberId) ?? draft.selected : context.members.map((m) => m.id) })` when the method differs (a default never touches a chosen method). It renders two full-width row buttons like the form's pickers: `ledger.split.paidFrom` (`payer` = `memberLabel(me)`, `account` = the account's name) or `ledger.split.paidBy` (a guest's label or the fund's name); and `ledger.split.split` over `ledger.split.summary` (`method` = `ledger.split.methods.<METHOD>`, `shares` = each member's `"<label> <amount>"` joined by " · ") or, while invalid, the status line's message; `error` under the second row with `id="record-split-error"`. Both rows open the one `SplitSheet`, whose `title` is the form's `"<description or category> · <amount> · <space>"`.

`record-form.tsx`: props gain `readonly shared?: SharedExpenseContext;`; `const [split, setSplit] = useState(() => (shared ? initialSplitDraft(shared) : null));`; `const sharedExpense = shared && split && kind === "EXPENSE" ? { split, memberIds: shared.members.map((m) => m.id) } : undefined;`; `built = requestOf(draft, space.currency, formats.numberFormat, sharedExpense)`; where the account picker renders, render instead, for a shared expense, `<SharedFields context={shared} draft={split} onChange={setSplit} amount={positiveMinor} currency={space.currency} formats={formats} title={…} spaceId={space.id} categoryId={category ? (category.subcategoryId ?? category.categoryId) : null} date={when.date} api={api} error={errorOf("split") ?? errorOf("payer")} />` (`positiveMinor` is the built amount's minor units when they parse and are above zero, else null); the save button is `disabled={pending || (!built.ok && built.field === "split")}`; and a problem whose field is `account` is shown as `payer` for a shared expense (the account it names is the payer's). On a 201 the push is unchanged here (Task 14 adds the warning).

`record-form-container.tsx`: when `space.kind !== "PERSONAL"`, also read `GET …/members` and the personal space's accounts (`personalSpaceOf(spaces).id`), in the same `Promise.all`; build `sharedContextOf({ meUserId: me!.id, members, spaceAccounts: accounts.data.items, personalAccounts })` (`null` → `notFound()`) and pass `shared`. `personalSpaceOf` comes from `@/modules/spaces/ui`.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, `pnpm build`, `pnpm test:e2e` (M6a's personal expense scenarios are unchanged), then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ledger/ui src/i18n/messages
git commit -m "feat(ledger): record a shared expense with a payer and a live split preview (Refs #74)"
```

Risk: none (the personal form's body is pinned unchanged by M6a's tests; the shared body is validated by the API).

---

### Task 14: Saved with a warning, and who paid in the list

The FundWarning artboard (scenario "Paying beyond the fund balance shows a warning", ruling P170): when a recorded expense answers `FundBalanceNegative`, the form opens the transaction list with `?notice=FundBalanceNegative&account=<fund id>`, and the list shows **Gasto guardado** and `warnings.FundBalanceNegative` with the fund's name and its balance, read from the accounts the list already loads (no amount ever travels in the URL); a dismiss link returns to the same list without the notice. The same task makes shared rows say who paid (ruling P171): an expense row names its payer ("pagó Juan", or the fund's name), and a settlement row reads "Juan → Ana", so Task 19's settlements are visible in the list.

**Files:**
- Create: `src/modules/ledger/ui/saved-notice.tsx`, `src/modules/ledger/ui/saved-notice.test.tsx`
- Modify: `src/modules/ledger/ui/record/{record-request.ts, record-request.test.ts, record-form.tsx, record-form-shared.test.tsx}`, `src/modules/ledger/ui/{transaction-row.tsx, transaction-row.test.tsx, transaction-list.tsx, transaction-list-container.tsx, transaction-list.test.tsx}`, `src/app/(web)/(app)/spaces/[spaceId]/transactions/page.tsx`, `tests/support/ui/dto.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `RecordedExpenseDto`, `formatMoney`, `memberLabel`.
- Produces: `afterSaveUrl(spaceId: string, warnings?: RecordedExpenseDto["warnings"]): string`; `SavedNotice({ accountName, balance, formats, dismissHref })`; `RowContext.memberNames: Record<string, string>` (empty in a personal space); `loadTransactionList(api, { spaceId, period?, categoryId?, shared? })` reads `GET …/members` when `shared` (default `false`, so M6a's calls keep their meaning); `TransactionListContainer({ spaceId, period?, categoryId?, notice?, noticeAccount? })`; `rowContext` in `tests/support/ui/dto.ts` gains `memberNames: {}`.

- [ ] **Step 1: Write the failing tests**

`record-request.test.ts`:

```ts
describe("afterSaveUrl (HU-E9-06, ruling P170)", () => {
  it("opens the list, with the fund's notice when the expense left it negative", () => {
    expect(afterSaveUrl("sp-household", [])).toBe("/spaces/sp-household/transactions");
    expect(afterSaveUrl("sp-household", [{ code: "FundBalanceNegative", accountId: "a-fund", balance: { amount: "-50000000", currency: "COP" } }])).toBe(
      "/spaces/sp-household/transactions?notice=FundBalanceNegative&account=a-fund",
    );
  });
});
```

`record-form-shared.test.tsx`, add:

```tsx
  it("goes to the list with the fund's warning when the fund went negative", async () => {
    const fund = accountDto({ id: "a-fund", name: "Fondo Hogar", type: "SHARED_FUND", ownerUserId: null });
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(new URL(r.url).searchParams.get("amount")!),
      "POST /api/v1/spaces/{spaceId}/expenses": () =>
        jsonResponse({ ...transactionDto({ id: "t-new" }), warnings: [{ code: "FundBalanceNegative", accountId: "a-fund", balance: { amount: "-50000000", currency: "COP" } }] }, 201),
    });
    form(api, context(MEMBERS, [fund]));
    await enter("2000000");
    await userEvent.click(screen.getByRole("button", { name: /Pagó/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Fondo Hogar" }));
    await userEvent.click(screen.getByRole("button", { name: "Listo" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/spaces/sp-household/transactions?notice=FundBalanceNegative&account=a-fund"),
    );
  });
```

`src/modules/ledger/ui/saved-notice.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { SavedNotice } from "./saved-notice";

describe("saved with a warning (HU-E9-06, ruling P170)", () => {
  it("says the expense was saved and the fund's balance is now -500,000 COP", async () => {
    const { container } = renderWithIntl(
      <SavedNotice accountName="Fondo Hogar" balance={cop(-500_000)} formats={BUILT_IN_FORMATS} dismissHref="/spaces/sp-household/transactions" />,
    );
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Gasto guardado");
    expect(normalized(notice.textContent)).toContain(
      "El saldo de Fondo Hogar quedó en −$ 500.000. Pueden hacer un aporte al fondo para cubrirlo.",
    );
    expect(screen.getByRole("link", { name: "Cerrar aviso" })).toHaveAttribute("href", "/spaces/sp-household/transactions");
    expect(await axeViolations(container)).toEqual([]);
  });
});
```

`transaction-row.test.tsx`, add:

```tsx
  it("names who paid a shared expense and who paid whom in a settlement (ruling P171)", () => {
    const shared = { ...rowContext, memberNames: { "m-ana": "Ana", "m-juan": "Juan" }, accountNames: { "a-fund": "Fondo Hogar" } };
    const { unmount } = renderWithIntl(
      <ol><TransactionRow tx={transactionDto({ type: "EXPENSE", description: "Mercado", payments: [{ memberId: "m-juan", accountId: null, amount: cop(300_000) }] })} context={shared} /></ol>,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent("pagó Juan");
    unmount();
    const fundPaid = renderWithIntl(
      <ol><TransactionRow tx={transactionDto({ type: "EXPENSE", payments: [{ memberId: null, accountId: "a-fund", amount: cop(1) }] })} context={shared} /></ol>,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent("pagó Fondo Hogar");
    fundPaid.unmount();
    renderWithIntl(
      <ol><TransactionRow tx={transactionDto({ type: "SETTLEMENT", description: "", payerMemberId: "m-juan", receivingMemberId: "m-ana", amount: cop(100_000) })} context={shared} /></ol>,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent("Pago entre miembros");
    expect(screen.getByRole("listitem")).toHaveTextContent("Juan → Ana");
  });
```

`transaction-list.test.tsx`: the `loadTransactionList` tests pass `shared: false` and expect no members request; add one with `shared: true` routing `"GET /api/v1/spaces/{spaceId}/members"` to `jsonResponse({ items: [memberDto(), memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan" })] })` and expecting `memberNames` in the result: `{ "m-ana": "Ana", "m-juan": "Juan" }` (the list's own data gains `memberNames`). Add a render test: `TransactionList` with `notice={{ accountName: "Fondo Hogar", balance: cop(-500_000) }}` shows the `status` notice and its dismiss link keeps `?period=2026-10` when the filter has that period.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/ui/record/record-request.test.ts` and `pnpm exec vitest run --project ui src/modules/ledger/ui`
Expected: FAIL — `afterSaveUrl` is not exported; the form pushes the plain list URL; `SavedNotice` does not exist; the rows name no payer.

- [ ] **Step 3: Implement**

`record-request.ts`:

```ts
/** Ruling P170: the list after a save; a fund left negative travels as a code and an account id, never an amount. */
export const afterSaveUrl = (spaceId: string, warnings: RecordedExpenseDto["warnings"] = []): string => {
  const negative = warnings.find((w) => w.code === "FundBalanceNegative");
  const list = `/spaces/${spaceId}/transactions`;
  return negative ? `${list}?notice=FundBalanceNegative&account=${encodeURIComponent(negative.accountId)}` : list;
};
```

(import `type RecordedExpenseDto` from `@/shared/ui/api/dto`). `record-form.tsx`: keep the POST's `data`; on success `router.push(afterSaveUrl(space.id, built.kind === "EXPENSE" ? (data as RecordedExpenseDto | undefined)?.warnings : undefined))`.

`saved-notice.tsx` (server-renderable, no `"use client"`): a `div role="status"` with the `warning` icon, a bold `ledger.saved.title`, the line `warnings.FundBalanceNegative` (`account` = `accountName`, `balance` = `formatMoney(balance, formats)`), and a 44 px `Link` with the `close` icon, `aria-label` `ledger.saved.dismiss`, to `dismissHref`.

`transaction-row.tsx`: `RowContext` gains `readonly memberNames: Record<string, string>;`. In the non-transfer branch, before the account name: for an EXPENSE whose space has members (`Object.keys(memberNames).length > 0`), the first payment's payer — `memberNames[memberId]` or, for a fund payment (`memberId === null`), `accountNames[accountId]` — is pushed as `t("paidBy", { name })`, and the account name is then not pushed again. A SETTLEMENT row pushes `t("settlement", { from: memberNames[payerMemberId] ?? "", to: memberNames[receivingMemberId] ?? "" })` instead of a category and account. (A personal space's rows are unchanged: `memberNames` is empty there.)

`transaction-list-container.tsx`: `loadTransactionList` takes `shared?: boolean` (default `false`); when true it reads `GET …/members` with the other three reads and answers `memberNames: Object.fromEntries(items.map((m) => [m.id, m.displayName]))`, else `{}`. `TransactionListContainer` takes `notice?: string` and `noticeAccount?: string`, reads `getSpaces()` beside `getMe()` for the space's kind (`shared = kind !== "PERSONAL"`), puts `memberNames` into the context, and when `notice === "FundBalanceNegative"` and `noticeAccount` names one of the loaded accounts, passes `notice={{ accountName, balance }}` to `TransactionList`, which renders `SavedNotice` above its totals with `dismissHref` = the list's URL with the current `period` and `category` and without `notice`. `src/app/(web)/(app)/spaces/[spaceId]/transactions/page.tsx` reads `notice` and `account` from its `searchParams` and passes them on.

`tests/support/ui/dto.ts`: `rowContext` gains `memberNames: {}`.

Catalog keys, es / en: `ledger.saved.title` Gasto guardado / Expense saved; `ledger.saved.dismiss` Cerrar aviso / Dismiss notice; `ledger.paidBy` pagó {name} / paid by {name}; `ledger.settlement` {from} → {to} / {from} → {to}.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, `pnpm build`, `pnpm test:e2e`, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ledger/ui "src/app/(web)/(app)/spaces/[spaceId]/transactions/page.tsx" tests/support/ui/dto.ts src/i18n/messages
git commit -m "feat(ledger): warn when a fund goes negative and name who paid in shared rows (Refs #74)"
```

Risk: none.

---

### Task 15: Split with someone from Personal

The SplitWithPerson artboard (HU-E9-06's technical note "Split with someone reuses the same form to call SplitWithPerson", ruling P172): in the personal space's expense form, **Dividir con alguien** opens a sheet listing the people the recorder shares a space with — each registered co-member once (the member of their direct space when one exists, "Ya tienen «Ana & Juan»: se usa ese"; otherwise a shared space's member, "Se crea un espacio para los dos") and the guests of the recorder's direct spaces ("De «Ana & Carlos»") — plus a field for a new guest by name. After a choice, the form shows "Con Juan · mitad y mitad", its save button reads **Guardar y dividir**, and saving posts `POST /api/v1/direct-splits` with the expense's fields, the counterpart and the category's catalog key, then opens the direct space's list. A category without a catalog key (one the person created) cannot travel to another space: the form says so under the category and sends nothing. A direct split is always halves: the API takes no split for it.

**Files:**
- Create: `src/modules/ledger/ui/direct/{counterparts.ts, counterparts.test.ts, direct-request.ts, direct-request.test.ts, split-with-person-sheet.tsx}`, `src/modules/ledger/ui/record/record-form-direct.test.tsx`
- Modify: `src/modules/ledger/ui/record/{record-form.tsx, record-form-container.tsx}`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `requestOf`, `useIdempotencyKey`, `findCategory`, `MemberDto`, `SpaceDto`, `DirectSplitDto`, `Sheet`, `ChoiceGroup`, `TextField`.
- Produces: `interface Person { memberId: string; name: string; isGuest: boolean; directSpace: string | null }`; `peopleOf(input: { meUserId: string; spaces: readonly SpaceDto[]; membersBySpace: Readonly<Record<string, readonly MemberDto[]>> }): Person[]` (sorted by name); `type DirectChoice = { kind: "MEMBER"; memberId: string; name: string } | { kind: "GUEST"; displayName: string }`; `categoryKeyOf(groups: readonly CategoryGroupDto[], choice: CategoryChoice): string | null` (the subcategory's key, else its parent's); `directBodyOf(body: Record<string, unknown>, choice: DirectChoice, categoryKey: string): Record<string, unknown>`; `SplitWithPersonSheet({ open, onOpenChange, people, currency, onChoose })`; `RecordForm` gains `people?: readonly Person[]` (personal space only).

- [ ] **Step 1: Write the failing tests**

`src/modules/ledger/ui/direct/counterparts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { guestDto, householdSpace, memberDto, spaceDto } from "../../../../../tests/support/ui/dto";
import { peopleOf } from "./counterparts";

const ana = memberDto();
const juan = (id: string) => memberDto({ id, userId: "u-juan", displayName: "Juan", role: "MEMBER" });
const luis = memberDto({ id: "m-luis", userId: "u-luis", displayName: "Luis", role: "MEMBER" });

describe("peopleOf (HU-E1-13, ruling P172)", () => {
  it("lists each co-member once, through their direct space when there is one, and only direct spaces' guests", () => {
    const spaces = [
      spaceDto(),
      householdSpace(),
      householdSpace({ id: "sp-ana-juan", name: "Ana & Juan", kind: "DIRECT" }),
      householdSpace({ id: "sp-ana-carlos", name: "Ana & Carlos", kind: "DIRECT" }),
    ];
    const people = peopleOf({
      meUserId: "u-ana",
      spaces,
      membersBySpace: {
        "sp-household": [ana, juan("m-juan-h"), luis, guestDto()],
        "sp-ana-juan": [memberDto({ id: "m-ana-d" }), juan("m-juan-d")],
        "sp-ana-carlos": [memberDto({ id: "m-ana-c" }), guestDto({ id: "m-carlos", displayName: "Carlos" })],
      },
    });
    expect(people).toEqual([
      { memberId: "m-carlos", name: "Carlos", isGuest: true, directSpace: "Ana & Carlos" },
      { memberId: "m-juan-d", name: "Juan", isGuest: false, directSpace: "Ana & Juan" },
      { memberId: "m-luis", name: "Luis", isGuest: false, directSpace: null },
    ]);
  });
});
```

`src/modules/ledger/ui/direct/direct-request.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { categoryDto, groupDto } from "../../../../../tests/support/ui/dto";
import { categoryKeyOf, directBodyOf } from "./direct-request";

const groups = [
  groupDto({
    categories: [
      categoryDto({ id: "c-food", key: "restaurants", subcategories: [categoryDto({ id: "c-sushi", key: null, parentCategoryId: "c-food" })] }),
      categoryDto({ id: "c-mine", key: null }),
    ],
  }),
];

describe("direct split request (HU-E1-13, ruling P172)", () => {
  it("names the category by its catalog key, the subcategory's or else its parent's, and none for a person's own", () => {
    expect(categoryKeyOf(groups, { categoryId: "c-food", subcategoryId: "c-sushi" })).toBe("restaurants");
    expect(categoryKeyOf(groups, { categoryId: "c-food", subcategoryId: null })).toBe("restaurants");
    expect(categoryKeyOf(groups, { categoryId: "c-mine", subcategoryId: null })).toBeNull();
    expect(categoryKeyOf(groups, null)).toBeNull();
  });

  it("sends the expense with the counterpart and the key instead of the category id", () => {
    const body = { description: "Cena", date: "2026-10-31", occurredAt: "x", timeZone: "America/Bogota", categoryId: "c-food", amount: { amount: "12000000", currency: "COP" }, accountId: "a-bank" };
    expect(directBodyOf(body, { kind: "MEMBER", memberId: "m-juan-d", name: "Juan" }, "restaurants")).toEqual({
      description: "Cena", date: "2026-10-31", occurredAt: "x", timeZone: "America/Bogota",
      amount: { amount: "12000000", currency: "COP" }, accountId: "a-bank",
      counterpart: { kind: "MEMBER", memberId: "m-juan-d" }, categoryKey: "restaurants",
    });
    expect(directBodyOf(body, { kind: "GUEST", displayName: " Marta " }, "restaurants").counterpart).toEqual({ kind: "GUEST", displayName: "Marta" });
  });
});
```

`src/modules/ledger/ui/record/record-form-direct.test.tsx` (M6a's record-form test setup; `groups` with "Groceries" given `key: "groceries"` and a second category "Mine" with `key: null`):

```tsx
const PEOPLE = [
  { memberId: "m-juan-d", name: "Juan", isGuest: false, directSpace: "Ana & Juan" },
  { memberId: "m-luis", name: "Luis", isGuest: false, directSpace: null },
];
const form = (api: Api) =>
  renderWithIntl(
    <RecordForm space={spaceDto()} accounts={accounts} groups={groups} formats={BUILT_IN_FORMATS} initialKind="EXPENSE"
      initialNow="2026-11-01T04:30:00.000Z" timeZone="America/Bogota" people={PEOPLE} api={api} />,
  );

describe("split with someone from Personal (HU-E9-06, ruling P172)", () => {
  it("splits a dinner with Juan through their direct space and opens its list", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/direct-splits": () => jsonResponse({ spaceId: "sp-ana-juan", created: false, expense: { ...transactionDto({ id: "t-1" }), warnings: [] } }, 201),
    });
    const { container } = form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "120000");
    await userEvent.type(screen.getByLabelText("Descripción"), "Cena");
    await userEvent.click(screen.getByRole("button", { name: /Categoría/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Groceries" }));
    await userEvent.click(screen.getByRole("button", { name: "Usar Groceries" }));
    await userEvent.click(screen.getByRole("button", { name: "Dividir con alguien" }));
    const sheet = screen.getByRole("dialog", { name: "Dividir con alguien" });
    expect(within(sheet).getByText("Ya tienen «Ana & Juan»: se usa ese")).toBeInTheDocument();
    expect(within(sheet).getByText("Se crea un espacio para los dos")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("radio", { name: /Juan/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Seguir con Juan" }));
    expect(screen.getByText("Con Juan · mitad y mitad")).toBeInTheDocument();
    await userEvent.dblClick(screen.getByRole("button", { name: "Guardar y dividir" }));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await requests[0]!.json()).toMatchObject({
      counterpart: { kind: "MEMBER", memberId: "m-juan-d" }, categoryKey: "groceries", accountId: "a-bank",
      amount: { amount: "12000000", currency: "COP" }, description: "Cena",
    });
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-ana-juan/transactions");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("splits with a new guest typed by name", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/direct-splits": () => jsonResponse({ spaceId: "sp-new", created: true, expense: { ...transactionDto(), warnings: [] } }, 201),
    });
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "50000");
    await userEvent.click(screen.getByRole("button", { name: /Categoría/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Groceries" }));
    await userEvent.click(screen.getByRole("button", { name: "Usar Groceries" }));
    await userEvent.click(screen.getByRole("button", { name: "Dividir con alguien" }));
    await userEvent.type(screen.getByLabelText("Nombre del nuevo invitado"), "Marta");
    await userEvent.click(screen.getByRole("button", { name: "Usar" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar y dividir" }));
    expect((await requests[0]!.json()).counterpart).toEqual({ kind: "GUEST", displayName: "Marta" });
  });

  it("refuses a category of the person's own, and the split can be removed", async () => {
    const { api, requests } = fakeApi({});
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "50000");
    await userEvent.click(screen.getByRole("button", { name: /Categoría/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Mine" }));
    await userEvent.click(screen.getByRole("button", { name: "Dividir con alguien" }));
    await userEvent.click(screen.getByRole("radio", { name: /Luis/ }));
    await userEvent.click(screen.getByRole("button", { name: "Seguir con Luis" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar y dividir" }));
    expect(screen.getByRole("button", { name: /Categoría/ })).toHaveAccessibleDescription(
      "Esta categoría es solo de tu espacio Personal. Elige una categoría predeterminada para dividir el gasto.",
    );
    expect(requests).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Quitar la división con Luis" }));
    expect(screen.getByRole("button", { name: "Guardar gasto" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/ui/direct` and `pnpm exec vitest run --project ui src/modules/ledger/ui/record/record-form-direct.test.tsx`
Expected: FAIL — the new modules do not exist; the form has no "Dividir con alguien".

- [ ] **Step 3: Implement**

`src/modules/ledger/ui/direct/counterparts.ts`:

```ts
import type { MemberDto, SpaceDto } from "@/shared/ui/api/dto";

/** HU-E1-13, ruling P172: someone to split one expense with. */
export interface Person {
  readonly memberId: string;
  readonly name: string;
  readonly isGuest: boolean;
  /** The name of the direct space the split will use, or null when the API creates one. */
  readonly directSpace: string | null;
}

/**
 * The people the recorder shares a space with: the other member of each direct space (a guest included, D15: a guest
 * exists only in its own space), then each registered co-member of a shared space once, unless a direct space already
 * holds them. Shared spaces' guests are left out: the API refuses them (InvalidDirectCounterpart).
 */
export const peopleOf = (input: {
  readonly meUserId: string;
  readonly spaces: readonly SpaceDto[];
  readonly membersBySpace: Readonly<Record<string, readonly MemberDto[]>>;
}): Person[] => {
  const people: Person[] = [];
  const covered = new Set<string>();
  for (const space of input.spaces.filter((s) => s.kind === "DIRECT")) {
    const other = (input.membersBySpace[space.id] ?? []).find((m) => m.userId !== input.meUserId);
    if (!other) continue;
    if (other.userId) covered.add(other.userId);
    people.push({ memberId: other.id, name: other.displayName, isGuest: other.kind === "GUEST", directSpace: space.name });
  }
  for (const space of input.spaces.filter((s) => s.kind === "SHARED"))
    for (const member of input.membersBySpace[space.id] ?? []) {
      if (member.userId === null || member.userId === input.meUserId || covered.has(member.userId)) continue;
      covered.add(member.userId);
      people.push({ memberId: member.id, name: member.displayName, isGuest: false, directSpace: null });
    }
  return people.sort((a, b) => a.name.localeCompare(b.name, "es"));
};
```

`src/modules/ledger/ui/direct/direct-request.ts`:

```ts
import { findCategory, type CategoryChoice } from "@/modules/categories/ui";
import type { CategoryGroupDto } from "@/shared/ui/api/dto";

export type DirectChoice =
  | { readonly kind: "MEMBER"; readonly memberId: string; readonly name: string }
  | { readonly kind: "GUEST"; readonly displayName: string };

/** D11, ruling P172: a category travels to the direct space by its catalog key; a person's own has none. */
export const categoryKeyOf = (groups: readonly CategoryGroupDto[], choice: CategoryChoice): string | null => {
  if (choice === null) return null;
  const sub = choice.subcategoryId ? findCategory(groups, choice.subcategoryId)?.category.key : null;
  return sub ?? findCategory(groups, choice.categoryId)?.category.key ?? null;
};

/** `POST /api/v1/direct-splits`: the expense's fields with the counterpart and the key in place of the category id. */
export const directBodyOf = (
  body: Record<string, unknown>,
  choice: DirectChoice,
  categoryKey: string,
): Record<string, unknown> => {
  const { categoryId: _categoryId, ...rest } = body;
  return {
    ...rest,
    counterpart:
      choice.kind === "MEMBER"
        ? { kind: "MEMBER", memberId: choice.memberId }
        : { kind: "GUEST", displayName: choice.displayName.trim() },
    categoryKey,
  };
};
```

(`findCategory` answers `{ category, parent, group }`.)

`split-with-person-sheet.tsx` (`"use client"`): a `Sheet` titled `ledger.direct.title` with the intro `ledger.direct.intro` (`currency`); a `ChoiceGroup` `layout="chips"` labelled `ledger.direct.people` whose options show the person's name (with `members.guestSuffix` for a guest) over its hint (`ledger.direct.existing` with `space`, `ledger.direct.guestOf` with `space` for a guest, `ledger.direct.new` otherwise); the note `ledger.direct.guestsNote`; `ledger.direct.newGuest` over a `TextField` `id="direct-guest"` labelled `ledger.direct.guestName` with a secondary button `ledger.direct.use` that calls `onChoose({ kind: "GUEST", displayName })` and closes (disabled while the name is blank); and the `lg` button `ledger.direct.continue` (`name`), enabled once someone is picked, which calls `onChoose({ kind: "MEMBER", memberId, name })` and closes.

`record-form.tsx`: props gain `readonly people?: readonly Person[];`; state `direct: DirectChoice | null` and `directError: boolean`; for an EXPENSE in a PERSONAL space with `people` given, under the account picker: when `direct` is null, a secondary button `ledger.direct.open` (the `users`-free `userPlus` icon) that opens `SplitWithPersonSheet` (loaded with `next/dynamic`, `ssr: false`); when set, a chip `ledger.direct.with` (`name`) and a 44 px icon button `ledger.direct.remove` (`name`) that clears it. The save button's label is `ledger.form.save.DIRECT` while `direct` is set. Submit with `direct`: build with `requestOf` as today; `const key = categoryKeyOf(live, category)`; when null, mark `directError` (the category's error reads `ledger.direct.noKey`) and stop; else `api.POST("/api/v1/direct-splits", { params: { header: { "idempotency-key": idempotencyKey } }, body: directBodyOf(built.body, direct, key) as never })`; on 201 `renew()`, `router.push(`/spaces/${data.spaceId}/transactions`)` and `router.refresh()`; a problem goes through `recordFieldOf` as for any expense (`InvalidDirectCounterpart` and `MemberNotFound` land in the form's `ProblemNotice`). The idempotency signature becomes `JSON.stringify({ body, direct })`, so choosing someone else makes a new key.

`record-form-container.tsx`: for a PERSONAL space, read `GET …/members` of every non-personal space of `getSpaces()` in parallel (one call each, server side) and pass `people={peopleOf({ meUserId: me!.id, spaces, membersBySpace })}`; a failed read of one space leaves its people out rather than failing the form.

Catalog keys, es / en: `ledger.direct.open` Dividir con alguien / Split with someone; `ledger.direct.title` Dividir con alguien / Split with someone; `ledger.direct.intro` El gasto queda en un espacio solo para ustedes dos. Si ya existe, se usa el mismo; si no, se crea en {currency}, la moneda de tu espacio Personal. / The expense goes to a space for just the two of you. If it exists it is reused; if not, it is created in {currency}, your Personal space's currency.; `ledger.direct.people` Personas con las que compartes un espacio / People you share a space with; `ledger.direct.existing` Ya tienen «{space}»: se usa ese / You already have "{space}": it is reused; `ledger.direct.new` Se crea un espacio para los dos / A space for the two of you is created; `ledger.direct.guestOf` De «{space}» / From "{space}"; `ledger.direct.guestsNote` Los invitados de un espacio compartido no aparecen aquí: solo existen en su espacio. / A shared space's guests are not listed here: they exist only in their space.; `ledger.direct.newGuest` O alguien que no usa Hearth / Or someone who does not use Hearth; `ledger.direct.guestName` Nombre del nuevo invitado / New guest's name; `ledger.direct.use` Usar / Use; `ledger.direct.continue` Seguir con {name} / Continue with {name}; `ledger.direct.with` Con {name} · mitad y mitad / With {name} · half each; `ledger.direct.remove` Quitar la división con {name} / Remove the split with {name}; `ledger.direct.noKey` Esta categoría es solo de tu espacio Personal. Elige una categoría predeterminada para dividir el gasto. / This category belongs only to your Personal space. Choose a default category to split the expense.; `ledger.form.save.DIRECT` Guardar y dividir / Save and split.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, `pnpm build`, `pnpm test:e2e`, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ledger/ui src/i18n/messages
git commit -m "feat(ledger): split an expense with someone from the personal space (Refs #74)"
```

Risk: none.

---

### Task 16: The @e2e scenarios of the shared expense

HU-E9-06's two `@e2e` scenarios, verbatim with the story's Background: "Equal split among the selected participants" and "The default split by allocation is preselected and can be overridden". Ana is the page's person; Juan is another person (Task 10); the Household, its category "Groceries", Ana's Bancolombia and the 2026-11 plan are seeded through the API. The browser's clock is fixed per scenario (ruling P178): 2026-10-31 12:00 Bogotá for the first (inside the server's current period, so the list shows the expense) and 2026-11-08 14:32 Bogotá for the second (the artboard's "8 nov · 14:32", inside the plan's period).

**Files:**
- Create: `tests/e2e/features/shared-expense.feature`, `tests/e2e/steps/shared.steps.ts`
- Modify: `tests/e2e/support/api.ts` (a `put` beside `post`, `patch` and `get`)

**Interfaces:**
- Consumes: Task 10's `World.person`, `sharedSpace`, `join`, `memberId`; M6a's `seedAccount`, `minor`, `shown`; Tasks 12–14.
- Produces: the steps "{string} is signed in and {string} has the members {string} and {string}" (signs Ana up, creates the Household as Ana, makes Juan join, creates "Groceries" in its `food` group and Ana's personal "Bancolombia" with 5,000,000 COP), reused by Task 20 in spirit (Task 20 seeds its own trip).

- [ ] **Step 1: Write the feature**

`tests/e2e/features/shared-expense.feature`:

```gherkin
Feature: Shared expense form

  Background:
    Given "Ana" is signed in and "Household" has the members "Ana" and "Juan"

  @e2e
  Scenario: Equal split among the selected participants
    When "Ana" enters "Groceries" for 300,000 COP paid from "Bancolombia" and selects "Ana" and "Juan" as participants
    Then the preview shows 150,000 COP for "Ana" and 150,000 COP for "Juan"
    And after saving, the expense appears in the "Household" transaction list

  @e2e
  Scenario: The default split by allocation is preselected and can be overridden
    Given the 2026-11 plan of "Household" is "ACTIVE" and "Groceries" maps to "Home" allocated "Ana" 40% and "Juan" 60%
    When "Ana" enters an expense of 2,000,000 COP in "Groceries" dated 2026-11-08
    Then the split "BY_ALLOCATION" is preselected with 800,000 COP for "Ana" and 1,200,000 COP for "Juan"
    And switching to "EQUAL" updates the preview to 1,000,000 COP each
```

- [ ] **Step 2: Write the steps**

`tests/e2e/steps/shared.steps.ts`:

```ts
import { expect, type Page } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures";
import { minor, shown } from "../support/money";
import type { World } from "../support/world";

const METHOD_KEYS: Record<string, string> = {
  BY_ALLOCATION: "ledger.split.methods.BY_ALLOCATION",
  EQUAL: "ledger.split.methods.EQUAL",
};
const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();
const cop = (pesos: string) => ({ amount: minor(pesos), currency: "COP" });
/** The page person's own row reads "<name> (tú)"; anyone else's their name. */
const labelOf = (world: World, name: string) => (name === world.user!.name ? world.t("members.you", { name }) : name);
const splitSheet = (page: Page, world: World) => page.getByRole("dialog", { name: world.t("ledger.split.title") });

Given(
  "{string} is signed in and {string} has the members {string} and {string}",
  async ({ page, world }, name: string, space: string, _a: string, other: string) => {
    await world.signUp(name);
    await world.seedAccount("Bancolombia", { type: "BANK", openingBalance: cop("5,000,000") });
    const { id } = (await world.api.post("/api/v1/spaces", { kind: "SHARED", name: space, currency: "COP" })) as { id: string };
    world.spaces.set(space, id);
    const juan = await world.person(other);
    const { url } = (await world.api.post(`/api/v1/spaces/${id}/invitations`, { kind: "LINK", role: "MEMBER" })) as { url: string };
    await juan.api.post(`/api/v1/invitations/${new URL(url).pathname.split("/").at(-1)}/accept`, {});
    const { items } = (await world.api.get(`/api/v1/spaces/${id}/categories`)) as { items: { id: string; key: string | null }[] };
    const food = items.find((g) => g.key === "food")!;
    const groceries = (await world.api.post(`/api/v1/spaces/${id}/categories`, {
      groupId: food.id, name: "Groceries", icon: { kind: "SYMBOL", name: "cart" }, color: "SAND",
    })) as { id: string };
    world.categories.set("Groceries", groceries.id);
    await page.clock.setFixedTime(new Date("2026-10-31T17:00:00Z"));
  },
);

const openForm = async (page: Page, world: World) => {
  await page.goto(`/spaces/${world.spaces.get("Household")}/new`);
  await expect(page.locator("[data-ready='true']")).toBeAttached();
};
const pick = async (page: Page, world: World, pesos: string, category: string) => {
  await page.getByLabel(world.t("ledger.form.amount")).fill(pesos.replaceAll(",", ""));
  await page.getByLabel(world.t("ledger.form.description")).fill(category);
  await page.getByRole("button", { name: new RegExp(world.t("ledger.form.category")) }).click();
  await page.getByRole("radio", { name: category }).click();
};
const shareOf = async (page: Page, world: World, name: string) =>
  norm(await splitSheet(page, world).getByRole("listitem", { name: labelOf(world, name) }).textContent());

When(
  /^"([^"]+)" enters "([^"]+)" for ([\d,]+) COP paid from "([^"]+)" and selects "([^"]+)" and "([^"]+)" as participants$/,
  async ({ page, world }, _n: string, category: string, pesos: string, account: string, a: string, b: string) => {
    await openForm(page, world);
    await pick(page, world, pesos, category);
    await page.getByRole("button", { name: new RegExp(world.t("ledger.split.payer")) }).click();
    const sheet = splitSheet(page, world);
    await sheet.getByRole("radiogroup", { name: world.t("ledger.split.from") }).getByRole("radio", { name: account }).click();
    await sheet.getByRole("radio", { name: world.t("ledger.split.methods.EQUAL") }).click();
    for (const name of [a, b]) await expect(sheet.getByRole("checkbox", { name: labelOf(world, name) })).toBeChecked();
  },
);

Then(
  /^the preview shows ([\d,]+) COP for "([^"]+)" and ([\d,]+) COP for "([^"]+)"$/,
  async ({ page, world }, ana: string, a: string, juan: string, b: string) => {
    expect(await shareOf(page, world, a)).toContain(norm(shown(ana)));
    expect(await shareOf(page, world, b)).toContain(norm(shown(juan)));
  },
);

Then(/^after saving, the expense appears in the "([^"]+)" transaction list$/, async ({ page, world }, space: string) => {
  await splitSheet(page, world).getByRole("button", { name: world.t("ledger.split.done") }).click();
  await page.getByRole("button", { name: world.t("ledger.form.save.EXPENSE") }).click();
  await expect(page).toHaveURL(`/spaces/${world.spaces.get(space)}/transactions`);
  const row = page.getByRole("listitem").filter({ hasText: "Groceries" });
  await expect(row).toContainText(world.t("ledger.paidBy", { name: world.user!.name }));
  expect(norm(await row.textContent())).toContain(norm(shown("300,000")));
});

Given(
  /^the (\d{4}-\d{2}) plan of "([^"]+)" is "ACTIVE" and "([^"]+)" maps to "([^"]+)" allocated "([^"]+)" (\d+)% and "([^"]+)" (\d+)%$/,
  async ({ world }, period: string, space: string, category: string, line: string, a: string, aPct: string, b: string, bPct: string) => {
    const spaceId = world.spaces.get(space)!;
    const base = `/api/v1/spaces/${spaceId}/plans`;
    const plan = (await world.api.post(base, { period })) as { id: string };
    // PROPORTIONAL (a new line's rule, HU-E6-05) over capacities in the story's ratio gives exactly its percents.
    const [anaId, juanId] = [await world.memberId(space, a), await world.memberId(space, b)];
    await world.api.put(`${base}/${plan.id}/capacities`, {
      capacities: [
        { memberId: anaId, amount: cop(String(Number(aPct) * 40_000)) },
        { memberId: juanId, amount: cop(String(Number(bPct) * 40_000)) },
      ],
    });
    const withLine = (await world.api.post(`${base}/${plan.id}/lines`, {
      name: line, plannedAmount: cop("1,470,000"), funding: "DIRECT", rolloverMode: "RESET",
    })) as { lines: { id: string; name: string }[] };
    const lineId = withLine.lines.find((l) => l.name === line)!.id;
    await world.api.put(`${base}/${plan.id}/lines/${lineId}/categories`, { categoryIds: [world.categories.get(category)!] });
    await world.api.post(`${base}/${plan.id}/activate`, {});
  },
);

When(
  /^"([^"]+)" enters an expense of ([\d,]+) COP in "([^"]+)" dated (\d{4}-\d{2}-\d{2})$/,
  async ({ page, world }, _n: string, pesos: string, category: string, date: string) => {
    await page.clock.setFixedTime(new Date(`${date}T19:32:00Z`));
    await openForm(page, world);
    await pick(page, world, pesos, category);
  },
);

Then(
  /^the split "([^"]+)" is preselected with ([\d,]+) COP for "([^"]+)" and ([\d,]+) COP for "([^"]+)"$/,
  async ({ page, world }, method: string, ana: string, a: string, juan: string, b: string) => {
    const row = page.getByRole("button", { name: new RegExp(world.t("ledger.split.split")) });
    await expect(row).toContainText(world.t(METHOD_KEYS[method]!));
    await row.click();
    await expect(splitSheet(page, world).getByRole("radio", { name: world.t(METHOD_KEYS[method]!) })).toBeChecked();
    expect(await shareOf(page, world, a)).toContain(norm(shown(ana)));
    expect(await shareOf(page, world, b)).toContain(norm(shown(juan)));
  },
);

Then(/^switching to "([^"]+)" updates the preview to ([\d,]+) COP each$/, async ({ page, world }, method: string, each: string) => {
  await splitSheet(page, world).getByRole("radio", { name: world.t(METHOD_KEYS[method]!) }).click();
  for (const name of ["Ana", "Juan"]) expect(await shareOf(page, world, name)).toContain(norm(shown(each)));
});
```

`tests/e2e/support/api.ts`: `send`'s method type becomes `"GET" | "POST" | "PATCH" | "PUT"` and `SeedApi` gains `put = (path: string, body: unknown) => this.send("PUT", path, body);`. The capacities are 1,600,000 and 2,400,000 COP (40 and 60 times 40,000), the acceptance suite's reference plan, whose Home line of 1,470,000 fits them; `world.memberId` reads the Household through Ana's session.

- [ ] **Step 3: Run them and see them bite**

Run: `pnpm build && pnpm test:e2e`.
Expected: PASS. To see the second scenario bite, make `SharedFields` ignore the default (comment out the effect that applies it) locally: "the split BY_ALLOCATION is preselected" fails on the row's text; revert and rebuild.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e
git commit -m "test(web): record a shared expense split equally and by the plan, end to end (Refs #74)"
```

Risk: none.

---
### Task 17: The balances screen

The Balances artboard at `/spaces/{spaceId}/balances`, the Saldos tab's screen (scenario "Balances show who owes whom", ruling P173): the viewer's own net as a sentence ("Te deben $ 150.000", "Debes $ 100.000", "Estás a paz y salvo"), the API's settle-up suggestions as sentences with the members' names ("Juan le debe $ 150.000 a Ana", the story's "Juan owes Ana 150,000 COP"), and every current member's net, each row linking to that member's history (Task 18). Suggestion and member sentences always use names, never "you", so the story's sentences read the same from every seat; only the header speaks to the viewer. Task 19 adds the settle-up actions.

**Files:**
- Create: `src/modules/balances/ui/{balances-screen.tsx, balances.test.tsx, balances-container.tsx, balances-container.test.tsx, server.ts}`, `src/app/(web)/(app)/spaces/[spaceId]/balances/page.tsx`
- Modify: `src/modules/balances/ui/index.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `netState`, `absolute`, `memberSentence` (Task 8, `balances/ui/net-state.ts`); `memberLabel` (`@/modules/spaces/ui`); `BalancesDto`, `SuggestionDto`, `MemberDto`; `formatMoney`; `loaded`, `serverApi`, `getMe`, `getSpaces`.
- Produces: `loadBalances(api: Api, input: { spaceId: string }): Promise<Loaded<{ members: MemberDto[]; balances: BalancesDto["members"]; suggestions: SuggestionDto[] }>>`; `BalancesScreen({ space, members, meUserId, balances, suggestions, formats })` (client from Task 19 on; server-renderable here); `BalancesContainer({ spaceId })` (server; a personal space is `notFound()`), exported from `balances/ui/server.ts`; the page.

- [ ] **Step 1: Write the failing tests**

`src/modules/balances/ui/balances.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { cop, guestDto, householdSpace, memberDto, normalized } from "../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { BalancesScreen } from "./balances-screen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const ANA = memberDto();
const JUAN = memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" });
const LUIS = memberDto({ id: "m-luis", userId: "u-luis", displayName: "Luis", role: "MEMBER" });
const net = (memberId: string, pesos: number) => ({ memberId, net: cop(pesos) });
const view = (props: Partial<Parameters<typeof BalancesScreen>[0]> = {}, locale: "es" | "en" = "es") =>
  renderWithIntl(
    <BalancesScreen space={householdSpace({ role: "MEMBER" })} members={[ANA, JUAN]} meUserId="u-juan"
      balances={[net("m-ana", 150_000), net("m-juan", -150_000)]}
      suggestions={[{ payerMemberId: "m-juan", receivingMemberId: "m-ana", amount: cop(150_000) }]}
      formats={BUILT_IN_FORMATS} {...(props as object)} />,
    { locale },
  );

describe("balances screen (HU-E9-07, ruling P173)", () => {
  it("shows Juan that he owes Ana 150,000 COP", async () => {
    const { container } = view();
    expect(screen.getByRole("heading", { level: 1, name: "Saldos" })).toBeInTheDocument();
    expect(normalized(screen.getByRole("region", { name: "Tu saldo en Household" }).textContent)).toContain("Debes $ 150.000");
    const suggestions = screen.getByRole("region", { name: "Para quedar a paz y salvo" });
    expect(normalized(suggestions.textContent)).toContain("Juan le debe $ 150.000 a Ana");
    const members = screen.getByRole("region", { name: "Cada miembro" });
    expect(within(members).getByRole("link", { name: "Ana: le deben $ 150.000. Ver historial" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/members/m-ana/history",
    );
    expect(within(members).getByRole("link", { name: "Juan (tú): debe $ 150.000. Ver historial" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("reads the same sentences in English", () => {
    view({}, "en");
    expect(normalized(screen.getByRole("region", { name: "Your balance in Household" }).textContent)).toContain("You owe $ 150.000");
    expect(normalized(screen.getByRole("region", { name: "To settle up" }).textContent)).toContain("Juan owes Ana $ 150.000");
  });

  it("lists one suggestion per payment of the trip, and the guest with its suffix", () => {
    view({
      members: [ANA, JUAN, LUIS, guestDto()],
      meUserId: "u-ana",
      balances: [net("m-ana", 150_000), net("m-juan", -100_000), net("m-luis", -50_000), net("m-pedro", 0)],
      suggestions: [
        { payerMemberId: "m-juan", receivingMemberId: "m-ana", amount: cop(100_000) },
        { payerMemberId: "m-luis", receivingMemberId: "m-ana", amount: cop(50_000) },
      ],
    });
    expect(normalized(screen.getByRole("region", { name: "Tu saldo en Household" }).textContent)).toContain("Te deben $ 150.000");
    const suggestions = within(screen.getByRole("region", { name: "Para quedar a paz y salvo" })).getAllByRole("listitem");
    expect(suggestions).toHaveLength(2);
    expect(normalized(suggestions[0]!.textContent)).toContain("Juan le debe $ 100.000 a Ana");
    expect(normalized(suggestions[1]!.textContent)).toContain("Luis le debe $ 50.000 a Ana");
    expect(screen.getByRole("link", { name: "Pedro (invitado): a paz y salvo. Ver historial" })).toBeInTheDocument();
  });

  it("says when nobody owes anybody", () => {
    view({ balances: [net("m-ana", 0), net("m-juan", 0)], suggestions: [] });
    expect(normalized(screen.getByRole("region", { name: "Tu saldo en Household" }).textContent)).toContain("Estás a paz y salvo");
    expect(screen.getByText("Nadie le debe a nadie en Household.")).toBeInTheDocument();
  });
});
```

`src/modules/balances/ui/balances-container.test.tsx` (the same pass-through `loaded` mock as `members-container.test.tsx`):

```tsx
describe("loadBalances (HU-E9-07)", () => {
  it("reads the members, the balances and the suggestions of the space together", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [memberDto()] }),
      "GET /api/v1/spaces/{spaceId}/balances": () => jsonResponse({ members: [{ memberId: "m-ana", net: cop(0) }] }),
      "GET /api/v1/spaces/{spaceId}/balances/suggestions": () => jsonResponse({ suggestions: [] }),
    });
    expect(await loadBalances(api, { spaceId: "sp-household" })).toEqual({
      ok: true,
      data: { members: [memberDto()], balances: [{ memberId: "m-ana", net: cop(0) }], suggestions: [] },
    });
    expect(requests).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project ui src/modules/balances/ui`
Expected: FAIL — `Cannot find module './balances-screen'` and `'./balances-container'`.

- [ ] **Step 3: Implement**

`balances-container.tsx` (server): `loadBalances` reads `GET …/members`, `GET …/balances` and `GET …/balances/suggestions` in one `Promise.all` through `loaded`, answering the first problem or `{ members: items, balances: members, suggestions }`. `BalancesContainer({ spaceId })`: `getMe()`, `getSpaces()`; an unknown or PERSONAL space is `notFound()`; then `<BalancesScreen space={space} members={…} meUserId={me!.id} balances={…} suggestions={…} formats={me!.preferences.effective} />`, or a `ProblemNotice`. `balances/ui/server.ts` exports `BalancesContainer` (with the P153 header comment of the other `server.ts` files).

`balances-screen.tsx`: `const names = new Map(members.map((m) => [m.id, m.displayName]))`; `const netOf = (id: string) => balances.find((b) => b.memberId === id)?.net ?? { amount: "0", currency: space.currency }`; the viewer is `members.find((m) => m.userId === meUserId)`. Markup, following the artboard:
- an `h1` `balances.title` (visually hidden, like the Home's: the space chip names the screen);
- a `section aria-label={t("yours", { space: space.name })}` whose big line is `balances.you.<state>` with `amount` = `formatMoney(absolute(net), formats)`;
- a `section` labelled by its `h2` `balances.suggestions`: an `<ol>` with one `<li>` per suggestion showing `Avatar` of the payer and `balances.owes` (`payer`, `receiver` = the stored names, `amount` = `formatMoney(s.amount, formats)`), then the note `balances.suggestionsNote`; when there is none, `balances.allSettled` (`space`) instead of the list and the note;
- a `section` labelled by its `h2` `balances.members`: an `<ul>` of `Link`s to `/spaces/<space>/members/<member>/history`, each with `aria-label` = `balances.member.link` (`name` = `memberLabel(member, meUserId, tMembers)`, `sentence` = `memberSentence(netOf(member.id), formats, t)`), showing the label and the sentence (`text-owe` when the member owes, `text-accent` when owed).

The page `src/app/(web)/(app)/spaces/[spaceId]/balances/page.tsx` titles itself `balances.title` and renders `<div className="mx-auto max-w-[720px] py-4"><BalancesContainer spaceId={spaceId} /></div>` (Task 19 passes `settle`).

Catalog keys (`balances`), es / en: `title` Saldos / Balances; `yours` Tu saldo en {space} / Your balance in {space}; `you.owes` Debes {amount} / You owe {amount}; `you.owed` Te deben {amount} / You are owed {amount}; `you.settled` Estás a paz y salvo / You are settled up; `suggestions` Para quedar a paz y salvo / To settle up; `owes` {payer} le debe {amount} a {receiver} / {payer} owes {receiver} {amount}; `suggestionsNote` Sugerencia con el menor número de pagos. Liquidar solo prellena el formulario. / The fewest payments that settle everyone. Settle only fills in the form.; `allSettled` Nadie le debe a nadie en {space}. / Nobody owes anybody in {space}.; `members` Cada miembro / Each member; `member.link` {name}: {sentence}. Ver historial / {name}: {sentence}. See history. (`member.owes`, `member.owed` and `member.settled` are Task 8's.)

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's command, `pnpm build`, `pnpm test:e2e`, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/balances/ui "src/app/(web)/(app)/spaces/[spaceId]/balances" src/i18n/messages
git commit -m "feat(balances): show who owes whom and the settle-up suggestions of a space (Refs #75)"
```

Risk: none.

---

### Task 18: A member's balance history

The BalanceHistory artboard at `/spaces/{spaceId}/members/{memberId}/history` (scenario "Balance history per member", ruling P176): the member's net at the start and at the end of a period of the space, and each movement that changed it — date, description (or the type's name), how much it changed it and the running balance after it, as sentences. The range is a period of the space: the current one by default, others through `?from=<date>` (the period containing that date), with previous and next links read from `GET …/periods` like the transaction list (P130). The API's entries carry no payer or amount, so an entry's title is its description, not the artboard's "Ana pagó $ 300.000" (a deviation).

**Files:**
- Create: `src/modules/balances/ui/{balance-history.tsx, history-container.tsx, balance-history.test.tsx, history-container.test.tsx}`, `src/app/(web)/(app)/spaces/[spaceId]/members/[memberId]/history/page.tsx`
- Modify: `src/modules/balances/ui/server.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `memberSentence`, `BalanceHistoryDto`, `PeriodDto`, `MemberDto`, `addDays`, `formatDate`, `formatMoney`, `loaded`.
- Produces: `loadBalanceHistory(api: Api, input: { spaceId: string; memberId: string; from?: string }): Promise<Loaded<{ member: MemberDto | null; period: PeriodDto; previous: PeriodDto | null; next: PeriodDto | null; history: BalanceHistoryDto }>>`; `BalanceHistory({ spaceId, spaceName, member, period, previous, next, history, formats })`; `HistoryContainer({ spaceId, memberId, from? })` (a member who is not a current one is `notFound()`).

- [ ] **Step 1: Write the failing tests**

`src/modules/balances/ui/balance-history.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { cop, memberDto, normalized } from "../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { BalanceHistory } from "./balance-history";

const JUAN = memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" });
const OCTOBER = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };
// The story: Ana paid 300,000 EQUAL on 2026-10-03, Juan paid 100,000 EQUAL on 2026-10-10, Juan settled 100,000 on 2026-10-30.
const HISTORY = {
  memberId: "m-juan", from: "2026-10-01", to: "2026-10-31", opening: cop(0), closing: cop(0),
  entries: [
    { transactionId: "t-1", type: "EXPENSE" as const, date: "2026-10-03", description: "Mercado", change: cop(-150_000), balance: cop(-150_000) },
    { transactionId: "t-2", type: "EXPENSE" as const, date: "2026-10-10", description: "Cena", change: cop(50_000), balance: cop(-100_000) },
    { transactionId: "t-3", type: "SETTLEMENT" as const, date: "2026-10-30", description: "", change: cop(100_000), balance: cop(0) },
  ],
};

describe("balance history (HU-E9-07, ruling P176)", () => {
  it("shows Juan's running balances of -150,000, -100,000 and 0 COP", async () => {
    const { container } = renderWithIntl(
      <BalanceHistory spaceId="sp-household" spaceName="Household" member={JUAN} period={OCTOBER}
        previous={{ label: "2026-09", startDate: "2026-09-01", endDate: "2026-09-30" }} next={null}
        history={HISTORY} formats={BUILT_IN_FORMATS} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Historial de Juan" })).toBeInTheDocument();
    expect(screen.getByText("1/10/2026 – 31/10/2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Período anterior" })).toHaveAttribute("href", "/spaces/sp-household/members/m-juan/history?from=2026-09-01");
    expect(screen.queryByRole("link", { name: "Período siguiente" })).not.toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Saldo al inicio y al final" });
    expect(normalized(summary.textContent)).toContain("Al empezara paz y salvo");
    const rows = within(screen.getByRole("region", { name: "Movimientos que cambian su saldo" })).getAllByRole("listitem");
    expect(rows.map((r) => normalized(r.textContent))).toEqual([
      "3/10/2026Mercadodebe $ 150.000−$ 150.000",
      "10/10/2026Cenadebe $ 100.000+$ 50.000",
      "30/10/2026Pago entre miembrosa paz y salvo+$ 100.000",
    ]);
    expect(screen.getByRole("link", { name: "Volver a Saldos" })).toHaveAttribute("href", "/spaces/sp-household/balances");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("says when nothing changed the balance in the period", () => {
    renderWithIntl(
      <BalanceHistory spaceId="sp-household" spaceName="Household" member={JUAN} period={OCTOBER} previous={null} next={null}
        history={{ ...HISTORY, entries: [] }} formats={BUILT_IN_FORMATS} />,
    );
    expect(screen.getByText("Nada cambió su saldo en este período.")).toBeInTheDocument();
  });
});
```

`src/modules/balances/ui/history-container.test.tsx` (pass-through `loaded` mock):

```tsx
describe("loadBalanceHistory (ruling P176)", () => {
  it("reads the period holding `from`, its neighbours and the member's movements within it", async () => {
    const periods = { "2026-10-15": OCTOBER, "2026-09-30": SEPTEMBER, "2026-11-01": NOVEMBER } as Record<string, unknown>;
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": (r) => jsonResponse({ items: [periods[new URL(r.url).searchParams.get("from")!]] }),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [JUAN] }),
      "GET /api/v1/spaces/{spaceId}/members/{memberId}/balance-history": () => jsonResponse(HISTORY),
    });
    const result = await loadBalanceHistory(api, { spaceId: "sp-household", memberId: "m-juan", from: "2026-10-15" });
    expect(result).toMatchObject({ ok: true, data: { member: JUAN, period: OCTOBER, previous: SEPTEMBER, next: NOVEMBER } });
    const history = requests.find((r) => r.url.includes("balance-history"))!;
    expect(Object.fromEntries(new URL(history.url).searchParams)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
});
```

(`OCTOBER`, `SEPTEMBER` and `NOVEMBER` are period literals like the one in the component test, `HISTORY` the same history.)

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project ui src/modules/balances/ui`
Expected: FAIL — the new modules do not exist.

- [ ] **Step 3: Implement**

`history-container.tsx` (server): `loadBalanceHistory` reads `GET …/periods` with `{ from, count: 1 }` (no `from` for the current period) and `GET …/members` in parallel; with the period's dates it reads `GET …/members/{memberId}/balance-history` `{ from: startDate, to: endDate }` and the neighbours (`periods` from the day before the start and the day after the end, `count: 1`, `null` on a failure), like `loadTransactionList`. `member` is the current member with that id, else null. `HistoryContainer` renders `notFound()` for a null member or a space that is not listed, a `ProblemNotice` for a problem, else `BalanceHistory`. Exported from `balances/ui/server.ts`.

`balance-history.tsx` (server-renderable): a 48 px back `Link` with the `back` icon and `aria-label` `balances.history.back` to `/spaces/<space>/balances`; the `h1` `balances.history.title` (`name` = the stored name) with the space's name under it; a range row with the previous link (`balances.history.previous`, the `back` icon, `?from=<previous.startDate>`), the text `balances.history.range` (`start`, `end` formatted) and the next link (`balances.history.next`), each link rendered only when its period exists; a `section aria-label={t("history.summary")}` with `balances.history.opening` over `memberSentence(history.opening)` and `balances.history.closing` over `memberSentence(history.closing)`; a `section` labelled by its `h2` `balances.history.entries` with an `<ol>` of entries, each showing `formatDate(entry.date)`, the description or `ledger.type.<TYPE>`, then on the right the running balance's `memberSentence` over the change (`+` and `formatMoney` for a positive change, `formatMoney` alone otherwise, which writes U+2212); `balances.history.empty` when there is none; and the note `balances.history.note`.

The page `…/members/[memberId]/history/page.tsx` reads `params` and `?from=` and renders `HistoryContainer`; its title is `balances.history.pageTitle`.

Catalog keys (`balances.history`), es / en: `pageTitle` Historial de saldo / Balance history; `title` Historial de {name} / {name}'s history; `back` Volver a Saldos / Back to Balances; `previous` Período anterior / Previous period; `next` Período siguiente / Next period; `range` {start} – {end} / {start} – {end}; `summary` Saldo al inicio y al final / Balance at the start and at the end; `opening` Al empezar / At the start; `closing` Al terminar / At the end; `entries` Movimientos que cambian su saldo / Movements that changed their balance; `empty` Nada cambió su saldo en este período. / Nothing changed their balance in this period.; `note` A la derecha, el saldo después de cada movimiento y debajo cuánto cambió. / On the right, the balance after each movement and, under it, how much it changed.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's command, `pnpm build`, `pnpm test:e2e`, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/balances/ui "src/app/(web)/(app)/spaces/[spaceId]/members/[memberId]" src/i18n/messages
git commit -m "feat(balances): show a member's running balance over a period (Refs #75)"
```

Risk: none.

---

### Task 19: Settle up from a suggestion, or record any payment

The SettleUp artboard as a sheet of the balances screen (scenarios "Settle up from a suggestion" at component level, "Record a partial settlement" and "Settlement paid by a guest has no account field"; rulings P174 and P175). **Liquidar** on a suggestion only prefills the sheet (payer, receiver, amount); **Registrar pago** opens it with the viewer as receiver; `?settle=<memberId>` opens it with that member as payer and their suggestion's amount, which is how the guest sheet's "Registrar pago" arrives (added here to Task 8's OutstandingBalance notice). The sheet chooses who pays and who receives among the current members, the amount (a partial one is fine; the note says paying more flips the debt), the source account only when the viewer pays (their own accounts, optional) and the receiving account only when the viewer receives (optional); a guest pays without any account. It records now, in the browser's zone (no date picker in v1), with one `Idempotency-Key` per draft, through `POST …/settlements`, then refreshes the screen.

**Files:**
- Create: `src/modules/balances/ui/{settlement-request.ts, settlement-request.test.ts, settle-up-sheet.tsx, settle-up.test.tsx}`
- Modify: `src/modules/balances/ui/{balances-screen.tsx, balances-container.tsx}`, `src/app/(web)/(app)/spaces/[spaceId]/balances/page.tsx`, `src/modules/spaces/ui/members/{guest-sheet.tsx, members-guests.test.tsx}`, `src/modules/ledger/ui/index.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `useIdempotencyKey`, `sharedContextOf` (exported from `@/modules/ledger/ui` here: the accounts the viewer owns, never re-derived), `parseDecimal`, `minorOf`, `decimalOf`, `formatNumber`, `nowIn`, `occurredAtOf`, `browserTimeZone`, `memberLabel`, `ChoiceGroup`, `TextField`, `Sheet`, `ProblemNotice`.
- Produces: `interface SettlementDraft { payerMemberId: string | null; receivingMemberId: string | null; amount: string; sourceAccountId: string | null; destinationAccountId: string | null }`; `type SettlementField = "payer" | "receiver" | "amount"`; `settlementRequestOf(draft, input: { currency; numberFormat; meMemberId: string; when: { date: string; occurredAt: string; timeZone: string } }): { ok: true; body: Record<string, unknown> } | { ok: false; field: SettlementField }`; `settlementFieldOf(problem: Problem): SettlementField | "form"`; `prefillOf(input: { suggestion: SuggestionDto | null; payerMemberId?: string | null; meMemberId: string; currency: string; numberFormat: NumberFormat }): SettlementDraft`; `SettleUpSheet({ open, onOpenChange, space, members, meUserId, myAccounts, suggestions, initial, formats, timeZone?, api? })` (`timeZone` defaults to `browserTimeZone()`, as in the record form); `BalancesScreen` gains `myAccounts?: readonly AccountDto[]` (default `[]`, so Task 17's tests render unchanged), `settle?: string`, `timeZone?: string` and `api?`; `BalancesContainer({ spaceId, settle? })` also reads the viewer's accounts.

- [ ] **Step 1: Write the failing tests**

`src/modules/balances/ui/settlement-request.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { prefillOf, settlementFieldOf, settlementRequestOf, type SettlementDraft } from "./settlement-request";

const WHEN = { date: "2026-10-31", occurredAt: "2026-10-31T17:00:00.000Z", timeZone: "America/Bogota" };
const input = { currency: "COP", numberFormat: "DOT_COMMA" as const, meMemberId: "m-juan", when: WHEN };
const draft = (overrides: Partial<SettlementDraft> = {}): SettlementDraft => ({
  payerMemberId: "m-juan", receivingMemberId: "m-ana", amount: "100.000", sourceAccountId: null, destinationAccountId: null, ...overrides,
});

describe("settlement request (HU-E9-07, ruling P174)", () => {
  it("records a payment now from the payer to the receiver", () => {
    expect(settlementRequestOf(draft(), input)).toEqual({
      ok: true,
      body: { ...WHEN, amount: { amount: "10000000", currency: "COP" }, payerMemberId: "m-juan", receivingMemberId: "m-ana" },
    });
  });

  it("names the viewer's own accounts only on the viewer's side, and none for anyone else", () => {
    const mine = settlementRequestOf(draft({ sourceAccountId: "a-davi", destinationAccountId: "a-x" }), input);
    expect(mine.ok && mine.body).toMatchObject({ sourceAccountId: "a-davi" });
    expect(mine.ok && mine.body).not.toHaveProperty("destinationAccountId");
    const guest = settlementRequestOf(draft({ payerMemberId: "m-pedro", receivingMemberId: "m-juan", sourceAccountId: "a-davi", destinationAccountId: "a-davi" }), input);
    expect(guest.ok && guest.body).not.toHaveProperty("sourceAccountId");
    expect(guest.ok && guest.body).toMatchObject({ destinationAccountId: "a-davi" });
  });

  it("refuses what it cannot send and maps the API's codes to their fields", () => {
    expect(settlementRequestOf(draft({ payerMemberId: null }), input)).toEqual({ ok: false, field: "payer" });
    expect(settlementRequestOf(draft({ receivingMemberId: "m-juan" }), input)).toEqual({ ok: false, field: "receiver" });
    expect(settlementRequestOf(draft({ amount: "cien" }), input)).toEqual({ ok: false, field: "amount" });
    const p = (code: string, path?: string) => ({ code, status: 422, requestId: "r", errors: path ? [{ path, message: "x" }] : [], field: null });
    expect(settlementFieldOf(p("InvalidAmount"))).toBe("amount");
    expect(settlementFieldOf(p("InvalidSettlementParties"))).toBe("receiver");
    expect(settlementFieldOf(p("GuestHasNoAccounts"))).toBe("payer");
    expect(settlementFieldOf(p("ValidationFailed", "receivingMemberId"))).toBe("receiver");
    expect(settlementFieldOf(p("IdempotencyKeyConflict"))).toBe("form");
  });

  it("prefills a suggestion's payer, receiver and amount in the person's format", () => {
    const suggestion = { payerMemberId: "m-juan", receivingMemberId: "m-ana", amount: { amount: "10000000", currency: "COP" } };
    expect(prefillOf({ suggestion, meMemberId: "m-juan", currency: "COP", numberFormat: "DOT_COMMA" })).toEqual(draft());
    expect(prefillOf({ suggestion: null, meMemberId: "m-ana", currency: "COP", numberFormat: "DOT_COMMA" })).toEqual(
      draft({ payerMemberId: null, receivingMemberId: "m-ana", amount: "" }),
    );
    expect(prefillOf({ suggestion: null, payerMemberId: "m-pedro", meMemberId: "m-ana", currency: "COP", numberFormat: "DOT_COMMA" })).toMatchObject({
      payerMemberId: "m-pedro", receivingMemberId: "m-ana",
    });
  });
});
```

`src/modules/balances/ui/settle-up.test.tsx` (the `BalancesScreen` of Task 17's test with `myAccounts`, `api` and an optional `settle`; `vi.useFakeTimers({ toFake: ["Date"] })` at 2026-10-31T17:00:00Z):

```tsx
const TRIP = householdSpace({ id: "sp-trip", name: "Viaje 2026", role: "MEMBER" });
const MEMBERS = [ANA, JUAN, LUIS, guestDto()];
const TRIP_BALANCES = [net("m-ana", 150_000), net("m-juan", -100_000), net("m-luis", -50_000), net("m-pedro", 0)];
const SUGGESTIONS = [
  { payerMemberId: "m-juan", receivingMemberId: "m-ana", amount: cop(100_000) },
  { payerMemberId: "m-luis", receivingMemberId: "m-ana", amount: cop(50_000) },
];
const DAVI = accountDto({ id: "a-davi", name: "Davivienda", ownerUserId: "u-juan" });
const BANK = accountDto({ id: "a-bank", name: "Bancolombia", ownerUserId: "u-ana" });
const settled = () => jsonResponse(transactionDto({ id: "t-s", type: "SETTLEMENT" }), 201);
const screenAs = (meUserId: string, api: Api, settle?: string) =>
  renderWithIntl(
    <BalancesScreen space={TRIP} members={MEMBERS} meUserId={meUserId} balances={TRIP_BALANCES} suggestions={SUGGESTIONS}
      myAccounts={meUserId === "u-juan" ? [DAVI] : [BANK]} formats={BUILT_IN_FORMATS} settle={settle}
      timeZone="America/Bogota" api={api} />,
  );
const dialog = () => screen.getByRole("dialog", { name: "Registrar pago" });

describe("settle up (HU-E9-07, rulings P174 and P175)", () => {
  it("prefills the form from Juan's suggestion and records 100,000 COP from Juan to Ana once", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/settlements": settled });
    screenAs("u-juan", api);
    await userEvent.click(screen.getByRole("button", { name: "Liquidar: Juan le paga $ 100.000 a Ana" }));
    expect(within(dialog()).getByRole("radiogroup", { name: "Quién paga" })).toBeInTheDocument();
    expect(within(within(dialog()).getByRole("radiogroup", { name: "Quién paga" })).getByRole("radio", { name: "Juan (tú)" })).toBeChecked();
    expect(within(within(dialog()).getByRole("radiogroup", { name: "Quién recibe" })).getByRole("radio", { name: "Ana" })).toBeChecked();
    expect(within(dialog()).getByLabelText("Monto")).toHaveValue("100.000");
    expect(normalized(within(dialog()).getByText(/le debe/).textContent)).toContain(
      "Juan le debe $ 100.000 a Ana. Puedes registrar un pago parcial; si pagas de más, la deuda cambia de lado.",
    );
    await userEvent.dblClick(within(dialog()).getByRole("button", { name: "Guardar pago" }));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await requests[0]!.json()).toEqual({
      date: "2026-10-31", occurredAt: "2026-10-31T17:00:00.000Z", timeZone: "America/Bogota",
      amount: { amount: "10000000", currency: "COP" }, payerMemberId: "m-juan", receivingMemberId: "m-ana",
    });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("records a partial payment of 500,000 COP", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/settlements": settled });
    screenAs("u-juan", api);
    await userEvent.click(screen.getByRole("button", { name: "Liquidar: Juan le paga $ 100.000 a Ana" }));
    await userEvent.clear(within(dialog()).getByLabelText("Monto"));
    await userEvent.type(within(dialog()).getByLabelText("Monto"), "50.000");
    await userEvent.click(within(dialog()).getByRole("radio", { name: "Davivienda" }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Guardar pago" }));
    expect(await requests[0]!.json()).toMatchObject({ amount: { amount: "5000000" }, sourceAccountId: "a-davi" });
  });

  it("hides the source account when the guest Pedro pays", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/settlements": settled });
    screenAs("u-ana", api);
    await userEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    await userEvent.click(within(within(dialog()).getByRole("radiogroup", { name: "Quién paga" })).getByRole("radio", { name: "Pedro (invitado)" }));
    expect(within(dialog()).getByText("Pedro es invitado: pagó fuera de la app, así que no hay cuenta de origen.")).toBeInTheDocument();
    expect(within(dialog()).queryByRole("radiogroup", { name: "Sale de (opcional)" })).not.toBeInTheDocument();
    expect(within(dialog()).getByRole("radiogroup", { name: "Llega a (opcional)" })).toBeInTheDocument();
    await userEvent.type(within(dialog()).getByLabelText("Monto"), "100.000");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Guardar pago" }));
    const body = await requests[0]!.json();
    expect(body).toMatchObject({ payerMemberId: "m-pedro", receivingMemberId: "m-ana" });
    expect(body).not.toHaveProperty("sourceAccountId");
  });

  it("refuses a payment to oneself without sending it", async () => {
    const { api, requests } = fakeApi({});
    screenAs("u-ana", api);
    await userEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    await userEvent.click(within(within(dialog()).getByRole("radiogroup", { name: "Quién paga" })).getByRole("radio", { name: "Ana (tú)" }));
    await userEvent.type(within(dialog()).getByLabelText("Monto"), "1.000");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Guardar pago" }));
    expect(within(dialog()).getByText("Quien paga y quien recibe deben ser personas distintas.")).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it("opens prefilled for the member named by ?settle=", () => {
    screenAs("u-ana", fakeApi({}).api, "m-luis");
    expect(within(within(dialog()).getByRole("radiogroup", { name: "Quién paga" })).getByRole("radio", { name: "Luis" })).toBeChecked();
    expect(within(dialog()).getByLabelText("Monto")).toHaveValue("50.000");
  });
});
```

(`ANA`, `JUAN`, `LUIS`, `net`, `router` and the imports as in `balances.test.tsx`, plus `accountDto`, `transactionDto`, `fakeApi`, `jsonResponse`, `userEvent`, `waitFor`. The radio "Juan (tú)" reads its label through `memberLabel`. The zone is passed, like the record form's tests do, so the date does not depend on the machine's zone.)

`members-guests.test.tsx`, in "refuses to remove Pedro while he owes 100,000 COP": add `expect(within(alert).getByRole("link", { name: "Registrar pago" })).toHaveAttribute("href", "/spaces/sp-household/balances?settle=m-pedro");`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/balances/ui/settlement-request.test.ts` and `pnpm exec vitest run --project ui src/modules/balances/ui src/modules/spaces/ui/members/members-guests.test.tsx`
Expected: FAIL — the new modules do not exist; no "Liquidar" or "Registrar pago" buttons; no link in the guest's notice.

- [ ] **Step 3: Implement**

`src/modules/balances/ui/settlement-request.ts`:

```ts
import type { Problem } from "@/shared/ui/api/problem";
import type { SuggestionDto } from "@/shared/ui/api/dto";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import { decimalOf, formatNumber, type NumberFormat } from "@/shared/ui/format/formatters";

export interface SettlementDraft {
  readonly payerMemberId: string | null;
  readonly receivingMemberId: string | null;
  /** As typed, in the person's number format. */
  readonly amount: string;
  readonly sourceAccountId: string | null;
  readonly destinationAccountId: string | null;
}
export type SettlementField = "payer" | "receiver" | "amount";

/**
 * HU-E5-02, ruling P174: a settlement recorded now. An account is named only on the viewer's own side, where it is one
 * of theirs (D9: only its owner debits it); a guest pays and receives without one (D15).
 */
export const settlementRequestOf = (
  draft: SettlementDraft,
  input: {
    readonly currency: string;
    readonly numberFormat: NumberFormat;
    readonly meMemberId: string;
    readonly when: { readonly date: string; readonly occurredAt: string; readonly timeZone: string };
  },
): { ok: true; body: Record<string, unknown> } | { ok: false; field: SettlementField } => {
  const { payerMemberId, receivingMemberId } = draft;
  if (!payerMemberId) return { ok: false, field: "payer" };
  if (!receivingMemberId || receivingMemberId === payerMemberId) return { ok: false, field: "receiver" };
  const decimal = parseDecimal(draft.amount, input.numberFormat);
  const minor = decimal === null ? null : minorOf(decimal, currencyOf(input.currency).exponent);
  if (minor === null) return { ok: false, field: "amount" };
  const body: Record<string, unknown> = {
    ...input.when,
    amount: { amount: minor, currency: input.currency },
    payerMemberId,
    receivingMemberId,
  };
  if (payerMemberId === input.meMemberId && draft.sourceAccountId) body.sourceAccountId = draft.sourceAccountId;
  if (receivingMemberId === input.meMemberId && draft.destinationAccountId)
    body.destinationAccountId = draft.destinationAccountId;
  return { ok: true, body };
};

const BY_CODE: Readonly<Record<string, SettlementField>> = {
  InvalidAmount: "amount",
  CurrencyMismatch: "amount",
  InvalidSettlementParties: "receiver",
  NotASpaceMember: "payer",
  GuestHasNoAccounts: "payer",
  AccountNotOwned: "payer",
  AccountArchived: "payer",
};
const BY_PATH: Readonly<Record<string, SettlementField>> = {
  amount: "amount",
  payerMemberId: "payer",
  sourceAccountId: "payer",
  receivingMemberId: "receiver",
  destinationAccountId: "receiver",
};

/** Ruling P118: the field an API problem belongs to, else the form. */
export const settlementFieldOf = (problem: Problem): SettlementField | "form" =>
  BY_CODE[problem.code] ??
  (problem.code === "ValidationFailed" ? BY_PATH[problem.errors[0]?.path.split(".")[0] ?? ""] : undefined) ??
  "form";

/** Ruling P175: a suggestion fills in payer, receiver and amount; otherwise the viewer receives, from `payerMemberId`. */
export const prefillOf = (input: {
  readonly suggestion: SuggestionDto | null;
  readonly payerMemberId?: string | null;
  readonly meMemberId: string;
  readonly currency: string;
  readonly numberFormat: NumberFormat;
}): SettlementDraft => {
  const { suggestion } = input;
  const amount = suggestion
    ? formatNumber(decimalOf(suggestion.amount.amount, currencyOf(input.currency).exponent), input)
    : "";
  return {
    payerMemberId: suggestion?.payerMemberId ?? input.payerMemberId ?? null,
    receivingMemberId: suggestion?.receivingMemberId ?? input.meMemberId,
    amount,
    sourceAccountId: null,
    destinationAccountId: null,
  };
};
```

`settle-up-sheet.tsx` (`"use client"`): a `Sheet` titled `balances.settle.title` with the space's name as its `description`; a `ChoiceGroup` `layout="chips"` labelled `balances.settle.payer` of every member (`memberLabel`), and one labelled `balances.settle.receiver`; a `TextField` `id="settle-amount"` `inputMode="decimal"` labelled `balances.settle.amount`; the note `balances.settle.debt` (`payer`, `receiver` = stored names, `amount`) when a suggestion links the chosen payer to the chosen receiver, `balances.settle.noDebt` otherwise (both only once both are chosen); for a guest payer the note `balances.settle.guestNote` (`name`); when the payer is the viewer and they own accounts, a `ChoiceGroup` `layout="chips"` labelled `balances.settle.from` with `balances.settle.none` first and their accounts; when the receiver is the viewer, the same labelled `balances.settle.to`; errors under their fields from `settlementRequestOf`'s refusals (`balances.settle.payerRequired`, `errors.InvalidSettlementParties`, `ledger.form.amountUnreadable` with `example`) or `settlementFieldOf`; a form `ProblemNotice`; and the `lg` button `balances.settle.save`, disabled while pending. The draft starts from `initial` each time the sheet opens. Submit: `const zone = timeZone ?? browserTimeZone(); const now = nowIn(new Date(), zone);` `when = { date: now.date, occurredAt: occurredAtOf(now.date, now.wall, zone), timeZone: zone }`; build; `api.POST("/api/v1/spaces/{spaceId}/settlements", { params: { path: { spaceId }, header: { "idempotency-key": key } }, body: built.body as never })` in `try`, with `useIdempotencyKey(JSON.stringify(<the body without its time fields>))` (the time changes every minute; the draft decides the key); on 201 `renew()`, `onOpenChange(false)`, `router.refresh()`.

`balances-screen.tsx` (becomes `"use client"`): props gain `myAccounts?: readonly AccountDto[]` (default `[]`), `settle?: string`, `timeZone?: string` and `api?: Api`; each suggestion row gets a ghost button with visible text `balances.settle.action` and `aria-label` `balances.settle.suggestion` (`payer`, `receiver`, `amount`) that opens the sheet with `prefillOf({ suggestion })`; the members section's header gets a secondary button `balances.record` that opens it with `prefillOf({ suggestion: null })`; when `settle` names a current member, the sheet starts open with the first suggestion whose payer is that member (or `prefillOf({ suggestion: null, payerMemberId: settle })`). Only a viewer whose role records money (`controlsFor(space.role, space.kind).recordMoney`) sees these buttons: a VIEWER reads the balances only.

`balances-container.tsx`: also read `GET …/accounts` of the space and of the personal space and pass `myAccounts = sharedContextOf({ meUserId, members, spaceAccounts, personalAccounts })?.myAccounts ?? []`; `BalancesContainer` takes `settle?: string`, and the page reads `?settle=` and passes it on. `src/modules/ledger/ui/index.ts` exports `sharedContextOf` and `type SharedExpenseContext` (from `./split/shared-context`).

`guest-sheet.tsx`: the `OutstandingBalance` detail becomes `<>{t("guest.outstanding", { amount })} <Link href={`/spaces/${space.id}/balances?settle=${guest.id}`}>{t("guest.settle")}</Link></>`.

Catalog keys, es / en: `balances.record` Registrar pago / Record a payment; `balances.settle.action` Liquidar / Settle; `balances.settle.suggestion` Liquidar: {payer} le paga {amount} a {receiver} / Settle: {payer} pays {receiver} {amount}; `balances.settle.title` Registrar pago / Record a payment; `balances.settle.payer` Quién paga / Who pays; `balances.settle.receiver` Quién recibe / Who receives; `balances.settle.amount` Monto / Amount; `balances.settle.debt` {payer} le debe {amount} a {receiver}. Puedes registrar un pago parcial; si pagas de más, la deuda cambia de lado. / {payer} owes {receiver} {amount}. You can record a partial payment; paying more turns the debt around.; `balances.settle.noDebt` {payer} no le debe nada a {receiver}. / {payer} owes {receiver} nothing.; `balances.settle.guestNote` {name} es invitado: pagó fuera de la app, así que no hay cuenta de origen. / {name} is a guest: they paid outside the app, so there is no source account.; `balances.settle.from` Sale de (opcional) / Paid from (optional); `balances.settle.to` Llega a (opcional) / Received in (optional); `balances.settle.none` Ninguna / None; `balances.settle.payerRequired` Elige quién paga. / Choose who pays.; `balances.settle.save` Guardar pago / Save payment; `members.guest.settle` Registrar pago / Record a payment.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, `pnpm build`, `pnpm test:e2e`, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/balances/ui src/modules/spaces/ui/members src/modules/ledger/ui/index.ts \
  "src/app/(web)/(app)/spaces/[spaceId]/balances" src/i18n/messages
git commit -m "feat(balances): settle up from a suggestion and record any payment between members (Refs #75)"
```

Risk: none.

---

### Task 20: The @e2e scenario of settling up from a suggestion

HU-E9-07's `@e2e` scenario, verbatim: in "Trip 2026" the nets are Ana +150,000, Juan −100,000 and Luis −50,000 COP (seeded as one expense Ana paid, split EXACT 100,000 / 50,000 between Juan and Luis); Juan, the page's person, opens the balances screen, chooses **Liquidar** on "Juan pays Ana 100,000 COP", confirms the prefilled form, finds the settlement in the transaction list and reads his net as settled. The browser's clock reads 2026-10-31 12:00 Bogotá, inside the server's current period (P178).

**Files:**
- Create: `tests/e2e/features/balances.feature`, `tests/e2e/steps/balances.steps.ts`

**Interfaces:**
- Consumes: Task 10's `World.person`, `sharedSpace`, `join`, `memberId`; Tasks 14, 17 and 19.

- [ ] **Step 1: Write the feature**

`tests/e2e/features/balances.feature`:

```gherkin
Feature: Balances and settle-up screen

  @e2e
  Scenario: Settle up from a suggestion
    Given in "Trip 2026" the net balances are "Ana" +150,000 COP, "Juan" -100,000 COP and "Luis" -50,000 COP
    When "Juan" opens the balances screen and chooses "Settle" on the suggestion "Juan pays Ana 100,000 COP"
    And confirms the prefilled settlement form
    Then a settlement of 100,000 COP from "Juan" to "Ana" is listed
    And "Juan" shows a net balance of 0 COP
```

- [ ] **Step 2: Write the steps**

`tests/e2e/steps/balances.steps.ts`:

```ts
import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures";
import { minor, shown } from "../support/money";

const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();
const cop = (pesos: string) => ({ amount: minor(pesos), currency: "COP" });

Given(
  /^in "([^"]+)" the net balances are "([^"]+)" \+([\d,]+) COP, "([^"]+)" -([\d,]+) COP and "([^"]+)" -([\d,]+) COP$/,
  async ({ page, world }, space: string, owed: string, total: string, a: string, aOwes: string, b: string, bOwes: string) => {
    await world.signUp(a);
    const ana = await world.person(owed);
    const luis = await world.person(b);
    const spaceId = await world.sharedSpace(ana, space);
    await world.join(ana, space, "me", "MEMBER");
    await world.join(ana, space, luis, "MEMBER");
    const bank = (await ana.api.post(`/api/v1/spaces/${ana.personalSpaceId}/accounts`, {
      name: "Bancolombia", type: "BANK", openingBalance: cop("1,000,000"),
    })) as { id: string };
    const [anaId, juanId, luisId] = [await world.memberId(space, owed), await world.memberId(space, a), await world.memberId(space, b)];
    const { items } = (await ana.api.get(`/api/v1/spaces/${spaceId}/categories`)) as { items: { categories: { id: string }[] }[] };
    await ana.api.post(`/api/v1/spaces/${spaceId}/expenses`, {
      description: "Hotel", date: "2026-10-20", occurredAt: "2026-10-20T17:00:00.000Z", timeZone: "America/Bogota",
      categoryId: items.flatMap((g) => g.categories)[0]!.id, amount: cop(total),
      payments: [{ memberId: anaId, accountId: bank.id, amount: cop(total) }],
      split: { method: "EXACT", participants: [{ memberId: juanId, amount: cop(aOwes) }, { memberId: luisId, amount: cop(bOwes) }] },
    });
    const { members } = (await world.api.get(`/api/v1/spaces/${spaceId}/balances`)) as { members: { memberId: string; net: { amount: string } }[] };
    expect(members.map((m) => m.net.amount)).toEqual([minor(total), `-${minor(aOwes)}`, `-${minor(bOwes)}`]);
    await page.clock.setFixedTime(new Date("2026-10-31T17:00:00Z"));
  },
);

When(
  /^"([^"]+)" opens the balances screen and chooses "Settle" on the suggestion "([^"]+) pays ([^"]+) ([\d,]+) COP"$/,
  async ({ page, world }, _n: string, payer: string, receiver: string, pesos: string) => {
    await page.goto(`/spaces/${[...world.spaces.values()][0]}/balances`);
    await page
      .getByRole("button", { name: world.t("balances.settle.suggestion", { payer, receiver, amount: shown(pesos) }) })
      .click();
  },
);

When("confirms the prefilled settlement form", async ({ page, world }) => {
  const dialog = page.getByRole("dialog", { name: world.t("balances.settle.title") });
  await expect(dialog.getByLabel(world.t("balances.settle.amount"))).toHaveValue("100.000");
  await dialog.getByRole("button", { name: world.t("balances.settle.save") }).click();
  await expect(dialog).toBeHidden();
});

Then(
  /^a settlement of ([\d,]+) COP from "([^"]+)" to "([^"]+)" is listed$/,
  async ({ page, world }, pesos: string, from: string, to: string) => {
    await page.goto(`/spaces/${[...world.spaces.values()][0]}/transactions`);
    const row = page.getByRole("listitem").filter({ hasText: world.t("ledger.settlement", { from, to }) });
    expect(norm(await row.textContent())).toContain(norm(shown(pesos)));
  },
);

Then(/^"([^"]+)" shows a net balance of 0 COP$/, async ({ page, world }, name: string) => {
  await page.goto(`/spaces/${[...world.spaces.values()][0]}/balances`);
  const label = name === world.user!.name ? world.t("members.you", { name }) : name;
  await expect(
    page.getByRole("link", { name: world.t("balances.member.link", { name: label, sentence: world.t("balances.member.settled") }) }),
  ).toBeVisible();
});
```

(The expense is recorded by Ana in her own session, so `partyAccount` lets her debit her Bancolombia; the balances read through Juan's.)

- [ ] **Step 3: Run it and see it bite**

Run: `pnpm build && pnpm test:e2e`.
Expected: PASS. To see it bite, make `prefillOf` ignore the suggestion's amount locally: "confirms the prefilled settlement form" fails on the amount; revert and rebuild.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e
git commit -m "test(web): settle up from a suggestion, end to end (Refs #75)"
```

Risk: none.

---
### Task 21: Accessibility scans and performance budgets of the household screens

Every new screen and sheet gets the UI Definition of Done's WCAG 2.1 AA scan in light and dark, and every new route a script budget that fails CI (rulings P134, P154 and P177). The Lighthouse script learns routes with more than the personal space's id (`:shared`, `:member`, `:token`, `:claim`) and measures the open pages as a visitor, and a second INP run covers the split editor, the most interactive new screen.

**Files:**
- Create: `tests/e2e/a11y-shared.spec.ts`, `tests/e2e/perf/inp-split.spec.ts`
- Modify: `tests/performance/budgets.json`, `tests/performance/lighthouse.mjs`, `tests/performance/budgets.test.mjs`, `playwright.config.ts`

**Interfaces:**
- Consumes: every screen of Tasks 5–19.
- Produces: `routeUrl(route: string, ids: Record<string, string>): string` and `isVisitorRoute(route: string): boolean` exported by `tests/performance/lighthouse.mjs`; the budgets of P177; the `a11y` project runs `a11y*.spec.ts`.

- [ ] **Step 1: Write the failing budget tests**

`tests/performance/budgets.json` gains, after `"/settings": 200`:

```json
    "/spaces/new": 190,
    "/spaces/:shared/members": 200,
    "/spaces/:shared/balances": 200,
    "/spaces/:shared/members/:member/history": 190,
    "/spaces/:shared/new": 215,
    "/invitations/:token": 185,
    "/claims/:claim": 185
```

`tests/performance/budgets.test.mjs` (import `isVisitorRoute` and `routeUrl` beside `budgetFailures`):

```js
  it("fills every route of the budgets from the seeded ids, and refuses an id it does not have (ruling P177)", () => {
    const ids = { id: "sp-p", shared: "sp-h", member: "m-j", token: "tok", claim: "clm" };
    for (const route of Object.keys(budgets.scriptKb)) expect(routeUrl(route, ids)).not.toContain(":");
    expect(routeUrl("/spaces/:shared/members/:member/history", ids)).toBe("/spaces/sp-h/members/m-j/history");
    expect(() => routeUrl("/spaces/:nope", ids)).toThrow("No id for :nope in /spaces/:nope");
  });

  it("measures the sign-in, sign-up, invitation and claim pages without a session", () => {
    expect(["/sign-in", "/sign-up", "/invitations/:token", "/claims/:claim", "/spaces/:id", "/spaces/new"].map(isVisitorRoute)).toEqual([
      true, true, true, true, false, false,
    ]);
  });
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit tests/performance`
Expected: FAIL — `routeUrl` and `isVisitorRoute` are not exported.

- [ ] **Step 3: Implement the budget script changes**

`tests/performance/lighthouse.mjs`, after `budgetFailures`:

```js
/** Ruling P177: the path a budget's route measures, its `:name` segments filled from the seeded ids. */
export const routeUrl = (route, ids) =>
  route.replace(/:(\w+)/g, (_, name) => {
    if (!(name in ids)) throw new Error(`No id for :${name} in ${route}`);
    return ids[name];
  });

/** The pages a visitor opens: measured without the session cookie. */
export const isVisitorRoute = (route) => /^\/(sign-in|sign-up|invitations|claims)(\/|$)/.test(route);
```

In the seeding block, after the twenty expenses: create the shared space (`POST /api/v1/spaces` `{ kind: "SHARED", name: "Household", currency: "COP" }`); sign a second person up with `x-forwarded-for: 10.250.0.2` and its own cookie; create a LINK invitation as the first person and accept it with the second; add the guest Pedro; create a claim link for Pedro (`claim` = its token); create another LINK invitation whose token is `token` (left pending for the visitor page); record one shared expense of 300,000 COP paid from Bancolombia, split EQUAL; read the second person's member id (`member`). Then `const ids = { id: space.id, shared, member, token, claim }`, and in the loop `const url = `${BASE}${routeUrl(route, ids)}`` and `measure(9223, url, isVisitorRoute(route) ? null : cookie)`. (`route.replace(":id", space.id)` and `route.startsWith("/sign")` go away.)

- [ ] **Step 4: Write the INP run of the split editor**

`tests/e2e/perf/inp-split.spec.ts`:

```ts
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import budgets from "../../performance/budgets.json" with { type: "json" };

const WEB_VITALS = createRequire(import.meta.url).resolve("web-vitals");

test("INP stays within budget while editing a split on a 4× slower CPU (rulings P134, P177)", async ({ page, playwright }) => {
  const headers = { "x-forwarded-for": "10.251.0.2" };
  await page.request.post("/api/v1/auth/sign-up", {
    headers,
    data: { name: "Inp", email: `inp-split-${Date.now()}@example.com`, password: "123456789012", timezone: "America/Bogota" },
  });
  const { items } = await (await page.request.get("/api/v1/spaces")).json();
  const personal = items[0];
  await page.request.post(`/api/v1/spaces/${personal.id}/accounts`, {
    data: { name: "Bancolombia", type: "BANK", openingBalance: { amount: "0", currency: "COP" } },
  });
  const shared = await (await page.request.post("/api/v1/spaces", { data: { kind: "SHARED", name: "Household", currency: "COP" } })).json();
  const { url } = await (await page.request.post(`/api/v1/spaces/${shared.id}/invitations`, { data: { kind: "LINK", role: "MEMBER" } })).json();
  const other = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100", extraHTTPHeaders: { "x-forwarded-for": "10.251.0.3" } });
  await other.post("/api/v1/auth/sign-up", {
    data: { name: "Juan", email: `inp-juan-${Date.now()}@example.com`, password: "123456789012", timezone: "America/Bogota" },
  });
  await other.post(`/api/v1/invitations/${new URL(url).pathname.split("/").at(-1)}/accept`);
  await other.dispose();
  await page.addInitScript({ path: WEB_VITALS });
  await page.addInitScript(() => {
    (window as unknown as { __inp: number }).__inp = 0;
    addEventListener("load", () =>
      (window as unknown as { webVitals: { onINP: (cb: (m: { value: number }) => void, o: object) => void } }).webVitals.onINP(
        (metric) => {
          (window as unknown as { __inp: number }).__inp = metric.value;
        },
        { reportAllChanges: true },
      ),
    );
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto(`/spaces/${shared.id}/new`);
  await expect(page.locator("[data-ready='true']")).toBeAttached();
  for (const digit of ["3", "0", "0", "0", "0", "0"]) await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: /Categoría/ }).click();
  await page.getByRole("radio").first().click();
  await page.getByRole("button", { name: /División/ }).click();
  await page.getByRole("radio", { name: "Porcentaje" }).click();
  await page.getByLabel(/^Valor de Inp/).pressSequentially("40");
  await page.getByLabel(/^Valor de Juan/).pressSequentially("60");
  const inp = await page.evaluate(() => (window as unknown as { __inp: number }).__inp);
  expect(inp).toBeGreaterThan(0);
  expect(inp).toBeLessThanOrEqual(budgets.metrics.inpMs);
});
```

(If the first category opens subcategory chips, the run still measures the interactions that happened; the split sheet's checks do not depend on the category.)

- [ ] **Step 5: Write the accessibility scan**

`tests/e2e/a11y-shared.spec.ts`:

```ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import es from "../../src/i18n/messages/es.json" with { type: "json" };

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const BASE = "http://127.0.0.1:3100";
const fill = (message: string, values: Record<string, string>) =>
  message.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);

const json = async (request: APIRequestContext, method: "get" | "post", path: string, data?: unknown) => {
  const response = await request[method](path, data === undefined ? undefined : { data, headers: { "idempotency-key": crypto.randomUUID() } });
  if (!response.ok()) throw new Error(`${method.toUpperCase()} ${path} answered ${response.status()}: ${await response.text()}`);
  return response.status() === 204 ? undefined : response.json();
};

/** Ana (the page) in a Household with Juan, the guest Pedro, a fund she overspent, a settlement-ready balance and invitations. */
const seedHousehold = async (page: Page, playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }, tag: string) => {
  const ip = (n: number) => ({ "x-forwarded-for": `10.253.${tag === "light" ? 1 : 2}.${n}` });
  await page.context().setExtraHTTPHeaders(ip(1));
  await json(page.request, "post", "/api/v1/auth/sign-up", { name: "Ana", email: `a11y-shared-${tag}-${Date.now()}@example.com`, password: "123456789012", timezone: "America/Bogota" });
  const { items } = await json(page.request, "get", "/api/v1/spaces");
  const personal = items[0].id as string;
  const bank = await json(page.request, "post", `/api/v1/spaces/${personal}/accounts`, { name: "Bancolombia", type: "BANK", openingBalance: { amount: "200000000", currency: "COP" } });
  const household = await json(page.request, "post", "/api/v1/spaces", { kind: "SHARED", name: "Household", currency: "COP" });
  const space = `/api/v1/spaces/${household.id}`;
  const juan = await playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: ip(2) });
  await json(juan, "post", "/api/v1/auth/sign-up", { name: "Juan", email: `a11y-juan-${tag}-${Date.now()}@example.com`, password: "123456789012", timezone: "America/Bogota" });
  const join = await json(page.request, "post", `${space}/invitations`, { kind: "LINK", role: "MEMBER" });
  await json(juan, "post", `/api/v1/invitations/${new URL(join.url).pathname.split("/").at(-1)}/accept`, {});
  await juan.dispose();
  const pedro = await json(page.request, "post", `${space}/guests`, { displayName: "Pedro" });
  await json(page.request, "post", `${space}/invitations`, { kind: "EMAIL", email: "marta@example.com", role: "VIEWER" });
  const pending = await json(page.request, "post", `${space}/invitations`, { kind: "LINK", role: "MEMBER" });
  const claim = await json(page.request, "post", `${space}/guests/${pedro.id}/claim-links`);
  const fund = await json(page.request, "post", `${space}/accounts`, { name: "Fondo Hogar", type: "SHARED_FUND", openingBalance: { amount: "0", currency: "COP" } });
  const { items: groups } = await json(page.request, "get", `${space}/categories`);
  const categoryId = groups.flatMap((g: { categories: { id: string }[] }) => g.categories)[0].id;
  const { items: members } = await json(page.request, "get", `${space}/members`);
  const ana = members.find((m: { displayName: string }) => m.displayName === "Ana").id;
  const base = { date: "2026-10-31", occurredAt: "2026-10-31T17:00:00.000Z", timeZone: "America/Bogota", categoryId };
  await json(page.request, "post", `${space}/expenses`, {
    ...base, description: "Mercado", amount: { amount: "30000000", currency: "COP" },
    payments: [{ memberId: ana, accountId: bank.id, amount: { amount: "30000000", currency: "COP" } }],
  });
  const overspent = await json(page.request, "post", `${space}/expenses`, {
    ...base, description: "Arriendo", amount: { amount: "50000000", currency: "COP" },
    payments: [{ memberId: null, accountId: fund.id, amount: { amount: "50000000", currency: "COP" } }],
  });
  return {
    household: household.id as string,
    personal,
    pedro: pedro.id as string,
    ana: ana as string,
    token: new URL(pending.url).pathname,
    claim: new URL(claim.url).pathname,
    fund: overspent.warnings[0].accountId as string,
  };
};

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`household screens in ${colorScheme} (UI Definition of Done)`, () => {
    test.use({ colorScheme });

    test("every M6b screen and sheet has no WCAG 2.1 AA violation", async ({ page, playwright, browser }) => {
      const scan = async (where: string, on: Page = page) => {
        const { violations } = await new AxeBuilder({ page: on }).withTags(WCAG).analyze();
        expect(violations.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      };
      await page.clock.setFixedTime(new Date("2026-10-31T17:00:00Z"));
      const ids = await seedHousehold(page, playwright, colorScheme);
      const h = `/spaces/${ids.household}`;

      for (const path of ["/spaces/new", `${h}/members`, `${h}/balances`, `${h}/members/${ids.ana}/history`,
        `${h}/transactions?notice=FundBalanceNegative&account=${ids.fund}`]) {
        await page.goto(path);
        await scan(path);
      }
      await page.goto(`${h}/members`);
      await page.getByRole("button", { name: es.members.invite }).click();
      await page.getByRole("button", { name: es.members.inviteSheet.createLink }).click();
      await expect(page.getByLabel(es.members.inviteSheet.linkLabel)).toBeVisible();
      await scan("invite sheet with its link");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: es.members.addGuest }).click();
      await scan("add guest sheet");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: fill(es.members.guestOptions, { name: `Pedro ${es.members.guestSuffix}` }) }).click();
      await page.getByRole("button", { name: es.members.guest.createClaim }).click();
      await scan("guest sheet with its claim link");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: fill(es.members.role, { name: "Juan", role: es.shell.role.MEMBER }) }).click();
      await scan("role sheet");
      await page.keyboard.press("Escape");

      await page.goto(`${h}/new`);
      await expect(page.locator("[data-ready='true']")).toBeAttached();
      await scan("shared expense form");
      await page.getByLabel(es.ledger.form.amount).fill("300000");
      await page.getByRole("button", { name: new RegExp(es.ledger.split.split) }).click();
      await scan("split sheet");
      await page.keyboard.press("Escape");

      await page.goto(`/spaces/${ids.personal}/new`);
      await expect(page.locator("[data-ready='true']")).toBeAttached();
      await page.getByRole("button", { name: es.ledger.direct.open }).click();
      await scan("split with someone sheet");
      await page.keyboard.press("Escape");

      await page.goto(`${h}/balances`);
      await page.getByRole("button", { name: es.balances.record }).click();
      await scan("settle-up sheet");
      await page.keyboard.press("Escape");

      // The open pages, signed in (Ana) and as a visitor (a fresh context without cookies).
      for (const path of [ids.token, ids.claim]) {
        await page.goto(path);
        await scan(`${path} signed in`);
      }
      const visitor = await browser.newPage({ colorScheme, baseURL: BASE });
      for (const path of [ids.token, ids.claim, "/invitations/not-a-token"]) {
        await visitor.goto(path);
        await scan(`${path} as a visitor`, visitor);
      }
      await visitor.close();
    });
  });
}
```

`playwright.config.ts`: the `a11y` project's `testMatch` becomes `/a11y.*\.spec\.ts$/`.

- [ ] **Step 6: Run the gates and read the numbers**

Run: `pnpm exec vitest run --project unit tests/performance`, `pnpm build`, `pnpm test:e2e`, `pnpm perf`.
Expected: the scans list no violation in either theme; every route within its budget and both INP runs ≤ 200 ms; the script prints one JSON line per route. **If a new route misses its budget, do not raise it** (P134, P177): first move the heaviest client import behind `next/dynamic` (the split sheet and the split-with-person sheet already are); if it still misses, stop and report the numbers as one "Needs your decision" result. A budget may be **lowered** to its measurement plus 5 KiB when the measurement is more than 15 KiB under it, recorded in the commit message. A dark-theme contrast failure is fixed by moving that token's mix in `globals.css`, never by disabling the rule (P135).

- [ ] **Step 7: Commit**

```bash
git add tests/performance tests/e2e/a11y-shared.spec.ts tests/e2e/perf/inp-split.spec.ts playwright.config.ts
git commit -m "test(web): scan the household screens with axe and budget their routes (Refs #73, Refs #74, Refs #75)"
```

Risk: none.

---

### Task 22: The M6b documentation

The owner's rule "every decision, architecture and ERD in `docs/`, one decisions index, rulings copied before each PR" (memory "Docs in repo as wiki"): the rulings of this plan go into the decisions index, the epic's stories record how they were built, the architecture page gains the open pages and the previews, and the plan joins the docs navigation.

**Files:**
- Modify: `docs/decisions/README.md`, `docs/README.md`, `docs/backlog/E9-web-ui.md`, `docs/architecture/README.md`, `mkdocs.yml`, `.superpowers/sdd/pending-ideas.md`

- [ ] **Step 1: Write the documentation**

- `docs/decisions/README.md`: the ruling range becomes P1–P183 (the intro line, the heading `## Rulings P1–P183` and the "ranges are" sentence, which gains "and M6b P155–P183; M6c starts at P200"); a new section `### M6b: shared spaces, split expenses and balances (P155–P183)` after M6a's, with the plan link, the line "Ruled by the planner under the owner's standing delegation of 2026-10-20 (L1); every design deviation is listed in the plan's Self-Review for the owner's end review." and the table `ID | Ruling | Where` with one row per ruling, a one-sentence summary each, "Where" = `Rulings, <n>` (the Self-Review's numbering).
- `docs/README.md`: "every ruling P1 to P154" → "every ruling P1 to P183".
- `docs/backlog/E9-web-ui.md`:
  - HU-E9-05's technical notes: the containers line becomes "Containers `MembersContainer`, `InvitationContainer` (invitations and claims) and the switcher's `/spaces/new` form call `/api/v1` through the generated client (P117): `POST /api/v1/spaces`, `GET …/members`, `GET` and `POST …/invitations`, `POST …/invitations/{id}/revoke`, `GET` and `POST /api/v1/invitations/{token}[/accept]`, `POST …/guests`, `POST …/guests/{id}/claim-links`, `DELETE …/guests/{id}`, `GET` and `POST /api/v1/claims/{token}[/accept]` and `PATCH …/members/{id}`; controls follow a UI copy of the permission matrix pinned to the domain (P158)."; the second note gains "The previews `GET /api/v1/invitations/{token}` and `GET /api/v1/claims/{token}` answer without a session and never carry an email (P156); the pages live in the route group `(open)` (P157)."
  - HU-E9-06's notes: "`ExpenseFormContainer` loads members, accounts and the resolved default split" becomes "`RecordFormContainer` loads the members, the space's accounts and the recorder's personal accounts; `useDefaultSplit` reads `GET …/default-split` as the form changes (P167); the presentational `SplitSheet` previews the shares with `previewSplit`, pinned to the domain's `splitShares` (P166), and the server result is authoritative. BY_ALLOCATION is requested by sending no `split`."; "guests are payers without an account picker, and a fund payment hides the payer member" gains "; another registered member is never the payer, since only an account's owner records its debit (D9, P168)"; and the warning note gains "; the list shows it from `?notice=FundBalanceNegative&account=<id>` (P170)".
  - HU-E9-07's notes: the containers become `BalancesContainer` (with the settle-up sheet) and `HistoryContainer`; "Accepting a suggestion only prefills the form" gains "(the sheet records now in the browser's zone, with one `Idempotency-Key` per draft, P174)"; the history note "a period of the space, `?from=<date>` (P176)".
  - A new section `## Follow-ups after M6b` listing the Self-Review's follow-ups.
- `docs/architecture/README.md`, section "Web UI": a paragraph on the open pages (route group `(open)`, `OPEN_PREFIXES` in the proxy, the public previews) and one on the split preview mirroring `splitShares` with a parity test; the Modules paragraph adds `balances` to the modules with a `ui/` layer.
- `mkdocs.yml`: the plans list gains `"M6b Shared spaces, split and balances": superpowers/plans/2026-10-21-m6b-shared-spaces-split-balances.md` after M6a.
- `.superpowers/sdd/pending-ideas.md`: under "Decisions taken under the standing delegation", one line per design deviation of the Self-Review and per M6b follow-up, for the owner's end review (L1).

- [ ] **Step 2: Run the gates**

Run: every gate, `pnpm test:e2e`, `pnpm perf`, and `pipx run mkdocs build --strict` if mkdocs is available locally (CI's docs job runs it).
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add docs mkdocs.yml .superpowers/sdd/pending-ideas.md
git commit -m "docs(web): record the M6b rulings and how the household screens are built (Refs #73, Refs #74, Refs #75)"
```

Risk: none (passive documentation).

---

## Self-Review

### Story coverage

**HU-E9-05 — Shared spaces, members, guests and invitations screens (#73)**

| Scenario or technical note | Covered by |
|---|---|
| Create a shared space from the switcher; it becomes the active space; its members screen lists Ana as Owner | Task 5 (switcher link, `NewSpaceForm` lands on `/spaces/<id>/members`); Task 6 (Ana (tú) · Propietario) |
| `@e2e` A visitor accepts a link invitation after signing up (page shows Household and MEMBER; sign up; returned; accept; members list Juan as Member) | Task 2 (preview), Task 3 (open path, sign-up `next`), Task 9 (card states), Task 10 (`spaces.feature`) |
| An added guest is offered as payer and participant; the members screen lists "Pedro (guest)" | Task 8 (add guest, "Pedro (invitado)" row); Task 13 (payer radios "Ana (tú)", "Pedro (invitado)"; participants Ana, Luis, Pedro) |
| Create a claim link for a guest, copyable, expiring 7 days later | Task 8 (claim link in a `CopyField`, "Un solo uso · vence el 19/10/2026"); Task 4 (`CopyField`) |
| Removing a guest with a balance shows `errors.OutstandingBalance` with the amount; still listed | Task 4 (`Problem.outstanding`, `ProblemNotice` detail); Task 8 (notice with "Saldo pendiente: $ 100.000", no refresh); Task 19 (its "Registrar pago" link) |
| Controls follow the member's role (Luis: Add guest, no Invite; Sofi: neither) | Task 6 (`SPACE_CONTROLS` parity, `controlsFor`); Task 7 (Invitar for OWNER only); Task 8 (the scenario) |
| Note: the containers and actions (`CreateSharedSpace`, `CreateInvitation`, `RevokeInvitation`, `AcceptInvitation`, `AddGuestMember`, `CreateGuestClaim`, `ClaimGuestPlace`, `RemoveGuestMember`, `ChangeMemberRole`) | Tasks 5–9 through `/api/v1` (P117); `ChangeMemberRole` in Task 6; the pending list needed Task 1's `GET …/invitations` |
| Note: invitation and claim pages reachable without a session; signing up from them returns to the same page | Tasks 2, 3 and 9 (P156, P157) |
| Note: guests labelled with `members.guestSuffix` | Task 6 (`memberLabel`, key `members.guestSuffix` "(invitado)" / "(guest)") |

**HU-E9-06 — Record a shared expense with split options (#74)**

| Scenario or technical note | Covered by |
|---|---|
| `@e2e` Equal split among the selected participants (150,000 each; appears in the Household list) | Task 11 (`previewSplit`, parity); Task 12 (sheet rows); Task 13 (body); Task 14 (row "pagó Ana"); Task 16 (e2e) |
| Outline: the preview follows the chosen method (PERCENT 40/60, EXACT 100k/150k, SHARES 2/1) | Task 11 (parity table); Task 12 (`it.each` of the three rows) |
| An invalid split cannot be saved (10 % unassigned; save disabled) | Task 11 (`percentShort` "10.00"); Task 12 (status line, Listo disabled); Task 13 (save disabled) |
| `@e2e` The default split by allocation is preselected (800k/1.2M) and can be overridden (1M each) | Task 12 (`useDefaultSplit`, BY_ALLOCATION rows locked); Task 13 (preselection, no `split` in the body); Task 16 (e2e with the seeded 2026-11 plan) |
| Lines without allocation do not offer BY_ALLOCATION (EQUAL preselected, 25,000 each) | Task 12 ("does not offer the plan's split when the default leaves it out", availableMethods); Task 13 (the default EQUAL applies) |
| Paying beyond the fund balance shows a warning (saved; balance −500,000) | Task 14 (`afterSaveUrl`, `SavedNotice` "−$ 500.000"); Task 4 (`warnings.FundBalanceNegative`, the catalog check) |
| Note: the container loads members, accounts and the default split; `SplitEditor` uses `SplitCalculator` rules; server authoritative; EQUAL before HU-E6-08 | Task 13 (container), Task 12 (hook), Task 11 (mirror of `splitShares`, P166); HU-E6-08 is `Done`, so the default split is live |
| Note: one payer; guests without account; a fund payment hides the payer member | Task 11 (`Payer`), Task 12 (payer notes), Task 13 (fund payment test), ruling P168 |
| Note: warning codes through `warnings.<Code>` | Task 4 (`warningCodesOf`, `checkCatalogs`), Task 14 |
| Note: "Split with someone" reuses the form to call `SplitWithPerson`, existing co-members or a new guest | Task 15 (`peopleOf`, `directBodyOf`, the sheet, `POST /api/v1/direct-splits`) |

**HU-E9-07 — Balances and settle-up screen (#75)**

| Scenario or technical note | Covered by |
|---|---|
| Balances show who owes whom ("Juan owes Ana 150,000 COP") | Task 17 (`balances.owes` "Juan le debe $ 150.000 a Ana", English "Juan owes Ana $ 150.000") |
| `@e2e` Settle up from a suggestion (prefilled form; settlement listed; Juan at 0) | Task 19 (Liquidar prefill, body, one key); Task 14 (settlement row "Juan → Ana"); Task 20 (e2e) |
| Record a partial settlement (500,000 of 1,200,000) | Task 19 ("records a partial payment"); the remaining 700,000 is the API's (HU-E5-02 acceptance tests) |
| Settlement paid by a guest has no account field; Pedro ends at 0 | Task 19 (no "Sale de", no `sourceAccountId`); the resulting net is the API's |
| Balance history per member (running −150,000, −100,000, 0) | Task 18 (rows "debe $ 150.000", "debe $ 100.000", "a paz y salvo") |
| Note: containers `BalancesContainer`, `SettleUpFormContainer`, `BalanceHistoryContainer` | `BalancesContainer` with the settle-up sheet (one container: the sheet is on the screen, as the artboard draws it), `HistoryContainer` (Design deviations 11) |
| Note: a suggestion only prefills; recorded through `RecordSettlement` with an `Idempotency-Key` | Task 19 (P174, `useIdempotencyKey`) |
| Note: signed amounts as sentences (`balances.owes`) | Task 8 (`memberSentence`), Task 17, Task 18 (P173) |

**Owner and lead constraints**

| Constraint | Covered by |
|---|---|
| Strict TDD and RDD in every task | Every task's failing test first; the Execution Workflow's RDD step; Tasks 2 and 3 name item 2 |
| `@e2e` scenarios in Gherkin through playwright-bdd | Tasks 10, 16, 20 (all four tagged scenarios, verbatim) |
| axe scans of the new screens; budgets for the new routes | Task 21 (both themes, every screen and sheet; seven new budgets; INP of the split editor) |
| The Saldos tab appears; the profile sheet's "Miembros e invitaciones" | Task 5 (P160) |
| Reuse the shared helpers | "Helpers every task reuses"; each task's Consumes line; `sharedContextOf`, `memberLabel`, `memberSentence`, `controlsFor` written once and exported |
| Neutral Latin American Spanish with tú | Every catalog line (for example "Pídele a {name} un enlace nuevo", "Elige al menos una persona", "Inicia sesión con la cuenta…") |

### Review Focus pins

| Review Focus | Pinned by |
|---|---|
| 1. Money splitting and rounding | Task 11 parity table and the `tooSmall` refusal; Task 12 status line; Task 13 save button and body |
| 2. Public pages and tokens | Task 2 unit (no email, wrong kind, statuses), integration and acceptance tests; Task 3 `redirectFor`/`safeNext` rows; Task 9 card states; the two verifiers |
| 3. Who may pay with what | Task 11 `sharedPartsOf`; Task 13 payer radios (no other member); Task 19 accounts only on the viewer's side |
| 4. Role-gated controls | Task 6 parity and screen tests; Tasks 7 and 8 role tests |
| 5. Double submits and stale answers | Task 7 (`dblClick` Crear enlace), Task 8 (Agregar invitado), Task 12 (stale default split), Task 13 (Guardar gasto), Task 15 (Guardar y dividir), Task 19 (Guardar pago) |
| 6. Signs and sentences | Task 8 `memberSentence`; Task 14 notice; Task 17 Spanish and English; Task 18 history rows |

### Rulings

1. **Pending invitations list** (Task 1). **Ruled by the planner (P155):** `GET /api/v1/spaces/{spaceId}/invitations` answers the PENDING email and link invitations that have not expired, newest first, to OWNER and ADMIN (`member.invite`); claim links are left out (they belong to their guest's sheet) and the answer never carries a URL, because only the token's hash is stored. Reasons: the Main artboard lists pending invitations with Revocar and `RevokeInvitation` needs an id the UI had no way to read. Alternatives rejected: keeping created invitations in browser storage (lost on another device, never shared between owners), storing tokens to show them again (defeats HU-E1-06's hashing).
2. **Public previews** (Task 2). **Ruled by the planner (P156):** `GET /api/v1/invitations/{token}` and `GET /api/v1/claims/{token}` need no session and answer only the space's name, the inviter's display name (null once they left), the role or the guest's name, the effective status and the expiry; an unknown token or one of the other kind is 404 `InvitationNotFound`; no throttle, since a token carries 256 random bits and a preview changes nothing. Reasons: the story's visitor sees "the space Household and the role MEMBER" before having an account. Alternatives rejected: showing the page without any detail (the story's scenario fails), a throttle (no guessing risk at 256 bits; it would add state for nothing), including the email (the token holder may be anyone the link was forwarded to).
3. **Open pages** (Tasks 3, 9). **Ruled by the planner (P157):** `/invitations/{token}` and `/claims/{token}` live in the route group `(open)`, whose layout never redirects; the proxy lets them through by `OPEN_PREFIXES`; `safeNext` honours them; the sign-up screen takes `next` and returns there, keeping `next` and `invitation` in its link to sign in. Reasons: a visitor must reach them, and a signed-in person must too (unlike `(public)`, P145). Alternative rejected: putting them in `(public)` (it sends a signed-in person away, P145).
4. **Role-gated controls** (Tasks 6–8, 19). **Ruled by the planner (P158):** `SPACE_CONTROLS` is the UI's copy of HU-E1-05's matrix for these screens, pinned to the domain's `can()` by a `.test.ts`; a control the viewer may not use is hidden, not disabled; a direct space offers no invitation, guest or role control (D16), only its guest's claim link; the API stays the authority. Reasons: the UI may not import the domain (P119), and a copy without a pin would drift. Alternative rejected: a capabilities field in `GET …/spaces` (a contract change for a rule the matrix already states).
5. **Routes** (Tasks 5, 6, 9, 17, 18). **Ruled by the planner (P159):** `/spaces/new`, `/spaces/{spaceId}/members`, `/spaces/{spaceId}/balances`, `/spaces/{spaceId}/members/{memberId}/history?from=`, `/invitations/{token}`, `/claims/{token}`; a personal space has no members or balances screen (`notFound()`).
6. **The shell** (Task 5). **Ruled by the planner (P160):** the bottom bar follows the Batch 2 artboards' order, Inicio, Movimientos, Registrar, Saldos (M6c inserts Plan before Saldos, completing the artboard's five slots); Saldos only in shared and direct spaces; the profile sheet's "Miembros e invitaciones" only outside the personal space; the space sheet ends with "Crear espacio compartido". Amends P141's "hidden until their screens exist", now that the balances screen exists. Alternative rejected: Saldos in the personal space too (always "a paz y salvo", a dead destination).
7. **New shared space** (Task 5). **Ruled by the planner (P161):** a name and one of COP, USD, EUR; the period stays MONTHLY day 1 (the API's default) and the artboard's period controls are not built; after creating, the new space's members screen. Reasons: HU-E9-05 asks for name and currency; changing the period is a space-settings story. Alternative rejected: creating then patching the period (two writes, a half-done space on a failure).
8. **Invite sheet** (Task 7). **Ruled by the planner (P162):** an invitation is created only when the person presses Crear enlace or Enviar invitación, never by opening the sheet; its URL is shown once in a `CopyField`; an email invitation shows its URL too when `emailSent` is false (P144: no mail yet); roles ADMIN, MEMBER, VIEWER, default MEMBER. Alternative rejected: the artboard's link "ready" on open (every opened sheet would leave a pending invitation).
9. **Guests** (Tasks 4, 8, 19). **Ruled by the planner (P163):** a guest is a name and an optional email; the guest sheet holds the claim link (OWNER, ADMIN) and the removal (OWNER, ADMIN, MEMBER) behind a confirmation; an `OutstandingBalance` refusal shows `errors.OutstandingBalance` with the problem's public `outstanding` amount, which `Problem` now keeps, and links to the settle-up sheet prefilled for that guest.
10. **Role changes** (Task 6). **Ruled by the planner (P164):** only an OWNER sees role controls, never on their own row (the artboard); a sheet with the four roles and their one-line meaning; `LastOwnerRequired` stays in the sheet.
11. **Invitation page states** (Task 9). **Ruled by the planner (P165):** visitor, signed in, other account (from the accept's `InvitationEmailMismatch`, with sign-out and back), expired, revoked, used and missing; after accepting, the space's home; dates in the person's formats when signed in, else the built-in ones and the installation's zone; the email of an email invitation is never shown.
12. **Split preview** (Task 11). **Ruled by the planner (P166):** `previewSplit` mirrors `splitShares` over `Money.allocate` (join order, largest remainder with ties to the earlier participant, the rounding unit, the sub-unit to the first participant), pinned by a parity table against the domain; the request carries percents, amounts or units, never the preview; the server's answer is authoritative. Alternatives rejected: asking the API for every keystroke's preview (no such endpoint for EQUAL/PERCENT/EXACT/SHARES, and INP), a preview with different rounding (a preview that disagrees with what gets saved).
13. **Default split** (Tasks 12, 13). **Ruled by the planner (P167):** `GET …/default-split` with the category, the date and a positive amount, 250 ms after they settle; only the latest request may answer; its method is preselected until the person changes the method, a participant or a value; BY_ALLOCATION is offered only when `availableMethods` lists it, its shares are the API's and its participants are locked; it is sent by omitting `split`; every other method is sent explicitly. A failed read offers EQUAL.
14. **Payers** (Tasks 11–13, 19). **Ruled by the planner (P168):** the recorder (from the active accounts they own: their personal space's, then their own in this space), a guest (no account) or an active fund (no payer member); another registered member is not offered as payer, because the API lets only an account's owner record its debit (D9). This deviates from the Split artboard, which offers Juan.
15. **Split validation** (Tasks 11–13). **Ruled by the planner (P169):** percents with at most two decimals adding to 100, exact amounts adding to the total, positive whole units, at least one participant, every share positive; the status line names what is missing; Listo and Save are disabled while invalid (the amount's own errors keep M6a's behaviour).
16. **Fund warning** (Tasks 4, 14). **Ruled by the planner (P170):** after a 201 with `FundBalanceNegative` the form opens the list with `?notice=FundBalanceNegative&account=<id>`; the list reads that fund's current balance from the accounts it already loads and shows `warnings.FundBalanceNegative`; no amount travels in the URL; `pnpm i18n:check` requires `warnings.<Code>` for every warning code of the snapshot. Alternatives rejected: the amount in the query (a figure in history and logs), a flash in `sessionStorage` (a client component on a server-rendered list).
17. **Who paid, in rows** (Task 14). **Ruled by the planner (P171):** in shared and direct spaces an expense row names its payer ("pagó Juan", or the fund's name) and a settlement row reads "{payer} → {receiver}"; `RowContext.memberNames` is empty in a personal space, whose rows are unchanged.
18. **Split with someone** (Task 15). **Ruled by the planner (P172):** only from the personal space's expense form; the people are each registered co-member once (their direct space's member when one exists) and the guests of the person's direct spaces, or a new guest by name; the category travels by its catalog key (the subcategory's, else its parent's), and a category without one is refused before the request; always halves (the API takes no split); afterwards the direct space's list. Alternative rejected: a new endpoint listing counterparts (the members of each space already answer it; one server read per space).
19. **Balance sentences** (Tasks 8, 17, 18). **Ruled by the planner (P173):** a net is "debe", "le deben" or "a paz y salvo" with the absolute amount, from `memberSentence`; suggestion and member sentences use names, never "you", so the story's "Juan owes Ana 150,000 COP" reads the same from every seat; only the header speaks to the viewer.
20. **Settle-up** (Task 19). **Ruled by the planner (P174):** a sheet on the balances screen; payer and receiver among the current members, different; the source account only when the viewer pays, the receiving one only when the viewer receives, both optional; a guest uses none; recorded now in the browser's zone (no date picker in v1); one `Idempotency-Key` per draft; a VIEWER sees no settle-up controls.
21. **Prefill** (Task 19). **Ruled by the planner (P175):** Liquidar prefills a suggestion's payer, receiver and amount; Registrar pago makes the viewer the receiver; `?settle=<memberId>` opens the sheet with that member as payer and their suggestion's amount (the guest sheet's link).
22. **Balance history range** (Task 18). **Ruled by the planner (P176):** a period of the space, the current one by default and `?from=<date>` for another, with previous and next links from `GET …/periods`; entries show the date, the description (or the type), the change and the running balance as a sentence.
23. **Budgets of the new routes** (Task 21). **Ruled by the planner (P177), under the owner's standing delegation of P154:** `/spaces/new` 190, members 200, balances 200, history 190, the shared expense form 215, the invitation and claim pages 185 KiB, set from P154's measured siblings plus the new code; LCP, CLS, TBT and INP unchanged; a second INP run over the split editor; a missed budget is fixed by lazy loading or reported, never raised; a budget may be lowered to its measurement plus 5 KiB.
24. **e2e people and clocks** (Tasks 10, 16, 20). **Ruled by the planner (P178):** other people in a scenario sign up in their own Playwright request contexts with the test's address, and are disposed at its end; each scenario that records money fixes the browser's clock inside the server's fixed period (2026-10-31 12:00 Bogotá) or, for the plan scenario, at 2026-11-08 14:32 Bogotá.
25. **Transaction editing stays out** (scope). **Ruled by the planner (P179):** M6a's follow-up 2 (edit, delete and restore transactions from Activity, P140) is not part of M6b, whose scope is HU-E9-05, HU-E9-06 and HU-E9-07; it stays a follow-up.
26. **Members screen details** (Task 6). **Ruled by the planner (P180):** "Se unió el {date}" from `joinedAt` in the viewer's zone for every registered member (the API has no creator flag, so the artboard's "Creó el espacio" is not shown); a count heading with a plural; the subtitle "{space} · {currency} · {policy}".
27. **Copy to the clipboard** (Task 4). **Ruled by the planner (P181):** `navigator.clipboard.writeText`, announced in a status region; when refused, the read-only field's text is selected and the person is asked to copy it.
28. **The installation's zone** (Task 9). **Ruled by the planner (P182):** `serverZone()` reads `APP_TIMEZONE` (default `America/Bogota`) for dates shown to someone without a profile; no new variable.
29. **Rounding units in the UI** (Task 4). **Ruled by the planner (P183):** `currencyOf` carries each currency's rounding unit (COP whole pesos), pinned to the kernel's by a `.test.ts`.

### Design deviations (the stories and the API win)

1. **Main:** no Copy on pending invitations (only the token's hash is stored, P155); no "Creó el espacio" (P180); dates numeric in the person's format (P130, D23), not "26 oct 2026".
2. **Invite:** the link is created by a button, not ready on open (P162); "vence el 19/10/2026" numeric.
3. **AddGuest:** the name hint reads "Se verá con «(invitado)» al lado" instead of a live "«Pedro (invitado)»".
4. **GuestSheet:** the balance line is the guest's net sentence ("debe $ 100.000") rather than "le debe $ 100.000 a Ana"; the removal refusal is `errors.OutstandingBalance` with the amount (the story's key), not the artboard's sentence.
5. **NewSpace:** no period-policy controls (P161).
6. **InvitePage:** the other-account state does not name the invitation's email (P156); dates numeric.
7. **SharedExpense:** no "Espacio: Hogar. Cambiar" chip (the active space is the URL's, P125); "Según el plan" without the line's name ("Casa"): `GET …/default-split` answers a `lineId` only; the recent-category chips stay deferred (P126).
8. **Split:** a sheet, not a full screen; other registered members are not payers (D9, P168); the account is a chip row "Desde", not a nested picker.
9. **SplitWithPerson:** "Se crea un espacio para los dos" instead of "Se crea «Ana y Luis»", and direct spaces are named "Ana & Luis" by the domain.
10. **FundWarning:** the day headings and per-day totals stay M6a's (P130).
11. **Balances:** suggestions read "Juan le debe $ 100.000 a Ana" (the story's "owes") with a "Liquidar" button whose name says "le paga"; no cross-space hint; the Plan tab is M6c's.
12. **SettleUp:** no date control (records now, P174); the receiver is a choice, not fixed to the viewer.
13. **BalanceHistory:** entry titles are descriptions (the API's entries have no payer or amount); the range moves by period instead of a free range.

### Risks

1. Issue numbers #73, #74 and #75 are inferred, not read (no GitHub access while planning); the controller confirms them first.
2. The 2026-11 plan of the e2e allocation scenario is created and activated while the server's fixed clock reads 2026-11-01T04:30Z (still 31 October in Bogotá); if `createBudgetPlan` or `activateBudgetPlan` refuses a future period, the scenario needs `HEARTH_E2E_FIXED_NOW` for that feature, or the plan step must create the period differently. The acceptance suite creates the same 2026-11 plan under its own clock, which suggests it is allowed.
3. The new budgets are planning figures; Task 21 measures them and stops rather than raise one.
4. The personal record form reads the members of every non-personal space on the server (one loopback call per space); a person in many spaces pays that on each render of the form.
5. `navigator.clipboard` needs a secure context; behind plain HTTP on a LAN the copy falls back to selecting the text (P181).
6. A shared expense's default split is requested from the browser while typing; on a slow network the preselection may arrive after the person already saved, which is harmless (the server applies the same default when `split` is absent) but the preview then showed EQUAL.
7. The split editor and the person sheet load behind `next/dynamic`; the first open of either costs a chunk download, inside the INP budget on the lab's 4G profile but not proven on worse networks.

### Follow-ups

1. Space settings screen: rename, currency (until money is recorded) and period policy (the NewSpace artboard's period controls).
2. Leave and archive a space from the members screen (`POST …/leave`, `POST …/archive`).
3. Editing, deleting and restoring transactions from Activity (P140, P179).
4. A date control in the settle-up sheet.
5. The default split's line name in `GET …/default-split` (for "Según el plan (Casa)"), and the payer and amount in history entries (for "Ana pagó $ 300.000").
6. The Balances artboard's cross-space hint ("En Hogar: debes …").
7. Sending invitation emails once Hearth can send mail (P144), then hide the URL for email invitations.
8. Lower the new budgets after measuring them (P154's follow-up carried).
9. Move HU-E9-05, HU-E9-06 and HU-E9-07 to `Done` in `docs/backlog/README.md` and update their issue bodies (Task 22's notes) when the pull request merges.

### Placeholder and consistency scan

- No "TBD" and no step without its file, its test or its command; every component step names its file, its exported name, its props, the roles and labels its tests query and its catalog keys with both translations.
- Names across tasks: `listPending`, `ListInvitations`, `createListInvitations`, `ListInvitationsResponseSchema` (1); `findByTokenHash`, `spaceNameOf`, `InvitationPreview`, `ClaimPreview`, `PreviewInvitation`, `PreviewClaim`, `createPreviewInvitation`, `createPreviewClaim`, `PreviewDeps`, `InvitationPreviewSchema`, `ClaimPreviewSchema`, `invitationPreviewDto`, `claimPreviewDto` (2); `OPEN_PREFIXES`, `isOpenPath`, `OpenLayout`, `SignUpFormContainer.next`, `SignUpForm.signInHref` (3); `MemberDto`, `InvitationDto`, `CreatedInvitationDto`, `InvitationPreviewDto`, `ClaimPreviewDto`, `BalancesDto`, `SuggestionDto`, `BalanceHistoryDto`, `DefaultSplitDto`, `RecordedExpenseDto`, `DirectSplitDto`, `Problem.outstanding`, `ProblemNotice.detail`, `roundingUnit`, `CopyField`, `warningCodesOf`, `memberDto`, `guestDto`, `invitationDto`, `householdSpace` (4); `NavLinks.spaceKind`, `ProfileSheet.spaceKind`, `SPACE_CURRENCIES`, `NewSpaceForm`, `ChoiceGroup.describedBy` (5); `SpaceRole`, `MemberControls`, `SPACE_CONTROLS`, `controlsFor`, `memberLabel`, `MemberLabelT`, `MemberRow`, `RoleSheet`, `MembersScreen`, `loadMembers`, `MembersContainer` (6); `InviteSheet`, `PendingInvitations` (7); `NetState`, `netState`, `absolute`, `SentenceT`, `memberSentence`, `AddGuestSheet`, `GuestSheet` (8); `serverZone`, `PageState`, `pageStateOf`, `loadPreview`, `InvitationCard`, `InvitationContainer` (9); `Person`, `World.person`, `World.sharedSpace`, `World.join`, `World.memberId`, `World.dispose` (10); `ShareMethod`, `SplitMethod`, `SPLIT_METHODS`, `ParticipantValue`, `SplitCheck`, `allocateMinor`, `previewSplit`, `Payer`, `SplitDraft`, `participantsOf`, `splitCheckOf`, `sharedPartsOf` (11); `DefaultSplitState`, `useDefaultSplit`, `DEFAULT_SPLIT_DELAY_MS`, `SplitSheet` (12); `SharedExpenseContext`, `sharedContextOf`, `initialSplitDraft`, `SharedFields`, `RecordForm.shared` (13); `afterSaveUrl`, `SavedNotice`, `RowContext.memberNames` (14); `Person` (ledger's, `direct/counterparts.ts`), `peopleOf`, `DirectChoice`, `categoryKeyOf`, `directBodyOf`, `SplitWithPersonSheet`, `RecordForm.people` (15); `loadBalances`, `BalancesScreen`, `BalancesContainer` (17); `loadBalanceHistory`, `BalanceHistory`, `HistoryContainer` (18); `SettlementDraft`, `SettlementField`, `settlementRequestOf`, `settlementFieldOf`, `prefillOf`, `SettleUpSheet` (19); `routeUrl`, `isVisitorRoute` (21). Two `Person` types exist in different worlds (the e2e support's and the ledger UI's); neither imports the other.
- Environment variables: none new (`APP_TIMEZONE` is read by `serverZone()`).
- Migrations: none. OpenAPI changes: Tasks 1 and 2 only.
- New dependencies: none; `pnpm check:pinned` and the lockfile are untouched.

## Open questions for the owner

None. Every decision was ruled under the owner's standing instruction (L1) and is listed above (P155–P183); the design deviations are collected for the owner's end review.
