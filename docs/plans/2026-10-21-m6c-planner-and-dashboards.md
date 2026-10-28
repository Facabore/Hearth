# M6c Budget Planner, Space Dashboards and Personal Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the web UI of milestone M6c: a household admin builds the period's plan in a planner screen (capacities with a private suggestion, lines with funding, categories and allocation rules, a copy of the previous plan, and the cycle draft → active → closed; HU-E9-08, #76); every member reads the space's dashboards (planned, spent and available per line, a period without a plan, the member matrix, fund tracking, spending by group with drill-down, and a desktop layout; HU-E9-10, #78); and every person reads their personal dashboards (the unified view across spaces, their spending by group with merged rows, a six-period consumption trend and the line trend; HU-E9-11, #79). The bottom bar gains the Plan tab, which ruling P141 kept hidden until these screens existed. M6c also takes in three issues the owner moved into it (Log L2):
- a warning before saving an expense that takes a plan line past 90 % or over, with each line's state on the dashboard (#142);
- each line's carry-over from the previous closed plan, shown with its source and explained, sinking funds included (#143);
- a cash-flow calendar of the next 30 and 60 days (#150).

**Architecture:** M6a's architecture holds unchanged (rulings P117–P154): pages under `src/app/(web)`, Server Component containers that read `/api/v1` over loopback through the generated client, writes in the browser through `browserApi()`, presentational components over DTOs and serializable `formats`, and every string in the `es` and `en` catalogs. Two module UI folders are new: `src/modules/budgeting/ui/` (the planner, capacities and the line editor) and `src/modules/reporting/ui/` (the dashboards). All of them live under one Plan tab at `/spaces/{spaceId}/plan`. Its views depend on the space's kind (ruling P200): a shared space shows Lines, Members, Fund, By group and Trend, and the personal space shows My spending, By group, Trend and Lines. The planner lives at `/spaces/{spaceId}/plans/{planId}`, and a dashboard finds it through the `plan` its report answers. **Figures are the API's, never the UI's** (ruling P201). One small backend task comes first: the line dashboard and fund tracking answer their totals, so the summary cards need no sum in the browser. **Bars are HTML and charts are lazy** (ruling P202). The planned/spent bars, the fund bars and the by-group bars are table cells and buttons with CSS widths, so the table and the chart are one element. Recharts 3.10.1 draws only the two time series (the personal trend and the line trend). It sits behind a `React.lazy` import that runs after mount, and dependency-cruiser keeps every other route from importing it. Every new route gets its script budget in `tests/performance/budgets.json` (ruling P221, following P134 and P154). The three additions bring four more backend tasks right after Task 1 (ruling P227):
- the line dashboard names each category's line and each line's state (Task 1b);
- the ledger lists a space's scheduled movements (Task 1c);
- `GET /api/v1/me/cash-flow` projects the caller's own money (Task 1d);
- a line carries only from a closed plan and names it (Task 1e).

The record form checks an expense against its line in the browser, with no request at Save (ruling P233).

**Tech Stack:** Node.js 24.21.0, pnpm 12.11.2, Next.js 16.4.0 (App Router), React 19.3.0, TypeScript 6.0.3 strict, next-intl 4.14.9, Tailwind CSS 4.3.3, `radix-ui` 1.7.0, `openapi-typescript` 7.13.0 + `openapi-fetch` 0.17.0, Vitest 5.0.3 (projects `unit`, `ui`, `integration`, `acceptance`), jsdom 30.1.2, Testing Library, axe-core 4.13.0, Playwright 1.63.0 with `playwright-bdd` 9.2.1 and `@axe-core/playwright` 4.13.0, Lighthouse 13.5.0 and `web-vitals` 6.2.3. **New:** `recharts` 3.10.1 and its peer `react-is` 19.3.0 (ruling P203).

**Spec:** `docs/specs/2026-10-11-hearth-design.md` (D7 figures on read, D11 unified view, D17 capacity suggestion, D18 the API is the contract, D23 formats never from the language; spec 5.2–5.4 plans, allocation and reports). Stories: `docs/backlog/E9-web-ui.md` HU-E9-08, HU-E9-10 and HU-E9-11, read with the epic's rules at the top of the file. The API stories behind them are `docs/backlog/E6-budgeting.md` (HU-E6-01 … HU-E6-09) and `docs/backlog/E7-reporting.md` (HU-E7-01 … HU-E7-06; the "E7 shared fixture" and the HU-E7-04 fixture the scenarios name). **Reference design:** the canvas "Hearth Web UI — Batch 2", files in `.superpowers/sdd/design-batch2/`. The M6c artboards are Planner, Capacity, LineEditor, CopyPlan, Lines, NoPlan, Matrix, Fund, ByGroup, DashDesktop, Unified, PersonalByGroup, PersonalTrend and LineTrend. The owner has not formally reviewed Batch 2. Under the standing instruction of 2026-10-20 (Log L1) the canvas is the reference: where a story and an artboard disagree, the story wins, and every deviation is listed in the Self-Review ("Design deviations") for the owner's later review. Format template and precedent: `docs/plans/2026-10-20-m6a-web-shell-and-ledger.md`. Rulings in force: P1–P154 (the M6b plan's P155–P199 too). This plan rules **P200–P247**. Issues #142, #143 and #150, their bodies and the owner's comments, are the spec of Tasks 1b–1e, 3b, 3c, 8b, 15b and 17c. So is the coordinator's evidence from a hands-on test of the competitor on 2026-10-21 (Log L3).

**Baseline: `development` with M6a (Tasks 1–19, `aed175b` and the Task 19 commit) and all of M6b merged.** Verified while planning, at `aed175b` plus the staged Task 19:
- The snapshot has every endpoint these screens call. The budgeting ones are `POST …/plans` (with `copyFrom: "previous"`), `GET …/plans/{planId}`, `PUT …/capacities`, `GET …/capacity-suggestion`, `POST …/lines`, `PATCH` and `DELETE …/lines/{lineId}`, `PUT …/lines/{lineId}/categories`, `PUT …/lines/{lineId}/allocation`, `POST …/activate` and `POST …/close`. Every plan write takes `If-Match: "<version>"` and none takes an `Idempotency-Key`. The reporting ones are `GET …/reports/lines`, `…/member-matrix`, `…/fund-contributions`, `…/spending-by-group` and `…/trend`, and `GET /api/v1/me/unified-view`, `/me/trend` and `/me/reports/spending-by-group`.
- There is no "plan of a period" endpoint. The planner is reached through the `plan: { id, status } | null` that every space report answers (ruling P200).
- A failed activation answers 422 `InvalidAllocation` with `lineIds` (a public `Problem` field that `problemFrom` does not keep, so Task 4 reads it from the raw body).
- The line dashboard and fund tracking answer no totals (Task 1 adds them).
- Shares and percentages are two-decimal strings (`"36.75"`, `"-3.70"`). `formatNumber` drops a zero fraction, so percentages need their own formatter (Task 2).
- `src/shared/ui/format/currencies.ts` has no rounding unit, while the kernel's COP rounds to whole pesos (`roundingUnit: 100n`).
- `NavLinks` renders Inicio, Registrar and Movimientos, plus the Saldos tab M6b adds.
- `recharts` 3.10.1 was published on 2026-07-25 and `react-is` 19.3.0 on 2026-09-09, both read from the registry on 2026-10-20 (`npm view recharts time`, `npm view react-is time`).

Verified while planning the additions, on `development` at `2e06b9d` (M6c Task 1 is `a979741`):
- Rollover is already in the API (HU-E6-09, ruling P15). A line's `rolloverMode` is RESET, ROLLOVER or ADJUSTED, and both the plan's lines and the line dashboard answer `carryOver`. The carry is read from the plan a copy came from, whatever that plan's status (Task 1e narrows it). Task 7's editor offers the modes; no screen shows the carried amount.
- An expense's `warnings` (P170) arrive in the answer of the save; nothing answers before it.
- The line dashboard does not say which line a category feeds, nor how near its plan a line is (Task 1b).
- Recurrences and their pending occurrences are the ledger's (HU-E4-11 … HU-E4-13). Nothing projects them forward but `GET …/recurrences/{id}/occurrences`, one recurrence at a time (Tasks 1c, 1d).
- The M6b addendum's toast (A4) and the record form's `edit` prop (A7) are planned, not yet on `development`.

M6b's internals are not assumed: the e2e seeding, the test builders and the DTO aliases of this plan live in their own files. Where M6b already exports the same name (`SpaceMemberDto`), the task says to reuse it.

**Out of scope (later plans):** HU-E9-05, 06 and 07 (M6b), HU-E9-09 (recurrences), HU-E9-12 and HU-E9-14. Plan figures on the Home screen are left out: no M6c story asks for them, and the Batch 1 Home artboard's plan card is a follow-up. So are a "Register a fund contribution" form (the Fund artboard's button: the M6a record form has no contribution kind), a line trend of the personal space, editing a plan's period, deleting a plan, and per-member capacity history. #128 (report latency) is covered as far as the LCP budgets of the new routes reach (ruling P221). Its 24-plan probe stays open. The follow-ups of #142, #143 and #150 are listed in the Self-Review (follow-ups 11–16).

### Log

- **L1**, the owner, 2026-10-20: "Tu enfoque es terminar lo que tenemos en las HUS siempre con TDD y RDD, tienes granted para todo, resolvé con lo que tengas, luego al final organizamos las ideas de cosas pendientes"
- **L2**, the owner, 2026-10-21, about #142, #143 and #150: "Dale, metelas en M6c y seguí."
- **L3**, the coordinator, 2026-10-21: evidence from a hands-on test of the competitor HomeCents, to rule against explicitly. It covers five pitfalls:
  - rollover credited a whole month to a budget with no history;
  - an envelope read "5125% spent" with no warning state;
  - the forecast spread one day of spending over the month;
  - a 2027-03-15 reminder showed on 14/03, a time-zone bug;
  - "Settle" recorded every balance at once with no confirmation.

  Rulings P243–P247.

## Global Constraints

- Versions: Node.js `24.21.0`; pnpm `12.11.2`; Next.js `16.4.0`; React `19.3.0`; TypeScript `6.0.3` (`strict`, `noUncheckedIndexedAccess`); Zod `4.6.5` (server only); next-intl `4.14.9`; Vitest `5.0.3`; Playwright `1.63.0`; PostgreSQL `postgres:18.6-alpine`. **New dependencies, exact pins only** (`pnpm check:pinned`), each published on or before 2026-10-07: dependencies `recharts 3.10.1` and `react-is 19.3.0`. Nothing else: no `d3`, no chart plugin, no date library, no icon set.
- **The UI talks only to `/api/v1` through the generated client** (P117, P119; `pnpm lint:boundaries`). No server action, no route handler for the UI, no import of a module's `domain`, `application`, `infrastructure` or `contracts` from any `ui` folder or page. Module UIs reach each other only through `ui/index.ts` (client-safe) and `ui/server.ts` (server containers, P153).
- **Figures come from the API** (ruling P201). The UI never sums, subtracts or recomputes an amount or a share it shows. Totals, shares, `available`, `gap`, `change` and `changePercent` are rendered as answered. Bar widths are presentation, not figures. Two labelled previews are the exceptions: the allocation editor's assigned amounts, which the server overrides on save (ruling P211), and the record form's line warning, which the dashboard's answered figures follow (ruling P235). The warning's levels are the API's own `lineStateOf` (ruling P244). The capacity form shows the stored total until the save answers (ruling P208).
- **Every UI string is translatable** (es default, en): visible text, `aria-label`s, captions and `<title>`s come from `src/i18n/messages/{es,en}.json`; `pnpm i18n:check` fails on a key in one catalog only. Spanish copy is neutral Latin American *tú* ("Elige", "Revisa", "Toca"), never *voseo*. User data (space, line, category, member and account names) is shown as stored. A space-scoped name is written through one pattern, `reports.spaceScoped` "{space} / {name}", never by joining strings in code.
- **Numbers, dates, times and percentages come from the person's effective preferences**, never from the language: only `src/shared/ui/format/` formats (P121; `tests/architecture/ui-formatting.test.ts`). Percentages keep their two decimals ("40,00 %", ruling P204).
- **Accessibility:** every control has a label, every screen works with the keyboard alone, focus is visible, touch targets are at least 44 px, contrast meets WCAG AA in light and dark. Every chart sits in a `figure` whose `figcaption` names it, and the chart's SVG is `aria-hidden`. The table next to it carries the same figures and is the accessible source (ruling P220). Component tests run axe-core (contrast off in jsdom), and the e2e run scans every new screen in light and dark.
- **Performance budgets fail CI** (P134, P154): every new route has its script budget in `tests/performance/budgets.json` (ruling P221), plus LCP ≤ 2500 ms, CLS ≤ 0.1 and TBT ≤ 200 ms. INP ≤ 200 ms covers the drill-down and the allocation editor (Task 18). No route without a chart ships Recharts (ruling P202, enforced by dependency-cruiser).
- Plan writes send `If-Match: "<plan.version>"` and keep the plan the API answers (ruling P206). A 412 shows `errors.PreconditionFailed` and re-reads the plan.
- Strict TDD: every behaviour starts with a failing test that is run and seen failing. Pure logic (`*.test.ts`) runs in `unit`, components and containers (`*.test.tsx`) in `ui`, `@e2e` scenarios in Playwright + playwright-bdd against the standalone build and a disposable PostgreSQL. Task 1 follows the backend's conventions (use case, contract, acceptance test, `openapi/openapi.snapshot.json` regenerated and never edited by hand).
- Code, identifiers, comments, docs and generated artifacts in English; UI copy in the catalogs. Conventional commits referencing the story issue (`Refs #76`, `#78`, `#79`, and `#142`, `#143`, `#150` for the additions); no AI attribution or `Co-Authored-By` lines.
- Agents never read or edit `.env`, `.env.*` or `.env.production.example` (P114). M6c adds no environment variable.
- Gates for every task: `pnpm exec vitest run --project unit`, `--project ui`, `--project integration`, `--project acceptance`, `pnpm format`, `pnpm exec eslint .`, `pnpm exec tsc --noEmit`, `pnpm exec prettier --check .`, `pnpm lint:boundaries`, `pnpm db:check`, `pnpm check:pinned`, `pnpm api:check`, `pnpm i18n:check`; from Task 3 on also `pnpm build`; from Task 17a on `pnpm test:e2e` (Docker running); in Task 18 `pnpm perf`.

## Review Focus

1. **A figure the browser invents.** A total summed in the UI, a share recomputed from amounts, a gap derived from assigned minus contributed, or a percentage rounded again. Expected: every amount and share on a dashboard is a field of its response, rendered by `formatMoney`, `formatSignedMoney` or `formatPercent`. Pinned in Task 1 (the API answers the totals), Tasks 3, 9–13 and 15 (the tests feed figures that no sum of the rows reproduces, so a sum in the UI fails), and Task 11 (shares as answered, `"56.94"` → "56,94 %").
2. **The private suggestion leaking.** Ana's suggested capacity on Juan's screen, a suggestion inside the shared plan DTO, or a suggestion fetched in the browser for another member. Expected: only the capacities container asks for it, with the request's own cookie. It is rendered only next to the row whose `memberId` the answer names, and only when that member is the viewer. Pinned in Task 6 (Ana sees hers, Juan sees only his own, and an answer naming another member is never shown).
3. **Lost and conflicting plan writes.** Two tabs editing one plan, a save that patches the line and then fails on its allocation, or a double click on Activate. Expected: every write carries the version of the last answer, a 412 re-reads the plan and says so, a failed step keeps what was already saved and points at its section, and the lifecycle buttons are disabled while a call is pending. Pinned in Task 4 (`planWrite`, the 412 path and the pending state), Task 7 (`saveLine` with the line step) and Task 8 (the categories and allocation steps, version by version).
4. **Allocation previews that disagree with the server.** 730,000 COP at 42 % / 58 %, a sum of 99 %, a FIXED sum off by one peso, and COP rounding to whole pesos. Expected: the preview reads 306,600 / 423,400, a sum of 99 % blocks the save with `errors.InvalidAllocation` and "99,00 %", and `allocate` gives exactly what the kernel's `Money.allocate` gives. Pinned in Task 8 (`allocate` checked against `Money.allocate` over several cases, and the story's numbers).
5. **Roles and closed plans.** A VIEWER with an Edit link, a MEMBER changing Juan's capacity, Create plan offered to a MEMBER, or a CLOSED plan still editable. Expected: managers (OWNER, ADMIN) edit, a MEMBER changes only their own capacity, VIEWERs and every CLOSED plan are read-only, and the API's `InsufficientRole` is still translated if it answers. Pinned in Task 4 (`canManage`, the planner's controls), Task 5 (the no-plan actions) and Task 6 (capacity rows).
6. **Charts that cost every route or hide their data.** Recharts imported by a page without a chart, a chart that is the only source of its figures, or a chart that fails axe. Expected: dependency-cruiser fails a static import of a chart file and any import of `recharts` outside `reporting/ui/charts/`, every chart has a table of the same series, and both trend routes pass the axe scans. Pinned in Task 14a (the rules and their fixtures, the lazy wrapper's test), Tasks 14b and 15 (table and chart from one series) and Task 17b (axe on both trend routes).
7. **Drill-down that drifts from the response.** A second request when tapping a group, a subcategory level for a category without subcategories, the "no subcategory" entry shown as an empty name, or an archived node without its badge. Expected: one request per screen, client-side levels, `reports.byGroup.noSubcategory` and `reports.byGroup.archived`, and breadcrumb buttons that go back up. Pinned in Task 11 (`spending-tree` and the chart tests) and Task 13 (merged and space-scoped rows).
8. **A warning that slows, blocks or disagrees.** A request on Save, a confirmation for a line at 60 %, a check against a DRAFT plan or another period, a warning that forbids saving, a share measured on planned alone when the line carries money, a dashboard state that differs from the form's warning, or a percentage above 100 %. Expected: Save sends its one request; NEAR (from 80 %) is a note, and HIGH (above 90 %) and OVER ask once and save on "Guardar de todos modos"; the base is planned + carry-over; both screens use `lineStateOf`; an overage is an amount in words. Pinned in Task 1b (`lineStateOf`, `categoryLines`, the states), Task 3b (the badges), Task 3c (the boundaries, one request, no "%" when OVER) and Task 17c.
9. **Carry-over that is invented, hidden or breaks capacity.** A carry from a plan that is not CLOSED, a carry into a line its source never had, a carry with no source on screen, a carry counted against capacity, or a negative carry under ROLLOVER. Expected: only a CLOSED origin carries, every carry names its plan or the plan it waits for, capacity counts planned amounts only, and ROLLOVER floors at 0. Pinned in Task 1e (the closed gate, `carryOverFrom`, the HU-E6-09 outline with November CLOSED and ACTIVE), Task 8b (the capacity pin, the carry texts) and Task 17c (both rollover scenarios).
10. **A projection that counts someone else's money, counts twice or drifts in time.** A fund-paid bill in Ana's calendar, a transfer between two counted accounts moving her balance, a pending occurrence listed twice, a past due date placed in the past, a pace estimate from one expense, a date shifted by a time zone, or a balance the browser runs. Expected: only movements of the caller's own accounts, effects by counted accounts, a pending occurrence once and on today, no pace, local dates throughout, and balances answered per date. Pinned in Tasks 1c, 1d (the start of a Bogotá day, the one-off expense) and 15b ("2027-03-15", no action).

## Execution Workflow

- Work on the long-lived branch `development` (M6a and M6b merged). Implement every task there with Strict TDD. Implementers stage; the controller commits.
- **Commit this plan before Task 1.** The controller commits it on `development` first (`docs(plans): add the M6c planner and dashboards plan (Refs #76, Refs #78, Refs #79)`), because Task 18 adds it to the `mkdocs.yml` nav and `mkdocs build --strict` fails on a page missing from the repository.
- **RDD before every commit** (receipt-driven development is on; check with `gentle-ai review mode status`). Each "Commit" step means:
  1. Run every source-mutating normalizer first (`pnpm format`, and `pnpm api:types` when the snapshot changed), then stage exactly the task's files.
  2. Run `gentle-ai review assess --cwd . --agent claude-code --json` over the staged candidate. When `review_due` is true, run the returned preflight STATUS with your `--lenses` and `--lenses-reason`, follow only the returned `next_transition`, and answer a consent envelope with `granted` (the owner's standing answer).
  3. Commit after the review is acknowledged, or after `review_due` is false. The commit must not change the reviewed bytes.
  4. If the owner disables RDD, commit under ordinary policy and report `disabled/unmanaged`.
- Code blocks are complete where they decide something: configuration, pure functions, exact copy and test files. Their wrapping may not match Prettier's, so run `pnpm format` before the gates. Every code block is introduced by a line naming its file in backticks. "Create" blocks are whole files; edits name a unique anchor line. For React components the plan fixes:
  - the file, the exported name and the props;
  - the roles and labels the tests query;
  - the catalog keys, in both languages.

  The markup follows the named artboard.
- **Task labels and order:** 1, 1b, 1c, 1d, 1e, 2, 3, 3b, 3c, 4, 5, 6, 7, 8, 8b, 9, 10, 11, 12, 13, 14a, 14b, 15, 15b, 16, 17a, 17b, 17c, 18. That is 29 commits, and each lettered task is a separate commit and RDD pass, green on its own.
  - Tasks 1b, 1c, 1d, 1e, 3b, 3c, 8b, 15b and 17c come from #142, #143 and #150 (Log L2, ruling P227). Each sits after the tasks it depends on and names them. Their letters mark a place in the order, not split passes of the task before them.
  - Task 3c also waits for the M6b addendum's A4 and A7. If they have not landed, Task 4 goes on, and 3c runs once they do.
  - Task 1e names Risk item 3. It commits alone and gets an independent verifier.
- **Sizes (estimated while planning):** each task is one commit sized for review, with a target under ~400 changed lines. A task over ~500 is split at its named split point into two commits, each green on its own. Excluded from the count, as in M6a: `pnpm-lock.yaml`, the generated `src/shared/ui/api/schema.d.ts`, and snapshot regenerations of more than 30 lines. Estimates:

  | Task | Lines | Split point, if it goes over ~500 |
  |---|---|---|
  | 1 | ~220 | |
  | 1b | ~260 | |
  | 1c | ~260 | |
  | 1d | ~520 | `cash-flow.ts` and its test \| the use case, contract, route, wiring and acceptance test |
  | 1e | ~330 | |
  | 2 | ~330 | |
  | 3 | ~430 | views, frame, tabs and nav link with their tests \| the line dashboard, its container and the page |
  | 3b | ~120 | |
  | 3c | ~420 | |
  | 4 | ~470 | `plan-write.ts`, `plan-access.ts`, the status badge and their tests \| the planner, its container and the page |
  | 5 | ~300 | |
  | 6 | ~360 | |
  | 7 | ~430 | `line-draft.ts`, `line-save.ts` and their tests \| the editor, its container and the pages |
  | 8 | ~480 | `allocation.ts`, the allocation editor and their tests \| the mapping sheet, the save steps and the editor wiring |
  | 8b | ~280 | |
  | 9 | ~300 | |
  | 10 | ~250 | |
  | 11 | ~420 | `spending-tree.ts` and its test \| the chart, the breadcrumb, the container and the page |
  | 12 | ~330 | |
  | 13 | ~180 | |
  | 14a | ~330 | |
  | 14b | ~300 | |
  | 15 | ~330 | |
  | 15b | ~400 | |
  | 16 | ~330 | |
  | 17a | ~380 | |
  | 17b | ~380 | |
  | 17c | ~380 | |
  | 18 | ~380 | |

  The controller measures each staged candidate (`git diff --cached --numstat`, with the exclusions above) before RDD, and splits it at the named point when it is over ~500.
- The OpenAPI snapshot changes only in Tasks 1, 1b, 1d and 1e, each regenerating `src/shared/ui/api/schema.d.ts` in the same commit (P139).
- When a task starts, move its story issue to **In Progress** on Project #4. When all tasks are done, open one pull request from `development` into `main` that closes #76, #78, #79, #142, #143 and #150 and completes milestone M6's Must web UI. Its description lists, as PR notes:
  1. the API changes of Tasks 1 (the totals), 1b (`categoryLines`, `state`, `overBy`), 1d (`/me/cash-flow`) and 1e (a carry only from a CLOSED plan, `carryOverFrom`: a change of meaning, Risk item 3);
  2. the new dependencies and why (P203);
  3. the new budgets and their measurements (P221);
  4. the rulings P200–P247;
  5. the design deviations for the owner's review of Batch 2;
  6. the follow-ups.
- Task-to-issue map: HU-E9-08 (#76) → Tasks 4, 5, 6, 7, 8, 17a; HU-E9-10 (#78) → Tasks 1, 3, 9, 10, 11, 16, 17b; HU-E9-11 (#79) → Tasks 12, 13, 14a, 14b, 15, 17b; #142 → Tasks 1b, 3b, 3c, 17c; #143 → Tasks 1e, 8b, 17c; #150 → Tasks 1c, 1d, 15b, 17c; Task 2 references #78; Task 18 references #76, #78, #79, #142, #143 and #150.

## File Structure

```
.
├── package.json, pnpm-lock.yaml               # recharts 3.10.1, react-is 19.3.0 (14a)
├── .dependency-cruiser.cjs                    # charts-load-lazily, recharts-only-in-charts; *.test.tsx excluded (14a)
├── openapi/openapi.snapshot.json              # totals (1); categoryLines, state, overBy (1b); /me/cash-flow (1d); carryOverFrom (1e)
├── src/
│   ├── modules/reporting/{application,contracts}/…          # totals (1); categoryLines, states (1b); get-cash-flow (1d); carryOverFrom (1e)
│   ├── modules/reporting/domain/cash-flow.ts                 # the projection (1d)
│   ├── modules/budgeting/{domain/plan-figures.ts, application/plan-view.ts}   # categoryLinesOf (1b); CarrySource, the closed gate (1e)
│   ├── modules/ledger/{domain/recurrence.ts, application/scheduled-movements.ts}   # datesThrough, accountsMovedBy, listScheduledMovements (1c)
│   ├── shared/kernel/line-state.ts                           # lineStateOf (1b)
│   ├── app/api/v1/me/cash-flow/route.ts                      # (1d)
│   ├── modules/ledger/ui/record/{line-watch.ts, line-warning.tsx, record-form.tsx, record-form-container.tsx}   # (3c)
│   ├── shared/ui/
│   │   ├── api/{schema.d.ts (regenerated), dto.ts}            # (1, 3, 4, 9–15)
│   │   ├── format/{formatters.ts, currencies.ts}               # formatPercent, formatSignedMoney, roundingUnit (2)
│   │   ├── time/period-name.ts                                 # moved from ledger/ui/home (2)
│   │   ├── molecules/{period-text.ts, period-switcher.tsx}     # (2)
│   │   └── icons/ui-icons.ts                                   # chart, pencil, arrowUp, arrowDown (2)
│   ├── modules/spaces/ui/nav-links.tsx                         # the Plan tab (3)
│   ├── modules/budgeting/ui/
│   │   ├── plan-status-badge.tsx, plan-access.ts, plan-write.ts             # (3, 4)
│   │   ├── carry-text.tsx                                                   # (8b)
│   │   ├── planner/{planner.tsx, planner-container.tsx}                     # (4, 5)
│   │   ├── plan-start.tsx, copy-notice.tsx                                  # (5)
│   │   ├── capacities/{capacity-draft.ts, capacity-form.tsx, capacities-container.tsx}   # (6)
│   │   ├── line-editor/{line-draft.ts, line-save.ts, line-editor.tsx, line-editor-container.tsx,
│   │   │                allocation.ts, allocation-editor.tsx, category-mapping-sheet.tsx}  # (7, 8)
│   │   ├── index.ts, server.ts
│   ├── modules/reporting/ui/
│   │   ├── views.ts, report-period.ts, dashboard-frame.tsx, plan-tabs.tsx    # (3)
│   │   ├── lines/{line-dashboard.tsx, no-plan.tsx, lines-container.tsx}      # (3, 5); states (3b); carry-over (8b)
│   │   ├── calendar/{cash-flow-calendar.tsx, calendar-container.tsx}         # (15b)
│   │   ├── matrix/…, fund/…                                                 # (9, 10)
│   │   ├── by-group/{spending-tree.ts, spending-chart.tsx, drill-breadcrumb.tsx, by-group-container.tsx}  # (11, 13)
│   │   ├── unified/…                                                        # (12)
│   │   ├── charts/{chart-frame.tsx, lazy-trend-chart.tsx, trend-chart.tsx, trend-series.ts}  # (14a)
│   │   ├── trend/{change-text.tsx, personal-trend.tsx, line-trend.tsx, containers}   # (14b, 15)
│   │   ├── overview/{dash-overview.tsx}                                     # (16)
│   │   ├── index.ts, server.ts
│   ├── i18n/messages/{es,en}.json                               # namespaces budgeting, reports; shell.nav.plan; common
│   └── app/(web)/(app)/spaces/[spaceId]/
│       ├── plan/{page.tsx, lines/page.tsx, members/page.tsx, fund/page.tsx, groups/page.tsx, trend/page.tsx, calendar/page.tsx}
│       └── plans/[planId]/{page.tsx, capacities/page.tsx, lines/new/page.tsx, lines/[lineId]/page.tsx}
├── tests/
│   ├── support/ui/plan-dto.ts                                   # builders for plans and reports (3 on)
│   ├── architecture/{boundaries.test.ts, fixtures/chart-*}      # (14a)
│   ├── acceptance/cash-flow.test.ts                             # (1d); budget-rollover.test.ts (1e)
│   ├── e2e/{features/line-warning.feature, features/rollover.feature, features/cash-flow.feature,
│   │        steps/additions.steps.ts, layout.spec.ts}           # (17c)
│   ├── e2e/{features/budget-planner.feature, features/dashboards.feature, steps/plan.steps.ts,
│   │        steps/dashboards.steps.ts, support/plan-seed.ts, a11y-plan.spec.ts, perf/inp-plan.spec.ts}   # (17a, 17b, 18)
│   └── performance/{budgets.json, lighthouse.mjs, seed-plan.mjs, routes.test.mjs}   # (18)
└── docs/ (decisions, backlog E7 and E9, architecture, stack-versions, mkdocs.yml)   # (1, 18)
```

Test layout as in M6a: pure UI logic (`*.test.ts`) runs in the `unit` project, and components and containers (`*.test.tsx`) run in `ui`, next to their code. Run one file with `pnpm exec vitest run --project ui <path>`. Test builders for M6c's DTOs live in `tests/support/ui/plan-dto.ts`, so they never collide with M6b's additions to `tests/support/ui/dto.ts`.

### How the UI reads and writes

| Need | Where it runs | Through |
|---|---|---|
| A dashboard's data (a report, its period's neighbours, the members, the space) | Server Component container (`load*` over the `Api`) | `serverApi()` and `getSpaces()`, `getMe()` (P117, P127) |
| The current period when `?period=` is absent | The same container | `GET …/periods?from=<today in the viewer's zone>&count=1` (ruling P205) |
| The plan, its members, categories and accounts for the planner screens | Server Component container | `serverApi()` |
| The capacity suggestion | The capacities container only, on the server, with the request's cookie | `GET …/plans/{planId}/capacity-suggestion` (ruling P208) |
| Create or copy a plan, set capacities, add, edit or remove a line, map categories, allocate, activate, close | Client component | `browserApi()` with `If-Match: "<version>"`; the client keeps the answered plan (ruling P206) |
| Drill-down by group | Client component over the one response | no request (HU-E9-10 note, ruling P215) |
| A trend chart | Client component, after mount, from a lazy chunk | no request: the server already passed the series (ruling P202) |
| The record form's line watch | The record form's server container, beside its other reads | `GET …/periods?from=<today>&count=1`, then `GET …/reports/lines?period=` (ruling P236); a failed read means no warning |
| The line warning and its confirmation | Client, in the record form, from the watch | no request (rulings P233, P235) |
| The cash-flow calendar | Server Component container of the personal Plan tab | `GET /api/v1/me/cash-flow?days=30\|60` (ruling P238) |

---

### Task 1: The line dashboard and fund tracking answer their totals

The Lines artboard's summary card ("Disponible $ 1.190.000 · Gastado $ 2.810.000 de $ 4.000.000") and the Fund artboard's ("Esperado $ 1.200.000 · Aportado $ 980.000") show sums that no response carries today. Ruling P201 keeps every figure the API's, so the reports answer them: `GET …/reports/lines` gains `totals` and `GET …/reports/fund-contributions` gains `totals`. The change is additive; no field changes meaning.

**Files:**
- Modify: `src/modules/reporting/application/get-line-dashboard.ts`, `src/modules/reporting/application/get-fund-contributions.ts`, `src/modules/reporting/contracts/reporting.contract.ts`, `src/modules/reporting/application/line-dashboard.test.ts`, `src/modules/reporting/application/fund-tracking.test.ts`, `src/modules/reporting/contracts/reporting.contract.test.ts` (only where it builds a `LineDashboard` or `FundContributionReport` by hand: `tsc` names each place), `tests/support/reporting.ts`, `tests/acceptance/reports-lines.test.ts`, `tests/acceptance/reports-fund-contributions.test.ts`, `openapi/openapi.snapshot.json` (regenerated), `src/shared/ui/api/schema.d.ts` (regenerated), `docs/backlog/E7-reporting.md`

**Interfaces:**
- Consumes: `DashboardLine`, `UnbudgetedSpending`, `FundContribution`, `moneyOf`, `MoneySchema`.
- Produces: `interface LineTotals { planned: bigint; spent: bigint; available: bigint }` and `LineDashboard.totals: LineTotals`, where `planned` = Σ lines' planned, `spent` = Σ lines' spent + unbudgeted spent, and `available` = Σ lines' available + unbudgeted available. `interface FundTotals { expected: bigint; actual: bigint; difference: bigint }` and `FundContributionReport.totals: FundTotals` (Σ over the listed members). On the wire: `totals: { planned, spent, available }` and `totals: { expected, actual, difference }`, every one a `Money`. Tasks 3, 10 and 16 render them.

- [ ] **Step 1: Write the failing application tests**

`src/modules/reporting/application/line-dashboard.test.ts`, inside `describe("line dashboard (HU-E7-01)", …)`, after the golden test:

```ts
  it("answers the totals the summary card shows: lines plus Unbudgeted (ruling P201 of M6c)", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", referenceParts());
    w.spending.expenses[NOVEMBER] = novemberSpending();
    expect(unwrap(await read(w)).totals).toEqual({
      planned: pesos(4_000_000),
      spent: pesos(2_810_000),
      available: pesos(1_190_000),
    });
  });

  it("totals a period without a plan from its Unbudgeted spending alone", async () => {
    const w = reportingWorld();
    w.spending.expenses["2027-01-01"] = [{ categoryId: "cat-groceries", amount: pesos(100_000) }];
    expect(unwrap(await read(w, "u-ana", "2027-01")).totals).toEqual({
      planned: 0n,
      spent: pesos(100_000),
      available: -pesos(100_000),
    });
  });
```

(The second test uses the same `expenses` key shape as the file's existing "period without a plan" test; if that test keys the map by another date, use its key.)

`src/modules/reporting/application/fund-tracking.test.ts`, inside its `describe`, after the golden test:

```ts
  it("answers the totals of expected, actual and difference over the listed members (ruling P201 of M6c)", async () => {
    const w = reportingWorld({ members: BUDGET_MEMBERS.slice(0, 2) });
    await w.plan("2026-11", { capacities, lines: referenceLines() });
    w.sums.contributions["2026-11-01"] = [
      { memberId: "member-ana", amount: pesos(480_000) },
      { memberId: "member-juan", amount: pesos(500_000) },
    ];
    expect(unwrap(await read(w, "2026-11")).totals).toEqual({
      expected: pesos(1_200_000),
      actual: pesos(980_000),
      difference: -pesos(220_000),
    });
  });
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/application/line-dashboard.test.ts src/modules/reporting/application/fund-tracking.test.ts`
Expected: FAIL — `totals` is `undefined`.

- [ ] **Step 3: Implement the totals**

`src/modules/reporting/application/get-line-dashboard.ts`: after the `UnbudgetedSpending` interface add

```ts
/**
 * Ruling P201 (M6c): the dashboard's own sums, so a client never adds figures up. `planned` counts the lines only
 * (Unbudgeted plans nothing, HU-E6-04); `spent` and `available` count Unbudgeted too.
 */
export interface LineTotals {
  readonly planned: bigint;
  readonly spent: bigint;
  readonly available: bigint;
}

const totalsOf = (lines: readonly DashboardLine[], rest: UnbudgetedSpending | null): LineTotals => ({
  planned: lines.reduce((sum, line) => sum + line.planned, 0n),
  spent: lines.reduce((sum, line) => sum + line.spent, 0n) + (rest?.spent ?? 0n),
  available: lines.reduce((sum, line) => sum + line.available, 0n) + (rest?.available ?? 0n),
});
```

add `readonly totals: LineTotals;` to `LineDashboard` after `unbudgeted`, and in `createGetLineDashboard` build both returns through it:

```ts
    if (view === null) {
      const spending = await deps.spending.expensesByCategory(space.spaceId, period.start, period.end);
      const rest = unbudgeted(spending.reduce((sum, c) => sum + c.amount, 0n));
      return ok({ ...base, lines: [], unbudgeted: rest, totals: totalsOf([], rest) });
    }
    const { figures } = view;
    const lines = figures.lines.map((f) => ({
      lineId: f.line.id,
      name: f.line.name,
      funding: f.line.funding,
      isCatchAll: f.line.isCatchAll,
      planned: f.line.plannedAmount,
      spent: f.spent,
      carryOver: f.carryOver,
      available: f.available,
      overspent: f.available < 0n,
    }));
    const rest = figures.unbudgeted === null ? null : unbudgeted(figures.unbudgeted.spent);
    return ok({ ...base, lines, unbudgeted: rest, totals: totalsOf(lines, rest) });
```

`src/modules/reporting/application/get-fund-contributions.ts`: add

```ts
/** Ruling P201 (M6c): Σ over the listed members, so the Fund screen's summary is the API's. */
export interface FundTotals {
  readonly expected: bigint;
  readonly actual: bigint;
  readonly difference: bigint;
}
```

add `readonly totals: FundTotals;` to `FundContributionReport`, and replace the `return ok({ … })` with

```ts
    const rows = fundContributions(
      members.map((m) => m.id),
      fundLines,
      actual,
    );
    const sum = (pick: (row: (typeof rows)[number]) => bigint) => rows.reduce((total, row) => total + pick(row), 0n);
    return ok({
      spaceId: space.spaceId,
      currency: space.currency,
      period,
      plan: reportPlanOf(view),
      members: rows,
      totals: { expected: sum((r) => r.expected), actual: sum((r) => r.actual), difference: sum((r) => r.difference) },
    });
```

- [ ] **Step 4: Write the failing contract and acceptance checks**

`tests/acceptance/reports-lines.test.ts`, in the golden test after the `unbudgeted` expectation:

```ts
    expect(dashboard.totals).toEqual({
      planned: cop(4_000_000),
      spent: cop(2_810_000),
      available: cop(1_190_000),
    });
```

and in "answers plan null … for 2027-01" after its `unbudgeted` expectation:

```ts
    expect(dashboard.totals).toEqual({ planned: cop(0), spent: cop(100_000), available: cop(-100_000) });
```

`tests/acceptance/reports-fund-contributions.test.ts`, in the golden test after the `trackingOf` expectation:

```ts
    expect((await fundTrackingOf(h.ana, h.spaceId, "2026-11")).totals).toEqual({
      expected: cop(1_200_000),
      actual: cop(980_000),
      difference: cop(-220_000),
    });
```

`tests/support/reporting.ts`: `LineDashboardDto` gains `totals: { planned: MoneyDto; spent: MoneyDto; available: MoneyDto };` and `FundContributionsDto` gains `totals: { expected: MoneyDto; actual: MoneyDto; difference: MoneyDto };`.

Run: `pnpm exec vitest run --project acceptance tests/acceptance/reports-lines.test.ts tests/acceptance/reports-fund-contributions.test.ts`
Expected: FAIL — the response has no `totals` (the DTO functions drop it).

- [ ] **Step 5: Put the totals on the wire**

`src/modules/reporting/contracts/reporting.contract.ts`: in `LineDashboardSchema`, after `unbudgeted`, add

```ts
  totals: z
    .object({ planned: MoneySchema, spent: MoneySchema, available: MoneySchema })
    .describe("Σ of the lines' figures plus Unbudgeted's spent and available; planned counts the lines only."),
```

and in `lineDashboardDto` after `unbudgeted: …,` add

```ts
  totals: {
    planned: moneyOf(dashboard.totals.planned, dashboard.currency),
    spent: moneyOf(dashboard.totals.spent, dashboard.currency),
    available: moneyOf(dashboard.totals.available, dashboard.currency),
  },
```

In `FundContributionsSchema`, after `members`, add

```ts
  totals: z
    .object({ expected: MoneySchema, actual: MoneySchema, difference: MoneySchema })
    .describe("Σ over the listed members of expected, actual and difference."),
```

and in `fundContributionsDto` after `members: …,` add

```ts
  totals: {
    expected: moneyOf(report.totals.expected, report.currency),
    actual: moneyOf(report.totals.actual, report.currency),
    difference: moneyOf(report.totals.difference, report.currency),
  },
```

Then fix every hand-built `LineDashboard` and `FundContributionReport` that `pnpm exec tsc --noEmit` names in `reporting.contract.test.ts` by adding `totals` with values consistent with the rows it builds.

- [ ] **Step 6: Regenerate the snapshot and the client types, and run the gates**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts`, then `pnpm api:types`. The snapshot diff is exactly the two `totals` objects (and their `required` entries); `schema.d.ts` gains the same. Then every gate.
Expected: all PASS.

- [ ] **Step 7: Update the backlog notes**

`docs/backlog/E7-reporting.md`: in HU-E7-01's last technical note, after "`unbudgeted` (`spent`, `available` = −spent, `overspent`) holds what no line consumes and is null when the plan has a catch-all line (ruling P34)." add "`totals` answers Σ planned of the lines, and Σ spent and Σ available of the lines plus Unbudgeted (M6c ruling P201)." In HU-E7-03's notes add the line "- `totals` answers Σ `expected`, `actual` and `difference` over the listed members (M6c ruling P201)." The controller updates the two issue bodies the same way.

- [ ] **Step 8: Commit**

```bash
git add src/modules/reporting tests/support/reporting.ts tests/acceptance/reports-lines.test.ts \
  tests/acceptance/reports-fund-contributions.test.ts openapi/openapi.snapshot.json src/shared/ui/api/schema.d.ts \
  docs/backlog/E7-reporting.md
git commit -m "feat(reporting): answer the totals of the line dashboard and the fund tracking (Refs #78)"
```

---

### Task 1b: The line dashboard names each category's line and each line's state

Issue #142 checks an expense against its line before it is saved (ruling P233). The record form knows the expense's category, and the line dashboard knows each line's figures, but no response says which line a category feeds. That rule is budgeting's own (`lineForCategory`, HU-E6-04): a category's mapped line, a subcategory's parent's line (HU-E3-04), else the catch-all line, else Unbudgeted. So the API answers it, and the browser never re-implements it (ruling P234): `GET …/reports/lines` gains `categoryLines`.

Each line also answers its `state`: OK, NEAR (80 % used), HIGH (above 90 %) or OVER. An OVER line also answers its `overBy` amount, so the dashboard can say "Te pasaste por $ 130.000" in words (ruling P244). A hands-on test of the competitor on 2026-10-21 showed "5125% spent, $41,000 of $800" with no warning state. The thresholds are one function in the shared kernel, `lineStateOf`, which the API and Task 3c's record form both call, so the warning before a save and the dashboard after it can never disagree. The change is additive; no field changes meaning.

**Depends on:** Task 1 (the same files).

**Files:**
- Create: `src/shared/kernel/line-state.ts`, `src/shared/kernel/line-state.test.ts`
- Modify: `src/modules/budgeting/application/plan-view.ts`, `src/modules/budgeting/application/index.ts`, `src/modules/reporting/application/get-line-dashboard.ts`, `src/modules/reporting/application/line-dashboard.test.ts`, `src/modules/reporting/contracts/reporting.contract.ts`, `src/modules/reporting/contracts/reporting.contract.test.ts` (only where it builds a `LineDashboard` by hand: `tsc` names each place), `tests/support/reporting.ts`, `tests/acceptance/reports-lines.test.ts`, `openapi/openapi.snapshot.json` (regenerated), `src/shared/ui/api/schema.d.ts` (regenerated), `docs/backlog/E7-reporting.md`

**Interfaces:**
- Consumes: `lineForCategory`, `rolledUpCategory` and `CategoryParent` (budgeting domain), `BudgetPlanView`, and the `categories` port reporting already holds through `PlanViewDeps`.
- Produces:
  - `interface CategoryLine { readonly categoryId: string; readonly lineId: string | null }` and `categoryLinesOf(view: BudgetPlanView, categories: readonly CategoryParent[]): CategoryLine[]`, both exported from `budgeting/application`;
  - `LineDashboard.categoryLines: readonly CategoryLine[]`: every live category of the space, archived ones and subcategories included, in the order the categories port lists them; `[]` for a period without a plan;
  - on the wire, `categoryLines: { categoryId: string; lineId: string | null }[]`. Task 3c reads it;
  - `src/shared/kernel/line-state.ts`: `type LineState = "OK" | "NEAR" | "HIGH" | "OVER"` and `lineStateOf(budget: bigint, available: bigint): LineState`. It is imported by path (`@/shared/kernel/line-state`), as the UI already imports `@/shared/kernel/local-date`;
  - `DashboardLine.state: LineState` and `DashboardLine.overBy: bigint | null`. The budget is planned + carry-over. A SAVINGS line is always OK, because reaching its plan is the goal; `overBy` is −available when OVER, else null. On the wire: `state` and `overBy: Money | null`. Unbudgeted has neither (ruling P226). Tasks 3b and 3c read them.

- [ ] **Step 1: Write the failing application tests**

`src/modules/reporting/application/line-dashboard.test.ts`, inside `describe("line dashboard (HU-E7-01)", …)`, after the totals tests of Task 1. The world's Household lists `cat-groceries`, `cat-utilities`, `cat-outings`, `cat-restaurants`, the archived `cat-old`, and Groceries' subcategories `cat-vegetables` and `cat-meat` (`householdCategories`):

```ts
  it("names the line each category consumes: a subcategory its parent's, an unmapped one none (ruling P234 of M6c)", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", referenceParts());
    expect(unwrap(await read(w)).categoryLines).toEqual([
      { categoryId: "cat-groceries", lineId: "line-home" },
      { categoryId: "cat-utilities", lineId: "line-home" },
      { categoryId: "cat-outings", lineId: null },
      { categoryId: "cat-restaurants", lineId: null },
      { categoryId: "cat-old", lineId: null },
      { categoryId: "cat-vegetables", lineId: "line-home" },
      { categoryId: "cat-meat", lineId: "line-home" },
    ]);
  });

  it("sends every unmapped category to the catch-all line, and names no line for a period without a plan", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", { ...referenceParts(), lines: referenceLines() });
    expect(unwrap(await read(w)).categoryLines).toContainEqual({ categoryId: "cat-restaurants", lineId: "line-free" });
    expect(unwrap(await read(w, "u-ana", "2027-01")).categoryLines).toEqual([]);
  });
```

`src/shared/kernel/line-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { lineStateOf } from "./line-state";

describe("a line's state (#142, ruling P244 of M6c)", () => {
  it("is OK below 80 % used, NEAR from 80 % through 90 %, HIGH above 90 % up to the whole budget, OVER past it", () => {
    const budget = 100_000_000n;
    expect([
      lineStateOf(budget, 20_000_001n),
      lineStateOf(budget, 20_000_000n),
      lineStateOf(budget, 10_000_000n),
      lineStateOf(budget, 9_999_999n),
      lineStateOf(budget, 0n),
      lineStateOf(budget, -1n),
    ]).toEqual(["OK", "NEAR", "NEAR", "HIGH", "HIGH", "OVER"]);
  });

  it("is OK for an empty budget nothing was spent from, and OVER for one that was spent from", () => {
    expect([lineStateOf(0n, 0n), lineStateOf(0n, -1n), lineStateOf(-5n, -5n)]).toEqual(["OK", "OVER", "OVER"]);
  });
});
```

`line-dashboard.test.ts`, also appended:

```ts
  it("answers each line's state against planned plus carry-over, and an overspent line's overage (ruling P244 of M6c)", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", referenceParts());
    w.spending.expenses[NOVEMBER] = novemberSpending();
    // Rent 100 % used, Home 88.4 %, Savings is never measured, Free 34.2 %.
    expect(unwrap(await read(w)).lines.map((l) => [l.name, l.state, l.overBy])).toEqual([
      ["Rent", "HIGH", null],
      ["Home", "NEAR", null],
      ["Savings", "OK", null],
      ["Free", "OK", null],
    ]);
    w.spending.expenses[NOVEMBER] = novemberSpending().map((s) =>
      s.categoryId === "cat-groceries" ? { ...s, amount: pesos(1_200_000) } : s,
    );
    const home = unwrap(await read(w)).lines.find((l) => l.name === "Home")!;
    expect([home.available, home.state, home.overBy]).toEqual([-pesos(130_000), "OVER", pesos(130_000)]);
  });
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/shared/kernel/line-state.test.ts src/modules/reporting/application/line-dashboard.test.ts`
Expected: FAIL — `./line-state` does not exist, and `categoryLines`, `state` and `overBy` are `undefined`.

- [ ] **Step 3: Implement the lines of the categories and the states**

`src/shared/kernel/line-state.ts`:

```ts
/** #142, ruling P244 (M6c): how much of a budget line is used, as the dashboard and the record form's preview say it. */
export type LineState = "OK" | "NEAR" | "HIGH" | "OVER";

/**
 * `budget` is planned + carry-over and `available` what is left of it, in minor units. OVER once less than 0 is
 * left; HIGH above 90 % used (100 % included); NEAR from 80 % through 90 %; else OK. Integer arithmetic only.
 */
export const lineStateOf = (budget: bigint, available: bigint): LineState => {
  if (available < 0n) return "OVER";
  if (budget <= 0n) return "OK";
  const used = budget - available;
  if (used * 100n > budget * 90n) return "HIGH";
  return used * 100n >= budget * 80n ? "NEAR" : "OK";
};
```

`src/modules/budgeting/application/plan-view.ts`: add `lineForCategory` to the import from `../domain/plan-figures`, `type CategoryParent` to the import from `../domain/category-rollup`, and after `loadPlanView` add

```ts
/** Ruling P234 (M6c): the line a category's expenses consume in the plan; null when they go to Unbudgeted. */
export interface CategoryLine {
  readonly categoryId: string;
  readonly lineId: string | null;
}

/**
 * HU-E6-04, HU-E3-04: for each category, the line its expenses consume in `view`'s plan, by the rule the figures
 * use: its mapped line, its parent's line for a subcategory, else the catch-all line, else none (Unbudgeted).
 */
export const categoryLinesOf = (view: BudgetPlanView, categories: readonly CategoryParent[]): CategoryLine[] => {
  const parts = {
    lines: view.figures.lines.map((figure) => figure.line),
    mappings: view.figures.lines.flatMap((figure) =>
      figure.categoryIds.map((categoryId) => ({ lineId: figure.line.id, categoryId })),
    ),
  };
  return categories.map((category) => ({
    categoryId: category.id,
    lineId: lineForCategory(rolledUpCategory(category.id, categories), parts),
  }));
};
```

`src/modules/budgeting/application/index.ts`: the `./plan-view` export gains `categoryLinesOf` and `type CategoryLine`.

`src/modules/reporting/application/get-line-dashboard.ts`:
- import `categoryLinesOf` and `type CategoryLine` from `@/modules/budgeting/application`;
- `DashboardLine` gains `readonly state: LineState;` and `readonly overBy: bigint | null;`, and the line mapping adds

```ts
      // Ruling P244 (M6c): a savings line reaching its plan is the goal, so it is never measured.
      state: f.line.funding === "SAVINGS" ? "OK" : lineStateOf(f.line.plannedAmount + f.carryOver, f.available),
      overBy: f.line.funding !== "SAVINGS" && f.available < 0n ? -f.available : null,
```

  (with `lineStateOf` and `type LineState` imported from `@/shared/kernel/line-state`);
- `LineDashboard` gains, after `totals`, `/** Ruling P234 (M6c): the line each live category consumes; [] without a plan. */ readonly categoryLines: readonly CategoryLine[];`;
- the no-plan return gains `categoryLines: []`;
- the last return becomes

```ts
    const categoryLines = categoryLinesOf(view, await deps.categories.list(space.spaceId));
    return ok({ ...base, lines, unbudgeted: rest, totals: totalsOf(lines, rest), categoryLines });
```

- [ ] **Step 4: Write the failing acceptance check**

`tests/acceptance/reports-lines.test.ts`, in the golden test after the `totals` expectation of Task 1:

```ts
    expect(dashboard.categoryLines).toContainEqual({ categoryId: r.category.groceries, lineId: r.lineId("Home") });
    expect(dashboard.categoryLines).toContainEqual({ categoryId: r.category.restaurants, lineId: null });
```

and in "answers plan null … for 2027-01" after its `totals` expectation:

```ts
    expect(dashboard.categoryLines).toEqual([]);
```

and, in the golden test, `expect(dashboard.lines.map((l) => [l.name, l.state, l.overBy])).toEqual([["Rent", "HIGH", null], ["Home", "NEAR", null], ["Savings", "OK", null], ["Free", "OK", null]]);`.

`tests/support/reporting.ts`: `LineDashboardDto` gains `categoryLines: { categoryId: string; lineId: string | null }[];`, and its line type gains `state: string; overBy: MoneyDto | null;`.

Run: `pnpm exec vitest run --project acceptance tests/acceptance/reports-lines.test.ts`
Expected: FAIL — the response has no `categoryLines`, `state` or `overBy` (the DTO function drops them).

- [ ] **Step 5: Put the lines of the categories on the wire**

`src/modules/reporting/contracts/reporting.contract.ts`: in `LineDashboardSchema`, after `totals`, add

```ts
  categoryLines: z
    .array(z.object({ categoryId: z.string(), lineId: z.string().nullable() }))
    .describe(
      "Every live category of the space with the line its expenses consume in the plan: its mapped line, its parent's line for a subcategory, else the catch-all line; null for Unbudgeted. Empty without a plan.",
    ),
```

and in `lineDashboardDto` after `totals: { … },` add

```ts
  categoryLines: dashboard.categoryLines.map((c) => ({ categoryId: c.categoryId, lineId: c.lineId })),
```

Each line of `LineDashboardSchema` gains `state: z.enum(["OK", "NEAR", "HIGH", "OVER"]).describe("Of planned + carry-over: NEAR from 80 % used, HIGH above 90 %, OVER below 0 left; a SAVINGS line is always OK.")` and `overBy: MoneySchema.nullable().describe("How much an OVER line went past its budget, positive; null otherwise.")`. Its DTO maps `state: line.state` and `overBy: line.overBy === null ? null : moneyOf(line.overBy, dashboard.currency)`.

Then add `categoryLines: []`, and each line's `state` and `overBy`, to every hand-built `LineDashboard` that `pnpm exec tsc --noEmit` names in `reporting.contract.test.ts`.

- [ ] **Step 6: Regenerate the snapshot and the client types, and run the gates**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts`, then `pnpm api:types`. The snapshot diff is exactly `categoryLines` and the lines' `state` and `overBy` (and their `required` entries); `schema.d.ts` gains the same. Then every gate.
Expected: all PASS.

- [ ] **Step 7: Update the backlog note**

`docs/backlog/E7-reporting.md`: in HU-E7-01's last technical note, after the sentence on `totals` that Task 1 added, add "`categoryLines` names, for every live category of the space, the line its expenses consume in the plan (its mapped line, its parent's line for a subcategory, else the catch-all line), or null for Unbudgeted (M6c ruling P234). Each line answers its `state` (OK, NEAR from 80 % used, HIGH above 90 %, OVER) against planned + carry-over, and an OVER line its `overBy` (M6c ruling P244)." The controller updates the issue body the same way.

- [ ] **Step 8: Commit**

```bash
git add src/shared/kernel/line-state.ts src/shared/kernel/line-state.test.ts src/modules/budgeting/application \
  src/modules/reporting tests/support/reporting.ts \
  tests/acceptance/reports-lines.test.ts openapi/openapi.snapshot.json src/shared/ui/api/schema.d.ts \
  docs/backlog/E7-reporting.md
git commit -m "feat(reporting): name each category's line and each line's state on the line dashboard (Refs #142)"
```

---

### Task 1c: The ledger lists a space's scheduled movements through a date

Issue #150's calendar shows what will come in and go out, and the ledger owns when that happens: a recurrence's schedule dates from the first one not considered yet (HU-E4-11, ruling P24), and its PENDING occurrences that wait for a member (HU-E4-13). Reporting may not read the ledger's domain, so the ledger answers one application query, `listScheduledMovements`, which the composition root binds into reporting in Task 1d (ruling P238). It is not an HTTP endpoint; nothing new is stored.

**Depends on:** M3-C's recurrences (`upcomingDates`, `pendingOccurrences`). Nothing in M6c.

**Files:**
- Create: `src/modules/ledger/application/scheduled-movements.ts`, `src/modules/ledger/application/scheduled-movements.test.ts`
- Modify: `src/modules/ledger/domain/recurrence.ts`, `src/modules/ledger/domain/recurrence.test.ts`, `src/modules/ledger/application/index.ts`

**Interfaces:**
- Consumes: `scheduleDates`, `Recurrence`, `RecurrenceTemplate`, `RecurrenceType`, `Occurrence`, `RecurrenceRepository.list`, `OccurrenceRepository.pendingOccurrences`.
- Produces:
  - domain: `MAX_SCHEDULED = 64`; `datesThrough(recurrence: Recurrence, through: LocalDate): LocalDate[]`; `accountsMovedBy(template: RecurrenceTemplate): { debitAccountId: string | null; creditAccountId: string | null }`;
  - application: `interface ScheduledMovement { recurrenceId; occurrenceId: string | null; type: RecurrenceType; description; date: LocalDate; status: "SCHEDULED" | "PENDING"; estimated: boolean; amount: bigint; currency; debitAccountId: string | null; creditAccountId: string | null }`, `type ListScheduledMovements = (input: { spaceId: string; through: LocalDate }) => Promise<ScheduledMovement[]>` and `createListScheduledMovements(deps: Pick<RecurrenceDeps, "recurrences" | "occurrences">)`, exported from `ledger/application`. Task 1d consumes them.

- [ ] **Step 1: Write the failing domain tests**

`src/modules/ledger/domain/recurrence.test.ts`: add `MAX_SCHEDULED`, `accountsMovedBy` and `datesThrough` to the import from `./recurrence`, and append (the file's `rent()` is the Rent from the Household Fund, MONTHLY(1), AUTO, from 2026-12-01, defined on 2026-10-28):

```ts
describe("the dates a recurrence records through a day (ruling P238 of M6c)", () => {
  it("lists every date from the first not considered yet through the day, and stops at its end date", () => {
    expect(datesThrough(rent(), day("2027-02-15"))).toEqual(["2026-12-01", "2027-01-01", "2027-02-01"]);
    expect(datesThrough(rent({ endDate: day("2027-01-10") }), day("2027-02-15"))).toEqual(["2026-12-01", "2027-01-01"]);
    expect(datesThrough(rent(), day("2026-11-30"))).toEqual([]);
  });

  it("lists nothing while paused or once ended, and never more than MAX_SCHEDULED dates", () => {
    const r = rent();
    expect(datesThrough({ ...r, pausedAt: at("2026-11-01") }, day("2027-02-15"))).toEqual([]);
    expect(datesThrough({ ...r, endedAt: at("2026-11-01") }, day("2027-02-15"))).toEqual([]);
    expect(datesThrough(r, day("2040-01-01"))).toHaveLength(MAX_SCHEDULED);
  });
});

describe("the accounts a recurrence moves (ruling P239 of M6c)", () => {
  it("debits the paying or source account and credits the receiving one", () => {
    expect([
      accountsMovedBy({
        type: "EXPENSE",
        categoryId: "cat-rent",
        payer: { memberId: "member-ana", accountId: "acc-bancolombia" },
        split: null,
      }),
      accountsMovedBy(RENT),
      accountsMovedBy({ type: "INCOME", categoryId: "cat-salary", accountId: "acc-bancolombia" }),
      accountsMovedBy({ type: "TRANSFER", sourceAccountId: "acc-bancolombia", destinationAccountId: "acc-visa" }),
      accountsMovedBy({
        type: "FUND_CONTRIBUTION",
        fundAccountId: "acc-household-fund",
        memberId: "member-ana",
        sourceAccountId: "acc-bancolombia",
      }),
      accountsMovedBy({
        type: "FUND_CONTRIBUTION",
        fundAccountId: "acc-household-fund",
        memberId: "member-pedro",
        sourceAccountId: null,
      }),
    ]).toEqual([
      { debitAccountId: "acc-bancolombia", creditAccountId: null },
      { debitAccountId: "acc-household-fund", creditAccountId: null },
      { debitAccountId: null, creditAccountId: "acc-bancolombia" },
      { debitAccountId: "acc-bancolombia", creditAccountId: "acc-visa" },
      { debitAccountId: "acc-bancolombia", creditAccountId: "acc-household-fund" },
      { debitAccountId: null, creditAccountId: "acc-household-fund" },
    ]);
  });
});
```

- [ ] **Step 2: Write the failing application test**

`src/modules/ledger/application/scheduled-movements.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { unwrap } from "../../../../tests/support/fakes";
import { InMemoryRecurrences } from "../../../../tests/support/in-memory-recurrences";
import { pendingOccurrence, type OccurrenceId } from "../domain/occurrence";
import { defineRecurrence, type NewRecurrence, type RecurrenceId } from "../domain/recurrence";
import { createListScheduledMovements } from "./scheduled-movements";

const day = (iso: string) => iso as LocalDate;
const at = (iso: string) => new Date(`${iso}T17:00:00Z`);
const pesos = (n: number) => BigInt(n) * 100n;
const FROM_BANCOLOMBIA = { memberId: "member-ana", accountId: "acc-bancolombia" };

/** A recurrence of Household defined on 2026-10-28 in Bogotá. */
const recurrence = (id: string, overrides: Partial<NewRecurrence>) =>
  unwrap(
    defineRecurrence({
      id: id as RecurrenceId,
      spaceId: "space-household",
      description: "Rent",
      amount: pesos(1_200_000),
      currency: "COP",
      template: { type: "EXPENSE", categoryId: "cat-rent", payer: FROM_BANCOLOMBIA, split: null },
      schedule: { kind: "MONTHLY", day: 1 },
      mode: "AUTO",
      startDate: day("2026-11-01"),
      endDate: null,
      createdBy: "u-ana",
      now: at("2026-10-28"),
      today: day("2026-10-28"),
      ...overrides,
    }),
  );

const world = () => {
  const store = new InMemoryRecurrences();
  const list = createListScheduledMovements({ recurrences: store, occurrences: store });
  return { store, list };
};

describe("a space's scheduled movements (ruling P238 of M6c)", () => {
  it("lists its PENDING occurrences first, then every schedule date through the day, by date", async () => {
    const { store, list } = world();
    // Defined earlier, so it is listed first on a shared date; its October occurrence waits for a member.
    const power = {
      ...recurrence("rec-power", {
        description: "Electricity",
        amount: pesos(180_000),
        schedule: { kind: "MONTHLY", day: 20 },
        mode: "CONFIRM",
        startDate: day("2026-10-01"),
        now: at("2026-10-01"),
        today: day("2026-10-01"),
      }),
      dueFrom: day("2026-10-21"),
    };
    await store.add(power);
    await store.add(recurrence("rec-rent", {}));
    await store.add(
      recurrence("rec-salary", {
        description: "Salary",
        amount: pesos(3_000_000),
        template: { type: "INCOME", categoryId: "cat-salary", accountId: "acc-bancolombia" },
        schedule: { kind: "SEMI_MONTHLY", day1: 15, day2: 30 },
        startDate: day("2026-10-30"),
      }),
    );
    await store.addOccurrence(pendingOccurrence("occ-power-oct" as OccurrenceId, power, day("2026-10-20"), at("2026-10-20")));
    const movements = await list({ spaceId: "space-household", through: day("2026-12-16") });
    expect(movements[0]).toEqual({
      recurrenceId: "rec-power",
      occurrenceId: "occ-power-oct",
      type: "EXPENSE",
      description: "Electricity",
      date: "2026-10-20",
      status: "PENDING",
      estimated: true,
      amount: pesos(180_000),
      currency: "COP",
      debitAccountId: "acc-bancolombia",
      creditAccountId: null,
    });
    expect(movements.map((m) => [m.description, m.date, m.status, m.estimated, m.creditAccountId])).toEqual([
      ["Electricity", "2026-10-20", "PENDING", true, null],
      ["Salary", "2026-10-30", "SCHEDULED", false, "acc-bancolombia"],
      ["Rent", "2026-11-01", "SCHEDULED", false, null],
      ["Salary", "2026-11-15", "SCHEDULED", false, "acc-bancolombia"],
      ["Electricity", "2026-11-20", "SCHEDULED", true, null],
      ["Salary", "2026-11-30", "SCHEDULED", false, "acc-bancolombia"],
      ["Rent", "2026-12-01", "SCHEDULED", false, null],
      ["Salary", "2026-12-15", "SCHEDULED", false, "acc-bancolombia"],
    ]);
  });

  it("lists no date of a paused or ended recurrence, keeps its pending occurrence, and reads only its own space", async () => {
    const { store, list } = world();
    const paused = { ...recurrence("rec-power", { mode: "CONFIRM" }), pausedAt: at("2026-10-29") };
    await store.add(paused);
    await store.add({ ...recurrence("rec-rent", {}), endedAt: at("2026-10-29") });
    await store.add(recurrence("rec-other", { spaceId: "space-other" }));
    await store.addOccurrence(pendingOccurrence("occ-1" as OccurrenceId, paused, day("2026-10-01"), at("2026-10-01")));
    const movements = await list({ spaceId: "space-household", through: day("2026-12-31") });
    expect(movements.map((m) => [m.recurrenceId, m.status])).toEqual([["rec-power", "PENDING"]]);
  });
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/domain/recurrence.test.ts src/modules/ledger/application/scheduled-movements.test.ts`
Expected: FAIL — `datesThrough`, `accountsMovedBy` and `./scheduled-movements` do not exist.

- [ ] **Step 4: Implement**

`src/modules/ledger/domain/recurrence.ts`, after `upcomingDates`:

```ts
/**
 * Ruling P238 (M6c): the cap of `datesThrough`. A 60-day window holds at most five dates of the densest schedule
 * (SEMI_MONTHLY); the cap only bounds a scheduler backlog or a far `through`, never a real window.
 */
export const MAX_SCHEDULED = 64;

/** The dates it will still record on or before `through`, from the first not considered yet; none while paused or ended. */
export const datesThrough = (recurrence: Recurrence, through: LocalDate): LocalDate[] => {
  if (recurrence.pausedAt !== null || recurrence.endedAt !== null) return [];
  const end = recurrence.endDate !== null && recurrence.endDate < through ? recurrence.endDate : through;
  return scheduleDates(recurrence.schedule, { from: recurrence.dueFrom, through: end }, MAX_SCHEDULED);
};

/** Ruling P239 (M6c): the account each occurrence takes money from and the one it puts money into; null where none. */
export const accountsMovedBy = (
  template: RecurrenceTemplate,
): { readonly debitAccountId: string | null; readonly creditAccountId: string | null } => {
  switch (template.type) {
    case "EXPENSE":
      return { debitAccountId: template.payer.accountId, creditAccountId: null };
    case "INCOME":
      return { debitAccountId: null, creditAccountId: template.accountId };
    case "TRANSFER":
      return { debitAccountId: template.sourceAccountId, creditAccountId: template.destinationAccountId };
    case "FUND_CONTRIBUTION":
      return { debitAccountId: template.sourceAccountId, creditAccountId: template.fundAccountId };
  }
};
```

`src/modules/ledger/application/scheduled-movements.ts`:

```ts
import type { LocalDate } from "@/shared/kernel";
import { accountsMovedBy, datesThrough, type Recurrence, type RecurrenceType } from "../domain/recurrence";
import type { RecurrenceDeps } from "./recurrence-ports";

/** Ruling P238 (M6c): one movement a recurrence is going to record, as the cash-flow calendar reads it. */
export interface ScheduledMovement {
  readonly recurrenceId: string;
  /** The PENDING occurrence; null for a schedule date the scheduler has not reached. */
  readonly occurrenceId: string | null;
  readonly type: RecurrenceType;
  readonly description: string;
  /** A schedule date, or the date a PENDING occurrence was due. */
  readonly date: LocalDate;
  readonly status: "SCHEDULED" | "PENDING";
  /** CONFIRM recurrences: the amount is the estimate a member confirms or changes (HU-E4-13). */
  readonly estimated: boolean;
  /** Minor units of `currency`, positive. */
  readonly amount: bigint;
  readonly currency: string;
  readonly debitAccountId: string | null;
  readonly creditAccountId: string | null;
}

export type ListScheduledMovements = (input: {
  readonly spaceId: string;
  readonly through: LocalDate;
}) => Promise<ScheduledMovement[]>;

const movementOf = (
  recurrence: Recurrence,
  at: Pick<ScheduledMovement, "occurrenceId" | "date" | "status" | "amount">,
): ScheduledMovement => ({
  recurrenceId: recurrence.id,
  type: recurrence.template.type,
  description: recurrence.description,
  estimated: recurrence.mode === "CONFIRM",
  currency: recurrence.currency,
  ...accountsMovedBy(recurrence.template),
  ...at,
});

/**
 * Ruling P238 (M6c): a space's PENDING occurrences (earliest first, as the repository lists them, whatever the
 * state of their recurrence, HU-E4-13), then every schedule date through `through` of its ACTIVE recurrences, by
 * date and then in the order they were defined. A pending occurrence is never listed again as a schedule date: its
 * recurrence's `dueFrom` is already past it. The caller authorizes: this is a port, not an endpoint.
 */
export const createListScheduledMovements =
  (deps: Pick<RecurrenceDeps, "recurrences" | "occurrences">): ListScheduledMovements =>
  async ({ spaceId, through }) => {
    const recurrences = await deps.recurrences.list(spaceId);
    const byId = new Map(recurrences.map((r) => [r.id as string, r]));
    const pending = (await deps.occurrences.pendingOccurrences(spaceId)).flatMap((occurrence) => {
      const recurrence = byId.get(occurrence.recurrenceId);
      return recurrence === undefined
        ? []
        : [movementOf(recurrence, { occurrenceId: occurrence.id, date: occurrence.date, status: "PENDING", amount: occurrence.amount })];
    });
    const scheduled = recurrences
      .flatMap((recurrence) =>
        datesThrough(recurrence, through).map((date) =>
          movementOf(recurrence, { occurrenceId: null, date, status: "SCHEDULED", amount: recurrence.amount }),
        ),
      )
      // Stable: equal dates keep the recurrences' definition order.
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return [...pending, ...scheduled];
  };
```

`src/modules/ledger/application/index.ts`: `export { createListScheduledMovements, type ListScheduledMovements, type ScheduledMovement } from "./scheduled-movements";`.

- [ ] **Step 5: Run the tests and the gates**

Run: Step 3's command, then every gate.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/domain/recurrence.ts src/modules/ledger/domain/recurrence.test.ts \
  src/modules/ledger/application/scheduled-movements.ts src/modules/ledger/application/scheduled-movements.test.ts \
  src/modules/ledger/application/index.ts
git commit -m "feat(ledger): list a space's scheduled movements through a date (Refs #150)"
```

---

### Task 1d: The cash flow of the next 30 or 60 days

Issue #150: "Show, by day, the money that will come in and go out over the next 30 and 60 days … with the balance projected after each." `GET /api/v1/me/cash-flow?days=30|60` answers it for the signed-in person (ruling P238). It lists every scheduled movement of every space they are a current member of that debits or credits an account they own (ruling P239). It starts from today's "Disponible" of their personal space (HU-E2-07) and projects the balance after each date (ruling P240). Every figure is the API's (ruling P201); the screen of Task 15b only renders it.

Two rules come from a hands-on test of the competitor on 2026-10-21. Its forecast spread one day's spending over the whole month, and a reminder for 2027-03-15 showed on 14/03 (a time-zone bug).
- The calendar projects only known future items: schedule dates, pending occurrences and fund contributions that recur. It never projects a pace from past spending (ruling P245).
- It places every item by its local date (`LocalDate`, the space's calendar), never by a UTC instant. "Today" is the caller's local date (ruling P246).

**Depends on:** Task 1c (`listScheduledMovements`).

**Files:**
- Create: `src/modules/reporting/domain/cash-flow.ts`, `src/modules/reporting/domain/cash-flow.test.ts`, `src/modules/reporting/application/get-cash-flow.ts`, `src/modules/reporting/application/cash-flow.test.ts`, `src/app/api/v1/me/cash-flow/route.ts`, `tests/acceptance/cash-flow.test.ts`
- Modify: `src/modules/reporting/application/index.ts`, `src/modules/reporting/contracts/reporting.contract.ts`, `src/composition/container.ts`, `tests/support/reporting.ts`, `openapi/openapi.snapshot.json` (regenerated), `src/shared/ui/api/schema.d.ts` (regenerated), `docs/backlog/E7-reporting.md`

**Interfaces:**
- Consumes: `ScheduledMovement`, `ListScheduledMovements` (Task 1c); `Clock`, `todayIn`, `addDays`, `UserTimeZones`, `LocalDate` (kernel); `MoneySchema`, `moneyOf`.
- Produces:
  - domain: `interface PlannedMovement extends ScheduledMovement { spaceId; spaceName }` (declared structurally in reporting, without importing the ledger's domain), `interface OwnAccount { id; counted: boolean }`, `interface CashFlowMovement extends PlannedMovement { effect: bigint }`, `interface CashFlowDate { date; movements; balanceAfter }`, `interface CashFlowProjection { dates; totals: { incoming; outgoing; closing }; lowest: { date; balance }; otherCurrencySpaces }` and `cashFlow(input): CashFlowProjection`;
  - application: `CASH_FLOW_DAYS = [30, 60] as const`, `type CashFlowDays = 30 | 60`, `interface CashFlowDeps { clock; userTimeZones; spacesOf(userId); scheduled; ownAccountsOf(userId) }`, `interface CashFlowView`, `type GetCashFlow = (input: { userId: string; days: CashFlowDays }) => Promise<Result<CashFlowView>>` and `createGetCashFlow(deps)`;
  - contract: `CashFlowQuerySchema`, `CashFlowSchema`, `cashFlowDto(view)` and the path `/api/v1/me/cash-flow` (`operationId: "getCashFlow"`);
  - `container.reporting.getCashFlow`.

- [ ] **Step 1: Write the failing domain test**

`src/modules/reporting/domain/cash-flow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { cashFlow, type PlannedMovement } from "./cash-flow";

const pesos = (n: number) => BigInt(n) * 100n;
const day = (iso: string) => iso as LocalDate;

const movement = (overrides: Partial<PlannedMovement>): PlannedMovement => ({
  spaceId: "space-ana",
  spaceName: "Personal",
  recurrenceId: "rec-1",
  occurrenceId: null,
  type: "EXPENSE",
  description: "Internet",
  date: day("2026-11-05"),
  status: "SCHEDULED",
  estimated: false,
  amount: pesos(120_000),
  currency: "COP",
  debitAccountId: "acc-bancolombia",
  creditAccountId: null,
  ...overrides,
});

/** Ana on 2026-10-29: Bancolombia and Nequi count in her available money; her savings and her Visa do not. */
const input = (movements: readonly PlannedMovement[]) => ({
  today: day("2026-10-29"),
  through: day("2026-11-27"),
  currency: "COP",
  opening: pesos(100_000),
  accounts: [
    { id: "acc-bancolombia", counted: true },
    { id: "acc-nequi", counted: true },
    { id: "acc-savings", counted: false },
    { id: "acc-visa", counted: false },
  ],
  movements,
});

describe("the cash flow of the coming days (#150, rulings P239 and P240 of M6c)", () => {
  it("projects the balance after each date from today's available money, with a pending occurrence on today", () => {
    const flow = cashFlow(
      input([
        movement({ description: "Electricity", date: day("2026-10-20"), status: "PENDING", occurrenceId: "occ-1", estimated: true, amount: pesos(180_000), spaceId: "space-household", spaceName: "Household" }),
        movement({ type: "INCOME", description: "Salary", date: day("2026-10-30"), amount: pesos(3_000_000), debitAccountId: null, creditAccountId: "acc-bancolombia" }),
        movement({ description: "Rent", date: day("2026-11-01"), amount: pesos(1_200_000), spaceId: "space-household", spaceName: "Household" }),
        movement({ type: "TRANSFER", description: "To savings", date: day("2026-11-15"), amount: pesos(500_000), creditAccountId: "acc-savings" }),
        movement({ type: "TRANSFER", description: "To Nequi", date: day("2026-11-16"), amount: pesos(100_000), creditAccountId: "acc-nequi" }),
      ]),
    );
    expect(flow.dates.map((d) => [d.date, d.movements.map((m) => [m.description, m.effect]), d.balanceAfter])).toEqual([
      ["2026-10-29", [["Electricity", -pesos(180_000)]], -pesos(80_000)],
      ["2026-10-30", [["Salary", pesos(3_000_000)]], pesos(2_920_000)],
      ["2026-11-01", [["Rent", -pesos(1_200_000)]], pesos(1_720_000)],
      ["2026-11-15", [["To savings", -pesos(500_000)]], pesos(1_220_000)],
      ["2026-11-16", [["To Nequi", 0n]], pesos(1_220_000)],
    ]);
    expect(flow.dates[0]!.movements[0]).toMatchObject({ date: "2026-10-20", status: "PENDING", estimated: true });
    expect(flow.totals).toEqual({ incoming: pesos(3_000_000), outgoing: pesos(1_880_000), closing: pesos(1_220_000) });
    expect(flow.lowest).toEqual({ date: "2026-10-29", balance: -pesos(80_000) });
  });

  it("leaves out what moves no account of the caller's, and names a space in another currency once", () => {
    const flow = cashFlow(
      input([
        movement({ description: "Juan's phone", debitAccountId: "acc-davivienda" }),
        movement({ description: "Fund rent", debitAccountId: "acc-household-fund" }),
        movement({ description: "Trip", currency: "USD", spaceId: "space-trip", spaceName: "Trip" }),
        movement({ description: "Trip again", currency: "USD", spaceId: "space-trip", spaceName: "Trip", date: day("2026-11-06") }),
        movement({ description: "Later", date: day("2026-11-28") }),
      ]),
    );
    expect(flow.dates).toEqual([]);
    expect(flow.otherCurrencySpaces).toEqual([{ spaceId: "space-trip", name: "Trip", currency: "USD" }]);
    expect(flow.totals).toEqual({ incoming: 0n, outgoing: 0n, closing: pesos(100_000) });
    expect(flow.lowest).toEqual({ date: "2026-10-29", balance: pesos(100_000) });
  });

  it("puts a day's pending occurrences before its scheduled ones, whatever space lists them first", () => {
    const flow = cashFlow(
      input([
        movement({ description: "Today's Internet", date: day("2026-10-29") }),
        movement({ description: "Late gas", date: day("2026-10-25"), status: "PENDING", occurrenceId: "occ-gas", spaceId: "space-household" }),
      ]),
    );
    expect(flow.dates[0]!.movements.map((m) => m.description)).toEqual(["Late gas", "Today's Internet"]);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/domain/cash-flow.test.ts`
Expected: FAIL — `./cash-flow` does not exist.

- [ ] **Step 3: Implement the projection**

`src/modules/reporting/domain/cash-flow.ts`:

```ts
import type { LocalDate } from "@/shared/kernel";

/** Ruling P238 (M6c): a scheduled movement of one of the caller's spaces (the ledger's `ScheduledMovement`, by shape). */
export interface PlannedMovement {
  readonly spaceId: string;
  readonly spaceName: string;
  readonly recurrenceId: string;
  readonly occurrenceId: string | null;
  readonly type: "EXPENSE" | "INCOME" | "TRANSFER" | "FUND_CONTRIBUTION";
  readonly description: string;
  /** When it is due: a schedule date, or the date a PENDING occurrence was due. */
  readonly date: LocalDate;
  readonly status: "SCHEDULED" | "PENDING";
  readonly estimated: boolean;
  readonly amount: bigint;
  readonly currency: string;
  readonly debitAccountId: string | null;
  readonly creditAccountId: string | null;
}

/** One of the caller's own accounts; `counted` when it counts in their available money (HU-E2-07, P51). */
export interface OwnAccount {
  readonly id: string;
  readonly counted: boolean;
}

/** Ruling P240: the signed change of the caller's available money. */
export interface CashFlowMovement extends PlannedMovement {
  readonly effect: bigint;
}

export interface CashFlowDate {
  readonly date: LocalDate;
  readonly movements: readonly CashFlowMovement[];
  /** The available money after every movement of the date. */
  readonly balanceAfter: bigint;
}

export interface CashFlowProjection {
  readonly dates: readonly CashFlowDate[];
  readonly totals: { readonly incoming: bigint; readonly outgoing: bigint; readonly closing: bigint };
  /** The lowest projected balance and its first date; today's opening when nothing goes lower. */
  readonly lowest: { readonly date: LocalDate; readonly balance: bigint };
  readonly otherCurrencySpaces: readonly { readonly spaceId: string; readonly name: string; readonly currency: string }[];
}

export interface CashFlowInput {
  readonly today: LocalDate;
  readonly through: LocalDate;
  /** The personal space's currency, every sum's (D6). */
  readonly currency: string;
  /** Today's available money of the personal space (HU-E2-07). */
  readonly opening: bigint;
  readonly accounts: readonly OwnAccount[];
  readonly movements: readonly PlannedMovement[];
}

const order = (a: { date: LocalDate; movement: PlannedMovement }, b: { date: LocalDate; movement: PlannedMovement }) => {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.movement.status !== b.movement.status) return a.movement.status === "PENDING" ? -1 : 1;
  return a.movement.date < b.movement.date ? -1 : a.movement.date > b.movement.date ? 1 : 0;
};

/**
 * #150, rulings P239 and P240 (M6c): the caller's movements through `through`, each placed on its date or, when it
 * was due earlier (a PENDING occurrence, a date the scheduler has not reached), on today. A movement is the caller's
 * when it debits or credits one of their own accounts. Its effect is +amount into a counted account, −amount out of
 * one, so 0 between two counted accounts or two uncounted ones. A movement in another currency is left out and its
 * space named once (ruling P37's rule). Derived on read (D7); ties keep the input order.
 */
export const cashFlow = (input: CashFlowInput): CashFlowProjection => {
  const counted = new Map(input.accounts.map((account) => [account.id, account.counted]));
  const others = new Map<string, { spaceId: string; name: string; currency: string }>();
  const placed: { date: LocalDate; movement: CashFlowMovement }[] = [];
  for (const movement of input.movements) {
    if (movement.date > input.through) continue;
    const debit = movement.debitAccountId === null ? undefined : counted.get(movement.debitAccountId);
    const credit = movement.creditAccountId === null ? undefined : counted.get(movement.creditAccountId);
    if (debit === undefined && credit === undefined) continue;
    if (movement.currency !== input.currency) {
      others.set(movement.spaceId, { spaceId: movement.spaceId, name: movement.spaceName, currency: movement.currency });
      continue;
    }
    const effect = (credit ? movement.amount : 0n) - (debit ? movement.amount : 0n);
    placed.push({ date: movement.date < input.today ? input.today : movement.date, movement: { ...movement, effect } });
  }
  placed.sort(order);
  const dates: CashFlowDate[] = [];
  let balance = input.opening;
  let incoming = 0n;
  let outgoing = 0n;
  let lowest = { date: input.today, balance: input.opening };
  for (const { date, movement } of placed) {
    balance += movement.effect;
    if (movement.effect > 0n) incoming += movement.effect;
    else outgoing -= movement.effect;
    const last = dates.at(-1);
    if (last?.date === date) dates[dates.length - 1] = { date, movements: [...last.movements, movement], balanceAfter: balance };
    else dates.push({ date, movements: [movement], balanceAfter: balance });
  }
  for (const { date, balanceAfter } of dates) if (balanceAfter < lowest.balance) lowest = { date, balance: balanceAfter };
  return {
    dates,
    totals: { incoming, outgoing, closing: input.opening + incoming - outgoing },
    lowest,
    otherCurrencySpaces: [...others.values()],
  };
};
```

Run: Step 2's command.
Expected: PASS.

- [ ] **Step 4: Write the failing use case test**

`src/modules/reporting/application/cash-flow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ScheduledMovement } from "@/modules/ledger/application";
import { FixedClock, type LocalDate } from "@/shared/kernel";
import { unwrap } from "../../../../tests/support/fakes";
import { createGetCashFlow, type CashFlowDeps } from "./get-cash-flow";

const pesos = (n: number) => BigInt(n) * 100n;
const day = (iso: string) => iso as LocalDate;

const salary: ScheduledMovement = {
  recurrenceId: "rec-salary",
  occurrenceId: null,
  type: "INCOME",
  description: "Salary",
  date: day("2026-10-30"),
  status: "SCHEDULED",
  estimated: false,
  amount: pesos(3_000_000),
  currency: "COP",
  debitAccountId: null,
  creditAccountId: "acc-bancolombia",
};
const rent: ScheduledMovement = { ...salary, recurrenceId: "rec-rent", type: "EXPENSE", description: "Rent", date: day("2026-11-01"), amount: pesos(1_200_000), debitAccountId: "acc-bancolombia", creditAccountId: null };

const world = () => {
  const asked: [string, string][] = [];
  const deps: CashFlowDeps = {
    // 2026-10-29 at noon in Bogotá.
    clock: new FixedClock(new Date("2026-10-29T17:00:00Z")),
    userTimeZones: { timeZoneOf: async () => "America/Bogota" },
    spacesOf: async () => [
      { spaceId: "space-ana", name: "Personal" },
      { spaceId: "space-household", name: "Household" },
    ],
    scheduled: async ({ spaceId, through }) => {
      asked.push([spaceId, through]);
      return spaceId === "space-ana" ? [salary] : [rent];
    },
    ownAccountsOf: async () => ({ currency: "COP", available: pesos(100_000), accounts: [{ id: "acc-bancolombia", counted: true }] }),
  };
  return { deps, asked };
};

describe("GetCashFlow (#150, ruling P238 of M6c)", () => {
  it("reads each of the caller's spaces once through the window's last day, from today in their zone", async () => {
    const { deps, asked } = world();
    const view = unwrap(await createGetCashFlow(deps)({ userId: "u-ana", days: 30 }));
    expect(asked).toEqual([
      ["space-ana", "2026-11-27"],
      ["space-household", "2026-11-27"],
    ]);
    expect(view).toMatchObject({ currency: "COP", from: "2026-10-29", through: "2026-11-27", days: 30, opening: pesos(100_000) });
    expect(view.dates.map((d) => [d.date, d.movements[0]!.space, d.balanceAfter])).toEqual([
      ["2026-10-30", { id: "space-ana", name: "Personal" }, pesos(3_100_000)],
      ["2026-11-01", { id: "space-household", name: "Household" }, pesos(1_900_000)],
    ]);
  });

  it("reaches 59 days past today for a 60-day window", async () => {
    const { deps, asked } = world();
    unwrap(await createGetCashFlow(deps)({ userId: "u-ana", days: 60 }));
    expect(asked[0]).toEqual(["space-ana", "2026-12-27"]);
  });

  it("starts on the caller's local date at the start and end of a Bogotá day, never the UTC one (ruling P246 of M6c)", async () => {
    const { deps } = world();
    const at = (iso: string) => createGetCashFlow({ ...deps, clock: new FixedClock(new Date(iso)) })({ userId: "u-ana", days: 30 });
    // 23:59:59 on 2026-10-28 in Bogotá is already 2026-10-29 in UTC; 00:00:00 on 2026-10-29 in Bogotá is 05:00 UTC.
    const late = unwrap(await at("2026-10-29T04:59:59Z"));
    const early = unwrap(await at("2026-10-29T05:00:00Z"));
    expect([late.from, late.through, early.from, early.through]).toEqual(["2026-10-28", "2026-11-26", "2026-10-29", "2026-11-27"]);
  });
});
```

Run: `pnpm exec vitest run --project unit src/modules/reporting/application/cash-flow.test.ts`
Expected: FAIL — `./get-cash-flow` does not exist.

- [ ] **Step 5: Implement the use case**

`src/modules/reporting/application/get-cash-flow.ts`:

```ts
import type { ListScheduledMovements } from "@/modules/ledger/application";
import { addDays, ok, todayIn, type Clock, type LocalDate, type Result, type UserTimeZones } from "@/shared/kernel";
import { cashFlow, type CashFlowDate, type CashFlowMovement, type CashFlowProjection, type OwnAccount } from "../domain/cash-flow";

/** Ruling P241 (M6c): the windows the calendar offers. */
export const CASH_FLOW_DAYS = [30, 60] as const;
export type CashFlowDays = (typeof CASH_FLOW_DAYS)[number];

/** What the caller's cash flow reads; the composition root binds each port (ruling P238). */
export interface CashFlowDeps {
  readonly clock: Clock;
  readonly userTimeZones: UserTimeZones;
  /** The spaces the user is a current member of, archived ones left out, oldest first. */
  readonly spacesOf: (userId: string) => Promise<readonly { readonly spaceId: string; readonly name: string }[]>;
  /** The ledger's `listScheduledMovements` (Task 1c). */
  readonly scheduled: ListScheduledMovements;
  /** The user's own accounts in their personal space, whether each counts in its available money, and that total. */
  readonly ownAccountsOf: (userId: string) => Promise<{
    readonly currency: string;
    readonly available: bigint;
    readonly accounts: readonly OwnAccount[];
  }>;
}

export interface CashFlowView extends Omit<CashFlowProjection, "dates"> {
  readonly currency: string;
  readonly from: LocalDate;
  readonly through: LocalDate;
  readonly days: CashFlowDays;
  readonly opening: bigint;
  readonly dates: readonly (Omit<CashFlowDate, "movements"> & {
    readonly movements: readonly (CashFlowMovement & { readonly space: { readonly id: string; readonly name: string } })[];
  })[];
}

export type GetCashFlow = (input: { readonly userId: string; readonly days: CashFlowDays }) => Promise<Result<CashFlowView>>;

/**
 * #150, ruling P238 (M6c): what comes into and goes out of the caller's own accounts from today, in their zone,
 * through `days` − 1 days later, across every space they are a current member of, with the balance after each date.
 */
export const createGetCashFlow =
  (deps: CashFlowDeps): GetCashFlow =>
  async ({ userId, days }) => {
    const today = todayIn(deps.clock, await deps.userTimeZones.timeZoneOf(userId));
    const through = addDays(today, days - 1);
    const [spaces, own] = await Promise.all([deps.spacesOf(userId), deps.ownAccountsOf(userId)]);
    const listed = await Promise.all(
      spaces.map(async (space) =>
        (await deps.scheduled({ spaceId: space.spaceId, through })).map((m) => ({
          ...m,
          spaceId: space.spaceId,
          spaceName: space.name,
        })),
      ),
    );
    const projection = cashFlow({
      today,
      through,
      currency: own.currency,
      opening: own.available,
      accounts: own.accounts,
      movements: listed.flat(),
    });
    return ok({
      ...projection,
      currency: own.currency,
      from: today,
      through,
      days,
      opening: own.available,
      dates: projection.dates.map((d) => ({
        ...d,
        movements: d.movements.map((m) => ({ ...m, space: { id: m.spaceId, name: m.spaceName } })),
      })),
    });
  };
```

`src/modules/reporting/application/index.ts`: `export { CASH_FLOW_DAYS, createGetCashFlow, type CashFlowDays, type CashFlowDeps, type CashFlowView, type GetCashFlow } from "./get-cash-flow";`.

Run: Step 4's command.
Expected: PASS.

- [ ] **Step 6: Write the failing acceptance test**

`tests/support/reporting.ts` gains `CashFlowDto` (the wire shape of `CashFlowSchema`, amounts as `MoneyDto`) and

```ts
/** #150: `user`'s cash flow over `days` (a string, so a refused value can be sent). */
export const cashFlowOf = (user: TestUser, days: string) =>
  call(cashFlowRoute, "GET", `/api/v1/me/cash-flow?days=${days}`, { user });
```

with `import { GET as cashFlowRoute } from "@/app/api/v1/me/cash-flow/route";`.

`tests/acceptance/cash-flow.test.ts` runs on the suite's `DEFINITION_DAY_CLOCK` (2026-10-28 in Bogotá), set as `tests/acceptance/recurrences.test.ts` sets it. It keeps the recurrences it defines in `const toEnd: { spaceId: string; user: TestUser; id: string }[] = []`, and an `afterEach` ends each one through `POST …/recurrences/{id}/end`, as that file does, so the job of another file never finds one due:

```ts
describe("the cash-flow calendar (#150, rulings P238–P240 of M6c)", () => {
  it("projects Ana's own accounts over 60 days, leaving out the rent the fund pays", async () => {
    const h = await householdWithFund();
    const salary = await defined(h.ana.personal, h.ana.personal.spaceId, {
        description: "Salario",
        amount: cop(3_000_000),
        template: { type: "INCOME", categoryId: await categoryWithKey(h.ana.personal, "salary"), accountId: h.ana.account },
        schedule: { kind: "MONTHLY", day: 30 },
        mode: "AUTO",
        startDate: "2026-10-30",
    });
    const internet = await defined(
      h.ana,
      h.spaceId,
      rentBody(h, {
        description: "Internet",
        amount: cop(120_000),
        template: { type: "EXPENSE", categoryId: h.utilities, payer: { memberId: h.ana.memberId, accountId: h.ana.account } },
        schedule: { kind: "MONTHLY", day: 5 },
        startDate: "2026-11-05",
      }),
    );
    // The fund pays the Rent: it moves no account of Ana's, so it is not hers to see.
    const rent = await defined(h.ana, h.spaceId, rentBody(h));
    toEnd.push(
      { spaceId: h.ana.personal.spaceId, user: h.ana.personal, id: salary.id },
      { spaceId: h.spaceId, user: h.ana, id: internet.id },
      { spaceId: h.spaceId, user: h.ana, id: rent.id },
    );
    const response = await cashFlowOf(h.ana.personal, "60");
    expect(response.status).toBe(200);
    const flow = (await response.json()) as CashFlowDto;
    expect(flow).toMatchObject({ from: "2026-10-28", through: "2026-12-26", days: 60, opening: cop(2_000_000) });
    expect(flow.dates.map((d) => [d.date, d.movements.map((m) => [m.description, m.effect]), d.balanceAfter])).toEqual([
      ["2026-10-30", [["Salario", cop(3_000_000)]], cop(5_000_000)],
      ["2026-11-05", [["Internet", cop(-120_000)]], cop(4_880_000)],
      ["2026-11-30", [["Salario", cop(3_000_000)]], cop(7_880_000)],
      ["2026-12-05", [["Internet", cop(-120_000)]], cop(7_760_000)],
    ]);
    expect(flow.totals).toEqual({ incoming: cop(6_000_000), outgoing: cop(240_000), closing: cop(7_760_000) });
    expect(flow.lowest).toEqual({ date: "2026-10-28", balance: cop(2_000_000) });
  });

  it("projects only known items: a large one-off expense today lowers today's money and adds no future date (ruling P245)", async () => {
    const h = await householdWithFund();
    expect(
      (
        await post(recordExpense, h.ana, "expenses", {
          description: "Laptop",
          date: "2026-10-28",
          categoryId: h.groceries,
          amount: cop(900_000),
          accountId: h.ana.account,
        })
      ).status,
    ).toBe(201);
    const flow = (await (await cashFlowOf(h.ana.personal, "60")).json()) as CashFlowDto;
    expect([flow.opening, flow.dates, flow.lowest]).toEqual([cop(1_100_000), [], { date: "2026-10-28", balance: cop(1_100_000) }]);
  });

  it("answers 30 days by default and refuses any other window", async () => {
    const h = await householdWithFund();
    const flow = (await (await call(cashFlowRoute, "GET", "/api/v1/me/cash-flow", { user: h.ana.personal })).json()) as CashFlowDto;
    expect([flow.days, flow.through]).toEqual([30, "2026-11-26"]);
    const refused = await cashFlowOf(h.ana.personal, "45");
    expect(refused.status).toBe(422);
    expect((await problemOf(refused)).code).toBe("ValidationFailed");
  });
});
```

Run: `pnpm exec vitest run --project acceptance tests/acceptance/cash-flow.test.ts`
Expected: FAIL — the route does not exist.

(`post` and `recordExpense` are imported as `tests/acceptance/budget-rollover.test.ts` imports them.)

- [ ] **Step 7: The contract, the route and the wiring**

`src/modules/reporting/contracts/reporting.contract.ts`:

```ts
/** #150, ruling P241 (M6c): the calendar's window, 30 days unless 60 is asked for. */
export const CashFlowQuerySchema = z.object({
  days: z.enum(["30", "60"]).default("30").transform((days) => Number(days) as CashFlowDays),
});

const CashFlowMovementSchema = z.object({
  recurrenceId: z.string(),
  occurrenceId: z.string().nullable(),
  type: z.enum(["EXPENSE", "INCOME", "TRANSFER", "FUND_CONTRIBUTION"]),
  description: z.string(),
  space: z.object({ id: z.string(), name: z.string() }),
  dueDate: z.string().describe("When it was due; a PENDING occurrence or an unreached earlier date is listed on today."),
  status: z.enum(["SCHEDULED", "PENDING"]),
  estimated: z.boolean().describe("A CONFIRM recurrence's estimate, which a member confirms or changes."),
  amount: MoneySchema,
  effect: MoneySchema.describe(
    "The signed change of the caller's available money: + into a counted account, − out of one, 0 between two or none.",
  ),
});

export const CashFlowSchema = z.object({
  currency: z.string(),
  from: z.string(),
  through: z.string(),
  days: z.union([z.literal(30), z.literal(60)]),
  opening: MoneySchema.describe("Today's available money of the caller's personal space."),
  dates: z.array(z.object({ date: z.string(), movements: z.array(CashFlowMovementSchema), balanceAfter: MoneySchema })),
  totals: z.object({ incoming: MoneySchema, outgoing: MoneySchema, closing: MoneySchema }),
  lowest: z.object({ date: z.string(), balance: MoneySchema }),
  otherCurrencySpaces: z.array(z.object({ spaceId: z.string(), name: z.string(), currency: z.string() })),
});

export const cashFlowDto = (view: CashFlowView): z.infer<typeof CashFlowSchema> => {
  const money = (minor: bigint) => moneyOf(minor, view.currency);
  return {
    currency: view.currency,
    from: view.from,
    through: view.through,
    days: view.days,
    opening: money(view.opening),
    dates: view.dates.map((d) => ({
      date: d.date,
      movements: d.movements.map((m) => ({
        recurrenceId: m.recurrenceId,
        occurrenceId: m.occurrenceId,
        type: m.type,
        description: m.description,
        space: m.space,
        dueDate: m.date,
        status: m.status,
        estimated: m.estimated,
        amount: money(m.amount),
        effect: money(m.effect),
      })),
      balanceAfter: money(d.balanceAfter),
    })),
    totals: { incoming: money(view.totals.incoming), outgoing: money(view.totals.outgoing), closing: money(view.totals.closing) },
    lowest: { date: view.lowest.date, balance: money(view.lowest.balance) },
    otherCurrencySpaces: [...view.otherCurrencySpaces],
  };
};
```

and in the paths object, after `"/api/v1/me/trend"`:

```ts
  "/api/v1/me/cash-flow": {
    get: {
      operationId: "getCashFlow",
      summary: "What comes into and goes out of the caller's own accounts over the next 30 or 60 days",
      description:
        "Every scheduled date of the active recurrences and every pending occurrence of the spaces the caller is a current member of, when it debits or credits an account the caller owns, with the projected balance of the personal space's available money after each date. Earlier due dates are listed on today.",
      ...securedByUser,
      requestParams: { query: CashFlowQuerySchema },
      responses: {
        "200": { description: "The caller's dated movements and projected balances", content: jsonContent(CashFlowSchema) },
        ...problems({ "401": "Unauthenticated", "422": "ValidationFailed" }),
      },
    },
  },
```

`src/app/api/v1/me/cash-flow/route.ts` follows `src/app/api/v1/me/trend/route.ts`: `query: CashFlowQuerySchema`, `getContainer().reporting.getCashFlow({ userId: user!.id, days: query.days })`, and `cashFlowDto(result.value)` with status 200.

`src/composition/container.ts`: the `reporting` type and object gain `getCashFlow: createGetCashFlow({ … })`, bound with what already exists:
- `clock` and `userTimeZones`: the ones accounts already receives;
- `spacesOf`: the spaces' `listForUser(userId, { includeArchived: false })` that `createListMySpaces` reads, mapped to `{ spaceId: id, name }`;
- `scheduled`: `createListScheduledMovements({ recurrences, occurrences })` over the ledger's repositories;
- `ownAccountsOf`: the user's personal space (the `PERSONAL` space among `listForUser`), its accounts through `createListAccounts` (`includeArchived: false`), giving `currency`, `totals.available` and, for each account whose `ownerUserId` is the user, `{ id, counted }`, where `counted` is the switch `totalsOf` reads (`switchesOf(account).includeInAvailable`). Export `switchesOf` from `accounts/application` if it is not exported yet.

`docs/backlog/E7-reporting.md`: after HU-E7-06 add a short section "Addition taken into M6c: the cash-flow calendar (#150)" naming `GET /api/v1/me/cash-flow?days=30|60` and rulings P238–P240.

- [ ] **Step 8: Regenerate the snapshot and the client types, and run the gates**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts`, then `pnpm api:types`, then Step 6's command and every gate. The snapshot diff is the new path and its schemas only.
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/modules/reporting src/app/api/v1/me/cash-flow src/composition/container.ts src/modules/accounts/application/index.ts \
  tests/support/reporting.ts tests/acceptance/cash-flow.test.ts openapi/openapi.snapshot.json src/shared/ui/api/schema.d.ts \
  docs/backlog/E7-reporting.md
git commit -m "feat(reporting): project the caller's cash flow over the next 30 or 60 days (Refs #150)"
```

If the staged candidate is over ~500 lines, commit it in two passes at the named split point:
1. `cash-flow.ts` and its test: `feat(reporting): project a balance over dated movements of the caller's accounts (Refs #150)`;
2. the use case, the contract, the route, the wiring and the acceptance test: `feat(reporting): project the caller's cash flow over the next 30 or 60 days (Refs #150)`.

---

### Task 1e: Carry over only from a closed plan, and name where it came from

Issue #143's rollover exists (HU-E6-09, ruling P15), but it reads the plan a line was copied from "whatever its status". A hands-on test of the competitor on 2026-10-21 showed the pitfall this allows. Turning rollover on for a budget with no real history credited a whole month ("$1,500 + $1,500 rolled over"). In Hearth, a copy of a November plan that nobody used yet would carry November's whole planned amount. So a line carries only from a **CLOSED** plan, the one it was copied from, and only from the line it was copied from in that plan. Every carrying line also says where its amount came from, or that it waits for that plan to close (ruling P243, amending P15).

This changes what `carryOver` answers for a copy of a plan that is not CLOSED: 0 until the source closes, where it was the source's available amount. Both line DTOs gain `carryOverFrom`. **Risk: item 3** (an answered figure other clients read changes meaning). The task commits alone and gets an independent verifier after its checks.

**Depends on:** M3's rollover (HU-E6-09) and Task 1b (the same reporting files).

**Files:**
- Modify:
  - `src/modules/budgeting/domain/plan-figures.ts`, `src/modules/budgeting/domain/plan-figures.test.ts`;
  - `src/modules/budgeting/application/plan-view.ts`, `src/modules/budgeting/application/rollover.test.ts`;
  - `src/modules/budgeting/contracts/budgeting.contract.ts`, `src/modules/budgeting/contracts/budgeting.contract.test.ts`;
  - `src/modules/reporting/application/get-line-dashboard.ts`, `src/modules/reporting/application/line-dashboard.test.ts`, `src/modules/reporting/application/trend.test.ts` (its ROLLOVER chain);
  - `src/modules/reporting/contracts/reporting.contract.ts`;
  - `tests/support/budgeting.ts`, `tests/support/reporting.ts`, `tests/acceptance/budget-rollover.test.ts`, `tests/acceptance/reports-lines.test.ts`;
  - `openapi/openapi.snapshot.json` (regenerated), `src/shared/ui/api/schema.d.ts` (regenerated);
  - `docs/backlog/E6-budgeting.md`.

**Interfaces:**
- Consumes: `planFigures`, `PreviousAvailable`, `carryOver`, `BudgetPlan.status`, `loadPlanView`'s chain walk (`previousAvailable`), `closePlan` and `activatePlan` (`tests/support/budgeting.ts`).
- Produces:
  - `interface CarrySource { planId: string; period: Period; closed: boolean; lineIds: readonly string[] }` in `plan-figures.ts`. `planFigures`' input gains `source?: CarrySource | null`;
  - `LineFigure.carryOverFrom: { planId: string; period: Period; closed: boolean } | null`. It is set when the line's mode is not RESET and its `originLineId` is one of `source.lineIds`, and null otherwise;
  - `loadPlanView` passes `previousAvailable` only from a CLOSED source, and always passes `source`;
  - `DashboardLine.carryOverFrom` (same shape);
  - on the wire, both the plan's lines and the line dashboard's lines gain `carryOverFrom: { planId, period: Period, closed: boolean } | null`.

- [ ] **Step 1: Write the failing tests**

`src/modules/budgeting/application/rollover.test.ts`:
- The world gains `const close = (planId: string) => w.plans.setStatus(planId, "CLOSED");`, the in-memory repository's own status write, as `plan-lifecycle` leaves a closed plan. The world returns it.
- Every existing test that expects a non-zero carry first runs `await close(november.id)` (and `close` on December in the three-period ADJUSTED chain), before the copy is read. Their expected figures stay as they are.
- Append:

```ts
  it("carries nothing from a plan that is not CLOSED yet, and says which plan it waits for (#143, ruling P243 of M6c)", async () => {
    const { copyInto, november } = await world("ROLLOVER", { "2026-11-01": pesos(1_270_000) });
    const december = await copyInto("2026-12");
    const [line] = december.figures.lines;
    expect(home(december)).toEqual(["Home", 0n, pesos(1_470_000)]);
    expect(line!.carryOverFrom).toEqual({ planId: november.id, period: november.period, closed: false });
  });

  it("carries once the source is CLOSED and names it, and a line the source never had carries nothing", async () => {
    const { copyInto, november, close, read, deps, w } = await world("ROLLOVER", { "2026-11-01": pesos(1_270_000) });
    await close(november.id);
    const december = await copyInto("2026-12");
    expect(home(december)).toEqual(["Home", pesos(200_000), pesos(1_670_000)]);
    expect(december.figures.lines[0]!.carryOverFrom).toEqual({ planId: november.id, period: november.period, closed: true });
    // A line added to December has no origin: no history, so no carry and no source (the competitor's pitfall).
    w.plans.seed(december.plan.id, {
      lines: [...december.figures.lines.map((f) => f.line), aLine("Pets", pesos(100_000), { id: "line-pets" as BudgetLineId, rolloverMode: "ROLLOVER" })],
    });
    const pets = (await read(december.plan.id)).figures.lines.find((f) => f.line.name === "Pets")!;
    expect([pets.carryOver, pets.carryOverFrom]).toEqual([0n, null]);
  });

  it("names no source for a RESET line, even from a CLOSED plan", async () => {
    const { copyInto, november, close } = await world("RESET", { "2026-11-01": pesos(1_270_000) });
    await close(november.id);
    expect((await copyInto("2026-12")).figures.lines[0]!.carryOverFrom).toBeNull();
  });
```

(`aLine`, `BudgetLineId` and the world's `w` are already in scope or imported by the file. If `seed` replaces rather than merges the parts, pass the copy's mappings and capacities back too.)

`src/modules/budgeting/domain/plan-figures.test.ts`, appended:

```ts
describe("where a carry-over comes from (ruling P243 of M6c)", () => {
  it("names the source for a carrying line whose origin the source holds", () => {
    const source = { planId: "plan-nov", period: { label: "2026-11", start: "2026-11-01", end: "2026-11-30" }, closed: true, lineIds: ["line-home-nov"] } as const;
    const figures = planFigures({
      currency: "COP",
      memberIds: ["member-ana"],
      parts: {
        capacities: [{ memberId: "member-ana", amount: 400_000_000n }],
        lines: [
          aLine("Home", 147_000_000n, { originLineId: "line-home-nov", rolloverMode: "ROLLOVER" }),
          aLine("Pets", 10_000_000n, { id: "line-pets" as BudgetLineId, originLineId: "line-gone", rolloverMode: "ROLLOVER" }),
        ],
        mappings: [],
        allocations: [],
      },
      spending: { byCategory: [], byAccount: [] },
      previousAvailable: [{ lineId: "line-home-nov", available: 20_000_000n }],
      source,
    });
    expect(figures.lines.map((l) => [l.line.name, l.carryOver, l.carryOverFrom?.planId ?? null])).toEqual([
      ["Home", 20_000_000n, "plan-nov"],
      ["Pets", 0n, null],
    ]);
  });
});
```

`tests/acceptance/budget-rollover.test.ts`:
- The suite runs on a clock after November: `startTestApp({ clock: new FixedClock(new Date("2026-12-02T17:00:00Z")) })`.
- `rolledInto` activates and closes the November plan (`activatePlan`, then `closePlan`, each with the version it last read) before it copies. The outline's six rows keep their figures.
- `carryOverFrom` is asserted on December's Home: `{ planId: <November's id>, period: { label: "2026-11", … }, closed: true }`, or `null` for RESET.
- One test is added: "carries nothing from a November that is only ACTIVE". It is the ROLLOVER row with November activated and not closed: December's Home answers `carryOver` `cop(0)`, available `cop(1_470_000)` and `carryOverFrom.closed` `false`.

`src/modules/reporting/application/line-dashboard.test.ts`: the October-into-November ROLLOVER test, whose October is already `CLOSED`, also expects `carryOverFrom: { planId: october.id, period: october.period, closed: true }` on Home.

Run: `pnpm exec vitest run --project unit src/modules/budgeting src/modules/reporting` and `pnpm exec vitest run --project acceptance tests/acceptance/budget-rollover.test.ts tests/acceptance/reports-lines.test.ts`
Expected: FAIL — a copy of a DRAFT or ACTIVE plan still carries, and `carryOverFrom` does not exist.

- [ ] **Step 2: Implement**

`src/modules/budgeting/domain/plan-figures.ts`:
- add, after `PreviousAvailable`:

```ts
/**
 * HU-E6-09, ruling P243 (M6c): the plan this one was copied from, as its carry-over reads it. Only a CLOSED source
 * carries; before it closes, `previousAvailable` is empty and its lines say they wait for it.
 */
export interface CarrySource {
  readonly planId: string;
  readonly period: Period;
  readonly closed: boolean;
  /** The source's current lines: a line carries only from the line it was copied from, if the source still has it. */
  readonly lineIds: readonly string[];
}
```

- `LineFigure` gains `/** Ruling P243 (M6c): where the carry-over comes from; null for RESET or a line without an origin in the source. */ readonly carryOverFrom: { readonly planId: string; readonly period: Period; readonly closed: boolean } | null;`;
- `planFigures`' input gains `readonly source?: CarrySource | null;`. Each line computes

```ts
    const from =
      source && line.rolloverMode !== "RESET" && line.originLineId !== null && source.lineIds.includes(line.originLineId)
        ? { planId: source.planId, period: source.period, closed: source.closed }
        : null;
```

  and returns `carryOverFrom: from`. The carry is unchanged (`carryOver(mode, origin?.available ?? null)`): the application passes `previousAvailable` only from a CLOSED source, so the domain needs no second gate;
- the doc comment of `planFigures` gains "Ruling P243 (M6c): a carry comes only from a CLOSED source, which `loadPlanView` enforces by what it passes."

`src/modules/budgeting/application/plan-view.ts`, `previousAvailable` becomes `carryOf`. It answers `{ source: CarrySource | null; available: PreviousAvailable[] }`:
- `{ source: null, available: [] }` where it returned `[]` before;
- for a source that is not `CLOSED`, `{ source: { planId: source.id, period: source.period, closed: false, lineIds: (await deps.plans.contents(source.id)).lines.map((l) => l.id) }, available: [] }`. Nothing of the source is figured, so no spending is read;
- for a CLOSED source, its figures as before, with `lineIds` taken from `figures.lines` (no second `contents` read), and `closed: true`.

`figuresOf` passes both `source` and `previousAvailable: available` to `planFigures`. The doc comment's "Earlier plans are read whatever their status (ruling P15)" becomes "An earlier plan carries only once CLOSED (ruling P243, amending P15); a chain walks on only through CLOSED plans."

`src/modules/budgeting/contracts/budgeting.contract.ts`: the line schema gains, after `carryOver`,

```ts
  /** Ruling P243 (M6c): the plan the carry-over comes from; it carries only once that plan is CLOSED. */
  carryOverFrom: z.object({ planId: z.string(), period: PeriodSchema.extend({}), closed: z.boolean() }).nullable(),
```

and the line's DTO maps it with `periodDto`. `src/modules/reporting/application/get-line-dashboard.ts`: `DashboardLine` gains `readonly carryOverFrom: LineFigure["carryOverFrom"];` from `f.carryOverFrom`. `reporting.contract.ts`'s line gains the same field and mapping, so both answers agree (`reports-lines.test.ts` already compares the two line by line; extend that comparison with `carryOverFrom`).

`src/modules/reporting/application/trend.test.ts`: the ROLLOVER `chain` seeds every plan but the last as `CLOSED`. Its figures and the P105 read counts stay as they are, because a CLOSED source is read exactly as before.

`tests/support/budgeting.ts` and `tests/support/reporting.ts`: the line DTO types gain `carryOverFrom`.

- [ ] **Step 3: Regenerate the snapshot and the client types, and run the gates**

Run: `UPDATE_OPENAPI_SNAPSHOT=1 pnpm exec vitest run --project unit src/composition/openapi.test.ts`, then `pnpm api:types`, then Step 1's commands and every gate. The snapshot diff is the two `carryOverFrom` fields only.
Expected: all PASS.

- [ ] **Step 4: Update the backlog**

`docs/backlog/E6-budgeting.md`, HU-E6-09:
- the Scenario Outline gains the Given line `And the plan for 2026-11 is CLOSED before 2026-12 is read`;
- a scenario is added:

```gherkin
  Scenario: Nothing carries from a plan that is not closed
    Given the line "Home" has planned 1,470,000 COP in both 2026-11 and 2026-12 with rollover "ROLLOVER"
    And spending in "Home" during 2026-11 was 1,270,000 COP
    And the plan for 2026-11 is ACTIVE
    When "Ana" requests the line "Home" for 2026-12
    Then the December carry-over is 0 COP and the December available amount is 1,470,000 COP
    And the line says its carry-over comes from 2026-11, which is not closed
```

- the technical notes gain "A line carries only from the CLOSED plan it was copied from, and only from its origin line there. `carryOverFrom` names that plan and whether it is closed (M6c ruling P243)."

The controller updates the issue body of HU-E6-09 the same way.

- [ ] **Step 5: Independent verification**

The Risk line names item 3, so after the change's own checks an independent verifier receives this task and rulings P228–P231 and P243. It also receives the baseline commit and the probe forms:
- the HU-E6-09 outline through the API, with November CLOSED and with November ACTIVE;
- a December line added by hand;
- the 30-plan trend chain.

It reports each probe's result before the commit.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting src/modules/reporting tests/support/budgeting.ts tests/support/reporting.ts \
  tests/acceptance/budget-rollover.test.ts tests/acceptance/reports-lines.test.ts openapi/openapi.snapshot.json \
  src/shared/ui/api/schema.d.ts docs/backlog/E6-budgeting.md
git commit -m "feat(budgeting): carry over only from a closed plan and name where the carry-over comes from (Refs #143)"
```

---

### Task 2: Percentages, signed amounts, period names and the period switcher

The groundwork every M6c screen shares, in `src/shared/ui`. Here is what each piece is for:
- **Two formatters** (ruling P204). Shares and changes keep their two decimals ("40,00 %", "−3,70 %"). Changes carry their sign ("+$ 50.000").
- **The currencies' rounding unit**, for the allocation preview (ruling P211).
- **`periodName`, moved from `ledger/ui/home` to `shared/ui/time`.** Three modules name periods now (ruling P224).
- **`usePeriodText`.** It writes "noviembre 2026" for a calendar month, and the two dates of any other period.
- **A `PeriodSwitcher`.** It shows the period as the page's heading, between links to its neighbours (the Lines artboard's header).
- **Four interface icons** (ruling P225).

**Files:**
- Create: `src/shared/ui/format/currencies.test.ts`, `src/shared/ui/molecules/period-text.ts`, `src/shared/ui/molecules/period-switcher.tsx`, `src/shared/ui/molecules/period-switcher.test.tsx`
- Move: `src/modules/ledger/ui/home/period-name.ts` → `src/shared/ui/time/period-name.ts` and `src/modules/ledger/ui/home/period-name.test.ts` → `src/shared/ui/time/period-name.test.ts` (`git mv`)
- Modify: `src/shared/ui/format/formatters.ts`, `src/shared/ui/format/formatters.test.ts`, `src/shared/ui/format/currencies.ts`, `src/modules/ledger/ui/home/home-summary.tsx`, `src/shared/ui/icons/ui-icons.ts`, `src/shared/ui/index.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `formatNumber`'s separators (`SEPARATORS`, `NBSP`, `MINUS`), `formatMoney`, `formatDate`, `periodName`.
- Produces:
  - `formatPercent(decimal: string, f: Pick<Formats, "numberFormat">, options?: { signed?: boolean }): string` (`"36.75"` → `"36,75 %"` with a non-breaking space, a negative with U+2212, `signed` adds `+` to a positive value; zero is never signed);
  - `formatSignedMoney(money, f): string` (`+$ 50.000`, `−$ 50.000`, `$ 0`);
  - `currencyOf(code).roundingUnit: bigint` (COP `100n`, USD `1n`, EUR `1n`, unknown `1n`);
  - `periodName` from `@/shared/ui/time/period-name` (unchanged signature);
  - `usePeriodText(): (period: PeriodDto, policy: SpaceDto["periodPolicy"], formats: Pick<Formats, "dateFormat">) => string` (`"noviembre 2026"`, or `"1/11/2026 – 15/11/2026"`);
  - `PeriodSwitcher({ title, previousHref, nextHref }: { title: string; previousHref: string | null; nextHref: string | null })` (an `h1` with the title between two links named `common.previousPeriod` and `common.nextPeriod`; a missing neighbour leaves a 44 px spacer);
  - `UI_ICONS.chart`, `.pencil`, `.arrowUp`, `.arrowDown`.

- [ ] **Step 1: Write the failing tests**

`src/shared/ui/format/formatters.test.ts`: add `formatPercent`, `formatSignedMoney`, `MINUS` and `NBSP` to its import from `./formatters`, and append:

```ts
describe("percentages and signed amounts (ruling P204)", () => {
  it("keeps two decimals in the person's number format, with a non-breaking space before %", () => {
    expect(formatPercent("40.00", BUILT_IN_FORMATS)).toBe(`40,00${NBSP}%`);
    expect(formatPercent("36.75", BUILT_IN_FORMATS)).toBe(`36,75${NBSP}%`);
    expect(formatPercent("1234.50", BUILT_IN_FORMATS)).toBe(`1.234,50${NBSP}%`);
    expect(formatPercent("100.00", { numberFormat: "COMMA_DOT" })).toBe(`100.00${NBSP}%`);
  });

  it("writes a negative change with U+2212 and a positive one with + only when asked", () => {
    expect(formatPercent("-3.70", BUILT_IN_FORMATS)).toBe(`${MINUS}3,70${NBSP}%`);
    expect(formatPercent("3.70", BUILT_IN_FORMATS, { signed: true })).toBe(`+3,70${NBSP}%`);
    expect(formatPercent("3.70", BUILT_IN_FORMATS)).toBe(`3,70${NBSP}%`);
    expect(formatPercent("0.00", BUILT_IN_FORMATS, { signed: true })).toBe(`0,00${NBSP}%`);
  });

  it("signs an amount of change: + above zero, U+2212 below, nothing at zero", () => {
    expect(formatSignedMoney({ amount: "5000000", currency: "COP" }, BUILT_IN_FORMATS)).toBe(`+$${NBSP}50.000`);
    expect(formatSignedMoney({ amount: "-5000000", currency: "COP" }, BUILT_IN_FORMATS)).toBe(
      `${MINUS}$${NBSP}50.000`,
    );
    expect(formatSignedMoney({ amount: "0", currency: "COP" }, BUILT_IN_FORMATS)).toBe(`$${NBSP}0`);
  });
});
```

`src/shared/ui/format/currencies.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { currencyOf as kernelCurrency } from "@/shared/kernel";
import { currencyOf } from "./currencies";

describe("UI currencies (ruling P211)", () => {
  it("round allocations like the server does", () => {
    for (const code of ["COP", "USD", "EUR"]) {
      const server = kernelCurrency(code);
      if (!server.ok) throw new Error(code);
      expect([code, currencyOf(code).exponent, currencyOf(code).roundingUnit]).toEqual([
        code,
        server.value.exponent,
        server.value.roundingUnit,
      ]);
    }
    expect(currencyOf("XYZ").roundingUnit).toBe(1n);
  });
});
```

(A test may import the kernel barrel; dependency-cruiser excludes `*.test.ts`.)

`src/shared/ui/molecules/period-switcher.test.tsx`:

```tsx
import { renderHook, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { IntlWrapper, renderWithIntl } from "../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "../format/formatters";
import { usePeriodText } from "./period-text";
import { PeriodSwitcher } from "./period-switcher";

describe("period text and switcher (HU-E9-10, ruling P205)", () => {
  it("names a calendar month by its month and any other period by its dates, in the person's format", () => {
    const { result } = renderHook(() => usePeriodText(), { wrapper: IntlWrapper("es") });
    const november = { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" };
    expect(result.current(november, { kind: "MONTHLY", day: 1 }, BUILT_IN_FORMATS)).toBe("noviembre 2026");
    const half = { label: "2026-11 H1", startDate: "2026-11-01", endDate: "2026-11-15" };
    expect(result.current(half, { kind: "SEMI_MONTHLY", day1: 1, day2: 16 }, BUILT_IN_FORMATS)).toBe(
      "1/11/2026 – 15/11/2026",
    );
  });

  it("shows the period as the heading between links to its neighbours", async () => {
    const { container } = renderWithIntl(
      <PeriodSwitcher title="noviembre 2026" previousHref="/p?period=2026-10" nextHref={null} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "noviembre 2026" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Período anterior" })).toHaveAttribute("href", "/p?period=2026-10");
    expect(screen.queryByRole("link", { name: "Período siguiente" })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/shared/ui/format` and `pnpm exec vitest run --project ui src/shared/ui/molecules/period-switcher.test.tsx`
Expected: FAIL — `formatPercent` is not exported, `roundingUnit` is `undefined`, `./period-text` does not resolve.

- [ ] **Step 3: Implement**

`src/shared/ui/format/formatters.ts`, after `formatMoney`:

```ts
/**
 * Ruling P204: "36.75" → "36,75 %", "-3.70" → "−3,70 %". The API's two decimals are kept (a zero fraction too: a
 * share reads "40,00 %"), the number follows the person's format, and `signed` writes "+" before a positive change.
 */
export const formatPercent = (
  decimal: string,
  f: Pick<Formats, "numberFormat">,
  { signed = false }: { readonly signed?: boolean } = {},
): string => {
  const negative = decimal.startsWith("-");
  const [whole = "0", fraction = ""] = decimal.replace(/^[-+]/, "").split(".");
  const [group, point] = SEPARATORS[f.numberFormat];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const zero = /^0*$/.test(whole + fraction);
  const sign = zero ? "" : negative ? MINUS : signed ? "+" : "";
  return `${sign}${grouped}${fraction === "" ? "" : point + fraction}${NBSP}%`;
};

/** A change of money: "+$ 50.000" above zero, "−$ 50.000" below, "$ 0" at zero (ruling P204). */
export const formatSignedMoney = (
  money: { readonly amount: string; readonly currency: string },
  f: Pick<Formats, "numberFormat">,
): string => {
  const text = formatMoney(money, f);
  return BigInt(money.amount) > 0n ? `+${text}` : text;
};
```

`src/shared/ui/format/currencies.ts` becomes:

```ts
/**
 * HU-E9-02: the symbol a currency shows, never the language's (P68); amounts on the wire are minor units. The
 * rounding unit is the server's (spec 5.3), so the allocation preview rounds like the plan does (ruling P211).
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

Move the period name: `git mv src/modules/ledger/ui/home/period-name.ts src/shared/ui/time/period-name.ts` and `git mv src/modules/ledger/ui/home/period-name.test.ts src/shared/ui/time/period-name.test.ts`. In `home-summary.tsx` replace `import { periodName } from "./period-name";` with `import { periodName } from "@/shared/ui/time/period-name";`. The moved test keeps its `./period-name` import and its describe title.

`src/shared/ui/molecules/period-text.ts`:

```ts
import { useTranslations } from "next-intl";
import type { PeriodDto, SpaceDto } from "../api/dto";
import { formatDate, type Formats } from "../format/formatters";
import { periodName } from "../time/period-name";

/**
 * Ruling P205: a period as words: "noviembre 2026" for a calendar month (MONTHLY day 1), else its two dates in the
 * person's format. Works in Server and Client Components alike (next-intl's `useTranslations`).
 */
export const usePeriodText = () => {
  const t = useTranslations("common");
  return (period: PeriodDto, policy: SpaceDto["periodPolicy"], formats: Pick<Formats, "dateFormat">): string => {
    const name = periodName(period, policy);
    return name.kind === "month"
      ? t("periodMonth", { month: t(`month.${name.month}` as "month.1"), year: String(name.year) })
      : t("periodRange", { start: formatDate(name.start, formats), end: formatDate(name.end, formats) });
  };
};
```

`src/shared/ui/molecules/period-switcher.tsx` (no `"use client"`): a `div` with `flex items-center justify-between`; the previous link (`next/link`, a 44 × 44 box with `Icon name="back"` and `VisuallyHidden` `common.previousPeriod`) or a `span className="size-11"`; an `h1` with `title` (class `text-lg font-semibold text-ink first-letter:uppercase`); the next link (`Icon name="chevronRight"`, `common.nextPeriod`) or a spacer.

`src/shared/ui/icons/ui-icons.ts`, after the line `backspace: "M9 5h11v14H9l-6-7 6-7Zm4 4 5 6m0-6-5 6",` (keep any key M6b added):

```ts
  chart: "M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3",
  pencil: "M4 20h4L19 9l-4-4L4 16v4Z",
  arrowUp: "M12 19V5m-6 6 6-6 6 6",
  arrowDown: "M12 5v14m6-6-6 6-6-6",
```

(The paths are the Batch 2 artboards' own: Lines for `chart` and `pencil`, Matrix for the arrows.)

`src/shared/ui/index.ts`: add `export { PeriodSwitcher } from "./molecules/period-switcher";` and `export { usePeriodText } from "./molecules/period-text";`.

Catalog keys (`common`), es / en: `periodMonth` {month} {year} / {month} {year}; `periodRange` {start} – {end} / {start} – {end}; `previousPeriod` Período anterior / Previous period; `nextPeriod` Período siguiente / Next period.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, `pnpm exec vitest run --project unit src/shared/ui/time`, `pnpm exec vitest run --project ui src/modules/ledger/ui/home`, then every gate.
Expected: PASS (the home's tests are unchanged by the move).

- [ ] **Step 5: Commit**

```bash
git add src/shared/ui src/modules/ledger/ui/home src/i18n/messages
git commit -m "feat(web): format percentages and signed changes, and share the period heading (Refs #78)"
```

---

### Task 3: The Plan tab, the dashboard frame and the line dashboard

The Lines artboard and HU-E9-10's golden scenario at component level ("Line dashboard shows planned, spent and available", "Overspent lines are highlighted"). The bottom bar gains the Plan tab. Ruling P141 kept it hidden until its screens existed; ruling P200 brings it back. Every dashboard shares one frame:
- the space's name;
- the period as the heading, between its neighbours;
- the plan's status badge and the planner link;
- the view tabs.

The line dashboard is one table: line, planned, spent and available. Each row header carries the line's bar and its "Overspent" badge, and Unbudgeted is the last row. Above it sits a summary of the API's totals (Task 1). Ruling P202 makes the bars HTML.

**Files:**
- Create: `src/modules/reporting/ui/{views.ts, views.test.ts, report-period.ts, report-period.test.ts, plan-tabs.tsx, dashboard-frame.tsx, index.ts, server.ts}`, `src/modules/reporting/ui/lines/{line-dashboard.tsx, bar.ts, bar.test.ts, lines-container.tsx, lines.test.tsx}`, `src/modules/budgeting/ui/{plan-status-badge.tsx, index.ts}`, `src/modules/spaces/ui/nav-links.test.tsx`, `src/app/(web)/(app)/spaces/[spaceId]/plan/page.tsx`, `tests/support/ui/plan-dto.ts`
- Modify: `src/modules/spaces/ui/nav-links.tsx`, `src/shared/ui/api/dto.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `PeriodSwitcher`, `usePeriodText`, `Badge`, `Icon`, `VisuallyHidden`, `formatMoney` (Task 2); `loaded`, `serverApi`, `getMe`, `getSpaces`, `Loaded`; `addDays` from `@/shared/kernel/local-date`; `nowIn`, `serverNow`.
- Produces:
  - `dto.ts`: `LineDashboardDto` (`GET …/reports/lines`), `ReportPlanDto = NonNullable<LineDashboardDto["plan"]>`, `PlanStatus = ReportPlanDto["status"]`.
  - `views.ts`: `type PlanView = "lines" | "members" | "fund" | "groups" | "trend" | "mine"`, `viewsFor(kind): readonly PlanView[]` (this task: `["lines"]` for every kind; Tasks 9, 10, 11, 12, 14b and 15 extend the lists), `viewHref(space: Pick<SpaceDto, "id" | "kind">, view: PlanView, period?: string): string`.
  - `report-period.ts` (server): `periodLabel(api, spaceId, asked: string | undefined, today: string): Promise<Loaded<string>>`, `neighboursOf(api, spaceId, period: PeriodDto): Promise<{ previous: PeriodDto | null; next: PeriodDto | null }>`, `spaceOf(spaces: SpaceDto[], spaceId: string): SpaceDto` (`notFound()` when missing).
  - `PlanTabs({ space, view, period })` (a `nav` labelled `reports.tabs.label`); `DashboardFrame({ space, view, period, previous, next, formats, plan, children })`, where `plan: ReportPlanDto | null` adds the badge and the planner link.
  - `barWidth(spent: MoneyDto, planned: MoneyDto): number` (0–100, an integer: `spent × 100 ÷ planned` rounded down and capped at 100; 100 when nothing was planned and something was spent; 0 when nothing was).
  - `LineDashboard({ dashboard, formats })`; `loadLines(api, input: { spaceId: string; period?: string; today: string }): Promise<Loaded<{ dashboard: LineDashboardDto; previous: PeriodDto | null; next: PeriodDto | null }>>`; `LineDashboardContainer({ spaceId, period? })` (server).
  - `PlanStatusBadge({ status })`, exported from `budgeting/ui/index.ts`.
  - Test builders in `tests/support/ui/plan-dto.ts`: `householdDto(overrides?)` (`sp-household` "Household", SHARED, OWNER), `NOVEMBER` (the 2026-11 period), `e7Dashboard(overrides?)` (HU-E7-01's November dashboard with its totals).
  - `NavLinks` renders the Plan link `/spaces/{spaceId}/plan`, current on every path under it (`/plan…` and `/plans/…`).

- [ ] **Step 1: Write the builders and the failing tests**

`tests/support/ui/plan-dto.ts`:

```ts
import type { LineDashboardDto, SpaceDto } from "@/shared/ui/api/dto";
import { cop, spaceDto } from "./dto";

/** "Household": Ana's shared space, OWNER, MONTHLY(1), COP. */
export const householdDto = (overrides: Partial<SpaceDto> = {}): SpaceDto =>
  spaceDto({ id: "sp-household", name: "Household", kind: "SHARED", role: "OWNER", ...overrides });

export const NOVEMBER = { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" } as const;

type DashLine = LineDashboardDto["lines"][number];
const dashLine = (
  lineId: string,
  name: string,
  [planned, spent, available]: readonly [number, number, number],
  extra: Partial<DashLine> = {},
): DashLine => ({
  lineId,
  name,
  funding: "DIRECT",
  isCatchAll: false,
  planned: cop(planned),
  spent: cop(spent),
  carryOver: cop(0),
  available: cop(available),
  overspent: available < 0,
  // Tasks 1b and 1e: the line's state, its overage and where its carry-over comes from.
  state: available < 0 ? "OVER" : "OK",
  overBy: available < 0 ? cop(-available) : null,
  carryOverFrom: null,
  ...extra,
});

/** HU-E7-01's November 2026 dashboard of the E7 shared fixture, with the totals the API answers (Task 1). */
export const e7Dashboard = (overrides: Partial<LineDashboardDto> = {}): LineDashboardDto => ({
  spaceId: "sp-household",
  period: { ...NOVEMBER },
  plan: { id: "p-nov", status: "ACTIVE" },
  lines: [
    dashLine("l-rent", "Rent", [1_200_000, 1_200_000, 0], { funding: "SHARED_FUND", state: "HIGH" }),
    dashLine("l-home", "Home", [1_470_000, 1_300_000, 170_000], { state: "NEAR" }),
    dashLine("l-savings", "Savings", [600_000, 0, 600_000], { funding: "SAVINGS" }),
    dashLine("l-free", "Free", [730_000, 250_000, 480_000]),
  ],
  unbudgeted: { spent: cop(60_000), available: cop(-60_000), overspent: true },
  totals: { planned: cop(4_000_000), spent: cop(2_810_000), available: cop(1_190_000) },
  // Task 1b (ruling P234): the line each category consumes.
  categoryLines: [
    { categoryId: "c-rent", lineId: "l-rent" },
    { categoryId: "c-groceries", lineId: "l-home" },
    { categoryId: "c-utilities", lineId: "l-home" },
    { categoryId: "c-entertainment", lineId: "l-free" },
    { categoryId: "c-restaurants", lineId: null },
  ],
  ...overrides,
});
```

`src/modules/reporting/ui/views.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { viewHref, viewsFor } from "./views";

const shared = { id: "sp-household", kind: "SHARED" } as const;

describe("Plan tab views (ruling P200)", () => {
  it("opens a space's first view on the tab's own page and keeps the period", () => {
    expect(viewsFor("SHARED")).toEqual(["lines"]);
    expect(viewsFor("PERSONAL")).toEqual(["lines"]);
    expect(viewHref(shared, "lines")).toBe("/spaces/sp-household/plan");
    expect(viewHref(shared, "lines", "2026-11 H1")).toBe("/spaces/sp-household/plan?period=2026-11%20H1");
  });
});
```

`src/modules/reporting/ui/report-period.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { fakeApi, jsonResponse } from "../../../../tests/support/ui/fake-api";
import { neighboursOf, periodLabel } from "./report-period";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

const october = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };
const november = { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" };
const december = { label: "2026-12", startDate: "2026-12-01", endDate: "2026-12-31" };

describe("the period of a dashboard (ruling P205)", () => {
  it("asks for the period holding today only when no label is given", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [october] }),
    });
    expect(await periodLabel(api, "sp-household", undefined, "2026-10-31")).toEqual({ ok: true, data: "2026-10" });
    expect([...new URL(requests[0]!.url).searchParams]).toEqual([
      ["from", "2026-10-31"],
      ["count", "1"],
    ]);
    expect(await periodLabel(api, "sp-household", "2026-11", "2026-10-31")).toEqual({ ok: true, data: "2026-11" });
    expect(requests).toHaveLength(1);
  });

  it("finds the neighbours from the day before the start and the day after the end", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": (request) =>
        jsonResponse({
          items: [new URL(request.url).searchParams.get("from") === "2026-10-31" ? october : december],
        }),
    });
    expect(await neighboursOf(api, "sp-household", november)).toEqual({ previous: october, next: december });
    expect(requests.map((r) => new URL(r.url).searchParams.get("from")).sort()).toEqual([
      "2026-10-31",
      "2026-12-01",
    ]);
  });
});
```

`src/modules/reporting/ui/lines/bar.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cop } from "../../../../../tests/support/ui/dto";
import { barWidth } from "./bar";

describe("bar widths (ruling P202: presentation, never a figure)", () => {
  it("fills a line by what it spent of its plan, capped at the full bar", () => {
    expect(barWidth(cop(1_300_000), cop(1_470_000))).toBe(88);
    expect(barWidth(cop(1_600_000), cop(1_470_000))).toBe(100);
    expect(barWidth(cop(0), cop(600_000))).toBe(0);
    expect(barWidth(cop(60_000), cop(0))).toBe(100);
    expect(barWidth(cop(0), cop(0))).toBe(0);
  });
});
```

`src/modules/reporting/ui/lines/lines.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { e7Dashboard, householdDto, NOVEMBER } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { DashboardFrame } from "../dashboard-frame";
import { LineDashboard } from "./line-dashboard";
import { loadLines } from "./lines-container";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

const tableRows = () =>
  within(screen.getByRole("table", { name: "Planeado, gastado y disponible por línea" }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => [
      normalized(within(row).getByRole("rowheader").textContent).trim(),
      ...within(row)
        .getAllByRole("cell")
        .map((cell) => normalized(cell.textContent)),
    ]);

describe("line dashboard (HU-E9-10)", () => {
  it("shows the bars and table of planned, spent and available, with Unbudgeted last (@golden)", async () => {
    const { container } = renderWithIntl(<LineDashboard dashboard={e7Dashboard()} formats={BUILT_IN_FORMATS} />);
    expect(tableRows()).toEqual([
      ["Rent", "$ 1.200.000", "$ 1.200.000", "$ 0"],
      ["Home", "$ 1.470.000", "$ 1.300.000", "$ 170.000"],
      ["Savings", "$ 600.000", "$ 0", "$ 600.000"],
      ["Free", "$ 730.000", "$ 250.000", "$ 480.000"],
      ["Sin presupuesto", "$ 0", "$ 60.000", "−$ 60.000"],
    ]);
    const summary = screen.getByRole("region", { name: "Resumen del plan" });
    expect(normalized(summary.textContent)).toContain("Disponible$ 1.190.000");
    expect(normalized(summary.textContent)).toContain("Gastado $ 2.810.000 de $ 4.000.000");
    expect(container.querySelector("[data-line='l-home'] [data-bar]")).toHaveStyle({ width: "88%" });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("highlights an overspent line with its badge and its negative available amount", () => {
    const dashboard = e7Dashboard();
    dashboard.lines[1] = { ...dashboard.lines[1]!, spent: cop(1_600_000), available: cop(-130_000), overspent: true };
    renderWithIntl(<LineDashboard dashboard={dashboard} formats={BUILT_IN_FORMATS} />);
    const home = screen.getByRole("row", { name: /^Home/ });
    expect(within(home).getByText("Excedida")).toBeInTheDocument();
    expect(normalized(home.textContent)).toContain("−$ 130.000");
    expect(within(screen.getByRole("row", { name: /^Rent/ })).queryByText("Excedida")).toBeNull();
  });

  it("shows the API's totals, never a sum of the rows (ruling P201)", () => {
    const totals = { planned: cop(1), spent: cop(2), available: cop(3) };
    renderWithIntl(<LineDashboard dashboard={e7Dashboard({ totals })} formats={BUILT_IN_FORMATS} />);
    const summary = screen.getByRole("region", { name: "Resumen del plan" });
    expect(normalized(summary.textContent)).toContain("Disponible$ 3");
    expect(normalized(summary.textContent)).toContain("Gastado $ 2 de $ 1");
  });

  it("frames the dashboard with the period, its neighbours, the plan's status, the planner link and the tabs", async () => {
    const { container } = renderWithIntl(
      <DashboardFrame
        space={householdDto()}
        view="lines"
        period={{ ...NOVEMBER }}
        previous={{ label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" }}
        next={null}
        formats={BUILT_IN_FORMATS}
        plan={{ id: "p-nov", status: "ACTIVE" }}
      >
        <p>Contenido</p>
      </DashboardFrame>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "noviembre 2026" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Período anterior" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plan?period=2026-10",
    );
    expect(screen.getByText("Activo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Editar plan" })).toHaveAttribute("href", "/spaces/sp-household/plans/p-nov");
    const tabs = screen.getByRole("navigation", { name: "Vistas del plan" });
    expect(within(tabs).getByRole("link", { name: "Líneas" })).toHaveAttribute("aria-current", "page");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("offers a VIEWER the plan to read, not to edit (ruling P207)", () => {
    renderWithIntl(
      <DashboardFrame
        space={householdDto({ role: "VIEWER" })}
        view="lines"
        period={{ ...NOVEMBER }}
        previous={null}
        next={null}
        formats={BUILT_IN_FORMATS}
        plan={{ id: "p-nov", status: "DRAFT" }}
      >
        <p>Contenido</p>
      </DashboardFrame>,
    );
    expect(screen.queryByRole("link", { name: "Editar plan" })).toBeNull();
    expect(screen.getByRole("link", { name: "Ver plan" })).toHaveAttribute("href", "/spaces/sp-household/plans/p-nov");
  });

  it("loads today's period, its report and its neighbours", async () => {
    const october = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [october] }),
      "GET /api/v1/spaces/{spaceId}/reports/lines": () =>
        jsonResponse(e7Dashboard({ period: october, plan: null, lines: [] })),
    });
    const result = await loadLines(api, { spaceId: "sp-household", today: "2026-10-31" });
    expect(result.ok && result.data.dashboard.period).toEqual(october);
    const report = requests.find((r) => r.url.includes("/reports/lines"))!;
    expect(new URL(report.url).searchParams.get("period")).toBe("2026-10");
  });
});
```

`src/modules/spaces/ui/nav-links.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { NavLinks } from "./nav-links";

const where = vi.hoisted(() => ({ pathname: "/spaces/sp-household/plans/p-nov" }));
vi.mock("next/navigation", () => ({ usePathname: () => where.pathname }));

const names = () =>
  within(screen.getByRole("navigation", { name: "Principal" }))
    .getAllByRole("link")
    .map((link) => link.getAttribute("aria-label") ?? link.textContent?.trim());

describe("the Plan tab (ruling P200, amends P141)", () => {
  it("comes after Registrar and Movimientos and is current on every plan screen", () => {
    renderWithIntl(<NavLinks spaceId="sp-household" />);
    const plan = screen.getByRole("link", { name: "Plan" });
    expect(plan).toHaveAttribute("href", "/spaces/sp-household/plan");
    expect(plan).toHaveAttribute("aria-current", "page");
    expect(names().indexOf("Plan")).toBeGreaterThan(names().indexOf("Movimientos"));
    expect(names().indexOf("Plan")).toBeGreaterThan(names().indexOf("Registrar movimiento"));
  });

  it("is not current on the home", () => {
    where.pathname = "/spaces/sp-household";
    renderWithIntl(<NavLinks spaceId="sp-household" />);
    expect(screen.getByRole("link", { name: "Plan" })).not.toHaveAttribute("aria-current");
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/ui` and `pnpm exec vitest run --project ui src/modules/reporting/ui src/modules/spaces/ui/nav-links.test.tsx`
Expected: FAIL — the modules do not exist, and the bar has no Plan link.

- [ ] **Step 3: Implement**

`src/shared/ui/api/dto.ts`, after the last export:

```ts
export type LineDashboardDto = Json<paths["/api/v1/spaces/{spaceId}/reports/lines"]["get"]["responses"][200]>;
/** The plan a report reads, whatever its status (M4 ruling P33). */
export type ReportPlanDto = NonNullable<LineDashboardDto["plan"]>;
export type PlanStatus = ReportPlanDto["status"];
```

`src/modules/reporting/ui/views.ts`:

```ts
import type { SpaceDto } from "@/shared/ui/api/dto";

/** Ruling P200: the views of the Plan tab; the first of a space's list is the tab's own page. */
export type PlanView = "lines" | "members" | "fund" | "groups" | "trend" | "mine";

const SHARED_VIEWS: readonly PlanView[] = ["lines"];
const PERSONAL_VIEWS: readonly PlanView[] = ["lines"];

export const viewsFor = (kind: SpaceDto["kind"]): readonly PlanView[] =>
  kind === "PERSONAL" ? PERSONAL_VIEWS : SHARED_VIEWS;

/** `/spaces/{id}/plan` for the space's first view, `/spaces/{id}/plan/{view}` for the others; `?period=` kept. */
export const viewHref = (space: Pick<SpaceDto, "id" | "kind">, view: PlanView, period?: string): string => {
  const base = `/spaces/${space.id}/plan`;
  const path = viewsFor(space.kind)[0] === view ? base : `${base}/${view}`;
  return period ? `${path}?period=${encodeURIComponent(period)}` : path;
};
```

`src/modules/reporting/ui/report-period.ts`:

```ts
// Server Components only: it reads through the request-scoped API client.
import { notFound } from "next/navigation";
import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import type { Api } from "@/shared/ui/api/client";
import type { PeriodDto, SpaceDto } from "@/shared/ui/api/dto";
import { loaded, type Loaded } from "@/shared/ui/api/server";

/** Ruling P205: the label asked for, else the label of the period of the space that holds `today`. */
export const periodLabel = async (
  api: Api,
  spaceId: string,
  asked: string | undefined,
  today: string,
): Promise<Loaded<string>> => {
  if (asked) return { ok: true, data: asked };
  const result = await loaded(
    api.GET("/api/v1/spaces/{spaceId}/periods", { params: { path: { spaceId }, query: { from: today, count: 1 } } }),
  );
  if (!result.ok) return result;
  const first = result.data.items[0];
  return first
    ? { ok: true, data: first.label }
    : { ok: false, problem: { code: "Unknown", status: 200, requestId: null, errors: [], field: null } };
};

/** The periods before and after `period`: from the day before its start and the day after its end (P130). */
export const neighboursOf = async (
  api: Api,
  spaceId: string,
  period: PeriodDto,
): Promise<{ previous: PeriodDto | null; next: PeriodDto | null }> => {
  const one = async (from: string) => {
    const result = await loaded(
      api.GET("/api/v1/spaces/{spaceId}/periods", { params: { path: { spaceId }, query: { from, count: 1 } } }),
    );
    return result.ok ? (result.data.items[0] ?? null) : null;
  };
  const [previous, next] = await Promise.all([
    one(addDays(period.startDate as LocalDate, -1)),
    one(addDays(period.endDate as LocalDate, 1)),
  ]);
  return { previous, next };
};

/** The page's space among the person's spaces; a space they are not in is not found. */
export const spaceOf = (spaces: readonly SpaceDto[], spaceId: string): SpaceDto =>
  spaces.find((space) => space.id === spaceId) ?? notFound();
```

`src/modules/budgeting/ui/plan-status-badge.tsx` (no `"use client"`): `Badge` with `tone` and `icon` by status — DRAFT `neutral` `pencil`, ACTIVE `accent` `check`, CLOSED `neutral` `lock` — and the text `budgeting.status.<status>`. `src/modules/budgeting/ui/index.ts`: `export { PlanStatusBadge } from "./plan-status-badge";`.

`src/modules/reporting/ui/plan-tabs.tsx` (no `"use client"`): a `nav` labelled `reports.tabs.label` holding a horizontally scrollable row of links (`min-h-11 rounded-full px-4`, the current one `bg-accent-soft text-accent` with `aria-current="page"`). There is one link per `viewsFor(space.kind)`, labelled `reports.view.<view>`, to `viewHref(space, view, period.label)`.

`src/modules/reporting/ui/dashboard-frame.tsx` (no `"use client"`):
- a `header` with the space name (`text-sm text-muted`), the `PeriodSwitcher`, and, when `plan` is set, a row with `PlanStatusBadge` and a link;
- the `PeriodSwitcher`'s title is `usePeriodText()(period, space.periodPolicy, formats)`, and its hrefs are `viewHref(space, view, previous.label)` and `viewHref(space, view, next.label)`, or `null`;
- the link is labelled `reports.frame.editPlan` when `canManage(space.role)`, else `reports.frame.viewPlan`, and goes to `/spaces/${space.id}/plans/${plan.id}` with `Icon name="pencil"`;
- then `PlanTabs`;
- then `children` in a `div` with `flex flex-col gap-4`.

For this task, define `const canManage = (role: SpaceDto["role"]) => role === "OWNER" || role === "ADMIN";` inline. Task 4 moves it to `budgeting/ui/plan-access.ts`, exports it from `budgeting/ui/index.ts`, and imports it here.

`src/modules/reporting/ui/lines/bar.ts`:

```ts
import type { MoneyDto } from "@/shared/ui/api/dto";

/** Ruling P202: how much of a bar a line fills, 0–100; presentation, never shown as a figure. */
export const barWidth = (spent: MoneyDto, planned: MoneyDto): number => {
  const used = BigInt(spent.amount);
  const plan = BigInt(planned.amount);
  if (plan <= 0n) return used > 0n ? 100 : 0;
  const width = (used * 100n) / plan;
  return Number(width > 100n ? 100n : width < 0n ? 0n : width);
};
```

`src/modules/reporting/ui/lines/line-dashboard.tsx` (no `"use client"`):
- a `section` labelled by a visually hidden `h2` `reports.lines.summary` that shows `reports.lines.totalAvailable` over `formatMoney(totals.available)`, in `text-owe` when negative;
- under it, `reports.lines.totalSpent` with `{spent}` and `{planned}` from `totals`;
- a `table` (`w-full text-sm`) with a visually hidden `caption` `reports.lines.caption` and a header row: `th scope="col"` `reports.lines.line`, `reports.lines.planned`, `reports.lines.spent`, `reports.lines.available`;
- one `tr data-line={lineId}` per line. Its `th scope="row"` holds:
  - the name;
  - `Badge tone="owe" icon="alert"` `reports.lines.overspent` when `overspent`;
  - a 6 px track (`aria-hidden`) whose inner `span data-bar` has `style={{ width: \`${barWidth(spent, planned)}%\` }}`, in `bg-owe` when overspent and `bg-accent` otherwise.

  Its three `td`s (`text-right tabular-nums`) are `formatMoney` of planned, spent and available, available in `text-owe` when negative;
- when `unbudgeted` is set, a last row:
  - its `th` reads `reports.lines.unbudgeted`, with a `bg-muted` track at `barWidth(unbudgeted.spent, 0)`;
  - planned is `formatMoney({ amount: "0", currency })`, because Unbudgeted plans nothing by definition (HU-E6-04);
  - then `unbudgeted.spent` and `unbudgeted.available`;
  - a `p` under the table, `reports.lines.unbudgetedNote`.

The currency is `dashboard.totals.planned.currency`.

`src/modules/reporting/ui/lines/lines-container.tsx`:

```tsx
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { LineDashboardDto, PeriodDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { nowIn } from "@/shared/ui/time/when";
import { DashboardFrame } from "../dashboard-frame";
import { neighboursOf, periodLabel, spaceOf } from "../report-period";
import { LineDashboard } from "./line-dashboard";

/** HU-E9-10: the period's line dashboard and its neighbouring periods (ruling P205). */
export const loadLines = async (
  api: Api,
  input: { spaceId: string; period?: string; today: string },
): Promise<Loaded<{ dashboard: LineDashboardDto; previous: PeriodDto | null; next: PeriodDto | null }>> => {
  const label = await periodLabel(api, input.spaceId, input.period, input.today);
  if (!label.ok) return label;
  const dashboard = await loaded(
    api.GET("/api/v1/spaces/{spaceId}/reports/lines", {
      params: { path: { spaceId: input.spaceId }, query: { period: label.data } },
    }),
  );
  if (!dashboard.ok) return dashboard;
  return { ok: true, data: { dashboard: dashboard.data, ...(await neighboursOf(api, input.spaceId, dashboard.data.period)) } };
};

/** Server: the Lines view of the Plan tab for `?period=`, in the person's formats. */
export async function LineDashboardContainer({ spaceId, period }: { readonly spaceId: string; readonly period?: string }) {
  const [me, spaces] = await Promise.all([getMe(), getSpaces()]);
  const space = spaceOf(spaces, spaceId);
  const result = await loadLines(await serverApi(), { spaceId, period, today: nowIn(serverNow(), me!.timezone).date });
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  const { dashboard, previous, next } = result.data;
  const formats = me!.preferences.effective;
  return (
    <DashboardFrame
      space={space}
      view="lines"
      period={dashboard.period}
      previous={previous}
      next={next}
      formats={formats}
      plan={dashboard.plan}
    >
      <LineDashboard dashboard={dashboard} formats={formats} />
    </DashboardFrame>
  );
}
```

`src/modules/reporting/ui/server.ts`: `// Server containers (P153): pages import them from here.` then `export { LineDashboardContainer } from "./lines/lines-container";`. `src/modules/reporting/ui/index.ts`: `export { viewHref, viewsFor, type PlanView } from "./views";`.

`src/app/(web)/(app)/spaces/[spaceId]/plan/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { LineDashboardContainer } from "@/modules/reporting/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("reports"))("title") };
}

/** HU-E9-10: the Plan tab of a space, `?period=<label>` (ruling P200). */
export default async function PlanPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{ period?: string }>;
}) {
  const [{ spaceId }, { period }] = await Promise.all([params, searchParams]);
  return <LineDashboardContainer spaceId={spaceId} period={period} />;
}
```

`src/modules/spaces/ui/nav-links.tsx`:
- the doc comment's last sentence becomes "Plan arrives with HU-E9-08 and HU-E9-10 (ruling P200, amending P141).";
- after the line `const transactions = \`${home}/transactions\`;` add `const plan = \`${home}/plan\`;`;
- add a link `<Link href={plan} aria-current={pathname.startsWith(plan) ? "page" : undefined} className={item}><Icon name="chart" />{t("plan")}</Link>`. Place it immediately before the Saldos link that M6b added (HU-E9-07); if there is no Saldos link, place it after the Movimientos link. Either way the order matches the Lines artboard: Inicio, Movimientos, Registrar, Plan, Saldos.

Catalog keys, es / en:
- `shell.nav.plan` Plan / Plan;
- `budgeting.status.DRAFT` Borrador / Draft; `budgeting.status.ACTIVE` Activo / Active; `budgeting.status.CLOSED` Cerrado / Closed;
- `reports`:
  - `title` Plan / Plan;
  - `tabs.label` Vistas del plan / Plan views;
  - `view.lines` Líneas / Lines; `view.members` Miembros / Members; `view.fund` Fondo / Fund; `view.groups` Por grupo / By group; `view.trend` Tendencia / Trend; `view.mine` Mi consumo / My spending;
  - `frame.editPlan` Editar plan / Edit plan; `frame.viewPlan` Ver plan / View plan;
  - `lines.summary` Resumen del plan / Plan summary; `lines.totalAvailable` Disponible / Available; `lines.totalSpent` Gastado {spent} de {planned} / Spent {spent} of {planned};
  - `lines.caption` Planeado, gastado y disponible por línea / Planned, spent and available per line;
  - `lines.line` Línea / Line; `lines.planned` Planeado / Planned; `lines.spent` Gastado / Spent; `lines.available` Disponible / Available;
  - `lines.overspent` Excedida / Overspent; `lines.unbudgeted` Sin presupuesto / Unbudgeted;
  - `lines.unbudgetedNote` Sin presupuesto es lo gastado en categorías que no están en ninguna línea. / Unbudgeted is what was spent in categories that are in no line.

(The `view.*` keys for later views are added now so the tabs' copy is reviewed once.)

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate including `pnpm build`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/reporting/ui src/modules/budgeting/ui src/modules/spaces/ui/nav-links.tsx \
  src/modules/spaces/ui/nav-links.test.tsx "src/app/(web)/(app)/spaces/[spaceId]/plan" src/shared/ui/api/dto.ts \
  tests/support/ui/plan-dto.ts src/i18n/messages
git commit -m "feat(reporting): add the Plan tab and the line dashboard with planned, spent and available (Refs #78)"
```

If the staged candidate is over ~500 lines, commit it in two passes at the named split point. The first pass (`views.ts`, `report-period.ts`, `plan-tabs.tsx`, `dashboard-frame.tsx`, the badge, `nav-links` and their tests, `dto.ts`, `plan-dto.ts` and the `reports.tabs`, `reports.view`, `reports.frame`, `budgeting.status` and `shell.nav.plan` keys) is committed as `feat(reporting): add the Plan tab and the dashboard frame (Refs #78)`. A first pass needs the `/plan` page to exist for the tab, so it ships the page with a `LineDashboardContainer` that renders the frame around an empty `div`. The second pass adds `lines/` and the `reports.lines` keys as `feat(reporting): add the line dashboard with planned, spent and available (Refs #78)`.

---

### Task 3b: The line dashboard says when a line nears or passes its plan

The comment on #142, confirmed by a hands-on test of the competitor on 2026-10-21, asks for two things on the line dashboard. One is a neutral early warning at 80 % that is not yet red, "which gives the household time to adjust". The other is an overage stated in words with its amount ("Te pasaste por $ 130.000"), never only as a red percentage; the competitor showed "5125% spent" with no warning state. The API answers each line's `state` and `overBy` (Task 1b), so the dashboard renders them as answered (rulings P201 and P244):
- NEAR shows a neutral badge;
- HIGH shows an owe-toned badge;
- OVER keeps the "Excedida" badge of Task 3 and adds the sentence with `overBy`.

The dashboards write no share of a line, so no percentage above 100 % can appear. Unbudgeted keeps ruling P226: no badge and no sentence.

**Depends on:** Task 1b (`state`, `overBy`) and Task 3 (`LineDashboard`).

**Files:**
- Modify: `src/modules/reporting/ui/lines/{line-dashboard.tsx, lines.test.tsx}`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `LineDashboardDto`'s `state` and `overBy`, `formatMoney`, `Badge`, `e7Dashboard`.
- Produces: the catalog keys `reports.lines.state.NEAR`, `reports.lines.state.HIGH` and `reports.lines.overBy`.

- [ ] **Step 1: Write the failing test**

`src/modules/reporting/ui/lines/lines.test.tsx`, appended inside `describe("line dashboard (HU-E9-10)", …)`:

```tsx
  it("says when a line nears or passes its plan, the overage in words (#142, ruling P244 of M6c)", async () => {
    const dashboard = e7Dashboard();
    dashboard.lines[0] = { ...dashboard.lines[0]!, state: "HIGH" };
    dashboard.lines[1] = { ...dashboard.lines[1]!, spent: cop(1_600_000), available: cop(-130_000), overspent: true, state: "OVER", overBy: cop(130_000) };
    dashboard.lines[3] = { ...dashboard.lines[3]!, state: "NEAR" };
    const { container } = renderWithIntl(<LineDashboard dashboard={dashboard} formats={BUILT_IN_FORMATS} />);
    const row = (name: RegExp) => screen.getByRole("row", { name });
    expect(within(row(/^Free/)).getByText("Cerca del límite")).toHaveAttribute("data-tone", "neutral");
    expect(within(row(/^Rent/)).getByText("Al límite")).toHaveAttribute("data-tone", "owe");
    const home = normalized(row(/^Home/).textContent);
    expect(home).toContain("Excedida");
    expect(home).toContain("Te pasaste por $ 130.000");
    expect(home).not.toMatch(/%/);
    expect(within(row(/^Savings/)).queryByText(/límite|Te pasaste/)).toBeNull();
    expect(within(row(/^Sin presupuesto/)).queryByText(/límite|Te pasaste/)).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("writes the overage the API answers, never one of its own (ruling P201)", () => {
    const dashboard = e7Dashboard();
    dashboard.lines[1] = { ...dashboard.lines[1]!, available: cop(-130_000), overspent: true, state: "OVER", overBy: cop(5) };
    renderWithIntl(<LineDashboard dashboard={dashboard} formats={BUILT_IN_FORMATS} />);
    expect(normalized(screen.getByRole("row", { name: /^Home/ }).textContent)).toContain("Te pasaste por $ 5");
  });
```

(If `Badge` exposes its tone otherwise than as `data-tone`, give it that attribute: one line in `badge.tsx`, tested here.)

Run: `pnpm exec vitest run --project ui src/modules/reporting/ui/lines`
Expected: FAIL — no state badge and no sentence.

- [ ] **Step 2: Implement**

`src/modules/reporting/ui/lines/line-dashboard.tsx`, in each line's row header, after the name:
- `state` NEAR: `Badge tone="neutral"` `reports.lines.state.NEAR`;
- `state` HIGH: `Badge tone="owe"` `reports.lines.state.HIGH`;
- `state` OVER: Task 3's `Badge tone="owe" icon="alert"` `reports.lines.overspent`, and under the name a `span` (`text-sm text-owe`) `reports.lines.overBy` with `{amount}` (`formatMoney(overBy)`).

The Unbudgeted row renders neither. `src/shared/ui/atoms/badge.tsx`: the root gains `data-tone={tone}` if it has no equivalent.

Catalog keys (`reports.lines`), es / en:
- `state.NEAR` Cerca del límite / Near the limit;
- `state.HIGH` Al límite / At the limit;
- `overBy` Te pasaste por {amount} / {amount} over plan.

- [ ] **Step 3: Run the test and the gates**

Run: Step 1's command, then every gate including `pnpm build`.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/reporting/ui/lines src/shared/ui/atoms/badge.tsx src/i18n/messages
git commit -m "feat(reporting): say when a line nears or passes its plan, with the overage in words (Refs #142)"
```

---

### Task 3c: Warn before saving an expense that takes a plan line past 90% or over

Issue #142, with its comment: when an expense would leave its line above 90 % of the line's budget, or over it, the record form shows the line's state and asks the person to confirm before saving, and the person can still save. At 80 % a neutral note says so without asking, "which gives the household time to adjust". An overage is stated as an amount ("Te pasarías por $ 42.300 en Home"), not only as a percentage.

The check runs in the browser, from the line dashboard of the period holding today, which the record form's container reads on the server with the form's other data (rulings P233 and P236). Saving sends the one request it sends today, so the common case is not slowed. The warning is a labelled preview, the second after the allocation editor's (ruling P235): the dashboard's figures stay the API's. Its levels come from the API's own rule, the shared kernel's `lineStateOf` (Task 1b, ruling P244), applied to what would be left after the expense. The form and the dashboard therefore cannot disagree, and no percentage above 100 % is ever written. The warning is part of the form. It adds no toast and no live region: the save's feedback stays M6b's (ruling P237).

**Depends on:**
- Task 1b (`categoryLines`, `lineStateOf`);
- Task 3b (the dashboard's state badges, whose copy the warning matches);
- Task 2 (`formatPercent`);
- Task 3 (`LineDashboardDto`, `e7Dashboard`);
- the M6b addendum's Tasks A4 and A7, which both edit `record-form.tsx` (the toast and the `edit` prop). This task starts after them, so its edit merges onto theirs. If the addendum has not landed when this task is reached, the task waits and Task 4 goes on: nothing else depends on it.

**Files:**
- Create: `src/modules/ledger/ui/record/line-watch.ts`, `src/modules/ledger/ui/record/line-watch.test.ts`, `src/modules/ledger/ui/record/line-warning.tsx`, `src/modules/ledger/ui/record/record-form-line-warning.test.tsx`
- Modify: `src/modules/ledger/ui/record/record-form.tsx`, `src/modules/ledger/ui/record/record-form-container.tsx`, `src/modules/ledger/ui/record/record-form-container.test.tsx`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `LineDashboardDto`, `MoneyDto` (`dto.ts`); `formatMoney`, `formatPercent` (Task 2); `loaded`, `Api`; `nowIn`, `serverNow`; `e7Dashboard`, `NOVEMBER` (Task 3's builders).
- Produces:
  - `line-watch.ts`: `interface LineWatch { startDate: string; endDate: string; currency: string; lineOf: Readonly<Record<string, DashLine>> }`, `lineWatchOf(dashboard: LineDashboardDto): LineWatch | null`, `type LineLevel = Exclude<LineState, "OK">`, `interface LineWarning { level: LineLevel; line: string; used: string | null; rest: MoneyDto }`, `lineWarningOf(watch: LineWatch | null, input: { categoryId: string | null; parentId: string | null; amountMinor: string | null; date: string; currency: string }): LineWarning | null` and `asksFirst(warning: LineWarning | null): boolean`;
  - `line-warning.tsx`: `LineWarningNote({ warning, formats })` and `LineWarningConfirm({ warning, formats, onConfirm, onReview })`;
  - `record-form-container.tsx`: `loadLineWatch(api, input: { spaceId: string; today: string }): Promise<LineWatch | null>`;
  - `RecordFormProps.lineWatch?: LineWatch | null`.

- [ ] **Step 1: Write the failing pure tests**

`src/modules/ledger/ui/record/line-watch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cop } from "../../../../../tests/support/ui/dto";
import { e7Dashboard } from "../../../../../tests/support/ui/plan-dto";
import { asksFirst, lineWarningOf, lineWatchOf } from "./line-watch";

const OCTOBER = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };
const minor = (pesos: number) => String(pesos * 100);

/** One line, 1,000,000 COP planned and 700,000 spent, fed by Groceries; Free is fed by Restaurants. */
const watchOf = (home: { planned?: number; spent?: number; carryOver?: number; available?: number } = {}) => {
  const dashboard = e7Dashboard({ period: OCTOBER });
  dashboard.lines[1] = {
    ...dashboard.lines[1]!,
    planned: cop(home.planned ?? 1_000_000),
    spent: cop(home.spent ?? 700_000),
    carryOver: cop(home.carryOver ?? 0),
    available: cop(home.available ?? 300_000),
  };
  return lineWatchOf({
    ...dashboard,
    categoryLines: [
      { categoryId: "c-groceries", lineId: "l-home" },
      { categoryId: "c-savings", lineId: "l-savings" },
      { categoryId: "c-restaurants", lineId: null },
    ],
  });
};
const warn = (pesos: number, overrides: Partial<Parameters<typeof lineWarningOf>[1]> = {}, watch = watchOf()) =>
  lineWarningOf(watch, {
    categoryId: "c-groceries",
    parentId: null,
    amountMinor: minor(pesos),
    date: "2026-10-31",
    currency: "COP",
    ...overrides,
  });

describe("the line warning (#142, rulings P235 and P236 of M6c)", () => {
  it("says nothing below 80 %, notes from 80 % through 90 %, and asks above 90 % or over the line", () => {
    expect(warn(99_999)).toBeNull();
    expect(warn(100_000)).toEqual({ level: "NEAR", line: "Home", used: "80.00", rest: cop(200_000) });
    expect(warn(200_000)).toEqual({ level: "NEAR", line: "Home", used: "90.00", rest: cop(100_000) });
    expect(warn(200_100)).toEqual({ level: "HIGH", line: "Home", used: "90.01", rest: cop(99_900) });
    expect(warn(300_000)).toEqual({ level: "HIGH", line: "Home", used: "100.00", rest: cop(0) });
    expect(warn(342_300)).toEqual({ level: "OVER", line: "Home", used: null, rest: cop(42_300) });
    expect([warn(100_000), warn(200_100), warn(342_300)].map(asksFirst)).toEqual([false, true, true]);
  });

  it("measures the line against planned plus what it carried in (HU-E6-09)", () => {
    const carrying = watchOf({ planned: 1_000_000, carryOver: 500_000, spent: 700_000, available: 800_000 });
    // 700,000 + 300,000 of 1,500,000 is 66.66 %: no note, where Planned alone would have asked.
    expect(warn(300_000, {}, carrying)).toBeNull();
    expect(warn(500_000, {}, carrying)).toEqual({ level: "NEAR", line: "Home", used: "80.00", rest: cop(300_000) });
  });

  it("checks a subcategory by its parent's line and says nothing for Unbudgeted, a savings line or no category", () => {
    expect(warn(100_000, { categoryId: "c-veg", parentId: "c-groceries" })?.level).toBe("NEAR");
    expect(warn(342_300, { categoryId: "c-restaurants" })).toBeNull();
    expect(warn(342_300, { categoryId: "c-savings" })).toBeNull();
    expect(warn(342_300, { categoryId: null })).toBeNull();
  });

  it("says nothing outside the loaded period, in another currency, for no amount, or without an ACTIVE plan", () => {
    expect(warn(342_300, { date: "2026-11-01" })).toBeNull();
    expect(warn(342_300, { currency: "USD" })).toBeNull();
    expect(warn(342_300, { amountMinor: null })).toBeNull();
    expect(lineWatchOf(e7Dashboard({ plan: { id: "p-nov", status: "DRAFT" } }))).toBeNull();
    expect(lineWatchOf(e7Dashboard({ plan: { id: "p-nov", status: "CLOSED" } }))).toBeNull();
    expect(lineWatchOf(e7Dashboard({ plan: null, lines: [] }))).toBeNull();
    expect(lineWarningOf(null, { categoryId: "c-groceries", parentId: null, amountMinor: "1", date: "2026-10-31", currency: "COP" })).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing form and container tests**

`src/modules/ledger/ui/record/record-form-line-warning.test.tsx` reuses `record-form.test.tsx`'s setup: the same `router` mock, fake timers at `2026-11-01T04:30:00Z` (31 October, 23:30 in Bogotá), `groceries`, `groups`, `accounts` and `recorded()`, copied into this file, plus `normalized`, `axeViolations` and `import es from "@/i18n/messages/es.json"`. Its `form(api, watch)` renders the same `RecordForm` with `lineWatch={watch}`. The watch is `lineWatchOf({ ...e7Dashboard({ period: OCTOBER }), categoryLines: [{ categoryId: "c-groceries", lineId: "l-home" }] })`: Home has 1,470,000 COP planned, 1,300,000 spent and 170,000 available.

```tsx
const SAVE = es.ledger.form.save.EXPENSE;
const CONFIRM_TITLE = "¿Guardar de todos modos?";
const noteText = () => normalized(document.getElementById("record-line-warning")?.textContent);
const typeExpense = async (amount: string) => {
  await userEvent.type(screen.getByLabelText("Monto"), amount);
  await userEvent.click(screen.getByRole("button", { name: /Categoría/ }));
  await userEvent.click(screen.getByRole("radio", { name: "Groceries" }));
};
const expenses = (requests: Request[]) => requests.filter((r) => r.url.endsWith("/expenses"));

describe("the record form warns before a line goes past 90 % (#142, rulings P235–P237 of M6c)", () => {
  it("notes 80 % in the neutral tone and saves at once", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": recorded });
    form(api, watch);
    await typeExpense("20000");
    expect(noteText()).toBe("Con este gasto, Home quedaría en 89,79 % de lo planeado.");
    expect(document.getElementById("record-line-warning")).toHaveAttribute("data-level", "NEAR");
    expect(screen.getByRole("button", { name: SAVE })).toHaveAttribute("aria-describedby", "record-line-warning");
    await userEvent.click(screen.getByRole("button", { name: SAVE }));
    await waitFor(() => expect(expenses(requests)).toHaveLength(1));
    expect(screen.queryByRole("heading", { name: CONFIRM_TITLE })).toBeNull();
  });

  it("asks first above 90 %, and saves once on Guardar de todos modos", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": recorded });
    const { container } = form(api, watch);
    await typeExpense("85000");
    await userEvent.click(screen.getByRole("button", { name: SAVE }));
    expect(screen.getByRole("heading", { name: CONFIRM_TITLE })).toHaveFocus();
    expect(normalized(screen.getByRole("region", { name: CONFIRM_TITLE }).textContent)).toContain(
      "Con este gasto, Home quedaría en 94,21 % de lo planeado y le quedarían $ 85.000.",
    );
    expect(screen.queryByRole("button", { name: SAVE })).toBeNull();
    expect(expenses(requests)).toHaveLength(0);
    expect(await axeViolations(container)).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Guardar de todos modos" }));
    await waitFor(() => expect(expenses(requests)).toHaveLength(1));
  });

  it("states the overage as an amount, and Revisar el monto goes back to the amount without saving", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": recorded });
    form(api, watch);
    await typeExpense("212300");
    await userEvent.click(screen.getByRole("button", { name: SAVE }));
    const panel = normalized(screen.getByRole("region", { name: CONFIRM_TITLE }).textContent);
    expect(panel).toContain("Con este gasto te pasarías por $ 42.300 en Home.");
    // Ruling P244: an overage is an amount in words, never a percentage above 100 %.
    expect(panel).not.toMatch(/%/);
    await userEvent.click(screen.getByRole("button", { name: "Revisar el monto" }));
    expect(screen.getByLabelText("Monto")).toHaveFocus();
    expect(screen.queryByRole("heading", { name: CONFIRM_TITLE })).toBeNull();
    expect(expenses(requests)).toHaveLength(0);
  });

  it("asks again once the amount changes after a confirmation was asked", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": recorded });
    form(api, watch);
    await typeExpense("212300");
    await userEvent.click(screen.getByRole("button", { name: SAVE }));
    await userEvent.type(screen.getByLabelText("Monto"), "0");
    expect(screen.queryByRole("heading", { name: CONFIRM_TITLE })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: SAVE }));
    expect(screen.getByRole("heading", { name: CONFIRM_TITLE })).toBeInTheDocument();
    expect(expenses(requests)).toHaveLength(0);
  });

  it("warns of nothing without a watch", async () => {
    const { api } = fakeApi({});
    form(api, null);
    await typeExpense("212300");
    expect(document.getElementById("record-line-warning")).toBeNull();
  });
});
```

`src/modules/ledger/ui/record/record-form-container.test.tsx`, appended:

```tsx
describe("loadLineWatch (#142, ruling P236 of M6c)", () => {
  const october = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };

  it("reads the period holding today, then its line dashboard", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [october] }),
      "GET /api/v1/spaces/{spaceId}/reports/lines": () => jsonResponse(e7Dashboard({ period: october })),
    });
    const watch = await loadLineWatch(api, { spaceId: "sp-household", today: "2026-10-31" });
    expect(watch?.lineOf["c-groceries"]?.name).toBe("Home");
    expect(new URL(requests[0]!.url).searchParams.get("from")).toBe("2026-10-31");
    expect(new URL(requests[1]!.url).searchParams.get("period")).toBe("2026-10");
  });

  it("is null when a read fails, so the form never fails for its warning", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [october] }),
      "GET /api/v1/spaces/{spaceId}/reports/lines": () => problemResponse(403, "InsufficientRole"),
    });
    expect(await loadLineWatch(api, { spaceId: "sp-household", today: "2026-10-31" })).toBeNull();
  });
});
```

(`e7Dashboard`'s `categoryLines` maps `c-groceries` to `l-home`, Task 3's builder. If the file's imports lack `problemResponse` or `e7Dashboard`, add them.)

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/ledger/ui/record/line-watch.test.ts` and `pnpm exec vitest run --project ui src/modules/ledger/ui/record`
Expected: FAIL — `./line-watch` does not exist, and the form shows no warning.

- [ ] **Step 4: Implement**

`src/modules/ledger/ui/record/line-watch.ts`:

```ts
import { lineStateOf, type LineState } from "@/shared/kernel/line-state";
import type { LineDashboardDto, MoneyDto } from "@/shared/ui/api/dto";

type DashLine = LineDashboardDto["lines"][number];

/** Ruling P236 (M6c): the lines the record form checks an expense against, by category, for one period. */
export interface LineWatch {
  readonly startDate: string;
  readonly endDate: string;
  readonly currency: string;
  readonly lineOf: Readonly<Record<string, DashLine>>;
}

/** Ruling P236: only an ACTIVE plan is checked; SAVINGS lines consume transfers, never expenses (spec 5.4). */
export const lineWatchOf = (dashboard: LineDashboardDto): LineWatch | null => {
  if (dashboard.plan?.status !== "ACTIVE") return null;
  const byId = new Map(dashboard.lines.map((line) => [line.lineId, line]));
  const lineOf: Record<string, DashLine> = {};
  for (const { categoryId, lineId } of dashboard.categoryLines) {
    const line = lineId === null ? undefined : byId.get(lineId);
    if (line !== undefined && line.funding !== "SAVINGS") lineOf[categoryId] = line;
  }
  return {
    startDate: dashboard.period.startDate,
    endDate: dashboard.period.endDate,
    currency: dashboard.totals.planned.currency,
    lineOf,
  };
};

export type LineLevel = Exclude<LineState, "OK">;

export interface LineWarning {
  readonly level: LineLevel;
  readonly line: string;
  /** The share of the line's budget used after the expense, as the API writes shares ("94.21"); null when OVER. */
  readonly used: string | null;
  /** What would be left (NEAR, HIGH) or how much over (OVER), never negative. */
  readonly rest: MoneyDto;
}

const shareText = (used: bigint, budget: bigint): string => {
  const basisPoints = (used * 10_000n) / budget;
  return `${basisPoints / 100n}.${String(basisPoints % 100n).padStart(2, "0")}`;
};

/**
 * #142, ruling P235 (M6c): a labelled preview of the state `amountMinor` would leave its line in; the server's
 * dashboard has the last word. The line's budget is planned + carry-over (HU-E6-09), and after the expense
 * available − amount is left. The levels are the API's own `lineStateOf` (ruling P244), so the form and the
 * dashboard cannot disagree. Integer arithmetic in minor units; the share is rounded down to two decimals.
 */
export const lineWarningOf = (
  watch: LineWatch | null,
  input: {
    readonly categoryId: string | null;
    /** The parent of a chosen subcategory, whose line a subcategory consumes (HU-E3-04). */
    readonly parentId: string | null;
    readonly amountMinor: string | null;
    readonly date: string;
    readonly currency: string;
  },
): LineWarning | null => {
  if (watch === null || input.categoryId === null || input.amountMinor === null) return null;
  if (input.currency !== watch.currency || input.date < watch.startDate || input.date > watch.endDate) return null;
  const line = watch.lineOf[input.categoryId] ?? (input.parentId === null ? undefined : watch.lineOf[input.parentId]);
  const amount = BigInt(input.amountMinor);
  if (line === undefined || amount <= 0n) return null;
  const budget = BigInt(line.planned.amount) + BigInt(line.carryOver.amount);
  const after = BigInt(line.available.amount) - amount;
  const money = (minor: bigint): MoneyDto => ({ amount: minor.toString(), currency: watch.currency });
  const state = lineStateOf(budget, after);
  if (state === "OK") return null;
  if (state === "OVER") return { level: "OVER", line: line.name, used: null, rest: money(-after) };
  return { level: state, line: line.name, used: shareText(budget - after, budget), rest: money(after) };
};

/** Ruling P235: HIGH and OVER ask before saving; NEAR is a note. */
export const asksFirst = (warning: LineWarning | null): boolean =>
  warning !== null && warning.level !== "NEAR";
```

`src/modules/ledger/ui/record/line-warning.tsx` (no `"use client"`; both are rendered by the client form):
- `LineWarningNote({ warning, formats })`: a `div` `id="record-line-warning"` `data-level={warning.level}` with `Icon name="alert"` and the text. NEAR uses the neutral tone (`bg-track text-muted`); HIGH and OVER use the owe tone (`bg-owe-soft text-owe`). The text is:
  - NEAR: `ledger.lineWarning.near` with `{line}` and `{used}` (`formatPercent(used, formats)`);
  - HIGH: `ledger.lineWarning.high` with `{line}`, `{used}` and `{rest}` (`formatMoney(rest, formats)`);
  - OVER: `ledger.lineWarning.over` with `{line}` and `{rest}`.
- `LineWarningConfirm({ warning, formats, onConfirm, onReview })`: a `section` labelled by its `h2` `ledger.lineWarning.confirmTitle`. The `h2` has `tabIndex={-1}` and takes focus when the section mounts. Under it are `LineWarningNote`'s text and two buttons in a row that wraps: `Button size="lg"` `ledger.lineWarning.confirm` (`onConfirm`) and `Button variant="secondary" size="lg"` `ledger.lineWarning.review` (`onReview`).

`src/modules/ledger/ui/record/record-form.tsx`:
- `RecordFormProps` gains `/** #142 (P236): the lines of today's period, by category; no warning without it. */ readonly lineWatch?: LineWatch | null;`.
- After `positiveMinor`, compute the warning. It applies only to an expense recorded in the form's own space: not a split with someone and not an edit (`edit` is A7's prop).

  ```ts
  const warning =
    kind === "EXPENSE" && !splitting && edit === undefined
      ? lineWarningOf(lineWatch ?? null, {
          categoryId: category?.subcategoryId ?? category?.categoryId ?? null,
          parentId: category?.subcategoryId ? category.categoryId : null,
          amountMinor: positiveMinor,
          date: when.date,
          currency: space.currency,
        })
      : null;
  // P235: the expense the person was asked about; a change of amount, category or date asks again.
  const asked = warning ? `${category?.subcategoryId ?? category?.categoryId}|${positiveMinor}|${when.date}` : null;
  const [askingFor, setAskingFor] = useState<string | null>(null);
  const confirmedFor = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const asking = asked !== null && askingFor === asked;
  ```

- In `submit`, after the `splitting && categoryKey === null` guard and before `setPending(true)`:

  ```ts
    if (asksFirst(warning) && confirmedFor.current !== asked) {
      setAskingFor(asked);
      return;
    }
  ```

- Before the `problem && where === "form"` notice, render `LineWarningConfirm` while `asking`. Its `onConfirm` is `() => { confirmedFor.current = asked; setAskingFor(null); formRef.current?.requestSubmit(); }`. Its `onReview` is `() => { setAskingFor(null); document.getElementById("record-amount")?.focus(); }`. Otherwise, when `warning` is set, render `LineWarningNote`.
- The form gets `ref={formRef}`. The Save button is not rendered while `asking`: the panel's two buttons replace it, so the last control stays above the bar (Task 17c measures it). When a note shows, the button gets `aria-describedby="record-line-warning"`.
- Nothing else changes: the save's toast (A4) and the saved-with-warning notice (P170) speak after the save as before.

`src/modules/ledger/ui/record/record-form-container.tsx`:

```ts
/**
 * #142 (P236): the line dashboard of the space's period holding `today`, as a watch for the record form. A failed
 * read, a period without a plan or a plan that is not ACTIVE gives no watch, and the form simply warns of nothing.
 */
export const loadLineWatch = async (api: Api, input: { spaceId: string; today: string }): Promise<LineWatch | null> => {
  const path = { spaceId: input.spaceId };
  const periods = await loaded(
    api.GET("/api/v1/spaces/{spaceId}/periods", { params: { path, query: { from: input.today, count: 1 } } }),
  );
  const label = periods.ok ? periods.data.items[0]?.label : undefined;
  if (label === undefined) return null;
  const dashboard = await loaded(
    api.GET("/api/v1/spaces/{spaceId}/reports/lines", { params: { path, query: { period: label } } }),
  );
  return dashboard.ok ? lineWatchOf(dashboard.data) : null;
};
```

In `RecordFormContainer`, right after the first `Promise.all`, start `const watch = loadLineWatch(api, { spaceId, today: nowIn(serverNow(), me!.timezone).date });`. It runs while the shared context and the people load. Pass `lineWatch={await watch}` to `RecordForm`.

Catalog keys (`ledger.lineWarning`), es / en:
- `near` Con este gasto, {line} quedaría en {used} de lo planeado. / With this expense, {line} would be at {used} of its plan.;
- `high` Con este gasto, {line} quedaría en {used} de lo planeado y le quedarían {rest}. / With this expense, {line} would be at {used} of its plan, with {rest} left.;
- `over` Con este gasto te pasarías por {rest} en {line}. / With this expense you would go {rest} over on {line}.;
- `confirmTitle` ¿Guardar de todos modos? / Save anyway?;
- `confirm` Guardar de todos modos / Save anyway;
- `review` Revisar el monto / Review the amount.

- [ ] **Step 5: Run the tests, the gates and the record route's budget**

Run: Step 3's commands, then every gate including `pnpm build`, then `pnpm perf`.
Expected: PASS, with `/spaces/:id/new` within 205 KiB and `/spaces/:shared/new` within 215 KiB. The budgets are never raised (P134, P198). If a route misses, move `LineWarningConfirm` behind `next/dynamic`, loaded only once a warning exists, as the form already loads `SplitWithPersonSheet`, and measure again.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ledger/ui/record src/i18n/messages
git commit -m "feat(ledger): warn before saving an expense that takes a plan line past 90% or over (Refs #142)"
```

---

### Task 4: The planner screen and the plan cycle

The Planner artboard, and HU-E9-08 at component level: "Build the reference plan" (the figures) and "Activate and close from the planner". The screen shows:
- the plan's period and dates;
- its status badge;
- the capacity summary (the total, what is unallocated, and each member's amount and share);
- the lines, each with its meta, its planned amount, its share of capacity, the catch-all badge and an invalid-allocation badge;
- the lifecycle buttons.

The planner is a client component that keeps the plan each write answers (ruling P206). Its controls follow the viewer's role (ruling P207). The dashboard frame's planner link (Task 3) leads here.

**Files:**
- Create: `src/modules/budgeting/ui/{plan-access.ts, plan-access.test.ts, plan-write.ts, plan-write.test.ts, server.ts}`, `src/modules/budgeting/ui/planner/{planner.tsx, planner-container.tsx, planner.test.tsx}`, `src/app/(web)/(app)/spaces/[spaceId]/plans/[planId]/page.tsx`
- Modify: `src/modules/budgeting/ui/index.ts`, `src/modules/reporting/ui/dashboard-frame.tsx`, `src/shared/ui/api/dto.ts`, `tests/support/ui/plan-dto.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `PlanStatusBadge`, `usePeriodText`, `formatMoney`, `formatPercent`, `formatDate` (Tasks 2, 3); `browserApi`, `problemFrom`, `useProblemMessage`, `Button`, `Badge`, `Icon`; `addDays` from `@/shared/kernel/local-date`; `loaded`, `serverApi`, `getMe`, `getSpaces`; `spaceOf` (Task 3, `reporting/ui` → re-implemented here as `notFound()` on a missing space, because budgeting's UI must not import reporting's `report-period.ts` (a non-index file)).
- Produces:
  - `dto.ts`: `BudgetPlanDto = components["schemas"]["BudgetPlan"]`, `PlanLineDto`, and `SpaceMemberDto = components["schemas"]["SpaceMember"]`. If M6b already exports `SpaceMemberDto` from this file, keep M6b's line.
  - `plan-access.ts`:
    - `canManage(role): boolean` (OWNER, ADMIN);
    - `capacityEditable(role, member, viewerUserId): boolean` (managers always; a MEMBER only on their own row);
    - `isEditable(plan): boolean` (not CLOSED);
    - `closesFrom(plan): string` (the day after `period.endDate`);
    - `canCloseOn(plan, today): boolean` (ACTIVE and `today >= closesFrom(plan)`);
    - `memberOf(members, userId): SpaceMemberDto | null`.
  - `plan-write.ts`:
    - `type PlanWrite = { ok: true; plan: BudgetPlanDto } | { ok: false; problem: Problem; lineIds: readonly string[] }`;
    - `ifMatch(plan): { "if-match": string }`;
    - `planWrite(call): Promise<PlanWrite>` (never throws; `lineIds` read from the raw body);
    - `rereadPlan(api, spaceId, planId): Promise<BudgetPlanDto | null>`.
  - `Planner({ space, plan, members, formats, today, api? })` (client) and `PlannerContainer({ spaceId, planId })` (server).
  - `loadPlanner(api, { spaceId, planId }): Promise<Loaded<{ plan: BudgetPlanDto; members: SpaceMemberDto[] }>>`.
  - `canManage` is exported from `budgeting/ui/index.ts`.
  - Builders: `spaceMemberDto(overrides?)`, `HOUSEHOLD_MEMBERS` (Ana OWNER `m-ana`/`u-ana`, Juan MEMBER `m-juan`/`u-juan`), `planLineDto(overrides?)`, `referencePlanDto(overrides?)` (HU-E9-08's reference plan for 2026-11, DRAFT, version 7).

- [ ] **Step 1: Write the builders and the failing tests**

`tests/support/ui/plan-dto.ts`: add `BudgetPlanDto`, `PlanLineDto` and `SpaceMemberDto` to the type import, and append:

```ts
/** Ana, OWNER of Household. */
export const spaceMemberDto = (overrides: Partial<SpaceMemberDto> = {}): SpaceMemberDto => ({
  id: "m-ana",
  kind: "USER",
  userId: "u-ana",
  displayName: "Ana",
  role: "OWNER",
  contactEmail: null,
  joinedAt: "2026-10-01T12:00:00.000Z",
  ...overrides,
});

/** HU-E9-08 Background: Ana is OWNER and Juan is MEMBER of Household, in join order. */
export const HOUSEHOLD_MEMBERS: SpaceMemberDto[] = [
  spaceMemberDto(),
  spaceMemberDto({
    id: "m-juan",
    userId: "u-juan",
    displayName: "Juan",
    role: "MEMBER",
    joinedAt: "2026-10-02T12:00:00.000Z",
  }),
];

const proportional = (ana: number, juan: number): PlanLineDto["allocation"] => ({
  rule: "PROPORTIONAL",
  members: [
    { memberId: "m-ana", percent: null, amount: null, assigned: cop(ana) },
    { memberId: "m-juan", percent: null, amount: null, assigned: cop(juan) },
  ],
  error: null,
});

/** "Home": 1,470,000 COP, DIRECT, RESET, proportional to capacity (40 % / 60 %), nothing spent. */
export const planLineDto = (overrides: Partial<PlanLineDto> = {}): PlanLineDto => ({
  id: "l-home",
  originLineId: null,
  name: "Home",
  plannedAmount: cop(1_470_000),
  funding: "DIRECT",
  rolloverMode: "RESET",
  isCatchAll: false,
  savingsAccountIds: [],
  categoryIds: [],
  capacityShare: "36.75",
  allocation: proportional(588_000, 882_000),
  spent: cop(0),
  carryOver: cop(0),
  // Task 1e (ruling P243): nothing carried, so no source.
  carryOverFrom: null,
  available: cop(1_470_000),
  ...overrides,
});

/** HU-E9-08's reference plan for 2026-11 in Household: DRAFT, version 7, all 4,000,000 COP of capacity planned. */
export const referencePlanDto = (overrides: Partial<BudgetPlanDto> = {}): BudgetPlanDto => ({
  id: "p-nov",
  spaceId: "sp-household",
  period: { ...NOVEMBER },
  status: "DRAFT",
  createdFrom: null,
  version: 7,
  capacities: [
    { memberId: "m-ana", amount: cop(1_600_000), share: "40.00" },
    { memberId: "m-juan", amount: cop(2_400_000), share: "60.00" },
  ],
  totalCapacity: cop(4_000_000),
  planned: cop(4_000_000),
  unallocated: cop(0),
  lines: [
    planLineDto({
      id: "l-rent",
      name: "Rent",
      plannedAmount: cop(1_200_000),
      funding: "SHARED_FUND",
      capacityShare: "30.00",
      allocation: proportional(480_000, 720_000),
      available: cop(1_200_000),
    }),
    planLineDto(),
    planLineDto({
      id: "l-savings",
      name: "Savings",
      plannedAmount: cop(600_000),
      funding: "SAVINGS",
      savingsAccountIds: ["a-savings"],
      capacityShare: "15.00",
      allocation: proportional(240_000, 360_000),
      available: cop(600_000),
    }),
    planLineDto({
      id: "l-free",
      name: "Free",
      plannedAmount: cop(730_000),
      isCatchAll: true,
      capacityShare: "18.25",
      allocation: proportional(292_000, 438_000),
      available: cop(730_000),
    }),
  ],
  unbudgeted: null,
  ...overrides,
});

/** The reference plan with "Free" allocated PERCENT 42 % / 57 %: stored before a member's value went stale (P7). */
export const freeAt99 = (plan = referencePlanDto()): BudgetPlanDto => ({
  ...plan,
  lines: plan.lines.map((line) =>
    line.id === "l-free"
      ? {
          ...line,
          allocation: {
            rule: "PERCENT",
            members: [
              { memberId: "m-ana", percent: "42.00", amount: null, assigned: null },
              { memberId: "m-juan", percent: "57.00", amount: null, assigned: null },
            ],
            error: "InvalidAllocation",
          },
        }
      : line,
  ),
});
```

`src/modules/budgeting/ui/plan-access.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HOUSEHOLD_MEMBERS, referencePlanDto } from "../../../../tests/support/ui/plan-dto";
import { canCloseOn, canManage, capacityEditable, closesFrom, isEditable, memberOf } from "./plan-access";

const [ana, juan] = HOUSEHOLD_MEMBERS as [(typeof HOUSEHOLD_MEMBERS)[0], (typeof HOUSEHOLD_MEMBERS)[0]];

describe("who may change a plan (ruling P207)", () => {
  it("lets OWNER and ADMIN manage, and nobody else", () => {
    expect((["OWNER", "ADMIN", "MEMBER", "VIEWER", null] as const).map(canManage)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("lets a MEMBER change only their own capacity (D17)", () => {
    expect(capacityEditable("MEMBER", juan, "u-juan")).toBe(true);
    expect(capacityEditable("MEMBER", ana, "u-juan")).toBe(false);
    expect(capacityEditable("VIEWER", juan, "u-juan")).toBe(false);
    expect(capacityEditable("ADMIN", ana, "u-juan")).toBe(true);
    expect(memberOf(HOUSEHOLD_MEMBERS, "u-juan")?.id).toBe("m-juan");
    expect(memberOf(HOUSEHOLD_MEMBERS, "u-luis")).toBeNull();
  });

  it("closes an ACTIVE plan from the day after its period, and never edits a CLOSED one (HU-E6-07)", () => {
    const active = referencePlanDto({ status: "ACTIVE" });
    expect(closesFrom(active)).toBe("2026-12-01");
    expect(canCloseOn(active, "2026-11-30")).toBe(false);
    expect(canCloseOn(active, "2026-12-01")).toBe(true);
    expect(canCloseOn(referencePlanDto(), "2026-12-01")).toBe(false);
    expect(isEditable(active)).toBe(true);
    expect(isEditable(referencePlanDto({ status: "CLOSED" }))).toBe(false);
  });
});
```

`src/modules/budgeting/ui/plan-write.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { referencePlanDto } from "../../../../tests/support/ui/plan-dto";
import { ifMatch, planWrite, rereadPlan } from "./plan-write";

const path = { spaceId: "sp-household", planId: "p-nov" };
const ACTIVATE = "POST /api/v1/spaces/{spaceId}/plans/{planId}/activate";

describe("plan writes (ruling P206)", () => {
  it("sends the version it shows and keeps the plan the API answers", async () => {
    const answered = referencePlanDto({ status: "ACTIVE", version: 8 });
    const { api, requests } = fakeApi({ [ACTIVATE]: () => jsonResponse(answered) });
    const result = await planWrite(
      api.POST("/api/v1/spaces/{spaceId}/plans/{planId}/activate", {
        params: { path },
        headers: ifMatch(referencePlanDto()),
      }),
    );
    expect(requests[0]!.headers.get("if-match")).toBe('"7"');
    expect(result).toEqual({ ok: true, plan: answered });
  });

  it("keeps the lines an InvalidAllocation names, and turns a failed fetch into Unknown", async () => {
    const invalid = fakeApi({ [ACTIVATE]: () => problemResponse(422, "InvalidAllocation", { lineIds: ["l-free"] }) });
    const refused = await planWrite(
      invalid.api.POST("/api/v1/spaces/{spaceId}/plans/{planId}/activate", { params: { path } }),
    );
    expect(refused).toMatchObject({ ok: false, problem: { code: "InvalidAllocation", status: 422 }, lineIds: ["l-free"] });
    const offline = fakeApi({
      [ACTIVATE]: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(
      await planWrite(offline.api.POST("/api/v1/spaces/{spaceId}/plans/{planId}/activate", { params: { path } })),
    ).toEqual({ ok: false, problem: { code: "Unknown", status: 0, requestId: null, errors: [], field: null }, lineIds: [] });
  });

  it("re-reads the plan after a 412, and answers null when it cannot", async () => {
    const fresh = referencePlanDto({ version: 9 });
    const { api } = fakeApi({ "GET /api/v1/spaces/{spaceId}/plans/{planId}": () => jsonResponse(fresh) });
    expect(await rereadPlan(api, "sp-household", "p-nov")).toEqual(fresh);
    const gone = fakeApi({ "GET /api/v1/spaces/{spaceId}/plans/{planId}": () => problemResponse(404, "BudgetPlanNotFound") });
    expect(await rereadPlan(gone.api, "sp-household", "p-nov")).toBeNull();
  });
});
```

`src/modules/budgeting/ui/planner/planner.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { normalized } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import {
  freeAt99,
  HOUSEHOLD_MEMBERS,
  householdDto,
  referencePlanDto,
} from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { BudgetPlanDto, SpaceDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { loadPlanner } from "./planner-container";
import { Planner } from "./planner";

vi.mock("next/headers", () => ({}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, notFound: vi.fn(), redirect: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

const ACTIVATE = "POST /api/v1/spaces/{spaceId}/plans/{planId}/activate";
const show = ({
  plan = referencePlanDto(),
  space = householdDto(),
  api,
  today = "2026-10-31",
}: { plan?: BudgetPlanDto; space?: SpaceDto; api?: Api; today?: string } = {}) =>
  renderWithIntl(
    <Planner space={space} plan={plan} members={HOUSEHOLD_MEMBERS} formats={BUILT_IN_FORMATS} today={today} api={api} />,
  );

describe("planner (HU-E9-08)", () => {
  it("shows total capacity split 40,00 % / 60,00 %, nothing unallocated and Home at 36,75 % of capacity (@golden)", async () => {
    const { container } = show();
    expect(screen.getByRole("heading", { level: 1, name: "Plan de noviembre 2026" })).toBeInTheDocument();
    expect(screen.getByText("Borrador")).toBeInTheDocument();
    const capacity = normalized(screen.getByRole("region", { name: "Capacidad total" }).textContent);
    expect(capacity).toContain("$ 4.000.000");
    expect(capacity).toContain("Sin asignar $ 0");
    expect(capacity).toContain("Ana $ 1.600.000 · 40,00 %");
    expect(capacity).toContain("Juan $ 2.400.000 · 60,00 %");
    const home = normalized(screen.getByRole("listitem", { name: "Home" }).textContent);
    expect(home).toContain("$ 1.470.000");
    expect(home).toContain("36,75 % de la capacidad");
    expect(home).toContain("Directo · Según capacidad · Reinicia");
    expect(within(screen.getByRole("listitem", { name: "Free" })).getByText("Todo lo demás")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Editar Home" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plans/p-nov/lines/l-home",
    );
    expect(screen.getByRole("link", { name: "Agregar línea" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plans/p-nov/lines/new",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("names Free when activation finds its allocation invalid, then activates and later closes", async () => {
    const activations = [
      problemResponse(422, "InvalidAllocation", { lineIds: ["l-free"] }),
      jsonResponse(referencePlanDto({ status: "ACTIVE", version: 8 })),
    ];
    const { api, requests } = fakeApi({
      [ACTIVATE]: () => activations.shift()!,
      "POST /api/v1/spaces/{spaceId}/plans/{planId}/close": () =>
        jsonResponse(referencePlanDto({ status: "CLOSED", version: 9 })),
    });
    show({ plan: freeAt99(), api, today: "2026-12-01" });
    expect(within(screen.getByRole("listitem", { name: "Free" })).getByText("Asignación inválida")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Activar plan" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("El reparto de esta línea no cuadra.");
    expect(alert).toHaveTextContent("No se puede activar: revisa la asignación de Free.");
    await userEvent.click(screen.getByRole("button", { name: "Activar plan" }));
    expect(await screen.findByText("Activo")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Cerrar plan" }));
    expect(await screen.findByText("Cerrado")).toBeInTheDocument();
    expect(screen.getByText("Plan cerrado: queda en solo lectura.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Editar/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Agregar línea" })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(requests.map((r) => r.headers.get("if-match"))).toEqual(['"7"', '"7"', '"8"']);
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  it("keeps Close disabled until the period is over, and says from when", () => {
    show({ plan: referencePlanDto({ status: "ACTIVE" }), today: "2026-11-15" });
    expect(screen.getByRole("button", { name: "Cerrar plan" })).toBeDisabled();
    expect(screen.getByText("Se puede cerrar cuando termine el período, desde el 1/12/2026.")).toBeInTheDocument();
  });

  it("says when someone else changed the plan, and shows the plan as it now is (ruling P206)", async () => {
    const fresh = referencePlanDto({ version: 9, lines: referencePlanDto().lines.slice(0, 3) });
    const { api } = fakeApi({
      [ACTIVATE]: () => problemResponse(412, "PreconditionFailed"),
      "GET /api/v1/spaces/{spaceId}/plans/{planId}": () => jsonResponse(fresh),
    });
    show({ api });
    await userEvent.click(screen.getByRole("button", { name: "Activar plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Alguien cambió esto mientras lo editabas.");
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Free" })).toBeNull());
  });

  it("disables Activate while the call is pending, so a double click activates once", async () => {
    let release: (response: Response) => void = () => undefined;
    const { api, requests } = fakeApi({
      [ACTIVATE]: () => new Promise<Response>((resolve) => (release = resolve)),
    });
    show({ api });
    const activate = screen.getByRole("button", { name: "Activar plan" });
    await userEvent.dblClick(activate);
    expect(activate).toBeDisabled();
    release(jsonResponse(referencePlanDto({ status: "ACTIVE", version: 8 })));
    expect(await screen.findByText("Activo")).toBeInTheDocument();
    expect(requests).toHaveLength(1);
  });

  it("shows a VIEWER no edit control, and a MEMBER only the way to their own capacity (ruling P207)", () => {
    const viewer = show({ space: householdDto({ role: "VIEWER" }) });
    for (const name of ["Activar plan"]) expect(screen.queryByRole("button", { name })).toBeNull();
    for (const name of ["Agregar línea", "Editar capacidades", "Editar Home"])
      expect(screen.queryByRole("link", { name })).toBeNull();
    viewer.unmount();
    show({ space: householdDto({ role: "MEMBER" }) });
    expect(screen.getByRole("link", { name: "Editar capacidades" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plans/p-nov/capacities",
    );
    expect(screen.queryByRole("link", { name: "Editar Home" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Activar plan" })).toBeNull();
  });

  it("loads the plan and the space's members", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/plans/{planId}": () => jsonResponse(referencePlanDto()),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: HOUSEHOLD_MEMBERS }),
    });
    const result = await loadPlanner(api, { spaceId: "sp-household", planId: "p-nov" });
    expect(result.ok && [result.data.plan.id, result.data.members.map((m) => m.displayName)]).toEqual([
      "p-nov",
      ["Ana", "Juan"],
    ]);
    expect(requests.map((r) => new URL(r.url).pathname).sort()).toEqual([
      "/api/v1/spaces/sp-household/members",
      "/api/v1/spaces/sp-household/plans/p-nov",
    ]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/ui` and `pnpm exec vitest run --project ui src/modules/budgeting/ui`
Expected: FAIL — `./plan-access`, `./plan-write` and `./planner` do not exist.

- [ ] **Step 3: Implement**

`src/shared/ui/api/dto.ts`, after the last export (skip the `SpaceMemberDto` line when M6b already exports it):

```ts
export type BudgetPlanDto = components["schemas"]["BudgetPlan"];
export type PlanLineDto = BudgetPlanDto["lines"][number];
export type SpaceMemberDto = components["schemas"]["SpaceMember"];
```

`src/modules/budgeting/ui/plan-access.ts`:

```ts
import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import type { BudgetPlanDto, SpaceDto, SpaceMemberDto } from "@/shared/ui/api/dto";

/** Ruling P207: OWNER and ADMIN manage plans (the permission matrix's plan.manage, HU-E6-01). */
export const canManage = (role: SpaceDto["role"]): boolean => role === "OWNER" || role === "ADMIN";

/** HU-E6-02, D17: managers set anyone's capacity; a registered MEMBER only their own (capacity.setOwn). */
export const capacityEditable = (
  role: SpaceDto["role"],
  member: Pick<SpaceMemberDto, "userId">,
  viewerUserId: string,
): boolean => canManage(role) || (role === "MEMBER" && member.userId === viewerUserId);

/** HU-E6-07: a CLOSED plan refuses every edit. */
export const isEditable = (plan: Pick<BudgetPlanDto, "status">): boolean => plan.status !== "CLOSED";

/** HU-E6-07: the first day a plan may close, the day after its period's last day. */
export const closesFrom = (plan: Pick<BudgetPlanDto, "period">): string =>
  addDays(plan.period.endDate as LocalDate, 1);

export const canCloseOn = (plan: Pick<BudgetPlanDto, "status" | "period">, today: string): boolean =>
  plan.status === "ACTIVE" && today >= closesFrom(plan);

/** The viewer's own member row in the space, or null. */
export const memberOf = (members: readonly SpaceMemberDto[], userId: string): SpaceMemberDto | null =>
  members.find((member) => member.userId === userId) ?? null;
```

`src/modules/budgeting/ui/plan-write.ts`:

```ts
import type { Api } from "@/shared/ui/api/client";
import type { BudgetPlanDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";

/** Ruling P206: a plan write's outcome: the plan as it now is, or the problem and the lines it names. */
export type PlanWrite =
  | { readonly ok: true; readonly plan: BudgetPlanDto }
  | { readonly ok: false; readonly problem: Problem; readonly lineIds: readonly string[] };

/** `If-Match` with the version of the plan the screen shows (spec 7, HU-E0-10). */
export const ifMatch = (plan: Pick<BudgetPlanDto, "version">): { "if-match": string } => ({
  "if-match": `"${plan.version}"`,
});

/** HU-E6-07: activation's InvalidAllocation names its lines in `lineIds`, a field `Problem` does not keep. */
const lineIdsOf = (error: unknown): string[] => {
  const ids = typeof error === "object" && error !== null ? (error as { lineIds?: unknown }).lineIds : undefined;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
};

/** Every plan write answers the whole plan; a failure never throws to the screen. */
export const planWrite = async (
  call: Promise<{ data?: BudgetPlanDto; error?: unknown; response: Response }>,
): Promise<PlanWrite> => {
  try {
    const { data, error, response } = await call;
    if (response.ok && data !== undefined) return { ok: true, plan: data };
    return { ok: false, problem: problemFrom(error, response), lineIds: lineIdsOf(error) };
  } catch (error) {
    return { ok: false, problem: problemFrom(error, undefined), lineIds: [] };
  }
};

/** The plan as the server has it now (after a 412, ruling P206); null when it cannot be read. */
export const rereadPlan = async (api: Api, spaceId: string, planId: string): Promise<BudgetPlanDto | null> => {
  try {
    const { data } = await api.GET("/api/v1/spaces/{spaceId}/plans/{planId}", {
      params: { path: { spaceId, planId } },
    });
    return data ?? null;
  } catch {
    return null;
  }
};
```

`src/modules/budgeting/ui/planner/planner.tsx` (`"use client"`). State: `plan` (from the prop), `pending` (boolean), `failure: { problem; lineIds } | null`. The API is `useMemo(() => api ?? browserApi(), [api])`. Rendering follows the Planner artboard, top to bottom:
- **Header.**
  - A back link `budgeting.planner.back` to `/spaces/${space.id}/plan?period=${plan.period.label}`.
  - The `h1` `budgeting.planner.title` with `{period}` from `usePeriodText()` (the space's policy and the person's formats).
  - A `p` `budgeting.planner.dates` with `{space}`, and `{start}` and `{end}` in `formatDate`.
  - `PlanStatusBadge`.
- **Closed notice.** For a CLOSED plan, a `p role="status"` `budgeting.planner.closedNotice`.
- **Failure alert.** When `failure` is set, a `div role="alert"`:
  - for `InvalidAllocation`, the message of `useProblemMessage()` and then `budgeting.planner.invalidLines` with `{lines}`, the names of `failure.lineIds` in plan order joined with ", ";
  - otherwise, the message and its reference.
- **Capacity.** A `section` labelled by its `h2` `budgeting.planner.capacity`:
  - `formatMoney(plan.totalCapacity)`;
  - `budgeting.planner.unallocated` with `{amount}` from `plan.unallocated`;
  - one `p` per `plan.capacities` row: `budgeting.planner.memberShare` with `{name}` (the member's `displayName`), `{amount}` and `{share}` (`formatPercent`), or `budgeting.planner.memberAmount` when `share` is null;
  - when the plan is editable and the viewer is a manager or a MEMBER, a link `budgeting.planner.editCapacities` to `…/plans/${plan.id}/capacities`.
- **Lines.** A `section` labelled by its `h2` `budgeting.planner.lines`:
  - for a manager on an editable plan, a link `budgeting.planner.addLine` to `…/lines/new`;
  - `budgeting.planner.empty` when there are no lines;
  - else a `ul` with one `li` per line, named by `aria-labelledby` its name. Each `li` shows:
    - the name;
    - `Badge` `budgeting.line.catchAll` when `isCatchAll`;
    - `Badge tone="owe" icon="alert"` `budgeting.planner.invalidAllocation` when `allocation.error` is set;
    - `budgeting.planner.meta` with `{funding}` (`budgeting.funding.<f>`), `{rule}` (`budgeting.rule.<r>`) and `{rollover}` (`budgeting.rollover.<m>`);
    - `formatMoney(plannedAmount)`;
    - `budgeting.planner.ofCapacity` with `formatPercent(capacityShare)` when it is set;
    - for a manager on an editable plan, an icon link `budgeting.planner.editLine` with `{name}` (`Icon name="pencil"`) to `…/lines/${line.id}`.
- **Lifecycle** (managers only):
  - for a DRAFT, a `Button size="lg"` `budgeting.planner.activate` and the hint `budgeting.planner.activateHint`;
  - for an ACTIVE plan, a `Button size="lg" variant="secondary"` `budgeting.planner.close`, disabled unless `canCloseOn(plan, today)`, and the hint `budgeting.planner.closeHint` with `{date}` = `formatDate(closesFrom(plan))`;
  - both buttons are disabled while `pending`.

Each lifecycle click does the following:
1. Return when a `useRef` flag says a call is in flight (a second click can arrive before the re-render that disables the button), else set the flag and `pending`.
2. Call `planWrite(api.POST(…activate or …close, { params: { path: { spaceId: space.id, planId: plan.id } }, headers: ifMatch(plan) }))`.
3. On `ok`: set the plan, clear `failure`, and call `router.refresh()`.
4. On `PreconditionFailed`: set the failure, then set the plan to `await rereadPlan(…)` when it is not null.
5. On any other problem: set the failure.
6. Clear the flag and `pending`.

`src/modules/budgeting/ui/planner/planner-container.tsx`:

```tsx
import { notFound } from "next/navigation";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { BudgetPlanDto, SpaceMemberDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { nowIn } from "@/shared/ui/time/when";
import { Planner } from "./planner";

/** HU-E9-08: the plan and the space's current members (names for capacities and allocations). */
export const loadPlanner = async (
  api: Api,
  { spaceId, planId }: { spaceId: string; planId: string },
): Promise<Loaded<{ plan: BudgetPlanDto; members: SpaceMemberDto[] }>> => {
  const [plan, members] = await Promise.all([
    loaded(api.GET("/api/v1/spaces/{spaceId}/plans/{planId}", { params: { path: { spaceId, planId } } })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/members", { params: { path: { spaceId } } })),
  ]);
  if (!plan.ok) return plan;
  if (!members.ok) return members;
  return { ok: true, data: { plan: plan.data, members: members.data.items } };
};

/** Server: the planner of `planId`, in the person's formats and today's date in their zone. */
export async function PlannerContainer({ spaceId, planId }: { readonly spaceId: string; readonly planId: string }) {
  const [me, spaces] = await Promise.all([getMe(), getSpaces()]);
  const space = spaces.find((s) => s.id === spaceId) ?? notFound();
  const result = await loadPlanner(await serverApi(), { spaceId, planId });
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  return (
    <Planner
      space={space}
      plan={result.data.plan}
      members={result.data.members}
      formats={me!.preferences.effective}
      today={nowIn(serverNow(), me!.timezone).date}
    />
  );
}
```

`src/modules/budgeting/ui/server.ts`: `// Server containers (P153).` and `export { PlannerContainer } from "./planner/planner-container";`. `src/modules/budgeting/ui/index.ts` gains `export { canManage } from "./plan-access";`. In `reporting/ui/dashboard-frame.tsx` remove the inline `canManage` and import it from `@/modules/budgeting/ui`.

`src/app/(web)/(app)/spaces/[spaceId]/plans/[planId]/page.tsx`: `generateMetadata` with the title `budgeting.planner.metaTitle`; the page awaits `params` and renders `<PlannerContainer spaceId={spaceId} planId={planId} />`.

Catalog keys (`budgeting`), es / en:
- `planner`:
  - `metaTitle` Planeador / Planner; `back` Volver al tablero / Back to the dashboard;
  - `title` Plan de {period} / Plan for {period}; `dates` {space} · {start} – {end} / {space} · {start} – {end};
  - `closedNotice` Plan cerrado: queda en solo lectura. / Closed plan: it is read-only now.;
  - `capacity` Capacidad total / Total capacity; `unallocated` Sin asignar {amount} / Unallocated {amount};
  - `memberShare` {name} {amount} · {share} / {name} {amount} · {share}; `memberAmount` {name} {amount} / {name} {amount};
  - `editCapacities` Editar capacidades / Edit capacities;
  - `lines` Líneas / Lines; `addLine` Agregar línea / Add line; `empty` Este plan aún no tiene líneas. / This plan has no lines yet.;
  - `meta` {funding} · {rule} · {rollover} / {funding} · {rule} · {rollover};
  - `ofCapacity` {share} de la capacidad / {share} of capacity; `invalidAllocation` Asignación inválida / Invalid allocation; `editLine` Editar {name} / Edit {name};
  - `activate` Activar plan / Activate plan;
  - `activateHint` En borrador el plan no cambia la división de los gastos. Al activarlo, «Según el plan» pasa a ser la división por defecto. / While in draft, the plan does not change how expenses are split. Once active, “By the plan” becomes the default split.;
  - `close` Cerrar plan / Close plan; `closeHint` Se puede cerrar cuando termine el período, desde el {date}. / It can be closed once the period is over, from {date}.;
  - `invalidLines` No se puede activar: revisa la asignación de {lines}. / It cannot be activated: check the allocation of {lines}.;
- `funding`: `DIRECT` Directo / Direct; `SHARED_FUND` Fondo compartido / Shared fund; `SAVINGS` Ahorro / Savings;
- `rule`: `PROPORTIONAL` Según capacidad / By capacity; `PERCENT` Porcentaje / Percentage; `FIXED` Monto fijo / Fixed amount; `NONE` Sin asignar / Not allocated;
- `rollover`: `RESET` Reinicia / Resets; `ROLLOVER` Acumula / Rolls over; `ADJUSTED` Ajusta / Adjusts;
- `line.catchAll` Todo lo demás / Everything else.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, `pnpm exec vitest run --project ui src/modules/reporting/ui`, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/budgeting/ui src/modules/reporting/ui/dashboard-frame.tsx \
  "src/app/(web)/(app)/spaces/[spaceId]/plans" src/shared/ui/api/dto.ts tests/support/ui/plan-dto.ts src/i18n/messages
git commit -m "feat(budgeting): add the planner with capacities, lines and the plan cycle (Refs #76)"
```

If the staged candidate is over ~500 lines, commit it in two passes at the named split point:
1. `plan-access.ts`, `plan-write.ts` and their tests, `dto.ts` and the builders: `feat(budgeting): add the plan's access rules and conditional writes for the planner (Refs #76)`;
2. the planner, its container, the page and the catalog keys: `feat(budgeting): add the planner with capacities, lines and the plan cycle (Refs #76)`.

---

### Task 5: A period without a plan: create, copy and the copy notice

The NoPlan and CopyPlan artboards. Two scenarios: HU-E9-10's "A period without a plan offers to create or copy one", and HU-E9-08's "Copy the previous plan" at component level. When the line dashboard answers `plan: null`, the Lines view shows:
- the "{period} has no plan" card;
- the actions "Create plan" and "Copy previous plan", for managers only (ruling P207);
- the Unbudgeted figures.

Both actions create the plan and open the planner. A copy also carries what it dropped to the planner once, through `sessionStorage` (ruling P209). There the copy notice names the archived categories ("Utilities, which fed Home") and the savings lines left out.

**Files:**
- Create: `src/modules/budgeting/ui/{plan-start.tsx, plan-start.test.tsx, copy-notice.tsx, copy-notice.test.tsx}`, `src/modules/reporting/ui/lines/no-plan.tsx`
- Modify: `src/modules/budgeting/ui/index.ts`, `src/modules/budgeting/ui/planner/{planner.tsx, planner-container.tsx, planner.test.tsx}`, `src/modules/reporting/ui/lines/{lines-container.tsx, lines.test.tsx}`, `tests/support/ui/plan-dto.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `planWrite` (Task 4), `canManage`, `usePeriodText`, `formatMoney`, `CategoryGroupDto`, `browserApi`, `useProblemMessage`, `Button`.
- Produces:
  - `rememberDropped(planId: string, dropped: PlanDrops): void` and `takeDropped(planId: string): PlanDrops | null` (one read, then gone; every storage error swallowed), where `type PlanDrops = NonNullable<BudgetPlanDto["dropped"]>`;
  - `CopyNotice({ plan, groups })` (client; renders nothing without stored drops);
  - `PlanStartActions({ spaceId, period, api? })` (client; exported from `budgeting/ui/index.ts`);
  - `NoPlan({ space, dashboard, formats })` (server-safe, in `reporting/ui/lines`);
  - `loadPlanner` also loads `groups: CategoryGroupDto[]` (`GET …/categories?archived=true`), so archived names still show;
  - `Planner` takes `groups` and renders `CopyNotice` under its header;
  - builder `copiedPlanDto()`: the reference plan copied to 2026-12, with `dropped.mappings: [{ lineId: "l-home-dec", categoryId: "c-utilities" }]`.

- [ ] **Step 1: Write the failing tests**

`tests/support/ui/plan-dto.ts`, appended:

```ts
/** HU-E9-08 "Copy the previous plan": December copied from November; "Utilities" (archived) left Home's mapping. */
export const copiedPlanDto = (): BudgetPlanDto => {
  const november = referencePlanDto();
  return {
    ...november,
    id: "p-dec",
    period: { label: "2026-12", startDate: "2026-12-01", endDate: "2026-12-31" },
    createdFrom: "p-nov",
    version: 1,
    lines: november.lines.map((line) => ({ ...line, id: `${line.id}-dec`, originLineId: line.id })),
    dropped: { mappings: [{ lineId: "l-home-dec", categoryId: "c-utilities" }], savingsAccounts: [], lines: [] },
  };
};
```

`src/modules/budgeting/ui/plan-start.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { copiedPlanDto, referencePlanDto } from "../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { takeDropped } from "./copy-notice";
import { PlanStartActions } from "./plan-start";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("create or copy a plan (HU-E9-10, HU-E9-08)", () => {
  it("creates the period's plan and opens the planner", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/plans": () => jsonResponse(referencePlanDto(), 201),
    });
    const { container } = renderWithIntl(<PlanStartActions spaceId="sp-household" period="2026-11" api={api} />);
    await userEvent.click(screen.getByRole("button", { name: "Crear plan" }));
    expect(await requests[0]!.json()).toEqual({ period: "2026-11" });
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-household/plans/p-nov");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("copies the previous plan and keeps what it dropped for the planner, once", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/plans": () => jsonResponse(copiedPlanDto(), 201),
    });
    renderWithIntl(<PlanStartActions spaceId="sp-household" period="2026-12" api={api} />);
    await userEvent.click(screen.getByRole("button", { name: "Copiar plan anterior" }));
    expect(await requests[0]!.json()).toEqual({ period: "2026-12", copyFrom: "previous" });
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-household/plans/p-dec");
    expect(takeDropped("p-dec")).toEqual(copiedPlanDto().dropped);
    expect(takeDropped("p-dec")).toBeNull();
  });

  it("says why a copy is not possible and stays", async () => {
    const { api } = fakeApi({ "POST /api/v1/spaces/{spaceId}/plans": () => problemResponse(409, "NoPreviousPlan") });
    renderWithIntl(<PlanStartActions spaceId="sp-household" period="2027-01" api={api} />);
    await userEvent.click(screen.getByRole("button", { name: "Copiar plan anterior" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No hay un plan anterior para copiar.");
    expect(router.push).not.toHaveBeenCalled();
  });
});
```

`src/modules/budgeting/ui/copy-notice.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { categoryDto, groupDto } from "../../../../tests/support/ui/dto";
import { copiedPlanDto, referencePlanDto } from "../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { CopyNotice, rememberDropped } from "./copy-notice";

const groups = [
  groupDto({
    id: "g-home",
    name: "Hogar",
    categories: [categoryDto({ id: "c-utilities", name: "Utilities", archivedAt: "2026-11-20T12:00:00.000Z" })],
  }),
];
beforeEach(() => sessionStorage.clear());

describe("copy notice (HU-E9-08)", () => {
  it("lists the archived category dropped from Home's mapping, by name, once", async () => {
    const plan = copiedPlanDto();
    rememberDropped(plan.id, plan.dropped!);
    const first = renderWithIntl(<CopyNotice plan={plan} groups={groups} />);
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("Copiado del plan anterior");
    expect(notice).toHaveTextContent("Utilities, que alimentaba Home");
    first.unmount();
    renderWithIntl(<CopyNotice plan={plan} groups={groups} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names a savings line that was not copied", async () => {
    const plan = referencePlanDto();
    rememberDropped(plan.id, { mappings: [], savingsAccounts: [], lines: [{ originLineId: "l-old", name: "Car" }] });
    renderWithIntl(<CopyNotice plan={plan} groups={groups} />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "La línea Car: ninguna de sus cuentas de ahorro sigue disponible",
    );
  });
});
```

`src/modules/reporting/ui/lines/lines.test.tsx`, add `NoPlan` to the imports (`import { NoPlan } from "./no-plan";`) and append inside the `describe`:

```tsx
  it("shows all spending under Unbudgeted and offers managers to create or copy a plan (2027-01)", async () => {
    const january = { label: "2027-01", startDate: "2027-01-01", endDate: "2027-01-31" };
    const dashboard = e7Dashboard({
      period: january,
      plan: null,
      lines: [],
      unbudgeted: { spent: cop(100_000), available: cop(-100_000), overspent: true },
      totals: { planned: cop(0), spent: cop(100_000), available: cop(-100_000) },
    });
    const owner = renderWithIntl(<NoPlan space={householdDto()} dashboard={dashboard} formats={BUILT_IN_FORMATS} />);
    expect(screen.getByRole("heading", { level: 2, name: "enero 2027 no tiene plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar plan anterior" })).toBeInTheDocument();
    expect(tableRows()).toEqual([["Sin presupuesto", "$ 0", "$ 100.000", "−$ 100.000"]]);
    expect(await axeViolations(owner.container)).toEqual([]);
    owner.unmount();
    renderWithIntl(<NoPlan space={householdDto({ role: "MEMBER" })} dashboard={dashboard} formats={BUILT_IN_FORMATS} />);
    expect(screen.queryByRole("button", { name: "Crear plan" })).toBeNull();
    expect(screen.getByText("Solo Propietario y Administrador pueden crear el plan.")).toBeInTheDocument();
  });
```

(`NoPlan` renders `PlanStartActions`, which calls `useRouter`: extend this file's `next/navigation` mock with `useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })`.)

In `planner.test.tsx`, add `groups={[]}` to `show`'s `Planner` props. In `loadPlanner`'s test, add the route `"GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: [] })` and expect the paths list to include `/api/v1/spaces/sp-household/categories` and the query `archived=true`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project ui src/modules/budgeting/ui src/modules/reporting/ui/lines`
Expected: FAIL — `./plan-start`, `./copy-notice` and `./no-plan` do not exist.

- [ ] **Step 3: Implement**

`src/modules/budgeting/ui/copy-notice.tsx` (`"use client"`):

```tsx
"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { findCategory } from "@/modules/categories/ui";
import type { BudgetPlanDto, CategoryGroupDto } from "@/shared/ui/api/dto";

export type PlanDrops = NonNullable<BudgetPlanDto["dropped"]>;
const keyOf = (planId: string) => `hearth.planCopy.${planId}`;

/** Ruling P209: what a copy left out travels to the planner once, in this tab only. */
export const rememberDropped = (planId: string, dropped: PlanDrops): void => {
  try {
    globalThis.sessionStorage.setItem(keyOf(planId), JSON.stringify(dropped));
  } catch {
    // Storage blocked or full: the planner shows no notice, which loses only information.
  }
};

export const takeDropped = (planId: string): PlanDrops | null => {
  try {
    const text = globalThis.sessionStorage.getItem(keyOf(planId));
    globalThis.sessionStorage.removeItem(keyOf(planId));
    return text === null ? null : (JSON.parse(text) as PlanDrops);
  } catch {
    return null;
  }
};

/** HU-E6-06, the CopyPlan artboard: the copy's notice, naming what no longer fits by its current names. */
export function CopyNotice({ plan, groups }: { readonly plan: BudgetPlanDto; readonly groups: CategoryGroupDto[] }) {
  const t = useTranslations("budgeting.copy");
  const [dropped, setDropped] = useState<PlanDrops | null>(null);
  useEffect(() => {
    // sessionStorage exists only in the browser, after hydration; this is the one read of it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDropped(takeDropped(plan.id));
  }, [plan.id]);
  if (dropped === null) return null;
  const lineName = (id: string) => plan.lines.find((line) => line.id === id)?.name ?? "";
  const items = [
    ...dropped.mappings.map((m) =>
      t("droppedMapping", { category: findCategory(groups, m.categoryId)?.category.name ?? "", line: lineName(m.lineId) }),
    ),
    ...dropped.savingsAccounts.map((a) => t("droppedAccount", { line: lineName(a.lineId) })),
    ...dropped.lines.map((l) => t("droppedLine", { name: l.name })),
  ];
  return (
    <div role="status" className="flex flex-col gap-2 rounded-2xl bg-accent-soft p-4 text-sm text-ink">
      <p className="font-semibold">{t("title")}</p>
      <p>{items.length > 0 ? t("body") : t("bodyComplete")}</p>
      {items.length > 0 ? (
        <ul className="list-disc pl-5">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

(`findCategory` is exported from `categories/ui/index.ts` since M6a and finds archived categories too.)

`src/modules/budgeting/ui/plan-start.tsx` (`"use client"`): `PlanStartActions({ spaceId, period, api? })`.
- It shows a primary `Button size="lg"` `budgeting.start.copy` and a secondary `Button size="lg"` `budgeting.start.create`, both disabled while pending.
- A click sends `api.POST("/api/v1/spaces/{spaceId}/plans", { params: { path: { spaceId } }, body: copy ? { period, copyFrom: "previous" } : { period } })` through `planWrite`.
- On success, a copy calls `rememberDropped(plan.id, plan.dropped)` when `dropped` is set; then `router.push(\`/spaces/${spaceId}/plans/${plan.id}\`)`.
- On a problem, it shows a `p role="alert"` with `useProblemMessage()(problem).message`. A `PlanAlreadyExists` answer also calls `router.refresh()`, so the dashboard shows the plan someone just created.

Export `PlanStartActions` from `budgeting/ui/index.ts`.

`src/modules/reporting/ui/lines/no-plan.tsx` (no `"use client"`), the NoPlan artboard:
- a card with the calendar icon (`Icon name="calendar"`), the `h2` `reports.noPlan.title` with `{period}` (`usePeriodText()`), and the `p` `reports.noPlan.body`;
- for a manager (`canManage(space.role)`), `<PlanStartActions spaceId={space.id} period={dashboard.period.label} />`; otherwise the `p` `reports.noPlan.managersOnly`;
- then `<LineDashboard dashboard={dashboard} formats={formats} />`. Its table holds only the Unbudgeted row, and its summary shows the totals.

In `lines-container.tsx`, the frame's child becomes `dashboard.plan === null ? <NoPlan space={space} dashboard={dashboard} formats={formats} /> : <LineDashboard … />`.

In `planner-container.tsx`, `loadPlanner` also reads `loaded(api.GET("/api/v1/spaces/{spaceId}/categories", { params: { path: { spaceId }, query: { archived: "true" } } }))`, adds `groups: categories.data.items` to its data, and the container passes `groups` to `Planner`. `Planner` takes `readonly groups: CategoryGroupDto[]` and renders `<CopyNotice plan={plan} groups={groups} />` right after the status badge.

Catalog keys, es / en:
- `budgeting.start.create` Crear plan / Create plan; `budgeting.start.copy` Copiar plan anterior / Copy previous plan;
- `budgeting.copy`:
  - `title` Copiado del plan anterior / Copied from the previous plan;
  - `body` Mismas líneas, montos, reglas y capacidades. Quedó fuera lo que ya no se puede usar: / Same lines, amounts, rules and capacities. What can no longer be used was left out:;
  - `bodyComplete` Mismas líneas, montos, reglas y capacidades. / Same lines, amounts, rules and capacities.;
  - `droppedMapping` {category}, que alimentaba {line} / {category}, which fed {line};
  - `droppedAccount` Una cuenta de ahorro de {line} que ya no se puede usar / A savings account of {line} that can no longer be used;
  - `droppedLine` La línea {name}: ninguna de sus cuentas de ahorro sigue disponible / The line {name}: none of its savings accounts is still available;
- `reports.noPlan`:
  - `title` {period} no tiene plan / {period} has no plan;
  - `body` Sin plan, todo lo que se gaste en este período aparece como Sin presupuesto y la división por defecto es en partes iguales. / Without a plan, everything spent in this period shows as Unbudgeted and the default split is equal shares.;
  - `managersOnly` Solo Propietario y Administrador pueden crear el plan. / Only an Owner or an Admin can create the plan.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's command, `pnpm exec vitest run --project ui src/modules/budgeting/ui/planner`, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/budgeting/ui src/modules/reporting/ui/lines tests/support/ui/plan-dto.ts src/i18n/messages
git commit -m "feat(budgeting): create or copy a period's plan and show what the copy left out (Refs #76, Refs #78)"
```

---

### Task 6: Capacities with the private suggestion

The Capacity artboard and HU-E9-08's "The capacity suggestion is private" (component level). The screen lists every current member, and edits follow the role:
- managers edit every row;
- a MEMBER edits only their own (D17);
- a VIEWER reads.

The viewer's own row may carry the suggestion "Suggested 1,650,000 COP: your income of October in Personal. Only you see it." with "Use suggestion". The capacities container asks for the suggestion on the server with the request's cookie. It is shown only on the row the answer names, and only when that row is the viewer's (ruling P208). The total and the shares are the stored ones until the save answers, never a sum of the fields.

**Files:**
- Create: `src/modules/budgeting/ui/capacities/{capacity-draft.ts, capacity-draft.test.ts, capacity-form.tsx, capacity-form.test.tsx, capacities-container.tsx}`, `src/app/(web)/(app)/spaces/[spaceId]/plans/[planId]/capacities/page.tsx`
- Modify: `src/modules/budgeting/ui/server.ts`, `src/shared/ui/api/dto.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `capacityEditable`, `memberOf` (Task 4), `planWrite`, `ifMatch`, `rereadPlan`, `parseDecimal`, `minorOf`, `decimalOf`, `formatNumber`, `formatMoney`, `formatPercent`, `currencyOf`, `fieldOf`, `useProblemMessage`, `TextField`, `Button`, `usePeriodText`.
- Produces:
  - `dto.ts`: `CapacitySuggestionDto` (the 200 of `GET …/capacity-suggestion`).
  - `capacity-draft.ts`:
    - `draftsOf(plan, members, formats): Record<string, string>` (each member's stored capacity as typed text, `""` when none);
    - `capacityBodyOf(drafts, editableIds, currency, numberFormat): { ok: true; body: { capacities: { memberId: string; amount: MoneyDto }[] } } | { ok: false; memberId: string }` (only the editable rows, in `editableIds` order; an empty field sends 0);
    - `capacityFieldOf(problem, sentIds): string | "form"` (a `ValidationFailed` path `capacities.<i>.…` points at `sentIds[i]`; everything else at the form).
  - `CapacityForm({ space, plan, members, viewerUserId, suggestion, formats, api? })` (client).
  - `loadCapacities(api, { spaceId, planId }): Promise<Loaded<{ plan; members; suggestion: CapacitySuggestionDto | null }>>`; `CapacityContainer({ spaceId, planId })`.

- [ ] **Step 1: Write the failing tests**

`src/modules/budgeting/ui/capacities/capacity-draft.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HOUSEHOLD_MEMBERS, referencePlanDto } from "../../../../../tests/support/ui/plan-dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { capacityBodyOf, capacityFieldOf, draftsOf } from "./capacity-draft";

const problem = (code: string, extra = {}) => ({ code, status: 422, requestId: "r", errors: [], field: null, ...extra });

describe("capacity fields (HU-E9-08)", () => {
  it("starts each field from the stored capacity, in the person's number format", () => {
    expect(draftsOf(referencePlanDto(), HOUSEHOLD_MEMBERS, BUILT_IN_FORMATS)).toEqual({
      "m-ana": "1.600.000",
      "m-juan": "2.400.000",
    });
    expect(draftsOf(referencePlanDto({ capacities: [] }), HOUSEHOLD_MEMBERS, BUILT_IN_FORMATS)).toEqual({
      "m-ana": "",
      "m-juan": "",
    });
  });

  it("sends only the rows the viewer may change, an empty one as zero", () => {
    expect(capacityBodyOf({ "m-ana": "1.650.000", "m-juan": "" }, ["m-ana", "m-juan"], "COP", "DOT_COMMA")).toEqual({
      ok: true,
      body: {
        capacities: [
          { memberId: "m-ana", amount: { amount: "165000000", currency: "COP" } },
          { memberId: "m-juan", amount: { amount: "0", currency: "COP" } },
        ],
      },
    });
    expect(capacityBodyOf({ "m-ana": "1.600.000", "m-juan": "2.500.000" }, ["m-juan"], "COP", "DOT_COMMA")).toEqual({
      ok: true,
      body: { capacities: [{ memberId: "m-juan", amount: { amount: "250000000", currency: "COP" } }] },
    });
    expect(capacityBodyOf({ "m-ana": "dos" }, ["m-ana"], "COP", "DOT_COMMA")).toEqual({ ok: false, memberId: "m-ana" });
  });

  it("points a validation path at its member's field and anything else at the form", () => {
    const sent = ["m-ana", "m-juan"];
    expect(capacityFieldOf(problem("ValidationFailed", { errors: [{ path: "capacities.1.amount", message: "x" }] }), sent)).toBe("m-juan");
    expect(capacityFieldOf(problem("InvalidCapacity"), sent)).toBe("form");
  });
});
```

`src/modules/budgeting/ui/capacities/capacity-form.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { HOUSEHOLD_MEMBERS, householdDto, referencePlanDto } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { CapacitySuggestionDto, SpaceDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { loadCapacities } from "./capacities-container";
import { CapacityForm } from "./capacity-form";

vi.mock("next/headers", () => ({}));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, notFound: vi.fn(), redirect: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

const OCTOBER = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };
const suggestion = (memberId: string, pesos: number): CapacitySuggestionDto => ({
  memberId,
  period: OCTOBER,
  suggested: cop(pesos),
});
const show = (options: { viewer: string; space?: SpaceDto; suggestion?: CapacitySuggestionDto | null; api?: Api }) =>
  renderWithIntl(
    <CapacityForm
      space={options.space ?? householdDto()}
      plan={referencePlanDto()}
      members={HOUSEHOLD_MEMBERS}
      viewerUserId={options.viewer}
      suggestion={options.suggestion ?? null}
      formats={BUILT_IN_FORMATS}
      api={options.api}
    />,
  );
const rowOf = (name: string) => screen.getByRole("group", { name });

describe("capacities (HU-E9-08)", () => {
  it("shows Ana her private suggestion, fills her field with it and saves", async () => {
    const { api, requests } = fakeApi({
      "PUT /api/v1/spaces/{spaceId}/plans/{planId}/capacities": () => jsonResponse(referencePlanDto({ version: 8 })),
    });
    const { container } = show({ viewer: "u-ana", suggestion: suggestion("m-ana", 1_650_000), api });
    const ana = rowOf("Ana (tú)");
    expect(normalized(ana.textContent)).toContain(
      "Sugerido $ 1.650.000: tus ingresos de octubre 2026 en Personal. Solo tú lo ves.",
    );
    await userEvent.click(within(ana).getByRole("button", { name: "Usar sugerencia" }));
    expect(screen.getByLabelText("Capacidad de Ana")).toHaveValue("1.650.000");
    expect(within(rowOf("Juan")).queryByText(/Sugerido/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Guardar capacidades" }));
    expect(requests[0]!.headers.get("if-match")).toBe('"7"');
    expect(await requests[0]!.json()).toEqual({
      capacities: [
        { memberId: "m-ana", amount: { amount: "165000000", currency: "COP" } },
        { memberId: "m-juan", amount: { amount: "240000000", currency: "COP" } },
      ],
    });
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-household/plans/p-nov");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("never shows Juan Ana's suggestion, even when an answer names her (ruling P208)", () => {
    const member = householdDto({ role: "MEMBER" });
    const juan = show({ viewer: "u-juan", space: member, suggestion: suggestion("m-juan", 2_000_000) });
    expect(normalized(rowOf("Juan (tú)").textContent)).toContain("Sugerido $ 2.000.000");
    expect(within(rowOf("Ana")).queryByText(/Sugerido/)).toBeNull();
    juan.unmount();
    show({ viewer: "u-juan", space: member, suggestion: suggestion("m-ana", 1_650_000) });
    expect(screen.queryByText(/1\.650\.000/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Usar sugerencia" })).toBeNull();
  });

  it("lets a MEMBER change only their own capacity", async () => {
    const { api, requests } = fakeApi({
      "PUT /api/v1/spaces/{spaceId}/plans/{planId}/capacities": () => jsonResponse(referencePlanDto({ version: 8 })),
    });
    show({ viewer: "u-juan", space: householdDto({ role: "MEMBER" }), api });
    expect(screen.queryByLabelText("Capacidad de Ana")).toBeNull();
    expect(normalized(rowOf("Ana").textContent)).toContain("$ 1.600.000");
    await userEvent.clear(screen.getByLabelText("Capacidad de Juan"));
    await userEvent.type(screen.getByLabelText("Capacidad de Juan"), "2.500.000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar capacidades" }));
    expect(await requests[0]!.json()).toEqual({
      capacities: [{ memberId: "m-juan", amount: { amount: "250000000", currency: "COP" } }],
    });
  });

  it("shows a refused amount next to its member's field, and an unreadable one before any call", async () => {
    const { api, requests } = fakeApi({
      "PUT /api/v1/spaces/{spaceId}/plans/{planId}/capacities": () =>
        problemResponse(422, "ValidationFailed", { errors: [{ path: "capacities.0.amount", message: "x" }] }),
    });
    show({ viewer: "u-ana", api });
    await userEvent.clear(screen.getByLabelText("Capacidad de Juan"));
    await userEvent.type(screen.getByLabelText("Capacidad de Juan"), "dos");
    await userEvent.click(screen.getByRole("button", { name: "Guardar capacidades" }));
    expect(screen.getByLabelText("Capacidad de Juan")).toHaveAttribute("aria-invalid", "true");
    expect(requests).toHaveLength(0);
    await userEvent.clear(screen.getByLabelText("Capacidad de Juan"));
    await userEvent.type(screen.getByLabelText("Capacidad de Juan"), "2.400.000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar capacidades" }));
    await waitFor(() => expect(screen.getByLabelText("Capacidad de Ana")).toHaveAttribute("aria-invalid", "true"));
  });

  it("loads the plan, the members and the caller's suggestion, and reads on without one", async () => {
    const routes = {
      "GET /api/v1/spaces/{spaceId}/plans/{planId}": () => jsonResponse(referencePlanDto()),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: HOUSEHOLD_MEMBERS }),
    };
    const found = fakeApi({
      ...routes,
      "GET /api/v1/spaces/{spaceId}/plans/{planId}/capacity-suggestion": () => jsonResponse(suggestion("m-ana", 1_650_000)),
    });
    const result = await loadCapacities(found.api, { spaceId: "sp-household", planId: "p-nov" });
    expect(result.ok && result.data.suggestion).toEqual(suggestion("m-ana", 1_650_000));
    const failing = fakeApi({
      ...routes,
      "GET /api/v1/spaces/{spaceId}/plans/{planId}/capacity-suggestion": () => problemResponse(500, "InternalError"),
    });
    const fallback = await loadCapacities(failing.api, { spaceId: "sp-household", planId: "p-nov" });
    expect(fallback.ok && fallback.data.suggestion).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/ui/capacities` and `pnpm exec vitest run --project ui src/modules/budgeting/ui/capacities`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Implement**

`dto.ts`: `export type CapacitySuggestionDto = Json<paths["/api/v1/spaces/{spaceId}/plans/{planId}/capacity-suggestion"]["get"]["responses"][200]>;`

`src/modules/budgeting/ui/capacities/capacity-draft.ts`:

```ts
import type { BudgetPlanDto, MoneyDto, SpaceMemberDto } from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import { decimalOf, formatNumber, type Formats, type NumberFormat } from "@/shared/ui/format/formatters";

/** HU-E6-02: each member's capacity as the field starts it: the stored amount in the person's format, or empty. */
export const draftsOf = (
  plan: BudgetPlanDto,
  members: readonly SpaceMemberDto[],
  formats: Pick<Formats, "numberFormat">,
): Record<string, string> =>
  Object.fromEntries(
    members.map((member) => {
      const stored = plan.capacities.find((c) => c.memberId === member.id);
      const exponent = currencyOf(plan.totalCapacity.currency).exponent;
      return [member.id, stored ? formatNumber(decimalOf(stored.amount.amount, exponent), formats) : ""];
    }),
  );

/** The PUT body: only the rows the viewer may change (D17), an empty field as 0; the first unreadable row fails. */
export const capacityBodyOf = (
  drafts: Readonly<Record<string, string>>,
  editableIds: readonly string[],
  currency: string,
  numberFormat: NumberFormat,
): { ok: true; body: { capacities: { memberId: string; amount: MoneyDto }[] } } | { ok: false; memberId: string } => {
  const capacities: { memberId: string; amount: MoneyDto }[] = [];
  for (const memberId of editableIds) {
    const text = (drafts[memberId] ?? "").trim();
    const decimal = text === "" ? "0" : parseDecimal(text, numberFormat);
    const minor = decimal === null ? null : minorOf(decimal, currencyOf(currency).exponent);
    if (minor === null) return { ok: false, memberId };
    capacities.push({ memberId, amount: { amount: minor, currency } });
  }
  return { ok: true, body: { capacities } };
};

/** Ruling P118: a `capacities.<i>` path names the i-th row sent; any other problem belongs to the form. */
export const capacityFieldOf = (problem: Problem, sentIds: readonly string[]): string => {
  const index = /^capacities\.(\d+)/.exec(problem.errors[0]?.path ?? "")?.[1];
  return index === undefined ? "form" : (sentIds[Number(index)] ?? "form");
};
```

`src/modules/budgeting/ui/capacities/capacity-form.tsx` (`"use client"`). The Capacity artboard as a page:
- A back link `budgeting.capacity.back` to the planner.
- The `h1` `budgeting.capacity.title`, and the `p` `budgeting.capacity.subtitle` with `{period}` (`usePeriodText()` of `plan.period`).
- One `div role="group"` per member, `aria-labelledby` its name line. The name line reads `budgeting.capacity.you` with `{name}` for the viewer's own row (`member.userId === viewerUserId`), else the name. The row's body:
  - when `capacityEditable(space.role, member, viewerUserId) && isEditable(plan)`: a `TextField` labelled `budgeting.capacity.field` with `{name}`, `inputMode="decimal"`, its error set when the field is the failing one;
  - otherwise: the stored amount (`formatMoney`, or `formatMoney` of 0) as text.
- The suggestion block, rendered only when `suggestion?.suggested` is set, `suggestion.memberId === member.id` and `member.userId === viewerUserId`:
  - `budgeting.capacity.suggestion` with `{amount}` (`formatMoney(suggested)`) and `{period}` (`usePeriodText()(suggestion.period, space.periodPolicy, formats)`);
  - a `Button variant="secondary"` `budgeting.capacity.useSuggestion` that sets the draft to `formatNumber(decimalOf(suggested.amount, exponent))`.
- The notes `budgeting.capacity.zeroNote`, with `{zero}` = `formatMoney` of 0, and `budgeting.capacity.rolesNote`.
- The stored total: `budgeting.capacity.total`, `formatMoney(plan.totalCapacity)`, and the stored shares in `budgeting.planner.memberShare`.
- The `lg` button `budgeting.capacity.save`, disabled while pending.

Saving does the following:
1. `const editableIds = members.filter(…editable…).map((m) => m.id)` and `capacityBodyOf(drafts, editableIds, plan.totalCapacity.currency, formats.numberFormat)`.
2. If the body is not ok, mark that member's field with `budgeting.capacity.unreadable` and its `{example}` = `formatNumber("1500000", formats)`, and send nothing.
3. Otherwise, `planWrite(api.PUT("/api/v1/spaces/{spaceId}/plans/{planId}/capacities", { params: { path }, headers: ifMatch(plan), body }))`.
4. On `ok`: `router.push(\`/spaces/${space.id}/plans/${plan.id}\`)` and `router.refresh()`.
5. On `PreconditionFailed`: show the message above the button, re-read the plan, and reset the drafts with `draftsOf` of the fresh plan.
6. On any other problem: set the field to `capacityFieldOf(problem, editableIds)`. The member's field shows the translated message as its error; `"form"` shows it above the button.

`src/modules/budgeting/ui/capacities/capacities-container.tsx`: `loadCapacities` reads the plan and the members as `loadPlanner` does, and then the suggestion. A suggestion that is not `ok` becomes `null`: it never blocks the screen, and it is never read for anyone but the request's own user (`GET …/capacity-suggestion` takes no member). `CapacityContainer({ spaceId, planId })` gets `me` and the spaces, finds the space or calls `notFound()`, and renders `CapacityForm` with `viewerUserId={me!.id}`. `budgeting/ui/server.ts` gains `export { CapacityContainer } from "./capacities/capacities-container";`.

`src/app/(web)/(app)/spaces/[spaceId]/plans/[planId]/capacities/page.tsx`: the title `budgeting.capacity.title`, and `<CapacityContainer spaceId={spaceId} planId={planId} />`.

Catalog keys (`budgeting.capacity`), es / en:
- `back` Volver al plan / Back to the plan;
- `title` Capacidades / Capacities; `subtitle` Lo que cada persona pone en {period} / What each person puts in for {period};
- `you` {name} (tú) / {name} (you); `field` Capacidad de {name} / {name}'s capacity;
- `suggestion` Sugerido {amount}: tus ingresos de {period} en Personal. Solo tú lo ves. / Suggested {amount}: your income of {period} in Personal. Only you see it.;
- `useSuggestion` Usar sugerencia / Use suggestion;
- `zeroNote` Quien no tiene capacidad cuenta como {zero}. / Anyone without a capacity counts as {zero}.;
- `rolesNote` Un Miembro solo cambia la suya; Propietario y Administrador, la de todos. / A Member changes only their own; an Owner or an Admin changes everyone's.;
- `total` Total / Total; `save` Guardar capacidades / Save capacities;
- `unreadable` Escribe un monto como {example}. / Type an amount like {example}.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/budgeting/ui "src/app/(web)/(app)/spaces/[spaceId]/plans/[planId]/capacities" \
  src/shared/ui/api/dto.ts src/i18n/messages
git commit -m "feat(budgeting): set capacities with a suggestion only its owner sees (Refs #76)"
```

---

### Task 7: The line editor: fields, add, edit and remove

The LineEditor artboard's upper half. A line has:
- a name;
- its planned amount, with its share of capacity and what is still unallocated;
- where it comes from (Direct, Shared fund, Savings, the last with the caller's own savings accounts);
- what happens when the period changes;
- the catch-all switch.

An existing line also shows its planned, spent and available figures, and can be removed after a confirmation. Saving goes through `saveLine`, a sequence of steps (ruling P210). This task builds the line step; Task 8 adds the categories and allocation steps. The savings accounts offered are the caller's own active SAVINGS accounts of their personal space in the plan's currency (ruling P213), because the API attaches only accounts the caller owns (P8).

**Files:**
- Create: `src/modules/budgeting/ui/line-editor/{line-draft.ts, line-draft.test.ts, line-save.ts, line-save.test.ts, line-editor.tsx, line-editor.test.tsx, line-editor-container.tsx}`, `src/app/(web)/(app)/spaces/[spaceId]/plans/[planId]/lines/new/page.tsx`, `src/app/(web)/(app)/spaces/[spaceId]/plans/[planId]/lines/[lineId]/page.tsx`
- Modify: `src/modules/budgeting/ui/server.ts`, `tests/support/ui/plan-dto.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `planWrite`, `ifMatch`, `rereadPlan`, `canManage`, `isEditable` (Task 4); `parseDecimal`, `minorOf`, `decimalOf`, `formatNumber`, `formatMoney`, `formatPercent`, `currencyOf`; `personalSpaceOf` (`spaces/ui`); `TextField`, `Switch`, `ChoiceGroup`, `Button`, `Sheet`, `useProblemMessage`; `AccountDto`.
- Produces:
  - `line-draft.ts`:
    - `interface LineDraft { name: string; planned: string; funding: Funding; rolloverMode: RolloverMode; isCatchAll: boolean; savingsAccountIds: readonly string[] }`;
    - `NEW_LINE` (DIRECT, RESET, not catch-all);
    - `lineDraftOf(line: PlanLineDto | null, formats): LineDraft`;
    - `type LineBody = { name: string; plannedAmount: MoneyDto; funding: Funding; rolloverMode: RolloverMode; isCatchAll: boolean; savingsAccountIds: string[] }`;
    - `lineBodyOf(draft, currency, numberFormat): { ok: true; body: LineBody } | { ok: false; field: "planned" }` (a SAVINGS line is never catch-all; any other line names no account);
    - `lineChanges(line: PlanLineDto, body: LineBody): Partial<LineBody>` (only what differs);
    - `type LineField = "name" | "planned" | "savings" | "catchAll"`;
    - `lineFieldOf(problem): LineField | "form"`.
  - `line-save.ts`:
    - `type LineSection = "line" | "categories" | "allocation"`;
    - `interface LineSave { line: Partial<LineBody> | LineBody | null }` (Task 8 adds `categoryIds` and `allocation`);
    - `type SaveOutcome = { ok: true; plan: BudgetPlanDto; lineId: string } | { ok: false; plan: BudgetPlanDto; section: LineSection; problem: Problem; lineIds: readonly string[] }`;
    - `saveLine(api, { spaceId, plan, lineId: string | null }, save: LineSave): Promise<SaveOutcome>`;
    - `removeLine(api, { spaceId, plan, lineId }): Promise<PlanWrite>`;
    - `newLineId(before, after): string`.
  - `LineEditor({ space, plan, line, savingsAccounts, formats, api? })` (client); `loadLineEditor(api, { spaceId, planId, lineId, personalSpaceId }): Promise<Loaded<{ plan; line: PlanLineDto | null; savingsAccounts: AccountDto[] }>>`; `LineEditorContainer({ spaceId, planId, lineId })` (`lineId` null for a new line).
  - Builder: `savingsAccountDto()`, the "Ahorros" SAVINGS account `a-savings` of Ana's personal space.

- [ ] **Step 1: Write the failing tests**

`tests/support/ui/plan-dto.ts`: add `accountDto` to the `./dto` import, and append:

```ts
/** Ana's "Ahorros": a SAVINGS account of her personal space, the one the reference Savings line names. */
export const savingsAccountDto = () => accountDto({ id: "a-savings", name: "Ahorros", type: "SAVINGS", icon: "piggy" });
```

`src/modules/budgeting/ui/line-editor/line-draft.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planLineDto } from "../../../../../tests/support/ui/plan-dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { lineBodyOf, lineChanges, lineDraftOf, lineFieldOf, NEW_LINE } from "./line-draft";

const problem = (code: string, extra = {}) => ({ code, status: 409, requestId: "r", errors: [], field: null, ...extra });

describe("line fields (HU-E9-08)", () => {
  it("starts a new line DIRECT, RESET and not catch-all, and an existing one from what it stores", () => {
    expect(lineDraftOf(null, BUILT_IN_FORMATS)).toEqual(NEW_LINE);
    expect(NEW_LINE).toEqual({
      name: "",
      planned: "",
      funding: "DIRECT",
      rolloverMode: "RESET",
      isCatchAll: false,
      savingsAccountIds: [],
    });
    expect(lineDraftOf(planLineDto({ isCatchAll: true }), BUILT_IN_FORMATS)).toEqual({
      ...NEW_LINE,
      name: "Home",
      planned: "1.470.000",
      isCatchAll: true,
    });
  });

  it("builds the body of a line, a savings line never catch-all and any other without accounts", () => {
    expect(lineBodyOf({ ...NEW_LINE, name: " Rent ", planned: "1.200.000", funding: "SHARED_FUND" }, "COP", "DOT_COMMA")).toEqual({
      ok: true,
      body: {
        name: "Rent",
        plannedAmount: { amount: "120000000", currency: "COP" },
        funding: "SHARED_FUND",
        rolloverMode: "RESET",
        isCatchAll: false,
        savingsAccountIds: [],
      },
    });
    const savings = lineBodyOf(
      { ...NEW_LINE, name: "Savings", planned: "600.000", funding: "SAVINGS", isCatchAll: true, savingsAccountIds: ["a-savings"] },
      "COP",
      "DOT_COMMA",
    );
    expect(savings.ok && [savings.body.isCatchAll, savings.body.savingsAccountIds]).toEqual([false, ["a-savings"]]);
    const direct = lineBodyOf({ ...NEW_LINE, name: "Home", planned: "1", savingsAccountIds: ["a-savings"] }, "COP", "DOT_COMMA");
    expect(direct.ok && direct.body.savingsAccountIds).toEqual([]);
    expect(lineBodyOf({ ...NEW_LINE, name: "Home", planned: "mucho" }, "COP", "DOT_COMMA")).toEqual({
      ok: false,
      field: "planned",
    });
  });

  it("patches only what changed", () => {
    const home = planLineDto();
    const raised = lineBodyOf({ ...lineDraftOf(home, BUILT_IN_FORMATS), planned: "1.500.000" }, "COP", "DOT_COMMA");
    expect(raised.ok && lineChanges(home, raised.body)).toEqual({ plannedAmount: { amount: "150000000", currency: "COP" } });
    const same = lineBodyOf(lineDraftOf(home, BUILT_IN_FORMATS), "COP", "DOT_COMMA");
    expect(same.ok && lineChanges(home, same.body)).toEqual({});
  });

  it("shows each API code next to its field and the rest above the button", () => {
    expect(lineFieldOf(problem("BudgetLineNameTaken"))).toBe("name");
    expect(lineFieldOf(problem("PlanExceedsCapacity"))).toBe("planned");
    expect(lineFieldOf(problem("SavingsAccountRequired"))).toBe("savings");
    expect(lineFieldOf(problem("CatchAllLineAlreadySet"))).toBe("catchAll");
    expect(lineFieldOf(problem("ValidationFailed", { errors: [{ path: "plannedAmount.amount", message: "x" }] }))).toBe("planned");
    expect(lineFieldOf(problem("PeriodClosed"))).toBe("form");
  });
});
```

`src/modules/budgeting/ui/line-editor/line-save.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cop } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { planLineDto, referencePlanDto } from "../../../../../tests/support/ui/plan-dto";
import { removeLine, saveLine } from "./line-save";

const plan = referencePlanDto();
const pets = {
  name: "Pets",
  plannedAmount: cop(80_000),
  funding: "DIRECT" as const,
  rolloverMode: "RESET" as const,
  isCatchAll: false,
  savingsAccountIds: [],
};

describe("saving a line (ruling P210)", () => {
  it("adds a line with the plan's version and finds the new line's id", async () => {
    const added = referencePlanDto({ version: 8, lines: [...plan.lines, planLineDto({ id: "l-pets", name: "Pets" })] });
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/plans/{planId}/lines": () => jsonResponse(added, 201),
    });
    expect(await saveLine(api, { spaceId: "sp-household", plan, lineId: null }, { line: pets })).toEqual({
      ok: true,
      plan: added,
      lineId: "l-pets",
    });
    expect(requests[0]!.headers.get("if-match")).toBe('"7"');
    expect(await requests[0]!.json()).toEqual(pets);
  });

  it("sends nothing for an existing line without changes", async () => {
    const { api, requests } = fakeApi({});
    expect(await saveLine(api, { spaceId: "sp-household", plan, lineId: "l-home" }, { line: {} })).toEqual({
      ok: true,
      plan,
      lineId: "l-home",
    });
    expect(requests).toHaveLength(0);
  });

  it("stops at a refused line and keeps the plan it had", async () => {
    const { api } = fakeApi({
      "PATCH /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}": () => problemResponse(409, "BudgetLineNameTaken"),
    });
    const outcome = await saveLine(api, { spaceId: "sp-household", plan, lineId: "l-home" }, { line: { name: "Rent" } });
    expect(outcome).toMatchObject({ ok: false, plan, section: "line", problem: { code: "BudgetLineNameTaken" } });
  });

  it("removes a line with the plan's version", async () => {
    const { api, requests } = fakeApi({
      "DELETE /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}": () =>
        jsonResponse(referencePlanDto({ version: 8, lines: plan.lines.slice(0, 3) })),
    });
    const result = await removeLine(api, { spaceId: "sp-household", plan, lineId: "l-free" });
    expect(result.ok && result.plan.lines.map((l) => l.name)).toEqual(["Rent", "Home", "Savings"]);
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-household/plans/p-nov/lines/l-free");
    expect(requests[0]!.headers.get("if-match")).toBe('"7"');
  });
});
```

`src/modules/budgeting/ui/line-editor/line-editor.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { accountDto, cop, normalized } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import {
  householdDto,
  planLineDto,
  referencePlanDto,
  savingsAccountDto,
} from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { PlanLineDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { loadLineEditor } from "./line-editor-container";
import { LineEditor } from "./line-editor";

vi.mock("next/headers", () => ({}));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, notFound: vi.fn(), redirect: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

const ADD = "POST /api/v1/spaces/{spaceId}/plans/{planId}/lines";
const empty = referencePlanDto({ lines: [], planned: cop(0), unallocated: cop(4_000_000) });
const show = (line: PlanLineDto | null, api?: Api, plan = line ? referencePlanDto() : empty) =>
  renderWithIntl(
    <LineEditor
      space={householdDto()}
      plan={plan}
      line={line}
      savingsAccounts={[savingsAccountDto()]}
      formats={BUILT_IN_FORMATS}
      api={api}
    />,
  );
const added = () => jsonResponse(referencePlanDto({ version: 8 }), 201);

describe("line editor (HU-E9-08)", () => {
  it("adds Rent funded by the shared fund with rollover RESET (@golden)", async () => {
    const { api, requests } = fakeApi({ [ADD]: added });
    const { container } = show(null, api);
    expect(screen.getByRole("heading", { level: 1, name: "Nueva línea" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Nombre"), "Rent");
    await userEvent.type(screen.getByLabelText("Planeado"), "1.200.000");
    await userEvent.click(screen.getByRole("radio", { name: "Fondo compartido" }));
    expect(screen.getByRole("radio", { name: "Reinicia" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Agregar línea" }));
    expect(await requests[0]!.json()).toEqual({
      name: "Rent",
      plannedAmount: { amount: "120000000", currency: "COP" },
      funding: "SHARED_FUND",
      rolloverMode: "RESET",
      isCatchAll: false,
      savingsAccountIds: [],
    });
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-household/plans/p-nov");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("adds Savings with the savings account the person owns, never as the catch-all", async () => {
    const { api, requests } = fakeApi({ [ADD]: added });
    show(null, api);
    await userEvent.type(screen.getByLabelText("Nombre"), "Savings");
    await userEvent.type(screen.getByLabelText("Planeado"), "600.000");
    await userEvent.click(screen.getByRole("radio", { name: "Ahorro" }));
    expect(screen.queryByRole("switch", { name: "Todo lo demás" })).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: "Ahorros" }));
    await userEvent.click(screen.getByRole("button", { name: "Agregar línea" }));
    expect(await requests[0]!.json()).toMatchObject({ funding: "SAVINGS", isCatchAll: false, savingsAccountIds: ["a-savings"] });
  });

  it("marks Free as the catch-all line", async () => {
    const { api, requests } = fakeApi({ [ADD]: added });
    show(null, api);
    await userEvent.type(screen.getByLabelText("Nombre"), "Free");
    await userEvent.type(screen.getByLabelText("Planeado"), "730.000");
    await userEvent.click(screen.getByRole("switch", { name: "Todo lo demás" }));
    await userEvent.click(screen.getByRole("button", { name: "Agregar línea" }));
    expect(await requests[0]!.json()).toMatchObject({ name: "Free", isCatchAll: true });
  });

  it("shows Home's figures and patches only its planned amount", async () => {
    const { api, requests } = fakeApi({
      "PATCH /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}": () => jsonResponse(referencePlanDto({ version: 8 })),
    });
    show(planLineDto({ spent: cop(1_300_000), available: cop(170_000) }), api);
    const figures = normalized(screen.getByRole("region", { name: "Cifras de la línea" }).textContent);
    expect(figures).toContain("Planeado$ 1.470.000");
    expect(figures).toContain("Gastado$ 1.300.000");
    expect(figures).toContain("Disponible$ 170.000");
    expect(screen.getByText("36,75 % de la capacidad · sin asignar $ 0")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Planeado"));
    await userEvent.type(screen.getByLabelText("Planeado"), "1.500.000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar línea" }));
    expect(await requests[0]!.json()).toEqual({ plannedAmount: { amount: "150000000", currency: "COP" } });
  });

  it("shows a taken name next to the name field and stays", async () => {
    const { api } = fakeApi({ [ADD]: () => problemResponse(409, "BudgetLineNameTaken") });
    show(null, api);
    await userEvent.type(screen.getByLabelText("Nombre"), "Home");
    await userEvent.type(screen.getByLabelText("Planeado"), "100.000");
    await userEvent.click(screen.getByRole("button", { name: "Agregar línea" }));
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveAttribute("aria-invalid", "true"));
    expect(router.push).not.toHaveBeenCalled();
  });

  it("removes a line after its confirmation", async () => {
    const { api, requests } = fakeApi({
      "DELETE /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}": () => jsonResponse(referencePlanDto({ version: 8 })),
    });
    show(planLineDto({ id: "l-free", name: "Free" }), api);
    await userEvent.click(screen.getByRole("button", { name: "Quitar línea" }));
    const sheet = await screen.findByRole("dialog", { name: "¿Quitar Free?" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Quitar" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/spaces/sp-household/plans/p-nov"));
    expect(requests[0]!.method).toBe("DELETE");
  });

  it("offers only the caller's active savings accounts in the plan's currency (ruling P213)", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/plans/{planId}": () => jsonResponse(referencePlanDto()),
      "GET /api/v1/spaces/{spaceId}/accounts": () =>
        jsonResponse({
          items: [
            savingsAccountDto(),
            accountDto({ id: "a-bank", name: "Bancolombia" }),
            accountDto({ id: "a-old", name: "Old savings", type: "SAVINGS", archivedAt: "2026-10-01T12:00:00.000Z" }),
            accountDto({ id: "a-usd", name: "Dollars", type: "SAVINGS", balance: { amount: "0", currency: "USD" } }),
          ],
          totals: { available: cop(0), netWorth: cop(0) },
        }),
    });
    const result = await loadLineEditor(api, {
      spaceId: "sp-household",
      planId: "p-nov",
      lineId: "l-home",
      personalSpaceId: "sp-personal",
    });
    expect(result.ok && [result.data.line?.name, result.data.savingsAccounts.map((a) => a.name)]).toEqual([
      "Home",
      ["Ahorros"],
    ]);
  });
});
```


- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/ui/line-editor` and `pnpm exec vitest run --project ui src/modules/budgeting/ui/line-editor`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Implement**

`src/modules/budgeting/ui/line-editor/line-draft.ts`:

```ts
import type { MoneyDto, PlanLineDto } from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import { decimalOf, formatNumber, type Formats, type NumberFormat } from "@/shared/ui/format/formatters";

export type Funding = PlanLineDto["funding"];
export type RolloverMode = PlanLineDto["rolloverMode"];

export interface LineDraft {
  readonly name: string;
  readonly planned: string;
  readonly funding: Funding;
  readonly rolloverMode: RolloverMode;
  readonly isCatchAll: boolean;
  readonly savingsAccountIds: readonly string[];
}

/** HU-E6-03: a new line is DIRECT, RESET and not the catch-all until the person says otherwise. */
export const NEW_LINE: LineDraft = {
  name: "",
  planned: "",
  funding: "DIRECT",
  rolloverMode: "RESET",
  isCatchAll: false,
  savingsAccountIds: [],
};

export const lineDraftOf = (line: PlanLineDto | null, formats: Pick<Formats, "numberFormat">): LineDraft =>
  line === null
    ? NEW_LINE
    : {
        name: line.name,
        planned: formatNumber(
          decimalOf(line.plannedAmount.amount, currencyOf(line.plannedAmount.currency).exponent),
          formats,
        ),
        funding: line.funding,
        rolloverMode: line.rolloverMode,
        isCatchAll: line.isCatchAll,
        savingsAccountIds: line.savingsAccountIds,
      };

export interface LineBody {
  readonly name: string;
  readonly plannedAmount: MoneyDto;
  readonly funding: Funding;
  readonly rolloverMode: RolloverMode;
  readonly isCatchAll: boolean;
  readonly savingsAccountIds: string[];
}

/** Spec 5.4: a SAVINGS line consumes transfers into its accounts, so it is never the catch-all; others name none. */
export const lineBodyOf = (
  draft: LineDraft,
  currency: string,
  numberFormat: NumberFormat,
): { ok: true; body: LineBody } | { ok: false; field: "planned" } => {
  const decimal = parseDecimal(draft.planned, numberFormat);
  const minor = decimal === null ? null : minorOf(decimal, currencyOf(currency).exponent);
  if (minor === null) return { ok: false, field: "planned" };
  const savings = draft.funding === "SAVINGS";
  return {
    ok: true,
    body: {
      name: draft.name.trim(),
      plannedAmount: { amount: minor, currency },
      funding: draft.funding,
      rolloverMode: draft.rolloverMode,
      isCatchAll: savings ? false : draft.isCatchAll,
      savingsAccountIds: savings ? [...draft.savingsAccountIds] : [],
    },
  };
};

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/** HU-E6-03: an edit sends only the fields that changed (the PATCH keeps the rest). */
export const lineChanges = (line: PlanLineDto, body: LineBody): Partial<LineBody> => ({
  ...(body.name !== line.name ? { name: body.name } : {}),
  ...(body.plannedAmount.amount !== line.plannedAmount.amount ? { plannedAmount: body.plannedAmount } : {}),
  ...(body.funding !== line.funding ? { funding: body.funding } : {}),
  ...(body.rolloverMode !== line.rolloverMode ? { rolloverMode: body.rolloverMode } : {}),
  ...(body.isCatchAll !== line.isCatchAll ? { isCatchAll: body.isCatchAll } : {}),
  ...(!sameSet(body.savingsAccountIds, line.savingsAccountIds) ? { savingsAccountIds: body.savingsAccountIds } : {}),
});

export type LineField = "name" | "planned" | "savings" | "catchAll";

const BY_CODE: Readonly<Record<string, LineField>> = {
  BudgetLineNameTaken: "name",
  InvalidBudgetLineName: "name",
  InvalidPlannedAmount: "planned",
  PlanExceedsCapacity: "planned",
  CurrencyMismatch: "planned",
  SavingsAccountRequired: "savings",
  InvalidSavingsAccount: "savings",
  SavingsAccountAlreadyUsed: "savings",
  AccountNotFound: "savings",
  AccountArchived: "savings",
  CatchAllLineAlreadySet: "catchAll",
  SavingsLineNotMappable: "catchAll",
};
const BY_PATH: Readonly<Record<string, LineField>> = {
  name: "name",
  plannedAmount: "planned",
  savingsAccountIds: "savings",
  isCatchAll: "catchAll",
};

/** Ruling P118: a code or a validation path names its field; anything else is shown above the button. */
export const lineFieldOf = (problem: Problem): LineField | "form" =>
  BY_CODE[problem.code] ?? BY_PATH[problem.errors[0]?.path.split(".")[0] ?? ""] ?? "form";
```

`src/modules/budgeting/ui/line-editor/line-save.ts`:

```ts
import type { Api } from "@/shared/ui/api/client";
import type { BudgetPlanDto } from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import { ifMatch, planWrite, type PlanWrite } from "../plan-write";
import type { LineBody } from "./line-draft";

export type LineSection = "line" | "categories" | "allocation";

/** What one save sends; `null` means "nothing to send" for that step. */
export interface LineSave {
  readonly line: Partial<LineBody> | LineBody | null;
}

export type SaveOutcome =
  | { readonly ok: true; readonly plan: BudgetPlanDto; readonly lineId: string }
  | {
      readonly ok: false;
      readonly plan: BudgetPlanDto;
      readonly section: LineSection;
      readonly problem: Problem;
      readonly lineIds: readonly string[];
    };

/** The line an add created: the one the answer has and the plan before it had not. */
export const newLineId = (before: BudgetPlanDto, after: BudgetPlanDto): string =>
  after.lines.find((line) => !before.lines.some((old) => old.id === line.id))?.id ?? after.lines.at(-1)!.id;

/**
 * Ruling P210: the steps run in order, each only when it has something to send and each with the version the step
 * before answered; the first failure stops the sequence and keeps what was already saved.
 */
export const saveLine = async (
  api: Api,
  { spaceId, plan, lineId }: { spaceId: string; plan: BudgetPlanDto; lineId: string | null },
  save: LineSave,
): Promise<SaveOutcome> => {
  const path = { spaceId, planId: plan.id };
  let current = plan;
  let id = lineId;
  if (save.line !== null && (id === null || Object.keys(save.line).length > 0)) {
    const result: PlanWrite =
      id === null
        ? await planWrite(
            api.POST("/api/v1/spaces/{spaceId}/plans/{planId}/lines", {
              params: { path },
              headers: ifMatch(current),
              body: save.line as LineBody,
            }),
          )
        : await planWrite(
            api.PATCH("/api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}", {
              params: { path: { ...path, lineId: id } },
              headers: ifMatch(current),
              body: save.line,
            }),
          );
    if (!result.ok) return { ok: false, plan: current, section: "line", problem: result.problem, lineIds: result.lineIds };
    id ??= newLineId(current, result.plan);
    current = result.plan;
  }
  return { ok: true, plan: current, lineId: id! };
};

/** HU-E6-03: removing a line (logically, D8), with the plan's version. */
export const removeLine = (
  api: Api,
  { spaceId, plan, lineId }: { spaceId: string; plan: BudgetPlanDto; lineId: string },
): Promise<PlanWrite> =>
  planWrite(
    api.DELETE("/api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}", {
      params: { path: { spaceId, planId: plan.id, lineId } },
      headers: ifMatch(plan),
    }),
  );
```

(`newLineId` runs after `id ??=` only for an add; on an add `id` is null before it.)

`src/modules/budgeting/ui/line-editor/line-editor.tsx` (`"use client"`). The LineEditor artboard as a page:
- A back link `budgeting.lineEditor.back` to the planner, and the `h1` `budgeting.lineEditor.title` with `{name}`, or `budgeting.lineEditor.newTitle` for a new line.
- For an existing line, a `section` labelled by a visually hidden `h2` `budgeting.lineEditor.figures`, with three `dl` pairs: `reports.lines.planned`, `reports.lines.spent` and `reports.lines.available`, from `plannedAmount`, `spent` and `available`.
- A `TextField` `budgeting.lineEditor.field.name`.
- A `TextField` `budgeting.lineEditor.field.planned` (`inputMode="decimal"`). Its hint is `budgeting.lineEditor.field.plannedHint` with `{share}` (`formatPercent(line.capacityShare)`) and `{unallocated}` (`formatMoney(plan.unallocated)`), or `budgeting.lineEditor.field.plannedNewHint` with `{unallocated}` for a new line or a line without a share.
- A `ChoiceGroup layout="segmented"` `budgeting.lineEditor.field.funding` over the three fundings (`budgeting.funding.*`).
- For SAVINGS, a `fieldset` whose `legend` is `budgeting.lineEditor.field.savingsAccounts`. Inside it:
  - one checkbox per `savingsAccounts` entry (a native `input type="checkbox"` inside a 44 px `label` with the account's name);
  - one checked checkbox per id the line names that is not among the caller's own, labelled `budgeting.lineEditor.field.otherAccount`, so it is kept unless unchecked;
  - when the caller owns none, the `p` `budgeting.lineEditor.field.noSavingsAccounts` with `{currency}`;
  - the field's error.
- A `ChoiceGroup layout="segmented"` `budgeting.lineEditor.field.rollover` over the rollover modes (`budgeting.rollover.*`).
- Unless SAVINGS, a `Switch` `budgeting.lineEditor.field.catchAll` with the description `budgeting.lineEditor.field.catchAllHint` and its error.
- A form-level problem (`ProblemNotice`-like, from `useProblemMessage`).
- The `lg` button: `budgeting.lineEditor.save` for an existing line, `budgeting.lineEditor.add` for a new one.
- For an existing line, a `Button variant="danger"` `budgeting.lineEditor.remove.open`. It opens a `Sheet` titled `budgeting.lineEditor.remove.title` with `{name}`, described by `budgeting.lineEditor.remove.explain`, whose footer button `budgeting.lineEditor.remove.confirm` calls `removeLine`. On success it goes back to the planner.

Saving does the following:
1. `lineBodyOf(draft, plan.totalCapacity.currency, formats.numberFormat)`. If it is not ok, the planned field shows `budgeting.lineEditor.unreadable` with `{example}`, and nothing is sent.
2. `saveLine(api, { spaceId: space.id, plan, lineId: line?.id ?? null }, { line: line ? lineChanges(line, body) : body })`.
3. On `ok`: `router.push(\`/spaces/${space.id}/plans/${plan.id}\`)` and `router.refresh()`.
4. On a failure: keep `outcome.plan`.
   - `PreconditionFailed` shows its message above the button, re-reads the plan and keeps the draft.
   - Any other problem goes to `lineFieldOf(outcome.problem)`.

The button is disabled while saving.

`src/modules/budgeting/ui/line-editor/line-editor-container.tsx`:
- `loadLineEditor` reads the plan and `GET /api/v1/spaces/{personalSpaceId}/accounts` in parallel.
- `line` is `lineId === null ? null : plan.lines.find((l) => l.id === lineId) ?? notFound()`.
- `savingsAccounts` keeps `type === "SAVINGS" && archivedAt === null && balance.currency === plan.totalCapacity.currency`.
- `LineEditorContainer({ spaceId, planId, lineId })` gets `me` and the spaces, finds the space, takes `personalSpaceOf(spaces).id`, and renders the editor.
- When the viewer cannot manage or the plan is CLOSED (`!canManage(space.role) || !isEditable(plan)`), it renders the `p` `budgeting.lineEditor.readOnly` and a link back to the planner instead of the editor.

`budgeting/ui/server.ts` gains `export { LineEditorContainer } from "./line-editor/line-editor-container";`.

Pages:
- `…/plans/[planId]/lines/new/page.tsx`: `<LineEditorContainer spaceId={spaceId} planId={planId} lineId={null} />`, title `budgeting.lineEditor.newTitle`;
- `…/plans/[planId]/lines/[lineId]/page.tsx`: the same with the `lineId` param, title `budgeting.lineEditor.metaTitle`.

Catalog keys (`budgeting.lineEditor`), es / en:
- `back` Volver al plan / Back to the plan; `metaTitle` Editar línea / Edit line;
- `title` Línea {name} / Line {name}; `newTitle` Nueva línea / New line;
- `figures` Cifras de la línea / Line figures;
- `field`:
  - `name` Nombre / Name; `planned` Planeado / Planned;
  - `plannedHint` {share} de la capacidad · sin asignar {unallocated} / {share} of capacity · {unallocated} unallocated;
  - `plannedNewHint` Sin asignar: {unallocated} / Unallocated: {unallocated};
  - `funding` De dónde sale / Where it comes from;
  - `savingsAccounts` Cuentas de ahorro / Savings accounts;
  - `otherAccount` Cuenta de ahorro de otro miembro / Another member's savings account;
  - `noSavingsAccounts` No tienes cuentas de ahorro en {currency}. Crea una en Cuentas. / You have no savings accounts in {currency}. Create one in Accounts.;
  - `rollover` Al cambiar de período / When the period changes;
  - `catchAll` Todo lo demás / Everything else;
  - `catchAllHint` Recibe los gastos de categorías que no están en otra línea. / Takes the expenses of categories that are in no other line.;
- `unreadable` Escribe un monto como {example}. / Type an amount like {example}.;
- `save` Guardar línea / Save line; `add` Agregar línea / Add line;
- `remove`:
  - `open` Quitar línea / Remove line; `title` ¿Quitar {name}? / Remove {name}?;
  - `explain` La línea sale del plan y sus gastos pasan a Sin presupuesto o a la línea de todo lo demás. / The line leaves the plan, and its expenses go to Unbudgeted or to the everything-else line.;
  - `confirm` Quitar / Remove;
- `readOnly` Solo Propietario y Administrador editan las líneas de un plan abierto. / Only an Owner or an Admin edits the lines of an open plan.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/budgeting/ui "src/app/(web)/(app)/spaces/[spaceId]/plans/[planId]/lines" \
  tests/support/ui/plan-dto.ts src/i18n/messages
git commit -m "feat(budgeting): add, edit and remove plan lines with their funding and rollover (Refs #76)"
```

If the staged candidate is over ~500 lines, commit it in two passes at the named split point:
1. `line-draft.ts`, `line-save.ts` and their tests: `feat(budgeting): build plan line requests and save them in conditional steps (Refs #76)`;
2. the editor, its container, the pages, the builder and the catalog keys: `feat(budgeting): add, edit and remove plan lines with their funding and rollover (Refs #76)`.

---

### Task 8: The line editor: categories and the allocation editor with its preview

The LineEditor artboard's lower half, and these HU-E9-08 scenarios: "The allocation editor previews assigned amounts and rejects bad sums" and "A line can be left unallocated". It also covers the technical note on mapping ("a multi-select limited to active categories of the same space").
- **Categories.** They are chosen in a sheet of checkboxes: live parent categories only. A category another line maps is disabled and names that line (ruling P212). A savings line takes no categories.
- **Allocation.** The rule is one of By capacity, Percentage, Fixed amount and Not allocated. Each member's row previews what they are assigned, computed exactly as the server's `Money.allocate` rounds (ruling P211). A sum other than 100 % or the planned amount shows `errors.InvalidAllocation` with the sum, and blocks the save. Not allocated shows no member rows.

Saving runs the remaining steps of `saveLine`: categories, then allocation, each with the version the step before answered.

**Files:**
- Create: `src/modules/budgeting/ui/line-editor/{allocation.ts, allocation.test.ts, allocation-editor.tsx, allocation-editor.test.tsx, category-mapping-sheet.tsx, category-mapping.test.tsx}`
- Modify: `src/modules/budgeting/ui/line-editor/{line-save.ts, line-save.test.ts, line-editor.tsx, line-editor.test.tsx, line-editor-container.tsx}`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `currencyOf(...).roundingUnit` (Task 2), `parseDecimal`, `minorOf`, `decimalOf`, `formatNumber`, `formatMoney`, `formatPercent`; `activeTree`, `matches`, `CategoryIcon` (`categories/ui`); `Sheet`, `ChoiceGroup`, `TextField`, `useProblemMessage`; `saveLine`, `LineSave` (Task 7).
- Produces:
  - `allocation.ts`:
    - `type AllocationRule`;
    - `interface AllocationDraft { rule: AllocationRule; values: Readonly<Record<string, string>> }`;
    - `allocationDraftOf(line: PlanLineDto | null, formats): AllocationDraft`;
    - `allocate(total: bigint, weights: readonly bigint[], roundingUnit: bigint): bigint[]`;
    - `type Preview = { kind: "none" } | { kind: "assigned"; amounts: Readonly<Record<string, string>> } | { kind: "invalid"; sum: string; unit: "percent" | "money" } | { kind: "noCapacity" } | { kind: "unreadable"; memberId: string }`;
    - `previewOf(draft, input: { planned: string; currency: string; members: readonly { memberId: string; capacity: string }[]; numberFormat }): Preview`;
    - `type AllocationBody` (the `PUT …/allocation` body);
    - `allocationBodyOf(draft, memberIds, currency, numberFormat): AllocationBody | null` (null unless the preview is `assigned` or `none`);
    - `allocationChanged(line: PlanLineDto | null, body: AllocationBody): boolean`.
  - `AllocationEditor({ draft, onChange, preview, members, formats, currency, planned })` (client).
  - `CategoryMappingSheet({ open, onOpenChange, groups, plan, lineId, lineName, value, onChange })` (client).
  - `LineSave` gains `categoryIds: readonly string[] | null` and `allocation: AllocationBody | null`.
  - `LineEditor` gains the props `groups: CategoryGroupDto[]` and `members: SpaceMemberDto[]`; `loadLineEditor` also reads the categories and the members.

- [ ] **Step 1: Write the failing tests**

`src/modules/budgeting/ui/line-editor/allocation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel";
import { planLineDto } from "../../../../../tests/support/ui/plan-dto";
import { currencyOf } from "@/shared/ui/format/currencies";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { allocate, allocationBodyOf, allocationChanged, allocationDraftOf, previewOf } from "./allocation";

const free = {
  planned: "73000000",
  currency: "COP",
  members: [
    { memberId: "m-ana", capacity: "160000000" },
    { memberId: "m-juan", capacity: "240000000" },
  ],
  numberFormat: "DOT_COMMA" as const,
};

describe("allocation preview (HU-E9-08, ruling P211)", () => {
  it("allocates exactly as the kernel's Money.allocate does", () => {
    const cases: [bigint, bigint[], string][] = [
      [73_000_000n, [4_200n, 5_800n], "COP"],
      [100_000n, [1n, 1n, 1n], "COP"],
      [100_001n, [1n, 1n, 1n], "USD"],
      [147_000_000n, [160_000_000n, 240_000_000n], "COP"],
      [73_000_000n, [3_333n, 3_333n, 3_334n], "COP"],
    ];
    for (const [total, weights, currency] of cases) {
      const money = Money.ofMinor(total, currency);
      if (!money.ok) throw new Error(currency);
      const kernel = money.value.allocate(weights);
      if (!kernel.ok) throw new Error("allocate");
      expect(allocate(total, weights, currencyOf(currency).roundingUnit)).toEqual(kernel.value.map((m) => m.minor));
    }
  });

  it("previews Free at 42 % / 58 % as 306.600 and 423.400, and a sum of 99 % as invalid", () => {
    expect(previewOf({ rule: "PERCENT", values: { "m-ana": "42", "m-juan": "58" } }, free)).toEqual({
      kind: "assigned",
      amounts: { "m-ana": "30660000", "m-juan": "42340000" },
    });
    expect(previewOf({ rule: "PERCENT", values: { "m-ana": "42", "m-juan": "57" } }, free)).toEqual({
      kind: "invalid",
      sum: "99.00",
      unit: "percent",
    });
  });

  it("follows capacities, checks fixed amounts to the peso, and shows nothing per member for NONE", () => {
    expect(previewOf({ rule: "PROPORTIONAL", values: {} }, free)).toEqual({
      kind: "assigned",
      amounts: { "m-ana": "29200000", "m-juan": "43800000" },
    });
    expect(previewOf({ rule: "FIXED", values: { "m-ana": "300.000", "m-juan": "430.001" } }, free)).toEqual({
      kind: "invalid",
      sum: "73000100",
      unit: "money",
    });
    expect(previewOf({ rule: "NONE", values: {} }, free)).toEqual({ kind: "none" });
    expect(previewOf({ rule: "PROPORTIONAL", values: {} }, { ...free, members: [] })).toEqual({ kind: "noCapacity" });
    expect(previewOf({ rule: "PERCENT", values: { "m-ana": "cuarenta" } }, free)).toEqual({ kind: "unreadable", memberId: "m-ana" });
  });

  it("sends the members with a value, and knows when the stored allocation already says it", () => {
    expect(allocationBodyOf({ rule: "PERCENT", values: { "m-ana": "42", "m-juan": "58" } }, ["m-ana", "m-juan"], "COP", "DOT_COMMA")).toEqual({
      rule: "PERCENT",
      members: [
        { memberId: "m-ana", percent: "42" },
        { memberId: "m-juan", percent: "58" },
      ],
    });
    expect(allocationBodyOf({ rule: "FIXED", values: { "m-ana": "300.000", "m-juan": "430.000" } }, ["m-ana", "m-juan"], "COP", "DOT_COMMA")).toEqual({
      rule: "FIXED",
      members: [
        { memberId: "m-ana", amount: { amount: "30000000", currency: "COP" } },
        { memberId: "m-juan", amount: { amount: "43000000", currency: "COP" } },
      ],
    });
    expect(allocationBodyOf({ rule: "PERCENT", values: { "m-ana": "42", "m-juan": "57" } }, ["m-ana", "m-juan"], "COP", "DOT_COMMA")).toBeNull();
    const home = planLineDto();
    expect(allocationDraftOf(home, BUILT_IN_FORMATS)).toEqual({ rule: "PROPORTIONAL", values: {} });
    expect(allocationChanged(home, { rule: "PROPORTIONAL" })).toBe(false);
    expect(allocationChanged(home, { rule: "NONE" })).toBe(true);
    expect(allocationChanged(null, { rule: "PROPORTIONAL" })).toBe(false);
  });
});
```

(The kernel import is a test-only read; dependency-cruiser excludes test files.)

`src/modules/budgeting/ui/line-editor/allocation-editor.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../../tests/support/ui/dto";
import { HOUSEHOLD_MEMBERS } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { previewOf, type AllocationDraft } from "./allocation";
import { AllocationEditor } from "./allocation-editor";

function Harness() {
  const [draft, setDraft] = useState<AllocationDraft>({ rule: "PROPORTIONAL", values: {} });
  const preview = previewOf(draft, {
    planned: "73000000",
    currency: "COP",
    members: [
      { memberId: "m-ana", capacity: "160000000" },
      { memberId: "m-juan", capacity: "240000000" },
    ],
    numberFormat: "DOT_COMMA",
  });
  return (
    <AllocationEditor
      draft={draft}
      onChange={setDraft}
      preview={preview}
      members={HOUSEHOLD_MEMBERS}
      formats={BUILT_IN_FORMATS}
      currency="COP"
      planned={cop(730_000)}
    />
  );
}

describe("allocation editor (HU-E9-08)", () => {
  it("previews 306.600 and 423.400 at 42 % / 58 %, and the 99 % sum with errors.InvalidAllocation", async () => {
    const { container } = renderWithIntl(<Harness />);
    await userEvent.click(screen.getByRole("radio", { name: "Porcentaje" }));
    await userEvent.type(screen.getByLabelText("Valor de Ana"), "42");
    await userEvent.type(screen.getByLabelText("Valor de Juan"), "58");
    expect(normalized(screen.getByRole("group", { name: "Ana" }).textContent)).toContain("$ 306.600");
    expect(normalized(screen.getByRole("group", { name: "Juan" }).textContent)).toContain("$ 423.400");
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.clear(screen.getByLabelText("Valor de Juan"));
    await userEvent.type(screen.getByLabelText("Valor de Juan"), "57");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("El reparto de esta línea no cuadra.");
    expect(normalized(alert.textContent)).toContain("Suma: 99,00 %");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows no member rows when the line is left unallocated", async () => {
    renderWithIntl(<Harness />);
    expect(normalized(screen.getByRole("group", { name: "Ana" }).textContent)).toContain("$ 292.000");
    await userEvent.click(screen.getByRole("radio", { name: "Sin asignar" }));
    expect(screen.queryByRole("group", { name: "Ana" })).toBeNull();
    expect(
      within(screen.getByRole("region", { name: "Quién responde por la línea" })).getByText(/sin montos por miembro/),
    ).toBeInTheDocument();
  });
});
```

`src/modules/budgeting/ui/line-editor/category-mapping.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { categoryDto, groupDto } from "../../../../../tests/support/ui/dto";
import { planLineDto, referencePlanDto } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { CategoryMappingSheet } from "./category-mapping-sheet";

const groups = [
  groupDto({
    id: "g-home",
    name: "Hogar",
    categories: [
      categoryDto({
        id: "c-groceries",
        name: "Groceries",
        subcategories: [categoryDto({ id: "c-veg", name: "Vegetables", parentCategoryId: "c-groceries" })],
      }),
      categoryDto({ id: "c-utilities", name: "Utilities" }),
      categoryDto({ id: "c-rent", name: "Rent" }),
      categoryDto({ id: "c-old", name: "Old", archivedAt: "2026-10-01T00:00:00.000Z" }),
    ],
  }),
];
const plan = referencePlanDto({
  lines: [
    planLineDto({ id: "l-rent", name: "Rent", categoryIds: ["c-rent"] }),
    planLineDto({ categoryIds: ["c-groceries"] }),
  ],
});

describe("category mapping (HU-E9-08, ruling P212)", () => {
  it("offers live parent categories only, disables another line's and returns the chosen ones", async () => {
    const onChange = vi.fn();
    renderWithIntl(
      <CategoryMappingSheet
        open
        onOpenChange={() => undefined}
        groups={groups}
        plan={plan}
        lineId="l-home"
        lineName="Home"
        value={["c-groceries"]}
        onChange={onChange}
      />,
    );
    const sheet = await screen.findByRole("dialog", { name: "Categorías de Home" });
    expect(within(sheet).getByRole("checkbox", { name: "Groceries" })).toBeChecked();
    expect(within(sheet).queryByRole("checkbox", { name: "Vegetables" })).toBeNull();
    expect(within(sheet).queryByRole("checkbox", { name: "Old" })).toBeNull();
    const rent = within(sheet).getByRole("checkbox", { name: "Rent" });
    expect(rent).toBeDisabled();
    expect(rent).toHaveAccessibleDescription("En Rent");
    await userEvent.click(within(sheet).getByRole("checkbox", { name: "Utilities" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Listo" }));
    expect(onChange).toHaveBeenCalledWith(["c-groceries", "c-utilities"]);
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
```

`src/modules/budgeting/ui/line-editor/line-save.test.ts`: add to the `describe`:

```ts
  it("maps the categories and allocates after the line, each with the version the step before answered", async () => {
    let version = 7;
    const next = () => jsonResponse(referencePlanDto({ version: ++version }));
    const { api, requests } = fakeApi({
      "PATCH /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}": next,
      "PUT /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/categories": next,
      "PUT /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/allocation": next,
    });
    const outcome = await saveLine(
      api,
      { spaceId: "sp-household", plan, lineId: "l-home" },
      { line: { name: "Casa" }, categoryIds: ["c-groceries", "c-utilities"], allocation: { rule: "NONE" } },
    );
    expect(outcome).toMatchObject({ ok: true, lineId: "l-home", plan: { version: 10 } });
    expect(requests.map((r) => [r.method, r.headers.get("if-match")])).toEqual([
      ["PATCH", '"7"'],
      ["PUT", '"8"'],
      ["PUT", '"9"'],
    ]);
    expect(await requests[1]!.json()).toEqual({ categoryIds: ["c-groceries", "c-utilities"] });
  });

  it("stops at a refused allocation and keeps the plan the line step answered", async () => {
    const patched = referencePlanDto({ version: 8 });
    const { api } = fakeApi({
      "PATCH /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}": () => jsonResponse(patched),
      "PUT /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/allocation": () => problemResponse(422, "InvalidAllocation"),
    });
    const outcome = await saveLine(
      api,
      { spaceId: "sp-household", plan, lineId: "l-home" },
      { line: { name: "Casa" }, categoryIds: null, allocation: { rule: "NONE" } },
    );
    expect(outcome).toMatchObject({ ok: false, plan: patched, section: "allocation", problem: { code: "InvalidAllocation" } });
  });
```

and change the existing calls' save objects to carry `categoryIds: null, allocation: null` (for example `{ line: pets, categoryIds: null, allocation: null }`).

`src/modules/budgeting/ui/line-editor/line-editor.test.tsx`:
- add `groups={[]}` and `members={HOUSEHOLD_MEMBERS}` to `show`'s props, and add `HOUSEHOLD_MEMBERS` to the builders import;
- in `loadLineEditor`'s test, add the routes `"GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: [] })` and `"GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: HOUSEHOLD_MEMBERS })`;
- append:

```tsx
  it("leaves Free unallocated: its figures stay, its member rows go, and the save sends NONE", async () => {
    const { api, requests } = fakeApi({
      "PUT /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/allocation": () => jsonResponse(referencePlanDto({ version: 8 })),
    });
    show(planLineDto({ id: "l-free", name: "Free", plannedAmount: cop(730_000), spent: cop(250_000), available: cop(480_000), capacityShare: "18.25" }), api);
    await userEvent.click(screen.getByRole("radio", { name: "Sin asignar" }));
    expect(screen.queryByRole("group", { name: "Ana" })).toBeNull();
    const figures = normalized(screen.getByRole("region", { name: "Cifras de la línea" }).textContent);
    expect(figures).toContain("Planeado$ 730.000");
    expect(figures).toContain("Gastado$ 250.000");
    expect(figures).toContain("Disponible$ 480.000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar línea" }));
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
      "/api/v1/spaces/sp-household/plans/p-nov/lines/l-free/allocation",
    ]);
    expect(await requests[0]!.json()).toEqual({ rule: "NONE" });
  });

  it("blocks the save while the percentages do not add up to 100 %", async () => {
    const { api, requests } = fakeApi({});
    show(planLineDto({ id: "l-free", name: "Free", plannedAmount: cop(730_000) }), api);
    await userEvent.click(screen.getByRole("radio", { name: "Porcentaje" }));
    await userEvent.type(screen.getByLabelText("Valor de Ana"), "42");
    await userEvent.type(screen.getByLabelText("Valor de Juan"), "57");
    await userEvent.click(screen.getByRole("button", { name: "Guardar línea" }));
    expect(screen.getByRole("alert")).toHaveTextContent("El reparto de esta línea no cuadra.");
    expect(requests).toHaveLength(0);
  });
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/budgeting/ui/line-editor` and `pnpm exec vitest run --project ui src/modules/budgeting/ui/line-editor`
Expected: FAIL — `./allocation`, `./allocation-editor` and `./category-mapping-sheet` do not exist, and `saveLine` sends no categories or allocation.

- [ ] **Step 3: Implement**

`src/modules/budgeting/ui/line-editor/allocation.ts`:

```ts
import type { MoneyDto, PlanLineDto } from "@/shared/ui/api/dto";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import { decimalOf, formatNumber, type Formats, type NumberFormat } from "@/shared/ui/format/formatters";

export type AllocationRule = PlanLineDto["allocation"]["rule"];

/** What the person typed per member: a percentage (PERCENT) or an amount (FIXED), in their number format. */
export interface AllocationDraft {
  readonly rule: AllocationRule;
  readonly values: Readonly<Record<string, string>>;
}

const WHOLE = 10_000n; // 100 % in basis points, as the server counts (HU-E6-05)

export const allocationDraftOf = (line: PlanLineDto | null, formats: Pick<Formats, "numberFormat">): AllocationDraft => {
  if (line === null) return { rule: "PROPORTIONAL", values: {} };
  const { rule, members } = line.allocation;
  const values = Object.fromEntries(
    members.flatMap((m) => {
      if (rule === "PERCENT" && m.percent !== null) return [[m.memberId, formatNumber(m.percent, formats)]];
      if (rule === "FIXED" && m.amount !== null)
        return [[m.memberId, formatNumber(decimalOf(m.amount.amount, currencyOf(m.amount.currency).exponent), formats)]];
      return [];
    }),
  );
  return { rule, values };
};

/**
 * Ruling P211: the kernel's `Money.allocate`, mirrored: whole rounding units shared by largest remainder (ties to
 * the earlier weight) and the sub-unit remainder on the first part. The caller passes a positive total weight.
 */
export const allocate = (total: bigint, weights: readonly bigint[], roundingUnit: bigint): bigint[] => {
  if (total < 0n) return allocate(-total, weights, roundingUnit).map((part) => -part);
  const totalWeight = weights.reduce((a, b) => a + b, 0n);
  const units = total / roundingUnit;
  const subUnit = total % roundingUnit;
  const shares = weights.map((w, index) => ({ index, base: (units * w) / totalWeight, rem: (units * w) % totalWeight }));
  let leftover = units - shares.reduce((sum, s) => sum + s.base, 0n);
  const order = [...shares].sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
  for (const share of order) {
    if (leftover <= 0n) break;
    share.base += 1n;
    leftover -= 1n;
  }
  return shares.map((s) => s.base * roundingUnit + (s.index === 0 ? subUnit : 0n));
};

export type Preview =
  | { readonly kind: "none" }
  | { readonly kind: "assigned"; readonly amounts: Readonly<Record<string, string>> }
  | { readonly kind: "invalid"; readonly sum: string; readonly unit: "percent" | "money" }
  | { readonly kind: "noCapacity" }
  | { readonly kind: "unreadable"; readonly memberId: string };

/** Each typed value as basis points (PERCENT) or minor units (FIXED); null when unreadable; empty is 0. */
const valuesOf = (
  draft: AllocationDraft,
  memberIds: readonly string[],
  exponent: number,
  numberFormat: NumberFormat,
): { memberId: string; value: bigint }[] | { unreadable: string } => {
  const scale = draft.rule === "PERCENT" ? 2 : exponent;
  const out: { memberId: string; value: bigint }[] = [];
  for (const memberId of memberIds) {
    const text = (draft.values[memberId] ?? "").trim();
    if (text === "") {
      out.push({ memberId, value: 0n });
      continue;
    }
    const decimal = parseDecimal(text, numberFormat);
    const minor = decimal === null ? null : minorOf(decimal, scale);
    if (minor === null) return { unreadable: memberId };
    out.push({ memberId, value: BigInt(minor) });
  }
  return out;
};

/** HU-E6-05: what each current member would be assigned, before the server confirms it on save. */
export const previewOf = (
  draft: AllocationDraft,
  input: {
    readonly planned: string;
    readonly currency: string;
    readonly members: readonly { readonly memberId: string; readonly capacity: string }[];
    readonly numberFormat: NumberFormat;
  },
): Preview => {
  if (draft.rule === "NONE") return { kind: "none" };
  const { exponent, roundingUnit } = currencyOf(input.currency);
  const planned = BigInt(input.planned);
  const ids = input.members.map((m) => m.memberId);
  const weights =
    draft.rule === "PROPORTIONAL"
      ? input.members.map((m) => ({ memberId: m.memberId, value: BigInt(m.capacity) }))
      : valuesOf(draft, ids, exponent, input.numberFormat);
  if ("unreadable" in weights) return { kind: "unreadable", memberId: weights.unreadable };
  const sum = weights.reduce((total, w) => total + w.value, 0n);
  if (draft.rule === "PERCENT" && sum !== WHOLE) return { kind: "invalid", sum: decimalOf(String(sum), 2), unit: "percent" };
  if (draft.rule === "FIXED") {
    if (sum !== planned) return { kind: "invalid", sum: String(sum), unit: "money" };
    return { kind: "assigned", amounts: Object.fromEntries(weights.map((w) => [w.memberId, String(w.value)])) };
  }
  const weighted = weights.filter((w) => w.value > 0n);
  if (weighted.length === 0) return { kind: "noCapacity" };
  const parts = allocate(planned, weighted.map((w) => w.value), roundingUnit);
  return {
    kind: "assigned",
    amounts: Object.fromEntries(
      weights.map((w) => [w.memberId, String(parts[weighted.indexOf(w)] ?? 0n)]),
    ),
  };
};

export type AllocationBody =
  | { rule: "PROPORTIONAL" }
  | { rule: "NONE" }
  | { rule: "PERCENT"; members: { memberId: string; percent: string }[] }
  | { rule: "FIXED"; members: { memberId: string; amount: MoneyDto }[] };

/** The PUT body: only members with a value; null while the values do not hold (the save is blocked). */
export const allocationBodyOf = (
  draft: AllocationDraft,
  memberIds: readonly string[],
  currency: string,
  numberFormat: NumberFormat,
): AllocationBody | null => {
  if (draft.rule === "PROPORTIONAL" || draft.rule === "NONE") return { rule: draft.rule };
  const values = valuesOf(draft, memberIds, currencyOf(currency).exponent, numberFormat);
  if ("unreadable" in values) return null;
  const listed = values.filter((v) => v.value > 0n);
  const sum = listed.reduce((total, v) => total + v.value, 0n);
  if (draft.rule === "PERCENT") {
    if (sum !== WHOLE) return null;
    return {
      rule: "PERCENT",
      members: listed.map((v) => ({ memberId: v.memberId, percent: parseDecimal(draft.values[v.memberId]!, numberFormat)! })),
    };
  }
  return { rule: "FIXED", members: listed.map((v) => ({ memberId: v.memberId, amount: { amount: String(v.value), currency } })) };
};

/** Whether `body` would change what the line stores; a new line's PROPORTIONAL default sends nothing. */
export const allocationChanged = (line: PlanLineDto | null, body: AllocationBody): boolean => {
  if (line === null) return body.rule !== "PROPORTIONAL";
  if (line.allocation.rule !== body.rule) return true;
  if (body.rule === "PROPORTIONAL" || body.rule === "NONE") return false;
  const stored = new Map(
    line.allocation.members.map((m) => [
      m.memberId,
      body.rule === "PERCENT" ? (m.percent === null ? null : minorOf(m.percent, 2)) : (m.amount?.amount ?? null),
    ]),
  );
  const sent =
    body.rule === "PERCENT"
      ? body.members.map((m) => [m.memberId, minorOf(m.percent, 2)] as const)
      : body.members.map((m) => [m.memberId, m.amount.amount] as const);
  return sent.length !== [...stored.values()].filter((v) => v !== null && v !== "0").length ||
    sent.some(([id, value]) => stored.get(id) !== value);
};
```

(The first test checks `previewOf` against the story's numbers. If Prettier reflows the last `return`, keep its logic: it is a change when the counts of non-zero stored values and sent values differ, or when any sent value differs.)

`src/modules/budgeting/ui/line-editor/allocation-editor.tsx` (`"use client"`). A `section` labelled by its `h2` `budgeting.allocation.title`:
- A `ChoiceGroup layout="grid"` labelled `budgeting.allocation.rule`, with the four rules (`budgeting.rule.*`).
- Unless the rule is NONE, one `div role="group"` per member, `aria-labelledby` the member's name. Each holds:
  - for PERCENT, a `TextField` labelled `budgeting.allocation.value` with `{name}` (`inputMode="decimal"`, `trailing` "%");
  - for FIXED, the same field with `inputMode="decimal"` and no trailing sign;
  - on the right, the preview's amount for that member (`formatMoney`), or "—" when the preview is not `assigned`;
  - for an `unreadable` preview, the error `budgeting.allocation.unreadable` on its field.
- The rule's note: `budgeting.allocation.note.<rule>`. The FIXED note takes `{planned}` (`formatMoney(planned)`).
- For an `invalid` preview, a `div role="alert"` with the message of `errors.InvalidAllocation` (`useProblemMessage()` of `{ code: "InvalidAllocation", … }`) and `budgeting.allocation.sum`. Its `{sum}` is `formatPercent(sum)` for `percent` and `formatMoney({ amount: sum, currency })` for `money`.
- For `noCapacity`, a `div role="alert"` with `budgeting.allocation.noCapacity`.

`src/modules/budgeting/ui/line-editor/category-mapping-sheet.tsx` (`"use client"`). A `Sheet` titled `budgeting.mapping.title` with `{line}`:
- A search `TextField` `budgeting.mapping.search`.
- One `fieldset` per group of `activeTree(groups)` that still has categories after the search (`matches`), with the group name as its `legend`.
- In each, one checkbox per live parent category. Subcategories are never offered (HU-E3-04: a subcategory follows its parent). Each checkbox:
  - is a native `input type="checkbox"` in a 44 px `label`, with the `CategoryIcon` and the name;
  - is checked when its id is in the local selection (`value` at first);
  - is disabled when another line of `plan` maps the category, and is then described by a `span` `budgeting.mapping.inOtherLine` with `{line}` (`aria-describedby`).
- A footer `Button` `budgeting.mapping.done` that calls `onChange` with the selection, kept in the tree's order, and closes the sheet.

`line-save.ts`:
- `LineSave` becomes `{ readonly line: Partial<LineBody> | LineBody | null; readonly categoryIds: readonly string[] | null; readonly allocation: AllocationBody | null }`.
- After the line step, `saveLine` runs `PUT …/lines/{lineId}/categories` with `{ categoryIds: [...save.categoryIds] }` when `categoryIds` is not null, and then `PUT …/lines/{lineId}/allocation` with `save.allocation` when it is not null.
- Each step goes through `planWrite` with `ifMatch(current)`. A failure returns `{ ok: false, plan: current, section: "categories" | "allocation", … }`, and a success sets `current`.

`line-editor.tsx` gains:
- a `categories` row unless the line is SAVINGS. It holds the label `budgeting.mapping.label`, the chosen categories' names as chips (or `budgeting.mapping.none`), the error area, and a `Button variant="secondary"` `budgeting.mapping.choose` that opens `CategoryMappingSheet`;
- `AllocationEditor` under it, with `members` in join order;
- the preview, `previewOf(allocationDraft, { planned: plannedMinor ?? line.plannedAmount.amount, currency, members: members.map((m) => ({ memberId: m.id, capacity: plan.capacities.find((c) => c.memberId === m.id)?.amount.amount ?? "0" })), numberFormat })`. Here `plannedMinor` is the planned field read through `parseDecimal` and `minorOf`, so the preview follows the typed amount.

Saving now does the following:
1. When the preview is `invalid`, `noCapacity` or `unreadable`, the alert is shown, focus moves to the allocation section, and nothing is sent.
2. Otherwise `saveLine` sends:
   - `categoryIds`, for a new line when any is chosen, and for an existing line when the set differs from `line.categoryIds` (else `null`);
   - `allocation`, from `allocationBodyOf(…)` when `allocationChanged(line, body)` (else `null`).
3. A failing `section` puts its translated message on that section: the categories row, the allocation section, or the field `lineFieldOf` names for the line.

`line-editor-container.tsx`: `loadLineEditor` also reads `GET …/categories` (live only) and `GET …/members` in parallel, and passes `groups` and `members`.

Catalog keys, es / en:
- `budgeting.mapping`:
  - `label` Categorías / Categories; `choose` Elegir categorías / Choose categories;
  - `none` Ninguna categoría todavía / No categories yet; `title` Categorías de {line} / Categories of {line};
  - `search` Buscar categoría / Search category; `inOtherLine` En {line} / In {line}; `done` Listo / Done;
- `budgeting.allocation`:
  - `title` Quién responde por la línea / Who answers for the line;
  - `rule` Regla de asignación / Allocation rule;
  - `value` Valor de {name} / {name}'s value;
  - `sum` Suma: {sum} / Sum: {sum};
  - `unreadable` Escribe un número como {example}. / Type a number like {example}.;
  - `noCapacity` Nadie tiene capacidad en este plan: asigna por porcentaje o por monto fijo. / Nobody has capacity in this plan: allocate by percentage or by fixed amount.;
  - `note.PROPORTIONAL` Sigue la capacidad de cada miembro. Si cambian las capacidades, se recalcula. / Follows each member's capacity. It is recalculated when capacities change.;
  - `note.PERCENT` Porcentajes que suman 100 %. / Percentages that add up to 100%.;
  - `note.FIXED` Montos que suman los {planned} planeados. / Amounts that add up to the {planned} planned.;
  - `note.NONE` Plata del grupo, sin responsable por persona: la línea muestra planeado, gastado y disponible, sin montos por miembro. / Group money with no one answering per person: the line shows planned, spent and available, without amounts per member.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/budgeting/ui/line-editor src/i18n/messages
git commit -m "feat(budgeting): map categories to a line and allocate it with a live preview (Refs #76)"
```

If the staged candidate is over ~500 lines, commit it in two passes at the named split point:
1. `allocation.ts`, `allocation-editor.tsx`, their tests and the `budgeting.allocation` keys: `feat(budgeting): preview a line's allocation exactly as the plan rounds it (Refs #76)`;
2. the mapping sheet, the save steps, the editor wiring, their tests and the `budgeting.mapping` keys: `feat(budgeting): map categories to a line and save its allocation (Refs #76)`.

---

### Task 8b: What a line carries from the previous period, and the rollover modes explained

Issue #143 asks for a per-line option to carry a line's leftover into the next period. The API already has it (HU-E6-09, ruling P15). A line's `rolloverMode` is RESET, ROLLOVER or ADJUSTED, and every line figure answers `carryOver`; Task 7's editor already offers the three modes. Task 1e makes a line carry only from the CLOSED plan it was copied from, and name that plan in `carryOverFrom`. What no screen does yet is show the carried amount, where it came from, or what each mode does. This task does all three, on the line dashboard, the planner and the line editor (ruling P231):
- a carry from a closed plan reads "+$ 170.000 de octubre 2026";
- a carry still waiting reads "Se arrastra de octubre 2026 cuando ese plan se cierre." (ruling P243). The answers #143 asks for are rulings:
- an overspent line carries a negative amount only under ADJUSTED (ruling P228);
- a copy carries by the origin link, only from a CLOSED plan, and stores no amount (rulings P230 and P243);
- capacity counts planned amounts only, so a carry can never break it (ruling P229, pinned here by a backend test).

The comment's sinking funds for yearly bills are a ROLLOVER line, and the editor's hint says so (ruling P232).

**Depends on:**
- Task 1e (`carryOverFrom`);
- Tasks 3 and 3b (`LineDashboard`, `barWidth`, the state badges);
- Task 4 (the planner's line rows);
- Task 7 (the line editor's figures and its rollover choice);
- Task 8 (the line editor's last state).

**Files:**
- Modify:
  - `src/modules/budgeting/application/rollover.test.ts`;
  - `src/modules/reporting/ui/lines/{bar.ts, bar.test.ts, line-dashboard.tsx, lines.test.tsx}`;
  - `src/modules/budgeting/ui/planner/{planner.tsx, planner.test.tsx}`;
  - `src/modules/budgeting/ui/line-editor/{line-editor.tsx, line-editor.test.tsx}`;
  - `src/shared/ui/molecules/choice-group.tsx` (only if it takes no `describedBy` yet);
  - `src/i18n/messages/es.json`, `src/i18n/messages/en.json`.

**Interfaces:**
- Consumes: `formatSignedMoney`, `usePeriodText` (Task 2), `planLineDto`, `referencePlanDto`, `e7Dashboard` (Tasks 3, 4), `createUpdateBudgetLine`, the rollover test's `world`, `home` and `write`.
- Produces: `barWidth(spent: MoneyDto, planned: MoneyDto, carryOver?: MoneyDto): number`, measured against planned + carry-over; `LineDashboard({ dashboard, policy, formats })`, where `policy` (the space's `periodPolicy`) names the source period; `CarryText({ line, policy, formats })` in `src/modules/budgeting/ui/carry-text.tsx`, exported from `budgeting/ui/index.ts` and used by all three screens; the catalog keys below; `ChoiceGroup`'s optional `describedBy?: string`.

- [ ] **Step 1: Pin the capacity rule against a carry-over (backend)**

`src/modules/budgeting/application/rollover.test.ts`, inside `describe("carry-over along the chain of copies (HU-E6-09)", …)`:

```ts
  it("never counts a carry-over against the capacity: Home plans all 4,000,000 COP while it carries 200,000 (#143, ruling P229 of M6c)", async () => {
    const { copyInto, deps, read, write, close, november } = await world("ROLLOVER", { "2026-11-01": pesos(1_270_000) });
    await close(november.id);
    const december = await copyInto("2026-12");
    const [copied] = december.figures.lines;
    unwrap(
      await createUpdateBudgetLine(deps)({
        ...write(december.plan.id, copied!.line.id),
        changes: { plannedAmount: pesos(4_000_000) },
      }),
    );
    const view = await read(december.plan.id);
    expect(home(view)).toEqual(["Home", pesos(200_000), pesos(4_200_000)]);
    expect(view.figures.unallocated).toBe(0n);
  });
```

Run: `pnpm exec vitest run --project unit src/modules/budgeting/application/rollover.test.ts`
Expected: PASS on the first run. This pins behaviour that already holds (spec 5.2 counts planned amounts only). See it bite: temporarily add each line's `carried` to `planned` in `planFigures` (`src/modules/budgeting/domain/plan-figures.ts`). The test then fails on `unallocated` (−200,000 COP). Revert.

- [ ] **Step 2: Write the failing UI tests**

`src/modules/reporting/ui/lines/bar.test.ts`, appended inside its `describe`:

```ts
  it("measures a line against planned plus what it carried in (ruling P231 of M6c)", () => {
    expect(barWidth(cop(1_300_000), cop(1_470_000), cop(200_000))).toBe(77);
    expect(barWidth(cop(250_000), cop(730_000), cop(-130_000))).toBe(41);
    expect(barWidth(cop(100), cop(100), cop(-100))).toBe(100);
    expect(barWidth(cop(1_300_000), cop(1_470_000))).toBe(88);
  });
```

`src/modules/reporting/ui/lines/lines.test.tsx`, appended inside `describe("line dashboard (HU-E9-10)", …)`:

```tsx
  it("shows what a line carried and from which closed plan, or that it waits for that plan to close (#143, rulings P231 and P243)", () => {
    const october = { planId: "p-oct", period: { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" } };
    const dashboard = e7Dashboard();
    dashboard.lines[1] = { ...dashboard.lines[1]!, carryOver: cop(200_000), available: cop(370_000), carryOverFrom: { ...october, closed: true } };
    dashboard.lines[3] = { ...dashboard.lines[3]!, carryOver: cop(-130_000), available: cop(350_000), carryOverFrom: { ...october, closed: true } };
    dashboard.lines[2] = { ...dashboard.lines[2]!, carryOverFrom: { ...october, closed: false } };
    const { container } = renderWithIntl(
      <LineDashboard dashboard={dashboard} policy={householdDto().periodPolicy} formats={BUILT_IN_FORMATS} />,
    );
    const home = normalized(screen.getByRole("row", { name: /^Home/ }).textContent);
    expect(home).toContain("+$ 200.000 de octubre 2026");
    expect(home).toContain("$ 370.000");
    expect(normalized(screen.getByRole("row", { name: /^Free/ }).textContent)).toContain("−$ 130.000 de octubre 2026");
    expect(normalized(screen.getByRole("row", { name: /^Savings/ }).textContent)).toContain(
      "Se arrastra de octubre 2026 cuando ese plan se cierre.",
    );
    expect(screen.getByRole("row", { name: /^Rent/ }).textContent).not.toMatch(/octubre|arrastra/);
    expect(container.querySelector("[data-line='l-home'] [data-bar]")).toHaveStyle({ width: "77%" });
  });
```

`src/modules/budgeting/ui/planner/planner.test.tsx`, appended inside `describe("planner (HU-E9-08)", …)`:

```tsx
  it("shows a rolling line's mode and what it carries in (#143)", () => {
    const plan = referencePlanDto();
    plan.lines[1] = {
      ...plan.lines[1]!,
      rolloverMode: "ROLLOVER",
      carryOver: cop(200_000),
      available: cop(1_670_000),
      carryOverFrom: { planId: "p-oct", period: { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" }, closed: true },
    };
    show({ plan });
    const home = normalized(screen.getByRole("listitem", { name: "Home" }).textContent);
    expect(home).toContain("Directo · Según capacidad · Acumula");
    expect(home).toContain("+$ 200.000 de octubre 2026");
    expect(normalized(screen.getByRole("listitem", { name: "Free" }).textContent)).not.toContain("octubre");
  });
```

(`plan.lines[1]` is Home in `referencePlanDto`; if the builder orders the lines otherwise, find Home by name.)

`src/modules/budgeting/ui/line-editor/line-editor.test.tsx`, appended inside `describe("line editor (HU-E9-08)", …)`:

```tsx
  it("shows the carry-over among the figures and explains the chosen rollover mode (#143, rulings P231 and P232)", async () => {
    const { container } = show(
      planLineDto({
        rolloverMode: "ROLLOVER",
        carryOver: cop(200_000),
        available: cop(1_670_000),
        carryOverFrom: { planId: "p-oct", period: { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" }, closed: true },
      }),
    );
    const figures = normalized(screen.getByRole("region", { name: "Cifras de la línea" }).textContent);
    expect(figures).toContain("Arrastrado+$ 200.000 de octubre 2026");
    await userEvent.click(screen.getByRole("radio", { name: "Reinicia" }));
    const modes = screen.getByRole("radiogroup", { name: "Al cambiar de período" });
    expect(modes).toHaveAccessibleDescription("Cada período empieza en cero.");
    await userEvent.click(screen.getByRole("radio", { name: "Acumula" }));
    expect(modes).toHaveAccessibleDescription(
      "Lo que sobra pasa al siguiente período y no cuenta contra la capacidad. Úsalo para ahorrar cada mes para un gasto anual, como el SOAT, el predial o un seguro. Pasa cuando el plan siguiente se crea como copia de este y este se cierra.",
    );
    await userEvent.click(screen.getByRole("radio", { name: "Ajusta" }));
    expect(modes).toHaveAccessibleDescription(
      "Si te pasas, lo que excede se descuenta del siguiente período; lo que sobra no pasa. Pasa cuando el plan siguiente se crea como copia de este y este se cierra.",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows no carry-over figure when the line carries nothing", () => {
    show(planLineDto());
    expect(screen.getByRole("region", { name: "Cifras de la línea" }).textContent).not.toContain("Arrastrado");
  });
```

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/ui/lines/bar.test.ts` and `pnpm exec vitest run --project ui src/modules/reporting/ui/lines src/modules/budgeting/ui/planner src/modules/budgeting/ui/line-editor`
Expected: FAIL — `barWidth` ignores a third argument, and no screen shows the carry-over, its source or the hints.

Every existing render of `LineDashboard` (the tests of Tasks 3 and 3b, the container, and Task 16's overview if it renders it) gains `policy={…periodPolicy}`.

- [ ] **Step 4: Implement**

`src/modules/reporting/ui/lines/bar.ts`: `barWidth` takes `carryOver?: MoneyDto`. `const plan = BigInt(planned.amount) + BigInt(carryOver?.amount ?? "0");`, and the doc comment gains "measured against planned + carry-over (HU-E6-09, ruling P231 of M6c); still presentation, never a figure." The rest is unchanged.

`src/modules/reporting/ui/lines/line-dashboard.tsx`:
- each line row's bar is `barWidth(line.spent, line.planned, line.carryOver)`;
- when `line.carryOverFrom` is set, the row header shows `<CarryText line={line} policy={policy} formats={formats} />` under the name.

`src/modules/budgeting/ui/carry-text.tsx` (no `"use client"`): `CarryText({ line, policy, formats })` takes any line with `carryOver` and `carryOverFrom`. It renders nothing without `carryOverFrom`. Otherwise it renders a `span` (`text-sm text-muted`), and the source is named `usePeriodText()(carryOverFrom.period, policy, formats)`:
- `closed`: `reports.lines.carryOver` with `{amount}` (`formatSignedMoney(line.carryOver, formats)`) and `{period}`;
- not `closed`: `reports.lines.carryOverPending` with `{period}`.

The planned, spent and available cells stay as they are: available already includes the carry-over, as answered.

`src/modules/budgeting/ui/planner/planner.tsx`: in each line's `li`, after `formatMoney(plannedAmount)`, `<CarryText line={line} policy={space.periodPolicy} formats={formats} />`.

`src/modules/budgeting/ui/line-editor/line-editor.tsx`:
- the figures `section` gains, between planned and spent, a `dl` pair `budgeting.lineEditor.carryOver` with `CarryText`, only when `carryOverFrom` is set;
- under the rollover `ChoiceGroup` a `p id="line-rollover-hint"` (`text-sm text-muted`) shows `budgeting.rollover.hint.<draft.rolloverMode>`. For ROLLOVER and ADJUSTED it continues, after a space, with `budgeting.rollover.throughCopy`;
- the group is described by it: `describedBy="line-rollover-hint"`. If `ChoiceGroup` has no such prop, add `describedBy?: string` to it, set as `aria-describedby` on its radiogroup element.

Catalog keys, es / en:
- `reports.lines.carryOver` {amount} de {period} / {amount} from {period};
- `reports.lines.carryOverPending` Se arrastra de {period} cuando ese plan se cierre. / Carries over from {period} once that plan is closed.;
- `budgeting.lineEditor.carryOver` Arrastrado / Carried over;
- `budgeting.rollover.hint`:
  - `RESET` Cada período empieza en cero. / Every period starts from zero.;
  - `ROLLOVER` Lo que sobra pasa al siguiente período y no cuenta contra la capacidad. Úsalo para ahorrar cada mes para un gasto anual, como el SOAT, el predial o un seguro. / What is left moves to the next period and does not count against capacity. Use it to save every month for a yearly bill, such as SOAT, property tax or insurance.;
  - `ADJUSTED` Si te pasas, lo que excede se descuenta del siguiente período; lo que sobra no pasa. / If you go over, the excess comes off the next period; what is left does not move.;
- `budgeting.rollover.throughCopy` Pasa cuando el plan siguiente se crea como copia de este y este se cierra. / It moves when the next plan is created as a copy of this one and this one is closed.

- [ ] **Step 5: Run the tests and the gates**

Run: Step 3's commands, then every gate including `pnpm build`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/budgeting/application/rollover.test.ts src/modules/reporting/ui/lines src/modules/budgeting/ui \
  src/shared/ui/molecules/choice-group.tsx src/i18n/messages
git commit -m "feat(budgeting): show what each line carries from the previous period and explain the rollover modes (Refs #143)"
```

---

### Task 9: The member matrix

The Matrix artboard and HU-E9-10's "Member matrix translates reason codes". Each line of the period's plan gets a table of its members, with the columns assigned, contributed, consumed and gap. A gap carries its status (`reports.status.<Code>`: over-contributed, under-contributed, on target). A missing figure reads the line's reason (`reports.reason.<Code>`), visibly as a dash and in full for screen readers, and the reason is also written under the table (ruling P217). Every figure is the API's.

**Files:**
- Create: `src/modules/reporting/ui/matrix/{member-matrix.tsx, matrix-container.tsx, matrix.test.tsx}`, `src/app/(web)/(app)/spaces/[spaceId]/plan/members/page.tsx`
- Modify: `src/modules/reporting/ui/{views.ts, views.test.ts, server.ts}`, `src/shared/ui/api/dto.ts`, `tests/support/ui/plan-dto.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `DashboardFrame`, `periodLabel`, `neighboursOf`, `spaceOf` (Task 3); `formatMoney`, `formatSignedMoney`; `Badge`, `Icon`, `VisuallyHidden`; `SpaceMemberDto`.
- Produces: `MemberMatrixDto` (dto); `memberName(members, memberId, t): string` (the display name, or `reports.matrix.formerMember`); `MemberMatrix({ space, matrix, members, formats })`; `loadMatrix(api, { spaceId, period?, today })`; `MemberMatrixContainer({ spaceId, period? })`; builder `e7Matrix()`. `viewsFor("SHARED")` becomes `["lines", "members"]`.

- [ ] **Step 1: Write the failing tests**

`tests/support/ui/plan-dto.ts`: add `MemberMatrixDto` to the type import and append:

```ts
type MatrixCell = MemberMatrixDto["lines"][number]["members"][number];
const cell = (
  memberId: string,
  [assigned, contributed, consumed, gap]: readonly (number | null)[],
  status: MatrixCell["status"] = null,
): MatrixCell => {
  const money = (pesos: number | null | undefined) => (pesos === null || pesos === undefined ? null : cop(pesos));
  return { memberId, assigned: money(assigned), contributed: money(contributed), consumed: money(consumed), gap: money(gap), status };
};

/** HU-E7-02's November matrix: Rent tracked at fund level, Home per member, Free not allocated. */
export const e7Matrix = (): MemberMatrixDto => ({
  spaceId: "sp-household",
  period: { ...NOVEMBER },
  plan: { id: "p-nov", status: "ACTIVE" },
  lines: [
    {
      lineId: "l-rent",
      name: "Rent",
      funding: "SHARED_FUND",
      rule: "PROPORTIONAL",
      reason: "TRACKED_AT_FUND_LEVEL",
      members: [cell("m-ana", [480_000, null, 480_000, null]), cell("m-juan", [720_000, null, 720_000, null])],
    },
    {
      lineId: "l-home",
      name: "Home",
      funding: "DIRECT",
      rule: "PROPORTIONAL",
      reason: null,
      members: [
        cell("m-ana", [588_000, 900_000, 520_000, 312_000], "OVER_CONTRIBUTED"),
        cell("m-juan", [882_000, 400_000, 780_000, -482_000], "UNDER_CONTRIBUTED"),
      ],
    },
    {
      lineId: "l-free",
      name: "Free",
      funding: "DIRECT",
      rule: "NONE",
      reason: "NOT_ALLOCATED",
      members: [cell("m-ana", [null, null, 125_000, null]), cell("m-juan", [null, null, 125_000, null])],
    },
  ],
});
```

`src/modules/reporting/ui/views.test.ts`: in the first test replace `expect(viewsFor("SHARED")).toEqual(["lines"]);` with `expect(viewsFor("SHARED")).toEqual(["lines", "members"]);` and add `expect(viewHref(shared, "members", "2026-11")).toBe("/spaces/sp-household/plan/members?period=2026-11");`.

`src/modules/reporting/ui/matrix/matrix.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { normalized } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { e7Matrix, HOUSEHOLD_MEMBERS, householdDto } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { loadMatrix } from "./matrix-container";
import { MemberMatrix } from "./member-matrix";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

const cellsOf = (table: string, member: string) =>
  within(within(screen.getByRole("table", { name: table })).getByRole("row", { name: new RegExp(`^${member}`) }))
    .getAllByRole("cell")
    .map((c) => normalized(c.textContent).trim());
const show = () =>
  renderWithIntl(
    <MemberMatrix space={householdDto()} matrix={e7Matrix()} members={HOUSEHOLD_MEMBERS} formats={BUILT_IN_FORMATS} />,
  );

describe("member matrix (HU-E9-10)", () => {
  it("shows Ana's Home row with its over-contributed gap, and Juan's under-contributed one", async () => {
    const { container } = show();
    expect(cellsOf("Home por miembro", "Ana")).toEqual(["$ 588.000", "$ 900.000", "$ 520.000", "+$ 312.000 de más"]);
    expect(cellsOf("Home por miembro", "Juan")).toEqual(["$ 882.000", "$ 400.000", "$ 780.000", "−$ 482.000 de menos"]);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("reads TRACKED_AT_FUND_LEVEL in Rent's contributed and gap cells, and under its table", () => {
    show();
    const reason = "Aportó y diferencia se siguen en el fondo, no por línea.";
    const [assigned, contributed, consumed, gap] = cellsOf("Rent por miembro", "Ana");
    expect([assigned, consumed]).toEqual(["$ 480.000", "$ 480.000"]);
    expect(contributed).toContain(reason);
    expect(gap).toContain(reason);
    expect(screen.getAllByText(reason, { selector: "p" })).toHaveLength(1);
  });

  it("shows only what a line without allocation consumed, with its reason", () => {
    show();
    const [assigned, , consumed] = cellsOf("Free por miembro", "Ana");
    expect(consumed).toBe("$ 125.000");
    expect(assigned).toContain("Sin asignación por persona: solo se muestra lo consumido.");
  });

  it("loads the period's matrix and the space's members", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/reports/member-matrix": () => jsonResponse(e7Matrix()),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: HOUSEHOLD_MEMBERS }),
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [] }),
    });
    const result = await loadMatrix(api, { spaceId: "sp-household", period: "2026-11", today: "2026-10-31" });
    expect(result.ok && result.data.members).toHaveLength(2);
    const report = requests.find((r) => r.url.includes("member-matrix"))!;
    expect(new URL(report.url).searchParams.get("period")).toBe("2026-11");
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/ui/views.test.ts` and `pnpm exec vitest run --project ui src/modules/reporting/ui/matrix`
Expected: FAIL.

- [ ] **Step 3: Implement**

`dto.ts`: `export type MemberMatrixDto = Json<paths["/api/v1/spaces/{spaceId}/reports/member-matrix"]["get"]["responses"][200]>;`

`views.ts`: `const SHARED_VIEWS: readonly PlanView[] = ["lines", "members"];`.

`src/modules/reporting/ui/matrix/member-matrix.tsx` (no `"use client"`), the Matrix artboard:
- Without a plan (`matrix.plan === null`): the `p` `reports.matrix.noPlan`.
- Otherwise, one `section` per line, labelled by its `h2` (the line's name). It holds:
  - a `p` `reports.matrix.kind` with `{funding}` (`budgeting.funding.<f>`) and `{rule}` (`budgeting.rule.<r>`);
  - a `table` with a visible `caption` `reports.matrix.caption` with `{line}`;
  - the header row: `reports.matrix.member`, `reports.matrix.assigned`, `reports.matrix.contributed`, `reports.matrix.consumed`, `reports.matrix.gap`.
- One `tr` per cell. Its `th scope="row"` is `memberName(members, memberId, t)`. Each money `td`:
  - shows `formatMoney(value)` when the value is set;
  - when it is null, `<span aria-hidden="true">—</span><VisuallyHidden>{why}</VisuallyHidden>`. Here `why` is `t(\`reason.${line.reason}\`)` when the line has a reason, `reports.matrix.savingsNote` for a SAVINGS line's consumed cell, and `reports.matrix.noFigure` otherwise.
- The gap `td` shows `formatSignedMoney(gap)`, a space, and, when `status` is set, a `Badge` `reports.status.<status>`: `tone="accent" icon="arrowUp"` for OVER_CONTRIBUTED, `tone="owe" icon="arrowDown"` for UNDER_CONTRIBUTED, and `neutral` for ON_TARGET.
- Under the table, a `p` with the reason text when the line has a reason, or `reports.matrix.savingsNote` for a SAVINGS line.

`memberName` lives in `src/modules/reporting/ui/member-name.ts`: `(members, id, t) => members.find((m) => m.id === id)?.displayName ?? t("matrix.formerMember")`.

`src/modules/reporting/ui/matrix/matrix-container.tsx`:
- `loadMatrix` resolves the label (`periodLabel`), reads `GET …/reports/member-matrix?period=` and `GET …/members` in parallel, then the neighbours;
- `MemberMatrixContainer` renders `DashboardFrame view="members"` around `MemberMatrix`, as `LineDashboardContainer` does;
- `server.ts` exports it.

`src/app/(web)/(app)/spaces/[spaceId]/plan/members/page.tsx`: the title `reports.view.members`, and `<MemberMatrixContainer spaceId={spaceId} period={period} />`.

Catalog keys, es / en:
- `reports.matrix`:
  - `noPlan` Este período no tiene plan: no hay asignaciones que comparar. / This period has no plan: there are no allocations to compare.;
  - `kind` {funding} · {rule} / {funding} · {rule}; `caption` {line} por miembro / {line} by member;
  - `member` Miembro / Member; `assigned` Asignado / Assigned; `contributed` Aportó / Contributed; `consumed` Consumió / Consumed; `gap` Diferencia / Gap;
  - `formerMember` Miembro anterior / Former member; `noFigure` Sin dato / No figure;
  - `savingsNote` Cuenta lo que llegó a las cuentas de ahorro de la línea; no tiene consumo. / It counts what reached the line's savings accounts; it has no consumption.;
- `reports.reason`:
  - `NOT_ALLOCATED` Sin asignación por persona: solo se muestra lo consumido. / Not allocated per person: only what was consumed is shown.;
  - `TRACKED_AT_FUND_LEVEL` Aportó y diferencia se siguen en el fondo, no por línea. / Contributions and gaps are tracked at the fund, not per line.;
  - `INVALID_ALLOCATION` La asignación de esta línea no cuadra: nadie tiene un monto asignado. / This line's allocation does not add up: nobody has an assigned amount.;
- `reports.status`: `OVER_CONTRIBUTED` de más / over-contributed; `UNDER_CONTRIBUTED` de menos / under-contributed; `ON_TARGET` al día / on target.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/reporting/ui "src/app/(web)/(app)/spaces/[spaceId]/plan/members" src/shared/ui/api/dto.ts \
  tests/support/ui/plan-dto.ts src/i18n/messages
git commit -m "feat(reporting): show the member matrix with translated reasons and statuses (Refs #78)"
```

---

### Task 10: Fund tracking

The Fund artboard and HU-E9-10's "Fund tracking compares expected and actual". The view shows:
- a summary of the API's totals (Task 1): expected, contributed and difference;
- a card per member with the expected and actual amounts, the difference and a bar;
- a footnote on what "expected" means.

The member matrix gains its "See the fund" link on lines tracked at fund level.

**Files:**
- Create: `src/modules/reporting/ui/fund/{fund-tracking.tsx, fund-container.tsx, fund.test.tsx}`, `src/app/(web)/(app)/spaces/[spaceId]/plan/fund/page.tsx`
- Modify: `src/modules/reporting/ui/{views.ts, views.test.ts, server.ts}`, `src/modules/reporting/ui/matrix/{member-matrix.tsx, matrix.test.tsx}`, `src/shared/ui/api/dto.ts`, `tests/support/ui/plan-dto.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `barWidth` (Task 3), `memberName` (Task 9), `DashboardFrame`, `formatMoney`, `formatSignedMoney`, `Badge`.
- Produces: `FundTrackingDto` (dto); `FundTracking({ fund, members, formats })`; `loadFund(api, { spaceId, period?, today })`; `FundTrackingContainer`; builder `e7Fund()`. `viewsFor("SHARED")` becomes `["lines", "members", "fund"]`.

- [ ] **Step 1: Write the failing tests**

`tests/support/ui/plan-dto.ts`, appended (with `FundTrackingDto` imported):

```ts
/** HU-E9-10 "Fund tracking": Ana paid in 480,000 COP on 2026-11-02 and Juan 500,000 COP on 2026-11-03. */
export const e7Fund = (overrides: Partial<FundTrackingDto> = {}): FundTrackingDto => ({
  spaceId: "sp-household",
  period: { ...NOVEMBER },
  plan: { id: "p-nov", status: "ACTIVE" },
  members: [
    { memberId: "m-ana", expected: cop(480_000), actual: cop(480_000), difference: cop(0) },
    { memberId: "m-juan", expected: cop(720_000), actual: cop(500_000), difference: cop(-220_000) },
  ],
  totals: { expected: cop(1_200_000), actual: cop(980_000), difference: cop(-220_000) },
  ...overrides,
});
```

`views.test.ts`: `viewsFor("SHARED")` becomes `["lines", "members", "fund"]`.

`src/modules/reporting/ui/fund/fund.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../../tests/support/ui/dto";
import { e7Fund, HOUSEHOLD_MEMBERS } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { FundTracking } from "./fund-tracking";

vi.mock("next/headers", () => ({}));

describe("fund tracking (HU-E9-10)", () => {
  it("shows Juan expected 720.000, actual 500.000 and difference −220.000", async () => {
    const { container } = renderWithIntl(
      <FundTracking fund={e7Fund()} members={HOUSEHOLD_MEMBERS} formats={BUILT_IN_FORMATS} />,
    );
    const juan = normalized(screen.getByRole("listitem", { name: "Juan" }).textContent);
    expect(juan).toContain("Esperado$ 720.000");
    expect(juan).toContain("Aportado$ 500.000");
    expect(juan).toContain("Diferencia−$ 220.000");
    expect(juan).toContain("Le falta aportar");
    expect(normalized(screen.getByRole("listitem", { name: "Ana" }).textContent)).toContain("Al día");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("sums nothing itself: the summary is the API's totals (ruling P201)", () => {
    const totals = { expected: cop(7), actual: cop(8), difference: cop(9) };
    renderWithIntl(<FundTracking fund={e7Fund({ totals })} members={HOUSEHOLD_MEMBERS} formats={BUILT_IN_FORMATS} />);
    const summary = normalized(screen.getByRole("region", { name: "Aportes al fondo" }).textContent);
    expect(summary).toContain("Esperado$ 7");
    expect(summary).toContain("Aportado$ 8");
    expect(summary).toContain("Diferencia+$ 9");
  });
});
```

`matrix.test.tsx`, appended inside the `describe`:

```tsx
  it("links a line tracked at fund level to the fund view of the same period", () => {
    show();
    expect(screen.getByRole("link", { name: "Ver fondo" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plan/fund?period=2026-11",
    );
  });
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/ui/views.test.ts` and `pnpm exec vitest run --project ui src/modules/reporting/ui/fund src/modules/reporting/ui/matrix`
Expected: FAIL.

- [ ] **Step 3: Implement**

`dto.ts`: `export type FundTrackingDto = Json<paths["/api/v1/spaces/{spaceId}/reports/fund-contributions"]["get"]["responses"][200]>;`. `views.ts`: `SHARED_VIEWS` = `["lines", "members", "fund"]`.

`src/modules/reporting/ui/fund/fund-tracking.tsx` (no `"use client"`):
- A `section` labelled by its `h2` `reports.fund.title`, holding three `dl` pairs from `fund.totals`: `reports.fund.expected` (`formatMoney`), `reports.fund.actual` (`formatMoney`) and `reports.fund.difference` (`formatSignedMoney`).
- Without a plan, the `p` `reports.fund.noPlan`.
- A `ul` labelled `reports.fund.byMember`, with one `li` per member, named by `aria-labelledby` the name. Each `li` holds:
  - the name;
  - a `Badge`: `tone="accent" icon="check"` `reports.fund.upToDate` when the difference is not negative (`!difference.amount.startsWith("-")`), else `tone="owe" icon="arrowDown"` `reports.fund.behind`;
  - the three pairs (`reports.fund.expected`, `reports.fund.actual`, `reports.fund.difference`), the difference in `text-owe` when negative;
  - an `aria-hidden` bar at `barWidth(actual, expected)`.
- The footnote `reports.fund.note`.

`fund-container.tsx`: `loadFund` and `FundTrackingContainer` like the matrix's (the report plus the members), framed with `view="fund"`. `server.ts` exports it. Page `src/app/(web)/(app)/spaces/[spaceId]/plan/fund/page.tsx`: the title `reports.view.fund`, and `<FundTrackingContainer spaceId={spaceId} period={period} />`.

`member-matrix.tsx`: under a `TRACKED_AT_FUND_LEVEL` line's note, add a link `reports.matrix.toFund` to `viewHref(space, "fund", matrix.period.label)`.

Catalog keys, es / en:
- `reports.fund`:
  - `title` Aportes al fondo / Fund contributions;
  - `expected` Esperado / Expected; `actual` Aportado / Contributed; `difference` Diferencia / Difference;
  - `byMember` Por miembro / By member; `upToDate` Al día / Up to date; `behind` Le falta aportar / Still to pay in;
  - `noPlan` Sin plan, nadie tiene un aporte esperado. / Without a plan, nobody has an expected contribution.;
  - `note` Esperado: lo asignado a cada uno en las líneas pagadas con el fondo. Cuentan los aportes fechados en el período. / Expected: what each one is assigned on the lines paid from the fund. Contributions dated in the period count.;
- `reports.matrix.toFund` Ver fondo / See the fund.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/reporting/ui "src/app/(web)/(app)/spaces/[spaceId]/plan/fund" src/shared/ui/api/dto.ts \
  tests/support/ui/plan-dto.ts src/i18n/messages
git commit -m "feat(reporting): track each member's fund contributions against what is expected (Refs #78)"
```

---

### Task 11: Spending by group with drill-down

The ByGroup artboard and HU-E9-10's "Spending by group drills down to categories and subcategories". `SpendingByGroupContainer` loads `GET …/reports/spending-by-group` once. `spending-tree.ts` normalizes the tree, for this response and for the personal one of Task 13. `SpendingChart` shows one level at a time as a list of rows. Each row's bar is its share: the HTML chart of ruling P202, and the row is also the table of the same figures. Tapping a row goes one level down, and the `DrillBreadcrumb` goes back up. No drill-down makes a request (ruling P215). These keys apply:
- `reports.byGroup.noSubcategory` names the entry without a subcategory;
- `reports.byGroup.archived` marks an archived node;
- shares and amounts are rendered as answered.

**Files:**
- Create: `src/modules/reporting/ui/by-group/{spending-tree.ts, spending-tree.test.ts, spending-chart.tsx, drill-breadcrumb.tsx, node-label.tsx, by-group-container.tsx, by-group.test.tsx}`, `src/app/(web)/(app)/spaces/[spaceId]/plan/groups/page.tsx`
- Modify: `src/modules/reporting/ui/{views.ts, views.test.ts, server.ts}`, `src/shared/ui/api/dto.ts`, `tests/support/ui/plan-dto.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `DashboardFrame`, `periodLabel`, `neighboursOf`, `spaceOf`; `formatMoney`, `formatPercent`; `Badge`, `Icon`.
- Produces:
  - `dto.ts`: `SpendingByGroupDto` (space) and `PersonalSpendingByGroupDto` (`GET /api/v1/me/reports/spending-by-group`).
  - `spending-tree.ts`:
    - `type NodeName = { kind: "plain"; name: string } | { kind: "scoped"; space: string; name: string } | { kind: "noSubcategory" }`;
    - `interface SpendingNode { id: string; name: NodeName; total: MoneyDto; share: string; archived: boolean; children: readonly SpendingNode[] }`;
    - `treeOf(groups: SpendingByGroupDto["groups"] | PersonalSpendingByGroupDto["groups"]): SpendingNode[]` (a category's subcategory level exists only when it has a named subcategory);
    - `levelAt(tree, path: readonly string[]): { node: SpendingNode | null; rows: readonly SpendingNode[]; trail: readonly SpendingNode[] }`.
  - `NodeLabel({ name })`; `DrillBreadcrumb({ trail, onGo })`; `SpendingChart({ tree, total, formats, note })` (client).
  - `loadByGroup(api, { spaceId, period?, today })`; `SpendingByGroupContainer({ spaceId, period? })`; builder `e7Groups()`.
  - `viewsFor("SHARED")` becomes `["lines", "members", "fund", "groups"]`.

- [ ] **Step 1: Write the failing tests**

`tests/support/ui/plan-dto.ts`, appended (with `SpendingByGroupDto` imported):

```ts
type Group = SpendingByGroupDto["groups"][number];
type GroupCategory = Group["categories"][number];
const sub = (subcategoryId: string | null, name: string | null, pesos: number, share: string) => ({
  subcategoryId,
  name,
  archived: false,
  total: cop(pesos),
  share,
});
const category = (id: string, name: string, pesos: number, share: string, subcategories = [sub(null, null, pesos, "100.00")]): GroupCategory => ({
  id,
  key: null,
  name,
  archived: false,
  total: cop(pesos),
  share,
  subcategories,
});
const group = (id: string, name: string, pesos: number, share: string, categories: GroupCategory[]): Group => ({
  id,
  key: null,
  name,
  archived: false,
  total: cop(pesos),
  share,
  categories,
});

/** HU-E9-10 "Spending by group": the E7 November expenses, Groceries split into its subcategories. */
export const e7Groups = (): SpendingByGroupDto => ({
  spaceId: "sp-household",
  period: { ...NOVEMBER },
  total: cop(2_810_000),
  groups: [
    group("g-housing", "Housing", 1_600_000, "56.94", [
      category("c-rent", "Rent", 1_200_000, "75.00"),
      category("c-utilities", "Utilities", 400_000, "25.00"),
    ]),
    group("g-food", "Food", 960_000, "34.16", [
      category("c-groceries", "Groceries", 900_000, "93.75", [
        sub(null, null, 450_000, "50.00"),
        sub("c-veg", "Vegetables", 270_000, "30.00"),
        sub("c-meat", "Meat", 180_000, "20.00"),
      ]),
      category("c-dining", "Restaurants", 60_000, "6.25"),
    ]),
    group("g-leisure", "Leisure", 250_000, "8.90", [category("c-fun", "Entertainment", 250_000, "100.00")]),
  ],
});
```

`views.test.ts`: `viewsFor("SHARED")` becomes `["lines", "members", "fund", "groups"]`.

`src/modules/reporting/ui/by-group/spending-tree.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { e7Groups } from "../../../../../tests/support/ui/plan-dto";
import { levelAt, treeOf } from "./spending-tree";

describe("spending tree (HU-E9-10, ruling P215)", () => {
  const tree = treeOf(e7Groups().groups);

  it("keeps the API's order, totals and shares at every level", () => {
    expect(tree.map((n) => [n.id, n.name, n.total.amount, n.share])).toEqual([
      ["g:g-housing", { kind: "plain", name: "Housing" }, "160000000", "56.94"],
      ["g:g-food", { kind: "plain", name: "Food" }, "96000000", "34.16"],
      ["g:g-leisure", { kind: "plain", name: "Leisure" }, "25000000", "8.90"],
    ]);
  });

  it("goes down to the subcategories only where there is a named one", () => {
    const food = levelAt(tree, ["g:g-food"]);
    expect(food.node?.name).toEqual({ kind: "plain", name: "Food" });
    expect(food.rows.map((n) => [n.name, n.children.length])).toEqual([
      [{ kind: "plain", name: "Groceries" }, 3],
      [{ kind: "plain", name: "Restaurants" }, 0],
    ]);
    const groceries = levelAt(tree, ["g:g-food", "c:c-groceries"]);
    expect(groceries.rows.map((n) => [n.name, n.share])).toEqual([
      [{ kind: "noSubcategory" }, "50.00"],
      [{ kind: "plain", name: "Vegetables" }, "30.00"],
      [{ kind: "plain", name: "Meat" }, "20.00"],
    ]);
    expect(groceries.trail.map((n) => n.id)).toEqual(["g:g-food", "c:c-groceries"]);
    expect(levelAt(tree, []).rows).toBe(tree);
  });
});
```

`src/modules/reporting/ui/by-group/by-group.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { normalized } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { e7Groups } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { loadByGroup } from "./by-group-container";
import { SpendingChart } from "./spending-chart";
import { treeOf } from "./spending-tree";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

const rows = () =>
  screen
    .getAllByRole("listitem")
    .filter((li) => li.querySelector("[data-cell]"))
    .map((li) => [...li.querySelectorAll("[data-cell]")].map((c) => normalized(c.textContent).trim()));
const show = (data = e7Groups()) =>
  renderWithIntl(<SpendingChart tree={treeOf(data.groups)} total={data.total} formats={BUILT_IN_FORMATS} note="Nota" />);

describe("spending by group (HU-E9-10)", () => {
  it("drills from groups to categories to subcategories and back through the breadcrumb", async () => {
    const { container } = show();
    expect(rows()).toEqual([
      ["Housing", "$ 1.600.000", "56,94 %"],
      ["Food", "$ 960.000", "34,16 %"],
      ["Leisure", "$ 250.000", "8,90 %"],
    ]);
    expect(await axeViolations(container)).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /^Food/ }));
    expect(rows()).toEqual([
      ["Groceries", "$ 900.000", "93,75 %"],
      ["Restaurants", "$ 60.000", "6,25 %"],
    ]);
    const trail = screen.getByRole("navigation", { name: "Ruta" });
    expect(within(trail).getByText("Food")).toHaveAttribute("aria-current", "location");
    expect(screen.queryByRole("button", { name: /^Restaurants/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Groceries/ }));
    expect(rows()).toEqual([
      ["Sin subcategoría", "$ 450.000", "50,00 %"],
      ["Vegetables", "$ 270.000", "30,00 %"],
      ["Meat", "$ 180.000", "20,00 %"],
    ]);
    expect(within(trail).getAllByRole("button").map((b) => b.textContent)).toEqual(["Todos los grupos", "Food"]);
    expect(within(trail).getByText("Groceries")).toHaveAttribute("aria-current", "location");
    expect(normalized(screen.getByText(/Total de Groceries/).closest("p")?.textContent)).toContain("$ 900.000");
    await userEvent.click(within(trail).getByRole("button", { name: "Food" }));
    expect(rows().map((r) => r[0])).toEqual(["Groceries", "Restaurants"]);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("marks an archived node with its badge", () => {
    const data = e7Groups();
    data.groups[2] = { ...data.groups[2]!, archived: true };
    show(data);
    expect(within(screen.getByRole("button", { name: /^Leisure/ })).getByText("Archivada")).toBeInTheDocument();
  });

  it("loads the tree with one request", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/reports/spending-by-group": () => jsonResponse(e7Groups()),
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [] }),
    });
    await loadByGroup(api, { spaceId: "sp-household", period: "2026-11", today: "2026-10-31" });
    expect(requests.filter((r) => r.url.includes("spending-by-group"))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/ui` and `pnpm exec vitest run --project ui src/modules/reporting/ui/by-group`
Expected: FAIL.

- [ ] **Step 3: Implement**

`dto.ts`:

```ts
export type SpendingByGroupDto = Json<paths["/api/v1/spaces/{spaceId}/reports/spending-by-group"]["get"]["responses"][200]>;
export type PersonalSpendingByGroupDto = Json<paths["/api/v1/me/reports/spending-by-group"]["get"]["responses"][200]>;
```

`views.ts`: `SHARED_VIEWS` = `["lines", "members", "fund", "groups"]`.

`src/modules/reporting/ui/by-group/spending-tree.ts`:

```ts
import type { MoneyDto, PersonalSpendingByGroupDto, SpendingByGroupDto } from "@/shared/ui/api/dto";

/** How a node is named: as stored, scoped to its space ("Household / Pets", HU-E9-11), or the "no subcategory" entry. */
export type NodeName =
  | { readonly kind: "plain"; readonly name: string }
  | { readonly kind: "scoped"; readonly space: string; readonly name: string }
  | { readonly kind: "noSubcategory" };

export interface SpendingNode {
  readonly id: string;
  readonly name: NodeName;
  readonly total: MoneyDto;
  readonly share: string;
  readonly archived: boolean;
  readonly children: readonly SpendingNode[];
}

type Groups = SpendingByGroupDto["groups"] | PersonalSpendingByGroupDto["groups"];
type Scoped = { readonly space?: { readonly name: string } | null };

const nameOf = (node: Scoped & { readonly name: string }): NodeName =>
  node.space ? { kind: "scoped", space: node.space.name, name: node.name } : { kind: "plain", name: node.name };

/**
 * HU-E7-06, ruling P215: the response as one tree, in its order, with ids stable across levels (a merged node has no
 * id, so its catalog key names it). A category's subcategory level exists only when it holds a named subcategory.
 */
export const treeOf = (groups: Groups): SpendingNode[] =>
  groups.map((g) => ({
    id: `g:${g.id ?? `key:${g.key ?? g.name}`}`,
    name: nameOf(g),
    total: g.total,
    share: g.share,
    archived: g.archived,
    children: g.categories.map((c) => ({
      id: `c:${c.id ?? `key:${c.key ?? c.name}`}`,
      name: nameOf(c),
      total: c.total,
      share: c.share,
      archived: c.archived,
      children: c.subcategories.some((s) => s.subcategoryId !== null)
        ? c.subcategories.map((s) => ({
            id: `s:${s.subcategoryId ?? "none"}`,
            name: s.subcategoryId === null ? ({ kind: "noSubcategory" } as const) : nameOf({ ...s, name: s.name ?? "" }),
            total: s.total,
            share: s.share,
            archived: s.archived,
            children: [],
          }))
        : [],
    })),
  }));

/** The level under `path` (ids from the root), the node it opens (null at the root) and the trail to it. */
export const levelAt = (
  tree: readonly SpendingNode[],
  path: readonly string[],
): { node: SpendingNode | null; rows: readonly SpendingNode[]; trail: readonly SpendingNode[] } => {
  let rows = tree;
  let node: SpendingNode | null = null;
  const trail: SpendingNode[] = [];
  for (const id of path) {
    const next = rows.find((n) => n.id === id);
    if (!next) break;
    node = next;
    trail.push(next);
    rows = next.children;
  }
  return { node, rows, trail };
};
```

`node-label.tsx` (no `"use client"`): `NodeLabel({ name })` renders `name.name` for plain, `reports.spaceScoped` with `{space}` and `{name}` for scoped, and `reports.byGroup.noSubcategory` for the entry without a subcategory.

`drill-breadcrumb.tsx` (`"use client"`): `DrillBreadcrumb({ trail, onGo })` is a `nav` labelled `reports.byGroup.trail` around an `ol`:
- the first item is a button `reports.byGroup.all` calling `onGo(0)`, or a `span aria-current="location"` with that text at the root;
- each trail node but the last is a button with its `NodeLabel`, calling `onGo(i + 1)`;
- the last node is a `span aria-current="location"`;
- the separators are CSS `before:content-['›']` on the items, so the breadcrumb's text holds the names only.

`spending-chart.tsx` (`"use client"`): `SpendingChart({ tree, total, formats, note })`. State: `path: string[]`. With `const { node, rows, trail } = levelAt(tree, path)` it renders:
- the breadcrumb;
- a `p` with `reports.byGroup.total` (at the root) or `reports.byGroup.totalOf` with `{name}`, and then `formatMoney(node?.total ?? total)`;
- the hint `reports.byGroup.hint.<groups|categories|subcategories>`, by `trail.length`;
- a `ul` labelled `reports.byGroup.groups`, `reports.byGroup.categoriesOf` with `{name}`, or `reports.byGroup.subcategoriesOf` with `{name}`.

Each `li` holds a row. A row with children is a `button` (44 px or taller, `w-full text-left`) that calls `setPath([...path, n.id])`; a row without children is a `div`. Its content:
- `span data-cell` with the `NodeLabel`, followed by `Badge` `reports.byGroup.archived` when `archived`;
- `span data-cell` with `formatMoney(n.total)`;
- `span data-cell` with `formatPercent(n.share)`;
- an `aria-hidden` bar with `style={{ width: \`${Number(n.share)}%\` }}`, the share as answered;
- for buttons, a trailing `Icon name="chevronRight"`.

Under the list sits the `p` `note`.

`by-group-container.tsx`: `loadByGroup` resolves the label and reads the report and the neighbours. `SpendingByGroupContainer` frames it with `view="groups"` and renders `<SpendingChart tree={treeOf(report.groups)} total={report.total} formats={formats} note={t("byGroup.spaceNote")} />`, with `t` from `getTranslations("reports")`. `server.ts` exports it. Page `src/app/(web)/(app)/spaces/[spaceId]/plan/groups/page.tsx`: the title `reports.view.groups`, and `<SpendingByGroupContainer spaceId={spaceId} period={period} />`. Task 13 makes it choose by the space's kind.

Catalog keys, es / en:
- `reports.spaceScoped` {space} / {name} / {space} / {name};
- `reports.byGroup`:
  - `trail` Ruta / Path; `all` Todos los grupos / All groups;
  - `total` Gasto total / Total spending; `totalOf` Total de {name} / Total of {name};
  - `hint.groups` Toca un grupo para ver sus categorías. / Tap a group to see its categories.;
  - `hint.categories` Toca una categoría para ver sus subcategorías. / Tap a category to see its subcategories.;
  - `hint.subcategories` Subcategorías / Subcategories;
  - `groups` Grupos / Groups; `categoriesOf` Categorías de {name} / Categories of {name}; `subcategoriesOf` Subcategorías de {name} / Subcategories of {name};
  - `noSubcategory` Sin subcategoría / No subcategory; `archived` Archivada / Archived;
  - `spaceNote` Todos los gastos del espacio, pague quien pague. Ingresos, transferencias, aportes al fondo y pagos entre miembros no cuentan. / Every expense of the space, whoever paid. Income, transfers, fund contributions and settlements do not count.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/reporting/ui "src/app/(web)/(app)/spaces/[spaceId]/plan/groups" src/shared/ui/api/dto.ts \
  tests/support/ui/plan-dto.ts src/i18n/messages
git commit -m "feat(reporting): show spending by group with drill-down to categories and subcategories (Refs #78)"
```

If the staged candidate is over ~500 lines, commit it in two passes at the named split point:
1. `spending-tree.ts`, its test, `dto.ts` and the builder: `feat(reporting): normalize spending by group into one drillable tree (Refs #78)`;
2. the rest: `feat(reporting): show spending by group with drill-down to categories and subcategories (Refs #78)`.

---

### Task 12: The unified personal view

The Unified artboard. HU-E9-11's "Unified view totals across spaces" is at component level here; its `@e2e` run is Task 17b. "Movements recorded as a guest are labelled outside the app" is covered too. In the personal space, the Plan tab opens on My spending (ruling P200). The view shows:
- consumption, and cash out;
- where the cash out comes from: payments, fund contributions, savings transfers, and "paid outside the app" when there is any;
- consumption by category: merged seeded rows by their name, and custom rows as "space / category";
- a notice for spaces in another currency.

The period is the personal space's (D11).

**Files:**
- Create: `src/modules/reporting/ui/unified/{unified-view.tsx, unified-container.tsx, unified.test.tsx}`, `src/modules/reporting/ui/plan-home.tsx`, `src/app/(web)/(app)/spaces/[spaceId]/plan/lines/page.tsx`
- Modify: `src/modules/reporting/ui/{views.ts, views.test.ts, server.ts}`, `src/app/(web)/(app)/spaces/[spaceId]/plan/page.tsx`, `src/shared/ui/api/dto.ts`, `tests/support/ui/plan-dto.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `DashboardFrame` (`plan={null}`: the unified view reads no plan), `periodLabel`, `neighboursOf`, `spaceOf`, `formatMoney`, `barWidth`.
- Produces: `UnifiedViewDto` (dto); `UnifiedView({ view, formats })`; `loadUnified(api, { spaceId, period?, today })` (the period's label from the personal space's periods; the report from `GET /api/v1/me/unified-view?period=`); `UnifiedViewContainer({ spaceId, period? })`; `PlanHomeContainer({ spaceId, period? })` (the Plan tab's own page: `UnifiedViewContainer` for a PERSONAL space, `LineDashboardContainer` for the others); builder `e74Unified(overrides?)`. `viewsFor("PERSONAL")` becomes `["mine", "lines"]`.

- [ ] **Step 1: Write the failing tests**

`tests/support/ui/plan-dto.ts`, appended (with `UnifiedViewDto` imported):

```ts
/** HU-E7-04's November 2026 for Ana: consumption 1,575,000 COP and cash out 2,625,000 COP. */
export const e74Unified = (overrides: Partial<UnifiedViewDto> = {}): UnifiedViewDto => ({
  currency: "COP",
  period: { ...NOVEMBER },
  consumption: {
    total: cop(1_575_000),
    categories: [
      { key: "groceries", name: "Groceries", space: null, category: null, amount: cop(1_035_000) },
      { key: "rent", name: "Rent", space: null, category: null, amount: cop(480_000) },
      { key: "restaurants", name: "Restaurants", space: null, category: null, amount: cop(60_000) },
    ],
  },
  cashOut: {
    total: cop(2_625_000),
    payments: cop(2_145_000),
    fundContributions: cop(480_000),
    savingsTransfers: cop(0),
    outsideTheApp: cop(0),
  },
  otherCurrencySpaces: [],
  ...overrides,
});
```

`views.test.ts`: `expect(viewsFor("PERSONAL")).toEqual(["mine", "lines"]);` and `expect(viewHref({ id: "sp-personal", kind: "PERSONAL" }, "lines")).toBe("/spaces/sp-personal/plan/lines");`.

`src/modules/reporting/ui/unified/unified.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { e74Unified, NOVEMBER } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { loadUnified } from "./unified-container";
import { UnifiedView } from "./unified-view";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

const textOf = (name: string) => normalized(screen.getByRole("region", { name }).textContent);

describe("unified personal view (HU-E9-11)", () => {
  it("shows consumption and cash out, and Groceries of both spaces as one row", async () => {
    const { container } = renderWithIntl(<UnifiedView view={e74Unified()} formats={BUILT_IN_FORMATS} />);
    expect(textOf("Consumo")).toContain("$ 1.575.000");
    expect(textOf("Salidas")).toContain("$ 2.625.000");
    const outs = textOf("De dónde salen las salidas");
    expect(outs).toContain("Pagos de gastos$ 2.145.000");
    expect(outs).toContain("Aportes al fondo$ 480.000");
    expect(outs).not.toContain("Pagado fuera de la app");
    const groceries = screen.getAllByRole("listitem", { name: "Groceries" });
    expect(groceries).toHaveLength(1);
    expect(normalized(groceries[0]!.textContent)).toContain("$ 1.035.000");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("lists what a guest paid as paid outside the app, and names a custom category by its space", () => {
    const pedro = e74Unified({
      period: { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" },
      consumption: {
        total: cop(100_000),
        categories: [
          { key: null, name: "Vet", space: { id: "sp-household", name: "Household" }, category: { id: "c-vet", name: "Vet" }, amount: cop(100_000) },
        ],
      },
      cashOut: { total: cop(300_000), payments: cop(0), fundContributions: cop(0), savingsTransfers: cop(0), outsideTheApp: cop(300_000) },
    });
    renderWithIntl(<UnifiedView view={pedro} formats={BUILT_IN_FORMATS} />);
    expect(textOf("De dónde salen las salidas")).toContain("Pagado fuera de la app$ 300.000");
    expect(screen.getByRole("listitem", { name: "Household / Vet" })).toBeInTheDocument();
  });

  it("says which spaces in another currency it leaves out", () => {
    renderWithIntl(
      <UnifiedView
        view={e74Unified({ otherCurrencySpaces: [{ spaceId: "sp-trip", name: "Trip", currency: "USD" }] })}
        formats={BUILT_IN_FORMATS}
      />,
    );
    expect(screen.getByText("Trip está en USD y no se suma aquí.")).toBeInTheDocument();
  });

  it("reads the period of the personal space and the caller's own unified view", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [{ ...NOVEMBER }] }),
      "GET /api/v1/me/unified-view": () => jsonResponse(e74Unified()),
    });
    const result = await loadUnified(api, { spaceId: "sp-personal", today: "2026-11-15" });
    expect(result.ok && result.data.view.consumption.total).toEqual(cop(1_575_000));
    const report = requests.find((r) => r.url.includes("unified-view"))!;
    expect(new URL(report.url).searchParams.get("period")).toBe("2026-11");
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-personal/periods");
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/ui/views.test.ts` and `pnpm exec vitest run --project ui src/modules/reporting/ui/unified`
Expected: FAIL.

- [ ] **Step 3: Implement**

`dto.ts`: `export type UnifiedViewDto = Json<paths["/api/v1/me/unified-view"]["get"]["responses"][200]>;`. `views.ts`: `const PERSONAL_VIEWS: readonly PlanView[] = ["mine", "lines"];`.

`src/modules/reporting/ui/unified/unified-view.tsx` (no `"use client"`):
- Two summary `section`s:
  - one labelled `reports.unified.consumption`, with `formatMoney(consumption.total)` and the hint `reports.unified.consumptionHint`;
  - one labelled `reports.unified.cashOut`, with `formatMoney(cashOut.total)` and the hint `reports.unified.cashOutHint`.
- A `section` labelled by its `h2` `reports.unified.sources`, with a `dl` of `reports.unified.payments`, `reports.unified.fundContributions` and `reports.unified.savingsTransfers`, and `reports.outsideTheApp` only when `outsideTheApp.amount !== "0"`. Each `dd` is `formatMoney`.
- A `section` labelled by its `h2` `reports.unified.byCategory`: a `ul` of the categories, in the API's order. Each `li` is named by its label: `reports.spaceScoped` with `{space}` and `{name}` when `space` is set, else `name`. It shows `formatMoney(amount)` and an `aria-hidden` bar at `barWidth(amount, categories[0].amount)` (the largest row fills the bar). With no categories, the `p` `reports.unified.empty`.
- One `p` per `otherCurrencySpaces` entry: `reports.unified.otherCurrency` with `{name}` and `{currency}`.

`unified-container.tsx`: `loadUnified(api, { spaceId, period, today })` takes the label with `periodLabel(api, spaceId, period, today)` (the personal space's periods, D11), then reads `api.GET("/api/v1/me/unified-view", { params: { query: { period: label } } })` and `neighboursOf(api, spaceId, view.period)`. `UnifiedViewContainer` frames it with `view="mine"` and `plan={null}`.

`src/modules/reporting/ui/plan-home.tsx` (server):

```tsx
import { getSpaces } from "@/shared/ui/api/server";
import { LineDashboardContainer } from "./lines/lines-container";
import { spaceOf } from "./report-period";
import { UnifiedViewContainer } from "./unified/unified-container";

/** Ruling P200: the Plan tab's own page is My spending in the personal space and Lines in a shared one. */
export async function PlanHomeContainer({ spaceId, period }: { readonly spaceId: string; readonly period?: string }) {
  const space = spaceOf(await getSpaces(), spaceId);
  return space.kind === "PERSONAL" ? (
    <UnifiedViewContainer spaceId={spaceId} period={period} />
  ) : (
    <LineDashboardContainer spaceId={spaceId} period={period} />
  );
}
```

`server.ts` exports `PlanHomeContainer` and `UnifiedViewContainer`. `plan/page.tsx` renders `<PlanHomeContainer spaceId={spaceId} period={period} />`. The new `plan/lines/page.tsx` renders `<LineDashboardContainer spaceId={spaceId} period={period} />` with the title `reports.view.lines`.

Catalog keys (`reports.unified`, plus `reports.outsideTheApp`), es / en:
- `consumption` Consumo / Consumption;
- `consumptionHint` Lo que fue para ti: tus gastos y tu parte de los compartidos. / What was for you: your expenses and your share of shared ones.;
- `cashOut` Salidas / Cash out; `cashOutHint` Lo que salió de tus bolsillos. / What left your pockets.;
- `sources` De dónde salen las salidas / Where the cash out comes from;
- `payments` Pagos de gastos / Expense payments; `fundContributions` Aportes al fondo / Fund contributions; `savingsTransfers` Transferencias a tus ahorros / Transfers to your savings;
- `byCategory` Consumo por categoría / Consumption by category;
- `empty` No consumiste nada en este período. / You consumed nothing in this period.;
- `otherCurrency` {name} está en {currency} y no se suma aquí. / {name} is in {currency} and is not added here.;
- `reports.outsideTheApp` Pagado fuera de la app / Paid outside the app.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, `pnpm exec vitest run --project ui src/modules/reporting/ui`, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/reporting/ui "src/app/(web)/(app)/spaces/[spaceId]/plan" src/shared/ui/api/dto.ts \
  tests/support/ui/plan-dto.ts src/i18n/messages
git commit -m "feat(reporting): show the unified personal view as the personal space's Plan tab (Refs #79)"
```

---

### Task 13: Personal spending by group

The PersonalByGroup artboard and HU-E9-11's "Spending by group merges seeded groups and labels custom ones by space". The personal Plan tab's By group view loads `GET /api/v1/me/reports/spending-by-group` once. It reuses Task 11's `treeOf`, `SpendingChart` and `DrillBreadcrumb`. Seeded rows arrive merged by catalog key. A custom group, category or subcategory carries its `space`, and `NodeLabel` writes it through `reports.spaceScoped`.

**Files:**
- Create: `src/modules/reporting/ui/by-group/personal-by-group-container.tsx`, `src/modules/reporting/ui/by-group/personal-by-group.test.tsx`, `src/modules/reporting/ui/by-group/groups-home.tsx`
- Modify: `src/modules/reporting/ui/{views.ts, views.test.ts, server.ts}`, `src/app/(web)/(app)/spaces/[spaceId]/plan/groups/page.tsx`, `tests/support/ui/plan-dto.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `treeOf`, `SpendingChart` (Task 11); `periodLabel`, `neighboursOf`, `DashboardFrame`.
- Produces: `loadPersonalByGroup(api, { spaceId, period?, today })`; `PersonalSpendingByGroupContainer`; `GroupsHomeContainer({ spaceId, period? })` (the personal or the space's view, by kind); builder `e74Groups()`. `viewsFor("PERSONAL")` becomes `["mine", "groups", "lines"]`.

- [ ] **Step 1: Write the failing tests**

`tests/support/ui/plan-dto.ts`, appended (with `PersonalSpendingByGroupDto` imported):

```ts
type PersonalGroup = PersonalSpendingByGroupDto["groups"][number];
type PersonalCategory = PersonalGroup["categories"][number];
const household = { id: "sp-household", name: "Household" };
const personalCategory = (
  name: string,
  pesos: number,
  share: string,
  extra: Partial<PersonalCategory> = {},
): PersonalCategory => ({
  id: null,
  key: name.toLowerCase(),
  name,
  archived: false,
  total: cop(pesos),
  share,
  space: null,
  subcategories: [{ subcategoryId: null, name: null, archived: false, total: cop(pesos), share: "100.00", space: null }],
  ...extra,
});

/** HU-E9-11 "Spending by group": Food and Housing merged by key, the custom "Pets" of Household by its space. */
export const e74Groups = (): PersonalSpendingByGroupDto => ({
  currency: "COP",
  period: { ...NOVEMBER },
  total: cop(1_600_000),
  groups: [
    {
      id: null,
      key: "food",
      name: "Food",
      archived: false,
      total: cop(1_095_000),
      share: "68.44",
      space: null,
      categories: [personalCategory("Groceries", 1_035_000, "94.52"), personalCategory("Restaurants", 60_000, "5.48")],
    },
    {
      id: null,
      key: "housing",
      name: "Housing",
      archived: false,
      total: cop(480_000),
      share: "30.00",
      space: null,
      categories: [personalCategory("Rent", 480_000, "100.00")],
    },
    {
      id: "g-pets",
      key: null,
      name: "Pets",
      archived: false,
      total: cop(25_000),
      share: "1.56",
      space: household,
      categories: [personalCategory("Vet", 25_000, "100.00", { id: "c-vet", key: null, space: household })],
    },
  ],
});
```

`views.test.ts`: `expect(viewsFor("PERSONAL")).toEqual(["mine", "groups", "lines"]);`.

`src/modules/reporting/ui/by-group/personal-by-group.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { normalized } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { e74Groups, NOVEMBER } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { loadPersonalByGroup } from "./personal-by-group-container";
import { SpendingChart } from "./spending-chart";
import { treeOf } from "./spending-tree";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

const rows = () =>
  screen
    .getAllByRole("listitem")
    .filter((li) => li.querySelector("[data-cell]"))
    .map((li) => [...li.querySelectorAll("[data-cell]")].map((c) => normalized(c.textContent).trim()));

describe("personal spending by group (HU-E9-11)", () => {
  it("merges seeded groups, labels a custom one by its space and drills into Food", async () => {
    const data = e74Groups();
    renderWithIntl(<SpendingChart tree={treeOf(data.groups)} total={data.total} formats={BUILT_IN_FORMATS} note="Nota" />);
    expect(rows()).toEqual([
      ["Food", "$ 1.095.000", "68,44 %"],
      ["Housing", "$ 480.000", "30,00 %"],
      ["Household / Pets", "$ 25.000", "1,56 %"],
    ]);
    await userEvent.click(screen.getByRole("button", { name: /^Food/ }));
    expect(rows()).toEqual([
      ["Groceries", "$ 1.035.000", "94,52 %"],
      ["Restaurants", "$ 60.000", "5,48 %"],
    ]);
  });

  it("reads the caller's own report for the personal space's period", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [{ ...NOVEMBER }] }),
      "GET /api/v1/me/reports/spending-by-group": () => jsonResponse(e74Groups()),
    });
    await loadPersonalByGroup(api, { spaceId: "sp-personal", today: "2026-11-15" });
    const report = requests.find((r) => r.url.includes("/me/reports/spending-by-group"))!;
    expect(new URL(report.url).searchParams.get("period")).toBe("2026-11");
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/ui/views.test.ts` and `pnpm exec vitest run --project ui src/modules/reporting/ui/by-group`
Expected: FAIL — `./personal-by-group-container` does not exist and the PERSONAL views lack `groups`.

- [ ] **Step 3: Implement**

`views.ts`: `PERSONAL_VIEWS` = `["mine", "groups", "lines"]`.

`personal-by-group-container.tsx`: `loadPersonalByGroup` resolves the label from the personal space's periods and reads `GET /api/v1/me/reports/spending-by-group?period=` and the neighbours. `PersonalSpendingByGroupContainer` frames it with `view="groups"` and `plan={null}`, and renders `SpendingChart` with `note={t("byGroup.personalNote")}`.

`groups-home.tsx` (server): `GroupsHomeContainer` chooses `PersonalSpendingByGroupContainer` for a PERSONAL space and `SpendingByGroupContainer` for the others, like `PlanHomeContainer`. `server.ts` exports it, and `plan/groups/page.tsx` renders it.

Catalog key, es / en: `reports.byGroup.personalNote` Tus gastos y tu parte de los compartidos, en todos tus espacios. Los grupos que trae Hearth se unen; los que creó un espacio llevan su nombre. / Your expenses and your share of shared ones, across all your spaces. Hearth's own groups are merged; groups a space created carry its name.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/reporting/ui "src/app/(web)/(app)/spaces/[spaceId]/plan/groups" tests/support/ui/plan-dto.ts \
  src/i18n/messages
git commit -m "feat(reporting): show personal spending by group with merged rows and space-scoped names (Refs #79)"
```

---

### Task 14a: Recharts behind a dynamic import

The toolchain for the two time-series charts (ruling P202, P203). It installs `recharts` 3.10.1 and its peer `react-is` 19.3.0. It adds two dependency-cruiser rules, each pinned by a fixture:
- `recharts` may be imported only by `src/modules/reporting/ui/charts/*-chart.tsx`;
- those files are reached only through a dynamic `import()`.

Together they keep every route without a chart free of the chunk. The task also builds the chart pieces:
- `ChartFrame`: a `figure` with its `figcaption` and a fixed height, so no layout shift;
- `LazyTrendChart`: it fetches the chart's chunk once after mount and shows a placeholder of the same size until then. This is M6a's lazy `Sheet` pattern, from Task 19;
- `TrendChart`: the Recharts line chart, `aria-hidden`, without Recharts' accessibility layer, the table next to it being the accessible source (ruling P220).

Test files `*.test.tsx` join `*.test.ts` in dependency-cruiser's exclusions (ruling P223), because a chart's test may import it directly.

**Files:**
- Create: `src/modules/reporting/ui/charts/{trend-series.ts, trend-series.test.ts, trend-chart-props.ts, chart-frame.tsx, lazy-trend-chart.tsx, lazy-trend-chart.test.tsx, trend-chart.tsx}`, `tests/architecture/fixtures/chart-imported-statically/src/modules/reporting/ui/{charts/trend-chart.tsx, trend.tsx}`, `tests/architecture/fixtures/recharts-outside-charts/src/modules/reporting/ui/trend.tsx`, `tests/architecture/fixtures/allowed/src/modules/reporting/ui/{charts/trend-chart.tsx, lazy.tsx}`
- Modify: `package.json`, `pnpm-lock.yaml`, `.dependency-cruiser.cjs`, `tests/architecture/boundaries.test.ts`

**Interfaces:**
- Consumes: `formatMoney`, `currencyOf`, `MoneyDto`.
- Produces:
  - `trend-series.ts`:
    - `interface TrendPoint { value: number | null; text: string | null }`;
    - `interface TrendSeries { key: string; label: string; points: readonly TrendPoint[] }`;
    - `interface TrendChartData { periods: readonly string[]; series: readonly TrendSeries[] }`;
    - `pointOf(money: MoneyDto | null, formats): TrendPoint` (major units for plotting only; the text from `formatMoney`);
    - `chartRows(data): Record<string, string | number | null>[]`;
    - `textAt(data, seriesKey, period): string | null`.
  - `trend-chart-props.ts`: `interface TrendChartProps { data: TrendChartData }`.
  - `ChartFrame({ caption, children })`, `LazyTrendChart(props: TrendChartProps)`, `preloadTrendChart(): Promise<void>`, and `TrendChart(props: TrendChartProps)`. `TrendChart`'s root carries `data-testid="trend-chart"` and `data-points` (the number of periods).
  - Dependency-cruiser rules `recharts-only-in-charts` and `charts-load-lazily`.

- [ ] **Step 1: Install**

Run: `pnpm add recharts@3.10.1 react-is@19.3.0`. Then confirm `pnpm check:pinned` passes, and `npm view recharts@3.10.1 time` and `npm view react-is@19.3.0 time` give 2026-07-25 and 2026-09-09 (on or before 2026-10-07).

- [ ] **Step 2: Write the failing tests**

`src/modules/reporting/ui/charts/trend-series.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cop } from "../../../../../tests/support/ui/dto";
import { BUILT_IN_FORMATS, NBSP } from "@/shared/ui/format/formatters";
import { chartRows, pointOf, textAt } from "./trend-series";

describe("trend series (ruling P202)", () => {
  it("plots major units and keeps each point's text from the app's formatter", () => {
    expect(pointOf(cop(1_300_000), BUILT_IN_FORMATS)).toEqual({ value: 1_300_000, text: `$${NBSP}1.300.000` });
    expect(pointOf(null, BUILT_IN_FORMATS)).toEqual({ value: null, text: null });
  });

  it("builds one row per period with one value per series, and finds a point's text", () => {
    const data = {
      periods: ["octubre 2026", "noviembre 2026"],
      series: [
        { key: "l-home", label: "Home", points: [pointOf(cop(1_350_000), BUILT_IN_FORMATS), pointOf(cop(1_300_000), BUILT_IN_FORMATS)] },
        { key: "l-pets", label: "Pets", points: [pointOf(null, BUILT_IN_FORMATS), pointOf(cop(80_000), BUILT_IN_FORMATS)] },
      ],
    };
    expect(chartRows(data)).toEqual([
      { period: "octubre 2026", "l-home": 1_350_000, "l-pets": null },
      { period: "noviembre 2026", "l-home": 1_300_000, "l-pets": 80_000 },
    ]);
    expect(textAt(data, "l-pets", "noviembre 2026")).toBe(`$${NBSP}80.000`);
    expect(textAt(data, "l-pets", "octubre 2026")).toBeNull();
  });
});
```

`src/modules/reporting/ui/charts/lazy-trend-chart.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop } from "../../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { ChartFrame } from "./chart-frame";
import { LazyTrendChart } from "./lazy-trend-chart";
import { pointOf } from "./trend-series";

const periods = ["junio 2026", "julio 2026", "agosto 2026", "septiembre 2026", "octubre 2026", "noviembre 2026"];
const data = {
  periods,
  series: [{ key: "me", label: "Consumo", points: periods.map((_, i) => pointOf(cop(1_000_000 + i * 100_000), BUILT_IN_FORMATS)) }],
};

describe("lazy trend chart (ruling P202, P220)", () => {
  it("shows a placeholder of the same size, then the chart from its own chunk, hidden from assistive tech", async () => {
    const { container } = renderWithIntl(
      <ChartFrame caption="Mi consumo por período">
        <LazyTrendChart data={data} />
      </ChartFrame>,
    );
    expect(screen.getByRole("figure", { name: "Mi consumo por período" })).toBeInTheDocument();
    const chart = await screen.findByTestId("trend-chart");
    expect(chart).toHaveAttribute("data-points", "6");
    expect(chart).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("[data-chart-placeholder]")).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });
});
```

The boundary fixtures:
- `tests/architecture/fixtures/chart-imported-statically/src/modules/reporting/ui/charts/trend-chart.tsx` holds `export const TrendChart = () => null;`;
- `…/chart-imported-statically/src/modules/reporting/ui/trend.tsx` holds `import { TrendChart } from "./charts/trend-chart";` and `export const Trend = TrendChart;`;
- `tests/architecture/fixtures/recharts-outside-charts/src/modules/reporting/ui/trend.tsx` holds `import { LineChart } from "recharts";` and `export const Trend = LineChart;`;
- the allowed fixture gains `tests/architecture/fixtures/allowed/src/modules/reporting/ui/charts/trend-chart.tsx`, with `import { LineChart } from "recharts";` and `export const TrendChart = LineChart;`;
- and `…/allowed/src/modules/reporting/ui/lazy.tsx`, with `export const load = () => import("./charts/trend-chart");`.

`tests/architecture/boundaries.test.ts`, in the `it.each` table after the line `["ui-crosses-module-ui", "ui-modules-only-through-public-ui-api"],` add:

```ts
    ["chart-imported-statically", "charts-load-lazily"],
    ["recharts-outside-charts", "recharts-only-in-charts"],
```

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/ui/charts tests/architecture/boundaries.test.ts` and `pnpm exec vitest run --project ui src/modules/reporting/ui/charts`
Expected: FAIL — the chart modules do not exist and the two rules are not defined.

- [ ] **Step 4: Write the rules and the chart**

`.dependency-cruiser.cjs`: after the `only-ui-reaches-ui` rule add

```js
    {
      name: "recharts-only-in-charts",
      severity: "error",
      comment:
        "Ruling P202 (M6c): Recharts is imported only by src/modules/reporting/ui/charts/*-chart.tsx, the files the lazy chart wrapper loads with import().",
      from: { pathNot: "^src/modules/reporting/ui/charts/[^/]+-chart\\.tsx$" },
      to: { path: "node_modules/recharts/" },
    },
    {
      name: "charts-load-lazily",
      severity: "error",
      comment:
        "Ruling P202 (M6c): a chart file is reached only through a dynamic import(), so a route without a chart never ships Recharts.",
      from: {},
      to: { path: "^src/modules/reporting/ui/charts/[^/]+-chart\\.tsx$", dynamic: false },
    },
```

and change `exclude: { path: ["^tests/architecture/fixtures/", "\\.test\\.(ts|mjs)$"] }` to `exclude: { path: ["^tests/architecture/fixtures/", "\\.test\\.(ts|tsx|mjs)$"] }` (ruling P223; this also settles M6a's preflight note N7).

`src/modules/reporting/ui/charts/trend-series.ts`:

```ts
import type { MoneyDto } from "@/shared/ui/api/dto";
import { currencyOf } from "@/shared/ui/format/currencies";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";

/** A chart coordinate (major units, for plotting only) and the figure as the app writes it (for the tooltip). */
export interface TrendPoint {
  readonly value: number | null;
  readonly text: string | null;
}
export interface TrendSeries {
  readonly key: string;
  readonly label: string;
  readonly points: readonly TrendPoint[];
}
export interface TrendChartData {
  readonly periods: readonly string[];
  readonly series: readonly TrendSeries[];
}

/** Ruling P202: `Number` only positions a point; every figure shown is the API's string through `formatMoney`. */
export const pointOf = (money: MoneyDto | null, formats: Pick<Formats, "numberFormat">): TrendPoint =>
  money === null
    ? { value: null, text: null }
    : {
        value: Number(money.amount) / 10 ** currencyOf(money.currency).exponent,
        text: formatMoney(money, formats),
      };

export const chartRows = (data: TrendChartData): Record<string, string | number | null>[] =>
  data.periods.map((period, index) => ({
    period,
    ...Object.fromEntries(data.series.map((series) => [series.key, series.points[index]?.value ?? null])),
  }));

export const textAt = (data: TrendChartData, seriesKey: string, period: string): string | null =>
  data.series.find((s) => s.key === seriesKey)?.points[data.periods.indexOf(period)]?.text ?? null;
```

`trend-chart-props.ts`: `import type { TrendChartData } from "./trend-series";` and `export interface TrendChartProps { readonly data: TrendChartData; }`. It is a separate file because `charts-load-lazily` counts type-only imports too (`tsPreCompilationDeps`).

`chart-frame.tsx` (no `"use client"`): `ChartFrame({ caption, children })` renders `<figure className="flex flex-col gap-2"><figcaption className="text-sm font-medium text-ink">{caption}</figcaption><div className="h-56 w-full">{children}</div></figure>`. The 224 px height stays the same before and after the chunk loads, so CLS stays 0.

`lazy-trend-chart.tsx`:

```tsx
"use client";

import { useEffect, useState, type ComponentType } from "react";
import type { TrendChartProps } from "./trend-chart-props";

let loaded: ComponentType<TrendChartProps> | undefined;
let loading: Promise<void> | undefined;

/** Ruling P202: the Recharts chunk, fetched once and only by a page that draws a chart (M6a's lazy Sheet pattern). */
export const preloadTrendChart = (): Promise<void> =>
  (loading ??= import("./trend-chart").then((module) => {
    loaded = module.TrendChart;
  }));

export function LazyTrendChart(props: TrendChartProps) {
  const [Chart, setChart] = useState<ComponentType<TrendChartProps> | undefined>(() => loaded);
  useEffect(() => {
    if (!Chart) void preloadTrendChart().then(() => setChart(() => loaded));
  }, [Chart]);
  return Chart ? (
    <Chart {...props} />
  ) : (
    <div aria-hidden="true" data-chart-placeholder className="size-full rounded-xl bg-track" />
  );
}
```

`trend-chart.tsx` (`"use client"`), the only importer of `recharts`:
- the root is a `div ref` with `aria-hidden="true"`, `data-testid="trend-chart"`, `data-points={data.periods.length}` and `className="size-full"`;
- the width comes from a `ResizeObserver` on that `div`. It starts at 320 and is skipped when `ResizeObserver` is undefined, as in jsdom. The height is 224;
- inside, `<LineChart width={width} height={224} data={chartRows(data)} accessibilityLayer={false}>` with `CartesianGrid vertical={false}`, `XAxis dataKey="period" tickLine={false}`, and `YAxis hide`;
- a `Tooltip` whose `formatter` returns `textAt(data, String(dataKey), String(payload.period))`, so the tooltip writes `$ 1.300.000` in the person's format;
- one `Line` per series: `dataKey={series.key}`, `name={series.label}`, `isAnimationActive={false}`, `dot`, `connectNulls={false}`, and `stroke` from the theme's `var(--color-accent)`, `var(--color-owe)` and `var(--color-muted)`, in that order and cycling;
- no Recharts `Legend`: the table names the series.

- [ ] **Step 5: Run the tests and the gates**

Run: Step 3's commands, then every gate, `pnpm lint:boundaries` included.
Expected: PASS. Deleting `dynamic: false` from the rule makes the "allowed" fixture fail, which confirms the rule tells `import()` apart. Revert.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml .dependency-cruiser.cjs tests/architecture src/modules/reporting/ui/charts
git commit -m "build(web): add recharts 3.10.1 behind a lazy chart that only chart routes load (Refs #79)"
```

---

### Task 14b: The personal trend

The PersonalTrend artboard and HU-E9-11's "Six-period personal consumption chart". The personal Plan tab's Trend view shows:
- the caller's consumption over the window, six periods by default and twelve by choice: a line chart and a table of the same figures, newest first;
- each period's change, signed with two decimals;
- the badge `reports.trend.new` after a period without consumption.

`ChangeText` writes a change once for both trend views (ruling P219).

**Files:**
- Create: `src/modules/reporting/ui/trend/{change-text.tsx, personal-trend.tsx, personal-trend-container.tsx, personal-trend.test.tsx, trend-home.tsx}`, `src/app/(web)/(app)/spaces/[spaceId]/plan/trend/page.tsx`
- Modify: `src/modules/reporting/ui/{views.ts, views.test.ts, server.ts}`, `src/shared/ui/api/dto.ts`, `tests/support/ui/plan-dto.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `ChartFrame`, `LazyTrendChart`, `pointOf` (Task 14a); `usePeriodText`, `formatMoney`, `formatSignedMoney`, `formatPercent`, `Badge`; `DashboardFrame`, `periodLabel`, `neighboursOf`.
- Produces:
  - `PersonalTrendDto` (dto);
  - `ChangeText({ change, changePercent, changeStatus, formats, increaseIsBad? })`;
  - `PersonalTrend({ space, trend, formats, periods })`, where `periods` is the window: 6 or 12;
  - `windowOf(asked: string | undefined): 6 | 12`;
  - `loadPersonalTrend(api, { spaceId, period?, periods, today })`, `PersonalTrendContainer`, and `TrendHomeContainer({ spaceId, period?, periods? })` (the personal trend for a PERSONAL space; `notFound()` for the others until Task 15);
  - builder `sixMonthsTrend()`;
  - `viewsFor("PERSONAL")` becomes `["mine", "groups", "trend", "lines"]`.

- [ ] **Step 1: Write the failing tests**

`tests/support/ui/plan-dto.ts`, appended (with `PersonalTrendDto` imported):

```ts
const month = (label: string, last: number) => ({
  label,
  startDate: `${label}-01`,
  endDate: `${label}-${String(last).padStart(2, "0")}`,
});

/** HU-E9-11 "Six-period personal consumption chart": Ana's consumption from 2026-06 to 2026-11. */
export const sixMonthsTrend = (): PersonalTrendDto => ({
  currency: "COP",
  periods: [month("2026-06", 30), month("2026-07", 31), month("2026-08", 31), month("2026-09", 30), month("2026-10", 31), month("2026-11", 30)],
  points: [
    { period: "2026-06", consumption: cop(1_400_000), change: null, changePercent: null, changeStatus: "NEW" },
    { period: "2026-07", consumption: cop(1_450_000), change: cop(50_000), changePercent: "3.57", changeStatus: "INCREASED" },
    { period: "2026-08", consumption: cop(1_450_000), change: cop(0), changePercent: "0.00", changeStatus: "UNCHANGED" },
    { period: "2026-09", consumption: cop(1_300_000), change: cop(-150_000), changePercent: "-10.34", changeStatus: "DECREASED" },
    { period: "2026-10", consumption: cop(1_500_000), change: cop(200_000), changePercent: "15.38", changeStatus: "INCREASED" },
    { period: "2026-11", consumption: cop(1_575_000), change: cop(75_000), changePercent: "5.00", changeStatus: "INCREASED" },
  ],
});
```

`views.test.ts`: `viewsFor("PERSONAL")` is `["mine", "groups", "trend", "lines"]`.

`src/modules/reporting/ui/trend/personal-trend.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { normalized, spaceDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { NOVEMBER, sixMonthsTrend } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { loadPersonalTrend, windowOf } from "./personal-trend-container";
import { PersonalTrend } from "./personal-trend";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

describe("personal trend (HU-E9-11)", () => {
  it("draws 6 points from 2026-06 to 2026-11 and lists the same figures in its table", async () => {
    const { container } = renderWithIntl(
      <PersonalTrend space={spaceDto()} trend={sixMonthsTrend()} formats={BUILT_IN_FORMATS} periods={6} />,
    );
    expect(screen.getByRole("figure", { name: "Mi consumo por período" })).toBeInTheDocument();
    expect(await screen.findByTestId("trend-chart")).toHaveAttribute("data-points", "6");
    const rows = within(screen.getByRole("table", { name: "Consumo por período" }))
      .getAllByRole("row")
      .slice(1)
      .map((row) => normalized(row.textContent));
    expect(rows).toHaveLength(6);
    expect(rows[0]).toContain("noviembre 2026");
    expect(rows[0]).toContain("$ 1.575.000");
    expect(rows[0]).toContain("+$ 75.000 (+5,00 %)");
    expect(rows[2]).toContain("−$ 150.000 (−10,34 %)");
    expect(rows[5]).toContain("junio 2026");
    expect(rows[5]).toContain("Nueva");
    expect(screen.getByRole("link", { name: "12 períodos" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/plan/trend?period=2026-11&periods=12",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("asks for the chosen window ending in the period", async () => {
    expect([windowOf(undefined), windowOf("12"), windowOf("7")]).toEqual([6, 12, 6]);
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [{ ...NOVEMBER }] }),
      "GET /api/v1/me/trend": () => jsonResponse(sixMonthsTrend()),
    });
    await loadPersonalTrend(api, { spaceId: "sp-personal", periods: 12, today: "2026-11-15" });
    const query = new URL(requests.find((r) => r.url.includes("/me/trend"))!.url).searchParams;
    expect([query.get("endPeriod"), query.get("periods")]).toEqual(["2026-11", "12"]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/ui/views.test.ts` and `pnpm exec vitest run --project ui src/modules/reporting/ui/trend`
Expected: FAIL.

- [ ] **Step 3: Implement**

`dto.ts`: `export type PersonalTrendDto = Json<paths["/api/v1/me/trend"]["get"]["responses"][200]>;`. `views.ts`: `PERSONAL_VIEWS` = `["mine", "groups", "trend", "lines"]`.

`change-text.tsx` (no `"use client"`): `ChangeText({ change, changePercent, changeStatus, formats, increaseIsBad = true })`.
- When `changeStatus` is null, render nothing.
- NEW renders `Badge icon="plus"` `reports.trend.new` and the text `reports.trend.noPrevious`.
- Otherwise it renders `formatSignedMoney(change)`, followed by ` (${formatPercent(changePercent, formats, { signed: true })})` when `changePercent` is set (it is null past 2^53 basis points), then a `Badge`:
  - INCREASED: `reports.trend.increased`, `icon="arrowUp"`, tone `owe` when `increaseIsBad`;
  - DECREASED: `reports.trend.decreased`, `icon="arrowDown"`, tone `accent`;
  - UNCHANGED: `reports.trend.unchanged`, `neutral`.

`personal-trend.tsx` (no `"use client"`; `LazyTrendChart` is the only client island):
- Labels: `const label = usePeriodText(); const names = trend.periods.map((p) => label(p, space.periodPolicy, formats));`.
- A row of two links, `reports.trend.window` with `{count}` 6 and 12. Each goes to `` `${viewHref(space, "trend", end)}&periods=${n}` `` (`end` is the last period's label), and the current one carries `aria-current="page"`.
- `ChartFrame caption={t("trend.personalCaption")}` around `<LazyTrendChart data={{ periods: names, series: [{ key: "me", label: t("unified.consumption"), points: trend.points.map((p) => pointOf(p.consumption, formats)) }] }} />`.
- A `table` with the visible caption `reports.trend.personalTable` and the columns `reports.trend.period`, `reports.trend.consumption` and `reports.trend.change`. Its rows are newest first: the period's name, `formatMoney(consumption)`, and `ChangeText`.

`personal-trend-container.tsx`:
- `windowOf(asked) => (asked === "12" ? 12 : 6)`;
- `loadPersonalTrend` resolves the end label from the personal space's periods, then reads `api.GET("/api/v1/me/trend", { params: { query: { endPeriod: label, periods } } })` and the neighbours of the last period;
- `PersonalTrendContainer({ spaceId, period, periods })` frames it with `view="trend"` and `plan={null}`.

`trend-home.tsx`: `TrendHomeContainer` renders `PersonalTrendContainer` for a PERSONAL space and `notFound()` otherwise. Task 15 replaces the `notFound()`. `server.ts` exports it.

Page `src/app/(web)/(app)/spaces/[spaceId]/plan/trend/page.tsx`: the title `reports.view.trend`; `searchParams` gives `{ period?: string; periods?: string }`; it renders `<TrendHomeContainer spaceId={spaceId} period={period} periods={windowOf(periods)} />`.

Catalog keys (`reports.trend`), es / en:
- `new` Nueva / New; `noPrevious` Sin período anterior / No previous period;
- `increased` Subió / Up; `decreased` Bajó / Down; `unchanged` Igual / Same;
- `window` {count} períodos / {count} periods;
- `personalCaption` Mi consumo por período / My spending by period; `personalTable` Consumo por período / Consumption by period;
- `period` Período / Period; `consumption` Consumo / Consumption; `change` Cambio / Change.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/reporting/ui "src/app/(web)/(app)/spaces/[spaceId]/plan/trend" src/shared/ui/api/dto.ts \
  tests/support/ui/plan-dto.ts src/i18n/messages
git commit -m "feat(reporting): chart the personal consumption trend with a table of the same figures (Refs #79)"
```

---

### Task 15: The line trend

The LineTrend artboard, and two HU-E9-11 scenarios: "Line trend versus the previous period" and "A new line shows a badge instead of a percentage". The shared Plan tab's Trend view follows every line of the end period's plan over the window. It shows:
- a line chart, one series per line;
- a horizontally scrollable table of spent per line and period, in a focusable region so the keyboard can scroll it;
- per line, the end period's spent and its change, with a badge: Down, Up, Same or New.

**Files:**
- Create: `src/modules/reporting/ui/trend/{line-trend.tsx, line-trend-container.tsx, line-trend.test.tsx}`
- Modify: `src/modules/reporting/ui/trend/trend-home.tsx`, `src/modules/reporting/ui/{views.ts, views.test.ts, server.ts}`, `src/shared/ui/api/dto.ts`, `tests/support/ui/plan-dto.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `ChangeText`, `windowOf` (Task 14b); `ChartFrame`, `LazyTrendChart`, `pointOf` (Task 14a); `DashboardFrame`, `usePeriodText`.
- Produces: `LineTrendDto` (dto); `LineTrend({ space, trend, formats, periods })`; `loadLineTrend(api, { spaceId, period?, periods, today })`; `LineTrendContainer`; builder `homeTrend()`. `viewsFor("SHARED")` becomes `["lines", "members", "fund", "groups", "trend"]`.

- [ ] **Step 1: Write the failing tests**

`tests/support/ui/plan-dto.ts`, appended (with `LineTrendDto` imported):

```ts
type TrendLine = LineTrendDto["lines"][number];
const quiet = (period: string) => ({ period, spent: null, change: null, changePercent: null, changeStatus: null });

/** HU-E9-11: Home spent 1,350,000 COP in 2026-10 and 1,300,000 COP in 2026-11; Pets exists only in 2026-11. */
export const homeTrend = (): LineTrendDto => {
  const periods = [month("2026-06", 30), month("2026-07", 31), month("2026-08", 31), month("2026-09", 30), month("2026-10", 31), month("2026-11", 30)];
  const early = periods.slice(0, 4).map((p) => quiet(p.label));
  const lines: TrendLine[] = [
    {
      lineId: "l-home",
      name: "Home",
      points: [
        ...early,
        { period: "2026-10", spent: cop(1_350_000), change: null, changePercent: null, changeStatus: "NEW" },
        { period: "2026-11", spent: cop(1_300_000), change: cop(-50_000), changePercent: "-3.70", changeStatus: "DECREASED" },
      ],
    },
    {
      lineId: "l-pets",
      name: "Pets",
      points: [
        ...early,
        quiet("2026-10"),
        { period: "2026-11", spent: cop(80_000), change: null, changePercent: null, changeStatus: "NEW" },
      ],
    },
  ];
  return { spaceId: "sp-household", periods, plan: { id: "p-nov", status: "ACTIVE" }, lines };
};
```

`views.test.ts`: `viewsFor("SHARED")` is `["lines", "members", "fund", "groups", "trend"]`.

`src/modules/reporting/ui/trend/line-trend.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { normalized } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { homeTrend, householdDto, NOVEMBER } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { loadLineTrend } from "./line-trend-container";
import { LineTrend } from "./line-trend";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

describe("line trend (HU-E9-11)", () => {
  it("shows Home at −50.000 (−3,70 %) and Pets with the New badge, chart and table from one series", async () => {
    const { container } = renderWithIntl(
      <LineTrend space={householdDto()} trend={homeTrend()} formats={BUILT_IN_FORMATS} periods={6} />,
    );
    const home = normalized(screen.getByRole("listitem", { name: "Home" }).textContent);
    expect(home).toContain("$ 1.300.000");
    expect(home).toContain("−$ 50.000 (−3,70 %)");
    expect(home).toContain("Bajó");
    const pets = normalized(screen.getByRole("listitem", { name: "Pets" }).textContent);
    expect(pets).toContain("Nueva");
    expect(pets).not.toContain("%");
    expect(await screen.findByTestId("trend-chart")).toHaveAttribute("data-points", "6");
    const table = screen.getByRole("table", { name: "Gastado por línea y período" });
    expect(normalized(table.textContent)).toContain("$ 1.350.000");
    expect(screen.getByRole("region", { name: "Gastado por línea y período" })).toHaveAttribute("tabindex", "0");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("says that a period without a plan has no lines to compare", () => {
    renderWithIntl(
      <LineTrend space={householdDto()} trend={{ ...homeTrend(), plan: null, lines: [] }} formats={BUILT_IN_FORMATS} periods={6} />,
    );
    expect(screen.getByText("Este período no tiene plan: no hay líneas que comparar.")).toBeInTheDocument();
  });

  it("asks for the window ending in the period", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [{ ...NOVEMBER }] }),
      "GET /api/v1/spaces/{spaceId}/reports/trend": () => jsonResponse(homeTrend()),
    });
    await loadLineTrend(api, { spaceId: "sp-household", period: "2026-11", periods: 6, today: "2026-10-31" });
    const query = new URL(requests.find((r) => r.url.includes("/reports/trend"))!.url).searchParams;
    expect([query.get("endPeriod"), query.get("periods")]).toEqual(["2026-11", "6"]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/ui/views.test.ts` and `pnpm exec vitest run --project ui src/modules/reporting/ui/trend`
Expected: FAIL.

- [ ] **Step 3: Implement**

`dto.ts`: `export type LineTrendDto = Json<paths["/api/v1/spaces/{spaceId}/reports/trend"]["get"]["responses"][200]>;`. `views.ts`: `SHARED_VIEWS` = `["lines", "members", "fund", "groups", "trend"]`.

`line-trend.tsx` (no `"use client"`):
- Without a plan: the `p` `reports.trend.noPlan`.
- Otherwise:
  - the window links, as in `PersonalTrend`;
  - `ChartFrame caption={t("trend.linesCaption")}` around `LazyTrendChart`, with one series per line (`key` lineId, `label` name, `points` from `spent`);
  - a `ul` with one `li` per line, named by its name. Each `li` holds the name, `reports.trend.spentIn` with `{period}` (the last period's name), `formatMoney` of the last point's `spent`, and `<ChangeText … increaseIsBad />` of the last point;
  - a `div role="region" aria-label={t("trend.linesTable")} tabIndex={0} className="overflow-x-auto"` around a `table`. The table has the same visually hidden caption, one column per period (its name) and one row per line (`th scope="row"` with the name). Each cell is `formatMoney(spent)`, or "—" with `VisuallyHidden` `reports.trend.noFigure` when `spent` is null;
  - the footnote `reports.trend.linesNote`.

`line-trend-container.tsx`: like the personal one, with `GET …/reports/trend?endPeriod=&periods=` and the space's own periods. In `trend-home.tsx`, a non-PERSONAL space now renders `<LineTrendContainer spaceId={spaceId} period={period} periods={periods} />`. `server.ts` exports `LineTrendContainer`.

Catalog keys (`reports.trend`), es / en:
- `noPlan` Este período no tiene plan: no hay líneas que comparar. / This period has no plan: there are no lines to compare.;
- `linesCaption` Gastado por línea / Spent by line; `linesTable` Gastado por línea y período / Spent by line and period;
- `spentIn` Gastado en {period} / Spent in {period}; `noFigure` Sin dato / No figure;
- `linesNote` Cada línea se compara con su línea de origen en el plan anterior. Lo gastado sin presupuesto no tiene tendencia. / Each line is compared with the line it was copied from in the previous plan. Unbudgeted spending has no trend.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/reporting/ui src/shared/ui/api/dto.ts tests/support/ui/plan-dto.ts src/i18n/messages
git commit -m "feat(reporting): chart each line's trend with its change against the previous period (Refs #79)"
```

---

### Task 15b: The cash-flow calendar of the next 30 and 60 days

Issue #150 on screen. The personal space's Plan tab gains a view, Próximos, at `/spaces/{spaceId}/plan/calendar?days=30|60` (ruling P241). It shows:
- a summary: today's available money, what comes in, what goes out, where it ends and the lowest balance with its date;
- the dates in order, each with its movements and the projected balance after it;
- a note for each space in another currency.

Every figure is a field of `GET /api/v1/me/cash-flow` (Task 1d), rendered by `formatMoney` and `formatSignedMoney` (ruling P201). It shows only known items, never a pace estimate (ruling P245). Dates are formatted from their `YYYY-MM-DD` text, never through a `Date`, so no time zone moves them (ruling P246). The calendar records nothing, so it has no bulk action to confirm (ruling P247). The screen is a Server Component with no client island and no chart. It is not a period view, so it has no period switcher, and its tab links carry no `?period=`.

**Depends on:**
- Task 1d (the endpoint);
- Task 2 (`formatSignedMoney`);
- Task 3 (`PlanTabs`, `viewsFor`, `viewHref`, `spaceOf`);
- Tasks 12, 13 and 14b (the personal space's views list, which this task extends last).

**Files:**
- Create: `src/modules/reporting/ui/calendar/{cash-flow-calendar.tsx, calendar-container.tsx, calendar.test.tsx}`, `src/app/(web)/(app)/spaces/[spaceId]/plan/calendar/page.tsx`
- Modify: `src/modules/reporting/ui/{views.ts, views.test.ts, plan-tabs.tsx, server.ts}`, `src/shared/ui/api/dto.ts`, `tests/support/ui/plan-dto.ts`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `PlanTabs`, `spaceOf`, `viewsFor`, `viewHref` (Task 3); `formatMoney`, `formatSignedMoney`, `formatDate`; `Badge`, `VisuallyHidden`, `ProblemNotice`; `loaded`, `serverApi`, `getMe`, `getSpaces`.
- Produces:
  - `dto.ts`: `CashFlowDto = Json<paths["/api/v1/me/cash-flow"]["get"]["responses"][200]>`;
  - `views.ts`: `PlanView` gains `"calendar"`; `viewsFor("PERSONAL")` becomes `["mine", "calendar", "groups", "trend", "lines"]`; `viewHref(space, "calendar", period?)` is always `/spaces/{id}/plan/calendar`, with no period; `calendarHref(space, days: 30 | 60): string`;
  - `PlanTabs({ space, view, period? })`: `period` becomes optional, and without it the links carry no `?period=`;
  - `CashFlowCalendar({ space, flow, formats })`; `daysOf(asked?: string): 30 | 60`; `loadCashFlow(api, days)`; `CalendarContainer({ spaceId, days? })`, exported from `reporting/ui/server.ts`;
  - builder `cashFlowDto(overrides?)` in `plan-dto.ts`.

- [ ] **Step 1: Write the builder and the failing tests**

`tests/support/ui/plan-dto.ts`, appended (`CashFlowDto` joins its type import):

```ts
type FlowMovement = CashFlowDto["dates"][number]["movements"][number];
const flowMovement = (overrides: Partial<FlowMovement>): FlowMovement => ({
  recurrenceId: "rec-internet",
  occurrenceId: null,
  type: "EXPENSE",
  description: "Internet",
  space: { id: "sp-household", name: "Household" },
  dueDate: "2026-11-05",
  status: "SCHEDULED",
  estimated: false,
  amount: cop(120_000),
  effect: cop(-120_000),
  ...overrides,
});

/** #150: Ana's next 30 days from 2026-10-28, with today's available money at 2,000,000 COP (Task 1d's shape). */
export const cashFlowDto = (overrides: Partial<CashFlowDto> = {}): CashFlowDto => ({
  currency: "COP",
  from: "2026-10-28",
  through: "2026-11-26",
  days: 30,
  opening: cop(2_000_000),
  dates: [
    {
      date: "2026-10-28",
      movements: [
        flowMovement({ recurrenceId: "rec-power", occurrenceId: "occ-power", description: "Energía", dueDate: "2026-10-20", status: "PENDING", estimated: true, amount: cop(180_000), effect: cop(-180_000) }),
      ],
      balanceAfter: cop(1_820_000),
    },
    {
      date: "2026-10-30",
      movements: [
        flowMovement({ recurrenceId: "rec-salary", type: "INCOME", description: "Salario", space: { id: "sp-personal", name: "Personal" }, dueDate: "2026-10-30", amount: cop(3_000_000), effect: cop(3_000_000) }),
      ],
      balanceAfter: cop(4_820_000),
    },
    {
      date: "2026-11-01",
      movements: [
        flowMovement({ recurrenceId: "rec-nequi", type: "TRANSFER", description: "A Nequi", space: { id: "sp-personal", name: "Personal" }, dueDate: "2026-11-01", amount: cop(100_000), effect: cop(0) }),
      ],
      balanceAfter: cop(4_820_000),
    },
    { date: "2026-11-05", movements: [flowMovement({})], balanceAfter: cop(4_700_000) },
  ],
  totals: { incoming: cop(3_000_000), outgoing: cop(300_000), closing: cop(4_700_000) },
  lowest: { date: "2026-10-28", balance: cop(1_820_000) },
  otherCurrencySpaces: [],
  ...overrides,
});
```

`src/modules/reporting/ui/views.test.ts`: `viewsFor("PERSONAL")` is `["mine", "calendar", "groups", "trend", "lines"]`, and add

```ts
    expect(viewHref({ id: "sp-personal", kind: "PERSONAL" }, "calendar", "2026-11")).toBe("/spaces/sp-personal/plan/calendar");
    expect(calendarHref({ id: "sp-personal", kind: "PERSONAL" }, 60)).toBe("/spaces/sp-personal/plan/calendar?days=60");
```

`src/modules/reporting/ui/calendar/calendar.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized, spaceDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { cashFlowDto } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { daysOf, loadCashFlow } from "./calendar-container";
import { CashFlowCalendar } from "./cash-flow-calendar";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

const personal = spaceDto();
const show = (flow = cashFlowDto()) =>
  renderWithIntl(<CashFlowCalendar space={personal} flow={flow} formats={BUILT_IN_FORMATS} />);
const day = (name: string) =>
  normalized(screen.getByRole("listitem", { name }).textContent);

describe("the cash-flow calendar (#150, ruling P241 of M6c)", () => {
  it("lists each date's movements and the balance after it, as the API answers them (@golden)", async () => {
    const { container } = show();
    expect(screen.getByRole("heading", { level: 1, name: "Próximos 30 días" })).toBeInTheDocument();
    const dates = within(screen.getByRole("list", { name: "Movimientos por día" }))
      .getAllByRole("listitem")
      .filter((item) => item.getAttribute("aria-labelledby"));
    expect(dates.map((item) => item.getAttribute("data-date"))).toEqual(["2026-10-28", "2026-10-30", "2026-11-01", "2026-11-05"]);
    expect(day("28/10/2026")).toContain("Energía");
    expect(day("28/10/2026")).toContain("Household");
    expect(day("28/10/2026")).toContain("Pendiente desde el 20/10/2026");
    expect(day("28/10/2026")).toContain("Estimado");
    expect(day("28/10/2026")).toContain("−$ 180.000");
    expect(day("28/10/2026")).toContain("Saldo proyectado $ 1.820.000");
    expect(day("30/10/2026")).toContain("+$ 3.000.000");
    expect(day("1/11/2026")).toContain("$ 100.000");
    expect(day("1/11/2026")).toContain("No cambia tu disponible");
    expect(day("1/11/2026")).not.toContain("+$");
    const summary = normalized(screen.getByRole("region", { name: "Resumen de lo que viene" }).textContent);
    expect(summary).toContain("Disponible hoy$ 2.000.000");
    expect(summary).toContain("Entra$ 3.000.000");
    expect(summary).toContain("Sale$ 300.000");
    expect(summary).toContain("Al final$ 4.700.000");
    expect(summary).toContain("Lo más bajo: $ 1.820.000 el 28/10/2026");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("renders the API's balances, never a running sum of its own (ruling P201)", () => {
    const flow = cashFlowDto();
    flow.dates[1] = { ...flow.dates[1]!, balanceAfter: cop(7) };
    show({ ...flow, lowest: { date: "2026-11-05", balance: cop(-1) } });
    expect(day("30/10/2026")).toContain("Saldo proyectado $ 7");
    const lowest = screen.getByText(/Lo más bajo/);
    expect(normalized(lowest.textContent)).toBe("Lo más bajo: −$ 1 el 5/11/2026");
    expect(lowest).toHaveClass("text-owe");
  });

  it("offers 30 and 60 days and keeps the Plan tab's views", () => {
    show();
    const window = screen.getByRole("navigation", { name: "Ventana" });
    expect(within(window).getByRole("link", { name: "30 días" })).toHaveAttribute("aria-current", "page");
    expect(within(window).getByRole("link", { name: "60 días" })).toHaveAttribute("href", "/spaces/sp-personal/plan/calendar?days=60");
    const tabs = screen.getByRole("navigation", { name: "Vistas del plan" });
    expect(within(tabs).getByRole("link", { name: "Próximos" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "Mi consumo" })).toHaveAttribute("href", "/spaces/sp-personal/plan");
  });

  it("says when nothing is scheduled, and names a space in another currency once", () => {
    show(cashFlowDto({ dates: [], otherCurrencySpaces: [{ spaceId: "sp-trip", name: "Viaje", currency: "USD" }] }));
    expect(screen.getByText("No hay movimientos programados en los próximos 30 días.")).toBeInTheDocument();
    expect(screen.getByText("Viaje usa USD: sus movimientos no se suman aquí.")).toBeInTheDocument();
  });

  it("places a movement by its local date, never shifted by a time zone (ruling P246 of M6c)", () => {
    const flow = cashFlowDto();
    show({ ...flow, dates: [{ ...flow.dates[3]!, date: "2027-03-15" }] });
    expect(screen.getByRole("listitem", { name: "15/3/2027" })).toHaveAttribute("data-date", "2027-03-15");
  });

  it("offers no action that records money: it only shows what is coming (ruling P247 of M6c)", () => {
    const { container } = show();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(container.querySelector("form")).toBeNull();
  });

  it("asks for the window it is given, 30 days unless 60 is asked for", async () => {
    expect([daysOf(undefined), daysOf("60"), daysOf("45")]).toEqual([30, 60, 30]);
    const { api, requests } = fakeApi({ "GET /api/v1/me/cash-flow": () => jsonResponse(cashFlowDto({ days: 60 })) });
    const result = await loadCashFlow(api, 60);
    expect(result.ok && result.data.days).toBe(60);
    expect(new URL(requests[0]!.url).searchParams.get("days")).toBe("60");
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project unit src/modules/reporting/ui/views.test.ts` and `pnpm exec vitest run --project ui src/modules/reporting/ui/calendar`
Expected: FAIL — there is no `calendar` view and no `./calendar-container`.

- [ ] **Step 3: Implement**

`src/shared/ui/api/dto.ts`: `export type CashFlowDto = Json<paths["/api/v1/me/cash-flow"]["get"]["responses"][200]>;`.

`src/modules/reporting/ui/views.ts`:
- `PlanView` gains `| "calendar"`;
- `PERSONAL_VIEWS` = `["mine", "calendar", "groups", "trend", "lines"]`;
- in `viewHref`, `if (view === "calendar") return \`${base}/calendar\`;` before the period is added;
- add

```ts
/** Ruling P241 (M6c): the calendar's window links. */
export const calendarHref = (space: Pick<SpaceDto, "id">, days: 30 | 60): string =>
  `/spaces/${space.id}/plan/calendar${days === 30 ? "" : `?days=${days}`}`;
```

`reporting/ui/index.ts` also exports `calendarHref`.

`src/modules/reporting/ui/plan-tabs.tsx`: `period` becomes `period?: PeriodDto`, and each link is `viewHref(space, view, period?.label)`.

`src/modules/reporting/ui/calendar/calendar-container.tsx`:

```tsx
import { notFound } from "next/navigation";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import { getMe, getSpaces, loaded, serverApi } from "@/shared/ui/api/server";
import { spaceOf } from "../report-period";
import { CashFlowCalendar } from "./cash-flow-calendar";

/** Ruling P241: `?days=60` asks for 60 days; anything else is the default 30. */
export const daysOf = (asked: string | undefined): 30 | 60 => (asked === "60" ? 60 : 30);

export const loadCashFlow = (api: Api, days: 30 | 60) =>
  loaded(api.GET("/api/v1/me/cash-flow", { params: { query: { days: String(days) as "30" | "60" } } }));

/** Server: the personal space's Próximos view (#150); a shared space has no calendar. */
export async function CalendarContainer({ spaceId, days }: { readonly spaceId: string; readonly days?: string }) {
  const [me, spaces] = await Promise.all([getMe(), getSpaces()]);
  const space = spaceOf(spaces, spaceId);
  if (space.kind !== "PERSONAL") notFound();
  const flow = await loadCashFlow(await serverApi(), daysOf(days));
  if (!flow.ok) return <ProblemNotice problem={flow.problem} />;
  return <CashFlowCalendar space={space} flow={flow.data} formats={me!.preferences.effective} />;
}
```

`src/modules/reporting/ui/calendar/cash-flow-calendar.tsx` (no `"use client"`):
- A `header` holds the space name (`text-sm text-muted`) and the `h1` `reports.calendar.title` with `{days}`. Under it is a `nav` labelled `reports.calendar.window` with two links, `reports.calendar.days` for 30 and for 60, to `calendarHref(space, n)`. They have the trend's 6/12 style (`min-h-11 rounded-full px-4`), and the current one is `aria-current="page"`. Then `<PlanTabs space={space} view="calendar" />` and the `p` `reports.calendar.explain`.
- A `section` labelled by a visually hidden `h2` `reports.calendar.summary`, with four `dl` pairs: `reports.calendar.opening` (`opening`), `reports.calendar.incoming` (`totals.incoming`), `reports.calendar.outgoing` (`totals.outgoing`) and `reports.calendar.closing` (`totals.closing`), all through `formatMoney`. Under them is a `p` `reports.calendar.lowest` with `{balance}` (`formatMoney(lowest.balance)`) and `{date}` (`formatDate(lowest.date)`), in `text-owe` when the balance is negative.
- One `p` `reports.calendar.otherCurrency` per `otherCurrencySpaces` entry, with `{space}` and `{currency}`.
- With no dates, the `p` `reports.calendar.empty` with `{days}`.
- Else an `ol` labelled `reports.calendar.listLabel`, with one `li` per date: `aria-labelledby` its `h2` (`formatDate(date)`, `id="flow-<date>"`) and `data-date={date}`. Inside it is a `ul` of the date's movements. Each movement `li` shows:
  - the description (`font-medium`);
  - `reports.calendar.type.<type>` · the space's name (`text-sm text-muted`);
  - `Badge` `reports.calendar.pending` with `{date}` (`formatDate(dueDate)`) when PENDING;
  - `Badge` `reports.calendar.estimated` when `estimated`;
  - the amount at the row's end (`text-right tabular-nums`). When the effect is not zero it is `formatSignedMoney(effect)`, `text-owe` when negative; else it is `formatMoney(amount)` with `reports.calendar.noEffect` under it.

  After the `ul` comes the `p` `reports.calendar.balanceAfter` with `{balance}` (`formatMoney(balanceAfter)`), `text-owe` when negative.
- Long descriptions and space names wrap (`break-words`, `min-w-0`), so the page never scrolls sideways at 320 px.

`src/modules/reporting/ui/server.ts`: `export { CalendarContainer } from "./calendar/calendar-container";`.

`src/app/(web)/(app)/spaces/[spaceId]/plan/calendar/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { CalendarContainer } from "@/modules/reporting/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("reports"))("calendar.metaTitle") };
}

/** #150: what comes in and goes out over the next 30 or 60 days (ruling P241). */
export default async function CalendarPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{ days?: string }>;
}) {
  const [{ spaceId }, { days }] = await Promise.all([params, searchParams]);
  return <CalendarContainer spaceId={spaceId} days={days} />;
}
```

Catalog keys (`reports`), es / en:
- `view.calendar` Próximos / Upcoming;
- `calendar`:
  - `metaTitle` Próximos movimientos / Upcoming movements; `title` Próximos {days} días / Next {days} days;
  - `window` Ventana / Window; `days` {days} días / {days} days;
  - `explain` Los movimientos recurrentes de tus cuentas en todos tus espacios, con el saldo que te quedaría después de cada día. / The recurring movements of your accounts in all your spaces, with the balance you would have after each day.;
  - `summary` Resumen de lo que viene / Summary of what is coming;
  - `opening` Disponible hoy / Available today; `incoming` Entra / Coming in; `outgoing` Sale / Going out; `closing` Al final / At the end;
  - `lowest` Lo más bajo: {balance} el {date} / Lowest: {balance} on {date};
  - `listLabel` Movimientos por día / Movements by day;
  - `balanceAfter` Saldo proyectado {balance} / Projected balance {balance};
  - `pending` Pendiente desde el {date} / Pending since {date}; `estimated` Estimado / Estimated;
  - `noEffect` No cambia tu disponible / Does not change your available money;
  - `type`: `EXPENSE` Gasto / Expense; `INCOME` Ingreso / Income; `TRANSFER` Transferencia / Transfer; `FUND_CONTRIBUTION` Aporte al fondo / Fund contribution;
  - `empty` No hay movimientos programados en los próximos {days} días. / Nothing is scheduled in the next {days} days.;
  - `otherCurrency` {space} usa {currency}: sus movimientos no se suman aquí. / {space} uses {currency}: its movements are not added here.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's commands, then every gate including `pnpm build`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/reporting/ui "src/app/(web)/(app)/spaces/[spaceId]/plan/calendar" src/shared/ui/api/dto.ts \
  tests/support/ui/plan-dto.ts src/i18n/messages
git commit -m "feat(reporting): add the cash-flow calendar of the next 30 and 60 days (Refs #150)"
```

---

### Task 16: The desktop layout of a space's dashboards

The DashDesktop artboard: from 1024 px, a shared space's Plan tab shows every panel at once beside the Lines view (ruling P216):
- By group (its top level, linking to the drill-down);
- the fund contributions;
- the change against the previous period (linking to the six-period trend);
- one member-by-line table.

Under 1024 px the panels are not rendered visible (`hidden lg:grid`), and the view tabs lead to each view. The overview's reads run in parallel after the line dashboard has named the period. A failed read leaves its panel out and never fails the page. The overview draws no chart, so `/plan` stays free of Recharts.

**Files:**
- Create: `src/modules/reporting/ui/overview/{dash-overview.tsx, overview-container.ts, overview.test.tsx}`
- Modify: `src/modules/reporting/ui/lines/lines-container.tsx`, `src/i18n/messages/es.json`, `src/i18n/messages/en.json`

**Interfaces:**
- Consumes: `e7Matrix`, `e7Fund`, `e7Groups`, `homeTrend` builders; `ChangeText`, `memberName`, `barWidth`, `viewHref`, `NodeLabel`, `treeOf`; `formatMoney`, `formatSignedMoney`, `formatPercent`.
- Produces: `loadOverview(api, { spaceId, period: string }): Promise<Overview>` with `interface Overview { matrix: MemberMatrixDto | null; fund: FundTrackingDto | null; groups: SpendingByGroupDto | null; trend: LineTrendDto | null; members: SpaceMemberDto[] }` (each `null` when its read failed); `DashOverview({ space, overview, formats })`. `LineDashboardContainer` renders it after `LineDashboard` for non-PERSONAL spaces with a plan.

- [ ] **Step 1: Write the failing tests**

`src/modules/reporting/ui/overview/overview.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { normalized } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import {
  e7Fund,
  e7Groups,
  e7Matrix,
  homeTrend,
  HOUSEHOLD_MEMBERS,
  householdDto,
} from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { DashOverview } from "./dash-overview";
import { loadOverview } from "./overview-container";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

const overview = { matrix: e7Matrix(), fund: e7Fund(), groups: e7Groups(), trend: homeTrend(), members: HOUSEHOLD_MEMBERS };

describe("desktop overview (HU-E9-10, ruling P216)", () => {
  it("shows by group, the fund, the change against the previous period and the member matrix together", async () => {
    const { container } = renderWithIntl(<DashOverview space={householdDto()} overview={overview} formats={BUILT_IN_FORMATS} />);
    expect(container.firstElementChild).toHaveClass("hidden", "lg:grid");
    const groups = normalized(screen.getByRole("region", { name: "Por grupo" }).textContent);
    expect(groups).toContain("Housing$ 1.600.000");
    expect(screen.getByRole("link", { name: "Ver por grupo" })).toHaveAttribute("href", "/spaces/sp-household/plan/groups?period=2026-11");
    expect(normalized(screen.getByRole("region", { name: "Aportes al fondo" }).textContent)).toContain("$ 980.000");
    const change = normalized(screen.getByRole("region", { name: "Contra el período anterior" }).textContent);
    expect(change).toContain("−$ 50.000 (−3,70 %)");
    expect(change).toContain("Nueva");
    const matrix = screen.getByRole("table", { name: "Miembros por línea" });
    expect(within(matrix).getAllByRole("row")).toHaveLength(1 + 6);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("reads the overview in parallel for the period, and leaves out a panel whose read fails", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/reports/member-matrix": () => jsonResponse(e7Matrix()),
      "GET /api/v1/spaces/{spaceId}/reports/fund-contributions": () => problemResponse(500, "InternalError"),
      "GET /api/v1/spaces/{spaceId}/reports/spending-by-group": () => jsonResponse(e7Groups()),
      "GET /api/v1/spaces/{spaceId}/reports/trend": () => jsonResponse(homeTrend()),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: HOUSEHOLD_MEMBERS }),
    });
    const result = await loadOverview(api, { spaceId: "sp-household", period: "2026-11" });
    expect(result.fund).toBeNull();
    expect(result.matrix?.lines).toHaveLength(3);
    const trend = new URL(requests.find((r) => r.url.includes("/reports/trend"))!.url).searchParams;
    expect([trend.get("endPeriod"), trend.get("periods")]).toEqual(["2026-11", "2"]);
    expect(
      requests.filter((r) => r.url.includes("/reports/")).every((r) => r.url.includes("2026-11")),
    ).toBe(true);
    renderWithIntl(<DashOverview space={householdDto()} overview={result} formats={BUILT_IN_FORMATS} />);
    expect(screen.queryByRole("region", { name: "Aportes al fondo" })).toBeNull();
  });
});
```

(Six matrix rows: three lines times two members.)

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project ui src/modules/reporting/ui/overview`
Expected: FAIL.

- [ ] **Step 3: Implement**

`overview-container.ts` (server):

```ts
import type { Api } from "@/shared/ui/api/client";
import type {
  FundTrackingDto,
  LineTrendDto,
  MemberMatrixDto,
  SpaceMemberDto,
  SpendingByGroupDto,
} from "@/shared/ui/api/dto";
import { loaded } from "@/shared/ui/api/server";

export interface Overview {
  readonly matrix: MemberMatrixDto | null;
  readonly fund: FundTrackingDto | null;
  readonly groups: SpendingByGroupDto | null;
  readonly trend: LineTrendDto | null;
  readonly members: SpaceMemberDto[];
}

/** Ruling P216: the desktop panels, read in parallel for the period the line dashboard named; a failed read is left out. */
export const loadOverview = async (api: Api, { spaceId, period }: { spaceId: string; period: string }): Promise<Overview> => {
  const path = { spaceId };
  const query = { period };
  const [matrix, fund, groups, trend, members] = await Promise.all([
    loaded(api.GET("/api/v1/spaces/{spaceId}/reports/member-matrix", { params: { path, query } })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/reports/fund-contributions", { params: { path, query } })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/reports/spending-by-group", { params: { path, query } })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/reports/trend", { params: { path, query: { endPeriod: period, periods: 2 } } })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/members", { params: { path } })),
  ]);
  return {
    matrix: matrix.ok ? matrix.data : null,
    fund: fund.ok ? fund.data : null,
    groups: groups.ok ? groups.data : null,
    trend: trend.ok ? trend.data : null,
    members: members.ok ? members.data.items : [],
  };
};
```

`dash-overview.tsx` (no `"use client"`). The root is `<div className="hidden gap-4 lg:grid lg:grid-cols-[repeat(auto-fit,minmax(min(480px,100%),1fr))]">`, the artboard's own grid. It holds one `section` per available panel, each labelled by its `h2`:
1. **By group** (`reports.view.groups`): the top level of `treeOf(groups.groups)` as rows with the name (`NodeLabel`), the amount, the share and a bar, then the link `reports.overview.toGroups` to `viewHref(space, "groups", period)`.
2. **Fund** (`reports.fund.title`): `reports.overview.fundSummary` with `{actual}` and `{expected}` from `fund.totals`, then a compact table: member, expected, contributed, difference.
3. **Against the previous period** (`reports.overview.againstPrevious`): one row per line of `trend.lines`, with the name and the last point's `ChangeText`, then the link `reports.overview.toTrend` to `viewHref(space, "trend", period)`.
4. **Member matrix** (`reports.overview.matrixTitle`): one `table` with that caption and the columns `reports.lines.line`, `reports.matrix.member`, `reports.matrix.assigned`, `reports.matrix.contributed`, `reports.matrix.consumed` and `reports.matrix.gap`. It has one row per line and member, null cells as in Task 9, and the status badge in the gap cell. Under it sits the note `reports.overview.matrixNote`.

`lines-container.tsx`: after `loadLines`, when `space.kind !== "PERSONAL"` and `dashboard.plan !== null`, `const overview = await loadOverview(api, { spaceId, period: dashboard.period.label })`. Render `<DashOverview space={space} overview={overview} formats={formats} />` after the `LineDashboard`.

Catalog keys (`reports.overview`), es / en:
- `toGroups` Ver por grupo / See by group; `fundSummary` {actual} de {expected} / {actual} of {expected};
- `againstPrevious` Contra el período anterior / Against the previous period; `toTrend` Ver tendencia de 6 períodos / See the 6-period trend;
- `matrixTitle` Miembros por línea / Members by line;
- `matrixNote` Las líneas pagadas con el fondo siguen su aporte en Aportes al fondo; las de ahorro cuentan lo que llegó a sus cuentas. / Lines paid from the fund track contributions under Fund contributions; savings lines count what reached their accounts.

- [ ] **Step 4: Run the tests and the gates**

Run: Step 2's command, `pnpm exec vitest run --project ui src/modules/reporting/ui`, then every gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/reporting/ui src/i18n/messages
git commit -m "feat(reporting): lay out every space dashboard together on desktop (Refs #78)"
```

---

### Task 17a: End-to-end seeding and the planner scenario

HU-E9-08's `@e2e @golden` scenario "Build the reference plan", run through the screens against the standalone build. The household is seeded through `/api/v1`, by a helper of M6c's own (ruling P222):
- Ana is the World's signed-in person;
- Juan signs up in his own request context and accepts a link invitation as MEMBER;
- plan writes carry `If-Match`.

The scenario then drives the screens: create the plan from the no-plan card, set both capacities, add the four lines (one with Ana's savings account, one as the catch-all), and read the planner.

**Files:**
- Create: `tests/e2e/support/plan-seed.ts`, `tests/e2e/features/budget-planner.feature`, `tests/e2e/steps/plan.steps.ts`
- Modify: `tests/e2e/support/money.ts`

**Interfaces:**
- Consumes: M6a's `World` (`signUp`, `seedAccount`, `t`, `email`, `headers`, `api`) and `Given`/`When`/`Then`; `shown`, `minor`; the app's `formatPercent`.
- Produces:
  - `plan-seed.ts`:
    - `class SeedClient(request: APIRequestContext, headers: () => Record<string, string>)` with `get`, `post`, `put` (optional `If-Match`) and `record(path, body)` (with an `Idempotency-Key`);
    - `interface SeededHousehold { spaceId: string; members: Readonly<Record<string, string>>; juan: SeedClient; juanSpaceId: string }`;
    - `seedHousehold(world, { name, member, role }): Promise<SeededHousehold>`;
    - `householdOf(world): SeededHousehold` (kept in a `WeakMap`, so M6a's `World` is unchanged);
    - `seedReferencePlan(client, hh, { period, catchAll, activate, savingsAccountId }): Promise<{ planId: string; version: number; lineIds: Record<string, string> }>`;
    - `categoryIdsByKey(client, spaceId): Promise<Record<string, string>>`.
  - `money.ts`: `percentShown(decimal: string, formats?)`.

- [ ] **Step 1: Write the feature**

`tests/e2e/features/budget-planner.feature`: `Feature: Budget planner`, then HU-E9-08's `Background` and its scenario "Build the reference plan", copied verbatim from `docs/backlog/E9-web-ui.md` (with its `@e2e @golden` tags).

- [ ] **Step 2: Write the seeding helper**

`tests/e2e/support/plan-seed.ts`:

```ts
import { request as playwright, type APIRequestContext } from "@playwright/test";
import type { World } from "./world";

const BASE_URL = `http://127.0.0.1:${process.env.E2E_PORT ?? "3100"}`;

/** Seeds through /api/v1 with a test's headers; a non-2xx answer fails the step (as M6a's SeedApi does). */
export class SeedClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly headers: () => Record<string, string>,
  ) {}

  async send(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<unknown> {
    const response = await this.request.fetch(path, { method, headers: { ...this.headers(), ...extra }, data: body });
    if (!response.ok()) throw new Error(`${method} ${path} answered ${response.status()}: ${await response.text()}`);
    return response.status() === 204 ? undefined : response.json();
  }

  get = (path: string) => this.send("GET", path);
  post = (path: string, body: unknown, version?: number) =>
    this.send("POST", path, body, version === undefined ? {} : { "if-match": `"${version}"` });
  put = (path: string, body: unknown, version: number) => this.send("PUT", path, body, { "if-match": `"${version}"` });
  record = (path: string, body: unknown) => this.send("POST", path, body, { "idempotency-key": crypto.randomUUID() });
}

export interface SeededHousehold {
  readonly spaceId: string;
  /** Member ids by display name. */
  readonly members: Readonly<Record<string, string>>;
  readonly juan: SeedClient;
  readonly juanSpaceId: string;
}

const households = new WeakMap<World, SeededHousehold>();

export const householdOf = (world: World): SeededHousehold => {
  const household = households.get(world);
  if (!household) throw new Error("No household was seeded in this scenario");
  return household;
};

export const clientOf = (world: World) => new SeedClient(world.page.request, () => world.headers());

/**
 * Ruling P222: the World's person (already signed up) creates the shared space and a link invitation; `member` signs
 * up in a request context of their own (their own cookie, the same test address) and accepts it.
 */
export const seedHousehold = async (
  world: World,
  { name, member, role }: { name: string; member: string; role: "ADMIN" | "MEMBER" | "VIEWER" },
): Promise<SeededHousehold> => {
  const ana = clientOf(world);
  const space = (await ana.post("/api/v1/spaces", { kind: "SHARED", name })) as { id: string };
  const invite = (await ana.post(`/api/v1/spaces/${space.id}/invitations`, { kind: "LINK", role })) as { url: string };
  const token = new URL(invite.url, BASE_URL).pathname.split("/").filter(Boolean).at(-1)!;
  const context = await playwright.newContext({ baseURL: BASE_URL });
  const juan = new SeedClient(context, () => world.headers());
  await juan.post("/api/v1/auth/sign-up", {
    name: member,
    email: world.email(`${member.toLowerCase()}@example.com`),
    password: "123456789012",
    timezone: "America/Bogota",
  });
  await juan.post(`/api/v1/invitations/${token}/accept`, {});
  const { items: juanSpaces } = (await juan.get("/api/v1/spaces")) as { items: { id: string; kind: string }[] };
  const { items } = (await ana.get(`/api/v1/spaces/${space.id}/members`)) as { items: { id: string; displayName: string }[] };
  const household = {
    spaceId: space.id,
    members: Object.fromEntries(items.map((m) => [m.displayName, m.id])),
    juan,
    juanSpaceId: juanSpaces.find((s) => s.kind === "PERSONAL")!.id,
  };
  households.set(world, household);
  return household;
};

/** The space's seeded categories by catalog key (rent, groceries, utilities, entertainment, restaurants, …). */
export const categoryIdsByKey = async (client: SeedClient, spaceId: string): Promise<Record<string, string>> => {
  const { items } = (await client.get(`/api/v1/spaces/${spaceId}/categories`)) as {
    items: { categories: { id: string; key: string | null }[] }[];
  };
  return Object.fromEntries(items.flatMap((g) => g.categories).flatMap((c) => (c.key ? [[c.key, c.id]] : [])));
};

const cop = (pesos: number) => ({ amount: String(pesos * 100), currency: "COP" });
type PlanAnswer = { id: string; version: number; lines: { id: string; name: string }[] };

/**
 * HU-E6's reference plan: Ana 1,600,000 COP and Juan 2,400,000 COP; Rent (SHARED_FUND), Home, Savings (into
 * `savingsAccountId`) and Free, all RESET; the E7 mappings; Free the catch-all only when asked; ACTIVE when asked.
 */
export const seedReferencePlan = async (
  ana: SeedClient,
  hh: SeededHousehold,
  options: { period: string; catchAll: boolean; activate: boolean; savingsAccountId: string },
): Promise<{ planId: string; version: number; lineIds: Record<string, string> }> => {
  const base = `/api/v1/spaces/${hh.spaceId}/plans`;
  let plan = (await ana.post(base, { period: options.period })) as PlanAnswer;
  plan = (await ana.put(`${base}/${plan.id}/capacities`, {
    capacities: [
      { memberId: hh.members["Ana"], amount: cop(1_600_000) },
      { memberId: hh.members["Juan"], amount: cop(2_400_000) },
    ],
  }, plan.version)) as PlanAnswer;
  const lines: [string, number, string, Record<string, unknown>][] = [
    ["Rent", 1_200_000, "SHARED_FUND", {}],
    ["Home", 1_470_000, "DIRECT", {}],
    ["Savings", 600_000, "SAVINGS", { savingsAccountIds: [options.savingsAccountId] }],
    ["Free", 730_000, "DIRECT", { isCatchAll: options.catchAll }],
  ];
  for (const [name, pesos, funding, extra] of lines)
    plan = (await ana.post(`${base}/${plan.id}/lines`, {
      name, plannedAmount: cop(pesos), funding, rolloverMode: "RESET", ...extra,
    }, plan.version)) as PlanAnswer;
  const lineIds = Object.fromEntries(plan.lines.map((l) => [l.name, l.id]));
  const keys = await categoryIdsByKey(ana, hh.spaceId);
  for (const [line, categories] of [["Rent", ["rent"]], ["Home", ["groceries", "utilities"]], ["Free", ["entertainment"]]] as const)
    plan = (await ana.put(`${base}/${plan.id}/lines/${lineIds[line]}/categories`, {
      categoryIds: categories.map((key) => keys[key]),
    }, plan.version)) as PlanAnswer;
  if (options.activate) plan = (await ana.post(`${base}/${plan.id}/activate`, {}, plan.version)) as PlanAnswer;
  return { planId: plan.id, version: plan.version, lineIds };
};
```

`tests/e2e/support/money.ts`: add `formatPercent` to its import from the formatters, and append:

```ts
/** A share as the screen writes it ("40.00" → "40,00 %"), through the app's own formatter. */
export const percentShown = (decimal: string, formats: Formats = BUILT_IN_FORMATS): string => formatPercent(decimal, formats);
```

- [ ] **Step 3: Write the steps**

`tests/e2e/steps/plan.steps.ts`:

```ts
import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures";
import { percentShown, shown } from "../support/money";
import { householdOf, seedHousehold } from "../support/plan-seed";

const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();
const pesos = (amount: string) => amount.replaceAll(",", "");

Given(
  /^"([^"]+)" is OWNER and "([^"]+)" is MEMBER of "([^"]+)" with the period policy MONTHLY\(1\)$/,
  async ({ world }, owner: string, member: string, name: string) => {
    await world.signUp(owner);
    await seedHousehold(world, { name, member, role: "MEMBER" });
  },
);

When(
  /^"([^"]+)" creates the (\S+) plan and enters capacities "([^"]+)" ([\d,]+) COP and "([^"]+)" ([\d,]+) COP$/,
  async ({ page, world }, _who: string, period: string, first: string, firstAmount: string, second: string, secondAmount: string) => {
    await page.goto(`/spaces/${householdOf(world).spaceId}/plan?period=${period}`);
    await page.getByRole("button", { name: world.t("budgeting.start.create") }).click();
    await expect(page).toHaveURL(/\/plans\/[0-9a-f-]{36}$/);
    await page.getByRole("link", { name: world.t("budgeting.planner.editCapacities") }).click();
    await page.getByLabel(world.t("budgeting.capacity.field", { name: first })).fill(pesos(firstAmount));
    await page.getByLabel(world.t("budgeting.capacity.field", { name: second })).fill(pesos(secondAmount));
    await page.getByRole("button", { name: world.t("budgeting.capacity.save") }).click();
    await expect(page).toHaveURL(/\/plans\/[0-9a-f-]{36}$/);
  },
);

When(
  /^adds "([^"]+)" ([\d,]+) COP funded by "([A-Z_]+)", "([^"]+)" ([\d,]+) COP "([A-Z_]+)", "([^"]+)" ([\d,]+) COP "([A-Z_]+)" with a savings account and "([^"]+)" ([\d,]+) COP "([A-Z_]+)" marked as catch-all, all with rollover "([A-Z_]+)"$/,
  async ({ page, world }, ...args: string[]) => {
    const [a, aAmount, aFunding, b, bAmount, bFunding, c, cAmount, cFunding, d, dAmount, dFunding, rollover] = args as [
      string, string, string, string, string, string, string, string, string, string, string, string, string,
    ];
    // The savings line names an account its owner holds (P8): Ana's own SAVINGS account in her personal space.
    await world.seedAccount("Ahorros", { type: "SAVINGS", openingBalance: { amount: "0", currency: "COP" } });
    const add = async (name: string, amount: string, funding: string, extra: { savings?: boolean; catchAll?: boolean } = {}) => {
      await page.getByRole("link", { name: world.t("budgeting.planner.addLine") }).click();
      await page.getByLabel(world.t("budgeting.lineEditor.field.name")).fill(name);
      await page.getByLabel(world.t("budgeting.lineEditor.field.planned")).fill(pesos(amount));
      await page.getByRole("radio", { name: world.t(`budgeting.funding.${funding}`) }).click();
      if (extra.savings) await page.getByRole("checkbox", { name: "Ahorros" }).check();
      if (extra.catchAll) await page.getByRole("switch", { name: world.t("budgeting.lineEditor.field.catchAll") }).click();
      await page.getByRole("radio", { name: world.t(`budgeting.rollover.${rollover}`) }).click();
      await page.getByRole("button", { name: world.t("budgeting.lineEditor.add") }).click();
      await expect(page.getByRole("listitem", { name })).toBeVisible();
    };
    await add(a, aAmount, aFunding);
    await add(b, bAmount, bFunding);
    await add(c, cAmount, cFunding, { savings: true });
    await add(d, dAmount, dFunding, { catchAll: true });
  },
);

Then(
  /^the planner shows total capacity ([\d,]+) COP split ([\d.]+)% \/ ([\d.]+)%$/,
  async ({ page, world }, total: string, first: string, second: string) => {
    const capacity = page.getByRole("region", { name: world.t("budgeting.planner.capacity") });
    const text = norm(await capacity.textContent());
    expect(text).toContain(norm(shown(total)));
    expect(text).toContain(norm(percentShown(first)));
    expect(text).toContain(norm(percentShown(second)));
  },
);

Then(
  /^it shows unallocated capacity ([\d,]+) COP and "([^"]+)" at ([\d.]+)% of total capacity$/,
  async ({ page, world }, unallocated: string, line: string, share: string) => {
    const capacity = norm(await page.getByRole("region", { name: world.t("budgeting.planner.capacity") }).textContent());
    expect(capacity).toContain(norm(world.t("budgeting.planner.unallocated", { amount: shown(unallocated) })));
    const row = norm(await page.getByRole("listitem", { name: line }).textContent());
    expect(row).toContain(norm(world.t("budgeting.planner.ofCapacity", { share: percentShown(share) })));
  },
);
```

(The steps match the feature's lines without their keywords, as playwright-bdd does. The scenario's server "today" is 2026-10-31 in Bogotá (P133), so the steps open the period by its label.)

- [ ] **Step 4: Run it and see it bite**

Run: `pnpm build && pnpm test:e2e`.
Expected: PASS, the M6a scenarios included. To see it bite: in `Planner`, render `line.capacityShare` raw instead of through `formatPercent`. The last step fails, because "36.75 de la capacidad" does not contain "36,75 %". Revert.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/support/plan-seed.ts tests/e2e/support/money.ts tests/e2e/features/budget-planner.feature \
  tests/e2e/steps/plan.steps.ts
git commit -m "test(budgeting): run the reference plan scenario end to end through the planner (Refs #76)"
```

---

### Task 17b: The dashboard and unified view scenarios, and accessibility scans

Two `@e2e` scenarios: HU-E9-10's "Line dashboard shows planned, spent and available" (`@golden`), seeded with the ACTIVE reference plan and the E7 shared fixture, and HU-E9-11's "Unified view totals across spaces", seeded with the HU-E7-04 fixture. Then an axe scan (WCAG 2.1 AA, light and dark) of every M6c screen and sheet:
- the Plan tab's views at phone width, and the desktop overview at 1440 px;
- both trend charts, with a check that the personal chart draws its six points in a real browser;
- the planner, the capacities, the line editor with its mapping sheet, and the no-plan card.

**Files:**
- Create: `tests/e2e/features/dashboards.feature`, `tests/e2e/features/personal-dashboards.feature`, `tests/e2e/steps/dashboards.steps.ts`, `tests/e2e/a11y-plan.spec.ts`
- Modify: `tests/e2e/support/plan-seed.ts`, `playwright.config.ts`

**Interfaces:**
- Consumes: Task 17a's `SeedClient`, `seedHousehold`, `seedReferencePlan`, `categoryIdsByKey`, `householdOf`, `clientOf`; `shown`, `minor`.
- Produces: `seedE7Expenses(ana, hh, accounts)`, `seedE74Movements(ana, hh, accounts)` and `seedAccounts(world, hh)` in `plan-seed.ts` (`seedAccounts` returns `{ bancolombia, davivienda, fund, savings }`). The `a11y` project matches `a11y*.spec.ts`.

- [ ] **Step 1: Write the features**

- `tests/e2e/features/dashboards.feature`: `Feature: Space dashboards`, then HU-E9-10's `Background` and "Line dashboard shows planned, spent and available" (`@e2e @golden`, with its data table), verbatim.
- `tests/e2e/features/personal-dashboards.feature`: `Feature: Personal dashboards`, then HU-E9-11's "Unified view totals across spaces" (`@e2e`), verbatim.

- [ ] **Step 2: Write the seeding**

`tests/e2e/support/plan-seed.ts`, appended:

```ts
/** Ana's and Juan's personal BANK accounts of 2,000,000 COP, Ana's "Ahorros", and the household's fund. */
export const seedAccounts = async (world: World, hh: SeededHousehold) => {
  const ana = clientOf(world);
  const open = (client: SeedClient, spaceId: string, name: string, type: string, pesos: number) =>
    client.post(`/api/v1/spaces/${spaceId}/accounts`, { name, type, openingBalance: cop(pesos) }) as Promise<{ id: string }>;
  return {
    bancolombia: (await open(ana, world.user!.spaceId, "Bancolombia", "BANK", 2_000_000)).id,
    savings: (await open(ana, world.user!.spaceId, "Ahorros", "SAVINGS", 0)).id,
    davivienda: (await open(hh.juan, hh.juanSpaceId, "Davivienda", "BANK", 2_000_000)).id,
    fund: (await open(ana, hh.spaceId, "Household Fund", "SHARED_FUND", 1_500_000)).id,
  };
};
type Accounts = Awaited<ReturnType<typeof seedAccounts>>;

const expense = (
  client: SeedClient,
  spaceId: string,
  body: { description: string; date: string; categoryId: string; pesos: number } & Record<string, unknown>,
) => {
  const { pesos, ...rest } = body;
  return client.record(`/api/v1/spaces/${spaceId}/expenses`, { ...rest, amount: cop(pesos) });
};

/** HU-E7-01 Background: November 2026's expenses in Household, Restaurants on the period's last day. */
export const seedE7Expenses = async (ana: SeedClient, hh: SeededHousehold, a: Accounts) => {
  const keys = await categoryIdsByKey(ana, hh.spaceId);
  const fromFund = (pesos: number) => ({ payments: [{ memberId: null, accountId: a.fund, amount: cop(pesos) }] });
  await expense(ana, hh.spaceId, { description: "Rent", date: "2026-11-01", categoryId: keys.rent!, pesos: 1_200_000, ...fromFund(1_200_000) });
  await expense(ana, hh.spaceId, { description: "Groceries", date: "2026-11-05", categoryId: keys.groceries!, pesos: 900_000, accountId: a.bancolombia });
  await expense(hh.juan, hh.spaceId, { description: "Utilities", date: "2026-11-10", categoryId: keys.utilities!, pesos: 400_000, accountId: a.davivienda });
  await expense(hh.juan, hh.spaceId, { description: "Entertainment", date: "2026-11-15", categoryId: keys.entertainment!, pesos: 250_000, accountId: a.davivienda });
  await expense(ana, hh.spaceId, { description: "Restaurants", date: "2026-11-30", categoryId: keys.restaurants!, pesos: 60_000, accountId: a.bancolombia });
};

/** HU-E7-04 Background: Ana's November 2026 in Personal and Household, with her shares as EXACT splits. */
export const seedE74Movements = async (world: World, hh: SeededHousehold, a: Accounts) => {
  const ana = clientOf(world);
  const personal = await categoryIdsByKey(ana, world.user!.spaceId);
  const shared = await categoryIdsByKey(ana, hh.spaceId);
  const split = (anaPesos: number, juanPesos: number) => ({
    split: {
      method: "EXACT",
      participants: [
        { memberId: hh.members["Ana"], amount: cop(anaPesos) },
        { memberId: hh.members["Juan"], amount: cop(juanPesos) },
      ],
    },
  });
  await expense(ana, world.user!.spaceId, { description: "Market", date: "2026-11-03", categoryId: personal.groceries!, pesos: 85_000, accountId: a.bancolombia });
  await expense(ana, world.user!.spaceId, { description: "Dinner", date: "2026-11-12", categoryId: personal.restaurants!, pesos: 60_000, accountId: a.bancolombia });
  await expense(ana, hh.spaceId, { description: "Home purchase", date: "2026-11-05", categoryId: shared.groceries!, pesos: 2_000_000, accountId: a.bancolombia, ...split(800_000, 1_200_000) });
  await expense(ana, hh.spaceId, {
    description: "Rent November", date: "2026-11-01", categoryId: shared.rent!, pesos: 1_200_000,
    payments: [{ memberId: null, accountId: a.fund, amount: cop(1_200_000) }], ...split(480_000, 720_000),
  });
  await expense(hh.juan, hh.spaceId, { description: "Weekly market", date: "2026-11-20", categoryId: shared.groceries!, pesos: 300_000, accountId: a.davivienda, ...split(150_000, 150_000) });
  await ana.record(`/api/v1/spaces/${hh.spaceId}/fund-contributions`, {
    date: "2026-11-01", amount: cop(480_000), fundAccountId: a.fund, sourceAccountId: a.bancolombia,
  });
};
```

- [ ] **Step 3: Write the steps**

`tests/e2e/steps/dashboards.steps.ts`:

```ts
import { expect } from "@playwright/test";
import type { DataTable } from "playwright-bdd";
import { Given, Then, When } from "../support/fixtures";
import { shown } from "../support/money";
import {
  clientOf,
  householdOf,
  seedAccounts,
  seedE74Movements,
  seedE7Expenses,
  seedHousehold,
  seedReferencePlan,
} from "../support/plan-seed";

const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();
const LINE_NAMES: Record<string, string> = { Unbudgeted: "reports.lines.unbudgeted" };

Given(
  /^the ACTIVE reference plan for (\S+) in "([^"]+)" and the E7 shared fixture expenses$/,
  async ({ world }, period: string, name: string) => {
    await world.signUp("Ana");
    const hh = await seedHousehold(world, { name, member: "Juan", role: "MEMBER" });
    const accounts = await seedAccounts(world, hh);
    // The E7 fixture keeps Free off the catch-all, so Restaurants stays Unbudgeted (HU-E7-01, ruling P34).
    await seedReferencePlan(clientOf(world), hh, { period, catchAll: false, activate: true, savingsAccountId: accounts.savings });
    await seedE7Expenses(clientOf(world), hh, accounts);
  },
);

When(/^"([^"]+)" opens the dashboard of "([^"]+)" for (\S+)$/, async ({ page, world }, _who: string, _space: string, period: string) => {
  await page.goto(`/spaces/${householdOf(world).spaceId}/plan?period=${period}`);
});

Then("the bars and table show:", async ({ page, world }, table: DataTable) => {
  const grid = page.getByRole("table", { name: world.t("reports.lines.caption") });
  for (const row of table.hashes()) {
    const name = LINE_NAMES[row.line!] ? world.t(LINE_NAMES[row.line!]!) : row.line!;
    const tr = grid.getByRole("row").filter({ has: page.getByRole("rowheader", { name: new RegExp(`^${name}`) }) });
    const cells = (await tr.getByRole("cell").allTextContents()).map(norm);
    expect(cells).toEqual(
      [row.planned!, row.spent!, row.available!].map((amount) => norm(shown(amount.replace(" COP", "")))),
    );
  }
});

Given(/^"([^"]+)" has the November 2026 movements of the HU-E7-04 fixture$/, async ({ world }, who: string) => {
  await world.signUp(who);
  const hh = await seedHousehold(world, { name: "Household", member: "Juan", role: "MEMBER" });
  await seedE74Movements(world, hh, await seedAccounts(world, hh));
});

When(/^"([^"]+)" opens her unified view for (\S+)$/, async ({ page, world }, _who: string, period: string) => {
  await page.goto(`/spaces/${world.user!.spaceId}/plan?period=${period}`);
});

Then(/^it shows consumption ([\d,]+) COP and cash out ([\d,]+) COP$/, async ({ page, world }, consumption: string, cashOut: string) => {
  const region = (key: string) => page.getByRole("region", { name: world.t(key), exact: true });
  expect(norm(await region("reports.unified.consumption").textContent())).toContain(norm(shown(consumption)));
  expect(norm(await region("reports.unified.cashOut").textContent())).toContain(norm(shown(cashOut)));
});

Then(
  /^"([^"]+)" from her personal space and "([^"]+)" is one row of ([\d,]+) COP$/,
  async ({ page, world }, category: string, _space: string, amount: string) => {
    // The row takes the name Ana's personal space gives the catalog key (ruling P76), so the API names it.
    const view = (await world.api.get("/api/v1/me/unified-view?period=2026-11")) as {
      consumption: { categories: { key: string | null; name: string }[] };
    };
    const row = view.consumption.categories.find((c) => c.key === category.toLowerCase())!;
    const items = page.getByRole("listitem", { name: row.name, exact: true });
    await expect(items).toHaveCount(1);
    expect(norm(await items.textContent())).toContain(norm(shown(amount)));
  },
);
```

- [ ] **Step 4: Write the accessibility scan**

`tests/e2e/a11y-plan.spec.ts`. Its seeding mirrors the dashboards' Background through `SeedClient` with its own addresses (`10.253.0.1` light, `10.253.0.2` dark). It covers:
- Ana signs up with `page.request`, then the household, the accounts, the ACTIVE reference plan for 2026-11 (catch-all off), and the E7 expenses;
- a December 2026 copy of the plan, for the trend (`POST …/plans` with `copyFrom: "previous"`);
- a 2027-01 period without a plan.

For each color scheme it then runs the scan below, reusing `scan` and `WCAG` written as in `tests/e2e/a11y.spec.ts`:

```ts
const hh = `/spaces/${household.spaceId}`;
const me = `/spaces/${personalSpaceId}`;
for (const path of [
  `${hh}/plan?period=2026-11`,
  `${hh}/plan?period=2027-01`,
  `${hh}/plan/members?period=2026-11`,
  `${hh}/plan/fund?period=2026-11`,
  `${hh}/plan/groups?period=2026-11`,
  `${hh}/plans/${planId}`,
  `${hh}/plans/${planId}/capacities`,
  `${hh}/plans/${planId}/lines/new`,
  `${me}/plan?period=2026-11`,
  `${me}/plan/groups?period=2026-11`,
  `${me}/plan/lines?period=2026-11`,
]) {
  await page.goto(path);
  await scan(path);
}
await page.goto(`${hh}/plan/groups?period=2026-11`);
await page.getByRole("button", { name: /^Food|^Alimentación/ }).first().click();
await scan("spending by group, one level down");
for (const path of [`${hh}/plan/trend?period=2026-12`, `${me}/plan/trend?period=2026-11`]) {
  await page.goto(path);
  await expect(page.getByTestId("trend-chart")).toBeVisible();
  await scan(path);
}
// The personal chart draws one dot per period of its window (HU-E9-11 "6 points"), in a real browser.
await expect(page.locator("[data-testid='trend-chart'] .recharts-line-dot")).toHaveCount(6);
await page.goto(`${hh}/plans/${planId}/lines/${lineIds.Home}`);
await page.getByRole("button", { name: es.budgeting.mapping.choose }).click();
await scan("category mapping sheet");
await page.keyboard.press("Escape");
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(`${hh}/plan?period=2026-11`);
await expect(page.getByRole("table", { name: es.reports.overview.matrixTitle })).toBeVisible();
await scan("desktop overview");
```

Notes on the scan:
- The seeded groups' names depend on the seed's language, so the drill-down clicks the first group button by role, `.first()`.
- `.recharts-line-dot` is the class Recharts 3.10.1 gives each dot. If a Recharts patch renames it, the count is read from the `circle` elements under `.recharts-line`; the six-dot check stays either way.
- In `playwright.config.ts`, the `a11y` project's `testMatch` changes from `"a11y.spec.ts"` to `/a11y.*\.spec\.ts$/`.

- [ ] **Step 5: Run them and see them bite**

Run: `pnpm build && pnpm test:e2e`.
Expected: PASS. Two checks show the scenarios bite; revert each after:
- In `LineDashboard`, render `available` from `planned`: the Home row reads `$ 1.470.000` instead of `$ 170.000`, and "Line dashboard shows planned, spent and available" fails.
- In `UnifiedView`, render `cashOut.payments` as the cash-out total: "Unified view totals across spaces" fails.

A dark-theme contrast failure is fixed by moving its token's mix in `globals.css`, never by disabling the rule (P135).

- [ ] **Step 6: Commit**

```bash
git add tests/e2e playwright.config.ts
git commit -m "test(reporting): run the dashboard and unified view scenarios and scan every plan screen with axe (Refs #78, Refs #79)"
```

---

### Task 17c: The line warning, carry-over and calendar scenarios, with their layout and axe scans

The three additions in a real browser, against the standalone build. Three `@e2e` scenarios bite on the behaviour:
- #142: an expense over its line asks first and still saves;
- #143: a copy of a CLOSED plan shows what its ROLLOVER line carried in and from where, and a copy of an open plan carries nothing yet;
- #150: the calendar projects a person's own account.

Then every new screen and state joins the UI rules of the owner's review (2026-10-21). `tests/e2e/layout.spec.ts` checks that nothing scrolls sideways at 390 and 320 px, that the last control sits above the bottom bar, and that targets are at least 44 px. `tests/e2e/a11y-plan.spec.ts` scans each screen and state in light and dark (ruling P242).

**Depends on:** Task 17b (`a11y-plan.spec.ts`, `seedAccounts`), Task 17a (`plan-seed.ts`), and Tasks 1e, 3b, 3c, 8b and 15b.

**Files:**
- Create: `tests/e2e/features/line-warning.feature`, `tests/e2e/features/rollover.feature`, `tests/e2e/features/cash-flow.feature`, `tests/e2e/steps/additions.steps.ts`
- Modify: `tests/e2e/support/plan-seed.ts`, `tests/e2e/a11y-plan.spec.ts`, `tests/e2e/layout.spec.ts`

**Interfaces:**
- Consumes: `SeedClient`, `seedHousehold`, `seedReferencePlan`, `categoryIdsByKey`, `householdOf`, `clientOf` (Task 17a); `seedAccounts` (Task 17b); `shown`, `minor`; M6a's `World`; `layout.spec.ts`'s `settle`, `overflowReport` and its "last control" table.
- Produces: in `plan-seed.ts`, `seedRecurrence(client, spaceId, body): Promise<{ id: string }>` and `seedHome(client, hh, accounts, { period, rolloverMode, close }): Promise<{ planId: string; lineIds: Record<string, string> }>`. `seedHome` seeds an ACTIVE reference plan for `period` (`seedReferencePlan`), sets Home's rollover mode, and records 1,300,000 COP of Groceries in that period from Ana's Bancolombia. With `close`, it then closes the plan. The e2e server's today is 2026-10-31 (P133): October is the period holding today, and September is over, so it can be closed.

- [ ] **Step 1: Write the features**

`tests/e2e/features/line-warning.feature`:

```gherkin
@e2e
Feature: Warn before saving an expense that takes a plan line past 90% or over (#142)

  Background:
    Given "Ana" has the household "Household" with "Juan" as "MEMBER"
    And the ACTIVE plan for 2026-10 has the line "Home" with planned 1,470,000 COP and 1,300,000 COP spent in "Groceries"

  Scenario: An expense over its line asks first and still saves
    When "Ana" records an expense of 212,300 COP in "Groceries" in "Household" and taps "Guardar gasto"
    Then the form asks "¿Guardar de todos modos?" and says "Con este gasto te pasarías por $ 42.300 en Home."
    And nothing was saved
    When she taps "Guardar de todos modos"
    Then the expense is saved
    And the line dashboard for 2026-10 shows "Home" with available "−$ 42.300" and the badge "Excedida"

  Scenario: An expense that leaves its line at 80 % saves at once
    When "Ana" records an expense of 20,000 COP in "Groceries" in "Household"
    Then the form notes "Con este gasto, Home quedaría en 89,79 % de lo planeado."
    And tapping "Guardar gasto" saves it without asking
```

`tests/e2e/features/rollover.feature`:

```gherkin
@e2e
Feature: A plan line's leftover rolls into the next period (#143)

  Background:
    Given "Ana" has the household "Household" with "Juan" as "MEMBER"

  Scenario: A copy of a closed plan shows what its ROLLOVER line carried in, and from where
    Given the CLOSED plan for 2026-09 has the line "Home" with rollover "ROLLOVER", planned 1,470,000 COP and 1,300,000 COP spent in "Groceries"
    When "Ana" copies the plan into 2026-10 and opens the line dashboard for 2026-10
    Then "Home" shows "+$ 170.000 de septiembre 2026" and available "$ 1.640.000"

  Scenario: A copy of a plan that is not closed carries nothing yet
    Given the ACTIVE plan for 2026-10 has the line "Home" with rollover "ROLLOVER", planned 1,470,000 COP and 1,300,000 COP spent in "Groceries"
    When "Ana" copies the plan into 2026-11 and opens the line dashboard for 2026-11
    Then "Home" shows "Se arrastra de octubre 2026 cuando ese plan se cierre." and available "$ 1.470.000"
```

`tests/e2e/features/cash-flow.feature`:

```gherkin
@e2e
Feature: A cash-flow calendar of the next 30 and 60 days (#150)

  Scenario: The calendar projects Ana's own account
    Given "Ana" has only the BANK account "Bancolombia" with 900,000 COP
    And she recorded a one-off expense of 400,000 COP from "Bancolombia" today, which is not repeated
    And her "Salario" of 3,000,000 COP comes into "Bancolombia" every month on day 30 from 2026-11-01
    And her "Internet" of 120,000 COP is paid from "Bancolombia" every month on day 5 from 2026-11-05
    When she opens "Próximos" with 60 days
    Then the days read
      | date       | movement | amount        | balance after |
      | 5/11/2026  | Internet | −$ 120.000    | $ 380.000     |
      | 30/11/2026 | Salario  | +$ 3.000.000  | $ 3.380.000   |
      | 5/12/2026  | Internet | −$ 120.000    | $ 3.260.000   |
    And the summary reads "Lo más bajo: $ 380.000 el 5/11/2026"
```

(Today's available money is 900,000 − 400,000 = 500,000 COP, and the one-off expense adds no future date: the calendar projects no pace, ruling P245. The window from 2026-10-31 runs through 2026-12-29, so December 30's salary falls outside it.)

- [ ] **Step 2: Write the steps and the seeding**

`tests/e2e/support/plan-seed.ts`: add `seedRecurrence(client, spaceId, body)`, which posts `/api/v1/spaces/${spaceId}/recurrences` and answers `{ id }`, and `seedHome(client, hh, accounts, { period, rolloverMode, close })`, which:
1. runs `seedReferencePlan(client, hh, { period, catchAll: false, activate: false, savingsAccountId: accounts.savings })`;
2. `PATCH`es Home's `rolloverMode` with `If-Match`;
3. activates the plan;
4. records `client.record(…/expenses, …)` of 1,300,000 COP in Groceries on the 15th of `period` from `accounts.bancolombia`;
5. with `close`, posts `…/close` with the last version.

`tests/e2e/steps/additions.steps.ts`:
- binds each step above;
- reuses `seedHousehold`, `seedAccounts` and `seedHome`;
- reads every expected string from the catalogs (`world.t(…)`) or from `shown(…)`, never from a hard-coded format.

The copy step posts `…/plans` with `{ period: "2026-11", copyFrom: "previous" }`. The cash-flow steps sign Ana up fresh, with no seeded account but the one the step names. They define both recurrences through `seedRecurrence` in her personal space, with `payer: { memberId: <her personal member id>, accountId }`, and end them in an `After` hook through `POST …/recurrences/{id}/end`, so the e2e server's scheduler never meets them again.

- [ ] **Step 3: Extend the layout spec**

`tests/e2e/layout.spec.ts`:
- In "no screen scrolls sideways", after the existing paths, seed through `SeedClient` a household with `seedHome(…, { period: "2026-10", rolloverMode: "ROLLOVER", close: false })`, its 2026-11 copy, and one recurrence named with 60 unbroken characters of 15-digit amount. Then check:
  - `/spaces/<household>/plan?period=2026-11` (a carry-over row waiting for October to close, the longest carry text);
  - `/spaces/<personal>/plan/calendar` and `/spaces/<personal>/plan/calendar?days=60`;
  - `/spaces/<household>/new` with the confirm panel open (type 212,300 COP, choose Groceries, tap Save).
- In "the last control of a scrolling screen ends above the bottom bar", add a screen `"record form, line warning confirmation"`:
  - `at`: the household's `/new`;
  - `prepare`: type the amount, choose Groceries and tap `es.ledger.form.save.EXPENSE`;
  - `submit`: `es.ledger.lineWarning.confirm`.

  Its `prepare` needs the seeded household, so the table entry takes the seeded ids the same way the record form's entry takes `spaceId`.
- In "touch targets are at least 44 x 44 px", add a test: the confirm panel's two buttons and the calendar's two window links each measure at least `TARGET` in both dimensions.

- [ ] **Step 4: Extend the accessibility scan**

`tests/e2e/a11y-plan.spec.ts`:
- Its seeding gains three things:
  - the November plan's Home set to ROLLOVER before the December copy, so December's Home says it carries over from November once November closes;
  - a CLOSED 2026-09 plan through `seedHome(…, { period: "2026-09", rolloverMode: "ROLLOVER", close: true })` and its copy into 2026-10, activated, so October's Home shows "+$ 170.000 de septiembre 2026". This Home, with 1,640,000 COP of budget and nothing spent in October, is the record form's line too;
  - one INCOME and one CONFIRM EXPENSE recurrence in Ana's personal space.
- The path loop gains `${me}/plan/calendar` and `${me}/plan/calendar?days=60`, `${hh}/plan?period=2026-10` (a carried amount, the state badges) and `${hh}/plan?period=2026-12` (a carry waiting for its plan).
- After the loop:

```ts
await page.goto(`${hh}/new`);
await expect(page.locator("[data-ready='true']")).toBeAttached();
await page.getByLabel(es.ledger.form.amount).fill("1350000"); // 82 % of 1,640,000 COP: the neutral note
await page.getByRole("button", { name: new RegExp(es.ledger.form.category) }).click();
await page.getByRole("radio", { name: /^Mercado|^Groceries/ }).click();
await scan("record form with the line note");
await page.getByLabel(es.ledger.form.amount).fill("1700000"); // 60,000 COP over: the confirmation
await page.getByRole("button", { name: es.ledger.form.save.EXPENSE }).click();
await expect(page.getByRole("heading", { name: es.ledger.lineWarning.confirmTitle })).toBeFocused();
await scan("record form asking before saving");
```

(The Groceries radio's name depends on the seed's language, as in 17b's drill-down. Use the catalog key the form's amount label has, if it is not `ledger.form.amount`.)

- [ ] **Step 5: Run them and see them bite**

Run: `pnpm build && pnpm test:e2e`.
Expected: PASS. Three checks show the scenarios bite; revert each after:
- Make `asksFirst` answer true for NEAR too: "An expense that leaves its line at 80 % saves at once" fails.
- In `planFigures`' caller, pass `previousAvailable` from a source that is not CLOSED: "A copy of a plan that is not closed carries nothing yet" fails.
- In `CashFlowCalendar`, render `opening` in place of each day's `balanceAfter`: "The calendar projects Ana's own account" fails.

A dark-theme contrast failure is fixed by moving its token's mix in `globals.css`, never by disabling the rule (P135). A layout failure is fixed in the component, never by excluding the screen.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e
git commit -m "test(web): run the line warning, rollover and cash-flow scenarios and check their layout and accessibility (Refs #142, Refs #143, Refs #150)"
```

---

### Task 18: Performance budgets for the new routes and the M6c documentation

Ruling P221 gives every new route its budget in `tests/performance/budgets.json`, on the same median-of-three Lighthouse run as P134. The routes:
- the shared space's Plan views;
- the planner, its capacities and the line editor;
- the personal Plan views, the cash-flow calendar included (Task 15b, ruling P242).

Lighthouse seeds a household with a six-plan chain, so the trend and the overview run on real data. That is the part of #128 these budgets reach. A Playwright INP check runs over the drill-down and the allocation editor on a 4× slower CPU. Then the docs: the decisions index, the architecture page, the stack versions, the backlog notes and the plan in the nav.

**Files:**
- Create: `tests/performance/seed-plan.mjs`, `tests/performance/routes.test.mjs`, `tests/e2e/perf/inp-plan.spec.ts`
- Modify: `tests/performance/budgets.json`, `tests/performance/lighthouse.mjs`, `docs/decisions/README.md`, `docs/README.md`, `docs/architecture/README.md`, `docs/stack-versions.md`, `docs/backlog/E9-web-ui.md`, `mkdocs.yml`

**Interfaces:**
- Consumes: `budgetFailures` (M6a Task 19), `scripts/e2e-server.mjs`, `SeedClient`'s request shapes (rewritten with `fetch` for Node).
- Produces: `routeUrl(route: string, ids: Record<string, string>): string`, exported by `tests/performance/lighthouse.mjs`, which replaces `:id`, `:planSpace`, `:plan` and `:line` and throws on an unknown placeholder; and `seedPlanRoutes(api): Promise<{ planSpace: string; plan: string; line: string }>`, from `seed-plan.mjs`.

- [ ] **Step 1: Write the failing test and the budgets**

`tests/performance/budgets.json`, `scriptKb` gains, after `"/settings": 200,` (keep the routes M6b added):

```json
    "/spaces/:planSpace/plan": 195,
    "/spaces/:planSpace/plan/members": 190,
    "/spaces/:planSpace/plan/fund": 190,
    "/spaces/:planSpace/plan/groups": 195,
    "/spaces/:planSpace/plan/trend": 300,
    "/spaces/:planSpace/plans/:plan": 200,
    "/spaces/:planSpace/plans/:plan/capacities": 200,
    "/spaces/:planSpace/plans/:plan/lines/new": 215,
    "/spaces/:planSpace/plans/:plan/lines/:line": 215,
    "/spaces/:id/plan": 190,
    "/spaces/:id/plan/groups": 195,
    "/spaces/:id/plan/trend": 300,
    "/spaces/:id/plan/calendar": 190
```

`tests/performance/routes.test.mjs` (the `unit` project already includes `tests/performance/**/*.test.mjs`):

```js
import { describe, expect, it } from "vitest";
import budgets from "./budgets.json" with { type: "json" };
import { routeUrl } from "./lighthouse.mjs";

const ids = { id: "sp-personal", planSpace: "sp-household", plan: "p-nov", line: "l-home" };

describe("Lighthouse routes (ruling P221)", () => {
  it("fills every placeholder of a route", () => {
    expect(routeUrl("/spaces/:planSpace/plans/:plan/lines/:line", ids)).toBe("/spaces/sp-household/plans/p-nov/lines/l-home");
    expect(routeUrl("/spaces/:id/plan/trend", ids)).toBe("/spaces/sp-personal/plan/trend");
  });

  it("refuses a placeholder it cannot fill, so a route is never measured on a wrong URL", () => {
    expect(() => routeUrl("/spaces/:other", ids)).toThrow("No value for :other");
  });

  it("has a budget for every Plan route", () => {
    for (const route of Object.keys(budgets.scriptKb).filter((r) => r.includes("/plan")))
      expect(budgets.scriptKb[route]).toBeGreaterThan(0);
    expect(Object.keys(budgets.scriptKb).filter((r) => r.includes("/plan"))).toHaveLength(13);
  });
});
```

Run: `pnpm exec vitest run --project unit tests/performance`
Expected: FAIL — `routeUrl` is not exported.

- [ ] **Step 2: Write the route filling and the seeding**

`tests/performance/lighthouse.mjs`:
- after `budgetFailures` add

```js
/** Ruling P221: a budget route with its placeholders filled; an unknown one throws instead of measuring a 404. */
export const routeUrl = (route, ids) =>
  route.replace(/:(\w+)/g, (_, name) => {
    if (!(name in ids)) throw new Error(`No value for :${name}`);
    return ids[name];
  });
```

- in the main block, after the 20 expenses are seeded, `const plan = await seedPlanRoutes(api);` (imported from `./seed-plan.mjs`);
- the loop's `route.replace(":id", space.id)` becomes `routeUrl(route, { id: space.id, ...plan })`.

`tests/performance/seed-plan.mjs` exports `seedPlanRoutes(api)`, where `api(method, path, body)` is the script's own helper:
1. It creates the shared space "Household" (the perf person alone, so the matrix and fund have one member) and a SAVINGS account in the personal space.
2. It creates the plan for 2026-05 with capacity 4,000,000 COP and the four reference lines, then copies it forward each period to 2026-10 (`copyFrom: "previous"`). Under the fixed e2e clock, 2026-10 is the current period. Plan writes need `If-Match`, so it passes the version of each answer, adding an `ifMatch` argument to `api`.
3. It maps the seeded categories (`rent`, `groceries`, `utilities`) on the 2026-10 plan, activates it, and records ten household expenses in October.
4. It defines two recurrences in the perf person's personal space on the seeded BANK account: an INCOME on day 30 and an EXPENSE on day 5, both from 2026-11-01. The calendar route then measures real rows (ruling P242).
5. It returns `{ planSpace, plan: <the 2026-10 plan's id>, line: <its Home line's id> }`.

- [ ] **Step 3: Write the INP check**

`tests/e2e/perf/inp-plan.spec.ts` follows `tests/e2e/perf/inp.spec.ts`: the same `web-vitals` init scripts and the same 4× CPU throttling over CDP. It seeds the perf household through `page.request`, as Lighthouse's `seedPlanRoutes` does, with the address `10.251.0.2`. It then does the following, and expects INP > 0 and ≤ `budgets.metrics.inpMs`:
1. Open `/spaces/<household>/plan/groups`.
2. Click the first group button, then the first category button, then the breadcrumb's first button.
3. Open the Home line's editor, choose the `budgeting.rule.PERCENT` radio, and type "42" and "58" into the two `budgeting.allocation.value` fields.

- [ ] **Step 4: Run the gates and read the numbers**

Run: `pnpm exec vitest run --project unit tests/performance`, `pnpm build`, `pnpm perf`.
Expected: every route within its budgets and INP ≤ 200 ms; one JSON line per route. `/spaces/:id/new` stays ≤ 205 and `/spaces/:shared/new` ≤ 215 KiB with Task 3c's line warning (ruling P242).

**If a route misses its budget, do not raise it silently** (P134). First apply the usual fixes:
- move a client component's import behind the lazy pattern, as `Sheet` and `LazyTrendChart` do;
- split a large client component;
- render a list on the server.

If a route still misses its budget by 10 KiB or less, follow P154's precedent under the owner's standing delegation: set that route's budget to its measured median plus 5 KiB, and record it as an amendment of P221 in the decisions index ("measured … KiB on …"). Over 10 KiB, stop with a **Needs your decision** result giving the numbers. The trend routes' 300 KiB assumes Recharts' chunk at about 110 KiB. If the chunk alone measures over 130 KiB, stop with the numbers too: drawing the two lines as plain SVG is the alternative to put to the owner.

- [ ] **Step 5: Write the documentation**

- `docs/decisions/README.md`:
  - the intro line and the "ranges are" sentence gain ", and M6c P200–P247";
  - a new section `### M6c: budget planner and dashboards (P200–P247)` goes after the M6a section. It has a `Plan:` line linking this file and one row per ruling. Each row's "Where" is `Rulings, <n>`, the Self-Review's numbering below;
  - M6b's section, if it lands in the same file first, keeps its place.
- `docs/README.md`: "every ruling P1 to P154" becomes "every ruling P1 to P247". If M6b already changed it to P199, replace that.
- `docs/architecture/README.md`: in the "Web UI" section add a paragraph:
  - the Plan tab (P200) and the module UIs `budgeting/ui` and `reporting/ui`;
  - "figures are the API's" (P201);
  - HTML bars, and Recharts only in `reporting/ui/charts/*-chart.tsx` behind `import()`, enforced by the two dependency-cruiser rules (P202);
  - the plan writes' `If-Match` (P206);
  - the record form's line warning, a labelled preview over the line dashboard with the kernel's `lineStateOf` (P233–P237, P244);
  - the cash-flow calendar, projected by reporting from the ledger's `listScheduledMovements` port (P238–P241, P245, P246).

  The Modules paragraph lists `budgeting` and `reporting` among the modules with a `ui/` layer.
- `docs/stack-versions.md`: two rows: `recharts` "3.10.1 — installed (M6c); 3.11.x was a canary when M6c was planned"; `react-is` "19.3.0 — installed (M6c), Recharts' peer, matching React 19.3.0".
- `docs/backlog/E9-web-ui.md`:
  - HU-E9-08's note "Containers `PlannerContainer`, `CapacityContainer`, `LineEditorContainer`, `AllocationEditorContainer`" gains: "(the allocation editor is part of the line editor and saves with it, M6c ruling P210)";
  - HU-E9-10's "presentational chart components (Recharts bar per line)" becomes "presentational components with HTML bars beside the same figures (M6c ruling P202)";
  - its "a Recharts donut or bar chart of the groups, with a table of the same figures" becomes "rows of the groups with HTML bars, which are the table of the same figures (M6c ruling P202)";
  - HU-E9-11's "Recharts line charts with a default window of 6 periods" gains "(lazy-loaded, M6c ruling P202)".

  The controller updates the three issue bodies the same way.
- `mkdocs.yml`: the plans list gains `"M6c Planner and dashboards": plans/2026-10-21-m6c-planner-and-dashboards.md`, after M6b's entry (or after M6a's when M6b has none).

- [ ] **Step 6: Run every gate**

Run: every gate, `pnpm test:e2e`, `pnpm perf`, and `pipx run mkdocs build --strict` if mkdocs is available locally (CI's docs job runs it).
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/performance tests/e2e/perf docs mkdocs.yml
git commit -m "ci(web): budget every plan and dashboard route, and document M6c (Refs #76, Refs #78, Refs #79, Refs #142, Refs #143, Refs #150)"
```

---

## Self-Review

### Story coverage

**HU-E9-08 — Budget planner screens (#76)**

| Scenario or technical note | Covered by |
|---|---|
| `@e2e @golden` Build the reference plan (total capacity 4,000,000 COP split 40.00 % / 60.00 %, unallocated 0, Home at 36.75 %) | Task 17a (`budget-planner.feature`, through the no-plan card, the capacities and the line editor); Task 4 planner test (the figures); Tasks 6 and 7 (the bodies sent) |
| The capacity suggestion is private (Ana sees 1,650,000 COP with "Use suggestion"; Juan never sees it) | Task 6: the form tests (Ana's row only; Juan sees only his own; an answer naming another member is never shown) and the container (fetched on the server, never blocking); ruling P208 |
| The allocation editor previews 306,600 / 423,400 COP and rejects 99 % with `errors.InvalidAllocation` | Task 8: `previewOf` and `allocate` (checked against `Money.allocate`), the editor test ("Suma: 99,00 %"), the line editor's blocked save; ruling P211 |
| A line can be left unallocated (planned, spent and available without per-member amounts) | Task 8: the line editor test (the NONE rule: figures stay, member rows go, `PUT …/allocation` with `NONE`) |
| Copy the previous plan (the draft 2026-12 with the four lines; "Utilities" listed as dropped) | Task 5 (`PlanStartActions` sends `copyFrom: "previous"`, `CopyNotice` names "Utilities, que alimentaba Home"); ruling P209 |
| Activate and close from the planner (`errors.InvalidAllocation` names "Free"; Active; Closed disables editing) | Task 4: planner test (the 422 with `lineIds`, then Activo, then Cerrado with no edit control, version by version); rulings P206, P214 |
| Note: containers `PlannerContainer`, `CapacityContainer`, `LineEditorContainer`, `AllocationEditorContainer` | Tasks 4, 6 and 7. The allocation editor is a client component inside the line editor, saved by its sequence, not a container of its own (ruling P210; Task 18 amends the note) |
| Note: the suggestion only for the signed-in member, never in the shared plan DTO | Task 6 (P208) |
| Note: `If-Match` with the plan's ETag; a 412 shows `errors.PreconditionFailed` and reloads the plan | Task 4 (`planWrite`, `rereadPlan`), and every write of Tasks 5–8 (ruling P206) |
| Note: category mapping as a multi-select of the space's active categories | Task 8 (`CategoryMappingSheet`, ruling P212) |

**HU-E9-10 — Space dashboards (#78)**

| Scenario or technical note | Covered by |
|---|---|
| `@e2e @golden` Line dashboard shows planned, spent and available (five rows, Unbudgeted −60,000 COP) | Task 17b (`dashboards.feature`); Task 3 table test; Task 1 (the totals of the summary) |
| Overspent lines are highlighted (Home −130,000 COP with "Overspent") | Task 3 test (the badge and the negative amount; no badge on other rows; ruling P226) |
| A period without a plan offers to create or copy one (all spending under Unbudgeted) | Task 5 (`NoPlan`: the managers' actions, the members' note, the Unbudgeted row) |
| Member matrix translates reason codes (Home: Ana 588,000 / 900,000 / 520,000 / 312,000 "over-contributed"; Rent's cells read `reports.reason.TRACKED_AT_FUND_LEVEL`) | Task 9 tests; ruling P217 |
| Fund tracking compares expected and actual (Juan 720,000 / 500,000 / −220,000 COP) | Task 10 test; Task 1 (totals) |
| Spending by group drills down to categories and subcategories (shares, `reports.byGroup.noSubcategory`, breadcrumb "Food › Groceries", back to Food) | Task 11 (`spending-tree` and the chart test, one request); ruling P215 |
| Note: containers `LineDashboardContainer`, `MemberMatrixContainer`, `FundTrackingContainer`; presentational charts receive DTOs only | Tasks 3, 9 and 10, under those names. The bars are HTML (ruling P202; Task 18 amends the note, design deviation 1) |
| Note: reason and status codes map to `reports.reason.<Code>` and `reports.status.<Code>` | Task 9 |
| Note: viewers see every dashboard; period navigation follows the space's policy | The containers gate nothing by role; Task 3's frame test (VIEWER: "Ver plan"); `neighboursOf` (ruling P205) |
| Note: `SpendingByGroupContainer` loads once, with `SpendingChart` and `DrillBreadcrumb`; drilling on the client; the archived badge; amounts and shares never recomputed | Task 11 |
| The desktop layout (DashDesktop) | Task 16 (ruling P216); Task 17b scans it at 1440 px |

**HU-E9-11 — Personal dashboards (#79)**

| Scenario or technical note | Covered by |
|---|---|
| `@e2e` Unified view totals across spaces (consumption 1,575,000 COP, cash out 2,625,000 COP, Groceries one row of 1,035,000 COP) | Task 17b (`personal-dashboards.feature`, the HU-E7-04 fixture seeded with EXACT splits); Task 12 test |
| Movements recorded as a guest are labelled outside the app | Task 12 (the `reports.outsideTheApp` row; ruling P218) |
| Line trend versus the previous period (Home −50,000 COP (−3.70 %)) | Task 15 test (`ChangeText`) |
| A new line shows a badge instead of a percentage (Pets "New") | Task 15 test (no "%" in Pets' row) |
| Six-period personal consumption chart (6 points from 2026-06 to 2026-11) | Task 14b (the chart's six periods and the same six rows); Task 17b (six dots in a real browser) |
| Spending by group merges seeded groups and labels custom ones by space ("Food" 68.44 %, "Household / Pets"; Groceries one slice of 94.52 %) | Task 13 |
| Note: containers `UnifiedViewContainer`, `LineTrendContainer`, `PersonalTrendContainer`; Recharts line charts with a default window of 6 periods | Tasks 12, 14b and 15, under those names; Task 14a (Recharts behind `import()`); ruling P219 (6 or 12) |
| Note: the viewer's personal period and catalog-key grouping; custom categories as "space / category" | Task 12 (`loadUnified` takes the personal space's periods; `reports.spaceScoped`) |
| Note: `NEW` renders `reports.trend.new`; percentages in the user's number format with two decimals | Task 14b (`ChangeText`); Task 2 (`formatPercent`, ruling P204) |
| Note: `PersonalSpendingByGroupContainer` reuses `SpendingChart` and `DrillBreadcrumb`; "space / group" through one pattern, never joined strings | Task 13 (and `NodeLabel`, Task 11) |

**#142 — Warn before saving an expense that takes a plan line past 90% or over**

| Requirement | Covered by |
|---|---|
| "the record form shows the line's state and asks the person to confirm before saving. The person can still save." | Task 3c (the confirmation panel; "Guardar de todos modos" sends the one POST); Task 17c's scenario; ruling P237 |
| "Reuse the line dashboard figures (planned, spent and available, M6c Task 1 totals)." | Task 1b (`categoryLines`, `state`), Task 3c (`lineWatchOf` over the line dashboard); ruling P234 |
| "Do it client-side from the plan view, or add an advisory `warnings` entry to the expense response." | Ruling P233 (client-side; a `warnings` entry would arrive after the save) |
| "The confirm step must not slow the common case. Show it only when the threshold is crossed." | Task 3c (no request on Save; nothing below 80 %; NEAR never asks); rulings P235, P236 |
| Comment: "A neutral early warning at 80% that is not yet red" | Task 1b (`lineStateOf`), Task 3b (the neutral badge), Task 3c (the neutral note); rulings P235, P244 |
| Comment: "The overage stated as an amount in words, for example "Te pasaste por $ 42.300"" | Task 3b ("Te pasaste por $ 130.000" from `overBy`), Task 3c ("te pasarías por $ 42.300"); ruling P244 |
| Coordinator (L3): "5125% spent" with no warning state; cap or reword percentages above 100 % | Tasks 3b and 3c (no "%" on an OVER line or warning); ruling P244 |

**#143 — Roll a plan line's leftover into the next period**

| Requirement | Covered by |
|---|---|
| "a per-line option on the monthly plan to carry what is left of a line … into the same line of the next period" | HU-E6-09's ROLLOVER (already in the API), shown and explained by Task 8b; ruling P228 |
| "whether an overspent line carries a negative amount forward" | Ruling P228 (only ADJUSTED; ROLLOVER floors at 0) |
| "how copying a plan from the previous period treats the carried amount" | Rulings P230 and P243; Task 1e (by the origin link, only from a CLOSED plan, never stored) |
| "how the line dashboard shows it" | Task 8b (`CarryText` on the dashboard, the planner and the editor); ruling P231 |
| "Rollover must not break the rule that lines sum to at most the capacity." | Ruling P229; Task 8b's backend pin |
| Comment: "sinking funds for yearly bills" | Ruling P232; Task 8b's ROLLOVER hint; follow-up 13 |
| Coordinator (L3): carry only from closed periods in which the line existed, and show where it came from | Task 1e (`carryOverFrom`, the closed gate, a line without an origin carries nothing); Task 8b; Task 17c (both scenarios); ruling P243 |

**#150 — A cash-flow calendar of what is coming in the next 30 and 60 days**

| Requirement | Covered by |
|---|---|
| "Show, by day, the money that will come in and go out over the next 30 and 60 days" | Task 1d (`/me/cash-flow?days=30\|60`), Task 15b (the Próximos view); rulings P238, P241 |
| "recurring incomes, recurring bills, pending recurrence occurrences and planned transfers to funds" | Task 1c (schedule dates, PENDING occurrences, FUND_CONTRIBUTION recurrences); ruling P239 |
| "with the balance projected after each" | Task 1d (`balanceAfter`, totals, lowest); ruling P240 |
| "It uses the recurrence model Hearth already has." | Task 1c (`datesThrough`, `listScheduledMovements`); ruling P238 |
| Coordinator (L3): only known items, no pace from one spike | Task 1d (the one-off expense adds no date), Task 17c; ruling P245 |
| Coordinator (L3): place items by local date; a test at the start of a Bogotá day | Task 1d (`04:59:59Z` and `05:00:00Z`), Task 15b ("2027-03-15" as 15/3/2027); ruling P246 |
| Coordinator (L3): confirm before a bulk money action | Task 15b (no button, no form); ruling P247 |

**Owner constraints**

| Constraint | Covered by |
|---|---|
| Strict TDD and RDD in every task | Every task opens with its failing test and its "see it fail" step; Execution Workflow, RDD |
| The stories' `@e2e` scenarios through playwright-bdd | Tasks 17a and 17b (three scenarios, verbatim) |
| Axe scans of the new screens | Every component test runs axe; Task 17b scans every screen and sheet in light and dark, the desktop overview and both charts |
| A budget for each new route, following P134 and P154 | Task 18 (thirteen routes with the calendar's, ruling P242; the procedure of ruling P221, INP over the drill-down and the allocation editor); the record routes keep theirs with the line warning (Task 3c) |
| Every new screen and state meets the UI rules of the owner's review (2026-10-21) and joins the layout spec and the axe scans | Task 17c (`layout.spec.ts` at 390 and 320 px, the last control above the bar, 44 px targets; `a11y-plan.spec.ts` in light and dark); the calendar is a Plan tab view, the confirmation panel ends the form |
| Recharts pinned on or before 2026-10-07, lazy-loaded, charts with their figures as a table, passing axe | Task 14a (3.10.1 of 2026-07-25; the two rules); Tasks 14b and 15 (table and chart from one series); Task 17b; rulings P202, P203, P220 |
| The Plan tab in the bottom bar | Task 3 (ruling P200, amending P141) |
| Reuse of the existing helpers | `browserApi`/`serverApi`, `loaded`, `getMe`, `getSpaces`: every container. `problemFrom`, `fieldOf`/`useProblemMessage`: Tasks 4–8. `formatMoney` and the period helpers (`addDays`, `nowIn`, `serverNow`, `periodName` moved in Task 2): every screen. `Sheet`/`Button`/`TextField`: Tasks 4–8. `fakeApi`/`renderWithIntl`/`axeViolations`: every test. The category tree helpers and `CategoryIcon`: Task 8. `parseDecimal`/`minorOf`: Tasks 6–8 |
| Spanish in neutral *tú* | Every catalog entry ("Elige", "Revisa", "Toca", "Escribe", "Pídele" style; no *voseo*) |

### Review Focus pins

| Review Focus | Pinned by |
|---|---|
| 1. A figure the browser invents | Task 1 (the API's totals); Task 3 and Task 10 "the API's totals, never a sum of the rows"; Task 11 shares as answered |
| 2. The private suggestion leaking | Task 6 form tests (three cases) and the container |
| 3. Lost and conflicting plan writes | Task 4 (`planWrite`, 412 re-read, pending guard); Task 7 (`saveLine`, the line step); Task 8 (the versions 7, 8, 9 of three steps; a stop that keeps the saved line) |
| 4. Allocation previews that disagree with the server | Task 8 (`allocate` against `Money.allocate`, the story's numbers, the peso-off FIXED sum) |
| 5. Roles and closed plans | Task 4 (`canManage`, `capacityEditable`, the VIEWER, MEMBER and CLOSED tests); Task 5 (no actions for a MEMBER); Task 6 (MEMBER rows); Task 7 (the read-only editor) |
| 6. Charts that cost every route or hide their data | Task 14a (rules, fixtures, lazy wrapper); Tasks 14b and 15; Task 17b; Task 18 (budgets) |
| 7. Drill-down that drifts from the response | Task 11 (one request, levels, `noSubcategory`, archived, breadcrumb); Task 13 |
| 8. A warning that slows, blocks or disagrees | Task 1b (`lineStateOf`); Task 3b; Task 3c (boundaries, one request, no "%"); Task 17c |
| 9. Carry-over that is invented, hidden or breaks capacity | Task 1e (the closed gate, `carryOverFrom`); Task 8b (capacity pin, carry texts); Task 17c |
| 10. A projection that counts someone else's money, counts twice or drifts in time | Tasks 1c and 1d (own accounts, pending once, the Bogotá day, the one-off expense); Task 15b |

### Rulings

1. **The Plan tab, its views and its routes** (Tasks 3, 12, 13, 14b, 15). **Ruled by the planner (P200), amending P141:** the bottom bar shows Plan, a link to `/spaces/{spaceId}/plan` that is current on every path under `…/plan` and `…/plans`. Its views depend on the space's kind. A shared (or direct) space shows Lines (the tab's own page), Members, Fund, By group and Trend. The personal space shows My spending (its own page), By group, Trend and Lines, the canvas's own two lists. Routes are `…/plan`, `…/plan/{members|fund|groups|trend|lines}`, `…/plans/{planId}`, `…/plans/{planId}/capacities`, `…/plans/{planId}/lines/new` and `…/plans/{planId}/lines/{lineId}`, each dashboard with `?period=<label>` (the trend also with `?periods=6|12`). There is no "plan of a period" endpoint, and a dashboard reaches the planner through the `plan` its report answers. Reasons: one tab for everything about the plan, as the canvas notes say; the API already answers `plan: { id, status }` on every space report. Rejected: a `GET …/plans?period=` endpoint (no screen needs it); a separate Dashboards tab (a sixth slot the canvas does not draw).
2. **Figures are the API's** (Tasks 1, 3, 9–13, 15). **Ruled by the planner (P201):** the UI never sums, subtracts or recomputes an amount or share it shows. The line dashboard and fund tracking therefore answer `totals` (Task 1, additive, not a contract break). Bar widths are presentation; the allocation preview is a labelled exception the server overrides on save (P211). Reasons: HU-E9-10's note ("the UI never recomputes them") extended to every figure, M6a's P131 precedent ("only the API's totals are figures"), and one source of truth for rounding. Rejected: summing rows with `BigInt` in the browser (two places to keep in step with D7's derivations).
3. **Bars are HTML; Recharts draws only the time series, lazily** (Tasks 3, 10, 11, 14a, 14b, 15). **Ruled by the planner (P202):**
   - The line, fund, by-group and unified bars are CSS widths inside the rows that carry their figures, so the table and the chart are one element: the canvas notes say "cada una con sus cifras al lado, así que la tabla y la gráfica son lo mismo".
   - Recharts 3.10.1 draws the personal trend and the line trend. `LazyTrendChart` fetches the chart's chunk once after mount (M6a's lazy `Sheet` pattern), behind a placeholder of the same size.
   - Dependency-cruiser enforces both halves: `recharts-only-in-charts` and `charts-load-lazily` (a static import of `reporting/ui/charts/*-chart.tsx` fails).
   - Reasons: P134's script budgets, the owner's speed condition, keyboard drilling through real buttons, and axe-clean figures without SVG roles.
   - This deviates from HU-E9-10's technical notes ("Recharts bar per line", "a Recharts donut or bar chart"); it is listed for the owner as design deviation 1 and amended in the backlog by Task 18.
   - Rejected: Recharts bar charts on the Lines and By group views (about 110 KiB more on the most visited Plan pages, and a second keyboard path for drilling); `next/dynamic` with `ssr: false` (the codebase already has its own lazy pattern, and it is testable in jsdom); hand-written SVG for the trends (the story asks for Recharts; it stays the fallback if its chunk misses the budget, Task 18).
4. **Chart dependencies** (Task 14a). **Ruled by the planner (P203):** `recharts` 3.10.1 (published 2026-07-25, the newest stable on or before 2026-10-07; the 3.11 line was a canary until 2026-10-13) and its peer `react-is` 19.3.0 (2026-09-09, matching React 19.3.0, pinned because `check:pinned` allows no implicit peer). Its transitive ranges (`@reduxjs/toolkit`, `immer`, `reselect`, `es-toolkit`, `victory-vendor`, `decimal.js-light`) are fixed by the lockfile. Rejected: Recharts 2.15.x (the 2.x line is in maintenance, and 3.x is what the story's stack targets), Victory or Chart.js (no story names them).
5. **Percentages and signed changes** (Task 2). **Ruled by the planner (P204):** `formatPercent` keeps the API's two decimals ("40,00 %"), follows the number format, writes a non-breaking space before "%" in both languages and U+2212 for negatives, and writes "+" for positive changes when asked. `formatSignedMoney` writes "+$ 50.000", "−$ 50.000" and "$ 0". Reasons: HU-E9-11 asks for two decimals in the user's number format (D23), and `formatNumber` drops zero fractions.
6. **The period of a dashboard** (Tasks 3, 9–15). **Ruled by the planner (P205):** `?period=<label>`, else the period of the space that holds today in the viewer's zone (`GET …/periods?from=<today>&count=1`). The neighbours come from the day before the start and the day after the end (M6a's P130 method). Personal views use the personal space's periods (D11). The heading is "noviembre 2026" for a calendar month, else the two dates in the person's format.
7. **Plan writes** (Tasks 4–8). **Ruled by the planner (P206):** every write sends `If-Match: "<version>"` of the last answer and keeps the whole plan it answers. A 412 shows `errors.PreconditionFailed` and re-reads the plan in the browser (the message stays). There is no `Idempotency-Key`, since the plan endpoints take none: a retry after a lost answer meets a 412 and the re-read shows what was saved. Lifecycle buttons are disabled while pending and guarded by a ref against a second click before the re-render.
8. **Who sees what** (Tasks 3–8). **Ruled by the planner (P207):**
   - OWNER and ADMIN edit plans;
   - a registered MEMBER changes only their own capacity (D17) and otherwise reads;
   - a VIEWER reads;
   - a CLOSED plan is read-only for everyone;
   - the dashboard's link reads "Editar plan" for managers and "Ver plan" for the others;
   - Create and Copy plan are offered to managers only, and the others read why.
   The API stays the authority (`InsufficientRole` is translated if it answers).
9. **The private suggestion** (Task 6). **Ruled by the planner (P208):** only the capacities container reads `GET …/capacity-suggestion`, on the server, with the request's cookie. A failed read is `null`, never an error page. The suggestion is shown only on the row its `memberId` names, and only when that row is the viewer's own. "Use suggestion" fills the field; nothing is saved until "Save capacities". The total and the shares are the stored ones until the save answers.
10. **The copy notice** (Task 5). **Ruled by the planner (P209):** a copy's `dropped` travels once to the planner through `sessionStorage` (`hearth.planCopy.<planId>`), read after hydration and removed. Categories are named from the space's tree with archived ones included, and lines from the copy. A reload or another tab loses the notice, which loses only information. Rejected: query-string ids (user data in URLs) and a new endpoint for a plan's copy history.
11. **Saving a line** (Tasks 7, 8). **Ruled by the planner (P210):** `saveLine` runs these steps in order, each only when it has something to send and each with the version the step before answered:
    1. add (`POST`) or edit (`PATCH`, only the changed fields);
    2. the categories (`PUT`);
    3. the allocation (`PUT`).

    The first failure stops the sequence, keeps what was saved and points at its section. The allocation editor is therefore part of the line editor, not a container of its own (amends HU-E9-08's note).
12. **The allocation preview** (Task 8). **Ruled by the planner (P211):** `allocate` mirrors the kernel's `Money.allocate`: whole rounding units by largest remainder, ties to the earlier weight, the sub-unit remainder on the first part. A test pins it to the kernel. The UI's currencies gain the kernel's rounding unit. PERCENT must sum to exactly 100 % and FIXED to the planned amount; otherwise `errors.InvalidAllocation` and the sum are shown and the save is blocked. The server's answer has the last word.
13. **Mapping categories** (Task 8). **Ruled by the planner (P212):** a sheet of checkboxes over the live parent categories of the space. Subcategories are never offered (HU-E3-04), and a category mapped to another line is disabled and names that line. A savings line shows no categories and no catch-all switch.
14. **Savings accounts on a line** (Task 7). **Ruled by the planner (P213):** the line editor offers the caller's own active SAVINGS accounts of their personal space in the plan's currency, because the API attaches only accounts the caller owns (P8). Ids the line already names that the caller cannot see show as "Cuenta de ahorro de otro miembro" and are kept unless unchecked.
15. **The plan cycle on screen** (Task 4). **Ruled by the planner (P214):**
    - Activate is offered for a DRAFT, and its `InvalidAllocation` names the lines of `lineIds`;
    - Close is offered for an ACTIVE plan, disabled until the day after the period's last day in the viewer's zone, with the date in the hint; the API's `PeriodNotOver` is still translated;
    - CLOSED hides every edit control.
16. **Drill-down by group** (Tasks 11, 13). **Ruled by the planner (P215):**
    - one request per screen and the levels on the client;
    - a category gets a subcategory level only when it holds a named subcategory, so Restaurants does not drill;
    - node ids come from `id`, else the catalog `key`;
    - the breadcrumb's root is "Todos los grupos", and the current crumb is `aria-current="location"`;
    - the bar width is the answered share;
    - space-scoped names are written through `reports.spaceScoped`.
17. **The desktop overview** (Task 16). **Ruled by the planner (P216):** a shared space's `…/plan` adds, from 1024 px, the By group, Fund, Against the previous period and Members by line panels of the DashDesktop artboard. Under 1024 px they are `hidden`, and the tabs lead to each view. The four reads run in parallel after the line dashboard names the period. A failed read leaves its panel out, and no chart is drawn. The extra reads' cost on `/plan` is measured by its LCP budget (Task 18), the part of #128 these budgets reach.
18. **The member matrix** (Task 9). **Ruled by the planner (P217):**
    - a null cell shows "—" and reads the line's reason (or "Sin dato") to assistive technology;
    - the reason is also written once under the table;
    - a SAVINGS line explains it has no consumption;
    - the gap shows its sign and status badge, and a fund-level line links to the Fund view.
19. **The unified view** (Task 12). **Ruled by the planner (P218):**
    - consumption and cash out cards;
    - the cash-out sources, with "Pagado fuera de la app" only when it is not zero;
    - categories in the API's order and named as the API names them: a merged row by its name, a custom one as "space / category";
    - bars relative to the largest row;
    - one notice per space in another currency.
20. **Trends** (Tasks 14b, 15). **Ruled by the planner (P219):** windows of 6 (default) or 12 periods. `ChangeText` writes "−$ 50.000 (−3,70 %)" with a Down, Up or Same badge; for spending, Up uses the owe tone. NEW shows the "Nueva" badge and "Sin período anterior", with no percentage. The personal table runs newest first. The line trend's table is a focusable, horizontally scrollable region, and the page itself never scrolls sideways.
21. **Chart accessibility** (Tasks 14a, 14b, 15). **Ruled by the planner (P220):** a `figure` with a visible `figcaption`. The chart's root is `aria-hidden`, with Recharts' `accessibilityLayer` off and no legend. The table beside it carries the same series and is the accessible source. The tooltip writes figures through `formatMoney`.
22. **Budgets for the new routes** (Task 18). **Ruled by the planner (P221):** twelve routes in KiB of compressed script, from P154's measurements (home and accounts 185, transactions and record 205):
    - dashboards rendered on the server: 190 (members, fund, personal My spending);
    - with the drill-down island: 195 (by group, both kinds; the shared `/plan`, which also holds the no-plan actions);
    - planner and capacities: 200 (one client form each);
    - line editor: 215 (two sheets and the allocation editor);
    - trends: 300 (190 plus the Recharts chunk, estimated at about 110 KiB).

    LCP, CLS and TBT are unchanged. INP is checked over the drill-down and the allocation editor. A miss is fixed first. A remaining miss of 10 KiB or less is recorded as an amendment at measured + 5 KiB, P154's precedent under the owner's standing delegation; a larger one is the owner's decision.
23. **End-to-end seeding** (Tasks 17a, 17b). **Ruled by the planner (P222):** M6c seeds households through its own `tests/e2e/support/plan-seed.ts`. Juan signs up in his own request context with the test's address and accepts a link invitation. Plan writes carry `If-Match`, and splits are EXACT, as the HU-E7-04 table gives them. The household is kept in a `WeakMap` keyed by the World, so M6a's `World` and whatever M6b added stay untouched.
24. **Test files outside dependency-cruiser** (Task 14a). **Ruled by the planner (P223):** `\.test\.(ts|tsx|mjs)$` is excluded (M6a excluded `.ts` and `.mjs` only, preflight note N7), so a chart's test may import the chart file directly without tripping `charts-load-lazily`.
25. **Shared period pieces** (Task 2). **Ruled by the planner (P224):** `periodName` moves from `ledger/ui/home` to `src/shared/ui/time/period-name.ts`. `usePeriodText` and `PeriodSwitcher` join `src/shared/ui`. Three modules now name periods, and a module UI may not reach into another's non-index files.
26. **New interface icons** (Task 2). **Ruled by the planner (P225):** `chart` (the Plan tab), `pencil` (edit), `arrowUp` and `arrowDown` (gaps and changes), with the Batch 2 artboards' own paths.
27. **Unbudgeted on the line dashboard** (Task 3). **Ruled by the planner (P226):** the Unbudgeted row shows planned `$ 0` (it plans nothing by definition, HU-E6-04) and carries no "Overspent" badge: the badge marks lines that went over their plan, while Unbudgeted's `overspent` only says something was spent there. Its negative available amount is shown in the owe color like any other.
28. **The three additions and their order** (Tasks 1b, 1c, 1d, 1e, 3b, 3c, 8b, 15b, 17c). **Ruled by the planner (P227), under Log L2:**
    - #142, #143 and #150 join M6c as nine tasks;
    - the backend comes first, test-first, right after Task 1: 1b (`categoryLines`, the lines' states), 1c (the ledger's scheduled movements), 1d (`/me/cash-flow`) and 1e (carry only from a closed plan);
    - each UI task sits after the tasks it depends on:
      - 3b (the dashboard's states) after Task 3;
      - 3c (the record form's warning) after Task 3b and the M6b addendum's A4 and A7;
      - 8b after Task 8;
      - 15b after Task 15;
    - 17c follows 17b with the scenarios, the layout spec and the axe scans;
    - Task 18 budgets the calendar's route.

    A lettered label is a place in the order, not a split pass of the task before it. Reasons: Task 1 already set the pattern of a small additive API task first, and no addition blocks a story task. Rejected: a separate milestone (the owner asked for M6c), and amending the story tasks in place (their reviews would mix two scopes).
29. **Rollover is HU-E6-09's, unchanged** (Task 8b). **Ruled by the planner (P228):**
    - #143's per-line option already exists as `rolloverMode` (ruling P15): RESET carries nothing; ROLLOVER carries the previous available amount floored at 0; ADJUSTED carries only an overspend.
    - So an overspent line carries a negative amount only under ADJUSTED. Under ROLLOVER an overspend carries 0, as the backlog's table pins ("ROLLOVER | 1,600,000 COP | −130,000 COP | 1,470,000 COP").
    - M6c adds no mode. Task 1e narrows where a carry may come from (ruling P243).

    Reasons: the issue's "carry what is left" is ROLLOVER, and its open question was answered when HU-E6-09 was built. Rejected: a fourth mode carrying both signs (ADJUSTED plus ROLLOVER). No story asks for it, and it would let one bad month drain every later one.
30. **Carry-over and capacity** (Task 8b). **Ruled by the planner (P229):** `carryOver` is never part of `planned`. "Σ planned ≤ total capacity" (spec 5.2, HU-E6-02) counts the lines' planned amounts only, so a carry can never break it. A carry is money set aside in an earlier period, not this period's income. A backend test pins it (Home plans all 4,000,000 COP while it carries 200,000), and the line editor's ROLLOVER hint says so.
31. **Carry-over through copies, derived on read** (Task 8b). **Ruled by the planner (P230):**
    - A copy keeps each line's mode and links it to its source by `originLineId` (HU-E6-06).
    - The carried amount is derived on read from the origin line's available amount and is never stored (D7). Only a CLOSED source carries (ruling P243). A late expense in a closed period is refused (ruling P25), so a carry no longer moves once it shows.
    - A plan created without copying, or after a period with no plan, carries 0 (HU-E6-09's "No previous plan").
    - The editor says that a carry passes through a copy of a closed plan (`budgeting.rollover.throughCopy`).
32. **Carry-over on screen** (Task 8b). **Ruled by the planner (P231):**
    - The line dashboard's row, the planner's line and the line editor's figures show the carry with its source, through one `CarryText`. A closed source reads "+$ 170.000 de septiembre 2026" (`formatSignedMoney`, the period named as the frame names it); an open one reads "Se arrastra de octubre 2026 cuando ese plan se cierre."
    - `available` is rendered as answered, since it already includes the carry.
    - A line's bar measures spent against planned + carry-over. That is presentation, not a figure, which P202 allows.
    - Each mode has a hint under the editor's choice, described by it.

    Rejected: a fourth table column "Del período anterior". It would push the Lines table past 320 px and show zeros on most rows.
33. **Sinking funds for yearly bills** (Task 8b). **Ruled by the planner (P232):** a sinking fund is a ROLLOVER line whose planned amount is the monthly saving toward the bill, such as SOAT, predial or insurance. Its balance rolls forward until the bill's expense consumes it. The editor's ROLLOVER hint names that use. M6c adds no target amount, no due date and no "on track" figure (follow-up 13). Paying the bill exactly empties the line, so #142's check asks once there (P235); that costs one tap.
34. **Where #142's check runs** (Task 3c). **Ruled by the planner (P233):**
    - The check runs in the browser, from the line dashboard of the period holding today. The record form's container reads that dashboard on the server, beside the form's other data.
    - It is not an advisory `warnings` entry in the expense's answer. A warning there arrives after the save, and the issue asks to confirm before it.
    - Saving therefore sends the one request it sends today, which keeps the common case as fast as it is ("The confirm step must not slow the common case").

    Rejected:
    - a preview endpoint called on Save (a round trip on every save);
    - a debounced preview call while typing (requests per keystroke, and a race with Save).
35. **The line of each category comes from the API** (Task 1b). **Ruled by the planner (P234):** `GET …/reports/lines` answers `categoryLines` for every live category: a category's mapped line, a subcategory's parent's line (HU-E3-04), else the catch-all line, else null for Unbudgeted. It is computed by budgeting's own `lineForCategory` and `rolledUpCategory`, so the browser never re-implements the mapping rule. A SAVINGS line consumes transfers and is never checked.
36. **Thresholds and the line's budget** (Task 3c). **Ruled by the planner (P235):**
    - The line's budget is planned + carry-over (HU-E6-09). After the expense, available − amount is left, and the share used is (budget − left) ÷ budget, rounded down to two decimals.
    - The level is the shared kernel's `lineStateOf` applied to what would be left: the API's own rule (ruling P244), so the form and the dashboard cannot disagree.
    - OVER when less than 0 would be left: it asks first and states the overage as an amount, "te pasarías por $ 42.300" (the comment's "Te pasaste por $ 42.300" in the conditional, since nothing is saved yet). It writes no percentage.
    - HIGH when more than 90 % would be used (exactly 100 % included): it asks first and says what would be left.
    - NEAR from 80 % through 90 %: a note in the neutral tone that never asks (the comment's early warning, "not yet red").
    - Nothing below 80 %.

    Arithmetic is integer, in minor units. This is the second labelled preview after P211: the server's dashboard has the last word, and the dashboards still never compute a figure (P201).
37. **When the check applies** (Task 3c). **Ruled by the planner (P236):** the check applies only when every condition holds:
    - the kind is EXPENSE;
    - the expense is recorded in the form's own space, so not a split with someone and not an edit (A7's `edit`);
    - the period has an ACTIVE plan, not a DRAFT still being built or a CLOSED period;
    - the chosen date falls inside the loaded period;
    - the category feeds a non-SAVINGS line;
    - the amount is above 0.

    Today is the profile zone's today, read once when the form loads. A failed read means no check, never an error. Every save stays possible.
38. **One feedback channel** (Task 3c). **Ruled by the planner (P237):**
    - The warning is part of the form: a note the Save button names with `aria-describedby`, and a confirmation panel whose heading takes focus. It is neither a toast nor a new live region.
    - "Guardar de todos modos" saves; "Revisar el monto" closes the panel and returns focus to the amount.
    - A change of amount, category or date asks again.
    - After the save, the feedback is the M6b addendum's one toast (P195, P196), or P170's saved-with-warning notice, unchanged.
39. **The cash flow's data** (Tasks 1c, 1d). **Ruled by the planner (P238):**
    - `GET /api/v1/me/cash-flow?days=30|60`, 30 by default; any other value answers 422 `ValidationFailed`.
    - The data is the ledger's own: each ACTIVE recurrence's schedule dates from its `dueFrom` through the window's last day, and every PENDING occurrence. It comes through the ledger's `listScheduledMovements`, an application port the composition root binds into reporting.
    - It covers every space the caller is a current member of, archived spaces left out. Nothing new is stored.
    - The window runs from today, in the caller's zone, through today + days − 1.

    Rejected: a per-space calendar (a person's money crosses spaces), and a new table of projected rows (D7).
40. **Which movements are the caller's** (Tasks 1c, 1d). **Ruled by the planner (P239):** a movement is the caller's when it debits or credits an account they own:
    - an expense's paying account;
    - an income's receiving account;
    - a transfer's source and destination;
    - a contribution's source.

    A bill the fund pays, a guest's contribution from outside the app and another member's bill are left out. The plan's expected fund contributions have no date, so they are left out too (follow-up 14). "Planned transfers to funds" are the FUND_CONTRIBUTION recurrences.
41. **The projection rule** (Task 1d). **Ruled by the planner (P240):**
    - The opening is today's available money of the personal space (HU-E2-07's `totals.available`).
    - A movement's effect is +amount into a counted account (active, and counted in available money as `totalsOf` counts it) and −amount out of one. It is 0 between two counted accounts or two uncounted ones, and is still listed.
    - A movement due before today (a PENDING occurrence, a date the scheduler has not reached) is placed on today, and a day's PENDING ones come first.
    - Each date answers its balance after all its movements. The totals are incoming, outgoing and closing (opening + incoming − outgoing), plus the lowest balance with its first date.
    - CONFIRM amounts are flagged as estimates.
    - A movement in another currency is left out and its space named once (ruling P37's rule).
42. **The calendar screen** (Task 15b). **Ruled by the planner (P241):**
    - It is a view of the personal space's Plan tab, Próximos, after My spending, at `…/plan/calendar?days=30|60`. A shared space has none (404).
    - The window is two links, as the trend's 6/12 are (P219), and the tab links from it carry no period.
    - Dates are numeric in the person's format (D23). PENDING and estimated movements carry badges, and a zero effect reads "No cambia tu disponible".
    - It has an empty state and the other-currency notice.
    - It is a Server Component with no client island and no chart.
43. **Budgets and coverage of the additions** (Tasks 3b, 3c, 15b, 17c, 18). **Ruled by the planner (P242), amending P221:**
    - P221's twelve routes become thirteen: `/spaces/:id/plan/calendar` at 190 KiB, the server-rendered dashboards' figure.
    - The record routes keep 205 and 215 KiB with the line warning. A miss moves the confirmation panel behind `next/dynamic`, and the budget is never raised.
    - Every new screen and state joins `layout.spec.ts` and the light and dark axe scans (Task 17c): the state badges, the carry-over rows (carried and waiting), the calendar at both windows, and the record form's note and confirmation.
44. **Carry only from a closed plan, and name it** (Tasks 1e, 8b). **Ruled by the planner (P243), amending P15, from a hands-on test of the competitor on 2026-10-21:**
    - The pitfall: turning rollover on for a budget with no history credited a whole month ("$1,500 + $1,500 rolled over").
    - A line carries only from the CLOSED plan it was copied from, and only from its origin line there. That is the line it was copied from, so a line the source never had carries nothing.
    - Before the source closes, the line carries 0 and says which plan it waits for. An unused open plan therefore never credits its whole planned amount.
    - A chain of copies walks on only through CLOSED plans.
    - Both line DTOs answer `carryOverFrom: { planId, period, closed } | null`, null for RESET or a line without an origin in the source. Every screen names the source.

    This changes the meaning of `carryOver` for a copy of an open plan. That is Risk item 3, so Task 1e commits alone and gets an independent verifier. Rejected: carrying from an ACTIVE plan with a "provisional" flag. The figure would still move under the person's feet, which is the pitfall.
45. **A line's state, in words** (Tasks 1b, 3b, 3c). **Ruled by the planner (P244), from the same test:**
    - The pitfall: the competitor showed "5125% spent, $41,000 of $800" with no warning state.
    - The line dashboard answers each line's `state`: OK; NEAR from 80 % used, a neutral badge "Cerca del límite"; HIGH above 90 %, an owe badge "Al límite"; OVER, the "Excedida" badge plus "Te pasaste por {amount}" from the answered `overBy`.
    - The rule is `lineStateOf` in `src/shared/kernel/line-state.ts`, over planned + carry-over, and the record form's preview uses the same function.
    - A SAVINGS line is always OK, and Unbudgeted has no state (P226).
    - No M6c screen writes a share of a line above 100 %: the dashboards write none, bars cap at 100 % (P202), and the warning's OVER states an amount.
46. **Only known items are projected** (Tasks 1d, 15b). **Ruled by the planner (P245), from the same test:**
    - The pitfall: the competitor's forecast spread one day of spending over the whole month.
    - The calendar projects only known future items: the schedule dates of active recurrences, PENDING occurrences, and fund contributions that recur. A one-off expense moves today's opening and adds no future date (pinned in Task 1d's acceptance test and Task 17c's scenario).
    - M6c has no pace-based estimate. A later one needs at least three CLOSED periods of history and takes their median, so one spike cannot set the pace. Until then it shows "Aún no hay datos suficientes" / "Not enough data yet" (follow-up 16).
47. **Local dates end to end** (Tasks 1c, 1d, 15b). **Ruled by the planner (P246), from the same test:**
    - The pitfall: a reminder entered as 2027-03-15 showed as 14/03, a time-zone bug.
    - Every calendar date is a `LocalDate` in the space's calendar: schedule dates and due dates as the ledger stores them.
    - "Today" is the caller's local date (`todayIn` with their zone). The UI formats the `YYYY-MM-DD` text without a `Date`, so no instant and no browser zone ever moves an item.
    - Pinned at the end and the start of a Bogotá day (`2026-10-29T04:59:59Z` is still 2026-10-28; `05:00:00Z` is 2026-10-29) and with "2027-03-15" shown as 15/3/2027.
48. **No bulk money action without a summary** (Task 15b). **Ruled by the planner (P247), from the same test:**
    - The pitfall: the competitor's "Settle" recorded every open balance at once, with no confirmation.
    - No M6c flow records money in bulk. The calendar has no action at all, and a test pins that it renders no button and no form. Pending occurrences are still confirmed one by one where they are today (HU-E4-13).
    - Any later bulk flow, such as "confirm every pending occurrence" or "settle every balance", first shows a summary of what it will record (count, each amount, the total) and asks for confirmation.
49. **A heavy form skips its below-the-fold part in the first frame** (issue #182, after P221). **Ruled by the controller (P256), 2026-10-26:**
    - The cause: Lighthouse's simulated LCP (Lantern) keeps a downloaded script in its graph only when that script starts evaluating before the observed first frame. Unthrottled, the stylesheet and the framework chunks (react-dom, 71 KB, and Next's runtime, 44 KB) arrive within a few milliseconds of each other, so whether they count is a race against the first frame's layout and paint. On `/plans/:plan/lines/:line` the same code measured 978, 1819 and 2359 ms, with the same twelve requests before the paint every time.
    - The fix: the line editor's sections below the catch-all switch (categories, allocation, submit) sit in one wrapper with `content-visibility: auto` and `contain-intrinsic-size: auto 640px`. The browser lays them out and paints them only when they near the viewport, so the first frame is cheaper and lands before the framework chunks evaluate. Local medians on 16 runs: `lines/:line` 2506 → 1957 ms, `lines/new` 1969 → 1957 ms, with no run left in the 2.5 s mode. The content stays in the accessibility tree, in find-in-page and in tab order. Its paint containment clips at the wrapper's padding box, so the wrapper carries `-m-1 p-1`: room for the 2 px focus outline and its 2 px offset, with the layout unchanged.
    - On CI the simulation still swung the whole app between runs (`/sign-up` 1814 to 2346 ms, the line editor 2522 ms on `04ec36e`), so [ADR 0005](../adr/0005-measure-lcp-under-applied-throttling.md) times LCP under applied throttling instead, with the owner's approval and every budget unchanged (CLS, TBT and script stay simulated). The wrapper stays: it lightens the first frame either way.
    - Rejected: `experimental.inlineCss`, which doubled the document (24 → 47 KB, the stylesheet also rides in the RSC payload) and made most routes slower; raising a budget (forbidden); and shrinking the editor's own chunk, which ends about 300 ms before the framework chunks and so is not on the simulated critical path.
50. **A route's skeleton never costs its status** (issue #196, after P195). **Ruled by the controller (P257), 2026-10-27:**
    - The pitfall: a `loading.tsx` starts the stream, and with it a 200, before the screen under it calls `notFound()` or `redirect()`. The first attempt (`d520124`, reverted in `6698c73`) put boundaries above the space's layout and above routes with their own checks: an unknown space answered 200 instead of 404 (N1), the start's redirect became a late client navigation, and its client `ScreenHeader` added 5 to 12 KiB of script to 23 routes over budget.
    - The fix, in three parts. First, every screen gets a boundary of its own, at its leaf, and no boundary wraps another route. A screen with routes below it moves into a route group (`(home)`, `(list)`, `(overview)`, `(planner)`), which leaves its URL unchanged. Second, each boundary's `layout.tsx` is `documentFirst(Page)` (`src/shared/ui/api/route-screen.ts`). A layout renders outside its own segment's boundary, so on the browser's document request it renders the screen first, and every 404 and redirect the screen raises keeps its status. The page is `routeScreen(...)`, which renders the screen once per request (React `cache`): the page reuses the layout's render, with no second read. A client navigation or a prefetch skips the layout's render, so the prefetched skeleton shows the moment the route is tapped. Third, the proxy tells the two apart with `x-hearth-document` (a request that carries `RSC` is not a document) and always overwrites it. The skeleton (`LoadingScreen`) is server markup only: its header draws `ScreenHeader`'s 48 px row with a plain link to the explicit parent, so no prefetched skeleton ships script. The link is marked `data-back`, and the `NavigationTracker` the root layout already mounts sends a click on it back where the person was, with the same `goBack` as `ScreenHeader`, so a Volver tapped before the screen arrives still returns to Movimientos and not to the parent.
    - Found by `pnpm perf`: Settings and New space draw the shell themselves, so their tabs' prefetch of a space's skeleton brought the space's layout, and with it a second chunk group of the shell's script (Settings 165 → 179 KiB, New space 161 → 176 KiB). On those two screens `NavLinks` turns prefetch off, and a tab loads when it is tapped, as before. Every other route measured within 1 KiB of its baseline.
    - Found by CI's performance job: Trend went over its TBT budget (210 and 258 ms against 200 ms), and the Plan tab's own page and By group doubled theirs. The containers that pick another one by the space's kind (`PlanHomeContainer`, `GroupsHomeContainer`, `TrendHomeContainer`) returned it as an element, and Settings did the same with `SettingsContainer`. The picked one rendered after the stream started, so the document streamed the skeleton and then swapped the screen in, and a 404 of its own would have lost its status. Now they call it, so it runs inside the screen. Three more changes close the gap: the page hands back the layout's render itself instead of a promise; the layout wraps the boundary in `IntlReady`, so next-intl's per-request config has settled before the screen renders; and an e2e test checks that these screens' documents carry no skeleton. Accounts, Categories, the record form, Settings and the personal Trend still stream a skeleton for a moment, for a cause not yet found. Their checks have all run before the stream starts, so their statuses hold, and CI measured no TBT change on Accounts or Categories.
    - Found by the e2e: the Plan tab's copy test asserted the planner's Back by `getByText` of a line that the dashboard names three times. On `development` it passed only while a transient screen showed one; it now waits for the URL and then the line in the dashboard's table.
    - Measured before the change, with 150 ms of added latency: a guarded route showed its prefetched skeleton 50 to 115 ms after the tap, and a document request kept its 404.
    - Rejected: checking each route's 404s and redirects by hand in its layout, because the checks reach every `loaded()` read and the containers a screen nests, so a copy would drift; a layout that wraps the page in its own `<Suspense>` only on a client navigation, because Next.js showed no fallback before the whole page arrived; and moving the checks into the proxy, because they need the API.

### Design deviations (the stories win; for the owner's review of Batch 2)

1. **Lines and ByGroup charts.** HU-E9-10's notes ask for "Recharts bar per line" and "a Recharts donut or bar chart". The canvas draws HTML bars beside their figures, and M6c builds those (P202); Recharts draws only the trends.
2. **Lines artboard summary.** It reads "de $ 4.000.000" (total capacity). M6c shows the API's total planned, `totals.planned`, which is the same 4,000,000 COP in the reference plan.
3. **Lines artboard, Unbudgeted detail.** "Gastado $ 60.000 en categorías sin línea · Restaurantes" names the categories, which the API does not list. M6c writes a general note under the table (follow-up 4).
4. **Planner and CopyPlan artboards' dates and meta.**
   - Dates: "1 nov – 30 nov" and "desde el 1 dic 2026" become numeric dates in the person's format (D23).
   - Line meta: "porcentaje 42 / 58" becomes "Directo · Porcentaje · Reinicia", with the labels capitalized as the editor's choices.
   - The activation error: "suma 99 % y debe sumar 100 %" becomes `errors.InvalidAllocation` plus "revisa la asignación de Free". Activation's problem carries line ids, not sums.
5. **LineEditor artboard.**
   - "Al cambiar de mes" becomes "Al cambiar de período", because periods may be half-months.
   - The funding control reads "Directo / Fondo compartido / Ahorro" instead of "Directo / Fondo / Ahorro".
   - The allocation rules keep the artboard's labels: "Según capacidad", "Porcentaje", "Monto fijo" and "Sin asignar".
6. **Capacity artboard.** The total and the shares are the stored ones until the save answers. They are not recomputed while typing (P208).
7. **CopyPlan artboard.** Its one sentence ("Quedó fuera una categoría porque se archivó: Servicios, que alimentaba Casa") becomes a notice with a list. A copy can drop several categories, savings accounts and lines.
8. **Matrix artboard.**
   - Amounts without "$" ("588.000") are written with their symbol, through `formatMoney`.
   - "Aportó y diferencia se siguen en el fondo, no por línea" is kept as `reports.reason.TRACKED_AT_FUND_LEVEL`, the story's key.
9. **Fund artboard.**
   - The summary's "Falta $ 220.000" becomes "Diferencia −$ 220.000" (the API's `totals.difference`).
   - The badge "Le faltan $ 220.000" becomes "Le falta aportar". The UI does not recompute an amount without its sign.
   - The "Registrar aporte al fondo" button is not built: no form records contributions yet (follow-up 2).
10. **Unified artboard.**
    - The note "Personal y Hogar" under a merged row is not built: the API does not say which spaces contributed (follow-up 3).
    - Pedro's line "Hotel · 8 oct · Hogar, como invitado" is not built: the API answers only the `outsideTheApp` total.
11. **PersonalByGroup artboard.** The per-row notes ("Personal y Hogar", "Grupo creado en Hogar") are not built, for the same reason. The scoped names ("Hogar / Mascotas") are.
12. **PersonalTrend artboard.** The hint "Pasa el dedo o el cursor por un punto para ver su valor." is dropped, because the table carries every value. The "6 períodos / 12 períodos" choice is two links.
13. **LineTrend artboard.** The per-line mini bars ("oct / nov") become one chart of every line over the window, plus the table. The artboard's "Sin período anterior" stays for NEW.
14. **NoPlan artboard.** The "Solo Propietario y Administrador ven estas acciones" note becomes a note for those who do not see them ("Solo Propietario y Administrador pueden crear el plan.").
15. **Bottom bar.** The artboards' order is Inicio, Movimientos, Registrar, Plan, Saldos. M6c places Plan after Movimientos and Registrar, before Saldos, so the result depends on the order M6b gave the first three slots.
16. **DashDesktop artboard.** The panels appear on the Plan tab's own page at desktop width. They are not a separate desktop screen (P216).
17. **The additions have no artboard.** #142, #143 and #150 reuse existing artboards' parts:
    - the Lines artboard's badges and rows (the states and the carry-over line);
    - the LineEditor artboard's segmented choice with a hint (the rollover modes);
    - the PersonalTrend artboard's window links (30 / 60 días);
    - the QuickAdd form's full-width button row (the confirmation panel).

    The owner's review of Batch 2 covers them too.

### Risks

1. Recharts 3.10.1's chunk size (about 110 KiB compressed for a line chart with redux toolkit, immer and the d3 parts of `victory-vendor`) is an estimate. Task 18 measures it and follows P221's procedure, and SVG drawn by hand is the fallback put to the owner.
2. `charts-load-lazily` relies on dependency-cruiser's `dynamic` attribute of a dependency. The fixture pair of Task 14a proves it on the installed version. If it ever stops telling `import()` apart, the allowed fixture fails before any route ships Recharts.
3. Recharts in jsdom: the component tests assert the chart mounted and its `data-points`, not its SVG. The dots are counted in a real browser in Task 17b.
4. M6b runs in parallel. `NavLinks`' order, `SpaceMemberDto` in `dto.ts`, the decisions index, `budgets.json` and `mkdocs.yml` may already carry M6b's lines. Each task names how to merge, and M6c's own builders, seeding and DTO aliases live in their own files.
5. The shared `/plan` adds four parallel reads (Task 16). If its LCP misses 2.5 s on the perf household, caching per #128 becomes the fix, not the budget.
6. A plan write has no idempotency key. A lost answer followed by a retry meets a 412, and the re-read shows the saved state; that path is tested (Task 4).
7. The copy notice lives in one tab's `sessionStorage` and is lost on a reload. This is accepted (P209).
8. If the kernel's `Money.allocate` changes, the preview drifts; Task 8's test fails first.
9. The e2e server's fixed "today" (2026-10-31 in Bogotá, P133) is before November. The scenarios open the period by its label, and the planner's Close stays disabled there, which no scenario needs.
10. `react-is` must move with React. A React bump must bump it in the same change (follow-up 7).
11. Task 1e changes what `carryOver` answers for a copy of an open plan: 0 until that plan closes. A client that read the old figure sees a different number. It is Risk item 3: the task commits alone, its verifier probes the HU-E6-09 outline both ways, and the PR notes name it.
12. Task 3c depends on the M6b addendum's A4 and A7, which edit `record-form.tsx`. If they slip, 3c waits; nothing else depends on it.
13. The record routes carry the line warning within 205 and 215 KiB. If either misses, the confirmation panel moves behind `next/dynamic` (P242); the budget is never raised.
14. The line watch is read for today in the profile's zone. A person whose browser zone differs near midnight may see no warning for a date in the next period. Every save stays possible (P236).
15. The calendar reads every space's recurrences per request, O(spaces × recurrences). Households have few; #128's caching is the fix if it slows the personal Plan tab.

### Follow-ups

1. Plan figures on the Home screen (the Batch 1 Home artboard's plan card, P126).
2. A screen to record a fund contribution (the Fund artboard's button).
3. API: name the spaces a merged unified or personal by-group row comes from, and list a guest's outside-the-app payments.
4. API: name the categories behind Unbudgeted on the line dashboard.
5. #128: the 24-plan ROLLOVER probe and household-scale reads, with caching if a report misses the UI budget.
6. Lower the script budgets: P154's follow-up, and Recharts' chunk.
7. Bump `react-is` with every React bump; consider Recharts 3.11.x once it is two weeks old.
8. The owner's review of Batch 2, with design deviations 1–16 above.
9. Move HU-E9-08, HU-E9-10 and HU-E9-11 to `Done` in `docs/backlog/README.md` and update their issue bodies (Task 18's amended notes) when the pull request merges.
10. An activation problem that also carries each invalid line's sum, for a message like the Planner artboard's.
11. A line warning on an edit (A7) and on a split with someone, against the direct space's plan (P236).
12. The line states on the planner and the member matrix, and in the unified view's lines (P244).
13. A sinking-fund helper: a yearly amount and a due date on a ROLLOVER line, with an "on track" figure (#143's comment, P232).
14. A cash-flow calendar for a shared space that projects its fund, and the plan's expected fund contributions as dated movements (P239).
15. Recurrence screens (HU-E9-09), linked from the calendar's empty state and its pending badges.
16. A pace-based forecast. It needs at least three CLOSED periods of history and takes their median. Until then it says "Aún no hay datos suficientes" (P245).

### Placeholder and consistency scan

- No "TBD" and no step without its file, its test or its command. Every component step names its file, exported name, props, the roles and labels its test queries, and its catalog keys in both languages.
- Names across tasks:
  - Task 1: `LineTotals`, `FundTotals`, `totals`.
  - Task 2: `formatPercent`, `formatSignedMoney`, `roundingUnit`, `periodName` (moved), `usePeriodText`, `PeriodSwitcher`, `UI_ICONS.chart`, `.pencil`, `.arrowUp`, `.arrowDown`.
  - Task 3: `PlanView`, `viewsFor`, `viewHref`, `periodLabel`, `neighboursOf`, `spaceOf`, `PlanTabs`, `DashboardFrame`, `barWidth`, `LineDashboard`, `loadLines`, `LineDashboardContainer`, `PlanStatusBadge`, `LineDashboardDto`, `ReportPlanDto`, `PlanStatus`, `householdDto`, `NOVEMBER`, `e7Dashboard`.
  - Task 4: `canManage`, `capacityEditable`, `isEditable`, `closesFrom`, `canCloseOn`, `memberOf`, `PlanWrite`, `ifMatch`, `planWrite`, `rereadPlan`, `Planner`, `loadPlanner`, `PlannerContainer`, `BudgetPlanDto`, `PlanLineDto`, `SpaceMemberDto`, `spaceMemberDto`, `HOUSEHOLD_MEMBERS`, `planLineDto`, `referencePlanDto`, `freeAt99`.
  - Task 5: `PlanDrops`, `rememberDropped`, `takeDropped`, `CopyNotice`, `PlanStartActions`, `NoPlan`, `copiedPlanDto`.
  - Task 6: `draftsOf`, `capacityBodyOf`, `capacityFieldOf`, `CapacityForm`, `loadCapacities`, `CapacityContainer`, `CapacitySuggestionDto`.
  - Task 7: `LineDraft`, `NEW_LINE`, `lineDraftOf`, `LineBody`, `lineBodyOf`, `lineChanges`, `LineField`, `lineFieldOf`, `LineSection`, `LineSave`, `SaveOutcome`, `saveLine`, `removeLine`, `newLineId`, `LineEditor`, `loadLineEditor`, `LineEditorContainer`, `savingsAccountDto`.
  - Task 8: `AllocationRule`, `AllocationDraft`, `allocationDraftOf`, `allocate`, `Preview`, `previewOf`, `AllocationBody`, `allocationBodyOf`, `allocationChanged`, `AllocationEditor`, `CategoryMappingSheet`.
  - Task 9: `MemberMatrix`, `memberName`, `loadMatrix`, `MemberMatrixContainer`, `MemberMatrixDto`, `e7Matrix`.
  - Task 10: `FundTracking`, `loadFund`, `FundTrackingContainer`, `FundTrackingDto`, `e7Fund`.
  - Task 11: `NodeName`, `SpendingNode`, `treeOf`, `levelAt`, `NodeLabel`, `DrillBreadcrumb`, `SpendingChart`, `loadByGroup`, `SpendingByGroupContainer`, `SpendingByGroupDto`, `PersonalSpendingByGroupDto`, `e7Groups`.
  - Task 12: `UnifiedView`, `loadUnified`, `UnifiedViewContainer`, `PlanHomeContainer`, `UnifiedViewDto`, `e74Unified`.
  - Task 13: `loadPersonalByGroup`, `PersonalSpendingByGroupContainer`, `GroupsHomeContainer`, `e74Groups`.
  - Task 14a: `TrendPoint`, `TrendSeries`, `TrendChartData`, `pointOf`, `chartRows`, `textAt`, `TrendChartProps`, `ChartFrame`, `LazyTrendChart`, `preloadTrendChart`, `TrendChart`.
  - Task 14b: `ChangeText`, `PersonalTrend`, `windowOf`, `loadPersonalTrend`, `PersonalTrendContainer`, `TrendHomeContainer`, `PersonalTrendDto`, `sixMonthsTrend`.
  - Task 15: `LineTrend`, `loadLineTrend`, `LineTrendContainer`, `LineTrendDto`, `homeTrend`.
  - Task 16: `Overview`, `loadOverview`, `DashOverview`.
  - Task 17a: `SeedClient`, `SeededHousehold`, `seedHousehold`, `householdOf`, `clientOf`, `categoryIdsByKey`, `seedReferencePlan`, `percentShown`.
  - Task 17b: `seedAccounts`, `seedE7Expenses`, `seedE74Movements`.
  - Task 18: `routeUrl`, `seedPlanRoutes`.
  - Task 1b: `lineStateOf`, `LineState`, `CategoryLine`, `categoryLinesOf`, `categoryLines`, `state`, `overBy`.
  - Task 1c: `MAX_SCHEDULED`, `datesThrough`, `accountsMovedBy`, `ScheduledMovement`, `ListScheduledMovements`, `createListScheduledMovements`.
  - Task 1d: `PlannedMovement`, `OwnAccount`, `CashFlowMovement`, `CashFlowDate`, `CashFlowProjection`, `CashFlowInput`, `cashFlow`, `CASH_FLOW_DAYS`, `CashFlowDays`, `CashFlowDeps`, `CashFlowView`, `GetCashFlow`, `createGetCashFlow`, `CashFlowQuerySchema`, `CashFlowSchema`, `cashFlowDto`, `cashFlowOf`, `CashFlowDto` (test support).
  - Task 1e: `CarrySource`, `carryOverFrom`, `carryOf`, the rollover world's `close`.
  - Task 3b: `reports.lines.state.*`, `reports.lines.overBy`, `Badge`'s `data-tone`.
  - Task 3c: `LineWatch`, `lineWatchOf`, `LineLevel`, `LineWarning`, `lineWarningOf`, `asksFirst`, `LineWarningNote`, `LineWarningConfirm`, `loadLineWatch`, `RecordFormProps.lineWatch`.
  - Task 8b: `barWidth`'s `carryOver`, `CarryText`, `LineDashboard`'s `policy`, `ChoiceGroup`'s `describedBy`.
  - Task 15b: `CashFlowDto` (dto), `calendarHref`, `PlanView` `"calendar"`, `CashFlowCalendar`, `daysOf`, `loadCashFlow`, `CalendarContainer`, `cashFlowDto` (builder).
  - Task 17c: `seedRecurrence`, `seedHome`.
- Environment variables: none new (`E2E_PORT` and `HEARTH_E2E_FIXED_NOW` are M6a's, test-only).
- Migrations: none. OpenAPI changes:
  - Task 1: two additive `totals` objects;
  - Task 1b: `categoryLines`, and each line's `state` and `overBy`, all additive;
  - Task 1d: the new path `/api/v1/me/cash-flow`;
  - Task 1e: `carryOverFrom` on both line DTOs, plus the changed meaning of `carryOver` for a copy of an open plan (P243, Risk item 3).
- New dependencies: exactly `recharts` 3.10.1 and `react-is` 19.3.0 (Task 14a); `pnpm check:pinned` passes after it.
- Rulings: P200–P247, 48 entries, numbered 1–48 above. P227–P247 are the additions; no number is reused.
- Spanish copy: every new key (`ledger.lineWarning.*`, `reports.lines.state.*`, `reports.lines.overBy`, `reports.lines.carryOver`, `reports.lines.carryOverPending`, `budgeting.lineEditor.carryOver`, `budgeting.rollover.hint.*`, `budgeting.rollover.throughCopy`, `reports.view.calendar`, `reports.calendar.*`) has es and en, in neutral *tú* ("te pasarías", "Úsalo", "Si te pasas", "tus cuentas"). The owner's Log L2 quote keeps his own words.

## Open questions for the owner

None. Every decision was taken under the standing instruction of 2026-10-20 (Log L1) and recorded as a ruling. So were the additions of Log L2 and the coordinator's evidence of Log L3 (P227–P247). The design deviations above wait for the owner's review of Batch 2, which the instruction defers to the end ("luego al final organizamos las ideas de cosas pendientes").
